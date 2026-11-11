//! v8's modulation rules: every numeric key is a target, the LFOs' and the
//! envelopes' own controls included, and modulators move each other one
//! control block late.

use std::sync::Arc;

use wave::*;

const SR: f32 = 48_000.0;
/// The control block: one render of this many frames is one block.
const BLOCK: usize = 32;

fn synth(p: &Patch) -> Synth {
    let mut s = Synth::new(SR, 512);
    s.adopt(PatchState::new(p));
    s.set_table(0, Arc::new(Wavetable::from_frames(&builtin_frames("Glass Organ").unwrap())));
    s
}

/// A patch with nothing moving but what a test asks for.
fn still() -> Patch {
    let mut p = Patch::default();
    p.mods.clear();
    for l in 0..4 {
        p.set_str(&format!("lfo{l}.mode"), "free");
        p.set_str(&format!("lfo{l}.shape"), "sine");
    }
    p
}

/// One block, then the telemetry it leaves.
fn step(s: &mut Synth, t: &mut Telemetry) {
    let (mut l, mut r) = ([0.0f32; BLOCK], [0.0f32; BLOCK]);
    s.render(&mut l, &mut r);
    s.telemetry(t);
}

/// How far phase `b` is past phase `a`, round the circle.
fn advance(a: f32, b: f32) -> f32 {
    (b - a).rem_euclid(1.0)
}

/// Hz on the v7 rate law, free.
fn hz(rate: f32) -> f32 {
    0.02 * 2000f32.powf(rate.clamp(0.0, 1.0))
}

#[test]
fn a_free_lfos_rate_follows_its_modulation() {
    // Macro 1 → LFO 1 Rate, +0.3: with the macro up the LFO runs 2000^0.3 ≈
    // 9.8 times as fast as with it down.
    let run = |macro_at: f32| {
        let mut p = still();
        p.set_num("lfo0.rate", 0.3);
        p.set_num("macro0", macro_at);
        p.mods.push(Mod::new("macro0", "lfo0.rate", 0.3));
        let mut s = synth(&p);
        let mut t = Telemetry::default();
        step(&mut s, &mut t);
        let mut total = 0.0;
        let mut last = t.lfo_phase[0];
        for _ in 0..200 {
            step(&mut s, &mut t);
            total += advance(last, t.lfo_phase[0]);
            last = t.lfo_phase[0];
        }
        total / (200.0 * BLOCK as f32 / SR)
    };
    let slow = run(0.0);
    let fast = run(1.0);
    assert!((slow - hz(0.3)).abs() < 1e-3 * hz(0.3), "unmodulated: {slow} Hz, not {}", hz(0.3));
    assert!((fast - hz(0.6)).abs() < 1e-3 * hz(0.6), "modulated: {fast} Hz, not {}", hz(0.6));
}

#[test]
fn a_cross_modulation_loop_is_stable_and_one_block_late() {
    // LFO 1 → LFO 2 Rate and LFO 2 → LFO 1 Rate. Each block, each LFO moves
    // at the rate the other's value at the end of the last block gives it.
    let mut p = still();
    p.set_num("lfo0.rate", 0.5);
    p.set_num("lfo1.rate", 0.4);
    p.mods.push(Mod::new("lfo1", "lfo0.rate", 0.5));
    p.mods.push(Mod::new("lfo0", "lfo1.rate", 0.5));
    let mut s = synth(&p);
    let mut t = Telemetry::default();
    step(&mut s, &mut t);
    let dt = BLOCK as f32 / SR;
    for _ in 0..20_000 {
        let (value, phase) = (t.lfo, t.lfo_phase);
        step(&mut s, &mut t);
        assert!(t.lfo.iter().all(|v| v.is_finite() && v.abs() <= 1.0), "{:?}", t.lfo);
        let want0 = hz(0.5 + 0.5 * value[1]) * dt;
        let want1 = hz(0.4 + 0.5 * value[0]) * dt;
        let got0 = advance(phase[0], t.lfo_phase[0]);
        let got1 = advance(phase[1], t.lfo_phase[1]);
        assert!((got0 - want0).abs() < 1e-5, "LFO 1 moved {got0}, the last block's LFO 2 says {want0}");
        assert!((got1 - want1).abs() < 1e-5, "LFO 2 moved {got1}, the last block's LFO 1 says {want1}");
    }
}

#[test]
fn a_per_note_source_reaches_a_free_lfo_through_the_newest_voice() {
    // Velocity → LFO 1 Rate: nothing sounding is velocity 0; a note at full
    // velocity speeds it up by the whole amount.
    let mut p = still();
    p.set_num("lfo0.rate", 0.2);
    p.mods.push(Mod::new("vel", "lfo0.rate", 0.4));
    let mut s = synth(&p);
    let mut t = Telemetry::default();
    let rate = |s: &mut Synth, t: &mut Telemetry| {
        step(s, t);
        let a = t.lfo_phase[0];
        step(s, t);
        advance(a, t.lfo_phase[0]) / (BLOCK as f32 / SR)
    };
    let idle = rate(&mut s, &mut t);
    s.note_on(60, 1.0);
    step(&mut s, &mut t);
    let held = rate(&mut s, &mut t);
    assert!((idle - hz(0.2)).abs() < 1e-3, "idle {idle}");
    assert!((held - hz(0.6)).abs() < 1e-2, "held {held}, not {}", hz(0.6));
}

#[test]
fn modulating_an_attack_takes_effect_mid_note() {
    // A one-second attack; a tenth of a second in, Macro 1 takes the attack
    // to nothing, and the envelope is at the top within a few milliseconds.
    let mut p = still();
    p.set_num("amp.a", 0.5);
    p.set_num("amp.s", 1.0);
    p.set_num("macro0", 0.0);
    p.mods.push(Mod::new("macro0", "amp.a", -0.5));
    let run = |moved: bool| {
        let mut s = synth(&p);
        let mut t = Telemetry::default();
        s.note_on(60, 1.0);
        for _ in 0..150 {
            step(&mut s, &mut t);
        }
        let at = t.voices()[0].env;
        if moved {
            s.set_param(param_id("macro0").unwrap(), 1.0);
        }
        for _ in 0..75 {
            step(&mut s, &mut t);
        }
        (at, t.voices()[0].env)
    };
    let (at, plain) = run(false);
    assert!((at - 0.1).abs() < 0.01, "a tenth of the way up after 0.1 s: {at}");
    assert!(plain < 0.2, "the plain attack is still climbing: {plain}");
    let (_, moved) = run(true);
    assert!(moved > 0.99, "with the attack modulated away the envelope is up: {moved}");
}

#[test]
fn modulating_a_per_note_lfos_rate_takes_effect_mid_note() {
    // LFO 1 in Trig mode, Macro 1 → its rate, moved while the note holds.
    let mut p = still();
    p.set_str("lfo0.mode", "trig");
    p.set_num("lfo0.rate", 0.2);
    p.set_num("macro0", 0.0);
    p.mods.push(Mod::new("macro0", "lfo0.rate", 0.4));
    let mut s = synth(&p);
    let mut t = Telemetry::default();
    s.note_on(60, 1.0);
    let rate = |s: &mut Synth, t: &mut Telemetry| {
        step(s, t);
        let a = t.lfo_phase[0];
        step(s, t);
        advance(a, t.lfo_phase[0]) / (BLOCK as f32 / SR)
    };
    let before = rate(&mut s, &mut t);
    s.set_param(param_id("macro0").unwrap(), 1.0);
    // The macro glides over 15 ms.
    for _ in 0..200 {
        step(&mut s, &mut t);
    }
    let after = rate(&mut s, &mut t);
    assert!((before - hz(0.2)).abs() < 1e-2, "before {before}");
    assert!((after - hz(0.6)).abs() < 1e-2 * hz(0.6), "after {after}, not {}", hz(0.6));
}

#[test]
fn modulating_a_decay_takes_effect_mid_note() {
    // ENV 2 with a four-second decay toward 0, sent to the filter cutoff;
    // halfway through, the decay is modulated to nothing and ENV 2 lands on
    // its sustain at once.
    let mut p = still();
    p.set_num("env1.a", 0.0);
    p.set_num("env1.d", 1.0);
    p.set_num("env1.s", 0.0);
    p.set_num("macro0", 0.0);
    p.mods.push(Mod::new("env1", "filt0.cut", 0.4));
    p.mods.push(Mod::new("macro0", "env1.d", -1.0));
    let cut = |s: &Synth, t: &mut Telemetry| {
        s.telemetry(t);
        t.mods().iter().find(|(id, _)| id.key() == "filt0.cut").unwrap().1
    };
    let mut s = synth(&p);
    let mut t = Telemetry::default();
    s.note_on(60, 1.0);
    for _ in 0..1500 {
        step(&mut s, &mut t);
    }
    let base = p.get_num("filt0.cut").unwrap();
    let halfway = cut(&s, &mut t);
    assert!(halfway > base + 0.1, "ENV 2 is still well up a second into its decay: {halfway}");
    s.set_param(param_id("macro0").unwrap(), 1.0);
    for _ in 0..100 {
        step(&mut s, &mut t);
    }
    let landed = cut(&s, &mut t);
    assert!((landed - base).abs() < 1e-3, "the decay modulated away lands it on its sustain: {landed} against {base}");
}
