//! Atmosphere's FX line as the page lays it (`ui/sequencer/atfx.js`): a
//! chain of effects, each `{ kind, on, params: { key: value }, wet, level }`,
//! built into the `fx` crate's rack exactly as the page's worklet builds it
//! (`atfx-worklet.js`, `{ t: "chain" }`, over `core/crates/fx-wasm`):
//! every slot pushed by its kind, bypassed when off, a kind not known left
//! out; then its controls by key, `slot.wet` its Mix / 100 and `slot.level`
//! its Level in dB.
//!
//! And what the page's insert menu offers, from the same lists the server's
//! `/api/fx` serves (`server-engine/src/routes/fx_rack.rs`): the suites, their
//! families and modes (offered and listed only, as atfx.js keeps them), and
//! every effect's controls by kind.

use mgl_fx::prism::prism_fx::{suite::SUITES, ParamKind};
use mgl_fx::shape::ShapeKind;
use mgl_fx::Effect;

const CHANNELS: usize = 2;

/// The effect a kind names, as fx-wasm's `make` makes it for a slot (which is
/// how the server's rack makes one). `tests/fxchain.rs` checks the two agree
/// on every kind the suites name.
pub fn make(kind: &str, sr: u32) -> Option<Box<dyn Effect>> {
    match kind {
        "gain" => mgl_fx::prism::moved("gain", sr, &[]),
        "eq" => mgl_fx::prism::moved("eq", sr, &[]),
        "comp" => mgl_fx::prism::moved("compressor", sr, &[]),
        k => {
            if let Some(id) = mgl_fx::prism::id_for_kind(k) {
                mgl_fx::prism::make(id, sr, CHANNELS, &[])
            } else {
                ShapeKind::from_str(k).map(|s| mgl_fx::shape::make(s, sr, CHANNELS, &[]))
            }
        }
    }
}

/// One slot of the chain, as atfx.js keeps it.
#[derive(Clone, Debug, PartialEq)]
pub struct FxSlot {
    pub kind: String,
    pub on: bool,
    pub params: Vec<(String, f32)>,
    /// Mix, 0 to 100 (the page sends it / 100).
    pub wet: Option<f32>,
    /// Level, in dB.
    pub level: Option<f32>,
}

/// A built chain: the rack, and for each slot laid, its index in the chain
/// it came from and its controls' keys in knob order (knob `n` of the
/// [`Rack`](crate::Rack) module's slot `s` is `keys[s][n]`). None for a chain
/// with nothing in it that could be made: the line passes straight through.
pub struct Built {
    pub rack: mgl_fx::Rack,
    pub from: Vec<usize>,
    pub keys: Vec<Vec<String>>,
}

pub fn build(slots: &[FxSlot], sr: u32) -> Option<Built> {
    let mut rack = mgl_fx::Rack::new();
    rack.mute_meters();
    let mut from = Vec::new();
    for (i, s) in slots.iter().enumerate() {
        let Some(e) = make(&s.kind, sr) else { continue };
        rack.push_slot(e, !s.on);
        let n = rack.slots.len() - 1;
        for (k, v) in &s.params {
            rack.set_param(n, k, *v);
        }
        if let Some(w) = s.wet {
            rack.set_param(n, "slot.wet", w / 100.0);
        }
        if let Some(l) = s.level {
            rack.set_param(n, "slot.level", l);
        }
        from.push(i);
    }
    if from.is_empty() {
        return None;
    }
    let keys = rack.control_maps().iter().map(|m| (0..m.len()).filter_map(|n| m.index(n).map(|(k, _)| k.to_string())).collect()).collect();
    Some(Built { rack, from, keys })
}

/// One control of an effect, as `/api/fx` lists it.
#[derive(Clone, Debug, PartialEq)]
pub struct FxParam {
    pub key: &'static str,
    pub label: &'static str,
    pub min: f32,
    pub max: f32,
    pub default: f32,
    pub log: bool,
    pub unit: &'static str,
    /// 1 for whole numbers (a count or a choice).
    pub step: Option<f32>,
    pub toggle: bool,
    pub choices: &'static [&'static str],
}

/// An effect's controls, by the kind a slot stores (`/api/fx`'s `shapers`).
#[derive(Clone, Debug, PartialEq)]
pub struct FxShaper {
    pub kind: &'static str,
    pub label: &'static str,
    pub params: Vec<FxParam>,
}

pub fn shapers() -> Vec<FxShaper> {
    let shapes = ShapeKind::ALL.into_iter().map(|k| FxShaper {
        kind: k.as_str(),
        label: k.label(),
        params: k
            .specs()
            .iter()
            .map(|s| FxParam {
                key: s.key,
                label: s.label,
                min: s.min,
                max: s.max,
                default: s.default,
                log: s.log,
                unit: s.unit,
                step: None,
                toggle: false,
                choices: &[],
            })
            .collect(),
    });
    let prisms = mgl_fx::prism::catalogue().iter().map(|e| {
        let d = e.descriptor;
        FxShaper {
            kind: mgl_fx::prism::kind(d.id).unwrap_or_default(),
            label: d.label,
            params: d
                .params
                .iter()
                .map(|p| {
                    let (step, toggle, choices) = match p.kind {
                        ParamKind::Continuous => (None, false, &[][..]),
                        ParamKind::Int => (Some(1.0), false, &[][..]),
                        ParamKind::Toggle => (None, true, &[][..]),
                        ParamKind::Choice(labels) => (Some(1.0), false, labels),
                    };
                    FxParam { key: p.key, label: p.label, min: p.min, max: p.max, default: p.default, log: p.log, unit: p.unit, step, toggle, choices }
                })
                .collect(),
        }
    });
    shapes.chain(prisms).collect()
}

#[derive(Clone, Debug, PartialEq)]
pub struct FxMode {
    pub id: &'static str,
    pub label: &'static str,
    /// The kind a slot of it stores.
    pub kind: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FxFamily {
    pub label: &'static str,
    pub modes: Vec<FxMode>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FxSuite {
    pub id: &'static str,
    pub label: &'static str,
    pub families: Vec<FxFamily>,
}

/// The insert menu: every suite offered, its families, their listed modes
/// (`atfxCatalogue`'s filter over `/api/fx`'s `suites`).
pub fn suites() -> Vec<FxSuite> {
    SUITES
        .iter()
        .filter(|s| s.offered())
        .map(|s| FxSuite {
            id: s.id,
            label: s.label,
            families: s
                .families
                .iter()
                .map(|f| FxFamily {
                    label: f.label,
                    modes: f
                        .modes
                        .iter()
                        .filter(|m| m.listed)
                        .map(|m| FxMode { id: m.id, label: m.label, kind: mgl_fx::suite::keeper_kind(m) })
                        .collect(),
                })
                .filter(|f| !f.modes.is_empty())
                .collect(),
        })
        .filter(|s| !s.families.is_empty())
        .collect()
}
