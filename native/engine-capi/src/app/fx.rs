//! The FX modules' C calls (the FX page and every effect on its own), in the
//! style of Grain's: what the face asks is one of MGL's routes, so it crosses
//! as JSON through one call, `na_fx_call`; the frames OUT and SPECTRUM draw
//! have a call of their own.

use super::*;

/// One of FX module `id`'s calls, `what` naming it (see
/// `Session::fx_call`: `catalogue`, `rack`, `transport`, `levels`, `info`,
/// `ui`), with `json` (or null). The answer (JSON) into `buf`; its whole
/// length, or an error's code.
///
/// # Safety
/// `a` came from `na_new`; `what` is a C string; `json` is one or null; `buf`
/// has room for `cap` bytes, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_fx_call(a: *mut NaApp, id: u32, what: *const c_char, json: *const c_char, buf: *mut c_char, cap: u32) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let v = match text(json) {
            Some(j) if !j.is_empty() => match parse(Some(j)) {
                Ok(v) => v,
                Err(e) => return fail(a, e),
            },
            _ => Value::Null,
        };
        match s.fx_call(id, text(what).unwrap_or(""), &v) {
            Ok(v) => give_text(&v.to_string(), buf, cap) as i32,
            Err(e) => fail(a, e),
        }
    })
}

/// The last `n` frames (at most 2048) of FX module `id`'s output, mono,
/// oldest first, into `out`. How many, or an error's code.
///
/// # Safety
/// `a` came from `na_new`; `out` has room for `n` floats.
#[no_mangle]
pub unsafe extern "C" fn na_fx_scope(a: *mut NaApp, id: u32, out: *mut f32, n: u32) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        if out.is_null() {
            return 0;
        }
        let out = std::slice::from_raw_parts_mut(out, n as usize);
        match s.fx_ref(id) {
            Ok(f) => f.scope.read(out) as i32,
            Err(e) => fail(a, e),
        }
    })
}
