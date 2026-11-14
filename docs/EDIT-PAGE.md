# The Edit page, and the Now Playing bar

Redesigned 10 Nov 2026. The design and the mock-ups are in the work folder: `edit-redesign/ARCHITECTURE.md`,
`PROPOSALS-2.md`, and the approved mock-up `edit-D-studio-surface.html`. RJ picked D: A's look (WaveLab's tabs,
rulers and counters) with C's editing on the wave. He had asked to look at the best editors, at WaveLab and the old
Peak, and said "I don't like the right tray". So the wave takes the whole width.

On 13 Nov 2026 the seven tabs went (RJ: "The tabs is too much"): every command is on one bar.

On 14 Nov 2026 that bar moved from along the top to down the right-hand side, the whole height, with each section
titled and the meters at its foot, and the page took Grain's colours. RJ: "Instead of having them all along the
top, how about a bar on the right-hand side? … let's have them titled by group so I know what I'm looking at. And
put those meters at the bottom of that", and "Make sure everything's the same color". This is a bar of tools, not
the tray he turned down on 10 Nov: the wave still runs from the left edge to the bar.

## The Now Playing bar

The transport, on every page, in one place: a 48 px bar across the top from the rail's edge (`#nowBar`,
`ui/app/410-now-bar.js`).

- **The controls are the app's own** (`#playBtn`, `#stopBtn`, `#loopBtn`, `#recBtn`, `#srcGrain`, `#srcSeq`,
  `#timeNow`, `#volume`), moved into the bar for good. Nothing borrows or mirrors them now:
  - Chop borrows only the file tabs.
  - Grain v12 hides the copies it carried (`.gs-tp`).
  - The room and Compose still move `#transportBar`, which is left with the file name, the zoom and the follow.
- **Beside them:**
  - the sound as a strip (the overview's own peaks); click it to go there;
  - the tempo: Chop's when it has counted this sound, the library's otherwise;
  - the output meter, polled only while something plays.
- **The Look is one setting for the whole app.** It is Grain's five, kept under `mglLook` and set on
  `:root[data-mgl-look]` by `nbSetLook`; Chop and the Edit page follow. It is chosen on the Theme page: the
  bar's own five buttons went on 14 Nov 2026 (RJ: "Take the Look buttons out of the bar").
- **In Browse and on Wave** Play plays the selected library file raw, as Space already did there.
- **On the Prism page the bar is the Prism deck's** (`prismOwnsBar`, `ui/prism-pad.js`; RJ, 11 Nov 2026: one
  transport). Play/pause, stop, loop and Space act on Prism's own sound; the clock, the name and the strip are its,
  and clicking the strip seeks it. GRAIN, SEQ and the tempo are the main sound's, so they are hidden there. Prism's
  own play, stop and loop are gone; its take controls are the pad's and stay. Leaving the page hands the bar back
  to the main sound.

Before this the play button sat somewhere different on six pages and was missing on two.

## The overview, on every page

The whole open file, in one strip under the Now Playing bar, the full width of the centre (`#pageOv`,
`ui/app/416-page-overview.js`, `ui/app-css/095-page-overview.css`). RJ, 14 Nov 2026: "We want the waveform overview
in the same place on every page. So as you click from page to page, the waveform overview should not change, but
everything under it … should." It is one element, so it is the same on every page.

- **Where:** Edit, Grain, Prism, Chop, Wave, Seq, Atmosphere, the room and Compose (`PO_MODES`, set by `poSync`
  from `setMode`). Not Browse or Theme.
- **What it shows:** the file in the sound's colours (`edColourAt`, plain until measured), the time, markers and
  regions, the loop (outside dimmed, its two brackets), the green Start flag and the playhead; on Grain, each Poly
  voice's head and a held note's. It was Grain's overview (`gsDrawOverview`) and keeps all of its gestures:
  - drag a bracket to move an end of the loop; drag across for a new loop; click, or drag the flag, for Start;
  - ⌥-drag scrubs and leaves the loop and Start alone; a region's strip along the bottom selects that region.
  - On Prism the open file is not seeked from here (Prism plays its own sound on the transport); the loop and Start
    are still set.
- **Zoom:** the wheel zooms round the pointer, ⇧-wheel or a sideways wheel pans, and −, + and Fit sit at its right
  end (+ zooms round the head, or Start while nothing plays). Zoomed in, a thin bar along the top shows which part of
  the file is in view, and the part in view is read again at the strip's own width. Double-click is the whole file.
  The zoom is per sound.
- **Height:** drag the grip along its bottom edge, 48 to 240 px; it is kept (`mgl.pageOverview.h`), and a
  double-click on the grip puts back 72 px. Prism's SOURCE well has the same grip (`mgl.prismSource.h`, 58 px).
- **What each page lends it.** The Edit page's own `#overview` and Chop's are hidden; their parts are here:
  - Wherever the lane shows (the Edit page, mostly), the lane's zoomed window is a box on the strip, and dragging
    inside the box pans the lane, as `#overview` did. A click in the box still moves Start.
  - On Chop, Chop's cuts are lines the full height of the strip, Chop's detail is the box, and a double-click fits
    the detail to the whole sound, as Chop's overview did.
- **On Grain** the strip stands where the page's own overview was (`.gs-ov`, gone). SOURCE, which shows only the loop,
  with its sound picker, chips and its own zoom, runs the full width under the engine tabs (`#gsCloud`, 1338 × 128),
  and the shared controls and the engine panel sit side by side under it. The page is laid out at 1388 × 990
  (`GS_W`, `GS_H`) and scaled whole, as before: the engine panel still has to hold Hybrid's sections.
- **Drawing:** its own frame loop while it shows, on every page, drawing only when what it shows has changed (a key,
  as Grain's `gsTick` keeps). On pages that do not measure the sound themselves it asks `edLoadSound` once per sound
  for the colours; Grain hands over the samples it reads, and Prism measures its own sound.

## The Edit page (`body.wavepage`)

| File | What it does |
|---|---|
| `ui/app/310-edit-page.js` | The commands (`WT_GROUPS`), the sections and Customize. Their order along the bar, and what starts hidden: `ED_BAR_ORDER`, `ED_BAR_HIDDEN`. |
| `ui/app/411-edit-sound.js` | The document's own samples (`/audio?dry=1`), measured in a worker by Chop's `chopAnalyseCore`: band energies, hits, loud spots, levels. |
| `ui/app/412-edit-tabs.js` | The tooltips, the ▾ and its pop-up, and the knobs that answer the old dialogs (`edRun`, `askAnswer`). |
| `ui/app/413-edit-wave.js` | The time ruler, the level ruler, Rainbow colour, hits and loud spots, the counters, and the meters (`edPaintMeters`). |
| `ui/app/414-edit-hands.js` | The fade handles, the level pill, dragging an edge, the loupe, and the preview while a handle is held. |
| `ui/app/415-edit-keys.js` | The pie on right-click, and ⌘K. |
| `ui/edit.css` | All of it, and the bar. Its colour names (`--m-*`, `--mgl-*`) are aliases of the look tokens. |
| `ui/index.html` | `#edSide`, the column on the right: `wtBuild` puts `#waveTools` in it, above `#edMeters`. |

- **One bar, down the right** (`#edSide`, 224 px; 184 px in a window narrower than 1100 px). It is on the Edit page
  only: Grain, Chop and the rest do not have it.
  - Every section under the one before, in `ED_BAR_ORDER`: editing first, how the wave is shown and Export last.
    Each has its title over it (History, Clipboard, …), and its icons in a grid, five to a row. The icons carry no
    words; the tooltip gives the name, the key, and the settings the command will run with.
  - A command with settings has its ▾ beside it in the same cell. Its knobs open to the left of the bar, level
    with the command, so they do not cover the commands below.
  - The sections scroll when the window is shorter than they are. Customize is at their foot.
  - **The meters** are under the sections, at the foot of the bar, always out: peak and RMS of the selection (or
    the whole sound), its bands, and how many hits and loud spots. Until 14 Nov they were a METERS tab on the
    lane's right edge that slid out on hover.
  - The file tabs and ⌘K stay along the top. Nothing else is up there now.
  - Selection (Select all, Deselect, Set selection, Go to) starts hidden: its keys and the menus do it. It is in
    ⌘K, and Customize brings it back.
  - Customize works as before. While it is on, the words come back under the icons, three to a row, so there is
    something to pick up, and the titles can be renamed in place.
  - The layout is kept under `editBar`. The tabbed layout was kept under `editToolbar` and is no longer read.
- **Grain's colours and materials.** Edit's own colour names are aliases of the look tokens (`015-tokens.css`),
  the way Grain's `--gs-*` are (`grain.css`): `--m-chassis` is `var(--look-chassis)`, `--m-wave` is
  `var(--look-wave)`, `--mgl-acc` is `var(--on)`, and so on. So the default and every theme paint Edit, the Now
  Playing bar and Grain alike, and "on" is the theme's.
  - Until 14 Nov 2026 they were hex for each `data-mgl-look`. A theme never reached them, so Edit could differ
    from Grain.
  - The five Looks still work: each is a theme now (`LOOK_THEMES`, `theme-palettes.js`), and wearing it sets its
    look tokens (`applyChosenTheme`, `330-theme.js`), which were the same values Edit held. What stays keyed on
    `data-mgl-look` is the material: Glass's panes and drift, Ceramic's round corners and dotted knobs,
    Acrylic's coloured edge, drawn with the tokens Chop uses (`--look-glass`, `--look-acrylic`, `--look-edge-*`).
  - The materials are Grain's: the bar, the meters and the counters are `.gs-panel`'s; the overview, the lane and
    the meters' wells are `.gs-well`'s shading; the chassis behind them is `#grainView`'s. The wave is drawn in
    `--m-wave` (`waveInk`, `010-library.js`), which is Grain's `--gs-wave`.
  - The meters' and recording's colours are colours with a meaning, and no theme changes them.
- **Knobs answer the dialogs.** Gain, Normalize, Normalize (RMS), Strip silence, Insert silence, Repair click and
  Duplicate keep their settings as knobs behind a ▾ beside the command (`#edKnobs`, with the command itself to run
  them), and in their row in ⌘K. The command runs exactly as it
  always did, with its dialog answered in advance: same checks, same edit op, same message. The menus still open
  the dialog.
- **Editing on the wave.**
  - **Fades:** drag the orange square at either top corner of a selection.
  - **Level:** drag the pill up or down.
  - While you hold, the result is drawn over the selection from the document's own samples. Letting go sends one
    edit op, the one the button sends (`fadeIn` with `frames`, or `gain` with `db`), and the selection and the view
    are put back (`edKeepPlace`).
- **Edges.** Pressing within 6 px of a selection's edge picks that edge up instead of starting a new selection.
  - It lands on the nearest zero crossing when Snap is on Zero, and on the nearest hit when Snap to hits is on.
  - A loupe shows the samples at the edit point, green when it is on zero.
- **Right-click** on the wave opens a pie of eight commands with ⌘K in the middle. Elsewhere it is still the Edit
  menu.
- **⌘K** lists every command by name, section and key. Commands with settings have their knobs in the row.
- **Rainbow:**
  - The waveform and the overview are coloured by Chop's Spectrum view: low violet, mid green, high white.
  - Hits are ticks along the top of the wave; the loudest spots (within 3 dB of the loudest) are triangles along
    its foot.
  - The level ruler is in dB, per channel, against the half-height `drawWave` uses.
- **Counters:** cursor, start, end, length, peak, RMS and how much is shown. With no selection they are the whole
  sound's, and say so.

## Tests

- `tests/ui/edit-d.spec.mjs`:
  - the bar on every page, in the same place;
  - knobs answering dialogs;
  - the fade handle and the level pill, one op each, with the selection and the view kept;
  - edges;
  - the pie and ⌘K;
  - the counters and the rulers;
  - the Look.
- `tests/ui/edit-page.spec.mjs` covers what it always did, plus the one bar down the right with its titles and
  the meters at its foot, that Grain does not have it, and the ▾ settings.
- `controls-parity` takes the transport from `#nowBar, #transportBar`.
