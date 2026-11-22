//! The Grain page's four LFOs, moved from MGL's server onto the app's side
//! with the same code (`core/crates/server-core/src/grain_lfos.rs`, and the
//! parts of `automation/targets.rs` it reads: the stretch targets' ranges,
//! where each lives on the document and in the deck's settings).
//!
//! As in MGL: each LFO carries a phase and runs it on by rate × elapsed, so a
//! change of rate changes the speed and never the place; a control's base is
//! read from the document on every tick, never from the deck, so the swing
//! never feeds on itself; depth is a share of the control's whole travel,
//! either side of the base; what the engine cannot move while it plays is
//! refused. MGL ticks this every 8 ms on its automation thread; the app ticks
//! it every 8 ms on its own thread (`Session::grain_tick`).

use super::rack::{RackSpec, SlotSpec};
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub const COUNT: usize = 4;
/// MGL's automation tick (`automation::TICK_MS`).
pub const TICK_MS: u64 = 8;

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

pub fn refused(target: &str) -> Option<&'static str> {
    if let Some((_, why)) = NOT_LIVE.iter().find(|(t, _)| *t == target) {
        return Some(why);
    }
    if target.starts_with("fx.") || stretch_range(target).is_some() && target.starts_with("stretch.") {
        return None;
    }
    Some("Not something an LFO can move")
}

// ───────────────────────────────────────── the targets (automation/targets.rs)

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Range {
    Lin(f32, f32),
    Log(f32, f32),
    Int(f32, f32),
    Switch,
}

impl Range {
    pub fn value(self, u: f32) -> f32 {
        let u = u.clamp(0.0, 1.0);
        match self {
            Range::Lin(lo, hi) => lo + u * (hi - lo),
            Range::Log(lo, hi) => (lo.ln() + (hi.ln() - lo.ln()) * u).exp(),
            Range::Int(lo, hi) => (lo + u * (hi - lo)).round(),
            Range::Switch => {
                if u >= 0.5 {
                    1.0
                } else {
                    0.0
                }
            }
        }
    }

    pub fn unit(self, v: f32) -> f32 {
        let u = match self {
            Range::Lin(lo, hi) | Range::Int(lo, hi) => {
                if hi == lo {
                    0.0
                } else {
                    (v - lo) / (hi - lo)
                }
            }
            Range::Log(lo, hi) => (v.max(lo).ln() - lo.ln()) / (hi.ln() - lo.ln()),
            Range::Switch => {
                if v >= 0.5 {
                    1.0
                } else {
                    0.0
                }
            }
        };
        u.clamp(0.0, 1.0)
    }
}

const RATIO_MIN: f32 = 0.01;
const RATIO_MAX: f32 = 100.0;
const SEMITONE_MIN: f32 = -48.0;
const SEMITONE_MAX: f32 = 48.0;
const WINDOW_MS_MIN: f32 = 5.0;
const WINDOW_MS_MAX: f32 = 2000.0;
const DENSITY_MAX: f32 = 500.0;
const POS_JITTER_MAX: f32 = 500.0;
const PITCH_JITTER_MAX: f32 = 24.0;

pub const STRETCH_TARGETS: &[(&str, &str, Range)] = &[
    ("stretch.ratio", "Time & Pitch — Stretch", Range::Log(RATIO_MIN, RATIO_MAX)),
    ("stretch.semitones", "Time & Pitch — Pitch", Range::Lin(SEMITONE_MIN, SEMITONE_MAX)),
    ("stretch.windowMs", "Time & Pitch — Window", Range::Log(WINDOW_MS_MIN, WINDOW_MS_MAX)),
    ("stretch.cloudMix", "Time & Pitch — Cloud over engine", Range::Lin(0.0, 1.0)),
    ("stretch.grain.position", "Grains — Read position", Range::Lin(-1.0, 1.0)),
    ("stretch.grain.rateHz", "Grains — Rate", Range::Lin(0.0, 2000.0)),
    ("stretch.grain.densityHz", "Grains — Density", Range::Lin(0.0, DENSITY_MAX)),
    ("stretch.grain.layers", "Grains — Layers", Range::Int(1.0, mgl_fx::grain::MAX_LAYERS as f32)),
    ("stretch.grain.overlap", "Grains — Overlap", Range::Lin(1.0, 8.0)),
    ("stretch.grain.sizeJitter", "Grains — Size jitter", Range::Lin(0.0, 1.0)),
    ("stretch.grain.positionJitterMs", "Grains — Position jitter", Range::Lin(0.0, POS_JITTER_MAX)),
    ("stretch.grain.pitchJitterSemis", "Pitch movement — Pitch jitter", Range::Lin(0.0, PITCH_JITTER_MAX)),
    ("stretch.grain.pitchDriftSemis", "Pitch movement — Pitch drift", Range::Lin(0.0, 24.0)),
    ("stretch.grain.driftRateHz", "Pitch movement — Drift rate", Range::Log(0.01, 20.0)),
    ("stretch.grain.driftStep", "Pitch movement — Step the drift", Range::Switch),
    ("stretch.grain.linkJitter", "Pitch movement — Link jitter", Range::Switch),
    ("stretch.grain.scan", "Scan & shape — Scan", Range::Lin(-4.0, 4.0)),
    ("stretch.grain.reverse", "Scan & shape — Reverse grains", Range::Switch),
    ("stretch.grain.wrap", "Scan & shape — Wrap positions", Range::Switch),
    ("stretch.grain.envelope", "Scan & shape — Envelope", Range::Lin(0.0, 1.0)),
    ("stretch.grain.sizeRange", "Scan & shape — Size range", Range::Lin(1.0, 8.0)),
    ("stretch.grain.layerSpread", "Scan & shape — Layer spread", Range::Lin(0.0, 4.0)),
    ("stretch.grain.layerScatter", "Scan & shape — Layer scatter", Range::Lin(0.0, 1.0)),
    ("stretch.grain.layerScatterMs", "Scan & shape — Scatter range", Range::Lin(0.0, 5000.0)),
    ("stretch.grain.panSpread", "Scan & shape — Pan spread", Range::Lin(0.0, 1.0)),
    ("stretch.grain.fbAmount", "Feedback — Feedback", Range::Lin(0.0, 0.95)),
    ("stretch.grain.fbTimeMs", "Feedback — Time", Range::Lin(20.0, 2000.0)),
    ("stretch.grain.fbSmear", "Feedback — Smear", Range::Lin(0.0, 1.0)),
    ("stretch.grain.fbDamp", "Feedback — Damp", Range::Lin(0.0, 1.0)),
    ("stretch.grain.fbShift", "Feedback — Shift", Range::Lin(-12.0, 12.0)),
    ("stretch.grain.fbHold", "Feedback — Hold the loop", Range::Switch),
    ("stretch.wsola.sensitivity", "WSOLA — Detector", Range::Lin(0.0, 1.0)),
    ("stretch.wsola.searchMs", "WSOLA — Search", Range::Lin(0.0, 200.0)),
    ("stretch.wsola.stride", "WSOLA — Stride", Range::Int(1.0, 256.0)),
    ("stretch.wsola.guardHops", "WSOLA — Guard", Range::Lin(1.0, 16.0)),
    ("stretch.wsola.floor", "WSOLA — Floor", Range::Lin(0.0, 2.0)),
    ("stretch.vocoder.windowMs", "Vocoder — Analysis window", Range::Log(5.0, 500.0)),
    ("stretch.vocoder.phaseLock", "Vocoder — Phase lock", Range::Switch),
    ("stretch.vocoder.freqTrust", "Vocoder — Freq trust", Range::Lin(0.0, 4.0)),
    ("stretch.vocoder.phaseSpread", "Vocoder — Phase spread", Range::Lin(0.0, 4.0)),
    ("stretch.vocoder.peakWidth", "Vocoder — Peak width", Range::Int(1.0, 32.0)),
    ("stretch.vocoder.lockWidth", "Vocoder — Lock width", Range::Lin(0.0, 4.0)),
    ("stretch.vocoder.magFreeze", "Vocoder — Freeze", Range::Lin(0.0, 1.0)),
    ("stretch.vocoder.magBlur", "Vocoder — Blur", Range::Lin(0.0, 1.0)),
    ("stretch.vocoder.magGate", "Vocoder — Gate", Range::Lin(0.0, 1.0)),
    ("stretch.vocoder.stereoLink", "Vocoder — Link stereo", Range::Switch),
    ("stretch.pvsola.anchorFrames", "PVSOLA — Re-anchor", Range::Int(1.0, 64.0)),
    ("stretch.pvsola.searchMs", "PVSOLA — Search", Range::Lin(0.0, 200.0)),
    ("stretch.pvsola.blend", "PVSOLA — Blend", Range::Lin(0.0, 1.0)),
    ("stretch.hybrid.margin", "Hybrid — Margin", Range::Lin(1.0, 8.0)),
    ("stretch.hybrid.morphNoise", "Hybrid — Remake noise", Range::Switch),
    ("stretch.hybrid.harmonicLevel", "Hybrid — Tone", Range::Lin(0.0, 4.0)),
    ("stretch.hybrid.percussiveLevel", "Hybrid — Hits", Range::Lin(0.0, 4.0)),
    ("stretch.hybrid.residualLevel", "Hybrid — Air", Range::Lin(0.0, 4.0)),
    ("ptc.speed", "Pitch Time Changer — Speed", Range::Lin(1.0, 200.0)),
    ("ptc.pitch", "Pitch Time Changer — Pitch", Range::Lin(0.0, 200.0)),
    ("ptc.feedback", "Pitch Time Changer — Feedback", Range::Lin(0.0, 100.0)),
    ("ptc.grain", "Pitch Time Changer — Grain size", Range::Lin(1.0, 100.0)),
    ("ptc.xfade", "Pitch Time Changer — X-fade size", Range::Lin(0.0, 100.0)),
    ("ptc.smoothing", "Pitch Time Changer — Smoothing", Range::Lin(0.0, 100.0)),
];

pub fn stretch_range(target: &str) -> Option<Range> {
    STRETCH_TARGETS.iter().find(|(t, _, _)| *t == target).map(|(_, _, r)| *r)
}

pub fn stretch_field(s: &mgl_fx::Stretch, target: &str) -> Option<f32> {
    let b = |on: bool| if on { 1.0 } else { 0.0 };
    let g = &s.grain;
    Some(match target {
        "stretch.ratio" => s.ratio,
        "stretch.semitones" => s.semitones,
        "stretch.windowMs" => s.window_ms,
        "stretch.cloudMix" => s.cloud_mix,
        "stretch.grain.position" => g.position,
        "stretch.grain.rateHz" => g.rate_hz,
        "stretch.grain.densityHz" => g.density_hz,
        "stretch.grain.layers" => g.layers as f32,
        "stretch.grain.overlap" => g.overlap,
        "stretch.grain.sizeJitter" => g.size_jitter,
        "stretch.grain.positionJitterMs" => g.position_jitter_ms,
        "stretch.grain.pitchJitterSemis" => g.pitch_jitter_semis,
        "stretch.grain.pitchDriftSemis" => g.pitch_drift_semis,
        "stretch.grain.driftRateHz" => g.drift_rate_hz,
        "stretch.grain.driftStep" => b(g.drift_step),
        "stretch.grain.linkJitter" => b(g.link_jitter),
        "stretch.grain.scan" => g.scan,
        "stretch.grain.reverse" => b(g.reverse),
        "stretch.grain.wrap" => b(g.wrap),
        "stretch.grain.envelope" => g.envelope,
        "stretch.grain.sizeRange" => g.size_range,
        "stretch.grain.layerSpread" => g.layer_spread,
        "stretch.grain.layerScatter" => g.layer_scatter,
        "stretch.grain.layerScatterMs" => g.layer_scatter_ms,
        "stretch.grain.panSpread" => g.pan_spread,
        "stretch.grain.fbAmount" => g.fb_amount,
        "stretch.grain.fbTimeMs" => g.fb_time_ms,
        "stretch.grain.fbSmear" => g.fb_smear,
        "stretch.grain.fbDamp" => g.fb_damp,
        "stretch.grain.fbShift" => g.fb_shift,
        "stretch.grain.fbHold" => b(g.fb_hold),
        "stretch.wsola.sensitivity" => s.wsola.sensitivity,
        "stretch.wsola.searchMs" => s.wsola.search_ms,
        "stretch.wsola.stride" => s.wsola.stride as f32,
        "stretch.wsola.guardHops" => s.wsola.guard_hops,
        "stretch.wsola.floor" => s.wsola.floor,
        "stretch.vocoder.windowMs" => s.vocoder.window_ms,
        "stretch.vocoder.phaseLock" => b(s.vocoder.phase_lock),
        "stretch.vocoder.freqTrust" => s.vocoder.freq_trust,
        "stretch.vocoder.phaseSpread" => s.vocoder.phase_spread,
        "stretch.vocoder.peakWidth" => s.vocoder.peak_width as f32,
        "stretch.vocoder.lockWidth" => s.vocoder.lock_width,
        "stretch.vocoder.magFreeze" => s.vocoder.mag_freeze,
        "stretch.vocoder.magBlur" => s.vocoder.mag_blur,
        "stretch.vocoder.magGate" => s.vocoder.mag_gate,
        "stretch.vocoder.stereoLink" => b(s.vocoder.stereo_link),
        "stretch.pvsola.anchorFrames" => s.pvsola.anchor_frames as f32,
        "stretch.pvsola.searchMs" => s.pvsola.search_ms,
        "stretch.pvsola.blend" => s.pvsola.blend,
        "stretch.hybrid.margin" => s.hybrid.margin,
        "stretch.hybrid.morphNoise" => b(s.hybrid.morph_noise),
        "stretch.hybrid.harmonicLevel" => s.hybrid.harmonic_level,
        "stretch.hybrid.percussiveLevel" => s.hybrid.percussive_level,
        "stretch.hybrid.residualLevel" => s.hybrid.residual_level,
        _ => return None,
    })
}

pub fn set_stream_field(p: &mut mgl_fx::grain::StreamParams, target: &str, v: f32) -> bool {
    let on = v >= 0.5;
    let n = v.round().max(0.0) as u32;
    let g = &mut p.grain;
    match target {
        "stretch.ratio" => p.ratio = v,
        "stretch.semitones" => p.semitones = v,
        "stretch.windowMs" => p.window_ms = v,
        "stretch.cloudMix" => p.cloud_mix = v,
        "stretch.grain.position" => g.position = v,
        "stretch.grain.rateHz" => g.rate_hz = v,
        "stretch.grain.densityHz" => g.density_hz = v,
        "stretch.grain.layers" => g.layers = n,
        "stretch.grain.overlap" => g.overlap = v,
        "stretch.grain.sizeJitter" => g.size_jitter = v,
        "stretch.grain.positionJitterMs" => g.position_jitter_ms = v,
        "stretch.grain.pitchJitterSemis" => g.pitch_jitter_semis = v,
        "stretch.grain.pitchDriftSemis" => g.pitch_drift_semis = v,
        "stretch.grain.driftRateHz" => g.drift_rate_hz = v,
        "stretch.grain.driftStep" => g.drift_step = on,
        "stretch.grain.linkJitter" => g.link_jitter = on,
        "stretch.grain.scan" => g.scan = v,
        "stretch.grain.reverse" => g.reverse = on,
        "stretch.grain.wrap" => g.wrap = on,
        "stretch.grain.envelope" => g.envelope = v,
        "stretch.grain.sizeRange" => g.size_range = v,
        "stretch.grain.layerSpread" => g.layer_spread = v,
        "stretch.grain.layerScatter" => g.layer_scatter = v,
        "stretch.grain.layerScatterMs" => g.layer_scatter_ms = v,
        "stretch.grain.panSpread" => g.pan_spread = v,
        "stretch.grain.fbAmount" => g.fb_amount = v,
        "stretch.grain.fbTimeMs" => g.fb_time_ms = v,
        "stretch.grain.fbSmear" => g.fb_smear = v,
        "stretch.grain.fbDamp" => g.fb_damp = v,
        "stretch.grain.fbShift" => g.fb_shift = v,
        "stretch.grain.fbHold" => g.fb_hold = on,
        "stretch.wsola.sensitivity" => p.wsola.sensitivity = v,
        "stretch.wsola.searchMs" => p.wsola.search_ms = v,
        "stretch.wsola.stride" => p.wsola.stride = n,
        "stretch.wsola.guardHops" => p.wsola.guard_hops = v,
        "stretch.wsola.floor" => p.wsola.floor = v,
        "stretch.vocoder.windowMs" => p.vocoder.window_ms = v,
        "stretch.vocoder.phaseLock" => p.vocoder.phase_lock = on,
        "stretch.vocoder.freqTrust" => p.vocoder.freq_trust = v,
        "stretch.vocoder.phaseSpread" => p.vocoder.phase_spread = v,
        "stretch.vocoder.peakWidth" => p.vocoder.peak_width = n,
        "stretch.vocoder.lockWidth" => p.vocoder.lock_width = v,
        "stretch.vocoder.magFreeze" => p.vocoder.mag_freeze = v,
        "stretch.vocoder.magBlur" => p.vocoder.mag_blur = v,
        "stretch.vocoder.magGate" => p.vocoder.mag_gate = v,
        "stretch.vocoder.stereoLink" => p.vocoder.stereo_link = on,
        "stretch.pvsola.anchorFrames" => p.pvsola.anchor_frames = n,
        "stretch.pvsola.searchMs" => p.pvsola.search_ms = v,
        "stretch.pvsola.blend" => p.pvsola.blend = v,
        "stretch.hybrid.margin" => p.hybrid.margin = v,
        "stretch.hybrid.morphNoise" => p.hybrid.morph_noise = on,
        "stretch.hybrid.harmonicLevel" => p.hybrid.harmonic_level = v,
        "stretch.hybrid.percussiveLevel" => p.hybrid.percussive_level = v,
        "stretch.hybrid.residualLevel" => p.hybrid.residual_level = v,
        _ => return false,
    }
    true
}

pub fn unit_for(forward: impl Fn(f32) -> Option<f32>, value: f32) -> Option<f32> {
    let (mut lo, mut hi) = (0.0f32, 1.0f32);
    let at_lo = forward(lo)?;
    let at_hi = forward(hi)?;
    let rising = at_hi >= at_lo;
    for _ in 0..40 {
        let mid = 0.5 * (lo + hi);
        let here = forward(mid)?;
        if (here < value) == rising {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let miss = |u: f32| forward(u).map_or(f32::INFINITY, |v| (v - value).abs());
    let best = [0.5 * (lo + hi), hi, lo].into_iter().fold((f32::INFINITY, 0.5 * (lo + hi)), |(m, b), u| if miss(u) < m { (miss(u), u) } else { (m, b) }).1;
    Some(best.clamp(0.0, 1.0))
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

    pub fn name(self) -> &'static str {
        match self {
            Shape::Sine => "sine",
            Shape::Tri => "tri",
            Shape::Up => "up",
            Shape::Down => "down",
            Shape::Square => "square",
            Shape::Steps => "steps",
            Shape::Smooth => "smooth",
        }
    }

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

fn rnd(n: f64) -> f64 {
    let x = (n * 127.1 + 311.7).sin() * 43758.5453;
    x - x.floor()
}

// ──────────────────────────────────────────────────────────── one LFO, four LFOs

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Travel {
    Lin(f32, f32),
    Log(f32, f32),
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
        let num = |k: &str| v.get(k).and_then(Value::as_f64).filter(|n| n.is_finite()).map(|n| n as f32);
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

    fn to_json(self, t: &str) -> Value {
        let (lo, hi, curve) = match self {
            Travel::Lin(a, b) => (a, b, "lin"),
            Travel::Log(a, b) => (a, b, "log"),
            Travel::Pow(a, b) => (a, b, "pow"),
        };
        json!({ "t": t, "lo": lo as f64, "hi": hi as f64, "curve": curve })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Aim {
    pub target: String,
    pub travel: Option<Travel>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Lfo {
    pub shape: Shape,
    pub hz: f64,
    pub beats: Option<f64>,
    pub each_note: bool,
    pub depth: f32,
    pub aims: Vec<Aim>,
    phase: f64,
}

impl Default for Lfo {
    fn default() -> Self {
        Lfo { shape: Shape::Sine, hz: 1.0, beats: None, each_note: false, depth: 0.0, aims: Vec::new(), phase: 0.0 }
    }
}

impl Lfo {
    pub fn speed(&self, bpm: f64) -> f64 {
        match self.beats {
            Some(b) if b > 0.0 => bpm.max(1.0) / 60.0 / b,
            _ => self.hz,
        }
    }

    pub fn phase(&self) -> f64 {
        self.phase
    }

    pub fn bipolar(&self) -> f32 {
        let (cycle, u) = (self.phase.floor(), self.phase - self.phase.floor());
        (self.shape.at(u, cycle) * 2.0 - 1.0) as f32
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Bank {
    pub lfos: [Lfo; COUNT],
    pub bpm: f64,
    seen_notes: u64,
}

impl Default for Bank {
    fn default() -> Self {
        Bank { lfos: Default::default(), bpm: 120.0, seen_notes: 0 }
    }
}

impl Bank {
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

    pub fn configure(&mut self, mut lfos: Vec<Lfo>, bpm: f64) {
        for (old, new) in self.lfos.iter_mut().zip(lfos.drain(..)) {
            let phase = old.phase;
            *old = new;
            old.phase = phase;
        }
        self.bpm = bpm;
    }

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

    pub fn swing(&self, target: &str) -> f32 {
        self.lfos.iter().filter(|l| l.aims.iter().any(|a| a.target == target)).map(|l| l.depth * l.bipolar()).sum()
    }

    pub fn off(&mut self) {
        for l in &mut self.lfos {
            l.aims.clear();
        }
    }
}

pub fn swung(range: Range, travel: Option<Travel>, base: f32, swing: f32) -> f32 {
    if swing == 0.0 {
        return base;
    }
    let v = match travel {
        Some(t) => t.value(t.unit(base) + swing),
        None => range.value(range.unit(base) + swing),
    };
    let v = range.value(range.unit(v));
    match range {
        Range::Log(lo, hi) => v.clamp(lo, hi),
        _ => v,
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Out {
    pub target: String,
    pub base: f32,
    pub value: f32,
}

fn rack_place<'a>(spec: &'a RackSpec, target: &'a str) -> Option<(usize, &'a str, &'a SlotSpec)> {
    let (id, key) = target.strip_prefix("fx.")?.split_once('.')?;
    let i = spec.slot_ids.iter().position(|x| x == id)?;
    Some((i, key, spec.slots.get(i)?))
}

fn rack_value(slot: &SlotSpec, key: &str, unit: f32) -> Option<f32> {
    match key {
        mgl_fx::SLOT_WET => Some(unit.clamp(0.0, 1.0)),
        mgl_fx::SLOT_LEVEL => Some(mgl_fx::SLOT_LEVEL_MIN + unit.clamp(0.0, 1.0) * (mgl_fx::SLOT_LEVEL_MAX - mgl_fx::SLOT_LEVEL_MIN)),
        _ => super::rack::resolve(slot, key, unit),
    }
}

fn rack_base(spec: &RackSpec, i: usize, key: &str, slot: &SlotSpec) -> Option<f32> {
    spec.get_param(i, key).or_else(|| match slot {
        SlotSpec::Shape { kind, .. } => kind.specs().iter().find(|p| p.key == key).map(|p| p.default),
        SlotSpec::Prism { id, .. } => mgl_fx::prism::specs(id)?.iter().find(|p| p.key == key).map(|p| p.default),
        _ => None,
    })
}

/// `grain_lfos::compute`, with no lanes (the Grain module has no automation
/// lanes yet).
pub fn compute(bank: &Bank, doc: &mgl_fx::Stretch, spec: &RackSpec) -> Vec<Out> {
    let mut out = Vec::new();
    for (target, travel) in bank.aims() {
        let swing = bank.swing(target);
        if let Some(range) = stretch_range(target) {
            let Some(base) = stretch_field(doc, target) else { continue };
            out.push(Out { target: target.to_string(), base, value: swung(range, travel, base, swing) });
        } else if let Some((i, key, slot)) = rack_place(spec, target) {
            let value_at = |u: f32| rack_value(slot, key, u);
            let Some(base) = rack_base(spec, i, key, slot) else { continue };
            let value = if swing == 0.0 { Some(base) } else { unit_for(&value_at, base).and_then(|u| value_at((u + swing).clamp(0.0, 1.0))) };
            if let Some(value) = value {
                out.push(Out { target: target.to_string(), base, value });
            }
        }
    }
    out
}

/// `grain_lfos::merge_rack`: the rack's moves, as the runner writes them.
pub fn rack_writes(outs: &[Out], spec: &RackSpec) -> Vec<(usize, String, f32)> {
    let mut writes: Vec<(usize, String, f32)> = Vec::new();
    for o in outs {
        let Some((i, key, _)) = rack_place(spec, &o.target) else { continue };
        writes.retain(|(s, k, _)| *s != i || k != key);
        writes.push((i, key.to_string(), o.value));
    }
    writes
}

pub fn apply_stream(outs: &[Out], released: &[Out], p: &mut mgl_fx::grain::StreamParams) {
    for o in released {
        set_stream_field(p, &o.target, o.base);
    }
    for o in outs {
        set_stream_field(p, &o.target, o.value);
    }
}

/// A rack control let go, by its slot and key.
pub fn rack_slot<'a>(spec: &'a RackSpec, target: &'a str) -> Option<(usize, &'a str)> {
    rack_place(spec, target).map(|(i, k, _)| (i, k))
}

/// A control's base with nothing on it, for putting it back.
pub fn base_now(doc: &mgl_fx::Stretch, spec: &RackSpec, target: &str) -> Option<f32> {
    if stretch_range(target).is_some() {
        return stretch_field(doc, target);
    }
    let (i, key, slot) = rack_place(spec, target)?;
    rack_base(spec, i, key, slot)
}

// ─────────────────────────────────────────────── the page's payload (the route)

fn parse_lfo(v: &Value, refused_out: &mut Vec<Value>) -> Result<Lfo, String> {
    let shape = v.get("shape").and_then(Value::as_str).and_then(Shape::from_name).ok_or("unknown shape")?;
    let mut aims = Vec::new();
    for t in v.get("targets").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]) {
        let Some(target) = t.get("t").and_then(Value::as_str) else { continue };
        if refused(target).is_some() {
            refused_out.push(target.into());
            continue;
        }
        aims.push(Aim { target: target.to_string(), travel: Travel::from_json(t) });
    }
    let num = |k: &str| v.get(k).and_then(Value::as_f64).filter(|n| n.is_finite());
    Ok(Lfo {
        shape,
        hz: num("hz").unwrap_or(1.0).clamp(0.001, 500.0),
        beats: num("beats").filter(|b| *b > 0.0).map(|b| b.clamp(0.0625, 128.0)),
        each_note: v.get("mode").and_then(Value::as_str) == Some("trig"),
        depth: num("depth").unwrap_or(0.0).clamp(0.0, 1.0) as f32,
        aims,
        phase: 0.0,
    })
}

/// `POST /api/engine/lfos {bpm, lfos: [...]}` (or `{off: true}`): the four
/// LFOs' settings and targets, whole. MGL's answer.
pub fn post(bank: &mut Bank, v: &Value) -> Result<Value, String> {
    if matches!(v.get("off"), Some(Value::Bool(true))) {
        bank.off();
        return Ok(json!({ "ok": true }));
    }
    let list = v.get("lfos").and_then(Value::as_array).filter(|a| a.len() <= COUNT).ok_or("lfos must be up to four settings")?;
    let mut lfos = Vec::with_capacity(COUNT);
    let mut said_no = Vec::new();
    for l in list {
        lfos.push(parse_lfo(l, &mut said_no)?);
    }
    let bpm = v.get("bpm").and_then(Value::as_f64).filter(|b| b.is_finite() && *b > 0.0).unwrap_or(120.0).clamp(1.0, 999.0);
    bank.configure(lfos, bpm);
    Ok(json!({ "ok": true, "refused": said_no }))
}

/// `GET /api/engine/lfos`: each one's phase and speed, what each mapped
/// control is sounding at, and what cannot be mapped and why.
pub fn get(bank: &Bank, heard: &[Out]) -> Value {
    let lfos: Vec<Value> = bank.lfos.iter().map(|l| json!({ "phase": l.phase(), "hz": l.speed(bank.bpm) })).collect();
    let heard: serde_json::Map<String, Value> = heard.iter().map(|o| (o.target.clone(), json!(o.value as f64))).collect();
    let refuse: serde_json::Map<String, Value> = NOT_LIVE.iter().map(|(t, why)| (t.to_string(), json!(why))).collect();
    json!({ "lfos": lfos, "heard": heard, "refuse": refuse })
}

/// The bank's settings for the patch (its phases are not kept).
pub fn bank_json(bank: &Bank) -> Value {
    let lfos: Vec<Value> = bank
        .lfos
        .iter()
        .map(|l| {
            json!({
                "shape": l.shape.name(), "hz": l.hz, "beats": l.beats, "mode": if l.each_note { "trig" } else { "free" },
                "depth": l.depth as f64,
                "targets": l.aims.iter().map(|a| a.travel.map(|t| t.to_json(&a.target)).unwrap_or_else(|| json!({ "t": a.target }))).collect::<Vec<_>>(),
            })
        })
        .collect();
    json!({ "bpm": bank.bpm, "lfos": lfos })
}
