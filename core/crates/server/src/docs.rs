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
        // The same shape the presets are written in, plus two things only a
        // live document has an opinion about. This used to be a second
        // hand-written copy of every field, which is how the interface came to
        // be told about half of the engines' controls and not the other half.
        .set(
            "stretch",
            crate::persist::stretch_to_json(&list.stretch)
                .set("active", list.is_stretched())
                .set("granular", list.stretch.is_granular()),
        )
        .set("clips", Value::Arr(clips))
        .set("canUndo", can_undo)
        .set("canRedo", can_redo)
}

/// What an export is called.
///
/// The engine and the three settings that decide what you hear, appended to
/// the original name, so a folder of exports is readable without opening any
/// of them and two attempts at the same sound do not collide. Everything else
/// — every extended control, the whole grain cloud, the rack — is written
/// *into* the file; see [`export_meta`].
///
/// Always all four, even at their defaults. A name that omits what is inert is
/// a name you cannot predict, sort or grep.
pub fn export_name(rel: &str, stretch: &fx::Stretch) -> String {
    let stem = Path::new(rel)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "export".into());
    format!(
        "{stem} {} {:.2}x {}{:.1}st {}ms.aiff",
        stretch.algorithm.as_str(),
        stretch.ratio,
        if stretch.semitones >= 0.0 { "+" } else { "" },
        stretch.semitones,
        stretch.window_ms.round() as i64,
    )
}

/// Where an export goes: **beside the original**, never over it.
///
/// In the library, next to the sound it came from, because that is where you
/// will be looking for it. The source is opened read-only and is never
/// touched; this only ever creates a new name.
pub fn export_target(lib: &Path, rel: &str, stretch: &fx::Stretch) -> PathBuf {
    let dir = Path::new(rel).parent().map(|p| lib.join(p)).unwrap_or_else(|| lib.to_path_buf());
    unique(dir.join(export_name(rel, stretch)))
}

/// A name nothing is using yet.
///
/// Exporting the same settings twice is a normal thing to do — a second take
/// after changing something outside the name — and silently replacing the
/// first would be the one thing this program does not do.
pub fn unique(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = path
        .extension()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "aiff".into());
    for n in 2..10_000 {
        let next = path.with_file_name(format!("{stem} {n}.{ext}"));
        if !next.exists() {
            return next;
        }
    }
    path
}

/// Everything that made the sound, to be written into the file.
///
/// The settings go in as a preset would hold them, so an export *is* a preset:
/// a good accident can be found again months later from the file alone, with
/// no session, no notes and nothing else to keep in step with it. Reading them
/// back is not built yet — see the roadmap — but no file written from today
/// needs to be exported again for it.
pub fn export_meta(
    rel: &str,
    list: &EditList,
    rack: &crate::rack::RackSpec,
    automation: &crate::automation::Automation,
) -> audio_core::aiff::Meta {
    let s = &list.stretch;
    let mut settings = Value::obj()
        .set("app", "Audio Edit & Tag")
        // The version is the promise to whatever reads this later: a reader
        // that does not know a number can say so rather than guess. It went to
        // 2 when the automation went in — a reader expecting 1 and finding
        // lanes it cannot resolve should say so rather than play them wrong.
        .set("version", 2.0)
        .set("source", rel.to_string())
        .set("stretch", crate::persist::stretch_to_json(s))
        .set("rack", rack.to_json());
    // Only when there is some, so a file with no lanes reads exactly as it did
    // before automation existed.
    if !automation.lanes.is_empty() {
        settings = settings.set("automation", automation.to_json());
    }

    audio_core::aiff::Meta {
        name: Path::new(rel)
            .file_name()
            .map(|n| n.to_string_lossy().to_string()),
        annotation: Some(format!(
            "Audio Edit & Tag — {} at {:.2}x, {}{:.1} st, {} ms window. \
             Every setting is in the APPL 'AuLb' chunk.",
            s.algorithm.as_str(),
            s.ratio,
            if s.semitones >= 0.0 { "+" } else { "" },
            s.semitones,
            s.window_ms.round() as i64,
        )),
        settings: Some(settings.to_string()),
    }
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

    fn stretch_of(alg: &str, ratio: f32, semis: f32, window: f32) -> fx::Stretch {
        fx::Stretch {
            algorithm: fx::stretch::Algorithm::from_str(alg).unwrap(),
            ratio,
            semitones: semis,
            window_ms: window,
            ..fx::Stretch::default()
        }
    }

    #[test]
    fn an_export_is_named_for_what_was_done_to_it() {
        let s = stretch_of("pvsola", 2.5, -7.0, 40.0);
        assert_eq!(
            export_name("kits/kick 1.wav", &s),
            "kick 1 pvsola 2.50x -7.0st 40ms.aiff"
        );
    }

    #[test]
    fn the_defaults_are_named_too_rather_than_left_off() {
        // A name that omits what is inert cannot be predicted or sorted.
        let s = stretch_of("wsola", 1.0, 0.0, 40.0);
        assert_eq!(export_name("a.wav", &s), "a wsola 1.00x +0.0st 40ms.aiff");
    }

    #[test]
    fn an_export_lands_beside_the_sound_it_came_from() {
        let t = export_target(Path::new("/lib"), "kits/kick 1.wav", &stretch_of("wsola", 1.0, 0.0, 40.0));
        assert_eq!(t.parent().unwrap(), Path::new("/lib/kits"));
        assert_eq!(t.extension().unwrap(), "aiff");
        // And never over the original.
        assert_ne!(t, Path::new("/lib/kits/kick 1.wav"));
    }

    #[test]
    fn a_file_at_the_top_of_the_library_still_has_somewhere_to_go() {
        let t = export_target(Path::new("/lib"), "kick.wav", &stretch_of("wsola", 1.0, 0.0, 40.0));
        assert_eq!(t.parent().unwrap(), Path::new("/lib"));
    }

    #[test]
    fn the_settings_ride_in_the_file_as_a_preset_would_hold_them() {
        let mut list = EditList::identity(1000, 1, 44_100);
        list.stretch = stretch_of("hybrid", 3.0, 5.0, 60.0);
        let meta = export_meta(
            "kits/kick.wav",
            &list,
            &crate::rack::RackSpec::empty(),
            &crate::automation::Automation::default(),
        );

        assert_eq!(meta.name.as_deref(), Some("kick.wav"));
        let s = meta.settings.expect("no settings written");
        let v = json::parse(&s).expect("the settings are not JSON");
        assert!(matches!(v.get("version"), Some(Value::Num(n)) if *n == 2.0));
        // A document with no lanes writes no automation key at all, so a file
        // exported without it reads exactly as it did before this existed.
        assert!(v.get("automation").is_none());
        assert_eq!(v.get("source").and_then(|x| x.as_str()), Some("kits/kick.wav"));
        let st = v.get("stretch").expect("no stretch");
        assert_eq!(st.get("algorithm").and_then(|x| x.as_str()), Some("hybrid"));
        assert!(matches!(st.get("ratio"), Some(Value::Num(n)) if (*n - 3.0).abs() < 1e-6));
        // Not just the three in the name: the whole engine, as a preset holds it.
        assert!(st.get("hybrid").is_some(), "the hybrid's own controls are missing");
        assert!(st.get("grain").is_some(), "the grain cloud is missing");
        assert!(st.get("vocoder").is_some(), "the vocoder's controls are missing");
        assert!(v.get("rack").is_some(), "the effect rack is missing");
    }
}
