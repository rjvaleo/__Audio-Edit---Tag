# Wave fills the window (A6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Wave page fills the window as mock-up A6 shows: the rail, one 440 px dock on the right on every tab, the keys and the transport below; only the middle grows; on the laptop the whole frame scales down to fit.

**Architecture:** `.wv-app` stops being a fixed 1460 × 862 box and becomes a grid that fills `#waveView`. The middle holds the tab views at fixed sizes, a page-level dock holds either the inspector (FX) or the chain of effects (every other tab), and one scale factor is applied to the whole frame only below its smallest size. A pure function lays the board's graph out as a chain with splits, and the dock and Play's effects row both draw from it.

**Tech Stack:** The app's own browser JavaScript (`ui/app/*.js`, joined in name order by `core/crates/server/build.rs`; a new file there is picked up by its name) and CSS (`ui/wave.css`, `ui/app-css/*.css`); Playwright browser tests (`tests/ui/*.spec.mjs`, `import { test, expect } from './test.mjs'`).

**Spec:** `docs/WAVE-WHOLE-WINDOW.md` (read it first). The agreed look is `page-mockups/wave-window-a6.html`: open it beside the real page at every task.

## Global Constraints

- Above the breakpoint nothing scales: panels, knobs and fonts keep one size; nothing grows, shrinks or reflows into more or fewer columns. Only the middle gives or takes space.
- The dock is 440 px wide, in the same place, on Play, Create, Matrix and FX.
- The keyboard stays 812 × 100 (`#wvKeys`) at 1:1.
- Below the breakpoint, one scale for all of Wave's tabs, set by the largest tab's smallest size. The rail and the app's transport bar keep their size.
- RJ's iMac shows Play at 1:1. Its page area is about 2080 × 1100: test at that viewport.
- No control is removed from any tab. Every envelope and LFO control stays on Play (RJ: "Keep every control").
- A rebuilt effect's controls, ranges and defaults don't change; no recorded hash may move (this work touches no Rust).
- Every knob carries its picture (`ui/app/073a-ui-knob.js`, `docs/CONTROL-PICTURES.md`).
- SoundHack faces: the app's look everywhere they appear (Prism's FX tab, Grain, Wave). Nothing of the white, Arial Black SoundHack look stays.
- Tests run on the MacBook only: `tools/pc/test-on-mbp.sh <spec>` from this worktree. Never on the iMac. Write each test first and watch it fail.
- No credit lines in commits. Commit messages in the repo's plain style.

## Review Focus

1. **A board whose chain doesn't reach Out yet, or has a node nothing feeds.** The dock still shows every effect, the stranded ones last under "not connected", and nothing throws. (Task 4.)
2. **A board change while the dock is scrolled** (add, delete or reorder an effect on FX, then come back to Play). The dock keeps its place by node, not by pixel, and a deleted node's card is gone. (Task 5.)
3. **Resizing across the breakpoint while playing.** The scale changes at once on every tab, nothing scrolls sideways, and the keyboard still plays the key under the pointer at the new scale (`wvKeyAt` reads `WV.scale`). (Task 1.)
4. **The longest effect face** (the most controls, e.g. a Network reverb or the SoundHack spectral suite). It fits the dock's width with nothing clipped, in the inspector and in the chain dock. (Tasks 2, 7.)
5. **A source dragged from MORE SOURCES onto a control in the dock or the effects row.** It maps as it does on the board today (a `board:` mod row). (Task 6.)

---

### Task 1: The frame fills the window, and scales only below its smallest size

**Files:**
- Modify: `ui/app/394-wave-page.js` (`wvBuild` markup, `wvFit`, the `WV_W`/`WV_H` constants), `ui/wave.css` (`#waveView .wv-app` and the view sections)
- Modify: `tests/ui/synth-pages.spec.mjs` (the test "Wave: no overview, the one keyboard, one size…": `WV.scale` is 1 at the iMac's size, not always)
- Test: `tests/ui/wave-window.spec.mjs` (new)

**Interfaces:**
- Produces: `#wvRdock`, an element in `.wv-app` beside the middle, 440 px wide, filled by later tasks. `#wvMid`, the middle that holds the four `.wv-view` sections. `WV_MIN = { w, h }`: the frame's smallest size at 1:1, the largest over the four tabs. `wvFit()` sets `WV.scale = Math.min(1, cw / WV_MIN.w, ch / WV_MIN.h)` and applies it to `.wv-app` as one transform; `.wv-app`'s own size is the host's divided by the scale, so the scaled frame exactly fills the host.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests** in `tests/ui/wave-window.spec.mjs`. Open Wave by the rail (`.rl-item[data-mode="synth"]`, wait for `WV.built`), as `synth-pages.spec.mjs` does.
  - `at the iMac's size the frame fills the window at one size`: at viewport 2080 × 1100, `WV.scale === 1`; `#wvRdock` width is 440 on each of the four tabs (`#wvViews [data-v]`), and its left edge is the same on all four; `#waveView`'s `scrollWidth <= clientWidth` and `scrollHeight <= clientHeight`; `#wvKeys` is 812 × 100; the frame's right and bottom edges are within 2 px of `#waveView`'s.
  - `the middle grows with the window and nothing else does`: at 2080 and at 2300 wide, `#wvRdock` and `#wvKeys` keep their sizes, `#wvMid` is 220 px wider at 2300.
  - `at the laptop's size the whole frame scales, once for every tab`: at 1440 × 900, `0 < WV.scale < 1`, the same value on all four tabs, no scroll either way, and `#wvRdock`'s drawn width (bounding box) is `440 * WV.scale` on every tab.
  - `scaled, the keys still play the key under the pointer`: at 1440 × 900, a press at the centre of the drawn middle C key (from `wvKeyLayout()` times `WV.scale`) starts note 60 (`WV.held` or the `/api/wave/note` request it posts).
- [ ] **Step 2: Run them and watch them fail.** `tools/pc/test-on-mbp.sh wave-window`. Expected: FAIL (`#wvRdock` not found; `WV.scale` is 1 at 1440).
- [ ] **Step 3: Build the frame.** In `wvBuild`, wrap the four views in `#wvMid` and add `#wvRdock` after it; keep `.wv-head` across the middle and the dock, and `.wv-dock` (the keys) across both under them. Grid in `wave.css`: columns `1fr 440px`, rows `auto 1fr auto`. Replace the fixed `width: 1460px; height: 862px` with the host's size over the scale. Work out `WV_MIN` from the views' own fixed sizes (A6 puts Play at about 2002 × 1080 including the app's transport; measure, don't copy). Rewrite `wvFit` as in Interfaces, keeping its `ResizeObserver`.
- [ ] **Step 4: Run them and watch them pass**, with `synth-pages` updated as listed. `tools/pc/test-on-mbp.sh wave-window synth-pages wave-synth wave-board wave-matrix`. Expected: all pass.
- [ ] **Step 5: Commit.** `feat(wave): the page fills the window, one dock on the right; it scales only below its smallest size`.

### Task 2: FX: the board takes the middle, the inspector moves into the dock

**Files:**
- Modify: `ui/app/396-wave-board-canvas.js` (`wvBuildFx`: no fixed `wv-fcan` width; `#wvFinsp` is no longer built inside the view), `ui/app/397-wave-board-inspector.js` (`wvRenderInspector` renders into the dock while the FX tab shows), `ui/wave.css` (`.wv-fcan`, `.wv-finsp`)
- Test: `tests/ui/wave-window.spec.mjs`

**Interfaces:**
- Consumes: `#wvRdock` (Task 1).
- Produces: on FX, `#wvRdock` holds `#wvFinsp`, the inspector exactly as today. The Master Bus bar (the board presets) and the MOD FROM strip stay above the board in the middle.

- [ ] **Step 1: Write the failing tests.**
  - `on FX the board fills the middle`: at 2080 × 1100, the board's well `.wv-fwell` is at least `#wvMid` width minus 40 and reaches within 20 px of the keys; `#wvFinsp` is inside `#wvRdock`.
  - `every effect's face fits the dock`: for every kind in `WV_FXCAT.list`, add the node to a board posted by the test (as `wave-board.spec.mjs`'s `board()` builds them), select it (`wvBoardSelect({ t: 'node', id })`) and check `#wvFinsp`'s `.wv-rackface` and each child have `scrollWidth <= clientWidth + 1`.
- [ ] **Step 2: Run and watch them fail.** `tools/pc/test-on-mbp.sh wave-window`. Expected: FAIL (the well is 1082 wide; SoundHack faces overflow).
- [ ] **Step 3: Move the inspector into the dock and let the board take the middle.** Faces that still overflow at 416 px of content are fixed in their own CSS, not by scaling them.
- [ ] **Step 4: Run and watch them pass**, with `wave-board` and `fx-faces`. Expected: all pass.
- [ ] **Step 5: Commit.** `feat(wave): the FX board takes the middle; the inspector is the dock`.

### Task 3: Play shows every envelope and every LFO, with every control

**Files:**
- Modify: `ui/app/391-wave-play.js` (`wvBuildPlay`: the rows), `ui/app/391c-wave-tiles.js` (`wvBuildPlayTiles`; no slots on Play), `ui/wave.css` (the Play rows)
- Test: `tests/ui/wave-window.spec.mjs`; update `tests/ui/wave-synth.spec.mjs` where it drives Play's slot buttons

**Interfaces:**
- Produces: Play's eight tiles, `[data-p="p"][data-tile]` for `amp`, `env1`, `env2`, `env3`, `lfo0`, `lfo1`, `lfo2`, `lfo3`, all on screen at once. Each is built by today's `wvEnvTile` / `wvLfoTile` (the Matrix view's size, or a size between it and today's big one), so each keeps every control: the drawn shape you drag, the readings, and for an LFO the shape, `data-lmode` and `data-lsync`.
- `WV.slot` and `wvSetSlot` are no longer used by Play. Keep them only if Matrix still needs them.

- [ ] **Step 1: Write the failing tests.**
  - `Play shows every envelope and LFO at once`: the eight tiles are visible; none has `.wv-slot`; every LFO tile has `[data-lmode]` with Free, Trig and Env, and `[data-lsync]` with Hz and Sync.
  - `Play fits the iMac at one size`: at 2080 × 1100 on Play, `WV.scale === 1` and no scroll either way.
  - `an envelope's point still drags on Play`: drag Env 3's attack handle on its canvas and see `wvG('env2.a')` change (the key for the tile named ENV 3 is `env2`).
- [ ] **Step 2: Run and watch them fail.** Expected: FAIL (only one ENV and one LFO slot tile showing).
- [ ] **Step 3: Lay Play out in the four rows A6 shows.** The rows are: oscillators and filters; the eight tiles; mix, voice and MORE SOURCES; then the effects row (Task 6 fills it; leave its place). Pack the panels tighter, not smaller in type, until the iMac fits at 1:1.
- [ ] **Step 4: Run and watch them pass**, with `wave-synth`, `wave-matrix` and `synth-pages`. Expected: all pass.
- [ ] **Step 5: Commit.** `feat(wave): Play shows every envelope and LFO, every control on each`.

### Task 4: The chain as the sound goes

**Files:**
- Create: `ui/app/397b-wave-chain.js`
- Test: `tests/ui/wave-chain.spec.mjs` (new)

**Interfaces:**
- Produces: `wvChainLayout(board) -> { items: Item[], unconnected: string[] }`. `Item` is one of:
  - `{ t: 'node', id }`, an effect on the one path;
  - `{ t: 'split', from: id | 'in:voice', to: id | 'out', paths: Item[][] }`, where the sound divides and meets again, each path an ordered list (paths may hold splits of their own);
  - `{ t: 'send', from: 'in:osc0' | 'in:osc1' | 'in:osc2' | 'in:sub' | 'in:noise', to: id | 'out', path: Item[] }`, a path fed by an oscillator's send, placed just before the node it meets.
  - `unconnected` holds the effect nodes on no path from an input to Out, in board order.
  - Only effect nodes appear as `node` items (`wvIsFx`). Routing nodes (splits and mixes) become the structure, and inputs and Out the ends. Pure: reads only `board.nodes` and `board.cables`.

- [ ] **Step 1: Write the failing tests**, each posting nothing and calling `wvChainLayout` in the page on a board built in the spec:
  - a straight chain `in:voice > drive > echo > out` gives `items` = node drive, node echo;
  - A6's board, where `drive` splits into `chorus > echo > spec` and `mesh > plate`, both into `eq`, then `out`, gives node drive; a split from drive to eq whose paths are [chorus, echo, spec] and [mesh, plate]; then node eq;
  - a send `in:osc1 > mesh > eq` with the voice through `drive > eq > out` gives node drive; a send from `in:osc1` to eq with path [mesh]; then node eq;
  - a board whose path stops short of Out lists the rest as `node` items as far as they reach, and the nodes not reached in `unconnected`;
  - a node with no cables at all is in `unconnected` only.
- [ ] **Step 2: Run and watch them fail.** `tools/pc/test-on-mbp.sh wave-chain`. Expected: FAIL (`wvChainLayout is not defined`).
- [ ] **Step 3: Implement `wvChainLayout`.** Walk from `in:voice` along `wvMainPath()`'s order. Where a node feeds more than one place, follow each branch until the branches meet (the first node every branch reaches) and make a split. Sends are the same walk from each `in:osc*`/`in:sub`/`in:noise` input that has a cable.
- [ ] **Step 4: Run and watch them pass.**
- [ ] **Step 5: Commit.** `feat(wave): the board's chain as the sound goes, splits and sends`.

### Task 5: The dock holds every effect on Play, Create and Matrix

**Files:**
- Modify: `ui/app/397b-wave-chain.js` (the dock's drawing), `ui/app/394-wave-page.js` (`wvShowView` fills the dock per tab), `ui/wave.css`
- Test: `tests/ui/wave-chain.spec.mjs`

**Interfaces:**
- Consumes: `wvChainLayout` (Task 4), `#wvRdock` (Task 1), `wvMountRackFace(el, node)` (`397-wave-board-inspector.js`), `wvBoardParam(id, 'on', …)`.
- Produces:
  - `wvRenderChainDock()`, which draws `#wvRdock` on every tab but FX: a heading, then each item with its whole face, the wire down the left, splits as a dashed box labelled "SPLITS AFTER <name>, INTO <name>" with each path labelled "PATH n · k EFFECTS", sends labelled "FROM OSC B", and "not connected" last.
  - Each card is `[data-card="<node id>"]`, with a power button (`wvBoardParam(id, 'on', …)`) and "⋀ FX ›", which shows FX with that node selected.
  - `wvDockScrollTo(id)`.
  - The dock scrolls with the wheel and keeps its place by node across board changes.

- [ ] **Step 1: Write the failing tests:**
  - `the dock on Play lists every effect in the chain's order`, on A6's board, by `[data-card]` order and the split's labels;
  - `⋀ FX opens that effect on the board` (FX shows, `WV_BOARD_VIEW.sel.id` is it);
  - `power on a card turns its node off` (the board's node has `on: false`);
  - `the dock keeps its place by node`: scroll to Plate, delete Mesh on FX, back to Play, Plate's card is still at the top;
  - `the dock is the same on Create and Matrix`;
  - `every face fits the dock` (the Task 2 check, on the chain dock).
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement `wvRenderChainDock` and `wvDockScrollTo`.** The look is A6's: the wire, the dashed box and the labels.
- [ ] **Step 4: Run and watch them pass**, with `wave-board`.
- [ ] **Step 5: Commit.** `feat(wave): the dock holds every effect, as the sound goes, on every tab but FX`.

### Task 6: The effects row under the synth on Play

**Files:**
- Modify: `ui/app/391-wave-play.js` (the row in `wvBuildPlay`), `ui/app/397b-wave-chain.js` (`wvRenderFxRow`), `ui/wave.css`
- Test: `tests/ui/wave-chain.spec.mjs`

**Interfaces:**
- Consumes: `wvChainLayout`, `wvDockScrollTo`, `wvFacePr(node)` (the node's main controls on the board, `395-wave-board.js`), `wvWireBoardKnobs`.
- Produces: `wvRenderFxRow()`. One card per effect `[data-fxcard="<id>"]` in the layout's order, flattened. Each card has a power button and the effect's four main controls as knobs with their pictures; the controls take a dropped source as the board's do. A click on a card (not on a knob) calls `wvDockScrollTo(id)` and marks the dock's card `.sel`. Cards are one size; extra cards scroll sideways.

- [ ] **Step 1: Write the failing tests:**
  - `the row has every effect in order, four controls each`;
  - `a click on a card takes the dock to it`: the dock's `[data-card=<id>]` top is within the dock's view and has `.sel`;
  - `a knob on a card moves the node's control` (`wvBoardParam` posts it);
  - `a source dropped on a card's knob makes a board row` (as the `wave-board` test does on the board).
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement `wvRenderFxRow`** in the place Task 3 left, at A6's size.
- [ ] **Step 4: Run and watch them pass**, with `wave-window` (Play still fits at 1:1).
- [ ] **Step 5: Commit.** `feat(wave): every effect's main controls in a row under the synth`.

### Task 7: The SoundHack faces in the app's look

**Files:**
- Modify: `ui/app/076-fx-suites.js` (`fxSoundHackFace`), `ui/app-css/080-fx-faces-visual.css` (every `.sh-*` rule)
- Test: `tests/ui/fx-faces.spec.mjs`

**Interfaces:**
- Consumes: the shared knob (`uiKnobHtml`, `uiKnobPaint`) and its pictures; the app's tokens (`--look-*`, `--on`).
- Produces: the same controls, keys and behaviour per face. Only the look changes. The face is the pattern A6's Spectral Dynamics shows: dark sections named in the app's small capitals, knobs with their pictures, the app's segmented buttons with an icon each, and the sound picker row.

- [ ] **Step 1: Write the failing tests** for every `sh-*` effect (`sh-bubbler`, `sh-chebyshev`, `sh-compand`, `sh-decimate`, `sh-delay`, `sh-flipper`, `sh-matrix`, `sh-phasor`, `sh-pitchdelay`) and every mode of the SoundHack spectral suite, in the Prism FX tab's rack:
  - no element's computed `font-family` contains "Arial Black";
  - the face's background is dark (relative luminance under 0.1);
  - the number of controls equals the shaper's `params.length`;
  - every knob has its picture (Task 8's check);
  - moving one control still sends its key.
- [ ] **Step 2: Run and watch them fail.** `tools/pc/test-on-mbp.sh fx-faces`. Expected: FAIL on the font and the background.
- [ ] **Step 3: Restyle `fxSoundHackFace` and the `.sh-*` CSS.**
- [ ] **Step 4: Run and watch them pass**, with `grain-synth-rack`, `prism-deck` and `wave-board` (the same faces show there).
- [ ] **Step 5: Commit.** `feat(fx): the SoundHack faces in the app's own look`.

### Task 8: Every control has its picture

**Files:**
- Test: `tests/ui/control-pictures.spec.mjs` (add)
- Modify: whichever builders the test finds lacking (the Wave tabs, the dock, the effects row, the rack faces)

**Interfaces:**
- Produces: `cpBlank(knob) -> boolean`, a test helper in the spec. A `.ui-kn` is blank when its face has no drawn picture: no `canvas` with a non-transparent pixel, no `svg` path with a `d`, and no `.pic` beside a 26 px cap.

- [ ] **Step 1: Write the failing test** `every knob on Wave has its picture`, for each tab, the dock and the effects row. It collects every `.ui-kn` that `cpBlank` finds and fails with their labels listed.
- [ ] **Step 2: Run and watch it fail.** The list it prints is the audit; put it in the report.
- [ ] **Step 3: Draw a picture for each knob listed,** in `docs/CONTROL-PICTURES.md`'s language: what the control moves in colour, the context dim, drawn from its value.
- [ ] **Step 4: Run and watch it pass**, with `control-pictures` whole.
- [ ] **Step 5: Commit.** `feat(wave): a picture on every control`.

### Task 9: The write-up and the whole run

**Files:**
- Modify: `docs/WAVE-SYNTH.md` (a section on the frame, the dock, the chain and the row)

- [ ] **Step 1:** Write the section, pointing to `docs/WAVE-WHOLE-WINDOW.md`.
- [ ] **Step 2:** Run the whole browser suite on the MacBook (`tools/pc/test-on-mbp.sh`, no spec named). Expected: no failure that does not also fail on main (run main's suite for the comparison if there are any, and list both).
- [ ] **Step 3:** Screenshots at 2080 × 1100 and 1440 × 900 of Play and FX, next to A6's, into `page-mockups/a6-built/`.
- [ ] **Step 4: Commit.** `docs(wave): the whole-window page`.
