mod common;
use common::*;

use audio_core::{probe, PeakTile, Reader, SliceSource};

fn tile_of(samples: &[f32], channels: u16, columns: usize) -> PeakTile {
    let bytes = riff_wave(&[
        fmt_chunk(3, channels, 44100, 32),
        riff_chunk(b"data", &to_f32_le(samples)),
    ]);
    let mut src = SliceSource::new(bytes);
    let info = probe(&mut src).expect("probe");
    let frames = info.frames();
    let mut r = Reader::new(src, info);
    r.peak_tile(0, frames, columns).expect("peak tile")
}

#[test]
fn a_full_scale_sine_reaches_both_rails_with_the_expected_rms() {
    // rms of a sine is amplitude / sqrt(2).
    let s = sine_f32(1000.0, 44100, 44100, 1, 1.0);
    let tile = tile_of(&s, 1, 100);

    assert_eq!(tile.channels, 1);
    assert_eq!(tile.columns, 100);
    for (i, col) in tile.channel(0).iter().enumerate() {
        assert_near(col.max, 1.0, 0.02);
        assert_near(col.min, -1.0, 0.02);
        assert_near(col.rms, std::f32::consts::FRAC_1_SQRT_2, 0.02);
        assert!(col.min <= col.max, "column {i} has min above max");
    }
}

#[test]
fn amplitude_scales_the_envelope_linearly() {
    let s = sine_f32(1000.0, 44100, 44100, 1, 0.25);
    let tile = tile_of(&s, 1, 50);
    for col in tile.channel(0) {
        assert_near(col.max, 0.25, 0.01);
        assert_near(col.min, -0.25, 0.01);
        assert_near(col.rms, 0.25 * std::f32::consts::FRAC_1_SQRT_2, 0.01);
    }
}

#[test]
fn silence_produces_a_flat_tile() {
    let tile = tile_of(&vec![0.0f32; 10000], 1, 40);
    for col in tile.channel(0) {
        assert_eq!(col.max, 0.0);
        assert_eq!(col.min, 0.0);
        assert_eq!(col.rms, 0.0);
    }
}

#[test]
fn channels_are_measured_independently() {
    // A tile that mixed channels together would report the same envelope twice.
    let frames = 20000;
    let left = sine_f32(500.0, 44100, frames, 1, 1.0);
    let right = sine_f32(500.0, 44100, frames, 1, 0.1);
    let inter = interleave(&[left, right]);
    let tile = tile_of(&inter, 2, 64);

    assert_eq!(tile.channels, 2);
    for col in tile.channel(0) {
        assert_near(col.max, 1.0, 0.02);
    }
    for col in tile.channel(1) {
        assert_near(col.max, 0.1, 0.02);
    }
}

#[test]
fn a_transient_survives_heavy_decimation() {
    // The whole point of min/max envelopes over averaging: a single-sample spike
    // in a million frames must still show up. Sub-sampling would miss it.
    let mut s = vec![0.0f32; 1_000_000];
    s[723_456] = 1.0;
    let tile = tile_of(&s, 1, 100);

    let loudest = tile
        .channel(0)
        .iter()
        .map(|c| c.max)
        .fold(0.0f32, f32::max);
    assert_near(loudest, 1.0, 1e-6);
}

#[test]
fn asking_for_more_columns_than_frames_does_not_produce_empty_columns() {
    let s = sine_f32(1000.0, 44100, 10, 1, 1.0);
    let tile = tile_of(&s, 1, 100);
    assert!(tile.columns <= 10, "columns must be capped at the frame count");
    assert!(tile.columns > 0);
}

#[test]
fn a_sub_range_covers_only_that_range() {
    // First half silent, second half full scale. A tile over the second half
    // must be entirely loud.
    let mut s = vec![0.0f32; 20000];
    for v in s.iter_mut().skip(10000) {
        *v = 1.0;
    }
    let bytes = riff_wave(&[
        fmt_chunk(3, 1, 44100, 32),
        riff_chunk(b"data", &to_f32_le(&s)),
    ]);
    let mut src = SliceSource::new(bytes);
    let info = probe(&mut src).expect("probe");
    let mut r = Reader::new(src, info);

    let second = r.peak_tile(10000, 10000, 20).expect("tile");
    for col in second.channel(0) {
        assert_near(col.max, 1.0, 1e-6);
    }

    let first = r.peak_tile(0, 10000, 20).expect("tile");
    for col in first.channel(0) {
        assert_eq!(col.max, 0.0);
    }
}
