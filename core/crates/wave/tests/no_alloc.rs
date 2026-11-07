//! The hard rule, checked: the audio-thread calls never allocate.
//!
//! A counting allocator wraps the system one. Everything is built first; then
//! counting is switched on and the synth is played hard: notes past the
//! polyphony, live parameter moves, a table swap, a patch adoption, the
//! controllers and telemetry, with every unit of the master chain in and its
//! knobs and switches moving. Any allocation fails the test. This file holds a
//! single test so no other test thread can allocate while it counts.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use wave::*;

struct Counting;

static COUNTING: AtomicBool = AtomicBool::new(false);
static ALLOCS: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if COUNTING.load(Ordering::Relaxed) {
            ALLOCS.fetch_add(1, Ordering::Relaxed);
        }
        System.alloc(layout)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        if COUNTING.load(Ordering::Relaxed) {
            ALLOCS.fetch_add(1, Ordering::Relaxed);
        }
        System.dealloc(ptr, layout)
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new: usize) -> *mut u8 {
        if COUNTING.load(Ordering::Relaxed) {
            ALLOCS.fetch_add(1, Ordering::Relaxed);
        }
        System.realloc(ptr, layout, new)
    }
}

#[global_allocator]
static GLOBAL: Counting = Counting;

#[test]
fn render_note_on_set_param_and_set_table_never_allocate() {
    let t = |name: &str| Arc::new(Wavetable::from_frames(&builtin_frames(name).unwrap()));
    let tables = [t("Formant Sweep"), t("Vowel Ah–Oo"), t("Glass Organ")];
    let spare = t("Grit Saw");
    let mut patch = Patch::default();
    patch.set_num("osc2.on", 1.0);
    patch.set_num("noise.on", 1.0);
    for i in 0..5 {
        patch.set_num(&format!("fx{i}.on"), 1.0);
    }
    let state = PatchState::new(&patch);
    patch.set_str("voice.mode", "mono");
    patch.set_str("filt0.type", "comb");
    let mono = PatchState::new(&patch);
    let ids: Vec<ParamId> = ["osc0.pos", "filt0.cut", "osc1.uni.n", "master", "fx0.k0", "fx1.k1", "fx2.k0", "fx3.k0", "fx4.k0", "fx4.k2"]
        .iter()
        .map(|k| param_id(k).unwrap())
        .collect();
    let switches: Vec<ParamId> = (0..5).map(|i| param_id(&format!("fx{i}.on")).unwrap()).collect();

    let mut synth = Synth::new(48_000.0, 512);
    synth.adopt(state);
    for (i, table) in tables.iter().enumerate() {
        synth.set_table(i, table.clone());
    }
    let mut left = vec![0.0f32; 512];
    let mut right = vec![0.0f32; 512];
    let mut telemetry = Telemetry::default();
    let mut spare = Some(spare);
    let mut returned = None;

    COUNTING.store(true, Ordering::SeqCst);
    for round in 0..4u8 {
        for n in 0..40u8 {
            synth.note_on(30 + n + round, 0.7);
            synth.render(&mut left[..97], &mut right[..97]);
        }
        for (j, id) in ids.iter().enumerate() {
            synth.set_param(*id, (round as f32 * 0.3 + j as f32 * 0.1) % 1.0);
        }
        synth.bend(0.5);
        synth.mod_wheel(0.3);
        synth.aftertouch(0.2);
        if round == 1 {
            returned = synth.set_table(2, spare.take().unwrap());
        }
        if round == 2 {
            synth.adopt(mono);
        }
        // Every unit out (its 10 ms fade runs to the end) and back in, which
        // clears its lines.
        for id in &switches {
            synth.set_param(*id, 0.0);
        }
        synth.render(&mut left, &mut right);
        synth.render(&mut left, &mut right);
        for id in &switches {
            synth.set_param(*id, 1.0);
        }
        synth.render(&mut left, &mut right);
        synth.telemetry(&mut telemetry);
        for n in 0..40u8 {
            synth.note_off(30 + n + round);
        }
        synth.render(&mut left, &mut right);
    }
    COUNTING.store(false, Ordering::SeqCst);

    assert_eq!(ALLOCS.load(Ordering::SeqCst), 0, "the audio-thread calls allocated");
    assert!(returned.is_some());
    assert!(left.iter().all(|v| v.is_finite()));
}
