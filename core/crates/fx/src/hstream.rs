//! The hybrid engine, a block at a time.
//!
//! The separation is the thing that looked impossible to stream and turned out
//! not to be part of the problem at all: **it does not depend on the ratio**.
//! Splitting a sound into partials, attacks and everything else is a property
//! of the sound, not of what is being done to it. So it is done once, off the
//! audio thread, and handed over the way the transient map and the rack are —
//! and after that this engine is three streaming engines reading three sources
//! and a sum.
//!
//! That also means the expensive pass happens when a file is opened or when the
//! separation controls move, and not when the ratio does. Dragging the stretch
//! slider on the hybrid costs exactly what dragging it on the vocoder costs.
//!
//! Each part gets the method that suits it: the vocoder for the partials, WSOLA
//! for the attacks with transient preservation held on, and for the residual,
//! fresh noise shaped like the old — which is the only one of the five engines
//! that will not repeat itself at a long ratio.

use crate::noise::Morph;
use crate::stream::{PitchRing, StretchParams, Streamer, WsolaStream};
use crate::vstream::VocoderStream;
use crate::{hybrid::HybridParams, nstream::NoiseStream};

/// A sound split into three, ready to be stretched three ways.
///
/// Interleaved and the same length as the source it came from, so each part can
/// be handed to a streaming engine exactly as an ordinary source would be.
#[derive(Clone, Default)]
pub struct Parts {
    pub harmonic: Vec<f32>,
    pub percussive: Vec<f32>,
    pub residual: Vec<f32>,
    pub channels: usize,
    /// What was separated, so a caller can tell whether these are still current
    /// without keeping the settings itself.
    pub split: Option<crate::decompose::Split>,
}

impl Parts {
    pub fn frames(&self) -> usize {
        if self.channels == 0 {
            0
        } else {
            self.harmonic.len() / self.channels
        }
    }

    pub fn is_empty(&self) -> bool {
        self.frames() == 0
    }

    /// Split a source. Runs two spectrogram passes per channel — never call
    /// this from the audio thread.
    pub fn separate(input: &[f32], channels: usize, p: HybridParams) -> Parts {
        let channels = channels.max(1);
        let frames = input.len() / channels;
        let split = p.split();
        let mut out = Parts {
            harmonic: vec![0.0; input.len()],
            percussive: vec![0.0; input.len()],
            residual: vec![0.0; input.len()],
            channels,
            split: Some(split),
        };
        let mut chan = vec![0f32; frames];
        for c in 0..channels {
            for i in 0..frames {
                chan[i] = input[i * channels + c];
            }
            let parts = crate::decompose::separate_mono(&chan, split);
            for i in 0..frames {
                out.harmonic[i * channels + c] = parts.harmonic[i];
                out.percussive[i * channels + c] = parts.percussive[i];
                out.residual[i * channels + c] = parts.residual[i];
            }
        }
        out
    }
}

/// Three engines on three parts, summed.
pub struct HybridStream {
    harmonic: VocoderStream,
    percussive: WsolaStream,
    residual: NoiseStream,
    /// The residual again, for when the noise morpher is switched off and it is
    /// stretched like the attacks instead.
    residual_wsola: WsolaStream,

    /// One block from each part before they are added together.
    scratch: Vec<f32>,
    channels: usize,
    emitted: u64,
}

impl HybridStream {
    pub fn new(max_block: usize, channels: usize, sample_rate: u32) -> Self {
        let channels = channels.max(1);
        HybridStream {
            harmonic: VocoderStream::new(max_block, channels),
            percussive: WsolaStream::new(max_block, channels, sample_rate),
            residual: NoiseStream::new(max_block, channels),
            residual_wsola: WsolaStream::new(max_block, channels, sample_rate),
            scratch: vec![0.0; max_block.max(1) * channels],
            channels,
            emitted: 0,
        }
    }

    pub fn position(&self) -> u64 {
        self.emitted
    }

    /// The percussive part is stretched with transient preservation held on —
    /// an attack surviving at its own rate is the reason that part was
    /// separated out — so it needs a map, and building one walks the file.
    pub fn set_map(&mut self, map: Option<crate::transient::TimeMap>) {
        self.percussive.set_map(map);
    }

    pub fn seek(&mut self, out_frame: u64, parts: &Parts, p: &StretchParams, h: HybridParams) {
        self.emitted = out_frame;
        let frames = parts.frames();
        self.harmonic.seek(out_frame, frames, p);
        self.percussive.seek(out_frame, frames, &Self::percussive_params(p));
        self.residual.seek(out_frame, p, Self::morph(p, h));
        self.residual_wsola.seek(out_frame, frames, &Self::percussive_params(p));
    }

    /// WSOLA's settings for the attacks. Preservation is forced on here and in
    /// the offline renderer alike; there is no switch for it on the panel
    /// because turning it off would undo the separation.
    fn percussive_params(p: &StretchParams) -> StretchParams {
        let mut w = *p;
        w.wsola.preserve_transients = true;
        w
    }

    fn morph(p: &StretchParams, h: HybridParams) -> Morph {
        Morph {
            fft_size: (h.fft_size as usize).clamp(256, 8192),
            seed: p.grain.seed.max(1),
            ..Morph::default()
        }
    }

    /// Fill one block. Must not allocate.
    pub fn render(
        &mut self,
        out: &mut [f32],
        channels: usize,
        parts: &Parts,
        p: &StretchParams,
        h: HybridParams,
    ) {
        let channels = channels.max(1).min(self.channels);
        let frames = out.len() / channels;
        out.fill(0.0);
        if frames == 0 || parts.is_empty() {
            return;
        }
        let n = frames.min(self.scratch.len() / channels);
        let span = n * channels;

        let (gh, gp, gr) = (
            h.harmonic_level.clamp(0.0, 4.0),
            h.percussive_level.clamp(0.0, 4.0),
            h.residual_level.clamp(0.0, 4.0),
        );

        // Lifted out and put back each time, so each engine can be handed the
        // scratch while the rest of `self` stays borrowable. Nothing is
        // allocated; the buffer returns with the same capacity.
        let mut scratch = std::mem::take(&mut self.scratch);

        self.harmonic
            .render(&mut scratch[..span], channels, &parts.harmonic, p);
        for i in 0..span {
            out[i] += scratch[i] * gh;
        }

        let wp = Self::percussive_params(p);
        self.percussive
            .render(&mut scratch[..span], channels, &parts.percussive, &wp);
        for i in 0..span {
            out[i] += scratch[i] * gp;
        }

        if h.morph_noise {
            let m = Self::morph(p, h);
            self.residual
                .render(&mut scratch[..span], channels, &parts.residual, p, m);
        } else {
            // The comparison mode: stretch the residual like the attacks, which
            // is what every other engine does to it, and which repeats at long
            // ratios in exactly the way the morph exists to avoid.
            self.residual_wsola
                .render(&mut scratch[..span], channels, &parts.residual, &wp);
        }
        for i in 0..span {
            out[i] += scratch[i] * gr;
        }

        self.scratch = scratch;
        self.emitted += frames as u64;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stretch::{Algorithm, Stretch};

    const RATE: u32 = 44_100;

    fn mixed(secs: f32, channels: usize) -> Vec<f32> {
        let n = (RATE as f32 * secs) as usize;
        let mut mono: Vec<f32> = (0..n)
            .map(|i| {
                let t = i as f32 / RATE as f32;
                0.3 * (std::f32::consts::TAU * 440.0 * t).sin()
            })
            .collect();
        let mut seed = 5u32;
        for v in mono.iter_mut() {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            *v += (((seed >> 16) as f32 / 32768.0) - 1.0) * 0.05;
        }
        for b in 0..6 {
            let at = (n / 7) * (b + 1);
            for i in 0..500 {
                if at + i >= n {
                    break;
                }
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                let noise = ((seed >> 16) as f32 / 32768.0) - 1.0;
                mono[at + i] += noise * (1.0 - i as f32 / 500.0).powi(2) * 0.7;
            }
        }
        let mut v = vec![0f32; n * channels];
        for i in 0..n {
            v[i * channels] = mono[i];
            for c in 1..channels {
                v[i * channels + c] = if i >= 977 { mono[i - 977] } else { 0.0 };
            }
        }
        v
    }

    fn spec(ratio: f32) -> Stretch {
        Stretch { ratio, algorithm: Algorithm::Hybrid, ..Default::default() }
    }

    fn streamed(input: &[f32], channels: usize, s: &Stretch, block: usize) -> Vec<f32> {
        let in_frames = input.len() / channels;
        let want = ((in_frames as f64) * s.ratio as f64).round() as usize;
        let parts = Parts::separate(input, channels, s.hybrid);
        let p = StretchParams {
            ratio: s.ratio,
            window_ms: s.window_ms,
            sample_rate: RATE,
            wsola: s.wsola,
            vocoder: s.vocoder,
            grain: s.grain,
        };
        let win = (((s.window_ms / 1000.0) * RATE as f32) as usize).max(64);
        let hop = crate::stretch::hop_frames(&s.grain, win, RATE as f32).max(1);
        let mut wp = s.wsola;
        wp.preserve_transients = true;

        let mut hs = HybridStream::new(block, channels, RATE);
        hs.set_map(WsolaStream::build_map(
            &parts.percussive,
            channels,
            RATE,
            s.ratio,
            hop,
            &wp,
        ));
        hs.seek(0, &parts, &p, s.hybrid);

        let mut out = vec![0f32; want * channels];
        let mut at = 0usize;
        let mut buf = vec![0f32; block * channels];
        while at < want {
            let n = block.min(want - at);
            hs.render(&mut buf[..n * channels], channels, &parts, &p, s.hybrid);
            out[at * channels..(at + n) * channels].copy_from_slice(&buf[..n * channels]);
            at += n;
        }
        out
    }

    #[test]
    fn streaming_matches_the_offline_hybrid() {
        let src = mixed(0.6, 2);
        for ratio in [2.0f32, 4.0] {
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
        let src = mixed(0.5, 2);
        let s = spec(3.0);
        let a = streamed(&src, 2, &s, 64);
        let b = streamed(&src, 2, &s, 2048);
        let worst = a.iter().zip(&b).map(|(x, y)| (x - y).abs()).fold(0f32, f32::max);
        assert!(worst < 1e-6, "the block size changed the audio by {worst:.2e}");
    }

    /// The separation is a property of the sound, not of the stretch — so the
    /// same parts serve any ratio, which is what makes this engine streamable
    /// at all and what keeps the stretch slider cheap on it.
    #[test]
    fn the_separation_does_not_depend_on_the_ratio() {
        let src = mixed(0.4, 2);
        let a = Parts::separate(&src, 2, HybridParams::default());
        let b = Parts::separate(&src, 2, HybridParams::default());
        assert_eq!(a.harmonic, b.harmonic);
        assert_eq!(a.percussive, b.percussive);
        assert_eq!(a.residual, b.residual);
    }

    #[test]
    fn the_hybrid_controls_reach_the_streaming_engine() {
        let src = mixed(0.5, 2);
        let base = spec(3.0);
        let plain = streamed(&src, 2, &base, 512);
        let cases: Vec<(&str, Box<dyn Fn(&mut Stretch)>)> = vec![
            ("harmonicLevel", Box::new(|s: &mut Stretch| s.hybrid.harmonic_level = 0.3)),
            ("percussiveLevel", Box::new(|s: &mut Stretch| s.hybrid.percussive_level = 0.3)),
            ("residualLevel", Box::new(|s: &mut Stretch| s.hybrid.residual_level = 0.0)),
            ("morphNoise", Box::new(|s: &mut Stretch| s.hybrid.morph_noise = false)),
            ("margin", Box::new(|s: &mut Stretch| s.hybrid.margin = 1.0)),
            ("timeSpan", Box::new(|s: &mut Stretch| s.hybrid.time_span = 41)),
            ("fftSize", Box::new(|s: &mut Stretch| s.hybrid.fft_size = 1024)),
        ];
        for (name, apply) in cases {
            let mut s = base;
            apply(&mut s);
            let d: f32 = plain
                .iter()
                .zip(&streamed(&src, 2, &s, 512))
                .map(|(a, b)| (a - b).abs())
                .sum::<f32>()
                / plain.len() as f32;
            assert!(d > 1e-6, "{name} did not reach the streaming engine");
        }
    }

    #[test]
    fn silence_streams_to_silence() {
        let out = streamed(&vec![0f32; 40_000], 1, &spec(3.0), 512);
        assert!(out.iter().all(|v| v.abs() < 1e-5));
    }
}

/// The hybrid with the pitch stage on the end of it.
///
/// Like PVSOLA, it drives three other engines rather than sitting beside them
/// — and it reads a separated source rather than the input — so it cannot be a
/// [`Streamer`](crate::stream::Streamer) either, and it had no pitch on the
/// audio thread for the same reason. Same ring, same resampler, same sound as
/// the export.
pub struct PitchedHybrid {
    inner: HybridStream,
    ring: PitchRing,
    scratch: Vec<f32>,
}

impl PitchedHybrid {
    pub fn new(max_block: usize, channels: usize, sample_rate: u32) -> Self {
        let channels = channels.max(1);
        PitchedHybrid {
            inner: HybridStream::new(max_block, channels, sample_rate),
            ring: PitchRing::new(max_block, channels),
            scratch: vec![0.0; max_block.max(1) * channels],
        }
    }

    pub fn position(&self) -> u64 {
        self.ring.position()
    }

    /// The percussive part wants a transient map, as it does unpitched.
    pub fn set_map(&mut self, map: Option<crate::transient::TimeMap>) {
        self.inner.set_map(map);
    }

    pub fn render_pitched(
        &mut self,
        out: &mut [f32],
        channels: usize,
        parts: &Parts,
        p: &StretchParams,
        h: HybridParams,
        semitones: f32,
    ) {
        let pitch = PitchRing::factor(semitones);
        if (pitch - 1.0).abs() < 1e-6 {
            let frames = out.len() / channels.max(1);
            self.inner.render(out, channels, parts, p, h);
            self.ring.advance_unpitched(frames);
            return;
        }
        let inner = PitchRing::inner_params(p, pitch);
        let frames = out.len() / channels.max(1);
        let need = self.ring.need(frames, pitch);
        while self.ring.made() < need {
            let n = self.ring.chunk().min((need - self.ring.made()) as usize);
            self.inner
                .render(&mut self.scratch[..n * channels], channels, parts, &inner, h);
            self.ring.push(&self.scratch, n, channels);
        }
        self.ring.read(out, channels, pitch);
    }

    pub fn seek(
        &mut self,
        out_frame: u64,
        parts: &Parts,
        p: &StretchParams,
        h: HybridParams,
        semitones: f32,
    ) {
        let pitch = PitchRing::factor(semitones);
        let at = self.ring.seek(out_frame, pitch);
        self.inner
            .seek(at, parts, &PitchRing::inner_params(p, pitch), h);
    }
}
