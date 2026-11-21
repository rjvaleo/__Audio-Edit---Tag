//! Presets for the Prism pad, per process, as Hyperprism kept them.
//!
//! A Hyperprism preset was a process's pad window, its other settings and its
//! post-roll — loading one never moved the pad's position. Each process has
//! its factory set, decoded from Hyperprism-PPC 1.2.1's own presets file
//! (`hyperprism_presets.json`, keyed by pad source kind: a prism effect's id,
//! or `ptc` for the Pitch Time Changer), and the user's own, kept in
//! `PAD-PRESETS.json` in the data folder. Any source can have user presets;
//! only Hyperprism's processes have factory ones.

use crate::json::Value;
use std::path::{Path, PathBuf};

/// Hyperprism's factory presets: 180 across its 26 processes.
const FACTORY: &str = include_str!("hyperprism_presets.json");

pub fn factory(kind: &str) -> Vec<Value> {
    match crate::json::parse(FACTORY).and_then(|v| v.get(kind).cloned()) {
        Some(Value::Arr(a)) => a,
        _ => Vec::new(),
    }
}

fn path(data_dir: &Path) -> PathBuf {
    data_dir.join("PAD-PRESETS.json")
}

fn load(data_dir: &Path) -> Value {
    std::fs::read_to_string(path(data_dir))
        .ok()
        .and_then(|s| crate::json::parse(&s))
        .unwrap_or_else(Value::obj)
}

fn store(data_dir: &Path, all: &Value) -> std::io::Result<()> {
    std::fs::write(path(data_dir), all.to_string())
}

pub fn user(data_dir: &Path, kind: &str) -> Vec<Value> {
    match load(data_dir).get(kind) {
        Some(Value::Arr(a)) => a.clone(),
        _ => Vec::new(),
    }
}

/// Save `preset` under `name` for `kind`, replacing one of that name.
pub fn save(data_dir: &Path, kind: &str, name: &str, preset: &Value) -> std::io::Result<()> {
    let mut list: Vec<Value> = user(data_dir, kind)
        .into_iter()
        .filter(|p| p.get("name").and_then(Value::as_str) != Some(name))
        .collect();
    list.push(preset.clone().set("name", name));
    store(data_dir, &load(data_dir).set(kind, Value::Arr(list)))
}

pub fn rename(data_dir: &Path, kind: &str, from: &str, to: &str) -> std::io::Result<()> {
    let list: Vec<Value> = user(data_dir, kind)
        .into_iter()
        .filter(|p| p.get("name").and_then(Value::as_str) != Some(to))
        .map(|p| if p.get("name").and_then(Value::as_str) == Some(from) { p.set("name", to) } else { p })
        .collect();
    store(data_dir, &load(data_dir).set(kind, Value::Arr(list)))
}

pub fn delete(data_dir: &Path, kind: &str, name: &str) -> std::io::Result<()> {
    let list: Vec<Value> =
        user(data_dir, kind).into_iter().filter(|p| p.get("name").and_then(Value::as_str) != Some(name)).collect();
    store(data_dir, &load(data_dir).set(kind, Value::Arr(list)))
}
