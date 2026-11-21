//! The app's C interface, called as the JUCE app calls it.

use engine_capi::*;
use std::ffi::{CStr, CString};

fn text(f: impl Fn(*mut std::ffi::c_char, u32) -> u32) -> String {
    let need = f(std::ptr::null_mut(), 0) as usize;
    let mut buf = vec![0u8; need + 1];
    let got = f(buf.as_mut_ptr() as *mut std::ffi::c_char, buf.len() as u32) as usize;
    assert_eq!(got, need);
    CStr::from_bytes_until_nul(&buf).unwrap().to_str().unwrap().to_string()
}

fn render(a: *mut NaApp, frames: usize) -> Vec<f32> {
    let (mut l, mut r) = (vec![0.0f32; 256], vec![0.0f32; 256]);
    let mut all = Vec::new();
    for _ in 0..frames / 256 {
        assert_eq!(unsafe { na_render(a, l.as_mut_ptr(), r.as_mut_ptr(), 256) }, 0);
        all.extend_from_slice(&l);
        unsafe { na_collect(a) };
    }
    all
}

#[test]
fn the_app_builds_a_canvas_plays_it_saves_and_loads_it() {
    let kinds: serde_json::Value = serde_json::from_str(&text(|b, c| unsafe { na_kinds(b, c) })).unwrap();
    let wave_kind = kinds.as_array().unwrap().iter().find(|k| k["id"] == "wave").unwrap();
    assert_eq!((wave_kind["width"].as_u64(), wave_kind["height"].as_u64()), (Some(1900), Some(1080)));
    let kind = CString::new("wave").unwrap();
    let controls: serde_json::Value = serde_json::from_str(&text(|b, c| unsafe { na_controls(kind.as_ptr(), b, c) })).unwrap();
    assert_eq!(controls.as_array().unwrap().len(), 125 + 27);

    unsafe {
        let a = na_new(48_000.0, 4096);
        assert!(!a.is_null());
        let (mi, wa, ou) = (CString::new("midi-in").unwrap(), CString::new("wave").unwrap(), CString::new("output").unwrap());
        let midi = na_add(a, mi.as_ptr(), 0.0, 0.0);
        let wave = na_add(a, wa.as_ptr(), 300.0, 0.0);
        let out = na_add(a, ou.as_ptr(), 1800.0, 0.0);
        assert!(midi > 0 && wave > 0 && out > 0);
        let nope = CString::new("nothing").unwrap();
        assert_eq!(na_add(a, nope.as_ptr(), 0.0, 0.0), -10);
        assert_eq!(na_connect(a, midi as u32, 0, wave as u32, 0), 0);
        assert_eq!(na_connect(a, wave as u32, 0, out as u32, 0), 0);
        assert_eq!(na_connect(a, midi as u32, 0, out as u32, 1), -4, "notes into audio is refused");
        na_settle(a);
        assert_eq!(na_note(a, wave as u32, 1, 60, 0.8), 0);
        let heard = render(a, 8_192);
        assert!(heard.iter().any(|x| x.abs() > 0.01), "the keyboard plays Wave");
        assert_eq!(na_note(a, wave as u32, 0, 60, 0.0), 0);
        assert_eq!(na_set(a, wave as u32, 1, 0.75), 0);
        assert_eq!(na_set(a, wave as u32, 9999, 0.75), -16);

        let saved = text(|b, c| na_save(a, b, c));
        let b = na_new(48_000.0, 4096);
        let file = CString::new(saved.clone()).unwrap();
        assert_eq!(na_load(b, file.as_ptr()), 0);
        assert_eq!(text(|bf, c| na_save(b, bf, c)), saved);
        let described: serde_json::Value = serde_json::from_str(&text(|bf, c| na_describe(b, bf, c))).unwrap();
        let w = described["modules"].as_array().unwrap().iter().find(|m| m["kind"] == "wave").unwrap();
        assert_eq!(w["values"][1].as_f64(), Some(0.75));

        let junk = CString::new("{\"format\": 1}").unwrap();
        assert_eq!(na_load(b, junk.as_ptr()), -17);
        assert!(text(|bf, c| na_error(b, bf, c)).contains("not an idMLab patch"));
        assert_eq!(text(|bf, c| na_save(b, bf, c)), saved, "a bad file changes nothing");

        let midi_msg = [0x90u8, 64, 100];
        assert_eq!(na_midi(b, midi as u32, midi_msg.as_ptr(), 3), 0);
        na_settle(b);
        assert!(render(b, 8_192).iter().any(|x| x.abs() > 0.01), "MIDI in plays Wave");
        assert_eq!(na_bad_blocks(b), 0);
        na_free(a);
        na_free(b);
    }
}
