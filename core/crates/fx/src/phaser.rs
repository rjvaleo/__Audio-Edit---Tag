//! A phaser built the way Julius Smith proposed it.
//!
//! Julius O. Smith, *An Allpass Approach to Digital Phasing and Flanging*,
//! ICMC 1984, pp. 103–108.
//!
//! Smith draws the line between the two effects precisely, and it is not the
//! one people usually assume:
//!
//! > a flanger is defined as a filter which modulates the frequencies of a set
//! > of **uniformly spaced** notches, and a phaser is defined as a filter which
//! > modulates the frequencies of a set of **non-uniformly spaced** notches
//!
//! A flanger is a delay line with a feed-around — `crate::dattorro`'s already
//! is one. Its notches land at `1/τ` intervals and cannot be moved apart,
//! because there is one number controlling all of them. This replaces the delay
//! line with a **chain of second-order all-pass sections**, one per notch, and
//! keeps the feed-around. The chain's phase passes through π near each
//! section's resonance, and a notch appears wherever it does.
//!
//! What that buys, in Smith's own terms:
//!
//! - **One notch moves on its own** — retune that section's pole pair, which is
//!   one coefficient, and nothing else in the spectrum shifts.
//! - **The notches need not be harmonically spaced.** Smith suggests spacing
//!   them by critical bands, "since this gives uniform notch density with
//!   respect to place along the basilar membrane", while noting there is no
//!   need to follow the critical-band structure closely.
//! - **Notch width is the pole radius**, per section: closer to the unit circle
//!   is narrower.
//! - **Notch depth is the feed-around gain**, shared.
//! - **No interpolation problem.** A swept delay line needs a fractional read
//!   and hisses without a good interpolator; there is no delay line here.
//! - **The gain is bounded between 0 and 2** whatever the controls do, because
//!   an all-pass chain has unity gain by definition. Smith calls this out as
//!   the property that "allows arbitrary notch controls to be applied without
//!   fear of the overall gain becoming ill-behaved" — so the controls here need
//!   no safety clamp beyond keeping each pole inside the circle.
//!
//! Smith also names the flanger's other failure, which this does not have: if
//! the input is exactly harmonic and the first notch lands on half the
//! fundamental, *every* harmonic is cancelled and "the output signal fails to
//! exist".

use crate::params::{ParamSpec, Params};
use crate::Effect;
use std::f32::consts::PI;

/// The most notches offered. Eight sections is already a denser phaser than
/// any pedal, and each one is two multiplies per sample per channel.
const MAX_SECTIONS: usize = 8;
const MAX_CHANNELS: usize = 8;

/// One second-order all-pass: a pole pair at radius `r`, angle `θ`.
///
/// `H(z) = (a₂ + a₁z⁻¹ + z⁻²) / (1 + a₁z⁻¹ + a₂z⁻²)`, with `a₁ = −2r·cos θ`
/// and `a₂ = r²`. Numerator coefficients are the denominator's reversed, which
/// is what makes it all-pass — and why the whole chain cannot change the gain.
#[derive(Clone, Copy, Default)]
struct Section {
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl Section {
    fn tune(&mut self, hz: f32, radius: f32, sample_rate: f32) {
        let theta = (2.0 * PI * hz / sample_rate).clamp(1e-4, PI - 1e-4);
        let r = radius.clamp(0.0, 0.9995);
        self.a1 = -2.0 * r * theta.cos();
        self.a2 = r * r;
    }

    fn step(&mut self, x: f32) -> f32 {
        let y = self.a2 * x + self.a1 * self.x1 + self.x2 - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        if y.is_finite() {
            y
        } else {
            self.reset();
            0.0
        }
    }

    fn reset(&mut self) {
        self.x1 = 0.0;
        self.x2 = 0.0;
        self.y1 = 0.0;
        self.y2 = 0.0;
    }
}

pub(crate) const PHASER_SPECS: &[ParamSpec] = &[
    ParamSpec::new("notches", "Notches", 1.0, MAX_SECTIONS as f32, 4.0),
    ParamSpec::new("centreHz", "Centre", 40.0, 8000.0, 500.0).log().unit("Hz"),
    // How far apart the notches sit, as a ratio between one and the next. At 1
    // they pile up on each other; the default is a little under an octave.
    // Smith's point is that this is a free choice — a delay line has no such
    // control, because its notches are locked to multiples of one frequency.
    ParamSpec::new("spread", "Spread", 1.0, 3.0, 1.8),
    // The pole radius. Smith: "to widen the notch associated with a particular
    // allpass section, one simply increases the damping of that section".
    ParamSpec::new("resonance", "Notch width", 0.0, 0.999, 0.7),
    // The feed-around gain, which is what sets how deep the notches cut.
    // Negative puts the notches where the peaks were.
    ParamSpec::new("depth", "Notch depth", -1.0, 1.0, 0.7),
    ParamSpec::new("rateHz", "Rate", 0.0, 10.0, 0.35).unit("Hz"),
    // How far the sweep moves the whole comb of notches, in octaves.
    ParamSpec::new("sweep", "Sweep", 0.0, 4.0, 1.5).unit("oct"),
    // Right channel's LFO offset, as a fraction of a cycle.
    ParamSpec::new("stereo", "Stereo", 0.0, 0.5, 0.25),
    ParamSpec::new("feedback", "Feedback", -0.95, 0.95, 0.0),
    ParamSpec::new("wet", "Wet", 0.0, 1.0, 0.5),
    ParamSpec::new("dry", "Dry", 0.0, 1.0, 1.0),
];

pub struct Phaser {
    p: [f32; 11],
    sections: [[Section; MAX_SECTIONS]; MAX_CHANNELS],
    fb: [f32; MAX_CHANNELS],
    phase: f64,
}

impl Phaser {
    pub fn new() -> Self {
        Phaser {
            p: [4.0, 500.0, 1.8, 0.7, 0.7, 0.35, 1.5, 0.25, 0.0, 0.5, 1.0],
            sections: [[Section::default(); MAX_SECTIONS]; MAX_CHANNELS],
            fb: [0.0; MAX_CHANNELS],
            phase: 0.0,
        }
    }
}

impl Default for Phaser {
    fn default() -> Self {
        Self::new()
    }
}

impl Effect for Phaser {
    fn process(&mut self, buf: &mut [f32], channels: usize, sample_rate: u32) {
        let channels = channels.max(1);
        let sr = sample_rate.max(1) as f32;
        let count = (self.p[0].round() as usize).clamp(1, MAX_SECTIONS);
        let (centre, spread, radius) = (self.p[1], self.p[2], self.p[3]);
        let (depth, rate, sweep, stereo) = (self.p[4], self.p[5], self.p[6], self.p[7]);
        let (feedback, wet, dry) = (self.p[8], self.p[9], self.p[10]);
        let n = channels.min(MAX_CHANNELS);
        let nyquist = sr * 0.49;

        for frame in buf.chunks_mut(channels) {
            for ch in 0..n.min(frame.len()) {
                let lfo = ((self.phase as f32 + ch as f32 * stereo) * 2.0 * PI).sin();
                // The sweep moves every notch by the same number of octaves, so
                // the pattern keeps its shape as it travels.
                let shift = 2f32.powf(lfo * sweep * 0.5);

                let x = frame[ch];
                let mut v = x + self.fb[ch] * feedback;
                for i in 0..count {
                    // Geometric spacing: each notch sits `spread` above the one
                    // below it. Not harmonic, which is the point.
                    let hz = (centre * spread.powi(i as i32) * shift).clamp(20.0, nyquist);
                    self.sections[ch][i].tune(hz, radius, sr);
                    v = self.sections[ch][i].step(v);
                }
                self.fb[ch] = v;
                // The feed-around. Sum of the input and the all-pass chain:
                // where the chain's phase is π the two cancel, and that is the
                // notch.
                let y = x + v * depth;
                frame[ch] = x * dry + y * wet;
            }
            self.phase = (self.phase + rate as f64 / sr as f64).rem_euclid(1.0);
        }
    }

    fn reset(&mut self) {
        for bank in &mut self.sections {
            for s in bank {
                s.reset();
            }
        }
        self.fb = [0.0; MAX_CHANNELS];
        self.phase = 0.0;
    }

    fn name(&self) -> &'static str {
        "Phaser"
    }
}

impl Params for Phaser {
    fn specs(&self) -> &'static [ParamSpec] {
        PHASER_SPECS
    }
    fn get(&self, k: &str) -> Option<f32> {
        PHASER_SPECS.iter().position(|s| s.key == k).map(|i| self.p[i])
    }
    fn set(&mut self, k: &str, v: f32) -> bool {
        match PHASER_SPECS.iter().position(|s| s.key == k) {
            Some(i) => {
                self.p[i] = PHASER_SPECS[i].clamp(v);
                true
            }
            None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Magnitude response at a frequency, by driving a sine through and
    /// measuring what comes back once the filter has settled.
    fn gain_at(p: &mut Phaser, hz: f32, sample_rate: u32) -> f32 {
        p.reset();
        let sr = sample_rate as f32;
        let n = 16_384;
        let mut buf: Vec<f32> = (0..n).map(|i| (2.0 * PI * hz * i as f32 / sr).sin()).collect();
        p.process(&mut buf, 1, sample_rate);
        // Second half only: the first is the filter settling.
        buf[n / 2..].iter().fold(0f32, |m, v| m.max(v.abs()))
    }

    fn still(rate: f32) -> Phaser {
        let mut p = Phaser::new();
        p.set("rateHz", rate);
        p.set("wet", 1.0);
        p.set("dry", 0.0);
        p
    }

    /// The point of the whole structure: notches that are *not* evenly spaced.
    ///
    /// A flanger's notches sit at multiples of one frequency and cannot do
    /// anything else. Here the spacing is a control, so the gaps between
    /// successive notches must grow.
    #[test]
    fn the_notches_are_not_uniformly_spaced() {
        let sr = 48_000u32;
        let mut p = still(0.0);
        p.set("notches", 4.0);
        p.set("centreHz", 300.0);
        p.set("spread", 2.0);
        p.set("resonance", 0.9);

        // Sweep and find the local minima of the response.
        let mut dips = Vec::new();
        let mut prev = (0.0f32, 0.0f32);
        let mut before = 0.0f32;
        let mut hz = 150.0f32;
        while hz < 8000.0 {
            let g = gain_at(&mut p, hz, sr);
            if prev.1 > 0.0 && prev.1 < before && prev.1 < g {
                dips.push(prev.0);
            }
            before = prev.1;
            prev = (hz, g);
            hz *= 1.06;
        }
        assert!(dips.len() >= 3, "expected several notches, found {dips:?}");

        // With a spread of 2 the gaps double; uniform spacing would keep them
        // the same. Compare the first gap with the last.
        let first = dips[1] - dips[0];
        let last = dips[dips.len() - 1] - dips[dips.len() - 2];
        assert!(
            last > first * 1.5,
            "notches at {dips:?} are evenly spaced — that is a flanger"
        );
    }

    /// Smith: the pole radius sets how wide the notch is — closer to the unit
    /// circle is narrower.
    ///
    /// Measured as *contrast* rather than as the level at one probe frequency.
    /// A narrow notch and a wide one both dip at the centre; what tells them
    /// apart is how quickly the response recovers away from it. Comparing a
    /// single off-centre level says nothing, because the two also differ in how
    /// deep they cut.
    #[test]
    fn the_pole_radius_sets_how_wide_the_notch_is() {
        let sr = 48_000u32;
        let contrast = |resonance: f32| {
            let mut p = still(0.0);
            p.set("notches", 1.0);
            p.set("centreHz", 1000.0);
            p.set("resonance", resonance);
            let centre = gain_at(&mut p, 1000.0, sr);
            let away = gain_at(&mut p, 2000.0, sr);
            away / centre.max(1e-6)
        };
        let (narrow, wide) = (contrast(0.99), contrast(0.3));
        assert!(
            narrow > wide,
            "a pole nearer the circle should recover faster off-centre: \
             narrow {narrow:.2} against wide {wide:.2}"
        );
    }

    fn drive(p: &mut Phaser, sample_rate: u32) -> f32 {
        let mut buf: Vec<f32> = (0..48_000)
            .map(|i| (i as f32 / 5.0).sin() * 0.7 + (i as f32 / 1.7).sin() * 0.3)
            .collect();
        p.process(&mut buf, 2, sample_rate);
        buf.iter().fold(0f32, |m, v| m.max(v.abs()))
    }

    /// Smith's bound: the structure's gain is strictly between 0 and 2, because
    /// an all-pass chain has unity gain by definition, so the sum of the input
    /// and the chain can be at most twice either. He names this as the reason
    /// the notch controls need no safety net.
    ///
    /// The bound is a property of *his* structure: fixed coefficients, no
    /// feedback. Both of the things this adds — a swept LFO and a feed-around
    /// with feedback — step outside it, and the two tests below say by how much.
    #[test]
    fn smiths_bound_holds_wherever_his_structure_does() {
        let sr = 48_000u32;
        for (notches, res, depth) in [(8.0f32, 0.999f32, 1.0f32), (8.0, 0.999, -1.0), (1.0, 0.0, 1.0)] {
            let mut p = Phaser::new();
            p.set("notches", notches);
            p.set("resonance", res);
            p.set("depth", depth);
            p.set("feedback", 0.0);
            p.set("wet", 1.0);
            p.set("dry", 0.0);
            // Stationary: an all-pass is only strictly all-pass with fixed
            // coefficients, which is the assumption the bound rests on.
            p.set("rateHz", 0.0);
            // Measured as a *magnitude response* — a steady sine in, its
            // amplitude out — because that is the quantity Smith bounds. An
            // all-pass has unity energy gain, not unity peak gain, so the
            // largest sample of a broadband signal can and does sit above it.
            let mut hz = 50.0f32;
            while hz < 12_000.0 {
                let g = gain_at(&mut p, hz, sr);
                assert!(
                    g.is_finite() && g <= 2.0 + 1e-3,
                    "notches {notches} res {res} depth {depth}: gain {g:.3} at {hz:.0} Hz, \
                     above Smith's bound of 2"
                );
                hz *= 1.3;
            }
        }
    }

    /// A swept phaser stays in its lane.
    ///
    /// Retuning every section on every sample makes the chain time-varying, and
    /// a time-varying all-pass is not exactly all-pass, so the peak wanders a
    /// little above what a stationary one would reach. This pins how far: a few
    /// per cent, not a factor.
    #[test]
    fn sweeping_costs_a_little_of_the_bound_and_no_more() {
        let sr = 48_000u32;
        let mut p = Phaser::new();
        p.set("notches", 8.0);
        p.set("resonance", 0.999);
        p.set("depth", 1.0);
        p.set("feedback", 0.0);
        p.set("wet", 1.0);
        p.set("dry", 0.0);
        p.set("rateHz", 8.0);
        p.set("sweep", 4.0);
        let peak = drive(&mut p, sr);
        assert!(
            (2.0..2.6).contains(&peak),
            "a swept phaser peaked at {peak}; expected a little over 2"
        );
    }

    /// Feedback is **not** part of Smith's structure, and it is what takes the
    /// gain past his bound — a resonant phaser is a recirculating one. It still
    /// has to stay finite and reasonable at the extremes the controls allow.
    #[test]
    fn feedback_goes_past_smiths_bound_but_not_out_of_control() {
        let sr = 48_000u32;
        for fb in [0.95f32, -0.95] {
            let mut p = Phaser::new();
            p.set("notches", 8.0);
            p.set("resonance", 0.999);
            p.set("depth", 1.0);
            p.set("feedback", fb);
            p.set("wet", 1.0);
            p.set("dry", 0.0);
            p.set("rateHz", 8.0);
            let peak = drive(&mut p, sr);
            assert!(peak.is_finite() && peak < 12.0, "feedback {fb} reached {peak}");
        }
    }

    /// Moving one section retunes one notch and leaves the others alone — the
    /// property a delay line cannot offer.
    #[test]
    fn moving_the_centre_moves_the_notches_with_it() {
        let sr = 48_000u32;
        let notch_near = |centre: f32, probe: f32| {
            let mut p = still(0.0);
            p.set("notches", 1.0);
            p.set("centreHz", centre);
            p.set("resonance", 0.95);
            gain_at(&mut p, probe, sr)
        };
        // At 500 Hz the dip is at 500, not at 2000; move it and they swap.
        assert!(notch_near(500.0, 500.0) < notch_near(500.0, 2000.0));
        assert!(notch_near(2000.0, 2000.0) < notch_near(2000.0, 500.0));
    }

    #[test]
    fn a_dry_phaser_is_the_signal_it_was_given() {
        let sr = 48_000u32;
        let source: Vec<f32> = (0..8192).map(|i| (i as f32 / 11.0).sin() * 0.6).collect();
        let mut p = Phaser::new();
        p.set("wet", 0.0);
        p.set("dry", 1.0);
        let mut b = source.clone();
        p.process(&mut b, 2, sr);
        let worst = source.iter().zip(&b).map(|(a, c)| (a - c).abs()).fold(0f32, f32::max);
        assert!(worst < 1e-6, "a dry phaser moved the signal by {worst:.2e}");
    }
}
