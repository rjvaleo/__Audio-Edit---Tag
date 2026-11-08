# The top bar

Written 1 Nov 2026, when it was built. `ui/rail.js`, `ui/rail.css`,
`ui/sequencer/bridge.js` and `style.css` (`in-app`), `tests/ui/top-bar.spec.mjs`.
It replaced the left rail (`docs/RAIL.md`).

```
File Edit Action DSP Audio Window View │ Edit Grain Prism Chop Wave Visual Seq Browse │   ▶ ■ ⟲ ●  GRAIN SEQ │ 00:00.000 ▬   │ Theme  Mic  ⚙ Settings
```

## Why

Measured at 1600 × 1000, with Seq open:

- **The rail** was 168px of the width for six buttons, with 655px of nothing
  under them. Its buttons were four kinds of thing dressed as one: workspaces
  (Grain, Visual, Seq), a drawer (Theme), a library with parts (Browse) and an
  action (Record).
- **Above the work** sat the menu bar (25px), the overview strip (42px, empty
  in Seq), and the sequencer's own title (53px) and transport (106px): 226px
  before the first synth knob.
- **Play and Stop** were on screen twice, and **Record** three times, doing
  three different things in the same red.
- **The sequencer** was a second program: its own palette, two display faces
  (Teko, Share Tech Mono) against the app's Inter, eight type sizes, and 307
  labels at 8 or 9px.

## What it is

**One row, 40px.** Left to right:

| Group | What | Why there |
|---|---|---|
| Menus | File … View | The commands you look for. Dimmed, so the eye lands on the workspaces. |
| Workspaces | Edit, Grain, Prism, Chop, Wave, Visual, Seq, Browse | Where you are. Words, lit as a tab. Browse's own parts (All sounds, Search, Scan, Folder, Map) appear beside it while it is lit. |
| Transport | ▶ ■ ⟲ ●, GRAIN / SEQ, the clock, the level | One for every workspace that plays. Absent in Browse, which auditions from its own list. |
| What opens | Theme, Mic, Settings | Panes and dialogs, not places. |

**The rail's markup is unchanged.** `rail.js` still emits `#leftRail` with the
classes and data attributes `app.js` reads, moves it into the bar, and the
stylesheet sets it to `display: contents` so its buttons are laid out by the
bar's row. Every click handler, the `.rl-on` logic and every test that clicks a
rail button work as they did. The transport's buttons are moved in by id, so
the handlers `app.js` binds to them still find them. What stays in
`#transportBar` is the editor's — the file's name, the zoom, the follow mode —
and it is hidden in Seq, where there is no waveform for it to act on.

**The overview strip is the editor's.** It is the file's waveform with the zoom
window on it, and only the editor zooms. It is gone from Seq, where it was 42px
of black, and from Visual, where it was 42px taken from the room and its column
— which is what paid for the bar being 15px taller than the menu bar was.

**One record button.** The transport's ● captures what is playing. The rail's
red Record, which opens the pane that records the microphone into the library,
is now **Mic**, with a microphone. The sequencer's own ⏺ REC is gone in the app.

**One Play for the sequencer.** The engine's Play needs a sound open, which is
why the sequencer kept its own. With no sound open, in Seq, the bar's Play and
Stop run the sequencer's own clock (`seqTransport` in `rail.js`); with a sound
they are the engine's, and the sequencer follows as before.

## The sequencer, inside the app

`bridge.js` adds `in-app` to the page and copies the host's tokens onto the
page's own — `--bg`, `--surface`, `--accent`, `--warn`, `--good`, `--text`, the
faces — and again whenever the host's root element changes, so the Theme
drawer recolours the sequencer too. `style.css`, under `in-app`:

- no title; no Play, Stop or REC (the bar has them);
- the toolbar laid on its side, one row: tempo, steps, position, direction,
  step length, presets;
- Inter for words, the host's mono for readouts, nothing under 10px;
- **the step grid takes the height it is given**, and each card is filled from
  the bottom to its pitch across the pattern's own range, so the row reads as
  the melody's shape. The band of nothing under the grid is gone.

## Ported onto main, 7 Nov 2026

Built on 1 Nov, it waited while main went the other way on 4 Nov: the menu bar
unlisted, Settings, Analytics and Help moved to a foot under the rail, and Edit,
Prism, Chop and Wave added as rail pages. RJ chose the whole top bar over that,
so on main now:

- `MENUBAR_LISTED` is `true` again (`ui/app/290-menus.js`): the menus are back,
  as the bar's left end.
- The rail's foot is not drawn. Settings is the bar's gear, Analytics is
  View › Analytics, and Help is the Help menu.
- The newer pages are workspaces in the bar like the rest, in the rail's order.

## Narrower windows

At 1440px the right-hand labels go (icons stay, named in their titles); at
1280px the workspaces lose their icons and keep their words, and the level
slider goes. The bar fits at 1000px.

## Not done

- **Compose** is still unlisted (`COMPOSE_LISTED` in `rail.js`).
- The sequencer's scale library is still its own 280px column.
