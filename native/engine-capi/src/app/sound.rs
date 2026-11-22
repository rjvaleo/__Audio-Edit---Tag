//! The Sound and Edit modules' C calls, in the style of the rest: text as
//! `snprintf` gives it, numbers into the caller's room. A call that answers
//! with text returns its whole length, or a code below zero (`na_error`
//! says why).

use super::*;

/// Text back, or the error's code.
unsafe fn answer(a: *mut NaApp, r: Result<Value, AppError>, buf: *mut c_char, cap: u32) -> i32 {
    match r {
        Ok(v) => give_text(&v.to_string(), buf, cap) as i32,
        Err(e) => fail(a, e),
    }
}

/// Open the file at `path` in Sound module `id`. `origin` (JSON, or null)
/// says where it came from: `{"kind": "file" | "library", "path", "name"}`.
/// With `keep` 1, a sound that was lost takes back its edits and markers.
/// The sound's info (as `na_sound_info`) into `buf`, or an error.
///
/// # Safety
/// `a` came from `na_new`; `path` and `origin` are C strings (`origin` may be
/// null); `buf` has room for `cap` bytes, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_sound_open(a: *mut NaApp, id: u32, path: *const c_char, origin: *const c_char, keep: u32, buf: *mut c_char, cap: u32) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let origin = text(origin).and_then(|o| serde_json::from_str(o).ok()).unwrap_or(Value::Null);
        let r = s.sound_open(id, text(path).unwrap_or(""), &origin, keep != 0);
        answer(a, r, buf, cap)
    })
}

/// Sound module `id`: its document (as MGL's `/api/edit` answers), where it
/// came from, its markers, and whether its samples are measured.
///
/// # Safety
/// `a` came from `na_new`; `buf` has room for `cap` bytes, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_sound_info(a: *mut NaApp, id: u32, buf: *mut c_char, cap: u32) -> i32 {
    guarded(-12, || match session(a) {
        Some(s) => {
            let r = s.sound_info(id);
            answer(a, r, buf, cap)
        }
        None => NO_ENGINE,
    })
}

/// The Sound module cabled into Edit module `id`, or -2.
///
/// # Safety
/// `a` came from `na_new`.
#[no_mangle]
pub unsafe extern "C" fn na_sound_of(a: *mut NaApp, id: u32) -> i32 {
    guarded(-12, || match session(a).and_then(|s| s.sound_of(id)) {
        Some(n) => n as i32,
        None => -2,
    })
}

/// One of MGL's edit ops on Edit module `id`'s sound, as `/api/edit` takes
/// it (JSON); its answer, as `/api/edit` gives it.
///
/// # Safety
/// `a` came from `na_new`; `json` is a C string; `buf` has room for `cap`
/// bytes, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_edit_op(a: *mut NaApp, id: u32, json: *const c_char, buf: *mut c_char, cap: u32) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let r = parse(text(json)).and_then(|v| s.edit_op(id, &v));
        answer(a, r, buf, cap)
    })
}

/// Markers and regions on Edit module `id`'s sound: `{"op": "set",
/// markers, regions}` (`/api/markers`) or one of `/api/annot`'s ops. The
/// markers and regions after it.
///
/// # Safety
/// As `na_edit_op`.
#[no_mangle]
pub unsafe extern "C" fn na_edit_annot(a: *mut NaApp, id: u32, json: *const c_char, buf: *mut c_char, cap: u32) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let r = parse(text(json)).and_then(|v| s.edit_annot(id, &v));
        answer(a, r, buf, cap)
    })
}

/// `/api/measure` of `[start, end)` of Edit module `id`'s sound (0, 0 the whole).
///
/// # Safety
/// `a` came from `na_new`; `buf` has room for `cap` bytes, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_edit_measure(a: *mut NaApp, id: u32, start: u64, end: u64, buf: *mut c_char, cap: u32) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let r = s.edit_measure(id, start, end);
        answer(a, r, buf, cap)
    })
}

/// What the Edit page measures from the sound's samples (its hits, loud
/// spots, the bands and levels of `[from, to)`, or the whole when `to` is not
/// past `from`), or null until measured.
///
/// # Safety
/// `a` came from `na_new`; `buf` has room for `cap` bytes, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_edit_measures(a: *mut NaApp, id: u32, from: f64, to: f64, buf: *mut c_char, cap: u32) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let r = s.edit_measures(id, from, to);
        answer(a, r, buf, cap)
    })
}

/// The edited timeline's peaks over `[from, to)` (`to` 0: to the end) in up
/// to `cols` columns, into `out` as [channel][min, max, rms][column], at
/// most `cap` floats. `info` gets (channels, from, to). The columns, or an error.
///
/// # Safety
/// `a` came from `na_new`; `out` has room for `cap` floats; `info` for 3.
#[no_mangle]
pub unsafe extern "C" fn na_edit_peaks(a: *mut NaApp, id: u32, from: u64, to: u64, cols: u32, out: *mut f32, cap: u32, info: *mut u64) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let mut v = Vec::new();
        match s.edit_peaks(id, from, to, cols as usize, &mut v) {
            Ok((c, ch, f, t)) => {
                if !out.is_null() {
                    ptr::copy_nonoverlapping(v.as_ptr(), out, v.len().min(cap as usize));
                }
                if !info.is_null() {
                    *info = ch as u64;
                    *info.add(1) = f;
                    *info.add(2) = t;
                }
                c as i32
            }
            Err(e) => fail(a, e),
        }
    })
}

/// The spectrogram of Edit module `id`'s file over `[from, to)`, as MGL's
/// `/api/spectrogram` makes it: a byte a cell, column 0's bins first, at
/// most `cap`. `info` gets (bins, maxHz). The columns, or an error.
///
/// # Safety
/// `a` came from `na_new`; `out` has room for `cap` bytes; `info` for 2 floats.
#[no_mangle]
pub unsafe extern "C" fn na_edit_spectrogram(a: *mut NaApp, id: u32, from: u64, to: u64, cols: u32, fft: u32, out: *mut u8, cap: u32, info: *mut f32) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let mut v = Vec::new();
        match s.edit_spectrogram(id, from, to, cols as usize, fft as usize, &mut v) {
            Ok((c, bins, hz)) => {
                if !out.is_null() {
                    ptr::copy_nonoverlapping(v.as_ptr(), out, v.len().min(cap as usize));
                }
                if !info.is_null() {
                    *info = bins as f32;
                    *info.add(1) = hz;
                }
                c as i32
            }
            Err(e) => fail(a, e),
        }
    })
}

/// The Rainbow's colour for each of `cols` columns over `[from, to)`, into
/// `out` as r, g, b (0 to 255). 1, or 0 when the sound is not measured yet.
///
/// # Safety
/// `a` came from `na_new`; `out` has room for `cols * 3` floats.
#[no_mangle]
pub unsafe extern "C" fn na_edit_colours(a: *mut NaApp, id: u32, from: f64, to: f64, cols: u32, out: *mut f32) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let mut v = Vec::new();
        match s.edit_colours(id, from, to, cols as usize, &mut v) {
            Ok(true) => {
                if !out.is_null() {
                    ptr::copy_nonoverlapping(v.as_ptr(), out, v.len());
                }
                1
            }
            Ok(false) => 0,
            Err(e) => fail(a, e),
        }
    })
}

/// `n` of the sound's mono samples from `from` into `out` (0 outside it).
/// How long the sound is, 0 until it is measured.
///
/// # Safety
/// `a` came from `na_new`; `out` has room for `n` floats.
#[no_mangle]
pub unsafe extern "C" fn na_edit_mono(a: *mut NaApp, id: u32, from: i64, out: *mut f32, n: u32) -> i64 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE as i64 };
        if out.is_null() {
            return 0;
        }
        match s.edit_mono(id, from, slice::from_raw_parts_mut(out, n as usize)) {
            Ok(len) => len as i64,
            Err(e) => fail(a, e) as i64,
        }
    })
}

/// Where a dragged edge at `frame` lands (`edEdgeSnap`).
///
/// # Safety
/// `a` came from `na_new`.
#[no_mangle]
pub unsafe extern "C" fn na_edit_edge_snap(a: *mut NaApp, id: u32, frame: i64, hits: u32, zero: u32) -> i64 {
    guarded(frame, || match session(a).map(|s| s.edit_edge_snap(id, frame, hits != 0, zero != 0)) {
        Some(Ok(f)) => f,
        _ => frame,
    })
}

/// Edit module `id`'s transport: `{"play": bool}`, `{"seek": frame}`,
/// `{"loop": {"on", "a", "b"}}`, frames on the document's timeline.
///
/// # Safety
/// `a` came from `na_new`; `json` is a C string.
#[no_mangle]
pub unsafe extern "C" fn na_edit_transport(a: *mut NaApp, id: u32, json: *const c_char) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let r = parse(text(json)).and_then(|v| s.edit_transport(id, &v));
        status(a, r)
    })
}

/// Where Edit module `id`'s head is: into `out4` its frame on the document's
/// timeline, 1 if it plays, and its last block's peaks, left and right.
///
/// # Safety
/// `a` came from `na_new`; `out4` has room for 4 doubles.
#[no_mangle]
pub unsafe extern "C" fn na_edit_position(a: *mut NaApp, id: u32, out4: *mut f64) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        match s.edit_position(id) {
            Ok((f, p, l, r)) => {
                if !out4.is_null() {
                    *out4 = f;
                    *out4.add(1) = if p { 1.0 } else { 0.0 };
                    *out4.add(2) = l as f64;
                    *out4.add(3) = r as f64;
                }
                0
            }
            Err(e) => fail(a, e),
        }
    })
}

/// Write Edit module `id`'s edited sound to `path` as a WAV of `bits` (16,
/// 24, or 32 for float). How many bytes, or an error.
///
/// # Safety
/// `a` came from `na_new`; `path` is a C string.
#[no_mangle]
pub unsafe extern "C" fn na_edit_export(a: *mut NaApp, id: u32, path: *const c_char, bits: u32) -> i64 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE as i64 };
        match s.edit_export(id, text(path).unwrap_or(""), bits as u16) {
            Ok(n) => n as i64,
            Err(e) => fail(a, e) as i64,
        }
    })
}

/// What Edit module `id`'s face keeps (JSON), saved in the patch.
///
/// # Safety
/// `a` came from `na_new`; `json` is a C string.
#[no_mangle]
pub unsafe extern "C" fn na_edit_set_ui(a: *mut NaApp, id: u32, json: *const c_char) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let r = parse(text(json)).and_then(|v| s.edit_set_ui(id, v));
        status(a, r)
    })
}

/// # Safety
/// `a` came from `na_new`; `buf` has room for `cap` bytes, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_edit_ui(a: *mut NaApp, id: u32, buf: *mut c_char, cap: u32) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let r = s.edit_ui(id).cloned();
        answer(a, r, buf, cap)
    })
}
