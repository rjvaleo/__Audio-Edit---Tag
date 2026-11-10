//! The HTTP surface.
//!
//! `routes.rs` is the largest file in the project and everything the interface
//! can reach goes through it, but its only tests were about tag editing. What
//! follows is the layer itself: does an unknown path fail rather than serve
//! something, does a missing parameter come back as a client error rather than
//! a panic, does a path that tries to leave the library get refused, and do the
//! numbers the interface posts survive the round trip with their clamps
//! applied.
//!
//! The clamps are the part worth having. Every control in the stretch panel is
//! parsed and bounded here, that parsing has been rewritten repeatedly, and a
//! bound that silently stopped applying would not show up anywhere else.

use server::http::{Request, Response};
use server::state::App;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

// ------------------------------------------------------------------ harness

struct Scratch {
    data: PathBuf,
    library: PathBuf,
}

impl Scratch {
    fn new(name: &str) -> Self {
        // The Wave routes open MIDI on first use; a test must not listen to
        // whatever the person running it is playing (`midi.rs`).
        std::env::set_var("MGL_NO_MIDI", "1");
        let base = std::env::temp_dir()
            .join(format!("audiolab-routes-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let data = base.join("data");
        let library = base.join("library");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(library.join("kit")).unwrap();
        Scratch { data, library }
    }

    fn app(&self) -> Arc<App> {
        let app = Arc::new(App::new(self.data.clone()));
        app.set_library(self.library.clone()).unwrap();
        app
    }

    /// A real WAV in the library, so the routes that open files have one.
    fn sound(&self, rel: &str, frames: usize) {
        let path = self.library.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let data_len = (frames * 2) as u64;
        let mut out =
            audio_core::wav::header(data_len, 1, 44_100, audio_core::Codec::PcmI16).to_vec();
        for i in 0..frames {
            let v = ((i as f32 / 30.0).sin() * 9000.0) as i16;
            out.extend_from_slice(&v.to_le_bytes());
        }
        fs::write(path, out).unwrap();
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(self.data.parent().unwrap());
    }
}

fn get(path: &str, params: &[(&str, &str)]) -> Request {
    req("GET", path, params, Vec::new())
}

fn post(path: &str, body: &str) -> Request {
    req("POST", path, &[], body.as_bytes().to_vec())
}

fn req(method: &str, path: &str, params: &[(&str, &str)], body: Vec<u8>) -> Request {
    let mut query = HashMap::new();
    for (k, v) in params {
        query.insert(k.to_string(), v.to_string());
    }
    Request {
        method: method.to_string(),
        path: path.to_string(),
        query,
        headers: HashMap::new(),
        body,
    }
}

fn status(r: &Response) -> u16 {
    r.status
}

fn json(r: &Response) -> server::json::Value {
    let text = String::from_utf8_lossy(&r.body);
    server::json::parse(&text)
        .unwrap_or_else(|| panic!("the response was not JSON: {}", &text[..text.len().min(300)]))
}

/// Start an export and wait for it, then answer with the finished result.
///
/// Export used to block the request thread and answer with `path` and `frames`.
/// It runs on its own thread now so the browser can draw a progress bar, so the
/// outcome arrives through `GET /api/export` — these tests want the old shape
/// and this is where the waiting lives rather than in every one of them.
fn export_and_wait(app: &std::sync::Arc<server::state::App>, body: &str) -> server::json::Value {
    let started = server::routes::route(app, &post("/api/export", body));
    assert_eq!(
        status(&started),
        200,
        "the export did not start: {}",
        String::from_utf8_lossy(&started.body)
    );
    for _ in 0..600 {
        let s = json(&server::routes::route(app, &get("/api/export", &[])));
        if !matches!(s.get("running"), Some(server::json::Value::Bool(true))) {
            let err = s.get("error").and_then(|e| e.as_str()).unwrap_or("");
            assert!(err.is_empty(), "the export failed: {err}");
            return s;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    panic!("the export never finished");
}

fn num(v: &server::json::Value, path: &[&str]) -> f64 {
    let mut cur = v;
    for k in path {
        cur = cur
            .get(k)
            .unwrap_or_else(|| panic!("no {k} in {}", cur.to_string()));
    }
    match cur {
        server::json::Value::Num(n) => *n,
        other => panic!("{path:?} was not a number: {}", other.to_string()),
    }
}

fn flag(v: &server::json::Value, path: &[&str]) -> bool {
    let mut cur = v;
    for k in path {
        cur = cur.get(k).unwrap_or_else(|| panic!("no {k}"));
    }
    matches!(cur, server::json::Value::Bool(true))
}

fn text(v: &server::json::Value, path: &[&str]) -> String {
    let mut cur = v;
    for k in path {
        cur = cur.get(k).unwrap_or_else(|| panic!("no {k}"));
    }
    cur.as_str().unwrap_or_default().to_string()
}

mod basics;
use basics::*;
mod rack_presets;
use rack_presets::*;
mod edits_markers;
mod automation_recording;
mod live_prism;
mod invariants_export_map;
use invariants_export_map::*;
mod wave_keys;
use wave_keys::*;
