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

// ─── THE BOARD ──────────────────────────────────────────────────────────────
//
// Atmosphere's effects as Wave's board (RJ, 17 Nov 2026: "Put Atmosphere's FX
// on the board"): the same graph of nodes and cables, run by the same engine
// (`wave::BoardPlan`, which the Wave page's master bus runs), here on
// Atmosphere's voice, its `in:voice`; its sends are silent. With a board laid
// the worklet runs it instead of the chain.
//
// A board arrives as plain text in [`bd_text`], one line each:
//   `N <id> <kind> <on 0|1>` a node, then `P <key> <value>` for its controls;
//   `C <from> <fromPort> <to> <toPort>` a cable.

struct BoardState {
    plan: Option<wave::BoardPlan>,
    kinds: Vec<String>,
    text: Vec<u8>,
    l: Vec<f32>,
    r: Vec<f32>,
}

static mut BOARD: Option<BoardState> = None;

#[allow(static_mut_refs)]
fn bd() -> &'static mut BoardState {
    unsafe {
        BOARD.get_or_insert_with(|| BoardState { plan: None, kinds: Vec::new(), text: vec![0; 65_536], l: vec![0.0; MAX_FRAMES], r: vec![0.0; MAX_FRAMES] })
    }
}

/// A board from its text form (see above).
pub fn parse_board(src: &str) -> wave::Board {
    let mut b = wave::Board { name: "Atmosphere".into(), ..Default::default() };
    for line in src.lines() {
        let w: Vec<&str> = line.split_whitespace().collect();
        match w.as_slice() {
            ["N", id, kind, on] => b.nodes.push(wave::Node::new(id, kind, 0.0, 0.0).switched(*on != "0")),
            ["P", key, v] => {
                if let (Some(n), Ok(v)) = (b.nodes.last_mut(), v.parse::<f32>()) {
                    n.params.retain(|(k, _)| k != key);
                    n.params.push(((*key).into(), v));
                }
            }
            ["C", a, ap, z, zp] => b.cables.push(wave::Cable::new(a, ap, z, zp)),
            _ => {}
        }
    }
    b
}

/// Where a board's text, or a key, is written.
#[no_mangle]
pub extern "C" fn bd_text() -> *mut u8 {
    bd().text.as_mut_ptr()
}

fn bd_str(len: usize) -> String {
    let b = bd();
    String::from_utf8_lossy(&b.text[..len.min(b.text.len())]).into_owned()
}

/// Lay the board in the first `len` bytes of [`bd_text`]: its node count, or
/// −1 if it was refused (a loop, a stranded port), the last board kept then.
#[no_mangle]
pub extern "C" fn bd_load(len: usize) -> i32 {
    let board = parse_board(&bd_str(len));
    let sr = st().sr as f32;
    match wave::BoardPlan::compile(&board, sr) {
        Ok(plan) => {
            let b = bd();
            b.kinds = board.nodes.iter().map(|n| n.kind.clone()).collect();
            b.plan = Some(plan);
            board.nodes.len() as i32
        }
        Err(_) => -1,
    }
}

/// No board: the chain, if any, again.
#[no_mangle]
pub extern "C" fn bd_clear() {
    let b = bd();
    b.plan = None;
    b.kinds.clear();
}

/// Is a board laid?
#[no_mangle]
pub extern "C" fn bd_active() -> u32 {
    bd().plan.is_some() as u32
}

/// One control of node `node`, by the key in the first `len` bytes of [`bd_text`].
#[no_mangle]
pub extern "C" fn bd_set(node: usize, len: usize, value: f32) -> u32 {
    let key = bd_str(len);
    let b = bd();
    let Some(kind) = b.kinds.get(node).and_then(|k| wave::board::Kind::parse(k)) else { return 0 };
    let Some(i) = kind.params().iter().position(|p| p.key == key) else { return 0 };
    b.plan.as_mut().is_some_and(|p| p.set_param(node, i, value)) as u32
}

/// A node on or off.
#[no_mangle]
pub extern "C" fn bd_on(node: usize, on: u32) -> u32 {
    bd().plan.as_mut().is_some_and(|p| p.set_on(node, on != 0)) as u32
}

/// Run `frames` frames of [`fx_buf`] through the board, in place.
#[no_mangle]
pub extern "C" fn bd_process(frames: usize) {
    let n = frames.min(MAX_FRAMES);
    let s = st();
    let b = bd();
    let Some(plan) = b.plan.as_mut() else { return };
    for i in 0..n {
        b.l[i] = s.buf[2 * i];
        b.r[i] = s.buf[2 * i + 1];
    }
    plan.process(&mut b.l[..n], &mut b.r[..n]);
    for i in 0..n {
        s.buf[2 * i] = b.l[i];
        s.buf[2 * i + 1] = b.r[i];
    }
}

/// How hard node `node` is driven now, 0–1 (its output's peak), for the cables.
#[no_mangle]
pub extern "C" fn bd_peak(node: usize) -> f32 {
    let b = bd();
    let Some(plan) = b.plan.as_ref() else { return 0.0 };
    let mut pk = vec![[0.0f32; 2]; plan.node_count()];
    plan.peaks(&mut pk);
    pk.get(node).map(|p| p[0].max(p[1])).unwrap_or(0.0)
}

#[cfg(test)]
fn prism_suites() -> &'static [Suite] {
    fx::prism::prism_fx::suite::SUITES
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_board_runs_atmosphere_through_its_effects() {
        fx_init(48_000);
        let src = "N invoice in:voice 1\nN g gain 1\nP db -6\nN out out 1\nC invoice o g i\nC g o out i\n";
        assert_eq!(parse_board(src).nodes.len(), 3);
        let b = bd();
        b.text[..src.len()].copy_from_slice(src.as_bytes());
        assert_eq!(bd_load(src.len()), 3);
        let s = st();
        for i in 0..256 { s.buf[2 * i] = 0.5; s.buf[2 * i + 1] = 0.5; }
        for _ in 0..40 { for i in 0..256 { s.buf[2 * i] = 0.5; s.buf[2 * i + 1] = 0.5; } bd_process(128); }
        let got = s.buf[0];
        assert!((got - 0.5 * 10f32.powf(-6.0 / 20.0)).abs() < 0.02, "{got}");
        // A loop is refused, and the board before it kept.
        let bad = "N invoice in:voice 1\nN g gain 1\nN out out 1\nC invoice o g i\nC g o g i\nC g o out i\n";
        b.text[..bad.len()].copy_from_slice(bad.as_bytes());
        assert_eq!(bd_load(bad.len()), -1);
        assert_eq!(bd_active(), 1);
        // A control by key.
        let k = "db";
        b.text[..k.len()].copy_from_slice(k.as_bytes());
        assert_eq!(bd_set(1, k.len(), 0.0), 1);
    }

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
