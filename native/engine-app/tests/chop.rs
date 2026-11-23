//! The Chop module against MGL's Chop page. A Sound module with the
//! reference break open, cabled into Chop: what the page's functions do
//! (`na_chop_call`, as the face calls them) gives the page's slices, picks,
//! words and readings step for step (the recording of the page in
//! `engine-mgl/tests/reference/chop/chop-edits.json`, made in Chromium by
//! `tests/ui/chop-edits.spec.mjs`); each slice, Preview and Ratchet play out
//! of the module sample for sample as `Page` renders them; Write's files
//! are the page's bytes; To Regions, the presets, a saved and loaded patch;
//! and nothing on the audio thread allocates while it plays and new slices
//! land.

#[path = "../../engine-mgl/tests/common/mod.rs"]
mod common;
use common::*;
use engine_app::Session;
use engine_core::*;
use serde_json::{json, Value};
use std::path::PathBuf;

const REF: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../engine-mgl/tests/reference/chop");

fn edits() -> Value {
    serde_json::from_str(&std::fs::read_to_string(format!("{REF}/chop-edits.json")).unwrap()).unwrap()
}

fn scratch(what: &str) -> PathBuf {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let d = std::env::temp_dir().join(format!("chop-{what}-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// The break, interleaved floats.
fn break_floats() -> Vec<f32> {
    std::fs::read(format!("{REF}/break.f32")).unwrap().chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect()
}

/// The break as a 32-bit float WAV, `reference.wav` in its own folder.
fn break_wav() -> PathBuf {
    let all = break_floats();
    let mut out = audio_core::wav::header((all.len() * 4) as u64, 2, 48_000, audio_core::Codec::PcmF32).to_vec();
    for v in &all {
        out.extend_from_slice(&v.to_le_bytes());
    }
    let path = scratch("src").join("reference.wav");
    std::fs::write(&path, out).unwrap();
    path
}

/// A canvas: a Sound with the break open, cabled into Chop, Chop heard.
fn canvas() -> (Session, AudioEngine, u32, u32, PathBuf) {
    let (mut s, audio) = Session::with_config(RATE, exact());
    let sound = s.add("sound", 0.0, 0.0).unwrap();
    let c = s.add("chop", 400.0, 0.0).unwrap();
    s.connect((sound, 0), (c, 0)).unwrap();
    let path = break_wav();
    s.sound_open(sound, path.to_str().unwrap(), &json!({ "kind": "file", "path": path.to_str().unwrap(), "name": "reference.wav" }), false).unwrap();
    s.chop_settle();
    s.controller().connect_out(port(c * 16, 0)).unwrap();
    s.controller().commit().unwrap();
    (s, audio, sound, c, path)
}

fn call(s: &mut Session, id: u32, what: &str, v: Value) -> Value {
    s.chop_call(id, what, &v).unwrap_or_else(|e| panic!("{what} {v}: {e}"))
}

fn state(s: &mut Session, id: u32) -> Value {
    call(s, id, "state", json!({}))["state"].clone()
}

/// Back to the page's start: no slices, S and E the whole, both slots at
/// the start, nothing said (as `chop-edits.spec.mjs` begins each case).
fn fresh() -> (Session, AudioEngine, u32, u32, PathBuf) {
    canvas()
}

fn same_num(a: &Value, b: &Value) -> bool {
    match (a.as_f64(), b.as_f64()) {
        (Some(x), Some(y)) => x.to_bits() == y.to_bits() || (x == 0.0 && y == 0.0),
        _ => a == b,
    }
}

/// The step of a recorded case against the module's state, and its slots.
/// `said`: compared once the case has run Detect or a scale (a new sound
/// here is detected at once; the recording starts each case with nothing said).
fn check_step(s: &mut Session, id: u32, want: &Value, what: &str, said: bool, faults: &mut Vec<String>) {
    let st = state(s, id);
    let got: Vec<Value> = st["slices"].as_array().unwrap().iter().map(|x| json!([x[0], x[1], x[2]])).collect();
    if Value::Array(got.clone()) != want["slices"] {
        faults.push(format!("{what}: slices {} against the page's {}", Value::Array(got), want["slices"]));
    }
    for k in ["sel", "current", "region", "which"] {
        if st[k] != want[k] {
            faults.push(format!("{what}: {k} {} against {}", st[k], want[k]));
        }
    }
    if said && st["tempoSaid"] != want["said"] {
        faults.push(format!("{what}: said {} against {}", st["tempoSaid"], want["said"]));
    }
    if !same_num(&st["bpm"], &want["bpm"]) {
        faults.push(format!("{what}: bpm {} against {}", st["bpm"], want["bpm"]));
    }
    let saved = s.save();
    let me = saved["modules"].as_array().unwrap().iter().find(|m| m["id"] == json!(id)).unwrap()["chop"]["slots"].clone();
    for k in ["a", "b"] {
        let (bars, beats) = (&me[k]["bars"], &me[k]["beats"]);
        if !same_num(bars, &want[k][0]) || !same_num(beats, &want[k][1]) {
            faults.push(format!("{what}: slot {k} {bars}/{beats} against {}", want[k]));
        }
    }
}

/// Every recorded case the face can make (all but the ones that set flags
/// by hand), through `na_chop_call`, step for step; then the readings.
#[test]
fn the_face_calls_give_the_pages_slices_and_readings() {
    let doc = edits();
    let mut faults = Vec::new();
    let mut ran = 0;
    for case in doc["cases"].as_array().unwrap() {
        let ops = case["ops"].as_array().unwrap();
        if ops.iter().any(|o| o[0] == "flag") {
            continue;
        }
        ran += 1;
        let id_ = case["id"].as_str().unwrap();
        let (mut s, _audio, _sound, c, _) = fresh();
        let steps = case["steps"].as_array().unwrap();
        check_step(&mut s, c, &steps[0], &format!("{id_}[start]"), false, &mut faults);
        let mut said = false;
        for (k, op) in ops.iter().enumerate() {
            let a = op.as_array().unwrap();
            match a[0].as_str().unwrap() {
                "set" => call(&mut s, c, "set", a[1].clone()),
                "region" => call(&mut s, c, "region", json!({ "s": a[1], "e": a[2] })),
                "lock" => call(&mut s, c, "lock", json!({ "i": a[1] })),
                "move" => {
                    call(&mut s, c, "move", json!({ "i": a[1], "side": a[2], "to": a[3], "snap": a[4] }));
                    call(&mut s, c, "moved", json!({}))
                }
                "delete" => call(&mut s, c, "delete", json!({ "i": a[1] })),
                "add" => call(&mut s, c, "add", json!({ "at": a[1] })),
                "pick" => call(&mut s, c, "pick", json!({ "i": a[1], "add": a[2] })),
                "toggle" => call(&mut s, c, "toggle", json!({ "flag": a[1] })),
                "recut" => call(&mut s, c, "recut", json!({})),
                "detect" => call(&mut s, c, "detect", json!({})),
                "scale" => call(&mut s, c, "scale", json!({ "f": a[1] })),
                "ab" => call(&mut s, c, "ab", json!({ "which": a[1].as_str().unwrap().to_lowercase() })),
                other => panic!("no op {other}"),
            };
            said |= a[0] == "detect" || a[0] == "scale";
            check_step(&mut s, c, &steps[k + 1], &format!("{id_}[{k}: {op}]"), said, &mut faults);
        }
        s.chop_settle();
        let v = &case["value"];
        match case["what"].as_str().unwrap_or("") {
            "measures" => {
                let st = state(&mut s, c);
                for (i, w) in v.as_array().unwrap().iter().enumerate() {
                    let r = call(&mut s, c, "slice", json!({ "i": i }));
                    for k in ["low", "mid", "high", "cent", "flat", "zcr", "db", "peakDb", "crest", "dur", "clarity", "hz"] {
                        if !same_num(&r["m"][k], &w[k]) {
                            faults.push(format!("{id_}: slice {i} {k} {} against {}", r["m"][k], w[k]));
                        }
                    }
                    if r["m"]["kind"] != w["kind"] || st["slices"][i][3] != w["kind"] {
                        faults.push(format!("{id_}: slice {i} kind {} / {} against {}", r["m"]["kind"], st["slices"][i][3], w["kind"]));
                    }
                    if !same_num(&r["attackMs"], &w["attackMs"]) || r["note"] != w["note"] {
                        faults.push(format!("{id_}: slice {i} attack {} note {} against {} {}", r["attackMs"], r["note"], w["attackMs"], w["note"]));
                    }
                }
            }
            "tails" => {
                let r = call(&mut s, c, "tails", json!({}));
                if r["badges"] != v["badges"] || r["cycles"] != v["cycles"] {
                    faults.push(format!("{id_}: tails {r} against {v}"));
                }
            }
            _ => {}
        }
    }
    assert!(faults.is_empty(), "{} differences from the page:\n{}", faults.len(), faults.join("\n"));
    assert!(ran >= 25, "{ran} cases");
    println!("chop through the face's calls: {ran} cases, every step the page's");
}

/// What plays out of the module from `frames` frames of the engine.
fn hear(audio: &mut AudioEngine, frames: usize) -> (Vec<f32>, Vec<f32>) {
    render(audio, frames, 128)
}

#[test]
fn each_slice_preview_and_ratchet_play_as_the_page_renders_them() {
    let (mut s, mut audio, _sound, c, _) = canvas();
    // The sound is the break, channel for channel, at its own rate.
    let all = break_floats();
    let page = s.chop_page(c).unwrap().clone();
    assert_eq!(page.rate, 48_000.0);
    assert_eq!(page.channels.len(), 2);
    for (i, v) in all.iter().enumerate() {
        assert_eq!(page.channels[i % 2][i / 2].to_bits(), v.to_bits(), "sample {i}");
    }
    call(&mut s, c, "set", json!([["mode", "grid"], ["div", "4"], ["tempo", 100], ["stretch", 50], ["eqOn", true], ["lowG", 4], ["fltOn", true], ["fltType", "bp"], ["fltFreq", 900], ["drive", 30]]));
    let page = s.chop_page(c).unwrap().clone();
    assert_eq!(page.slices.len(), 4);
    for i in 0..page.slices.len() {
        let st = call(&mut s, c, "play", json!({ "i": i }))["state"].clone();
        assert_eq!(st["current"], json!(i));
        let want = page.slice_audio(i, 0);
        let (l, r) = hear(&mut audio, want[0].len() + 256);
        assert_same(&format!("slice {i}, left"), &want[0], &l[..want[0].len()]);
        assert_same(&format!("slice {i}, right"), &want[1], &r[..want[1].len()]);
        assert_eq!(peak(&l[want[0].len()..]), 0.0, "slice {i} plays once");
        let p = call(&mut s, c, "playing", json!({}));
        assert_eq!(p["kind"], "", "slice {i} has ended: {p}");
    }
    // The playhead, part way into a slice.
    call(&mut s, c, "play", json!({ "i": 2, "pick": false }));
    hear(&mut audio, 1000);
    let p = call(&mut s, c, "playing", json!({}));
    assert_eq!(p["kind"], "slice");
    assert_eq!(p["at"].as_f64().unwrap(), (page.slices[2].s + 1000) as f64);
    let mut out = vec![0.0f32; 1600];
    assert_eq!(s.chop_out(c, &mut out).unwrap(), 1600);
    assert_eq!(&out[..], &page.slice_audio(2, 0)[0][1000..2600]);

    let preview = page.render_preview();
    call(&mut s, c, "preview", json!({}));
    let n = preview.chs[0].len();
    let (l, r) = hear(&mut audio, n + 1000);
    assert_same("Preview, left", &preview.chs[0], &l[..n]);
    assert_same("Preview, right", &preview.chs[1], &r[..n]);
    assert_eq!(peak(&l[n..]), 0.0, "Preview plays once");

    let ratchet = page.render_ratchet();
    let st = call(&mut s, c, "ratchet", json!({}))["state"].clone();
    assert_eq!(st["playing"], "", "it starts at the next block");
    let n = ratchet.chs[0].len();
    let (l, _) = hear(&mut audio, 2 * n + 300);
    let round: Vec<f32> = ratchet.chs[0].iter().chain(&ratchet.chs[0]).chain(&ratchet.chs[0][..300]).copied().collect();
    assert_same("Ratchet, round and round", &round, &l);
    let p = call(&mut s, c, "playing", json!({}));
    assert_eq!(p["kind"], "ratchet");
    let m = ratchet.map.iter().find(|m| 300 >= m.at && 300 < m.at + m.len).unwrap();
    assert_eq!(p["at"].as_f64().unwrap(), m.s as f64 + (300 - m.at) as f64);
    // The button again stops it.
    call(&mut s, c, "ratchet", json!({}));
    let (l, _) = hear(&mut audio, 1000);
    assert_eq!(peak(&l), 0.0, "stopped");
    assert_eq!(s.chop_out(c, &mut out).unwrap(), 0);

    // The rendered slice the face draws, and the mono and the analysis.
    let mut buf = vec![0.0f32; 10];
    let len = s.chop_render(c, 1, &mut buf).unwrap();
    assert_eq!(len, page.slice_audio(1, 0)[0].len());
    assert_eq!(&buf[..], &page.slice_audio(1, 0)[0][..10]);
    let mut m = vec![0.0f32; 4];
    assert_eq!(s.chop_mono(c, 47_998, &mut m).unwrap(), 96_000);
    assert_eq!(&m[..2], &page.mono[47_998..48_000]);
    let mut a = vec![0.0f32; 4000];
    let f = s.chop_analysis(c, 6, &mut a).unwrap();
    let an = engine_mgl::chop::analyse(&page.mono, 48_000.0);
    assert_eq!(f, an.frames);
    assert_eq!(&a[..f], &an.rms[..]);
}

/// The face's calls on Write, To Regions and the presets.
#[test]
fn write_puts_the_pages_bytes_beside_the_sound() {
    let doc = edits();
    let case = |id: &str| doc["cases"].as_array().unwrap().iter().find(|c| c["id"] == id).unwrap().clone();
    let (mut s, _audio, _sound, c, path) = canvas();
    call(&mut s, c, "set", json!([["mode", "grid"], ["div", "8"], ["feel", "straight"], ["bars", 1]]));
    let r = call(&mut s, c, "write", json!({}));
    let folder = path.parent().unwrap().join("reference slices");
    assert_eq!(r["folder"], json!(folder.to_str().unwrap()));
    assert_eq!(r["said"], json!(format!("Wrote 8 slices to {}", folder.display())));
    let plain = case("wav-plain");
    for i in 0..8 {
        let name = format!("reference_{:04}.wav", i + 1);
        assert_eq!(r["names"][i], json!(name));
        let bytes = std::fs::read(folder.join(&name)).unwrap();
        let w = &plain["value"][i];
        assert_eq!(bytes.len() as u64, w["n"].as_u64().unwrap(), "{name}");
        assert_eq!(fnv(&bytes), w["fnv"].as_str().unwrap(), "{name}: Recycle Reborn's bytes, as the page writes them");
    }
    // Again, with the MIDI and the SFZ, slice 3 muted: nothing is written over.
    call(&mut s, c, "pick", json!({ "i": 2 }));
    call(&mut s, c, "toggle", json!({ "flag": "muted" }));
    call(&mut s, c, "set", json!({ "outMidi": true, "outSfz": true }));
    let r = call(&mut s, c, "write", json!({}));
    assert_eq!(r["said"], json!(format!("Wrote 7 slices and the MIDI and SFZ to {}", folder.display())));
    assert_eq!(r["names"][0], "reference_0001 (2).wav");
    assert_eq!(r["names"][7], "reference.mid");
    let w = &case("write-grid")["value"];
    let midi = std::fs::read(folder.join("reference.mid")).unwrap();
    assert_eq!(fnv(&midi), w["midi"]["fnv"].as_str().unwrap(), "the page's MIDI file");
    // The SFZ names the files as written (here " (2)"); the page's, as it named them.
    let sfz = std::fs::read_to_string(folder.join("reference.sfz")).unwrap();
    assert_eq!(sfz.replace(" (2).wav", ".wav"), w["sfz"].as_str().unwrap());
    for i in [0usize, 1, 3, 4, 5, 6, 7] {
        let b = std::fs::read(folder.join(format!("reference_{:04} (2).wav", i + 1))).unwrap();
        assert_eq!(fnv(&b), case("wav-plain")["value"][i]["fnv"].as_str().unwrap());
    }

    // A tail and everything on: the page's bytes too.
    call(&mut s, c, "apply", json!({ "values": { "mode": "silence", "tail": true, "tailMs": 80 } }));
    let page = s.chop_page(c).unwrap();
    let w = &case("wav-tail")["value"];
    for i in 0..page.slices.len() {
        assert_eq!(fnv(&page.slice_wav(i)), w[i]["fnv"].as_str().unwrap(), "tail {i}");
    }

    // To Regions: one a slice not muted, not twice.
    let r = call(&mut s, c, "toRegions", json!({}));
    let n = s.chop_page(c).unwrap().slices.len();
    assert_eq!(r["added"], json!(n));
    assert_eq!(r["said"], json!(format!("{n} slices added to Regions")));
    let info = s.sound_info(_sound).unwrap();
    let regions = info["annotations"]["regions"].as_array().unwrap();
    assert_eq!(regions.len(), n);
    let x = s.chop_page(c).unwrap().slices[0];
    assert_eq!(regions[0], json!({ "start": x.s, "end": x.e, "label": "reference 1" }));
    let r = call(&mut s, c, "toRegions", json!({}));
    assert_eq!(r["added"], 0);
    assert_eq!(r["said"], "Every slice is in Regions already");

    // A sound from MGL's library goes to the home.
    let home = scratch("home");
    call(&mut s, c, "home", json!({ "home": home.to_str().unwrap() }));
}

fn fnv(b: &[u8]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for &x in b {
        h ^= x as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

#[test]
fn presets_go_round_and_the_library_writes_to_the_home() {
    let (mut s, _audio, sound, c, path) = canvas();
    let home = scratch("home");
    call(&mut s, c, "home", json!({ "home": home.to_str().unwrap() }));
    call(&mut s, c, "set", json!({ "mode": "grid", "div": "16", "gate": 70 }));
    let r = call(&mut s, c, "presets", json!({ "op": "save", "name": "Sixteens" }));
    assert_eq!(r["presets"], json!([{ "name": "Sixteens", "tag": "Grid · 1/16" }]));
    assert_eq!(r["state"]["preset"], "Sixteens");
    call(&mut s, c, "apply", json!({ "values": { "mode": "silence" } }));
    call(&mut s, c, "presets", json!({ "op": "save", "name": "a quiet one" }));
    let file: Value = serde_json::from_str(&std::fs::read_to_string(home.join("presets/chop/presets.json")).unwrap()).unwrap();
    assert_eq!(file.as_array().unwrap().iter().map(|p| p["name"].clone()).collect::<Vec<_>>(), vec![json!("a quiet one"), json!("Sixteens")], "sorted by name");
    assert_eq!(file[1]["cp"]["gate"], 70);
    let r = call(&mut s, c, "presets", json!({ "op": "load", "name": "Sixteens" }));
    assert_eq!(r["state"]["cp"]["div"], "16");
    assert_eq!(r["state"]["cp"]["gate"], 70);
    assert_eq!(r["state"]["tag"], "Grid · 1/16");
    assert_eq!(r["state"]["slices"].as_array().unwrap().len(), 16);
    let r = call(&mut s, c, "presets", json!({ "op": "rename", "name": "Sixteens", "to": "Grid 16" }));
    assert_eq!(r["state"]["preset"], "Grid 16");
    let r = call(&mut s, c, "presets", json!({ "op": "remove", "name": "a quiet one" }));
    assert_eq!(r["presets"], json!([{ "name": "Grid 16", "tag": "Grid · 1/16" }]));
    let r = call(&mut s, c, "presets", json!({ "op": "init" }));
    assert_eq!(r["state"]["preset"], "");
    assert_eq!(r["state"]["cp"]["mode"], "transient");
    assert_eq!(r["state"]["tempoSaid"], "1 bar, loops even", "Init detects again");
    assert!(s.chop_call(c, "presets", &json!({ "op": "load", "name": "gone" })).is_err());

    // The dice: the page's ranges, and it cuts again.
    for _ in 0..20 {
        let st = call(&mut s, c, "dice", json!({}))["state"].clone();
        let cp = &st["cp"];
        let sens = cp["sens"].as_f64().unwrap();
        assert!((35.0..=90.0).contains(&sens), "{cp}");
        assert!(["4", "8", "16", "32"].contains(&cp["div"].as_str().unwrap()));
        let q = cp["fltQ"].as_f64().unwrap();
        assert!((0.5..=6.0).contains(&q) && (q * 100.0).round() / 100.0 == q);
        assert!((200.0..=8000.0).contains(&cp["fltFreq"].as_f64().unwrap()));
        assert!([0.0, -12.0, -5.0, 5.0, 7.0, 12.0].contains(&cp["pitch"].as_f64().unwrap()));
    }

    // A sound from MGL's library: its slices go in the home.
    s.sound_open(sound, path.to_str().unwrap(), &json!({ "kind": "library", "path": "kit/reference.wav", "name": "reference.wav" }), false).unwrap();
    s.chop_settle();
    let st = state(&mut s, c);
    assert_eq!(st["sound"]["kind"], "library");
    let r = call(&mut s, c, "write", json!({}));
    let folder = home.join("slices").join("reference slices");
    assert_eq!(r["folder"], json!(folder.to_str().unwrap()));
    assert!(folder.join("reference_0001.wav").exists());
}

#[test]
fn a_patch_keeps_its_slices_and_a_new_sound_starts_again() {
    let (mut s, mut audio, sound, c, _) = canvas();
    let st0 = state(&mut s, c);
    assert_eq!(st0["tempoSaid"], "1 bar, loops even", "a new sound is detected");
    assert_eq!(st0["sound"]["name"], "reference.wav");
    assert_eq!(st0["sound"]["stem"], "reference");
    assert_eq!(st0["sound"]["len"], 96_000);
    assert!(!st0["an"].is_null() && st0["an"]["F"] == json!(184) && st0["analysing"] == false);
    call(&mut s, c, "set", json!({ "mode": "grid", "div": "8", "tail": true }));
    call(&mut s, c, "ab", json!({ "which": "b" }));
    call(&mut s, c, "set", json!({ "sens": 75, "gate": 60 }));
    call(&mut s, c, "lock", json!({ "i": 2 }));
    call(&mut s, c, "move", json!({ "i": 4, "side": "s", "to": 49_000, "snap": true }));
    call(&mut s, c, "moved", json!({}));
    call(&mut s, c, "add", json!({ "at": 70_000 }));
    call(&mut s, c, "pick", json!({ "i": 1 }));
    call(&mut s, c, "pick", json!({ "i": 3, "add": true }));
    call(&mut s, c, "toggle", json!({ "flag": "rev" }));
    call(&mut s, c, "region", json!({ "s": 1000, "e": 95_000 }));
    call(&mut s, c, "ui", json!({ "tool": "pencil", "view": { "a": 0, "b": 96000, "follow": true, "mode": "page" }, "colour": "kind", "soft": { "on": true, "alpha": 0.4 } }));
    let before = state(&mut s, c);
    let patch = s.save();

    let (mut t, mut audio2) = Session::with_config(RATE, exact());
    t.load(&patch).unwrap();
    t.chop_settle();
    let after = state(&mut t, c);
    for k in ["cp", "which", "region", "slices", "current", "sel", "tempoSaid", "ui", "bpm", "tag"] {
        assert_eq!(after[k], before[k], "{k} kept");
    }
    assert_eq!(after["sound"]["serial"].as_u64().unwrap(), 1);
    // And it plays the same.
    t.controller().connect_out(port(c * 16, 0)).unwrap();
    t.controller().commit().unwrap();
    call(&mut s, c, "play", json!({ "i": 3 }));
    call(&mut t, c, "play", json!({ "i": 3 }));
    let (l1, _) = hear(&mut audio, 20_000);
    let (l2, _) = hear(&mut audio2, 20_000);
    assert!(peak(&l1) > 0.01);
    assert_same("slice 3 after the patch came back", &l1, &l2);

    // The document edited (an edit on the Sound, through Edit): a new sound,
    // cut from nothing, Detect run again.
    let e = s.add("edit", 0.0, 400.0).unwrap();
    s.connect((sound, 0), (e, 0)).unwrap();
    let serial = state(&mut s, c)["sound"]["serial"].as_u64().unwrap();
    s.edit_op(e, &json!({ "op": "reverse", "start": 0, "end": 48_000 })).unwrap();
    s.chop_settle();
    let st = state(&mut s, c);
    assert_eq!(st["sound"]["serial"].as_u64().unwrap(), serial + 1, "new samples");
    assert_eq!(st["region"], json!([0, 96_000]));
    assert!(st["slices"].as_array().unwrap().iter().all(|x| x[2].as_u64().unwrap() & 3 == 0), "no hand edits kept");
    assert_eq!(st["sel"], json!([]));
    // Measures arriving on the Sound are not a new sound.
    s.collect();
    s.sound_settle();
    s.collect();
    assert_eq!(state(&mut s, c)["sound"]["serial"].as_u64().unwrap(), serial + 1);

    // Uncabled: no sound. Cabled again: a new one.
    s.disconnect((sound, 0), (c, 0)).unwrap();
    let st = state(&mut s, c);
    assert!(st["sound"].is_null() && st["slices"] == json!([]) && st["an"].is_null());
    assert_eq!(call(&mut s, c, "playing", json!({}))["kind"], "");
    s.connect((sound, 0), (c, 0)).unwrap();
    s.chop_settle();
    let st = state(&mut s, c);
    assert_eq!(st["sound"]["serial"].as_u64().unwrap(), serial + 3);
    assert!(!st["an"].is_null());
}

#[test]
fn nothing_on_the_audio_thread_allocates_while_it_plays_and_new_slices_land() {
    assert_the_check_is_on();
    let (mut s, mut audio, _sound, c, _) = canvas();
    call(&mut s, c, "set", json!({ "mode": "grid", "div": "16" }));
    s.chop_settle();
    // Rendered on this thread, handed over between blocks.
    call(&mut s, c, "ratchet", json!({}));
    let before = counted();
    let (l, _) = hear(&mut audio, 20_000);
    call(&mut s, c, "set", json!({ "div": "8", "fltOn": true }));
    s.chop_settle();
    call(&mut s, c, "play", json!({ "i": 3 }));
    let (l2, _) = hear(&mut audio, 10_000);
    call(&mut s, c, "preview", json!({}));
    let (l3, _) = hear(&mut audio, 30_000);
    for k in 0..6 {
        call(&mut s, c, "play", json!({ "i": k }));
        hear(&mut audio, 3_000);
        call(&mut s, c, "add", json!({ "at": 5_000 + 13_000 * k }));
        s.chop_settle();
    }
    assert_eq!(counted() - before, 0, "allocations or frees inside a render; the last sizes: {:?}", last_sizes());
    assert!(peak(&l) > 0.01 && peak(&l2) > 0.01 && peak(&l3) > 0.01);
    s.collect();
}
