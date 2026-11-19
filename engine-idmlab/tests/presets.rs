use dsp_core::modules::ModuleKind;
use engine_core::basics::Sine;
use engine_core::*;
use engine_idmlab::{Wrapped, WrappedState};
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
thread_local! {static HEAP:Cell<usize>=const {Cell::new(0)};}
struct Counting;
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if engine_core::rt::in_audio() {
            HEAP.with(|n| n.set(n.get() + 1));
        }
        System.alloc(layout)
    }
    unsafe fn dealloc(&self, p: *mut u8, layout: Layout) {
        if engine_core::rt::in_audio() {
            HEAP.with(|n| n.set(n.get() + 1));
        }
        System.dealloc(p, layout)
    }
}
#[global_allocator]
static ALLOC: Counting = Counting;
fn patch(parallel: bool) -> (Controller, AudioEngine) {
    let (mut ctl, audio) = engine(
        48000.0,
        Config {
            max_block: 512,
            fade_frames: 0,
            parallel,
            ..Config::default()
        },
    );
    ctl.add_with_factory(1, Box::new(|_, _| Box::new(Sine::new(317.0, 0.2))))
        .unwrap();
    ctl.add(
        2,
        Box::new(Wrapped::new(ModuleKind::Gain, 0, 48000.0).unwrap()),
    )
    .unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    (ctl, audio)
}
fn compare(a: &mut AudioEngine, b: &mut AudioEngine) {
    let (mut l, mut r, mut x, mut y) = ([0.0; 127], [0.0; 127], [0.0; 127], [0.0; 127]);
    for _ in 0..32 {
        let before = HEAP.with(Cell::get);
        a.render(&mut l, &mut r);
        b.render(&mut x, &mut y);
        assert_eq!(HEAP.with(Cell::get), before);
        for i in 0..127 {
            assert_eq!(l[i].to_bits(), x[i].to_bits());
            assert_eq!(r[i].to_bits(), y[i].to_bits());
        }
    }
}
#[test]
fn idmlab_preset_matches_controls_and_survives_a_pending_rate_change() {
    for parallel in [false, true] {
        let (mut ctl, mut audio) = patch(parallel);
        let (mut ref_ctl, mut reference) = patch(parallel);
        let values = [(0, 0.3), (1, 0.8), (0, 0.6)];
        ctl.give_at(37, 2, PRESET, Box::new(WrappedState::new(&values)))
            .unwrap();
        for &(index, value) in &values {
            ref_ctl
                .send_at(37, 2, EventKind::Param { index, value })
                .unwrap();
        }
        compare(&mut audio, &mut reference);
        ctl.give(
            2,
            PRESET,
            Box::new(WrappedState::new(&[(0, 0.2), (1, 0.7)])),
        )
        .unwrap();
        ref_ctl
            .send(
                2,
                EventKind::Param {
                    index: 0,
                    value: 0.2,
                },
            )
            .unwrap();
        ref_ctl
            .send(
                2,
                EventKind::Param {
                    index: 1,
                    value: 0.7,
                },
            )
            .unwrap();
        ctl.set_rate(96000.0).unwrap();
        ref_ctl.set_rate(96000.0).unwrap();
        compare(&mut audio, &mut reference);
        ctl.collect();
        assert!(ctl.take_failures().is_empty());
    }
}
