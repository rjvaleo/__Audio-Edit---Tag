# HyperStretch

*4 November 2026.* Hyperprism's XY pad rebuilt from its code, playing the granular engine's own Stretch and Pitch.

**Where it is:**
- Opened from the rail as **Prism**. Like the Chop page, the Prism page is the Grain dock with one panel out, its **Prism** tab.
- The panel: `ui/app/385-hyperstretch.js`.
- The glide: `core/crates/engine/src/glide.rs`.

It is a separate thing from the Prism tab's pad in [HYPERPRISM.md](HYPERPRISM.md), which drives rack slots through automation lanes.

## Where the behaviour comes from

Hyperprism-PPC 1.2.1 was decompiled with Ghidra:
- Every function was named from its PowerPC traceback table: 2,059 of them.
- Constants were read from the unpacked PEF data section.
- Layouts, icons and cursors were read from the resource fork.
- The copy-protection routines were not read.

| Code | What it gave |
|---|---|
| `LControlPane::TrackHotSpot`, `HotSpotAction`, `AddPoint` | the drag, the Shift lock, the take |
| `RequestRecord`, `StartRecording`, `Stop`, `Pause` | grabbing is the record button; the four states |
| `SpendTime`, `GetNextParameters` | stepped playback, looping at the take's length |
| `CProcessController::ListenToMessage`, `SetValue` | the linear mapping |
| `SetTopMin` and friends, `ScaleHorizontal` | limits rescale the take |
| `NudgeCurrentPoint`, `HandleKeyPress` | arrows draw while recording |
| `CEffect::UpdateSmoothing`, `GetAdditionalSettings`, `EPitchShift::Initialize`, `PitchShift2` | the smoothing |
| PPob 999 and 8017; `cicn` 1100/1101; `crsr` 10000/10001 | the pad's 461 × 241, its corners, its marker |

## Exact to the original

### The pad

- **Size and layout:** 461 × 241. X low and high sit at the ends of the top bar; Y high and low at the top and bottom of the left bar.
- **Mapping:** linear.
  - `X = xLo + x·(xHi − xLo)`
  - `Y = yLo + (1 − y)·(yHi − yLo)`
  - x and y are fractions of the pad, y measured from the top.
- **Default limits:** the Pitch Time Changer's direction, Stretch ×4 at the left to ×0.25 at the right, and Pitch −12 to +12 st.

### Takes

- **Grabbing is the record button.** The clicked point takes effect at once. The transport plays while you draw, as Hyperprism's Record lit Play.
- **A take runs until Stop or Play,** not until the hand lets go.
- **Points:** at most one per tick (1/60.15 s), on the tick grid, drawn as a blue line.
- **Playback is stepped,** never between points. A take always loops at its own length, whatever the file's length.
- **Pause** keeps its place. **Rewind** goes back to the first point.

### Moving the point

- **Shift** locks a drag. The first move after Shift goes down decides: horizontal, vertical, or a 45° diagonal.
- **Arrow keys** move the point 1 px while recording, 10 px with Option. Each press is a point.
- **A new limit** rescales the takes so every point keeps its value: `x′ = (xLo − xLo′ + x·(xHi − xLo)) / (xHi′ − xLo′)`.

### Display

- **The readout** shows both values under the hand while moving. On hover, before anything is touched, it shows the values under the pointer.
- **The marker** is a yellow ball on a black crosshair, orange-red while recording.

### Glide

- **The formula:** Smoothing `s` gives `a = int(10^(0.04·(100 − s))) · 0.0001`. At each step, `now = a·target + (1 − a)·now`.
- **The step** is every 512 samples at 44.1 kHz, scaled with the sample rate. The first step comes on the first sample.

  | Smoothing | a | Catch-up |
  |---|---|---|
  | 0 % | 1 | instant |
  | 50 % (default) | 0.01 | about 1.16 s to 63 % |

- **Only while HyperStretch is out.** The engine glides Stretch and Pitch while the Prism page is open, at the panel's Smoothing. Leaving the page sends 0, so every other control keeps working as it always has.
- **The document isn't glided.** Its values are untouched; only what plays glides.
- **Applied per block,** at the block's start.

### The Pitch Time Changer

The engine's Pitch Time Changer now smooths Speed and Pitch separately, by its own Smoothing (`ptc_glided`), as the original did. The file reader takes the smoothed Speed, and the shifter corrects by the smoothed Pitch over it.

Before, the shifter was handed the ratio and smoothed that, while Speed jumped at once. A Speed move then made the pitch swoop the wrong way. The live and export paths use the same function, so an export is still what was heard.

## New, and off until chosen

- **Four takes (A–D),** each looping at its own length.
- **Take rate** ×½, ×1 or ×2, and **direction** forwards, backwards or back and forth.
- **Throw:** let go mid-move and the point keeps drifting, bouncing off the walls.
- **Loop on release:** Hyperprism records until Stop. This starts the loop when the hand lets go instead.
- **Drawn shapes:** Circle, Figure 8, Lissajous and Drift, 4 s each, into the current take.
- **Other axes:** Window and Cloud can go on either axis. They move by the panel's own live path, without the glide.

Takes, limits and axes are kept per sound, in the browser.

## Routes

| Route | |
|---|---|
| `POST /api/engine/glide` | `{smoothing}`. Never opens the device. |
| `POST /api/engine/pad` | `{ratio?, semitones?}`. Straight into what the engine plays, not into the document. A take's steps use it, at most one request in flight; the document is committed when a drag or a take ends. |

## Not yet exact

- **The Pitch Time Changer's ratio is still held to 0–200 %.** That is the shifter's range as a rack effect. The original drove the same shifter at Pitch ÷ Speed with no limit, so Pitch 200 % at Speed 1 % is a ratio of 200. Fixing it needs a ratio entry on `hp-pitch-shifter` in prism-fx.
- **Takes are not in an export.** Hyperprism rendered its paths offline (`GetNextParameters`). Here a take is live only, until it can be written into the stretch automation lanes.
- **The glide steps once per block,** not every 512 samples within a block. A block is the engine's 256–1024 frames.
- **Not carried over:** the Path Edit Table, Path Info (name, comments), and undo of a take.
