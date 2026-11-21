use super::*;
use crate::rack::{RackSpec, SlotSpec};

fn lane(target: &str, points: Vec<(u64, f32)>) -> Lane {
    Lane {
        id: "l".into(),
        target: target.into(),
        label: "L".into(),
        enabled: true,
        trim: 0.0,
        loop_range: None,
        points: points
            .into_iter()
            .map(|(frame, value)| Point {
                frame,
                value,
                curve: Curve::Linear,
                tension: 0.0,
            })
            .collect(),
        modulators: Vec::new(),
    }
}

fn automation(lanes: Vec<Lane>) -> Automation {
    Automation {
        lanes,
        ..Default::default()
    }
}

/// A take thins itself, and a second pass replaces the first.
///
/// A drag arrives sixty times a second and latch writes on every runner
/// tick. Kept verbatim that is a hundred and twenty points a second — more
/// than the lane can use and more than anyone could edit afterwards. It is
/// also what makes a second pass work: the new point takes out whatever
/// the last pass left at the same moment, so recording over a section
/// replaces it rather than laying a second curve on top.
#[test]
fn a_recorded_take_thins_itself_and_overwrites_the_last_one() {
    let store = AutomationStore {
        by_path: Mutex::new(BTreeMap::new()),
        record: Mutex::new(Record::Touch),
        held: Mutex::new(BTreeMap::new()),
        last_at: Mutex::new(BTreeMap::new()),
    };
    let sr = 48_000u32;
    // Fifty milliseconds is the window, so these are one every eight.
    for i in 0..60u64 {
        store.record_point("f", "stretch.ratio", "Stretch", i as f32 / 60.0, i * 384, sr);
    }
    let kept = store.get("f").lanes[0].points.len();
    assert!(kept > 1 && kept < 12, "sixty writes became {kept} points");

    // A lane that did not exist was created rather than dropped.
    assert_eq!(store.get("f").lanes[0].target, "stretch.ratio");

    // Points stay in order, which everything downstream assumes.
    let p = store.get("f").lanes[0].points.clone();
    assert!(p.windows(2).all(|w| w[0].frame < w[1].frame), "out of order");

    // A second pass over the same ground keeps its own values, not both.
    let n = kept;
    store.release_all();
    for i in 0..60u64 {
        store.record_point("f", "stretch.ratio", "Stretch", 1.0, i * 384, sr);
    }
    let after = store.get("f").lanes[0].points.clone();
    assert_eq!(after.len(), n, "the second pass piled up instead of replacing");
    assert!(after.iter().all(|p| p.value == 1.0), "the first pass survived");
}

#[test]
fn every_curve_shape_stays_inside_the_two_points_it_joins() {
    for curve in [
        Curve::Step,
        Curve::Linear,
        Curve::Smooth,
        Curve::Exponential,
        Curve::Bezier,
    ] {
        let p = [
            Point { frame: 0, value: 0.0, curve, tension: 0.3 },
            Point { frame: 100, value: 1.0, curve: Curve::Linear, tension: 0.0 },
        ];
        for f in 0..=100 {
            let v = curve_value(&p, f).unwrap();
            assert!((0.0..=1.0).contains(&v), "{curve:?} left the range at {f}: {v}");
        }
        // A step holds the left value until it reaches the right one.
        if curve == Curve::Step {
            assert_eq!(curve_value(&p, 99).unwrap(), 0.0);
        }
    }
}

#[test]
fn a_lane_holds_its_end_values_rather_than_falling_to_zero() {
    let l = lane("x", vec![(100, 0.8), (200, 0.3)]);
    assert_eq!(l.value_at(0, 0.0), Some(0.8), "before the first point");
    assert_eq!(l.value_at(1_000_000, 0.0), Some(0.3), "after the last");
}

#[test]
fn a_disabled_lane_and_a_bypassed_document_write_nothing() {
    let mut spec = RackSpec::empty();
    spec.slots.push(SlotSpec::Gain { db: 0.0, bypassed: false });
    spec.slot_ids.push("g".into());
    let mut out = Vec::new();

    let mut a = automation(vec![lane("fx.g.db", vec![(0, 1.0)])]);
    a.lanes[0].enabled = false;
    rack_controls(&a, &spec, 0, 48_000, &mut out);
    assert!(out.is_empty(), "a disabled lane wrote {out:?}");

    let mut a = automation(vec![lane("fx.g.db", vec![(0, 1.0)])]);
    a.bypassed = true;
    rack_controls(&a, &spec, 0, 48_000, &mut out);
    assert!(out.is_empty(), "a bypassed document wrote {out:?}");
}

#[test]
fn a_unit_lane_resolves_through_the_effects_own_range() {
    let mut spec = RackSpec::empty();
    spec.slots.push(SlotSpec::Gain { db: 0.0, bypassed: false });
    spec.slot_ids.push("g".into());
    let mut out = Vec::new();

    for (unit, expect) in [(0.0, fx::GAIN_DB_MIN), (0.5, 0.0), (1.0, fx::GAIN_DB_MAX)] {
        rack_controls(&automation(vec![lane("fx.g.db", vec![(0, unit)])]), &spec, 0, 48_000, &mut out);
        assert_eq!(out.len(), 1);
        assert!((out[0].2 - expect).abs() < 1e-4, "unit {unit} gave {}", out[0].2);
    }
}

/// The bug this whole design is arranged to prevent: the interface records a
/// gesture as a unit, playback turns it back into a frequency, and if the
/// two disagree about the range the sound lands somewhere else in silence.
#[test]
fn an_eq_frequency_survives_the_round_trip_through_a_unit() {
    let mut spec = RackSpec::empty();
    spec.slots.push(SlotSpec::Eq { settings: Default::default(), bypassed: false });
    spec.slot_ids.push("g".into());
    let mut out = Vec::new();
    for hz in [50.0f32, 440.0, 1000.0, 8000.0] {
        // what the interface stores when you park a band at `hz`
        let unit = (hz / fx::eq::EQ_FREQ_MIN).ln() / (fx::eq::EQ_FREQ_MAX / fx::eq::EQ_FREQ_MIN).ln();
        rack_controls(&automation(vec![lane("fx.g.mid.freq", vec![(0, unit)])]), &spec, 0, 48_000, &mut out);
        let back = out[0].2;
        assert!((back / hz - 1.0).abs() < 1e-3, "{hz} Hz came back as {back} Hz");
    }
}

/// A lane names its module, so dragging the rail carries it along.
#[test]
fn a_lane_follows_its_module_when_the_rack_is_reordered() {
    let mut spec = RackSpec::empty();
    spec.slots.push(SlotSpec::Gain { db: 0.0, bypassed: true });
    spec.slots.push(SlotSpec::Gain { db: 0.0, bypassed: false });
    spec.slot_ids = vec!["first".into(), "second".into()];
    let mut out = Vec::new();
    let a = automation(vec![lane("fx.second.db", vec![(0, 1.0)])]);

    rack_controls(&a, &spec, 0, 48_000, &mut out);
    assert_eq!(out[0].0, 1, "before the reorder");

    spec.slots.swap(0, 1);
    spec.slot_ids.swap(0, 1);
    rack_controls(&a, &spec, 0, 48_000, &mut out);
    assert_eq!(out[0].0, 0, "after the reorder the lane must move with its module");
}

#[test]
fn the_master_is_the_slot_after_the_last_one() {
    let mut spec = RackSpec::empty();
    spec.slots.push(SlotSpec::Gain { db: 0.0, bypassed: false });
    spec.slot_ids.push("g".into());
    spec.master.on = true;
    let mut out = Vec::new();
    rack_controls(&automation(vec![lane("rack.master.amount", vec![(0, 0.75)])]), &spec, 0, 48_000, &mut out);
    assert_eq!(out, vec![(1, "amount".to_string(), 0.75)]);

    // and writes nothing at all when the maximiser is not in the chain
    spec.master.on = false;
    rack_controls(&automation(vec![lane("rack.master.amount", vec![(0, 0.75)])]), &spec, 0, 48_000, &mut out);
    assert!(out.is_empty());
}

#[test]
fn a_stale_target_is_ignored_rather_than_moving_something_else() {
    let mut spec = RackSpec::empty();
    spec.slots.push(SlotSpec::Gain { db: 0.0, bypassed: false });
    spec.slot_ids.push("g".into());
    let mut out = Vec::new();
    for target in ["fx.nosuch.db", "fx.g.nosuch", "fx.zz.db", "wat", "fx.g"] {
        rack_controls(&automation(vec![lane(target, vec![(0, 1.0)])]), &spec, 0, 48_000, &mut out);
        assert!(out.is_empty(), "{target} wrote {out:?}");
    }
}

#[test]
fn the_stretch_lanes_reach_the_stream_parameters() {
    let mut p = fx::grain::StreamParams::new(1000, 48_000);
    apply_stretch(&automation(vec![lane("stretch.semitones", vec![(0, 1.0)])]), &mut p, 0, 48_000);
    assert!((p.semitones - SEMITONE_MAX).abs() < 1e-3);

    let mut p = fx::grain::StreamParams::new(1000, 48_000);
    apply_stretch(&automation(vec![lane("stretch.ratio", vec![(0, 0.5)])]), &mut p, 0, 48_000);
    assert!((p.ratio - 1.0).abs() < 1e-3, "the middle of a log range is unity, got {}", p.ratio);
}

#[test]
fn a_loop_wraps_the_curve_but_not_the_modulators() {
    let mut l = lane("x", vec![(0, 0.0), (100, 1.0)]);
    l.loop_range = Some((0, 100));
    assert_eq!(l.value_at(150, 0.0), l.value_at(50, 0.0), "the curve must wrap");

    l.modulators.push(Modulator::Lfo {
        shape: "sine".into(), rate: 1.0, depth: 0.5, offset: 0.0, phase: 0.0,
    });
    // Same point in the loop, different absolute time: a free-running LFO.
    assert_ne!(l.value_at(150, 1.25), l.value_at(50, 0.0));
}

#[test]
fn a_modulated_lane_stays_inside_the_unit_range() {
    let mut l = lane("x", vec![(0, 1.0)]);
    l.trim = 1.0;
    l.modulators.push(Modulator::Lfo {
        shape: "sine".into(), rate: 1.0, depth: 1.0, offset: 1.0, phase: 0.0,
    });
    for f in 0..500 {
        let v = l.value_at(f, f as f64 / 100.0).unwrap();
        assert!((0.0..=1.0).contains(&v), "left the range at {f}: {v}");
    }
}

#[test]
fn every_modulator_is_a_pure_function_of_time() {
    for m in [
        Modulator::Lfo { shape: "triangle".into(), rate: 3.0, depth: 1.0, offset: 0.0, phase: 0.2 },
        Modulator::Steps { rate: 4.0, values: vec![-1.0, 0.5, 0.25] },
        Modulator::SampleHold { rate: 7.0, depth: 1.0, seed: 42 },
    ] {
        // Asked out of order, the same instant must give the same number —
        // the waveform, playback and the export all evaluate independently.
        let forward: Vec<f32> = (0..50).map(|i| m.value(i as f64 / 10.0)).collect();
        let backward: Vec<f32> = (0..50).rev().map(|i| m.value(i as f64 / 10.0)).collect();
        assert_eq!(forward, backward.into_iter().rev().collect::<Vec<_>>());
    }
}

#[test]
fn json_round_trips_lanes_points_modulators_and_the_file_it_was_drawn_against() {
    let a = Automation {
        bypassed: false,
        frames: 176_228,
        channels: 2,
        sample_rate: 44_100,
        notes: Vec::new(),
        lanes: vec![Lane {
            id: "lane".into(),
            target: "fx.g.mid.freq".into(),
            label: "Mid".into(),
            enabled: true,
            trim: 0.1,
            loop_range: Some((2, 9)),
            points: vec![Point { frame: 2, value: 0.3, curve: Curve::Bezier, tension: 0.5 }],
            modulators: vec![
                Modulator::SampleHold { rate: 3.0, depth: 0.2, seed: 7 },
                Modulator::Steps { rate: 2.0, values: vec![0.0, 1.0] },
            ],
        }],
    };
    assert_eq!(Automation::from_json(&a.to_json()), a);
}

#[test]
fn lanes_drawn_against_a_different_file_are_refused() {
    let a = Automation { frames: 1000, channels: 2, sample_rate: 48_000, ..Default::default() };
    assert!(a.matches(1000, 2, 48_000));
    assert!(!a.matches(1001, 2, 48_000), "a different length must be refused");
    assert!(!a.matches(1000, 1, 48_000), "a different channel count must be refused");
    assert!(!a.matches(1000, 2, 44_100), "a different sample rate must be refused");
    // Written before the check existed: accepted, not failed.
    assert!(Automation::default().matches(1000, 2, 48_000));
}

#[test]
fn a_lane_without_an_id_or_a_target_is_dropped() {
    let v = json::parse(r#"{"lanes":[{"id":"","target":"fx.g.db"},{"id":"a","target":""},{"id":"b","target":"fx.g.db"}]}"#).unwrap();
    let a = Automation::from_json(&v);
    assert_eq!(a.lanes.len(), 1);
    assert_eq!(a.lanes[0].id, "b");
}

/// The pad draws a take as one list of points: every frame either lane has
/// a point at, with both lanes' values there.
#[test]
fn a_path_is_both_lanes_at_every_frame_either_has_a_point() {
    let a = automation(vec![
        lane("fx.r.hz", vec![(0, 0.1), (100, 0.5), (300, 0.9)]),
        lane("fx.r.mix", vec![(0, 0.2), (200, 0.6)]),
    ]);
    let p = path(&a, "fx.r.hz", "fx.r.mix");
    let frames: Vec<u64> = p.iter().map(|(f, _, _)| *f).collect();
    assert_eq!(frames, [0, 100, 200, 300]);
    for &(f, x, y) in &p {
        let hz = a.lanes.iter().find(|l| l.target == "fx.r.hz").unwrap();
        let mix = a.lanes.iter().find(|l| l.target == "fx.r.mix").unwrap();
        assert_eq!(x, curve_value(&hz.points, f).unwrap());
        assert_eq!(y, curve_value(&mix.points, f).unwrap());
    }
    assert!(path(&a, "fx.r.hz", "fx.r.nothing").is_empty(), "a path needs both lanes");
}

/// LOOP puts both lanes on the take's span, so they wrap together.
#[test]
fn looping_a_path_wraps_both_lanes_over_the_same_span() {
    let mut a = automation(vec![
        lane("stretch.ratio", vec![(1_000, 0.1), (5_000, 0.9)]),
        lane("stretch.semitones", vec![(1_200, 0.3), (6_000, 0.7)]),
        lane("stretch.windowMs", vec![(0, 0.5)]),
    ]);
    assert!(loop_path(&mut a, "stretch.ratio", "stretch.semitones", true));
    for l in &a.lanes[..2] {
        assert_eq!(l.loop_range, Some((1_000, 6_000)), "{}", l.target);
    }
    assert_eq!(a.lanes[2].loop_range, None, "only the pad's two lanes");
    for f in [1_500u64, 3_333, 5_999] {
        let later = f + 5_000;
        for l in &a.lanes[..2] {
            assert_eq!(l.value_at(f, 0.0), l.value_at(later, 0.0), "{} at {f}", l.target);
        }
    }
    assert!(loop_path(&mut a, "stretch.ratio", "stretch.semitones", false));
    assert!(a.lanes.iter().all(|l| l.loop_range.is_none()));
    assert!(!loop_path(&mut a, "stretch.ratio", "stretch.nothing", true));
}

#[test]
fn every_offered_target_actually_resolves() {
    let mut spec = RackSpec::empty();
    spec.slots.push(SlotSpec::Gain { db: 0.0, bypassed: false });
    spec.slot_ids.push("g".into());
    spec.slots.push(SlotSpec::Eq { settings: Default::default(), bypassed: false });
    spec.slots.push(SlotSpec::Comp { settings: Default::default(), bypassed: false });
    spec.slots.push(SlotSpec::Shape {
        kind: fx::shape::ShapeKind::Ring,
        params: Vec::new(),
        bypassed: false,
    });
    // One of every effect from `prism-fx`, named so the round trip below
    // can find them. The three before them stay unnamed, as they were.
    spec.slot_ids.resize(spec.slots.len(), String::new());
    for entry in fx::prism::catalogue() {
        spec.slots.push(SlotSpec::Prism { id: entry.descriptor.id, params: Vec::new(), sound: None, bypassed: false });
        spec.slot_ids.push(format!("prism-{}", entry.descriptor.id));
    }
    spec.master.on = true;

    let mut out = Vec::new();
    let mut stretched = 0;
    for (target, label) in targets(&spec) {
        assert!(!label.is_empty(), "{target} has no label");
        if target.starts_with("stretch.") {
            // Counting these was the old check, and a count is not a test:
            // adding a line to the menu without a match arm in
            // `apply_stretch` would leave a lane that draws, saves, plays
            // back and moves nothing. So drive each one and insist the
            // parameters actually come out different.
            stretched += 1;
            let mut lo = fx::grain::StreamParams::new(1000, 48_000);
            let mut hi = lo;
            apply_stretch(&automation(vec![lane(&target, vec![(0, 0.1)])]), &mut lo, 0, 48_000);
            apply_stretch(&automation(vec![lane(&target, vec![(0, 0.9)])]), &mut hi, 0, 48_000);
            assert_ne!(lo, hi, "the menu offers {target} but it moves nothing");

            // Recording reads the value back off the document, so the
            // target has to be findable there too. A name added to the
            // menu and to `apply_stretch` but not to `stretch_field`
            // would play back and refuse to record, silently.
            assert!(
                stretch_field(&fx::Stretch::default(), &target).is_some(),
                "{target} plays back but cannot be recorded"
            );

            // And the inverse has to land where the forward map came from,
            // or a recorded take sits somewhere other than where the
            // control was when it was recorded. Checked on the *value*: a
            // switch and a count quantise the unit, so a unit of 0.17 on a
            // switch is rightly 0 on the way back — but the number the
            // control shows must survive the trip exactly.
            for u in [0.0f32, 0.17, 0.5, 0.83, 1.0] {
                let v = stretch_value(&target, u).expect("forward");
                let back = stretch_unit(&target, v).expect("inverse");
                let again = stretch_value(&target, back).expect("forward again");
                assert!(
                    (again - v).abs() <= 1e-3 * v.abs().max(1.0),
                    "{target}: unit {u} is {v}, which reads back as unit {back} = {again}"
                );
            }
            continue;
        }
        // The Pitch Time Changer's lanes are the document's too, and play
        // back through `apply_pitch_time`.
        if target.starts_with("ptc.") {
            let mut p = engine::transport::PitchTime::default();
            apply_pitch_time(&automation(vec![lane(&target, vec![(0, 0.37)])]), &mut p, 0, 48_000);
            assert_ne!(p, engine::transport::PitchTime::default(), "{target} plays back as nothing");
            for u in [0.0f32, 0.5, 1.0] {
                let v = stretch_value(&target, u).expect("forward");
                assert!((stretch_unit(&target, v).expect("inverse") - u).abs() < 1e-5, "{target} at {u}");
            }
            continue;
        }
        rack_controls(&automation(vec![lane(&target, vec![(0, 0.5)])]), &spec, 0, 48_000, &mut out);
        assert_eq!(out.len(), 1, "the menu offers {target} but it resolves to nothing");

        // Every rack control has to survive the same round trip, for the
        // same reason: recording finds the lane value by searching this
        // exact function, so if the search cannot get back to where it
        // started the take lands somewhere else.
        if let Some(rest) = target.strip_prefix("fx.") {
            if let Some((id, key)) = rest.split_once('.') {
                let i = spec.slot_ids.iter().position(|x| x == id).expect("slot");
                let slot = &spec.slots[i];
                for u in [0.0f32, 0.25, 0.75, 1.0] {
                    let Some(v) = resolve(slot, key, u) else { continue };
                    let back = unit_for(|x| resolve(slot, key, x), v).expect("inverse");
                    let round = resolve(slot, key, back).expect("forward again");
                    // Compared as *values*, not as units: a stepped
                    // control has whole plateaus of unit that give the
                    // same number, and any of them is a right answer.
                    assert!(
                        (round - v).abs() <= v.abs().max(1.0) * 1e-3,
                        "{target}: {u} became {v} and came back as {round}"
                    );
                }
            }
        }
    }
    assert!(stretched >= 6, "the document's own targets went missing");
    let offered: Vec<String> = targets(&spec).into_iter().map(|(t, _)| t).collect();
    for (i, slot) in spec.slots.iter().enumerate() {
        if let SlotSpec::Prism { id, .. } = slot {
            for p in fx::prism::specs(id).unwrap() {
                let target = format!("fx.{}.{}", spec.slot_ids[i], p.key);
                assert!(offered.contains(&target), "{target} is not offered");
            }
        }
    }
}

/// A switch lane throws the switch, a count lane sets the count, and a move
/// on either records as the lane value that plays the same thing back.
#[test]
fn switches_and_counts_are_steps_not_sweeps() {
    let mut p = fx::grain::StreamParams::new(1000, 48_000);
    apply_stretch(&automation(vec![lane("stretch.grain.reverse", vec![(0, 0.9)])]), &mut p, 0, 48_000);
    assert!(p.grain.reverse, "a lane at 0.9 did not throw the switch");
    apply_stretch(&automation(vec![lane("stretch.grain.reverse", vec![(0, 0.1)])]), &mut p, 0, 48_000);
    assert!(!p.grain.reverse, "a lane at 0.1 did not throw it back");

    apply_stretch(&automation(vec![lane("stretch.grain.layers", vec![(0, 0.5)])]), &mut p, 0, 48_000);
    let mid = (1.0 + 0.5 * (fx::grain::MAX_LAYERS as f32 - 1.0)).round() as u32;
    assert_eq!(p.grain.layers, mid, "a lane at a half is not the middle count");

    // Three layers is three layers on the way back — not the edge of a
    // rounding step where a search would have left it.
    let u = stretch_unit("stretch.grain.layers", 3.0).unwrap();
    assert_eq!(stretch_value("stretch.grain.layers", u).unwrap(), 3.0);
    assert_eq!(stretch_unit("stretch.grain.wrap", 1.0), Some(1.0));
    assert_eq!(stretch_unit("stretch.grain.wrap", 0.0), Some(0.0));

    // The read position runs the whole way the control does.
    assert_eq!(stretch_value("stretch.grain.position", 0.0), Some(-1.0));
    assert_eq!(stretch_value("stretch.grain.position", 1.0), Some(1.0));
}
