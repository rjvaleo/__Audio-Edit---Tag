//! The Wave synth as a module of the native engine, against the bare synth.
//!
//! The synth works in control blocks of 32 samples, counted from the start
//! of each call, so what it plays depends on how its caller cuts the audio.
//! The module always asks it for whole blocks of 32 on fixed lines, and a
//! note or a knob takes effect on the first line at or after its sample. That
//! is at most 31 samples late (0.65 ms), where MultiGrainLive today takes
//! notes once per sound card block (21 ms at its usual 1,024).

mod common;
use common::*;
use engine_core::*;
use engine_mgl::{Wave, WaveThing};
use std::sync::Arc;
use wave::board::{input_nodes, Board, Cable, Node};
use wave::{builtin_frames, param_id, BoardPlan, Patch, PatchState, Synth, Wavetable};

const N: usize = 36_000;
const WAVE: ModuleId = 1;
const NOTES: ModuleId = 2;
const SEED: u32 = 7;

#[derive(Clone, Copy)]
enum Act {
    On(u8, f32),
    Off(u8),
    AllOff,
    Knob(&'static str, f32),
    Bend(f32),
    Wheel(f32),
    Touch(f32),
}

fn tables() -> [Arc<Wavetable>; 3] {
    ["Formant Sweep", "Vowel Ah–Oo", "Glass Organ"]
        .map(|name| Arc::new(Wavetable::from_frames(&builtin_frames(name).expect("a built-in table"))))
}

/// A short performance. No sample here is a multiple of 32 unless it says so.
fn performance() -> Vec<(u64, Act)> {
    vec![
        (1, Act::On(48, 0.8)),
        (1_000, Act::On(55, 0.6)),
        (2_048, Act::On(60, 0.7)), // on a line
        (3_333, Act::Knob("filt0.cut", 0.35)),
        (5_001, Act::Wheel(0.7)),
        (6_417, Act::Bend(0.4)),
        (8_191, Act::On(64, 0.9)),
        (9_999, Act::Knob("filt0.cut", 0.9)),
        (11_111, Act::Touch(0.5)),
        (12_345, Act::Off(55)),
        (12_345, Act::Off(48)),
        (15_000, Act::Knob("master", 0.6)),
        (20_001, Act::Bend(0.0)),
        (24_000, Act::AllOff),
    ]
}

fn notes_only() -> Vec<(u64, Act)> {
    performance().into_iter().filter(|(_, act)| matches!(act, Act::On(..) | Act::Off(..) | Act::AllOff)).collect()
}

fn knob_number(key: &str) -> u32 {
    param_id(key).unwrap_or_else(|| panic!("the synth has no knob called {key}")).0 as u32
}

fn message(act: Act) -> EventKind {
    match act {
        Act::On(note, velocity) => EventKind::Note(NoteEvent::on(note, velocity)),
        Act::Off(note) => EventKind::Note(NoteEvent::off(note)),
        Act::AllOff => EventKind::Note(NoteEvent { kind: NoteKind::AllOff, ..NoteEvent::off(0) }),
        Act::Knob(key, value) => EventKind::Param { index: knob_number(key), value },
        Act::Bend(value) => EventKind::Param { index: Wave::BEND, value },
        Act::Wheel(value) => EventKind::Param { index: Wave::MOD_WHEEL, value },
        Act::Touch(value) => EventKind::Param { index: Wave::AFTERTOUCH, value },
    }
}

/// The synth alone: whole blocks of 32, each act before the first block that
/// starts at or after its sample.
fn alone(script: &[(u64, Act)]) -> (Vec<f32>, Vec<f32>) {
    let mut synth = Synth::new(RATE, Wave::GRID);
    synth.adopt(PatchState::new(&Patch::default()));
    synth.set_seed(SEED);
    for (osc, table) in tables().into_iter().enumerate() {
        synth.set_table(osc, table);
    }
    let mut l = vec![0.0; N];
    let mut r = vec![0.0; N];
    let mut next = 0;
    let mut at = 0;
    while at < N {
        while next < script.len() && script[next].0 <= at as u64 {
            match script[next].1 {
                Act::On(note, velocity) => synth.note_on(note, velocity),
                Act::Off(note) => synth.note_off(note),
                Act::AllOff => synth.all_notes_off(),
                Act::Knob(key, value) => {
                    synth.set_param(param_id(key).unwrap(), value);
                }
                Act::Bend(value) => synth.bend(value),
                Act::Wheel(value) => synth.mod_wheel(value),
                Act::Touch(value) => synth.aftertouch(value),
            }
            next += 1;
        }
        let end = (at + Wave::GRID).min(N);
        synth.render(&mut l[at..end], &mut r[at..end]);
        at = end;
    }
    (l, r)
}

fn module() -> Wave {
    let mut wave = Wave::new(RATE).patch(PatchState::new(&Patch::default())).seed(SEED);
    for (osc, table) in tables().into_iter().enumerate() {
        wave = wave.table(osc, table);
    }
    wave
}

/// The module in the engine, every act a message stamped with its sample.
fn sent(script: &[(u64, Act)]) -> (Controller, AudioEngine) {
    let (mut ctl, audio) = engine(RATE, exact());
    ctl.add(WAVE, Box::new(module())).unwrap();
    ctl.connect_out(port(WAVE, 0)).unwrap();
    ctl.commit().unwrap();
    for &(frame, act) in script {
        ctl.send_at(frame, WAVE, message(act)).unwrap();
    }
    (ctl, audio)
}

/// The module in the engine, its notes arriving down a cable.
fn cabled(script: &[(u64, Act)]) -> (Controller, AudioEngine) {
    let notes = script
        .iter()
        .map(|&(frame, act)| match message(act) {
            EventKind::Note(note) => (frame, note),
            _ => panic!("only notes go down the cable"),
        })
        .collect();
    let (mut ctl, audio) = engine(RATE, exact());
    ctl.add(WAVE, Box::new(module())).unwrap();
    ctl.add(NOTES, Box::new(Script::new(notes))).unwrap();
    ctl.connect(port(NOTES, 0), port(WAVE, 0)).unwrap();
    ctl.connect_out(port(WAVE, 0)).unwrap();
    ctl.commit().unwrap();
    (ctl, audio)
}

#[test]
fn the_module_plays_what_the_synth_plays_alone() {
    let (want_l, want_r) = alone(&performance());
    assert!(peak(&want_l) > 0.05 && peak(&want_r) > 0.05, "the performance is heard: peak {}", peak(&want_l));
    let (_ctl, mut audio) = sent(&performance());
    let (l, r) = render(&mut audio, N, 512);
    assert_same("left", &l, &want_l);
    assert_same("right", &r, &want_r);
}

#[test]
fn the_module_does_not_depend_on_how_the_audio_is_cut() {
    let (want_l, want_r) = alone(&performance());
    for block in [1, 7, 31, 32, 33, 64, 1000] {
        let (_ctl, mut audio) = sent(&performance());
        let (l, r) = render(&mut audio, N, block);
        assert_same(&format!("left, blocks of {block}"), &l, &want_l);
        assert_same(&format!("right, blocks of {block}"), &r, &want_r);
    }
    let (_ctl, mut audio) = sent(&performance());
    let (l, r) = render_uneven(&mut audio, N, 5);
    assert_same("left, uneven blocks", &l, &want_l);
    assert_same("right, uneven blocks", &r, &want_r);
}

#[test]
fn notes_down_a_cable_play_the_same() {
    let (want_l, want_r) = alone(&notes_only());
    assert!(peak(&want_l) > 0.05);
    for block in [512, 61] {
        let (_ctl, mut audio) = cabled(&notes_only());
        let (l, r) = render(&mut audio, N, block);
        assert_same(&format!("left, blocks of {block}"), &l, &want_l);
        assert_same(&format!("right, blocks of {block}"), &r, &want_r);
    }
    let (_ctl, mut audio) = cabled(&notes_only());
    let (l, r) = render_uneven(&mut audio, N, 9);
    assert_same("left, uneven blocks", &l, &want_l);
    assert_same("right, uneven blocks", &r, &want_r);
}

#[test]
fn a_note_starts_on_the_next_line_of_32() {
    // Sample 1,000 is between lines; the next is 1,024.
    let (_ctl, mut audio) = sent(&[(1_000, Act::On(60, 1.0))]);
    let (l, r) = render(&mut audio, 6_000, 512);
    assert!(l[..1_024].iter().chain(&r[..1_024]).all(|v| *v == 0.0), "nothing sounds before the line");
    assert!(peak(&l[1_024..]) > 0.01, "the note sounds after it: peak {}", peak(&l[1_024..]));
    // A note on a line starts on it.
    let (_ctl, mut audio) = sent(&[(1_024, Act::On(60, 1.0))]);
    let (on_l, _) = render(&mut audio, 6_000, 512);
    assert_same("a note 24 samples early and a note on the line", &l, &on_l);
}

#[test]
fn the_module_does_not_allocate_on_the_audio_thread() {
    assert_the_check_is_on();
    let (_ctl, mut audio) = sent(&performance());
    let before = counted();
    let (l, _) = render(&mut audio, N, 128);
    assert_eq!(counted(), before, "allocations or frees inside a render");
    assert!(peak(&l) > 0.05);
    let (_ctl, mut audio) = cabled(&notes_only());
    let before = counted();
    render(&mut audio, N, 128);
    assert_eq!(counted(), before, "allocations or frees inside a render, notes on a cable");
}

// ---- Tables, a patch and an effects board handed over while it plays.

fn table(name: &str) -> Arc<Wavetable> {
    Arc::new(Wavetable::from_frames(&builtin_frames(name).expect("a built-in table")))
}

/// A patch that plainly differs from the default: one oscillator, shut filter.
fn other_patch() -> PatchState {
    let mut p = Patch::default();
    p.set_num("osc1.on", 0.0);
    p.set_num("osc2.on", 0.0);
    p.set_num("filt0.cut", 0.3);
    PatchState::new(&p)
}

/// The patch's own effects as a board, and a plainly different one: the
/// voice through a gain 12 dB down.
fn board(quiet: bool) -> Box<BoardPlan> {
    let b = if quiet {
        let mut nodes = input_nodes();
        nodes.push(Node::new("out", "out", 600.0, 16.0));
        nodes.push(Node::new("g", "gain", 300.0, 16.0).with("db", -12.0));
        Board {
            name: "quiet".into(),
            nodes,
            cables: vec![Cable::new("invoice", "o", "g", "i"), Cable::new("g", "o", "out", "i")],
        }
    } else {
        Board::migrate(&Patch::default().values)
    };
    Box::new(BoardPlan::compile(&b, RATE).unwrap_or_else(|e| panic!("{e}")))
}

#[derive(Clone, Copy)]
enum Swap {
    Table(usize, &'static str),
    Patch,
    Board(bool),
}

/// Held notes, and what is swapped under them, each with its sample.
const HELD: [(u64, u8); 3] = [(1, 45), (700, 52), (1_300, 57)];
fn swaps() -> Vec<(u64, Swap)> {
    vec![
        (4_001, Swap::Board(false)),
        (9_000, Swap::Table(0, "Glass Organ")),
        (13_333, Swap::Board(true)),
        (13_400, Swap::Board(false)),
        (18_000, Swap::Patch),
        (22_222, Swap::Table(1, "Formant Sweep")),
        (26_000, Swap::Board(true)),
    ]
}
const SWAP_FRAMES: usize = 32_000;

/// The synth alone: each swap before the first block of 32 that starts at
/// or after its sample, as MGL's deck makes them between its blocks.
fn swapped_alone() -> (Vec<f32>, Vec<f32>) {
    let mut synth = Synth::new(RATE, Wave::GRID);
    synth.adopt(PatchState::new(&Patch::default()));
    synth.set_seed(SEED);
    for (osc, t) in tables().into_iter().enumerate() {
        synth.set_table(osc, t);
    }
    let swaps = swaps();
    let mut l = vec![0.0; SWAP_FRAMES];
    let mut r = vec![0.0; SWAP_FRAMES];
    let (mut next_note, mut next_swap, mut at) = (0, 0, 0);
    while at < SWAP_FRAMES {
        while next_note < HELD.len() && HELD[next_note].0 <= at as u64 {
            synth.note_on(HELD[next_note].1, 0.9);
            next_note += 1;
        }
        while next_swap < swaps.len() && swaps[next_swap].0 <= at as u64 {
            drop(synth.take_retired());
            match swaps[next_swap].1 {
                Swap::Table(osc, name) => drop(synth.set_table(osc, table(name))),
                Swap::Patch => synth.adopt(other_patch()),
                Swap::Board(quiet) => drop(synth.set_board(board(quiet))),
            }
            next_swap += 1;
        }
        let end = (at + Wave::GRID).min(SWAP_FRAMES);
        synth.render(&mut l[at..end], &mut r[at..end]);
        at = end;
    }
    (l, r)
}

fn swapped_in_the_engine() -> (Controller, AudioEngine) {
    let (mut ctl, audio) = engine(RATE, exact());
    ctl.add(WAVE, Box::new(module())).unwrap();
    ctl.connect_out(port(WAVE, 0)).unwrap();
    ctl.commit().unwrap();
    for (frame, key) in HELD {
        ctl.send_at(frame, WAVE, EventKind::Note(NoteEvent::on(key, 0.9))).unwrap();
    }
    for (frame, swap) in swaps() {
        let thing = match swap {
            Swap::Table(osc, name) => WaveThing::Table(osc, table(name)),
            Swap::Patch => WaveThing::Patch(other_patch()),
            Swap::Board(quiet) => WaveThing::Board(board(quiet)),
        };
        ctl.give_at(frame, WAVE, 0, Box::new(thing)).unwrap();
    }
    (ctl, audio)
}

#[test]
fn tables_a_patch_and_a_board_are_handed_over_while_it_plays() {
    let (want_l, want_r) = swapped_alone();
    assert!(peak(&want_l) > 0.05, "the held notes are heard: {}", peak(&want_l));
    let (plain_l, _) = alone(&[(1, Act::On(45, 0.9)), (700, Act::On(52, 0.9)), (1_300, Act::On(57, 0.9))]);
    assert!(first_difference(&want_l, &plain_l[..SWAP_FRAMES]).is_some(), "the swaps change the sound");
    for block in [512, 61, 1000] {
        let (_ctl, mut audio) = swapped_in_the_engine();
        let (l, r) = render(&mut audio, SWAP_FRAMES, block);
        assert_same(&format!("left, blocks of {block}"), &l, &want_l);
        assert_same(&format!("right, blocks of {block}"), &r, &want_r);
    }
}

#[test]
fn what_the_synth_is_handed_costs_the_audio_thread_no_memory_and_comes_back() {
    assert_the_check_is_on();
    let (mut ctl, mut audio) = swapped_in_the_engine();
    let before = counted();
    let (l, _) = render(&mut audio, SWAP_FRAMES, 128);
    assert!(peak(&l) > 0.05);
    assert_eq!(counted(), before, "allocations or frees inside a render; the last sizes: {:?}", last_sizes());
    // Seven boxes, and the boards the synth has finished with: the three it
    // faded out of, and the one cut short by the next 67 samples later.
    assert_eq!(ctl.collect().things, 7 + 3);
}

#[test]
fn a_boards_controls_are_knobs() {
    let moves = |ctl: &mut Controller| {
        ctl.send_at(6_000, WAVE, EventKind::Param { index: Wave::board_switch(0), value: 0.0 }).unwrap();
        ctl.send_at(9_000, WAVE, EventKind::Param { index: Wave::board_switch(0), value: 1.0 }).unwrap();
    };
    let play = |with_moves: bool| {
        let (mut ctl, mut audio) = engine(RATE, exact());
        ctl.add(WAVE, Box::new(module())).unwrap();
        ctl.connect_out(port(WAVE, 0)).unwrap();
        ctl.commit().unwrap();
        ctl.give(WAVE, 0, Box::new(WaveThing::Board(board(false)))).unwrap();
        ctl.send_at(100, WAVE, EventKind::Note(NoteEvent::on(48, 0.9))).unwrap();
        if with_moves {
            moves(&mut ctl);
        }
        render(&mut audio, 12_000, 128).0
    };
    let plain = play(false);
    let moved = play(true);
    let first = first_difference(&moved, &plain).expect("switching a node out is heard");
    assert!((6_000..6_032).contains(&first), "from the line after its sample: {first}");
}

#[test]
fn a_held_wave_note_survives_output_rate_changes_without_audio_heap_work() {
    assert_the_check_is_on();
    let (mut ctl, mut audio) = engine(48000.0, Config { max_block: 512, fade_frames: 480, ..Config::default() });
    ctl.add(1, Box::new(engine_mgl::demo::wave(48000.0))).unwrap();
    ctl.add(2, Box::new(engine_mgl::Fx::new("gain", 48000.0).unwrap().set(0, -18.0))).unwrap();
    ctl.connect(port(1,0), port(2,0)).unwrap(); ctl.connect_out(port(2,0)).unwrap(); ctl.commit().unwrap();
    ctl.send(1, EventKind::Note(NoteEvent::on(48, 0.8))).unwrap();
    let mut l=[0.0;512]; let mut r=l;
    for _ in 0..16 { audio.render(&mut l,&mut r); }
    for rate in [44100.0,48000.0] {
        ctl.set_rate(rate).unwrap();
        let before=counted(); let mut last=l[511]; let mut jump=0.0f32;
        for _ in 0..32 {
            audio.render(&mut l,&mut r);
            assert!(l.iter().all(|v| v.is_finite()));
            for &v in &l { jump=jump.max((v-last).abs()); last=v; }
            assert!(l.iter().map(|v| v*v).sum::<f32>() > 1.0e-8, "held note went silent");
        }
        assert!(jump < 0.05, "largest sample step {jump}");
        assert_eq!(counted(),before,"heap activity in rate switch");
        ctl.collect();
    }
}
