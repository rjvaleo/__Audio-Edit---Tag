# The Goniometer Cloud

*A design, not a build. Nothing in here exists yet.*

---

## The thing

A goniometer draws the stereo field as a shape: left on one axis, right on the
other, rotated a quarter turn so mono stands upright. Narrow and vertical is
mono, round is wide, a horizontal smear is the two sides fighting. It is the
one picture that shows a fault no meter and no spectrum will.

This takes that figure off the flat plane and reads it as a **torus** — a ring
seen in three dimensions, which can expand and contract. It is not drawn as a
surface. It is made of **specks**, with **gas or mist** through it, so it reads
as something ephemeral rather than an object with a skin. Every speck is a
grain, placed where that grain actually sits in the stereo field.

And it is alive when nothing is playing. A visualiser that freezes on silence
says the instrument is off; this one should idle — a slow breath, a drift in
the mist, textures moving at their own pace. That idle motion is the only part
of the picture not driven by grains, so it has to be built rather than derived,
and it has to be quiet enough that the moment sound arrives there is no doubt
which is which.

## What already exists to draw from

The per-grain data on the wire today: output frame, source frame, size, pitch,
level, brightness, **stereo position**, and index. The stretch and grain
settings reach the panel. What does **not** exist yet is marked below — this is
the part of the document worth arguing with, because half the list needs
something published that currently is not.

## The twelve

Combed from all six engines — the grain cloud, WSOLA, the phase vocoder,
PVSOLA, the hybrid, and the document's own time and pitch. Sixty-four controls
between them; these are the twelve axes they collapse into, chosen so that
every one of them is something you can *see* change.

| # | Control | What it does to the picture | Fed by |
|---|---|---|---|
| 1 | **Population** | How many specks there are. The ring goes from a handful of points to a dense band. | `densityHz`, `overlap`, `layers`, `ratio` |
| 2 | **Mass** | How big each speck is, and how much of the ring one of them covers. | `windowMs`, `sizeRange`, vocoder `windowMs`, WSOLA `searchMs` |
| 3 | **Width** | The bore of the torus — how far off the mono axis the cloud opens. This is the goniometer reading itself. | `panSpread`, per-grain pan |
| 4 | **Coherence** | How tight the figure is against how smeared. A tight ring is a coherent stereo image; a blurred one is phase disagreement. | vocoder `stereoLink`, `phaseLock`, `phaseSpread`, WSOLA `splice` — **needs a correlation figure published** |
| 5 | **Hue** | Colour. Pitch maps to warmth, as everywhere else in this program. | `semitones`, `pitchJitterSemis`, per-grain pitch |
| 6 | **Agitation** | The tremble. Jittery grain sizes should read as specks that will not sit still. | `sizeJitter`, `positionJitterMs`, `linkJitter` |
| 7 | **Drift** | Slow rotation and sway of the whole torus, at the drift rate. Turn the depth off and it stops. | `pitchDriftSemis`, `driftRateHz`, `driftStep` |
| 8 | **Dispersion** | How thick the mist is, and how far it reaches past the specks. | `layerScatter`, `layerScatterMs`, `layerSpread` |
| 9 | **Travel** | Where the ring sits and which way it turns. | `position`, `scan`, `wrap`, `reverse` |
| 10 | **Haze** | Gas against specks — how much of the cloud is material you can pick out and how much is atmosphere. | hybrid `residualLevel`, `morphNoise`, vocoder `magGate`, `magBlur` — **not published today** |
| 11 | **Attack** | How sharp a speck's edge is, and whether the cloud flickers or glows. | `envelope`, WSOLA `preserveTransients`, `sensitivity`, `guardHops`, hybrid `percussiveLevel` — **partly published** |
| 12 | **Idle** | The ambient life when nothing is playing: breath rate, texture drift, how far it wanders. Derived from `seed`, so it is deterministic like everything else here. | `seed` — **new; nothing drives this today** |

## Things worth settling before any of this is built

**The idle is the risky one.** It is the only part not derived from grains, so
it is the only part that can lie. My instinct is that it should be visibly
*emptier* than the played state — the same shape breathing, but with almost no
specks — so silence reads as silence rather than as a quiet performance.

**Coherence needs a number that does not exist.** A correlation figure is one
line of arithmetic on the left/right pairs, but it has to be published from the
audio thread. There is groundwork for exactly this sitting uncommitted in
`transport.rs` from earlier today.

**Haze and Attack are half-blind.** The hybrid's three levels and the vocoder's
gate and blur never reach the picture. Either they get published, or those two
rows should be honest about being driven by less than they claim.

**Twelve is the number you asked for and I have not padded it.** If any of
these should be dropped, Travel and Drift are the two that overlap most.
