//! The Grain module against MGL's own. Every post the Grain page makes to
//! `/api/edit` (its controls are the document's stretch), MGL's presets and
//! rack, and MGL's four LFOs, run tick by tick, were recorded from MGL's own
//! routes and code (`tests/reference/grain`, written by
//! `core/crates/server/tests/routes/grain_references.rs`); here they give the
//! same answers and the same numbers, to the bit. The deck holds what MGL's
//! server hands MGL's engine (`live::load`, `push_params`) and plays what a
//! deck built by hand that way plays, sample for sample. Its keys and its
//! transport sound; a canvas saved and loaded plays the same; nothing on the
//! audio thread allocates.

#[path = "../../engine-mgl/tests/common/mod.rs"]
mod common;
use common::*;
use engine_app::grain::{self, lfos, rack::RackSpec};
use engine_app::Session;
use engine_core::*;
use serde_json::{json, Value};
use std::sync::Arc;

const REF: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/reference/grain");

fn refs() -> Value {
    serde_json::from_str(&std::fs::read_to_string(format!("{REF}/refs.json")).unwrap()).unwrap()
}

fn scratch(what: &str) -> std::path::PathBuf {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let d = std::env::temp_dir().join(format!("grain-{what}-{}-{n}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// The sound MGL's reference test opens (`Scratch::sound`): a second of a
/// sine, mono, 16-bit, 44.1 kHz.
fn source_wav() -> std::path::PathBuf {
    let frames = 44_100usize;
    let mut out = audio_core::wav::header((frames * 2) as u64, 1, 44_100, audio_core::Codec::PcmI16).to_vec();
    for i in 0..frames {
        let v = ((i as f32 / 30.0).sin() * 9000.0) as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    let path = scratch("src").join("grain.wav");
    std::fs::write(&path, out).unwrap();
    path
}

/// A canvas: a Sound with the reference's sound open, cabled into Grain.
fn canvas(rate: f32) -> (Session, AudioEngine, u32, u32) {
    let (mut s, audio) = Session::with_config(rate, exact());
    let sound = s.add("sound", 0.0, 0.0).unwrap();
    let g = s.add("grain", 400.0, 0.0).unwrap();
    s.connect((sound, 0), (g, 0)).unwrap();
    let path = source_wav();
    s.sound_open(sound, path.to_str().unwrap(), &json!({ "kind": "file", "path": "kit/grain.wav", "name": "grain.wav" }), false).unwrap();
    (s, audio, sound, g)
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

fn op(msg: &Value) -> Value {
    msg.clone()
}

#[test]
fn every_post_of_the_page_moves_the_document_as_mgls_does() {
    let r = refs();
    let (mut s, _audio, _sound, g) = canvas(48_000.0);
    for (i, (msg, mgl)) in r["script"].as_array().unwrap().iter().zip(r["steps"].as_array().unwrap()).enumerate() {
        let ours = s.grain_edit(g, &op(msg)).unwrap();
        assert!(same(&ours["stretch"], &mgl["stretch"]), "step {i} {msg}:\n ours {}\n MGL's {}", ours["stretch"], mgl["stretch"]);
        for k in ["canUndo", "canRedo", "edited"] {
            assert_eq!(ours[k], mgl[k], "step {i}: {k}");
        }
    }
}

#[test]
fn presets_and_the_rack_are_mgls_own() {
    let r = refs();
    let (mut s, _audio, _sound, g) = canvas(48_000.0);
    for msg in r["script"].as_array().unwrap() {
        s.grain_edit(g, msg).unwrap();
    }
    let dir = scratch("presets");
    s.grain_presets(g, &json!({ "op": "places", "mine": dir.join("PRESETS.json").to_str().unwrap() })).unwrap();
    let saved = s.grain_presets(g, &json!({ "op": "save", "name": "Ref one", "note": "a note" })).unwrap();
    let ours = &saved["presets"][0];
    let mgl = &r["presetsSaved"]["presets"][0];
    for k in ["name", "note", "path", "stretch", "rack"] {
        assert!(same(&ours[k], &mgl[k]), "the saved preset's {k}:\n ours {}\n MGL's {}", ours[k], mgl[k]);
    }
    // The file is MGL's shape: MGL's reader takes it as it is.
    let file: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("PRESETS.json")).unwrap()).unwrap();
    assert!(same(&file["Ref one"]["stretch"], &mgl["stretch"]));
    s.grain_edit(g, &json!({ "op": "stretch", "ratio": 7, "algorithm": "vocoder", "grain": { "layers": 9 } })).unwrap();
    let mut posted = r["rackPosted"].clone();
    posted["op"] = json!("set");
    let rack = s.grain_rack(g, &posted).unwrap();
    // The EQ's curve, which MGL adds for the page to draw, is the FX page's (B2).
    let unc = |v: &Value| { let mut v = v.clone(); v.as_object_mut().unwrap().remove("curve"); v };
    let mgl_rack = unc(&r["rack"]);
    assert!(same(&rack, &mgl_rack), "the rack:\n ours {rack}\n MGL's {mgl_rack}");
    let applied = s.grain_presets(g, &json!({ "op": "apply", "name": "Ref one" })).unwrap();
    assert!(same(&applied["edit"]["stretch"], &r["presetApplied"]["stretch"]), "the preset applied:\n ours {}\n MGL's {}", applied["edit"]["stretch"], r["presetApplied"]["stretch"]);
    assert!(same(&applied["rack"], &unc(&r["rackAfterPreset"])), "the rack after the preset:\n ours {}\n MGL's {}", applied["rack"], r["rackAfterPreset"]);
}

#[test]
fn the_lfos_tick_as_mgls_do() {
    let r = refs();
    let mut bank = lfos::Bank::default();
    let t = |target: &str, lo: f64, hi: f64, curve: &str| json!({ "t": target, "lo": lo, "hi": hi, "curve": curve });
    lfos::post(
        &mut bank,
        &json!({ "bpm": 96, "lfos": [
            { "shape": "sine", "hz": 0.25, "mode": "free", "depth": 0.45, "targets": [t("stretch.grain.rateHz", 0.0, 500.0, "pow"), t("stretch.ratio", 0.01, 100.0, "log")] },
            { "shape": "smooth", "hz": 0.14, "mode": "free", "depth": 0.4, "targets": [t("stretch.grain.position", -1.0, 1.0, "lin"), { "t": "fx.factory-eq.band.2.gainDb" }] },
            { "shape": "tri", "hz": 0.61, "mode": "trig", "depth": 0.5, "targets": [{ "t": "stretch.semitones" }, { "t": "fx.factory-comp.slot.wet" }, { "t": "stretch.grain.layers" }] },
            { "shape": "steps", "hz": 1.0, "beats": 0.5, "mode": "trig", "depth": 0.3, "targets": [t("stretch.grain.panSpread", 0.0, 1.0, "lin"), t("stretch.grain.rateHz", 0.0, 500.0, "pow")] },
        ] }),
    )
    .unwrap();
    let mut doc = mgl_fx::Stretch::default();
    doc.ratio = 2.0;
    doc.semitones = 3.0;
    doc.grain.rate_hz = 80.0;
    doc.grain.position = 0.25;
    doc.grain.layers = 4;
    doc.grain.pan_spread = 0.2;
    let spec = RackSpec::default_chain();
    let mut notes = 0u64;
    let ticks = r["lfoTicks"].as_array().unwrap();
    assert_eq!(ticks.len(), 400);
    for (i, mgl) in ticks.iter().enumerate() {
        if i % 97 == 50 {
            notes += 1;
        }
        bank.advance(0.008, notes);
        let outs = lfos::compute(&bank, &doc, &spec);
        let mgl = mgl.as_array().unwrap();
        assert_eq!(outs.len(), mgl.len(), "tick {i}");
        for (o, m) in outs.iter().zip(mgl) {
            assert_eq!(o.target, m["t"].as_str().unwrap(), "tick {i}");
            // MGL wrote each as the f32 it is, in the fewest digits.
            let f = |k: &str| m[k].as_f64().unwrap() as f32;
            assert_eq!(o.base.to_bits(), f("base").to_bits(), "tick {i} {}: base", o.target);
            assert_eq!(o.value.to_bits(), f("value").to_bits(), "tick {i} {}: {} against MGL's {}", o.target, o.value, f("value"));
        }
    }
}

#[test]
fn the_deck_holds_what_mgls_server_hands_mgls_engine() {
    let r = refs();
    let (mut s, _audio, sound, g) = canvas(48_000.0);
    for msg in r["script"].as_array().unwrap() {
        s.grain_edit(g, msg).unwrap();
        let p = s.grain_deck_params(g).unwrap();
        let doc = s.sound_stretch(sound).unwrap();
        let mut want = p;
        grain::merge_stretch(&mut want, &doc);
        assert_eq!(format!("{p:?}"), format!("{want:?}"), "after {msg}");
        // The sound's own length and rate stay the deck's: a second at 48 kHz.
        assert_eq!(p.in_frames, 48_000);
        assert_eq!(p.sample_rate, 48_000);
    }
    // An edit in Edit's place (an undo) reaches the deck too.
    s.grain_edit(g, &json!({ "op": "undo" })).unwrap();
    let mut want = s.grain_deck_params(g).unwrap();
    grain::merge_stretch(&mut want, &s.sound_stretch(sound).unwrap());
    assert_eq!(format!("{:?}", s.grain_deck_params(g).unwrap()), format!("{want:?}"));
}

/// A deck built by hand as MGL's server builds one: started idle with a
/// silent sound (`live::ensure`), the page's voice sent (`gsVoiceSend`), then
/// the document loaded into it (`live::load`), with the factory rack.
fn by_hand(source: Arc<mgl_engine::Source>, stretch: &mgl_fx::Stretch) -> (mgl_engine::Core, Arc<mgl_engine::Shared>, Arc<mgl_engine::GrainKeys>) {
    let rate = 48_000u32;
    let idle = mgl_fx::grain::StreamParams::new(0, rate);
    let silent = Arc::new(mgl_engine::Source { samples: Vec::new(), channels: 2 });
    let keys = Arc::new(mgl_engine::GrainKeys::new());
    let shared = Arc::new(mgl_engine::Shared::new(idle, Arc::clone(&silent)));
    shared.voices.set_offline(true);
    shared.voices.set_ceiling(grain::VOICES as u32);
    mgl_engine::voices::stock(&shared, grain::VOICES, grain::GRID, 2);
    let core = mgl_engine::Core::new(grain::GRID, 2, idle, silent).with_keys(Arc::clone(&keys));
    grain::apply_voice(&keys, &grain::page_voice());
    let mut params = mgl_fx::grain::StreamParams::new(source.frames(), rate);
    grain::merge_stretch(&mut params, stretch);
    shared.set_source(Arc::clone(&source));
    shared.set_params(params);
    shared.set_map(None);
    shared.set_parts(Arc::new(mgl_fx::hstream::Parts::default()));
    shared.request_seek(0);
    shared.reset_governor();
    shared.reset_load();
    shared.set_rack(Some(RackSpec::default_chain().build(rate, 2)).filter(|r| !r.is_empty()));
    shared.set_pitch_time(Default::default());
    shared.set_post_roll_frames(0);
    shared.set_bank(mgl_engine::stretcher::LayerBank::build(stretch.algorithm, stretch.grain.layers, grain::MAX_BLOCK, 2, rate));
    mgl_engine::voices::stock(&shared, grain::VOICES, grain::GRID, 2);
    (core, shared, keys)
}

#[test]
fn the_canvas_deck_plays_what_mgls_engine_plays() {
    for msg in [
        json!({ "op": "stretch", "ratio": 2.5, "algorithm": "granular", "grain": { "rateHz": 60, "layers": 2, "positionJitterMs": 20 } }),
        json!({ "op": "stretch", "ratio": 1.5, "semitones": 4, "algorithm": "wsola" }),
        json!({ "op": "stretch", "ratio": 3, "algorithm": "pvsola" }),
    ] {
        let (mut s, mut audio, sound, g) = canvas(48_000.0);
        s.grain_edit(g, &msg).unwrap();
        hear(&mut s, g);
        s.note(g, true, 60, 0.8).unwrap();
        let (l, rr) = render(&mut audio, grain::GRID * 24, 256);
        let source = s.sound_source(sound).unwrap();
        let (mut core, shared, keys) = by_hand(source, &s.sound_stretch(sound).unwrap());
        keys.note_on(60, 0.8);
        let mut block = vec![0.0f32; grain::GRID * 2];
        let (mut a, mut b) = (Vec::new(), Vec::new());
        for _ in 0..24 {
            core.fill(&mut block, 2, &shared);
            for f in block.chunks_exact(2) {
                a.push(f[0]);
                b.push(f[1]);
            }
        }
        assert!(l.iter().any(|x| x.abs() > 1e-3), "{msg}: it sounds");
        assert_same(&format!("{msg} left"), &l, &a);
        assert_same(&format!("{msg} right"), &rr, &b);
    }
}

#[test]
fn grain_plays_its_own_sound_with_nothing_cabled_and_its_transport_plays_the_sound() {
    let (mut s, mut audio) = Session::with_config(48_000.0, exact());
    let g = s.add("grain", 0.0, 0.0).unwrap();
    hear(&mut s, g);
    s.note(g, true, 48, 0.9).unwrap();
    let (l, _) = render(&mut audio, 8_192, 256);
    assert!(l.iter().any(|x| x.abs() > 1e-2), "the start sound plays from the keys");
    s.note(g, false, 48, 0.0).unwrap();
    // The page's release is 1.5 s.
    render(&mut audio, 48_000 * 3, 256);
    let (quiet, _) = render(&mut audio, 4_096, 256);
    assert!(quiet.iter().all(|x| x.abs() < 1e-3), "and stops when let go");
    let (mut s, mut audio, _sound, g) = canvas(48_000.0);
    hear(&mut s, g);
    s.grain_keys(g, &json!({ "run": true })).unwrap();
    s.grain_transport(g, &json!({ "play": true, "loop": { "on": true, "a": 0, "b": 0 } })).unwrap();
    let (l, _) = render(&mut audio, 8_192, 256);
    assert!(l.iter().any(|x| x.abs() > 1e-2), "Play plays the sound");
    let read = s.grain_read(g).unwrap();
    assert!(read["position"].as_f64().unwrap() > 0.0);
    assert_eq!(read["playing"], true);
}

#[test]
fn the_lfos_move_the_deck_and_let_go_put_back_the_document() {
    let (mut s, _audio, _sound, g) = canvas(48_000.0);
    s.grain_edit(g, &json!({ "op": "stretch", "algorithm": "granular", "grain": { "rateHz": 80 } })).unwrap();
    s.grain_lfos(g, &json!({ "lfos": [{ "shape": "square", "hz": 0.001, "mode": "free", "depth": 0.5, "targets": [{ "t": "stretch.grain.rateHz", "lo": 0, "hi": 500, "curve": "pow" }] }] })).unwrap();
    s.grain_tick(0.008);
    let moved = s.grain_deck_params(g).unwrap().grain.rate_hz;
    assert!(moved > 80.0, "held at the top of a square: {moved}");
    assert_eq!(s.grain_lfos_state(g).unwrap()["heard"]["stretch.grain.rateHz"].as_f64().unwrap() as f32, moved);
    s.grain_lfos(g, &json!({ "off": true })).unwrap();
    s.grain_tick(0.008);
    assert_eq!(s.grain_deck_params(g).unwrap().grain.rate_hz, 80.0, "back where the document has it");
}

#[test]
fn a_canvas_saved_and_loaded_plays_the_same() {
    let r = refs();
    let (mut s, mut audio, _sound, g) = canvas(48_000.0);
    for msg in r["script"].as_array().unwrap().iter().take(3) {
        s.grain_edit(g, msg).unwrap();
    }
    s.grain_keys(g, &json!({ "mode": "poly", "attack": 0.02, "release": 0.3 })).unwrap();
    s.grain_rack(g, &json!({ "op": "param", "id": "factory-comp", "key": "ratio", "value": 4 })).unwrap();
    // A control moved live rides over the rack built before it (MGL's
    // `set_manual_param`); a patch loaded builds the rack with it. Built again
    // here, as a load builds it, so the two are the same rack.
    let built = s.grain_rack(g, &json!({ "op": "get" })).unwrap();
    s.grain_rack(g, &{ let mut b = built; b["op"] = json!("set"); b }).unwrap();
    s.grain_set_ui(g, json!({ "oct": 3 })).unwrap();
    // Every glide and ramp settled first, so the two start from rest alike.
    hear(&mut s, g);
    render(&mut audio, 96_000, 256);
    let saved = s.save();
    let (mut t, mut audio2) = Session::with_config(48_000.0, exact());
    t.load(&serde_json::from_str(&saved.to_string()).unwrap()).unwrap();
    assert!(same(&t.grain_info(g).unwrap()["doc"]["stretch"], &s.grain_info(g).unwrap()["doc"]["stretch"]));
    assert!(same(&t.grain_info(g).unwrap()["rack"], &s.grain_info(g).unwrap()["rack"]));
    assert_eq!(t.grain_info(g).unwrap()["ui"]["oct"], 3);
    hear(&mut t, g);
    render(&mut audio2, 96_000, 256);
    for x in [&mut s, &mut t] {
        x.note(g, true, 60, 0.7).unwrap();
        x.note(g, true, 67, 0.7).unwrap();
    }
    let (a, _) = render(&mut audio, 16_384, 256);
    let (b, _) = render(&mut audio2, 16_384, 256);
    assert!(a.iter().any(|x| x.abs() > 1e-3));
    assert_same("saved and loaded", &a, &b);
}

#[test]
fn nothing_on_the_audio_thread_allocates_while_grain_plays_and_changes() {
    assert_the_check_is_on();
    let r = refs();
    let (mut s, mut audio, _sound, g) = canvas(48_000.0);
    hear(&mut s, g);
    s.grain_lfos(g, &json!({ "lfos": [{ "shape": "sine", "hz": 3, "mode": "free", "depth": 0.3, "targets": [{ "t": "stretch.grain.position" }, { "t": "fx.factory-eq.band.2.gainDb" }] }] })).unwrap();
    s.grain_keys(g, &json!({ "run": true })).unwrap();
    s.grain_transport(g, &json!({ "play": true, "loop": { "on": true, "a": 0, "b": 0 } })).unwrap();
    s.note(g, true, 60, 0.8).unwrap();
    render(&mut audio, 4_096, 256);
    s.collect();
    let before = counted();
    for (i, msg) in r["script"].as_array().unwrap().iter().take(4).enumerate() {
        s.grain_edit(g, msg).unwrap();
        s.grain_rack(g, &json!({ "op": "param", "id": "factory-comp", "key": "ratio", "value": 1 + i })).unwrap();
        for _ in 0..4 {
            s.grain_tick(0.008);
            render(&mut audio, 1_024, 256);
        }
        s.collect();
    }
    assert_eq!(counted() - before, 0, "allocations or frees inside a render; the last sizes: {:?}", last_sizes());
}
