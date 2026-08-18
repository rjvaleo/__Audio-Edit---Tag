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
            quantise(v, bits, false, &mut bytes);
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
///
/// `big` picks the byte order. WAV is little-endian and AIFF is big-endian,
/// and getting it the wrong way round produces a file that is loud noise
/// rather than one that fails to open — which is the sort of mistake that
/// reaches a listener.
fn quantise(v: f32, bits: u16, big: bool, out: &mut Vec<u8>) {
    let c = v.clamp(-1.0, 1.0);
    match bits {
        16 => {
            let q = (c * 32767.0) as i16;
            out.extend_from_slice(&if big { q.to_be_bytes() } else { q.to_le_bytes() });
        }
        32 => out.extend_from_slice(&if big { c.to_be_bytes() } else { c.to_le_bytes() }),
        _ => {
            let q = (c * 8_388_607.0) as i32;
            // The three bytes that carry the value, most significant first for
            // AIFF and last for WAV.
            if big {
                out.extend_from_slice(&q.to_be_bytes()[1..]);
            } else {
                out.extend_from_slice(&q.to_le_bytes()[..3]);
            }
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
            quantise(v, bits, false, &mut bytes);
        }
        out.write_all(&bytes)?;
        done += n;
    }
    out.flush()?;
    Ok(total)
}

/// Render the whole edit to a new AIFF file, with the settings written in.
///
/// The same walk as [`render_to_wav_fx`], big-endian and behind an AIFF header.
/// `meta` rides in front of the samples: what the sound is, a line of text for
/// anything else that opens it, and the settings themselves in an `APPL` chunk
/// — so an export is its own preset and a good accident can be found again.
///
/// Writes only to `out`. The source is never modified.
pub fn render_to_aiff_fx<S: RandomAccessSource, W: Write>(
    list: &EditList,
    reader: &mut Reader<S>,
    rack: &mut Rack,
    out: &mut W,
    bits: u16,
    meta: &audio_core::aiff::Meta,
) -> io::Result<u64> {
    render_to_aiff_controlled(list, reader, rack, out, bits, meta, |_, _| {})
}

/// The same export, with a chance to move the rack's controls as it goes.
///
/// `control` is handed the rack and the document frame each block is about to
/// start at, before that block is rendered. This is how an automation lane
/// reaches the file: what you hear has to be what you export, and a lane that
/// only existed during playback would break that.
///
/// The block size is the control rate of the export, so it is deliberately
/// small — 1024 frames is about 21 ms at 48 kHz, finer than the 8 ms live tick
/// only in the sense that it never falls behind.
/// Write audio that has already been rendered, running the rack over it with
/// the same per-block control hook.
///
/// The stretch is done by the time this is called, which is what a document
/// with a lane on its stretch needs: the streaming engine produced the samples
/// and only their length is knowable afterwards, so the header cannot be
/// written until they exist.
pub fn write_aiff_controlled<W: Write, F>(
    mut audio: Vec<f32>,
    channels: u16,
    sample_rate: u32,
    rack: &mut Rack,
    out: &mut W,
    bits: u16,
    meta: &audio_core::aiff::Meta,
    mut control: F,
) -> io::Result<u64>
where
    F: FnMut(&mut Rack, u64),
{
    let ch = channels.max(1) as usize;
    let total = (audio.len() / ch) as u64;
    let codec = codec_for(bits);
    let bps = codec.bytes_per_sample() as u64;

    out.write_all(&audio_core::aiff::header(
        total * ch as u64 * bps,
        channels.max(1),
        sample_rate,
        codec,
        meta,
    ))?;

    rack.reset();
    let mut written = 0u64;
    let mut frame = 0u64;
    for block in audio.chunks_mut(1024 * ch) {
        control(rack, frame);
        rack.process(block, ch, sample_rate);
        // The same soft ceiling the engine applies, so the file is what was
        // heard. Without it here, a rack that drives the channel over would be
        // rounded live and hard-clipped in the render — two different sounds
        // from one document, which is the one thing this program does not do.
        fx::soften(block);
        let mut bytes = Vec::with_capacity(block.len() * bps as usize);
        for v in block.iter() {
            quantise(*v, bits, true, &mut bytes);
        }
        written += bytes.len() as u64;
        out.write_all(&bytes)?;
        frame += (block.len() / ch) as u64;
    }
    if written % 2 == 1 {
        out.write_all(&[0])?;
    }
    out.flush()?;
    Ok(total)
}

/// Told what a long render is doing, and how far into it it has got.
///
/// Two callbacks rather than one: the phase changes a handful of times and the
/// frame count changes constantly, and a caller wanting to say "Stretching, 40%"
/// needs both. `Fn` behind shared references for the same reason
/// [`fx::Progress`] is — the stretchers nest, and the progress one is handed
/// straight to `Stretch::process_with`.
pub struct Watch<'a> {
    pub phase: &'a (dyn Fn(&'static str) + Sync),
    /// Step `n` frames. Returning `false` asks the render to give up, which is
    /// how a cancel reaches inside the stretch — the one phase long enough to
    /// need it.
    pub progress: &'a (dyn Fn(u64) -> bool + Sync),
    /// True to give up. Checked at every phase boundary and once per block.
    ///
    /// **Not** during the stretch. `Stretch::process` is one call that runs to
    /// completion, and stopping partway would mean handing back a buffer of the
    /// wrong length for `fit` to pad — slower than simply finishing, and a
    /// stranger thing to reason about. On a long stretch a cancel is therefore
    /// noticed when the stretch ends. The file is deleted either way, so what
    /// is lost is CPU, not correctness.
    pub stop: &'a (dyn Fn() -> bool + Sync),
}

/// Phase names, so the caller and the renderer cannot disagree about spelling.
pub mod phase {
    pub const READING: &str = "reading";
    pub const STRETCHING: &str = "stretching";
    pub const EFFECTS: &str = "effects";
    pub const TAIL: &str = "tail";
    pub const WRITING: &str = "writing";
}

pub type Watching<'a> = Option<&'a Watch<'a>>;

fn say(w: Watching, name: &'static str) {
    if let Some(x) = w {
        (x.phase)(name);
    }
}

fn step(w: Watching, n: u64) {
    if let Some(x) = w {
        let _ = (x.progress)(n);
    }
}

fn stopped(w: Watching) -> bool {
    w.map(|x| (x.stop)()).unwrap_or(false)
}

fn give_up() -> io::Error {
    io::Error::new(io::ErrorKind::Interrupted, "export cancelled")
}

/// The progress half on its own, for handing to `Stretch::process_with`.
fn stretch_progress<'a>(w: Watching<'a>) -> fx::Progress<'a> {
    w.map(|x| x.progress)
}

/// What to repeat, how many times, and whether to let the rack ring out.
///
/// `from`/`to` are **output** frames — the caller maps the selection through the
/// stretch before it gets here, because the ratio is the server's to know.
pub struct LoopPlan {
    pub from: u64,
    pub to: u64,
    pub repeats: u32,
    pub tail: bool,
}

/// How much fade the seam of a loop this long can afford.
///
/// A quarter of the loop capped at 512 frames, which is `loop_fade` in the
/// engine's transport. The same number on purpose: the export has to sound like
/// what was auditioned, and a seam of a different length would not.
fn loop_fade(len: u64) -> usize {
    const LOOP_FADE_FRAMES: usize = 512;
    LOOP_FADE_FRAMES.min((len / 4) as usize)
}

/// Ramp the last `n` frames of a slice down to silence.
fn fade_out(block: &mut [f32], channels: usize, n: usize) {
    let channels = channels.max(1);
    let frames = block.len() / channels;
    let n = n.min(frames);
    for i in 0..n {
        let k = 1.0 - (i + 1) as f32 / n as f32;
        let f = frames - n + i;
        for ch in 0..channels {
            block[f * channels + ch] *= k;
        }
    }
}

/// Ramp the first `n` frames of a slice up from silence.
fn fade_in(block: &mut [f32], channels: usize, n: usize) {
    let channels = channels.max(1);
    let frames = block.len() / channels;
    let n = n.min(frames);
    for i in 0..n {
        let k = (i + 1) as f32 / n as f32;
        for ch in 0..channels {
            block[i * channels + ch] *= k;
        }
    }
}

/// Export the loop, repeated, optionally letting the rack finish sounding.
///
/// Buffer-first, unlike [`render_to_aiff_controlled`], which writes its header
/// from `list.frames()` before producing a sample. A tail's length is not
/// knowable until the rack has been run, so the samples have to exist before the
/// header can be written — the shape [`write_aiff_controlled`] already uses.
///
/// The tiling is of **dry** audio and the rack is run once, continuously, over
/// the whole tiled stream. Rendering the loop wet and then repeating it would
/// give every repeat its own severed reverb tail, chopped at the seam and
/// restarted; running the rack over the tiled stream lets the reverb and the
/// delay bleed across each repeat exactly as they do when the transport loops.
pub fn render_loop_to_aiff_controlled<S: RandomAccessSource, W: Write, F>(
    list: &EditList,
    reader: &mut Reader<S>,
    rack: &mut Rack,
    out: &mut W,
    bits: u16,
    meta: &audio_core::aiff::Meta,
    plan: &LoopPlan,
    control: F,
) -> io::Result<u64>
where
    F: FnMut(&mut Rack, u64),
{
    render_loop_to_aiff_watched(list, reader, rack, out, bits, meta, plan, control, None)
}

/// The same, reporting what it is doing as it goes.
#[allow(clippy::too_many_arguments)]
pub fn render_loop_to_aiff_watched<S: RandomAccessSource, W: Write, F>(
    list: &EditList,
    reader: &mut Reader<S>,
    rack: &mut Rack,
    out: &mut W,
    bits: u16,
    meta: &audio_core::aiff::Meta,
    plan: &LoopPlan,
    mut control: F,
    watch: Watching,
) -> io::Result<u64>
where
    F: FnMut(&mut Rack, u64),
{
    let ch = list.channels.max(1) as usize;
    let sr = list.sample_rate;

    // Dry: the stretch applied, the rack not. A stretched document cannot be
    // rendered from the middle — WSOLA chooses each splice from the one before
    // it — so the whole thing is produced and then sliced.
    say(watch, phase::READING);
    let dry = if list.is_stretched() {
        let base = render(list, reader, 0, list.base_frames())?;
        step(watch, list.base_frames());
        say(watch, phase::STRETCHING);
        list.stretch.process_with(&base, ch, sr, stretch_progress(watch))
    } else {
        let b = render(list, reader, 0, list.frames())?;
        step(watch, list.frames());
        b
    };

    let have = (dry.len() / ch) as u64;
    let from = plan.from.min(have);
    let to = plan.to.min(have);
    if to <= from {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "loop range is empty after mapping through the stretch",
        ));
    }
    let loop_len = to - from;
    let repeats = plan.repeats.max(1) as u64;
    let seam = loop_fade(loop_len);

    let mut audio: Vec<f32> = Vec::with_capacity((loop_len * repeats) as usize * ch);
    for r in 0..repeats {
        let at = audio.len();
        audio.extend_from_slice(&dry[(from as usize * ch)..(to as usize * ch)]);
        let this = &mut audio[at..];
        // The engine does not overlap two copies — one source, so it fades the
        // outgoing material to zero and the incoming material up from zero
        // across the jump. Every repeat keeps its exact length; the seam is a
        // dip through zero.
        if r + 1 < repeats {
            fade_out(this, ch, seam);
        }
        if r > 0 {
            fade_in(this, ch, seam);
        }
    }
    drop(dry);

    let musical = loop_len * repeats;
    if plan.tail {
        audio.resize(((musical + fx::TAIL_CAP_SECONDS * sr as u64) as usize) * ch, 0.0);
    }

    // One continuous pass, so the rack never restarts mid-stream.
    say(watch, phase::EFFECTS);
    rack.reset();
    let mut frame = 0u64;
    for block in audio.chunks_mut(1024 * ch) {
        // The document frame this block starts at, wrapped back into the loop
        // so an automation lane repeats with the audio instead of running off
        // the end. Through the tail it holds at the loop's last frame.
        let doc = if frame < musical {
            from + (frame % loop_len)
        } else {
            to.saturating_sub(1)
        };
        if stopped(watch) {
            return Err(give_up());
        }
        control(rack, doc);
        rack.process(block, ch, sr);
        frame += (block.len() / ch) as u64;
        step(watch, (block.len() / ch) as u64);
    }

    // Where the tail stopped saying anything: the **last** frame above the
    // floor, not the first quiet one.
    //
    // The live transport counts down four seconds of quiet before it gives up,
    // because it cannot see the future — a delay that is briefly silent between
    // taps must not be cut off mid-pattern. Offline the whole tail is already in
    // hand, so the last audible frame can simply be found, which is both exact
    // and immune to the gap problem the countdown exists to solve.
    //
    // It also fixes what the countdown got plainly wrong here: a rack with
    // nothing in it that can ring never rises above the floor at all, and the
    // countdown still appended its full budget — four seconds of digital
    // silence on the end of every export from a dry chain.
    let mut total = musical;
    if plan.tail {
        say(watch, phase::TAIL);
        let end = (audio.len() / ch) as u64;
        let mut last_loud: Option<u64> = None;
        for f in musical..end {
            let mut peak = 0.0f32;
            for c in 0..ch {
                peak = peak.max(audio[f as usize * ch + c].abs());
            }
            if peak > fx::TAIL_SILENCE {
                last_loud = Some(f);
            }
        }
        // A short margin past it, so the file ends in silence rather than on a
        // sample still above the floor — inaudible either way, but a clean end
        // is what a rendered file should have.
        const MARGIN_MS: u64 = 50;
        if let Some(f) = last_loud {
            total = (f + 1 + sr as u64 * MARGIN_MS / 1000).min(end);
        }
    }

    if stopped(watch) {
        return Err(give_up());
    }
    say(watch, phase::WRITING);
    let codec = codec_for(bits);
    let bps = codec.bytes_per_sample() as u64;
    out.write_all(&audio_core::aiff::header(
        total * ch as u64 * bps,
        list.channels.max(1),
        sr,
        codec,
        meta,
    ))?;

    let mut written = 0u64;
    // The same soft ceiling the engine applies, so the file is what was heard.
    // Without it here, a rack that drives the channel over would be rounded
    // live and hard-clipped in the render — two different sounds from one
    // document, which is the one thing this program does not do.
    fx::soften(&mut audio[..(total as usize * ch)]);
    for block in audio[..(total as usize * ch)].chunks(1024 * ch) {
        let mut bytes = Vec::with_capacity(block.len() * bps as usize);
        for v in block.iter() {
            quantise(*v, bits, true, &mut bytes);
        }
        written += bytes.len() as u64;
        out.write_all(&bytes)?;
    }
    if written % 2 == 1 {
        out.write_all(&[0])?;
    }
    out.flush()?;
    Ok(total)
}

pub fn render_to_aiff_controlled<S: RandomAccessSource, W: Write, F>(
    list: &EditList,
    reader: &mut Reader<S>,
    rack: &mut Rack,
    out: &mut W,
    bits: u16,
    meta: &audio_core::aiff::Meta,
    control: F,
) -> io::Result<u64>
where
    F: FnMut(&mut Rack, u64),
{
    render_to_aiff_watched(list, reader, rack, out, bits, meta, control, None)
}

/// The same, reporting what it is doing as it goes.
#[allow(clippy::too_many_arguments)]
pub fn render_to_aiff_watched<S: RandomAccessSource, W: Write, F>(
    list: &EditList,
    reader: &mut Reader<S>,
    rack: &mut Rack,
    out: &mut W,
    bits: u16,
    meta: &audio_core::aiff::Meta,
    mut control: F,
    watch: Watching,
) -> io::Result<u64>
where
    F: FnMut(&mut Rack, u64),
{
    let channels = list.channels.max(1);
    let total = list.frames();
    let codec = codec_for(bits);
    let bytes_per_sample = codec.bytes_per_sample() as u64;
    let data_len = total * channels as u64 * bytes_per_sample;

    out.write_all(&audio_core::aiff::header(
        data_len,
        channels,
        list.sample_rate,
        codec,
        meta,
    ))?;

    // Small enough that a curve is followed rather than stepped through.
    const BLOCK: u64 = 1024;
    let ch = channels as usize;
    let mut written = 0u64;

    // The rack is run block by block over one continuous stream rather than by
    // asking `render_fx` for each block: that resets the rack per call, and on
    // a stretched document it re-renders the whole file every time — with a
    // block this small the export would never finish.
    let mut emit = |block: &mut [f32], out: &mut W| -> io::Result<()> {
        let mut bytes = Vec::with_capacity(block.len() * bytes_per_sample as usize);
        for v in block.iter() {
            quantise(*v, bits, true, &mut bytes);
        }
        written += bytes.len() as u64;
        out.write_all(&bytes)
    };

    rack.reset();
    if list.is_stretched() {
        // Stretch is a property of the document and has to be applied whole —
        // WSOLA picks each splice from the one before it.
        say(watch, phase::READING);
        let base = render(list, reader, 0, list.base_frames())?;
        step(watch, list.base_frames());
        say(watch, phase::STRETCHING);
        let mut audio = list
            .stretch
            .process_with(&base, ch, list.sample_rate, stretch_progress(watch));
        say(watch, phase::WRITING);
        let mut done = 0u64;
        for block in audio.chunks_mut(BLOCK as usize * ch) {
            control(rack, done);
            rack.process(block, ch, list.sample_rate);
            emit(block, out)?;
            done += (block.len() / ch) as u64;
            step(watch, (block.len() / ch) as u64);
            if stopped(watch) {
                return Err(give_up());
            }
        }
    } else {
        // No pre-roll: the rack runs continuously from frame zero to the end,
        // in order, which is exactly what playback does. Pre-roll exists for
        // *windowed* renders that start in the middle with cold filters, and
        // this one never does.
        say(watch, phase::WRITING);
        let mut done = 0u64;
        while done < total {
            let n = BLOCK.min(total - done);
            control(rack, done);
            let mut block = render(list, reader, done, n)?;
            rack.process(&mut block, ch, list.sample_rate);
            emit(&mut block, out)?;
            done += n;
            step(watch, n);
            if stopped(watch) {
                return Err(give_up());
            }
        }
    }
    // An odd number of bytes leaves the next chunk misaligned, and the header
    // has already counted the pad. Nothing follows here, but a file whose
    // length disagrees with its own arithmetic is a file some readers refuse.
    if written % 2 == 1 {
        out.write_all(&[0])?;
    }
    out.flush()?;
    Ok(total)
}
