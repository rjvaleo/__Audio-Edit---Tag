//! MGL's `/api/wave/*` routes, answered in-process for a Wave on the canvas
//! (`engine_app::wave_api`): each answers as MGL's server does for the same
//! input (MGL's own table code is compiled in here and compared with); the
//! state reports what the synth plays; a stored table is what the oscillator
//! then plays; a board MGL would refuse leaves the old one, and a change of
//! controls alone keeps the effects' tails; presets and board presets
//! round-trip, MGL's read and never written; and nothing on the audio thread
//! allocates.

#[path = "../../engine-mgl/tests/common/mod.rs"]
mod common;
use common::*;
use engine_app::{wave_api, wave_patch, Session};
use engine_core::*;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use wave::{BoardPlan, Patch, PatchState, Wavetable};

// MGL's own code for tables (`server-core/src/wave_synth/tables.rs`), with
// the JSON it is written against, built here to compare with.
#[allow(dead_code)]
#[path = "../../../core/crates/server-core/src/json.rs"]
mod json;
#[allow(dead_code)]
mod capture {
    /// MGL's `capture::safe`, which its table code names files with.
    pub fn safe(name: &str) -> String {
        name.chars()
            .map(|c| match c {
                '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
                c if (c as u32) < 0x20 => ' ',
                c => c,
            })
            .collect::<String>()
            .trim()
            .to_string()
    }
}
// What MGL's table code takes from the module it sits in.
const MIN_FRAME_LEN: usize = 64;
const MAX_FRAME_LEN: usize = 4096;
const CYCLE: usize = wave::FRAME_LEN;
#[allow(dead_code)]
#[path = "../../../core/crates/server-core/src/wave_synth/tables.rs"]
mod mgl_tables;
mod mgl {
    pub(crate) use crate::mgl_tables as tables;
}

const BLOCK: usize = 256;

fn tmp(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join("wave-api").join(name);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// The table folders, the same for every test here (they are one setting
/// for the whole program): the app's own, then one standing in for MGL's.
fn table_dirs() -> (PathBuf, PathBuf) {
    static DIRS: std::sync::OnceLock<(PathBuf, PathBuf)> = std::sync::OnceLock::new();
    DIRS.get_or_init(|| {
        let (own, mgl) = (tmp("tables-own"), tmp("tables-mgl"));
        let frames: Vec<Vec<f32>> = wave::builtin_frames("Grit Saw").unwrap().into_iter().take(8).collect();
        std::fs::write(mgl.join("From MGL.wav"), mgl::tables::table_wav(&frames)).unwrap();
        engine_app::set_table_dirs(vec![own.clone(), mgl.clone()]);
        (own, mgl)
    })
    .clone()
}

/// A session with Wave into Output; its own home, and a folder standing in
/// for MGL's `data/wave` with a preset and a board preset in it.
fn session(name: &str) -> (Session, AudioEngine, u32, PathBuf, PathBuf) {
    table_dirs();
    let home = tmp(&format!("{name}-home"));
    let mgl = tmp(&format!("{name}-mgl"));
    std::fs::create_dir_all(mgl.join("presets")).unwrap();
    std::fs::create_dir_all(mgl.join("boards")).unwrap();
    let preset = json!({"name": "From MGL", "tags": ["Old"], "patch": {"params": {"filt0.cut": 0.2}}, "hidden": false});
    std::fs::write(mgl.join("presets/From MGL.json"), preset.to_string()).unwrap();
    let mut board: Value = serde_json::from_str(include_str!("../../../core/crates/server-core/src/wave_board/factory.json")).unwrap();
    let mut b = board[3].take();
    b["name"] = "MGL Board".into();
    b.as_object_mut().unwrap().remove("mods");
    std::fs::write(mgl.join("boards/MGL Board.json"), b.to_string()).unwrap();
    let (mut s, audio) = Session::with_config(RATE, exact());
    s.set_wave_dirs(Some(home.clone()), Some(mgl.clone()));
    let wave = s.add("wave", 0.0, 0.0).unwrap();
    let out = s.add("output", 1900.0, 0.0).unwrap();
    s.connect((wave, 0), (out, 0)).unwrap();
    s.settle();
    (s, audio, wave, home, mgl)
}

fn api(s: &mut Session, id: u32, method: &str, path: &str, body: Value) -> (u16, Value) {
    let b = (!body.is_null()).then(|| body.to_string());
    let r = s.wave_api(id, method, path, b.as_deref());
    (r.status, r.body)
}

fn err(msg: &str) -> Value {
    json!({ "error": msg })
}

fn f(v: &Value) -> f64 {
    v.as_f64().unwrap_or_else(|| panic!("{v} is not a number"))
}

fn names(list: &Value) -> Vec<String> {
    list.as_array().unwrap().iter().map(|p| p["name"].as_str().unwrap().to_string()).collect()
}

#[test]
fn the_patch_routes_answer_as_mgl() {
    let (mut s, _audio, wave, ..) = session("patch");
    let mut expect = Patch::default();
    wave_patch::ensure(&mut expect);
    let (st, got) = api(&mut s, wave, "GET", "/api/wave/patch", Value::Null);
    assert_eq!((st, got), (200, wave_patch::patch_json(&expect)));

    let (st, got) = api(&mut s, wave, "POST", "/api/wave/patch", json!({"params": {"filt0.cut": 0.3, "osc1.table": "Grit Saw"}, "name": "Mine"}));
    assert_eq!(st, 200);
    assert_eq!(f(&got["params"]["filt0.cut"]), 0.3);
    assert_eq!(got["params"]["osc1.table"], "Grit Saw");
    assert_eq!(got["name"], "Mine");
    assert_eq!(got["board"]["name"], "Master chain", "a patch with no board is given its chain's");
    assert_eq!(api(&mut s, wave, "GET", "/api/wave/patch", Value::Null).1, got, "kept as adopted");
    assert_eq!(s.wave_patch(wave).unwrap().name, "Mine");

    assert_eq!(api(&mut s, wave, "POST", "/api/wave/patch", json!({"params": {"nope": 1}})), (400, err("unknown key \"nope\"")));
    assert_eq!(s.wave_patch(wave).unwrap().name, "Mine", "a refused patch changes nothing");
    let r = s.wave_api(wave, "POST", "/api/wave/patch", Some("[1]"));
    assert_eq!((r.status, r.body), (400, err("expected a JSON object")));
    assert_eq!(api(&mut s, wave, "GET", "/api/wave/nothing", Value::Null), (404, err("no such endpoint")));
    assert_eq!(api(&mut s, 999, "GET", "/api/wave/patch", Value::Null).0, 404);
}

#[test]
fn param_mods_note_and_control_answer_as_mgl() {
    let (mut s, _audio, wave, ..) = session("param");
    let (st, got) = api(&mut s, wave, "POST", "/api/wave/param", json!({"key": "filt0.cut", "value": 0.5}));
    assert_eq!(st, 200);
    assert_eq!(got["ok"], true);
    assert_eq!(got["key"], "filt0.cut");
    assert_eq!(f(&got["value"]), 0.5);
    assert_eq!(got["live"], false);
    assert_eq!(s.wave_patch(wave).unwrap().get_num("filt0.cut"), Some(0.5), "stored");

    let (_, got) = api(&mut s, wave, "POST", "/api/wave/param", json!({"key": "filt0.cut", "value": 0.9, "live": true}));
    assert_eq!(got["live"], true);
    assert_eq!(s.wave_patch(wave).unwrap().get_num("filt0.cut"), Some(0.5), "live is heard, not stored");

    let (_, got) = api(&mut s, wave, "POST", "/api/wave/param", json!({"key": "filt0.type", "value": "bp"}));
    assert_eq!(got["value"], "bp");
    let (_, got) = api(&mut s, wave, "POST", "/api/wave/param", json!({"key": "lfo0.points", "value": [[0, 0], [0.5, 1], [1, 0]]}));
    assert_eq!(got["value"], json!([[0.0, 0.0], [0.5, 1.0], [1.0, 0.0]]));
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/param", json!({"value": 1})), (400, err("no key given")));
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/param", json!({"key": "filt0.cut"})), (400, err("no value given")));
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/param", json!({"key": "filt0.cut", "value": "x"})), (400, err("filt0.cut takes a number")));
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/param", json!({"key": "filt0.type", "value": "zz"})), (400, err("filt0.type does not take \"zz\"")));

    let row = json!({"src": "lfo0", "dst": "filt0.cut", "amt": 0.5, "curve": "lin", "via": null, "on": true});
    let (st, got) = api(&mut s, wave, "POST", "/api/wave/mods", json!({"mods": [row]}));
    assert_eq!(st, 200);
    assert_eq!(got, json!({"ok": true, "mods": [row]}));
    assert_eq!(s.wave_patch(wave).unwrap().mods.len(), 1);
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/mods", json!({})), (400, err("no mods given")));
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/mods", json!({"mods": [{"src": "x", "dst": "filt0.cut", "amt": 1}]})), (400, err("mod 0: unknown src")));

    assert_eq!(api(&mut s, wave, "POST", "/api/wave/note", json!({"note": 60, "vel": 0.7})), (200, json!({"ok": true, "note": 60, "on": true, "queued": true})));
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/note", json!({"note": 60, "on": 0})).1["on"], false);
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/note", json!({"note": 200})), (400, err("note must be 0 to 127")));
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/control", json!({"bend": 0.5, "mw": 0.2})), (200, json!({"ok": true})));
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/control", json!({"allOff": true})), (200, json!({"ok": true})));
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/control", json!({})), (400, err("expected bend, mw, at or allOff")));
}

#[test]
fn the_state_reports_a_sounding_voice_a_peak_and_the_wave() {
    let (mut s, mut audio, wave, ..) = session("state");
    let (_, idle) = api(&mut s, wave, "GET", "/api/wave/state", Value::Null);
    assert_eq!(idle["device"], false, "the engine has not played yet");
    assert_eq!(idle["voices"], json!([]));
    assert_eq!(idle["wave"].as_array().unwrap().len(), 256);
    assert!(idle["wave"].as_array().unwrap().iter().all(|x| f(x) == 0.0));
    for (k, n) in [("pos", 3), ("lfo", 4), ("lfoPhase", 4), ("lfoValue", 4), ("peak", 2)] {
        assert_eq!(idle[k].as_array().unwrap().len(), n, "{k}");
    }

    // A row onto the cutoff and one stepping oscillator 0's table: the state
    // names each, the table by the bank's name for it.
    let rows = json!([
        {"src": "lfo0", "dst": "filt0.cut", "amt": 0.5},
        {"src": "mw", "dst": "osc0.table", "amt": 0.0}
    ]);
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/mods", json!({ "mods": rows })).0, 200);
    s.settle();
    api(&mut s, wave, "POST", "/api/wave/note", json!({"note": 60, "vel": 0.9}));
    render(&mut audio, BLOCK * 20, BLOCK);
    let (st, t) = api(&mut s, wave, "GET", "/api/wave/state", Value::Null);
    assert_eq!(st, 200);
    assert_eq!(t["device"], true);
    let voices = t["voices"].as_array().unwrap();
    assert_eq!(voices.len(), 1, "{t}");
    assert_eq!(voices[0]["note"], 60);
    assert_eq!(f(&voices[0]["vel"]), 0.9);
    assert!(f(&voices[0]["env"]) > 0.0);
    assert!(["a", "d", "s"].contains(&voices[0]["stage"].as_str().unwrap()));
    assert!(t["peak"].as_array().unwrap().iter().all(|p| f(p) > 0.01), "{}", t["peak"]);
    assert!(t["wave"].as_array().unwrap().iter().any(|x| f(x).abs() > 0.01), "the wave is the output");
    assert!(t["mod"]["filt0.cut"].is_number(), "{}", t["mod"]);
    assert_eq!(t["mod"]["osc0.table"], s.wave_patch(wave).unwrap().tables[0].as_str());
    let board = s.wave_patch(wave).unwrap().board.clone().unwrap();
    let ids: Vec<&str> = board.nodes.iter().map(|n| n.id.as_str()).collect();
    let mut keys: Vec<&str> = t["board"].as_object().unwrap().keys().map(String::as_str).collect();
    let mut want = ids.clone();
    keys.sort();
    want.sort();
    assert_eq!(keys, want, "a peak pair for every node of the board playing");
    assert!(t["board"].as_object().unwrap().values().any(|p| f(&p[0]) > 0.0), "the board's peaks move: {}", t["board"]);

    api(&mut s, wave, "POST", "/api/wave/note", json!({"note": 60, "on": false}));
    render(&mut audio, BLOCK * 400, BLOCK);
    let (_, t) = api(&mut s, wave, "GET", "/api/wave/state", Value::Null);
    assert_eq!(t["voices"], json!([]), "the note has ended");
}

fn frames(shape: impl Fn(f32) -> f32, n: usize) -> Vec<Vec<f32>> {
    (0..n).map(|k| (0..2048).map(|i| shape((i as f32 / 2048.0 + k as f32 * 0.01).fract())).collect()).collect()
}

/// Wave built by hand, its patch and its tables given.
fn by_hand(patch: &Patch, tables: [Arc<Wavetable>; 3]) -> (Controller, AudioEngine) {
    let (mut ctl, audio) = engine(RATE, exact());
    ctl.add(32, Box::new(engine_mgl::Wave::new(RATE).patch(PatchState::new(patch)))).unwrap();
    ctl.add(48, Box::new(basics::Mix::new(4))).unwrap();
    ctl.add(49, Box::new(engine_mgl::Ceiling)).unwrap();
    ctl.connect(port(32, 0), port(48, 0)).unwrap();
    ctl.connect(port(48, 0), port(49, 0)).unwrap();
    ctl.connect_out(port(49, 0)).unwrap();
    ctl.commit().unwrap();
    let plan = BoardPlan::compile(patch.board.as_ref().unwrap(), RATE).unwrap();
    ctl.give(32, 0, Box::new(engine_mgl::WaveThing::Board(Box::new(plan)))).unwrap();
    for (osc, t) in tables.into_iter().enumerate() {
        ctl.give(32, 0, Box::new(engine_mgl::WaveThing::Table(osc, t))).unwrap();
    }
    (ctl, audio)
}

#[test]
fn a_stored_table_reads_back_and_the_oscillator_plays_it() {
    let (mut s, mut audio, wave, ..) = session("table");
    let (own, _) = table_dirs();
    let saw = frames(|p| 2.0 * p - 1.0, 4);
    let square = frames(|p| if p < 0.5 { 1.0 } else { -1.0 }, 4);
    let post = |s: &mut Session, f: &[Vec<f32>]| api(s, wave, "POST", "/api/wave/table", json!({"name": "Mine", "frames": f}));

    let (st, got) = post(&mut s, &saw);
    assert_eq!(st, 200);
    // The reply is MGL's: the stored name and each frame's preview.
    let want = mgl::tables::preview(&saw, 256);
    assert_eq!(got["name"], "Mine");
    let pv: Vec<Vec<f32>> = got["frames"].as_array().unwrap().iter().map(|fr| fr.as_array().unwrap().iter().map(|x| f(x) as f32).collect()).collect();
    assert_eq!(pv, want);
    // Written as MGL writes a table, into the app's own folder.
    let bytes = std::fs::read(own.join("Mine.wav")).unwrap();
    assert_eq!(bytes, mgl::tables::table_wav(&saw));
    assert_eq!(mgl::tables::read_table_wav(&bytes).unwrap(), saw);
    assert_eq!(api(&mut s, wave, "GET", "/api/wave/table?name=Mine", Value::Null), (200, got.clone()));
    let (_, list) = api(&mut s, wave, "GET", "/api/wave/tables", Value::Null);
    let list = list.as_array().unwrap();
    assert_eq!(&names(&Value::Array(list[..5].to_vec())), &wave::BUILTIN_NAMES.map(String::from));
    assert!(list[..5].iter().all(|t| t["builtin"] == true && t["frames"] == 64));
    let mine = list.iter().find(|t| t["name"] == "Mine").unwrap();
    assert_eq!((mine["frames"].as_u64(), &mine["builtin"]), (Some(4), &json!(false)));
    let theirs = list.iter().find(|t| t["name"] == "From MGL").unwrap();
    assert_eq!(theirs["frames"].as_u64(), Some(8), "MGL's folder is read too");

    // The oscillator is given it, then the table is stored again: the old
    // build is let go of and the oscillator plays the new frames.
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/param", json!({"key": "osc0.table", "value": "Mine"})).0, 200);
    s.settle();
    assert_eq!(post(&mut s, &square).0, 200);
    s.settle();
    api(&mut s, wave, "POST", "/api/wave/note", json!({"note": 57, "vel": 0.8}));
    let (l, _) = render(&mut audio, BLOCK * 40, BLOCK);
    assert!(peak(&l) > 0.01);

    let patch = s.wave_patch(wave).unwrap().clone();
    let builtin = |n: &str| Arc::new(Wavetable::from_frames(&wave::builtin_frames(n).unwrap()));
    let hand = |table: &[Vec<f32>]| {
        let (mut ctl, mut audio) = by_hand(&patch, [Arc::new(Wavetable::from_frames(table)), builtin(&patch.tables[1]), builtin(&patch.tables[2])]);
        ctl.send(32, EventKind::Note(NoteEvent::on(57, 0.8))).unwrap();
        render(&mut audio, BLOCK * 40, BLOCK).0
    };
    assert_same("the new frames", &hand(&square), &l);
    assert!(first_difference(&hand(&saw), &l).is_some(), "not the old ones");

    // A built-in is never replaced: its edit is kept as "<name> (edited)".
    let (_, got) = api(&mut s, wave, "POST", "/api/wave/table", json!({"name": "Grit Saw", "frames": &saw[..1]}));
    assert_eq!(got["name"], "Grit Saw (edited)");
    assert!(own.join("Grit Saw (edited).wav").is_file());
    assert_eq!(api(&mut s, wave, "GET", "/api/wave/table?name=No%20Such", Value::Null), (404, err("no table called \"No Such\"")));
    assert_eq!(api(&mut s, wave, "GET", "/api/wave/table", Value::Null), (400, err("no name given")));
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/table", json!({"name": "x", "frames": [[0.0, 1.0]]})), (400, err("a frame is 64 to 4096 samples")));
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/table", json!({"name": "x", "frames": []})), (400, err("a table has 1 to 256 frames")));
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/table", json!({"name": "...", "frames": &saw[..1]})), (400, err("the name is empty")));
}

/// A mono 16-bit WAV, for a sound to import.
fn pcm_wav(samples: &[f32]) -> Vec<u8> {
    let data: Vec<u8> = samples.iter().flat_map(|s| ((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes()).collect();
    let mut out = Vec::new();
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&48_000u32.to_le_bytes());
    out.extend_from_slice(&96_000u32.to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(&data);
    out
}

#[test]
fn a_sound_imports_as_mgl_slices_one() {
    let (mut s, _audio, wave, home, _) = session("import");
    let (own, _) = table_dirs();
    let sound: Vec<f32> = (0..2048 * 10).map(|i| (i as f32 * 0.013).sin() * 0.5).collect();
    let file = home.join("Breath.wav");
    std::fs::write(&file, pcm_wav(&sound)).unwrap();
    let (st, got) = api(&mut s, wave, "POST", "/api/wave/table/import", json!({"sound": file, "frames": 4, "mode": "count", "grain": true}));
    assert_eq!(st, 200, "{got}");
    assert_eq!(got["name"], "Breath", "named for the file");
    let stored = mgl::tables::read_table_wav(&std::fs::read(own.join("Breath.wav")).unwrap()).unwrap();
    let decoded: Vec<f32> = sound.iter().map(|s| ((s * 32767.0) as i16) as f32 / 32768.0).collect();
    assert_eq!(stored, wave_api::slice(&decoded, 4).unwrap());
    assert_eq!(stored.len(), 4);
    assert!(stored.iter().all(|f| f.len() == wave_api::CYCLE));
    assert_eq!(stored[0][..], decoded[..2048], "the first window is the sound's start");
    assert_eq!(stored[3][..], decoded[decoded.len() - 2048..], "the last its end");
    // MGL's own cases for slicing.
    let short = vec![0.5f32; 1000];
    assert_eq!(wave_api::slice(&short, 64).unwrap().len(), 1000 / 64);
    assert!(wave_api::slice(&[0.0; 10], 4).is_none());

    assert_eq!(api(&mut s, wave, "POST", "/api/wave/table/import", json!({"frames": 4})), (400, err("no sound given")));
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/table/import", json!({"sound": file, "mode": "x"})), (400, err("unknown import mode \"x\"")));
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/table/import", json!({"sound": "/no/such.wav"})), (404, err("no such file in the library")));
    let tiny = home.join("Tiny.wav");
    std::fs::write(&tiny, pcm_wav(&[0.1; 10])).unwrap();
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/table/import", json!({"sound": tiny})), (400, err("the sound is too short to slice")));
}

fn delay_board(extra: bool) -> Value {
    let mut nodes = vec![
        json!({"id": "invoice", "kind": "in:voice", "x": 16, "y": 16}),
        json!({"id": "sd", "kind": "fx:hp-single-delay", "x": 200, "y": 16, "params": {"delayMs": 250, "mix": 50}}),
        json!({"id": "out", "kind": "out", "x": 400, "y": 16}),
    ];
    if extra {
        nodes.push(json!({"id": "g2", "kind": "gain", "x": 200, "y": 200}));
    }
    json!({
        "name": "Echo",
        "nodes": nodes,
        "cables": [{"from": ["invoice", "o"], "to": ["sd", "i"]}, {"from": ["sd", "o"], "to": ["out", "i"]}]
    })
}

/// A short note through a 250 ms echo, then (as the echo is on its way) a
/// change to the board; what is heard where the echo falls.
fn echo_after(name: &str, change: impl FnOnce(&mut Session, u32) -> u16) -> f32 {
    let (mut s, mut audio, wave, ..) = session(name);
    let (st, _) = api(&mut s, wave, "POST", "/api/wave/patch", json!({"params": {"amp.r": 0.0}, "board": delay_board(false)}));
    assert_eq!(st, 200);
    s.settle();
    api(&mut s, wave, "POST", "/api/wave/note", json!({"note": 60, "vel": 1.0}));
    let mut heard = render(&mut audio, BLOCK * 10, BLOCK).0;
    api(&mut s, wave, "POST", "/api/wave/note", json!({"note": 60, "on": false}));
    heard.extend(render(&mut audio, BLOCK * 12, BLOCK).0);
    assert_eq!(change(&mut s, wave), 200);
    heard.extend(render(&mut audio, BLOCK * 50, BLOCK).0);
    // 250 to 330 ms: the echo of the note.
    peak(&heard[12_000..15_840])
}

#[test]
fn a_change_of_controls_alone_keeps_the_boards_tails_and_new_structure_does_not() {
    let live = echo_after("echo-live", |s, wave| api(s, wave, "POST", "/api/wave/board/param", json!({"node": "sd", "key": "mix", "value": 60})).0);
    let rebuilt = echo_after("echo-rebuilt", |s, wave| api(s, wave, "POST", "/api/wave/board", delay_board(true)).0);
    assert!(live > 0.05, "the echo is still on its way after a control moves: {live}");
    assert!(rebuilt < live * 0.01, "a new board starts with no tail: {rebuilt} against {live}");
}

#[test]
fn a_board_mgl_refuses_leaves_the_old_one() {
    let (mut s, _audio, wave, home, _) = session("board");
    let (st, before) = api(&mut s, wave, "GET", "/api/wave/board", Value::Null);
    assert_eq!(st, 200);
    assert_eq!(before, wave_patch::board_json(s.wave_patch(wave).unwrap().board.as_ref().unwrap()));

    let mut bad = delay_board(false);
    bad["cables"][1]["from"] = json!(["nobody", "o"]);
    let (st, got) = api(&mut s, wave, "POST", "/api/wave/board", bad.clone());
    assert_eq!(st, 400);
    let want = wave_patch::board_from_json(&bad).unwrap_err();
    assert_eq!(got["error"], want.message.as_str(), "MGL's own check, and its message");
    if let Some(c) = want.cable {
        assert_eq!(got["cable"], c);
    }
    assert_eq!(api(&mut s, wave, "GET", "/api/wave/board", Value::Null).1, before, "the old board stands");
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/board", json!({"name": "x"})), (400, err("nodes must be a list")));

    let (st, got) = api(&mut s, wave, "POST", "/api/wave/board", delay_board(false));
    assert_eq!(st, 200);
    assert_eq!(got["name"], "Echo");
    assert_eq!(api(&mut s, wave, "GET", "/api/wave/board", Value::Null).1, got);

    // One control: clamped to its range, stored; live, heard and not stored.
    let (st, got) = api(&mut s, wave, "POST", "/api/wave/board/param", json!({"node": "sd", "key": "mix", "value": 500}));
    assert_eq!(st, 200);
    assert_eq!(got, json!({"ok": true, "node": "sd", "key": "mix", "value": 100.0, "live": false}));
    let (_, now) = api(&mut s, wave, "GET", "/api/wave/board", Value::Null);
    let sd = now["nodes"].as_array().unwrap().iter().find(|n| n["id"] == "sd").unwrap().clone();
    assert_eq!(f(&sd["params"]["mix"]), 100.0);
    api(&mut s, wave, "POST", "/api/wave/board/param", json!({"node": "sd", "key": "on", "value": false, "live": true}));
    assert_eq!(api(&mut s, wave, "GET", "/api/wave/board", Value::Null).1, now, "live is not stored");
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/board/param", json!({"node": "zz", "key": "mix", "value": 1})), (400, err("no node \"zz\"")));
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/board/param", json!({"node": "sd", "key": "zz", "value": 1})), (400, err("fx:hp-single-delay has no control \"zz\"")));
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/board/param", json!({"node": "sd", "key": "mix", "value": "a"})), (400, err("value must be a number")));
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/board/param", json!({"key": "mix"})), (400, err("node and key are needed")));

    // A sound for a node that takes one: a file that decodes.
    let mut conv = delay_board(false);
    conv["nodes"][1] = json!({"id": "cv", "kind": "fx:convolution", "x": 200, "y": 16});
    conv["cables"] = json!([{"from": ["invoice", "o"], "to": ["cv", "i"]}, {"from": ["cv", "o"], "to": ["out", "i"]}]);
    let (st, got) = api(&mut s, wave, "POST", "/api/wave/board", conv);
    assert_eq!(st, 200, "{got}");
    assert_eq!(got["nodes"][1]["soundState"], "none");
    let ir = home.join("Room IR.wav");
    let impulse: Vec<f32> = (0..4800).map(|i| (-(i as f32) / 600.0).exp() * if i % 7 == 0 { 0.8 } else { -0.3 }).collect();
    std::fs::write(&ir, pcm_wav(&impulse)).unwrap();
    let ir = ir.to_str().unwrap();
    let (st, got) = api(&mut s, wave, "POST", "/api/wave/board/param", json!({"node": "cv", "key": "sound", "value": ir}));
    assert_eq!((st, &got["soundState"], &got["value"]), (200, &json!("loaded"), &json!(ir)));
    let (_, b) = api(&mut s, wave, "GET", "/api/wave/board", Value::Null);
    assert_eq!((&b["nodes"][1]["sound"], &b["nodes"][1]["soundState"]), (&json!(ir), &json!("loaded")));
    assert_eq!(
        api(&mut s, wave, "POST", "/api/wave/board/param", json!({"node": "cv", "key": "sound", "value": "/no/such.wav"})),
        (400, err("no sound \"/no/such.wav\" in the library"))
    );
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/board/param", json!({"node": "invoice", "key": "sound", "value": ir})), (400, err("in:voice takes no sound")));
    let (_, got) = api(&mut s, wave, "POST", "/api/wave/board/param", json!({"node": "cv", "key": "sound", "value": null}));
    assert_eq!(got["soundState"], "none");
}

#[test]
fn presets_round_trip_and_mgls_are_read_never_written() {
    let (mut s, _audio, wave, home, mgl) = session("presets");
    let theirs = std::fs::read(mgl.join("presets/From MGL.json")).unwrap();
    let (st, list) = api(&mut s, wave, "GET", "/api/wave/presets", Value::Null);
    assert_eq!(st, 200);
    assert_eq!(list, json!([{"name": "From MGL", "tags": ["Old"], "patch": {"params": {"filt0.cut": 0.2}}}]));

    let patch = json!({"params": {"filt0.cut": 0.4}});
    let (st, got) = api(&mut s, wave, "POST", "/api/wave/presets", json!({"name": "Pad One", "tags": "Pad · Warm", "patch": patch}));
    assert_eq!((st, got), (200, json!({"ok": true, "name": "Pad One", "hidden": false})));
    let file = home.join("presets/wave/Pad One.json");
    let held: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    assert_eq!(held, json!({"name": "Pad One", "tags": ["Pad", "Warm"], "patch": patch, "hidden": false}));
    // Without a patch, the module's own is kept.
    api(&mut s, wave, "POST", "/api/wave/param", json!({"key": "filt0.cut", "value": 0.65}));
    api(&mut s, wave, "POST", "/api/wave/presets", json!({"name": "Now", "tags": ["A"]}));
    let (_, list) = api(&mut s, wave, "GET", "/api/wave/presets", Value::Null);
    assert_eq!(names(&list), ["From MGL", "Now", "Pad One"], "by name");
    let now = list.as_array().unwrap().iter().find(|p| p["name"] == "Now").unwrap();
    assert_eq!(now["patch"], wave_patch::patch_json(s.wave_patch(wave).unwrap()));
    // Loading one: the page posts its patch.
    let pad = list.as_array().unwrap().iter().find(|p| p["name"] == "Pad One").unwrap()["patch"].clone();
    assert_eq!(f(&api(&mut s, wave, "POST", "/api/wave/patch", pad).1["params"]["filt0.cut"]), 0.4);

    // Unlisting keeps the file, marked hidden; MGL's is unlisted by a hidden
    // copy in the app's folder, its own file untouched.
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/presets", json!({"name": "Pad One", "remove": true})), (200, json!({"ok": true, "name": "Pad One", "hidden": true})));
    assert!(file.is_file());
    assert_eq!(serde_json::from_str::<Value>(&std::fs::read_to_string(&file).unwrap()).unwrap()["hidden"], true);
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/presets", json!({"name": "From MGL", "remove": true})).0, 200);
    assert_eq!(std::fs::read(mgl.join("presets/From MGL.json")).unwrap(), theirs, "MGL's file is never written");
    assert_eq!(names(&api(&mut s, wave, "GET", "/api/wave/presets", Value::Null).1), ["Now"]);
    // Saved again, it is listed again; the app's wins over MGL's of that name.
    api(&mut s, wave, "POST", "/api/wave/presets", json!({"name": "From MGL", "patch": {"params": {"filt0.cut": 0.7}}}));
    let (_, list) = api(&mut s, wave, "GET", "/api/wave/presets", Value::Null);
    assert_eq!(names(&list), ["From MGL", "Now"]);
    assert_eq!(list[0]["patch"]["params"]["filt0.cut"], 0.7);
    assert_eq!(std::fs::read(mgl.join("presets/From MGL.json")).unwrap(), theirs);

    assert_eq!(api(&mut s, wave, "POST", "/api/wave/presets", json!({"name": "Nope", "remove": true})), (404, err("no preset called \"Nope\"")));
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/presets", json!({"name": "  "})), (400, err("no name given")));
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/presets", json!({"name": "Bad", "patch": {"params": {"zz": 1}}})), (400, err("unknown key \"zz\"")));
}

#[test]
fn board_presets_round_trip_and_the_fx_list_is_mgls() {
    let (mut s, _audio, wave, home, mgl) = session("boards");
    let theirs = std::fs::read(mgl.join("boards/MGL Board.json")).unwrap();
    let (st, list) = api(&mut s, wave, "GET", "/api/wave/boards", Value::Null);
    assert_eq!(st, 200);
    assert_eq!(names(&list), ["Glass Split", "Dub Room", "Grit Bus", "Bubble Garden", "MGL Board"]);
    let l = list.as_array().unwrap();
    assert!(l[..4].iter().all(|b| b["factory"] == true && b["mods"].is_array()));
    assert_eq!(l[4]["factory"], false);
    // As MGL lists one: the board complete.
    let factory: Value = serde_json::from_str(include_str!("../../../core/crates/server-core/src/wave_board/factory.json")).unwrap();
    let dub = wave_patch::board_from_json(&factory[1]).unwrap();
    let mut want = wave_patch::board_json(&dub);
    want["factory"] = true.into();
    want["mods"] = factory[1]["mods"].clone();
    assert_eq!(l[1], want);

    api(&mut s, wave, "POST", "/api/wave/board", delay_board(false));
    let rows = json!([{"src": "mw", "dst": "board:sd:mix", "amt": 0.5}]);
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/boards", json!({"name": "Mine", "mods": rows})), (200, json!({"ok": true, "name": "Mine"})));
    let held: Value = serde_json::from_str(&std::fs::read_to_string(home.join("presets/wave-boards/Mine.json")).unwrap()).unwrap();
    assert_eq!(held["name"], "Mine");
    assert_eq!(held["hidden"], false);
    assert_eq!(held["mods"][0]["curve"], "lin", "rows kept as MGL keeps them, every field");
    assert_eq!(held["nodes"].as_array().unwrap().len(), s.wave_patch(wave).unwrap().board.as_ref().unwrap().nodes.len());
    assert_eq!(names(&api(&mut s, wave, "GET", "/api/wave/boards", Value::Null).1)[4..], ["MGL Board", "Mine"]);

    // Unlisting: a factory board and MGL's both by a hidden copy here.
    assert_eq!(api(&mut s, wave, "DELETE", "/api/wave/boards?name=Glass+Split", Value::Null), (200, json!({"ok": true, "name": "Glass Split", "hidden": true})));
    assert_eq!(api(&mut s, wave, "DELETE", "/api/wave/boards?name=MGL%20Board", Value::Null).0, 200);
    assert_eq!(std::fs::read(mgl.join("boards/MGL Board.json")).unwrap(), theirs, "MGL's file is never written");
    assert_eq!(names(&api(&mut s, wave, "GET", "/api/wave/boards", Value::Null).1), ["Dub Room", "Grit Bus", "Bubble Garden", "Mine"]);
    assert!(home.join("presets/wave-boards/Glass Split.json").is_file());
    assert_eq!(api(&mut s, wave, "DELETE", "/api/wave/boards?name=Nope", Value::Null), (404, err("no board called \"Nope\"")));
    assert_eq!(api(&mut s, wave, "DELETE", "/api/wave/boards", Value::Null), (400, err("no name given")));
    assert_eq!(api(&mut s, wave, "POST", "/api/wave/boards", json!({"name": "M", "mods": [{"src": "zz"}]})), (400, err("mod 0: unknown src")));

    // MGL's own test of its list: 97, a hall where it should be, the
    // notch's inert gain left out.
    let (st, fx) = api(&mut s, wave, "GET", "/api/wave/fx", Value::Null);
    assert_eq!(st, 200);
    let fx = fx.as_array().unwrap();
    assert_eq!(fx.len(), 97);
    let find = |k: &str| fx.iter().find(|e| e["kind"] == k).unwrap();
    let hall = find("fx:lxp-hall");
    assert_eq!((&hall["suite"], &hall["category"]), (&json!("Lexicon"), &json!("reverb")));
    assert!(find("fx:dattorro-notch")["params"].as_array().unwrap().iter().all(|p| p["key"] != "gainDb"));
    assert_eq!(find("fx:convolution")["sound"], json!({"key": "impulse", "label": "Impulse"}));
}

#[test]
fn the_table_helpers_are_mgls() {
    let saw = frames(|p| 2.0 * p - 1.0, 3);
    assert_eq!(wave_api::table_wav(&saw), mgl::tables::table_wav(&saw));
    let odd: Vec<Vec<f32>> = vec![(0..100).map(|i| 0.5 + (i as f32 * 0.3).sin()).collect()];
    assert_eq!(wave_api::preview(&odd, 256), mgl::tables::preview(&odd, 256));
    let bytes = mgl::tables::table_wav(&odd);
    assert_eq!(engine_app::read_table_wav(&bytes), mgl::tables::read_table_wav(&bytes));
}

#[test]
fn nothing_on_the_audio_thread_allocates_while_the_routes_are_asked() {
    assert_the_check_is_on();
    let (mut s, mut audio, wave, ..) = session("rt");
    render(&mut audio, 1_024, BLOCK);
    let before = counted();
    for b in 0..80 {
        match b {
            1 => drop(api(&mut s, wave, "POST", "/api/wave/note", json!({"note": 60, "vel": 0.8}))),
            5 => drop(api(&mut s, wave, "POST", "/api/wave/param", json!({"key": "filt0.cut", "value": 0.4}))),
            10 => drop(api(&mut s, wave, "POST", "/api/wave/param", json!({"key": "filt0.type", "value": "hp"}))),
            15 => drop(api(&mut s, wave, "POST", "/api/wave/mods", json!({"mods": [{"src": "lfo0", "dst": "osc0.pos", "amt": 0.3}]}))),
            20 => drop(api(&mut s, wave, "POST", "/api/wave/board", delay_board(false))),
            30 => drop(api(&mut s, wave, "POST", "/api/wave/board/param", json!({"node": "sd", "key": "mix", "value": 30}))),
            40 => drop(api(&mut s, wave, "POST", "/api/wave/table", json!({"name": "RT", "frames": frames(|p| p, 2)}))),
            41 => drop(api(&mut s, wave, "POST", "/api/wave/param", json!({"key": "osc0.table", "value": "RT"}))),
            50 => drop(api(&mut s, wave, "POST", "/api/wave/control", json!({"bend": 0.3, "mw": 0.5}))),
            60 => drop(api(&mut s, wave, "POST", "/api/wave/note", json!({"note": 60, "on": false}))),
            _ => {}
        }
        if b == 45 {
            s.settle();
        }
        render(&mut audio, BLOCK, BLOCK);
        assert_eq!(api(&mut s, wave, "GET", "/api/wave/state", Value::Null).0, 200);
    }
    assert_eq!(counted() - before, 0, "allocations or frees inside a render; the last sizes: {:?}", last_sizes());
}
