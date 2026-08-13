//! Comb-and-all-pass reverberation, from the papers that defined it.
//!
//! Two complete reverberators:
//!
//! - **Schroeder** — parallel combs into series all-passes. The first digital
//!   reverberator (Schroeder 1961/62), as set out in Moorer's Fig. 2b and
//!   re-implemented in Dornean, Ţopa and Kirei, *Digital Implementation of
//!   Artificial Reverberation Algorithms*.
//! - **Moorer** — the same shape with a one-pole low-pass **inside each comb's
//!   feedback loop**, simulating the absorption of air. James A. Moorer, *About
//!   This Reverberation Business*, Computer Music Journal 3(2), 1979, pp.
//!   13–28. Delay lengths and coefficients are his Table 2.
//!
//! This is a different family from `dattorro`'s plate. The plate is one
//! recirculating tank read at many points; these are banks of independent combs
//! summed together. They fail differently, which is the reason to have both: a
//! comb bank has a pitch to it that a plate does not, and a plate has a
//! metallic sheen that a comb bank does not.
//!
//! **The stability trick is Moorer's** (p7). Each comb's loop gain is set to
//! `g₂ = g(1 − g₁)`, where `g` is shared by every comb and `g₁` is that comb's
//! damping. Written that way the loop cannot be driven unstable by turning the
//! damping up, which is exactly what independent decay and damping controls
//! let you do — and `g` alone then reads as the reverberation time.

use crate::params::{ParamSpec, Params};
use crate::Effect;

/// A delay line with a feedback path and, optionally, a one-pole low-pass in
/// the loop. Moorer's Fig. 5 when the low-pass is in, Schroeder's Fig. 1b when
/// it is not.
struct Comb {
    buf: Vec<f32>,
    at: usize,
    /// The low-pass's state. Held per comb, not per channel: each channel gets
    /// its own `Comb`.
    lp: f32,
}

impl Comb {
    fn new(len: usize) -> Self {
        Comb { buf: vec![0.0; len.max(2)], at: 0, lp: 0.0 }
    }

    /// `g1` is the in-loop damping, 0 for none. `g` is the shared decay.
    fn step(&mut self, x: f32, g: f32, g1: f32) -> f32 {
        let y = self.buf[self.at];
        // Moorer p7: g₂ = g(1 − g₁). Unconditionally stable for g in 0..1
        // whatever the damping does.
        self.lp = y * (1.0 - g1) + self.lp * g1;
        let fed = if g1 > 0.0 { self.lp } else { y };
        self.buf[self.at] = x + fed * g;
        self.at = (self.at + 1) % self.buf.len();
        y
    }

    fn clear(&mut self) {
        self.buf.fill(0.0);
        self.lp = 0.0;
        self.at = 0;
    }
}

/// Schroeder's all-pass (Moorer Fig. 1a), in the one-multiply form.
struct Allpass {
    buf: Vec<f32>,
    at: usize,
}

impl Allpass {
    fn new(len: usize) -> Self {
        Allpass { buf: vec![0.0; len.max(2)], at: 0 }
    }

    fn step(&mut self, x: f32, g: f32) -> f32 {
        let z = self.buf[self.at];
        let y = z - g * x;
        self.buf[self.at] = x + g * y;
        self.at = (self.at + 1) % self.buf.len();
        y
    }

    fn clear(&mut self) {
        self.buf.fill(0.0);
        self.at = 0;
    }
}

// --------------------------------------------------------------- Moorer

/// Moorer's Table 2, at 25 kHz and at 50 kHz.
///
/// Delays in milliseconds, then the in-loop damping `g₁` at each of the two
/// sample rates the paper tabulates. Moorer is explicit (p7) that a first-order
/// low-pass cannot really match the absorption of air and that these are
/// guideline values, so interpolating between the two columns by sample rate is
/// as much precision as the numbers deserve.
const MOORER_COMBS: [(f32, f32, f32); 6] = [
    (50.0, 0.24, 0.46),
    (56.0, 0.26, 0.48),
    (61.0, 0.28, 0.50),
    (68.0, 0.29, 0.52),
    (72.0, 0.30, 0.53),
    (78.0, 0.32, 0.55),
];

/// The all-pass that follows the comb bank.
///
/// Moorer p8 is unusually firm about this one: 6 ms, gain about 0.7. Shorter
/// and quiet background noise acquires a "puff-puff", and any click grows its
/// own impulse response "sounding not unlike a very quiet cymbal crash";
/// longer and the repetition period becomes audible. It is not a free parameter
/// and is not offered as one.
const MOORER_ALLPASS_MS: f32 = 6.0;
const MOORER_ALLPASS_G: f32 = 0.7;

/// The damping at the sample rate this is running at.
///
/// Between the paper's two columns, and held flat outside them rather than
/// extrapolated — the numbers came from fitting measured absorption data, and
/// running that fit out to 8 kHz or 192 kHz would be inventing values.
fn moorer_damping(lo: f32, hi: f32, sample_rate: u32) -> f32 {
    let t = ((sample_rate as f32 - 25_000.0) / 25_000.0).clamp(0.0, 1.0);
    lo + (hi - lo) * t
}

pub(crate) const MOORER_SPECS: &[ParamSpec] = &[
    // `g` in the paper. It alone sets the reverberation time: Moorer reports
    // about 2 s at 0.83 with these delays.
    ParamSpec::new("decay", "Decay", 0.0, 0.98, 0.83),
    // Scales the paper's `g₁` values together. At 1 they are used as tabulated.
    ParamSpec::new("damping", "Air absorption", 0.0, 2.0, 1.0),
    // Scales every delay. Moorer notes (p8) that combs as short as 10–15 ms
    // still hold together — "though one might well imagine that one were
    // inside a garbage can rather than the Symphony Hall".
    ParamSpec::new("size", "Size", 0.2, 2.0, 1.0),
    ParamSpec::new("predelayMs", "Predelay", 0.0, 250.0, 0.0).unit("ms"),
    // The two channels run the same comb bank at slightly different lengths.
    // Moorer's design is mono in and mono out; without this the output is the
    // same in both ears, which no room is.
    ParamSpec::new("spread", "Stereo spread", 0.0, 0.2, 0.06),
    ParamSpec::new("wet", "Wet", 0.0, 1.0, 0.3),
    ParamSpec::new("dry", "Dry", 0.0, 1.0, 1.0),
];

pub struct Moorer {
    p: [f32; 7],
    combs: Vec<[Comb; 6]>,
    aps: Vec<Allpass>,
    pre: Vec<Comb>,
    sr: u32,
    built_for: (u32, u32),
}

impl Moorer {
    pub fn new(sample_rate: u32, channels: usize) -> Self {
        let mut me = Moorer {
            p: [0.83, 1.0, 1.0, 0.0, 0.06, 0.3, 1.0],
            combs: Vec::new(),
            aps: Vec::new(),
            pre: Vec::new(),
            sr: sample_rate.max(1),
            built_for: (0, 0),
        };
        me.build(channels.max(1).min(8));
        me
    }

    /// Delay lines are sized for the largest `size` the control allows, and the
    /// read point moves inside them. Rebuilding on every size change would
    /// allocate, and clear the tail while it was still sounding.
    fn build(&mut self, channels: usize) {
        let sr = self.sr as f32;
        let max_size = 2.0;
        let ms = |x: f32| ((x * 0.001 * sr) as usize).max(2);
        self.combs = (0..channels)
            .map(|ch| {
                let stretch = 1.0 + ch as f32 * 0.2;
                std::array::from_fn(|i| Comb::new(ms(MOORER_COMBS[i].0 * max_size * stretch)))
            })
            .collect();
        self.aps = (0..channels)
            .map(|_| Allpass::new(ms(MOORER_ALLPASS_MS)))
            .collect();
        self.pre = (0..channels).map(|_| Comb::new(ms(250.0))).collect();
        self.built_for = (self.sr, channels as u32);
    }
}

impl Effect for Moorer {
    fn process(&mut self, buf: &mut [f32], channels: usize, sample_rate: u32) {
        let channels = channels.max(1);
        if self.sr != sample_rate || self.built_for != (sample_rate, channels.min(8) as u32) {
            self.sr = sample_rate.max(1);
            self.build(channels.min(8));
        }
        let n = channels.min(self.combs.len());
        let sr = sample_rate as f32;
        let (g, damp, size) = (self.p[0], self.p[1], self.p[2]);
        let pre = ((self.p[3] * 0.001 * sr) as usize).max(1);
        let spread = self.p[4];
        let (wet, dry) = (self.p[5], self.p[6]);

        for frame in buf.chunks_mut(channels) {
            for ch in 0..n.min(frame.len()) {
                let x = frame[ch];
                // Predelay as a comb with no feedback: a plain delay line.
                let side = 1.0 + ch as f32 * spread;
                let delayed = {
                    let c = &mut self.pre[ch];
                    let at = c.at;
                    let len = c.buf.len();
                    let out = c.buf[(at + len - pre.min(len - 1)) % len];
                    c.buf[at] = x;
                    c.at = (at + 1) % len;
                    out
                };

                // Six combs in parallel, each damped in its own loop.
                let mut sum = 0.0;
                for i in 0..6 {
                    let (ms, lo, hi) = MOORER_COMBS[i];
                    let want = (ms * size * side * 0.001 * sr) as usize;
                    let g1 = (moorer_damping(lo, hi, sample_rate) * damp).clamp(0.0, 0.98);
                    let c = &mut self.combs[ch][i];
                    let len = c.buf.len();
                    let take = want.clamp(2, len - 1);
                    // Read `take` back rather than at the buffer's end, so size
                    // moves the room without reallocating anything.
                    let y = c.buf[(c.at + len - take) % len];
                    c.lp = y * (1.0 - g1) + c.lp * g1;
                    c.buf[c.at] = delayed + c.lp * g;
                    c.at = (c.at + 1) % len;
                    sum += y;
                }
                sum /= 6.0;

                let y = self.aps[ch].step(sum, MOORER_ALLPASS_G);
                frame[ch] = x * dry + y * wet;
            }
        }
    }

    fn reset(&mut self) {
        for bank in &mut self.combs {
            for c in bank {
                c.clear();
            }
        }
        for a in &mut self.aps {
            a.clear();
        }
        for p in &mut self.pre {
            p.clear();
        }
    }

    fn name(&self) -> &'static str {
        "Moorer reverb"
    }
}

impl Params for Moorer {
    fn specs(&self) -> &'static [ParamSpec] {
        MOORER_SPECS
    }
    fn get(&self, k: &str) -> Option<f32> {
        MOORER_SPECS.iter().position(|s| s.key == k).map(|i| self.p[i])
    }
    fn set(&mut self, k: &str, v: f32) -> bool {
        match MOORER_SPECS.iter().position(|s| s.key == k) {
            Some(i) => {
                self.p[i] = MOORER_SPECS[i].clamp(v);
                true
            }
            None => false,
        }
    }
}

// ------------------------------------------------------------- Schroeder

/// Four combs and two all-passes, the 1961 design.
///
/// Delays are mutually prime, which Moorer (p3) says every recirculating
/// reverb's delays should be: shared factors put the combs' repetition periods
/// on top of each other and the result rings at one pitch.
const SCHROEDER_COMBS: [f32; 4] = [29.7, 37.1, 41.1, 43.7];
const SCHROEDER_APS: [f32; 2] = [5.0, 1.7];

pub(crate) const SCHROEDER_SPECS: &[ParamSpec] = &[
    ParamSpec::new("decay", "Decay", 0.0, 0.98, 0.805),
    ParamSpec::new("size", "Size", 0.2, 2.0, 1.0),
    ParamSpec::new("diffusion", "Diffusion", 0.0, 0.9, 0.7),
    ParamSpec::new("wet", "Wet", 0.0, 1.0, 0.3),
    ParamSpec::new("dry", "Dry", 0.0, 1.0, 1.0),
];

pub struct Schroeder {
    p: [f32; 5],
    combs: Vec<[Comb; 4]>,
    aps: Vec<[Allpass; 2]>,
    sr: u32,
    built_for: (u32, u32),
}

impl Schroeder {
    pub fn new(sample_rate: u32, channels: usize) -> Self {
        let mut me = Schroeder {
            p: [0.805, 1.0, 0.7, 0.3, 1.0],
            combs: Vec::new(),
            aps: Vec::new(),
            sr: sample_rate.max(1),
            built_for: (0, 0),
        };
        me.build(channels.max(1).min(8));
        me
    }

    fn build(&mut self, channels: usize) {
        let sr = self.sr as f32;
        let ms = |x: f32| ((x * 0.001 * sr) as usize).max(2);
        self.combs = (0..channels)
            .map(|ch| {
                let stretch = 1.0 + ch as f32 * 0.17;
                std::array::from_fn(|i| Comb::new(ms(SCHROEDER_COMBS[i] * 2.0 * stretch)))
            })
            .collect();
        self.aps = (0..channels)
            .map(|_| std::array::from_fn(|i| Allpass::new(ms(SCHROEDER_APS[i]))))
            .collect();
        self.built_for = (self.sr, channels as u32);
    }
}

impl Effect for Schroeder {
    fn process(&mut self, buf: &mut [f32], channels: usize, sample_rate: u32) {
        let channels = channels.max(1);
        if self.sr != sample_rate || self.built_for != (sample_rate, channels.min(8) as u32) {
            self.sr = sample_rate.max(1);
            self.build(channels.min(8));
        }
        let n = channels.min(self.combs.len());
        let sr = sample_rate as f32;
        let (g, size, diff, wet, dry) = (self.p[0], self.p[1], self.p[2], self.p[3], self.p[4]);

        for frame in buf.chunks_mut(channels) {
            for ch in 0..n.min(frame.len()) {
                let x = frame[ch];
                let side = 1.0 + ch as f32 * 0.05;
                let mut sum = 0.0;
                for i in 0..4 {
                    let want = (SCHROEDER_COMBS[i] * size * side * 0.001 * sr) as usize;
                    let c = &mut self.combs[ch][i];
                    let len = c.buf.len();
                    let take = want.clamp(2, len - 1);
                    let y = c.buf[(c.at + len - take) % len];
                    c.buf[c.at] = x + y * g;
                    c.at = (c.at + 1) % len;
                    sum += y;
                }
                sum /= 4.0;
                // In series, because an all-pass after the bank is what turns a
                // handful of discrete echoes into something dense.
                let mut y = sum;
                for a in &mut self.aps[ch] {
                    y = a.step(y, diff);
                }
                frame[ch] = x * dry + y * wet;
            }
        }
    }

    fn reset(&mut self) {
        for bank in &mut self.combs {
            for c in bank {
                c.clear();
            }
        }
        for pair in &mut self.aps {
            for a in pair {
                a.clear();
            }
        }
    }

    fn name(&self) -> &'static str {
        "Schroeder reverb"
    }
}

impl Params for Schroeder {
    fn specs(&self) -> &'static [ParamSpec] {
        SCHROEDER_SPECS
    }
    fn get(&self, k: &str) -> Option<f32> {
        SCHROEDER_SPECS.iter().position(|s| s.key == k).map(|i| self.p[i])
    }
    fn set(&mut self, k: &str, v: f32) -> bool {
        match SCHROEDER_SPECS.iter().position(|s| s.key == k) {
            Some(i) => {
                self.p[i] = SCHROEDER_SPECS[i].clamp(v);
                true
            }
            None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn impulse(n: usize, channels: usize) -> Vec<f32> {
        let mut b = vec![0.0f32; n * channels];
        for ch in 0..channels {
            b[ch] = 1.0;
        }
        b
    }

    /// Decay time, measured the way the definition says: how long until what
    /// comes out is 60 dB below the loudest thing that came out.
    fn rt60(tail: &[f32], channels: usize, sample_rate: u32) -> f32 {
        let peak = tail.iter().fold(0f32, |m, v| m.max(v.abs()));
        let floor = peak * 10f32.powf(-60.0 / 20.0);
        let frames = tail.len() / channels;
        let last = (0..frames)
            .rev()
            .find(|&f| (0..channels).any(|c| tail[f * channels + c].abs() > floor))
            .unwrap_or(0);
        last as f32 / sample_rate as f32
    }

    #[test]
    fn a_moorer_reverb_rings_for_about_the_two_seconds_the_paper_says() {
        let sr = 48_000u32;
        let mut r = Moorer::new(sr, 2);
        // The paper's own example: g = 0.83 with these delays, about 2 s.
        assert!(r.set("decay", 0.83));
        assert!(r.set("wet", 1.0));
        assert!(r.set("dry", 0.0));
        assert!(r.set("damping", 1.0));
        let mut b = impulse(sr as usize * 5, 2);
        r.process(&mut b, 2, sr);
        let t = rt60(&b, 2, sr);
        assert!(
            (1.2..3.2).contains(&t),
            "Moorer at g=0.83 decayed in {t:.2}s; the paper says about 2"
        );
    }

    /// `g` alone sets the reverberation time — that is what it is for.
    #[test]
    fn a_longer_decay_rings_for_longer() {
        let sr = 48_000u32;
        let time = |g: f32| {
            let mut r = Moorer::new(sr, 1);
            r.set("decay", g);
            r.set("wet", 1.0);
            r.set("dry", 0.0);
            let mut b = impulse(sr as usize * 5, 1);
            r.process(&mut b, 1, sr);
            rt60(&b, 1, sr)
        };
        let (short, long) = (time(0.5), time(0.9));
        assert!(long > short * 1.5, "0.5 gave {short:.2}s and 0.9 gave {long:.2}s");
    }

    /// Moorer p7: the in-loop low-pass makes the high frequencies decay faster
    /// than the low, which is the whole reason it is there.
    #[test]
    fn damping_makes_the_top_end_decay_first() {
        let sr = 48_000u32;
        let energy = |damp: f32, from: usize| {
            let mut r = Moorer::new(sr, 1);
            r.set("decay", 0.85);
            r.set("wet", 1.0);
            r.set("dry", 0.0);
            r.set("damping", damp);
            let mut b = impulse(sr as usize * 3, 1);
            r.process(&mut b, 1, sr);
            // High-frequency energy late in the tail, as the mean absolute
            // sample-to-sample difference — a crude but honest high-pass.
            let tail = &b[from..];
            tail.windows(2).map(|w| (w[1] - w[0]).abs()).sum::<f32>() / tail.len() as f32
        };
        let late = sr as usize * 2;
        let (undamped, damped) = (energy(0.0, late), energy(2.0, late));
        assert!(
            damped < undamped * 0.9,
            "damping left {damped:.3e} of top end against {undamped:.3e} undamped"
        );
    }

    /// The stability parameterisation, tested at the corner that would break a
    /// naive one: maximum decay and maximum damping together.
    #[test]
    fn the_loop_cannot_be_driven_unstable_by_the_controls() {
        let sr = 48_000u32;
        for (g, damp) in [(0.98f32, 2.0f32), (0.98, 0.0), (0.9, 2.0)] {
            let mut r = Moorer::new(sr, 2);
            r.set("decay", g);
            r.set("damping", damp);
            r.set("wet", 1.0);
            r.set("dry", 0.0);
            let mut b = impulse(sr as usize * 6, 2);
            r.process(&mut b, 2, sr);
            let peak = b.iter().fold(0f32, |m, v| m.max(v.abs()));
            assert!(
                peak.is_finite() && peak < 8.0,
                "decay {g} with damping {damp} ran away to {peak}"
            );
        }
    }

    #[test]
    fn a_schroeder_reverb_decays_and_stays_bounded() {
        let sr = 48_000u32;
        let mut r = Schroeder::new(sr, 2);
        assert!(r.set("wet", 1.0));
        assert!(r.set("dry", 0.0));
        let mut b = impulse(sr as usize * 4, 2);
        r.process(&mut b, 2, sr);
        let peak = b.iter().fold(0f32, |m, v| m.max(v.abs()));
        assert!(peak.is_finite() && peak < 8.0, "ran away to {peak}");
        let t = rt60(&b, 2, sr);
        assert!(t > 0.2, "decayed in {t:.2}s, which is not a reverb");
    }

    /// Both reverbs are inert with the wet path down — invariant 9.
    #[test]
    fn neither_reverb_touches_the_signal_when_it_is_fully_dry() {
        let sr = 48_000u32;
        let source: Vec<f32> = (0..4096).map(|i| (i as f32 / 13.0).sin() * 0.5).collect();
        // Boxed through `Driven`, which is how the rack holds them — a bare
        // `Box<dyn Effect>` loses the way back to `Params` and `set_param`
        // silently does nothing, which is exactly the trap this guards.
        for (name, e) in [
            (
                "moorer",
                Box::new(crate::Driven(Moorer::new(sr, 2))) as Box<dyn Effect>,
            ),
            (
                "schroeder",
                Box::new(crate::Driven(Schroeder::new(sr, 2))) as Box<dyn Effect>,
            ),
        ] {
            let mut e = e;
            assert!(e.set_param("wet", 0.0), "{name} would not take a wet of 0");
            assert!(e.set_param("dry", 1.0));
            let mut b = source.clone();
            e.process(&mut b, 2, sr);
            let worst = source
                .iter()
                .zip(&b)
                .map(|(a, c)| (a - c).abs())
                .fold(0f32, f32::max);
            assert!(worst < 1e-6, "{name} moved a fully dry signal by {worst:.2e}");
        }
    }

    /// The two ears must not be handed the same thing.
    #[test]
    fn the_output_is_not_the_same_in_both_channels() {
        let sr = 48_000u32;
        let mut r = Moorer::new(sr, 2);
        r.set("wet", 1.0);
        r.set("dry", 0.0);
        let mut b = impulse(sr as usize, 2);
        r.process(&mut b, 2, sr);
        let worst = (0..b.len() / 2)
            .map(|f| (b[f * 2] - b[f * 2 + 1]).abs())
            .fold(0f32, f32::max);
        assert!(worst > 1e-3, "both channels came out identical");
    }
}
