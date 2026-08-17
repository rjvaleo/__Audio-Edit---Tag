//! Server state: where the library is, what's in the index, what a scan is doing.

use indexer::{tsv, FileRecord, FILE_COLUMNS};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, RwLock};

/// One row as the browser needs it. Narrower than [`FileRecord`] — the index
/// carries classifier working notes the UI never shows.
#[derive(Debug, Clone, Default)]
pub struct FileRow {
    pub folder: String,
    pub rel_path: String,
    pub filename: String,
    pub subdir: String,
    pub bytes: u64,
    pub duration: f64,
    pub sample_rate: u32,
    pub bits: u16,
    pub channels: u16,
    pub format: String,
    pub category: String,
    pub confidence: String,
    pub machine: String,
    pub instrument: String,
    pub bpm: String,
    pub reasons: String,
    // Carried so that everything the indexer worked out survives as far as the
    // API. The columns were always in the TSV; this row used to drop them on
    // the floor, which meant anything wanting the whole picture had to go and
    // re-derive it.
    pub stem: String,
    pub ext: String,
    pub modified: String,
    pub parent_chain: String,
    pub descriptors: Vec<String>,
    pub series_root: String,
    pub series_index: Option<u32>,
    pub series_size: Option<usize>,
    pub notes: String,
}

impl From<&FileRecord> for FileRow {
    fn from(r: &FileRecord) -> Self {
        let subdir = match r.rel_path.rsplit_once('/') {
            Some((d, _)) => d.to_string(),
            None => String::new(),
        };
        FileRow {
            folder: r.root_folder.clone(),
            rel_path: r.rel_path.clone(),
            filename: r.filename.clone(),
            subdir,
            bytes: r.bytes,
            duration: r.duration,
            sample_rate: r.sample_rate,
            bits: r.bits,
            channels: r.channels,
            format: r.format.clone(),
            category: r.category.as_str().to_string(),
            confidence: r.confidence.as_str().to_string(),
            machine: r.machine.clone().unwrap_or_default(),
            instrument: r.instrument.clone().unwrap_or_default(),
            bpm: r.bpm.map(|b| b.to_string()).unwrap_or_default(),
            reasons: r.reasons.join("; "),
            stem: r.stem.clone(),
            ext: r.ext.clone(),
            modified: r.modified.clone(),
            parent_chain: r.parent_chain.clone(),
            descriptors: r.descriptors.clone(),
            series_root: r.series_root.clone().unwrap_or_default(),
            series_index: r.series_index,
            series_size: r.series_size,
            notes: r.notes.clone(),
        }
    }
}

/// Whether the probe found a container, or fell back to headerless PCM.
///
/// The fallback is why a peak cache or a stray binary opens and plays as noise.
/// It is deliberate and occasionally rewarding, but it means "the scan found a
/// file here" and "there is a sound here" are different claims, and the folder
/// counts have to be able to make the second one.
pub fn has_audio_header(format: &str) -> bool {
    format.starts_with("WAV") || format.starts_with("AIFF") || format.starts_with("AIFC")
}

/// Everything known about one library folder.
#[derive(Debug, Clone, Default)]
pub struct FolderRow {
    pub name: String,
    pub level1: String,
    pub level2: String,
    pub machine: String,
    pub confidence: String,
    pub files: usize,
    pub audio_files: usize,
    /// Files that announced themselves as audio, rather than being read as
    /// headerless PCM because nothing else fitted. This is what the browser
    /// lists with "Play all files" off, so it is what the count has to say.
    pub header_files: usize,
    pub bytes: u64,
    pub minutes: f64,
    pub categories: String,
    pub instruments: String,
    pub formats: String,
    pub tags: String,
}

/// What the engine has loaded.
///
/// Two clocks meet in here. `frames` and `device_rate` describe the engine's
/// output; `doc_*` describe the document that produced it, at the file's own
/// rate. Automation is drawn against the second and played against the first,
/// so both have to be reachable from one place — deriving the document's rate
/// by reopening the file on every control tick was the alternative.
#[derive(Debug, Clone)]
pub struct NowPlaying {
    pub rel: String,
    /// Engine output frames, at `device_rate`.
    pub frames: u64,
    pub device_rate: u32,
    /// Whether the engine was given the document or the bare sound.
    pub document: bool,
    pub doc_frames: u64,
    pub doc_channels: u16,
    pub doc_rate: u32,
}

#[derive(Default)]
pub struct Index {
    pub files: Vec<FileRow>,
    pub folders: Vec<FolderRow>,
}

impl Index {
    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }

    /// Rebuild folder rows by aggregating the file rows.
    ///
    /// A folder's grouping is whatever category dominates its audio files, and
    /// the confidence reflects how dominant that is — a folder with no clear
    /// majority is marked low so the UI can present it as a suggestion.
    pub fn rebuild_folders(&mut self) {
        use std::collections::BTreeMap;
        // Insertion order, not alphabetical: the tree shows folders in the
        // order they entered the library, and a sorted map would silently
        // reorder them every rebuild.
        let mut order: Vec<String> = Vec::new();
        let mut by: BTreeMap<String, Vec<&FileRow>> = BTreeMap::new();
        for f in &self.files {
            if !by.contains_key(&f.folder) {
                order.push(f.folder.clone());
            }
            by.entry(f.folder.clone()).or_default().push(f);
        }

        self.folders = order
            .into_iter()
            .filter_map(|name| by.remove(&name).map(|rows| (name, rows)))
            .map(|(name, rows)| {
                let audio: Vec<&&FileRow> = rows
                    .iter()
                    .filter(|r| !matches!(r.category.as_str(), "CACHE" | "DOCUMENT" | "BROKEN"))
                    .collect();

                let mut cats: BTreeMap<&str, usize> = BTreeMap::new();
                let mut insts: BTreeMap<&str, usize> = BTreeMap::new();
                let mut machs: BTreeMap<&str, usize> = BTreeMap::new();
                let mut fmts: BTreeMap<&str, usize> = BTreeMap::new();
                for r in &audio {
                    *cats.entry(r.category.as_str()).or_default() += 1;
                    if !r.instrument.is_empty() {
                        *insts.entry(r.instrument.as_str()).or_default() += 1;
                    }
                    if !r.machine.is_empty() {
                        *machs.entry(r.machine.as_str()).or_default() += 1;
                    }
                    *fmts.entry(r.format.as_str()).or_default() += 1;
                }

                let top = |m: &BTreeMap<&str, usize>| -> (String, usize) {
                    m.iter()
                        .max_by_key(|(_, &n)| n)
                        .map(|(k, &n)| (k.to_string(), n))
                        .unwrap_or_default()
                };
                let (dominant, dom_count) = top(&cats);
                let (machine, _) = top(&machs);
                let share = if audio.is_empty() {
                    0.0
                } else {
                    dom_count as f64 / audio.len() as f64
                };
                let confidence = if share >= 0.7 && audio.len() >= 5 {
                    "high"
                } else if share >= 0.45 {
                    "medium"
                } else {
                    "low"
                };

                let (level1, level2) = levels(&name, &dominant, &machine);
                let join = |m: &BTreeMap<&str, usize>, n: usize| {
                    let mut v: Vec<_> = m.iter().collect();
                    v.sort_by(|a, b| b.1.cmp(a.1));
                    v.into_iter()
                        .take(n)
                        .map(|(k, c)| format!("{k}:{c}"))
                        .collect::<Vec<_>>()
                        .join(", ")
                };

                let mut tags: Vec<String> = vec![catalog::slug(level1), catalog::slug(level2)];
                tags.extend(machs.keys().map(|m| catalog::slug(m)));
                tags.extend(insts.keys().map(|i| catalog::slug(i)));
                tags.retain(|t| !t.is_empty());
                tags.dedup();

                FolderRow {
                    name,
                    level1: level1.to_string(),
                    level2: level2.to_string(),
                    machine,
                    confidence: confidence.to_string(),
                    files: rows.len(),
                    audio_files: audio.len(),
                    // Counted over every row, not the `audio` subset: the
                    // browser's filter is about the header and nothing else.
                    header_files: rows.iter().filter(|r| has_audio_header(&r.format)).count(),
                    bytes: rows.iter().map(|r| r.bytes).sum(),
                    minutes: audio.iter().map(|r| r.duration).sum::<f64>() / 60.0,
                    categories: join(&cats, 6),
                    instruments: insts.keys().take(8).cloned().collect::<Vec<_>>().join(", "),
                    formats: join(&fmts, 4),
                    tags: tags.join(" "),
                }
            })
            .collect();
    }

    pub fn load(path: &Path) -> std::io::Result<Self> {
        let f = std::fs::File::open(path)?;
        let t = tsv::Table::read(std::io::BufReader::new(f))?;
        // A closure cannot be generic over the target type, so parse explicitly.
        // Anything unparseable becomes zero rather than failing the whole load —
        // one malformed row should not cost the user their entire index.
        let files: Vec<FileRow> = t
            .rows
            .iter()
            .map(|r| {
                let rel: String = t.get(r, "rel_path").to_string();
                let subdir = rel.rsplit_once('/').map(|(d, _)| d.to_string()).unwrap_or_default();
                FileRow {
                    folder: t.get(r, "root_folder").to_string(),
                    rel_path: rel,
                    filename: t.get(r, "filename").to_string(),
                    subdir,
                    bytes: t.get(r, "bytes").parse().unwrap_or(0),
                    duration: t.get(r, "duration_s").parse().unwrap_or(0.0),
                    sample_rate: t.get(r, "samplerate").parse().unwrap_or(0),
                    bits: t.get(r, "bits").parse().unwrap_or(0),
                    channels: t.get(r, "channels").parse().unwrap_or(0),
                    format: t.get(r, "format").to_string(),
                    category: t.get(r, "category").to_string(),
                    confidence: t.get(r, "confidence").to_string(),
                    machine: t.get(r, "machine").to_string(),
                    instrument: t.get(r, "instrument").to_string(),
                    bpm: t.get(r, "bpm").to_string(),
                    reasons: t.get(r, "reasons").to_string(),
                    stem: t.get(r, "stem").to_string(),
                    ext: t.get(r, "ext").to_string(),
                    modified: t.get(r, "modified").to_string(),
                    parent_chain: t.get(r, "parent_chain").to_string(),
                    // One space-separated field on the way out (`to_row` joins
                    // with " "), so it splits back the same way.
                    descriptors: t
                        .get(r, "descriptor")
                        .split_whitespace()
                        .map(|s| s.to_string())
                        .collect(),
                    series_root: t.get(r, "series_root").to_string(),
                    series_index: t.get(r, "series_index").parse().ok(),
                    series_size: t.get(r, "series_size").parse().ok(),
                    notes: t.get(r, "notes").to_string(),
                }
            })
            .collect();
        let mut idx = Index { files, folders: Vec::new() };
        idx.rebuild_folders();
        Ok(idx)
    }

    pub fn save(records: &[FileRecord], path: &Path) -> std::io::Result<()> {
        let f = std::fs::File::create(path)?;
        let mut w = tsv::Writer::new(std::io::BufWriter::new(f), FILE_COLUMNS)?;
        for r in records {
            w.row(&r.to_row())?;
        }
        w.flush()
    }
}

/// Map a dominant category onto the two-level grouping the browser tree shows.
fn levels(folder: &str, dominant: &str, machine: &str) -> (&'static str, &'static str) {
    let low = folder.to_lowercase();
    let soft = matches!(
        machine,
        "NI Absynth" | "NI Kontakt" | "NI Battery" | "Halion"
    );
    match dominant {
        "DRUM-ONESHOT" | "DRUM-HIT-LONG" => {
            if !machine.is_empty() && !soft {
                ("Drum", "Machine")
            } else if low.contains("acoustic") || low.contains("live") {
                ("Drum", "Acoustic")
            } else if low.contains("kit") || soft {
                ("Drum", "Kit")
            } else {
                ("Drum", "Hits")
            }
        }
        "CHOP" => ("Sample", "Chops"),
        "FX" => ("Sample", "FX"),
        "PAD-BED" => ("Sample", "Pads"),
        "LOOP" => ("Sample", "Loops"),
        "SECTION-BED" => ("Sample", "Beds"),
        "ONE-SHOT" | "SAMPLE-SHORT" => ("Sample", "Oneshots"),
        "SAMPLE" => ("Sample", "General"),
        "SYNTH-STAB" | "TONAL-HIT" => ("Synth", "Hits"),
        "VOCAL" => ("Vocal", "Takes"),
        "STEM" => ("Session", "Stems"),
        "SESSION-TAKE" => ("Session", "Takes"),
        "SONG" | "SONG?" => {
            if low.contains("master") || low.contains("final") || low.contains("release") {
                ("Song", "Masters")
            } else {
                ("Song", "Mixes")
            }
        }
        "LONG-SESSION" => {
            if low.contains("live") || low.contains("gig") || low.contains("concert") {
                ("Session", "Live")
            } else {
                ("Session", "Long")
            }
        }
        _ => ("Unsorted", "Mixed"),
    }
}

/// Progress of a running scan, shared with the UI.
#[derive(Default)]
pub struct ScanProgress {
    pub running: AtomicBool,
    pub cancel: AtomicBool,
    pub done: AtomicUsize,
    pub total: AtomicUsize,
    pub current: Mutex<String>,
}

impl ScanProgress {
    pub fn snapshot(&self) -> (bool, usize, usize, String) {
        (
            self.running.load(Ordering::Relaxed),
            self.done.load(Ordering::Relaxed),
            self.total.load(Ordering::Relaxed),
            self.current.lock().map(|s| s.clone()).unwrap_or_default(),
        )
    }
}

/// How far an export has got, and how it ended.
///
/// The same shape as [`ScanProgress`] and for the same reason: a job that runs
/// on its own thread while the browser asks about it. The difference is that an
/// export *produces* something, so the outcome has to be kept here too — the
/// request that started it returned long before the file existed, and there is
/// nowhere else for the path to be reported.
///
/// `done` and `total` are in **work frames**, not output frames. A sixteen-layer
/// stretch does sixteen passes over the output, and a bar scaled to the output
/// length would fill in the first sixteenth and then sit still — see
/// `fx::Stretch::work_frames`.
#[derive(Default)]
pub struct ExportProgress {
    pub running: AtomicBool,
    pub cancel: AtomicBool,
    pub done: AtomicU64,
    pub total: AtomicU64,
    pub phase: Mutex<String>,
    /// Where the finished file went, or empty while running.
    pub path: Mutex<String>,
    /// What went wrong, or empty.
    pub error: Mutex<String>,
    pub frames: AtomicU64,
    /// Bumped when a run finishes, so the browser can tell a fresh result from
    /// the one it already reported without comparing paths.
    pub serial: AtomicU64,
}

impl ExportProgress {
    pub fn begin(&self, total: u64) {
        self.cancel.store(false, Ordering::Relaxed);
        self.done.store(0, Ordering::Relaxed);
        self.total.store(total.max(1), Ordering::Relaxed);
        self.frames.store(0, Ordering::Relaxed);
        if let Ok(mut x) = self.path.lock() {
            x.clear();
        }
        if let Ok(mut x) = self.error.lock() {
            x.clear();
        }
        self.say("starting");
    }

    pub fn say(&self, what: &str) {
        if let Ok(mut x) = self.phase.lock() {
            x.clear();
            x.push_str(what);
        }
    }

    pub fn step(&self, n: u64) {
        self.done.fetch_add(n, Ordering::Relaxed);
    }

    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }
}

/// How many grains a picture may be sent, unless the config says otherwise.
pub const DEFAULT_GRAIN_CAP: usize = 8_000;

/// A file, decoded once.
pub struct DecodedSource {
    pub rel: String,
    /// Length and modification time when it was read. Cheap to check and enough
    /// to catch a file that has been replaced.
    pub stamp: (u64, Option<std::time::SystemTime>),
    pub samples: std::sync::Arc<Vec<f32>>,
    pub channels: usize,
}

pub struct App {
    /// Where the index and config live — beside the executable, not in the library.
    pub data_dir: PathBuf,
    pub library: RwLock<Option<PathBuf>>,
    /// Frames the audio device is asked for per callback, or `None` for
    /// whatever it offers. Kept here rather than only on the running engine so
    /// it survives the device being closed and reopened, which is the only way
    /// to change it — a stream's block length is fixed when it is built.
    pub buffer_frames: RwLock<Option<u32>>,
    /// How many grains may cross the wire for a picture. See `api_grains`.
    pub grain_cap: RwLock<usize>,
    /// A decoded source file, kept so it is not read and decoded again.
    ///
    /// The audio in a file does not change, and everything derived from it —
    /// the level and brightness of every grain — is the same answer every time
    /// it is asked for. It was being recomputed from a fresh read of the whole
    /// file on every request, eleven times a second while a slider moved.
    ///
    /// Keyed by path *and* by what the file looked like when it was read, so a
    /// file replaced on disk is decoded again rather than answered from a stale
    /// copy. One entry: this is a program you work on one sound at a time in,
    /// and a decoded minute of stereo is twenty megabytes.
    pub decoded: RwLock<Option<DecodedSource>>,
    pub index: RwLock<Index>,
    pub scan: Arc<ScanProgress>,
    pub export: Arc<ExportProgress>,
    /// Markers and regions, sidecar to the app rather than written into the library.
    pub markers: RwLock<crate::docs::MarkerStore>,
    /// Open edit sessions, one per file, held for the life of the process.
    pub edits: crate::docs::EditStore,
    /// Effect racks, one per file, held for the life of the process.
    pub racks: crate::rack::RackStore,
    /// Automation lanes, one set per file. Unlike the racks these outlive the
    /// process: a curve is work, in the way a slider position is not.
    pub automation: crate::automation::AutomationStore,
    /// The open input device, when one is armed.
    ///
    /// Held here rather than beside the output engine because the two are
    /// independent: you can record with nothing playing, and play with nothing
    /// armed. Dropping this closes the stream and releases the microphone.
    pub recorder: Mutex<Option<engine::input::Recorder>>,
    /// Named settings, detached from any file.
    pub presets: RwLock<std::collections::BTreeMap<String, crate::persist::Preset>>,
    /// Sessions read from disk at startup, waiting for their file to be opened.
    pub saved: RwLock<std::collections::BTreeMap<String, crate::persist::SavedSession>>,
    /// The output device, opened on first use. A machine with no sound card
    /// must still be able to browse and tag, so this stays None until asked.
    pub audio: std::sync::Mutex<Option<engine::Handle>>,
    /// Acoustic fingerprints, one per audio file. Built on demand and kept
    /// beside the index.
    pub prints: RwLock<search::store::Store>,
    /// What the classifier heard in each file. Only measured labels are stored;
    /// see [`App::heard`] for the ones that were borrowed from a neighbour.
    pub labels: RwLock<yamnet::store::Store>,
    /// Measured labels plus the borrowed ones, which is what the interface
    /// shows. Derived from `labels`, so it lives only in memory and is rebuilt
    /// whenever anything new is measured.
    pub heard: RwLock<std::collections::BTreeMap<String, yamnet::Labels>>,
    /// The classifier itself, 16 MB of weights, loaded the first time a label
    /// is asked for. A machine without the model file must still be able to
    /// browse, tag and play, so this stays None and nothing else notices.
    pub model: Mutex<Option<Arc<yamnet::Model>>>,
    /// Tag fields a person has edited by hand, for folders and for individual
    /// files. Held in memory as well as on disk because the panel has to be
    /// able to show a saved value in preference to a suggested one, and reading
    /// the file on every selection would be silly.
    pub overrides: RwLock<crate::json::Value>,
    /// Tags of the user's own invention — "time stretched", "vocal stretch" —
    /// and the examples the system learns them from.
    pub user_tags: RwLock<crate::usertags::Store>,
    /// What the audio engine currently holds: which file, how many frames of it
    /// at the device's rate, and that rate. The engine itself does not know —
    /// it owns samples, not paths — but a visualiser needs to know which
    /// document's parameters describe the cloud it is drawing.
    /// What the engine is holding, if anything.
    pub playing: RwLock<Option<NowPlaying>>,
}

impl App {
    pub fn new(data_dir: PathBuf) -> Self {
        // Read every sidecar before `data_dir` is moved into the struct.
        let markers = crate::docs::MarkerStore::load(&data_dir.join("MARKERS.json"));
        let presets = crate::persist::load_presets(&data_dir.join("PRESETS.json"));
        let saved = crate::persist::load_sessions(&data_dir.join("SESSIONS.json"));
        let prints = search::store::Store::load(&data_dir.join("FINGERPRINTS.tsv"));
        let labels = yamnet::store::Store::load(&data_dir.join("LABELS.tsv"));
        let user_tags = crate::usertags::Store::load(&data_dir.join("USER-TAGS.tsv"));
        let automation = crate::automation::AutomationStore::load(&data_dir.join("AUTOMATION.json"));
        let overrides = std::fs::read_to_string(data_dir.join("TAG-OVERRIDES.json"))
            .ok()
            .and_then(|s| crate::json::parse(&s))
            .unwrap_or_else(crate::json::Value::obj);
        let app = App {
            data_dir,
            library: RwLock::new(None),
            // Ask for 1024 frames rather than taking the device's default,
            // which is 512 on most Macs.
            //
            // A block has to be *made* faster than it plays, and doubling its
            // length doubles the time available without doubling the work —
            // most of what an engine does per block is per-sample, and the
            // fixed costs per callback are then paid half as often. It is the
            // cheapest headroom there is. The price is about 21 ms of output
            // latency at 48 kHz, which the playhead already measures and
            // subtracts rather than assuming.
            //
            // Overridable, and remembered, through `/api/audio/buffer`.
            buffer_frames: RwLock::new(Some(1024)),
            grain_cap: RwLock::new(DEFAULT_GRAIN_CAP),
            decoded: RwLock::new(None),
            index: RwLock::new(Index::default()),
            scan: Arc::new(ScanProgress::default()),
            export: Arc::new(ExportProgress::default()),
            markers: RwLock::new(markers),
            audio: std::sync::Mutex::new(None),
            prints: RwLock::new(prints),
            labels: RwLock::new(labels),
            heard: RwLock::new(Default::default()),
            model: Mutex::new(None),
            overrides: RwLock::new(overrides),
            user_tags: RwLock::new(user_tags),
            playing: RwLock::new(None),
            edits: crate::docs::EditStore::default(),
            racks: crate::rack::RackStore::default(),
            automation,
            recorder: Mutex::new(None),
            presets: RwLock::new(presets),
            saved: RwLock::new(saved),
        };
        app.load_config();
        let _ = app.load_index();
        app
    }

    pub fn config_path(&self) -> PathBuf {
        self.data_dir.join("config.json")
    }

    pub fn index_path(&self) -> PathBuf {
        self.data_dir.join("AUDIO-INDEX.tsv")
    }

    pub fn prints_path(&self) -> PathBuf {
        self.data_dir.join("FINGERPRINTS.tsv")
    }

    pub fn labels_path(&self) -> PathBuf {
        self.data_dir.join("LABELS.tsv")
    }

    pub fn user_tags_path(&self) -> PathBuf {
        self.data_dir.join("USER-TAGS.tsv")
    }

    pub fn overrides_path(&self) -> PathBuf {
        self.data_dir.join("TAG-OVERRIDES.json")
    }

    pub fn markers_path(&self) -> PathBuf {
        self.data_dir.join("MARKERS.json")
    }

    pub fn order_path(&self) -> PathBuf {
        self.data_dir.join("FOLDER-ORDER.json")
    }

    pub fn presets_path(&self) -> PathBuf {
        self.data_dir.join("PRESETS.json")
    }

    pub fn sessions_path(&self) -> PathBuf {
        self.data_dir.join("SESSIONS.json")
    }

    pub fn automation_path(&self) -> PathBuf {
        self.data_dir.join("AUTOMATION.json")
    }

    /// Write every open document to disk.
    ///
    /// Called after each edit. The whole map is rewritten rather than patched:
    /// it is a few kilobytes, and a partial update is a way to lose data.
    pub fn save_sessions(&self) {
        let mut out = self.saved.read().unwrap().clone();
        for (path, list) in self.edits.all() {
            let rack = self.racks.get(&path);
            // A document back at its original state is worth forgetting, so the
            // file does not accumulate an entry per sound ever auditioned.
            if list.is_identity() && !rack.is_active() {
                out.remove(&path);
                continue;
            }
            out.insert(
                path,
                crate::persist::SavedSession {
                    edit: crate::persist::edit_to_json(&list),
                    rack: rack.to_json(),
                },
            );
        }
        if crate::persist::save_sessions(&self.sessions_path(), &out).is_ok() {
            *self.saved.write().unwrap() = out;
        }
    }

    /// Restore a file's saved work the first time it is opened.
    ///
    /// Returns the list to start from: the saved one if it still matches the
    /// file on disk, otherwise the untouched original.
    pub fn restore(&self, rel: &str, fresh: edit::EditList) -> edit::EditList {
        let Some(saved) = self.saved.read().unwrap().get(rel).cloned() else {
            return fresh;
        };
        let rack = crate::rack::RackSpec::from_json(&saved.rack);
        if !rack.slots.is_empty() {
            self.racks.set(rel, rack);
        }
        crate::persist::edit_from_json(&saved.edit, &fresh).unwrap_or(fresh)
    }

    fn load_config(&self) {
        let Ok(raw) = std::fs::read_to_string(self.config_path()) else {
            return;
        };
        let Some(v) = crate::json::parse(&raw) else { return };
        if let Some(p) = v.get("library").and_then(|p| p.as_str()) {
            let path = PathBuf::from(p);
            // A library on an unplugged drive should not be remembered as valid.
            if path.is_dir() {
                *self.library.write().unwrap() = Some(path);
            }
        }
        if let Some(crate::json::Value::Num(n)) = v.get("grainCap") {
            let n = *n as usize;
            if n >= 500 {
                *self.grain_cap.write().unwrap() = n.min(200_000);
            }
        }
        if let Some(crate::json::Value::Num(n)) = v.get("bufferFrames") {
            let n = *n as u32;
            if n > 0 {
                *self.buffer_frames.write().unwrap() = Some(n.clamp(32, 8192));
            }
        }
    }

    /// Write the whole of the config.
    ///
    /// Every setting at once, because this file is written whole: saving the
    /// library used to write an object containing only the library, which
    /// silently dropped anything else that had been put in it.
    fn save_config(&self) -> std::io::Result<()> {
        let mut v = crate::json::Value::obj();
        if let Some(p) = self.library.read().unwrap().as_ref() {
            v = v.set("library", p.to_string_lossy().to_string());
        }
        if let Some(n) = *self.buffer_frames.read().unwrap() {
            v = v.set("bufferFrames", n as f64);
        }
        v = v.set("grainCap", *self.grain_cap.read().unwrap() as f64);
        std::fs::create_dir_all(&self.data_dir)?;
        std::fs::write(self.config_path(), v.to_string())
    }

    pub fn set_library(&self, path: PathBuf) -> std::io::Result<()> {
        *self.library.write().unwrap() = Some(path);
        self.save_config()
    }

    /// How many grains a picture may be sent.
    pub fn set_grain_cap(&self, cap: usize) -> std::io::Result<()> {
        *self.grain_cap.write().unwrap() = cap.clamp(500, 200_000);
        self.save_config()
    }

    /// The file, decoded, from the cache when it is the same file.
    ///
    /// Returns the samples and the channel count. Reads and decodes only when
    /// the cache holds something else, or when the file on disk has changed
    /// under it.
    pub fn decoded_source(
        &self,
        rel: &str,
        path: &std::path::Path,
    ) -> Option<(std::sync::Arc<Vec<f32>>, usize)> {
        let stamp = std::fs::metadata(path)
            .map(|m| (m.len(), m.modified().ok()))
            .unwrap_or((0, None));
        if let Ok(g) = self.decoded.read() {
            if let Some(d) = g.as_ref() {
                if d.rel == rel && d.stamp == stamp {
                    return Some((std::sync::Arc::clone(&d.samples), d.channels));
                }
            }
        }
        let mut reader = audio_core::open(path).ok()?;
        let frames = reader.info().frames();
        let channels = reader.info().channels.max(1) as usize;
        let samples = std::sync::Arc::new(reader.read_frames(0, frames).ok()?);
        if let Ok(mut g) = self.decoded.write() {
            *g = Some(DecodedSource {
                rel: rel.to_string(),
                stamp,
                samples: std::sync::Arc::clone(&samples),
                channels,
            });
        }
        Some((samples, channels))
    }

    /// What to ask the device for. `None` is whatever it offers.
    pub fn set_buffer_frames(&self, frames: Option<u32>) -> std::io::Result<()> {
        *self.buffer_frames.write().unwrap() = frames.map(|n| n.clamp(32, 8192));
        self.save_config()
    }

    pub fn load_index(&self) -> std::io::Result<()> {
        let idx = Index::load(&self.index_path())?;
        *self.index.write().unwrap() = idx;
        Ok(())
    }

    pub fn library_path(&self) -> Option<PathBuf> {
        self.library.read().unwrap().clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(folder: &str, category: &str, machine: &str, dur: f64) -> FileRow {
        FileRow {
            folder: folder.into(),
            rel_path: "a.wav".into(),
            filename: "a.wav".into(),
            subdir: String::new(),
            bytes: 1000,
            duration: dur,
            sample_rate: 44100,
            bits: 16,
            channels: 2,
            format: "WAV".into(),
            category: category.into(),
            confidence: "medium".into(),
            machine: machine.into(),
            ..Default::default()
        }
    }

    #[test]
    fn a_uniform_folder_gets_high_confidence() {
        let mut idx = Index {
            files: (0..6).map(|_| row("kits", "DRUM-ONESHOT", "TR-808", 0.3)).collect(),
            folders: Vec::new(),
        };
        idx.rebuild_folders();
        let f = &idx.folders[0];
        assert_eq!(f.confidence, "high");
        assert_eq!((f.level1.as_str(), f.level2.as_str()), ("Drum", "Machine"));
    }

    #[test]
    fn a_mixed_folder_gets_low_confidence() {
        // No category dominates, so the grouping is a guess and must say so.
        let mut files = Vec::new();
        for c in ["DRUM-ONESHOT", "LOOP", "VOCAL", "FX", "CHOP", "SAMPLE"] {
            files.push(row("misc", c, "", 1.0));
        }
        let mut idx = Index { files, folders: Vec::new() };
        idx.rebuild_folders();
        assert_eq!(idx.folders[0].confidence, "low");
    }

    #[test]
    fn a_small_but_uniform_folder_is_not_called_high_confidence() {
        // Three files all agreeing is not the same evidence as thirty.
        let mut idx = Index {
            files: (0..3).map(|_| row("tiny", "LOOP", "", 2.0)).collect(),
            folders: Vec::new(),
        };
        idx.rebuild_folders();
        assert_eq!(idx.folders[0].confidence, "medium");
    }

    #[test]
    fn non_audio_files_do_not_dilute_the_dominant_category() {
        let mut files: Vec<FileRow> = (0..5).map(|_| row("kits", "DRUM-ONESHOT", "TR-909", 0.3)).collect();
        for _ in 0..20 {
            files.push(row("kits", "CACHE", "", 0.0));
        }
        let mut idx = Index { files, folders: Vec::new() };
        idx.rebuild_folders();
        let f = &idx.folders[0];
        assert_eq!(f.audio_files, 5);
        assert_eq!(f.files, 25);
        assert_eq!(f.confidence, "high");
    }

    #[test]
    fn a_soft_sampler_is_filed_as_a_kit_not_a_machine() {
        let mut idx = Index {
            files: (0..6).map(|_| row("battery kit", "DRUM-ONESHOT", "NI Battery", 0.3)).collect(),
            folders: Vec::new(),
        };
        idx.rebuild_folders();
        assert_eq!(idx.folders[0].level2, "Kit");
    }

    #[test]
    fn minutes_are_summed_from_audio_only() {
        let mut idx = Index {
            files: vec![
                row("f", "LOOP", "", 60.0),
                row("f", "LOOP", "", 60.0),
                row("f", "CACHE", "", 9999.0),
            ],
            folders: Vec::new(),
        };
        idx.rebuild_folders();
        assert!((idx.folders[0].minutes - 2.0).abs() < 1e-9);
    }
}
