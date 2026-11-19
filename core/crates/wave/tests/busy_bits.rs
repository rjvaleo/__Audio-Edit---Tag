//! Five seconds of chords, unison, envelopes and a moving filter. The expected
//! bits are recorded on the unmodified task-017 baseline before optimization.
use wave::*;

#[test]
fn busy_wave_patch_keeps_every_bit() {
    let mut patch = Patch::default();
    patch.set_str("voice.mode", "poly");
    for i in 0..3 { patch.set_num(&format!("osc{i}.uni.n"), 4.0); }
    patch.mods.push(Mod::new("lfo0", "filt0.cut", 0.35));
    patch.mods.push(Mod::new("env1", "osc0.warp0.amt", 0.25));
    let mut synth = Synth::new(48_000.0, 128);
    synth.set_seed(0x1748);
    synth.adopt(PatchState::new(&patch));
    let (mut l, mut r) = ([0.0;128], [0.0;128]);
    let mut hash = 0xcbf29ce484222325u64;
    let mut energy = 0.0f64;
    for block in 0..1875 {
        if block % 375 == 0 {
            for note in [48, 52, 55, 59, 60, 64, 67, 71] { synth.note_on(note, 0.8); }
        }
        if block % 375 == 280 {
            for note in [48, 52, 55, 59, 60, 64, 67, 71] { synth.note_off(note); }
        }
        let cut = 0.15 + (block % 375) as f32 / 375.0 * 0.7;
        synth.set_param(param_id("filt0.cut").unwrap(), cut);
        synth.render(&mut l, &mut r);
        for (&a, &b) in l.iter().zip(&r) {
            for sample in [a,b] {
                assert!(sample.is_finite());
                energy += (sample as f64).powi(2);
                for byte in sample.to_bits().to_le_bytes() { hash = (hash ^ byte as u64).wrapping_mul(0x100000001b3); }
            }
        }
    }
    assert!(energy > 1.0, "the busy patch must sound");
    println!("busy Wave baseline hash {hash:016x}, energy {energy:.12}");
    assert_eq!(hash, 0xc280a5f58d64aba1, "task-017 baseline 92b39b0: no output bit may change");
}
