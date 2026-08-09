//! Labels on disk, one row per file.
//!
//! A TSV beside the index and the fingerprints, for the same reasons: it is
//! greppable, diffable, survives a half-written write, and needs no database.
//!
//! Only what was *measured* is stored. Borrowed labels are worked out again
//! from the measured ones each time, because a loan depends on which other
//! files are present — adding one recognisable snare to a folder should change
//! what its neighbours are called, and a cached loan would not.

use crate::{Detection, Labels};
use std::collections::BTreeMap;
use std::path::Path;

/// Bumped when the labels a given sound would get change — a different model, a
/// different presentation, a different cutoff. A stored row from an older build
/// is not upgradable, it is just wrong, so the whole file is discarded and
/// rebuilt from the audio.
const VERSION: &str = "yamnet-3";

#[derive(Default)]
pub struct Store {
    pub by_path: BTreeMap<String, Labels>,
}

impl Store {
    pub fn load(path: &Path) -> Store {
        let mut store = Store::default();
        let Ok(text) = std::fs::read_to_string(path) else {
            return store;
        };
        let mut lines = text.lines();
        match lines.next() {
            Some(h) if h == header() => {}
            _ => return store,
        }

        for line in lines {
            let mut cols = line.split('\t');
            let Some(p) = cols.next() else { continue };
            if p.is_empty() {
                continue;
            }
            let words = cols.next().map(parse_words).unwrap_or_default();
            store.by_path.insert(p.to_string(), Labels { words, from: None });
        }
        store
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let mut out = String::from(header());
        out.push('\n');
        for (p, l) in &self.by_path {
            out.push_str(p);
            out.push('\t');
            out.push_str(&write_words(&l.words));
            out.push('\n');
        }
        // Temp file then rename, so an interrupted write cannot leave a
        // half-written file where a whole one used to be.
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, out)?;
        std::fs::rename(&tmp, path)
    }

    /// Whether this file has been through the model, regardless of whether the
    /// model had anything to say about it. Distinguishing the two is what stops
    /// every unrecognisable sound being re-analysed on every request.
    pub fn measured(&self, path: &str) -> bool {
        self.by_path.contains_key(path)
    }

    pub fn insert(&mut self, path: &str, words: Vec<Detection>) {
        self.by_path.insert(path.to_string(), Labels { words, from: None });
    }

    pub fn len(&self) -> usize {
        self.by_path.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_path.is_empty()
    }
}

fn header() -> String {
    format!("path\tlabels\t{VERSION}")
}

fn parse_words(field: &str) -> Vec<Detection> {
    field
        .split('|')
        .filter(|s| !s.trim().is_empty())
        .filter_map(|pair| {
            // Class names contain commas and spaces but never a colon, so the
            // last one separates the name from its score.
            let (label, score) = pair.rsplit_once(':')?;
            Some(Detection { label: label.to_string(), score: score.parse().ok()? })
        })
        .collect()
}

fn write_words(words: &[Detection]) -> String {
    words
        .iter()
        .map(|d| format!("{}:{:.3}", d.label, d.score))
        .collect::<Vec<_>>()
        .join("|")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("audiolab-labels-{name}-{}.tsv", std::process::id()))
    }

    fn store_with(rows: &[(&str, &[(&str, f32)])]) -> Store {
        let mut s = Store::default();
        for (p, words) in rows {
            s.insert(
                p,
                words
                    .iter()
                    .map(|(l, v)| Detection { label: l.to_string(), score: *v })
                    .collect(),
            );
        }
        s
    }

    #[test]
    fn a_saved_store_reads_back_the_same() {
        let path = tmp("roundtrip");
        let s = store_with(&[
            ("P/snare 1.wav", &[("Snare drum", 0.53), ("Drum", 0.71)]),
            ("P/quiet.wav", &[]),
        ]);
        s.save(&path).unwrap();

        let back = Store::load(&path);
        assert_eq!(back.len(), 2);
        assert_eq!(back.by_path["P/snare 1.wav"].words[0].label, "Snare drum");
        assert!((back.by_path["P/snare 1.wav"].words[0].score - 0.53).abs() < 1e-3);
        assert!(back.by_path["P/quiet.wav"].words.is_empty());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_class_name_containing_a_comma_survives_the_round_trip() {
        let path = tmp("comma");
        store_with(&[("P/a.wav", &[("Vehicle horn, car horn, honking", 0.2)])])
            .save(&path)
            .unwrap();
        let back = Store::load(&path);
        assert_eq!(back.by_path["P/a.wav"].words[0].label, "Vehicle horn, car horn, honking");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_file_from_a_different_build_is_discarded_rather_than_believed() {
        let path = tmp("stale");
        std::fs::write(&path, "path\tlabels\tyamnet-0\nP/a.wav\tSnare drum:0.9\n").unwrap();
        assert!(Store::load(&path).is_empty(), "a stale file must not be trusted");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_missing_file_is_an_empty_store_rather_than_an_error() {
        assert!(Store::load(Path::new("/nowhere/LABELS.tsv")).is_empty());
    }

    #[test]
    fn measuring_nothing_still_counts_as_having_measured() {
        let s = store_with(&[("P/a.wav", &[])]);
        assert!(s.measured("P/a.wav"), "otherwise it is re-analysed forever");
        assert!(!s.measured("P/b.wav"));
    }
}
