//! The C interface, called the way the JUCE app calls it.

use engine_capi::*;
use engine_core::basics::{Gain, Sine};
use engine_core::{engine, port, Config};
use std::ptr;

const RATE: f32 = 48_000.0;

unsafe fn render(e: *mut NeEngine, frames: usize, block: usize) -> (Vec<f32>, Vec<f32>) {
    let mut l = vec![0.0f32; frames];
    let mut r = vec![0.0f32; frames];
    let mut pos = 0;
    while pos < frames {
        let n = block.min(frames - pos);
        ne_render(e, l[pos..].as_mut_ptr(), r[pos..].as_mut_ptr(), n as u32);
        pos += n;
    }
    (l, r)
}

#[test]
fn a_patch_built_through_c_plays_what_the_engine_plays() {
    unsafe {
        let e = ne_new(RATE, 1024, 0);
        assert_eq!(ne_add(e, 1, NE_SINE, 220.0, 0.5), 0);
        assert_eq!(ne_add(e, 2, NE_GAIN, 0.8, 0.0), 0);
        assert_eq!(ne_connect(e, 1, 0, 2, 0), 0);
        assert_eq!(ne_connect_out(e, 2, 0), 0);
        assert_eq!(ne_commit(e, 0), 1, "the first message is number 1");
        let (l, r) = render(e, 1000, 128);
        assert_eq!(ne_frame(e), 1000);
        ne_free(e);

        let (mut ctl, mut audio) = engine(RATE, Config::default());
        ctl.add(1, Box::new(Sine::new(220.0, 0.5))).unwrap();
        ctl.add(2, Box::new(Gain::new(0.8))).unwrap();
        ctl.connect(port(1, 0), port(2, 0)).unwrap();
        ctl.connect_out(port(2, 0)).unwrap();
        ctl.commit().unwrap();
        let mut dl = vec![0.0f32; 1000];
        let mut dr = vec![0.0f32; 1000];
        audio.render(&mut dl, &mut dr);
        assert!(l.iter().any(|v| v.abs() > 0.3));
        assert_eq!(l, dl);
        assert_eq!(r, dr);
    }
}

#[test]
fn mistakes_come_back_as_codes() {
    unsafe {
        let e = ne_new(RATE, 1024, 0);
        assert_eq!(ne_add(e, 1, 999, 0.0, 0.0), -10, "no such kind of module");
        assert_eq!(ne_add(e, 1, NE_KEYS, 0.0, 0.0), 0);
        assert_eq!(ne_add(e, 1, NE_KEYS, 0.0, 0.0), -1, "the number is taken");
        assert_eq!(ne_add(e, 2, NE_GAIN, 0.5, 0.0), 0);
        assert_eq!(ne_add(e, 3, NE_GAIN, 0.5, 0.0), 0);
        assert_eq!(ne_connect(e, 1, 0, 2, 9), -3, "no such socket");
        assert_eq!(ne_connect(e, 1, 0, 2, 0), -4, "notes into an audio socket");
        assert_eq!(ne_connect_out(e, 1, 0), -5, "only audio goes to the sound card");
        assert_eq!(ne_connect(e, 2, 0, 3, 0), 0);
        assert_eq!(ne_connect(e, 3, 0, 2, 0), 0);
        assert_eq!(ne_commit(e, 0), -7, "a loop with no delay");
        assert_eq!(ne_disconnect(e, 3, 0, 2, 0), 0);
        assert_eq!(ne_disconnect(e, 3, 0, 2, 0), -3, "it was already out");
        assert_eq!(ne_commit(e, 0), 1);
        assert_eq!(ne_remove(e, 3), 0);
        assert_eq!(ne_remove(e, 3), -2);
        ne_free(e);
        assert_eq!(ne_commit(ptr::null_mut(), 0), -11);
        ne_render(ptr::null_mut(), ptr::null_mut(), ptr::null_mut(), 64);
    }
}

#[test]
fn a_stamped_knob_lands_on_its_sample_and_says_so() {
    unsafe {
        let e = ne_new(RATE, 1024, 1);
        assert_eq!(ne_add(e, 1, NE_SINE, 220.0, 0.5), 0);
        assert_eq!(ne_connect_out(e, 1, 0), 0);
        assert_eq!(ne_commit(e, 0), 1);
        assert_eq!(ne_param(e, 777, 1, 1, 0.0), 2, "level to nothing at frame 777");
        let (l, _) = render(e, 2000, 128);
        assert!(l[700..777].iter().any(|v| v.abs() > 0.1));
        assert!(l[777..].iter().all(|v| *v == 0.0));
        let mut seqs = [0u64; 8];
        let mut frames = [0u64; 8];
        assert_eq!(ne_applied(e, seqs.as_mut_ptr(), frames.as_mut_ptr(), 1), 1, "one at a time works");
        assert_eq!(ne_applied(e, seqs[1..].as_mut_ptr(), frames[1..].as_mut_ptr(), 7), 1);
        assert_eq!((seqs[0], frames[0]), (1, 0));
        assert_eq!((seqs[1], frames[1]), (2, 777));
        assert_eq!(ne_collect(e), 0, "the starting plan was already freed by the calls above");
        ne_free(e);
    }
}

#[test]
fn a_sound_loaded_through_c_plays() {
    unsafe {
        let e = ne_new(RATE, 1024, 0);
        let l: Vec<f32> = (0..100).map(|i| i as f32 / 100.0 * 2.0 - 1.0).collect();
        let r: Vec<f32> = l.iter().map(|v| -v).collect();
        assert_eq!(ne_add(e, 1, NE_SOUND_SOURCE, 0.0, 0.0), 0);
        assert_eq!(ne_add(e, 2, NE_PLAYER, 1.0, 0.0), 0);
        assert_eq!(ne_connect(e, 1, 0, 2, 0), 0);
        assert_eq!(ne_connect_out(e, 2, 0), 0);
        assert_eq!(ne_commit(e, 0), 1);
        assert_eq!(ne_load_sound(e, 0, 1, l.as_ptr(), r.as_ptr(), 100, RATE), 1, "version 1");
        assert_eq!(ne_point_sound(e, 0, 1, 0, 1, 1), 3);
        let (out_l, out_r) = render(e, 256, 64);
        assert_eq!(&out_l[..100], &l[..]);
        assert_eq!(&out_r[..100], &r[..]);
        assert_eq!(out_l[100], -1.0);
        assert_eq!(ne_load_sound(e, 0, 0, l.as_ptr(), r.as_ptr(), 100, RATE), -8);
        ne_free(e);
    }
}

#[test]
fn a_note_sent_through_c_is_heard() {
    unsafe {
        let e = ne_new(RATE, 1024, 0);
        assert_eq!(ne_add(e, 1, NE_KEYS, 0.0, 0.0), 0);
        assert_eq!(ne_add(e, 2, NE_VOICE, 0.0, 0.0), 0);
        assert_eq!(ne_connect(e, 1, 0, 2, 0), 0);
        assert_eq!(ne_connect_out(e, 2, 0), 0);
        assert_eq!(ne_commit(e, 0), 1);
        let (quiet, _) = render(e, 512, 128);
        assert!(quiet.iter().all(|v| *v == 0.0));
        assert_eq!(ne_note(e, 0, 1, 1, 69, 1.0), 2);
        let (l, _) = render(e, 512, 128);
        assert!(l.iter().any(|v| v.abs() > 0.2));
        ne_free(e);
    }
}
