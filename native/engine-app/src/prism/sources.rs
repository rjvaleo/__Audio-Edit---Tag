//! What the Prism pad can drive, and how it is set up: MGL's
//! `server-core/src/pad.rs` (`GET /api/pad`), and the catalogue of effects
//! the page reads its controls, groups and Process menu from (`GET /api/fx`,
//! `api_fx_catalogue`), ported line for line with serde_json in place of
//! MGL's own JSON value.

use crate::grain::rack::{RackSpec, SlotSpec, PAD_PITCH_TIME, PAD_STRETCH};
use mgl_fx::prism::prism_fx;
use serde_json::{json, Map, Value};

/// `automation::RATIO_MIN` and its fellows: Time & Pitch's ranges.
pub const RATIO_MIN: f32 = 0.01;
pub const RATIO_MAX: f32 = 100.0;
pub const SEMITONE_MIN: f32 = -48.0;
pub const SEMITONE_MAX: f32 = 48.0;
pub const WINDOW_MS_MIN: f32 = 5.0;
pub const WINDOW_MS_MAX: f32 = 2000.0;

#[derive(Debug, Clone, PartialEq)]
pub struct PadControl {
    pub key: String,
    pub label: String,
    pub min: f32,
    pub max: f32,
    pub log: bool,
    pub unit: String,
    pub stepped: bool,
    pub choices: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PadSetup {
    pub x: String,
    pub x_lo: f32,
    pub x_hi: f32,
    pub y: String,
    pub y_lo: f32,
    pub y_hi: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PadSource {
    pub id: String,
    pub label: String,
    pub controls: Vec<PadControl>,
    pub default: PadSetup,
}

/// `pad::value`: the value a control takes at `unit` along its whole range.
pub fn value(c: &PadControl, unit: f32) -> f32 {
    let u = unit.clamp(0.0, 1.0);
    let v = if u <= 0.0 {
        c.min
    } else if u >= 1.0 {
        c.max
    } else if c.log && c.min > 0.0 && c.max > 0.0 {
        (c.min.ln() + (c.max.ln() - c.min.ln()) * u).exp()
    } else {
        c.min + (c.max - c.min) * u
    };
    if c.stepped {
        v.round()
    } else {
        v
    }
}

fn control(key: &str, label: &str, min: f32, max: f32, log: bool, unit: &str) -> PadControl {
    PadControl { key: key.into(), label: label.into(), min, max, log, unit: unit.into(), stepped: false, choices: Vec::new() }
}

/// `pad::as_written`: an `f32` as the number it was written as.
pub fn as_written(v: f32) -> f64 {
    v.to_string().parse().unwrap_or(v as f64)
}

fn num(x: f64) -> Value {
    serde_json::Number::from_f64(x).map_or(Value::Null, Value::Number)
}

fn setup(x: &PadControl, x_range: (f32, f32), y: &PadControl, y_range: (f32, f32)) -> PadSetup {
    PadSetup { x: x.key.clone(), x_lo: x_range.0, x_hi: x_range.1, y: y.key.clone(), y_lo: y_range.0, y_hi: y_range.1 }
}

fn time_and_pitch() -> PadSource {
    let controls = vec![
        control("ratio", "Stretch", RATIO_MIN, RATIO_MAX, true, "×"),
        control("semitones", "Pitch", SEMITONE_MIN, SEMITONE_MAX, false, "st"),
        control("windowMs", "Window", WINDOW_MS_MIN, WINDOW_MS_MAX, true, "ms"),
        control("cloudMix", "Cloud over engine", 0.0, 1.0, false, ""),
    ];
    let default = setup(&controls[0], (RATIO_MAX, RATIO_MIN), &controls[1], (SEMITONE_MIN, SEMITONE_MAX));
    PadSource { id: PAD_STRETCH.into(), label: "Time & Pitch".into(), controls, default }
}

fn pitch_time() -> PadSource {
    let pct = |key: &str, label: &str, min: f32, max: f32| control(key, label, min, max, false, "%");
    let controls = vec![
        pct("speed", "Speed", 1.0, 200.0),
        pct("pitch", "Pitch", 0.0, 200.0),
        pct("feedback", "Feedback", 0.0, 100.0),
        pct("grain", "Grain Size", 1.0, 100.0),
        pct("xfade", "X-Fade Size", 0.0, 100.0),
        pct("smoothing", "Smoothing", 0.0, 100.0),
    ];
    let default = setup(&controls[0], (1.0, 200.0), &controls[1], (0.0, 200.0));
    PadSource { id: PAD_PITCH_TIME.into(), label: "Pitch Time Changer".into(), controls, default }
}

fn slot_source(id: &str, slot: &SlotSpec) -> Option<PadSource> {
    let (controls, pair): (Vec<PadControl>, Option<prism_fx::PadPair>) = match slot {
        SlotSpec::Shape { kind, .. } => (kind.specs().iter().map(|p| control(p.key, p.label, p.min, p.max, p.log, p.unit)).collect(), kind.pad()),
        SlotSpec::Prism { id, .. } => {
            let d = mgl_fx::prism::descriptor(id)?;
            let controls = d
                .params
                .iter()
                .filter(|p| !matches!(p.kind, prism_fx::ParamKind::Toggle))
                .map(|p| {
                    let mut c = control(p.key, p.label, p.min, p.max, p.log, p.unit);
                    match p.kind {
                        prism_fx::ParamKind::Int => c.stepped = true,
                        prism_fx::ParamKind::Choice(labels) => {
                            c.stepped = true;
                            c.choices = labels.iter().map(|l| l.to_string()).collect();
                        }
                        _ => {}
                    }
                    c
                })
                .collect();
            (controls, d.panel.pad)
        }
        SlotSpec::Comp { .. } => {
            use mgl_fx::comp::*;
            (
                vec![
                    control("thresholdDb", "Threshold", COMP_THRESHOLD_MIN, 0.0, false, "dB"),
                    control("ratio", "Ratio", COMP_RATIO_MIN, COMP_RATIO_MAX, false, ":1"),
                    control("attackMs", "Attack", COMP_ATTACK_MIN, COMP_ATTACK_MAX, true, "ms"),
                    control("releaseMs", "Release", COMP_RELEASE_MIN, COMP_RELEASE_MAX, true, "ms"),
                    control("kneeDb", "Knee", 0.0, COMP_KNEE_MAX, false, "dB"),
                    control("makeupDb", "Makeup", COMP_MAKEUP_MIN, COMP_MAKEUP_MAX, false, "dB"),
                ],
                Some(prism_fx::PadPair { x: "thresholdDb", x_range: (COMP_THRESHOLD_MIN, 0.0), y: "ratio", y_range: (COMP_RATIO_MIN, COMP_RATIO_MAX) }),
            )
        }
        SlotSpec::Eq { .. } | SlotSpec::Gain { .. } => return None,
    };
    if controls.len() < 2 {
        return None;
    }
    let find = |key: &str| controls.iter().find(|c| c.key == key);
    let default = match pair.and_then(|p| Some((find(p.x)?, p.x_range, find(p.y)?, p.y_range))) {
        Some((x, xr, y, yr)) => setup(x, xr, y, yr),
        None => setup(&controls[0], (controls[0].min, controls[0].max), &controls[1], (controls[1].min, controls[1].max)),
    };
    Some(PadSource { id: id.into(), label: slot.kind_label().into(), controls, default })
}

/// `pad::sources`: Time & Pitch, the Pitch Time Changer, then each slot with
/// two or more controls, in rack order.
pub fn sources(spec: &RackSpec) -> Vec<PadSource> {
    let mut out = vec![time_and_pitch(), pitch_time()];
    for (i, slot) in spec.slots.iter().enumerate() {
        let Some(id) = spec.slot_ids.get(i).filter(|id| !id.is_empty()) else { continue };
        out.extend(slot_source(id, slot));
    }
    out
}

impl PadSource {
    pub fn to_json(&self, saved: Option<&PadSetup>) -> Value {
        let controls: Vec<Value> = self
            .controls
            .iter()
            .map(|c| {
                let mut o = Map::new();
                o.insert("key".into(), c.key.as_str().into());
                o.insert("label".into(), c.label.as_str().into());
                o.insert("min".into(), num(as_written(c.min)));
                o.insert("max".into(), num(as_written(c.max)));
                o.insert("log".into(), c.log.into());
                o.insert("unit".into(), c.unit.as_str().into());
                if c.stepped {
                    o.insert("step".into(), num(1.0));
                }
                if !c.choices.is_empty() {
                    o.insert("choices".into(), Value::Array(c.choices.iter().map(|x| Value::from(x.as_str())).collect()));
                }
                Value::Object(o)
            })
            .collect();
        json!({
            "id": self.id, "label": self.label, "controls": controls,
            "pad": saved.unwrap_or(&self.default).to_json(), "default": self.default.to_json(),
        })
    }
}

impl PadSetup {
    /// `PadSetup::from_json`: checked against its source.
    pub fn from_json(v: &Value, source: &PadSource) -> Option<PadSetup> {
        let key = |k: &str| v.get(k).and_then(Value::as_str);
        let n = |k: &str| v.get(k).and_then(Value::as_f64).filter(|n| n.is_finite()).map(|n| n as f32);
        let (x, y) = (key("x")?, key("y")?);
        if x == y {
            return None;
        }
        let cx = source.controls.iter().find(|c| c.key == x)?;
        let cy = source.controls.iter().find(|c| c.key == y)?;
        let inside = |c: &PadControl, n: f32| n.clamp(c.min, c.max);
        let pad = PadSetup { x: x.into(), x_lo: inside(cx, n("xLo")?), x_hi: inside(cx, n("xHi")?), y: y.into(), y_lo: inside(cy, n("yLo")?), y_hi: inside(cy, n("yHi")?) };
        if pad.x_lo == pad.x_hi || pad.y_lo == pad.y_hi {
            return None;
        }
        Some(pad)
    }

    pub fn to_json(&self) -> Value {
        json!({ "x": self.x, "xLo": num(as_written(self.x_lo)), "xHi": num(as_written(self.x_hi)), "y": self.y, "yLo": num(as_written(self.y_lo)), "yHi": num(as_written(self.y_hi)) })
    }
}

/// `rack::pads_from_json`: the pads that still have something to drive,
/// checked, as MGL's `/api/rack` keeps them. Written back as checked.
pub fn check_pads(spec: &mut RackSpec) {
    let srcs = sources(spec);
    let kept = std::mem::take(&mut spec.pads);
    for (id, setup) in kept {
        let Some(source) = srcs.iter().find(|s| s.id == id) else { continue };
        if let Some(pad) = PadSetup::from_json(&setup, source) {
            spec.pads.insert(id, pad.to_json());
        }
    }
}

/// `GET /api/pad`: every source, with its setup (the one kept with the rack,
/// or its default).
pub fn pad_json(spec: &RackSpec) -> Value {
    let srcs = sources(spec);
    let list: Vec<Value> = srcs
        .iter()
        .map(|s| {
            let saved = spec.pads.get(&s.id).and_then(|v| PadSetup::from_json(v, s));
            s.to_json(saved.as_ref())
        })
        .collect();
    json!({ "sources": list })
}

// ─────────────────────────────────────────────── `GET /api/fx`

fn role_name(r: prism_fx::Role) -> &'static str {
    use prism_fx::Role::*;
    match r {
        Time => "time",
        Space => "space",
        Tone => "tone",
        Motion => "motion",
        Drive => "drive",
        Noise => "noise",
        Dynamics => "dynamics",
        Pitch => "pitch",
        Stereo => "stereo",
        Output => "output",
        Engine => "engine",
    }
}

fn strs(xs: &[&str]) -> Value {
    Value::Array(xs.iter().map(|x| Value::from(*x)).collect())
}

/// `prism_entry`: a prism effect, shaped as a shaper, with its panel.
fn prism_entry(d: &'static prism_fx::Descriptor) -> Value {
    use prism_fx::{Category, Display, ParamKind};
    let params: Vec<Value> = d
        .params
        .iter()
        .map(|p| {
            let mut o = Map::new();
            o.insert("key".into(), p.key.into());
            o.insert("label".into(), p.label.into());
            o.insert("min".into(), num(p.min as f64));
            o.insert("max".into(), num(p.max as f64));
            o.insert("default".into(), num(p.default as f64));
            o.insert("log".into(), p.log.into());
            o.insert("unit".into(), p.unit.into());
            if let Some((key, value)) = p.when {
                o.insert("when".into(), json!({ "key": key, "value": num(value as f64) }));
            }
            if let Some(r) = p.role {
                o.insert("role".into(), role_name(r).into());
            }
            match p.kind {
                ParamKind::Continuous => {}
                ParamKind::Int => {
                    o.insert("step".into(), num(1.0));
                }
                ParamKind::Toggle => {
                    o.insert("toggle".into(), true.into());
                }
                ParamKind::Choice(labels) => {
                    o.insert("step".into(), num(1.0));
                    o.insert("choices".into(), strs(labels));
                }
            }
            Value::Object(o)
        })
        .collect();
    let groups: Vec<Value> = d.panel.groups.iter().map(|g| json!({ "label": g.label, "keys": strs(g.keys) })).collect();
    let displays: Vec<&str> = d
        .panel
        .displays
        .iter()
        .map(|x| match x {
            Display::Meter => "meter",
            Display::Curve => "curve",
            Display::Scope => "scope",
            Display::Spectrum => "spectrum",
            Display::Diagram => "diagram",
        })
        .collect();
    let mut panel = json!({ "groups": groups, "primary": strs(d.panel.primary), "displays": strs(&displays) });
    if let Some(pad) = d.panel.pad {
        panel["pad"] = json!({ "x": pad.x, "xMin": num(pad.x_range.0 as f64), "xMax": num(pad.x_range.1 as f64), "y": pad.y, "yMin": num(pad.y_range.0 as f64), "yMax": num(pad.y_range.1 as f64) });
    }
    let category = match d.category {
        Category::Delay => "delay",
        Category::Reverb => "reverb",
        Category::Modulation => "modulation",
        Category::Stereo => "stereo",
        Category::Filter => "filter",
        Category::Spectral => "spectral",
        Category::Pitch => "pitch",
        Category::Distortion => "distortion",
        Category::Dynamics => "dynamics",
        Category::Granular => "granular",
        Category::Utility => "utility",
    };
    let mut o = Map::new();
    if let Some(input) = d.sound {
        o.insert("sound".into(), json!({ "key": input.key, "label": input.label }));
    }
    o.insert("kind".into(), mgl_fx::prism::kind(d.id).unwrap_or_default().into());
    o.insert("label".into(), d.label.into());
    o.insert("category".into(), category.into());
    o.insert("source".into(), d.source.into());
    o.insert("params".into(), Value::Array(params));
    o.insert("panel".into(), panel);
    Value::Object(o)
}

/// `suites_json`: each suite's families and modes.
fn suites_json() -> Value {
    use prism_fx::suite::{Exactness, Verdict, SUITES};
    let class = |c: Exactness| match c {
        Exactness::Measured => ("measured", ""),
        Exactness::Static => ("static", ""),
        Exactness::Port(v) => (
            "port",
            match v {
                Verdict::Matches => "matches",
                Verdict::Differs => "differs",
                Verdict::Unchecked => "unchecked",
            },
        ),
        Exactness::Paper => ("paper", ""),
        Exactness::Ours => ("ours", ""),
        Exactness::Partial => ("partial", ""),
    };
    Value::Array(
        SUITES
            .iter()
            .map(|s| {
                let families: Vec<Value> = s
                    .families
                    .iter()
                    .map(|f| {
                        let modes: Vec<Value> = f
                            .modes
                            .iter()
                            .map(|m| {
                                let (c, v) = class(m.class);
                                json!({ "id": m.id, "label": m.label, "kind": mgl_fx::suite::keeper_kind(m), "kernel": m.kernel, "class": c, "verdict": v, "listed": m.listed, "rev": num(m.rev as f64), "source": m.source })
                            })
                            .collect();
                        json!({ "label": f.label, "modes": modes })
                    })
                    .collect();
                json!({ "id": s.id, "label": s.label, "face": format!("{:?}", s.face).to_lowercase(), "offered": s.offered(), "families": families })
            })
            .collect(),
    )
}

/// `GET /api/fx`: every shaper and prism effect, and the suites.
pub fn fx_json() -> Value {
    let mut kinds: Vec<Value> = mgl_fx::shape::ShapeKind::ALL
        .into_iter()
        .map(|k| {
            let params: Vec<Value> = k
                .specs()
                .iter()
                .map(|s| json!({ "key": s.key, "label": s.label, "min": num(s.min as f64), "max": num(s.max as f64), "default": num(s.default as f64), "log": s.log, "unit": s.unit }))
                .collect();
            json!({ "kind": k.as_str(), "label": k.label(), "params": params })
        })
        .collect();
    kinds.extend(mgl_fx::prism::catalogue().iter().map(|e| prism_entry(e.descriptor)));
    json!({ "shapers": kinds, "suites": suites_json() })
}
