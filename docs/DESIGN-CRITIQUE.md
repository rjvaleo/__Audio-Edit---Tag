# Design critique — the whole interface

Written 27 Oct 2026, on `open-world`. A pass over every workspace and panel,
in three steps, in this order:

1. **The masters.** The Design Council plugin's five lenses: Jony Ive
   (material truth), Dieter Rams (honest restraint), Zaha Hadid (movement
   through space), Bjarke Ingels (playful function) and Don Norman
   (affordance). They set *what* is wrong.
2. **The UX skills.** The design-skills plugin's critique, interaction-design
   and accessibility frameworks: Nielsen's heuristics, the UX laws and WCAG 2.2.
   They turn each point into a change, with a severity (0 to 4, Nielsen's scale).
3. **The polish.** The frontend-design and design plugins, for the visual
   finish and a last accessibility pass.

The evidence is 30 screenshots at 1600 × 1000: Browse, the six Grain dock
tabs, the five Visual tabs, the Visual modules, Seq, Theme, Record and
Settings. They come from a scratch server with three sounds from the
library. There is also a probe of the live page and a count of what is in
`ui/app.css`.

**Posture.** This is a *sovereign* application: used for hours, with full
attention, by one expert. The design should be dense, muted and quick from the
keyboard. RJ's standing rules point the same way: tight panels with no blank
space, one fixed width per module, and compact by default. Every item below is
judged against that, not against a first-time visitor.

---

## The scores

| lens | score | in one line |
|---|---|---|
| Ive — material truth | 2 / 5 | Nineteen type sizes and three type voices; canvas labels fall back to Times. |
| Rams — economy | 2 / 5 | Two control grammars, and blank fields beside crowded columns. |
| Hadid — flow | 3 / 5 | Workspaces are clear rooms; the thresholds inside them (Browse, Prism) are not. |
| Ingels — delight | 4 / 5 | The room, the Stage arrangements and the sequencer are the ski slope. Keep them. |
| Norman — clarity | 2 / 5 | No visible keyboard focus; tabs that aren't tabs; an empty state pointing at nothing. |

---

## The list, in priority order

Each item gives what is wrong, who raised it, the principle it breaks, the
severity and the change. **C-numbers** are the change IDs. The commit, the
tests (`tests/ui/design-pass.spec.mjs`) and the CSS comments all use them.

### C1 · Type has no scale — severity 3

`app.css` sets **nineteen** font sizes, from 7 px to 17 px in half-pixel
steps: 9, 9.5, 10, 10.5, 11, 11.5, 12 and so on. Control text goes down to
7.5 px. That sits below what a dark interface can carry at normal viewing
distance.

The canvases name `ui-monospace` with nothing after it. Only Safari knows
that family, so in Chromium the EQ's `POST FILTER`, the compressor's
`GAIN REDUCTION` and every graph axis are drawn in **Times**.

- **Rams:** "Intermediate sizes are indecision made visible." Three to five
  steps, nothing between.
- **Ive:** a serif label on a graph of light is the wrong material. It isn't
  a choice; it's a fallback.
- *Heuristics:* H4 consistency; visual hierarchy.

**Change.** Five steps as tokens: `--fs-xs 9`, `--fs-s 10`, `--fs-m 11`,
`--fs-l 13`, `--fs-xl 16`. Every size in the stylesheet snaps to the nearest
one, and 9 px is the floor. The room's data block keeps its 7 px, because it
is part of the picture printed on the wall, not interface. Every canvas
label is given a family list that ends in a generic family.

### C2 · Visual's panels speak a second control grammar — severity 3

The Grain dock writes a control as one line: **name · slider · reading**,
with columns declared once (`--param-k`, `--param-v`).

The Visual column writes the same control on two lines, with the tag above
and the slider below. That is about 46 px a row. So:

- The Shape tab's seven sliders end 600 px above the bottom of an empty column.
- The Stage panel's sixty rows need a long scroll.
- Ridgeline's ten rows take the whole column height.

- **Rams:** the same thing should look the same everywhere. Two grammars are
  one too many.
- **Hadid:** a column you scroll past mostly empty space is a corridor, not a room.
- **Norman:** the reader learns one layout in Grain and must re-learn it in Visual.
- RJ's own rule: *panels dense — controls tight together, no blank space*.
- *Heuristics:* H4; Law of Similarity; H8 information density.

**Change.** In every Visual module panel (Room, Ridgeline, Surfaces, Stage,
the type card), the tag sits in a fixed left column on the same line as its
controls. A busy row such as FOG (switch, menu, slider, swatch) wraps
**inside** the control column, so the tag keeps its column. A one-slider row
drops from about 46 px to about 22 px.

This reverses a recorded decision, the "label goes on its own line" comment
in `app.css`. That decision was made to give a four-control row the full
300 px. With the tag in a 64 px column, a single slider still gets about
210 px, more than the dock gives it. The four-control row now wraps under
its own tag.

### C3 · The Prism pad is adrift — severity 3

The Prism tab centres the square in the full width of the dock. The bars
above it run full width too. So the pad floats with about 560 px of nothing
on its left. Its Y reading (`Pitch +0.0 st`) sits 30 px from the square, and
its limits are separated from the corners they belong to.

- **Rams:** the blank field is not whitespace that carries rhythm. It is
  space nothing earned.
- **Hadid:** the eye should land on the pad, and then the controls should be
  at its edge.
- **Ive:** Hyperprism's window was an object, a square with its limits in its
  corners. Here it is a square in a field.
- *Heuristics:* Law of Proximity; Fitts (the readouts sit far from what they
  read).
- RJ's rules: tight panels, and one fixed width per module.

**Change.** The tab becomes two columns:

- **Left:** a fixed-width control column holding Drive, Across, Up, PTC, REC,
  LOOP, Speed, the L / LR / R faders (one per line, each with its 0), the
  presets and post-roll.
- **Right:** the pad, hard against the column, sized as before from the
  dock's height, with its limits on its corners.

The process's extra settings, when it has any, take the space to the right
of the pad.

### C4 · Keyboard focus is invisible — severity 3

`app.css` has no `:focus-visible` rule. It has ten `outline: none`. Tab
through the toolbar and nothing shows where you are.

- **Norman:** a control that can be reached but not seen being reached is a
  door with no handle.
- *WCAG 2.4.7 Focus Visible (AA); H1 visibility of system status.*

**Change.** One focus ring for the whole interface: a 1.5 px accent outline,
offset 1 px, on `:focus-visible`. It applies to buttons, inputs, selects,
sliders, the rail and the tabs, text fields included. Those fields used to
mark focus with an accent border that looked like hover. Mouse clicks don't
show the ring; keyboard focus always does.

### C5 · Tabs that aren't tabs — severity 2

The six dock tabs and five Visual tabs behave as tabs, but no software can
tell. There's no `tablist`, no `tab` and no `aria-selected`.

- **Norman:** the state is visible to the eye only.
- *WCAG 4.1.2 Name, Role, Value (A).*

**Change.** `role="tablist"` on both strips. `role="tab"` and
`aria-selected` on each tab, kept in step by the same click handler that
moves `.active`.

### C6 · The transport's finish — severity 2

The GRAIN and SEQ source buttons print their 8 px words wider than their
boxes, so the letters cross the border. In the Visual foot the meta strip
is cut mid-word ("rate 44:"), straight into the volume slider.

- **Ive:** finish is the difference between good and extraordinary, and a
  label crossing its own border is the most visible finish there is.
- *Heuristics:* overflow and truncation handled gracefully.

**Change.**

- The source buttons size to their words at the new scale.
- In the Visual foot the meta strip is left out (Rams' subtraction). The file
  it describes is named at the start of the same bar, and Browse shows all of it.
- In the Grain bar, where it shows, its last 20 px fade out once it is fuller
  than its box, instead of the volume slider cutting a word in half.

### C7 · Glyph-only buttons — severity 2

Sixteen visible buttons are named only by a symbol: ▶ ■ ⟲ ● – + ⤢ ⇥ ⚙ × ⟳.
Their meaning lives in a `title`. A screen reader reads "button", or the
symbol's Unicode name.

- **Norman:** icons alone work only for universally understood actions.
- *WCAG 4.1.2 (A); H6 recognition rather than recall.*

**Change.** Each gets an `aria-label` saying what it does: "Play", "Stop",
"Loop", "Capture what is playing", "Zoom out", "Zoom in", "Fit", "Follow
the playhead", "Visuals menu", "Close", "Re-read the library", "New tab".
The glyphs stay; they are the right size for the bar.

### C8 · The automation timeline is drawn stretched — severity 2

The empty timeline's sentence reads as a row of dashes, too faint to make
out. Two faults are behind it:

- **The timeline is drawn while its tab is hidden.** The canvas has no width
  yet, so it is drawn at the browser's default 300 px and then stretched
  across the dock. Every letter comes out three times as wide.
- **Its colour,** #2a3540 on #0a0c0e, is about 1.4 : 1.

- **Ive:** a stretched glyph is the material being bent out of shape.
- **Norman:** an empty state you can't read can't tell you what to do.
- *Heuristics:* H1; designed empty states; WCAG 1.4.3.

The panel's letter-spaced capitals were raised too, as a voice found nowhere
else in Grain. They stay: `perf-panel.js` is the sequencer's performance
panel, carried over deliberately so a take on the Grain page and a take on
the Seq page look like one thing.

**Change.** The timeline is drawn when its tab opens, at its real width, and
its empty sentence is set at a readable contrast.

### C9 · Browse's empty state points at nothing — severity 2

Clicking **Browse** while you're already in Browse collapses the library
panel. That is a deliberate toggle. The centre then still says "Select a
sound on the left", above an empty strip.

- **Norman:** the instruction maps to something that isn't there.
- **Hadid:** the threshold of the library should open onto the library.
- *H6; blank-slate pattern.*

**Change.** While the library is collapsed, the empty state is a button,
**Open the library**, which re-opens it. While it is open, the sentence
reads as before.

### C10 · Clipping and collisions — severity 1–2

- **4D tab:** the OBJECTS list runs under the OBJECT heading, and the
  "ROTATION · SIX PLANES" label wraps to three lines.
- **Visual › Sound:** the Keys button hangs off the right edge of the column.
- **Compressor graph:** THRESH and KNEE are printed on top of each other.

- **Ive:** finish. **Rams:** thorough — every state designed.
- RJ: one fixed width per module, with content fitted inside it rather than
  hanging out of it.

**Change.**

- **4D tab:** the heading clears the list, and the plane label stays on one
  line.
- **Sound tab:** the engine row keeps its four fixed places, which never move
  when the engine changes. In the 300 px column it lays them out as two lines
  of two, so nothing hangs off the edge and no word is cut.
- **Compressor graph:** KNEE is never printed higher than one line below
  THRESH.

While I was there:

- The words beside the Visual column's switches (FOG's "on", EDGE's "thick")
  are now control-size text. They had been inheriting the page's 13 px.
- The Data layer, which has no occlusion switch, keeps that switch's place
  empty, so its bar no longer runs 21 px past the others.

### C11 · Section headings in four styles — severity 1 (polish)

- Time & Pitch: orange capitals (SPLICE, SCAN).
- Visual: dim small capitals (LAYERS, STREAMS).
- Stage: bold monospace (VIEW, TERRAIN).
- Automation: spaced cyan capitals.

- **Ive / Rams:** a heading is a heading.

**Change.** The stretch tray's heading becomes the house style: `--fs-s`
small capitals, weight 600, 0.06 em tracking and a rule underneath. Stage's
groups and folds take it too, and Stage's monospace gesture notes read like
every other note in the column.

Colour still marks the kind of group: orange for the extended side of the
stretch tray, dim for the standard side. Module titles ("Parametric EQ") are
a level up and keep their style. Automation keeps the sequencer's voice (see
C8).

### C12 · No respect for reduced motion — severity 1

The interface's own transitions run regardless of the system's "reduce
motion" setting. The rail's stylesheet honours it; `app.css` does not.

- *WCAG 2.3.3 Animation from Interactions (AAA).*

**Change.** Under `prefers-reduced-motion: reduce`, interface transitions
and animations drop to instant. The pictures are what the program makes,
not decoration, so they are untouched.

---

## The Visual column — RJ's review of C2, and what replaced it

C2 made every Visual row one line. RJ looked at the result and called the
column *horrible*. Asked whether Ive was OK with that, the honest answer was
no. The pass had applied Rams and Norman (density, one grammar) and left the
column's material alone:

- **A wall of solid accent.** Every layer that was on, every stream and every
  switch was a filled cyan bar. Ive's lighthouse rule is that colour is dim at
  rest and bright where the eye should go; here nothing stood out because
  everything shouted.
- **Browser furniture.** Hairline native sliders, bare number boxes and chip
  buttons: three species of control, none of them drawn by the program. The
  Room tab's RING and DRIVE printed no value at all.
- **Ragged edges.** Chip rows wrapped to a second line at different lengths.

RJ then asked whether sliders were the right control at all. They weren't.
Each kind of value now gets the control that suits it. This was mocked up
first and approved ("Build it"):

| kind of value | control | where |
|---|---|---|
| an amount, nothing to a lot | a **knob**, four to a row, its reading printed under it | Ring, Solid, Grains, Air, Data opacity; every slider in Shape, Ridgeline, Surfaces, Stage and the type card |
| two numbers that are one decision | a **pad** | the camera: *Turn* (Rotate Y across, Rotate X up) and *Stand* (Translate X across, Translate Z up) |
| an exact number | a **scrub field**: a word over a number you type or drag | the camera's channel box, three to a line |
| a choice | a **row of fixed places**, lit by a tint and an edge, never filled | View, Streams, Block, every on/off chip in the column |

**The Room tab is grouped by subject:** Layers, Camera, Ring, Solid, Grains,
Air, Data. Before, it ran in the order its rows were added: the ring's
values sat in three places, and the camera sat between the ring and the
solid. The layers are a list with an eye (◉ / ○) in place of filled bars.

**Nothing was rebuilt.** A knob is the same `<input type=range>`, with a face
drawn behind it and a vertical drag over its own (`rkKnob` in `app.js`).
Every handler, preset, look and test that moves `#reRing` moves it still, and
a pointer aimed at the knob lands on the input. The pads write the camera
through `ROOM_CAM_CHANNELS`, the channel box's own read and apply.

The other panels (Shape, Ridgeline, Surfaces, Stage, the type card) are
adopted as they are built (`rkAdopt`, watching the column). Every row that is
a tag, a slider and a reading becomes a knob cell, keeping the panel's own
reading. On the master bus the Room panel is still the overlay it was, with
sliders, because the knob faces are drawn only in the Visual column.

**Not yet done:**

- **The Sound tab** is the granular engine's own panel, borrowed from Grain ›
  Time & Pitch. It is redesigned with the granular engine, next.
- **Colour** (a list of painted things, each with a ramp) and **4D** (exact
  numbers, already scrub fields) get a lighter pass after that.
- **Graph-first controls**, where a value has a shape you drag (fog's falloff
  curve, a ramp's range), are a second step.

## The granular engine — Time & Pitch, and Visual › Sound

Asked for by RJ after the Visual column. Critiqued, mocked up and approved
("Build it") before any code changed.

**What the Council raised:**

- **Hadid: a false floor.** Granular has 21 controls in two tall columns. At
  the dock's height a third of them showed and the rest were under a scroll,
  while the dock's width went to a half-empty Extended column.
- **Norman: words to decode.** Switches read "prsrv trnsnts", "rvrs grns",
  "wrp pstns" and "stp th drft". `fitLabel` took the vowels out of anything
  over 11 characters. Pitch's reading was cut off: "+0.00 st …".
- **Rams and Ive: one species for everything.** 21 identical hairline
  sliders, two of them printing words ("symmetric", "centred") on a bar.
- **Hadid and Ingels: the best thing was the smallest.** The cloud pad is
  the one control that shows the sound and moves it: drag inside its box to
  move the head, outside to spray it in time and pitch. It was boxed into a
  third of a column.

**What it is now:**

- **The cloud pad leads.** The engine picker, the pad, its readout and the
  Cloud presets form a column of their own on the left.
- **Every group is a bank of knobs.** Time and pitch, Pitch movement, Grain
  shape, then the extended side (Splice, Spectrum or Phase by engine, then
  Scan, Shape, Layer scatter and Randomness). The banks wrap across the
  dock, so Granular is entirely on screen at the dock's height.
- **Extended knobs draw in amber,** the colour their headings already
  carried: these are the values the algorithm was tuned around.
- **Every switch keeps its words:** "Preserve transients", "Reverse grains",
  "Warp positions", "Step the drift". The four switch places are still fixed
  and still the same width as each other, now wide enough for the words.
- **The tray keeps its width,** 52 % of the dock, up to 720 px. A first build
  widened it to 64 %, which narrowed the master bus beside it. The Room
  overlay drawn over that picture then wrapped its Opacity control out of
  reach, and a render test lost its margin. Both were caught by the suite,
  and the width went back.
- **Visual › Sound is the same element,** so it carries the same banks,
  wrapped down its 300 px column with the pad on top.

**Built like the Room tab's knobs** (`gkKnob` and `gkLayout` in `app.js`).
Each `.param` row keeps its input, handlers, double-click reset and reading.
A face is drawn behind the input and the input is laid over it. Random, the
presets, the automation and the existing tests all reach the same elements.

**Still open:**

- At the dock's default height (1600 × 1000 window), measured in content
  over space:
  - Granular fits: 285 px of content in 317.
  - WSOLA scrolls by 34 px.
  - Vocoder scrolls by 101 px.
  - PVSOLA scrolls by 166 px.
  - Hybrid, which carries both a vocoder and a cloud, scrolls by 343 px.
  Before this pass, every engine scrolled; Granular had 595 px of content
  in 305. Fitting the rest means more width (which the master bus would
  have to give) or a taller dock. That trade is RJ's.
- The tuning and Keys buttons print their words a few pixels high in their
  slots. That was already so, in the dock and in the Visual column.

## The UI queue — 30 Oct 2026, branch `ui-queue`

The non-audio follow-ups. Item 1 and the docs were done here; items 2–6
went to parallel cloud sessions, each opening its own PR into `open-world`.

### 1. The engine tray fits the dock

- **Wrong:** the banks wrapped in a fixed order, so a line was left half
  empty whenever the next bank did not fit (Scan alone, Shape on the line
  below). **Hadid:** a false floor. **Rams:** space nothing earned.
- **Changed:** `gkPack` fills each line largest-first, keeping the reading
  order that matters: Time and pitch first, the engine's own bank beside it,
  standard before extended. Each knob line lost a few pixels. The engine's
  own bank now reads "This engine"; it had been printing "Time and pitch"
  over Pitch movement.
- **Measured** at 1600×1000, content over the dock's height:

  | engine | before | after |
  |---|---|---|
  | Granular | 0 | 0 |
  | WSOLA | 46 | 0 |
  | Vocoder | 113 | 41 |
  | PVSOLA | 178 | 97 |
  | Hybrid | 355 | 235 |

- **Held by:** G1 in `design-pass.spec.mjs`, per engine that fits, plus the
  reading order for all five.

**For RJ: Vocoder, PVSOLA and Hybrid.** They carry about twice the banks the
strip holds without taking width from the master bus, which the brief ruled
out. The ways to fit them:

1. **A taller default dock.** About 45 px brings in Vocoder, 100 px PVSOLA,
   240 px Hybrid. It comes out of the waveform lane above.
2. **A wider tray for those engines only.** The master bus gets narrower
   while one of them is chosen. Last time that moved the Room overlay; it
   would need its own fix.
3. **The extended side as a second page** of the tray (Standard | Extended)
   for the engines that do not fit. Nothing scrolls; one click shows the
   rest.
4. **Leave it.** The remainder is a short scroll.

### Control parity

RJ: *"make sure the new layouts have all of the controls that the old layouts
had."* Checked, not assumed:

- the pre-redesign build (2a0647a) and this branch were inventoried
  control by control in 21 views (each engine's tray, every dock tab, the
  transport, the edit toolbar, every Visual tab and module, the stage bar);
- every view has the same count, 3,135 in all;
- the only differences are five switches renamed from their stripped forms
  ("rvrs grns", "wrp pstns", "stp th drft", "prsrv trnsnts", "rmk ns") to
  whole words.

`tests/ui/controls-parity.spec.mjs` now holds that inventory, so a later
layout that drops a control fails, naming it. Each cloud PR is to be run
against it before it is merged.

### 2–6. In cloud sessions

| item | branch |
|---|---|
| the Colour tab | `colour-tab` |
| the 4D tab | `fourd-tab` |
| Prism settings beside the pad | `prism-settings` |
| fog as a curve | `fog-curve` |
| the two old faults | `small-faults` |

Each opens a PR into `open-world`, and their results are to be recorded
here when they land.

## Raised, and deliberately not changed here

Each of these is a decision, not a fix, so it is RJ's to make.

- **The sequencer's look.** Seq is a night console: neon cyan, spaced
  capitals and knobs. It shares nothing with the rest of the app. **Ingels**
  calls it the best moment in the program. **Rams** calls it a second
  product. It is also close to the "Night console" panel proposal. Restyling
  either the sequencer or everything else towards it is a direction, not a
  repair.
- **The information architecture.** The duplicated homes, the six preset
  systems and the three colour systems are already inventoried in
  `INFORMATION-ARCHITECTURE.md` §4–§7. The options there (by object, by
  module, one arrangement) are undecided. Nothing here pre-empts them.
- **Floating, collapsible, dockable windows** with the layout saved in the
  session. Deferred by RJ until after idMLab.
- **The explanations in panels.** The Theme pane, the 4D tab, Record and the
  room's gesture legend carry paragraphs. UX-writing practice would move
  them into tips. This program keeps its explanations in place on purpose
  (`STATE.md` §7), so they stay.
- **Fonts.** The Cabinet / Night console proposals use Home Video, Barlow
  Condensed and IBM Plex Sans Condensed. Bringing a face in means embedding
  it in the binary: an `include_bytes!`, a route and the build id.
  Separately, `app.css` begins with an `@import` of Share Tech Mono and Teko
  from Google Fonts, which reaches the network that `STATE.md` §1 says the
  program never touches. Offline, those two fall back silently. Both belong
  with a font decision.
- **The room's data block over the Stage arrangements.** It is a layer, and
  it is drawn where the layer list says.

---

## Still open after this pass

- **The Prism tab** is now a column and a pad, but the pad is sized from
  the dock's height, so on a wide window there is still space to its right.
  When a slot process has settings of its own, they could take that space
  rather than sit under the controls. That's a layout decision about the
  Prism window, so it is RJ's call.
- **The engine row's Keys button** prints its word higher than the buttons
  beside it, in the dock as well as in the Visual column. This was already
  there and is not touched here.
- **A stray glyph** sits at the foot of the Browse centre, from an empty
  element under the lane. It was already there.

## Before and after

Screenshots of every workspace, before and after, were sent with the commit
report. They are not kept in the repository.
