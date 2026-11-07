//! The synth deck's half of the callback never allocates or frees: a patch
//! handed over, a table swapped, live knobs, notes and telemetry, through
//! `Decks::fill` as the device calls it. A counting allocator wraps the system
//! one; everything is built first, then counting is switched on. One test in
//! this file, so no other test thread allocates while it counts.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use engine::{Core, Decks, Shared, Source, SynthDeck, WaveEvent, WaveShared};
use fx::grain::{Grain, StreamParams};
use wave::{builtin_frames, param_id, Patch, PatchState, Wavetable};

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
const CH: usize = 2;
const BLOCK: usize = 512;

fn params() -> StreamParams {
    StreamParams {
        in_frames: 0,
        sample_rate: SR,
        ratio: 1.0,
        semitones: 0.0,
        window_ms: 40.0,
        grain: Grain::default(),
        algorithm: fx::stretch::Algorithm::Granular,
        wsola: fx::stretch::WsolaParams::default(),
        vocoder: fx::stretch::VocoderParams::default(),
        pvsola: fx::pvsola::PvsolaParams::default(),
        hybrid: fx::hybrid::HybridParams::default(),
        cloud: false,
        cloud_mix: 0.5,
    }
}

#[test]
fn a_patch_handoff_and_a_table_swap_do_not_allocate_in_the_callback() {
    let silent = Arc::new(Source { samples: Vec::new(), channels: CH });
    let wave = Arc::new(WaveShared::new());
    let t = |name: &str| Arc::new(Wavetable::from_frames(&builtin_frames(name).unwrap()));
    wave.set_table(0, t("Formant Sweep"));
    let mut decks = Decks::new(
        Core::new(BLOCK, CH, params(), Arc::clone(&silent)),
        Core::new(BLOCK, CH, params(), Arc::clone(&silent)),
        BLOCK,
        CH,
    )
    .with_synth(SynthDeck::new(SR as f32, BLOCK, CH, Arc::clone(&wave)));
    let main = Arc::new(Shared::new(params(), Arc::clone(&silent)));
    let prism = Arc::new(Shared::new(params(), silent));
    main.start_capture(CH, SR, 2.0);

    // Built here, on the "server's" side.
    let mut patch = Patch::default();
    patch.set_str("voice.mode", "mono");
    // Every unit of the master chain in, so the callback runs all five.
    for i in 0..5 {
        patch.set_num(&format!("fx{i}.on"), 1.0);
    }
    let mono = PatchState::new(&patch);
    let swaps = [t("Grit Saw"), t("Glass Organ")];
    let cut = param_id("filt0.cut").unwrap();
    let fx_knobs: Vec<_> = ["fx0.k0", "fx1.k0", "fx2.k0", "fx3.k0", "fx4.k0"].iter().map(|k| param_id(k).unwrap()).collect();
    let fx_on: Vec<_> = (0..5).map(|i| param_id(&format!("fx{i}.on")).unwrap()).collect();
    let mut buf = vec![0f32; BLOCK * CH];
    // Warm up, so anything built on a first call is built before counting.
    for _ in 0..4 {
        decks.fill(&mut buf, CH, &main, &prism);
    }

    // The writers' calls are made with counting off: `set_patch` and
    // `set_table` run on a request thread, which may allocate. Only the
    // callback is counted.
    let mut callback = |decks: &mut Decks, buf: &mut [f32]| {
        COUNTING.store(true, Ordering::SeqCst);
        decks.fill(buf, CH, &main, &prism);
        COUNTING.store(false, Ordering::SeqCst);
    };

    wave.push(WaveEvent::NoteOn { note: 60, vel: 0.8 });
    wave.push(WaveEvent::NoteOn { note: 64, vel: 0.8 });
    callback(&mut decks, &mut buf);
    wave.set_patch(mono);
    callback(&mut decks, &mut buf);
    for (osc, table) in swaps.iter().enumerate() {
        wave.set_table(osc, Arc::clone(table));
        callback(&mut decks, &mut buf);
    }
    // The replaced table is parked in the return slot, not freed. A second
    // swap on the same oscillator waits for it to be collected.
    wave.set_table(0, Arc::clone(&swaps[1]));
    for i in 0..20u8 {
        wave.set_live(cut, i as f32 / 20.0);
        for id in &fx_knobs {
            wave.set_live(*id, i as f32 / 20.0);
        }
        // Out for a block (past its 10 ms fade), then back in, which clears
        // its lines in the callback.
        for id in &fx_on {
            wave.set_live(*id, if i % 4 == 1 { 0.0 } else { 1.0 });
        }
        wave.push(WaveEvent::Bend(0.3));
        wave.push(WaveEvent::ModWheel(0.5));
        wave.push(WaveEvent::Aftertouch(0.2));
        if i % 5 == 0 {
            wave.push(WaveEvent::NoteOn { note: 50 + i, vel: 0.6 });
        }
        callback(&mut decks, &mut buf);
    }
    wave.push(WaveEvent::AllNotesOff);
    callback(&mut decks, &mut buf);
    let n = ALLOCS.load(Ordering::SeqCst);
    assert_eq!(n, 0, "the callback allocated or freed {n} times");
    assert!(buf.iter().any(|v| *v != 0.0), "and it was making sound");
}
