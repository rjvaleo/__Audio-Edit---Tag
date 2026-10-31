# The sound map

A 3D world made of the library. Every sound is an object placed by what it
sounds like. You move through it with the mouse; a sound plays as you pass it;
clicking one opens what is known about it. Nothing else for now. Using what you
find there (loading, tagging, sending to the rack) comes later.

`STATE.md` lists the "3D sonic space" view as not started, with `/api/sounds`
and `/api/space` already serving its data. This is the plan for it. It is based
on a fresh measurement of the whole library (813 files, 31 Oct 2026), not on
what the analysis was meant to produce.

## What the library knows about a sound

Three sources, all from the audio except the first.

| Source | Where | What it gives |
|---|---|---|
| The index | `indexer`, `AUDIO-INDEX.tsv` | Format, length, BPM, numbered series, and a category guessed from the filename. The filename guess is shown, never used for placement. |
| What it is | `yamnet`, `LABELS.tsv` | AudioSet labels from the audio, e.g. Percussion 204, Music 68, Speech 66, Drum machine 62. Unrecognised sounds borrow a label from a neighbour, and say so. |
| What it is like | `search`, `FINGERPRINTS.tsv` | Twelve measured dimensions, plus pitch (new, below). |

### The twelve, measured on this library

The 0–1 values, across 813 sounds.

| Dimension | Measures | Spread | Verdict |
|---|---|---|---|
| duration | log seconds | wide | **Use.** |
| loudness | RMS level, dB | narrow (sd 0.11) | **Use**, as size. Its narrow spread is a fact about the library, not a fault. |
| crest | peak over RMS | wide | Punch. Moves against loudness (r −0.63). |
| brightness | spectral centroid | wide | **Use.** |
| rolloff | where 85% of the energy stops | — | **Drop:** r 0.97 with brightness. |
| high | energy above 4 kHz | — | **Drop:** r 0.83 with brightness. |
| flatness | noise against tone | wide | **Use**, with pitch clarity, as one tonal-to-noisy measure. |
| noisiness | zero crossings | — | Overlaps flatness (r 0.61). |
| attack | how fast it starts | **was broken, fixed** | **Use** (see below). |
| low | energy below 250 Hz | wide | Weight. |
| pulse | does the level repeat | wide | **Use.** Separates loops from hits. |
| density | onsets per second | wide | With pulse. |

## The two fixes made for this

### Pitch: there was none

Brightness had been standing in for pitch, and it is a different thing. Among
the pitched sounds the two barely agree (r 0.11). `search::pitch` now measures
the note: YIN period detection, first dip rather than deepest so a
harmonic-rich tone is not called an octave low, 35 Hz to 2 kHz. Each sound gets:

- `pitch_hz`: the note in Hz, 0 when there is no steady one;
- `pitch_clarity`: 0–1, how periodic it is, whether or not it has a note;
- `note`: the nearest note name, e.g. `A1`.

They are stored beside the twelve, not among them. Similarity stays about
texture, so two snares tuned a fifth apart are still alike. The APIs expose all
three: `/api/sounds` as `measured.pitchHz`, `measured.pitchClarity` and
`measured.note`, and `/api/space` as `pitchHz`, `pitchClarity` and `note`.

**On this library:** 110 of 813 sounds (14%) have a steady note:

- **Where they sit:** median 93 Hz. They are mostly low: 909 kicks tuned around
  A1, basses, chants and synth tones.
- **Why so few:** the other 86% are drums, speech and mixed music. A chord or a
  full mix has no single note, and the detector says so rather than guessing.

That number decides the layout below.

### Attack: it measured the wrong moment

Attack was "time from the start of the file to its loudest sample".

- **What went wrong:** in a loop the loudest hit can come anywhere, and a file
  that opens with silence was charged for the silence. 40% of the library read
  as maximally slow, 233 of them longer than 2.5 seconds.
- **The fix:** it now measures the first event's rise, from 10% of the sound's
  peak level to 90% of that event's own top.
- **On this library:** 4% now read as maximally slow, and 54% as instant. Those
  are files that start at full level, which they genuinely do.

Those ties exposed a fault in how the plain words ("percussive", "dark" and so
on) are calibrated. A run of equal values ranked at the bottom of the library.
Ties now rank in the middle of their run, the standard percentile rank.

**Re-measuring:** the fingerprint file's header gained two columns. An old
`FINGERPRINTS.tsv` is rejected on load, and the server re-measures the library
in batches as it is used. That takes about 13 seconds for the whole library in a
release build.

## The world

### Placement

| | Facet | Low end | High end |
|---|---|---|---|
| **Height** | register: pitch for a pitched sound, brightness for the rest, each ranked within its own kind | low | high |
| **Left–right** | tonal to noisy: pitch clarity and flatness together | a held note | hiss |
| **Depth** | duration, log | a hit, in front | a bed, far away |

**Why height is a rank and not Hz.** Only 14% of the library has a note. A
height in Hz would put 86% of it on the floor. The centre of a drum's spectrum
is not on the same scale as a note either (median 2.3 kHz against 93 Hz). So
each kind is ranked within itself:

- the lowest-pitched note sits as low as the darkest drum;
- the highest note sits as high as the brightest hiss.

"Higher" always means "sounds higher". Pitched and unpitched sounds are told
apart by how they look, not by where they are.

The alternative is a **floor and sky**: unpitched sounds on a terrain shaped by
brightness, and pitched sounds hanging above it at their note. It is more
literal, but 86% of the library on the ground is a crowded floor. Either can be
switched in; the data is the same.

### What each object shows

| Visual | Facet |
|---|---|
| Size | loudness |
| Colour | YAMNet family: percussion, voice, music, synth and keys, machine and vehicle, nature, unknown |
| Form | pitched sounds are smooth solids; unpitched are grainy point clouds |
| Surface | rough to the degree it is noisy |
| Motion | pulses at its own onset rate when it repeats (pulse and density); still when it does not |
| Edge | crisp for a fast attack and high crest; soft and hazy for a swell |
| Label | its note, when it has one |

### A second layout: neighbourhoods

The same objects, placed by overall similarity instead of named axes, using the
same distance "find similar" ranks by. Sounds that sound alike form islands;
the axes no longer mean anything you can say out loud. One key switches
between the two, and the objects glide from one place to the other so you can
see where an island came from.

### Moving and listening

- **Fly:** mouse-look with WASD, or orbit-and-zoom with the mouse alone. Pick
  one as the default after trying both.
- **Pass:** the nearest sound within reach plays. Moving on to another one fades
  the first out, so passing through a cluster is a sweep rather than a pile-up.
  It uses the library's own audition path, which already plays through the
  native engine.
- **Click:** an info card with:
  - name and folder;
  - the note;
  - the YAMNet labels, and where a borrowed label came from;
  - the plain words ("bassy", "percussive" and so on);
  - the twelve measurements as a small bar chart;
  - tags;
  - the five most similar sounds, each of which flies you to it.
- **Find:** typing a name or tag lights the matches and dims the rest.

## Where it is built

**Placement in Rust, drawing in the interface.**

- **Rust:** the server computes every position, size, colour and form, as one
  new endpoint, or an extended `/api/space`. The rules above live in one place
  and are tested there.
- **The interface:** it only draws what it is sent.

That split matters because of the native port. If MultiGrainLive moves to a
native shell with `wgpu`/Metal drawing, the renderer is replaced and nothing
else changes.

**First renderer:** Babylon, which the app already loads for the Surfaces
view (`room3d.js`). With 813 objects, one draw call per family using instancing
is comfortably interactive. That draw-call layout carries over to `wgpu`
unchanged.

## Order

1. **Done:** pitch, the attack fix and the tie rank, tested, with the
   library re-measured.
2. The placement endpoint: the layout rules above as tested Rust, returning
   ready-to-draw objects.
3. The view: objects, fly controls and the info card, reached from Browse.
4. Pass-to-play, with the fade.
5. The neighbourhoods layout and the glide between layouts.
6. Find.

## To listen to

The detector's results were checked numerically, not by ear. These are worth a
listen to confirm the note is the one you hear:

- `rj_s 909/909ki4.wav`: G#1, 53 Hz.
- `rj_s 909/909sn4.wav`: C2, 66 Hz, the snare's body.
- `Yonkers Piano/lovelyFM_02.aif`: A1, 56 Hz.
- `new chimers/rut 06.aif`: F#4, 361 Hz.
- `aug 95/beautius chirp.aif`: F#5, 749 Hz.
- `Yonkers Piano/chord3T4000chord_01aiff.aif`: D#1, 39 Hz. A chord that came
  back pitched, very low, which is the likeliest to be wrong.
