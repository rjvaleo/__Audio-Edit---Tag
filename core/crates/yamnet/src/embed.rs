//! The model's fingerprint of each sound, on disk, one row per file.
//!
//! YAMNet describes every patch of audio with 1,024 numbers before it turns
//! them into class names; [`Model::listen`](crate::Model::listen) averages them
//! over the sound. Sounds the model hears as alike have fingerprints pointing
//! the same way, which is what the sound map is laid out by.
//!
//! A TSV beside the labels, for the same reasons. Each fingerprint is stored
//! as one byte a number against the row's own largest value: a thousand sounds
//! come to two megabytes rather than eight, and the similarity between two of
//! them moves in the third decimal place, which no layout can see. The model's
//! values are never negative (they come out of a ReLU), so a byte loses no sign.

use std::collections::BTreeMap;
use std::path::Path;

/// Bumped when a stored fingerprint would no longer mean what a fresh one
/// does — another model, another presentation. The file is then rebuilt.
const VERSION: &str = "yamnet-emb-1";

/// One fingerprint as kept: a byte a number, against `scale`, the largest.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Stored {
    pub scale: f32,
    pub bytes: Vec<u8>,
}

impl Stored {
    pub fn from_values(v: &[f32]) -> Stored {
        let scale = v.iter().fold(0.0f32, |a, b| a.max(*b));
        let bytes = v.iter().map(|x| if scale > 0.0 { (x.max(0.0) / scale * 255.0).round() as u8 } else { 0 }).collect();
        Stored { scale, bytes }
    }

    pub fn values(&self) -> Vec<f32> {
        self.bytes.iter().map(|b| *b as f32 / 255.0 * self.scale).collect()
    }
}

/// Kept as bytes in memory too, not only on disk: a whole library of eighty
/// thousand sounds is 80 MB this way and 330 MB as floats.
#[derive(Default)]
pub struct Embeddings {
    pub by_path: BTreeMap<String, Stored>,
}

impl Embeddings {
    pub fn load(path: &Path) -> Embeddings {
        let mut store = Embeddings::default();
        let Ok(text) = std::fs::read_to_string(path) else { return store };
        let mut lines = text.lines();
        if lines.next() != Some(header().as_str()) {
            return store;
        }
        for line in lines {
            let mut cols = line.split('\t');
            let (Some(p), Some(scale), Some(hex)) = (cols.next(), cols.next(), cols.next()) else { continue };
            let Ok(scale) = scale.parse::<f32>() else { continue };
            if p.is_empty() || hex.len() % 2 != 0 {
                continue;
            }
            let bytes: Option<Vec<u8>> =
                (0..hex.len() / 2).map(|i| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).ok()).collect();
            if let Some(bytes) = bytes {
                store.by_path.insert(p.to_string(), Stored { scale, bytes });
            }
        }
        store
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let mut out = header();
        out.push('\n');
        for (p, v) in &self.by_path {
            out.push_str(p);
            out.push('\t');
            out.push_str(&format!("{}", v.scale));
            out.push('\t');
            for b in &v.bytes {
                out.push_str(&format!("{b:02x}"));
            }
            out.push('\n');
        }
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, out)?;
        std::fs::rename(&tmp, path)
    }

    pub fn has(&self, path: &str) -> bool {
        self.by_path.contains_key(path)
    }

    pub fn insert(&mut self, path: &str, v: Vec<f32>) {
        self.by_path.insert(path.to_string(), Stored::from_values(&v));
    }

    pub fn get(&self, path: &str) -> Option<&Stored> {
        self.by_path.get(path)
    }

    pub fn len(&self) -> usize {
        self.by_path.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_path.is_empty()
    }
}

fn header() -> String {
    format!("path\tscale\tbytes\t{VERSION}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fingerprint_survives_the_disk_to_within_a_byte() {
        let dir = std::env::temp_dir().join(format!("emb-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("EMBEDDINGS.tsv");
        let mut s = Embeddings::default();
        let v: Vec<f32> = (0..1024).map(|i| (i % 37) as f32 * 0.05).collect();
        s.insert("kit/a.wav", v.clone());
        s.insert("kit/silent.wav", vec![0.0; 1024]);
        s.save(&file).unwrap();
        let back = Embeddings::load(&file);
        assert_eq!(back.len(), 2);
        let got = back.get("kit/a.wav").unwrap().values();
        let top = 36.0 * 0.05;
        for (a, b) in v.iter().zip(&got) {
            assert!((a - b).abs() <= top / 255.0 + 1e-6);
        }
        assert!(back.get("kit/silent.wav").unwrap().values().iter().all(|x| *x == 0.0));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_file_from_another_version_is_ignored() {
        let dir = std::env::temp_dir().join(format!("emb-test-v-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("EMBEDDINGS.tsv");
        std::fs::write(&file, "path\tscale\tbytes\tyamnet-emb-0\nkit/a.wav\t1\tff\n").unwrap();
        assert!(Embeddings::load(&file).is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }
}
