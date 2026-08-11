//! Noise morphing, a block at a time.
//!
//! The offline renderer measures the whole residual's envelope, then
//! synthesises. A callback cannot do the first half, but it does not need to:
//! the envelope for an output frame comes from the two analysis frames either
//! side of `frame / ratio` in the source, and the source is all in memory. So
//! the two transforms are done on demand rather than looked up from a table
//! that took a pass over the file to build.
//!
//! The level correction is the awkward part and the reason this is not simply
//! the vocoder again. Random phases overlap-add incoherently, so the
//! synthesised level is short by an amount that depends on the overlap and the
//! spectrum — the offline renderer measures the shortfall afterwards, walking
//! both signals. Here it is measured a hop at a time against the source at the
//! matching instant, which is the same comparison made locally instead of
//! globally, and ramped between measurements so nothing steps.

use audio_core::fft::fft;

use crate::noise::Morph;
use crate::stream::StretchParams;

const MAX_FFT: usize = 8192;

/// Fresh noise shaped like the noise that was there.
pub struct NoiseStream {
    channels: usize,

    win: Vec<f32>,
    win_for: Option<usize>,
    re: Vec<f32>,
    im: Vec<f32>,
    mag: Vec<f32>,
    env_a: Vec<f32>,
    env_b: Vec<f32>,

    acc: Vec<f32>,
    norm: Vec<f32>,
    ring: usize,

    /// Output frame the next synthesis frame is laid at, and how many have
    /// been handed out.
    write: u64,
    emitted: u64,
    index: u64,

    /// The corrective gain either side of the current hop, ramped between.
    gain_from: f32,
    gain_to: f32,
    gain_at: u64,
}

impl NoiseStream {
    pub fn new(max_block: usize, channels: usize) -> Self {
        let channels = channels.max(1);
        let bins = MAX_FFT / 2 + 1;
        let ring = max_block.max(1) + MAX_FFT + 1;
        NoiseStream {
            channels,
            win: Vec::with_capacity(MAX_FFT),
            win_for: None,
            re: vec![0.0; MAX_FFT],
            im: vec![0.0; MAX_FFT],
            mag: vec![0.0; bins],
            env_a: vec![0.0; bins],
            env_b: vec![0.0; bins],
            acc: vec![0.0; ring * channels],
            norm: vec![0.0; ring],
            ring,
            write: 0,
            emitted: 0,
            index: 0,
            gain_from: 1.0,
            gain_to: 1.0,
            gain_at: 0,
        }
    }

    pub fn seek(&mut self, out_frame: u64, p: &StretchParams, m: Morph) {
        let n = (m.fft_size.max(64).next_power_of_two()).min(MAX_FFT);
        let hop = (n / 4).max(1);
        self.acc.fill(0.0);
        self.norm.fill(0.0);
        self.emitted = out_frame;
        // Synthesis frames sit on a grid, so start on the one at or before the
        // target rather than part way through a window.
        self.index = out_frame / hop as u64;
        self.write = self.index * hop as u64;
        self.gain_from = 1.0;
        self.gain_to = 1.0;
        self.gain_at = self.write;
        let _ = p;
    }

    pub fn position(&self) -> u64 {
        self.emitted
    }

    fn ensure_window(&mut self, n: usize) {
        if self.win_for == Some(n) {
            return;
        }
        self.win.clear();
        if n <= 1 {
            self.win.extend(std::iter::repeat(1.0).take(n));
        } else {
            for i in 0..n {
                self.win
                    .push(0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / (n - 1) as f32).cos());
            }
        }
        self.win_for = Some(n);
    }

    /// The smoothed magnitude envelope of one analysis frame, into `out`.
    fn envelope(&mut self, input: &[f32], channels: usize, ch: usize, start: usize, n: usize, span: usize, into_a: bool) {
        let bins = n / 2 + 1;
        let in_frames = input.len() / channels;
        for i in 0..n {
            let f = (start + i).min(in_frames.saturating_sub(1));
            self.re[i] = input[f * channels + ch] * self.win[i];
            self.im[i] = 0.0;
        }
        if !fft(&mut self.re[..n], &mut self.im[..n]) {
            return;
        }
        for k in 0..bins {
            let (r, i) = (self.re[k], self.im[k]);
            self.mag[k] = (r * r + i * i).sqrt();
        }
        // Running mean across frequency, in energy rather than amplitude —
        // averaging amplitudes would quietly lose level wherever the spectrum
        // is uneven, which is everywhere. Smoothing at all is the point: the
        // fine structure of a noise spectrum *is* the particular realisation,
        // and keeping it would put back the repetition being avoided.
        let half = span / 2;
        for k in 0..bins {
            let lo = k.saturating_sub(half);
            let hi = (k + half + 1).min(bins);
            let mut acc = 0f32;
            for kk in lo..hi {
                acc += self.mag[kk] * self.mag[kk];
            }
            let v = (acc / (hi - lo) as f32).sqrt();
            if into_a {
                self.env_a[k] = v;
            } else {
                self.env_b[k] = v;
            }
        }
    }

    /// Fill one block. Must not allocate.
    pub fn render(
        &mut self,
        out: &mut [f32],
        channels: usize,
        input: &[f32],
        p: &StretchParams,
        m: Morph,
    ) {
        let channels = channels.max(1).min(self.channels);
        let frames = out.len() / channels;
        out.fill(0.0);
        let in_frames = input.len() / channels;
        if frames == 0 || in_frames == 0 {
            return;
        }
        let n = (m.fft_size.max(64).next_power_of_two()).min(MAX_FFT);
        let hop = (n / 4).max(1);
        let ratio = p.ratio.clamp(0.01, 100.0);
        let span = m.smooth_bins.max(1) | 1;
        let bins = n / 2 + 1;
        self.ensure_window(n);

        let need = self.emitted + frames as u64;
        while self.write < need {
            // Where in the source this output frame is looking.
            let src = (self.write as f64 / ratio as f64) as f32;
            let a_start = (src as usize).min(in_frames.saturating_sub(n));
            let b_start = (a_start + hop).min(in_frames.saturating_sub(n));
            let t = (src - a_start as f32).clamp(0.0, 1.0);

            for ch in 0..channels {
                self.envelope(input, channels, ch, a_start, n, span, true);
                self.envelope(input, channels, ch, b_start, n, span, false);

                for k in 0..bins {
                    let mg = self.env_a[k] + (self.env_b[k] - self.env_a[k]) * t;
                    // A fresh phase per frame per bin, and per channel — one
                    // shared phase would put identical noise in both and
                    // collapse the image to the centre, which is the opposite
                    // of what the residual of a stereo recording sounds like.
                    let ph = rand01(
                        self.index * bins as u64 + k as u64,
                        m.seed.wrapping_add(ch as u32 * 7919),
                    ) * std::f32::consts::TAU;
                    self.re[k] = mg * ph.cos();
                    self.im[k] = mg * ph.sin();
                }
                for k in bins..n {
                    self.re[k] = self.re[n - k];
                    self.im[k] = -self.im[n - k];
                }
                self.im[0] = 0.0;
                if n % 2 == 0 {
                    self.im[n / 2] = 0.0;
                }
                crate::vstream::ifft(&mut self.re[..n], &mut self.im[..n]);

                for i in 0..n {
                    let slot = ((self.write + i as u64) % self.ring as u64) as usize;
                    self.acc[slot * self.channels + ch] += self.re[i] * self.win[i];
                }
            }
            for i in 0..n {
                let slot = ((self.write + i as u64) % self.ring as u64) as usize;
                self.norm[slot] += self.win[i] * self.win[i];
            }

            self.write += hop as u64;
            self.index += 1;
        }

        // The normalisation floor, as a share of the full overlap. Same
        // reasoning as the vocoder's: a maximum over the output needs the whole
        // output first.
        let mut full = 0f32;
        for i in 0..n {
            full += self.win[i] * self.win[i];
        }
        let floor = (full / (n as f32 / hop as f32).max(1.0)) * 0.05;

        for f in 0..frames {
            let frame = self.emitted + f as u64;
            let slot = (frame % self.ring as u64) as usize;
            let d = self.norm[slot].max(floor);

            // Put the level back where the source's was. Random phases sum
            // incoherently, so the synthesised level is short by an amount that
            // depends on the overlap and the spectrum — measured rather than
            // derived, a hop at a time, ramped so nothing steps.
            if frame >= self.gain_at {
                self.gain_from = self.gain_to;
                self.gain_to = self.local_gain(input, channels, frame, ratio, hop, d);
                self.gain_at = frame + hop as u64;
            }
            let along = ((frame + hop as u64 - self.gain_at) as f32) / hop as f32;
            let g = self.gain_from + (self.gain_to - self.gain_from) * along.clamp(0.0, 1.0);

            for ch in 0..channels {
                let v = self.acc[slot * self.channels + ch];
                out[f * channels + ch] = if d > 1e-6 { v / d * g } else { 0.0 };
                self.acc[slot * self.channels + ch] = 0.0;
            }
            self.norm[slot] = 0.0;
        }
        self.emitted = need;
    }

    /// How far the synthesised level is from the source's, right here.
    fn local_gain(
        &self,
        input: &[f32],
        channels: usize,
        frame: u64,
        ratio: f32,
        hop: usize,
        d: f32,
    ) -> f32 {
        let in_frames = input.len() / channels;
        let src = (frame as f64 / ratio as f64) as usize;
        if src >= in_frames || d <= 1e-6 {
            return 1.0;
        }
        let hi = (src + hop).min(in_frames);
        let mut want = 0f32;
        for f in src..hi {
            for ch in 0..channels {
                let v = input[f * channels + ch];
                want += v * v;
            }
        }
        let want = (want / ((hi - src).max(1) * channels) as f32).sqrt();

        let mut have = 0f32;
        for i in 0..hop {
            let slot = ((frame + i as u64) % self.ring as u64) as usize;
            let n = self.norm[slot].max(d);
            for ch in 0..channels {
                let v = self.acc[slot * self.channels + ch] / n.max(1e-6);
                have += v * v;
            }
        }
        let have = (have / (hop * channels) as f32).sqrt();
        // Never more than twelve decibels of it — beyond that it is amplifying
        // the noise floor of a gap.
        if have > 1e-9 {
            (want / have).clamp(0.0, 4.0)
        } else {
            1.0
        }
    }
}

/// One splitmix64 round. The same construction the grain cloud uses, for the
/// same reason: randomness addressed by index rather than streamed, so three
/// separate renders agree.
fn rand01(index: u64, salt: u32) -> f32 {
    let mut z = index
        .wrapping_mul(0x9E37_79B9_7F4A_7C15)
        .wrapping_add(salt as u64 ^ 0xD1B5_4A32_D192_ED03);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^= z >> 31;
    ((z >> 40) as f32) / 16_777_216.0
}
