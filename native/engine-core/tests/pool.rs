#![cfg(feature = "rt-check")]
use engine_core::*;
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};
static HEAP: AtomicUsize = AtomicUsize::new(0);
static WORKER_FAULT: AtomicUsize = AtomicUsize::new(0);
static WORKER_HEAP: AtomicUsize = AtomicUsize::new(0);
thread_local! {static WORKER:std::cell::Cell<bool>=const{std::cell::Cell::new(false)};}
struct Counting;
fn count() {
    if rt::in_audio() {
        HEAP.fetch_add(1, Ordering::Relaxed);
        if WORKER.with(|v| v.get()) {
            WORKER_HEAP.fetch_add(1, Ordering::Relaxed);
        }
    }
}
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        count();
        System.alloc(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        count();
        System.dealloc(p, l)
    }
}
#[global_allocator]
static ALLOCATOR: Counting = Counting;
fn worker(_: usize) {
    WORKER.with(|v| v.set(true));
}
struct Osc {
    id: u32,
    at: u64,
    fault: bool,
}
impl Module for Osc {
    fn parallel_weight(&self) -> usize {
        4096
    }
    fn inputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn process(&mut self, io: &mut Io) {
        if self.fault && self.at >= 6400 {
            self.fault = false;
            if WORKER.with(|v| v.get()) {
                WORKER_FAULT.fetch_add(1, Ordering::Relaxed);
            }
            panic!("one module fault");
        }
        let (l, r) = io.outs.audio(0);
        for i in 0..io.n {
            let v = ((self.at + i as u64) as f64 * (0.0003 + self.id as f64 * 0.00001)).sin()
                as f32
                * 0.01;
            l[i] = v;
            r[i] = v;
        }
        self.at += io.n as u64;
    }
    fn rate_state(&self) -> [f64; 8] {
        [self.at as f64, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    }
    fn rehome(&mut self, state: [f64; 8], _: f32) {
        self.at = state[0] as u64;
    }
}
fn run(parallel: bool, fault: bool, blocks: usize, rate_switch: bool) -> (Vec<f32>, usize, usize) {
    let (mut ctl, mut audio) = engine(
        48000.0,
        Config {
            parallel,
            worker_init: Some(worker),
            max_block: 512,
            fade_frames: 0,
            ..Config::default()
        },
    );
    for id in 1..=8 {
        ctl.add_with_factory(
            id,
            Box::new(move |_, _| {
                Box::new(Osc {
                    id,
                    at: 0,
                    fault: fault && id == 1,
                })
            }),
        )
        .unwrap();
        ctl.connect_out(port(id, 0)).unwrap();
    }
    ctl.commit().unwrap();
    let mut output = Vec::with_capacity(blocks * 64);
    let mut l = [0.0; 64];
    let mut r = l;
    let mut failures = 0;
    for block in 0..blocks {
        if rate_switch && block == 20 {
            ctl.set_rate(44100.0).unwrap();
        }
        if rate_switch && block == 40 {
            ctl.set_rate(48000.0).unwrap();
        }
        let before = HEAP.load(Ordering::Relaxed);
        let worker_before = WORKER_HEAP.load(Ordering::Relaxed);
        audio.render(&mut l, &mut r);
        let events = HEAP.load(Ordering::Relaxed) - before;
        if fault && block == 100 {
            assert!(events <= 3, "unexpected fault heap work: {events}");
        } else {
            assert_eq!(
                events,
                0,
                "heap work in block {block}, workers {}",
                WORKER_HEAP.load(Ordering::Relaxed) - worker_before
            );
        }
        assert_eq!(l, r);
        output.extend_from_slice(&l);
        ctl.collect();
        failures += ctl.take_failures().len();
    }
    (output, audio.worker_jobs(), failures)
}
#[test]
fn parallel_bits_heap_and_ten_thousand_block_fault_stress() {
    let (serial, _, faults) = run(false, true, 10000, false);
    assert_eq!(faults, 1);
    let (parallel, jobs, faults) = run(true, true, 10000, false);
    assert_eq!(faults, 1);
    assert!(jobs > 0, "workers actually rendered jobs");
    assert_eq!(
        WORKER_FAULT.load(Ordering::Relaxed),
        1,
        "fault really ran on a worker"
    );
    assert_eq!(serial, parallel);
    let (serial, _, _) = run(false, false, 100, true);
    let (parallel, jobs, _) = run(true, false, 100, true);
    assert!(jobs > 0);
    assert_eq!(serial, parallel);
}
