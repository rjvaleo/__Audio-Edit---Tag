# Lexicon LXP Native Reverb

*23 October 2026. Spec and build in one; see [Built](#built) at the end. Part of [EFFECT-INTAKE.md](../EFFECT-INTAKE.md).*

*Lexicon (Harman) · LXP Native Reverb Bundle 1.2.4, built 7 June 2021 · Mac AU `aufx` / VST / AAX, x86_64 only · `Lexicon_LXP_Native_Reverb_1_2_4.dmg` · 4 effects*

**Read this first: the sound here is not Lexicon's.** All four plug-ins'
code is encrypted by their copy protection (PACE Fusion with iLok, see
[Sources](#sources)). Decrypting it would mean breaking that protection, so
it was not read, and nothing below comes from Lexicon's DSP. What could be
read without touching the protection fixes the controls: the parameter names
and value text, all 225 factory presets, the panel art, the manual's
description of what each control is for, and the tooltips. RJ chose (23
October) to build the four from that, on an engine of prism-fx's own, labelled
as not decompiled. So:

- **Original** below means something read from the installer's files.
- **Inferred** means a choice made because the files do not say. Every range
  is inferred, from the presets and the manual.
- **Here** means prism-fx's own engine and choices.

| Effect | AU subtype | Here | Default (factory preset) | Pad (X / Y) |
| --- | --- | --- | --- | --- |
| LXP Chamber | `Mcm1` | `prism:lxp-chamber`, code 17 | Medium Honey Vocal 2 | `sizeM` / `reverbTimeS` |
| LXP Hall | `Mhl1` | `prism:lxp-hall`, code 18 | Med Hall | `sizeM` / `reverbTimeS` |
| LXP Plate | `Mpl1` | `prism:lxp-plate`, code 19 | Small Rich Plate 2 | `sizeM` / `reverbTimeS` |
| LXP Room | `Mrm1` | `prism:lxp-room`, code 20 | Medium Tiled Room | `sizeM` / `reverbTimeS` |

All four are manufacturer `Lexi`, type `aufx`, from each AU bundle's
`Info.plist`.

## Sources

Nothing was installed, run or loaded. The `.dmg` was mounted read-only, its
`.pkg` copied out and expanded with `pkgutil --expand`, and each of its four
payloads unpacked into its own new folder.

| Package | Installs to | What is in it |
| --- | --- | --- |
| `LXPNativeReverbAU.pkg` | `/Library/Audio/Plug-Ins/Components` | `LXPChamber`, `LXPHall`, `LXPPlate`, `LXPRoom` `.component`, 13.8–14.7 MB each |
| `LXPNativeReverbVST.pkg` | `/Library/Audio/Plug-Ins/VST` | the same four as `.vst`, 13.7–13.9 MB |
| `LXPNativeReverbAAX.pkg` | `/Library/Application Support/Avid/Audio/Plug-Ins` | the same four as `.aaxplugin`, 11.4–12.9 MB |
| `LXPNativeReverbBUNDLE.pkg` | `/Library/Application Support/Lexicon/Native` | `LexiconLXPnative.bundle`: 37 shared PNGs, a background and a centre panel per plug-in, and 225 preset XML files |

Each plug-in bundle also carries PACE's `__Pace_Eden.bundle`, a
`libWrapHelper.dylib` and a `__Pace_Eden` resource folder. None of these were
opened.

**What could not be read, and why.** Every plug-in's `Info.plist` names
`com.paceap.fusion.compilers.clangllvm1_0` as its compiler. In all twelve
binaries the whole `__TEXT,__text` section measures 8.0 bits per byte at every
8 KB window; plain x86-64 code measures about 6 to 6.5. Disassembly is noise
from the first byte. `__TEXT,__const` is 7.6, and a second 5 MB `__DATA`
segment is 8.0. The symbols are stripped. The code exists in readable form only
after the protection decrypts it at load time. So Ghidra had nothing to read,
and no address, constant table or signal path comes from the binaries.

**What was read.**

- **`__cstring`**, which is plain: parameter names, page names, value formats,
  tooltips, C++ class names (`cSizeParameter`, `cSpinParameter`,
  `cWanderParameter`, `cBassRTParameter`, `cShapeParameter`, `cMasterSpread`,
  `cBabyBearInputAndMixEditWindow`), and the graphics' file names.
- **The presets**: 225 XML files, one `LEXICON_PRESET` element each, whose
  attributes give every parameter as display text. They are the only source
  of values.
- **The graphics**: PNGs, measured for layout and colour.
- **The manual** (29 pages, 2010): what each control is for, and each
  algorithm's character. It gives no ranges. It is paraphrased here, not
  quoted.

## The original interface

The interface is common to all four; only the title and the centre panel's
name change. Measured from `PlugBG.png`, which is 500 × 410 px, to within a few pixels:

| Part | Where (x, y, w × h) | What |
| --- | --- | --- |
| Logo | 14, 18, 96 × 30 | the Lexicon wordmark |
| Title bar | 112, 26, 370 × 22 | blue `#409ced` bar, "LXP NATIVE \| HALL" (etc.) right-aligned |
| Category and preset bar | 14, 58, 468 × 22 | two drop-downs, "CATEGORY ▾" and "PRESET ▾" |
| Level meters | 14, 88, 113 × 109 | IN and OUT LED bars, scale 0, −3, −6, −12, −18, −24, SIG; red–orange–yellow LEDs (`LEDmeter.png`, 12 × 120) |
| Realtime display | 205, 88, 277 × 109 | the centre panel (`Centerpiece.png`, 279 × 112), the algorithm's name in grey when off |
| Knob row | 14, 206, 468 × 107 | six knobs, 88 × 88 frames, centres about 77.6 px apart from x ≈ 54, y ≈ 258 |
| Navigation row | 14, 352, 468 × 39 | blue `#3f9aeb` band holding the page buttons |

- **Knobs.** One 101-frame film strip (`LXPknob.png`, 8888 × 88): a dark
  ring whose arc lights `#0092ff` as it turns, plus a glow strip
  (`LXPknobglow.png`, `#0bc9f7`) shown while it is held. The value sits above
  each knob and can be typed after a double-click. The name sits below it.
  Each knob sits in its own inlay (`Pscreen_Inlay_01`–`06`, 77–80 × 110). A
  highlight (`Highlight_01`–`06`) marks the one being edited.
- **Buttons.** Page buttons are `BigButtonOn/Off` (66 × 42), lit by a
  `#32a8ff` bar. Store, Compare and Reload are `SmallButtonOn/Off` (80 × 36).
  The soft-row assignment buttons are `ComboButton` (86 × 30).
- **Pages.** One button per page; each page fills the knob row. The page
  names in the strings are **Soft Row**, **Reverb** ("primary attributes of
  the tail"), **Modulation** ("extended control for the tail"),
  **Reflections** (split into **Reflection 1** and **Reflection 2** where
  there are more than six controls), **Echoes** (Chamber and Plate), and
  **Levels, Mix and EQ** (the input and the wet/dry mix). Which control sits
  on which page is *inferred*: the strings name the pages but not their
  contents.
- **Soft row.** Six slots; any control can be assigned to any slot, even
  twice, and the assignment is saved in the preset. Every factory preset ships
  the same row: Predelay, Reverb Time, Rolloff, Diffusion, RT HiCut, Mix. A
  string names nine slots (`Soft Parameter 0`–`8`), but presets store six and
  the panel draws six.
- **Realtime display.** Clicking cycles four views: off (the default, which
  shows only the name), Frequency (an analyser, lows on the left), Multiband
  (five bands, labelled 50 Hz, 200 Hz, 800 Hz, 3.2 kHz and 12.8 kHz, as a
  waterfall moving right to left, lows at the back), and Impulse (the
  response, moving left as it ages). Its legend is `RTVLegend.png`, coloured
  green `#387038`, brown `#a86020`, red `#a82820` and blue `#2038e8`.
- **Store window.** `StoreBG.png` (500 × 410): a user-preset list, a name
  field, and Store, Replace, Delete and Cancel. User presets are XML in
  `~/Library/Application Support/Lexicon/Native/User Presets/`, readable by
  any host.
- **Colours.** Chrome `#3a3a3b`, panels `#1c2329` to `#212a2e`, the knob
  well `#16171a`, accents as above.

## The parameters

Every original parameter, with its value text as the format strings and
presets show it. The ranges are *inferred*: nothing readable states them.
Each is set wide enough for every factory preset, and at the ends the manual
or the presets point to. "Seen" is the range across all 225 presets.

| Original (preset attribute) | On screen | Text | Key here | Range here | Seen | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `Predelay` | Predelay | `%6.2f ms` | `predelayMs` | 0–500 ms | 0–330 | |
| `Diffusion` | Diffusion | `%3.0f%%` | `diffusion` | 0–1 | 0–1 | |
| `Shape` | Shape | `%2.0f` | `shape` | 0–64, whole | 0–64 | The manual's figure uses 32 and 64 |
| `Spread` | Spread | `%3.0f%%` | `spread` | 0–1 | 0–1 | |
| `Size` | Size | `%4.1f meters` | `sizeM` | 2–80 m | 2–80 | |
| `Reverb_Time` | Reverb Time | `%7.4f sec` | `reverbTimeS` | 0.1–20 s, log | 0.139–12.9 | Four decimals: the original computes it, see below |
| `BassRT` | BassRT | `%4.2fx` | `bassRt` | 0.2–4 × | 0.2–3.1 | 0.2 is the floor in all four |
| `Bass_XOV` | Bass XOV | `%5.0fHz` | `bassXovHz` | 20–5000 Hz, log | 40–2800 | |
| `RT_HiCut` | RT HiCut | `%5.0fHz` | `rtHiCutHz` | 100–20 000 Hz, log | 395–20 000 | |
| `Spin` | Spin | `%3.1fHz` | `spinHz` | 0–5 Hz | 0–3.4 | |
| `Wander` | Wander | `%3.1fms` | `wanderMs` | 0–24 ms | 0–24 | Two algorithms' presets stop at exactly 24.0 |
| `Tap_Slope` | Tap Slope | `%3.0f` | `tapSlope` | −10–10, whole | −7–10 | The manual suggests 5–10 for gated sounds |
| `Rfl_Time_Mast` | Rfl Time Mast | `%3.0f%%` | `rflTimeMaster` | 0–1 | 0.24–1 | |
| `L_L_Rfl_Dly` … `R_L_Rfl_Dly` | L-L Rfl Dly … | `%6.2f ms` | `llRflMs`, `lrRflMs`, `rrRflMs`, `rlRflMs` | 0–1000 ms | 0.84–600 | Room and Hall |
| `L_L_Rfl_Gain` … | L-L Rfl Gain … | `%5.1f dB%s`, or `OFF` | `llRflDb` … | −80 (off) to 0 dB | off, −14–0 | |
| `L_Rfl_Dly`, `R_Rfl_Dly` | L Rfl Dly, R Rfl Dly | `%6.2f ms` | `lRflMs`, `rRflMs` | 0–1000 ms | 2–370 | Chamber and Plate |
| `L_Rfl_Gain`, `R_Rfl_Gain` | L Rfl Gain … | `%5.1f dB%s` | `lRflDb`, `rRflDb` | −80 (off) to 0 dB | −9–0 | |
| `Eko_Time_Mast` | Eko Time Mast | `%3.0f%%` | `ekoTimeMaster` | 0–1 | 0.9–1 | Chamber and Plate |
| `Eko_Fbck_Mast` | Eko Fbck Mast | `%3.0f%%` | `ekoFbMaster` | 0–1 | 0–1 | |
| `L_Eko_Dly`, `R_Eko_Dly` | L Eko Dly … | `%6.2f ms` | `lEkoMs`, `rEkoMs` | 0–1000 ms | 2–474 | |
| `L_Eko_FBack_Polarity` … | L Eko FBack Polarity … | Normal / Inverted | `lEkoPolarity`, `rEkoPolarity` | choice | both | |
| `L_Eko_FBack`, `R_Eko_FBack` | L Eko FBack … | `%5.1f dB%s`, with " INV" when inverted, or `OFF` | `lEkoFbDb`, `rEkoFbDb` | −80 (off) to 0 dB | off, −25 to −4.6 | |
| `Early_Level` | Early Level | `%5.1f dB` or `OFF` | `earlyDb` | −80 (off) to 0 dB | off, −86–0 | One Chamber preset sits at −86 dB, under this floor; it loads as off |
| `Rvb_Level` | Rvb Level | `%5.1f dB` | `reverbDb` | −80 (off) to 0 dB | −19–0 | |
| `Rolloff` | Rolloff | `%5.0fHz` | `rolloffHz` | 100–20 000 Hz, log | 525–16 000 | |
| `Mix` | Mix | `%3.0f%%` | `mix` | 0–1 | always 1 | |

Units and skews are not readable. Here, the four frequency controls and
Reverb Time sweep logarithmically and the rest linearly. Percent controls are
fractions, as everywhere in the app. The strings also hold note values from a
32nd-note to a half note, with dotted and triplet forms, and a time format
marked with "!": the delay times could lock to tempo. That is left out, as it
was for SoundHack, because the rack has no tempo.

The order of each table below is the order of the preset attributes, which is
taken to be the original's own parameter order. A parameter's index here is
its position.

## LXP Hall

*Original: "LXP Native Hall", AU `aufx` `Mhl1` `Lexi`, 31 parameters (25 plus
six soft-row slots). 64 presets in five categories.*

**What the manual says it is, in brief.** A large, wide space: very little
reflected energy in the first 60–100 ms, a slow build in density, a longer
time, and lows that last longer than highs. Smoother and more even than a real
hall, and less obtrusive than the others because it starts thin.

**Parameters, in order.** `predelayMs` 14, `diffusion` 0.97, `shape` 17,
`spread` 0.51, `sizeM` 35, `reverbTimeS` 1.6859, `bassRt` 1.5, `bassXovHz`
600, `rtHiCutHz` 4500, `spinHz` 2.9, `wanderMs` 15, `tapSlope` 0,
`rflTimeMaster` 1, `llRflMs` 22, `llRflDb` −6, `lrRflMs` 41, `lrRflDb` −8,
`rrRflMs` 26, `rrRflDb` −6, `rlRflMs` 39, `rlRflDb` −9, `earlyDb` −1.5,
`reverbDb` −5.5, `rolloffHz` 10 750, `mix` 0.35. These are the defaults:
"Med Hall", with the mix at 0.35 rather than 1 for an insert.

**Voicing here.** Lines 0.707–1.311 × size / 343 s, one all-pass (gain 0.35)
in each loop, four input all-passes up to 0.72, four reflections: L→L, L→R,
R→R, R→L.

**Presets** (category: names, in file order):

- **Small Spaces** (8): V.O. Booth, V.O. Booth 2, V.O. Booth 3, Behind the gobo, House of Gordon, Faby's Fooby, The Garrett, Rodriguez Cubby.
- **Small Halls** (16): Small Clear Hall, Small Clearer Hall, Small Thin Hall, Small Thin Hall 2, Small Thin Hall 3, Small Perc Hall, Small Impact Hall, Small Abrupt Hall, Small Drummer Hall, Small Drummer Hall 2, Small Drummer Hall 3, Small Drummer Hall 4, Small Vocal Hall, Small Vocal Hall 2, Small Vocal Hall 3, Small Inverse.
- **Medium Halls** (18): Med Hall, Med Deep Hall, Med Rich Hall, Med Rich Hall 2, Med Rich Hall 3, Recital Hall, Recital Hall 2, Med Vocal Hall 1, Med Vocal Hall 2, Med Vocal Hall 3, Med Voice, Med Voice 2, Med Drums, Med Drums 2, Med Drums 3, Med  Inverse, The Witcher Hour, Casey bites his Tongue.
- **Large Halls** (16): Large Hall, Large Neutral Hall, Large Early Hall, Large Pop Hall, Large Deep Hall, EM7 Large Hall, Large Vocal Hall 1, Large Vocal Hall 2, Large Vocal Hall 3, Large Vocal Hall 4, Big Fat and Rich, Big Fat and Rich 2, Big Fat and Rich 3, Laurel Hall, Fran's Snap Hall, Jeff hits his Targets.
- **Huge Halls** (6): Ginormous Hall, Cathedral 1, Cathedral 2, Cathedral 3, Trapped in Hell, Gust of Wind.

The Inverse presets are the manual's gated and reverse recipe: short Reverb
Time, high Spread, Shape and Size, and a positive Tap Slope.

## LXP Room

*Original: "LXP Native Room", 31 parameters, the Hall's set. 47 presets in
three categories.*

**What the manual says it is.** The Hall's relative, tuned for small spaces
and short times. Size matters more here. It still moves the time a little, but
mainly it sets how grainy the reverb is: large sizes let single reflections
stand out, small ones blur them. Its uses are post-production (small rooms,
dialogue replacement, foley, exteriors) and studio rooms (booths, drum
rooms, small rooms dark and bright).

**Parameters.** The Hall's 25, in the same order. Defaults from "Medium Tiled
Room": `predelayMs` 14, `diffusion` 0.86, `shape` 29, `spread` 0.49, `sizeM`
18.5, `reverbTimeS` 0.8688, `bassRt` 1.5, `bassXovHz` 385, `rtHiCutHz` 3450,
`spinHz` 2.5, `wanderMs` 7, `tapSlope` 0, `rflTimeMaster` 1, `llRflMs` 14,
`llRflDb` −2.5, `lrRflMs` 33, `lrRflDb` −7, `rrRflMs` 17, `rrRflDb` −1.5,
`rlRflMs` 37, `rlRflDb` −6, `earlyDb` −8, `reverbDb` −4.5, `rolloffHz` 7250,
`mix` 0.35.

**Voicing here.** The Hall's line ratios × 0.85 and **no** all-pass in the
loop, so the grain shows. At 60 m the first tenth of a second has a few loud
moments; at 8 m it is a wash. Four input all-passes up to 0.7, and the Hall's
four reflections. The pad's ranges are smaller: Size 3–30 m, Reverb Time
0.2–2 s.

**Presets:**

- **Small Spaces** (20): In the Stall, In the Next Stall, Studio 3, Hard Tile, Soft Tile, Riled Tomb, Hard Tight Wall, Slap Room, Oval Office, Garden Shed, Coat Closet, Master Bedroom, Storeroom, Head in a bucket, Pickup Truck, Head in the Hopper, Vocal Tomb, Guest Bedroom, Moogie's Room, Hopper Bopper.
- **Medium Spaces** (16): Medium Tiled Room, Medium Tiled Room 2, Medium Tiled Room 3, Medium Tiled Room 4, Aluminum Toolshed, Barn, Hayloft, Small Restaurant, Backstage, The Annex, Mezzanine, In the Lobby, Dining Alone, On the Lanai, Yard Sale, Feeney's Echo Beanie.
- **Large Spaces** (11): Large Restaurant, School Hallway, Warehouse, Observatory, Gymnausea, Mall Stairwell, Tofu Slaughterhouse, Ridgeline, Off the Tee, Back Nine, Black Diamond.

## LXP Chamber

*Original: "LXP Native Chamber", 35 parameters (29 plus six soft-row slots).
67 presets in three categories.*

**What the manual says it is.** An echo chamber: a small reflective room with
a speaker and microphones in it. It gets dense fast, with no audible slaps off
the walls. Small settings sound like a chamber; large ones like a small
performance space that fills in faster than a hall. Its tails are randomised.

**Parameters, in order.** The shared 13 (Predelay to Rfl Time Mast), then
`lRflMs`, `lRflDb`, `rRflMs`, `rRflDb`, `ekoTimeMaster`, `ekoFbMaster`,
`lEkoMs`, `lEkoPolarity`, `lEkoFbDb`, `rEkoMs`, `rEkoPolarity`, `rEkoFbDb`,
then `earlyDb`, `reverbDb`, `rolloffHz`, `mix`. Defaults from "Medium Honey
Vocal 2": `predelayMs` 13, `diffusion` 0.12, `shape` 19, `spread` 0.69,
`sizeM` 50.5, `reverbTimeS` 1.8736, `bassRt` 1.3, `bassXovHz` 950,
`rtHiCutHz` 4425, `spinHz` 1.6, `wanderMs` 9, `tapSlope` 0, `rflTimeMaster`
1, `lRflMs` 62, `lRflDb` 0, `rRflMs` 50, `rRflDb` 0, `ekoTimeMaster` 1,
`ekoFbMaster` 0.75, `lEkoMs` 135, `lEkoPolarity` Inverted, `lEkoFbDb`
−10.5, `rEkoMs` 117, `rEkoPolarity` Normal, `rEkoFbDb` −10.5, `earlyDb` −4,
`reverbDb` −5.5, `rolloffHz` 6375, `mix` 0.35.

**Echoes, as the original describes them.** A diffused delay from one side's
input to the same side's output that can also recirculate into that side's
input. Its feedback has a sign switch. The two masters scale every echo's
time and every echo's feedback.

**Voicing here.** Lines 0.482–0.872 × size / 343 s, more unevenly spaced
than the Hall's, with **two** all-passes in each loop (gain 0.5), so the
density comes up within the first 60 ms. Four input all-passes up to 0.7, two
reflections (L→L, R→R) and two echoes.

**Presets:**

- **Small Chambers** (19): Small and Sweet, Small Chamber 1, Small Chamber 2, Small Chamber 3, Small and Light, Small and Lighter, Small Cistern, Discrete Cistern, Live Cistern, Bomb Shelter, Missile Silo, Hobby Chamber, Principal's Office, Colored Chamber, Colored Chamber 2, Flutter Chamber, Flutter Chamber 2, Flutter Chamber 3, Small Slap Chamber.
- **Medium Chambers** (26): Medium Chamber 1, Medium Chamber 2, EM7 Medium Chamber, Medium Rich Chamber, Medium Rich Chamber 2, Medium Rich Chamber 3, Medium Light Chamber, Medium Vocal Chamber, Medium Honey Vocal, Medium Honey Vocal 2, Medium Honey Vocal 3, Bead Chamber, Bead Chamber 2, Bead Chamber 3, Medium Slap Chamber, Fake Gate, Fake Gate 2, Thunder Gate, Thunder Gate 2, Medium Fizz Chamber, Medium Fizz Chamber 2, Medium Fizz Chamber 3, Medium Drum Chamber, Medium Drum Chamber 2, Medium Drum Chamber 3, Medium Drum Chamber 4.
- **Large Chambers** (22): Large Chamber 1, Large Rich Chamber, Large Rich Chamber 2, Large Rich Chamber 3, Large Rich Chamber 4, Large Rich Chamber 5, Large Light Chamber, Deep Chamber 1, Deep Chamber 2, Large and Tight, Large and Tight 2, Large and Tight 3, Large and Tight 4, Large and Tight 5, Large Voice Chamber, Large Voice Chamber 2, Large Voice Chamber 3, Large Voice Chamber 4, Large Voice Chamber 5, Large Voice Chamber 6, Huge Chamber, Eureka Underground.

## LXP Plate

*Original: "LXP Native Plate", 35 parameters, the Chamber's set. 47 presets in
three categories.*

**What the manual says it is.** A metal sheet hung on springs and driven by a
transducer. It is diffuse from the very start, bright and coloured, and
thickens the sound it is fed rather than sitting behind it, which suits
percussion. For many people this is simply what reverb sounds like.

**Parameters.** The Chamber's 29, in the same order. In every factory plate
the echo polarities are Inverted and Eko Time Mast is 100 %. Defaults from
"Small Rich Plate 2": `predelayMs` 0, `diffusion` 0.88, `shape` 7, `spread`
0.13, `sizeM` 32, `reverbTimeS` 0.9664, `bassRt` 0.2, `bassXovHz` 95,
`rtHiCutHz` 2750, `spinHz` 1.2, `wanderMs` 5.7, `tapSlope` 0,
`rflTimeMaster` 1, `lRflMs` 33, `lRflDb` −6, `rRflMs` 22, `rRflDb` −6,
`ekoTimeMaster` 1, `ekoFbMaster` 1, `lEkoMs` 89, `lEkoPolarity` Inverted,
`lEkoFbDb` −25, `rEkoMs` 105, `rEkoPolarity` Inverted, `rEkoFbDb` −23.5,
`earlyDb` −3.5, `reverbDb` −3, `rolloffHz` 3725, `mix` 0.35.

**Voicing here.** The shortest lines, 0.362–0.676 × size / 343 s, so the modes
sit close enough to colour the sound. Two all-passes in each loop (gain 0.6),
and **six** input all-passes up to 0.75, so it is dense from the first
milliseconds. Two reflections and two echoes, as in the Chamber.

**Presets:**

- **Short Plates** (15): Small Plate 1, Small Plate 2, Small Plate 3, Small Plate 4, Small Rich Plate , Small Rich Plate 2, Small Rich Plate 3, Small Rich Plate 4, Dessert Plate, Short Slap Plate 1, Small Slapback, Small Slapback 2, Sixties Space Plate, Another Space Plate, Small Inverse.
- **Medium Plates** (20): Medium Plate 1, Medium Plate 2, Medium Plate 3, Medium Plate 4, Blue Plate 1, Blue Plate 2, Blue Plate 3, Blue Plate 4, Clean Plate, Colored Plate 1, Colored Plate 2, Colored Plate 3, Medium Vox Plate, Medium Vox Plate 2, Medium Vox Plate 3, Medium Vox Plate 4, Medium Fizz, Medium Fizz 2, Medium Fizz 3, Medium Fizz 4.
- **Large Plates** (12): Large Plate 1, Large Plate 2, Large Plate 3, Large Plate 4, Big Fat Plate, Big Fat Plate 2, Big Fat Plate 3, Big Fat Plate 4, Big Fat Plate 5, Giant Plate, Again Plate, Again Plate Again.

## All 225 presets, as values here

[`lexicon-presets.json`](lexicon-presets.json) holds every factory preset
converted to this app's keys and units: one object per preset, with its
category, its name, its soft row and its `params`. Percent becomes a
fraction, `OFF` becomes −80 dB, and Normal / Inverted become 0 / 1. The
" INV" on a feedback's text is dropped, because the polarity key carries it.
Nothing loads it yet. The rack has no per-effect preset menu; when it gets
one, this is its factory bank.

## The engine here

*Here, all of it. prism-fx's own design, in `src/effects/lxp.rs`, shared by
the four `lxp_*.rs` modules. Each module holds a descriptor, a list of what
each of its parameters does, and a voicing.*

**Signal path, per frame.**

```
read every control's glide
every 16 frames (counted since reset): recompute coefficients
step each line's wanderer (if spin > 0)

for each side s:                           # Chamber and Plate only
    e[s]   = allpass(echo[s].read(echoMs[s] · echoTimeMaster), 1.67/2.29 ms, 0.5)
    fb     = min(dB(echoFb[s]) · echoFbMaster, 0.98) · (inverted ? −1 : 1)
    in[s]  = dry[s] + fb · e[s]
    early[s] += e[s]
    echo[s].push(in[s])

for each side s: source[s].push(in[s])
for each reflection v (from, to):
    r = allpass(source[from].read(rflMs[v] · rflTimeMaster), 1.31–2.53 ms, 0.5)
    early[to] += dB(rflDb[v]) · r

for each side s:                           # the reverb's input
    predelay[s].push(in[s])
    x = predelay[s].read(predelayMs)
    x = 4 (Plate: 6) all-passes, 2.4–11.4 ms, gain diffusion · max
    spread[s].push(x)
    fed[s][k] = spread[s].read(t[k]) · w[k]   for k = 0..7

for each line i of 8:
    L = size/343 · ratio[i] · sr + wander offset
    y = line[i].hermite(L)
    y = loop all-passes (0–2), 6.7 % and 10.9 % of the line, by algorithm
    low += a_xov · (y − low)
    y = midGain[i] · (y − low) + bassGain[i] · low
    high += a_hicut · (y − high);  end[i] = high
    heard = Σ_j v[j] · line[i] at 25, 50, 75 % of its length, + v[3] · end[i]
    out_L += signL[i] · heard;  out_R += signR[i] · heard
line[i].push( hadamard(end)[i] + fed[L][i] + signRight[i] · fed[R][i] )
tank = 0.35 · (out_L, out_R)

wet[s] = lowpass2(rolloff)( dB(earlyDb) · early[s] + dB(reverbDb) · tank[s] )
out[s] = dry[s] · (1 − mix) + wet[s] · mix
```

`dB(x)` is `10^(x/20)`, except that −80 dB is exactly silence.

**Coefficients.**

- **Injection taps.** `t[k] = spread · 2 · size / 343 · sr · k/7 + k · 0.25 ms`.
  `w[k] = e^(β · k/7)` with `β = 6 · (2 · shape/64 − 1)`, normalised so that
  `Σ w² = 1`. A low shape front-loads the window, 32 is even, and 64
  back-loads it. With Spread at zero the eight taps sit 0.25 ms apart, so Shape
  still changes the timbre and density, as the manual says it does.
- **Decay.** For each line, the loop length `D = base · (1 + Σ all-pass
  shares)`. Then `midGain = 10^(−3 · D / (reverbTime · sr))` and `bassGain =
  10^(−3 · D / (reverbTime · bassRt · sr))`. The one-pole coefficients are
  `1 − e^(−2π f / sr)`.
- **Tap Slope.** `v[j] = 10^(2.5 · slope · (p[j] − 0.625) / 20)`, with
  `p = 0.25, 0.5, 0.75, 1`, normalised so that `Σ v² = 1`.
- **Wander.** Each line has a phase that advances by `spin / sr` per frame.
  When it wraps, the line takes a random step of up to ±`wander` ms from where
  it is, kept within 0 to `wander`, and glides there linearly over the next
  cycle. The eight phases start an eighth of a cycle apart. With Spin at
  zero, nothing moves.
- **Rolloff.** A second-order Butterworth low-pass, bilinear, in f64, its
  cutoff at most 0.45 × the sample rate.

**Constants.** These come from this engine, not from the binary, which could
not be read. So there are no addresses.

| Constant | Value | Use |
| --- | --- | --- |
| `SOUND` | 343 m/s | size to time |
| `LINES`, `TAPS` | 8, 8 | tank lines, injection taps |
| `STAGGER_S` | 0.25 ms | the gap between injection taps when Spread is shut |
| `CONTROL` | 16 frames | coefficient update rate |
| `INPUT_AP_S` | L 2.43, 3.71, 5.17, 7.39, 9.11, 11.03 ms; R 2.61, 3.89, 5.47, 7.73, 9.59, 11.41 ms | input all-passes |
| `LOOP_AP` | 0.067, 0.109 of the line | loop all-passes |
| `REFLECTION_AP_S` | 1.31, 1.73, 2.07, 2.53 ms | reflection diffusers |
| `ECHO_AP_S` | 1.67, 2.29 ms | echo diffusers |
| `VOICE_DIFFUSION` | 0.5 | early voices' all-pass gain |
| `MOST_FEEDBACK` | 0.98 | echo feedback ceiling |
| `OUT_TAPS` | 0.25, 0.5, 0.75, 1 | where each line is heard |
| `TANK_GAIN` | 0.35 | puts the tail near the input's level at 1.5 s |
| `OUT_SIGNS` | Hadamard rows 1 and 2 | left and right output mixes |
| `RIGHT_SIGNS` | +−−++−−+ | the right side's injection signs |
| `OFF_DB` | −80 dB | the bottom of every level: silence |
| buffers | predelay 0.5 s, voices 1 s, size 80 m, wander 24 ms | allocated in `new` |

| Voicing | Line ratios | Loop all-passes | Input all-passes | Reflections | Echoes |
| --- | --- | --- | --- | --- | --- |
| Hall | 0.707, 0.788, 0.859, 0.937, 1.031, 1.117, 1.203, 1.311 | 1 at 0.35 | 4 up to 0.72 | LL, LR, RR, RL | — |
| Room | 0.601, 0.670, 0.730, 0.796, 0.876, 0.949, 1.023, 1.114 | none | 4 up to 0.70 | LL, LR, RR, RL | — |
| Chamber | 0.482, 0.526, 0.577, 0.640, 0.683, 0.748, 0.815, 0.872 | 2 at 0.5 | 4 up to 0.70 | LL, RR | L, R |
| Plate | 0.362, 0.403, 0.446, 0.482, 0.524, 0.571, 0.614, 0.676 | 2 at 0.6 | 6 up to 0.75 | LL, RR | L, R |

**Smoothing.** Every control glides with the crate's one-pole `Smoothed`:

- Size 200 ms;
- predelay, reflection and echo times, and the three masters 60 ms;
- levels (in dB) and mix 10 ms;
- everything else 20 ms;
- the polarities jump.

The delay reads interpolate, so a moving time bends the pitch, as a tape or a
hardware delay does. The original's smoothing is unknown.

## The original's faults

Without the code, only faults that show in what could be read are listed.

- **A tooltip names a control that does not exist.** RT HiCut's tooltip says
  it works with "RTHC Damping". No such parameter is in any string or preset.
- **The manual's preset folder is not the one the code uses.** The manual
  gives `…/Application_Support/LexiconPro/Native/User_Presets/<algorithm>`.
  The binary's string is `~/Library/Application Support/Lexicon/Native/User
  Presets/`.
- **The manual's installer is not the one shipped.** It says to insert a CD
  and open `LXP Reverb.mpkg`. The download is a `.dmg` holding a flat `.pkg`.
- **Nine soft-row slots in the strings, six in the presets and on screen.**
- **The AU versions lag the bundles.** Every bundle says 1.2.4. The Audio
  Unit component versions are 66051 (1.2.3) for the Chamber and the Hall, and
  66050 (1.2.2) for the Plate and the Room, so a host may report an older
  version than was installed.
- **Preset names.** "Med  Inverse" has a double space. "Small Rich Plate "
  ends in a space. Both are kept as found in the JSON.
- **The Reverb Time display is approximate.** The manual says the value shown
  is an estimate from Size and the time control, and that the real decay also
  depends on other controls and the material. Its four decimals suggest more
  precision than it has.

## Built

*23 October 2026. In prism-fx (`lxp`, `lxp_chamber`, `lxp_hall`,
`lxp_plate`, `lxp_room`), so MultiGrainLive and idMLab share them. Codes 17–20
are the next free after SoundHack's 8–16.*

| Effect | Id, code | Category, picker group | Groups | Pad (X / Y) |
| --- | --- | --- | --- | --- |
| LXP Chamber | `lxp-chamber`, 17 | Reverb, Reverb & Delay | Reverb, Modulation, Reflections, Echoes, Levels, Mix and EQ | `sizeM` 5–60 / `reverbTimeS` 0.3–6 |
| LXP Hall | `lxp-hall`, 18 | Reverb, Reverb & Delay | Reverb, Modulation, Reflections, Levels, Mix and EQ | `sizeM` 5–60 / `reverbTimeS` 0.3–6 |
| LXP Plate | `lxp-plate`, 19 | Reverb, Reverb & Delay | as the Chamber | `sizeM` 5–60 / `reverbTimeS` 0.3–6 |
| LXP Room | `lxp-room`, 20 | Reverb, Reverb & Delay | as the Hall | `sizeM` 3–30 / `reverbTimeS` 0.2–2 |

The primary controls are the factory soft row: Predelay, Reverb Time,
Rolloff, Diffusion, RT HiCut, Mix. The displays are meters and a spectrum,
standing in for the original's level meters and realtime display.

**Where it differs from the original, apart from the sound itself.**

- **Reverb Time is the time.** In the original it is a computed estimate
  from Size and an underlying reflectivity, so Size moves it. Here it sets
  the 60 dB decay at mid frequencies directly. Size changes the space's
  density and the tank's first arrival, not its length. A factory preset's
  Reverb Time loads as the time it shows.
- **The soft row is fixed.** Its six slots are not parameters that reach the
  sound, so they are not kept as controls. The six are the panel's primary
  controls, as every factory preset has them.
- **Echoes and reflections have their own all-pass, at a fixed 0.5.** The
  original calls them diffused; how much is unknown.
- **Echo feedback stops at 0.98.** The original's ceiling is unknown. Here, 0
  dB at a master of 100 % rings on and does not grow.
- **The mix defaults to 35 %**, not the presets' 100 %, because the rack is
  an insert. The original's sticky mix, which kept its value across preset
  loads, is not reproduced; the rack has no preset loads yet.
- **Left out:** tempo locks (no rack tempo), the four-view realtime display
  (the shared panel's spectrum stands in), Store, Compare and Reload (the
  host's own presets do that), and the nine-slot soft-row assignment.

**Tests.** In prism-fx, `tests/lxp_*.rs`: 18 to 24 per effect, from shared
scenarios in `tests/support/lxp.rs`.

- **Reverb Time and Size.** The decay measured from a click is the time set,
  within 30 %, at three times per algorithm. Size changes the first arrival
  and not the time.
- **The bands.** BassRT lengthens the lows by more than 10 dB at 3 against
  0.5. RT HiCut at 1 kHz cuts the highs by more than 10 dB.
- **Predelay** holds the tail back by its time and leaves the early voices
  where they were.
- **Shape, Spread and Tap Slope** each move the energy later.
- **Spin and Wander.** With Spin at zero, Wander changes nothing, bit for bit.
  Otherwise it changes the output, and it makes a ringing tail waver.
- **Rolloff and Diffusion.** Rolloff darkens. Diffusion more than doubles the
  loud samples in the first 20 ms.
- **Level and stereo.** One side in reaches both sides out, decorrelated. The
  tail sits within −12 to +6 dB of the input. It dies away. The bottom of each
  level is silence, and a mix of zero is the dry sound exactly.
- **Reflections.** Each one lands on its time, sums to its gain, goes only to
  the side its name says, and halves with Rfl Time Mast at 50 %.
- **Echoes** (Chamber, Plate):
  - they repeat at their time and fall by their feedback;
  - Polarity flips every other repeat;
  - the masters scale time and feedback;
  - Predelay does not move them;
  - full feedback rings on without growing.
- **Character.** The Chamber and the Plate thicken at least 1.5 times faster
  than the Hall. A large Room is grainier than a small one.

All four also pass the contract over the catalogue:

- frames equal blocks, and block size does not matter;
- every control reaches the output;
- the output stays finite under abuse;
- reset is a fresh start;
- nothing allocates after `new`.

In MultiGrainLive, `tests/ui/prism-fx.spec.mjs` checks four things:

- all four are in the picker under Reverb & Delay;
- the Hall's and the Chamber's pages are the groups listed above;
- the pad is Size against Reverb Time;
- a moved Size and a clicked Polarity reach the stored rack.

**Not checked:** listening against the originals. Their sound cannot be
compared without running them, and running them was out of bounds.
