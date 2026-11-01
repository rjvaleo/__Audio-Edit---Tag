//! Writing the chopper's slices into the library.
//!
//! The Chop panel (`ui/chop.js`, from Recycle Reborn) cuts a sound into the
//! pieces between its silences and encodes each as a WAV in the browser, exactly
//! as Recycle Reborn did. Where Recycle Reborn downloaded them, this app puts
//! them beside the sound they came from, in a folder of their own, so they are
//! in the library at once: in Browse, on the sound map, ready to play. What is
//! tested here is that one route: where a slice goes, that nothing is ever
//! overwritten, and that it cannot be used to write anywhere else.

use server::http::{Request, Response};
use server::state::App;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

struct Scratch {
    data: PathBuf,
    library: PathBuf,
}

impl Scratch {
    fn new(name: &str) -> Self {
        let base = std::env::temp_dir().join(format!("audiolab-chop-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let data = base.join("data");
        let library = base.join("library");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(library.join("kit")).unwrap();
        Scratch { data, library }
    }

    fn app(&self) -> Arc<App> {
        let app = Arc::new(App::new(self.data.clone()));
        app.set_library(self.library.clone()).unwrap();
        app
    }

    fn sound(&self, rel: &str) {
        let path = self.library.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, wav(4410)).unwrap();
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(self.data.parent().unwrap());
    }
}

/// A slice as the panel sends it: a 16-bit mono WAV.
fn wav(frames: usize) -> Vec<u8> {
    let mut out = audio_core::wav::header((frames * 2) as u64, 1, 44_100, audio_core::Codec::PcmI16).to_vec();
    for i in 0..frames {
        out.extend_from_slice(&(((i as f32 / 30.0).sin() * 9000.0) as i16).to_le_bytes());
    }
    out
}

fn save(app: &Arc<App>, source: &str, name: &str, body: Vec<u8>) -> Response {
    let mut query = HashMap::new();
    query.insert("p".to_string(), source.to_string());
    query.insert("name".to_string(), name.to_string());
    server::routes::route(
        app,
        &Request { method: "POST".into(), path: "/api/chop/save".into(), query, headers: HashMap::new(), body },
    )
}

fn json(r: &Response) -> server::json::Value {
    server::json::parse(&String::from_utf8_lossy(&r.body)).expect("the answer is JSON")
}

fn text(v: &server::json::Value, key: &str) -> String {
    v.get(key).and_then(|x| x.as_str()).unwrap_or_default().to_string()
}

#[test]
fn a_slice_goes_beside_its_sound_in_a_folder_of_its_own() {
    let s = Scratch::new("beside");
    s.sound("kit/break.wav");
    let app = s.app();
    let r = save(&app, "kit/break.wav", "break_0001.wav", wav(441));
    assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
    let v = json(&r);
    assert_eq!(text(&v, "path"), "kit/break slices/break_0001.wav");
    let written = fs::read(s.library.join("kit/break slices/break_0001.wav")).unwrap();
    assert_eq!(written, wav(441), "the bytes are the slice as sent");
}

#[test]
fn a_slice_never_replaces_one_already_there() {
    let s = Scratch::new("unique");
    s.sound("kit/break.wav");
    let app = s.app();
    assert_eq!(save(&app, "kit/break.wav", "break_0001.wav", wav(441)).status, 200);
    let again = json(&save(&app, "kit/break.wav", "break_0001.wav", wav(882)));
    assert_eq!(text(&again, "path"), "kit/break slices/break_0001 (2).wav");
    assert_eq!(fs::read(s.library.join("kit/break slices/break_0001.wav")).unwrap(), wav(441));
}

#[test]
fn what_is_not_a_wav_is_refused() {
    let s = Scratch::new("notwav");
    s.sound("kit/break.wav");
    let app = s.app();
    assert_eq!(save(&app, "kit/break.wav", "break_0001.wav", b"hello".to_vec()).status, 400);
    assert_eq!(save(&app, "kit/break.wav", "break_0001.txt", wav(441)).status, 400);
    assert!(!s.library.join("kit/break slices").exists());
}

#[test]
fn it_writes_nowhere_but_beside_a_sound_in_the_library() {
    let s = Scratch::new("escape");
    s.sound("kit/break.wav");
    let app = s.app();
    // A source that is not in the library.
    assert_eq!(save(&app, "../outside.wav", "x.wav", wav(441)).status, 404);
    assert_eq!(save(&app, "kit/missing.wav", "x.wav", wav(441)).status, 404);
    // A name that tries to climb out of the slices folder is flattened into it.
    let v = json(&save(&app, "kit/break.wav", "../../x.wav", wav(441)));
    let path = text(&v, "path");
    assert!(path.starts_with("kit/break slices/"), "{path}");
    assert!(s.library.join(&path).exists());
}
