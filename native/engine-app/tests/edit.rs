//! The Sound and Edit modules against MGL's own: every edit the Edit page
//! sends, posted to MGL's `/api/edit` and recorded (`tests/reference/edit`,
//! written by `core/crates/server/tests/routes/edit_references.rs`), gives
//! here the same answer, the same document (the bytes of the WAV the page
//! decodes, `/audio?dry=1`), the same peaks to the last bit (`/api/peaks`),
//! and the same measures (`/api/measure`); the markers and regions the same
//! as `/api/annot`. Edit's transport plays the edited sound sample for
//! sample, stops at its end, and goes round a loop. A canvas saved and
//! loaded holds the same document with the same history. Nothing on the
//! audio thread allocates.

#[path = "../../engine-mgl/tests/common/mod.rs"]
mod common;
use common::*;
use engine_app::Session;
use engine_core::*;
use serde_json::{json, Value};

const REF: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/reference/edit");

fn steps() -> Value {
    serde_json::from_str(&std::fs::read_to_string(format!("{REF}/steps.json")).unwrap()).unwrap()
}

/// A file of its own for each export: the tests run at once in one process.
fn scratch(what: &str) -> std::path::PathBuf {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    std::env::temp_dir().join(format!("edit-{what}-{}-{n}.wav", std::process::id()))
}

fn fnv(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

/// A canvas at `rate`: a Sound with the reference's sound open, cabled into Edit.
fn canvas(rate: f32) -> (Session, AudioEngine, u32, u32) {
    let (mut s, audio) = Session::with_config(rate, exact());
    let sound = s.add("sound", 0.0, 0.0).unwrap();
    let edit = s.add("edit", 400.0, 0.0).unwrap();
    s.connect((sound, 0), (edit, 0)).unwrap();
    s.sound_open(sound, &format!("{REF}/source.wav"), &json!({ "kind": "file", "path": "source.wav", "name": "source.wav" }), false).unwrap();
    (s, audio, sound, edit)
}

/// The bytes MGL's `/audio?dry=1` gives: the file itself while its clips are
/// the whole file, the edited clips as a 16-bit WAV otherwise.
fn dry_bytes(s: &mut Session, sound: u32) -> Vec<u8> {
    let info = s.sound_info(sound).unwrap();
    let whole = info["clips"].as_array().unwrap().len() == 1
        && info["clips"][0]["srcStart"] == 0
        && info["clips"][0]["len"] == info["sourceFrames"]
        && info["clips"][0]["gain"].as_f64() == Some(1.0)
        && info["clips"][0]["fadeIn"] == 0
        && info["clips"][0]["fadeOut"] == 0
        && info["clips"][0]["reversed"] == false;
    if whole {
        std::fs::read(format!("{REF}/source.wav")).unwrap()
    } else {
        let path = scratch("dry");
        // The same call MGL's route makes: the whole timeline, 16-bit.
        let edit = s.wires().iter().find(|w| w.from.0 == sound).unwrap().to.0;
        s.edit_export(edit, path.to_str().unwrap(), 16).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let _ = std::fs::remove_file(path);
        bytes
    }
}

/// Peaks as MGL's `/api/peaks` answers.
fn peaks(s: &Session, edit: u32, from: u64, to: u64, cols: usize) -> Value {
    let mut out = Vec::new();
    let (c, ch, f, t) = s.edit_peaks(edit, from, to, cols, &mut out).unwrap();
    let channels: Vec<Value> = (0..ch)
        .map(|k| {
            let at = |w: usize| out[(k * 3 + w) * c..(k * 3 + w + 1) * c].to_vec();
            json!({ "min": at(0), "max": at(1), "rms": at(2) })
        })
        .collect();
    json!({ "from": f, "to": t, "columns": c, "channels": channels })
}

/// Equal as JSON, numbers by value (MGL writes 1.0 as 1).
fn same_json(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same_json(p, q)),
        (Value::Object(x), Value::Object(y)) => x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same_json(v, w))),
        _ => a == b,
    }
}

fn same_floats(name: &str, ours: &Value, mgl: &Value) {
    let (a, b) = (ours.as_array().unwrap(), mgl.as_array().unwrap());
    assert_eq!(a.len(), b.len(), "{name}: lengths");
    for (i, (x, y)) in a.iter().zip(b).enumerate() {
        let (x, y) = (x.as_f64().unwrap() as f32, y.as_f64().unwrap() as f32);
        assert_eq!(x.to_bits(), y.to_bits(), "{name}[{i}]: {x} against MGL's {y}");
    }
}

fn same_peaks(name: &str, ours: &Value, mgl: &Value) {
    for k in ["from", "to", "columns"] {
        assert_eq!(ours[k], mgl[k], "{name}: {k}");
    }
    let (a, b) = (ours["channels"].as_array().unwrap(), mgl["channels"].as_array().unwrap());
    assert_eq!(a.len(), b.len(), "{name}: channels");
    for (c, (x, y)) in a.iter().zip(b).enumerate() {
        for k in ["min", "max", "rms"] {
            same_floats(&format!("{name} ch{c} {k}"), &x[k], &y[k]);
        }
    }
}

fn same_measure(name: &str, ours: &Value, mgl: &Value) {
    for k in ["peak", "peakDb", "rms", "rmsDb", "frames", "sampleRate", "peakFrame", "peakValue", "clickFrame", "clickDeviation"] {
        assert_eq!(ours.get(k).map(|v| v.as_f64()), mgl.get(k).map(|v| v.as_f64()), "{name}: {k}");
    }
}

#[test]
fn every_edit_is_mgls_own_to_the_bit() {
    let refs = steps();
    let (mut s, _audio, sound, edit) = canvas(44_100.0);
    let script = refs["script"].as_array().unwrap();
    let steps = refs["steps"].as_array().unwrap();
    assert_eq!(steps.len(), script.len() + 1);
    for (i, step) in steps.iter().enumerate() {
        let name = if i == 0 { "opened".to_string() } else { format!("step {i} {}", script[i - 1]) };
        if i > 0 {
            let ours = s.edit_op(edit, &script[i - 1]).unwrap();
            let mgl = &step["answer"];
            for k in ["frames", "baseFrames", "sourceFrames", "edited", "canUndo", "canRedo", "clipboard", "snapped", "clips"] {
                let (x, y) = (ours.get(k).unwrap_or(&Value::Null), mgl.get(k).unwrap_or(&Value::Null));
                assert!(same_json(x, y), "{name}: {k}: {x} against MGL's {y}");
            }
            assert_eq!(ours["duration"].as_f64(), mgl["duration"].as_f64(), "{name}: duration");
        }
        same_peaks(&format!("{name} peaks"), &peaks(&s, edit, 0, 0, 257), &step["peaks"]);
        same_peaks(&format!("{name} zoomed"), &peaks(&s, edit, 5000, 5600, 300), &step["zoom"]);
        same_measure(&format!("{name} measure"), &s.edit_measure(edit, 0, 0).unwrap(), &step["measure"]);
        same_measure(&format!("{name} measure 3000-45000"), &s.edit_measure(edit, 3000, 45000).unwrap(), &step["measurePart"]);
        let dry = dry_bytes(&mut s, sound);
        assert_eq!(dry.len() as u64, step["dry"]["bytes"].as_u64().unwrap(), "{name}: the dry WAV's length");
        assert_eq!(fnv(&dry), step["dry"]["fnv"].as_str().unwrap(), "{name}: the dry WAV's bytes");
    }
}

#[test]
fn markers_and_regions_are_mgls_own() {
    let refs = steps();
    let (mut s, _audio, _sound, edit) = canvas(44_100.0);
    for op in refs["script"].as_array().unwrap() {
        s.edit_op(edit, op).unwrap();
    }
    let annot = refs["annot"].as_array().unwrap();
    let set = json!({ "op": "set", "markers": [{ "frame": 5000, "label": "a" }, { "frame": 20000, "label": "b" }, { "frame": 41000, "label": "c" }, { "frame": 60000, "label": "d" }], "regions": [{ "start": 70000, "end": 65000, "label": "r1" }] });
    assert_eq!(s.edit_annot(edit, &set).unwrap(), annot[0], "markers set");
    for (i, op) in refs["annotScript"].as_array().unwrap().iter().enumerate() {
        assert_eq!(s.edit_annot(edit, op).unwrap(), annot[i + 1], "{op}");
    }
}

/// The edited sound in the bank, as Edit's transport should play it.
fn bank(s: &mut Session, sound: u32) -> (Vec<f32>, Vec<f32>) {
    // The bank's sound is the document rendered at the engine's rate, which
    // at 44.1 kHz is the timeline itself, in two channels.
    let info = s.sound_info(sound).unwrap();
    let frames = info["frames"].as_u64().unwrap() as usize;
    let edit = s.wires().iter().find(|w| w.from.0 == sound).unwrap().to.0;
    let path = scratch("bank");
    s.edit_export(edit, path.to_str().unwrap(), 32).unwrap();
    let bytes = std::fs::read(&path).unwrap();
    let data = &bytes[bytes.len() - frames * 8..];
    let f = |i: usize| f32::from_le_bytes(data[i * 4..i * 4 + 4].try_into().unwrap());
    ((0..frames).map(|i| f(2 * i)).collect(), (0..frames).map(|i| f(2 * i + 1)).collect())
}

/// Edit's audio straight out (no Output, no ceiling), for the checks.
fn hear(s: &mut Session, edit: u32) {
    s.controller().connect_out(port(edit * 16, 0)).unwrap();
    s.controller().commit().unwrap();
}

#[test]
fn edit_plays_the_edited_sound_and_stops_at_its_end() {
    let refs = steps();
    let (mut s, mut audio, sound, edit) = canvas(44_100.0);
    for op in refs["script"].as_array().unwrap().iter().take(10) {
        s.edit_op(edit, op).unwrap();
    }
    hear(&mut s, edit);
    let (bl, br) = bank(&mut s, sound);
    render(&mut audio, 512, 128);
    s.edit_transport(edit, &json!({ "seek": 1000 })).unwrap();
    s.edit_transport(edit, &json!({ "play": true })).unwrap();
    let n = bl.len() - 1000;
    let (l, r) = render(&mut audio, n + 4096, 256);
    assert_same("left", &l[..n], &bl[1000..]);
    assert_same("right", &r[..n], &br[1000..]);
    assert!(peak(&l[n..]) == 0.0 && peak(&r[n..]) == 0.0, "silent after the end");
    let (at, playing, _, _) = s.edit_position(edit).unwrap();
    assert!(!playing, "it stopped at the end");
    assert_eq!(at as usize, bl.len(), "the head is left at the end");
}

#[test]
fn edit_goes_round_its_loop() {
    let (mut s, mut audio, sound, edit) = canvas(44_100.0);
    hear(&mut s, edit);
    let (bl, _) = bank(&mut s, sound);
    let (a, b) = (10_000usize, 10_700usize);
    s.edit_transport(edit, &json!({ "loop": { "on": true, "a": a, "b": b }, "seek": 0, "play": true })).unwrap();
    let (l, _) = render(&mut audio, 3 * (b - a), 100);
    // A head outside the loop goes to its start at once, then round and round.
    let want: Vec<f32> = (0..3 * (b - a)).map(|i| bl[a + i % (b - a)]).collect();
    assert_same("loop", &l, &want);
    // The whole sound when the loop's end is 0.
    s.edit_transport(edit, &json!({ "loop": { "on": true, "a": 0, "b": 0 }, "seek": bl.len() - 50 })).unwrap();
    let (l, _) = render(&mut audio, 100, 100);
    assert_same("whole loop's seam", &l[50..], &bl[..50]);
}

#[test]
fn edit_plays_at_another_rate_from_the_same_place() {
    // At 48 kHz the bank's sound is resampled; a seek on the timeline lands
    // where that frame is in it.
    let (mut s, mut audio, _sound, edit) = canvas(48_000.0);
    hear(&mut s, edit);
    s.edit_transport(edit, &json!({ "seek": 44_100, "play": true })).unwrap();
    render(&mut audio, 4_800, 256);
    let (at, playing, _, _) = s.edit_position(edit).unwrap();
    assert!(playing);
    assert!((at - (44_100.0 + 4_410.0)).abs() < 1.0, "a tenth of a second on: {at}");
}

#[test]
fn a_canvas_saved_and_loaded_holds_the_same_document_and_history() {
    let refs = steps();
    let (mut s, _audio, sound, edit) = canvas(44_100.0);
    for op in refs["script"].as_array().unwrap().iter().take(16) {
        s.edit_op(edit, op).unwrap();
    }
    s.edit_annot(edit, &json!({ "op": "set", "markers": [{ "frame": 700, "label": "m1" }], "regions": [] })).unwrap();
    s.edit_set_ui(edit, json!({ "view": { "from": 100, "to": 9000 }, "sel": { "start": 200, "end": 300 } })).unwrap();
    let saved = s.save();
    let before = s.sound_info(sound).unwrap();
    let dry = dry_bytes(&mut s, sound);
    let (mut t, _audio2) = Session::with_config(44_100.0, exact());
    t.load(&serde_json::from_str(&saved.to_string()).unwrap()).unwrap();
    let after = t.sound_info(sound).unwrap();
    for k in ["frames", "clips", "canUndo", "canRedo", "clipboard", "annotations"] {
        assert_eq!(after[k], before[k], "{k}");
    }
    assert_eq!(dry_bytes(&mut t, sound), dry, "the same sound");
    assert_eq!(t.edit_ui(edit).unwrap()["sel"]["end"], 300);
    // And the history goes on as it would have.
    let a = s.edit_op(edit, &json!({ "op": "undo" })).unwrap();
    let b = t.edit_op(edit, &json!({ "op": "undo" })).unwrap();
    assert_eq!(a["clips"], b["clips"]);
}

#[test]
fn a_sound_whose_file_is_gone_is_silent_and_keeps_its_edits() {
    let (mut s, _audio, sound, edit) = canvas(44_100.0);
    s.edit_op(edit, &json!({ "op": "cut", "start": 0, "end": 1000 })).unwrap();
    let mut saved = s.save();
    let gone = std::env::temp_dir().join("no-such-sound.wav");
    for m in saved["modules"].as_array_mut().unwrap() {
        if m["kind"] == "sound" {
            m["sound"]["origin"]["file"] = gone.to_str().unwrap().into();
        }
    }
    let (mut t, _audio2) = Session::with_config(44_100.0, exact());
    t.load(&saved).unwrap();
    let info = t.sound_info(sound).unwrap();
    assert_eq!(info["open"], false);
    assert_eq!(info["missing"], "file not found");
    // Found again: its edit comes back.
    let back = t.sound_open(sound, &format!("{REF}/source.wav"), &info["origin"], true).unwrap();
    assert_eq!(back["frames"], 88_200 - 1000);
}

#[test]
fn nothing_on_the_audio_thread_allocates_while_edit_plays_and_edits_land() {
    assert_the_check_is_on();
    let refs = steps();
    let (mut s, mut audio, _sound, edit) = canvas(48_000.0);
    hear(&mut s, edit);
    s.edit_transport(edit, &json!({ "play": true, "loop": { "on": true, "a": 0, "b": 0 } })).unwrap();
    render(&mut audio, 1_024, 256);
    let before = counted();
    for (b, op) in refs["script"].as_array().unwrap().iter().enumerate() {
        s.edit_op(edit, op).unwrap();
        if b % 3 == 0 {
            s.edit_transport(edit, &json!({ "seek": 500 * b })).unwrap();
        }
        render(&mut audio, 2_048, 256);
        s.collect();
    }
    assert_eq!(counted() - before, 0, "allocations or frees inside a render; the last sizes: {:?}", last_sizes());
}
