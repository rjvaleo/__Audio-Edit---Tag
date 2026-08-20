//! The picture for a video export, worked out offline.
//!
//! See `docs/VIDEO-EXPORT.md` for the design this is built to. The short of it:
//! the interface draws the room, and this decides what the room is drawing.
//!
//! **One analyser, not two.** `meter::spectrum` and `meter::lissajous` take
//! plain sample slices and know nothing about playback — they are fed from a
//! live scope snapshot today, and here they are fed from the rendered file
//! instead. Running the same two functions over the exact audio that lands in
//! the video is what keeps the picture honest: a second implementation in the
//! browser would drift from this one, and it would drift in the artefact people
//! actually publish.
//!
//! **The window is the scope's window.** Every frame is analysed over the last
//! [`SCOPE_FRAMES`] samples ending at that instant, which is exactly what the
//! live path hands the same functions. A different window would be a different
//! picture from the one on screen.
//!
//! **Offline, and faster than real time.** A forty-times stretch of a
//! three-minute file is a two-hour render if it is filmed as it plays. This
//! walks the rendered samples instead, so it takes what it takes.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use engine::transport::SCOPE_FRAMES;

/// The analysed reel: what the room draws, frame by frame, and the sound it is
/// drawn from.
pub struct Reel {
    pub fps: u32,
    pub bands: usize,
    pub liss: usize,
    pub rate: u32,
    pub channels: u16,
    /// `bands + liss * 2` floats per frame, laid end to end.
    pub data: Vec<f32>,
    /// The rendered audio, interleaved, **including the outro silence**, so the
    /// two streams are the same length and the file says one duration.
    pub audio: Vec<f32>,
}

impl Reel {
    pub fn frame_floats(&self) -> usize {
        self.bands + self.liss * 2
    }
    pub fn frames(&self) -> usize {
        if self.frame_floats() == 0 { 0 } else { self.data.len() / self.frame_floats() }
    }
}

#[derive(Default)]
pub struct Job {
    pub running: AtomicBool,
    pub done: AtomicU64,
    pub total: AtomicU64,
    pub cancel: AtomicBool,
    pub serial: AtomicU64,
    pub phase: Mutex<String>,
    pub error: Mutex<String>,
    pub reel: Mutex<Option<Reel>>,
}

impl Job {
    pub fn say(&self, s: &str) {
        if let Ok(mut x) = self.phase.lock() {
            *x = s.to_string();
        }
    }
    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }
    pub fn begin(&self, total: u64) {
        self.cancel.store(false, Ordering::Relaxed);
        self.done.store(0, Ordering::Relaxed);
        self.total.store(total.max(1), Ordering::Relaxed);
        if let Ok(mut x) = self.error.lock() {
            x.clear();
        }
        if let Ok(mut x) = self.reel.lock() {
            *x = None;
        }
        self.say("analysing");
    }
}

/// The one job. Held here rather than on `App` because it is a workspace for a
/// single export rather than part of the program's state — nothing else reads
/// it, and it is thrown away when the next one starts.
pub fn job() -> &'static Job {
    static JOB: OnceLock<Job> = OnceLock::new();
    JOB.get_or_init(Job::default)
}

/// Analyse rendered audio into a reel.
///
/// `audio` is interleaved at `channels`. `outro` is how long the picture runs
/// past the sound, in seconds — **derived by the caller** from the room's own
/// two constants (how many frames of terrain it holds, and how often they are
/// pushed), because those live in the interface and a copy here would be a
/// second place to change them.
#[allow(clippy::too_many_arguments)]
pub fn analyse(
    audio: &[f32],
    channels: u16,
    rate: u32,
    fps: u32,
    fft: usize,
    bands: usize,
    lo: f32,
    hi: f32,
    liss: usize,
    outro: f32,
    on_progress: &dyn Fn(u64) -> bool,
) -> Option<Reel> {
    let ch = channels.max(1) as usize;
    let frames_in = audio.len() / ch;
    let rate = rate.max(1);
    let fps = fps.clamp(1, 240);

    // The picture outlives the sound: the terrain pushed in the last instant is
    // still on its way to the back wall. Cut on the final sample and the room
    // is chopped mid-journey.
    let pad = (outro.max(0.0) * rate as f32).round() as usize;
    let total_frames_audio = frames_in + pad;
    let video_frames = ((total_frames_audio as f64 * fps as f64) / rate as f64).ceil() as usize;

    // De-interleave once. Every video frame reads a window out of these, and
    // doing it per frame would be the same work sixty times a second.
    let mut left = vec![0.0f32; total_frames_audio];
    let mut right = vec![0.0f32; total_frames_audio];
    for i in 0..frames_in {
        left[i] = audio[i * ch];
        right[i] = if ch > 1 { audio[i * ch + 1] } else { audio[i * ch] };
    }
    // The rest stays zero, which is the silence the room drains over.

    let per = bands + liss * 2;
    let mut data = Vec::with_capacity(video_frames * per);

    for k in 0..video_frames {
        if !on_progress(k as u64) {
            return None;
        }
        // The instant this frame is taken at, and the scope's own window ending
        // there — the same slice the live path hands these functions.
        let at = ((k as f64 + 1.0) * rate as f64 / fps as f64).round() as usize;
        let end = at.min(total_frames_audio);
        let start = end.saturating_sub(SCOPE_FRAMES);
        let l = &left[start..end];
        let r = &right[start..end];

        let spec = audio_core::meter::spectrum(l, r, rate, fft, bands, lo, hi);
        data.extend_from_slice(&spec);
        // Shorter than `bands` only if the analyser was asked for fewer than it
        // returned, which would put every later frame out of step.
        if spec.len() < bands {
            data.extend(std::iter::repeat(0.0).take(bands - spec.len()));
        }

        let pts = audio_core::meter::lissajous(l, r, liss);
        for i in 0..liss {
            let (a, b) = pts.get(i).copied().unwrap_or((0.0, 0.0));
            data.push(a);
            data.push(b);
        }
    }

    // The audio track runs the whole way and the outro is silence *in it* —
    // real samples, all zero, to the last video frame. A file whose streams end
    // at different times is one that some players stop early and some pad
    // themselves, and the duration it reports is not the one it plays.
    let mut out_audio = Vec::with_capacity(total_frames_audio * ch);
    for i in 0..total_frames_audio {
        for c in 0..ch {
            out_audio.push(if i < frames_in { audio[i * ch + c] } else { 0.0 });
        }
    }

    Some(Reel {
        fps,
        bands,
        liss,
        rate,
        channels: channels.max(1),
        data,
        audio: out_audio,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(frames: usize, rate: u32) -> Vec<f32> {
        (0..frames)
            .flat_map(|i| {
                let t = i as f32 / rate as f32;
                let v = (t * 440.0 * std::f32::consts::TAU).sin() * 0.5;
                [v, v * 0.5]
            })
            .collect()
    }

    #[test]
    fn the_picture_runs_past_the_sound() {
        let rate = 48_000;
        let audio = tone(rate as usize, rate); // one second
        let reel = analyse(&audio, 2, rate, 30, 2048, 64, 40.0, 16_000.0, 256, 2.8, &|_| true)
            .expect("analysis was cancelled");
        // One second of sound, 2.8 of room draining, at thirty a second.
        assert_eq!(reel.frames(), ((1.0 + 2.8) * 30.0f64).ceil() as usize);
        // And the audio is as long as the picture, not as long as the sound.
        let secs = reel.audio.len() as f64 / reel.channels as f64 / rate as f64;
        assert!((secs - 3.8).abs() < 0.01, "audio is {secs}s, wanted 3.8");
    }

    #[test]
    fn the_outro_is_silence_and_the_sound_is_not() {
        let rate = 48_000;
        let audio = tone(rate as usize, rate);
        let reel = analyse(&audio, 2, rate, 30, 2048, 64, 40.0, 16_000.0, 256, 2.8, &|_| true)
            .unwrap();
        let ch = reel.channels as usize;
        let sounding = &reel.audio[..(rate as usize) * ch];
        let quiet = &reel.audio[(rate as usize) * ch..];
        assert!(sounding.iter().any(|v| v.abs() > 0.1), "the sound did not survive");
        assert!(quiet.iter().all(|v| *v == 0.0), "the outro is not silent");
    }

    #[test]
    fn every_frame_is_the_same_size() {
        let rate = 48_000;
        let audio = tone(rate as usize / 2, rate);
        let reel = analyse(&audio, 2, rate, 60, 1024, 32, 40.0, 16_000.0, 128, 0.5, &|_| true)
            .unwrap();
        assert_eq!(reel.frame_floats(), 32 + 128 * 2);
        assert_eq!(reel.data.len(), reel.frames() * reel.frame_floats());
        assert!(reel.frames() > 0);
    }

    /// A mono file is not a special case anywhere else and is not one here.
    #[test]
    fn mono_reads_as_both_channels() {
        let rate = 48_000;
        let audio: Vec<f32> = (0..rate as usize).map(|i| (i as f32 * 0.01).sin()).collect();
        let reel = analyse(&audio, 1, rate, 30, 1024, 16, 40.0, 16_000.0, 64, 0.0, &|_| true)
            .unwrap();
        assert_eq!(reel.channels, 1);
        assert!(reel.frames() > 0);
    }

    /// Cancelling stops it, rather than finishing and throwing the work away.
    #[test]
    fn it_can_be_stopped_part_way() {
        let rate = 48_000;
        let audio = tone(rate as usize * 4, rate);
        let seen = std::sync::atomic::AtomicU64::new(0);
        let out = analyse(&audio, 2, rate, 30, 1024, 16, 40.0, 16_000.0, 64, 0.0, &|k| {
            seen.store(k, Ordering::Relaxed);
            k < 10
        });
        assert!(out.is_none(), "a cancelled analysis handed back a reel");
        assert!(seen.load(Ordering::Relaxed) <= 11);
    }
}
