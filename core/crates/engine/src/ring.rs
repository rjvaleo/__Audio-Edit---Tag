//! A circular buffer of recent output, for grains that read what just came out.
//!
//! The sixth engine samples its own output rather than the file, so something
//! has to keep the last few seconds of it. That is this.
//!
//! It lives on [`Core`](crate::transport::Core) — the audio thread's own state —
//! because both the write and the read happen inside the callback and nothing
//! else ever touches it. No mutex, no atomics, no handover. The capacity is
//! fixed at construction and never changes, for the usual reason: a callback
//! may not allocate.
//!
//! **Why the schedule stays pure.** `fx::grain` decides *when* every grain
//! starts, how long it is, its pitch and pan — all pure functions of grain index
//! and seed, and none of it touched by this. Only the *content* of a grain
//! becomes recursive, and content is read here in `engine`, which is why the
//! ring can exist without `fx` knowing about it and why the visualiser can still
//! draw the cloud ahead of the sound.

/// Recent output, oldest overwritten first.
pub struct OutputRing {
    /// Interleaved, `frames * channels` long, allocated once.
    samples: Vec<f32>,
    channels: usize,
    frames: usize,
    /// Frames ever written, monotonic and never wrapped.
    ///
    /// Counting forever rather than storing a cursor is what makes "how far
    /// back may I still read" answerable: anything older than `written -
    /// frames` has been overwritten, and a wrapped cursor could not tell the
    /// difference between that and a buffer which has been around the loop
    /// exactly once.
    written: u64,
}

impl OutputRing {
    /// A ring holding `frames` of `channels`-channel audio, zeroed.
    pub fn new(frames: usize, channels: usize) -> Self {
        let channels = channels.max(1);
        OutputRing {
            samples: vec![0.0; frames * channels],
            channels,
            frames,
            written: 0,
        }
    }

    pub fn frames(&self) -> usize {
        self.frames
    }

    pub fn channels(&self) -> usize {
        self.channels
    }

    /// Frames ever written. Not a position — it does not wrap.
    pub fn written(&self) -> u64 {
        self.written
    }

    /// Forget everything, without giving up the allocation.
    ///
    /// `written` goes back to zero as well, so a read straight afterwards finds
    /// nothing rather than finding whatever was in the buffer before.
    pub fn clear(&mut self) {
        self.samples.fill(0.0);
        self.written = 0;
    }

    /// Append a block of interleaved output.
    ///
    /// A block whose channel count differs from the ring's is conformed the
    /// same way the device does it — widening repeats the last channel rather
    /// than going silent, narrowing drops the extras — so a mono file into a
    /// stereo ring fills both sides.
    pub fn write(&mut self, block: &[f32], channels: usize) {
        if self.frames == 0 || channels == 0 || block.is_empty() {
            return;
        }
        let n = block.len() / channels;
        for f in 0..n {
            let slot = ((self.written + f as u64) % self.frames as u64) as usize;
            for ch in 0..self.channels {
                let src = ch.min(channels - 1);
                self.samples[slot * self.channels + ch] = block[f * channels + src];
            }
        }
        self.written += n as u64;
    }

    /// Read `frames_ago` frames behind the newest, interpolated.
    ///
    /// Zero is the most recent frame written. Fractional positions interpolate
    /// linearly, matching `sample_at` in the two renderers — if this ever
    /// disagreed with them, a grain would sound different depending on which
    /// buffer it happened to be reading.
    ///
    /// Returns silence rather than nonsense in every degenerate case: reading
    /// before anything was written, reading further back than the ring holds,
    /// a channel that does not exist, or a position that is not a number. A
    /// feedback path that reads garbage does not produce a glitch, it produces
    /// a glitch that then feeds itself.
    pub fn read(&self, frames_ago: f32, ch: usize) -> f32 {
        if self.frames == 0 || ch >= self.channels || !frames_ago.is_finite() || self.written == 0 {
            return 0.0;
        }
        // Absolute frame, fractional, counting back from the newest.
        let pos = (self.written - 1) as f64 - frames_ago.max(0.0) as f64;
        if pos < 0.0 {
            return 0.0;
        }
        let a = pos.floor() as u64;
        // Older than the ring still holds: overwritten, and gone.
        if self.written - a > self.frames as u64 {
            return 0.0;
        }
        let t = (pos - a as f64) as f32;
        // Never read ahead of the newest frame, even by interpolation.
        let b = (a + 1).min(self.written - 1);
        let ia = (a % self.frames as u64) as usize;
        let ib = (b % self.frames as u64) as usize;
        let s0 = self.samples[ia * self.channels + ch];
        let s1 = self.samples[ib * self.channels + ch];
        s0 + (s1 - s0) * t
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A ramp, so every frame is identifiable by its value.
    fn ramp(from: u64, n: usize, channels: usize) -> Vec<f32> {
        (0..n)
            .flat_map(|f| (0..channels).map(move |ch| (from + f as u64) as f32 + ch as f32 * 0.5))
            .collect()
    }

    #[test]
    fn nothing_written_reads_as_silence() {
        let r = OutputRing::new(128, 2);
        assert_eq!(r.read(0.0, 0), 0.0);
        assert_eq!(r.read(50.0, 1), 0.0);
        assert_eq!(r.written(), 0);
    }

    #[test]
    fn zero_frames_ago_is_the_newest_frame() {
        let mut r = OutputRing::new(128, 2);
        r.write(&ramp(0, 10, 2), 2);
        // Ten frames written, so the newest is frame 9.
        assert_eq!(r.read(0.0, 0), 9.0);
        assert_eq!(r.read(0.0, 1), 9.5);
        assert_eq!(r.read(3.0, 0), 6.0);
    }

    #[test]
    fn reading_further_back_than_was_written_is_silence_not_wraparound() {
        let mut r = OutputRing::new(128, 1);
        r.write(&ramp(0, 4, 1), 1);
        assert_eq!(r.read(3.0, 0), 0.0, "the oldest frame written");
        assert_eq!(r.read(4.0, 0), 0.0, "one before anything existed");
        assert_eq!(r.read(1000.0, 0), 0.0);
    }

    /// The reason `written` is monotonic. A wrapped cursor could not tell a
    /// buffer that has been round once from one that has not moved.
    #[test]
    fn material_older_than_the_ring_is_gone_rather_than_stale() {
        let mut r = OutputRing::new(8, 1);
        r.write(&ramp(0, 20, 1), 1);
        // Newest is 19; the ring holds 8 frames, so 12..=19 survive.
        assert_eq!(r.read(0.0, 0), 19.0);
        assert_eq!(r.read(7.0, 0), 12.0, "the oldest frame still held");
        assert_eq!(r.read(8.0, 0), 0.0, "one past what the ring can hold");
    }

    #[test]
    fn writing_past_the_end_wraps_rather_than_growing() {
        let mut r = OutputRing::new(8, 2);
        let before = r.frames();
        r.write(&ramp(0, 100, 2), 2);
        assert_eq!(r.frames(), before, "capacity is fixed");
        assert_eq!(r.written(), 100);
        assert_eq!(r.read(0.0, 0), 99.0);
    }

    #[test]
    fn a_fractional_read_interpolates_between_neighbours() {
        let mut r = OutputRing::new(64, 1);
        r.write(&ramp(0, 10, 1), 1);
        // Between frame 8 and frame 7, a quarter of the way back.
        let v = r.read(0.5, 0);
        assert!((v - 8.5).abs() < 1e-4, "expected 8.5, got {v}");
    }

    #[test]
    fn interpolation_never_reads_ahead_of_the_newest_frame() {
        let mut r = OutputRing::new(64, 1);
        r.write(&ramp(0, 10, 1), 1);
        // Sitting exactly on the newest frame, the upper neighbour would be
        // one frame into the future. It must hold rather than read whatever
        // the ring has there from last time round.
        assert_eq!(r.read(0.0, 0), 9.0);
    }

    #[test]
    fn a_mono_block_fills_both_sides_of_a_stereo_ring() {
        let mut r = OutputRing::new(16, 2);
        r.write(&[1.0, 2.0, 3.0], 1);
        assert_eq!(r.read(0.0, 0), 3.0);
        assert_eq!(r.read(0.0, 1), 3.0, "widening repeats rather than silencing");
    }

    #[test]
    fn a_block_with_more_channels_than_the_ring_drops_the_extras() {
        let mut r = OutputRing::new(16, 1);
        r.write(&[1.0, 9.0, 2.0, 9.0], 2);
        assert_eq!(r.read(0.0, 0), 2.0);
    }

    #[test]
    fn clearing_forgets_rather_than_leaving_the_old_audio_readable() {
        let mut r = OutputRing::new(16, 1);
        r.write(&ramp(0, 16, 1), 1);
        r.clear();
        assert_eq!(r.written(), 0);
        assert_eq!(r.read(0.0, 0), 0.0);
        assert_eq!(r.read(5.0, 0), 0.0);
    }

    #[test]
    fn nonsense_is_silence_rather_than_a_panic() {
        let mut r = OutputRing::new(16, 2);
        r.write(&ramp(0, 16, 2), 2);
        assert_eq!(r.read(f32::NAN, 0), 0.0);
        assert_eq!(r.read(f32::INFINITY, 0), 0.0);
        assert_eq!(r.read(-5.0, 0), 15.0, "negative is clamped to the newest");
        assert_eq!(r.read(0.0, 7), 0.0, "a channel that does not exist");
    }

    #[test]
    fn an_empty_ring_accepts_writes_without_panicking() {
        let mut r = OutputRing::new(0, 2);
        r.write(&ramp(0, 10, 2), 2);
        assert_eq!(r.read(0.0, 0), 0.0);
    }

    /// Blocks arrive at whatever size the device chose, and the ring must not
    /// care — the seam between two writes is not a seam in the audio.
    #[test]
    fn many_small_writes_match_one_large_one() {
        let mut a = OutputRing::new(256, 2);
        let mut b = OutputRing::new(256, 2);
        let block = ramp(0, 200, 2);
        a.write(&block, 2);
        for chunk in block.chunks(2 * 7) {
            b.write(chunk, 2);
        }
        assert_eq!(a.written(), b.written());
        for back in [0.0, 1.0, 13.5, 99.0, 199.0] {
            assert_eq!(a.read(back, 0), b.read(back, 0), "at {back} frames back");
            assert_eq!(a.read(back, 1), b.read(back, 1), "at {back} frames back");
        }
    }
}
