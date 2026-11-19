//! Seeded notes, invalid note inputs, and every control at both ends.
use atmos::{models::MODELS, Synth};
const SEED: u32 = 0x0025_a17e;
fn next(s: &mut u32) -> u32 { *s = s.wrapping_mul(1664525).wrapping_add(1013904223); *s }
const CONTROLS: &[(&str, f32, f32)] = &[
    ("blend",0.0,1.0),("unison",1.0,3.0),("detune",0.0,100.0),("width",0.0,1.0),("drift",0.0,1.0),
    ("sub",0.0,1.0),("air",0.0,1.0),("glide",0.0,5.0),("atk",0.0005,20.0),("dec",0.001,20.0),
    ("sus",0.0,1.0),("rel",0.002,30.0),("vol",0.0,1.0),("flt.type",0.0,2.0),("flt.cut",20.0,20000.0),
    ("flt.q",0.3,20.0),("flt.key",0.0,1.0),("flt.amt",-1.0,1.0),("flt.atk",0.0005,20.0),
    ("flt.dec",0.001,20.0),("flt.sus",0.0,1.0),("flt.rel",0.002,30.0),("fit",0.0,1.0),
];
#[test]
fn every_model_stays_finite_under_notes_and_extreme_controls() {
    for model in 0..MODELS.len() {
        let mut seed = SEED;
        let mut synth = Synth::new(48_000.0);
        synth.set("a.model", model as f32);
        synth.set("b.model", model as f32);
        let (mut l, mut r) = ([0.0; 128], [0.0; 128]);
        for case in 0..200 {
            let mut settings = Vec::new();
            for &(key, lo, hi) in CONTROLS { settings.push((key.to_owned(), lo, hi)); }
            for side in ["a", "b"] {
                for param in 0..4 { settings.push((format!("{side}.p{param}"),0.0,1.0)); }
                settings.push((format!("{side}.oct"),-3.0,3.0));
                settings.push((format!("{side}.fine"),-100.0,100.0));
            }
            for lfo in 1..=3 {
                for (key,lo,hi) in [("shape",0.0,3.0),("rate",0.0,40.0),("depth",0.0,1.0),("target",0.0,8.0)] {
                    settings.push((format!("lfo{lfo}.{key}"),lo,hi));
                }
            }
            let mut values = Vec::new();
            for (key,lo,hi) in settings {
                let t = match case { 0 => 0.0, 1 => 1.0, _ => (next(&mut seed) >> 8) as f32 / 16777215.0 };
                let v = lo + (hi-lo)*t;
                assert!(synth.set(&key,v));
                values.push((key,v));
            }
            let hz = if case < 2 { 220.0 } else { match case % 11 { 0 => 0.0, 1 => -110.0, 2 => f32::NAN, _ => 20.0 * 2f32.powf((next(&mut seed) % 1000) as f32 / 100.0) } };
            let velocity = if case < 2 { 1.0 } else { match case % 7 { 0 => 0.0, 1 => 1.0, 2 => f32::NAN, 3 => -1.0, _ => 0.8 } };
            synth.note_on(case % 20, hz, velocity, 0);
            synth.render(&mut l, &mut r);
            assert!(l.iter().chain(&r).all(|x| x.is_finite()), "seed={SEED:#x}, model={model}, case={case}, hz={hz}, velocity={velocity}, params={values:?}");
            synth.note_off(case % 20, 0);
        }
    }
}
