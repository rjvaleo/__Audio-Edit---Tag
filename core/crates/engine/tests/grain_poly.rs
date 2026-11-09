//! Poly on the Grain page: a full engine per held key (`voices.rs`), frame by
//! frame with no sound card.

use engine::voices::{cap_for, stock};
use engine::{Core, GrainKeys, KeyMode, Shared, Source};
use fx::grain::{Grain, StreamParams};
use fx::stretch::Algorithm;
use std::sync::Arc;

const SR: u32 = 48_000;
const BLOCK: usize = 512;
const FILE: usize = 96_000;
const TONE: f64 = 220.0;
const ENGINES: [Algorithm; 5] =
    [Algorithm::Granular, Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Pvsola, Algorithm::Hybrid];

fn tone_source() -> Arc<Source> {
    let w = std::f64::consts::TAU * TONE / SR as f64;
    let samples = (0..FILE).map(|i| ((i as f64 * w).sin() * 0.5) as f32).collect();
    Arc::new(Source { samples, channels: 1 })
}

fn params(alg: Algorithm) -> StreamParams {
    StreamParams {
        in_frames: FILE,
        sample_rate: SR,
        ratio: 1.0,
        semitones: 0.0,
        window_ms: 40.0,
        grain: Grain::default(),
        algorithm: alg,
        wsola: fx::stretch::WsolaParams::default(),
        vocoder: fx::stretch::VocoderParams::default(),
        pvsola: fx::pvsola::PvsolaParams::default(),
        hybrid: fx::hybrid::HybridParams::default(),
        cloud: false,
        cloud_mix: 0.5,
    }
}

struct Rig {
    core: Core,
    shared: Shared,
    keys: Arc<GrainKeys>,
}

fn rig(alg: Algorithm) -> Rig {
    let src = tone_source();
    let sp = params(alg);
    let shared = Shared::new(sp, Arc::clone(&src));
    if alg == Algorithm::Hybrid {
        shared.set_parts(Arc::new(fx::hstream::Parts::separate(&src.samples, 1, sp.hybrid)));
    }
    let keys = Arc::new(GrainKeys::new());
    keys.set_run(false);
    keys.set_mode(KeyMode::Poly);
    keys.set_amp(0.005, 0.01, 1.0, 0.02);
    keys.set_glide(0.0);
    stock(&shared, 8, BLOCK, 1);
    let core = Core::new(BLOCK, 1, sp, src).with_keys(Arc::clone(&keys));
    Rig { core, shared, keys }
}

fn pump(r: &mut Rig, blocks: usize) -> Vec<f32> {
    let mut buf = vec![0f32; BLOCK];
    let mut all = Vec::with_capacity(blocks * BLOCK);
    for _ in 0..blocks {
        r.core.fill(&mut buf, 1, &r.shared);
        all.extend_from_slice(&buf);
    }
    all
}

fn peak(x: &[f32]) -> f32 {
    x.iter().fold(0f32, |m, s| m.max(s.abs()))
}

/// How much of `freq` there is.
fn goertzel(x: &[f32], freq: f64) -> f32 {
    let w = std::f64::consts::TAU * freq / SR as f64;
    let (mut re, mut im) = (0f64, 0f64);
    for (i, s) in x.iter().enumerate() {
        re += *s as f64 * (i as f64 * w).cos();
        im += *s as f64 * (i as f64 * w).sin();
    }
    ((re * re + im * im).sqrt() * 2.0 / x.len() as f64) as f32
}

fn semis(s: f64) -> f64 {
    TONE * 2f64.powf(s / 12.0)
}

fn keys_of(r: &Rig) -> Vec<u8> {
    let mut k: Vec<u8> = r.shared.voices.heads().iter().map(|h| h.key).collect();
    k.sort();
    k
}

/// The sharpest corner in the waveform, by the size of its second difference.
fn corner(x: &[f32]) -> f32 {
    x.windows(3).map(|w| (w[2] - 2.0 * w[1] + w[0]).abs()).fold(0f32, f32::max)
}

#[test]
fn two_notes_give_two_heads_at_the_right_pitches_on_every_engine() {
    for alg in ENGINES {
        let mut r = rig(alg);
        let a_id = r.keys.note_on(60, 1.0);
        let b_id = r.keys.note_on(67, 1.0);
        pump(&mut r, 30);
        assert_eq!(keys_of(&r), [60, 67], "{alg:?}");
        let got = pump(&mut r, 60);
        if alg == Algorithm::Granular {
            // A pitched cloud on one pure tone interferes with itself, as it
            // should, so the pitches are read from the grains.
            let ev = r.shared.drain_events();
            let at = |k: u32| ev.iter().filter(|e| e.voice == k).map(|e| e.pitch_semis).collect::<Vec<_>>();
            let (a, b) = (at(a_id), at(b_id));
            assert!(a.len() > 8 && a.iter().all(|s| s.abs() < 1e-3), "{a:?}");
            assert!(b.len() > 8 && b.iter().all(|s| (s - 7.0).abs() < 1e-3), "{b:?}");
            assert!(peak(&got) > 0.2, "the notes are not sounding");
            continue;
        }
        let (a, b) = (goertzel(&got, semis(0.0)), goertzel(&got, semis(7.0)));
        let off = goertzel(&got, semis(3.5));
        assert!(a > 0.05, "{alg:?}: the first note is {a}");
        assert!(b > 0.05, "{alg:?}: the second note is {b}");
        assert!(off < a * 0.4 && off < b * 0.4, "{alg:?}: {off} between the two pitches, against {a} and {b}");
    }
}

#[test]
fn every_note_reads_from_start() {
    for alg in ENGINES {
        let mut r = rig(alg);
        r.keys.set_start(0.5);
        r.keys.note_on(60, 1.0);
        pump(&mut r, 3);
        for h in r.shared.voices.heads() {
            assert!((48_000.0..52_000.0).contains(&h.src), "{alg:?}: head at {}", h.src);
        }
    }
}

#[test]
fn a_released_voice_ends_while_the_other_carries_on() {
    for alg in ENGINES {
        let mut r = rig(alg);
        r.keys.note_on(60, 1.0);
        r.keys.note_on(67, 1.0);
        pump(&mut r, 30);
        r.keys.note_off(60);
        pump(&mut r, 30);
        assert_eq!(keys_of(&r), [67], "{alg:?}");
        let got = pump(&mut r, 60);
        if alg == Algorithm::Granular {
            assert!(peak(&got) > 0.1, "the note still held went with the other: {}", peak(&got));
        } else {
            let (kept, gone) = (goertzel(&got, semis(7.0)), goertzel(&got, semis(0.0)));
            assert!(kept > 0.05, "{alg:?}: the note still held is {kept}");
            assert!(gone < kept * 0.2, "{alg:?}: the note let go is still {gone}, against {kept}");
        }
        r.keys.note_off(67);
        pump(&mut r, 40);
        assert!(r.shared.voices.heads().is_empty(), "{alg:?}");
        assert!(peak(&pump(&mut r, 10)) < 1e-4, "{alg:?}");
    }
}

#[test]
fn each_voice_has_its_own_amp_and_velocity() {
    for alg in ENGINES {
        let mut r = rig(alg);
        r.keys.set_amp(0.05, 0.05, 0.5, 0.05);
        r.keys.note_on(60, 1.0);
        pump(&mut r, 2);
        let early = r.shared.voices.heads()[0].env;
        pump(&mut r, 30);
        r.keys.note_on(67, 0.5);
        pump(&mut r, 2);
        let heads = r.shared.voices.heads();
        let (first, second) = (heads.iter().find(|h| h.key == 60).unwrap(), heads.iter().find(|h| h.key == 67).unwrap());
        assert!(second.env < 0.4, "{alg:?}: a new note should be early in its attack: {}", second.env);
        assert!(first.env > 0.4 && first.env > early, "{alg:?}: the older note is on its own envelope: {}", first.env);
        pump(&mut r, 40);
        let heads = r.shared.voices.heads();
        let (first, second) = (heads.iter().find(|h| h.key == 60).unwrap(), heads.iter().find(|h| h.key == 67).unwrap());
        assert!((first.env - 0.5).abs() < 0.05, "{alg:?}: sustain {}", first.env);
        assert!((second.env - 0.25).abs() < 0.05, "{alg:?}: sustain times velocity {}", second.env);
    }
}

#[test]
fn stolen_voices_leave_without_a_click() {
    for alg in ENGINES {
        let mut r = rig(alg);
        r.shared.voices.set_ceiling(2);
        r.keys.note_on(60, 1.0);
        r.keys.note_on(64, 1.0);
        pump(&mut r, 40);
        let before = corner(&pump(&mut r, 20));
        // Up against the ceiling: the third note takes the oldest voice.
        r.keys.note_on(67, 1.0);
        let during = pump(&mut r, 8);
        pump(&mut r, 8);
        assert_eq!(keys_of(&r), [64, 67], "{alg:?}");
        let c = corner(&during);
        assert!(c < before * 4.0 + 0.01, "{alg:?}: a steal put a corner of {c} in, against {before}");
    }
}

#[test]
fn the_cap_is_what_fits() {
    // A quarter of the block gone on other work, a tenth a voice.
    assert_eq!(cap_for(0.45, 0.2, 0.1), 4);
    // Nothing left: one voice is still one voice.
    assert_eq!(cap_for(1.2, 0.1, 0.1), 1);
    // Cheap voices, and no other load.
    assert_eq!(cap_for(0.0, 0.0, 0.02), 35);
}

#[test]
fn a_held_note_loops_the_region_without_a_gap() {
    // Each voice goes round its own loop, and the cloud's grains carry over it.
    for alg in ENGINES {
        let mut r = rig(alg);
        r.shared.set_loop(false, 12_000, 36_000);
        r.keys.note_on(60, 1.0);
        pump(&mut r, 20);
        let mut low = f32::MAX;
        for _ in 0..200 {
            let b = pump(&mut r, 4);
            low = low.min(peak(&b));
            let head = r.shared.voices.heads()[0].src;
            assert!((12_000.0 - 512.0..36_500.0).contains(&head), "{alg:?}: head at {head}");
        }
        // The seam on the spliced engines dips, but never to nothing.
        assert!(low > 0.1, "{alg:?}: the loop left a gap: {low}");
    }
}

#[test]
fn run_keeps_its_meaning_and_keys_only_repitch() {
    let mut r = rig(Algorithm::Granular);
    r.keys.set_run(true);
    r.shared.play();
    pump(&mut r, 20);
    r.keys.note_on(72, 1.0);
    pump(&mut r, 30);
    assert!(r.shared.voices.heads().is_empty());
    pump(&mut r, 2);
    let e = r.shared.drain_events();
    assert!(e.last().is_some_and(|e| (e.pitch_semis - 12.0).abs() < 1e-3), "the transport should have gone up the octave");
}

#[test]
fn with_play_running_the_notes_sound_over_it() {
    let mut r = rig(Algorithm::Granular);
    r.keys.set_played(true);
    r.shared.play();
    pump(&mut r, 20);
    r.keys.note_on(72, 1.0);
    pump(&mut r, 30);
    assert_eq!(keys_of(&r), [72]);
    r.shared.drain_events();
    pump(&mut r, 60);
    let ev = r.shared.drain_events();
    assert!(ev.iter().any(|e| e.voice == 0 && e.pitch_semis.abs() < 1e-3), "the transport should still sound");
    assert!(ev.iter().any(|e| e.voice != 0 && (e.pitch_semis - 12.0).abs() < 1e-3), "and the note on top of it");
}

#[test]
fn voices_go_through_the_rack_and_their_tails_ring_on() {
    let mut r = rig(Algorithm::Granular);
    let mut rack = fx::Rack::new();
    rack.push(Box::new(Tail { line: vec![0.0; 24_000], at: 0 }));
    r.shared.set_rack(Some(rack));
    r.keys.note_on(60, 1.0);
    pump(&mut r, 30);
    r.keys.note_off(60);
    pump(&mut r, 10);
    assert!(r.shared.voices.heads().is_empty());
    let tail = pump(&mut r, 40);
    assert!(peak(&tail) > 0.05, "the delay's tail stopped with the note: {}", peak(&tail));
    assert!(!r.shared.is_playing());
}

struct Tail {
    line: Vec<f32>,
    at: usize,
}

impl fx::Effect for Tail {
    fn process(&mut self, buf: &mut [f32], _channels: usize, _sample_rate: u32) {
        for s in buf.iter_mut() {
            let d = self.line[self.at];
            self.line[self.at] = *s;
            self.at = (self.at + 1) % self.line.len();
            *s = d;
        }
    }
    fn reset(&mut self) {
        self.line.iter_mut().for_each(|s| *s = 0.0);
    }
    fn name(&self) -> &'static str {
        "tail"
    }
}

/// A voice's grains carry the note's id, for the page to colour them.
#[test]
fn a_grain_says_which_voice_played_it() {
    let mut r = rig(Algorithm::Granular);
    let a = r.keys.note_on(60, 1.0);
    let b = r.keys.note_on(67, 1.0);
    pump(&mut r, 20);
    let ev = r.shared.drain_events();
    assert!(ev.iter().any(|e| e.voice == a), "no grains from voice {a}");
    assert!(ev.iter().any(|e| e.voice == b), "no grains from voice {b}");
}

/// A new engine under held notes: the notes go across without stopping.
#[test]
fn a_new_engine_under_held_notes_keeps_them_sounding() {
    let mut r = rig(Algorithm::Granular);
    r.keys.note_on(60, 1.0);
    pump(&mut r, 30);
    r.shared.set_params(params(Algorithm::Wsola));
    stock(&r.shared, 4, BLOCK, 1);
    let got = pump(&mut r, 8);
    assert!(peak(&got[..]) > 0.05);
    let got = pump(&mut r, 40);
    assert_eq!(keys_of(&r), [60]);
    assert!(goertzel(&got, TONE) > 0.1);
}

/// Poly left, the heads stop being reported.
#[test]
fn with_nothing_held_nothing_runs() {
    let mut r = rig(Algorithm::Vocoder);
    pump(&mut r, 4);
    assert!(r.shared.voices.heads().is_empty());
    assert_eq!(r.shared.voices.running(), 0);
    assert!(peak(&pump(&mut r, 4)) == 0.0);
}

/// A Mono note under the first Poly key is cut quickly, not left to gate it.
#[test]
fn the_first_poly_note_cuts_a_note_from_another_mode() {
    let mut r = rig(Algorithm::Granular);
    r.keys.set_mode(KeyMode::Mono);
    r.keys.note_on(60, 1.0);
    pump(&mut r, 30);
    r.keys.set_mode(KeyMode::Poly);
    r.keys.note_on(67, 1.0);
    pump(&mut r, 10);
    assert_eq!(keys_of(&r), [67], "the voice should have started");
    let settled = pump(&mut r, 20);
    assert!(peak(&settled) > 0.1, "the voice is being gated by the old mode: {}", peak(&settled));
    r.keys.note_off(60);
    r.keys.note_off(67);
    pump(&mut r, 40);
    assert!(r.shared.voices.heads().is_empty());
}

/// A note held while ▶ runs off the end of the sound keeps going.
#[test]
fn a_held_note_outlasts_the_transport_stopping() {
    let mut r = rig(Algorithm::Granular);
    r.keys.set_played(true);
    r.shared.play();
    pump(&mut r, 1);
    r.shared.request_seek(FILE as u64 - 2_000);
    r.keys.note_on(72, 1.0);
    let mut low = f32::MAX;
    let mut quiet_once = false;
    for i in 0..30 {
        let b = pump(&mut r, 1);
        if i > 2 {
            let p = peak(&b);
            low = low.min(p);
            quiet_once |= p == 0.0;
        }
    }
    assert!(!r.shared.is_playing(), "the transport should have stopped");
    assert!(!quiet_once, "a block of silence where the transport stopped");
    assert!(low > 0.02, "the note dipped to {low} as the transport stopped");
    assert_eq!(keys_of(&r), [72]);
}
