//! Decoding to f32, peak tiles, and whole-file statistics.
//!
//! Nothing here loads a file into memory. Every operation streams in blocks, so
//! a two-hour recording costs the same working set as a one-second one.

use crate::probe::{AudioInfo, Codec, Endian};
use crate::source::RandomAccessSource;
use std::io;

/// Frames pulled from disk per block while scanning. At 2 channels of 16-bit
/// this is 256 KB, which is comfortably larger than any realistic seek cost and
/// small enough to stay in cache.
const BLOCK_FRAMES: usize = 65536;

/// One column of a waveform display, for one channel.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Column {
    pub min: f32,
    pub max: f32,
    pub rms: f32,
}

/// A decimated waveform, laid out channel-major: all of channel 0's columns,
/// then all of channel 1's.
///
/// Min and max are kept separately rather than averaged because a single-sample
/// transient in a million frames must still be visible after decimation.
#[derive(Debug, Clone)]
pub struct PeakTile {
    pub channels: usize,
    pub columns: usize,
    pub data: Vec<Column>,
}

impl PeakTile {
    pub fn channel(&self, ch: usize) -> &[Column] {
        let start = ch * self.columns;
        &self.data[start..start + self.columns]
    }
}

/// Whole-file measurements.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Stats {
    pub peak: f32,
    pub peak_dbfs: f32,
    pub rms: f32,
    pub rms_dbfs: f32,
    /// Pearson correlation between the first two channels, or `None` if mono.
    /// +1 is identical, 0 uncorrelated, -1 cancels to silence in mono.
    pub correlation: Option<f32>,
    /// True when every channel carries bit-identical samples.
    pub dual_mono: bool,
    pub clipped_samples: u64,
}

/// Reads samples from a probed source.
pub struct Reader<S: RandomAccessSource> {
    src: S,
    info: AudioInfo,
}

impl<S: RandomAccessSource> Reader<S> {
    pub fn new(src: S, info: AudioInfo) -> Self {
        Self { src, info }
    }

    pub fn info(&self) -> &AudioInfo {
        &self.info
    }

    pub fn into_source(self) -> S {
        self.src
    }

    /// Decode `count` frames starting at `start`, interleaved.
    ///
    /// A short result means the source ended; that is not an error.
    pub fn read_frames(&mut self, start: u64, count: u64) -> io::Result<Vec<f32>> {
        let total = self.info.frames();
        if start >= total || count == 0 {
            return Ok(Vec::new());
        }
        let count = count.min(total - start);
        let bpf = self.info.bytes_per_frame();
        let byte_off = self.info.data_offset + start * bpf as u64;
        let byte_len = (count as usize) * bpf;

        let mut raw = vec![0u8; byte_len];
        let got = read_fully(&mut self.src, byte_off, &mut raw)?;
        raw.truncate(got - (got % bpf));

        Ok(decode_block(&raw, self.info.codec, self.info.endian))
    }

    /// Build a waveform tile of `columns` columns covering `[start, start+count)`.
    ///
    /// The column count is capped at the frame count so a very short file never
    /// produces empty columns.
    pub fn peak_tile(&mut self, start: u64, count: u64, columns: usize) -> io::Result<PeakTile> {
        let total = self.info.frames();
        let start = start.min(total);
        let count = count.min(total - start);
        let channels = self.info.channels as usize;
        let columns = columns.max(1).min(count.max(1) as usize);

        let mut mins = vec![f32::INFINITY; columns * channels];
        let mut maxs = vec![f32::NEG_INFINITY; columns * channels];
        let mut sums = vec![0f64; columns * channels];
        let mut counts = vec![0u64; columns];

        self.for_each_block(start, count, |frame_base, block| {
            let frames_in_block = block.len() / channels;
            for f in 0..frames_in_block {
                // Which column this frame lands in. Done per frame rather than
                // per block so column boundaries stay exact.
                let rel = frame_base + f as u64 - start;
                let col = ((rel as u128 * columns as u128) / count.max(1) as u128) as usize;
                let col = col.min(columns - 1);
                counts[col] += 1;
                for ch in 0..channels {
                    let v = block[f * channels + ch];
                    let idx = ch * columns + col;
                    if v < mins[idx] {
                        mins[idx] = v;
                    }
                    if v > maxs[idx] {
                        maxs[idx] = v;
                    }
                    sums[idx] += (v as f64) * (v as f64);
                }
            }
        })?;

        let mut data = Vec::with_capacity(columns * channels);
        for ch in 0..channels {
            for col in 0..columns {
                let idx = ch * columns + col;
                let n = counts[col];
                if n == 0 {
                    data.push(Column {
                        min: 0.0,
                        max: 0.0,
                        rms: 0.0,
                    });
                } else {
                    data.push(Column {
                        min: if mins[idx].is_finite() { mins[idx] } else { 0.0 },
                        max: if maxs[idx].is_finite() { maxs[idx] } else { 0.0 },
                        rms: (sums[idx] / n as f64).sqrt() as f32,
                    });
                }
            }
        }

        Ok(PeakTile {
            channels,
            columns,
            data,
        })
    }

    /// Measure the whole file in one pass.
    pub fn stats(&mut self) -> io::Result<Stats> {
        let channels = self.info.channels as usize;
        let total = self.info.frames();

        let mut peak = 0f32;
        let mut sum_sq = 0f64;
        let mut n = 0u64;
        let mut clipped = 0u64;
        // Accumulators for the correlation of channels 0 and 1.
        let (mut sum_ab, mut sum_aa, mut sum_bb) = (0f64, 0f64, 0f64);
        let mut dual_mono = channels > 1;

        self.for_each_block(0, total, |_, block| {
            let frames_in_block = block.len() / channels;
            for f in 0..frames_in_block {
                let base = f * channels;
                for ch in 0..channels {
                    let v = block[base + ch];
                    let a = v.abs();
                    if a > peak {
                        peak = a;
                    }
                    if a >= 1.0 {
                        clipped += 1;
                    }
                    sum_sq += (v as f64) * (v as f64);
                    n += 1;
                }
                if channels > 1 {
                    let a = block[base] as f64;
                    let b = block[base + 1] as f64;
                    sum_ab += a * b;
                    sum_aa += a * a;
                    sum_bb += b * b;
                    if dual_mono && block[base..base + channels].iter().any(|&v| v != block[base]) {
                        dual_mono = false;
                    }
                }
            }
        })?;

        let rms = if n == 0 {
            0.0
        } else {
            (sum_sq / n as f64).sqrt() as f32
        };
        let correlation = if channels > 1 {
            let denom = (sum_aa * sum_bb).sqrt();
            // Two silent channels are not meaningfully correlated; report 0
            // rather than dividing by zero.
            Some(if denom > 0.0 {
                (sum_ab / denom).clamp(-1.0, 1.0) as f32
            } else {
                0.0
            })
        } else {
            None
        };

        Ok(Stats {
            peak,
            peak_dbfs: to_dbfs(peak),
            rms,
            rms_dbfs: to_dbfs(rms),
            correlation,
            dual_mono: dual_mono && channels > 1,
            clipped_samples: clipped,
        })
    }

    /// Stream `[start, start+count)` in blocks, handing each to `f` along with
    /// the absolute frame index the block begins at.
    fn for_each_block<F>(&mut self, start: u64, count: u64, mut f: F) -> io::Result<()>
    where
        F: FnMut(u64, &[f32]),
    {
        let bpf = self.info.bytes_per_frame();
        let mut done = 0u64;
        let mut raw = vec![0u8; BLOCK_FRAMES * bpf];

        while done < count {
            let want = ((count - done) as usize).min(BLOCK_FRAMES);
            let byte_off = self.info.data_offset + (start + done) * bpf as u64;
            let slice = &mut raw[..want * bpf];
            let got = read_fully(&mut self.src, byte_off, slice)?;
            let whole = got - (got % bpf);
            if whole == 0 {
                break;
            }
            let block = decode_block(&slice[..whole], self.info.codec, self.info.endian);
            f(start + done, &block);
            done += (whole / bpf) as u64;
            if whole < slice.len() {
                break; // source ended early
            }
        }
        Ok(())
    }
}

fn read_fully<S: RandomAccessSource + ?Sized>(
    src: &mut S,
    offset: u64,
    buf: &mut [u8],
) -> io::Result<usize> {
    let mut done = 0;
    while done < buf.len() {
        let n = src.read_at(offset + done as u64, &mut buf[done..])?;
        if n == 0 {
            break;
        }
        done += n;
    }
    Ok(done)
}

fn to_dbfs(v: f32) -> f32 {
    if v <= 0.0 {
        f32::NEG_INFINITY
    } else {
        20.0 * v.log10()
    }
}

/// Convert raw sample bytes to f32 in [-1, 1].
///
/// Integer formats divide by 2^(bits-1) rather than by the maximum positive
/// value, which keeps the mapping symmetric and guarantees the result never
/// exceeds unity.
fn decode_block(raw: &[u8], codec: Codec, endian: Endian) -> Vec<f32> {
    let big = endian == Endian::Big;
    match codec {
        Codec::PcmU8 => raw
            .iter()
            .map(|&b| (b as f32 - 128.0) / 128.0)
            .collect(),
        Codec::PcmI16 => raw
            .chunks_exact(2)
            .map(|c| {
                let v = if big {
                    i16::from_be_bytes([c[0], c[1]])
                } else {
                    i16::from_le_bytes([c[0], c[1]])
                };
                v as f32 / 32768.0
            })
            .collect(),
        Codec::PcmI24 => raw
            .chunks_exact(3)
            .map(|c| {
                // Sign-extend 24 bits into an i32 by placing the sample in the
                // top three bytes and arithmetic-shifting down.
                let v = if big {
                    i32::from_be_bytes([c[0], c[1], c[2], 0]) >> 8
                } else {
                    i32::from_le_bytes([0, c[0], c[1], c[2]]) >> 8
                };
                v as f32 / 8_388_608.0
            })
            .collect(),
        Codec::PcmI32 => raw
            .chunks_exact(4)
            .map(|c| {
                let v = if big {
                    i32::from_be_bytes([c[0], c[1], c[2], c[3]])
                } else {
                    i32::from_le_bytes([c[0], c[1], c[2], c[3]])
                };
                v as f32 / 2_147_483_648.0
            })
            .collect(),
        Codec::PcmF32 => raw
            .chunks_exact(4)
            .map(|c| {
                let bits = if big {
                    u32::from_be_bytes([c[0], c[1], c[2], c[3]])
                } else {
                    u32::from_le_bytes([c[0], c[1], c[2], c[3]])
                };
                let v = f32::from_bits(bits);
                // A NaN or infinity from a corrupt file would poison every
                // downstream measurement.
                if v.is_finite() {
                    v
                } else {
                    0.0
                }
            })
            .collect(),
        Codec::PcmF64 => raw
            .chunks_exact(8)
            .map(|c| {
                let mut b = [0u8; 8];
                b.copy_from_slice(c);
                let v = if big {
                    f64::from_be_bytes(b)
                } else {
                    f64::from_le_bytes(b)
                };
                if v.is_finite() {
                    v as f32
                } else {
                    0.0
                }
            })
            .collect(),
    }
}
