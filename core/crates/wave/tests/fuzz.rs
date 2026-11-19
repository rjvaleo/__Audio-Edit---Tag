//! Seeded notes and the complete numeric control range.
use wave::*;
use std::sync::Arc;
const SEED: u32 = 0x0025_a17e;
fn next(s: &mut u32) -> u32 { *s = s.wrapping_mul(1664525).wrapping_add(1013904223); *s }
#[test]
fn random_notes_and_parameter_extremes_stay_finite() {
    let mut seed = SEED;
    let table = Arc::new(Wavetable::from_frames(&builtin_frames("Formant Sweep").unwrap()));
    let mut synth = Synth::new(48_000.0, 512);
    for osc in 0..3 { synth.set_table(osc, table.clone()); }
    let (mut l, mut r) = ([0.0; 512], [0.0; 512]);
    for case in 0..200 {
        let mut p = Patch::default();
        for spec in &KEYS {
            let t = match case { 0 => 0.0, 1 => 1.0, _ => (next(&mut seed) >> 8) as f32 / 16777215.0 };
            p.set_num(spec.key, spec.min + (spec.max - spec.min) * t);
        }
        synth.adopt(PatchState::new(&p));
        let note = (next(&mut seed) % 128) as u8;
        let velocity = match case % 6 { 0 => 0.0, 1 => 1.0, 2 => f32::NAN, 3 => -1.0, _ => (next(&mut seed) >> 8) as f32 / 16777215.0 };
        synth.note_on(note, velocity);
        synth.render(&mut l, &mut r);
        assert!(l.iter().chain(&r).all(|x| x.is_finite()), "seed={SEED:#x}, case={case}, note={note}, velocity={velocity}, params={p:?}");
        synth.note_off(note);
    }
}
