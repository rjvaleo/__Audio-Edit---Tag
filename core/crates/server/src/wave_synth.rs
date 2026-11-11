//! The Wave page's synth, on the server's side: `/api/wave/*`.
//!
//! `docs/WAVE-SYNTH.md` is the contract for every key, route and JSON shape
//! here. The engine half is `engine::synth`; the DSP is the `wave` crate.
//!
//! # What lives where
//!
//! - **The patch** is a [`wave::Patch`] held here, saved to
//!   `<data>/wave/patch.json` on every change that is not `live`, and read
//!   back at start (the default patch if there is none, or it does not parse).
//!   What the engine plays is a compiled [`PatchState`] handed to the synth
//!   deck's `WaveShared`, which this keeps for the life of the process and
//!   gives to every audio device it opens.
//! - **Tables** are by name. The five built-ins come from the `wave` crate;
//!   the rest are saved under `<data>/wave/tables/` as 32-bit float WAVs with
//!   a Serum-style `clm ` chunk (`<!>2048 …`), so a table made here opens in
//!   any wavetable synth that reads that, and a Serum table dropped in the
//!   folder opens here.
//! - **Presets** are `<data>/wave/presets/<name>.json`. Removing one marks it
//!   hidden and leaves the file: RJ's rule is that remove means unlist, never
//!   delete.
//!
//! # Building a table is slow, so it is never done on a request
//!
//! [`Wavetable::from_frames`] is a fifth of a second for 64 frames and most
//! of a second for 256 (an FFT and eleven mip levels a frame). So a request
//! that needs a table — a table posted from Create, an import, a patch naming
//! a table not yet built — starts a builder thread and answers at once. The
//! oscillators keep playing what they had until the new table is ready, then
//! it is swapped in. The previews a reply carries are drawn from the frames
//! directly, which costs nothing.
//!
//! # No device needed, except to play
//!
//! Only `note` and `control` open the audio device (`live::ensure`, the way
//! Prism's load does). Everything else — the patch, tables, presets, the
//! telemetry poll — works on a machine with no output at all
//! (`docs/NO-AUDIO-DEVICE.md`); the state poll then reports no voices.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use engine::{WaveEvent, WaveShared};
use wave::patch::Source;
use wave::{param_id, Curve, Mod, Patch, PatchState, Stage, Wavetable, BUILTIN_NAMES, MAX_FRAMES, POINT_KEYS, STR_KEYS};

use crate::http::{Request, Response};
use crate::json::{self, Value};
use crate::state::App;

/// Points per frame in a preview: what the page draws with.
pub const PREVIEW_POINTS: usize = 256;
/// The frame lengths a posted table may have (the contract's 64 to 4096).
pub const MIN_FRAME_LEN: usize = 64;
pub const MAX_FRAME_LEN: usize = 4096;
/// One cycle, for slicing a sound: the stored frame length.
pub const CYCLE: usize = wave::FRAME_LEN;
/// Mod rows a patch may carry (the matrix's 64).
const MAX_MODS: usize = wave::patch::MAX_MODS;

/// Everything the server keeps for the synth.
pub struct WaveState {
    /// Given to every audio device opened (`live::ensure`), so the synth deck
    /// keeps its patch and tables across a device being reopened.
    pub shared: Arc<WaveShared>,
    pub(crate) dir: PathBuf,
    pub(crate) inner: Arc<Mutex<Inner>>,
    /// Whether the patch's tables have been asked for since start.
    synced: AtomicBool,
}

pub(crate) struct Inner {
    pub(crate) patch: Patch,
    /// The table each oscillator should be playing: the patch's, or a live
    /// choice not yet stored. A finished build goes to every oscillator whose
    /// name it is.
    playing: [String; 3],
    /// Tables built and in use. Trimmed to `playing` after every change, so
    /// what is held is what is heard (a 256-frame table is 23 MB of mips).
    built: HashMap<String, Arc<Wavetable>>,
    /// Builds in flight, by name, with the number of the request that started
    /// each. A build finishing after a newer one for the same name started is
    /// thrown away rather than put over it.
    building: HashMap<String, u64>,
    serial: u64,
}

impl WaveState {
    /// Read the saved patch, or start from the default one.
    pub fn load(data_dir: &Path) -> WaveState {
        let dir = data_dir.join("wave");
        let patch = std::fs::read_to_string(dir.join("patch.json"))
            .ok()
            .and_then(|s| json::parse(&s))
            .and_then(|v| match patch_from_json(&v, Patch::default()) {
                Ok(p) => Some(p),
                Err(e) => {
                    eprintln!("wave: the saved patch could not be read ({e}); starting from the default");
                    None
                }
            })
            .unwrap_or_default();
        let mut patch = patch;
        crate::wave_board::ensure(&mut patch);
        let shared = Arc::new(WaveShared::new());
        let _ = shared.set_board(patch.board.as_ref().unwrap());
        shared.set_patch(PatchState::new(&patch));
        let playing = patch.tables.clone();
        WaveState {
            shared,
            dir,
            inner: Arc::new(Mutex::new(Inner {
                patch,
                playing,
                built: HashMap::new(),
                building: HashMap::new(),
                serial: 0,
            })),
            synced: AtomicBool::new(false),
        }
    }

    fn tables_dir(&self) -> PathBuf {
        self.dir.join("tables")
    }

    fn presets_dir(&self) -> PathBuf {
        self.dir.join("presets")
    }

    /// On the way through any wave route: tables the callback let go of
    /// dropped here, and the patch's tables asked for the first time.
    fn touch(&self) {
        self.shared.collect();
        if !self.synced.swap(true, Ordering::AcqRel) {
            if let Ok(mut g) = self.inner.lock() {
                self.sync(&mut g);
            }
        }
    }

    /// The patch as it is stored.
    pub fn patch(&self) -> Patch {
        self.inner.lock().map(|g| g.patch.clone()).unwrap_or_default()
    }

    pub(crate) fn save(&self, p: &Patch) -> Result<(), String> {
        std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        crate::persist::write_atomic(&self.dir.join("patch.json"), &patch_json(p).to_string()).map_err(|e| e.to_string())
    }

    /// Give each oscillator the table it should have: at once if it is built,
    /// otherwise when its build finishes.
    fn sync(&self, g: &mut Inner) {
        let current = self.shared.current_tables();
        for osc in 0..3 {
            let name = g.playing[osc].clone();
            match g.built.get(&name) {
                Some(t) => {
                    if !current[osc].as_ref().is_some_and(|c| Arc::ptr_eq(c, t)) {
                        self.shared.set_table(osc, Arc::clone(t));
                    }
                }
                None => self.build(g, &name, None),
            }
        }
        let playing = g.playing.clone();
        g.built.retain(|n, _| playing.contains(n));
    }

    /// Build `name` on a thread of its own, from `frames` or from wherever
    /// that name's frames live, and swap it into every oscillator playing it.
    fn build(&self, g: &mut Inner, name: &str, frames: Option<Vec<Vec<f32>>>) {
        if frames.is_none() && g.building.contains_key(name) {
            return;
        }
        g.serial += 1;
        let serial = g.serial;
        g.building.insert(name.to_string(), serial);
        let (inner, shared, dir, wanted) =
            (Arc::clone(&self.inner), Arc::clone(&self.shared), self.tables_dir(), name.to_string());
        let job = move || {
            let name = wanted;
            let frames = frames.or_else(|| frames_for(&dir, &name));
            let table = frames.map(|f| Arc::new(Wavetable::from_frames(&f)));
            let Ok(mut g) = inner.lock() else { return };
            if g.building.get(&name) != Some(&serial) {
                return;
            }
            g.building.remove(&name);
            // An unknown name leaves the oscillator with what it had.
            let Some(table) = table else { return };
            for osc in 0..3 {
                if g.playing[osc] == name {
                    shared.set_table(osc, Arc::clone(&table));
                }
            }
            if g.playing.contains(&name) {
                g.built.insert(name, table);
            }
        };
        if std::thread::Builder::new().name("wave-table".into()).spawn(job).is_err() {
            g.building.remove(name);
        }
    }

    /// Hand the stored patch to the engine and its tables to the oscillators.
    fn adopt(&self, g: &mut Inner) {
        let _ = self.shared.set_board(g.patch.board.as_ref().unwrap_or(&wave::Board::default()));
        self.shared.set_patch(PatchState::new(&g.patch));
        g.playing = g.patch.tables.clone();
        self.sync(g);
    }
}

// ────────────────────────────────────────────────────────────── the routes

pub fn route(app: &Arc<App>, req: &Request) -> Response {
    let w = &app.wave;
    crate::midi::ensure(app);
    w.touch();
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/api/wave/patch") => Response::json(patch_json(&w.patch()).to_string()),
        ("POST", "/api/wave/patch") => post_patch(w, req),
        ("POST", "/api/wave/param") => post_param(w, req),
        ("POST", "/api/wave/mods") => post_mods(w, req),
        ("POST", "/api/wave/note") => post_note(app, req),
        ("POST", "/api/wave/control") => post_control(app, req),
        ("GET", "/api/wave/state") => state(app),
        ("GET", "/api/wave/tables") => tables(w),
        ("GET", "/api/wave/table") => get_table(w, req),
        ("POST", "/api/wave/table") => post_table(w, req),
        ("POST", "/api/wave/table/import") => import(app, req),
        ("GET", "/api/wave/presets") => Response::json(Value::Arr(presets(w)).to_string()),
        ("POST", "/api/wave/presets") => post_preset(w, req),
        (_, p) if p.starts_with("/api/wave/board") || p == "/api/wave/fx" => crate::wave_board::route(app, req),
        _ => Response::error(404, "no such endpoint"),
    }
}

fn body(req: &Request) -> Result<Value, Response> {
    json::parse(&String::from_utf8_lossy(&req.body))
        .filter(|v| matches!(v, Value::Obj(_)))
        .ok_or_else(|| Response::error(400, "expected a JSON object"))
}

fn ok() -> Value {
    Value::obj().set("ok", true)
}

/// `POST /api/wave/patch`: replace the patch. Anything not given takes the
/// default, as a new patch would.
fn post_patch(w: &WaveState, req: &Request) -> Response {
    let v = match body(req) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let patch = match patch_from_json(&v, Patch::default()) {
        Ok(p) => p,
        Err(e) => return Response::error(400, &e),
    };
    let Ok(mut g) = w.inner.lock() else { return Response::error(500, "the synth is wedged") };
    g.patch = patch;
    w.adopt(&mut g);
    if let Err(e) = w.save(&g.patch) {
        return Response::error(500, &format!("could not save the patch: {e}"));
    }
    Response::json(patch_json(&g.patch).to_string())
}

/// `POST /api/wave/param {key, value, live?}`.
///
/// A number goes to the engine as a live knob move either way, which glides
/// and costs nothing. `live:true` stops there, as on `/api/rack/param`: heard,
/// not stored, not saved. A mode, a table or an LFO shape cannot be moved
/// live in the engine, so it is compiled into a whole patch and handed over;
/// live, that patch is the stored one with this change on top, and the
/// stored one is left alone.
fn post_param(w: &WaveState, req: &Request) -> Response {
    let v = match body(req) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let Some(key) = v.get("key").and_then(Value::as_str) else {
        return Response::error(400, "no key given");
    };
    let Some(value) = v.get("value") else {
        return Response::error(400, "no value given");
    };
    let live = matches!(v.get("live"), Some(Value::Bool(true)));
    let Ok(mut g) = w.inner.lock() else { return Response::error(500, "the synth is wedged") };
    let mut next = g.patch.clone();
    if let Err(e) = apply_param(&mut next, key, value) {
        return Response::error(400, &e);
    }
    let out = param_json(&next, key);
    if let Some(id) = param_id(key) {
        w.shared.set_live(id, next.values[id.index()]);
    } else {
        w.shared.set_patch(PatchState::new(&next));
        g.playing = next.tables.clone();
        w.sync(&mut g);
    }
    if !live {
        g.patch = next;
        if let Err(e) = w.save(&g.patch) {
            return Response::error(500, &format!("could not save the patch: {e}"));
        }
    }
    Response::json(ok().set("key", key).set("value", out).set("live", live).to_string())
}

/// `POST /api/wave/mods {mods:[…]}`: the whole matrix.
fn post_mods(w: &WaveState, req: &Request) -> Response {
    let v = match body(req) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let mods = match v.get("mods").map(parse_mods) {
        Some(Ok(m)) => m,
        Some(Err(e)) => return Response::error(400, &e),
        None => return Response::error(400, "no mods given"),
    };
    let Ok(mut g) = w.inner.lock() else { return Response::error(500, "the synth is wedged") };
    g.patch.mods = mods;
    w.shared.set_patch(PatchState::new(&g.patch));
    if let Err(e) = w.save(&g.patch) {
        return Response::error(500, &format!("could not save the patch: {e}"));
    }
    Response::json(ok().set("mods", Value::Arr(g.patch.mods.iter().map(mod_json).collect())).to_string())
}

fn num_of(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Num(n) if n.is_finite() => Some(*n),
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        _ => None,
    }
}

/// `POST /api/wave/note {note, vel, on}`. Opens the device if it is not yet.
fn post_note(app: &Arc<App>, req: &Request) -> Response {
    let v = match body(req) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let Some(note) = num_of(v.get("note")).filter(|n| (0.0..=127.0).contains(n)) else {
        return Response::error(400, "note must be 0 to 127");
    };
    let note = note.round() as u8;
    let vel = num_of(v.get("vel")).unwrap_or(0.8).clamp(0.0, 1.0) as f32;
    let on = num_of(v.get("on")).map_or(true, |x| x != 0.0) && vel > 0.0;
    if let Err(e) = crate::live::ensure(app) {
        return Response::error(503, &e);
    }
    let e = if on { WaveEvent::NoteOn { note, vel } } else { WaveEvent::NoteOff { note } };
    let queued = app.wave.shared.push(e);
    Response::json(ok().set("note", note as f64).set("on", on).set("queued", queued).to_string())
}

/// `POST /api/wave/control {bend}` or `{mw}` (also `{at}` for aftertouch, and
/// `{allOff:true}`). Opens the device if it is not yet.
fn post_control(app: &Arc<App>, req: &Request) -> Response {
    let v = match body(req) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let mut events = Vec::new();
    if let Some(b) = num_of(v.get("bend")) {
        events.push(WaveEvent::Bend(b.clamp(-1.0, 1.0) as f32));
    }
    if let Some(m) = num_of(v.get("mw")) {
        events.push(WaveEvent::ModWheel(m.clamp(0.0, 1.0) as f32));
    }
    if let Some(a) = num_of(v.get("at")) {
        events.push(WaveEvent::Aftertouch(a.clamp(0.0, 1.0) as f32));
    }
    if matches!(v.get("allOff"), Some(Value::Bool(true))) {
        events.push(WaveEvent::AllNotesOff);
    }
    if events.is_empty() {
        return Response::error(400, "expected bend, mw, at or allOff");
    }
    if let Err(e) = crate::live::ensure(app) {
        return Response::error(503, &e);
    }
    for e in events {
        app.wave.shared.push(e);
    }
    Response::json(ok().to_string())
}

fn stage_letter(s: Stage) -> &'static str {
    match s {
        Stage::Attack => "a",
        Stage::Decay => "d",
        Stage::Sustain => "s",
        Stage::Release | Stage::Idle => "r",
    }
}

/// `GET /api/wave/state`: the telemetry, about thirty times a second.
///
/// `lfo` is each LFO's **phase**, 0..1, which is what the page draws its dots
/// at; `lfoPhase` is the same, by name, and `lfoValue` the output, −1..1.
/// `wave` is the last 256 samples out. With no device there is nothing
/// sounding, and it says so: no voices, silence.
fn state(app: &Arc<App>) -> Response {
    let device = crate::live::peek(app, |_| ()).is_some();
    let (t, recent) = app.wave.shared.telemetry();
    let n = |v: f32| num(if device { v } else { 0.0 });
    let voices = if device {
        t.voices()
            .iter()
            .map(|v| {
                Value::obj()
                    .set("note", v.note as f64)
                    .set("vel", num(v.vel))
                    .set("env", num(v.env))
                    .set("stage", stage_letter(v.stage))
            })
            .collect()
    } else {
        Vec::new()
    };
    let mut mods = BTreeMap::new();
    if device {
        for (id, v) in t.mods() {
            mods.insert(id.key().to_string(), num(*v));
        }
    }
    let arr = |xs: &[f32]| Value::Arr(xs.iter().map(|x| n(*x)).collect());
    Response::json(
        Value::obj()
            .set("voices", Value::Arr(voices))
            .set("pos", arr(&t.pos))
            .set("lfo", arr(&t.lfo_phase))
            .set("lfoPhase", arr(&t.lfo_phase))
            .set("lfoValue", arr(&t.lfo))
            .set("mod", Value::Obj(mods))
            .set("peak", arr(&t.peak))
            .set("wave", arr(&recent))
            .set("device", device)
            .set("board", crate::wave_board::peaks_json(&app.wave, &t, device))
            .to_string(),
    )
}

/// `GET /api/wave/tables`: `[{name, frames}]`, the built-ins first.
fn tables(w: &WaveState) -> Response {
    let mut out: Vec<Value> = BUILTIN_NAMES
        .iter()
        .map(|n| Value::obj().set("name", *n).set("frames", wave::table::BUILTIN_FRAMES as f64).set("builtin", true))
        .collect();
    for (name, frames) in user_tables(&w.tables_dir()) {
        out.push(Value::obj().set("name", name).set("frames", frames as f64).set("builtin", false));
    }
    Response::json(Value::Arr(out).to_string())
}

/// `GET /api/wave/table?name=`: each frame at 256 points.
fn get_table(w: &WaveState, req: &Request) -> Response {
    let Some(name) = req.param("name").filter(|n| !n.is_empty()) else {
        return Response::error(400, "no name given");
    };
    match frames_for(&w.tables_dir(), name) {
        Some(frames) => Response::json(table_json(name, &frames).to_string()),
        None => Response::error(404, &format!("no table called {name:?}")),
    }
}

fn table_json(name: &str, frames: &[Vec<f32>]) -> Value {
    let pv = preview(frames, PREVIEW_POINTS);
    Value::obj()
        .set("name", name)
        .set("frames", Value::Arr(pv.iter().map(|f| Value::Arr(f.iter().map(|x| num(*x)).collect())).collect()))
}

/// `POST /api/wave/table {name, frames}`: create or replace a table.
fn post_table(w: &WaveState, req: &Request) -> Response {
    let v = match body(req) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let Some(name) = v.get("name").and_then(Value::as_str) else {
        return Response::error(400, "no name given");
    };
    let frames = match parse_frames(v.get("frames")) {
        Ok(f) => f,
        Err(e) => return Response::error(400, &e),
    };
    store_table(w, name, frames)
}

/// Save a table under a name it may have, build it, and answer with what was
/// stored. A built-in is never replaced: an edit of one is kept as
/// "<name> (edited)", which the page then gives the oscillator.
fn store_table(w: &WaveState, name: &str, frames: Vec<Vec<f32>>) -> Response {
    let mut stored = crate::capture::safe(name).trim_start_matches('.').to_string();
    if stored.is_empty() {
        return Response::error(400, "the name is empty");
    }
    if BUILTIN_NAMES.contains(&stored.as_str()) {
        stored = format!("{stored} (edited)");
    }
    let dir = w.tables_dir();
    if let Err(e) = std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(dir.join(format!("{stored}.wav")), table_wav(&frames))) {
        return Response::error(500, &format!("could not save the table: {e}"));
    }
    let reply = table_json(&stored, &frames);
    if let Ok(mut g) = w.inner.lock() {
        g.built.remove(&stored);
        w.build(&mut g, &stored, Some(frames));
    }
    Response::json(reply.to_string())
}

/// `POST /api/wave/table/import {sound, name, mode, frames}`: a library sound
/// sliced into a table.
///
/// `mode` may be `count`, `note`, `pitch` or `spectral`, and `grain` may be
/// sent; for now every mode slices by count and `grain` is not used. Count
/// takes `frames` windows of one cycle (2048 samples), spread evenly from the
/// start of the sound to its end. A sound too short for that is cut into
/// `frames` equal pieces instead, each at least 64 samples, so fewer frames if
/// it has to be.
fn import(app: &Arc<App>, req: &Request) -> Response {
    let v = match body(req) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let Some(sound) = v.get("sound").and_then(Value::as_str).filter(|s| !s.is_empty()) else {
        return Response::error(400, "no sound given");
    };
    let mode = v.get("mode").and_then(Value::as_str).unwrap_or("count");
    if !["count", "note", "pitch", "spectral"].contains(&mode) {
        return Response::error(400, &format!("unknown import mode {mode:?}"));
    }
    let count = num_of(v.get("frames")).unwrap_or(64.0).round().clamp(1.0, MAX_FRAMES as f64) as usize;
    let Some(lib) = app.library_path() else {
        return Response::error(400, "no library chosen");
    };
    let Some(path) = crate::safety::resolve_within(&lib, sound) else {
        return Response::error(404, "no such file in the library");
    };
    let mono = match decode_mono(&path) {
        Ok(m) => m,
        Err(e) => return Response::error(400, &e),
    };
    let frames = match slice(&mono, count) {
        Some(f) => f,
        None => return Response::error(400, "the sound is too short to slice"),
    };
    let name = v
        .get("name")
        .and_then(Value::as_str)
        .filter(|n| !n.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Import".into()));
    store_table(&app.wave, &name, frames)
}

/// A sound, decoded whole, its channels averaged. The same decode as Prism's
/// load: the file as it is, no edits.
fn decode_mono(path: &Path) -> Result<Vec<f32>, String> {
    let mut reader = audio_core::open(path).map_err(|e| format!("could not open: {e}"))?;
    let info = reader.info();
    let channels = info.channels.max(1) as usize;
    let list = edit::EditList::identity(info.frames(), info.channels, info.sample_rate);
    let samples = edit::render::render(&list, &mut reader, 0, list.base_frames())
        .map_err(|e| format!("could not read the sound: {e}"))?;
    Ok(samples.chunks(channels).map(|f| f.iter().sum::<f32>() / channels as f32).collect())
}

/// `count` frames out of a sound. See [`import`].
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

/// `GET /api/wave/presets`: the listed presets, by name.
fn presets(w: &WaveState) -> Vec<Value> {
    let mut out: Vec<(String, Value)> = Vec::new();
    let Ok(rd) = std::fs::read_dir(w.presets_dir()) else { return Vec::new() };
    for e in rd.flatten() {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }
        let Some(v) = std::fs::read_to_string(&p).ok().and_then(|s| json::parse(&s)) else { continue };
        if matches!(v.get("hidden"), Some(Value::Bool(true))) {
            continue;
        }
        let name = v.get("name").and_then(Value::as_str).unwrap_or("").to_string();
        let shown = Value::obj()
            .set("name", name.clone())
            .set("tags", v.get("tags").cloned().unwrap_or(Value::Arr(Vec::new())))
            .set("patch", v.get("patch").cloned().unwrap_or_else(Value::obj));
        out.push((name.to_lowercase(), shown));
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out.into_iter().map(|(_, v)| v).collect()
}

/// `POST /api/wave/presets`.
///
/// `{name, tags, patch}` saves one (the stored patch when `patch` is left
/// out), listing it again if it had been removed. `{name, remove:true}` (or
/// `hidden:true`) unlists it: the file stays, marked hidden.
fn post_preset(w: &WaveState, req: &Request) -> Response {
    let v = match body(req) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let Some(name) = v.get("name").and_then(Value::as_str).map(str::trim).filter(|n| !n.is_empty()) else {
        return Response::error(400, "no name given");
    };
    let file = crate::capture::safe(name).trim_start_matches('.').to_string();
    if file.is_empty() {
        return Response::error(400, "the name is empty");
    }
    let dir = w.presets_dir();
    let path = dir.join(format!("{file}.json"));
    let unlist = [v.get("remove"), v.get("hidden")].iter().any(|x| matches!(x, Some(Value::Bool(true))));
    if unlist {
        let Some(mut held) = std::fs::read_to_string(&path).ok().and_then(|s| json::parse(&s)) else {
            return Response::error(404, &format!("no preset called {name:?}"));
        };
        held = held.set("hidden", true);
        if let Err(e) = crate::persist::write_atomic(&path, &held.to_string()) {
            return Response::error(500, &format!("could not unlist the preset: {e}"));
        }
        return Response::json(ok().set("name", name).set("hidden", true).to_string());
    }
    let patch = match v.get("patch") {
        Some(p) => {
            // Checked, then kept as it was sent: a preset may hold only the
            // keys it cares about, and loading it lays them over the patch.
            if let Err(e) = patch_from_json(p, Patch::default()) {
                return Response::error(400, &e);
            }
            p.clone()
        }
        None => patch_json(&w.patch()),
    };
    let tags = tags_json(&parse_tags(v.get("tags")));
    let held = Value::obj().set("name", name).set("tags", tags).set("patch", patch).set("hidden", false);
    if let Err(e) = std::fs::create_dir_all(&dir).and_then(|_| crate::persist::write_atomic(&path, &held.to_string())) {
        return Response::error(500, &format!("could not save the preset: {e}"));
    }
    Response::json(ok().set("name", name).set("hidden", false).to_string())
}

// ───────────────────────────────────────────────────────── patch ⇄ JSON

/// A float as the shortest decimal that reads back as the same `f32`, so a
/// stored 0.34 is written 0.34 and not 0.3400000035762787.
fn num(v: f32) -> Value {
    Value::Num(if v.is_finite() { format!("{v}").parse::<f64>().unwrap_or(0.0) } else { 0.0 })
}

pub(crate) fn mod_json(m: &Mod) -> Value {
    Value::obj()
        .set("src", m.src.as_str())
        .set("dst", m.dst.as_str())
        .set("amt", num(m.amt))
        .set("curve", m.curve.as_str())
        .set("via", m.via.clone().map(Value::Str).unwrap_or(Value::Null))
        .set("on", m.on)
}

fn tags_json(tags: &[String]) -> Value {
    Value::Arr(tags.iter().map(|t| Value::Str(t.clone())).collect())
}

/// One key's value as the patch holds it.
fn param_json(p: &Patch, key: &str) -> Value {
    if let Some(x) = p.get_num(key) {
        return num(x);
    }
    if let Some(s) = p.get_str(key) {
        return Value::Str(s.to_string());
    }
    match p.get_points(key) {
        Some(pts) => Value::Arr(pts.iter().map(|(x, y)| Value::Arr(vec![num(*x), num(*y)])).collect()),
        None => Value::Null,
    }
}

/// The contract's patch shape: `{params, mods, macroNames, name, tags}`.
pub fn patch_json(p: &Patch) -> Value {
    let mut params = BTreeMap::new();
    for (key, _) in p.entries() {
        params.insert(key.to_string(), param_json(p, key));
    }
    Value::obj()
        .set("params", Value::Obj(params))
        .set("mods", Value::Arr(p.mods.iter().map(mod_json).collect()))
        .set("macroNames", Value::Arr(p.macro_names.iter().map(|s| Value::Str(s.clone())).collect()))
        .set("name", p.name.as_str())
        .set("tags", tags_json(&p.tags))
        .set("board", p.board.as_ref().map_or(Value::Null, crate::wave_board::board_json))
}

/// Set one key from JSON. An unknown key, or a value the key does not take,
/// is an error naming it.
pub fn apply_param(p: &mut Patch, key: &str, v: &Value) -> Result<(), String> {
    if param_id(key).is_some() {
        let x = num_of(Some(v)).ok_or_else(|| format!("{key} takes a number"))?;
        return if p.set_num(key, x as f32) { Ok(()) } else { Err(format!("{key} takes a number")) };
    }
    if STR_KEYS.contains(&key) {
        let s = v.as_str().filter(|s| !s.is_empty()).ok_or_else(|| format!("{key} takes a name"))?;
        return if p.set_str(key, s) { Ok(()) } else { Err(format!("{key} does not take {s:?}")) };
    }
    if POINT_KEYS.contains(&key) {
        let pts = v
            .arr()
            .ok_or_else(|| format!("{key} takes [[x, y], …]"))?
            .iter()
            .map(|pt| match pt.arr() {
                Some([Value::Num(x), Value::Num(y)]) => Some((*x as f32, *y as f32)),
                _ => None,
            })
            .collect::<Option<Vec<_>>>()
            .ok_or_else(|| format!("{key} takes [[x, y], …]"))?;
        return if p.set_points(key, &pts) {
            Ok(())
        } else {
            Err(format!("{key} needs 2 to {} points", wave::patch::MAX_LFO_POINTS))
        };
    }
    Err(format!("unknown key {key:?}"))
}

/// The matrix rows, every field checked. The limit counts rows switched off.
pub fn parse_mods(v: &Value) -> Result<Vec<Mod>, String> {
    let rows = v.arr().ok_or("mods must be a list")?;
    if rows.len() > MAX_MODS {
        return Err(format!("at most {MAX_MODS} mod rows"));
    }
    rows.iter()
        .enumerate()
        .map(|(i, r)| {
            let s = |k: &str| r.get(k).and_then(Value::as_str);
            let src = s("src").filter(|x| Source::parse(x).is_some()).ok_or(format!("mod {i}: unknown src"))?;
            let dst = s("dst").filter(|x| param_id(x).is_some() || wave::board::parse_dst(x).is_some()).ok_or(format!("mod {i}: unknown dst"))?;
            let amt = num_of(r.get("amt")).ok_or(format!("mod {i}: amt must be a number"))?.clamp(-1.0, 1.0) as f32;
            let curve = s("curve").unwrap_or("lin");
            if Curve::parse(curve).is_none() {
                return Err(format!("mod {i}: unknown curve {curve:?}"));
            }
            let via = match r.get("via") {
                None | Some(Value::Null) => None,
                Some(Value::Str(x)) if Source::parse(x).is_some() => Some(x.clone()),
                Some(_) => return Err(format!("mod {i}: unknown via")),
            };
            // A row saved before rows had a switch is on.
            let on = match r.get("on") {
                None | Some(Value::Null) => true,
                Some(Value::Bool(b)) => *b,
                Some(_) => return Err(format!("mod {i}: on must be true or false")),
            };
            Ok(Mod { src: src.into(), dst: dst.into(), amt, curve: curve.into(), via, on })
        })
        .collect()
}

/// Tags as a list, or as the page shows them: "Pad · Warm".
fn parse_tags(v: Option<&Value>) -> Vec<String> {
    match v {
        Some(Value::Arr(a)) => a.iter().filter_map(Value::as_str).map(str::trim).filter(|t| !t.is_empty()).map(String::from).collect(),
        Some(Value::Str(s)) => s.split(['·', ',']).map(str::trim).filter(|t| !t.is_empty()).map(String::from).collect(),
        _ => Vec::new(),
    }
}

/// A patch from the contract's shape, laid over `base`.
pub fn patch_from_json(v: &Value, mut base: Patch) -> Result<Patch, String> {
    if !matches!(v, Value::Obj(_)) {
        return Err("a patch is a JSON object".into());
    }
    if let Some(params) = v.get("params") {
        let params = params.as_obj().ok_or("params must be an object")?;
        for (k, x) in params {
            apply_param(&mut base, k, x)?;
        }
    }
    if let Some(m) = v.get("mods") {
        base.mods = parse_mods(m)?;
    }
    if let Some(names) = v.get("macroNames") {
        let names = names.arr().ok_or("macroNames must be a list")?;
        for (slot, n) in base.macro_names.iter_mut().zip(names) {
            if let Some(s) = n.as_str() {
                *slot = s.to_string();
            }
        }
    }
    if let Some(n) = v.get("name").and_then(Value::as_str) {
        base.name = n.to_string();
    }
    if v.get("tags").is_some() {
        base.tags = parse_tags(v.get("tags"));
    }
    // An old patch's board is the one its chain makes.
    base.board = v.get("board").filter(|b| !matches!(b, Value::Null)).map(crate::wave_board::board_from_json).transpose().map_err(|e| e.message)?;
    crate::wave_board::ensure(&mut base);
    Ok(base)
}

// ─────────────────────────────────────────────────────────────── tables

/// Frames from the page: 1 to 256 of them, all one length, 64 to 4096 long.
fn parse_frames(v: Option<&Value>) -> Result<Vec<Vec<f32>>, String> {
    let rows = v.and_then(Value::arr).ok_or("frames must be a list of lists")?;
    if rows.is_empty() || rows.len() > MAX_FRAMES {
        return Err(format!("a table has 1 to {MAX_FRAMES} frames"));
    }
    let frames = rows
        .iter()
        .map(|r| {
            r.arr()?
                .iter()
                .map(|x| match x {
                    Value::Num(n) if n.is_finite() => Some(*n as f32),
                    _ => None,
                })
                .collect::<Option<Vec<f32>>>()
        })
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

/// Each frame as the table will hold it — its DC taken out and its peak at
/// one, as `Wavetable::from_frames` does — at `points` points, read with
/// straight lines and wrapping round. Drawn from the frames directly, so a
/// preview never waits for a table to be built.
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

/// A table's frames by name: a built-in, or one saved in `dir`.
fn frames_for(dir: &Path, name: &str) -> Option<Vec<Vec<f32>>> {
    if let Some(f) = wave::builtin_frames(name) {
        return Some(f);
    }
    let file = crate::capture::safe(name);
    if file.is_empty() || file.starts_with('.') {
        return None;
    }
    read_table_wav(&std::fs::read(dir.join(format!("{file}.wav"))).ok()?)
}

/// The tables saved in `dir`, by name, with their frame counts.
fn user_tables(dir: &Path) -> Vec<(String, usize)> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(dir) else { return out };
    for e in rd.flatten() {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()).map(str::to_lowercase).as_deref() != Some("wav") {
            continue;
        }
        let Some(name) = p.file_stem().map(|s| s.to_string_lossy().to_string()) else { continue };
        if BUILTIN_NAMES.contains(&name.as_str()) {
            continue;
        }
        if let Some(frames) = std::fs::read(&p).ok().and_then(|b| read_table_wav(&b)) {
            out.push((name, frames.len()));
        }
    }
    out.sort_by_key(|(n, _)| n.to_lowercase());
    out
}

/// A table as a mono 32-bit float WAV, frame after frame, with a `clm ` chunk
/// saying how long a frame is — Serum's convention, which other wavetable
/// synths read too.
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
    out.extend_from_slice(&3u16.to_le_bytes()); // IEEE float
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
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

/// Frames back out of a table WAV: 32-bit float or 16-bit PCM, the first
/// channel, cut at the `clm ` chunk's frame length (2048 when there is none).
pub fn read_table_wav(b: &[u8]) -> Option<Vec<Vec<f32>>> {
    if b.len() < 12 || &b[0..4] != b"RIFF" || &b[8..12] != b"WAVE" {
        return None;
    }
    let (mut format, mut channels, mut bits, mut len) = (0u16, 1usize, 0u16, CYCLE);
    let mut data: Option<&[u8]> = None;
    let mut at = 12;
    while at + 8 <= b.len() {
        let id = &b[at..at + 4];
        let size = u32::from_le_bytes(b[at + 4..at + 8].try_into().ok()?) as usize;
        let body = &b[at + 8..(at + 8 + size).min(b.len())];
        match id {
            b"fmt " if body.len() >= 16 => {
                format = u16::from_le_bytes([body[0], body[1]]);
                channels = u16::from_le_bytes([body[2], body[3]]).max(1) as usize;
                bits = u16::from_le_bytes([body[14], body[15]]);
            }
            b"clm " => {
                let text = String::from_utf8_lossy(body);
                if let Some(n) = text.strip_prefix("<!>").and_then(|t| t.split_whitespace().next()).and_then(|t| t.parse().ok()) {
                    len = n;
                }
            }
            b"data" => data = Some(body),
            _ => {}
        }
        at += 8 + size + (size & 1);
    }
    let data = data?;
    let samples: Vec<f32> = match (format, bits) {
        (3, 32) => data.chunks_exact(4 * channels).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect(),
        (1, 16) => data.chunks_exact(2 * channels).map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0).collect(),
        _ => return None,
    };
    if !(4..=MAX_FRAME_LEN).contains(&len) || samples.len() < len {
        return None;
    }
    Some(samples.chunks_exact(len).take(MAX_FRAMES).map(<[f32]>::to_vec).collect())
}

#[cfg(test)]
mod tests;
