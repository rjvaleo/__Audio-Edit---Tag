//! The deck's setters have a second form for a host that delivers changes on
//! its own audio thread: `put_source`, `put_rack`, `put_bank`, `put_parts`
//! and `put_map` leave the new thing for the deck and hand back whatever was
//! still waiting there, freeing nothing, allocating nothing and never
//! waiting for a lock another thread holds.
//!
//! This test calls them as such a host would, with the allocator counting
//! through the calls and through every block, and checks the deck then plays
//! exactly what the ordinary setters make it play.
//!
//! One test in this file, so no other test thread is counted.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use engine::stretcher::LayerBank;
use engine::{Core, GrainKeys, Shared, Source};
use fx::grain::{Grain, StreamParams};
use fx::hstream::Parts;
use fx::stretch::Algorithm;
use fx::transient::TimeMap;

struct Counting;

static COUNTING: AtomicBool = AtomicBool::new(false);
static COUNTED: AtomicUsize = AtomicUsize::new(0);

fn count() {
    if COUNTING.load(Ordering::Relaxed) {
        COUNTED.fetch_add(1, Ordering::Relaxed);
    }
}

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        count();
        System.alloc(layout)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        count();
        System.dealloc(ptr, layout)
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new: usize) -> *mut u8 {
        count();
        System.realloc(ptr, layout, new)
    }
}

#[global_allocator]
static GLOBAL: Counting = Counting;

/// Run `f` as the audio thread would: counted.
fn counted<T>(f: impl FnOnce() -> T) -> T {
    COUNTING.store(true, Ordering::Relaxed);
    let out = f();
    COUNTING.store(false, Ordering::Relaxed);
    out
}

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

/// What is handed to the deck, built before anything is counted.
enum Change {
    Source(Arc<Source>),
    Rack(Option<fx::Rack>),
    Bank(LayerBank),
    Parts(Arc<Parts>),
    Map(Option<TimeMap>),
}

/// The changes, each with how many blocks are played after it. Two racks
/// arrive with no block between them: the first is still waiting when the
/// second comes.
fn script(sp: &StreamParams) -> Vec<(Change, usize)> {
    let second = source(99);
    let parts = Arc::new(Parts::separate(&second.samples, 2, sp.hybrid));
    vec![
        (Change::Source(second), 4),
        (Change::Rack(Some(rack(-6.0))), 8),
        (Change::Rack(Some(rack(-9.0))), 0),
        (Change::Rack(Some(rack(-12.0))), 8),
        (Change::Rack(None), 8),
        (Change::Bank(bank()), 4),
        (Change::Parts(parts), 4),
        (Change::Map(Some(TimeMap::linear(FILE, 3.0))), 4),
        (Change::Map(None), 4),
    ]
}

/// Play the script, handing each change over with the ordinary setter or
/// with its `put` form. Returns the audio and what the allocator was asked
/// for inside the blocks and the puts.
fn play(put: bool) -> (Vec<f32>, usize) {
    audio_core::fft::prime();
    prism_grain::fft::prime();
    let first = source(7);
    let sp = StreamParams {
        in_frames: FILE,
        sample_rate: SR,
        ratio: 2.0,
        semitones: 0.0,
        window_ms: 40.0,
        grain: Grain { layers: 3, ..Grain::default() },
        algorithm: Algorithm::Wsola,
        wsola: fx::stretch::WsolaParams::default(),
        vocoder: fx::stretch::VocoderParams::default(),
        pvsola: fx::pvsola::PvsolaParams::default(),
        hybrid: fx::hybrid::HybridParams::default(),
        soundhack: Default::default(),
        cloud: false,
        cloud_mix: 0.5,
    };
    let shared = Shared::new(sp, Arc::clone(&first));
    shared.set_bank(bank());
    shared.set_rack(Some(rack(-3.0)));
    let keys = Arc::new(GrainKeys::new());
    keys.set_run(true);
    let mut core = Core::new(BLOCK, 2, sp, first).with_keys(keys);
    shared.play();

    let changes = script(&sp);
    let mut out = Vec::with_capacity((8 + 44) * BLOCK * 2);
    let mut buf = vec![0f32; BLOCK * 2];
    // Whatever a put hands back is kept, with room made beforehand, and
    // freed after the counting is over.
    let mut handed_back: Vec<Change> = Vec::with_capacity(2 * changes.len());
    COUNTED.store(0, Ordering::Relaxed);
    let mut blocks = |n: usize, out: &mut Vec<f32>| {
        for _ in 0..n {
            counted(|| core.fill(&mut buf, 2, &shared));
            out.extend_from_slice(&buf);
        }
    };
    blocks(8, &mut out);
    for (change, after) in changes {
        match (change, put) {
            (Change::Source(s), false) => shared.set_source(s),
            (Change::Rack(r), false) => shared.set_rack(r),
            (Change::Bank(b), false) => shared.set_bank(b),
            (Change::Parts(p), false) => shared.set_parts(p),
            (Change::Map(m), false) => shared.set_map(m),
            (Change::Source(s), true) => {
                // Nothing else holds the lock in this test, so it is taken.
                let old = counted(|| shared.put_source(s)).ok().expect("the slot was free");
                handed_back.push(Change::Source(old));
            }
            (Change::Rack(r), true) => {
                if let Some(unclaimed) = counted(|| shared.put_rack(r)) {
                    handed_back.push(Change::Rack(unclaimed));
                }
            }
            (Change::Bank(b), true) => {
                if let Some(unclaimed) = counted(|| shared.put_bank(b)) {
                    handed_back.push(Change::Bank(unclaimed));
                }
            }
            (Change::Parts(p), true) => {
                let old = counted(|| shared.put_parts(p)).ok().expect("the slot was free");
                for held in old.into_iter().flatten() {
                    handed_back.push(Change::Parts(held));
                }
            }
            (Change::Map(m), true) => {
                // The host shares the map before it hands it over.
                let m = m.map(Arc::new);
                let _ = counted(|| shared.put_map(m));
            }
        }
        blocks(after, &mut out);
    }
    let asked = COUNTED.load(Ordering::Relaxed);
    if put {
        let racks = handed_back.iter().filter(|c| matches!(c, Change::Rack(Some(_)))).count();
        assert_eq!(racks, 1, "the rack still waiting when the next one came was handed back");
    }
    drop(handed_back);
    shared.collect();
    (out, asked)
}

#[test]
fn the_put_forms_free_nothing_and_play_the_same() {
    let (want, _) = play(false);
    let (got, asked) = play(true);
    assert!(want.iter().any(|v| v.abs() > 0.01), "the script is heard");
    assert_eq!(asked, 0, "allocations or frees inside the puts and the blocks");
    assert_eq!(want.len(), got.len());
    let first = (0..want.len()).find(|&i| want[i].to_bits() != got[i].to_bits());
    assert_eq!(first, None, "the put forms play what the setters play (first difference at this sample)");
}
