/// Stable names for a hand-built rack, so a test spec round-trips like a
/// real one. Production names come from the interface.
fn named(slots: &[SlotSpec]) -> Vec<String> {
    (0..slots.len()).map(|i| format!("test-{i}")).collect()
}

use super::*;
use crate::json;

/// The rack as this program built it before its effects moved to
/// prism-fx: its own EQ, compressor, gain, shapes and maximizer.
fn build_own(spec: &RackSpec, sample_rate: u32, channels: usize) -> Rack {
    let mut rack = Rack::new();
    for s in &spec.slots {
        let effect: Box<dyn fx::Effect> = match s {
            SlotSpec::Gain { db, .. } => Box::new(Gain { db: *db }),
            SlotSpec::Eq { settings, .. } => Box::new(Eq::new(*settings)),
            SlotSpec::Comp { settings, .. } => Box::new(Compressor::new(*settings)),
            SlotSpec::Shape { kind, params, .. } => fx::shape::make_own(*kind, sample_rate, channels, params),
            SlotSpec::Prism { id, params, sound, .. } => {
                fx::prism::make_with_sound(id, sample_rate, channels, params, sound.as_deref())
                    .unwrap_or_else(|| Box::new(Gain { db: 0.0 }))
            }
        };
        rack.push_slot(effect, s.bypassed());
    }
    if spec.master.is_active() {
        rack.push(Box::new(Maximizer::new(spec.master)));
    }
    rack
}

fn loud_source(frames: usize, channels: usize) -> Vec<f32> {
    let mut x = 0x9e37_79b9_u32;
    (0..frames * channels)
        .map(|i| {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            let noise = (x as f32 / u32::MAX as f32) * 2.0 - 1.0;
            let n = (i / channels) as f32;
            (n / 9.0).sin() * 0.8 + (n / 170.0).sin() * 0.5 + noise * 0.3
        })
        .collect()
}

/// Built now and built before, through the rack, with a control moved
/// while it runs as the transport moves one: the same samples.
fn assert_builds_alike(spec: &RackSpec, what: &str) {
    for channels in [2, 1] {
        let input = loud_source(48_000, channels);
        let mut now = spec.build(48_000, channels);
        let mut was = build_own(spec, 48_000, channels);
        let (mut a, mut b) = (input.clone(), input);
        for (i, (x, y)) in a.chunks_mut(256 * channels).zip(b.chunks_mut(256 * channels)).enumerate() {
            if i == 40 {
                for (slot, key) in [(0, "band.2.gainDb"), (0, "thresholdDb"), (0, "db")] {
                    assert_eq!(now.get_param(slot, key), was.get_param(slot, key), "{what}: {key}");
                    now.set_param(slot, key, -7.5);
                    was.set_param(slot, key, -7.5);
                }
            }
            now.process(x, channels, 48_000);
            was.process(y, channels, 48_000);
        }
        let at = a.iter().zip(&b).position(|(x, y)| x.to_bits() != y.to_bits());
        assert_eq!(at, None, "{what}, {channels} ch");
    }
}

fn eq_spec(moves: &[(&str, f32)]) -> RackSpec {
    let mut settings = EqSettings::default();
    for (k, v) in moves {
        assert!(set_eq_param(&mut settings, k, *v), "{k}");
    }
    RackSpec { slots: vec![SlotSpec::Eq { settings, bypassed: false }], ..RackSpec::empty() }
}

fn comp_spec(moves: &[(&str, f32)]) -> RackSpec {
    let mut settings = CompSettings::default();
    for (k, v) in moves {
        assert!(set_comp_param(&mut settings, k, *v), "{k}");
    }
    RackSpec { slots: vec![SlotSpec::Comp { settings, bypassed: false }], ..RackSpec::empty() }
}

/// Whether `build` gave a slot the prism effect: it is, once a value the
/// prism one keys differently is set on both.
fn takes_prism(spec: &RackSpec) -> bool {
    match &spec.slots[0] {
        SlotSpec::Eq { settings, .. } => fx::prism::moved("eq", 48_000, &eq_params(settings))
            .is_some_and(|e| eq_params(settings).iter().all(|(k, v)| e.get_param(k) == Some(*v))),
        SlotSpec::Comp { settings, .. } => fx::prism::moved("compressor", 48_000, &comp_params(settings))
            .is_some_and(|e| comp_params(settings).iter().all(|(k, v)| e.get_param(k) == Some(*v))),
        _ => unreachable!(),
    }
}

#[test]
fn the_rack_built_from_prism_fx_renders_what_its_own_effects_did() {
    let mut specs: Vec<(String, RackSpec)> = vec![("the default chain".into(), RackSpec::default_chain())];
    let eqs: &[&[(&str, f32)]] = &[
        &[],
        &[("band.0.freq", 80.0)],
        &[("band.0.freq", 15.0), ("band.0.enabled", 1.0)],
        &[("band.2.gainDb", 9.0), ("band.2.q", 4.0), ("band.6.gainDb", -12.0)],
        &[("band.3.enabled", 1.0), ("band.3.mode", 2.0), ("band.3.gainDb", 6.0), ("band.7.enabled", 1.0), ("band.7.freq", 6_000.0)],
        &[("band.1.mode", 0.0), ("band.1.freq", 300.0), ("band.5.enabled", 1.0), ("band.5.mode", 4.0), ("band.5.freq", 2_500.0)],
        &[("band.0.freq", 1e9), ("band.4.q", -3.0), ("band.4.enabled", 1.0), ("band.4.gainDb", 99.0)],
    ];
    for moves in eqs {
        specs.push((format!("eq {moves:?}"), eq_spec(moves)));
    }
    let comps: &[&[(&str, f32)]] = &[
        &[],
        &[("thresholdDb", -40.0), ("ratio", 20.0), ("attackMs", 0.05), ("releaseMs", 3_000.0)],
        &[("thresholdDb", -18.0), ("ratio", 3.0), ("kneeDb", 12.0), ("makeupDb", 6.0)],
        &[("thresholdDb", -99.0), ("ratio", 0.0), ("attackMs", 9e9), ("kneeDb", -1.0), ("makeupDb", -99.0)],
    ];
    for moves in comps {
        specs.push((format!("comp {moves:?}"), comp_spec(moves)));
    }
    for db in [-24.0, -3.5, 0.0, 6.0, 24.0, 30.0, -48.0] {
        let slots = vec![SlotSpec::Gain { db, bypassed: false }];
        specs.push((format!("gain {db}"), RackSpec { slots, ..RackSpec::empty() }));
    }
    for (amount, auto_level, auto_comp, ceiling_db) in
        [(1.0, false, false, -1.0), (0.4, true, false, -0.3), (0.75, false, true, -6.0), (0.05, true, true, -12.0)]
    {
        let mut spec = RackSpec::default_chain();
        spec.master = MasterSettings { on: true, amount, auto_level, auto_comp, ceiling_db };
        specs.push((format!("the default chain into the maximizer at {amount}"), spec));
    }
    // A rack read from a document, every kind of slot in it.
    let doc = json::parse(
        r#"{"slots":[
                {"kind":"gain","db":3},
                {"kind":"eq","bands":[{"freq":0},{"freq":120,"gainDb":4,"type":"lowShelf","enabled":true}]},
                {"kind":"comp","thresholdDb":-30,"ratio":6},
                {"kind":"chorus"},{"kind":"flanger","rateHz":2},{"kind":"detune"},{"kind":"utility"},
                {"kind":"gain","db":-2,"bypassed":true}
            ],"master":{"on":true,"amount":0.6}}"#,
    )
    .unwrap();
    specs.push(("a document's rack".into(), RackSpec::from_json(&doc)));
    for (what, spec) in &specs {
        assert_builds_alike(spec, what);
    }
}

#[test]
fn the_eq_and_compressor_move_to_prism_fx_wherever_their_values_carry_exactly() {
    assert!(takes_prism(&comp_spec(&[])), "the default compressor");
    assert!(takes_prism(&comp_spec(&[("thresholdDb", -30.0), ("ratio", 8.0)])));
    assert!(takes_prism(&eq_spec(&[("band.0.freq", 80.0), ("band.2.gainDb", 4.0)])));
    // A high-pass parked at 0 Hz, as every new EQ's is, sits below the
    // prism EQ's 10 Hz floor: off in both, but the prism one would report
    // 10 to the transport, which ramps a moved control from what the
    // effect reports. This program's own EQ keeps it.
    assert!(!takes_prism(&eq_spec(&[])));
}

/// Invariant 9, for a chain that is switched **on**.
///
/// The modules a file starts with are live rather than bypassed, so the
/// guarantee cannot come from the chain being skipped — it has to come from
/// the settings. Measured rather than assumed: audio goes through the real
/// built rack and has to come back out the same.
#[test]
fn the_default_chain_is_switched_on_and_still_changes_nothing() {
    let spec = RackSpec::default_chain();
    assert_eq!(spec.slots.len(), 2, "an EQ and a compressor, and no gain stage");
    assert!(
        spec.slots.iter().all(|s| !s.bypassed()),
        "a module that arrives switched off reads as broken"
    );

    let mut rack = spec.build(48_000, 2);
    let source: Vec<f32> = (0..4096)
        .map(|i| (i as f32 / 11.0).sin() * 0.6 + (i as f32 / 3.1).sin() * 0.2)
        .collect();
    let mut buf = source.clone();
    rack.process(&mut buf, 2, 48_000);

    let worst = source
        .iter()
        .zip(&buf)
        .map(|(a, b)| (a - b).abs())
        .fold(0f32, f32::max);
    assert!(
        worst < 1e-6,
        "a fresh rack moved the audio by {worst:.2e} — flat is not the same as inert"
    );
}

/// A shaper carries its own parameters, so this is the test that the
/// generic slot really is generic — every kind, every parameter, out to
/// JSON and back without a line of code per effect.
#[test]
fn every_shaper_survives_a_round_trip_with_its_parameters() {
    use fx::shape::ShapeKind;
    let mut slots = Vec::new();
    for kind in ShapeKind::ALL {
        // Somewhere other than the default for each, so a value that is
        // silently dropped shows up rather than matching by luck.
        let params = kind
            .specs()
            .iter()
            .map(|sp| (sp.key.to_string(), sp.from_unit(0.3)))
            .collect();
        slots.push(SlotSpec::Shape { kind, params, bypassed: false });
    }
    let spec = RackSpec { slot_ids: named(&slots), slots, master: MasterSettings::default(), pads: BTreeMap::new(), pitch_time: Default::default(), post_roll: BTreeMap::new(), ranges: BTreeMap::new(), mixes: BTreeMap::new() };
    let back = RackSpec::from_json(&spec.to_json());
    assert_eq!(back, spec, "a shaper lost something on the way through JSON");
    assert!(!back.build(48_000, 2).is_empty(), "none of them built");
}

/// Every effect from `prism-fx` is a slot, named `prism:<id>`, and goes out
/// to JSON and back with its parameters, like the shapers.
#[test]
fn every_prism_effect_survives_a_round_trip_with_its_parameters() {
    let mut slots = Vec::new();
    for entry in fx::prism::catalogue() {
        let d = entry.descriptor;
        let params = d
            .params
            .iter()
            .map(|p| (p.key.to_string(), fx::prism::clamp(d.id, p.key, p.from_unit(0.3)).unwrap()))
            .collect();
        slots.push(SlotSpec::Prism { id: d.id, params, sound: None, bypassed: false });
    }
    let spec = RackSpec { slot_ids: named(&slots), slots, master: MasterSettings::default(), pads: BTreeMap::new(), pitch_time: Default::default(), post_roll: BTreeMap::new(), ranges: BTreeMap::new(), mixes: BTreeMap::new() };
    let json = spec.to_json();
    let Some(Value::Arr(items)) = json.get("slots") else { panic!("no slots") };
    for (item, entry) in items.iter().zip(fx::prism::catalogue()) {
        assert_eq!(
            item.get("kind").and_then(Value::as_str),
            Some(format!("prism:{}", entry.descriptor.id).as_str())
        );
    }
    let back = RackSpec::from_json(&json);
    assert_eq!(back, spec, "a prism effect lost something on the way through JSON");
    // Built in place, slot for slot, and answering by the crate's keys.
    let rack = back.build(48_000, 2);
    for (i, entry) in fx::prism::catalogue().iter().enumerate() {
        // Invert and Swap have no controls to ask.
        let Some(first) = entry.descriptor.params.first() else { continue };
        let key = first.key;
        assert_eq!(rack.get_param(i, key), back.get_param(i, key), "slot {i} is not {}", entry.descriptor.id);
    }
}

/// A pad setup is kept with the rack, under the slot it drives — or under
/// `stretch` for Time & Pitch — and read back checked against what that
/// source has now.
#[test]
fn pad_setups_are_kept_with_the_rack_and_checked_on_the_way_back() {
    use crate::pad::{PadSetup, STRETCH};
    let v = crate::json::parse(
        r#"{"slots":[{"kind":"ring","id":"r","params":{"hz":220,"mix":1}}],
                "pads":{"r":{"x":"mix","xLo":0.1,"xHi":0.9,"y":"hz","yLo":50,"yHi":2000},
                        "stretch":{"x":"ratio","xLo":2,"xHi":0.5,"y":"semitones","yLo":-7,"yHi":7},
                        "ghost":{"x":"mix","xLo":0,"xHi":1,"y":"hz","yLo":1,"yHi":2},
                        "r2":{"x":"nope","xLo":0,"xHi":1,"y":"hz","yLo":1,"yHi":2}}}"#,
    )
    .unwrap();
    let spec = RackSpec::from_json(&v);
    assert_eq!(spec.pads.len(), 2, "a pad for a slot that is not here, or a bad one, is dropped");
    assert_eq!(
        spec.pads.get("r"),
        Some(&PadSetup { x: "mix".into(), x_lo: 0.1, x_hi: 0.9, y: "hz".into(), y_lo: 50.0, y_hi: 2000.0 })
    );
    assert_eq!(spec.pads.get(STRETCH).map(|p| (p.x_lo, p.x_hi)), Some((2.0, 0.5)));
    assert_eq!(RackSpec::from_json(&spec.to_json()), spec, "pads lost something through JSON");
}

/// Hyperprism's Pitch Time Changer is the document's, like the stretch: on
/// or off, its window's two axes and four settings, held to their ranges.
#[test]
fn the_pitch_time_changer_is_kept_with_the_rack() {
    let v = crate::json::parse(
        r#"{"slots":[],"pitchTime":{"on":true,"speed":150,"pitch":250,"feedback":10,"grain":30,"xfade":60,"smoothing":20}}"#,
    )
    .unwrap();
    let spec = RackSpec::from_json(&v);
    let p = spec.pitch_time;
    assert!(p.on);
    assert_eq!((p.speed, p.pitch, p.feedback, p.grain, p.xfade, p.smoothing), (150.0, 200.0, 10.0, 30.0, 60.0, 20.0));
    assert_eq!(RackSpec::from_json(&spec.to_json()), spec, "lost through JSON");
    assert_eq!(RackSpec::from_json(&crate::json::parse(r#"{"slots":[]}"#).unwrap()).pitch_time, engine::transport::PitchTime::default());
}

/// Hyperprism's Post-Roll is kept per source, like the pad's limits: in
/// milliseconds, never negative, and only for a source that is there.
#[test]
fn knob_ranges_are_kept_per_slot() {
    let spec = RackSpec::from_json(&crate::json::parse(
        r#"{"slots":[{"kind":"gain","id":"g","db":0}],
                "ranges":{"g":{"db":{"min":-6,"max":6,"log":false},"bad":{"min":3,"max":1}},"ghost":{"db":{"min":0,"max":1}}}}"#,
    ).unwrap());
    let g = spec.ranges.get("g").expect("the slot's ranges");
    assert_eq!(g.get("db"), Some(&KnobRange { min: -6.0, max: 6.0, log: false }));
    assert!(!g.contains_key("bad"), "a range that runs backwards is dropped");
    assert!(!spec.ranges.contains_key("ghost"), "a slot that is not here is dropped");
    let back = RackSpec::from_json(&spec.to_json());
    assert_eq!(back.ranges, spec.ranges, "it survives the round trip");
}

#[test]
fn post_roll_is_kept_per_source() {
    let v = crate::json::parse(
        r#"{"slots":[{"kind":"ring","id":"r","params":{}}],
                "postRoll":{"r":250,"ptc":-5,"stretch":100,"ghost":40}}"#,
    )
    .unwrap();
    let spec = RackSpec::from_json(&v);
    assert_eq!(spec.post_roll.get("r"), Some(&250.0));
    assert_eq!(spec.post_roll.get("ptc"), Some(&0.0));
    assert_eq!(spec.post_roll.get("stretch"), Some(&100.0));
    assert!(!spec.post_roll.contains_key("ghost"), "a source that is not here is dropped");
    assert_eq!(spec.post_roll_ms(), 250.0, "the longest one is what plays");
    assert_eq!(RackSpec::from_json(&spec.to_json()), spec);
}

/// Documents saved before the Echo moved name `dattorro_echo`. They open
/// on the prism Echo with every value they stored, and save as the new kind.
#[test]
fn an_old_echo_opens_as_the_prism_echo_with_its_settings() {
    let v = crate::json::parse(
        r#"{"slots":[{"kind":"dattorro_echo","id":"e1","bypassed":true,
                "params":{"delayMs":125,"feedback":-0.4,"damping":0.6,"wet":0.8,"dry":0.3,"glideMs":40}}]}"#,
    )
    .unwrap();
    let spec = RackSpec::from_json(&v);
    assert_eq!(spec.slot_ids, ["e1"]);
    match &spec.slots[0] {
        SlotSpec::Prism { id, params, bypassed, .. } => {
            assert_eq!(*id, "echo");
            assert!(*bypassed);
            let want = [("delayMs", 125.0), ("feedback", -0.4), ("damping", 0.6), ("wet", 0.8), ("dry", 0.3), ("glideMs", 40.0)];
            for (k, v) in want {
                assert_eq!(params.iter().find(|(key, _)| key == k).map(|(_, v)| *v), Some(v), "{k}");
            }
        }
        other => panic!("the old Echo opened as {other:?}"),
    }
    let out = spec.to_json();
    let Some(Value::Arr(items)) = out.get("slots") else { panic!("no slots") };
    assert_eq!(items[0].get("kind").and_then(Value::as_str), Some("prism:echo"));
}

/// The sound a prism effect takes is kept with its slot, by library path;
/// an effect that takes none keeps none.
#[test]
fn a_slots_sound_is_kept_by_name_and_only_where_it_means_something() {
    let v = crate::json::parse(
        r#"{"slots":[{"kind":"prism:convolution","id":"c","sound":"rooms/hall.wav","params":{}},
                         {"kind":"prism:tremolo","id":"t","sound":"rooms/hall.wav","params":{}}]}"#,
    )
    .unwrap();
    let spec = RackSpec::from_json(&v);
    let sound = |i: usize| match &spec.slots[i] {
        SlotSpec::Prism { sound, .. } => sound.clone(),
        _ => panic!("not a prism slot"),
    };
    assert_eq!(sound(0).as_deref(), Some("rooms/hall.wav"));
    assert_eq!(sound(1), None, "a tremolo takes no sound");
    assert_eq!(RackSpec::from_json(&spec.to_json()), spec);
}

#[test]
fn a_prism_effect_this_version_does_not_have_is_left_out() {
    let v = crate::json::parse(r#"{"slots":[{"kind":"prism:telepathy","params":{"x":1}},{"kind":"gain","db":1}]}"#)
        .unwrap();
    let spec = RackSpec::from_json(&v);
    assert_eq!(spec.slots.len(), 1);
    assert_eq!(spec.slot_ids.len(), 1);
}

#[test]
fn a_prism_slots_controls_are_clamped_by_the_crates_table() {
    let mut spec = RackSpec::empty();
    spec.slots.push(SlotSpec::Prism { id: "tremolo", params: Vec::new(), sound: None, bypassed: false });
    spec.slot_ids.push("t".into());
    assert!(spec.set_param(0, "rateHz", 9_999.0));
    assert_eq!(spec.get_param(0, "rateHz"), Some(20.0));
    assert!(spec.set_param(0, "shape", 1.4), "a choice moves");
    assert_eq!(spec.get_param(0, "shape"), Some(1.0), "and lands on a whole value");
    assert!(!spec.set_param(0, "nonsense", 1.0));
    assert!(spec.is_active(), "a prism effect switched in is doing something");
}

#[test]
fn settings_pass_between_prism_slots_of_the_same_effect_only() {
    let mut a = SlotSpec::Prism { id: "tremolo", params: vec![("depth".into(), 0.1)], sound: None, bypassed: false };
    let b = SlotSpec::Prism { id: "tremolo", params: vec![("depth".into(), 0.9)], sound: None, bypassed: true };
    let c = SlotSpec::Prism { id: "decimator", params: vec![("bits".into(), 4.0)], sound: None, bypassed: false };
    assert!(a.take_settings_from(&b));
    assert_eq!(a, SlotSpec::Prism { id: "tremolo", params: vec![("depth".into(), 0.9)], sound: None, bypassed: false });
    assert!(!a.take_settings_from(&c));
    assert_eq!(a.kind_label(), "Tremolo");
}

/// An unknown kind is dropped rather than guessed at. A slot from a newer
/// version is not something to invent a default for.
#[test]
fn a_slot_this_version_does_not_know_is_left_out() {
    let v = crate::json::parse(
        r#"{"slots":[{"kind":"gain","db":3},{"kind":"telepathy","params":{"x":1}}]}"#,
    )
    .unwrap();
    let back = RackSpec::from_json(&v);
    assert_eq!(back.slots.len(), 1, "an unknown slot was invented instead of dropped");
}


#[test]
fn a_spec_round_trips_through_json() {
    let mut spec = RackSpec::default_chain();
    spec.slots[1] = SlotSpec::Eq {
        settings: EqSettings {
            mid: Band { freq: 2500.0, q: 1.8, gain_db: -6.0 },
            ..EqSettings::default()
        },
        bypassed: false,
    };
    let back = RackSpec::from_json(&spec.to_json());
    assert_eq!(spec, back);
}

#[test]
fn an_enabled_band_with_gain_makes_the_rack_active() {
    let spec = RackSpec {
        slot_ids: vec!["eq".into()],
        slots: vec![SlotSpec::Eq {
            settings: EqSettings {
                mid: Band { freq: 1000.0, q: 1.0, gain_db: 4.0 },
                ..EqSettings::default()
            },
            bypassed: false,
        }],
        master: MasterSettings::default(),
        pads: BTreeMap::new(),
        pitch_time: Default::default(),
        post_roll: BTreeMap::new(),
        ranges: BTreeMap::new(),
        mixes: BTreeMap::new(),
    };
    assert!(spec.is_active());
    assert!(!spec.build(48_000, 2).is_empty());
}

#[test]
fn a_flat_enabled_eq_is_not_treated_as_active() {
    // Otherwise every file pays for pre-roll and filtering to achieve nothing.
    let spec = RackSpec {
        slot_ids: named(&vec![SlotSpec::Eq { settings: EqSettings::default(), bypassed: false }]),
        slots: vec![SlotSpec::Eq { settings: EqSettings::default(), bypassed: false }],
        master: MasterSettings::default(),
        pads: BTreeMap::new(),
        pitch_time: Default::default(),
        post_roll: BTreeMap::new(),
        ranges: BTreeMap::new(),
        mixes: BTreeMap::new(),
    };
    assert!(!spec.is_active());
}

#[test]
fn a_bypassed_slot_is_left_out_of_the_built_rack() {
    let spec = RackSpec {
        slot_ids: named(&vec![SlotSpec::Gain { db: 12.0, bypassed: true }]),
        slots: vec![SlotSpec::Gain { db: 12.0, bypassed: true }],
        master: MasterSettings::default(),
        pads: BTreeMap::new(),
        pitch_time: Default::default(),
        post_roll: BTreeMap::new(),
        ranges: BTreeMap::new(),
        mixes: BTreeMap::new(),
    };
    assert!(spec.build(48_000, 2).is_empty());
    assert!(!spec.is_active());
}

#[test]
fn out_of_range_values_are_clamped_rather_than_trusted() {
    // These arrive over HTTP; a ratio of zero or a negative Q would make
    // the filter blow up.
    let v = json::parse(
        r#"{"slots":[{"kind":"comp","bypassed":false,"ratio":-5,"attackMs":0,"thresholdDb":-999},
                         {"kind":"eq","bypassed":false,"mid":{"freq":9e9,"q":-1,"gainDb":900}}]}"#,
    )
    .unwrap();
    let spec = RackSpec::from_json(&v);
    match &spec.slots[0] {
        SlotSpec::Comp { settings, .. } => {
            assert!(settings.ratio >= 1.0);
            assert!(settings.attack_ms > 0.0);
            assert!(settings.threshold_db >= -60.0);
        }
        _ => panic!("expected a compressor"),
    }
    match &spec.slots[1] {
        SlotSpec::Eq { settings, .. } => {
            assert!(settings.mid.freq <= 24000.0);
            assert!(settings.mid.q > 0.0);
            assert!(settings.mid.gain_db <= 24.0);
        }
        _ => panic!("expected an EQ"),
    }
}

#[test]
fn an_unknown_effect_kind_is_ignored_not_fatal() {
    let v = json::parse(r#"{"slots":[{"kind":"reverb"},{"kind":"gain","db":3}]}"#).unwrap();
    let spec = RackSpec::from_json(&v);
    assert_eq!(spec.slots.len(), 1);
}

#[test]
fn the_eq_curve_is_flat_when_nothing_is_boosted() {
    let spec = RackSpec {
        slot_ids: named(&vec![SlotSpec::Eq { settings: EqSettings::default(), bypassed: false }]),
        slots: vec![SlotSpec::Eq { settings: EqSettings::default(), bypassed: false }],
        master: MasterSettings::default(),
        pads: BTreeMap::new(),
        pitch_time: Default::default(),
        post_roll: BTreeMap::new(),
        ranges: BTreeMap::new(),
        mixes: BTreeMap::new(),
    };
    for (f, db) in spec.eq_curve(48000, 64) {
        assert!(db.abs() < 0.1, "flat EQ curved by {db} dB at {f} Hz");
    }
}

#[test]
fn the_eq_curve_peaks_near_the_boosted_band() {
    let spec = RackSpec {
        slot_ids: vec!["eq".into()],
        slots: vec![SlotSpec::Eq {
            settings: EqSettings {
                mid: Band { freq: 1000.0, q: 2.0, gain_db: 10.0 },
                ..EqSettings::default()
            },
            bypassed: false,
        }],
        master: MasterSettings::default(),
        pads: BTreeMap::new(),
        pitch_time: Default::default(),
        post_roll: BTreeMap::new(),
        ranges: BTreeMap::new(),
        mixes: BTreeMap::new(),
    };
    let curve = spec.eq_curve(48000, 200);
    let (peak_f, peak_db) = curve
        .iter()
        .cloned()
        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap())
        .unwrap();
    assert!((peak_db - 10.0).abs() < 0.6, "peak was {peak_db} dB");
    assert!((peak_f - 1000.0).abs() < 120.0, "peak sat at {peak_f} Hz");
}

#[test]
fn the_store_hands_out_a_default_chain_for_unknown_files() {
    let store = RackStore::default();
    assert_eq!(store.get("never/seen.wav"), RackSpec::default_chain());
    assert!(!store.is_active("never/seen.wav"));
}

#[test]
fn the_store_remembers_what_was_set() {
    let store = RackStore::default();
    store.set("a.wav", RackSpec { slot_ids: vec!["g".into()], slots: vec![SlotSpec::Gain { db: 5.0, bypassed: false }], master: MasterSettings::default(), pads: BTreeMap::new(), pitch_time: Default::default(), post_roll: BTreeMap::new(), ranges: BTreeMap::new(), mixes: BTreeMap::new() });
    assert!(store.is_active("a.wav"));
    assert_eq!(store.get("a.wav").slots.len(), 1);
}
