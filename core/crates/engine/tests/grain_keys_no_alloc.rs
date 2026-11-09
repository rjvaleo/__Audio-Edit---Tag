//! The keys' half of the callback never allocates or frees: notes, AMP, Glide,
//! a restart, and a module's footer moved while it plays. A counting allocator
//! wraps the system one; everything is built and warmed up first, then counting
//! is switched on. One test in this file, so no other test thread allocates
//! while it counts.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use engine::{Core, GrainKeys, KeyMode, Shared, Source};
use fx::grain::{Grain, StreamParams};

struct Counting;

static COUNTING: AtomicBool = AtomicBool::new(false);
static ALLOCS: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if COUNTING.load(Ordering::Relaxed) {
            ALLOCS.fetch_add(1, Ordering::Relaxed);
        }
        System.alloc(layout)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        if COUNTING.load(Ordering::Relaxed) {
            ALLOCS.fetch_add(1, Ordering::Relaxed);
        }
        System.dealloc(ptr, layout)
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new: usize) -> *mut u8 {
        if COUNTING.load(Ordering::Relaxed) {
            ALLOCS.fetch_add(1, Ordering::Relaxed);
        }
        System.realloc(ptr, layout, new)
    }
}

#[global_allocator]
static GLOBAL: Counting = Counting;

const SR: u32 = 48_000;
const BLOCK: usize = 512;

#[test]
fn playing_the_keys_does_not_allocate() {
    let frames = 96_000;
    let src = Arc::new(Source { samples: (0..frames).map(|i| (i as f32 * 0.02).sin() * 0.5).collect(), channels: 1 });
    let sp = StreamParams {
        in_frames: frames,
        sample_rate: SR,
        ratio: 1.0,
        semitones: 0.0,
        // Short grains, so the warm-up below reaches the grain report's bound.
        window_ms: 5.0,
        grain: Grain::default(),
        algorithm: fx::stretch::Algorithm::Granular,
        wsola: fx::stretch::WsolaParams::default(),
        vocoder: fx::stretch::VocoderParams::default(),
        pvsola: fx::pvsola::PvsolaParams::default(),
        hybrid: fx::hybrid::HybridParams::default(),
        cloud: false,
        cloud_mix: 0.5,
    };
    let shared = Shared::new(sp, Arc::clone(&src));
    let keys = Arc::new(GrainKeys::new());
    keys.set_run(false);
    keys.set_amp(0.005, 0.01, 0.8, 0.02);
    keys.set_glide(0.05);
    let mut core = Core::new(BLOCK, 1, sp, Arc::clone(&src)).with_keys(Arc::clone(&keys));

    let mut rack = fx::Rack::new();
    rack.push(Box::new(fx::Gain { db: -3.0 }));
    rack.slots[0].set_mix(0.5, -3.0);
    rack.reserve_mix(BLOCK);
    shared.set_rack(Some(rack));

    let mut buf = vec![0f32; BLOCK];
    let warm = |core: &mut Core, buf: &mut [f32], n: usize| {
        for _ in 0..n {
            core.fill(buf, 1, &shared);
        }
    };
    // Long enough for `report` to have filled and cleared the grain list it
    // keeps for the page, which grows until then and has nothing to do with keys.
    keys.note_on(60, 0.8);
    warm(&mut core, &mut buf, 1500);
    keys.note_off(60);
    warm(&mut core, &mut buf, 40);

    shared.set_manual_param(0, fx::SLOT_WET, 0.25);
    warm(&mut core, &mut buf, 1);

    COUNTING.store(true, Ordering::Relaxed);
    for round in 0..8u8 {
        keys.set_mode(if round % 2 == 0 { KeyMode::Mono } else { KeyMode::Legato });
        keys.note_on(60 + round, 0.8);
        keys.note_on(64 + round, 0.6);
        warm(&mut core, &mut buf, 12);
        keys.set_bend(round as f32 * 0.1);
        keys.note_off(60 + round);
        warm(&mut core, &mut buf, 4);
        keys.note_off(64 + round);
        warm(&mut core, &mut buf, 12);
    }
    COUNTING.store(false, Ordering::Relaxed);

    assert_eq!(ALLOCS.load(Ordering::Relaxed), 0, "the callback allocated");

    // Poly: voices come and go, a note is let go, one is stolen.
    for alg in [
        fx::stretch::Algorithm::Granular,
        fx::stretch::Algorithm::Wsola,
        fx::stretch::Algorithm::Vocoder,
        fx::stretch::Algorithm::Pvsola,
        fx::stretch::Algorithm::Hybrid,
    ] {
        let sp = StreamParams { algorithm: alg, ..sp };
        let shared = Shared::new(sp, Arc::clone(&src));
        if alg == fx::stretch::Algorithm::Hybrid {
            shared.set_parts(Arc::new(fx::hstream::Parts::separate(&src.samples, 1, sp.hybrid)));
        }
        let keys = Arc::new(GrainKeys::new());
        keys.set_run(false);
        keys.set_mode(KeyMode::Poly);
        keys.set_amp(0.005, 0.01, 0.8, 0.02);
        engine::voices::stock(&shared, 8, BLOCK, 1);
        let mut core = Core::new(BLOCK, 1, sp, Arc::clone(&src)).with_keys(Arc::clone(&keys));
        // Warm up: the grain report's list grows until it has filled once, and a
        // seam and the page's read-back have each happened at least once.
        keys.note_on(60, 0.8);
        keys.note_on(64, 0.8);
        for _ in 0..1600 {
            core.fill(&mut buf, 1, &shared);
        }
        keys.all_off();
        for _ in 0..400 {
            core.fill(&mut buf, 1, &shared);
        }
        shared.voices.set_ceiling(2);
        ALLOCS.store(0, Ordering::Relaxed);
        COUNTING.store(true, Ordering::Relaxed);
        for round in 0..6u8 {
            keys.note_on(60 + round, 0.8);
            keys.note_on(64 + round, 0.6);
            for _ in 0..8 {
                core.fill(&mut buf, 1, &shared);
            }
            keys.note_on(67 + round, 0.7);
            for _ in 0..8 {
                core.fill(&mut buf, 1, &shared);
            }
            keys.note_off(60 + round);
            keys.note_off(64 + round);
            keys.note_off(67 + round);
            for _ in 0..12 {
                core.fill(&mut buf, 1, &shared);
            }
        }
        COUNTING.store(false, Ordering::Relaxed);
        assert_eq!(ALLOCS.load(Ordering::Relaxed), 0, "{alg:?}: the callback allocated with voices running");
    }
}
