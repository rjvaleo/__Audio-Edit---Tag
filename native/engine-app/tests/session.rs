//! The app's side: Wave on the canvas plays what Wave plays when built by
//! hand; a knob and a choice reach it as MGL sends them; a canvas saved and
//! loaded plays the same, sample for sample; MGL's own Wave files open; and
//! nothing on the audio thread allocates.

#[path = "../../engine-mgl/tests/common/mod.rs"]
mod common;
use common::*;
use engine_app::{controls, wave_patch, Control, Session};
use engine_core::*;
use serde_json::Value;
use std::sync::Arc;
use wave::{BoardPlan, Patch, PatchState, Wavetable, KEYS, NUM_PARAMS, STR_KEYS};

const BLOCK: usize = 256;

/// A table as MGL saves one (`server-core/src/wave_synth/tables.rs`
/// `table_wav`): a mono 32-bit float WAV with a `clm ` chunk.
fn table_wav(frames: &[Vec<f32>]) -> Vec<u8> {
    let len = frames[0].len();
    let mut clm = format!("<!>{len} 10000000 wavetable (MultiGrainLive)").into_bytes();
    if clm.len() % 2 == 1 {
        clm.push(0);
    }
    let data: Vec<u8> = frames.iter().flatten().flat_map(|v| v.to_le_bytes()).collect();
    let mut out = Vec::new();
    let riff = 4 + (8 + 16) + (8 + clm.len()) + (8 + data.len());
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(riff as u32).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&3u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&48_000u32.to_le_bytes());
    out.extend_from_slice(&(48_000u32 * 4).to_le_bytes());
    out.extend_from_slice(&4u16.to_le_bytes());
    out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(b"clm ");
    out.extend_from_slice(&(clm.len() as u32).to_le_bytes());
    out.extend_from_slice(&clm);
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(&data);
    out
}

/// The frames the saved table stands in for: the preset names a table RJ
/// made from a sound ("hal sez..."), which stays out of the repository; a
/// built-in's frames stand in for it, saved as MGL saves a table.
fn stand_in() -> Vec<Vec<f32>> {
    wave::builtin_frames("Grit Saw").unwrap().into_iter().take(16).collect()
}

/// A folder of saved tables, as MGL keeps `data/wave/tables`.
fn tables() -> std::path::PathBuf {
    let dir = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("engine-app-tables");
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("hal sez....wav");
    let bytes = table_wav(&stand_in());
    if std::fs::read(&file).ok().as_deref() != Some(&bytes[..]) {
        let part = dir.join(format!("hal sez....{}.part", std::process::id()));
        std::fs::write(&part, &bytes).unwrap();
        std::fs::rename(part, &file).unwrap();
    }
    dir
}

fn session() -> (Session, AudioEngine) {
    engine_app::set_table_dirs(vec![tables()]);
    Session::with_config(RATE, exact())
}

/// MIDI in into Wave into Output; returns (midi, wave, output).
fn canvas(s: &mut Session) -> (u32, u32, u32) {
    let midi = s.add("midi-in", 0.0, 0.0).unwrap();
    let wave = s.add("wave", 300.0, 0.0).unwrap();
    let out = s.add("output", 1800.0, 0.0).unwrap();
    s.connect((midi, 0), (wave, 0)).unwrap();
    s.connect((wave, 0), (out, 0)).unwrap();
    s.settle();
    (midi, wave, out)
}

/// Play a few blocks, a note or a knob between them, as a hand would.
fn play(s: &mut Session, audio: &mut AudioEngine, midi: u32, wave: u32) -> (Vec<f32>, Vec<f32>) {
    let (mut l, mut r) = (Vec::new(), Vec::new());
    for b in 0..80 {
        match b {
            2 => s.midi(midi, &[0x90, 60, 100]).unwrap(),
            10 => s.midi(midi, &[0x90, 67, 90]).unwrap(),
            20 => s.set(wave, KEYS.iter().position(|k| k.key == "filt0.cut").unwrap() as u32, 0.3).unwrap(),
            30 => s.midi(midi, &[0xe0, 0, 96]).unwrap(),
            45 => s.midi(midi, &[0x80, 60, 0]).unwrap(),
            60 => s.midi(midi, &[0x80, 67, 0]).unwrap(),
            _ => {}
        }
        let (bl, br) = render(audio, BLOCK, BLOCK);
        l.extend(bl);
        r.extend(br);
        s.collect();
    }
    (l, r)
}

#[test]
fn every_wave_key_is_a_control_in_the_synths_order() {
    let c = controls("wave");
    assert_eq!(c.len(), NUM_PARAMS + STR_KEYS.len());
    for (i, k) in KEYS.iter().enumerate() {
        assert_eq!(c[i].key(), k.key);
        if let Control::Knob { min, max, .. } = &c[i] {
            assert_eq!((*min, *max), (k.min, k.max), "{}", k.key);
        }
    }
    for (i, k) in STR_KEYS.iter().enumerate() {
        let Control::Choice { key, options, default } = &c[NUM_PARAMS + i] else { panic!("{k} is a choice") };
        assert_eq!(key, k);
        assert!(!options.is_empty(), "{k} has options");
        let mut p = Patch::default();
        for o in options {
            assert!(p.set_str(k, o), "{k} takes {o}");
        }
        assert_eq!(Patch::default().get_str(k), Some(options[*default].as_str()), "{k}'s default");
    }
}

/// The same patch built by hand: Keys into Wave (its board and tables given)
/// into a mixer and MGL's ceiling.
fn by_hand(patch: &Patch) -> (Controller, AudioEngine) {
    let (mut ctl, audio) = engine(RATE, exact());
    ctl.add(16, Box::new(basics::Keys::new())).unwrap();
    ctl.add(32, Box::new(engine_mgl::Wave::new(RATE).patch(PatchState::new(patch)))).unwrap();
    ctl.add(48, Box::new(basics::Mix::new(4))).unwrap();
    ctl.add(49, Box::new(engine_mgl::Ceiling)).unwrap();
    ctl.connect(port(16, 0), port(32, 0)).unwrap();
    ctl.connect(port(32, 0), port(48, 0)).unwrap();
    ctl.connect(port(48, 0), port(49, 0)).unwrap();
    ctl.connect_out(port(49, 0)).unwrap();
    ctl.commit().unwrap();
    let plan = BoardPlan::compile(patch.board.as_ref().unwrap(), RATE).unwrap();
    ctl.give(32, 0, Box::new(engine_mgl::WaveThing::Board(Box::new(plan)))).unwrap();
    for (osc, name) in patch.tables.iter().enumerate() {
        let t = Arc::new(Wavetable::from_frames(&wave::builtin_frames(name).unwrap()));
        ctl.give(32, 0, Box::new(engine_mgl::WaveThing::Table(osc, t))).unwrap();
    }
    (ctl, audio)
}

#[test]
fn wave_on_the_canvas_plays_what_wave_built_by_hand_plays() {
    let (mut s, mut audio) = session();
    let (midi, wave, _) = canvas(&mut s);
    let (l, r) = play(&mut s, &mut audio, midi, wave);
    assert!(peak(&l) > 0.01, "Wave is heard");

    let mut patch = Patch::default();
    wave_patch::ensure(&mut patch);
    let (mut ctl, mut audio) = by_hand(&patch);
    let cut = KEYS.iter().position(|k| k.key == "filt0.cut").unwrap() as u32;
    let (mut hl, mut hr) = (Vec::new(), Vec::new());
    for b in 0..80 {
        let note = |n: u8, v: u8| EventKind::Note(NoteEvent::on(n, v as f32 / 127.0));
        match b {
            2 => drop(ctl.send(16, note(60, 100))),
            10 => drop(ctl.send(16, note(67, 90))),
            20 => drop(ctl.send(32, EventKind::Param { index: cut, value: 0.3 })),
            30 => drop(ctl.send(32, EventKind::Param { index: engine_mgl::Wave::BEND, value: 4096.0 / 8191.0 })),
            45 => drop(ctl.send(16, EventKind::Note(NoteEvent::off(60)))),
            60 => drop(ctl.send(16, EventKind::Note(NoteEvent::off(67)))),
            _ => {}
        }
        let (bl, br) = render(&mut audio, BLOCK, BLOCK);
        hl.extend(bl);
        hr.extend(br);
        ctl.collect();
    }
    assert_same("left", &hl, &l);
    assert_same("right", &hr, &r);
}

#[test]
fn a_canvas_saved_and_loaded_plays_the_same() {
    let (mut a, mut audio_a) = session();
    let (midi, wave, _) = canvas(&mut a);
    a.set(wave, KEYS.iter().position(|k| k.key == "osc0.pos").unwrap() as u32, 0.8).unwrap();
    // A choice: the first filter to band-pass, and oscillator 1 to another table.
    let filt = (NUM_PARAMS + STR_KEYS.iter().position(|k| *k == "filt0.type").unwrap()) as u32;
    let table = (NUM_PARAMS + STR_KEYS.iter().position(|k| *k == "osc1.table").unwrap()) as u32;
    a.set(wave, filt, 1.0).unwrap();
    a.set(wave, table, 4.0).unwrap();
    a.place(wave, 412.0, 96.0).unwrap();
    a.set(midi, 0, 0.0).unwrap();
    a.settle();
    let file = a.save();

    let (mut b, mut audio_b) = session();
    b.load(&serde_json::from_str::<Value>(&file.to_string()).unwrap()).unwrap();
    b.settle();
    assert_eq!(b.save(), file, "it saves as it was loaded");
    assert_eq!(b.wave_patch(wave).unwrap().get_str("filt0.type"), Some("bp"));
    assert_eq!(b.wave_patch(wave).unwrap().tables[1], "Grit Saw");

    // Both have heard the same changes once their first block plays.
    let (al, ar) = play(&mut a, &mut audio_a, midi, wave);
    let (bl, br) = play(&mut b, &mut audio_b, midi, wave);
    assert!(peak(&al) > 0.01);
    assert_same("left", &al, &bl);
    assert_same("right", &ar, &br);
}

#[test]
fn a_file_that_cant_be_read_leaves_the_canvas_as_it_was() {
    let (mut s, _audio) = session();
    canvas(&mut s);
    let before = s.save();
    assert!(s.load(&serde_json::json!({"format": "something else"})).is_err());
    let mut bad = before.clone();
    bad["modules"][1]["wave"]["params"]["osc0.table"] = Value::from(3);
    assert!(s.load(&bad).is_err());
    assert_eq!(s.save(), before);
}

/// The same JSON, a number being the same f32 however it is written (MGL
/// writes a whole number as `0`, serde_json as `0.0`).
fn same_value(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64().map(|x| x as f32) == y.as_f64().map(|y| y as f32),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(x, y)| same_value(x, y)),
        _ => a == b,
    }
}

fn mgl_file(name: &str) -> Value {
    let path = format!("{}/tests/data/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn mgl_s_own_wave_patch_and_preset_open_as_mgl_wrote_them() {
    for name in ["mgl-wave-patch.json", "mgl-wave-preset.json"] {
        let file = mgl_file(name);
        let p = wave_patch::patch_from_json(&file, Patch::default()).unwrap_or_else(|e| panic!("{name}: {e}"));
        let stored = file.get("patch").unwrap_or(&file);
        for (key, v) in stored["params"].as_object().unwrap() {
            let ours = &wave_patch::patch_json(&p)["params"][key];
            assert!(same_value(ours, v), "{name} {key}: {ours} against {v}");
        }
        assert_eq!(p.mods.len(), stored["mods"].as_array().unwrap().len(), "{name} mods");
        if let Some(b) = stored["board"].as_object() {
            let board = p.board.as_ref().unwrap();
            assert_eq!(board.nodes.len(), b["nodes"].as_array().unwrap().len(), "{name} board");
            assert_eq!(board.cables.len(), b["cables"].as_array().unwrap().len(), "{name} cables");
        }
        // And what is written here reads back as the same patch.
        let again = wave_patch::patch_from_json(&wave_patch::patch_json(&p), Patch::default()).unwrap();
        assert_eq!(again, p, "{name} round trip");
    }
}

#[test]
fn an_mgl_preset_given_to_wave_plays_as_a_canvas_saved_with_it() {
    let file = mgl_file("mgl-wave-preset.json");
    let (mut a, mut audio_a) = session();
    let (midi, wave, _) = canvas(&mut a);
    a.load_wave_patch(wave, &file).unwrap();
    a.settle();
    // As MGL loads a preset: its patch, laid over the default one.
    assert_eq!(a.wave_patch(wave).unwrap(), &wave_patch::patch_from_json(&file["patch"], Patch::default()).unwrap());
    let saved = a.save();
    let (mut b, mut audio_b) = session();
    b.load(&saved).unwrap();
    b.settle();
    // The open canvas crossfades from its old effects board to the preset's
    // over 10 ms, as MGL's Wave does; the loaded one starts on the preset's.
    // Past that, the two are the same.
    render(&mut audio_a, 4_096, BLOCK);
    render(&mut audio_b, 4_096, BLOCK);
    let (al, _) = play(&mut a, &mut audio_a, midi, wave);
    let (bl, _) = play(&mut b, &mut audio_b, midi, wave);
    assert!(peak(&al) > 0.001);
    assert_same("left", &al, &bl);
}

#[test]
fn a_midi_in_on_one_channel_hears_only_that_channel() {
    let (mut s, mut audio) = session();
    let (midi, _, _) = canvas(&mut s);
    s.set(midi, 0, 2.0).unwrap();
    s.midi(midi, &[0x90, 60, 100]).unwrap();
    let (l, _) = render(&mut audio, 8_192, BLOCK);
    assert_eq!(peak(&l), 0.0, "channel 1 is not heard");
    s.midi(midi, &[0x91, 60, 100]).unwrap();
    let (l, _) = render(&mut audio, 8_192, BLOCK);
    assert!(peak(&l) > 0.01, "channel 2 is");
}

#[test]
fn cables_only_join_like_to_like_and_one_to_an_input() {
    let (mut s, _audio) = session();
    let (midi, wave, out) = canvas(&mut s);
    assert_eq!(s.connect((midi, 0), (out, 1)), Err(engine_app::AppError::KindsDiffer));
    let other = s.add("midi-in", 0.0, 200.0).unwrap();
    assert_eq!(s.connect((other, 0), (wave, 0)), Err(engine_app::AppError::Taken));
    s.remove(midi).unwrap();
    assert_eq!(s.wires().len(), 1, "its cable went with it");
    s.connect((other, 0), (wave, 0)).unwrap();
}

#[test]
fn nothing_on_the_audio_thread_allocates_while_wave_plays_and_changes() {
    assert_the_check_is_on();
    let (mut s, mut audio) = session();
    let (midi, wave, _) = canvas(&mut s);
    render(&mut audio, 1_024, BLOCK);
    let filt = (NUM_PARAMS + STR_KEYS.iter().position(|k| *k == "filt0.type").unwrap()) as u32;
    let before = counted();
    for b in 0..60 {
        match b {
            1 => s.midi(midi, &[0x90, 60, 100]).unwrap(),
            9 => s.set(wave, 1, 0.7).unwrap(),
            20 => s.set(wave, filt, 2.0).unwrap(),
            30 => s.midi(midi, &[0xb0, 1, 64]).unwrap(),
            40 => s.midi(midi, &[0x80, 60, 0]).unwrap(),
            _ => {}
        }
        render(&mut audio, BLOCK, BLOCK);
        s.collect();
    }
    assert_eq!(counted() - before, 0, "allocations or frees inside a render; the last sizes: {:?}", last_sizes());
}

#[test]
fn a_table_saved_by_mgl_is_read_as_mgl_reads_it_and_offered_as_a_choice() {
    session();
    let frames = engine_app::frames_for("hal sez...").expect("the saved table is found");
    assert_eq!(frames, stand_in(), "read back as it was saved");
    let c = controls("wave");
    let Control::Choice { options, .. } = &c[NUM_PARAMS + STR_KEYS.iter().position(|k| *k == "osc0.table").unwrap()] else { panic!() };
    assert_eq!(&options[..5], &wave::BUILTIN_NAMES.map(String::from)[..]);
    assert!(options.iter().any(|o| o == "hal sez..."));
}
