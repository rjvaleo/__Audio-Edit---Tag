# Audio Edit & Tag

Everything for the tag browser, player and editor. Self-contained - move this whole
folder and it still works, as long as it stays one level above `INGEST`.

## Start here

    tools\3 - START library browser.bat

Opens `http://localhost:8737/` with the player and tag editor. Needs Python on Windows.

Double-clicking `index.html` also works, but only plays WAV/MP3 - the
launcher is what makes AIFF and headerless files audible.

## What's in here

| | |
|---|---|
| `index.html` | the browser - tree, stats, waveforms, player, editor |
| `AUDIO-INDEX.tsv` | one row per file (75,284) |
| `FOLDER-INDEX.tsv` | one row per folder (593) |
| `TAG-INDEX.tsv` | folder tags, levels, confidence |
| `TAG-OVERRIDES.json` | your hand edits, written by the editor |
| `INGEST-TAXONOMY.md` | the classification rules - read this before changing them |
| `INGEST-BATCH-01-REPORT.md` | first ingest report |
| `work/` | regenerable working data (indexes + 54,041 waveform peaks) |
| `tools/` | the scripts |

Each of the 593 folders under `INGEST` also has its own `_TAGS.txt`.

## The scripts

| | |
|---|---|
| `serve_library.py` | the local server: streams any format as playable WAV, saves tag edits |
| `ingest_index_v2.py` | scans folders, classifies files, writes the indexes |
| `make_waveforms.py` | decimated waveform peaks, 60 buckets per file |
| `write_tags.py` | writes `_TAGS.txt` into every folder |
| `build_browser.py` | rebuilds the HTML from `work` + `browser_template.html` |
| `convert_headerless.py` | gives headerless PCM a real AIFF header |
| `rename_folders.py` | folder renaming - **not used**, we chose tagging instead |

Edit the look or behaviour in `tools\browser_template.html`, then run
`build_browser.py` to regenerate.

## Order of operations, if you ever rebuild from scratch

    python ingest_index_v2.py 600      # repeat until it reports 0 remaining
    python make_waveforms.py 600       # repeat until complete
    python write_tags.py
    python build_browser.py

## Things worth remembering

- **Nothing here renames or moves your audio.** Tags are sidecar data.
- **Headerless conversion writes a 54-byte header** and copies the PCM verbatim.
  Specs are inferred and right about 89% of the time; a wrong guess is fixed by
  rewriting the header, never by re-converting.
- **Mono vs dual-mono stereo cannot be determined from raw PCM** - both produce an
  identical 0.5 delta ratio. Channel count comes from neighbouring headered files.
- **29,830 files are classified from duration alone** and marked low confidence.
  The browser colours these; treat them as suggestions.
