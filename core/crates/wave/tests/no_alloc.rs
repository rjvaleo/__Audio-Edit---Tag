//! The hard rule, checked: the audio-thread calls never allocate.
//!
//! A counting allocator wraps the system one. Everything is built first; then
//! counting is switched on and the synth is played hard: notes past the
//! polyphony, live parameter moves, a table swap, a patch adoption, the
//! controllers and telemetry, with every unit of the master chain in and its
//! knobs and switches moving; then the same on a ten-node board with a send,
//! its controls written live and modulated, a node switched out and in, and a
//! second board swapped in; then every kind of choice key stepped by fast
//! LFOs, with a bank table handed in; then Convolution and Spectral Dynamics
//! running on their sounds. Any allocation fails the test. This file holds a
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

    // Ten nodes: the voice and osc A's send, a split into a chorus and an
    // echo, a mix of the two with the hall on a dry/wet beside them, a
    // compressor, a pan, a gain and the out.
    let n = |id: &str, kind: &str| Node::new(id, kind, 0.0, 0.0);
    let board = Board {
        name: "ten".into(),
        nodes: vec![
            n("v", "in:voice"),
            n("a", "in:osc0").with("level", 0.5),
            n("sp", "split"),
            n("ch", "fx:hp-chorus").with("depth", 40.0),
            n("ec", "fx:echo").with("delayMs", 120.0),
            n("mx", "mix").with("ins", 3.0),
            n("dw", "drywet"),
            n("hl", "fx:lxp-hall"),
            n("co", "fx:compressor"),
            n("out", "out"),
        ],
        cables: [
            ("v", "o", "sp", "i"),
            ("sp", "o0", "ch", "i"),
            ("sp", "o1", "ec", "i"),
            ("ch", "o", "mx", "i0"),
            ("ec", "o", "mx", "i1"),
            ("a", "o", "dw", "i"),
            ("dw", "send", "hl", "i"),
            ("hl", "o", "dw", "ret"),
            ("dw", "o", "mx", "i2"),
            ("mx", "o", "co", "i"),
            ("co", "o", "out", "i"),
        ]
        .iter()
        .map(|(a, ap, b, bp)| Cable::new(a, ap, b, bp))
        .collect(),
    };
    let mut boarded = Patch::default();
    boarded.board = Some(board.clone());
    boarded.mods = vec![Mod::new("lfo0", "board:ec:delayMs", 0.3), Mod::new("macro0", "board:mx:l0", -0.4), Mod::new("vel", "board:hl:mix", 0.5)];
    let boarded = PatchState::new(&boarded);
    let plan = Box::new(BoardPlan::compile(&board, 48_000.0).unwrap());
    let second = Box::new(BoardPlan::compile(&board, 48_000.0).unwrap());
    let echo = board.node("ec").unwrap().0;
    let delay = wave::board::Kind::parse("fx:echo").unwrap().params().iter().position(|p| p.key == "delayMs").unwrap();

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

    let mut synth = Synth::new(48_000.0, 512);
    synth.adopt(boarded);
    for (i, table) in tables.iter().enumerate() {
        synth.set_table(i, table.clone());
    }
    assert!(synth.set_board(plan).is_none());
    let mut second = Some(second);
    let (mut displaced, mut retired) = (None, None);
    COUNTING.store(true, Ordering::SeqCst);
    for round in 0..4u8 {
        for n in 0..12u8 {
            synth.note_on(40 + n + round, 0.7);
            synth.render(&mut left[..97], &mut right[..97]);
        }
        synth.set_board_param(echo, delay, 50.0 + round as f32 * 100.0);
        synth.set_board_on(echo, round % 2 == 1);
        synth.mod_wheel(0.4);
        if round == 2 {
            displaced = synth.set_board(second.take().unwrap());
        }
        synth.render(&mut left, &mut right);
        synth.render(&mut left, &mut right);
        if round == 3 {
            retired = synth.take_retired();
        }
        synth.telemetry(&mut telemetry);
        for n in 0..12u8 {
            synth.note_off(40 + n + round);
        }
        synth.render(&mut left, &mut right);
    }
    COUNTING.store(false, Ordering::SeqCst);
    assert_eq!(ALLOCS.load(Ordering::SeqCst), 0, "rendering a board allocated");
    assert!(displaced.is_none() && retired.is_some(), "the first board came back once it had faded");

    // v8b: every kind of choice key stepped by fast LFOs (the crossfades,
    // the fed effect lines, the routing's dip), and a bank table swapped.
    let mut chosen = Patch::default();
    chosen.set_num("lfo0.rate", 0.8);
    chosen.set_num("lfo1.rate", 0.75);
    chosen.set_str("lfo2.mode", "trig");
    for (src, dst, amt) in [
        ("lfo0", "osc0.warp0.mode", 0.5),
        ("lfo1", "osc1.warp1.mode", -0.5),
        ("lfo0", "osc0.fx.mode", 0.6),
        ("lfo1", "osc1.fx.mode", 0.4),
        ("lfo0", "osc0.table", 0.5),
        ("vel", "osc2.table", -0.6),
        ("lfo1", "filt0.type", 0.7),
        ("lfo0", "filt1.type", -0.7),
        ("lfo1", "filt.route", 0.6),
        ("lfo0", "lfo2.shape", 0.6),
        ("lfo1", "lfo3.shape", 0.5),
    ] {
        chosen.mods.push(Mod::new(src, dst, amt));
    }
    chosen.set_num("osc2.on", 1.0);
    let chosen = PatchState::new(&chosen);
    let mut synth = Synth::new(48_000.0, 512);
    synth.adopt(chosen);
    for (i, table) in tables.iter().enumerate() {
        synth.set_table(i, table.clone());
    }
    for (i, name) in BUILTIN_NAMES.iter().enumerate().take(4) {
        synth.set_bank_table(i, t(name));
    }
    let mut late = Some(t("Grit Saw"));
    let mut banked = None;
    let mut seen = Telemetry::default();
    COUNTING.store(true, Ordering::SeqCst);
    for round in 0..4u8 {
        for n in 0..12u8 {
            synth.note_on(40 + n * 3 + round, 0.3 + 0.05 * n as f32);
            synth.render(&mut left[..97], &mut right[..97]);
        }
        if round == 1 {
            banked = synth.set_bank_table(4, late.take().unwrap());
        }
        for _ in 0..8 {
            synth.render(&mut left, &mut right);
        }
        synth.telemetry(&mut seen);
        for n in 0..12u8 {
            synth.note_off(40 + n * 3 + round);
        }
        synth.render(&mut left, &mut right);
    }
    COUNTING.store(false, Ordering::SeqCst);
    assert_eq!(ALLOCS.load(Ordering::SeqCst), 0, "stepping choices allocated");
    assert!(banked.is_none() && synth.bank_table(4).is_some());
    assert_ne!(seen.choice_touched, 0);

    // v8b: Convolution and Spectral Dynamics on a board with their sounds.
    let ir: Vec<f32> = (0..4800).map(|i| (-(i as f32) / 600.0).exp() * if i % 7 == 0 { 1.0 } else { -0.3 }).collect();
    let sound = wave::board::Sound { samples: Arc::new(ir), channels: 1, rate: 48_000.0 };
    let sounded = Board {
        name: "sounds".into(),
        nodes: vec![
            n("v", "in:voice"),
            n("cv", "fx:convolution").with_sound("ir.wav"),
            n("sd", "fx:spectral-dynamics").with("useSound", 1.0).with_sound("ir.wav"),
            n("out", "out"),
        ],
        cables: vec![Cable::new("v", "o", "cv", "i"), Cable::new("cv", "o", "sd", "i"), Cable::new("sd", "o", "out", "i")],
    };
    let mut synth = Synth::new(48_000.0, 512);
    synth.set_table(0, tables[0].clone());
    synth.set_board(Box::new(BoardPlan::compile_with(&sounded, 48_000.0, &|_| Some(sound.clone())).unwrap()));
    let length = wave::board::Kind::parse("fx:convolution").unwrap().params().iter().position(|p| p.key == "lengthMs").unwrap();
    COUNTING.store(true, Ordering::SeqCst);
    for round in 0..4u8 {
        synth.note_on(50 + round, 0.8);
        synth.set_board_param(1, length, 20.0 + round as f32 * 25.0);
        for _ in 0..6 {
            synth.render(&mut left, &mut right);
        }
        synth.note_off(50 + round);
    }
    COUNTING.store(false, Ordering::SeqCst);
    assert_eq!(ALLOCS.load(Ordering::SeqCst), 0, "a board with sounds allocated");
    assert_eq!(telemetry.board().len(), 10);
    assert!(returned.is_some());
    assert!(left.iter().all(|v| v.is_finite()));
}
