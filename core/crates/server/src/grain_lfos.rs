//! The Grain page's four LFOs: `POST/GET /api/engine/lfos`, and what the
//! automation runner hears of them.
//!
//! Not the lane [`crate::automation::Modulator`]. That is a pure function of
//! absolute time, on purpose, so the waveform, playback and export agree; which
//! is the bug for a control you turn while it runs, since any new rate throws
//! the phase somewhere else. It has four of these seven shapes and no Each note
//! either. Each LFO here carries a phase and advances it by rate × elapsed, so
//! a change of rate changes the speed and never the place.
//!
//! # Heard, never stored
//!
//! The rule the whole file exists for. The document and the undo stack are
//! never written. A control's base value is read from the document on every
//! tick, never from `Shared::params`, which is where the last swing went: read
//! from there, the modulation feeds on itself and walks away. So a hand on a
//! control an LFO is moving just moves the base, and an LFO taken off a control
//! puts back exactly the number the document holds.
//!
//! # How far it swings
//!
//! Depth is a share of the control's whole travel, either side of the base, as
//! the mock-up has it. A Grain bar's travel is what the page draws (`Travel`,
//! sent with the target), so the indicator stays on its bar, which is not what
//! the lane table has: Rate is a square law to 500 on the page and linear to
//! 2000 there. The table's range is still the outer limit. A rack knob travels
//! as its effect's own `resolve` says.
//!
//! # What refuses
//!
//! [`NOT_LIVE`] lists what the engine cannot move while it plays. Hold, Spread,
//! Resolution and Margin are the hybrid's separation, a pass over the whole
//! file; Detector, Floor and Guard only exist inside the transient map, also a
//! pass over the whole file. All of those would be a modulator moving a number
//! nobody hears. The Seed is the document's.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::automation::{self, Automation, Range, Write};
use crate::http::{Request, Response};
use crate::json::{self, Value};
use crate::rack::{RackSpec, SlotSpec};
use crate::state::{App, NowPlaying};

pub const COUNT: usize = 4;

/// What the engine cannot be made to do while it plays, and why, for the
/// page's tooltip. Pinned against the lane table by a test: a name here is
/// either absent from `STRETCH_TARGETS` or was put there in error.
pub const NOT_LIVE: &[(&str, &str)] = &[
    ("stretch.hybrid.timeSpan", "Hold is part of the separation: moving it splits the whole file again"),
    ("stretch.hybrid.freqSpan", "Spread is part of the separation: moving it splits the whole file again"),
    ("stretch.hybrid.fftSize", "Resolution is part of the separation: moving it splits the whole file again"),
    ("stretch.hybrid.margin", "Margin is part of the separation: moving it splits the whole file again"),
    ("stretch.grain.seed", "The seed picks every random choice once, for the whole sound"),
    ("stretch.wsola.sensitivity", "Detector is only heard when the transient map is rebuilt, a pass over the whole file"),
    ("stretch.wsola.floor", "Floor is only heard when the transient map is rebuilt, a pass over the whole file"),
    ("stretch.wsola.guardHops", "Guard is only heard when the transient map is rebuilt, a pass over the whole file"),
];

/// Why a target cannot be mapped, or `None` if it can.
pub fn refused(target: &str) -> Option<&'static str> {
    if let Some((_, why)) = NOT_LIVE.iter().find(|(t, _)| *t == target) {
        return Some(why);
    }
    if target.starts_with("fx.") || automation::stretch_range(target).is_some() && target.starts_with("stretch.") {
        return None;
    }
    Some("Not something an LFO can move")
}

// ──────────────────────────────────────────────────────────────── the shapes

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shape {
    Sine,
    Tri,
    Up,
    Down,
    Square,
    Steps,
    Smooth,
}

impl Shape {
    pub fn from_name(s: &str) -> Option<Shape> {
        Some(match s {
            "sine" => Shape::Sine,
            "tri" => Shape::Tri,
            "up" => Shape::Up,
            "down" => Shape::Down,
            "square" => Shape::Square,
            "steps" => Shape::Steps,
            "smooth" => Shape::Smooth,
            _ => return None,
        })
    }

    /// The value at `u`, 0..1 through cycle number `cycle`: 0..1, the same
    /// numbers `gsLfoVal` draws. The two random shapes take the mock-up's hash,
    /// so the scope and what is heard are the same curve.
    pub fn at(self, u: f64, cycle: f64) -> f64 {
        let u = u.rem_euclid(1.0);
        match self {
            Shape::Sine => 0.5 + 0.5 * (u * std::f64::consts::TAU).sin(),
            Shape::Tri => {
                if u < 0.25 {
                    0.5 + 2.0 * u
                } else if u < 0.75 {
                    1.5 - 2.0 * u
                } else {
                    2.0 * u - 1.5
                }
            }
            Shape::Up => u,
            Shape::Down => 1.0 - u,
            Shape::Square => {
                if u < 0.5 {
                    1.0
                } else {
                    0.0
                }
            }
            Shape::Steps => rnd(cycle * 8.0 + (u * 8.0).floor()),
            Shape::Smooth => {
                let k = u * 4.0;
                let (i, f) = (k.floor(), k - k.floor());
                let (a, b) = (rnd(cycle * 4.0 + i), rnd(cycle * 4.0 + i + 1.0));
                a + (b - a) * (0.5 - 0.5 * (std::f64::consts::PI * f).cos())
            }
        }
    }
}

/// `gsRnd`.
fn rnd(n: f64) -> f64 {
    let x = (n * 127.1 + 311.7).sin() * 43758.5453;
    x - x.floor()
}

// ──────────────────────────────────────────────────────────── one LFO, four LFOs

/// How a Grain bar's own travel runs, as the page draws it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Travel {
    Lin(f32, f32),
    Log(f32, f32),
    /// A square law from `min` to `max`.
    Pow(f32, f32),
}

impl Travel {
    fn unit(self, v: f32) -> f32 {
        let u = match self {
            Travel::Lin(lo, hi) => (v - lo) / (hi - lo),
            Travel::Log(lo, hi) => (v.max(lo).ln() - lo.ln()) / (hi.ln() - lo.ln()),
            Travel::Pow(lo, hi) => ((v - lo) / (hi - lo)).max(0.0).sqrt(),
        };
        u.clamp(0.0, 1.0)
    }

    fn value(self, u: f32) -> f32 {
        let u = u.clamp(0.0, 1.0);
        match self {
            Travel::Lin(lo, hi) => lo + u * (hi - lo),
            Travel::Log(lo, hi) => lo * (hi / lo).powf(u),
            Travel::Pow(lo, hi) => lo + u * u * (hi - lo),
        }
    }

    fn from_json(v: &Value) -> Option<Travel> {
        let num = |k: &str| match v.get(k) {
            Some(Value::Num(n)) if n.is_finite() => Some(*n as f32),
            _ => None,
        };
        let (lo, hi) = (num("lo")?, num("hi")?);
        if lo >= hi {
            return None;
        }
        Some(match v.get("curve").and_then(Value::as_str) {
            Some("log") if lo > 0.0 => Travel::Log(lo, hi),
            Some("pow") => Travel::Pow(lo, hi),
            _ => Travel::Lin(lo, hi),
        })
    }
}

/// One thing an LFO moves.
#[derive(Clone, Debug, PartialEq)]
pub struct Aim {
    pub target: String,
    pub travel: Option<Travel>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Lfo {
    pub shape: Shape,
    /// Cycles a second, unless `beats` says otherwise.
    pub hz: f64,
    /// Beats a cycle, at the sequencer's tempo.
    pub beats: Option<f64>,
    /// Back to the top of the cycle at every key.
    pub each_note: bool,
    /// A share of each target's travel, either side of the base.
    pub depth: f32,
    pub aims: Vec<Aim>,
    /// Running: whole cycles and how far through this one.
    phase: f64,
}

impl Default for Lfo {
    fn default() -> Self {
        Lfo { shape: Shape::Sine, hz: 1.0, beats: None, each_note: false, depth: 0.0, aims: Vec::new(), phase: 0.0 }
    }
}

impl Lfo {
    /// Cycles a second now.
    pub fn speed(&self, bpm: f64) -> f64 {
        match self.beats {
            Some(b) if b > 0.0 => bpm.max(1.0) / 60.0 / b,
            _ => self.hz,
        }
    }

    /// The running phase, in cycles.
    pub fn phase(&self) -> f64 {
        self.phase
    }

    /// Where it is now, -1..1.
    pub fn bipolar(&self) -> f32 {
        let (cycle, u) = (self.phase.floor(), self.phase - self.phase.floor());
        (self.shape.at(u, cycle) * 2.0 - 1.0) as f32
    }
}

/// Four LFOs, the tempo and the sound they belong to.
#[derive(Clone, Debug, PartialEq)]
pub struct Bank {
    pub lfos: [Lfo; COUNT],
    pub bpm: f64,
    pub rel: String,
    seen_notes: u64,
}

impl Default for Bank {
    fn default() -> Self {
        Bank { lfos: Default::default(), bpm: 120.0, rel: String::new(), seen_notes: 0 }
    }
}

impl Bank {
    /// Run the phases on by `dt` seconds. A key pressed since the last call
    /// puts an Each note LFO back at the top of its cycle.
    pub fn advance(&mut self, dt: f64, note_ons: u64) {
        let noted = note_ons != self.seen_notes;
        self.seen_notes = note_ons;
        for l in &mut self.lfos {
            if noted && l.each_note {
                l.phase = 0.0;
            } else {
                l.phase += l.speed(self.bpm) * dt.max(0.0);
            }
        }
    }

    /// Take on new settings, keeping every phase where it is: a new rate has
    /// no business moving the place.
    pub fn configure(&mut self, mut lfos: Vec<Lfo>, bpm: f64, rel: String) {
        for (old, new) in self.lfos.iter_mut().zip(lfos.drain(..)) {
            let phase = old.phase;
            *old = new;
            old.phase = phase;
        }
        self.bpm = bpm;
        self.rel = rel;
    }

    /// The same settings from the top of every cycle, for an export.
    pub fn rewound(&self) -> Bank {
        let mut b = self.clone();
        b.lfos.iter_mut().for_each(|l| l.phase = 0.0);
        b.seen_notes = 0;
        b
    }

    /// Every target anything is aimed at, once, with its travel.
    pub fn aims(&self) -> BTreeMap<&str, Option<Travel>> {
        let mut out = BTreeMap::new();
        for a in self.lfos.iter().flat_map(|l| &l.aims) {
            out.entry(a.target.as_str()).or_insert(a.travel);
        }
        out
    }

    pub fn is_aimed(&self) -> bool {
        self.lfos.iter().any(|l| !l.aims.is_empty())
    }

    /// How far a target is being pushed along its travel right now, -n..n.
    pub fn swing(&self, target: &str) -> f32 {
        self.lfos
            .iter()
            .filter(|l| l.aims.iter().any(|a| a.target == target))
            .map(|l| l.depth * l.bipolar())
            .sum()
    }
}

// ──────────────────────────────────────────────────────────── the sum

/// A control moved `swing` along its travel from `base`.
///
/// `base` back when there is no swing to apply, exactly, with no trip through
/// a unit and back to round it.
pub fn swung(range: Range, travel: Option<Travel>, base: f32, swing: f32) -> f32 {
    if swing == 0.0 {
        return base;
    }
    let v = match travel {
        Some(t) => t.value(t.unit(base) + swing),
        None => range.value(range.unit(base) + swing),
    };
    // The table is the outer limit, and is what makes a count a whole number.
    let v = range.value(range.unit(v));
    match range {
        // Exponentials land a hair past the end of their own range.
        Range::Log(lo, hi) => v.clamp(lo, hi),
        _ => v,
    }
}

/// Lanes on the document, if the sound is what is playing.
pub struct Lanes<'a> {
    pub automation: &'a Automation,
    pub frame: u64,
    pub sample_rate: u32,
}

impl Lanes<'_> {
    fn unit(&self, target: &str) -> Option<f32> {
        if self.automation.bypassed {
            return None;
        }
        let seconds = self.frame as f64 / self.sample_rate.max(1) as f64;
        self.automation.lanes.iter().filter(|l| l.target == target).find_map(|l| l.value_at(self.frame, seconds))
    }
}

/// One control this tick.
#[derive(Clone, Debug, PartialEq)]
pub struct Out {
    pub target: String,
    /// Where the document (or a lane on it) has it.
    pub base: f32,
    /// What is heard.
    pub value: f32,
}

/// `fx.<slot id>.<key>`: the slot's place now, and its key.
fn rack_place<'a>(spec: &'a RackSpec, target: &'a str) -> Option<(usize, &'a str, &'a SlotSpec)> {
    let (id, key) = target.strip_prefix("fx.")?.split_once('.')?;
    let i = spec.slot_ids.iter().position(|x| x == id)?;
    Some((i, key, spec.slots.get(i)?))
}

/// A slot's Wet and Level are the rack's, not the effect's, so `resolve` does
/// not know them.
fn rack_value(slot: &SlotSpec, key: &str, unit: f32) -> Option<f32> {
    match key {
        fx::SLOT_WET => Some(unit.clamp(0.0, 1.0)),
        fx::SLOT_LEVEL => Some(fx::SLOT_LEVEL_MIN + unit.clamp(0.0, 1.0) * (fx::SLOT_LEVEL_MAX - fx::SLOT_LEVEL_MIN)),
        _ => automation::resolve(slot, key, unit),
    }
}

/// Where the document has a rack control. A shaper or a prism effect stores
/// only what has been moved; anything else is still at its default.
fn rack_base(spec: &RackSpec, i: usize, key: &str, slot: &SlotSpec) -> Option<f32> {
    spec.get_param(i, key).or_else(|| match slot {
        SlotSpec::Shape { kind, .. } => kind.specs().iter().find(|p| p.key == key).map(|p| p.default),
        SlotSpec::Prism { id, .. } => fx::prism::specs(id)?.iter().find(|p| p.key == key).map(|p| p.default),
        _ => None,
    })
}

/// Everything the LFOs do this tick, as numbers: a pure function of the
/// settings and the document, so it can be asked whether anything is sounding
/// or not.
pub fn compute(bank: &Bank, doc: &fx::Stretch, spec: &RackSpec, lanes: Option<&Lanes>) -> Vec<Out> {
    let mut out = Vec::new();
    for (target, travel) in bank.aims() {
        let swing = bank.swing(target);
        let lane = lanes.and_then(|l| l.unit(target));
        if let Some(range) = automation::stretch_range(target) {
            let Some(base) = lane.map(|u| range.value(u)).or_else(|| automation::stretch_field(doc, target)) else {
                continue;
            };
            out.push(Out { target: target.to_string(), base, value: swung(range, travel, base, swing) });
        } else if let Some((i, key, slot)) = rack_place(spec, target) {
            let value_at = |u: f32| rack_value(slot, key, u);
            let Some(base) = lane.and_then(&value_at).or_else(|| rack_base(spec, i, key, slot)) else {
                continue;
            };
            let value = if swing == 0.0 {
                Some(base)
            } else {
                automation::unit_for(&value_at, base).and_then(|u| value_at((u + swing).clamp(0.0, 1.0)))
            };
            if let Some(value) = value {
                out.push(Out { target: target.to_string(), base, value });
            }
        }
    }
    out
}

/// Add the rack's moves to the writes the runner is about to send. An LFO on a
/// control a lane is drawing has swung that lane, so its write replaces the
/// lane's rather than following it.
pub fn merge_rack(outs: &[Out], spec: &RackSpec, writes: &mut Vec<Write>) {
    for o in outs {
        let Some((i, key, _)) = rack_place(spec, &o.target) else { continue };
        writes.retain(|(s, k, _)| *s != i || k != key);
        writes.push((i, key.to_string(), o.value));
    }
}

/// Put this tick's values into the stream parameters, and put back the base of
/// any that are no longer being moved.
pub fn apply_stream(outs: &[Out], released: &[Out], p: &mut fx::grain::StreamParams) {
    for o in released {
        automation::set_stream_field(p, &o.target, o.base);
    }
    for o in outs {
        automation::set_stream_field(p, &o.target, o.value);
    }
}

// ──────────────────────────────────────────────────────────── held by the App

#[derive(Default)]
struct Inner {
    bank: Bank,
    /// Last tick's numbers: what the page's indicators read, and what
    /// `push_params` sets aside. `driven` is only those the engine has been
    /// handed, and goes away the moment it no longer holds this sound.
    heard: Vec<Out>,
    driven: Vec<Out>,
}

/// The LFOs, shared between the HTTP threads and the automation runner.
#[derive(Default)]
pub struct GrainLfos {
    inner: Mutex<Inner>,
}

impl GrainLfos {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn sound(&self) -> String {
        self.lock().bank.rel.clone()
    }

    /// The bank, if it belongs to this sound and is moving anything.
    pub fn bank_for(&self, rel: &str) -> Option<Bank> {
        let g = self.lock();
        (g.bank.rel == rel && g.bank.is_aimed()).then(|| g.bank.clone())
    }

    /// The stream parameters with every LFO's swing taken back out, so that
    /// asking "did a setting change?" (`live::Rebuilds`) compares settings
    /// with settings, not with wherever the swing happened to be.
    pub fn unswung(&self, p: &fx::grain::StreamParams) -> fx::grain::StreamParams {
        let mut was = *p;
        for o in &self.lock().driven {
            automation::set_stream_field(&mut was, &o.target, o.base);
        }
        was
    }

    /// The swing back on top of parameters just folded in from the document,
    /// so a hand on one control does not interrupt an LFO on another.
    pub fn reapply(&self, p: &mut fx::grain::StreamParams) {
        for o in &self.lock().driven {
            automation::set_stream_field(p, &o.target, o.value);
        }
    }
}

/// The automation runner's end of it.
pub struct Runner {
    last: Instant,
}

impl Default for Runner {
    fn default() -> Self {
        Runner { last: Instant::now() }
    }
}

fn document_stretch(app: &App, rel: &str) -> fx::Stretch {
    app.edits.stretch_of(rel).unwrap_or_default()
}

impl Runner {
    /// Once a tick, whatever is or is not playing: the phases run on so the
    /// scopes do, and the page's indicators are worked out from the document.
    pub fn advance(&mut self, app: &Arc<App>) {
        let now = Instant::now();
        let dt = now.duration_since(self.last).as_secs_f64();
        self.last = now;
        let mut g = app.grain_lfos.lock();
        g.bank.advance(dt, app.grain_keys.note_ons());
    }

    /// Whether the LFOs have anything to say to what is playing now: aimed at
    /// this document, or with a value still to put back.
    pub fn holding(&self, app: &Arc<App>, now: &NowPlaying) -> bool {
        let g = app.grain_lfos.lock();
        now.document && g.bank.rel == now.rel && (g.bank.is_aimed() || !g.driven.is_empty())
    }

    /// Not holding: nothing is written, the indicators still read. Anything
    /// the engine had from us belonged to a sound it no longer holds.
    pub fn idle(&self, app: &Arc<App>) {
        {
            let mut g = app.grain_lfos.lock();
            if !g.bank.is_aimed() {
                g.heard.clear();
                g.driven.clear();
                return;
            }
        }
        let rel = app.grain_lfos.sound();
        let doc = document_stretch(app, &rel);
        let spec = if rel.is_empty() { RackSpec::empty() } else { app.racks.get(&rel) };
        let mut g = app.grain_lfos.lock();
        let heard = compute(&g.bank, &doc, &spec, None);
        g.heard = heard;
        g.driven.clear();
    }

    /// Holding: this tick's numbers for the engine, and the bases of the
    /// controls no longer being moved. The caller writes both.
    pub fn plan(&self, app: &Arc<App>, spec: &RackSpec, lanes: &Lanes) -> (Vec<Out>, Vec<Out>) {
        let rel = app.grain_lfos.sound();
        let doc = document_stretch(app, &rel);
        let mut g = app.grain_lfos.lock();
        let outs = compute(&g.bank, &doc, spec, Some(lanes));
        // A control let go is put back from the document as it is now, not as
        // it was when the LFO last moved it.
        let mut released = Vec::new();
        for o in &g.driven {
            if !outs.iter().any(|n| n.target == o.target) {
                if let Some(base) = base_now(&doc, spec, lanes, &o.target) {
                    released.push(Out { target: o.target.clone(), base, value: base });
                }
            }
        }
        g.heard = outs.clone();
        g.driven = outs.clone();
        (outs, released)
    }
}

/// A control's base with nothing on it, for putting it back.
fn base_now(doc: &fx::Stretch, spec: &RackSpec, lanes: &Lanes, target: &str) -> Option<f32> {
    let lane = lanes.unit(target);
    if let Some(range) = automation::stretch_range(target) {
        return lane.map(|u| range.value(u)).or_else(|| automation::stretch_field(doc, target));
    }
    let (i, key, slot) = rack_place(spec, target)?;
    lane.and_then(|u| rack_value(slot, key, u)).or_else(|| rack_base(spec, i, key, slot))
}

/// Put a rack control let go back where the document has it, by the route a
/// hand takes. (It has no lane or the lane's next write would have won.)
pub fn release_rack(released: &[Out], spec: &RackSpec, shared: &engine::Shared) {
    for o in released {
        if let Some((i, key, _)) = rack_place(spec, &o.target) {
            shared.set_manual_param(i, key, o.base);
        }
    }
}

// ─────────────────────────────────────────────────────────────── the route

fn body(req: &Request) -> Result<Value, Response> {
    json::parse(&String::from_utf8_lossy(&req.body))
        .filter(|v| matches!(v, Value::Obj(_)))
        .ok_or_else(|| Response::error(400, "expected a JSON object"))
}

fn num(v: Option<&Value>) -> Option<f64> {
    match v {
        Some(Value::Num(n)) if n.is_finite() => Some(*n),
        _ => None,
    }
}

fn parse_lfo(v: &Value, refused_out: &mut Vec<Value>) -> Result<Lfo, Response> {
    let shape = v.get("shape").and_then(Value::as_str).and_then(Shape::from_name);
    let Some(shape) = shape else { return Err(Response::error(400, "unknown shape")) };
    let mut aims = Vec::new();
    for t in v.get("targets").and_then(Value::arr).unwrap_or(&[]) {
        let Some(target) = t.get("t").and_then(Value::as_str) else { continue };
        if refused(target).is_some() {
            refused_out.push(target.into());
            continue;
        }
        aims.push(Aim { target: target.to_string(), travel: Travel::from_json(t) });
    }
    Ok(Lfo {
        shape,
        hz: num(v.get("hz")).unwrap_or(1.0).clamp(0.001, 500.0),
        beats: num(v.get("beats")).filter(|b| *b > 0.0).map(|b| b.clamp(0.0625, 128.0)),
        each_note: v.get("mode").and_then(Value::as_str) == Some("trig"),
        depth: num(v.get("depth")).unwrap_or(0.0).clamp(0.0, 1.0) as f32,
        aims,
        phase: 0.0,
    })
}

/// `POST /api/engine/lfos {p, bpm, lfos: [{shape, hz, beats, mode, depth,
/// targets: [{t, lo, hi, curve}]}]}`: all four, whole. `{off: true}` takes them
/// off everything. Only settings and targets; nothing about a phase.
pub fn post(app: &Arc<App>, req: &Request) -> Response {
    let v = match body(req) {
        Ok(v) => v,
        Err(r) => return r,
    };
    if matches!(v.get("off"), Some(Value::Bool(true))) {
        let mut g = app.grain_lfos.lock();
        for l in &mut g.bank.lfos {
            l.aims.clear();
        }
        return Response::json(Value::obj().set("ok", true).to_string());
    }
    let Some(rel) = v.get("p").and_then(Value::as_str) else {
        return Response::error(400, "no path given");
    };
    let Some(list) = v.get("lfos").and_then(Value::arr).filter(|a| a.len() <= COUNT) else {
        return Response::error(400, "lfos must be up to four settings");
    };
    let mut lfos = Vec::with_capacity(COUNT);
    let mut said_no = Vec::new();
    for l in list {
        match parse_lfo(l, &mut said_no) {
            Ok(l) => lfos.push(l),
            Err(r) => return r,
        }
    }
    let bpm = num(v.get("bpm")).filter(|b| *b > 0.0).unwrap_or(120.0).clamp(1.0, 999.0);
    app.grain_lfos.lock().bank.configure(lfos, bpm, rel.to_string());
    Response::json(Value::obj().set("ok", true).set("refused", Value::Arr(said_no)).to_string())
}

/// `GET /api/engine/lfos`: where each one is, what each mapped control is
/// sounding at, and what cannot be mapped and why.
pub fn get(app: &Arc<App>) -> Response {
    let g = app.grain_lfos.lock();
    let lfos: Vec<Value> = g.bank.lfos.iter().map(|l| Value::obj().set("phase", l.phase()).set("hz", l.speed(g.bank.bpm))).collect();
    let mut heard = Value::obj();
    for o in &g.heard {
        heard = heard.set(&o.target, o.value);
    }
    let mut refuse = Value::obj();
    for (t, why) in NOT_LIVE {
        refuse = refuse.set(t, *why);
    }
    Response::json(Value::obj().set("lfos", Value::Arr(lfos)).set("heard", heard).set("refuse", refuse).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automation::{curve_value, Curve, Lane, Point};
    use crate::rack::SlotSpec;

    fn aim(t: &str) -> Aim {
        Aim { target: t.to_string(), travel: None }
    }

    fn bank(l0: Lfo) -> Bank {
        let mut b = Bank { rel: "a.wav".into(), ..Bank::default() };
        b.lfos[0] = l0;
        b
    }

    /// Held at the top of a square: exactly +1 for the whole first half.
    fn held_high(depth: f32, aims: Vec<Aim>) -> Lfo {
        Lfo { shape: Shape::Square, hz: 0.001, depth, aims, ..Lfo::default() }
    }

    /// Held at the bottom of a square, past the half.
    fn held_low(depth: f32, aims: Vec<Aim>) -> Lfo {
        Lfo { phase: 0.75, ..held_high(depth, aims) }
    }

    #[test]
    fn each_shape_is_the_mock_ups_curve() {
        let at = |s: Shape, u: f64| s.at(u, 0.0);
        let near = |a: f64, b: f64| assert!((a - b).abs() < 1e-9, "{a} != {b}");
        near(at(Shape::Sine, 0.0), 0.5);
        near(at(Shape::Sine, 0.25), 1.0);
        near(at(Shape::Sine, 0.75), 0.0);
        near(at(Shape::Tri, 0.0), 0.5);
        near(at(Shape::Tri, 0.25), 1.0);
        near(at(Shape::Tri, 0.5), 0.5);
        near(at(Shape::Tri, 0.75), 0.0);
        near(at(Shape::Tri, 0.875), 0.25);
        near(at(Shape::Up, 0.25), 0.25);
        near(at(Shape::Down, 0.25), 0.75);
        near(at(Shape::Square, 0.25), 1.0);
        near(at(Shape::Square, 0.75), 0.0);
        // A step is one value for an eighth of the cycle, a fresh one after.
        let step = |u| at(Shape::Steps, u);
        assert_eq!(step(0.01), step(0.1));
        assert_ne!(step(0.1), step(0.14));
        // The next cycle deals again; the same cycle deals the same.
        assert_ne!(Shape::Steps.at(0.1, 0.0), Shape::Steps.at(0.1, 1.0));
        near(Shape::Steps.at(0.1, 3.0), Shape::Steps.at(0.1, 3.0));
        // Smooth random passes through its own control points.
        near(at(Shape::Smooth, 0.25), rnd(1.0));
        near(at(Shape::Smooth, 0.5), rnd(2.0));
        // Everything stays 0..1, which is what bipolar is built on.
        for s in [Shape::Sine, Shape::Tri, Shape::Up, Shape::Down, Shape::Square, Shape::Steps, Shape::Smooth] {
            for i in 0..2000 {
                let v = s.at(i as f64 / 997.0, (i / 40) as f64);
                assert!((0.0..=1.0).contains(&v), "{s:?} left 0..1: {v}");
            }
        }
    }

    #[test]
    fn a_rate_change_keeps_the_phase() {
        let mut b = Bank::default();
        b.lfos[0] = Lfo { hz: 2.0, aims: vec![aim("stretch.grain.scan")], ..Lfo::default() };
        b.advance(0.375, 0);
        assert!((b.lfos[0].phase() - 0.75).abs() < 1e-9);
        let was = b.lfos[0].phase();

        // A new rate through the same door the page uses.
        let new = Lfo { hz: 7.0, ..b.lfos[0].clone() };
        b.configure(vec![new], 120.0, String::new());
        assert_eq!(b.lfos[0].phase(), was, "a new rate moved the place");

        // And from there it runs at the new speed.
        b.advance(0.01, 0);
        assert!((b.lfos[0].phase() - (was + 0.07)).abs() < 1e-9);
    }

    #[test]
    fn tempo_rate_follows_the_sequencer() {
        let l = Lfo { beats: Some(4.0), ..Lfo::default() };
        assert!((l.speed(120.0) - 0.5).abs() < 1e-9);
        assert!((l.speed(60.0) - 0.25).abs() < 1e-9);
        // Hz when no beats are asked for.
        assert_eq!(Lfo { hz: 3.0, ..Lfo::default() }.speed(90.0), 3.0);
    }

    #[test]
    fn each_note_restarts_at_note_on_and_free_does_not() {
        let mut b = Bank::default();
        b.lfos[0] = Lfo { hz: 1.0, each_note: true, ..Lfo::default() };
        b.lfos[1] = Lfo { hz: 1.0, ..Lfo::default() };
        b.advance(0.3, 0);
        assert!(b.lfos[0].phase() > 0.2 && b.lfos[1].phase() > 0.2);
        b.advance(0.0, 1);
        assert_eq!(b.lfos[0].phase(), 0.0, "Each note did not go back to the top");
        assert!(b.lfos[1].phase() > 0.2, "Free went back with it");
        // No new note: it runs on.
        b.advance(0.1, 1);
        assert!((b.lfos[0].phase() - 0.1).abs() < 1e-9);
    }

    #[test]
    fn depth_scales_as_a_share_of_the_range() {
        // Scan, linear −4..4, base 0, so unit 0.5: the unit moves by the swing.
        let range = automation::stretch_range("stretch.grain.scan").unwrap();
        assert!((swung(range, None, 0.0, 0.25) - 2.0).abs() < 1e-4, "a quarter of the travel");
        assert!((swung(range, None, 0.0, -0.25) + 2.0).abs() < 1e-4);
        assert!((swung(range, None, 0.0, 0.125) - 1.0).abs() < 1e-4);

        // Four LFOs on one control add.
        let mut b = bank(held_high(0.1, vec![aim("stretch.grain.scan")]));
        b.lfos[1] = held_high(0.05, vec![aim("stretch.grain.scan")]);
        assert!((b.swing("stretch.grain.scan") - 0.15).abs() < 1e-6);
        assert_eq!(b.swing("stretch.grain.overlap"), 0.0, "something not aimed at swung");
    }

    #[test]
    fn a_swing_clamps_to_the_targets_range() {
        let range = automation::stretch_range("stretch.grain.scan").unwrap();
        assert_eq!(swung(range, None, 3.5, 0.9), 4.0);
        assert_eq!(swung(range, None, -3.5, -0.9), -4.0);

        // A log target stays in its log range, and a count is a whole number.
        let ratio = automation::stretch_range("stretch.ratio").unwrap();
        assert!(swung(ratio, None, 50.0, 0.9) <= automation::RATIO_MAX);
        let layers = automation::stretch_range("stretch.grain.layers").unwrap();
        let v = swung(layers, None, 8.0, 0.137);
        assert_eq!(v, v.round(), "a count came out as a fraction");
    }

    #[test]
    fn a_bars_own_travel_is_what_depth_is_a_share_of() {
        // Rate on the page: a square law to 500. In the table: linear to 2000.
        let range = automation::stretch_range("stretch.grain.rateHz").unwrap();
        let t = Some(Travel::Pow(0.0, 500.0));
        // Base 125 is halfway along the bar (0.25² of 500 would be a quarter
        // of the way: 0.5² × 500 = 125).
        let up = swung(range, t, 125.0, 0.25);
        assert!((up - 0.75 * 0.75 * 500.0).abs() < 1e-2, "{up}");
        // Unclamped by the bar, the table would have read 500 + … here.
        let wide = swung(range, None, 125.0, 0.25);
        assert!(wide > 500.0);
        // A bar's end clamps as the bar does.
        assert_eq!(swung(range, t, 480.0, 0.5), 500.0);
    }

    fn doc() -> fx::Stretch {
        let mut s = fx::Stretch::default();
        s.grain.scan = 1.0;
        s.grain.overlap = 3.0;
        s.ratio = 2.0;
        s
    }

    fn rack() -> RackSpec {
        let mut spec = RackSpec::empty();
        spec.slots.push(SlotSpec::Gain { db: 3.0, bypassed: false });
        spec.slot_ids.push("g".to_string());
        spec
    }

    fn silent() -> Automation {
        Automation::default()
    }

    fn lanes(a: &Automation) -> Lanes<'_> {
        Lanes { automation: a, frame: 0, sample_rate: 48_000 }
    }

    #[test]
    fn the_document_is_read_never_written_and_never_fed_back() {
        let d0 = doc();
        let d = d0;
        let b = bank(held_high(0.25, vec![aim("stretch.grain.scan")]));
        // Whatever the engine's parameters have drifted to does not come in:
        // `compute` is not given them, and there is nowhere for a swing to
        // land. Ten thousand ticks read the same.
        let a = silent();
        let outs = compute(&b, &d, &rack(), Some(&lanes(&a)));
        for _ in 0..10_000 {
            assert_eq!(compute(&b, &d, &rack(), Some(&lanes(&a))), outs);
        }
        assert_eq!(d, d0, "the document moved");
        assert_eq!(outs[0].base, d0.grain.scan);
    }

    #[test]
    fn a_hand_on_the_control_moves_the_base() {
        let b = bank(held_high(0.25, vec![aim("stretch.grain.scan")]));
        let a = silent();
        let mut d = doc();
        let v0 = compute(&b, &d, &rack(), Some(&lanes(&a)))[0].value;
        d.grain.scan = -1.0; // the hand, through the document
        let o = compute(&b, &d, &rack(), Some(&lanes(&a)));
        assert_eq!(o[0].base, -1.0);
        assert!((o[0].value - (v0 - 2.0)).abs() < 1e-4, "base moved by −2, the swing stayed: {o:?}");
    }

    #[test]
    fn off_returns_exactly_to_the_base() {
        // No trip through a unit, so a value a Log range would round lands on
        // the document's own bits.
        let mut d = doc();
        d.ratio = 3.0303;
        let mut p = fx::grain::StreamParams::new(48_000, 48_000);
        let on = compute(&bank(held_high(0.1, vec![aim("stretch.ratio"), aim("fx.g.db")])), &d, &rack(), None);
        apply_stream(&on, &[], &mut p);
        assert_ne!(p.ratio, d.ratio);

        // The page takes the LFO off; the runner is told what to put back.
        let released = vec![Out { target: "stretch.ratio".into(), base: d.ratio, value: d.ratio }];
        apply_stream(&[], &released, &mut p);
        assert_eq!(p.ratio, d.ratio, "not exactly back");

        // A swing of exactly nothing is the base as well.
        let range = automation::stretch_range("stretch.ratio").unwrap();
        assert_eq!(swung(range, None, d.ratio, 0.0), d.ratio);
    }

    #[test]
    fn a_rack_knob_moves_and_goes_home_by_the_range_of_its_effect() {
        let d = doc();
        let spec = rack();
        let b = bank(held_high(0.25, vec![aim("fx.g.db")]));
        let o = compute(&b, &d, &spec, None);
        assert_eq!(o.len(), 1);
        assert_eq!(o[0].base, 3.0);
        let u = automation::unit_for(|u| rack_value(&spec.slots[0], "db", u), 3.0).unwrap();
        let want = rack_value(&spec.slots[0], "db", u + 0.25).unwrap();
        assert!((o[0].value - want).abs() < 1e-3);

        // Into the writes, by slot, once.
        let mut w: Vec<Write> = vec![(0, "db".to_string(), -99.0)];
        merge_rack(&o, &spec, &mut w);
        assert_eq!(w.len(), 1, "a lane's write and the LFO's both went through");
        assert_eq!(w[0], (0, "db".to_string(), o[0].value));

        // A slot that no longer exists is ignored rather than moving another.
        let gone = compute(&bank(held_high(0.25, vec![aim("fx.nope.db")])), &d, &spec, None);
        assert!(gone.is_empty());
    }

    #[test]
    fn a_lane_is_the_base_when_there_is_one() {
        let a = Automation {
            lanes: vec![Lane {
                id: "l".into(),
                target: "stretch.grain.overlap".into(),
                label: "l".into(),
                enabled: true,
                trim: 0.0,
                loop_range: None,
                points: vec![Point { frame: 0, value: 0.5, curve: Curve::Linear, tension: 0.0 }],
                modulators: vec![],
            }],
            ..Automation::default()
        };
        assert_eq!(curve_value(&a.lanes[0].points, 0), Some(0.5));
        let b = bank(held_low(0.0, vec![aim("stretch.grain.overlap")]));
        let o = compute(&b, &doc(), &rack(), Some(&lanes(&a)));
        let want = automation::stretch_range("stretch.grain.overlap").unwrap().value(0.5);
        assert_eq!(o[0].base, want);
    }

    #[test]
    fn nothing_aimed_is_nothing_written() {
        assert!(compute(&Bank::default(), &doc(), &rack(), None).is_empty());
        let mut w: Vec<Write> = vec![];
        let mut p = fx::grain::StreamParams::new(1000, 48_000);
        let before = p;
        merge_rack(&[], &rack(), &mut w);
        apply_stream(&[], &[], &mut p);
        assert!(w.is_empty());
        assert_eq!(p, before);
    }

    #[test]
    fn what_cannot_move_live_is_refused_by_name() {
        for (t, why) in NOT_LIVE {
            assert_eq!(refused(t), Some(*why), "{t}");
        }
        // Hold, Spread, Resolution, Seed, by the page's names.
        for t in ["stretch.hybrid.timeSpan", "stretch.hybrid.freqSpan", "stretch.hybrid.fftSize", "stretch.grain.seed"] {
            assert!(refused(t).is_some(), "{t} should refuse");
        }
        // And what is live is not caught by accident.
        for t in ["stretch.ratio", "stretch.grain.scan", "stretch.vocoder.magBlur", "stretch.pvsola.blend", "stretch.hybrid.harmonicLevel", "fx.abc.db", "fx.abc.slot.wet"] {
            assert_eq!(refused(t), None, "{t}");
        }
        // Not a Grain control at all.
        assert!(refused("ptc.speed").is_some());
        assert!(refused("nonsense").is_some());
    }

    #[test]
    fn the_refused_list_says_something_true_about_each_name_in_the_lane_table() {
        // A refused name in the lane table is one the table offers as live and
        // the engine does not take live: true for these, checked here so that
        // a new one is looked at rather than copied in.
        let in_table: Vec<_> = NOT_LIVE.iter().map(|(t, _)| *t).filter(|t| automation::stretch_range(t).is_some()).collect();
        assert_eq!(in_table, ["stretch.hybrid.margin", "stretch.wsola.sensitivity", "stretch.wsola.floor", "stretch.wsola.guardHops"]);
    }

    #[test]
    fn a_swing_is_not_mistaken_for_a_changed_setting() {
        // Why `push_params` asks `unswung`: Layers on an LFO must not look
        // like a new layer count at the next commit.
        let lfos = GrainLfos::default();
        let mut p = fx::grain::StreamParams::new(1000, 48_000);
        p.grain.layers = 7;
        lfos.lock().driven = vec![Out { target: "stretch.grain.layers".into(), base: 3.0, value: 7.0 }];
        assert_eq!(lfos.unswung(&p).grain.layers, 3);
        assert_eq!(p.grain.layers, 7, "only a copy is set aside");
        p.grain.layers = 3;
        lfos.reapply(&mut p);
        assert_eq!(p.grain.layers, 7, "the swing comes back over the document");
    }
}
