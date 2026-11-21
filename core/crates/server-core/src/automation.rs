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


mod targets;
pub use targets::*;
mod storage;
pub use storage::*;
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
    /// The notes a take played, in frame order (`grain_notes.rs`).
    pub notes: Vec<TakeNote>,
}

/// A key down or up in a take, on the lanes' timeline.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TakeNote {
    pub frame: u64,
    pub on: bool,
    pub key: u8,
    pub vel: f32,
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
        let v = Value::obj()
            .set("version", VERSION)
            .set("bypassed", self.bypassed)
            .set("frames", self.frames)
            .set("channels", self.channels as f64)
            .set("sampleRate", self.sample_rate)
            .set(
                "lanes",
                Value::Arr(self.lanes.iter().map(lane_json).collect()),
            );
        if self.notes.is_empty() {
            return v;
        }
        v.set(
            "notes",
            Value::Arr(
                self.notes
                    .iter()
                    .map(|n| {
                        Value::obj()
                            .set("frame", n.frame)
                            .set("on", n.on)
                            .set("key", n.key as f64)
                            .set("vel", n.vel as f64)
                    })
                    .collect(),
            ),
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
            notes: match v.get("notes") {
                Some(Value::Arr(a)) => a
                    .iter()
                    .filter_map(|n| {
                        Some(TakeNote {
                            frame: number(n.get("frame"), -1.0).ge(&0.0).then(|| number(n.get("frame"), 0.0) as u64)?,
                            on: matches!(n.get("on"), Some(Value::Bool(true))),
                            key: number(n.get("key"), 60.0).clamp(0.0, 127.0) as u8,
                            vel: number(n.get("vel"), 0.8).clamp(0.0, 1.0),
                        })
                    })
                    .collect(),
                _ => Vec::new(),
            },
        }
    }
}

/// One control write: which rack slot, which key, what real value.
pub type Write = (usize, String, f32);

#[cfg(test)]
mod tests;
