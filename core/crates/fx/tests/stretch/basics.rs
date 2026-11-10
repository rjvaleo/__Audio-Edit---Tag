//! Length, pitch and the signal itself.

use super::*;

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
