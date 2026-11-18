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
use engine_mgl::Wave;
use std::sync::Arc;
use wave::{builtin_frames, param_id, Patch, PatchState, Synth, Wavetable};

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
