//! The Browse and Library modules' C calls, and MGL's library itself.
//!
//! The module's own (`na_browse_call`) are app calls, under the app's lock.
//! The library (`na_lib_*`) is not the canvas's: one is opened for the whole
//! app and may be called from any thread at once (its routes can take a
//! while: a scan, a pass of the listening model), never from the audio
//! thread. Each call's whole answer comes back held (`NaReply`), so a POST
//! is made once however long its answer.

use super::*;
use engine_library::Library;

/// One of Browse (or Library) module `id`'s calls (`browse_link.rs`), with
/// `json` (or null). The answer (JSON) into `buf`; its whole length, or an
/// error's code.
///
/// # Safety
/// `a` came from `na_new`; `what` is a C string; `json` is one or null; `buf`
/// has room for `cap` bytes, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_browse_call(a: *mut NaApp, id: u32, what: *const c_char, json: *const c_char, buf: *mut c_char, cap: u32) -> i32 {
    guarded(-12, || {
        let Some(s) = session(a) else { return NO_ENGINE };
        let v = match text(json) {
            Some(j) if !j.is_empty() => match parse(Some(j)) {
                Ok(v) => v,
                Err(e) => return fail(a, e),
            },
            _ => Value::Null,
        };
        match s.browse_call(id, text(what).unwrap_or(""), &v) {
            Ok(v) => give_text(&v.to_string(), buf, cap) as i32,
            Err(e) => fail(a, e),
        }
    })
}

pub struct NaLib {
    lib: Library,
}

/// A reply, held until `na_reply_free`.
pub struct NaReply {
    status: u16,
    content_type: std::ffi::CString,
    body: Vec<u8>,
}

/// MGL's library, kept in `home` (the app's own copy of its files, made
/// from `mgl`, MGL's data folder, the first time; null for none), with MGL's
/// listening model looked for in `models` (null for none). Null if it failed.
///
/// # Safety
/// `home` is a C string; `mgl` and `models` are C strings or null.
#[no_mangle]
pub unsafe extern "C" fn na_lib_open(home: *const c_char, mgl: *const c_char, models: *const c_char) -> *mut NaLib {
    guarded(ptr::null_mut(), || {
        let Some(home) = text(home).filter(|h| !h.is_empty()) else { return ptr::null_mut() };
        let path = |p: *const c_char| text(p).filter(|s| !s.is_empty()).map(std::path::PathBuf::from);
        let lib = Library::open(std::path::Path::new(home), path(mgl).as_deref(), path(models).as_deref());
        Box::into_raw(Box::new(NaLib { lib }))
    })
}

/// # Safety
/// `l` came from `na_lib_open`, and no call is using it or will again.
#[no_mangle]
pub unsafe extern "C" fn na_lib_free(l: *mut NaLib) {
    guarded((), || {
        if !l.is_null() {
            drop(Box::from_raw(l));
        }
    })
}

/// One of MGL's library routes, as the page asks it: `method` ("GET",
/// "POST"), `target` (the path and its query, escaped as a browser sends
/// it), `body` of `len` bytes (or null). Null only if it could not be asked.
///
/// # Safety
/// `l` came from `na_lib_open`; `method` and `target` are C strings; `body`
/// has `len` bytes or is null.
#[no_mangle]
pub unsafe extern "C" fn na_lib_call(l: *mut NaLib, method: *const c_char, target: *const c_char, body: *const u8, len: u32) -> *mut NaReply {
    guarded(ptr::null_mut(), || {
        if l.is_null() {
            return ptr::null_mut();
        }
        let body = if body.is_null() || len == 0 { &[][..] } else { slice::from_raw_parts(body, len as usize) };
        let r = (*l).lib.call(text(method).unwrap_or("GET"), text(target).unwrap_or("/"), body);
        let content_type = std::ffi::CString::new(r.content_type.replace('\0', "")).unwrap_or_default();
        Box::into_raw(Box::new(NaReply { status: r.status, content_type, body: r.body }))
    })
}

/// The library's folder (where its files are), into `buf`; its whole
/// length, 0 for none chosen.
///
/// # Safety
/// `l` came from `na_lib_open`; `buf` has room for `cap` bytes, or is null.
#[no_mangle]
pub unsafe extern "C" fn na_lib_folder(l: *mut NaLib, buf: *mut c_char, cap: u32) -> u32 {
    guarded(0, || {
        if l.is_null() {
            return 0;
        }
        match (*l).lib.folder() {
            Some(p) => give_text(&p.to_string_lossy(), buf, cap),
            None => give_text("", buf, cap),
        }
    })
}

/// The reply's status (200, 404, ...).
///
/// # Safety
/// `r` came from `na_lib_call` and is not freed.
#[no_mangle]
pub unsafe extern "C" fn na_reply_status(r: *const NaReply) -> u32 {
    if r.is_null() { 0 } else { (*r).status as u32 }
}

/// The reply's body: a pointer to its bytes, their number in `len`. Valid
/// until `na_reply_free`.
///
/// # Safety
/// `r` came from `na_lib_call` and is not freed; `len` points to a u32.
#[no_mangle]
pub unsafe extern "C" fn na_reply_body(r: *const NaReply, len: *mut u32) -> *const u8 {
    if r.is_null() {
        if !len.is_null() {
            *len = 0;
        }
        return ptr::null();
    }
    if !len.is_null() {
        *len = (*r).body.len().min(u32::MAX as usize) as u32;
    }
    (*r).body.as_ptr()
}

/// The reply's content type, a C string valid until `na_reply_free`.
///
/// # Safety
/// `r` came from `na_lib_call` and is not freed.
#[no_mangle]
pub unsafe extern "C" fn na_reply_type(r: *const NaReply) -> *const c_char {
    if r.is_null() { ptr::null() } else { (*r).content_type.as_ptr() }
}

/// # Safety
/// `r` came from `na_lib_call`, and is not used again.
#[no_mangle]
pub unsafe extern "C" fn na_reply_free(r: *mut NaReply) {
    guarded((), || {
        if !r.is_null() {
            drop(Box::from_raw(r));
        }
    })
}
