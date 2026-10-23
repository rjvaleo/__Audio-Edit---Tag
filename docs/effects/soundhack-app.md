# SoundHack, the application

*23 October 2026. Spec; Spectral Dynamics and Convolution are built (see the
end). Part of [EFFECT-INTAKE.md](../EFFECT-INTAKE.md) and
[HYPERPRISM.md](../HYPERPRISM.md#soundhack).*

*Tom Erbe, SoundHack 0.896 (Universal Binary, 2007) and its manual, version
0.890 (`SndHckDoc.pdf`, 56 pages). Both are in the intake folder.*

**Sources.**

- **Behaviour** comes from the manual, summarised in my own words.
- **Windows** come from the binary's own resources, which DeRez read from the
  installer's payload. Each dialog's DLOG gives its size and title. Its DITL
  gives every item's rectangle, kind and text. CNTL and MENU give each pop-up
  and its choices.
- **The decoded data** is in [`soundhack-dialogs.json`](soundhack-dialogs.json).
  All 24 windows are redrawn at 1:1 in
  [`soundhack-windows.html`](soundhack-windows.html).
- **The manual's screenshots** are of earlier versions. Where a label differs
  from 0.896, both are given.

Nothing was run.

SoundHack is a file processor. You open a sound, choose a process from the
Hack menu, set its dialog, press Process, and it writes a new file. It works
in blocks, so it can be paused between blocks and the output heard so far.
The spectral processes split each block into evenly spaced bands from 0 Hz
to half the sample rate. With *n* bands at sample rate *sr*, a band is
`sr / (2n)` wide: 1024 bands at 44.1 kHz are 21.53 Hz apart.

## Shared pieces

### The window pop-up

Seven choices, used by Convolution, Phase Vocoder, Spectral Analysis and the
QT Coder: **Hamming, Kaiser, Ramp, Rectangle, Sinc, Triangle, von Hann**.

- **For analysis,** the manual names only Hamming, von Hann and Kaiser as
  useful. The rest are there because one menu serves every dialog.
- **On a convolution impulse,** Triangle is the smoothest and Rectangle is no
  window at all.

### The bands pop-up

**4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8.** It counts bands, not FFT
points: 512 bands is a 1024-point FFT.

### The Function Window (DRAW_DLOG, 500 × 330)

The control curve for every process that varies over time:

- Binaural angle, the mutation index Ω, the phase vocoder's scale and
  varispeed.
- A curve of **400 entries, one per pixel**, interpolated during processing.
- A 400 × 274 drawing area at the left. The **Top** field sits at its upper
  right and **Bot** at its lower right; together they set the range drawn
  (crude zooming).
- Seven preset icons along the bottom: the waveform shapes. A preset fills the
  curve with **Cycles** repeats; pressed when there is already a curve, it
  modulates that curve instead of replacing it.
- Buttons, top to bottom:
  - **Set:** every point to one value.
  - **Reverse:** time-reverse.
  - **Invert:** flip.
  - **Shift:** rotate by up to 399 places.
  - **Smooth:** average neighbours, wrapping at the ends.
  - **Normalize:** scale to fill the range.
  - **Set Mean:** scale so the mean is a given value.
  - **Write** and **Read:** save and load the curve as a soundfile.
- **Readouts:** Time (in the input file) and the curve's value under the
  mouse, labelled for what it drives (Scale:, Degrees:, …).

**Here:** this is an automation lane. Drawing, presets with cycles, and
reading a curve from a file map onto the Automation dock. The edit buttons
that are missing there are listed under *Here* at the end.

### Spectral display

*Show Signal*, *Show Spectrum* and *Show Sonogram* open live views while a
process runs. The sonogram's colours run from purple-red (quiet) through
green to bright red (loud).

## The Hack menu, process by process

### Convolution (⌘C) — CONVOLVE_DLOG, 275 × 165, "Convolve with Impulse Response"

**What it does.** It multiplies the spectra of two files, the input and an
*impulse response* file, so frequencies the two share are reinforced and the
rest fall away. It works block by block, each block as long as the impulse
used.

| Item | Kind | Where (l,t–r,b) | What |
| --- | --- | --- | --- |
| Length Used | edit | 110,5–255,24 | Seconds of the impulse file used, the block length. "Like the decay time of a reverb." 0.1 s is the suggested start |
| kBytes Needed | readout | 120,30–235,46 | Memory estimate |
| Gain | radios | 0 dB 70,50 · 24 dB 125,50 · 42 dB 190,50 | Extra gain on top of an automatic scaling that "cannot be predicted". 42 dB for most cases; 24 or 0 when the two spectra are similar and resonate |
| Window | pop-up | 5,70–165,90 | Envelope on the impulse before use; smooths moving convolution |
| Ring Modulate | check | 5,95 | Ring modulation of the two files instead: multiplying them in time, which is convolving their spectra |
| Brighten | check | 155,95 | A simple +6 dB/octave high-pass on the impulse, so two naturally dull sounds do not convolve to something duller still |
| Moving | check | 5,115 | The impulse window walks through the impulse file, a new window each block. It advances so the two files end together: a 5 s impulse against a 10 s input moves 0.5 s per 1 s block. The impulse file runs out first and its last window is zero-padded. An impulse longer than the input is skipped through |
| Normalize | check | 155,115 | Normalise the output after processing |
| Pick Impulse | button | 85,140 | Choose the impulse file |
| Cancel / Process | buttons | 5,140 / 200,140 | |

The manual's screenshot (an earlier version) also had a **Help** button. Its
advice: because the gain is unpredictable, write 32-bit float and normalise
afterwards with Gain Change.

**Here: a rack effect, built as `prism:convolution`.**

- **The impulse:** a sound from the library.
- **The engine:** a partitioned FFT convolver, so the delay is one partition.
- **Gain:** the impulse is scaled to unit energy, which stands in for
  SoundHack's automatic scaling. Gain is a dB control on top of that.
  SoundHack's three buttons are three points on it (0, +24 and +42 dB).
- **Ring Modulate:** multiplies the input by the windowed impulse segment,
  restarting each block.
- **Brighten and Window:** applied to the impulse.
- **Normalize:** an offline step, not a rack control.
- **Moving:** an offline render, second.

### Spectral Dynamics (⌘D) — DYNAMICS_DLOG, 250 × 305, "Spectral Dynamics Processor"

**What it does.** Gating, ducking, expansion or compression on every band
separately, each band with its own threshold detector, so one band can be
acting while the next is not. It can be limited to a range of bands. The
threshold is either one level for all bands, or a level per band read from
a second file's amplitude spectrum; that is how hiss or hum is aimed at.

| Item | Kind | Where | What |
| --- | --- | --- | --- |
| (type) | pop-up | 5,5–125,25 | **Gate-Duck · Expand · Compress** |
| Bands | pop-up | 130,5–245,24 | The bands list above. 512 at 44.1 kHz: 43 Hz apart, 23 ms delay |
| Lowest Band / Highest Band | edits, with the frequency read beside each | 105,30 / 105,55; Hz at 170 | The range affected, in band numbers; outside it, nothing changes |
| 3rd Octave Band Grouping | check | 5,75 | Bands grouped by third octaves, one threshold trigger per group, which "may sound more natural" |
| Compress/Expand Ratio | edit | 180,100 | The ratio, or for Gate-Duck the gain or reduction in dB. Its label follows the type: *Gain/Reduction*, *Expand Ratio (1:N)*, *Compress Ratio* |
| Use Smoothed Amplitude | check | 5,120 | Compare a windowed average of each band's level, not its instant level: avoids abrupt gating and the "martian voices" artefact, and is essential for hiss removal |
| Attack/Decay Time (sec) | edit | 180,145 | How fast a triggered band opens or closes; default the shortest the band count allows. Too slow loses transients; too fast whistles |
| Affect Sounds | radios | Below Thresh. 5,180 · Above Thresh. 130,180 | Below: downward — the loudest level is held and quieter ones are expanded down or compressed. Above: the threshold is held and levels above it are expanded or compressed up from there. A gate below is a gate; above, a ducker |
| Threshold Relative to Peak Amp. | check | 5,200 | The threshold is set below each block's loudest band: at −40 dB with a −12 dB peak, the gate acts below −52 dB |
| Threshold (dB) | edit | 180,220 | Labelled *Threshold Level* normally and *Threshold Above File (dB)* when a file sets the thresholds; then it is an offset on the file's spectrum |
| Use Soundfile for Thresholds | check | 5,240 | Per-band thresholds from a file's spectrum |
| Threshold File / Pick File | readout, button | 105,260 / 5,280 | |

**Tutorial settings for noise reduction:**

- 2048 bands and Expand, across all bands.
- A ratio of 1.5 to 3.
- A threshold around 9 dB above the hiss, somewhere between −50 and −90 dB.
- Use Smoothed Amplitude on.

**Here: a rack effect, built as `prism:spectral-dynamics`.**

- **Every control above** except the threshold file.
- **The threshold file** needs a sound from the library, like the convolution
  impulse. It comes once impulses work, and reuses their path.
- **Band limits** are in hertz rather than band numbers, so they keep their
  meaning when Bands changes.
- **Gain/Reduction and Ratio** are two separate controls. An automation lane
  needs one meaning per control, not a label that changes.

### Phase Vocoder (⌘P) — PVOC_DLOG, 255 × 305

Time or pitch scaling through a bank of 8–4096 band filters, which drive a
bank of oscillators. Stretching lengthens the amplitude and phase
envelopes; pitch scaling keeps the envelopes and multiplies every frequency.

- **Bands and Window.** Bands is the band count. Window is the window list,
  where only Hamming, von Hann and Kaiser are good.
- **Overlap:** **4x · 2x · 1x · .5x**, the filter window relative to the band
  count. 4x is the sharpest filter, but responds slowest.
- **Time Scale / Pitch Scale:** radios, and a factor in the box beside them.
- **The scale pop-up:** **Scaling: · Length Desired:**, so a time scale can be
  given as the length wanted. In the tutorial, pitch is given as semitones.
- **Scaling Function:** a check, with **Edit Function…** to vary the factor
  over the file, across 12 octaves.
- **Resynthesis Gating:** drops bands below **Minimum Amplitude (dB)** (−96 in
  the dialog), and bands more than **Threshold Under Max. (dB)** (−40) below
  each block's loudest band. At −6 only a few loud partials survive, the
  tutorial's "interesting special effect".
- **Analysis and Synthesis Rate (samps/FFT):** 128 each in the dialog.
- **Band Freq. Spacing:** a readout.

**Here:** covered by the Vocoder engine.

- **The scaling function** is Stretch and Pitch automation, or the Prism pad.
- **Resynthesis gating:** the engine's Gate covers the minimum amplitude. The
  *under max* threshold is a second gate, still to add.

### Varispeed (⌘V) — SRATE_DLOG, 260 × 125, "Varispeed or Sample Rate Convert"

A high-quality sample-rate converter, and variable-rate playback when
**Varispeed** is ticked.

- **Quality:** Best · Medium · Fast, the size of the interpolation filter.
- **New Rate** for plain conversion.
- **Varispeed Function…** draws the curve, over a 10–12 octave range. **Vary
  by Pitch** and **Vary by Scale** choose whether the curve is a pitch or a
  speed factor.

**Here:** Stretch and Pitch moved together, on one lane each or on the pad.
Plain rate conversion is an export option.

### Binaural Filter (⌘B) — BINAURAL_DLOG, 250 × 300, "Binaural Position Filter"

Turns a mono file into a stereo one placed around the head, with a
head-related filter per position: twelve measured positions (Begault's
data), and between two of them a mix of both.

- **The angle:** twelve radio buttons round a square give the twelve
  positions, or type any **Angle** (0° is straight ahead).
- **Height:** **Elevated · Ear Level · Lowered**.
- **Moving Angle** with **Angle Function** turns the sound by a curve.
- **What spatialises well:** snares rather than flutes, and sounds with
  energy above 1.5 kHz.

**Here:** not built. Which set of transfer functions can ship is a
licensing decision (see LICENSING-POLICY.md), and it comes before code.

### Mutation (⌘M) — MUTATE_DLOG, 270 × 270, "Spectral Mutation Function"

Larry Polansky's morphological mutations: a *mutant* made band by band from
a *source* and a *target*, frame by frame.

- **Bands.** The analysis band count.
- **Type:** **USIM · ISIM · IUIM · UUIM · LCM · LCM/IUIM · LCM/UUIM**.
- **Mutation Index (Ω)** 0–1: 0 is all source, 1 all target. **Ω Function**
  varies it over time.
- **Band Persist** (0.95), for the irregular types only: how long a band
  stays mutated once chosen. High is stable; low pumps at the frame rate.
- **Absolute Interval**, with **Source** and **Target Abs. Value** (0.5 each):
  intervals measured from a fixed amplitude, rather than from the band's
  previous frame.
- **Delta Emphasis** (−1 to 1): for relative intervals only. Negative damps a
  frame towards the past, like a low-pass; positive accentuates change.
- **Time Scale Target:** stretches the target to the source's length; without
  it, the longer file is cut.
- **Pick Target.**

**The functions,** per band:

- *S* is the source, *T* the target and *M* the mutant.
- *i* is this frame.
- *j* is the previous frame (relative), or the fixed value (absolute).
- An interval is `Xi − Xj`, with a sign and a magnitude.

| Type | Mutant interval |
| --- | --- |
| USIM (uniform signed) | `Sint + Ω·(Tint − Sint)`: a spectral cross-fade |
| UUIM (uniform unsigned) | `Ssgn · (Smag + Ω·|Tmag − Smag|)` |
| ISIM (irregular signed) | `Tsgn · Tmag` in the chosen bands: band replacement |
| IUIM (irregular unsigned) | `Ssgn · Tmag` in the chosen bands |
| LCM (linear contour) | `Tsgn · Smag` in the chosen bands |
| LCM/IUIM, LCM/UUIM | The first, then the second on its output, on different bands |

**How the mutant is built:**

- `Mi = Mj + interval`, and in absolute mode `Mj` lies between the two
  absolute values, set by Ω.
- In the irregular types, Ω is the share of bands mutated each frame. They are
  chosen at random, and Band Persist keeps a chosen band chosen. Bands not
  chosen take `Ssgn · Smag`.
- USIM and ISIM reach the target at Ω = 1; the others give "an image" of it.

**Here:** an offline render of two library sounds, after the rack effects.

### Spectral Extractor (⌘X) — EXTRACT_DLOG, 250 × 200, "Spectral Rate Extractor"

Splits a sound into stable and transient parts, as two files, by how fast each
band's frequency moves.

- **Bands** (512 for most sounds) and **Frames** (**4 · 5 · 6 · 7 · 8**): the
  analysis frame, in FFT frames, with its length in seconds shown.
- **"Transients are partials that have an average change greater than [5]
  hertz per analysis frame."**
- **"Stable sounds are partials that have an average change less than [2]
  hertz per analysis frame."**

The technique comes from Settel and Lippe's work on the ISPW.

**Here:** an offline render that writes two files.

### Spectral Analysis (⌘-) — ANAL_DLOG, 240 × 140

Writes a spectral data file from a sound, or a sound from one.

- **Settings:** Bands, Window and Overlap.
- **Type:** **Csound · SoundHack · SDIF 1STF**.

The SoundHack format is a header followed by frames. Each frame holds
`bands + 1` amplitude/phase pairs as floats, interleaved left then right for
stereo. The Csound format holds amplitude/frequency pairs instead.

**Here:** out of this plan. It is an exchange format, not a sound.

### QT Coder (⌘U) — PICT_DLOG, 240 × 265, "QuickTime Sonogram"

Turns a sound into a QuickTime movie of sonograms, and a movie back into
sound.

- **The picture:** frequency runs up the frame, linearly, and time across it.
  Colour saturation is amplitude, and hue is the change in phase. 256 bands
  make a 343 × 257 frame.
- **Settings:** Bands and Window.
- **∆Phase Center Color:** **Red · Green · Blue**, the colour a zero phase
  change takes.
- **Amplitude Range (dB):** 96 in the dialog; 120 for high fidelity.
- **Options:** Amp To Hue / Phase To Hue, Color Inversion and Moving
  Sonogram, plus Lines Per FFT.
- **Any movie** can be read back as sound: repetitive, and bright, because the
  frequency scale is linear.

**Here:** a visualiser idea, not an effect. Out of this plan.

### Gain Change (⌘G), Normalize (⌘;) — GAIN_DLOG, 265 × 185

- **Analyze** measures each channel's peak, peak position, RMS and DC
  offset.
- **Change Gain** writes a copy with a gain and an added offset per channel.
- **dB / Fixed** chooses how gains are shown.
- **Normalize** does the whole of this with no questions.

**Here:** covered by Gain, Amp fit, DC and the export's normalise.

### Utilities

These are file housekeeping, with nothing to build. Here, the library and
export already cover them.

- **Header Change** (245 × 120): length, sample rate, channels (1, 2 or 4)
  and encoding.
- **Loops & Markers** (245 × 275).
- **Record** (220 × 195).
- **Import/Export SND resource.**
- **Import CD Track.**
- **Open Any**, which reads a headerless or text file.
- **Split Into Mono Files.**
- **Save A Copy**, across 13 file types and 16 encodings.

## The algorithms, from the code

*23 October 2026. SoundHack 0.896's i386 binary keeps its function names. One
headless Ghidra run decompiled 35 functions (`SpectralGate`, `SpectralCompand`,
`SpecGateBlock`, `InitDynamicsProcess`, `ConvolveBlock`, `RingModBlock`,
`BrightenFFT`, the window functions and the analysis plumbing), and its literal
constants were read from the binary's data. Read for behaviour only, and
described in my own words.*

### Shared analysis

- **Spectral Dynamics' window.** Hamming for both analysis and resynthesis,
  the symmetric form (`0.54 − 0.46·cos(2πi/(N−1))`), with a hop of a quarter
  window.
- **Scaling.** The analysis window is scaled to sum to 2, so a full-scale sine
  reads 1.0 (0 dB) in its band. The synthesis window is scaled so the overlap
  adds back to unity.
- **Amplitude and phase.** Each band is an amplitude (`hypot`) and a phase.
  Processing changes only the amplitude.

### Spectral Dynamics

Each band keeps a **state** that starts at 1:

- **Gate-Duck:** a gain.
- **Expand and Compress:** an exponent.

Each frame:

1. **The threshold.** For each band it is one of:
   - the threshold level (stored linear, `10^(dB/20)`);
   - with a threshold file, that band's threshold from the file;
   - with *relative to peak*, the level times the frame's loudest band, which
     overrides the other two.
2. **Without smoothed amplitude.** A band is *past* its threshold when it is
   louder (Above) or quieter (Below). A past band's state steps toward the
   **amount**; a band that is not past steps back toward 1.
   - **The step** is `(amount − 1) / frames`, where *frames* is the
     attack/decay time divided by the hop, and at least one.
   - **The move is linear,** in the state's own units, and it stops at the
     amount or at 1.
   - **The amount:**
     - Gate-Duck: the Gain/Reduction, as a linear gain.
     - Expand: the ratio N.
     - Compress: 1/N.
3. **With smoothed amplitude.** The last four frames' amplitudes are averaged
   (×0.25). Then, with no attack or decay at all, there is a soft knee:
   - **The knee fraction `x`:**
     - Above: `x = T / (avg + T)`.
     - Below: `x = avg / (T + avg)`.
     - So `x` is 1 far on the untouched side and 0 far past.
   - **Gate-Duck:** `state = amount + x·(1 − amount)`.
   - **Expand** (amount > 1): `state = 1 / (x·(1 − 1/amount) + 1/amount)`.
   - **Compress:** `state = amount + x·(1 − amount)`.
4. **Third-octave grouping.** It averages the bands' *states*, not their
   levels:
   - **Groups** are counted down from Nyquist, with edges at
     `bands × 2^(−k/3)`.
   - **Each group's bands** are set to the group's mean state.
   - **The lowest leftover group** keeps its own states.
5. **Applying.** Over the band range only:
   - **Gate-Duck:** `amp × state`.
   - **Expand and Compress:** `T × (amp/T)^state`. That is
     `T + state·(level − T)` in dB: downward below the threshold, pivoting on
     it above.

**The threshold file:**

- **What is read.** The first five consecutive window-length blocks of the
  chosen sound, each Hamming-windowed, transformed and summed band by band.
  The mean of the five, times the *Threshold Above File* level, is each band's
  threshold.
- **Channels.** A stereo sound gives each side its own thresholds.
- **Defaults.** The threshold defaults to −40 dB, and to 0 dB above the file
  when one is used.
- **Time.** Attack/decay defaults to one hop and cannot go below it; the
  dialog hides it while smoothed amplitude is on.

### Convolution

**Steps, per block of *Length Used* samples:**

1. **Read the impulse** from the impulse file. *Moving* advances the read
   position each block, so that the two files end together.
2. **Window it,** if a window is chosen.
3. **Transform it.**
4. **Brighten:** multiply bin *k* by `64·k/K`, where *K* is the number of
   bins. That is +6 dB per octave, unity at 1/64 of Nyquist, +36 dB at
   Nyquist, with DC zeroed.
5. **The automatic scaling:** multiply the impulse spectrum by `2 / L`, where
   *L* is the length used. The Gain buttons (0, 24 or 42 dB) scale the output
   on top of that.
6. **Convolve:** the input block's spectrum times the impulse's, transformed
   back and overlap-added.

**Ring Modulate** multiplies each input block by the impulse block, sample by
sample. With a window, the blocks overlap.

**The windows, as SoundHack draws them over a length N:**

| Window | Shape |
| --- | --- |
| Hamming | `0.54 − 0.46·cos(2πi/(N−1))` |
| von Hann | `0.5 − 0.5·cos(2πi/(N−1))` |
| Ramp | `1 − i/N`: full at the start, fading out |
| Rectangle | 1 |
| Triangle | Up to 1 at the middle and back down, `2·i/N` then mirrored |
| Sinc | `sin(πu)/(πu)` with `u = (i − N/2)/(N/2)`: the main lobe |
| Kaiser | β = 6.8, I0 by series, both end samples set to zero |

### Here, against that

| | SoundHack | Here |
| --- | --- | --- |
| Dynamics windows | Symmetric Hamming | Hamming, periodic (divided by N), so a ratio of 1 gives the sound back exactly; the symmetric form ripples by a fraction of a dB |
| Dynamics rules, steps, soft knee, grouping, threshold file | As above | As above |
| Convolution scaling | `2/L`, plus 0, 24 or 42 dB | Unit energy, plus a Gain dial; the three buttons are points on it |
| Brighten | `64·k/K` on the impulse spectrum | The same ramp, on the impulse's spectrum before partitioning, then scaled to unit energy, which removes the 64 |
| Brighten's early part | The ramp is zero-phase, and its blocks wrap the part before time zero round to the end of the block, where it spoils the low end (the manual: "probably too simple") | Kept a partition early, with the dry sound delayed to match: +6 dB an octave to Nyquist, and 512 samples more latency while on |
| Ring modulate with a window | Overlapping blocks | One block at a time |
| Moving | Per block, through the file | A render; not in the rack |

## Here, in order

1. ~~**Spectral Dynamics** and **Convolution** as prism effects, in the rack
   and on the Prism pad.~~ Built.
2. ~~**Sounds from the library as an effect's input:** the convolution impulse
   and the dynamics threshold file.~~ Built.
3. **The rest of the phase vocoder's gating:** the threshold under the peak.
4. **Moving convolution, Mutation and the Spectral Extractor** as offline
   renders.
5. **The Function Window's edit buttons** on the Automation dock: Set,
   Reverse, Invert, Shift, Smooth, Normalize, Set Mean, and presets that
   modulate an existing curve.
6. **Binaural,** once the transfer-function data is settled.

## Built

*23 October 2026.*

- **Spectral Dynamics** is `prism:spectral-dynamics`, with every control in its
  dialog, and since the code was read, SoundHack's algorithm: the linear
  state steps, the soft knee for smoothed amplitude, grouping by averaging
  gains, Hamming windows. The threshold file is a *threshold sound* from the
  library with *Use threshold sound*; Threshold is then the level above it. Bands run 8–4096; the band range is in
  hertz. Gain/Reduction is declared to apply only to Gate-Duck (`ParamSpec::when`),
  and the rack dims it otherwise. Affect reads *Below* and *Above*, SoundHack's
  own short labels.
- **Convolution** is `prism:convolution`: Length Used (10 ms–4 s), Gain (−24 to
  +48 dB, over unit-energy scaling), the seven windows, Brighten, Ring Modulate
  and a Mix. The impulse is a library sound chosen on the module (the
  descriptor's `sound`, handed over with `Kernel::set_sound`). With none chosen
  it passes the sound through.
- **The panels** follow the dialogs' order top to bottom. Switches and choices
  of two or three are named buttons — the shared panel's radio buttons — and
  longer choices, like the window, are sliders that read as names.
- **Both are on the Prism pad**: threshold across and ratio up; length across
  and gain up.
