//! Edit operations.
//!
//! Every one of these rewrites the clip list and nothing else. No audio is read
//! or written here — that only happens in [`crate::render`].

use crate::analyse::StripMode;
use crate::{Clip, EditList, Fade, FadeShape, Range};

impl EditList {
    /// Split the clip containing `pos` so that a clip boundary falls exactly there.
    ///
    /// Returns the index of the clip starting at `pos`. A split at an existing
    /// boundary is a no-op, so calling it twice is harmless.
    pub fn split_at(&mut self, pos: u64) -> Option<usize> {
        let (i, offset) = self.locate(pos)?;
        if offset == 0 {
            return Some(i);
        }
        let mut left = self.clips[i];
        let mut right = self.clips[i];

        left.len = offset;
        right.src_start = if left.reversed {
            // A reversed clip reads backwards, so the second half takes the
            // *earlier* source frames.
            left.src_start
        } else {
            left.src_start + offset
        };
        if left.reversed {
            left.src_start = right.src_start + (right.len - offset);
        }
        right.len -= offset;

        // A fade belongs to the edge it was placed on; splitting must not
        // duplicate it into the middle of the material.
        left.fade_out = Fade::none();
        right.fade_in = Fade::none();

        self.clips[i] = left;
        self.clips.insert(i + 1, right);
        Some(i + 1)
    }

    /// Remove `range` from the timeline, closing the gap.
    pub fn cut(&mut self, range: Range) {
        if range.is_empty() {
            return;
        }
        let total = self.base_frames();
        let end = range.end.min(total);
        if range.start >= total {
            return;
        }
        self.split_at(range.start);
        self.split_at(end);

        let mut acc = 0u64;
        self.clips.retain(|c| {
            let start = acc;
            acc += c.len;
            // Keep clips wholly outside the cut.
            start >= end || start + c.len <= range.start
        });
    }

    /// Replace `range` with silence, keeping the overall length.
    ///
    /// Peak's Silence command. It overwrites; [`insert_silence`](Self::insert_silence)
    /// is the one that makes the document longer.
    pub fn silence(&mut self, range: Range) {
        self.for_each_clip_in(range, |c| {
            c.silent = true;
            c.gain = 0.0;
        });
    }

    /// Keep `range` and discard everything else.
    ///
    /// Peak's Crop. The tail goes first: cutting the head would move the end of
    /// the selection out from under the second cut.
    pub fn crop(&mut self, range: Range) {
        if range.is_empty() {
            return;
        }
        let total = self.base_frames();
        if range.start >= total {
            return;
        }
        let end = range.end.min(total);
        self.cut(Range::new(end, total));
        self.cut(Range::new(0, range.start));
    }

    /// Lay down `count` more copies of `range` immediately after it.
    ///
    /// Peak's Duplicate, which it describes as the way to make four bars of
    /// drums out of one. Peak takes its copies from the clipboard; a selection
    /// is the same idea without a clipboard to keep in step, and it is what the
    /// documented use of the command actually wants.
    ///
    /// Everything after the selection is pushed later in time.
    pub fn duplicate(&mut self, range: Range, count: u32) {
        if range.is_empty() || count == 0 {
            return;
        }
        let total = self.base_frames();
        if range.start >= total {
            return;
        }
        let end = range.end.min(total);
        self.split_at(range.start);
        self.split_at(end);
        let Some((first, last)) = self.clip_span(Range::new(range.start, end)) else {
            return;
        };
        let copy: Vec<Clip> = self.clips[first..=last].to_vec();
        let mut at = last + 1;
        for _ in 0..count {
            for c in &copy {
                self.clips.insert(at, *c);
                at += 1;
            }
        }
    }

    /// Insert `frames` of silence at `pos`, pushing everything after it later.
    ///
    /// Peak's Insert Silence. Ours had no equivalent — [`silence`](Self::silence)
    /// overwrites — so there was no way to lengthen a document at all.
    pub fn insert_silence(&mut self, pos: u64, frames: u64) {
        if frames == 0 {
            return;
        }
        let total = self.base_frames();
        if pos >= total {
            // Past the end lands at the end rather than being dropped, so a
            // pause can be added after the last sound.
            self.clips.push(Clip::silence(frames));
            return;
        }
        let at = match self.split_at(pos) {
            Some(i) => i,
            None => self.clips.len(),
        };
        self.clips.insert(at, Clip::silence(frames));
    }

    /// Multiply the gain of everything in `range` by `db` decibels.
    pub fn gain_db(&mut self, range: Range, db: f32) {
        let mul = 10f32.powf(db / 20.0);
        self.for_each_clip_in(range, |c| c.gain *= mul);
    }

    /// Set an absolute gain across `range`, discarding any previous gain there.
    pub fn set_gain(&mut self, range: Range, gain: f32) {
        self.for_each_clip_in(range, |c| c.gain = gain.max(0.0));
    }

    /// Reverse `range` in place.
    pub fn reverse(&mut self, range: Range) {
        if range.is_empty() {
            return;
        }
        self.split_at(range.start);
        self.split_at(range.end);
        let (first, last) = match self.clip_span(range) {
            Some(v) => v,
            None => return,
        };
        for c in &mut self.clips[first..=last] {
            c.reversed = !c.reversed;
        }
        // The clips themselves also have to change order, or reversing a
        // multi-clip selection only reverses each piece internally.
        self.clips[first..=last].reverse();
    }

    /// Fade in over the first `frames` of `range`.
    pub fn fade_in(&mut self, range: Range, frames: u64, shape: FadeShape) {
        if range.is_empty() || frames == 0 {
            return;
        }
        self.split_at(range.start);
        let end = (range.start + frames).min(self.base_frames());
        self.split_at(end);
        if let Some((first, _)) = self.clip_span(Range::new(range.start, end)) {
            let span = Range::new(range.start, end);
            let mut placed = 0u64;
            let mut i = first;
            // A fade can span several clips; each gets the slice of the curve
            // that lands on it, so the result is one continuous ramp.
            while i < self.clips.len() && placed < span.len() {
                let len = self.clips[i].len;
                self.clips[i].fade_in = Fade {
                    frames: span.len().saturating_sub(placed).min(len),
                    shape,
                };
                placed += len;
                i += 1;
            }
        }
    }

    /// Fade out over the last `frames` of `range`.
    pub fn fade_out(&mut self, range: Range, frames: u64, shape: FadeShape) {
        if range.is_empty() || frames == 0 {
            return;
        }
        let start = range.end.saturating_sub(frames);
        self.split_at(start);
        self.split_at(range.end);
        if let Some((first, last)) = self.clip_span(Range::new(start, range.end)) {
            let total: u64 = self.clips[first..=last].iter().map(|c| c.len).sum();
            let mut remaining = total;
            for i in first..=last {
                let len = self.clips[i].len;
                self.clips[i].fade_out = Fade {
                    frames: remaining.min(len),
                    shape,
                };
                remaining = remaining.saturating_sub(len);
            }
        }
    }

    /// Scale the whole document so its loudest sample sits at `target_db`.
    ///
    /// `measured_peak` is the peak of the rendered result, which the caller
    /// obtains by measuring — this crate does not read audio.
    pub fn normalize(&mut self, measured_peak: f32, target_db: f32) {
        if measured_peak <= 0.0 {
            return; // silence cannot be normalised
        }
        let target = 10f32.powf(target_db / 20.0);
        let factor = target / measured_peak;
        for c in &mut self.clips {
            c.gain *= factor;
        }
    }

    /// Apply what [`crate::analyse::silent_runs`] found.
    ///
    /// Peak's Strip Silence, which can either flatten the quiet parts or take
    /// them out. The runs are applied **back to front**: removing one shortens
    /// the timeline, and every run after it would then be pointing a little
    /// further along than it meant to.
    pub fn strip_silence(&mut self, runs: &[Range], mode: StripMode) {
        let mut runs: Vec<Range> = runs.iter().copied().filter(|r| !r.is_empty()).collect();
        runs.sort_by_key(|r| r.start);
        for r in runs.into_iter().rev() {
            match mode {
                StripMode::Silence => self.silence(r),
                StripMode::Remove => self.cut(r),
            }
        }
    }

    /// Take out a click and close the join so it cannot step.
    ///
    /// Peak repairs a click by redrawing the damaged samples, with the Pencil
    /// Tool or by interpolating across them. A clip list has no way to write a
    /// sample, so this removes the damage instead and ramps the two edges into
    /// the join over `taper` frames. A click is a handful of samples; losing a
    /// fraction of a millisecond of a recording is inaudible, and the taper is
    /// what makes the result *provably* free of a step rather than merely
    /// smaller than it was.
    ///
    /// The caller is expected to have snapped `range` to zero crossings first,
    /// which is what keeps the taper as short as it is.
    pub fn repair_click(&mut self, range: Range, taper: u64) {
        if range.is_empty() {
            return;
        }
        let total = self.base_frames();
        if range.start >= total {
            return;
        }
        self.cut(range);
        if taper == 0 {
            return;
        }
        let join = range.start;
        let now = self.base_frames();
        if join > 0 {
            let from = join.saturating_sub(taper);
            self.fade_out(Range::new(from, join), join - from, FadeShape::Linear);
        }
        if join < now {
            let to = (join + taper).min(now);
            self.fade_in(Range::new(join, to), to - join, FadeShape::Linear);
        }
    }

    /// Scale the document so its average level sits at `target_db`, without
    /// letting any peak pass `ceiling_db`.
    ///
    /// Both measurements come from the caller, for the same reason
    /// [`normalize`](Self::normalize) takes one: this crate does not read audio.
    ///
    /// **Where this differs from Peak.** Peak reaches an RMS target it cannot
    /// otherwise hit by soft-clipping into the ceiling, and says so. Here the
    /// ceiling wins outright and the result comes out quieter than asked. That
    /// is the honest half of the same bargain — nothing is distorted to make a
    /// number — and the channel maximiser is already there for anyone who wants
    /// the other half.
    pub fn normalize_rms(&mut self, measured_rms: f32, measured_peak: f32, target_db: f32, ceiling_db: f32) {
        if measured_rms <= 0.0 || !measured_rms.is_finite() {
            return; // silence has no average to raise
        }
        let target = 10f32.powf(target_db / 20.0);
        let ceiling = 10f32.powf(ceiling_db / 20.0);
        let mut factor = target / measured_rms;
        if measured_peak > 0.0 && measured_peak * factor > ceiling {
            factor = ceiling / measured_peak;
        }
        if !factor.is_finite() {
            return;
        }
        for c in &mut self.clips {
            c.gain *= factor;
        }
    }

    /// Index of the first and last clip overlapping `range`, after splitting.
    fn clip_span(&self, range: Range) -> Option<(usize, usize)> {
        let mut acc = 0u64;
        let (mut first, mut last) = (None, None);
        for (i, c) in self.clips.iter().enumerate() {
            let start = acc;
            let end = acc + c.len;
            acc = end;
            if end <= range.start || start >= range.end {
                continue;
            }
            first.get_or_insert(i);
            last = Some(i);
        }
        Some((first?, last?))
    }

    fn for_each_clip_in(&mut self, range: Range, mut f: impl FnMut(&mut Clip)) {
        if range.is_empty() {
            return;
        }
        self.split_at(range.start);
        self.split_at(range.end);
        let Some((first, last)) = self.clip_span(range) else {
            return;
        };
        for c in &mut self.clips[first..=last] {
            f(c);
        }
    }
}
