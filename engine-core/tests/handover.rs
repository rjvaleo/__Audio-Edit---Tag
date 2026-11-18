//! Handing a module something built on the app's thread (a sound in its own
//! layout, a rack, a table), and getting back what it has finished with.
//! The audio thread moves boxes; it never frees one.

mod common;
use common::*;
use engine_core::*;
use std::sync::Arc;

const HOLDER: ModuleId = 1;

fn holder() -> (Controller, AudioEngine, Arc<Freed>) {
    let (mut ctl, audio) = engine(RATE, exact());
    ctl.add(HOLDER, Box::new(Holder::default())).unwrap();
    ctl.connect_out(port(HOLDER, 0)).unwrap();
    ctl.commit().unwrap();
    (ctl, audio, Arc::new(Freed::default()))
}

#[test]
fn a_thing_handed_over_is_taken_on_its_sample() {
    for block in [64, 7, 1000] {
        let (mut ctl, mut audio, freed) = holder();
        ctl.give_at(100, HOLDER, 0, level(0.5, &freed)).unwrap();
        let (l, r) = render(&mut audio, 256, block);
        assert!(l[..100].iter().all(|v| *v == 0.0), "blocks of {block}: silent before its sample");
        assert!(l[100..].iter().all(|v| *v == 0.5), "blocks of {block}: heard from its sample");
        assert_same("both sides", &l, &r);
    }
}

#[test]
fn what_a_module_has_finished_with_comes_back_to_be_freed() {
    let (mut ctl, mut audio, freed) = holder();
    ctl.give_at(10, HOLDER, 0, level(0.25, &freed)).unwrap();
    ctl.give_at(20, HOLDER, 0, level(0.75, &freed)).unwrap();
    let (l, _) = render(&mut audio, 64, 16);
    assert_eq!(l[19], 0.25);
    assert_eq!(l[20], 0.75);
    assert_eq!(freed.total(), 0, "the first level is on its way back, not freed");
    assert_eq!(ctl.collect().things, 1);
    assert_eq!(freed.total(), 1, "and is freed by collect");
    assert_eq!(freed.in_audio(), 0);
    let (l, _) = render(&mut audio, 64, 16);
    assert!(l.iter().all(|v| *v == 0.75), "the second plays on");
}

#[test]
fn a_module_can_hand_something_back_later() {
    let (mut ctl, mut audio, freed) = holder();
    ctl.give_at(10, HOLDER, 0, level(0.25, &freed)).unwrap();
    // Slot 1: the holder keeps the old one until it is asked.
    ctl.give_at(20, HOLDER, 1, level(0.75, &freed)).unwrap();
    render(&mut audio, 64, 16);
    assert_eq!(freed.total(), 0);
    assert_eq!(ctl.collect().things, 1, "asked after the piece, it gave the old one up");
    assert_eq!(freed.total(), 1);
    assert_eq!(freed.in_audio(), 0);
}

#[test]
fn a_thing_nobody_takes_comes_back() {
    let (mut ctl, mut audio, freed) = holder();
    // A module that isn't there, a module that takes nothing by default, and
    // a thing the holder has no use for.
    ctl.add(2, Box::new(Dc(0.0))).unwrap();
    ctl.commit().unwrap();
    ctl.give(99, 0, level(0.5, &freed)).unwrap();
    ctl.give(2, 0, level(0.5, &freed)).unwrap();
    ctl.give(HOLDER, 0, Box::new(7u32)).unwrap();
    let (l, _) = render(&mut audio, 64, 16);
    assert!(l.iter().all(|v| *v == 0.0));
    assert_eq!(freed.total(), 0);
    assert_eq!(ctl.collect().things, 3);
    assert_eq!(freed.total(), 2);
    assert_eq!(freed.in_audio(), 0);
}

#[test]
fn a_module_not_yet_committed_takes_it_at_once() {
    let (mut ctl, mut audio) = engine(RATE, exact());
    let freed = Arc::new(Freed::default());
    ctl.add(HOLDER, Box::new(Holder::default())).unwrap();
    ctl.give(HOLDER, 0, level(0.25, &freed)).unwrap();
    ctl.give(HOLDER, 0, level(0.5, &freed)).unwrap();
    assert_eq!(freed.total(), 1, "the one it replaced is freed here, on the app's thread");
    ctl.connect_out(port(HOLDER, 0)).unwrap();
    ctl.commit().unwrap();
    let (l, _) = render(&mut audio, 32, 16);
    assert!(l.iter().all(|v| *v == 0.5), "from the first sample");
}

#[test]
fn a_removed_module_takes_what_it_holds_with_it() {
    let (mut ctl, mut audio, freed) = holder();
    ctl.give(HOLDER, 0, level(0.5, &freed)).unwrap();
    render(&mut audio, 64, 16);
    ctl.remove(HOLDER);
    ctl.commit().unwrap();
    render(&mut audio, 64, 16);
    assert_eq!(freed.total(), 0, "still inside the old plan");
    assert!(ctl.collect().plans >= 1);
    assert_eq!(freed.total(), 1, "freed with the plan, on the app's thread");
    assert_eq!(freed.in_audio(), 0);
}
