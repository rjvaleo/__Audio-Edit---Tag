//! The Prism module against MGL's own. What MGL's routes answer for the Prism
//! page (`/api/fx`, the Prism document's `/api/rack` and `/api/rack/param`,
//! `/api/pad`, `/api/pitchtime`, `/api/pad/presets`) was recorded from MGL's
//! own routes (`tests/reference/prism/refs.json`, written by
//! `core/crates/server/tests/routes/prism_references.rs`); here the module
//! gives the same answers, to the bit. The pad and its takes were run in
//! node from the page's own JavaScript (`tests/reference/prism/takes.json`,
//! written by `takes-refs.mjs`); the module's takes land on the same points.
//! The deck plays, sample for sample, what MGL's engine plays when built by
//! hand as `live::load_prism` builds it and driven as the page drives it. A
//! canvas saved and loaded plays the same; nothing on the audio thread
//! allocates.

#[path = "../../engine-mgl/tests/common/mod.rs"]
mod common;
use common::*;
use engine_app::grain::{self, rack::RackSpec};
use engine_app::prism::{self, takes};
use engine_app::Session;
use engine_core::*;
use serde_json::{json, Value};
use std::sync::Arc;

const REF: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/reference/prism");

fn refs() -> Value {
    serde_json::from_str(&std::fs::read_to_string(format!("{REF}/refs.json")).unwrap()).unwrap()
}

fn scratch(what: &str) -> std::path::PathBuf {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let d = std::env::temp_dir().join(format!("prism-{what}-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// MGL's reference sound (`Scratch::sound`): a second of a sine, mono,
/// 16-bit, 44.1 kHz.
fn source_wav() -> std::path::PathBuf {
    let frames = 44_100usize;
    let mut out = audio_core::wav::header((frames * 2) as u64, 1, 44_100, audio_core::Codec::PcmI16).to_vec();
    for i in 0..frames {
        let v = ((i as f32 / 30.0).sin() * 9000.0) as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    let path = scratch("src").join("prism.wav");
    std::fs::write(&path, out).unwrap();
    path
}

/// A canvas: a Sound with the reference's sound open, cabled into Prism.
fn canvas() -> (Session, AudioEngine, u32, u32) {
    let (mut s, audio) = Session::with_config(48_000.0, exact());
    let sound = s.add("sound", 0.0, 0.0).unwrap();
    let p = s.add("prism", 400.0, 0.0).unwrap();
    s.connect((sound, 0), (p, 0)).unwrap();
    let path = source_wav();
    s.sound_open(sound, path.to_str().unwrap(), &json!({ "kind": "file", "path": "kit/prism.wav", "name": "prism.wav" }), false).unwrap();
    // The app takes a new sound up on its next collect, as Grain does.
    s.collect();
    (s, audio, sound, p)
}

fn hear(s: &mut Session, id: u32) {
    s.controller().connect_out(port(id * 16, 0)).unwrap();
    s.controller().commit().unwrap();
}

/// The same JSON, numbers compared as numbers.
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Object(x), Value::Object(y)) => x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same(v, w))),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(v, w)| same(v, w)),
        _ => a == b,
    }
}

/// The same JSON, numbers within a few units in the last place.
fn close(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            let (x, y) = (x.as_f64().unwrap(), y.as_f64().unwrap());
            (x - y).abs() <= 1e-14 * x.abs().max(y.abs()).max(1e-300)
        }
        (Value::Object(x), Value::Object(y)) => x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| close(v, w))),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(v, w)| close(v, w)),
        _ => a == b,
    }
}

fn check(what: &str, ours: &Value, mgl: &Value) {
    assert!(same(ours, mgl), "{what}:\n ours  {ours}\n MGL's {mgl}");
}

/// MGL's `/api/rack` answer without the EQ's curve (the FX page's, B2).
fn uncurved(v: &Value) -> Value {
    let mut v = v.clone();
    if let Some(o) = v.as_object_mut() {
        o.remove("curve");
    }
    v
}

fn call(s: &mut Session, p: u32, what: &str, v: Value) -> Value {
    s.prism_call(p, what, &v).unwrap_or_else(|e| panic!("{what} {v}: {e:?}"))
}

#[test]
fn every_route_of_the_page_answers_as_mgls_does() {
    let r = refs();
    let (mut s, _audio, _sound, p) = canvas();
    check("/api/fx", &call(&mut s, p, "fx", Value::Null), &r["fx"]);
    check("a new document's rack", &call(&mut s, p, "rack", json!({ "op": "get" })), &uncurved(&r["freshRack"]));
    check("a new document's /api/pad", &call(&mut s, p, "sources", Value::Null), &r["freshPad"]);
    let mut posted = r["rackPosted"].clone();
    posted["op"] = json!("set");
    check("the rack posted", &call(&mut s, p, "rack", posted), &uncurved(&r["rack"]));
    check("/api/pad on it", &call(&mut s, p, "sources", Value::Null), &r["pad"]);
    for (msg, want) in r["ptcPosts"].as_array().unwrap().iter().zip(r["ptc"].as_array().unwrap()) {
        check(&format!("/api/pitchtime {msg}"), &call(&mut s, p, "pitchtime", msg.clone()), want);
    }
    let params = [
        json!({ "op": "param", "id": "echo-1", "key": "feedback", "value": 75 }),
        json!({ "op": "param", "id": "echo-1", "key": "delayMs", "value": 999999 }),
        json!({ "op": "param", "id": "lp-1", "key": "freqHz", "value": 440, "live": true }),
        json!({ "op": "param", "id": "c1", "key": "ratio", "value": 8 }),
        json!({ "op": "param", "id": "master", "key": "amount", "value": 0.8 }),
    ];
    for (msg, want) in params.iter().zip(r["params"].as_array().unwrap()) {
        match s.prism_call(p, "rack", msg) {
            Ok(v) => {
                assert_eq!(want["status"], 200, "{msg}: MGL refused it");
                check(&format!("/api/rack/param {msg}"), &v, &want["body"]);
            }
            Err(_) => assert_ne!(want["status"], 200, "{msg}: MGL took it"),
        }
    }
    check("the rack after", &call(&mut s, p, "rack", json!({ "op": "get" })), &uncurved(&r["rackAfter"]));
}

#[test]
fn the_pad_presets_are_mgls_own() {
    let r = refs();
    for (kind, want) in r["factory"].as_object().unwrap() {
        check(&format!("{kind}'s factory set"), &prism::presets::factory(kind).into(), &want["factory"]);
    }
    let dir = scratch("presets");
    let places = prism::presets::Places { mine: Some(dir.join("PAD-PRESETS.json")), mgl: None };
    for step in r["user"].as_array().unwrap() {
        let m = &step["msg"];
        let kind = m["kind"].as_str().unwrap();
        let ans = match step["path"].as_str().unwrap() {
            "/api/pad/presets" => places.save(kind, m["name"].as_str().unwrap(), &m["preset"]),
            "/api/pad/presets/rename" => places.rename(kind, m["from"].as_str().unwrap(), m["to"].as_str().unwrap()),
            _ => places.delete(kind, m["name"].as_str().unwrap()),
        }
        .unwrap();
        check(&format!("{} {m}", step["path"]), &ans, &step["answer"]);
        check(&format!("the list after {m}"), &places.list(kind), &step["list"]);
    }
    // MGL's own file, read only, listed after the app's.
    let mgl_dir = scratch("mgl");
    std::fs::copy(dir.join("PAD-PRESETS.json"), mgl_dir.join("PAD-PRESETS.json")).unwrap();
    let both = prism::presets::Places { mine: Some(scratch("mine").join("PAD-PRESETS.json")), mgl: Some(mgl_dir.join("PAD-PRESETS.json")) };
    let list = both.list("ptc");
    assert_eq!(list["user"][0]["name"], "Slow");
    assert_eq!(list["user"][0]["mgl"], true);
    assert!(both.delete("ptc", "Slow").is_err(), "MGL's are read only");
}

#[test]
fn a_preset_applied_through_the_module_moves_the_window_and_settings_as_the_page() {
    let (mut s, _audio, _sound, p) = canvas();
    let dir = scratch("module-presets");
    call(&mut s, p, "presets", json!({ "op": "places", "mine": dir.join("PAD-PRESETS.json").to_str().unwrap() }));
    call(&mut s, p, "chainAdd", json!({ "kind": "prism:hp-echo" }));
    let id = call(&mut s, p, "view", Value::Null)["chain"].as_array().unwrap().last().unwrap()["id"].as_str().unwrap().to_string();
    call(&mut s, p, "source", json!({ "id": id, "t": 0 }));
    let list = call(&mut s, p, "presets", json!({ "op": "list" }));
    assert_eq!(list["kind"], "hp-echo");
    let f0 = list["factory"][0].clone();
    assert!(f0.is_object(), "Hyperprism's Echo has its factory set");
    let v = call(&mut s, p, "presets", json!({ "op": "apply", "at": "f0" }));
    assert_eq!(v["label"], f0["name"]);
    let view = call(&mut s, p, "view", Value::Null);
    for k in ["x", "y"] {
        assert_eq!(view["setup"][k], f0[k], "the window's {k}");
    }
    for (k, want) in f0["settings"].as_object().unwrap() {
        let got = view["values"][k].as_f64().unwrap();
        assert!((got - want.as_f64().unwrap()).abs() < 1e-3, "{k}: {got} for {want}");
    }
    assert_eq!(view["postRoll"].as_f64().unwrap(), f0["postRollMs"].as_f64().unwrap_or(0.0).max(0.0));
    // Saved as the page saves one, it comes back.
    call(&mut s, p, "presets", json!({ "op": "save", "name": "Mine" }));
    let file: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("PAD-PRESETS.json")).unwrap()).unwrap();
    assert_eq!(file["hp-echo"][0]["name"], "Mine");
    assert_eq!(file["hp-echo"][0]["x"], f0["x"]);
}

/// MGL's Prism deck, built by hand as MGL's server builds it: idle and silent
/// (`device.rs`), then the sound loaded (`live::load_prism`), the page's
/// loop, stretch, speed, faders and glide sent (`prismDeckUse`, `hsOpen`).
fn by_hand(source: Arc<mgl_engine::Source>) -> (mgl_engine::Core, Arc<mgl_engine::Shared>) {
    let rate = 48_000u32;
    let idle = prism::idle_params(rate);
    let silent = Arc::new(mgl_engine::Source { samples: Vec::new(), channels: 2 });
    let shared = Arc::new(mgl_engine::Shared::new(idle, Arc::clone(&silent)));
    let core = mgl_engine::Core::new(grain::GRID, 2, idle, silent);
    shared.pause();
    shared.set_source(Arc::clone(&source));
    shared.set_params(mgl_fx::grain::StreamParams { in_frames: source.frames(), ..idle });
    shared.set_map(None);
    shared.set_parts(Arc::new(mgl_fx::hstream::Parts::default()));
    shared.request_seek(0);
    shared.set_loop(false, 0, 0);
    shared.reset_governor();
    shared.reset_load();
    shared.set_rack(Some(RackSpec::default_chain().build(rate, 2)).filter(|r| !r.is_empty()));
    shared.set_pitch_time(RackSpec::default_chain().pitch_time);
    shared.set_post_roll_frames(0);
    shared.set_bank(mgl_engine::stretcher::LayerBank::build(mgl_fx::stretch::Algorithm::Granular, mgl_fx::Grain::default().layers, grain::MAX_BLOCK, 2, rate));
    // The page: the loop on, its stretch, Playback Speed and faders, glide.
    shared.set_loop(true, 0, 0);
    post_stretch(&shared, &json!({ "ratio": 1, "semitones": 0, "windowMs": 46, "cloudMix": 0.5, "algorithm": "granular" }));
    shared.set_speed(1.0);
    let g = 10f64.powf((36.0 * 128.0 / 255.0 - 18.0) / 20.0) as f32;
    shared.set_side_gains(g, g);
    shared.set_glide(50.0);
    (core, shared)
}

/// `api_prism_stretch`, by hand.
fn post_stretch(shared: &mgl_engine::Shared, v: &Value) {
    let s = grain::stretch::from_json(v);
    let mut p = shared.params().unwrap();
    let rebank = p.algorithm != s.algorithm || p.grain.layers != s.grain.layers;
    grain::merge_stretch(&mut p, &s);
    shared.set_params(p);
    if rebank {
        shared.set_bank(mgl_engine::stretcher::LayerBank::build(s.algorithm, s.grain.layers, grain::MAX_BLOCK, 2, 48_000));
    }
}

fn play_by_hand(core: &mut mgl_engine::Core, shared: &mgl_engine::Shared, blocks: usize) -> (Vec<f32>, Vec<f32>) {
    let mut block = vec![0.0f32; grain::GRID * 2];
    let (mut a, mut b) = (Vec::new(), Vec::new());
    for _ in 0..blocks {
        core.fill(&mut block, 2, shared);
        for f in block.chunks_exact(2) {
            a.push(f[0]);
            b.push(f[1]);
        }
    }
    (a, b)
}

#[test]
fn the_canvas_deck_plays_what_mgls_engine_plays() {
    // Each: what the page sends (to the module), and the same by hand.
    type ByHand = fn(&mgl_engine::Shared);
    let cases: Vec<(&str, Vec<(&str, Value)>, ByHand)> = vec![
        ("at rest", vec![], |_| {}),
        (
            "the engine and the pad",
            vec![("engine", json!({ "v": "wsola" })), ("pad", json!({ "ratio": 2.5, "semitones": 4 }))],
            |sh| {
                post_stretch(sh, &json!({ "ratio": 1, "semitones": 0, "windowMs": 46, "cloudMix": 0.5, "algorithm": "wsola" }));
                let mut p = sh.params().unwrap();
                p.ratio = 2.5;
                p.semitones = 4.0;
                sh.set_params(p);
            },
        ),
        (
            "PVSOLA, the faders, speed, glide and the Pitch Time Changer",
            vec![
                ("engine", json!({ "v": "pvsola" })),
                ("fader", json!({ "key": "speed", "v": 160 })),
                ("fader", json!({ "key": "l", "v": 200 })),
                ("fader", json!({ "key": "r", "v": 40 })),
                ("padop", json!({ "op": "glide", "v": 20 })),
                ("pitchtime", json!({ "on": true, "speed": 150, "pitch": 70, "feedback": 30 })),
            ],
            |sh| {
                post_stretch(sh, &json!({ "ratio": 1, "semitones": 0, "windowMs": 46, "cloudMix": 0.5, "algorithm": "pvsola" }));
                let g = |v: f64| 10f64.powf((36.0 * v / 255.0 - 18.0) / 20.0) as f32;
                sh.set_speed(160.0 / 128.0);
                sh.set_side_gains(g(200.0), g(128.0));
                sh.set_side_gains(g(200.0), g(40.0));
                sh.set_glide(20.0);
                let pt = grain::rack::merge_pitch_time(RackSpec::default_chain().pitch_time, Some(&json!({ "on": true, "speed": 150, "pitch": 70, "feedback": 30 })));
                sh.set_pitch_time(pt);
            },
        ),
    ];
    for (name, msgs, hand) in cases {
        let (mut s, mut audio, sound, p) = canvas();
        for (what, v) in &msgs {
            call(&mut s, p, what, v.clone());
        }
        call(&mut s, p, "transport", json!({ "play": true }));
        hear(&mut s, p);
        let (l, rr) = render(&mut audio, grain::GRID * 24, 256);
        let source = s.sound_source(sound).unwrap();
        let (mut core, shared) = by_hand(source);
        hand(&shared);
        shared.play();
        let (a, b) = play_by_hand(&mut core, &shared, 24);
        assert!(l.iter().any(|x| x.abs() > 1e-3), "{name}: it sounds");
        assert_same(&format!("{name} left"), &l, &a);
        assert_same(&format!("{name} right"), &rr, &b);
    }
}

#[test]
fn a_hyperprism_process_on_the_pad_is_heard() {
    let (mut s, mut audio, _sound, p) = canvas();
    call(&mut s, p, "pick", json!({ "kind": "prism:hp-low-pass", "id": "", "t": 0 }));
    let view = call(&mut s, p, "view", Value::Null);
    let src = view["source"].as_str().unwrap().to_string();
    assert_eq!(view["chain"].as_array().unwrap().last().unwrap()["kind"], "prism:hp-low-pass");
    assert_eq!(view["setup"]["x"], "freqHz", "Hyperprism's pair for the Low Pass");
    hear(&mut s, p);
    call(&mut s, p, "transport", json!({ "play": true }));
    call(&mut s, p, "padop", json!({ "op": "down", "x": 1.0, "y": 0.5, "t": 1000 }));
    let open = render(&mut audio, 8_192, 256).0;
    call(&mut s, p, "padop", json!({ "op": "move", "x": 0.0, "y": 0.5, "t": 1100 }));
    call(&mut s, p, "padop", json!({ "op": "up", "t": 1200 }));
    let v = call(&mut s, p, "view", Value::Null);
    let rack = call(&mut s, p, "rack", json!({ "op": "get" }));
    let slot = rack["slots"].as_array().unwrap().iter().find(|x| x["id"] == src.as_str()).unwrap().clone();
    assert!((slot["params"]["freqHz"].as_f64().unwrap() - v["setup"]["xLo"].as_f64().unwrap()).abs() < 1e-3, "the pad moved the slot's control: {slot}");
    render(&mut audio, 8_192, 256);
    let shut = render(&mut audio, 8_192, 256).0;
    let rms = |x: &[f32]| (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt();
    let (a, b) = (rms(&open), rms(&shut));
    assert!((a - b).abs() > 0.3 * a.max(b), "the filter moved with the pad: {a} -> {b}");
}

#[test]
fn the_takes_land_where_the_pages_land() {
    let r: Value = serde_json::from_str(&std::fs::read_to_string(format!("{REF}/takes.json")).unwrap()).unwrap();
    for case in r.as_array().unwrap() {
        let mut pad = takes::Pad::default();
        pad.w = case["w"].as_f64().unwrap();
        pad.h = case["h"].as_f64().unwrap();
        pad.glide = case["glide"].as_f64().unwrap();
        pad.throw_on = case["throw"].as_bool().unwrap();
        pad.loop_on_release = case["loopOnRelease"].as_bool().unwrap();
        let mut got = Vec::new();
        for step in case["steps"].as_array().unwrap() {
            let t = step["t"].as_f64().unwrap();
            let n = |k: &str| step[k].as_f64().unwrap_or(0.0);
            match step["op"].as_str().unwrap() {
                "down" => {
                    pad.down((n("x"), n("y")), t, true, false);
                }
                "move" => {
                    pad.moved((n("x"), n("y")), t, step["shift"].as_bool().unwrap_or(false));
                }
                "up" => {
                    pad.up(t, true);
                }
                "play" => {
                    pad.play_button(t, true, true);
                }
                "stop" => {
                    pad.stop_button(t);
                }
                "rate" => pad.rate = n("v"),
                "dir" => pad.dir = step["v"].as_str().unwrap().to_string(),
                "shape" => {
                    pad.shape(step["v"].as_str().unwrap(), t, true, true);
                }
                "frame" => {
                    pad.frame(t);
                }
                other => panic!("{other}"),
            }
            let g = pad.ghost.unwrap_or(pad.hand);
            got.push(json!({ "hand": [pad.hand.0, pad.hand.1], "ghost": [g.0, g.1], "mode": pad.mode.name(), "values": [pad.value(true, pad.hand.0), pad.value(false, pad.hand.1)] }));
        }
        let want = &case["after"];
        // A shape drawn in is the page's sines: V8's are glibc's, which
        // round the last bit their own way now and then (not ported); the
        // shapes are held to within a few units in the last place, all else
        // to the bit.
        let near = case["steps"].as_array().unwrap().iter().any(|s| s["op"] == "shape");
        for (i, (g, w)) in got.iter().zip(want.as_array().unwrap()).enumerate() {
            assert!(if near { close(g, w) } else { same(g, w) }, "{} step {i} {}:\n ours  {g}\n the page's {w}", case["name"], case["steps"][i]);
        }
        let take = &case["take"];
        if !take.is_null() {
            let ours = pad.slots[0].as_ref().unwrap();
            assert_eq!(ours.dur, take["dur"].as_f64().unwrap(), "{}: the take's length", case["name"]);
            let pts: Vec<Value> = ours.pts.iter().map(|q| json!({ "x": q.x, "y": q.y, "t": q.t })).collect();
            let pts = Value::Array(pts);
            assert!(if near { close(&pts, &take["pts"]) } else { same(&pts, &take["pts"]) }, "{}: the take's points", case["name"]);
        }
    }
}

#[test]
fn the_lfos_swing_the_sound_and_let_go_put_back_the_setting() {
    let (mut s, mut audio, _sound, p) = canvas();
    call(&mut s, p, "source", json!({ "id": "ptc", "t": 0 }));
    hear(&mut s, p);
    call(&mut s, p, "transport", json!({ "play": true }));
    call(&mut s, p, "lfo", json!({ "op": "depth", "v": 100 }));
    call(&mut s, p, "lfo", json!({ "op": "rate", "v": 5 }));
    call(&mut s, p, "lfo", json!({ "op": "toggle", "src": "ptc", "key": "pitch" }));
    let base = call(&mut s, p, "view", Value::Null)["ptc"]["pitch"].as_f64().unwrap();
    let mut seen = Vec::new();
    for i in 0..30 {
        let v = call(&mut s, p, "tick", json!({ "t": 1000.0 + i as f64 * 34.0 }));
        render(&mut audio, 1_632, 256);
        seen.push(v["lfoMarks"][0]["v"].as_f64().unwrap());
        assert_eq!(v["ptc"]["pitch"].as_f64().unwrap(), base, "the setting is left where it is");
    }
    let (lo, hi) = seen.iter().fold((f64::MAX, f64::MIN), |(a, b), v| (a.min(*v), b.max(*v)));
    assert!(hi - lo > 50.0, "the swing: {lo}..{hi}");
    // The value MGL's page works out: base + sine × depth × half the range.
    let v = call(&mut s, p, "view", Value::Null);
    let l = &v["lfos"]["lfos"][0];
    let want = (base + (l["phase"].as_f64().unwrap() * std::f64::consts::TAU).sin() * 1.0 * 100.0).clamp(0.0, 200.0);
    assert!((v["lfoMarks"][0]["v"].as_f64().unwrap() - want).abs() < 1e-9);
    call(&mut s, p, "lfo", json!({ "op": "unmap", "k": 0 }));
    assert!(call(&mut s, p, "view", Value::Null)["lfoMarks"].as_array().unwrap().is_empty());
}

#[test]
fn a_canvas_saved_and_loaded_plays_the_same() {
    let (mut s, mut audio, _sound, p) = canvas();
    call(&mut s, p, "engine", json!({ "v": "wsola" }));
    call(&mut s, p, "fader", json!({ "key": "lr", "v": 180 }));
    call(&mut s, p, "fader", json!({ "key": "speed", "v": 100 }));
    call(&mut s, p, "padop", json!({ "op": "glide", "v": 80 }));
    call(&mut s, p, "chainAdd", json!({ "kind": "prism:hp-chorus" }));
    call(&mut s, p, "padop", json!({ "op": "shape", "v": "circle", "t": 0 }));
    call(&mut s, p, "padop", json!({ "op": "stop", "t": 10 }));
    call(&mut s, p, "padop", json!({ "op": "down", "x": 0.3, "y": 0.2, "t": 100 }));
    call(&mut s, p, "padop", json!({ "op": "up", "t": 120 }));
    call(&mut s, p, "transport", json!({ "play": false, "seek": 0 }));
    let saved = s.save();
    let (mut t, mut audio2) = Session::with_config(48_000.0, exact());
    t.load(&serde_json::from_str(&saved.to_string()).unwrap()).unwrap();
    let (a, b) = (call(&mut s, p, "view", Value::Null), call(&mut t, p, "view", Value::Null));
    for k in ["stretch", "hp", "chain", "setup", "values"] {
        check(&format!("loaded {k}"), &b[k], &a[k]);
    }
    assert_eq!(b["pad"]["slots"][0]["shape"], "circle", "the takes come back");
    for (x, au) in [(&mut s, &mut audio), (&mut t, &mut audio2)] {
        hear(x, p);
        call(x, p, "transport", json!({ "play": true, "seek": 0 }));
        let _ = au;
    }
    let (l1, _) = render(&mut audio, 16_384, 256);
    let (l2, _) = render(&mut audio2, 16_384, 256);
    assert!(l1.iter().any(|x| x.abs() > 1e-3));
    assert_same("saved and loaded", &l1, &l2);
}

#[test]
fn nothing_on_the_audio_thread_allocates_while_prism_plays_and_changes() {
    assert_the_check_is_on();
    let (mut s, mut audio, _sound, p) = canvas();
    call(&mut s, p, "chainAdd", json!({ "kind": "prism:hp-echo" }));
    call(&mut s, p, "source", json!({ "id": "stretch", "t": 0 }));
    call(&mut s, p, "lfo", json!({ "op": "toggle", "src": "stretch", "key": "windowMs" }));
    hear(&mut s, p);
    call(&mut s, p, "transport", json!({ "play": true }));
    render(&mut audio, 4_096, 256);
    s.collect();
    let before = counted();
    let mut t = 1000.0;
    for i in 0..20 {
        let x = i as f64 / 20.0;
        if i == 0 {
            call(&mut s, p, "padop", json!({ "op": "down", "x": x, "y": 0.5, "t": t }));
        } else {
            call(&mut s, p, "padop", json!({ "op": "move", "x": x, "y": 1.0 - x, "t": t }));
        }
        call(&mut s, p, "fader", json!({ "key": "l", "v": 100 + i }));
        call(&mut s, p, "tick", json!({ "t": t }));
        t += 34.0;
        render(&mut audio, 1_024, 256);
        s.collect();
    }
    call(&mut s, p, "padop", json!({ "op": "up", "t": t }));
    render(&mut audio, 1_024, 256);
    assert_eq!(counted() - before, 0, "allocations or frees inside a render; the last sizes: {:?}", last_sizes());
}

#[test]
fn choosing_hyperprisms_echo_from_the_menu_is_quick() {
    let (mut s, _audio, _sound, p) = canvas();
    call(&mut s, p, "lfo", json!({ "op": "toggle", "src": "stretch", "key": "cloudMix" }));
    for i in 0..10 {
        call(&mut s, p, "tick", json!({ "t": 1000.0 + i as f64 * 17.0 }));
    }
    let t0 = std::time::Instant::now();
    call(&mut s, p, "pick", json!({ "kind": "prism:hp-echo", "id": "", "t": 2000 }));
    let took = t0.elapsed().as_secs_f64();
    eprintln!("pick echo took {took:.3} s");
    assert!(took < 1.0, "{took} s");
}
