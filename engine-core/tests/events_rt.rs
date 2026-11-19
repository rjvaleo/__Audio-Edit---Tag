//! Count heap operations on audio and workers while routing dense event slices.
#![cfg(feature = "rt-check")]
use engine_core::basics::Keys;
use engine_core::*;
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};
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
struct Recipient {
    gain: f32,
}
impl Module for Recipient {
    fn parallel_weight(&self) -> usize {
        4096
    }
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Notes]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn handle(&mut self, event: &EventKind) {
        if let EventKind::Param { value, .. } = event {
            self.gain = *value;
        }
    }
    fn process(&mut self, io: &mut Io) {
        let notes = io.ins.notes(0);
        let (l, r) = io.outs.audio(0);
        l.fill(self.gain);
        for note in notes {
            l[note.offset as usize] += 0.001;
        }
        r.copy_from_slice(l);
    }
}
fn run(parallel: bool) -> Vec<f32> {
    let (mut ctl, mut audio) = engine(
        48000.0,
        Config {
            parallel,
            max_block: 512,
            fade_frames: 0,
            queue: 4096,
            ..Config::default()
        },
    );
    ctl.add_with_factory(1, Box::new(|_, _| Box::new(Keys::new())))
        .unwrap();
    for id in 10..18 {
        ctl.add_with_factory(id, Box::new(|_, _| Box::new(Recipient { gain: 0.0 })))
            .unwrap();
        ctl.connect(port(1, 0), port(id, 0)).unwrap();
        ctl.connect_out(port(id, 0)).unwrap();
    }
    ctl.commit().unwrap();
    let (mut l, mut r) = ([0.0; 512], [0.0; 512]);
    let mut result = Vec::with_capacity(100 * 512);
    for block in 0..100 {
        if block == 30 {
            ctl.set_rate(44100.0).unwrap();
        }
        if block == 60 {
            ctl.set_rate(48000.0).unwrap();
        }
        let frame = audio.frame();
        for event in 0..64 {
            let stamp = frame + event * 8;
            ctl.send_at(
                stamp,
                10 + (event % 8) as u32,
                EventKind::Param {
                    index: 0,
                    value: event as f32 * 0.001,
                },
            )
            .unwrap();
            ctl.send_at(stamp, 1, EventKind::Note(NoteEvent::on(60, 0.5)))
                .unwrap();
        }
        let before = HEAP.load(Ordering::Relaxed);
        audio.render(&mut l, &mut r);
        assert_eq!(
            HEAP.load(Ordering::Relaxed),
            before,
            "audio or worker heap operation, block {block}"
        );
        assert_eq!(l, r);
        result.extend_from_slice(&l);
        ctl.collect();
    }
    if parallel {
        assert!(audio.worker_jobs() > 0);
    } else {
        assert_eq!(audio.worker_jobs(), 0);
    }
    result
}
#[test]
fn dense_controls_and_notes_on_workers_and_through_rate_changes_allocate_nothing() {
    assert_eq!(
        run(false).iter().map(|v| v.to_bits()).collect::<Vec<_>>(),
        run(true).iter().map(|v| v.to_bits()).collect::<Vec<_>>()
    );
}
