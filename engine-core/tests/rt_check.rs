//! The audio thread must not allocate. This test's allocator counts every
//! allocation and free made on a thread while it is inside a render.
#![cfg(feature = "rt-check")]

mod common;
use common::*;
use engine_core::*;
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

thread_local! {
    static IN_RENDER: Cell<usize> = const { Cell::new(0) };
}

struct Counting;

fn count() {
    if engine_core::rt::in_audio() {
        let _ = IN_RENDER.try_with(|n| n.set(n.get() + 1));
    }
}

#[allow(unsafe_code)]
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        count();
        System.alloc(layout)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        count();
        System.dealloc(ptr, layout)
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

fn counted() -> usize {
    IN_RENDER.with(|n| n.get())
}

#[test]
fn the_audio_thread_never_allocates_or_frees() {
    let live = live_session(counted);
    assert!(peak(&live.l) > 0.05);
    assert!(live.landed.len() >= 300, "the session really ran: {} messages landed", live.landed.len());
    assert!(live.collected.plans >= 3 && live.collected.sounds >= 1, "plans and a sound were swapped");
    assert_eq!(live.probe, 0, "allocations or frees inside a render");
}

/// The check itself: a module that allocates must be caught.
struct Careless;

impl Module for Careless {
    fn inputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn process(&mut self, io: &mut Io) {
        std::hint::black_box(vec![0u8; io.n]);
    }
}

#[test]
fn a_module_that_allocates_is_caught() {
    let (mut ctl, mut audio) = engine(RATE, Config::default());
    ctl.add(1, Box::new(Careless)).unwrap();
    ctl.commit().unwrap();
    let before = counted();
    render(&mut audio, 256, 64);
    assert!(counted() >= before + 8, "four blocks, an allocation and a free each");
}
