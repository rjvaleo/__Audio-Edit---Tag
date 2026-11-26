//! [`Classic`] and the step sequencer as a module of the native engine: the
//! Seq page's steps played on its own clock, as `togglePlay` and `scheduler`
//! play them, through Classic, its filter, LFOs, delay and Space (audio out,
//! output 0), and sent out as notes too (output 1), so a patch can play
//! Atmosphere, Wave or anything else from the same steps. Notes in (input
//! 0) play Classic as the page's keys do (`kyNoteOn("classic", …)`), in
//! Seq's tuning (`kyHz`).
//!
//! Knob `i` is the page's control [`KEYS`]`[i]` at the page's raw value: a
//! slider's value (`atk` 10, `cutoff` 67), a select's index in its options
//! (`wave` 4 is Pulse, `tapeSpeed` 2 is 7.5 IPS) or its value where that is
//! a number (`stepLen` 0.5, `delayTime` 0.5). Each is turned into what the
//! synth takes exactly as the page's handler does, and where the handler
//! reads several controls at once (`updateEnv`, `updateFilter`, `updateLFO`,
//! `updateFilterADSR`, `updateDelay`) the module reads them all as well, so a
//! knob that was never moved holds the page's literal (LFO 2's 0.55 Hz)
//! until one beside it is. After the controls come the 64 steps, two knobs
//! each ([`step_knob`]): the degree and the rest. `play` 1 starts the steps
//! from the first, as Play does; 0 stops them. `preview` plays one note at
//! the pitch it is given (Hz), as a step's ▶, a degree chip or a key of the
//! 88 does.
//!
//! The scales are handed in whole ([`SeqModule::new`], `SCALES`' cents in
//! order), so `scale` is an index.
//!
//! The graph runs a quantum (128 frames) at a time, so the module is one
//! quantum late (`latency`), and its notes out are sent a quantum late too,
//! with the sound they go with. A step is laid on the graph just before the
//! quantum it falls in is rendered (the page lays it up to 0.1 s ahead; the
//! sound is the same, what a knob moved between does to it aside).

use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

use engine_core::{EventKind, Io, Kind, Module, NoteEvent, NoteKind};

use super::steps::{self, Cursor, Direction, MAX_STEPS};
use super::{Adsr, Classic, Delay, Held, Settings, Shape, Target};
use crate::atmos_web::Mulberry32;
use dsp_core::chromium::{fdlibm, QUANTUM};

/// Every control, by the page's element id (less `Slider` or `Select`).
/// Appended to, never reordered.
pub const KEYS: &[&str] = &[
    "bpm", "steps", "dir", "stepLen",
    "atk", "dec", "sus", "rel", "vol", "wave", "pw",
    "cutoff", "res", "keyFollow", "fatk", "fdec", "fsus", "frel", "famt",
    "lfo1Rate", "lfo1Depth", "lfo1Wave", "lfo1Target",
    "lfo2Rate", "lfo2Depth", "lfo2Wave", "lfo2Target",
    "lfo3Rate", "lfo3Depth", "lfo3Wave", "lfo3Target",
    "delayTime", "tapeSpeed", "delayFb", "delayWet", "delaySpread", "delayHiCut",
    "root", "octave", "scale", "play",
    "preview",
];

/// Each control's value as the page opens (its HTML), by [`KEYS`].
pub const DEFAULTS: &[f64] = &[
    120.0, 8.0, 0.0, 0.5,
    10.0, 80.0, 60.0, 200.0, 70.0, 0.0, 50.0,
    67.0, 10.0, 0.0, 10.0, 150.0, 30.0, 300.0, 50.0,
    50.0, 20.0, 0.0, 1.0,
    40.0, 25.0, 0.0, 4.0,
    40.0, 0.0, 0.0, 0.0,
    0.5, 2.0, 35.0, 25.0, 100.0, 75.0,
    9.0, 4.0, 0.0, 0.0,
    0.0,
];

/// `waveSelect`'s options, in order.
pub const WAVES: &[&str] = &["sine", "triangle", "sawtooth", "square", "pulse"];
/// `lfoNWaveSelect`'s.
pub const LFO_WAVES: &[&str] = &["sine", "triangle", "sawtooth"];
/// `lfoNTargetSelect`'s.
pub const LFO_TARGETS: &[&str] = &["", "filter", "resonance", "volume", "pw", "delay-wet"];
/// `dirSelect`'s.
pub const DIRECTIONS: &[&str] = &["fwd", "rev", "ping", "rand"];
/// `tapeSpeedSelect`'s, as `TAPE_SPEEDS` has them (inches per second).
pub const TAPE_SPEEDS: &[(&str, f64)] =
    &[("studio30", 30.0), ("studio15", 15.0), ("studio75", 7.5), ("studio375", 3.75), ("cassette", 1.875), ("micro", 0.9375)];

/// The knob of step `i`'s degree (`rest` false) or its rest (true).
pub fn step_knob(i: usize, rest: bool) -> u32 {
    (KEYS.len() + 2 * i.min(MAX_STEPS - 1) + rest as usize) as u32
}

/// The knob number of a control, by its name: one of [`KEYS`], or
/// `step<i>` / `rest<i>` for step `i` (0-based).
pub fn knob(key: &str) -> Option<u32> {
    if let Some(i) = KEYS.iter().position(|k| *k == key) {
        return Some(i as u32);
    }
    let (rest, n) = match (key.strip_prefix("step"), key.strip_prefix("rest")) {
        (Some(n), _) => (false, n),
        (_, Some(n)) => (true, n),
        _ => return None,
    };
    let i: usize = n.parse().ok()?;
    (i < MAX_STEPS).then(|| step_knob(i, rest))
}

/// Every knob the module has.
pub const KNOBS: usize = KEYS.len() + 2 * MAX_STEPS;

/// Every knob's value as the page opens: [`DEFAULTS`], then the steps'
/// (`degree: i % 7`, no rests).
pub fn default_knobs() -> Vec<f64> {
    let mut v = DEFAULTS.to_vec();
    for i in 0..MAX_STEPS {
        v.push((i % 7) as f64);
        v.push(0.0);
    }
    v
}

fn k(key: &str) -> usize {
    KEYS.iter().position(|x| *x == key).expect("a key of KEYS")
}

/// What the face shows of the steps as they play (`updatePlayingUI`),
/// written by the audio thread and read by the face whenever it likes.
pub struct SeqView {
    playing: AtomicBool,
    /// The step sounding now (-1: none), its pitch and its degree.
    step: AtomicI32,
    hz: AtomicU32,
    degree: AtomicI32,
    /// Steps played since Play.
    count: AtomicU64,
}

impl SeqView {
    pub fn new() -> Arc<SeqView> {
        Arc::new(SeqView {
            playing: AtomicBool::new(false),
            step: AtomicI32::new(-1),
            hz: AtomicU32::new(0),
            degree: AtomicI32::new(0),
            count: AtomicU64::new(0),
        })
    }

    /// Whether the steps are playing.
    pub fn playing(&self) -> bool {
        self.playing.load(Ordering::Relaxed)
    }

    /// The step last heard (0-based), its pitch in Hz and its degree in the
    /// scale (0-based), or None after Stop and before the first.
    pub fn now(&self) -> Option<(usize, f64, usize)> {
        let s = self.step.load(Ordering::Acquire);
        (s >= 0).then(|| {
            (s as usize, f32::from_bits(self.hz.load(Ordering::Relaxed)) as f64, self.degree.load(Ordering::Relaxed).max(0) as usize)
        })
    }

    /// Steps played since Play.
    pub fn count(&self) -> u64 {
        self.count.load(Ordering::Relaxed)
    }
}

/// A step heard, waiting for the frame it is heard at (the UI's
/// `setTimeout` till the note's time).
#[derive(Clone, Copy)]
struct Shown {
    frame: u64,
    step: i32,
    hz: f32,
    degree: i32,
}

pub type SeqState = engine_core::Preset<SeqModule>;

/// Notes that can wait at once (in, or out for their frame).
const PENDING: usize = 512;
/// The seed of the "rand" direction's draws (`Math.random` in the page).
const SEED: u32 = 0x53_65_71_21;

pub struct SeqModule {
    preset: Box<SeqState>,
    c: Box<Classic>,
    rate: f32,
    scales: Arc<Vec<Vec<f64>>>,
    /// Every knob's raw value (the page's), defaults in place.
    raw: Vec<f64>,
    /// Which knobs were set (for a module made again at a new rate).
    set: Vec<bool>,
    /// The steps (`steps`), and how they play.
    steps: [(i32, bool); MAX_STEPS],
    num_steps: usize,
    dir: Direction,
    rng: Mulberry32,
    cursor: Cursor,
    playing: bool,
    next_note_time: f64,
    step_count: u64,
    /// `lfo.phase`, moved on per step for the LFOs on Pulse W.
    pw_phase: [f64; 3],
    /// The scale's root, as `updateRoot` makes it.
    root_hz: f64,
    /// The tempo slew's next tick, in context seconds.
    next_slew: f64,
    /// The engine frame the graph's frame 0 is, once known.
    base: Option<u64>,
    stage_pos: usize,
    out: [[f32; QUANTUM]; 2],
    held: [Option<Held>; 128],
    /// Notes in waiting for their quantum, notes out for their frame.
    pending: Vec<(u64, NoteEvent)>,
    sent: Vec<(u64, NoteEvent)>,
    shown: Vec<Shown>,
    view: Option<Arc<SeqView>>,
}

impl SeqModule {
    /// The page's synth with `scales` (`SCALES`' cents, in order).
    /// Allocates: make it off the audio thread.
    pub fn new(rate: f32, scales: Vec<Vec<f64>>) -> Self {
        Self::with(rate, Arc::new(scales), None)
    }

    /// Showing what plays in `view`.
    pub fn with_view(rate: f32, scales: Vec<Vec<f64>>, view: Arc<SeqView>) -> Self {
        Self::with(rate, Arc::new(scales), Some(view))
    }

    fn with(rate: f32, scales: Arc<Vec<Vec<f64>>>, view: Option<Arc<SeqView>>) -> Self {
        let mut raw = vec![0.0; KNOBS];
        raw[..KEYS.len()].copy_from_slice(DEFAULTS);
        let mut steps = [(0i32, false); MAX_STEPS];
        for (i, s) in steps.iter_mut().enumerate() {
            *s = ((i % 7) as i32, false);
            raw[step_knob(i, false) as usize] = s.0 as f64;
        }
        SeqModule {
            preset: Box::new(SeqState::new(&[])),
            c: Box::new(Classic::new(rate, Settings::page())),
            rate,
            scales,
            raw,
            set: vec![false; KNOBS],
            steps,
            num_steps: 8,
            dir: Direction::Fwd,
            rng: Mulberry32(SEED),
            cursor: Cursor::default(),
            playing: false,
            next_note_time: 0.0,
            step_count: 0,
            pw_phase: [0.0; 3],
            root_hz: 440.0,
            next_slew: 0.0,
            base: None,
            stage_pos: 0,
            out: [[0.0; QUANTUM]; 2],
            held: [None; 128],
            pending: Vec::with_capacity(PENDING),
            sent: Vec::with_capacity(PENDING),
            shown: Vec::with_capacity(PENDING),
            view,
        }
    }

    /// Set a control before the module is added to a patch.
    pub fn set(mut self, key: &str, value: f64) -> Self {
        if let Some(i) = knob(key) {
            self.knob(i, value);
        }
        self
    }

    /// Set knob `index` before the module is added to a patch.
    pub fn set_knob(mut self, index: u32, value: f64) -> Self {
        self.knob(index, value);
        self
    }

    /// The synth, to read (tests and probes).
    pub fn classic(&self) -> &Classic {
        &self.c
    }

    fn r(&self, key: &str) -> f64 {
        self.raw[k(key)]
    }

    /// `parseInt` of a slider's value.
    fn int(&self, key: &str) -> f64 {
        self.r(key).trunc()
    }

    fn cents(&self) -> &[f64] {
        let i = (self.r("scale").max(0.0) as usize).min(self.scales.len().saturating_sub(1));
        self.scales.get(i).map(|c| &c[..]).unwrap_or(&[])
    }

    fn now(&self) -> f64 {
        self.c.g.current_time()
    }

    /// A control moved: its raw value kept, and its handler run.
    fn knob(&mut self, index: u32, value: f64) {
        let i = index as usize;
        if i >= KNOBS || !value.is_finite() {
            return;
        }
        self.raw[i] = value;
        self.set[i] = true;
        if i >= KEYS.len() {
            let n = (i - KEYS.len()) / 2;
            if (i - KEYS.len()) % 2 == 0 {
                self.steps[n].0 = value as i32;
            } else {
                self.steps[n].1 = value != 0.0;
            }
            return;
        }
        let key = KEYS[i];
        let pick = |list: &[&'static str], v: f64| list[(v.max(0.0) as usize).min(list.len() - 1)];
        match key {
            "bpm" => self.c.set_bpm(value.trunc()),
            "steps" => self.num_steps = (value.trunc() as usize).clamp(1, MAX_STEPS),
            "dir" => self.dir = Direction::from_name(pick(DIRECTIONS, value)),
            "stepLen" => self.c.s.step_beats = value,
            "atk" | "dec" | "sus" | "rel" => {
                self.c.s.adsr = Adsr { a: self.int("atk"), d: self.int("dec"), s: self.int("sus") / 100.0, r: self.int("rel") };
            }
            "vol" => self.c.set_volume(self.int("vol") / 100.0),
            "wave" => self.c.s.wave = Shape::from_name(pick(WAVES, value)).unwrap_or(Shape::Sine),
            "pw" => self.c.s.pulse_width = self.int("pw") / 100.0,
            "cutoff" | "res" => {
                let cutoff = 20.0 * fdlibm::pow(1000.0, self.int("cutoff") / 100.0);
                let q = 0.1 + (self.int("res") / 100.0) * 19.9;
                self.c.set_filter(cutoff, q);
            }
            "keyFollow" => self.c.s.key_follow = self.int("keyFollow") / 100.0,
            "fatk" | "fdec" | "fsus" | "frel" | "famt" => {
                self.c.s.filter_env = Adsr { a: self.int("fatk"), d: self.int("fdec"), s: self.int("fsus") / 100.0, r: self.int("frel") };
                self.c.s.amount = self.int("famt") / 100.0;
            }
            "tapeSpeed" => self.c.s.tape_ips = TAPE_SPEEDS[(value.max(0.0) as usize).min(TAPE_SPEEDS.len() - 1)].1,
            "delayTime" | "delayFb" | "delayWet" | "delaySpread" | "delayHiCut" => {
                let d = Delay {
                    subdiv: self.r("delayTime"),
                    feedback: self.int("delayFb") / 100.0,
                    wet: self.int("delayWet") / 100.0,
                    spread: self.int("delaySpread") / 100.0,
                    hi_cut: 200.0 * fdlibm::pow(100.0, self.int("delayHiCut") / 100.0),
                };
                self.c.set_delay(d);
            }
            "root" | "octave" => self.root_hz = steps::root_hz(self.int("root") as i32, self.int("octave") as i32),
            "scale" => {}
            // `previewStep`, a degree chip, a key of the 88 (`playNote`): one
            // step's note at this pitch, now. Not kept.
            "preview" => {
                self.set[i] = false;
                if value > 0.0 {
                    let t = self.now();
                    self.c.play_note(value, t, 1.0);
                }
            }
            "play" => {
                if value != 0.0 {
                    if !self.playing {
                        self.start();
                    }
                } else {
                    self.stop();
                }
            }
            _ => {
                // lfoN…
                let n = key.as_bytes()[3] - b'1';
                let i = n as usize;
                let p = lfo_knobs(i);
                if key.ends_with("Target") {
                    let t = Target::from_name(pick(LFO_TARGETS, value));
                    self.c.set_lfo_target(i, t);
                } else {
                    let rate = 0.05 * fdlibm::pow(400.0, self.raw[p.0].trunc() / 100.0);
                    let depth = self.raw[p.1].trunc() / 100.0;
                    let wave = Shape::from_name(pick(LFO_WAVES, self.raw[p.2])).unwrap_or(Shape::Sine);
                    self.c.set_lfo(i, rate, depth, wave);
                }
            }
        }
    }

    /// `togglePlay`, from stopped: from the first step, 50 ms from now.
    fn start(&mut self) {
        self.playing = true;
        self.cursor = Cursor::default();
        self.step_count = 0;
        self.next_note_time = self.now() + 0.05;
        if let Some(v) = &self.view {
            v.playing.store(true, Ordering::Relaxed);
            v.count.store(0, Ordering::Relaxed);
        }
    }

    /// `stopSeq`: the steps stop; what sounds rings out.
    fn stop(&mut self) {
        self.playing = false;
        self.cursor = Cursor::default();
        self.shown.clear();
        if let Some(v) = &self.view {
            v.playing.store(false, Ordering::Relaxed);
            v.step.store(-1, Ordering::Release);
        }
    }

    /// The engine frame of context time `t`, with the module's latency.
    fn frame_of(&self, t: f64) -> u64 {
        self.base.unwrap_or(0) + (t * self.rate as f64).round().max(0.0) as u64 + QUANTUM as u64
    }

    /// A note out at context time `t`.
    fn send(&mut self, t: f64, note: NoteEvent) {
        if self.sent.len() < self.sent.capacity() {
            let f = self.frame_of(t);
            self.sent.push((f, note));
        }
    }

    /// `scheduler`'s loop for the quantum about to be rendered: every step
    /// that falls in it.
    fn schedule(&mut self) {
        if !self.playing {
            return;
        }
        let end = (self.c.g.now().frame + QUANTUM as u64) as f64 / self.rate as f64;
        while self.next_note_time < end {
            let t = self.next_note_time;
            let si = self.cursor.current.max(0) as usize % MAX_STEPS;
            let (degree, rest) = self.steps[si];
            let step_dur = self.c.s.step_dur();
            let mut pw_mod = 0.0;
            for i in 0..3 {
                let l = self.c.s.lfos[i];
                if l.target == Target::Pw {
                    self.pw_phase[i] += l.rate * step_dur * 2.0 * core::f64::consts::PI;
                    pw_mod += fdlibm::sin(self.pw_phase[i]) * l.depth * 0.45;
                }
            }
            if self.c.s.wave == Shape::Pulse {
                self.c.current_pw = 0.05f64.max(0.95f64.min(self.c.s.pulse_width + pw_mod));
            }
            if !rest {
                let freq = steps::degree_hz(self.cents(), self.root_hz, degree);
                if freq.is_finite() && freq > 0.0 {
                    self.c.play_note(freq, t, 1.0);
                    let exact = 69.0 + 12.0 * (freq / 440.0).log2();
                    let note = exact.round().clamp(0.0, 127.0);
                    let on = NoteEvent { detune_cents: ((exact - note) * 100.0) as f32, ..NoteEvent::on(note as u8, 1.0) };
                    self.send(t, on);
                    self.send(t + step_dur * 0.85, NoteEvent::off(note as u8));
                    let n = self.cents().len().max(1) as i32;
                    if self.shown.len() < self.shown.capacity() {
                        let frame = self.frame_of(t);
                        self.shown.push(Shown { frame, step: si as i32, hz: freq as f32, degree: degree.rem_euclid(n) });
                    }
                }
            }
            self.next_note_time += step_dur;
            self.step_count += 1;
            self.cursor.next(self.num_steps, self.dir, &mut self.rng);
        }
    }

    /// A key, at the quantum it falls in (`kyNoteOn`, `kyNoteOff`).
    fn key(&mut self, note: &NoteEvent) {
        let key = (note.note as usize).min(127);
        let t = self.now();
        match note.kind {
            NoteKind::On => {
                if let Some(h) = self.held[key].take() {
                    self.c.release(h, t);
                }
                let midi = note.note as i32;
                let (root, oct) = (self.int("root") as i32, self.int("octave") as i32);
                let hz = steps::key_hz(self.cents(), self.root_hz, midi, root, oct)
                    .unwrap_or_else(|| 440.0 * fdlibm::pow(2.0, (midi - 69) as f64 / 12.0));
                self.held[key] = self.c.key_on(hz, note.velocity as f64);
            }
            NoteKind::Off => {
                if let Some(h) = self.held[key].take() {
                    self.c.release(h, t);
                }
            }
            NoteKind::AllOff => {
                self.c.release_all(t);
                self.held = [None; 128];
            }
        }
    }

    fn lay_due(&mut self) {
        let Some(base) = self.base else { return };
        let end = base + self.c.g.now().frame + QUANTUM as u64;
        let mut j = 0;
        while j < self.pending.len() {
            if self.pending[j].0 < end {
                let (_, note) = self.pending.remove(j);
                self.key(&note);
            } else {
                j += 1;
            }
        }
    }

    /// The tempo slew's ticks that fall before the quantum about to render.
    fn slew(&mut self) {
        let now = self.now();
        if self.next_slew > now + 1.0 || self.next_slew == 0.0 {
            self.next_slew = now;
        }
        while self.next_slew <= now {
            self.c.slew(super::BPM_SLEW_TICK);
            self.next_slew += super::BPM_SLEW_TICK;
        }
    }

    fn render(&mut self) {
        self.slew();
        self.lay_due();
        self.schedule();
        let [mut l, mut r] = [[0.0f32; QUANTUM]; 2];
        self.c.render(&mut l, &mut r);
        self.out = [l, r];
    }

    fn rebuild(&mut self, rate: f32) {
        let mut m = SeqModule::with(rate, self.scales.clone(), self.view.clone());
        for i in 0..KNOBS {
            if self.set[i] && i != k("play") {
                m.knob(i as u32, self.raw[i]);
            }
        }
        if self.playing {
            m.knob(k("play") as u32, 1.0);
        }
        m.preset = std::mem::replace(&mut self.preset, Box::new(SeqState::new(&[])));
        *self = m;
    }
}

/// LFO `i`'s rate, depth and wave knobs.
fn lfo_knobs(i: usize) -> (usize, usize, usize) {
    let at = k("lfo1Rate") + 4 * i;
    (at, at + 1, at + 2)
}

impl Module for SeqModule {
    fn preset_type(&self) -> Option<std::any::TypeId> {
        Some(std::any::TypeId::of::<SeqState>())
    }
    fn visit_preset(&self, thing: &engine_core::Thing, visit: &mut dyn FnMut(EventKind)) {
        SeqState::visit(thing, visit);
    }
    fn factory(&self) -> Option<engine_core::ModuleFactory> {
        let raw = self.raw.clone();
        let set = self.set.clone();
        let scales = self.scales.clone();
        let view = self.view.clone();
        Some(Box::new(move |rate, _| {
            let mut m = SeqModule::with(rate, scales.clone(), view.clone());
            for i in 0..KNOBS {
                if set[i] {
                    m.knob(i as u32, raw[i]);
                }
            }
            Box::new(m)
        }))
    }
    fn transfer(&mut self, from: &dyn Module, _rate: f32) {
        if let Some(from) = (from as &dyn std::any::Any).downcast_ref::<SeqModule>() {
            self.preset.inherit(&from.preset);
        }
    }
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Notes]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio, Kind::Notes]
    }
    fn latency(&self) -> usize {
        QUANTUM
    }
    /// A new rate is a new synth, told every knob. Off the audio thread.
    fn prepare(&mut self, rate: f32, _max_block: usize) {
        if rate != self.rate {
            self.rebuild(rate);
        }
    }
    fn handle(&mut self, event: &EventKind) {
        match *event {
            EventKind::Param { index, value } => {
                self.preset.update(index, value);
                self.knob(index, value as f64);
            }
            EventKind::Note(note) => {
                let frame = self.base.unwrap_or(0) + self.c.g.now().frame + self.stage_pos as u64;
                if self.pending.len() < self.pending.capacity() {
                    self.pending.push((frame, note));
                } else {
                    self.key(&note);
                }
            }
            EventKind::Sound { .. } => {}
        }
    }
    fn take(&mut self, slot: u32, thing: engine_core::Thing) -> Option<engine_core::Thing> {
        if slot == engine_core::PRESET {
            let incoming = match thing.downcast::<SeqState>() {
                Ok(state) => state,
                Err(other) => return Some(other),
            };
            let (old, controls) = SeqState::exchange(&mut self.preset, incoming);
            for &(index, value) in &controls {
                self.handle(&EventKind::Param { index, value });
            }
            self.preset.restore(controls);
            return Some(old as engine_core::Thing);
        }
        Some(thing)
    }
    fn process(&mut self, io: &mut Io) {
        let start = io.frame;
        self.base.get_or_insert(start);
        for note in io.ins.notes(0) {
            if self.pending.len() < self.pending.capacity() {
                self.pending.push((start + note.offset as u64, *note));
            }
        }
        let n = io.n;
        {
            let (ol, or) = io.outs.audio(0);
            let n = n.min(ol.len()).min(or.len());
            for j in 0..n {
                ol[j] = self.out[0][self.stage_pos];
                or[j] = self.out[1][self.stage_pos];
                self.stage_pos += 1;
                if self.stage_pos == QUANTUM {
                    self.render();
                    self.stage_pos = 0;
                }
            }
        }
        // The notes and the steps heard in this piece, at their frames.
        let end = start + n as u64;
        let out = io.outs.notes(1);
        let mut j = 0;
        while j < self.sent.len() {
            let (f, note) = self.sent[j];
            if f < end {
                let _ = out.push(NoteEvent { offset: f.saturating_sub(start) as u32, ..note });
                self.sent.remove(j);
            } else {
                j += 1;
            }
        }
        if let Some(v) = &self.view {
            let mut j = 0;
            while j < self.shown.len() {
                let s = self.shown[j];
                if s.frame < end {
                    v.hz.store(s.hz.to_bits(), Ordering::Relaxed);
                    v.degree.store(s.degree, Ordering::Relaxed);
                    v.step.store(s.step, Ordering::Release);
                    v.count.fetch_add(1, Ordering::Relaxed);
                    self.shown.remove(j);
                } else {
                    j += 1;
                }
            }
        } else {
            self.shown.clear();
        }
    }
}
