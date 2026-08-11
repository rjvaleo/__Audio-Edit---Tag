//! Measuring the edited timeline.
//!
//! Several of Peak's commands are really two things: a measurement, and an edit
//! made from it. Find Peak is only the measurement. Normalize (RMS) needs an
//! average and a peak before it can choose a gain. Strip Silence needs to know
//! where the quiet is. Repair Click needs to know where the spike is.
//!
//! Keeping the measuring here rather than inside [`crate::ops`] is what lets the
//! operations stay pure arithmetic on the clip list. Everything in this module
//! reads through [`crate::render`], so it measures **what will be heard** —
//! stretch, fades, gains, effects and all — rather than what is on disk.

use crate::render::{render_all_stretched, render_fx};
use crate::{EditList, Range};
use audio_core::{RandomAccessSource, Reader};
use fx::Rack;
use std::io;

/// How much is rendered at a time while measuring.
const BLOCK: u64 = 65536;

/// Walk `range` of the edited timeline, handing each block to `f`.
///
/// The block always begins at a frame boundary and `base` is the absolute
/// frame the block starts at, so a caller can report positions in the same
/// space the interface selected in.
fn scan<S: RandomAccessSource>(
    list: &EditList,
    reader: &mut Reader<S>,
    rack: &mut Rack,
    range: Range,
    mut f: impl FnMut(&[f32], u64),
) -> io::Result<()> {
    let total = list.frames();
    let start = range.start.min(total);
    let end = if range.is_empty() { total } else { range.end.min(total) };
    if start >= end {
        return Ok(());
    }

    // A stretched timeline is not addressable a block at a time — WSOLA picks
    // each splice from the one before it — so `render_fx` renders the whole
    // thing and slices out the window asked for. Asking it for one block at a
    // time therefore renders the entire file *once per block*: measuring a
    // thirty-second sound at 6× took long enough to look like a hang. Render
    // once and walk it.
    if list.is_stretched() {
        let all = render_all_stretched(list, reader, rack)?;
        let channels = list.channels.max(1) as usize;
        let from = (start as usize * channels).min(all.len());
        let to = (end as usize * channels).min(all.len());
        f(&all[from..to], start);
        return Ok(());
    }

    let mut done = start;
    while done < end {
        let n = BLOCK.min(end - done);
        let block = render_fx(list, reader, rack, done, n)?;
        f(&block, done);
        done += n;
    }
    Ok(())
}

/// The loudest frame in `range`, and how loud it is.
///
/// Peak's Find Peak, which places the insertion point at the sample with the
/// maximum amplitude. An empty range means the whole document. Returns `None`
/// for a range with nothing in it; digital silence returns frame zero at 0.0,
/// because "the loudest sample is silent" is a true and useful answer.
pub fn find_peak<S: RandomAccessSource>(
    list: &EditList,
    reader: &mut Reader<S>,
    rack: &mut Rack,
    range: Range,
) -> io::Result<Option<(u64, f32)>> {
    let channels = list.channels.max(1) as usize;
    let mut best: Option<(u64, f32)> = None;
    scan(list, reader, rack, range, |block, base| {
        for (i, v) in block.iter().enumerate() {
            let a = v.abs();
            if best.map_or(true, |(_, b)| a > b) {
                best = Some((base + (i / channels) as u64, a));
            }
        }
    })?;
    Ok(best)
}

/// Root mean square level over `range`, across every channel together.
///
/// An empty range means the whole document.
pub fn measure_rms<S: RandomAccessSource>(
    list: &EditList,
    reader: &mut Reader<S>,
    rack: &mut Rack,
    range: Range,
) -> io::Result<f32> {
    let mut sum = 0f64;
    let mut n = 0u64;
    scan(list, reader, rack, range, |block, _| {
        for v in block {
            sum += (*v as f64) * (*v as f64);
            n += 1;
        }
    })?;
    Ok(if n == 0 { 0.0 } else { (sum / n as f64).sqrt() as f32 })
}

/// Peak and RMS in one pass, which is what RMS normalising needs.
pub fn measure_level<S: RandomAccessSource>(
    list: &EditList,
    reader: &mut Reader<S>,
    rack: &mut Rack,
    range: Range,
) -> io::Result<(f32, f32)> {
    let mut peak = 0f32;
    let mut sum = 0f64;
    let mut n = 0u64;
    scan(list, reader, rack, range, |block, _| {
        for v in block {
            let a = v.abs();
            if a > peak {
                peak = a;
            }
            sum += (*v as f64) * (*v as f64);
            n += 1;
        }
    })?;
    Ok((peak, if n == 0 { 0.0 } else { (sum / n as f64).sqrt() as f32 }))
}

// ------------------------------------------------------------------- silence

/// The window the level is judged over, in milliseconds.
///
/// This is not a detail. A gate on the instantaneous sample value calls a loud
/// sine wave silent twice a cycle, because every waveform passes through zero.
/// The threshold only means what it says once it is applied to the loudest
/// sample in a short window.
pub const ENVELOPE_MS: f32 = 5.0;

/// What Strip Silence does with what it finds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StripMode {
    /// Flatten the quiet parts but keep the timing.
    Silence,
    /// Take them out and close the gap.
    Remove,
}

#[derive(Debug, Clone, Copy)]
pub struct StripParams {
    /// Level below which audio counts as silence.
    pub threshold_db: f32,
    /// A quiet stretch shorter than this is left alone — otherwise every gap
    /// between two words in a sentence becomes an edit.
    pub min_frames: u64,
    /// Frames of quiet left in place at each end of a run, so a decay tail is
    /// not clipped off and an attack is not eaten into.
    pub pad_frames: u64,
    /// Frames per envelope window; use [`envelope_frames`].
    pub hop: u64,
}

pub fn envelope_frames(sample_rate: u32) -> u64 {
    (((sample_rate as f32) * ENVELOPE_MS / 1000.0) as u64).max(1)
}

impl StripParams {
    pub fn new(sample_rate: u32) -> Self {
        StripParams {
            threshold_db: -40.0,
            min_frames: sample_rate as u64 / 10, // 100 ms
            pad_frames: sample_rate as u64 / 100, // 10 ms
            hop: envelope_frames(sample_rate),
        }
    }
}

/// Finds runs of quiet, a block at a time.
///
/// Stateful rather than a function over a buffer because a whole document does
/// not fit in memory — five minutes of stereo is a hundred megabytes of floats
/// — and because a run of silence does not respect block boundaries.
pub struct SilenceScan {
    threshold: f32,
    min_frames: u64,
    hop: u64,
    /// Frames consumed so far.
    pos: u64,
    /// Loudest sample seen in the window still being filled.
    window_peak: f32,
    window_start: u64,
    /// Where the current run of quiet windows began, if there is one.
    run_start: Option<u64>,
    runs: Vec<Range>,
}

impl SilenceScan {
    pub fn new(p: &StripParams) -> Self {
        SilenceScan {
            threshold: 10f32.powf(p.threshold_db / 20.0),
            min_frames: p.min_frames,
            hop: p.hop.max(1),
            pos: 0,
            window_peak: 0.0,
            window_start: 0,
            run_start: None,
            runs: Vec::new(),
        }
    }

    pub fn feed(&mut self, buf: &[f32], channels: usize) {
        let channels = channels.max(1);
        let frames = buf.len() / channels;
        for i in 0..frames {
            for ch in 0..channels {
                let a = buf[i * channels + ch].abs();
                if a > self.window_peak {
                    self.window_peak = a;
                }
            }
            self.pos += 1;
            if self.pos - self.window_start >= self.hop {
                self.close_window();
            }
        }
    }

    fn close_window(&mut self) {
        let quiet = self.window_peak < self.threshold;
        if quiet {
            self.run_start.get_or_insert(self.window_start);
        } else if let Some(start) = self.run_start.take() {
            self.push_run(start, self.window_start);
        }
        self.window_start = self.pos;
        self.window_peak = 0.0;
    }

    fn push_run(&mut self, start: u64, end: u64) {
        if end.saturating_sub(start) >= self.min_frames {
            self.runs.push(Range::new(start, end));
        }
    }

    /// The runs found, with the padding applied.
    pub fn finish(mut self, params: &StripParams) -> Vec<Range> {
        // The last partial window still counts; without this a file ending in
        // silence keeps its tail.
        if self.pos > self.window_start {
            self.close_window();
        }
        if let Some(start) = self.run_start.take() {
            let end = self.pos;
            self.push_run(start, end);
        }
        let pad = params.pad_frames;
        self.runs
            .into_iter()
            .filter_map(|r| {
                // Padding eats into both ends. A run that padding would consume
                // entirely was never long enough to be worth touching.
                let start = r.start + pad;
                let end = r.end.saturating_sub(pad);
                if end > start {
                    Some(Range::new(start, end))
                } else {
                    None
                }
            })
            .collect()
    }
}

/// Find the quiet runs in the edited timeline.
pub fn silent_runs<S: RandomAccessSource>(
    list: &EditList,
    reader: &mut Reader<S>,
    rack: &mut Rack,
    range: Range,
    params: &StripParams,
) -> io::Result<Vec<Range>> {
    let channels = list.channels.max(1) as usize;
    let mut scanner = SilenceScan::new(params);
    let offset = range.start.min(list.frames());
    scan(list, reader, rack, range, |block, _| {
        scanner.feed(block, channels);
    })?;
    // The scanner counts from zero within the scanned span; report positions on
    // the document's own timeline so the caller can cut with them directly.
    Ok(scanner
        .finish(params)
        .into_iter()
        .map(|r| Range::new(r.start + offset, r.end + offset))
        .collect())
}

// -------------------------------------------------------------------- clicks

/// The sample furthest from where its neighbours say it should be, and by how far.
///
/// A click is a discontinuity — Peak's own description is a sample value of
/// −100 followed by one of 10,000 — and in a selection the user has already
/// drawn around the damage, the worst one is the damage.
///
/// What is measured is deliberately **not** the step between neighbouring
/// frames. A single-sample spike has two steps, one in and one out, and the
/// larger of the pair is usually the one *leaving* it: a step detector names
/// the first clean sample after the anomaly rather than the anomaly. Measuring
/// each sample against the midpoint of its neighbours names the bad sample
/// itself, and on a square digital click, whose middle is flat, it names the
/// leading edge — which is where a repair has to begin either way.
pub fn worst_spike(buf: &[f32], channels: usize, base: u64) -> Option<(u64, f32)> {
    worst_spike_from(buf, channels, base, 1)
}

/// As [`worst_spike`], but ignoring everything before frame `first`.
///
/// The frames before it are still read — they are the neighbours the measure
/// needs — they just cannot themselves be the answer. That is what lets a
/// caller render a lead-in for continuity without the lead-in winning.
fn worst_spike_from(buf: &[f32], channels: usize, base: u64, first: usize) -> Option<(u64, f32)> {
    let channels = channels.max(1);
    let frames = buf.len() / channels;
    if frames < 3 || first + 1 > frames {
        return None;
    }
    let mut best = (0u64, -1f32);
    for i in first.max(1)..frames - 1 {
        let dev = (0..channels).fold(0.0f32, |m, ch| {
            let prev = buf[(i - 1) * channels + ch];
            let here = buf[i * channels + ch];
            let next = buf[(i + 1) * channels + ch];
            m.max((here - (prev + next) * 0.5).abs())
        });
        if dev > best.1 {
            best = (base + i as u64, dev);
        }
    }
    if best.1 < 0.0 {
        None
    } else {
        Some(best)
    }
}

/// Find the worst spike in `range` of the edited timeline.
///
/// This does **not** go through [`scan`], and the reason is worth writing down.
/// A windowed render resets the rack and gives it a fixed pre-roll, so two
/// blocks rendered independently do not join continuously when anything in the
/// rack has memory — and a discontinuity at a join is precisely what this
/// function is looking for. Reading whole blocks side by side reported a click
/// at every multiple of the block size, on audio that had none.
///
/// So each block is rendered with the frames before it included, and only the
/// interior is judged: every frame reported sits inside one continuously
/// rendered buffer, with its true neighbours either side.
pub fn find_click<S: RandomAccessSource>(
    list: &EditList,
    reader: &mut Reader<S>,
    rack: &mut Rack,
    range: Range,
) -> io::Result<Option<(u64, f32)>> {
    let channels = list.channels.max(1) as usize;
    let total = list.frames();
    let start = range.start.min(total);
    let end = if range.is_empty() { total } else { range.end.min(total) };
    if end <= start {
        return Ok(None);
    }

    // Enough to settle whatever has memory. With nothing in the rack a single
    // frame is all the overlap a three-point measure needs.
    let back = if rack.is_empty() {
        1
    } else {
        rack.preroll_frames(list.sample_rate).max(1)
    };

    let mut best: Option<(u64, f32)> = None;
    let mut done = start;
    while done < end {
        let n = BLOCK.min(end - done);
        let from = done.saturating_sub(back);
        let lead = done - from;
        let buf = render_fx(list, reader, rack, from, lead + n)?;
        // The lead-in is read for its neighbours but cannot itself be the
        // answer: those frames belong to the block before, which has already
        // judged them.
        if let Some((f, s)) = worst_spike_from(&buf, channels, from, lead as usize) {
            if best.map_or(true, |(_, b)| s > b) {
                best = Some((f, s));
            }
        }
        done += n;
    }
    Ok(best)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params() -> StripParams {
        StripParams { threshold_db: -40.0, min_frames: 100, pad_frames: 0, hop: 10 }
    }

    #[test]
    fn a_loud_sine_is_not_mistaken_for_silence() {
        // The reason the level is judged over a window: every waveform passes
        // through zero, so an instantaneous gate would call this mostly quiet.
        let buf: Vec<f32> = (0..2000)
            .map(|i| (i as f32 / 20.0 * std::f32::consts::TAU).sin())
            .collect();
        let mut s = SilenceScan::new(&params());
        s.feed(&buf, 1);
        assert!(s.finish(&params()).is_empty());
    }

    #[test]
    fn a_run_of_silence_is_found_where_it_actually_is() {
        let mut buf = vec![0.5f32; 500];
        buf.extend(std::iter::repeat(0.0).take(400));
        buf.extend(std::iter::repeat(0.5).take(500));
        let mut s = SilenceScan::new(&params());
        s.feed(&buf, 1);
        let runs = s.finish(&params());
        assert_eq!(runs.len(), 1, "{runs:?}");
        assert_eq!(runs[0].start, 500);
        assert_eq!(runs[0].end, 900);
    }

    #[test]
    fn a_gap_shorter_than_the_minimum_is_left_alone() {
        let mut buf = vec![0.5f32; 500];
        buf.extend(std::iter::repeat(0.0).take(50)); // under min_frames of 100
        buf.extend(std::iter::repeat(0.5).take(500));
        let mut s = SilenceScan::new(&params());
        s.feed(&buf, 1);
        assert!(s.finish(&params()).is_empty());
    }

    #[test]
    fn silence_at_the_very_end_is_still_found() {
        let mut buf = vec![0.5f32; 500];
        buf.extend(std::iter::repeat(0.0).take(400));
        let mut s = SilenceScan::new(&params());
        s.feed(&buf, 1);
        let runs = s.finish(&params());
        assert_eq!(runs.len(), 1, "{runs:?}");
        assert_eq!(runs[0].start, 500);
        assert_eq!(runs[0].end, 900);
    }

    #[test]
    fn the_threshold_decides_what_counts_as_quiet() {
        // Graded material: a threshold control cannot be tested with a signal
        // that is either far above the bar or far below it.
        let mut buf = vec![0.5f32; 300];
        buf.extend(std::iter::repeat(0.02).take(400)); // about -34 dB
        buf.extend(std::iter::repeat(0.5).take(300));

        let low = StripParams { threshold_db: -40.0, ..params() };
        let mut s = SilenceScan::new(&low);
        s.feed(&buf, 1);
        assert!(s.finish(&low).is_empty(), "-40 dB is below this material");

        let high = StripParams { threshold_db: -30.0, ..params() };
        let mut s = SilenceScan::new(&high);
        s.feed(&buf, 1);
        assert_eq!(s.finish(&high).len(), 1, "-30 dB should catch it");
    }

    #[test]
    fn padding_leaves_a_margin_at_each_end_of_a_run() {
        let mut buf = vec![0.5f32; 500];
        buf.extend(std::iter::repeat(0.0).take(400));
        buf.extend(std::iter::repeat(0.5).take(500));
        let p = StripParams { pad_frames: 50, ..params() };
        let mut s = SilenceScan::new(&p);
        s.feed(&buf, 1);
        let runs = s.finish(&p);
        assert_eq!(runs[0].start, 550);
        assert_eq!(runs[0].end, 850);
    }

    #[test]
    fn feeding_the_scanner_in_pieces_gives_the_same_answer_as_all_at_once() {
        let mut buf = vec![0.5f32; 500];
        buf.extend(std::iter::repeat(0.0).take(400));
        buf.extend(std::iter::repeat(0.5).take(500));

        let mut whole = SilenceScan::new(&params());
        whole.feed(&buf, 1);
        let a = whole.finish(&params());

        let mut split = SilenceScan::new(&params());
        for chunk in buf.chunks(37) {
            split.feed(chunk, 1);
        }
        let b = split.finish(&params());
        assert_eq!(a, b);
    }

    #[test]
    fn a_stereo_run_is_only_quiet_when_both_channels_are() {
        // Left silent, right playing: the file is not silent.
        let mut buf = Vec::new();
        for _ in 0..1000 {
            buf.push(0.0);
            buf.push(0.5);
        }
        let mut s = SilenceScan::new(&params());
        s.feed(&buf, 2);
        assert!(s.finish(&params()).is_empty());
    }

    #[test]
    fn the_worst_spike_is_where_the_click_is() {
        let mut buf: Vec<f32> = (0..200)
            .map(|i| (i as f32 / 50.0 * std::f32::consts::TAU).sin() * 0.3)
            .collect();
        buf[120] = 0.98; // the spike
        let (frame, dev) = worst_spike(&buf, 1, 0).unwrap();
        assert_eq!(frame, 120, "the damaged sample, not the edge after it");
        assert!(dev > 0.6, "deviation was {dev}");
    }

    #[test]
    fn a_smooth_signal_has_no_large_step() {
        let buf: Vec<f32> = (0..200)
            .map(|i| (i as f32 / 50.0 * std::f32::consts::TAU).sin() * 0.3)
            .collect();
        let (_, dev) = worst_spike(&buf, 1, 0).unwrap();
        assert!(dev < 0.01, "a smooth sine deviated by {dev}");
    }

    #[test]
    fn the_worst_spike_is_reported_in_the_callers_frame_numbers() {
        let mut buf = vec![0.0f32; 200];
        buf[50] = 0.9;
        assert_eq!(worst_spike(&buf, 1, 1000).unwrap().0, 1050);
    }

    #[test]
    fn a_buffer_with_nothing_to_compare_is_not_a_panic() {
        assert!(worst_spike(&[], 1, 0).is_none());
        assert!(worst_spike(&[0.5], 1, 0).is_none());
        assert!(worst_spike(&[0.5, 0.1], 1, 0).is_none());
    }
}
