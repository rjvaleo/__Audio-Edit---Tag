//! The Prism module: MGL's Prism page (HyperStretch and the rack pad merged),
//! playing a deck of its own, as MGL's Prism deck does (`engine/src/decks.rs`:
//! a second transport with its own sound, stretch, Pitch Time Changer, glide,
//! faders and chain).
//!
//! The deck is MGL's own `Core` (`engine_mgl::Grain`, whose keys are never
//! touched, as MGL's Prism deck's are not). This is MGL's server's side of
//! the page, ported route for route and kept off the audio thread:
//! `/api/prism/load` (`live::load_prism`), `/api/prism/stretch`,
//! `/api/prism/state`, `/api/engine/pad`, `/api/engine/glide`,
//! `/api/engine/transport` with `deck: "prism"`, `/api/rack` and
//! `/api/rack/param` on the Prism document, `/api/pitchtime`, `/api/pad`,
//! `/api/pad/presets` and `/api/fx`. And the page's own side, ported from its
//! JavaScript (`ui/app/385-388b`, `ui/prism-pad.js`) so the face only draws:
//! what the pad and its takes do (`takes.rs`), the four LFOs (`lfos.rs`),
//! the Process menu, the controls, the faders, the presets.
//!
//! **Its sound** is the one cabled into its Sound socket (the Sound module's
//! document, edits and all: on the canvas the Sound module is the file). With
//! nothing cabled it plays MGL's start sound, as MGL's page falls back on the
//! file that is open, which is that sound at first.

mod link;
pub mod jsmath;
pub mod lfos;
pub mod presets;
pub mod sources;
pub mod takes;

use crate::grain::rack::{self as grack, RackSpec, PAD_PITCH_TIME, PAD_STRETCH};
use crate::grain::{merge_stretch, start_sound_wav, stretch as gstretch, GRID, MAX_BLOCK};
use crate::sound_part::SoundPart;
use engine_mgl::grain::{Grain, Handle};
use lfos::{Lfos, Target};
use mgl_engine::stretcher::LayerBank;
use mgl_engine::Source;
use mgl_fx::grain::StreamParams;
use serde_json::{json, Map, Value};
use sources::{PadControl, PadSetup, PadSource};
use std::collections::BTreeMap;
use std::sync::{Arc, OnceLock};
use takes::{clamp01, coef, Asks, Axis, Lim, Pad};

/// The page at the size RJ uses it (a 1668 x 1100 window, the rail 168 wide):
/// the page 1500 x 1052 and the Now Playing bar, Prism's transport, under it.
pub const PRISM_W: u32 = 1500;
pub const PRISM_H: u32 = 1100;

/// `PRISM_ENGINES`: the engines the pad can play through.
pub const ENGINES: [(&str, &str); 5] = [("granular", "Granular"), ("wsola", "WSOLA"), ("vocoder", "Vocoder"), ("pvsola", "PVSOLA"), ("hybrid", "Hybrid")];

/// `PTC_DEFAULTS`.
const PTC_DEFAULTS: [(&str, f64); 6] = [("speed", 100.0), ("pitch", 100.0), ("feedback", 0.0), ("grain", 15.0), ("xfade", 100.0), ("smoothing", 50.0)];
/// `PRISM_STRETCH_DEFAULTS`.
const STRETCH_DEFAULTS: [(&str, f64); 4] = [("ratio", 1.0), ("semitones", 0.0), ("windowMs", 46.0), ("cloudMix", 0.5)];
/// The two the engine glides, sent straight to it (`HS_FAST`).
const FAST: [&str; 2] = ["ratio", "semitones"];

/// `live::idle_params` (MGL's server), at the deck's rate.
pub fn idle_params(rate: u32) -> StreamParams {
    StreamParams {
        in_frames: 0,
        sample_rate: rate,
        ratio: 1.0,
        semitones: 0.0,
        window_ms: 40.0,
        grain: mgl_fx::Grain::default(),
        algorithm: mgl_fx::stretch::Algorithm::Granular,
        cloud: false,
        cloud_mix: 0.5,
        wsola: mgl_fx::stretch::WsolaParams::default(),
        vocoder: mgl_fx::stretch::VocoderParams::default(),
        pvsola: mgl_fx::pvsola::PvsolaParams::default(),
        hybrid: mgl_fx::hybrid::HybridParams::default(),
        soundhack: Default::default(),
    }
}

/// The page's deck stretch at rest (`prismDeck.stretch`).
pub fn page_stretch() -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("ratio".into(), json!(1));
    m.insert("semitones".into(), json!(0));
    m.insert("windowMs".into(), json!(46));
    m.insert("cloudMix".into(), json!(0.5));
    m.insert("algorithm".into(), json!("granular"));
    m
}

/// `/api/fx`, made once.
pub fn fx() -> &'static Value {
    static FX: OnceLock<Value> = OnceLock::new();
    FX.get_or_init(sources::fx_json)
}

/// A shaper's entry in `/api/fx` by its kind (`state.shapers[kind]`).
pub fn shaper(kind: &str) -> Option<&'static Value> {
    fx()["shapers"].as_array()?.iter().find(|s| s["kind"] == kind)
}

/// `prismFaderDb`: Hyperprism's fader law, ±18 dB across 0–255.
pub fn fader_db(v: f64) -> f64 {
    (36.0 * v) / 255.0 - 18.0
}

fn bad(why: impl Into<String>) -> String {
    why.into()
}

pub struct PrismPart {
    pub handle: Handle,
    rate: u32,
    /// Its own sound, when no Sound module is cabled in.
    pub own: SoundPart,
    /// The Prism document's rack (MGL's `prism:<path>` document).
    pub rack: RackSpec,
    /// `prismDeck.stretch`: what the page posts to `/api/prism/stretch`.
    pub stretch: Map<String, Value>,
    /// `prismHp`: Playback Speed and the three faders, 0–255.
    pub hp: [f64; 4],
    /// Prism loops unless told not to (`prismLoopWanted`).
    pub looping: bool,
    /// `prismPad.source`: the process on the pad.
    pub source: String,
    pub pad: Pad,
    /// The takes, per sound and process (`hsKey`).
    pub takes: BTreeMap<String, Value>,
    pub lfos: Lfos,
    /// The face's own (the SOURCE height, menus ...), kept for the patch.
    pub ui: Value,
    /// The preset loaded (`prismPresetAt`).
    pub preset_at: String,
    pub places: presets::Places,
    fed: Option<(u32, u64)>,
    src: Option<Arc<Source>>,
    /// What the sound is called (its file's name or path), for the takes'
    /// key and the face.
    pub sound_name: String,
    pub sound_path: String,
    /// The file it was read from, for its facts (format, bits).
    pub sound_file: String,
    /// The deck's sound's frames (at the deck's rate).
    pub frames: u64,
    /// The face's clock at the last tick, ms.
    last_tick: f64,
}

impl PrismPart {
    pub fn new(rate: f32, saved: Option<&Value>) -> (PrismPart, Grain) {
        let rate_u = rate as u32;
        let deck = Grain::new(rate_u, GRID, idle_params(rate_u), Arc::new(Source { samples: Vec::new(), channels: 2 }));
        let mut own = SoundPart::empty();
        let _ = own.open(Arc::from(start_sound_wav().into_boxed_slice()), json!({ "kind": "start", "name": "Pulse 25%", "path": ".mgl/Pulse 25%.wav" }), rate_u);
        let mut part = PrismPart {
            handle: deck.handle(),
            rate: rate_u,
            own,
            rack: RackSpec::default_chain(),
            stretch: page_stretch(),
            hp: [128.0; 4],
            looping: true,
            source: PAD_STRETCH.into(),
            pad: Pad::default(),
            takes: BTreeMap::new(),
            lfos: Lfos::default(),
            ui: Value::Null,
            preset_at: String::new(),
            places: presets::Places::default(),
            fed: None,
            src: None,
            sound_name: String::new(),
            sound_path: String::new(),
            sound_file: String::new(),
            frames: 0,
            last_tick: 0.0,
        };
        if let Some(s) = saved {
            part.restore(s);
        }
        (part, deck)
    }

    /// The patch's record of it.
    pub fn state(&self) -> Value {
        json!({
            "own": self.own.state(),
            "rack": self.rack.to_json(),
            "stretch": Value::Object(self.stretch.clone()),
            "hp": { "speed": self.hp[0], "l": self.hp[1], "lr": self.hp[2], "r": self.hp[3] },
            "loop": self.looping,
            "source": self.source,
            "settings": self.pad.settings_json(),
            "takes": Value::Object(self.takes.iter().map(|(k, v)| (k.clone(), v.clone())).collect()),
            "lfos": self.lfos.to_json(),
            "ui": self.ui,
        })
    }

    fn restore(&mut self, s: &Value) {
        if let Some(ops) = s.get("own").and_then(|o| o.get("ops")).and_then(Value::as_array) {
            self.own.replay(ops);
        }
        if let Some(r) = s.get("rack") {
            self.rack = RackSpec::from_json(r);
            sources::check_pads(&mut self.rack);
        }
        if let Some(Value::Object(m)) = s.get("stretch") {
            self.stretch = page_stretch();
            for (k, v) in m {
                self.stretch.insert(k.clone(), v.clone());
            }
        }
        if let Some(h) = s.get("hp") {
            for (i, k) in ["speed", "l", "lr", "r"].iter().enumerate() {
                if let Some(n) = h.get(*k).and_then(Value::as_f64) {
                    self.hp[i] = n;
                }
            }
        }
        if let Some(b) = s.get("loop").and_then(Value::as_bool) {
            self.looping = b;
        }
        if let Some(src) = s.get("source").and_then(Value::as_str) {
            self.source = src.to_string();
        }
        if let Some(st) = s.get("settings") {
            self.pad.settings_from(st);
        }
        if let Some(Value::Object(m)) = s.get("takes") {
            self.takes = m.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        }
        self.lfos.load(s.get("lfos"));
        self.ui = s.get("ui").cloned().unwrap_or(Value::Null);
    }

    pub fn rate(&self) -> u32 {
        self.rate
    }

    pub fn fed(&self) -> Option<(u32, u64)> {
        self.fed
    }

    pub fn source_sound(&self) -> Option<&Arc<Source>> {
        self.src.as_ref()
    }

    fn sh(&self) -> Arc<mgl_engine::Shared> {
        Arc::clone(self.handle.shared())
    }

    // ──────────────────────────────────────────── `/api/prism/load`

    /// A sound into the deck: MGL's `live::load_prism`, then what the page
    /// does after it (`prismDeckUse`): the loop as Prism keeps it, its
    /// stretch, its speed and faders, the pad's glide, and `hsOpen`.
    pub fn load(&mut self, from: u32, serial: u64, source: Arc<Source>, name: &str, path: &str) -> Value {
        let sh = self.sh();
        let frames = source.frames();
        sh.pause();
        sh.set_source(Arc::clone(&source));
        sh.set_params(StreamParams { in_frames: frames, ..idle_params(self.rate) });
        sh.set_map(None);
        sh.set_parts(Arc::new(mgl_fx::hstream::Parts::default()));
        sh.request_seek(0);
        sh.set_loop(false, 0, 0);
        sh.reset_governor();
        sh.reset_load();
        let rack = self.rack.build(self.rate, 2);
        sh.set_rack(if rack.is_empty() { None } else { Some(rack) });
        sh.set_pitch_time(self.rack.pitch_time);
        sh.set_post_roll_frames((self.rack.post_roll_ms() as f64 * 0.001 * self.rate as f64) as u64);
        sh.set_bank(LayerBank::build(mgl_fx::stretch::Algorithm::Granular, mgl_fx::Grain::default().layers, MAX_BLOCK, 2, self.rate));
        self.fed = Some((from, serial));
        self.src = Some(source);
        self.frames = frames as u64;
        // The takes are the sound's: the ones for the sound going out are kept.
        if !self.sound_path.is_empty() || !self.sound_name.is_empty() {
            self.save_takes();
        }
        self.pad.interrupt(0.0);
        self.sound_name = name.to_string();
        self.sound_path = path.to_string();
        // `prismDeckUse`: the loop, the stretch, the faders; then `hsOpen`.
        let looping = self.looping;
        self.transport(&json!({ "loop": { "on": looping, "a": 0, "b": 0 } }));
        if !ENGINES.iter().any(|(k, _)| self.stretch.get("algorithm").and_then(Value::as_str) == Some(*k)) {
            self.stretch.insert("algorithm".into(), "granular".into());
        }
        self.post_stretch_page();
        self.send_hp();
        self.pad.sent = None;
        self.send_glide();
        self.open();
        json!({ "path": path, "frames": frames as f64, "sampleRate": self.rate as f64 })
    }

    /// `hsOpen`: the source still there (or Time & Pitch), its takes.
    fn open(&mut self) {
        let srcs = sources::sources(&self.rack);
        if !srcs.iter().any(|s| s.id == self.source) {
            self.source = PAD_STRETCH.into();
        }
        self.load_takes();
    }

    // ───────────────────────────────────────── the routes, MGL's answers

    /// `POST /api/prism/stretch`: the page's body, into the deck only.
    pub fn stretch_post(&mut self, v: &Value) -> Value {
        let s = gstretch::from_json(v);
        let sh = self.sh();
        let applied = match sh.params() {
            Some(mut p) => {
                let rebank = p.algorithm != s.algorithm || p.grain.layers != s.grain.layers;
                merge_stretch(&mut p, &s);
                sh.set_params(p);
                if rebank {
                    sh.set_bank(LayerBank::build(s.algorithm, s.grain.layers, MAX_BLOCK, 2, self.rate));
                }
                true
            }
            None => false,
        };
        json!({ "ok": true, "applied": applied })
    }

    /// The page's stretch, posted (`prismStretchSend`).
    fn post_stretch_page(&mut self) {
        let body = Value::Object(self.stretch.clone());
        self.stretch_post(&body);
    }

    /// `POST /api/engine/pad`: ratio and semitones into what the deck plays.
    pub fn pad_post(&mut self, v: &Value) -> Value {
        let n = |k: &str| v.get(k).and_then(Value::as_f64).filter(|n| n.is_finite()).map(|n| n as f32);
        let ratio = n("ratio").map(|r| r.clamp(sources::RATIO_MIN, sources::RATIO_MAX));
        let semis = n("semitones").map(|r| r.clamp(sources::SEMITONE_MIN, sources::SEMITONE_MAX));
        let sh = self.sh();
        let applied = match sh.params() {
            Some(mut p) => {
                if let Some(r) = ratio {
                    p.ratio = r;
                }
                if let Some(s) = semis {
                    p.semitones = s;
                }
                sh.set_params(p);
                true
            }
            None => false,
        };
        json!({ "ok": true, "applied": applied })
    }

    /// `POST /api/engine/glide`.
    pub fn glide_post(&mut self, v: &Value) -> Result<Value, String> {
        let s = v.get("smoothing").and_then(Value::as_f64).filter(|n| n.is_finite()).ok_or_else(|| bad("no smoothing given"))? as f32;
        let s = s.clamp(0.0, 100.0);
        self.sh().set_glide(s);
        Ok(json!({ "ok": true, "applied": true, "smoothing": s as f64 }))
    }

    /// `POST /api/engine/transport` with `deck: "prism"`.
    pub fn transport(&mut self, v: &Value) -> Value {
        let num = |k: &str| v.get(k).and_then(Value::as_f64).filter(|n| n.is_finite());
        let sh = self.sh();
        if let Some(f) = num("seek") {
            sh.request_seek(f.max(0.0) as u64);
        }
        if let Some(g) = num("gain") {
            sh.set_gain(g as f32);
        }
        if let Some(Value::Bool(m)) = v.get("mute") {
            sh.set_mute(*m);
        }
        if let Some(r) = num("speed") {
            sh.set_speed(r as f32);
        }
        if num("gainL").is_some() || num("gainR").is_some() {
            let (l, r) = sh.side_gains();
            sh.set_side_gains(num("gainL").map_or(l, |g| g as f32), num("gainR").map_or(r, |g| g as f32));
        }
        if let Some(l) = v.get("loop") {
            let on = matches!(l.get("on"), Some(Value::Bool(true)));
            let a = l.get("a").and_then(Value::as_f64).unwrap_or(0.0) as u64;
            let b = l.get("b").and_then(Value::as_f64).unwrap_or(0.0) as u64;
            sh.set_loop(on, a, b);
        }
        match v.get("play") {
            Some(Value::Bool(true)) => sh.play(),
            Some(Value::Bool(false)) => sh.pause(),
            _ => {}
        }
        json!({ "position": sh.position() as f64 })
    }

    /// `GET /api/prism/state`.
    pub fn deck_state(&self) -> Value {
        let sh = self.handle.shared();
        let (lo, hi) = sh.heard_loop().unwrap_or((0, 0));
        json!({
            "path": self.sound_path,
            "playing": sh.is_playing(),
            "position": sh.position() as f64,
            "inFrames": sh.params().map(|p| p.in_frames as f64).unwrap_or(0.0),
            "sampleRate": self.rate as f64,
            "latency": sh.latency_frames() as f64,
            "loopA": lo as f64,
            "loopB": hi as f64,
        })
    }

    pub fn playing(&self) -> bool {
        self.handle.shared().is_playing()
    }

    fn has_sound(&self) -> bool {
        self.src.is_some()
    }

    /// `POST /api/rack`: the Prism document's rack, its pads checked as
    /// MGL's are; built and handed over unless `keepLive`.
    pub fn rack_set(&mut self, v: &Value) -> Value {
        let mut spec = RackSpec::from_json(v);
        let had = self.rack.clone();
        if v.get("pitchTime").is_none() {
            spec.pitch_time = had.pitch_time;
        }
        if v.get("postRoll").is_none() {
            spec.post_roll = had.post_roll.clone().into_iter().filter(|(id, _)| id == PAD_STRETCH || id == PAD_PITCH_TIME || spec.slot_ids.contains(id)).collect();
        }
        sources::check_pads(&mut spec);
        self.rack = spec;
        let sh = self.sh();
        if !matches!(v.get("keepLive"), Some(Value::Bool(true))) {
            match switched_slot(&self.rack, &had) {
                Some(i) => sh.swap_slot(i, self.rack.build_slot(i, self.rate, 2)),
                None => {
                    let rack = self.rack.build(self.rate, 2);
                    sh.set_rack(if rack.is_empty() { None } else { Some(rack) });
                }
            }
        }
        sh.set_pitch_time(self.rack.pitch_time);
        sh.set_post_roll_frames((self.rack.post_roll_ms() as f64 * 0.001 * self.rate as f64) as u64);
        self.rack.to_json()
    }

    /// `POST /api/rack/param` on the Prism document.
    pub fn rack_param(&mut self, id: &str, key: &str, value: f32, live_only: bool) -> Result<Value, String> {
        let sh = self.sh();
        if id == "master" {
            if key != "amount" {
                return Err("only amount is live on the master".into());
            }
            let applied = value.clamp(0.0, 1.0);
            self.rack.master.amount = applied;
            sh.set_manual_param(self.rack.slots.len(), key, applied);
            return Ok(json!({ "id": id, "key": key, "value": applied as f64 }));
        }
        let slot = self.rack.slot_ids.iter().position(|x| x == id).ok_or("no such module in the rack")?;
        if live_only {
            let mut probe = self.rack.clone();
            if !probe.set_param(slot, key, value) {
                return Err("no such control on that module".into());
            }
            let applied = probe.get_param(slot, key).unwrap_or(value);
            sh.set_manual_param(slot, key, applied);
            return Ok(json!({ "id": id, "key": key, "value": applied as f64, "live": true }));
        }
        if !self.rack.set_param(slot, key, value) {
            return Err("no such control on that module".into());
        }
        let applied = self.rack.get_param(slot, key).unwrap_or(value);
        sh.set_manual_param(slot, key, applied);
        Ok(json!({ "id": id, "key": key, "value": applied as f64 }))
    }

    /// `POST /api/pitchtime` on the Prism document (`live`: heard only).
    pub fn pitch_time(&mut self, v: &Value) -> Value {
        let now = grack::merge_pitch_time(self.rack.pitch_time, Some(v));
        if matches!(v.get("live"), Some(Value::Bool(true))) {
            self.sh().set_pitch_time(now);
            return json!({ "ok": true, "live": true });
        }
        self.rack.pitch_time = now;
        self.sh().set_pitch_time(now);
        grack::pitch_time_to_json(&now)
    }

    /// `GET /api/pad`.
    pub fn pad_sources(&self) -> Value {
        sources::pad_json(&self.rack)
    }

    // ───────────────────────────────────────── the page's own side

    /// `prismCurrent`.
    pub fn current(&self) -> Option<PadSource> {
        let srcs = sources::sources(&self.rack);
        srcs.iter().find(|s| s.id == self.source).cloned().or_else(|| srcs.into_iter().next())
    }

    /// `prismSetup`: the setup kept with the rack, or the source's default.
    pub fn setup(&self) -> Option<PadSetup> {
        let src = self.current()?;
        let kept = self.rack.pads.get(&src.id).and_then(|v| PadSetup::from_json(v, &src));
        let old = |p: &PadSetup| p.x == "ratio" && p.x_lo == 4.0 && p.x_hi == 0.25 && p.y == "semitones" && p.y_lo == -12.0 && p.y_hi == 12.0;
        match kept {
            Some(p) if old(&p) => Some(src.default),
            Some(p) => Some(p),
            None => Some(src.default),
        }
    }

    /// `prismPtc`: the Pitch Time Changer, filled in, as the page holds it.
    pub fn ptc_json(&self) -> Value {
        grack::pitch_time_to_json(&self.rack.pitch_time)
    }

    /// `prismRead`: a control's value now, wherever its source keeps it.
    pub fn read(&self, src_id: &str, key: &str) -> Option<f64> {
        let srcs = sources::sources(&self.rack);
        let src = srcs.iter().find(|s| s.id == src_id)?;
        let c = src.controls.iter().find(|c| c.key == key)?;
        if src_id == PAD_STRETCH {
            return Some(self.stretch.get(key).and_then(Value::as_f64).unwrap_or(c.min as f64));
        }
        if src_id == PAD_PITCH_TIME {
            return Some(self.ptc_json().get(key).and_then(Value::as_f64).unwrap_or(c.min as f64));
        }
        let i = self.rack.slot_ids.iter().position(|x| x == src_id)?;
        self.rack.get_param(i, key).map(|v| v as f64)
    }

    /// `prismWrite`: move one control, the way its own slider would.
    fn write(&mut self, key: &str, v: f64) {
        let Some(src) = self.current() else { return };
        if src.id == PAD_STRETCH {
            self.stretch.insert(key.into(), num(v));
            self.post_stretch_page();
            return;
        }
        if src.id == PAD_PITCH_TIME {
            let mut m = Map::new();
            m.insert(key.into(), num(v));
            m.insert("on".into(), true.into());
            self.pitch_time(&Value::Object(m));
            return;
        }
        let _ = self.rack_param(&src.id, key, v as f32, false);
    }

    /// `hsApply`: both controls to where the pad is.
    fn apply_hand(&mut self) {
        let Some(src) = self.current() else { return };
        let (Some(xk), Some(yk)) = (self.pad.axes.0.clone(), self.pad.axes.1.clone()) else { return };
        let vals = [(xk, self.pad.value(true, self.pad.hand.0)), (yk, self.pad.value(false, self.pad.hand.1))];
        if src.id != PAD_STRETCH {
            for (k, v) in vals {
                self.write(&k, v);
            }
            return;
        }
        let mut slow = false;
        let mut fast = Map::new();
        for (k, v) in vals {
            self.stretch.insert(k.clone(), num(v));
            if FAST.contains(&k.as_str()) {
                fast.insert(k, num(v));
            } else {
                slow = true;
            }
        }
        if !fast.is_empty() {
            self.pad_post(&Value::Object(fast));
        }
        if slow {
            self.post_stretch_page();
        }
    }

    /// `prismRelease`: a drag is over.
    fn release(&mut self) {
        let Some(src) = self.current() else { return };
        if src.id == PAD_STRETCH {
            self.post_stretch_page();
        } else if src.id != PAD_PITCH_TIME {
            self.push_rack(false);
        }
    }

    /// `prismPushRack`.
    fn push_rack(&mut self, structure: bool) {
        let mut v = self.rack.to_json();
        v["keepLive"] = (!structure).into();
        self.rack_set(&v);
    }

    /// `hsSendGlide`.
    fn send_glide(&mut self) {
        let g = self.pad.glide;
        if self.pad.sent == Some(g) {
            return;
        }
        self.pad.sent = Some(g);
        let _ = self.glide_post(&json!({ "smoothing": g }));
    }

    /// `prismHpSend`.
    fn send_hp(&mut self) {
        let g = |v: f64| engine_mgl::chop::js::pow(10.0, fader_db(v) / 20.0);
        let body = json!({ "speed": self.hp[0] / 128.0, "gainL": g(self.hp[1]), "gainR": g(self.hp[3]) });
        self.transport(&body);
    }

    fn axis_of(&self, src: &PadSource, key: &Option<String>) -> Axis {
        let c = key.as_ref().and_then(|k| src.controls.iter().find(|c| &c.key == k));
        Axis { log: c.is_some_and(|c| c.log), stepped: c.is_some_and(|c| c.stepped) }
    }

    /// `hsHandFromValues`.
    fn hand_from_values(&mut self) {
        let (Some(xk), Some(yk)) = (self.pad.axes.0.clone(), self.pad.axes.1.clone()) else { return };
        let (Some(x), Some(y)) = (self.read(&self.source.clone(), &xk), self.read(&self.source.clone(), &yk)) else { return };
        self.pad.hand = (clamp01(self.pad.frac(true, x)), clamp01(self.pad.frac(false, y)));
    }

    /// `hsSetupChanged`.
    fn setup_changed(&mut self) {
        let (Some(p), Some(src)) = (self.setup(), self.current()) else { return };
        let next = Lim { x_lo: p.x_lo as f64, x_hi: p.x_hi as f64, y_lo: p.y_lo as f64, y_hi: p.y_hi as f64 };
        // The limits as the page reads them from `/api/pad`: as written.
        let next = Lim { x_lo: sources::as_written(next.x_lo as f32), x_hi: sources::as_written(next.x_hi as f32), y_lo: sources::as_written(next.y_lo as f32), y_hi: sources::as_written(next.y_hi as f32) };
        let same = self.pad.axes.0.as_deref() == Some(p.x.as_str()) && self.pad.axes.1.as_deref() == Some(p.y.as_str());
        self.pad.axes = (Some(p.x.clone()), Some(p.y.clone()));
        self.pad.ax = (self.axis_of(&src, &self.pad.axes.0), self.axis_of(&src, &self.pad.axes.1));
        if same && next.x_hi != next.x_lo && next.y_hi != next.y_lo {
            self.pad.rescale(next);
        } else {
            self.pad.lim = next;
            self.hand_from_values();
        }
        self.save_takes();
    }

    /// `hsKey`.
    fn takes_key(&self) -> String {
        let path = if self.sound_path.is_empty() { &self.sound_name } else { &self.sound_path };
        if self.source == PAD_STRETCH {
            format!("hyperstretch:{path}")
        } else {
            format!("hyperstretch:{path}:{}", self.source)
        }
    }

    fn save_takes(&mut self) {
        let k = self.takes_key();
        self.takes.insert(k, self.pad.takes_json());
    }

    /// `hsLoadTakes`.
    fn load_takes(&mut self) {
        let kept = self.takes.get(&self.takes_key()).cloned();
        self.pad.load_takes(kept.as_ref());
        self.setup_changed();
        self.hand_from_values();
    }

    /// `hsSetSource`.
    pub fn use_source(&mut self, id: &str, t: f64) {
        self.pad.interrupt(t);
        self.save_takes();
        self.source = id.to_string();
        self.preset_at.clear();
        self.load_takes();
    }

    /// `prismKeep`: a changed setup, kept with the rack.
    fn keep(&mut self, next: Value) {
        let Some(src) = self.current() else { return };
        self.rack.pads.insert(src.id, next);
        self.push_rack(false);
    }

    /// `prismAxisChanged`.
    pub fn axis_changed(&mut self, axis: &str, key: &str) {
        let (Some(p), Some(src)) = (self.setup(), self.current()) else { return };
        let Some(c) = src.controls.iter().find(|c| c.key == key) else { return };
        let d = &src.default;
        let mut p = p.to_json();
        let x = axis == "x";
        let dk = if x { &d.x } else { &d.y };
        let (lo, hi) = if dk == key { if x { (d.x_lo, d.x_hi) } else { (d.y_lo, d.y_hi) } } else { (c.min, c.max) };
        let other = if x { "y" } else { "x" };
        if p[other] == key {
            p[other] = p[axis].clone();
            p[format!("{other}Lo")] = p[format!("{axis}Lo")].clone();
            p[format!("{other}Hi")] = p[format!("{axis}Hi")].clone();
        }
        p[axis] = key.into();
        p[format!("{axis}Lo")] = num(sources::as_written(lo));
        p[format!("{axis}Hi")] = num(sources::as_written(hi));
        self.keep(p);
        self.setup_changed();
    }

    /// `prismLimitChanged`: a limit typed into its corner.
    pub fn limit_changed(&mut self, field: &str, v: f64) -> bool {
        let (Some(p), Some(src)) = (self.setup(), self.current()) else { return false };
        let key = if field.starts_with('x') { &p.x } else { &p.y };
        let Some(c) = src.controls.iter().find(|c| &c.key == key) else { return false };
        if !v.is_finite() {
            return false;
        }
        let v = v.clamp(c.min as f64, c.max as f64);
        let mut p = p.to_json();
        p[field] = num(v);
        if p["xLo"] == p["xHi"] || p["yLo"] == p["yHi"] {
            return false;
        }
        self.keep(p);
        self.setup_changed();
        true
    }

    /// A control on the Controls panel moved (`prismKnob`'s `onInput`), or
    /// was let go (`onCommit`).
    pub fn setting(&mut self, key: &str, v: f64, commit: bool) {
        let Some(src) = self.current() else { return };
        if src.id == PAD_PITCH_TIME {
            let mut m = Map::new();
            m.insert(key.into(), num(takes::js_round(v)));
            self.pitch_time(&Value::Object(m));
        } else if src.id == PAD_STRETCH {
            self.write(key, v);
            if commit {
                self.post_stretch_page();
            }
        } else {
            let _ = self.rack_param(&src.id, key, v as f32, false);
            if commit {
                self.push_rack(false);
            }
        }
        let p = self.setup();
        if p.as_ref().is_some_and(|p| p.x == key || p.y == key) {
            self.hand_from_values();
        }
    }

    /// PTC: on or off.
    pub fn ptc_toggle(&mut self) {
        let on = !self.rack.pitch_time.on;
        self.pitch_time(&json!({ "on": on }));
    }

    /// `prismFaderSet`: LR sets both sides to its own value.
    pub fn fader(&mut self, key: &str, v: f64) {
        let v = v.round().clamp(0.0, 255.0);
        match key {
            "speed" => self.hp[0] = v,
            "l" => self.hp[1] = v,
            "r" => self.hp[3] = v,
            "lr" => {
                self.hp[2] = v;
                self.hp[1] = v;
                self.hp[3] = v;
            }
            _ => return,
        }
        self.send_hp();
    }

    /// `prismPostRollChanged`.
    pub fn post_roll(&mut self, ms: f64) {
        let Some(src) = self.current() else { return };
        let ms = if ms.is_finite() { ms.max(0.0) } else { 0.0 };
        self.rack.post_roll.insert(src.id, ms as f32);
        self.push_rack(false);
    }

    /// `prismSetEngine`.
    pub fn set_engine(&mut self, key: &str) {
        if !ENGINES.iter().any(|(k, _)| *k == key) || self.stretch.get("algorithm").and_then(Value::as_str) == Some(key) {
            return;
        }
        self.stretch.insert("algorithm".into(), key.into());
        self.post_stretch_page();
    }

    /// `prismChainAdd`.
    pub fn chain_add(&mut self, kind: &str) -> Option<String> {
        if !self.rack.insert(kind, None) {
            return None;
        }
        self.push_rack(true);
        self.open();
        self.rack.slot_ids.last().cloned()
    }

    /// `prismChainRemove`.
    pub fn chain_remove(&mut self, id: &str) {
        let Some(i) = self.rack.slot_ids.iter().position(|x| x == id) else { return };
        self.rack.remove(i);
        if self.source == id {
            self.source = PAD_STRETCH.into();
        }
        self.push_rack(true);
        self.open();
    }

    /// `prismPickChoose`: a process from the menu; one not in the chain is added.
    pub fn pick(&mut self, kind: &str, id: &str, t: f64) {
        let id = if id.is_empty() {
            match self.chain_add(kind) {
                Some(id) => id,
                None => return,
            }
        } else {
            id.to_string()
        };
        self.use_source(&id, t);
    }

    // ─────────────────────────────────────────────── presets

    /// `prismKind`.
    pub fn preset_kind(&self) -> String {
        let Some(src) = self.current() else { return String::new() };
        if src.id == PAD_STRETCH || src.id == PAD_PITCH_TIME {
            return src.id;
        }
        let i = self.rack.slot_ids.iter().position(|x| *x == src.id);
        i.map(|i| self.rack.slots[i].kind().trim_start_matches("prism:").to_string()).unwrap_or_default()
    }

    /// `prismSettingsNow`.
    fn settings_now(&self) -> Value {
        let (Some(src), Some(p)) = (self.current(), self.setup()) else { return json!({}) };
        if src.id == PAD_PITCH_TIME {
            let pt = self.ptc_json();
            return json!({ "feedback": pt["feedback"], "grain": pt["grain"], "xfade": pt["xfade"], "smoothing": pt["smoothing"] });
        }
        let mut out = Map::new();
        for c in &src.controls {
            if c.key == p.x || c.key == p.y {
                continue;
            }
            if let Some(v) = self.read(&src.id, &c.key).filter(|v| v.is_finite()) {
                out.insert(c.key.clone(), num(v));
            }
        }
        Value::Object(out)
    }

    /// `prismApplyPreset`: its window, its settings and its post-roll; the
    /// pad stays where it is.
    fn apply_preset(&mut self, p: &Value) {
        let Some(src) = self.current() else { return };
        let post = p.get("postRollMs").and_then(Value::as_f64).unwrap_or(0.0).max(0.0);
        self.rack.post_roll.insert(src.id.clone(), post as f32);
        let settings = p.get("settings").cloned().unwrap_or_else(|| json!({}));
        if src.id == PAD_PITCH_TIME {
            self.pitch_time(&settings);
        } else if src.id != PAD_STRETCH {
            if let Some(o) = settings.as_object() {
                for (k, v) in o {
                    if let Some(v) = v.as_f64() {
                        let _ = self.rack_param(&src.id, k, v as f32, false);
                    }
                }
            }
        }
        let w = json!({ "x": p["x"], "xLo": p["xLo"], "xHi": p["xHi"], "y": p["y"], "yLo": p["yLo"], "yHi": p["yHi"] });
        self.keep(w);
    }

    /// `prismDefaultPreset`.
    fn default_preset(&self) -> Value {
        let Some(src) = self.current() else { return json!({}) };
        let mut settings = Map::new();
        if src.id == PAD_PITCH_TIME {
            for (k, v) in [("feedback", 0.0), ("grain", 15.0), ("xfade", 100.0), ("smoothing", 50.0)] {
                settings.insert(k.into(), num(v));
            }
        } else if let Some(i) = self.rack.slot_ids.iter().position(|x| *x == src.id) {
            if let Some(sh) = shaper(self.rack.slots[i].kind()) {
                for sp in sh["params"].as_array().into_iter().flatten() {
                    let k = sp["key"].as_str().unwrap_or("");
                    if let Some(d) = sp["default"].as_f64().filter(|d| d.is_finite()) {
                        if k != src.default.x && k != src.default.y {
                            settings.insert(k.into(), num(d));
                        }
                    }
                }
            }
        }
        let mut p = src.default.to_json();
        p["settings"] = Value::Object(settings);
        p["postRollMs"] = num(0.0);
        p
    }

    /// The preset bar's calls: `{op: list | apply (at) | init | save (name)
    /// | rename (from, to) | delete (name)}`.
    pub fn presets(&mut self, v: &Value) -> Result<Value, String> {
        let kind = self.preset_kind();
        let op = v.get("op").and_then(Value::as_str).unwrap_or("list");
        let list = self.places.list(&kind);
        match op {
            "list" => {}
            "apply" | "init" => {
                let at = if op == "init" { "default".to_string() } else { v.get("at").and_then(Value::as_str).unwrap_or("").to_string() };
                let p = if at == "default" {
                    Some(self.default_preset())
                } else {
                    let (which, i) = at.split_at(1.min(at.len()));
                    let i: usize = i.parse().map_err(|_| bad("no such preset"))?;
                    match which {
                        "f" => list["factory"].get(i).cloned(),
                        "u" => list["user"].get(i).cloned(),
                        _ => None,
                    }
                };
                let p = p.ok_or_else(|| bad("no such preset"))?;
                self.apply_preset(&p);
                self.setup_changed();
                self.preset_at = at;
            }
            "save" => {
                let name = v.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
                let src = self.current().ok_or_else(|| bad("No process on the pad"))?;
                let mut preset = self.setup().map(|p| p.to_json()).unwrap_or_else(|| json!({}));
                preset["settings"] = self.settings_now();
                preset["postRollMs"] = num(*self.rack.post_roll.get(&src.id).unwrap_or(&0.0) as f64);
                self.places.save(&kind, &name, &preset)?;
                let l = self.places.list(&kind);
                let i = l["user"].as_array().and_then(|a| a.iter().position(|p| p["name"] == name.as_str()));
                self.preset_at = i.map(|i| format!("u{i}")).unwrap_or_default();
            }
            "rename" => {
                let was = self.preset_at.clone();
                let to = v.get("to").and_then(Value::as_str).unwrap_or("").trim().to_string();
                self.places.rename(&kind, v.get("from").and_then(Value::as_str).unwrap_or(""), &to)?;
                let l = self.places.list(&kind);
                let i = l["user"].as_array().and_then(|a| a.iter().position(|p| p["name"] == to.as_str()));
                if was.starts_with('u') {
                    if let Some(i) = i {
                        self.preset_at = format!("u{i}");
                    }
                }
            }
            "delete" => {
                self.places.delete(&kind, v.get("name").and_then(Value::as_str).unwrap_or(""))?;
                self.preset_at.clear();
            }
            other => return Err(format!("no preset op {other:?}")),
        }
        let list = self.places.list(&kind);
        let from = |at: &str| -> Option<Value> {
            let (w, i) = at.split_at(1.min(at.len()));
            let i: usize = i.parse().ok()?;
            match w {
                "f" => list["factory"].get(i).cloned(),
                "u" => list["user"].get(i).cloned(),
                _ => None,
            }
        };
        let label = if self.preset_at == "default" { "Default Settings".to_string() } else { from(&self.preset_at).and_then(|p| p["name"].as_str().map(str::to_string)).unwrap_or_default() };
        let tag = if self.preset_at.starts_with('f') { String::new() } else { self.current().map(|s| s.label).unwrap_or_default() };
        Ok(json!({ "kind": kind, "factory": list["factory"], "user": list["user"], "at": self.preset_at, "label": label, "tag": tag }))
    }

    // ─────────────────────────────────────────────── the pad

    fn asks(&mut self, a: Asks) {
        if a.play && self.has_sound() && !self.playing() {
            self.transport(&json!({ "play": true }));
        }
        if a.glide {
            self.send_glide();
        }
        if a.apply {
            self.apply_hand();
        }
        if a.pause && self.playing() {
            self.transport(&json!({ "play": false }));
        }
        if a.commit {
            self.release();
        }
        if a.keep {
            self.save_takes();
        }
    }

    /// The pad's calls: `{op, t, x, y, shift, alt, ...}`.
    pub fn pad_op(&mut self, v: &Value) -> Result<(), String> {
        let t = v.get("t").and_then(Value::as_f64).unwrap_or(0.0);
        let n = |k: &str| v.get(k).and_then(Value::as_f64).unwrap_or(0.0);
        let b = |k: &str| v.get(k).and_then(Value::as_bool).unwrap_or(false);
        let (has, playing) = (self.has_sound(), self.playing());
        let a = match v.get("op").and_then(Value::as_str).unwrap_or("") {
            "size" => {
                self.pad.w = n("w").max(140.0);
                self.pad.h = n("h").max(140.0);
                Asks::default()
            }
            "down" => self.pad.down((n("x"), n("y")), t, has, playing),
            "move" => self.pad.moved((n("x"), n("y")), t, b("shift")),
            "up" => self.pad.up(t, playing),
            "leave" => {
                self.pad.leave();
                Asks::default()
            }
            "centre" => self.pad.centre(t),
            "nudge" => self.pad.nudge(n("dx"), n("dy"), b("alt"), t),
            "rec" => self.pad.rec_button(t, has, playing),
            "play" => self.pad.play_button(t, has, playing),
            "pause" => {
                self.pad.pause_button(t);
                Asks::default()
            }
            "stop" => self.pad.stop_button(t),
            "rewind" => self.pad.rewind(t),
            "slot" => self.pad.pick_slot(n("i") as usize, t),
            "rate" => {
                self.pad.rate = n("v");
                Asks::default()
            }
            "dir" => {
                self.pad.dir = v.get("v").and_then(Value::as_str).unwrap_or("fwd").to_string();
                Asks::default()
            }
            "shape" => self.pad.shape(v.get("v").and_then(Value::as_str).unwrap_or("circle"), t, has, playing),
            "glide" => {
                self.pad.glide = n("v").round().clamp(0.0, 100.0);
                Asks { glide: true, ..Asks::default() }
            }
            "throw" => {
                self.pad.throw_on = b("v");
                Asks::default()
            }
            "loopRelease" => {
                self.pad.loop_on_release = b("v");
                Asks::default()
            }
            other => return Err(format!("no pad op {other:?}")),
        };
        self.asks(a);
        Ok(())
    }

    // ─────────────────────────────────────────────── the LFOs

    /// The control a target names: its range and its base value now.
    fn lfo_control(&self, t: &Target) -> Option<(PadControl, f64)> {
        let srcs = sources::sources(&self.rack);
        let src = srcs.iter().find(|s| s.id == t.src)?;
        let c = src.controls.iter().find(|c| c.key == t.key)?.clone();
        let base = self.read(&t.src, &t.key)?;
        base.is_finite().then_some((c, base))
    }

    /// `prismLfoSend` for each target, and the stretch's flush.
    fn lfo_send(&mut self, list: &[(Target, f64)]) {
        let mut out = Map::new();
        for (t, v) in list {
            if t.src == PAD_STRETCH {
                out.insert(t.key.clone(), num(*v));
                continue;
            }
            if !self.has_sound() {
                continue;
            }
            if t.src == PAD_PITCH_TIME {
                let mut m = Map::new();
                m.insert(t.key.clone(), num(*v));
                m.insert("live".into(), true.into());
                self.pitch_time(&Value::Object(m));
            } else {
                let _ = self.rack_param(&t.src, &t.key, *v as f32, true);
            }
        }
        if !out.is_empty() && self.has_sound() {
            let mut body = self.stretch.clone();
            for (k, v) in out {
                body.insert(k, v);
            }
            self.stretch_post(&Value::Object(body));
        }
    }

    /// The LFOs' calls: `{op: sel (i) | shape (v) | rate | depth | pw (v) |
    /// map | toggle (src, key) | unmap (k)}`.
    pub fn lfo_op(&mut self, v: &Value) -> Result<(), String> {
        let n = |k: &str| v.get(k).and_then(Value::as_f64).unwrap_or(0.0);
        let sel = self.lfos.sel;
        match v.get("op").and_then(Value::as_str).unwrap_or("") {
            "sel" => {
                self.lfos.sel = (n("i") as usize).min(3);
                self.lfos.mapping = false;
            }
            "shape" => self.lfos.lfos[sel].shape = v.get("v").and_then(Value::as_str).unwrap_or("sine").to_string(),
            "rate" => self.lfos.lfos[sel].rate = n("v").clamp(0.02, 20.0),
            "depth" => self.lfos.lfos[sel].depth = n("v").clamp(0.0, 100.0),
            "pw" => self.lfos.lfos[sel].pw = n("v").clamp(5.0, 95.0),
            "map" => self.lfos.mapping = !self.lfos.mapping,
            "stopMap" => self.lfos.mapping = false,
            "toggle" | "unmap" => {
                let t = if v["op"] == "unmap" {
                    self.lfos.lfos[sel].targets.get(n("k") as usize).cloned().ok_or_else(|| bad("no such target"))?
                } else {
                    Target { src: v.get("src").and_then(Value::as_str).unwrap_or("").into(), key: v.get("key").and_then(Value::as_str).unwrap_or("").into() }
                };
                if self.lfos.toggle(t.clone()) {
                    if let Some((_, base)) = self.lfo_control(&t) {
                        self.lfo_send(&[(t, base)]);
                    }
                }
            }
            other => return Err(format!("no LFO op {other:?}")),
        }
        Ok(())
    }

    // ─────────────────────────────────────────────── each frame

    /// A frame of the page (`hsFrame` and the LFOs' `tick`), at the face's
    /// clock `now` (ms): the take plays, the throw flies, the ring follows,
    /// the LFOs run and every 33 ms send their swing.
    pub fn tick(&mut self, now: f64) {
        let a = self.pad.frame(now);
        self.asks(a);
        let dt = if self.last_tick == 0.0 { 0.0 } else { ((now - self.last_tick) / 1000.0).min(0.1) };
        self.last_tick = now;
        self.lfos.advance(dt);
        if now - self.lfos.sent < lfos::SEND_MS {
            return;
        }
        self.lfos.sent = now;
        let list: Vec<(Target, f64)> = self
            .lfos
            .targets()
            .into_iter()
            .filter_map(|t| {
                let (c, base) = self.lfo_control(&t)?;
                let v = self.lfos.value(&t.src, &t.key, c.min as f64, c.max as f64, c.stepped || !c.choices.is_empty(), base);
                Some((t, v))
            })
            .collect();
        self.lfo_send(&list);
    }

    // ─────────────────────────────────────────────── what the face draws

    /// Everything the face shows: the sources, the process on the pad and its
    /// setup, every control's value, the chain, the faders, the glide, the
    /// deck, the pad and its takes, the LFOs, the presets' label.
    pub fn view(&self) -> Value {
        let srcs = sources::pad_json(&self.rack);
        let cur = self.current();
        let setup = self.setup();
        let values: Map<String, Value> = cur
            .as_ref()
            .map(|s| s.controls.iter().filter_map(|c| Some((c.key.clone(), num(self.read(&s.id, &c.key)?)))).collect())
            .unwrap_or_default();
        let chain: Vec<Value> = self
            .rack
            .slots
            .iter()
            .enumerate()
            .map(|(i, s)| {
                let kind = s.kind();
                let label = shaper(kind).and_then(|sh| sh["label"].as_str()).map(str::to_string).unwrap_or_else(|| kind.to_string());
                json!({ "id": self.rack.slot_ids.get(i), "kind": kind, "label": label })
            })
            .collect();
        let a = coef(self.pad.glide);
        let tau = if a >= 1.0 { "instant".to_string() } else { format!("{:.2} s to 63 %", (-1.0 / engine_mgl::chop::js::log(1.0 - a)) * 512.0 / 44100.0) };
        let lfo_marks: Vec<Value> = cur
            .as_ref()
            .map(|s| {
                s.controls
                    .iter()
                    .filter_map(|c| {
                        let (rng, i) = self.lfos.reach(&s.id, &c.key)?;
                        let base = self.read(&s.id, &c.key)?;
                        let v = self.lfos.value(&s.id, &c.key, c.min as f64, c.max as f64, c.stepped || !c.choices.is_empty(), base);
                        Some(json!({ "key": c.key, "rng": rng, "lfo": i, "v": v }))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let pad = self.pad.view();
        let mut deck = self.deck_state();
        deck["frames"] = num(self.frames as f64);
        deck["looping"] = self.looping.into();
        json!({
            "sources": srcs["sources"],
            "source": cur.as_ref().map(|s| s.id.clone()),
            "setup": setup.map(|p| p.to_json()),
            "values": values,
            "stretch": Value::Object(self.stretch.clone()),
            "ptc": self.ptc_json(),
            "hp": { "speed": self.hp[0], "l": self.hp[1], "lr": self.hp[2], "r": self.hp[3] },
            "postRoll": cur.as_ref().map(|s| *self.rack.post_roll.get(&s.id).unwrap_or(&0.0) as f64).unwrap_or(0.0),
            "chain": chain,
            "coef": format!("{a:.4}"),
            "tau": tau,
            "deck": deck,
            "sound": { "name": self.sound_name, "path": self.sound_path, "file": self.sound_file, "frames": self.frames as f64, "rate": self.rate as f64 },
            "pad": pad,
            "lfos": self.lfos.view(),
            "lfoMarks": lfo_marks,
            "presetAt": self.preset_at,
        })
    }

    /// The sound's peaks across `cols` columns: per column the largest of any
    /// channel's |max| and |min| (`prismDrawWave`'s `at`), and the largest of
    /// all (its `pk`, at least 0.001).
    pub fn peaks(&self, cols: usize, out: &mut Vec<f32>) -> f32 {
        out.clear();
        let Some(src) = self.src.as_ref() else { return 0.001 };
        let ch = src.channels.max(1);
        let frames = src.frames();
        let mut pk = 0.001f32;
        for c in 0..cols {
            let (a, b) = (c * frames / cols, ((c + 1) * frames / cols).max(c * frames / cols + 1).min(frames));
            let mut m = 0f32;
            for f in a..b {
                for k in 0..ch {
                    m = m.max(src.samples[f * ch + k].abs());
                }
            }
            pk = pk.max(m);
            out.push(m);
        }
        pk
    }
}

fn num(x: f64) -> Value {
    serde_json::Number::from_f64(x).map_or(Value::Null, Value::Number)
}

/// `RackSpec::switched_slot`: the one slot whose kind alone changed.
fn switched_slot(now: &RackSpec, had: &RackSpec) -> Option<usize> {
    if now.slots.len() != had.slots.len() || now.slot_ids != had.slot_ids {
        return None;
    }
    let i = (0..now.slots.len()).find(|&i| now.slots[i].kind() != had.slots[i].kind())?;
    if now.slots[i].bypassed() != had.slots[i].bypassed() {
        return None;
    }
    let mut probe = now.clone();
    probe.slots[i] = had.slots[i].clone();
    let id = &now.slot_ids[i];
    match had.modules.get(id) {
        Some(m) => probe.modules.insert(id.clone(), m.clone()),
        None => probe.modules.remove(id),
    };
    // Pads are checked in both; compare the rest.
    probe.pads = had.pads.clone();
    (probe == *had).then_some(i)
}

/// The defaults the Controls panel resets a knob to (`PRISM_STRETCH_DEFAULTS`,
/// `PTC_DEFAULTS`, a shaper's own).
pub fn control_default(src: &str, kind: &str, key: &str) -> Option<f64> {
    if src == PAD_STRETCH {
        return STRETCH_DEFAULTS.iter().find(|(k, _)| *k == key).map(|(_, v)| *v);
    }
    if src == PAD_PITCH_TIME {
        return PTC_DEFAULTS.iter().find(|(k, _)| *k == key).map(|(_, v)| *v);
    }
    shaper(kind)?["params"].as_array()?.iter().find(|p| p["key"] == key)?["default"].as_f64()
}
