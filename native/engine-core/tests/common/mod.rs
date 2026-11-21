//! Shared by the tests: ways to render, the patch every "same samples" test
//! plays, and three tiny modules that make exact values easy to check.
#![allow(dead_code)]

use engine_core::basics::*;
use engine_core::*;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

pub const RATE: f32 = 48_000.0;

/// No fades: a patch change is heard whole from its first sample.
pub fn exact() -> Config {
    Config { fade_frames: 0, ..Config::default() }
}

/// Patch changes fade over this many frames.
pub fn fading(frames: usize) -> Config {
    Config { fade_frames: frames, ..Config::default() }
}

pub fn render(audio: &mut AudioEngine, frames: usize, block: usize) -> (Vec<f32>, Vec<f32>) {
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

fn next(seed: &mut u32) -> u32 {
    *seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
    *seed >> 8
}

/// Blocks of 1 to 700 samples, a different length each time.
pub fn render_uneven(audio: &mut AudioEngine, frames: usize, mut seed: u32) -> (Vec<f32>, Vec<f32>) {
    let mut l = vec![0.0; frames];
    let mut r = vec![0.0; frames];
    let mut pos = 0;
    while pos < frames {
        let n = (1 + next(&mut seed) as usize % 700).min(frames - pos);
        audio.render(&mut l[pos..pos + n], &mut r[pos..pos + n]);
        pos += n;
    }
    (l, r)
}

/// Equal to the last bit, and says where it first isn't.
pub fn assert_same(name: &str, a: &[f32], b: &[f32]) {
    assert_eq!(a.len(), b.len(), "{name}: lengths differ");
    for i in 0..a.len() {
        assert!(
            a[i].to_bits() == b[i].to_bits(),
            "{name}: first difference at sample {i}: {} against {}",
            a[i],
            b[i]
        );
    }
}

pub fn peak(a: &[f32]) -> f32 {
    a.iter().fold(0.0, |m, v| m.max(v.abs()))
}

/// A constant.
pub struct Dc(pub f32);

impl Module for Dc {
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

/// One sample of 1.0 on the very first frame, then silence.
pub struct Impulse {
    fired: bool,
}

impl Impulse {
    pub fn new() -> Self {
        Self { fired: false }
    }
}

impl Module for Impulse {
    fn inputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn process(&mut self, io: &mut Io) {
        let (l, r) = io.outs.audio(0);
        l.fill(0.0);
        r.fill(0.0);
        if !self.fired {
            l[0] = 1.0;
            r[0] = 1.0;
            self.fired = true;
        }
    }
}

/// Writes 1.0 on the sample each note-on arrives at.
pub struct NoteProbe;

impl Module for NoteProbe {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Notes]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn process(&mut self, io: &mut Io) {
        let notes = io.ins.notes(0);
        let (l, r) = io.outs.audio(0);
        l.fill(0.0);
        r.fill(0.0);
        for note in notes {
            if note.kind == NoteKind::On {
                l[note.offset as usize] = 1.0;
                r[note.offset as usize] = 1.0;
            }
        }
    }
}

pub fn ramp_sound(frames: usize) -> SoundData {
    let l: Vec<f32> = (0..frames).map(|i| i as f32 / frames as f32 * 2.0 - 1.0).collect();
    let r: Vec<f32> = l.iter().map(|v| -v).collect();
    SoundData { rate: RATE, l: l.into_boxed_slice(), r: r.into_boxed_slice() }
}

/// One of every cable type, two cables meeting at one input, and a loop.
///
///  1 sine ─► 2 gain ─► out          3 lfo ─► 2 gain's control input
///  4 clock ─► 5 pulse ─► 6 voice ─► out        7 keys ─► 6 voice
///  6 voice ─► 8 delay ─► out        8 delay ─► 9 gain ─► 8 delay
///  10 sound source ─► 11 player ─► out
pub fn full_patch(ctl: &mut Controller) {
    ctl.add(1, Box::new(Sine::new(220.0, 0.5))).unwrap();
    ctl.add(2, Box::new(Gain::new(0.8))).unwrap();
    ctl.add(3, Box::new(Lfo::new(3.0, 0.2))).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect(port(3, 0), port(2, 1)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();

    ctl.add(4, Box::new(Clock::new(140.0, true))).unwrap();
    ctl.add(5, Box::new(Pulse::new(57))).unwrap();
    ctl.add(6, Box::new(Voice::new())).unwrap();
    ctl.add(7, Box::new(Keys::new())).unwrap();
    ctl.connect(port(4, 0), port(5, 0)).unwrap();
    ctl.connect(port(5, 0), port(6, 0)).unwrap();
    ctl.connect(port(7, 0), port(6, 0)).unwrap();
    ctl.connect_out(port(6, 0)).unwrap();

    ctl.add(8, Box::new(Delay::new(64))).unwrap();
    ctl.add(9, Box::new(Gain::new(0.5))).unwrap();
    ctl.connect(port(6, 0), port(8, 0)).unwrap();
    ctl.connect(port(8, 0), port(9, 0)).unwrap();
    ctl.connect(port(9, 0), port(8, 0)).unwrap();
    ctl.connect_out(port(8, 0)).unwrap();

    ctl.add(10, Box::new(SoundSource::new())).unwrap();
    ctl.add(11, Box::new(Player::new(0.3))).unwrap();
    ctl.connect(port(10, 0), port(11, 0)).unwrap();
    ctl.connect_out(port(11, 0)).unwrap();

    ctl.commit().unwrap();
    let sound = ctl.load_sound(1, ramp_sound(480)).unwrap();
    ctl.send(10, EventKind::Sound { slot: 0, sound }).unwrap();
}

/// Messages for the full patch, each stamped with its frame.
pub fn script(ctl: &mut Controller) {
    ctl.send_at(1000, 1, EventKind::Param { index: 0, value: 330.0 }).unwrap();
    ctl.send_at(1000, 2, EventKind::Param { index: 0, value: 0.5 }).unwrap();
    ctl.send_at(4097, 7, EventKind::Note(NoteEvent::on(64, 0.9))).unwrap();
    ctl.send_at(9001, 7, EventKind::Note(NoteEvent::off(64))).unwrap();
    ctl.send_at(12_345, 4, EventKind::Param { index: 0, value: 97.0 }).unwrap();
    ctl.send_at(20_000, 9, EventKind::Param { index: 0, value: 0.7 }).unwrap();
}

pub const FULL_FRAMES: usize = 48_000;

/// The full patch and its script, from nothing, in blocks of one size.
pub fn full_run(block: usize) -> (Vec<f32>, Vec<f32>) {
    let (mut ctl, mut audio) = engine(RATE, Config::default());
    full_patch(&mut ctl);
    script(&mut ctl);
    render(&mut audio, FULL_FRAMES, block)
}

/// One thing the app's thread does during a live session.
#[derive(Clone, Copy, Debug)]
pub enum Op {
    Event(ModuleId, EventKind),
    AddSine(ModuleId, f32),
    Remove(ModuleId),
    LoadSound(usize),
}

/// Do it now (`None`) or stamped with a frame. Returns its message number.
pub fn apply(ctl: &mut Controller, op: &Op, frame: Option<u64>) -> u64 {
    match *op {
        Op::Event(module, kind) => {
            match frame {
                None => ctl.send(module, kind),
                Some(f) => ctl.send_at(f, module, kind),
            }
            .unwrap();
        }
        Op::AddSine(id, hz) => {
            ctl.add(id, Box::new(Sine::new(hz, 0.1))).unwrap();
            ctl.connect_out(port(id, 0)).unwrap();
            match frame {
                None => ctl.commit(),
                Some(f) => ctl.commit_at(f),
            }
            .unwrap();
        }
        Op::Remove(id) => {
            ctl.remove(id);
            match frame {
                None => ctl.commit(),
                Some(f) => ctl.commit_at(f),
            }
            .unwrap();
        }
        Op::LoadSound(frames) => {
            match frame {
                None => ctl.load_sound(1, ramp_sound(frames)),
                Some(f) => ctl.load_sound_at(f, 1, ramp_sound(frames)),
            }
            .unwrap();
        }
    }
    ctl.last_seq()
}

/// What the app's thread does in a live session: knobs, notes, a tempo
/// change, modules added and removed, a sound replaced.
pub fn live_ops() -> Vec<Op> {
    let mut seed = 7u32;
    let mut ops = Vec::new();
    let mut sound_version = 1;
    for i in 0..300 {
        let roll = next(&mut seed) % 100;
        let value = (next(&mut seed) % 1000) as f32 / 1000.0;
        ops.push(match i {
            40 => Op::AddSine(20, 550.0),
            90 => Op::LoadSound(300),
            91 => {
                sound_version += 1;
                Op::Event(10, EventKind::Sound { slot: 0, sound: SoundRef { id: 1, version: sound_version } })
            }
            150 => Op::Remove(20),
            200 => Op::AddSine(21, 660.0),
            _ if roll < 35 => Op::Event(1, EventKind::Param { index: 0, value: 110.0 + 600.0 * value }),
            _ if roll < 60 => Op::Event(2, EventKind::Param { index: 0, value }),
            _ if roll < 75 => Op::Event(7, EventKind::Note(NoteEvent::on(48 + (roll % 24) as u8, 0.2 + 0.8 * value))),
            _ if roll < 85 => Op::Event(7, EventKind::Note(NoteEvent { kind: NoteKind::AllOff, ..NoteEvent::off(0) })),
            _ if roll < 93 => Op::Event(9, EventKind::Param { index: 0, value: 0.9 * value }),
            _ => Op::Event(4, EventKind::Param { index: 0, value: 60.0 + 120.0 * value }),
        });
    }
    ops
}

pub struct Live {
    pub l: Vec<f32>,
    pub r: Vec<f32>,
    /// Each op with its message number, in the order it was done.
    pub ops: Vec<(Op, u64)>,
    /// Message number to the frame it landed on.
    pub landed: HashMap<u64, u64>,
    /// What `probe` returned on the audio thread when it had finished.
    pub probe: usize,
    pub collected: Collected,
}

/// A live session with two real threads: this one is the app, sending
/// everything "now", and another renders uneven blocks until this one is
/// done. `probe` runs on the audio thread at the end.
pub fn live_session(probe: fn() -> usize) -> Live {
    let (mut ctl, mut audio) = engine(RATE, Config { log_applied: true, ..Config::default() });
    full_patch(&mut ctl);
    let done = Arc::new(AtomicBool::new(false));
    let audio_done = done.clone();
    let audio_thread = thread::spawn(move || {
        let mut l = Vec::new();
        let mut r = Vec::new();
        let mut seed = 99u32;
        let mut tail = 8;
        let mut bl = vec![0.0f32; 700];
        let mut br = vec![0.0f32; 700];
        while tail > 0 {
            if audio_done.load(Ordering::Acquire) {
                tail -= 1;
            }
            let n = 1 + next(&mut seed) as usize % 700;
            audio.render(&mut bl[..n], &mut br[..n]);
            l.extend_from_slice(&bl[..n]);
            r.extend_from_slice(&br[..n]);
            thread::sleep(Duration::from_micros(200));
        }
        (l, r, probe())
    });
    let mut ops = Vec::new();
    let mut collected = Collected::default();
    for (i, op) in live_ops().iter().enumerate() {
        let seq = apply(&mut ctl, op, None);
        ops.push((*op, seq));
        if i % 16 == 0 {
            let c = ctl.collect();
            collected.plans += c.plans;
            collected.sounds += c.sounds;
        }
        thread::sleep(Duration::from_micros(300));
    }
    done.store(true, Ordering::Release);
    let (l, r, probe) = audio_thread.join().unwrap();
    let c = ctl.collect();
    collected.plans += c.plans;
    collected.sounds += c.sounds;
    let landed = ctl.take_applied().into_iter().collect();
    Live { l, r, ops, landed, probe, collected }
}

/// A level in a box, for handing to a [`Holder`]. It counts when it is
/// freed, and whether that was inside a render.
pub struct Level {
    pub value: f32,
    freed: Arc<Freed>,
}

#[derive(Default)]
pub struct Freed {
    pub total: std::sync::atomic::AtomicUsize,
    pub in_audio: std::sync::atomic::AtomicUsize,
}

impl Freed {
    pub fn total(&self) -> usize {
        self.total.load(Ordering::SeqCst)
    }
    pub fn in_audio(&self) -> usize {
        self.in_audio.load(Ordering::SeqCst)
    }
}

pub fn level(value: f32, freed: &Arc<Freed>) -> Thing {
    Box::new(Level { value, freed: Arc::clone(freed) })
}

impl Drop for Level {
    fn drop(&mut self) {
        self.freed.total.fetch_add(1, Ordering::SeqCst);
        if engine_core::rt::in_audio() {
            self.freed.in_audio.fetch_add(1, Ordering::SeqCst);
        }
    }
}

/// Plays the level it holds, on both sides. Handed a new one in slot 0, it
/// returns the old one at once; in slot 1, it returns the old one when next
/// asked what it has finished with. Anything that isn't a level it refuses.
#[derive(Default)]
pub struct Holder {
    level: Option<Box<Level>>,
    done: Option<Thing>,
}

impl Module for Holder {
    fn inputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn process(&mut self, io: &mut Io) {
        let value = self.level.as_ref().map_or(0.0, |level| level.value);
        let (l, r) = io.outs.audio(0);
        l.fill(value);
        r.fill(value);
    }
    fn take(&mut self, slot: u32, thing: Thing) -> Option<Thing> {
        let new = match thing.downcast::<Level>() {
            Ok(new) => new,
            Err(other) => return Some(other),
        };
        let old = self.level.replace(new).map(|old| old as Thing);
        if slot == 1 {
            // Never two waiting: the test hands slot 1 one thing at a time.
            std::mem::replace(&mut self.done, old)
        } else {
            old
        }
    }
    fn finished(&mut self) -> Option<Thing> {
        self.done.take()
    }
}
