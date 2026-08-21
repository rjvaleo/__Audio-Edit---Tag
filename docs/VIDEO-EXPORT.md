# Exporting the room as a video

Written 18 Aug 2026, before the work, as the design being built to.

The master bus box, rendered to a video file with the sound it is drawn from.
The room only, no meter column. Any of the standard frame sizes. Either the
whole sound with its tail, or the loop a given number of times with its tail —
the same two choices the audio export already offers, because it is the same
render with a second destination.

## Most of this already exists

**The box you would open is on screen already.** `#exportLoop` has Repeats, a
Tail switch, `Whole file instead`, and `#elLength` reporting the length the
settings will produce. See `docs/EXPORT-LOOP.md`. Video does not need a second
dialog; it needs a second destination on this one.

**The audio render exists.** Loop x N plus tail already reaches a file, and the
stretched duration is already known — it is what `#elLength` prints.

**The analysis is not tied to playback.** `meter::master`, `meter::spectrum` and
`meter::lissajous` take plain sample slices. They are fed today from a live
scope snapshot, but nothing in them knows that. The same three functions can be
run over the rendered audio, block by block, at whatever rate the video wants.
This is what makes an offline render possible without a second analyser.

**4K needs no new drawing.** `visGlTick` reconciles the canvas's backing store
with its client size on every frame; the cap at 2x device pixels is a decision
about displays, not a limit. An offscreen 3840x2160 backing store is the same
code path.

**Dropping the meters is a class.** `.mb-side` hidden and the room takes the
frame, which is what full screen already demonstrates.

## What does not exist: an encoder

This is the decision the rest hangs on, and it is a real one here. The workspace
has **exactly two external crates** — `cpal` for the device and `tract-onnx` for
the classifier — and the interface has no build step. Nothing on either side of
the wire hands you an MP4.

**Offline and exact.** Rust renders the audio, then runs the same meter
functions over that exact audio at the frame rate and returns the series. The
interface replays it into `vis-gl` at the chosen size offscreen, takes each
frame, encodes it with WebCodecs — present in the browser, no library — and
muxes. Deterministic, frame-exact, any size, and it runs as fast as the machine
manages rather than in real time. The picture is the same picture, from the same
analyser, over the audio that is actually in the file.

The cost is a muxer written here. MP4 is a few hundred lines. This project
already wrote its own HTTP, its own JSON and its own WebGL, so that is in
character rather than heroic.

**Real time capture.** Play the exported audio in the interface, drive the box
from a WebAudio analyser, capture canvas and audio with `MediaRecorder`. Far
less code.

The cost is that it renders in real time — a 40x stretch of a three-minute file
is a two-hour render nobody can touch while it runs — and that the analysis
becomes a *second implementation*, which will drift from the Rust one. That
drift is the thing this codebase is most careful about: the grain views are
built from the same schedule the renderer works through, with `rand01` ported to
match the Rust exactly, so that a grain you see is a grain you hear. Introducing
a second opinion about what the sound looks like, in the artefact people would
actually publish, is the wrong place to start being approximate.

**Offline, then.** Real time is unusable at the ratios that make the visuals
worth filming in the first place.

## The sizes

| | | |
|---|---|---|
| 720p | 1280 x 720 | 16:9 |
| HD | 1920 x 1080 | 16:9 |
| 1440p | 2560 x 1440 | 16:9 |
| 4K UHD | 3840 x 2160 | 16:9 |
| Square | 1080 x 1080 | 1:1 |
| Square large | 2048 x 2048 | 1:1 |
| Portrait | 1080 x 1350 | 4:5 |
| Vertical | 1080 x 1920 | 9:16 |
| Vertical 4K | 2160 x 3840 | 9:16 |

## Aspect is not a canvas size, it is a camera

The room is built from a frustum whose **height is fixed and whose width is the
aspect**:

```js
const yb = VG_FLOOR_Y, yt = VG_CEIL_Y;      // -0.38 and 0.62, always
const halfW = (yt - yb) * 0.5 * aspect;     // the width follows the frame
```

One world unit is the same number of pixels across as it is up, at any aspect,
which is why the sky ring stays round rather than becoming an ellipse in a tall
frame — its radius is taken from the height, `(yt - yb) * 0.17`, and never from
the width.

But the floor spans the width, and the width is the thing that changes. A
vertical frame does not give the room more height; it gives it less width, and
the fixed-size ring then occupies most of it:

| frame | aspect | room width | ring across the room |
|---|---|---|---|
| 4K UHD, HD | 1.778 | 1.778 | 19.1% |
| Square | 1.000 | 1.000 | 34.0% |
| Portrait 4:5 | 0.800 | 0.800 | 42.5% |
| Vertical 9:16 | 0.562 | 0.562 | 60.4% |

At 16:9 the ring is a fifth of the room and the spectrum has somewhere to run.
At 9:16 the ring is nearly two thirds of it and the terrain is a strip. That is
not a rendering fault, it is the composition being asked a question it was never
asked before: the box was framed for a wide panel, and every constant in it was
chosen against that.

Vertical therefore needs a camera of its own, not just a canvas of its own. The
material is there — depth is the axis with room to spare, and `VG_DEPTH` at 1.9
draws the back face at 34.5% of the front. A tall frame should be spending its
pixels on **more room going back**, with the floor tilted further toward the
viewer, rather than on the same wide composition squeezed. The likely shape is a
per-aspect set of `VG_DEPTH`, `VG_FLOOR_Y`, `VG_CEIL_Y` and the ring radius,
chosen so that the three things in the room hold their relative weight instead
of holding their absolute size.

Square sits in between and probably survives with the numbers it has. It should
be looked at before it is promised.

## Two tails, and the video outlives both

The audio tail is the one `docs/EXPORT-LOOP.md` already builds: after the last
repeat the rack goes on sounding, and those samples are kept instead of being
truncated. It is part of the audio, so the picture covers it the way it covers
everything else.

There is a second one, and it is the room's rather than the rack's. The floor
holds `VG_HISTORY` frames of spectrum — 56 of them, pushed at `MB_POLL_MS` of
50 ms — so **2.8 seconds** of sound are on their way to the back wall at any
moment. When the audio stops, that terrain is still travelling. Cut the video on
the last sample and the room is chopped mid-journey with the last ridges hanging
in the middle of it.

So the video runs past the audio, and keeps running until the room has emptied:
the last spectrum frame reaching the back wall, 2.8 seconds after the final
sample. Silence on the audio track, a room draining on the video track. That is
what a tail is.

**The audio track runs the whole way, and the outro is silence in it.** Not a
short audio stream against a long video one — actual samples, all zero, to the
last video frame. A file whose streams end at different times is a file that
some players stop early, some pad themselves, and some report a duration for
that does not match what they then play; and the muxer has to declare the
mismatch deliberately rather than trip over it. Writing the silence costs 2.8
seconds of zeroes and removes the whole class of problem. The two streams are
the same length and the file says one duration.

So the audio is: the sound, then the rack's tail sounding out, then digital
silence while the room finishes draining.

The other thing to keep straight is that the outro's length is derived rather
than chosen. It is `VG_HISTORY` divided by the poll rate — 56 frames at 50 ms —
and if either constant moves the outro has to move with it. Compute it from the
pair. Do not write down 2.8.

## Decided

- **MP4, H.264.** The container that plays everywhere, and the muxer written
  here.
- **Frame rate is a choice of 30 or 60**, beside the size in the same box.
- **The video runs past the sound**, and the audio track is padded with silence
  to meet it, so both streams end together.
- **Vertical's camera is not being designed here.** The finding above stands —
  a tall frame is a narrower room and the ring keeps its size while the room
  loses its width — but what to do about it is coming from elsewhere.

## Still open

- Nothing blocking. The size list, the container, the rate and the two tails are
  settled; the remaining unknowns are the ordinary ones that turn up while
  writing a muxer.

---

# Built, 19 Aug 2026

To the design above. What it is made of, and the two things that were wrong
first.

## The parts

- **`core/crates/server/src/video.rs`** — the reel. `meter::spectrum` and
  `meter::lissajous` run over the rendered samples at the room's own rate, with
  the outro appended as silence. Five tests.
- **`POST /api/video`** — renders through *the very same `run_export`* the audio
  export uses, into a scratch file that is read back and deleted. Rendering it
  twice by two routes would be two things to keep in step.
- **`GET /api/video/frames`** and **`/api/video/audio`** — raw little-endian
  `f32`, because a three-minute file at the poll rate is millions of numbers and
  as JSON that is hundreds of megabytes of decimal digits to print and parse.
  What reads them wants typed arrays at the other end anyway.
- **`ui/mp4.js`** — the muxer. Fragmented MP4.
- **`ui/video-export.js`** — replays the reel into a `vis-gl` of its own at the
  chosen size, encodes with `VideoEncoder`/`AudioEncoder`, muxes, saves.
- The **export dialog** gained a size, a rate and a second button. Everything
  about *what* to render — the loop, the repeats, the tail — was already on it
  and already meant the same thing.

## The room's clock is not the video's clock

The terrain is pushed at `MB_POLL_MS` and travels at `MB_POLL_MS`. Push it once
per *video* frame instead and the room drains two or three times too fast: the
same picture, played wrong. So the reel is analysed at the poll rate, and a
video frame pushes only when it has crossed into the next one. Which also means
the analysis is a third of the work it would otherwise be at 60fps.

## Two things that were wrong first

**A signed shift.** `48000 << 16` is −1,149,239,296, because a bitwise shift in
JavaScript converts to a 32-bit *signed* integer first. The audio sample entry
is 16.16 fixed point, so that is exactly where a sample rate goes. The file that
came out had a correct box at every level with sane lengths — it parsed
perfectly — and no decoder would open it. `Mp4Writer` shifts unsigned now and
has a `fixed()` that never goes near a shift.

**Checking the wrong thing.** The first check was a box-tree walk: every box
parsed, every length added up, nothing trailing. It passed on the broken file.
A muxer is only correct if a *decoder* opens what it wrote, so the test loads
the blob into a `<video>` element and reads back the duration and the
dimensions. That is the assertion; the box walk was a way of feeling good.

## Known, and not yet done

- **The grain cloud is not in the video.** The room draws it from the schedule
  around the playhead, which the offline path does not fetch. The terrain, the
  ring, the skin and the box are all there.
- **Vertical still has the composition problem** written down above. It renders;
  it renders a narrow room with a ring most of the way across it. The camera it
  wants is not designed yet.

## The film has to be the room, not *a* room

It is drawn by a second `vis-gl` on a canvas of its own, and **every way that
canvas differs from the one on screen is a way the film comes out looking like
something else**. Three did, and all three were reported as "it does not look
like the app" rather than as three separate faults, which is what that class of
bug looks like from outside.

- **Nothing behind it.** The room clears to transparent and the page shows
  through — `--bg`, and in fullscreen the panel paints it explicitly for exactly
  this reason. An offscreen canvas has nothing behind it at all, and H.264 has no
  alpha, so what was a room on the theme's near-black became a room composited
  against whatever the encoder assumed. The frame that gets encoded is now the
  room drawn onto an opaque ground.

- **No schedule, so no cloud.** The grain layer spawns from `f.grains`, which the
  offline path never fetched. The terrain, the ring and the skin were all there,
  which is what made it look like a colour problem rather than a missing layer.

- **One clock where there are two.** A grain's `e[0]` counts document frames at
  the *document's* sample rate; `position` counts rendered frames at the
  *rendered* rate. The room is given both, exactly as the live one is. Handing it
  one for both puts every grain at the wrong moment on any file whose rate is not
  the device's — and correctly, invisibly, on any file where they happen to
  match.

The lesson worth keeping: the live call site is the specification. Anything the
room is given there and not here is a difference, whether or not it is obvious
what it does.

## A loop is filmed as a loop

The audio for a looped export is the loop tiled, so the same stretch of schedule
sounds again each time round. A playhead that ran straight past the end would
leave the room empty for every repeat after the first, so the position is
wrapped into the loop's range — in *output* frames, which is the loop mapped
through the stretch ratio. Past the last repeat it holds at the end, because what
is sounding there is the rack's tail rather than more schedule.

## What the range control is for

`exportBtn` only opens the box when the loop is on — with it off, the audio
export is the one that was always here, no box and no questions, and that is
worth keeping. It left the video unreachable in exactly the case where somebody
has no loop set and wants to film the whole thing, so the video has a button of
its own that always opens the box, and a Selection / Whole file choice inside it.

Its own choice rather than being read off the loop, because they are different
questions: a video of the whole file is an ordinary thing to want while a loop
happens to be set.

## The cloud is asked for in windows

**The cap on a schedule request is spent inside the range asked for.** Ask for
the whole document and eight thousand grains are spread across the entire file,
so any one instant holds almost none — which in the room reads as a cloud that
is not there, and made a film of a dense granular passage look nothing like the
passage.

The live room asks for a few seconds either side of the playhead and gets eight
thousand *there*. So does the film, refetching as the playhead leaves what it
has — before the edge rather than at it, so a grain about to be crossed is
already in hand. A loop asks for the place *in the loop* rather than how far
into the film it is.

This is the third time the same shape of fault has turned up in this feature:
the film is drawn by a second room, and every way that room is fed differently
from the one on screen is a way the film comes out looking like something else.
The live call site is the specification.

## Occlusion in the film, and how it was checked

Reported as not working. It was: measured through the export path, the terrain
occluding from the top of the list took a tenth of the light out of the encoded
frames, and from the bottom of the list took none — which is exactly right,
since nothing is drawn after it.

Worth writing down because "it does not look right" and "that control does
nothing" are the same sentence from outside, and the answer was neither. What
was actually wrong was the cloud, above.

## The film runs on its own clock

Everything in the room that moves by itself — a grain ageing towards the back
wall, the fog drifting — was measured against `performance.now()`. That is right
for a room being watched and wrong for one being filmed: an offline render goes
as fast as the machine manages, so the gap between one frame and the next is
however long the *last* one took to encode. A frame that took fifty milliseconds
aged the cloud by fifty and the next one by five, and what that looks like in the
finished file is a single lurch — reported as "a single frame stutter when
rendering at 30 fps and full resolution".

A caller that knows what time its frame is at now says so, and gets a room that
moves by the film's clock. A caller that says nothing gets the wall clock,
unchanged.

The test renders the same ninety frames twice, once with a hundred and twenty
milliseconds of deliberate stall in the middle:

| | frames changed by the stall |
|---|---|
| wall clock | 87 of 90 |
| film clock | **0 of 90** |

Which also means a render is now reproducible: the same document filmed twice is
the same file, whatever else the machine was doing.

### It cost two goes to measure

The first attempt compared how *evenly* the picture moved and reported the fixed
version as worse, because the two runs had different typical step sizes and the
ratio between worst and typical is not a measure of anything. The second
compared the two films frame for frame — the right question — and still found
every frame different, because `grainLive` and `grainClock` are held between
frames on purpose and the previous run's cloud was still in the air. `clear()`
exists for that. Only then did the number go to zero.

## The bar during the render, and the camera it films with

Added 20 Aug 2026, after both were reported.

### The render reported nothing

Filming is preceded by a render of the sound, and that render is the same one an
audio export makes, through the same `run_export`. It reports itself into
`app.export` — and `/api/video` was reading the *video* job, which has nothing
to say until the analysis starts.

So the first phase named itself correctly and sat at `done: 0` of a `total: 1`
for its entire length. On a short file that is invisible. On a forty-times
stretch it is minutes of a bar that does not move, and it reads as a hang —
which is exactly how it was reported.

The status route now reads the export's numbers while that phase is running, and
carries a `stage` field for what the render is doing *inside* itself: reading,
stretching, writing. Those three cost wildly different amounts per frame, so a
bar with no account of which one it is in moves in unexplained lurches.

Measured on a 30× stretch: sixty-seven samples across the phase, `stage` moving
`stretching → writing`, and the fraction climbing 0.02 → 0.94. Every one of
those samples used to read zero.

**A test for this needs a long render.** Two attempts did not have one. The
first drove the whole export on the test library's short file, whose render
finishes inside a single 200 ms poll — its very first report was already
`Analysing`, and that was read as the render being silent. The second stretched
it but took whichever file came first alphabetically, which in that library is a
tenth of a second. It takes the longest file there is at the maximum ratio.

### The camera was the one on screen

`docs/ROOM-EDITOR.md` says what the per-frame cameras are for:

> *Each frame keeps its own camera. That is what the video export reads when a
> size is chosen, so picking Vertical in the export box gets the camera that was
> designed for vertical rather than the wide one squeezed.*

That was the intent and not the behaviour. The export passed
`roomCameraDrawn()`, which reads `roomEdit.frame` — whatever the view happens to
be showing. Posing the room for 9:16 and then exporting HD filmed the portrait
camera into a landscape frame.

`roomCameraForAspect` matches by shape rather than by name, because the export
box offers nine sizes against five cameras — 720p, HD, 1440p and 4K are all 16:9
and all want the camera posed for 16:9.

A shape nobody has posed falls back to the camera being looked at rather than to
the shipped default: the rule is *use the camera meant for this shape*, and when
there is no such camera, the one in front of you is at least a pose somebody
chose.

## What the film still does not have

**The data block is not in it.** The schedule printed on the back wall is HTML
positioned behind the canvas — the room is drawn on glass over it — and the
export draws only the GL canvas onto a flat ground. So a layer that can be
switched on in the view is absent from the file.

It is not a line of plumbing. `roomBackWall` works from `roomCamNow()` and
`paintRoomData` writes DOM from live state, so filming it means parameterising
both on a camera and an offline schedule, then drawing the lines with the 2D
context at the export's own scale with the wall's five fade steps. That is its
own piece of work and it has not been done.

