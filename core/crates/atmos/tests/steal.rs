//! A voice taken for a new note leaves from where its sound was.
//!
//! The voice is started again from nothing and the new note fades in, but the
//! old sound stopped on that sample: a step as big as wherever its wave stood
//! (found by reading, 18 Nov 2026). Now it dies away over a few milliseconds.

mod common;
use atmos::{models::MODELS, Synth};
use common::SR;

/// A held note of model `m`, struck again `at` samples in. The biggest step
/// between two samples around the second strike, and the biggest anywhere in
/// the 20 ms before it.
fn struck_again(m: usize, at: usize) -> (f32, f32) {
    let mut s = Synth::new(SR);
    s.set("a.model", m as f32);
    for (k, d) in MODELS[m].3.iter().enumerate() {
        s.set(&format!("a.p{k}"), *d);
    }
    for (k, v) in [("blend", 0.0), ("drift", 0.0), ("width", 0.0), ("atk", 0.002), ("sus", 1.0), ("rel", 0.05)] {
        s.set(k, v);
    }
    s.note_on(1, 110.0, 0.9, 0);
    let n = at + 2_000;
    let (mut l, mut r) = (vec![0.0f32; n], vec![0.0f32; n]);
    s.render(&mut l[..at], &mut r[..at]);
    s.note_on(1, 110.0, 0.9, 0);
    let (tail_l, tail_r) = (&mut l[at..], &mut r[at..]);
    s.render(tail_l, tail_r);
    let step = |k: usize| (l[k] - l[k - 1]).abs().max((r[k] - r[k - 1]).abs());
    let before = (at - 960..at).map(step).fold(0.0f32, f32::max);
    let around = (at..at + 8).map(step).fold(0.0f32, f32::max);
    (around, before)
}

#[test]
fn a_note_struck_again_does_not_cut_the_one_before() {
    let classic = atmos::models::model_index("classic").unwrap();
    let pluck = atmos::models::model_index("pluck").unwrap();
    let mut worst = 0.0f32;
    for m in [classic, pluck] {
        // Several moments, so the wave is caught high, low and in between.
        for at in (0..12).map(|k| 14_400 + k * 37) {
            let (around, before) = struck_again(m, at);
            assert!(before > 0.0, "model {m} was silent before the second strike");
            worst = worst.max(around / before);
            assert!(around <= before * 2.0, "model {m}, struck again at {at}: a step of {around} where the sound's own largest was {before}");
        }
    }
    assert!(worst.is_finite());
}
