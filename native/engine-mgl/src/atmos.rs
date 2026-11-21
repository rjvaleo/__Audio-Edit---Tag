//! Atmosphere, MultiGrainLive's physically modelled synth, as a module.
//!
//! The synth is `core/crates/atmos`, the same code the page runs in its
//! AudioWorklet (`ui/sequencer/atmos.wasm`). It is a synth of its own: its own
//! models, filter, amp, LFOs and tuning, sharing nothing with Wave or Seq's.
//!
//! Knobs are numbered by [`KEYS`]: knob `i` is the synth's control `KEYS[i]`,
//! the name the page sends. Input 0 takes notes, output 0 is stereo audio. A
//! note sounds at its own pitch, equal tempered from A 440, moved by its fine
//! detune (`NoteEvent::detune_cents`), on its own sample — until it is given
//! a [`Tuning`] (`Controller::give(module, TUNING, Box::new(tuning))`): then
//! every key sounds where the page's `atKeyHz` puts it, and the synth's Fit
//! takes the tuning's scale.
//!
//! Given an [`AtmosView`] ([`Atmos::with_view`]), it copies what each
//! oscillator shows (`atmos::Synth::view`) there every block, for the face to
//! draw from another thread.

use engine_core::{EventKind, Io, Kind, Module, NoteEvent, NoteKind};
use std::sync::atomic::{AtomicI32, AtomicU32, Ordering};
use std::sync::Arc;

/// The slot a [`Tuning`] is given on.
pub const TUNING: u32 = 0;

/// Atmosphere's own tuning as the page keeps it (atmos.js, "ITS OWN
/// TUNING"): a scale's degrees in cents above the root, and the root's MIDI
/// key (`atRootMidi`: root + (octave + 1) × 12). Built on the app's thread
/// and handed over; the one it replaces comes back to be freed there.
#[derive(Clone, Debug, PartialEq)]
pub struct Tuning {
    cents: [f64; atmos::SCALE_MAX],
    len: usize,
    pub root_midi: f64,
}

impl Tuning {
    /// At most 64 degrees are kept; an empty scale is the root alone.
    pub fn new(cents: &[f64], root_midi: f64) -> Tuning {
        let mut c = [0.0; atmos::SCALE_MAX];
        let n = cents.len().min(atmos::SCALE_MAX);
        c[..n].copy_from_slice(&cents[..n]);
        Tuning { cents: c, len: n.max(1), root_midi }
    }

    /// `atScale().cents`.
    pub fn cents(&self) -> &[f64] {
        &self.cents[..self.len]
    }

    /// `atRootHz`.
    pub fn root_hz(&self) -> f64 {
        440.0 * 2f64.powf((self.root_midi - 69.0) / 12.0)
    }

    /// `atKeyHz(k)`: key `k`'s own semitone, tuned to a degree of the scale
    /// where one lies within a quarter tone of it.
    pub fn key_hz(&self, k: f64) -> f64 {
        let diff = (k - self.root_midi) * 100.0;
        let oct = (diff / 1200.0).floor();
        let (mut best, mut dist) = (diff, 50.0);
        for o in [oct - 1.0, oct, oct + 1.0] {
            for &c in self.cents() {
                let s = c + o * 1200.0;
                let d = (diff - s).abs();
                if d < dist {
                    dist = d;
                    best = s;
                }
            }
        }
        self.root_hz() * 2f64.powf(best / 1200.0)
    }
}

impl Default for Tuning {
    /// What "Same as Seq" is as Seq starts: Ionian on A 4 (440 Hz).
    fn default() -> Tuning {
        Tuning::new(&[0.0, 200.0, 400.0, 500.0, 700.0, 900.0, 1100.0], 69.0)
    }
}

/// What each oscillator of the most recent voice shows, written by the audio
/// thread every block and read by the face whenever it likes. A reading may
/// mix two blocks; for a picture nobody can tell.
pub struct AtmosView {
    model: [AtomicI32; 2],
    v: [[AtomicU32; 32]; 2],
}

impl AtmosView {
    pub fn new() -> Arc<AtmosView> {
        Arc::new(AtmosView {
            model: [AtomicI32::new(-1), AtomicI32::new(-1)],
            v: std::array::from_fn(|_| std::array::from_fn(|_| AtomicU32::new(0))),
        })
    }

    /// Oscillator `which` (0 A, 1 B): its model's number (`AT_MODELS` order)
    /// and its 32 values into `out`, or None when nothing sounds.
    pub fn read(&self, which: usize, out: &mut [f32; 32]) -> Option<usize> {
        let w = which.min(1);
        let m = self.model[w].load(Ordering::Acquire);
        if m < 0 {
            return None;
        }
        for (o, a) in out.iter_mut().zip(self.v[w].iter()) {
            *o = f32::from_bits(a.load(Ordering::Relaxed));
        }
        Some(m as usize)
    }

    fn write(&self, synth: &atmos::Synth) {
        for w in 0..2 {
            match synth.view(w) {
                Some((m, v)) => {
                    for (a, x) in self.v[w].iter().zip(v.iter()) {
                        a.store(x.to_bits(), Ordering::Relaxed);
                    }
                    self.model[w].store(m as i32, Ordering::Release);
                }
                None => self.model[w].store(-1, Ordering::Release),
            }
        }
    }
}

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
    /// The tuning given, if one was; equal temperament until then.
    tuning: Option<Box<Tuning>>,
    view: Option<Arc<AtmosView>>,
}

impl Atmos {
    pub fn new(rate: f32) -> Atmos {
        Atmos {
            preset: Box::new(AtmosState::new(&[])),
            synth: atmos::Synth::new(rate),
            rate,
            knobs: vec![f32::NAN; KEYS.len()],
            tuning: None,
            view: None,
        }
    }

    /// The same, writing what its oscillators show into `view` every block.
    pub fn with_view(rate: f32, view: Arc<AtmosView>) -> Atmos {
        Atmos { view: Some(view), ..Atmos::new(rate) }
    }

    /// Start with `tuning`, before the module is added to a patch.
    pub fn tuned(mut self, tuning: Tuning) -> Atmos {
        self.retune(Box::new(tuning));
        self
    }

    /// Take `tuning`; the one it replaces back.
    fn retune(&mut self, tuning: Box<Tuning>) -> Option<Box<Tuning>> {
        let mut cents = [0.0f32; atmos::SCALE_MAX];
        let n = tuning.cents().len();
        for (c, x) in cents.iter_mut().zip(tuning.cents()) {
            *c = *x as f32;
        }
        self.synth.set_scale(&cents[..n]);
        self.tuning.replace(tuning)
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

    /// A note's pitch: where the tuning puts its key (equal tempered from
    /// A 440 with none), moved by its fine detune.
    fn hz(&self, note: &NoteEvent) -> f32 {
        match &self.tuning {
            Some(t) => (t.key_hz(note.note as f64) * 2f64.powf(note.detune_cents as f64 / 1200.0)) as f32,
            None => 440.0 * 2f32.powf((note.note as f32 - 69.0) / 12.0 + note.detune_cents / 1200.0),
        }
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
        let tuning = self.tuning.clone();
        let view = self.view.clone();
        Some(Box::new(move |rate, _| {
            let mut module = Atmos::new(rate);
            module.view = view.clone();
            for (i, v) in knobs.iter().enumerate() {
                if !v.is_nan() {
                    module.knob(i as u32, *v);
                }
            }
            if let Some(t) = &tuning {
                module.retune(t.clone());
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
            if let Some(t) = self.tuning.take() {
                self.retune(t);
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
                NoteKind::On => {
                    let hz = self.hz(&note);
                    self.synth.note_on(note.note as i32, hz, note.velocity, 0)
                }
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
        if slot == TUNING {
            return match thing.downcast::<Tuning>() {
                Ok(t) => match self.retune(t) {
                    Some(old) => Some(old as engine_core::Thing),
                    None => None,
                },
                Err(other) => Some(other),
            };
        }
        Some(thing)
    }
    /// Notes land on their own sample: the synth takes each with its delay
    /// from the start of this piece, and renders the piece whole.
    fn process(&mut self, io: &mut Io) {
        for note in io.ins.notes(0) {
            let at = note.offset;
            match note.kind {
                NoteKind::On => {
                    let hz = self.hz(note);
                    self.synth.note_on(note.note as i32, hz, note.velocity, at)
                }
                NoteKind::Off => self.synth.note_off(note.note as i32, at),
                NoteKind::AllOff => self.synth.all_off(),
            }
        }
        let (l, r) = io.outs.audio(0);
        self.synth.render(l, r);
        if let Some(view) = &self.view {
            view.write(&self.synth);
        }
    }
}
