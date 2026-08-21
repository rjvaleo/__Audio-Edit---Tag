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

// ------------------------------------------------------------------- basics

#[test]
fn an_unknown_path_is_not_found_rather_than_something_else() {
    let s = Scratch::new("unknown");
    let app = s.app();
    let r = server::routes::route(&app, &get("/api/there-is-no-such-thing", &[]));
    assert_eq!(status(&r), 404, "an unknown route should not be served");
}

#[test]
fn the_state_route_answers_without_a_library_scan() {
    let s = Scratch::new("state");
    let app = s.app();
    let r = server::routes::route(&app, &get("/api/state", &[]));
    assert_eq!(status(&r), 200);
    let v = json(&r);
    assert!(v.get("files").is_some(), "state should report a file count");
    assert!(v.get("library").is_some(), "state should report the library path");
}

/// Every route that takes a path must say which one is missing rather than
/// falling over or quietly serving something else.
#[test]
fn a_missing_path_parameter_is_a_client_error() {
    let s = Scratch::new("missing-p");
    let app = s.app();
    for route in ["/api/peaks", "/api/spectrogram", "/api/edit", "/api/rack"] {
        let r = server::routes::route(&app, &get(route, &[]));
        assert_eq!(status(&r), 400, "{route} without a path should be a 400");
    }
}

/// The library boundary, exercised through the routes rather than only through
/// `resolve_within` — the check is only worth anything if the handlers use it.
#[test]
fn a_path_that_tries_to_leave_the_library_is_refused() {
    let s = Scratch::new("escape");
    s.sound("kit/inside.wav", 4000);
    let app = s.app();

    for attempt in [
        "../../../../etc/passwd",
        "..%2f..%2fetc%2fpasswd",
        "/etc/passwd",
        "kit/../../outside.wav",
        "..\\..\\windows\\system32\\config\\sam",
    ] {
        let r = server::routes::route(&app, &get("/api/peaks", &[("p", attempt)]));
        assert!(
            status(&r) >= 400,
            "{attempt} was not refused: status {}",
            status(&r)
        );
    }

    // And the control: a path that is genuinely inside works, so the test
    // above is measuring the boundary rather than everything failing.
    let ok = server::routes::route(&app, &get("/api/peaks", &[("p", "kit/inside.wav")]));
    assert_eq!(status(&ok), 200, "a file inside the library should be served");
}

#[test]
fn peaks_come_back_with_the_shape_the_interface_expects() {
    let s = Scratch::new("peaks");
    s.sound("kit/tone.wav", 44_100);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &get("/api/peaks", &[("p", "kit/tone.wav"), ("cols", "128")]),
    );
    assert_eq!(status(&r), 200);
    let v = json(&r);
    assert_eq!(num(&v, &["columns"]), 128.0);
    assert_eq!(num(&v, &["frames"]), 44_100.0);
    assert_eq!(num(&v, &["sampleRate"]), 44_100.0);
    assert_eq!(num(&v, &["from"]), 0.0);
    assert_eq!(num(&v, &["to"]), 44_100.0);
}

/// A window asked for beyond the end of the file must be brought back inside
/// it, not read off the end.
#[test]
fn a_peak_window_past_the_end_is_clamped_to_the_file() {
    let s = Scratch::new("peak-window");
    s.sound("kit/tone.wav", 10_000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &get(
            "/api/peaks",
            &[("p", "kit/tone.wav"), ("from", "5000"), ("to", "999999")],
        ),
    );
    assert_eq!(status(&r), 200);
    let v = json(&r);
    assert!(num(&v, &["to"]) <= 10_000.0, "the window ran past the end");
    assert!(num(&v, &["from"]) >= 0.0);
}

// ------------------------------------------------------- the stretch clamps
//
// Every one of these bounds exists because a value outside it either divides
// by zero, allocates something enormous, or silently produces silence. They
// are all applied in one place and that place has been rewritten repeatedly.

fn stretch_body(fields: &str) -> String {
    format!(r#"{{"p":"kit/tone.wav","op":"stretch",{fields}}}"#)
}

fn apply(app: &Arc<App>, fields: &str) -> server::json::Value {
    let r = server::routes::route(app, &post("/api/edit", &stretch_body(fields)));
    assert_eq!(status(&r), 200, "the edit was rejected: {}",
        String::from_utf8_lossy(&r.body));
    json(&r)
}

#[test]
fn absurd_stretch_values_are_brought_into_range() {
    let s = Scratch::new("clamp");
    s.sound("kit/tone.wav", 20_000);
    let app = s.app();

    let v = apply(&app, r#""ratio":1e9,"semitones":9999,"windowMs":1e9"#);
    let ratio = num(&v, &["stretch", "ratio"]);
    let semis = num(&v, &["stretch", "semitones"]);
    let window = num(&v, &["stretch", "windowMs"]);
    assert!(ratio.is_finite() && ratio > 0.0 && ratio <= 100.0, "ratio {ratio}");
    assert!(semis.abs() <= 48.0, "semitones {semis}");
    assert!(window <= 2000.0 && window >= 5.0, "windowMs {window}");

    let v = apply(&app, r#""ratio":-5,"semitones":-9999,"windowMs":0"#);
    assert!(num(&v, &["stretch", "ratio"]) > 0.0, "a negative ratio survived");
    assert!(num(&v, &["stretch", "semitones"]).abs() <= 48.0);
    assert!(num(&v, &["stretch", "windowMs"]) >= 5.0);
}

#[test]
fn every_grain_control_is_bounded() {
    let s = Scratch::new("grain-clamp");
    s.sound("kit/tone.wav", 20_000);
    let app = s.app();

    let v = apply(
        &app,
        r#""grain":{"densityHz":1e9,"overlap":1e9,"sizeJitter":50,
                   "positionJitterMs":1e9,"pitchJitterSemis":900,
                   "pitchDriftSemis":900,"driftRateHz":1e9,"layers":9999,
                   "scan":900,"envelope":50,"sizeRange":900,
                   "layerSpread":900,"panSpread":50}"#,
    );
    let g = |k: &str| num(&v, &["stretch", "grain", k]);
    assert!(g("densityHz") <= 2000.0, "density {}", g("densityHz"));
    assert!(g("overlap") <= 8.0 && g("overlap") >= 1.0, "overlap {}", g("overlap"));
    assert!(g("sizeJitter") <= 1.0, "size jitter {}", g("sizeJitter"));
    assert!(g("positionJitterMs") <= 2000.0);
    assert!(g("pitchJitterSemis") <= 24.0);
    assert!(g("pitchDriftSemis") <= 24.0);
    assert!(g("driftRateHz") <= 20.0);
    assert!(
        g("layers") <= fx::grain::MAX_LAYERS as f64 && g("layers") >= 1.0,
        "layers {}",
        g("layers")
    );
    assert!(g("scan").abs() <= 4.0, "scan {}", g("scan"));
    assert!(g("envelope") <= 1.0);
    assert!(g("sizeRange") <= 8.0);
    assert!(g("layerSpread") <= 4.0);
    assert!(g("panSpread") <= 1.0);

    // And the other end.
    let v = apply(
        &app,
        r#""grain":{"densityHz":-9,"overlap":-9,"sizeJitter":-9,"layers":-9,
                   "scan":-900,"envelope":-9,"sizeRange":-9,"panSpread":-9}"#,
    );
    let g = |k: &str| num(&v, &["stretch", "grain", k]);
    assert!(g("densityHz") >= 0.0);
    assert!(g("overlap") >= 1.0);
    assert!(g("sizeJitter") >= 0.0);
    assert!(g("layers") >= 1.0);
    assert!(g("scan") >= -4.0);
    assert!(g("envelope") >= 0.0);
    assert!(g("sizeRange") >= 1.0);
    assert!(g("panSpread") >= 0.0);
}

/// The two layer-scatter controls, over the wire. They are what turns layers
/// from a delay line into a cloud, so a document that loses them sounds
/// hollower rather than merely different.
#[test]
fn the_layer_scatter_controls_survive_the_round_trip() {
    let s = Scratch::new("scatter");
    s.sound("kit/tone.wav", 20_000);
    let app = s.app();

    let v = apply(&app, r#""grain":{"layers":8,"layerScatter":0.75,"layerScatterMs":340}"#);
    assert_eq!(num(&v, &["stretch", "grain", "layers"]), 8.0);
    assert_eq!(num(&v, &["stretch", "grain", "layerScatter"]), 0.75);
    assert_eq!(num(&v, &["stretch", "grain", "layerScatterMs"]), 340.0);

    // Absent means unchanged, like everything else here.
    let v = apply(&app, r#""ratio":1.5"#);
    assert_eq!(num(&v, &["stretch", "grain", "layerScatter"]), 0.75);
    assert_eq!(num(&v, &["stretch", "grain", "layerScatterMs"]), 340.0);

    // And bounded.
    let v = apply(&app, r#""grain":{"layerScatter":9,"layerScatterMs":1e9}"#);
    assert!(num(&v, &["stretch", "grain", "layerScatter"]) <= 1.0);
    assert!(num(&v, &["stretch", "grain", "layerScatterMs"]) <= 5000.0);
}

#[test]
fn the_engine_controls_are_bounded_too() {
    let s = Scratch::new("engine-clamp");
    s.sound("kit/tone.wav", 20_000);
    let app = s.app();

    let v = apply(
        &app,
        r#""wsola":{"searchMs":1e9,"stride":1e9,"guardHops":1e9,"floor":1e9,"sensitivity":9},
           "vocoder":{"windowMs":1e9,"freqTrust":9,"phaseSpread":9,"peakWidth":1e9,
                      "lockWidth":9,"magFreeze":9,"magBlur":9,"magGate":9}"#,
    );
    let w = |k: &str| num(&v, &["stretch", "wsola", k]);
    let c = |k: &str| num(&v, &["stretch", "vocoder", k]);
    assert!(w("searchMs") <= 200.0, "search {}", w("searchMs"));
    assert!(w("stride") <= 256.0 && w("stride") >= 1.0);
    assert!(w("guardHops") <= 16.0 && w("guardHops") >= 1.0);
    assert!(w("floor") <= 2.0);
    assert!(w("sensitivity") <= 1.0);
    assert!(c("windowMs") <= 500.0 && c("windowMs") >= 5.0, "window {}", c("windowMs"));
    assert!(c("freqTrust") <= 4.0);
    assert!(c("phaseSpread") <= 4.0);
    assert!(c("peakWidth") <= 32.0 && c("peakWidth") >= 1.0);
    assert!(c("lockWidth") <= 4.0);
    assert!(c("magFreeze") <= 1.0);
    assert!(c("magBlur") <= 1.0);
    assert!(c("magGate") <= 1.0);
}

/// A field the interface does not mention must keep the value it had. This is
/// what lets one slider post without resetting the other twenty.
#[test]
fn a_control_that_says_nothing_changes_nothing() {
    let s = Scratch::new("partial");
    s.sound("kit/tone.wav", 20_000);
    let app = s.app();

    apply(&app, r#""ratio":2.5,"semitones":7,"grain":{"densityHz":120,"layers":5}"#);
    // A second post that mentions only the ratio.
    let v = apply(&app, r#""ratio":1.5"#);

    assert_eq!(num(&v, &["stretch", "ratio"]), 1.5);
    assert_eq!(num(&v, &["stretch", "semitones"]), 7.0);
    assert_eq!(num(&v, &["stretch", "grain", "densityHz"]), 120.0);
    assert_eq!(num(&v, &["stretch", "grain", "layers"]), 5.0);
}

#[test]
fn an_unknown_engine_name_leaves_the_engine_alone() {
    let s = Scratch::new("engine-name");
    s.sound("kit/tone.wav", 20_000);
    let app = s.app();

    let v = apply(&app, r#""algorithm":"vocoder""#);
    assert_eq!(text(&v, &["stretch", "algorithm"]), "vocoder");
    let v = apply(&app, r#""algorithm":"telepathy""#);
    assert_eq!(
        text(&v, &["stretch", "algorithm"]),
        "vocoder",
        "an engine that does not exist should not reset the one that does"
    );
}

#[test]
fn an_unknown_edit_operation_is_refused() {
    let s = Scratch::new("unknown-op");
    s.sound("kit/tone.wav", 20_000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/tone.wav","op":"transmogrify"}"#),
    );
    assert_eq!(status(&r), 400);
}

#[test]
fn a_body_that_is_not_json_is_refused_rather_than_panicking() {
    let s = Scratch::new("bad-json");
    let app = s.app();
    for body in ["", "{", "not json at all", r#"{"p":}"#] {
        let r = server::routes::route(&app, &post("/api/edit", body));
        assert_eq!(status(&r), 400, "body {body:?} should be a 400");
    }
}

// ------------------------------------------------------------------ the rack

#[test]
fn the_channel_compressor_survives_the_round_trip_and_is_bounded() {
    let s = Scratch::new("rack");
    s.sound("kit/tone.wav", 20_000);
    let app = s.app();

    let r = server::routes::route(
        &app,
        &post(
            "/api/rack",
            r#"{"p":"kit/tone.wav","slots":[],
                "master":{"on":true,"amount":9,"autoLevel":false,"autoComp":true,"ceilingDb":-99}}"#,
        ),
    );
    assert_eq!(status(&r), 200);
    let v = json(&r);
    assert_eq!(num(&v, &["master", "amount"]), 1.0, "amount was not clamped");
    assert!(num(&v, &["master", "ceilingDb"]) >= -24.0, "ceiling was not clamped");
    assert!(
        matches!(v.get("master").and_then(|m| m.get("on")), Some(server::json::Value::Bool(true))),
        "the switch did not survive"
    );
    assert!(
        matches!(
            v.get("master").and_then(|m| m.get("autoLevel")),
            Some(server::json::Value::Bool(false))
        ),
        "auto level was not carried through as given"
    );

    // Switched on, the rack is active, which is what puts it in the render path.
    assert!(
        matches!(v.get("active"), Some(server::json::Value::Bool(true))),
        "a channel compressor that is on should make the rack active"
    );
}

#[test]
fn a_rack_with_nothing_in_it_is_not_active() {
    let s = Scratch::new("rack-idle");
    s.sound("kit/tone.wav", 20_000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post("/api/rack", r#"{"p":"kit/tone.wav","slots":[],"master":{"on":false}}"#),
    );
    assert_eq!(status(&r), 200);
    assert!(
        matches!(json(&r).get("active"), Some(server::json::Value::Bool(false))),
        "an idle rack should not put the renderer in the effect path"
    );
}

/// The two new engines' parameters, over the wire. Both panels post nested
/// objects like the others do, so they inherit the same two rules — absent
/// means unchanged, and nothing arrives unclamped — and both rules have to be
/// checked rather than assumed from the code next door.
#[test]
fn the_new_engine_controls_survive_the_round_trip() {
    let s = Scratch::new("new-engines");
    s.sound("kit/tone.wav", 20_000);
    let app = s.app();

    let v = apply(
        &app,
        r#""algorithm":"pvsola",
           "pvsola":{"anchorFrames":12,"searchMs":25,"blend":0.25},
           "hybrid":{"fftSize":1024,"timeSpan":31,"freqSpan":9,"margin":3.5,
                     "morphNoise":false,"harmonicLevel":0.5,
                     "percussiveLevel":1.5,"residualLevel":0}"#,
    );
    assert_eq!(text(&v, &["stretch", "algorithm"]), "pvsola");
    let p = |k: &str| num(&v, &["stretch", "pvsola", k]);
    assert_eq!(p("anchorFrames"), 12.0);
    assert_eq!(p("searchMs"), 25.0);
    assert_eq!(p("blend"), 0.25);
    let h = |k: &str| num(&v, &["stretch", "hybrid", k]);
    assert_eq!(h("fftSize"), 1024.0);
    assert_eq!(h("timeSpan"), 31.0);
    assert_eq!(h("freqSpan"), 9.0);
    assert_eq!(h("margin"), 3.5);
    assert_eq!(h("harmonicLevel"), 0.5);
    assert_eq!(h("percussiveLevel"), 1.5);
    assert_eq!(h("residualLevel"), 0.0);
    assert!(!flag(&v, &["stretch", "hybrid", "morphNoise"]), "the noise switch did not survive the round trip");

    // And a post that mentions neither leaves both exactly as they were.
    let v = apply(&app, r#""ratio":1.5"#);
    assert_eq!(num(&v, &["stretch", "pvsola", "anchorFrames"]), 12.0);
    assert_eq!(num(&v, &["stretch", "hybrid", "margin"]), 3.5);
    assert!(!flag(&v, &["stretch", "hybrid", "morphNoise"]), "a post about the ratio switched the noise morpher back on");
}

#[test]
fn the_new_engine_controls_are_bounded_too() {
    let s = Scratch::new("new-engine-clamp");
    s.sound("kit/tone.wav", 20_000);
    let app = s.app();

    let v = apply(
        &app,
        r#""pvsola":{"anchorFrames":1e9,"searchMs":1e9,"blend":9},
           "hybrid":{"fftSize":1e9,"timeSpan":1e9,"freqSpan":1e9,"margin":1e9,
                     "harmonicLevel":9,"percussiveLevel":9,"residualLevel":9}"#,
    );
    let p = |k: &str| num(&v, &["stretch", "pvsola", k]);
    assert!(p("anchorFrames") <= 64.0 && p("anchorFrames") >= 1.0);
    assert!(p("searchMs") <= 200.0);
    assert!(p("blend") <= 1.0);
    let h = |k: &str| num(&v, &["stretch", "hybrid", k]);
    assert!(h("fftSize") <= 8192.0 && h("fftSize") >= 256.0);
    assert!(h("timeSpan") <= 101.0 && h("timeSpan") >= 3.0);
    assert!(h("freqSpan") <= 101.0 && h("freqSpan") >= 3.0);
    assert!(h("margin") <= 8.0 && h("margin") >= 1.0);
    assert!(h("harmonicLevel") <= 4.0);
    assert!(h("percussiveLevel") <= 4.0);
    assert!(h("residualLevel") <= 4.0);
}

// ------------------------------------------------------------------ presets
//
// A preset is the whole stretch spec plus the whole rack, detached from any
// file. Every engine's settings ride along in one struct, so the thing worth
// testing is not each field again but that nothing is dropped between saving,
// listing and applying — three separate conversions, any of which can quietly
// lose a value that the interface will then show as a default.

fn presets(app: &Arc<App>) -> server::json::Value {
    json(&server::routes::route(app, &get("/api/presets", &[])))
}

fn preset_named<'a>(v: &'a server::json::Value, name: &str) -> &'a server::json::Value {
    let Some(server::json::Value::Arr(items)) = v.get("presets") else {
        panic!("the list had no presets array: {}", v.to_string());
    };
    items
        .iter()
        .find(|p| p.get("name").and_then(|n| n.as_str()) == Some(name))
        .unwrap_or_else(|| panic!("no preset called {name}"))
}

#[test]
fn a_preset_carries_every_engines_settings_there_and_back() {
    let s = Scratch::new("preset-round-trip");
    s.sound("kit/tone.wav", 20_000);
    s.sound("kit/other.wav", 20_000);
    let app = s.app();

    // Put something distinctive on every engine at once, not just the one
    // selected — a preset stores all of them, and the interface lets you
    // switch engines after recalling it.
    apply(
        &app,
        r#""ratio":3.25,"semitones":-5,"algorithm":"hybrid",
           "vocoder":{"magBlur":0.7,"freqTrust":0.3,"stereoLink":true},
           "wsola":{"searchMs":55,"splice":"different","stride":9},
           "pvsola":{"anchorFrames":21,"searchMs":31,"blend":0.125},
           "hybrid":{"margin":3.5,"morphNoise":false,"residualLevel":0.25,"timeSpan":31},
           "grain":{"densityHz":77,"layers":5,"panSpread":0.9}"#,
    );

    let r = server::routes::route(
        &app,
        &post("/api/presets", r#"{"name":"Everything","p":"kit/tone.wav","note":"all engines"}"#),
    );
    assert_eq!(status(&r), 200, "saving was refused: {}", String::from_utf8_lossy(&r.body));

    // Listed — this is what the manager reads, so it has to be complete.
    let listed = presets(&app);
    let p = preset_named(&listed, "Everything");
    assert_eq!(num(p, &["stretch", "ratio"]), 3.25);
    assert_eq!(num(p, &["stretch", "semitones"]), -5.0);
    assert_eq!(text(p, &["stretch", "algorithm"]), "hybrid");
    assert_eq!(num(p, &["stretch", "vocoder", "magBlur"]), 0.699999988079071);
    assert_eq!(num(p, &["stretch", "wsola", "searchMs"]), 55.0);
    assert_eq!(text(p, &["stretch", "wsola", "splice"]), "different");
    assert_eq!(num(p, &["stretch", "pvsola", "anchorFrames"]), 21.0);
    assert_eq!(num(p, &["stretch", "hybrid", "margin"]), 3.5);
    assert_eq!(num(p, &["stretch", "hybrid", "residualLevel"]), 0.25);
    assert_eq!(num(p, &["stretch", "grain", "densityHz"]), 77.0);
    assert!(!flag(p, &["stretch", "hybrid", "morphNoise"]));

    // Applied to a different file, which starts from nothing.
    let r = server::routes::route(
        &app,
        &post("/api/presets/apply", r#"{"name":"Everything","p":"kit/other.wav"}"#),
    );
    assert_eq!(status(&r), 200, "applying was refused: {}", String::from_utf8_lossy(&r.body));
    let v = json(&r);
    assert_eq!(num(&v, &["stretch", "ratio"]), 3.25);
    assert_eq!(text(&v, &["stretch", "algorithm"]), "hybrid");
    assert_eq!(num(&v, &["stretch", "vocoder", "magBlur"]), 0.699999988079071);
    assert_eq!(num(&v, &["stretch", "wsola", "stride"]), 9.0);
    assert_eq!(num(&v, &["stretch", "pvsola", "blend"]), 0.125);
    assert_eq!(num(&v, &["stretch", "hybrid", "timeSpan"]), 31.0);
    assert_eq!(num(&v, &["stretch", "grain", "layers"]), 5.0);
    assert!(!flag(&v, &["stretch", "hybrid", "morphNoise"]));
}

/// A preset that holds nothing but a maximiser setting still has to carry it.
///
/// The maximiser lives in the rack beside the effect slots rather than in a
/// place of its own, so "the rack is empty" and "the slots are empty" are not
/// the same question — and applying a preset used to ask the second one.
#[test]
fn a_preset_with_no_effects_still_carries_the_maximiser() {
    let s = Scratch::new("preset-master");
    s.sound("kit/tone.wav", 20_000);
    s.sound("kit/other.wav", 20_000);
    let app = s.app();

    let r = server::routes::route(
        &app,
        &post(
            "/api/rack",
            r#"{"p":"kit/tone.wav","slots":[],"master":{"on":true,"amount":0.8,"autoLevel":true}}"#,
        ),
    );
    assert_eq!(status(&r), 200, "the rack was refused: {}", String::from_utf8_lossy(&r.body));

    // Saving must work from a file whose only settings are in the rack — it
    // has no edit document, and requiring one is what hid this.
    let r = server::routes::route(
        &app,
        &post("/api/presets", r#"{"name":"Loud","p":"kit/tone.wav"}"#),
    );
    assert_eq!(status(&r), 200, "saving was refused: {}", String::from_utf8_lossy(&r.body));
    server::routes::route(
        &app,
        &post("/api/presets/apply", r#"{"name":"Loud","p":"kit/other.wav"}"#),
    );

    let v = json(&server::routes::route(&app, &get("/api/rack", &[("p", "kit/other.wav")])));
    assert!(
        flag(&v, &["master", "on"]),
        "the maximiser did not survive a preset with no effect slots: {}",
        v.to_string()
    );
    assert_eq!(num(&v, &["master", "amount"]), 0.800000011920929);
}

/// The manager edits the preset, not a sound — so it has to work with nothing
/// open, and every value it writes has to go through the same clamps the
/// document uses rather than a second set of bounds in the interface.
#[test]
fn the_manager_can_edit_a_stored_preset_without_a_file_open() {
    let s = Scratch::new("preset-update");
    s.sound("kit/tone.wav", 20_000);
    let app = s.app();

    apply(&app, r#""ratio":2.0,"algorithm":"wsola""#);
    server::routes::route(&app, &post("/api/presets", r#"{"name":"One","p":"kit/tone.wav"}"#));

    // Rename, re-note, and rewrite values — including ones for engines the
    // preset was never saved "on", which is most of what a preset holds.
    let r = server::routes::route(
        &app,
        &post(
            "/api/presets/update",
            r#"{"name":"One","to":"Two","note":"edited by hand",
                "stretch":{"ratio":7.5,"algorithm":"pvsola",
                           "pvsola":{"anchorFrames":30,"blend":0.2},
                           "hybrid":{"residualLevel":0.1},
                           "grain":{"layers":9}},
                "rack":{"slots":[],"master":{"on":true,"amount":0.9}}}"#,
        ),
    );
    assert_eq!(status(&r), 200, "the update was refused: {}", String::from_utf8_lossy(&r.body));

    let listed = presets(&app);
    let p = preset_named(&listed, "Two");
    assert_eq!(text(p, &["note"]), "edited by hand");
    assert_eq!(num(p, &["stretch", "ratio"]), 7.5);
    assert_eq!(text(p, &["stretch", "algorithm"]), "pvsola");
    assert_eq!(num(p, &["stretch", "pvsola", "anchorFrames"]), 30.0);
    assert_eq!(num(p, &["stretch", "hybrid", "residualLevel"]), 0.10000000149011612);
    assert_eq!(num(p, &["stretch", "grain", "layers"]), 9.0);
    assert!(flag(p, &["rack", "master", "on"]));

    // The old name is gone, not left behind as a second copy.
    let Some(server::json::Value::Arr(items)) = listed.get("presets") else { panic!() };
    assert!(
        !items.iter().any(|x| x.get("name").and_then(|n| n.as_str()) == Some("One")),
        "renaming left the original behind"
    );
}

#[test]
fn the_manager_cannot_store_a_value_the_engines_would_refuse() {
    let s = Scratch::new("preset-clamp");
    s.sound("kit/tone.wav", 20_000);
    let app = s.app();
    apply(&app, r#""ratio":2.0"#);
    server::routes::route(&app, &post("/api/presets", r#"{"name":"P","p":"kit/tone.wav"}"#));

    server::routes::route(
        &app,
        &post(
            "/api/presets/update",
            r#"{"name":"P","stretch":{"ratio":1e9,"semitones":900,
                 "pvsola":{"anchorFrames":1e9},"hybrid":{"margin":1e9},
                 "grain":{"layers":1e9}}}"#,
        ),
    );
    let listed = presets(&app);
    let p = preset_named(&listed, "P");
    assert!(num(p, &["stretch", "ratio"]) <= 100.0);
    assert!(num(p, &["stretch", "semitones"]).abs() <= 48.0);
    assert!(num(p, &["stretch", "pvsola", "anchorFrames"]) <= 64.0);
    assert!(num(p, &["stretch", "hybrid", "margin"]) <= 8.0);
    assert!(num(p, &["stretch", "grain", "layers"]) <= fx::grain::MAX_LAYERS as f64);
}

#[test]
fn renaming_a_preset_onto_another_is_refused_rather_than_swallowing_it() {
    let s = Scratch::new("preset-collide");
    s.sound("kit/tone.wav", 20_000);
    let app = s.app();
    apply(&app, r#""ratio":2.0"#);
    server::routes::route(&app, &post("/api/presets", r#"{"name":"A","p":"kit/tone.wav"}"#));
    server::routes::route(&app, &post("/api/presets", r#"{"name":"B","p":"kit/tone.wav"}"#));

    let r = server::routes::route(&app, &post("/api/presets/update", r#"{"name":"A","to":"B"}"#));
    assert_eq!(status(&r), 409, "renaming onto an existing preset should be refused");
    let listed = presets(&app);
    preset_named(&listed, "A");
    preset_named(&listed, "B");
}

#[test]
fn duplicating_makes_a_second_preset_and_leaves_the_first_alone() {
    let s = Scratch::new("preset-dup");
    s.sound("kit/tone.wav", 20_000);
    let app = s.app();
    apply(&app, r#""ratio":2.0,"algorithm":"hybrid""#);
    server::routes::route(&app, &post("/api/presets", r#"{"name":"Orig","p":"kit/tone.wav"}"#));

    let r = server::routes::route(
        &app,
        &post(
            "/api/presets/duplicate",
            r#"{"name":"Copy","stretch":{"ratio":9.0,"algorithm":"granular"}}"#,
        ),
    );
    assert_eq!(status(&r), 200, "duplicating was refused: {}", String::from_utf8_lossy(&r.body));

    let listed = presets(&app);
    assert_eq!(num(preset_named(&listed, "Orig"), &["stretch", "ratio"]), 2.0);
    assert_eq!(text(preset_named(&listed, "Orig"), &["stretch", "algorithm"]), "hybrid");
    assert_eq!(num(preset_named(&listed, "Copy"), &["stretch", "ratio"]), 9.0);

    let r = server::routes::route(
        &app,
        &post("/api/presets/duplicate", r#"{"name":"Copy","stretch":{"ratio":1.0}}"#),
    );
    assert_eq!(status(&r), 409, "duplicating onto an existing name should be refused");
}

// ------------------------------------------------------ the Peak edit commands

#[test]
fn cropping_keeps_only_the_selection() {
    let s = Scratch::new("crop");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"crop","start":1000,"end":1500}"#),
    );
    assert_eq!(status(&r), 200);
    assert_eq!(num(&json(&r), &["frames"]), 500.0);
}

#[test]
fn duplicating_lengthens_the_document_by_the_copies_asked_for() {
    let s = Scratch::new("dup");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post(
            "/api/edit",
            r#"{"p":"kit/a.wav","op":"duplicate","start":0,"end":1000,"count":3}"#,
        ),
    );
    assert_eq!(num(&json(&r), &["frames"]), 7000.0);
}

#[test]
fn a_runaway_duplicate_count_is_bounded_rather_than_believed() {
    let s = Scratch::new("dupbig");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post(
            "/api/edit",
            r#"{"p":"kit/a.wav","op":"duplicate","start":0,"end":4000,"count":999999}"#,
        ),
    );
    // 128 copies plus the original, and no more.
    assert_eq!(num(&json(&r), &["frames"]), 4000.0 * 129.0);
}

#[test]
fn silence_can_be_inserted_in_milliseconds() {
    let s = Scratch::new("ins");
    s.sound("kit/a.wav", 44_100);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post(
            "/api/edit",
            r#"{"p":"kit/a.wav","op":"insertSilence","start":1000,"ms":500}"#,
        ),
    );
    // Half a second at 44.1 kHz.
    assert_eq!(num(&json(&r), &["frames"]), 44_100.0 + 22_050.0);
}

#[test]
fn inserted_silence_survives_being_written_out_and_read_back() {
    // The reader used to refuse any clip reaching past the end of the source,
    // which is every silent clip, so a saved pause came back missing.
    let s = Scratch::new("inspersist");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"insertSilence","start":100,"frames":9000}"#),
    );
    let list = app.edits.snapshot("kit/a.wav").unwrap();
    assert_eq!(list.frames(), 13_000);

    let back = server::persist::edit_from_json(
        &server::persist::edit_to_json(&list),
        &edit::EditList::identity(4000, 1, 44_100),
    )
    .expect("should read back");
    assert_eq!(back.frames(), 13_000, "the pause was dropped on reload");
}

#[test]
fn snapping_moves_the_edit_and_says_where_it_went() {
    let s = Scratch::new("snap");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post(
            "/api/edit",
            r#"{"p":"kit/a.wav","op":"cut","start":1007,"end":2007,"snap":"zero"}"#,
        ),
    );
    let v = json(&r);
    let (a, b) = (num(&v, &["snapped", "start"]), num(&v, &["snapped", "end"]));
    // The fixture is sin(i/30), whose period is 30·2π ≈ 188 frames, so a
    // crossing is never more than about 95 frames away — and the ten
    // millisecond radius at 44.1 kHz is 441, which comfortably reaches one.
    assert!((a - 1007.0).abs() <= 95.0 && a != 1007.0, "start went to {a}");
    assert!((b - 2007.0).abs() <= 95.0 && b != 2007.0, "end went to {b}");
    assert_eq!(num(&v, &["frames"]), 4000.0 - (b - a));
}

#[test]
fn without_a_snap_the_edit_lands_exactly_where_it_was_asked() {
    // Every caller written before snap existed must be unaffected, and the
    // response must not grow a field that says otherwise.
    let s = Scratch::new("nosnap");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"cut","start":1007,"end":2007}"#),
    );
    let v = json(&r);
    assert_eq!(num(&v, &["frames"]), 3000.0);
    assert!(v.get("snapped").is_none(), "an unsnapped edit reported a snap");
}

#[test]
fn a_grid_snap_lands_on_a_multiple_of_the_grid() {
    let s = Scratch::new("snapcd");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post(
            "/api/edit",
            r#"{"p":"kit/a.wav","op":"cut","start":1000,"end":2000,"snap":"cd"}"#,
        ),
    );
    let v = json(&r);
    assert_eq!(num(&v, &["snapped", "start"]), 1176.0); // 2 × 588, nearest to 1000
    assert_eq!(num(&v, &["snapped", "end"]), 1764.0); // 3 × 588, nearest to 2000
}

#[test]
fn an_unknown_snap_unit_leaves_the_edit_where_it_was_rather_than_guessing() {
    let s = Scratch::new("snapbad");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post(
            "/api/edit",
            r#"{"p":"kit/a.wav","op":"cut","start":1000,"end":2000,"snap":"bars"}"#,
        ),
    );
    assert_eq!(num(&json(&r), &["frames"]), 3000.0);
}

#[test]
fn measuring_reports_the_peak_and_where_it_is() {
    let s = Scratch::new("measure");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    let r = server::routes::route(&app, &post("/api/measure", r#"{"p":"kit/a.wav"}"#));
    assert_eq!(status(&r), 200);
    let v = json(&r);
    let peak = num(&v, &["peak"]);
    assert!(peak > 0.2 && peak <= 1.0, "peak {peak}");
    assert!(num(&v, &["rms"]) > 0.0);
    assert!(num(&v, &["peakFrame"]) < 4000.0);
    // A measurement must not become an edit.
    assert!(!app.edits.has_edits("kit/a.wav"));
}

#[test]
fn rms_normalising_changes_the_level_without_passing_the_ceiling() {
    let s = Scratch::new("rms");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    let before = json(&server::routes::route(
        &app,
        &post("/api/measure", r#"{"p":"kit/a.wav"}"#),
    ));
    server::routes::route(
        &app,
        &post(
            "/api/edit",
            r#"{"p":"kit/a.wav","op":"normalizeRms","db":-6,"ceilingDb":-0.3}"#,
        ),
    );
    let after = json(&server::routes::route(
        &app,
        &post("/api/measure", r#"{"p":"kit/a.wav"}"#),
    ));

    assert!(
        num(&after, &["rms"]) > num(&before, &["rms"]),
        "it should have got louder"
    );
    let ceiling = 10f64.powf(-0.3 / 20.0);
    assert!(
        num(&after, &["peak"]) <= ceiling + 1e-3,
        "the ceiling was breached: {}",
        num(&after, &["peak"])
    );
}

#[test]
fn stripping_silence_removes_the_quiet_and_shortens_the_file() {
    let s = Scratch::new("strip");
    // Loud, silent, loud.
    let path = s.library.join("kit/b.wav");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let frames = 44_100usize;
    let mut out =
        audio_core::wav::header((frames * 2) as u64, 1, 44_100, audio_core::Codec::PcmI16).to_vec();
    for i in 0..frames {
        let quiet = i >= 15_000 && i < 30_000;
        let v = if quiet { 0 } else { ((i as f32 / 30.0).sin() * 9000.0) as i16 };
        out.extend_from_slice(&v.to_le_bytes());
    }
    fs::write(&path, out).unwrap();

    let app = s.app();
    let r = server::routes::route(
        &app,
        &post(
            "/api/edit",
            r#"{"p":"kit/b.wav","op":"stripSilence","thresholdDb":-40,"minMs":100,"padMs":0,"mode":"remove"}"#,
        ),
    );
    let got = num(&json(&r), &["frames"]);
    assert!(
        (got - 29_100.0).abs() < 1000.0,
        "expected about 29100 frames left, got {got}"
    );
}

#[test]
fn repairing_a_click_takes_out_a_sliver_and_no_more() {
    let s = Scratch::new("click");
    let path = s.library.join("kit/c.wav");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let frames = 8000usize;
    let mut out =
        audio_core::wav::header((frames * 2) as u64, 1, 44_100, audio_core::Codec::PcmI16).to_vec();
    for i in 0..frames {
        let v = if i == 4000 { 32_000 } else { ((i as f32 / 60.0).sin() * 3000.0) as i16 };
        out.extend_from_slice(&v.to_le_bytes());
    }
    fs::write(&path, out).unwrap();

    let app = s.app();
    let before = json(&server::routes::route(
        &app,
        &post("/api/measure", r#"{"p":"kit/c.wav","start":3900,"end":4100}"#),
    ));
    assert!((num(&before, &["clickFrame"]) - 4000.0).abs() < 3.0);

    let r = server::routes::route(
        &app,
        &post(
            "/api/edit",
            r#"{"p":"kit/c.wav","op":"repairClick","start":3900,"end":4100,"widthMs":1}"#,
        ),
    );
    let left = num(&json(&r), &["frames"]);
    assert!(left < 8000.0, "nothing was removed");
    assert!(left > 7900.0, "far too much was removed: {left} of 8000");

    let after = json(&server::routes::route(
        &app,
        &post("/api/measure", r#"{"p":"kit/c.wav","start":3800,"end":4200}"#),
    ));
    assert!(
        num(&after, &["clickDeviation"]) < num(&before, &["clickDeviation"]) / 10.0,
        "the click survived: {} then {}",
        num(&before, &["clickDeviation"]),
        num(&after, &["clickDeviation"])
    );
}

#[test]
fn an_unknown_edit_operation_is_refused_rather_than_ignored() {
    let s = Scratch::new("badop");
    s.sound("kit/a.wav", 1000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"obliterate"}"#),
    );
    assert_eq!(status(&r), 400);
}

// -------------------------------------------------- markers and regions, live

#[test]
fn markers_become_regions_over_the_wire() {
    let s = Scratch::new("m2r");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    server::routes::route(
        &app,
        &post(
            "/api/markers",
            r#"{"p":"kit/a.wav","markers":[{"frame":100,"label":"Foo 1"},{"frame":200,"label":"Foo 2"},{"frame":300,"label":"Foo 3"}]}"#,
        ),
    );
    let r = server::routes::route(
        &app,
        &post("/api/annot", r#"{"p":"kit/a.wav","op":"markersToRegions"}"#),
    );
    let v = json(&r);
    let regions = match v.get("regions") {
        Some(server::json::Value::Arr(a)) => a.clone(),
        _ => panic!("no regions"),
    };
    assert_eq!(regions.len(), 2);
    assert_eq!(regions[0].get("label").unwrap().as_str().unwrap(), "Foo 1");
}

#[test]
fn renaming_over_the_wire_numbers_them_in_order() {
    let s = Scratch::new("ren");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    server::routes::route(
        &app,
        &post(
            "/api/markers",
            r#"{"p":"kit/a.wav","markers":[{"frame":900,"label":"b"},{"frame":100,"label":"a"}]}"#,
        ),
    );
    let r = server::routes::route(
        &app,
        &post(
            "/api/annot",
            r#"{"p":"kit/a.wav","op":"rename","to":"Hit #00","startAt":"1","markers":true}"#,
        ),
    );
    let v = json(&r);
    let ms = match v.get("markers") {
        Some(server::json::Value::Arr(a)) => a.clone(),
        _ => panic!("no markers"),
    };
    assert_eq!(ms[0].get("label").unwrap().as_str().unwrap(), "Hit 01");
    assert_eq!(ms[1].get("label").unwrap().as_str().unwrap(), "Hit 02");
}

#[test]
fn an_annotation_change_is_written_to_disk_not_just_held() {
    let s = Scratch::new("annotsave");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    server::routes::route(
        &app,
        &post("/api/markers", r#"{"p":"kit/a.wav","markers":[{"frame":100,"label":"x"}]}"#),
    );
    server::routes::route(
        &app,
        &post("/api/annot", r#"{"p":"kit/a.wav","op":"nudge","frames":250}"#),
    );
    let raw = fs::read_to_string(app.markers_path()).unwrap();
    assert!(raw.contains("350"), "the nudge was not persisted: {raw}");
}

#[test]
fn an_unknown_annotation_operation_is_refused() {
    let s = Scratch::new("annotbad");
    s.sound("kit/a.wav", 1000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post("/api/annot", r#"{"p":"kit/a.wav","op":"explode"}"#),
    );
    assert_eq!(status(&r), 400);
}

// ------------------------------------------- a sound opens as itself

#[test]
fn a_sound_opens_at_its_defaults_however_it_was_left() {
    // Settings that arrive without being asked for are indistinguishable from
    // a bug. A file could come up at thirty-six times its length because of
    // something done to it in a previous run of the program.
    let s = Scratch::new("defaults");
    s.sound("kit/a.wav", 4000);
    let app = s.app();

    // Leave a heavy stretch on it and let it reach disk.
    server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"stretch","ratio":36.6,"semitones":-11,"algorithm":"granular"}"#),
    );
    app.save_sessions();
    let raw = fs::read_to_string(app.sessions_path()).unwrap();
    // Written as an f32, so it lands a little under the number that was asked
    // for. What matters is that the heavy stretch reached the file at all.
    assert!(raw.contains("\"ratio\":36.59"), "the session should have been written: {raw}");

    // A fresh process, same data directory.
    let app2 = s.app();
    let v = json(&server::routes::route(&app2, &get("/api/edit", &[("p", "kit/a.wav")])));
    assert_eq!(num(&v, &["stretch", "ratio"]), 1.0, "it came up stretched");
    assert_eq!(num(&v, &["stretch", "semitones"]), 0.0, "it came up pitched");
    assert!(!flag(&v, &["edited"]), "it came up already edited");
    assert_eq!(text(&v, &["stretch", "algorithm"]), "wsola");
}

#[test]
fn work_done_in_this_run_survives_switching_away_and_back() {
    // The other half of the rule: only *restoring from disk* stopped. A
    // document being worked on keeps everything until the program closes.
    let s = Scratch::new("keepwork");
    s.sound("kit/a.wav", 4000);
    s.sound("kit/b.wav", 4000);
    let app = s.app();

    server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"cut","start":0,"end":1000}"#),
    );
    // Go and look at something else, then come back.
    server::routes::route(&app, &get("/api/edit", &[("p", "kit/b.wav")]));
    let v = json(&server::routes::route(&app, &get("/api/edit", &[("p", "kit/a.wav")])));
    assert_eq!(num(&v, &["frames"]), 3000.0, "the cut was lost");
    assert!(flag(&v, &["canUndo"]), "the history was lost");
}

#[test]
fn an_audition_is_the_sound_and_a_document_is_the_document() {
    // The rule the library depends on, as a function of its arguments — the
    // rest of `live::load` is a device and cannot be reached from a test.
    use server::live::{playback_list, Playing};
    let plain = edit::EditList::identity(4000, 1, 44_100);
    let mut worked = plain.clone();
    worked.cut(edit::Range::new(0, 1000));
    worked.stretch = fx::Stretch { ratio: 36.6, semitones: -11.0, ..fx::Stretch::default() };

    let audition = playback_list(Playing::Raw, Some(worked.clone()), plain.clone());
    assert!(audition.is_identity(), "an audition carried the document's work");
    assert_eq!(audition.frames(), 4000);

    let document = playback_list(Playing::Document, Some(worked.clone()), plain.clone());
    assert_eq!(document, worked, "the editor lost the document");

    // Nothing open yet: both fall back to the file itself.
    assert!(playback_list(Playing::Document, None, plain.clone()).is_identity());
}

#[test]
fn settings_for_a_sound_the_engine_is_not_holding_go_nowhere() {
    // What comes out of the speakers has to be what is on the screen. With no
    // engine running at all, `holding` is false for every path, and a stretch
    // change must still land on the *document* — it simply is not pushed at
    // the audio thread, which is holding something else or nothing.
    let s = Scratch::new("holding");
    s.sound("kit/a.wav", 4000);
    let app = s.app();

    assert!(!server::live::holding(&app, "kit/a.wav"), "nothing is loaded");

    let r = server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"stretch","ratio":4}"#),
    );
    assert_eq!(status(&r), 200);
    // The document took it, which is what export and the next load will read.
    assert_eq!(num(&json(&r), &["stretch", "ratio"]), 4.0);
}

// ------------------------------------------------------------- automation
//
// The interface has no automated tests of its own, and that is where the two
// worst automation bugs lived. What can be pinned from here is the contract the
// interface depends on: what a lane looks like after a round trip, what the
// menu offers, and what happens to a lane whose file has changed underneath it.

fn lane_body(p: &str, target: &str, points: &str) -> String {
    format!(
        r#"{{"p":"{p}","bypassed":false,"lanes":[{{"id":"a","target":"{target}",
           "label":"L","enabled":true,"trim":0,"loop":null,"modulators":[],
           "points":{points}}}]}}"#
    )
}

#[test]
fn a_lane_survives_the_round_trip_and_is_stamped_with_the_file_it_was_drawn_against() {
    let s = Scratch::new("automation-round-trip");
    s.sound("kit/tone.wav", 4000);
    let app = s.app();

    let body = lane_body(
        "kit/tone.wav",
        "stretch.semitones",
        r#"[{"frame":0,"value":0.25,"curve":"smooth","tension":0.5},
            {"frame":3000,"value":0.75,"curve":"linear","tension":0}]"#,
    );
    assert_eq!(status(&server::routes::route(&app, &post("/api/automation", &body))), 200);

    let back = json(&server::routes::route(
        &app,
        &get("/api/automation", &[("p", "kit/tone.wav")]),
    ));
    let lane = &back.get("lanes").unwrap().arr().unwrap()[0];
    assert_eq!(lane.get("target").and_then(|t| t.as_str()), Some("stretch.semitones"));
    assert_eq!(lane.get("points").unwrap().arr().unwrap().len(), 2);
    // Stamped by the server from the file on disk, not taken from the browser.
    assert_eq!(num(&back, &["frames"]), 4000.0);
    assert_eq!(num(&back, &["sampleRate"]), 44_100.0);
    assert_eq!(num(&back, &["channels"]), 1.0);

    // And it is still there after a restart, which is the whole point of a lane
    // being work rather than a slider position.
    let app2 = s.app();
    let again = json(&server::routes::route(
        &app2,
        &get("/api/automation", &[("p", "kit/tone.wav")]),
    ));
    assert_eq!(again.get("lanes").unwrap().arr().unwrap().len(), 1);
}

#[test]
fn lanes_are_dropped_when_the_file_underneath_them_changes_length() {
    let s = Scratch::new("automation-stale");
    s.sound("kit/tone.wav", 4000);
    let app = s.app();
    let body = lane_body("kit/tone.wav", "stretch.ratio", r#"[{"frame":3900,"value":0.9,"curve":"linear","tension":0}]"#);
    server::routes::route(&app, &post("/api/automation", &body));

    // The same name, half the audio. Frame 3900 now points past the end of it.
    s.sound("kit/tone.wav", 2000);
    let back = json(&server::routes::route(
        &app,
        &get("/api/automation", &[("p", "kit/tone.wav")]),
    ));
    assert!(back.get("lanes").unwrap().arr().unwrap().is_empty(), "stale lanes must not be served");
    assert!(matches!(back.get("stale"), Some(server::json::Value::Bool(true))));
}

#[test]
fn the_menu_offers_the_document_and_every_slot_in_the_rack() {
    let s = Scratch::new("automation-targets");
    s.sound("kit/tone.wav", 2000);
    let app = s.app();

    let targets_now = |app: &Arc<App>| -> Vec<String> {
        json(&server::routes::route(app, &get("/api/automation", &[("p", "kit/tone.wav")])))
            .get("targets").unwrap().arr().unwrap().iter()
            .map(|t| t.arr().unwrap()[0].as_str().unwrap_or_default().to_string())
            .collect()
    };

    // A file nobody has touched still has the starting chain — an EQ and a
    // compressor, both switched on and both inert. No gain stage.
    let before = targets_now(&app);
    assert!(before.iter().any(|t| t == "stretch.semitones"), "the document: {before:?}");
    assert!(before.iter().any(|t| t == "fx.factory-eq.band.2.freq"), "the EQ: {before:?}");
    assert!(before.iter().any(|t| t == "fx.factory-comp.ratio"), "the compressor: {before:?}");
    assert!(!before.iter().any(|t| t.contains("gain.db")), "no gain stage: {before:?}");

    let r = server::routes::route(
        &app,
        &post("/api/rack", r#"{"p":"kit/tone.wav","slots":[{"kind":"gain","id":"my-gain","db":0}],"master":{"on":true,"amount":0.5}}"#),
    );
    assert_eq!(status(&r), 200, "{}", String::from_utf8_lossy(&r.body));

    let after = targets_now(&app);
    assert!(after.iter().any(|t| t == "fx.my-gain.db"), "the gain slot: {after:?}");
    assert!(after.iter().any(|t| t == "rack.master.amount"), "the maximiser: {after:?}");
    // And the bands of the EQ that is no longer there are gone with it, so a
    // menu never offers something playback would ignore.
    assert!(!after.iter().any(|t| t.contains("band.2.freq")), "stale EQ targets: {after:?}");

    // Switching the maximiser off takes its target away too.
    server::routes::route(
        &app,
        &post("/api/rack", r#"{"p":"kit/tone.wav","slots":[{"kind":"gain","id":"my-gain","db":0}],"master":{"on":false}}"#),
    );
    assert!(!targets_now(&app).iter().any(|t| t == "rack.master.amount"));
}

/// A lane on the stretch used to be refused, because the one-pass renderer
/// applies the stretch whole. It now goes through the streaming engine.
#[test]
fn a_stretch_lane_reaches_the_exported_file() {
    let s = Scratch::new("automation-export-stretch");
    s.sound("kit/tone.wav", 8000);
    let app = s.app();

    let plain = export_and_wait(&app, r#"{"p":"kit/tone.wav","bits":24}"#);
    let plain_frames = num(&plain, &["frames"]);

    // A ratio lane pinned well above unity: the file has to come out longer.
    server::routes::route(
        &app,
        &post("/api/automation", &lane_body("kit/tone.wav", "stretch.ratio",
              r#"[{"frame":0,"value":0.7,"curve":"linear","tension":0},{"frame":8000,"value":0.7,"curve":"linear","tension":0}]"#)),
    );
    let stretched = export_and_wait(&app, r#"{"p":"kit/tone.wav","bits":24}"#);

    let stretched_frames = num(&stretched, &["frames"]);

    assert!(
        stretched_frames > plain_frames * 3.0,
        "the lane did not reach the file: {plain_frames} frames became {stretched_frames}"
    );

    // And the file on disk really is that long, not just the number reported.
    let path = stretched.get("path").and_then(|p| p.as_str()).unwrap().to_string();
    let reader = audio_core::open(std::path::Path::new(&path)).unwrap();
    assert_eq!(reader.info().frames(), stretched_frames as u64);
}

#[test]
fn a_rack_lane_reaches_the_exported_file() {
    let s = Scratch::new("automation-export-rack");
    s.sound("kit/tone.wav", 8000);
    let app = s.app();
    server::routes::route(
        &app,
        &post("/api/rack", r#"{"p":"kit/tone.wav","slots":[{"kind":"gain","id":"my-gain","db":0}],"master":{"on":false}}"#),
    );
    // Silence at the start of the lane, full level at the end. Unit 0 is the
    // gain's own minimum, which is well below audibility over a sine.
    server::routes::route(
        &app,
        &post("/api/automation", &lane_body("kit/tone.wav", "fx.my-gain.db",
              r#"[{"frame":0,"value":0.0,"curve":"linear","tension":0},{"frame":8000,"value":1.0,"curve":"linear","tension":0}]"#)),
    );

    let r = export_and_wait(&app, r#"{"p":"kit/tone.wav","bits":24}"#);
    let path = r.get("path").and_then(|p| p.as_str()).unwrap().to_string();

    let mut reader = audio_core::open(std::path::Path::new(&path)).unwrap();
    let frames = reader.info().frames();
    let head = reader.read_frames(0, 500).unwrap();
    let tail = reader.read_frames(frames - 500, 500).unwrap();
    let peak = |b: &[f32]| b.iter().fold(0f32, |m, v| m.max(v.abs()));
    assert!(
        peak(&tail) > peak(&head) * 8.0,
        "the lane should ramp the export up: head {} tail {}",
        peak(&head), peak(&tail)
    );
}

// ---------------------------------------------------------------- recording
//
// Opening a device needs a machine with one and, on macOS, permission — so
// what can be pinned from here is the surface around it: what the routes say
// when nothing is armed, and that a take cannot be written by accident.

#[test]
fn the_record_route_says_what_it_is_doing_before_anything_is_armed() {
    let s = Scratch::new("record-idle");
    let app = s.app();
    let r = server::routes::route(&app, &get("/api/record", &[]));
    assert_eq!(status(&r), 200);
    let v = json(&r);
    assert!(
        matches!(v.get("armed"), Some(server::json::Value::Bool(false))),
        "nothing should be armed on a fresh app"
    );
    // The device list is only offered while nothing is open, which is the only
    // time it can change without the stream noticing.
    assert!(v.get("devices").and_then(|d| d.arr()).is_some(), "no device list offered");
}

#[test]
fn starting_or_stopping_with_nothing_armed_is_refused_rather_than_ignored() {
    let s = Scratch::new("record-unarmed");
    let app = s.app();
    for action in ["start", "stop"] {
        let body = format!(r#"{{"action":"{action}"}}"#);
        let r = server::routes::route(&app, &post("/api/record", &body));
        assert_eq!(status(&r), 409, "{action} with nothing armed should be a conflict");
    }
}

#[test]
fn an_unknown_record_action_is_a_client_error() {
    let s = Scratch::new("record-nonsense");
    let app = s.app();
    let r = server::routes::route(&app, &post("/api/record", r#"{"action":"levitate"}"#));
    assert_eq!(status(&r), 400);
}

#[test]
fn disarming_when_nothing_is_armed_is_harmless() {
    let s = Scratch::new("record-disarm");
    let app = s.app();
    let r = server::routes::route(&app, &post("/api/record", r#"{"action":"disarm"}"#));
    assert_eq!(status(&r), 200);
}

/// Arming the recorder, and refusing a mode that is not one.
///
/// The mode is deliberately not persisted, so this only checks the surface:
/// it takes the three it knows, refuses anything else with a client error
/// rather than defaulting to something, and reports back what it is set to.
#[test]
fn the_recorder_arms_and_refuses_a_mode_it_does_not_have() {
    let s = Scratch::new("record");
    let app = s.app();

    let r = server::routes::route(&app, &get("/api/automation/record", &[]));
    assert_eq!(status(&r), 200);
    assert_eq!(json(&r).get("mode").and_then(|v| v.as_str()), Some("off"));

    for mode in ["touch", "latch", "off"] {
        let r = server::routes::route(&app, &post("/api/automation/record", &format!("{{\"mode\":\"{mode}\"}}")));
        assert_eq!(status(&r), 200, "{mode} was refused");
        assert_eq!(json(&r).get("mode").and_then(|v| v.as_str()), Some(mode));
    }

    // "write" is the one every DAW has and this does not. It must fail loudly
    // rather than quietly arm something else.
    let r = server::routes::route(&app, &post("/api/automation/record", "{\"mode\":\"write\"}"));
    assert_eq!(status(&r), 400);

    let r = server::routes::route(&app, &post("/api/automation/record", "{}"));
    assert_eq!(status(&r), 400);
}

/// Armed but stopped must not stamp a point.
///
/// Nothing is playing in this test, which is the case that matters: a slider
/// moved with the transport parked would otherwise write wherever the playhead
/// happened to be left, and the first thing anyone does after arming is reach
/// for a control to see if it works.
#[test]
fn a_control_moved_while_stopped_records_nothing() {
    let s = Scratch::new("record-stopped");
    s.sound("kit/a.wav", 4096);
    let app = s.app();

    server::routes::route(&app, &post("/api/automation/record", "{\"mode\":\"latch\"}"));
    let r = server::routes::route(
        &app,
        &post("/api/edit", "{\"p\":\"kit/a.wav\",\"op\":\"stretch\",\"ratio\":3.0}"),
    );
    assert_eq!(status(&r), 200);

    let r = server::routes::route(&app, &get("/api/automation", &[("p", "kit/a.wav")]));
    let lanes = match json(&r).get("lanes") {
        Some(server::json::Value::Arr(a)) => a.len(),
        _ => 0,
    };
    assert_eq!(lanes, 0, "a stopped transport recorded {lanes} lanes");
}

// ======================================================== the live path
//
// The part of the program with state that outlives a request, and the part
// where three of one day's bugs lived: the rack rebuilt on every slider, the
// transient map rebuilt on every step of a drag, the compressor's panel writing
// to a copy nothing else could see. None of it had a test.
//
// **Nothing here opens the audio device.** A test that made sound would fight
// whatever the machine is already playing, and would fail on any box without an
// output. So these cover the routes that answer without one: what the engine
// reports when it is holding nothing, what a live parameter does to the stored
// spec, and how each refuses a request it cannot serve. What happens *inside*
// the callback is covered frame by frame in `engine::transport`, which was
// built to run without a sound card for exactly this reason.

#[test]
fn the_engine_reports_holding_nothing_rather_than_failing() {
    let s = Scratch::new("engine-idle");
    let app = s.app();
    let r = server::routes::route(&app, &get("/api/engine/state", &[]));
    assert_eq!(status(&r), 200, "state should answer with no engine running");
    let v = json(&r);
    // Whatever it says, the interface polls this constantly and it must be JSON
    // with a playing flag rather than an error it has to special-case.
    assert!(matches!(v.get("playing"), Some(server::json::Value::Bool(_))));
    // And it says whether there is a device at all, so the interface can tell
    // "nothing is playing" from "nothing can play".
    //
    // This assertion holds on both kinds of machine, which is the point: the
    // developer's has a sound card and takes the success path, CI's has none
    // and takes the other. Before this, the route was a 503 on CI and the test
    // above could not fail anywhere it was ever run.
    assert!(
        matches!(v.get("device"), Some(server::json::Value::Bool(_))),
        "no `device` flag in {}",
        v.to_string()
    );
    // With no device it must still be the idle shape rather than half an object.
    if matches!(v.get("device"), Some(server::json::Value::Bool(false))) {
        assert!(matches!(v.get("playing"), Some(server::json::Value::Bool(false))),
            "no device, but it claims to be playing");
        for k in ["position", "sampleRate", "channels", "inFrames"] {
            assert!(v.get(k).is_some(), "no `{k}` in the device-less state");
        }
    }
}

#[test]
fn a_live_parameter_reaches_the_stored_rack() {
    let s = Scratch::new("live-param");
    s.sound("kit/tone.wav", 4_410);
    let app = s.app();

    // A compressor in the rack, by the same route the interface uses.
    let r = server::routes::route(
        &app,
        &post(
            "/api/rack",
            r#"{"p":"kit/tone.wav","sr":44100,"slots":[{"id":"c1","kind":"comp","bypassed":false,
                "thresholdDb":-18,"ratio":4,"attackMs":10,"releaseMs":100,"kneeDb":6,"makeupDb":0}]}"#,
        ),
    );
    assert_eq!(status(&r), 200, "the rack was refused: {}", String::from_utf8_lossy(&r.body));

    let r = server::routes::route(
        &app,
        &post(
            "/api/rack/param",
            r#"{"p":"kit/tone.wav","id":"c1","key":"thresholdDb","value":-30}"#,
        ),
    );
    assert_eq!(status(&r), 200);
    assert_eq!(num(&json(&r), &["value"]), -30.0);

    // And it is in the document, not only in the reply — which is what makes it
    // survive a reload.
    let back = server::routes::route(&app, &get("/api/rack", &[("p", "kit/tone.wav")]));
    let v = json(&back);
    let slots = match v.get("slots") {
        Some(server::json::Value::Arr(a)) => a.clone(),
        _ => panic!("no slots came back"),
    };
    assert_eq!(num(&slots[0], &["thresholdDb"]), -30.0);
}

#[test]
fn a_live_parameter_is_clamped_by_the_same_bounds_as_the_document() {
    let s = Scratch::new("live-clamp");
    s.sound("kit/tone.wav", 4_410);
    let app = s.app();
    server::routes::route(
        &app,
        &post(
            "/api/rack",
            r#"{"p":"kit/tone.wav","sr":44100,"slots":[{"id":"g1","kind":"gain","bypassed":false,"db":0}]}"#,
        ),
    );
    let r = server::routes::route(
        &app,
        &post("/api/rack/param", r#"{"p":"kit/tone.wav","id":"g1","key":"db","value":9999}"#),
    );
    assert_eq!(status(&r), 200);
    let applied = num(&json(&r), &["value"]);
    assert!(applied < 9999.0, "a live write went through unclamped: {applied}");
}

#[test]
fn a_live_parameter_for_a_module_that_is_not_there_is_refused() {
    let s = Scratch::new("live-missing");
    s.sound("kit/tone.wav", 4_410);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post("/api/rack/param", r#"{"p":"kit/tone.wav","id":"nope","key":"db","value":1}"#),
    );
    assert_eq!(status(&r), 404, "an unknown module should not be silently accepted");
}

#[test]
fn a_live_parameter_for_a_control_that_does_not_exist_is_refused() {
    let s = Scratch::new("live-badkey");
    s.sound("kit/tone.wav", 4_410);
    let app = s.app();
    server::routes::route(
        &app,
        &post(
            "/api/rack",
            r#"{"p":"kit/tone.wav","sr":44100,"slots":[{"id":"g1","kind":"gain","bypassed":false,"db":0}]}"#,
        ),
    );
    let r = server::routes::route(
        &app,
        &post("/api/rack/param", r#"{"p":"kit/tone.wav","id":"g1","key":"nonsense","value":1}"#),
    );
    assert_eq!(status(&r), 400);
}

/// The master is not in `slot_ids` — it has no id of its own — so it needed its
/// own branch, and a branch with no test is a branch that stops working.
#[test]
fn the_masters_amount_is_live_and_its_ceiling_is_not() {
    let s = Scratch::new("live-master");
    s.sound("kit/tone.wav", 4_410);
    let app = s.app();
    server::routes::route(
        &app,
        &post("/api/rack", r#"{"p":"kit/tone.wav","sr":44100,"slots":[],
              "master":{"on":true,"amount":0.5,"autoLevel":true,"autoComp":true,"ceilingDb":-0.3}}"#),
    );

    let r = server::routes::route(
        &app,
        &post("/api/rack/param", r#"{"p":"kit/tone.wav","id":"master","key":"amount","value":0.8}"#),
    );
    assert_eq!(status(&r), 200);
    assert!((num(&json(&r), &["value"]) - 0.8).abs() < 1e-6);

    // Deliberately refused: putting the one guarantee the maximiser makes on a
    // curve would defeat it. See `Maximizer::set_param`.
    let r = server::routes::route(
        &app,
        &post("/api/rack/param", r#"{"p":"kit/tone.wav","id":"master","key":"ceilingDb","value":-6}"#),
    );
    assert_eq!(status(&r), 400, "the ceiling should not be a live control");
}

/// The picker is built entirely from this, and the maximiser was added to it
/// without a test saying the list was right.
#[test]
fn every_module_the_picker_offers_declares_itself_fully() {
    let s = Scratch::new("fx-list");
    let app = s.app();
    let r = server::routes::route(&app, &get("/api/fx", &[]));
    assert_eq!(status(&r), 200);
    let v = json(&r);
    let kinds = match v.get("shapers") {
        Some(server::json::Value::Arr(a)) => a.clone(),
        _ => panic!("no shapers came back"),
    };
    assert_eq!(kinds.len(), fx::shape::ShapeKind::ALL.len(), "the list and the enum disagree");

    for k in &kinds {
        let kind = match k.get("kind") {
            Some(server::json::Value::Str(s)) => s.clone(),
            _ => panic!("a module with no kind"),
        };
        assert!(
            fx::shape::ShapeKind::from_str(&kind).is_some(),
            "{kind} is offered but cannot be built"
        );
        assert!(
            matches!(k.get("label"), Some(server::json::Value::Str(l)) if !l.is_empty()),
            "{kind} has no label"
        );
    }
    assert!(
        kinds.iter().any(|k| matches!(k.get("kind"), Some(server::json::Value::Str(s)) if s == "maximizer")),
        "the maximiser is not offered"
    );
}

// ==================================================== the invariants, named
//
// Seven of the eleven had no test that named them. Several are no doubt covered
// incidentally somewhere, and that is the problem: a test that does not say
// which promise it is keeping is one nobody recognises when they go to change
// the code underneath it.

/// **Invariant 1: the source file is never written.**
///
/// The promise the whole program rests on. Edits, effects and stretch are all
/// sidecar; audio reaches disk only through an explicit export to a new file.
///
/// Asserted on the bytes, not on the modified time — a rewrite that happened to
/// produce identical content would still be a rewrite, but a changed byte is
/// the thing that actually loses someone's recording.
#[test]
fn invariant_1_an_export_does_not_touch_the_source() {
    let s = Scratch::new("inv1-export");
    s.sound("kit/tone.wav", 8000);
    let source = s.library.join("kit/tone.wav");
    let before = fs::read(&source).unwrap();
    let before_len = before.len();

    let app = s.app();

    // Something on every layer: an edit, a rack, a stretch — so the export has
    // real work to do rather than copying the file.
    server::routes::route(
        &app,
        &post("/api/rack", r#"{"p":"kit/tone.wav","sr":44100,"slots":[{"id":"g1","kind":"gain","bypassed":false,"db":-6}]}"#),
    );
    server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/tone.wav","op":"stretch","ratio":2.0,"semitones":3,"windowMs":40}"#),
    );
    let r = export_and_wait(&app, r#"{"p":"kit/tone.wav","bits":24}"#);

    let after = fs::read(&source).unwrap();
    assert_eq!(after.len(), before_len, "the source changed length");
    assert!(after == before, "the source file's bytes changed during an export");

    // And the export really did go somewhere else.
    let path = r.get("path").and_then(|p| p.as_str()).unwrap().to_string();
    assert_ne!(
        std::path::Path::new(&path).canonicalize().unwrap(),
        source.canonicalize().unwrap(),
        "the export wrote over the source"
    );
}

/// **Invariant 1, again: an export never overwrites an existing file.**
///
/// Exporting twice in a minute is ordinary. Silently replacing the first one is
/// the same class of loss as writing the source.
#[test]
fn invariant_1_a_second_export_writes_a_second_file() {
    let s = Scratch::new("inv1-twice");
    s.sound("kit/tone.wav", 4000);
    let app = s.app();

    let a = export_and_wait(&app, r#"{"p":"kit/tone.wav","bits":24}"#);
    let b = export_and_wait(&app, r#"{"p":"kit/tone.wav","bits":24}"#);
    let pa = a.get("path").and_then(|p| p.as_str()).unwrap().to_string();
    let pb = b.get("path").and_then(|p| p.as_str()).unwrap().to_string();
    assert_ne!(pa, pb, "the second export replaced the first");
    assert!(std::path::Path::new(&pa).exists(), "the first export is gone");
    assert!(std::path::Path::new(&pb).exists());
}

/// **Invariant 8: a saved session is refused if the file changed.**
///
/// Stale offsets pointing at the wrong audio is worse than losing the edit.
#[test]
fn invariant_8_a_session_is_refused_when_the_file_underneath_it_changed() {
    let s = Scratch::new("inv8");
    s.sound("kit/tone.wav", 8000);
    let app = s.app();

    // An edit, so there is a session to be stale.
    server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/tone.wav","op":"stretch","ratio":2.0,"semitones":0,"windowMs":40}"#),
    );
    let before = server::routes::route(&app, &get("/api/edit", &[("p", "kit/tone.wav")]));
    assert_eq!(status(&before), 200);

    // The file is replaced with one of a different length, behind the app's back.
    s.sound("kit/tone.wav", 3000);

    // A fresh App, so nothing is remembered in memory — this is the reload case
    // the invariant is about.
    let app2 = s.app();
    let after = server::routes::route(&app2, &get("/api/edit", &[("p", "kit/tone.wav")]));
    assert_eq!(status(&after), 200, "it should answer, not fail");
    let v = json(&after);
    // Whatever it returns, it must not be the old edit list laid over new audio.
    let frames = num(&v, &["frames"]);
    assert!(
        frames <= 3000.0 * 2.0 + 1.0,
        "an edit list built for 8000 frames was applied to a 3000-frame file: {frames}"
    );
}

// ------------------------------------------------------- export progress

/// The export answers at once and finishes later.
///
/// This is the contract the progress bar rests on: if the POST still blocked
/// until the file existed, there would be nothing to poll and no bar to draw.
#[test]
fn an_export_starts_immediately_and_reports_while_it_runs() {
    let s = Scratch::new("export-progress-start");
    s.sound("kit/tone.wav", 8000);
    let app = s.app();

    let started = json(&server::routes::route(
        &app,
        &post("/api/export", r#"{"p":"kit/tone.wav","bits":24}"#),
    ));
    assert!(
        matches!(started.get("started"), Some(server::json::Value::Bool(true))),
        "the export did not report starting: {}",
        started.to_string()
    );
    // And it said how much work it is, which is what the bar is measured against.
    assert!(num(&started, &["total"]) > 0.0, "no work total was reported");

    // The status route is answerable straight away — the render is on another
    // thread and holds no lock across it.
    let st = json(&server::routes::route(&app, &get("/api/export", &[])));
    assert!(st.get("phase").is_some(), "no phase in {}", st.to_string());
}

/// It finishes, and the outcome is on the status route rather than the POST.
#[test]
fn the_finished_export_is_reported_through_the_status_route() {
    let s = Scratch::new("export-progress-finish");
    s.sound("kit/tone.wav", 8000);
    let app = s.app();

    let done = export_and_wait(&app, r#"{"p":"kit/tone.wav","bits":24}"#);
    let path = done.get("path").and_then(|p| p.as_str()).unwrap_or("");
    assert!(!path.is_empty(), "no path on the finished export");
    assert!(std::path::Path::new(path).exists(), "the file is not there");
    assert!(num(&done, &["frames"]) > 0.0, "no frame count");
    // Full, so the bar lands on 100 rather than stopping short.
    assert!(
        (num(&done, &["fraction"]) - 1.0).abs() < 1e-9,
        "the bar finished at {}, not 1.0 — the work total does not match what \
         the renderer steps",
        num(&done, &["fraction"])
    );
}

/// Two at once is refused rather than interleaved.
#[test]
fn only_one_export_runs_at_a_time() {
    let s = Scratch::new("export-progress-one");
    s.sound("kit/tone.wav", 400_000);
    let app = s.app();

    let first = server::routes::route(&app, &post("/api/export", r#"{"p":"kit/tone.wav","bits":24}"#));
    assert_eq!(status(&first), 200);
    // Immediately, while the first is still going.
    let second = server::routes::route(&app, &post("/api/export", r#"{"p":"kit/tone.wav","bits":24}"#));
    if status(&second) == 200 {
        // The first finished before the second arrived, which is legal for a
        // small file — but then the second must have started cleanly.
        return;
    }
    assert_eq!(status(&second), 400, "a second export was neither refused nor started");
}

// ── the measuring passes ──────────────────────────────────────────────────────
//
// A library of six hundred sounds added at once turned the first request that
// touched the classifier into a walk of the whole library, and the server is a
// thread per connection, so every request that arrived while it worked started
// its own walk. Thirteen threads were measured decoding the same files from the
// beginning at once, none of them able to see the others' work because nothing
// reached disk until a pass finished.
//
// The property is that a second caller does not start a second pass.

#[test]
fn only_one_thread_can_be_inside_a_pass() {
    use server::state::Pass;
    use std::sync::atomic::{AtomicUsize, Ordering};

    let pass = Arc::new(Pass::default());
    // How many got in at all, and how many were inside together. The second is
    // the number that was wrong: it used to be all of them.
    let entered = Arc::new(AtomicUsize::new(0));
    let inside = Arc::new(AtomicUsize::new(0));
    let most = Arc::new(AtomicUsize::new(0));

    let mut hands = Vec::new();
    for _ in 0..13 {
        let (pass, entered, inside, most) =
            (pass.clone(), entered.clone(), inside.clone(), most.clone());
        hands.push(std::thread::spawn(move || {
            let Some(_guard) = pass.enter() else { return };
            entered.fetch_add(1, Ordering::SeqCst);
            let n = inside.fetch_add(1, Ordering::SeqCst) + 1;
            most.fetch_max(n, Ordering::SeqCst);
            // Long enough that the others are certainly trying.
            std::thread::sleep(std::time::Duration::from_millis(40));
            inside.fetch_sub(1, Ordering::SeqCst);
        }));
    }
    for h in hands {
        h.join().unwrap();
    }

    assert_eq!(most.load(Ordering::SeqCst), 1, "two passes ran at once");
    assert!(entered.load(Ordering::SeqCst) >= 1, "nobody ran the pass at all");
    assert_eq!(inside.load(Ordering::SeqCst), 0, "a pass never finished");
}

#[test]
fn a_pass_can_be_run_again_once_the_last_one_has_finished() {
    use server::state::Pass;

    let pass = Pass::default();
    {
        let first = pass.enter();
        assert!(first.is_some(), "the first caller should get in");
        assert!(pass.enter().is_none(), "the second should be turned away");
    }
    // The flag is cleared by the guard going out of scope, not by the pass
    // remembering to clear it, so an early return or a panic cannot wedge it
    // shut. A wedged flag would mean the library never got measured again.
    assert!(pass.enter().is_some(), "the flag was not released");
}
