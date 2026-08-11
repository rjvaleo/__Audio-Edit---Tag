//! Time stretch and pitch shift.
//!
//! The two properties that matter are opposites of each other: stretching must
//! change the length and *not* the pitch; shifting must change the pitch and
//! *not* the length. Both are measured on real signals.

use fx::stretch::{Algorithm, Quality, Stretch};

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
              grain: fx::Grain::default(), ..Default::default() }
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
                          grain: fx::Grain::default(), ..Default::default() };
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
                          grain: fx::Grain::default(), ..Default::default() };
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
    // Granular is a choice now, not something a grain control switches on
    // behind your back, so the tests have to ask for it like anyone else.
    Stretch { ratio: 1.0, semitones: 0.0, window_ms: 40.0, quality: Quality::Standard,
              algorithm: Algorithm::Granular, grain: g, ..Default::default() }
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
                          quality: Quality::Standard, grain: Grain::default(), ..Default::default() };
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
        algorithm: fx::stretch::Algorithm::Granular,
        wsola: fx::stretch::WsolaParams::default(),

        vocoder: fx::stretch::VocoderParams::default(),


        pvsola: fx::pvsola::PvsolaParams::default(),
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

// ---------------------------------------------------------- transients

fn hits_at(rate: u32, secs: f32, at: &[f32]) -> Vec<f32> {
    let n = (secs * rate as f32) as usize;
    let mut v: Vec<f32> = (0..n)
        .map(|i| (std::f32::consts::TAU * 180.0 * i as f32 / rate as f32).sin() * 0.12)
        .collect();
    let mut seed = 99u32;
    for t in at {
        let start = (*t * rate as f32) as usize;
        for i in 0..(rate as usize / 120) {
            if start + i >= n { break; }
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let noise = ((seed >> 16) as f32 / 32768.0) - 1.0;
            let env = (1.0 - i as f32 / (rate as f32 / 120.0)).max(0.0).powi(2);
            v[start + i] += noise * env * 0.95;
        }
    }
    v
}

#[test]
fn preserving_transients_does_not_change_the_length() {
    let rate = 44_100;
    let src = hits_at(rate, 2.0, &[0.4, 0.9, 1.4]);
    for ratio in [0.5f32, 2.0, 4.0] {
        let mut s = Stretch { ratio, ..Default::default() };
        s.wsola.preserve_transients = true;
        let out = s.process(&src, 1, rate);
        assert_eq!(out.len(), (src.len() as f32 * ratio).round() as usize, "at {ratio}x");
    }
}

/// The point of the feature: a stretched drum hit should stay one hit rather
/// than being laid down twice. Measured as the count of sharp energy rises in
/// the output — stuttering shows up as extra ones.
#[test]
fn preserving_transients_keeps_hits_from_doubling() {
    let rate = 44_100;
    let places = [0.4f32, 0.9, 1.4];
    let src = hits_at(rate, 2.0, &places);

    let plain = Stretch { ratio: 3.0, ..Default::default() }.process(&src, 1, rate);
    let mut kept = Stretch { ratio: 3.0, ..Default::default() };
    kept.wsola.preserve_transients = true;
    let kept = kept.process(&src, 1, rate);

    let count = |v: &[f32]| fx::transient::onsets(v, 1, rate, 0.5, 1.0).len();
    let (a, b) = (count(&plain), count(&kept));
    // Three went in; preservation should not invent more than plain WSOLA does.
    assert!(b <= a, "preserved produced {b} onsets against plain WSOLA's {a}");
    assert!(b >= places.len(), "lost hits entirely: {b}");
}

#[test]
fn preservation_off_is_exactly_what_it_always_was() {
    let rate = 44_100;
    let src = hits_at(rate, 1.0, &[0.3, 0.7]);
    let a = Stretch { ratio: 2.5, ..Default::default() }.process(&src, 1, rate);
    let mut off = Stretch { ratio: 2.5, ..Default::default() };
    off.wsola.preserve_transients = false;
    let b = off.process(&src, 1, rate);
    assert_eq!(a, b);
}

#[test]
fn material_with_no_transients_is_unaffected_either_way() {
    let rate = 44_100;
    let n = rate as usize;
    let tone: Vec<f32> = (0..n)
        .map(|i| (std::f32::consts::TAU * 440.0 * i as f32 / rate as f32).sin())
        .collect();
    let plain = Stretch { ratio: 2.0, ..Default::default() }.process(&tone, 1, rate);
    let mut kept = Stretch { ratio: 2.0, ..Default::default() };
    kept.wsola.preserve_transients = true;
    let kept = kept.process(&tone, 1, rate);
    assert_eq!(plain.len(), kept.len());
}

// ===================================================== the deliberate controls
//
// Every knob below used to be a constant, and every one of them was a constant
// because that value is where the algorithm works. So there are two things to
// check and they pull in opposite directions: leaving them alone must reproduce
// the old sound *exactly*, and moving them must actually reach the audio rather
// than being read and dropped. A control that changes nothing is worse than no
// control, because you cannot hear that it is broken.

/// A chord over noise: partials for the vocoder to hold together and a floor
/// for it to smear, which is enough for any of these to show up.
fn busy(rate: u32, secs: f32) -> Vec<f32> {
    let n = (secs * rate as f32) as usize;
    let mut seed = 99u32;
    (0..n)
        .map(|i| {
            let t = i as f32 / rate as f32;
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let noise = ((seed >> 16) as f32 / 32768.0) - 1.0;
            let tone = (std::f32::consts::TAU * 220.0 * t).sin()
                + (std::f32::consts::TAU * 277.0 * t).sin() * 0.7
                + (std::f32::consts::TAU * 330.0 * t).sin() * 0.5;
            tone * 0.25 + noise * 0.06
        })
        .collect()
}

fn differs(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    if n == 0 {
        return f32::INFINITY;
    }
    a.iter().zip(b.iter()).take(n).map(|(x, y)| (x - y).abs()).sum::<f32>() / n as f32
}

#[test]
fn every_wsola_control_left_alone_is_the_sound_it_always_made() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    let base = Stretch { ratio: 2.0, ..Default::default() }.process(&src, 1, rate);

    // Spelled out rather than `..Default::default()`, because the point is that
    // these particular values are the ones the algorithm used to hard-code.
    let mut same = Stretch { ratio: 2.0, ..Default::default() };
    same.grain.overlap = 2.0;
    same.wsola.search_ms = 10.0;
    same.grain.overlap = 2.0;
    same.wsola.splice = fx::stretch::Splice::Similar;
    same.wsola.stride = 4;
    same.wsola.shape = fx::stretch::WinShape::Hann;
    assert_eq!(base, same.process(&src, 1, rate));
}

#[test]
fn every_vocoder_control_left_alone_is_the_sound_it_always_made() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    let mut base = Stretch { ratio: 2.0, algorithm: Algorithm::Vocoder, ..Default::default() };
    let plain = base.process(&src, 1, rate);

    base.grain.scan = 1.0;
    base.vocoder.freq_trust = 1.0;
    base.vocoder.phase_spread = 1.0;
    base.vocoder.peak_width = 2;
    base.vocoder.lock_width = 1.0;
    base.vocoder.mag_freeze = 0.0;
    base.vocoder.mag_blur = 0.0;
    base.vocoder.mag_gate = 0.0;
    assert_eq!(plain, base.process(&src, 1, rate));
}

#[test]
fn every_grain_control_left_alone_is_the_sound_it_always_made() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    let mut base = Stretch { ratio: 2.0, algorithm: Algorithm::Granular, ..Default::default() };
    base.grain.size_jitter = 0.3;
    base.grain.pitch_jitter_semis = 2.0;
    let plain = base.process(&src, 1, rate);

    base.grain.scan = 1.0;
    base.grain.reverse = false;
    base.grain.envelope = 0.5;
    base.grain.size_range = 1.0;
    base.grain.wrap = false;
    base.grain.layer_spread = 1.0;
    base.grain.link_jitter = false;
    base.grain.drift_step = false;
    base.grain.pan_spread = 0.0;
    assert_eq!(plain, base.process(&src, 1, rate));
}

/// Each control, one at a time, against the same source. Every one of them has
/// to reach the audio — and the length must survive, because these are meant to
/// change the character of a stretch, not what the timeline says it is.
#[test]
fn each_wsola_control_reaches_the_audio() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    let base = Stretch { ratio: 2.0, quality: Quality::Best, ..Default::default() };
    let plain = base.process(&src, 1, rate);

    let cases: Vec<(&str, Box<dyn Fn(&mut Stretch)>)> = vec![
        ("search 0 — plain overlap-add", Box::new(|s: &mut Stretch| s.wsola.search_ms = 0.0)),
        ("search 120ms", Box::new(|s: &mut Stretch| s.wsola.search_ms = 120.0)),
        ("overlap 4", Box::new(|s: &mut Stretch| s.grain.overlap = 4.0)),
        ("worst splice", Box::new(|s: &mut Stretch| s.wsola.splice = fx::stretch::Splice::Different)),
        ("loudest splice", Box::new(|s: &mut Stretch| s.wsola.splice = fx::stretch::Splice::Loudest)),
        ("stride 64", Box::new(|s: &mut Stretch| s.wsola.stride = 64)),
        ("rect window", Box::new(|s: &mut Stretch| s.wsola.shape = fx::stretch::WinShape::Rect)),
        ("triangle window", Box::new(|s: &mut Stretch| s.wsola.shape = fx::stretch::WinShape::Triangle)),
    ];

    for (name, set) in cases {
        let mut s = base;
        set(&mut s);
        let out = s.process(&src, 1, rate);
        assert_eq!(out.len(), plain.len(), "{name} changed the length");
        assert!(differs(&plain, &out) > 1e-4, "{name} did nothing");
    }
}

#[test]
fn each_vocoder_control_reaches_the_audio() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    let base = Stretch { ratio: 2.0, algorithm: Algorithm::Vocoder, ..Default::default() };
    let plain = base.process(&src, 1, rate);

    let cases: Vec<(&str, Box<dyn Fn(&mut Stretch)>)> = vec![
        ("no frequency trust", Box::new(|s: &mut Stretch| s.vocoder.freq_trust = 0.0)),
        ("frequency trust 3", Box::new(|s: &mut Stretch| s.vocoder.freq_trust = 3.0)),
        ("no phase spread", Box::new(|s: &mut Stretch| s.vocoder.phase_spread = 0.0)),
        ("peak width 8", Box::new(|s: &mut Stretch| s.vocoder.peak_width = 8)),
        ("lock width 2.5", Box::new(|s: &mut Stretch| s.vocoder.lock_width = 2.5)),
        ("spectral freeze", Box::new(|s: &mut Stretch| s.vocoder.mag_freeze = 1.0)),
        ("magnitude blur", Box::new(|s: &mut Stretch| s.vocoder.mag_blur = 0.6)),
        ("magnitude gate", Box::new(|s: &mut Stretch| s.vocoder.mag_gate = 0.3)),
    ];

    for (name, set) in cases {
        let mut s = base;
        set(&mut s);
        let out = s.process(&src, 1, rate);
        assert_eq!(out.len(), plain.len(), "{name} changed the length");
        assert!(differs(&plain, &out) > 1e-4, "{name} did nothing");
    }
}

#[test]
fn each_grain_control_reaches_the_audio() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    let mut base = Stretch { ratio: 2.0, algorithm: Algorithm::Granular, ..Default::default() };
    // Jitter on, so the controls that steer the *randomness* have randomness to
    // steer. With every jitter at zero, linking their streams is a no-op and the
    // test would be asserting something it cannot see.
    base.grain.size_jitter = 0.4;
    base.grain.position_jitter_ms = 40.0;
    base.grain.pitch_jitter_semis = 3.0;
    base.grain.pitch_drift_semis = 2.0;
    base.grain.layers = 3;
    let plain = base.process(&src, 1, rate);

    let cases: Vec<(&str, Box<dyn Fn(&mut Stretch)>)> = vec![
        ("frozen scan", Box::new(|s: &mut Stretch| s.grain.scan = 0.0)),
        ("reverse scan", Box::new(|s: &mut Stretch| s.grain.scan = -1.0)),
        ("reversed grains", Box::new(|s: &mut Stretch| s.grain.reverse = true)),
        ("percussive envelope", Box::new(|s: &mut Stretch| s.grain.envelope = 0.0)),
        ("swelling envelope", Box::new(|s: &mut Stretch| s.grain.envelope = 1.0)),
        ("wide size range", Box::new(|s: &mut Stretch| s.grain.size_range = 6.0)),
        ("wrapping positions", Box::new(|s: &mut Stretch| s.grain.wrap = true)),
        ("stacked layers", Box::new(|s: &mut Stretch| s.grain.layer_spread = 0.0)),
        ("linked jitter", Box::new(|s: &mut Stretch| s.grain.link_jitter = true)),
        ("stepped drift", Box::new(|s: &mut Stretch| s.grain.drift_step = true)),
    ];

    for (name, set) in cases {
        let mut s = base;
        set(&mut s);
        let out = s.process(&src, 1, rate);
        assert_eq!(out.len(), plain.len(), "{name} changed the length");
        assert!(differs(&plain, &out) > 1e-4, "{name} did nothing");
    }
}

/// Pan is the one grain control that needs two channels to mean anything, and
/// it must not quietly change the level while it moves things about.
#[test]
fn pan_spread_widens_without_costing_level() {
    let rate = 44_100;
    let mono = busy(rate, 1.0);
    let src: Vec<f32> = mono.iter().flat_map(|v| [*v, *v]).collect();

    let mut base = Stretch { ratio: 2.0, algorithm: Algorithm::Granular, ..Default::default() };
    base.grain.size_jitter = 0.3;
    let centred = base.process(&src, 2, rate);

    let mut wide = base;
    wide.grain.pan_spread = 1.0;
    let wide = wide.process(&src, 2, rate);

    let side = |v: &[f32]| -> f32 {
        let n = v.len() / 2;
        (0..n).map(|f| (v[f * 2] - v[f * 2 + 1]).abs()).sum::<f32>() / n.max(1) as f32
    };
    // A mono source panned nowhere has no side content at all.
    assert!(side(&centred) < 1e-6, "centred grains were not centred");
    assert!(side(&wide) > 1e-3, "spread grains produced no width");

    let level = |v: &[f32]| (v.iter().map(|x| x * x).sum::<f32>() / v.len().max(1) as f32).sqrt();
    let (a, b) = (level(&centred), level(&wide));
    assert!(
        (b / a.max(1e-9) - 1.0).abs() < 0.25,
        "spreading changed the level: {a} to {b}"
    );
}

/// The detector floor was added to stop it firing on numerical ripple through a
/// held tone. Removing it deliberately has to bring that back, or the control
/// is not reaching the thing it claims to.
#[test]
fn removing_the_detector_floor_lets_a_steady_tone_trigger() {
    let rate = 44_100;
    let n = 2 * rate as usize;
    let tone: Vec<f32> = (0..n)
        .map(|i| (std::f32::consts::TAU * 440.0 * i as f32 / rate as f32).sin())
        .collect();
    let with = fx::transient::onsets(&tone, 1, rate, 0.5, 1.0).len();
    let without = fx::transient::onsets(&tone, 1, rate, 0.5, 0.0).len();
    assert_eq!(with, 0, "the floor stopped working");
    assert!(without > 5, "removing the floor changed nothing: {without}");
}

/// The vocoder transforms each channel on its own, so nothing is looking after
/// the relationship *between* them — and that relationship is the stereo image.
///
/// Measured directly: the right channel is the left delayed by eight samples,
/// which is a pure inter-channel phase difference and correlates at exactly 1.0
/// at that lag. Independent, the stretch degrades it to 0.988; linked, it comes
/// through at 1.0, because every channel is moved by the same correction and so
/// keeps whatever it was doing relative to the others.
#[test]
fn linking_the_channels_keeps_the_stereo_image_intact() {
    let rate = 44_100;
    let left = busy(rate, 1.0);
    let delay = 8usize;
    let src: Vec<f32> = (0..left.len())
        .flat_map(|i| [left[i], if i >= delay { left[i - delay] } else { 0.0 }])
        .collect();

    // The best correlation between the two channels, and the lag it happens at.
    let agreement = |v: &[f32]| -> (isize, f32) {
        let m = v.len() / 2;
        let (a, b) = (m / 4, m * 3 / 4);
        let mut best = (0isize, -2.0f32);
        for lag in -64isize..=64 {
            let (mut dot, mut ea, mut eb) = (0.0f32, 0.0f32, 0.0f32);
            for i in a..b {
                let j = i as isize + lag;
                if j < 0 || j as usize >= m {
                    continue;
                }
                let (x, y) = (v[i * 2], v[j as usize * 2 + 1]);
                dot += x * y;
                ea += x * x;
                eb += y * y;
            }
            let s = if ea > 1e-9 && eb > 1e-9 { dot / (ea.sqrt() * eb.sqrt()) } else { 0.0 };
            if s > best.1 {
                best = (lag, s);
            }
        }
        best
    };

    let (src_lag, src_score) = agreement(&src);
    assert_eq!(src_lag, delay as isize, "the source was not a clean delay");
    assert!(src_score > 0.9999, "the source was not a clean delay: {src_score}");

    let base = Stretch { ratio: 2.0, algorithm: Algorithm::Vocoder, ..Default::default() };
    let mut linked = base;
    linked.vocoder.stereo_link = true;

    let (free_lag, free_score) = agreement(&base.process(&src, 2, rate));
    let (held_lag, held_score) = agreement(&linked.process(&src, 2, rate));

    assert_eq!(free_lag, delay as isize);
    assert_eq!(held_lag, delay as isize);
    assert!(held_score > 0.999, "linked lost the image: {held_score}");
    assert!(free_score < 0.995, "independent channels did not drift: {free_score}");
    assert!(held_score > free_score, "linking made it worse: {held_score} vs {free_score}");
}

/// Linking must not flatten a genuinely wide source into mono. It shares the
/// stretch's correction, not the phase itself.
#[test]
fn linking_does_not_collapse_a_wide_source() {
    let rate = 44_100;
    let left = busy(rate, 1.0);
    let right: Vec<f32> = left.iter().rev().copied().collect();
    let src: Vec<f32> = left.iter().zip(right.iter()).flat_map(|(l, r)| [*l, *r]).collect();

    let mut linked = Stretch { ratio: 2.0, algorithm: Algorithm::Vocoder, ..Default::default() };
    linked.vocoder.stereo_link = true;
    let out = linked.process(&src, 2, rate);

    let n = out.len() / 2;
    let side = (0..n).map(|f| (out[f * 2] - out[f * 2 + 1]).abs()).sum::<f32>() / n.max(1) as f32;
    let level = (out.iter().map(|x| x * x).sum::<f32>() / out.len().max(1) as f32).sqrt();
    assert!(side > level * 0.5, "two unrelated channels were flattened together: {side} vs {level}");
}

#[test]
fn stereo_link_left_alone_is_the_sound_it_always_made() {
    let rate = 44_100;
    let mono = busy(rate, 0.5);
    let src: Vec<f32> = mono.iter().flat_map(|v| [*v, *v * 0.6]).collect();
    let base = Stretch { ratio: 1.5, algorithm: Algorithm::Vocoder, ..Default::default() };
    let mut same = base;
    same.vocoder.stereo_link = false;
    assert_eq!(base.process(&src, 2, rate), same.process(&src, 2, rate));
}

// ============================ the grain controls, on all three engines
//
// Density, overlap, the jitters and the drift began as the cloud's own, but
// every one of these engines lays something down repeatedly — so every one has
// a rate, a length, a place it reads from and a speed it reads at. The controls
// now drive all three. Which means two things have to hold for each engine:
// left alone they change nothing, and moved they reach the audio.

/// Every grain control at its default, spelled out rather than spread, because
/// the claim is that *these particular values* reproduce the old sound.
fn inert_grain() -> fx::Grain {
    fx::Grain {
        density_hz: 0.0,
        overlap: 2.0,
        size_jitter: 0.0,
        position_jitter_ms: 0.0,
        pitch_jitter_semis: 0.0,
        pitch_drift_semis: 0.0,
        drift_rate_hz: 0.5,
        layers: 1,
        seed: 1,
        ..fx::Grain::default()
    }
}

#[test]
fn the_grain_controls_are_inert_on_every_engine() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    for alg in [Algorithm::Wsola, Algorithm::Vocoder] {
        let base = Stretch { ratio: 2.0, algorithm: alg, ..Default::default() };
        let plain = base.process(&src, 1, rate);
        let same = Stretch { grain: inert_grain(), ..base };
        assert_eq!(plain, same.process(&src, 1, rate), "{alg:?} moved without being asked");
    }
}

/// One case per control per engine. A knob that is read and dropped is worse
/// than no knob, because you cannot hear that it is broken.
#[test]
fn each_grain_control_reaches_wsola_and_the_vocoder() {
    let rate = 44_100;
    let src = busy(rate, 1.0);

    let cases: Vec<(&str, Box<dyn Fn(&mut fx::Grain)>)> = vec![
        ("density", Box::new(|g: &mut fx::Grain| g.density_hz = 120.0)),
        ("overlap", Box::new(|g: &mut fx::Grain| g.overlap = 5.0)),
        ("layers", Box::new(|g: &mut fx::Grain| g.layers = 4)),
        ("size jitter", Box::new(|g: &mut fx::Grain| g.size_jitter = 0.5)),
        ("position jitter", Box::new(|g: &mut fx::Grain| g.position_jitter_ms = 60.0)),
        ("pitch jitter", Box::new(|g: &mut fx::Grain| g.pitch_jitter_semis = 5.0)),
        ("pitch drift", Box::new(|g: &mut fx::Grain| g.pitch_drift_semis = 4.0)),
    ];

    for alg in [Algorithm::Wsola, Algorithm::Vocoder] {
        let base = Stretch { ratio: 2.0, algorithm: alg, ..Default::default() };
        let plain = base.process(&src, 1, rate);
        for (name, set) in &cases {
            let mut g = fx::Grain::default();
            set(&mut g);
            let out = Stretch { grain: g, ..base }.process(&src, 1, rate);
            assert_eq!(out.len(), plain.len(), "{alg:?}/{name} changed the length");
            assert!(differs(&plain, &out) > 1e-4, "{alg:?}/{name} did nothing");
            assert!(out.iter().all(|v| v.is_finite()), "{alg:?}/{name} produced NaN");
        }
    }
}

/// Drift rate only means anything once there is drift to shape, so it needs its
/// own case rather than a line in the sweep above.
#[test]
fn drift_rate_shapes_the_drift_on_every_engine() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    for alg in [Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Granular] {
        let mut slow = Stretch { ratio: 2.0, algorithm: alg, ..Default::default() };
        slow.grain.pitch_drift_semis = 5.0;
        slow.grain.drift_rate_hz = 0.2;
        let mut fast = slow;
        fast.grain.drift_rate_hz = 8.0;
        let a = slow.process(&src, 1, rate);
        let b = fast.process(&src, 1, rate);
        assert!(differs(&a, &b) > 1e-4, "{alg:?}: drift rate did nothing");
    }
}

/// Layers must not quietly change the level. Whether they sum coherently or
/// not depends on how much jitter is on, so the scaling is measured rather
/// than assumed — this is the check that it works out either way.
#[test]
fn layers_hold_the_level_on_every_engine() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    for alg in [Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Granular] {
        for jitter in [0.0f32, 0.5] {
            // Granular with no jitter at all is several copies of the same
            // audio, which sum coherently — and `layer_gain` lifts them by √N
            // on top of that, deliberately. See `grain::layer_tests`. Every
            // other combination has to hold its level.
            if alg == Algorithm::Granular && jitter == 0.0 {
                continue;
            }
            let mut one = Stretch { ratio: 2.0, algorithm: alg, ..Default::default() };
            one.grain.size_jitter = jitter;
            one.grain.position_jitter_ms = jitter * 80.0;
            let mut many = one;
            many.grain.layers = 6;

            let a = rms(&one.process(&src, 1, rate));
            let b = rms(&many.process(&src, 1, rate));
            assert!(
                (b / a.max(1e-9) - 1.0).abs() < 0.3,
                "{alg:?} at jitter {jitter}: six layers moved the level from {a} to {b}"
            );
        }
    }
}

/// The extended grain controls, on all three engines.
///
/// Four of these already reached WSOLA and the vocoder — size range, layer
/// spread, linked jitter and stepped drift all run through shared helpers — and
/// the other five did not, so half the panel worked and half quietly did
/// nothing. They all work now, each in the engine's own terms: a window is a
/// splice for WSOLA and an analysis frame for the vocoder, but both have a read
/// pointer, a direction, an envelope and a place in the stereo field.
#[test]
fn every_extended_grain_control_reaches_every_engine() {
    let rate = 44_100;
    let mono = busy(rate, 1.0);
    let src: Vec<f32> = mono.iter().flat_map(|v| [*v, *v * 0.8]).collect();

    let cases: Vec<(&str, Box<dyn Fn(&mut fx::Grain)>)> = vec![
        ("scan frozen", Box::new(|g: &mut fx::Grain| g.scan = 0.0)),
        ("scan reversed", Box::new(|g: &mut fx::Grain| g.scan = -1.0)),
        ("reverse", Box::new(|g: &mut fx::Grain| g.reverse = true)),
        ("envelope percussive", Box::new(|g: &mut fx::Grain| g.envelope = 0.05)),
        ("envelope swelling", Box::new(|g: &mut fx::Grain| g.envelope = 0.95)),
        ("size range", Box::new(|g: &mut fx::Grain| g.size_range = 6.0)),
        ("wrap", Box::new(|g: &mut fx::Grain| { g.position_jitter_ms = 300.0; g.wrap = true })),
        ("layer spread", Box::new(|g: &mut fx::Grain| { g.layers = 4; g.layer_spread = 0.0 })),
        ("link jitter", Box::new(|g: &mut fx::Grain| g.link_jitter = true)),
        ("drift step", Box::new(|g: &mut fx::Grain| g.drift_step = true)),
        ("pan spread", Box::new(|g: &mut fx::Grain| g.pan_spread = 1.0)),
    ];

    for alg in [Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Granular] {
        // A baseline with the jitters already on, so the controls that steer
        // randomness have randomness to steer.
        let mut base = Stretch { ratio: 2.0, algorithm: alg, ..Default::default() };
        base.grain.size_jitter = 0.4;
        base.grain.position_jitter_ms = 40.0;
        base.grain.pitch_jitter_semis = 3.0;
        base.grain.pitch_drift_semis = 4.0;
        let plain = base.process(&src, 2, rate);

        for (name, set) in &cases {
            let mut g = base.grain;
            set(&mut g);
            let out = Stretch { grain: g, ..base }.process(&src, 2, rate);
            assert_eq!(out.len(), plain.len(), "{alg:?}/{name} changed the length");
            assert!(differs(&plain, &out) > 1e-4, "{alg:?}/{name} did nothing");
            assert!(out.iter().all(|v| v.is_finite()), "{alg:?}/{name} produced NaN");
            assert!(out.iter().all(|v| v.abs() < 4.0), "{alg:?}/{name} ran away");
        }
    }
}

/// And left alone they still reproduce the sound the engines always made.
#[test]
fn the_extended_grain_controls_are_inert_on_every_engine() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    for alg in [Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Granular] {
        let base = Stretch { ratio: 2.0, algorithm: alg, ..Default::default() };
        let plain = base.process(&src, 1, rate);

        let mut same = base;
        same.grain.scan = 1.0;
        same.grain.reverse = false;
        same.grain.envelope = 0.5;
        same.grain.size_range = 1.0;
        same.grain.wrap = false;
        same.grain.layer_spread = 1.0;
        same.grain.link_jitter = false;
        same.grain.drift_step = false;
        same.grain.pan_spread = 0.0;
        assert_eq!(plain, same.process(&src, 1, rate), "{alg:?} moved without being asked");
    }
}

/// Pan needs two channels to mean anything, and it must place things without
/// quietly changing the level — on every engine, not just the cloud.
#[test]
fn pan_spread_widens_every_engine_without_costing_level() {
    let rate = 44_100;
    let mono = busy(rate, 1.0);
    let src: Vec<f32> = mono.iter().flat_map(|v| [*v, *v]).collect();
    let side = |v: &[f32]| -> f32 {
        let n = v.len() / 2;
        (0..n).map(|f| (v[f * 2] - v[f * 2 + 1]).abs()).sum::<f32>() / n.max(1) as f32
    };
    let level = |v: &[f32]| (v.iter().map(|x| x * x).sum::<f32>() / v.len().max(1) as f32).sqrt();

    for alg in [Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Granular] {
        let mut base = Stretch { ratio: 2.0, algorithm: alg, ..Default::default() };
        base.grain.size_jitter = 0.3;
        let centred = base.process(&src, 2, rate);
        let mut wide = base;
        wide.grain.pan_spread = 1.0;
        let wide = wide.process(&src, 2, rate);

        assert!(side(&centred) < 1e-4, "{alg:?}: a mono source was not centred to begin with");
        assert!(side(&wide) > 1e-3, "{alg:?}: spreading produced no width");
        let (a, b) = (level(&centred), level(&wide));
        assert!(
            (b / a.max(1e-9) - 1.0).abs() < 0.3,
            "{alg:?}: spreading moved the level from {a} to {b}"
        );
    }
}

/// The reconstruction must not amplify its own edges.
///
/// The vocoder divides by the summed *square* of the window, which tails toward
/// nothing where only one frame is present. With the guard at 1e-6 that
/// division was turning a correctly quiet edge into a peak twenty times the
/// source — which is what it had been doing since the overlap control moved.
#[test]
fn no_engine_amplifies_its_own_edges() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    let peak = |v: &[f32]| v.iter().fold(0.0f32, |m, x| m.max(x.abs()));
    let want = peak(&src);
    for alg in [Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Granular] {
        for overlap in [1.5f32, 2.0, 4.0, 8.0] {
            let mut s = Stretch { ratio: 2.0, algorithm: alg, ..Default::default() };
            s.grain.overlap = overlap;
            let out = s.process(&src, 1, rate);
            let got = peak(&out);
            assert!(
                got < want * 2.0,
                "{alg:?} at overlap {overlap}: peak {got:.3} against a source of {want:.3}"
            );
        }
    }
}

// ------------------------------------------------------- the two new engines
//
// PVSOLA and Hybrid drive the other three rather than sitting beside them, so
// what has to be checked is different: not that each has its own DSP — the
// engines they call already have their own tests — but that the routing is
// intact. Every parameter has to reach the audio, every one has to be inert
// where it should be, and the promised length has to hold, because the
// timeline is laid out from the prediction before anything is rendered.

const NEW_ENGINES: [Algorithm; 2] = [Algorithm::Pvsola, Algorithm::Hybrid];

#[test]
fn the_new_engines_honour_the_promised_length() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    for alg in NEW_ENGINES {
        for ratio in [0.25f32, 0.5, 1.5, 4.0, 12.0] {
            let s = Stretch { ratio, algorithm: alg, ..Default::default() };
            let want = s.output_frames(src.len() as u64) as usize;
            assert_eq!(
                s.process(&src, 1, rate).len(),
                want,
                "{alg:?} at {ratio}x did not produce what it promised"
            );
        }
    }
}

#[test]
fn the_new_engines_keep_the_pitch_they_were_given() {
    let rate = 44_100;
    // A steady tone, because pitch is the thing being measured.
    let src: Vec<f32> = (0..rate as usize)
        .map(|i| 0.5 * (std::f32::consts::TAU * 440.0 * i as f32 / rate as f32).sin())
        .collect();
    for alg in NEW_ENGINES {
        let s = Stretch { ratio: 3.0, semitones: 12.0, algorithm: alg, ..Default::default() };
        let out = s.process(&src, 1, rate);
        assert_eq!(out.len(), src.len() * 3, "{alg:?} changed length while shifting pitch");
        // Coarse, but enough to catch an octave going the wrong way or the
        // resampling being skipped entirely.
        let f = dominant(&out[out.len() / 3..out.len() / 3 + 16384], rate);
        assert!(
            (f - 880.0).abs() < 40.0,
            "{alg:?} shifted to {f:.0} Hz rather than 880"
        );
    }
}

#[test]
fn the_new_engines_survive_a_round_trip_through_their_names() {
    for a in NEW_ENGINES {
        assert_eq!(Algorithm::from_str(a.as_str()), Some(a));
    }
}

#[test]
fn the_new_engines_do_not_amplify_their_own_edges() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    let peak = |v: &[f32]| v.iter().fold(0.0f32, |m, x| m.max(x.abs()));
    let want = peak(&src);
    for alg in NEW_ENGINES {
        for ratio in [2.0f32, 8.0] {
            let s = Stretch { ratio, algorithm: alg, ..Default::default() };
            let got = peak(&s.process(&src, 1, rate));
            assert!(
                got < want * 2.0,
                "{alg:?} at {ratio}x: peak {got:.3} against a source of {want:.3}"
            );
        }
    }
}

/// Every control on the two new panels, one at a time. A knob that is read and
/// dropped is worse than no knob, because you cannot hear that it is broken —
/// and both of these engines have a long chain between the control and the
/// audio for a value to go missing in.
#[test]
fn each_new_engine_control_reaches_the_audio() {
    let rate = 44_100;
    let src = busy(rate, 1.0);

    let pv: Vec<(&str, Box<dyn Fn(&mut Stretch)>)> = vec![
        ("anchorFrames", Box::new(|s: &mut Stretch| s.pvsola.anchor_frames = 24)),
        ("searchMs", Box::new(|s: &mut Stretch| s.pvsola.search_ms = 0.0)),
        ("blend", Box::new(|s: &mut Stretch| s.pvsola.blend = 0.0)),
    ];
    let hy: Vec<(&str, Box<dyn Fn(&mut Stretch)>)> = vec![
        ("fftSize", Box::new(|s: &mut Stretch| s.hybrid.fft_size = 1024)),
        ("timeSpan", Box::new(|s: &mut Stretch| s.hybrid.time_span = 41)),
        ("freqSpan", Box::new(|s: &mut Stretch| s.hybrid.freq_span = 41)),
        ("margin", Box::new(|s: &mut Stretch| s.hybrid.margin = 1.0)),
        ("morphNoise", Box::new(|s: &mut Stretch| s.hybrid.morph_noise = false)),
        ("harmonicLevel", Box::new(|s: &mut Stretch| s.hybrid.harmonic_level = 0.4)),
        ("percussiveLevel", Box::new(|s: &mut Stretch| s.hybrid.percussive_level = 0.4)),
        ("residualLevel", Box::new(|s: &mut Stretch| s.hybrid.residual_level = 0.0)),
    ];

    for (alg, cases) in [(Algorithm::Pvsola, pv), (Algorithm::Hybrid, hy)] {
        let base = Stretch { ratio: 3.0, algorithm: alg, ..Default::default() };
        let plain = base.process(&src, 1, rate);
        for (name, apply) in cases {
            let mut s = base;
            apply(&mut s);
            let d = differs(&plain, &s.process(&src, 1, rate));
            assert!(d > 1e-4, "{alg:?}: {name} did not reach the audio (difference {d:.6})");
        }
    }
}

/// Each new engine's parameters belong to it alone. Moving PVSOLA's anchor
/// rate must not change what the Hybrid does, or the panels are lying about
/// which engine they are configuring.
#[test]
fn the_new_engines_ignore_each_others_controls() {
    let rate = 44_100;
    let src = busy(rate, 1.0);

    let hybrid = Stretch { ratio: 3.0, algorithm: Algorithm::Hybrid, ..Default::default() };
    let mut moved = hybrid;
    moved.pvsola.anchor_frames = 40;
    moved.pvsola.blend = 0.0;
    assert_eq!(
        hybrid.process(&src, 1, rate),
        moved.process(&src, 1, rate),
        "the hybrid engine answered PVSOLA's controls"
    );

    let pvsola = Stretch { ratio: 3.0, algorithm: Algorithm::Pvsola, ..Default::default() };
    let mut moved = pvsola;
    moved.hybrid.residual_level = 0.0;
    moved.hybrid.margin = 1.0;
    assert_eq!(
        pvsola.process(&src, 1, rate),
        moved.process(&src, 1, rate),
        "PVSOLA answered the hybrid engine's controls"
    );
}

/// Both new engines run the older ones underneath, so the grain controls have
/// to reach them the same way they reach everything else — that is the whole
/// premise of one shared control model.
#[test]
fn the_grain_controls_reach_the_new_engines_too() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    for alg in NEW_ENGINES {
        let base = Stretch { ratio: 3.0, algorithm: alg, ..Default::default() };
        let plain = base.process(&src, 1, rate);

        let mut s = base;
        s.grain.overlap = 4.0;
        assert!(
            differs(&plain, &s.process(&src, 1, rate)) > 1e-4,
            "{alg:?} ignored the overlap control"
        );

        let mut s = base;
        s.grain.envelope = 1.0;
        assert!(
            differs(&plain, &s.process(&src, 1, rate)) > 1e-4,
            "{alg:?} ignored the envelope control"
        );

        // And inert where it should be, which is the other half of the claim.
        let same = Stretch { grain: inert_grain(), ..base };
        assert_eq!(
            plain,
            same.process(&src, 1, rate),
            "{alg:?} moved without being asked"
        );
    }
}

/// Strongest bin, in Hz. Enough to tell an octave from a fifth.
fn dominant(v: &[f32], rate: u32) -> f32 {
    let n = 16384usize.min(v.len().next_power_of_two() / 2).max(1024);
    let mut re: Vec<f32> = v[..n.min(v.len())].to_vec();
    re.resize(n, 0.0);
    let w = audio_core::fft::hann(n);
    for i in 0..n {
        re[i] *= w[i];
    }
    let mut im = vec![0f32; n];
    audio_core::fft::fft(&mut re, &mut im);
    let mut best = 1usize;
    let mut best_e = 0f32;
    for k in 1..n / 2 {
        let e = re[k] * re[k] + im[k] * im[k];
        if e > best_e {
            best_e = e;
            best = k;
        }
    }
    best as f32 * rate as f32 / n as f32
}

/// The panels for the two new engines show the vocoder's and WSOLA's own
/// controls, because both engines *run* those engines underneath. That is a
/// promise about routing, and this is the test that keeps it: a control on a
/// panel that does not reach the audio is the same bug as a control that does
/// nothing, and harder to notice because it looks right.
///
/// The transient detector's two settings are absent here on purpose. They are
/// live in the hybrid — the guard reaches it, so the detector is running — but
/// whether they change the output depends on the material, and they are inert
/// on this source for plain WSOLA too. Their coverage is the WSOLA test above.
#[test]
fn the_new_engine_panels_show_only_controls_that_reach_the_audio() {
    let rate = 44_100;
    let src = busy(rate, 1.0);

    let vocoder: Vec<(&str, Box<dyn Fn(&mut Stretch)>)> = vec![
        ("Analysis window", Box::new(|s: &mut Stretch| s.vocoder.window_ms = 92.0)),
        ("phase lock", Box::new(|s: &mut Stretch| s.vocoder.phase_lock = false)),
        ("Freeze", Box::new(|s: &mut Stretch| s.vocoder.mag_freeze = 0.9)),
        ("Blur", Box::new(|s: &mut Stretch| s.vocoder.mag_blur = 0.8)),
        ("Gate", Box::new(|s: &mut Stretch| s.vocoder.mag_gate = 0.3)),
        ("Freq trust", Box::new(|s: &mut Stretch| s.vocoder.freq_trust = 0.2)),
        ("Phase spread", Box::new(|s: &mut Stretch| s.vocoder.phase_spread = 0.0)),
        ("Peak width", Box::new(|s: &mut Stretch| s.vocoder.peak_width = 12)),
        ("Lock width", Box::new(|s: &mut Stretch| s.vocoder.lock_width = 3.0)),
        ("link stereo", Box::new(|s: &mut Stretch| s.vocoder.stereo_link = true)),
    ];
    let splice: Vec<(&str, Box<dyn Fn(&mut Stretch)>)> = vec![
        ("Search", Box::new(|s: &mut Stretch| s.wsola.search_ms = 0.0)),
        ("Pick", Box::new(|s: &mut Stretch| s.wsola.splice = fx::stretch::Splice::Different)),
        ("Window", Box::new(|s: &mut Stretch| s.wsola.shape = fx::stretch::WinShape::Rect)),
        ("Stride", Box::new(|s: &mut Stretch| s.wsola.stride = 64)),
    ];
    // The detector's own settings only bite where there are onsets to find, so
    // they get a source with unmistakable ones rather than the general-purpose
    // one above. This is a property of the detector rather than of the hybrid's
    // routing, and plain WSOLA behaves the same way — which is why *Detector*
    // itself is not here. Its coverage is at the detector, in
    // `transient::sensitivity_opens_the_gate`, exactly as it is for WSOLA.
    let detector: Vec<(&str, Box<dyn Fn(&mut Stretch)>)> = vec![
        ("Floor", Box::new(|s: &mut Stretch| s.wsola.floor = 0.0)),
        ("Guard", Box::new(|s: &mut Stretch| s.wsola.guard_hops = 12.0)),
    ];

    // Stereo, because `link stereo` has nothing to link otherwise — and the
    // right channel is *delayed*, not a scaled copy. Two channels that are
    // scaled copies of each other come out identical linked or not, because
    // the stretch is deterministic and both channels ask it the same question.
    // A scaled copy here made this test claim the control was dead.
    let delay = 977;
    let stereo: Vec<f32> = (0..src.len())
        .flat_map(|i| [src[i], if i >= delay { src[i - delay] } else { 0.0 }])
        .collect();

    for (alg, shown) in [
        // PVSOLA shows the vocoder's controls and deliberately not WSOLA's.
        (Algorithm::Pvsola, vec![&vocoder]),
        // The hybrid runs both, so it shows both.
        (Algorithm::Hybrid, vec![&vocoder, &splice]),
    ] {
        let base = Stretch { ratio: 3.0, algorithm: alg, ..Default::default() };
        let plain = base.process(&stereo, 2, rate);
        for group in shown {
            for (name, apply) in group.iter() {
                let mut s = base;
                apply(&mut s);
                let d = differs(&plain, &s.process(&stereo, 2, rate));
                assert!(d > 1e-6, "{alg:?}: the panel shows {name}, but it does not reach the audio");
            }
        }
    }

    // The hybrid's Transients group, on material that has transients. That
    // these move the audio at all is also the proof that the hybrid really does
    // hold the detector on: nothing on this list is reachable otherwise.
    let hits: Vec<f32> = {
        let mut v = vec![0f32; rate as usize];
        let mut seed = 99u32;
        for beat in 0..8 {
            let at = beat * (rate as usize / 8);
            for i in 0..1200 {
                if at + i >= v.len() {
                    break;
                }
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                let noise = ((seed >> 16) as f32 / 32768.0) - 1.0;
                v[at + i] += noise * (1.0 - i as f32 / 1200.0).powi(3) * 0.9;
            }
        }
        v
    };
    let base = Stretch { ratio: 3.0, algorithm: Algorithm::Hybrid, ..Default::default() };
    let plain = base.process(&hits, 1, rate);
    for (name, apply) in detector.iter() {
        let mut s = base;
        apply(&mut s);
        let d = differs(&plain, &s.process(&hits, 1, rate));
        assert!(d > 1e-6, "Hybrid: the panel shows {name}, but it does not reach the audio");
    }

    // The other half of the claim: PVSOLA finds its splice with its own search,
    // so WSOLA's splice group would be decoration on that panel — and is not
    // shown there. If this ever starts failing, the panel should gain them.
    let base = Stretch { ratio: 3.0, algorithm: Algorithm::Pvsola, ..Default::default() };
    let plain = base.process(&stereo, 2, rate);
    for (name, apply) in splice.iter() {
        let mut s = base;
        apply(&mut s);
        assert_eq!(
            plain,
            s.process(&stereo, 2, rate),
            "PVSOLA answered WSOLA's {name}, so its panel should be showing it"
        );
    }
}
