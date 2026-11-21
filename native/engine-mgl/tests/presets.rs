//! A whole parameter state follows the same control/grid semantics as messages.
mod common;
use common::*;
use engine_core::basics::Sine;
use engine_core::*;
use engine_mgl::{grain, *};

#[derive(Clone, Copy, Debug)]
enum Which {
    Wave,
    Grain,
    Fx,
    Suite,
}
fn state(which: Which, controls: &[(u32, f32)]) -> Thing {
    match which {
        Which::Wave => Box::new(WaveState::new(controls)),
        Which::Grain => Box::new(GrainState::new(controls)),
        Which::Fx => Box::new(FxState::new(controls)),
        Which::Suite => Box::new(SuiteState::new(controls)),
    }
}
fn controls(which: Which) -> Vec<(u32, f32)> {
    match which {
        Which::Wave => vec![
            (wave::param_id("master").unwrap().0 as u32, 0.3),
            (Wave::BEND, 0.1),
            (Wave::MOD_WHEEL, 0.4),
        ],
        Which::Grain => vec![
            (grain::GAIN, 0.3),
            (grain::SIDE_LEFT, 0.7),
            (grain::SIDE_RIGHT, 0.6),
        ],
        Which::Fx => vec![(0, -12.0), (0, -6.0)],
        Which::Suite => vec![(0, 800.0), (1, 0.4), (0, 1200.0)],
    }
}
fn patch(which: Which, parallel: bool, queue: usize) -> (Controller, AudioEngine) {
    let (mut ctl, audio) = engine(
        RATE,
        Config {
            max_block: 512,
            parallel,
            queue,
            ..exact()
        },
    );
    let module: Box<dyn Module> = match which {
        Which::Wave => Box::new(demo::wave(RATE)),
        Which::Grain => Box::new(demo::grain(RATE as u32, 0, 128, 0)),
        Which::Fx => Box::new(Fx::new("gain", RATE).unwrap()),
        Which::Suite => Box::new(Suite::new("reverb", "dattorro-plate", RATE).unwrap()),
    };
    ctl.add(1, module).unwrap();
    if matches!(which, Which::Fx | Which::Suite) {
        ctl.add_with_factory(2, Box::new(|_, _| Box::new(Sine::new(317.0, 0.2))))
            .unwrap();
        ctl.connect(port(2, 0), port(1, 0)).unwrap();
    }
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit().unwrap();
    match which {
        Which::Wave => {
            ctl.send(1, EventKind::Note(NoteEvent::on(60, 0.8)))
                .unwrap();
        }
        Which::Grain => {
            for index in [grain::RUN, grain::PLAY] {
                ctl.send(1, EventKind::Param { index, value: 1.0 }).unwrap();
            }
        }
        _ => {}
    }
    (ctl, audio)
}
fn compare(a: &mut AudioEngine, b: &mut AudioEngine, n: usize) {
    let (mut l, mut r, mut x, mut y) = ([0.0; 512], [0.0; 512], [0.0; 512], [0.0; 512]);
    let mut at = 0;
    while at < n {
        let k = [1, 31, 127, 512][at % 4].min(n - at);
        let before = counted();
        a.render(&mut l[..k], &mut r[..k]);
        b.render(&mut x[..k], &mut y[..k]);
        assert_eq!(counted(), before);
        assert_same("preset L", &l[..k], &x[..k]);
        assert_same("preset R", &r[..k], &y[..k]);
        at += k;
    }
}
#[test]
fn each_wrapper_preset_is_bit_identical_to_ordered_controls_and_survives_rate() {
    assert_the_check_is_on();
    for which in [Which::Wave, Which::Grain, Which::Fx, Which::Suite] {
        for parallel in [false, true] {
            let (mut ctl, mut audio) = patch(which, parallel, 4096);
            let (mut reference_ctl, mut reference) = patch(which, parallel, 4096);
            compare(&mut audio, &mut reference, 777);
            let values = controls(which);
            let at = audio.frame() + 13;
            ctl.give_at(at, 1, PRESET, state(which, &values)).unwrap();
            for &(index, value) in &values {
                reference_ctl
                    .send_at(at, 1, EventKind::Param { index, value })
                    .unwrap();
            }
            compare(&mut audio, &mut reference, 4096);
            // The hand-over is still pending when the controller prepares the
            // new-rate modules: the audio-owned remembered controls must win.
            let values2 = controls(which)
                .into_iter()
                .map(|(i, v)| (i, v * 0.75))
                .collect::<Vec<_>>();
            ctl.give_at(audio.frame(), 1, PRESET, state(which, &values2))
                .unwrap();
            for &(index, value) in &values2 {
                reference_ctl
                    .send_at(reference.frame(), 1, EventKind::Param { index, value })
                    .unwrap();
            }
            ctl.set_rate(96000.0).unwrap();
            reference_ctl.set_rate(96000.0).unwrap();
            compare(&mut audio, &mut reference, 4096);
            // A further preset returns the state inherited across rehome.
            ctl.give(1, PRESET, state(which, &values)).unwrap();
            for &(index, value) in &values {
                reference_ctl
                    .send(1, EventKind::Param { index, value })
                    .unwrap();
            }
            compare(&mut audio, &mut reference, 1024);
            let mut returned = Vec::new();
            ctl.collect_things(&mut returned);
            let found = returned.iter().any(|thing| match which {
                Which::Wave => thing
                    .downcast_ref::<WaveState>()
                    .is_some_and(|s| s.controls() == values2),
                Which::Grain => thing
                    .downcast_ref::<GrainState>()
                    .is_some_and(|s| s.controls() == values2),
                Which::Fx => thing
                    .downcast_ref::<FxState>()
                    .is_some_and(|s| s.controls() == values2),
                Which::Suite => thing
                    .downcast_ref::<SuiteState>()
                    .is_some_and(|s| s.controls() == values2),
            });
            assert!(found, "{which:?}: old preset came back after rate handover");
            reference_ctl.collect();
            assert!(ctl.take_failures().is_empty(), "{which:?}");
        }
    }
}
#[test]
fn four_thousand_controls_take_one_queue_slot_and_return_the_previous_state() {
    assert_the_check_is_on();
    let (mut ctl, mut audio) = patch(Which::Fx, false, 16);
    let (mut ref_ctl, mut reference) = patch(Which::Fx, false, 8192);
    compare(&mut audio, &mut reference, 128);
    let values: Vec<_> = (0..4096).map(|i| (0, -(i % 24) as f32)).collect();
    let before = ctl.last_seq();
    let first = ctl
        .give_at(141, 1, PRESET, state(Which::Fx, &values))
        .unwrap();
    assert_eq!(first, before + 1);
    assert_eq!(first, ctl.last_seq());
    for &(index, value) in &values {
        ref_ctl
            .send_at(141, 1, EventKind::Param { index, value })
            .unwrap();
    }
    compare(&mut audio, &mut reference, 1024);
    // Individual edits update the saved state, with no new storage on audio.
    ctl.send(
        1,
        EventKind::Param {
            index: 0,
            value: -3.0,
        },
    )
    .unwrap();
    ref_ctl
        .send(
            1,
            EventKind::Param {
                index: 0,
                value: -3.0,
            },
        )
        .unwrap();
    compare(&mut audio, &mut reference, 128);
    ctl.set_rate(96000.0).unwrap();
    ref_ctl.set_rate(96000.0).unwrap();
    compare(&mut audio, &mut reference, 1024);
    ctl.give(1, PRESET, state(Which::Fx, &[(0, -9.0)])).unwrap();
    ref_ctl
        .send(
            1,
            EventKind::Param {
                index: 0,
                value: -9.0,
            },
        )
        .unwrap();
    compare(&mut audio, &mut reference, 128);
    let mut returned = Vec::new();
    ctl.collect_things(&mut returned);
    assert!(returned
        .iter()
        .filter_map(|thing| thing.downcast_ref::<FxState>())
        .any(|s| s.controls().len() == 4096 && s.controls().iter().all(|&(_, v)| v == -3.0)));
}
