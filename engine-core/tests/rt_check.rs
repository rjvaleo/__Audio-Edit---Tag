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

#[test]
fn handing_things_over_frees_nothing_on_the_audio_thread() {
    let (mut ctl, mut audio) = engine(RATE, exact());
    let freed = std::sync::Arc::new(Freed::default());
    ctl.add(1, Box::new(Holder::default())).unwrap();
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit().unwrap();
    for i in 0..40u64 {
        ctl.give_at(10 + 50 * i, 1, (i % 2) as u32, level(i as f32, &freed)).unwrap();
        ctl.give_at(11 + 50 * i, 99, 0, level(0.0, &freed)).unwrap();
    }
    let before = counted();
    let (l, _) = render(&mut audio, 4_000, 64);
    assert_eq!(counted(), before, "allocations or frees inside a render");
    assert_eq!(l[3_999], 39.0, "the last level handed over is playing");
    assert_eq!(freed.total(), 0);
    assert_eq!(ctl.collect().things, 79, "39 replaced and 40 nobody took");
    assert_eq!(freed.total(), 79);
    assert_eq!(freed.in_audio(), 0);
}

#[test]
fn mixing_and_recording_cost_the_audio_thread_no_memory() {
    use engine_core::basics::{Mix, Record, Sine, Tape};
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Sine::new(440.0, 0.5))).unwrap();
    ctl.add(2, Box::new(Sine::new(660.0, 0.25))).unwrap();
    ctl.add(3, Box::new(Mix::new(2))).unwrap();
    ctl.add(4, Box::new(Record::new())).unwrap();
    ctl.connect(port(1, 0), port(3, 0)).unwrap();
    ctl.connect(port(2, 0), port(3, 1)).unwrap();
    ctl.connect(port(3, 0), port(4, 0)).unwrap();
    ctl.connect_out(port(4, 0)).unwrap();
    ctl.commit().unwrap();
    for i in 0..10u64 {
        ctl.give_at(200 + 700 * i, 4, 0, Box::new(Tape::with_room(400))).unwrap();
        ctl.send_at(300 + 700 * i, 3, EventKind::Param { index: 0, value: 0.1 * i as f32 }).unwrap();
    }
    let before = counted();
    render(&mut audio, 8_000, 64);
    assert_eq!(counted(), before, "allocations or frees inside a render");
    let mut back = Vec::new();
    assert_eq!(ctl.collect_things(&mut back).things, 10);
    assert!(back.iter().all(|thing| thing.downcast_ref::<Tape>().is_some_and(|tape| tape.l.len() == 400)));
}
