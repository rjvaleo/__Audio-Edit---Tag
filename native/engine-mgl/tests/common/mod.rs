//! Shared by this crate's tests: ways to render, the allocation check, and a
//! module that plays a written list of notes down a cable.
#![allow(dead_code)]

use engine_core::*;
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

pub const RATE: f32 = 48_000.0;

/// No fades: the patch is heard whole from its first sample.
pub fn exact() -> Config {
    Config { fade_frames: 0, ..Config::default() }
}

pub fn render(audio: &mut AudioEngine, frames: usize, block: usize) -> (Vec<f32>, Vec<f32>) {
    let mut l = vec![0.0; frames];
    let mut r = vec![0.0; frames];
    let mut pos = 0;
    while pos < frames {
        let n = block.min(frames - pos);
        audio.render(&mut l[pos..pos + n], &mut r[pos..pos + n]);
        pos += n;
    }
    (l, r)
}

/// Blocks of 1 to 700 samples, a different length each time.
pub fn render_uneven(audio: &mut AudioEngine, frames: usize, mut seed: u32) -> (Vec<f32>, Vec<f32>) {
    let mut l = vec![0.0; frames];
    let mut r = vec![0.0; frames];
    let mut pos = 0;
    while pos < frames {
        seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        let n = (1 + (seed >> 8) as usize % 700).min(frames - pos);
        audio.render(&mut l[pos..pos + n], &mut r[pos..pos + n]);
        pos += n;
    }
    (l, r)
}

/// Where two renders first differ in any bit, if they do.
pub fn first_difference(a: &[f32], b: &[f32]) -> Option<usize> {
    if a.len() != b.len() {
        return Some(a.len().min(b.len()));
    }
    (0..a.len()).find(|&i| a[i].to_bits() != b[i].to_bits())
}

/// Equal to the last bit, and says where it first isn't.
pub fn assert_same(name: &str, a: &[f32], b: &[f32]) {
    if let Some(i) = first_difference(a, b) {
        panic!("{name}: first difference at sample {i}: {:?} against {:?}", a.get(i), b.get(i));
    }
}

pub fn peak(a: &[f32]) -> f32 {
    a.iter().fold(0.0, |m, v| m.max(v.abs()))
}

// ---- The allocation check (see engine-core's rt_check test). It counts every
// allocation and free made while a thread is inside a render, and needs
// `--features engine-core/rt-check`.

thread_local! {
    static IN_RENDER: Cell<usize> = const { Cell::new(0) };
}

struct Counting;

/// The sizes of the last few things counted, for whoever has to find them:
/// bytes, negative for a free.
static SIZES: [std::sync::atomic::AtomicIsize; 8] = [const { std::sync::atomic::AtomicIsize::new(0) }; 8];
static SEEN: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

fn count(bytes: isize) {
    if engine_core::rt::in_audio() {
        let _ = IN_RENDER.try_with(|n| n.set(n.get() + 1));
        let at = SEEN.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        SIZES[at % SIZES.len()].store(bytes, std::sync::atomic::Ordering::Relaxed);
    }
}

/// The sizes of the last eight allocations (and frees, negative) made inside
/// a render by any test in this file.
pub fn last_sizes() -> Vec<isize> {
    SIZES.iter().map(|size| size.load(std::sync::atomic::Ordering::Relaxed)).collect()
}

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        count(layout.size() as isize);
        System.alloc(layout)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        count(-(layout.size() as isize));
        System.dealloc(ptr, layout)
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

pub fn counted() -> usize {
    IN_RENDER.with(|n| n.get())
}

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

/// Fails unless the check really catches a module that allocates.
pub fn assert_the_check_is_on() {
    let (mut ctl, mut audio) = engine(RATE, Config::default());
    ctl.add(1, Box::new(Careless)).unwrap();
    ctl.commit().unwrap();
    let before = counted();
    render(&mut audio, 256, 64);
    assert!(counted() > before, "the allocation check is off: run with --features engine-core/rt-check");
}

/// Plays a written list of notes down a cable, each on its own sample.
pub struct Script {
    notes: Vec<(u64, NoteEvent)>,
    next: usize,
}

impl Script {
    /// `notes` in time order: (the sample it falls on, the note).
    pub fn new(notes: Vec<(u64, NoteEvent)>) -> Self {
        Self { notes, next: 0 }
    }
}

impl Module for Script {
    fn inputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Notes]
    }
    fn process(&mut self, io: &mut Io) {
        let end = io.frame + io.n as u64;
        let out = io.outs.notes(0);
        while self.next < self.notes.len() && self.notes[self.next].0 < end {
            let (at, note) = self.notes[self.next];
            if at >= io.frame {
                out.push(NoteEvent { offset: (at - io.frame) as u32, ..note });
            }
            self.next += 1;
        }
    }
}
