//! Grain's presets, in MGL's own shape: one JSON object of presets by name,
//! each `{name, note, path, stretch, rack}` (`persist::Preset`, MGL's
//! `data/PRESETS.json`), so a file either app writes, the other reads.
//!
//! The app keeps its own file and writes only that one; MGL's is listed after
//! it, read only. Applying one is MGL's `/api/presets/apply` without its
//! sound: the stretch replaces the document's as one edit, and the rack's
//! settings move onto the slots already there, matched by kind and by place
//! among slots of that kind, with the maximiser; nothing is added or removed.

use super::rack::RackSpec;
use super::stretch;
use mgl_fx::Stretch;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub struct Preset {
    pub name: String,
    pub note: String,
    pub path: String,
    pub stretch: Stretch,
    pub rack: RackSpec,
}

impl Preset {
    pub fn to_json(&self) -> Value {
        json!({ "name": self.name, "note": self.note, "path": self.path, "stretch": stretch::to_json(&self.stretch), "rack": self.rack.to_json() })
    }

    pub fn from_json(name: &str, v: &Value) -> Preset {
        Preset {
            name: v.get("name").and_then(Value::as_str).unwrap_or(name).to_string(),
            note: v.get("note").and_then(Value::as_str).unwrap_or("").to_string(),
            path: v.get("path").and_then(Value::as_str).unwrap_or("").to_string(),
            stretch: v.get("stretch").map(stretch::from_json).unwrap_or_default(),
            rack: v.get("rack").map(RackSpec::from_json).unwrap_or_else(RackSpec::empty),
        }
    }
}

/// `persist::load_presets`.
pub fn load(path: &Path) -> BTreeMap<String, Preset> {
    let Ok(raw) = std::fs::read_to_string(path) else { return BTreeMap::new() };
    let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&raw) else { return BTreeMap::new() };
    map.into_iter().map(|(k, v)| (k.clone(), Preset::from_json(&k, &v))).collect()
}

/// `persist::save_presets`, written whole and then moved into place.
pub fn save(path: &Path, items: &BTreeMap<String, Preset>) -> std::io::Result<()> {
    let root: Map<String, Value> = items.iter().map(|(k, v)| (k.clone(), v.to_json())).collect();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, Value::Object(root).to_string())?;
    std::fs::rename(&tmp, path)
}

/// Where the presets are: the app's own file, then MGL's (read only).
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

    /// Every preset, the app's first, each with where it is kept.
    pub fn list(&self) -> Value {
        let mut out = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        for (path, from) in [(&self.mine, "app"), (&self.mgl, "mgl")] {
            let Some(path) = path else { continue };
            for (k, p) in load(path) {
                if !seen.insert(k) {
                    continue;
                }
                let mut v = p.to_json();
                v["from"] = json!(from);
                out.push(v);
            }
        }
        json!({ "presets": out })
    }

    pub fn find(&self, name: &str) -> Option<Preset> {
        [&self.mine, &self.mgl].into_iter().flatten().find_map(|p| load(p).remove(name))
    }

    /// `POST /api/presets`: these settings under `name`, over it if there.
    pub fn store(&self, p: Preset) -> Result<Value, String> {
        let path = self.mine.as_ref().ok_or("no folder for the presets")?;
        let mut all = load(path);
        all.insert(p.name.clone(), p);
        save(path, &all).map_err(|e| e.to_string())?;
        Ok(self.list())
    }

    /// `POST /api/presets/update`: a new name or note (or settings), in the
    /// app's own file. One of MGL's is copied into the app's under its new name.
    pub fn update(&self, v: &Value) -> Result<Value, String> {
        let path = self.mine.as_ref().ok_or("no folder for the presets")?;
        let name = v.get("name").and_then(Value::as_str).ok_or("no name given")?;
        let mut all = load(path);
        let mut preset = match all.get(name).cloned().or_else(|| self.find(name)) {
            Some(p) => p,
            None => return Err("no such preset".into()),
        };
        let renamed = match v.get("to").and_then(Value::as_str).map(str::trim) {
            Some("") => return Err("a preset needs a name".into()),
            Some(to) if to != name => {
                if all.contains_key(to) {
                    return Err("a preset with that name already exists".into());
                }
                preset.name = to.to_string();
                true
            }
            _ => false,
        };
        if let Some(note) = v.get("note").and_then(Value::as_str) {
            preset.note = note.to_string();
        }
        if let Some(s) = v.get("stretch") {
            preset.stretch = stretch::from_json(s);
        }
        if let Some(r) = v.get("rack") {
            preset.rack = RackSpec::from_json(r);
        }
        if renamed {
            all.remove(name);
        }
        all.insert(preset.name.clone(), preset);
        save(path, &all).map_err(|e| e.to_string())?;
        Ok(self.list())
    }

    /// `POST /api/presets/delete`, from the app's own file only.
    pub fn delete(&self, name: &str) -> Result<Value, String> {
        let path = self.mine.as_ref().ok_or("no folder for the presets")?;
        let mut all = load(path);
        if all.remove(name).is_none() {
            return Err("only the app's own presets can be deleted here".into());
        }
        save(path, &all).map_err(|e| e.to_string())?;
        Ok(self.list())
    }
}

/// The rack after a preset's settings move onto it, without its sound.
pub fn rack_with(mine: &RackSpec, preset: &RackSpec) -> RackSpec {
    let mut mine = mine.clone();
    let mut used = vec![false; mine.slots.len()];
    for from in &preset.slots {
        let hit = mine.slots.iter().enumerate().position(|(i, slot)| !used[i] && std::mem::discriminant(slot) == std::mem::discriminant(from));
        if let Some(i) = hit {
            if mine.slots[i].take_settings_from(from) {
                used[i] = true;
            }
        }
    }
    mine.master = preset.master;
    mine
}
