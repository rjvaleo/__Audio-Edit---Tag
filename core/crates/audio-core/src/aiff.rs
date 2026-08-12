//! Writing AIFF, with room for the settings that made the sound.
//!
//! Exports are AIFF rather than WAV because that is what the library is, and
//! because AIFF has somewhere to put the settings: a `FORM` is a list of
//! chunks, a reader must skip the ones it does not know, and an `APPL` chunk is
//! the standard place for an application to keep its own. So a stretched export
//! carries the engine, the ratio, the pitch, the window and every extended
//! control that produced it, and the file itself is the preset.
//!
//! Nothing here reads. The reader lives in `probe.rs` and already walks chunks
//! and ignores what it does not recognise, which is what makes this safe to add
//! to files it will later open.

use crate::Codec;

/// The four-character signature on our `APPL` chunk.
///
/// A reader looking for these settings finds the chunk by this, so it is a
/// promise: changing it orphans every file already written.
pub const SIGNATURE: [u8; 4] = *b"AuLb";

/// Text and settings to write before the sound.
#[derive(Debug, Default, Clone)]
pub struct Meta {
    /// `NAME` — what the sound is.
    pub name: Option<String>,
    /// `ANNO` — free text. Written so that something opening this file in
    /// another editor sees why it is the length it is, rather than nothing.
    pub annotation: Option<String>,
    /// `APPL` — ours. The settings, as a preset would hold them.
    pub settings: Option<String>,
}

impl Meta {
    pub fn is_empty(&self) -> bool {
        self.name.is_none() && self.annotation.is_none() && self.settings.is_none()
    }
}

/// A chunk's total footprint: header, payload, and the pad byte an odd payload
/// takes. Chunks are two-byte aligned and the pad is not counted in the size.
fn chunk_len(payload: usize) -> u64 {
    8 + payload as u64 + (payload % 2) as u64
}

fn push_chunk(out: &mut Vec<u8>, id: &[u8; 4], payload: &[u8]) {
    out.extend_from_slice(id);
    out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    out.extend_from_slice(payload);
    if payload.len() % 2 == 1 {
        out.push(0);
    }
}

/// Is this codec AIFC rather than plain AIFF?
///
/// AIFF proper is big-endian integer PCM and nothing else. Float needs the
/// compressed variant, which is the same file with a version chunk and a
/// four-character type — `fl32` here.
fn needs_aifc(codec: Codec) -> bool {
    matches!(codec, Codec::PcmF32 | Codec::PcmF64)
}

fn bits_for(codec: Codec) -> u16 {
    match codec {
        Codec::PcmI16 => 16,
        Codec::PcmI24 => 24,
        Codec::PcmF32 => 32,
        Codec::PcmF64 => 64,
        _ => 16,
    }
}

fn compression_for(codec: Codec) -> ([u8; 4], &'static str) {
    match codec {
        Codec::PcmF32 => (*b"fl32", "32-bit floating point"),
        Codec::PcmF64 => (*b"fl64", "64-bit floating point"),
        _ => (*b"NONE", "not compressed"),
    }
}

/// The whole header, up to and including the `SSND` chunk's own header.
///
/// `data_len` is the byte length of the sample data that will follow. The
/// caller writes exactly that many bytes next, big-endian, and the file is
/// complete — there is nothing to go back and patch.
pub fn header(
    data_len: u64,
    channels: u16,
    sample_rate: u32,
    codec: Codec,
    meta: &Meta,
) -> Vec<u8> {
    let channels = channels.max(1);
    let bits = bits_for(codec);
    let bytes_per_frame = (bits as u64 / 8) * channels as u64;
    let frames = if bytes_per_frame > 0 { data_len / bytes_per_frame } else { 0 };
    let aifc = needs_aifc(codec);

    // COMM: channels, frames, bit depth, rate — plus the compression type and
    // its name, as a Pascal string, when this is AIFC.
    let mut comm = Vec::with_capacity(40);
    comm.extend_from_slice(&(channels as i16).to_be_bytes());
    comm.extend_from_slice(&(frames as u32).to_be_bytes());
    comm.extend_from_slice(&(bits as i16).to_be_bytes());
    comm.extend_from_slice(&encode_extended80(sample_rate as f64));
    if aifc {
        let (tag, name) = compression_for(codec);
        comm.extend_from_slice(&tag);
        comm.push(name.len() as u8);
        comm.extend_from_slice(name.as_bytes());
        if comm.len() % 2 == 1 {
            comm.push(0);
        }
    }

    let mut chunks: Vec<u8> = Vec::new();
    if aifc {
        // The format version every AIFC reader checks for.
        push_chunk(&mut chunks, b"FVER", &0xA280_5140u32.to_be_bytes());
    }
    push_chunk(&mut chunks, b"COMM", &comm);
    if let Some(n) = &meta.name {
        push_chunk(&mut chunks, b"NAME", n.as_bytes());
    }
    if let Some(a) = &meta.annotation {
        push_chunk(&mut chunks, b"ANNO", a.as_bytes());
    }
    if let Some(s) = &meta.settings {
        // An APPL payload begins with the application's signature; everything
        // after it is ours.
        let mut appl = Vec::with_capacity(4 + s.len());
        appl.extend_from_slice(&SIGNATURE);
        appl.extend_from_slice(s.as_bytes());
        push_chunk(&mut chunks, b"APPL", &appl);
    }

    // SSND's payload is an offset and a block size — both zero, meaning the
    // samples start immediately and are not aligned to anything — then the
    // samples themselves.
    let ssnd_payload = 8 + data_len;

    // FORM's size counts everything after its own eight bytes.
    let form_len = 4 + chunks.len() as u64 + chunk_len(ssnd_payload as usize);

    let mut out = Vec::with_capacity(chunks.len() + 32);
    out.extend_from_slice(b"FORM");
    out.extend_from_slice(&(form_len as u32).to_be_bytes());
    out.extend_from_slice(if aifc { b"AIFC" } else { b"AIFF" });
    out.extend_from_slice(&chunks);
    out.extend_from_slice(b"SSND");
    out.extend_from_slice(&(ssnd_payload as u32).to_be_bytes());
    out.extend_from_slice(&0u32.to_be_bytes()); // offset
    out.extend_from_slice(&0u32.to_be_bytes()); // block size
    out
}

/// The sample rate, as the 80-bit extended float AIFF stores it.
///
/// Ten bytes: a sign and fifteen exponent bits, then a 64-bit mantissa whose
/// leading one is explicit — unlike IEEE doubles, where it is implied. That
/// explicit bit is the part that catches people out.
pub fn encode_extended80(value: f64) -> [u8; 10] {
    let mut out = [0u8; 10];
    if value <= 0.0 || !value.is_finite() {
        return out;
    }
    // Normalise into [0.5, 1) and count the doublings it took.
    let mut exp: i32 = 0;
    let mut m = value;
    while m >= 1.0 {
        m /= 2.0;
        exp += 1;
    }
    while m < 0.5 {
        m *= 2.0;
        exp -= 1;
    }
    // 16383 is the bias; the extra one is because the mantissa is written with
    // its leading bit set rather than implied.
    let biased = (exp - 1 + 16383) as u16;
    let mantissa = (m * 2f64.powi(64)) as u64;
    out[..2].copy_from_slice(&biased.to_be_bytes());
    out[2..].copy_from_slice(&mantissa.to_be_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The decoder in `probe.rs`, so the two are tested against each other
    /// rather than against my arithmetic twice.
    fn decode(b: &[u8; 10]) -> u32 {
        let exponent = u16::from_be_bytes([b[0], b[1]]) & 0x7FFF;
        let mantissa = u64::from_be_bytes([b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9]]);
        if exponent == 0 && mantissa == 0 {
            return 0;
        }
        let scale = (exponent as i32) - 16383 - 63;
        (mantissa as f64 * (2f64).powi(scale)).round() as u32
    }

    #[test]
    fn the_rate_survives_the_trip_into_eighty_bits_and_back() {
        for rate in [8000u32, 11025, 22050, 32000, 44100, 48000, 88200, 96000, 176400, 192000] {
            assert_eq!(decode(&encode_extended80(rate as f64)), rate, "at {rate} Hz");
        }
    }

    #[test]
    fn forty_four_one_is_the_bit_pattern_everyone_elses_files_have() {
        // 400E AC44 0000 0000 0000 — worth pinning literally, because a wrong
        // exponent still round-trips through my own decoder.
        assert_eq!(
            encode_extended80(44_100.0),
            [0x40, 0x0E, 0xAC, 0x44, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
        );
        assert_eq!(
            encode_extended80(48_000.0),
            [0x40, 0x0E, 0xBB, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
        );
    }

    #[test]
    fn nothing_sensible_out_of_nothing_sensible() {
        assert_eq!(encode_extended80(0.0), [0u8; 10]);
        assert_eq!(encode_extended80(-1.0), [0u8; 10]);
        assert_eq!(encode_extended80(f64::NAN), [0u8; 10]);
    }

    #[test]
    fn a_plain_header_says_aiff_and_counts_its_frames() {
        let h = header(1000 * 2 * 2, 2, 44_100, Codec::PcmI16, &Meta::default());
        assert_eq!(&h[0..4], b"FORM");
        assert_eq!(&h[8..12], b"AIFF");
        // COMM comes first when there is no version chunk.
        assert_eq!(&h[12..16], b"COMM");
        let comm = &h[20..];
        assert_eq!(i16::from_be_bytes([comm[0], comm[1]]), 2, "channels");
        assert_eq!(u32::from_be_bytes([comm[2], comm[3], comm[4], comm[5]]), 1000, "frames");
        assert_eq!(i16::from_be_bytes([comm[6], comm[7]]), 16, "bits");
        // SSND's own tail is id, size, offset and block size: sixteen bytes.
        assert_eq!(&h[h.len() - 16..h.len() - 12], b"SSND");
    }

    #[test]
    fn float_is_written_as_aifc_with_a_version_chunk() {
        let h = header(400, 1, 48_000, Codec::PcmF32, &Meta::default());
        assert_eq!(&h[8..12], b"AIFC");
        assert_eq!(&h[12..16], b"FVER", "AIFC without FVER is refused by some readers");
        assert!(
            h.windows(4).any(|w| w == b"fl32"),
            "the compression type is missing"
        );
    }

    #[test]
    fn the_form_size_accounts_for_every_chunk_and_the_samples() {
        let data = 1234u64; // odd, so SSND takes a pad byte
        let meta = Meta {
            name: Some("kick".into()),
            annotation: Some("hello".into()),
            settings: Some("{\"a\":1}".into()),
        };
        let h = header(data, 1, 44_100, Codec::PcmI16, &meta);
        let form = u32::from_be_bytes([h[4], h[5], h[6], h[7]]) as u64;
        // Everything after FORM's own eight bytes: what the header holds, plus
        // the samples, plus SSND's pad.
        let want = (h.len() as u64 - 8) + data + (data % 2);
        assert_eq!(form, want, "a reader would walk off the end of the file");
    }

    #[test]
    fn the_settings_ride_in_an_appl_chunk_behind_our_signature() {
        let meta = Meta { settings: Some("{\"ratio\":2}".into()), ..Meta::default() };
        let h = header(100, 1, 44_100, Codec::PcmI16, &meta);
        let at = h.windows(4).position(|w| w == b"APPL").expect("no APPL chunk");
        let size = u32::from_be_bytes([h[at + 4], h[at + 5], h[at + 6], h[at + 7]]) as usize;
        assert_eq!(&h[at + 8..at + 12], &SIGNATURE, "the signature must come first");
        let body = std::str::from_utf8(&h[at + 12..at + 8 + size]).unwrap();
        assert_eq!(body, "{\"ratio\":2}");
    }

    #[test]
    fn an_odd_length_chunk_is_padded_but_does_not_count_the_pad() {
        // "abc" is three bytes; the chunk says 3 and occupies 4.
        let meta = Meta { name: Some("abc".into()), ..Meta::default() };
        let h = header(100, 1, 44_100, Codec::PcmI16, &meta);
        let at = h.windows(4).position(|w| w == b"NAME").unwrap();
        assert_eq!(u32::from_be_bytes([h[at + 4], h[at + 5], h[at + 6], h[at + 7]]), 3);
        assert_eq!(h[at + 11], 0, "the pad byte is missing");
        assert_eq!(&h[at + 12..at + 16], b"SSND", "the next chunk is misaligned");
    }
}
