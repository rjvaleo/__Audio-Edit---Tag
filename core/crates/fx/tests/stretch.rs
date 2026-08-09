//! Time stretch and pitch shift.
//!
//! The two properties that matter are opposites of each other: stretching must
//! change the length and *not* the pitch; shifting must change the pitch and
//! *not* the length. Both are measured on real signals.

use fx::stretch::{Quality, Stretch};

const SR: u32 = 48000;

fn sine(freq: f32, frames: usize, amp: f32) -> Vec<f32> {
    (0..frames)
        .map(|i| amp * (2.0 * std::f32::consts::PI * freq * i as f32 / SR as f32).sin())
        .collect()
}

/// Estimate frequency from zero crossings over the steady middle of a buffer.
///
/// Crude, but exact enough for a clean tone and free of any dependency on the
/// FFT this crate does not have.
fn est_freq(buf: &[f32], channels: usize) -> f32 {
    let frames = buf.len() / channels;
    let a = frames / 4;
    let b = frames * 3 / 4;
    let mut crossings = 0usize;
    let mut prev = buf[a * channels];
    for f in a + 1..b {
        let v = buf[f * channels];
        if prev <= 0.0 && v > 0.0 {
            crossings += 1;
        }
        prev = v;
    }
    let secs = (b - a) as f32 / SR as f32;
    crossings as f32 / secs
}

fn rms(buf: &[f32]) -> f32 {
    if buf.is_empty() {
        return 0.0;
    }
    (buf.iter().map(|v| v * v).sum::<f32>() / buf.len() as f32).sqrt()
}

fn stretch(ratio: f32, semitones: f32) -> Stretch {
    Stretch { ratio, semitones, window_ms: 40.0, quality: Quality::Standard,
              grain: fx::Grain::default() }
}

// ==================================================================== length

#[test]
fn a_ratio_of_one_and_no_shift_is_the_identity() {
    let s = stretch(1.0, 0.0);
    assert!(s.is_identity());
    let input = sine(440.0, 8000, 0.5);
    assert_eq!(s.process(&input, 1, SR), input);
}

#[test]
fn stretching_to_double_doubles_the_length() {
    let input = sine(440.0, 24000, 0.5);
    let out = stretch(2.0, 0.0).process(&input, 1, SR);
    assert_eq!(out.len(), 48000);
}

#[test]
fn compressing_to_half_halves_the_length() {
    let input = sine(440.0, 24000, 0.5);
    let out = stretch(0.5, 0.0).process(&input, 1, SR);
    assert_eq!(out.len(), 12000);
}

#[test]
fn the_predicted_output_length_matches_what_is_produced() {
    // The edit timeline is laid out from output_frames before any audio is
    // rendered; if the two disagree the playhead drifts from the waveform.
    for ratio in [0.5f32, 0.75, 1.5, 2.0, 3.0] {
        let s = stretch(ratio, 0.0);
        let input = sine(440.0, 20000, 0.4);
        let predicted = s.output_frames(20000) as usize;
        let actual = s.process(&input, 1, SR).len();
        assert_eq!(predicted, actual, "at ratio {ratio}");
    }
}

#[test]
fn a_pitch_shift_alone_leaves_the_length_untouched() {
    let input = sine(440.0, 24000, 0.5);
    for semis in [-12.0f32, -5.0, 5.0, 12.0] {
        let out = stretch(1.0, semis).process(&input, 1, SR);
        assert_eq!(out.len(), 24000, "at {semis} semitones");
    }
}

// ===================================================================== pitch

#[test]
fn stretching_does_not_change_the_pitch() {
    // The entire point. A resampled file would come out an octave down at 2x.
    let input = sine(1000.0, 48000, 0.5);
    for ratio in [0.5f32, 1.5, 2.0] {
        let out = stretch(ratio, 0.0).process(&input, 1, SR);
        let f = est_freq(&out, 1);
        assert!(
            (f - 1000.0).abs() < 30.0,
            "at ratio {ratio} the tone moved to {f} Hz"
        );
    }
}

#[test]
fn shifting_up_an_octave_doubles_the_frequency() {
    let input = sine(500.0, 48000, 0.5);
    let out = stretch(1.0, 12.0).process(&input, 1, SR);
    let f = est_freq(&out, 1);
    assert!((f - 1000.0).abs() < 40.0, "expected about 1000 Hz, got {f}");
}

#[test]
fn shifting_down_an_octave_halves_the_frequency() {
    let input = sine(1000.0, 48000, 0.5);
    let out = stretch(1.0, -12.0).process(&input, 1, SR);
    let f = est_freq(&out, 1);
    assert!((f - 500.0).abs() < 25.0, "expected about 500 Hz, got {f}");
}

#[test]
fn a_seven_semitone_shift_lands_on_a_fifth() {
    let input = sine(400.0, 48000, 0.5);
    let out = stretch(1.0, 7.0).process(&input, 1, SR);
    let expected = 400.0 * 2f32.powf(7.0 / 12.0); // about 599 Hz
    let f = est_freq(&out, 1);
    assert!((f - expected).abs() < 30.0, "expected about {expected} Hz, got {f}");
}

#[test]
fn stretch_and_shift_together_do_both_jobs() {
    let input = sine(500.0, 48000, 0.5);
    let out = stretch(2.0, 12.0).process(&input, 1, SR);
    assert_eq!(out.len(), 96000, "length should follow the ratio alone");
    let f = est_freq(&out, 1);
    assert!((f - 1000.0).abs() < 45.0, "pitch should have doubled, got {f}");
}

// =================================================================== signal

#[test]
fn the_level_is_broadly_preserved() {
    // Overlap-add without the window normalisation would come out lumpy or
    // roughly half the level.
    let input = sine(440.0, 48000, 0.5);
    let out = stretch(1.7, 0.0).process(&input, 1, SR);
    let before = rms(&input);
    let after = rms(&out);
    assert!(
        (after / before - 1.0).abs() < 0.25,
        "level moved from {before} to {after}"
    );
}

#[test]
fn silence_stretches_to_silence() {
    let out = stretch(2.5, 0.0).process(&vec![0.0f32; 24000], 1, SR);
    assert_eq!(out.len(), 60000);
    assert!(out.iter().all(|v| *v == 0.0));
}

#[test]
fn the_output_never_contains_nan_or_runaway_values() {
    let input = sine(300.0, 24000, 0.9);
    for (ratio, semis) in [(0.25f32, -24.0f32), (4.0, 24.0), (0.1, 0.0), (10.0, 0.0)] {
        let out = stretch(ratio, semis).process(&input, 1, SR);
        assert!(out.iter().all(|v| v.is_finite()), "NaN at {ratio}/{semis}");
        assert!(out.iter().all(|v| v.abs() <= 4.0), "runaway at {ratio}/{semis}");
    }
}

#[test]
fn stereo_channels_stay_aligned() {
    // Left and right carry the same tone a constant apart; if the splice search
    // ran per channel they would drift out of step.
    let mono = sine(440.0, 24000, 0.4);
    let mut input = Vec::new();
    for v in &mono {
        input.push(*v);
        input.push(*v * 0.5);
    }
    let out = stretch(1.6, 0.0).process(&input, 2, SR);
    let frames = out.len() / 2;
    let mut worst = 0f32;
    for f in frames / 4..frames * 3 / 4 {
        worst = worst.max((out[f * 2 + 1] - out[f * 2] * 0.5).abs());
    }
    assert!(worst < 0.05, "channels drifted apart by {worst}");
}

#[test]
fn a_buffer_too_short_to_splice_is_still_handled() {
    // A 5 ms one-shot is shorter than a single analysis window.
    let input = sine(1000.0, 240, 0.5);
    let out = stretch(2.0, 0.0).process(&input, 1, SR);
    assert_eq!(out.len(), 480);
    assert!(out.iter().all(|v| v.is_finite()));
}

#[test]
fn an_empty_buffer_produces_an_empty_result() {
    assert!(stretch(2.0, 0.0).process(&[], 1, SR).is_empty());
}

#[test]
fn every_quality_tier_produces_the_right_length_and_pitch() {
    for q in [Quality::Draft, Quality::Standard, Quality::Best] {
        let s = Stretch { ratio: 1.8, semitones: 0.0, window_ms: 40.0, quality: q,
                          grain: fx::Grain::default() };
        let input = sine(800.0, 48000, 0.5);
        let out = s.process(&input, 1, SR);
        assert_eq!(out.len(), 86400, "{q:?} length");
        let f = est_freq(&out, 1);
        assert!((f - 800.0).abs() < 40.0, "{q:?} pitch drifted to {f}");
    }
}

#[test]
fn the_window_length_is_clamped_to_something_usable() {
    // These come from a slider over HTTP; a 0 ms window would divide by zero.
    for window_ms in [0.0f32, 1.0, 5000.0] {
        let s = Stretch { ratio: 1.5, semitones: 0.0, window_ms, quality: Quality::Draft,
                          grain: fx::Grain::default() };
        let out = s.process(&sine(440.0, 24000, 0.4), 1, SR);
        assert_eq!(out.len(), 36000, "at window {window_ms} ms");
        assert!(out.iter().all(|v| v.is_finite()));
    }
}

#[test]
fn wsola_beats_plain_resampling_at_holding_pitch() {
    // The comparison that justifies the algorithm: resampling to double the
    // length drops the tone an octave, WSOLA does not.
    let input = sine(1000.0, 48000, 0.5);
    let stretched = stretch(2.0, 0.0).process(&input, 1, SR);

    // Naive alternative: read the same samples at half speed.
    let naive: Vec<f32> = (0..96000)
        .map(|i| {
            let p = i as f32 / 2.0;
            let a = p.floor() as usize;
            let t = p - a as f32;
            let s0 = input[a.min(input.len() - 1)];
            let s1 = input[(a + 1).min(input.len() - 1)];
            s0 + (s1 - s0) * t
        })
        .collect();

    let f_wsola = est_freq(&stretched, 1);
    let f_naive = est_freq(&naive, 1);
    assert!((f_naive - 500.0).abs() < 20.0, "the naive control should drop an octave, got {f_naive}");
    assert!((f_wsola - 1000.0).abs() < 30.0, "WSOLA should hold pitch, got {f_wsola}");
}

// ================================================================= granular

use fx::Grain;

fn grainy(f: impl FnOnce(&mut Grain)) -> Stretch {
    let mut g = Grain::default();
    f(&mut g);
    Stretch { ratio: 1.0, semitones: 0.0, window_ms: 40.0, quality: Quality::Standard, grain: g }
}

#[test]
fn default_grain_settings_are_inert() {
    // A fresh document must behave exactly as the plain stretcher did.
    let g = Grain::default();
    assert!(g.is_clean());
    assert!(!Stretch::default().is_granular());
    assert!(Stretch::default().is_identity());
}

#[test]
fn engaging_any_grain_control_switches_the_engine_on() {
    assert!(grainy(|g| g.pitch_jitter_semis = 1.0).is_granular());
    assert!(grainy(|g| g.size_jitter = 0.3).is_granular());
    assert!(grainy(|g| g.position_jitter_ms = 20.0).is_granular());
    assert!(grainy(|g| g.pitch_drift_semis = 2.0).is_granular());
    assert!(grainy(|g| g.density_hz = 30.0).is_granular());
    assert!(grainy(|g| g.overlap = 4.0).is_granular());
}

#[test]
fn granular_still_produces_the_promised_length() {
    // Everything downstream lays out the timeline from output_frames.
    for ratio in [0.5f32, 1.0, 2.0, 3.0] {
        let mut s = grainy(|g| { g.pitch_jitter_semis = 3.0; g.position_jitter_ms = 30.0; });
        s.ratio = ratio;
        let input = sine(440.0, 24000, 0.5);
        assert_eq!(
            s.process(&input, 1, SR).len(),
            s.output_frames(24000) as usize,
            "at ratio {ratio}"
        );
    }
}

#[test]
fn the_same_seed_gives_the_same_audio_every_time() {
    // Load-bearing: the waveform, playback and export are separate renders.
    // A running generator would give each of them different audio.
    let s = grainy(|g| {
        g.pitch_jitter_semis = 5.0;
        g.position_jitter_ms = 50.0;
        g.size_jitter = 0.5;
        g.seed = 12345;
    });
    let input = sine(440.0, 24000, 0.5);
    assert_eq!(s.process(&input, 1, SR), s.process(&input, 1, SR));
}

#[test]
fn a_different_seed_gives_different_audio() {
    let input = sine(440.0, 24000, 0.5);
    let a = grainy(|g| { g.pitch_jitter_semis = 6.0; g.seed = 1; }).process(&input, 1, SR);
    let b = grainy(|g| { g.pitch_jitter_semis = 6.0; g.seed = 2; }).process(&input, 1, SR);
    assert_ne!(a, b);
}

#[test]
fn pitch_jitter_smears_a_pure_tone_across_frequencies() {
    // A steady sine put through per-grain pitch randomisation should no longer
    // cross zero at a single stable rate.
    let input = sine(1000.0, 48000, 0.5);
    let clean = Stretch { ratio: 1.0, semitones: 0.0, window_ms: 40.0,
                          quality: Quality::Standard, grain: Grain::default() };
    let jittered = grainy(|g| { g.pitch_jitter_semis = 7.0; g.seed = 9; });

    // Spread of zero-crossing rate across successive slices.
    let spread = |buf: &[f32]| -> f32 {
        let n = buf.len() / 8;
        let rates: Vec<f32> = (1..7)
            .map(|k| {
                let seg = &buf[k * n..(k + 1) * n];
                let mut c = 0;
                for i in 1..seg.len() {
                    if seg[i - 1] <= 0.0 && seg[i] > 0.0 { c += 1; }
                }
                c as f32
            })
            .collect();
        let mean = rates.iter().sum::<f32>() / rates.len() as f32;
        (rates.iter().map(|r| (r - mean).powi(2)).sum::<f32>() / rates.len() as f32).sqrt()
    };

    let a = spread(&clean.process(&input, 1, SR));
    let b = spread(&jittered.process(&input, 1, SR));
    assert!(b > a + 1.0, "jitter should destabilise the pitch: {a} vs {b}");
}

#[test]
fn pitch_drift_is_smooth_where_jitter_is_not() {
    // Drift is meant to wander; neighbouring moments should agree. Sampling the
    // drift curve densely, consecutive values must be close.
    let g = Grain { pitch_drift_semis: 12.0, drift_rate_hz: 0.5, seed: 3, ..Grain::default() };
    let mut worst_step = 0f32;
    let mut prev = g.drift_at(0.0);
    for i in 1..2000 {
        let v = g.drift_at(i as f32 * 0.001);
        worst_step = worst_step.max((v - prev).abs());
        prev = v;
    }
    assert!(worst_step < 0.02, "drift jumped by {worst_step} in one millisecond");
}

#[test]
fn drift_actually_moves_over_time() {
    let g = Grain { pitch_drift_semis: 12.0, drift_rate_hz: 2.0, seed: 4, ..Grain::default() };
    let vals: Vec<f32> = (0..40).map(|i| g.drift_at(i as f32 * 0.25)).collect();
    let lo = vals.iter().cloned().fold(f32::MAX, f32::min);
    let hi = vals.iter().cloned().fold(f32::MIN, f32::max);
    assert!(hi - lo > 0.5, "drift barely moved: {lo} to {hi}");
}

#[test]
fn jitter_streams_are_independent_of_each_other() {
    // Changing pitch jitter must not also reshuffle grain sizes, or every
    // control would feel like a randomise button.
    let g = Grain { seed: 7, ..Grain::default() };
    let sizes: Vec<f32> = (0..50).map(|i| g.rand01(i, 3)).collect();
    let pitches: Vec<f32> = (0..50).map(|i| g.rand01(i, 11)).collect();
    assert_ne!(sizes, pitches);
}

#[test]
fn random_values_stay_in_range() {
    let g = Grain { seed: 99, ..Grain::default() };
    for i in 0..5000u64 {
        let r = g.rand01(i, 3);
        assert!((0.0..=1.0).contains(&r), "rand01 out of range: {r}");
        let b = g.rand_bipolar(i, 5);
        assert!((-1.0..=1.0).contains(&b), "bipolar out of range: {b}");
        assert!(g.drift_at(i as f32 * 0.01).abs() <= 1.0);
    }
}

#[test]
fn density_changes_how_many_grains_are_laid_down() {
    // Sparse grains over silence-adjacent material leave a different envelope
    // from dense ones; the two renders must not be identical.
    let input = sine(440.0, 24000, 0.5);
    let sparse = grainy(|g| g.density_hz = 8.0).process(&input, 1, SR);
    let dense = grainy(|g| g.density_hz = 120.0).process(&input, 1, SR);
    assert_eq!(sparse.len(), dense.len());
    assert_ne!(sparse, dense);
}

#[test]
fn overlap_changes_the_result_without_changing_the_length() {
    let input = sine(440.0, 24000, 0.5);
    let a = grainy(|g| g.overlap = 1.5).process(&input, 1, SR);
    let b = grainy(|g| g.overlap = 6.0).process(&input, 1, SR);
    assert_eq!(a.len(), b.len());
    assert_ne!(a, b);
}

#[test]
fn granular_output_stays_finite_and_bounded() {
    let input = sine(300.0, 24000, 0.9);
    let s = grainy(|g| {
        g.pitch_jitter_semis = 24.0;
        g.pitch_drift_semis = 24.0;
        g.position_jitter_ms = 500.0;
        g.size_jitter = 1.0;
        g.density_hz = 200.0;
        g.overlap = 8.0;
    });
    let out = s.process(&input, 1, SR);
    assert!(out.iter().all(|v| v.is_finite()), "granular produced NaN");
    assert!(out.iter().all(|v| v.abs() <= 4.0), "granular ran away");
}

#[test]
fn granular_keeps_stereo_channels_together() {
    let mono = sine(440.0, 24000, 0.4);
    let mut input = Vec::new();
    for v in &mono { input.push(*v); input.push(*v * 0.5); }
    let out = grainy(|g| { g.pitch_jitter_semis = 4.0; g.position_jitter_ms = 25.0; })
        .process(&input, 2, SR);
    let frames = out.len() / 2;
    let mut worst = 0f32;
    for f in frames / 4..frames * 3 / 4 {
        worst = worst.max((out[f * 2 + 1] - out[f * 2] * 0.5).abs());
    }
    assert!(worst < 0.05, "channels drifted apart by {worst}");
}

#[test]
fn granular_silence_stays_silent() {
    let out = grainy(|g| { g.pitch_jitter_semis = 12.0; g.position_jitter_ms = 100.0; })
        .process(&vec![0.0f32; 24000], 1, SR);
    assert!(out.iter().all(|v| *v == 0.0));
}

// ================================================== the grain plan the UI draws

#[test]
fn the_visualiser_plan_matches_what_the_renderer_uses() {
    // Both go through the same enumeration, so the picture cannot show grains
    // the audio does not contain. This asserts the schedule is stable rather
    // than recomputed differently for each caller.
    let g = Grain { pitch_jitter_semis: 5.0, position_jitter_ms: 40.0,
                    size_jitter: 0.4, seed: 21, ..Grain::default() };
    let a = fx::grain::grains(24000, SR, 1.5, 2.0, 40.0, &g);
    let b = fx::grain::grains(24000, SR, 1.5, 2.0, 40.0, &g);
    assert_eq!(a, b);
    assert!(!a.is_empty());
}

#[test]
fn grain_events_stay_inside_the_source() {
    // A grain reading past the end would click; the planner clamps, and the
    // visualiser draws those clamped positions.
    let g = Grain { position_jitter_ms: 5000.0, pitch_jitter_semis: 12.0,
                    seed: 5, ..Grain::default() };
    let in_frames = 24000usize;
    for e in fx::grain::grains(in_frames, SR, 2.0, 0.0, 40.0, &g) {
        assert!(e.src_frame >= 0.0, "negative read at grain {}", e.index);
        let span = e.size as f32 * e.rate;
        assert!(
            e.src_frame + span <= in_frames as f32 + 1.0,
            "grain {} reads past the end", e.index
        );
    }
}

#[test]
fn grains_cover_the_whole_output() {
    let g = Grain::default();
    let events = fx::grain::grains(24000, SR, 2.0, 0.0, 40.0,
        &Grain { density_hz: 40.0, ..g });
    let last = events.last().unwrap();
    assert!(last.out_frame as usize + last.size as usize >= 47000,
            "grains stop short at {}", last.out_frame);
}

#[test]
fn a_denser_setting_yields_more_grains() {
    let sparse = fx::grain::grains(24000, SR, 1.0, 0.0, 40.0,
        &Grain { density_hz: 10.0, ..Grain::default() });
    let dense = fx::grain::grains(24000, SR, 1.0, 0.0, 40.0,
        &Grain { density_hz: 100.0, ..Grain::default() });
    assert!(dense.len() > sparse.len() * 5, "{} vs {}", dense.len(), sparse.len());
}

#[test]
fn reported_pitch_includes_base_jitter_and_drift() {
    let g = Grain { pitch_jitter_semis: 6.0, pitch_drift_semis: 3.0, seed: 8, ..Grain::default() };
    let events = fx::grain::grains(48000, SR, 1.0, 7.0, 40.0, &g);
    // Base is +7; jitter and drift can add up to ±9 around it.
    assert!(events.iter().any(|e| (e.pitch_semis - 7.0).abs() > 0.5),
            "no variation reported");
    for e in &events {
        assert!((e.pitch_semis - 7.0).abs() <= 9.5, "pitch out of range: {}", e.pitch_semis);
    }
}

// ---------------------------------------------------------- real-time stream
//
// GrainStream is the path a native audio callback will drive. Everything here
// guards the one property that makes that safe: driving it in real time must
// not change the sound.

/// Bundle the loose arguments the offline call takes.
fn sp(in_frames: usize, ratio: f32, semitones: f32, window_ms: f32, g: fx::Grain)
    -> fx::StreamParams {
    fx::StreamParams {
        in_frames,
        sample_rate: SR,
        ratio,
        semitones,
        window_ms,
        grain: g,
    }
}

/// The headline guarantee. If this ever fails, playing a sound live and
/// exporting it produce different audio, and the swarm stops matching what you
/// hear.
#[test]
fn streaming_with_steady_controls_is_identical_to_the_offline_render() {
    let mut g = fx::Grain::default();
    g.size_jitter = 0.4;
    g.position_jitter_ms = 25.0;
    g.pitch_jitter_semis = 3.0;
    g.pitch_drift_semis = 2.0;
    g.seed = 4242;

    let p = sp(48_000, 1.7, -2.5, 45.0, g);
    let offline = fx::grain::grains(48_000, SR, 1.7, -2.5, 45.0, &g);

    let end = p.plan().out_frames as u64;
    let mut stream = fx::GrainStream::new();
    let mut live = Vec::new();
    while stream.out_frame() < end {
        live.push(stream.next(&p));
    }

    assert_eq!(live.len(), offline.len(), "grain count differs");
    for (i, (a, b)) in live.iter().zip(offline.iter()).enumerate() {
        assert_eq!(a, b, "grain {i} differs between live and offline");
    }
}

/// Seeking must land you on the grains you would have reached by playing there.
/// Without this, scrubbing over a sound would change it.
#[test]
fn seeking_gives_the_same_grains_as_playing_to_that_point() {
    let mut g = fx::Grain::default();
    g.size_jitter = 0.3;
    g.pitch_jitter_semis = 5.0;
    g.seed = 7;

    let p = sp(48_000, 1.0, 0.0, 30.0, g);
    let offline = fx::grain::grains(48_000, SR, 1.0, 0.0, 30.0, &g);

    // Somewhere well into the file, deliberately not on a grain boundary.
    let target = offline[40].out_frame + 13;
    let mut stream = fx::GrainStream::new();
    stream.seek(target, &p);

    // Seek snaps back to the grain covering that moment, which is grain 40.
    assert_eq!(stream.index(), 40);
    for k in 0..8 {
        assert_eq!(stream.next(&p), offline[40 + k], "grain {} after seek", 40 + k);
    }
}

/// The point of the whole exercise: a control moved between two grains changes
/// the next one, and nothing before it.
#[test]
fn a_control_changed_mid_stream_takes_effect_on_the_very_next_grain() {
    let g = fx::Grain::default();
    let slow = sp(96_000, 1.0, 0.0, 40.0, g);

    let mut dense = g;
    dense.density_hz = 200.0;
    let fast = sp(96_000, 1.0, 0.0, 40.0, dense);

    let mut stream = fx::GrainStream::new();
    let a = stream.next(&slow);
    let b = stream.next(&slow);
    let slow_hop = b.out_frame - a.out_frame;

    // Same stream, new settings, no reset.
    let c = stream.next(&fast);
    let d = stream.next(&fast);
    let fast_hop = d.out_frame - c.out_frame;

    assert_eq!(slow_hop, slow.plan().hop as u64);
    assert_eq!(fast_hop, fast.plan().hop as u64);
    assert!(fast_hop < slow_hop, "raising density must tighten the spacing");
    // The index keeps counting, so the randomness does not restart and the
    // sound does not jump when a slider moves.
    assert_eq!(c.index, 2);
}

/// A stream must never stall, whatever the controls say. In an audio callback a
/// hop of zero would be an infinite loop with the speakers connected.
#[test]
fn the_stream_always_advances_however_extreme_the_settings() {
    for (density, overlap, window) in
        [(2000.0, 8.0, 5.0), (0.0, 8.0, 5.0), (0.5, 1.0, 500.0), (-10.0, 0.0, 0.0)]
    {
        let mut g = fx::Grain::default();
        g.density_hz = density;
        g.overlap = overlap;
        let p = sp(48_000, 0.1, 24.0, window, g);

        let mut stream = fx::GrainStream::new();
        let mut last = stream.out_frame();
        for _ in 0..64 {
            stream.next(&p);
            assert!(
                stream.out_frame() > last,
                "stalled at density {density}, overlap {overlap}, window {window}"
            );
            last = stream.out_frame();
        }
    }
}

// ------------------------------------------------------- extreme stretching
//
// The granular path exists so a sound can be pulled far past what WSOLA can do.
// These guard the far ends, where clamps and overflow live.

#[test]
fn a_hundred_times_longer_is_actually_a_hundred_times_longer() {
    let g = fx::Grain::default();
    let p = sp(4_800, 100.0, 0.0, 500.0, g);
    let plan = p.plan();
    assert_eq!(plan.out_frames, 480_000, "a 0.1 s sound must become 10 s");

    // And the schedule really covers it rather than stopping early.
    let mut stream = fx::GrainStream::new();
    let mut last = 0;
    let mut n = 0;
    while stream.out_frame() < plan.out_frames as u64 {
        let e = stream.next(&p);
        assert!(e.out_frame >= last);
        assert!(e.src_frame.is_finite() && e.src_frame >= 0.0);
        last = e.out_frame;
        n += 1;
        assert!(n < 500_000, "schedule is not advancing");
    }
    // Count is not the property that matters — half-second grains at double
    // overlap give exactly forty of them across ten seconds, and that is
    // correct. What matters is that they cover the whole output.
    assert_eq!(n, plan.out_frames / plan.hop, "grain count does not match the hop");
    assert!(
        last + plan.base_size as u64 >= plan.out_frames as u64 - plan.hop as u64,
        "the schedule stops short of the end"
    );
}

#[test]
fn extreme_settings_still_produce_usable_audio() {
    // A hundredfold stretch with long, heavily jittered grains — the setting
    // this whole feature exists for.
    let mut g = fx::Grain::default();
    g.overlap = 6.0;
    g.size_jitter = 0.5;
    g.position_jitter_ms = 300.0;
    g.pitch_jitter_semis = 2.0;

    let input = sine(220.0, (SR / 4) as usize, 0.6); // 0.25 s
    let out = fx::grain::granular(&input, 1, SR, 40.0, 0.0, 1500.0, &g);

    assert_eq!(out.len(), (input.len() as f32 * 40.0).round() as usize);
    assert!(out.iter().all(|s| s.is_finite()), "extreme stretch produced non-finite audio");
    let peak = out.iter().fold(0f32, |m, s| m.max(s.abs()));
    assert!(peak > 0.05, "extreme stretch went silent, peak {peak}");
    assert!(peak < 4.0, "extreme stretch ran away, peak {peak}");
}

#[test]
fn four_octaves_of_shift_land_where_they_should() {
    for (semis, factor) in [(48.0f32, 16.0f32), (-48.0, 1.0 / 16.0)] {
        let p = sp(48_000, 1.0, semis, 40.0, fx::Grain::default());
        let mut stream = fx::GrainStream::new();
        let e = stream.next(&p);
        assert!(
            (e.rate - factor).abs() < factor * 0.02,
            "{semis} st should read at {factor}x, got {}",
            e.rate
        );
    }
}

#[test]
fn the_shortest_stretch_does_not_collapse() {
    let p = sp(480_000, 0.01, 0.0, 40.0, fx::Grain::default());
    assert_eq!(p.plan().out_frames, 4_800);
    let mut stream = fx::GrainStream::new();
    for _ in 0..32 {
        let e = stream.next(&p);
        assert!(e.size > 0 && e.rate.is_finite());
    }
}
