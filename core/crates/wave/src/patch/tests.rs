use super::*;

#[test]
fn index_constants_name_the_keys_they_claim() {
    let at = |i: usize| KEYS[i].key;
    for n in 0..3 {
        let o = |f| at(osc_key(n, f));
        assert_eq!(o(O_ON), format!("osc{n}.on"));
        assert_eq!(o(O_POS), format!("osc{n}.pos"));
        assert_eq!(o(O_WARP0), format!("osc{n}.warp0.amt"));
        assert_eq!(o(O_WARP1), format!("osc{n}.warp1.amt"));
        assert_eq!(o(O_UNI_N), format!("osc{n}.uni.n"));
        assert_eq!(o(O_UNI_DET), format!("osc{n}.uni.det"));
        assert_eq!(o(O_UNI_SPR), format!("osc{n}.uni.spr"));
        assert_eq!(o(O_FX_A), format!("osc{n}.fx.a"));
        assert_eq!(o(O_FX_B), format!("osc{n}.fx.b"));
        assert_eq!(o(O_PITCH), format!("osc{n}.pitch"));
        assert_eq!(o(O_FINE), format!("osc{n}.fine"));
        assert_eq!(o(O_PHASE), format!("osc{n}.phase"));
        assert_eq!(o(O_RAND), format!("osc{n}.rand"));
        assert_eq!(o(O_PAN), format!("osc{n}.pan"));
        assert_eq!(o(O_LEVEL), format!("osc{n}.level"));
    }
    assert_eq!(at(SUB_ON), "sub.on");
    assert_eq!(at(SUB_LEVEL), "sub.level");
    assert_eq!(at(NOISE_ON), "noise.on");
    assert_eq!(at(NOISE_LEVEL), "noise.level");
    assert_eq!(at(FILT_BASE + F_CUT), "filt0.cut");
    assert_eq!(at(FILT_BASE + FILT_STRIDE + F_KEY), "filt1.key");
    assert_eq!(at(AMP_BASE), "amp.a");
    assert_eq!(at(AMP_BASE + 3), "amp.r");
    assert_eq!(at(ENV_BASE), "env1.a");
    assert_eq!(at(ENV_BASE + 11), "env3.r");
    assert_eq!(at(LFO_RATE + 3), "lfo3.rate");
    assert_eq!(at(MACRO_BASE + 7), "macro7");
    assert_eq!(at(GLIDE), "voice.glide");
    assert_eq!(at(BEND), "voice.bend");
    assert_eq!(at(MASTER), "master");
    assert_eq!(at(LFO_SMOOTH), "lfo0.smooth");
    assert_eq!(at(LFO_RISE + 3), "lfo3.rise");
    assert_eq!(at(VOICE_MPE), "voice.mpe");
    assert_eq!(at(FX_BASE), "fx0.on");
    assert_eq!(at(FX_BASE + 4 * FX_STRIDE + 3), "fx4.k2");
    assert_eq!(KEYS.len(), NUM_PARAMS);
    let mut seen = std::collections::HashSet::new();
    assert!(KEYS.iter().all(|k| seen.insert(k.key)), "a key is listed twice");
}

#[test]
fn the_default_is_the_mock_ups_starting_state() {
    let p = Patch::default();
    assert_eq!(p.get_str("osc0.table"), Some("Formant Sweep"));
    assert_eq!(p.get_num("osc0.pos"), Some(0.34));
    assert_eq!(p.get_str("osc0.warp0.mode"), Some("bend"));
    assert_eq!(p.get_num("osc0.warp0.amt"), Some(0.3));
    assert_eq!(p.get_num("osc0.uni.n"), Some(5.0));
    assert_eq!(p.get_str("osc0.fx.mode"), Some("chorus"));
    assert_eq!(p.get_str("osc1.table"), Some("Vowel Ah–Oo"));
    assert_eq!(p.get_num("osc1.pitch"), Some(0.75)); // +12 st
    assert_eq!(p.get_str("osc1.warp0.mode"), Some("sync"));
    assert_eq!(p.get_str("osc1.warp1.mode"), Some("fm"));
    assert_eq!(p.get_num("osc1.warp1.amt"), Some(0.25));
    assert_eq!(p.get_str("osc1.fx.mode"), Some("crush"));
    assert_eq!(p.get_str("osc2.table"), Some("Glass Organ"));
    assert_eq!(p.get_num("osc2.on"), Some(0.0));
    assert_eq!(p.get_num("sub.on"), Some(1.0));
    assert_eq!(p.get_str("filt0.type"), Some("lp"));
    assert_eq!(p.get_num("filt0.cut"), Some(0.55));
    assert_eq!(p.get_num("filt0.res"), Some(0.35));
    assert_eq!(p.get_str("filt1.type"), Some("bp"));
    assert_eq!(p.get_num("filt1.cut"), Some(0.7));
    assert_eq!(p.get_num("filt1.res"), Some(0.5));
    assert_eq!([p.values[AMP_BASE], p.values[AMP_BASE + 1], p.values[AMP_BASE + 2], p.values[AMP_BASE + 3]], [0.06, 0.3, 0.6, 0.45]);
    // v7: Init moves nothing.
    assert_eq!(PatchState::new(&p).mod_count, 0);
}

#[test]
fn setters_validate_and_clamp() {
    let mut p = Patch::default();
    assert!(p.set_num("osc0.pos", 2.0));
    assert_eq!(p.get_num("osc0.pos"), Some(1.0));
    assert!(p.set_num("osc0.uni.n", 7.6));
    assert_eq!(p.get_num("osc0.uni.n"), Some(8.0));
    assert!(!p.set_num("osc0.nope", 0.5));
    assert!(!p.set_num("osc0.pos", f32::NAN));
    assert!(p.set_str("osc2.warp1.mode", "mirror"));
    assert_eq!(p.warp_modes[2][1], WarpMode::Mirror);
    assert!(!p.set_str("osc2.warp1.mode", "wobble"));
    assert!(p.set_str("filt1.type", "form"));
    assert!(p.set_str("filt.route", "split"));
    assert!(p.set_str("lfo2.mode", "env"));
    assert!(p.set_str("voice.mode", "legato"));
    assert!(p.set_str("osc1.route", "direct"));
    assert!(!p.set_str("osc3.route", "direct"));
    assert!(p.set_points("lfo1.points", &[(0.6, 2.0), (0.1, 0.3), (0.9, 0.5)]));
    assert_eq!(p.get_points("lfo1.points").unwrap(), &[(0.0, 0.3), (0.6, 1.0), (1.0, 0.5)]);
    assert!(!p.set_points("lfo1.points", &[(0.0, 0.0)]));
    assert!(!p.set_points("lfo9.points", &[(0.0, 0.0), (1.0, 1.0)]));
}

#[test]
fn entries_cover_every_key_once() {
    let p = Patch::default();
    let all: Vec<_> = p.entries().collect();
    assert_eq!(all.len(), NUM_PARAMS + STR_KEYS.len() + POINT_KEYS.len());
    for (key, v) in &all {
        match v {
            Value::Num(x) => assert_eq!(p.get_num(key), Some(*x)),
            Value::Str(s) => assert_eq!(p.get_str(key), Some(*s)),
            Value::Points(q) => assert_eq!(p.get_points(key), Some(*q)),
        }
    }
}

#[test]
fn bad_mod_rows_are_skipped() {
    let mut p = Patch::default();
    p.mods = vec![
        Mod::new("lfo0", "osc0.pos", 0.5),
        Mod::new("lfo9", "osc0.pos", 0.5),
        Mod::new("lfo0", "osc0.table", 0.5),
        Mod::new("lfo0", "osc0.pos", 0.5).with_curve("wiggly"),
        Mod::new("vel", "filt0.cut", 3.0).with_via("at"),
    ];
    let s = PatchState::new(&p);
    assert_eq!(s.mod_count, 2);
    assert_eq!(s.mods()[1].amt, 1.0);
    assert_eq!(s.mods()[1].via, Source::parse("at"));
}

#[test]
fn v7_keys_are_pinned() {
    assert_eq!(KEYS[LFO_SYNC].key, "lfo0.sync");
    assert_eq!(KEYS[LFO_SYNC + 3].key, "lfo3.sync");
    assert_eq!(KEYS[TEMPO].key, "tempo");
    assert_eq!(KEYS.len(), NUM_PARAMS);
}

#[test]
fn init_moves_nothing_and_its_sub_carries() {
    let p = Patch::default();
    assert!(p.mods.is_empty());
    assert_eq!(p.values[SUB_SHAPE], 1.0);
    assert_eq!(p.values[SUB_LEVEL], 0.28);
    assert_eq!(p.values[TEMPO], 120.0);
    assert_eq!(p.get_str("lfo0.shape"), Some("sine"));
    assert_eq!(p.get_str("lfo1.shape"), Some("drawn"));
    assert_eq!(p.get_str("lfo2.shape"), Some("square"));
    assert_eq!(p.get_str("lfo3.shape"), Some("smooth"));
}

#[test]
fn lfo_shape_round_trips_and_rejects_nonsense() {
    let mut p = Patch::default();
    assert!(p.set_str("lfo2.shape", "tri"));
    assert_eq!(p.get_str("lfo2.shape"), Some("tri"));
    assert!(!p.set_str("lfo2.shape", "wobble"));
    assert!(STR_KEYS.contains(&"lfo3.shape"));
}

#[test]
fn standard_waves_follow_the_contract() {
    let w = |wave| LfoShape::from_points(&[]).with_wave(wave, 7);
    let near = |a: f32, b: f32| (a - b).abs() < 1e-5;
    assert!(near(w(LfoWave::Sine).value(0.25, 0), 1.0));
    assert!(near(w(LfoWave::Sine).value(0.75, 0), 0.0));
    assert!(near(w(LfoWave::Tri).value(0.0, 0), 0.5));
    assert!(near(w(LfoWave::Tri).value(0.25, 0), 1.0));
    assert!(near(w(LfoWave::Tri).value(0.75, 0), 0.0));
    assert!(near(w(LfoWave::Up).value(0.3, 0), 0.3));
    assert!(near(w(LfoWave::Down).value(0.3, 0), 0.7));
    assert_eq!(w(LfoWave::Square).value(0.49, 0), 1.0);
    assert_eq!(w(LfoWave::Square).value(0.51, 0), 0.0);
    // Steps hold for an eighth of a cycle and change between cycles.
    let s = w(LfoWave::Steps);
    assert_eq!(s.value(0.01, 3), s.value(0.12, 3));
    assert_ne!(s.value(0.01, 3), s.value(0.01, 4));
    // Smooth random runs on into the next cycle without a jump.
    let m = w(LfoWave::Smooth);
    assert!(near(m.value(1.0, 5), m.value(0.0, 6)));
    for c in 0..50 {
        for i in 0..=16 {
            let v = m.value(i as f32 / 16.0, c);
            assert!((0.0..=1.0).contains(&v));
        }
    }
}

#[test]
fn rate_law_spans_and_syncs() {
    let mut v = Patch::default().values;
    v[LFO_RATE] = 0.0;
    assert!((lfo_hz(&v, 0) - 0.02).abs() < 1e-6);
    v[LFO_RATE] = 1.0;
    assert!((lfo_hz(&v, 0) - 40.0).abs() < 1e-3);
    v[LFO_SYNC] = 1.0;
    v[LFO_RATE] = 5.0 / 8.0; // a quarter note
    assert!((lfo_hz(&v, 0) - 2.0).abs() < 1e-5);
    v[TEMPO] = 90.0;
    v[LFO_RATE] = 3.0 / 8.0; // one bar
    assert!((lfo_hz(&v, 0) - 0.375).abs() < 1e-5);
}

#[test]
fn lfo_at_is_the_kits() {
    let s = LfoShape::from_points(&[(0.0, 0.0), (0.5, 1.0), (0.5, 0.2), (1.0, 0.2)]);
    assert_eq!(s.at(0.0), 0.0);
    assert!((s.at(0.25) - 0.5).abs() < 1e-6);
    assert_eq!(s.at(0.5), 1.0);
    assert!((s.at(0.75) - 0.2).abs() < 1e-6);
}

#[test]
fn curves_are_the_matrixs() {
    assert_eq!(Curve::Exp.apply(0.5), 0.125);
    assert_eq!(Curve::Log.apply(0.5), 0.875);
    assert_eq!(Curve::S.apply(0.5), 0.5);
    assert_eq!(Curve::Exp.apply(-0.5), -0.125);
}
