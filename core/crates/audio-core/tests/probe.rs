mod common;
use common::*;

use audio_core::{probe, Codec, Container, Endian, SliceSource};

fn probe_bytes(bytes: Vec<u8>) -> audio_core::AudioInfo {
    let mut src = SliceSource::new(bytes);
    probe(&mut src).expect("probe should succeed")
}

#[test]
fn reads_a_plain_pcm16_wav() {
    let samples = to_i16_le(&sine_f32(1000.0, 44100, 100, 2, 0.5));
    let bytes = riff_wave(&[
        fmt_chunk(1, 2, 44100, 16),
        riff_chunk(b"data", &samples),
    ]);
    let info = probe_bytes(bytes);

    assert_eq!(info.container, Container::Wav);
    assert_eq!(info.codec, Codec::PcmI16);
    assert_eq!(info.endian, Endian::Little);
    assert_eq!(info.sample_rate, 44100);
    assert_eq!(info.channels, 2);
    assert_eq!(info.bits, 16);
    assert_eq!(info.frames(), 100);
    assert_near(info.duration_secs() as f32, 100.0 / 44100.0, 1e-6);
}

#[test]
fn finds_fmt_and_data_after_unrelated_chunks() {
    // Real files put LIST/bext/junk ahead of the chunks we need. A parser that
    // assumes fmt is at offset 12 reads garbage.
    let samples = to_i16_le(&sine_f32(440.0, 48000, 64, 1, 0.25));
    let bytes = riff_wave(&[
        riff_chunk(b"JUNK", &[0u8; 37]), // odd length, forces pad-byte handling
        riff_chunk(b"LIST", b"INFOhello there!!"),
        fmt_chunk(1, 1, 48000, 16),
        riff_chunk(b"bext", &[0u8; 10]),
        riff_chunk(b"data", &samples),
    ]);
    let info = probe_bytes(bytes);

    assert_eq!(info.sample_rate, 48000);
    assert_eq!(info.channels, 1);
    assert_eq!(info.frames(), 64);
}

#[test]
fn reads_float32_wav() {
    let samples = to_f32_le(&sine_f32(100.0, 96000, 32, 2, 1.0));
    let bytes = riff_wave(&[
        fmt_chunk(3, 2, 96000, 32),
        riff_chunk(b"data", &samples),
    ]);
    let info = probe_bytes(bytes);

    assert_eq!(info.codec, Codec::PcmF32);
    assert_eq!(info.sample_rate, 96000);
    assert_eq!(info.frames(), 32);
}

#[test]
fn reads_extensible_wav_as_its_subformat() {
    let samples = to_i24_le(&sine_f32(220.0, 44100, 50, 2, 0.5));
    let bytes = riff_wave(&[
        fmt_chunk_extensible(2, 44100, 24, false),
        riff_chunk(b"data", &samples),
    ]);
    let info = probe_bytes(bytes);

    assert_eq!(info.codec, Codec::PcmI24);
    assert_eq!(info.bits, 24);
    assert_eq!(info.frames(), 50);
}

#[test]
fn reads_big_endian_aiff() {
    let samples = to_i16_be(&sine_f32(1000.0, 44100, 80, 2, 0.5));
    let bytes = form_aiff(
        b"AIFF",
        &[comm_chunk(2, 80, 16, 44100.0, None), ssnd_chunk(&samples)],
    );
    let info = probe_bytes(bytes);

    assert_eq!(info.container, Container::Aiff);
    assert_eq!(info.codec, Codec::PcmI16);
    assert_eq!(info.endian, Endian::Big);
    assert_eq!(info.sample_rate, 44100);
    assert_eq!(info.channels, 2);
    assert_eq!(info.frames(), 80);
}

#[test]
fn treats_aifc_sowt_as_little_endian() {
    // 'sowt' is 'twos' reversed: the samples are already little-endian and must
    // not be byte-swapped again.
    let samples = to_i16_le(&sine_f32(1000.0, 44100, 40, 1, 0.5));
    let bytes = form_aiff(
        b"AIFC",
        &[
            comm_chunk(1, 40, 16, 44100.0, Some(b"sowt")),
            ssnd_chunk(&samples),
        ],
    );
    let info = probe_bytes(bytes);

    assert_eq!(info.container, Container::Aifc);
    assert_eq!(info.endian, Endian::Little);
    assert_eq!(info.frames(), 40);
}

#[test]
fn treats_aifc_none_as_big_endian() {
    let samples = to_i16_be(&sine_f32(1000.0, 44100, 40, 1, 0.5));
    let bytes = form_aiff(
        b"AIFC",
        &[
            comm_chunk(1, 40, 16, 44100.0, Some(b"NONE")),
            ssnd_chunk(&samples),
        ],
    );
    let info = probe_bytes(bytes);
    assert_eq!(info.endian, Endian::Big);
}

#[test]
fn decodes_every_common_extended80_sample_rate() {
    // The 80-bit extended format is the single most error-prone field in AIFF.
    for rate in [8000u32, 22050, 32000, 44100, 48000, 88200, 96000, 192000] {
        let bytes = form_aiff(
            b"AIFF",
            &[
                comm_chunk(1, 10, 16, rate as f64, None),
                ssnd_chunk(&vec![0u8; 20]),
            ],
        );
        let info = probe_bytes(bytes);
        assert_eq!(info.sample_rate, rate, "sample rate {rate} round-trip");
    }
}

#[test]
fn falls_back_to_raw_for_headerless_data() {
    // Half the archive is headerless PCM. It must probe as Raw with a usable
    // default rather than failing.
    let bytes = to_i16_le(&sine_f32(1000.0, 44100, 500, 2, 0.5));
    let info = probe_bytes(bytes);

    assert_eq!(info.container, Container::Raw);
    assert_eq!(info.codec, Codec::PcmI16);
    assert_eq!(info.channels, 2);
    assert_eq!(info.sample_rate, 44100);
}

#[test]
fn raw_data_length_is_rounded_down_to_whole_frames() {
    // 2 channels x 16 bit = 4 bytes per frame; 4098 bytes is not a whole number
    // of frames and the trailing partial frame must be dropped, not decoded.
    let bytes = vec![0u8; 4098];
    let info = probe_bytes(bytes);
    assert_eq!(info.frames(), 1024);
    assert_eq!(info.data_len, 4096);
}

#[test]
fn rejects_an_empty_source() {
    let mut src = SliceSource::new(Vec::new());
    assert!(probe(&mut src).is_err());
}

#[test]
fn rejects_a_wav_with_no_data_chunk() {
    let bytes = riff_wave(&[fmt_chunk(1, 2, 44100, 16)]);
    let mut src = SliceSource::new(bytes);
    assert!(probe(&mut src).is_err());
}
