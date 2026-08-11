//! The audio callback must not allocate. Proven, not promised.
//!
//! Every streaming engine here claims to allocate nothing once built. That
//! claim is the difference between playback and a dropout, it is invisible in
//! review, and it is the kind of thing a single `vec![]` added in a hurry
//! quietly breaks. So it is measured: a counting allocator wraps the system
//! one, and the count is read either side of a render.
//!
//! The count is global and every test in this binary shares it, so there is
//! exactly one test here. Two would race each other's measurements and the
//! result would depend on how many threads cargo happened to use — a test that
//! passes or fails for reasons unrelated to what it is testing.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

struct Counting;

static ALLOCS: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::Relaxed);
        System.alloc(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        System.dealloc(p, l)
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::Relaxed);
        System.realloc(p, l, n)
    }
}

#[global_allocator]
static A: Counting = Counting;

use fx::stream::{StretchParams, Streamer, WsolaStream};
use fx::stretch::Stretch;
use fx::pstream::PvsolaStream;
use fx::vstream::VocoderStream;

const RATE: u32 = 44_100;

fn source(channels: usize) -> Vec<f32> {
    let n = RATE as usize / 2;
    let mut seed = 7u32;
    let mut v = Vec::with_capacity(n * channels);
    for i in 0..n {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        let noise = ((seed >> 16) as f32 / 32768.0) - 1.0;
        let s = 0.3 * (std::f32::consts::TAU * 220.0 * i as f32 / RATE as f32).sin() + noise * 0.1;
        for _ in 0..channels {
            v.push(s);
        }
    }
    v
}

#[test]
fn the_streaming_engines_never_allocate_once_they_are_built() {
    steady_state();
    controls_moving();
    the_vocoder();
    pvsola();
}

/// PVSOLA holds two whole vocoder runs and a round of output between them, so
/// it is the one with the most to get wrong.
fn pvsola() {
    let channels = 2;
    let src = source(channels);
    let in_frames = src.len() / channels;
    let spec = Stretch { ratio: 3.0, ..Default::default() };
    let mut p = StretchParams {
        ratio: spec.ratio,
        window_ms: spec.window_ms,
        sample_rate: RATE,
        wsola: spec.wsola,
        vocoder: spec.vocoder,
        grain: spec.grain,
    };
    let mut pv = spec.pvsola;

    let block = 512;
    let mut s = PvsolaStream::new(block, channels);
    s.seek(0, in_frames, &p, &pv);
    let mut out = vec![0f32; block * channels];

    for w in [23.0f32, 46.0, 92.0] {
        p.vocoder.window_ms = w;
        s.render(&mut out, channels, &src, &p, &pv);
    }

    let before = ALLOCS.load(Ordering::Relaxed);
    for i in 0..120 {
        p.ratio = 1.0 + (i % 6) as f32;
        p.vocoder.window_ms = [23.0f32, 46.0, 92.0][i % 3];
        pv.anchor_frames = 1 + (i % 40) as u32;
        pv.search_ms = (i % 5) as f32 * 40.0;
        pv.blend = (i % 4) as f32 / 3.0;
        s.render(&mut out, channels, &src, &p, &pv);
    }
    let after = ALLOCS.load(Ordering::Relaxed);
    assert_eq!(
        after, before,
        "the streaming PVSOLA allocated {} times across 120 blocks",
        after - before
    );
}

/// The vocoder holds more state than WSOLA — a phase history per bin per
/// channel, a window, a normalisation floor — and every one of them is a thing
/// that could be rebuilt in the callback if it were sized from the current
/// settings instead of the widest ones.
fn the_vocoder() {
    let channels = 2;
    let src = source(channels);
    let in_frames = src.len() / channels;
    let spec = Stretch { ratio: 3.0, ..Default::default() };
    let mut p = StretchParams {
        ratio: spec.ratio,
        window_ms: spec.window_ms,
        sample_rate: RATE,
        wsola: spec.wsola,
        vocoder: spec.vocoder,
        grain: spec.grain,
    };

    let block = 512;
    let mut s = VocoderStream::new(block, channels);
    s.seek(0, in_frames, &p);
    let mut out = vec![0f32; block * channels];

    // Warm every transform size and window shape this test will ask for; each
    // is one deliberate allocation, and they happen before any audio is wanted.
    for w in [12.0f32, 23.0, 46.0, 92.0] {
        p.vocoder.window_ms = w;
        for env in [0.0f32, 0.5, 1.0] {
            p.grain.envelope = env;
            for ov in [2.0f32, 4.0] {
                p.grain.overlap = ov;
                s.render(&mut out, channels, &src, &p);
            }
        }
    }

    let before = ALLOCS.load(Ordering::Relaxed);
    for i in 0..150 {
        p.ratio = 1.0 + (i % 8) as f32;
        p.vocoder.window_ms = [12.0f32, 23.0, 46.0, 92.0][i % 4];
        p.grain.envelope = [0.0f32, 0.5, 1.0][i % 3];
        p.grain.overlap = if i % 2 == 0 { 2.0 } else { 4.0 };
        p.vocoder.stereo_link = i % 5 == 0;
        p.vocoder.phase_lock = i % 3 != 0;
        s.render(&mut out, channels, &src, &p);
    }
    let after = ALLOCS.load(Ordering::Relaxed);
    assert_eq!(
        after, before,
        "the streaming vocoder allocated {} times across 150 blocks",
        after - before
    );
}

/// Rendering block after block with nothing changing.
fn steady_state() {
    let channels = 2;
    let src = source(channels);
    let in_frames = src.len() / channels;
    let spec = Stretch { ratio: 3.0, ..Default::default() };
    let p = StretchParams {
        ratio: spec.ratio,
        window_ms: spec.window_ms,
        sample_rate: RATE,
        wsola: spec.wsola,
        vocoder: spec.vocoder,
        grain: spec.grain,
    };

    let block = 512;
    let mut s = WsolaStream::new(block, channels, RATE);
    s.set_map(WsolaStream::build_map(&src, channels, RATE, spec.ratio, 512, &spec.wsola));
    s.seek(0, in_frames, &p);
    let mut out = vec![0f32; block * channels];

    // One render first: the window table is built lazily on the first block,
    // which is a deliberate allocation and happens before any audio is wanted.
    s.render(&mut out, channels, &src, &p);

    let before = ALLOCS.load(Ordering::Relaxed);
    for _ in 0..200 {
        s.render(&mut out, channels, &src, &p);
    }
    let after = ALLOCS.load(Ordering::Relaxed);
    assert_eq!(
        after, before,
        "the streaming engine allocated {} times across 200 blocks",
        after - before
    );
}

/// And with the controls moving every block, which is the whole reason the
/// buffers are sized from the widest settings the controls allow rather than
/// from the current ones.
fn controls_moving() {
    let channels = 2;
    let src = source(channels);
    let in_frames = src.len() / channels;
    let spec = Stretch { ratio: 2.0, ..Default::default() };
    let mut p = StretchParams {
        ratio: spec.ratio,
        window_ms: spec.window_ms,
        sample_rate: RATE,
        wsola: spec.wsola,
        vocoder: spec.vocoder,
        grain: spec.grain,
    };

    let block = 512;
    let mut s = WsolaStream::new(block, channels, RATE);
    s.set_map(WsolaStream::build_map(&src, channels, RATE, spec.ratio, 512, &spec.wsola));
    s.seek(0, in_frames, &p);
    let mut out = vec![0f32; block * channels];

    // Warm every window length this test will ask for, since the table is built
    // on demand and each new length is one allocation.
    for w in [20.0f32, 40.0, 80.0, 160.0] {
        p.window_ms = w;
        s.render(&mut out, channels, &src, &p);
    }

    let before = ALLOCS.load(Ordering::Relaxed);
    for i in 0..120 {
        p.ratio = 1.0 + (i % 8) as f32;
        p.window_ms = [20.0f32, 40.0, 80.0, 160.0][i % 4];
        p.grain.overlap = 1.0 + (i % 4) as f32;
        p.grain.density_hz = if i % 3 == 0 { 0.0 } else { 40.0 };
        s.render(&mut out, channels, &src, &p);
    }
    let after = ALLOCS.load(Ordering::Relaxed);
    assert_eq!(
        after, before,
        "moving the controls allocated {} times across 120 blocks",
        after - before
    );
}
