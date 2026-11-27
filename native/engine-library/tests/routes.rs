//! The library in the app against MGL's own server: every route the Browse
//! and Library pages ask, asked of the app's `Library` and of MGL's whole
//! route table (`server::routes::route`, what MGL's server answers with),
//! gives the same status, type and bytes, on the same library, step by step
//! through a session of the page: the folders, a folder's files, the types,
//! a type's files, the pictures, the stats, sounds like one, what was heard,
//! the sound maps, the tags set and committed, the folder picker, the library
//! set, the audio, the scan, the PC's library with no PC. Every route the app
//! answers is one MGL's table has.

use engine_library::{request, Library, ROUTES};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// A library of a few sounds in two folders, and a data folder, at `base`.
fn make(base: &Path) -> (PathBuf, PathBuf) {
    let _ = std::fs::remove_dir_all(base);
    let data = base.join("data");
    let lib = base.join("library");
    std::fs::create_dir_all(&data).unwrap();
    for (rel, frames, f) in [
        ("Kit/kick.wav", 6_000, 9.0),
        ("Kit/snare 02.wav", 9_000, 3.0),
        ("Kit/hat.wav", 3_000, 1.5),
        ("Pads/long pad.wav", 60_000, 40.0),
        ("Pads/swell.wav", 40_000, 60.0),
    ] {
        let path = lib.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut out = audio_core::wav::header((frames * 2) as u64, 1, 44_100, audio_core::Codec::PcmI16).to_vec();
        for i in 0..frames {
            let decay = (-(i as f32) / (frames as f32 / 4.0)).exp();
            let noise = (((i as u64).wrapping_mul(2654435761) >> 7) % 2000) as f32 / 1000.0 - 1.0;
            let v = (((i as f32 / f).sin() * 0.7 + noise * 0.3) * decay * 12_000.0) as i16;
            out.extend_from_slice(&v.to_le_bytes());
        }
        std::fs::write(path, out).unwrap();
    }
    std::fs::write(lib.join("Kit/notes.txt"), "not a sound").unwrap();
    (data, lib)
}

type Ask<'a> = dyn Fn(&str, &str, &[u8]) -> (u16, String, Vec<u8>) + 'a;

/// The page's session, step by step, through `ask`: every answer kept.
fn session(ask: &Ask<'_>, lib: &Path) -> Vec<(String, (u16, String, Vec<u8>))> {
    let mut out = Vec::new();
    let mut step = |m: &str, t: &str, b: &str| {
        let r = ask(m, t, b.as_bytes());
        out.push((format!("{m} {t}"), r));
    };
    step("GET", "/api/state", "");
    step("POST", "/api/scan", "{}");
    for _ in 0..2000 {
        let r = ask("GET", "/api/scan", b"");
        if !String::from_utf8_lossy(&r.2).contains("\"running\":true") {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    step("GET", "/api/scan", "");
    step("GET", "/api/state", "");
    step("GET", "/api/folders", "");
    step("GET", "/api/order", "");
    step("POST", "/api/order", r#"{"order":["Pads","Kit"]}"#);
    step("GET", "/api/order", "");
    step("GET", "/api/files?folder=Kit", "");
    step("GET", "/api/files?folder=Pads", "");
    step("GET", "/api/files?folder=Nowhere", "");
    step("GET", "/api/types", "");
    step("GET", "/api/types?all=1", "");
    step("GET", "/api/type-files?cats=SAMPLE-SHORT,DRUM-ONESHOT,ONE-SHOT,PAD-BED,SAMPLE&sort=name&offset=0&limit=200", "");
    step("GET", "/api/type-files?cats=SAMPLE-SHORT,DRUM-ONESHOT,ONE-SHOT,PAD-BED,SAMPLE&sort=length&offset=1&limit=2&q=a", "");
    step("POST", "/api/thumbs", r#"{"paths":["Kit/kick.wav","Kit/hat.wav","Pads/swell.wav","Kit/notes.txt"],"cols":54}"#);
    step("GET", "/api/peaks?p=Pads%2Flong%20pad.wav&cols=400", "");
    step("GET", "/api/stats?p=Kit%2Fsnare%2002.wav", "");
    step("GET", "/api/stats?p=..%2F..%2Fetc%2Fpasswd", "");
    step("GET", "/api/similar?p=Kit%2Fkick.wav&limit=1", "");
    step("GET", "/api/similar?p=Kit%2Fkick.wav&limit=40", "");
    step("GET", "/api/labels?folder=Kit", "");
    step("GET", "/api/sounds", "");
    step("GET", "/api/space", "");
    step("GET", "/api/map", "");
    step("GET", "/api/soundmap", "");
    step("GET", "/api/soundmap/near?p=Kit%2Fkick.wav", "");
    step("POST", "/api/usertags", r#"{"path":"Kit/kick.wav","tags":["punchy","time stretched"]}"#);
    step("GET", "/api/similar?p=Kit%2Fhat.wav&limit=1", "");
    step("GET", "/api/usertag?tag=punchy", "");
    step("POST", "/api/save", r#"{"folders":{"Kit":{"level1":"Drum","level2":"Kit","tags":"kick, snare","notes":"made by hand"}},"files":{"Kit/kick.wav":{"level1":"Kick drum","tags":"808"}}}"#);
    step("GET", "/api/similar?p=Kit%2Fkick.wav&limit=1", "");
    step("GET", "/api/folders", "");
    step("GET", &format!("/api/browse?path={}", urlish(lib)), "");
    step("GET", &format!("/api/browse?path={}", urlish(&lib.join("Kit"))), "");
    step("POST", "/api/library", &format!(r#"{{"path":{:?}}}"#, lib.to_string_lossy()));
    step("GET", "/audio?p=Kit%2Fhat.wav", "");
    step("GET", "/audio?p=Kit%2Fmissing.wav", "");
    step("POST", "/api/scan/stop", "");
    step("GET", "/api/pc/library", "");
    step("POST", "/api/pc/fetch", r#"{"file":"sounds/2026-11-14/a.flac"}"#);
    step("GET", "/api/pc/audio?file=sounds%2F2026-11-14%2Fa.flac", "");
    step("GET", "/api/nothing", "");
    out
}

fn urlish(p: &Path) -> String {
    p.to_string_lossy().bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

fn app_at(base: &Path) -> Arc<server_core::state::App> {
    std::env::set_var("MGL_NO_MIDI", "1");
    std::env::remove_var("AUDIOLAB_GPU_HOST");
    let (data, lib) = make(base);
    let app = Arc::new(server_core::state::App::new(data));
    app.set_library(lib).unwrap();
    app
}

#[test]
fn every_answer_is_mgls_own() {
    // MGL's listening model, where MGL keeps it, so "heard" is measured too.
    let models = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../models");
    if models.join("yamnet.onnx").is_file() {
        std::env::set_var("AUDIOLAB_MODELS", &models);
    }
    let base = std::env::temp_dir().join(format!("library-routes-{}", std::process::id()));
    let lib = base.join("library");

    // The app's library.
    let app = app_at(&base);
    let ours = Library::on(Arc::clone(&app));
    let a = session(&|m, t, b| {
        let r = ours.call(m, t, b);
        (r.status, r.content_type, r.body)
    }, &lib);
    drop(ours);
    drop(app);

    // MGL's server, on the same library made again in the same place.
    let app = app_at(&base);
    let b = session(&|m, t, body| {
        let req = request(m, t, body).unwrap();
        let r = server::routes::route(&app, &req);
        (r.status, r.content_type, if m == "HEAD" { Vec::new() } else { r.body })
    }, &lib);

    assert_eq!(a.len(), b.len());
    let mut heard = false;
    for ((step, x), (_, y)) in a.iter().zip(&b) {
        assert_eq!((x.0, &x.1), (y.0, &y.1), "{step}: status or type");
        assert!(x.2 == y.2, "{step}: the bytes differ\n ours: {}\n MGL's: {}", String::from_utf8_lossy(&x.2[..x.2.len().min(400)]), String::from_utf8_lossy(&y.2[..y.2.len().min(400)]));
        if step.starts_with("GET /api/labels") && x.0 == 200 {
            heard = String::from_utf8_lossy(&x.2).contains("label");
        }
    }
    // The session says something: the library was scanned and listed.
    let folders = &a.iter().find(|(s, _)| s == "GET /api/folders").unwrap().1;
    assert!(String::from_utf8_lossy(&folders.2).contains("\"Kit\""));
    let audio = &a.iter().find(|(s, _)| s == "GET /audio?p=Kit%2Fhat.wav").unwrap().1;
    assert_eq!(audio.0, 200);
    assert!(audio.2.starts_with(b"RIFF"));
    eprintln!("heard measured: {heard}");
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn every_route_answered_is_one_mgls_table_has() {
    let base = std::env::temp_dir().join(format!("library-table-{}", std::process::id()));
    let app = app_at(&base);
    for (m, p) in ROUTES {
        let req = request(m, p, b"").unwrap();
        let r = server::routes::route(&app, &req);
        assert!(!(r.status == 404 && String::from_utf8_lossy(&r.body).contains("no such endpoint")), "{m} {p} is not one of MGL's");
        let ours = engine_library::route(&app, &req);
        assert!(!(ours.status == 404 && String::from_utf8_lossy(&ours.body).contains("no such endpoint")), "{m} {p} is not answered here");
    }
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn the_first_open_copies_mgls_files_and_later_ones_keep_the_apps() {
    let base = std::env::temp_dir().join(format!("library-seed-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    let mgl = base.join("mgl");
    std::fs::create_dir_all(&mgl).unwrap();
    let (a, b) = (base.join("lib-a"), base.join("lib-b"));
    std::fs::create_dir_all(&a).unwrap();
    std::fs::create_dir_all(&b).unwrap();
    std::fs::write(mgl.join("config.json"), format!(r#"{{"library":{:?}}}"#, a.to_string_lossy())).unwrap();
    std::fs::write(mgl.join("USER-TAGS.tsv"), "").unwrap();
    std::fs::write(mgl.join("PRESETS.json"), "{}").unwrap();
    let home = base.join("home");
    let l = Library::open(&home, Some(&mgl), None);
    assert!(home.join("config.json").is_file());
    assert!(!home.join("PRESETS.json").exists(), "only the library's files");
    let state = String::from_utf8(l.call("GET", "/api/state", b"").body).unwrap();
    assert!(state.contains("lib-a"), "{state}");
    drop(l);
    // MGL's changes later are not taken: the app's copy is its own now.
    let later = format!(r#"{{"library":{:?}}}"#, b.to_string_lossy());
    std::fs::write(mgl.join("config.json"), &later).unwrap();
    let l = Library::open(&home, Some(&mgl), None);
    let state = String::from_utf8(l.call("GET", "/api/state", b"").body).unwrap();
    assert!(state.contains("lib-a") && !state.contains("lib-b"), "{state}");
    assert_eq!(std::fs::read_to_string(mgl.join("config.json")).unwrap(), later, "MGL's files are only read");
    let _ = std::fs::remove_dir_all(&base);
}
