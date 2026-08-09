//! Request routing.

use crate::http::{parse_range, Request, Response};
use crate::json::{self, Value};
use crate::safety::{resolve_for_write, resolve_within};
use crate::state::{App, Index};
use audio_core::{probe, wav, FileSource, RandomAccessSource};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;

pub const UI_HTML: &str = include_str!("../../../../ui/index.html");
pub const UI_CSS: &str = include_str!("../../../../ui/app.css");
pub const UI_JS: &str = include_str!("../../../../ui/app.js");

pub fn route(app: &Arc<App>, req: &Request) -> Response {
    match (req.method.as_str(), req.path.as_str()) {
        ("GET" | "HEAD", "/") | ("GET" | "HEAD", "/index.html") => {
            Response::ok("text/html; charset=utf-8", UI_HTML.as_bytes().to_vec())
        }
        ("GET", "/app.css") => Response::ok("text/css; charset=utf-8", UI_CSS.as_bytes().to_vec()),
        ("GET", "/app.js") => Response::ok(
            "text/javascript; charset=utf-8",
            UI_JS.as_bytes().to_vec(),
        ),

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
        ("POST", "/api/presets/delete") => api_preset_delete(app, req),
        ("GET", "/api/grains") => api_grains(app, req),
        ("GET", "/api/edit") => api_edit_get(app, req),
        ("POST", "/api/edit") => api_edit_apply(app, req),
        ("POST", "/api/export") => api_export(app, req),
        ("GET", "/api/similar") => api_similar(app, req),
        ("GET", "/api/space") => api_space(app),
        ("POST", "/api/engine/load") => api_engine_load(app, req),
        ("GET", "/api/engine/state") => api_engine_state(app),
        ("POST", "/api/engine/transport") => api_engine_transport(app, req),
        ("GET", "/api/engine/grains") => api_engine_grains(app),
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
    let Some(list) = app.edits.snapshot(rel) else {
        return Response::error(400, "that file has no settings to save");
    };

    let preset = crate::persist::Preset {
        name: name.clone(),
        note: v.get("note").and_then(|n| n.as_str()).unwrap_or("").to_string(),
        stretch: list.stretch,
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

    if !preset.rack.slots.is_empty() {
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
                let ratio = float("ratio", 1.0).clamp(0.01, 100.0);
                let semis = float("semitones", 0.0).clamp(-48.0, 48.0);
                let window = float("windowMs", 40.0).clamp(5.0, 2000.0);
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
                let grain = fx::Grain {
                    density_hz: gf("densityHz", cur.density_hz).clamp(0.0, 500.0),
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
                };
                s.apply(|l| {
                    l.stretch = fx::Stretch {
                        ratio, semitones: semis, window_ms: window, quality, grain,
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

    // Merge with what is already stored rather than replacing it.
    let mut current = std::fs::read_to_string(app.overrides_path())
        .ok()
        .and_then(|s| json::parse(&s))
        .unwrap_or_else(Value::obj);

    let mut written = 0usize;
    if let Some(folders) = payload.get("folders").and_then(|f| f.as_obj()) {
        for (name, edit) in folders {
            if let Value::Obj(m) = &mut current {
                let entry = m.entry("folders".into()).or_insert_with(Value::obj);
                if let Value::Obj(fm) = entry {
                    fm.insert(name.clone(), edit.clone());
                }
            }
            if write_tags_file(&lib, name, edit).is_ok() {
                written += 1;
            }
        }
    }

    if let Err(e) = std::fs::write(app.overrides_path(), current.to_string()) {
        return Response::error(500, &e.to_string());
    }
    Response::json(
        Value::obj()
            .set("ok", true)
            .set("foldersWritten", written)
            .to_string(),
    )
}

fn write_tags_file(lib: &Path, folder: &str, edit: &Value) -> std::io::Result<()> {
    let rel = format!("{folder}/_TAGS.txt");
    let Some(path) = resolve_for_write(lib, &rel) else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "folder is outside the library",
        ));
    };
    let field = |k: &str| edit.get(k).and_then(|v| v.as_str()).unwrap_or("");
    let body = format!(
        "# Audio Library tags\n\
         # Written by the library browser. Describes this folder only.\n\
         # Nothing was renamed, moved or deleted. Safe to delete this file.\n\
         \n\
         folder:      {folder}\n\
         level1:      {}\n\
         level2:      {}\n\
         tags:        {}\n\
         notes:       {}\n\
         edited:      by hand in the library browser\n",
        field("level1"),
        field("level2"),
        field("tags"),
        field("notes"),
    );
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
    match crate::live::with(app, |h| {
        Value::obj()
            .set("playing", h.shared.is_playing())
            .set("position", h.shared.position() as f64)
            .set("sampleRate", h.sample_rate as f64)
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

    let store = app.prints.read().unwrap();
    let Some(query) = store.get(rel) else {
        return Response::error(404, "that sound could not be measured");
    };

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
                            .map(|f| f.descriptors())
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
            .set("measured", built as f64)
            .set("indexed", store.len() as f64)
            .set("results", Value::Arr(results))
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

    let points: Vec<Value> = store
        .by_path
        .iter()
        .map(|(path, fp)| {
            let meta = idx
                .files
                .iter()
                .find(|f| format!("{}/{}", f.folder, f.rel_path) == *path);
            let words: Vec<Value> = fp
                .descriptors()
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
