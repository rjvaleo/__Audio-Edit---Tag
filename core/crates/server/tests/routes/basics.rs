//! The basics, and the stretch clamps.

use super::*;

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

pub(super) fn apply(app: &Arc<App>, fields: &str) -> server::json::Value {
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
fn the_grain_feedback_controls_survive_the_round_trip() {
    let s = Scratch::new("feedback");
    s.sound("kit/tone.wav", 20_000);
    let app = s.app();

    let v = apply(&app, r#""grain":{"fbAmount":0.6,"fbTimeMs":420,"fbSmear":0.8,"fbDamp":0.2,"fbShift":-5,"fbHold":true}"#);
    assert_eq!(num(&v, &["stretch", "grain", "fbAmount"]), 0.6f32 as f64);
    assert_eq!(num(&v, &["stretch", "grain", "fbTimeMs"]), 420.0);
    assert_eq!(num(&v, &["stretch", "grain", "fbSmear"]), 0.8f32 as f64);
    assert_eq!(num(&v, &["stretch", "grain", "fbShift"]), -5.0);
    assert_eq!(v.get("stretch").and_then(|x| x.get("grain")).and_then(|x| x.get("fbHold")), Some(&server::json::Value::Bool(true)));

    // Absent means unchanged.
    let v = apply(&app, r#""ratio":1.5"#);
    assert_eq!(num(&v, &["stretch", "grain", "fbTimeMs"]), 420.0);

    // And bounded: the loop can never be asked to grow.
    let v = apply(&app, r#""grain":{"fbAmount":5,"fbTimeMs":1e9,"fbShift":99}"#);
    assert!(num(&v, &["stretch", "grain", "fbAmount"]) <= 0.95);
    assert!(num(&v, &["stretch", "grain", "fbTimeMs"]) <= 2000.0);
    assert!(num(&v, &["stretch", "grain", "fbShift"]) <= 12.0);
}

#[test]
fn feedback_shift_lands_on_a_degree_of_the_chosen_scale() {
    let s = Scratch::new("fbshift");
    s.sound("kit/tone.wav", 20_000);
    let app = s.app();
    // Ionian: 0, 2, 4, 5, 7, 9, 11. Three and a half semitones lands on four.
    let v = apply(&app, r#""scale":"Ionian (Major)","grain":{"fbShift":3.6}"#);
    assert_eq!(num(&v, &["stretch", "grain", "fbShift"]), 4.0);
    // Free, with no grid, it is taken as it is.
    let v = apply(&app, r#""scale":"","pitchStep":0,"grain":{"fbShift":3.6}"#);
    assert!((num(&v, &["stretch", "grain", "fbShift"]) - 3.6).abs() < 1e-4);
}

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
