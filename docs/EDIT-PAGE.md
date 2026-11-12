# The Edit page, and the Now Playing bar

Redesigned 10 Nov 2026. The design and the mock-ups are in the work folder: `edit-redesign/ARCHITECTURE.md`,
`PROPOSALS-2.md`, and the approved mock-up `edit-D-studio-surface.html`. RJ picked D: A's look (WaveLab's tabs,
rulers and counters) with C's editing on the wave. He had asked to look at the best editors, at WaveLab and the old
Peak, and said "I don't like the right tray". So the wave takes the whole width.

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
  - the output meter, polled only while something plays;
  - the Look.
- **The Look is one setting for the whole app.** It is Grain's five, kept under `mglLook` and set on
  `:root[data-mgl-look]`. The bar sets it, and Chop and the Edit page follow.
- **In Browse and on Wave** Play plays the selected library file raw, as Space already did there.
- **On the Prism page the bar is the Prism deck's** (`prismOwnsBar`, `ui/prism-pad.js`; RJ, 11 Nov 2026: one
  transport). Play/pause, stop, loop and Space act on Prism's own sound; the clock, the name and the strip are its,
  and clicking the strip seeks it. GRAIN, SEQ and the tempo are the main sound's, so they are hidden there. Prism's
  own play, stop and loop are gone; its take controls are the pad's and stay. Leaving the page hands the bar back
  to the main sound.

Before this the play button sat somewhere different on six pages and was missing on two.

## The Edit page (`body.wavepage`)

| File | What it does |
|---|---|
| `ui/app/310-edit-page.js` | The commands (`WT_GROUPS`), the sections and Customize. A section belongs to a tab: `ED_TABS`, `ED_TAB_OF`. |
| `ui/app/411-edit-sound.js` | The document's own samples (`/audio?dry=1`), measured in a worker by Chop's `chopAnalyseCore`: band energies, hits, loud spots, levels. |
| `ui/app/412-edit-tabs.js` | The tabs, and the knobs that answer the old dialogs (`edRun`, `askAnswer`). |
| `ui/app/413-edit-wave.js` | The time ruler, the level ruler, Rainbow colour, hits and loud spots, the counters, and the meters that slide out. |
| `ui/app/414-edit-hands.js` | The fade handles, the level pill, dragging an edge, the loupe, and the preview while a handle is held. |
| `ui/app/415-edit-keys.js` | The pie on right-click, and ⌘K. |
| `ui/edit.css` | All of it, and the bar. |

- **Tabs.** View, Edit, Process, Correct, Analyze, Markers and Render, over the ribbon's own sections. Customize
  works as before, on the open tab.
- **Knobs answer the dialogs.** Gain, Normalize, Normalize (RMS), Strip silence, Insert silence, Repair click and
  Duplicate keep their settings as knobs beside the command, and in their row in ⌘K. The command runs exactly as it
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
- `tests/ui/edit-page.spec.mjs` covers what it always did, tab by tab.
- `controls-parity` takes the transport from `#nowBar, #transportBar`.
