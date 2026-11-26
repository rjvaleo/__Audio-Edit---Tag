//! Seq on the canvas: its steps play and go out as notes (here into
//! Atmosphere); its state is the page's keys; MGL's own presets load as the
//! page loads them and the app's come back in the page's shape; a canvas with
//! it saves and loads to the same sound; nothing on the audio thread
//! allocates while it plays and changes.

#[path = "../../engine-mgl/tests/common/mod.rs"]
mod common;
use common::*;
use engine_app::Session;
use engine_core::*;
use serde_json::{json, Value};

const BLOCK: usize = 256;

fn session() -> (Session, AudioEngine) {
    Session::with_config(RATE, exact())
}

/// Seq into Output; returns seq.
fn canvas(s: &mut Session) -> u32 {
    let seq = s.add("seq", 0.0, 0.0).unwrap();
    let out = s.add("output", 1900.0, 0.0).unwrap();
    s.connect((seq, 0), (out, 0)).unwrap();
    seq
}

fn play(s: &mut Session, audio: &mut AudioEngine, blocks: usize) -> Vec<f32> {
    let mut out = Vec::new();
    for _ in 0..blocks {
        let (l, r) = render(audio, BLOCK, BLOCK);
        out.extend(l.iter().zip(&r).flat_map(|(a, b)| [*a, *b]));
        s.collect();
    }
    out
}

#[test]
fn its_state_is_the_pages_keys_and_it_plays() {
    let (mut s, mut audio) = session();
    let seq = canvas(&mut s);
    let st = s.seq_state(seq).unwrap();
    // The page as it opens.
    assert_eq!(st["bpm"], 120);
    assert_eq!(st["cutoff"], 67);
    assert_eq!(st["dir"], "fwd");
    assert_eq!(st["stepLen"], "0.5");
    assert_eq!(st["lfo1Target"], "filter");
    assert_eq!(st["tapeSpeed"], "studio75");
    assert_eq!(st["scale"], 0);
    assert_eq!(st["pattern"][9], json!([2, false]));
    assert_eq!(st["play"], false);
    // A slider keeps to its step and range; a select to its options.
    s.seq_set(seq, "bpm", &json!(300)).unwrap();
    s.seq_set(seq, "morphTime", &json!(3.3)).unwrap();
    s.seq_set(seq, "wave", &json!("nonsense")).unwrap();
    s.seq_set(seq, "wave", &json!("pulse")).unwrap();
    s.seq_set(seq, "rest3", &json!(true)).unwrap();
    let st = s.seq_state(seq).unwrap();
    assert_eq!(st["bpm"], 240);
    assert_eq!(st["morphTime"], 3.5);
    assert_eq!(st["wave"], "pulse");
    assert_eq!(st["pattern"][3], json!([3, true]));
    // Silent until Play.
    assert_eq!(peak(&play(&mut s, &mut audio, 40)), 0.0);
    s.seq_set(seq, "play", &json!(true)).unwrap();
    let heard = play(&mut s, &mut audio, 200);
    assert!(peak(&heard) > 0.01, "the steps are heard");
    let (now, playing) = s.seq_now(seq).unwrap();
    assert!(playing);
    assert!(now.is_some());
    s.seq_set(seq, "stop", &json!(true)).unwrap();
    // Taken at the module's next block.
    play(&mut s, &mut audio, 1);
    assert!(!s.seq_now(seq).unwrap().1);
    assert_eq!(s.seq_state(seq).unwrap()["play"], false);
}

#[test]
fn its_steps_play_atmosphere_down_a_cable() {
    let (mut s, mut audio) = session();
    let seq = s.add("seq", 0.0, 0.0).unwrap();
    let at = s.add("atmos", 1600.0, 0.0).unwrap();
    let out = s.add("output", 3200.0, 0.0).unwrap();
    s.connect((seq, 1), (at, 0)).unwrap();
    s.connect((at, 0), (out, 0)).unwrap();
    s.seq_set(seq, "play", &json!(true)).unwrap();
    let heard = play(&mut s, &mut audio, 200);
    assert!(peak(&heard) > 1e-3, "Atmosphere plays Seq's steps");
    assert!(s.atmos_hz(at).unwrap() > 100.0);
}

/// One of MGL's own (ui/sequencer/presets.json).
fn mgl_preset() -> Value {
    let all: Value = serde_json::from_str(include_str!("../../../ui/sequencer/presets.json")).unwrap();
    all[0].clone()
}

#[test]
fn mgls_presets_load_as_the_page_loads_them_and_come_back_in_its_shape() {
    let (mut s, _audio) = session();
    let seq = canvas(&mut s);
    let p = mgl_preset();
    let n = s.load_seq_preset(seq, &p).unwrap();
    assert!(n > 20, "{n}");
    let st = s.seq_state(seq).unwrap();
    let state = &p["state"];
    for (id, v) in state["sliders"].as_object().unwrap() {
        let k = id.strip_suffix("Slider").unwrap();
        if engine_app::seq_part::SLIDERS.contains(&k) {
            assert_eq!(st[k].as_f64().unwrap(), v.as_str().unwrap().parse::<f64>().unwrap(), "{k}");
        }
    }
    for (id, v) in state["selects"].as_object().unwrap() {
        let k = id.strip_suffix("Select").unwrap();
        if engine_app::seq_part::SELECTS.contains(&k) {
            assert_eq!(st[k], *v, "{k}");
        }
    }
    assert_eq!(st["scale"], state["scaleIdx"]);
    for (i, step) in state["steps"].as_array().unwrap().iter().enumerate().take(64) {
        assert_eq!(st["pattern"][i], json!([step["degree"], step["rest"]]), "step {i}");
    }
    // Saved again: the page's shape, what Seq does not play kept as it came.
    let back = s.seq_preset(seq, "again").unwrap();
    assert_eq!(back["name"], "again");
    let b = &back["state"];
    assert_eq!(b["scaleIdx"], state["scaleIdx"]);
    for (id, v) in state["sliders"].as_object().unwrap() {
        if id == "morphTimeSlider" || id == "perfVarSlider" {
            continue;
        }
        let got = b["sliders"][id].as_str().map(|x| x.parse::<f64>().unwrap());
        assert_eq!(got, v.as_str().map(|x| x.parse::<f64>().unwrap()), "{id}");
    }
    for (id, v) in state["selects"].as_object().unwrap() {
        assert_eq!(b["selects"][id], *v, "{id}");
    }
    // And loaded into another, it is the same state.
    let seq2 = s.add("seq", 0.0, 1200.0).unwrap();
    s.load_seq_preset(seq2, &back).unwrap();
    let mut a = s.seq_state(seq).unwrap();
    let mut c = s.seq_state(seq2).unwrap();
    a["name"] = Value::Null;
    c["name"] = Value::Null;
    assert_eq!(a, c);
}

#[test]
fn a_canvas_with_seq_saved_and_loaded_plays_the_same() {
    let (mut s, mut audio) = session();
    let seq = canvas(&mut s);
    for (k, v) in [("cutoff", json!(45)), ("wave", json!("sawtooth")), ("dir", json!("ping")), ("bpm", json!(140)), ("scale", json!(22)), ("step2", json!(9)), ("lfo3Target", json!("volume")), ("lfo3Depth", json!(40))] {
        s.seq_set(seq, k, &v).unwrap();
    }
    let file = s.save();
    let saved = s.seq_state(seq).unwrap();
    s.seq_set(seq, "play", &json!(true)).unwrap();
    let first = play(&mut s, &mut audio, 300);

    let (mut t, mut audio2) = session();
    t.load(&serde_json::from_str(&file.to_string()).unwrap()).unwrap();
    assert_eq!(t.save(), file);
    assert_eq!(t.seq_state(seq).unwrap(), saved);
    t.seq_set(seq, "play", &json!(true)).unwrap();
    let second = play(&mut t, &mut audio2, 300);
    assert!(peak(&first) > 1e-3);
    assert_same("loaded", &first, &second);
}

#[test]
fn nothing_on_the_audio_thread_allocates_while_seq_plays_and_changes() {
    assert_the_check_is_on();
    let (mut s, mut audio) = session();
    let seq = canvas(&mut s);
    s.seq_set(seq, "play", &json!(true)).unwrap();
    render(&mut audio, 4_096, BLOCK);
    s.collect();
    let before = counted();
    for b in 0..120 {
        match b {
            5 => s.seq_set(seq, "cutoff", &json!(30)).unwrap(),
            10 => s.seq_set(seq, "bpm", &json!(90)).unwrap(),
            15 => s.seq_set(seq, "wave", &json!("pulse")).unwrap(),
            20 => s.seq_set(seq, "delayTime", &json!("1")).unwrap(),
            25 => s.seq_set(seq, "lfo2Wave", &json!("sawtooth")).unwrap(),
            30 => s.seq_set(seq, "scale", &json!(30)).unwrap(),
            35 => s.seq_set(seq, "step1", &json!(5)).unwrap(),
            40 => s.seq_set(seq, "preview", &json!(330.0)).unwrap(),
            45 => s.note(seq, true, 64, 0.7).map(|_| ()).unwrap(),
            60 => s.note(seq, false, 64, 0.0).map(|_| ()).unwrap(),
            _ => {}
        }
        render(&mut audio, BLOCK, BLOCK);
        s.collect();
    }
    assert_eq!(counted() - before, 0, "allocations or frees inside a render; the last sizes: {:?}", last_sizes());
}
