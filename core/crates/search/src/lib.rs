//! Finding sounds by what they sound like.
//!
//! No model and no learned embedding. A fingerprint here is a short vector of
//! things that can be measured directly from the samples and that correspond to
//! what someone means when they say two sounds are alike: how long it is, how
//! loud, how bright, how noisy, how sharply it starts, how it is spread across
//! the spectrum.
//!
//! That is a real limitation and worth stating plainly: this finds sounds that
//! are acoustically similar. It does not know that a sound is "menacing" or
//! "eighties". A learned audio-text embedding would, at the cost of a large
//! model and the cross-platform build. Everything here is arranged so that such
//! a backend could replace [`Fingerprint::of`] without disturbing the store,
//! the ranking or the interface.
//!
//! Dimensions are scaled so that a step in one is worth roughly a step in
//! another — otherwise duration, measured in seconds, would swamp everything
//! else and "similar" would collapse to "about as long".

pub mod store;

use audio_core::{fft, RandomAccessSource, Reader};

/// How many numbers describe a sound.
pub const DIMS: usize = 10;

/// What each dimension means, in order. Used by the API so the interface can
/// explain a match rather than only assert it.
pub const NAMES: [&str; DIMS] = [
    "duration",
    "loudness",
    "crest",
    "brightness",
    "rolloff",
    "flatness",
    "noisiness",
    "attack",
    "low",
    "high",
];

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Fingerprint {
    pub v: [f32; DIMS],
}

impl Fingerprint {
    /// Measure a sound.
    ///
    /// Reads at most a few seconds: the character of a sample is set early, and
    /// scanning a whole library should not mean decoding all of it.
    pub fn of<S: RandomAccessSource>(reader: &mut Reader<S>) -> std::io::Result<Fingerprint> {
        let info = reader.info();
        let sr = info.sample_rate.max(1) as f32;
        let channels = info.channels.max(1) as usize;
        let total = info.frames();
        let want = total.min((sr * 4.0) as u64);

        let stats = reader.stats()?;
        let samples = reader.read_frames(0, want)?;
        let frames = if channels > 0 { samples.len() / channels } else { 0 };

        // Mono sum: similarity is about the sound, not the stereo layout.
        let mut mono = vec![0f32; frames];
        for f in 0..frames {
            let mut s = 0.0;
            for ch in 0..channels {
                s += samples[f * channels + ch];
            }
            mono[f] = s / channels as f32;
        }

        let dur = total as f32 / sr;
        let peak = stats.peak.max(1e-6);
        let rms = stats.rms.max(1e-6);

        let sp = spectral(&mono, sr);

        Ok(Fingerprint {
            v: [
                // Log seconds: the step from 0.1 s to 0.2 s matters as much as
                // the one from 10 s to 20 s, and linear seconds would say
                // otherwise.
                norm(dur.max(0.001).log10(), -2.0, 2.0),
                norm(20.0 * rms.log10(), -60.0, 0.0),
                norm(20.0 * (peak / rms).log10(), 0.0, 30.0),
                norm(sp.centroid.max(1.0).log10(), 1.5, 4.2),
                norm(sp.rolloff.max(1.0).log10(), 1.5, 4.3),
                norm(sp.flatness, 0.0, 1.0),
                norm(zero_crossings(&mono), 0.0, 0.35),
                norm(attack(&mono, sr).max(0.0005).log10(), -3.3, 0.0),
                norm(sp.low, 0.0, 1.0),
                norm(sp.high, 0.0, 1.0),
            ],
        })
    }

    /// 0 for identical, larger for less alike.
    ///
    /// Euclidean rather than cosine: every dimension is already on a common
    /// 0..1 scale, and here the *magnitude* of a difference is the point. Two
    /// sounds alike in shape but forty decibels apart are not alike.
    pub fn distance(&self, other: &Fingerprint) -> f32 {
        let mut sum = 0.0;
        for i in 0..DIMS {
            let d = self.v[i] - other.v[i];
            sum += d * d;
        }
        sum.sqrt()
    }

    /// Distance as a 0..1 score, 1 being identical. What the interface shows.
    pub fn similarity(&self, other: &Fingerprint) -> f32 {
        let max = (DIMS as f32).sqrt();
        (1.0 - self.distance(other) / max).clamp(0.0, 1.0)
    }

    /// The dimensions that differ most, worst first. Lets a result say *why*
    /// it is not a closer match instead of only how close it is.
    pub fn largest_differences(&self, other: &Fingerprint) -> Vec<(&'static str, f32)> {
        let mut d: Vec<(&str, f32)> = (0..DIMS)
            .map(|i| (NAMES[i], (self.v[i] - other.v[i]).abs()))
            .collect();
        d.sort_by(|a, b| b.1.total_cmp(&a.1));
        d
    }
}

/// Squash a measurement into 0..1 over the range it realistically occupies.
fn norm(v: f32, lo: f32, hi: f32) -> f32 {
    if !v.is_finite() || hi <= lo {
        return 0.0;
    }
    ((v - lo) / (hi - lo)).clamp(0.0, 1.0)
}

struct Spectral {
    centroid: f32,
    rolloff: f32,
    flatness: f32,
    low: f32,
    high: f32,
}

/// Average spectrum over the whole excerpt, then the shape measures taken from
/// it. Averaging first keeps one loud transient from defining the sound.
fn spectral(mono: &[f32], sr: f32) -> Spectral {
    const N: usize = 2048;
    let mut acc = vec![0f32; N / 2 + 1];
    let mut windows = 0usize;

    let mut pos = 0;
    while pos + N <= mono.len() {
        let mut re: Vec<f32> = (0..N)
            .map(|i| {
                let w = 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (N - 1) as f32).cos();
                mono[pos + i] * w
            })
            .collect();
        let mut im = vec![0f32; N];
        if fft::fft(&mut re, &mut im) {
            for (i, a) in acc.iter_mut().enumerate() {
                *a += (re[i] * re[i] + im[i] * im[i]).sqrt();
            }
            windows += 1;
        }
        pos += N / 2;
    }

    if windows == 0 {
        return Spectral { centroid: 0.0, rolloff: 0.0, flatness: 0.0, low: 0.0, high: 0.0 };
    }
    for a in acc.iter_mut() {
        *a /= windows as f32;
    }

    let bin_hz = sr / N as f32;
    let total: f32 = acc.iter().sum::<f32>().max(1e-9);

    let centroid = acc
        .iter()
        .enumerate()
        .map(|(i, m)| i as f32 * bin_hz * m)
        .sum::<f32>()
        / total;

    // The frequency below which 85% of the energy sits — the usual measure of
    // where a sound "stops".
    let mut run = 0.0;
    let mut rolloff = 0.0;
    for (i, m) in acc.iter().enumerate() {
        run += m;
        if run >= total * 0.85 {
            rolloff = i as f32 * bin_hz;
            break;
        }
    }

    // Geometric over arithmetic mean: 1 for noise, near 0 for a pure tone.
    let mut log_sum = 0.0;
    for m in acc.iter() {
        log_sum += m.max(1e-9).ln();
    }
    let geo = (log_sum / acc.len() as f32).exp();
    let arith = total / acc.len() as f32;
    let flatness = (geo / arith.max(1e-9)).clamp(0.0, 1.0);

    let band = |lo: f32, hi: f32| -> f32 {
        let a = (lo / bin_hz) as usize;
        let b = ((hi / bin_hz) as usize).min(acc.len());
        if b <= a { 0.0 } else { acc[a..b].iter().sum::<f32>() / total }
    };

    Spectral {
        centroid,
        rolloff,
        flatness,
        low: band(0.0, 250.0),
        high: band(4000.0, sr / 2.0),
    }
}

/// Fraction of samples where the signal crosses zero. Noise crosses often, a
/// low tone rarely.
fn zero_crossings(mono: &[f32]) -> f32 {
    if mono.len() < 2 {
        return 0.0;
    }
    let mut n = 0usize;
    for i in 1..mono.len() {
        if (mono[i - 1] < 0.0) != (mono[i] < 0.0) {
            n += 1;
        }
    }
    n as f32 / (mono.len() - 1) as f32
}

/// Seconds from the start to the loudest point — a kick and a swell differ here
/// more than anywhere else.
fn attack(mono: &[f32], sr: f32) -> f32 {
    let mut peak = 0.0;
    let mut at = 0usize;
    for (i, s) in mono.iter().enumerate() {
        let a = s.abs();
        if a > peak {
            peak = a;
            at = i;
        }
    }
    at as f32 / sr.max(1.0)
}

/// Rank `library` by how much each entry sounds like `query`.
///
/// The query itself is dropped: a sound is not a useful suggestion for itself.
pub fn rank<'a>(
    query: &Fingerprint,
    library: impl IntoIterator<Item = (&'a str, Fingerprint)>,
    exclude: &str,
    limit: usize,
) -> Vec<(&'a str, f32)> {
    let mut out: Vec<(&str, f32)> = library
        .into_iter()
        .filter(|(path, _)| *path != exclude)
        .map(|(path, fp)| (path, query.similarity(&fp)))
        .collect();
    out.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(b.0)));
    out.truncate(limit);
    out
}
