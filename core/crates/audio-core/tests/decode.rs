mod common;
use common::*;

use audio_core::{probe, Reader, SliceSource};

fn reader_for(bytes: Vec<u8>) -> Reader<SliceSource<Vec<u8>>> {
    let mut src = SliceSource::new(bytes);
    let info = probe(&mut src).expect("probe should succeed");
    Reader::new(src, info)
}

#[test]
fn pcm16_round_trips_through_f32_within_quantisation_error() {
    let original = sine_f32(1000.0, 44100, 256, 1, 0.5);
    let bytes = riff_wave(&[
        fmt_chunk(1, 1, 44100, 16),
        riff_chunk(b"data", &to_i16_le(&original)),
    ]);
    let mut r = reader_for(bytes);
    let decoded = r.read_frames(0, 256).expect("read");

    assert_eq!(decoded.len(), 256);
    for (i, (&got, &want)) in decoded.iter().zip(original.iter()).enumerate() {
        assert!(
            (got - want).abs() < 1.0 / 32767.0,
            "frame {i}: got {got}, want {want}"
        );
    }
}

#[test]
fn full_scale_maps_to_plus_or_minus_one() {
    // -32768 is one step further from zero than +32767. Dividing both by 32768
    // keeps the mapping symmetric and never exceeds 1.0.
    let mut data = Vec::new();
    data.extend_from_slice(&i16::MAX.to_le_bytes());
    data.extend_from_slice(&i16::MIN.to_le_bytes());
    data.extend_from_slice(&0i16.to_le_bytes());
    let bytes = riff_wave(&[fmt_chunk(1, 1, 44100, 16), riff_chunk(b"data", &data)]);

    let mut r = reader_for(bytes);
    let d = r.read_frames(0, 3).expect("read");

    assert_near(d[0], 1.0, 1e-4);
    assert_near(d[1], -1.0, 1e-4);
    assert_near(d[2], 0.0, 1e-9);
    assert!(d.iter().all(|v| v.abs() <= 1.0), "must never exceed unity");
}

#[test]
fn decodes_24_bit() {
    let original = sine_f32(440.0, 48000, 128, 1, 0.75);
    let bytes = riff_wave(&[
        fmt_chunk(1, 1, 48000, 24),
        riff_chunk(b"data", &to_i24_le(&original)),
    ]);
    let mut r = reader_for(bytes);
    let decoded = r.read_frames(0, 128).expect("read");

    for (&got, &want) in decoded.iter().zip(original.iter()) {
        assert!((got - want).abs() < 1e-5, "got {got}, want {want}");
    }
}

#[test]
fn decodes_float32_unchanged() {
    let original = sine_f32(100.0, 96000, 64, 2, 0.9);
    let bytes = riff_wave(&[
        fmt_chunk(3, 2, 96000, 32),
        riff_chunk(b"data", &to_f32_le(&original)),
    ]);
    let mut r = reader_for(bytes);
    let decoded = r.read_frames(0, 64).expect("read");

    assert_eq!(decoded.len(), 128);
    for (&got, &want) in decoded.iter().zip(original.iter()) {
        assert_eq!(got, want, "float samples must pass through bit-exact");
    }
}

#[test]
fn decodes_big_endian_aiff() {
    let original = sine_f32(1000.0, 44100, 100, 1, 0.5);
    let bytes = form_aiff(
        b"AIFF",
        &[
            comm_chunk(1, 100, 16, 44100.0, None),
            ssnd_chunk(&to_i16_be(&original)),
        ],
    );
    let mut r = reader_for(bytes);
    let decoded = r.read_frames(0, 100).expect("read");

    for (&got, &want) in decoded.iter().zip(original.iter()) {
        assert!((got - want).abs() < 1.0 / 32767.0);
    }
}

#[test]
fn reads_an_arbitrary_frame_range() {
    // Ramp so every frame is individually identifiable.
    let ramp: Vec<f32> = (0..100).map(|i| i as f32 / 1000.0).collect();
    let bytes = riff_wave(&[
        fmt_chunk(3, 1, 44100, 32),
        riff_chunk(b"data", &to_f32_le(&ramp)),
    ]);
    let mut r = reader_for(bytes);

    let mid = r.read_frames(40, 10).expect("read");
    assert_eq!(mid.len(), 10);
    for (i, &got) in mid.iter().enumerate() {
        assert_eq!(got, (40 + i) as f32 / 1000.0);
    }
}

#[test]
fn interleaved_channels_stay_in_order() {
    // Left is a constant +0.5, right a constant -0.25. If the reader loses
    // interleaving, this catches it immediately.
    let frames = 16;
    let left = vec![0.5f32; frames];
    let right = vec![-0.25f32; frames];
    let inter = interleave(&[left, right]);
    let bytes = riff_wave(&[
        fmt_chunk(3, 2, 44100, 32),
        riff_chunk(b"data", &to_f32_le(&inter)),
    ]);
    let mut r = reader_for(bytes);
    let d = r.read_frames(0, frames as u64).expect("read");

    for i in 0..frames {
        assert_eq!(d[i * 2], 0.5, "left channel at frame {i}");
        assert_eq!(d[i * 2 + 1], -0.25, "right channel at frame {i}");
    }
}

#[test]
fn reading_past_the_end_returns_what_exists() {
    let bytes = riff_wave(&[
        fmt_chunk(3, 1, 44100, 32),
        riff_chunk(b"data", &to_f32_le(&vec![0.1f32; 10])),
    ]);
    let mut r = reader_for(bytes);

    let d = r.read_frames(5, 100).expect("short read is not an error");
    assert_eq!(d.len(), 5);

    let none = r.read_frames(50, 10).expect("past end is not an error");
    assert!(none.is_empty());
}
