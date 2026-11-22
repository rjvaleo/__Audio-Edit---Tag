//! The Grain module's C calls, in the style of the rest. Most of what the
//! face asks is one of MGL's routes, so it crosses as JSON through one call,
//! `na_grain_call`, named by the route it stands for; the numbers the face
//! draws from every frame have calls of their own.

use super::*;

/// One of Grain module `id`'s calls, `what` naming it, with `json` (or null):
///
/// - `"edit"`: an `/api/edit` op on its document (the controls post `"stretch"`);
/// - `"keys"`: `/api/engine/voice`; `"transport"`: `/api/engine/transport`;
/// - `"lfos"`: `POST /api/engine/lfos`; `"lfos-state"`: `GET /api/engine/lfos`;
/// - `"rack"`: `{op: get | set | param | add | remove | move | bypass, ...}`;
/// - `"presets"`: `{op: places | list | save | apply | update | delete, ...}`;
/// - `"info"`: its document, rack, LFOs, keys, transport and the face's own;
/// - `"read"`: `/api/engine/grains`; `"ui"`: keep the face's own state.
///
/// The answer (JSON) into `buf`; its whole length, or an error's code.
///
/// # Safety
/// `a` came from `na_new`; `what` is a C string; `json` is one or null; `buf`
/// has room for `cap` bytes, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_grain_call(a: *mut NaApp, id: u32, what: *const c_char, json: *const c_char, buf: *mut c_char, cap: u32) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let v = match text(json) {
            Some(j) if !j.is_empty() => match parse(Some(j)) {
                Ok(v) => v,
                Err(e) => return fail(a, e),
            },
            _ => Value::Null,
        };
        let r = match text(what).unwrap_or("") {
            "edit" => s.grain_edit(id, &v),
            "keys" => s.grain_keys(id, &v),
            "transport" => s.grain_transport(id, &v),
            "lfos" => s.grain_lfos(id, &v),
            "lfos-state" => s.grain_lfos_state(id),
            "rack" => s.grain_rack(id, &v),
            "presets" => s.grain_presets(id, &v),
            "info" => s.grain_info(id),
            "read" => s.grain_read(id),
            "ui" => s.grain_set_ui(id, v).map(|_| Value::Bool(true)),
            other => Err(AppError::BadFile(format!("no Grain call {other:?}"))),
        };
        match r {
            Ok(v) => give_text(&v.to_string(), buf, cap) as i32,
            Err(e) => fail(a, e),
        }
    })
}

/// Run every Grain's LFOs on by `seconds` (MGL ticks them every 8 ms).
///
/// # Safety
/// `a` came from `na_new`.
#[no_mangle]
pub unsafe extern "C" fn na_grain_tick(a: *mut NaApp, seconds: f64) {
    guarded((), || {
        if let Some(s) = session(a) {
            s.grain_tick(seconds);
        }
    })
}

/// Grain module `id`'s document's peaks over `[from, to)` (0, 0: the whole)
/// in up to `cols` columns, as `na_edit_peaks` gives them. The columns.
///
/// # Safety
/// `a` came from `na_new`; `out` has room for `cap` floats; `info` for 3.
#[no_mangle]
pub unsafe extern "C" fn na_grain_peaks(a: *mut NaApp, id: u32, from: u64, to: u64, cols: u32, out: *mut f32, cap: u32, info: *mut u64) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let mut v = Vec::new();
        match s.grain_peaks(id, from, to, cols as usize, &mut v) {
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

/// `n` of the document's mono samples (the file's rate) from `from` into
/// `out`. How many there are in all, 0 until they are measured.
///
/// # Safety
/// `a` came from `na_new`; `out` has room for `n` floats.
#[no_mangle]
pub unsafe extern "C" fn na_grain_mono(a: *mut NaApp, id: u32, from: u64, out: *mut f32, n: u32) -> i64 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE as i64 };
        let out = if out.is_null() { &mut [][..] } else { slice::from_raw_parts_mut(out, n as usize) };
        match s.grain_mono(id, from as usize, out) {
            Ok(n) => n as i64,
            Err(e) => fail(a, e) as i64,
        }
    })
}

/// The deck's last `n` frames out, left and right. How many there were.
///
/// # Safety
/// `a` came from `na_new`; `l` and `r` have room for `n` floats.
#[no_mangle]
pub unsafe extern "C" fn na_grain_scope(a: *mut NaApp, id: u32, l: *mut f32, r: *mut f32, n: u32) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        if l.is_null() || r.is_null() {
            return 0;
        }
        let (l, r) = (slice::from_raw_parts_mut(l, n as usize), slice::from_raw_parts_mut(r, n as usize));
        match s.grain_scope(id, l, r) {
            Ok(n) => n as i32,
            Err(e) => fail(a, e),
        }
    })
}
