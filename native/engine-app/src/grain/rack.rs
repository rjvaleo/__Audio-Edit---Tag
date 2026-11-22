//! Grain's rack: MGL's per-document effect rack (`RackSpec`), its JSON shape,
//! and the live `fx::Rack` it builds, ported line for line from MGL's server
//! (`core/crates/server-core/src/rack.rs`), with serde_json in place of MGL's
//! own JSON value (both hold numbers as `f64`; both write keys in order).
//!
//! One thing is kept as written rather than read: the Prism pad's setups
//! (`pads`), which belong to the Prism page and are carried through a save
//! and a load untouched, for the slots still in the rack.

use mgl_fx::comp::CompSettings;
use mgl_fx::eq::{Band, EqSettings};
use mgl_fx::prism::prism_fx::suite as prism_fx_suite;
use mgl_fx::shape::ShapeKind;
use mgl_fx::{Compressor, Eq, Gain, MasterSettings, Maximizer, Rack};
use mgl_engine::transport::PitchTime;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

/// `live::MAX_BLOCK`, the room MGL's rack is built with.
pub const MAX_BLOCK: usize = 8192;
/// `pad::STRETCH` and `pad::PITCH_TIME`.
pub const PAD_STRETCH: &str = "stretch";
pub const PAD_PITCH_TIME: &str = "ptc";

#[derive(Debug, Clone, PartialEq)]
pub struct RackSpec {
    pub slots: Vec<SlotSpec>,
    pub slot_ids: Vec<String>,
    pub master: MasterSettings,
    /// The Prism pad's setups, as written (see the module's note).
    pub pads: BTreeMap<String, Value>,
    pub pitch_time: PitchTime,
    pub post_roll: BTreeMap<String, f32>,
    pub ranges: BTreeMap<String, BTreeMap<String, KnobRange>>,
    pub mixes: BTreeMap<String, SlotMix>,
    pub modules: BTreeMap<String, SlotModule>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct SlotModule {
    pub rev: Option<u16>,
    pub memory: Option<Value>,
    pub face: Option<&'static str>,
    pub place: Option<mgl_fx::prism::prism_fx::place::PlaceSettings>,
}

pub fn is_reverb(kind: &str) -> bool {
    mgl_fx::suite::mode_of_kind(kind).is_some_and(|(s, _)| s.id == "reverb")
}

fn place_json(p: &mgl_fx::prism::prism_fx::place::PlaceSettings) -> Value {
    json!({
        "on": p.on, "shape": p.shape as f64, "sizeM": p.size_m as f64, "pos": p.pos as f64,
        "dist": p.dist as f64, "height": p.height as f64, "spread": p.spread as f64,
    })
}

fn place_from(v: &Value) -> Option<mgl_fx::prism::prism_fx::place::PlaceSettings> {
    if !v.is_object() {
        return None;
    }
    let mut p = mgl_fx::prism::prism_fx::place::PlaceSettings { on: false, ..Default::default() };
    for (key, field) in [("on", "place.on"), ("shape", "place.shape"), ("sizeM", "place.sizeM"), ("pos", "place.pos"), ("dist", "place.dist"), ("height", "place.height"), ("spread", "place.spread")] {
        let x = match v.get(key) {
            Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0) as f32,
            Some(Value::Bool(b)) => {
                if *b {
                    1.0
                } else {
                    0.0
                }
            }
            _ => continue,
        };
        mgl_fx::place_set(&mut p, field, x);
    }
    Some(p)
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SlotMix {
    pub wet: f32,
    pub level: f32,
}

impl Default for SlotMix {
    fn default() -> Self {
        SlotMix { wet: 1.0, level: 0.0 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KnobRange {
    pub min: f32,
    pub max: f32,
    pub log: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SlotSpec {
    Gain { db: f32, bypassed: bool },
    Eq { settings: EqSettings, bypassed: bool },
    Comp { settings: CompSettings, bypassed: bool },
    Shape { kind: ShapeKind, params: Vec<(String, f32)>, bypassed: bool },
    Prism { id: &'static str, params: Vec<(String, f32)>, sound: Option<String>, bypassed: bool },
}

impl SlotSpec {
    pub fn bypassed(&self) -> bool {
        match self {
            SlotSpec::Gain { bypassed, .. } | SlotSpec::Eq { bypassed, .. } | SlotSpec::Comp { bypassed, .. } | SlotSpec::Shape { bypassed, .. } | SlotSpec::Prism { bypassed, .. } => *bypassed,
        }
    }

    pub fn set_bypassed(&mut self, on: bool) {
        match self {
            SlotSpec::Gain { bypassed, .. } | SlotSpec::Eq { bypassed, .. } | SlotSpec::Comp { bypassed, .. } | SlotSpec::Shape { bypassed, .. } | SlotSpec::Prism { bypassed, .. } => *bypassed = on,
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            SlotSpec::Gain { .. } => "gain",
            SlotSpec::Eq { .. } => "eq",
            SlotSpec::Comp { .. } => "comp",
            SlotSpec::Shape { kind, .. } => kind.as_str(),
            SlotSpec::Prism { id, .. } => mgl_fx::prism::kind(id).unwrap_or("prism:"),
        }
    }

    pub fn take_settings_from(&mut self, other: &SlotSpec) -> bool {
        match (self, other) {
            (SlotSpec::Gain { db, .. }, SlotSpec::Gain { db: d, .. }) => *db = *d,
            (SlotSpec::Eq { settings, .. }, SlotSpec::Eq { settings: o, .. }) => *settings = *o,
            (SlotSpec::Comp { settings, .. }, SlotSpec::Comp { settings: o, .. }) => *settings = *o,
            (SlotSpec::Shape { kind, params, .. }, SlotSpec::Shape { kind: k, params: pr, .. }) => {
                if kind != k {
                    return false;
                }
                *params = pr.clone();
            }
            (SlotSpec::Prism { id, params, sound, .. }, SlotSpec::Prism { id: i, params: pr, sound: so, .. }) => {
                if id != i {
                    return false;
                }
                *params = pr.clone();
                *sound = so.clone();
            }
            _ => return false,
        }
        true
    }

    pub fn kind_label(&self) -> &'static str {
        match self {
            SlotSpec::Gain { .. } => "Gain",
            SlotSpec::Eq { .. } => "EQ",
            SlotSpec::Comp { .. } => "Compressor",
            SlotSpec::Shape { kind, .. } => kind.label(),
            SlotSpec::Prism { id, .. } => mgl_fx::prism::descriptor(id).map_or("Effect", |d| d.label),
        }
    }

    /// Every control the slot has, with its value now: (key, label, min, max, value).
    pub fn controls(&self) -> Vec<(String, String, f32, f32, f32)> {
        let mut out = Vec::new();
        match self {
            SlotSpec::Gain { db, .. } => out.push(("db".into(), "Gain".into(), mgl_fx::GAIN_DB_MIN, mgl_fx::GAIN_DB_MAX, *db)),
            SlotSpec::Eq { settings, .. } => {
                for spec in mgl_fx::prism::specs("eq").unwrap_or(&[]) {
                    if let Some(v) = get_eq_param(settings, spec.key) {
                        out.push((spec.key.to_string(), spec.label.to_string(), spec.min, spec.max, v));
                    }
                }
            }
            SlotSpec::Comp { settings, .. } => {
                for spec in mgl_fx::prism::specs("compressor").unwrap_or(&[]) {
                    if let Some(v) = get_comp_param(settings, spec.key) {
                        out.push((spec.key.to_string(), spec.label.to_string(), spec.min, spec.max, v));
                    }
                }
            }
            SlotSpec::Shape { kind, params, .. } => {
                for spec in kind.specs() {
                    let v = params.iter().find(|(k, _)| k == spec.key).map_or(spec.default, |(_, v)| *v);
                    out.push((spec.key.to_string(), spec.label.to_string(), spec.min, spec.max, v));
                }
            }
            SlotSpec::Prism { id, params, .. } => {
                for spec in mgl_fx::prism::specs(id).unwrap_or(&[]) {
                    let v = params.iter().find(|(k, _)| k == spec.key).map_or(spec.default, |(_, v)| *v);
                    out.push((spec.key.to_string(), spec.label.to_string(), spec.min, spec.max, v));
                }
            }
        }
        out
    }
}

fn master_to_json(m: &MasterSettings) -> Value {
    json!({ "on": m.on, "amount": m.amount as f64, "autoLevel": m.auto_level, "autoComp": m.auto_comp, "ceilingDb": m.ceiling_db as f64 })
}

fn master_from_json(v: Option<&Value>) -> MasterSettings {
    let d = MasterSettings::default();
    let Some(v) = v else { return d };
    MasterSettings {
        on: flag(v.get("on")),
        amount: num(v.get("amount"), d.amount).clamp(0.0, 1.0),
        auto_level: !matches!(v.get("autoLevel"), Some(Value::Bool(false))),
        auto_comp: !matches!(v.get("autoComp"), Some(Value::Bool(false))),
        ceiling_db: num(v.get("ceilingDb"), d.ceiling_db).clamp(-24.0, 0.0),
    }
}

fn num(v: Option<&Value>, default: f32) -> f32 {
    match v.and_then(Value::as_f64) {
        Some(n) if n.is_finite() => n as f32,
        _ => default,
    }
}

fn flag(v: Option<&Value>) -> bool {
    matches!(v, Some(Value::Bool(true)))
}

fn band_from(v: Option<&Value>, d: Band) -> Band {
    match v {
        Some(b) => Band {
            freq: num(b.get("freq"), d.freq).clamp(10.0, 24000.0),
            q: num(b.get("q"), d.q).clamp(0.05, 18.0),
            gain_db: num(b.get("gainDb"), d.gain_db).clamp(-24.0, 24.0),
        },
        None => d,
    }
}

fn band_json(b: &Band) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("freq".into(), json!(b.freq as f64));
    m.insert("q".into(), json!(b.q as f64));
    m.insert("gainDb".into(), json!(b.gain_db as f64));
    m
}

impl Default for RackSpec {
    fn default() -> Self {
        RackSpec::default_chain()
    }
}

impl RackSpec {
    pub fn empty() -> Self {
        RackSpec {
            slots: Vec::new(),
            slot_ids: Vec::new(),
            master: MasterSettings::default(),
            pads: BTreeMap::new(),
            pitch_time: Default::default(),
            post_roll: BTreeMap::new(),
            ranges: BTreeMap::new(),
            mixes: BTreeMap::new(),
            modules: BTreeMap::new(),
        }
    }

    /// The rack a file starts with: an EQ and a compressor, both on and inert.
    pub fn default_chain() -> Self {
        RackSpec {
            slots: vec![
                SlotSpec::Eq { settings: EqSettings::default(), bypassed: false },
                SlotSpec::Comp { settings: CompSettings { ratio: 1.0, ..CompSettings::default() }, bypassed: false },
            ],
            slot_ids: vec!["factory-eq".into(), "factory-comp".into()],
            ..RackSpec::empty()
        }
    }

    pub fn from_json(v: &Value) -> Self {
        let master = master_from_json(v.get("master"));
        let Some(items) = v.get("slots").and_then(Value::as_array) else {
            return RackSpec { master, ..RackSpec::empty() };
        };
        let mut slots = Vec::new();
        let mut slot_ids = Vec::new();
        let mut mixes = BTreeMap::new();
        let mut modules = BTreeMap::new();
        for (index, it) in items.iter().enumerate() {
            let stored = it.get("kind").and_then(Value::as_str).unwrap_or("");
            let keeper;
            let suite = it.get("suite").and_then(Value::as_str).or_else(|| stored.strip_prefix("suite:"));
            let kind = match suite {
                None => stored,
                Some(s) => match it.get("mode").and_then(Value::as_str).and_then(|m| prism_fx_suite::find_mode(s, m)) {
                    Some(m) if mgl_fx::suite::mode_of_kind(stored).is_some_and(|(_, x)| x.id == m.id && x.kernel == m.kernel) => stored,
                    Some(m) => {
                        keeper = mgl_fx::suite::keeper_kind(m);
                        keeper.as_str()
                    }
                    None => "",
                },
            };
            let bypassed = flag(it.get("bypassed"));
            let id = it.get("id").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string).unwrap_or_else(|| format!("legacy-{stored}-{index}"));
            let before = slots.len();
            match kind {
                "gain" => slots.push(SlotSpec::Gain { db: num(it.get("db"), 0.0).clamp(-48.0, 48.0), bypassed }),
                "eq" => {
                    let mut d = EqSettings::default();
                    if let Some(bands) = it.get("bands").and_then(Value::as_array) {
                        let base = d.bands();
                        for (i, value) in bands.iter().take(8).enumerate() {
                            let b = band_from(Some(value), base[i]);
                            match i {
                                0 => d.high_pass_hz = num(value.get("freq"), 0.0).clamp(0.0, mgl_fx::eq::EQ_FREQ_MAX),
                                1 => d.low = b,
                                2 => d.mid = b,
                                3..=5 => d.extra[i - 3] = b,
                                6 => d.high = b,
                                _ => d.low_pass_hz = b.freq,
                            }
                            d.modes[i] = eq_mode(value.get("type").and_then(Value::as_str).unwrap_or("bell"));
                            d.enabled[i] = flag(value.get("enabled"));
                        }
                    } else {
                        d.low = band_from(it.get("low"), d.low);
                        d.mid = band_from(it.get("mid"), d.mid);
                        d.high = band_from(it.get("high"), d.high);
                        d.high_pass_hz = num(it.get("highPassHz"), 0.0).clamp(0.0, 24000.0);
                        d.enabled[0] = d.high_pass_hz > mgl_fx::eq::EQ_HP_OFF;
                    }
                    slots.push(SlotSpec::Eq { settings: d, bypassed })
                }
                "comp" => {
                    let d = CompSettings::default();
                    slots.push(SlotSpec::Comp {
                        settings: CompSettings {
                            threshold_db: num(it.get("thresholdDb"), d.threshold_db).clamp(-60.0, 0.0),
                            ratio: num(it.get("ratio"), d.ratio).clamp(1.0, 20.0),
                            attack_ms: num(it.get("attackMs"), d.attack_ms).clamp(0.05, 500.0),
                            release_ms: num(it.get("releaseMs"), d.release_ms).clamp(5.0, 3000.0),
                            knee_db: num(it.get("kneeDb"), d.knee_db).clamp(0.0, 24.0),
                            makeup_db: num(it.get("makeupDb"), d.makeup_db).clamp(-24.0, 24.0),
                        },
                        bypassed,
                    })
                }
                other if mgl_fx::prism::id_for_kind(other).is_some() => {
                    let id = mgl_fx::prism::id_for_kind(other).unwrap_or_default();
                    let mut params = Vec::new();
                    for spec in mgl_fx::prism::specs(id).unwrap_or_default() {
                        let v = num(it.get("params").and_then(|p| p.get(spec.key)), spec.default);
                        params.push((spec.key.to_string(), mgl_fx::prism::clamp(id, spec.key, v).unwrap_or(v)));
                    }
                    let sound = mgl_fx::prism::sound_input(id).and(it.get("sound").and_then(Value::as_str)).filter(|p| !p.is_empty()).map(str::to_string);
                    slots.push(SlotSpec::Prism { id, params, sound, bypassed });
                }
                other => {
                    if let Some(k) = ShapeKind::from_str(other) {
                        let mut params = Vec::new();
                        for spec in k.specs() {
                            let v = num(it.get("params").and_then(|p| p.get(spec.key)), spec.default);
                            params.push((spec.key.to_string(), spec.clamp(v)));
                        }
                        slots.push(SlotSpec::Shape { kind: k, params, bypassed });
                    }
                }
            }
            if slots.len() > before {
                let mix = SlotMix {
                    wet: num(it.get("wet"), 1.0).clamp(0.0, 1.0),
                    level: num(it.get("level"), 0.0).clamp(mgl_fx::SLOT_LEVEL_MIN, mgl_fx::SLOT_LEVEL_MAX),
                };
                if mix != SlotMix::default() {
                    mixes.insert(id.clone(), mix);
                }
                let module = SlotModule {
                    rev: it.get("rev").and_then(Value::as_f64).filter(|n| n.is_finite() && *n >= 2.0 && *n <= u16::MAX as f64).map(|n| n as u16),
                    memory: it.get("memory").filter(|m| m.is_object()).cloned(),
                    face: match it.get("face").and_then(Value::as_str) {
                        Some("mgl") => Some("mgl"),
                        Some("original") => Some("original"),
                        _ => None,
                    },
                    place: it.get("place").and_then(place_from).filter(|_| slots.last().is_some_and(|s: &SlotSpec| is_reverb(s.kind()))),
                };
                if module != SlotModule::default() {
                    modules.insert(id.clone(), module);
                }
                slot_ids.push(id);
            }
        }
        let mut spec = RackSpec { slots, slot_ids, master, pitch_time: pitch_time_from_json(v.get("pitchTime")), mixes, modules, ..RackSpec::empty() };
        if let Some(m) = v.get("pads").and_then(Value::as_object) {
            for (id, setup) in m {
                if id == PAD_STRETCH || id == PAD_PITCH_TIME || spec.slot_ids.contains(id) {
                    spec.pads.insert(id.clone(), setup.clone());
                }
            }
        }
        if let Some(m) = v.get("ranges").and_then(Value::as_object) {
            for (id, keys) in m {
                let (true, Some(keys)) = (spec.slot_ids.contains(id), keys.as_object()) else { continue };
                let mut out = BTreeMap::new();
                for (key, r) in keys {
                    let (Some(lo), Some(hi)) = (r.get("min").and_then(Value::as_f64), r.get("max").and_then(Value::as_f64)) else { continue };
                    if !lo.is_finite() || !hi.is_finite() || hi <= lo {
                        continue;
                    }
                    let log = matches!(r.get("log"), Some(Value::Bool(true)));
                    out.insert(key.clone(), KnobRange { min: lo as f32, max: hi as f32, log });
                }
                if !out.is_empty() {
                    spec.ranges.insert(id.clone(), out);
                }
            }
        }
        if let Some(m) = v.get("postRoll").and_then(Value::as_object) {
            for (id, ms) in m {
                let known = id == PAD_STRETCH || id == PAD_PITCH_TIME || spec.slot_ids.contains(id);
                if let (true, Some(n)) = (known, ms.as_f64()) {
                    if n.is_finite() {
                        spec.post_roll.insert(id.clone(), (n as f32).max(0.0));
                    }
                }
            }
        }
        spec
    }

    pub fn to_json(&self) -> Value {
        let slots: Vec<Value> = self
            .slots
            .iter()
            .enumerate()
            .map(|(i, s)| {
                let mut base = Map::new();
                base.insert("kind".into(), json!(s.kind()));
                base.insert("id".into(), json!(self.slot_ids.get(i).cloned().unwrap_or_default()));
                base.insert("bypassed".into(), json!(s.bypassed()));
                if let Some(m) = self.slot_ids.get(i).and_then(|id| self.mixes.get(id)) {
                    base.insert("wet".into(), json!(m.wet as f64));
                    base.insert("level".into(), json!(m.level as f64));
                }
                let module = self.slot_ids.get(i).and_then(|id| self.modules.get(id));
                if let Some((suite, mode)) = mgl_fx::suite::mode_of_kind(s.kind()) {
                    base.insert("suite".into(), json!(suite.id));
                    base.insert("mode".into(), json!(mode.id));
                    base.insert("rev".into(), json!(module.and_then(|m| m.rev).unwrap_or(1) as f64));
                }
                if let Some(mem) = module.and_then(|m| m.memory.clone()) {
                    base.insert("memory".into(), mem);
                }
                if let Some(face) = module.and_then(|m| m.face) {
                    base.insert("face".into(), json!(face));
                }
                if let Some(place) = module.and_then(|m| m.place.as_ref()) {
                    base.insert("place".into(), place_json(place));
                }
                match s {
                    SlotSpec::Gain { db, .. } => {
                        base.insert("db".into(), json!(*db as f64));
                    }
                    SlotSpec::Eq { settings, .. } => {
                        let bands = settings.bands();
                        base.insert("low".into(), Value::Object(band_json(&settings.low)));
                        base.insert("mid".into(), Value::Object(band_json(&settings.mid)));
                        base.insert("high".into(), Value::Object(band_json(&settings.high)));
                        base.insert("highPassHz".into(), json!(settings.high_pass_hz as f64));
                        let list = (0..8)
                            .map(|i| {
                                let mut b = band_json(&bands[i]);
                                b.insert("type".into(), json!(eq_mode_name(settings.modes[i])));
                                b.insert("enabled".into(), json!(settings.enabled[i]));
                                Value::Object(b)
                            })
                            .collect();
                        base.insert("bands".into(), Value::Array(list));
                    }
                    SlotSpec::Comp { settings, .. } => {
                        base.insert("thresholdDb".into(), json!(settings.threshold_db as f64));
                        base.insert("ratio".into(), json!(settings.ratio as f64));
                        base.insert("attackMs".into(), json!(settings.attack_ms as f64));
                        base.insert("releaseMs".into(), json!(settings.release_ms as f64));
                        base.insert("kneeDb".into(), json!(settings.knee_db as f64));
                        base.insert("makeupDb".into(), json!(settings.makeup_db as f64));
                    }
                    SlotSpec::Shape { params, .. } | SlotSpec::Prism { params, .. } => {
                        let mut p = Map::new();
                        for (k, v) in params {
                            p.insert(k.clone(), json!(*v as f64));
                        }
                        if let SlotSpec::Prism { sound: Some(path), .. } = s {
                            base.insert("sound".into(), json!(path));
                        }
                        base.insert("params".into(), Value::Object(p));
                    }
                }
                Value::Object(base)
            })
            .collect();
        let mut o = Map::new();
        o.insert("slots".into(), Value::Array(slots));
        o.insert("pads".into(), Value::Object(self.pads.iter().map(|(k, v)| (k.clone(), v.clone())).collect()));
        o.insert("pitchTime".into(), pitch_time_to_json(&self.pitch_time));
        o.insert("postRoll".into(), Value::Object(self.post_roll.iter().map(|(k, v)| (k.clone(), json!(*v as f64))).collect()));
        o.insert(
            "ranges".into(),
            Value::Object(
                self.ranges
                    .iter()
                    .map(|(id, keys)| (id.clone(), Value::Object(keys.iter().map(|(k, r)| (k.clone(), json!({ "min": r.min as f64, "max": r.max as f64, "log": r.log }))).collect())))
                    .collect(),
            ),
        );
        o.insert("master".into(), master_to_json(&self.master));
        o.insert("active".into(), json!(self.is_active()));
        Value::Object(o)
    }

    pub fn post_roll_ms(&self) -> f32 {
        self.post_roll.values().fold(0.0f32, |m, v| m.max(*v))
    }

    pub fn is_active(&self) -> bool {
        if self.master.is_active() {
            return true;
        }
        let trimmed = self.slots.iter().enumerate().any(|(i, s)| !s.bypassed() && self.slot_ids.get(i).is_some_and(|id| self.mixes.contains_key(id)));
        if trimmed {
            return true;
        }
        self.slots.iter().any(|s| match s {
            SlotSpec::Gain { db, bypassed } => !bypassed && db.abs() > 1e-6,
            SlotSpec::Eq { settings, bypassed } => {
                !bypassed && (settings.low.gain_db.abs() > 1e-6 || settings.mid.gain_db.abs() > 1e-6 || settings.high.gain_db.abs() > 1e-6 || settings.high_pass_hz > 20.0)
            }
            SlotSpec::Comp { settings, bypassed } => !bypassed && settings.ratio > 1.0,
            SlotSpec::Shape { bypassed, .. } | SlotSpec::Prism { bypassed, .. } => !bypassed,
        })
    }

    pub fn build_slot(&self, index: usize, sample_rate: u32, channels: usize) -> Box<dyn mgl_fx::Effect> {
        let Some(s) = self.slots.get(index) else { return Box::new(Gain { db: 0.0 }) };
        match s {
            SlotSpec::Gain { db, .. } if db.abs() <= mgl_fx::GAIN_DB_MAX => moved("gain", sample_rate, &[("db".to_string(), *db)], || Box::new(Gain { db: *db })),
            SlotSpec::Gain { db, .. } => Box::new(Gain { db: *db }),
            SlotSpec::Eq { settings, .. } => moved("eq", sample_rate, &eq_params(settings), || Box::new(Eq::with_channels(*settings, channels))),
            SlotSpec::Comp { settings, .. } => moved("compressor", sample_rate, &comp_params(settings), || Box::new(Compressor::new(*settings))),
            SlotSpec::Shape { kind, params, .. } => mgl_fx::shape::make(*kind, sample_rate, channels, params),
            SlotSpec::Prism { id, params, sound, .. } => mgl_fx::prism::make_with_sound(id, sample_rate, channels, params, sound.as_deref()).unwrap_or_else(|| Box::new(Gain { db: 0.0 })),
        }
    }

    pub fn build(&self, sample_rate: u32, channels: usize) -> Rack {
        let mut rack = Rack::with_capacity(MAX_BLOCK * channels.max(1));
        for (i, s) in self.slots.iter().enumerate() {
            let effect = self.build_slot(i, sample_rate, channels);
            rack.push_slot(effect, s.bypassed());
            if is_reverb(s.kind()) {
                let settings = self.slot_ids.get(i).and_then(|id| self.modules.get(id)).and_then(|m| m.place).unwrap_or(mgl_fx::prism::prism_fx::place::PlaceSettings { on: false, ..Default::default() });
                let mut place = Box::new(mgl_fx::prism::prism_fx::place::Place::new(sample_rate as f32));
                place.set(settings);
                rack.set_slot_place(rack.slots.len() - 1, Some(place));
            }
        }
        for (i, id) in self.slot_ids.iter().enumerate() {
            if let (Some(m), Some(slot)) = (self.mixes.get(id), rack.slots.get_mut(i)) {
                slot.set_mix(m.wet, m.level);
            }
        }
        if self.master.is_active() {
            let master = self.master;
            rack.push(moved("maximizer", sample_rate, &master_params(&master), || Box::new(Maximizer::new(master))));
        }
        rack
    }

    pub fn set_param(&mut self, slot: usize, key: &str, value: f32) -> bool {
        if key == mgl_fx::SLOT_WET || key == mgl_fx::SLOT_LEVEL {
            return self.set_mix(slot, key, value);
        }
        if key.starts_with("place.") {
            let (Some(s), Some(id)) = (self.slots.get(slot), self.slot_ids.get(slot).cloned()) else { return false };
            if !is_reverb(s.kind()) {
                return false;
            }
            let module = self.modules.entry(id).or_default();
            let mut p = module.place.unwrap_or(mgl_fx::prism::prism_fx::place::PlaceSettings { on: false, ..Default::default() });
            if !mgl_fx::place_set(&mut p, key, value) {
                return false;
            }
            module.place = Some(p);
            return true;
        }
        let Some(s) = self.slots.get_mut(slot) else { return false };
        match s {
            SlotSpec::Gain { db, .. } if key == "db" => {
                *db = value.clamp(mgl_fx::GAIN_DB_MIN, mgl_fx::GAIN_DB_MAX);
                true
            }
            SlotSpec::Eq { settings, .. } => set_eq_param(settings, key, value),
            SlotSpec::Comp { settings, .. } => set_comp_param(settings, key, value),
            SlotSpec::Shape { kind, params, .. } => {
                let Some(spec) = kind.specs().iter().find(|p| p.key == key) else { return false };
                let v = spec.clamp(value);
                match params.iter_mut().find(|(k, _)| k == key) {
                    Some(entry) => entry.1 = v,
                    None => params.push((key.to_string(), v)),
                }
                true
            }
            SlotSpec::Prism { id, params, .. } => {
                let Some(v) = mgl_fx::prism::clamp(id, key, value) else { return false };
                match params.iter_mut().find(|(k, _)| k == key) {
                    Some(entry) => entry.1 = v,
                    None => params.push((key.to_string(), v)),
                }
                true
            }
            _ => false,
        }
    }

    fn set_mix(&mut self, slot: usize, key: &str, value: f32) -> bool {
        let Some(id) = self.slot_ids.get(slot).filter(|_| slot < self.slots.len()).cloned() else { return false };
        let mut m = self.mixes.get(&id).copied().unwrap_or_default();
        if key == mgl_fx::SLOT_WET {
            m.wet = value.clamp(0.0, 1.0);
        } else {
            m.level = value.clamp(mgl_fx::SLOT_LEVEL_MIN, mgl_fx::SLOT_LEVEL_MAX);
        }
        if m == SlotMix::default() {
            self.mixes.remove(&id);
        } else {
            self.mixes.insert(id, m);
        }
        true
    }

    pub fn get_param(&self, slot: usize, key: &str) -> Option<f32> {
        if key.starts_with("place.") {
            if !is_reverb(self.slots.get(slot)?.kind()) {
                return None;
            }
            let p = self.slot_ids.get(slot).and_then(|id| self.modules.get(id)).and_then(|m| m.place).unwrap_or(mgl_fx::prism::prism_fx::place::PlaceSettings { on: false, ..Default::default() });
            return mgl_fx::place_get(&p, key);
        }
        if key == mgl_fx::SLOT_WET || key == mgl_fx::SLOT_LEVEL {
            let m = self.slot_ids.get(slot).and_then(|id| self.mixes.get(id)).copied().unwrap_or_default();
            return Some(if key == mgl_fx::SLOT_WET { m.wet } else { m.level });
        }
        match self.slots.get(slot)? {
            SlotSpec::Gain { db, .. } if key == "db" => Some(*db),
            SlotSpec::Eq { settings, .. } => get_eq_param(settings, key),
            SlotSpec::Comp { settings, .. } => get_comp_param(settings, key),
            SlotSpec::Shape { params, .. } | SlotSpec::Prism { params, .. } => params.iter().find(|(k, _)| k == key).map(|(_, v)| *v),
            _ => None,
        }
    }

    /// A new slot of `kind` with its defaults, as the rack's add menu makes
    /// one (`renderFxPicker` then `/api/rack`): at the end, or before `at`.
    pub fn insert(&mut self, kind: &str, at: Option<usize>) -> bool {
        let id = format!("{}-{:x}", kind.replace(':', "-"), fresh_id(&self.slot_ids));
        let one = json!({ "slots": [{ "kind": kind, "id": id }] });
        let made = RackSpec::from_json(&one);
        let Some(slot) = made.slots.into_iter().next() else { return false };
        let at = at.unwrap_or(self.slots.len()).min(self.slots.len());
        self.slots.insert(at, slot);
        self.slot_ids.insert(at, id);
        true
    }

    pub fn remove(&mut self, at: usize) -> bool {
        if at >= self.slots.len() {
            return false;
        }
        self.slots.remove(at);
        let id = self.slot_ids.remove(at);
        self.mixes.remove(&id);
        self.modules.remove(&id);
        self.ranges.remove(&id);
        self.pads.remove(&id);
        self.post_roll.remove(&id);
        true
    }

    pub fn reorder(&mut self, from: usize, to: usize) -> bool {
        if from >= self.slots.len() || to >= self.slots.len() {
            return false;
        }
        let s = self.slots.remove(from);
        let id = self.slot_ids.remove(from);
        self.slots.insert(to, s);
        self.slot_ids.insert(to, id);
        true
    }
}

/// A slot name not in `ids`.
fn fresh_id(ids: &[String]) -> u64 {
    let mut n = ids.len() as u64 + 1;
    while ids.iter().any(|x| x.ends_with(&format!("-{n:x}"))) {
        n += 1;
    }
    n
}

fn pitch_time_from_json(v: Option<&Value>) -> PitchTime {
    merge_pitch_time(PitchTime::default(), v)
}

pub fn merge_pitch_time(base: PitchTime, v: Option<&Value>) -> PitchTime {
    let d = base;
    let Some(v) = v else { return d };
    let n = |k: &str, def: f32, lo: f32, hi: f32| match v.get(k).and_then(Value::as_f64) {
        Some(x) if x.is_finite() => (x as f32).clamp(lo, hi),
        _ => def,
    };
    PitchTime {
        on: match v.get("on") {
            Some(Value::Bool(b)) => *b,
            _ => d.on,
        },
        speed: n("speed", d.speed, 1.0, 200.0),
        pitch: n("pitch", d.pitch, 0.0, 200.0),
        feedback: n("feedback", d.feedback, 0.0, 100.0),
        grain: n("grain", d.grain, 1.0, 100.0),
        xfade: n("xfade", d.xfade, 0.0, 100.0),
        smoothing: n("smoothing", d.smoothing, 0.0, 100.0),
    }
}

pub fn pitch_time_to_json(p: &PitchTime) -> Value {
    json!({
        "on": p.on, "speed": p.speed as f64, "pitch": p.pitch as f64, "feedback": p.feedback as f64,
        "grain": p.grain as f64, "xfade": p.xfade as f64, "smoothing": p.smoothing as f64,
    })
}

fn set_eq_param(s: &mut EqSettings, key: &str, v: f32) -> bool {
    use mgl_fx::eq::*;
    let Some((i, field)) = eq_key(key) else { return false };
    if field == "enabled" {
        s.enabled[i] = v >= 0.5;
        return true;
    }
    if field == "mode" {
        s.modes[i] = eq_mode_from_index(v);
        return true;
    }
    let mut bands = s.bands();
    match field {
        "freq" => bands[i].freq = v.clamp(EQ_FREQ_MIN, EQ_FREQ_MAX),
        "q" => bands[i].q = v.clamp(EQ_Q_MIN, EQ_Q_MAX),
        "gainDb" => bands[i].gain_db = v.clamp(EQ_GAIN_MIN, EQ_GAIN_MAX),
        _ => return false,
    }
    match i {
        0 => s.high_pass_hz = bands[0].freq,
        1 => s.low = bands[1],
        2 => s.mid = bands[2],
        3..=5 => s.extra[i - 3] = bands[i],
        6 => s.high = bands[6],
        _ => s.low_pass_hz = bands[7].freq,
    }
    true
}

fn moved(id: &str, sample_rate: u32, params: &[(String, f32)], own: impl FnOnce() -> Box<dyn mgl_fx::Effect>) -> Box<dyn mgl_fx::Effect> {
    match mgl_fx::prism::moved(id, sample_rate, params) {
        Some(e) if params.iter().all(|(k, v)| e.get_param(k).map(f32::to_bits) == Some(v.to_bits())) => e,
        _ => own(),
    }
}

fn keyed(id: &str, get: impl Fn(&str) -> Option<f32>) -> Vec<(String, f32)> {
    mgl_fx::prism::specs(id).unwrap_or(&[]).iter().filter_map(|spec| get(spec.key).map(|v| (spec.key.to_string(), v))).collect()
}

fn eq_params(s: &EqSettings) -> Vec<(String, f32)> {
    keyed("eq", |key| get_eq_param(s, key))
}

fn comp_params(s: &CompSettings) -> Vec<(String, f32)> {
    keyed("compressor", |key| get_comp_param(s, key))
}

fn master_params(m: &MasterSettings) -> Vec<(String, f32)> {
    use mgl_fx::params::Params;
    let built = Maximizer::new(*m);
    keyed("maximizer", |key| built.get(key))
}

pub fn get_eq_param(s: &EqSettings, key: &str) -> Option<f32> {
    let (i, field) = eq_key(key)?;
    let b = s.bands()[i];
    Some(match field {
        "freq" => b.freq,
        "q" => b.q,
        "gainDb" => b.gain_db,
        "enabled" => s.enabled[i] as u8 as f32,
        "mode" => eq_mode_index(s.modes[i]),
        _ => return None,
    })
}

fn eq_key(key: &str) -> Option<(usize, &str)> {
    let rest = key.strip_prefix("band.")?;
    let (i, field) = rest.split_once('.')?;
    let i = i.parse::<usize>().ok().filter(|i| *i < 8)?;
    Some((i, field))
}

fn eq_mode(name: &str) -> mgl_fx::eq::EqMode {
    use mgl_fx::eq::EqMode::*;
    match name {
        "highpass" => HighPass,
        "lowshelf" => LowShelf,
        "notch" => Notch,
        "highshelf" => HighShelf,
        "lowpass" => LowPass,
        _ => Bell,
    }
}

fn eq_mode_name(m: mgl_fx::eq::EqMode) -> &'static str {
    use mgl_fx::eq::EqMode::*;
    match m {
        HighPass => "highpass",
        LowShelf => "lowshelf",
        Bell => "bell",
        Notch => "notch",
        HighShelf => "highshelf",
        LowPass => "lowpass",
    }
}

fn eq_mode_index(m: mgl_fx::eq::EqMode) -> f32 {
    use mgl_fx::eq::EqMode::*;
    match m {
        HighPass => 0.0,
        LowShelf => 1.0,
        Bell => 2.0,
        Notch => 3.0,
        HighShelf => 4.0,
        LowPass => 5.0,
    }
}

fn eq_mode_from_index(v: f32) -> mgl_fx::eq::EqMode {
    use mgl_fx::eq::EqMode::*;
    match v.round() as i32 {
        0 => HighPass,
        1 => LowShelf,
        3 => Notch,
        4 => HighShelf,
        5 => LowPass,
        _ => Bell,
    }
}

fn set_comp_param(s: &mut CompSettings, key: &str, v: f32) -> bool {
    use mgl_fx::comp::*;
    match key {
        "thresholdDb" => s.threshold_db = v.clamp(COMP_THRESHOLD_MIN, 0.0),
        "ratio" => s.ratio = v.clamp(COMP_RATIO_MIN, COMP_RATIO_MAX),
        "attackMs" => s.attack_ms = v.clamp(COMP_ATTACK_MIN, COMP_ATTACK_MAX),
        "releaseMs" => s.release_ms = v.clamp(COMP_RELEASE_MIN, COMP_RELEASE_MAX),
        "kneeDb" => s.knee_db = v.clamp(0.0, COMP_KNEE_MAX),
        "makeupDb" => s.makeup_db = v.clamp(COMP_MAKEUP_MIN, COMP_MAKEUP_MAX),
        _ => return false,
    }
    true
}

pub fn get_comp_param(s: &CompSettings, key: &str) -> Option<f32> {
    Some(match key {
        "thresholdDb" => s.threshold_db,
        "ratio" => s.ratio,
        "attackMs" => s.attack_ms,
        "releaseMs" => s.release_ms,
        "kneeDb" => s.knee_db,
        "makeupDb" => s.makeup_db,
        _ => return None,
    })
}

/// `automation::resolve`: a rack control's value at `unit` of its travel.
pub fn resolve(slot: &SlotSpec, key: &str, unit: f32) -> Option<f32> {
    let lerp = |a: f32, b: f32| a + (b - a) * unit;
    let log = |a: f32, b: f32| (a.ln() + (b.ln() - a.ln()) * unit.clamp(0.0, 1.0)).exp();
    Some(match slot {
        SlotSpec::Gain { .. } if key == "db" => lerp(mgl_fx::GAIN_DB_MIN, mgl_fx::GAIN_DB_MAX),
        SlotSpec::Eq { .. } => {
            use mgl_fx::eq::*;
            match key.rsplit_once('.')?.1 {
                "freq" => log(EQ_FREQ_MIN, EQ_FREQ_MAX),
                "q" => log(EQ_Q_MIN, EQ_Q_MAX),
                "gainDb" => lerp(EQ_GAIN_MIN, EQ_GAIN_MAX),
                "enabled" => lerp(0.0, 1.0),
                "mode" => lerp(0.0, 5.0),
                _ => return None,
            }
        }
        SlotSpec::Comp { .. } => {
            use mgl_fx::comp::*;
            match key {
                "thresholdDb" => lerp(COMP_THRESHOLD_MIN, 0.0),
                "ratio" => lerp(COMP_RATIO_MIN, COMP_RATIO_MAX),
                "attackMs" => log(COMP_ATTACK_MIN, COMP_ATTACK_MAX),
                "releaseMs" => log(COMP_RELEASE_MIN, COMP_RELEASE_MAX),
                "kneeDb" => lerp(0.0, COMP_KNEE_MAX),
                "makeupDb" => lerp(COMP_MAKEUP_MIN, COMP_MAKEUP_MAX),
                _ => return None,
            }
        }
        SlotSpec::Shape { kind, .. } => kind.specs().iter().find(|p| p.key == key)?.from_unit(unit),
        SlotSpec::Prism { id, .. } => {
            let v = mgl_fx::prism::specs(id)?.iter().find(|p| p.key == key)?.from_unit(unit);
            mgl_fx::prism::clamp(id, key, v)?
        }
        _ => return None,
    })
}
