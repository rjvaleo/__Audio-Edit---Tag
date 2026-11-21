//! Atmosphere on the canvas: it plays; its keys sound at the page's pitch in
//! the page's own tuning; a model card and the big knob do what the page's
//! do; its state saves and loads; its FX line is the rack the page lays; and
//! nothing on the audio thread allocates.

#[path = "../../engine-mgl/tests/common/mod.rs"]
mod common;
use common::*;
use engine_app::{atmos_part, Session};
use engine_core::*;
use engine_mgl::{Atmos, Tuning};
use serde_json::{json, Value};

const BLOCK: usize = 256;

fn session() -> (Session, AudioEngine) {
    Session::with_config(RATE, exact())
}

/// MIDI in into Atmosphere into Output; returns (midi, atmos).
fn canvas(s: &mut Session) -> (u32, u32) {
    let midi = s.add("midi-in", 0.0, 0.0).unwrap();
    let at = s.add("atmos", 300.0, 0.0).unwrap();
    let out = s.add("output", 1900.0, 0.0).unwrap();
    s.connect((midi, 0), (at, 0)).unwrap();
    s.connect((at, 0), (out, 0)).unwrap();
    (midi, at)
}

fn play(s: &mut Session, audio: &mut AudioEngine, midi: u32, blocks: usize) -> Vec<f32> {
    let mut out = Vec::new();
    for b in 0..blocks {
        match b {
            2 => s.midi(midi, &[0x90, 60, 100]).unwrap(),
            12 => s.midi(midi, &[0x90, 64, 90]).unwrap(),
            50 => s.midi(midi, &[0x80, 60, 0]).unwrap(),
            70 => s.midi(midi, &[0x80, 64, 0]).unwrap(),
            _ => {}
        }
        let (l, r) = render(audio, BLOCK, BLOCK);
        out.extend(l.iter().zip(&r).flat_map(|(a, b)| [*a, *b]));
        s.collect();
    }
    out
}

/// The page's `atKeyHz`, line for line (atmos.js, "ITS OWN TUNING").
fn at_key_hz(cents: &[f64], root_midi: f64, k: f64) -> f64 {
    let root_hz = 440.0 * 2f64.powf((root_midi - 69.0) / 12.0);
    let diff = (k - root_midi) * 100.0;
    let oct = (diff / 1200.0).floor();
    let (mut best, mut dist) = (diff, 50.0);
    for o in [oct - 1.0, oct, oct + 1.0] {
        for c in cents {
            let s = c + o * 1200.0;
            let d = (diff - s).abs();
            if d < dist {
                dist = d;
                best = s;
            }
        }
    }
    root_hz * 2f64.powf(best / 1200.0)
}

fn page_scale(i: usize) -> Vec<f64> {
    let page: Value = serde_json::from_str(atmos_part::PAGE_JSON).unwrap();
    page["scales"][i]["cents"].as_array().unwrap().iter().map(|c| c.as_f64().unwrap()).collect()
}

/// A scale of the page's that is not 12-TET.
fn just_scale() -> usize {
    let page: Value = serde_json::from_str(atmos_part::PAGE_JSON).unwrap();
    page["scales"].as_array().unwrap().iter().position(|s| s["cents"].as_array().unwrap().iter().any(|c| c.as_f64().unwrap() == 386.3)).unwrap()
}

#[test]
fn it_plays_from_its_keys_and_from_midi() {
    let (mut s, mut audio) = session();
    let (midi, at) = canvas(&mut s);
    let heard = play(&mut s, &mut audio, midi, 90);
    assert!(peak(&heard) > 1e-3, "MIDI in plays Atmosphere: {}", peak(&heard));
    s.note(at, true, 67, 0.8).unwrap();
    let (l, _) = render(&mut audio, 16_384, BLOCK);
    assert!(peak(&l) > 1e-3, "its keys play it");
    let mut v = [0.0; 32];
    assert_eq!(s.atmos_view(at, 0, &mut v).unwrap(), Some(0), "oscillator A is the pluck");
    let mut scope = vec![0.0; 2048];
    assert_eq!(s.atmos_scope(at, &mut scope).unwrap(), 2048);
    assert!(peak(&scope) > 1e-4, "the scope sees it");
    assert_eq!(controller_bad(&mut s), 0);
}

fn controller_bad(s: &mut Session) -> u64 {
    s.controller().bad_blocks()
}

#[test]
fn keys_sound_where_the_page_puts_them_in_its_own_tuning() {
    let (mut s, _audio) = session();
    let at = s.add("atmos", 0.0, 0.0).unwrap();
    let just = just_scale();
    s.atmos_set(at, "tuneScale", &json!(just.to_string())).unwrap();
    s.atmos_set(at, "tuneRoot", &json!("2")).unwrap();
    s.atmos_set(at, "tuneOct", &json!(3)).unwrap();
    let state = s.atmos_state(at).unwrap();
    assert_eq!(state["tuneOct"], "3");
    let mut part = engine_app::AtmosPart::new(Some(&state)).unwrap();
    let t = part.tuning_now();
    let cents = page_scale(just);
    let root = 2.0 + 4.0 * 12.0;
    assert_eq!(t.root_midi, root);
    for k in [38, 40, 41, 42, 45, 50, 52, 61, 64, 70, 76] {
        let want = at_key_hz(&cents, root, k as f64);
        assert!((t.key_hz(k as f64) - want).abs() < 1e-9, "key {k}: {} against the page's {want}", t.key_hz(k as f64));
    }
    // A third above the root is the scale's 386.3 cents, not 400.
    assert!((t.key_hz(root + 4.0) / t.root_hz() - 2f64.powf(386.3 / 1200.0)).abs() < 1e-9);
    // And "Same as Seq" is A 440, 12-TET for Ionian.
    let plain = Tuning::default();
    for k in 40..90 {
        assert!((plain.key_hz(k as f64) - 440.0 * 2f64.powf((k as f64 - 69.0) / 12.0)).abs() < 1e-9);
    }

    // The voice built for the canvas plays each note at that pitch, its Fit
    // on the scale: what the synth plays given the page's hz by hand.
    let notes: Vec<(u64, NoteEvent)> =
        [50u8, 52, 54, 57].iter().enumerate().flat_map(|(i, k)| [(100 + 4_000 * i as u64, NoteEvent::on(*k, 0.8)), (3_000 + 4_000 * i as u64, NoteEvent::off(*k))]).collect();
    let voice = part.voice_module(RATE);
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Script::new(notes.clone()))).unwrap();
    ctl.add(2, Box::new(voice)).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    let (ours, _) = render(&mut audio, 20_096, 128);

    let mut synth = atmos::Synth::new(RATE);
    for (k, v) in part.voice_params() {
        synth.set(k, v);
    }
    synth.set_scale(&cents.iter().map(|c| *c as f32).collect::<Vec<_>>());
    let mut by_hand = vec![0.0; 20_096];
    let mut r = vec![0.0; 20_096];
    let mut next = 0;
    for at in (0..20_096).step_by(128) {
        while next < notes.len() && (notes[next].0 as usize) < at + 128 {
            let (frame, n) = notes[next];
            let delay = (frame as usize - at) as u32;
            match n.kind {
                NoteKind::On => synth.note_on(n.note as i32, at_key_hz(&cents, root, n.note as f64) as f32, n.velocity, delay),
                _ => synth.note_off(n.note as i32, delay),
            }
            next += 1;
        }
        synth.render(&mut by_hand[at..at + 128], &mut r[at..at + 128]);
    }
    assert!(peak(&by_hand) > 1e-3);
    assert_same("the voice in the page's tuning", &by_hand, &ours);
    let _ = Atmos::new(RATE);
}

#[test]
fn a_model_card_sets_its_defaults_and_the_big_knob_opens_the_rest() {
    let (mut s, _audio) = session();
    let at = s.add("atmos", 0.0, 0.0).unwrap();
    s.atmos_set(at, "atMB1", &json!(3)).unwrap();
    s.atmos_set(at, "modelB", &json!("reed")).unwrap();
    let st = s.atmos_state(at).unwrap();
    assert_eq!(st["modelB"], "reed");
    assert_eq!([&st["atMB1"], &st["atMB2"], &st["atMB3"], &st["atMB4"]], [&json!(60.0), &json!(50.0), &json!(50.0), &json!(10.0)]);
    s.atmos_set(at, "atMacro", &json!(25)).unwrap();
    let st = s.atmos_state(at).unwrap();
    let lerp = |a: f64, b: f64| (a + (b - a) * 0.25f64).round();
    assert_eq!(st["atMacro"], 25.0);
    assert_eq!(st["atWidth"].as_f64(), Some(lerp(30.0, 100.0)));
    assert_eq!(st["atDrift"].as_f64(), Some(lerp(10.0, 60.0)));
    assert_eq!(st["atHold"].as_f64(), Some(lerp(100.0, 300.0)));
    assert_eq!(st["atAir"].as_f64(), Some(lerp(0.0, 40.0)));
    assert_eq!(st["atEns"].as_f64(), Some(lerp(10.0, 60.0)));
    // Unknown keys are ignored; a knob is held in its range, at a whole step.
    s.atmos_set(at, "midi", &json!(1)).unwrap();
    s.atmos_set(at, "atAtk", &json!(140.4)).unwrap();
    assert_eq!(s.atmos_state(at).unwrap()["atAtk"], 100.0);
    // The voice is told as atphysParams says.
    let part = engine_app::AtmosPart::new(Some(&s.atmos_state(at).unwrap())).unwrap();
    let kv: std::collections::HashMap<_, _> = part.voice_params().into_iter().collect();
    assert_eq!(kv["b.model"], 7.0);
    assert_eq!(kv["b.p0"], 0.6);
    assert_eq!(kv["unison"], 3.0, "Math.min(3, unison)");
    assert!((kv["atk"] - 10.0).abs() < 1e-6, "atExp(100, 1, 10000) / 1000");
    assert!((kv["flt.cut"] - 20000.0).abs() < 1e-2);
}

fn plate() -> Value {
    json!([{ "kind": "prism:dattorro-plate", "on": true, "params": {}, "wet": 100, "level": 0 }])
}

#[test]
fn the_fx_line_is_the_chain_the_page_lays() {
    let kinds = engine_app::fx_kinds_json();
    assert!(kinds["shapers"]["prism:dattorro-plate"]["params"].as_array().is_some_and(|p| !p.is_empty()));
    let listed = kinds["suites"].as_array().unwrap().iter().flat_map(|s| s["families"].as_array().unwrap()).flat_map(|f| f["modes"].as_array().unwrap()).count();
    assert!(listed > 10, "{listed} effects offered");

    let run = |fx: Option<Value>, tweak: bool| {
        let (mut s, mut audio) = session();
        let (midi, at) = canvas(&mut s);
        if let Some(fx) = fx {
            s.atmos_set(at, "fx", &fx).unwrap();
        }
        if tweak {
            s.atmos_set(at, "fx.0.wet", &json!(40)).unwrap();
            s.atmos_set(at, "fx.0.on", &json!(false)).unwrap();
            let st = s.atmos_state(at).unwrap();
            assert_eq!(st["fx"][0]["wet"], 40.0);
            assert_eq!(st["fx"][0]["on"], false);
        }
        let out = play(&mut s, &mut audio, midi, 90);
        let (_, slots) = s.atmos_fx_meter(at).unwrap();
        (out, slots)
    };
    // A control of the running rack moves it, laid or not.
    let live = |decay: Option<f64>| {
        let (mut s, mut audio) = session();
        let (midi, at) = canvas(&mut s);
        s.atmos_set(at, "fx", &plate()).unwrap();
        let mut out = Vec::new();
        for b in 0..90 {
            if b == 20 {
                if let Some(d) = decay {
                    s.atmos_set(at, "fx.0.decay", &json!(d)).unwrap();
                }
            }
            if b == 2 {
                s.midi(midi, &[0x90, 60, 100]).unwrap();
            }
            out.extend(render(&mut audio, BLOCK, BLOCK).0);
        }
        assert_eq!(s.atmos_state(at).unwrap()["fx"][0]["params"]["decay"].as_f64(), decay);
        out
    };
    let (a, b) = (live(None), live(Some(0.1)));
    let at = first_difference(&a, &b).expect("the decay moved the plate");
    assert!(at >= 20 * BLOCK, "nothing changed before it moved (first difference at {at})");
    let (dry, none) = run(None, false);
    let (wet, slots) = run(Some(plate()), false);
    assert!(none.is_empty());
    assert_eq!(slots.len(), 1);
    assert!(slots[0].0 > 0.0, "the slot is metered");
    assert!(first_difference(&dry, &wet).is_some(), "the plate changes the sound");
    let dry_tail: f32 = dry[dry.len() - 8_000..].iter().map(|x| x * x).sum();
    let wet_tail: f32 = wet[wet.len() - 8_000..].iter().map(|x| x * x).sum();
    assert!(wet_tail > dry_tail, "the plate rings on: {wet_tail} against {dry_tail}");
    // Switched off from the start, it passes the sound as the empty line does.
    let (off, _) = run(Some(plate()), true);
    assert_same("a slot switched off", &dry, &off);
    // An unknown kind is left out, as the page's worklet leaves it out.
    let (unknown, _) = run(Some(json!([{ "kind": "nothing-at-all", "on": true, "params": {} }])), false);
    assert_same("an unknown kind", &dry, &unknown);
}

#[test]
fn a_canvas_with_atmosphere_saved_and_loaded_plays_the_same() {
    let (mut s, mut audio) = session();
    let (midi, at) = canvas(&mut s);
    s.atmos_set(at, "modelA", &json!("bell")).unwrap();
    s.atmos_set(at, "atL1Target", &json!("cutoff")).unwrap();
    s.atmos_set(at, "atL1Depth", &json!(40)).unwrap();
    s.atmos_set(at, "tuneScale", &json!(just_scale().to_string())).unwrap();
    s.atmos_set(at, "symTune", &json!("fifths")).unwrap();
    s.atmos_set(at, "fx", &plate()).unwrap();
    s.atmos_set(at, "fx.0.decay", &json!(0.3)).unwrap();
    let file = s.save();
    let saved = s.atmos_state(at).unwrap();
    assert_eq!(saved["fx"][0]["params"]["decay"], 0.3);
    let first = play(&mut s, &mut audio, midi, 90);

    let (mut t, mut audio2) = session();
    t.load(&serde_json::from_str(&file.to_string()).unwrap()).unwrap();
    assert_eq!(t.save(), file);
    assert_eq!(t.atmos_state(at).unwrap(), saved);
    assert_eq!(t.describe()["modules"].as_array().unwrap().iter().find(|m| m["kind"] == "atmos").unwrap()["atmos"], saved);
    let second = play(&mut t, &mut audio2, midi, 90);
    assert!(peak(&first) > 1e-3);
    assert_same("loaded", &first, &second);
}

#[test]
fn nothing_on_the_audio_thread_allocates_while_atmosphere_plays_and_changes() {
    assert_the_check_is_on();
    let (mut s, mut audio) = session();
    let (midi, at) = canvas(&mut s);
    s.atmos_set(at, "fx", &plate()).unwrap();
    render(&mut audio, 4_096, BLOCK);
    s.collect();
    let before = counted();
    for b in 0..80 {
        match b {
            1 => s.midi(midi, &[0x90, 60, 100]).unwrap(),
            5 => s.note(at, true, 64, 0.7).map(|_| ()).unwrap(),
            9 => s.atmos_set(at, "atFltCut", &json!(40)).unwrap(),
            12 => s.atmos_set(at, "atWarm", &json!(70)).unwrap(),
            15 => s.atmos_set(at, "atSymRing", &json!(80)).unwrap(),
            20 => s.atmos_set(at, "tuneScale", &json!(just_scale().to_string())).unwrap(),
            25 => s.atmos_set(at, "modelB", &json!("glass")).unwrap(),
            30 => s.atmos_set(at, "fx.0.wet", &json!(60)).unwrap(),
            35 => s.atmos_set(at, "fx.0.on", &json!(false)).unwrap(),
            40 => s.atmos_set(at, "fx", &json!([])).unwrap(),
            45 => s.atmos_set(at, "fx", &plate()).unwrap(),
            50 => s.midi(midi, &[0x80, 60, 0]).unwrap(),
            55 => s.note(at, false, 64, 0.0).map(|_| ()).unwrap(),
            _ => {}
        }
        render(&mut audio, BLOCK, BLOCK);
        s.collect();
    }
    assert_eq!(counted() - before, 0, "allocations or frees inside a render; the last sizes: {:?}", last_sizes());
}

#[test]
fn sympathy_rings_on_the_physical_voice_in_its_tuning() {
    let run = |sym: f64, tune: Option<&str>| {
        let (mut s, mut audio) = session();
        let (midi, at) = canvas(&mut s);
        s.atmos_set(at, "atSym", &json!(sym)).unwrap();
        if let Some(t) = tune {
            s.atmos_set(at, "symTune", &json!(t)).unwrap();
        }
        play(&mut s, &mut audio, midi, 90)
    };
    let none = run(0.0, None);
    let some = run(100.0, None);
    let root = run(100.0, Some("root"));
    assert!(first_difference(&none, &some).is_some(), "Sympathy is heard");
    assert!(first_difference(&some, &root).is_some(), "tuned to the root alone, it rings otherwise");
}
