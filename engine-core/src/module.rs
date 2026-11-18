//! What a module is, and what it is handed to work with.

use crate::sound::Sounds;
use crate::types::{Buf, ClockState, Kind, NoteBuf, NoteEvent, SoundRef};

/// A message for one module, landing on a set frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum EventKind {
    /// A knob moved.
    Param { index: u32, value: f32 },
    /// A note from outside the patch: a key, a pad, MIDI in.
    Note(NoteEvent),
    /// Point one of the module's slots at a loaded sound.
    Sound { slot: u32, sound: SoundRef },
}

/// A module's inputs for one piece of audio. Several cables into one input
/// have already been summed.
pub struct Inputs<'a> {
    pub(crate) before: &'a [Buf],
    pub(crate) after: &'a [Buf],
    pub(crate) gap_start: usize,
    pub(crate) gap_len: usize,
    pub(crate) map: &'a [usize],
    pub(crate) n: usize,
}

impl<'a> Inputs<'a> {
    fn buf(&self, input: usize) -> &'a Buf {
        let index = self.map[input];
        if index < self.gap_start {
            &self.before[index]
        } else {
            &self.after[index - self.gap_start - self.gap_len]
        }
    }

    pub fn count(&self) -> usize {
        self.map.len()
    }

    pub fn audio(&self, input: usize) -> (&'a [f32], &'a [f32]) {
        match self.buf(input) {
            Buf::Audio { l, r } => (&l[..self.n], &r[..self.n]),
            _ => panic!("input {input} is not audio"),
        }
    }

    pub fn control(&self, input: usize) -> &'a [f32] {
        match self.buf(input) {
            Buf::Control(values) => &values[..self.n],
            _ => panic!("input {input} is not control"),
        }
    }

    pub fn notes(&self, input: usize) -> &'a [NoteEvent] {
        match self.buf(input) {
            Buf::Notes(notes) => notes.as_slice(),
            _ => panic!("input {input} is not notes"),
        }
    }

    pub fn clock(&self, input: usize) -> ClockState {
        match self.buf(input) {
            Buf::Clock(clock) => *clock,
            _ => panic!("input {input} is not a clock"),
        }
    }

    pub fn sound(&self, input: usize) -> SoundRef {
        match self.buf(input) {
            Buf::Sound(sound) => *sound,
            _ => panic!("input {input} is not a sound"),
        }
    }
}

/// A module's outputs for one piece of audio. The module fills every sample
/// of every audio and control output; note outputs arrive empty.
pub struct Outputs<'a> {
    pub bufs: &'a mut [Buf],
    pub(crate) n: usize,
}

impl Outputs<'_> {
    pub fn audio(&mut self, output: usize) -> (&mut [f32], &mut [f32]) {
        let n = self.n;
        match &mut self.bufs[output] {
            Buf::Audio { l, r } => (&mut l[..n], &mut r[..n]),
            _ => panic!("output {output} is not audio"),
        }
    }

    pub fn control(&mut self, output: usize) -> &mut [f32] {
        let n = self.n;
        match &mut self.bufs[output] {
            Buf::Control(values) => &mut values[..n],
            _ => panic!("output {output} is not control"),
        }
    }

    pub fn notes(&mut self, output: usize) -> &mut NoteBuf {
        match &mut self.bufs[output] {
            Buf::Notes(notes) => notes,
            _ => panic!("output {output} is not notes"),
        }
    }

    pub fn set_clock(&mut self, output: usize, clock: ClockState) {
        match &mut self.bufs[output] {
            Buf::Clock(slot) => *slot = clock,
            _ => panic!("output {output} is not a clock"),
        }
    }

    pub fn set_sound(&mut self, output: usize, sound: SoundRef) {
        match &mut self.bufs[output] {
            Buf::Sound(slot) => *slot = sound,
            _ => panic!("output {output} is not a sound"),
        }
    }
}

/// Everything a module may touch while it makes one piece of audio.
pub struct Io<'a> {
    /// Samples to make. Any length from 1 up to the engine's largest block.
    pub n: usize,
    pub rate: f32,
    /// The engine's frame count at the first of those samples.
    pub frame: u64,
    pub ins: Inputs<'a>,
    pub outs: Outputs<'a>,
    pub sounds: &'a Sounds,
}

/// A module in the graph.
///
/// `process` runs on the audio thread: no allocation, no lock, no file, no
/// wait. Whatever it needs is sized in `new` or `prepare`. Its output for a
/// run of samples must not depend on how that run is cut into pieces, which a
/// module gets for free by carrying its state from sample to sample.
pub trait Module: Send {
    /// The kind of each input, in port order. Asked once, off the audio thread.
    fn inputs(&self) -> Vec<Kind>;

    /// The kind of each output, in port order.
    fn outputs(&self) -> Vec<Kind>;

    /// Size whatever depends on the rate or the largest block. Off the audio
    /// thread, before the module is first heard.
    fn prepare(&mut self, _rate: f32, _max_block: usize) {}

    /// A message landed. Audio thread, between two pieces of audio.
    fn handle(&mut self, _event: &EventKind) {}

    fn process(&mut self, io: &mut Io);

    /// More than zero for a module that can close a loop of cables: its
    /// output never depends on input less than this many samples old. In a
    /// loop the engine calls `emit` then `absorb` in place of `process`, with
    /// pieces no longer than the delay, and the two must add up to what
    /// `process` does.
    fn feedback_delay(&self) -> usize {
        0
    }

    /// Fill the outputs from what is stored. `io` has no inputs.
    fn emit(&mut self, _io: &mut Io) {}

    /// Store the inputs. `io` has no outputs.
    fn absorb(&mut self, _io: &mut Io) {}
}
