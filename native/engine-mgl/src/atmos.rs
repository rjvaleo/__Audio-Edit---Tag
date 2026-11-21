//! Atmosphere, MultiGrainLive's physically modelled synth, as a module.
//!
//! The synth is `core/crates/atmos`, the same code the page runs in its
//! AudioWorklet (`ui/sequencer/atmos.wasm`). It is a synth of its own: its own
//! models, filter, amp, LFOs and tuning, sharing nothing with Wave or Seq's.
//!
//! Knobs are numbered by [`KEYS`]: knob `i` is the synth's control `KEYS[i]`,
//! the name the page sends. Input 0 takes notes, output 0 is stereo audio. A
//! note sounds at its own pitch, equal tempered from A 440, moved by its fine
//! detune (`NoteEvent::detune_cents`), on its own sample.

use engine_core::{EventKind, Io, Kind, Module, NoteEvent, NoteKind};

/// Every control of the synth, by the name `atmos::Synth::set` takes. Knob
/// `i` is `KEYS[i]`; the order never changes, so a saved patch keeps its
/// meaning. Appended to, never reordered.
pub const KEYS: &[&str] = &[
    "a.model", "a.p0", "a.p1", "a.p2", "a.p3", "a.oct", "a.fine",
    "b.model", "b.p0", "b.p1", "b.p2", "b.p3", "b.oct", "b.fine",
    "blend", "unison", "detune", "width", "drift", "sub", "air", "glide",
    "atk", "dec", "sus", "rel", "vol",
    "flt.type", "flt.cut", "flt.q", "flt.key", "flt.amt", "flt.atk", "flt.dec", "flt.sus", "flt.rel",
    "fit",
    "lfo1.shape", "lfo1.rate", "lfo1.depth", "lfo1.target",
    "lfo2.shape", "lfo2.rate", "lfo2.depth", "lfo2.target",
    "lfo3.shape", "lfo3.rate", "lfo3.depth", "lfo3.target",
];

/// The knob number of a control, by its name.
pub fn knob(key: &str) -> Option<u32> {
    KEYS.iter().position(|k| *k == key).map(|i| i as u32)
}

pub type AtmosState = engine_core::Preset<Atmos>;

/// Atmosphere. Built with the synth's own defaults; knobs move it from there.
pub struct Atmos {
    preset: Box<AtmosState>,
    synth: atmos::Synth,
    rate: f32,
    /// Every knob as last set, so a synth built again for a new rate is told
    /// the same; NaN for a knob never touched (the synth's default stands).
    knobs: Vec<f32>,
}

impl Atmos {
    pub fn new(rate: f32) -> Atmos {
        Atmos {
            preset: Box::new(AtmosState::new(&[])),
            synth: atmos::Synth::new(rate),
            rate,
            knobs: vec![f32::NAN; KEYS.len()],
        }
    }

    /// Set a knob before the module is added to a patch.
    pub fn set(mut self, key: &str, value: f32) -> Atmos {
        if let Some(i) = knob(key) {
            self.knob(i, value);
        }
        self
    }

    fn knob(&mut self, index: u32, value: f32) {
        if let Some(key) = KEYS.get(index as usize) {
            if self.synth.set(key, value) {
                self.knobs[index as usize] = value;
            }
        }
    }

    /// A note's pitch: equal tempered from A 440, moved by its fine detune.
    fn hz(note: &NoteEvent) -> f32 {
        440.0 * 2f32.powf((note.note as f32 - 69.0) / 12.0 + note.detune_cents / 1200.0)
    }
}

impl Module for Atmos {
    fn preset_type(&self) -> Option<std::any::TypeId> {
        Some(std::any::TypeId::of::<AtmosState>())
    }
    fn visit_preset(&self, thing: &engine_core::Thing, visit: &mut dyn FnMut(EventKind)) {
        AtmosState::visit(thing, visit);
    }
    fn parallel_weight(&self) -> usize {
        16
    }
    fn parallel_active(&self) -> bool {
        self.synth.sounding() > 0
    }
    fn factory(&self) -> Option<engine_core::ModuleFactory> {
        let knobs = self.knobs.clone();
        Some(Box::new(move |rate, _| {
            let mut module = Atmos::new(rate);
            for (i, v) in knobs.iter().enumerate() {
                if !v.is_nan() {
                    module.knob(i as u32, *v);
                }
            }
            Box::new(module)
        }))
    }
    fn transfer(&mut self, from: &dyn Module, _rate: f32) {
        if let Some(from) = (from as &dyn std::any::Any).downcast_ref::<Atmos>() {
            self.preset.inherit(&from.preset);
        }
    }
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Notes]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    /// A new rate is a new synth, told every knob the old one had. Off the
    /// audio thread.
    fn prepare(&mut self, rate: f32, _max_block: usize) {
        if rate != self.rate {
            self.rate = rate;
            self.synth = atmos::Synth::new(rate);
            for i in 0..KEYS.len() {
                let v = self.knobs[i];
                if !v.is_nan() {
                    self.synth.set(KEYS[i], v);
                }
            }
        }
    }
    fn handle(&mut self, event: &EventKind) {
        match *event {
            EventKind::Param { index, value } => {
                self.preset.update(index, value);
                self.knob(index, value);
            }
            EventKind::Note(note) => match note.kind {
                NoteKind::On => self.synth.note_on(note.note as i32, Self::hz(&note), note.velocity, 0),
                NoteKind::Off => self.synth.note_off(note.note as i32, 0),
                NoteKind::AllOff => self.synth.all_off(),
            },
            EventKind::Sound { .. } => {}
        }
    }
    fn take(&mut self, slot: u32, thing: engine_core::Thing) -> Option<engine_core::Thing> {
        if slot == engine_core::PRESET {
            let incoming = match thing.downcast::<AtmosState>() {
                Ok(state) => state,
                Err(other) => return Some(other),
            };
            let (old, controls) = AtmosState::exchange(&mut self.preset, incoming);
            for &(index, value) in &controls {
                self.handle(&EventKind::Param { index, value });
            }
            self.preset.restore(controls);
            return Some(old as engine_core::Thing);
        }
        Some(thing)
    }
    /// Notes land on their own sample: the synth takes each with its delay
    /// from the start of this piece, and renders the piece whole.
    fn process(&mut self, io: &mut Io) {
        for note in io.ins.notes(0) {
            let at = note.offset;
            match note.kind {
                NoteKind::On => self.synth.note_on(note.note as i32, Self::hz(note), note.velocity, at),
                NoteKind::Off => self.synth.note_off(note.note as i32, at),
                NoteKind::AllOff => self.synth.all_off(),
            }
        }
        let (l, r) = io.outs.audio(0);
        self.synth.render(l, r);
    }
}
