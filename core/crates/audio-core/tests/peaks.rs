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

/// The waveform viewer claims to be sample accurate once it is zoomed in far
/// enough. That claim rests entirely on this: when more columns are asked for
/// than there are frames, the tile must collapse to one column per frame, and
/// each column must carry that frame's actual value rather than a summary of
/// it. If this ever regresses the display silently starts lying at high zoom.
#[test]
fn a_tile_asked_for_more_columns_than_frames_returns_one_column_per_sample() {
    let s: Vec<f32> = (0..16).map(|i| (i as f32 - 8.0) / 16.0).collect();
    let tile = tile_of(&s, 1, 4096);

    assert_eq!(tile.columns, 16, "columns must clamp to the frame count");
    for (i, col) in tile.channel(0).iter().enumerate() {
        assert_eq!(col.min, s[i], "column {i} min is not the sample");
        assert_eq!(col.max, s[i], "column {i} max is not the sample");
        // One sample: rms of a single value is its magnitude.
        assert_near(col.rms, s[i].abs(), 1e-6);
    }
}

/// The same guarantee for a window part-way into the file, since that is what
/// zooming actually produces — a range, not the whole thing from zero.
#[test]
fn a_zoomed_window_maps_each_column_to_the_right_absolute_frame() {
    let s: Vec<f32> = (0..1000).map(|i| i as f32 / 1000.0).collect();
    let bytes = riff_wave(&[
        fmt_chunk(3, 1, 44100, 32),
        riff_chunk(b"data", &to_f32_le(&s)),
    ]);
    let mut src = SliceSource::new(bytes);
    let info = probe(&mut src).expect("probe");
    let mut r = Reader::new(src, info);

    let tile = r.peak_tile(600, 20, 4096).expect("peak tile");
    assert_eq!(tile.columns, 20);
    for (i, col) in tile.channel(0).iter().enumerate() {
        assert_eq!(col.max, s[600 + i], "column {i} is not frame {}", 600 + i);
    }
}

/// Stereo must stay de-interleaved at sample resolution too — a channel swap
/// here would be invisible in the envelope view but obvious sample by sample.
#[test]
fn sample_resolution_keeps_the_channels_apart() {
    let mut s = Vec::new();
    for i in 0..12 {
        s.push(i as f32 / 100.0);          // left ramps up
        s.push(-(i as f32) / 100.0);       // right ramps down
    }
    let tile = tile_of(&s, 2, 4096);

    assert_eq!(tile.columns, 12);
    for i in 0..12 {
        assert_eq!(tile.channel(0)[i].max, i as f32 / 100.0);
        assert_eq!(tile.channel(1)[i].max, -(i as f32) / 100.0);
    }
}
