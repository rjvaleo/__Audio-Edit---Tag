//! Automation and recording.

use super::*;

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

/// Hyperprism's Pitch Time Changer reaches the export: at 200 % speed the file
/// is read twice as fast, so it comes out half as long.
#[test]
fn the_pitch_time_changer_reaches_the_exported_file() {
    let s = Scratch::new("export-pitch-time");
    s.sound("kit/tone.wav", 8000);
    let app = s.app();
    let plain = num(&export_and_wait(&app, r#"{"p":"kit/tone.wav","bits":24}"#), &["frames"]);
    server::routes::route(&app, &post("/api/pitchtime", r#"{"p":"kit/tone.wav","on":true,"speed":200,"pitch":100}"#));
    let fast = export_and_wait(&app, r#"{"p":"kit/tone.wav","bits":24}"#);
    let frames = num(&fast, &["frames"]);
    assert!((frames - plain / 2.0).abs() <= 2.0, "{plain} frames at 200 % became {frames}");
}

/// Hyperprism's Post-Roll lengthens the export by exactly its time, so the
/// effects' tails are in the file.
#[test]
fn post_roll_lengthens_the_export_by_its_time() {
    let s = Scratch::new("export-post-roll");
    s.sound("kit/tone.wav", 8000);
    let app = s.app();
    let plain = num(&export_and_wait(&app, r#"{"p":"kit/tone.wav","bits":24}"#), &["frames"]);
    let r = server::routes::route(&app, &post("/api/rack", r#"{"p":"kit/tone.wav","sr":44100,"slots":[],"postRoll":{"stretch":500}}"#));
    assert_eq!(status(&r), 200);
    let longer = export_and_wait(&app, r#"{"p":"kit/tone.wav","bits":24}"#);
    let rate = num(&longer, &["sampleRate"]);
    assert_eq!(num(&longer, &["frames"]), plain + (0.5 * rate).floor(), "at {rate} Hz");
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
