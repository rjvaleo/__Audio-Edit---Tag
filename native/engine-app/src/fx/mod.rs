//! MGL's FX page, and every effect as a module of its own.
//!
//! **The FX page** (`ui/app/425-fx-page.js`) is the Grain page's effects view
//! on its own: MGL's rack (`RackSpec`, the same one Grain carries, `grain/rack.rs`)
//! with its cards, OUT and SPECTRUM, the L, LR and R faders and the meters,
//! and a Sources panel on top. In MGL it plays the open document through the
//! grain deck "straight" (WSOLA at its own speed and pitch). On the canvas the
//! FX module has a Sound socket, whose document it plays straight through its
//! own transport (Edit's, `engine_mgl::EditPlayer`: from the head, round a
//! loop), and an Audio socket, so anything cabled in (Grain's out, Wave,
//! Atmosphere) goes through the rack too. The two are summed, then the rack,
//! then MGL's deck levels (`engine_mgl::Levels`: the transport's gain, the L
//! and R faders, MGL's ramps), then out.
//!
//! **An effect module** (`fx:<kind>`) is one card of MGL's rack on its own:
//! a rack holding one slot of that kind, made as MGL's Add menu makes it,
//! audio in and audio out. It plays what MGL's rack plays for that slot, to
//! the bit; at its defaults (wet 1, level 0 dB, Place off) that is the
//! effect's own kernel, so every prism-fx effect keeps its recorded golden
//! (prism-fx `tests/golden/par.tsv`; `tests/fx.rs` holds the module to it).
//!
//! What is handed to the audio thread is built here, on the app's thread
//! (`engine_mgl::RackThing`); a control moved is a stamped knob, heard at once
//! with the tails kept, as MGL's `/api/rack/param` moves it.

pub mod catalogue;
mod link;
mod sizes;

pub use sizes::card_width;

use crate::grain::rack::RackSpec;
use engine_core::{Controller, EventKind, ModuleId};
use engine_mgl::{Levels, Rack, RackMeters, RackThing, Scope, Transport};
use serde_json::{json, Value};
use std::sync::Arc;

pub use catalogue::{catalogue_json, effect, effects, EffectKind};

/// The FX page's size, as RJ's window shows it: MGL's page (1388 x 990, as
/// Grain's) centred over the 1500 wide middle of the window, its top 927
/// rows above the Now bar (48), which MGL lays over the page's foot; the
/// rest of the page is below the window.
pub const FX_W: u32 = 1500;
pub const FX_H: u32 = 975;
/// An effect module's height: a card in the FX view's row.
pub const CARD_H: u32 = 400;

/// The engine modules a canvas FX module is made of, by number.
pub const PLAYER: u32 = 0;
pub const SUM: u32 = 1;
pub const RACK: u32 = 2;
pub const LEVELS: u32 = 3;

/// Where a side fader sits for unity (`GS_FX_UNITY`), and the LR fader's
/// start (the transport's volume, MGL's `#volume` default).
pub const UNITY: f64 = 0.8;
pub const VOLUME: f64 = 0.85;

pub struct FxPart {
    /// The effect this module is, or None for the FX page.
    pub effect: Option<&'static EffectKind>,
    pub rack: RackSpec,
    /// What the face keeps of its own (the card in front, the Sources
    /// panel's filter and search, an Advanced page open), as it hands it over.
    pub ui: Value,
    /// The page's transport (the Sound socket's document, played straight).
    pub transport: Arc<Transport>,
    /// The output faders: LR (0 to 1, MGL's volume, sent as the gain) and L
    /// and R (0 to 1, unity at 0.8, sent as `(u / 0.8)²`).
    pub volume: f64,
    pub side_l: f64,
    pub side_r: f64,
    /// Each stage's peak (stage 0 the rack's input, stage i + 1 after slot i)
    /// and each slot's telemetry, written by the audio thread.
    pub meters: Arc<RackMeters>,
    /// The last frames out, for OUT, SPECTRUM and the meters.
    pub scope: Arc<Scope>,
    /// The preset bar: where presets are kept, the name last applied or
    /// saved, and A/B (the side shown and the rack kept for the other).
    pub places: crate::grain::presets::Places,
    pub preset: String,
    pub side: usize,
    pub ab: [Option<RackSpec>; 2],
    /// For each slot as laid, its controls' keys in the knob numbers' order.
    laid: Vec<Vec<String>>,
    rate: f32,
}

impl FxPart {
    /// A new FX page (`effect` None) or effect module, or one from a patch.
    pub fn new(effect: Option<&'static EffectKind>, rate: f32, saved: Option<&Value>) -> FxPart {
        let rack = match (saved.and_then(|s| s.get("rack")), effect) {
            (Some(r), _) => RackSpec::from_json(r),
            (None, Some(e)) => one_slot(e),
            (None, None) => RackSpec::default_chain(),
        };
        let num = |k: &str, d: f64| saved.and_then(|s| s.get(k)).and_then(Value::as_f64).filter(|x| x.is_finite()).unwrap_or(d);
        FxPart {
            effect,
            rack,
            ui: saved.and_then(|s| s.get("ui")).cloned().unwrap_or(Value::Null),
            transport: Transport::new(),
            volume: num("volume", VOLUME).clamp(0.0, 1.0),
            side_l: num("sideL", UNITY).clamp(0.0, 1.0),
            side_r: num("sideR", UNITY).clamp(0.0, 1.0),
            meters: Arc::new(RackMeters::new()),
            scope: Scope::new(),
            places: Default::default(),
            preset: saved.and_then(|s| s.get("preset")).and_then(Value::as_str).unwrap_or("").to_string(),
            side: 0,
            ab: [None, None],
            laid: Vec::new(),
            rate,
        }
    }

    pub fn is_page(&self) -> bool {
        self.effect.is_none()
    }

    /// What the patch keeps.
    pub fn state(&self) -> Value {
        let mut o = json!({ "rack": self.rack.to_json(), "ui": self.ui });
        if self.is_page() {
            o["preset"] = json!(self.preset);
            o["volume"] = json!(self.volume);
            o["sideL"] = json!(self.side_l);
            o["sideR"] = json!(self.side_r);
        }
        o
    }

    /// The rack module, with its scope.
    pub fn rack_module(&self, rate: f32) -> Rack {
        Rack::with_scope(rate, self.scope.clone())
    }

    /// The levels module at the faders' settings.
    pub fn levels_module(&self) -> Levels {
        let (l, r) = self.sides();
        Levels::new(self.volume as f32, l, r)
    }

    fn sides(&self) -> (f32, f32) {
        ((self.side_l / UNITY).powi(2) as f32, (self.side_r / UNITY).powi(2) as f32)
    }

    /// The rack built from its settings and handed to the rack module.
    pub fn lay(&mut self, ctl: &mut Controller, rack: ModuleId, max_block: usize) -> Result<(), engine_core::PatchError> {
        let mut built = self.rack.build(self.rate.max(1.0) as u32, 2);
        built.set_meters(self.meters.clone());
        self.laid = keys_of(&built);
        let thing = RackThing::new(if built.is_empty() { None } else { Some(built) }, max_block);
        ctl.give(rack, 0, thing)?;
        Ok(())
    }

    /// The knob a slot's control is, as laid.
    fn knob(&self, slot: usize, key: &str) -> Option<u32> {
        self.laid.get(slot)?.iter().position(|k| k == key).map(|n| (slot * 256 + n) as u32)
    }

    // ──────────────────────────────────────────────────────────── the rack

    /// `POST /api/rack`: the whole rack, as the page sends it, built again
    /// and handed over (unless `keepLive`, as MGL's).
    pub fn rack_set(&mut self, ctl: &mut Controller, rack: ModuleId, max_block: usize, v: &Value) -> Result<Value, engine_core::PatchError> {
        let mut spec = RackSpec::from_json(v);
        let had = self.rack.clone();
        if v.get("pitchTime").is_none() {
            spec.pitch_time = had.pitch_time;
        }
        if v.get("postRoll").is_none() {
            spec.post_roll = had.post_roll.clone().into_iter().filter(|(id, _)| spec.slot_ids.contains(id)).collect();
        }
        self.rack = spec;
        if !matches!(v.get("keepLive"), Some(Value::Bool(true))) {
            // Built again whole and swapped (MGL's deck swaps only a slot
            // that changed kind): every slot's tail starts over. Only a
            // change of structure does this; a control is a knob.
            self.lay(ctl, rack, max_block)?;
        }
        Ok(self.rack.to_json())
    }

    /// `POST /api/rack/param`: one control of one slot, by the slot's id,
    /// heard at once with its tails.
    pub fn rack_param(&mut self, ctl: &mut Controller, rack: ModuleId, id: &str, key: &str, value: f32, live_only: bool) -> Result<Value, String> {
        let slot = self.rack.slot_ids.iter().position(|x| x == id).ok_or("no such module in the rack")?;
        let applied = if live_only {
            let mut probe = self.rack.clone();
            if !probe.set_param(slot, key, value) {
                return Err("no such control on that module".into());
            }
            probe.get_param(slot, key).unwrap_or(value)
        } else {
            if !self.rack.set_param(slot, key, value) {
                return Err("no such control on that module".into());
            }
            self.rack.get_param(slot, key).unwrap_or(value)
        };
        if let Some(index) = self.knob(slot, key) {
            ctl.send(rack, EventKind::Param { index, value: applied }).map_err(|e| format!("{e:?}"))?;
        }
        let mut out = json!({ "id": id, "key": key, "value": applied as f64 });
        if live_only {
            out["live"] = json!(true);
        }
        Ok(out)
    }

    /// A slot switched on or off, heard at once.
    pub fn bypass(&mut self, ctl: &mut Controller, rack: ModuleId, at: usize, on: Option<bool>) -> Result<bool, engine_core::PatchError> {
        let Some(s) = self.rack.slots.get_mut(at) else { return Ok(false) };
        let bypassed = on.map_or(!s.bypassed(), |on| !on);
        s.set_bypassed(bypassed);
        ctl.send(rack, EventKind::Param { index: Rack::switch(at), value: if bypassed { 0.0 } else { 1.0 } })?;
        Ok(true)
    }

    // ───────────────────────────────────────────────────────── the transport

    /// The page's transport and faders: `{play, seek, loop: {on, a, b},
    /// volume, sideL, sideR}` (the faders 0 to 1, as the page's).
    pub fn transport_msg(&mut self, ctl: &mut Controller, levels: ModuleId, v: &Value) -> Result<Value, engine_core::PatchError> {
        let num = |k: &str| v.get(k).and_then(Value::as_f64).filter(|n| n.is_finite());
        if let Some(f) = num("seek") {
            self.transport.seek(f.max(0.0) as u64);
        }
        if let Some(l) = v.get("loop") {
            let on = matches!(l.get("on"), Some(Value::Bool(true)));
            let a = l.get("a").and_then(Value::as_f64).unwrap_or(0.0).max(0.0) as u64;
            let b = l.get("b").and_then(Value::as_f64).unwrap_or(0.0).max(0.0) as u64;
            self.transport.set_loop(on, a, b);
        }
        if let Some(Value::Bool(p)) = v.get("play") {
            self.transport.play(*p);
        }
        if self.is_page() {
            if let Some(u) = num("volume") {
                self.volume = u.clamp(0.0, 1.0);
                ctl.send(levels, EventKind::Param { index: Levels::GAIN, value: self.volume as f32 })?;
            }
            if num("sideL").is_some() || num("sideR").is_some() {
                self.side_l = num("sideL").unwrap_or(self.side_l).clamp(0.0, 1.0);
                self.side_r = num("sideR").unwrap_or(self.side_r).clamp(0.0, 1.0);
                let (l, r) = self.sides();
                ctl.send(levels, EventKind::Param { index: Levels::LEFT, value: l })?;
                ctl.send(levels, EventKind::Param { index: Levels::RIGHT, value: r })?;
            }
        }
        Ok(self.transport_json())
    }

    pub fn transport_json(&self) -> Value {
        let (l, r) = self.transport.peaks();
        json!({
            "playing": self.transport.is_playing(), "position": self.transport.position() as f64,
            "volume": self.volume, "sideL": self.side_l, "sideR": self.side_r,
            "peakL": l as f64, "peakR": r as f64,
        })
    }

    /// The meters since the last reading: each stage's peaks (left, right)
    /// and each slot's telemetry (a compressor's reduction, a gate's state).
    pub fn levels(&self) -> Value {
        let n = self.rack.slots.len() + 1;
        let peaks = self.meters.snapshot();
        let tel = self.meters.telemetry_snapshot();
        json!({
            "stages": peaks.iter().take(n).map(|(l, r)| json!([*l as f64, *r as f64])).collect::<Vec<_>>(),
            "telemetry": tel.iter().take(n.saturating_sub(1)).map(|x| *x as f64).collect::<Vec<_>>(),
        })
    }

    pub fn info(&self) -> Value {
        json!({
            "rack": self.rack.to_json(),
            "ui": self.ui,
            "transport": self.transport_json(),
            "preset": self.preset,
            "side": if self.side == 1 { "b" } else { "a" },
            "effect": self.effect.map(|e| json!({ "id": e.id, "kind": e.kind, "suite": e.suite, "mode": e.mode, "label": e.label, "group": e.group })),
        })
    }
}

/// A rack of one slot of `e`, as MGL's Add menu makes it (`addFxModule`): the
/// kind's defaults, and its module, mode and revision.
pub fn one_slot(e: &EffectKind) -> RackSpec {
    let mut slot = default_slot(&e.kind).unwrap_or_else(|| json!({ "kind": e.kind, "bypassed": false }));
    slot["id"] = json!("fx-1");
    if let (Some(s), Some(m)) = (e.suite, e.mode) {
        slot["suite"] = json!(s);
        slot["mode"] = json!(m);
        slot["rev"] = json!(e.rev as f64);
    }
    RackSpec::from_json(&json!({ "slots": [slot] }))
}

/// `defaultFxSlot(kind)` without its id: the built-ins' own fields, or the
/// shaper's every control at its default. None for a kind not in `/api/fx`.
pub fn default_slot(kind: &str) -> Option<Value> {
    Some(match kind {
        "gain" => json!({ "kind": kind, "bypassed": false, "db": 0.0 }),
        "eq" => json!({ "kind": kind, "bypassed": false, "bands": default_eq_bands() }),
        "comp" => json!({ "kind": kind, "bypassed": false, "thresholdDb": -18.0, "ratio": 4.0, "attackMs": 10.0, "releaseMs": 100.0, "kneeDb": 6.0, "makeupDb": 0.0 }),
        _ => {
            let sh = shaper(kind)?;
            let mut params = serde_json::Map::new();
            for p in sh["params"].as_array()? {
                params.insert(p["key"].as_str()?.to_string(), p["default"].clone());
            }
            json!({ "kind": kind, "bypassed": false, "params": params })
        }
    })
}

/// A shaper's entry in `/api/fx`.
pub fn shaper(kind: &str) -> Option<&'static Value> {
    static BY: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    let all = BY.get_or_init(catalogue_json);
    all["shapers"].as_array()?.iter().find(|s| s["kind"] == kind)
}

/// A mode of a module, by ids: its entry in `/api/fx`'s suites.
fn mode_entry(suite: &str, mode: &str) -> Option<Value> {
    let all = catalogue_json();
    let s = all["suites"].as_array()?.iter().find(|s| s["id"] == suite)?.clone();
    s["families"].as_array()?.iter().flat_map(|f| f["modes"].as_array().cloned().unwrap_or_default()).find(|m| m["id"] == mode)
}

/// `fxSlotMode(slot)`'s mode: by the slot's module and mode, or by its kind.
fn slot_mode(slot: &Value) -> Option<Value> {
    if let (Some(s), Some(m)) = (slot["suite"].as_str(), slot["mode"].as_str()) {
        return mode_entry(s, m);
    }
    let all = catalogue_json();
    all["suites"].as_array()?.iter().flat_map(|s| s["families"].as_array().cloned().unwrap_or_default()).flat_map(|f| f["modes"].as_array().cloned().unwrap_or_default()).find(|m| m["kind"] == slot["kind"])
}

const SLOT_OWN: [&str; 11] = ["id", "kind", "bypassed", "suite", "mode", "rev", "memory", "face", "wet", "level", "place"];

/// `fxModeValues(slot)`.
fn mode_values(slot: &Value) -> Value {
    if slot["params"].is_object() {
        return slot["params"].clone();
    }
    let mut out = serde_json::Map::new();
    for (k, v) in slot.as_object().into_iter().flatten() {
        if !SLOT_OWN.contains(&k.as_str()) {
            out.insert(k.clone(), v.clone());
        }
    }
    Value::Object(out)
}

/// `fxCarries(p)`.
fn carries(p: &Value) -> bool {
    let key = p["key"].as_str().unwrap_or("");
    let lower = key.to_lowercase();
    let pre = lower.starts_with("predelay") || lower.starts_with("pre-delay");
    match p["role"].as_str() {
        Some("output") => lower.contains("mix") || lower.contains("wet") || lower.contains("dry"),
        Some("time") => lower.contains("predelay") || lower.contains("pre-delay"),
        _ => ["mix", "wet", "dry"].contains(&key) || pre,
    }
}

/// `fxSwitchMode(index, mode, suiteId)` on a slot's JSON: the new mode at its
/// defaults, or as it was last left (the slot's memory), Mix and Pre-delay
/// carried between two modes of our own, and the slot's own kept (its id,
/// On, footer, look, Place). None if it is that mode already, or no such mode.
pub fn switch_mode(old: &Value, suite: &str, mode: &str) -> Option<Value> {
    let to = mode_entry(suite, mode)?;
    let at = slot_mode(old);
    if at.as_ref().is_some_and(|a| a["id"] == mode && old["suite"].as_str().is_none_or(|s| s == suite)) {
        return None;
    }
    let kind = to["kind"].as_str()?;
    let mut fresh = default_slot(kind)?;
    let mut memory = old["memory"].as_object().cloned().unwrap_or_default();
    if let Some(a) = &at {
        memory.insert(a["id"].as_str().unwrap_or("").to_string(), mode_values(old));
    }
    if let Some(back) = memory.get(mode).cloned() {
        if fresh["params"].is_object() {
            let keys: Vec<String> = fresh["params"].as_object().unwrap().keys().cloned().collect();
            for k in keys {
                if let Some(v) = back.get(&k) {
                    fresh["params"][&k] = v.clone();
                }
            }
        } else {
            let keys: Vec<String> = fresh.as_object().unwrap().keys().cloned().collect();
            for k in keys {
                if !SLOT_OWN.contains(&k.as_str()) {
                    if let Some(v) = back.get(&k) {
                        fresh[&k] = v.clone();
                    }
                }
            }
        }
    }
    if at.as_ref().is_some_and(|a| a["class"] == "ours") && to["class"] == "ours" && old["params"].is_object() && fresh["params"].is_object() {
        for p in shaper(kind).and_then(|s| s["params"].as_array()).into_iter().flatten() {
            let k = p["key"].as_str().unwrap_or("");
            if carries(p) {
                if let Some(v) = old["params"].get(k) {
                    fresh["params"][k] = v.clone();
                }
            }
        }
    }
    fresh["id"] = old["id"].clone();
    fresh["bypassed"] = old["bypassed"].clone();
    fresh["suite"] = json!(suite);
    fresh["mode"] = json!(mode);
    fresh["rev"] = to["rev"].clone();
    fresh["memory"] = Value::Object(memory);
    for k in ["wet", "level", "face", "place"] {
        if !old[k].is_null() {
            fresh[k] = old[k].clone();
        }
    }
    Some(fresh)
}

/// MGL's new EQ's bands (`defaultEqBands`, 071-rack-controls.js).
pub fn default_eq_bands() -> Value {
    let band = |t: &str, on: bool, f: f64, q: f64| json!({ "type": t, "enabled": on, "freq": f, "q": q, "gainDb": 0.0 });
    json!([
        band("highpass", false, 30.0, 0.71),
        band("lowshelf", true, 100.0, 0.7),
        band("bell", true, 250.0, 1.0),
        band("bell", false, 500.0, 1.0),
        band("bell", false, 2000.0, 1.0),
        band("bell", false, 4000.0, 1.0),
        band("highshelf", true, 10000.0, 0.7),
        band("lowpass", false, 18000.0, 0.71),
    ])
}

/// Each slot's control keys, by knob number (`fx::ControlMap`).
fn keys_of(rack: &mgl_fx::Rack) -> Vec<Vec<String>> {
    rack.control_maps().iter().map(|m| (0..m.len()).filter_map(|n| m.index(n).map(|(k, _)| k.to_string())).collect()).collect()
}
