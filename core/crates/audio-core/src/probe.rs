//! Container identification.
//!
//! Chunk walking is done by seeking, never by assuming a layout. Real files put
//! `LIST`, `bext` and `JUNK` ahead of the chunks that matter, and a parser that
//! reads `fmt ` from a fixed offset silently produces garbage.

use crate::source::RandomAccessSource;
use std::fmt;
use std::io;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Container {
    Wav,
    Aiff,
    Aifc,
    /// Headerless PCM. Specs are a guess and should be treated as such.
    Raw,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Codec {
    PcmU8,
    PcmI16,
    PcmI24,
    PcmI32,
    PcmF32,
    PcmF64,
}

impl Codec {
    /// Bytes occupied by one sample of one channel.
    pub fn bytes_per_sample(self) -> usize {
        match self {
            Codec::PcmU8 => 1,
            Codec::PcmI16 => 2,
            Codec::PcmI24 => 3,
            Codec::PcmI32 | Codec::PcmF32 => 4,
            Codec::PcmF64 => 8,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Endian {
    Little,
    Big,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AudioInfo {
    pub container: Container,
    pub codec: Codec,
    pub endian: Endian,
    pub sample_rate: u32,
    pub channels: u16,
    pub bits: u16,
    /// Byte offset of the first sample.
    pub data_offset: u64,
    /// Length of sample data in bytes, always a whole number of frames.
    pub data_len: u64,
}

impl AudioInfo {
    pub fn bytes_per_frame(&self) -> usize {
        self.codec.bytes_per_sample() * self.channels as usize
    }

    pub fn frames(&self) -> u64 {
        let bpf = self.bytes_per_frame() as u64;
        if bpf == 0 {
            0
        } else {
            self.data_len / bpf
        }
    }

    pub fn duration_secs(&self) -> f64 {
        if self.sample_rate == 0 {
            0.0
        } else {
            self.frames() as f64 / self.sample_rate as f64
        }
    }
}

#[derive(Debug)]
pub enum ProbeError {
    Empty,
    /// The container was recognised but is missing something required.
    Malformed(&'static str),
    /// Recognised container, but the sample encoding is not supported.
    UnsupportedCodec(String),
    Io(io::Error),
}

impl fmt::Display for ProbeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProbeError::Empty => write!(f, "file is empty"),
            ProbeError::Malformed(m) => write!(f, "malformed: {m}"),
            ProbeError::UnsupportedCodec(c) => write!(f, "unsupported codec: {c}"),
            ProbeError::Io(e) => write!(f, "io error: {e}"),
        }
    }
}

impl std::error::Error for ProbeError {}

impl From<io::Error> for ProbeError {
    fn from(e: io::Error) -> Self {
        ProbeError::Io(e)
    }
}

type Result<T> = std::result::Result<T, ProbeError>;

/// Assumed specs for headerless data, matching the archive's dominant format.
const RAW_SAMPLE_RATE: u32 = 44100;
const RAW_CHANNELS: u16 = 2;
const RAW_BITS: u16 = 16;

pub fn probe<S: RandomAccessSource + ?Sized>(src: &mut S) -> Result<AudioInfo> {
    let len = src.len()?;
    if len == 0 {
        return Err(ProbeError::Empty);
    }

    let head = src.read_upto(0, 12)?;
    if head.len() >= 12 {
        if &head[0..4] == b"RIFF" && &head[8..12] == b"WAVE" {
            return probe_wav(src, len);
        }
        if &head[0..4] == b"FORM" {
            if &head[8..12] == b"AIFF" {
                return probe_aiff(src, len, Container::Aiff);
            }
            if &head[8..12] == b"AIFC" {
                return probe_aiff(src, len, Container::Aifc);
            }
        }
    }
    Ok(raw_info(len))
}

/// Headerless PCM, with the trailing partial frame discarded.
pub fn raw_info(len: u64) -> AudioInfo {
    let bpf = (RAW_BITS as u64 / 8) * RAW_CHANNELS as u64;
    AudioInfo {
        container: Container::Raw,
        codec: Codec::PcmI16,
        endian: Endian::Little,
        sample_rate: RAW_SAMPLE_RATE,
        channels: RAW_CHANNELS,
        bits: RAW_BITS,
        data_offset: 0,
        data_len: (len / bpf) * bpf,
    }
}

/// Walk chunks, calling `visit` with (id, payload offset, payload size).
/// Returning `true` from `visit` stops the walk.
fn walk_chunks<S, F>(src: &mut S, start: u64, end: u64, big_endian: bool, mut visit: F) -> Result<()>
where
    S: RandomAccessSource + ?Sized,
    F: FnMut(&mut S, [u8; 4], u64, u64) -> Result<bool>,
{
    let mut off = start;
    while off + 8 <= end {
        let mut hdr = [0u8; 8];
        if src.read_at(off, &mut hdr)? < 8 {
            break;
        }
        let id = [hdr[0], hdr[1], hdr[2], hdr[3]];
        let size = if big_endian {
            u32::from_be_bytes([hdr[4], hdr[5], hdr[6], hdr[7]])
        } else {
            u32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]])
        } as u64;

        let payload = off + 8;
        // Writers that stream sometimes leave the final size as 0 or 0xFFFFFFFF.
        // Clamp rather than trusting it, so a truncated file still opens.
        let avail = end.saturating_sub(payload);
        let clamped = size.min(avail);

        if visit(src, id, payload, clamped)? {
            return Ok(());
        }

        if size == 0 {
            // A zero-size chunk cannot advance the cursor; stop rather than spin.
            break;
        }
        off = payload + size + (size & 1);
    }
    Ok(())
}

fn probe_wav<S: RandomAccessSource + ?Sized>(src: &mut S, len: u64) -> Result<AudioInfo> {
    let mut fmt_tag = 0u16;
    let mut channels = 0u16;
    let mut sample_rate = 0u32;
    let mut bits = 0u16;
    let mut data: Option<(u64, u64)> = None;

    walk_chunks(src, 12, len, false, |s, id, off, size| {
        match &id {
            b"fmt " => {
                let buf = s.read_upto(off, size.min(40) as usize)?;
                if buf.len() < 16 {
                    return Err(ProbeError::Malformed("fmt chunk shorter than 16 bytes"));
                }
                fmt_tag = u16::from_le_bytes([buf[0], buf[1]]);
                channels = u16::from_le_bytes([buf[2], buf[3]]);
                sample_rate = u32::from_le_bytes([buf[4], buf[5], buf[6], buf[7]]);
                bits = u16::from_le_bytes([buf[14], buf[15]]);
                if fmt_tag == 0xFFFE {
                    // EXTENSIBLE: the real format tag is the first two bytes of
                    // the SubFormat GUID at offset 24.
                    if buf.len() >= 26 {
                        fmt_tag = u16::from_le_bytes([buf[24], buf[25]]);
                    } else {
                        return Err(ProbeError::Malformed("extensible fmt chunk truncated"));
                    }
                }
            }
            b"data" => {
                data = Some((off, size));
                return Ok(true); // everything needed is known; stop walking
            }
            _ => {}
        }
        Ok(false)
    })?;

    let (data_offset, data_size) = data.ok_or(ProbeError::Malformed("no data chunk"))?;
    if channels == 0 || sample_rate == 0 {
        return Err(ProbeError::Malformed("no usable fmt chunk"));
    }

    let codec = match (fmt_tag, bits) {
        (1, 8) => Codec::PcmU8,
        (1, 16) => Codec::PcmI16,
        (1, 24) => Codec::PcmI24,
        (1, 32) => Codec::PcmI32,
        (3, 32) => Codec::PcmF32,
        (3, 64) => Codec::PcmF64,
        (t, b) => return Err(ProbeError::UnsupportedCodec(format!("wav tag {t}, {b} bits"))),
    };

    Ok(finish(AudioInfo {
        container: Container::Wav,
        codec,
        endian: Endian::Little,
        sample_rate,
        channels,
        bits,
        data_offset,
        data_len: data_size,
    }))
}

fn probe_aiff<S: RandomAccessSource + ?Sized>(
    src: &mut S,
    len: u64,
    container: Container,
) -> Result<AudioInfo> {
    let mut channels = 0u16;
    let mut bits = 0u16;
    let mut sample_rate = 0u32;
    let mut compression = *b"NONE";
    let mut data: Option<(u64, u64)> = None;

    walk_chunks(src, 12, len, true, |s, id, off, size| {
        match &id {
            b"COMM" => {
                let buf = s.read_upto(off, size.min(40) as usize)?;
                if buf.len() < 18 {
                    return Err(ProbeError::Malformed("COMM chunk shorter than 18 bytes"));
                }
                channels = i16::from_be_bytes([buf[0], buf[1]]).max(0) as u16;
                bits = i16::from_be_bytes([buf[6], buf[7]]).max(0) as u16;
                let mut ext = [0u8; 10];
                ext.copy_from_slice(&buf[8..18]);
                sample_rate = decode_extended80(&ext);
                if container == Container::Aifc && buf.len() >= 22 {
                    compression = [buf[18], buf[19], buf[20], buf[21]];
                }
            }
            b"SSND" => {
                // Payload begins with offset and block-size, then the samples.
                let buf = s.read_upto(off, 8)?;
                if buf.len() < 8 {
                    return Err(ProbeError::Malformed("SSND chunk truncated"));
                }
                let skip = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]) as u64;
                data = Some((off + 8 + skip, size.saturating_sub(8 + skip)));
            }
            _ => {}
        }
        Ok(false)
    })?;

    let (data_offset, data_size) = data.ok_or(ProbeError::Malformed("no SSND chunk"))?;
    if channels == 0 || sample_rate == 0 {
        return Err(ProbeError::Malformed("no usable COMM chunk"));
    }

    // 'sowt' is 'twos' spelled backwards and means the samples are already
    // little-endian. Byte-swapping them again is the classic AIFC bug.
    let (codec, endian) = match (&compression, bits) {
        (b"sowt" | b"SOWT", 16) => (Codec::PcmI16, Endian::Little),
        (b"sowt" | b"SOWT", 24) => (Codec::PcmI24, Endian::Little),
        (b"sowt" | b"SOWT", 32) => (Codec::PcmI32, Endian::Little),
        (b"fl32" | b"FL32", _) => (Codec::PcmF32, Endian::Big),
        (b"fl64" | b"FL64", _) => (Codec::PcmF64, Endian::Big),
        (b"NONE" | b"twos" | b"TWOS" | b"in24" | b"in32", 8) => (Codec::PcmU8, Endian::Big),
        (b"NONE" | b"twos" | b"TWOS" | b"in24" | b"in32", 16) => (Codec::PcmI16, Endian::Big),
        (b"NONE" | b"twos" | b"TWOS" | b"in24" | b"in32", 24) => (Codec::PcmI24, Endian::Big),
        (b"NONE" | b"twos" | b"TWOS" | b"in24" | b"in32", 32) => (Codec::PcmI32, Endian::Big),
        (c, b) => {
            return Err(ProbeError::UnsupportedCodec(format!(
                "aiff {}, {b} bits",
                String::from_utf8_lossy(c)
            )))
        }
    };

    Ok(finish(AudioInfo {
        container,
        codec,
        endian,
        sample_rate,
        channels,
        bits,
        data_offset,
        data_len: data_size,
    }))
}

/// Round the data length down to a whole number of frames.
fn finish(mut info: AudioInfo) -> AudioInfo {
    let bpf = info.bytes_per_frame() as u64;
    if bpf > 0 {
        info.data_len = (info.data_len / bpf) * bpf;
    }
    info
}

/// Decode an 80-bit IEEE-754 extended value to a sample rate in Hz.
///
/// Unlike the 32- and 64-bit forms, the mantissa's leading integer bit is
/// stored explicitly, so there is no implicit 1 to add back.
fn decode_extended80(b: &[u8; 10]) -> u32 {
    let exponent = u16::from_be_bytes([b[0], b[1]]) & 0x7FFF;
    let mantissa = u64::from_be_bytes([b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9]]);
    if exponent == 0 && mantissa == 0 {
        return 0;
    }
    let scale = (exponent as i32) - 16383 - 63;
    let value = mantissa as f64 * (2f64).powi(scale);
    if !value.is_finite() || value < 0.0 || value > u32::MAX as f64 {
        return 0;
    }
    // Round rather than truncate: the round trip lands a hair under the integer
    // often enough that truncation would report 44099 Hz.
    value.round() as u32
}
