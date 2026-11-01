//! Joins the interface script's parts into the one script the binary serves.
//!
//! `ui/app/*.js`, in name order, end to end and byte for byte — see
//! `tools/app-source.mjs`. One classic script rather than many, because the
//! parts call functions declared further down, which only hoisting within a
//! single script allows. `routes::UI_JS` includes the result.

use std::path::Path;

fn main() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../ui/app");
    println!("cargo:rerun-if-changed={}", dir.display());
    let mut names: Vec<_> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "js"))
        .collect();
    names.sort();
    assert!(!names.is_empty(), "no interface parts in {}", dir.display());
    let mut joined = String::new();
    for p in &names {
        println!("cargo:rerun-if-changed={}", p.display());
        joined.push_str(&std::fs::read_to_string(p).unwrap());
    }
    let out = Path::new(&std::env::var("OUT_DIR").unwrap()).join("app.js");
    std::fs::write(out, joined).unwrap();
}
