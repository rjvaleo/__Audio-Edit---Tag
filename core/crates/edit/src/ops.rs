//! Edit operations.
//!
//! Every one of these rewrites the clip list and nothing else. No audio is read
//! or written here — that only happens in [`crate::render`].

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
        let total = self.frames();
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
    pub fn silence(&mut self, range: Range) {
        self.for_each_clip_in(range, |c| c.gain = 0.0);
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
        let end = (range.start + frames).min(self.frames());
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
