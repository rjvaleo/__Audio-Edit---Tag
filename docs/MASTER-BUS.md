# The master bus

Written 17 Aug 2026, when it was designed.

Three panels in the right half of the Time & Pitch tray — the space the grain
views left when they moved into a window. A VU meter with numbers, a Lissajous,
and an annotated spectrum analyser.

## What was already live

Worth stating plainly, because the answer surprised the person who asked: the
`POST FILTER` fill behind the parametric EQ, the `LIVE SIGNAL` trace behind the
compressor, and the `GAIN REDUCTION` line are all **real measurements of real
audio**. None of it is simulated.

`Shared::measure` runs inside the audio callback, after the fader and after
`fx::soften` — so it is the master bus out: post-grains, post-rack, post-fader,
post-ceiling. It computes a 1024-point Hann-windowed FFT, publishes 512 bins as
0..255 over 90 dB, and publishes 128 peak columns from the same window so the
spectrum and the waveform describe the same instant. Everything goes out under
`try_lock` and nothing allocates.

The green curve over the EQ is not measured — that is the filter response drawn
from the parameters, which is what it should be.

## What was missing

**Stereo.** `measure` sums to mono (`sum / channels`) before it does anything
else. A Lissajous plots L against R; a mono sum has already thrown that away, so
a goniometer could not be drawn from any data the program had.

**RMS.** Only peak is published. Peak bars are not a VU — a VU is an integrating
meter, and the integration is the whole point of it.

**Resolution.** 1024 points is 43 Hz per bin at 44.1 kHz, so everything from
20 Hz to 100 Hz lands in about two of them. Fine for a decorative fill behind an
EQ; not a detailed analyser.

## The decision: analysis leaves the audio thread

The callback stops doing transforms. It copies L and R into a fixed ring and
that is all — a memcpy, no FFT, no windowing, no log10.

Everything else is computed on the server thread from that ring, at whatever
size the display wants. This was chosen over raising the callback FFT to 4096
because it goes the *other* way on cost: the 1024-point transform that runs in
the callback today is **removed**, not multiplied. Given the engine has been
seen at 120% on a heavy preset, spending four times as long in the callback to
get prettier bass resolution is the wrong trade.

It also means one tap serves all three panels, and the Lissajous gets its stereo
from the same place the spectrum gets its resolution.

### The ring

16,384 frames of L and R, kept apart. 128 KB, sized once, never grown.

That length is set by the slowest consumer: a true VU integrates over 300 ms,
which is 14,400 frames at 48 kHz. 16,384 covers it with room, and covers a
4096-point FFT four times over.

The callback takes `try_lock` and skips the block if the server happens to hold
it — the same discipline as the capture and the spectrum. The server's side of
that bargain is to **copy the ring out under the lock and do the arithmetic
outside it**, so a 4096-point FFT never holds a lock the audio thread wants.

## The meters

**0 VU = −18 dBFS**, EBU R68. Chosen over SMPTE's −20 as the more usual default.
dBFS is shown numerically as well, so the reference is never in doubt.

**Ballistics: an integrated bar with a fast peak riding above it.** 300 ms RMS
for the bar — that is loudness, and it is what a VU is for. A separate fast peak
marker and a numeric peak-hold, because a 300 ms meter will not show you a
transient that hits the ceiling, and after the soft ceiling went in it matters
that you can see when it is working.

Right-aligned numeric readouts, as asked.
