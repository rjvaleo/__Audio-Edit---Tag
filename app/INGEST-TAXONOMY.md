# Audio Library - ingest taxonomy, classification rules and nomenclature

Living document. The rules here are implemented in `tools/ingest_index_v2.py`.
If you change one, change the other.

**Nothing in this system renames or moves files.** The indexer only reads headers
and writes TSVs. Renaming is a separate, explicit step driven off the index.

---

## 1. Outputs

| File | Grain | Purpose |
|---|---|---|
| `AUDIO-INDEX.tsv` | one row per file | the full fact table |
| `FOLDER-INDEX.tsv` | one row per ingested folder | the summary the grouping decisions come from |

### Per-file columns

`batch, root_folder, parent_chain, rel_path, filename, stem, ext, bytes, modified,
format, samplerate, bits, channels, duration_s, duration_band, category, confidence,
machine, instrument, descriptor, series_root, series_index, series_size,
proposed_name, reasons, notes`

`parent_chain` is the full folder path as `A > B > C`. This is deliberate - for this
library the folder path carries more meaning than the filename does, and the classifier
reads both.

`reasons` records *why* each guess was made. When we later train something better,
that column is the training signal - keep it.

---

## 2. Categories

| Category | Meaning | Main signals |
|---|---|---|
| `SONG` | finished track | MASTER/FINAL/MIXDOWN in name, or >=90s in a masters/renders folder |
| `SONG?` | probably a track, unconfirmed | 90s-5m, no keyword |
| `LONG-SESSION` | >5 min - live set, jam, raw session | duration |
| `SESSION-TAKE` | a take from a recording session | session/take/jam keyword + long |
| `STEM` | one element of a multitrack | stem/part/bounce keyword + long |
| `LOOP` | rhythmic loop | loop/groove/break keyword, or BPM in name |
| `CHOP` | slice from a longer source | numbered series of 3+, 0.3-20s, **no drum token** |
| `DRUM-ONESHOT` | single drum hit | drum token + <3s, or <1s inside a kit/machine folder |
| `DRUM-HIT-LONG` | drum token but unusually long | 3-8s |
| `SYNTH-STAB` | stab/chord hit | stab/hit/chord keyword, <8s |
| `TONAL-HIT` | short pitched non-drum | bass/lead/string token, <8s |
| `PAD-BED` | sustained atmosphere | pad/drone/atmos keyword + >=8s |
| `FX` | sweep, riser, impact, transition | fx keyword |
| `VOCAL` | speech or singing | vox/vocal/speech token |
| `ONE-SHOT` | <1s, nothing else known | duration only |
| `SAMPLE-SHORT` / `SAMPLE` / `SECTION-BED` | untyped, by length | 1-8s / 8-30s / 30-90s |
| `CACHE` | Ableton `.asd`, overview, `.DS_Store` | extension |
| `DOCUMENT` | txt, pdf, md | extension |
| `BROKEN` | zero bytes | size |
| `UNKNOWN` | no usable signal | - |

`confidence` is `high` / `med` / `low`. Treat `low` as "needs a human or a real
classifier" - it is not a claim.

## 3. Duration bands

`A <1s` · `B 1-2.5s` · `C 2.5-8s` · `D 8-30s` · `E 30-90s` · `F 90s-5m` · `G >5m`

Duration is the single strongest signal in this library and drives most of the ladder.

---

## 4. Rule order (matters!)

The ladder is first-match-wins. The order encodes hard-won corrections:

1. cache / document extension -> `CACHE` / `DOCUMENT`
2. zero bytes -> `BROKEN`
3. song keyword -> `SONG` (>=90s) or `SONG?` (short - flagged as contradictory)
4. masters/renders folder + >=90s -> `SONG`
5. >=5 min -> `LONG-SESSION`
6. >=90s -> `SESSION-TAKE` / `STEM` / `SONG?`
7. vocal token -> `VOCAL`
8. **drum token + <3s -> `DRUM-ONESHOT`** *(this must sit above the series rule)*
9. <1s inside a kit/machine folder -> `DRUM-ONESHOT`
10. fx keyword -> `FX`
11. pad keyword + >=8s -> `PAD-BED`
12. stab keyword + <8s -> `SYNTH-STAB`
13. numbered series of 3+, 0.3-20s, no drum token -> `CHOP`
14. loop keyword or BPM -> `LOOP`
15. fall through to length-based buckets

**Why 8 sits above 13:** drum kits are numbered too. `BD-0010, BD-0025, BD-0050`
is a velocity ladder, not a chopped break. Ordering these the other way round
misfiled 2,600 files as `CHOP` on the first run - including most of the 808 and
909 kits. The drum token wins.

---

## 5. Naming heuristics observed in this library

- `MASTER`, `FINAL`, `MIXDOWN`, `MSTR`, `REMASTER` -> a finished song
- `#001`-`#009`, `_01`, `-001` repeating on one stem -> a chopped series; the
  **folder name gives the context**, the number does not
- Drum machine names are abbreviated: `BD` `SD` `SN` `HH` `CH` `OH` `CP` `RS` `CB`
- Velocity/processing suffixes: `Hrd` `Med` `Sft` `Lite` / `Dry` `Amb` `GRev` `Comp`
- `a` / `b` suffixes are alternating takes of the same hit
- Inch sizes appear as `Tom 10`, `Z.20`, `P.16`, `S.18` (Zildjian / Paiste / Sabian)
- A trailing `M` does **not** mean mono - tested and disproved on 62 files

## 6. Drum machine / source detection

Detected from the filename **and** the whole folder chain. Folder wins when the
filename is silent, and the reason column records which.

`TR-808 · TR-909 · TR-707 · TR-727 · TR-606 · TR-505 · CR-78 · LinnDrum LM-1 ·
E-mu SP-12 · SP-1200 · Akai MPC · Oberheim DMX · E-mu Drumulator · Simmons SDS2000 ·
Vermona DRM1 · Acetone Rhythm Ace/King/Master · Elektron Machinedrum · Korg Electribe ·
Roland MC-303 · AJK Percusyn · Serge Modular · Moog Modular · Mattel Synsonics ·
Keio Checkmate · NI Battery/Absynth/Kontakt · Halion`

Caveat the user flagged and the data confirms: **a folder is not reliably one
machine.** Attribution is a guess; `confidence` and `reasons` say so.

---

## 7. Format facts established so far

- Extensions lie. Probe by content, always. 87 extensionless files in batch 1 were
  real audio (57 AIFF, 24 headerless, 2 WAV, 2 MP3), and 119 `.aif` files had no
  AIFF header at all.
- Mac-origin files often carry the type in a resource fork that did not survive the
  copy to Windows, leaving a bare data fork.
- Headerless raw PCM cannot have its sample rate recovered by analysis. Byte order
  *can* be recovered - big-endian vs little-endian differs by roughly 7x on a
  sample-to-sample smoothness test.
- Duration on headerless files is an **estimate** assuming 16-bit/44.1k/stereo and is
  marked as such in `notes`. Do not trust it for classification of long files.
- Windows Explorer hides known extensions - adding `.aiff` to a file can look like
  nothing happened. Check the Type column.

---

## 8. Proposed nomenclature (for the later rename step)

Target shapes, by category:

    DRUM-ONESHOT    <Machine> <Instrument> <Descriptor> <NN>.<ext>
                    e.g.  TR-808 Kick Hrd 03.wav
    CHOP            <SourceContext> chop <NNN>.<ext>
    SONG            <Title> [MASTER].<ext>
    LOOP            <Source> <BPM>bpm <Descriptor> <NN>.<ext>
    PAD-BED         <Source> pad <Descriptor> <NN>.<ext>

Conventions: drum name leads, numbers trail, two-digit zero padding, sequential
and contiguous per group, spelled-out instrument names (`Kick` not `BD`,
`Snare` not `Sn`).

The indexer writes a `proposed_name` column but **never applies it**. Renaming is a
separate explicit command, and every rename run writes an old/new manifest so it
can be reversed.

---

## 9. Running it

    cd "E:\Audio Library\tools"
    python3 ingest_index_v2.py [seconds] [--reset] [--batch=N]

Resumable - checkpoints after every folder, so re-run until it reports 0 remaining.
`--reset` starts a clean index. Working files land in `/tmp`, then get copied to the
Audio Library root.

Moving across the device bridge is a **copy, not a rename**, and the bridge cannot
delete. Source folders survive in INGEST after a move and must be cleared by hand.
