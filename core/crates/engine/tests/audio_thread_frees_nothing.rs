//! The callback neither allocates nor frees when what it plays is replaced:
//! a new sound, a new rack, a new bank of layers, a new transient map, and
//! the grain view taking its list of grains. Each of those used to free the
//! thing replaced (a whole file, for a sound) or grow a list, on the audio
//! thread. Now the old thing goes back to be freed by `Shared::collect`,
//! which the voice feeder and the Prism deck's collector thread call.
//!
//! A counting allocator wraps the system one and counts only while a block is
//! being made. One test in this file, so no other test thread is counted.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use engine::stretcher::LayerBank;
use engine::{Core, GrainKeys, Shared, Source};
use fx::grain::{Grain, StreamParams};
use fx::stretch::Algorithm;
use fx::transient::TimeMap;

struct Counting;

static COUNTING: AtomicBool = AtomicBool::new(false);
static COUNTED: AtomicUsize = AtomicUsize::new(0);

/// The sizes of the first few things counted, for whoever has to find them:
/// bytes, negative for a free.
static SIZES: [std::sync::atomic::AtomicIsize; 12] = [const { std::sync::atomic::AtomicIsize::new(0) }; 12];
static SEEN: AtomicUsize = AtomicUsize::new(0);

fn count(bytes: isize) {
    if COUNTING.load(Ordering::Relaxed) {
        COUNTED.fetch_add(1, Ordering::Relaxed);
        if let Some(slot) = SIZES.get(SEEN.fetch_add(1, Ordering::Relaxed)) {
            slot.store(bytes, Ordering::Relaxed);
        }
    }
}

fn sizes() -> Vec<isize> {
    SIZES.iter().take(SEEN.load(Ordering::Relaxed)).map(|size| size.load(Ordering::Relaxed)).collect()
}

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        count(layout.size() as isize);
        System.alloc(layout)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        count(-(layout.size() as isize));
        System.dealloc(ptr, layout)
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new: usize) -> *mut u8 {
        count(new as isize);
        System.realloc(ptr, layout, new)
    }
}

#[global_allocator]
static GLOBAL: Counting = Counting;

const SR: u32 = 48_000;
const BLOCK: usize = 512;
const FILE: usize = 96_000;

fn source(seed: u32) -> Arc<Source> {
    let mut seed = seed;
    let samples = (0..FILE)
        .flat_map(|i| {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let noise = ((seed >> 16) as f32 / 32768.0) - 1.0;
            let s = (i as f32 * 0.02).sin() * 0.4 + noise * 0.05;
            [s, s * 0.8]
        })
        .collect();
    Arc::new(Source { samples, channels: 2 })
}

fn rack(db: f32) -> fx::Rack {
    let mut rack = fx::Rack::new();
    rack.push(Box::new(fx::Gain { db }));
    rack.reserve_mix(BLOCK * 2);
    rack
}

fn bank() -> LayerBank {
    LayerBank::build(Algorithm::Wsola, 3, BLOCK, 2, SR)
}

/// Blocks made, and what the allocator was asked for while they were.
fn blocks(core: &mut Core, shared: &Shared, n: usize) -> usize {
    let mut buf = vec![0f32; BLOCK * 2];
    COUNTED.store(0, Ordering::Relaxed);
    for _ in 0..n {
        COUNTING.store(true, Ordering::Relaxed);
        core.fill(&mut buf, 2, shared);
        COUNTING.store(false, Ordering::Relaxed);
    }
    COUNTED.load(Ordering::Relaxed)
}

#[test]
fn replacing_what_the_deck_plays_costs_the_callback_no_memory() {
    // What the device does as it starts.
    audio_core::fft::prime();
    prism_grain::fft::prime();

    let first = source(7);
    let sp = StreamParams {
        in_frames: FILE,
        sample_rate: SR,
        ratio: 2.0,
        semitones: 0.0,
        // Short grains: plenty for the grain view's list.
        window_ms: 5.0,
        grain: Grain { layers: 3, ..Grain::default() },
        algorithm: Algorithm::Wsola,
        wsola: fx::stretch::WsolaParams::default(),
        vocoder: fx::stretch::VocoderParams::default(),
        pvsola: fx::pvsola::PvsolaParams::default(),
        hybrid: fx::hybrid::HybridParams::default(),
        soundhack: Default::default(),
        cloud: true,
        cloud_mix: 0.5,
    };
    let shared = Shared::new(sp, Arc::clone(&first));
    shared.set_bank(bank());
    shared.set_rack(Some(rack(-3.0)));
    shared.set_map(Some(TimeMap::linear(FILE, 2.0)));
    let keys = Arc::new(GrainKeys::new());
    keys.set_run(true);
    let mut core = Core::new(BLOCK, 2, sp, Arc::clone(&first)).with_keys(Arc::clone(&keys));
    let first_sound = Arc::downgrade(&first);
    drop(first);
    shared.play();

    let mut found: Vec<(&str, usize)> = Vec::new();

    // No warm-up: the first blocks are blocks too. The spectrum and the
    // waveform are first published in them.
    found.push(("the first block", blocks(&mut core, &shared, 1)));
    found.push(("the next seven", blocks(&mut core, &shared, 7)));

    // The grain view polls every 50 ms: here, every third block.
    let mut polled = 0;
    let mut grains = 0;
    for _ in 0..60 {
        polled += blocks(&mut core, &shared, 3);
        grains += shared.drain_events().len();
    }
    assert!(grains > 1000, "the view was handed grains each time: {grains}");
    found.push(("the grain view polling", polled));

    shared.set_source(source(99));
    found.push(("a new sound", blocks(&mut core, &shared, 4)));
    // The old sound is not freed and not leaked: it waits on the list, and
    // whoever collects frees it.
    assert_eq!(first_sound.strong_count(), 1, "the old sound is held once, by the list of things to free");
    shared.collect();
    assert!(first_sound.upgrade().is_none(), "and collect freed it");

    shared.set_rack(Some(rack(-6.0)));
    found.push(("a new rack, faded in", blocks(&mut core, &shared, 8)));

    shared.set_rack(Some(rack(-9.0)));
    let mut twice = blocks(&mut core, &shared, 1);
    shared.set_rack(Some(rack(-12.0)));
    twice += blocks(&mut core, &shared, 8);
    found.push(("a rack replaced again before its fade is over", twice));

    shared.set_rack(None);
    found.push(("the rack taken away", blocks(&mut core, &shared, 8)));

    shared.set_bank(bank());
    found.push(("a new bank of layers", blocks(&mut core, &shared, 4)));

    shared.set_map(Some(TimeMap::linear(FILE, 3.0)));
    let mut maps = blocks(&mut core, &shared, 4);
    shared.set_map(None);
    maps += blocks(&mut core, &shared, 4);
    found.push(("a new map, then none", maps));

    let costly: Vec<String> =
        found.iter().filter(|(_, n)| *n > 0).map(|(what, n)| format!("{what}: {n}")).collect();
    assert!(
        costly.is_empty(),
        "the callback allocated or freed:\n{}\nfirst sizes in bytes (negative: a free): {:?}",
        costly.join("\n"),
        sizes()
    );

    // Everything replaced since (four racks, a bank, two maps) is freed
    // here, by the caller.
    COUNTED.store(0, Ordering::Relaxed);
    COUNTING.store(true, Ordering::Relaxed);
    shared.collect();
    COUNTING.store(false, Ordering::Relaxed);
    assert!(COUNTED.load(Ordering::Relaxed) > 0, "collect frees what came back");
}
