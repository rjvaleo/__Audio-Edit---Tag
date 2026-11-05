# Analytics

*How the app is actually used, so the interface can be shaped around it.
Recorded on this machine, kept in the data folder, never sent anywhere.*

Open it from **View › Analytics**. Esc or ✕ closes it. The app underneath keeps
running and keeps playing.

## What it shows

**Overview**
- **Totals strip:** sessions, active time (idle left out), events, controls touched out of all controls seen, edits and undos, effects added and removed, presets, exports, files opened, errors.
- **Time per page:** Browse, Edit, Room, Seq, Compose and Analytics, plus how Edit time splits across the dock tabs.
- **Controls table:** most used, least used or never touched, filterable by kind. Each row shows its uses and when it was last used. A bar shows the values actually set against the control's full range. Click a row to see where its value was left and how many uses it had each day.
- **Heat by panel:** panels drawn where they sit on the page open behind the tab, shaded by use. Panels that aren't on that page are listed underneath.
- **Common paths:** which page follows which, and the most common three-step action sequences.
- **Sessions:** one row per session, coloured by page, with idle stretches hatched, a tick for each control touch and a red mark for each error. Click a session for its full event log.

**Mouse heat map:** where the pointer rests, or where it clicks, on a page. Drawn over the outlines of the panels when that page is the one open behind the tab.

**Filters:** date range (Today, 7 days, 30 days, All), page and session.

**Buttons:** Pause recording, Export JSON (a file saved by the browser) and Clear (forget everything, with a confirmation first).

## Files

| File | What it does |
|---|---|
| `ui/app/370-analytics.js` | Recorder |
| `ui/app/372-analytics-summary.js` | Turns events into the figures. Pure, with no page or server |
| `ui/app/375-analytics-tab.js` | The tab, and the View menu item |
| `core/crates/server/src/analytics.rs` | Storage |
| `tests/ui/analytics.spec.mjs` | Playwright tests |

## Storage

`<data>/ANALYTICS/` holds:
- `events-YYYY-MM.jsonl`: one event per line, filed by its UTC month, only ever appended to.
- `CATALOGUE.json`: every control the interface has had on screen. This is how "never touched" is worked out.

| Route | |
|---|---|
| `POST /api/analytics` | A list of events, or `{"events": [...]}`. Events without a time are dropped. |
| `GET /api/analytics?from=&to=` | Epoch milliseconds, half-open range. Returns `{events, catalogue}`. |
| `POST /api/analytics/catalogue` | `{"controls": [{"c", "ck", "p", "l", "lo", "hi"}]}`. Merged in; nothing is ever removed. |
| `POST /api/analytics/clear` | Deletes the folder. |

## The event

```json
{"t":1793849136412,"s":"s-20261104-091200","k":"ctl","m":"edit","dk":"stretch","p":"grainControls",
 "c":"grainSize","ck":"slider","l":"Grain size","from":120,"to":310,"min":40,"max":310,"n":38,"ms":1840,"lo":5,"hi":500}
```

### Fields

| Field | Meaning |
|---|---|
| `t` | Time, epoch milliseconds |
| `s` | Session. A new one starts when the app loads, or after 30 minutes idle. |
| `k` | Kind of event |
| `m` | Page |
| `dk` | Dock tab, while on the Edit page |
| `p` | Panel: the nearest container listed in `AN_PANELS`, or `fx:<kind>` for an effect module |
| `c` | Control id: the element's id, or else panel/label |
| `ck` | Control kind |
| `l` | Label |
| `d` | Details for that kind of event |

### Kinds

| Kind | Recorded when |
|---|---|
| `session` | The app starts or closes, or recording is paused or resumed |
| `idle` | 60 seconds pass with no input, and again when input comes back |
| `mode` | The page changes. Carries `from` and `dwell` (time on the page just left). |
| `dock` | The dock tab changes. Carries `from` and `dwell`. |
| `view` | Any other tab is chosen |
| `ctl` | One drag or one run of key presses on a slider, knob or pad. Carries `from`, `to`, `min`, `max`, `n`, `ms`, `lo` and `hi`. |
| `toggle` | A switch changes |
| `seg` | A select or segment changes |
| `field` | A text field changes. The text itself is never recorded. |
| `click` | A button is pressed |
| `menu` | A menu item is chosen |
| `key` | A keyboard shortcut, as a chord such as `Cmd-Shift-V`. Keys typed into a field are never recorded. |
| `fx.add`, `fx.remove`, `fx.move`, `fx.bypass` | The effect rack changes, worked out by comparing the rack the interface sends |
| `edit` | An edit operation (`/api/edit`) or a chop save |
| `export` | A mix, stem or video export |
| `preset` | A preset is saved, loaded, updated, duplicated or deleted |
| `record` | A capture or recording |
| `file` | A file is selected or opened in the editor. Only its library name is kept. |
| `error` | An uncaught error, or a request the server refused |
| `mouse` | The pointer grid for one page: 96 × 60 cells, sent as `[cell, count, …]` for moves and for clicks |

## Cost

The rule: **nothing here may cost playback or drawing anything.**

**Listening:**
- Every listener is passive and catches events before the page does.
- Nothing in the audio path or the drawing loops is touched.
- The engine's own frequent requests go through the `fetch` wrapper untouched. Only the few action routes are looked at.

**Recording a drag:**
- A drag is one event, however long it lasts.
- While a control is held, its value is read at most 20 times a second.

**The mouse:**
- The move listener only stores the last position.
- A timer adds that position to the grid four times a second, and only while the pointer has moved and the window is visible.
- Each page's grid becomes one event per batch.

**Sending:**
- Events wait in memory.
- They are sent every 10 seconds, when the browser is idle, or once 200 have built up.
- A last batch goes when the page closes.

**Listing the controls on screen:** done once, 1.5 seconds after a page or dock change, when the browser is idle.

**The tab:** draws only when it is opened, a filter changes or something is clicked. It runs no timers while open.

The tests check that 1000 events cost less than one frame (16 ms), and that a burst of pointer moves costs almost nothing.

## Privacy

- **Same machine only:** requests go to the app's own server and to nothing else. A test fails if any request leaves 127.0.0.1.
- **Never recorded:** audio, folder paths, or text typed into fields.
