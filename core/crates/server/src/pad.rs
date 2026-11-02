//! The Prism pad: what it can drive, and how it is set up.
//!
//! Hyperprism's controller was one square whose two edges were two settings,
//! each with its own low and high limit. Here the square can drive the
//! engine's Time & Pitch or any rack slot that has controls to sweep. Each one
//! is a *source*: its controls, with their ranges, and a default pair from the
//! process table in docs/HYPERPRISM.md.
//!
//! The pad moves controls through the paths every other control takes —
//! Time & Pitch as a live stretch edit, a slot through `/api/rack/param` — so
//! recording, automation and export already know what to do with it. What
//! this module adds is the list of sources, and the setup a slot keeps: which
//! two controls, and the limits of each.

use crate::json::Value;
use crate::rack::{RackSpec, SlotSpec};
use fx::prism::prism_fx;

/// The id the engine's Time & Pitch goes by, beside the rack's slot ids.
pub const STRETCH: &str = "stretch";

/// The id Hyperprism's Pitch Time Changer goes by.
pub const PITCH_TIME: &str = "ptc";

/// One control the pad can put on an axis.
#[derive(Debug, Clone, PartialEq)]
pub struct PadControl {
    pub key: String,
    pub label: String,
    pub min: f32,
    pub max: f32,
    /// Swept logarithmically, as its slider is.
    pub log: bool,
    pub unit: String,
    /// A count or a choice: the value rounds.
    pub stepped: bool,
    pub choices: Vec<String>,
}

/// Which two controls are on the pad, and the part of each it sweeps.
///
/// A low above its high is allowed: the axis then runs downwards, which is how
/// Time & Pitch puts a faster speed to the right.
#[derive(Debug, Clone, PartialEq)]
pub struct PadSetup {
    pub x: String,
    pub x_lo: f32,
    pub x_hi: f32,
    pub y: String,
    pub y_lo: f32,
    pub y_hi: f32,
}

/// Something the pad can drive.
#[derive(Debug, Clone, PartialEq)]
pub struct PadSource {
    pub id: String,
    pub label: String,
    pub controls: Vec<PadControl>,
    pub default: PadSetup,
}

/// The value a control takes at `unit` along its whole range. The pad's own
/// arithmetic, written once more here so a test can hold it to `resolve`.
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
    PadControl {
        key: key.into(),
        label: label.into(),
        min,
        max,
        log,
        unit: unit.into(),
        stepped: false,
        choices: Vec::new(),
    }
}

fn setup(x: &PadControl, x_range: (f32, f32), y: &PadControl, y_range: (f32, f32)) -> PadSetup {
    PadSetup { x: x.key.clone(), x_lo: x_range.0, x_hi: x_range.1, y: y.key.clone(), y_lo: y_range.0, y_hi: y_range.1 }
}

/// The engine's Time & Pitch: the four document controls on its tab, with
/// the ranges `STRETCH_TARGETS` gives them.
fn time_and_pitch() -> PadSource {
    use crate::automation::*;
    let controls = vec![
        control("ratio", "Stretch", RATIO_MIN, RATIO_MAX, true, "×"),
        control("semitones", "Pitch", SEMITONE_MIN, SEMITONE_MAX, false, "st"),
        control("windowMs", "Window", WINDOW_MS_MIN, WINDOW_MS_MAX, true, "ms"),
        control("cloudMix", "Cloud over engine", 0.0, 1.0, false, ""),
    ];
    // Hyperprism's Pitch Time Changer: speed across, so the stretch runs
    // from four times as long on the left to a quarter on the right; and an
    // octave of pitch each way.
    let default = setup(&controls[0], (4.0, 0.25), &controls[1], (-12.0, 12.0));
    PadSource { id: STRETCH.into(), label: "Time & Pitch".into(), controls, default }
}

/// Hyperprism's Pitch Time Changer: varispeed at Speed, then Hyperprism's own
/// shifter at Pitch/Speed. Its window's controls, ranges and pad, exactly:
/// Speed 1–200 % across, Pitch 0–200 % up, linear; then Feedback, Grain Size,
/// X-Fade Size and Smoothing.
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
    PadSource { id: PITCH_TIME.into(), label: "Pitch Time Changer".into(), controls, default }
}

/// A slot as a source, if it has two or more controls to sweep. The EQ's bands
/// are drawn on its own curve, and the gain has one control.
fn slot_source(id: &str, slot: &SlotSpec) -> Option<PadSource> {
    let (controls, pair): (Vec<PadControl>, Option<prism_fx::PadPair>) = match slot {
        SlotSpec::Shape { kind, .. } => (
            kind.specs().iter().map(|p| control(p.key, p.label, p.min, p.max, p.log, p.unit)).collect(),
            kind.pad(),
        ),
        SlotSpec::Prism { id, .. } => {
            let d = fx::prism::descriptor(id)?;
            let controls = d
                .params
                .iter()
                // A switch has two places, not a sweep.
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
            use fx::comp::*;
            (
                vec![
                    control("thresholdDb", "Threshold", COMP_THRESHOLD_MIN, 0.0, false, "dB"),
                    control("ratio", "Ratio", COMP_RATIO_MIN, COMP_RATIO_MAX, false, ":1"),
                    control("attackMs", "Attack", COMP_ATTACK_MIN, COMP_ATTACK_MAX, true, "ms"),
                    control("releaseMs", "Release", COMP_RELEASE_MIN, COMP_RELEASE_MAX, true, "ms"),
                    control("kneeDb", "Knee", 0.0, COMP_KNEE_MAX, false, "dB"),
                    control("makeupDb", "Makeup", COMP_MAKEUP_MIN, COMP_MAKEUP_MAX, false, "dB"),
                ],
                // Hyperprism's Compressor: volume across, compression up.
                Some(prism_fx::PadPair {
                    x: "thresholdDb",
                    x_range: (COMP_THRESHOLD_MIN, 0.0),
                    y: "ratio",
                    y_range: (COMP_RATIO_MIN, COMP_RATIO_MAX),
                }),
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

/// Everything the pad can drive in this rack: Time & Pitch first, then each
/// slot with two or more controls, in rack order.
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
        let controls = self
            .controls
            .iter()
            .map(|c| {
                let mut v = Value::obj()
                    .set("key", c.key.as_str())
                    .set("label", c.label.as_str())
                    .set("min", c.min as f64)
                    .set("max", c.max as f64)
                    .set("log", c.log)
                    .set("unit", c.unit.as_str());
                if c.stepped {
                    v = v.set("step", 1.0);
                }
                if !c.choices.is_empty() {
                    v = v.set("choices", Value::Arr(c.choices.iter().map(|x| Value::from(x.as_str())).collect()));
                }
                v
            })
            .collect();
        Value::obj()
            .set("id", self.id.as_str())
            .set("label", self.label.as_str())
            .set("controls", Value::Arr(controls))
            .set("pad", saved.unwrap_or(&self.default).to_json())
            .set("default", self.default.to_json())
    }
}

impl PadSetup {
    /// Read one, checked against what its source has: unknown controls are
    /// refused, and limits are held inside each control's range.
    pub fn from_json(v: &Value, source: &PadSource) -> Option<PadSetup> {
        let key = |k: &str| v.get(k).and_then(Value::as_str);
        let num = |k: &str| match v.get(k) {
            Some(Value::Num(n)) if n.is_finite() => Some(*n as f32),
            _ => None,
        };
        let (x, y) = (key("x")?, key("y")?);
        if x == y {
            return None;
        }
        let cx = source.controls.iter().find(|c| c.key == x)?;
        let cy = source.controls.iter().find(|c| c.key == y)?;
        let inside = |c: &PadControl, n: f32| n.clamp(c.min, c.max);
        let pad = PadSetup {
            x: x.into(),
            x_lo: inside(cx, num("xLo")?),
            x_hi: inside(cx, num("xHi")?),
            y: y.into(),
            y_lo: inside(cy, num("yLo")?),
            y_hi: inside(cy, num("yHi")?),
        };
        if pad.x_lo == pad.x_hi || pad.y_lo == pad.y_hi {
            return None;
        }
        Some(pad)
    }

    pub fn to_json(&self) -> Value {
        Value::obj()
            .set("x", self.x.as_str())
            .set("xLo", self.x_lo as f64)
            .set("xHi", self.x_hi as f64)
            .set("y", self.y.as_str())
            .set("yLo", self.y_lo as f64)
            .set("yHi", self.y_hi as f64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fx::shape::ShapeKind;
    use fx::MasterSettings;

    fn rack(slots: Vec<SlotSpec>) -> RackSpec {
        let slot_ids = (0..slots.len()).map(|i| format!("s{i}")).collect();
        RackSpec { slots, slot_ids, master: MasterSettings::default(), pads: Default::default(), pitch_time: Default::default(), post_roll: Default::default(), ranges: Default::default() }
    }

    fn every_kind() -> RackSpec {
        let mut slots = vec![
            SlotSpec::Comp { settings: Default::default(), bypassed: false },
            SlotSpec::Eq { settings: Default::default(), bypassed: false },
            SlotSpec::Gain { db: 0.0, bypassed: false },
        ];
        for kind in ShapeKind::ALL {
            slots.push(SlotSpec::Shape { kind, params: Vec::new(), bypassed: false });
        }
        for e in fx::prism::catalogue() {
            slots.push(SlotSpec::Prism { id: e.descriptor.id, params: Vec::new(), sound: None, bypassed: false });
        }
        rack(slots)
    }

    #[test]
    fn hyperprisms_pitch_time_changer_follows_with_its_own_window() {
        let s = sources(&RackSpec::empty());
        let p = &s[1];
        assert_eq!((p.id.as_str(), p.label.as_str()), (PITCH_TIME, "Pitch Time Changer"));
        let keys: Vec<&str> = p.controls.iter().map(|c| c.key.as_str()).collect();
        assert_eq!(keys, ["speed", "pitch", "feedback", "grain", "xfade", "smoothing"]);
        // Linear, in percent, as the original's window: Speed 1–200 across,
        // Pitch 0–200 up.
        assert!(p.controls.iter().all(|c| !c.log && c.unit == "%"));
        assert_eq!((p.controls[0].min, p.controls[0].max), (1.0, 200.0));
        assert_eq!((p.controls[1].min, p.controls[1].max), (0.0, 200.0));
        let d = &p.default;
        assert_eq!((d.x.as_str(), d.x_lo, d.x_hi), ("speed", 1.0, 200.0));
        assert_eq!((d.y.as_str(), d.y_lo, d.y_hi), ("pitch", 0.0, 200.0));
    }

    #[test]
    fn time_and_pitch_comes_first_with_speed_across_and_pitch_up() {
        let s = sources(&RackSpec::empty());
        assert_eq!(s.len(), 2, "Time & Pitch, then the Pitch Time Changer");
        let t = &s[0];
        assert_eq!((t.id.as_str(), t.label.as_str()), (STRETCH, "Time & Pitch"));
        let keys: Vec<&str> = t.controls.iter().map(|c| c.key.as_str()).collect();
        assert_eq!(keys, ["ratio", "semitones", "windowMs", "cloudMix"]);
        // Hyperprism's Pitch Time Changer: speed to the right, so the stretch
        // runs downwards across the pad, and an octave each way up and down.
        let d = &t.default;
        assert_eq!((d.x.as_str(), d.y.as_str()), ("ratio", "semitones"));
        assert!(d.x_lo > 1.0 && d.x_hi < 1.0, "faster to the right: {} → {}", d.x_lo, d.x_hi);
        assert_eq!((d.y_lo, d.y_hi), (-12.0, 12.0));
    }

    #[test]
    fn every_slot_with_controls_to_sweep_is_a_source_in_rack_order() {
        let spec = every_kind();
        let s = sources(&spec);
        // The EQ's bands are drawn on its own curve and the gain has one control;
        // neither is a pad source.
        let ids: Vec<&str> = s.iter().map(|x| x.id.as_str()).collect();
        assert_eq!(ids[0], STRETCH);
        assert_eq!(ids[1], PITCH_TIME);
        assert_eq!(ids[2], "s0", "the compressor");
        assert!(!ids.contains(&"s1") && !ids.contains(&"s2"));
        for src in &s[2..] {
            let i = spec.slot_ids.iter().position(|x| *x == src.id).unwrap();
            assert_eq!(src.label, spec.slots[i].kind_label());
            assert!(src.controls.len() >= 2, "{} has {} controls", src.label, src.controls.len());
        }
    }

    #[test]
    fn hyperprisms_pairs_are_the_defaults() {
        let spec = rack(vec![
            SlotSpec::Shape { kind: ShapeKind::Ring, params: Vec::new(), bypassed: false },
            SlotSpec::Prism { id: "tremolo", params: Vec::new(), sound: None, bypassed: false },
            SlotSpec::Comp { settings: Default::default(), bypassed: false },
            SlotSpec::Shape { kind: ShapeKind::Width, params: Vec::new(), bypassed: false },
        ]);
        let s = sources(&spec);
        let pair = |id: &str| {
            let d = &s.iter().find(|x| x.id == id).unwrap().default;
            (d.x.clone(), d.y.clone())
        };
        assert_eq!(pair("s0"), ("hz".into(), "mix".into()));
        assert_eq!(pair("s1"), ("rateHz".into(), "depth".into()));
        // Hyperprism's Compressor: volume across, compression up.
        assert_eq!(pair("s2"), ("thresholdDb".into(), "ratio".into()));
        // No pair from Hyperprism: the first two controls, whole range.
        let w = &s.iter().find(|x| x.id == "s3").map(|x| x.clone());
        if let Some(w) = w {
            assert_eq!(w.default.x, w.controls[0].key);
            assert_eq!(w.default.y, w.controls[1].key);
            assert_eq!((w.default.x_lo, w.default.x_hi), (w.controls[0].min, w.controls[0].max));
        }
    }

    /// The pad works out a value from a place along a control and sends the
    /// value. Recording and playback work it out from the lane's unit through
    /// `resolve` (or the stretch table). If the two disagree, a take plays back
    /// somewhere other than where the hand was — so they are held together.
    #[test]
    fn the_pads_arithmetic_is_the_lanes() {
        let spec = every_kind();
        for src in sources(&spec) {
            for c in &src.controls {
                for u in [0.0f32, 0.1, 0.37, 0.5, 0.81, 1.0] {
                    let mine = value(c, u);
                    let theirs = if src.id == STRETCH {
                        crate::automation::stretch_value(&format!("stretch.{}", c.key), u)
                    } else if src.id == PITCH_TIME {
                        crate::automation::stretch_value(&format!("ptc.{}", c.key), u)
                    } else {
                        let i = spec.slot_ids.iter().position(|x| *x == src.id).unwrap();
                        crate::automation::resolve(&spec.slots[i], &c.key, u)
                    }
                    .unwrap_or_else(|| panic!("{}.{} does not resolve", src.label, c.key));
                    assert!(
                        (mine - theirs).abs() <= theirs.abs().max(1.0) * 1e-4,
                        "{}.{} at {u}: the pad says {mine}, the lane says {theirs}",
                        src.label,
                        c.key
                    );
                }
            }
        }
    }

    #[test]
    fn a_default_sweep_stays_inside_its_controls() {
        for src in sources(&every_kind()) {
            let d = &src.default;
            for (key, lo, hi) in [(&d.x, d.x_lo, d.x_hi), (&d.y, d.y_lo, d.y_hi)] {
                let c = src.controls.iter().find(|c| &c.key == key).unwrap_or_else(|| panic!("{}: no {key}", src.label));
                for end in [lo, hi] {
                    assert!(end >= c.min && end <= c.max, "{}.{key}: {end} outside {}..{}", src.label, c.min, c.max);
                }
                assert!(lo != hi, "{}.{key}: an empty sweep", src.label);
            }
        }
    }

    #[test]
    fn a_setup_is_read_back_checked_against_its_source() {
        let s = sources(&rack(vec![SlotSpec::Shape { kind: ShapeKind::Ring, params: Vec::new(), bypassed: false }]));
        let ring = &s[2];
        let good = PadSetup { x: "mix".into(), x_lo: 0.2, x_hi: 0.8, y: "hz".into(), y_lo: 4_000.0, y_hi: 100.0 };
        assert_eq!(PadSetup::from_json(&good.to_json(), ring), Some(good));
        // Limits past the control's range are brought inside it.
        let wide = crate::json::parse(r#"{"x":"mix","xLo":-5,"xHi":9,"y":"hz","yLo":0.1,"yHi":99999}"#).unwrap();
        let back = PadSetup::from_json(&wide, ring).unwrap();
        assert_eq!((back.x_lo, back.x_hi, back.y_hi), (0.0, 1.0, 8_000.0));
        // A control the source does not have, the same one twice, or no sweep.
        for bad in [
            r#"{"x":"nope","xLo":0,"xHi":1,"y":"hz","yLo":1,"yHi":2}"#,
            r#"{"x":"hz","xLo":1,"xHi":2,"y":"hz","yLo":1,"yHi":2}"#,
            r#"{"x":"mix","xLo":0.5,"xHi":0.5,"y":"hz","yLo":1,"yHi":2}"#,
        ] {
            assert_eq!(PadSetup::from_json(&crate::json::parse(bad).unwrap(), ring), None, "{bad}");
        }
    }
}
