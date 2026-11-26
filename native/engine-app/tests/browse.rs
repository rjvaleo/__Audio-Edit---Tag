//! The Browse and Library modules on the canvas: the audition plays the file
//! as it is, sample for sample as a Sound module and Edit play it untouched
//! (MGL's raw audition is the file through its transport, with no edits and
//! no deck); the same file again pauses and plays; a stop goes back to the
//! start; the Library page's Loop goes round. A sound chosen opens in every
//! Sound module cabled from it, and only a Browse's Sound goes into a Sound
//! module's Library socket. A canvas saved and loaded keeps the page's state
//! and its cables, and opens silent. Nothing on the audio thread allocates.

#[path = "../../engine-mgl/tests/common/mod.rs"]
mod common;
use common::*;
use engine_app::Session;
use engine_core::*;
use serde_json::{json, Value};

fn scratch(what: &str) -> std::path::PathBuf {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let d = std::env::temp_dir().join(format!("browse-{what}-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// A second and a half of two tones, stereo, 16-bit, at `rate`.
fn wav(rate: u32) -> std::path::PathBuf {
    let frames = rate as usize * 3 / 2;
    let mut out = audio_core::wav::header((frames * 4) as u64, 2, rate, audio_core::Codec::PcmI16).to_vec();
    for i in 0..frames {
        let l = ((i as f32 / 23.0).sin() * 9000.0) as i16;
        let r = ((i as f32 / 41.0).sin() * 7000.0) as i16;
        out.extend_from_slice(&l.to_le_bytes());
        out.extend_from_slice(&r.to_le_bytes());
    }
    let path = scratch("lib").join(format!("tone-{rate}.wav"));
    std::fs::write(&path, out).unwrap();
    path
}

fn call(s: &mut Session, id: u32, what: &str, v: Value) -> Value {
    s.browse_call(id, what, &v).unwrap_or_else(|e| panic!("{what}: {e}"))
}

fn hear(s: &mut Session, id: u32, k: u32) {
    s.controller().connect_out(port(id * 16 + k, 0)).unwrap();
    s.controller().commit().unwrap();
}

fn file(p: &std::path::Path) -> Value {
    json!({ "file": p.to_str().unwrap(), "path": format!("Kit/{}", p.file_name().unwrap().to_string_lossy()), "name": p.file_name().unwrap().to_string_lossy() })
}

/// What a Sound module with the file open, cabled into Edit and played from
/// its start, gives: the file as it is, through MGL's transport.
fn as_edit_plays(path: &std::path::Path, frames: usize) -> (Vec<f32>, Vec<f32>) {
    let (mut s, mut audio) = Session::with_config(48_000.0, exact());
    let sound = s.add("sound", 0.0, 0.0).unwrap();
    let edit = s.add("edit", 400.0, 0.0).unwrap();
    s.connect((sound, 0), (edit, 0)).unwrap();
    s.sound_open(sound, path.to_str().unwrap(), &json!({ "kind": "file" }), false).unwrap();
    hear(&mut s, edit, 0);
    s.edit_transport(edit, &json!({ "play": true })).unwrap();
    render(&mut audio, frames, 256)
}

#[test]
fn the_audition_plays_the_file_as_it_is() {
    for rate in [48_000, 44_100] {
        let path = wav(rate);
        let (mut s, mut audio) = Session::with_config(48_000.0, exact());
        let b = s.add("browse", 0.0, 0.0).unwrap();
        hear(&mut s, b, 1);
        let i = call(&mut s, b, "play", file(&path));
        assert_eq!(i["playing"], true);
        let (l, r) = render(&mut audio, 96_000, 256);
        let (el, er) = as_edit_plays(&path, 96_000);
        assert!(peak(&l) > 0.1);
        assert_same(&format!("left at {rate}"), &l, &el);
        assert_same(&format!("right at {rate}"), &r, &er);
        // Past its end, it stops, as MGL's transport does with no loop.
        let i = call(&mut s, b, "info", Value::Null);
        assert_eq!(i["playing"], false, "{i}");
    }
}

#[test]
fn the_same_sound_again_pauses_and_plays_and_stop_goes_back() {
    let path = wav(48_000);
    let (mut s, mut audio) = Session::with_config(48_000.0, exact());
    let b = s.add("browse", 0.0, 0.0).unwrap();
    hear(&mut s, b, 1);
    call(&mut s, b, "play", file(&path));
    render(&mut audio, 4_096, 256);
    let at = call(&mut s, b, "info", Value::Null)["at"].as_f64().unwrap();
    assert!(at >= 4_000.0, "{at}");
    let i = call(&mut s, b, "play", file(&path));
    assert_eq!(i["playing"], false);
    let (l, _) = render(&mut audio, 2_048, 256);
    assert_eq!(peak(&l), 0.0);
    let i = call(&mut s, b, "play", file(&path));
    assert_eq!(i["playing"], true);
    assert_eq!(i["serial"], 1, "the same sound is not opened again");
    let (l, _) = render(&mut audio, 2_048, 256);
    assert!(peak(&l) > 0.1);
    let i = call(&mut s, b, "stop", Value::Null);
    assert_eq!(i["playing"], false);
    render(&mut audio, 256, 256);
    assert_eq!(call(&mut s, b, "info", Value::Null)["at"], 0.0);
    // Another sound is heard from its start.
    let other = wav(44_100);
    let i = call(&mut s, b, "play", file(&other));
    assert_eq!(i["serial"], 2);
    assert_eq!(i["heard"]["name"], "tone-44100.wav");
}

#[test]
fn the_library_pages_loop_goes_round() {
    let path = wav(48_000);
    let (mut s, mut audio) = Session::with_config(48_000.0, exact());
    let b = s.add("library", 0.0, 0.0).unwrap();
    hear(&mut s, b, 1);
    call(&mut s, b, "loop", json!({ "on": true }));
    call(&mut s, b, "play", file(&path));
    let (l, _) = render(&mut audio, 72_000 * 2 + 1_000, 256);
    assert!(peak(&l[72_000 + 500..]) > 0.1, "round again");
    assert_eq!(&l[72_000..72_100], &l[..100], "from its start");
    assert_eq!(call(&mut s, b, "info", Value::Null)["playing"], true);
}

#[test]
fn a_sound_chosen_opens_in_every_sound_module_cabled_from_it() {
    let path = wav(44_100);
    let (mut s, _audio) = Session::with_config(48_000.0, exact());
    let b = s.add("browse", 0.0, 0.0).unwrap();
    let one = s.add("sound", 0.0, 0.0).unwrap();
    let two = s.add("sound", 0.0, 0.0).unwrap();
    let alone = s.add("sound", 0.0, 0.0).unwrap();
    // Nothing cabled: nothing opened, and the face is told so.
    assert_eq!(call(&mut s, b, "open", file(&path))["opened"], json!([]));
    s.connect((b, 0), (one, 0)).unwrap();
    s.connect((b, 0), (two, 0)).unwrap();
    assert_eq!(call(&mut s, b, "cabled", Value::Null)["sounds"], json!([one, two]));
    assert_eq!(call(&mut s, b, "open", file(&path))["opened"], json!([one, two]));
    for id in [one, two] {
        let i = s.sound_info(id).unwrap();
        assert_eq!(i["frames"], 66_150, "{i}");
        let d = s.describe();
        let m = d["modules"].as_array().unwrap().iter().find(|m| m["id"] == id).unwrap().clone();
        assert_eq!(m["name"], "tone-44100.wav");
    }
    let d = s.describe();
    let m = d["modules"].as_array().unwrap().iter().find(|m| m["id"] == alone).unwrap().clone();
    assert_eq!(m["name"], Value::Null, "the one not cabled is left as it was");
    // Undone, it opens there no more.
    s.disconnect((b, 0), (two, 0)).unwrap();
    assert_eq!(call(&mut s, b, "cabled", Value::Null)["sounds"], json!([one]));
}

#[test]
fn only_a_browses_sound_goes_into_a_sound_modules_library_socket() {
    let (mut s, _audio) = Session::with_config(48_000.0, exact());
    let b = s.add("browse", 0.0, 0.0).unwrap();
    let l = s.add("library", 0.0, 0.0).unwrap();
    let a = s.add("sound", 0.0, 0.0).unwrap();
    let c = s.add("sound", 0.0, 0.0).unwrap();
    let out = s.add("output", 0.0, 0.0).unwrap();
    let edit = s.add("edit", 0.0, 0.0).unwrap();
    // A Sound's own sound is not a choice.
    assert!(s.connect((a, 0), (c, 0)).is_err());
    // Browse's Sound does not go into Edit (it is a choice, not a document).
    assert!(s.connect((b, 0), (edit, 0)).is_err());
    // Its Audio is the audition's: into an output, yes; into a Sound, no.
    s.connect((b, 1), (out, 0)).unwrap();
    assert!(s.connect((b, 1), (a, 0)).is_err());
    s.connect((l, 0), (a, 0)).unwrap();
    assert!(s.connect((b, 0), (a, 0)).is_err(), "one cable into an input");
    s.connect((b, 0), (c, 0)).unwrap();
}

#[test]
fn a_canvas_saved_and_loaded_keeps_the_page_and_its_cables_and_opens_silent() {
    let path = wav(48_000);
    let (mut s, _audio) = Session::with_config(48_000.0, exact());
    let b = s.add("browse", 10.0, 20.0).unwrap();
    let snd = s.add("sound", 0.0, 0.0).unwrap();
    s.connect((b, 0), (snd, 0)).unwrap();
    let ui = json!({ "pane": "search", "open": ["Kit"], "filter": "kick", "type": "Drums", "sort": "length", "picked": "Kit/tone.wav" });
    call(&mut s, b, "ui", ui.clone());
    call(&mut s, b, "play", file(&path));
    let saved = s.save();
    let (mut t, mut audio) = Session::with_config(48_000.0, exact());
    t.load(&saved).unwrap();
    let i = call(&mut t, b, "info", Value::Null);
    assert_eq!(i["ui"], ui);
    assert_eq!(i["playing"], false);
    assert_eq!(i["heard"], Value::Null);
    assert_eq!(call(&mut t, b, "cabled", Value::Null)["sounds"], json!([snd]));
    hear(&mut t, b, 1);
    let (l, _) = render(&mut audio, 4_096, 256);
    assert_eq!(peak(&l), 0.0);
}

#[test]
fn nothing_on_the_audio_thread_allocates_while_browse_auditions() {
    assert_the_check_is_on();
    let a = wav(48_000);
    let c = wav(44_100);
    let (mut s, mut audio) = Session::with_config(48_000.0, exact());
    let b = s.add("browse", 0.0, 0.0).unwrap();
    hear(&mut s, b, 1);
    call(&mut s, b, "play", file(&a));
    render(&mut audio, 4_096, 256);
    s.collect();
    let before = counted();
    for i in 0..12 {
        let f = if i % 2 == 0 { &c } else { &a };
        call(&mut s, b, "play", file(f));
        render(&mut audio, 1_024, 256);
        call(&mut s, b, "seek", json!({ "frame": 1000 * i }));
        call(&mut s, b, "loop", json!({ "on": i % 3 == 0 }));
        render(&mut audio, 1_024, 256);
        s.collect();
    }
    call(&mut s, b, "stop", Value::Null);
    render(&mut audio, 1_024, 256);
    assert_eq!(counted() - before, 0, "allocations or frees inside a render; the last sizes: {:?}", last_sizes());
}
