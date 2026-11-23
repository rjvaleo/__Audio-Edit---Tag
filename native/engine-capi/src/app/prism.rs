//! The Prism module's C calls. What the face asks is one of MGL's routes or
//! one of the page's own actions, as JSON through one call, `na_prism_call`;
//! the sound's peaks have a call of their own.

use super::*;

/// One of Prism module `id`'s calls, `what` naming it, with `json` (or null):
///
/// - MGL's routes: `"state"` (`/api/prism/state`), `"stretch"`
///   (`/api/prism/stretch`), `"pad"` (`/api/engine/pad`), `"glide"`,
///   `"transport"`, `"rack"` (`{op: get | set | param}`), `"pitchtime"`,
///   `"sources"` (`/api/pad`), `"fx"` (`/api/fx`), `"presets"` (`{op: places
///   | list | apply | init | save | rename | delete}`);
/// - the page's own: `"tick"` (`{t}`: a frame, its clock in ms), `"view"`,
///   `"padop"`, `"lfo"`, `"source"`, `"pick"`, `"axis"`, `"limit"`,
///   `"setting"`, `"ptc"`, `"fader"`, `"postRoll"`, `"engine"`, `"chainAdd"`,
///   `"chainRemove"`, `"deck"` (the Now Playing bar), `"ui"`, `"info"`.
///
/// The answer (JSON) into `buf`; its whole length, or an error's code.
///
/// # Safety
/// `a` came from `na_new`; `what` is a C string; `json` is one or null; `buf`
/// has room for `cap` bytes, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_prism_call(a: *mut NaApp, id: u32, what: *const c_char, json: *const c_char, buf: *mut c_char, cap: u32) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let v = match text(json) {
            Some(j) if !j.is_empty() => match parse(Some(j)) {
                Ok(v) => v,
                Err(e) => return fail(a, e),
            },
            _ => Value::Null,
        };
        match s.prism_call(id, text(what).unwrap_or(""), &v) {
            Ok(v) => give_text(&v.to_string(), buf, cap) as i32,
            Err(e) => fail(a, e),
        }
    })
}

/// Prism module `id`'s sound's peaks in `cols` columns into `out` (each the
/// largest of any channel's), the largest of all into `peak`. How many.
///
/// # Safety
/// `a` came from `na_new`; `out` has room for `cap` floats; `peak` for one.
#[no_mangle]
pub unsafe extern "C" fn na_prism_peaks(a: *mut NaApp, id: u32, cols: u32, out: *mut f32, cap: u32, peak: *mut f32) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let mut v = Vec::new();
        match s.prism_peaks(id, cols as usize, &mut v) {
            Ok(pk) => {
                if !out.is_null() {
                    ptr::copy_nonoverlapping(v.as_ptr(), out, v.len().min(cap as usize));
                }
                if !peak.is_null() {
                    *peak = pk;
                }
                v.len() as i32
            }
            Err(e) => fail(a, e),
        }
    })
}
