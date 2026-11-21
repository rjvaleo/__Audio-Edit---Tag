//! Changing the patch while it plays must not click: an audio or control
//! cable that appears fades in, and one that goes fades out.

mod common;
use common::*;
use engine_core::basics::*;
use engine_core::*;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// A power of two, so every step of a fade is an exact number.
const FADE: usize = 128;

fn step(k: usize) -> f32 {
    k as f32 / FADE as f32
}

fn dc_to_out() -> (Controller, AudioEngine) {
    let (mut ctl, audio) = engine(RATE, fading(FADE));
    ctl.add(1, Box::new(Dc(1.0))).unwrap();
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit().unwrap();
    (ctl, audio)
}

#[test]
fn a_new_patch_fades_in() {
    let (_ctl, mut audio) = dc_to_out();
    let (l, r) = render(&mut audio, 400, 64);
    for k in 0..400 {
        assert_eq!(l[k], if k < FADE { step(k) } else { 1.0 }, "sample {k}");
    }
    assert_same("both sides", &l, &r);
}

/// A constant that says when it has been freed.
struct Kept(f32, Arc<AtomicBool>);

impl Drop for Kept {
    fn drop(&mut self) {
        self.1.store(true, Ordering::Release);
    }
}

impl Module for Kept {
    fn inputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn process(&mut self, io: &mut Io) {
        let (l, r) = io.outs.audio(0);
        l.fill(self.0);
        r.fill(self.0);
    }
}

#[test]
fn a_removed_module_fades_out_and_is_then_freed() {
    let freed = Arc::new(AtomicBool::new(false));
    let (mut ctl, mut audio) = engine(RATE, fading(FADE));
    ctl.add(1, Box::new(Kept(1.0, freed.clone()))).unwrap();
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit().unwrap();
    let (before, _) = render(&mut audio, 256, 64);
    assert_eq!(before[255], 1.0);

    ctl.remove(1);
    ctl.commit().unwrap();
    let (mut l, _) = render(&mut audio, 64, 64);
    ctl.collect();
    assert!(!freed.load(Ordering::Acquire), "still sounding, so still alive");
    l.extend(render(&mut audio, 192, 64).0);
    for k in 0..256 {
        assert_eq!(l[k], if k < FADE { 1.0 - step(k) } else { 0.0 }, "sample {k}");
    }
    ctl.collect();
    assert!(freed.load(Ordering::Acquire), "freed once its fade was over, with no further patch change");
}

#[test]
fn swapping_one_source_for_another_never_dips() {
    let (mut ctl, mut audio) = engine(RATE, fading(FADE));
    ctl.add(1, Box::new(Dc(1.0))).unwrap();
    ctl.add(3, Box::new(Gain::new(1.0))).unwrap();
    ctl.connect(port(1, 0), port(3, 0)).unwrap();
    ctl.connect_out(port(3, 0)).unwrap();
    ctl.commit().unwrap();
    render(&mut audio, 256, 64);

    assert!(ctl.disconnect(port(1, 0), port(3, 0)));
    ctl.add(2, Box::new(Dc(1.0))).unwrap();
    ctl.connect(port(2, 0), port(3, 0)).unwrap();
    ctl.commit().unwrap();
    let (l, _) = render(&mut audio, 256, 64);
    assert!(l.iter().all(|v| *v == 1.0), "one fades out exactly as the other fades in");
}

#[test]
fn a_cable_plugged_between_playing_modules_fades_in() {
    let (mut ctl, mut audio) = dc_to_out();
    ctl.add(2, Box::new(Gain::new(1.0))).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    render(&mut audio, 256, 64);

    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.commit().unwrap();
    let (l, _) = render(&mut audio, 256, 64);
    for k in 0..256 {
        assert_eq!(l[k], if k < FADE { 1.0 + step(k) } else { 2.0 }, "sample {k}");
    }
}

#[test]
fn a_change_made_mid_fade_carries_on_from_where_the_fade_was() {
    let (mut ctl, mut audio) = dc_to_out();
    let (up, _) = render(&mut audio, 64, 64);
    assert_eq!(up[63], step(63));
    assert!(ctl.disconnect_out(port(1, 0)));
    ctl.commit().unwrap();
    let (down, _) = render(&mut audio, 128, 64);
    for k in 0..128 {
        assert_eq!(down[k], if k < 64 { 0.5 - step(k) } else { 0.0 }, "sample {k}");
    }
}

#[test]
fn a_cable_put_back_mid_fade_comes_back_up_from_there() {
    let (mut ctl, mut audio) = dc_to_out();
    render(&mut audio, 256, 64);
    assert!(ctl.disconnect_out(port(1, 0)));
    ctl.commit().unwrap();
    let (down, _) = render(&mut audio, 32, 32);
    assert_eq!(down[31], 1.0 - step(31));
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit().unwrap();
    // Long enough to pass the moment the first change's fade would have ended.
    let (up, _) = render(&mut audio, 256, 32);
    for k in 0..256 {
        assert_eq!(up[k], if k < 32 { 0.75 + step(k) } else { 1.0 }, "sample {k}");
    }
}

#[test]
fn a_second_change_does_not_cut_short_what_the_first_was_fading() {
    let (mut ctl, mut audio) = dc_to_out();
    render(&mut audio, 256, 64);
    ctl.remove(1);
    ctl.commit().unwrap();
    let (first, _) = render(&mut audio, 32, 32);
    assert_eq!(first[31], 1.0 - step(31));
    // Something unrelated, 32 frames into the fade.
    ctl.add(2, Box::new(Gain::new(1.0))).unwrap();
    ctl.commit().unwrap();
    let (rest, _) = render(&mut audio, 256, 32);
    for k in 0..256 {
        assert_eq!(rest[k], if k < 96 { 0.75 - step(k) } else { 0.0 }, "sample {k}");
    }
}

#[test]
fn a_fade_long_over_is_not_played_again_by_a_later_change() {
    // The app never collected, so the controller still thinks the removed
    // cable might be fading. It must not come back.
    let (mut ctl, mut audio) = dc_to_out();
    ctl.add(2, Box::new(Dc(0.5))).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    render(&mut audio, 512, 64);
    assert!(ctl.disconnect_out(port(2, 0)));
    ctl.commit().unwrap();
    render(&mut audio, 512, 64);
    ctl.add(3, Box::new(Gain::new(1.0))).unwrap();
    ctl.commit().unwrap();
    let (l, _) = render(&mut audio, 256, 64);
    assert!(l.iter().all(|v| *v == 1.0), "only the first constant is heard");
}

#[test]
fn notes_arrive_down_a_new_cable_at_once() {
    let (mut ctl, mut audio) = engine(RATE, fading(FADE));
    ctl.add(1, Box::new(Keys::new())).unwrap();
    ctl.add(2, Box::new(NoteProbe)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    render(&mut audio, 512, 64);
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.commit_at(600).unwrap();
    ctl.send_at(600, 1, EventKind::Note(NoteEvent::on(60, 1.0))).unwrap();
    let (l, _) = render(&mut audio, 512, 64);
    assert_eq!(l[600 - 512], 1.0, "notes do not fade");
    assert_eq!(l.iter().sum::<f32>(), 1.0);
}

#[test]
fn a_module_swapped_under_the_same_number_fades_in_afresh() {
    let (mut ctl, mut audio) = dc_to_out();
    render(&mut audio, 256, 64);
    ctl.remove(1);
    ctl.add(1, Box::new(Dc(0.5))).unwrap();
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit().unwrap();
    let (l, _) = render(&mut audio, 256, 64);
    for k in 0..256 {
        assert_eq!(l[k], if k < FADE { 0.5 * step(k) } else { 0.5 }, "sample {k}");
    }
}

#[test]
fn a_change_that_cannot_be_faded_still_lands() {
    // Turning a chain round: the old cables and the new together would make
    // a loop, so the old ones go at once and only the new ones fade.
    let (mut ctl, mut audio) = engine(RATE, fading(FADE));
    ctl.add(1, Box::new(Dc(1.0))).unwrap();
    ctl.add(2, Box::new(Gain::new(0.5))).unwrap();
    ctl.add(3, Box::new(Gain::new(0.5))).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect(port(2, 0), port(3, 0)).unwrap();
    ctl.connect_out(port(3, 0)).unwrap();
    ctl.commit().unwrap();
    render(&mut audio, 256, 64);

    ctl.disconnect(port(1, 0), port(2, 0));
    ctl.disconnect(port(2, 0), port(3, 0));
    ctl.disconnect_out(port(3, 0));
    ctl.connect(port(1, 0), port(3, 0)).unwrap();
    ctl.connect(port(3, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    let (l, _) = render(&mut audio, 512, 64);
    assert_eq!(l[0], 0.0);
    assert_eq!(l[511], 0.25);
}

fn busy(block: usize) -> Vec<f32> {
    let (mut ctl, mut audio) = engine(RATE, fading(100));
    ctl.add(1, Box::new(Sine::new(220.0, 0.4))).unwrap();
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit().unwrap();
    ctl.add(2, Box::new(Sine::new(331.0, 0.4))).unwrap();
    ctl.add(3, Box::new(Gain::new(0.7))).unwrap();
    ctl.connect(port(2, 0), port(3, 0)).unwrap();
    ctl.connect_out(port(3, 0)).unwrap();
    ctl.commit_at(1000).unwrap();
    ctl.remove(1);
    ctl.commit_at(2000).unwrap();
    ctl.disconnect(port(2, 0), port(3, 0));
    ctl.commit_at(2050).unwrap();
    ctl.connect(port(2, 0), port(3, 0)).unwrap();
    ctl.commit_at(2077).unwrap();
    render(&mut audio, 4000, block).0
}

#[test]
fn fades_do_not_depend_on_the_block_size() {
    let reference = busy(256);
    assert!(peak(&reference) > 0.2);
    for block in [1, 7, 64, 1000] {
        assert_same(&format!("blocks of {block}"), &reference, &busy(block));
    }
}

#[test]
fn a_fade_has_no_step_bigger_than_its_ramp() {
    // Sines coming and going: the biggest jump between two samples stays
    // close to what the sines themselves do.
    let out = busy(256);
    let quiet = (1..out.len()).map(|i| (out[i] - out[i - 1]).abs()).fold(0.0f32, f32::max);
    assert!(quiet < 0.06, "largest step between two samples: {quiet}");
}
