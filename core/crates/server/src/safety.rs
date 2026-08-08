//! Keeping requested paths inside the library.
//!
//! Every path in a request is attacker-controlled as far as this code is
//! concerned. The server binds to localhost, but any page open in the same
//! browser can reach it, so `../../../../etc/passwd` has to fail here rather
//! than being caught somewhere downstream.

use std::path::{Component, Path, PathBuf};

/// Resolve `rel` inside `root`, or return `None` if it would escape.
///
/// Both paths are canonicalised, so symlinks that point outside the library are
/// rejected too — checking the string form alone would let them through.
pub fn resolve_within(root: &Path, rel: &str) -> Option<PathBuf> {
    if rel.is_empty() {
        return None;
    }
    // Windows-style separators arrive from index files written on the PC.
    let normalised = rel.replace('\\', "/");

    // Reject anything suspicious before touching the filesystem, so a traversal
    // attempt never becomes a stat() call against an unexpected path.
    let candidate = Path::new(&normalised);
    if candidate.is_absolute() {
        return None;
    }
    for c in candidate.components() {
        match c {
            Component::Normal(_) | Component::CurDir => {}
            // ParentDir, RootDir and Windows prefixes all mean escape.
            _ => return None,
        }
    }

    let root = root.canonicalize().ok()?;
    let joined = root.join(candidate);
    let resolved = joined.canonicalize().ok()?;

    // The final authority: after resolving symlinks, is it still inside?
    resolved.starts_with(&root).then_some(resolved)
}

/// Resolve a path that need not exist yet, for files about to be written.
/// Applies the same component rules but canonicalises only the parent.
pub fn resolve_for_write(root: &Path, rel: &str) -> Option<PathBuf> {
    let normalised = rel.replace('\\', "/");
    let candidate = Path::new(&normalised);
    if candidate.is_absolute() {
        return None;
    }
    for c in candidate.components() {
        match c {
            Component::Normal(_) | Component::CurDir => {}
            _ => return None,
        }
    }
    let root = root.canonicalize().ok()?;
    let joined = root.join(candidate);
    let parent = joined.parent()?.canonicalize().ok()?;
    parent.starts_with(&root).then_some(joined)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Build a throwaway library tree and return its root.
    fn fixture(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("audiolab-safety-{name}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("lib/folder/sub")).unwrap();
        fs::write(root.join("lib/folder/kick.wav"), b"x").unwrap();
        fs::write(root.join("lib/folder/sub/snare.wav"), b"x").unwrap();
        fs::write(root.join("secret.txt"), b"password").unwrap();
        root
    }

    #[test]
    fn resolves_a_plain_relative_path() {
        let root = fixture("plain");
        let lib = root.join("lib");
        let got = resolve_within(&lib, "folder/kick.wav").expect("should resolve");
        assert!(got.ends_with("kick.wav"));
        assert!(got.starts_with(lib.canonicalize().unwrap()));
    }

    #[test]
    fn resolves_a_nested_path() {
        let root = fixture("nested");
        assert!(resolve_within(&root.join("lib"), "folder/sub/snare.wav").is_some());
    }

    #[test]
    fn rejects_dot_dot_traversal() {
        let root = fixture("traverse");
        let lib = root.join("lib");
        // This file genuinely exists one level up, so only the check stops it.
        assert!(resolve_within(&lib, "../secret.txt").is_none());
        assert!(resolve_within(&lib, "folder/../../secret.txt").is_none());
        assert!(resolve_within(&lib, "../../../../../../etc/passwd").is_none());
    }

    #[test]
    fn rejects_backslash_traversal() {
        // Index files written on Windows use backslashes; normalising them must
        // not open a second way past the check.
        let root = fixture("backslash");
        assert!(resolve_within(&root.join("lib"), "..\\secret.txt").is_none());
        assert!(resolve_within(&root.join("lib"), "folder\\..\\..\\secret.txt").is_none());
    }

    #[test]
    fn rejects_absolute_paths() {
        let root = fixture("absolute");
        assert!(resolve_within(&root.join("lib"), "/etc/passwd").is_none());
        assert!(resolve_within(&root.join("lib"), "/").is_none());
    }

    #[test]
    fn rejects_an_empty_path() {
        let root = fixture("empty");
        assert!(resolve_within(&root.join("lib"), "").is_none());
    }

    #[test]
    fn rejects_a_symlink_pointing_outside_the_library() {
        // A string-only check passes this; only canonicalising catches it.
        let root = fixture("symlink");
        let lib = root.join("lib");
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.join("secret.txt"), lib.join("escape.txt")).unwrap();
            assert!(resolve_within(&lib, "escape.txt").is_none());
        }
        #[cfg(not(unix))]
        let _ = lib;
    }

    #[test]
    fn a_leading_dot_slash_is_harmless() {
        let root = fixture("curdir");
        assert!(resolve_within(&root.join("lib"), "./folder/kick.wav").is_some());
    }

    #[test]
    fn a_nonexistent_file_does_not_resolve() {
        let root = fixture("missing");
        assert!(resolve_within(&root.join("lib"), "folder/nope.wav").is_none());
    }

    #[test]
    fn write_resolution_allows_a_new_file_but_still_blocks_escape() {
        let root = fixture("write");
        let lib = root.join("lib");
        assert!(resolve_for_write(&lib, "folder/_TAGS.txt").is_some());
        assert!(resolve_for_write(&lib, "../secret.txt").is_none());
        assert!(resolve_for_write(&lib, "/tmp/evil.txt").is_none());
    }
}
