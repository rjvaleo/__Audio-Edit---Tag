//! Feedback islands use their own delay; unrelated modules keep the full block.
#![cfg(feature = "rt-check")]
use engine_core::basics::{Delay, Gain};
use engine_core::*;
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
static HEAP: AtomicUsize = AtomicUsize::new(0);
struct Counting;
fn count() {
    if rt::in_audio() {
        HEAP.fetch_add(1, Ordering::Relaxed);
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
struct Whole(Arc<AtomicUsize>);
impl Module for Whole {
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
        assert_eq!(io.n, 512);
        self.0.fetch_add(1, Ordering::Relaxed);
        let (l, r) = io.outs.audio(0);
        l.fill(0.01);
        r.fill(0.01);
    }
}
struct Forward(Arc<AtomicUsize>);
impl Module for Forward {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn process(&mut self, io: &mut Io) {
        assert_eq!(io.n, 512);
        self.0.fetch_add(1, Ordering::Relaxed);
        let (a, b) = io.ins.audio(0);
        let (l, r) = io.outs.audio(0);
        l.copy_from_slice(a);
        r.copy_from_slice(b);
    }
}
struct Tick {
    inner: Delay,
    emit: Arc<AtomicUsize>,
    absorb: Arc<AtomicUsize>,
    frames: Arc<AtomicUsize>,
}
impl Module for Tick {
    fn inputs(&self) -> Vec<Kind> {
        self.inner.inputs()
    }
    fn outputs(&self) -> Vec<Kind> {
        self.inner.outputs()
    }
    fn feedback_delay(&self) -> usize {
        self.inner.feedback_delay()
    }
    fn process(&mut self, io: &mut Io) {
        self.inner.process(io);
    }
    fn emit(&mut self, io: &mut Io) {
        self.emit.fetch_add(1, Ordering::Relaxed);
        self.frames.fetch_add(io.n, Ordering::Relaxed);
        self.inner.emit(io);
    }
    fn absorb(&mut self, io: &mut Io) {
        self.absorb.fetch_add(1, Ordering::Relaxed);
        self.inner.absorb(io);
    }
}
#[test]
fn two_loops_tick_independently_while_four_branches_run_once_without_heap_work() {
    for parallel in [false, true] {
        let (mut ctl, mut audio) = engine(
            48000.0,
            Config {
                parallel,
                max_block: 512,
                fade_frames: 0,
                ..Config::default()
            },
        );
        let mut counters = Vec::new();
        for (id, delay) in [(1, 64), (3, 96)] {
            let e = Arc::new(AtomicUsize::new(0));
            let a = Arc::new(AtomicUsize::new(0));
            let f = Arc::new(AtomicUsize::new(0));
            ctl.add(
                id,
                Box::new(Tick {
                    inner: Delay::new(delay),
                    emit: e.clone(),
                    absorb: a.clone(),
                    frames: f.clone(),
                }),
            )
            .unwrap();
            ctl.add(id + 1, Box::new(Gain::new(0.5))).unwrap();
            ctl.connect(port(id, 0), port(id + 1, 0)).unwrap();
            ctl.connect(port(id + 1, 0), port(id, 0)).unwrap();
            ctl.connect_out(port(id, 0)).unwrap();
            counters.push((e, a, f, 512usize.div_ceil(delay)));
        }
        let mut calls = Vec::new();
        for id in 10..14 {
            let call = Arc::new(AtomicUsize::new(0));
            ctl.add(id, Box::new(Whole(call.clone()))).unwrap();
            ctl.connect_out(port(id, 0)).unwrap();
            calls.push(call);
        }
        let upstream = Arc::new(AtomicUsize::new(0));
        ctl.add(30, Box::new(Whole(upstream.clone()))).unwrap();
        ctl.connect(port(30, 0), port(1, 0)).unwrap();
        ctl.connect(port(30, 0), port(3, 0)).unwrap();
        calls.push(upstream);
        let downstream = Arc::new(AtomicUsize::new(0));
        ctl.add(20, Box::new(Forward(downstream.clone()))).unwrap();
        ctl.connect(port(1, 0), port(20, 0)).unwrap();
        ctl.connect_out(port(20, 0)).unwrap();
        calls.push(downstream);
        ctl.commit().unwrap();
        let (mut l, mut r) = ([0.0; 512], [0.0; 512]);
        let before = HEAP.load(Ordering::Relaxed);
        audio.render(&mut l, &mut r);
        assert_eq!(HEAP.load(Ordering::Relaxed), before);
        assert_eq!(audio.pieces(), 1);
        for (e, a, f, n) in counters {
            assert_eq!(e.load(Ordering::Relaxed), n);
            assert_eq!(a.load(Ordering::Relaxed), n);
            assert_eq!(f.load(Ordering::Relaxed), 512);
        }
        for call in calls {
            assert_eq!(call.load(Ordering::Relaxed), 1);
        }
        if parallel {
            assert!(audio.worker_jobs() > 0);
        }
    }
}
