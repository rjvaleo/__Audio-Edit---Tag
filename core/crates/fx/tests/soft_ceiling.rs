//! Round the peaks, never slice them.
//!
//! Asked for after "Breaking Again" was measured leaving the rack at +10.3 dBFS
//! with its own limiter off — everything past full scale arriving at the device
//! as a hard corner. The choice between a limiter and a saturator was made
//! explicitly: "I'd rather some light distortion than hard clips."

use fx::{soft_ceiling, soften, CEILING_KNEE};

/// Nothing below the knee is touched. This is the property that lets it sit in
/// the output stage permanently without colouring anything.
#[test]
fn below_the_knee_it_is_exactly_the_identity() {
    let mut x = -CEILING_KNEE;
    while x <= CEILING_KNEE {
        assert_eq!(soft_ceiling(x), x, "changed {x}, which is under the knee");
        x += 0.001;
    }
}

/// And nothing, at any input, ever reaches full scale.
#[test]
fn it_can_never_reach_full_scale() {
    for k in 0..2000 {
        let x = k as f32 * 0.05;          // up to 100x over
        let y = soft_ceiling(x);
        assert!(y < 1.0, "input {x} produced {y}, which is not under full scale");
        assert!(soft_ceiling(-x) > -1.0, "input {} produced {}", -x, soft_ceiling(-x));
    }
    assert!(soft_ceiling(f32::INFINITY) <= 1.0);
}

/// It is a curve, not a corner: no discontinuity where it takes over.
///
/// A hard clip's problem is the corner — a discontinuity in the derivative puts
/// energy at every frequency at once. The whole point of this is not having one.
#[test]
fn there_is_no_corner_at_the_knee() {
    let step = 1e-4;
    let mut worst = 0.0f32;
    let mut x = CEILING_KNEE - 0.05;
    let mut prev_slope = (soft_ceiling(x + step) - soft_ceiling(x)) / step;
    while x < CEILING_KNEE + 0.05 {
        let slope = (soft_ceiling(x + step) - soft_ceiling(x)) / step;
        worst = worst.max((slope - prev_slope).abs());
        prev_slope = slope;
        x += step;
    }
    assert!(worst < 0.05, "the slope jumps by {worst} at the knee — that is a corner");
}

/// Monotonic, so it never folds the waveform back on itself.
#[test]
fn it_never_folds() {
    let mut prev = soft_ceiling(0.0);
    let mut x = 0.0f32;
    while x < 8.0 {
        x += 0.001;
        let y = soft_ceiling(x);
        assert!(y >= prev, "output fell from {prev} to {y} as the input rose");
        prev = y;
    }
}

/// Odd, so it does not shift the signal off centre.
#[test]
fn it_is_symmetric() {
    for k in 0..500 {
        let x = k as f32 * 0.01;
        assert!((soft_ceiling(x) + soft_ceiling(-x)).abs() < 1e-6,
            "asymmetric at {x}: {} vs {}", soft_ceiling(x), soft_ceiling(-x));
    }
}

/// The block form, on something that really is far too loud.
#[test]
fn a_block_driven_ten_db_over_comes_back_inside() {
    // +10.3 dBFS, which is what the preset measured.
    let mut buf: Vec<f32> = (0..4096)
        .map(|i| (i as f32 * 0.01).sin() * 3.27)
        .collect();
    let before = buf.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    soften(&mut buf);
    let after = buf.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    assert!(before > 3.0, "the test signal was not over in the first place");
    assert!(after < 1.0, "still {after} after softening");
    // And it is gentler than the thing it replaces. At this much drive *any*
    // ceiling flattens — you cannot fit +10 dB into full scale — so the claim
    // worth testing is not "no flattening" but "less than a hard clip".
    let levels = |v: &[f32]| v.iter()
        .map(|x| (x * 10_000.0) as i32)
        .collect::<std::collections::HashSet<_>>()
        .len();
    let hard: Vec<f32> = (0..4096)
        .map(|i| ((i as f32 * 0.01).sin() * 3.27).clamp(-1.0, 1.0))
        .collect();
    assert!(
        levels(&buf) > levels(&hard),
        "softened has {} distinct levels against a hard clip's {} — no gentler",
        levels(&buf), levels(&hard),
    );
}
