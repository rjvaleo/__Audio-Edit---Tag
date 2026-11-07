//! The synth deck (`synth.rs`): heard with the grain transport stopped, mixed
//! in before the master ceiling, so the capture and the scope carry it.
//!
//! The default patch is quiet — Filter 1 low-pass into Filter 2 band-pass,
//! in series, peaks around −35 dBFS — so "sounds" here means clearly above
//! silence, not loud.

use engine::{Core, Decks, Shared, Source, SynthDeck, WaveEvent, WaveShared};
use fx::grain::{Grain, StreamParams};
use std::sync::Arc;
use wave::{builtin_frames, Patch, PatchState, Wavetable};

const SR: u32 = 48_000;
const CH: usize = 2;
const BLOCK: usize = 512;

fn params() -> StreamParams {
    StreamParams {
        in_frames: 0,
        sample_rate: SR,
        ratio: 1.0,
        semitones: 0.0,
        window_ms: 40.0,
        grain: Grain::default(),
        algorithm: fx::stretch::Algorithm::Granular,
        wsola: fx::stretch::WsolaParams::default(),
        vocoder: fx::stretch::VocoderParams::default(),
        pvsola: fx::pvsola::PvsolaParams::default(),
        hybrid: fx::hybrid::HybridParams::default(),
        cloud: false,
        cloud_mix: 0.5,
    }
}

struct Rig {
    decks: Decks,
    main: Arc<Shared>,
    prism: Arc<Shared>,
    wave: Arc<WaveShared>,
}

fn rig() -> Rig {
    let silent = Arc::new(Source { samples: Vec::new(), channels: CH });
    let core = || Core::new(BLOCK, CH, params(), Arc::clone(&silent));
    let wave = Arc::new(WaveShared::new());
    let p = Patch::default();
    wave.set_patch(PatchState::new(&p));
    for (osc, name) in p.tables.iter().enumerate() {
        wave.set_table(osc, Arc::new(Wavetable::from_frames(&builtin_frames(name).unwrap())));
    }
    let decks = Decks::new(core(), core(), BLOCK, CH)
        .with_synth(SynthDeck::new(SR as f32, BLOCK, CH, Arc::clone(&wave)));
    Rig {
        decks,
        main: Arc::new(Shared::new(params(), Arc::clone(&silent))),
        prism: Arc::new(Shared::new(params(), silent)),
        wave,
    }
}

impl Rig {
    fn run(&mut self, blocks: usize) -> Vec<f32> {
        let mut buf = vec![0f32; BLOCK * CH];
        let mut all = Vec::new();
        for _ in 0..blocks {
            self.decks.fill(&mut buf, CH, &self.main, &self.prism);
            all.extend_from_slice(&buf);
        }
        all
    }
}

fn peak(x: &[f32]) -> f32 {
    x.iter().fold(0.0f32, |m, v| m.max(v.abs()))
}

#[test]
fn the_synth_sounds_with_the_transport_stopped() {
    let mut r = rig();
    assert!(!r.main.is_playing());
    assert!(peak(&r.run(8)) < 1e-6, "silent before a note");
    r.wave.push(WaveEvent::NoteOn { note: 57, vel: 0.9 });
    let held = r.run(40);
    assert!(peak(&held) > 0.005, "a note on a stopped transport must sound: {}", peak(&held));
    assert!(peak(&held) < 1.0, "and it passes through the ceiling");
    // Released, it rings out and stops.
    r.wave.push(WaveEvent::NoteOff { note: 57 });
    r.run(48_000 * 4 / BLOCK);
    assert!(peak(&r.run(8)) < 1e-4, "released notes end");
    let (t, wave) = r.wave.telemetry();
    assert_eq!(t.voices().len(), 0);
    assert_eq!(wave.len(), engine::WAVE_POINTS);
}

#[test]
fn the_synth_reaches_the_capture_and_the_scope() {
    let mut r = rig();
    r.main.start_capture(CH, SR, 5.0);
    r.wave.push(WaveEvent::NoteOn { note: 60, vel: 1.0 });
    let out = r.run(30);
    let cap = r.main.take_capture().expect("a capture");
    assert_eq!(cap.samples.len(), out.len(), "every block is kept while stopped");
    assert_eq!(cap.samples, out, "the capture is what left");
    assert!(peak(&cap.samples) > 0.005);
    let (l, _, _) = r.main.scope_snapshot().expect("a scope");
    assert!(peak(&l) > 0.005, "the master scope sees the synth");
}

#[test]
fn the_synth_is_mixed_in_while_the_grain_deck_plays_too() {
    let mut r = rig();
    r.main.play();
    r.wave.push(WaveEvent::NoteOn { note: 64, vel: 1.0 });
    let out = r.run(30);
    assert!(peak(&out) > 0.005);
}

#[test]
fn a_patch_and_a_table_swap_are_taken_and_the_old_table_comes_back() {
    let mut r = rig();
    r.run(1);
    let mut p = Patch::default();
    p.set_num("master", 0.0);
    r.wave.set_patch(PatchState::new(&p));
    r.wave.set_table(0, Arc::new(Wavetable::from_frames(&builtin_frames("Grit Saw").unwrap())));
    r.wave.push(WaveEvent::NoteOn { note: 60, vel: 1.0 });
    let out = r.run(20);
    assert!(peak(&out) < 1e-5, "master at nought is silence: {}", peak(&out));
    // The replaced table waits to be dropped off the audio thread.
    let now = r.wave.current_tables();
    assert_eq!(now[0].as_ref().map(Arc::strong_count), Some(3), "held by the deck, by `current` and here");
    drop(now);
    r.wave.collect();
    // A live move after the patch is heard.
    r.wave.set_live(wave::param_id("master").unwrap(), 0.8);
    assert!(peak(&r.run(20)) > 0.005);
}

#[test]
fn a_new_deck_starts_from_what_was_last_sent() {
    let r = rig();
    let deck = SynthDeck::new(SR as f32, BLOCK, CH, Arc::clone(&r.wave));
    assert!(r.wave.current_tables().iter().all(Option::is_some));
    assert_eq!(deck.active_voices(), 0);
}
