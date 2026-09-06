# The scale sequencer, as a second voice

*6 September 2026.*

The scale sequencer is its own program: a browser synth with a microtonal
step grid, a filter, two LFOs, a tape delay and a cathedral reverb, and a
performance recorder that writes every knob move into a lane of its own. It
lives at `rjvaleo/scale-sequencer` and runs on GitHub Pages. It now also runs
here, as itself, under the **Seq** button on the rail — a second voice on the
same transport as the granular engine.

## How it is in here

**Vendored whole, served from the binary.** `ui/sequencer/` holds the
sequencer's five files exactly as they are in its repository at commit
`e0b8189` — `index.html`, `app.js`, `performance.js`, `style.css`,
`presets.json` — plus one file that is ours, `bridge.js`. The page is served at
`/sequencer/` with `include_str!` like everything else, so it works offline
and is the same page every time. To take a newer sequencer, copy the five
files over and keep the one line in `index.html` that loads the bridge.

**In a frame, not merged.** The two programs share a global namespace's worth
of names — `state`, `togglePlay`, `initAudio` — and the sequencer has its own
stylesheet with its own palette. Merging them would have meant renaming half
of one or the other and keeping the rename up to date with a repository that
is still moving. A same-origin frame costs nothing and keeps the sequencer the
sequencer. It is given its address the first time Seq is opened, so a session
that never opens it never loads it and never starts its audio context.

**Two messages each way.** `bridge.js` runs inside the frame and does nothing
at all when the page is opened on its own. Embedded, it:

- takes `seq:transport` from the parent and plays or stops the sequencer's
  own transport (`togglePlay`, `stopSeq`), waking the audio context if the
  browser had it asleep;
- takes `seq:want` — how many bands, between which frequencies — so the
  spectrum it sends is in the shape the room is about to draw;
- sends `seq:ready` once, and `seq:feed` thirty times a second while it plays:
  a spectrum in decibels per band, measured exactly as the engine measures its
  own bus, a run of left/right pairs for the ring, and its RMS and peak.

The parent side is the `seq` block in `app.js`: `seqSync` on every play and
stop of the engine's transport, and `seqMix` in the master-bus poll.

## One transport

Press play in the granular app and the sequencer plays; stop and it stops. It
is the engine's transport that is authoritative, because the engine's is the
one the lanes, the export and the room are all measured against. The
sequencer's own play button still works on its own, for auditioning a
pattern; pressing the engine's after it simply restarts the sequence from step
one, the way the sequencer's own button does.

There is no tempo on the engine's side to sync *to* — a stretch has a ratio,
not a BPM — so the sequencer keeps its own clock. That is the right answer for
now and the wrong one for a third voice: see the end.

## The mix is a picture, not a signal

The engine plays through the sound card and the sequencer through the
browser. They meet in the air. What is mixed is what the room is drawn from:
`seqMix` folds the sequencer's feed into the engine's master feed before it is
handed to the visualiser, so the terrain, the ring, the skin and the solid are
all drawn from both voices at once.

- **Spectra add as power.** Two voices at the same level read six decibels
  louder than one, which is what a meter would say; a voice sixty decibels
  down adds nothing you can see.
- **Figures add as samples** and clip at the rails, which is what a scope
  would show.
- **With the engine silent the sequencer stands in whole**, VU and peak from
  its own RMS, so the room has something to draw. The meter poll only runs
  while the engine's transport is going, though — so in practice the mixed
  picture is there when the two play together, which is what it is for.

Nothing reaches the export. A film or a bounce is the engine's sound alone.

## What this is not, yet

The next thing is what you asked for after this: a third and a fourth source,
and the audio of all of them mixed for real. That is a different piece of
work from this one and should be built as one thing:

- **a source is a thing with a transport, a feed and a level**, and the engine,
  the sequencer and whatever comes next are three of them;
- **the mix happens in the engine**, which means the browser's sound has to
  reach it — a loopback device, or the sequencer rendered offline through the
  same `MediaStreamDestination` it already taps for its own recorder;
- **a tempo the sources share**, so a fourth voice that has bars can line them
  up with the sequencer's.

None of that is here, and this document should not be read as saying it is.

## Where it lives

- `ui/sequencer/` — the vendored page and `bridge.js`.
- `ui/app.js` — `playsDocument` (Seq plays the document), `setMode` (the
  `seq` mode, `#seqView`), the `seq` block: `seqEnsureFrame`, `seqSync`,
  `seqAsk`, `seqMix`; `startPlayback` and `pausePlayback` call `seqSync`.
- `ui/rail.js` — the Seq item and its icon.
- `ui/index.html` — `#seqView`; `ui/app.css` — `.seqview`, `.seq-frame`.
- `core/crates/server/src/routes.rs` — the six `SEQ_*` constants, their routes
  under `/sequencer/`, and their place in `ui_build_id`.
- `tests/ui/sequencer.spec.mjs` — served whole; on the rail; play and stop
  reach the frame and the feed comes back; the mix adds as power and clips.

Embedded with `include_str!`. **Rebuild the binary after editing any of
them** or the browser is served the old file.
