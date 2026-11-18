//! The Wave page's wavetable synth as a module.

use engine_core::{EventKind, Io, Kind, Module, NoteEvent, NoteKind};
use std::sync::Arc;
use wave::{ParamId, PatchState, Synth, Wavetable};

/// The Wave synth. Input 0 takes notes, output 0 is audio; knob numbers are
/// the synth's own parameter numbers (`wave::param_id`).
///
/// The synth works in control blocks of 32 samples counted from the start of
/// each call, so on its own it plays differently when its caller cuts the
/// audio differently. Here it is always asked for whole blocks, on lines 32
/// samples apart, and a note or a knob takes effect on the first line at or
/// after its sample: at most 31 samples late, and the same however the sound
/// card's blocks fall.
pub struct Wave {
    synth: Synth,
    /// The block last made, and how much of it has gone out.
    l: [f32; Wave::GRID],
    r: [f32; Wave::GRID],
    used: usize,
}

impl Wave {
    /// Knob numbers past the synth's own: the pitch wheel (-1 to 1), the mod
    /// wheel and aftertouch (0 to 1).
    pub const BEND: u32 = 1 << 16;
    pub const MOD_WHEEL: u32 = Self::BEND + 1;
    pub const AFTERTOUCH: u32 = Self::BEND + 2;

    /// The synth's notes and knobs take effect on lines this many samples
    /// apart: its own control block.
    pub const GRID: usize = 32;

    /// A synth for `rate` (the engine's), with the default patch and no tables.
    pub fn new(rate: f32) -> Wave {
        Wave { synth: Synth::new(rate, Self::GRID), l: [0.0; Self::GRID], r: [0.0; Self::GRID], used: Self::GRID }
    }

    /// Start from this patch.
    pub fn patch(mut self, state: PatchState) -> Wave {
        self.synth.adopt(state);
        self
    }

    /// Give oscillator `osc` (0 to 2) its table.
    pub fn table(mut self, osc: usize, table: Arc<Wavetable>) -> Wave {
        self.synth.set_table(osc, table);
        self
    }

    /// Seed the voices' randomness.
    pub fn seed(mut self, seed: u32) -> Wave {
        self.synth.set_seed(seed);
        self
    }

    fn play(&mut self, note: &NoteEvent) {
        match note.kind {
            NoteKind::On => self.synth.note_on(note.note, note.velocity),
            NoteKind::Off => self.synth.note_off(note.note),
            NoteKind::AllOff => self.synth.all_notes_off(),
        }
    }
}

impl Module for Wave {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Notes]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    /// A message lands between two pieces of audio. The synth has already
    /// made its block up to the next line, so what is set here is first heard
    /// from that line.
    fn handle(&mut self, event: &EventKind) {
        match *event {
            EventKind::Param { index: Self::BEND, value } => self.synth.bend(value),
            EventKind::Param { index: Self::MOD_WHEEL, value } => self.synth.mod_wheel(value),
            EventKind::Param { index: Self::AFTERTOUCH, value } => self.synth.aftertouch(value),
            EventKind::Param { index, value } if index < Self::BEND => {
                self.synth.set_param(ParamId(index as u16), value);
            }
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
            if self.used == Self::GRID {
                // A line: the notes due by now, then the synth's next block.
                while next < notes.len() && notes[next].offset as usize <= at {
                    self.play(&notes[next]);
                    next += 1;
                }
                self.synth.render(&mut self.l, &mut self.r);
                self.used = 0;
            }
            let run = (Self::GRID - self.used).min(n - at);
            l[at..at + run].copy_from_slice(&self.l[self.used..self.used + run]);
            r[at..at + run].copy_from_slice(&self.r[self.used..self.used + run]);
            self.used += run;
            at += run;
        }
        // Notes after this piece's last line are first heard from the next.
        while next < notes.len() {
            self.play(&notes[next]);
            next += 1;
        }
    }
}
