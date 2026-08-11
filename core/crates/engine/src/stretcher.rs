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
use fx::stream::{Pitched, StretchParams};
use fx::stretch::Algorithm;

use crate::render::{BlockRenderer, Source};

/// Every engine the audio thread can run, all resident.
pub struct Stretcher {
    grain: BlockRenderer,
    wsola: Pitched,
    /// What was running last block, so a change can be noticed and acted on.
    current: Algorithm,
    /// Output frame the whole thing is at. Kept here rather than read from
    /// whichever engine is live, because a switch must not appear to seek.
    position: u64,
}

/// Which engines run here at all.
///
/// The vocoder, PVSOLA and the hybrid are not yet streaming, so they fall back
/// to the grain cloud rather than to silence. That is a lie about what you are
/// hearing, so the interface has to say so — but silence would be a worse one,
/// and refusing to play at all worse still.
pub fn is_live(alg: Algorithm) -> bool {
    matches!(alg, Algorithm::Granular | Algorithm::Wsola)
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
        grain: sp.grain,
    }
}

impl Stretcher {
    pub fn new(max_block: usize, channels: usize, sample_rate: u32) -> Self {
        Stretcher {
            grain: BlockRenderer::new(max_block),
            wsola: Pitched::new(max_block, channels, sample_rate),
            current: Algorithm::Granular,
            position: 0,
        }
    }

    pub fn position(&self) -> u64 {
        self.position
    }

    /// Hand WSOLA a freshly built transient map, or `None` for a straight line.
    /// Built off the audio thread; see `fx::stream`.
    pub fn set_map(&mut self, map: Option<fx::transient::TimeMap>) {
        self.wsola.set_map(map);
    }

    pub fn overflows(&self) -> u64 {
        self.grain.overflows + self.wsola.overflows()
    }

    pub fn seek(&mut self, out_frame: u64, sp: &StreamParams) {
        self.position = out_frame;
        self.current = resolve(sp.algorithm);
        self.seek_current(out_frame, sp);
    }

    fn seek_current(&mut self, out_frame: u64, sp: &StreamParams) {
        match self.current {
            Algorithm::Wsola => {
                self.wsola
                    .seek(out_frame, sp.in_frames, &stretch_params(sp), sp.semitones)
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
            self.current = want;
            self.seek_current(self.position, sp);
        }

        let frames = out.len() / channels.max(1);
        let reported = match self.current {
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
            _ => self.grain.render(out, channels, src, sp, events),
        };
        self.position += frames as u64;
        reported
    }
}
