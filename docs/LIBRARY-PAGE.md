# The Library page

RJ, 16 Nov 2026: "after clone, let's do library … bring in the library that's
running on the PC controller server". Built 18 Nov 2026 from the mock-up
`WORK DIR/page-mockups/library.html`.

A page of its own (`mode: 'pclib'`; `'library'` is an old name for Browse, still used by tests), on the rail after Clone. It shows the
PC's own sound library, `pc-sounds`: every sound the PC's models made, grouped
by the words that made them.

## What it does

- **Prompts**, on the left: one row per set of words, with how many sounds it
  made. Search narrows them; All / Hits / Loops and By prompt / Newest filter
  and order them.
- **Sounds**, in the middle: a tile per sound of the chosen prompt, with its
  picture, seed, kind and length. The round button plays it.
- **The sound**, on the right: its picture, words, seed, model, time and file,
  Once / Loop, and **Use it**: Open on Grain, Chop or Edit, or Copy into my
  library.

Nothing is copied into the library until a Use-it button is pressed. Hearing
and drawing a sound keep a copy in the data folder's `pc-cache/` only.

## One fixed size

1496 × 760 px: a 44 px head and three columns of 360, 720 and 400 px, 708 px
tall. The page scrolls; the prompt list and the tiles scroll inside their
columns. Tiles are 228 × 100 px, three across.

## Where it is

| Part | File |
|---|---|
| The page | `ui/app/430-library-page.js`, `ui/app-css/058-library.css` |
| The rail item and icon | `ui/rail.js` (`pclib`) |
| The page switch | `ui/app/030-centre.js` (`pclib`, `body.pclibpage`) |
| The routes | `core/crates/server-stems/src/routes/stems.rs` |
| Tests | `tests/ui/library-page.spec.mjs`; `pc_library_tests` in `stems.rs` |

## The routes

All three reach the PC over ssh, as the Stems page does (`gpu.rs`), not through
the PC Controller's web server.

- `GET /api/pc/library`: the PC's `pc-sounds/index.jsonl`, the rows of kind
  `sounds`, newest first.
- `GET /api/pc/audio?file=`: one sound's bytes, fetched once into
  `<data>/pc-cache/` and served from there. For hearing and for the picture.
- `POST /api/pc/fetch {file}`: copies it into `Made/PC/` in the library and
  answers `{p}`, its path there.

A file name is taken only if it is `sounds/…` ending `.flac` or `.wav`, with
no `..` and only letters, digits, `/ . _ -` (`pc_file_ok`).

The first and third routes are the Stems branch's (6174385), taken unchanged,
so that branch merges without a conflict.

## Not done

- Stems made on the PC (index rows of kind `stems`) are not listed.
- A played sound goes through the browser's own player at the bar's volume,
  not through the engine, so the effects rack and the meters do not see it.
