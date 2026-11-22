//! The app's C interface: the canvas (`engine-app`'s `Session`) and its
//! audio half, for the JUCE app.
//!
//! As with `ne_*`, one `NaApp` is two halves in one box: `na_render` belongs
//! to the audio thread, every other call to the app. Two app calls must never
//! run at once (the app holds a lock of its own around them; the audio
//! thread never takes it).
//!
//! Text comes back the way `snprintf` gives it: the call writes as much as
//! fits in `cap` bytes, always ending in a 0 when `cap` is not 0, and returns
//! the whole length (not counting the 0). A return of `cap` or more means
//! call again with more room.
//!
//! Codes below zero are the engine's (lib.rs), and:
//! -16 no such control   -17 a file that could not be read (`na_error` says why)
//! The others: -2 no such module, -3 no such socket, -4 kinds differ,
//! -6 that input already has a cable, -10 no such kind of module.
//!
//! Every note and knob is heard from the next block.

use crate::{code, render_caught, NO_ENGINE};
use engine_app::{AppError, Session};
use engine_core::AudioEngine;
use serde_json::Value;
use std::ffi::{c_char, CStr};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::ptr;
use std::slice;

pub struct NaApp {
    session: Session,
    audio: AudioEngine,
    /// Why the last call that failed did.
    error: String,
    /// `na_wave_api`'s last reply, whole, for `na_wave_reply`.
    reply: String,
}

fn app_code(e: &AppError) -> i32 {
    match e {
        AppError::Engine(e) => code(e.clone()),
        AppError::NoSuchModule(_) => -2,
        AppError::NoSuchSocket => -3,
        AppError::KindsDiffer => -4,
        AppError::Taken => -6,
        AppError::NoSuchKind(_) => -10,
        AppError::NoSuchControl(_) => -16,
        AppError::BadFile(_) => -17,
    }
}

/// Run an app call, a panic caught and turned into -12.
fn guarded<T>(fallback: T, f: impl FnOnce() -> T) -> T {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(v) => v,
        Err(payload) => {
            std::mem::forget(payload);
            fallback
        }
    }
}

/// The app's half. Never the whole box: the audio thread may be in the other.
unsafe fn session<'a>(a: *mut NaApp) -> Option<&'a mut Session> {
    if a.is_null() {
        None
    } else {
        Some(&mut *ptr::addr_of_mut!((*a).session))
    }
}

unsafe fn fail(a: *mut NaApp, e: AppError) -> i32 {
    if !a.is_null() {
        *ptr::addr_of_mut!((*a).error) = e.to_string();
    }
    app_code(&e)
}

unsafe fn status(a: *mut NaApp, r: Result<(), AppError>) -> i32 {
    match r {
        Ok(()) => 0,
        Err(e) => fail(a, e),
    }
}

unsafe fn text<'a>(s: *const c_char) -> Option<&'a str> {
    if s.is_null() {
        None
    } else {
        CStr::from_ptr(s).to_str().ok()
    }
}

/// Write `s` into `buf` as `snprintf` would; the whole length back.
unsafe fn give_text(s: &str, buf: *mut c_char, cap: u32) -> u32 {
    let bytes = s.as_bytes();
    if !buf.is_null() && cap > 0 {
        let n = bytes.len().min(cap as usize - 1);
        ptr::copy_nonoverlapping(bytes.as_ptr(), buf as *mut u8, n);
        *buf.add(n) = 0;
    }
    bytes.len() as u32
}

/// A new, empty canvas at the sound card's `rate`, for blocks of up to
/// `max_block` frames (a longer block is made in pieces). Null if it failed.
#[no_mangle]
pub extern "C" fn na_new(rate: f32, max_block: u32) -> *mut NaApp {
    guarded(ptr::null_mut(), || {
        let (session, audio) = Session::new(rate, max_block.max(1) as usize);
        Box::into_raw(Box::new(NaApp { session, audio, error: String::new(), reply: String::new() }))
    })
}

/// # Safety
/// `a` came from `na_new`, and no other call is using it or will again.
#[no_mangle]
pub unsafe extern "C" fn na_free(a: *mut NaApp) {
    guarded((), || {
        if !a.is_null() {
            drop(Box::from_raw(a));
        }
    })
}

/// The audio callback: the next `n` samples of each side. 0, or -12 when a
/// panic was caught (the block is silence).
///
/// # Safety
/// `a` came from `na_new`; `l` and `r` each point at `n` samples.
#[no_mangle]
pub unsafe extern "C" fn na_render(a: *mut NaApp, l: *mut f32, r: *mut f32, n: u32) -> i32 {
    if l.is_null() || r.is_null() {
        return NO_ENGINE;
    }
    let (l, r) = (slice::from_raw_parts_mut(l, n as usize), slice::from_raw_parts_mut(r, n as usize));
    if a.is_null() {
        l.fill(0.0);
        r.fill(0.0);
        return NO_ENGINE;
    }
    let audio = &mut *ptr::addr_of_mut!((*a).audio);
    render_caught(audio, l, r, |audio, l, r| {
        audio.render(l, r);
        audio.finish(l, r);
    })
}

/// The kinds of module, as JSON: `[{id, title, width, height, ins, outs, keyboard}]`.
///
/// # Safety
/// `buf` has room for `cap` bytes, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_kinds(buf: *mut c_char, cap: u32) -> u32 {
    guarded(0, || give_text(&engine_app::kinds_json().to_string(), buf, cap))
}

/// A kind's controls, as JSON: `[{type: knob|switch|choice, key, ...}]`.
///
/// # Safety
/// `kind` is a C string; `buf` has room for `cap` bytes, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_controls(kind: *const c_char, buf: *mut c_char, cap: u32) -> u32 {
    guarded(0, || give_text(&engine_app::controls_json(text(kind).unwrap_or("")).to_string(), buf, cap))
}

/// Why the last call that failed did.
///
/// # Safety
/// `a` came from `na_new`; `buf` has room for `cap` bytes, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_error(a: *mut NaApp, buf: *mut c_char, cap: u32) -> u32 {
    guarded(0, || if a.is_null() { 0 } else { give_text(&*ptr::addr_of!((*a).error), buf, cap) })
}

/// Put a module of `kind` at (`x`, `y`). Its number (1 and up), or a code.
///
/// # Safety
/// `a` came from `na_new`; `kind` is a C string.
#[no_mangle]
pub unsafe extern "C" fn na_add(a: *mut NaApp, kind: *const c_char, x: f32, y: f32) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        match s.add(text(kind).unwrap_or(""), x, y) {
            Ok(id) => id as i32,
            Err(e) => fail(a, e),
        }
    })
}

/// # Safety
/// `a` came from `na_new`.
#[no_mangle]
pub unsafe extern "C" fn na_remove(a: *mut NaApp, id: u32) -> i32 {
    guarded(-12, || match session(a) {
        Some(s) => status(a, s.remove(id)),
        None => NO_ENGINE,
    })
}

/// # Safety
/// `a` came from `na_new`.
#[no_mangle]
pub unsafe extern "C" fn na_place(a: *mut NaApp, id: u32, x: f32, y: f32) -> i32 {
    guarded(-12, || match session(a) {
        Some(s) => status(a, s.place(id, x, y)),
        None => NO_ENGINE,
    })
}

/// Cable output socket `from_socket` of `from` to input `to_socket` of `to`.
///
/// # Safety
/// `a` came from `na_new`.
#[no_mangle]
pub unsafe extern "C" fn na_connect(a: *mut NaApp, from: u32, from_socket: u32, to: u32, to_socket: u32) -> i32 {
    guarded(-12, || match session(a) {
        Some(s) => status(a, s.connect((from, from_socket), (to, to_socket))),
        None => NO_ENGINE,
    })
}

/// # Safety
/// `a` came from `na_new`.
#[no_mangle]
pub unsafe extern "C" fn na_disconnect(a: *mut NaApp, from: u32, from_socket: u32, to: u32, to_socket: u32) -> i32 {
    guarded(-12, || match session(a) {
        Some(s) => status(a, s.disconnect((from, from_socket), (to, to_socket))),
        None => NO_ENGINE,
    })
}

/// Control `index` of module `id`: a knob or a switch to `value`, a choice
/// to option number `value`.
///
/// # Safety
/// `a` came from `na_new`.
#[no_mangle]
pub unsafe extern "C" fn na_set(a: *mut NaApp, id: u32, index: u32, value: f32) -> i32 {
    guarded(-12, || match session(a) {
        Some(s) => status(a, s.set(id, index, value)),
        None => NO_ENGINE,
    })
}

/// A note from a module's own keyboard: `on` 1 or 0, `velocity` 0 to 1.
///
/// # Safety
/// `a` came from `na_new`.
#[no_mangle]
pub unsafe extern "C" fn na_note(a: *mut NaApp, id: u32, on: u32, note: u32, velocity: f32) -> i32 {
    guarded(-12, || match session(a) {
        Some(s) => status(a, s.note(id, on != 0, note.min(127) as u8, velocity).map(|_| ())),
        None => NO_ENGINE,
    })
}

/// One MIDI message (`n` bytes) to MIDI in module `id`.
///
/// # Safety
/// `a` came from `na_new`; `bytes` points at `n` bytes.
#[no_mangle]
pub unsafe extern "C" fn na_midi(a: *mut NaApp, id: u32, bytes: *const u8, n: u32) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        if bytes.is_null() {
            return 0;
        }
        status(a, s.midi(id, slice::from_raw_parts(bytes, n as usize)))
    })
}

/// Now and then: free what the audio thread is done with, and hand over
/// tables that have finished building.
///
/// # Safety
/// `a` came from `na_new`.
#[no_mangle]
pub unsafe extern "C" fn na_collect(a: *mut NaApp) {
    guarded((), || {
        if let Some(s) = session(a) {
            s.collect();
        }
    })
}

/// Wait until every table asked for is built and handed over (tests and
/// offline renders only: the app never waits).
///
/// # Safety
/// `a` came from `na_new`.
#[no_mangle]
pub unsafe extern "C" fn na_settle(a: *mut NaApp) {
    guarded((), || {
        if let Some(s) = session(a) {
            s.settle();
        }
    })
}

/// The canvas as a patch file (JSON).
///
/// # Safety
/// `a` came from `na_new`; `buf` has room for `cap` bytes, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_save(a: *mut NaApp, buf: *mut c_char, cap: u32) -> u32 {
    guarded(0, || match session(a) {
        Some(s) => give_text(&serde_json::to_string_pretty(&s.save()).unwrap_or_default(), buf, cap),
        None => 0,
    })
}

/// The canvas as the app draws it: as a patch file, with each module's
/// control values.
///
/// # Safety
/// `a` came from `na_new`; `buf` has room for `cap` bytes, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_describe(a: *mut NaApp, buf: *mut c_char, cap: u32) -> u32 {
    guarded(0, || match session(a) {
        Some(s) => give_text(&s.describe().to_string(), buf, cap),
        None => 0,
    })
}

fn parse(json: Option<&str>) -> Result<Value, AppError> {
    serde_json::from_str(json.unwrap_or("")).map_err(|e| AppError::BadFile(format!("not JSON: {e}")))
}

/// Empty the canvas and load a patch file in its place. A file that can't
/// be read leaves the canvas as it was (-17; `na_error` says why).
///
/// # Safety
/// `a` came from `na_new`; `json` is a C string.
#[no_mangle]
pub unsafe extern "C" fn na_load(a: *mut NaApp, json: *const c_char) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        match parse(text(json)) {
            Ok(v) => status(a, s.load(&v)),
            Err(e) => fail(a, e),
        }
    })
}

/// Keep the app's view of the canvas (any JSON), saved with the patch.
///
/// # Safety
/// `a` came from `na_new`; `json` is a C string.
#[no_mangle]
pub unsafe extern "C" fn na_set_view(a: *mut NaApp, json: *const c_char) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        match parse(text(json)) {
            Ok(v) => {
                s.set_view(v);
                0
            }
            Err(e) => fail(a, e),
        }
    })
}

/// Wave module `id`'s patch as MGL saves one (a preset).
///
/// # Safety
/// `a` came from `na_new`; `buf` has room for `cap` bytes, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_wave_patch(a: *mut NaApp, id: u32, buf: *mut c_char, cap: u32) -> u32 {
    guarded(0, || match session(a).map(|s| s.wave_patch(id).map(engine_app::wave_patch::patch_json)) {
        Some(Ok(v)) => give_text(&serde_json::to_string_pretty(&v).unwrap_or_default(), buf, cap),
        _ => 0,
    })
}

/// Give Wave module `id` a patch: MGL's patch or preset file, or one saved here.
///
/// # Safety
/// `a` came from `na_new`; `json` is a C string.
#[no_mangle]
pub unsafe extern "C" fn na_load_wave_patch(a: *mut NaApp, id: u32, json: *const c_char) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        match parse(text(json)) {
            Ok(v) => status(a, s.load_wave_patch(id, &v)),
            Err(e) => fail(a, e),
        }
    })
}

/// Set one of Wave module `id`'s keys by name; `json` is its value (a
/// number, a "name", or [[x, y], ...] for an LFO's points).
///
/// # Safety
/// `a` came from `na_new`; `key` and `json` are C strings.
#[no_mangle]
pub unsafe extern "C" fn na_wave_set(a: *mut NaApp, id: u32, key: *const c_char, json: *const c_char) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        match parse(text(json)) {
            Ok(v) => status(a, s.wave_set(id, text(key).unwrap_or(""), &v)),
            Err(e) => fail(a, e),
        }
    })
}

/// Wave module `id`'s wheels: `which` 0 the pitch wheel (-1 to 1), 1 the mod
/// wheel, 2 aftertouch (0 to 1).
///
/// # Safety
/// `a` came from `na_new`.
#[no_mangle]
pub unsafe extern "C" fn na_wave_wheel(a: *mut NaApp, id: u32, which: u32, value: f32) -> i32 {
    guarded(-12, || match session(a) {
        Some(s) => status(a, s.wave_wheel(id, which, value)),
        None => NO_ENGINE,
    })
}

/// A Wave table's frames at 256 points each, `max` frames at most, into
/// `out` (room for `max * 256` floats). Returns how many frames it has (0 for
/// a name found nowhere), which may be more than `max`.
///
/// # Safety
/// `name` is a C string; `out` has room for `max * 256` floats, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_table_frames(name: *const c_char, out: *mut f32, max: u32) -> u32 {
    guarded(0, || {
        let Some(frames) = engine_app::frames_256(text(name).unwrap_or("")) else { return 0 };
        if !out.is_null() {
            for (i, f) in frames.iter().take(max as usize).enumerate() {
                ptr::copy_nonoverlapping(f.as_ptr(), out.add(i * 256), 256);
            }
        }
        frames.len() as u32
    })
}

/// The folders saved Wave tables are read from, one path a line, first
/// first. Read only.
///
/// # Safety
/// `a` came from `na_new`; `paths` is a C string.
#[no_mangle]
pub unsafe extern "C" fn na_table_dirs(a: *mut NaApp, paths: *const c_char) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let dirs = text(paths).unwrap_or("").lines().filter(|l| !l.trim().is_empty()).map(std::path::PathBuf::from).collect();
        s.table_dirs(dirs);
        0
    })
}

/// How many blocks had something that was not a number silenced. Stays 0.
///
/// # Safety
/// `a` came from `na_new`.
#[no_mangle]
pub unsafe extern "C" fn na_bad_blocks(a: *mut NaApp) -> u64 {
    guarded(0, || session(a).map_or(0, |s| s.controller().bad_blocks()))
}

/// Set one of Atmosphere module `id`'s keys by the page's name for it;
/// `json` is its value: a knob's raw value (`atAtk` 0 to 100), a select's
/// value ("pluck", "sine", "seq", "3"), `fx` the whole chain
/// (`[{kind, on, params: {key: value}, wet, level}]`, laid again), or for
/// `fx.<slot>.<key>` / `fx.<slot>.wet` / `fx.<slot>.level` / `fx.<slot>.on`
/// one control of the running chain (nothing laid again). A key it does not
/// keep is ignored (0).
///
/// # Safety
/// `a` came from `na_new`; `key` and `json` are C strings.
#[no_mangle]
pub unsafe extern "C" fn na_atmos_set(a: *mut NaApp, id: u32, key: *const c_char, json: *const c_char) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        match parse(text(json)) {
            Ok(v) => status(a, s.atmos_set(id, text(key).unwrap_or(""), &v)),
            Err(e) => fail(a, e),
        }
    })
}

/// Atmosphere module `id` as one of MGL's presets (only Atmosphere's
/// controls, as `getPresetState` keeps them), named `name`; the module is
/// known by that name from now on. Its length, as `na_save` gives text.
///
/// # Safety
/// `a` came from `na_new`; `name` is a C string; `buf` has room for `cap`
/// bytes, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_atmos_preset(a: *mut NaApp, id: u32, name: *const c_char, buf: *mut c_char, cap: u32) -> u32 {
    guarded(0, || match session(a).map(|s| s.atmos_preset(id, text(name).unwrap_or(""))) {
        Some(Ok(v)) => give_text(&v.to_string(), buf, cap),
        _ => 0,
    })
}

/// Give Atmosphere module `id` one of MGL's presets (an object with its
/// `state`, as MGL's Seq saves and exports them): each of Atmosphere's
/// controls it holds, and nothing else. How many it set, or an error.
///
/// # Safety
/// `a` came from `na_new`; `json` is a C string.
#[no_mangle]
pub unsafe extern "C" fn na_load_atmos_preset(a: *mut NaApp, id: u32, json: *const c_char) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        match parse(text(json)) {
            Ok(v) => match s.load_atmos_preset(id, &v) {
                Ok(n) => n as i32,
                Err(e) => fail(a, e),
            },
            Err(e) => fail(a, e),
        }
    })
}

/// Atmosphere module `id`'s state as JSON: every page key and its value.
///
/// # Safety
/// `a` came from `na_new`; `buf` has room for `cap` bytes, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_atmos_state(a: *mut NaApp, id: u32, buf: *mut c_char, cap: u32) -> u32 {
    guarded(0, || match session(a).map(|s| s.atmos_state(id)) {
        Some(Ok(v)) => give_text(&v.to_string(), buf, cap),
        _ => 0,
    })
}

/// What oscillator `which` (0 A, 1 B) of Atmosphere module `id` shows now
/// (`atmos::Synth::view`), 32 floats into `out32`: its model's number
/// (`AT_MODELS` order), or -1 when nothing sounds (`out32` left as it was).
///
/// # Safety
/// `a` came from `na_new`; `out32` has room for 32 floats, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_atmos_view(a: *mut NaApp, id: u32, which: u32, out32: *mut f32) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let mut v = [0.0f32; 32];
        match s.atmos_view(id, which as usize, &mut v) {
            Ok(Some(m)) => {
                if !out32.is_null() {
                    ptr::copy_nonoverlapping(v.as_ptr(), out32, 32);
                }
                m as i32
            }
            Ok(None) => -1,
            Err(e) => fail(a, e),
        }
    })
}

/// The pitch of the last note Atmosphere module `id` started, in Hz (0
/// before any, or with no such module).
///
/// # Safety
/// `a` came from `na_new`.
#[no_mangle]
pub unsafe extern "C" fn na_atmos_hz(a: *mut NaApp, id: u32) -> f32 {
    guarded(0.0, || {
        let Some(s) = session(a) else { return 0.0 };
        s.atmos_hz(id).unwrap_or(0.0)
    })
}

/// The last `n` frames (at most 2048) of Atmosphere module `id`'s output,
/// mono, oldest first, into `out`. How many were written.
///
/// # Safety
/// `a` came from `na_new`; `out` has room for `n` floats, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_atmos_scope(a: *mut NaApp, id: u32, out: *mut f32, n: u32) -> u32 {
    guarded(0, || {
        let Some(s) = session(a) else { return 0 };
        if out.is_null() {
            return 0;
        }
        s.atmos_scope(id, slice::from_raw_parts_mut(out, n as usize)).unwrap_or(0) as u32
    })
}

/// Atmosphere module `id`'s FX line since the last call: its output peak
/// into `peak`, and for each slot of the chain (up to `n`) its output peak
/// into `peaks` and how hard its effect is working into `work`
/// (`fx_telemetry`). Returns the chain's length.
///
/// # Safety
/// `a` came from `na_new`; `peak` is one float or null; `peaks` and `work`
/// have room for `n` floats each, or are null.
#[no_mangle]
pub unsafe extern "C" fn na_atmos_fx_meter(a: *mut NaApp, id: u32, peak: *mut f32, peaks: *mut f32, work: *mut f32, n: u32) -> u32 {
    guarded(0, || {
        let Some(s) = session(a) else { return 0 };
        let Ok((p, slots)) = s.atmos_fx_meter(id) else { return 0 };
        if !peak.is_null() {
            *peak = p;
        }
        for (i, (pk, w)) in slots.iter().take(n as usize).enumerate() {
            if !peaks.is_null() {
                *peaks.add(i) = *pk;
            }
            if !work.is_null() {
                *work.add(i) = *w;
            }
        }
        slots.len() as u32
    })
}

/// Every effect the FX line's insert menu offers, as atfx.js keeps it from
/// `/api/fx`: `{suites: [{id, label, families: [{label, modes: [{kind,
/// label, id}]}]}], shapers: {kind: {label, params: [{key, label, min, max,
/// default, unit, log}]}}}`.
///
/// # Safety
/// `buf` has room for `cap` bytes, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_fx_kinds(buf: *mut c_char, cap: u32) -> u32 {
    guarded(0, || give_text(&engine_app::fx_kinds_json().to_string(), buf, cap))
}

/// The Atmosphere page's own lists (`AT_KNOBS`, `AT_MODELS`, the LFOs'
/// targets and shapes, Sympathy's tunings, `SCALES`, Seq's defaults), as
/// captured from it: engine-app's `data/atmos-page.json`.
///
/// # Safety
/// `buf` has room for `cap` bytes, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_atmos_page(buf: *mut c_char, cap: u32) -> u32 {
    guarded(0, || give_text(engine_app::atmos_part::PAGE_JSON, buf, cap))
}

// The Sound and Edit modules (app/sound.rs).
mod sound;

/// Wave module `id`'s side of MGL's `/api/wave` routes, as its server
/// answers them: `method` "GET", "POST" or "DELETE", `path` with any query
/// ("/api/wave/table?name=X"), `body` the JSON sent, or null. Writes the JSON
/// reply into `buf` as `snprintf` would and returns its whole length;
/// `*status` gets the HTTP status MGL would answer (200, 400, 404, 500). A
/// reply too long for `buf` is kept whole: `na_wave_reply` gives it without
/// asking again (asking again would do a POST twice).
///
/// # Safety
/// `a` came from `na_new`; `method` and `path` are C strings; `body` is a C
/// string or null; `buf` has room for `cap` bytes, or is null; `status` is
/// one int or null.
#[no_mangle]
pub unsafe extern "C" fn na_wave_api(
    a: *mut NaApp,
    id: u32,
    method: *const c_char,
    path: *const c_char,
    body: *const c_char,
    buf: *mut c_char,
    cap: u32,
    status: *mut i32,
) -> u32 {
    let (code, reply) = guarded((500, r#"{"error":"the engine panicked"}"#.to_string()), || match session(a) {
        Some(s) => {
            let r = s.wave_api(id, text(method).unwrap_or(""), text(path).unwrap_or(""), text(body));
            (r.status as i32, r.body.to_string())
        }
        None => (500, r#"{"error":"no engine"}"#.to_string()),
    });
    if !status.is_null() {
        *status = code;
    }
    let n = give_text(&reply, buf, cap);
    if !a.is_null() {
        *ptr::addr_of_mut!((*a).reply) = reply;
    }
    n
}

/// `na_wave_api`'s last reply, whole.
///
/// # Safety
/// `a` came from `na_new`; `buf` has room for `cap` bytes, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_wave_reply(a: *mut NaApp, buf: *mut c_char, cap: u32) -> u32 {
    guarded(0, || if a.is_null() { 0 } else { give_text(&*ptr::addr_of!((*a).reply), buf, cap) })
}

/// Where Wave's own files go: `home` (the app's home; presets in
/// `<home>/presets/wave`, board presets in `<home>/presets/wave-boards`), and
/// `mgl`, MultiGrainLive's `data/wave`, read only (null for MGL's own folder
/// on this machine, "" for none). Tables go in the first `na_table_dirs`
/// folder.
///
/// # Safety
/// `a` came from `na_new`; `home` and `mgl` are C strings or null.
#[no_mangle]
pub unsafe extern "C" fn na_set_wave_home(a: *mut NaApp, home: *const c_char, mgl: *const c_char) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let dir = |p: &str| Some(std::path::PathBuf::from(p)).filter(|_| !p.is_empty());
        let home = text(home).and_then(dir);
        let mgl = if mgl.is_null() { engine_app::wave_api::WaveDirs::default().mgl } else { text(mgl).and_then(dir) };
        s.set_wave_dirs(home, mgl);
        0
    })
}

mod grain;
