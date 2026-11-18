//! MultiGrainLive's grain deck as a module.
//!
//! The deck is MGL's own `Core`, unchanged. In MGL the server writes what the
//! deck needs into a `Shared` and the deck tries each of its locks once a
//! block. Here the engine's messages are written into the module's `Shared`
//! between blocks, on the audio thread, and the deck reads them as it always
//! has. No other thread writes there, so those tries succeed at once.
//!
//! One thing does cross to another thread: what the deck has finished with
//! (a rack that has faded out, a replaced bank or map) goes on `Shared`'s
//! list, and the app frees it with [`Collector::collect`]. The audio thread
//! only ever tries that list's lock; when the app happens to hold it, the
//! deck keeps the thing and tries again next block.

use engine_core::{EventKind, Io, Kind, Module, NoteEvent, NoteKind, Thing};
use mgl_engine::stretcher::LayerBank;
use mgl_engine::{Core, GrainKeys, KeyMode, Shared, Source};
use mgl_fx::grain::StreamParams;
use mgl_fx::hstream::Parts;
use std::sync::Arc;

/// Knob numbers.
pub const PLAY: u32 = 0;
/// 0 Mono, 1 Legato, 2 Poly.
pub const KEY_MODE: u32 = 1;
pub const RUN: u32 = 2;
pub const PLAYED: u32 = 3;
/// Semitones.
pub const BEND: u32 = 4;
/// The keys' envelope, in seconds (sustain is a level).
pub const AMP_ATTACK: u32 = 5;
pub const AMP_DECAY: u32 = 6;
pub const AMP_SUSTAIN: u32 = 7;
pub const AMP_RELEASE: u32 = 8;
/// Seconds.
pub const KEY_GLIDE: u32 = 9;
/// Where a key starts the sound, as a fraction of its length.
pub const START: u32 = 10;

/// What the deck is handed while it plays, built on the app's thread
/// (`Controller::give`, slot 0).
pub enum GrainThing {
    /// The engine and all its settings.
    Params(StreamParams),
    /// The sound, at the engine's rate, two channels.
    Source(Arc<Source>),
    /// What a box holds on its way back, once the deck has taken its contents.
    Taken,
}

/// Frees what a deck has finished with, on whatever thread calls it: never
/// the audio thread. The app calls it now and then, as it does the engine's
/// own `collect`.
pub struct Collector {
    shared: Arc<Shared>,
}

impl Collector {
    pub fn collect(&self) {
        self.shared.collect();
    }
}

/// The grain deck. Input 0 takes notes, output 0 is audio.
///
/// The deck's sound depends on the size of the blocks it is asked for, so it
/// is always asked for whole blocks of `grid` samples on fixed lines, and a
/// note, a knob or a new sound takes effect on the first line at or after
/// its sample. What it plays is then the same however the sound card's
/// blocks fall.
pub struct Grain {
    core: Core,
    shared: Arc<Shared>,
    keys: Arc<GrainKeys>,
    /// A hold of this module's own on the sound last handed to the deck, so
    /// that replacing a sound here never drops the last hold on one.
    source: Arc<Source>,
    amp: [f32; 4],
    grid: usize,
    /// The block last made, left and right interleaved, and how many of its
    /// frames have gone out.
    block: Vec<f32>,
    used: usize,
}

impl Grain {
    /// A deck for `rate` (the engine's) playing `source` with `params`.
    /// `grid` is the deck's own block: it renders that many samples at a
    /// time, and a note, a knob or a new sound takes effect on the first
    /// line of the grid at or after its sample.
    pub fn new(rate: u32, grid: usize, params: StreamParams, source: Arc<Source>) -> Grain {
        // The transforms' tables, built here and not in the first block.
        audio_core::fft::prime();
        prism_grain::fft::prime();
        let grid = grid.max(1);
        let params = StreamParams { sample_rate: rate, ..params };
        let keys = Arc::new(GrainKeys::new());
        let (attack, decay, sustain, release) = keys.amp();
        Grain {
            core: Core::new(grid, 2, params, Arc::clone(&source)).with_keys(Arc::clone(&keys)),
            shared: Arc::new(Shared::new(params, Arc::clone(&source))),
            keys,
            source,
            amp: [attack, decay, sustain, release],
            grid,
            block: vec![0.0; grid * 2],
            used: grid,
        }
    }

    /// Start with this rack after the engines.
    pub fn rack(self, rack: mgl_fx::Rack) -> Grain {
        self.shared.set_rack(Some(rack));
        self
    }

    /// Start with the sound's separated parts (the Hybrid engine's).
    pub fn parts(self, parts: Arc<Parts>) -> Grain {
        self.shared.set_parts(parts);
        self
    }

    /// Start with the layers' engines.
    pub fn bank(self, bank: LayerBank) -> Grain {
        self.shared.set_bank(bank);
        self
    }

    /// The app's handle for freeing what the deck has finished with. Take it
    /// before the module goes into the patch.
    pub fn collector(&self) -> Collector {
        Collector { shared: Arc::clone(&self.shared) }
    }

    fn play(&mut self, note: &NoteEvent) {
        match note.kind {
            NoteKind::On => {
                self.keys.note_on(note.note, note.velocity);
            }
            NoteKind::Off => self.keys.note_off(note.note),
            NoteKind::AllOff => self.keys.all_off(),
        }
    }

    fn knob(&mut self, index: u32, value: f32) {
        let on = value >= 0.5;
        match index {
            PLAY if on => self.shared.play(),
            PLAY => self.shared.pause(),
            KEY_MODE => self.keys.set_mode(match value as u32 {
                0 => KeyMode::Mono,
                1 => KeyMode::Legato,
                _ => KeyMode::Poly,
            }),
            RUN => self.keys.set_run(on),
            PLAYED => self.keys.set_played(on),
            BEND => self.keys.set_bend(value),
            AMP_ATTACK..=AMP_RELEASE => {
                self.amp[(index - AMP_ATTACK) as usize] = value;
                let [attack, decay, sustain, release] = self.amp;
                self.keys.set_amp(attack, decay, sustain, release);
            }
            KEY_GLIDE => self.keys.set_glide(value),
            START => self.keys.set_start(value),
            _ => {}
        }
    }
}

impl Module for Grain {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Notes]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    /// A message lands between two pieces of audio. The deck has already
    /// made its block up to the next line, so this is first heard from there.
    fn handle(&mut self, event: &EventKind) {
        match *event {
            EventKind::Param { index, value } => self.knob(index, value),
            EventKind::Note(note) => self.play(&note),
            _ => {}
        }
    }
    fn process(&mut self, io: &mut Io) {
        let notes = io.ins.notes(0);
        let (l, r) = io.outs.audio(0);
        let n = l.len();
        let mut next = 0;
        let mut at = 0;
        while at < n {
            if self.used == self.grid {
                // A line: the notes due by now, then the deck's next block.
                while next < notes.len() && notes[next].offset as usize <= at {
                    self.play(&notes[next]);
                    next += 1;
                }
                self.core.fill(&mut self.block, 2, &self.shared);
                self.used = 0;
            }
            let run = (self.grid - self.used).min(n - at);
            for (i, frame) in self.block[self.used * 2..(self.used + run) * 2].chunks_exact(2).enumerate() {
                l[at + i] = frame[0];
                r[at + i] = frame[1];
            }
            self.used += run;
            at += run;
        }
        // Notes after this piece's last line are first heard from the next.
        while next < notes.len() {
            self.play(&notes[next]);
            next += 1;
        }
    }
    fn take(&mut self, _slot: u32, thing: Thing) -> Option<Thing> {
        let mut boxed = match thing.downcast::<GrainThing>() {
            Ok(boxed) => boxed,
            Err(other) => return Some(other),
        };
        match std::mem::replace(&mut *boxed, GrainThing::Taken) {
            GrainThing::Params(params) => {
                self.shared.set_params(params);
                Some(boxed)
            }
            GrainThing::Source(source) => {
                // The box goes back holding this module's hold on the old
                // sound. The deck's own hold goes on its list when it takes
                // the new one, and whichever is let go last is freed by the
                // app, not here.
                let old = std::mem::replace(&mut self.source, Arc::clone(&source));
                self.shared.set_source(source);
                *boxed = GrainThing::Source(old);
                Some(boxed)
            }
            GrainThing::Taken => Some(boxed),
        }
    }
}
