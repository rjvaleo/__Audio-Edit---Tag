//! The two per-voice filters: a state-variable filter for `lp bp hp notch`,
//! a feedback comb, and a three-band formant.
//!
//! **The SVF is the trapezoidal (TPT) one** from Andrew Simper's Cytomic notes.
//! It is stable at every cutoff and resonance, its response does not warp near
//! Nyquist the way a naive Chamberlin SVF does, and all four outputs come from
//! one set of states, so switching type mid-note does not reset anything.
//! The band-pass output is normalised to unity peak (`k·v1`), so turning up
//! resonance on a band-pass narrows it rather than making it louder.
//!
//! **Cutoff and resonance glide inside a block.** The coefficient `g = tan(πf/fs)`
//! is worked out at each block end and ramped linearly across the block, so a
//! cutoff sweep at control rate has no steps.
//!
//! **Drive** pushes the input into `tanh` before the filter, with half the gain
//! taken back, so more drive is denser and only a little louder. At zero it is
//! bypassed entirely and the filter is linear.
//!
//! **Comb**: a feedback comb tuned to the cutoff, with resonance as feedback
//! (up to 0.97). The output is scaled by `√(1 − fb²)`, the inverse of the
//! comb's noise gain, so the level stays put as feedback rises.
//!
//! **Form**: three band-passes at vowel formants. The cutoff knob morphs through
//! A–E–I–O–U, resonance sets their Q. It is deliberately simple; the
//! architecture's fuller formant model is for later.

use crate::patch::FilterType;

#[derive(Clone, Copy, Default)]
struct Svf {
    ic1: f32,
    ic2: f32,
}

impl Svf {
    /// One sample; returns (v0, v1 band, v2 low).
    #[inline(always)]
    fn tick(&mut self, v0: f32, g: f32, k: f32) -> (f32, f32) {
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        let a3 = g * a2;
        let v3 = v0 - self.ic2;
        let v1 = a1 * self.ic1 + a2 * v3;
        let v2 = self.ic2 + a2 * self.ic1 + a3 * v3;
        self.ic1 = 2.0 * v1 - self.ic1;
        self.ic2 = 2.0 * v2 - self.ic2;
        (v1, v2)
    }
}

/// Vowel formants (Hz) and their gains, A E I O U.
const VOWELS: [[f32; 3]; 5] =
    [[800.0, 1150.0, 2900.0], [350.0, 2000.0, 2800.0], [270.0, 2140.0, 2950.0], [450.0, 800.0, 2830.0], [325.0, 700.0, 2700.0]];
const FORMANT_GAIN: [f32; 3] = [1.0, 0.6, 0.35];

/// What a filter does this block, at the block's end.
#[derive(Clone, Copy, Debug)]
pub(crate) struct FilterParams {
    pub typ: FilterType,
    /// The patch's 0..1 cutoff, for the formant's vowel.
    pub cut_norm: f32,
    /// Cutoff in Hz, after keytracking.
    pub cut_hz: f32,
    pub res: f32,
    pub drive: f32,
}

pub(crate) struct Filter {
    svf: [[Svf; 3]; 2],
    comb: [Box<[f32]>; 2],
    comb_w: usize,
    comb_dirty: bool,
    typ: Option<FilterType>,
    /// Last block's coefficients: g and k per band, comb delay and feedback.
    g: [f32; 3],
    k: [f32; 3],
    delay: f32,
    fb: f32,
    fresh: bool,
}

impl Filter {
    pub fn new(sample_rate: f32) -> Filter {
        // The comb's longest delay is a 20 Hz period, with room to interpolate.
        let len = (sample_rate / 20.0).ceil() as usize + 4;
        Filter {
            svf: [[Svf::default(); 3]; 2],
            comb: [vec![0.0; len].into_boxed_slice(), vec![0.0; len].into_boxed_slice()],
            comb_w: 0,
            comb_dirty: false,
            typ: None,
            g: [0.0; 3],
            k: [1.0; 3],
            delay: 1.0,
            fb: 0.0,
            fresh: true,
        }
    }

    pub fn reset(&mut self) {
        self.svf = [[Svf::default(); 3]; 2];
        if self.comb_dirty {
            for c in self.comb.iter_mut() {
                c.iter_mut().for_each(|v| *v = 0.0);
            }
            self.comb_dirty = false;
        }
        self.comb_w = 0;
        self.fresh = true;
    }

    /// Filter a block in place.
    pub fn process(&mut self, p: &FilterParams, sr: f32, l: &mut [f32], r: &mut [f32]) {
        let n = l.len().min(r.len());
        if n == 0 {
            return;
        }
        if self.typ != Some(p.typ) {
            // A different model's state means nothing to this one.
            self.reset();
            self.typ = Some(p.typ);
        }
        let nyq = 0.45 * sr;
        let cut = p.cut_hz.clamp(10.0, nyq);
        let q = 0.7 + p.res.clamp(0.0, 1.0) * 9.0;
        // Target coefficients.
        let mut g = [0.0f32; 3];
        let mut k = [1.0 / q; 3];
        let mut gain = [1.0f32, 0.0, 0.0];
        let mut delay = self.delay;
        let mut fb = 0.0;
        match p.typ {
            FilterType::Form => {
                let x = p.cut_norm.clamp(0.0, 1.0) * 4.0;
                let i = (x as usize).min(3);
                let u = x - i as f32;
                let fq = 2.0 + p.res.clamp(0.0, 1.0) * 18.0;
                for b in 0..3 {
                    let f = VOWELS[i][b] + (VOWELS[i + 1][b] - VOWELS[i][b]) * u;
                    g[b] = (std::f32::consts::PI * f.min(nyq) / sr).tan();
                    k[b] = 1.0 / fq;
                    gain[b] = FORMANT_GAIN[b];
                }
            }
            FilterType::Comb => {
                let len = self.comb[0].len() as f32;
                delay = (sr / cut).clamp(1.0, len - 3.0);
                fb = 0.97 * p.res.clamp(0.0, 1.0);
            }
            _ => g[0] = (std::f32::consts::PI * cut / sr).tan(),
        }
        if self.fresh {
            self.g = g;
            self.k = k;
            self.delay = delay;
            self.fb = fb;
            self.fresh = false;
        }
        let inv = 1.0 / n as f32;
        let dg = [(g[0] - self.g[0]) * inv, (g[1] - self.g[1]) * inv, (g[2] - self.g[2]) * inv];
        let dk = [(k[0] - self.k[0]) * inv, (k[1] - self.k[1]) * inv, (k[2] - self.k[2]) * inv];
        let dd = (delay - self.delay) * inv;
        let dfb = (fb - self.fb) * inv;
        let drive = p.drive.clamp(0.0, 1.0);
        let dgain = 1.0 + drive * 5.0;
        let dcomp = 1.0 / dgain.sqrt();
        let (g0, k0, d0, fb0) = (self.g, self.k, self.delay, self.fb);
        for ch in 0..2 {
            let buf: &mut [f32] = if ch == 0 { &mut l[..n] } else { &mut r[..n] };
            let (mut gg, mut kk, mut dl, mut f) = (g0, k0, d0, fb0);
            let mut w = self.comb_w;
            for x in buf.iter_mut() {
                for b in 0..3 {
                    gg[b] += dg[b];
                    kk[b] += dk[b];
                }
                dl += dd;
                f += dfb;
                let v0 = if drive > 0.0 { (*x * dgain).tanh() * dcomp } else { *x };
                *x = match p.typ {
                    FilterType::Lp => self.svf[ch][0].tick(v0, gg[0], kk[0]).1,
                    FilterType::Bp => kk[0] * self.svf[ch][0].tick(v0, gg[0], kk[0]).0,
                    FilterType::Hp => {
                        let (v1, v2) = self.svf[ch][0].tick(v0, gg[0], kk[0]);
                        v0 - kk[0] * v1 - v2
                    }
                    FilterType::Notch => {
                        let (v1, _) = self.svf[ch][0].tick(v0, gg[0], kk[0]);
                        v0 - kk[0] * v1
                    }
                    FilterType::Form => {
                        let mut y = 0.0;
                        for b in 0..3 {
                            y += gain[b] * kk[b] * self.svf[ch][b].tick(v0, gg[b], kk[b]).0;
                        }
                        y
                    }
                    FilterType::Comb => {
                        let c = &mut self.comb[ch];
                        let len = c.len();
                        let rp = w as f32 + len as f32 - dl;
                        let i = rp as usize;
                        let u = rp - i as f32;
                        let a = c[i % len];
                        let b = c[(i + 1) % len];
                        let y = v0 + f * (a + (b - a) * u);
                        c[w] = y;
                        w = (w + 1) % len;
                        y * (1.0 - f * f).max(0.0).sqrt()
                    }
                };
            }
            if ch == 1 {
                self.comb_w = w;
            }
        }
        if p.typ == FilterType::Comb {
            self.comb_dirty = true;
        }
        self.g = g;
        self.k = k;
        self.delay = delay;
        self.fb = fb;
    }
}

/// The contract's cutoff law: `20 · 1000^v` Hz.
#[inline]
pub fn cutoff_hz(v: f32) -> f32 {
    20.0 * 1000f32.powf(v.clamp(0.0, 1.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    fn gain_at(typ: FilterType, cut: f32, res: f32, hz: f32) -> f32 {
        let mut f = Filter::new(SR);
        let p = FilterParams { typ, cut_norm: 0.5, cut_hz: cut, res, drive: 0.0 };
        let n = 32;
        // RMS out over RMS in: a sampled peak of a high sine depends on where
        // the samples fall.
        let (mut pin, mut pout) = (0.0f64, 0.0f64);
        for b in 0..3000 {
            let mut l: Vec<f32> = (0..n)
                .map(|i| (std::f64::consts::TAU * hz as f64 * (b * n + i) as f64 / SR as f64).sin() as f32)
                .collect();
            let input = l.clone();
            let mut r = l.clone();
            f.process(&p, SR, &mut l, &mut r);
            if b > 2000 {
                pin += input.iter().map(|v| (*v as f64).powi(2)).sum::<f64>();
                pout += l.iter().map(|v| (*v as f64).powi(2)).sum::<f64>();
            }
        }
        (pout / pin).sqrt() as f32
    }

    #[test]
    fn the_svf_modes_pass_and_stop_where_they_should() {
        assert!(gain_at(FilterType::Lp, 1000.0, 0.0, 100.0) > 0.95);
        assert!(gain_at(FilterType::Lp, 1000.0, 0.0, 8000.0) < 0.05);
        assert!(gain_at(FilterType::Hp, 1000.0, 0.0, 100.0) < 0.05);
        assert!(gain_at(FilterType::Hp, 1000.0, 0.0, 8000.0) > 0.95);
        assert!((gain_at(FilterType::Bp, 1000.0, 0.5, 1000.0) - 1.0).abs() < 0.05);
        assert!(gain_at(FilterType::Notch, 1000.0, 0.5, 1000.0) < 0.05);
    }

    #[test]
    fn every_type_stays_finite_at_the_extremes() {
        for typ in FilterType::ALL {
            for (cut, res) in [(10.0, 1.0), (30_000.0, 1.0), (500.0, 0.0)] {
                let g = gain_at(*typ, cut, res, 440.0);
                assert!(g.is_finite() && g < 50.0, "{:?} {cut} {res}: {g}", typ);
            }
        }
    }
}
