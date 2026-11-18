//! Changing the patch while it plays.

mod common;
use common::*;
use engine_core::basics::*;
use engine_core::*;
use std::sync::{Arc, Mutex};
use std::thread::{self, ThreadId};

fn one_sine(hz: f32, frames: usize) -> Vec<f32> {
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Sine::new(hz, 0.25))).unwrap();
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit().unwrap();
    render(&mut audio, frames, 256).0
}

#[test]
fn a_module_in_both_patches_carries_on_where_it_was() {
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Sine::new(220.0, 0.25))).unwrap();
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit().unwrap();
    let (before, _) = render(&mut audio, 1024, 256);
    ctl.add(2, Box::new(Sine::new(550.0, 0.25))).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    let (after, _) = render(&mut audio, 1024, 256);

    let first = one_sine(220.0, 2048);
    let second = one_sine(550.0, 1024);
    assert_same("before the change", &before, &first[..1024]);
    let expected: Vec<f32> = (0..1024).map(|i| first[1024 + i] + second[i]).collect();
    assert_same("after the change", &after, &expected);
}

#[test]
fn a_stamped_patch_change_lands_on_its_sample() {
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.commit().unwrap();
    ctl.add(1, Box::new(Dc(1.0))).unwrap();
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit_at(1500).unwrap();
    let (l, _) = render(&mut audio, 3000, 256);
    assert!(l[..1500].iter().all(|v| *v == 0.0));
    assert!(l[1500..].iter().all(|v| *v == 1.0));
}

#[test]
fn old_plans_come_back_to_be_freed() {
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Dc(1.0))).unwrap();
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit().unwrap();
    render(&mut audio, 256, 256);
    assert_eq!(ctl.collect().plans, 1, "the empty plan the engine started with");
    ctl.remove(1);
    ctl.commit().unwrap();
    assert_eq!(ctl.collect().plans, 0, "not until the audio thread has let go");
    let (l, _) = render(&mut audio, 256, 256);
    assert!(l.iter().all(|v| *v == 0.0), "the removed module is no longer heard");
    assert_eq!(ctl.collect().plans, 1);
}

/// Notes which thread it was dropped on.
struct DropProbe(Arc<Mutex<Option<ThreadId>>>);

impl Drop for DropProbe {
    fn drop(&mut self) {
        *self.0.lock().unwrap() = Some(thread::current().id());
    }
}

impl Module for DropProbe {
    fn inputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn process(&mut self, _io: &mut Io) {}
}

#[test]
fn a_removed_module_is_freed_on_the_apps_thread() {
    let dropped_on = Arc::new(Mutex::new(None));
    let (mut ctl, audio) = engine(RATE, exact());
    ctl.add(1, Box::new(DropProbe(dropped_on.clone()))).unwrap();
    ctl.commit().unwrap();
    let on_audio_thread = |mut audio: AudioEngine| {
        thread::spawn(move || {
            render(&mut audio, 256, 64);
            audio
        })
        .join()
        .unwrap()
    };
    let audio = on_audio_thread(audio);
    ctl.remove(1);
    ctl.commit().unwrap();
    let _audio = on_audio_thread(audio);
    assert_eq!(*dropped_on.lock().unwrap(), None, "still alive after the audio thread let go of it");
    ctl.collect();
    assert_eq!(*dropped_on.lock().unwrap(), Some(thread::current().id()));
}

#[test]
fn a_replaced_sound_comes_back_to_be_freed() {
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(SoundSource::new())).unwrap();
    ctl.add(2, Box::new(Player::new(1.0))).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    let first = ctl.load_sound(1, ramp_sound(100)).unwrap();
    assert_eq!(first, SoundRef { id: 1, version: 1 });
    ctl.send(1, EventKind::Sound { slot: 0, sound: first }).unwrap();
    let (l, r) = render(&mut audio, 256, 256);
    assert_eq!(l[0], -1.0, "the sound plays from its start");
    assert_eq!(l[50], 0.0);
    assert_eq!(r[0], 1.0);
    assert_eq!(l[100], -1.0, "and loops");
    let second = ctl.load_sound(1, ramp_sound(200)).unwrap();
    assert_eq!(second.version, 2);
    render(&mut audio, 256, 256);
    assert_eq!(ctl.collect().sounds, 1);
    assert_eq!(ctl.load_sound(0, ramp_sound(10)).err(), Some(PatchError::BadSoundId(0)));
}
