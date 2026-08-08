//! Library scanning: walk folders, probe every file, classify it, write the index.
//!
//! Read-only with respect to the audio. This crate opens files, reads headers
//! and samples, and writes its findings to its own index files. It never
//! renames, moves, deletes or modifies anything in the library.

pub mod date;
pub mod tsv;

use audio_core::{probe, Container, FileSource, ProbeError};
use catalog::{classify, detect_series, Category, FileFacts};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const FILE_COLUMNS: &[&str] = &[
    "root_folder",
    "parent_chain",
    "rel_path",
    "filename",
    "stem",
    "ext",
    "bytes",
    "modified",
    "format",
    "samplerate",
    "bits",
    "channels",
    "duration_s",
    "duration_band",
    "category",
    "confidence",
    "machine",
    "instrument",
    "descriptor",
    "series_root",
    "series_index",
    "series_size",
    "bpm",
    "reasons",
    "notes",
];

/// One indexed file.
#[derive(Debug, Clone)]
pub struct FileRecord {
    pub root_folder: String,
    pub parent_chain: String,
    pub rel_path: String,
    pub filename: String,
    pub stem: String,
    pub ext: String,
    pub bytes: u64,
    pub modified: String,
    pub format: String,
    pub sample_rate: u32,
    pub bits: u16,
    pub channels: u16,
    pub duration: f64,
    pub category: Category,
    pub confidence: catalog::Confidence,
    pub machine: Option<String>,
    pub instrument: Option<String>,
    pub descriptors: Vec<String>,
    pub series_root: Option<String>,
    pub series_index: Option<u32>,
    pub series_size: Option<usize>,
    pub bpm: Option<u32>,
    pub reasons: Vec<String>,
    pub notes: String,
}

impl FileRecord {
    pub fn to_row(&self) -> Vec<String> {
        vec![
            self.root_folder.clone(),
            self.parent_chain.clone(),
            self.rel_path.clone(),
            self.filename.clone(),
            self.stem.clone(),
            self.ext.clone(),
            self.bytes.to_string(),
            self.modified.clone(),
            self.format.clone(),
            self.sample_rate.to_string(),
            self.bits.to_string(),
            self.channels.to_string(),
            format!("{:.3}", self.duration),
            duration_band(self.duration).to_string(),
            self.category.as_str().to_string(),
            self.confidence.as_str().to_string(),
            self.machine.clone().unwrap_or_default(),
            self.instrument.clone().unwrap_or_default(),
            self.descriptors.join(" "),
            self.series_root.clone().unwrap_or_default(),
            self.series_index.map(|v| v.to_string()).unwrap_or_default(),
            self.series_size.map(|v| v.to_string()).unwrap_or_default(),
            self.bpm.map(|v| v.to_string()).unwrap_or_default(),
            self.reasons.join("; "),
            self.notes.clone(),
        ]
    }
}

/// Coarse duration buckets, used to group files whose names say nothing.
pub fn duration_band(d: f64) -> &'static str {
    if d <= 0.0 {
        "unknown"
    } else if d < 1.0 {
        "A <1s"
    } else if d < 2.5 {
        "B 1-2.5s"
    } else if d < 8.0 {
        "C 2.5-8s"
    } else if d < 30.0 {
        "D 8-30s"
    } else if d < 90.0 {
        "E 30-90s"
    } else if d < 300.0 {
        "F 90s-5m"
    } else {
        "G >5m"
    }
}

/// Extensions we do not attempt to open as audio.
const SKIP_PROBE: &[&str] = &[
    ".asd", ".ovw", ".nov", ".reapeaks", ".pkf", ".sfk", ".db", ".ini", ".tmp", ".bak", ".txt",
    ".md", ".pdf", ".rtf", ".doc", ".docx", ".html", ".tsv", ".csv", ".nfo", ".jpg", ".png",
];

/// Index every file under `root`, which must be one top-level folder of the library.
pub fn scan_folder(library: &Path, root_name: &str) -> std::io::Result<Vec<FileRecord>> {
    let root = library.join(root_name);
    let mut out = Vec::new();
    let mut dirs = vec![root.clone()];

    while let Some(dir) = dirs.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut files: Vec<PathBuf> = Vec::new();
        for e in entries.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            // Hidden files and our own sidecars are not library content.
            if name.starts_with('.') || name == "_TAGS.txt" {
                continue;
            }
            if p.is_dir() {
                dirs.push(p);
            } else {
                files.push(p);
            }
        }
        files.sort();

        // Series membership is scoped to a single directory: "01".."24" in one
        // folder is a run, but the same numbers in a sibling folder are not.
        let stems: Vec<String> = files
            .iter()
            .map(|p| p.file_stem().unwrap_or_default().to_string_lossy().to_string())
            .collect();
        let series = detect_series(&stems);

        let rel_dir = dir.strip_prefix(&root).unwrap_or(Path::new(""));
        let chain_parts: Vec<String> = std::iter::once(root_name.to_string())
            .chain(
                rel_dir
                    .components()
                    .map(|c| c.as_os_str().to_string_lossy().to_string()),
            )
            .collect();
        let chain_refs: Vec<&str> = chain_parts.iter().map(|s| s.as_str()).collect();

        for (i, path) in files.iter().enumerate() {
            if let Some(rec) = index_one(&root, root_name, path, &chain_parts, &chain_refs, &stems[i], series[i].clone())
            {
                out.push(rec);
            }
        }
    }

    out.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    Ok(out)
}

fn index_one(
    root: &Path,
    root_name: &str,
    path: &Path,
    chain_parts: &[String],
    chain_refs: &[&str],
    stem: &str,
    series: Option<catalog::Series>,
) -> Option<FileRecord> {
    let meta = std::fs::metadata(path).ok()?;
    let bytes = meta.len();
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| date::ymd(d.as_secs() as i64))
        .unwrap_or_default();

    let filename = path.file_name()?.to_string_lossy().to_string();
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_default();
    let rel_path = path
        .strip_prefix(root)
        .ok()?
        .to_string_lossy()
        .replace('\\', "/");

    // Probe unless the extension says it cannot be audio.
    let mut format = "NON-AUDIO".to_string();
    let (mut sample_rate, mut bits, mut channels, mut duration) = (0u32, 0u16, 0u16, 0f64);
    let mut notes = String::new();
    let mut readable = true;

    if !SKIP_PROBE.contains(&ext.as_str()) && bytes > 0 {
        match FileSource::open(path).map_err(ProbeError::Io).and_then(|mut s| {
            let info = probe(&mut s)?;
            Ok(info)
        }) {
            Ok(info) => {
                format = format_name(&info);
                sample_rate = info.sample_rate;
                bits = info.bits;
                channels = info.channels;
                duration = info.duration_secs();
                if info.container == Container::Raw {
                    notes = "headerless - specs assumed, duration is an estimate".into();
                }
            }
            Err(e) => {
                readable = false;
                format = "UNREADABLE".into();
                notes = e.to_string();
            }
        }
    } else if bytes == 0 {
        readable = false;
        format = "EMPTY".into();
        notes = "zero bytes".into();
    }

    let facts = FileFacts {
        stem,
        ext: &ext,
        folder_chain: chain_refs,
        duration,
        readable,
        series: series.clone(),
    };
    let c = classify(&facts);

    Some(FileRecord {
        root_folder: root_name.to_string(),
        parent_chain: chain_parts.join(" > "),
        rel_path,
        filename,
        stem: stem.to_string(),
        ext,
        bytes,
        modified,
        format,
        sample_rate,
        bits,
        channels,
        duration,
        category: c.category,
        confidence: c.confidence,
        machine: c.machine,
        instrument: c.instrument,
        descriptors: c.descriptors,
        series_root: series.as_ref().map(|s| s.root.clone()),
        series_index: series.as_ref().map(|s| s.index),
        series_size: series.as_ref().map(|s| s.size),
        bpm: c.bpm,
        reasons: c.reasons,
        notes,
    })
}

fn format_name(info: &audio_core::AudioInfo) -> String {
    use audio_core::{Codec, Container};
    let base = match info.container {
        Container::Wav => "WAV",
        Container::Aiff => "AIFF",
        Container::Aifc => "AIFC",
        Container::Raw => "RAW-PCM",
    };
    match info.codec {
        Codec::PcmF32 => format!("{base}-float32"),
        Codec::PcmF64 => format!("{base}-float64"),
        _ => base.to_string(),
    }
}

/// Top-level folders of the library that are worth indexing.
pub fn library_roots(library: &Path) -> std::io::Result<Vec<String>> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(library)?.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name.starts_with('_') {
            continue;
        }
        if e.path().is_dir() {
            out.push(name);
        }
    }
    out.sort();
    Ok(out)
}
