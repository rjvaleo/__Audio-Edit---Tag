//! A note per callback, for two seconds per model, including event overflow.
#[path = "../../engine/tests/stage1_support/rt.rs"]
mod rt;
use atmos::{models::MODELS, Synth};
#[test]
fn every_models_note_ons_allocate_and_wait_for_nothing() {
    rt::verify();
    for model in 0..MODELS.len() {
        let mut synth = Synth::new(48_000.0);
        synth.set("a.model", model as f32);
        synth.set("b.model", model as f32);
        let (mut l, mut r) = ([0.0; 128], [0.0; 128]);
        synth.note_on(0, 440.0, 0.8, 0);
        synth.render(&mut l, &mut r);
        rt::start();
        for block in 0..750 {
            synth.note_on(block % 24, 220.0 + (block % 48) as f32 * 5.0, 0.8, 0);
            synth.render(&mut l, &mut r);
            synth.note_off(block % 24, 0);
        }
        for id in 0..100 {
            synth.note_on(id, 440.0, 0.8, 0);
            synth.note_off(id, 0);
        }
        synth.render(&mut l, &mut r);
        let n = rt::stop();
        assert!(l.iter().chain(&r).all(|x| x.is_finite()));
        rt::clean(MODELS[model].0, n);
    }
}
