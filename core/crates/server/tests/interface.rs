//! The interface, checked by `cargo test` rather than by remembering.
//!
//! `tools/ui-check.mjs` looks for the one bug shape that keeps reaching the
//! screen: something referenced that is not there. A function deleted while a
//! call to it stayed. An element id renamed. A control handed a default that
//! does not exist. It found two dead functions on its first run, one of which
//! had quietly removed the maximiser from the product for three days.
//!
//! It lives here because a check nobody runs is not a check. The interface is
//! compiled into this binary with `include_str!`, so it is as much a part of
//! what `server` ships as any of its Rust.

use std::path::PathBuf;
use std::process::Command;

fn repo_root() -> PathBuf {
    // core/crates/server -> repo root
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("the repository root should be three levels up from this crate")
}

#[test]
fn the_interface_has_no_dangling_references() {
    let root = repo_root();
    let script = root.join("tools/ui-check.mjs");
    assert!(script.is_file(), "tools/ui-check.mjs has gone missing");

    let out = match Command::new("node").arg(&script).current_dir(&root).output() {
        Ok(o) => o,
        Err(e) => {
            // Not a failure. The checker is a development tool, and a machine
            // without node should still be able to build and test the program —
            // but it should say so rather than passing silently, or "the tests
            // are green" would come to mean something different on different
            // machines.
            eprintln!("SKIPPED: the interface checks need node, which is not on this machine ({e})");
            return;
        }
    };

    if !out.status.success() {
        panic!(
            "the interface checks failed:\n{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr),
        );
    }
}

/// The interface is embedded with `include_str!`, so a stale binary serves a
/// stale page — the trap that has cost more time in this project than anything
/// else, and one I fell into again today, telling someone a change was live
/// while the binary still held the previous file.
///
/// This cannot catch a stale *running* server, but it can catch the files
/// disappearing or being renamed out from under the include.
#[test]
fn every_embedded_interface_file_is_where_the_binary_expects_it() {
    let root = repo_root();
    for rel in [
        "ui/index.html",
        "ui/app.css",
        "ui/app.js",
        "visualiser/grain-views.html",
        "visualiser/p5.min.js",
        "visualiser/fonts.css",
    ] {
        let p = root.join(rel);
        assert!(p.is_file(), "{rel} is embedded in the binary but is not on disk");
        let len = std::fs::metadata(&p).unwrap().len();
        assert!(len > 0, "{rel} is empty");
    }
}
