//! idMLab's modules inside the native engine, each checked against idMLab's
//! own engine, sample for sample.
//!
//! idMLab puts one sample of delay on every cable and the native engine puts
//! none. Wherever that changes what is heard, a test here says exactly how.

use dsp_core::engine::{Engine as Lab, PortRef as LabPort};
use dsp_core::modules::ModuleKind;
use engine_core::basics::{Delay, Keys};
use engine_core::*;
use engine_idmlab::{WrapError, Wrapped};
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::sync::Arc;

const RATE: f32 = 48_000.0;
const N: usize = 6000;

// Knob numbers, from idMLab's modules.rs.
const HOST_SAMPLE: usize = 0;
const GAIN: usize = 0;
const GAIN_LEVEL: usize = 1;
const DELAY_FEEDBACK: usize = 1;
const DELAY_MIX: usize = 2;
const DELAY_LEVEL: usize = 3;
const CRUSH_LEVEL: usize = 3;
const ADSR_AMOUNT: usize = 4;
const SYNTH_LEVEL: usize = 0;

// ---- The allocation check (see engine-core's rt_check test).

thread_local! {
    static IN_RENDER: Cell<usize> = const { Cell::new(0) };
}

struct Counting;

fn count() {
    if engine_core::rt::in_audio() {
        let _ = IN_RENDER.try_with(|n| n.set(n.get() + 1));
    }
}

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        count();
        System.alloc(layout)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        count();
        System.dealloc(ptr, layout)
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

fn counted() -> usize {
    IN_RENDER.with(|n| n.get())
}

// ---- Helpers.

fn exact() -> Config {
    Config { fade_frames: 0, ..Config::default() }
}

fn noise(n: usize) -> Vec<f32> {
    let mut seed = 12345u32;
    (0..n)
        .map(|_| {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (seed >> 8) as f32 / 16_777_216.0 - 0.5
        })
        .collect()
}

/// Silence for the first 1000 samples, while every module's own start-up
/// ramps run, then noise.
fn late_noise(n: usize) -> Vec<f32> {
    let mut x = noise(n);
    x[..1000].fill(0.0);
    x
}

fn delayed(x: &[f32], by: usize) -> Vec<f32> {
    let mut out = vec![0.0; x.len()];
    out[by..].copy_from_slice(&x[..x.len() - by]);
    out
}

fn assert_same(name: &str, a: &[f32], b: &[f32]) {
    assert_eq!(a.len(), b.len(), "{name}: lengths differ");
    for i in 0..a.len() {
        assert!(a[i].to_bits() == b[i].to_bits(), "{name}: first difference at sample {i}: {} against {}", a[i], b[i]);
    }
}

fn peak(a: &[f32]) -> f32 {
    a.iter().fold(0.0, |m, v| m.max(v.abs()))
}

/// Plays a list of samples, the same on both sides.
struct Feed {
    data: Arc<Vec<f32>>,
    at: usize,
}

fn feed(data: Vec<f32>) -> Box<Feed> {
    Box::new(Feed { data: Arc::new(data), at: 0 })
}

impl Module for Feed {
    fn inputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn process(&mut self, io: &mut Io) {
        let (l, r) = io.outs.audio(0);
        for i in 0..l.len() {
            let v = self.data.get(self.at).copied().unwrap_or(0.0);
            l[i] = v;
            r[i] = v;
            self.at += 1;
        }
    }
}

/// A control cable made audible, so a test can read it at the output.
struct ControlToAudio;

impl Module for ControlToAudio {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Control]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn process(&mut self, io: &mut Io) {
        let values = io.ins.control(0);
        let (l, r) = io.outs.audio(0);
        l.copy_from_slice(values);
        r.copy_from_slice(values);
    }
}

fn render(audio: &mut AudioEngine, frames: usize, block: usize) -> (Vec<f32>, Vec<f32>) {
    let mut l = vec![0.0; frames];
    let mut r = vec![0.0; frames];
    let mut pos = 0;
    while pos < frames {
        let n = block.min(frames - pos);
        audio.render(&mut l[pos..pos + n], &mut r[pos..pos + n]);
        pos += n;
    }
    (l, r)
}

fn wrapped(kind: ModuleKind) -> Wrapped {
    Wrapped::new(kind, 0, RATE).unwrap()
}

fn lab_port(module: u32, port: u8) -> LabPort {
    LabPort { module, port }
}

fn lab_add(lab: &mut Lab, kind: ModuleKind) -> u32 {
    lab.add(kind.build_at(RATE))
}

/// idMLab's own engine, a sample a step: `x` goes in at its host input, and
/// one module's output is read after each step.
fn lab_run(lab: &mut Lab, host: u32, x: &[f32], read: (u32, usize)) -> Vec<f32> {
    x.iter()
        .map(|v| {
            lab.set_param(host, HOST_SAMPLE, *v);
            lab.process();
            lab.output_of(read.0, read.1)
        })
        .collect()
}

// ---- One module.

#[test]
fn a_wrapped_gain_is_idmlabs_gain() {
    let x = noise(N);
    let mut lab = Lab::new(RATE);
    let host = lab_add(&mut lab, ModuleKind::HostInput);
    let gain = lab_add(&mut lab, ModuleKind::Gain);
    lab.set_param(gain, GAIN, 0.5);
    lab.set_param(gain, GAIN_LEVEL, 1.0);
    assert!(lab.connect(lab_port(host, 0), lab_port(gain, 0)));
    let theirs = lab_run(&mut lab, host, &x, (gain, 0));

    // idMLab's gain hears its input one sample late (the cable). Give ours
    // the same input one sample late and the two are the same, start-up ramp
    // and all.
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, feed(delayed(&x, 1))).unwrap();
    ctl.add(2, Box::new(wrapped(ModuleKind::Gain).set(GAIN, 0.5))).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    let (l, r) = render(&mut audio, N, 256);
    assert!(peak(&l) > 0.2);
    assert_same("left", &theirs, &l);
    assert_same("right is the same module again", &l, &r);
}

#[test]
fn a_knob_moved_while_playing_lands_as_in_idmlab() {
    let x = noise(N);
    let mut lab = Lab::new(RATE);
    let host = lab_add(&mut lab, ModuleKind::HostInput);
    let gain = lab_add(&mut lab, ModuleKind::Gain);
    lab.set_param(gain, GAIN_LEVEL, 1.0);
    lab.connect(lab_port(host, 0), lab_port(gain, 0));
    let theirs: Vec<f32> = x
        .iter()
        .enumerate()
        .map(|(i, v)| {
            if i == 3000 {
                lab.set_param(gain, GAIN, 0.25);
            }
            lab.set_param(host, HOST_SAMPLE, *v);
            lab.process();
            lab.output_of(gain, 0)
        })
        .collect();

    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, feed(delayed(&x, 1))).unwrap();
    ctl.add(2, Box::new(wrapped(ModuleKind::Gain))).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    ctl.send_at(3000, 2, EventKind::Param { index: GAIN as u32, value: 0.25 }).unwrap();
    let (l, _) = render(&mut audio, N, 256);
    assert_same("left", &theirs, &l);
}

// ---- What the missing cable delay changes.

#[test]
fn a_chain_is_idmlabs_chain_three_samples_sooner() {
    let x = late_noise(N);
    let mut lab = Lab::new(RATE);
    let host = lab_add(&mut lab, ModuleKind::HostInput);
    let gain = lab_add(&mut lab, ModuleKind::Gain);
    let delay = lab_add(&mut lab, ModuleKind::Delay);
    let crush = lab_add(&mut lab, ModuleKind::Bitcrusher);
    lab.set_param(gain, GAIN, 0.5);
    lab.set_param(gain, GAIN_LEVEL, 1.0);
    lab.set_param(delay, DELAY_FEEDBACK, 0.3);
    lab.set_param(delay, DELAY_MIX, 0.5);
    lab.set_param(delay, DELAY_LEVEL, 1.0);
    lab.set_param(crush, CRUSH_LEVEL, 1.0);
    lab.connect(lab_port(host, 0), lab_port(gain, 0));
    lab.connect(lab_port(gain, 0), lab_port(delay, 0));
    lab.connect(lab_port(delay, 0), lab_port(crush, 0));
    let theirs = lab_run(&mut lab, host, &x, (crush, 0));

    let (l, _) = our_chain(&x, 256);
    assert!(peak(&l) > 0.05);
    // Three cables in idMLab, so three samples.
    assert_same("left", &theirs[3..], &l[..N - 3]);
}

fn our_chain(x: &[f32], block: usize) -> (Vec<f32>, Vec<f32>) {
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, feed(x.to_vec())).unwrap();
    ctl.add(2, Box::new(wrapped(ModuleKind::Gain).set(GAIN, 0.5))).unwrap();
    ctl.add(3, Box::new(wrapped(ModuleKind::Delay).set(DELAY_FEEDBACK, 0.3).set(DELAY_MIX, 0.5))).unwrap();
    ctl.add(4, Box::new(wrapped(ModuleKind::Bitcrusher))).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect(port(2, 0), port(3, 0)).unwrap();
    ctl.connect(port(3, 0), port(4, 0)).unwrap();
    ctl.connect_out(port(4, 0)).unwrap();
    ctl.commit().unwrap();
    render(&mut audio, x.len(), block)
}

#[test]
fn two_paths_that_meet_again_no_longer_comb() {
    // The same sound straight into a module and through two others first.
    // In idMLab the long way round arrives two samples after the short way,
    // which notches the treble. Here the two arrive together.
    let x = late_noise(N);
    let mut lab = Lab::new(RATE);
    let host = lab_add(&mut lab, ModuleKind::HostInput);
    let a = lab_add(&mut lab, ModuleKind::Gain);
    let b = lab_add(&mut lab, ModuleKind::Gain);
    let c = lab_add(&mut lab, ModuleKind::Gain);
    for g in [a, b, c] {
        lab.set_param(g, GAIN_LEVEL, 1.0);
    }
    lab.connect(lab_port(host, 0), lab_port(a, 0));
    lab.connect(lab_port(a, 0), lab_port(b, 0));
    lab.connect(lab_port(host, 0), lab_port(c, 0));
    lab.connect(lab_port(b, 0), lab_port(c, 0));
    let theirs = lab_run(&mut lab, host, &x, (c, 0));

    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, feed(x.clone())).unwrap();
    for id in [2, 3, 4] {
        ctl.add(id, Box::new(wrapped(ModuleKind::Gain))).unwrap();
    }
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect(port(2, 0), port(3, 0)).unwrap();
    ctl.connect(port(1, 0), port(4, 0)).unwrap();
    ctl.connect(port(3, 0), port(4, 0)).unwrap();
    ctl.connect_out(port(4, 0)).unwrap();
    ctl.commit().unwrap();
    let (ours, _) = render(&mut audio, N, 256);

    for i in 3..N {
        assert_eq!(theirs[i], x[i - 1] + x[i - 3], "idMLab, sample {i}: the short way and the long way, two samples apart");
        assert_eq!(ours[i], x[i] + x[i], "here, sample {i}: both at once");
    }
}

#[test]
fn a_loop_through_a_one_sample_delay_is_idmlabs_loop() {
    // idMLab lets a module feed itself: the cable is the delay. Here the loop
    // goes through a one-sample delay module and does the same thing.
    let x = noise(N);
    let mut lab = Lab::new(RATE);
    let host = lab_add(&mut lab, ModuleKind::HostInput);
    let gain = lab_add(&mut lab, ModuleKind::Gain);
    lab.set_param(gain, GAIN, 0.5);
    lab.set_param(gain, GAIN_LEVEL, 1.0);
    lab.connect(lab_port(host, 0), lab_port(gain, 0));
    lab.connect(lab_port(gain, 0), lab_port(gain, 0));
    let theirs = lab_run(&mut lab, host, &x, (gain, 0));

    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, feed(delayed(&x, 1))).unwrap();
    ctl.add(2, Box::new(wrapped(ModuleKind::Gain).set(GAIN, 0.5))).unwrap();
    ctl.add(3, Box::new(Delay::new(1))).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect(port(2, 0), port(3, 0)).unwrap();
    ctl.connect(port(3, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    let (l, _) = render(&mut audio, N, 256);
    assert!(peak(&l) > 0.2);
    assert_same("left", &theirs, &l);
}

// ---- Modulation and notes.

#[test]
fn an_lfo_turning_a_knob_is_idmlabs_one_sample_sooner() {
    let x = noise(N);
    let mut lab = Lab::new(RATE);
    let host = lab_add(&mut lab, ModuleKind::HostInput);
    let gain = lab_add(&mut lab, ModuleKind::Gain);
    let lfo = lab_add(&mut lab, ModuleKind::Lfo);
    lab.set_param(gain, GAIN_LEVEL, 1.0);
    lab.set_param(lfo, 0, 40.0);
    lab.connect(lab_port(host, 0), lab_port(gain, 0));
    assert!(lab.connect_param(lab_port(lfo, 0), gain, GAIN, 0.5, 0.0, 2.0));
    let theirs = lab_run(&mut lab, host, &x, (gain, 0));

    // idMLab's knob hears the LFO one sample late, as its input hears the
    // sound. Start our LFO one sample late and delay our input by one, and
    // the two are the same.
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, feed(delayed(&x, 1))).unwrap();
    ctl.add(2, Box::new(wrapped(ModuleKind::Gain).route(GAIN, 0.5, 0.0, 2.0))).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    ctl.add(3, Box::new(wrapped(ModuleKind::Lfo).set(0, 40.0))).unwrap();
    ctl.connect(port(3, 0), port(2, 1)).unwrap();
    ctl.commit_at(1).unwrap();
    let (l, _) = render(&mut audio, N, 256);
    assert_same("left", &theirs, &l);

    // And the LFO is doing something: without it the gain would be steady.
    let steady: Vec<f32> = delayed(&x, 1).iter().map(|v| v * 1.0).collect();
    assert!(l[2000..].iter().zip(&steady[2000..]).any(|(a, b)| (a - b).abs() > 0.05));
}

#[test]
fn notes_open_idmlabs_envelope_on_their_sample() {
    let mut lab = Lab::new(RATE);
    let adsr = lab_add(&mut lab, ModuleKind::GateAdsr);
    lab.set_param(adsr, ADSR_AMOUNT, 1.0);
    let theirs: Vec<f32> = (0..N)
        .map(|i| {
            if i == 500 {
                lab.note_on(adsr, 60, 1.0, 0.0);
            }
            if i == 2000 {
                lab.note_off(adsr, 60);
            }
            lab.process();
            lab.output_of(adsr, 0)
        })
        .collect();

    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Keys::new())).unwrap();
    ctl.add(2, Box::new(wrapped(ModuleKind::GateAdsr).set(ADSR_AMOUNT, 1.0))).unwrap();
    ctl.add(3, Box::new(ControlToAudio)).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect(port(2, 0), port(3, 0)).unwrap();
    ctl.connect_out(port(3, 0)).unwrap();
    ctl.commit().unwrap();
    ctl.send_at(500, 1, EventKind::Note(NoteEvent::on(60, 1.0))).unwrap();
    ctl.send_at(2000, 1, EventKind::Note(NoteEvent::off(60))).unwrap();
    let (l, _) = render(&mut audio, N, 256);
    assert_eq!(l[499], 0.0);
    assert!(peak(&l) > 0.5, "the envelope opened: {}", peak(&l));
    assert_same("the envelope", &theirs, &l);
}

fn our_synth(block: usize) -> (Vec<f32>, Vec<f32>) {
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Keys::new())).unwrap();
    ctl.add(2, Box::new(wrapped(ModuleKind::Synth))).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    ctl.send_at(100, 1, EventKind::Note(NoteEvent::on(57, 0.9))).unwrap();
    ctl.send_at(1500, 1, EventKind::Note(NoteEvent::on(64, 0.7))).unwrap();
    ctl.send_at(3000, 1, EventKind::Note(NoteEvent::off(57))).unwrap();
    render(&mut audio, N, block)
}

#[test]
fn the_synth_plays_as_it_does_in_idmlab() {
    let mut lab = Lab::new(RATE);
    let synth = lab_add(&mut lab, ModuleKind::Synth);
    lab.set_param(synth, SYNTH_LEVEL, 1.0);
    let mut theirs_l = Vec::new();
    let mut theirs_r = Vec::new();
    for i in 0..N {
        match i {
            100 => lab.note_on(synth, 57, 0.9, 0.0),
            1500 => lab.note_on(synth, 64, 0.7, 0.0),
            3000 => lab.note_off(synth, 57),
            _ => {}
        }
        lab.process();
        theirs_l.push(lab.output_of(synth, 0));
        theirs_r.push(lab.output_of(synth, 1));
    }
    let (l, r) = our_synth(256);
    assert!(peak(&l) > 0.01, "the synth is heard: {}", peak(&l));
    assert_same("left", &theirs_l, &l);
    assert_same("right", &theirs_r, &r);
}

/// A note in every octave, each the first to need its tables. The adapter has
/// them built before the module is heard (`Module::build_tables`); idMLab's
/// own engine builds each the first time a note asks. The sound is the same.
#[test]
fn tables_built_ahead_play_as_idmlab_builds_them() {
    const FRAMES: usize = 9 * 2400;
    let notes: Vec<(usize, u8)> = (0..9).map(|i| (i * 2400 + 50, 21 + 12 * i as u8)).collect();
    let mut lab = Lab::new(RATE);
    let synth = lab_add(&mut lab, ModuleKind::Synth);
    lab.set_param(synth, SYNTH_LEVEL, 1.0);
    let (mut theirs_l, mut theirs_r) = (Vec::new(), Vec::new());
    for i in 0..FRAMES {
        for &(at, note) in &notes {
            if i == at {
                lab.note_on(synth, note, 0.8, 0.0);
            }
            if i == at + 1800 {
                lab.note_off(synth, note);
            }
        }
        lab.process();
        theirs_l.push(lab.output_of(synth, 0));
        theirs_r.push(lab.output_of(synth, 1));
    }
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Keys::new())).unwrap();
    ctl.add(2, Box::new(wrapped(ModuleKind::Synth))).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    for &(at, note) in &notes {
        ctl.send_at(at as u64, 1, EventKind::Note(NoteEvent::on(note, 0.8))).unwrap();
        ctl.send_at((at + 1800) as u64, 1, EventKind::Note(NoteEvent::off(note))).unwrap();
    }
    let (l, r) = render(&mut audio, FRAMES, 64);
    assert!(peak(&l) > 0.01, "the synth is heard");
    assert_same("left", &theirs_l, &l);
    assert_same("right", &theirs_r, &r);
}

/// What the first note in each octave costs the block it starts in, with the
/// tables built ahead. A measurement: `--release -- --ignored --nocapture`.
#[test]
#[ignore]
fn the_first_note_of_each_octave_costs() {
    let mut worst = Vec::new();
    for _ in 0..5 {
        let (mut ctl, mut audio) = engine(RATE, exact());
        ctl.add(1, Box::new(Keys::new())).unwrap();
        ctl.add(2, Box::new(wrapped(ModuleKind::Synth))).unwrap();
        ctl.connect(port(1, 0), port(2, 0)).unwrap();
        ctl.connect_out(port(2, 0)).unwrap();
        ctl.commit().unwrap();
        for i in 0..9u64 {
            ctl.send_at(i * 2432 + 64, 1, EventKind::Note(NoteEvent::on(21 + 12 * i as u8, 0.8))).unwrap();
        }
        let (mut l, mut r) = (vec![0.0; 64], vec![0.0; 64]);
        let mut most = 0f64;
        for block in 0..(9 * 2432 / 64) {
            let t = std::time::Instant::now();
            audio.render(&mut l, &mut r);
            let took = t.elapsed().as_secs_f64() * 1e6;
            if block % (2432 / 64) == 1 {
                most = most.max(took);
            }
        }
        worst.push(most);
    }
    worst.sort_by(f64::total_cmp);
    println!("worst block with a note-on, of five runs: median {:.1} us, best {:.1}, worst {:.1}", worst[2], worst[0], worst[4]);
}

// ---- Every kind carried, and the rules every module here must keep.

#[test]
fn every_effect_carried_passes_sound() {
    use ModuleKind::*;
    for kind in [Gain, Delay, Eq, Bitcrusher, Reverb, Compressor, Limiter, Widener, Blackhole, Dp4Reverb, Dp4NonLin] {
        let (mut ctl, mut audio) = engine(RATE, exact());
        ctl.add(1, feed(noise(24_000))).unwrap();
        ctl.add(2, Box::new(wrapped(kind))).unwrap();
        ctl.connect(port(1, 0), port(2, 0)).unwrap();
        ctl.connect_out(port(2, 0)).unwrap();
        ctl.commit().unwrap();
        let (l, r) = render(&mut audio, 24_000, 256);
        assert!(peak(&l[12_000..]) > 1.0e-3 && peak(&r[12_000..]) > 1.0e-3, "{kind:?} is silent");
        assert!(l.iter().chain(&r).all(|v| v.is_finite()), "{kind:?} made something that is not a number");
    }
}

#[test]
fn kinds_that_need_the_sample_bank_are_refused_for_now() {
    use ModuleKind::*;
    for kind in [Percussion, Looper, Granular, GrainEngine, HostInput, AudioOutput] {
        assert_eq!(Wrapped::new(kind, 0, RATE).err(), Some(WrapError::NotYet(kind)));
    }
}

#[test]
fn the_block_size_does_not_change_idmlabs_modules() {
    let x = late_noise(N);
    let (chain, _) = our_chain(&x, 256);
    let (synth_l, synth_r) = our_synth(256);
    for block in [1, 7, 64, 1000] {
        assert_same(&format!("chain, blocks of {block}"), &chain, &our_chain(&x, block).0);
        let (l, r) = our_synth(block);
        assert_same(&format!("synth left, blocks of {block}"), &synth_l, &l);
        assert_same(&format!("synth right, blocks of {block}"), &synth_r, &r);
    }
}

/// A module that allocates, to prove the check is switched on.
struct Careless;

impl Module for Careless {
    fn inputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn process(&mut self, io: &mut Io) {
        std::hint::black_box(vec![0u8; io.n]);
    }
}

#[test]
fn idmlabs_modules_do_not_allocate_on_the_audio_thread() {
    // First, that the check works at all (it needs --features engine-core/rt-check).
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Careless)).unwrap();
    ctl.commit().unwrap();
    let before = counted();
    render(&mut audio, 256, 64);
    assert!(counted() > before, "the allocation check is off: run with --features engine-core/rt-check");

    use ModuleKind::*;
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, feed(noise(48_000))).unwrap();
    let mut last = 1;
    for (id, kind) in [Gain, Delay, Eq, Bitcrusher, Compressor, Limiter, Widener, Reverb, Blackhole, Dp4Reverb, Dp4NonLin].into_iter().enumerate() {
        let id = id as u32 + 2;
        ctl.add(id, Box::new(wrapped(kind))).unwrap();
        ctl.connect(port(last, 0), port(id, 0)).unwrap();
        last = id;
    }
    ctl.connect_out(port(last, 0)).unwrap();
    ctl.add(20, Box::new(Keys::new())).unwrap();
    ctl.add(21, Box::new(wrapped(Synth))).unwrap();
    ctl.add(22, Box::new(wrapped(GateAdsr).set(ADSR_AMOUNT, 1.0))).unwrap();
    ctl.add(23, Box::new(wrapped(Lfo))).unwrap();
    ctl.add(24, Box::new(wrapped(Gain).route(GAIN, 0.5, 0.0, 2.0))).unwrap();
    ctl.add(25, Box::new(wrapped(Gain).route(GAIN, 0.5, 0.0, 2.0))).unwrap();
    ctl.add(26, Box::new(wrapped(EnvelopeFollower))).unwrap();
    ctl.connect(port(20, 0), port(21, 0)).unwrap();
    ctl.connect(port(20, 0), port(22, 0)).unwrap();
    ctl.connect(port(21, 0), port(24, 0)).unwrap();
    ctl.connect(port(23, 0), port(24, 1)).unwrap();
    ctl.connect(port(24, 0), port(25, 0)).unwrap();
    ctl.connect(port(22, 0), port(25, 1)).unwrap();
    ctl.connect(port(21, 0), port(26, 0)).unwrap();
    ctl.connect_out(port(25, 0)).unwrap();
    ctl.commit().unwrap();
    for (i, note) in [48u8, 55, 60, 64, 67].into_iter().enumerate() {
        ctl.send_at(1000 + 4000 * i as u64, 20, EventKind::Note(NoteEvent::on(note, 0.8))).unwrap();
        ctl.send_at(3000 + 4000 * i as u64, 20, EventKind::Note(NoteEvent::off(note))).unwrap();
    }
    let before = counted();
    let (l, _) = render(&mut audio, 48_000, 128);
    assert!(peak(&l) > 1.0e-3, "the patch is heard");
    assert_eq!(counted() - before, 0, "allocations or frees inside a render");
}
