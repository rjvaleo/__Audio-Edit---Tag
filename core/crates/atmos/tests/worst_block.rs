//! Every Atmosphere physical model, at the supported note/unison counts.
mod bench_support;
use bench_support::*;
use atmos::{Synth, models::MODELS};
#[test]
#[ignore = "a measurement: run it alone, in a release build"]
fn atmos_worst_block() {
    let mut rows = Vec::new();
    for (model, &(id, _, _, defaults)) in MODELS.iter().enumerate() {
        for notes in [1, 8, 16] {
            for unison in [1, 3] {
                for block in [64, 128, 512] {
                    let mut synth = Synth::new(SR as f32);
                    synth.set("a.model", model as f32);
                    for (i, v) in defaults.iter().enumerate() { synth.set(&format!("a.p{i}"), *v); }
                    for (key, value) in [("blend",0.0),("drift",0.0),("sus",1.0),("unison",unison as f32)] { synth.set(key,value); }
                    for n in 0..notes { synth.note_on(n, 130.81278 * 2f32.powf(n as f32 / 12.0), 0.8, 0); }
                    let (mut l, mut r) = (vec![0.0; block], vec![0.0; block]);
                    rows.push(measure(&format!("atmos-{id}-notes{notes}-unison{unison}"), block, |n| {
                        synth.render(&mut l[..n], &mut r[..n]);
                        std::hint::black_box((&l, &r));
                    }));
                }
            }
        }
    }
    write("atmos", rows);
}
