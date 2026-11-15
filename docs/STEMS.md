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

Sounds from words and from my sounds run on the PC; see below. Licences (RJ OK'd personal
use) are in `WORK DIR/page-mockups/MODELS.md`.

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
- **FLAC both ways** (RJ: "yes, send the stems back as FLAC"): a WAV or AIFF song goes out
  as FLAC (packed here by macOS `afconvert`), and the stems are packed to 24-bit FLAC on the
  PC with `soundfile` in Demucs's environment and unpacked here to the same 24-bit WAVs:
  checked byte for byte against the WAVs. Return trip 36 s down to about 13 s, plus 6 s packing
  and 3 s unpacking; the whole split 65-68 s. Without `afconvert` (not a Mac) it is plain WAV.
- **Make → From words** runs Stable Audio Open Small (`sao\make.py --serve`, kept loaded,
  closed after ten idle minutes). The first request loads the model (about 15-50 s); then
  0.3-0.45 s a sound. Tries land in `Made/.words/`; kept ones in `Made/Words/`.
- **Make → My sounds → Variations** (RJ: "build the Make page, start with Variations"): pick
  up to four sounds (the library drawer adds them while on Make; **Pick it** on any try adds
  it). Variations sends the chosen pick to the PC as the guide (`init_audio`), and Stable
  Audio Open Small makes N new takes spread from a little closer to a little further than
  **Near ↔ far**; the page's 0..1 maps onto the model's useful strengths 0.25..0.95 (measured:
  0.1-0.3 nearly the same sound, 0.6 a clear variation, 0.9 mostly the words). An optional
  phrase steers it; without one the file's name is used. `/api/stems/vary {p, n, nearFar,
  prompt, seed}`. Kept ones go to `Made/Variations/`.
- **Blend two** (RJ: "I don't think that would be an either or. I think I can do both"): picks
  A and B are encoded by Small's autoencoder, mixed in steps from A to B and decoded, with
  **Wander** letting the model move away from the straight mix. Measured: likeness to A falls
  cleanly 1.00 to 0.42 across the steps. `/api/stems/blend {blend:[a,b], n, wander, prompt}`;
  kept ones in `Made/Blends/`.
- **Kit around:** the picks are measured (pitch, decay, brightness), and Small makes the
  chosen parts (kick, snare, hats, toms, conga, bass…) in one batch, each with its own words.
  Tuned parts are moved to the song's key: low tom on the key note, mid tom a fifth up, conga
  an octave up, bass on the key note; at most 6 semitones, so a part keeps its own range. About
  5 s for eight parts. `/api/stems/kit`; kept ones in `Made/Kits/`. Loop, Texture and Mutate are
  shown as next (`WORK DIR/page-mockups/MAKE-PLAN.md`).
- **Models** on Make → From words: Stable Audio Open Small (up to 11 s), TangoFlux (up to 30 s;
  non-commercial licence, personal use only) and ACE-Step 1.5 (songs up to 10 min; MIT; its first
  use downloads about 10 GB to the PC). Each has its own folder and venv on the PC
  (`sao`, `tangoflux`, `acestep\ACE-Step-1.5\.venv`); one is loaded at a time, and choosing
  another closes it. TangoFlux checked: two 4 s tries in 47 s, model load included. ACE-Step is
  wired but not yet run. My sounds always uses Small, the only one that takes a guide sound.
- The PC scripts are `tools/pc/make.py`, `make_tangoflux.py` and `make_acestep.py` in this repo,
  deployed as `make.py` in each model's folder (`C:\Users\rjval\agent-net\sao\make.py` …).
- Before either, Ollama's loaded model is stopped, to free the GPU.
- `gpu.rs` holds the bridge; `/api/stems/words {prompt, seconds, n, seed, model}` is the route.

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

## A song from the library, or from anywhere on the computer

*14 Nov 2026.* RJ: "give me the option to either pull from the library or just open the
regular file load dialog." The source row has **From the library** (opens the library drawer;
the song is whatever is picked there) and **Open a file…** (the browser's own Open dialog, any
WAV, AIFF, FLAC, MP3, M4A or Ogg). A file from the computer is sent to `POST
/api/stems/upload?name=…` (its bytes; that route may carry a whole file, `http::body_cap`), kept
in the library's `Imports/` under a name nothing is using yet, and split from there like any other
song. It stays the song to split until one is picked in the library after it.
