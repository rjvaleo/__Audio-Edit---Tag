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
alone; that render is the server's, and the browser is not in it. *(Since
14 Sep 2026 the switch puts it in a sound export too; see "The sequencer in a
sound export". Its tooltip still says "Only for a film".)*

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
an older, narrower race: a poll already on its way when Play was pressed.

The same first run through the speakers showed three more things, fixed:

- **The end of the sound did not stop the sequencer.** The engine stopping
  itself at the end ran a shorter stop than the Stop button's, and left the
  sequencer playing — through the engine, which refused it all, or through the
  browser before routing existed — with the picture's lanes and a take running
  on. It stops everything a stop stops now.
- **The first tenth of a second was missing.** A sender just started took
  longer than the lead to post anything. The bridge tells the host it is routed
  once the engine has taken the first of the sound (`flowing`), not when the tap
  is up, and the lead is counted from there.
- **A busy page laid the grid again for nothing.** The clock was read when the
  host sent it and compared when the page got to it, and the time between looked
  like drift. The clock carries when it was read (`sentAt`) now, and the grid is
  laid again only when two readings in a row say so. The bridge counts what it
  does — `routeState()` reports the jumps, the lead it kept, and its posts'
  count, slowest time and failures.
- **Every Play left a tap running.** A tap was made on the sequencer's master
  for every Play, and one taken off by a stop went on running, posting silence
  stamped with the frames the live one was sending: the sequencer came and went,
  and after a few plays the engine was sent several times what it could use.
  There is one tap for the life of a context now, switched on and off, and the
  sender hears only the newest.
- **The first step could be lost.** The sequencer was started from the
  playhead carried forward on the milliseconds since Play was pressed, so it
  began just past where the engine was, and a note on the very first frame never
  sounded. Started with the engine, it starts exactly where the engine is.
- **A second window locked the first out.** Epochs were counted from nought in
  each window, so the window used longer held the higher number and the engine
  refused the other's sound as stale. They are the wall clock's now
  (`seqNextEpoch`), so windows agree which spoke last. Two windows on one engine
  still take the transport from each other, as they always have. The price: a
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
- `ui/index.html` — `#seqView`; `ui/app-css/` — `.seqview`, `.seq-frame`.
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
frame if it is not loaded. It lasts the session: every load starts with
GRAIN and SEQ both on, because a source left off from an earlier session is
an app that plays nothing with nothing on screen to say why.

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

## The second synth: Atmosphere

*13 Nov 2026.* RJ: "Make the synthesizer better with more atmosphere … add more
controls, add some types of oscillators, be innovative … so I have two synths.
We'll be able to switch between them, and they do the full scale sequencing with
true tone, true pitch."

**Ours, not the sequencer repository's.** `ui/sequencer/atmos.js` is the second
file here that is ours (after `bridge.js`), served at `/sequencer/atmos.js`. It
touches the vendored files in a few marked places: `initAudio` calls
`atmosInit` last; `playNote` hands the note to `atmosPlay` while Atmosphere is
on, and its filter envelope became `noteFilterEnv`, shared by both synths;
`getLFOTargetParam` and `getLFOGainValue` ask `atmos.js` about targets they do
not know; the preset, morph and Performance lists take its controls. Taking a
newer sequencer now means carrying those over too.

**Two synths, both at once** (14 Nov, RJ: "make the atmosphere a second synth
so that I could run them both at the same time"). Each has a power button on its
panel, CLASSIC and ATMOSPHERE; with both on, every note plays both, and the one
left on cannot be turned off. One hidden select, `atModeSelect` (`classic`,
`atmos`, `both`), carries it, so presets, morphs and the recorder keep it. Classic
alone is the default, and nothing of Atmosphere runs then; Atmosphere's panels
fold away while it is off. A starting sound turns Atmosphere on and leaves Classic
as it was. Root, octave, the filter, the LFOs, the delay, Space and the steps are
shared; the filter's envelope runs for the longer of the two notes.

**True pitch.** Every frequency is the one `getFreqForDegree` gives `playNote`,
from the scale's cents, times a ratio the voice chooses; nothing is rounded to
12-TET. Tested to a quarter of a cent on a Pythagorean degree.

**Two oscillators, A and B, blended, each one of eight kinds:**

| Kind | What it is | Its three knobs |
|---|---|---|
| Classic | the plain waves, with unison | Wave |
| Supersaw | at least five detuned saws, spread | Spread |
| Scale spectrum | additive; its partials move onto the scale's own intervals | Fit, Bright, Partials |
| Choir | stacked saws with vibrato through three vowel formants | Vowel (ah eh ee oh oo), Voices, Breath |
| Glass | modal: a strike and a bow of noise through six tuned resonators | Material (string → bar → bell), Ring, Strike |
| Breath | noise tuned to the note and its octave | Focus, Grit |
| Cloud | two random-phase waves a little apart, slowly trading places | Smear, Motion, Partials |
| Endless | a Shepard stack of octaves under a bell, gliding by Rise | Rise, Spread |

**Scale spectrum** is after Sethares, *Tuning, Timbre, Spectrum, Scale*: a
sound's partials decide which intervals sound consonant, so a timbre whose
partials sit on the scale's intervals makes that scale, maqam, just or
microtonal, sound in tune with itself. Fit 0 is the harmonic series; Fit 100 %
moves each harmonic to the nearest interval the scale has, in any octave. On
Major Pentatonic the 7th harmonic (3369¢) moves to 3300¢: the test measures 69¢.

**The voice.** Blend (equal power); Unison 1–9, Detune, Width, Drift (a slow
wander shared by the note's oscillators); Sub (a sine an octave down); Air
(noise above 3 kHz); **Hold**, how long a note rings as a share of its step,
¼× to 4×, so notes overlap into a pad; Glide. The amp envelope runs to 10 s
attack and 20 s release. At most 16 notes sound at once; past that the oldest
fades in 30 ms.

**After the voice.** Character: Warmth (a tanh shaper), Tape wow (a swept
delay with flutter), Ensemble (three swept delays, left, centre, right).
Sympathy: up to 24 resonators tuned to the scale's degrees (or root and fifth,
or root) over three octaves, ringing along with whatever plays.

**Space, for both synths.** The vendored cathedral reverb in `initAudio` is
commented out by its author ("DISABLED — TODO: revisit gain staging and
re-enable"), so the sequencer had no reverb. Space is a new one in `atmos.js`:
a convolver on a generated impulse response (noise under an exponential decay,
Size 0.4–15 s, the channels as far apart as Spread says), each channel scaled
to unit energy so the level does not change with Size; then Damp, a limiter
and Shimmer (two slow chorus lines). Wet starts at 0, so Classic sounds as it
did until it is turned up. **Freeze** closes the input and lets the tail into a
loop of a delay and four allpass filters with feedback 0.96: it holds the
sound and fades about half a decibel a second, and cannot grow. (A lowpass's
Q in Web Audio is in decibels: the loop's is −3 dB, flat. At +0.5 it grew.)

**Atmosphere**, the big knob, moves Width, Drift, Hold, Air, Ensemble, and
Space's Wet, Size and Shimmer together. **Start from** sets everything: Glass
choir, Cathedral air, Scale bells, Dark drone, Endless rise, and Plain, which
is Classic. Six LFO targets reach the voice through buses every note listens
to: AT DETUNE, AT PAN, AT AIR, AT BLEND, AT VOWEL, AT FIT. A bus is joined to a
note's nodes only while it sounds (`atLink`, `atCleanup`): joined for good, it
would keep every finished note alive.

The make-up gain of each kind (`AT_LEVEL`) was set from offline renders, so
switching kinds keeps the level within 6 dB of Classic; the test holds it there.
Tests: `tests/ui/sequencer-atmos.spec.mjs`.

## The page in the app's look

*14 Nov 2026.* The approved mock-ups `seq.html` (the page) and `seq-voice.html`
(Atmosphere), in `WORK DIR/page-mockups`. Everything is where it was and works as
it did; the materials are the app's: panels, wells, the knob with its picture,
the segmented switches, Inter and JetBrains Mono. Violet is pitch (the degrees,
Hz, the lit keys), orange is on or playing, each knob has its family's colour.

- `index.html` was rebuilt into panels around the same controls, ids and
  handlers. Root and octave moved into the tuning panel, since both synths use
  them; the tuning panel gained a ruler of where the degrees fall against 12-TET.
- `style.css` is new: the app's tokens, with the sequencer's old names
  (`--accent` …) pointed at them for the few colours its scripts write inline.
- `look.js` (ours, `/sequencer/look.js`) copies the app's theme onto the page,
  from the parent, and again when the theme changes; draws each knob's picture;
  turns `select[data-seg]` into segmented switches.
- Canvases take their colours from `SEQ_INK` / `seqInk()` (app.js), which
  `look.js` fills from the theme; `performance.js` draws with them too.
- A knob's arc is drawn by the stylesheet from `--kt` (0–1), which
  `updateKnobVisual` sets; `--rot` still turns its pointer.

## 64 steps

*14 Nov 2026.* RJ: "make it 64 notes". `steps` holds 64 (`SEQ_MAX_STEPS`), in
four rows of 16; the Steps knob says how many play. A step card shows its
degree, octave and Hz; clicking it picks it, and its buttons (◀ ▶ degree, ▼ ▲
octave, RST, ▶) open under it. The arrow keys edit the picked step, R rests it,
Enter plays it, Escape lets it go; they call the window's `stepDegChange`,
`stepOctChange` and `toggleRest`, which the Performance recorder wraps, so a
take hears the keys too. **Copy row 1 to all** and **Clear** are in the
panel's header. A preset saved with 16 steps fills the first row and leaves
the rest as they were. In the compact layout only the steps that play show.

## The Journey

*14 Nov 2026.* RJ: "it can go off on a little journey". The plan is
`WORK DIR/page-mockups/SEQ-JOURNEY-PLAN.md` §2; the mock-up `seq-journey.html`.
`ui/sequencer/journey.js` (ours, `/sequencer/journey.js`).

- **A trip is a list of moves planned from the seed** (`journeyPlan`): a
  step's degree up or down by up to Wander, its octave, a rest, a double or a
  tie (Rhythm), the root by a step or to the fifth, the scale to another in its
  family with as many degrees, the direction. Each pass of the pattern adds
  about Each pass of them on the way up.
- **The curve says how many are in force**: the first N, so moves pile up as it
  rises and come off in reverse as it falls. Its points sit at the ends of
  Intro, Build and Peak (dragged on the canvas, kept in `jC1`–`jC3`); with Come
  home the end is 0 and the trip ends on the pattern as written; without it the
  end is `jC4`, and the next trip starts from home.
- **Where it is comes from the step boundary**, `seqStepCount` (app.js), counted
  from Play, or set with the step by bridge.js in the app; the trip is
  `Length` bars of four beats. Nothing depends on when a note happened to be
  played, so a seek lands where the trip would be and the film and the sound
  export (bridge.js, offline) render the trip that was heard.
- Every step plays through `seqPlayAt` (app.js), from the scheduler and from
  the film's render: the note, held 2 steps when tied, and a second note half a
  step later when doubled. `playNote` takes how long to hold.
- Steps the trip has moved are underlined; their title says where to.
  **Re-roll** is a new seed; **Keep this** writes where the trip has got to into
  the steps (and the family's scale, if it moved there) and turns the Journey
  off. Presets keep it all, the seed included; morphs and the recorder take its
  knobs and switches.

## The scopes

*14 Nov 2026.* RJ: "I want to see each individual oscillator's waveform and then
the combined waveform for the output." `ui/sequencer/scopes.js` (ours): an
AnalyserNode each for Classic (its voice, after the envelope), Atmosphere's A
and B (each before the blend meets the envelope) and the output (`masterGain`,
both synths after the filter, delay and Space). Notes reach them through an
extra connection out of their nodes (`scopeTap`), never into them, so no
finished note is kept alive; the scopes run into a silent gain so the context
keeps pulling them. Each frame draws three periods of the note last played from
a rising zero crossing, scaled to fill its well. Silent, a scope keeps what it
last showed, dimmed ("last heard"); before anything has played, Classic's and
the simple kinds' show the shape they are set to ("as set").
