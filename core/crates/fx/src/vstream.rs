//! The phase vocoder, a block at a time.
//!
//! Frequency-domain engines look harder to stream than time-domain ones and are
//! mostly easier. All the state a vocoder carries between frames is per-bin and
//! fixed in size: the previous analysis phase, the accumulated synthesis phase,
//! and the held magnitudes. Nothing about it needs the whole file — that was
//! only ever true of *how it was written*, which took a buffer and returned a
//! buffer.
//!
//! Two things did genuinely have to change.
//!
//! **The overlap-add cannot be normalised at the end**, because there is no
//! end. A frame laid at the write pointer runs on past this block, so a frame
//! of output is only finished once the write pointer has passed it — the same
//! ring the WSOLA streamer uses, for the same reason.
//!
//! **The normalisation floor cannot be a maximum over the output.** The offline
//! renderer took `max(norm) × NORM_FLOOR`, which needs every frame before it
//! can divide the first one. It is computed here from the window and the hop
//! instead: lay frames down until the overlap is complete and take the peak of
//! *that*, which is what the maximum was converging to anyway. It is also the
//! more honest quantity — a share of what the overlap sums to when it is full,
//! rather than a share of whatever the biggest number in one particular render
//! happened to be.
//!
//! Both stereo modes live here. They differ only in where the phase comes from:
//! independently per channel, or once from the channel sum and applied as a
//! shared correction. Sharing the schedule between them is what keeps the two
//! from drifting into different engines.

use audio_core::fft::fft;

use crate::stream::{StretchParams, Streamer};

const TWO_PI: f32 = std::f32::consts::TAU;

/// The largest transform any control allows. Buffers are sized from this, not
/// from the current setting, because the setting moves between blocks.
const MAX_FFT: usize = 8192;

/// A share of the full overlap below which the normalisation stops dividing.
///
/// The overlap-add divides by the summed *square* of the window, which tails
/// toward nothing at an edge — and dividing by nearly nothing turns a correctly
/// quiet edge into a peak. The same constant the offline renderer used.
const NORM_FLOOR: f32 = 0.05;

/// A phase vocoder that can be driven from an audio callback.
pub struct VocoderStream {
    channels: usize,

    // Per channel, `bins` apart. Sized for the largest transform.
    prev_phase: Vec<f32>,
    sum_phase: Vec<f32>,
    held: Vec<f32>,
    mag: Vec<f32>,
    phase: Vec<f32>,
    re: Vec<f32>,
    im: Vec<f32>,

    // The linked mode's shared spectrum, and the correction it produces.
    ref_mag: Vec<f32>,
    ref_phase: Vec<f32>,
    prev_ref: Vec<f32>,
    link_sum: Vec<f32>,
    corr: Vec<f32>,

    scratch: Vec<f32>,
    peak_idx: Vec<usize>,

    /// The analysis and synthesis window, rebuilt only when its shape changes.
    win: Vec<f32>,
    win_for: Option<(usize, u32)>,
    /// The full-overlap peak of the summed squared window, likewise.
    floor: f32,
    floor_for: Option<(usize, usize, u32)>,
    /// Room to lay frames down in while deriving the floor above.
    floor_scratch: Vec<f32>,

    // The schedule, shared by both stereo modes.
    read: f64,
    prev_start: isize,
    write: u64,
    emitted: u64,
    index: u64,
    first: bool,
    /// The source ran out at the nominal hop. There is nothing further to lay
    /// down, and the rest of the output is whatever the ring still holds.
    ended: bool,

    // Output waiting to be handed out.
    acc: Vec<f32>,
    norm: Vec<f32>,
    ring: usize,
}

impl Streamer for VocoderStream {
    fn position(&self) -> u64 {
        VocoderStream::position(self)
    }
    fn seek(&mut self, out_frame: u64, input_frames: usize, p: &StretchParams) {
        VocoderStream::seek(self, out_frame, input_frames, p)
    }
    fn render(&mut self, out: &mut [f32], channels: usize, input: &[f32], p: &StretchParams) {
        VocoderStream::render(self, out, channels, input, p)
    }
}

impl VocoderStream {
    pub fn new(max_block: usize, channels: usize) -> Self {
        let channels = channels.max(1);
        let bins = MAX_FFT / 2 + 1;
        // A frame laid at the far end of a block still has to fit.
        let ring = max_block.max(1) + MAX_FFT + 1;
        VocoderStream {
            channels,
            prev_phase: vec![0.0; channels * bins],
            sum_phase: vec![0.0; channels * bins],
            held: vec![0.0; channels * bins],
            mag: vec![0.0; channels * bins],
            phase: vec![0.0; channels * bins],
            re: vec![0.0; channels * MAX_FFT],
            im: vec![0.0; channels * MAX_FFT],
            ref_mag: vec![0.0; bins],
            ref_phase: vec![0.0; bins],
            prev_ref: vec![0.0; bins],
            link_sum: vec![0.0; bins],
            corr: vec![0.0; bins],
            scratch: vec![0.0; bins],
            peak_idx: Vec::with_capacity(bins / 4),
            win: Vec::with_capacity(MAX_FFT),
            win_for: None,
            floor: 0.0,
            floor_for: None,
            floor_scratch: vec![0.0; 3 * MAX_FFT],
            read: 0.0,
            prev_start: -1,
            write: 0,
            emitted: 0,
            index: 0,
            first: true,
            ended: false,
            acc: vec![0.0; ring * channels],
            norm: vec![0.0; ring],
            ring,
        }
    }

    fn ensure_window(&mut self, n: usize, skew: f32) {
        let key = (n, skew.to_bits());
        if self.win_for == Some(key) {
            return;
        }
        crate::vocoder::write_skewed_window(&mut self.win, n, skew);
        self.win_for = Some(key);
    }

    /// The peak of the summed squared window once the overlap is complete.
    ///
    /// Derived by laying frames down until the middle has settled, rather than
    /// assumed from a formula — the window is adjustable and the hop can be any
    /// integer, so there is no closed form worth trusting.
    fn ensure_floor(&mut self, n: usize, hs: usize, skew: f32) {
        let key = (n, hs, skew.to_bits());
        if self.floor_for == Some(key) {
            return;
        }
        let hs = hs.max(1);
        if hs >= n {
            // Frames do not reach each other, so nothing ever overlaps and the
            // peak is one window's own. Worth the branch: it is also what keeps
            // the scratch below bounded, since the hop can be far longer than
            // the window when density is set very low.
            self.floor = self.win[..n].iter().fold(0f32, |m, &w| m.max(w * w)) * NORM_FLOOR;
            self.floor_for = Some(key);
            return;
        }
        let span = 3 * n;
        let acc = &mut self.floor_scratch[..span];
        acc.fill(0.0);
        let mut at = 0usize;
        while at + n <= span {
            for i in 0..n {
                acc[at + i] += self.win[i] * self.win[i];
            }
            at += hs;
        }
        // The middle, where every frame that can contribute has.
        let peak = acc[n..2 * n].iter().fold(0f32, |m, &x| m.max(x));
        self.floor = peak * NORM_FLOOR;
        self.floor_for = Some(key);
    }

    fn clear(&mut self) {
        self.acc.fill(0.0);
        self.norm.fill(0.0);
        self.prev_phase.fill(0.0);
        self.sum_phase.fill(0.0);
        self.held.fill(0.0);
        self.prev_ref.fill(0.0);
        self.link_sum.fill(0.0);
    }

    pub fn position(&self) -> u64 {
        self.emitted
    }

    /// Move to an output frame.
    ///
    /// A vocoder cannot resume mid-stream any more than WSOLA can: the
    /// synthesis phase is an accumulation from wherever it started, so arriving
    /// at a moment is not the same as having played to it. The read pointer is
    /// put where the schedule says and the phase starts afresh, which is
    /// audible as a moment of re-anchoring and nothing worse.
    pub fn seek(&mut self, out_frame: u64, input_frames: usize, p: &StretchParams) {
        self.clear();
        self.emitted = out_frame;
        self.write = out_frame;
        self.first = true;
        self.ended = false;
        self.prev_start = -1;

        let n = crate::stretch::fft_size_for(p.vocoder.window_ms, p.sample_rate);
        let hs = crate::stretch::hop_frames(&p.grain, n, p.sample_rate.max(1) as f32).max(1);
        self.index = out_frame / hs as u64;

        let ratio = p.ratio.clamp(0.01, 100.0);
        let skew = p.grain.scan.clamp(-4.0, 4.0) as f64;
        let advance = (hs as f64 / ratio as f64) * skew;
        let span = input_frames.saturating_sub(n).max(1);
        self.read = if skew < 0.0 {
            span as f64 + advance * self.index as f64
        } else {
            advance * self.index as f64
        }
        .rem_euclid(span as f64);
    }

    /// Fill one block. Must not allocate.
    pub fn render(&mut self, out: &mut [f32], channels: usize, input: &[f32], p: &StretchParams) {
        let channels = channels.max(1).min(self.channels);
        let frames = out.len() / channels;
        out.fill(0.0);
        let in_frames = input.len() / channels;
        if frames == 0 || in_frames == 0 {
            return;
        }

        let n = crate::stretch::fft_size_for(p.vocoder.window_ms, p.sample_rate).min(MAX_FFT);
        if in_frames < n {
            // Too short to transform. Nothing useful to say about its spectrum,
            // and the offline renderer passes it through for the same reason.
            let take = frames.min(in_frames.saturating_sub(self.emitted as usize));
            for f in 0..take {
                for ch in 0..channels {
                    out[f * channels + ch] = input[(self.emitted as usize + f) * channels + ch];
                }
            }
            self.emitted += frames as u64;
            return;
        }

        let sr = p.sample_rate.max(1) as f32;
        let bins = n / 2 + 1;
        let hs = crate::stretch::hop_frames(&p.grain, n, sr).max(1);
        let ratio = p.ratio.clamp(0.01, 100.0);
        let g = p.grain;
        let s = &crate::vocoder::settings_for(p);

        self.ensure_window(n, g.envelope);
        self.ensure_floor(n, hs, g.envelope);

        let skew = g.scan.clamp(-4.0, 4.0) as f64;
        let advance = (hs as f64 / ratio as f64) * skew;
        let span = in_frames.saturating_sub(n).max(1);
        let pos_jitter = (g.position_jitter_ms / 1000.0) * sr;

        let need = self.emitted + frames as u64;
        while self.write < need && !self.ended {
            let jitter = if pos_jitter > 0.0 {
                (pos_jitter * g.rand_bipolar(self.index, g.salt(5))) as f64
            } else {
                0.0
            };
            // The jitter, plus this layer's own throw — layers that read the
            // same instant and are laid down a fixed offset apart are a delay
            // line, not a cloud.
            let mut start = (self.read + jitter + g.layer_read as f64).max(0.0).round() as usize;
            if start + n > in_frames {
                // At the nominal hop, running out of source is the end of the
                // job — a stretch shorter than the source reaches the end of
                // the input before the end of the output, and the rest is
                // silence rather than a wrap nobody asked for.
                //
                // Off it, the read pointer is sweeping at a speed with nothing
                // to do with the output length, so wrap and keep going.
                if (skew - 1.0).abs() < 1e-6 && !g.wrap {
                    self.ended = true;
                    break;
                }
                self.read = self.read.rem_euclid(span as f64);
                start = self.read.round() as usize;
                if start + n > in_frames {
                    self.ended = true;
                    break;
                }
                // A wrap is a discontinuity; a hop measured across it would be
                // a large negative number and the phase estimate nonsense.
                self.prev_start = -1;
            }
            let start = start.min(in_frames.saturating_sub(n));

            // Analyse every channel.
            for c in 0..channels {
                let ro = c * MAX_FFT;
                let bo = c * (MAX_FFT / 2 + 1);
                for i in 0..n {
                    let j = if g.reverse { n - 1 - i } else { i };
                    self.re[ro + i] = input[(start + j) * channels + c] * self.win[i];
                    self.im[ro + i] = 0.0;
                }
                if !fft(&mut self.re[ro..ro + n], &mut self.im[ro..ro + n]) {
                    return;
                }
                for k in 0..bins {
                    let (r, i) = (self.re[ro + k], self.im[ro + k]);
                    self.mag[bo + k] = (r * r + i * i).sqrt();
                    self.phase[bo + k] = i.atan2(r);
                }
                crate::vocoder::shape_magnitudes(
                    &mut self.mag[bo..bo + bins],
                    &mut self.held[bo..bo + bins],
                    &mut self.scratch[..bins],
                    s,
                    self.first,
                );
            }

            let ha = if self.prev_start < 0 {
                hs as f32
            } else {
                (start as isize - self.prev_start) as f32
            };
            let ha = if ha.abs() < 1e-6 { hs as f32 } else { ha };
            let rate = crate::stretch::grain_rate(&g, self.index, self.write as f32 / sr);

            if s.stereo_link && channels > 1 {
                self.link(n, bins, channels, ha, hs, rate, s);
            } else {
                self.independent(n, bins, channels, ha, hs, rate, s);
            }

            self.prev_start = start as isize;
            self.first = false;

            // Resynthesise and overlap-add into the ring.
            let (gl, gr) = crate::grain::pan_gains(&g, self.index, channels);
            for c in 0..channels {
                let ro = c * MAX_FFT;
                for k in bins..n {
                    self.re[ro + k] = self.re[ro + n - k];
                    self.im[ro + k] = -self.im[ro + n - k];
                }
                self.im[ro] = 0.0;
                if n % 2 == 0 {
                    self.im[ro + n / 2] = 0.0;
                }
                ifft(&mut self.re[ro..ro + n], &mut self.im[ro..ro + n]);

                let pan = if c == 0 { gl } else { gr };
                for i in 0..n {
                    let slot = ((self.write + i as u64) % self.ring as u64) as usize;
                    self.acc[slot * self.channels + c] += self.re[ro + i] * self.win[i] * pan;
                }
            }
            for i in 0..n {
                let slot = ((self.write + i as u64) % self.ring as u64) as usize;
                self.norm[slot] += self.win[i] * self.win[i];
            }

            self.read += advance;
            self.write += crate::stretch::grain_size(&g, self.index, hs).max(1) as u64;
            self.index += 1;
        }

        // Hand out what is finished, and clear it for reuse.
        for f in 0..frames {
            let slot = ((self.emitted + f as u64) % self.ring as u64) as usize;
            let d = self.norm[slot].max(self.floor);
            for ch in 0..channels {
                let v = self.acc[slot * self.channels + ch];
                out[f * channels + ch] = if d > 1e-6 { v / d } else { v };
            }
            for ch in 0..self.channels {
                self.acc[slot * self.channels + ch] = 0.0;
            }
            self.norm[slot] = 0.0;
        }
        self.emitted = need;
    }

    /// Each channel propagates its own phase. The usual choice, and the one
    /// that lets two channels drift apart — which widens an image and hollows
    /// anything centred.
    #[allow(clippy::too_many_arguments)]
    fn independent(
        &mut self,
        n: usize,
        bins: usize,
        channels: usize,
        ha: f32,
        hs: usize,
        rate: f32,
        s: &crate::vocoder::Settings,
    ) {
        for c in 0..channels {
            let bo = c * (MAX_FFT / 2 + 1);
            let ro = c * MAX_FFT;
            if self.first {
                self.sum_phase[bo..bo + bins].copy_from_slice(&self.phase[bo..bo + bins]);
            } else {
                crate::vocoder::propagate(
                    &self.phase[bo..bo + bins],
                    &self.prev_phase[bo..bo + bins],
                    &mut self.sum_phase[bo..bo + bins],
                    &self.mag[bo..bo + bins],
                    &mut self.peak_idx,
                    n,
                    ha,
                    hs as f32,
                    s,
                );
            }
            if (rate - 1.0).abs() > 1e-6 {
                for k in 0..bins {
                    self.sum_phase[bo + k] = wrap(self.sum_phase[bo + k] * rate);
                }
            }
            self.prev_phase[bo..bo + bins].copy_from_slice(&self.phase[bo..bo + bins]);
            for k in 0..bins {
                let m = self.mag[bo + k];
                let p = self.sum_phase[bo + k];
                self.re[ro + k] = m * p.cos();
                self.im[ro + k] = m * p.sin();
            }
        }
    }

    /// One correction, taken from the channel sum and applied to all of them, so
    /// what each channel was doing relative to the others survives the stretch.
    #[allow(clippy::too_many_arguments)]
    fn link(
        &mut self,
        n: usize,
        bins: usize,
        channels: usize,
        ha: f32,
        hs: usize,
        rate: f32,
        s: &crate::vocoder::Settings,
    ) {
        // The mid signal's spectrum, without a second transform.
        for k in 0..bins {
            let (mut sr, mut si) = (0.0f32, 0.0f32);
            for c in 0..channels {
                sr += self.re[c * MAX_FFT + k];
                si += self.im[c * MAX_FFT + k];
            }
            self.ref_mag[k] = (sr * sr + si * si).sqrt();
            self.ref_phase[k] = si.atan2(sr);
        }

        if self.first {
            self.link_sum[..bins].copy_from_slice(&self.ref_phase[..bins]);
        } else {
            crate::vocoder::propagate(
                &self.ref_phase[..bins],
                &self.prev_ref[..bins],
                &mut self.link_sum[..bins],
                &self.ref_mag[..bins],
                &mut self.peak_idx,
                n,
                ha,
                hs as f32,
                s,
            );
        }
        if (rate - 1.0).abs() > 1e-6 {
            for k in 0..bins {
                self.link_sum[k] = wrap(self.link_sum[k] * rate);
            }
        }
        for k in 0..bins {
            self.corr[k] = wrap(self.link_sum[k] - self.ref_phase[k]);
        }
        self.prev_ref[..bins].copy_from_slice(&self.ref_phase[..bins]);

        for c in 0..channels {
            let bo = c * (MAX_FFT / 2 + 1);
            let ro = c * MAX_FFT;
            for k in 0..bins {
                let p = self.phase[bo + k] + self.corr[k];
                let m = self.mag[bo + k];
                self.re[ro + k] = m * p.cos();
                self.im[ro + k] = m * p.sin();
            }
        }
    }
}

#[inline]
fn wrap(p: f32) -> f32 {
    let mut x = p;
    while x > std::f32::consts::PI {
        x -= TWO_PI;
    }
    while x < -std::f32::consts::PI {
        x += TWO_PI;
    }
    x
}

pub(crate) fn ifft(re: &mut [f32], im: &mut [f32]) {
    for v in im.iter_mut() {
        *v = -*v;
    }
    fft(re, im);
    let n = re.len() as f32;
    for v in re.iter_mut() {
        *v /= n;
    }
    for v in im.iter_mut() {
        *v = -*v / n;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stretch::{Algorithm, Stretch};

    const RATE: u32 = 44_100;

    fn chord(secs: f32, channels: usize) -> Vec<f32> {
        let n = (RATE as f32 * secs) as usize;
        let mut v = Vec::with_capacity(n * channels);
        for i in 0..n {
            let t = i as f32 / RATE as f32;
            let s = 0.3 * (std::f32::consts::TAU * 220.0 * t).sin()
                + 0.25 * (std::f32::consts::TAU * 277.2 * t).sin()
                + 0.2 * (std::f32::consts::TAU * 329.6 * t).sin();
            for c in 0..channels {
                // Delayed rather than scaled, so the linked mode has something
                // to link. Two scaled copies come out identical either way.
                v.push(if c == 0 { s } else { 0.0 });
            }
        }
        for i in 0..n {
            for c in 1..channels {
                v[i * channels + c] = if i >= 977 { v[(i - 977) * channels] } else { 0.0 };
            }
        }
        v
    }

    fn params(spec: &Stretch) -> StretchParams {
        StretchParams {
            ratio: spec.ratio,
            window_ms: spec.window_ms,
            sample_rate: RATE,
            wsola: spec.wsola,
            vocoder: spec.vocoder,
            grain: spec.grain,
        }
    }

    fn streamed(input: &[f32], channels: usize, spec: &Stretch, block: usize) -> Vec<f32> {
        let p = params(spec);
        let in_frames = input.len() / channels;
        let want = ((in_frames as f64) * spec.ratio as f64).round() as usize;
        let mut s = VocoderStream::new(block, channels);
        s.seek(0, in_frames, &p);
        let mut out = vec![0f32; want * channels];
        let mut at = 0usize;
        let mut buf = vec![0f32; block * channels];
        while at < want {
            let n = block.min(want - at);
            s.render(&mut buf[..n * channels], channels, input, &p);
            out[at * channels..(at + n) * channels].copy_from_slice(&buf[..n * channels]);
            at += n;
        }
        out
    }

    fn spec(ratio: f32) -> Stretch {
        Stretch { ratio, algorithm: Algorithm::Vocoder, ..Default::default() }
    }

    fn rms(v: &[f32]) -> f32 {
        (v.iter().map(|x| x * x).sum::<f32>() / v.len().max(1) as f32).sqrt()
    }

    #[test]
    fn streaming_matches_the_offline_vocoder() {
        let src = chord(0.5, 2);
        for ratio in [0.5f32, 2.0, 4.0] {
            let s = spec(ratio);
            let offline = s.process(&src, 2, RATE);
            let live = streamed(&src, 2, &s, 512);
            assert_eq!(offline.len(), live.len(), "lengths differ at {ratio}x");
            let worst = offline
                .iter()
                .zip(&live)
                .map(|(a, b)| (a - b).abs())
                .fold(0f32, f32::max);
            assert!(worst < 1e-6, "at {ratio}x the two paths differ by {worst:.2e}");
        }
    }

    #[test]
    fn the_block_size_does_not_change_the_sound() {
        let src = chord(0.4, 2);
        let s = spec(3.0);
        let a = streamed(&src, 2, &s, 64);
        let b = streamed(&src, 2, &s, 1024);
        let worst = a.iter().zip(&b).map(|(x, y)| (x - y).abs()).fold(0f32, f32::max);
        assert!(worst < 1e-6, "the block size changed the audio by {worst:.2e}");
    }

    #[test]
    fn linking_the_channels_streams_too() {
        let src = chord(0.4, 2);
        let mut s = spec(3.0);
        s.vocoder.stereo_link = true;
        let offline = s.process(&src, 2, RATE);
        let live = streamed(&src, 2, &s, 256);
        let worst = offline.iter().zip(&live).map(|(a, b)| (a - b).abs()).fold(0f32, f32::max);
        assert!(worst < 1e-6, "linked stereo differs by {worst:.2e}");
    }

    /// Every control on the vocoder's panel has to reach the streaming engine
    /// too, or the live sound and the exported one are different engines.
    #[test]
    fn the_vocoder_controls_reach_the_streaming_engine() {
        let src = chord(0.4, 2);
        let base = spec(3.0);
        let plain = streamed(&src, 2, &base, 256);
        let cases: Vec<(&str, Box<dyn Fn(&mut Stretch)>)> = vec![
            ("windowMs", Box::new(|s: &mut Stretch| s.vocoder.window_ms = 92.0)),
            ("phaseLock", Box::new(|s: &mut Stretch| s.vocoder.phase_lock = false)),
            ("freqTrust", Box::new(|s: &mut Stretch| s.vocoder.freq_trust = 0.2)),
            ("phaseSpread", Box::new(|s: &mut Stretch| s.vocoder.phase_spread = 0.0)),
            ("peakWidth", Box::new(|s: &mut Stretch| s.vocoder.peak_width = 12)),
            ("lockWidth", Box::new(|s: &mut Stretch| s.vocoder.lock_width = 3.0)),
            ("magFreeze", Box::new(|s: &mut Stretch| s.vocoder.mag_freeze = 0.9)),
            ("magBlur", Box::new(|s: &mut Stretch| s.vocoder.mag_blur = 0.8)),
            ("magGate", Box::new(|s: &mut Stretch| s.vocoder.mag_gate = 0.3)),
            ("stereoLink", Box::new(|s: &mut Stretch| s.vocoder.stereo_link = true)),
            ("overlap", Box::new(|s: &mut Stretch| s.grain.overlap = 4.0)),
            ("envelope", Box::new(|s: &mut Stretch| s.grain.envelope = 1.0)),
            ("scan", Box::new(|s: &mut Stretch| s.grain.scan = 0.5)),
            ("reverse", Box::new(|s: &mut Stretch| s.grain.reverse = true)),
        ];
        for (name, apply) in cases {
            let mut s = base;
            apply(&mut s);
            let d: f32 = plain
                .iter()
                .zip(&streamed(&src, 2, &s, 256))
                .map(|(a, b)| (a - b).abs())
                .sum::<f32>()
                / plain.len() as f32;
            assert!(d > 1e-6, "{name} did not reach the streaming vocoder");
        }
    }

    #[test]
    fn silence_streams_to_silence() {
        let out = streamed(&vec![0f32; 20_000], 1, &spec(3.0), 256);
        assert!(out.iter().all(|v| v.abs() < 1e-6));
    }

    #[test]
    fn the_level_survives_a_long_stretch() {
        let src = chord(0.5, 2);
        let out = streamed(&src, 2, &spec(8.0), 512);
        let (a, b) = (rms(&src), rms(&out[20_000..out.len() - 20_000]));
        assert!((b / a) > 0.5 && (b / a) < 2.0, "level moved by {:.2}x", b / a);
    }
}
