# What destroys live audio state

*An audit and a plan. Written 15 Aug 2026 after a granular slider was found to
be rebuilding the entire effect rack. Nothing here is fixed yet.*

---

## The engine is live. That is not the problem.

Worth settling first, because the symptom reads like "there is no real-time
engine" and that is not what is wrong.

Every engine runs inside the audio callback. `fx::Rack` — every filter, delay
line and reverb tail — lives on `Core`, the audio thread's own state, and is
processed block by block. Parameters reach it through atomics and `try_lock`,
never blocking. There is no render step between a control and the speakers.

What is wrong is narrower and worse: **several code paths communicate a value
change by rebuilding the object that holds the state.** A new rack is a new
reverb, with no tail, no delay line and no filter memory. The audio thread
crossfades the old one out over 960 frames — which is precisely the "ducks out,
goes mute, comes back in" being heard.

## What carries continuity

Anything on this list is expensive to lose, and losing it is audible:

| | what is lost if it is replaced |
|---|---|
| `fx::Rack` | reverb tails, delay lines, filter memory, compressor envelopes |
| `Stretcher` engines | WSOLA splice history, vocoder phase, PVSOLA anchors |
| `LayerBank` | the same, per layer |
| `TimeMap`, `Parts` | nothing audible directly — but both cost real time to derive |
| `BlockRenderer` voices | grains currently in flight |
| `OutputRing` | the sixth engine's entire memory of itself |

---

## The offenders

### 1. Every stretch or grain parameter rebuilds the whole rack — **confirmed**

[`live.rs:383`](../core/crates/server/src/live.rs:383), the last line of
`push_params`, which runs on **every** parameter change:

```rust
h.shared.set_rack(rack_for(app, rel, h.sample_rate, h.channels));
```

Unconditional. The three expensive things immediately above it are each guarded
— `want_map`, `want_parts`, `want_bank` — so they only rebuild when the thing
they depend on actually moves. The rack got no such guard.

**What you hear:** move any granular slider and every reverb, delay and filter
in the chain is destroyed and replaced.

**The damning part:** the `/api/rack` handler
[`routes.rs:1063`](../core/crates/server/src/routes.rs:1063) already fixed this
exact bug and says so in its own comment — *"Rebuilding then would clear every
delay line and filter in the chain for no reason, which is heard as the reverb
tail stopping the instant a slider is released."* It guards on `keepLive`. The
same mistake was left standing one file away.

### 2. Every master control rebuilds the whole rack, while dragging — **confirmed by reading**

[`app.js:2629`](../ui/app.js:2629):

```js
const send = throttled(() => pushRack(), 120);
const commit = () => pushRack({ immediate: true });
```

`pushRack` posts the full rack **without** `keepLive`, so the server rebuilds.
The maximiser's Amount and Ceiling therefore tear the chain down every 120 ms
*during* the drag, and once more on release. This one is arguably worse than the
first because it fires continuously while the hand is moving.

Note that `commitRack()` — the function written for exactly this job — does pass
`keepLive: true` and is used correctly everywhere else. The master strip simply
never adopted it.

### 3. Any rack control without a `key` rebuilds the whole rack at 32 ms — **confirmed by reading**

[`app.js:2813`](../ui/app.js:2813):

```js
if (key) liveParam(slot.id, key, v);
else if (!sent) pushRackLive();
```

`pushRackLive` posts the full rack with no `keepLive`, throttled to 32 ms — about
thirty rack rebuilds a second. Six `add(...)` call sites currently pass no key,
and none is marked `sent`. This is the trap the Dry/Wet bug fell into once
already; the `sent` flag was added to escape it rather than to remove it.

### 4. Reverb and delay tails are cut dead when the transport stops — **confirmed**

`Core::fill`:

```rust
if !shared.is_playing() {
    out.fill(0.0);
    ...
    return;          // ← before process_rack
}
```

The rack never runs while stopped, so a tail cannot decay. Press stop and the
reverb vanishes on the same sample.

---

## What is already correct — do not "fix" these

Checked, and each is right for its own reason:

- **`routes.rs:1063`** — guarded by `keepLive`.
- **`commitRack()`** — passes `keepLive: true`, and its comment explains why.
- **`live.rs:220`** (inside `load`) — the file changed, so the rack *should* be
  rebuilt.
- **`routes.rs:2045`** — a structural edit reloads the source. Deliberate: you
  do not hold a cut while listening.
- **`want_map` / `want_parts` / `want_bank`** — properly conditional. These are
  the model the rack should have followed.
- **Structural `pushRack({immediate: true})`** — adding, removing, bypassing or
  retyping a module genuinely needs a new chain.

## The pattern

Three of the four are one mistake: **rebuilding a stateful object in order to
communicate a value.** The codebase already contains the answer to it —
`liveParam` for the value, `keepLive` for the document — and the fix is applying
it consistently rather than inventing anything.

The fourth is separate: the paused path treats "not playing" as "produce
nothing", when it should mean "produce no *new* material".

---

## The plan

### Stage 1 — stop destroying state

**1a. Guard the rack handover in `push_params`.** Two options:

- *Delete it.* `push_params` is about stretch parameters and has no business
  touching the rack; `load()` and `/api/rack` are what own it. Cleanest, and
  most likely correct.
- *Guard it.* Keep the last spec handed to the audio thread on the live handle
  and compare — `RackSpec` already derives `PartialEq`, so this is a one-line
  test.

Recommend deleting, with the guard as the fallback if anything turns out to
depend on it. Either way the behaviour to prove is the same.

**1b. Move the master strip onto the live path.** `send`/`commit` become
`liveParam` + `commitRack({keepLive})`, matching every other control. Needs the
master's parameters to be reachable through `/api/rack/param`; if they are not,
that route grows a `master.*` target.

**1c. Remove the `pushRackLive` fallback.** Make `key` mandatory in `add(...)`
and give the six keyless call sites their keys. A control that cannot name its
parameter should fail loudly at build time rather than quietly rebuilding the
chain thirty times a second.

### Stage 2 — let tails decay

**2a. Run the rack while stopped.** The paused branch fills silence and then
*continues* into `process_rack`, so the chain keeps processing zeros and its
tails ring out.

**2b. Stop when it is actually quiet.** Track output level while stopped and
skip the rack once it has been below a threshold for some blocks, so a stopped
transport does not burn a core forever. Reset the moment playback resumes.

### Stage 3 — prove it, and keep it proven

- A test that moving a stretch parameter does **not** change the rack the audio
  thread holds.
- A test that a rack with a tail still produces output for N blocks after
  `pause()`, and reaches silence eventually.
- A test that `/api/rack` with `keepLive` leaves the live rack identical.
- A scan asserting no `param`/`knob` in the rack panels reaches `pushRackLive`.

### Not in this plan

**The yellow text.** Three separate things say something like it and none was
removed: `.seg-btn.rendered` (dead CSS, never applied), the `engine-note` reading
*"Rendered on export — playback approximates this with the grain cloud"*, and
`#stretchOut.pending::after` reading *"picture catching up…"*. The middle one is
the one that says Rendered, and it is shown whenever the chosen engine is not in
`LIVE_ENGINES`. Worth settling what should be said, if anything, once the engine
really is never rebuilt — that is a separate conversation from this one.
