//! The Wave page's wavetable synth as a module.

use engine_core::{EventKind, Io, Kind, Module, NoteEvent, NoteKind, Thing};
use std::sync::Arc;
use wave::{BoardPlan, ParamId, PatchState, Synth, Wavetable};

/// What the synth is handed while it plays, built on the app's thread
/// (`Controller::give`, slot 0). Like a note or a knob, each takes effect on
/// the next line of 32 samples.
pub enum WaveThing {
    /// A whole patch, compiled from its keys by the app.
    Patch(PatchState),
    /// A table for oscillator 0, 1 or 2.
    Table(usize, Arc<Wavetable>),
    /// A built-in table for the table bank, by its place in the list.
    BankTable(usize, Arc<Wavetable>),
    /// An effects board, compiled for the engine's rate. The one it replaces
    /// fades out over 10 ms as this fades in.
    Board(Box<BoardPlan>),
    /// On its way back: the table a new one replaced.
    OldTable(Option<Arc<Wavetable>>),
    /// What a box holds on its way back, once the synth has taken its contents.
    Taken,
}

/// The Wave synth. Input 0 takes notes, output 0 is audio; knob numbers are
/// the synth's own parameter numbers (`wave::param_id`).
///
/// The synth works in control blocks of 32 samples counted from the start of
/// each call, so on its own it plays differently when its caller cuts the
/// audio differently. Here it is always asked for whole blocks, on lines 32
/// samples apart, and a note or a knob takes effect on the first line at or
/// after its sample: at most 31 samples late, and the same however the sound
/// card's blocks fall.
pub type WaveState = engine_core::Preset<Wave>;

pub struct Wave {
    preset: Box<WaveState>,
    seed: Option<u32>,
    synth: Synth,
    /// The block last made, and how much of it has gone out.
    l: [f32; Wave::GRID],
    r: [f32; Wave::GRID],
    used: usize,
    /// A board cut short by the one after it, on its way back to the app.
    cut_short: Option<Box<BoardPlan>>,
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

    /// The knob number of control `param` of the effects board's node `node`.
    pub const fn board_knob(node: usize, param: usize) -> u32 {
        (1 << 17) + ((node as u32) << 8) + param as u32
    }

    /// The knob number that switches the board's node `node` in (1) or out (0).
    pub const fn board_switch(node: usize) -> u32 {
        (1 << 18) + node as u32
    }

    /// A synth for `rate` (the engine's), with the default patch and no tables.
    pub fn new(rate: f32) -> Wave {
        Wave {
            preset: Box::new(WaveState::new(&[])),
            seed: None,
            synth: Synth::new(rate, Self::GRID),
            l: [0.0; Self::GRID],
            r: [0.0; Self::GRID],
            used: Self::GRID,
            cut_short: None,
        }
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
        self.seed = Some(seed);
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
    fn preset_type(&self)->Option<std::any::TypeId> {Some(std::any::TypeId::of::<WaveState>())}
    fn visit_preset(&self,thing:&engine_core::Thing,visit:&mut dyn FnMut(EventKind)) {WaveState::visit(thing,visit);}

    fn parallel_weight(&self) -> usize { 16 }
    fn parallel_active(&self) -> bool { self.synth.active_voices() > 0 }
    fn factory(&self) -> Option<engine_core::ModuleFactory> {
        let state = self.synth.state();
        let seed = self.seed;
        let tables: [Option<Arc<Wavetable>>; 3] = std::array::from_fn(|i| self.synth.table(i).cloned());
        let bank: [Option<Arc<Wavetable>>; wave::choice::BANK] = std::array::from_fn(|i| self.synth.bank_table(i).cloned());
        Some(Box::new(move |rate, _| {
            let mut module = Wave::new(rate).patch(state);
            if let Some(seed) = seed { module = module.seed(seed); }
            for (i, table) in tables.iter().enumerate() {
                if let Some(table) = table { module.synth.set_table(i, Arc::clone(table)); }
            }
            for (i, table) in bank.iter().enumerate() {
                if let Some(table) = table { module.synth.set_bank_table(i, Arc::clone(table)); }
            }
            Box::new(module)
        }))
    }
    fn transfer(&mut self, from: &dyn Module, _rate: f32) {
        if let Some(from) = (from as &dyn std::any::Any).downcast_ref::<Wave>() {
            self.preset.inherit(&from.preset);
            self.synth.adopt(from.synth.state());
        }
    }
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
        if let EventKind::Param {index,value}=*event {self.preset.update(index,value);}
        match *event {
            EventKind::Param { index: Self::BEND, value } => self.synth.bend(value),
            EventKind::Param { index: Self::MOD_WHEEL, value } => self.synth.mod_wheel(value),
            EventKind::Param { index: Self::AFTERTOUCH, value } => self.synth.aftertouch(value),
            EventKind::Param { index, value } if index < Self::BEND => {
                self.synth.set_param(ParamId(index as u16), value);
            }
            EventKind::Param { index, value } if index >= Self::board_switch(0) => {
                self.synth.set_board_on((index - Self::board_switch(0)) as usize, value >= 0.5);
            }
            EventKind::Param { index, value } if index >= Self::board_knob(0, 0) => {
                let knob = index - Self::board_knob(0, 0);
                self.synth.set_board_param((knob >> 8) as usize, (knob & 0xff) as usize, value);
            }
            EventKind::Note(note) => self.play(&note),
            _ => {}
        }
    }
    /// The synth has already made its block up to the next line, so what is
    /// handed over here is first heard from that line, as a knob is. What
    /// it replaces goes back in the box, to be freed by the app.
    fn take(&mut self, slot: u32, thing: Thing) -> Option<Thing> {
        if slot==engine_core::PRESET {
            let incoming=match thing.downcast::<WaveState>() {Ok(state)=>state,Err(other)=>return Some(other)};
            let (old,controls)=WaveState::exchange(&mut self.preset,incoming);
            for &(index,value) in &controls {self.handle(&EventKind::Param {index,value});}
            self.preset.restore(controls);
            return Some(old as engine_core::Thing);
        }

        let mut boxed = match thing.downcast::<WaveThing>() {
            Ok(boxed) => boxed,
            Err(other) => return Some(other),
        };
        match std::mem::replace(&mut *boxed, WaveThing::Taken) {
            WaveThing::Patch(state) => self.synth.adopt(state),
            WaveThing::Table(osc, table) => *boxed = WaveThing::OldTable(self.synth.set_table(osc, table)),
            WaveThing::BankTable(i, table) => *boxed = WaveThing::OldTable(self.synth.set_bank_table(i, table)),
            WaveThing::Board(plan) => {
                // A board still fading out from the swap before is cut short
                // and comes straight back (as does this one, if it was made
                // for another rate). At most one: the engine asks for what
                // has finished after every piece of audio.
                if let Some(displaced) = self.synth.set_board(plan) {
                    if let Some(lost) = self.cut_short.replace(displaced) {
                        // Two cut short between two pieces: let go of
                        // without freeing, once, rather than free it here.
                        std::mem::forget(lost);
                    }
                }
            }
            old @ (WaveThing::OldTable(_) | WaveThing::Taken) => *boxed = old,
        }
        Some(boxed)
    }
    /// The boards the synth has finished with: one cut short, or one that
    /// has faded out.
    fn finished(&mut self) -> Option<Thing> {
        self.cut_short.take().or_else(|| self.synth.take_retired()).map(|board| board as Thing)
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
