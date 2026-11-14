# HyperStretch

*4 November 2026.* Hyperprism's XY pad rebuilt from its code, playing the granular engine's own Stretch and Pitch.

**Where it is:**
- Opened from the rail as **Prism**. Since 5 November 2026 it is one panel with the Prism tab's rack pad (RJ: "Merge the HyperStretch and Rack Pad together, use all of the functionality from both, the look of the HyperStretch and the box size from Rack Pad"). The switch between the two, and the rack pad's own panel, are gone.
- The panel: `ui/app/385-hyperstretch.js`. What it drives, and how: `ui/prism-pad.js`, whose functions fill the panel's menus, limits, settings, presets and faders by the rack pad's own ids.
- The glide: `core/crates/engine/src/glide.rs`.

## The page

*Rebuilt 13 November 2026 from the mock-up RJ approved (`WORK DIR/page-mockups/hyperprism.html`).* The pad is the page; everything else sits in the app's own panels and wells, with the shared controls, as on Grain and Chop. The look is the shared look's (`--look-*`), so a theme reaches it, and orange (`--on`) means on.

The open document's green wave, spectrogram, ruler and edit furniture are not on this page: Prism plays its own sound (the Prism deck), so they never showed what it plays. The Now Playing bar stays, and is Prism's here ([EDIT-PAGE.md](EDIT-PAGE.md)).

Top to bottom:

- **SOURCE:** the whole of Prism's sound, 58 px high, in its own colours (low violet, mid mint, high white, as the Edit page, Grain and Chop colour theirs: `edColourAt`, the sound measured by `edLoadSound`). Plain until it is measured. The playhead runs over it, and a click or a drag seeks the deck, as the bar's strip does. Its line says the file, format, rate, bits, channels and length; **Edit** opens the sound on the Edit page.
- **The PRISM row:** the process (Time & Pitch, the Pitch Time Changer, or any slot of Prism's chain), the two axes, the take's transport (● ▶ ❚❚ ■ ⏮), the chip (READY, REC, PLAY), and the shared preset bar for the process. **Loop | Lanes** and LOOP are kept, unlisted (`HS_LANES_LISTED`).
- **The Sound row:** the folder and the sound, a mini overview, and the chain's chips with **+ add effect**.
- **The pad:** fills everything left of the panels, at any window size: the window's width and height go to it, and the panels keep theirs. Not square: the drawing is in pad pixels across and down, so the Shift lock's diagonal is 45° on screen and an arrow moves 1 px. The limits are typed into its corners (Y high top left, Y low bottom left, X low beside it, X high bottom right), with their units; the axes are named along its bottom and left edges. Its head says the take and where the engine is now.
- **Controls:** every setting of the process as the shared knob (`uiKnobParam`, at 26) with its picture beside it, tinted by the grain facet it belongs to (`PRISM_PIC.facetOf`, `--look-f-*`). The pad's two come first, marked X and Y. Each knob turns the same range input the bar did (`prismKnob`), at the same steps and on the same curve, so every value lands where it did. Time & Pitch's Window and Cloud, the Pitch Time Changer's Feedback, Grain Size, X-Fade Size and Smoothing, and for a slot every parameter in its own groups, "Added (not in the original)" among them. The PTC switch is in its head.
- **LFOs:** four, each with its shape, a scope in a well, Rate and Depth (and Width for a pulse) as knobs, and Map in the head. A mapped knob shows the LFO's reach round its ring and a dot where the sound is.
- **Takes:** A–D as wells, each drawn with its take; rate and direction as shared switches; Glide, Playback Speed and Post-roll as shared bars; Throw and Loop on release; the shapes as a switch, lit for the shape the take was drawn from.
- **Output:** Hyperprism's L, LR and R faders, upright in wells, filled from their middle (0 dB); each one's name is its 0 button.

What the pad drives, and how, is `ui/prism-pad.js`; the panel is `ui/app/385-hyperstretch.js`, its pieces `386`–`388b`.

**Where a take goes:**

- **Loop**, HyperStretch's: grab to record, stepped, looping at its own length. Live only.
- **Lanes**, the rack pad's: ● arms the recorder and plays; the pad's two controls become two automation lanes in the document, which LOOP wraps together and the export plays. The pad shows the take and rides along it as it plays. Unlisted while the Prism deck has no lanes.

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

- **Layout:** the limits are in the pad's corners, X along the bottom and Y up the left. The original's size, 461 × 241, is not kept: the pad fills the page left of the panels.
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
- **The marker** is a white ball in a ring, red while recording; a dashed ring follows it where the glide has the engine now. (The original's was a yellow ball on a black crosshair.)

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

- **Loop takes are not in an export.** Hyperprism rendered its paths offline (`GetNextParameters`). A Loop take is live only; a Lanes take is in the document and the export, but on the file's timeline, not looping at its own length.
- **The glide steps once per block,** not every 512 samples within a block. A block is the engine's 256–1024 frames.
- **Not carried over:** the Path Edit Table, Path Info (name, comments), and undo of a take.

## Fixed: the Pitch Time Changer's ratio

*6 November 2026.* The shifter corrects the varispeed by Pitch ÷ Speed. It used to be handed that as its Pitch control, which is 0–200 % as a rack effect. So anything past 2× was cut off: Speed 25 % at Pitch 100 % played an octave low. The original had no limit, so Pitch 200 % at Speed 1 % is a ratio of 200.

`hp-pitch-shifter` now has **Pitch scale** (0–200 ×, default 1), in its "Added (not in the original)" group. It multiplies the ratio. The Pitch Time Changer sets Pitch to 100 % and the whole ratio as the scale (`ptc_set_ratio`), live and in an export. At the default the rack effect renders bit for bit as before.

Tested in `the_pitch_time_changer_keeps_the_pitch_past_a_ratio_of_two` (engine: 200 Hz stays at 200 Hz at Speed 25 %; with the old cap it came out at 104 Hz) and `the_pitch_scale_takes_the_ratio_past_200_percent` (prism-fx).

## Fixed: clicks and chopping while dragging

*5 November 2026.* RJ, on first playing it: "really clicky and glitchy, and the audio is really choppy".

**Cause.** A stretch change keeps the playhead on the same moment of the file by rescaling it (`fill_inner`). While the pad is dragged, and above all under the glide, the stretch changes on every block, so every block was a rescale:
- **WSOLA, the vocoder, PV-SOLA and hybrid** were sought on every rescale, and faded in from silence. That's a seek and a fade every few milliseconds, heard as chopping.
- **Each extra layer** lost its place and was sought too.
- **The granular cloud** re-derived its grain schedule from the new playhead and skipped forward. Under a glide that could leave it a quarter of a second ahead of the playhead, with no new grains until the playhead caught up.

**Fix,** in prism-grain:
- **A rescale relabels the playhead and nothing else.** The engines carry on.
- **WSOLA and the noise stream** keep their read continuous with an anchor (`anchor.rs`). When the ratio changes they take up the difference where it changed, instead of letting `frame / ratio` jump.
- **The vocoder and PV-SOLA** already read incrementally.
- **Extra layers** move with the playhead.
- **The grain schedule** shifts with it (`GrainStream::shift`).
- **The exception:** a WSOLA reading through a transient map still seeks, because the map says where it reads.

**Measured** over two seconds of a 220 Hz tone, counting clicks while the stretch glides ×1 to ×2:

| Engine | Before | After |
|---|---|---|
| WSOLA | 105 | 1 (as steady) |
| Vocoder | 93 | 0 |
| PV-SOLA | 105 | 0 |
| Granular | — | 0, and no gap in its grains |

The same holds with four layers. A chirp, whose pitch says where in the file it is, shows the read going on without a jump.

Tested in `a_moving_stretch_does_not_click_on_any_live_engine_or_layer` and `a_moving_stretch_reads_on_through_the_file_without_jumping` (engine), and in `anchor.rs` and `grain::rescale` (prism-grain).

**The pad itself** now repaints at most once a frame, and grows its drawn path instead of rebuilding it on every move.
