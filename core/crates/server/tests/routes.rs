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
    assert!(g("layers") <= 16.0 && g("layers") >= 1.0, "layers {}", g("layers"));
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
