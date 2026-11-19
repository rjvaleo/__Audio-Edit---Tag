use engine_core::basics::Sine;
use engine_core::*;

#[test]
fn unsupported_or_invalid_rate_leaves_the_patch_alone() {
    let (mut ctl, mut audio) = engine(48000.0, Config::default());
    ctl.add(1, Box::new(Sine::new(220.0, 0.1))).unwrap();
    assert_eq!(ctl.set_rate(44100.0), Err(PatchError::UnsupportedRate(1)));
    assert_eq!(ctl.set_rate(f32::NAN), Err(PatchError::InvalidRate));
    assert_eq!(ctl.rate(), 48000.0);
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit().unwrap();
    let mut l = [0.0; 1024];
    let mut r = l;
    audio.render(&mut l, &mut r);
    assert!(l.iter().any(|v| v.abs() > 0.01));
}
fn render(chunks: &[usize]) -> Vec<f32> {
    let (mut ctl, mut audio) = engine(
        48000.0,
        Config {
            max_block: 512,
            fade_frames: 128,
            ..Config::default()
        },
    );
    ctl.add_with_factory(1, Box::new(|_, _| Box::new(Sine::new(220.0, 0.1))))
        .unwrap();
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit().unwrap();
    let mut warm = [0.0; 512];
    let mut right = warm;
    audio.render(&mut warm, &mut right);
    ctl.set_rate(44100.0).unwrap();
    assert_eq!(ctl.set_rate(48000.0), Err(PatchError::RateBusy));
    let mut result = Vec::new();
    for &n in chunks {
        let mut l = vec![0.0; n];
        let mut r = l.clone();
        audio.render(&mut l, &mut r);
        result.extend(l);
    }
    result
}
#[test]
fn oversized_and_smaller_callbacks_match_during_and_after_rate_change() {
    let whole = render(&[4096]);
    assert_eq!(whole, render(&[512; 8]));
    assert_eq!(whole, render(&[1, 31, 480, 7, 505, 1024, 2048]));
}

#[test]
fn clock_beats_continue_at_the_new_rate() {
    use std::sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    };
    struct Read(Arc<AtomicU64>);
    impl Module for Read {
        fn inputs(&self) -> Vec<Kind> {
            vec![Kind::Clock]
        }
        fn outputs(&self) -> Vec<Kind> {
            vec![]
        }
        fn process(&mut self, io: &mut Io) {
            self.0
                .store(io.ins.clock(0).beat.to_bits(), Ordering::Relaxed);
        }
    }
    let beat = Arc::new(AtomicU64::new(0));
    let (mut ctl, mut audio) = engine(
        48000.0,
        Config {
            max_block: 512,
            fade_frames: 0,
            ..Config::default()
        },
    );
    ctl.add_with_factory(
        1,
        Box::new(|_, _| Box::new(engine_core::basics::Clock::new(120.0, true))),
    )
    .unwrap();
    let value = Arc::clone(&beat);
    ctl.add_with_factory(2, Box::new(move |_, _| Box::new(Read(Arc::clone(&value)))))
        .unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.commit().unwrap();
    let mut l = [0.0; 512];
    let mut r = l;
    for _ in 0..10 {
        audio.render(&mut l, &mut r);
    }
    ctl.set_rate(44100.0).unwrap();
    audio.render(&mut l, &mut r);
    // During the zero-frame fade both observers see the same first beat.
    let first = f64::from_bits(beat.load(Ordering::Relaxed));
    assert!((first - 5120.0 * 2.0 / 48000.0).abs() < 1e-12);
    audio.render(&mut l, &mut r);
    let next = f64::from_bits(beat.load(Ordering::Relaxed));
    assert!((next - first - 512.0 * 2.0 / 44100.0).abs() < 1e-12);
}

#[test]
fn a_fresh_patch_after_switch_matches_one_built_at_the_destination_rate() {
    struct Rate(f32);
    impl Module for Rate {
        fn inputs(&self) -> Vec<Kind> {
            vec![]
        }
        fn outputs(&self) -> Vec<Kind> {
            vec![Kind::Audio]
        }
        fn prepare(&mut self, rate: f32, _: usize) {
            self.0 = rate / 48000.0;
        }
        fn process(&mut self, io: &mut Io) {
            let (l, r) = io.outs.audio(0);
            l.fill(self.0);
            r.fill(self.0);
        }
    }
    fn patch(rate: f32) -> (Controller, AudioEngine) {
        let (mut ctl, audio) = engine(
            rate,
            Config {
                max_block: 512,
                fade_frames: 128,
                ..Config::default()
            },
        );
        ctl.add_with_factory(1, Box::new(|_, _| Box::new(Rate(0.0))))
            .unwrap();
        ctl.connect_out(port(1, 0)).unwrap();
        ctl.commit().unwrap();
        (ctl, audio)
    }
    let (mut ctl, mut changed) = patch(48000.0);
    let (_ctl, mut fresh) = patch(44100.0);
    let mut l = [0.0; 512];
    let mut r = l;
    changed.render(&mut l, &mut r);
    ctl.set_rate(44100.0).unwrap();
    changed.render(&mut l, &mut r);
    fresh.render(&mut l, &mut r);
    let mut a = [0.0; 512];
    let mut ar = a;
    let mut b = a;
    let mut br = a;
    changed.render(&mut a, &mut ar);
    fresh.render(&mut b, &mut br);
    assert_eq!(a, b);
    assert_eq!(ar, br);
    assert_eq!(a[0], 44100.0 / 48000.0);
}

#[test]
fn the_sound_bank_keeps_its_rate_and_storage_when_output_rate_changes() {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    struct Read(SoundRef, Arc<AtomicUsize>);
    impl Module for Read {
        fn inputs(&self) -> Vec<Kind> {
            vec![]
        }
        fn outputs(&self) -> Vec<Kind> {
            vec![]
        }
        fn process(&mut self, io: &mut Io) {
            let sound = io.sounds.get(self.0).unwrap();
            assert_eq!(sound.rate, 32000.0);
            let address = sound.l.as_ptr() as usize;
            let old = self.1.swap(address, Ordering::Relaxed);
            assert!(
                old == 0 || old == address,
                "sound was reloaded or resampled"
            );
            assert_eq!(&sound.l[..], &[0.1, 0.2, 0.3]);
        }
    }
    let (mut ctl, mut audio) = engine(48000.0, Config::default());
    let sound = ctl
        .load_sound(
            1,
            SoundData {
                l: vec![0.1, 0.2, 0.3].into_boxed_slice(),
                r: vec![0.1, 0.2, 0.3].into_boxed_slice(),
                rate: 32000.0,
            },
        )
        .unwrap();
    let ptr = Arc::new(AtomicUsize::new(0));
    let captured = Arc::clone(&ptr);
    ctl.add_with_factory(
        1,
        Box::new(move |_, _| Box::new(Read(sound, Arc::clone(&captured)))),
    )
    .unwrap();
    ctl.commit().unwrap();
    let mut l = [0.0; 1024];
    let mut r = l;
    audio.render(&mut l, &mut r);
    ctl.set_rate(44100.0).unwrap();
    audio.render(&mut l, &mut r);
    ctl.set_rate(48000.0).unwrap();
    audio.render(&mut l, &mut r);
    assert_ne!(ptr.load(Ordering::Relaxed), 0);
}

#[test]
fn opaque_module_state_is_refused_instead_of_lost() {
    let (mut ctl, _audio) = engine(48000.0, Config::default());
    ctl.add_with_factory(1, Box::new(|_, _| Box::new(Sine::new(220.0, 0.1))))
        .unwrap();
    ctl.give(1, 0, Box::new(7u32)).unwrap();
    assert_eq!(ctl.set_rate(44100.0), Err(PatchError::UnsupportedRate(1)));
    assert_eq!(ctl.rate(), 48000.0);
}

#[test]
fn a_key_queued_at_the_switch_is_not_lost_or_replayed_twice() {
    use engine_core::basics::{Keys, Voice};
    let (mut ctl, mut audio) = engine(
        48000.0,
        Config {
            fade_frames: 0,
            ..Config::default()
        },
    );
    ctl.add_with_factory(1, Box::new(|_, _| Box::new(Keys::new())))
        .unwrap();
    ctl.add_with_factory(2, Box::new(|_, _| Box::new(Voice::new())))
        .unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    let mut l = [0.0; 512];
    let mut r = l;
    audio.render(&mut l, &mut r);
    ctl.send(1, EventKind::Note(NoteEvent::on(60, 0.8)))
        .unwrap();
    ctl.set_rate(44100.0).unwrap();
    audio.render(&mut l, &mut r);
    assert!(l.iter().any(|v| v.abs() > 0.01));
    ctl.send(1, EventKind::Note(NoteEvent::off(60))).unwrap();
    audio.render(&mut l, &mut r);
    ctl.set_rate(48000.0).unwrap();
    for _ in 0..16 {
        audio.render(&mut l, &mut r);
    }
    assert!(l.iter().all(|v| *v == 0.0), "released key was re-attacked");
}
