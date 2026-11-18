//! Plain utility modules: enough to patch every kind of cable together, and
//! what the tests and the JUCE probe play. None of them is one of the app's
//! instruments.

use crate::module::{EventKind, Io, Module, Thing};
use crate::types::{ClockState, Kind, NoteEvent, NoteKind, SoundRef};
use std::f64::consts::TAU;

fn param(event: &EventKind) -> Option<(u32, f32)> {
    match *event {
        EventKind::Param { index, value } => Some((index, value)),
        _ => None,
    }
}

/// A sine wave. Knobs: 0 pitch in Hz, 1 level. Input: Hz added to the pitch.
pub struct Sine {
    freq: f32,
    level: f32,
    phase: f64,
}

impl Sine {
    pub fn new(freq: f32, level: f32) -> Self {
        Self { freq, level, phase: 0.0 }
    }
}

impl Module for Sine {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Control]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn handle(&mut self, event: &EventKind) {
        match param(event) {
            Some((0, value)) => self.freq = value,
            Some((1, value)) => self.level = value,
            _ => {}
        }
    }
    fn process(&mut self, io: &mut Io) {
        let bend = io.ins.control(0);
        let rate = io.rate as f64;
        let (l, r) = io.outs.audio(0);
        for i in 0..l.len() {
            let value = (self.phase * TAU).sin() as f32 * self.level;
            l[i] = value;
            r[i] = value;
            self.phase += (self.freq + bend[i]) as f64 / rate;
            self.phase -= self.phase.floor();
        }
    }
}

/// A volume. Knob 0: gain. Inputs: audio, and a value added to the gain.
pub struct Gain {
    gain: f32,
}

impl Gain {
    pub fn new(gain: f32) -> Self {
        Self { gain }
    }
}

impl Module for Gain {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Audio, Kind::Control]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn handle(&mut self, event: &EventKind) {
        if let Some((0, value)) = param(event) {
            self.gain = value;
        }
    }
    fn process(&mut self, io: &mut Io) {
        let (in_l, in_r) = io.ins.audio(0);
        let wobble = io.ins.control(1);
        let (l, r) = io.outs.audio(0);
        for i in 0..l.len() {
            let gain = self.gain + wobble[i];
            l[i] = in_l[i] * gain;
            r[i] = in_r[i] * gain;
        }
    }
}

/// A fixed delay of a whole number of samples. It can close a loop.
pub struct Delay {
    l: Box<[f32]>,
    r: Box<[f32]>,
    at: usize,
}

impl Delay {
    pub fn new(samples: usize) -> Self {
        let samples = samples.max(1);
        Self {
            l: vec![0.0; samples].into_boxed_slice(),
            r: vec![0.0; samples].into_boxed_slice(),
            at: 0,
        }
    }
}

impl Module for Delay {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn feedback_delay(&self) -> usize {
        self.l.len()
    }
    fn process(&mut self, io: &mut Io) {
        let (in_l, in_r) = io.ins.audio(0);
        let (l, r) = io.outs.audio(0);
        for i in 0..l.len() {
            l[i] = self.l[self.at];
            r[i] = self.r[self.at];
            self.l[self.at] = in_l[i];
            self.r[self.at] = in_r[i];
            self.at = (self.at + 1) % self.l.len();
        }
    }
    fn emit(&mut self, io: &mut Io) {
        let (l, r) = io.outs.audio(0);
        for i in 0..l.len() {
            let at = (self.at + i) % self.l.len();
            l[i] = self.l[at];
            r[i] = self.r[at];
        }
    }
    fn absorb(&mut self, io: &mut Io) {
        let (in_l, in_r) = io.ins.audio(0);
        for i in 0..in_l.len() {
            let at = (self.at + i) % self.l.len();
            self.l[at] = in_l[i];
            self.r[at] = in_r[i];
        }
        self.at = (self.at + in_l.len()) % self.l.len();
    }
}

/// A slow sine for modulation. Knobs: 0 rate in Hz, 1 depth.
pub struct Lfo {
    rate_hz: f32,
    depth: f32,
    phase: f64,
}

impl Lfo {
    pub fn new(rate_hz: f32, depth: f32) -> Self {
        Self { rate_hz, depth, phase: 0.0 }
    }
}

impl Module for Lfo {
    fn inputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Control]
    }
    fn handle(&mut self, event: &EventKind) {
        match param(event) {
            Some((0, value)) => self.rate_hz = value,
            Some((1, value)) => self.depth = value,
            _ => {}
        }
    }
    fn process(&mut self, io: &mut Io) {
        let rate = io.rate as f64;
        let out = io.outs.control(0);
        for value in out.iter_mut() {
            *value = (self.phase * TAU).sin() as f32 * self.depth;
            self.phase += self.rate_hz as f64 / rate;
            self.phase -= self.phase.floor();
        }
    }
}

/// The clock. Knobs: 0 tempo in beats a minute, 1 playing (0 or 1).
pub struct Clock {
    state: ClockState,
}

impl Clock {
    pub fn new(bpm: f64, playing: bool) -> Self {
        Self { state: ClockState { playing, bpm, beat: 0.0 } }
    }
}

impl Module for Clock {
    fn inputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Clock]
    }
    fn handle(&mut self, event: &EventKind) {
        match param(event) {
            Some((0, value)) => self.state.bpm = value as f64,
            Some((1, value)) => self.state.playing = value >= 0.5,
            _ => {}
        }
    }
    fn process(&mut self, io: &mut Io) {
        io.outs.set_clock(0, self.state);
        if self.state.playing {
            let step = self.state.step(io.rate);
            for _ in 0..io.n {
                self.state.beat += step;
            }
        }
    }
}

/// One note on every beat of the clock, held for half a beat.
pub struct Pulse {
    note: u8,
    last_beat: f64,
    held: bool,
    off_at: f64,
}

impl Pulse {
    pub fn new(note: u8) -> Self {
        Self { note, last_beat: -1.0, held: false, off_at: 0.0 }
    }
}

impl Module for Pulse {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Clock]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Notes]
    }
    fn process(&mut self, io: &mut Io) {
        let clock = io.ins.clock(0);
        if !clock.playing {
            return;
        }
        let step = clock.step(io.rate);
        let mut beat = clock.beat;
        let n = io.n;
        let out = io.outs.notes(0);
        for i in 0..n {
            if self.held && beat >= self.off_at {
                out.push(NoteEvent { offset: i as u32, ..NoteEvent::off(self.note) });
                self.held = false;
            }
            let whole = beat.floor();
            if whole > self.last_beat {
                self.last_beat = whole;
                self.off_at = whole + 0.5;
                self.held = true;
                out.push(NoteEvent { offset: i as u32, ..NoteEvent::on(self.note, 0.8) });
            }
            beat += step;
        }
    }
}

/// One sine voice with a decaying level, played by notes.
pub struct Voice {
    note: u8,
    freq: f64,
    phase: f64,
    level: f32,
    held: bool,
}

impl Voice {
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        Self { note: 0, freq: 0.0, phase: 0.0, level: 0.0, held: false }
    }

    fn take(&mut self, event: &NoteEvent) {
        match event.kind {
            NoteKind::On => {
                self.note = event.note;
                self.freq = 440.0 * 2f64.powf((event.note as f64 - 69.0) / 12.0);
                self.level = event.velocity;
                self.held = true;
            }
            NoteKind::Off if event.note == self.note => self.held = false,
            NoteKind::Off => {}
            NoteKind::AllOff => self.held = false,
        }
    }
}

impl Module for Voice {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Notes]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn process(&mut self, io: &mut Io) {
        let notes = io.ins.notes(0);
        let rate = io.rate as f64;
        let (l, r) = io.outs.audio(0);
        let mut next = 0;
        for i in 0..l.len() {
            while next < notes.len() && notes[next].offset as usize <= i {
                self.take(&notes[next]);
                next += 1;
            }
            let value = (self.phase * TAU).sin() as f32 * self.level * 0.5;
            l[i] = value;
            r[i] = value;
            self.phase += self.freq / rate;
            self.phase -= self.phase.floor();
            self.level *= if self.held { 0.9999 } else { 0.995 };
            if self.level < 1.0e-6 {
                self.level = 0.0;
            }
        }
    }
}

/// Notes from outside the patch (a key, a pad, MIDI in), sent on down a cable.
pub struct Keys {
    waiting: Vec<NoteEvent>,
}

const KEYS_ROOM: usize = 64;

impl Keys {
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        Self { waiting: Vec::with_capacity(KEYS_ROOM) }
    }
}

impl Module for Keys {
    fn inputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Notes]
    }
    fn handle(&mut self, event: &EventKind) {
        if let EventKind::Note(note) = *event {
            if self.waiting.len() < KEYS_ROOM {
                self.waiting.push(note);
            }
        }
    }
    fn process(&mut self, io: &mut Io) {
        let out = io.outs.notes(0);
        for note in self.waiting.drain(..) {
            out.push(NoteEvent { offset: 0, ..note });
        }
    }
}

/// The loaded sound, as a module: it puts the sound it is pointed at on a cable.
pub struct SoundSource {
    sound: SoundRef,
}

impl SoundSource {
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        Self { sound: SoundRef::default() }
    }
}

impl Module for SoundSource {
    fn inputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Sound]
    }
    fn handle(&mut self, event: &EventKind) {
        if let EventKind::Sound { slot: 0, sound } = *event {
            self.sound = sound;
        }
    }
    fn process(&mut self, io: &mut Io) {
        io.outs.set_sound(0, self.sound);
    }
}

/// Plays the sound on its input from the start, round and round. Knob 0: level.
pub struct Player {
    level: f32,
    playing: SoundRef,
    at: usize,
}

impl Player {
    pub fn new(level: f32) -> Self {
        Self { level, playing: SoundRef::default(), at: 0 }
    }
}

impl Module for Player {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Sound]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn handle(&mut self, event: &EventKind) {
        if let Some((0, value)) = param(event) {
            self.level = value;
        }
    }
    fn process(&mut self, io: &mut Io) {
        let sound = io.ins.sound(0);
        if sound != self.playing {
            self.playing = sound;
            self.at = 0;
        }
        let sounds = io.sounds;
        let (l, r) = io.outs.audio(0);
        match sounds.get(sound) {
            Some(data) if data.frames() > 0 => {
                for i in 0..l.len() {
                    l[i] = data.l[self.at] * self.level;
                    r[i] = data.r[self.at] * self.level;
                    self.at += 1;
                    if self.at == data.frames() {
                        self.at = 0;
                    }
                }
            }
            _ => {
                l.fill(0.0);
                r.fill(0.0);
            }
        }
    }
}

/// Several sounds into one. Each input is audio; knob `i` is the level of
/// input `i` (1 to begin with) and knob `inputs` is the level of the whole.
pub struct Mix {
    levels: Vec<f32>,
    master: f32,
}

impl Mix {
    pub fn new(inputs: usize) -> Self {
        Self { levels: vec![1.0; inputs.max(1)], master: 1.0 }
    }
}

impl Module for Mix {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Audio; self.levels.len()]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn handle(&mut self, event: &EventKind) {
        if let Some((index, value)) = param(event) {
            let index = index as usize;
            if index < self.levels.len() {
                self.levels[index] = value;
            } else if index == self.levels.len() {
                self.master = value;
            }
        }
    }
    fn process(&mut self, io: &mut Io) {
        // The first input is copied and the rest added to it, in order, so
        // one input at full level arrives with every bit as it was.
        let (first_l, first_r) = io.ins.audio(0);
        let (l, r) = io.outs.audio(0);
        let level = self.levels[0];
        for i in 0..l.len() {
            l[i] = first_l[i] * level;
            r[i] = first_r[i] * level;
        }
        for (input, &level) in self.levels.iter().enumerate().skip(1) {
            if level == 0.0 {
                continue;
            }
            let (in_l, in_r) = io.ins.audio(input);
            for i in 0..l.len() {
                // Silence is left out, not added: adding +0.0 would turn a
                // negative zero positive, and an input with no cable is
                // silence.
                let (a, b) = (in_l[i] * level, in_r[i] * level);
                if a != 0.0 {
                    l[i] += a;
                }
                if b != 0.0 {
                    r[i] += b;
                }
            }
        }
        if self.master != 1.0 {
            for i in 0..l.len() {
                l[i] *= self.master;
                r[i] *= self.master;
            }
        }
    }
}

/// What a [`Record`] module writes into: its room is made by the app, on the
/// app's thread, and the audio thread only fills it.
pub struct Tape {
    pub l: Vec<f32>,
    pub r: Vec<f32>,
}

impl Tape {
    /// A tape with room for `frames` samples a side.
    pub fn with_room(frames: usize) -> Tape {
        Tape { l: Vec::with_capacity(frames), r: Vec::with_capacity(frames) }
    }
}

/// Records what passes through it. Handed a [`Tape`] (`Controller::give`,
/// slot 0) it writes from that sample on, until the tape is full or knob 0
/// is set to 0; then the tape goes back to the app
/// (`Controller::collect_things`). The audio passes through untouched.
pub struct Record {
    tape: Option<Box<Tape>>,
    done: Option<Box<Tape>>,
}

impl Record {
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        Self { tape: None, done: None }
    }

    /// The tape that is running stops and waits to go back.
    fn stop(&mut self) {
        if let Some(tape) = self.tape.take() {
            if let Some(lost) = self.done.replace(tape) {
                // Two tapes stopped between two pieces of audio, which the
                // engine's asking after every piece rules out. It must not
                // be freed here.
                std::mem::forget(lost);
            }
        }
    }
}

impl Module for Record {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn handle(&mut self, event: &EventKind) {
        if let Some((0, value)) = param(event) {
            if value < 0.5 {
                self.stop();
            }
        }
    }
    fn process(&mut self, io: &mut Io) {
        let (in_l, in_r) = io.ins.audio(0);
        let (l, r) = io.outs.audio(0);
        l.copy_from_slice(in_l);
        r.copy_from_slice(in_r);
        let Some(tape) = self.tape.as_mut() else { return };
        // Only ever into the room the app made: growing a tape here would
        // be an allocation on the audio thread.
        let room = tape.l.capacity().min(tape.r.capacity()) - tape.l.len().max(tape.r.len());
        let n = room.min(in_l.len());
        tape.l.extend_from_slice(&in_l[..n]);
        tape.r.extend_from_slice(&in_r[..n]);
        if n == room {
            self.stop();
        }
    }
    fn take(&mut self, _slot: u32, thing: Thing) -> Option<Thing> {
        match thing.downcast::<Tape>() {
            Ok(tape) => {
                // A tape still running gives way; one already waiting to go
                // back goes back now, in this one's place.
                let waiting = self.done.take();
                self.stop();
                self.tape = Some(tape);
                waiting.map(|tape| tape as Thing)
            }
            Err(other) => Some(other),
        }
    }
    fn finished(&mut self) -> Option<Thing> {
        self.done.take().map(|tape| tape as Thing)
    }
}
