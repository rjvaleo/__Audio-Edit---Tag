//! The live path and the Prism pad.

use super::*;

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
    assert_eq!(
        kinds.len(),
        fx::shape::ShapeKind::ALL.len() + fx::prism::catalogue().len(),
        "the list disagrees with the shapers and the prism catalogue"
    );

    for k in &kinds {
        let kind = match k.get("kind") {
            Some(server::json::Value::Str(s)) => s.clone(),
            _ => panic!("a module with no kind"),
        };
        assert!(
            fx::shape::ShapeKind::from_str(&kind).is_some() || fx::prism::id_for_kind(&kind).is_some(),
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

/// A prism effect describes its panel as well as its controls: the groups the
/// original laid them out in, the ones shown first, and the Prism pad's pair.
#[test]
fn prism_effects_are_offered_with_their_panels() {
    use server::json::Value;
    let s = Scratch::new("fx-prism");
    let app = s.app();
    let v = json(&server::routes::route(&app, &get("/api/fx", &[])));
    let Some(Value::Arr(kinds)) = v.get("shapers") else { panic!("no shapers came back") };
    let str_of = |v: Option<&Value>| v.and_then(Value::as_str).map(str::to_string);
    for entry in fx::prism::catalogue() {
        let d = entry.descriptor;
        let kind = format!("prism:{}", d.id);
        let k = kinds
            .iter()
            .find(|k| str_of(k.get("kind")).as_deref() == Some(kind.as_str()))
            .unwrap_or_else(|| panic!("{kind} is not offered"));
        assert_eq!(str_of(k.get("label")).as_deref(), Some(d.label));
        let Some(Value::Arr(params)) = k.get("params") else { panic!("{kind} has no params") };
        assert_eq!(params.len(), d.params.len());
        let panel = k.get("panel").unwrap_or_else(|| panic!("{kind} has no panel"));
        let Some(Value::Arr(groups)) = panel.get("groups") else { panic!("{kind} has no groups") };
        assert_eq!(groups.len(), d.panel.groups.len());
        for (g, want) in groups.iter().zip(d.panel.groups) {
            assert_eq!(str_of(g.get("label")).as_deref(), Some(want.label));
            let Some(Value::Arr(keys)) = g.get("keys") else { panic!("a group with no keys") };
            let keys: Vec<String> = keys.iter().filter_map(|k| k.as_str().map(str::to_string)).collect();
            assert_eq!(keys, want.keys);
        }
        match (panel.get("pad"), d.panel.pad) {
            (Some(pad), Some(want)) => {
                assert_eq!(str_of(pad.get("x")).as_deref(), Some(want.x));
                assert_eq!(str_of(pad.get("y")).as_deref(), Some(want.y));
                assert_eq!(num(pad, &["xMin"]), want.x_range.0 as f64);
                assert_eq!(num(pad, &["xMax"]), want.x_range.1 as f64);
                assert_eq!(num(pad, &["yMin"]), want.y_range.0 as f64);
                assert_eq!(num(pad, &["yMax"]), want.y_range.1 as f64);
            }
            (None, None) => {}
            (got, want) => panic!("{kind}: pad {got:?}, wanted {want:?}"),
        }
    }
    // A choice says what its values are called.
    let tremolo = kinds.iter().find(|k| str_of(k.get("kind")).as_deref() == Some("prism:tremolo")).unwrap();
    let Some(Value::Arr(params)) = tremolo.get("params") else { panic!() };
    let shape = params.iter().find(|p| str_of(p.get("key")).as_deref() == Some("shape")).unwrap();
    let Some(Value::Arr(choices)) = shape.get("choices") else { panic!("the shape has no choices") };
    assert_eq!(choices.len(), 3);
    // An effect that takes a sound says so.
    let conv = kinds.iter().find(|k| str_of(k.get("kind")).as_deref() == Some("prism:convolution")).unwrap();
    assert_eq!(conv.get("sound").and_then(|s| s.get("label")).and_then(Value::as_str), Some("Impulse"));
    // And the old Echo is not offered beside the new one.
    assert!(!kinds.iter().any(|k| str_of(k.get("kind")).as_deref() == Some("dattorro_echo")));
}

#[test]
fn a_live_parameter_reaches_a_prism_slot() {
    let s = Scratch::new("live-prism");
    s.sound("kit/tone.wav", 4_410);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post(
            "/api/rack",
            r#"{"p":"kit/tone.wav","sr":44100,"slots":[{"id":"t1","kind":"prism:tremolo","bypassed":false,
                "params":{"rateHz":4,"depth":0.5,"shape":0,"stereo":0}}]}"#,
        ),
    );
    assert_eq!(status(&r), 200, "the rack was refused: {}", String::from_utf8_lossy(&r.body));
    let r = server::routes::route(
        &app,
        &post("/api/rack/param", r#"{"p":"kit/tone.wav","id":"t1","key":"depth","value":0.9}"#),
    );
    assert_eq!(status(&r), 200, "{}", String::from_utf8_lossy(&r.body));
    let back = json(&server::routes::route(&app, &get("/api/rack", &[("p", "kit/tone.wav")])));
    let slots = match back.get("slots") {
        Some(server::json::Value::Arr(a)) => a.clone(),
        _ => panic!("no slots came back"),
    };
    assert_eq!(slots[0].get("kind").and_then(server::json::Value::as_str), Some("prism:tremolo"));
    assert!((num(&slots[0], &["params", "depth"]) - 0.9).abs() < 1e-6);
}

/// Hyperprism's Pitch Time Changer is kept with the document's rack: a post
/// carries only what changed, out-of-range values are held to the window's,
/// and the pad offers it second, with its own window.
#[test]
fn the_pitch_time_changer_is_kept_with_the_document() {
    let s = Scratch::new("pitch-time");
    s.sound("kit/tone.wav", 4_410);
    let app = s.app();
    let r = server::routes::route(&app, &post("/api/pitchtime", r#"{"p":"kit/tone.wav","on":true,"speed":150}"#));
    assert_eq!(status(&r), 200, "{}", String::from_utf8_lossy(&r.body));
    let r = server::routes::route(&app, &post("/api/pitchtime", r#"{"p":"kit/tone.wav","pitch":999,"grain":30}"#));
    assert_eq!(status(&r), 200);
    let back = json(&server::routes::route(&app, &get("/api/rack", &[("p", "kit/tone.wav")])));
    let pt = back.get("pitchTime").expect("the rack carries it");
    assert_eq!(pt.get("on"), Some(&server::json::Value::Bool(true)), "a later post kept it on");
    assert_eq!((num(pt, &["speed"]), num(pt, &["pitch"]), num(pt, &["grain"])), (150.0, 200.0, 30.0));
    // A rack posted by something that knows nothing of it leaves it alone.
    server::routes::route(&app, &post("/api/rack", r#"{"p":"kit/tone.wav","sr":44100,"slots":[]}"#));
    let kept = json(&server::routes::route(&app, &get("/api/rack", &[("p", "kit/tone.wav")])));
    assert_eq!(kept.get("pitchTime").and_then(|p| p.get("on")), Some(&server::json::Value::Bool(true)));
    let pad = json(&server::routes::route(&app, &get("/api/pad", &[("p", "kit/tone.wav")])));
    let sources = match pad.get("sources") {
        Some(server::json::Value::Arr(a)) => a.clone(),
        _ => panic!("no sources"),
    };
    assert_eq!(sources[1].get("id").and_then(server::json::Value::as_str), Some("ptc"));
}

/// Hyperprism's presets, per process: its factory set, and the user's own,
/// saved, renamed and deleted. A preset is the pad's window, the process's
/// other settings and its post-roll — never the pad's position.
#[test]
fn pad_presets_come_from_hyperprism_and_from_the_user() {
    let s = Scratch::new("pad-presets");
    let app = s.app();
    let list = |kind: &str| json(&server::routes::route(&app, &get("/api/pad/presets", &[("kind", kind)])));
    let arr = |v: &server::json::Value, k: &str| match v.get(k) {
        Some(server::json::Value::Arr(a)) => a.clone(),
        _ => Vec::new(),
    };
    let low = list("hp-low-pass");
    let factory = arr(&low, "factory");
    assert_eq!(factory.len(), 5, "Hyperprism's five Low Pass presets");
    assert_eq!(factory[0].get("name").and_then(server::json::Value::as_str), Some("Low Resonance"));
    assert_eq!(factory[0].get("x").and_then(server::json::Value::as_str), Some("freqHz"));
    assert_eq!(arr(&list("ptc"), "factory").len(), 10, "and the Pitch Time Changer's ten");

    let save = r#"{"kind":"hp-low-pass","name":"Mine","preset":{"x":"freqHz","xLo":100,"xHi":900,"y":"q","yLo":1,"yHi":4,"settings":{"smoothing":30},"postRollMs":200}}"#;
    assert_eq!(status(&server::routes::route(&app, &post("/api/pad/presets", save))), 200);
    let user = arr(&list("hp-low-pass"), "user");
    assert_eq!(user.len(), 1);
    assert_eq!(num(&user[0], &["postRollMs"]), 200.0);
    server::routes::route(&app, &post("/api/pad/presets/rename", r#"{"kind":"hp-low-pass","from":"Mine","to":"Yours"}"#));
    assert_eq!(arr(&list("hp-low-pass"), "user")[0].get("name").and_then(server::json::Value::as_str), Some("Yours"));
    // Kept on disk, for the next time the app opens.
    let again = s.app();
    let kept = json(&server::routes::route(&again, &get("/api/pad/presets", &[("kind", "hp-low-pass")])));
    assert_eq!(arr(&kept, "user").len(), 1);
    server::routes::route(&app, &post("/api/pad/presets/delete", r#"{"kind":"hp-low-pass","name":"Yours"}"#));
    assert!(arr(&list("hp-low-pass"), "user").is_empty());
}

// ==================================================== the Prism pad

/// What the pad can drive: Time & Pitch, then the rack's slots, each with its
/// controls and its pair — the saved one if there is one, else the default.
#[test]
fn the_pad_lists_its_sources_with_their_pairs() {
    use server::json::Value;
    let s = Scratch::new("pad-sources");
    s.sound("kit/tone.wav", 4_410);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post(
            "/api/rack",
            r#"{"p":"kit/tone.wav","sr":44100,"slots":[{"id":"r1","kind":"ring","bypassed":false,"params":{}},
                {"id":"e1","kind":"eq","bypassed":false}],
               "pads":{"r1":{"x":"mix","xLo":0.2,"xHi":0.8,"y":"hz","yLo":100,"yHi":900}}}"#,
        ),
    );
    assert_eq!(status(&r), 200, "{}", String::from_utf8_lossy(&r.body));
    let v = json(&server::routes::route(&app, &get("/api/pad", &[("p", "kit/tone.wav")])));
    let Some(Value::Arr(sources)) = v.get("sources") else { panic!("no sources: {}", v.to_string()) };
    let ids: Vec<&str> = sources.iter().filter_map(|s| s.get("id").and_then(Value::as_str)).collect();
    assert_eq!(ids, ["stretch", "ptc", "r1"], "the EQ is not a pad source");
    let ring = &sources[2];
    assert_eq!(ring.get("label").and_then(Value::as_str), Some("Ring mod"));
    let Some(Value::Arr(controls)) = ring.get("controls") else { panic!("no controls") };
    assert!(controls.iter().any(|c| c.get("key").and_then(Value::as_str) == Some("hz")));
    // The saved pair, not the default one.
    assert_eq!(ring.get("pad").and_then(|p| p.get("x")).and_then(Value::as_str), Some("mix"));
    assert_eq!(num(ring, &["pad", "yHi"]), 900.0);
    // Time & Pitch has no saved pair, so its default comes back.
    assert_eq!(sources[0].get("pad").and_then(|p| p.get("x")).and_then(Value::as_str), Some("ratio"));
    // And a pad setup survives the rack's own round trip.
    let back = json(&server::routes::route(&app, &get("/api/rack", &[("p", "kit/tone.wav")])));
    assert!((num(&back, &["pads", "r1", "xLo"]) - 0.2).abs() < 1e-6);
}

/// The `i`th number of an array.
fn nth(v: &server::json::Value, i: usize) -> f64 {
    match v {
        server::json::Value::Arr(a) => match a.get(i) {
            Some(server::json::Value::Num(n)) => *n,
            other => panic!("item {i} is {other:?}"),
        },
        other => panic!("not an array: {}", other.to_string()),
    }
}

/// A convolution's impulse is a sound from the library: naming it in the rack
/// loads it, so the effect has it when the chain is built.
#[test]
fn a_rack_naming_an_impulse_loads_it_from_the_library() {
    let s = Scratch::new("impulse");
    s.sound("kit/tone.wav", 4_410);
    s.sound("kit/room.wav", 2_000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post(
            "/api/rack",
            r#"{"p":"kit/tone.wav","sr":44100,"slots":[{"id":"c1","kind":"prism:convolution","bypassed":false,
                "sound":"kit/room.wav","params":{"lengthMs":50}}]}"#,
        ),
    );
    assert_eq!(status(&r), 200, "{}", String::from_utf8_lossy(&r.body));
    let back = json(&server::routes::route(&app, &get("/api/rack", &[("p", "kit/tone.wav")])));
    let slots = match back.get("slots") {
        Some(server::json::Value::Arr(a)) => a.clone(),
        _ => panic!("no slots"),
    };
    assert_eq!(slots[0].get("sound").and_then(server::json::Value::as_str), Some("kit/room.wav"));
    let loaded = fx::prism::sound("kit/room.wav").expect("the impulse was not loaded");
    assert_eq!(loaded.samples.len() / loaded.channels, 2_000);
    // A path outside the library is not followed.
    server::routes::route(
        &app,
        &post(
            "/api/rack",
            r#"{"p":"kit/tone.wav","sr":44100,"slots":[{"id":"c1","kind":"prism:convolution","bypassed":false,
                "sound":"../../etc/hosts","params":{}}]}"#,
        ),
    );
    assert!(fx::prism::sound("../../etc/hosts").is_none());
}

/// A take as the pad draws it, and LOOP on both of its lanes at once.
#[test]
fn the_pad_reads_a_take_as_one_path_and_loops_both_lanes() {
    use server::json::Value;
    let s = Scratch::new("pad-path");
    s.sound("kit/tone.wav", 44_100);
    let app = s.app();
    let body = r#"{"p":"kit/tone.wav","bypassed":false,"lanes":[
        {"id":"a","target":"stretch.ratio","label":"S","enabled":true,"trim":0,"loop":null,"modulators":[],
         "points":[{"frame":1000,"value":0.2,"curve":"linear","tension":0},{"frame":9000,"value":0.8,"curve":"linear","tension":0}]},
        {"id":"b","target":"stretch.semitones","label":"P","enabled":true,"trim":0,"loop":null,"modulators":[],
         "points":[{"frame":1000,"value":0.5,"curve":"linear","tension":0},{"frame":5000,"value":0.9,"curve":"linear","tension":0}]}]}"#;
    assert_eq!(status(&server::routes::route(&app, &post("/api/automation", body))), 200);

    let v = json(&server::routes::route(
        &app,
        &get("/api/automation/path", &[("p", "kit/tone.wav"), ("x", "stretch.ratio"), ("y", "stretch.semitones")]),
    ));
    let Some(Value::Arr(points)) = v.get("points") else { panic!("no points: {}", v.to_string()) };
    let frames: Vec<f64> = points.iter().map(|p| nth(p, 0)).collect();
    assert_eq!(frames, [1000.0, 5000.0, 9000.0]);
    assert!((nth(&points[1], 1) - 0.5).abs() < 1e-6, "ratio halfway along its line");
    assert!((nth(&points[2], 2) - 0.9).abs() < 1e-6, "pitch holding after its last point");

    let r = server::routes::route(
        &app,
        &post("/api/automation/loop", r#"{"p":"kit/tone.wav","x":"stretch.ratio","y":"stretch.semitones","on":true}"#),
    );
    assert_eq!(status(&r), 200, "{}", String::from_utf8_lossy(&r.body));
    let back = json(&server::routes::route(&app, &get("/api/automation", &[("p", "kit/tone.wav")])));
    let Some(Value::Arr(lanes)) = back.get("lanes") else { panic!("no lanes") };
    for l in lanes {
        let span = l.get("loop").expect("no loop");
        assert_eq!((nth(span, 0), nth(span, 1)), (1000.0, 9000.0));
    }
    let r = server::routes::route(
        &app,
        &post("/api/automation/loop", r#"{"p":"kit/tone.wav","x":"stretch.ratio","y":"stretch.nothing","on":true}"#),
    );
    assert_eq!(status(&r), 400, "a loop needs both lanes");
}
