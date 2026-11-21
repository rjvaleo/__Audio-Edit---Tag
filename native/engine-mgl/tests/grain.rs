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
use mgl_engine::transport::PitchTime;
use mgl_engine::{Core, GrainKeys, KeyMode, Shared, Source};
use mgl_fx::transient::TimeMap;
use mgl_fx::grain::{Grain as GrainSettings, StreamParams};
use mgl_fx::stretch::Algorithm;
use std::sync::Arc;

const RECORDED: &str =
    concat!(env!("CARGO_MANIFEST_DIR"), "/../../core/crates/engine/tests/grain_hashes.rs");

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

/// Poly, set up the same way for the deck alone and for the module.
#[derive(Clone, Copy)]
struct Poly {
    voices: usize,
    /// Copies of the sound an octave or more up, for keys above C8.
    octaves: bool,
}

fn alone_in_poly(setup: Setup, poly: Poly, script: &Script) -> Vec<f32> {
    alone_with(setup, Some(poly), script)
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
    /// A rack of one gain at this many dB, or no rack.
    Rack(Option<f32>),
    /// A bank for this many layers.
    Bank(u32),
    /// The separated parts of the sound made from this seed.
    Parts(u32),
    /// A straight-line map at this ratio, or none.
    Map(Option<f32>),
    Seek(u64),
    Loop(bool, u64, u64),
    Pitch(PitchTime),
    PostRoll(u64),
    Gain(f32),
    Mute(bool),
    Speed(f32),
    Smoothing(f32),
    Sides(f32, f32),
}

fn rack_at(db: f32, grid: usize) -> mgl_fx::Rack {
    let mut rack = mgl_fx::Rack::new();
    rack.push(Box::new(mgl_fx::Gain { db }));
    rack.reserve_mix(grid * 2);
    rack
}

fn bank_of(layers: u32, grid: usize) -> LayerBank {
    LayerBank::build(Algorithm::Wsola, layers, grid, 2, SR)
}

fn parts_of(seed: u32) -> Arc<mgl_fx::hstream::Parts> {
    let sp = params(Algorithm::Wsola, 2.0, 1, false);
    Arc::new(mgl_fx::hstream::Parts::separate(&source_from(seed).samples, 2, sp.hybrid))
}

fn map_at(ratio: f32) -> TimeMap {
    TimeMap::linear(FILE, ratio)
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
    alone_with(setup, None, script)
}

fn alone_with(setup: Setup, poly: Option<Poly>, script: &Script) -> Vec<f32> {
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
    if let Some(poly) = poly {
        // As MGL's own Poly tests do: no clock, a fixed number of voices.
        shared.voices.set_offline(true);
        shared.voices.set_ceiling(poly.voices as u32);
        mgl_engine::voices::stock(&shared, poly.voices, setup.grid, 2);
        if poly.octaves {
            shared.build_octaves();
        }
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
                Act::Rack(db) => shared.set_rack(db.map(|db| rack_at(db, setup.grid))),
                Act::Bank(layers) => shared.set_bank(bank_of(layers, setup.grid)),
                Act::Parts(seed) => shared.set_parts(parts_of(seed)),
                Act::Map(ratio) => shared.set_map(ratio.map(map_at)),
                Act::Seek(frame) => shared.request_seek(frame),
                Act::Loop(on, a, b) => shared.set_loop(on, a, b),
                Act::Pitch(pt) => shared.set_pitch_time(pt),
                Act::PostRoll(frames) => shared.set_post_roll_frames(frames),
                Act::Gain(gain) => shared.set_gain(gain),
                Act::Mute(on) => shared.set_mute(on),
                Act::Speed(rate) => shared.set_speed(rate),
                Act::Smoothing(amount) => shared.set_glide(amount),
                Act::Sides(l, r) => shared.set_side_gains(l, r),
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
    deck_with(setup, None)
}

fn deck_with(setup: Setup, poly: Option<Poly>) -> (Controller, AudioEngine) {
    let src = source();
    let sp = params(setup.alg, 2.0, setup.layers, setup.cloud);
    let mut deck = Grain::new(SR, setup.grid, sp, Arc::clone(&src)).rack(rack(setup.grid));
    if let Some(poly) = poly {
        deck = deck.poly(poly.voices);
        if poly.octaves {
            deck = deck.octaves();
        }
    }
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

/// Every act of a script as a message stamped with its sample. `grid` is
/// the deck's block, which racks and banks are sized for.
fn send(ctl: &mut Controller, script: &Script) {
    send_with(ctl, script, BLOCK)
}

fn send_with(ctl: &mut Controller, script: &Script, grid: usize) {
    for (frame, act) in script.acts.iter().cloned() {
        let thing = match &act {
            Act::Sound(sound) => Some(GrainThing::Source(Arc::clone(sound))),
            Act::Settings(sp) => Some(GrainThing::Params(*sp)),
            Act::Rack(db) => Some(GrainThing::Rack(db.map(|db| rack_at(db, grid)))),
            Act::Bank(layers) => Some(GrainThing::Bank(bank_of(*layers, grid))),
            Act::Parts(seed) => Some(GrainThing::Parts(parts_of(*seed))),
            Act::Map(ratio) => Some(GrainThing::Map(ratio.map(|ratio| Arc::new(map_at(ratio))))),
            Act::Seek(frame) => Some(GrainThing::Seek(*frame)),
            Act::Loop(on, a, b) => Some(GrainThing::Loop { on: *on, a: *a, b: *b }),
            Act::Pitch(pt) => Some(GrainThing::PitchTime(*pt)),
            Act::PostRoll(frames) => Some(GrainThing::PostRoll(*frames)),
            _ => None,
        };
        if let Some(thing) = thing {
            ctl.give_at(frame, DECK, 0, Box::new(thing)).unwrap();
            continue;
        }
        let message = match act {
            Act::Mode(mode) => knob(grain::KEY_MODE, mode_number(mode)),
            Act::On(key, vel) => EventKind::Note(NoteEvent::on(key, vel)),
            Act::Off(key) => EventKind::Note(NoteEvent::off(key)),
            Act::AllOff => EventKind::Note(NoteEvent { kind: NoteKind::AllOff, ..NoteEvent::off(0) }),
            Act::Bend(semis) => knob(grain::BEND, semis),
            Act::Play => knob(grain::PLAY, 1.0),
            Act::Pause => knob(grain::PLAY, 0.0),
            Act::Gain(gain) => knob(grain::GAIN, gain),
            Act::Mute(on) => knob(grain::MUTE, on as u32 as f32),
            Act::Speed(rate) => knob(grain::SPEED, rate),
            Act::Smoothing(amount) => knob(grain::SMOOTHING, amount),
            Act::Sides(l, r) => {
                ctl.send_at(frame, DECK, knob(grain::SIDE_LEFT, l)).unwrap();
                knob(grain::SIDE_RIGHT, r)
            }
            _ => unreachable!("handed over as a thing, above"),
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
/// by the app through the deck's handle, never on the audio thread.
#[test]
fn what_the_deck_retires_is_freed_through_its_handle() {
    assert_the_check_is_on();
    let setup = Setup { alg: Algorithm::Wsola, layers: 3, cloud: false, run: true, played: false, grid: 128 };
    let src = source();
    let sp = params(setup.alg, 2.0, setup.layers, setup.cloud);
    let deck = Grain::new(SR, setup.grid, sp, Arc::clone(&src)).rack(rack(setup.grid)).bank(bank(setup).unwrap());
    let handle = deck.handle();
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
    handle.collect();
    render(&mut audio, 4_000, 128);
    assert_eq!(counted(), before);
}

/// Every control the deck has in MGL, moved while it plays: each lands as
/// MGL's own setter does on the same line of the grid.
#[test]
fn the_decks_other_controls_land_as_mgls_setters_do() {
    let setup = Setup { alg: Algorithm::Wsola, layers: 3, cloud: false, run: true, played: false, grid: 128 };
    let pitch = PitchTime { on: true, speed: 150.0, pitch: 80.0, ..PitchTime::default() };
    let script = Script {
        acts: vec![
            (100, Act::Play),
            (3_000, Act::Gain(0.5)),
            (5_001, Act::Sides(0.9, 0.4)),
            (7_000, Act::Speed(1.5)),
            (9_999, Act::Loop(true, 20_000, 60_000)),
            (12_000, Act::Seek(30_000)),
            (15_001, Act::Smoothing(40.0)),
            (17_000, Act::Pitch(pitch)),
            (22_000, Act::Speed(1.0)),
            (25_000, Act::Mute(true)),
            (27_000, Act::Mute(false)),
            (29_000, Act::Loop(false, 0, 0)),
            (30_000, Act::PostRoll(4_800)),
            (33_000, Act::Pitch(PitchTime::default())),
            (36_000, Act::Gain(1.0)),
        ],
        frames: 44_000,
    };
    let want = alone(setup, &script);
    assert!(peak(&want) > 0.01, "the script is heard");
    let plain = alone(setup, &Script { acts: vec![(100, Act::Play)], frames: 44_000 });
    assert!(first_difference(&want, &plain).is_some(), "and the controls change it");
    for block in [128, 512, 61, 0] {
        let (mut ctl, mut audio) = deck(setup);
        ctl.commit().unwrap();
        send_with(&mut ctl, &script, setup.grid);
        let (l, r) =
            if block == 0 { render_uneven(&mut audio, script.frames, 7) } else { render(&mut audio, script.frames, block) };
        assert_same(&format!("blocks of {block}"), &interleaved(&l, &r), &want);
    }
}

/// A new rack, bank of layers, separation and transient map handed over
/// while it plays, each on its sample: the same sound as MGL's setters, no
/// memory touched on the audio thread, and every box back with the app.
#[test]
fn a_rack_a_bank_parts_and_a_map_are_handed_over_while_it_plays() {
    assert_the_check_is_on();
    let setup = Setup { alg: Algorithm::Wsola, layers: 3, cloud: false, run: true, played: false, grid: 128 };
    let script = Script {
        acts: vec![
            (100, Act::Play),
            (4_000, Act::Rack(Some(-9.0))),
            (9_000, Act::Bank(2)),
            (13_000, Act::Parts(99)),
            (17_000, Act::Map(Some(3.0))),
            (21_000, Act::Rack(Some(-12.0))),
            (21_000, Act::Rack(Some(-1.0))),
            (26_000, Act::Map(None)),
            (30_000, Act::Rack(None)),
        ],
        frames: 36_000,
    };
    let want = alone(setup, &script);
    let plain = alone(setup, &Script { acts: vec![(100, Act::Play)], frames: 36_000 });
    assert!(first_difference(&want, &plain).is_some(), "the hand-overs change the sound");

    let src = source();
    let sp = params(setup.alg, 2.0, setup.layers, setup.cloud);
    let deck = Grain::new(SR, setup.grid, sp, Arc::clone(&src)).rack(rack(setup.grid)).bank(bank(setup).unwrap());
    let handle = deck.handle();
    let (mut ctl, mut audio) = engine(SR as f32, exact());
    ctl.add(DECK, Box::new(deck)).unwrap();
    ctl.send(DECK, knob(grain::RUN, 1.0)).unwrap();
    for message in [
        knob(grain::AMP_ATTACK, 0.01),
        knob(grain::AMP_DECAY, 0.05),
        knob(grain::AMP_SUSTAIN, 0.7),
        knob(grain::AMP_RELEASE, 0.05),
        knob(grain::KEY_GLIDE, 0.02),
        knob(grain::START, 0.1),
    ] {
        ctl.send(DECK, message).unwrap();
    }
    ctl.connect_out(port(DECK, 0)).unwrap();
    ctl.commit().unwrap();
    send_with(&mut ctl, &script, setup.grid);
    let before = counted();
    let (l, r) = render(&mut audio, script.frames, 128);
    assert_eq!(counted(), before, "allocations or frees inside a render; the last sizes: {:?}", last_sizes());
    assert_same("handed over through the engine", &interleaved(&l, &r), &want);
    assert_eq!(ctl.collect().things, 8, "every box came back");
    handle.collect();
    render(&mut audio, 2_000, 128);
    assert_eq!(counted(), before, "collecting from the app costs the audio thread nothing");
}

/// The app reads where the deck is and what it is playing through the
/// deck's handle, from its own thread, without costing the audio thread.
#[test]
fn the_app_can_read_where_the_deck_is() {
    assert_the_check_is_on();
    let setup = Setup { alg: Algorithm::Granular, layers: 1, cloud: true, run: true, played: false, grid: 128 };
    let src = source();
    let sp = params(setup.alg, 2.0, setup.layers, setup.cloud);
    let deck = Grain::new(SR, setup.grid, sp, src);
    let handle = deck.handle();
    let (mut ctl, mut audio) = engine(SR as f32, exact());
    ctl.add(DECK, Box::new(deck)).unwrap();
    ctl.send(DECK, knob(grain::RUN, 1.0)).unwrap();
    ctl.connect_out(port(DECK, 0)).unwrap();
    ctl.commit().unwrap();
    assert!(!handle.is_playing());
    assert_eq!(handle.position(), 0);
    ctl.send_at(1_000, DECK, knob(grain::PLAY, 1.0)).unwrap();
    let before = counted();
    render(&mut audio, 12_800, 128);
    assert!(handle.is_playing());
    let first = handle.position();
    assert!(first > 5_000, "the position has moved on: {first}");
    assert_eq!(handle.spectrum().len(), 513, "a spectrum of 513 bands");
    assert_eq!(handle.waveform().len(), 128, "a waveform of 128 columns");
    let grains = handle.grains();
    assert!(!grains.is_empty(), "the grains it started");
    assert!(handle.grains().is_empty(), "taken once");
    render(&mut audio, 12_800, 128);
    assert!(handle.position() > first, "and it keeps moving");
    assert!(!handle.grains().is_empty(), "with more grains");
    ctl.send(DECK, knob(grain::PLAY, 0.0)).unwrap();
    render(&mut audio, 1_280, 128);
    assert!(!handle.is_playing());
    assert_eq!(counted(), before, "reading it cost the audio thread nothing; the last sizes: {:?}", last_sizes());
}

/// MGL's housekeeping reads the sound to make the copies the top keys play
/// from, so a new sound is offered to the deck and, if the housekeeping is
/// mid-read, offered again at the next line. Here a second thread collects
/// without pause while 300 sounds are handed over one after another: none
/// is lost, the last one ends up playing, the audio thread touches no
/// memory, and every box comes back.
#[test]
fn sounds_handed_over_while_the_app_collects_all_arrive() {
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    assert_the_check_is_on();
    let setup = Setup { alg: Algorithm::Granular, layers: 1, cloud: false, run: true, played: false, grid: 64 };
    let src = source();
    let sp = params(setup.alg, 2.0, setup.layers, setup.cloud);
    let deck = Grain::new(SR, setup.grid, sp, Arc::clone(&src));
    let handle = deck.handle();
    let (mut ctl, mut audio) = engine(SR as f32, exact());
    ctl.add(DECK, Box::new(deck)).unwrap();
    ctl.send(DECK, knob(grain::RUN, 1.0)).unwrap();
    ctl.send(DECK, knob(grain::PLAY, 1.0)).unwrap();
    ctl.connect_out(port(DECK, 0)).unwrap();
    ctl.commit().unwrap();
    let sounds: Vec<Arc<Source>> = (0..300).map(|i| if i % 2 == 0 { source_from(99) } else { source_from(7) }).collect();
    let last = Arc::downgrade(sounds.last().unwrap());
    for (i, sound) in sounds.into_iter().enumerate() {
        ctl.give_at(640 + 128 * i as u64, DECK, 0, Box::new(GrainThing::Source(sound))).unwrap();
    }
    let stop = Arc::new(AtomicBool::new(false));
    let rounds = Arc::new(AtomicU64::new(0));
    let collecting = {
        let (stop, rounds) = (Arc::clone(&stop), Arc::clone(&rounds));
        std::thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                handle.collect();
                rounds.fetch_add(1, Ordering::Relaxed);
            }
        })
    };
    // Not until the other thread is well under way.
    while rounds.load(Ordering::Relaxed) < 1_000 {
        std::thread::yield_now();
    }
    let started = rounds.load(Ordering::Relaxed);
    let before = counted();
    let (l, _) = render(&mut audio, 640 + 128 * 300 + 4_096, 64);
    assert_eq!(counted(), before, "allocations or frees inside a render; the last sizes: {:?}", last_sizes());
    let during = rounds.load(Ordering::Relaxed) - started;
    stop.store(true, Ordering::Relaxed);
    collecting.join().unwrap();
    assert!(during > 100, "the other thread really was collecting while it played: {during} rounds");
    assert!(peak(&l) > 0.01, "it is heard");
    assert_eq!(ctl.collect().things, 300, "every box came back");
    // The last sound handed over is held by the deck; the 299 before it are
    // gone once the app has collected.
    assert!(last.upgrade().is_some(), "the last sound is the one the deck holds");
}

/// A chord, a top note and a change of mode in Poly.
fn chords() -> Script {
    Script {
        acts: vec![
            (1, Act::Mode(KeyMode::Poly)),
            (1_001, Act::On(48, 0.8)),
            (1_500, Act::On(55, 0.7)),
            (2_222, Act::On(60, 0.9)),
            (6_000, Act::On(64, 0.6)),
            (9_000, Act::Off(48)),
            (9_500, Act::Bend(1.0)),
            (12_345, Act::On(67, 0.8)),
            (13_000, Act::On(72, 0.8)),
            (16_000, Act::Off(55)),
            (16_000, Act::Off(60)),
            (20_480, Act::Bend(0.0)),
            (22_000, Act::AllOff),
            (26_000, Act::On(52, 1.0)),
            (30_000, Act::Off(52)),
        ],
        frames: 40_000,
    }
}

/// Poly: a voice per key. The module makes its voices before it plays and
/// holds to a fixed number, and then plays what MGL's deck plays set up the
/// same way, whatever the sound card's blocks.
#[test]
fn poly_plays_what_mgls_deck_plays() {
    for alg in [Algorithm::Granular, Algorithm::Wsola] {
        let setup = Setup { alg, layers: 1, cloud: false, run: false, played: false, grid: 128 };
        let poly = Poly { voices: 8, octaves: false };
        let script = chords();
        let want = alone_in_poly(setup, poly, &script);
        assert!(peak(&want) > 0.05, "{alg:?}: the chords are heard: {}", peak(&want));
        let mono = alone(setup, &script);
        assert!(first_difference(&want, &mono).is_some(), "{alg:?}: Poly is not Mono");
        for block in [128, 512, 61, 0] {
            let (mut ctl, mut audio) = deck_with(setup, Some(poly));
            ctl.commit().unwrap();
            send_with(&mut ctl, &script, setup.grid);
            let (l, r) = if block == 0 {
                render_uneven(&mut audio, script.frames, 13)
            } else {
                render(&mut audio, script.frames, block)
            };
            assert_same(&format!("{alg:?}, blocks of {block}"), &interleaved(&l, &r), &want);
        }
    }
}

/// Six keys held with room for three: the oldest give way, as in MGL, and
/// the limit moved while it plays lands on its sample.
#[test]
fn poly_holds_to_its_number_of_voices() {
    let setup = Setup { alg: Algorithm::Granular, layers: 1, cloud: false, run: false, played: false, grid: 128 };
    let poly = Poly { voices: 6, octaves: false };
    let mut acts = vec![(1, Act::Mode(KeyMode::Poly))];
    for i in 0..6u64 {
        acts.push((1_000 + 700 * i, Act::On(48 + 3 * i as u8, 0.8)));
    }
    let script = Script { acts, frames: 20_000 };
    let all_six = alone_in_poly(setup, poly, &script);

    let (mut ctl, mut audio) = deck_with(setup, Some(poly));
    ctl.commit().unwrap();
    send_with(&mut ctl, &script, setup.grid);
    // Three voices from sample 3,000 on.
    ctl.send_at(3_000, DECK, knob(grain::VOICES, 3.0)).unwrap();
    let (l, r) = render(&mut audio, script.frames, 128);
    let got = interleaved(&l, &r);
    let first = first_difference(&got, &all_six).expect("three voices do not sound like six") / 2;
    assert!(first >= 3_000, "nothing changes before the limit is moved: {first}");
    assert!(peak(&got) > 0.05);
}

/// A key above C8 plays from the copies an octave or more up, made before
/// the deck plays: the same as MGL's deck with its copies made up front.
#[test]
fn the_top_keys_play_from_the_octave_copies() {
    let setup = Setup { alg: Algorithm::Wsola, layers: 1, cloud: false, run: false, played: false, grid: 128 };
    let poly = Poly { voices: 4, octaves: true };
    let script = Script {
        acts: vec![
            (1, Act::Mode(KeyMode::Poly)),
            (1_001, Act::On(120, 0.9)),
            (5_000, Act::On(127, 0.9)),
            (9_000, Act::On(60, 0.9)),
            (14_000, Act::AllOff),
        ],
        frames: 20_000,
    };
    let want = alone_in_poly(setup, poly, &script);
    assert!(peak(&want) > 0.01, "the top keys are heard: {}", peak(&want));
    let without = alone_in_poly(setup, Poly { voices: 4, octaves: false }, &script);
    assert!(first_difference(&want, &without).is_some(), "the copies are what the top keys play from");
    let (mut ctl, mut audio) = deck_with(setup, Some(poly));
    ctl.commit().unwrap();
    send_with(&mut ctl, &script, setup.grid);
    let (l, r) = render(&mut audio, script.frames, 128);
    assert_same("the top keys", &interleaved(&l, &r), &want);
}

/// Poly allocates nothing on the audio thread, and the app can see how many
/// voices are sounding.
#[test]
fn poly_does_not_allocate_and_reports_its_voices() {
    assert_the_check_is_on();
    let setup = Setup { alg: Algorithm::Granular, layers: 1, cloud: false, run: false, played: false, grid: 128 };
    let src = source();
    let sp = params(setup.alg, 2.0, 1, false);
    let deck = Grain::new(SR, setup.grid, sp, src).poly(8).octaves();
    let handle = deck.handle();
    let (mut ctl, mut audio) = engine(SR as f32, exact());
    ctl.add(DECK, Box::new(deck)).unwrap();
    // The keys as the other tests set them: Run off, so a key starts the
    // sound, and a quick attack.
    for message in [
        knob(grain::RUN, 0.0),
        knob(grain::AMP_ATTACK, 0.01),
        knob(grain::AMP_DECAY, 0.05),
        knob(grain::AMP_SUSTAIN, 0.7),
        knob(grain::AMP_RELEASE, 0.05),
        knob(grain::START, 0.1),
    ] {
        ctl.send(DECK, message).unwrap();
    }
    ctl.connect_out(port(DECK, 0)).unwrap();
    ctl.commit().unwrap();
    let mut script = chords();
    script.acts.push((33_000, Act::On(124, 0.8)));
    send_with(&mut ctl, &script, setup.grid);
    let before = counted();
    let (l, _) = render(&mut audio, 8_000, 128);
    assert!(peak(&l) > 0.05, "it is heard");
    assert_eq!(handle.voices_running(), 4, "four keys are down at sample 8,000");
    render(&mut audio, 32_000, 128);
    assert_eq!(counted(), before, "allocations or frees inside a render; the last sizes: {:?}", last_sizes());
    handle.collect();
    render(&mut audio, 2_000, 128);
    assert_eq!(counted(), before, "collecting costs the audio thread nothing");
}

/// MGL plays two decks at once: the Grain page's and the Prism page's, each
/// with its own sound, summed. Two grain modules side by side in the engine
/// play what MGL's two decks play.
#[test]
fn two_decks_side_by_side_play_as_mgls_two_decks_do() {
    use mgl_engine::Decks;
    let grid = 128;
    let frames = 24_000;
    let main_sp = params(Algorithm::Granular, 2.0, 1, true);
    let prism_sp = params(Algorithm::Wsola, 0.5, 1, false);
    let (main_src, prism_src) = (source_from(7), source_from(99));

    let main = Shared::new(main_sp, Arc::clone(&main_src));
    let prism = Shared::new(prism_sp, Arc::clone(&prism_src));
    let keys = Arc::new(GrainKeys::new());
    keys.set_run(true);
    let mut decks = Decks::new(
        Core::new(grid, 2, main_sp, Arc::clone(&main_src)).with_keys(keys),
        Core::new(grid, 2, prism_sp, Arc::clone(&prism_src)),
        grid,
        2,
    );
    let mut want = Vec::with_capacity(frames * 2);
    let mut buf = vec![0f32; grid * 2];
    let mut at = 0;
    while at < frames {
        // The acts, on the lines the modules will take them on.
        if at == 1_024 {
            main.play();
        }
        if at == 4_096 {
            prism.play();
        }
        if at == 16_000 {
            prism.set_gain(0.5);
        }
        decks.fill(&mut buf, 2, &main, &prism);
        want.extend_from_slice(&buf);
        at += grid;
    }
    want.truncate(frames * 2);
    assert!(peak(&want) > 0.01, "the two decks are heard");

    let (mut ctl, mut audio) = engine(SR as f32, exact());
    ctl.add(1, Box::new(Grain::new(SR, grid, main_sp, main_src))).unwrap();
    ctl.add(2, Box::new(Grain::new(SR, grid, prism_sp, prism_src))).unwrap();
    ctl.send(1, knob(grain::RUN, 1.0)).unwrap();
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    ctl.send_at(1_024, 1, knob(grain::PLAY, 1.0)).unwrap();
    ctl.send_at(4_096, 2, knob(grain::PLAY, 1.0)).unwrap();
    ctl.send_at(16_000, 2, knob(grain::GAIN, 0.5)).unwrap();
    let (l, r) = render(&mut audio, frames, 512);
    assert_same("the two decks", &interleaved(&l, &r), &want);
}

#[test]
fn the_app_can_draw_the_decks_scope() {
    let setup = Setup { alg: Algorithm::Granular, layers: 1, cloud: false, run: true, played: false, grid: 128 };
    let src = source();
    let sp = params(setup.alg, 2.0, 1, false);
    let deck = Grain::new(SR, setup.grid, sp, src).rack(rack(setup.grid));
    let handle = deck.handle();
    let (mut ctl, mut audio) = engine(SR as f32, exact());
    ctl.add(DECK, Box::new(deck)).unwrap();
    ctl.send(DECK, knob(grain::RUN, 1.0)).unwrap();
    ctl.send(DECK, knob(grain::PLAY, 1.0)).unwrap();
    ctl.connect_out(port(DECK, 0)).unwrap();
    ctl.commit().unwrap();
    render(&mut audio, 24_000, 128);
    let (l, r, rate) = handle.scope().expect("a scope once it has played");
    assert_eq!(rate, SR);
    assert!(peak(&l) > 0.01 && peak(&r) > 0.01, "the scope holds the sound");
    // MGL keeps a fixed row of meters, one pair for every slot a rack can
    // have; this rack uses the first.
    let levels = handle.rack_levels();
    assert!(levels[0].0 > 0.0, "a level going into the rack's first slot: {:?}", levels[0]);
}

/// How long the deck takes to answer, for each engine: from a key going down
/// (Mono, and Poly with eight voices) or Play being pressed, to the first
/// sample above -60 dB. Measured in MGL's rig (blocks of 512, so up to one
/// block of it is the rig's), to compare two versions of MGL with each other,
/// not as the delay heard live. Run by hand: `--ignored --nocapture`.
#[test]
#[ignore]
fn how_long_the_deck_takes_to_answer() {
    let onset = |out: &[f32], from: u64| {
        let start = from as usize * 2;
        out[start..].iter().position(|s| s.abs() > 1e-3).map(|i| i / 2)
    };
    let ms = |f: Option<usize>| f.map_or("silent".to_string(), |f| format!("{:6.1} ms", f as f64 * 1000.0 / SR as f64));
    for alg in ENGINES {
        let setup = |run, played| Setup { alg, layers: 1, cloud: false, run, played, grid: BLOCK };
        let mono = alone(setup(false, false), &played_notes(KeyMode::Mono));
        let poly = alone_in_poly(setup(false, false), Poly { voices: 8, octaves: false }, &played_notes(KeyMode::Poly));
        let play = alone(setup(false, true), &no_notes());
        println!(
            "{:<9} key, Mono {}   key, Poly {}   Play {}",
            format!("{alg:?}"),
            ms(onset(&mono, 4 * B)),
            ms(onset(&poly, 4 * B)),
            ms(onset(&play, 4 * B))
        );
    }
}

#[test]
fn a_held_grain_note_survives_rate_switches_without_audio_allocations() {
    let (mut ctl,mut audio)=engine(48000.0,Config{max_block:512,fade_frames:480,..Config::default()});
    ctl.add(1,Box::new(engine_mgl::demo::grain(48000,0,128,4))).unwrap();
    ctl.connect_out(port(1,0)).unwrap();ctl.commit().unwrap();
    ctl.send(1,knob(grain::KEY_MODE,2.0)).unwrap();
    ctl.send(1,knob(grain::RUN,0.0)).unwrap();
    ctl.send(1,EventKind::Note(NoteEvent::on(48,0.8))).unwrap();
    let mut l=[0.0;512];let mut r=l;
    for _ in 0..20 {audio.render(&mut l,&mut r);}
    assert!(l.iter().any(|v|v.abs()>0.001), "initial note silent");
    for rate in [44100.0,48000.0] {
        ctl.set_rate(rate).unwrap();let before=counted();let mut energy=0.0;
        for _ in 0..20 {
            audio.render(&mut l,&mut r);assert!(l.iter().all(|v|v.is_finite()));
            energy+=l.iter().map(|v|v*v).sum::<f32>();
        }
        assert!(energy>0.001,"held grain note went silent: rate {rate}, energy {energy}");
        assert_eq!(counted(),before,"audio heap activity during Grain rate switch");ctl.collect();
    }
}
