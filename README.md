# Audio Edit & Tag

Browse, audition and tag a large audio library without moving or renaming a single
audio file. Tags are sidecar data; the library itself is never modified.

## Start here

Double-click **`StartHere.bat`**.

It launches a small local server and opens `http://localhost:8737/`. Python must be
installed on Windows ("Add python.exe to PATH" ticked at install time).

You can also open `index.html` directly, but then only WAV and MP3 will play —
about 39% of the library. The server is what makes AIFF and headerless files
audible, by converting them to WAV on the fly.

## Layout

    index.html        the browser - tag tree, stats, waveforms, player, editor
    StartHere.bat     launcher
    README.md         this file
    app/              everything else, flat - scripts, data, docs

## Where is the audio library?

This repo does not contain the audio. It looks for the library in this order:

1. `library_path` in `app/config.json`
2. the `AUDIO_LIBRARY` environment variable
3. a folder named `Audio Library` sitting beside this repo

To point it somewhere else, create `app/config.json`:

    {"library_path": "E:\\Audio Library"}

## What's in app/

| | |
|---|---|
| `paths.py` | single source of truth for every path; all tools import it |
| `serve_library.py` | the local server - streams any format as playable WAV, saves tag edits |
| `ingest_index_v2.py` | scans folders, classifies files, writes the indexes (resumable) |
| `make_waveforms.py` | decimated peak envelopes, 60 buckets per file (resumable) |
| `write_tags.py` | writes a `_TAGS.txt` into each library folder |
| `build_browser.py` | rebuilds `index.html` from the data + `browser_template.html` |
| `convert_headerless.py` | gives headerless PCM a real AIFF header |
| `browser_template.html` | the UI source - edit this, then run `build_browser.py` |
| `AUDIO-INDEX.tsv` | one row per file (75,284) |
| `FOLDER-INDEX.tsv` | one row per folder (593) |
| `TAG-INDEX.tsv` | folder tags, levels, confidence |
| `TAG-OVERRIDES.json` | hand edits made in the editor |
| `waveforms.tsv` | 54,041 waveform peak strings |
| `INGEST-TAXONOMY.md` | the classification rules - read before changing them |
| `ANALYSE-headerless.bat` / `CONVERT-headerless.bat` | headerless repair |

## Rebuilding from scratch

    cd app
    python ingest_index_v2.py 600     # repeat until it reports 0 remaining
    python make_waveforms.py 600      # repeat until complete
    python write_tags.py
    python build_browser.py

## Worth knowing

- **Nothing here renames or moves audio.** Tags are sidecar data.
- **29,830 files are classified from duration alone** and marked low confidence.
  The browser colours them; treat those groupings as suggestions.
- **Mono vs dual-mono stereo cannot be determined from raw PCM** - both give an
  identical 0.5 delta ratio. Headerless channel counts come from neighbouring
  headered files instead, which self-tests at 89%.
- **Headerless conversion writes a 54-byte header** and copies the samples
  verbatim. A wrong guess is corrected by rewriting the header, never by
  re-converting.
