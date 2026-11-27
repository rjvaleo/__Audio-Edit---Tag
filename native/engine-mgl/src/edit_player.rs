//! The Edit module's transport: it plays the sound on its cable as MGL's
//! transport plays a document (`core/crates/engine/src/transport`), without
//! the grain deck or the rack in between (on the canvas, Grain plays the
//! document its own way).
//!
//! As MGL's: play from where the head is; past the end with the loop off it
//! stops, the head left at the end; with the loop on it goes round the loop
//! (the selection, or the whole sound when `b` is 0), and a head outside the
//! loop goes to its start at once. A lap reads straight on, with no fade at
//! the seam (MGL's `loop_fade` for an engine whose lap does not seek).
//!
//! Like MGL's `Shared`, the controls are atomics the app sets and the audio
//! thread reads once a block: play, a seek, the loop. The head and the level
//! are published back the same way. Nothing here allocates or waits.

use engine_core::{Io, Kind, Module, SoundRef};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

/// What the app and the audio thread share, in the sound's own frames (the
/// bank's, at the engine's rate).
pub struct Transport {
    playing: AtomicBool,
    /// A seek asked for, or -1.
    seek: AtomicI64,
    loop_on: AtomicBool,
    loop_a: AtomicU64,
    loop_b: AtomicU64,
    /// Where the head is, after the last block.
    position: AtomicU64,
    /// The last block's peak, each side, as `f32` bits.
    peak_l: AtomicU32,
    peak_r: AtomicU32,
    /// Bumped each block that played, so a reader knows the head moved.
    blocks: AtomicU64,
    /// The volume (the bar's fader), as `f32` bits; 1 is the sound as it is.
    gain: AtomicU32,
}

impl Transport {
    pub fn new() -> Arc<Transport> {
        Arc::new(Transport {
            playing: AtomicBool::new(false),
            seek: AtomicI64::new(-1),
            loop_on: AtomicBool::new(false),
            loop_a: AtomicU64::new(0),
            loop_b: AtomicU64::new(0),
            position: AtomicU64::new(0),
            peak_l: AtomicU32::new(0),
            peak_r: AtomicU32::new(0),
            blocks: AtomicU64::new(0),
            gain: AtomicU32::new(1.0f32.to_bits()),
        })
    }

    pub fn play(&self, on: bool) {
        self.playing.store(on, Ordering::Release);
    }

    pub fn is_playing(&self) -> bool {
        self.playing.load(Ordering::Acquire)
    }

    /// Put the head at `frame`, from the next block.
    pub fn seek(&self, frame: u64) {
        self.position.store(frame, Ordering::Release);
        self.seek.store(frame.min(i64::MAX as u64) as i64, Ordering::Release);
    }

    /// The loop: on or off, and its ends (`b` 0 is the whole sound).
    pub fn set_loop(&self, on: bool, a: u64, b: u64) {
        self.loop_a.store(a, Ordering::Release);
        self.loop_b.store(b, Ordering::Release);
        self.loop_on.store(on, Ordering::Release);
    }

    /// The volume: every sample times this (1 leaves it to the bit).
    pub fn set_gain(&self, g: f32) {
        self.gain.store(g.clamp(0.0, 4.0).to_bits(), Ordering::Relaxed);
    }

    pub fn gain(&self) -> f32 {
        f32::from_bits(self.gain.load(Ordering::Relaxed))
    }

    pub fn position(&self) -> u64 {
        self.position.load(Ordering::Acquire)
    }

    /// The last block's peak, left and right.
    pub fn peaks(&self) -> (f32, f32) {
        (f32::from_bits(self.peak_l.load(Ordering::Relaxed)), f32::from_bits(self.peak_r.load(Ordering::Relaxed)))
    }

    pub fn blocks(&self) -> u64 {
        self.blocks.load(Ordering::Relaxed)
    }
}

/// The module: a sound in, its audio out.
pub struct EditPlayer {
    transport: Arc<Transport>,
    at: u64,
}

impl EditPlayer {
    pub fn new(transport: Arc<Transport>) -> EditPlayer {
        let at = transport.position();
        EditPlayer { transport, at }
    }
}

impl Module for EditPlayer {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Sound]
    }

    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }

    fn process(&mut self, io: &mut Io) {
        let t = &*self.transport;
        let sought = t.seek.swap(-1, Ordering::AcqRel);
        if sought >= 0 {
            self.at = sought as u64;
        }
        let sound: SoundRef = io.ins.sound(0);
        let sounds = io.sounds;
        let (l, r) = io.outs.audio(0);
        let data = sounds.get(sound).filter(|d| d.frames() > 0);
        let Some(data) = data else {
            l.fill(0.0);
            r.fill(0.0);
            t.peak_l.store(0, Ordering::Relaxed);
            t.peak_r.store(0, Ordering::Relaxed);
            return;
        };
        let end = data.frames() as u64;
        // A sound made shorter by an edit leaves the head no further than its end.
        self.at = self.at.min(end);
        if !t.playing.load(Ordering::Acquire) {
            l.fill(0.0);
            r.fill(0.0);
            t.peak_l.store(0, Ordering::Relaxed);
            t.peak_r.store(0, Ordering::Relaxed);
            t.position.store(self.at, Ordering::Release);
            return;
        }
        // The loop, resolved: `b` 0 is the whole sound, and a loop is never
        // longer than the sound.
        let bounds = t.loop_on.load(Ordering::Acquire).then(|| {
            let a = t.loop_a.load(Ordering::Acquire).min(end);
            let b = t.loop_b.load(Ordering::Acquire);
            let b = if b == 0 { end } else { b.min(end) };
            (a, b)
        }).filter(|(a, b)| b > a);
        // Wrap first if the head is already at or past the loop's end, or
        // before its start, so a loop set behind the head takes at once.
        if let Some((a, b)) = bounds {
            if self.at >= b || self.at < a {
                self.at = a;
            }
        }
        let gain = t.gain();
        let (mut pl, mut pr) = (0.0f32, 0.0f32);
        for i in 0..l.len() {
            if let Some((a, b)) = bounds {
                if self.at >= b {
                    self.at = a;
                }
            }
            if self.at >= end {
                // Not looping and past the end: stop, the head left there.
                l[i..].fill(0.0);
                r[i..].fill(0.0);
                t.playing.store(false, Ordering::Release);
                break;
            }
            let (x, y) = (data.l[self.at as usize] * gain, data.r[self.at as usize] * gain);
            l[i] = x;
            r[i] = y;
            pl = pl.max(x.abs());
            pr = pr.max(y.abs());
            self.at += 1;
        }
        t.peak_l.store(pl.to_bits(), Ordering::Relaxed);
        t.peak_r.store(pr.to_bits(), Ordering::Relaxed);
        t.position.store(self.at, Ordering::Release);
        t.blocks.fetch_add(1, Ordering::Relaxed);
    }
}
