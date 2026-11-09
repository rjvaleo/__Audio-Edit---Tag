//! Notes on the Grain page: the keys, AMP, Glide, Bend and Run, frame by frame
//! with no sound card (`keys.rs`).

use engine::{Core, GrainKeys, KeyMode, Shared, Source};
use fx::grain::{Grain, StreamParams};
use std::sync::Arc;

const SR: u32 = 48_000;
const BLOCK: usize = 512;

fn source(frames: usize) -> Arc<Source> {
    let samples = (0..frames).map(|i| (i as f32 * 0.02).sin() * 0.5).collect();
    Arc::new(Source { samples, channels: 1 })
}

fn params(in_frames: usize) -> StreamParams {
    StreamParams {
        in_frames,
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
    core: Core,
    shared: Shared,
    keys: Arc<GrainKeys>,
}

/// A deck on a two-second tone, played by keys: Run off, a snappy AMP, no Glide.
fn rig() -> Rig {
    let src = source(96_000);
    let sp = params(96_000);
    let shared = Shared::new(sp, Arc::clone(&src));
    let keys = Arc::new(GrainKeys::new());
    keys.set_run(false);
    keys.set_amp(0.005, 0.01, 1.0, 0.02);
    keys.set_glide(0.0);
    let core = Core::new(BLOCK, 1, sp, src).with_keys(Arc::clone(&keys));
    Rig { core, shared, keys }
}

fn pump(r: &mut Rig, blocks: usize) -> Vec<f32> {
    let mut buf = vec![0f32; BLOCK];
    let mut all = Vec::new();
    for _ in 0..blocks {
        r.core.fill(&mut buf, 1, &r.shared);
        all.extend_from_slice(&buf);
    }
    all
}

fn peak(x: &[f32]) -> f32 {
    x.iter().fold(0f32, |m, s| m.max(s.abs()))
}

/// A delay of `at` frames, wet only: whatever went in comes out that much later.
struct Delay {
    line: Vec<f32>,
    at: usize,
}

impl fx::Effect for Delay {
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
        "delay"
    }
}

#[test]
fn a_note_on_starts_the_head_at_start() {
    let mut r = rig();
    r.shared.play();
    r.keys.set_start(0.25); // of the document: frame 24 000
    pump(&mut r, 20);
    r.keys.note_on(60, 0.8);
    pump(&mut r, 1);
    let head = r.keys.head();
    assert!((24_000..24_000 + 2 * BLOCK as u64).contains(&head), "head at {head}");
    assert!(r.keys.sounding());
}

#[test]
fn notes_change_nothing_in_the_document() {
    let mut r = rig();
    r.shared.play();
    let before = r.shared.params().unwrap();
    r.keys.note_on(72, 1.0);
    pump(&mut r, 10);
    r.keys.note_off(72);
    pump(&mut r, 10);
    let after = r.shared.params().unwrap();
    assert_eq!(before.semitones, after.semitones);
    assert_eq!(before.ratio, after.ratio);
}

#[test]
fn a_key_plays_the_pitch_the_table_says() {
    let mut r = rig();
    r.keys.set_key(61, 3.5);
    r.keys.note_on(61, 1.0);
    pump(&mut r, 20);
    r.shared.drain_events();
    pump(&mut r, 10);
    let ev = r.shared.drain_events();
    assert!(!ev.is_empty());
    for e in ev {
        assert!((e.pitch_semis - 3.5).abs() < 1e-3, "{}", e.pitch_semis);
    }
}

#[test]
fn glide_moves_the_pitch_there_rather_than_jumping() {
    let mut r = rig();
    r.keys.set_glide(0.3);
    r.keys.note_on(60, 1.0);
    pump(&mut r, 4);
    r.keys.note_on(72, 1.0);
    pump(&mut r, 2);
    r.shared.drain_events();
    pump(&mut r, 2);
    let early = r.shared.drain_events().last().map(|e| e.pitch_semis).unwrap();
    assert!(early > 0.01 && early < 11.0, "{early}");
    pump(&mut r, 200);
    r.shared.drain_events();
    pump(&mut r, 4);
    let late = r.shared.drain_events().last().map(|e| e.pitch_semis).unwrap();
    assert!((late - 12.0).abs() < 0.05, "{late}");
}

#[test]
fn bend_adds_to_the_pitch() {
    let mut r = rig();
    r.keys.set_bend(2.0);
    r.keys.note_on(60, 1.0);
    pump(&mut r, 60);
    r.shared.drain_events();
    pump(&mut r, 6);
    let e = r.shared.drain_events();
    assert!((e.last().unwrap().pitch_semis - 2.0).abs() < 0.02, "{}", e.last().unwrap().pitch_semis);
}

#[test]
fn mono_restarts_the_head_and_legato_does_not() {
    let mut r = rig();
    r.keys.set_mode(KeyMode::Mono);
    r.keys.note_on(60, 0.8);
    pump(&mut r, 40);
    r.keys.note_off(60);
    r.keys.note_on(62, 0.8);
    pump(&mut r, 3);
    assert!(r.keys.head() < 4 * BLOCK as u64, "Mono restarts: {}", r.keys.head());

    let mut r = rig();
    r.keys.set_mode(KeyMode::Legato);
    r.keys.note_on(60, 0.8);
    pump(&mut r, 40);
    let was = r.keys.head();
    r.keys.note_on(62, 0.8);
    pump(&mut r, 3);
    assert_eq!(r.keys.head(), was + 3 * BLOCK as u64, "Legato keeps the head running");
    // Letting the top note go goes back to the one still held, and still runs on.
    r.keys.note_off(62);
    pump(&mut r, 3);
    assert_eq!(r.keys.head(), was + 6 * BLOCK as u64);
    assert!(r.keys.sounding());
}

#[test]
fn poly_plays_as_mono_for_now_with_a_voice_each() {
    let mut r = rig();
    r.keys.set_mode(KeyMode::Poly);
    let a = r.keys.note_on(60, 0.8);
    let b = r.keys.note_on(64, 0.8);
    assert_ne!(a, b, "every note has its own voice id");
    pump(&mut r, 10);
    assert!(r.keys.head() < 11 * BLOCK as u64, "the second note restarted the head as Mono does");
}

#[test]
fn the_head_loops_the_region_with_the_loop_light_off() {
    let mut r = rig();
    r.shared.set_loop(false, 2_000, 6_800);
    r.keys.set_start(2_000.0 / 96_000.0);
    r.keys.note_on(60, 0.8);
    let mut peak_all = 0f32;
    for _ in 0..80 {
        peak_all = peak_all.max(peak(&pump(&mut r, 1)));
        let h = r.keys.head();
        assert!((2_000..=6_800).contains(&h), "head left the region at {h}");
    }
    assert!(peak_all > 0.05);
}

#[test]
fn the_end_of_the_document_does_not_stop_a_held_note() {
    let mut r = rig();
    r.keys.set_start(0.98);
    r.keys.note_on(60, 0.8);
    pump(&mut r, 40); // past the last frame
    assert!(r.keys.head() < 96_000);
    assert!(r.keys.sounding());
    assert!(peak(&pump(&mut r, 4)) > 0.02);
}

#[test]
fn release_reaches_silence() {
    let mut r = rig();
    r.shared.play();
    r.keys.note_on(60, 1.0);
    let held = pump(&mut r, 20);
    assert!(peak(&held[held.len() / 2..]) > 0.1);
    r.keys.note_off(60);
    pump(&mut r, 20);
    assert!(!r.keys.sounding());
    assert!(peak(&pump(&mut r, 4)) < 1e-4);
}

#[test]
fn sustain_sets_the_level_while_held_and_velocity_scales_it() {
    let level = |sus: f32, vel: f32| {
        let mut r = rig();
        r.keys.set_amp(0.002, 0.01, sus, 0.02);
        r.keys.note_on(60, vel);
        pump(&mut r, 40);
        peak(&pump(&mut r, 20))
    };
    let full = level(1.0, 1.0);
    assert!((level(0.5, 1.0) / full - 0.5).abs() < 0.05);
    assert!((level(1.0, 0.25) / full - 0.25).abs() < 0.03);
}

#[test]
fn a_mono_restart_has_no_click() {
    // The largest step in the output through a restart is no bigger than a
    // step the tone itself takes, give or take.
    let mut r = rig();
    r.keys.note_on(60, 1.0);
    let before = pump(&mut r, 40);
    let step = |x: &[f32]| x.windows(2).fold(0f32, |m, w| m.max((w[1] - w[0]).abs()));
    let usual = step(&before[before.len() / 2..]);
    r.keys.note_off(60);
    r.keys.note_on(64, 1.0);
    let through = pump(&mut r, 6);
    assert!(step(&through) <= usual * 2.0 + 0.02, "{} against {usual}", step(&through));
}

#[test]
fn run_on_ignores_the_gate_and_the_notes_only_repitch() {
    let build = || {
        let mut r = rig();
        r.keys.set_run(true);
        r.shared.play();
        r
    };
    let mut plain = build();
    let mut keyed = build();
    keyed.keys.note_on(60, 0.1); // key 60 is no pitch change
    let a = pump(&mut plain, 30);
    let b = pump(&mut keyed, 30);
    assert_eq!(a, b, "the same sound, with or without a key held");
    keyed.keys.note_off(60);
    let (a, b) = (pump(&mut plain, 30), pump(&mut keyed, 30));
    assert_eq!(a, b, "and after letting go of it");
    assert_eq!(keyed.shared.position(), 60 * BLOCK as u64, "nothing seeks the head");

    // With a stopped transport, Run on, a key is not a play button.
    let mut r = rig();
    r.keys.set_run(true);
    r.keys.note_on(60, 1.0);
    assert!(peak(&pump(&mut r, 20)) == 0.0);
}

#[test]
fn run_on_is_todays_engine_when_no_key_was_ever_pressed() {
    // No `with_keys`, against a deck given keys it never hears from.
    let src = source(96_000);
    let sp = params(96_000);
    let shared_a = Shared::new(sp, Arc::clone(&src));
    let shared_b = Shared::new(sp, Arc::clone(&src));
    let mut a = Core::new(BLOCK, 1, sp, Arc::clone(&src));
    let mut b = Core::new(BLOCK, 1, sp, Arc::clone(&src)).with_keys(Arc::new(GrainKeys::new()));
    shared_a.play();
    shared_b.play();
    let (mut x, mut y) = (vec![0f32; BLOCK], vec![0f32; BLOCK]);
    for _ in 0..40 {
        a.fill(&mut x, 1, &shared_a);
        b.fill(&mut y, 1, &shared_b);
        assert_eq!(x, y);
    }
    assert_eq!(shared_a.position(), shared_b.position());
}

#[test]
fn a_note_sounds_on_a_stopped_transport_and_the_transport_stays_stopped() {
    let mut r = rig();
    assert!(!r.shared.is_playing());
    assert_eq!(peak(&pump(&mut r, 2)), 0.0);
    r.keys.note_on(60, 1.0);
    assert!(peak(&pump(&mut r, 20)) > 0.1);
    assert!(!r.shared.is_playing(), "a key is not the Play button");
    assert_eq!(r.shared.position(), 0, "the transport did not move");
    r.keys.note_off(60);
    pump(&mut r, 20);
    assert_eq!(peak(&pump(&mut r, 2)), 0.0);
    assert!(!r.shared.is_playing());
}

#[test]
fn with_run_off_a_rolling_transport_is_silent_until_a_key_and_keeps_its_own_time() {
    let mut r = rig();
    r.shared.play();
    assert_eq!(peak(&pump(&mut r, 20)), 0.0);
    assert_eq!(r.shared.position(), 20 * BLOCK as u64);
    r.keys.set_start(0.5);
    r.keys.note_on(60, 1.0);
    let sound = pump(&mut r, 20);
    assert!(peak(&sound) > 0.1);
    // The head went to Start; the transport carried on as if nothing happened,
    // which is what a take's timeline is measured against.
    assert_eq!(r.shared.position(), 40 * BLOCK as u64);
    assert!(r.keys.head() >= 48_000);
    assert!(r.shared.is_playing());
}

#[test]
fn turning_run_on_puts_the_head_back_with_the_transport() {
    let mut r = rig();
    r.shared.play();
    r.keys.set_start(0.5);
    r.keys.note_on(60, 1.0);
    pump(&mut r, 10);
    r.keys.note_off(60);
    pump(&mut r, 10);
    r.keys.set_run(true);
    pump(&mut r, 1);
    assert_eq!(r.shared.position(), 21 * BLOCK as u64);
    let level = peak(&pump(&mut r, 20));
    assert!(level > 0.1, "Run brings the cloud back: {level}");
}

#[test]
fn effect_tails_ring_on_after_the_release() {
    let mut r = rig();
    let mut rack = fx::Rack::new();
    rack.push(Box::new(Delay { line: vec![0.0; 24_000], at: 0 }));
    r.shared.set_rack(Some(rack));
    pump(&mut r, 1);
    r.keys.note_on(60, 1.0);
    pump(&mut r, 30);
    r.keys.note_off(60);
    pump(&mut r, 8);
    assert!(!r.keys.sounding(), "the note itself has finished");
    // Half a second later, out of the delay.
    let tail = pump(&mut r, 45);
    assert!(peak(&tail) > 0.1, "the tail: {}", peak(&tail));
    assert!(!r.shared.is_playing());
}

#[test]
fn a_new_device_keeps_the_keys() {
    let keys = Arc::new(GrainKeys::new());
    keys.set_run(false);
    keys.set_mode(KeyMode::Legato);
    keys.set_amp(0.005, 0.01, 1.0, 0.02);
    keys.set_key(64, 7.0);
    let src = source(96_000);
    let sp = params(96_000);
    let shared = Shared::new(sp, Arc::clone(&src));
    {
        let mut first = Core::new(BLOCK, 1, sp, Arc::clone(&src)).with_keys(Arc::clone(&keys));
        let mut buf = vec![0f32; BLOCK];
        first.fill(&mut buf, 1, &shared);
    }
    // A note sent while the device was being reopened is not lost, and the
    // settings are where they were.
    keys.note_on(64, 1.0);
    let mut second = Core::new(BLOCK, 1, sp, Arc::clone(&src)).with_keys(Arc::clone(&keys));
    let mut buf = vec![0f32; BLOCK];
    let mut loud = 0f32;
    for _ in 0..20 {
        second.fill(&mut buf, 1, &shared);
        loud = loud.max(peak(&buf));
    }
    assert!(loud > 0.1);
    assert_eq!(keys.mode(), KeyMode::Legato);
    let ev = shared.drain_events();
    assert!((ev.last().unwrap().pitch_semis - 7.0).abs() < 1e-3);
}

#[test]
fn reset_lets_everything_go_and_puts_the_pitch_back() {
    let mut r = rig();
    r.keys.note_on(72, 1.0);
    pump(&mut r, 10);
    r.keys.reset();
    pump(&mut r, 20);
    assert!(r.keys.run(), "Run is on again, as the engine was before");
    assert!(!r.keys.replay());
    r.shared.play();
    pump(&mut r, 20);
    r.shared.drain_events();
    pump(&mut r, 10);
    let ev = r.shared.drain_events();
    assert!(!ev.is_empty());
    assert!(ev.iter().all(|e| e.pitch_semis.abs() < 1e-3), "{}", ev[0].pitch_semis);
}

#[test]
fn a_modules_footer_moves_live_through_the_engine() {
    let src = source(96_000);
    let sp = params(96_000);
    let shared = Shared::new(sp, Arc::clone(&src));
    let mut core = Core::new(BLOCK, 1, sp, src);
    shared.play();
    let mut rack = fx::Rack::new();
    rack.push(Box::new(fx::Gain { db: 0.0 }));
    shared.set_rack(Some(rack));
    let mut buf = vec![0f32; BLOCK];
    let mut level = |core: &mut Core, blocks: usize| {
        let mut p = 0f32;
        for _ in 0..blocks {
            core.fill(&mut buf, 1, &shared);
            p = p.max(peak(&buf));
        }
        p
    };
    level(&mut core, 30);
    let full = level(&mut core, 30);
    shared.set_manual_param(0, fx::SLOT_LEVEL, -12.0);
    level(&mut core, 60);
    let trimmed = level(&mut core, 30);
    assert!((trimmed / full - 0.251).abs() < 0.03, "{trimmed} against {full}");
}

/// Every meter a note can reach, with the transport stopped: what it publishes
/// while held, and that all of it falls to silence once the release is over.
#[test]
fn a_held_note_on_a_stopped_transport_moves_the_meters_and_they_fall_after_it() {
    let mut r = rig();
    let mut rack = fx::Rack::new();
    rack.push(Box::new(fx::Gain { db: 0.0 }));
    r.shared.set_rack(Some(rack));
    r.keys.note_on(60, 1.0);
    pump(&mut r, 40);
    assert!(!r.shared.is_playing(), "the transport moved");
    assert!(r.keys.sounding(), "the note is not sounding");
    let wave = r.shared.waveform();
    assert!(!wave.is_empty() && wave.iter().any(|v| v.unsigned_abs() > 10), "no waveform: {wave:?}");
    let spec = r.shared.spectrum();
    assert!(!spec.is_empty() && spec.iter().any(|b| *b > 100), "no spectrum");
    assert!(r.shared.rack_levels().iter().any(|(a, b)| *a > 0.01 || *b > 0.01), "the rack meters did not move");
    let (l, _, _) = r.shared.scope_snapshot().expect("nothing reached the master bus");
    assert!(peak(&l) > 0.05, "the master bus is silent");

    r.keys.note_off(60);
    // Past the release and everything a stopped rack is allowed to ring for.
    pump(&mut r, 600);
    assert!(!r.keys.sounding(), "the release never finished");
    assert!(r.shared.waveform().iter().all(|v| *v == 0), "the waveform held its last block");
    assert!(r.shared.spectrum().iter().all(|b| *b == 0), "the spectrum held its last block");
    assert!(r.shared.rack_levels().iter().all(|(a, b)| *a == 0.0 && *b == 0.0), "the rack meters held");
    let (l, _, _) = r.shared.scope_snapshot().unwrap();
    assert_eq!(peak(&l), 0.0, "the master bus did not drain");
}
