//! MGL's library, in the app.
//!
//! The Browse page (the folders and their files, search, Browse's types, the
//! scan, the tags, sounds like this one, the sound map, the stats of a sound)
//! and the Library page (the PC's own sounds) ask MGL's server for everything
//! they show. Here the same routes are answered in-process, by the same
//! functions MGL's server calls (`server-library`, and `server-stems` for the
//! PC's library), on an [`App`] of MGL's own: so every answer is MGL's, to
//! the byte, and the app needs no server running.
//!
//! **Whose files.** The app keeps its own copy of MGL's library files (the
//! index, the fingerprints, what was heard, the tags, the order) in its home,
//! made from MGL's `data/` the first time it is opened, so the app lists the
//! same library at once. From then on a scan, a tag or a new order is the
//! app's, written to its copy; MGL's own files are only ever read. A Commit
//! writes `_TAGS.txt` into the library's folders, as MGL's does: they are the
//! library's, shared by both.
//!
//! Every call is safe from any thread, and none touches the audio thread.

use server_core::http::{parse_request, Request, Response};
use server_core::json::Value;
use server_core::state::App;
use server_library::routes::*;
use server_stems::routes::{api_pc_audio, api_pc_fetch, api_pc_library};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;

/// MGL's library files, copied into the app's home the first time.
pub const SEEDED: &[&str] = &[
    "config.json",
    "AUDIO-INDEX.tsv",
    "FINGERPRINTS.tsv",
    "LABELS.tsv",
    "EMBEDDINGS.tsv",
    "USER-TAGS.tsv",
    "TAG-OVERRIDES.json",
    "FOLDER-ORDER.json",
    "GPU.json",
];

/// The library, open.
pub struct Library {
    app: Arc<App>,
    home: PathBuf,
}

/// One answer: as MGL's server would send it.
pub struct Reply {
    pub status: u16,
    pub content_type: String,
    pub body: Vec<u8>,
}

impl Library {
    /// The library kept in `home` (made if it isn't there). With `mgl`, MGL's
    /// own data folder: its library files are copied in when `home` has none
    /// yet. `models`: where MGL's listening model is (`yamnet.onnx`), when
    /// nothing else has said.
    pub fn open(home: &Path, mgl: Option<&Path>, models: Option<&Path>) -> Library {
        let _ = std::fs::create_dir_all(home);
        if let Some(mgl) = mgl {
            if !home.join("config.json").exists() && !home.join("AUDIO-INDEX.tsv").exists() {
                for f in SEEDED {
                    let from = mgl.join(f);
                    if from.is_file() {
                        let part = home.join(format!("{f}.part"));
                        if std::fs::copy(&from, &part).is_ok() {
                            let _ = std::fs::rename(&part, home.join(f));
                        }
                    }
                }
            }
        }
        if let Some(m) = models {
            if std::env::var_os("AUDIOLAB_MODELS").is_none() && m.join("yamnet.onnx").is_file() {
                std::env::set_var("AUDIOLAB_MODELS", m);
            }
        }
        // The Wave routes are not answered here, but MIDI is never opened by
        // a library either.
        if std::env::var_os("MGL_NO_MIDI").is_none() {
            std::env::set_var("MGL_NO_MIDI", "1");
        }
        Library { app: Arc::new(App::new(home.to_path_buf())), home: home.to_path_buf() }
    }

    /// A library on an [`App`] already made (the tests'), sharing it.
    pub fn on(app: Arc<App>) -> Library {
        let home = app.data_dir.clone();
        Library { app, home }
    }

    pub fn home(&self) -> &Path {
        &self.home
    }

    pub fn app(&self) -> &Arc<App> {
        &self.app
    }

    /// The library's folder, if one is chosen.
    pub fn folder(&self) -> Option<PathBuf> {
        self.app.library_path()
    }

    /// One request, as the page makes it: `target` is the path and its query
    /// (`/api/files?folder=Kit`), `body` what a POST carries.
    pub fn call(&self, method: &str, target: &str, body: &[u8]) -> Reply {
        let req = match request(method, target, body) {
            Ok(r) => r,
            Err(e) => return reply(Response::error(400, &e.to_string()), true),
        };
        let head = req.method == "HEAD";
        reply(route(&self.app, &req), !head)
    }
}

fn reply(r: Response, body: bool) -> Reply {
    Reply { status: r.status, content_type: r.content_type, body: if body { r.body } else { Vec::new() } }
}

/// The request, read by MGL's own reader from the bytes a browser would send.
pub fn request(method: &str, target: &str, body: &[u8]) -> std::io::Result<Request> {
    let mut raw = format!("{method} {target} HTTP/1.1\r\nHost: app\r\nContent-Length: {}\r\n", body.len());
    if !body.is_empty() {
        raw.push_str("Content-Type: application/json\r\n");
    }
    raw.push_str("\r\n");
    let mut bytes = raw.into_bytes();
    bytes.extend_from_slice(body);
    parse_request(&bytes[..])
}

/// The rows of MGL's route table (`core/crates/server/src/routes.rs`) that
/// the Browse and Library pages use, each calling what MGL's calls.
pub fn route(app: &Arc<App>, req: &Request) -> Response {
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/api/state") => api_state(app),
        ("GET", "/api/browse") => api_browse(req),
        ("POST", "/api/library") => api_set_library(app, req),
        ("GET", "/api/folders") => api_folders(app),
        ("GET", "/api/order") => api_order_get(app),
        ("POST", "/api/order") => api_order_set(app, req),
        ("GET", "/api/files") => api_files(app, req),
        ("GET", "/api/types") => api_types(app, req),
        ("GET", "/api/type-files") => api_type_files(app, req),
        ("GET", "/api/peaks") => api_peaks(app, req),
        ("POST", "/api/thumbs") => api_thumbs(app, req),
        ("GET", "/api/stats") => api_stats(app, req),
        ("GET", "/api/pc/library") => api_pc_library(app, req),
        ("POST", "/api/pc/fetch") => api_pc_fetch(app, req),
        ("GET", "/api/pc/audio") => api_pc_audio(app, req),
        ("GET", "/api/similar") => api_similar(app, req),
        ("GET", "/api/labels") => api_labels(app, req),
        ("GET", "/api/space") => api_space(app),
        ("GET", "/api/map") => api_map(app),
        ("GET", "/api/soundmap") => api_soundmap(app),
        ("GET", "/api/soundmap/near") => api_soundmap_near(app, req),
        ("GET", "/api/sounds") => api_sounds(app),
        ("POST", "/api/usertags") => api_user_tags_set(app, req),
        ("GET", "/api/usertag") => api_user_tag_members(app, req),
        ("GET" | "HEAD", "/audio") => api_audio(app, req),
        ("GET", "/api/scan") => api_scan_status(app),
        ("POST", "/api/scan") => api_scan_start(app),
        ("POST", "/api/scan/stop") => {
            app.scan.cancel.store(true, Ordering::Relaxed);
            Response::json(Value::obj().set("ok", true).to_string())
        }
        ("POST", "/api/save") => api_save(app, req),
        ("OPTIONS", _) => Response::text(200, ""),
        _ => Response::error(404, "no such endpoint"),
    }
}

/// The routes answered here, as `(method, path)`: what the tests hold to
/// MGL's table.
pub const ROUTES: &[(&str, &str)] = &[
    ("GET", "/api/state"),
    ("GET", "/api/browse"),
    ("POST", "/api/library"),
    ("GET", "/api/folders"),
    ("GET", "/api/order"),
    ("POST", "/api/order"),
    ("GET", "/api/files"),
    ("GET", "/api/types"),
    ("GET", "/api/type-files"),
    ("GET", "/api/peaks"),
    ("POST", "/api/thumbs"),
    ("GET", "/api/stats"),
    ("GET", "/api/pc/library"),
    ("POST", "/api/pc/fetch"),
    ("GET", "/api/pc/audio"),
    ("GET", "/api/similar"),
    ("GET", "/api/labels"),
    ("GET", "/api/space"),
    ("GET", "/api/map"),
    ("GET", "/api/soundmap"),
    ("GET", "/api/soundmap/near"),
    ("GET", "/api/sounds"),
    ("POST", "/api/usertags"),
    ("GET", "/api/usertag"),
    ("GET", "/audio"),
    ("GET", "/api/scan"),
    ("POST", "/api/scan"),
    ("POST", "/api/scan/stop"),
    ("POST", "/api/save"),
];
