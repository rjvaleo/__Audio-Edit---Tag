//! Breakpoint automation: a curve per control, over the document's timeline.
//!
//! A lane stores **unit values, 0..1**, never real ones. The range belongs to
//! the effect, so retuning a control's limits later does not silently move
//! every saved lane — and there is exactly one place each range is written
//! down, in `fx`, which both this and the interface read. The alternative was
//! tried on the branch this came from: the interface recorded EQ frequency
//! against 20 Hz–20 kHz while playback resolved it against 10 Hz–24 kHz, so a
//! band recorded at 1 kHz played back at 820 Hz and nothing said so.
//!
//! Lanes are indexed in **document frames** — the timeline the waveform draws
//! and the export writes, after any stretch. The engine counts output frames at
//! the device's rate, so [`Runner`] converts; that conversion is the only place
//! the two clocks meet.

use crate::json::{self, Value};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Mutex;

/// Bumped when the stored shape changes in a way a reader must know about.
pub const VERSION: f64 = 1.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Curve {
    Step,
    Linear,
    Smooth,
    Exponential,
    Bezier,
}

impl Curve {
    pub fn name(self) -> &'static str {
        match self {
            Self::Step => "step",
            Self::Linear => "linear",
            Self::Smooth => "smooth",
            Self::Exponential => "exponential",
            Self::Bezier => "bezier",
        }
    }
    pub fn from(s: &str) -> Self {
        match s {
            "step" => Self::Step,
            "smooth" => Self::Smooth,
            "exponential" => Self::Exponential,
            "bezier" => Self::Bezier,
            _ => Self::Linear,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Point {
    pub frame: u64,
    pub value: f32,
    /// How the curve leaves this point toward the next one.
    pub curve: Curve,
    pub tension: f32,
}

/// Control sources added on top of a lane's curve.
///
/// Every one of these is a pure function of time and the lane's own settings.
/// That is deliberate: the waveform drawing, playback and export are three
/// separate evaluations of the same lane, and a modulator holding running state
/// would give each of them different numbers — the same rule the grain cloud
/// lives by (`fx::grain`).
///
/// Followers — an envelope, a transient detector, a grain-density tap — are
/// **not here**. They need a real detector reading the signal, and the version
/// of this that came before shipped all three as `signal * depth` with their
/// attack, release, sensitivity and source controls parsed, saved, shown in the
/// dialog and never read. A control that does nothing is worse than a missing
/// one.
#[derive(Debug, Clone, PartialEq)]
pub enum Modulator {
    Lfo {
        shape: String,
        rate: f32,
        depth: f32,
        offset: f32,
        phase: f32,
    },
    Steps {
        rate: f32,
        values: Vec<f32>,
    },
    SampleHold {
        rate: f32,
        depth: f32,
        seed: u64,
    },
}

impl Modulator {
    pub fn value(&self, seconds: f64) -> f32 {
        match self {
            Self::Lfo {
                shape,
                rate,
                depth,
                offset,
                phase,
            } => {
                let p = (seconds as f32 * *rate + *phase).rem_euclid(1.0);
                let raw = match shape.as_str() {
                    "triangle" => 1.0 - (4.0 * p - 2.0).abs(),
                    "square" => {
                        if p < 0.5 {
                            1.0
                        } else {
                            -1.0
                        }
                    }
                    "ramp" => p * 2.0 - 1.0,
                    _ => (p * std::f32::consts::TAU).sin(),
                };
                (*offset + raw * *depth).clamp(-1.0, 1.0)
            }
            Self::Steps { rate, values } => {
                if values.is_empty() {
                    0.0
                } else {
                    let i = (seconds * *rate as f64).floor().max(0.0) as usize;
                    values[i % values.len()].clamp(-1.0, 1.0)
                }
            }
            Self::SampleHold { rate, depth, seed } => {
                let step = (seconds * *rate as f64).floor().max(0.0) as u64;
                ((hash_unit(step ^ *seed) * 2.0 - 1.0) * *depth).clamp(-1.0, 1.0)
            }
        }
    }

    fn kind(&self) -> &'static str {
        match self {
            Self::Lfo { .. } => "lfo",
            Self::Steps { .. } => "steps",
            Self::SampleHold { .. } => "sampleHold",
        }
    }
}

/// splitmix64's finaliser. A pure function of the step index, so a sample-and-hold
/// draws the same numbers in the waveform, in playback and in the export.
fn hash_unit(mut x: u64) -> f32 {
    x ^= x >> 30;
    x = x.wrapping_mul(0xbf58476d1ce4e5b9);
    x ^= x >> 27;
    x = x.wrapping_mul(0x94d049bb133111eb);
    x ^= x >> 31;
    (x >> 32) as f32 / u32::MAX as f32
}

#[derive(Debug, Clone, PartialEq)]
pub struct Lane {
    pub id: String,
    pub target: String,
    pub label: String,
    pub enabled: bool,
    /// Added to the curve before the modulators, so a lane can be nudged as a
    /// whole without redrawing it.
    pub trim: f32,
    /// Wrap the *curve* between these two document frames. The modulators keep
    /// running on absolute time, so an LFO under a looping curve does not
    /// restart every pass.
    pub loop_range: Option<(u64, u64)>,
    pub points: Vec<Point>,
    pub modulators: Vec<Modulator>,
}

impl Lane {
    pub fn value_at(&self, frame: u64, seconds: f64) -> Option<f32> {
        if !self.enabled {
            return None;
        }
        let mut at = frame;
        if let Some((a, b)) = self.loop_range.filter(|(a, b)| b > a) {
            if at >= a {
                at = a + (at - a) % (b - a);
            }
        }
        let mut v = curve_value(&self.points, at)? + self.trim;
        for m in &self.modulators {
            v += m.value(seconds);
        }
        Some(v.clamp(0.0, 1.0))
    }
}

/// The lane's value at a frame, or `None` if it has no points at all.
///
/// Before the first point and after the last, the lane **holds** — it does not
/// fall to zero. A curve you drew across the first half of a file goes on
/// meaning something for the second half.
pub fn curve_value(points: &[Point], frame: u64) -> Option<f32> {
    let first = points.first()?;
    if frame <= first.frame {
        return Some(first.value.clamp(0.0, 1.0));
    }
    let Some(right) = points.iter().position(|p| p.frame >= frame) else {
        return Some(points.last()?.value.clamp(0.0, 1.0));
    };
    let (a, b) = (&points[right - 1], &points[right]);
    if b.frame == a.frame {
        return Some(b.value.clamp(0.0, 1.0));
    }
    let mut t = (frame - a.frame) as f32 / (b.frame - a.frame) as f32;
    t = match a.curve {
        Curve::Step => 0.0,
        Curve::Linear => t,
        Curve::Smooth => t * t * (3.0 - 2.0 * t),
        Curve::Exponential => t.powf((2.0f32).powf(a.tension.clamp(-2.0, 2.0))),
        Curve::Bezier => {
            let k = (0.5 + a.tension.clamp(-1.0, 1.0) * 0.45).clamp(0.05, 0.95);
            if t < k {
                0.5 * (t / k).powi(2)
            } else {
                1.0 - 0.5 * ((1.0 - t) / (1.0 - k)).powi(2)
            }
        }
    };
    Some((a.value + (b.value - a.value) * t).clamp(0.0, 1.0))
}

/// Everything automating one document.
///
/// `frames`, `channels` and `sample_rate` are what the source looked like when
/// these lanes were drawn. Points are frame offsets; if the file underneath
/// changed length they point at the wrong audio, so [`Automation::matches`]
/// refuses them — the same rule a saved session lives by
/// (`persist::edit_from_json`), and for the same reason.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Automation {
    pub lanes: Vec<Lane>,
    pub bypassed: bool,
    pub frames: u64,
    pub channels: u16,
    pub sample_rate: u32,
}

impl Automation {
    /// Whether these lanes were drawn against the file that is here now.
    ///
    /// Automation written before this field existed carries zeros and is
    /// accepted: it predates the check rather than failing it.
    pub fn matches(&self, frames: u64, channels: u16, sample_rate: u32) -> bool {
        if self.frames == 0 && self.channels == 0 && self.sample_rate == 0 {
            return true;
        }
        self.frames == frames && self.channels == channels && self.sample_rate == sample_rate
    }

    /// Enabled lanes that drive the document's own stretch or grain settings.
    ///
    /// These are the ones an offline export cannot honour. The rack is a chain
    /// the export can move block by block; the stretch is not — WSOLA picks
    /// each splice from the one before it, so the whole thing is rendered in
    /// one pass with one set of parameters. Making these work offline means
    /// running the streaming engines the audio thread uses, which is real work
    /// and not yet done.
    ///
    /// Named rather than counted so the refusal can say which lane.
    pub fn offline_unsupported(&self) -> Vec<&str> {
        self.lanes
            .iter()
            .filter(|l| l.enabled && !l.points.is_empty() && l.target.starts_with("stretch."))
            .map(|l| l.label.as_str())
            .collect()
    }

    pub fn is_silent(&self) -> bool {
        self.bypassed || self.lanes.iter().all(|l| !l.enabled || l.points.is_empty())
    }

    pub fn to_json(&self) -> Value {
        Value::obj()
            .set("version", VERSION)
            .set("bypassed", self.bypassed)
            .set("frames", self.frames)
            .set("channels", self.channels as f64)
            .set("sampleRate", self.sample_rate)
            .set(
                "lanes",
                Value::Arr(self.lanes.iter().map(lane_json).collect()),
            )
    }

    pub fn from_json(v: &Value) -> Self {
        Self {
            lanes: match v.get("lanes") {
                Some(Value::Arr(a)) => a.iter().filter_map(lane_from).collect(),
                _ => Vec::new(),
            },
            bypassed: matches!(v.get("bypassed"), Some(Value::Bool(true))),
            frames: number(v.get("frames"), 0.0).max(0.0) as u64,
            channels: number(v.get("channels"), 0.0).max(0.0) as u16,
            sample_rate: number(v.get("sampleRate"), 0.0).max(0.0) as u32,
        }
    }
}

/// One control write: which rack slot, which key, what real value.
pub type Write = (usize, String, f32);

/// Resolve every lane into rack writes for one instant.
///
/// Slot indices are the spec's, which `RackSpec::build` keeps aligned with the
/// built rack even across bypassed slots. The master maximiser is the slot
/// after the last one, because that is where `build` puts it.
pub fn rack_controls(
    a: &Automation,
    spec: &crate::rack::RackSpec,
    frame: u64,
    sample_rate: u32,
    out: &mut Vec<Write>,
) {
    out.clear();
    if a.bypassed {
        return;
    }
    let seconds = frame as f64 / sample_rate.max(1) as f64;
    for lane in &a.lanes {
        let Some(unit) = lane.value_at(frame, seconds) else {
            continue;
        };
        if lane.target == "rack.master.amount" {
            if spec.master.is_active() {
                out.push((spec.slots.len(), "amount".to_string(), unit));
            }
            continue;
        }
        let Some(rest) = lane.target.strip_prefix("fx.") else {
            continue;
        };
        // `fx.<slot id>.<key>`. By name, not by position: dragging a module
        // along the rail must take its lanes with it, and a lane that followed
        // the position instead would silently land on whatever moved into it.
        let Some((id, key)) = rest.split_once('.') else {
            continue;
        };
        let Some(slot) = spec.slot_ids.iter().position(|x| x == id) else {
            continue;
        };
        let Some(spec_slot) = spec.slots.get(slot) else {
            continue;
        };
        if let Some(value) = resolve(spec_slot, key, unit) {
            out.push((slot, key.to_string(), value));
        }
    }
}

/// A unit value as the real value that slot's control takes.
///
/// Every range here is a constant owned by the effect, not a number written out
/// again. That is the whole point of storing lanes as units.
fn resolve(slot: &crate::rack::SlotSpec, key: &str, unit: f32) -> Option<f32> {
    use crate::rack::SlotSpec;
    let lerp = |a: f32, b: f32| a + (b - a) * unit;
    let log = |a: f32, b: f32| (a.ln() + (b.ln() - a.ln()) * unit.clamp(0.0, 1.0)).exp();
    Some(match slot {
        SlotSpec::Gain { .. } if key == "db" => lerp(fx::GAIN_DB_MIN, fx::GAIN_DB_MAX),
        SlotSpec::Eq { .. } => {
            use fx::eq::*;
            // `band.<n>.<field>`; the trailing field is what carries the range.
            match key.rsplit_once('.')?.1 {
                "freq" => log(EQ_FREQ_MIN, EQ_FREQ_MAX),
                "q" => log(EQ_Q_MIN, EQ_Q_MAX),
                "gainDb" => lerp(EQ_GAIN_MIN, EQ_GAIN_MAX),
                // A switch and a filter type are steps, not sweeps, but a lane
                // can still drive them — a band that comes in at a moment.
                "enabled" => lerp(0.0, 1.0),
                "mode" => lerp(0.0, 5.0),
                _ => return None,
            }
        }
        SlotSpec::Comp { .. } => {
            use fx::comp::*;
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
        // The shapers describe themselves, so there is nothing to write down.
        SlotSpec::Shape { kind, .. } => kind.specs().iter().find(|p| p.key == key)?.from_unit(unit),
        _ => return None,
    })
}

/// Apply the stretch and grain lanes to a set of stream parameters.
///
/// Kept apart from [`rack_controls`] because these are properties of the
/// document, not of a rack slot — and because both playback *and* export have
/// to call it. The export used not to, so a pitch or ratio lane was audible and
/// then absent from the file, which is the one thing this program does not do.
pub fn apply_stretch(a: &Automation, p: &mut fx::grain::StreamParams, frame: u64, sample_rate: u32) {
    if a.bypassed {
        return;
    }
    let seconds = frame as f64 / sample_rate.max(1) as f64;
    let log = |t: f32, lo: f32, hi: f32| (lo.ln() + (hi.ln() - lo.ln()) * t).exp();
    for l in &a.lanes {
        let Some(u) = l.value_at(frame, seconds) else {
            continue;
        };
        match l.target.as_str() {
            "stretch.ratio" => p.ratio = log(u, RATIO_MIN, RATIO_MAX),
            "stretch.semitones" => p.semitones = SEMITONE_MIN + u * (SEMITONE_MAX - SEMITONE_MIN),
            "stretch.windowMs" => p.window_ms = log(u, WINDOW_MS_MIN, WINDOW_MS_MAX),
            "stretch.grain.densityHz" => p.grain.density_hz = u * DENSITY_MAX,
            "stretch.grain.positionJitterMs" => p.grain.position_jitter_ms = u * POS_JITTER_MAX,
            "stretch.grain.pitchJitterSemis" => p.grain.pitch_jitter_semis = u * PITCH_JITTER_MAX,
            _ => {}
        }
    }
}

// The document's own ranges. These match what `persist::stretch_from_json`
// clamps to; if one moves, both move.
pub const RATIO_MIN: f32 = 0.01;
pub const RATIO_MAX: f32 = 100.0;
pub const SEMITONE_MIN: f32 = -48.0;
pub const SEMITONE_MAX: f32 = 48.0;
pub const WINDOW_MS_MIN: f32 = 5.0;
pub const WINDOW_MS_MAX: f32 = 2000.0;
pub const DENSITY_MAX: f32 = 500.0;
pub const POS_JITTER_MAX: f32 = 500.0;
pub const PITCH_JITTER_MAX: f32 = 24.0;

/// Every target this can address, with the label the interface shows.
///
/// One list, used to build the interface's menu *and* to tell a stale lane from
/// a live one, so the two cannot disagree about what exists.
pub fn targets(spec: &crate::rack::RackSpec) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = [
        ("stretch.ratio", "Time & Pitch — Stretch"),
        ("stretch.semitones", "Time & Pitch — Pitch"),
        ("stretch.windowMs", "Time & Pitch — Window"),
        ("stretch.grain.densityHz", "Grains — Density"),
        ("stretch.grain.positionJitterMs", "Grains — Position jitter"),
        ("stretch.grain.pitchJitterSemis", "Grains — Pitch jitter"),
    ]
    .iter()
    .map(|(a, b)| (a.to_string(), b.to_string()))
    .collect();

    for (i, slot) in spec.slots.iter().enumerate() {
        let name = slot.kind_label();
        let id = spec.slot_ids.get(i).cloned().unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        let mut add = |key: &str, label: &str| {
            out.push((format!("fx.{id}.{key}"), format!("{name} — {label}")));
        };
        match slot {
            crate::rack::SlotSpec::Gain { .. } => add("db", "Level"),
            crate::rack::SlotSpec::Eq { settings, .. } => {
                // Named for what each node is rather than for its index: "Band
                // 3" means nothing on a menu, and the type can be changed.
                for (i, on) in settings.enabled.iter().enumerate() {
                    let what = crate::rack::eq_band_label(settings.modes[i], i);
                    let off = if *on { "" } else { " (off)" };
                    add(&format!("band.{i}.freq"), &format!("{what} frequency{off}"));
                    add(&format!("band.{i}.q"), &format!("{what} Q{off}"));
                    add(&format!("band.{i}.gainDb"), &format!("{what} gain{off}"));
                    add(&format!("band.{i}.enabled"), &format!("{what} on/off"));
                }
            }
            crate::rack::SlotSpec::Comp { .. } => {
                for (k, l) in [
                    ("thresholdDb", "Threshold"),
                    ("ratio", "Ratio"),
                    ("attackMs", "Attack"),
                    ("releaseMs", "Release"),
                    ("kneeDb", "Knee"),
                    ("makeupDb", "Makeup"),
                ] {
                    add(k, l);
                }
            }
            crate::rack::SlotSpec::Shape { kind, .. } => {
                for p in kind.specs() {
                    add(p.key, p.label);
                }
            }
        }
    }
    if spec.master.is_active() {
        out.push((
            "rack.master.amount".into(),
            "Master — Maximiser amount".into(),
        ));
    }
    out
}

// ------------------------------------------------------------------ storage

fn number(v: Option<&Value>, d: f32) -> f32 {
    match v {
        Some(Value::Num(n)) if n.is_finite() => *n as f32,
        _ => d,
    }
}
fn text(v: Option<&Value>, d: &str) -> String {
    v.and_then(Value::as_str).unwrap_or(d).to_string()
}

fn lane_json(l: &Lane) -> Value {
    Value::obj()
        .set("id", l.id.clone())
        .set("target", l.target.clone())
        .set("label", l.label.clone())
        .set("enabled", l.enabled)
        .set("trim", l.trim as f64)
        .set(
            "loop",
            match l.loop_range {
                Some((a, b)) => Value::Arr(vec![Value::Num(a as f64), Value::Num(b as f64)]),
                None => Value::Null,
            },
        )
        .set(
            "points",
            Value::Arr(
                l.points
                    .iter()
                    .map(|p| {
                        Value::obj()
                            .set("frame", p.frame)
                            .set("value", p.value as f64)
                            .set("curve", p.curve.name())
                            .set("tension", p.tension as f64)
                    })
                    .collect(),
            ),
        )
        .set(
            "modulators",
            Value::Arr(l.modulators.iter().map(mod_json).collect()),
        )
}

fn lane_from(v: &Value) -> Option<Lane> {
    let id = text(v.get("id"), "");
    let target = text(v.get("target"), "");
    if id.is_empty() || target.is_empty() {
        return None;
    }
    let mut points = match v.get("points") {
        Some(Value::Arr(a)) => a
            .iter()
            .map(|p| Point {
                frame: number(p.get("frame"), 0.0).max(0.0) as u64,
                value: number(p.get("value"), 0.0).clamp(0.0, 1.0),
                curve: Curve::from(p.get("curve").and_then(Value::as_str).unwrap_or("linear")),
                tension: number(p.get("tension"), 0.0).clamp(-2.0, 2.0),
            })
            .collect::<Vec<_>>(),
        _ => Vec::new(),
    };
    points.sort_by_key(|p| p.frame);
    points.dedup_by_key(|p| p.frame);
    Some(Lane {
        id,
        target,
        label: text(v.get("label"), "Automation"),
        enabled: !matches!(v.get("enabled"), Some(Value::Bool(false))),
        trim: number(v.get("trim"), 0.0).clamp(-1.0, 1.0),
        loop_range: match v.get("loop") {
            Some(Value::Arr(a)) if a.len() == 2 => {
                let x = number(a.first(), 0.0) as u64;
                let y = number(a.get(1), 0.0) as u64;
                (y > x).then_some((x, y))
            }
            _ => None,
        },
        points,
        modulators: match v.get("modulators") {
            Some(Value::Arr(a)) => a.iter().filter_map(mod_from).collect(),
            _ => Vec::new(),
        },
    })
}

fn mod_json(m: &Modulator) -> Value {
    let base = Value::obj().set("kind", m.kind());
    match m {
        Modulator::Lfo {
            shape,
            rate,
            depth,
            offset,
            phase,
        } => base
            .set("shape", shape.clone())
            .set("rate", *rate as f64)
            .set("depth", *depth as f64)
            .set("offset", *offset as f64)
            .set("phase", *phase as f64),
        Modulator::Steps { rate, values } => base.set("rate", *rate as f64).set(
            "values",
            Value::Arr(values.iter().map(|v| Value::Num(*v as f64)).collect()),
        ),
        Modulator::SampleHold { rate, depth, seed } => base
            .set("rate", *rate as f64)
            .set("depth", *depth as f64)
            .set("seed", *seed),
    }
}

fn mod_from(v: &Value) -> Option<Modulator> {
    Some(match v.get("kind")?.as_str()? {
        "lfo" => Modulator::Lfo {
            shape: text(v.get("shape"), "sine"),
            rate: number(v.get("rate"), 1.0).clamp(0.001, 100.0),
            depth: number(v.get("depth"), 0.5).clamp(-1.0, 1.0),
            offset: number(v.get("offset"), 0.0).clamp(-1.0, 1.0),
            phase: number(v.get("phase"), 0.0).rem_euclid(1.0),
        },
        "steps" => Modulator::Steps {
            rate: number(v.get("rate"), 2.0).clamp(0.01, 100.0),
            values: match v.get("values") {
                Some(Value::Arr(a)) => a
                    .iter()
                    .map(|x| number(Some(x), 0.0).clamp(-1.0, 1.0))
                    .take(64)
                    .collect(),
                _ => vec![0.0],
            },
        },
        "sampleHold" => Modulator::SampleHold {
            rate: number(v.get("rate"), 2.0).clamp(0.01, 100.0),
            depth: number(v.get("depth"), 0.5).clamp(-1.0, 1.0),
            seed: number(v.get("seed"), 1.0).max(0.0) as u64,
        },
        // An unknown kind is dropped rather than guessed at, so a lane written
        // by a newer build loses the modulator and keeps the curve.
        _ => return None,
    })
}

/// How often the control thread resolves the lanes, in milliseconds.
///
/// Automation is control-rate, not audio-rate. Eight milliseconds is finer than
/// any hand and coarse enough that resolving every lane costs nothing; the
/// audio callback re-applies the last values on every block in between, so
/// nothing lapses between ticks.
pub const TICK_MS: u64 = 8;

/// Where the engine's clock and the document's meet.
///
/// The engine counts output frames at the *device's* rate. Lanes are drawn
/// against document frames at the *file's* rate. They are the same instant
/// expressed two ways, and everything downstream assumes document frames.
pub fn engine_to_document(position: u64, device_rate: u32, file_rate: u32) -> u64 {
    if device_rate == 0 || file_rate == 0 || device_rate == file_rate {
        return position;
    }
    (position as u128 * file_rate as u128 / device_rate as u128) as u64
}

/// Start the thread that resolves lanes into engine writes while a document plays.
///
/// It owns every allocation involved: the write vector is built here, handed to
/// the transport, and dropped here when it is replaced. Nothing on the audio
/// thread allocates or frees — see `engine::transport::Shared::automation`.
pub fn start_runner(app: std::sync::Arc<crate::state::App>) {
    std::thread::Builder::new()
        .name("automation".into())
        .spawn(move || {
            let mut writes: Vec<Write> = Vec::new();
            // Whether the last tick left anything written into the rack, so the
            // clear on stop happens once rather than every 8 ms.
            let mut wrote = false;
            loop {
                std::thread::sleep(std::time::Duration::from_millis(TICK_MS));
                let playing = app.playing.read().ok().and_then(|g| g.clone());
                let Some(now) = playing else {
                    continue;
                };

                let automation = if now.document {
                    app.automation
                        .get_for(&now.rel, now.doc_frames, now.doc_channels, now.doc_rate)
                } else {
                    // A library audition is the bare sound, on purpose. Lanes
                    // belong to the document and do not run over it.
                    Automation::default()
                };

                if automation.is_silent() {
                    if wrote {
                        let _ = crate::live::with(&app, |h| {
                            h.shared.clear_automation();
                        });
                        wrote = false;
                    }
                    continue;
                }

                let spec = app.racks.get(&now.rel);
                let _ = crate::live::with(&app, |h| {
                    let frame =
                        engine_to_document(h.shared.position(), now.device_rate, now.doc_rate);
                    let file_rate = now.doc_rate;

                    rack_controls(&automation, &spec, frame, file_rate, &mut writes);
                    h.shared.set_automation(writes.clone());

                    if let Some(mut p) = h.shared.params() {
                        apply_stretch(&automation, &mut p, frame, file_rate);
                        h.shared.set_params(p);
                    }
                });
                wrote = true;
            }
        })
        .ok();
}

/// The lanes for every file, keyed by library-relative path.
#[derive(Default)]
pub struct AutomationStore {
    by_path: Mutex<BTreeMap<String, Automation>>,
}

impl AutomationStore {
    pub fn load(path: &Path) -> Self {
        let map = std::fs::read_to_string(path)
            .ok()
            .and_then(|s| json::parse(&s))
            .and_then(|v| match v {
                Value::Obj(m) => Some(m),
                _ => None,
            })
            .unwrap_or_default();
        Self {
            by_path: Mutex::new(
                map.into_iter()
                    .map(|(k, v)| (k, Automation::from_json(&v)))
                    .collect(),
            ),
        }
    }

    pub fn get(&self, key: &str) -> Automation {
        self.by_path
            .lock()
            .unwrap()
            .get(key)
            .cloned()
            .unwrap_or_default()
    }

    /// The lanes for a file, but only if they were drawn against this file.
    pub fn get_for(&self, key: &str, frames: u64, channels: u16, sample_rate: u32) -> Automation {
        let a = self.get(key);
        if a.matches(frames, channels, sample_rate) {
            a
        } else {
            Automation::default()
        }
    }

    pub fn set(&self, key: &str, a: Automation) {
        self.by_path.lock().unwrap().insert(key.to_string(), a);
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let root = Value::Obj(
            self.by_path
                .lock()
                .unwrap()
                .iter()
                .map(|(k, v)| (k.clone(), v.to_json()))
                .collect(),
        );
        crate::persist::write_atomic(path, &root.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rack::{RackSpec, SlotSpec};

    fn lane(target: &str, points: Vec<(u64, f32)>) -> Lane {
        Lane {
            id: "l".into(),
            target: target.into(),
            label: "L".into(),
            enabled: true,
            trim: 0.0,
            loop_range: None,
            points: points
                .into_iter()
                .map(|(frame, value)| Point {
                    frame,
                    value,
                    curve: Curve::Linear,
                    tension: 0.0,
                })
                .collect(),
            modulators: Vec::new(),
        }
    }

    fn automation(lanes: Vec<Lane>) -> Automation {
        Automation {
            lanes,
            ..Default::default()
        }
    }

    #[test]
    fn every_curve_shape_stays_inside_the_two_points_it_joins() {
        for curve in [
            Curve::Step,
            Curve::Linear,
            Curve::Smooth,
            Curve::Exponential,
            Curve::Bezier,
        ] {
            let p = [
                Point { frame: 0, value: 0.0, curve, tension: 0.3 },
                Point { frame: 100, value: 1.0, curve: Curve::Linear, tension: 0.0 },
            ];
            for f in 0..=100 {
                let v = curve_value(&p, f).unwrap();
                assert!((0.0..=1.0).contains(&v), "{curve:?} left the range at {f}: {v}");
            }
            // A step holds the left value until it reaches the right one.
            if curve == Curve::Step {
                assert_eq!(curve_value(&p, 99).unwrap(), 0.0);
            }
        }
    }

    #[test]
    fn a_lane_holds_its_end_values_rather_than_falling_to_zero() {
        let l = lane("x", vec![(100, 0.8), (200, 0.3)]);
        assert_eq!(l.value_at(0, 0.0), Some(0.8), "before the first point");
        assert_eq!(l.value_at(1_000_000, 0.0), Some(0.3), "after the last");
    }

    #[test]
    fn a_disabled_lane_and_a_bypassed_document_write_nothing() {
        let mut spec = RackSpec::empty();
        spec.slots.push(SlotSpec::Gain { db: 0.0, bypassed: false });
        spec.slot_ids.push("g".into());
        let mut out = Vec::new();

        let mut a = automation(vec![lane("fx.g.db", vec![(0, 1.0)])]);
        a.lanes[0].enabled = false;
        rack_controls(&a, &spec, 0, 48_000, &mut out);
        assert!(out.is_empty(), "a disabled lane wrote {out:?}");

        let mut a = automation(vec![lane("fx.g.db", vec![(0, 1.0)])]);
        a.bypassed = true;
        rack_controls(&a, &spec, 0, 48_000, &mut out);
        assert!(out.is_empty(), "a bypassed document wrote {out:?}");
    }

    #[test]
    fn a_unit_lane_resolves_through_the_effects_own_range() {
        let mut spec = RackSpec::empty();
        spec.slots.push(SlotSpec::Gain { db: 0.0, bypassed: false });
        spec.slot_ids.push("g".into());
        let mut out = Vec::new();

        for (unit, expect) in [(0.0, fx::GAIN_DB_MIN), (0.5, 0.0), (1.0, fx::GAIN_DB_MAX)] {
            rack_controls(&automation(vec![lane("fx.g.db", vec![(0, unit)])]), &spec, 0, 48_000, &mut out);
            assert_eq!(out.len(), 1);
            assert!((out[0].2 - expect).abs() < 1e-4, "unit {unit} gave {}", out[0].2);
        }
    }

    /// The bug this whole design is arranged to prevent: the interface records a
    /// gesture as a unit, playback turns it back into a frequency, and if the
    /// two disagree about the range the sound lands somewhere else in silence.
    #[test]
    fn an_eq_frequency_survives_the_round_trip_through_a_unit() {
        let mut spec = RackSpec::empty();
        spec.slots.push(SlotSpec::Eq { settings: Default::default(), bypassed: false });
        spec.slot_ids.push("g".into());
        let mut out = Vec::new();
        for hz in [50.0f32, 440.0, 1000.0, 8000.0] {
            // what the interface stores when you park a band at `hz`
            let unit = (hz / fx::eq::EQ_FREQ_MIN).ln() / (fx::eq::EQ_FREQ_MAX / fx::eq::EQ_FREQ_MIN).ln();
            rack_controls(&automation(vec![lane("fx.g.mid.freq", vec![(0, unit)])]), &spec, 0, 48_000, &mut out);
            let back = out[0].2;
            assert!((back / hz - 1.0).abs() < 1e-3, "{hz} Hz came back as {back} Hz");
        }
    }

    /// A lane names its module, so dragging the rail carries it along.
    #[test]
    fn a_lane_follows_its_module_when_the_rack_is_reordered() {
        let mut spec = RackSpec::empty();
        spec.slots.push(SlotSpec::Gain { db: 0.0, bypassed: true });
        spec.slots.push(SlotSpec::Gain { db: 0.0, bypassed: false });
        spec.slot_ids = vec!["first".into(), "second".into()];
        let mut out = Vec::new();
        let a = automation(vec![lane("fx.second.db", vec![(0, 1.0)])]);

        rack_controls(&a, &spec, 0, 48_000, &mut out);
        assert_eq!(out[0].0, 1, "before the reorder");

        spec.slots.swap(0, 1);
        spec.slot_ids.swap(0, 1);
        rack_controls(&a, &spec, 0, 48_000, &mut out);
        assert_eq!(out[0].0, 0, "after the reorder the lane must move with its module");
    }

    #[test]
    fn the_master_is_the_slot_after_the_last_one() {
        let mut spec = RackSpec::empty();
        spec.slots.push(SlotSpec::Gain { db: 0.0, bypassed: false });
        spec.slot_ids.push("g".into());
        spec.master.on = true;
        let mut out = Vec::new();
        rack_controls(&automation(vec![lane("rack.master.amount", vec![(0, 0.75)])]), &spec, 0, 48_000, &mut out);
        assert_eq!(out, vec![(1, "amount".to_string(), 0.75)]);

        // and writes nothing at all when the maximiser is not in the chain
        spec.master.on = false;
        rack_controls(&automation(vec![lane("rack.master.amount", vec![(0, 0.75)])]), &spec, 0, 48_000, &mut out);
        assert!(out.is_empty());
    }

    #[test]
    fn a_stale_target_is_ignored_rather_than_moving_something_else() {
        let mut spec = RackSpec::empty();
        spec.slots.push(SlotSpec::Gain { db: 0.0, bypassed: false });
        spec.slot_ids.push("g".into());
        let mut out = Vec::new();
        for target in ["fx.nosuch.db", "fx.g.nosuch", "fx.zz.db", "wat", "fx.g"] {
            rack_controls(&automation(vec![lane(target, vec![(0, 1.0)])]), &spec, 0, 48_000, &mut out);
            assert!(out.is_empty(), "{target} wrote {out:?}");
        }
    }

    #[test]
    fn the_stretch_lanes_reach_the_stream_parameters() {
        let mut p = fx::grain::StreamParams::new(1000, 48_000);
        apply_stretch(&automation(vec![lane("stretch.semitones", vec![(0, 1.0)])]), &mut p, 0, 48_000);
        assert!((p.semitones - SEMITONE_MAX).abs() < 1e-3);

        let mut p = fx::grain::StreamParams::new(1000, 48_000);
        apply_stretch(&automation(vec![lane("stretch.ratio", vec![(0, 0.5)])]), &mut p, 0, 48_000);
        assert!((p.ratio - 1.0).abs() < 1e-3, "the middle of a log range is unity, got {}", p.ratio);
    }

    #[test]
    fn a_loop_wraps_the_curve_but_not_the_modulators() {
        let mut l = lane("x", vec![(0, 0.0), (100, 1.0)]);
        l.loop_range = Some((0, 100));
        assert_eq!(l.value_at(150, 0.0), l.value_at(50, 0.0), "the curve must wrap");

        l.modulators.push(Modulator::Lfo {
            shape: "sine".into(), rate: 1.0, depth: 0.5, offset: 0.0, phase: 0.0,
        });
        // Same point in the loop, different absolute time: a free-running LFO.
        assert_ne!(l.value_at(150, 1.25), l.value_at(50, 0.0));
    }

    #[test]
    fn a_modulated_lane_stays_inside_the_unit_range() {
        let mut l = lane("x", vec![(0, 1.0)]);
        l.trim = 1.0;
        l.modulators.push(Modulator::Lfo {
            shape: "sine".into(), rate: 1.0, depth: 1.0, offset: 1.0, phase: 0.0,
        });
        for f in 0..500 {
            let v = l.value_at(f, f as f64 / 100.0).unwrap();
            assert!((0.0..=1.0).contains(&v), "left the range at {f}: {v}");
        }
    }

    #[test]
    fn every_modulator_is_a_pure_function_of_time() {
        for m in [
            Modulator::Lfo { shape: "triangle".into(), rate: 3.0, depth: 1.0, offset: 0.0, phase: 0.2 },
            Modulator::Steps { rate: 4.0, values: vec![-1.0, 0.5, 0.25] },
            Modulator::SampleHold { rate: 7.0, depth: 1.0, seed: 42 },
        ] {
            // Asked out of order, the same instant must give the same number —
            // the waveform, playback and the export all evaluate independently.
            let forward: Vec<f32> = (0..50).map(|i| m.value(i as f64 / 10.0)).collect();
            let backward: Vec<f32> = (0..50).rev().map(|i| m.value(i as f64 / 10.0)).collect();
            assert_eq!(forward, backward.into_iter().rev().collect::<Vec<_>>());
        }
    }

    #[test]
    fn json_round_trips_lanes_points_modulators_and_the_file_it_was_drawn_against() {
        let a = Automation {
            bypassed: false,
            frames: 176_228,
            channels: 2,
            sample_rate: 44_100,
            lanes: vec![Lane {
                id: "lane".into(),
                target: "fx.g.mid.freq".into(),
                label: "Mid".into(),
                enabled: true,
                trim: 0.1,
                loop_range: Some((2, 9)),
                points: vec![Point { frame: 2, value: 0.3, curve: Curve::Bezier, tension: 0.5 }],
                modulators: vec![
                    Modulator::SampleHold { rate: 3.0, depth: 0.2, seed: 7 },
                    Modulator::Steps { rate: 2.0, values: vec![0.0, 1.0] },
                ],
            }],
        };
        assert_eq!(Automation::from_json(&a.to_json()), a);
    }

    #[test]
    fn lanes_drawn_against_a_different_file_are_refused() {
        let a = Automation { frames: 1000, channels: 2, sample_rate: 48_000, ..Default::default() };
        assert!(a.matches(1000, 2, 48_000));
        assert!(!a.matches(1001, 2, 48_000), "a different length must be refused");
        assert!(!a.matches(1000, 1, 48_000), "a different channel count must be refused");
        assert!(!a.matches(1000, 2, 44_100), "a different sample rate must be refused");
        // Written before the check existed: accepted, not failed.
        assert!(Automation::default().matches(1000, 2, 48_000));
    }

    #[test]
    fn a_lane_without_an_id_or_a_target_is_dropped() {
        let v = json::parse(r#"{"lanes":[{"id":"","target":"fx.g.db"},{"id":"a","target":""},{"id":"b","target":"fx.g.db"}]}"#).unwrap();
        let a = Automation::from_json(&v);
        assert_eq!(a.lanes.len(), 1);
        assert_eq!(a.lanes[0].id, "b");
    }

    #[test]
    fn every_offered_target_actually_resolves() {
        let mut spec = RackSpec::empty();
        spec.slots.push(SlotSpec::Gain { db: 0.0, bypassed: false });
        spec.slot_ids.push("g".into());
        spec.slots.push(SlotSpec::Eq { settings: Default::default(), bypassed: false });
        spec.slots.push(SlotSpec::Comp { settings: Default::default(), bypassed: false });
        spec.slots.push(SlotSpec::Shape {
            kind: fx::shape::ShapeKind::Ring,
            params: Vec::new(),
            bypassed: false,
        });
        spec.master.on = true;

        let mut out = Vec::new();
        let mut stretched = 0;
        for (target, label) in targets(&spec) {
            assert!(!label.is_empty(), "{target} has no label");
            if target.starts_with("stretch.") {
                stretched += 1;
                continue;
            }
            rack_controls(&automation(vec![lane(&target, vec![(0, 0.5)])]), &spec, 0, 48_000, &mut out);
            assert_eq!(out.len(), 1, "the menu offers {target} but it resolves to nothing");
        }
        assert_eq!(stretched, 6, "the document's own targets");
    }
}
