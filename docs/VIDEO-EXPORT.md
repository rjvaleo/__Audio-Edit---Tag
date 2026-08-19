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
