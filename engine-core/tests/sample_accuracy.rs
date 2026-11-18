//! A message lands on the sample it is stamped with.

mod common;
use common::*;
use engine_core::basics::*;
use engine_core::*;

fn dc_through_gain() -> (Controller, AudioEngine) {
    let (mut ctl, audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Dc(1.0))).unwrap();
    ctl.add(2, Box::new(Gain::new(1.0))).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    (ctl, audio)
}

#[test]
fn a_stamped_knob_move_lands_on_its_sample() {
    let (mut ctl, mut audio) = dc_through_gain();
    ctl.commit().unwrap();
    ctl.send_at(777, 2, EventKind::Param { index: 0, value: 0.0 }).unwrap();
    let (l, r) = render(&mut audio, 2000, 256);
    assert!(l[..777].iter().all(|v| *v == 1.0), "full level up to sample 776");
    assert!(l[777..].iter().all(|v| *v == 0.0), "silent from sample 777");
    assert_same("both sides", &l, &r);
}

#[test]
fn an_unstamped_move_lands_at_the_next_block() {
    let (mut ctl, mut audio) = dc_through_gain();
    ctl.commit().unwrap();
    let (first, _) = render(&mut audio, 512, 256);
    ctl.send(2, EventKind::Param { index: 0, value: 0.0 }).unwrap();
    let (second, _) = render(&mut audio, 256, 256);
    assert!(first.iter().all(|v| *v == 1.0));
    assert!(second.iter().all(|v| *v == 0.0), "heard from the first sample of the next block");
    assert_eq!(audio.frame(), 768);
}

#[test]
fn a_knob_set_before_the_patch_is_sent_is_heard_from_the_first_sample() {
    let (mut ctl, mut audio) = dc_through_gain();
    ctl.send(2, EventKind::Param { index: 0, value: 0.25 }).unwrap();
    ctl.commit().unwrap();
    let (l, _) = render(&mut audio, 256, 256);
    assert!(l.iter().all(|v| *v == 0.25));
}

#[test]
fn a_stamped_note_lands_on_its_sample() {
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Keys::new())).unwrap();
    ctl.add(2, Box::new(NoteProbe)).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    ctl.send_at(1234, 1, EventKind::Note(NoteEvent::on(60, 1.0))).unwrap();
    let (l, _) = render(&mut audio, 2000, 256);
    assert_eq!(l[1234], 1.0);
    assert_eq!(l.iter().sum::<f32>(), 1.0, "and nowhere else");
}

#[test]
fn messages_stamped_for_one_sample_land_in_the_order_sent() {
    let (mut ctl, mut audio) = dc_through_gain();
    ctl.commit().unwrap();
    ctl.send_at(500, 2, EventKind::Param { index: 0, value: 0.5 }).unwrap();
    ctl.send_at(500, 2, EventKind::Param { index: 0, value: 0.125 }).unwrap();
    let (l, _) = render(&mut audio, 1000, 256);
    assert_eq!(l[499], 1.0);
    assert_eq!(l[500], 0.125, "the later of the two wins");
}

#[test]
fn a_plug_into_the_wrong_kind_of_socket_is_refused() {
    let (mut ctl, _audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Keys::new())).unwrap();
    ctl.add(2, Box::new(Gain::new(1.0))).unwrap();
    assert_eq!(
        ctl.connect(port(1, 0), port(2, 0)),
        Err(PatchError::KindMismatch { from: port(1, 0), to: port(2, 0) })
    );
    assert_eq!(ctl.connect(port(1, 0), port(2, 9)), Err(PatchError::NoSuchPort(port(2, 9))));
    assert_eq!(ctl.connect_out(port(1, 0)), Err(PatchError::NotAudio(port(1, 0))));
    assert_eq!(ctl.add(1, Box::new(Keys::new())).err(), Some(PatchError::DuplicateModule(1)));
}
