//! MultiGrainLive's grain deck as a module of the native engine.
//!
//! MGL keeps hashes of what the deck plays for each of five engines, with and
//! without layers and the cloud, under four scripts of keys and transport
//! (`engine/tests/grain_hashes.rs`). The same scripts are played here twice:
//! by the deck alone, as MGL's test does, and by the module in the engine
//! with every act a stamped message.

mod common;
use common::*;
use engine_core::*;
use engine_mgl::grain::{self, Grain, GrainThing};
use mgl_engine::stretcher::LayerBank;
use mgl_engine::{Core, GrainKeys, KeyMode, Shared, Source};
use mgl_fx::grain::{Grain as GrainSettings, StreamParams};
use mgl_fx::stretch::Algorithm;
use std::sync::Arc;

const RECORDED: &str =
    concat!(env!("CARGO_MANIFEST_DIR"), "/../../MultiGrainLive/core/crates/engine/tests/grain_hashes.rs");

const SR: u32 = 48_000;
const BLOCK: usize = 512;
const FILE: usize = 96_000;
const ENGINES: [Algorithm; 5] =
    [Algorithm::Granular, Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Pvsola, Algorithm::Hybrid];
const DECK: ModuleId = 1;
const NOTES: ModuleId = 2;

// ---- MGL's rig, as its test builds it.

fn source_from(mut seed: u32) -> Arc<Source> {
    let samples = (0..FILE)
        .flat_map(|i| {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let noise = ((seed >> 16) as f32 / 32768.0) - 1.0;
            let s = (i as f32 * 0.02).sin() * 0.4 + noise * 0.05;
            [s, s * 0.8]
        })
        .collect();
    Arc::new(Source { samples, channels: 2 })
}

fn source() -> Arc<Source> {
    source_from(7)
}

fn params(alg: Algorithm, ratio: f32, layers: u32, cloud: bool) -> StreamParams {
    StreamParams {
        in_frames: FILE,
        sample_rate: SR,
        ratio,
        semitones: 0.0,
        window_ms: 40.0,
        grain: GrainSettings { layers, ..GrainSettings::default() },
        algorithm: alg,
        wsola: mgl_fx::stretch::WsolaParams::default(),
        vocoder: mgl_fx::stretch::VocoderParams::default(),
        pvsola: mgl_fx::pvsola::PvsolaParams::default(),
        hybrid: mgl_fx::hybrid::HybridParams::default(),
        soundhack: Default::default(),
        cloud,
        cloud_mix: 0.5,
    }
}

#[derive(Clone, Copy)]
struct Setup {
    alg: Algorithm,
    layers: u32,
    cloud: bool,
    run: bool,
    played: bool,
    /// The deck's block.
    grid: usize,
}

fn rack(grid: usize) -> mgl_fx::Rack {
    let mut rack = mgl_fx::Rack::new();
    rack.push(Box::new(mgl_fx::Gain { db: -3.0 }));
    rack.reserve_mix(grid);
    rack
}

fn parts(setup: Setup, src: &Source, sp: &StreamParams) -> Option<Arc<mgl_fx::hstream::Parts>> {
    (setup.alg == Algorithm::Hybrid).then(|| Arc::new(mgl_fx::hstream::Parts::separate(&src.samples, 2, sp.hybrid)))
}

fn bank(setup: Setup) -> Option<LayerBank> {
    (setup.layers > 1).then(|| LayerBank::build(setup.alg, setup.layers, setup.grid, 2, SR))
}

#[derive(Clone)]
enum Act {
    Mode(KeyMode),
    On(u8, f32),
    Off(u8),
    AllOff,
    Bend(f32),
    Play,
    Pause,
    Sound(Arc<Source>),
    Settings(StreamParams),
}

/// A script: each act with the sample it is made on, and how long it runs.
struct Script {
    acts: Vec<(u64, Act)>,
    frames: usize,
}

const B: u64 = BLOCK as u64;

/// MGL's `played_notes`, its acts on the blocks MGL makes them on.
fn played_notes(mode: KeyMode) -> Script {
    Script {
        acts: vec![
            (0, Act::Mode(mode)),
            (4 * B, Act::On(60, 0.8)),
            (44 * B, Act::On(67, 0.6)),
            (84 * B, Act::Off(60)),
            (104 * B, Act::Bend(1.5)),
            (124 * B, Act::Off(67)),
            (164 * B, Act::Bend(0.0)),
            (164 * B, Act::On(55, 1.0)),
            (194 * B, Act::AllOff),
        ],
        frames: 234 * BLOCK,
    }
}

/// MGL's `no_notes`.
fn no_notes() -> Script {
    Script { acts: vec![(4 * B, Act::Play), (154 * B, Act::Pause)], frames: 174 * BLOCK }
}

/// FNV-1a over the bits of every sample, as MGL's test folds it.
fn hash(h: &mut u64, x: &[f32]) {
    for s in x {
        for b in s.to_bits().to_le_bytes() {
            *h ^= b as u64;
            *h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
}

const START_HASH: u64 = 0xcbf2_9ce4_8422_2325;

/// The deck alone, as MGL's test plays it: whole blocks, each act before the
/// first block that starts at or after its sample. Left and right interleaved.
fn alone(setup: Setup, script: &Script) -> Vec<f32> {
    let src = source();
    let sp = params(setup.alg, 2.0, setup.layers, setup.cloud);
    let shared = Shared::new(sp, Arc::clone(&src));
    if let Some(parts) = parts(setup, &src, &sp) {
        shared.set_parts(parts);
    }
    if let Some(bank) = bank(setup) {
        shared.set_bank(bank);
    }
    shared.set_rack(Some(rack(setup.grid)));
    let keys = Arc::new(GrainKeys::new());
    keys.set_run(setup.run);
    keys.set_amp(0.01, 0.05, 0.7, 0.05);
    keys.set_glide(0.02);
    keys.set_start(0.1);
    if setup.played {
        keys.set_played(true);
    }
    let mut core = Core::new(setup.grid, 2, sp, src).with_keys(Arc::clone(&keys));
    let mut out = Vec::with_capacity(script.frames * 2);
    let mut buf = vec![0f32; setup.grid * 2];
    let mut next = 0;
    let mut at = 0usize;
    while at < script.frames {
        while next < script.acts.len() && script.acts[next].0 <= at as u64 {
            match script.acts[next].1.clone() {
                Act::Mode(mode) => keys.set_mode(mode),
                Act::On(key, vel) => {
                    keys.note_on(key, vel);
                }
                Act::Off(key) => keys.note_off(key),
                Act::AllOff => keys.all_off(),
                Act::Bend(semis) => keys.set_bend(semis),
                Act::Play => shared.play(),
                Act::Pause => shared.pause(),
                Act::Sound(sound) => shared.set_source(sound),
                Act::Settings(sp) => shared.set_params(sp),
            }
            next += 1;
        }
        core.fill(&mut buf, 2, &shared);
        out.extend_from_slice(&buf);
        at += setup.grid;
    }
    out.truncate(script.frames * 2);
    out
}

fn knob(index: u32, value: f32) -> EventKind {
    EventKind::Param { index, value }
}

/// The module in the engine, set up as the rig is.
fn deck(setup: Setup) -> (Controller, AudioEngine) {
    let src = source();
    let sp = params(setup.alg, 2.0, setup.layers, setup.cloud);
    let mut deck = Grain::new(SR, setup.grid, sp, Arc::clone(&src)).rack(rack(setup.grid));
    if let Some(parts) = parts(setup, &src, &sp) {
        deck = deck.parts(parts);
    }
    if let Some(bank) = bank(setup) {
        deck = deck.bank(bank);
    }
    let (mut ctl, audio) = engine(SR as f32, exact());
    ctl.add(DECK, Box::new(deck)).unwrap();
    for message in [
        knob(grain::RUN, setup.run as u32 as f32),
        knob(grain::AMP_ATTACK, 0.01),
        knob(grain::AMP_DECAY, 0.05),
        knob(grain::AMP_SUSTAIN, 0.7),
        knob(grain::AMP_RELEASE, 0.05),
        knob(grain::KEY_GLIDE, 0.02),
        knob(grain::START, 0.1),
    ] {
        ctl.send(DECK, message).unwrap();
    }
    if setup.played {
        ctl.send(DECK, knob(grain::PLAYED, 1.0)).unwrap();
    }
    ctl.connect_out(port(DECK, 0)).unwrap();
    (ctl, audio)
}

fn mode_number(mode: KeyMode) -> f32 {
    match mode {
        KeyMode::Mono => 0.0,
        KeyMode::Legato => 1.0,
        KeyMode::Poly => 2.0,
    }
}

/// Every act of a script as a message stamped with its sample.
fn send(ctl: &mut Controller, script: &Script) {
    for (frame, act) in script.acts.iter().cloned() {
        let message = match act {
            Act::Mode(mode) => knob(grain::KEY_MODE, mode_number(mode)),
            Act::On(key, vel) => EventKind::Note(NoteEvent::on(key, vel)),
            Act::Off(key) => EventKind::Note(NoteEvent::off(key)),
            Act::AllOff => EventKind::Note(NoteEvent { kind: NoteKind::AllOff, ..NoteEvent::off(0) }),
            Act::Bend(semis) => knob(grain::BEND, semis),
            Act::Play => knob(grain::PLAY, 1.0),
            Act::Pause => knob(grain::PLAY, 0.0),
            Act::Sound(sound) => {
                ctl.give_at(frame, DECK, 0, Box::new(GrainThing::Source(sound))).unwrap();
                continue;
            }
            Act::Settings(sp) => {
                ctl.give_at(frame, DECK, 0, Box::new(GrainThing::Params(sp))).unwrap();
                continue;
            }
        };
        ctl.send_at(frame, DECK, message).unwrap();
    }
}

fn interleaved(l: &[f32], r: &[f32]) -> Vec<f32> {
    l.iter().zip(r).flat_map(|(a, b)| [*a, *b]).collect()
}

/// The module in the engine playing a script, the sound card asking for
/// `block` samples at a time (0: uneven blocks).
fn through_engine(setup: Setup, script: &Script, block: usize) -> Vec<f32> {
    let (mut ctl, mut audio) = deck(setup);
    ctl.commit().unwrap();
    send(&mut ctl, script);
    let (l, r) = if block == 0 {
        render_uneven(&mut audio, script.frames, 3)
    } else {
        render(&mut audio, script.frames, block)
    };
    interleaved(&l, &r)
}

/// MGL's four scripts for one engine, layer count and cloud, by MGL's names.
fn cases(alg: Algorithm, layers: u32, cloud: bool) -> Vec<(String, Setup, Script)> {
    let setup = |run, played| Setup { alg, layers, cloud, run, played, grid: BLOCK };
    let name = |label: &str| format!("{alg:?}/{layers}/{cloud}/{label}");
    vec![
        (name("mono"), setup(false, false), played_notes(KeyMode::Mono)),
        (name("legato"), setup(false, false), played_notes(KeyMode::Legato)),
        (name("run-idle"), setup(true, false), no_notes()),
        (name("play-no-run"), setup(false, true), no_notes()),
    ]
}

fn all_cases() -> Vec<(String, Setup, Script)> {
    let mut out = Vec::new();
    for alg in ENGINES {
        for (layers, cloud) in [(1u32, false), (3, false), (1, true)] {
            out.extend(cases(alg, layers, cloud));
        }
    }
    out
}

/// The hashes MGL's own test holds, read from its source.
fn recorded() -> Vec<(String, u64)> {
    let text = std::fs::read_to_string(RECORDED).expect("MGL's grain_hashes test");
    let from = text.find("const BASELINE").expect("its BASELINE table");
    let table = &text[from..from + text[from..].find("];").expect("the table's end")];
    table
        .lines()
        .filter_map(|line| {
            let line = line.trim().strip_prefix("(\"")?;
            let (name, rest) = line.split_once("\", 0x")?;
            let hex = rest.strip_suffix("),")?;
            Some((name.to_string(), u64::from_str_radix(hex, 16).ok()?))
        })
        .collect()
}

#[test]
fn the_deck_in_the_engine_plays_what_it_plays_alone() {
    let recorded = recorded();
    assert_eq!(recorded.len(), 60, "MGL's table of recorded hashes");
    let apple = cfg!(all(target_os = "macos", target_arch = "aarch64"));
    let mut bad = Vec::new();
    for (name, setup, script) in all_cases() {
        let want = alone(setup, &script);
        let got = through_engine(setup, &script, BLOCK);
        if let Some(i) = first_difference(&got, &want) {
            bad.push(format!("{name}: the engine differs from the deck alone at sample {}", i / 2));
        }
        // The recorded hashes are Apple silicon's.
        if apple {
            let mut h = START_HASH;
            hash(&mut h, &got);
            match recorded.iter().find(|(known, _)| *known == name) {
                Some((_, hash)) if *hash == h => {}
                Some((_, hash)) => bad.push(format!("{name}: {h:016x} (MGL recorded {hash:016x})")),
                None => bad.push(format!("{name}: MGL has no hash for it")),
            }
        }
    }
    assert!(bad.is_empty(), "{} of 60 differ:\n{}", bad.len(), bad.join("\n"));
}

/// Acts on samples no block starts on, a deck block of 64, and the sound
/// card's blocks cut every way.
#[test]
fn the_deck_does_not_depend_on_how_the_audio_is_cut() {
    for alg in [Algorithm::Granular, Algorithm::Wsola] {
        let setup = Setup { alg, layers: 1, cloud: false, run: false, played: false, grid: 64 };
        let script = Script {
            acts: vec![
                (1, Act::Mode(KeyMode::Legato)),
                (1_001, Act::On(60, 0.8)),
                (7_777, Act::On(67, 0.6)),
                (12_345, Act::Bend(1.5)),
                (15_000, Act::Off(60)),
                (20_480, Act::Off(67)),
                (22_222, Act::Play),
                (30_001, Act::Pause),
            ],
            frames: 36_000,
        };
        let want = alone(setup, &script);
        assert!(peak(&want) > 0.01, "{alg:?}: the script is heard");
        for block in [512, 64, 61, 1, 1000, 0] {
            let got = through_engine(setup, &script, block);
            assert_same(&format!("{alg:?}, blocks of {block}"), &got, &want);
        }
    }
}

#[test]
fn notes_down_a_cable_play_the_deck_the_same() {
    let setup = Setup { alg: Algorithm::Granular, layers: 1, cloud: false, run: false, played: false, grid: 64 };
    let notes: Vec<(u64, NoteEvent)> = vec![
        (1_001, NoteEvent::on(60, 0.8)),
        (7_777, NoteEvent::on(67, 0.6)),
        (15_000, NoteEvent::off(60)),
        (20_480, NoteEvent::off(67)),
    ];
    let script = Script {
        acts: notes
            .iter()
            .map(|(frame, note)| match note.kind {
                NoteKind::On => (*frame, Act::On(note.note, note.velocity)),
                _ => (*frame, Act::Off(note.note)),
            })
            .collect(),
        frames: 30_000,
    };
    let want = alone(setup, &script);
    assert!(peak(&want) > 0.01);
    for block in [512, 61, 0] {
        let (mut ctl, mut audio) = deck(setup);
        ctl.add(NOTES, Box::new(Script2::new(notes.clone()))).unwrap();
        ctl.connect(port(NOTES, 0), port(DECK, 0)).unwrap();
        ctl.commit().unwrap();
        let (l, r) = if block == 0 { render_uneven(&mut audio, script.frames, 5) } else { render(&mut audio, script.frames, block) };
        assert_same(&format!("blocks of {block}"), &interleaved(&l, &r), &want);
    }
}

// The note player from `common`, under a name that doesn't clash with the
// script type here.
use common::Script as Script2;

/// A new sound and new settings handed over while it plays land on their
/// samples, and the old sound comes back to be freed on the app's thread.
#[test]
fn a_new_sound_and_new_settings_are_handed_over_while_it_plays() {
    let setup = Setup { alg: Algorithm::Wsola, layers: 1, cloud: false, run: false, played: true, grid: 64 };
    let faster = params(Algorithm::Wsola, 1.5, 1, false);
    let script = Script {
        acts: vec![
            (100, Act::Play),
            (9_000, Act::Sound(source_from(99))),
            (18_001, Act::Settings(faster)),
        ],
        frames: 30_000,
    };
    let want = alone(setup, &script);
    let unchanged = alone(setup, &Script { acts: vec![(100, Act::Play)], frames: 30_000 });
    let first = first_difference(&want, &unchanged).expect("the new sound is heard") / 2;
    // Not on the very next line: the engine has already read a little ahead
    // in the old sound (729 samples here).
    assert!((9_000..11_000).contains(&first), "the new sound is heard soon after its sample: {first}");

    let (mut ctl, mut audio) = deck(setup);
    ctl.commit().unwrap();
    send(&mut ctl, &script);
    let (l, r) = render(&mut audio, script.frames, 128);
    assert_same("handed over through the engine", &interleaved(&l, &r), &want);
    // Two boxes came back: the one that brought the settings, and the one
    // that brought the new sound, now carrying the old sound.
    assert_eq!(ctl.collect().things, 2);
}

/// From its very first block the deck allocates nothing and frees nothing:
/// playing keys, taking a new sound, taking new settings. (Before MGL's fix
/// of 18 Nov it grew its list of grains on the audio thread, and freed a
/// replaced sound there.)
#[test]
fn the_deck_does_not_allocate_from_its_first_block() {
    assert_the_check_is_on();
    let setup = Setup { alg: Algorithm::Granular, layers: 1, cloud: true, run: false, played: false, grid: 128 };
    let (mut ctl, mut audio) = deck(setup);
    ctl.commit().unwrap();
    let mut acts = vec![(0, Act::Mode(KeyMode::Mono)), (512, Act::On(60, 0.8)), (4_000, Act::Play)];
    for i in 0..20u64 {
        let at = 6_001 + i * 3_001;
        acts.push((at, Act::On(48 + (i % 24) as u8, 0.7)));
        acts.push((at + 1_500, Act::Bend((i % 5) as f32 - 2.0)));
        acts.push((at + 2_500, Act::Off(48 + (i % 24) as u8)));
    }
    acts.push((30_000, Act::Sound(source_from(99))));
    acts.push((45_000, Act::Settings(params(Algorithm::Granular, 1.5, 1, true))));
    acts.sort_by_key(|(frame, _)| *frame);
    send(&mut ctl, &Script { acts, frames: 0 });
    let before = counted();
    let (l, _) = render(&mut audio, 20 * 3_001 + 10_000, 128);
    assert!(peak(&l) > 0.01, "it is heard");
    assert_eq!(counted(), before, "allocations or frees inside a render; the last sizes: {:?}", last_sizes());
    assert_eq!(ctl.collect().things, 2, "the two boxes came back, one with the old sound in it");
}

/// What the deck itself retires (here, racks it has faded out of) is freed
/// by the app through the deck's collector, never on the audio thread.
#[test]
fn what_the_deck_retires_is_freed_by_the_collector() {
    assert_the_check_is_on();
    let setup = Setup { alg: Algorithm::Wsola, layers: 3, cloud: false, run: true, played: false, grid: 128 };
    let src = source();
    let sp = params(setup.alg, 2.0, setup.layers, setup.cloud);
    let deck = Grain::new(SR, setup.grid, sp, Arc::clone(&src)).rack(rack(setup.grid)).bank(bank(setup).unwrap());
    let collector = deck.collector();
    let (mut ctl, mut audio) = engine(SR as f32, exact());
    ctl.add(DECK, Box::new(deck)).unwrap();
    ctl.connect_out(port(DECK, 0)).unwrap();
    ctl.commit().unwrap();
    ctl.send(DECK, knob(grain::PLAY, 1.0)).unwrap();
    let before = counted();
    let (l, _) = render(&mut audio, 20_000, 128);
    assert!(peak(&l) > 0.01, "it is heard");
    assert_eq!(counted(), before, "allocations or frees inside a render");
    // Collecting from this thread while the deck plays on costs the audio
    // thread nothing either.
    collector.collect();
    render(&mut audio, 4_000, 128);
    assert_eq!(counted(), before);
}
