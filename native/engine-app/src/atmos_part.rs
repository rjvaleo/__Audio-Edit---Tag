//! Atmosphere on the canvas: MGL's Atmosphere page (`ui/sequencer/atmos.js`,
//! `atphys.js`, `atfx.js`) as one module of three engine modules:
//!
//! - k0, its physically modelled voice ([`engine_mgl::Atmos`]): notes in;
//! - k1, Character and Sympathy ([`engine_mgl::AtmosWebModule`]), with the
//!   voice into its audio input 1, as the page feeds `atIn`; it gets no notes
//!   (on the page the keys play only the physical voice);
//! - k2, its FX line ([`engine_mgl::Rack`]), whose output is the module's.
//!
//! The state is kept by the page's own keys and values: every knob of
//! `AT_KNOBS` by its id at its raw value (`atAtk` 0 to 100, say), the
//! selects by their values (`modelA` "pluck", `atL1Shape` "sine",
//! `tuneScale` "seq" or "3"), and `fx`, the chain as atfx.js keeps it. Each
//! change is turned into what the engines take exactly as the page does:
//! `atphysParams` for the voice, the raw `AT` values for Character and
//! Sympathy, `atKeyHz` for the tuning, the worklet's `chain` for the rack.
//! Only what changed is sent, as `atphysSend` does.

use crate::AppError;
use engine_core::{Controller, EventKind, ModuleId};
use engine_mgl::fxchain::{self, FxSlot};
use engine_mgl::{atmos, atmos_web, Atmos, AtmosView, AtmosWebModule, Rack, RackMeters, RackThing, Scope, Tuning};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::sync::{Arc, OnceLock};

/// The page's own lists, captured from it (`data/atmos-page.json`).
pub struct Page {
    /// `AT_KNOBS`: id, min, max, default.
    pub knobs: Vec<(String, f64, f64, f64)>,
    /// `AT_MODELS`: id and its four defaults.
    pub models: Vec<(String, [f64; 4])>,
    pub model_default: [String; 2],
    /// `AT_LFO_TARGETS`' ids, in order.
    pub lfo_targets: Vec<String>,
    /// `SCALES`' cents, in order.
    pub scales: Vec<Vec<f64>>,
    /// Seq's scale, root and octave as Seq starts: what "Same as Seq" is.
    pub seq: (usize, f64, f64),
    pub json: Value,
}

pub const PAGE_JSON: &str = include_str!("../data/atmos-page.json");

pub fn page() -> &'static Page {
    static PAGE: OnceLock<Page> = OnceLock::new();
    PAGE.get_or_init(|| {
        let json: Value = serde_json::from_str(PAGE_JSON).expect("atmos-page.json is JSON");
        let f = |v: &Value| v.as_f64().unwrap_or(0.0);
        let knobs = json["knobs"]
            .as_array()
            .map(|a| a.iter().map(|k| (k[0].as_str().unwrap_or("").to_string(), f(&k[2]), f(&k[3]), f(&k[4]))).collect())
            .unwrap_or_default();
        let models = json["models"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|m| {
                        let d = &m["d"];
                        (m["id"].as_str().unwrap_or("").to_string(), [f(&d[0]), f(&d[1]), f(&d[2]), f(&d[3])])
                    })
                    .collect()
            })
            .unwrap_or_default();
        let s = |v: &Value| v.as_str().unwrap_or("").to_string();
        let model_default = [s(&json["modelDefault"]["A"]), s(&json["modelDefault"]["B"])];
        let lfo_targets = json["lfoTargets"].as_array().map(|a| a.iter().map(|t| s(&t[0])).collect()).unwrap_or_default();
        let scales = json["scales"]
            .as_array()
            .map(|a| a.iter().map(|sc| sc["cents"].as_array().map(|c| c.iter().map(f).collect()).unwrap_or_default()).collect())
            .unwrap_or_default();
        let seq = (json["seq"]["scale"].as_u64().unwrap_or(0) as usize, f(&json["seq"]["root"]), f(&json["seq"]["octave"]));
        Page { knobs, models, model_default, lfo_targets, scales, seq, json }
    })
}

/// The selects the state keeps, and each one's value as the page starts.
fn select_defaults() -> Vec<(String, String)> {
    let p = page();
    let mut out = vec![("modelA".to_string(), p.model_default[0].clone()), ("modelB".to_string(), p.model_default[1].clone())];
    for n in 1..=3 {
        out.push((format!("atL{n}Shape"), "sine".into()));
        out.push((format!("atL{n}Target"), String::new()));
    }
    out.push(("symTune".into(), "degrees".into()));
    for k in ["tuneScale", "tuneRoot", "tuneOct"] {
        out.push((k.into(), "seq".into()));
    }
    out
}

/// `atExp`.
fn at_exp(v: f64, lo: f64, hi: f64) -> f64 {
    lo * (hi / lo).powf(v / 100.0)
}

/// The engine modules' numbers within the canvas module.
pub(crate) const VOICE: u32 = 0;
pub(crate) const WEB: u32 = 1;
pub(crate) const FX: u32 = 2;

/// Atmosphere's state, and what its engines were last told.
pub struct AtmosPart {
    knobs: BTreeMap<String, f64>,
    selects: BTreeMap<String, String>,
    /// The chain, as the page keeps it.
    fx: Vec<Value>,
    sent_voice: Vec<f32>,
    sent_web: Vec<f32>,
    tuning: Tuning,
    /// The rack laid now: for each of its slots the chain's slot it is, and
    /// its controls' keys in knob order.
    laid_from: Vec<usize>,
    laid_keys: Vec<Vec<String>>,
    pub view: Arc<AtmosView>,
    pub scope: Arc<Scope>,
    pub meters: Arc<RackMeters>,
}

impl AtmosPart {
    /// The page as it starts, or as `saved` (a state object) has it.
    pub fn new(saved: Option<&Value>) -> Result<AtmosPart, AppError> {
        let knobs = page().knobs.iter().map(|(id, _, _, d)| (id.clone(), *d)).collect();
        let selects = select_defaults().into_iter().collect();
        let mut part = AtmosPart {
            knobs,
            selects,
            fx: Vec::new(),
            sent_voice: vec![f32::NAN; atmos::KEYS.len()],
            sent_web: vec![f32::NAN; atmos_web::module::KEYS.len()],
            tuning: Tuning::default(),
            laid_from: Vec::new(),
            laid_keys: Vec::new(),
            view: AtmosView::new(),
            scope: Scope::new(),
            meters: Arc::new(RackMeters::new()),
        };
        if let Some(s) = saved {
            let o = s.as_object().ok_or_else(|| AppError::BadFile("Atmosphere's state must be an object".into()))?;
            for (k, v) in o {
                part.put(k, v, false);
            }
        }
        part.tuning = part.tuning_now();
        Ok(part)
    }

    /// Keep one key's value, as the page's control would hold it. `chosen`:
    /// a person chose it (a model card resets its oscillator's controls, the
    /// big knob opens the rest). False for a key it does not keep.
    fn put(&mut self, key: &str, v: &Value, chosen: bool) -> bool {
        if key == "fx" {
            let Some(a) = v.as_array() else { return false };
            self.fx = a.iter().filter(|s| s.get("kind").and_then(Value::as_str).is_some()).cloned().collect();
            return true;
        }
        if let Some((min, max)) = page().knobs.iter().find(|k| k.0 == key).map(|k| (k.1, k.2)) {
            let Some(x) = number(v) else { return false };
            // A range input of step 1.
            let x = x.round().clamp(min, max);
            self.knobs.insert(key.to_string(), x);
            if chosen && key == "atMacro" {
                self.macro_knob(x);
            }
            return true;
        }
        if self.selects.contains_key(key) {
            let s = match v {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.as_f64().map(|x| format!("{}", x as i64)).unwrap_or_default(),
                Value::Null => String::new(),
                _ => return false,
            };
            if chosen {
                if let Some(w) = key.strip_prefix("model") {
                    // atmos.js: choosing a card sets the model's defaults first.
                    if let Some((_, d)) = page().models.iter().find(|(id, _)| *id == s) {
                        for (i, x) in d.iter().enumerate() {
                            self.knobs.insert(format!("atM{w}{}", i + 1), *x);
                        }
                    }
                }
            }
            self.selects.insert(key.to_string(), s);
            return true;
        }
        false
    }

    /// `atmosMacro`: wider, longer and further away together.
    fn macro_knob(&mut self, v: f64) {
        let u = v / 100.0;
        let lerp = |a: f64, b: f64| (a + (b - a) * u).round();
        for (k, a, b) in [("atWidth", 30.0, 100.0), ("atDrift", 10.0, 60.0), ("atHold", 100.0, 300.0), ("atAir", 0.0, 40.0), ("atEns", 10.0, 60.0)] {
            self.knobs.insert(k.into(), lerp(a, b));
        }
    }

    fn v(&self, id: &str) -> f64 {
        self.knobs.get(id).copied().unwrap_or(0.0)
    }

    fn sel(&self, id: &str) -> &str {
        self.selects.get(id).map(String::as_str).unwrap_or("")
    }

    /// `atphysParams`: every control of the physical voice as it takes it.
    pub fn voice_params(&self) -> Vec<(&'static str, f32)> {
        let v = |id: &str| self.v(id);
        let p = page();
        let mut kv: Vec<(&'static str, f64)> = Vec::new();
        for (w, o) in [("A", 0usize), ("B", 1)] {
            let model = p.models.iter().position(|(id, _)| id == self.sel(&format!("model{w}"))).unwrap_or(0);
            let keys = [["a.model", "a.p0", "a.p1", "a.p2", "a.p3", "a.oct", "a.fine"], ["b.model", "b.p0", "b.p1", "b.p2", "b.p3", "b.oct", "b.fine"]][o];
            kv.push((keys[0], model as f64));
            for i in 1..=4 {
                kv.push((keys[i], v(&format!("atM{w}{i}")) / 100.0));
            }
            kv.push((keys[5], v(&format!("at{w}Oct"))));
            kv.push((keys[6], v(&format!("atM{w}Fine"))));
        }
        let flt_hz = |x: f64| at_exp(x, 30.0, 20000.0);
        let flt_q = |x: f64| 0.5 + (x / 100.0) * 14.5;
        kv.extend([
            ("blend", v("atBlend") / 100.0),
            ("unison", v("atUnison").min(3.0)),
            ("detune", v("atDetune")),
            ("width", v("atWidth") / 100.0),
            ("drift", v("atDrift") / 100.0),
            ("sub", v("atSub") / 100.0),
            ("air", v("atAir") / 100.0),
            ("glide", if v("atGlide") <= 0.0 { 0.0 } else { at_exp(v("atGlide"), 5.0, 2000.0) / 1000.0 }),
            ("atk", at_exp(v("atAtk"), 1.0, 10000.0) / 1000.0),
            ("dec", at_exp(v("atDec"), 1.0, 10000.0) / 1000.0),
            ("sus", v("atSus") / 100.0),
            ("rel", at_exp(v("atRel"), 10.0, 20000.0) / 1000.0),
            ("vol", v("atVol") / 100.0),
            ("flt.type", v("atFltType").round()),
            ("flt.cut", flt_hz(v("atFltCut"))),
            ("flt.q", flt_q(v("atFltRes"))),
            ("flt.key", v("atFltKey") / 100.0),
            ("flt.amt", v("atFltAmt") / 100.0),
            ("flt.atk", at_exp(v("atFltAtk"), 1.0, 10000.0) / 1000.0),
            ("flt.dec", at_exp(v("atFltDec"), 1.0, 10000.0) / 1000.0),
            ("flt.sus", v("atFltSus") / 100.0),
            ("flt.rel", at_exp(v("atFltRel"), 10.0, 20000.0) / 1000.0),
        ]);
        let lfo = [
            ["lfo1.shape", "lfo1.rate", "lfo1.depth", "lfo1.target"],
            ["lfo2.shape", "lfo2.rate", "lfo2.depth", "lfo2.target"],
            ["lfo3.shape", "lfo3.rate", "lfo3.depth", "lfo3.target"],
        ];
        for (n, keys) in (1..=3).zip(lfo) {
            let shape = match self.sel(&format!("atL{n}Shape")) {
                "triangle" => 1.0,
                "sawtooth" => 2.0,
                "square" => 3.0,
                _ => 0.0,
            };
            let target = p.lfo_targets.iter().position(|t| t == self.sel(&format!("atL{n}Target"))).unwrap_or(0);
            kv.push((keys[0], shape));
            kv.push((keys[1], at_exp(v(&format!("atL{n}Rate")), 0.02, 20.0)));
            kv.push((keys[2], v(&format!("atL{n}Depth")) / 100.0));
            kv.push((keys[3], target as f64));
        }
        kv.into_iter().map(|(k, x)| (k, x as f32)).collect()
    }

    /// What Character and Sympathy read: the page's raw values (`AT`), Sympathy's
    /// tuning by its number. Its root and scale go in the [`Tuning`].
    pub fn web_params(&self) -> Vec<(&'static str, f32)> {
        let mut kv = Vec::new();
        for &k in atmos_web::module::KEYS {
            if let Some(x) = self.knobs.get(k) {
                kv.push((k, *x as f32));
            }
        }
        let sym = match self.sel("symTune") {
            "fifths" => 1.0,
            "root" => 2.0,
            _ => 0.0,
        };
        kv.push(("symTune", sym));
        kv
    }

    /// `atScale` and `atRootMidi`, "Same as Seq" being Seq as it starts.
    pub fn tuning_now(&self) -> Tuning {
        let p = page();
        let pick = |key: &str| match self.sel(key) {
            "seq" | "" => None,
            s => s.parse::<f64>().ok(),
        };
        let scale = pick("tuneScale").map(|x| x as usize).filter(|i| *i < p.scales.len()).unwrap_or(p.seq.0);
        let root = pick("tuneRoot").unwrap_or(p.seq.1);
        let oct = pick("tuneOct").unwrap_or(p.seq.2);
        let cents = p.scales.get(scale).cloned().unwrap_or_else(|| vec![0.0]);
        Tuning::new(&cents, root + (oct + 1.0) * 12.0)
    }

    /// The chain, as the rack is built from it.
    fn slots(&self) -> Vec<FxSlot> {
        self.fx
            .iter()
            .map(|s| FxSlot {
                kind: s.get("kind").and_then(Value::as_str).unwrap_or("").to_string(),
                on: s.get("on").map(truthy).unwrap_or(true),
                params: s
                    .get("params")
                    .and_then(Value::as_object)
                    .map(|o| o.iter().filter_map(|(k, v)| number(v).map(|x| (k.clone(), x as f32))).collect())
                    .unwrap_or_default(),
                wet: s.get("wet").and_then(number).map(|x| x as f32),
                level: s.get("level").and_then(number).map(|x| x as f32),
            })
            .collect()
    }

    /// The physical voice as a new module, told everything.
    pub fn voice_module(&mut self, rate: f32) -> Atmos {
        let mut m = Atmos::with_view(rate, self.view.clone()).tuned(self.tuning.clone());
        for (k, x) in self.voice_params() {
            m = m.set(k, x);
            if let Some(i) = atmos::knob(k) {
                self.sent_voice[i as usize] = x;
            }
        }
        m
    }

    /// Character and Sympathy as a new module, told everything.
    pub fn web_module(&mut self, rate: f32) -> AtmosWebModule {
        let mut m = AtmosWebModule::new(rate).tuned(self.tuning.clone());
        for (k, x) in self.web_params() {
            m = m.set(k, x);
            if let Some(i) = atmos_web::module::knob(k) {
                self.sent_web[i as usize] = x;
            }
        }
        m
    }

    pub fn fx_module(&self, rate: f32) -> Rack {
        Rack::with_scope(rate, self.scope.clone())
    }

    /// Lay the rack again from the chain and hand it to `rack`.
    pub fn lay(&mut self, ctl: &mut Controller, rack: ModuleId, rate: f32, max_block: usize) -> Result<(), AppError> {
        let built = fxchain::build(&self.slots(), rate.max(1.0) as u32);
        let thing = match built {
            Some(mut b) => {
                b.rack.set_meters(self.meters.clone());
                self.laid_from = b.from;
                self.laid_keys = b.keys;
                RackThing::new(Some(b.rack), max_block)
            }
            None => {
                self.laid_from.clear();
                self.laid_keys.clear();
                RackThing::new(None, max_block)
            }
        };
        ctl.give(rack, 0, thing)?;
        Ok(())
    }

    /// Set a key by the page's name for it. Unknown keys are ignored.
    pub fn set(&mut self, ctl: &mut Controller, base: ModuleId, key: &str, v: &Value, rate: f32, max_block: usize) -> Result<(), AppError> {
        if let Some(rest) = key.strip_prefix("fx.") {
            return self.fx_control(ctl, base + FX, rest, v);
        }
        if !self.put(key, v, true) {
            return Ok(());
        }
        if key == "fx" {
            return self.lay(ctl, base + FX, rate, max_block);
        }
        self.sync(ctl, base)
    }

    /// Send the engines what moved.
    fn sync(&mut self, ctl: &mut Controller, base: ModuleId) -> Result<(), AppError> {
        for (k, x) in self.voice_params() {
            let Some(i) = atmos::knob(k) else { continue };
            if self.sent_voice[i as usize].to_bits() != x.to_bits() {
                ctl.send(base + VOICE, EventKind::Param { index: i, value: x })?;
                self.sent_voice[i as usize] = x;
            }
        }
        for (k, x) in self.web_params() {
            let Some(i) = atmos_web::module::knob(k) else { continue };
            if self.sent_web[i as usize].to_bits() != x.to_bits() {
                ctl.send(base + WEB, EventKind::Param { index: i, value: x })?;
                self.sent_web[i as usize] = x;
            }
        }
        let t = self.tuning_now();
        if t != self.tuning {
            ctl.give(base + VOICE, atmos::TUNING, Box::new(t.clone()))?;
            ctl.give(base + WEB, atmos::TUNING, Box::new(t.clone()))?;
            self.tuning = t;
        }
        Ok(())
    }

    /// `fx.<slot>.<key>`: one control of the running rack (atfx.js's `set`
    /// and `on`), the kept chain moved with it; nothing laid again.
    fn fx_control(&mut self, ctl: &mut Controller, rack: ModuleId, rest: &str, v: &Value) -> Result<(), AppError> {
        let Some((i, key)) = rest.split_once('.') else { return Ok(()) };
        let Ok(i) = i.parse::<usize>() else { return Ok(()) };
        let Some(slot) = self.fx.get_mut(i).and_then(Value::as_object_mut) else { return Ok(()) };
        let laid = self.laid_from.iter().position(|&f| f == i);
        let knob = |keys: &[Vec<String>], s: usize, k: &str| keys.get(s).and_then(|ks| ks.iter().position(|x| x == k)).map(|n| (s * 256 + n) as u32);
        match key {
            "on" => {
                let on = truthy(v);
                slot.insert("on".into(), on.into());
                if let Some(s) = laid {
                    ctl.send(rack, EventKind::Param { index: Rack::switch(s), value: if on { 1.0 } else { 0.0 } })?;
                }
            }
            "wet" | "level" => {
                let Some(x) = number(v) else { return Ok(()) };
                slot.insert(key.into(), num(x));
                let (k, value) = if key == "wet" { ("slot.wet", x / 100.0) } else { ("slot.level", x) };
                if let Some(index) = laid.and_then(|s| knob(&self.laid_keys, s, k)) {
                    ctl.send(rack, EventKind::Param { index, value: value as f32 })?;
                }
            }
            k => {
                let Some(x) = number(v) else { return Ok(()) };
                let params = slot.entry("params").or_insert_with(|| Value::Object(Map::new()));
                if !params.is_object() {
                    *params = Value::Object(Map::new());
                }
                params.as_object_mut().unwrap().insert(k.into(), num(x));
                if let Some(index) = laid.and_then(|s| knob(&self.laid_keys, s, k)) {
                    ctl.send(rack, EventKind::Param { index, value: x as f32 })?;
                }
            }
        }
        Ok(())
    }

    /// Every key the state keeps, and its value.
    pub fn state(&self) -> Value {
        let mut o = Map::new();
        for (id, ..) in &page().knobs {
            o.insert(id.clone(), num(self.v(id)));
        }
        for (k, s) in &self.selects {
            o.insert(k.clone(), Value::String(s.clone()));
        }
        o.insert("fx".into(), Value::Array(self.fx.clone()));
        Value::Object(o)
    }

    /// What the face draws from: oscillator `which`'s live picture.
    pub fn view(&self, which: usize, out: &mut [f32; 32]) -> Option<usize> {
        self.view.read(which, out)
    }

    /// The FX line's meters, by the chain's slots: each slot's output peak
    /// since the last reading and how hard its effect is working
    /// (`fx_telemetry`); and the line's output peak.
    pub fn fx_meter(&self) -> (f32, Vec<(f32, f32)>) {
        let peaks = self.meters.snapshot();
        let tel = self.meters.telemetry_snapshot();
        let mut out = vec![(0.0, 0.0); self.fx.len()];
        let mut last = 0.0f32;
        for (s, &from) in self.laid_from.iter().enumerate() {
            let (l, r) = peaks.get(s + 1).copied().unwrap_or((0.0, 0.0));
            last = l.max(r);
            if let Some(o) = out.get_mut(from) {
                *o = (last, tel.get(s + 1).copied().unwrap_or(0.0));
            }
        }
        (last, out)
    }
}

fn number(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::Bool(b) => Some(*b as u8 as f64),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
    .filter(|x: &f64| x.is_finite())
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|x| x != 0.0),
        Value::String(s) => !matches!(s.as_str(), "" | "0" | "false" | "off"),
        _ => false,
    }
}

fn num(x: f64) -> Value {
    serde_json::Number::from_f64(x).map_or(Value::from(0), Value::Number)
}

/// The insert menu's data, as atfx.js keeps it in `ATFX` from `/api/fx`:
/// `suites` (offered, listed only) and `shapers` by kind.
pub fn fx_kinds_json() -> Value {
    let suites = fxchain::suites()
        .into_iter()
        .map(|s| {
            let families = s
                .families
                .into_iter()
                .map(|f| {
                    let modes = f
                        .modes
                        .into_iter()
                        .map(|m| {
                            let mut o = Map::new();
                            o.insert("kind".into(), m.kind.into());
                            o.insert("label".into(), m.label.into());
                            o.insert("id".into(), m.id.into());
                            Value::Object(o)
                        })
                        .collect();
                    let mut o = Map::new();
                    o.insert("label".into(), f.label.into());
                    o.insert("modes".into(), Value::Array(modes));
                    Value::Object(o)
                })
                .collect();
            let mut o = Map::new();
            o.insert("id".into(), s.id.into());
            o.insert("label".into(), s.label.into());
            o.insert("families".into(), Value::Array(families));
            Value::Object(o)
        })
        .collect();
    let mut shapers = Map::new();
    for sh in fxchain::shapers() {
        let params = sh
            .params
            .iter()
            .map(|p| {
                let mut o = Map::new();
                o.insert("key".into(), p.key.into());
                o.insert("label".into(), p.label.into());
                o.insert("min".into(), crate::wave_patch::num(p.min));
                o.insert("max".into(), crate::wave_patch::num(p.max));
                o.insert("default".into(), crate::wave_patch::num(p.default));
                o.insert("unit".into(), p.unit.into());
                o.insert("log".into(), p.log.into());
                if let Some(step) = p.step {
                    o.insert("step".into(), crate::wave_patch::num(step));
                }
                if p.toggle {
                    o.insert("toggle".into(), true.into());
                }
                if !p.choices.is_empty() {
                    o.insert("choices".into(), Value::Array(p.choices.iter().map(|c| Value::from(*c)).collect()));
                }
                Value::Object(o)
            })
            .collect();
        let mut o = Map::new();
        o.insert("label".into(), sh.label.into());
        o.insert("params".into(), Value::Array(params));
        shapers.insert(sh.kind.to_string(), Value::Object(o));
    }
    let mut o = Map::new();
    o.insert("suites".into(), Value::Array(suites));
    o.insert("shapers".into(), Value::Object(shapers));
    Value::Object(o)
}
