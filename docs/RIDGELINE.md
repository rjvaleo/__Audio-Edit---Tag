# The ridgeline

Written 22 Aug 2026, before the work, as the design being built to.

A second visualiser, chosen *instead of* the room: eighty stacked lines, each one
hiding what is behind it. Four phases, ending with the lines being the actual
audio waveform.

---

## The four phases

| | what a row is | what it proves |
|---|---|---|
| **1 · Pulsar** | Craft's measured CP 1919 pulses, the real eighty | the look is right, before anything moves |
| **2 · Synthesised** | pulses generated from the measured statistics | the stack can run forever without repeating |
| **3 · Driven** | synthesised, with the four parameters taken from the sound | it reacts, and still looks like the plot |
| **4 · Waveform** | **the audio itself**, windowed so the energy lands centrally | the goal: it looks like those pulses and *is* the sound |

All four are the same renderer with a different source of rows. That is the
whole architecture: **one generator, four ways of filling it.**

## What the data actually is

`Reference Docs/cp1919/pulsar.csv` — 80 rows × 300 samples, Craft 1970, digitised
by Borgar Þorsteinsson. Measured, in `tools/cp1919.py`:

| | |
|---|---|
| baseline (the flat tails) | mean −0.34, **sd 0.55** |
| pulse height | mean 31.3, sd 12.4, range 12.1 … **74.3** |
| where the pulse sits | **x ≈ 0.42**, sd 0.066 |
| width at half height | 51 of 300, sd 22 |
| **row vs mean profile** | **+0.907**, and 77 of 80 above 0.8 |

**There is one pulse shape and eighty variations on it.** That single number —
0.907 — is what makes phases 2, 3 and 4 possible at all.

A correction worth recording: row-to-row correlation measures **+0.817**, which
looks like each pulse remembering the last. It is not. That number is the shared
backbone showing through, because any two rows resemble each other by both
resembling the profile. Tested directly, peak position moves with a step/spread
ratio of **1.55** and height **1.36** against 1.41 for pure independence — so the
per-row parameters are drawn near-independently. Reading 0.817 as memory would
have built a random walk into the synthesiser and made it visibly wrong.

**Normalise globally, never per row.** Most rows peak between fifteen and forty
and one reaches seventy-four. Per-row scaling gives eighty equal humps and throws
away the most recognisable thing in the picture.

## The synthesiser, and why it is also the audio path

A row is the backbone profile, rescaled and nudged:

```
row(x) = profile((x - pos) / width) * height + noise
```

Four numbers per row. In phase 2 they are drawn from the measured spreads. In
phase 3 they come from the sound:

| parameter | from |
|---|---|
| **height** | level |
| **position** | spectral centroid |
| **width** | spectral spread |
| **jaggedness** | spectral flatness |

So the synthesiser and the reactive visualiser are **the same generator** with a
different source for four numbers. Not two renderers to keep in step — which is
the failure this program has shipped repeatedly, and the reason it is worth
saying out loud in a design document.

## Phase 4: the row *is* the waveform

`push(bands, pairs)` already carries the raw waveform. `pairs` is 1024 stereo
sample pairs, **contiguous** — `docs/VISUALISER.md` insists on that, because a
Lissajous of every eighth sample is a picture of a different, aliased signal.
So the samples are there and they are honest.

A raw bipolar trace stacked eighty deep is an oscilloscope, not this picture. To
look like the plot while *being* the audio:

1. **Rectify** — `|sample|`, or a short envelope over it. Unipolar, like a pulse.
2. **Window** — multiply by a raised cosine centred in the row, so the tails run
   flat and the energy lands in the middle. This is the one shaping step, and it
   is what puts "the peaks in the middle".
3. **Normalise globally** against a slow-moving ceiling, so a quiet passage stays
   quiet rather than being auto-gained up into a wall.

Silence then gives flat lines with no special case, because `|0| = 0`. That is
exactly the requirement — *no sound playing, all the waveforms flat* — and it
falls out of the arithmetic rather than being tested for.

**WINDOW is a control from 0 to 1.** At 1 it is the sleeve. At 0 the waveform
runs edge to edge untouched, which is the honest oscilloscope and is worth being
able to see.

## How it moves

New rows enter **at the bottom** and travel up, oldest at the top. That is the
brief, and it agrees with the room next door, where depth is time and now is
nearest.

Drawing order is therefore **top first, bottom last** — oldest painted first,
each newer row painting over it. Nearer occludes further, which is the same
painter's algorithm the picture has always been.

A row is **fixed when it is born**. Every parameter, every sample, every random
number is resolved at push and never revisited. That is the discipline the grain
cloud follows for its shape and seed, and it is what makes the live picture and
the filmed one the same picture rather than two evaluations that drift. It also
means this module needs no clock — no `f.clock`, and none of the stutter
`docs/VIDEO-EXPORT.md` records.

## Two dimensional canvas, not WebGL

- **Hidden-line removal is the design, and 2D gives it away free.** Fill under
  each polyline in the fill colour, then stroke. Painter's algorithm, back to
  front. In GL it is a depth buffer or sorted triangle strips for the same
  picture.
- **`gl.lineWidth` is clamped to 1 by almost every driver.** The room says so in
  three places and works around it with ribbons every time. This design is
  hairlines.
- **A third WebGL context is a real risk.** The export already opens a second and
  says so: *"this machine would not give a second WebGL context"*.
- **It is cheap.** Eighty rows of three hundred points is twenty-four thousand
  points, and the picture only changes twenty times a second.

## The module seam

`vgAttach(canvas)` already returns exactly the contract both the live loop and
the export drive:

```
attach(canvas) -> { push(bands, pairs), frame(f), clear() }
```

The work is to **name** it and add a second implementation.

- `VIS_MODULES` — `room` and `ridge`, each with `attach`, a label and a panel.
- **Each module gets its own canvas.** A canvas can only ever have one kind of
  context; once `#visGl` is WebGL it can never be 2D. Switching shows one and
  hides the other, and each is built lazily.
- **The export is told which module**, alongside `camera` and `paint`. Reading it
  from a global inside `video-export.js` would be a second place the choice
  lives.

## The controls

Its own panel in the Room tab, shown when the module is chosen.

**SOURCE** — Pulsar · Synthesised · Driven · Waveform. The four phases, as a
setting rather than four builds.

| | |
|---|---|
| ROWS | how many lines. Eighty is the sleeve |
| POINTS | resolution across a line |
| SPACING | gap between baselines |
| HEIGHT | how far a peak reaches — against spacing, how much the rows tangle |
| SPAN | how wide the lines run, leaving the flat tails |
| WEIGHT | stroke width, as a fraction of the frame so it survives export at 4K |
| FILL | the occluding fill. **Off it is a hairball and not this design at all** |
| WINDOW | how hard the energy is pulled to the middle (phase 4) |
| SMOOTH | across samples, and on arrival |
| GAIN | how hard the sound drives the height |

Plus a **MODULE** selector beside FRAME in the stage bar: which visualiser you
are looking at is the same class of decision as what shape it is drawn in.

## The colours

`room-paint.js` already does modes, ramps, drives, generators and saved schemes.
None of it is specific to the room except `RP_SLOTS`, which is a list — so
**slots become per-module** and the Colour tab shows the active module's.

| slot | |
|---|---|
| **Line** | the stroke |
| **Fill** | under each line — normally the background, and a slot so it need not be |
| **Background** | the ground |

Drives: `level`, `position across the line`, `row age`, `random`. The generators
work unchanged, and `Black & white` is the sleeve.

## What will go wrong

Every one of these has already happened in this codebase.

- **The fill will be forgotten or made transparent** and the picture will be a
  hairball. It is the defining property and gets the test that names it.
- **Lit-pixel counts will prove nothing.** The terrain lesson: a filled surface
  spans the same area however many rows it has, and three separate measurements
  said a working control did nothing. Count **lines crossed down a column**.
- **The test library's sounds are 0.1 s and 1 s.** Two tests failed this week for
  exactly that. Anything needing a real spectrum picks by `duration`.
- **The preview pane reports 0×0** and transitions freeze in a hidden tab.
- **The binary embeds the UI.** Rebuild or the browser gets the old file.
- **Per-row normalisation** will creep in because it makes quiet passages
  visible. It destroys the picture. Global, with a slow ceiling.

## The tests

Each shown to fail before it is trusted.

1. **The contract** — both modules return `push`, `frame`, `clear`.
2. **Switching** shows one canvas and panel, hides the other, and restores.
3. **The choice is remembered** across a reload.
4. **Hidden lines** — with FILL on, a point where a far line would fall but a
   near peak covers it reads as fill; with FILL off it reads as line. *Fails by*
   filling with `transparent`.
5. **Silence is flat** — no sound pushed, every row a straight line.
6. **Sound makes peaks**, and they land at the x the sound puts them at — an
   asymmetric check, so a mirrored axis fails.
7. **Rows are counted** as lines crossed down a column, not as lit area.
8. **New rows enter at the bottom** and travel upward.
9. **A row is fixed at birth** — the same pushes twice give the same picture.
10. **The palette reaches it** — Line and Fill slots change what is drawn.
11. **The frame letterboxes it** at every aspect.
12. **Its controls are reachable** by a real pointer, geometrically inside the
    panel.
13. **The export films it**, read out of what the encoder was handed.
14. **Switching module changes what is filmed.**

## The order of work

1. The data as a module: `ui/ridge-data.js`, generated by `tools/cp1919.py` so it
   is reproducible rather than a pile of magic numbers.
2. The seam and the renderer, drawing phase 1. Tests 1–4, 7.
3. Scrolling, and the synthesiser. Tests 8, 9.
4. Audio: driven, then waveform. Tests 5, 6.
5. The panel and the colours. Tests 10, 12.
6. The frame and the export. Tests 11, 13, 14.

## The name

The sleeve is Peter Saville's and the plot is Harold Craft's. The chart type is
nobody's. The module is called **Ridgeline**, and no band name, wordmark or
typography goes into the program — what it draws comes from the sound in front
of it, which is the entire point of building it.


---

# What was built

Written 22 Aug 2026, after the work.

All four phases, as a **SOURCE** setting rather than four builds. `ui/ridge.js`
is the module, `ui/ridge-data.js` is generated from the CSV by `tools/cp1919.py`.

## What it does, measured

Counting lines crossed down a column at native resolution — never lit area:

| | tails | centre |
|---|---|---|
| silence | 80 | **80** — every line flat and visible |
| sound | 80 | **45** — thirty-five hidden behind peaks |
| the real pulses | 80 | 68 |

Silence is flat with no special case, because the absolute value of nothing is
nothing. The tails stay at eighty throughout, which is what makes this the plot
rather than a spectrogram.

## Four things that went wrong

**The prefix was already taken.** `room-paint.js` owns `rg` for the room's
*geometry* panel, including a `const RG_DEFAULTS`. A second top-level `const` of
that name is a duplicate declaration that kills the whole script on load —
**silently**, with nothing in the console and every symbol in the file simply
absent. `ridge.js` uses `rdg`. It cost twenty minutes and produced no error
message anywhere.

Its second victim was quieter: `ridgeSettings()` in `app.js` went on spreading
`RG_DEFAULTS` after the rename, so the ridgeline was configured from the room's
floor-band count and trail depth. It parsed, it ran, and it was nonsense.

**`push` needed settings that only `frame` delivered.** A row is made and fixed
at push, so the settings have to be in hand by then — and the export pushes a
whole run of rows before it draws anything, which would have made every one of
them with the defaults. On screen it hides, because frames run three times as
often as pushes and it corrects within one. `configure()` is the door both go
through now.

**Identical rows can never occlude one another.** The first probe pushed the
same burst eighty times, measured three hidden lines and read that as the fill
barely working. Each row sits exactly one gap below the last, so a stack of
identical pulses hides nothing at all. Real sound varies; the test now does too.

**A probe that only reads is reading a stale picture.** Pushing rows does not
paint. Three tests reported two lines where there were eighty, because `CROSS`
had lost the `visGlTick()` the live version of it had.

## The one assertion that had to be weakened, and why

*The fill hides what is behind* began as "without the fill, all eighty lines are
crossed". That is wrong: with no fill the lines are drawn over each other and
**merge where they cross**, so a peak crossing four lines reads as one and the
count is 62 rather than 80. Asserting 80 fails on working code.

What means something is the **difference**. With the fill it is 45; without it,
62. Made transparent on purpose, both readings are 62 — the test names it:
*"the fill hid nothing: 62 lines without it, 62 with it"*.

## Still to do

- The **export** does not film it yet. `videoExport` still calls `vgAttach`
  directly; it needs the chosen module, alongside `camera` and `paint`. Until
  then a film of the ridgeline is a film of the room.
- **Ramps** for its three slots. They take a flat colour; the palette's modes,
  drives and generators are not wired to them.
- The frame selector letterboxes the room's cell and the ridgeline shares it, so
  it follows — but that is inherited rather than tested.
