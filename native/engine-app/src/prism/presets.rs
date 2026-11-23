//! The Prism pad's presets, per process, as Hyperprism kept them: MGL's
//! `server-engine/src/padpresets.rs` and its routes (`/api/pad/presets`,
//! `/rename`, `/delete`), in MGL's own file shape (`PAD-PRESETS.json`: a list
//! of presets per process kind), so a file either app writes, the other reads.
//!
//! The factory set is MGL's own file, built in. The user's are the app's own
//! file, which it writes; MGL's `data/PAD-PRESETS.json` is listed after them,
//! read only (each marked `"mgl": true`).

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// Hyperprism's factory presets: 180 across its 26 processes (MGL's file).
const FACTORY: &str = include_str!("../../../../core/crates/server-engine/src/hyperprism_presets.json");

/// `padpresets::factory`.
pub fn factory(kind: &str) -> Vec<Value> {
    match serde_json::from_str::<Value>(FACTORY).ok().and_then(|v| v.get(kind).cloned()) {
        Some(Value::Array(a)) => a,
        _ => Vec::new(),
    }
}

fn load(path: &Path) -> Value {
    std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).filter(Value::is_object).unwrap_or_else(|| json!({}))
}

fn store(path: &Path, all: &Value) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, all.to_string())?;
    std::fs::rename(&tmp, path)
}

fn user_in(path: &Path, kind: &str) -> Vec<Value> {
    match load(path).get(kind) {
        Some(Value::Array(a)) => a.clone(),
        _ => Vec::new(),
    }
}

/// Where they are: the app's own file, then MGL's (read only).
#[derive(Debug, Clone, Default)]
pub struct Places {
    pub mine: Option<PathBuf>,
    pub mgl: Option<PathBuf>,
}

impl Places {
    pub fn from_json(v: &Value) -> Places {
        let p = |k: &str| v.get(k).and_then(Value::as_str).filter(|s| !s.is_empty()).map(PathBuf::from);
        Places { mine: p("mine"), mgl: p("mgl") }
    }

    /// `padpresets::user`: the app's, then MGL's not already named.
    pub fn user(&self, kind: &str) -> Vec<Value> {
        let mut out = self.mine.as_deref().map(|p| user_in(p, kind)).unwrap_or_default();
        if let Some(m) = &self.mgl {
            for mut p in user_in(m, kind) {
                let name = p.get("name").and_then(Value::as_str).unwrap_or("").to_string();
                if out.iter().any(|q| q.get("name").and_then(Value::as_str) == Some(name.as_str())) {
                    continue;
                }
                if let Some(o) = p.as_object_mut() {
                    o.insert("mgl".into(), true.into());
                }
                out.push(p);
            }
        }
        out
    }

    /// `GET /api/pad/presets?kind=`.
    pub fn list(&self, kind: &str) -> Value {
        json!({ "factory": factory(kind), "user": self.user(kind) })
    }

    fn mine(&self) -> Result<&Path, String> {
        self.mine.as_deref().ok_or_else(|| "nowhere to keep presets".to_string())
    }

    /// `padpresets::save`: `preset` under `name`, replacing one of that name.
    pub fn save(&self, kind: &str, name: &str, preset: &Value) -> Result<Value, String> {
        let name = name.trim();
        if kind.is_empty() {
            return Err("a preset needs a kind, a name and its settings".into());
        }
        if name.is_empty() {
            return Err("a preset needs a name".into());
        }
        let path = self.mine()?;
        let mut list: Vec<Value> = user_in(path, kind).into_iter().filter(|p| p.get("name").and_then(Value::as_str) != Some(name)).collect();
        let mut p = preset.clone();
        match p.as_object_mut() {
            Some(o) => {
                o.insert("name".into(), name.into());
            }
            None => return Err("a preset needs a kind, a name and its settings".into()),
        }
        list.push(p);
        let mut all = load(path);
        all[kind] = Value::Array(list);
        store(path, &all).map_err(|e| e.to_string())?;
        Ok(json!({ "ok": true }))
    }

    /// `padpresets::rename`.
    pub fn rename(&self, kind: &str, from: &str, to: &str) -> Result<Value, String> {
        let to = to.trim();
        if to.is_empty() {
            return Err("a rename needs a kind, a name and a new name".into());
        }
        let path = self.mine()?;
        let mine = user_in(path, kind);
        if !mine.iter().any(|p| p.get("name").and_then(Value::as_str) == Some(from)) && self.user(kind).iter().any(|p| p.get("name").and_then(Value::as_str) == Some(from)) {
            return Err("that preset is MGL's: it is read only here".into());
        }
        let list: Vec<Value> = mine
            .into_iter()
            .filter(|p| p.get("name").and_then(Value::as_str) != Some(to))
            .map(|mut p| {
                if p.get("name").and_then(Value::as_str) == Some(from) {
                    p["name"] = to.into();
                }
                p
            })
            .collect();
        let mut all = load(path);
        all[kind] = Value::Array(list);
        store(path, &all).map_err(|e| e.to_string())?;
        Ok(json!({ "ok": true }))
    }

    /// `padpresets::delete`.
    pub fn delete(&self, kind: &str, name: &str) -> Result<Value, String> {
        let path = self.mine()?;
        let mine = user_in(path, kind);
        if !mine.iter().any(|p| p.get("name").and_then(Value::as_str) == Some(name)) && self.user(kind).iter().any(|p| p.get("name").and_then(Value::as_str) == Some(name)) {
            return Err("that preset is MGL's: it is read only here".into());
        }
        let list: Vec<Value> = mine.into_iter().filter(|p| p.get("name").and_then(Value::as_str) != Some(name)).collect();
        let mut all = load(path);
        all[kind] = Value::Array(list);
        store(path, &all).map_err(|e| e.to_string())?;
        Ok(json!({ "ok": true }))
    }
}
