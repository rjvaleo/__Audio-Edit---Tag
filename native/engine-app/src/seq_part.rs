//! Seq on the canvas: MGL's Seq page (`ui/sequencer/app.js`) as one engine
//! module, [`engine_mgl::SeqModule`]: notes in (its keys), audio out, and
//! the steps out as notes.
//!
//! The state is kept as the page keeps it, by its controls' element ids less
//! `Slider` or `Select` (`bpm`, `atk`, `lfo1Target`, `delayTime`): a slider
//! at its value (a number), a select at its option's value (`dir` "fwd",
//! `wave` "pulse", `tapeSpeed` "studio75", `root` "9"); with them `scale`
//! (the scale's place in `SCALES`), `pattern` (the 64 steps, each
//! `[degree, rest]`) and `play`. A preset is the page's own
//! (`getPresetState`: `sliders`, `selects`, `steps`, `scaleIdx`), so MGL's
//! presets load here and the app's load in MGL; what a preset holds that Seq
//! does not play (Space, Atmosphere, the Band) is kept as it came, and saved
//! again with it.

use crate::AppError;
use engine_core::{Controller, EventKind, ModuleId};
use engine_mgl::seq::module::{self as sm, knob, step_knob};
use engine_mgl::seq::steps::MAX_STEPS;
use engine_mgl::{SeqModule, SeqView};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::sync::{Arc, OnceLock};

pub const PAGE_JSON: &str = include_str!("../data/seq-page.json");

/// The page's own lists, captured from it (`data/seq-page.json`).
pub struct Page {
    /// `SCALES`: name, its line of facts, its family, its cents.
    pub scales: Vec<(String, String, String, Vec<f64>)>,
    /// Every slider: id, min, max, step, its value as the page opens.
    pub sliders: Vec<(String, f64, f64, f64, f64)>,
    /// Every select Seq plays: id, its options' values, the one chosen.
    pub selects: Vec<(String, Vec<String>, String)>,
    pub steps: Vec<(i32, bool)>,
}

/// The sliders and selects Seq plays (the rest of a preset is kept, not played).
pub const SLIDERS: &[&str] = &[
    "bpm", "steps", "atk", "dec", "sus", "rel", "vol", "pw", "cutoff", "res", "keyFollow", "fatk", "fdec", "fsus", "frel", "famt",
    "lfo1Rate", "lfo1Depth", "lfo2Rate", "lfo2Depth", "lfo3Rate", "lfo3Depth", "delayFb", "delayWet", "delaySpread", "delayHiCut",
    "morphTime", "perfVar",
];
pub const SELECTS: &[&str] = &["dir", "stepLen", "wave", "root", "octave", "lfo1Wave", "lfo1Target", "lfo2Wave", "lfo2Target", "lfo3Wave", "lfo3Target", "delayTime", "tapeSpeed"];

pub fn page() -> &'static Page {
    static PAGE: OnceLock<Page> = OnceLock::new();
    PAGE.get_or_init(|| {
        let json: Value = serde_json::from_str(PAGE_JSON).expect("seq-page.json is JSON");
        let f = |v: &Value| v.as_f64().unwrap_or(0.0);
        let s = |v: &Value| v.as_str().unwrap_or("").to_string();
        let scales = json["scales"]
            .as_array()
            .map(|a| a.iter().map(|x| (s(&x["name"]), s(&x["info"]), s(&x["cat"]), x["cents"].as_array().map(|c| c.iter().map(f).collect()).unwrap_or_default())).collect())
            .unwrap_or_default();
        let sliders = json["knobs"].as_array().map(|a| a.iter().map(|k| (s(&k[0]), f(&k[1]), f(&k[2]), f(&k[3]), f(&k[4]))).collect()).unwrap_or_default();
        let selects = json["selects"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter(|x| SELECTS.contains(&x[0].as_str().unwrap_or("")))
                    .map(|x| {
                        let opts: Vec<String> = x[1].as_array().map(|o| o.iter().map(|p| s(&p[0])).collect()).unwrap_or_default();
                        let at = x[2].as_u64().unwrap_or(0) as usize;
                        let chosen = opts.get(at).cloned().unwrap_or_default();
                        (s(&x[0]), opts, chosen)
                    })
                    .collect()
            })
            .unwrap_or_default();
        let steps = json["steps"].as_array().map(|a| a.iter().map(|x| (x[0].as_i64().unwrap_or(0) as i32, x[1].as_bool().unwrap_or(false))).collect()).unwrap_or_default();
        Page { scales, sliders, selects, steps }
    })
}

fn number(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        Value::Bool(b) => Some(*b as u8 as f64),
        _ => None,
    }
}

fn num(x: f64) -> Value {
    if x.fract() == 0.0 && x.abs() < 1e15 {
        Value::from(x as i64)
    } else {
        serde_json::Number::from_f64(x).map(Value::Number).unwrap_or(Value::Null)
    }
}

/// A select's value as the module's knob takes it: its place in the
/// module's list, or the number it is.
fn select_knob(id: &str, value: &str) -> Option<f64> {
    let at = |list: &[&str]| list.iter().position(|x| *x == value).map(|i| i as f64);
    match id {
        "dir" => at(sm::DIRECTIONS),
        "wave" => at(sm::WAVES),
        "lfo1Wave" | "lfo2Wave" | "lfo3Wave" => at(sm::LFO_WAVES),
        "lfo1Target" | "lfo2Target" | "lfo3Target" => at(sm::LFO_TARGETS),
        "tapeSpeed" => sm::TAPE_SPEEDS.iter().position(|(n, _)| *n == value).map(|i| i as f64),
        _ => value.trim().parse().ok(),
    }
}

pub struct SeqPart {
    sliders: BTreeMap<String, f64>,
    selects: BTreeMap<String, String>,
    pub steps: Vec<(i32, bool)>,
    pub scale: usize,
    pub playing: bool,
    name: String,
    /// What a preset held that Seq does not play: kept, and saved again.
    other_sliders: Map<String, Value>,
    other_selects: Map<String, Value>,
    other: Map<String, Value>,
    /// What the module was last told, by knob.
    sent: Vec<f64>,
    pub view: Arc<SeqView>,
}

impl SeqPart {
    /// The page as it opens, or as `saved` (a state object) has it.
    pub fn new(saved: Option<&Value>) -> Result<SeqPart, AppError> {
        let p = page();
        let mut part = SeqPart {
            sliders: p.sliders.iter().map(|k| (k.0.clone(), k.4)).collect(),
            selects: p.selects.iter().map(|s| (s.0.clone(), s.2.clone())).collect(),
            steps: p.steps.clone(),
            scale: 0,
            playing: false,
            name: String::new(),
            other_sliders: Map::new(),
            other_selects: Map::new(),
            other: Map::new(),
            // What a module starts with: a control at the page's own value
            // is never sent, so it keeps the page's literal (see SeqModule).
            sent: sm::default_knobs(),
            view: SeqView::new(),
        };
        part.steps.resize(MAX_STEPS, (0, false));
        if let Some(s) = saved {
            let o = s.as_object().ok_or_else(|| AppError::BadFile("Seq's state must be an object".into()))?;
            for (k, v) in o {
                if k != "play" {
                    part.put(k, v);
                }
            }
        }
        Ok(part)
    }

    /// The engine module, told every control (off the audio thread).
    pub fn module(&mut self, rate: f32) -> SeqModule {
        let scales = page().scales.iter().map(|s| s.3.clone()).collect();
        let mut m = SeqModule::with_view(rate, scales, self.view.clone());
        self.sent = sm::default_knobs();
        for (i, x) in self.knobs() {
            if self.sent[i as usize].to_bits() != x.to_bits() {
                m = m.set_knob(i, x);
                self.sent[i as usize] = x;
            }
        }
        m
    }

    /// Keep one key's value, as the page's control holds it. False for a
    /// key it does not keep.
    fn put(&mut self, key: &str, v: &Value) -> bool {
        if key == "name" {
            self.name = v.as_str().unwrap_or_default().to_string();
            return true;
        }
        if key == "scale" {
            let Some(x) = number(v) else { return false };
            self.scale = (x.max(0.0) as usize).min(page().scales.len().saturating_sub(1));
            return true;
        }
        if key == "play" {
            self.playing = number(v).unwrap_or(0.0) != 0.0 || v.as_bool() == Some(true);
            return true;
        }
        if key == "pattern" {
            let Some(a) = v.as_array() else { return false };
            for (i, s) in a.iter().enumerate().take(MAX_STEPS) {
                let d = s.get(0).and_then(number).or_else(|| s.get("degree").and_then(number)).unwrap_or(0.0);
                let r = s.get(1).or_else(|| s.get("rest")).map(|x| x.as_bool().unwrap_or(number(x).unwrap_or(0.0) != 0.0)).unwrap_or(false);
                self.steps[i] = (d as i32, r);
            }
            return true;
        }
        if let Some(n) = key.strip_prefix("step").and_then(|n| n.parse::<usize>().ok()) {
            let Some(x) = number(v) else { return false };
            if n < MAX_STEPS {
                self.steps[n].0 = x as i32;
                return true;
            }
            return false;
        }
        if let Some(n) = key.strip_prefix("rest").and_then(|n| n.parse::<usize>().ok()) {
            if n < MAX_STEPS {
                self.steps[n].1 = v.as_bool().unwrap_or(number(v).unwrap_or(0.0) != 0.0);
                return true;
            }
            return false;
        }
        if let Some((_, min, max, step, _)) = page().sliders.iter().find(|k| k.0 == key) {
            let Some(x) = number(v) else { return false };
            // A range input: its step, its range.
            let step = if *step > 0.0 { *step } else { 1.0 };
            let x = (((x - min) / step).round() * step + min).clamp(*min, *max);
            self.sliders.insert(key.to_string(), x);
            return true;
        }
        if let Some((_, opts, _)) = page().selects.iter().find(|s| s.0 == key) {
            let s = match v {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.as_f64().map(|x| if x.fract() == 0.0 { format!("{}", x as i64) } else { format!("{x}") }).unwrap_or_default(),
                _ => return false,
            };
            if !opts.contains(&s) {
                return false;
            }
            self.selects.insert(key.to_string(), s);
            return true;
        }
        false
    }

    /// Every knob of the module, as the state has it.
    fn knobs(&self) -> Vec<(u32, f64)> {
        let mut out = Vec::new();
        for k in sm::KEYS {
            let x = if let Some(x) = self.sliders.get(*k) {
                Some(*x)
            } else if let Some(s) = self.selects.get(*k) {
                select_knob(k, s)
            } else {
                match *k {
                    "scale" => Some(self.scale as f64),
                    "play" => Some(self.playing as u8 as f64),
                    _ => None,
                }
            };
            if let (Some(x), Some(i)) = (x, knob(k)) {
                out.push((i, x));
            }
        }
        for (i, (d, r)) in self.steps.iter().enumerate() {
            out.push((step_knob(i, false), *d as f64));
            out.push((step_knob(i, true), *r as u8 as f64));
        }
        out
    }

    /// What changed, sent; in the page's order, so a handler that reads
    /// several controls reads them all as they are now.
    fn sync(&mut self, ctl: &mut Controller, id: ModuleId) -> Result<(), AppError> {
        for (i, x) in self.knobs() {
            if self.sent[i as usize].to_bits() != x.to_bits() {
                ctl.send(id, EventKind::Param { index: i, value: x as f32 })?;
                self.sent[i as usize] = x;
            }
        }
        Ok(())
    }

    /// Set one key, by the page's name for it; ignored when it keeps none.
    pub fn set(&mut self, ctl: &mut Controller, id: ModuleId, key: &str, v: &Value) -> Result<(), AppError> {
        if key == "preview" {
            // One note now, at this pitch: sent, not kept.
            if let (Some(hz), Some(i)) = (number(v), knob("preview")) {
                ctl.send(id, EventKind::Param { index: i, value: hz as f32 })?;
            }
            return Ok(());
        }
        if key == "stop" {
            // stopSeq: the same as Play's pause, for the sound.
            self.playing = false;
            return self.sync(ctl, id);
        }
        if self.put(key, v) {
            self.sync(ctl, id)?;
        }
        Ok(())
    }

    /// Every key the state keeps, and its value.
    pub fn state(&self) -> Value {
        let mut o = Map::new();
        for (k, x) in &self.sliders {
            o.insert(k.clone(), num(*x));
        }
        for (k, s) in &self.selects {
            o.insert(k.clone(), Value::String(s.clone()));
        }
        o.insert("scale".into(), Value::from(self.scale));
        o.insert("pattern".into(), Value::Array(self.steps.iter().map(|(d, r)| Value::Array(vec![Value::from(*d), Value::Bool(*r)])).collect()));
        o.insert("play".into(), Value::Bool(self.playing));
        o.insert("name".into(), Value::String(self.name.clone()));
        Value::Object(o)
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    /// Its state as one of MGL's Seq presets (`getPresetState`), named
    /// `name` and known by it from now on.
    pub fn preset(&mut self, name: &str, created_ms: u64) -> Value {
        self.name = name.to_string();
        let mut sliders = self.other_sliders.clone();
        for (k, x) in &self.sliders {
            if SLIDERS.contains(&k.as_str()) && k != "morphTime" && k != "perfVar" {
                sliders.insert(format!("{k}Slider"), Value::String(format!("{x}")));
            }
        }
        let mut selects = self.other_selects.clone();
        for (k, s) in &self.selects {
            selects.insert(format!("{k}Select"), Value::String(s.clone()));
        }
        let mut state = self.other.clone();
        state.insert("sliders".into(), Value::Object(sliders));
        state.insert("selects".into(), Value::Object(selects));
        state.insert(
            "steps".into(),
            Value::Array(self.steps.iter().map(|(d, r)| serde_json::json!({ "degree": d, "rest": r })).collect()),
        );
        state.insert("scaleIdx".into(), Value::from(self.scale));
        let mut o = Map::new();
        o.insert("id".into(), Value::String(format!("preset_{created_ms}")));
        o.insert("name".into(), Value::String(name.to_string()));
        o.insert("created".into(), Value::from(created_ms));
        o.insert("state".into(), Value::Object(state));
        Value::Object(o)
    }

    /// Take one of MGL's Seq presets (`applyPresetState`): what it holds,
    /// the rest as it was. How many of Seq's controls it set.
    pub fn load_preset(&mut self, ctl: &mut Controller, id: ModuleId, preset: &Value) -> Result<usize, AppError> {
        let state = preset.get("state").unwrap_or(preset);
        let mut n = 0;
        if let Some(sl) = state.get("sliders").and_then(Value::as_object) {
            for (sid, v) in sl {
                let k = sid.strip_suffix("Slider").unwrap_or(sid);
                if SLIDERS.contains(&k) && self.put(k, v) {
                    n += 1;
                } else {
                    self.other_sliders.insert(sid.clone(), v.clone());
                }
            }
        }
        if let Some(se) = state.get("selects").and_then(Value::as_object) {
            for (sid, v) in se {
                let k = sid.strip_suffix("Select").unwrap_or(sid);
                if SELECTS.contains(&k) && self.put(k, v) {
                    n += 1;
                } else {
                    self.other_selects.insert(sid.clone(), v.clone());
                }
            }
        }
        if let Some(steps) = state.get("steps").and_then(Value::as_array) {
            for (i, s) in steps.iter().enumerate().take(MAX_STEPS) {
                let d = s.get("degree").and_then(number).unwrap_or(0.0);
                let r = s.get("rest").and_then(Value::as_bool).unwrap_or(false);
                self.steps[i] = (d as i32, r);
            }
            n += 1;
        }
        if let Some(i) = state.get("scaleIdx").and_then(number) {
            self.put("scale", &num(i));
            n += 1;
        }
        if let Some(o) = state.as_object() {
            for (k, v) in o {
                if !["sliders", "selects", "steps", "scaleIdx"].contains(&k.as_str()) {
                    self.other.insert(k.clone(), v.clone());
                }
            }
        }
        if let Some(name) = preset.get("name").and_then(Value::as_str) {
            self.name = name.to_string();
        }
        self.sync(ctl, id)?;
        Ok(n)
    }

    /// The step heard now: (step, Hz, degree), or None; and whether it plays.
    pub fn now(&self) -> (Option<(usize, f64, usize)>, bool) {
        (self.view.now(), self.view.playing())
    }
}
