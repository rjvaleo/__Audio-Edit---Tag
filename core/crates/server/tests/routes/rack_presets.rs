//! The rack and presets.

use super::*;

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

pub(super) fn presets(app: &Arc<App>) -> server::json::Value {
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
