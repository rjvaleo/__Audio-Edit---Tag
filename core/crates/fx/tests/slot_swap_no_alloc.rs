//! A slot swap neither allocates nor frees on the audio thread (SUITE-PLAN
//! §2.0). The new effect is built before `swap_slot`; from there through the
//! fade to landing nothing allocates, and the old effect is not dropped until
//! `take_retired` hands it to whoever runs off the audio thread. Its own
//! binary, so the counting allocator sees only this test.

use fx::{prism, swap_fade_frames, Rack};
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

struct Counting;
static ALLOCS: AtomicUsize = AtomicUsize::new(0);
static FREES: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::SeqCst);
        System.alloc(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        FREES.fetch_add(1, Ordering::SeqCst);
        System.dealloc(p, l)
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::SeqCst);
        System.realloc(p, l, n)
    }
}

#[global_allocator]
static GLOBAL: Counting = Counting;

#[test]
fn a_slot_swap_neither_allocates_nor_frees_on_the_audio_thread() {
    const SR: u32 = 48_000;
    let mut rack = Rack::new();
    rack.push(prism::make("echo", SR, 2, &[]).unwrap());
    rack.push(prism::make("dattorro-plate", SR, 2, &[]).unwrap());
    rack.reserve_mix(512 * 2);
    let mut buf = vec![0.1f32; 512 * 2];
    for _ in 0..8 {
        rack.process(&mut buf, 2, SR);
    }
    let next = prism::make("schroeder-reverb", SR, 2, &[]).unwrap();
    let (a, f) = (ALLOCS.load(Ordering::SeqCst), FREES.load(Ordering::SeqCst));
    rack.swap_slot(1, next, swap_fade_frames(SR)).ok().unwrap();
    for _ in 0..8 {
        rack.process(&mut buf, 2, SR);
    }
    assert!(!rack.swapping(1));
    assert_eq!(ALLOCS.load(Ordering::SeqCst) - a, 0, "allocated on the audio thread");
    assert_eq!(FREES.load(Ordering::SeqCst) - f, 0, "freed on the audio thread");
    // Off the audio thread, the old plate goes.
    drop(rack.take_retired().unwrap());
}
