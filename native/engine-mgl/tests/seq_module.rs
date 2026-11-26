//! Seq's module: its steps play what Classic plays when the page's
//! scheduler lays them by hand, sample for sample and whatever the host's
//! blocks; its notes out are the steps; its keys play Classic in Seq's
//! tuning; its knobs are the page's handlers; and nothing allocates on the
//! audio thread.

mod common;
use common::*;
use engine_core::*;
use engine_mgl::seq::module::{knob, step_knob, KEYS, DEFAULTS, KNOBS};
use engine_mgl::seq::{steps, Classic, Settings};
use engine_mgl::{SeqModule, SeqView};
use std::sync::{Arc, Mutex};

const TET: [f64; 12] = [0.0, 100.0, 200.0, 300.0, 400.0, 500.0, 600.0, 700.0, 800.0, 900.0, 1000.0, 1100.0];
const PYTH: [f64; 7] = [0.0, 203.91, 407.82, 498.04, 701.96, 905.87, 1109.78];

fn scales() -> Vec<Vec<f64>> {
    vec![TET.to_vec(), PYTH.to_vec()]
}

/// Classic as `togglePlay` and `scheduler` play it, laid by hand: the steps'
/// degrees `i % 7`, eight of them, forward, from 50 ms.
fn by_hand(frames: usize, cents: &[f64]) -> (Vec<f32>, Vec<f32>) {
    let mut c = Classic::new(RATE, Settings::page());
    let (mut ol, mut or) = (Vec::new(), Vec::new());
    let mut next = 0.05f64;
    let mut k = 0usize;
    let mut frame = 0u64;
    let (mut l, mut r) = ([0.0f32; 128], [0.0f32; 128]);
    while ol.len() < frames {
        let end = (frame + 128) as f64 / RATE as f64;
        while next < end {
            let degree = ((k % 8) % 7) as i32;
            c.play_note(steps::degree_hz(cents, 440.0, degree), next, 1.0);
            next += c.s.step_dur();
            k += 1;
        }
        c.render(&mut l, &mut r);
        ol.extend_from_slice(&l);
        or.extend_from_slice(&r);
        frame += 128;
    }
    ol.truncate(frames);
    or.truncate(frames);
    (ol, or)
}

fn module_render(m: SeqModule, frames: usize, block: usize) -> (Vec<f32>, Vec<f32>) {
    boxed_render(Box::new(m), frames, block)
}

fn boxed_render(m: Box<dyn Module>, frames: usize, block: usize) -> (Vec<f32>, Vec<f32>) {
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, m).unwrap();
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit().unwrap();
    render(&mut audio, frames, block)
}

#[test]
fn the_steps_play_what_classic_plays_whatever_the_blocks() {
    const N: usize = 3 * 48_000;
    let (hl, hr) = by_hand(N, &TET);
    assert!(peak(&hl) > 0.01, "Classic is heard");
    for block in [128, 7, 1000, 333] {
        let m = SeqModule::new(RATE, scales()).set("play", 1.0);
        let (l, r) = module_render(m, N + 128, block);
        // A quantum late.
        assert!(l[..128].iter().all(|v| *v == 0.0));
        assert_same(&format!("left, blocks of {block}"), &hl, &l[128..]);
        assert_same(&format!("right, blocks of {block}"), &hr, &r[128..]);
    }
}

#[test]
fn the_scale_root_and_steps_are_the_pages() {
    const N: usize = 2 * 48_000;
    // Pythagorean from C3 (root 0, octave 3): what the page plays.
    let root = steps::root_hz(0, 3);
    assert!((root - 130.8127826502993).abs() < 1e-9, "{root}");
    let cents = PYTH;
    let mut c = Classic::new(RATE, Settings::page());
    let degrees = [0, 3, 5, 2];
    let (mut hl, mut l, mut r) = (Vec::new(), [0.0f32; 128], [0.0f32; 128]);
    let (mut next, mut k, mut frame) = (0.05f64, 0usize, 0u64);
    while hl.len() < N {
        let end = (frame + 128) as f64 / RATE as f64;
        while next < end {
            c.play_note(steps::degree_hz(&cents, root, degrees[k % 4]), next, 1.0);
            next += c.s.step_dur();
            k += 1;
        }
        c.render(&mut l, &mut r);
        hl.extend_from_slice(&l);
        frame += 128;
    }
    let mut m = SeqModule::new(RATE, scales()).set("scale", 1.0).set("root", 0.0).set("octave", 3.0).set("steps", 4.0);
    for (i, d) in degrees.iter().enumerate() {
        m = m.set(&format!("step{i}"), *d as f64);
    }
    let (ml, _) = module_render(m.set("play", 1.0), N + 128, 256);
    assert_same("left", &hl[..N], &ml[128..]);
}

#[test]
fn a_rest_is_silent_and_every_knob_has_a_name() {
    assert_eq!(KEYS.len(), DEFAULTS.len());
    assert_eq!(knob("bpm"), Some(0));
    assert_eq!(knob("step0"), Some(step_knob(0, false)));
    assert_eq!(knob("rest63"), Some(step_knob(63, true)));
    assert_eq!(knob("step64"), None);
    assert_eq!(step_knob(63, true) as usize, KNOBS - 1);
    let mut m = SeqModule::new(RATE, scales());
    for i in 0..8 {
        m = m.set(&format!("rest{i}"), 1.0);
    }
    let (l, _) = module_render(m.set("play", 1.0), 48_000, 128);
    assert_eq!(peak(&l), 0.0, "every step rests");
}

/// Records the notes it is sent.
struct Notes(Arc<Mutex<Vec<(u64, NoteEvent)>>>);

impl Module for Notes {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Notes]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn process(&mut self, io: &mut Io) {
        let start = io.frame;
        let mut v = self.0.lock().unwrap();
        for n in io.ins.notes(0) {
            v.push((start + n.offset as u64, *n));
        }
        let (l, r) = io.outs.audio(0);
        l.fill(0.0);
        r.fill(0.0);
    }
}

#[test]
fn the_notes_out_are_the_steps_with_the_sound() {
    let got = Arc::new(Mutex::new(Vec::new()));
    let view = SeqView::new();
    let m = SeqModule::with_view(RATE, scales(), view.clone()).set("play", 1.0);
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(m)).unwrap();
    ctl.add(2, Box::new(Notes(got.clone()))).unwrap();
    ctl.connect(port(1, 1), port(2, 0)).unwrap();
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    render(&mut audio, 2 * 48_000, 300);
    let got = got.lock().unwrap();
    let ons: Vec<_> = got.iter().filter(|(_, n)| n.kind == NoteKind::On).collect();
    // Steps at 0.05 s and every 0.25 s after, heard a quantum late.
    assert_eq!(ons.len(), 8, "{ons:?}");
    for (k, (f, n)) in ons.iter().enumerate() {
        let t = 0.05 + 0.25 * k as f64;
        assert_eq!(*f, (t * RATE as f64).round() as u64 + 128, "step {k}");
        assert_eq!(n.note, 69 + ((k % 8) % 7) as u8, "step {k}");
        assert!(n.detune_cents.abs() < 1e-3);
    }
    let offs = got.iter().filter(|(_, n)| n.kind == NoteKind::Off).count();
    assert!(offs >= 7, "{offs}");
    assert!(view.playing());
    let (step, hz, deg) = view.now().expect("a step was heard");
    assert_eq!((step, deg), (7, 0));
    assert!((hz - 440.0).abs() < 1e-3);
    assert_eq!(view.count(), 8);
}

#[test]
fn a_key_plays_classic_in_seqs_tuning() {
    // Pythagorean on A4: key 71 (B4) is its second degree, 203.91 cents up.
    let hz = steps::key_hz(&PYTH, 440.0, 71, 9, 4).unwrap();
    assert!((hz - 440.0 * 2f64.powf(203.91 / 1200.0)).abs() < 1e-9);
    let m = SeqModule::new(RATE, scales()).set("scale", 1.0);
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Script::new(vec![(1_000, NoteEvent::on(71, 0.8)), (20_000, NoteEvent::off(71))]))).unwrap();
    ctl.add(2, Box::new(m)).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    let (l, _) = render(&mut audio, 48_000, 128);
    assert!(l[..1_000].iter().all(|v| *v == 0.0));
    assert!(peak(&l[1_000..20_000]) > 0.01, "the key is heard");
    // Let go: what is left is the delay's and Space's tails.
    assert!(peak(&l[40_000..]) < 0.5 * peak(&l[1_000..20_000]), "and let go");
}

#[test]
fn a_knob_moved_is_the_pages_handler() {
    // The cutoff knob at 50 is 20 x 1000^0.5 Hz, Q from Reso's 10.
    let mut m = SeqModule::new(RATE, scales()).set("cutoff", 50.0);
    assert!((m.classic().s.cutoff - 20.0 * 1000f64.powf(0.5)).abs() < 1e-9);
    assert!((m.classic().s.q - 2.09).abs() < 1e-12);
    // Never moved, LFO 2's rate is the page's literal; moving its depth reads
    // its rate slider too, as updateLFO does.
    assert_eq!(m.classic().s.lfos[1].rate, 0.55);
    m = m.set("lfo2Depth", 30.0);
    assert!((m.classic().s.lfos[1].rate - 0.05 * 400f64.powf(0.4)).abs() < 1e-12);
    assert_eq!(m.classic().s.lfos[1].depth, 0.3);
    m = m.set("atk", 25.0);
    assert_eq!(m.classic().s.adsr.a, 25.0);
    assert_eq!(m.classic().s.adsr.s, 0.6);
    m = m.set("wave", 4.0).set("tapeSpeed", 4.0).set("delayHiCut", 50.0);
    assert_eq!(m.classic().s.wave, engine_mgl::seq::Shape::Pulse);
    assert_eq!(m.classic().s.tape_ips, 1.875);
    assert!((m.classic().s.delay.hi_cut - 2000.0).abs() < 1e-9);
}

#[test]
fn a_saved_module_plays_the_same() {
    let make = || {
        SeqModule::new(RATE, scales())
            .set("cutoff", 40.0)
            .set("wave", 2.0)
            .set("delayWet", 60.0)
            .set("bpm", 150.0)
            .set("dir", 2.0)
            .set("step3", 9.0)
            .set("play", 1.0)
    };
    let a = module_render(make(), 60_000, 128);
    let f = make().factory().unwrap();
    let b = boxed_render(f(RATE, 128), 60_000, 128);
    assert_same("left", &a.0, &b.0);
}

#[test]
fn the_module_allocates_nothing_while_it_plays() {
    assert_the_check_is_on();
    let m = SeqModule::new(RATE, scales()).set("wave", 4.0).set("play", 1.0);
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Script::new(vec![(5_000, NoteEvent::on(60, 0.8)), (30_000, NoteEvent::off(60))]))).unwrap();
    ctl.add(2, Box::new(m)).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    render(&mut audio, 4_800, 128);
    // Knobs moved while it plays, a new tempo's tape glide among them.
    for (k, v) in [("bpm", 90.0), ("cutoff", 30.0), ("delayTime", 1.0), ("lfo1Target", 3.0), ("lfo3Wave", 2.0), ("step2", 4.0)] {
        ctl.send(2, EventKind::Param { index: knob(k).unwrap(), value: v }).unwrap();
    }
    let before = counted();
    let (l, _) = render(&mut audio, 96_000, 128);
    assert!(peak(&l) > 0.01);
    assert_eq!(counted() - before, 0, "allocations or frees inside a render; the last sizes: {:?}", last_sizes());
}
