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

        vocoder: fx::stretch::VocoderParams::default(),


        pvsola: fx::pvsola::PvsolaParams::default(),



        hybrid: fx::hybrid::HybridParams::default(),



        cloud: false,



        cloud_mix: 0.5,
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

/// The callback publishes the loop it actually used.
///
/// A playhead drawn anywhere else has to wrap in the same place. It cannot
/// work out where that is: a loop end of zero means "the whole document" and
/// only the callback knows how long that is under the current ratio — the
/// interface guessed once and ran the playhead past the end of a looping file.
#[test]
fn the_resolved_loop_is_published_for_whoever_draws_the_playhead() {
    let channels = 1;
    let src = source(20_000, channels);
    let sp = params(20_000);
    let shared = Arc::new(Shared::new(sp, Arc::clone(&src)));
    let mut core = Core::new(512, channels, sp, Arc::clone(&src));

    // Nothing has run yet, so there is nothing to report.
    assert_eq!(shared.heard_loop(), None, "a loop was reported before any fill");

    shared.set_loop(true, 4_000, 12_000);
    shared.play();
    pump(&mut core, &shared, channels, 512, 4);
    assert_eq!(
        shared.heard_loop(),
        Some((4_000, 12_000)),
        "the loop the callback used was not reported"
    );

    // Zero means the whole document, and the resolved end is the document's
    // length — which is the number the interface cannot compute for itself.
    shared.set_loop(true, 0, 0);
    pump(&mut core, &shared, channels, 512, 4);
    let (a, b) = shared.heard_loop().expect("a whole-document loop reported nothing");
    assert_eq!(a, 0);
    assert_eq!(b, 20_000, "the whole-document end was not resolved");

    // And turning it off stops reporting one, rather than leaving the last.
    shared.set_loop(false, 0, 0);
    pump(&mut core, &shared, channels, 512, 2);
    assert_eq!(shared.heard_loop(), None, "a stale loop was left behind");
}

/// A playhead drawn from the counter leads the sound by the device's buffer.
///
/// Nothing here can open a device, so this only pins the arithmetic and the
/// default: no report means no correction, rather than a guess.
#[test]
fn the_output_latency_is_zero_until_a_device_reports_one() {
    let src = source(1_000, 1);
    let shared = Shared::new(params(1_000), Arc::clone(&src));
    assert_eq!(shared.latency_frames(), 0);
    shared.set_latency_frames(512);
    assert_eq!(shared.latency_frames(), 512);
}

// -------------------------------------------------- smoothing driven controls
//
// A control written straight into an effect jumps at a block boundary, and a
// discontinuity in a gain or a mix is a click. These pin that every driven
// control is walked to its new value instead — and that the ones which cannot
// meaningfully be halfway between two settings still jump.

/// A rack whose one slot is a gain, driven through the transport.
fn gain_rack() -> fx::Rack {
    let mut rack = fx::Rack::new();
    rack.push(Box::new(fx::Gain { db: 0.0 }));
    rack
}

/// Sharpest *corner* in a buffer — a click, measured.
///
/// The second difference, not the first. A control that ramps to a new value
/// changes the signal sample to sample by design; what makes a click is the
/// signal changing direction abruptly, which is what this sees and a
/// first-difference measure cannot tell apart from an honest slope.
fn worst_corner(buf: &[f32]) -> f32 {
    buf.windows(3)
        .map(|w| (w[2] - 2.0 * w[1] + w[0]).abs())
        .fold(0f32, f32::max)
}

#[test]
fn a_control_moved_in_one_go_does_not_click() {
    let sr = 48_000u32;
    let source = std::sync::Arc::new(engine::render::Source {
        samples: (0..sr as usize).map(|i| (i as f32 / 40.0).sin() * 0.5).collect(),
        channels: 1,
    });
    let params = fx::grain::StreamParams::new(source.frames(), sr);
    let shared = std::sync::Arc::new(engine::transport::Shared::new(params, source.clone()));
    let mut core = engine::transport::Core::new(1024, 1, params, source);
    shared.set_rack(Some(gain_rack()));
    shared.play();

    let mut out = vec![0.0f32; 512];
    // Settle, with the gain where it starts.
    for _ in 0..4 {
        core.fill(&mut out, 1, &shared);
    }

    // Now ask for a large change in one step, the way releasing a slider does.
    shared.set_manual_param(0, "db", -24.0);
    let mut moved = vec![0.0f32; 512];
    core.fill(&mut moved, 1, &shared);

    // Across the boundary, not within the block. The jump happens on the first
    // sample after the change, so measuring inside `moved` alone misses it
    // entirely — which is exactly what the first version of this test did.
    let mut joined = out[out.len() - 2..].to_vec();
    joined.extend_from_slice(&moved);
    let got = worst_corner(&joined);

    // Measured against the jump this move *would* have made unsmoothed, which
    // is the only meaningful yardstick: the test signal is a slow sine whose
    // own worst corner is a ten-thousandth, so comparing against that would
    // call any change at all a click.
    let peak = out.iter().fold(0f32, |m, v| m.max(v.abs()));
    let unsmoothed = peak * (1.0 - 10f32.powf(-24.0 / 20.0));
    assert!(
        got < unsmoothed * 0.1,
        "a 24 dB move put a corner of {got:.4} in; unsmoothed it would have been \
         about {unsmoothed:.4}, and a tenth of that is the most a ramp should leave"
    );
}

#[test]
fn a_smoothed_control_does_arrive() {
    let sr = 48_000u32;
    let source = std::sync::Arc::new(engine::render::Source {
        samples: vec![1.0; sr as usize],
        channels: 1,
    });
    let params = fx::grain::StreamParams::new(source.frames(), sr);
    let shared = std::sync::Arc::new(engine::transport::Shared::new(params, source.clone()));
    let mut core = engine::transport::Core::new(1024, 1, params, source);
    shared.set_rack(Some(gain_rack()));
    shared.play();

    let mut out = vec![0.0f32; 256];
    core.fill(&mut out, 1, &shared);
    shared.set_manual_param(0, "db", -20.0);
    // 15 ms at 48 kHz is about three of these blocks; give it ten.
    for _ in 0..10 {
        core.fill(&mut out, 1, &shared);
    }
    let want = 10f32.powf(-20.0 / 20.0);
    let got = out.iter().fold(0f32, |m, v| m.max(v.abs()));
    assert!(
        (got - want).abs() < want * 0.15,
        "asked for {want:.3} and after 10 blocks it is at {got:.3}"
    );
}

/// Swapping a module must not step.
///
/// A rack handed over outright takes every delay line, filter and reverb tail
/// in the chain with it and starts the new chain from silence. The two blocks
/// either side of the swap have nothing to do with each other, and a
/// discontinuity in a waveform is a click. The old chain now keeps running for
/// twenty milliseconds and the two are mixed.
///
/// Measured against the same block with nothing swapped, which is the only
/// baseline that means anything — the material has corners of its own.
/// Neutered, by swapping outright instead of fading, the corner goes from
/// 0.00020 to 0.35 — seventeen hundred times, and plainly audible.
#[test]
fn swapping_a_module_does_not_click() {
    let src = source(48_000, 1);
    let sp = params(48_000);
    let shared = Shared::new(sp, Arc::clone(&src));
    let mut core = Core::new(512, src.channels, sp, Arc::clone(&src));
    shared.play();

    // Start with a rack in the chain, and let it settle.
    let mut first = fx::Rack::new();
    first.push(Box::new(fx::Gain { db: 0.0 }));
    shared.set_rack(Some(first));
    pump(&mut core, &shared, 1, 512, 4);

    let steady = pump(&mut core, &shared, 1, 512, 1);
    let quiet = worst_corner(&steady);

    // Swap it for a chain that sounds nothing like it.
    let mut second = fx::Rack::new();
    second.push(Box::new(fx::Gain { db: -18.0 }));
    shared.set_rack(Some(second));

    let mut joined = steady[steady.len() - 2..].to_vec();
    joined.extend(pump(&mut core, &shared, 1, 512, 1));
    let jolt = worst_corner(&joined);

    assert!(
        jolt < quiet * 6.0,
        "the swap put a corner of {jolt:.5} in against a steady {quiet:.5}"
    );
}

/// And the fade has to finish, or the old chain plays forever underneath.
#[test]
fn a_swapped_out_module_stops_being_heard() {
    let src = source(48_000, 1);
    let sp = params(48_000);
    let shared = Shared::new(sp, Arc::clone(&src));
    let mut core = Core::new(512, src.channels, sp, Arc::clone(&src));
    shared.play();

    let mut loud = fx::Rack::new();
    loud.push(Box::new(fx::Gain { db: 0.0 }));
    shared.set_rack(Some(loud));
    pump(&mut core, &shared, 1, 512, 4);
    let before = pump(&mut core, &shared, 1, 512, 1);
    let before_peak = before.iter().fold(0f32, |m, s| m.max(s.abs()));

    let mut quiet = fx::Rack::new();
    quiet.push(Box::new(fx::Gain { db: -40.0 }));
    shared.set_rack(Some(quiet));

    // Well past the twenty milliseconds the crossover takes.
    pump(&mut core, &shared, 1, 512, 4);
    let after = pump(&mut core, &shared, 1, 512, 2);
    let after_peak = after.iter().fold(0f32, |m, s| m.max(s.abs()));

    let ratio = after_peak / before_peak.max(1e-9);
    assert!(ratio < 0.02, "the old chain is still audible: {ratio:.4} of it");
}
