//! A mixer, and a recorder whose tape is made by the app and comes back to it.

mod common;
use common::*;
use engine_core::basics::{Mix, Record, Sine, Tape};
use engine_core::*;

#[test]
fn a_mix_is_the_sum_of_its_inputs_at_their_levels() {
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Dc(0.25))).unwrap();
    ctl.add(2, Box::new(Dc(0.5))).unwrap();
    ctl.add(3, Box::new(Dc(-1.0))).unwrap();
    ctl.add(9, Box::new(Mix::new(3))).unwrap();
    for (from, input) in [(1, 0), (2, 1), (3, 2)] {
        ctl.connect(port(from, 0), port(9, input)).unwrap();
    }
    ctl.connect_out(port(9, 0)).unwrap();
    ctl.commit().unwrap();
    // Input 2 down to a quarter on sample 100; the whole mix halved on 200.
    ctl.send_at(100, 9, EventKind::Param { index: 2, value: 0.25 }).unwrap();
    ctl.send_at(200, 9, EventKind::Param { index: 3, value: 0.5 }).unwrap();
    let (l, r) = render(&mut audio, 300, 64);
    assert!(l[..100].iter().all(|v| *v == 0.25 + 0.5 - 1.0), "all three at full level: {}", l[0]);
    assert!(l[100..200].iter().all(|v| *v == 0.25 + 0.5 - 0.25), "from its sample: {}", l[100]);
    assert!(l[200..].iter().all(|v| *v == (0.25 + 0.5 - 0.25) * 0.5), "the whole mix: {}", l[200]);
    assert_same("both sides", &l, &r);
}

#[test]
fn a_mix_of_one_input_at_full_level_carries_every_bit() {
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Dc(-0.0))).unwrap();
    ctl.add(9, Box::new(Mix::new(2))).unwrap();
    ctl.connect(port(1, 0), port(9, 0)).unwrap();
    ctl.connect_out(port(9, 0)).unwrap();
    ctl.commit().unwrap();
    let (l, _) = render(&mut audio, 64, 16);
    assert!(l.iter().all(|v| v.to_bits() == (-0.0f32).to_bits()), "an unused input adds nothing, not even +0.0");
}

fn recording() -> (Controller, AudioEngine) {
    let (mut ctl, audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Sine::new(440.0, 0.5))).unwrap();
    ctl.add(2, Box::new(Record::new())).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    (ctl, audio)
}

fn tapes(things: Vec<Thing>) -> Vec<Box<Tape>> {
    things.into_iter().map(|thing| thing.downcast::<Tape>().ok().expect("a tape")).collect()
}

#[test]
fn a_tape_records_from_its_sample_until_it_is_full_and_comes_back() {
    let (mut ctl, mut audio) = recording();
    ctl.give_at(1_000, 2, 0, Box::new(Tape::with_room(3_000))).unwrap();
    let (l, r) = render(&mut audio, 6_000, 128);
    let mut back = Vec::new();
    assert_eq!(ctl.collect_things(&mut back).things, 1);
    let tape = tapes(back).pop().unwrap();
    assert_same("left", &tape.l, &l[1_000..4_000]);
    assert_same("right", &tape.r, &r[1_000..4_000]);
}

#[test]
fn a_tape_is_stopped_on_a_sample_and_the_sound_passes_through_untouched() {
    let (mut ctl, mut audio) = recording();
    ctl.give_at(500, 2, 0, Box::new(Tape::with_room(48_000))).unwrap();
    ctl.send_at(2_222, 2, EventKind::Param { index: 0, value: 0.0 }).unwrap();
    let (l, _) = render(&mut audio, 4_000, 61);
    let mut back = Vec::new();
    ctl.collect_things(&mut back);
    let tape = tapes(back).pop().expect("the tape came back when it was stopped");
    assert_eq!(tape.l.len(), 2_222 - 500);
    assert_same("what was recorded", &tape.l, &l[500..2_222]);

    // The same patch without the recorder in it: the same samples.
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Sine::new(440.0, 0.5))).unwrap();
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit().unwrap();
    let (plain, _) = render(&mut audio, 4_000, 61);
    assert_same("through the recorder", &l, &plain);
}

#[test]
fn a_second_tape_takes_over_from_the_first() {
    let (mut ctl, mut audio) = recording();
    ctl.give_at(100, 2, 0, Box::new(Tape::with_room(48_000))).unwrap();
    ctl.give_at(900, 2, 0, Box::new(Tape::with_room(500))).unwrap();
    let (l, _) = render(&mut audio, 3_000, 128);
    let mut back = Vec::new();
    assert_eq!(ctl.collect_things(&mut back).things, 2);
    let tapes = tapes(back);
    assert_same("the first, cut where the second began", &tapes[0].l, &l[100..900]);
    assert_same("the second, full", &tapes[1].l, &l[900..1_400]);
}
