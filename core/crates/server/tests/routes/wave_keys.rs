//! Wave, and the Grain page's keys.

use super::*;

// ------------------------------------------------------------------- wave

/// The Wave synth's routes (`wave_synth.rs`, `docs/WAVE-SYNTH.md`). None of
/// these open the audio device: `note` and `control` are the only ones that
/// do, and they are not called here.
fn wave_ok(app: &Arc<App>, r: Request) -> server::json::Value {
    let res = server::routes::route(app, &r);
    assert_eq!(status(&res), 200, "{} {}: {}", r.method, r.path, String::from_utf8_lossy(&res.body));
    json(&res)
}

pub(super) fn arr(v: &server::json::Value) -> Vec<server::json::Value> {
    v.arr().unwrap_or_else(|| panic!("not a list: {}", v.to_string())).to_vec()
}

#[test]
fn wave_patch_round_trips_and_persists() {
    let s = Scratch::new("wave-patch");
    let app = s.app();
    let p = wave_ok(&app, get("/api/wave/patch", &[]));
    assert_eq!(num(&p, &["params", "osc0.pos"]), 0.34);
    assert_eq!(text(&p, &["params", "osc0.table"]), "Formant Sweep");
    assert_eq!(arr(p.get("macroNames").unwrap()).len(), 8);
    assert_eq!(arr(p.get("mods").unwrap()).len(), 0, "Init moves nothing (v7)");
    assert_eq!(text(&p, &["params", "lfo0.shape"]), "sine");
    assert_eq!(num(&p, &["params", "tempo"]), 120.0);

    let body = r#"{"params":{"osc0.pos":0.7,"filt0.type":"hp","osc1.uni.n":7.6,"lfo2.points":[[0,0],[0.5,1],[1,0]],
        "lfo0.smooth":0.5,"lfo3.rise":0.25,"lfo1.shape":"steps","lfo1.sync":1,"tempo":96,"voice.mpe":1,"fx2.k1":0.9,"fx4.on":0},
        "mods":[{"src":"lfo1","dst":"osc0.pos","amt":0.4,"curve":"s","via":"mw"}],
        "macroNames":["A","B"],"name":"Test Pad","tags":"Pad · Warm"}"#;
    let back = wave_ok(&app, post("/api/wave/patch", body));
    assert_eq!(num(&back, &["params", "osc0.pos"]), 0.7);
    assert_eq!(num(&back, &["params", "osc1.uni.n"]), 8.0, "whole-number keys are rounded");
    assert_eq!(text(&back, &["params", "lfo1.shape"]), "steps");
    assert_eq!(num(&back, &["params", "lfo1.sync"]), 1.0);
    assert_eq!(num(&back, &["params", "tempo"]), 96.0);
    assert_eq!(text(&back, &["params", "filt0.type"]), "hp");
    assert_eq!(num(&back, &["params", "fx2.k1"]), 0.9);
    assert_eq!(text(&back, &["name"]), "Test Pad");
    let tags: Vec<String> = arr(back.get("tags").unwrap()).iter().map(|t| t.as_str().unwrap().to_string()).collect();
    assert_eq!(tags, ["Pad", "Warm"]);
    // Not given, so the default: a POST replaces the patch.
    assert_eq!(num(&back, &["params", "osc2.pos"]), 0.6);

    assert!(s.data.join("wave/patch.json").exists(), "saved to the data folder");
    // A fresh process reads it back.
    let again = wave_ok(&s.app(), get("/api/wave/patch", &[]));
    assert_eq!(again, back);
    let mods = arr(again.get("mods").unwrap());
    assert_eq!(mods.len(), 1);
    assert_eq!(text(&mods[0], &["via"]), "mw");
    assert_eq!(arr(again.get("params").unwrap().get("lfo2.points").unwrap()).len(), 3);
    assert_eq!(text(&arr(again.get("macroNames").unwrap())[1], &[]), "B");

    // The matrix on its own.
    let m = wave_ok(&app, post("/api/wave/mods", r#"{"mods":[{"src":"env1","dst":"filt0.cut","amt":2,"curve":"exp","via":null}]}"#));
    assert_eq!(num(&arr(m.get("mods").unwrap())[0], &["amt"]), 1.0, "clamped");
    let r = server::routes::route(&app, &post("/api/wave/mods", r#"{"mods":[{"src":"lfo9","dst":"filt0.cut","amt":0.1}]}"#));
    assert_eq!(status(&r), 400);
}

#[test]
fn a_live_wave_param_is_heard_and_not_stored() {
    let s = Scratch::new("wave-live");
    let app = s.app();
    let r = wave_ok(&app, post("/api/wave/param", r#"{"key":"filt0.cut","value":0.1,"live":true}"#));
    assert_eq!(num(&r, &["value"]), 0.1);
    let r = wave_ok(&app, post("/api/wave/param", r#"{"key":"osc0.warp0.mode","value":"fold","live":true}"#));
    assert_eq!(text(&r, &["value"]), "fold");
    let p = wave_ok(&app, get("/api/wave/patch", &[]));
    assert_eq!(num(&p, &["params", "filt0.cut"]), 0.55, "a live move is not stored");
    assert_eq!(text(&p, &["params", "osc0.warp0.mode"]), "bend");
    assert!(!s.data.join("wave/patch.json").exists(), "nor saved");

    let r = wave_ok(&app, post("/api/wave/param", r#"{"key":"filt0.cut","value":7}"#));
    assert_eq!(num(&r, &["value"]), 1.0, "clamped to the key's range");
    wave_ok(&app, post("/api/wave/param", r#"{"key":"lfo1.points","value":[[0.2,0.5],[0.9,1]]}"#));
    let p = wave_ok(&s.app(), get("/api/wave/patch", &[]));
    assert_eq!(num(&p, &["params", "filt0.cut"]), 1.0, "a committed move is stored and saved");
    let pts = arr(p.get("params").unwrap().get("lfo1.points").unwrap());
    assert_eq!(num(&arr(&pts[0])[0], &[]), 0.0, "the first point is pinned to x = 0");
    assert_eq!(num(&arr(&pts[1])[0], &[]), 1.0, "and the last to x = 1");
}

#[test]
fn unknown_wave_keys_are_refused_with_an_error() {
    let s = Scratch::new("wave-bad");
    let app = s.app();
    for (path, body) in [
        ("/api/wave/param", r#"{"key":"osc0.wobble","value":0.5}"#),
        ("/api/wave/param", r#"{"key":"osc0.pos","value":"high"}"#),
        ("/api/wave/param", r#"{"key":"filt0.type","value":"wah"}"#),
        ("/api/wave/param", r#"{"value":0.5}"#),
        ("/api/wave/patch", r#"{"params":{"nonsense":1}}"#),
        ("/api/wave/patch", r#"not json"#),
        ("/api/wave/table", r#"{"name":"x","frames":[[1,2,3]]}"#),
        ("/api/wave/table/import", r#"{"sound":"kit/none.wav","name":"x","mode":"granular"}"#),
    ] {
        let r = server::routes::route(&app, &post(path, body));
        assert_eq!(status(&r), 400, "{path} {body}: {}", String::from_utf8_lossy(&r.body));
        assert!(json(&r).get("error").and_then(|e| e.as_str()).is_some(), "{path}: an {{error}} body");
    }
    // The page's own extra keys are not unknown.
    for key in ["lfo0.smooth", "lfo3.rise", "voice.mpe", "fx0.on", "fx4.k2"] {
        wave_ok(&app, post("/api/wave/param", &format!(r#"{{"key":"{key}","value":0.5}}"#)));
    }
    let r = server::routes::route(&app, &get("/api/wave/nothing", &[]));
    assert_eq!(status(&r), 404);
}

#[test]
fn a_posted_table_is_saved_listed_and_previewed_at_256_points() {
    let s = Scratch::new("wave-table");
    let app = s.app();
    let list = wave_ok(&app, get("/api/wave/tables", &[]));
    assert_eq!(arr(&list).len(), 5, "the built-ins");
    let builtin = wave_ok(&app, get("/api/wave/table", &[("name", "Grit Saw")]));
    let frames = arr(builtin.get("frames").unwrap());
    assert_eq!(frames.len(), 64);
    assert!(frames.iter().all(|f| arr(f).len() == 256));

    let saw: Vec<String> = (0..4)
        .map(|k| format!("[{}]", (0..512).map(|i| format!("{:.4}", ((i * (k + 1)) % 512) as f32 / 256.0 - 1.0)).collect::<Vec<_>>().join(",")))
        .collect();
    let body = format!(r#"{{"name":"My Saw","frames":[{}]}}"#, saw.join(","));
    let r = wave_ok(&app, post("/api/wave/table", &body));
    assert_eq!(text(&r, &["name"]), "My Saw");
    let frames = arr(r.get("frames").unwrap());
    assert_eq!(frames.len(), 4);
    assert!(frames.iter().all(|f| arr(f).len() == 256), "256 points a frame");
    assert!(s.data.join("wave/tables/My Saw.wav").exists());

    let list = arr(&wave_ok(&app, get("/api/wave/tables", &[])));
    let mine = list.iter().find(|t| t.get("name").and_then(|n| n.as_str()) == Some("My Saw")).expect("listed");
    assert_eq!(num(mine, &["frames"]), 4.0);
    let back = wave_ok(&app, get("/api/wave/table", &[("name", "My Saw")]));
    assert_eq!(back.get("frames"), r.get("frames"), "the stored table reads back as it was previewed");

    // Given to an oscillator, it is built off the request thread and reaches
    // the synth deck when it is ready.
    wave_ok(&app, post("/api/wave/param", r#"{"key":"osc1.table","value":"My Saw"}"#));
    let mut reached = false;
    for _ in 0..500 {
        if app.wave.shared.current_tables()[1].as_ref().is_some_and(|t| t.frame_count() == 4) {
            reached = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    assert!(reached, "the table never reached oscillator B");

    // A built-in is never replaced: the edit is kept beside it.
    let r = wave_ok(&app, post("/api/wave/table", &body.replace("My Saw", "Grit Saw")));
    assert_eq!(text(&r, &["name"]), "Grit Saw (edited)");
    let r = server::routes::route(&app, &get("/api/wave/table", &[("name", "Nope")]));
    assert_eq!(status(&r), 404);
}

#[test]
fn a_library_sound_is_sliced_into_a_table() {
    let s = Scratch::new("wave-import");
    s.sound("kit/tone.wav", 44_100);
    s.sound("kit/blip.wav", 1_000);
    let app = s.app();
    let r = wave_ok(&app, post("/api/wave/table/import", r#"{"sound":"kit/tone.wav","name":"Tone","mode":"count","frames":16}"#));
    assert_eq!(text(&r, &["name"]), "Tone");
    let frames = arr(r.get("frames").unwrap());
    assert_eq!(frames.len(), 16);
    assert!(frames.iter().all(|f| arr(f).len() == 256));
    assert!(s.data.join("wave/tables/Tone.wav").exists());
    // Every mode the page sends is taken, sliced by count for now.
    for mode in ["note", "pitch", "spectral"] {
        let body = format!(r#"{{"sound":"kit/tone.wav","name":"Tone {mode}","mode":"{mode}","frames":8,"grain":true}}"#);
        assert_eq!(arr(wave_ok(&app, post("/api/wave/table/import", &body)).get("frames").unwrap()).len(), 8);
    }
    // Too short for 64 cycles: cut into pieces of at least 64 samples.
    let r = wave_ok(&app, post("/api/wave/table/import", r#"{"sound":"kit/blip.wav","name":"Blip","frames":64}"#));
    assert_eq!(arr(r.get("frames").unwrap()).len(), 1_000 / 64);
    let r = server::routes::route(&app, &post("/api/wave/table/import", r#"{"sound":"../escape.wav","frames":4}"#));
    assert_ne!(status(&r), 200);
}

#[test]
fn wave_presets_save_list_and_unlist_without_deleting() {
    let s = Scratch::new("wave-presets");
    let app = s.app();
    assert!(arr(&wave_ok(&app, get("/api/wave/presets", &[]))).is_empty());
    wave_ok(&app, post("/api/wave/presets", r#"{"name":"Bright","tags":["Lead"],"patch":{"params":{"filt0.cut":0.9}}}"#));
    wave_ok(&app, post("/api/wave/presets", r#"{"name":"Arp","tags":"Pluck · Bright"}"#));
    let list = arr(&wave_ok(&app, get("/api/wave/presets", &[])));
    let names: Vec<String> = list.iter().map(|p| text(p, &["name"])).collect();
    assert_eq!(names, ["Arp", "Bright"]);
    assert_eq!(num(&list[1], &["patch", "params", "filt0.cut"]), 0.9);
    assert_eq!(num(&list[0], &["patch", "params", "osc0.pos"]), 0.34, "no patch given: the stored one");

    let r = server::routes::route(&app, &post("/api/wave/presets", r#"{"name":"Bad","patch":{"params":{"nope":1}}}"#));
    assert_eq!(status(&r), 400);

    wave_ok(&app, post("/api/wave/presets", r#"{"name":"Bright","remove":true}"#));
    let names: Vec<String> = arr(&wave_ok(&app, get("/api/wave/presets", &[]))).iter().map(|p| text(p, &["name"])).collect();
    assert_eq!(names, ["Arp"], "unlisted");
    assert!(s.data.join("wave/presets/Bright.json").exists(), "remove means unlist, never delete");
    // Saved again, it is listed again.
    wave_ok(&app, post("/api/wave/presets", r#"{"name":"Bright","tags":[]}"#));
    assert_eq!(arr(&wave_ok(&app, get("/api/wave/presets", &[]))).len(), 2);
}

#[test]
fn wave_state_answers_with_no_device() {
    let s = Scratch::new("wave-state");
    let app = s.app();
    let t = wave_ok(&app, get("/api/wave/state", &[]));
    assert!(arr(t.get("voices").unwrap()).is_empty());
    assert_eq!(arr(t.get("pos").unwrap()).len(), 3);
    assert_eq!(arr(t.get("lfo").unwrap()).len(), 4);
    assert_eq!(arr(t.get("lfoPhase").unwrap()).len(), 4);
    assert_eq!(arr(t.get("peak").unwrap()).len(), 2);
    assert_eq!(arr(t.get("wave").unwrap()).len(), 256);
    assert!(t.get("mod").and_then(|m| m.as_obj()).is_some());
    assert!(!flag(&t, &["device"]));
    assert!(app.audio.lock().unwrap().is_none(), "no device was opened");
    let css = server::routes::route(&app, &get("/wave.css", &[]));
    assert_eq!(status(&css), 200);
    assert!(css.content_type.starts_with("text/css"));
}

// ---------------------------------------------------------------- the Grain page's keys

#[test]
fn the_voice_route_sets_the_keys_and_needs_no_device() {
    let s = Scratch::new("grain-voice");
    let app = s.app();
    assert!(app.grain_keys.run(), "Run is on until a page says otherwise");
    let r = server::routes::route(&app, &post("/api/engine/voice", r#"{"mode":"legato","glide":0.2,"bend":1.5,"attack":0.1,"decay":0.2,"sustain":0.5,"release":0.3,"run":false,"start":0.25,"replay":true}"#));
    assert_eq!(status(&r), 200);
    let k = &app.grain_keys;
    assert_eq!(k.mode(), engine::KeyMode::Legato);
    assert!(!k.run());
    assert!(k.replay());
    assert_eq!(k.amp(), (0.1, 0.2, 0.5, 0.3));
    assert_eq!((k.glide(), k.bend(), k.start()), (0.2, 1.5, 0.25));
    // Any part of it, the rest left alone.
    let r = server::routes::route(&app, &post("/api/engine/voice", r#"{"sustain":0.9}"#));
    assert_eq!(status(&r), 200);
    assert_eq!(k.amp(), (0.1, 0.2, 0.9, 0.3));
}

#[test]
fn the_voice_route_takes_the_pages_tuning_and_leaving_puts_things_back() {
    let s = Scratch::new("grain-tuning");
    let app = s.app();
    let table: Vec<String> = (0..128).map(|i| format!("{}", i as f32 * 0.5)).collect();
    let body = format!(r#"{{"keys":[{}],"run":false}}"#, table.join(","));
    assert_eq!(status(&server::routes::route(&app, &post("/api/engine/voice", &body))), 200);
    assert_eq!(app.grain_keys.key_semitones(10), 5.0);

    let r = server::routes::route(&app, &post("/api/engine/voice", r#"{"keys":[1,2,3]}"#));
    assert_eq!(status(&r), 400);
    let r = server::routes::route(&app, &post("/api/engine/voice", r#"{"mode":"chord"}"#));
    assert_eq!(status(&r), 400);

    assert_eq!(status(&server::routes::route(&app, &post("/api/engine/voice", r#"{"reset":true}"#))), 200);
    assert!(app.grain_keys.run());
    assert!(!app.grain_keys.replay());
}

#[test]
fn the_grain_page_says_when_it_is_in_front_and_when_it_has_gone() {
    let s = Scratch::new("grain-front");
    let app = s.app();
    assert!(!app.grain_keys.front());
    let r = server::routes::route(&app, &post("/api/engine/voice", r#"{"front":true,"bendRange":7}"#));
    assert_eq!(status(&r), 200);
    assert!(app.grain_keys.front());
    assert_eq!(status(&server::routes::route(&app, &post("/api/engine/voice", r#"{"reset":true}"#))), 200);
    assert!(!app.grain_keys.front());
}

#[test]
fn the_midi_route_says_what_the_keyboard_is_holding() {
    let s = Scratch::new("grain-midi");
    let app = s.app();
    app.midi.route(server::midi::parse(&[0x91, 60, 127]).unwrap(), 1);
    let v = json(&server::routes::route(&app, &get("/api/engine/midi", &[])));
    assert_eq!(v.get("notes").map(|n| n.to_string()), Some("[60]".to_string()));
    assert_eq!(v.get("bend"), Some(&server::json::Value::Num(0.0)));
}

#[test]
fn each_instrument_is_given_its_own_midi_channel() {
    use server::midi::Instrument;
    let s = Scratch::new("grain-midi-channels");
    let app = s.app();
    let v = json(&server::routes::route(&app, &post("/api/engine/midi", r#"{"wave":3,"grain":9}"#)));
    assert_eq!(v.get("wave"), Some(&server::json::Value::Num(3.0)));
    assert_eq!(v.get("grain"), Some(&server::json::Value::Num(9.0)));
    assert_eq!(app.midi.channel(Instrument::Wave), 3);
    assert_eq!(app.midi.channel(Instrument::Grain), 9);
    assert_eq!(status(&server::routes::route(&app, &post("/api/engine/midi", r#"{"grain":17}"#))), 400);
    assert_eq!(app.midi.channel(Instrument::Grain), 9);
}

/// What `/api/engine/lfos` says a control is sounding at, after one runner tick.
fn lfo_tick(app: &std::sync::Arc<App>, runner: &mut server::grain_lfos::Runner) -> server::json::Value {
    runner.advance(app);
    runner.idle(app);
    json(&server::routes::route(app, &get("/api/engine/lfos", &[])))
}

#[test]
fn an_lfo_is_heard_and_never_written_to_the_document() {
    let s = Scratch::new("grain-lfos");
    s.sound("kit/a.wav", 8000);
    let app = s.app();
    assert_eq!(status(&server::routes::route(&app, &post("/api/edit", r#"{"p":"kit/a.wav","op":"stretch","ratio":2.0,"semitones":0,"windowMs":40,"quality":"standard","grain":{"panSpread":0.5}}"#))), 200);
    let before = app.edits.snapshot("kit/a.wav").unwrap();

    let body = r#"{"p":"kit/a.wav","lfos":[{"shape":"square","hz":0.001,"depth":0.25,"targets":[{"t":"stretch.grain.panSpread"}]}]}"#;
    assert_eq!(status(&server::routes::route(&app, &post("/api/engine/lfos", body))), 200);

    let mut runner = server::grain_lfos::Runner::default();
    let v = lfo_tick(&app, &mut runner);
    let heard = v.get("heard").and_then(|h| h.get("stretch.grain.panSpread").cloned());
    assert!(matches!(heard, Some(server::json::Value::Num(n)) if (n - 0.75).abs() < 1e-3), "{heard:?}");

    // Nothing about the document moved, undo included.
    let after = app.edits.snapshot("kit/a.wav").unwrap();
    assert_eq!(before.stretch, after.stretch, "the LFO wrote into the document");
    assert_eq!(app.edits.with("kit/a.wav", || before.clone(), |s| s.can_redo()), false);

    // Off: no longer heard, and still exactly what the document had.
    assert_eq!(status(&server::routes::route(&app, &post("/api/engine/lfos", r#"{"off":true}"#))), 200);
    let v = lfo_tick(&app, &mut runner);
    assert!(v.get("heard").unwrap().as_obj().unwrap().is_empty());
    assert_eq!(app.edits.snapshot("kit/a.wav").unwrap().stretch, before.stretch);
}

#[test]
fn an_each_note_lfo_restarts_when_a_key_goes_down() {
    let s = Scratch::new("grain-lfo-note");
    s.sound("kit/a.wav", 8000);
    let app = s.app();
    let body = r#"{"p":"kit/a.wav","lfos":[{"shape":"sine","hz":100,"mode":"trig","depth":0.5,"targets":[]},{"shape":"sine","hz":100,"depth":0.5,"targets":[]}]}"#;
    assert_eq!(status(&server::routes::route(&app, &post("/api/engine/lfos", body))), 200);
    let mut runner = server::grain_lfos::Runner::default();
    let phase = |v: &server::json::Value, i: usize| match v.get("lfos").unwrap().arr().unwrap()[i].get("phase") {
        Some(server::json::Value::Num(n)) => *n,
        _ => panic!("no phase"),
    };
    std::thread::sleep(std::time::Duration::from_millis(30));
    let v = lfo_tick(&app, &mut runner);
    assert!(phase(&v, 0) > 0.5 && phase(&v, 1) > 0.5);
    let free_was = phase(&v, 1);
    app.grain_keys.note_on(60, 0.8);
    let v = lfo_tick(&app, &mut runner);
    assert_eq!(phase(&v, 0), 0.0, "Each note did not restart at the key");
    assert!(phase(&v, 1) >= free_was, "Free was restarted by a key");
}

#[test]
fn lfo_settings_are_checked_and_what_cannot_move_live_is_refused() {
    let s = Scratch::new("grain-lfo-bad");
    let app = s.app();
    assert_eq!(status(&server::routes::route(&app, &post("/api/engine/lfos", "nonsense"))), 400);
    assert_eq!(status(&server::routes::route(&app, &post("/api/engine/lfos", r#"{"lfos":[]}"#))), 400);
    assert_eq!(status(&server::routes::route(&app, &post("/api/engine/lfos", r#"{"p":"x","lfos":[{"shape":"zigzag"}]}"#))), 400);
    let v = json(&server::routes::route(&app, &post("/api/engine/lfos", r#"{"p":"x","lfos":[{"shape":"sine","targets":[{"t":"stretch.hybrid.fftSize"},{"t":"stretch.wsola.floor"},{"t":"stretch.grain.scan"}]}]}"#)));
    assert_eq!(v.get("refused").unwrap().arr().unwrap().len(), 2);
    let got = json(&server::routes::route(&app, &get("/api/engine/lfos", &[])));
    assert!(got.get("refuse").unwrap().get("stretch.hybrid.fftSize").is_some(), "the page reads why from here");
}

#[test]
fn a_note_outside_the_keyboard_is_refused_before_any_device_is_opened() {
    let s = Scratch::new("grain-note");
    let app = s.app();
    assert_eq!(status(&server::routes::route(&app, &post("/api/engine/note", r#"{"key":128}"#))), 400);
    assert_eq!(status(&server::routes::route(&app, &post("/api/engine/note", r#"{"velocity":1}"#))), 400);
    assert_eq!(status(&server::routes::route(&app, &post("/api/engine/note", "nonsense"))), 400);
}

/// `/audio?dry=1`: the Grain page's pictures are of the material, so an active
/// rack must not reach them, and the plain route must go on rendering through it.
#[test]
fn dry_audio_is_the_material_and_the_plain_route_still_has_the_rack() {
    let s = Scratch::new("dry-audio");
    s.sound("kit/a.wav", 20_000);
    let app = s.app();
    let plain = server::routes::route(&app, &get("/audio", &[("p", "kit/a.wav")]));
    let r = server::routes::route(
        &app,
        &post("/api/rack", r#"{"p":"kit/a.wav","sr":44100,"slots":[{"kind":"gain","id":"g1","db":-12}],"master":{"on":false}}"#),
    );
    assert_eq!(status(&r), 200);
    let racked = server::routes::route(&app, &get("/audio", &[("p", "kit/a.wav")]));
    let dry = server::routes::route(&app, &get("/audio", &[("p", "kit/a.wav"), ("dry", "1")]));
    assert_eq!(status(&dry), 200);
    assert_eq!(dry.body, plain.body, "the dry route played the rack");
    assert_ne!(racked.body, plain.body, "the plain route stopped rendering through the rack");
}

/// With edits it is the clips, the timeline the cue and the loop are counted
/// on: a cut shows, the stretch and the rack do not.
#[test]
fn dry_audio_follows_the_clips_and_ignores_the_stretch_and_the_rack() {
    let s = Scratch::new("dry-clips");
    s.sound("kit/a.wav", 20_000);
    let app = s.app();
    assert_eq!(status(&server::routes::route(&app, &post("/api/edit", r#"{"p":"kit/a.wav","op":"cut","start":0,"end":5000}"#))), 200);
    server::routes::route(&app, &post("/api/edit", r#"{"p":"kit/a.wav","op":"stretch","ratio":2}"#));
    server::routes::route(
        &app,
        &post("/api/rack", r#"{"p":"kit/a.wav","sr":44100,"slots":[{"kind":"gain","id":"g1","db":-12}],"master":{"on":false}}"#),
    );
    let dry = server::routes::route(&app, &get("/audio", &[("p", "kit/a.wav"), ("dry", "1")]));
    assert_eq!(status(&dry), 200);
    let header = audio_core::wav::HEADER_LEN as usize;
    assert_eq!(dry.body.len() - header, 15_000 * 2, "not the cut timeline, unstretched");
    // The rack would have taken this to a quarter of what the file holds.
    let at = |b: &[u8], i: usize| i16::from_le_bytes([b[i * 2], b[i * 2 + 1]]) as i32;
    let want = ((5_047f32 / 30.0).sin() * 9000.0) as i32;
    assert!((at(&dry.body[header..], 47) - want).abs() <= 2, "the samples are not the file's");
}

#[test]
fn a_mod_row_switched_off_is_stored_listed_and_counted() {
    let s = Scratch::new("wave-mod-off");
    let app = s.app();
    let m = wave_ok(&app, post("/api/wave/mods", r#"{"mods":[{"src":"lfo0","dst":"osc0.pos","amt":0.4,"on":false},{"src":"lfo1","dst":"filt0.cut","amt":0.2}]}"#));
    let rows = arr(m.get("mods").unwrap());
    assert!(!flag(&rows[0], &["on"]), "kept, and off");
    assert!(flag(&rows[1], &["on"]), "a row sent without a switch is on");
    // Saved, and read back by a fresh process.
    let p = wave_ok(&s.app(), get("/api/wave/patch", &[]));
    assert!(!flag(&arr(p.get("mods").unwrap())[0], &["on"]));
    // A whole patch keeps it too.
    let back = wave_ok(&app, post("/api/wave/patch", &p.to_string()));
    assert!(!flag(&arr(back.get("mods").unwrap())[0], &["on"]));
    // Not a switch.
    let r = server::routes::route(&app, &post("/api/wave/mods", r#"{"mods":[{"src":"lfo0","dst":"osc0.pos","amt":0.4,"on":"no"}]}"#));
    assert_eq!(status(&r), 400);
    // The 64-row limit counts the rows that are off.
    let row = r#"{"src":"lfo0","dst":"osc0.pos","amt":0.1,"on":false}"#;
    let rows = |n: usize| format!(r#"{{"mods":[{}]}}"#, vec![row; n].join(","));
    wave_ok(&app, post("/api/wave/mods", &rows(64)));
    let r = server::routes::route(&app, &post("/api/wave/mods", &rows(65)));
    assert_eq!(status(&r), 400);
}

#[test]
fn choice_keys_are_mod_targets_and_a_table_row_builds_the_bank() {
    let s = Scratch::new("wave-mod-choice");
    let app = s.app();
    let body = r#"{"mods":[{"src":"lfo0","dst":"osc0.warp0.mode","amt":0.5},{"src":"vel","dst":"filt1.type","amt":-0.3},
        {"src":"mw","dst":"filt.route","amt":1},{"src":"lfo1","dst":"lfo2.shape","amt":0.25},{"src":"macro0","dst":"osc2.fx.mode","amt":0.4}]}"#;
    let m = wave_ok(&app, post("/api/wave/mods", body));
    assert_eq!(arr(m.get("mods").unwrap()).len(), 5);
    assert_eq!(text(&arr(m.get("mods").unwrap())[2], &["dst"]), "filt.route");
    // Not targets: what decides voices or what an LFO is.
    for dst in ["voice.mode", "osc0.route", "lfo0.mode", "osc3.table", "filt2.type"] {
        let r = server::routes::route(&app, &post("/api/wave/mods", &format!(r#"{{"mods":[{{"src":"lfo0","dst":"{dst}","amt":0.5}}]}}"#)));
        assert_eq!(status(&r), 400, "{dst} is not a target");
    }
    assert!(app.wave.shared.current_bank().iter().all(Option::is_none), "no table row, no bank");
    // A row onto a table builds the five built-ins for the engine.
    wave_ok(&app, post("/api/wave/mods", r#"{"mods":[{"src":"lfo0","dst":"osc1.table","amt":0.5}]}"#));
    let mut bank = app.wave.shared.current_bank();
    for _ in 0..200 {
        if bank.iter().all(Option::is_some) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
        bank = app.wave.shared.current_bank();
    }
    assert!(bank.iter().all(Option::is_some), "the bank's built-ins were handed to the engine");
}
