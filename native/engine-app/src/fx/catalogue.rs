//! MGL's `/api/fx`: the effects catalogue, every kind a rack slot can be and
//! its controls (`shapers`), and the modules with their families and modes
//! (`suites`). Ported line for line from MGL's server
//! (`core/crates/server-engine/src/routes/fx_rack.rs`, `api_fx_catalogue`,
//! `suites_json`, `prism_entry`), with serde_json in place of MGL's own JSON
//! value. `tests/fx.rs` holds it to MGL's answer, recorded from the server.

use mgl_fx::prism::prism_fx;
use serde_json::{json, Map, Value};

/// `GET /api/fx`.
pub fn catalogue_json() -> Value {
    let kinds: Vec<Value> = mgl_fx::shape::ShapeKind::ALL
        .into_iter()
        .map(|k| {
            let params: Vec<Value> = k
                .specs()
                .iter()
                .map(|s| {
                    json!({
                        "key": s.key, "label": s.label, "min": s.min as f64, "max": s.max as f64,
                        "default": s.default as f64, "log": s.log, "unit": s.unit,
                    })
                })
                .collect();
            json!({ "kind": k.as_str(), "label": k.label(), "params": params })
        })
        .chain(mgl_fx::prism::catalogue().iter().map(|e| prism_entry(e.descriptor)))
        .collect();
    json!({ "shapers": kinds, "suites": suites_json() })
}

/// The modules (SUITE-PLAN §3.2): each suite's families and modes, with the
/// kind a mode is added and saved as. Unlisted modes are served too.
pub fn suites_json() -> Value {
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
                                json!({
                                    "id": m.id, "label": m.label, "kind": mgl_fx::suite::keeper_kind(m),
                                    "kernel": m.kernel, "class": c, "verdict": v, "listed": m.listed,
                                    "rev": m.rev as f64, "source": m.source,
                                })
                            })
                            .collect();
                        json!({ "label": f.label, "modes": modes })
                    })
                    .collect();
                json!({
                    "id": s.id, "label": s.label, "face": format!("{:?}", s.face).to_lowercase(),
                    "offered": s.offered(), "families": families,
                })
            })
            .collect(),
    )
}

/// A role's name as the interface reads it.
pub fn role_name(r: prism_fx::Role) -> &'static str {
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

fn prism_entry(d: &'static prism_fx::Descriptor) -> Value {
    use prism_fx::{Category, Display, ParamKind};
    let strs = |xs: &[&str]| Value::Array(xs.iter().map(|x| Value::from(*x)).collect());
    let params: Vec<Value> = d
        .params
        .iter()
        .map(|p| {
            let mut v = Map::new();
            v.insert("key".into(), p.key.into());
            v.insert("label".into(), p.label.into());
            v.insert("min".into(), json!(p.min as f64));
            v.insert("max".into(), json!(p.max as f64));
            v.insert("default".into(), json!(p.default as f64));
            v.insert("log".into(), p.log.into());
            v.insert("unit".into(), p.unit.into());
            if let Some((key, value)) = p.when {
                v.insert("when".into(), json!({ "key": key, "value": value as f64 }));
            }
            if let Some(r) = p.role {
                v.insert("role".into(), role_name(r).into());
            }
            match p.kind {
                ParamKind::Continuous => {}
                ParamKind::Int => {
                    v.insert("step".into(), json!(1.0));
                }
                ParamKind::Toggle => {
                    v.insert("toggle".into(), true.into());
                }
                ParamKind::Choice(labels) => {
                    v.insert("step".into(), json!(1.0));
                    v.insert("choices".into(), strs(labels));
                }
            }
            Value::Object(v)
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
        panel["pad"] = json!({
            "x": pad.x, "xMin": pad.x_range.0 as f64, "xMax": pad.x_range.1 as f64,
            "y": pad.y, "yMin": pad.y_range.0 as f64, "yMax": pad.y_range.1 as f64,
        });
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
    let mut entry = Map::new();
    if let Some(input) = d.sound {
        entry.insert("sound".into(), json!({ "key": input.key, "label": input.label }));
    }
    entry.insert("kind".into(), mgl_fx::prism::kind(d.id).unwrap_or_default().into());
    entry.insert("label".into(), d.label.into());
    entry.insert("category".into(), category.into());
    entry.insert("source".into(), d.source.into());
    entry.insert("params".into(), Value::Array(params));
    entry.insert("panel".into(), panel);
    Value::Object(entry)
}

/// One effect the canvas offers as a module of its own: a mode of a module
/// MGL's picker offers (its 90 listed modes, and the 11 it keeps unlisted, so
/// every one of prism-fx's 101 effects is there), or one of the rack's three
/// built-ins.
#[derive(Clone, Debug)]
pub struct EffectKind {
    /// The canvas kind: `fx:<slot kind>`.
    pub id: String,
    /// What a rack slot of it stores (`kind`), and its module and mode.
    pub kind: String,
    pub suite: Option<&'static str>,
    pub mode: Option<&'static str>,
    pub rev: u16,
    pub label: String,
    /// The module's (suite's) name, for the Add menu.
    pub group: String,
    /// Whether MGL's Add menu lists it.
    pub listed: bool,
}

/// Every effect module, in the Add menu's order: the three built-ins, then
/// each offered module's modes (listed, then unlisted).
pub fn effects() -> &'static [EffectKind] {
    static ALL: std::sync::OnceLock<Vec<EffectKind>> = std::sync::OnceLock::new();
    ALL.get_or_init(|| {
        let mut out: Vec<EffectKind> = [("eq", "Parametric EQ"), ("comp", "Compressor"), ("gain", "Gain")]
            .iter()
            .map(|(k, l)| EffectKind { id: format!("fx:{k}"), kind: (*k).into(), suite: None, mode: None, rev: 0, label: (*l).into(), group: "Rack".into(), listed: true })
            .collect();
        for listed in [true, false] {
            for s in prism_fx::suite::SUITES.iter().filter(|s| s.offered()) {
                for f in s.families {
                    for m in f.modes.iter().filter(|m| m.listed == listed) {
                        let kind = mgl_fx::suite::keeper_kind(m);
                        out.push(EffectKind { id: format!("fx:{kind}"), kind, suite: Some(s.id), mode: Some(m.id), rev: m.rev, label: m.label.into(), group: s.label.into(), listed });
                    }
                }
            }
        }
        out
    })
}

pub fn effect(id: &str) -> Option<&'static EffectKind> {
    effects().iter().find(|e| e.id == id)
}
