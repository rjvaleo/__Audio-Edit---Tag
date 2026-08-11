//! The audio callback minus the sound card. Looping, seeking and stopping are
//! exactly the things that are miserable to debug through a pair of speakers,
//! so they are driven frame by frame here instead.

use engine::{Core, Shared, Source};
use fx::grain::{Grain, StreamParams};
use std::sync::Arc;

const SR: u32 = 48_000;

fn source(frames: usize, channels: usize) -> Arc<Source> {
    // A steady tone: any gap, click or level change is then obvious.
    let samples = (0..frames * channels)
        .map(|i| ((i / channels) as f32 * 0.02).sin() * 0.5)
        .collect();
    Arc::new(Source { samples, channels })
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
    }
}

/// Run the callback `blocks` times and hand back everything it produced.
fn pump(core: &mut Core, shared: &Shared, channels: usize, block: usize, blocks: usize) -> Vec<f32> {
    let mut buf = vec![0f32; block * channels];
    let mut all = Vec::new();
    for _ in 0..blocks {
        core.fill(&mut buf, channels, shared);
        all.extend_from_slice(&buf);
    }
    all
}

#[test]
fn a_paused_engine_is_silent_and_does_not_move() {
    let src = source(48_000, 1);
    let sp = params(48_000);
    let shared = Shared::new(sp, Arc::clone(&src));
    let mut core = Core::new(512, src.channels, sp, src);

    let out = pump(&mut core, &shared, 1, 512, 4);
    assert!(out.iter().all(|s| *s == 0.0), "paused output is not silent");
    assert_eq!(shared.position(), 0, "paused engine advanced");
}

#[test]
fn playing_advances_the_position_by_exactly_one_block_each_callback() {
    let src = source(48_000, 1);
    let sp = params(48_000);
    let shared = Shared::new(sp, Arc::clone(&src));
    let mut core = Core::new(512, src.channels, sp, src);
    shared.play();

    for n in 1..=6u64 {
        pump(&mut core, &shared, 1, 512, 1);
        assert_eq!(shared.position(), n * 512, "after {n} blocks");
    }
}

#[test]
fn playing_produces_sound() {
    let src = source(48_000, 1);
    let sp = params(48_000);
    let shared = Shared::new(sp, Arc::clone(&src));
    let mut core = Core::new(512, src.channels, sp, src);
    shared.play();

    // Skip the first block: the overlap-add has not built up yet.
    pump(&mut core, &shared, 1, 512, 1);
    let out = pump(&mut core, &shared, 1, 512, 4);
    let peak = out.iter().fold(0f32, |m, s| m.max(s.abs()));
    assert!(peak > 0.1, "engine produced near-silence, peak {peak}");
    assert!(out.iter().all(|s| s.is_finite()), "non-finite output");
}

#[test]
fn a_seek_takes_effect_on_the_next_block() {
    let src = source(48_000, 1);
    let sp = params(48_000);
    let shared = Shared::new(sp, Arc::clone(&src));
    let mut core = Core::new(512, src.channels, sp, src);
    shared.play();

    pump(&mut core, &shared, 1, 512, 2);
    shared.request_seek(20_000);
    pump(&mut core, &shared, 1, 512, 1);
    assert_eq!(shared.position(), 20_512);
}

#[test]
fn looping_wraps_at_the_end_and_never_runs_past_it() {
    let src = source(48_000, 1);
    let sp = params(48_000);
    let shared = Shared::new(sp, Arc::clone(&src));
    let mut core = Core::new(512, src.channels, sp, src);
    shared.play();
    shared.set_loop(true, 4_000, 12_000);

    // Far more blocks than the loop is long: it must still be inside.
    for _ in 0..200 {
        pump(&mut core, &shared, 1, 512, 1);
        let p = shared.position();
        assert!(
            (4_000..=12_000).contains(&p),
            "position {p} escaped the loop"
        );
    }
}

/// Wrapping must not leave a hole. A dropout at the seam is exactly the click
/// the fade exists to prevent.
#[test]
fn the_loop_seam_has_no_silent_gap() {
    let src = source(48_000, 1);
    let sp = params(48_000);
    let shared = Shared::new(sp, Arc::clone(&src));
    let mut core = Core::new(256, src.channels, sp, src);
    shared.play();
    shared.set_loop(true, 2_000, 10_000);

    pump(&mut core, &shared, 1, 256, 8); // let the overlap build
    let out = pump(&mut core, &shared, 1, 256, 120);

    // No run of dead samples longer than the two fade ramps together.
    let mut run = 0usize;
    let mut worst = 0usize;
    for s in &out {
        if s.abs() < 1e-4 {
            run += 1;
            worst = worst.max(run);
        } else {
            run = 0;
        }
    }
    assert!(worst < 1200, "silent run of {worst} frames across the loop seam");
}

/// The whole point of the exercise: a control moved while sound is coming out
/// changes the sound, without a reload, a restart or a gap.
#[test]
fn parameters_change_the_sound_without_interrupting_it() {
    let src = source(48_000, 1);
    let sp = params(48_000);
    let shared = Shared::new(sp, Arc::clone(&src));
    let mut core = Core::new(512, src.channels, sp, src);
    shared.play();

    pump(&mut core, &shared, 1, 512, 2);
    let before = pump(&mut core, &shared, 1, 512, 2);

    let mut hot = sp;
    hot.grain.pitch_jitter_semis = 7.0;
    hot.grain.density_hz = 120.0;
    shared.set_params(hot);

    let after = pump(&mut core, &shared, 1, 512, 2);

    assert!(after.iter().all(|s| s.is_finite()));
    let peak = after.iter().fold(0f32, |m, s| m.max(s.abs()));
    assert!(peak > 0.05, "sound stopped when a control moved, peak {peak}");
    assert!(before != after, "changing the controls changed nothing");
    // And it kept playing straight through — no reset to the start.
    assert_eq!(shared.position(), 512 * 6);
}

#[test]
fn resampling_preserves_length_and_level() {
    let frames = 10_000;
    let input: Vec<f32> = (0..frames).map(|i| (i as f32 * 0.01).sin() * 0.8).collect();

    let up = engine::resample(&input, 1, 44_100, 48_000);
    assert_eq!(up.len(), (frames as f64 * 48_000.0 / 44_100.0).round() as usize);

    let peak_in = input.iter().fold(0f32, |m, s| m.max(s.abs()));
    let peak_out = up.iter().fold(0f32, |m, s| m.max(s.abs()));
    assert!((peak_in - peak_out).abs() < 0.02, "{peak_in} vs {peak_out}");

    // Same rate in and out must be a straight copy, not a rebuild.
    assert_eq!(engine::resample(&input, 1, 48_000, 48_000), input);
}

/// The rack has to run inside the callback, on the block, or effects only
/// appear on export.
#[test]
fn the_rack_is_applied_to_live_output() {
    let src = source(48_000, 1);
    let sp = params(48_000);
    let shared = Shared::new(sp, Arc::clone(&src));
    let mut core = Core::new(512, src.channels, sp, src);
    shared.play();

    pump(&mut core, &shared, 1, 512, 2);
    let dry = pump(&mut core, &shared, 1, 512, 2);
    let dry_peak = dry.iter().fold(0f32, |m, s| m.max(s.abs()));

    // A rack that does nothing but drop the level by 12 dB.
    let mut rack = fx::Rack::new();
    rack.push(Box::new(fx::Gain { db: -12.0 }));
    shared.set_rack(Some(rack));

    let wet = pump(&mut core, &shared, 1, 512, 2);
    let wet_peak = wet.iter().fold(0f32, |m, s| m.max(s.abs()));

    let ratio = wet_peak / dry_peak.max(1e-9);
    assert!(
        (ratio - 0.251).abs() < 0.05,
        "-12 dB should quarter the level; got {ratio} ({dry_peak} -> {wet_peak})"
    );

    // And removing it restores the level.
    shared.set_rack(None);
    let back = pump(&mut core, &shared, 1, 512, 2);
    let back_peak = back.iter().fold(0f32, |m, s| m.max(s.abs()));
    assert!((back_peak / dry_peak.max(1e-9) - 1.0).abs() < 0.1, "rack was not removed");
}

/// A grain stream will happily run forever, reading the clamped last sample of
/// the source. Something has to stop it at the end of the document.
#[test]
fn playback_stops_at_the_end_when_not_looping() {
    let src = source(4_800, 1); // 0.1 s
    let sp = params(4_800);
    let shared = Shared::new(sp, Arc::clone(&src));
    let mut core = Core::new(512, src.channels, sp, src);
    shared.play();

    for _ in 0..40 {
        pump(&mut core, &shared, 1, 512, 1);
    }
    assert!(!shared.is_playing(), "ran past the end of the document");
    assert!(
        shared.position() <= 4_800 + 512,
        "stopped {} frames past the end",
        shared.position() as i64 - 4_800
    );
}

/// But a loop must not be stopped by that rule.
#[test]
fn looping_is_not_cut_short_by_the_end_stop() {
    let src = source(4_800, 1);
    let sp = params(4_800);
    let shared = Shared::new(sp, Arc::clone(&src));
    let mut core = Core::new(256, src.channels, sp, src);
    shared.play();
    shared.set_loop(true, 500, 3_500);

    for _ in 0..200 {
        pump(&mut core, &shared, 1, 256, 1);
    }
    assert!(shared.is_playing(), "the loop was stopped by the end stop");
}

/// A loop end of zero means "the whole document", so the caller never has to
/// track a length that the stretch ratio keeps changing underneath it.
#[test]
fn a_zero_loop_end_means_the_whole_document() {
    let src = source(4_800, 1);
    let sp = params(4_800);
    let shared = Shared::new(sp, Arc::clone(&src));
    let mut core = Core::new(256, src.channels, sp, src);
    shared.play();
    shared.set_loop(true, 0, 0);

    for _ in 0..300 {
        pump(&mut core, &shared, 1, 256, 1);
        assert!(shared.position() <= 4_800, "escaped to {}", shared.position());
    }
    assert!(shared.is_playing(), "a whole-document loop must not stop");
}

/// And a loop end past the document is clamped to it rather than running into
/// the clamped tail of the source.
#[test]
fn a_loop_end_past_the_document_is_clamped() {
    let src = source(4_800, 1);
    let sp = params(4_800);
    let shared = Shared::new(sp, Arc::clone(&src));
    let mut core = Core::new(256, src.channels, sp, src);
    shared.play();
    shared.set_loop(true, 0, 999_999);

    for _ in 0..200 {
        pump(&mut core, &shared, 1, 256, 1);
        assert!(shared.position() <= 4_800, "escaped to {}", shared.position());
    }
}
