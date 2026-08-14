//! Where a recording goes, and what it is called.
//!
//! A capture keeps what came *out* of the engine and belongs beside the file it
//! came from. A recording has no original — it is the first time this audio has
//! existed anywhere — so it goes into a folder of its own and is named for when
//! it was made.
//!
//! The same rule as everywhere else holds: this only ever creates a new file.
//! It does not overwrite, and if a name is taken it takes the next one.

use std::path::{Path, PathBuf};

/// The folder recordings land in, inside the library.
pub const FOLDER: &str = "Recordings";

/// Where this take should be written, and whether that is outside the library.
///
/// Inside the library when there is one, so the take appears in the browser
/// beside everything else and can be played, tagged and edited immediately.
/// Falling back to the app's own data directory when no library has been
/// chosen: refusing to record because nothing has been configured would lose
/// the take, which is worse than putting it somewhere findable.
pub fn target(library: Option<&Path>, data_dir: &Path, name: &str) -> (PathBuf, bool) {
    let stem = crate::capture::safe(name);
    let stem = if stem.is_empty() { "take".to_string() } else { stem };
    match library {
        Some(lib) => (unique(lib.join(FOLDER).join(format!("{stem}.wav"))), false),
        None => (
            unique(data_dir.join(FOLDER).join(format!("{stem}.wav"))),
            true,
        ),
    }
}

/// The library-relative path of a written take, if it landed in the library.
pub fn relative(library: Option<&Path>, path: &Path) -> Option<String> {
    let lib = library?;
    path.strip_prefix(lib)
        .ok()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
}

/// A name nothing is using yet. Same reasoning as an export's: recording twice
/// in a minute is ordinary, and silently replacing the first take is not.
pub fn unique(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = path.extension().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "wav".into());
    let dir = path.parent().map(Path::to_path_buf).unwrap_or_default();
    for n in 2..10_000 {
        let next = dir.join(format!("{stem} {n}.{ext}"));
        if !next.exists() {
            return next;
        }
    }
    path
}

/// What a take is called when nobody named it: the moment it was made.
pub fn default_name() -> String {
    format!("Take {}", crate::capture::stamp())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_take_lands_in_the_librarys_own_folder() {
        let dir = std::env::temp_dir().join(format!("audiolab-rec-{}", std::process::id()));
        let lib = dir.join("library");
        std::fs::create_dir_all(&lib).unwrap();
        let (path, outside) = target(Some(&lib), &dir, "Take 1");
        assert!(!outside);
        assert!(path.starts_with(lib.join(FOLDER)), "{path:?}");
        assert_eq!(path.extension().unwrap(), "wav");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn with_no_library_it_still_goes_somewhere_findable() {
        let dir = std::env::temp_dir().join(format!("audiolab-rec2-{}", std::process::id()));
        let (path, outside) = target(None, &dir, "Take 1");
        assert!(outside, "a take outside the library has to say so");
        assert!(path.starts_with(dir.join(FOLDER)), "{path:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_second_take_of_the_same_name_does_not_replace_the_first() {
        let dir = std::env::temp_dir().join(format!("audiolab-rec3-{}", std::process::id()));
        let lib = dir.join("library");
        std::fs::create_dir_all(lib.join(FOLDER)).unwrap();
        let (first, _) = target(Some(&lib), &dir, "Take");
        std::fs::write(&first, b"x").unwrap();
        let (second, _) = target(Some(&lib), &dir, "Take");
        assert_ne!(first, second);
        assert!(!second.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_name_with_a_slash_in_it_cannot_escape_the_folder() {
        let dir = std::env::temp_dir().join(format!("audiolab-rec4-{}", std::process::id()));
        let lib = dir.join("library");
        let (path, _) = target(Some(&lib), &dir, "../../etc/passwd");
        assert!(path.starts_with(lib.join(FOLDER)), "escaped to {path:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
