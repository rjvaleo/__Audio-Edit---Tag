//! One wavetable oscillator for one voice: up to 16 unison copies, the two
//! warp slots, the cycle effects, and a DC blocker.
//!
//! # Phase and reads
//!
//! Each unison copy has a `u32` phase: a full turn is 2³², so the phase wraps
//! by overflow and never drifts the way a float accumulator does over a long
//! note. The phase is turned into a float in 0..1 from its top 24 bits, which
//! a float holds exactly, warped, and read from the table with 4-point cubic
//! Hermite (Catmull-Rom) interpolation. The frame position is crossfaded: a
//! position between two frames reads both and blends them, so a position
//! sweep is smooth however few frames the table has. The position ramps
//! across each control block, so it has no steps either.
//!
//! # Choosing the mip level
//!
//! The read must contain no harmonic above Nyquist. A copy at phase increment
//! `inc` (cycles a sample) with a warp whose worst-case slope is `s` reads the
//! frame up to `inc·s` cycles a sample, so harmonic *h* lands at `h·inc·s`.
//! The level is the one whose top harmonic stays under ½ there. Within each
//! octave the level is crossfaded into the next one over the top 30% of the
//! octave, so a pitch sweep never hears a level switch; below that the full
//! level plays, keeping harmonics up to about 0.4 of the sample rate (19 kHz
//! at 48 kHz).
//!
//! FM's slope is the modulator's: the phase is `x + k·m(2x)`, so its slope is
//! `1 + 2k·max|m′|`. The modulator is read at the level for its own rate
//! (twice the carrier) and its steepest slope there comes with the table.
//!
//! # Unison
//!
//! Copies are spread evenly across ± `det · 60` cents, the outermost at the
//! full spread. Each is scaled by `1/√n`: detuned copies are uncorrelated, so
//! their powers add, and the sum keeps the loudness of one copy at any count.
//! Copies alternate left and right of the oscillator's pan by `spr`, flattest
//! first; with an odd count the middle copy stays on the pan. Panning is
//! equal-power, so it moves sound without changing its loudness.
//!
//! # The cycle effects
//!
//! `crush drive ring comb` are the mock-up's `ofxShape`, done on each copy's
//! own phase after the warps (see `fx.rs` for why). Crush reads the warped wave
//! at the held phase and keeps it until the next hold step; comb reads it a
//! `1/d` cycle either side, which is the harmonic comb `ofxShape` applies in
//! the spectrum, and then normalises the cycle's peak as `ofxShape` does, with
//! the gain worked out from each finished cycle.
//!
//! The DC blocker runs on the oscillator's output, after warps and shapers,
//! since fold, quant and crush can all leave DC behind.

use crate::fx::{js_round, Shaper};
use crate::table::{Wavetable, FRAME_LEN, FRAME_MASK, MIP_LEVELS};
use crate::warp::{eval, fract, Warp, WarpMode};

pub const MAX_UNISON: usize = 16;

/// The modulator for an FM slot: another oscillator's table at its position.
#[derive(Clone, Copy)]
pub(crate) struct FmSource<'a> {
    pub table: &'a Wavetable,
    pub pos: f32,
}

/// What one oscillator plays this block.
pub(crate) struct OscParams<'a> {
    pub table: &'a Wavetable,
    /// Frame position at the start and end of the block, 0..1.
    pub pos0: f32,
    pub pos1: f32,
    pub warps: [Warp; 2],
    pub fm: FmSource<'a>,
    pub hz: f32,
    pub uni: usize,
    pub det: f32,
    pub spr: f32,
    /// −1..1.
    pub pan: f32,
    pub shaper: Shaper,
    pub sr: f32,
}

#[derive(Clone, Copy, Default)]
pub(crate) struct DcBlocker {
    x1: f32,
    y1: f32,
}

impl DcBlocker {
    #[inline(always)]
    pub fn tick(&mut self, x: f32, r: f32) -> f32 {
        let y = x - self.x1 + r * self.y1;
        self.x1 = x;
        self.y1 = y;
        y
    }
}

/// The DC blocker's pole for a ~5 Hz corner.
#[inline]
pub(crate) fn dc_pole(sr: f32) -> f32 {
    (-std::f32::consts::TAU * 5.0 / sr).exp()
}

/// The level for a read at `f` cycles a sample, and how far it is crossfaded
/// into the next level up.
#[inline]
pub(crate) fn mip_for(f: f32) -> (usize, f32) {
    if f.is_nan() || f <= 0.0 {
        return (0, 0.0);
    }
    let r = (FRAME_LEN as f32 * f).log2();
    if r < -1.0 {
        return (0, 0.0);
    }
    let fl = r.floor();
    let level = fl as i32 + 1;
    if level >= MIP_LEVELS as i32 - 1 {
        return (MIP_LEVELS - 1, 0.0);
    }
    let xw = ((r - fl - 0.7) / 0.3).clamp(0.0, 1.0);
    (level.max(0) as usize, xw)
}

/// 4-point Hermite on one frame of a level.
#[inline(always)]
pub(crate) fn herm(d: &[f32], base: usize, i: usize, t: f32) -> f32 {
    hermite(points(d, base, i), t)
}

/// The four samples around index `i` of the frame at `base`.
#[inline(always)]
fn points(d: &[f32], base: usize, i: usize) -> [f32; 4] {
    assert!(base + FRAME_LEN <= d.len());
    // SAFETY: every index is `base` plus something masked to the frame, and
    // the frame lies inside `d` (checked above, once per read rather than
    // four times; this is the innermost loop of the synth).
    unsafe {
        [
            *d.get_unchecked(base + ((i + FRAME_MASK) & FRAME_MASK)),
            *d.get_unchecked(base + (i & FRAME_MASK)),
            *d.get_unchecked(base + ((i + 1) & FRAME_MASK)),
            *d.get_unchecked(base + ((i + 2) & FRAME_MASK)),
        ]
    }
}

#[inline(always)]
fn blend(a: [f32; 4], b: [f32; 4], u: f32) -> [f32; 4] {
    [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u]
}

/// Catmull-Rom through four points, at `t` between the middle two.
#[inline(always)]
fn hermite(p: [f32; 4], t: f32) -> f32 {
    let [xm1, x0, x1, x2] = p;
    let c1 = 0.5 * (x1 - xm1);
    let c2 = xm1 - 2.5 * x0 + 2.0 * x1 - 0.5 * x2;
    let c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
    ((c3 * t + c2) * t + c1) * t + x0
}

/// A frame position as two frame offsets and a blend.
#[inline(always)]
fn frame_at(pos: f32, frames: usize) -> (usize, usize, f32) {
    let p = pos.clamp(0.0, 1.0) * (frames - 1) as f32;
    let a = (p as usize).min(frames - 1);
    let b = (a + 1).min(frames - 1);
    (a * FRAME_LEN, b * FRAME_LEN, if b == a { 0.0 } else { p - a as f32 })
}

/// Read one table level pair at phase `x`. Hermite is linear in its points,
/// so the frames and levels are blended point by point and interpolated once:
/// the same result as interpolating each and blending, at a quarter the cost.
#[inline(always)]
fn read_at(d0: &[f32], d1: &[f32], xw: f32, fa: usize, fb: usize, fu: f32, x: f32) -> f32 {
    let p = fract(x) * FRAME_LEN as f32;
    let i = (p as usize) & FRAME_MASK;
    let t = p - p.floor();
    let mut q = points(d0, fa, i);
    if fu > 0.0 {
        q = blend(q, points(d0, fb, i), fu);
    }
    if xw > 0.0 {
        let mut q1 = points(d1, fa, i);
        if fu > 0.0 {
            q1 = blend(q1, points(d1, fb, i), fu);
        }
        q = blend(q, q1, xw);
    }
    hermite(q, t)
}

pub(crate) struct OscVoice {
    phase: [u32; MAX_UNISON],
    /// Copies sounding last block, for the pan ramps.
    n: usize,
    pan: [[f32; 2]; MAX_UNISON],
    crush_k: [i32; MAX_UNISON],
    crush_v: [f32; MAX_UNISON],
    peak: [f32; MAX_UNISON],
    norm: [f32; MAX_UNISON],
    norm_target: [f32; MAX_UNISON],
    dc: [DcBlocker; 2],
    fresh: bool,
}

impl OscVoice {
    pub fn new() -> OscVoice {
        OscVoice {
            phase: [0; MAX_UNISON],
            n: 0,
            pan: [[0.0; 2]; MAX_UNISON],
            crush_k: [-1; MAX_UNISON],
            crush_v: [0.0; MAX_UNISON],
            peak: [0.0; MAX_UNISON],
            norm: [1.0; MAX_UNISON],
            norm_target: [1.0; MAX_UNISON],
            dc: [DcBlocker::default(); 2],
            fresh: true,
        }
    }

    /// A new note: every copy's start phase is `phase` plus up to `rand` of a
    /// cycle at random. All sixteen are set now, so a copy added mid-note by a
    /// unison change starts from a phase of its own too.
    pub fn start(&mut self, phase: f32, rand: f32, rng: &mut u32) {
        for p in self.phase.iter_mut() {
            let r = next_unit(rng);
            *p = phase_from(fract(phase + rand * r));
        }
        self.n = 0;
        self.crush_k = [-1; MAX_UNISON];
        self.peak = [0.0; MAX_UNISON];
        self.norm = [1.0; MAX_UNISON];
        self.norm_target = [1.0; MAX_UNISON];
        self.dc = [DcBlocker::default(); 2];
        self.fresh = true;
    }

    /// Render a block into `l` and `r`, overwriting them.
    pub fn render(&mut self, p: &OscParams, l: &mut [f32], r: &mut [f32]) {
        let len = l.len().min(r.len());
        l[..len].iter_mut().for_each(|v| *v = 0.0);
        r[..len].iter_mut().for_each(|v| *v = 0.0);
        if len == 0 {
            return;
        }
        let table = p.table;
        let frames = table.frame_count();
        let n = p.uni.clamp(1, MAX_UNISON);
        let gain = 1.0 / (n as f32).sqrt();
        let warps = p.warps;
        let base_slope = warps[0].slope() * warps[1].slope();
        let fm_k = warps[0].fm_depth().max(warps[1].fm_depth());
        let has_fm = warps.iter().any(|w| w.mode == WarpMode::Fm);
        let (ma, mb, mu) = frame_at(p.fm.pos, p.fm.table.frame_count());

        // The position ramp, shared by every copy.
        let mut fa = [0usize; 64];
        let mut fb = [0usize; 64];
        let mut fu = [0f32; 64];
        let blen = len.min(64);
        for i in 0..blen {
            let pos = p.pos0 + (p.pos1 - p.pos0) * (i + 1) as f32 / blen as f32;
            let (a, b, u) = frame_at(pos, frames);
            fa[i] = a;
            fb[i] = b;
            fu[i] = u;
        }

        for u in 0..n {
            let d = if n == 1 { 0.0 } else { -1.0 + 2.0 * u as f32 / (n - 1) as f32 };
            let cents = d * p.det * 60.0;
            let hz = p.hz * (cents / 1200.0).exp2();
            let inc_f = hz / p.sr;
            // Pan for this copy, ramped from last block's.
            let off = if n == 1 || (n % 2 == 1 && u == n / 2) {
                0.0
            } else if u % 2 == 0 {
                -p.spr
            } else {
                p.spr
            };
            let pan = (p.pan + off).clamp(-1.0, 1.0);
            let th = (pan + 1.0) * std::f32::consts::FRAC_PI_4;
            let target = [th.cos() * gain, th.sin() * gain];
            let start = if self.fresh || u >= self.n { target } else { self.pan[u] };
            self.pan[u] = target;
            if !(inc_f > 0.0 && inc_f < 0.5) {
                // Above Nyquist (or nonsense): silent, but keep time.
                self.phase[u] = self.phase[u].wrapping_add(((inc_f.abs().fract()) * 4_294_967_296.0) as u32);
                continue;
            }
            let inc = (inc_f as f64 * 4_294_967_296.0) as u32;

            let mut slope = base_slope;
            let (mlevel, _) = mip_for(2.0 * inc_f);
            if has_fm {
                slope *= 1.0 + 2.0 * fm_k * p.fm.table.max_slope(mlevel);
            }
            let (level, xw) = mip_for(inc_f * slope);
            let d0 = table.data(level);
            let d1 = table.data((level + 1).min(MIP_LEVELS - 1));
            let md = p.fm.table.data(mlevel);
            let modr = |x: f32| read_at(md, md, 0.0, ma, mb, mu, x);

            let (mut gl, mut gr) = (start[0], start[1]);
            let dgl = (target[0] - start[0]) / blen as f32;
            let dgr = (target[1] - start[1]) / blen as f32;
            let mut ph = self.phase[u];
            self.crush_k[u] = -1;
            let norm_glide = 1.0 - (-1.0 / (0.005 * p.sr)).exp();
            for i in 0..blen {
                let (a0, b0, u0) = (fa[i], fb[i], fu[i]);
                let read = |x: f32| read_at(d0, d1, xw, a0, b0, u0, x);
                let x = (ph >> 8) as f32 * (1.0 / 16_777_216.0);
                let mut y = eval(&warps, x, &read, &modr);
                match p.shaper {
                    Shaper::None => {}
                    Shaper::Drive { a, d, norm } => y = y * (1.0 - a) + (y * d).tanh() * norm * a,
                    Shaper::Ring { a, r } => y = y * (1.0 - a) + y * (std::f32::consts::TAU * r * x).sin() * a,
                    Shaper::Crush { a, q, hold } => {
                        let k = (x * 256.0 / hold).floor() as i32;
                        if k != self.crush_k[u] {
                            self.crush_k[u] = k;
                            let xh = k as f32 * hold / 256.0;
                            self.crush_v[u] = js_round(eval(&warps, xh, &read, &modr) * q) / q;
                        }
                        y = y * (1.0 - a) + self.crush_v[u] * a;
                    }
                    Shaper::Comb { a, d } => {
                        let side = eval(&warps, x + 1.0 / d, &read, &modr) + eval(&warps, x - 1.0 / d, &read, &modr);
                        y = (1.0 - 0.45 * a) * y - 0.225 * a * side;
                        self.peak[u] = self.peak[u].max(y.abs());
                        self.norm[u] += (self.norm_target[u] - self.norm[u]) * norm_glide;
                        y *= self.norm[u];
                    }
                }
                l[i] += y * gl;
                r[i] += y * gr;
                gl += dgl;
                gr += dgr;
                let next = ph.wrapping_add(inc);
                if next < ph {
                    if let Shaper::Comb { .. } = p.shaper {
                        self.norm_target[u] = 1.0 / self.peak[u].max(0.125);
                        self.peak[u] = 0.0;
                    }
                }
                ph = next;
            }
            self.phase[u] = ph;
        }
        self.n = n;
        self.fresh = false;
        let rdc = dc_pole(p.sr);
        for i in 0..blen {
            l[i] = self.dc[0].tick(l[i], rdc);
            r[i] = self.dc[1].tick(r[i], rdc);
        }
    }
}

#[inline]
pub(crate) fn phase_from(x: f32) -> u32 {
    (x as f64 * 4_294_967_296.0) as u32
}

/// xorshift32, for start phases and noise. Never zero.
#[inline]
pub(crate) fn next_u32(s: &mut u32) -> u32 {
    let mut x = *s;
    if x == 0 {
        x = 0x9E37_79B9;
    }
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *s = x;
    x
}

#[inline]
pub(crate) fn next_unit(s: &mut u32) -> f32 {
    (next_u32(s) >> 8) as f32 * (1.0 / 16_777_216.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::patch::FxMode;

    #[test]
    fn the_level_keeps_the_top_harmonic_under_nyquist() {
        for i in 0..2000 {
            let f = 1e-5 * (1.0045f32).powi(i);
            if f >= 0.5 {
                break;
            }
            let (level, xw) = mip_for(f);
            let h = crate::table::harmonic_limit(level) as f32;
            assert!(h * f < 0.5, "f {f}: level {level} top harmonic at {}", h * f);
            if xw > 0.0 && level + 1 < MIP_LEVELS {
                let h1 = crate::table::harmonic_limit(level + 1) as f32;
                assert!(h1 * f < 0.5);
            }
        }
    }

    #[test]
    fn every_cycle_effect_stays_finite() {
        let table = Wavetable::from_frames(&crate::table::builtin_frames("Grit Saw").unwrap());
        for mode in [FxMode::Crush, FxMode::Drive, FxMode::Ring, FxMode::Comb] {
            let mut o = OscVoice::new();
            let mut rng = 1;
            o.start(0.0, 0.5, &mut rng);
            let p = OscParams {
                table: &table,
                pos0: 0.5,
                pos1: 0.5,
                warps: [Warp::new(WarpMode::Fold, 0.6), Warp::new(WarpMode::Fm, 0.5)],
                fm: FmSource { table: &table, pos: 0.2 },
                hz: 220.0,
                uni: 4,
                det: 0.5,
                spr: 0.5,
                pan: 0.0,
                shaper: Shaper::new(mode, 0.8, 0.6),
                sr: 48_000.0,
            };
            let (mut l, mut r) = ([0.0f32; 32], [0.0f32; 32]);
            for _ in 0..200 {
                o.render(&p, &mut l, &mut r);
                assert!(l.iter().chain(r.iter()).all(|v| v.is_finite() && v.abs() < 8.0), "{:?}", mode);
            }
        }
    }
}
