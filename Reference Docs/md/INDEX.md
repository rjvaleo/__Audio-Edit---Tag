# Reference docs, as text

Every PDF in `Reference Docs/` extracted to markdown so it can be searched and
quoted without opening a viewer. Page markers (`<!-- p.N -->`) are kept in each
file, so anything taken from here can be traced back to the page it came from.

Two duplicates in the source folder were skipped: `… (1).pdf` copies of the
Driedger thesis and of `p182.pdf`.

## Peak 6 — the editor we are modelled on

368 pages. Whole thing in `peak-6-user-guide.md`; the parts we actually want are
cut out under `peak/` so the useful 10% is not buried in the other 90%.

| File | What it is |
|---|---|
| `peak/contents.md` | The section list with page numbers. Start here, then search the full guide for the `<!-- p.N -->` marker. |
| `peak/peak-menus.md` | **Chapter 12** — every menu and every command in it. The reference for our own menu bar: what belongs under File, Edit, Audio, and what each command should be called. |
| `peak/peak-editing.md` | **Chapter 5** — the edit operations and how each behaves. Selection, the cut and paste variants, fades, loops, markers, regions. |
| `peak/peak-dsp.md` | **Chapter 8** — processing, including time and pitch. Useful for naming and for the shape of the dialogs. |
| `peak/peak-shortcuts-and-actions.md` | **Appendices 1 and 2** — keyboard shortcuts, and Peak Actions, the macro system. This is the "how to customise them" half. |

## The plan

`STRETCH-ROADMAP.md` maps every theory in these papers against this codebase:
what each method is good and bad at, what it would cost to build, and the order
worth building them in.

## Time-scale modification

The theory behind the stretcher. Ordered by how much use they are to this
codebase rather than by date.

| File | What it is |
|---|---|
| `tsm-algorithms-thesis-driedger.md` | Driedger's master's thesis, 104 pages. The best single account of TSM: OLA, WSOLA, phase vocoder, phase locking, transient handling, and harmonic/percussive separation. If a question about the stretcher has an answer, it is probably here. |
| `artifact-perception-in-time-stretching.md` | Which artefacts listeners actually notice, and at what ratios. Useful for deciding what is worth fixing. |
| `improved-pvsola-stretching.md` | PVSOLA — phase vocoder with a synchronised overlap-add correction. A middle road between the two families. |
| `noise-morphing-for-time-stretching.md` | Handling the noise component separately, which is where extreme ratios usually fall apart. |
| `waveform-preserving-stretch-sinusoidal.md` | Sinusoidal modelling, keeping waveform shape through the stretch. |
| `stretching-via-instantaneous-frequency.md` | Instantaneous frequency and partial tracking. |
| `rhythmic-constant-pitch-stretching.md` | Constant-pitch stretching with rhythm preserved. |
| `stretching-in-the-web-audio-api.md` | A survey of browser implementations. Historical for us — the engine is native now — but a decent map of the trade-offs. |

## Pitch

| File | What it is |
|---|---|
| `pitchcraft-ez-user-guide.md` | 34 pages. A pitch-shifting tool's manual; useful mostly for how it presents its controls. |

## Where this connects to the code

The stretcher is `core/crates/fx/src/stretch.rs` (WSOLA) and
`core/crates/fx/src/grain.rs` (granular). The thesis is the reference for both.
The menu work is in `ui/app.js` under "menus"; Chapter 12 is the reference for
that.
