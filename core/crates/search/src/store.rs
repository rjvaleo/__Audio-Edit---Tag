//! Fingerprints on disk, one row per file.
//!
//! A TSV beside the index, for the same reason the index is one: it is
//! greppable, diffable, survives a half-written write, and needs no database.

use crate::{Fingerprint, DIMS};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Default)]
pub struct Store {
    pub by_path: BTreeMap<String, Fingerprint>,
}

impl Store {
    pub fn load(path: &Path) -> Store {
        let mut store = Store::default();
        let Ok(text) = std::fs::read_to_string(path) else {
            return store;
        };
        let mut lines = text.lines();

        // The header names the dimensions. If it does not match what this build
        // measures, the file was written by a different version and every row
        // in it is meaningless — silently padding short rows with zeros would
        // put wrong numbers into the ranking rather than obviously wrong ones.
        // Returning empty makes the next search rebuild from the audio.
        let expected: Vec<&str> = std::iter::once("path").chain(crate::NAMES).collect();
        match lines.next() {
            Some(h) if h.split('\t').collect::<Vec<_>>() == expected => {}
            _ => return store,
        }

        for line in lines {
            let mut cols = line.split('\t');
            let Some(p) = cols.next() else { continue };
            let mut v = [0f32; DIMS];
            let mut n = 0;
            for (i, c) in cols.enumerate().take(DIMS) {
                v[i] = c.parse().unwrap_or(0.0);
                n += 1;
            }
            // A truncated final row is padded rather than dropped, matching how
            // the audio index treats one: a half-written line is still mostly
            // information.
            if n > 0 {
                store.by_path.insert(p.to_string(), Fingerprint { v });
            }
        }
        store
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let mut out = String::from("path");
        for n in crate::NAMES {
            out.push('\t');
            out.push_str(n);
        }
        out.push('\n');
        for (p, fp) in &self.by_path {
            out.push_str(p);
            for x in fp.v {
                out.push('\t');
                out.push_str(&format!("{x:.5}"));
            }
            out.push('\n');
        }
        // Temp file then rename, so an interrupted write cannot leave a
        // half-written index where a whole one used to be.
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, out)?;
        std::fs::rename(&tmp, path)
    }

    pub fn get(&self, path: &str) -> Option<Fingerprint> {
        self.by_path.get(path).copied()
    }

    pub fn insert(&mut self, path: &str, fp: Fingerprint) {
        self.by_path.insert(path.to_string(), fp);
    }

    pub fn len(&self) -> usize {
        self.by_path.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_path.is_empty()
    }
}
