//! Time stretching and pitch shifting.
//!
//! WSOLA — waveform similarity overlap-add. The signal is cut into overlapping
//! windows and reassembled at a different spacing; before each window is laid
//! down, a short search finds the nearby segment that best continues what was
//! already written. That search is the whole trick: naive overlap-add at a
//! changed hop size puts waveforms out of phase against each other and the
//! result sounds hollow and metallic.
//!
//! This is not a rack effect. Every [`crate::Effect`] must preserve buffer
//! length, and stretching exists precisely to change it, so it belongs to the
//! document rather than the chain.

/// How much work to spend looking for a good splice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Quality {
    /// Short search. Fine while dragging a slider.
    Draft,
    Standard,
    /// Wide search, for the render you keep.
    Best,
}

impl Quality {
    fn search_ms(self) -> f32 {
        match self {
            Quality::Draft => 4.0,
            Quality::Standard => 10.0,
            Quality::Best => 20.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Stretch {
    /// Output length as a multiple of input length. 2.0 is twice as long.
    pub ratio: f32,
    /// Pitch shift in semitones. Does not change the length.
    pub semitones: f32,
    /// Window length. Longer smooths tonal material; shorter keeps transients.
    pub window_ms: f32,
    pub quality: Quality,
    /// Per-grain variation. Inert by default.
    pub grain: crate::Grain,
}

impl Default for Stretch {
    fn default() -> Self {
        Stretch {
            ratio: 1.0,
            semitones: 0.0,
            window_ms: 40.0,
            quality: Quality::Standard,
            grain: crate::Grain::default(),
        }
    }
}

impl Stretch {
    pub fn is_identity(&self) -> bool {
        (self.ratio - 1.0).abs() < 1e-4
            && self.semitones.abs() < 1e-4
            && self.grain.is_clean()
    }

    /// Are the granular controls doing anything?
    pub fn is_granular(&self) -> bool {
        !self.grain.is_clean()
    }

    /// Frequency multiplier for the pitch shift.
    pub fn pitch_factor(&self) -> f32 {
        2f32.powf(self.semitones / 12.0)
    }

    pub fn output_frames(&self, input_frames: u64) -> u64 {
        if self.is_identity() {
            return input_frames;
        }
        ((input_frames as f64) * (self.ratio.clamp(0.01, 100.0) as f64)).round() as u64
    }

    /// Stretch and shift `input` (interleaved).
    ///
    /// Pitch shifting is time stretching plus resampling: stretch by the pitch
    /// factor, then read back that much faster. The two length changes cancel,
    /// leaving the duration set by `ratio` alone.
    pub fn process(&self, input: &[f32], channels: usize, sample_rate: u32) -> Vec<f32> {
        let channels = channels.max(1);
        if input.is_empty() || channels == 0 {
            return Vec::new();
        }
        if self.is_identity() {
            return input.to_vec();
        }

        let ratio = self.ratio.clamp(0.01, 100.0);
        let pitch = self.pitch_factor().clamp(0.05, 20.0);
        let in_frames = input.len() / channels;
        let want = ((in_frames as f64) * ratio as f64).round() as usize;

        // Granular whenever any per-grain control is engaged. Otherwise the
        // WSOLA path, which sounds better on plain material because its
        // similarity search picks splice points rather than taking them blind.
        if self.is_granular() {
            let out = crate::grain::granular(
                input, channels, sample_rate, ratio, self.semitones, self.window_ms, &self.grain,
            );
            return fit(out, want, channels);
        }

        // Stretch far enough that resampling for pitch lands on `want`.
        let stretched = wsola(
            input,
            channels,
            sample_rate,
            ratio * pitch,
            self.window_ms,
            self.quality,
        );
        let out = if (pitch - 1.0).abs() < 1e-6 {
            stretched
        } else {
            resample(&stretched, channels, pitch, want)
        };

        // Hold the promised length exactly, so timeline arithmetic stays honest.
        fit(out, want, channels)
    }
}

fn fit(mut v: Vec<f32>, want_frames: usize, channels: usize) -> Vec<f32> {
    v.resize(want_frames * channels, 0.0);
    v
}

/// Waveform-similarity overlap-add.
fn wsola(
    input: &[f32],
    channels: usize,
    sample_rate: u32,
    ratio: f32,
    window_ms: f32,
    quality: Quality,
) -> Vec<f32> {
    let in_frames = input.len() / channels;
    let sr = sample_rate.max(1) as f32;

    // Even window, 50% overlap.
    let win = (((window_ms.clamp(5.0, 2000.0) / 1000.0) * sr) as usize).max(64) & !1;
    let hop_out = win / 2;
    let hop_in = ((hop_out as f32) / ratio).max(1.0) as usize;
    let search = (((quality.search_ms() / 1000.0) * sr) as usize).max(1);

    if in_frames <= win + search * 2 {
        // Too short to splice meaningfully; resampling alone is the honest
        // answer and avoids reading past the end.
        let want = ((in_frames as f32) * ratio).round() as usize;
        return resample(input, channels, 1.0 / ratio, want);
    }

    let out_frames = ((in_frames as f32) * ratio).round() as usize + win;
    let mut out = vec![0f32; out_frames * channels];
    let mut norm = vec![0f32; out_frames];
    let window = hann(win);

    // The segment we expect to follow what was just written; the next window is
    // chosen to resemble it.
    let mut expect: Vec<f32> = vec![0.0; hop_out * channels];
    let mut read = 0usize;
    let mut write = 0usize;
    let mut first = true;

    while write + win < out_frames && read + win + search < in_frames {
        let pos = if first {
            first = false;
            read
        } else {
            best_offset(input, channels, read, search, &expect, hop_out)
        };

        for i in 0..win {
            let w = window[i];
            let src = (pos + i) * channels;
            let dst = (write + i) * channels;
            if src + channels > input.len() || dst + channels > out.len() {
                break;
            }
            for ch in 0..channels {
                out[dst + ch] += input[src + ch] * w;
            }
            norm[write + i] += w;
        }

        // What naturally follows the window just taken.
        let tail = pos + hop_out;
        for i in 0..hop_out {
            for ch in 0..channels {
                let s = (tail + i) * channels + ch;
                expect[i * channels + ch] = if s < input.len() { input[s] } else { 0.0 };
            }
        }

        write += hop_out;
        read += hop_in;
    }

    // Undo the window's amplitude envelope where overlap is incomplete.
    for f in 0..out_frames {
        let n = norm[f];
        if n > 1e-6 {
            for ch in 0..channels {
                out[f * channels + ch] /= n;
            }
        }
    }

    let want = ((in_frames as f32) * ratio).round() as usize;
    out.truncate(want.min(out_frames) * channels);
    out
}

/// Search ±`search` frames around `centre` for the segment best matching
/// `expect`, by normalised cross-correlation.
fn best_offset(
    input: &[f32],
    channels: usize,
    centre: usize,
    search: usize,
    expect: &[f32],
    len: usize,
) -> usize {
    let lo = centre.saturating_sub(search);
    let hi = (centre + search).min(input.len() / channels - len - 1);
    if hi <= lo {
        return centre.min(hi);
    }

    let mut best = centre.min(hi);
    let mut best_score = f32::NEG_INFINITY;
    // Every fourth frame: the correlation surface is smooth enough that a finer
    // sweep costs time without changing the choice.
    let step = 4.max(1);
    let mut p = lo;
    while p <= hi {
        let mut dot = 0f32;
        let mut energy = 0f32;
        for i in (0..len).step_by(2) {
            for ch in 0..channels {
                let a = input[(p + i) * channels + ch];
                let b = expect[i * channels + ch];
                dot += a * b;
                energy += a * a;
            }
        }
        // Normalising stops the search simply picking the loudest moment.
        let score = if energy > 1e-9 { dot / energy.sqrt() } else { 0.0 };
        if score > best_score {
            best_score = score;
            best = p;
        }
        p += step;
    }
    best
}

/// Resample by `factor` (frequency multiplier) to `want` frames, with cubic
/// interpolation. Linear interpolation is audibly gritty on pitched material.
fn resample(input: &[f32], channels: usize, factor: f32, want: usize) -> Vec<f32> {
    let in_frames = input.len() / channels;
    if in_frames == 0 || want == 0 {
        return vec![0.0; want * channels];
    }
    let mut out = vec![0f32; want * channels];
    for f in 0..want {
        let pos = f as f32 * factor;
        let i = pos.floor() as isize;
        let t = pos - i as f32;
        for ch in 0..channels {
            let s = |k: isize| -> f32 {
                let idx = (i + k).clamp(0, in_frames as isize - 1) as usize;
                input[idx * channels + ch]
            };
            out[f * channels + ch] = hermite(s(-1), s(0), s(1), s(2), t);
        }
    }
    out
}

fn hermite(m1: f32, p0: f32, p1: f32, p2: f32, t: f32) -> f32 {
    let c = (p1 - m1) * 0.5;
    let v = p0 - p1;
    let w = c + v;
    let a = w + v + (p2 - p0) * 0.5;
    let b = w + a;
    ((a * t - b) * t + c) * t + p0
}

fn hann(n: usize) -> Vec<f32> {
    if n <= 1 {
        return vec![1.0; n];
    }
    (0..n)
        .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (n - 1) as f32).cos())
        .collect()
}
