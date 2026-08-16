//! The grain envelope, and the cliff that used to be at the front of it.
//!
//! A 300-render random sweep found the percussive end of the envelope clicking
//! on 17% of trials against 6% at the swelling end — a clean monotonic gradient,
//! which is what a real mechanism looks like rather than noise. The cause was
//! that `t^k` with `k < 1` has an infinite derivative at zero: the envelope's
//! *value* at the first sample was always zero, which is why it went unnoticed,
//! but a 10 ms percussive grain reached 39% of full scale by its second sample
//! and a 2 ms one reached 71%.
//!
//! These tests measure the thing that was actually wrong — how fast it leaves —
//! rather than the thing that was always right.
//!
//! See `docs/GLITCH-SWEEP.md`.

use fx::grain::env_at;

/// The steepest a plain Hann of this length moves, per sample.
///
/// The bar has to be this rather than a fixed number. A 16-sample grain travels
/// from silence to full and back in sixteen samples, so its Hann moves by 0.19 a
/// sample — an absolute bar tight enough to catch a 10 ms cliff is one no short
/// grain could ever meet. The first version of these tests used one and failed
/// on a shape that was perfectly smooth.
fn hann_steepest(n: usize) -> f32 {
    let mut worst = 0.0f32;
    for i in 0..n - 1 {
        let a = 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (n - 1) as f32).cos();
        let b = 0.5 - 0.5 * (2.0 * std::f32::consts::PI * (i + 1) as f32 / (n - 1) as f32).cos();
        worst = worst.max((b - a).abs());
    }
    worst
}

/// How much sharper than a Hann any skew is allowed to be, anywhere.
///
/// The code aims for four; five leaves room for the float error in solving for
/// the exponent without letting a real cliff through — the old code was at
/// **fifty-nine times** a Hann for a 10 ms percussive grain.
const SHARPNESS_BAR: f32 = 5.0;

/// Every skew, every plausible grain length. Nothing may start with a step.
///
/// This is the test the fix exists for. On the old code a 480-sample percussive
/// grain jumped 0.387 in one sample against a Hann's 0.0066 — 59× — and this
/// fails at every percussive setting.
#[test]
fn no_envelope_starts_with_a_cliff() {
    let mut worst = (0.0f32, 0usize, 0.0f32);

    for &n in &[16usize, 32, 96, 240, 480, 2400, 4800, 48_000] {
        let bar = SHARPNESS_BAR * hann_steepest(n);
        for step in 0..=20 {
            let skew = step as f32 / 20.0;
            // The first ten samples, which is where an infinite derivative shows.
            for i in 0..10.min(n - 1) {
                let jump = (env_at(i + 1, n, skew) - env_at(i, n, skew)).abs();
                let rel = jump / hann_steepest(n);
                if rel > worst.0 {
                    worst = (rel, n, skew);
                }
                assert!(
                    jump <= bar,
                    "envelope jumps {jump:.4} between samples {i} and {} of a {n}-sample grain \
                     at skew {skew:.2} — {rel:.1}× a Hann of the same length. A step laid down \
                     once per grain is a click",
                    i + 1,
                );
            }
        }
    }
    assert!(worst.0 > 0.0, "measured nothing at all");
}

/// The other end, for the same reason. A shape that ran backwards would put the
/// cliff at the finish instead, and a click at the end of a grain is still a
/// click.
#[test]
fn no_envelope_ends_with_a_cliff() {
    for &n in &[16usize, 96, 480, 4800] {
        let bar = SHARPNESS_BAR * hann_steepest(n);
        for step in 0..=20 {
            let skew = step as f32 / 20.0;
            for i in (n.saturating_sub(11))..(n - 1) {
                let jump = (env_at(i + 1, n, skew) - env_at(i, n, skew)).abs();
                assert!(
                    jump <= bar,
                    "envelope jumps {jump:.4} at the end of a {n}-sample grain, skew {skew:.2} \
                     — {:.1}× a Hann of the same length",
                    jump / hann_steepest(n),
                );
            }
        }
    }
}

/// Both ends still reach zero. Bounding the slope must not have lifted the edge
/// off the floor — a grain that starts at a non-zero value is a different and
/// worse bug than the one being fixed.
#[test]
fn both_edges_are_still_silent() {
    for &n in &[16usize, 96, 480, 4800] {
        for step in 0..=20 {
            let skew = step as f32 / 20.0;
            assert!(env_at(0, n, skew).abs() < 1e-6, "n={n} skew={skew} starts loud");
            assert!(env_at(n - 1, n, skew).abs() < 1e-6, "n={n} skew={skew} ends loud");
        }
    }
}

/// Invariant 9, for this control. The default envelope is 0.5, which takes the
/// plain Hann path, and the bound must not touch a single sample of it.
#[test]
fn the_default_envelope_is_untouched_hann() {
    let n = 512;
    for i in 0..n {
        let want = 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (n - 1) as f32).cos();
        let got = env_at(i, n, 0.5);
        assert!(
            (got - want).abs() < 1e-7,
            "sample {i} of the default envelope moved: {got} vs {want}",
        );
    }
}

/// The control still does its job. Bounding the slope would be a poor fix if it
/// flattened the shapes into each other — percussive must still peak earlier
/// than symmetric, which must still peak earlier than swelling.
#[test]
fn the_skew_still_moves_the_peak() {
    let n = 4800;
    let peak_at = |skew: f32| {
        let mut best = (0.0f32, 0usize);
        for i in 0..n {
            let v = env_at(i, n, skew);
            if v > best.0 {
                best = (v, i);
            }
        }
        best.1
    };
    let early = peak_at(0.0);
    let middle = peak_at(0.5);
    let late = peak_at(1.0);
    assert!(
        early < middle && middle < late,
        "the peak no longer moves with the control: {early} / {middle} / {late}",
    );
    // And percussive must still be recognisably percussive rather than nudged.
    assert!(
        early < n / 3,
        "the percussive end peaks at {early} of {n} — too late to be an attack",
    );
}

/// The attack sits in the same place whatever the grain length.
///
/// This test first asserted the opposite — that a longer grain would be allowed
/// a relatively sharper attack, since one sample is a smaller part of its rise.
/// It fails, and the code is right: solving the bound at each length converges
/// on an exponent of about 0.5 from both directions, because 0.5 is exactly
/// where `t^k`'s contribution to the envelope slope, `∝ t^(2k−1)`, stops being
/// infinite at the origin. The bound lands on the mathematically meaningful
/// threshold on its own rather than because anyone chose it.
///
/// The property that follows is better than the one expected: the control means
/// the same thing at 2 ms as at 1 s, so a grain-size sweep does not also sweep
/// the envelope's character.
#[test]
fn the_attack_sits_in_the_same_place_at_every_length() {
    let frac = |n: usize| {
        (0..n).find(|&i| env_at(i, n, 0.0) >= 0.5).unwrap_or(n) as f32 / n as f32
    };
    let lengths = [96usize, 480, 4800, 48_000];
    let fracs: Vec<f32> = lengths.iter().map(|&n| frac(n)).collect();
    let lo = fracs.iter().cloned().fold(f32::INFINITY, f32::min);
    let hi = fracs.iter().cloned().fold(0.0f32, f32::max);
    assert!(
        hi / lo < 1.5,
        "the attack moves with grain length: {fracs:?} across {lengths:?}",
    );
    // And it is still an attack — in the first fifth, not the middle.
    assert!(hi < 0.2, "the percussive end no longer peaks early: {fracs:?}");
}

/// The exponent never goes below the threshold where the slope blows up.
///
/// Stated directly rather than inferred from samples, because this is the whole
/// mechanism: `env` near zero goes as `t^(2k−1)`, so `k < 0.5` is an infinite
/// derivative at the edge and `k ≥ 0.5` is not.
#[test]
fn the_warp_never_reaches_an_infinite_edge_slope() {
    for &n in &[32usize, 96, 480, 4800, 48_000] {
        // Read the exponent back out of the shape: env(t) = 0.5 − 0.5cos(2π t^k),
        // so at the sample where env first crosses a half, t^k ≈ 0.25.
        let i = (0..n).find(|&i| env_at(i, n, 0.0) >= 0.5).unwrap_or(n - 1);
        let t = i as f32 / (n - 1) as f32;
        let k = 0.25f32.ln() / t.ln();
        assert!(
            k >= 0.48,
            "a {n}-sample percussive grain implies an exponent of {k:.3}, under the 0.5 \
             where the edge slope becomes infinite",
        );
    }
}
