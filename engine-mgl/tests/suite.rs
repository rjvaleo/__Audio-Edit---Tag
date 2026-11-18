//! One of prism-fx's suites as a module, against prism-fx's own suite
//! module (`suite::ModuleKernel`) driven by hand.

mod common;
use common::*;
use engine_core::basics::{Player, SoundSource};
use engine_core::*;
use engine_mgl::{Fx, Suite, SuiteThing};
use prism_fx::suite::{find_mode, ModuleKernel};
use prism_fx::{contract, par, DynKernel};

const BLOCK: usize = 128;
const SUITE: ModuleId = 3;

/// The modes switched to, each with its sample (a multiple of the block),
/// and a knob of the mode then running moved a little later.
const SWITCHES: [(usize, &str); 3] = [(3_200, "sm-gemini"), (7_680, "hp-hall"), (12_160, "dattorro-plate")];

fn alone() -> (Vec<f32>, Vec<f32>) {
    let rate = contract::SAMPLE_RATE;
    let mut module = ModuleKernel::new(find_mode("reverb", "dattorro-plate").unwrap(), rate).unwrap();
    module.reset();
    let (mut l, mut r) = par::input();
    let mut at = 0;
    while at < par::FRAMES {
        for (frame, mode) in SWITCHES {
            if frame == at {
                let mode = find_mode("reverb", mode).unwrap();
                let next = (prism_fx::find(mode.kernel).unwrap().make)(rate);
                assert!(module.begin_switch(mode, next).is_ok(), "the switch before it has finished");
            }
            if frame + 1_280 == at {
                let far = module.descriptor().params[0].max;
                module.set_param(0, far);
            }
        }
        let end = (at + BLOCK).min(par::FRAMES);
        module.process(&mut l[at..end], &mut r[at..end]);
        drop(module.take_retired());
        at = end;
    }
    (l, r)
}

fn patch(module: Box<dyn Module>) -> (Controller, AudioEngine) {
    let (l, r) = par::input();
    let (mut ctl, audio) = engine(contract::SAMPLE_RATE, exact());
    let sound = ctl
        .load_sound(1, SoundData { rate: contract::SAMPLE_RATE, l: l.into_boxed_slice(), r: r.into_boxed_slice() })
        .unwrap();
    ctl.add(1, Box::new(SoundSource::new())).unwrap();
    ctl.send(1, EventKind::Sound { slot: 0, sound }).unwrap();
    ctl.add(2, Box::new(Player::new(1.0))).unwrap();
    ctl.add(SUITE, module).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect(port(2, 0), port(SUITE, 0)).unwrap();
    ctl.connect_out(port(SUITE, 0)).unwrap();
    ctl.commit().unwrap();
    (ctl, audio)
}

fn switched() -> (Controller, AudioEngine) {
    let rate = contract::SAMPLE_RATE;
    let (mut ctl, audio) = patch(Box::new(Suite::new("reverb", "dattorro-plate", rate).unwrap()));
    for (frame, mode) in SWITCHES {
        let far = prism_fx::find(find_mode("reverb", mode).unwrap().kernel).unwrap().descriptor.params[0].max;
        ctl.give_at(frame as u64, SUITE, 0, Box::new(SuiteThing::mode("reverb", mode, rate).unwrap())).unwrap();
        ctl.send_at(frame as u64 + 1_280, SUITE, EventKind::Param { index: 0, value: far }).unwrap();
    }
    (ctl, audio)
}

#[test]
fn a_suite_switches_modes_as_prism_fxs_module_does() {
    let (want_l, want_r) = alone();
    let (_ctl, mut audio) = switched();
    let (l, r) = render(&mut audio, par::FRAMES, BLOCK);
    assert_same("left", &l, &want_l);
    assert_same("right", &r, &want_r);
}

#[test]
fn a_suite_on_one_mode_is_that_effect_to_the_last_bit() {
    let rate = contract::SAMPLE_RATE;
    let (_c, mut suite) = patch(Box::new(Suite::new("reverb", "dattorro-plate", rate).unwrap()));
    let (_c2, mut plain) = patch(Box::new(Fx::new("dattorro-plate", rate).unwrap()));
    let (l, r) = render(&mut suite, par::FRAMES, 512);
    let (pl, pr) = render(&mut plain, par::FRAMES, 512);
    assert_same("left", &l, &pl);
    assert_same("right", &r, &pr);
    assert!(Suite::new("reverb", "no-such-mode", rate).is_none());
    assert!(Suite::new("no-such-suite", "dattorro-plate", rate).is_none());
}

#[test]
fn switching_modes_costs_the_audio_thread_no_memory_and_the_old_effects_come_back() {
    assert_the_check_is_on();
    let (mut ctl, mut audio) = switched();
    let before = counted();
    let (l, _) = render(&mut audio, par::FRAMES, BLOCK);
    assert!(peak(&l) > 0.01);
    assert_eq!(counted(), before, "allocations or frees inside a render; the last sizes: {:?}", last_sizes());
    // Each switch's box comes back carrying the effect of the mode it left.
    assert_eq!(ctl.collect().things, 3);
}

/// Two switches closer together than the 20 ms a switch takes: the second
/// waits its turn, as a slot does in MGL's rack, and still happens.
#[test]
fn a_switch_asked_for_during_another_waits_its_turn() {
    let rate = contract::SAMPLE_RATE;
    let (mut ctl, mut audio) = patch(Box::new(Suite::new("reverb", "dattorro-plate", rate).unwrap()));
    ctl.give_at(2_000, SUITE, 0, Box::new(SuiteThing::mode("reverb", "sm-gemini", rate).unwrap())).unwrap();
    ctl.give_at(2_100, SUITE, 0, Box::new(SuiteThing::mode("reverb", "hp-hall", rate).unwrap())).unwrap();
    let (l, _) = render(&mut audio, par::FRAMES, BLOCK);
    // The same with only the last mode asked for, far from the first: by
    // the end both are playing the hall and nothing else.
    let (mut ctl2, mut audio2) = patch(Box::new(Suite::new("reverb", "dattorro-plate", rate).unwrap()));
    ctl2.give_at(2_000, SUITE, 0, Box::new(SuiteThing::mode("reverb", "hp-hall", rate).unwrap())).unwrap();
    let (direct, _) = render(&mut audio2, par::FRAMES, BLOCK);
    assert!(first_difference(&l, &direct).is_some(), "it went by way of the other mode");
    assert_eq!(ctl.collect().things, 2, "both boxes came back");
    assert!(peak(&l[12_000..]) > 0.0);
}
