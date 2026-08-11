//! Identifying a container.
//!
//! This is the front door: every file in the library arrives through it, and
//! almost none of them were written by us. The module's own doc comment says
//! chunk walking is done by seeking rather than by assuming a layout, because
//! real files put `LIST`, `bext` and `JUNK` ahead of the chunks that matter —
//! and it had no tests, so that claim was unverified.
//!
//! Everything here is bytes built in memory, so a failure names a byte layout
//! rather than a file someone has to go and find.

use audio_core::{probe, Codec, Container, Endian, ProbeError, SliceSource};

// ------------------------------------------------------------------ builders

fn le32(v: u32) -> [u8; 4] {
    v.to_le_bytes()
}
fn be32(v: u32) -> [u8; 4] {
    v.to_be_bytes()
}

/// A RIFF/WAVE file with the chunks given, in the order given.
fn riff(chunks: Vec<(&[u8; 4], Vec<u8>)>) -> Vec<u8> {
    let mut body = b"WAVE".to_vec();
    for (id, payload) in chunks {
        body.extend_from_slice(id);
        body.extend_from_slice(&le32(payload.len() as u32));
        body.extend_from_slice(&payload);
        // RIFF pads odd chunks to an even boundary.
        if payload.len() % 2 == 1 {
            body.push(0);
        }
    }
    let mut out = b"RIFF".to_vec();
    out.extend_from_slice(&le32(body.len() as u32));
    out.extend_from_slice(&body);
    out
}

fn fmt_chunk(format_tag: u16, channels: u16, rate: u32, bits: u16) -> Vec<u8> {
    let block_align = channels * bits / 8;
    let byte_rate = rate * block_align as u32;
    let mut v = Vec::new();
    v.extend_from_slice(&format_tag.to_le_bytes());
    v.extend_from_slice(&channels.to_le_bytes());
    v.extend_from_slice(&le32(rate));
    v.extend_from_slice(&le32(byte_rate));
    v.extend_from_slice(&block_align.to_le_bytes());
    v.extend_from_slice(&bits.to_le_bytes());
    v
}

/// An 80-bit IEEE extended float, which is how AIFF stores its sample rate.
fn extended(rate: f64) -> [u8; 10] {
    let mut out = [0u8; 10];
    if rate <= 0.0 {
        return out;
    }
    let exp = rate.log2().floor() as i32;
    let mantissa = (rate / 2f64.powi(exp) * 2f64.powi(63)) as u64;
    let biased = (exp + 16383) as u16;
    out[..2].copy_from_slice(&biased.to_be_bytes());
    out[2..].copy_from_slice(&mantissa.to_be_bytes());
    out
}

fn aiff(kind: &[u8; 4], channels: u16, frames: u32, bits: u16, rate: f64, data: usize) -> Vec<u8> {
    let mut comm = Vec::new();
    comm.extend_from_slice(&channels.to_be_bytes());
    comm.extend_from_slice(&be32(frames));
    comm.extend_from_slice(&bits.to_be_bytes());
    comm.extend_from_slice(&extended(rate));
    if kind == b"AIFC" {
        comm.extend_from_slice(b"NONE");
        comm.push(0);
    }

    let mut ssnd = vec![0u8; 8]; // offset and block size, both zero
    ssnd.extend(std::iter::repeat(0u8).take(data));

    let mut body = kind.to_vec();
    for (id, payload) in [(b"COMM", comm), (b"SSND", ssnd)] {
        body.extend_from_slice(id);
        body.extend_from_slice(&be32(payload.len() as u32));
        body.extend_from_slice(&payload);
        if payload.len() % 2 == 1 {
            body.push(0);
        }
    }
    let mut out = b"FORM".to_vec();
    out.extend_from_slice(&be32(body.len() as u32));
    out.extend_from_slice(&body);
    out
}

fn read(bytes: &[u8]) -> Result<audio_core::AudioInfo, ProbeError> {
    let mut src = SliceSource::new(bytes.to_vec());
    probe(&mut src)
}

// --------------------------------------------------------------------- WAV

#[test]
fn a_plain_wav_reads_as_what_it_says_it_is() {
    let bytes = riff(vec![
        (b"fmt ", fmt_chunk(1, 2, 44_100, 16)),
        (b"data", vec![0u8; 4000]),
    ]);
    let i = read(&bytes).unwrap();
    assert_eq!(i.container, Container::Wav);
    assert_eq!(i.codec, Codec::PcmI16);
    assert_eq!(i.endian, Endian::Little);
    assert_eq!(i.channels, 2);
    assert_eq!(i.sample_rate, 44_100);
    assert_eq!(i.bits, 16);
    assert_eq!(i.data_len, 4000);
    assert_eq!(i.frames(), 1000);
}

/// The whole reason the walker seeks rather than assuming an offset. A parser
/// that read `fmt ` from a fixed position would produce garbage here, and
/// these chunks are in real files rather than hypothetical ones.
#[test]
fn chunks_before_the_ones_that_matter_are_walked_past() {
    let bytes = riff(vec![
        (b"JUNK", vec![0u8; 92]),
        (b"bext", vec![0u8; 602]),
        (b"LIST", b"INFOISFT\x08\x00\x00\x00somethin".to_vec()),
        (b"fmt ", fmt_chunk(1, 1, 48_000, 24)),
        (b"data", vec![0u8; 900]),
    ]);
    let i = read(&bytes).unwrap();
    assert_eq!(i.codec, Codec::PcmI24);
    assert_eq!(i.channels, 1);
    assert_eq!(i.sample_rate, 48_000);
    assert_eq!(i.data_len, 900);
    assert_eq!(i.frames(), 300);
}

/// An odd-length chunk is padded to an even boundary, and a walker that
/// forgets the pad byte lands one short and reads the next id as gibberish.
#[test]
fn an_odd_length_chunk_does_not_knock_the_walk_out_of_step() {
    let bytes = riff(vec![
        (b"LIST", vec![7u8; 31]), // odd, so a pad byte follows
        (b"fmt ", fmt_chunk(1, 2, 22_050, 16)),
        (b"data", vec![0u8; 200]),
    ]);
    let i = read(&bytes).unwrap();
    assert_eq!(i.sample_rate, 22_050);
    assert_eq!(i.data_len, 200);
}

#[test]
fn every_pcm_width_is_recognised() {
    for (tag, bits, want) in [
        (1u16, 8u16, Codec::PcmU8),
        (1, 16, Codec::PcmI16),
        (1, 24, Codec::PcmI24),
        (1, 32, Codec::PcmI32),
        (3, 32, Codec::PcmF32),
        (3, 64, Codec::PcmF64),
    ] {
        let bytes = riff(vec![
            (b"fmt ", fmt_chunk(tag, 1, 44_100, bits)),
            (b"data", vec![0u8; 480]),
        ]);
        let i = read(&bytes).unwrap_or_else(|e| panic!("tag {tag} bits {bits}: {e}"));
        assert_eq!(i.codec, want, "tag {tag} bits {bits}");
        assert_eq!(i.bits, bits);
    }
}

/// Writers that stream sometimes never go back to fill the size in. Trusting
/// it would mean reading far past the end of the file.
#[test]
fn a_data_chunk_that_lies_about_its_size_is_clamped_to_the_file() {
    let mut bytes = riff(vec![
        (b"fmt ", fmt_chunk(1, 2, 44_100, 16)),
        (b"data", vec![0u8; 1000]),
    ]);
    // Overwrite the data chunk's declared size with 0xFFFFFFFF.
    let at = bytes.len() - 1000 - 4;
    bytes[at..at + 4].copy_from_slice(&le32(0xFFFF_FFFF));

    let i = read(&bytes).unwrap();
    assert!(
        i.data_offset + i.data_len <= bytes.len() as u64,
        "the declared size was believed: offset {} len {} in a {}-byte file",
        i.data_offset,
        i.data_len,
        bytes.len()
    );
}

/// The data length is always a whole number of frames, so the frame count and
/// the byte count cannot disagree about where the audio ends.
#[test]
fn a_trailing_partial_frame_is_discarded() {
    let bytes = riff(vec![
        (b"fmt ", fmt_chunk(1, 2, 44_100, 16)),
        (b"data", vec![0u8; 1003]), // 250 frames and three bytes over
    ]);
    let i = read(&bytes).unwrap();
    assert_eq!(i.data_len % 4, 0, "a partial frame survived: {}", i.data_len);
    assert_eq!(i.frames(), 250);
}

// -------------------------------------------------------------------- AIFF

#[test]
fn an_aiff_reads_big_endian_with_its_extended_sample_rate() {
    let bytes = aiff(b"AIFF", 2, 500, 16, 44_100.0, 2000);
    let i = read(&bytes).unwrap();
    assert_eq!(i.container, Container::Aiff);
    assert_eq!(i.endian, Endian::Big, "AIFF samples are big endian");
    assert_eq!(i.channels, 2);
    assert_eq!(i.bits, 16);
    assert_eq!(i.sample_rate, 44_100, "the 80-bit rate was not decoded");
    assert_eq!(i.frames(), 500);
}

#[test]
fn an_aifc_is_told_apart_from_an_aiff() {
    let i = read(&aiff(b"AIFC", 1, 300, 16, 48_000.0, 600)).unwrap();
    assert_eq!(i.container, Container::Aifc);
    assert_eq!(i.sample_rate, 48_000);
}

#[test]
fn an_aiff_at_an_unusual_rate_still_decodes_it() {
    for rate in [8_000.0, 22_050.0, 32_000.0, 96_000.0, 192_000.0] {
        let i = read(&aiff(b"AIFF", 1, 100, 24, rate, 300)).unwrap();
        assert_eq!(i.sample_rate, rate as u32, "at {rate} Hz");
    }
}

// ------------------------------------------------------- the fallback and edges

/// Anything unrecognised becomes headerless PCM rather than an error. That is
/// deliberate — it is what lets an SD2 data fork play — and it is why the
/// browser needs a switch for it.
#[test]
fn something_with_no_header_falls_back_to_headerless_pcm() {
    let i = read(&vec![9u8; 40_000]).unwrap();
    assert_eq!(i.container, Container::Raw);
    assert_eq!(i.codec, Codec::PcmI16);
    assert_eq!(i.data_offset, 0);
    assert_eq!(i.channels, 2);
    assert_eq!(i.sample_rate, 44_100);
}

#[test]
fn a_riff_that_is_not_a_wave_is_not_read_as_one() {
    let mut bytes = b"RIFF".to_vec();
    bytes.extend_from_slice(&le32(20));
    bytes.extend_from_slice(b"AVI ");
    bytes.extend_from_slice(&vec![0u8; 16]);
    let i = read(&bytes).unwrap();
    assert_eq!(i.container, Container::Raw, "an AVI was read as audio");
}

#[test]
fn an_empty_file_is_an_error_rather_than_a_zero_length_sound() {
    assert!(matches!(read(&[]), Err(ProbeError::Empty)));
}

#[test]
fn a_file_too_short_to_hold_a_header_does_not_read_off_the_end() {
    for n in 1..12usize {
        let i = read(&vec![1u8; n]);
        // Whatever it decides, it must decide rather than panic.
        assert!(i.is_ok() || i.is_err(), "length {n} neither succeeded nor failed");
    }
}

/// A chunk claiming zero length cannot advance the cursor, so a walker that
/// trusted it would spin. This must terminate.
#[test]
fn a_zero_length_chunk_does_not_hang_the_walk() {
    let mut body = b"WAVE".to_vec();
    body.extend_from_slice(b"JUNK");
    body.extend_from_slice(&le32(0));
    body.extend_from_slice(b"fmt ");
    body.extend_from_slice(&le32(16));
    body.extend_from_slice(&fmt_chunk(1, 1, 44_100, 16));
    let mut bytes = b"RIFF".to_vec();
    bytes.extend_from_slice(&le32(body.len() as u32));
    bytes.extend_from_slice(&body);

    // The assertion is that this returns at all.
    let _ = read(&bytes);
}

#[test]
fn a_wav_with_no_data_chunk_is_an_error_not_a_silent_success() {
    let bytes = riff(vec![(b"fmt ", fmt_chunk(1, 2, 44_100, 16))]);
    assert!(read(&bytes).is_err(), "a header with no audio should not read as audio");
}

#[test]
fn an_unsupported_codec_says_so() {
    // Format tag 0x0011 is IMA ADPCM: a real tag, and not PCM.
    let bytes = riff(vec![
        (b"fmt ", fmt_chunk(0x0011, 1, 44_100, 4)),
        (b"data", vec![0u8; 500]),
    ]);
    match read(&bytes) {
        Err(ProbeError::UnsupportedCodec(_)) => {}
        other => panic!("expected an unsupported-codec error, got {other:?}"),
    }
}

/// The duration is what the interface lays the timeline out from, so it has to
/// follow from the frame count rather than being measured separately.
#[test]
fn the_duration_follows_from_the_frames_and_the_rate() {
    let bytes = riff(vec![
        (b"fmt ", fmt_chunk(1, 2, 48_000, 16)),
        (b"data", vec![0u8; 48_000 * 4]), // two seconds of stereo 16-bit
    ]);
    let i = read(&bytes).unwrap();
    assert_eq!(i.frames(), 48_000);
    assert!((i.duration_secs() - 1.0).abs() < 1e-6, "{}", i.duration_secs());
}
