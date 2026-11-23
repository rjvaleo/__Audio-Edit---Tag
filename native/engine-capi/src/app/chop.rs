//! The Chop module's C calls (`CHOP-API.md`): one JSON call for the page's
//! functions, `na_chop_call`, and the arrays the face draws from.

use super::*;

/// One of Chop module `id`'s calls, `what` naming the page's function
/// (`state`, `set`, `apply`, `ab`, `dice`, `detect`, `scale`, `region`,
/// `whole`, `recut`, `pick`, `toggle`, `lock`, `move`, `moved`, `delete`,
/// `add`, `play`, `preview`, `ratchet`, `stop`, `playing`, `slice`, `tails`,
/// `write`, `toRegions`, `presets`, `home`, `ui`), with `json` (or null).
/// The answer (JSON) into `buf`; its whole length, or an error's code.
///
/// # Safety
/// `a` came from `na_new`; `what` is a C string; `json` is one or null; `buf`
/// has room for `cap` bytes, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_chop_call(a: *mut NaApp, id: u32, what: *const c_char, json: *const c_char, buf: *mut c_char, cap: u32) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let v = match text(json) {
            Some(j) if !j.trim().is_empty() => match parse(Some(j)) {
                Ok(v) => v,
                Err(e) => return fail(a, e),
            },
            _ => Value::Null,
        };
        match s.chop_call(id, text(what).unwrap_or(""), &v) {
            Ok(v) => give_text(&v.to_string(), buf, cap) as i32,
            Err(e) => fail(a, e),
        }
    })
}

/// `n` of the sound's mono samples (`chop.mono`) from `from` into `out` (0
/// past the ends). The sound's length; 0 with no sound.
///
/// # Safety
/// `a` came from `na_new`; `out` has room for `n` floats, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_chop_mono(a: *mut NaApp, id: u32, from: i64, out: *mut f32, n: u32) -> i64 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE as i64 };
        let out = if out.is_null() { &mut [][..] } else { slice::from_raw_parts_mut(out, n as usize) };
        match s.chop_mono(id, from, out) {
            Ok(n) => n as i64,
            Err(e) => fail(a, e) as i64,
        }
    })
}

/// One of the analysis's arrays (`which`: 0 low, 1 mid, 2 high, 3 cent,
/// 4 flat, 5 zcr, 6 rms, 7 rise, 8 hz, 9 clar), up to `n` of it into `out`.
/// F, the frames there are; 0 until measured.
///
/// # Safety
/// `a` came from `na_new`; `out` has room for `n` floats, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_chop_analysis(a: *mut NaApp, id: u32, which: u32, out: *mut f32, n: u32) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let out = if out.is_null() { &mut [][..] } else { slice::from_raw_parts_mut(out, n as usize) };
        match s.chop_analysis(id, which, out) {
            Ok(n) => n as i32,
            Err(e) => fail(a, e),
        }
    })
}

/// Slice `i`'s first channel as `chopSliceAudio(i)` renders it now, up to
/// `n` frames into `out`. Its whole length (ask again with room).
///
/// # Safety
/// `a` came from `na_new`; `out` has room for `n` floats, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_chop_render(a: *mut NaApp, id: u32, i: i32, out: *mut f32, n: u32) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let out = if out.is_null() { &mut [][..] } else { slice::from_raw_parts_mut(out, n as usize) };
        match s.chop_render(id, i as i64, out) {
            Ok(n) => n as i32,
            Err(e) => fail(a, e),
        }
    })
}

/// What plays now, its first channel, `n` frames from where it has got to
/// (`chopDrawOut`; a looped one wraps). How many; 0 when nothing plays.
///
/// # Safety
/// `a` came from `na_new`; `out` has room for `n` floats, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_chop_out(a: *mut NaApp, id: u32, out: *mut f32, n: u32) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let out = if out.is_null() { &mut [][..] } else { slice::from_raw_parts_mut(out, n as usize) };
        match s.chop_out(id, out) {
            Ok(n) => n as i32,
            Err(e) => fail(a, e),
        }
    })
}
