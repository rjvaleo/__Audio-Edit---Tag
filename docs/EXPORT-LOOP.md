# Exporting a loop, with a tail

Written 16 Aug 2026, before the work, as the design being built to.

## What it is for

The transport can loop — a selection if there is one, the whole document if
there is not — and that loop is how a sound gets auditioned. Until now none of
it reached the file. Export took `{p, bits}`, rendered the whole document once,
and stopped on the last input frame. So the thing you set up and listened to was
not the thing you could get out, and any reverb or delay still sounding at the
end was simply truncated.

Two additions, both only when the loop is actually on:

1. **Repeats.** Export the loop range, N times.
2. **A tail.** Let the rack go on sounding after the last repeat, and keep those
   samples.

Loop off means the export is exactly what it was. Nothing about the existing
path changes.

## Where the loop lives today

It is live-transport state and nothing else:

    state.sel {start, end}  +  state.loopOn
      → POST /api/engine/transport  {loop: {on, a, b}}
      → Shared::set_loop  (transport.rs:503)
      → atomics read in the audio callback

`b == 0` is the wire encoding for "to the end of the document", so the browser
never has to recompute document length under a changing stretch ratio.

It is **not** in the `EditList`, not in session persistence, not in
`export_meta`. That stays true: a loop is a way of listening, not a property of
the document. It reaches the file by being named in the export request.

## Units

The request carries `from`/`to` in **source frames** — which is exactly what
`state.sel` already holds — and the server maps them through the stretch:

    out = src * list.frames() / list.base_frames()

Not the UI's `engineFromSrc`: that maps to *engine* frames, which are at the
device sample rate. The export is at the document's rate. Sending source frames
and mapping on the server keeps the one conversion in the one place that knows
both numbers.

## The seam

Matching the engine exactly, because the file should sound like what was
auditioned.

`loop_fade(a, b)` (transport.rs:60) is a quarter of the loop capped at 512
frames, so ordinary loops get the full ~11 ms and a short loop is not eaten by
its own seam. The engine then does **not** overlap two copies — one source, so
it fades the outgoing material to zero and fades the incoming material up from
zero across the jump (`fade_out`/`fade_in`, transport.rs:1268/1282, linear).

Reproduced on tiling as:

- repeat 0 — no fade in; playback enters it normally.
- every repeat but the last — `fade_out` its final `seam` frames.
- every repeat but the first — `fade_in` its first `seam` frames.
- the last repeat — no fade out. The file ends on the exact loop end, so it can
  be re-looped downstream without a ramp baked into it.

**Every repeat keeps its exact length.** The seam is a brief dip through zero,
not an overlap, so N repeats is exactly N × the selection.

## The rack runs once, over everything

The tiling is of **dry** audio — stretch applied, rack not. The rack is then run
once, continuously, over the whole tiled stream.

This is the point of doing it this way. Rendering the loop with FX and *then*
repeating it would give every repeat its own severed reverb tail, chopped at the
seam and restarted. Running the rack over the tiled stream lets the reverb and
the delay bleed across each repeat exactly as they do when the transport loops,
which is what was actually heard.

Automation follows the same rule: the control hook is handed the document frame
mapped back into the loop range, `from + (i % loop_len)`, so a lane repeats with
the audio rather than running off the end.

## The tail

The engine already models a ring-out and this reuses its constants rather than
inventing new ones:

- `TAIL_SILENCE = 1e-4` — about −80 dBFS. Long after a reverb has gone, above
  the denormal noise that would keep a rack running forever.
- `tail_budget = sample_rate * 4` — four seconds of *continuous* quiet before it
  is called finished. A countdown rather than a switch, and any peak above the
  floor restores it in full, so a slow delay that is briefly silent between taps
  is not mistaken for a finished one.

Offline it is: append silence after the last repeat, run the rack over it as
part of the same continuous stream, then find where it stopped saying anything.

**Corrected during the build.** The first cut used the countdown directly and
that was wrong offline: a rack with nothing in it that can ring never rises
above the floor, so the countdown never resets and its full four seconds get
appended — four seconds of digital silence on the end of every tailed export
from a dry chain. Caught on a real export, 8.500s of file for 4.500s of audio.

The countdown exists because the live transport cannot see the future and must
not cut a slow delay off between taps. Offline the whole tail is already in
hand, so the rule is simply **the last frame above the floor**, plus 50 ms so
the file ends in silence rather than on an audible sample. That is exact, it is
immune to the gap problem the countdown was invented for, and a rack that cannot
ring gets no tail at all. `TAIL_SILENCE` is still shared; `tail_budget` stays
the engine's.

A hard cap of **30 seconds** on top, because reverb `freeze` (reverb.rs:159) is
documented as "the only way to reach an actually infinite tail" — it is
unbounded by construction, and a render has to end.

The constants move to `fx` so the engine and the renderer cannot drift apart.

## The one structural obstacle

`render_to_aiff_controlled` (render.rs:521) writes the AIFF header from
`list.frames()` *before* producing a sample, so the output length is committed
up front. A tail's length is not knowable until the rack has been run.

So the loop path goes buffer-first, the shape `write_aiff_controlled`
(render.rs:474) already uses: materialise, process, measure, trim, then write a
header from the length that resulted. The existing whole-file path is untouched.

## What the request becomes

    POST /api/export
    { p, bits, from?, to?, repeats?, tail? }

`from`/`to` in source frames, `repeats` a count, `tail` a bool. All optional;
absent means today's behaviour exactly. The server takes the loop path only when
`repeats >= 1` and `to > from`.

The filename gains a marker so a loop export is not mistaken for a whole-file
one — `export_name` (docs.rs:231) already encodes algorithm, ratio, semitones
and window.

## What is deliberately not in this

- **No loop in the document.** It stays a way of listening.
- **No tail without a loop.** The user asked for the tail as part of the loop
  export. A whole-file export with a tail is a reasonable thing to want later,
  and the machinery will already be there — but it is not this change.
- **No crossfade control.** The engine's number, so the two cannot disagree.


# Watching an export

Added 16 Aug 2026, after the loop work made exports long enough to need it.

## Why it needed real plumbing

Export used to block the request thread and answer with the finished path. A
four-minute file takes twenty-five seconds; a heavy stretch takes minutes. The
browser had nothing to draw and no way to stop it.

The first instinct — count the write loop — is worthless here. `Stretch::process`
dominates a big export by a distance, and it is one call: a bar fed only by the
write loop sits at 0% for the entire wait and then jumps to 100%.

So the tick had to go *inside* the stretch, at the `while at < want` chunk loops
of WSOLA, the vocoder, PVSOLA and the hybrid, and at the layer boundary of the
granular pass. Every existing signature was left alone by adding `_with`
variants — `process_with`, `stretch_with`, `granular_with` — so the ~100 test
call sites did not move.

## The shape

    POST /api/export   → starts a thread, answers at once with the work total
    GET  /api/export   → phase, done/total, fraction, and the outcome
    POST /api/export/stop

`ExportProgress` on `App` mirrors `ScanProgress`, which was already exactly this
pattern. The server is a thread per connection with no lock held across a render
(`serve.rs:37`), so the status route stays answerable while the export runs.

## Work frames, not output frames

`done`/`total` are counted in **work**, because `layered` runs the whole engine
once per layer and the grain cloud is a second full pass. A bar scaled to output
length would fill in the first sixteenth of a sixteen-layer render and stop.
`Stretch::work_frames` is that arithmetic.

The three phases cost wildly different amounts per frame, so the bar is a
proportion of work done, not a prediction of time. What makes it honest is the
phase name beside it.

**The total must match exactly what the renderer steps.** The first cut counted
a reading pass the unstretched path never makes, and a finished export stopped
the bar at 50%. There is a test pinning the finished fraction at 1.0.

## Cancel

The stop flag is checked at every phase boundary and once per block — and, since
it rides back on the progress tick's return value, inside the stretch's chunk
loops too. Stopping there leaves the rest of the output buffer as the zeros it
was allocated with, so the length is still right and what comes back is partial
rather than corrupt. Nothing keeps it: the file is deleted.

Measured on a ×8, six-layer export: **1.3s** from pressing Stop to the bar
clearing, against the whole remaining render before the tick could answer.

A cancel surfaces as `io::ErrorKind::Interrupted`, which is *not* a failure and
must not be reported as one — it was, at first, and said "failed" on a file the
user had deliberately stopped.

## The render is stereo, because the sound is

Added 19 Aug 2026, after a video export came out mono.

**The transport runs at the device's channel count, not the source's** — it says
so in `transport.rs` where it takes it. So a mono file is already being played
through a stereo chain, and everything that makes it stereo happens in that
chain: the grain engine's own pan, the rack's reverbs and delays, the
spatialisation.

The render used to run at the *source's* count. `pan_gains` returns (1, 1) below
two channels, so a mono document exported with every one of those switched on
came out as one channel with the pan discarded — while the speakers played a
stereo field and the room drew a PAN column and a stereo Lissajous from the same
schedule. The picture, the playback and the file are meant to agree, and this is
the one place they did not.

**A mono document now always renders stereo.** Not "when the rack has something
in it" or "when the grain engine is panning": the processing can always make
stereo, and a rule with conditions in it produces a mono file on Tuesday and a
stereo one on Wednesday from the same sound, leaving whoever collected them to
work out why.

The widening happens **at the read**, in `edit::render::render`, not at the end.
Everything downstream — the stretch, the grains, the rack — then works in the
width the sound is going to be heard in, which is where the stereo is actually
made. Widening afterwards would copy a mono result into two channels and produce
a file that is stereo in name only.

Every channel gets the same samples and nothing is halved on the way: what
follows is about to *give* this a stereo field, and arriving quieter than it was
auditioned would be a second fault dressed as gain staging.

This changes the plain audio export too, deliberately. A mono source now exports
as a stereo AIFF.

