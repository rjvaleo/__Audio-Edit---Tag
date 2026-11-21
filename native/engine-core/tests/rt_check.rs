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
    assert!(
        live.landed.len() >= 300,
        "the session really ran: {} messages landed",
        live.landed.len()
    );
    assert!(
        live.collected.plans >= 3 && live.collected.sounds >= 1,
        "plans and a sound were swapped"
    );
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
    assert!(
        counted() >= before + 8,
        "four blocks, an allocation and a free each"
    );
}

#[test]
fn handing_things_over_frees_nothing_on_the_audio_thread() {
    let (mut ctl, mut audio) = engine(RATE, exact());
    let freed = std::sync::Arc::new(Freed::default());
    ctl.add(1, Box::new(Holder::default())).unwrap();
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit().unwrap();
    for i in 0..40u64 {
        ctl.give_at(10 + 50 * i, 1, (i % 2) as u32, level(i as f32, &freed))
            .unwrap();
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
        ctl.give_at(200 + 700 * i, 4, 0, Box::new(Tape::with_room(400)))
            .unwrap();
        ctl.send_at(
            300 + 700 * i,
            3,
            EventKind::Param {
                index: 0,
                value: 0.1 * i as f32,
            },
        )
        .unwrap();
    }
    let before = counted();
    render(&mut audio, 8_000, 64);
    assert_eq!(counted(), before, "allocations or frees inside a render");
    let mut back = Vec::new();
    assert_eq!(ctl.collect_things(&mut back).things, 10);
    assert!(back.iter().all(|thing| thing
        .downcast_ref::<Tape>()
        .is_some_and(|tape| tape.l.len() == 400)));
}

struct BadOnce {
    fired: bool,
    recovered: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}

impl Module for BadOnce {
    fn inputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn process(&mut self, io: &mut Io) {
        let (l, r) = io.outs.audio(0);
        l.fill(0.25);
        r.fill(0.5);
        if !self.fired {
            l[0] = f32::NAN;
            self.fired = true;
        }
    }
    fn recover(&mut self) {
        self.recovered
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }
}

#[test]
fn a_bad_module_is_silenced_and_recovers_without_allocating() {
    use engine_core::basics::Gain;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    let recovered = Arc::new(AtomicUsize::new(0));
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(
        1,
        Box::new(BadOnce {
            fired: false,
            recovered: recovered.clone(),
        }),
    )
    .unwrap();
    ctl.add(2, Box::new(Gain::new(0.5))).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    let mut l = [0.0; 64];
    let mut r = [0.0; 64];
    let before = counted();
    audio.render(&mut l, &mut r);
    assert_eq!(l, [0.0; 64]);
    assert_eq!(r, [0.0; 64]);
    assert_eq!(ctl.bad_blocks(), 1);
    assert_eq!(recovered.load(Ordering::SeqCst), 1);
    for _ in 0..4 {
        audio.render(&mut l, &mut r);
        assert_eq!(l, [0.125; 64]);
        assert_eq!(r, [0.25; 64]);
    }
    assert_eq!(
        counted(),
        before,
        "allocations or frees inside recovery or rendering"
    );
    assert_eq!(ctl.bad_blocks(), 1);
    assert_eq!(recovered.load(Ordering::SeqCst), 1);
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum FaultAt {
    Process,
    Handle,
    Take,
    Finished,
    Recover,
    Emit,
    Absorb,
}
struct Fault {
    at: FaultAt,
    calls: usize,
    fail_on: usize,
}
impl Fault {
    fn fail(&mut self, at: FaultAt) {
        if self.at == at {
            self.calls += 1;
            if self.calls == self.fail_on {
                panic!("intentional module fault");
            }
        }
    }
    fn fill(&self, io: &mut Io) {
        let (l, r) = io.outs.audio(0);
        l.fill(if self.at == FaultAt::Recover {
            f32::NAN
        } else {
            0.5
        });
        r.copy_from_slice(l);
    }
}
impl Module for Fault {
    fn inputs(&self) -> Vec<Kind> {
        if matches!(self.at, FaultAt::Emit | FaultAt::Absorb) {
            vec![Kind::Audio]
        } else {
            vec![]
        }
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn process(&mut self, io: &mut Io) {
        self.fill(io);
        self.fail(FaultAt::Process);
    }
    fn handle(&mut self, _: &EventKind) {
        self.fail(FaultAt::Handle);
    }
    fn take(&mut self, _: u32, thing: Thing) -> Option<Thing> {
        // The module retains ownership on a successful hand-back; in this
        // fixture a static ZST makes the panic's own drops allocation-free.
        self.fail(FaultAt::Take);
        Some(thing)
    }
    fn finished(&mut self) -> Option<Thing> {
        self.fail(FaultAt::Finished);
        None
    }
    fn hands_back(&self) -> bool {
        true
    }
    fn recover(&mut self) {
        self.fail(FaultAt::Recover);
    }
    fn feedback_delay(&self) -> usize {
        if matches!(self.at, FaultAt::Emit | FaultAt::Absorb) {
            64
        } else {
            0
        }
    }
    fn emit(&mut self, io: &mut Io) {
        self.fill(io);
        self.fail(FaultAt::Emit);
    }
    fn absorb(&mut self, _: &mut Io) {
        self.fail(FaultAt::Absorb);
    }
}

#[test]
fn every_audio_callback_fault_is_contained_and_the_next_thousand_blocks_allocate_nothing() {
    for at in [
        FaultAt::Process,
        FaultAt::Handle,
        FaultAt::Take,
        FaultAt::Finished,
        FaultAt::Recover,
        FaultAt::Emit,
        FaultAt::Absorb,
    ] {
        let (mut ctl, mut audio) = engine(RATE, exact());
        ctl.add(1, Box::new(Dc(0.25))).unwrap();
        ctl.connect_out(port(1, 0)).unwrap();
        ctl.add(
            2,
            Box::new(Fault {
                at,
                calls: 0,
                fail_on: 1,
            }),
        )
        .unwrap();
        ctl.connect_out(port(2, 0)).unwrap();
        if matches!(at, FaultAt::Emit | FaultAt::Absorb) {
            ctl.connect(port(2, 0), port(2, 0)).unwrap();
        }
        ctl.commit().unwrap();
        if at == FaultAt::Handle {
            ctl.send(
                2,
                EventKind::Param {
                    index: 0,
                    value: 1.0,
                },
            )
            .unwrap();
        }
        if at == FaultAt::Take {
            ctl.give(2, 0, Box::new(())).unwrap();
        }
        let mut l = [0.0; 64];
        let mut r = [0.0; 64];
        let before = counted();
        audio.render(&mut l, &mut r);
        // Explicit allowance for this one deliberate fault block only. The
        // existing allocator is unchanged, and normal allocations still count.
        let unwind_events = counted() - before;
        eprintln!("{at:?}: {unwind_events} heap events in the deliberate fault block");
        assert!(
            unwind_events > 0 && unwind_events <= 3,
            "{at:?}: {unwind_events} unwind heap events"
        );
        assert!(
            l.iter().chain(&r).all(|x| x.to_bits() == 0.25f32.to_bits()),
            "{at:?}: faulty outputs escaped"
        );
        let after_fault = counted();
        for _ in 0..1000 {
            audio.render(&mut l, &mut r);
            assert!(l.iter().chain(&r).all(|x| x.to_bits() == 0.25f32.to_bits()));
        }
        assert_eq!(counted(), after_fault, "{at:?}: heap operation after fault");
        ctl.collect();
        assert_eq!(ctl.take_failures(), vec![Failure::ModulePanicked { id: 2 }]);
        ctl.collect();
        assert!(ctl.take_failures().is_empty());
        // A rebuilt plan must not retry the same damaged module.
        ctl.commit().unwrap();
        audio.render(&mut l, &mut r);
        assert!(l.iter().all(|x| *x == 0.25));
        ctl.remove(2);
        ctl.add(2, Box::new(Dc(0.5))).unwrap();
        ctl.connect_out(port(2, 0)).unwrap();
        ctl.commit().unwrap();
        audio.render(&mut l, &mut r);
        assert!(l.iter().all(|x| *x == 0.75));
    }
}

#[test]
fn a_fault_on_the_third_process_call_does_not_change_the_other_modules_bits() {
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Dc(0.25))).unwrap();
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.add(
        2,
        Box::new(Fault {
            at: FaultAt::Process,
            calls: 0,
            fail_on: 3,
        }),
    )
    .unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    let mut l = [0.0; 64];
    let mut r = [0.0; 64];
    for _ in 0..2 {
        let n = counted();
        audio.render(&mut l, &mut r);
        assert_eq!(counted(), n);
        assert!(l.iter().all(|x| *x == 0.75));
    }
    audio.render(&mut l, &mut r);
    assert!(l.iter().chain(&r).all(|x| x.to_bits() == 0.25f32.to_bits()));
}

#[test]
fn the_controller_frees_the_panic_payload() {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    struct Payload(Arc<AtomicUsize>);
    impl Drop for Payload {
        fn drop(&mut self) {
            self.0
                .store(if rt::in_audio() { 2 } else { 1 }, Ordering::SeqCst);
        }
    }
    struct Panics(Arc<AtomicUsize>);
    impl Module for Panics {
        fn inputs(&self) -> Vec<Kind> {
            vec![]
        }
        fn outputs(&self) -> Vec<Kind> {
            vec![Kind::Audio]
        }
        fn process(&mut self, _: &mut Io) {
            std::panic::panic_any(Payload(Arc::clone(&self.0)));
        }
    }
    let dropped = Arc::new(AtomicUsize::new(0));
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Panics(Arc::clone(&dropped)))).unwrap();
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit().unwrap();
    let mut l = [0.0; 64];
    let mut r = [0.0; 64];
    audio.render(&mut l, &mut r);
    assert_eq!(dropped.load(Ordering::SeqCst), 0);
    ctl.collect();
    assert_eq!(dropped.load(Ordering::SeqCst), 1);
    assert_eq!(ctl.take_failures(), vec![Failure::ModulePanicked { id: 1 }]);
}

#[test]
fn all_failed_output_kinds_are_empty_before_the_downstream_module_runs() {
    struct Broken;
    impl Module for Broken {
        fn inputs(&self) -> Vec<Kind> {
            vec![]
        }
        fn outputs(&self) -> Vec<Kind> {
            vec![
                Kind::Audio,
                Kind::Control,
                Kind::Notes,
                Kind::Clock,
                Kind::Sound,
            ]
        }
        fn process(&mut self, io: &mut Io) {
            let (l, r) = io.outs.audio(0);
            l.fill(0.9);
            r.fill(0.9);
            io.outs.control(1).fill(0.9);
            io.outs.notes(2).push(NoteEvent::on(60, 1.0));
            io.outs.set_clock(
                3,
                ClockState {
                    playing: true,
                    bpm: 99.0,
                    beat: 7.0,
                },
            );
            io.outs.set_sound(
                4,
                SoundRef {
                    id: 123,
                    version: 7,
                },
            );
            panic!("partial output must not escape");
        }
    }
    struct Observer;
    impl Module for Observer {
        fn inputs(&self) -> Vec<Kind> {
            vec![
                Kind::Audio,
                Kind::Control,
                Kind::Notes,
                Kind::Clock,
                Kind::Sound,
            ]
        }
        fn outputs(&self) -> Vec<Kind> {
            vec![Kind::Audio]
        }
        fn process(&mut self, io: &mut Io) {
            let (l, r) = io.ins.audio(0);
            let empty = l.iter().chain(r).all(|x| *x == 0.0)
                && io.ins.control(1).iter().all(|x| *x == 0.0)
                && io.ins.notes(2).is_empty()
                && io.ins.clock(3) == ClockState::STOPPED
                && io.ins.sound(4) == SoundRef::default();
            let (l, r) = io.outs.audio(0);
            l.fill(if empty { 0.25 } else { 0.75 });
            r.copy_from_slice(l);
        }
    }
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Broken)).unwrap();
    ctl.add(2, Box::new(Observer)).unwrap();
    for i in 0..5 {
        ctl.connect(port(1, i), port(2, i)).unwrap();
    }
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    let mut l = [0.0; 64];
    let mut r = [0.0; 64];
    for _ in 0..3 {
        audio.render(&mut l, &mut r);
        assert!(l.iter().chain(&r).all(|x| *x == 0.25));
    }
    ctl.collect();
    assert_eq!(ctl.take_failures(), vec![Failure::ModulePanicked { id: 1 }]);
}

struct DeclaredDelay {
    ring: Vec<f32>,
    at: usize,
}
impl DeclaredDelay {
    fn new(n: usize) -> Self {
        Self {
            ring: vec![0.0; n],
            at: 0,
        }
    }
}
impl Module for DeclaredDelay {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn latency(&self) -> usize {
        self.ring.len()
    }
    fn process(&mut self, io: &mut Io) {
        let (input, _) = io.ins.audio(0);
        let (l, r) = io.outs.audio(0);
        for i in 0..l.len() {
            l[i] = self.ring[self.at];
            r[i] = l[i];
            self.ring[self.at] = input[i];
            self.at = (self.at + 1) % self.ring.len();
        }
    }
}
#[test]
fn latency_compensation_aligns_rejoins_and_outputs_and_survives_plan_transfers_without_allocating()
{
    for rejoin in [false, true] {
        let (mut ctl, mut audio) = engine(
            RATE,
            Config {
                max_block: 64,
                ..exact()
            },
        );
        ctl.add(1, Box::new(Impulse::new())).unwrap();
        ctl.add(2, Box::new(engine_core::basics::Gain::new(1.0)))
            .unwrap();
        ctl.add(3, Box::new(DeclaredDelay::new(73))).unwrap();
        ctl.connect(port(1, 0), port(2, 0)).unwrap();
        ctl.connect(port(1, 0), port(3, 0)).unwrap();
        if rejoin {
            ctl.add(4, Box::new(engine_core::basics::Mix::new(2)))
                .unwrap();
            ctl.connect(port(2, 0), port(4, 0)).unwrap();
            ctl.connect(port(3, 0), port(4, 1)).unwrap();
            ctl.connect_out(port(4, 0)).unwrap();
        } else {
            ctl.connect_out(port(2, 0)).unwrap();
            ctl.connect_out(port(3, 0)).unwrap();
        }
        ctl.commit().unwrap();
        let mut l = [0.0; 140];
        let mut r = [0.0; 140];
        let before = counted();
        audio.render(&mut l[..21], &mut r[..21]);
        assert_eq!(counted(), before);
        ctl.commit().unwrap(); // compile-time allocations are deliberately outside the render check.
        let before = counted();
        for start in (21..140).step_by(7) {
            let end = (start + 7).min(140);
            audio.render(&mut l[start..end], &mut r[start..end]);
        }
        assert_eq!(counted(), before);
        for i in 0..140 {
            assert_eq!(
                l[i],
                if i == 73 { 2.0 } else { 0.0 },
                "rejoin={rejoin}, sample={i}"
            );
            assert_eq!(r[i], l[i]);
        }
    }
}

struct FiniteTail {
    left: usize,
    sleep: bool,
    calls: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}
impl Module for FiniteTail {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn tail(&self) -> usize {
        48000
    }
    fn can_sleep(&self) -> bool {
        self.sleep
    }
    fn process(&mut self, io: &mut Io) {
        self.calls
            .fetch_add(io.n, std::sync::atomic::Ordering::Relaxed);
        let (input, _) = io.ins.audio(0);
        let (l, r) = io.outs.audio(0);
        for i in 0..l.len() {
            if input[i] != 0.0 {
                self.left = 48000;
            }
            l[i] = if self.left > 0 { 0.5 } else { 0.0 };
            r[i] = l[i];
            self.left = self.left.saturating_sub(1);
        }
    }
}
struct Trigger(bool);
impl Module for Trigger {
    fn inputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn handle(&mut self, _: &EventKind) {
        self.0 = true;
    }
    fn process(&mut self, io: &mut Io) {
        let (l, r) = io.outs.audio(0);
        l.fill(0.0);
        r.fill(0.0);
        if self.0 {
            l[0] = 1.0;
            r[0] = 1.0;
            self.0 = false;
        }
    }
}
#[test]
fn a_one_second_tail_finishes_then_sleeps_and_wakes_bit_identically() {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    let make = |sleep| {
        let calls = Arc::new(AtomicUsize::new(0));
        let (mut ctl, audio) = engine(
            RATE,
            Config {
                max_block: 64,
                ..exact()
            },
        );
        ctl.add(1, Box::new(Trigger(true))).unwrap();
        ctl.add(
            2,
            Box::new(FiniteTail {
                left: 0,
                sleep,
                calls: Arc::clone(&calls),
            }),
        )
        .unwrap();
        ctl.connect(port(1, 0), port(2, 0)).unwrap();
        ctl.connect_out(port(2, 0)).unwrap();
        ctl.commit().unwrap();
        (ctl, audio, calls)
    };
    let (mut ctl, mut audio, calls) = make(true);
    let (mut ctl_ref, mut reference, _) = make(false);
    let (mut l, mut r, mut a, mut b) = ([0.0; 64], [0.0; 64], [0.0; 64], [0.0; 64]);
    for block in 0..2000 {
        if block == 1500 {
            let event = EventKind::Param {
                index: 0,
                value: 1.0,
            };
            ctl.send(1, event).unwrap();
            ctl_ref.send(1, event).unwrap();
        }
        let before = counted();
        audio.render(&mut l, &mut r);
        reference.render(&mut a, &mut b);
        assert_eq!(counted(), before);
        assert!(
            l.iter()
                .zip(&a)
                .chain(r.iter().zip(&b))
                .all(|(x, y)| x.to_bits() == y.to_bits()),
            "block {block}"
        );
        if block == 1000 {
            assert!(
                calls.load(Ordering::Relaxed) >= 48000 && calls.load(Ordering::Relaxed) <= 48128
            );
        }
        if block == 1499 {
            assert!(calls.load(Ordering::Relaxed) <= 48128);
        }
        if block == 1500 {
            assert_eq!(l[0], 0.5);
        }
    }
}

#[test]
fn rate_switches_rebuild_off_audio_and_crossfade_without_audio_heap_work() {
    use engine_core::basics::{Clock, Gain, Sine};
    let (mut ctl, mut audio) = engine(48000.0, Config { max_block: 512, fade_frames: 128, ..Config::default() });
    ctl.add_with_factory(1, Box::new(|_, _| Box::new(Sine::new(220.0, 0.2)))).unwrap();
    ctl.add_with_factory(2, Box::new(|_, _| Box::new(Gain::new(0.5)))).unwrap();
    ctl.add_with_factory(3, Box::new(|_, _| Box::new(Clock::new(120.0, true)))).unwrap();
    ctl.connect(port(1,0), port(2,0)).unwrap(); ctl.connect_out(port(2,0)).unwrap(); ctl.commit().unwrap();
    let mut l = [0.0; 512]; let mut r = l;
    audio.render(&mut l, &mut r);
    ctl.send(2, EventKind::Param { index: 0, value: 0.25 }).unwrap();
    audio.render(&mut l, &mut r);
    for rate in [44100.0, 48000.0] {
        let before = counted();
        ctl.set_rate(rate).unwrap();
        let mut last = l[511];
        for _ in 0..32 {
            audio.render(&mut l, &mut r);
            for &value in &l {
                assert!(value.is_finite()); assert!((value-last).abs() < 0.004); last = value;
            }
            assert!(l.iter().any(|v| v.abs() > 0.001));
        }
        assert_eq!(counted(), before, "rate transition allocated or freed on audio");
        ctl.collect();
    }
}
