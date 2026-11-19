//! Starting every model and overflowing the event queue must use fixed memory.
use atmos::{models::MODELS, Synth};
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
thread_local! {
    static ACTIVE: Cell<bool> = const { Cell::new(false) };
    static COUNT: Cell<usize> = const { Cell::new(0) };
}
struct Counting;
fn count() { if ACTIVE.try_with(|x| x.get()).unwrap_or(false) { COUNT.with(|x| x.set(x.get() + 1)); } }
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 { count(); System.alloc(l) }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) { count(); System.dealloc(p, l) }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 { count(); System.realloc(p, l, n) }
}
#[global_allocator] static ALLOC: Counting = Counting;
#[test]
fn every_models_notes_and_a_full_queue_allocate_nothing() {
    for model in 0..MODELS.len() {
        let mut synth = Synth::new(48_000.0);
        synth.set("a.model", model as f32);
        synth.set("b.model", model as f32);
        synth.set("fit", 1.0);
        let (mut l, mut r) = ([0.0; 128], [0.0; 128]);
        COUNT.with(|x| x.set(0));
        ACTIVE.with(|x| x.set(true));
        for note in 0..100 {
            synth.note_on(note % 20, 110.0 + note as f32, 0.8, 0);
            synth.render(&mut l, &mut r);
            synth.note_off(note % 20, 0);
        }
        for note in 0..100 { synth.note_on(note, 220.0, 0.5, 0); }
        for note in 0..100 { synth.note_off(note, 0); }
        synth.render(&mut l, &mut r);
        ACTIVE.with(|x| x.set(false));
        assert_eq!(COUNT.with(|x| x.get()), 0, "model {model}");
        assert!(l.iter().chain(&r).all(|x| x.is_finite()));
    }
}
