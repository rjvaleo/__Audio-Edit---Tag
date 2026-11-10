//! Time stretch and pitch shift.
//!
//! The two properties that matter are opposites of each other: stretching must
//! change the length and *not* the pitch; shifting must change the pitch and
//! *not* the length. Both are measured on real signals.

use fx::stretch::{Algorithm, Quality, Stretch};

const SR: u32 = 48000;

fn sine(freq: f32, frames: usize, amp: f32) -> Vec<f32> {
    (0..frames)
        .map(|i| amp * (2.0 * std::f32::consts::PI * freq * i as f32 / SR as f32).sin())
        .collect()
}

/// Estimate frequency from zero crossings over the steady middle of a buffer.
///
/// Crude, but exact enough for a clean tone and free of any dependency on the
/// FFT this crate does not have.
fn est_freq(buf: &[f32], channels: usize) -> f32 {
    let frames = buf.len() / channels;
    let a = frames / 4;
    let b = frames * 3 / 4;
    let mut crossings = 0usize;
    let mut prev = buf[a * channels];
    for f in a + 1..b {
        let v = buf[f * channels];
        if prev <= 0.0 && v > 0.0 {
            crossings += 1;
        }
        prev = v;
    }
    let secs = (b - a) as f32 / SR as f32;
    crossings as f32 / secs
}

fn rms(buf: &[f32]) -> f32 {
    if buf.is_empty() {
        return 0.0;
    }
    (buf.iter().map(|v| v * v).sum::<f32>() / buf.len() as f32).sqrt()
}

fn stretch(ratio: f32, semitones: f32) -> Stretch {
    Stretch { ratio, semitones, window_ms: 40.0, quality: Quality::Standard,
              grain: fx::Grain::default(), ..Default::default() }
}

use fx::Grain;

mod basics;
mod granular;
mod stream;
mod controls;
use controls::*;
mod new_engines;
