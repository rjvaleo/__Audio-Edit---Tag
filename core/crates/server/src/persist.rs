//! Saving work to disk: edit sessions and presets.
//!
//! Everything here is sidecar data in the app's own directory. No audio file is
//! ever written. Sessions record what you did to a file; presets record a set
//! of settings detached from any file, so they can be dropped onto another.
//!
//! Undo history is deliberately *not* persisted. It can run to hundreds of
//! documents, it is meaningless after a restart, and the thing worth keeping is
//! where you got to.

use crate::json::{self, Value};
use crate::rack::RackSpec;
use edit::{Clip, EditList, Fade, FadeShape};
use fx::stretch::Quality;
use fx::{Grain, Stretch};
use std::collections::BTreeMap;
use std::path::Path;

// ------------------------------------------------------------------ helpers

fn num(v: Option<&Value>, d: f64) -> f64 {
    match v {
        Some(Value::Num(n)) if n.is_finite() => *n,
        _ => d,
    }
}
fn flag(v: Option<&Value>) -> bool {
    matches!(v, Some(Value::Bool(true)))
}
fn shape_name(s: FadeShape) -> &'static str {
    match s {
        FadeShape::Linear => "linear",
        FadeShape::EqualPower => "equalPower",
    }
}
fn shape_from(v: Option<&Value>) -> FadeShape {
    match v.and_then(|s| s.as_str()) {
        Some("linear") => FadeShape::Linear,
        _ => FadeShape::EqualPower,
    }
}
fn quality_name(q: Quality) -> &'static str {
    match q {
        Quality::Draft => "draft",
        Quality::Standard => "standard",
        Quality::Best => "best",
    }
}
fn quality_from(v: Option<&Value>) -> Quality {
    match v.and_then(|q| q.as_str()) {
        Some("draft") => Quality::Draft,
        Some("best") => Quality::Best,
        _ => Quality::Standard,
    }
}

// ------------------------------------------------------------- stretch/grain

pub fn stretch_to_json(s: &Stretch) -> Value {
    Value::obj()
        .set("ratio", s.ratio as f64)
        .set("semitones", s.semitones as f64)
        .set("windowMs", s.window_ms as f64)
        .set("quality", quality_name(s.quality))
        .set(
            "grain",
            Value::obj()
                .set("densityHz", s.grain.density_hz as f64)
                .set("overlap", s.grain.overlap as f64)
                .set("sizeJitter", s.grain.size_jitter as f64)
                .set("positionJitterMs", s.grain.position_jitter_ms as f64)
                .set("pitchJitterSemis", s.grain.pitch_jitter_semis as f64)
                .set("pitchDriftSemis", s.grain.pitch_drift_semis as f64)
                .set("driftRateHz", s.grain.drift_rate_hz as f64)
                .set("seed", s.grain.seed as f64),
        )
}

/// Read a stretch back, clamping everything. These files are user-editable and
/// a hand-typed ratio of zero would divide by it.
pub fn stretch_from_json(v: &Value) -> Stretch {
    let d = Stretch::default();
    let g = v.get("grain");
    let gf = |k: &str, dv: f32| -> f32 {
        match g.and_then(|x| x.get(k)) {
            Some(Value::Num(n)) if n.is_finite() => *n as f32,
            _ => dv,
        }
    };
    Stretch {
        ratio: (num(v.get("ratio"), 1.0) as f32).clamp(0.25, 4.0),
        semitones: (num(v.get("semitones"), 0.0) as f32).clamp(-24.0, 24.0),
        window_ms: (num(v.get("windowMs"), 40.0) as f32).clamp(5.0, 200.0),
        quality: quality_from(v.get("quality")),
        grain: Grain {
            density_hz: gf("densityHz", d.grain.density_hz).clamp(0.0, 500.0),
            overlap: gf("overlap", d.grain.overlap).clamp(1.0, 8.0),
            size_jitter: gf("sizeJitter", d.grain.size_jitter).clamp(0.0, 1.0),
            position_jitter_ms: gf("positionJitterMs", d.grain.position_jitter_ms)
                .clamp(0.0, 2000.0),
            pitch_jitter_semis: gf("pitchJitterSemis", d.grain.pitch_jitter_semis)
                .clamp(0.0, 24.0),
            pitch_drift_semis: gf("pitchDriftSemis", d.grain.pitch_drift_semis).clamp(0.0, 24.0),
            drift_rate_hz: gf("driftRateHz", d.grain.drift_rate_hz).clamp(0.01, 20.0),
            seed: gf("seed", d.grain.seed as f32).max(0.0) as u32,
        },
    }
}

// ---------------------------------------------------------------- edit lists

pub fn edit_to_json(l: &EditList) -> Value {
    let clips: Vec<Value> = l
        .clips
        .iter()
        .map(|c| {
            Value::obj()
                .set("srcStart", c.src_start)
                .set("len", c.len)
                .set("gain", c.gain as f64)
                .set("fadeIn", c.fade_in.frames)
                .set("fadeInShape", shape_name(c.fade_in.shape))
                .set("fadeOut", c.fade_out.frames)
                .set("fadeOutShape", shape_name(c.fade_out.shape))
                .set("reversed", c.reversed)
        })
        .collect();
    Value::obj()
        .set("sourceFrames", l.source_frames)
        .set("channels", l.channels as f64)
        .set("sampleRate", l.sample_rate)
        .set("clips", Value::Arr(clips))
        .set("stretch", stretch_to_json(&l.stretch))
}

/// Rebuild an edit list. `expected` is what the file on disk actually is now.
///
/// A saved session is only restored if the source still matches: if the file
/// has been replaced or re-recorded, frame offsets from the old one would point
/// at the wrong audio, which is worse than losing the edit.
pub fn edit_from_json(v: &Value, expected: &EditList) -> Option<EditList> {
    let source_frames = num(v.get("sourceFrames"), -1.0);
    let channels = num(v.get("channels"), -1.0) as u16;
    let sample_rate = num(v.get("sampleRate"), -1.0) as u32;
    if source_frames as u64 != expected.source_frames
        || channels != expected.channels
        || sample_rate != expected.sample_rate
    {
        return None;
    }

    let Some(Value::Arr(items)) = v.get("clips") else {
        return None;
    };
    let mut clips = Vec::new();
    for c in items {
        let src_start = num(c.get("srcStart"), 0.0).max(0.0) as u64;
        let len = num(c.get("len"), 0.0).max(0.0) as u64;
        // A clip reaching past the end of the source would read silence or
        // panic downstream; drop it rather than trusting the file.
        if len == 0 || src_start + len > expected.source_frames {
            continue;
        }
        clips.push(Clip {
            src_start,
            len,
            gain: (num(c.get("gain"), 1.0) as f32).clamp(0.0, 64.0),
            fade_in: Fade {
                frames: (num(c.get("fadeIn"), 0.0).max(0.0) as u64).min(len),
                shape: shape_from(c.get("fadeInShape")),
            },
            fade_out: Fade {
                frames: (num(c.get("fadeOut"), 0.0).max(0.0) as u64).min(len),
                shape: shape_from(c.get("fadeOutShape")),
            },
            reversed: flag(c.get("reversed")),
        });
    }

    Some(EditList {
        source_frames: expected.source_frames,
        channels: expected.channels,
        sample_rate: expected.sample_rate,
        clips,
        stretch: v.get("stretch").map(stretch_from_json).unwrap_or_default(),
    })
}

// ------------------------------------------------------------------ sessions

/// One file's saved work.
#[derive(Debug, Clone)]
pub struct SavedSession {
    pub edit: Value,
    pub rack: Value,
}

pub fn load_sessions(path: &Path) -> BTreeMap<String, SavedSession> {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return BTreeMap::new();
    };
    let Some(Value::Obj(map)) = json::parse(&raw) else {
        return BTreeMap::new();
    };
    map.into_iter()
        .filter_map(|(k, v)| {
            let edit = v.get("edit")?.clone();
            let rack = v.get("rack").cloned().unwrap_or_else(Value::obj);
            Some((k, SavedSession { edit, rack }))
        })
        .collect()
}

pub fn save_sessions(path: &Path, items: &BTreeMap<String, SavedSession>) -> std::io::Result<()> {
    let mut root = BTreeMap::new();
    for (k, v) in items {
        root.insert(
            k.clone(),
            Value::obj().set("edit", v.edit.clone()).set("rack", v.rack.clone()),
        );
    }
    write_atomic(path, &Value::Obj(root).to_string())
}

/// Write via a temporary file and rename.
///
/// Writing in place means a crash mid-write leaves a truncated file and the
/// user loses everything, not just the last change.
pub fn write_atomic(path: &Path, body: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, body)?;
    std::fs::rename(&tmp, path)
}

// ------------------------------------------------------------------- presets

/// A named set of settings, detached from any particular file.
#[derive(Debug, Clone, PartialEq)]
pub struct Preset {
    pub name: String,
    pub note: String,
    pub stretch: Stretch,
    pub rack: RackSpec,
}

impl Preset {
    pub fn to_json(&self) -> Value {
        Value::obj()
            .set("name", self.name.clone())
            .set("note", self.note.clone())
            .set("stretch", stretch_to_json(&self.stretch))
            .set("rack", self.rack.to_json())
    }

    pub fn from_json(name: &str, v: &Value) -> Self {
        Preset {
            name: v
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or(name)
                .to_string(),
            note: v.get("note").and_then(|n| n.as_str()).unwrap_or("").to_string(),
            stretch: v.get("stretch").map(stretch_from_json).unwrap_or_default(),
            rack: v.get("rack").map(RackSpec::from_json).unwrap_or_else(RackSpec::empty),
        }
    }
}

pub fn load_presets(path: &Path) -> BTreeMap<String, Preset> {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return BTreeMap::new();
    };
    let Some(Value::Obj(map)) = json::parse(&raw) else {
        return BTreeMap::new();
    };
    map.into_iter()
        .map(|(k, v)| {
            let p = Preset::from_json(&k, &v);
            (k, p)
        })
        .collect()
}

pub fn save_presets(path: &Path, items: &BTreeMap<String, Preset>) -> std::io::Result<()> {
    let mut root = BTreeMap::new();
    for (k, v) in items {
        root.insert(k.clone(), v.to_json());
    }
    write_atomic(path, &Value::Obj(root).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use edit::Range;

    fn sample_list() -> EditList {
        let mut l = EditList::identity(10_000, 2, 48_000);
        l.cut(Range::new(1000, 2000));
        l.fade_in(Range::new(0, 500), 500, FadeShape::Linear);
        l.gain_db(Range::new(0, 3000), -6.0);
        l.stretch = Stretch {
            ratio: 1.75,
            semitones: -3.5,
            window_ms: 65.0,
            quality: Quality::Best,
            grain: Grain {
                density_hz: 42.0,
                overlap: 3.5,
                size_jitter: 0.4,
                position_jitter_ms: 120.0,
                pitch_jitter_semis: 6.0,
                pitch_drift_semis: 2.5,
                drift_rate_hz: 1.25,
                seed: 4242,
            },
        };
        l
    }

    #[test]
    fn an_edit_list_survives_a_round_trip() {
        let l = sample_list();
        let expected = EditList::identity(10_000, 2, 48_000);
        let back = edit_from_json(&edit_to_json(&l), &expected).expect("should restore");
        assert_eq!(back, l);
    }

    #[test]
    fn the_stretch_and_every_grain_setting_survive() {
        let l = sample_list();
        let back = edit_from_json(&edit_to_json(&l), &EditList::identity(10_000, 2, 48_000))
            .unwrap();
        assert_eq!(back.stretch, l.stretch);
        assert_eq!(back.stretch.grain.seed, 4242);
        assert_eq!(back.stretch.quality, Quality::Best);
    }

    #[test]
    fn fade_shapes_are_not_silently_flattened() {
        let mut l = EditList::identity(1000, 1, 48_000);
        l.fade_in(Range::new(0, 200), 200, FadeShape::Linear);
        l.fade_out(Range::new(800, 1000), 200, FadeShape::EqualPower);
        let back = edit_from_json(&edit_to_json(&l), &EditList::identity(1000, 1, 48_000)).unwrap();
        assert_eq!(back, l);
    }

    #[test]
    fn a_session_for_a_changed_file_is_refused() {
        // Frame offsets from the old file would point at the wrong audio, which
        // is worse than losing the edit.
        let l = sample_list();
        let saved = edit_to_json(&l);
        assert!(edit_from_json(&saved, &EditList::identity(9_999, 2, 48_000)).is_none(),
                "different length must be refused");
        assert!(edit_from_json(&saved, &EditList::identity(10_000, 1, 48_000)).is_none(),
                "different channel count must be refused");
        assert!(edit_from_json(&saved, &EditList::identity(10_000, 2, 44_100)).is_none(),
                "different sample rate must be refused");
    }

    #[test]
    fn a_clip_reaching_past_the_source_is_dropped() {
        let v = json::parse(
            r#"{"sourceFrames":1000,"channels":1,"sampleRate":48000,
                "clips":[{"srcStart":0,"len":500},{"srcStart":900,"len":500}]}"#,
        )
        .unwrap();
        let back = edit_from_json(&v, &EditList::identity(1000, 1, 48000)).unwrap();
        assert_eq!(back.clips.len(), 1, "the overhanging clip should be dropped");
    }

    #[test]
    fn out_of_range_values_in_a_hand_edited_file_are_clamped() {
        let v = json::parse(
            r#"{"sourceFrames":1000,"channels":1,"sampleRate":48000,
                "clips":[{"srcStart":0,"len":1000,"gain":9e9}],
                "stretch":{"ratio":0,"semitones":900,
                           "grain":{"overlap":-4,"seed":-1}}}"#,
        )
        .unwrap();
        let back = edit_from_json(&v, &EditList::identity(1000, 1, 48000)).unwrap();
        assert!(back.clips[0].gain <= 64.0);
        assert!(back.stretch.ratio >= 0.25, "a zero ratio would divide by zero");
        assert!(back.stretch.semitones <= 24.0);
        assert!(back.stretch.grain.overlap >= 1.0);
    }

    #[test]
    fn a_missing_or_corrupt_file_loads_as_empty() {
        assert!(load_sessions(Path::new("/nonexistent/none.json")).is_empty());
        assert!(load_presets(Path::new("/nonexistent/none.json")).is_empty());

        let dir = std::env::temp_dir().join("audiolab-persist-corrupt");
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("bad.json");
        std::fs::write(&p, "{not json").unwrap();
        assert!(load_sessions(&p).is_empty());
        assert!(load_presets(&p).is_empty());
    }

    #[test]
    fn sessions_round_trip_through_a_file() {
        let dir = std::env::temp_dir().join("audiolab-persist-sessions");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("SESSIONS.json");
        let _ = std::fs::remove_file(&path);

        let l = sample_list();
        let mut items = BTreeMap::new();
        items.insert(
            "kits/kick.wav".to_string(),
            SavedSession { edit: edit_to_json(&l), rack: RackSpec::default_chain().to_json() },
        );
        save_sessions(&path, &items).unwrap();

        let back = load_sessions(&path);
        let restored =
            edit_from_json(&back["kits/kick.wav"].edit, &EditList::identity(10_000, 2, 48_000))
                .unwrap();
        assert_eq!(restored, l);
    }

    #[test]
    fn a_preset_round_trips_with_its_rack() {
        let dir = std::env::temp_dir().join("audiolab-persist-presets");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("PRESETS.json");
        let _ = std::fs::remove_file(&path);

        let p = Preset {
            name: "Swarm 1".into(),
            note: "dense, scattered".into(),
            stretch: sample_list().stretch,
            rack: RackSpec::default_chain(),
        };
        let mut items = BTreeMap::new();
        items.insert(p.name.clone(), p.clone());
        save_presets(&path, &items).unwrap();

        let back = load_presets(&path);
        assert_eq!(back["Swarm 1"], p);
    }

    #[test]
    fn a_preset_written_by_hand_without_a_rack_still_loads() {
        // The file the user was handed earlier has no rack key at all.
        let v = json::parse(
            r#"{"name":"Swarm 1","stretch":{"ratio":1,"grain":{"densityHz":50,
                "positionJitterMs":120,"pitchJitterSemis":6}}}"#,
        )
        .unwrap();
        let p = Preset::from_json("Swarm 1", &v);
        assert_eq!(p.name, "Swarm 1");
        assert_eq!(p.stretch.grain.density_hz, 50.0);
        assert_eq!(p.stretch.grain.position_jitter_ms, 120.0);
        assert_eq!(p.stretch.grain.pitch_jitter_semis, 6.0);
        assert!(p.rack.slots.is_empty());
    }

    #[test]
    fn writing_is_atomic() {
        // A crash mid-write must not be able to truncate the previous file.
        let dir = std::env::temp_dir().join("audiolab-persist-atomic");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("x.json");
        write_atomic(&path, "{\"a\":1}").unwrap();
        write_atomic(&path, "{\"a\":2}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"a\":2}");
        assert!(!path.with_extension("tmp").exists(), "temp file left behind");
    }
}
