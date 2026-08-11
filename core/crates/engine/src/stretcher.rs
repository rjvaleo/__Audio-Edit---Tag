//! Which engine the callback runs, and switching between them mid-flight.
//!
//! For a long time this decision did not exist: the callback was a grain
//! scheduler and nothing else, so choosing WSOLA or the vocoder in the
//! interface changed the exported file and never changed what came out of the
//! speakers. The picker looked like a performance control and was not one.
//!
//! Every engine that can run here is held at once, built when the device opens
//! and never allocated again. That is not thrift — an engine built on demand is
//! an allocation in the audio callback, and switching engines is exactly the
//! moment you least want a dropout.
//!
//! Only the engine that is selected is asked for audio. The others keep
//! whatever state they had, which is why a switch has to re-seek the one being
//! switched *to*: it may have been sitting at a position from minutes ago, or
//! never have run at all.

use fx::grain::{GrainEvent, StreamParams};
use fx::pstream::PvsolaStream;
use fx::stream::{Pitched, StretchParams, WsolaStream};
use fx::stretch::Algorithm;
use fx::vstream::VocoderStream;

use crate::render::{BlockRenderer, Source};

/// Every engine the audio thread can run, all resident.
pub struct Stretcher {
    grain: BlockRenderer,
    wsola: Pitched<WsolaStream>,
    vocoder: Pitched<VocoderStream>,
    pvsola: PvsolaStream,
    /// What was running last block, so a change can be noticed and acted on.
    current: Algorithm,
    /// The engine being faded out of, and how many frames of the fade are left.
    ///
    /// Switching outright puts a step in the waveform — the new engine starts
    /// cold at the playhead and its first sample has nothing to do with the
    /// last one the old engine produced — and a step is a click. So the old
    /// engine keeps running for a moment and the two are mixed.
    fading: Option<(Algorithm, usize)>,
    /// Somewhere to render the outgoing engine while the incoming one fills
    /// `out`. Sized once, like everything else here.
    scratch: Vec<f32>,
    /// Output frame the whole thing is at. Kept here rather than read from
    /// whichever engine is live, because a switch must not appear to seek.
    position: u64,
}

/// How long a switch between engines takes to cross over.
///
/// About twenty milliseconds at the usual rates — long enough that the step
/// which would otherwise be a click is spread below hearing, short enough that
/// the change still feels immediate under the finger.
const FADE_FRAMES: usize = 1024;

/// Which engines run here at all.
///
/// The hybrid is not streaming yet and falls back to the grain cloud rather
/// than to silence. That is a lie about what you are hearing, so the interface
/// has to say so — but silence would be a worse one, and refusing to play at
/// all worse still.
pub fn is_live(alg: Algorithm) -> bool {
    !matches!(alg, Algorithm::Hybrid)
}

/// What actually runs for a requested engine.
fn resolve(alg: Algorithm) -> Algorithm {
    if is_live(alg) {
        alg
    } else {
        Algorithm::Granular
    }
}

fn stretch_params(sp: &StreamParams) -> StretchParams {
    StretchParams {
        ratio: sp.ratio,
        window_ms: sp.window_ms,
        sample_rate: sp.sample_rate,
        wsola: sp.wsola,
        vocoder: sp.vocoder,
        grain: sp.grain,
    }
}

impl Stretcher {
    pub fn new(max_block: usize, channels: usize, sample_rate: u32) -> Self {
        Stretcher {
            grain: BlockRenderer::new(max_block),
            wsola: Pitched::new(
                WsolaStream::new(max_block, channels, sample_rate),
                max_block,
                channels,
            ),
            vocoder: Pitched::new(VocoderStream::new(max_block, channels), max_block, channels),
            pvsola: PvsolaStream::new(max_block, channels),
            current: Algorithm::Granular,
            fading: None,
            scratch: vec![0.0; max_block.max(1) * channels.max(1)],
            position: 0,
        }
    }

    pub fn position(&self) -> u64 {
        self.position
    }

    /// Hand WSOLA a freshly built transient map, or `None` for a straight line.
    /// Built off the audio thread; see `fx::stream`.
    pub fn set_map(&mut self, map: Option<fx::transient::TimeMap>) {
        self.wsola.inner_mut().set_map(map);
    }

    pub fn overflows(&self) -> u64 {
        self.grain.overflows + self.wsola.inner().overflows
    }

    pub fn seek(&mut self, out_frame: u64, sp: &StreamParams) {
        self.position = out_frame;
        self.current = resolve(sp.algorithm);
        // A seek is a jump anyway; there is nothing to fade from.
        self.fading = None;
        self.seek_current(out_frame, sp);
    }

    fn seek_current(&mut self, out_frame: u64, sp: &StreamParams) {
        let alg = self.current;
        self.seek_one(alg, out_frame, sp);
    }

    fn seek_one(&mut self, alg: Algorithm, out_frame: u64, sp: &StreamParams) {
        match alg {
            Algorithm::Wsola => {
                self.wsola
                    .seek(out_frame, sp.in_frames, &stretch_params(sp), sp.semitones)
            }
            Algorithm::Vocoder => {
                self.vocoder
                    .seek(out_frame, sp.in_frames, &stretch_params(sp), sp.semitones)
            }
            Algorithm::Pvsola => {
                self.pvsola
                    .seek(out_frame, sp.in_frames, &stretch_params(sp), &sp.pvsola)
            }
            _ => self.grain.seek(out_frame, sp),
        }
    }

    /// Fill one block from whichever engine is selected.
    ///
    /// `events` collects the grains that started, for the visualiser. Only the
    /// grain cloud has any; the others report none, which is honest — there is
    /// no cloud to draw when a splice engine is running.
    pub fn render(
        &mut self,
        out: &mut [f32],
        channels: usize,
        src: &Source,
        sp: &StreamParams,
        events: &mut [GrainEvent],
    ) -> usize {
        let want = resolve(sp.algorithm);
        if want != self.current {
            // The engine being switched to may be anywhere, or nowhere. Put it
            // where the transport actually is before asking it for audio, or
            // the switch is heard as a jump.
            //
            // The old one is deliberately left alone and kept running, so there
            // is something to fade out of.
            self.fading = Some((self.current, FADE_FRAMES));
            self.current = want;
            self.seek_one(want, self.position, sp);
        }

        let frames = out.len() / channels.max(1);
        let reported = self.render_one(self.current, out, channels, src, sp, events);

        // Mix in the tail of the engine being left behind.
        if let Some((from, left)) = self.fading {
            let n = frames.min(self.scratch.len() / channels.max(1));
            let mut evs: [GrainEvent; 0] = [];
            // Lifted out and put straight back. `Vec::default` is empty and
            // allocates nothing, and the buffer returns to the same place with
            // the same capacity — this is a borrow dance, not a reallocation.
            let mut scratch = std::mem::take(&mut self.scratch);
            self.render_one(from, &mut scratch[..n * channels], channels, src, sp, &mut evs);
            for f in 0..n {
                let done = FADE_FRAMES - left + f;
                let t = (done as f32 / FADE_FRAMES as f32).clamp(0.0, 1.0);
                // Equal power, because two engines rendering the same instant
                // agree about what is there and not at all about its phase.
                // This is the opposite choice from PVSOLA's splice, where the
                // search spends its whole effort correlating the two sides
                // first and a linear fade is then the right one.
                let (a, b) = (
                    (t * std::f32::consts::FRAC_PI_2).sin(),
                    (t * std::f32::consts::FRAC_PI_2).cos(),
                );
                for ch in 0..channels {
                    let i = f * channels + ch;
                    out[i] = out[i] * a + scratch[i] * b;
                }
            }
            self.scratch = scratch;
            self.fading = match left.checked_sub(n) {
                Some(0) | None => None,
                Some(rest) => Some((from, rest)),
            };
        }

        self.position += frames as u64;
        reported
    }

    fn render_one(
        &mut self,
        alg: Algorithm,
        out: &mut [f32],
        channels: usize,
        src: &Source,
        sp: &StreamParams,
        events: &mut [GrainEvent],
    ) -> usize {
        match alg {
            Algorithm::Wsola => {
                self.wsola.render_pitched(
                    out,
                    channels,
                    &src.samples,
                    &stretch_params(sp),
                    sp.semitones,
                );
                0
            }
            Algorithm::Vocoder => {
                self.vocoder.render_pitched(
                    out,
                    channels,
                    &src.samples,
                    &stretch_params(sp),
                    sp.semitones,
                );
                0
            }
            Algorithm::Pvsola => {
                self.pvsola.render(
                    out,
                    channels,
                    &src.samples,
                    &stretch_params(sp),
                    &sp.pvsola,
                );
                0
            }
            _ => self.grain.render(out, channels, src, sp, events),
        }
    }
}
