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

- takes `seq:transport` from the parent — with the engine's position — and
  starts the step clock there, or stops it, waking the audio context if the
  browser had it asleep; and starts or stops the loaded take with it;
- takes `seq:want` — how many bands, between which frequencies — so the
  spectrum it sends is in the shape the room is about to draw;
- takes `seq:clock` — the engine's position, four times a second while it
  plays — and re-lays its grid when the two clocks have parted;
- sends `seq:ready` once, and `seq:feed` thirty times a second while it plays:
  a spectrum in decibels per band, measured exactly as the engine measures its
  own bus, a run of left/right pairs for the ring, and its RMS and peak.

The parent side is the `seq` block in `app.js`: `seqSync` on every play and
stop of the engine's transport, `seqClock` on the interval and on every seek,
and `seqMix` in the master-bus poll.

## One transport, one clock

Press play in the granular app and the sequencer plays; stop and it stops.
It is the engine's transport that is authoritative, because the engine's is
the one the lanes, the export and the room are all measured against.

**And one position.** *(Added later on 6 Sep 2026.)* The engine's output
time in seconds from the start of the document — `playbackTime` — is the
clock both run on. The sequencer's step grid is laid along it from zero:
step *k* sounds at *k* times the step length, so where the engine is decides
which step sounds next and how soon, by arithmetic rather than by counting.
Play from twelve seconds in and the sequencer lands on the step that belongs
at twelve seconds, in phase, in any of its four directions. The engine sends
its position with play and then four times a second; the bridge carries it
forward on the audio clock between messages and re-lays the grid only when
the two differ by more than eighty milliseconds — a seek, a loop wrap, a
creep worth correcting — so a clock that is a few milliseconds out is not
forever being nudged. A seek is sent the moment it happens rather than at the
next tick, because a seek is a discontinuity and the sequencer should land
with it.

**The sequencer's take rides along.** A performance recorded on the Seq page
and loaded there replays with the engine's transport, from the engine's
position: everything the take had done before that position is applied at
once, so the knobs stand where the take had them, and the rest runs on the
clock. Play and pause events inside the take are ignored — the transport is
the engine's now. Stop stops it. Its own ▶ PLAY PERF still works alone.

*(14 Sep 2026.)* The take is edited from the host too: its lanes open in the
host's lane editor, and each edit comes back as `seq:take-edit`, which the
bridge turns into the control's gesture in the take — see `docs/COMPOSE.md`,
"the sequencer's lanes, edited here".

The sequencer's own play button still works on its own, for auditioning a
pattern. There is no tempo on the engine's side — a stretch has a ratio, not
a BPM — so the tempo is the sequencer's, and the document has no bars. When
a fourth source with bars arrives, the tempo becomes the arrangement's.

## Live, the mix is a picture; in the film it is the sound too

**Live**, the engine plays through the sound card and the sequencer through
the browser. They meet in the air. *(Until 14 Sep 2026: the sequencer now plays
through the engine's output — see "one output" below. What follows is what
happens when that setting is off, or cannot be kept.)* What is mixed is what the room is drawn
from: `seqMix` folds the sequencer's feed into the engine's master feed
before it is handed to the visualiser, so the terrain, the ring, the skin and
the solid are all drawn from both voices at once.

- **Spectra add as power.** Two voices at the same level read six decibels
  louder than one, which is what a meter would say; a voice sixty decibels
  down adds nothing you can see.
- **Figures add as samples** and clip at the rails, which is what a scope
  would show.
- **With the engine silent the sequencer stands in whole**, VU and peak from
  its own RMS, so the room has something to draw. The meter poll only runs
  while the engine's transport is going, though — so in practice the mixed
  picture is there when the two play together, which is what it is for.

**In the film** *(added later on 6 Sep 2026)* the sequencer is in the sound
as well as the picture. The film is rendered offline, so the sequencer
renders itself offline too, inside its frame: `renderFilm` in `bridge.js`
builds the sequencer's own graph with its own `initAudio` on an offline
context, lays its pattern on the shared grid from the film's first second,
applies its loaded take at every film frame — knobs interpolated, switches
thrown when the take threw them — schedules each frame's notes as the render
reaches it so they sound through the knobs as they then stand, and measures
its master with the same analysers the room uses live. The two things
`initAudio` wants that an offline context has not got — a context made by
name, and a media-stream tap for the page's recorder — are stood in for
while it runs; afterwards the page's own graph is built fresh and the knobs
are put back where they were. The export mixes the sound into the film's
track sample by sample, clipped at the rails, and the spectrum and figure
into every frame of the reel by the same two rules as live.

*(14 Sep 2026.)* A looped film or export goes round its loop: the render lays
the same steps again on every pass of the server's own loop and plays nothing
new through the tail. The take is read on the engine's clock from where it
began (`takeValuesAt`), and notes are laid two render quanta ahead of the frame
that reaches them, so none starts late. See `docs/COMPOSE.md`, "the sequencer
round the loop".

It is a switch on the export dialog — **Sequencer** — and it is only for a
film. It needs the Seq page to have been opened, because a frame that was
never loaded has nothing to render. An audio bounce is still the engine
alone; that render is the server's, and the browser is not in it.

## One output

*14 Sep 2026.* The two voices used to leave through two sound cards — the
engine's through its device, the sequencer's through the browser's — each
started when it got round to it, so they were close, never to the sample, and
never twice alike. Now the sequencer plays through the engine, and both leave
through the engine's device together. It is the setting **Play it through the
engine**, under *The sequencer* in Settings, on by default.

**The page does not play it.** When the engine's transport starts the
sequencer, `bridge.js` hangs a worklet on the sequencer's master, silences the
page's own output, and hands each block of samples to a worker, which stamps it
with the engine output frame it belongs at and posts it — `POST
/api/engine/seq?at=&epoch=`, little-endian floats, about every forty
milliseconds. The engine holds it (`engine::seqbus`) until its callback renders
that frame and adds it in: after the grain's own gain and before the ceiling,
the recorder and the meters. So GRAIN off still silences only the grain, and
what is recorded and drawn is both voices. The room is drawn from the engine's
feed as it is (`masterFeed`), rather than with a picture of the sequencer mixed
into it.

**The stamps come from the grid, so they are exact.** A step on boundary *k*
is laid at the context time the grid says is engine time *k* × the step, and a
sample the context renders at frame *x* is stamped *x* plus the grid's offset —
so a note lands on the frame of its step however late the context happened to
render it. While routed the grid is kept on whole frames, and a context at a
rate other than the engine's is built again at the engine's, so the two sides of
that sum never round apart.

**It runs ahead.** Its sound has to be made and posted before the engine
reaches it, so the host starts the sequencer where the engine is and the engine
a lead later — 120 ms after the sequencer says it is under way
(`SEQ_ROUTE_LEAD`), with the playhead held meanwhile. Joining an engine that is
already playing, the sequencer starts a lead ahead of it instead.

*Found on the speakers, 15 Sep 2026:* the first Play through a real device never
started the engine. The transport's poll saw the engine not yet playing during
the lead, took it for the sound having reached its end, and dropped back to the
cue — which, being a seek, began a new epoch the sequencer never heard, so the
engine refused everything it sent. Only an answer the poll asked for after the
engine had its Play can say it stopped now (`engine.toldAt`), which also closes
an older, narrower race: a poll already on its way when Play was pressed. The price: a
sequencer knob turned by hand is heard that much after it is turned, and its
steps light that much before they sound, so the lights are held back by it too.

**Epochs.** Every Play and every seek is a new epoch, told to the bridge and to
the engine (`seqEpoch` on `/api/engine/transport`). Sound from an older epoch is
refused, so a block still on its way from before a seek cannot land after it,
and a newer epoch drops what the engine holds. A stop is not an epoch: the
engine fades the sequencer out over ten milliseconds of what it already holds,
rather than cutting it mid-note.

**The loop.** The host tells the bridge the engine's loop, and the scheduler
wraps the grid itself at the loop's end (`wrapBefore`) — on the frame the engine
will wrap on, not a quarter of a second after being told it has. The stamps go
straight from the loop's end to its start, and the engine takes each frame off
its bus as it plays it, so a frame played again round a loop needs fresh sound
and can never play the pass before. Played through the browser, the sequencer
wraps the same way now.

**When it cannot.** No engine running, a rate the browser will not build a
context at, or a request the engine refuses: the page plays the sequencer
itself, its grid brought back from the lead to the engine, and the host is told
(`seq:route`). `/api/engine/seq` never opens the device (`live::peek`). `GET
/api/engine/grains` reports `seq: { active, epoch, mixed, missing, refused }` —
whether the sound is coming, and how much of it came in time.

Tests: `tests/ui/sequencer-route.spec.mjs`, run with Chromium's fake audio
output, since a headless page's context otherwise says it is running and never
renders — routed, every note is stamped within two frames of its step's engine
frame, in one unbroken run; round a loop the stamps go straight from the loop's
end to its start, and the notes after the wrap are the loop's; an engine that
refuses the sound leaves the page playing; a page that finds itself behind the
engine is laid a lead ahead again at the first clock; Play starts the sequencer first,
holds the playhead, and starts the engine a lead after with its epoch, and a
seek is a new epoch for both; a poll that finds the engine not yet playing does
not end that Play; routed, the room is drawn from the engine's feed
as it is. Unit tests: `engine::seqbus` — a frame is held until it is taken, and
taken once; a frame a ring away is another frame; an older epoch is refused and
a newer one drops what was held; sound behind the engine is refused; round a
loop, the next pass is ahead. `engine::transport` — the sequencer is added on
the output frames the engine renders; round a loop it wraps on the same frame
as the grain; GRAIN off silences only the grain; a stop fades it out; sound that
did not come is counted only while the bus is in use.

## What this is not, yet

A third and a fourth source, and the audio of all of them mixed for real
while playing. That should be built as one thing:

- **a source is a thing with a transport, a feed and a level**, and the engine,
  the sequencer and whatever comes next are three of them;
- **the live mix happens in the engine**, which means the browser's sound has
  to reach it — a loopback device, or the sequencer's stream handed over;
  *(the stream is handed over now — see "one output")*
- **a tempo the sources share**, so a fourth voice that has bars can line them
  up with the sequencer's. The position is already shared; the tempo is not.

## Where it lives

*One output (14 Sep 2026):* `core/crates/engine/src/seqbus.rs` — the bus;
`transport.rs` — `Shared::seq`, `Core::mix_seq` and the stop's fade;
`routes.rs` — `api_engine_seq`, `seqEpoch` on the transport, `seq` on the engine
poll; `ui/sequencer/bridge.js` — the grid (`layGrid`, `wrapBefore`), the tap and
the sender (`TAP_SOURCE`, `SEND_SOURCE`), `routeUp`, `routeDown`,
`routedClock`; `ui/sequencer/app.js` — the scheduler asks `wrapBefore` before
each step and holds a step's light back by `uiDelay`; `ui/app.js` —
`seqRouting`, `seqLoopSeconds`, `seqSync`'s pre-roll, `startPlayback`,
`seekSource`, `masterFeed`; `ui/settings.js` — `seqRoute`.

- `ui/sequencer/` — the vendored page and `bridge.js`.
- `ui/app.js` — `playsDocument` (Seq plays the document), `setMode` (the
  `seq` mode, `#seqView`), the `seq` block: `seqEnsureFrame`, `seqSync`,
  `seqClock`, `seqAsk`, `seqMix`, `seqMixSpectrum`, `seqMixLiss`,
  `seqRenderForFilm`, `seqInFilm`; `startPlayback` and `pausePlayback` call
  `seqSync`; `seekSource` calls `seqClock`.
- `ui/video-export.js` — the `sequencer` and `seqAt0` options: the render is
  asked for after the reel, mixed into the track, and into each frame.
- `ui/index.html` — the **Sequencer** switch on the export dialog (`#elSeq`).
- `ui/rail.js` — the Seq item and its icon.
- `ui/index.html` — `#seqView`; `ui/app.css` — `.seqview`, `.seq-frame`.
- `core/crates/server/src/routes.rs` — the six `SEQ_*` constants, their routes
  under `/sequencer/`, and their place in `ui_build_id`.
- `tests/ui/sequencer.spec.mjs` — served whole; on the rail; play and stop
  reach the frame and the feed comes back; the mix adds as power and clips;
  play lands on the engine's position and a seek moves it; the take rides
  along; a film render comes back with sound, spectrum and figure and the
  page keeps its context.

Embedded with `include_str!`. **Rebuild the binary after editing any of
them** or the browser is served the old file.

## The recorder arms, and the transport starts the take

The sequencer's REC PERF used to start its clock on the button, whatever the
transport was doing. It arms now (`perfArmed`), and the take begins when the
transport starts — the page's own Play, or the engine's through the bridge's
`playAt` — and ends when it stops (`stopSeq`, or a pause). `perfArmedBegin`
is the hook both Plays call; `perfRecStop` on an armed-but-unbegun recorder
just disarms.

## The SEQ switch

SEQ on the transport is whether the sequencer plays at all. Off, `seqSync`
tells it to stop whatever the engine does and stops clocking it, `seqMix`
leaves the engine's feed alone, and an export or a film leaves it out unless
the export dialog says otherwise for one export. Switching it on loads the
frame if it is not loaded. Kept in `audiolab.sources.v1`.

## The sequencer in a sound export

The plain Export renders on the server, which never hears the sequencer. So
once the file is written, the page renders the sequencer offline for the
export's length from where the export starts (`exportAddStem`, through the
same `seq:render` the film uses), and posts it as interleaved little-endian
f32 to `POST /api/export/stem`. The server reads the export back, sums the
stem in, and writes the file again — clamped at the rails and under the same
soft ceiling every export gets. Rendering after the export means nothing has
to predict how long a loop with a tail comes out. `GRAIN` off goes with it as
`grain=0`, which silences the export's own sound first, so an export of one
source is what it says. `mix_stem_into` is unit-tested in `routes.rs`.

## A take on the host's timeline

A take notes where on the engine's clock it began (`startAt`), replays relative
to it, and is sent to the host as lanes in engine seconds (`seq:take`) whenever
it changes. The host's REC PERF arms this recorder too (`seq:arm`). See
`docs/COMPOSE.md`, phase two.
