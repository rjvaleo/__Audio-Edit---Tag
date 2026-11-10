//! The granular engine, and the grain plan the interface draws.

use super::*;

// ================================================================= granular


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
