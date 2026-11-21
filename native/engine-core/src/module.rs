//! What a module is, and what it is handed to work with.

mod events;
pub(crate) use events::EventScratch;
use events::split_events;

use crate::sound::Sounds;
use crate::types::{Buf, ClockState, Kind, NoteBuf, NoteEvent, SoundRef};
use std::any::Any;

/// Something built on another thread and handed to a module whole: a sound
/// in the module's own layout, a rack of effects, a table. The module finds
/// out what it is by its type.
pub type Thing = Box<dyn Any + Send>;

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
    pub(crate) offset: usize,
    pub(crate) notes: Option<&'a [NoteBuf]>,
    pub(crate) reads: Option<&'a [crate::pool::ReadBuf]>,
    pub(crate) before: &'a [Buf],
    pub(crate) after: &'a [Buf],
    pub(crate) gap_start: usize,
    pub(crate) gap_len: usize,
    pub(crate) map: &'a [usize],
    pub(crate) n: usize,
}

impl<'a> Inputs<'a> {
    fn buf(&self, input: usize) -> &'a Buf {
        if let Some(reads) = self.reads { return reads[input].get(); }
        let index = self.map[input];
        if index < self.gap_start {
            &self.before[index]
        } else {
            &self.after[index - self.gap_start - self.gap_len]
        }
    }

    pub fn count(&self) -> usize {
        self.reads.map_or(self.map.len(), |reads| reads.len())
    }

    pub fn audio(&self, input: usize) -> (&'a [f32], &'a [f32]) {
        match self.buf(input) {
            Buf::Audio { l, r, .. } => (&l[self.offset..self.offset+self.n], &r[self.offset..self.offset+self.n]),
            _ => panic!("input {input} is not audio"),
        }
    }

    pub fn control(&self, input: usize) -> &'a [f32] {
        match self.buf(input) {
            Buf::Control(values) => &values[self.offset..self.offset+self.n],
            _ => panic!("input {input} is not control"),
        }
    }

    pub fn notes(&self, input: usize) -> &'a [NoteEvent] {
        if let Some(notes) = self.notes { return notes[input].as_slice(); }
        match self.buf(input) {
            Buf::Notes(notes) => notes.as_slice(),
            _ => panic!("input {input} is not notes"),
        }
    }

    pub fn clock(&self, input: usize) -> ClockState {
        match self.buf(input) {
            Buf::Clock(clock) => *clock,
            Buf::ClockFrames(clocks) => clocks[self.offset],
            _ => panic!("input {input} is not a clock"),
        }
    }

    pub fn sound(&self, input: usize) -> SoundRef {
        match self.buf(input) {
            Buf::Sound(sound) => *sound,
            Buf::SoundFrames(sounds) => sounds[self.offset],
            _ => panic!("input {input} is not a sound"),
        }
    }
}

/// A module's outputs for one piece of audio. The module fills every sample
/// of every audio and control output; note outputs arrive empty.
pub struct Outputs<'a> {
    pub bufs: &'a mut [Buf],
    pub(crate) rate: f32,
    pub(crate) n: usize,
}

impl Outputs<'_> {
    pub fn audio(&mut self, output: usize) -> (&mut [f32], &mut [f32]) {
        let n = self.n;
        match &mut self.bufs[output] {
            Buf::Audio { l, r, .. } => (&mut l[..n], &mut r[..n]),
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
            Buf::ClockFrames(frames) => {
                let mut clock = clock;
                let step = clock.step(self.rate);
                for slot in &mut frames[..self.n] {
                    *slot = clock;
                    if clock.playing { clock.beat += step; }
                }
            },
            _ => panic!("output {output} is not a clock"),
        }
    }

    pub fn set_sound(&mut self, output: usize, sound: SoundRef) {
        match &mut self.bufs[output] {
            Buf::Sound(slot) => *slot = sound,
            Buf::SoundFrames(frames) => frames[..self.n].fill(sound),
            _ => panic!("output {output} is not a sound"),
        }
    }
}

/// Everything a module may touch while it makes one piece of audio.
pub struct Io<'a> {
    /// This callback's borrowed device input, addressed in engine frames.
    pub host: crate::HostInputs<'a>,
    /// Ordered messages addressed to this module, relative to this piece.
    pub events: &'a [(u32, EventKind)],
    pub(crate) scratch: &'a mut EventScratch,
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
pub trait Module: Send + Any {
    /// Exact typed parameter state this wrapper accepts in PRESET.
    fn preset_type(&self) -> Option<std::any::TypeId> { None }
    /// Inspect a typed preset before ownership moves, so rate rebuilds retain
    /// its controls in the same canonical state as individual messages.
    fn visit_preset(&self, _thing: &Thing, _visit: &mut dyn FnMut(EventKind)) {}
    /// Relative work per frame, and an explicit promise that this module
    /// has no hidden dependency on other modules. Zero keeps it serial.
    fn parallel_weight(&self) -> usize { 0 }
    /// Cheap, allocation-free eligibility check on audio before dispatch.
    fn parallel_active(&self) -> bool { true }

    /// Capture construction data before this module leaves the controller.
    fn factory(&self) -> Option<crate::ModuleFactory> { None }
    /// Optional typed state hand-over; both objects remain owned by plans.
    fn transfer(&mut self, _from: &dyn Module, _rate: f32) {}

    /// Fixed-size native state, read only at a rate hand-over on audio.
    fn rate_state(&self) -> [f64; 8] { [0.0; 8] }
    /// Restore native state into a replacement already prepared off audio.
    /// Must not allocate, free, lock, or wait. Instrument attacks may restart.
    fn rehome(&mut self, _state: [f64; 8], _rate: f32) {}
    /// Stop or mark external streaming state before the old-rate plan fades.
    fn rate_change(&mut self, _rate: f32, _frame: u64) {}
    /// Fixed-size recorder notices. Any shared counter was allocated off audio.
    fn recording_report(&mut self) -> Option<crate::RecorderReport> { None }

    /// Current controls and held notes. The factory wrapper supplies these.
    fn visit_events(&self, _visit: &mut dyn FnMut(EventKind)) {}

    /// The kind of each input, in port order. Asked once, off the audio thread.
    fn inputs(&self) -> Vec<Kind>;

    /// The kind of each output, in port order.
    fn outputs(&self) -> Vec<Kind>;

    /// Output delay and the longest response after input stops, in frames.
    /// Metadata is read while compiling the plan, off the audio thread.
    fn latency(&self) -> usize {
        0
    }
    fn tail(&self) -> usize {
        0
    }
    /// Only effects whose silent, settled state may safely stop advancing.
    fn can_sleep(&self) -> bool {
        false
    }

    /// Size whatever depends on the rate or the largest block. Off the audio
    /// thread, before the module is first heard.
    fn prepare(&mut self, _rate: f32, _max_block: usize) {}

    /// A message landed. Audio/worker thread, between this module's local pieces.
    fn handle(&mut self, _event: &EventKind) {}

    fn process(&mut self, io: &mut Io);

    /// Override to consume the event slice on a module's own control grid.
    /// The default retains sample-accurate handle/process behavior locally.
    fn process_events(&mut self, io: &mut Io) { split_events(self, io); }


    /// Take something handed over ([`crate::Controller::give`]), on the sample
    /// it was sent for. Whatever is returned goes back to the app's thread to
    /// be freed there: the thing this one replaces, or the thing itself when
    /// the module has no use for it. Nothing may be freed here.
    fn take(&mut self, _slot: u32, thing: Thing) -> Option<Thing> {
        Some(thing)
    }

    /// Something more the module has finished with (an effect that has faded
    /// out, say), to be freed on the app's thread. Asked after every piece
    /// of audio until it answers `None`, but only if [`Module::hands_back`]
    /// says it can ever answer anything else.
    fn finished(&mut self) -> Option<Thing> {
        None
    }

    /// Whether [`Module::finished`] can ever give something back. Read once,
    /// off the audio thread, when the module joins a patch; a module that
    /// answers `false` is never asked `finished` again (a debug build still
    /// asks, and fails if it gives anything). Every module that overrides
    /// `finished` must answer `true`.
    fn hands_back(&self) -> bool {
        false
    }

    /// The module gave a sample that was not a number (a NaN or an infinity),
    /// and the engine has silenced that piece of its output. Clear whatever
    /// memory could hold it: left there, every piece after is the same. Audio
    /// thread; nothing may be made or freed.
    fn recover(&mut self) {}

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
