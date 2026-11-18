//! Plain utility modules: enough to patch every kind of cable together, and
//! what the tests and the JUCE probe play. None of them is one of the app's
//! instruments.

use crate::module::{EventKind, Io, Module};
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
