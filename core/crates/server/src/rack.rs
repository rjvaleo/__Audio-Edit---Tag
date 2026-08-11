//! Per-file effect racks, and their JSON shape.

use crate::json::Value;
use fx::comp::CompSettings;
use fx::eq::{Band, EqSettings};
use fx::shape::ShapeKind;
use fx::{Compressor, Eq, Gain, MasterSettings, Maximizer, Rack};
use std::collections::BTreeMap;
use std::sync::Mutex;

/// The rack as the UI describes it: a plain, serialisable list.
///
/// Kept separate from the live [`Rack`] because effects carry filter state that
/// must not be persisted, and because rebuilding from settings is what makes a
/// parameter change take effect on the next render.
#[derive(Debug, Clone, PartialEq)]
pub struct RackSpec {
    pub slots: Vec<SlotSpec>,
    /// The channel's own compressor, after everything in the chain. Not a slot:
    /// it is not something you add and cannot be reordered, because the end of
    /// the chain is the only place it means anything.
    pub master: MasterSettings,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SlotSpec {
    Gain { db: f32, bypassed: bool },
    Eq { settings: EqSettings, bypassed: bool },
    Comp { settings: CompSettings, bypassed: bool },
    /// Everything in `fx::shape`, in one variant.
    ///
    /// The older three each have a settings struct and a hand-written JSON
    /// shape, which is fine for three and would be nine more of the same for
    /// these. A shaper describes its own parameters instead, so one variant and
    /// one pair of conversions serve all of them — and the next one added
    /// needs no work here at all.
    ///
    /// The parameters are a plain list rather than a map because that is what
    /// automation will address, and because the order the interface shows them
    /// in is the order the effect declares.
    Shape { kind: ShapeKind, params: Vec<(String, f32)>, bypassed: bool },
}

impl SlotSpec {
    fn bypassed(&self) -> bool {
        match self {
            SlotSpec::Gain { bypassed, .. }
            | SlotSpec::Eq { bypassed, .. }
            | SlotSpec::Comp { bypassed, .. }
            | SlotSpec::Shape { bypassed, .. } => *bypassed,
        }
    }

    fn kind(&self) -> &'static str {
        match self {
            SlotSpec::Gain { .. } => "gain",
            SlotSpec::Eq { .. } => "eq",
            SlotSpec::Comp { .. } => "comp",
            SlotSpec::Shape { kind, .. } => kind.as_str(),
        }
    }
}

fn master_to_json(m: &MasterSettings) -> Value {
    Value::obj()
        .set("on", m.on)
        .set("amount", m.amount as f64)
        .set("autoLevel", m.auto_level)
        .set("autoComp", m.auto_comp)
        .set("ceilingDb", m.ceiling_db as f64)
}

fn master_from_json(v: Option<&Value>) -> MasterSettings {
    let d = MasterSettings::default();
    let Some(v) = v else { return d };
    MasterSettings {
        on: flag(v.get("on")),
        amount: num(v.get("amount"), d.amount).clamp(0.0, 1.0),
        // Absent means on: these are what makes it a one-knob processor, and a
        // rack written before it existed should get the useful behaviour.
        auto_level: !matches!(v.get("autoLevel"), Some(Value::Bool(false))),
        auto_comp: !matches!(v.get("autoComp"), Some(Value::Bool(false))),
        ceiling_db: num(v.get("ceilingDb"), d.ceiling_db).clamp(-24.0, 0.0),
    }
}

fn num(v: Option<&Value>, default: f32) -> f32 {
    match v {
        Some(Value::Num(n)) if n.is_finite() => *n as f32,
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

fn band_json(b: &Band) -> Value {
    Value::obj()
        .set("freq", b.freq as f64)
        .set("q", b.q as f64)
        .set("gainDb", b.gain_db as f64)
}

impl RackSpec {
    pub fn empty() -> Self {
        RackSpec { slots: Vec::new(), master: MasterSettings::default() }
    }

    /// A sensible starting rack: everything present but flat and bypassed, so
    /// the sound is untouched until the user actually turns something on.
    pub fn default_chain() -> Self {
        RackSpec {
            slots: vec![
                SlotSpec::Gain { db: 0.0, bypassed: true },
                SlotSpec::Eq { settings: EqSettings::default(), bypassed: true },
                SlotSpec::Comp { settings: CompSettings::default(), bypassed: true },
            ],
            master: MasterSettings::default(),
        }
    }

    pub fn from_json(v: &Value) -> Self {
        let master = master_from_json(v.get("master"));
        let Some(Value::Arr(items)) = v.get("slots") else {
            return RackSpec { master, ..RackSpec::empty() };
        };
        let mut slots = Vec::new();
        for it in items {
            let kind = it.get("kind").and_then(|k| k.as_str()).unwrap_or("");
            let bypassed = flag(it.get("bypassed"));
            match kind {
                "gain" => slots.push(SlotSpec::Gain {
                    db: num(it.get("db"), 0.0).clamp(-48.0, 48.0),
                    bypassed,
                }),
                "eq" => {
                    let d = EqSettings::default();
                    slots.push(SlotSpec::Eq {
                        settings: EqSettings {
                            low: band_from(it.get("low"), d.low),
                            mid: band_from(it.get("mid"), d.mid),
                            high: band_from(it.get("high"), d.high),
                            high_pass_hz: num(it.get("highPassHz"), 0.0).clamp(0.0, 2000.0),
                        },
                        bypassed,
                    })
                }
                "comp" => {
                    let d = CompSettings::default();
                    slots.push(SlotSpec::Comp {
                        settings: CompSettings {
                            threshold_db: num(it.get("thresholdDb"), d.threshold_db).clamp(-60.0, 0.0),
                            // Below 1:1 would be expansion, which this is not.
                            ratio: num(it.get("ratio"), d.ratio).clamp(1.0, 20.0),
                            attack_ms: num(it.get("attackMs"), d.attack_ms).clamp(0.05, 500.0),
                            release_ms: num(it.get("releaseMs"), d.release_ms).clamp(5.0, 3000.0),
                            knee_db: num(it.get("kneeDb"), d.knee_db).clamp(0.0, 24.0),
                            makeup_db: num(it.get("makeupDb"), d.makeup_db).clamp(-24.0, 24.0),
                        },
                        bypassed,
                    })
                }
                other => {
                    // Anything else is a shaper, or nothing. An unknown kind is
                    // dropped rather than guessed at: a slot whose name we do
                    // not recognise is one from a newer version, and inventing
                    // a default for it would silently change the sound.
                    if let Some(k) = ShapeKind::from_str(other) {
                        let mut params = Vec::new();
                        for spec in k.specs() {
                            let v = num(
                                it.get("params").and_then(|p| p.get(spec.key)),
                                spec.default,
                            );
                            params.push((spec.key.to_string(), spec.clamp(v)));
                        }
                        slots.push(SlotSpec::Shape { kind: k, params, bypassed });
                    }
                }
            }
        }
        RackSpec { slots, master }
    }

    pub fn to_json(&self) -> Value {
        let slots: Vec<Value> = self
            .slots
            .iter()
            .map(|s| {
                let base = Value::obj()
                    .set("kind", s.kind())
                    .set("bypassed", s.bypassed());
                match s {
                    SlotSpec::Gain { db, .. } => base.set("db", *db as f64),
                    SlotSpec::Eq { settings, .. } => base
                        .set("low", band_json(&settings.low))
                        .set("mid", band_json(&settings.mid))
                        .set("high", band_json(&settings.high))
                        .set("highPassHz", settings.high_pass_hz as f64),
                    SlotSpec::Comp { settings, .. } => base
                        .set("thresholdDb", settings.threshold_db as f64)
                        .set("ratio", settings.ratio as f64)
                        .set("attackMs", settings.attack_ms as f64)
                        .set("releaseMs", settings.release_ms as f64)
                        .set("kneeDb", settings.knee_db as f64)
                        .set("makeupDb", settings.makeup_db as f64),
                    SlotSpec::Shape { params, .. } => {
                        let mut p = Value::obj();
                        for (k, v) in params {
                            p = p.set(k, *v as f64);
                        }
                        base.set("params", p)
                    }
                }
            })
            .collect();
        Value::obj()
            .set("slots", Value::Arr(slots))
            .set("master", master_to_json(&self.master))
            .set("active", self.is_active())
    }

    /// Is anything actually going to change the audio?
    pub fn is_active(&self) -> bool {
        if self.master.is_active() {
            return true;
        }
        self.slots.iter().any(|s| match s {
            SlotSpec::Gain { db, bypassed } => !bypassed && db.abs() > 1e-6,
            SlotSpec::Eq { settings, bypassed } => {
                !bypassed
                    && (settings.low.gain_db.abs() > 1e-6
                        || settings.mid.gain_db.abs() > 1e-6
                        || settings.high.gain_db.abs() > 1e-6
                        || settings.high_pass_hz > 20.0)
            }
            SlotSpec::Comp { settings, bypassed } => !bypassed && settings.ratio > 1.0,
            // A shaper that is switched in is doing something, whatever its
            // parameters say. The older three can be switched in and still
            // inert — a gain of zero, an EQ that is flat — but a ring modulator
            // at any setting is audible, and asking each kind whether its own
            // values happen to be inert is nine more things to keep true.
            SlotSpec::Shape { bypassed, .. } => !bypassed,
        })
    }

    /// Build a live rack. Cheap enough to do per render.
    /// Build the live chain.
    ///
    /// The rate and width are needed because a delay-based effect sizes its
    /// buffer from them once and may not resize while running. They are the
    /// *device's*, not the file's, since that is what the chain will actually
    /// be handed.
    pub fn build(&self, sample_rate: u32, channels: usize) -> Rack {
        let mut rack = Rack::new();
        for s in &self.slots {
            if s.bypassed() {
                continue;
            }
            match s {
                SlotSpec::Gain { db, .. } => rack.push(Box::new(Gain { db: *db })),
                SlotSpec::Eq { settings, .. } => rack.push(Box::new(Eq::new(*settings))),
                SlotSpec::Comp { settings, .. } => {
                    rack.push(Box::new(Compressor::new(*settings)))
                }
                SlotSpec::Shape { kind, params, .. } => {
                    rack.push(fx::shape::make(*kind, sample_rate, channels, params))
                }
            }
        }
        // Last, always. The channel compressor exists to hold whatever the
        // chain produced under the ceiling, which it can only do from the end.
        if self.master.is_active() {
            rack.push(Box::new(Maximizer::new(self.master)));
        }
        rack
    }

    /// Combined EQ magnitude response, for drawing the curve in the UI.
    pub fn eq_curve(&self, sample_rate: u32, points: usize) -> Vec<(f32, f32)> {
        let mut eqs: Vec<Eq> = self
            .slots
            .iter()
            .filter_map(|s| match s {
                SlotSpec::Eq { settings, bypassed } if !bypassed => Some(Eq::new(*settings)),
                _ => None,
            })
            .collect();
        if eqs.is_empty() {
            return Vec::new();
        }
        // Log-spaced from 20 Hz to just under Nyquist: linear spacing wastes
        // almost every point above the region people actually adjust.
        let hi = (sample_rate as f32 / 2.0).min(20000.0);
        (0..points)
            .map(|i| {
                let t = i as f32 / (points - 1).max(1) as f32;
                let f = 20.0 * (hi / 20.0).powf(t);
                let mag: f32 = eqs.iter_mut().map(|e| e.magnitude_at(f, sample_rate)).product();
                let db = if mag > 0.0 { 20.0 * mag.log10() } else { -60.0 };
                (f, db)
            })
            .collect()
    }
}

/// Racks by library-relative path.
#[derive(Default)]
pub struct RackStore {
    by_path: Mutex<BTreeMap<String, RackSpec>>,
}

impl RackStore {
    pub fn get(&self, key: &str) -> RackSpec {
        self.by_path
            .lock()
            .unwrap()
            .get(key)
            .cloned()
            .unwrap_or_else(RackSpec::default_chain)
    }

    pub fn set(&self, key: &str, spec: RackSpec) {
        self.by_path.lock().unwrap().insert(key.to_string(), spec);
    }

    pub fn is_active(&self, key: &str) -> bool {
        self.by_path
            .lock()
            .unwrap()
            .get(key)
            .map_or(false, |s| s.is_active())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json;

    #[test]
    fn the_default_chain_is_present_but_changes_nothing() {
        let spec = RackSpec::default_chain();
        assert_eq!(spec.slots.len(), 3);
        assert!(!spec.is_active(), "a fresh rack must not alter the sound");
        assert!(spec.build(48_000, 2).is_empty());
    }

    /// A shaper carries its own parameters, so this is the test that the
    /// generic slot really is generic — every kind, every parameter, out to
    /// JSON and back without a line of code per effect.
    #[test]
    fn every_shaper_survives_a_round_trip_with_its_parameters() {
        use fx::shape::ShapeKind;
        let mut slots = Vec::new();
        for kind in ShapeKind::ALL {
            // Somewhere other than the default for each, so a value that is
            // silently dropped shows up rather than matching by luck.
            let params = kind
                .specs()
                .iter()
                .map(|sp| (sp.key.to_string(), sp.from_unit(0.3)))
                .collect();
            slots.push(SlotSpec::Shape { kind, params, bypassed: false });
        }
        let spec = RackSpec { slots, master: MasterSettings::default() };
        let back = RackSpec::from_json(&spec.to_json());
        assert_eq!(back, spec, "a shaper lost something on the way through JSON");
        assert!(!back.build(48_000, 2).is_empty(), "none of them built");
    }

    /// An unknown kind is dropped rather than guessed at. A slot from a newer
    /// version is not something to invent a default for.
    #[test]
    fn a_slot_this_version_does_not_know_is_left_out() {
        let v = crate::json::parse(
            r#"{"slots":[{"kind":"gain","db":3},{"kind":"telepathy","params":{"x":1}}]}"#,
        )
        .unwrap();
        let back = RackSpec::from_json(&v);
        assert_eq!(back.slots.len(), 1, "an unknown slot was invented instead of dropped");
    }


    #[test]
    fn a_spec_round_trips_through_json() {
        let mut spec = RackSpec::default_chain();
        spec.slots[1] = SlotSpec::Eq {
            settings: EqSettings {
                mid: Band { freq: 2500.0, q: 1.8, gain_db: -6.0 },
                ..EqSettings::default()
            },
            bypassed: false,
        };
        let back = RackSpec::from_json(&spec.to_json());
        assert_eq!(spec, back);
    }

    #[test]
    fn an_enabled_band_with_gain_makes_the_rack_active() {
        let spec = RackSpec {
            slots: vec![SlotSpec::Eq {
                settings: EqSettings {
                    mid: Band { freq: 1000.0, q: 1.0, gain_db: 4.0 },
                    ..EqSettings::default()
                },
                bypassed: false,
            }],
            master: MasterSettings::default(),
        };
        assert!(spec.is_active());
        assert!(!spec.build(48_000, 2).is_empty());
    }

    #[test]
    fn a_flat_enabled_eq_is_not_treated_as_active() {
        // Otherwise every file pays for pre-roll and filtering to achieve nothing.
        let spec = RackSpec {
            slots: vec![SlotSpec::Eq { settings: EqSettings::default(), bypassed: false }],
            master: MasterSettings::default(),
        };
        assert!(!spec.is_active());
    }

    #[test]
    fn a_bypassed_slot_is_left_out_of_the_built_rack() {
        let spec = RackSpec {
            slots: vec![SlotSpec::Gain { db: 12.0, bypassed: true }],
            master: MasterSettings::default(),
        };
        assert!(spec.build(48_000, 2).is_empty());
        assert!(!spec.is_active());
    }

    #[test]
    fn out_of_range_values_are_clamped_rather_than_trusted() {
        // These arrive over HTTP; a ratio of zero or a negative Q would make
        // the filter blow up.
        let v = json::parse(
            r#"{"slots":[{"kind":"comp","bypassed":false,"ratio":-5,"attackMs":0,"thresholdDb":-999},
                         {"kind":"eq","bypassed":false,"mid":{"freq":9e9,"q":-1,"gainDb":900}}]}"#,
        )
        .unwrap();
        let spec = RackSpec::from_json(&v);
        match &spec.slots[0] {
            SlotSpec::Comp { settings, .. } => {
                assert!(settings.ratio >= 1.0);
                assert!(settings.attack_ms > 0.0);
                assert!(settings.threshold_db >= -60.0);
            }
            _ => panic!("expected a compressor"),
        }
        match &spec.slots[1] {
            SlotSpec::Eq { settings, .. } => {
                assert!(settings.mid.freq <= 24000.0);
                assert!(settings.mid.q > 0.0);
                assert!(settings.mid.gain_db <= 24.0);
            }
            _ => panic!("expected an EQ"),
        }
    }

    #[test]
    fn an_unknown_effect_kind_is_ignored_not_fatal() {
        let v = json::parse(r#"{"slots":[{"kind":"reverb"},{"kind":"gain","db":3}]}"#).unwrap();
        let spec = RackSpec::from_json(&v);
        assert_eq!(spec.slots.len(), 1);
    }

    #[test]
    fn the_eq_curve_is_flat_when_nothing_is_boosted() {
        let spec = RackSpec {
            slots: vec![SlotSpec::Eq { settings: EqSettings::default(), bypassed: false }],
            master: MasterSettings::default(),
        };
        for (f, db) in spec.eq_curve(48000, 64) {
            assert!(db.abs() < 0.1, "flat EQ curved by {db} dB at {f} Hz");
        }
    }

    #[test]
    fn the_eq_curve_peaks_near_the_boosted_band() {
        let spec = RackSpec {
            slots: vec![SlotSpec::Eq {
                settings: EqSettings {
                    mid: Band { freq: 1000.0, q: 2.0, gain_db: 10.0 },
                    ..EqSettings::default()
                },
                bypassed: false,
            }],
            master: MasterSettings::default(),
        };
        let curve = spec.eq_curve(48000, 200);
        let (peak_f, peak_db) = curve
            .iter()
            .cloned()
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap())
            .unwrap();
        assert!((peak_db - 10.0).abs() < 0.6, "peak was {peak_db} dB");
        assert!((peak_f - 1000.0).abs() < 120.0, "peak sat at {peak_f} Hz");
    }

    #[test]
    fn the_store_hands_out_a_default_chain_for_unknown_files() {
        let store = RackStore::default();
        assert_eq!(store.get("never/seen.wav"), RackSpec::default_chain());
        assert!(!store.is_active("never/seen.wav"));
    }

    #[test]
    fn the_store_remembers_what_was_set() {
        let store = RackStore::default();
        store.set("a.wav", RackSpec { slots: vec![SlotSpec::Gain { db: 5.0, bypassed: false }], master: MasterSettings::default() });
        assert!(store.is_active("a.wav"));
        assert_eq!(store.get("a.wav").slots.len(), 1);
    }
}
