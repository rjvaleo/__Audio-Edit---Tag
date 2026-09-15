//! Compositions: the whole Compose view kept under a name.
//!
//! One JSON file per composition in `data/compositions/`, named for it. The page
//! owns the shape — the sound, the engine's settings, the sequencer's state and
//! take, the look, every lane, the source switches, the frame and the view's
//! sizes — and the server keeps the file and hands it back. The name it was
//! saved under is kept inside it, because the file name is that name made safe.
//! See `docs/COMPOSE.md`, phase four.

use crate::json::{self, Value};
use std::path::{Path, PathBuf};

/// Where a composition called `name` is kept, or `None` when nothing is left of
/// the name once it is made safe.
pub fn path_for(dir: &Path, name: &str) -> Option<PathBuf> {
    let safe = crate::docs::safe_name(name);
    if safe.is_empty() {
        return None;
    }
    Some(dir.join(format!("{safe}.json")))
}

/// Every composition, by the name it was saved under, in alphabetical order.
pub fn list(dir: &Path) -> Vec<String> {
    let Ok(read) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<String> = read
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map_or(false, |x| x == "json"))
        .map(|p| {
            std::fs::read_to_string(&p)
                .ok()
                .and_then(|raw| json::parse(&raw))
                .and_then(|v| v.get("name").and_then(|n| n.as_str()).map(str::to_string))
                .unwrap_or_else(|| p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default())
        })
        .filter(|n| !n.is_empty())
        .collect();
    out.sort_by_key(|n| n.to_lowercase());
    out
}

pub fn get(dir: &Path, name: &str) -> Option<Value> {
    let path = path_for(dir, name)?;
    json::parse(&std::fs::read_to_string(path).ok()?)
}

/// Keep `composition` under `name`, and write the name into it.
pub fn save(dir: &Path, name: &str, composition: Value) -> std::io::Result<()> {
    let Some(path) = path_for(dir, name) else {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "a composition needs a name"));
    };
    if !matches!(composition, Value::Obj(_)) {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "a composition is an object"));
    }
    std::fs::create_dir_all(dir)?;
    let body = composition.set("name", name.trim().to_string());
    crate::persist::write_atomic(&path, &body.to_string())
}

/// Delete it. `false` when there was nothing by that name.
pub fn delete(dir: &Path, name: &str) -> std::io::Result<bool> {
    let Some(path) = path_for(dir, name) else {
        return Ok(false);
    };
    match std::fs::remove_file(path) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("compositions-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn a_composition_is_kept_listed_read_back_and_deleted() {
        let d = dir("round");
        let c = json::parse(r#"{"sound":{"path":"a/b.aif"},"lanes":{"visual":[]}}"#).unwrap();
        save(&d, "Night piece", c).unwrap();
        save(&d, "alpha", json::parse("{}").unwrap()).unwrap();
        assert_eq!(list(&d), vec!["alpha".to_string(), "Night piece".to_string()]);
        let back = get(&d, "Night piece").unwrap();
        assert_eq!(back.get("name").and_then(|n| n.as_str()), Some("Night piece"));
        assert_eq!(
            back.get("sound").and_then(|s| s.get("path")).and_then(|p| p.as_str()),
            Some("a/b.aif")
        );
        assert!(delete(&d, "Night piece").unwrap());
        assert!(!delete(&d, "Night piece").unwrap());
        assert_eq!(list(&d), vec!["alpha".to_string()]);
    }

    #[test]
    fn a_name_cannot_climb_out_of_the_folder() {
        let d = dir("climb");
        let p = path_for(&d, "../../etc/passwd").unwrap();
        assert_eq!(p.parent().unwrap(), d.as_path());
        assert!(path_for(&d, " ... ").is_none());
        assert!(save(&d, "x", json::parse("[1]").unwrap()).is_err(), "a list was kept as a composition");
    }
}
