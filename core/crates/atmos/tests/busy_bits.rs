//! Five seconds per model: chords, retriggers, glide, pan and filter movement.
//! Record on the unchanged codex/017-synths DSP before task-021 optimizations.
use atmos::{models::MODELS, Synth};

#[test]
fn every_busy_atmos_model_keeps_every_bit() {
    let mut hashes = Vec::new();
    for (model, &(name, _, _, defaults)) in MODELS.iter().enumerate() {
        let mut synth = Synth::new(48_000.0);
        for side in ["a", "b"] {
            assert!(synth.set(&format!("{side}.model"), model as f32));
            for (i, v) in defaults.iter().enumerate() { assert!(synth.set(&format!("{side}.p{i}"), *v)); }
        }
        for (k,v) in [("unison",3.0),("glide",0.12),("width",0.7),("drift",0.2),
            ("blend",0.35),("sus",0.8),("flt.cut",4000.0),("flt.q",1.7),
            ("lfo1.target",4.0),("lfo1.rate",0.7),("lfo1.depth",0.6)] { assert!(synth.set(k,v), "{k}"); }
        let (mut left, mut right) = ([0.0;128], [0.0;128]);
        let mut hash = 0xcbf29ce484222325u64;
        let mut energy = 0.0f64;
        for block in 0..1875 {
            if block % 375 == 0 {
                for id in 0..8 {
                    let semi = (id * 3 + block / 375) as f32;
                    synth.note_on(id, 130.81278 * 2f32.powf(semi / 12.0), 0.8, id as u32 * 3);
                }
            }
            if block % 375 == 280 { for id in 0..8 { synth.note_off(id, 0); } }
            assert!(synth.set("flt.cut", 200.0 + (block % 375) as f32 / 375.0 * 9000.0));
            synth.render(&mut left, &mut right);
            for (&a,&b) in left.iter().zip(&right) {
                for sample in [a,b] {
                    assert!(sample.is_finite());
                    energy += (sample as f64).powi(2);
                    for byte in sample.to_bits().to_le_bytes() { hash = (hash ^ byte as u64).wrapping_mul(0x100000001b3); }
                }
            }
        }
        assert!(energy > 0.01, "{name} must sound");
        println!("{name}: {hash:016x} energy {energy:.12}");
        hashes.push(hash);
    }
    // The bits were recorded on Apple silicon. They do not survive another
    // processor's maths library (the PC's `powf` and `exp` land a few ulps
    // apart), so they are held on aarch64 only, as `fx`'s goldens are; every
    // model still has to render finite sound everywhere.
    if !cfg!(target_arch = "aarch64") {
        return;
    }
    assert_eq!(hashes, [
        0x9606c2cdc13c4764, 0xaab1dc9657c777e6, 0x2e799b59f7608e66,
        0xb486c95f6107e40e, 0x1556af7ff5561d0c, 0xd30ba8dd02ea012e,
        0x774b08d9d50b440e, 0x45204014ac7b5b2f, 0x0388ed0ae241cf47,
        0xba7425c3d1548639,
    ], "codex/017-synths baseline: no output bit may change");
}
