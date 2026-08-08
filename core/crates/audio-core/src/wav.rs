//! WAV output.
//!
//! Used to make every format in the library playable in a browser, and to
//! export selections. AIFF and headerless PCM are re-wrapped rather than
//! re-encoded: the sample bytes are copied through, byte-swapped only when the
//! source is big-endian. That keeps it lossless and, because every conversion
//! is byte-length preserving, lets the server answer range requests with exact
//! arithmetic instead of decoding to find out how long the result is.

use crate::probe::{AudioInfo, Codec, Endian};

pub const HEADER_LEN: u64 = 44;

/// Format tag and bit depth as WAV wants them.
fn wav_format(codec: Codec) -> (u16, u16) {
    match codec {
        Codec::PcmU8 => (1, 8),
        Codec::PcmI16 => (1, 16),
        Codec::PcmI24 => (1, 24),
        Codec::PcmI32 => (1, 32),
        Codec::PcmF32 => (3, 32),
        Codec::PcmF64 => (3, 64),
    }
}

/// Build a 44-byte canonical WAV header for `data_len` bytes of samples.
pub fn header(data_len: u64, channels: u16, sample_rate: u32, codec: Codec) -> [u8; 44] {
    let (fmt_tag, bits) = wav_format(codec);
    let block_align = channels * bits / 8;
    let byte_rate = sample_rate * block_align as u32;
    // RIFF sizes are 32-bit. A file beyond 4 GB needs RF64; clamp rather than
    // wrap, so an oversized file plays as much as it can instead of garbage.
    let riff_size = (36u64 + data_len).min(u32::MAX as u64) as u32;
    let data_size = data_len.min(u32::MAX as u64) as u32;

    let mut h = [0u8; 44];
    h[0..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&riff_size.to_le_bytes());
    h[8..12].copy_from_slice(b"WAVE");
    h[12..16].copy_from_slice(b"fmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..22].copy_from_slice(&fmt_tag.to_le_bytes());
    h[22..24].copy_from_slice(&channels.to_le_bytes());
    h[24..28].copy_from_slice(&sample_rate.to_le_bytes());
    h[28..32].copy_from_slice(&byte_rate.to_le_bytes());
    h[32..34].copy_from_slice(&block_align.to_le_bytes());
    h[34..36].copy_from_slice(&bits.to_le_bytes());
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&data_size.to_le_bytes());
    h
}

/// Total length of the WAV stream this source will produce.
pub fn stream_len(info: &AudioInfo) -> u64 {
    HEADER_LEN + info.data_len
}

/// Rewrite sample bytes into the little-endian layout WAV requires.
///
/// `first_byte_index` is the offset of `buf` within the sample data, needed
/// because a range request can start part-way through a sample.
pub fn convert_samples(buf: &mut [u8], codec: Codec, endian: Endian, first_byte_index: u64) {
    // WAV stores 8-bit as unsigned; AIFF stores it signed. Flipping the sign bit
    // converts between them and is its own inverse.
    if codec == Codec::PcmU8 {
        if endian == Endian::Big {
            for b in buf.iter_mut() {
                *b ^= 0x80;
            }
        }
        return;
    }
    if endian == Endian::Little {
        return;
    }

    let width = codec.bytes_per_sample();
    // Align to the first whole sample inside this slice.
    let misalign = (first_byte_index % width as u64) as usize;
    let start = if misalign == 0 { 0 } else { width - misalign };
    if start >= buf.len() {
        return;
    }
    let body = &mut buf[start..];
    let whole = body.len() / width * width;
    for chunk in body[..whole].chunks_exact_mut(width) {
        chunk.reverse();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::probe::Container;

    fn info(codec: Codec, endian: Endian, channels: u16, data_len: u64) -> AudioInfo {
        AudioInfo {
            container: Container::Aiff,
            codec,
            endian,
            sample_rate: 44100,
            channels,
            bits: (codec.bytes_per_sample() * 8) as u16,
            data_offset: 0,
            data_len,
        }
    }

    #[test]
    fn header_is_exactly_forty_four_bytes_and_well_formed() {
        let h = header(1000, 2, 44100, Codec::PcmI16);
        assert_eq!(h.len(), 44);
        assert_eq!(&h[0..4], b"RIFF");
        assert_eq!(&h[8..12], b"WAVE");
        assert_eq!(&h[12..16], b"fmt ");
        assert_eq!(&h[36..40], b"data");
        assert_eq!(u32::from_le_bytes([h[40], h[41], h[42], h[43]]), 1000);
        assert_eq!(u32::from_le_bytes([h[4], h[5], h[6], h[7]]), 1036);
    }

    #[test]
    fn byte_rate_and_block_align_are_consistent() {
        let h = header(0, 2, 48000, Codec::PcmI24);
        let block_align = u16::from_le_bytes([h[32], h[33]]);
        let byte_rate = u32::from_le_bytes([h[28], h[29], h[30], h[31]]);
        assert_eq!(block_align, 6); // 2 channels x 3 bytes
        assert_eq!(byte_rate, 48000 * 6);
    }

    #[test]
    fn float_sources_are_tagged_as_ieee_float() {
        let h = header(0, 1, 44100, Codec::PcmF32);
        assert_eq!(u16::from_le_bytes([h[20], h[21]]), 3);
        assert_eq!(u16::from_le_bytes([h[34], h[35]]), 32);
    }

    #[test]
    fn an_oversized_file_clamps_instead_of_wrapping() {
        // A 5 GB source cannot be described by a 32-bit RIFF size. Wrapping
        // would produce a header claiming a few hundred megabytes of garbage.
        let h = header(5_000_000_000, 2, 44100, Codec::PcmI16);
        assert_eq!(
            u32::from_le_bytes([h[40], h[41], h[42], h[43]]),
            u32::MAX
        );
    }

    #[test]
    fn stream_length_is_the_header_plus_the_samples() {
        assert_eq!(stream_len(&info(Codec::PcmI16, Endian::Big, 2, 1000)), 1044);
    }

    #[test]
    fn big_endian_16_bit_is_swapped_in_pairs() {
        let mut buf = vec![0x12, 0x34, 0x56, 0x78];
        convert_samples(&mut buf, Codec::PcmI16, Endian::Big, 0);
        assert_eq!(buf, vec![0x34, 0x12, 0x78, 0x56]);
    }

    #[test]
    fn big_endian_24_bit_is_swapped_in_triples() {
        let mut buf = vec![1, 2, 3, 4, 5, 6];
        convert_samples(&mut buf, Codec::PcmI24, Endian::Big, 0);
        assert_eq!(buf, vec![3, 2, 1, 6, 5, 4]);
    }

    #[test]
    fn little_endian_data_is_left_alone() {
        let mut buf = vec![0x12, 0x34, 0x56, 0x78];
        let before = buf.clone();
        convert_samples(&mut buf, Codec::PcmI16, Endian::Little, 0);
        assert_eq!(buf, before);
    }

    #[test]
    fn a_range_starting_mid_sample_only_swaps_whole_samples() {
        // Seeking to an odd byte offset must not shuffle bytes belonging to two
        // different samples together.
        let mut buf = vec![0xAA, 0x11, 0x22, 0x33, 0x44];
        convert_samples(&mut buf, Codec::PcmI16, Endian::Big, 1);
        // The leading orphan byte stays put; the two whole samples after it swap.
        assert_eq!(buf, vec![0xAA, 0x22, 0x11, 0x44, 0x33]);
    }

    #[test]
    fn eight_bit_aiff_is_converted_to_unsigned() {
        let mut buf = vec![0x00, 0x7F, 0x80, 0xFF];
        convert_samples(&mut buf, Codec::PcmU8, Endian::Big, 0);
        assert_eq!(buf, vec![0x80, 0xFF, 0x00, 0x7F]);
    }

    #[test]
    fn conversion_never_changes_the_byte_count() {
        // Range arithmetic in the server depends on this being true for every
        // codec, so assert it directly.
        for codec in [
            Codec::PcmU8,
            Codec::PcmI16,
            Codec::PcmI24,
            Codec::PcmI32,
            Codec::PcmF32,
            Codec::PcmF64,
        ] {
            let mut buf = vec![0u8; 97]; // deliberately not a multiple of any width
            let before = buf.len();
            convert_samples(&mut buf, codec, Endian::Big, 3);
            assert_eq!(buf.len(), before, "{codec:?} changed the buffer length");
        }
    }
}
