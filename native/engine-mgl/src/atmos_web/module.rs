//! [`AtmosWeb`] as a module of the native engine: notes in (input 0),
//! audio in (input 1: what the page sends into Atmosphere ahead of the
//! notes, its physical voice), and out (output 0) Atmosphere's sound where
//! its effects take it (`atFxIn`), voice, Character and Sympathy together.
//!
//! A note plays as the page's keys play the browser voice (`kyAtmosOn`): an
//! hour long at its velocity, let go with Atmosphere's own release when the
//! key comes up. Its pitch is equal tempered from A 440, moved by the note's
//! fine detune, as the native Atmosphere's is.
//!
//! The graph runs a render quantum (128 frames) at a time, so the module is
//! one quantum late (`latency` says so): every note and every input sample
//! then lands on its own sample, whatever the host's blocks.
//!
//! Knob `i` is the page's control [`KEYS`]`[i]`. Kinds and Sympathy's tuning
//! are numbers: the kinds in `AT_KINDS` order, `symTune` 0 degrees, 1 root
//! and fifth, 2 root.
//!
//! Given a [`Tuning`](crate::atmos::Tuning) on slot
//! [`TUNING`](crate::atmos::TUNING), Sympathy takes its scale and root, and is
//! tuned at once and again whenever a knob moves, notes or none. (The page
//! tunes it only when its browser voice plays a note, which the physical
//! voice never does; without a tuning this module does as the page does.)

use engine_core::{EventKind, Io, Kind, Module, NoteEvent, NoteKind};

use super::voice::Options;
use super::{AtmosWeb, Patch, Route};
use dsp_core::chromium::QUANTUM;

/// Every control, by the page's name for it. Appended to, never reordered.
pub const KEYS: &[&str] = &[
    "kindA", "atA1", "atA2", "atA3", "atAOct",
    "kindB", "atB1", "atB2", "atB3", "atBOct",
    "atBlend", "atUnison", "atDetune", "atWidth", "atDrift", "atSub", "atAir", "atGlide",
    "atAtk", "atDec", "atSus", "atRel", "atVol",
    "atFltType", "atFltCut", "atFltRes", "atFltKey", "atFltAmt", "atFltAtk", "atFltDec", "atFltSus", "atFltRel",
    "atWarm", "atWow", "atEns", "atEnsRate",
    "atSym", "atSymRing", "atSymMat", "symTune", "rootHz",
];

/// The knob number of a control, by its name.
pub fn knob(key: &str) -> Option<u32> {
    KEYS.iter().position(|k| *k == key).map(|i| i as u32)
}

pub type AtmosWebState = engine_core::Preset<AtmosWebModule>;

/// The seed of the module's own random numbers (`Math.random` in the page).
const SEED: u32 = 0x41_74_6d_6f;

pub struct AtmosWebModule {
    preset: Box<AtmosWebState>,
    a: Box<AtmosWeb>,
    rate: f32,
    knobs: Vec<f32>,
    /// The engine frame the graph's frame 0 is, once known.
    base: Option<u64>,
    /// This quantum's input so far, and the last quantum rendered.
    stage: [[f32; QUANTUM]; 2],
    out: [[f32; QUANTUM]; 2],
    pos: usize,
    /// The slot each held key plays in.
    held: [Option<usize>; 128],
    /// The tuning given, if one was; Sympathy is then kept tuned.
    tuning: Option<Box<crate::atmos::Tuning>>,
    retune: bool,
}

impl AtmosWebModule {
    pub fn new(rate: f32) -> Self {
        AtmosWebModule {
            preset: Box::new(AtmosWebState::new(&[])),
            a: Box::new(AtmosWeb::with_input(rate, Patch::default(), SEED)),
            rate,
            knobs: vec![f32::NAN; KEYS.len()],
            base: None,
            stage: [[0.0; QUANTUM]; 2],
            out: [[0.0; QUANTUM]; 2],
            pos: 0,
            held: [None; 128],
            tuning: None,
            retune: false,
        }
    }

    /// Start with `tuning`, before the module is added to a patch.
    pub fn tuned(mut self, tuning: crate::atmos::Tuning) -> Self {
        self.take_tuning(Box::new(tuning));
        self
    }

    fn take_tuning(&mut self, t: Box<crate::atmos::Tuning>) -> Option<Box<crate::atmos::Tuning>> {
        let mut cents = [0.0f64; 32];
        let n = t.cents().len().min(32);
        cents[..n].copy_from_slice(&t.cents()[..n]);
        self.a.at.set_scale(&cents[..n]);
        self.a.at.root_hz = t.root_hz();
        self.retune = true;
        self.tuning.replace(t)
    }

    /// Set a knob before the module is added to a patch.
    pub fn set(mut self, key: &str, value: f32) -> Self {
        if let Some(i) = knob(key) {
            self.knob(i, value);
        }
        self
    }

    fn knob(&mut self, index: u32, value: f32) {
        if let Some(key) = KEYS.get(index as usize) {
            if value.is_finite() && self.a.set(key, value as f64) {
                self.knobs[index as usize] = value;
                if self.tuning.is_some() {
                    self.retune = true;
                }
            }
        }
    }

    fn hz(note: &NoteEvent) -> f64 {
        440.0 * 2f64.powf((note.note as f64 - 69.0) / 12.0 + note.detune_cents as f64 / 1200.0)
    }

    /// A note at engine frame `frame`.
    fn note(&mut self, note: &NoteEvent, frame: u64) {
        let base = *self.base.get_or_insert(frame);
        let t = frame.saturating_sub(base) as f64 / self.rate as f64;
        let key = (note.note as usize).min(127);
        match note.kind {
            NoteKind::On => {
                if let Some(slot) = self.held[key].take() {
                    self.a.release(slot, t);
                }
                let o = Options { gain: Some(note.velocity as f64), ..Options::default() };
                self.held[key] = self.a.play(Self::hz(note), t, 3600.0, o, Route::Page);
            }
            NoteKind::Off => {
                if let Some(slot) = self.held[key].take() {
                    self.a.release(slot, t);
                }
            }
            NoteKind::AllOff => {
                self.a.release_all(t);
                self.held = [None; 128];
            }
        }
    }

    fn rebuild(&mut self, rate: f32) {
        let mut a = AtmosWeb::with_input(rate, Patch::default(), SEED);
        for (i, v) in self.knobs.iter().enumerate() {
            if !v.is_nan() {
                a.set(KEYS[i], *v as f64);
            }
        }
        self.a = Box::new(a);
        self.rate = rate;
        self.base = None;
        self.pos = 0;
        self.stage = [[0.0; QUANTUM]; 2];
        self.out = [[0.0; QUANTUM]; 2];
        self.held = [None; 128];
        if let Some(t) = self.tuning.take() {
            self.take_tuning(t);
        }
    }
}

impl Module for AtmosWebModule {
    fn preset_type(&self) -> Option<std::any::TypeId> {
        Some(std::any::TypeId::of::<AtmosWebState>())
    }
    fn visit_preset(&self, thing: &engine_core::Thing, visit: &mut dyn FnMut(EventKind)) {
        AtmosWebState::visit(thing, visit);
    }
    fn factory(&self) -> Option<engine_core::ModuleFactory> {
        let knobs = self.knobs.clone();
        let tuning = self.tuning.clone();
        Some(Box::new(move |rate, _| {
            let mut m = AtmosWebModule::new(rate);
            for (i, v) in knobs.iter().enumerate() {
                if !v.is_nan() {
                    m.knob(i as u32, *v);
                }
            }
            if let Some(t) = &tuning {
                m.take_tuning(t.clone());
            }
            Box::new(m)
        }))
    }
    fn transfer(&mut self, from: &dyn Module, _rate: f32) {
        if let Some(from) = (from as &dyn std::any::Any).downcast_ref::<AtmosWebModule>() {
            self.preset.inherit(&from.preset);
        }
    }
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Notes, Kind::Audio]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn latency(&self) -> usize {
        QUANTUM
    }
    /// A new rate is a new instrument, told every knob. Off the audio thread.
    fn prepare(&mut self, rate: f32, _max_block: usize) {
        if rate != self.rate {
            self.rebuild(rate);
        }
    }
    fn handle(&mut self, event: &EventKind) {
        match *event {
            EventKind::Param { index, value } => {
                self.preset.update(index, value);
                self.knob(index, value);
            }
            EventKind::Note(note) => {
                let frame = self.base.unwrap_or(0) + self.a.g.now().frame + self.pos as u64;
                self.note(&note, frame);
            }
            EventKind::Sound { .. } => {}
        }
    }
    fn take(&mut self, slot: u32, thing: engine_core::Thing) -> Option<engine_core::Thing> {
        if slot == engine_core::PRESET {
            let incoming = match thing.downcast::<AtmosWebState>() {
                Ok(state) => state,
                Err(other) => return Some(other),
            };
            let (old, controls) = AtmosWebState::exchange(&mut self.preset, incoming);
            for &(index, value) in &controls {
                self.handle(&EventKind::Param { index, value });
            }
            self.preset.restore(controls);
            return Some(old as engine_core::Thing);
        }
        if slot == crate::atmos::TUNING {
            return match thing.downcast::<crate::atmos::Tuning>() {
                Ok(t) => self.take_tuning(t).map(|old| old as engine_core::Thing),
                Err(other) => Some(other),
            };
        }
        Some(thing)
    }
    fn process(&mut self, io: &mut Io) {
        let start = io.frame;
        self.base.get_or_insert(start);
        // Every note of this piece, at its own sample: none can fall in a
        // quantum already rendered, which ends where the last piece did.
        for note in io.ins.notes(0) {
            let n = *note;
            self.note(&n, start + note.offset as u64);
        }
        let (il, ir) = io.ins.audio(1);
        let (ol, or) = io.outs.audio(0);
        let n = ol.len().min(or.len());
        for k in 0..n {
            // Out: the last quantum, a quantum late.
            ol[k] = self.out[0][self.pos];
            or[k] = self.out[1][self.pos];
            self.stage[0][self.pos] = il.get(k).copied().unwrap_or(0.0);
            self.stage[1][self.pos] = ir.get(k).copied().unwrap_or(0.0);
            self.pos += 1;
            if self.pos == QUANTUM {
                if self.retune {
                    self.retune = false;
                    self.a.retune_sympathy();
                }
                let [sl, sr] = self.stage;
                let quiet = sl.iter().chain(sr.iter()).all(|v| *v == 0.0);
                let input = if quiet { None } else { Some((&sl[..], &sr[..])) };
                let [mut l, mut r] = [[0.0f32; QUANTUM]; 2];
                self.a.render_output(input, &mut l, &mut r);
                self.out = [l, r];
                self.pos = 0;
            }
        }
    }
}
