# Stems

*Built 14 Nov 2026 from the mock-up RJ approved (`WORK DIR/page-mockups/stems.html`,
plan `STEMS-PLAN.md`). Branch `stems`.*

A page of its own on the rail, after Seq. Two tabs.

## Split a song

Pick a song in the library drawer, choose a model and press **Split**.

| model | stems | weights | speed on the M3 |
|---|---|---|---|
| 4 stems (`htdemucs`) | drums, bass, vocals, other | 84 MB | a 5-minute song in 1½–2½ minutes; 15 minutes in about 6 |
| 6 stems (`htdemucs_6s`) | adds guitar, piano | 84 MB | about the same |
| Best (`htdemucs_ft`) | the four, fine-tuned | 333 MB | about four times slower |

The stems go into the library, **`Stems/<song>/drums.wav`** and so on (32-bit float,
the song's rate), with:

- `stems.json`: the source file, the model, how long the split took;
- `songprint.json`, `summary.md`, `card.json`: what is in it (below).

Each stem has a lane: its waveform, solo, mute and a level; **▶ Alone** hears it on its
own; **▶ Stems** at the top plays them together as set (the server sums them into the
hidden `Stems/<song>/.mix.wav`); **Open in** sends one to Grain, Chop, Prism or Edit.

### What's in it

`songprint` (crate `core/crates/songprint`) reads the stems, not the mix: tempo and how
it moves, the beat and bar grid (4/4 assumed), key and key changes, tuning and scale
degrees in cents, drum bars as 16-step grids with velocities and the families they fall
into, swing and feel, the bass line as notes, a chord per bar, which stems play in each
bar and how loud and bright, the sections and how often stems come and go, and the
texture (brightness, noisiness, hiss, width, smear, echoes at musical delays). All
signal processing from published descriptions; no model. The format is
`songprint-format.md` in the shared notes. Rough today: key and chords, and the snare
and hat rows still share some sound. **Read again** re-runs it on stems already split.

**Teach the Band** copies the song's `songprint.json` to `data/BAND-LEARN/<song>.json`,
which the Seq page's Band reads. It learns habits, never audio.

## Make a sound

Choose **Drum hits** or **Bass notes** and a split song, press **Find them**:

- **Drum hits:** the clearest kicks, snares and hats in the drums stem, where one band
  jumps well above the others, at least two seconds apart, each cut to just before the
  next hit.
- **Bass notes:** the longest clean note at each pitch, from the analysis's bass line.

Click a try to hear it and choose it. Then the chain:

1. **Clean:** trim the tail below a level, fade, take out DC, set the peak.
2. **Upsample:** band-limited resampling to 48 or 96 kHz, then **air**: the top of the
   sound driven through a soft clipper and only the new harmonics above **Above** mixed
   back. No upsampler adds real detail; this adds brightness that sounds right.
3. **Effects:** saved sounds open in Grain or Prism (their engines, Hyperprism effects
   and the rack); Export there keeps what you hear.

**Save to the library** writes 24-bit WAV to `Made/Drums/` or `Made/Bass/`.

Sounds from words (Stable Audio Open Small) are not installed: its licence (Stability AI
Community Licence: free under US$1M a year in revenue, registration, "Powered by
Stability AI") needs RJ's OK first. See `WORK DIR/page-mockups/MODELS.md`.

## The GPU machine (the PC)

Model work runs on RJ's PC (RTX 3060 12 GB, 64 GB RAM), not on the iMac. The server
reaches it with `ssh` and `scp` (key login, `BatchMode`), only with fixed commands; the
page never talks to the PC. Configure it with `AUDIOLAB_GPU_HOST=pc` (and optionally
`AUDIOLAB_GPU_DIR`, default `C:/Users/rjval/agent-net`), or `GPU.json` in the data folder:
`{"host": "pc", "dir": "C:/Users/rjval/agent-net"}`. With it set:

- **Split** sends the song to `demucs/jobs/mgl-<ms>/` there, runs Python Demucs 4.1 on CUDA
  (`demucs\venv`, weights under `demucs\torch`), brings the stems back with four `scp` at
  once, deletes the job folder, and reads the stems here. A 5-minute song: about 70 s
  (15 s up, 21 s on the GPU, 36 s back). **Stop** ends Demucs there too (by its job tag).
- **Make → From words** runs Stable Audio Open Small (`sao\make.py --serve`, kept loaded,
  closed after ten idle minutes). The first request loads the model (about 15-50 s); then
  0.3-0.45 s a sound. Tries land in `Made/.words/`; kept ones in `Made/Words/`.
- Before either, Ollama's loaded model is stopped, to free the GPU.
- `gpu.rs` holds the bridge; `/api/stems/words {prompt, seconds, n, seed}` is the route.

Without a GPU machine, Split falls back to the local helper below, and From words is off.

## The helper (this machine)

The split is done by **`demucs-rs`** (Apache-2.0; github.com/nikhilunni/demucs-rs), a
separate program, so its few hundred crates and GPU layer stay out of this one. The
server starts it in its MCP mode (`demucs --mcp`), at low priority (`nice -n 10`), one
song at a time, reads its progress, and ends it when the song is done or **Stop** is
pressed, so its memory (3–4.5 GB at peak) is given back.

Where the server looks for it, first found wins:

1. `AUDIOLAB_DEMUCS` (the program itself);
2. `demucs` in `AUDIOLAB_MODELS`;
3. `models/demucs` beside the program, or `../models/demucs`;
4. `models/demucs` in the working folder or up to five folders above it.

On RJ's Mac it is built in `WORK DIR/models/src/demucs-rs` (`cargo build -p demucs-cli
--release`); link `target/release/demucs` as `models/demucs` in the checkout that runs
the app. `models/demucs` is not tracked. The weights download on first use to
`~/Library/Caches/demucs-rs/`, which is a link to `WORK DIR/models/demucs-rs/`.

Without the helper the page says **THE STEM SPLITTER IS NOT INSTALLED** and Split is
off; everything else works on stems already split.

## Routes

| route | what |
|---|---|
| `GET /api/stems` | the split's state: running, progress 0–1, phase, song, error, serial, elapsed, tookMs; whether the helper was found; the models |
| `POST /api/stems/split {p, model}` | split a library file; answers at once |
| `POST /api/stems/stop` | stop the split |
| `GET /api/stems/list` | every song in `Stems/`, newest first, with its card and whether it is learnt |
| `GET /api/stems/info?p=Stems/<song>` | its files, `stems.json` and the whole analysis |
| `POST /api/stems/mix {p, gains[4]}` | the stems summed into `.mix.wav` |
| `POST /api/stems/analyse {p}` | read it again |
| `POST /api/stems/learn {p, forget?}` | hand it to the Band, or take it back |
| `POST /api/stems/tries {p, kind, per}` | cut tries into `Stems/<song>/.tries/` |
| `POST /api/stems/keep {p, rate, air, above, trimDb, fadeOutMs, peakDb, folder, name}` | clean, upsample, save to `Made/<folder>/` |

## Tests

`tests/ui/stems-page.spec.mjs` lays a small song's stems into the scratch library (a
kick and hat at 120 BPM, a sine bass) and proves the page, the mix, Make and Save; the
split itself needs the helper and minutes of GPU, so it is proved by hand on real songs.
`cargo test -p songprint` covers tempo, beats, downbeat, pitch, key, chords, resampling,
clean and air.
