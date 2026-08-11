//! Turning an edit list back into samples.
//!
//! This is the only place the source file is read for editing purposes, and it
//! reads — it never writes. Producing a file happens through
//! [`render_to_wav`], which always writes somewhere new.

use crate::EditList;
use audio_core::{wav, Codec, Reader, RandomAccessSource};
use fx::Rack;
use std::io::{self, Write};

/// Render the whole edited timeline, stretched and with the rack applied.
///
/// Stretching cannot be streamed the way filters can: WSOLA chooses each splice
/// from the one before it, so output frame N is not addressable without having
/// produced the frames leading to it. When a stretch is active the whole
/// timeline is rendered once and the caller slices it — which is why the server
/// caches the result rather than recomputing per request.
pub fn render_all_stretched<S: RandomAccessSource>(
    list: &EditList,
    reader: &mut Reader<S>,
    rack: &mut Rack,
) -> io::Result<Vec<f32>> {
    let channels = list.channels.max(1) as usize;
    let base = render(list, reader, 0, list.base_frames())?;
    let mut out = list.stretch.process(&base, channels, list.sample_rate);
    if !rack.is_empty() {
        rack.reset();
        rack.process(&mut out, channels, list.sample_rate);
    }
    Ok(out)
}

/// Render a window and run it through the effect rack.
///
/// The rack is fed `preroll` frames from before the requested range so its
/// filters and envelope followers are settled by the time the window the caller
/// asked for begins. Without it, seeking into the middle of a file restarts
/// every filter from silence, and a windowed render would not match a full one.
pub fn render_fx<S: RandomAccessSource>(
    list: &EditList,
    reader: &mut Reader<S>,
    rack: &mut Rack,
    start: u64,
    count: u64,
) -> io::Result<Vec<f32>> {
    if list.is_stretched() {
        // Callers that can stretch hold the cached buffer; anything reaching
        // here would otherwise get unstretched audio at the wrong length.
        let all = render_all_stretched(list, reader, rack)?;
        let channels = list.channels.max(1) as usize;
        let from = (start as usize * channels).min(all.len());
        let to = ((start + count) as usize * channels).min(all.len());
        return Ok(all[from..to].to_vec());
    }
    if rack.is_empty() {
        return render(list, reader, start, count);
    }
    let channels = list.channels.max(1) as usize;
    let pre = rack.preroll_frames(list.sample_rate).min(start);
    let mut buf = render(list, reader, start - pre, pre + count)?;

    rack.reset();
    rack.process(&mut buf, channels, list.sample_rate);

    let drop = (pre as usize) * channels;
    if drop > 0 && drop <= buf.len() {
        buf.drain(0..drop);
    }
    Ok(buf)
}

/// Render `[start, start+count)` of the edited timeline to interleaved f32.
pub fn render<S: RandomAccessSource>(
    list: &EditList,
    reader: &mut Reader<S>,
    start: u64,
    count: u64,
) -> io::Result<Vec<f32>> {
    let channels = list.channels.max(1) as usize;
    let mut out: Vec<f32> = Vec::with_capacity(count as usize * channels);

    let mut timeline = 0u64;
    for clip in &list.clips {
        let clip_start = timeline;
        let clip_end = timeline + clip.len;
        timeline = clip_end;

        // Skip clips entirely outside the window.
        if clip_end <= start || clip_start >= start + count {
            continue;
        }

        let from = start.max(clip_start);
        let to = (start + count).min(clip_end);
        let offset = from - clip_start; // frames into this clip
        let len = to - from;

        // Inserted silence occupies the timeline without naming any source
        // frames, so there is nothing to read and nothing a gain or fade could
        // usefully be applied to.
        if clip.silent {
            out.resize(out.len() + len as usize * channels, 0.0);
            continue;
        }

        let src_from = if clip.reversed {
            // Reading backwards: the window at `offset` into the clip maps to
            // the source frames counted from the clip's far end.
            clip.src_start + clip.len - offset - len
        } else {
            clip.src_start + offset
        };

        let mut frames = reader.read_frames(src_from, len)?;
        if clip.reversed {
            reverse_frames(&mut frames, channels);
        }

        // A short read means the source is truncated; pad so the timeline
        // length stays what the edit list promised.
        let want = len as usize * channels;
        if frames.len() < want {
            frames.resize(want, 0.0);
        }

        for i in 0..len as usize {
            let pos_in_clip = offset + i as u64;
            let remaining = clip.len - pos_in_clip - 1;
            let g = clip.gain
                * clip.fade_in.gain_in(pos_in_clip)
                * clip.fade_out.gain_out(remaining);
            for ch in 0..channels {
                out.push(frames[i * channels + ch] * g);
            }
        }
    }

    Ok(out)
}

fn reverse_frames(buf: &mut [f32], channels: usize) {
    let frames = buf.len() / channels;
    for i in 0..frames / 2 {
        let j = frames - 1 - i;
        for ch in 0..channels {
            buf.swap(i * channels + ch, j * channels + ch);
        }
    }
}

/// Build a waveform tile over the *edited* timeline.
///
/// Mirrors the source-file peak tile, but the frames come from [`render`], so
/// cuts and fades appear in the display exactly as they will be heard.
pub fn peak_tile<S: RandomAccessSource>(
    list: &EditList,
    reader: &mut Reader<S>,
    start: u64,
    count: u64,
    columns: usize,
) -> io::Result<audio_core::PeakTile> {
    peak_tile_fx(list, reader, &mut Rack::new(), start, count, columns)
}

/// Waveform tile of the edited timeline with the rack applied, so the display
/// shows what will actually be heard.
pub fn peak_tile_fx<S: RandomAccessSource>(
    list: &EditList,
    reader: &mut Reader<S>,
    rack: &mut Rack,
    start: u64,
    count: u64,
    columns: usize,
) -> io::Result<audio_core::PeakTile> {
    let channels = list.channels.max(1) as usize;
    let total = list.frames();
    let start = start.min(total);
    let count = count.min(total - start);
    let columns = columns.max(1).min(count.max(1) as usize);

    let mut mins = vec![f32::INFINITY; columns * channels];
    let mut maxs = vec![f32::NEG_INFINITY; columns * channels];
    let mut sums = vec![0f64; columns * channels];
    let mut counts = vec![0u64; columns];

    const BLOCK: u64 = 65536;
    let mut done = 0u64;
    while done < count {
        let n = BLOCK.min(count - done);
        let block = render_fx(list, reader, rack, start + done, n)?;
        let frames_in_block = block.len() / channels;
        for f in 0..frames_in_block {
            let rel = done + f as u64;
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
        done += n;
    }

    let mut data = Vec::with_capacity(columns * channels);
    for ch in 0..channels {
        for col in 0..columns {
            let idx = ch * columns + col;
            let n = counts[col];
            data.push(if n == 0 {
                audio_core::Column { min: 0.0, max: 0.0, rms: 0.0 }
            } else {
                audio_core::Column {
                    min: if mins[idx].is_finite() { mins[idx] } else { 0.0 },
                    max: if maxs[idx].is_finite() { maxs[idx] } else { 0.0 },
                    rms: (sums[idx] / n as f64).sqrt() as f32,
                }
            });
        }
    }

    Ok(audio_core::PeakTile { channels, columns, data })
}

/// Measure the peak of the rendered result, for normalising.
pub fn measure_peak<S: RandomAccessSource>(
    list: &EditList,
    reader: &mut Reader<S>,
) -> io::Result<f32> {
    measure_peak_fx(list, reader, &mut Rack::new())
}

/// Peak of the rendered result including effects — normalising against a peak
/// that ignored a rack boost would clip the export.
pub fn measure_peak_fx<S: RandomAccessSource>(
    list: &EditList,
    reader: &mut Reader<S>,
    rack: &mut Rack,
) -> io::Result<f32> {
    let mut peak = 0f32;
    let mut take = |buf: &[f32]| {
        for v in buf {
            let a = v.abs();
            if a > peak {
                peak = a;
            }
        }
    };

    // Once, not once per block. `render_fx` renders the whole timeline and
    // slices when a stretch is active, so a block loop over it is quadratic —
    // which is what made normalising a stretched document take minutes.
    if list.is_stretched() {
        take(&render_all_stretched(list, reader, rack)?);
        return Ok(peak);
    }

    const BLOCK: u64 = 65536;
    let total = list.frames();
    let mut done = 0u64;
    while done < total {
        let n = BLOCK.min(total - done);
        take(&render_fx(list, reader, rack, done, n)?);
        done += n;
    }
    Ok(peak)
}

/// Bytes per sample for the WAV export at a given bit depth.
fn sample_width(bits: u16) -> u64 {
    match bits {
        16 => 2,
        32 => 4,
        _ => 3,
    }
}

/// Total length of the WAV stream this edit would produce.
pub fn wav_stream_len(list: &EditList, bits: u16) -> u64 {
    let channels = list.channels.max(1) as u64;
    wav::HEADER_LEN + list.frames() * channels * sample_width(bits)
}

/// Render an arbitrary byte range of the WAV stream.
///
/// This is what makes an edited file seekable in the browser: the length is
/// known from the clip list alone, so a range maps to a frame range by
/// arithmetic and only those frames are read and processed.
pub fn wav_bytes<S: RandomAccessSource>(
    list: &EditList,
    reader: &mut Reader<S>,
    start: u64,
    end: u64,
    bits: u16,
) -> io::Result<Vec<u8>> {
    wav_bytes_fx(list, reader, &mut Rack::new(), start, end, bits)
}

pub fn wav_bytes_fx<S: RandomAccessSource>(
    list: &EditList,
    reader: &mut Reader<S>,
    rack: &mut Rack,
    start: u64,
    end: u64,
    bits: u16,
) -> io::Result<Vec<u8>> {
    let channels = list.channels.max(1) as u64;
    let width = sample_width(bits);
    let block = channels * width;
    let codec = codec_for(bits);
    let total = wav_stream_len(list, bits);
    let end = end.min(total.saturating_sub(1));
    if start > end {
        return Ok(Vec::new());
    }

    let mut out = Vec::with_capacity((end - start + 1) as usize);
    let header = wav::header(
        list.frames() * block,
        list.channels.max(1),
        list.sample_rate,
        codec,
    );
    if start < wav::HEADER_LEN {
        let stop = (end + 1).min(wav::HEADER_LEN);
        out.extend_from_slice(&header[start as usize..stop as usize]);
    }

    if end >= wav::HEADER_LEN {
        let data_start = start.saturating_sub(wav::HEADER_LEN);
        let data_end = end - wav::HEADER_LEN;
        // Widen to whole frames, render, then trim back to the exact bytes.
        let first_frame = data_start / block;
        let last_frame = data_end / block;
        let count = last_frame - first_frame + 1;
        let samples = render_fx(list, reader, rack, first_frame, count)?;
        let mut bytes = Vec::with_capacity(samples.len() * width as usize);
        for v in samples {
            quantise(v, bits, &mut bytes);
        }
        let skip = (data_start - first_frame * block) as usize;
        let take = (data_end - data_start + 1) as usize;
        let slice = bytes.get(skip..).unwrap_or(&[]);
        out.extend_from_slice(&slice[..take.min(slice.len())]);
    }

    Ok(out)
}

fn codec_for(bits: u16) -> Codec {
    match bits {
        16 => Codec::PcmI16,
        32 => Codec::PcmF32,
        _ => Codec::PcmI24,
    }
}

/// Clamp before quantising: an edit that boosts gain can exceed unity, and
/// wrapping would turn a loud passage into noise.
fn quantise(v: f32, bits: u16, out: &mut Vec<u8>) {
    let c = v.clamp(-1.0, 1.0);
    match bits {
        16 => out.extend_from_slice(&((c * 32767.0) as i16).to_le_bytes()),
        32 => out.extend_from_slice(&c.to_le_bytes()),
        _ => {
            let q = (c * 8_388_607.0) as i32;
            out.extend_from_slice(&q.to_le_bytes()[..3]);
        }
    }
}

/// Render the whole edit to a new WAV file, 24-bit by default.
///
/// Writes only to `out`. The source is never modified — that is the guarantee
/// the whole edit model exists to keep.
pub fn render_to_wav<S: RandomAccessSource, W: Write>(
    list: &EditList,
    reader: &mut Reader<S>,
    out: &mut W,
    bits: u16,
) -> io::Result<u64> {
    render_to_wav_fx(list, reader, &mut Rack::new(), out, bits)
}

pub fn render_to_wav_fx<S: RandomAccessSource, W: Write>(
    list: &EditList,
    reader: &mut Reader<S>,
    rack: &mut Rack,
    out: &mut W,
    bits: u16,
) -> io::Result<u64> {
    let channels = list.channels.max(1);
    let total = list.frames();
    let codec = codec_for(bits);
    let bytes_per_sample = codec.bytes_per_sample() as u64;
    let data_len = total * channels as u64 * bytes_per_sample;

    out.write_all(&wav::header(data_len, channels, list.sample_rate, codec))?;

    const BLOCK: u64 = 32768;
    let mut done = 0u64;
    while done < total {
        let n = BLOCK.min(total - done);
        let block = render_fx(list, reader, rack, done, n)?;
        let mut bytes = Vec::with_capacity(block.len() * bytes_per_sample as usize);
        for v in block {
            quantise(v, bits, &mut bytes);
        }
        out.write_all(&bytes)?;
        done += n;
    }
    out.flush()?;
    Ok(total)
}
