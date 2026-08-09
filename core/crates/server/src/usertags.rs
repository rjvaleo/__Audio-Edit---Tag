//! The tags you make up yourself.
//!
//! Kept apart from everything else on purpose. The classifier's labels and the
//! fingerprint's descriptors are measurements — rerun them and they come back
//! the same, and a new model version simply replaces them. These are not
//! measurements, they are decisions, and nothing in the app is ever allowed to
//! overwrite one. So they live in their own file with no version marker to
//! invalidate them: a build that cannot understand this file has a bug, not a
//! stale cache.
//!
//! Separate storage is also what makes learning honest. If these were mixed
//! into the suggested tag field, the system would be learning from its own
//! suggestions and slowly convincing itself.

use std::collections::BTreeMap;
use std::path::Path;

#[derive(Default)]
pub struct Store {
    pub by_path: BTreeMap<String, Vec<String>>,
}

impl Store {
    pub fn load(path: &Path) -> Store {
        let mut store = Store::default();
        let Ok(text) = std::fs::read_to_string(path) else {
            return store;
        };
        for line in text.lines().skip(1) {
            let Some((p, tags)) = line.split_once('\t') else { continue };
            if p.is_empty() {
                continue;
            }
            let tags = split(tags);
            if !tags.is_empty() {
                store.by_path.insert(p.to_string(), tags);
            }
        }
        store
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let mut out = String::from("path\ttags\n");
        for (p, tags) in &self.by_path {
            out.push_str(p);
            out.push('\t');
            out.push_str(&tags.join("|"));
            out.push('\n');
        }
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, out)?;
        std::fs::rename(&tmp, path)
    }

    pub fn get(&self, path: &str) -> Vec<String> {
        self.by_path.get(path).cloned().unwrap_or_default()
    }

    /// Replace one sound's tags. An empty list removes the entry rather than
    /// storing a blank row.
    pub fn set(&mut self, path: &str, tags: Vec<String>) {
        let tags = clean(tags);
        if tags.is_empty() {
            self.by_path.remove(path);
        } else {
            self.by_path.insert(path.to_string(), tags);
        }
    }

    /// Every (path, tag) pair, which is what the learner wants.
    pub fn pairs(&self) -> impl Iterator<Item = (&str, &str)> {
        self.by_path
            .iter()
            .flat_map(|(p, tags)| tags.iter().map(move |t| (p.as_str(), t.as_str())))
    }

    /// Every distinct tag in use, for offering what already exists rather than
    /// letting three spellings of one idea accumulate.
    pub fn vocabulary(&self) -> Vec<String> {
        let mut seen: Vec<String> = Vec::new();
        for t in self.by_path.values().flatten() {
            if !seen.contains(t) {
                seen.push(t.clone());
            }
        }
        seen.sort();
        seen
    }

    pub fn len(&self) -> usize {
        self.by_path.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_path.is_empty()
    }
}

fn split(field: &str) -> Vec<String> {
    clean(field.split('|').map(|s| s.to_string()).collect())
}

/// Trim, drop blanks, fold case, and remove repeats.
///
/// Case-folded because "Time Stretched" and "time stretched" are one tag, and
/// two spellings would learn separately and each learn half as well.
fn clean(tags: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for t in tags {
        let t = t.trim().to_lowercase();
        // A tab would break the row apart on the way back in.
        let t = t.replace(['\t', '|', '\n'], " ").trim().to_string();
        if !t.is_empty() && !out.contains(&t) {
            out.push(t);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("audiolab-user-{name}-{}.tsv", std::process::id()))
    }

    fn tags(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_tag_with_spaces_survives_the_round_trip() {
        let path = tmp("spaces");
        let mut s = Store::default();
        s.set("P/a.wav", tags(&["time stretched", "vocal stretch"]));
        s.save(&path).unwrap();

        let back = Store::load(&path);
        assert_eq!(back.get("P/a.wav"), tags(&["time stretched", "vocal stretch"]));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn two_spellings_of_one_tag_become_one() {
        let mut s = Store::default();
        s.set("P/a.wav", tags(&["Time Stretched", "time stretched", "  TIME STRETCHED "]));
        assert_eq!(s.get("P/a.wav"), tags(&["time stretched"]));
    }

    #[test]
    fn clearing_every_tag_removes_the_sound_rather_than_storing_a_blank() {
        let mut s = Store::default();
        s.set("P/a.wav", tags(&["gritty"]));
        s.set("P/a.wav", tags(&["  "]));
        assert!(s.is_empty());
    }

    #[test]
    fn a_separator_typed_into_a_tag_cannot_break_the_file() {
        let path = tmp("sep");
        let mut s = Store::default();
        s.set("P/a.wav", tags(&["odd|tag\twith separators"]));
        s.save(&path).unwrap();
        assert_eq!(Store::load(&path).get("P/a.wav").len(), 1);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn every_pair_is_offered_to_the_learner() {
        let mut s = Store::default();
        s.set("P/a.wav", tags(&["gritty", "sub heavy"]));
        s.set("P/b.wav", tags(&["gritty"]));
        let mut got: Vec<(&str, &str)> = s.pairs().collect();
        got.sort();
        assert_eq!(
            got,
            [("P/a.wav", "gritty"), ("P/a.wav", "sub heavy"), ("P/b.wav", "gritty")]
        );
    }

    #[test]
    fn the_vocabulary_lists_each_tag_once() {
        let mut s = Store::default();
        s.set("P/a.wav", tags(&["gritty", "sub heavy"]));
        s.set("P/b.wav", tags(&["gritty"]));
        assert_eq!(s.vocabulary(), tags(&["gritty", "sub heavy"]));
    }

    #[test]
    fn a_missing_file_is_an_empty_store_rather_than_an_error() {
        assert!(Store::load(Path::new("/nowhere/USER-TAGS.tsv")).is_empty());
    }
}
