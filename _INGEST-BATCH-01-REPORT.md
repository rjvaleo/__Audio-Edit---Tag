# INGEST batch 1 - indexed and moved

**23 folders, 2,189 files, 252.4 MB.** All 23 verified byte-for-byte at the Audio Library root before I called it done.

Index written to the Audio Library root, and it will grow with each batch:

- `_AUDIO-INDEX.tsv` - one row per file: folder, path, size, modified date, format, sample rate, bit depth, channels, duration, notes
- `_FOLDER-INDEX.tsv` - one row per folder: file count, size, audio count, total minutes, date range, depth, format mix

## What this batch is

Almost entirely **vintage drum machine and sampler libraries** - 808, 909, Linn LM-1, EMU SP-12, Simmons SDS2000, Serge and Moog modulars, Acetone Rhythm Ace/King/Master, Vermona DRM1, Alesis, Akai, plus the `[KB6]` collection. File dates run 1995 to 2011. This should be one top-level group when we get to grouping.

The exception is `Acoustic Drums Stereo` (305 files) - that's the folder we worked on earlier today, carrying its AIFF conversions and reports.

## Formats

| Format | Files | Spec |
|---|---:|---|
| WAV 32-bit float | 927 | 48 kHz, mono |
| WAV | 588 | 44.1 kHz, 16-bit |
| AIFF | 355 | 44.1 kHz, 16-bit, mostly mono |
| Non-audio | 291 | 255 are Ableton `.asd` caches |
| Headerless raw PCM | 24 | no header at all |
| MP3 | 2 | |
| Zero-byte | 2 | |

Two things worth knowing:

**The 927 float files are a re-digitised set, not originals.** 32-bit float at 48 kHz is a modern capture format - these are `MaxV -` prefixed samples across `alesis`, `akai`, `acetone_*` and `ajk_percusyn`. Fine to use, but they are four times the size of a 16-bit equivalent for source material that was 8-bit or 12-bit on the original hardware. Worth considering a 24-bit or 16-bit archive copy if disk matters.

**87 files had no extension and were nearly all audio** - the same Mac-origin pattern as the `2001` folder. My first indexing pass wrongly counted them as non-audio; I caught it and re-probed. They turned out to be 57 AIFF, 24 headerless raw PCM, 2 WAV and 2 MP3. The index now has them correct.

## Needs a decision later

**24 headerless raw PCM files** in `808 eq's and compressed`, `909`, `[KB6]_Simmons_SDS2000`, `akai` and `analog drums and waves`. Same situation as the drum SD2 files - the audio is intact but has no header, so nothing will play them. They can be converted the same way, though sample rate will need establishing per folder rather than assumed, since this batch already contains 30 kHz and 48 kHz material alongside 44.1.

**2 zero-byte files** in `Acoustic Drums Stereo` - already known, one is unrecoverable.

**255 Ableton `.asd` caches** - deletable, they regenerate.

## Action needed from you

**INGEST still contains all 23 original folders.** The bridge cannot delete on your machine, so I could only copy. Everything is verified present and identical at the root, so the INGEST copies are now redundant - clear them out before loading the next batch, or the next scan will re-index them.

One note on mechanics: moving across the bridge is a copy, not a rename, and 252 MB took several passes. Larger batches will be slower - which is fine, I resume where I left off, but do not expect a big folder to land instantly.