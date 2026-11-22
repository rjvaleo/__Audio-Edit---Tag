//! MultiGrainLive's `/api/wave/*` routes, answered in-process for one Wave on
//! the canvas, as MGL's server answers them (`server-core/src/wave_synth.rs`
//! and `wave_board.rs`): the same JSON, the same status codes, the same
//! error messages. The native face is a line-for-line port of the Wave
//! page's script, so it asks these and reads what comes back.
//!
//! What differs, and why:
//!
//! - **No device to open.** `note` and `control` never answer 503: the
//!   engine is already running. `device` in the state is whether the
//!   engine has played this Wave in the last half second.
//! - **No library.** A sound (`table/import`'s `sound`, a board node's
//!   `sound`) is an absolute file path. The error messages still say
//!   "library", as MGL's do, so the page's own handling of them holds.
//! - **Folders.** Tables are written into the first table folder
//!   (`set_table_dirs`, the app's own) and read from all of them. Presets
//!   and board presets are written into the app's own folder (`<home>/presets/wave`,
//!   `<home>/presets/wave-boards`) and read from it, then from MGL's
//!   (`data/wave/presets`, `data/wave/boards`), which is never written: a
//!   name in the app's folder wins, and unlisting one of MGL's writes a
//!   hidden copy into the app's folder (remove means unlist, never delete).
//! - **Saved.** MGL writes `patch.json` on every change; here the patch is
//!   the canvas module's, saved with the canvas.
//! - **Import's `grain`** is ignored, as MGL ignores it (every mode slices
//!   by count there too).

use crate::wave_part::{frames_for, safe, saved_table, table_dirs, WavePart};
use crate::wave_patch::{self, board_from_json, board_json, mod_json, num, num_of, param_json, parse_mods, parse_tags, patch_json, patch_from_json};
use crate::{engine_id, Part, Session};
use engine_core::{Controller, EventKind, ModuleId, NoteEvent, NoteKind};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use wave::board::{category_name, fx_entries, suite, Kind as NodeKind, ParamKind};
use wave::choice::{bank_names, option_name, ChoiceId, CHOICE_KEYS};
use wave::{param_id, Board, BoardError, Patch, PatchState, Stage, Telemetry, BUILTIN_NAMES, MAX_FRAMES};

/// The four example boards from MGL's mock-up, as MGL builds them in.
static FACTORY: &str = include_str!("../../../core/crates/server-core/src/wave_board/factory.json");

/// Points per frame in a table preview.
pub const PREVIEW_POINTS: usize = 256;
/// The frame lengths a posted table may have.
pub const MIN_FRAME_LEN: usize = 64;
pub const MAX_FRAME_LEN: usize = 4096;
/// One cycle, for slicing a sound: the stored frame length.
pub const CYCLE: usize = wave::FRAME_LEN;

/// Where Wave's own files go, and where MGL's are read.
#[derive(Clone, Debug)]
pub struct WaveDirs {
    /// The app's home: presets under `presets/wave`, boards under
    /// `presets/wave-boards`. None until the app says.
    pub home: Option<PathBuf>,
    /// MGL's `data/wave`, read only.
    pub mgl: Option<PathBuf>,
}

impl Default for WaveDirs {
    fn default() -> WaveDirs {
        let mgl = std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Documents/MultiGrainLive/data/wave"));
        WaveDirs { home: None, mgl }
    }
}

impl WaveDirs {
    fn presets(&self) -> Option<PathBuf> {
        self.home.as_ref().map(|h| h.join("presets").join("wave"))
    }
    fn mgl_presets(&self) -> Option<PathBuf> {
        self.mgl.as_ref().map(|m| m.join("presets"))
    }
    fn boards(&self) -> Option<PathBuf> {
        self.home.as_ref().map(|h| h.join("presets").join("wave-boards"))
    }
    fn mgl_boards(&self) -> Option<PathBuf> {
        self.mgl.as_ref().map(|m| m.join("boards"))
    }
}

/// A route's answer: the status MGL would give, and its JSON.
pub struct Reply {
    pub status: u16,
    pub body: Value,
}

fn ok_reply(body: Value) -> Reply {
    Reply { status: 200, body }
}

fn error(status: u16, msg: &str) -> Reply {
    Reply { status, body: obj([("error", msg.into())]) }
}

/// `400 {error, cable}`: the cable is the one at fault, when there is one.
fn refused(e: &BoardError) -> Reply {
    let mut v = obj([("error", e.message.as_str().into())]);
    if let Some(c) = e.cable {
        v["cable"] = c.into();
    }
    Reply { status: 400, body: v }
}

fn obj<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    Value::Object(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect::<Map<_, _>>())
}

fn ok() -> Value {
    obj([("ok", true.into())])
}

fn set(mut v: Value, k: &str, x: impl Into<Value>) -> Value {
    if let Some(o) = v.as_object_mut() {
        o.insert(k.into(), x.into());
    }
    v
}

/// MGL's `percent_decode`: escapes and `+`; a stray `%` is kept.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => match std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                Some(b) => {
                    out.push(b);
                    i += 3;
                }
                None => {
                    out.push(b'%');
                    i += 1;
                }
            },
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn parse_query(raw: &str) -> HashMap<String, String> {
    raw.split('&')
        .filter(|p| !p.is_empty())
        .map(|pair| {
            let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
            (percent_decode(k), percent_decode(v))
        })
        .collect()
}

/// The body as a JSON object, or MGL's 400.
fn body(raw: Option<&str>) -> Result<Value, Reply> {
    serde_json::from_str::<Value>(raw.unwrap_or("")).ok().filter(Value::is_object).ok_or_else(|| error(400, "expected a JSON object"))
}

macro_rules! take {
    ($e:expr) => {
        match $e {
            Ok(v) => v,
            Err(r) => return r,
        }
    };
}

/// Write `text` to `path` whole or not at all.
fn write_atomic(path: &Path, text: &str) -> std::io::Result<()> {
    let tmp = path.with_extension(format!("json.{}.part", std::process::id()));
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, path)
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn hidden(v: &Value) -> bool {
    matches!(v.get("hidden"), Some(Value::Bool(true)))
}

// ───────────────────────────────────────────────────────────── sounds

/// Decode a sound a board node names (an absolute path), as MGL's
/// `load_effect_sound` does: the first 8 seconds, interleaved, at its own
/// rate, kept by name where the effects find it. Nothing if it already is.
fn load_effect_sound(name: &str) {
    if mgl_fx::prism::sound(name).is_some() {
        return;
    }
    let path = Path::new(name);
    if !path.is_absolute() {
        return;
    }
    let Ok(mut reader) = audio_core::open(path) else { return };
    let info = reader.info();
    let rate = info.sample_rate.max(1);
    let channels = info.channels.max(1) as usize;
    let frames = info.frames().min(rate as u64 * 8);
    let Ok(samples) = reader.read_frames(0, frames) else { return };
    mgl_fx::prism::remember_sound(name, mgl_fx::prism::Sound { samples: std::sync::Arc::new(samples), channels, rate: rate as f32 });
}

/// Decode every sound `board` names that is not decoded yet. True if one was.
pub(crate) fn load_sounds(board: &Board) -> bool {
    let mut fresh = false;
    for name in board.nodes.iter().filter_map(|n| n.sound.as_deref()) {
        if mgl_fx::prism::sound(name).is_none() {
            load_effect_sound(name);
            fresh |= mgl_fx::prism::sound(name).is_some();
        }
    }
    fresh
}

/// A board node's sound, from those decoded.
pub(crate) fn board_sound(name: &str) -> Option<wave::board::Sound> {
    mgl_fx::prism::sound(name).map(|s| wave::board::Sound { samples: s.samples, channels: s.channels, rate: s.rate })
}

/// A sound, decoded whole, its channels averaged: MGL's `decode_mono`.
fn decode_mono(path: &Path) -> Result<Vec<f32>, String> {
    let mut reader = audio_core::open(path).map_err(|e| format!("could not open: {e}"))?;
    let info = reader.info();
    let channels = info.channels.max(1) as usize;
    let list = mgl_edit::EditList::identity(info.frames(), info.channels, info.sample_rate);
    let samples = mgl_edit::render::render(&list, &mut reader, 0, list.base_frames()).map_err(|e| format!("could not read the sound: {e}"))?;
    Ok(samples.chunks(channels).map(|f| f.iter().sum::<f32>() / channels as f32).collect())
}

/// `count` frames out of a sound, as MGL's `slice`: `count` windows of one
/// cycle spread from start to end, or for a sound too short for that,
/// `count` equal pieces of at least 64 samples (fewer if it must).
pub fn slice(mono: &[f32], count: usize) -> Option<Vec<Vec<f32>>> {
    let len = mono.len();
    let count = count.clamp(1, MAX_FRAMES);
    if len >= count * CYCLE {
        let span = len - CYCLE;
        return Some(
            (0..count)
                .map(|i| {
                    let at = if count > 1 { span * i / (count - 1) } else { 0 };
                    mono[at..at + CYCLE].to_vec()
                })
                .collect(),
        );
    }
    let count = count.min(len / MIN_FRAME_LEN);
    if count == 0 {
        return None;
    }
    let piece = len / count;
    Some((0..count).map(|i| mono[i * piece..(i + 1) * piece].to_vec()).collect())
}

// ───────────────────────────────────────────────────────────── tables

/// Frames from the page: 1 to 256 of them, all one length, 64 to 4096 long.
fn parse_frames(v: Option<&Value>) -> Result<Vec<Vec<f32>>, String> {
    let rows = v.and_then(Value::as_array).ok_or("frames must be a list of lists")?;
    if rows.is_empty() || rows.len() > MAX_FRAMES {
        return Err(format!("a table has 1 to {MAX_FRAMES} frames"));
    }
    let frames = rows
        .iter()
        .map(|r| r.as_array()?.iter().map(|x| x.as_f64().filter(|n| n.is_finite()).map(|n| n as f32)).collect::<Option<Vec<f32>>>())
        .collect::<Option<Vec<_>>>()
        .ok_or("every frame is a list of numbers")?;
    let len = frames[0].len();
    if !(MIN_FRAME_LEN..=MAX_FRAME_LEN).contains(&len) {
        return Err(format!("a frame is {MIN_FRAME_LEN} to {MAX_FRAME_LEN} samples"));
    }
    if frames.iter().any(|f| f.len() != len) {
        return Err("every frame must be the same length".into());
    }
    Ok(frames)
}

/// Each frame as the table will hold it (its DC out, its peak at one) at
/// `points` points: MGL's `preview`.
pub fn preview(frames: &[Vec<f32>], points: usize) -> Vec<Vec<f32>> {
    frames
        .iter()
        .take(MAX_FRAMES)
        .map(|f| {
            let n = f.len().max(1);
            let mean = f.iter().sum::<f32>() / n as f32;
            let mut out: Vec<f32> = (0..points)
                .map(|i| {
                    let p = i as f32 * n as f32 / points as f32;
                    let j = p as usize % n;
                    let u = p - p.floor();
                    let (a, b) = (f.get(j).copied().unwrap_or(0.0), f.get((j + 1) % n).copied().unwrap_or(0.0));
                    a + (b - a) * u - mean
                })
                .collect();
            let peak = out.iter().fold(0.0f32, |m, v| m.max(v.abs()));
            if peak > 1e-9 {
                out.iter_mut().for_each(|v| *v /= peak);
            }
            out
        })
        .collect()
}

/// A table as MGL saves one: a mono 32-bit float WAV, frame after frame, with
/// a `clm ` chunk giving the frame length.
pub fn table_wav(frames: &[Vec<f32>]) -> Vec<u8> {
    let len = frames.first().map_or(CYCLE, Vec::len);
    let mut clm = format!("<!>{len} 10000000 wavetable (MultiGrainLive)").into_bytes();
    if clm.len() % 2 == 1 {
        clm.push(0);
    }
    let data: Vec<u8> = frames.iter().flatten().flat_map(|v| v.to_le_bytes()).collect();
    let mut out = Vec::with_capacity(44 + clm.len() + 8 + data.len());
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

/// The tables saved in the table folders, by name (the first folder's
/// wins), with their frame counts: MGL's `user_tables` over every folder.
fn user_tables() -> Vec<(String, usize)> {
    let mut out: Vec<(String, usize)> = Vec::new();
    for dir in table_dirs() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()).map(str::to_lowercase).as_deref() != Some("wav") {
                continue;
            }
            let Some(name) = p.file_stem().map(|s| s.to_string_lossy().to_string()) else { continue };
            if BUILTIN_NAMES.contains(&name.as_str()) || out.iter().any(|(n, _)| *n == name) {
                continue;
            }
            if let Some(frames) = saved_table(&dir, &name) {
                out.push((name, frames.len()));
            }
        }
    }
    out.sort_by_key(|(n, _)| n.to_lowercase());
    out
}

fn table_json(name: &str, frames: &[Vec<f32>]) -> Value {
    let pv = preview(frames, PREVIEW_POINTS);
    obj([("name", name.into()), ("frames", Value::Array(pv.iter().map(|f| Value::Array(f.iter().map(|x| num(*x)).collect())).collect()))])
}

// ───────────────────────────────────────────────────────────── boards

fn sound_state(n: &wave::Node) -> &'static str {
    match n.sound.as_deref() {
        None => "none",
        Some(s) if mgl_fx::prism::sound(s).is_some() => "loaded",
        Some(_) => "unreadable",
    }
}

/// The board as stored, with each sound node's `soundState`, for a reply.
fn board_reply(b: &Board) -> Value {
    let mut v = board_json(b);
    if let Some(nodes) = v.get_mut("nodes").and_then(Value::as_array_mut) {
        for (o, n) in nodes.iter_mut().zip(&b.nodes) {
            if NodeKind::parse(&n.kind).is_some_and(NodeKind::takes_sound) {
                o["soundState"] = sound_state(n).into();
            }
        }
    }
    v
}

fn factory() -> Vec<Value> {
    serde_json::from_str::<Value>(FACTORY).ok().and_then(|v| v.as_array().cloned()).unwrap_or_default()
}

/// A board preset as listed: complete, with its `mods` and whether it is a
/// factory board.
fn listed(v: &Value, is_factory: bool) -> Option<Value> {
    let board = board_from_json(v).ok()?;
    let mut out = set(board_json(&board), "factory", is_factory);
    if let Some(m) = v.get("mods") {
        out = set(out, "mods", m.clone());
    }
    Some(out)
}

/// The `.json` files in `dir`, by file stem.
fn json_files(dir: Option<PathBuf>) -> Vec<(String, Value)> {
    let mut out = Vec::new();
    let Some(Ok(rd)) = dir.map(std::fs::read_dir) else { return out };
    for e in rd.flatten() {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }
        let (Some(stem), Some(v)) = (p.file_stem().map(|s| s.to_string_lossy().to_string()), read_json(&p)) else { continue };
        out.push((stem, v));
    }
    out
}

/// The app's files, then MGL's whose file name the app's folder lacks.
fn both(own: Option<PathBuf>, mgl: Option<PathBuf>) -> Vec<Value> {
    let mut files = json_files(own);
    let theirs = json_files(mgl);
    for (stem, v) in theirs {
        if !files.iter().any(|(s, _)| *s == stem) {
            files.push((stem, v));
        }
    }
    files.into_iter().map(|(_, v)| v).collect()
}

fn fx_list() -> Vec<Value> {
    fx_entries()
        .map(|e| {
            let d = e.descriptor;
            let params = d
                .params
                .iter()
                .filter(|p| !p.inert)
                .map(|p| {
                    let v = obj([
                        ("key", p.key.into()),
                        ("label", p.label.into()),
                        ("min", num(p.min)),
                        ("max", num(p.max)),
                        ("default", num(p.default)),
                        ("unit", p.unit.into()),
                        ("log", p.log.into()),
                    ]);
                    match p.kind {
                        ParamKind::Continuous => v,
                        ParamKind::Int => set(v, "step", 1),
                        ParamKind::Toggle => set(set(v, "step", 1), "toggle", true),
                        ParamKind::Choice(c) => set(set(v, "step", 1), "choices", Value::Array(c.iter().map(|s| Value::from(*s)).collect())),
                    }
                })
                .collect();
            let v = obj([
                ("kind", format!("fx:{}", d.id).into()),
                ("label", d.label.into()),
                ("category", category_name(d.category).into()),
                ("suite", suite(d.id).into()),
                ("params", Value::Array(params)),
            ]);
            match d.sound {
                Some(snd) => set(v, "sound", obj([("key", snd.key.into()), ("label", snd.label.into())])),
                None => v,
            }
        })
        .collect()
}

fn stage_letter(s: Stage) -> &'static str {
    match s {
        Stage::Attack => "a",
        Stage::Decay => "d",
        Stage::Sustain => "s",
        Stage::Release | Stage::Idle => "r",
    }
}

// ───────────────────────────────────────────────────────────── the routes

impl Session {
    /// Where Wave's presets and board presets go (`<home>/presets/wave`,
    /// `<home>/presets/wave-boards`), and MGL's `data/wave`, read only (None
    /// for none; MGL's own folder on this machine until told).
    pub fn set_wave_dirs(&mut self, home: Option<PathBuf>, mgl: Option<PathBuf>) {
        self.wave_dirs = WaveDirs { home, mgl };
    }

    pub fn wave_dirs(&self) -> &WaveDirs {
        &self.wave_dirs
    }

    fn with_wave<T>(&mut self, id: u32, f: impl FnOnce(&mut WavePart, &mut Controller, ModuleId, f32) -> T) -> Option<T> {
        let rate = self.rate;
        match self.modules.get_mut(&id).map(|m| &mut m.part) {
            Some(Part::Wave(w)) => Some(f(w, &mut self.ctl, engine_id(id, 0), rate)),
            _ => None,
        }
    }

    fn wave_ref(&self, id: u32) -> Option<&WavePart> {
        match self.modules.get(&id).map(|m| &m.part) {
            Some(Part::Wave(w)) => Some(w),
            _ => None,
        }
    }

    /// Wave module `id`'s side of MGL's `/api/wave` routes: `method`, `path`
    /// with any query, `body` the JSON sent. The status MGL would answer, and
    /// its JSON.
    pub fn wave_api(&mut self, id: u32, method: &str, path: &str, body: Option<&str>) -> Reply {
        let (route, query) = path.split_once('?').unwrap_or((path, ""));
        let query = parse_query(query);
        let needs_module = !matches!(
            (method, route),
            ("GET", "/api/wave/tables" | "/api/wave/table" | "/api/wave/presets" | "/api/wave/boards" | "/api/wave/fx")
                | ("POST", "/api/wave/table" | "/api/wave/table/import" | "/api/wave/boards")
                | ("DELETE", "/api/wave/boards")
        );
        if needs_module && self.wave_ref(id).is_none() {
            return error(404, &format!("no Wave module {id}"));
        }
        // Tables that have finished building, handed over on the way through.
        self.collect();
        match (method, route) {
            ("GET", "/api/wave/patch") => ok_reply(patch_json(self.wave_ref(id).unwrap().patch())),
            ("POST", "/api/wave/patch") => self.post_patch(id, body),
            ("POST", "/api/wave/param") => self.post_param(id, body),
            ("POST", "/api/wave/mods") => self.post_mods(id, body),
            ("POST", "/api/wave/note") => self.post_note(id, body),
            ("POST", "/api/wave/control") => self.post_control(id, body),
            ("GET", "/api/wave/state") => self.state(id),
            ("GET", "/api/wave/tables") => tables(),
            ("GET", "/api/wave/table") => get_table(query.get("name").map(String::as_str)),
            ("POST", "/api/wave/table") => self.post_table(body),
            ("POST", "/api/wave/table/import") => self.import(body),
            ("GET", "/api/wave/presets") => ok_reply(Value::Array(self.presets())),
            ("POST", "/api/wave/presets") => self.post_preset(id, body),
            ("GET", "/api/wave/board") => ok_reply(board_reply(&self.current_board(id))),
            ("POST", "/api/wave/board") => self.post_board(id, body),
            ("POST", "/api/wave/board/param") => self.post_board_param(id, body),
            ("GET", "/api/wave/boards") => ok_reply(Value::Array(self.board_presets())),
            ("POST", "/api/wave/boards") => self.post_board_preset(id, body),
            ("DELETE", "/api/wave/boards") => self.delete_board_preset(query.get("name").map(String::as_str)),
            ("GET", "/api/wave/fx") => ok_reply(Value::Array(fx_list())),
            _ => error(404, "no such endpoint"),
        }
    }

    /// `POST /api/wave/patch`: the whole patch, anything not given at its
    /// default; answered with the patch as adopted.
    fn post_patch(&mut self, id: u32, raw: Option<&str>) -> Reply {
        let v = take!(body(raw));
        let patch = match patch_from_json(&v, Patch::default()) {
            Ok(p) => p,
            Err(e) => return error(400, &e),
        };
        let out = self.with_wave(id, |w, ctl, m, rate| {
            w.adopt(ctl, m, patch, rate);
            patch_json(w.patch())
        });
        self.sync_tables();
        ok_reply(out.unwrap_or(Value::Null))
    }

    /// `POST /api/wave/param {key, value, live?}`: a number goes to the synth
    /// at once; anything else compiles the patch again. `live` is heard and
    /// not stored.
    fn post_param(&mut self, id: u32, raw: Option<&str>) -> Reply {
        let v = take!(body(raw));
        let Some(key) = v.get("key").and_then(Value::as_str) else { return error(400, "no key given") };
        let Some(value) = v.get("value") else { return error(400, "no value given") };
        // MGL reads true and false as 1 and 0.
        let value = match value {
            Value::Bool(b) if param_id(key).is_some() => Value::from(u8::from(*b)),
            other => other.clone(),
        };
        let live = matches!(v.get("live"), Some(Value::Bool(true)));
        let r = self.with_wave(id, |w, ctl, m, _| {
            let mut next = w.patch().clone();
            wave_patch::apply_param(&mut next, key, &value)?;
            let out = param_json(&next, key);
            if let Some(pid) = param_id(key) {
                let _ = ctl.send(m, EventKind::Param { index: pid.0 as u32, value: next.values[pid.index()] });
            } else {
                let _ = ctl.give(m, 0, Box::new(engine_mgl::WaveThing::Patch(PatchState::new(&next))));
                if live {
                    w.live_tables = Some(next.tables.clone());
                }
            }
            if !live {
                *w.patch_mut() = next;
            }
            Ok::<Value, String>(out)
        });
        let out = match r {
            Some(Ok(out)) => out,
            Some(Err(e)) => return error(400, &e),
            None => return error(404, &format!("no Wave module {id}")),
        };
        self.sync_tables();
        ok_reply(set(set(set(ok(), "key", key), "value", out), "live", live))
    }

    /// `POST /api/wave/mods {mods}`: the whole matrix.
    fn post_mods(&mut self, id: u32, raw: Option<&str>) -> Reply {
        let v = take!(body(raw));
        let mods = match v.get("mods").map(parse_mods) {
            Some(Ok(m)) => m,
            Some(Err(e)) => return error(400, &e),
            None => return error(400, "no mods given"),
        };
        let out = self.with_wave(id, |w, ctl, m, _| {
            w.patch_mut().mods = mods;
            let _ = ctl.give(m, 0, Box::new(engine_mgl::WaveThing::Patch(PatchState::new(w.patch()))));
            Value::Array(w.patch().mods.iter().map(mod_json).collect())
        });
        // A row onto a table wants the bank built.
        self.sync_tables();
        ok_reply(set(ok(), "mods", out.unwrap_or(Value::Null)))
    }

    /// `POST /api/wave/note {note, vel, on}`.
    fn post_note(&mut self, id: u32, raw: Option<&str>) -> Reply {
        let v = take!(body(raw));
        let Some(note) = num_of(v.get("note")).filter(|n| (0.0..=127.0).contains(n)) else {
            return error(400, "note must be 0 to 127");
        };
        let note = note.round() as u8;
        let vel = num_of(v.get("vel")).unwrap_or(0.8).clamp(0.0, 1.0) as f32;
        let on = num_of(v.get("on")).is_none_or(|x| x != 0.0) && vel > 0.0;
        let queued = self.note(id, on, note, vel).is_ok();
        ok_reply(set(set(set(ok(), "note", note), "on", on), "queued", queued))
    }

    /// `POST /api/wave/control {bend}`, `{mw}`, `{at}` or `{allOff: true}`.
    fn post_control(&mut self, id: u32, raw: Option<&str>) -> Reply {
        let v = take!(body(raw));
        let mut wheels = Vec::new();
        if let Some(b) = num_of(v.get("bend")) {
            wheels.push((0, b.clamp(-1.0, 1.0) as f32));
        }
        if let Some(m) = num_of(v.get("mw")) {
            wheels.push((1, m.clamp(0.0, 1.0) as f32));
        }
        if let Some(a) = num_of(v.get("at")) {
            wheels.push((2, a.clamp(0.0, 1.0) as f32));
        }
        let all_off = matches!(v.get("allOff"), Some(Value::Bool(true)));
        if wheels.is_empty() && !all_off {
            return error(400, "expected bend, mw, at or allOff");
        }
        for (which, value) in wheels {
            let _ = self.wave_wheel(id, which, value);
        }
        if all_off {
            let off = NoteEvent { kind: NoteKind::AllOff, ..NoteEvent::off(0) };
            let _ = self.ctl.send(engine_id(id, 0), EventKind::Note(off));
        }
        ok_reply(ok())
    }

    /// `GET /api/wave/state`: the telemetry, as MGL's `state()` gives it,
    /// read from what the synth last wrote. With the engine not running it
    /// says so: no voices, silence.
    fn state(&mut self, id: u32) -> Reply {
        let mut t = Telemetry::default();
        let mut recent = [0.0f32; engine_mgl::WAVE_POINTS];
        let Some((device, bank, running)) = self.with_wave(id, |w, _, _, _| {
            let written = w.view.read(&mut t, &mut recent);
            let now = std::time::Instant::now();
            if written != w.seen.0 {
                w.seen = (written, Some(now));
            }
            let device = w.seen.1.is_some_and(|at| now.duration_since(at).as_millis() < 500);
            (device, bank_names(w.playing()), w.running.clone())
        }) else {
            return error(404, &format!("no Wave module {id}"));
        };
        let n = |v: f32| num(if device { v } else { 0.0 });
        let voices = if device {
            t.voices()
                .iter()
                .map(|v| obj([("note", v.note.into()), ("vel", num(v.vel)), ("env", num(v.env)), ("stage", stage_letter(v.stage).into())]))
                .collect()
        } else {
            Vec::new()
        };
        let mut mods = BTreeMap::new();
        if device {
            for (pid, v) in t.mods() {
                mods.insert(pid.key().to_string(), num(*v));
            }
            for (c, key) in CHOICE_KEYS.iter().enumerate().filter(|(c, _)| t.choice_touched >> c & 1 == 1) {
                let i = t.choice[c] as usize;
                let name = option_name(ChoiceId(c as u8), i).map(str::to_string).or_else(|| bank.get(i).cloned());
                mods.insert(key.to_string(), name.map_or(Value::Null, Value::String));
            }
        }
        let arr = |xs: &[f32]| Value::Array(xs.iter().map(|x| n(*x)).collect());
        let board: Map<String, Value> = running
            .map(|b| {
                b.nodes
                    .iter()
                    .enumerate()
                    .map(|(i, node)| {
                        let p = if device { t.board().get(i).copied().unwrap_or([0.0; 2]) } else { [0.0; 2] };
                        (node.id.clone(), Value::Array(vec![num(p[0]), num(p[1])]))
                    })
                    .collect()
            })
            .unwrap_or_default();
        ok_reply(obj([
            ("voices", Value::Array(voices)),
            ("pos", arr(&t.pos)),
            ("lfo", arr(&t.lfo_phase)),
            ("lfoPhase", arr(&t.lfo_phase)),
            ("lfoValue", arr(&t.lfo)),
            ("mod", Value::Object(mods.into_iter().collect())),
            ("peak", arr(&t.peak)),
            ("wave", arr(&recent)),
            ("device", device.into()),
            ("board", Value::Object(board)),
        ]))
    }

    fn post_table(&mut self, raw: Option<&str>) -> Reply {
        let v = take!(body(raw));
        let Some(name) = v.get("name").and_then(Value::as_str) else { return error(400, "no name given") };
        let frames = match parse_frames(v.get("frames")) {
            Ok(f) => f,
            Err(e) => return error(400, &e),
        };
        self.store_table(name, frames)
    }

    /// Save a table under a name it may have (a built-in's edit as "<name>
    /// (edited)"), into the first table folder; build it and give it to every
    /// oscillator playing that name; answer with what was stored.
    fn store_table(&mut self, name: &str, frames: Vec<Vec<f32>>) -> Reply {
        let mut stored = safe(name).trim_start_matches('.').to_string();
        if stored.is_empty() {
            return error(400, "the name is empty");
        }
        if BUILTIN_NAMES.contains(&stored.as_str()) {
            stored = format!("{stored} (edited)");
        }
        let Some(dir) = table_dirs().into_iter().next() else {
            return error(500, "could not save the table: no table folder");
        };
        if let Err(e) = std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(dir.join(format!("{stored}.wav")), table_wav(&frames))) {
            return error(500, &format!("could not save the table: {e}"));
        }
        let reply = table_json(&stored, &frames);
        self.tables.rebuild(&stored, frames);
        self.sync_tables();
        ok_reply(reply)
    }

    /// `POST /api/wave/table/import {sound, name, mode, frames}`: a sound
    /// (an absolute path) sliced into a table.
    fn import(&mut self, raw: Option<&str>) -> Reply {
        let v = take!(body(raw));
        let Some(sound) = v.get("sound").and_then(Value::as_str).filter(|s| !s.is_empty()) else {
            return error(400, "no sound given");
        };
        let mode = v.get("mode").and_then(Value::as_str).unwrap_or("count");
        if !["count", "note", "pitch", "spectral"].contains(&mode) {
            return error(400, &format!("unknown import mode {mode:?}"));
        }
        let count = num_of(v.get("frames")).unwrap_or(64.0).round().clamp(1.0, MAX_FRAMES as f64) as usize;
        let path = Path::new(sound);
        if !path.is_absolute() || !path.is_file() {
            return error(404, "no such file in the library");
        }
        let mono = match decode_mono(path) {
            Ok(m) => m,
            Err(e) => return error(400, &e),
        };
        let Some(frames) = slice(&mono, count) else { return error(400, "the sound is too short to slice") };
        let name = v
            .get("name")
            .and_then(Value::as_str)
            .filter(|n| !n.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Import".into()));
        self.store_table(&name, frames)
    }

    /// `GET /api/wave/presets`: the listed presets by name, the app's and
    /// then MGL's.
    fn presets(&self) -> Vec<Value> {
        let mut out: Vec<(String, Value)> = Vec::new();
        for v in both(self.wave_dirs.presets(), self.wave_dirs.mgl_presets()) {
            if hidden(&v) {
                continue;
            }
            let name = v.get("name").and_then(Value::as_str).unwrap_or("").to_string();
            let shown = obj([
                ("name", name.clone().into()),
                ("tags", v.get("tags").cloned().unwrap_or(Value::Array(Vec::new()))),
                ("patch", v.get("patch").cloned().unwrap_or_else(|| Value::Object(Map::new()))),
            ]);
            out.push((name.to_lowercase(), shown));
        }
        out.sort_by(|a, b| a.0.cmp(&b.0));
        out.into_iter().map(|(_, v)| v).collect()
    }

    /// `POST /api/wave/presets {name, tags, patch}` saves one (the module's
    /// patch when `patch` is left out); `{name, remove: true}` unlists it.
    fn post_preset(&mut self, id: u32, raw: Option<&str>) -> Reply {
        let v = take!(body(raw));
        let Some(name) = v.get("name").and_then(Value::as_str).map(str::trim).filter(|n| !n.is_empty()) else {
            return error(400, "no name given");
        };
        let file = safe(name).trim_start_matches('.').to_string();
        if file.is_empty() {
            return error(400, "the name is empty");
        }
        let unlist = [v.get("remove"), v.get("hidden")].iter().any(|x| matches!(x, Some(Value::Bool(true))));
        let own = self.wave_dirs.presets();
        if unlist {
            let mine = own.as_ref().map(|d| d.join(format!("{file}.json")));
            let held = mine.as_deref().and_then(read_json).or_else(|| self.wave_dirs.mgl_presets().and_then(|d| read_json(&d.join(format!("{file}.json")))));
            let Some(held) = held else { return error(404, &format!("no preset called {name:?}")) };
            let Some(dir) = own else { return error(500, "could not unlist the preset: no home folder") };
            let held = set(held, "hidden", true);
            if let Err(e) = std::fs::create_dir_all(&dir).and_then(|_| write_atomic(&dir.join(format!("{file}.json")), &held.to_string())) {
                return error(500, &format!("could not unlist the preset: {e}"));
            }
            return ok_reply(set(set(ok(), "name", name), "hidden", true));
        }
        let patch = match v.get("patch") {
            Some(p) => {
                if let Err(e) = patch_from_json(p, Patch::default()) {
                    return error(400, &e);
                }
                p.clone()
            }
            None => match self.wave_ref(id) {
                Some(w) => patch_json(w.patch()),
                None => return error(404, &format!("no Wave module {id}")),
            },
        };
        let tags = Value::Array(parse_tags(v.get("tags")).into_iter().map(Value::String).collect());
        let held = obj([("name", name.into()), ("tags", tags), ("patch", patch), ("hidden", false.into())]);
        let Some(dir) = own else { return error(500, "could not save the preset: no home folder") };
        if let Err(e) = std::fs::create_dir_all(&dir).and_then(|_| write_atomic(&dir.join(format!("{file}.json")), &held.to_string())) {
            return error(500, &format!("could not save the preset: {e}"));
        }
        ok_reply(set(set(ok(), "name", name), "hidden", false))
    }

    /// The module's stored board, made from an old patch's chain if it has none.
    fn current_board(&self, id: u32) -> Board {
        let Some(w) = self.wave_ref(id) else { return Board::default() };
        let mut p = w.patch().clone();
        wave_patch::ensure(&mut p);
        p.board.unwrap_or_default()
    }

    /// Store `board` in the patch (unless `live`) and hand it to the synth:
    /// a change of controls alone as live writes, anything else compiled;
    /// the patch too when its nodes were renumbered, so its board rows are
    /// compiled against the new ones. A board that won't compile is refused
    /// and the old one kept.
    fn adopt_board(&mut self, id: u32, board: Board, live: bool) -> Result<(), Reply> {
        let r = self.with_wave(id, |w, ctl, m, rate| {
            let mut next = w.patch().clone();
            wave_patch::ensure(&mut next);
            let renumbered = next.board.as_ref().map(Board::sig) != Some(board.sig());
            w.give_board(ctl, m, &board, rate).map_err(|e| refused(&e))?;
            next.board = Some(board);
            if renumbered {
                let _ = ctl.give(m, 0, Box::new(engine_mgl::WaveThing::Patch(PatchState::new(&next))));
            }
            if !live {
                *w.patch_mut() = next;
            }
            Ok(())
        });
        r.unwrap_or_else(|| Err(error(404, &format!("no Wave module {id}"))))
    }

    fn post_board(&mut self, id: u32, raw: Option<&str>) -> Reply {
        let v = take!(body(raw));
        let board = match board_from_json(&v) {
            Ok(b) => b,
            Err(e) => return refused(&e),
        };
        match self.adopt_board(id, board.clone(), false) {
            Ok(()) => ok_reply(board_reply(&board)),
            Err(r) => r,
        }
    }

    /// `POST /api/wave/board/param {node, key, value, live?}`: one control,
    /// `on` for the node's switch, or `sound` for a node that takes one.
    fn post_board_param(&mut self, id: u32, raw: Option<&str>) -> Reply {
        let v = take!(body(raw));
        let s = |k: &str| v.get(k).and_then(Value::as_str);
        let (Some(node), Some(key)) = (s("node"), s("key")) else { return error(400, "node and key are needed") };
        let live = matches!(v.get("live"), Some(Value::Bool(true)));
        if key == "sound" {
            return self.post_sound(id, node, v.get("value"), live);
        }
        let value = match v.get("value") {
            Some(Value::Number(x)) if x.as_f64().is_some_and(f64::is_finite) => x.as_f64().unwrap_or(0.0) as f32,
            Some(Value::Bool(b)) => f32::from(u8::from(*b)),
            _ => return error(400, "value must be a number"),
        };
        let mut board = self.current_board(id);
        let Some((i, n)) = board.node(node) else { return error(400, &format!("no node {node:?}")) };
        let kind = n.kind.clone();
        let stored = if key == "on" {
            board.nodes[i].on = value >= 0.5;
            Value::Bool(value >= 0.5)
        } else {
            let Some(spec) = NodeKind::parse(&kind).and_then(|k| k.params().iter().find(|p| p.key == key)) else {
                return error(400, &format!("{kind} has no control {key:?}"));
            };
            let x = spec.clamp(value);
            board.nodes[i] = board.nodes[i].clone().with(key, x);
            num(x)
        };
        let board = match board.complete() {
            Ok(b) => b,
            Err(e) => return refused(&e),
        };
        if let Err(r) = self.adopt_board(id, board, live) {
            return r;
        }
        ok_reply(obj([("ok", true.into()), ("node", node.into()), ("key", key.into()), ("value", stored), ("live", live.into())]))
    }

    /// A node's sound: a file that decodes, or null for none.
    fn post_sound(&mut self, id: u32, node: &str, value: Option<&Value>, live: bool) -> Reply {
        let sound = match value {
            None | Some(Value::Null) => None,
            Some(Value::String(p)) => Some(p.trim().to_string()).filter(|p| !p.is_empty()),
            Some(_) => return error(400, "a sound is a library path, or null for none"),
        };
        let mut board = self.current_board(id);
        let Some((i, n)) = board.node(node) else { return error(400, &format!("no node {node:?}")) };
        if !NodeKind::parse(&n.kind).is_some_and(NodeKind::takes_sound) {
            return error(400, &format!("{} takes no sound", n.kind));
        }
        if let Some(name) = sound.as_deref() {
            let p = Path::new(name);
            if !p.is_absolute() || !p.is_file() {
                return error(400, &format!("no sound {name:?} in the library"));
            }
            load_effect_sound(name);
            if mgl_fx::prism::sound(name).is_none() {
                return error(400, &format!("{name:?} could not be read as a sound"));
            }
        }
        board.nodes[i].sound = sound.clone();
        let state = sound_state(&board.nodes[i]);
        if let Err(r) = self.adopt_board(id, board, live) {
            return r;
        }
        ok_reply(obj([
            ("ok", true.into()),
            ("node", node.into()),
            ("key", "sound".into()),
            ("value", sound.map_or(Value::Null, Value::String)),
            ("soundState", state.into()),
            ("live", live.into()),
        ]))
    }

    /// `GET /api/wave/boards`: the factory boards in their order (or what was
    /// saved over them), then the saved ones by name; hidden ones left out.
    fn board_presets(&self) -> Vec<Value> {
        let mut saved: Vec<(String, Value)> =
            both(self.wave_dirs.boards(), self.wave_dirs.mgl_boards()).into_iter().map(|v| (v.get("name").and_then(Value::as_str).unwrap_or("").to_string(), v)).collect();
        saved.sort_by_key(|(n, _)| n.to_lowercase());
        let mut out = Vec::new();
        for f in factory() {
            let name = f.get("name").and_then(Value::as_str).unwrap_or("").to_string();
            match saved.iter().position(|(n, _)| *n == name) {
                Some(i) => {
                    let (_, v) = saved.remove(i);
                    if !hidden(&v) {
                        out.extend(listed(&v, false));
                    }
                }
                None => out.extend(listed(&f, true)),
            }
        }
        out.extend(saved.iter().filter(|(_, v)| !hidden(v)).filter_map(|(_, v)| listed(v, false)));
        out
    }

    /// `POST /api/wave/boards {name, board?, mods?}`: save a board preset
    /// (the module's board when `board` is left out).
    fn post_board_preset(&mut self, id: u32, raw: Option<&str>) -> Reply {
        let v = take!(body(raw));
        let Some(name) = v.get("name").and_then(Value::as_str).map(str::trim).filter(|n| !n.is_empty()) else {
            return error(400, "no name given");
        };
        let file = safe(name).trim_start_matches('.').to_string();
        if file.is_empty() {
            return error(400, "the name is empty");
        }
        let mut board = match v.get("board") {
            Some(b) => match board_from_json(b) {
                Ok(b) => b,
                Err(e) => return refused(&e),
            },
            None => self.current_board(id),
        };
        board.name = name.to_string();
        let mut held = set(board_json(&board), "hidden", false);
        if let Some(m) = v.get("mods") {
            match parse_mods(m) {
                Ok(rows) => held = set(held, "mods", Value::Array(rows.iter().map(mod_json).collect())),
                Err(e) => return error(400, &e),
            }
        }
        let Some(dir) = self.wave_dirs.boards() else { return error(500, "could not save the board: no home folder") };
        if let Err(e) = std::fs::create_dir_all(&dir).and_then(|_| write_atomic(&dir.join(format!("{file}.json")), &held.to_string())) {
            return error(500, &format!("could not save the board: {e}"));
        }
        ok_reply(set(ok(), "name", name))
    }

    /// `DELETE /api/wave/boards?name=`: unlist a board preset; a hidden copy
    /// is kept in the app's folder.
    fn delete_board_preset(&mut self, name: Option<&str>) -> Reply {
        let Some(name) = name.map(str::trim).filter(|n| !n.is_empty()) else { return error(400, "no name given") };
        let file = safe(name).trim_start_matches('.').to_string();
        if file.is_empty() {
            return error(400, "the name is empty");
        }
        let at = |d: Option<PathBuf>| d.and_then(|d| read_json(&d.join(format!("{file}.json"))));
        let held = at(self.wave_dirs.boards())
            .or_else(|| at(self.wave_dirs.mgl_boards()))
            .or_else(|| factory().into_iter().find(|f| f.get("name").and_then(Value::as_str) == Some(name)));
        let Some(held) = held else { return error(404, &format!("no board called {name:?}")) };
        let Some(dir) = self.wave_dirs.boards() else { return error(500, "could not unlist the board: no home folder") };
        let held = set(held, "hidden", true);
        if let Err(e) = std::fs::create_dir_all(&dir).and_then(|_| write_atomic(&dir.join(format!("{file}.json")), &held.to_string())) {
            return error(500, &format!("could not unlist the board: {e}"));
        }
        ok_reply(set(set(ok(), "name", name), "hidden", true))
    }
}

/// `GET /api/wave/tables`: `[{name, frames, builtin}]`, the built-ins first.
fn tables() -> Reply {
    let mut out: Vec<Value> = BUILTIN_NAMES
        .iter()
        .map(|n| obj([("name", (*n).into()), ("frames", wave::table::BUILTIN_FRAMES.into()), ("builtin", true.into())]))
        .collect();
    for (name, frames) in user_tables() {
        out.push(obj([("name", name.into()), ("frames", frames.into()), ("builtin", false.into())]));
    }
    ok_reply(Value::Array(out))
}

/// `GET /api/wave/table?name=`: each frame at 256 points.
fn get_table(name: Option<&str>) -> Reply {
    let Some(name) = name.filter(|n| !n.is_empty()) else { return error(400, "no name given") };
    match frames_for(name) {
        Some(frames) => ok_reply(table_json(name, &frames)),
        None => error(404, &format!("no table called {name:?}")),
    }
}
