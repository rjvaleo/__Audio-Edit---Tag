//! Joins the interface's parts into the files the binary serves.
//!
//! Each folder of `ui/` below is one served file: its parts in name order, end
//! to end and byte for byte — see `tools/app-source.mjs`. `ui/app/*.js` is the
//! one classic script `routes::UI_JS` includes: one script rather than many,
//! because the parts call functions declared further down, which only hoisting
//! within a single script allows. The others were too long to keep in one
//! piece; they are joined the same way, so the browser gets the same bytes.

use std::path::Path;

/// The folder under `ui/`, the parts' extension, and the file it becomes.
const JOINED: &[(&str, &str, &str)] = &[
    ("app", "js", "app.js"),
    ("app-css", "css", "app.css"),
    ("room-paint", "js", "room-paint.js"),
    ("vis-gl", "js", "vis-gl.js"),
    ("stage", "js", "stage.js"),
];

fn main() {
    for (folder, ext, out) in JOINED {
        join(folder, ext, out);
    }
}

fn join(folder: &str, ext: &str, out: &str) {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../ui").join(folder);
    println!("cargo:rerun-if-changed={}", dir.display());
    let mut names: Vec<_> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == ext))
        .collect();
    names.sort();
    assert!(!names.is_empty(), "no interface parts in {}", dir.display());
    let mut joined = String::new();
    for p in &names {
        println!("cargo:rerun-if-changed={}", p.display());
        joined.push_str(&std::fs::read_to_string(p).unwrap());
    }
    let out = Path::new(&std::env::var("OUT_DIR").unwrap()).join(out);
    std::fs::write(out, joined).unwrap();
}
