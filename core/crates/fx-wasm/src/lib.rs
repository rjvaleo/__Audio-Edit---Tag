//! The effect rack in the browser: Atmosphere's own effects (RJ, 16 Nov 2026:
//! "I want to be able to add all the effects like I can on the grain page").
//!
//! Atmosphere is the sequencer page's synth and makes its sound in the
//! browser, so its effects run there too, in an AudioWorklet
//! (`ui/sequencer/atfx-worklet.js`), with no lead and no round trip to the
//! engine: its keys stay as quick as they were. The effects are the very ones
//! the engine runs — this is the `fx` crate's `Rack`, built for wasm32 — so a
//! mode sounds here as it does on the Grain page.
//!
//! The interface is a handful of C functions over one interleaved stereo
//! buffer: the worklet writes a block into [`fx_buf`], calls [`fx_process`],
//! and reads it back. A chain is laid with [`fx_clear`] and [`fx_push`] (by the
//! kind the app's suites name: `prism:…`, a shaper's name, `eq`, `comp`), and
//! its controls are set by key with [`fx_set`], the keys `/api/fx` lists.

use fx::{Effect, Rack};
#[cfg(test)]
use fx::suite::Suite;

const CHANNELS: usize = 2;
/// The longest block the worklet hands over, in frames (it sends 128).
const MAX_FRAMES: usize = 4096;

struct State {
    rack: Rack,
    sr: u32,
    buf: Vec<f32>,
    text: Vec<u8>,
}

static mut STATE: Option<State> = None;

#[allow(static_mut_refs)]
fn st() -> &'static mut State {
    // One thread: the AudioWorklet's. Everything is called from it.
    unsafe {
        STATE.get_or_insert_with(|| State {
            rack: Rack::new(),
            sr: 48_000,
            buf: vec![0.0; MAX_FRAMES * CHANNELS],
            text: vec![0; 256],
        })
    }
}

/// The effect a kind names, as the server's rack makes it for a slot.
pub fn make(kind: &str, sr: u32) -> Option<Box<dyn Effect>> {
    match kind {
        "gain" => fx::prism::moved("gain", sr, &[]),
        "eq" => fx::prism::moved("eq", sr, &[]),
        "comp" => fx::prism::moved("compressor", sr, &[]),
        k => {
            if let Some(id) = fx::prism::id_for_kind(k) {
                fx::prism::make(id, sr, CHANNELS, &[])
            } else {
                fx::shape::ShapeKind::from_str(k).map(|s| fx::shape::make(s, sr, CHANNELS, &[]))
            }
        }
    }
}

fn text(len: usize) -> &'static str {
    let s = st();
    std::str::from_utf8(&s.text[..len.min(s.text.len())]).unwrap_or("")
}

/// Start again at this sample rate, with an empty chain.
#[no_mangle]
pub extern "C" fn fx_init(sr: u32) {
    let s = st();
    s.sr = sr;
    s.rack = Rack::new();
    s.rack.mute_meters();
}

/// Where the worklet writes a block (interleaved L R), and reads it back.
#[no_mangle]
pub extern "C" fn fx_buf() -> *mut f32 {
    st().buf.as_mut_ptr()
}

/// Where a kind or a key is written before a call that takes one.
#[no_mangle]
pub extern "C" fn fx_text() -> *mut u8 {
    st().text.as_mut_ptr()
}

/// No effects.
#[no_mangle]
pub extern "C" fn fx_clear() {
    let s = st();
    s.rack = Rack::new();
    s.rack.mute_meters();
}

/// Add the effect whose kind is the first `len` bytes of [`fx_text`] at the
/// end of the chain. Its slot, or −1 for a kind not known here (it is then
/// left out, as the server leaves out a kind it does not know).
#[no_mangle]
pub extern "C" fn fx_push(len: usize, bypassed: u32) -> i32 {
    let kind = text(len).to_string();
    let s = st();
    match make(&kind, s.sr) {
        Some(e) => {
            s.rack.push_slot(e, bypassed != 0);
            s.rack.slots.len() as i32 - 1
        }
        None => -1,
    }
}

/// One control, by the key in the first `len` bytes of [`fx_text`]
/// (`slot.wet` and `slot.level` are the slot's own Mix and Level).
#[no_mangle]
pub extern "C" fn fx_set(slot: usize, len: usize, value: f32) -> u32 {
    let key = text(len).to_string();
    st().rack.set_param(slot, &key, value) as u32
}

/// A slot on or off.
#[no_mangle]
pub extern "C" fn fx_bypass(slot: usize, off: u32) {
    if let Some(x) = st().rack.slots.get_mut(slot) {
        x.bypassed = off != 0;
    }
}

/// Run `frames` frames of [`fx_buf`] through the chain, in place.
#[no_mangle]
pub extern "C" fn fx_process(frames: usize) {
    let s = st();
    let n = frames.min(MAX_FRAMES) * CHANNELS;
    let sr = s.sr;
    s.rack.process(&mut s.buf[..n], CHANNELS, sr);
}

/// How much the slot's effect is doing now, 0–1, for its module's picture.
#[no_mangle]
pub extern "C" fn fx_telemetry(slot: usize) -> f32 {
    st().rack.slots.get(slot).map(|x| x.effect.telemetry()).unwrap_or(0.0)
}

#[cfg(test)]
fn prism_suites() -> &'static [Suite] {
    fx::prism::prism_fx::suite::SUITES
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_kind_the_suites_name_is_made() {
        let suites: &[Suite] = prism_suites();
        for suite in suites {
            for fam in suite.families {
                for mode in fam.modes {
                    let kind = fx::suite::keeper_kind(mode);
                    assert!(make(&kind, 48_000).is_some(), "{kind}");
                }
            }
        }
    }

    #[test]
    fn a_chain_runs_and_stays_finite() {
        fx_init(48_000);
        for kind in ["prism:sm-gemini", "schroeder_reverb", "comp"] {
            let b = kind.as_bytes();
            unsafe { std::ptr::copy_nonoverlapping(b.as_ptr(), fx_text(), b.len()) };
            assert!(fx_push(b.len(), 0) >= 0, "{kind}");
        }
        let buf = unsafe { std::slice::from_raw_parts_mut(fx_buf(), 256) };
        for (i, x) in buf.iter_mut().enumerate() {
            *x = if i < 2 { 1.0 } else { 0.0 };
        }
        for _ in 0..50 {
            fx_process(128);
        }
        let buf = unsafe { std::slice::from_raw_parts(fx_buf(), 256) };
        assert!(buf.iter().all(|x| x.is_finite()));
    }
}
