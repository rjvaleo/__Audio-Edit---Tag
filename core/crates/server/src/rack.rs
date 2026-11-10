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
    /// A stable name per slot, parallel to `slots`.
    ///
    /// Automation lanes address a slot by this rather than by position, so
    /// dragging a module along the rail moves the effect and takes its lanes
    /// with it. Position alone would repoint every lane on a reorder — silently,
    /// and onto whatever effect happened to land there.
    pub slot_ids: Vec<String>,
    /// The channel's own compressor, after everything in the chain. Not a slot:
    /// it is not something you add and cannot be reordered, because the end of
    /// the chain is the only place it means anything.
    pub master: MasterSettings,
    /// The Prism pad's setup for each source that has one: a slot id, or
    /// `pad::STRETCH` for Time & Pitch. A preference of the slot, so it
    /// travels with the rack.
    pub pads: BTreeMap<String, crate::pad::PadSetup>,
    /// Hyperprism's Pitch Time Changer, which runs between the engine and the
    /// rack when it is on. The document's, so it travels with the rack.
    pub pitch_time: engine::transport::PitchTime,
    /// Hyperprism's Post-Roll for each pad source that has one, in ms: a slot
    /// id, `stretch` or `ptc`. The longest is what plays.
    pub post_roll: BTreeMap<String, f32>,
    /// Each knob's own range, per slot id: the Advanced page of a built-in
    /// effect. A preference of the slot, like its pad, so it travels with the
    /// rack. The engine still clamps every value to the effect's own limits;
    /// this only says what part of them a knob sweeps.
    pub ranges: BTreeMap<String, BTreeMap<String, KnobRange>>,
    /// Each module's own Wet/dry and Level, per slot id, for the ones not at
    /// full wet and nought dB. In JSON they are `wet` and `level` on the slot.
    pub mixes: BTreeMap<String, SlotMix>,
}

/// A module's footer: 0..1, and dB.
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

/// One knob's sweep: where its travel starts and ends, and whether it is
/// logarithmic.
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
    /// An effect from `prism-fx`, shared with idMLab. Like a shaper it
    /// describes its own parameters; its kind in JSON is `prism:<id>`, and the
    /// id and keys are the crate's descriptor's.
    Prism { id: &'static str, params: Vec<(String, f32)>, sound: Option<String>, bypassed: bool },
}

impl SlotSpec {
    fn bypassed(&self) -> bool {
        match self {
            SlotSpec::Gain { bypassed, .. }
            | SlotSpec::Eq { bypassed, .. }
            | SlotSpec::Comp { bypassed, .. }
            | SlotSpec::Shape { bypassed, .. }
            | SlotSpec::Prism { bypassed, .. } => *bypassed,
        }
    }

    fn kind(&self) -> &'static str {
        match self {
            SlotSpec::Gain { .. } => "gain",
            SlotSpec::Eq { .. } => "eq",
            SlotSpec::Comp { .. } => "comp",
            SlotSpec::Shape { kind, .. } => kind.as_str(),
            SlotSpec::Prism { id, .. } => fx::prism::kind(id).unwrap_or("prism:"),
        }
    }

    /// What this slot is called in a menu, as opposed to in JSON.
    /// Take another slot's settings, keeping this one's place in the chain.
    ///
    /// Only between slots of the same kind — a preset's reverb has nothing to
    /// say to a compressor. The bypass switch is deliberately *not* carried
    /// across: whether a module is switched in is a property of the chain you
    /// built, not of the sound you are dropping onto it, and a preset that
    /// silently muted a module would be very hard to diagnose.
    pub fn take_settings_from(&mut self, other: &SlotSpec) -> bool {
        match (self, other) {
            (SlotSpec::Gain { db, .. }, SlotSpec::Gain { db: d, .. }) => *db = *d,
            (SlotSpec::Eq { settings, .. }, SlotSpec::Eq { settings: o, .. }) => {
                *settings = o.clone()
            }
            (SlotSpec::Comp { settings, .. }, SlotSpec::Comp { settings: o, .. }) => {
                *settings = o.clone()
            }
            (
                SlotSpec::Shape { kind, params, .. },
                SlotSpec::Shape { kind: k, params: pr, .. },
            ) => {
                // A shaper's kind decides which controls it has, so taking one
                // shaper's values into another kind would write nonsense. Same
                // kind or nothing.
                if kind != k {
                    return false;
                }
                *params = pr.clone();
            }
            (SlotSpec::Prism { id, params, sound, .. }, SlotSpec::Prism { id: i, params: pr, sound: so, .. }) => {
                // As for shapers: the effect decides which controls exist. The
                // impulse is part of the sound being dropped on, so it comes too.
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
            SlotSpec::Prism { id, .. } => fx::prism::descriptor(id).map_or("Effect", |d| d.label),
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

/// The pads that still have something to drive: Time & Pitch, or a slot in
/// this rack, with controls it still has.
fn pads_from_json(v: Option<&Value>, spec: &RackSpec) -> BTreeMap<String, crate::pad::PadSetup> {
    let mut out = BTreeMap::new();
    let Some(Value::Obj(map)) = v else { return out };
    let sources = crate::pad::sources(spec);
    for (id, setup) in map {
        let Some(source) = sources.iter().find(|s| &s.id == id) else { continue };
        if let Some(pad) = crate::pad::PadSetup::from_json(setup, source) {
            out.insert(id.clone(), pad);
        }
    }
    out
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
        }
    }

    /// The rack a file starts with: an EQ and a compressor, both **on**.
    ///
    /// On rather than bypassed, because a module that arrives switched off
    /// reads as broken — you move a control and nothing happens. They are safe
    /// to leave running because both start genuinely inert: the EQ is flat, and
    /// the compressor starts at 1:1, which is a ratio that cannot compress.
    /// Invariant 9 still holds — a document nobody has touched renders exactly
    /// what it did before the rack existed — but it holds because of the
    /// settings rather than because the chain is switched out.
    ///
    /// No gain stage. Every module carries its own level, the maximiser is at
    /// the end of the chain, and a gain slot at the front was one more thing to
    /// check when something came out quiet.
    pub fn default_chain() -> Self {
        RackSpec {
            slots: vec![
                SlotSpec::Eq { settings: EqSettings::default(), bypassed: false },
                SlotSpec::Comp {
                    settings: CompSettings { ratio: 1.0, ..CompSettings::default() },
                    bypassed: false,
                },
            ],
            slot_ids: vec!["factory-eq".into(), "factory-comp".into()],
            master: MasterSettings::default(),
            pads: BTreeMap::new(),
            pitch_time: Default::default(),
            post_roll: BTreeMap::new(),
            ranges: BTreeMap::new(),
            mixes: BTreeMap::new(),
        }
    }

    pub fn from_json(v: &Value) -> Self {
        let master = master_from_json(v.get("master"));
        let Some(Value::Arr(items)) = v.get("slots") else {
            return RackSpec { master, ..RackSpec::empty() };
        };
        let mut slots = Vec::new();
        let mut slot_ids = Vec::new();
        let mut mixes = BTreeMap::new();
        for (index, it) in items.iter().enumerate() {
            let kind = it.get("kind").and_then(|k| k.as_str()).unwrap_or("");
            let bypassed = flag(it.get("bypassed"));
            // A rack saved before slots had names gets one derived from where
            // it sat, which is stable for as long as nothing is reordered —
            // the best that can be done for a document that never had one.
            let id = it
                .get("id")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("legacy-{kind}-{index}"));
            let before = slots.len();
            match kind {
                "gain" => slots.push(SlotSpec::Gain {
                    db: num(it.get("db"), 0.0).clamp(-48.0, 48.0),
                    bypassed,
                }),
                "eq" => {
                    let mut d = EqSettings::default();
                    // Eight nodes, each with its own filter type. A rack saved
                    // before the EQ had them carries `low`/`mid`/`high` instead
                    // and is read that way, so nothing written by an older
                    // build loses its curve.
                    if let Some(Value::Arr(bands)) = it.get("bands") {
                        let base = d.bands();
                        for (i, value) in bands.iter().take(8).enumerate() {
                            let b = band_from(Some(value), base[i]);
                            match i {
                                // Not through `band_from`: a high-pass at zero
                                // is one that is out of the way, and the band
                                // range starts at 10 Hz, so clamping it there
                                // would move a filter nobody asked to move.
                                0 => {
                                    d.high_pass_hz =
                                        num(value.get("freq"), 0.0).clamp(0.0, fx::eq::EQ_FREQ_MAX)
                                }
                                1 => d.low = b,
                                2 => d.mid = b,
                                3..=5 => d.extra[i - 3] = b,
                                6 => d.high = b,
                                _ => d.low_pass_hz = b.freq,
                            }
                            d.modes[i] =
                                eq_mode(value.get("type").and_then(Value::as_str).unwrap_or("bell"));
                            d.enabled[i] = flag(value.get("enabled"));
                        }
                    } else {
                        d.low = band_from(it.get("low"), d.low);
                        d.mid = band_from(it.get("mid"), d.mid);
                        d.high = band_from(it.get("high"), d.high);
                        d.high_pass_hz = num(it.get("highPassHz"), 0.0).clamp(0.0, 24000.0);
                        d.enabled[0] = d.high_pass_hz > fx::eq::EQ_HP_OFF;
                    }
                    slots.push(SlotSpec::Eq { settings: d, bypassed })
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
                other if fx::prism::id_for_kind(other).is_some() => {
                    // A prism effect, or a kind that has moved into one — the
                    // old Echo's `dattorro_echo` among them — with its values
                    // read by the same keys.
                    let id = fx::prism::id_for_kind(other).unwrap_or_default();
                    let mut params = Vec::new();
                    for spec in fx::prism::specs(id).unwrap_or_default() {
                        let v = num(it.get("params").and_then(|p| p.get(spec.key)), spec.default);
                        params.push((spec.key.to_string(), fx::prism::clamp(id, spec.key, v).unwrap_or(v)));
                    }
                    // The sound it takes, by library path, where it takes one.
                    let sound = fx::prism::sound_input(id)
                        .and(it.get("sound").and_then(Value::as_str))
                        .filter(|p| !p.is_empty())
                        .map(str::to_string);
                    slots.push(SlotSpec::Prism { id, params, sound, bypassed });
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
            // Only if the slot survived: an unknown kind is dropped, and its
            // name has to go with it or the two lists come apart.
            if slots.len() > before {
                let mix = SlotMix {
                    wet: num(it.get("wet"), 1.0).clamp(0.0, 1.0),
                    level: num(it.get("level"), 0.0).clamp(fx::SLOT_LEVEL_MIN, fx::SLOT_LEVEL_MAX),
                };
                if mix != SlotMix::default() {
                    mixes.insert(id.clone(), mix);
                }
                slot_ids.push(id);
            }
        }
        let mut spec = RackSpec {
            slots,
            slot_ids,
            master,
            pads: BTreeMap::new(),
            pitch_time: pitch_time_from_json(v.get("pitchTime")),
            post_roll: BTreeMap::new(),
            ranges: BTreeMap::new(),
            mixes,
        };
        spec.pads = pads_from_json(v.get("pads"), &spec);
        if let Some(Value::Obj(m)) = v.get("ranges") {
            for (id, keys) in m {
                // Only for a slot that is here, as for the pads and post-roll.
                let (true, Value::Obj(keys)) = (spec.slot_ids.contains(id), keys) else { continue };
                let mut out = BTreeMap::new();
                for (key, r) in keys {
                    let (Some(Value::Num(lo)), Some(Value::Num(hi))) = (r.get("min"), r.get("max")) else { continue };
                    if !lo.is_finite() || !hi.is_finite() || hi <= lo {
                        continue;
                    }
                    let log = matches!(r.get("log"), Some(Value::Bool(true)));
                    out.insert(key.clone(), KnobRange { min: *lo as f32, max: *hi as f32, log });
                }
                if !out.is_empty() {
                    spec.ranges.insert(id.clone(), out);
                }
            }
        }
        if let Some(Value::Obj(m)) = v.get("postRoll") {
            for (id, ms) in m {
                let known = id == crate::pad::STRETCH || id == crate::pad::PITCH_TIME || spec.slot_ids.contains(id);
                if let (true, Value::Num(n)) = (known, ms) {
                    if n.is_finite() {
                        spec.post_roll.insert(id.clone(), (*n as f32).max(0.0));
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
                let mut base = Value::obj()
                    .set("kind", s.kind())
                    .set("id", self.slot_ids.get(i).cloned().unwrap_or_default())
                    .set("bypassed", s.bypassed());
                if let Some(m) = self.slot_ids.get(i).and_then(|id| self.mixes.get(id)) {
                    base = base.set("wet", m.wet as f64).set("level", m.level as f64);
                }
                match s {
                    SlotSpec::Gain { db, .. } => base.set("db", *db as f64),
                    SlotSpec::Eq { settings, .. } => {
                        let bands = settings.bands();
                        base
                            // The old names as well as the new list: anything
                            // reading a rack written here — a preset, a saved
                            // session, an exported file's metadata — keeps
                            // working, and gains the rest.
                            .set("low", band_json(&settings.low))
                            .set("mid", band_json(&settings.mid))
                            .set("high", band_json(&settings.high))
                            .set("highPassHz", settings.high_pass_hz as f64)
                            .set(
                                "bands",
                                Value::Arr(
                                    (0..8)
                                        .map(|i| {
                                            band_json(&bands[i])
                                                .set("type", eq_mode_name(settings.modes[i]))
                                                .set("enabled", settings.enabled[i])
                                        })
                                        .collect(),
                                ),
                            )
                    }
                    SlotSpec::Comp { settings, .. } => base
                        .set("thresholdDb", settings.threshold_db as f64)
                        .set("ratio", settings.ratio as f64)
                        .set("attackMs", settings.attack_ms as f64)
                        .set("releaseMs", settings.release_ms as f64)
                        .set("kneeDb", settings.knee_db as f64)
                        .set("makeupDb", settings.makeup_db as f64),
                    SlotSpec::Shape { params, .. } | SlotSpec::Prism { params, .. } => {
                        let mut p = Value::obj();
                        for (k, v) in params {
                            p = p.set(k, *v as f64);
                        }
                        let base = match s {
                            SlotSpec::Prism { sound: Some(path), .. } => base.set("sound", path.as_str()),
                            _ => base,
                        };
                        base.set("params", p)
                    }
                }
            })
            .collect();
        let mut pads = Value::obj();
        for (id, pad) in &self.pads {
            pads = pads.set(id, pad.to_json());
        }
        Value::obj()
            .set("slots", Value::Arr(slots))
            .set("pads", pads)
            .set("pitchTime", pitch_time_to_json(&self.pitch_time))
            .set("postRoll", {
                let mut m = Value::obj();
                for (id, ms) in &self.post_roll {
                    m = m.set(id, *ms as f64);
                }
                m
            })
            .set("ranges", {
                let mut m = Value::obj();
                for (id, keys) in &self.ranges {
                    let mut k = Value::obj();
                    for (key, r) in keys {
                        k = k.set(key, Value::obj().set("min", r.min as f64).set("max", r.max as f64).set("log", r.log));
                    }
                    m = m.set(id, k);
                }
                m
            })
            .set("master", master_to_json(&self.master))
            .set("active", self.is_active())
    }

    /// The post-roll that plays: the longest any source has, in ms.
    pub fn post_roll_ms(&self) -> f32 {
        self.post_roll.values().fold(0.0f32, |m, v| m.max(*v))
    }

    /// Is anything actually going to change the audio?
    pub fn is_active(&self) -> bool {
        if self.master.is_active() {
            return true;
        }
        let trimmed = self.slots.iter().enumerate().any(|(i, s)| {
            !s.bypassed() && self.slot_ids.get(i).is_some_and(|id| self.mixes.contains_key(id))
        });
        if trimmed {
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
            SlotSpec::Shape { bypassed, .. } | SlotSpec::Prism { bypassed, .. } => !bypassed,
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
            // Every effect is `prism-fx`'s, shared with idMLab, built as this
            // program's own was and given the stored settings by key
            // (`fx::prism::moved`); `fx/tests/prism_parity.rs` holds each to
            // the render the old one made, bit for bit.
            let effect: Box<dyn fx::Effect> = match s {
                // The prism Gain takes ±24 dB, every control's range; a
                // document edited by hand past it keeps this program's own.
                SlotSpec::Gain { db, .. } if db.abs() <= fx::GAIN_DB_MAX => {
                    moved("gain", sample_rate, &[("db".to_string(), *db)], || Box::new(Gain { db: *db }))
                }
                SlotSpec::Gain { db, .. } => Box::new(Gain { db: *db }),
                SlotSpec::Eq { settings, .. } => moved("eq", sample_rate, &eq_params(settings), || Box::new(Eq::new(*settings))),
                SlotSpec::Comp { settings, .. } => {
                    moved("compressor", sample_rate, &comp_params(settings), || Box::new(Compressor::new(*settings)))
                }
                SlotSpec::Shape { kind, params, .. } => {
                    fx::shape::make(*kind, sample_rate, channels, params)
                }
                // The id came from the catalogue when the slot was read, so
                // this cannot miss; a gain of nothing keeps slot *n* at *n* if
                // it somehow did.
                SlotSpec::Prism { id, params, sound, .. } => {
                    fx::prism::make_with_sound(id, sample_rate, channels, params, sound.as_deref())
                        .unwrap_or_else(|| Box::new(Gain { db: 0.0 }))
                }
            };
            // A bypassed slot is built and switched off rather than skipped, so
            // that slot *n* in the rack is slot *n* in the spec. Automation
            // addresses slots by position; dropping one would shift every lane
            // after it onto the wrong effect, and only while something upstream
            // happened to be bypassed — a bug that appears and disappears with
            // a switch nowhere near it. `Rack::process` already skips bypassed
            // slots, so this costs one construction and no audio.
            rack.push_slot(effect, s.bypassed());
        }
        // Slot *n* is spec slot *n*: the same reason a bypassed one is kept.
        for (i, id) in self.slot_ids.iter().enumerate() {
            if let (Some(m), Some(slot)) = (self.mixes.get(id), rack.slots.get_mut(i)) {
                slot.set_mix(m.wet, m.level);
            }
        }
        rack.reserve_mix(crate::live::MAX_BLOCK * channels.max(1));
        // Last, always. The channel compressor exists to hold whatever the
        // chain produced under the ceiling, which it can only do from the end.
        if self.master.is_active() {
            let master = self.master;
            rack.push(moved("maximizer", sample_rate, &master_params(&master), || Box::new(Maximizer::new(master))));
        }
        rack
    }

    /// Write one control on one slot of the *spec*.
    ///
    /// The same keys the live effects take, so a control moved on screen, a
    /// lane driving it, and the value the export reads are all the same name
    /// and the same range. `false` for a slot or key that does not exist.
    pub fn set_param(&mut self, slot: usize, key: &str, value: f32) -> bool {
        if key == fx::SLOT_WET || key == fx::SLOT_LEVEL {
            return self.set_mix(slot, key, value);
        }
        let Some(s) = self.slots.get_mut(slot) else {
            return false;
        };
        match s {
            SlotSpec::Gain { db, .. } if key == "db" => {
                *db = value.clamp(fx::GAIN_DB_MIN, fx::GAIN_DB_MAX);
                true
            }
            SlotSpec::Eq { settings, .. } => set_eq_param(settings, key, value),
            SlotSpec::Comp { settings, .. } => set_comp_param(settings, key, value),
            SlotSpec::Shape { kind, params, .. } => {
                let Some(spec) = kind.specs().iter().find(|p| p.key == key) else {
                    return false;
                };
                let v = spec.clamp(value);
                match params.iter_mut().find(|(k, _)| k == key) {
                    Some(entry) => entry.1 = v,
                    None => params.push((key.to_string(), v)),
                }
                true
            }
            SlotSpec::Prism { id, params, .. } => {
                let Some(v) = fx::prism::clamp(id, key, value) else {
                    return false;
                };
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
        let Some(id) = self.slot_ids.get(slot).filter(|_| slot < self.slots.len()).cloned() else {
            return false;
        };
        let mut m = self.mixes.get(&id).copied().unwrap_or_default();
        if key == fx::SLOT_WET {
            m.wet = value.clamp(0.0, 1.0);
        } else {
            m.level = value.clamp(fx::SLOT_LEVEL_MIN, fx::SLOT_LEVEL_MAX);
        }
        if m == SlotMix::default() {
            self.mixes.remove(&id);
        } else {
            self.mixes.insert(id, m);
        }
        true
    }

    /// Read one control back, after clamping.
    pub fn get_param(&self, slot: usize, key: &str) -> Option<f32> {
        if key == fx::SLOT_WET || key == fx::SLOT_LEVEL {
            let m = self.slot_ids.get(slot).and_then(|id| self.mixes.get(id)).copied().unwrap_or_default();
            return Some(if key == fx::SLOT_WET { m.wet } else { m.level });
        }
        match self.slots.get(slot)? {
            SlotSpec::Gain { db, .. } if key == "db" => Some(*db),
            SlotSpec::Eq { settings, .. } => get_eq_param(settings, key),
            SlotSpec::Comp { settings, .. } => get_comp_param(settings, key),
            SlotSpec::Shape { params, .. } | SlotSpec::Prism { params, .. } => {
                params.iter().find(|(k, _)| k == key).map(|(_, v)| *v)
            }
            _ => None,
        }
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

/// The Pitch Time Changer from a rack's JSON, each value held to its window's
/// range; anything missing is the window's own starting value.
fn pitch_time_from_json(v: Option<&Value>) -> engine::transport::PitchTime {
    merge_pitch_time(engine::transport::PitchTime::default(), v)
}

/// `base` with whatever `v` says over it, each value held to its range — what
/// a pad move or a switch posts is only the part that changed.
pub fn merge_pitch_time(base: engine::transport::PitchTime, v: Option<&Value>) -> engine::transport::PitchTime {
    let d = base;
    let Some(v) = v else { return d };
    let n = |k: &str, def: f32, lo: f32, hi: f32| match v.get(k) {
        Some(Value::Num(x)) if x.is_finite() => (*x as f32).clamp(lo, hi),
        _ => def,
    };
    engine::transport::PitchTime {
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

pub fn pitch_time_to_json(p: &engine::transport::PitchTime) -> Value {
    Value::obj()
        .set("on", p.on)
        .set("speed", p.speed as f64)
        .set("pitch", p.pitch as f64)
        .set("feedback", p.feedback as f64)
        .set("grain", p.grain as f64)
        .set("xfade", p.xfade as f64)
        .set("smoothing", p.smoothing as f64)
}

#[cfg(test)]
mod tests;


// The EQ and compressor keep their settings in named fields rather than a
// parameter list, so the mapping from key to field is written once here and
// used by the live control route, automation and the interface alike.
/// `band.<0..7>.<freq|q|gainDb|enabled|mode>`, the same keys the live effect
/// takes, so a control moved on screen, a lane driving it and the value the
/// export reads are one name and one range.
fn set_eq_param(s: &mut EqSettings, key: &str, v: f32) -> bool {
    use fx::eq::*;
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

/// A moved effect, given the stored settings, or this program's own should the
/// prism one not hold every one of them exactly — a value a document keeps
/// outside the control's range, such as a high-pass parked at 0 Hz, below the
/// band's 10. Exact either way.
fn moved(id: &str, sample_rate: u32, params: &[(String, f32)], own: impl FnOnce() -> Box<dyn fx::Effect>) -> Box<dyn fx::Effect> {
    match fx::prism::moved(id, sample_rate, params) {
        Some(e) if params.iter().all(|(k, v)| e.get_param(k).map(f32::to_bits) == Some(v.to_bits())) => e,
        _ => own(),
    }
}

/// Every control of the prism `id`, read out of stored settings by key.
fn keyed(id: &str, get: impl Fn(&str) -> Option<f32>) -> Vec<(String, f32)> {
    fx::prism::specs(id)
        .unwrap_or(&[])
        .iter()
        .filter_map(|spec| get(spec.key).map(|v| (spec.key.to_string(), v)))
        .collect()
}

fn eq_params(s: &EqSettings) -> Vec<(String, f32)> {
    keyed("eq", |key| get_eq_param(s, key))
}

fn comp_params(s: &CompSettings) -> Vec<(String, f32)> {
    keyed("compressor", |key| get_comp_param(s, key))
}

fn master_params(m: &MasterSettings) -> Vec<(String, f32)> {
    use fx::params::Params;
    let built = Maximizer::new(*m);
    keyed("maximizer", |key| built.get(key))
}

fn get_eq_param(s: &EqSettings, key: &str) -> Option<f32> {
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

/// What a node is called on a menu: its type, and its position when two nodes
/// share one.
pub fn eq_band_label(m: fx::eq::EqMode, index: usize) -> String {
    use fx::eq::EqMode::*;
    match m {
        HighPass => "High-pass".into(),
        LowPass => "Low-pass".into(),
        LowShelf => "Low shelf".into(),
        HighShelf => "High shelf".into(),
        Notch => format!("Notch {index}"),
        Bell => format!("Bell {index}"),
    }
}

fn eq_mode(name: &str) -> fx::eq::EqMode {
    use fx::eq::EqMode::*;
    match name {
        "highpass" => HighPass,
        "lowshelf" => LowShelf,
        "notch" => Notch,
        "highshelf" => HighShelf,
        "lowpass" => LowPass,
        _ => Bell,
    }
}

fn eq_mode_name(m: fx::eq::EqMode) -> &'static str {
    use fx::eq::EqMode::*;
    match m {
        HighPass => "highpass",
        LowShelf => "lowshelf",
        Bell => "bell",
        Notch => "notch",
        HighShelf => "highshelf",
        LowPass => "lowpass",
    }
}

/// The modes as numbers, so automation can move one. In the order the
/// interface lists them.
fn eq_mode_index(m: fx::eq::EqMode) -> f32 {
    use fx::eq::EqMode::*;
    match m {
        HighPass => 0.0,
        LowShelf => 1.0,
        Bell => 2.0,
        Notch => 3.0,
        HighShelf => 4.0,
        LowPass => 5.0,
    }
}

fn eq_mode_from_index(v: f32) -> fx::eq::EqMode {
    use fx::eq::EqMode::*;
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
    use fx::comp::*;
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

fn get_comp_param(s: &CompSettings, key: &str) -> Option<f32> {
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

#[cfg(test)]
mod mix_tests;
