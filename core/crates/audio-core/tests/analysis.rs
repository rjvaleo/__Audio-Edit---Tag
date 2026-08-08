mod common;
use common::*;

use audio_core::{probe, Reader, SliceSource};

fn stats_of(samples: &[f32], channels: u16) -> audio_core::Stats {
    let bytes = riff_wave(&[
        fmt_chunk(3, channels, 44100, 32),
        riff_chunk(b"data", &to_f32_le(samples)),
    ]);
    let mut src = SliceSource::new(bytes);
    let info = probe(&mut src).expect("probe");
    let mut r = Reader::new(src, info);
    r.stats().expect("stats")
}

#[test]
fn peak_of_a_half_scale_sine_is_about_minus_six_dbfs() {
    let s = sine_f32(1000.0, 44100, 44100, 1, 0.5);
    let st = stats_of(&s, 1);
    assert_near(st.peak, 0.5, 0.001);
    assert_near(st.peak_dbfs, -6.02, 0.1);
}

#[test]
fn rms_of_a_sine_is_amplitude_over_root_two() {
    let s = sine_f32(1000.0, 44100, 44100, 1, 1.0);
    let st = stats_of(&s, 1);
    assert_near(st.rms, std::f32::consts::FRAC_1_SQRT_2, 0.001);
    assert_near(st.rms_dbfs, -3.01, 0.1);
}

#[test]
fn digital_silence_reports_negative_infinity_not_a_nan() {
    let st = stats_of(&vec![0.0f32; 4410], 1);
    assert_eq!(st.peak, 0.0);
    assert!(st.peak_dbfs.is_infinite() && st.peak_dbfs.is_sign_negative());
    assert!(!st.rms_dbfs.is_nan());
}

#[test]
fn identical_channels_correlate_at_plus_one() {
    let mono = sine_f32(500.0, 44100, 44100, 1, 0.8);
    let inter = interleave(&[mono.clone(), mono]);
    let st = stats_of(&inter, 2);
    assert_near(st.correlation.expect("stereo"), 1.0, 0.001);
}

#[test]
fn inverted_channels_correlate_at_minus_one() {
    // This is the case that matters in practice: a file that cancels to silence
    // in mono. Getting the sign wrong makes the meter useless.
    let mono = sine_f32(500.0, 44100, 44100, 1, 0.8);
    let inverted: Vec<f32> = mono.iter().map(|v| -v).collect();
    let inter = interleave(&[mono, inverted]);
    let st = stats_of(&inter, 2);
    assert_near(st.correlation.expect("stereo"), -1.0, 0.001);
}

#[test]
fn uncorrelated_channels_sit_near_zero() {
    // Sine against cosine at the same frequency: orthogonal over whole cycles.
    let frames = 44100;
    let sr = 44100.0;
    let left: Vec<f32> = (0..frames)
        .map(|i| (2.0 * std::f64::consts::PI * 500.0 * i as f64 / sr).sin() as f32)
        .collect();
    let right: Vec<f32> = (0..frames)
        .map(|i| (2.0 * std::f64::consts::PI * 500.0 * i as f64 / sr).cos() as f32)
        .collect();
    let st = stats_of(&interleave(&[left, right]), 2);
    assert_near(st.correlation.expect("stereo"), 0.0, 0.01);
}

#[test]
fn mono_has_no_correlation_figure() {
    let st = stats_of(&sine_f32(500.0, 44100, 1000, 1, 0.5), 1);
    assert!(st.correlation.is_none());
}

#[test]
fn dual_mono_is_flagged_but_true_stereo_is_not() {
    // The existing indexer cannot tell mono from dual-mono for headerless files.
    // With real samples in hand it is simply an equality check.
    let mono = sine_f32(500.0, 44100, 4410, 1, 0.5);
    let dual = stats_of(&interleave(&[mono.clone(), mono.clone()]), 2);
    assert!(dual.dual_mono, "identical channels are dual mono");

    let other = sine_f32(700.0, 44100, 4410, 1, 0.5);
    let wide = stats_of(&interleave(&[mono, other]), 2);
    assert!(!wide.dual_mono);
}

#[test]
fn clipping_is_detected() {
    let mut s = sine_f32(500.0, 44100, 4410, 1, 1.0);
    for v in s.iter_mut().take(10) {
        *v = 1.0;
    }
    let st = stats_of(&s, 1);
    assert!(st.clipped_samples > 0);
}

#[test]
fn a_clean_signal_reports_no_clipping() {
    let st = stats_of(&sine_f32(500.0, 44100, 4410, 1, 0.5), 1);
    assert_eq!(st.clipped_samples, 0);
}
