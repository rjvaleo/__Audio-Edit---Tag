//! Per-file edit sessions and marker storage.
//!
//! Markers and edits are sidecar data held in the app's own data directory, not
//! written into the library. The audio files themselves are opened read-only;
//! the only way an edit reaches disk is an explicit export to a new file.

use crate::json::{self, Value};
use edit::{EditList, Session};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq)]
pub struct Marker {
    pub frame: u64,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Region {
    pub start: u64,
    pub end: u64,
    pub label: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Annotations {
    pub markers: Vec<Marker>,
    pub regions: Vec<Region>,
}

impl Annotations {
    pub fn to_json(&self) -> Value {
        let markers: Vec<Value> = self
            .markers
            .iter()
            .map(|m| Value::obj().set("frame", m.frame).set("label", m.label.clone()))
            .collect();
        let regions: Vec<Value> = self
            .regions
            .iter()
            .map(|r| {
                Value::obj()
                    .set("start", r.start)
                    .set("end", r.end)
                    .set("label", r.label.clone())
            })
            .collect();
        Value::obj()
            .set("markers", Value::Arr(markers))
            .set("regions", Value::Arr(regions))
    }

    pub fn from_json(v: &Value) -> Self {
        let num = |x: Option<&Value>| match x {
            Some(Value::Num(n)) if *n >= 0.0 => *n as u64,
            _ => 0,
        };
        let text = |x: Option<&Value>| x.and_then(|s| s.as_str()).unwrap_or("").to_string();

        let mut out = Annotations::default();
        if let Some(Value::Arr(ms)) = v.get("markers") {
            for m in ms {
                out.markers.push(Marker {
                    frame: num(m.get("frame")),
                    label: text(m.get("label")),
                });
            }
        }
        if let Some(Value::Arr(rs)) = v.get("regions") {
            for r in rs {
                let (start, end) = (num(r.get("start")), num(r.get("end")));
                // Store regions normalised so a backwards drag is not saved
                // as a region that renders inside out.
                out.regions.push(Region {
                    start: start.min(end),
                    end: start.max(end),
                    label: text(r.get("label")),
                });
            }
        }
        // Markers in timeline order, so the ruler never has to sort them.
        out.markers.sort_by_key(|m| m.frame);
        out.regions.sort_by_key(|r| r.start);
        out
    }
}

/// All annotations, keyed by library-relative path.
#[derive(Default)]
pub struct MarkerStore {
    by_path: BTreeMap<String, Annotations>,
}

impl MarkerStore {
    pub fn load(path: &Path) -> Self {
        let Ok(raw) = std::fs::read_to_string(path) else {
            return Self::default();
        };
        let Some(Value::Obj(map)) = json::parse(&raw) else {
            return Self::default();
        };
        let mut by_path = BTreeMap::new();
        for (k, v) in map {
            by_path.insert(k, Annotations::from_json(&v));
        }
        MarkerStore { by_path }
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let mut root = BTreeMap::new();
        for (k, v) in &self.by_path {
            // Drop entries with nothing in them rather than accumulating
            // empty records for every file that was ever opened.
            if !v.markers.is_empty() || !v.regions.is_empty() {
                root.insert(k.clone(), v.to_json());
            }
        }
        std::fs::write(path, Value::Obj(root).to_string())
    }

    pub fn get(&self, key: &str) -> Annotations {
        self.by_path.get(key).cloned().unwrap_or_default()
    }

    pub fn set(&mut self, key: &str, a: Annotations) {
        self.by_path.insert(key.to_string(), a);
    }
}

/// Open edit sessions, one per file, held for the life of the process.
#[derive(Default)]
pub struct EditStore {
    sessions: Mutex<BTreeMap<String, Session>>,
}

impl EditStore {
    /// Run `f` against the session for `key`, creating it from `make` if this
    /// is the first edit on that file.
    pub fn with<T>(
        &self,
        key: &str,
        make: impl FnOnce() -> EditList,
        f: impl FnOnce(&mut Session) -> T,
    ) -> T {
        let mut map = self.sessions.lock().unwrap();
        let session = map
            .entry(key.to_string())
            .or_insert_with(|| Session::new(make()));
        f(session)
    }

    /// The current edit list for `key`, if this file has ever been edited.
    pub fn snapshot(&self, key: &str) -> Option<EditList> {
        let map = self.sessions.lock().unwrap();
        map.get(key).map(|s| s.list().clone())
    }

    pub fn has_edits(&self, key: &str) -> bool {
        self.snapshot(key).map_or(false, |l| !l.is_identity())
    }

    pub fn forget(&self, key: &str) {
        self.sessions.lock().unwrap().remove(key);
    }

    /// Every open document, for saving.
    pub fn all(&self) -> Vec<(String, EditList)> {
        self.sessions
            .lock()
            .unwrap()
            .iter()
            .map(|(k, s)| (k.clone(), s.list().clone()))
            .collect()
    }

    /// Replace a document wholesale, as a preset does.
    pub fn set(&self, key: &str, make: impl FnOnce() -> EditList, f: impl FnOnce(&mut EditList)) {
        let mut map = self.sessions.lock().unwrap();
        let session = map.entry(key.to_string()).or_insert_with(|| Session::new(make()));
        session.apply(f);
    }
}

/// Describe an edit list for the UI.
pub fn edit_json(list: &EditList, can_undo: bool, can_redo: bool) -> Value {
    let clips: Vec<Value> = list
        .clips
        .iter()
        .map(|c| {
            Value::obj()
                .set("srcStart", c.src_start)
                .set("len", c.len)
                .set("gain", c.gain)
                .set("fadeIn", c.fade_in.frames)
                .set("fadeOut", c.fade_out.frames)
                .set("reversed", c.reversed)
        })
        .collect();
    Value::obj()
        .set("frames", list.frames())
        .set("baseFrames", list.base_frames())
        .set("sourceFrames", list.source_frames)
        .set("duration", list.duration_secs())
        .set("edited", !list.is_identity())
        .set(
            "stretch",
            Value::obj()
                .set("ratio", list.stretch.ratio as f64)
                .set("semitones", list.stretch.semitones as f64)
                .set("windowMs", list.stretch.window_ms as f64)
                .set("quality", list.stretch_quality())
                .set("algorithm", list.stretch.algorithm.as_str())
                .set("phaseLock", list.stretch.phase_lock)
                .set("active", list.is_stretched())
                .set("granular", list.stretch.is_granular())
                .set(
                    "grain",
                    Value::obj()
                        .set("densityHz", list.stretch.grain.density_hz as f64)
                        .set("overlap", list.stretch.grain.overlap as f64)
                        .set("sizeJitter", list.stretch.grain.size_jitter as f64)
                        .set("positionJitterMs", list.stretch.grain.position_jitter_ms as f64)
                        .set("pitchJitterSemis", list.stretch.grain.pitch_jitter_semis as f64)
                        .set("pitchDriftSemis", list.stretch.grain.pitch_drift_semis as f64)
                        .set("driftRateHz", list.stretch.grain.drift_rate_hz as f64)
                        .set("seed", list.stretch.grain.seed as f64),
                ),
        )
        .set("clips", Value::Arr(clips))
        .set("canUndo", can_undo)
        .set("canRedo", can_redo)
}

/// Where exports go: a sibling folder, never over the original.
pub fn export_target(data_dir: &Path, rel: &str) -> PathBuf {
    let name = Path::new(rel)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "export".into());
    data_dir.join("exports").join(format!("{name} (edit).wav"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn annotations_round_trip_through_json() {
        let a = Annotations {
            markers: vec![Marker { frame: 100, label: "hit".into() }],
            regions: vec![Region { start: 0, end: 500, label: "intro".into() }],
        };
        let back = Annotations::from_json(&a.to_json());
        assert_eq!(a, back);
    }

    #[test]
    fn a_backwards_region_is_stored_the_right_way_round() {
        let v = json::parse(r#"{"regions":[{"start":900,"end":100,"label":"x"}]}"#).unwrap();
        let a = Annotations::from_json(&v);
        assert_eq!(a.regions[0].start, 100);
        assert_eq!(a.regions[0].end, 900);
    }

    #[test]
    fn markers_come_back_in_timeline_order() {
        let v = json::parse(r#"{"markers":[{"frame":300},{"frame":100},{"frame":200}]}"#).unwrap();
        let a = Annotations::from_json(&v);
        assert_eq!(a.markers.iter().map(|m| m.frame).collect::<Vec<_>>(), vec![100, 200, 300]);
    }

    #[test]
    fn a_negative_frame_is_clamped_rather_than_wrapping() {
        // -1 through `as u64` would become 18 quintillion and break the ruler.
        let v = json::parse(r#"{"markers":[{"frame":-1,"label":"x"}]}"#).unwrap();
        let a = Annotations::from_json(&v);
        assert_eq!(a.markers[0].frame, 0);
    }

    #[test]
    fn malformed_entries_do_not_lose_the_whole_file() {
        let v = json::parse(r#"{"markers":[{"nope":1},{"frame":50,"label":"ok"}]}"#).unwrap();
        let a = Annotations::from_json(&v);
        assert_eq!(a.markers.len(), 2);
        assert_eq!(a.markers[1].label, "ok");
    }

    #[test]
    fn the_store_round_trips_through_a_file() {
        let dir = std::env::temp_dir().join("audiolab-markers-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("MARKERS.json");
        let _ = std::fs::remove_file(&path);

        let mut store = MarkerStore::default();
        store.set(
            "folder/kick.wav",
            Annotations {
                markers: vec![Marker { frame: 42, label: "transient".into() }],
                regions: vec![],
            },
        );
        store.save(&path).unwrap();

        let back = MarkerStore::load(&path);
        assert_eq!(back.get("folder/kick.wav").markers[0].frame, 42);
        assert_eq!(back.get("nothing/here.wav"), Annotations::default());
    }

    #[test]
    fn empty_entries_are_not_persisted() {
        let dir = std::env::temp_dir().join("audiolab-markers-empty");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("MARKERS.json");

        let mut store = MarkerStore::default();
        store.set("a.wav", Annotations::default());
        store.save(&path).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{}");
    }

    #[test]
    fn a_missing_or_corrupt_file_loads_as_empty() {
        assert_eq!(MarkerStore::load(Path::new("/nonexistent/x.json")).by_path.len(), 0);

        let dir = std::env::temp_dir().join("audiolab-markers-corrupt");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("bad.json");
        std::fs::write(&path, "not json at all").unwrap();
        assert_eq!(MarkerStore::load(&path).by_path.len(), 0);
    }

    #[test]
    fn an_edit_session_is_created_on_first_use_and_then_reused() {
        let store = EditStore::default();
        let make = || EditList::identity(1000, 1, 44100);

        assert!(!store.has_edits("a.wav"));
        store.with("a.wav", make, |s| {
            s.apply(|l| l.cut(edit::Range::new(0, 100)));
        });
        assert!(store.has_edits("a.wav"));
        assert_eq!(store.snapshot("a.wav").unwrap().frames(), 900);

        // Second call must not reset the session.
        store.with("a.wav", make, |s| assert!(s.can_undo()));
    }

    #[test]
    fn an_untouched_session_does_not_count_as_edited() {
        let store = EditStore::default();
        store.with("a.wav", || EditList::identity(1000, 1, 44100), |s| s.can_undo());
        assert!(!store.has_edits("a.wav"));
    }

    #[test]
    fn exports_go_to_a_new_name_never_over_the_original() {
        let t = export_target(Path::new("/data"), "kits/kick 1.wav");
        assert_eq!(t, Path::new("/data/exports/kick 1 (edit).wav"));
        assert!(!t.to_string_lossy().contains("kits/kick 1.wav"));
    }
}
