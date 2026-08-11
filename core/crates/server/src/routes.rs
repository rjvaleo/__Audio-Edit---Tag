//! Request routing.

use crate::http::{parse_range, Request, Response};
use crate::json::{self, Value};
use crate::safety::{resolve_for_write, resolve_within};
use crate::state::{App, Index};
use audio_core::{probe, wav, FileSource, RandomAccessSource};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;

/// The 3D grain visualiser.
///
/// Served from here rather than opened as a file so it is same-origin with the
/// API and can therefore watch the engine. Opened directly off disk it still
/// works — it falls back to its own schedule and simply has no player to follow.
pub const GRAINS_3D: &str = include_str!("../../../../visualiser/grain-views.html");
/// p5.js, vendored rather than fetched.
///
/// It was the one thing the app went to the internet for, which made the grain
/// views the only page that did not work offline — against a front page that
/// promises nothing else needs installing. A megabyte on the binary is a fair
/// price for the claim being true.
pub const P5_JS: &str = include_str!("../../../../visualiser/p5.min.js");
/// Poppins and Lora, latin subsets, inlined as data URIs. Same reason as p5:
/// the page was reaching for Google Fonts, which is a network round trip and,
/// on a machine with no network, a different typeface than the one it was
/// designed in.
pub const FONTS_CSS: &str = include_str!("../../../../visualiser/fonts.css");

pub const UI_HTML: &str = include_str!("../../../../ui/index.html");
pub const UI_CSS: &str = include_str!("../../../../ui/app.css");
pub const UI_JS: &str = include_str!("../../../../ui/app.js");

pub fn route(app: &Arc<App>, req: &Request) -> Response {
    match (req.method.as_str(), req.path.as_str()) {
        // The interface is compiled into the binary, so a new build is a new
        // page — but the browser was never told that. With no Cache-Control and
        // no validator, it applies its own heuristics and happily serves a
        // stale app.js through restarts and reloads alike, which means a rebuilt
        // interface silently does not appear. Nothing here is worth caching:
        // it is served from local memory over the loopback.
        ("GET" | "HEAD", "/") | ("GET" | "HEAD", "/index.html") => {
            Response::ok("text/html; charset=utf-8", UI_HTML.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/grains3d") => {
            Response::ok("text/html; charset=utf-8", GRAINS_3D.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        // The one asset worth caching: a megabyte of library that only changes
        // when the binary does.
        ("GET" | "HEAD", "/p5.min.js") => {
            Response::ok("text/javascript; charset=utf-8", P5_JS.as_bytes().to_vec())
                .with("Cache-Control", "public, max-age=31536000, immutable")
        }
        ("GET" | "HEAD", "/fonts.css") => {
            Response::ok("text/css; charset=utf-8", FONTS_CSS.as_bytes().to_vec())
                .with("Cache-Control", "public, max-age=31536000, immutable")
        }
        ("GET" | "HEAD", "/app.css") => {
            Response::ok("text/css; charset=utf-8", UI_CSS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/app.js") => {
            Response::ok("text/javascript; charset=utf-8", UI_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }

        ("GET", "/api/state") => api_state(app),
        ("GET", "/api/browse") => api_browse(req),
        ("POST", "/api/library") => api_set_library(app, req),
        ("GET", "/api/folders") => api_folders(app),
        ("GET", "/api/order") => api_order_get(app),
        ("POST", "/api/order") => api_order_set(app, req),
        ("GET", "/api/files") => api_files(app, req),
        ("GET", "/api/peaks") => api_peaks(app, req),
        ("POST", "/api/thumbs") => api_thumbs(app, req),
        ("GET", "/api/spectrogram") => api_spectrogram(app, req),
        ("GET", "/api/stats") => api_stats(app, req),
        ("GET", "/api/markers") => api_markers_get(app, req),
        ("POST", "/api/markers") => api_markers_set(app, req),
        ("GET", "/api/rack") => api_rack_get(app, req),
        ("POST", "/api/rack") => api_rack_set(app, req),
        ("GET", "/api/presets") => api_presets_list(app),
        ("POST", "/api/presets") => api_preset_save(app, req),
        ("POST", "/api/presets/apply") => api_preset_apply(app, req),
        ("POST", "/api/presets/update") => api_preset_update(app, req),
        ("POST", "/api/presets/duplicate") => api_preset_duplicate(app, req),
        ("POST", "/api/presets/delete") => api_preset_delete(app, req),
        ("GET", "/api/grains") => api_grains(app, req),
        ("GET", "/api/edit") => api_edit_get(app, req),
        ("POST", "/api/edit") => api_edit_apply(app, req),
        ("POST", "/api/export") => api_export(app, req),
        ("GET", "/api/similar") => api_similar(app, req),
        ("GET", "/api/labels") => api_labels(app, req),
        ("GET", "/api/space") => api_space(app),
        ("GET", "/api/sounds") => api_sounds(app),
        ("POST", "/api/usertags") => api_user_tags_set(app, req),
        ("GET", "/api/usertag") => api_user_tag_members(app, req),
        ("POST", "/api/engine/load") => api_engine_load(app, req),
        ("GET", "/api/engine/state") => api_engine_state(app),
        ("POST", "/api/engine/transport") => api_engine_transport(app, req),
        ("GET", "/api/engine/grains") => api_engine_grains(app),
        ("POST", "/api/capture") => api_capture(app, req),
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

fn api_state(app: &Arc<App>) -> Response {
    let lib = app.library_path();
    let idx = app.index.read().unwrap();
    let (running, done, total, current) = app.scan.snapshot();
    let v = Value::obj()
        .set(
            "library",
            lib.as_ref()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
        )
        .set("indexed", !idx.is_empty())
        .set("files", idx.files.len())
        .set("folders", idx.folders.len())
        .set(
            "scan",
            Value::obj()
                .set("running", running)
                .set("done", done)
                .set("total", total)
                .set("current", current),
        );
    Response::json(v.to_string())
}

/// Directory listing for the folder picker.
///
/// This deliberately reaches outside the library — it is how the user chooses
/// one in the first place. It lists directory names only, never file contents.
fn api_browse(req: &Request) -> Response {
    let raw = req.param("path").unwrap_or("");
    let path = if raw.is_empty() {
        home_dir().unwrap_or_else(|| PathBuf::from("/"))
    } else {
        PathBuf::from(raw)
    };

    let Ok(entries) = std::fs::read_dir(&path) else {
        return Response::error(403, "cannot read that folder");
    };

    let mut dirs: Vec<Value> = Vec::new();
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if e.path().is_dir() {
            dirs.push(
                Value::obj()
                    .set("name", name)
                    .set("path", e.path().to_string_lossy().to_string()),
            );
        }
    }
    dirs.sort_by_key(|d| {
        d.get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("")
            .to_lowercase()
    });

    // Shortcuts the user is likely to want, so they are not forced to walk up
    // from wherever the picker happens to open.
    let mut places: Vec<Value> = Vec::new();
    for (label, p) in candidate_places() {
        if p.is_dir() {
            places.push(
                Value::obj()
                    .set("name", label)
                    .set("path", p.to_string_lossy().to_string()),
            );
        }
    }

    Response::json(
        Value::obj()
            .set("path", path.to_string_lossy().to_string())
            .set(
                "parent",
                path.parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default(),
            )
            .set("dirs", Value::Arr(dirs))
            .set("places", Value::Arr(places))
            .to_string(),
    )
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Useful starting points, per platform.
fn candidate_places() -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    if let Some(h) = home_dir() {
        out.push(("Home".to_string(), h.clone()));
        for sub in ["Desktop", "Documents", "Music", "Downloads"] {
            out.push((sub.to_string(), h.join(sub)));
        }
    }
    #[cfg(target_os = "macos")]
    {
        // External drives, which is where a library this size usually lives.
        if let Ok(vols) = std::fs::read_dir("/Volumes") {
            for v in vols.flatten() {
                out.push((
                    v.file_name().to_string_lossy().to_string(),
                    v.path(),
                ));
            }
        }
    }
    #[cfg(windows)]
    {
        for letter in b'A'..=b'Z' {
            let p = PathBuf::from(format!("{}:\\", letter as char));
            if p.is_dir() {
                out.push((format!("{}:", letter as char), p));
            }
        }
    }
    out
}

fn api_set_library(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(p) = v.get("path").and_then(|p| p.as_str()) else {
        return Response::error(400, "no path given");
    };
    let path = PathBuf::from(p);
    if !path.is_dir() {
        return Response::error(400, "that folder does not exist");
    }
    match app.set_library(path.clone()) {
        Ok(()) => Response::json(
            Value::obj()
                .set("ok", true)
                .set("library", path.to_string_lossy().to_string())
                .to_string(),
        ),
        Err(e) => Response::error(500, &e.to_string()),
    }
}

fn api_folders(app: &Arc<App>) -> Response {
    let idx = app.index.read().unwrap();
    let arr: Vec<Value> = idx
        .folders
        .iter()
        .map(|f| {
            Value::obj()
                .set("name", f.name.clone())
                .set("level1", f.level1.clone())
                .set("level2", f.level2.clone())
                .set("machine", f.machine.clone())
                .set("confidence", f.confidence.clone())
                .set("files", f.files)
                .set("audioFiles", f.audio_files)
                .set("headerFiles", f.header_files)
                .set("bytes", f.bytes)
                .set("minutes", f.minutes)
                .set("categories", f.categories.clone())
                .set("instruments", f.instruments.clone())
                .set("formats", f.formats.clone())
                .set("tags", f.tags.clone())
        })
        .collect();
    Response::json(Value::Arr(arr).to_string())
}

/// The user's hand-arranged folder order, if they have rearranged the tree.
fn api_order_get(app: &Arc<App>) -> Response {
    let names = std::fs::read_to_string(app.order_path())
        .ok()
        .and_then(|raw| json::parse(&raw))
        .and_then(|v| match v {
            Value::Arr(a) => Some(a),
            _ => None,
        })
        .unwrap_or_default();
    Response::json(Value::Arr(names).to_string())
}

fn api_order_set(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(Value::Arr(names)) = v.get("order").cloned() else {
        return Response::error(400, "expected an \"order\" array");
    };
    // Store names only; a folder that later disappears simply drops out of the
    // ordering rather than leaving a hole.
    let cleaned: Vec<Value> = names
        .into_iter()
        .filter(|n| matches!(n, Value::Str(s) if !s.is_empty()))
        .collect();
    match std::fs::write(app.order_path(), Value::Arr(cleaned).to_string()) {
        Ok(()) => Response::json(Value::obj().set("ok", true).to_string()),
        Err(e) => Response::error(500, &e.to_string()),
    }
}

fn api_files(app: &Arc<App>, req: &Request) -> Response {
    let Some(folder) = req.param("folder") else {
        return Response::error(400, "no folder given");
    };
    let idx = app.index.read().unwrap();
    let arr: Vec<Value> = idx
        .files
        .iter()
        .filter(|f| f.folder == folder)
        .map(|f| {
            Value::obj()
                .set("path", format!("{}/{}", f.folder, f.rel_path))
                .set("name", f.filename.clone())
                .set("subdir", f.subdir.clone())
                .set("bytes", f.bytes)
                .set("duration", f.duration)
                .set("sampleRate", f.sample_rate)
                .set("bits", f.bits)
                .set("channels", f.channels)
                .set("format", f.format.clone())
                .set("category", f.category.clone())
                .set("confidence", f.confidence.clone())
                .set("machine", f.machine.clone())
                .set("instrument", f.instrument.clone())
                .set("bpm", f.bpm.clone())
                .set("why", f.reasons.clone())
        })
        .collect();
    Response::json(Value::Arr(arr).to_string())
}

/// Resolve a library-relative path from the `p` query parameter.
fn library_file(app: &Arc<App>, req: &Request) -> Result<PathBuf, Response> {
    let Some(lib) = app.library_path() else {
        return Err(Response::error(400, "no library chosen"));
    };
    let Some(rel) = req.param("p") else {
        return Err(Response::error(400, "no path given"));
    };
    resolve_within(&lib, rel).ok_or_else(|| Response::error(404, "no such file in the library"))
}

fn api_peaks(app: &Arc<App>, req: &Request) -> Response {
    let path = match library_file(app, req) {
        Ok(p) => p,
        Err(r) => return r,
    };
    let mut reader = match audio_core::open(&path) {
        Ok(r) => r,
        Err(e) => return Response::error(400, &e.to_string()),
    };

    let info = *reader.info();
    // When the file has edits and the caller asks for them, the waveform shows
    // the edited timeline — otherwise the display would not match playback.
    let edited = req.param("edited") == Some("1");
    let list = if edited { app.edits.snapshot(req.param("p").unwrap_or("")) } else { None };
    let frames = list.as_ref().map_or(info.frames(), |l| l.frames());

    // Zoom range, in frames. Defaults to the whole file.
    let from: u64 = req.number("from", 0);
    let to: u64 = req.number("to", frames);
    let to = to.min(frames);
    let count = to.saturating_sub(from);
    // Cap the column count: a request for a million columns is a mistake, and
    // honouring it would allocate hundreds of megabytes.
    let columns: usize = req.number::<usize>("cols", 1000).clamp(1, 8192);

    let rel = req.param("p").unwrap_or("");
    let mut rack = app.racks.get(rel).build();
    let tile = match &list {
        Some(l) => edit::render::peak_tile_fx(l, &mut reader, &mut rack, from, count, columns),
        // No edits, but a rack can still be in play: render the source through
        // it so the waveform matches what comes out of the speakers.
        None if !rack.is_empty() => {
            let plain = edit::EditList::identity(info.frames(), info.channels, info.sample_rate);
            edit::render::peak_tile_fx(&plain, &mut reader, &mut rack, from, count, columns)
        }
        None => reader.peak_tile(from, count, columns),
    };
    let tile = match tile {
        Ok(t) => t,
        Err(e) => return Response::error(500, &e.to_string()),
    };

    // Flat arrays per channel rather than objects per column: the payload is
    // three numbers per pixel per channel and object overhead would dominate.
    let channels: Vec<Value> = (0..tile.channels)
        .map(|ch| {
            let cols = tile.channel(ch);
            Value::obj()
                .set("min", cols.iter().map(|c| c.min).collect::<Vec<f32>>())
                .set("max", cols.iter().map(|c| c.max).collect::<Vec<f32>>())
                .set("rms", cols.iter().map(|c| c.rms).collect::<Vec<f32>>())
        })
        .collect();

    Response::json(
        Value::obj()
            .set("frames", frames)
            .set("from", from)
            .set("to", to)
            .set("columns", tile.columns)
            .set("sampleRate", info.sample_rate)
            .set("channels", Value::Arr(channels))
            .to_string(),
    )
}

/// Waveform overviews for a batch of files, for the browser list.
///
/// Batched rather than one request per row: a folder of several hundred files
/// would otherwise queue behind the browser's per-host connection limit.
/// Each thumbnail is one byte per column, so a 28-column overview is 28 bytes.
fn api_thumbs(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(Value::Arr(paths)) = v.get("paths") else {
        return Response::error(400, "expected a \"paths\" array");
    };
    let cols = match v.get("cols") {
        Some(Value::Num(n)) => (*n as usize).clamp(4, 128),
        _ => 28,
    };
    let Some(lib) = app.library_path() else {
        return Response::error(400, "no library chosen");
    };

    let mut out = std::collections::BTreeMap::new();
    // Cap the batch so one oversized request cannot stall the server for
    // everyone else; the UI asks for more as the user scrolls.
    for item in paths.iter().take(400) {
        let Some(rel) = item.as_str() else { continue };
        let Some(path) = resolve_within(&lib, rel) else { continue };
        let Ok(mut reader) = audio_core::open(&path) else { continue };
        let frames = reader.info().frames();
        let Ok(tile) = reader.peak_tile(0, frames, cols) else { continue };

        // One byte per column: the larger of |min| and |max|, summed across
        // channels. A thumbnail this size cannot show more than an outline.
        let mut bytes = vec![0u8; tile.columns];
        for ch in 0..tile.channels {
            for (i, c) in tile.channel(ch).iter().enumerate() {
                let amp = c.max.abs().max(c.min.abs()).min(1.0);
                let v = (amp * 255.0) as u8;
                if v > bytes[i] {
                    bytes[i] = v;
                }
            }
        }
        out.insert(rel.to_string(), Value::Str(base64(&bytes)));
    }

    Response::json(Value::Obj(out).to_string())
}

fn api_spectrogram(app: &Arc<App>, req: &Request) -> Response {
    let path = match library_file(app, req) {
        Ok(p) => p,
        Err(r) => return r,
    };
    let mut reader = match audio_core::open(&path) {
        Ok(r) => r,
        Err(e) => return Response::error(400, &e.to_string()),
    };
    let frames = reader.info().frames();
    let from: u64 = req.number("from", 0);
    let to: u64 = req.number::<u64>("to", frames).min(frames);
    let columns: usize = req.number::<usize>("cols", 600).clamp(1, 2048);
    let fft_size: usize = req.number::<usize>("fft", 1024).clamp(64, 8192);

    let s = match reader.spectrogram(from, to.saturating_sub(from), columns, fft_size) {
        Ok(s) => s,
        Err(e) => return Response::error(500, &e.to_string()),
    };

    // One byte per cell, base64'd. A 600x513 tile is ~300 KB raw; as a JSON
    // array of numbers it would be nearer 1.5 MB.
    Response::json(
        Value::obj()
            .set("columns", s.columns)
            .set("bins", s.bins)
            .set("maxHz", s.max_hz)
            .set("floorDb", s.floor_db)
            .set("from", from)
            .set("to", to)
            .set("data", base64(&s.data))
            .to_string(),
    )
}

fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

fn api_markers_get(app: &Arc<App>, req: &Request) -> Response {
    let Some(key) = req.param("p") else {
        return Response::error(400, "no path given");
    };
    let store = app.markers.read().unwrap();
    Response::json(store.get(key).to_json().to_string())
}

fn api_markers_set(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(key) = v.get("p").and_then(|p| p.as_str()) else {
        return Response::error(400, "no path given");
    };
    let annotations = crate::docs::Annotations::from_json(&v);
    {
        let mut store = app.markers.write().unwrap();
        store.set(key, annotations);
        if let Err(e) = store.save(&app.markers_path()) {
            return Response::error(500, &e.to_string());
        }
    }
    let store = app.markers.read().unwrap();
    Response::json(store.get(key).to_json().to_string())
}

/// Build the starting edit document for a file, straight from its header.
fn identity_for(app: &Arc<App>, rel: &str) -> Option<edit::EditList> {
    let lib = app.library_path()?;
    let path = resolve_within(&lib, rel)?;
    let reader = audio_core::open(&path).ok()?;
    let info = reader.info();
    let fresh = edit::EditList::identity(info.frames(), info.channels, info.sample_rate);
    // Anything saved for this file is restored here, once, when its session is
    // first created — and only if the source still matches.
    Some(app.restore(rel, fresh))
}

fn api_rack_get(app: &Arc<App>, req: &Request) -> Response {
    let Some(rel) = req.param("p") else {
        return Response::error(400, "no path given");
    };
    let spec = app.racks.get(rel);
    let sr: u32 = req.number("sr", 48000);
    let curve: Vec<Value> = spec
        .eq_curve(sr, 96)
        .into_iter()
        .map(|(f, db)| Value::Arr(vec![Value::Num(f as f64), Value::Num(db as f64)]))
        .collect();
    Response::json(spec.to_json().set("curve", Value::Arr(curve)).to_string())
}

fn api_rack_set(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(rel) = v.get("p").and_then(|p| p.as_str()) else {
        return Response::error(400, "no path given");
    };
    let spec = crate::rack::RackSpec::from_json(&v);
    app.racks.set(rel, spec.clone());
    app.save_sessions();
    // Effects are live: a freshly built rack replaces the one the audio thread
    // holds, on its next block.
    let _ = crate::live::with(app, |h| h.shared.set_rack(crate::live::rack_for(app, rel)));

    let sr: u32 = match v.get("sr") {
        Some(Value::Num(n)) => *n as u32,
        _ => 48000,
    };
    let curve: Vec<Value> = spec
        .eq_curve(sr, 96)
        .into_iter()
        .map(|(f, db)| Value::Arr(vec![Value::Num(f as f64), Value::Num(db as f64)]))
        .collect();
    Response::json(spec.to_json().set("curve", Value::Arr(curve)).to_string())
}

/// The grain schedule for the visualiser.
///
/// Computed from the same enumeration the renderer uses, so the picture cannot
/// show grains the audio does not contain. No audio is read.
fn api_grains(app: &Arc<App>, req: &Request) -> Response {
    let Some(rel) = req.param("p") else {
        return Response::error(400, "no path given");
    };
    let Some(list) = app.edits.snapshot(rel) else {
        return Response::json(Value::obj().set("grains", Value::Arr(vec![])).to_string());
    };
    let st = list.stretch;
    let events = fx::grain::grains(
        list.base_frames() as usize,
        list.sample_rate,
        st.ratio,
        st.semitones,
        st.window_ms,
        &st.grain,
    );

    // Cap what crosses the wire: a long file at high density is tens of
    // thousands of grains, and the display cannot resolve them anyway.
    let stride = (events.len() / 3000).max(1);

    // Measure what each grain actually sounds like, not just where it sits.
    // The visualiser is meant to be driven by the audio, so amplitude and
    // brightness come from the source window the grain reads, not from a
    // stand-in derived from the parameters.
    let source = app
        .library_path()
        .and_then(|lib| resolve_within(&lib, rel))
        .and_then(|p| audio_core::open(&p).ok())
        .and_then(|mut r| {
            let n = r.info().frames();
            r.read_frames(0, n).ok().map(|f| (f, r.info().channels.max(1) as usize))
        });

    let measure = |start: f32, len: usize| -> (f32, f32) {
        let Some((buf, ch)) = &source else { return (0.0, 0.0) };
        let frames = buf.len() / ch;
        let a = (start as usize).min(frames.saturating_sub(1));
        let b = (a + len).min(frames);
        if b <= a + 1 {
            return (0.0, 0.0);
        }
        // Every eighth frame is plenty for a display value and keeps a dense
        // grain stream from turning into a full second of arithmetic.
        let mut sum = 0f64;
        let mut n = 0u32;
        let mut crossings = 0u32;
        let mut prev = 0f32;
        for f in (a..b).step_by(8) {
            let v = buf[f * ch];
            sum += (v as f64) * (v as f64);
            if prev <= 0.0 && v > 0.0 {
                crossings += 1;
            }
            prev = v;
            n += 1;
        }
        let rms = if n > 0 { (sum / n as f64).sqrt() as f32 } else { 0.0 };
        // Zero-crossing rate as a cheap brightness proxy: no FFT per grain.
        let brightness = if n > 1 { crossings as f32 / n as f32 } else { 0.0 };
        (rms, brightness.min(1.0))
    };

    let arr: Vec<Value> = events
        .iter()
        .step_by(stride)
        .map(|e| {
            let (rms, bright) = measure(e.src_frame, e.size as usize);
            Value::Arr(vec![
                Value::Num(e.out_frame as f64),
                Value::Num(e.src_frame as f64),
                Value::Num(e.size as f64),
                Value::Num(e.pitch_semis as f64),
                Value::Num(rms as f64),
                Value::Num(bright as f64),
            ])
        })
        .collect();

    Response::json(
        Value::obj()
            .set("grains", Value::Arr(arr))
            .set("total", events.len())
            .set("shown", (events.len() + stride - 1) / stride)
            .set("outFrames", list.frames())
            .set("srcFrames", list.base_frames())
            .set("sampleRate", list.sample_rate)
            .set("granular", st.is_granular())
            .to_string(),
    )
}

fn api_presets_list(app: &Arc<App>) -> Response {
    let presets = app.presets.read().unwrap();
    let arr: Vec<Value> = presets.values().map(|p| p.to_json()).collect();
    Response::json(Value::obj().set("presets", Value::Arr(arr)).to_string())
}

/// Capture the current settings of a file under a name.
fn api_preset_save(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let name = v.get("name").and_then(|n| n.as_str()).unwrap_or("").trim().to_string();
    if name.is_empty() {
        return Response::error(400, "a preset needs a name");
    }
    let Some(rel) = v.get("p").and_then(|p| p.as_str()) else {
        return Response::error(400, "no path given");
    };
    // The file has to exist; it does not have to have been edited.
    //
    // This used to require an edit document and refuse without one, which meant
    // a file whose settings were all in the rack — the maximiser turned up and
    // nothing else — reported that it had no settings to save while plainly
    // having some. A file with no stretch spec has the default one, which is a
    // perfectly good thing to store alongside a rack.
    if identity_for(app, rel).is_none() {
        return Response::error(404, "no such file in the library");
    }

    let preset = crate::persist::Preset {
        name: name.clone(),
        note: v.get("note").and_then(|n| n.as_str()).unwrap_or("").to_string(),
        stretch: app.edits.snapshot(rel).map(|l| l.stretch).unwrap_or_default(),
        rack: app.racks.get(rel),
    };
    {
        let mut presets = app.presets.write().unwrap();
        presets.insert(name.clone(), preset);
        if let Err(e) = crate::persist::save_presets(&app.presets_path(), &presets) {
            return Response::error(500, &e.to_string());
        }
    }
    api_presets_list(app)
}

/// Drop a saved preset onto a file. Only settings move — no audio, no edits.
fn api_preset_apply(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let (Some(name), Some(rel)) = (
        v.get("name").and_then(|n| n.as_str()),
        v.get("p").and_then(|p| p.as_str()),
    ) else {
        return Response::error(400, "need a preset name and a path");
    };
    let Some(preset) = app.presets.read().unwrap().get(name).cloned() else {
        return Response::error(404, "no such preset");
    };
    let Some(identity) = identity_for(app, rel) else {
        return Response::error(404, "no such file in the library");
    };

    // The rack moves whenever the preset holds anything but a factory rack.
    //
    // This used to ask whether the *slots* were empty, which is a different
    // question: the channel maximiser lives in the rack beside the slots rather
    // than in a place of its own, so a preset that is nothing but a maximiser
    // setting has no slots and was silently dropped. The guard is still here —
    // a preset holding a factory rack should not wipe the one you have — it now
    // just asks about the whole rack.
    if preset.rack != crate::rack::RackSpec::empty() {
        app.racks.set(rel, preset.rack.clone());
    }
    let stretch = preset.stretch;
    // Applied as an ordinary edit, so it lands on the undo stack like anything
    // else and can simply be undone.
    let out = app.edits.with(rel, || identity, |s| {
        s.apply(|l| l.stretch = stretch);
        crate::docs::edit_json(s.list(), s.can_undo(), s.can_redo())
    });
    app.save_sessions();
    Response::json(out.to_string())
}

/// Edit a stored preset in place: its name, its note, or any of its values.
///
/// Separate from saving because the two want opposite things. Saving captures
/// whatever a file currently has and needs that file; this writes values given
/// outright and must work with nothing open at all, which is the whole point of
/// a manager — the preset is the thing being edited, not the sound.
///
/// Absent means unchanged here as everywhere else, so the manager can send back
/// only the part it touched.
fn api_preset_update(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(name) = v.get("name").and_then(|n| n.as_str()) else {
        return Response::error(400, "no name given");
    };
    let Some(mut preset) = app.presets.read().unwrap().get(name).cloned() else {
        return Response::error(404, "no such preset");
    };

    // Renaming to a name already in use would silently swallow the other one.
    let renamed = match v.get("to").and_then(|t| t.as_str()).map(str::trim) {
        Some(to) if to.is_empty() => return Response::error(400, "a preset needs a name"),
        Some(to) if to != name => {
            if app.presets.read().unwrap().contains_key(to) {
                return Response::error(409, "a preset with that name already exists");
            }
            preset.name = to.to_string();
            true
        }
        _ => false,
    };
    if let Some(note) = v.get("note").and_then(|n| n.as_str()) {
        preset.note = note.to_string();
    }
    // The values go through exactly the same readers the document uses, so the
    // manager cannot store anything the engines would refuse — every clamp is
    // applied once, in one place, and this is not a second place.
    if let Some(s) = v.get("stretch") {
        preset.stretch = crate::persist::stretch_from_json(s);
    }
    if let Some(r) = v.get("rack") {
        preset.rack = crate::rack::RackSpec::from_json(r);
    }

    {
        let mut presets = app.presets.write().unwrap();
        if renamed {
            presets.remove(name);
        }
        presets.insert(preset.name.clone(), preset);
        if let Err(e) = crate::persist::save_presets(&app.presets_path(), &presets) {
            return Response::error(500, &e.to_string());
        }
    }
    api_presets_list(app)
}

/// Store a new preset from values given outright, with no file involved.
///
/// The manager's Duplicate. It copies the *draft* rather than what is stored,
/// so a copy can be taken of edits without committing them to the original.
fn api_preset_duplicate(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let name = v.get("name").and_then(|n| n.as_str()).unwrap_or("").trim().to_string();
    if name.is_empty() {
        return Response::error(400, "a preset needs a name");
    }
    if app.presets.read().unwrap().contains_key(&name) {
        return Response::error(409, "a preset with that name already exists");
    }

    let preset = crate::persist::Preset {
        name: name.clone(),
        note: v.get("note").and_then(|n| n.as_str()).unwrap_or("").to_string(),
        stretch: v.get("stretch").map(crate::persist::stretch_from_json).unwrap_or_default(),
        rack: v
            .get("rack")
            .map(crate::rack::RackSpec::from_json)
            .unwrap_or_else(crate::rack::RackSpec::empty),
    };
    {
        let mut presets = app.presets.write().unwrap();
        presets.insert(name, preset);
        if let Err(e) = crate::persist::save_presets(&app.presets_path(), &presets) {
            return Response::error(500, &e.to_string());
        }
    }
    api_presets_list(app)
}

fn api_preset_delete(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(name) = v.get("name").and_then(|n| n.as_str()) else {
        return Response::error(400, "no name given");
    };
    {
        let mut presets = app.presets.write().unwrap();
        presets.remove(name);
        if let Err(e) = crate::persist::save_presets(&app.presets_path(), &presets) {
            return Response::error(500, &e.to_string());
        }
    }
    api_presets_list(app)
}

fn api_edit_get(app: &Arc<App>, req: &Request) -> Response {
    let Some(rel) = req.param("p") else {
        return Response::error(400, "no path given");
    };
    let Some(identity) = identity_for(app, rel) else {
        return Response::error(404, "no such file in the library");
    };
    let out = app.edits.with(rel, || identity, |s| {
        crate::docs::edit_json(s.list(), s.can_undo(), s.can_redo())
    });
    Response::json(out.to_string())
}

fn api_edit_apply(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(rel) = v.get("p").and_then(|p| p.as_str()) else {
        return Response::error(400, "no path given");
    };
    let Some(identity) = identity_for(app, rel) else {
        return Response::error(404, "no such file in the library");
    };
    let op = v.get("op").and_then(|o| o.as_str()).unwrap_or("");

    let num = |k: &str| -> u64 {
        match v.get(k) {
            Some(Value::Num(n)) if *n >= 0.0 => *n as u64,
            _ => 0,
        }
    };
    let float = |k: &str, d: f32| -> f32 {
        match v.get(k) {
            Some(Value::Num(n)) => *n as f32,
            _ => d,
        }
    };
    let range = edit::Range::new(num("start"), num("end"));
    let shape = if v.get("shape").and_then(|s| s.as_str()) == Some("linear") {
        edit::FadeShape::Linear
    } else {
        edit::FadeShape::EqualPower
    };

    // Normalise has to measure the rendered result first, which needs the
    // source; do it before taking the session lock.
    let measured_peak = if op == "normalize" {
        let lib = app.library_path();
        let list = app.edits.snapshot(rel).unwrap_or_else(|| identity.clone());
        lib.and_then(|l| resolve_within(&l, rel))
            .and_then(|p| audio_core::open(&p).ok())
            .and_then(|mut r| {
                let mut rack = app.racks.get(rel).build();
                edit::render::measure_peak_fx(&list, &mut r, &mut rack).ok()
            })
    } else {
        None
    };

    let mut unknown = false;
    let out = app.edits.with(rel, || identity, |s| {
        match op {
            "cut" => { s.apply(|l| l.cut(range)); }
            "silence" => { s.apply(|l| l.silence(range)); }
            "gain" => { let db = float("db", 0.0); s.apply(|l| l.gain_db(range, db)); }
            "fadeIn" => { let n = num("frames"); s.apply(|l| l.fade_in(range, n, shape)); }
            "fadeOut" => { let n = num("frames"); s.apply(|l| l.fade_out(range, n, shape)); }
            "reverse" => { s.apply(|l| l.reverse(range)); }
            "stretch" => {
                // Deliberately extreme. A hundred times longer is the point of
                // a granular stretcher: at those ratios the grain window and
                // its jitter are doing the work, not the time base.
                // Absent means unchanged, the same rule the engine settings
                // below already followed. These three used to fall back to
                // their factory values instead, so a control that mentioned
                // only one of them silently reset the other two — invisible
                // today because the panel always posts all three, and a trap
                // for the first caller that does not.
                let cur = s.list().stretch;
                let ratio = float("ratio", cur.ratio).clamp(0.01, 100.0);
                let semis = float("semitones", cur.semitones).clamp(-48.0, 48.0);
                let window = float("windowMs", cur.window_ms).clamp(5.0, 2000.0);
                // Read the current tier from the session already in hand.
                // Going back through the store would re-lock the mutex this
                // closure runs inside, and std's Mutex is not reentrant — that
                // deadlocks the request and every edit after it.
                let quality = match v.get("quality").and_then(|q| q.as_str()) {
                    Some("draft") => fx::stretch::Quality::Draft,
                    Some("best") => fx::stretch::Quality::Best,
                    Some("standard") => fx::stretch::Quality::Standard,
                    // Omitted entirely: keep whatever the document already has,
                    // so a control that does not mention quality cannot reset it.
                    _ => s.list().stretch.quality,
                };
                // Same rule as quality: absent means unchanged, so a control
                // that says nothing about the engine cannot switch it.
                let algorithm = v
                    .get("algorithm")
                    .and_then(|a| a.as_str())
                    .and_then(fx::stretch::Algorithm::from_str)
                    .unwrap_or(s.list().stretch.algorithm);
                // The vocoder's own windowing, kept apart from the window
                // above because the two engines mean different things by it.
                let cv = s.list().stretch.vocoder;
                let vv = v.get("vocoder");
                let vf = |k: &str, d: f32| -> f32 {
                    match vv.and_then(|x| x.get(k)) {
                        Some(Value::Num(n)) if n.is_finite() => *n as f32,
                        _ => d,
                    }
                };
                let vocoder = fx::stretch::VocoderParams {
                    window_ms: vf("windowMs", cv.window_ms).clamp(5.0, 500.0),
                    phase_lock: match vv.and_then(|x| x.get("phaseLock")) {
                        Some(Value::Bool(b)) => *b,
                        _ => cv.phase_lock,
                    },
                    freq_trust: vf("freqTrust", cv.freq_trust).clamp(0.0, 4.0),
                    phase_spread: vf("phaseSpread", cv.phase_spread).clamp(0.0, 4.0),
                    peak_width: vf("peakWidth", cv.peak_width as f32).clamp(1.0, 32.0) as u32,
                    lock_width: vf("lockWidth", cv.lock_width).clamp(0.0, 4.0),
                    mag_freeze: vf("magFreeze", cv.mag_freeze).clamp(0.0, 1.0),
                    mag_blur: vf("magBlur", cv.mag_blur).clamp(0.0, 1.0),
                    mag_gate: vf("magGate", cv.mag_gate).clamp(0.0, 1.0),
                    stereo_link: match vv.and_then(|x| x.get("stereoLink")) {
                        Some(Value::Bool(b)) => *b,
                        _ => cv.stereo_link,
                    },
                };
                // Grain settings arrive as a nested object; anything absent
                // keeps its current value so one slider cannot reset the rest.
                let cur = s.list().stretch.grain;
                let gv = v.get("grain");
                let gf = |k: &str, d: f32| -> f32 {
                    match gv.and_then(|g| g.get(k)) {
                        Some(Value::Num(n)) if n.is_finite() => *n as f32,
                        _ => d,
                    }
                };
                let cw = s.list().stretch.wsola;
                let wv = v.get("wsola");
                let wf = |k: &str, d: f32| -> f32 {
                    match wv.and_then(|x| x.get(k)) {
                        Some(Value::Num(n)) if n.is_finite() => *n as f32,
                        _ => d,
                    }
                };
                let wsola = fx::stretch::WsolaParams {
                    preserve_transients: match wv.and_then(|x| x.get("preserveTransients")) {
                        Some(Value::Bool(b)) => *b,
                        _ => cw.preserve_transients,
                    },
                    sensitivity: wf("sensitivity", cw.sensitivity).clamp(0.0, 1.0),
                    search_ms: wf("searchMs", cw.search_ms).clamp(0.0, 200.0),
                    splice: wv
                        .and_then(|x| x.get("splice"))
                        .and_then(|x| x.as_str())
                        .and_then(fx::stretch::Splice::from_str)
                        .unwrap_or(cw.splice),
                    stride: wf("stride", cw.stride as f32).clamp(1.0, 256.0) as u32,
                    shape: wv
                        .and_then(|x| x.get("shape"))
                        .and_then(|x| x.as_str())
                        .and_then(fx::stretch::WinShape::from_str)
                        .unwrap_or(cw.shape),
                    guard_hops: wf("guardHops", cw.guard_hops).clamp(1.0, 16.0),
                    floor: wf("floor", cw.floor).clamp(0.0, 2.0),
                };

                let cp = s.list().stretch.pvsola;
                let pv = v.get("pvsola");
                let pf = |k: &str, d: f32| -> f32 {
                    match pv.and_then(|x| x.get(k)) {
                        Some(Value::Num(n)) if n.is_finite() => *n as f32,
                        _ => d,
                    }
                };
                let pvsola = fx::pvsola::PvsolaParams {
                    anchor_frames: pf("anchorFrames", cp.anchor_frames as f32).clamp(1.0, 64.0)
                        as u32,
                    search_ms: pf("searchMs", cp.search_ms).clamp(0.0, 200.0),
                    blend: pf("blend", cp.blend).clamp(0.0, 1.0),
                };

                let ch = s.list().stretch.hybrid;
                let hv = v.get("hybrid");
                let hf = |k: &str, d: f32| -> f32 {
                    match hv.and_then(|x| x.get(k)) {
                        Some(Value::Num(n)) if n.is_finite() => *n as f32,
                        _ => d,
                    }
                };
                let hybrid = fx::hybrid::HybridParams {
                    fft_size: hf("fftSize", ch.fft_size as f32).clamp(256.0, 8192.0) as u32,
                    time_span: hf("timeSpan", ch.time_span as f32).clamp(3.0, 101.0) as u32,
                    freq_span: hf("freqSpan", ch.freq_span as f32).clamp(3.0, 101.0) as u32,
                    margin: hf("margin", ch.margin).clamp(1.0, 8.0),
                    morph_noise: match hv.and_then(|x| x.get("morphNoise")) {
                        Some(Value::Bool(b)) => *b,
                        _ => ch.morph_noise,
                    },
                    harmonic_level: hf("harmonicLevel", ch.harmonic_level).clamp(0.0, 4.0),
                    percussive_level: hf("percussiveLevel", ch.percussive_level).clamp(0.0, 4.0),
                    residual_level: hf("residualLevel", ch.residual_level).clamp(0.0, 4.0),
                };

                let grain = fx::Grain {
                    density_hz: gf("densityHz", cur.density_hz).clamp(0.0, 500.0),
                    layers: gf("layers", cur.layers as f32).clamp(1.0, 16.0) as u32,
                    overlap: gf("overlap", cur.overlap).clamp(1.0, 8.0),
                    size_jitter: gf("sizeJitter", cur.size_jitter).clamp(0.0, 1.0),
                    position_jitter_ms: gf("positionJitterMs", cur.position_jitter_ms)
                        .clamp(0.0, 2000.0),
                    pitch_jitter_semis: gf("pitchJitterSemis", cur.pitch_jitter_semis)
                        .clamp(0.0, 24.0),
                    pitch_drift_semis: gf("pitchDriftSemis", cur.pitch_drift_semis)
                        .clamp(0.0, 24.0),
                    drift_rate_hz: gf("driftRateHz", cur.drift_rate_hz).clamp(0.01, 20.0),
                    seed: gf("seed", cur.seed as f32).max(0.0) as u32,
                    scan: gf("scan", cur.scan).clamp(-4.0, 4.0),
                    reverse: match gv.and_then(|x| x.get("reverse")) {
                        Some(Value::Bool(b)) => *b,
                        _ => cur.reverse,
                    },
                    envelope: gf("envelope", cur.envelope).clamp(0.0, 1.0),
                    size_range: gf("sizeRange", cur.size_range).clamp(1.0, 8.0),
                    wrap: match gv.and_then(|x| x.get("wrap")) {
                        Some(Value::Bool(b)) => *b,
                        _ => cur.wrap,
                    },
                    layer_spread: gf("layerSpread", cur.layer_spread).clamp(0.0, 4.0),
                    layer_scatter: gf("layerScatter", cur.layer_scatter).clamp(0.0, 1.0),
                    layer_scatter_ms: gf("layerScatterMs", cur.layer_scatter_ms)
                        .clamp(0.0, 5000.0),
                    // Derived per layer while rendering, never carried on the
                    // document.
                    layer_read: 0.0,
                    link_jitter: match gv.and_then(|x| x.get("linkJitter")) {
                        Some(Value::Bool(b)) => *b,
                        _ => cur.link_jitter,
                    },
                    drift_step: match gv.and_then(|x| x.get("driftStep")) {
                        Some(Value::Bool(b)) => *b,
                        _ => cur.drift_step,
                    },
                    pan_spread: gf("panSpread", cur.pan_spread).clamp(0.0, 1.0),
                };
                s.apply(|l| {
                    l.stretch = fx::Stretch {
                        ratio, semitones: semis, window_ms: window, quality,
                        algorithm, vocoder, wsola, pvsola, hybrid, grain,
                    };
                });
            }
            "split" => { let p = num("pos"); s.apply(|l| { l.split_at(p); }); }
            "normalize" => {
                if let Some(peak) = measured_peak {
                    let target = float("db", -0.3);
                    s.apply(|l| l.normalize(peak, target));
                }
            }
            "undo" => { s.undo(); }
            "redo" => { s.redo(); }
            "revert" => { s.revert(); }
            _ => unknown = true,
        }
        crate::docs::edit_json(s.list(), s.can_undo(), s.can_redo())
    });

    if unknown {
        return Response::error(400, &format!("unknown edit operation: {op}"));
    }
    app.save_sessions();

    // Performance controls go straight at the audio thread — that is the whole
    // point of the engine, and it happens while sound is coming out. Structural
    // edits change the buffer the engine reads from, so they need the file
    // folding and handing over again; you do not hold a cut while listening.
    if op == "stretch" {
        if let Some(list) = app.edits.snapshot(rel) {
            let _ = crate::live::push_params(app, rel, &list);
        }
    } else if let Some(path) = app.library_path().and_then(|l| resolve_within(&l, rel)) {
        let _ = crate::live::load(app, rel, &path);
    }

    Response::json(out.to_string())
}

/// Render the edited result to a new file. Never writes over the source.
fn api_export(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(rel) = v.get("p").and_then(|p| p.as_str()) else {
        return Response::error(400, "no path given");
    };
    let bits = match v.get("bits") {
        Some(Value::Num(n)) => *n as u16,
        _ => 24,
    };
    let Some(lib) = app.library_path() else {
        return Response::error(400, "no library chosen");
    };
    let Some(src) = resolve_within(&lib, rel) else {
        return Response::error(404, "no such file in the library");
    };
    let Some(list) = app.edits.snapshot(rel) else {
        return Response::error(400, "this file has no edits");
    };
    if list.frames() == 0 {
        return Response::error(400, "the edit is empty — nothing to export");
    }

    let target = crate::docs::export_target(&app.data_dir, rel);
    if let Some(parent) = target.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return Response::error(500, &e.to_string());
        }
    }

    let mut reader = match audio_core::open(&src) {
        Ok(r) => r,
        Err(e) => return Response::error(400, &e.to_string()),
    };
    let file = match std::fs::File::create(&target) {
        Ok(f) => f,
        Err(e) => return Response::error(500, &e.to_string()),
    };
    let mut out = std::io::BufWriter::new(file);
    let mut rack = app.racks.get(rel).build();
    match edit::render::render_to_wav_fx(&list, &mut reader, &mut rack, &mut out, bits) {
        Ok(frames) => Response::json(
            Value::obj()
                .set("ok", true)
                .set("path", target.to_string_lossy().to_string())
                .set("frames", frames)
                .to_string(),
        ),
        Err(e) => Response::error(500, &e.to_string()),
    }
}

fn api_stats(app: &Arc<App>, req: &Request) -> Response {
    let path = match library_file(app, req) {
        Ok(p) => p,
        Err(r) => return r,
    };
    let mut reader = match audio_core::open(&path) {
        Ok(r) => r,
        Err(e) => return Response::error(400, &e.to_string()),
    };
    let info = *reader.info();
    let s = match reader.stats() {
        Ok(s) => s,
        Err(e) => return Response::error(500, &e.to_string()),
    };
    Response::json(
        Value::obj()
            .set("peak", s.peak)
            .set("peakDbfs", s.peak_dbfs)
            .set("rms", s.rms)
            .set("rmsDbfs", s.rms_dbfs)
            .set("correlation", s.correlation.map(|c| c as f64))
            .set("dualMono", s.dual_mono)
            .set("clipped", s.clipped_samples)
            .set("sampleRate", info.sample_rate)
            .set("channels", info.channels)
            .set("bits", info.bits)
            .set("frames", info.frames())
            .set("duration", info.duration_secs())
            .set("container", format!("{:?}", info.container))
            .to_string(),
    )
}

/// Stream any supported format to the browser as WAV.
///
/// AIFF and headerless PCM are re-wrapped, not re-encoded, so the response
/// length is known exactly up front and range requests resolve with plain
/// arithmetic — which is what makes seeking work.
fn api_audio(app: &Arc<App>, req: &Request) -> Response {
    let path = match library_file(app, req) {
        Ok(p) => p,
        Err(r) => return r,
    };
    // Playing the edited version renders on the fly. The length comes from the
    // clip list, so seeking works without rendering the whole thing first.
    let rel = req.param("p").unwrap_or("");
    let rack_active = app.racks.is_active(rel);
    if req.param("edited") == Some("1") || rack_active {
        let list = app.edits.snapshot(rel).or_else(|| {
            // A rack with no edits still needs the rendering path.
            audio_core::open(&path).ok().map(|r| {
                let i = r.info();
                edit::EditList::identity(i.frames(), i.channels, i.sample_rate)
            })
        });
        if let Some(list) = list {
            return audio_edited(&path, &list, &mut app.racks.get(rel).build(), req);
        }
    }

    let mut src = match FileSource::open(&path) {
        Ok(s) => s,
        Err(e) => return Response::error(404, &e.to_string()),
    };
    let info = match probe(&mut src) {
        Ok(i) => i,
        Err(e) => return Response::error(400, &e.to_string()),
    };

    let total = wav::stream_len(&info);
    let range = req.header("range").and_then(|h| parse_range(h, total));
    let (start, end) = match range {
        Some(r) => (r.start, r.end),
        None => (0, total.saturating_sub(1)),
    };
    if total == 0 {
        return Response::error(416, "file has no audio data");
    }

    let header = wav::header(info.data_len, info.channels, info.sample_rate, info.codec);
    let mut out: Vec<u8> = Vec::with_capacity((end - start + 1) as usize);

    // The requested window may cover part of the header, part of the samples,
    // or straddle the boundary.
    if start < wav::HEADER_LEN {
        let h_end = (end + 1).min(wav::HEADER_LEN);
        out.extend_from_slice(&header[start as usize..h_end as usize]);
    }
    if end >= wav::HEADER_LEN {
        let data_start = start.saturating_sub(wav::HEADER_LEN);
        let data_end = end - wav::HEADER_LEN;
        let len = (data_end - data_start + 1) as usize;
        let mut buf = vec![0u8; len];
        let got = src
            .read_at(info.data_offset + data_start, &mut buf)
            .unwrap_or(0);
        buf.truncate(got);
        wav::convert_samples(&mut buf, info.codec, info.endian, data_start);
        out.extend_from_slice(&buf);
    }

    let status = if range.is_some() { 206 } else { 200 };
    let mut r = Response::new(status, "audio/wav", out);
    r = r.with("Accept-Ranges", "bytes").with("Cache-Control", "no-store");
    if range.is_some() {
        r = r.with("Content-Range", &format!("bytes {start}-{end}/{total}"));
    }
    r
}

/// Stream the edited timeline as 16-bit WAV, honouring range requests.
fn audio_edited(
    path: &Path,
    list: &edit::EditList,
    rack: &mut fx::Rack,
    req: &Request,
) -> Response {
    const BITS: u16 = 16;
    let mut reader = match audio_core::open(path) {
        Ok(r) => r,
        Err(e) => return Response::error(400, &e.to_string()),
    };
    let total = edit::render::wav_stream_len(list, BITS);
    if total <= wav::HEADER_LEN {
        return Response::error(400, "the edit is empty");
    }

    let range = req.header("range").and_then(|h| parse_range(h, total));
    let (start, end) = match range {
        Some(r) => (r.start, r.end),
        None => (0, total - 1),
    };

    match edit::render::wav_bytes_fx(list, &mut reader, rack, start, end, BITS) {
        Ok(bytes) => {
            let status = if range.is_some() { 206 } else { 200 };
            let mut r = Response::new(status, "audio/wav", bytes)
                .with("Accept-Ranges", "bytes")
                .with("Cache-Control", "no-store");
            if range.is_some() {
                r = r.with("Content-Range", &format!("bytes {start}-{end}/{total}"));
            }
            r
        }
        Err(e) => Response::error(500, &e.to_string()),
    }
}

fn api_scan_status(app: &Arc<App>) -> Response {
    let (running, done, total, current) = app.scan.snapshot();
    Response::json(
        Value::obj()
            .set("running", running)
            .set("done", done)
            .set("total", total)
            .set("current", current)
            .to_string(),
    )
}

fn api_scan_start(app: &Arc<App>) -> Response {
    let Some(lib) = app.library_path() else {
        return Response::error(400, "no library chosen");
    };
    if app.scan.running.swap(true, Ordering::SeqCst) {
        return Response::error(400, "a scan is already running");
    }
    app.scan.cancel.store(false, Ordering::Relaxed);

    let app2 = Arc::clone(app);
    std::thread::spawn(move || {
        let result = run_scan(&app2, &lib);
        if let Err(e) = result {
            if let Ok(mut c) = app2.scan.current.lock() {
                *c = format!("failed: {e}");
            }
        }
        app2.scan.running.store(false, Ordering::SeqCst);
    });

    Response::json(Value::obj().set("ok", true).to_string())
}

fn run_scan(app: &Arc<App>, lib: &Path) -> std::io::Result<()> {
    let roots = indexer::library_roots(lib)?;
    app.scan.total.store(roots.len(), Ordering::Relaxed);
    app.scan.done.store(0, Ordering::Relaxed);

    let mut all = Vec::new();
    for r in &roots {
        if app.scan.cancel.load(Ordering::Relaxed) {
            break;
        }
        if let Ok(mut c) = app.scan.current.lock() {
            *c = r.clone();
        }
        all.extend(indexer::scan_folder(lib, r)?);
        app.scan.done.fetch_add(1, Ordering::Relaxed);
    }

    std::fs::create_dir_all(&app.data_dir)?;
    Index::save(&all, &app.index_path())?;

    let mut idx = Index {
        files: all.iter().map(Into::into).collect(),
        folders: Vec::new(),
    };
    idx.rebuild_folders();
    *app.index.write().unwrap() = idx;

    if let Ok(mut c) = app.scan.current.lock() {
        *c = String::new();
    }
    Ok(())
}

/// Persist tag edits: into the overrides file, and into a `_TAGS.txt` beside
/// the audio. Neither touches an audio file.
fn api_save(app: &Arc<App>, req: &Request) -> Response {
    let Some(payload) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(lib) = app.library_path() else {
        return Response::error(400, "no library chosen");
    };

    // Merge with what is already stored rather than replacing it, and merge
    // field by field: the browser only sends the fields that changed, so
    // replacing an entry wholesale would silently clear the others.
    let mut current = app.overrides.read().unwrap().clone();
    let mut folders_touched: Vec<String> = Vec::new();

    for (section, key_is_path) in [("folders", false), ("files", true)] {
        let Some(edits) = payload.get(section).and_then(|f| f.as_obj()) else { continue };
        for (name, edit) in edits {
            merge_entry(&mut current, section, name, edit);
            let folder = if key_is_path {
                name.split('/').next().unwrap_or(name).to_string()
            } else {
                name.clone()
            };
            if !folders_touched.contains(&folder) {
                folders_touched.push(folder);
            }
        }
    }

    if let Err(e) = std::fs::write(app.overrides_path(), current.to_string()) {
        return Response::error(500, &e.to_string());
    }

    // `_TAGS.txt` is regenerated from the whole stored set rather than appended
    // to, so there is one writer and no need to parse back a file we wrote.
    let mut written = 0usize;
    for folder in &folders_touched {
        if write_tags_file(&lib, folder, &current).is_ok() {
            written += 1;
        }
    }
    *app.overrides.write().unwrap() = current;

    Response::json(
        Value::obj()
            .set("ok", true)
            .set("foldersWritten", written)
            .to_string(),
    )
}

/// Fold one edit into `root[section][name]`, keeping fields it does not mention.
fn merge_entry(root: &mut Value, section: &str, name: &str, edit: &Value) {
    let Value::Obj(m) = root else { return };
    let Value::Obj(sm) = m.entry(section.into()).or_insert_with(Value::obj) else { return };
    let slot = sm.entry(name.to_string()).or_insert_with(Value::obj);
    let Some(fields) = edit.as_obj() else { return };
    if let Value::Obj(existing) = slot {
        for (k, v) in fields {
            existing.insert(k.clone(), v.clone());
        }
    }
}

fn write_tags_file(lib: &Path, folder: &str, all: &Value) -> std::io::Result<()> {
    let rel = format!("{folder}/_TAGS.txt");
    let Some(path) = resolve_for_write(lib, &rel) else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "folder is outside the library",
        ));
    };

    let field = |v: &Value, k: &str| {
        v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
    };
    let blank = Value::obj();
    let f = all.get("folders").and_then(|x| x.get(folder)).unwrap_or(&blank);

    let mut body = format!(
        "# Audio Library tags\n\
         # Written by the library browser. Describes this folder and its files.\n\
         # Nothing was renamed, moved or deleted. Safe to delete this file.\n\
         \n\
         folder:      {folder}\n\
         level1:      {}\n\
         level2:      {}\n\
         tags:        {}\n\
         notes:       {}\n",
        field(f, "level1"),
        field(f, "level2"),
        field(f, "tags"),
        field(f, "notes"),
    );

    if let Some(files) = all.get("files").and_then(|x| x.as_obj()) {
        let prefix = format!("{folder}/");
        for (rel_path, edit) in files.iter().filter(|(p, _)| p.starts_with(&prefix)) {
            body.push_str(&format!(
                "\nfile:        {}\n\
                 level1:      {}\n\
                 level2:      {}\n\
                 tags:        {}\n\
                 notes:       {}\n",
                &rel_path[prefix.len()..],
                field(edit, "level1"),
                field(edit, "level2"),
                field(edit, "tags"),
                field(edit, "notes"),
            ));
        }
    }
    body.push_str("\nedited:      by hand in the library browser\n");
    std::fs::write(path, body)
}

// ======================================================== the live engine
//
// Playback is the engine's, not the browser's. These endpoints are the whole
// interface to it: one expensive call to load a file, and a handful of cheap
// ones that only ever touch atomics.

fn api_engine_load(app: &Arc<App>, req: &Request) -> Response {
    let path = match library_file(app, req) {
        Ok(p) => p,
        Err(r) => return r,
    };
    let rel = req.param("p").unwrap_or("").to_string();
    match crate::live::load(app, &rel, &path) {
        Ok(l) => Response::json(
            Value::obj()
                .set("frames", l.frames as f64)
                .set("sampleRate", l.sample_rate as f64)
                .to_string(),
        ),
        Err(e) => Response::error(500, &e),
    }
}

fn api_engine_state(app: &Arc<App>) -> Response {
    let loaded = app.playing.read().unwrap().clone();
    match crate::live::with(app, |h| {
        Value::obj()
            .set("playing", h.shared.is_playing())
            .set("position", h.shared.position() as f64)
            .set("sampleRate", h.sample_rate as f64)
            // Which document the engine is holding, and how much of it there is
            // at the device's rate — everything a visualiser needs to rebuild
            // the same grain schedule the audio thread is working through.
            .set("capturing", h.shared.is_capturing())
            .set("capturedFrames", h.shared.captured_frames() as f64)
            .set("path", loaded.as_ref().map(|(p, _, _)| p.clone()).unwrap_or_default())
            .set("inFrames", loaded.as_ref().map(|(_, f, _)| *f as f64).unwrap_or(0.0))
            // The parameters the audio thread is *actually* using, not the
            // ones on the document. They are usually the same, but a visualiser
            // that reads the document is showing what was asked for rather than
            // what is being heard, and the two part company the moment a
            // slider moves.
            .set(
                "stream",
                h.shared
                    .params()
                    .map(|p| {
                        Value::obj()
                            .set("ratio", p.ratio as f64)
                            .set("semitones", p.semitones as f64)
                            .set("windowMs", p.window_ms as f64)
                            .set("inFrames", p.in_frames as f64)
                            .set("outFrames", p.plan().out_frames as f64)
                            .set("densityHz", p.grain.density_hz as f64)
                            .set("overlap", p.grain.overlap as f64)
                            .set("sizeJitter", p.grain.size_jitter as f64)
                            .set("positionJitterMs", p.grain.position_jitter_ms as f64)
                            .set("pitchJitterSemis", p.grain.pitch_jitter_semis as f64)
                            .set("pitchDriftSemis", p.grain.pitch_drift_semis as f64)
                            .set("driftRateHz", p.grain.drift_rate_hz as f64)
                            .set("seed", p.grain.seed as f64)
                    })
                    .unwrap_or(Value::Null),
            )
            .set("channels", h.channels as f64)
            .set(
                "overflows",
                h.shared
                    .overflows
                    .load(std::sync::atomic::Ordering::Acquire) as f64,
            )
            .to_string()
    }) {
        Ok(s) => Response::json(s),
        Err(e) => Response::error(503, &e),
    }
}

fn api_engine_transport(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let num = |k: &str| match v.get(k) {
        Some(Value::Num(n)) if n.is_finite() => Some(*n),
        _ => None,
    };

    let r = crate::live::with(app, |h| {
        if let Some(f) = num("seek") {
            h.shared.request_seek(f.max(0.0) as u64);
        }
        if let Some(g) = num("gain") {
            h.shared.set_gain(g as f32);
        }
        match v.get("loop") {
            Some(l) => {
                let on = matches!(l.get("on"), Some(Value::Bool(true)));
                let a = match l.get("a") {
                    Some(Value::Num(n)) => *n as u64,
                    _ => 0,
                };
                let b = match l.get("b") {
                    Some(Value::Num(n)) => *n as u64,
                    _ => 0,
                };
                h.shared.set_loop(on, a, b);
            }
            None => {}
        }
        // Play last, so a seek in the same request lands before sound starts.
        match v.get("play") {
            Some(Value::Bool(true)) => h.shared.play(),
            Some(Value::Bool(false)) => h.shared.pause(),
            _ => {}
        }
        h.shared.position() as f64
    });

    match r {
        Ok(pos) => Response::json(Value::obj().set("position", pos).to_string()),
        Err(e) => Response::error(503, &e),
    }
}

/// Grains that have actually sounded since the last ask.
///
/// The swarm is fed from here rather than from a second enumeration, so it
/// cannot show something the speakers did not play.
fn api_engine_grains(app: &Arc<App>) -> Response {
    match crate::live::with(app, |h| {
        let events = h.shared.drain_events();
        let sr = h.sample_rate.max(1) as f64;
        let arr: Vec<Value> = events
            .iter()
            .map(|e| {
                Value::obj()
                    .set("t", e.out_frame as f64 / sr)
                    .set("src", e.src_frame as f64 / sr)
                    .set("size", e.size as f64 / sr)
                    .set("rate", e.rate as f64)
                    .set("semis", e.pitch_semis as f64)
            })
            .collect();
        let spectrum: Vec<Value> = h
            .shared
            .spectrum()
            .into_iter()
            .map(|b| Value::Num(b as f64))
            .collect();
        Value::obj()
            .set("position", h.shared.position() as f64)
            .set("sampleRate", sr)
            .set("playing", h.shared.is_playing())
            .set("grains", Value::Arr(arr))
            .set("spectrum", Value::Arr(spectrum))
            .to_string()
    }) {
        Ok(s) => Response::json(s),
        Err(e) => Response::error(503, &e),
    }
}

/// Arm or finish a capture.
///
/// `{on:true}` starts keeping the output; `{on:false}` stops and writes it
/// beside the original. The file is what came out of the speakers rather than a
/// fresh render of the document — the two can differ, and when they do the
/// recording is the one that was actually in the room.
fn api_capture(app: &Arc<App>, req: &Request) -> Response {
    let v = json::parse(&String::from_utf8_lossy(&req.body)).unwrap_or_else(Value::obj);
    let on = matches!(v.get("on"), Some(Value::Bool(true)));

    if on {
        let started = crate::live::with(app, |h| {
            h.shared.start_capture(h.channels, h.sample_rate, crate::capture::MAX_SECONDS);
        });
        return match started {
            Ok(()) => Response::json(Value::obj().set("capturing", true).to_string()),
            Err(e) => Response::error(503, &e),
        };
    }

    let taken = match crate::live::with(app, |h| h.shared.take_capture()) {
        Ok(t) => t,
        Err(e) => return Response::error(503, &e),
    };
    let Some(cap) = taken else {
        return Response::json(Value::obj().set("capturing", false).set("frames", 0.0).to_string());
    };
    if cap.samples.is_empty() {
        return Response::json(
            Value::obj().set("capturing", false).set("frames", 0.0).to_string(),
        );
    }

    // Name it for the sound it came from and what that sound was going through.
    let rel = app.playing.read().unwrap().as_ref().map(|(p, _, _)| p.clone()).unwrap_or_default();
    let list = app.edits.snapshot(&rel);
    let module = match &list {
        Some(l) => crate::capture::module_name(l, &crate::live::rack_for(app, &rel)),
        None => "live".to_string(),
    };

    let Some(lib) = app.library_path() else {
        return Response::error(400, "no library chosen");
    };
    let (path, outside) = crate::capture::target(&lib, &app.data_dir, &rel, &module);

    match crate::capture::write_wav(&path, &cap.samples, cap.channels, cap.sample_rate) {
        Ok(frames) => {
            // The file exists now; the browser should be able to see it without
            // the user going looking for a rescan button.
            if !outside {
                reindex_for(app, &rel);
            }
            Response::json(
            Value::obj()
                .set("capturing", false)
                .set("frames", frames as f64)
                .set("seconds", frames as f64 / cap.sample_rate.max(1) as f64)
                .set("path", path.to_string_lossy().to_string())
                .set("name", path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default())
                // True when it could not be put beside the original — a
                // read-only pack, say — and went to the app's own folder.
                .set("elsewhere", outside)
                // True when the reservation ran out and the tail was dropped.
                .set("truncated", cap.full)
                .to_string(),
            )
        }
        Err(e) => Response::error(500, &e.to_string()),
    }
}

/// Re-read one folder and fold it back into the index.
///
/// A capture drops a file into the library while the app is running, and until
/// something notices it the browser is describing a directory that no longer
/// matches the disk. Re-scanning the whole library for one new file would be
/// absurd on a large one, so only the folder that changed is re-read and its
/// rows swapped in.
fn reindex_folder(app: &Arc<App>, root: &str) {
    let Some(lib) = app.library_path() else { return };
    let Ok(fresh) = indexer::scan_folder(&lib, root) else { return };

    {
        let mut idx = app.index.write().unwrap();
        idx.files.retain(|f| f.folder != root);
        idx.files.extend(fresh.iter().map(Into::into));
        idx.files.sort_by(|a, b| {
            a.folder.cmp(&b.folder).then(a.rel_path.cmp(&b.rel_path))
        });
        idx.rebuild_folders();
    }

    // Keep the file on disk in step, or the next start would forget it again.
    let all: Vec<indexer::FileRecord> = match indexer::library_roots(&lib) {
        Ok(roots) => roots
            .iter()
            .filter_map(|r| indexer::scan_folder(&lib, r).ok())
            .flatten()
            .collect(),
        Err(_) => return,
    };
    let _ = Index::save(&all, &app.index_path());
}

/// Re-read the folder a path sits in.
fn reindex_for(app: &Arc<App>, rel: &str) {
    let root = rel.split('/').next().unwrap_or("");
    if !root.is_empty() {
        reindex_folder(app, root);
    }
}

// ==================================================== similar sounds
//
// Acoustic similarity, not meaning: this finds sounds shaped like the one you
// picked. Fingerprints are built the first time they are asked for and kept
// beside the index, so the cost falls once per file rather than once per search.

fn ensure_prints(app: &Arc<App>) -> usize {
    let Some(lib) = app.library_path() else { return 0 };

    // Which files still need measuring, decided while holding only read locks.
    let wanted: Vec<String> = {
        let idx = app.index.read().unwrap();
        let have = app.prints.read().unwrap();
        idx.files
            .iter()
            .filter(|f| f.duration > 0.0)
            // rel_path is relative to its folder, not to the library. The
            // library-relative path — which is what every other endpoint and
            // the interface use as a file's identity — is the two joined.
            .map(|f| format!("{}/{}", f.folder, f.rel_path))
            .filter(|p| have.get(p).is_none())
            .collect()
    };
    if wanted.is_empty() {
        return 0;
    }

    let mut built = Vec::new();
    let (mut no_path, mut no_open, mut no_fp) = (0usize, 0usize, 0usize);
    for rel in &wanted {
        let Some(path) = resolve_within(&lib, rel) else { no_path += 1; continue };
        let mut r = match audio_core::open(&path) {
            Ok(r) => r,
            Err(_) => { no_open += 1; continue }
        };
        match search::Fingerprint::of(&mut r) {
            Ok(fp) => built.push((rel.clone(), fp)),
            Err(_) => no_fp += 1,
        }
    }
    // Worth saying out loud: a library where nothing can be measured should not
    // look the same as one where everything matched.
    if !wanted.is_empty() && built.len() < wanted.len() {
        eprintln!(
            "fingerprints: {} of {} measured ({} unresolved, {} unopenable, {} unmeasurable)",
            built.len(), wanted.len(), no_path, no_open, no_fp
        );
    }

    let n = built.len();
    {
        let mut store = app.prints.write().unwrap();
        for (rel, fp) in built {
            store.insert(&rel, fp);
        }
        let _ = store.save(&app.prints_path());
    }
    n
}

// ==================================================== what a sound *is*
//
// The fingerprints above say what a sound is like. This says what it is: the
// AudioSet classifier gives it a name from the audio, and files it could not
// name borrow one from a neighbour that it could.

/// Load the classifier, once, on the first request that needs it.
///
/// Returns None when the weights are not on disk. That is a normal state — the
/// rest of the app works without them — so it is reported once and then left
/// alone rather than retried on every request.
fn model(app: &Arc<App>) -> Option<Arc<yamnet::Model>> {
    let mut slot = app.model.lock().unwrap();
    if let Some(m) = slot.as_ref() {
        return Some(m.clone());
    }
    match yamnet::Model::load_default() {
        Ok(m) => {
            let m = Arc::new(m);
            *slot = Some(m.clone());
            Some(m)
        }
        Err(e) => {
            eprintln!("sound labels unavailable: {e}");
            None
        }
    }
}

/// Make sure every file has been through the classifier, then work out who is
/// borrowing a name from whom.
fn ensure_labels(app: &Arc<App>) -> usize {
    let Some(lib) = app.library_path() else { return 0 };

    let wanted: Vec<String> = {
        let idx = app.index.read().unwrap();
        let have = app.labels.read().unwrap();
        idx.files
            .iter()
            .filter(|f| f.duration > 0.0)
            .map(|f| format!("{}/{}", f.folder, f.rel_path))
            .filter(|p| !have.measured(p))
            .collect()
    };

    let mut built = 0usize;
    if !wanted.is_empty() {
        let Some(model) = model(app) else { return 0 };
        let mut measured: Vec<(String, Vec<yamnet::Detection>)> = Vec::new();

        for rel in &wanted {
            let Some(path) = resolve_within(&lib, rel) else { continue };
            let Ok(mut r) = audio_core::open(&path) else { continue };
            let info = *r.info();
            let Ok(samples) = r.read_frames(0, info.frames()) else { continue };
            let mono =
                yamnet::to_mono_16k(&samples, info.channels as usize, info.sample_rate);
            // More than the panel shows. Storing the tail costs almost nothing
            // and means anything built later — a visualiser, an export — has
            // the model's fuller opinion without a second pass over the audio.
            match model.label(&mono, 8) {
                // An empty list is a real answer — the model heard nothing it
                // could name — and storing it stops the file being re-analysed
                // on every request for the rest of time.
                Ok(words) => measured.push((rel.clone(), words)),
                Err(e) => eprintln!("labelling {rel}: {e}"),
            }
        }

        built = measured.len();
        let mut store = app.labels.write().unwrap();
        for (rel, words) in measured {
            store.insert(&rel, words);
        }
        let _ = store.save(&app.labels_path());
    }

    // Loans depend on which files are present, so they are worked out afresh
    // rather than stored. Only redone when something changed or the derived
    // view is empty, because the ranking behind it is quadratic.
    let stale = built > 0 || app.heard.read().unwrap().is_empty();
    if stale {
        ensure_prints(app);
        let prints = app.prints.read().unwrap();
        let store = app.labels.read().unwrap();
        let known = store.by_path.clone();
        drop(store);

        let filled = yamnet::propagate(&known, |path| {
            let Some(query) = prints.get(path) else { return Vec::new() };
            let pairs: Vec<(&str, search::Fingerprint)> =
                prints.by_path.iter().map(|(p, f)| (p.as_str(), *f)).collect();
            search::rank(&query, pairs, path, 8)
                .into_iter()
                // Only a genuinely close sound is worth taking a name from. A
                // library's nearest neighbour is not necessarily a near one:
                // at 0.90 a jazz loop and a hand drum came out as neighbours.
                .filter(|(_, score)| *score >= 0.95)
                .map(|(p, _)| p.to_string())
                .collect()
        });
        *app.heard.write().unwrap() = filled;
    }
    built
}

/// What the classifier makes of one file, ready for JSON.
fn heard_value(app: &Arc<App>, rel: &str) -> Value {
    let heard = app.heard.read().unwrap();
    let Some(l) = heard.get(rel) else { return Value::Arr(Vec::new()) };
    Value::Arr(
        l.words
            .iter()
            .map(|d| {
                Value::obj()
                    .set("label", d.label.clone())
                    .set("score", d.score as f64)
                    // Empty when the model heard this file itself. When it did
                    // not, this names the file the label came from, so the
                    // interface can show a borrowed name as borrowed.
                    .set("from", l.from.clone().unwrap_or_default())
            })
            .collect(),
    )
}

/// What the tag fields should say about a file, before anyone edits them.
///
/// Level 1 is the name the classifier put to the sound; level 2 is what it is
/// like. The tags are the searchable pile: the words out of the filename, the
/// two filename fields that are actually reliable — `machine` and `instrument`
/// only ever fire on a real token match — plus everything both systems heard.
///
/// A take number never becomes a tag. `snare 1.wav` offers "snare"; the 1 is
/// which take it is, not what it is.
fn suggest_tags(app: &Arc<App>, rel: &str, descriptors: &[&'static str]) -> Value {
    let heard = app.heard.read().unwrap();
    let words = heard.get(rel).map(|l| l.words.clone()).unwrap_or_default();

    let level1 = words.first().map(|d| d.label.clone()).unwrap_or_default();
    let level2 = descriptors.join(", ");

    let mut tags: Vec<String> = yamnet::propagate::name_words(rel);

    if let Some(row) = app
        .index
        .read()
        .unwrap()
        .files
        .iter()
        .find(|f| format!("{}/{}", f.folder, f.rel_path) == rel)
    {
        for extra in [&row.machine, &row.instrument, &row.bpm] {
            if !extra.is_empty() {
                tags.push(extra.to_lowercase());
            }
        }
    }

    for d in &words {
        // Class names like "Vehicle horn, car horn, honking" are three names
        // for one thing; the first is the one worth keeping.
        let head = d.label.split(',').next().unwrap_or(&d.label);
        tags.push(head.trim().to_lowercase());
    }
    tags.extend(descriptors.iter().map(|d| d.to_string()));

    let mut seen: Vec<String> = Vec::new();
    for t in tags {
        if !t.is_empty() && !seen.contains(&t) {
            seen.push(t);
        }
    }

    Value::obj()
        .set("level1", level1)
        .set("level2", level2)
        // Comma-separated, not space-separated: "Snare drum" and "Bass drum"
        // are single tags made of two words, and splitting on spaces would
        // shred them into a pile of "drum".
        .set("tags", seen.join(", "))
}

// ============================================== tags of your own invention
//
// The classifier knows AudioSet's nouns. It will never say "time stretched",
// because that is a category in your work rather than in the world. These are
// taught by example instead: tag a sound and it becomes an exemplar; anything
// close enough to an exemplar gets the tag offered, with the exemplar named.

/// Tags applied by hand, and the ones the system thinks belong here.
fn user_tags_value(app: &Arc<App>, rel: &str) -> Value {
    let store = app.user_tags.read().unwrap();
    let mine: Vec<Value> = store.get(rel).into_iter().map(Value::Str).collect();

    // Learning needs a fingerprint for the sound being asked about and for
    // every exemplar. Without one there is nothing to compare, which is not an
    // error — it just means no suggestions yet.
    let prints = app.prints.read().unwrap();
    let learned: Vec<Value> = match prints.get(rel) {
        Some(query) => {
            let pairs: Vec<(&str, &str, search::Fingerprint)> = store
                .pairs()
                .filter_map(|(p, t)| prints.get(p).map(|fp| (p, t, fp)))
                .collect();
            let already = store.get(rel);
            search::learn::suggest(&query, pairs, rel, search::learn::LEARN, 6)
                .into_iter()
                // Never offer something that is already on the sound.
                .filter(|s| !already.contains(&s.tag))
                .map(|s| {
                    Value::obj()
                        .set("tag", s.tag)
                        .set("score", s.score as f64)
                        .set("like", s.like)
                        .set("support", s.support as f64)
                })
                .collect()
        }
        None => Vec::new(),
    };

    Value::obj()
        .set("mine", Value::Arr(mine))
        .set("learned", Value::Arr(learned))
        .set(
            "vocabulary",
            Value::Arr(store.vocabulary().into_iter().map(Value::Str).collect()),
        )
}

/// Replace the hand-applied tags on one sound.
///
/// Whole-list rather than add/remove: the panel always knows the full set, and
/// two half-updates racing each other cannot leave a tag half-applied.
fn api_user_tags_set(app: &Arc<App>, req: &Request) -> Response {
    let Some(payload) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(path) = payload.get("path").and_then(|p| p.as_str()) else {
        return Response::error(400, "no path given");
    };
    let tags: Vec<String> = match payload.get("tags") {
        Some(Value::Arr(a)) => {
            a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()
        }
        _ => Vec::new(),
    };

    {
        let mut store = app.user_tags.write().unwrap();
        store.set(path, tags);
        if let Err(e) = store.save(&app.user_tags_path()) {
            return Response::error(500, &e.to_string());
        }
    }
    // Fingerprints are what the learning runs on, so a newly tagged sound is
    // useless as an example until it has one.
    ensure_prints(app);
    Response::json(user_tags_value(app, path).to_string())
}

/// Every sound carrying a given tag, hand-applied or close enough to inherit it.
///
/// This is the tag seen from the other side: not "what is this sound" but
/// "where else does this idea apply", which is what makes a learned tag worth
/// having at all.
fn api_user_tag_members(app: &Arc<App>, req: &Request) -> Response {
    let Some(tag) = req.param("tag") else {
        return Response::error(400, "no tag given");
    };
    let tag = tag.trim().to_lowercase();
    ensure_prints(app);

    let store = app.user_tags.read().unwrap();
    let prints = app.prints.read().unwrap();

    let applied: Vec<String> = store
        .pairs()
        .filter(|(_, t)| *t == tag)
        .map(|(p, _)| p.to_string())
        .collect();

    // The exemplars are the same for every candidate, so gather them once
    // rather than rebuilding the list inside the loop.
    let exemplars: Vec<(&str, &str, search::Fingerprint)> = store
        .pairs()
        .filter(|(_, t)| *t == tag)
        .filter_map(|(p, t)| prints.get(p).map(|f| (p, t, f)))
        .collect();

    let mut found: Vec<(f32, String, String)> = Vec::new();
    for (path, fp) in &prints.by_path {
        if applied.contains(path) {
            continue;
        }
        if let Some(s) =
            search::learn::suggest(fp, exemplars.iter().cloned(), path, search::learn::LEARN, 1)
                .first()
        {
            found.push((s.score, path.clone(), s.like.clone()));
        }
    }
    found.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));

    let suggested: Vec<Value> = found
        .into_iter()
        .map(|(score, path, like)| {
            Value::obj()
                .set("path", path)
                .set("score", score as f64)
                .set("like", like)
        })
        .collect();

    Response::json(
        Value::obj()
            .set("tag", tag)
            .set("applied", Value::Arr(applied.into_iter().map(Value::Str).collect()))
            .set("suggested", Value::Arr(suggested))
            .to_string(),
    )
}

/// The tag fields a person has already saved for this file, if any.
fn saved_tags(app: &Arc<App>, rel: &str) -> Value {
    let overrides = app.overrides.read().unwrap();
    overrides
        .get("files")
        .and_then(|f| f.get(rel))
        .cloned()
        .unwrap_or(Value::Null)
}

fn api_similar(app: &Arc<App>, req: &Request) -> Response {
    let Some(rel) = req.param("p") else {
        return Response::error(400, "no path given");
    };
    let limit = req
        .param("limit")
        .and_then(|l| l.parse::<usize>().ok())
        .unwrap_or(20)
        .clamp(1, 200);

    let built = ensure_prints(app);
    ensure_labels(app);
    let heard = heard_value(app, rel);

    let store = app.prints.read().unwrap();
    let Some(query) = store.get(rel) else {
        return Response::error(404, "that sound could not be measured");
    };

    // Descriptors are relative to the library, so the yardstick is built from
    // every fingerprint we hold, once, and shared by the query and the results.
    let cal = search::Calibration::build(store.by_path.values().copied());

    let pairs: Vec<(&str, search::Fingerprint)> =
        store.by_path.iter().map(|(p, f)| (p.as_str(), *f)).collect();
    let ranked = search::rank(&query, pairs, rel, limit);

    let idx = app.index.read().unwrap();
    let results: Vec<Value> = ranked
        .iter()
        .map(|(path, score)| {
            let meta = idx
                .files
                .iter()
                .find(|f| format!("{}/{}", f.folder, f.rel_path) == **path);
            // Say what is *unlike* about a match as well as how close it is —
            // a number on its own is not a reason.
            let diff = store
                .get(path)
                .map(|fp| {
                    let d = query.largest_differences(&fp);
                    d.first().map(|(n, _)| n.to_string()).unwrap_or_default()
                })
                .unwrap_or_default();
            Value::obj()
                .set("path", path.to_string())
                .set("score", *score as f64)
                .set("differs", diff)
                .set(
                    "tags",
                    Value::Arr(
                        store
                            .get(path)
                            .map(|f| f.descriptors(&cal))
                            .unwrap_or_default()
                            .into_iter()
                            .map(|w| Value::Str(w.to_string()))
                            .collect(),
                    ),
                )
                .set(
                    "name",
                    meta.map(|m| m.filename.clone())
                        .unwrap_or_else(|| path.to_string()),
                )
                .set("seconds", meta.map(|m| m.duration).unwrap_or(0.0))
                .set(
                    "category",
                    meta.map(|m| m.category.clone()).unwrap_or_default(),
                )
        })
        .collect();

    Response::json(
        Value::obj()
            .set("of", rel.to_string())
            // The query's own description, so a caller that only wants to know
            // what one sound is like need not read the whole ranking.
            .set(
                "tags",
                Value::Arr(
                    query
                        .descriptors(&cal)
                        .into_iter()
                        .map(|w| Value::Str(w.to_string()))
                        .collect(),
                ),
            )
            // What it *is*, next to what it is like. One request, because the
            // panel showing them is one panel.
            .set("heard", heard)
            // What the tag fields should say, and what they were last saved as.
            // The interface prefers the saved one; this way it can tell the
            // difference between "nobody has touched this" and "somebody
            // deliberately cleared it".
            .set("suggest", suggest_tags(app, rel, &query.descriptors(&cal)))
            .set("saved", saved_tags(app, rel))
            .set("yourTags", user_tags_value(app, rel))
            .set("measured", built as f64)
            .set("indexed", store.len() as f64)
            .set("results", Value::Arr(results))
            .to_string(),
    )
}

/// What the classifier heard in every file of a folder.
///
/// Separate from `/api/files` because the first call has to put the whole
/// library through the model, and a folder listing should not wait on that.
fn api_labels(app: &Arc<App>, req: &Request) -> Response {
    let Some(folder) = req.param("folder") else {
        return Response::error(400, "no folder given");
    };
    let built = ensure_labels(app);

    let paths: Vec<String> = {
        let idx = app.index.read().unwrap();
        idx.files
            .iter()
            .filter(|f| f.folder == folder)
            .map(|f| format!("{}/{}", f.folder, f.rel_path))
            .collect()
    };

    let mut files = Value::obj();
    for p in &paths {
        files = files.set(p.as_str(), heard_value(app, p));
    }
    Response::json(
        Value::obj()
            .set("folder", folder.to_string())
            .set("measured", built as f64)
            // So the interface can say "no model" rather than "no labels",
            // which are different problems with different fixes.
            .set("available", app.model.lock().unwrap().is_some())
            .set("files", files)
            .to_string(),
    )
}

/// Everything known about every sound, in one request.
///
/// The other endpoints are each shaped for one panel. This one is shaped for
/// whatever comes next — a visualiser, an export, an experiment — and the point
/// of it is that nothing has to be looked up a second time. Identity, format,
/// what the indexer decided from the name, what the model heard, what the
/// fingerprint measured (all twelve dimensions, not just the three the space
/// view projects onto), where it sits in that space, and any tags a person has
/// saved or the machine would suggest.
///
/// It is deliberately verbose. A library of ten thousand files is a few
/// megabytes of JSON, which is nothing next to fetching it in pieces.
fn api_sounds(app: &Arc<App>) -> Response {
    ensure_prints(app);
    ensure_labels(app);

    let prints = app.prints.read().unwrap();
    let cal = search::Calibration::build(prints.by_path.values().copied());
    let idx = app.index.read().unwrap();

    let axis = |n: &str| search::NAMES.iter().position(|x| *x == n).unwrap();
    let (bright, low, pulse, density, flat, noisy) = (
        axis("brightness"), axis("low"), axis("pulse"),
        axis("density"), axis("flatness"), axis("noisiness"),
    );

    let sounds: Vec<Value> = idx
        .files
        .iter()
        .map(|f| {
            let path = format!("{}/{}", f.folder, f.rel_path);
            let fp = prints.get(&path);
            let words = fp.map(|p| p.descriptors(&cal)).unwrap_or_default();

            // Every dimension by name, so a caller never has to know the order
            // they happen to be stored in.
            let mut measured = Value::obj();
            if let Some(p) = &fp {
                for (i, name) in search::NAMES.iter().enumerate() {
                    measured = measured.set(*name, p.v[i] as f64);
                }
            }

            let place = fp.map(|p| {
                Value::obj()
                    .set("x", (p.v[bright] - p.v[low] * 0.5) as f64)
                    .set("y", (p.v[pulse] * 0.6 + p.v[density] * 0.4) as f64)
                    .set("z", (p.v[flat] * 0.5 + p.v[noisy] * 0.5) as f64)
            });

            Value::obj()
                .set("path", path.clone())
                .set("folder", f.folder.clone())
                .set("subdir", f.subdir.clone())
                .set("name", f.filename.clone())
                .set("stem", f.stem.clone())
                .set("ext", f.ext.clone())
                .set("parentChain", f.parent_chain.clone())
                // The file as it sits on disk.
                .set("bytes", f.bytes as f64)
                .set("modified", f.modified.clone())
                .set("format", f.format.clone())
                .set("sampleRate", f.sample_rate as f64)
                .set("bits", f.bits as f64)
                .set("channels", f.channels as f64)
                .set("seconds", f.duration)
                // What the filename classifier made of it. Kept because it is
                // occasionally right and always explains itself, not because it
                // is trusted over the audio.
                .set("category", f.category.clone())
                .set("confidence", f.confidence.clone())
                .set("machine", f.machine.clone())
                .set("instrument", f.instrument.clone())
                .set("bpm", f.bpm.clone())
                .set("why", f.reasons.clone())
                .set("notes", f.notes.clone())
                .set(
                    "nameWords",
                    Value::Arr(
                        yamnet::propagate::name_words(&path)
                            .into_iter()
                            .map(Value::Str)
                            .collect(),
                    ),
                )
                .set(
                    "filenameDescriptors",
                    Value::Arr(f.descriptors.iter().cloned().map(Value::Str).collect()),
                )
                // Which numbered series it belongs to, if any.
                .set(
                    "series",
                    Value::obj()
                        .set("root", f.series_root.clone())
                        .set("index", f.series_index.map(|i| i as f64).unwrap_or(0.0))
                        .set("size", f.series_size.map(|s| s as f64).unwrap_or(0.0))
                        .set("family", yamnet::propagate::family(&path)),
                )
                // What it is, what it is like, and where that puts it.
                .set("heard", heard_value(app, &path))
                .set(
                    "soundsLike",
                    Value::Arr(words.iter().map(|w| Value::Str(w.to_string())).collect()),
                )
                .set("measured", measured)
                .set("place", place.unwrap_or(Value::Null))
                .set("suggested", suggest_tags(app, &path, &words))
                .set("saved", saved_tags(app, &path))
                .set("yourTags", user_tags_value(app, &path))
        })
        .collect();

    Response::json(
        Value::obj()
            .set("count", sounds.len() as f64)
            .set(
                "dimensions",
                Value::Arr(search::NAMES.iter().map(|n| Value::Str(n.to_string())).collect()),
            )
            .set("axes", Value::Arr(vec![
                Value::Str("dark → bright".into()),
                Value::Str("sustained → rhythmic".into()),
                Value::Str("tonal → noisy".into()),
            ]))
            .set("sounds", Value::Arr(sounds))
            .to_string(),
    )
}

/// Every sound as a point in a navigable space.
///
/// The three axes are named rather than derived. A principal-component
/// projection would pack more variance into three numbers, but its axes mean
/// nothing you can say out loud — and the point of flying through this space is
/// to know which way is brighter. Duration is carried separately because it
/// sets how long each shape is drawn, not where it sits.
fn api_space(app: &Arc<App>) -> Response {
    let built = ensure_prints(app);
    let store = app.prints.read().unwrap();
    let idx = app.index.read().unwrap();

    let idx_of = |n: &str| search::NAMES.iter().position(|x| *x == n).unwrap();
    let (bright, low, pulse, density, flat, noisy, dur) = (
        idx_of("brightness"), idx_of("low"), idx_of("pulse"),
        idx_of("density"), idx_of("flatness"), idx_of("noisiness"), idx_of("duration"),
    );

    let cal = search::Calibration::build(store.by_path.values().copied());

    let points: Vec<Value> = store
        .by_path
        .iter()
        .map(|(path, fp)| {
            let meta = idx
                .files
                .iter()
                .find(|f| format!("{}/{}", f.folder, f.rel_path) == *path);
            let words: Vec<Value> = fp
                .descriptors(&cal)
                .into_iter()
                .map(|w| Value::Str(w.to_string()))
                .collect();
            Value::obj()
                .set("path", path.clone())
                .set("name", meta.map(|m| m.filename.clone()).unwrap_or_else(|| path.clone()))
                // dark to bright, sustained to rhythmic, tonal to noisy.
                .set("x", (fp.v[bright] - fp.v[low] * 0.5) as f64)
                .set("y", (fp.v[pulse] * 0.6 + fp.v[density] * 0.4) as f64)
                .set("z", (fp.v[flat] * 0.5 + fp.v[noisy] * 0.5) as f64)
                .set("length", fp.v[dur] as f64)
                .set("seconds", meta.map(|m| m.duration).unwrap_or(0.0))
                .set("tags", Value::Arr(words))
        })
        .collect();

    Response::json(
        Value::obj()
            .set("measured", built as f64)
            .set("axes", Value::Arr(vec![
                Value::Str("dark → bright".into()),
                Value::Str("sustained → rhythmic".into()),
                Value::Str("tonal → noisy".into()),
            ]))
            .set("points", Value::Arr(points))
            .to_string(),
    )
}

#[cfg(test)]
mod tag_tests {
    use super::*;

    fn edit(pairs: &[(&str, &str)]) -> Value {
        let mut v = Value::obj();
        for (k, val) in pairs {
            v = v.set(*k, val.to_string());
        }
        v
    }

    fn field(root: &Value, section: &str, name: &str, key: &str) -> String {
        root.get(section)
            .and_then(|s| s.get(name))
            .and_then(|e| e.get(key))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string()
    }

    /// The browser sends only the fields that changed. Replacing the entry
    /// wholesale would clear the others without saying so.
    #[test]
    fn editing_one_field_leaves_the_others_alone() {
        let mut root = Value::obj();
        merge_entry(&mut root, "files", "P/a.wav", &edit(&[("level1", "Snare drum"), ("tags", "snare")]));
        merge_entry(&mut root, "files", "P/a.wav", &edit(&[("notes", "cracks nicely")]));

        assert_eq!(field(&root, "files", "P/a.wav", "level1"), "Snare drum");
        assert_eq!(field(&root, "files", "P/a.wav", "tags"), "snare");
        assert_eq!(field(&root, "files", "P/a.wav", "notes"), "cracks nicely");
    }

    #[test]
    fn a_field_can_be_deliberately_cleared() {
        let mut root = Value::obj();
        merge_entry(&mut root, "files", "P/a.wav", &edit(&[("tags", "snare")]));
        merge_entry(&mut root, "files", "P/a.wav", &edit(&[("tags", "")]));
        assert_eq!(field(&root, "files", "P/a.wav", "tags"), "");
    }

    #[test]
    fn files_and_folders_are_kept_apart() {
        let mut root = Value::obj();
        merge_entry(&mut root, "folders", "Pack", &edit(&[("level1", "Sample")]));
        merge_entry(&mut root, "files", "Pack/a.wav", &edit(&[("level1", "Snare drum")]));

        assert_eq!(field(&root, "folders", "Pack", "level1"), "Sample");
        assert_eq!(field(&root, "files", "Pack/a.wav", "level1"), "Snare drum");
    }

    #[test]
    fn one_file_edit_does_not_disturb_another() {
        let mut root = Value::obj();
        merge_entry(&mut root, "files", "P/a.wav", &edit(&[("tags", "kick")]));
        merge_entry(&mut root, "files", "P/b.wav", &edit(&[("tags", "snare")]));
        assert_eq!(field(&root, "files", "P/a.wav", "tags"), "kick");
        assert_eq!(field(&root, "files", "P/b.wav", "tags"), "snare");
    }

    /// The tags file is rewritten from the whole stored set every time, so a
    /// file edited last week must still be in it after one edited today.
    #[test]
    fn the_tags_file_carries_every_file_in_the_folder() {
        let dir = std::env::temp_dir().join(format!("audiolab-tags-{}", std::process::id()));
        let _ = std::fs::create_dir_all(dir.join("Pack"));

        let mut root = Value::obj();
        merge_entry(&mut root, "folders", "Pack", &edit(&[("level1", "Sample")]));
        merge_entry(&mut root, "files", "Pack/old.wav", &edit(&[("tags", "kick")]));
        merge_entry(&mut root, "files", "Pack/new.wav", &edit(&[("tags", "snare")]));
        merge_entry(&mut root, "files", "Other/x.wav", &edit(&[("tags", "elsewhere")]));

        write_tags_file(&dir, "Pack", &root).expect("write");
        let body = std::fs::read_to_string(dir.join("Pack/_TAGS.txt")).unwrap();

        assert!(body.contains("old.wav"), "an earlier edit was dropped:\n{body}");
        assert!(body.contains("new.wav"));
        assert!(body.contains("level1:      Sample"));
        assert!(!body.contains("elsewhere"), "another folder's file leaked in");
        let _ = std::fs::remove_dir_all(dir);
    }
}
