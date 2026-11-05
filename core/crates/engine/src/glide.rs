//! Hyperprism's Smoothing, for controls moved from the HyperStretch pad.
//!
//! The pad sends its values as steps — a recorded gesture is a point every
//! sixtieth of a second, played back as jumps — and what makes Hyperprism feel
//! the way it does is that the sound does not follow those jumps. Each process
//! moved its controls towards their targets by a one-pole, a fixed number of
//! samples at a time, so the sound swoops after the hand. This is that, read
//! from Hyperprism-PPC 1.2.1's code (`CEffect::UpdateSmoothing`,
//! `CEffect::GetAdditionalSettings`, `EPitchShift::Initialize`, `PitchShift2`):
//!
//! - the Smoothing (%) slider `s` is stored as `int(10^(0.04·(100 − s)))`;
//! - the coefficient is that times 0.0001, so 0 % is 1 (instant), 50 % is 0.01,
//!   100 % is 0.0001;
//! - every step, `now = a·target + (1 − a)·now`;
//! - the Pitch Time Changer steps every 512 samples at 44.1 kHz, the first on
//!   the very first sample.
//!
//! Here a step is applied once per block, at the block's start, which is as
//! fine as the engine's blocks are. See `docs/HYPERSTRETCH.md`.

/// Samples between steps at 44.1 kHz; scaled with the rate elsewhere, as every
/// Hyperprism sample count is.
pub const STEP_SAMPLES: f64 = 512.0;

/// The one-pole coefficient for a Smoothing percentage.
pub fn coefficient(smoothing: f32) -> f64 {
    let s = if smoothing.is_finite() { smoothing.clamp(0.0, 100.0) } else { 0.0 } as f64;
    // The original truncates to an integer before scaling; the epsilon keeps a
    // power that lands exactly on one from rounding down below it.
    (10f64.powf(0.04 * (100.0 - s)) + 1e-9).floor() * 0.0001
}

/// `N` values moving towards their targets together.
#[derive(Clone, Copy, Debug)]
pub struct Glide<const N: usize> {
    now: [f64; N],
    /// Samples until the next step; a step is due at zero.
    until: f64,
    primed: bool,
}

impl<const N: usize> Default for Glide<N> {
    fn default() -> Self {
        Glide { now: [0.0; N], until: 0.0, primed: false }
    }
}

impl<const N: usize> Glide<N> {
    /// Jump straight to `target`: on load, while stopped, or with no smoothing.
    pub fn snap(&mut self, target: [f32; N]) {
        for (n, t) in self.now.iter_mut().zip(target) {
            *n = t as f64;
        }
        self.until = 0.0;
        self.primed = true;
    }

    /// The values to play for a block of `frames`, having moved towards
    /// `target` by every step that falls in it.
    pub fn advance(&mut self, target: [f32; N], frames: usize, sample_rate: u32, smoothing: f32) -> [f32; N] {
        let a = coefficient(smoothing);
        if !self.primed || a >= 1.0 || target.iter().any(|t| !t.is_finite()) {
            self.snap(target);
            return target;
        }
        let interval = STEP_SAMPLES * sample_rate.max(1) as f64 / 44_100.0;
        let mut steps = 0u32;
        while self.until < frames as f64 {
            steps += 1;
            self.until += interval;
        }
        self.until -= frames as f64;
        if steps > 0 {
            // `steps` steps of one pole at once: (1 − a)^steps of the distance stays.
            let keep = (1.0 - a).powi(steps as i32);
            for (n, t) in self.now.iter_mut().zip(target) {
                *n = t as f64 + (*n - t as f64) * keep;
            }
        }
        self.now.map(|v| v as f32)
    }

    pub fn values(&self) -> [f32; N] {
        self.now.map(|v| v as f32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_coefficient_is_hyperprisms() {
        assert_eq!(coefficient(0.0), 1.0);
        assert!((coefficient(50.0) - 0.01).abs() < 1e-12);
        assert!((coefficient(25.0) - 0.1).abs() < 1e-12);
        assert!((coefficient(100.0) - 0.0001).abs() < 1e-12);
        // int() of 10^(0.04·67) = 478.63… is 478.
        assert!((coefficient(33.0) - 0.0478).abs() < 1e-12);
        assert_eq!(coefficient(-5.0), 1.0);
        assert_eq!(coefficient(f32::NAN), 1.0);
    }

    #[test]
    fn the_first_block_takes_the_target_and_no_smoothing_follows_at_once() {
        let mut g = Glide::<2>::default();
        assert_eq!(g.advance([2.0, 3.0], 256, 44_100, 50.0), [2.0, 3.0]);
        assert_eq!(g.advance([4.0, -1.0], 256, 44_100, 0.0), [4.0, -1.0]);
    }

    #[test]
    fn one_step_per_512_samples_moves_a_hundredth_at_fifty_percent() {
        let mut g = Glide::<1>::default();
        g.snap([0.0]);
        // A step is due on the first sample.
        let v = g.advance([1.0], 512, 44_100, 50.0)[0];
        assert!((v - 0.01).abs() < 1e-6, "{v}");
        // Two blocks of 256: one more step, in the first of them.
        let v = g.advance([1.0], 256, 44_100, 50.0)[0];
        assert!((v - (1.0 - 0.99f32 * 0.99)).abs() < 1e-6, "{v}");
        let w = g.advance([1.0], 256, 44_100, 50.0)[0];
        assert_eq!(v, w, "no step falls in the second half");
    }

    #[test]
    fn at_the_default_it_takes_a_little_over_a_second_to_cover_most_of_a_move() {
        let mut g = Glide::<1>::default();
        g.snap([0.0]);
        let mut blocks = 0;
        while g.advance([1.0], 512, 44_100, 50.0)[0] < 1.0 - (-1.0f32).exp() {
            blocks += 1;
        }
        let secs = blocks as f64 * 512.0 / 44_100.0;
        assert!((1.1..1.2).contains(&secs), "{secs}");
    }

    #[test]
    fn the_step_scales_with_the_sample_rate() {
        let mut g = Glide::<1>::default();
        g.snap([0.0]);
        let mut steps = 0;
        let mut last = 0.0;
        for _ in 0..8 {
            let v = g.advance([1.0], 512, 88_200, 50.0)[0];
            if v != last {
                steps += 1;
            }
            last = v;
        }
        assert_eq!(steps, 4, "every 1024 samples at twice the rate");
    }

    #[test]
    fn values_glide_together_and_a_snap_ends_it() {
        let mut g = Glide::<2>::default();
        g.snap([1.0, 0.0]);
        let v = g.advance([2.0, 12.0], 512, 44_100, 25.0);
        assert!((v[0] - 1.1).abs() < 1e-6 && (v[1] - 1.2).abs() < 1e-6, "{v:?}");
        g.snap([2.0, 12.0]);
        assert_eq!(g.values(), [2.0, 12.0]);
    }
}
