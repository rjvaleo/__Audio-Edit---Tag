//! The sequencer's sound, on the engine's own output.
//!
//! The scale sequencer is Web Audio in the page. Played through the browser it
//! meets the engine in the air: close, never to the sample, and never twice the
//! same, because two programs each start their own sound card when they get
//! round to it. Played through here, every sample of it is put on the engine's
//! own output frame — the frame the engine renders the grain at — and the two
//! leave through one device together.
//!
//! **How the sound gets here.** The page runs the sequencer a little ahead of
//! the engine, stamps each run of its samples with the output frame they belong
//! at, and posts them (`POST /api/engine/seq`). This holds them until the audio
//! callback reaches that frame, and the callback adds them in.
//!
//! **Nothing here may block the callback or allocate in it.** The ring is
//! atomics, addressed by the frame modulo its size, and every slot is tagged
//! with the frame it holds. The callback reads a slot, checks its tag and takes
//! it — so a frame played again round a loop needs fresh sound, and can never
//! play the pass before. Writers are request threads and queue among
//! themselves on a mutex the callback never touches.
//!
//! **Epochs.** Every Play and every seek is a new epoch, told to both sides. A
//! run stamped with an older one is refused, so sound that was still on its way
//! from before a seek cannot land after it; a newer one drops everything held.
//! A stop is not an epoch: what is held is what the callback fades out on.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;

/// Frames the ring holds: about three seconds at 44.1 kHz. It only ever needs
/// what the page sends ahead of the engine — a tenth of a second or so — and
/// the rest is room for a page that falls behind and catches up.
pub const SEQ_BUS_FRAMES: usize = 1 << 17;

/// How long the sequencer takes to fade out when the transport stops, in
/// frames: ten milliseconds at 48 kHz. Stopping dead mid-note is a click.
pub const SEQ_STOP_FADE_FRAMES: usize = 480;

pub struct SeqBus {
    left: Box<[AtomicU32]>,
    right: Box<[AtomicU32]>,
    /// The frame each slot holds, plus one; nought for none.
    tags: Box<[AtomicU64]>,
    epoch: AtomicU64,
    /// Written to since the last epoch began. The callback does not look at a
    /// bus nobody is sending to.
    active: AtomicBool,
    writer: Mutex<()>,
    /// Frames the callback found and mixed.
    pub mixed: AtomicU64,
    /// Frames the callback went looking for while the bus was active and did
    /// not find — sound that came late, or not at all.
    pub missing: AtomicU64,
    /// Frames refused on arrival: already behind the engine, or from an epoch
    /// that has ended.
    pub refused: AtomicU64,
}

impl SeqBus {
    /// A ring of at least `frames`, rounded up to a power of two.
    pub fn new(frames: usize) -> Self {
        let n = frames.max(1024).next_power_of_two();
        SeqBus {
            left: (0..n).map(|_| AtomicU32::new(0)).collect(),
            right: (0..n).map(|_| AtomicU32::new(0)).collect(),
            tags: (0..n).map(|_| AtomicU64::new(0)).collect(),
            epoch: AtomicU64::new(0),
            active: AtomicBool::new(false),
            writer: Mutex::new(()),
            mixed: AtomicU64::new(0),
            missing: AtomicU64::new(0),
            refused: AtomicU64::new(0),
        }
    }

    pub fn capacity(&self) -> usize {
        self.tags.len()
    }

    pub fn epoch(&self) -> u64 {
        self.epoch.load(Ordering::Acquire)
    }

    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::Acquire)
    }

    /// Begin a newer epoch: everything held is dropped and the bus goes quiet
    /// until something is sent under it. An epoch no newer than the current one
    /// changes nothing. Returns whether it moved.
    pub fn advance(&self, epoch: u64) -> bool {
        let Ok(_w) = self.writer.lock() else { return false };
        self.advance_held(epoch)
    }

    fn advance_held(&self, epoch: u64) -> bool {
        if epoch <= self.epoch.load(Ordering::Acquire) {
            return false;
        }
        self.epoch.store(epoch, Ordering::Release);
        self.active.store(false, Ordering::Release);
        for t in self.tags.iter() {
            t.store(0, Ordering::Release);
        }
        true
    }

    /// Put a run of interleaved frames on output frames `at` onward, for
    /// `epoch`. `now` is where the engine is and `bounds` the loop it is going
    /// round, which together say what is still ahead of it; a frame already
    /// behind it is refused. Returns how many frames were kept.
    pub fn write(
        &self,
        epoch: u64,
        at: u64,
        samples: &[f32],
        channels: usize,
        now: u64,
        bounds: Option<(u64, u64)>,
    ) -> usize {
        let ch = channels.max(1);
        let frames = samples.len() / ch;
        let Ok(_w) = self.writer.lock() else { return 0 };
        let current = self.epoch.load(Ordering::Acquire);
        if epoch < current {
            self.refused.fetch_add(frames as u64, Ordering::Relaxed);
            return 0;
        }
        if epoch > current {
            self.advance_held(epoch);
        }
        let mask = self.tags.len() - 1;
        let horizon = self.tags.len() as u64;
        let mut kept = 0usize;
        for i in 0..frames {
            let f = at + i as u64;
            if !ahead(f, now, bounds, horizon) {
                continue;
            }
            let (l, r) = if ch == 1 {
                (samples[i], samples[i])
            } else {
                (samples[i * ch], samples[i * ch + 1])
            };
            let slot = (f as usize) & mask;
            // Untagged while it is written, so a read in between finds nothing
            // rather than half of two frames.
            self.tags[slot].store(0, Ordering::Release);
            self.left[slot].store(l.to_bits(), Ordering::Release);
            self.right[slot].store(r.to_bits(), Ordering::Release);
            self.tags[slot].store(f + 1, Ordering::Release);
            kept += 1;
        }
        if kept > 0 {
            self.active.store(true, Ordering::Release);
        }
        self.refused.fetch_add((frames - kept) as u64, Ordering::Relaxed);
        kept
    }

    /// The callback's read: output frame `f`, if it is here, taken so it cannot
    /// be played twice. Never blocks and never allocates.
    #[inline]
    pub fn take(&self, f: u64) -> Option<(f32, f32)> {
        let slot = (f as usize) & (self.tags.len() - 1);
        let tag = self.tags[slot].load(Ordering::Acquire);
        if tag != f.wrapping_add(1) {
            return None;
        }
        let l = f32::from_bits(self.left[slot].load(Ordering::Acquire));
        let r = f32::from_bits(self.right[slot].load(Ordering::Acquire));
        self.tags[slot]
            .compare_exchange(tag, 0, Ordering::AcqRel, Ordering::Acquire)
            .ok()?;
        Some((l, r))
    }
}

/// Whether output frame `f` is still ahead of an engine at `now`: at or after
/// it and within `horizon` — or, going round a loop, reached from `now` by
/// playing on to the loop's end and round again, within the horizon. A frame
/// outside a loop the engine is inside will never be played.
pub fn ahead(f: u64, now: u64, bounds: Option<(u64, u64)>, horizon: u64) -> bool {
    match bounds {
        Some((a, b)) if b > a && now >= a && now < b => {
            if f < a || f >= b {
                return false;
            }
            let d = if f >= now { f - now } else { (b - now) + (f - a) };
            d < horizon
        }
        _ => f >= now && f - now < horizon,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_frame_is_held_until_it_is_taken_and_then_it_is_gone() {
        let bus = SeqBus::new(4096);
        assert_eq!(bus.write(1, 500, &[0.25, -0.25, 0.5, -0.5], 2, 0, None), 2);
        assert!(bus.is_active());
        assert_eq!(bus.take(500), Some((0.25, -0.25)));
        assert_eq!(bus.take(500), None, "a frame played twice");
        assert_eq!(bus.take(501), Some((0.5, -0.5)));
        assert_eq!(bus.take(502), None);
    }

    #[test]
    fn a_frame_at_the_same_place_in_the_ring_is_not_another_frame() {
        let bus = SeqBus::new(1024);
        let cap = bus.capacity() as u64;
        bus.write(1, 7, &[0.1, 0.1], 2, 0, None);
        assert_eq!(bus.take(7 + cap), None, "a frame a ring away was taken for this one");
        assert_eq!(bus.take(7), Some((0.1, 0.1)));
    }

    #[test]
    fn a_mono_run_is_put_on_both_sides() {
        let bus = SeqBus::new(1024);
        bus.write(1, 10, &[0.3, 0.4], 1, 0, None);
        assert_eq!(bus.take(10), Some((0.3, 0.3)));
        assert_eq!(bus.take(11), Some((0.4, 0.4)));
    }

    #[test]
    fn an_older_epoch_is_refused_and_a_newer_one_drops_what_was_held() {
        let bus = SeqBus::new(1024);
        bus.write(3, 100, &[0.5, 0.5], 2, 0, None);
        assert_eq!(bus.write(2, 101, &[0.7, 0.7], 2, 0, None), 0, "sound from before a seek landed after it");
        assert_eq!(bus.take(101), None);
        assert!(!bus.advance(3), "the same epoch began again");
        assert!(bus.advance(4));
        assert!(!bus.is_active(), "a new epoch left the bus listening");
        assert_eq!(bus.take(100), None, "a new epoch kept the old sound");
        assert_eq!(bus.write(5, 200, &[0.2, 0.2], 2, 0, None), 1);
        assert_eq!(bus.epoch(), 5, "a newer epoch in a write did not begin");
    }

    #[test]
    fn sound_already_behind_the_engine_is_refused() {
        let bus = SeqBus::new(1024);
        let run = [0.1f32; 8];
        assert_eq!(bus.write(1, 996, &run, 2, 1000, None), 0);
        assert_eq!(bus.write(1, 998, &run, 2, 1000, None), 2);
        assert_eq!(bus.refused.load(Ordering::Relaxed), 6);
    }

    #[test]
    fn round_a_loop_the_next_pass_is_ahead_and_outside_the_loop_is_not() {
        let h = 1 << 17;
        // Near the end of a loop from 1000 to 2000, the loop's start is next.
        assert!(ahead(1010, 1990, Some((1000, 2000)), h));
        assert!(ahead(1995, 1990, Some((1000, 2000)), h));
        assert!(!ahead(2005, 1990, Some((1000, 2000)), h), "past the loop's end is never played");
        assert!(!ahead(900, 1990, Some((1000, 2000)), h));
        // With no loop, only what is still to come.
        assert!(!ahead(1010, 1990, None, h));
        assert!(ahead(1990, 1990, None, h));
        // Too far ahead is not a frame for now.
        assert!(!ahead(1990 + h, 1990, None, h));
    }
}
