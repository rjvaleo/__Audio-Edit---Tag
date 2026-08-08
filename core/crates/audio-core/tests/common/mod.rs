//! Byte-level fixture builders.
//!
//! These construct container bytes by hand rather than going through this
//! crate's own writer, so a parser bug and a writer bug cannot cancel out.

#![allow(dead_code)]

pub fn le16(v: u16) -> [u8; 2] {
    v.to_le_bytes()
}
pub fn le32(v: u32) -> [u8; 4] {
    v.to_le_bytes()
}
pub fn be16(v: i16) -> [u8; 2] {
    v.to_be_bytes()
}
pub fn be32(v: u32) -> [u8; 4] {
    v.to_be_bytes()
}

/// A RIFF chunk: 4-byte id, LE u32 size, payload, pad byte to even length.
pub fn riff_chunk(id: &[u8; 4], payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(id);
    out.extend_from_slice(&le32(payload.len() as u32));
    out.extend_from_slice(payload);
    if payload.len() % 2 == 1 {
        out.push(0);
    }
    out
}

/// An IFF chunk: 4-byte id, BE u32 size, payload, pad byte to even length.
pub fn iff_chunk(id: &[u8; 4], payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(id);
    out.extend_from_slice(&be32(payload.len() as u32));
    out.extend_from_slice(payload);
    if payload.len() % 2 == 1 {
        out.push(0);
    }
    out
}

/// Wrap chunks in a RIFF/WAVE container.
pub fn riff_wave(chunks: &[Vec<u8>]) -> Vec<u8> {
    let mut body = b"WAVE".to_vec();
    for c in chunks {
        body.extend_from_slice(c);
    }
    let mut out = b"RIFF".to_vec();
    out.extend_from_slice(&le32(body.len() as u32));
    out.extend_from_slice(&body);
    out
}

/// Wrap chunks in a FORM/AIFF (or AIFC) container.
pub fn form_aiff(form_type: &[u8; 4], chunks: &[Vec<u8>]) -> Vec<u8> {
    let mut body = form_type.to_vec();
    for c in chunks {
        body.extend_from_slice(c);
    }
    let mut out = b"FORM".to_vec();
    out.extend_from_slice(&be32(body.len() as u32));
    out.extend_from_slice(&body);
    out
}

/// A standard 16-byte PCM `fmt ` payload.
/// `audio_format`: 1 = integer PCM, 3 = IEEE float, 0xFFFE = extensible.
pub fn fmt_chunk(audio_format: u16, channels: u16, sample_rate: u32, bits: u16) -> Vec<u8> {
    let block_align = channels * bits / 8;
    let byte_rate = sample_rate * block_align as u32;
    let mut p = Vec::new();
    p.extend_from_slice(&le16(audio_format));
    p.extend_from_slice(&le16(channels));
    p.extend_from_slice(&le32(sample_rate));
    p.extend_from_slice(&le32(byte_rate));
    p.extend_from_slice(&le16(block_align));
    p.extend_from_slice(&le16(bits));
    riff_chunk(b"fmt ", &p)
}

/// A WAVE_FORMAT_EXTENSIBLE `fmt ` payload (40 bytes) carrying a PCM subformat.
pub fn fmt_chunk_extensible(channels: u16, sample_rate: u32, bits: u16, float: bool) -> Vec<u8> {
    let block_align = channels * bits / 8;
    let byte_rate = sample_rate * block_align as u32;
    let mut p = Vec::new();
    p.extend_from_slice(&le16(0xFFFE));
    p.extend_from_slice(&le16(channels));
    p.extend_from_slice(&le32(sample_rate));
    p.extend_from_slice(&le32(byte_rate));
    p.extend_from_slice(&le16(block_align));
    p.extend_from_slice(&le16(bits));
    p.extend_from_slice(&le16(22)); // cbSize
    p.extend_from_slice(&le16(bits)); // valid bits
    p.extend_from_slice(&le32(0)); // channel mask
    // SubFormat GUID: first two bytes are the format tag, then the fixed suffix.
    p.extend_from_slice(&le16(if float { 3 } else { 1 }));
    p.extend_from_slice(&[0x00, 0x00]);
    p.extend_from_slice(&[
        0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71,
    ]);
    riff_chunk(b"fmt ", &p)
}

/// Encode an f64 as an 80-bit IEEE-754 extended value, big-endian.
///
/// AIFF stores the sample rate this way. The mantissa's leading integer bit is
/// stored explicitly rather than implied, which is the detail most naive
/// implementations get wrong.
pub fn extended80(value: f64) -> [u8; 10] {
    let mut out = [0u8; 10];
    if value == 0.0 {
        return out;
    }
    let sign = if value < 0.0 { 0x8000u16 } else { 0 };
    let mut v = value.abs();
    let mut exp = 0i32;
    while v >= 1.0 {
        v /= 2.0;
        exp += 1;
    }
    while v < 0.5 {
        v *= 2.0;
        exp -= 1;
    }
    let biased = (exp + 16382) as u16 | sign;
    let mantissa = (v * (2f64).powi(64)) as u64;
    out[..2].copy_from_slice(&biased.to_be_bytes());
    out[2..].copy_from_slice(&mantissa.to_be_bytes());
    out
}

/// An AIFF `COMM` chunk. `compression` present makes it AIFC-shaped.
pub fn comm_chunk(
    channels: i16,
    frames: u32,
    bits: i16,
    sample_rate: f64,
    compression: Option<&[u8; 4]>,
) -> Vec<u8> {
    let mut p = Vec::new();
    p.extend_from_slice(&channels.to_be_bytes());
    p.extend_from_slice(&be32(frames));
    p.extend_from_slice(&bits.to_be_bytes());
    p.extend_from_slice(&extended80(sample_rate));
    if let Some(c) = compression {
        p.extend_from_slice(c);
        p.push(0); // empty pascal-string compression name
        p.push(0);
    }
    iff_chunk(b"COMM", &p)
}

/// An AIFF `SSND` chunk. Payload is offset + blocksize + samples.
pub fn ssnd_chunk(samples: &[u8]) -> Vec<u8> {
    let mut p = Vec::new();
    p.extend_from_slice(&be32(0)); // offset
    p.extend_from_slice(&be32(0)); // block size
    p.extend_from_slice(samples);
    iff_chunk(b"SSND", &p)
}

// ---------------------------------------------------------------- signals

/// Interleaved sine, amplitude in linear full-scale units (1.0 = 0 dBFS).
pub fn sine_f32(freq: f64, sample_rate: u32, frames: usize, channels: usize, amp: f64) -> Vec<f32> {
    let mut out = Vec::with_capacity(frames * channels);
    for i in 0..frames {
        let t = i as f64 / sample_rate as f64;
        let v = (amp * (2.0 * std::f64::consts::PI * freq * t).sin()) as f32;
        for _ in 0..channels {
            out.push(v);
        }
    }
    out
}

/// Interleave per-channel signals into a single frame-major buffer.
pub fn interleave(channels: &[Vec<f32>]) -> Vec<f32> {
    let frames = channels.iter().map(|c| c.len()).min().unwrap_or(0);
    let mut out = Vec::with_capacity(frames * channels.len());
    for i in 0..frames {
        for ch in channels {
            out.push(ch[i]);
        }
    }
    out
}

/// Quantise f32 samples to little-endian i16 bytes.
pub fn to_i16_le(samples: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 2);
    for &s in samples {
        let v = (s.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

/// Quantise f32 samples to big-endian i16 bytes.
pub fn to_i16_be(samples: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 2);
    for &s in samples {
        let v = (s.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        out.extend_from_slice(&v.to_be_bytes());
    }
    out
}

/// Quantise f32 samples to little-endian 24-bit bytes.
pub fn to_i24_le(samples: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 3);
    for &s in samples {
        let v = (s.clamp(-1.0, 1.0) * 8_388_607.0).round() as i32;
        let b = v.to_le_bytes();
        out.extend_from_slice(&b[..3]);
    }
    out
}

pub fn to_f32_le(samples: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 4);
    for &s in samples {
        out.extend_from_slice(&s.to_le_bytes());
    }
    out
}

/// Assert two floats are within `eps`.
#[track_caller]
pub fn assert_near(actual: f32, expected: f32, eps: f32) {
    assert!(
        (actual - expected).abs() <= eps,
        "expected {expected} +/- {eps}, got {actual}"
    );
}
