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
use fx::hstream::{HybridStream, Parts};
use fx::pstream::PvsolaStream;
use fx::stream::{Pitched, StretchParams, WsolaStream};
use fx::stretch::Algorithm;
use fx::vstream::VocoderStream;

use crate::render::{BlockRenderer, Source};

/// Extra engine instances, for layers past the first.
///
/// Built off the audio thread and handed over, because sixteen of anything here
/// is megabytes and a callback may not allocate. Only the engine actually in
/// use is built: holding sixteen of all five would be a hundred and sixty
/// megabytes for a control that is usually at one.
///
/// Until a bank arrives the callback plays with whatever layers it has, which
/// is thinner than asked for but never silent — the same arrangement the
/// hybrid's separated source uses.
pub struct LayerBank {
    pub algorithm: Algorithm,
    pub layers: u32,
    wsola: Vec<Pitched<WsolaStream>>,
    vocoder: Vec<Pitched<VocoderStream>>,
    pvsola: Vec<PvsolaStream>,
    hybrid: Vec<HybridStream>,
}

impl LayerBank {
    /// Build the extra layers for one engine. Allocates; never call this from
    /// the audio thread.
    pub fn build(
        algorithm: Algorithm,
        layers: u32,
        max_block: usize,
        channels: usize,
        sample_rate: u32,
    ) -> LayerBank {
        let extra = layers.clamp(1, crate::render::MAX_LAYERS as u32) as usize - 1;
        let mut bank = LayerBank {
            algorithm,
            layers,
            wsola: Vec::new(),
            vocoder: Vec::new(),
            pvsola: Vec::new(),
            hybrid: Vec::new(),
        };
        for _ in 0..extra {
            match algorithm {
                Algorithm::Wsola => bank.wsola.push(Pitched::new(
                    WsolaStream::new(max_block, channels, sample_rate),
                    max_block,
                    channels,
                )),
                Algorithm::Vocoder => bank.vocoder.push(Pitched::new(
                    VocoderStream::new(max_block, channels),
                    max_block,
                    channels,
                )),
                Algorithm::Pvsola => bank.pvsola.push(PvsolaStream::new(max_block, channels)),
                Algorithm::Hybrid => {
                    bank.hybrid
                        .push(HybridStream::new(max_block, channels, sample_rate))
                }
                // The grain cloud layers inside its own renderer: a layer there
                // is another schedule, not another engine.
                Algorithm::Granular => {}
            }
        }
        bank
    }

    fn count(&self) -> usize {
        match self.algorithm {
            Algorithm::Wsola => self.wsola.len(),
            Algorithm::Vocoder => self.vocoder.len(),
            Algorithm::Pvsola => self.pvsola.len(),
            Algorithm::Hybrid => self.hybrid.len(),
            Algorithm::Granular => 0,
        }
    }
}

/// Every engine the audio thread can run, all resident.
pub struct Stretcher {
    grain: BlockRenderer,
    wsola: Pitched<WsolaStream>,
    vocoder: Pitched<VocoderStream>,
    pvsola: PvsolaStream,
    hybrid: HybridStream,
    /// The source, split three ways. Handed over from off the audio thread; an
    /// empty one simply means the hybrid has nothing to play yet.
    parts: std::sync::Arc<Parts>,
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
    /// And somewhere to render each extra layer before it is added in.
    layer_buf: Vec<f32>,
    /// The extra layers, if any have been handed over yet.
    bank: Option<LayerBank>,
    /// Where each extra layer's own playhead is, so a layer is only re-seeked
    /// when it has actually lost its place.
    layer_at: Vec<u64>,
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
/// Every engine runs here now.
///
/// Kept as a function rather than deleted: it is what the interface mirrors,
/// and the next engine added will not be streaming on the day it lands.
pub fn is_live(_alg: Algorithm) -> bool {
    true
}

/// What actually runs for a requested engine.
fn resolve(alg: Algorithm) -> Algorithm {
    if is_live(alg) {
        alg
    } else {
        Algorithm::Granular
    }
}

/// The hop each engine's layers are spaced by.
///
/// Every engine means something different by a window — a splice for WSOLA, an
/// analysis frame for the vocoder — so each computes its own. These mirror what
/// the offline renderer passes to `stretch::layered`, and they have to: get one
/// wrong and the layers sit at different places live than they do in the file.
fn layer_hop(alg: Algorithm, sp: &StreamParams) -> u64 {
    let sr = sp.sample_rate.max(1) as f32;
    let hop = match alg {
        Algorithm::Wsola => {
            let win = (((sp.window_ms.clamp(5.0, 2000.0) / 1000.0) * sr) as usize).max(64);
            fx::stretch::hop_frames(&sp.grain, win, sr)
        }
        Algorithm::Vocoder | Algorithm::Hybrid => {
            let n = fx::stretch::fft_size_for(sp.vocoder.window_ms, sp.sample_rate);
            fx::stretch::hop_frames(&sp.grain, n, sr)
        }
        Algorithm::Pvsola => {
            (fx::stretch::fft_size_for(sp.vocoder.window_ms, sp.sample_rate) / 4).max(1)
        }
        Algorithm::Granular => sp.plan().hop,
    };
    hop.max(1) as u64
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
            hybrid: HybridStream::new(max_block, channels, sample_rate),
            parts: std::sync::Arc::new(Parts::default()),
            current: Algorithm::Granular,
            fading: None,
            scratch: vec![0.0; max_block.max(1) * channels.max(1)],
            layer_buf: vec![0.0; max_block.max(1) * channels.max(1)],
            bank: None,
            layer_at: vec![u64::MAX; crate::render::MAX_LAYERS],
            position: 0,
        }
    }

    pub fn position(&self) -> u64 {
        self.position
    }

    /// Hand WSOLA a freshly built transient map, or `None` for a straight line.
    /// Built off the audio thread; see `fx::stream`.
    pub fn set_map(&mut self, map: Option<fx::transient::TimeMap>) {
        self.wsola.inner_mut().set_map(map.clone());
        // The hybrid stretches its percussive part with preservation held on,
        // so it wants a map too — of that part rather than of the whole sound,
        // which is what having separated it is for. The caller decides which.
        self.hybrid.set_map(map);
    }

    /// Adopt a bank of extra layers. Built off the audio thread.
    pub fn set_bank(&mut self, bank: LayerBank) {
        self.bank = Some(bank);
        // A fresh bank knows nothing about where the transport is.
        self.layer_at.iter_mut().for_each(|v| *v = u64::MAX);
    }

    /// What the callback can actually layer right now, which is not always what
    /// was asked for — a bank takes a moment to build.
    pub fn live_layers(&self, sp: &StreamParams) -> u32 {
        let want = sp.grain.layers.clamp(1, crate::render::MAX_LAYERS as u32);
        if resolve(sp.algorithm) == Algorithm::Granular {
            return want;
        }
        match &self.bank {
            Some(b) if b.algorithm == resolve(sp.algorithm) => {
                want.min(b.count() as u32 + 1)
            }
            _ => 1,
        }
    }

    /// Adopt a freshly separated source. Built off the audio thread.
    pub fn set_parts(&mut self, parts: std::sync::Arc<Parts>) {
        self.parts = parts;
    }

    pub fn overflows(&self) -> u64 {
        self.grain.overflows + self.wsola.inner().overflows
    }

    pub fn seek(&mut self, out_frame: u64, sp: &StreamParams) {
        self.position = out_frame;
        self.current = resolve(sp.algorithm);
        // A seek is a jump anyway; there is nothing to fade from.
        self.fading = None;
        self.layer_at.iter_mut().for_each(|v| *v = u64::MAX);
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
            Algorithm::Hybrid => {
                let parts = std::sync::Arc::clone(&self.parts);
                self.hybrid
                    .seek(out_frame, &parts, &stretch_params(sp), sp.hybrid)
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
        self.add_layers(out, channels, src, sp);

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

    /// Sum in the extra layers, and scale the whole thing for how many sounded.
    ///
    /// Each layer is the same engine reading its own place in the source — see
    /// `Grain::layer_throw` — and laid down its own fraction of a hop later.
    /// That offset is what interleaves the grain onsets, and it also spreads
    /// the work: sixteen vocoder layers all transforming on the same block
    /// spiked to 160% of the real-time budget, and staggered they do not.
    fn add_layers(&mut self, out: &mut [f32], channels: usize, src: &Source, sp: &StreamParams) {
        let live = self.live_layers(sp);
        // The grain cloud does its own layering inside `BlockRenderer`, and one
        // layer needs no help from anyone.
        if live <= 1 || self.current == Algorithm::Granular {
            return;
        }
        let frames = out.len() / channels.max(1);
        let n = frames.min(self.layer_buf.len() / channels.max(1));
        let span = n * channels;

        let hop = layer_hop(self.current, sp);
        let spread = sp.grain.layer_spread.clamp(0.0, 4.0);
        let mut buf = std::mem::take(&mut self.layer_buf);

        for layer in 1..live {
            let mut lp = *sp;
            lp.grain.seed = sp.grain.seed.wrapping_add(layer.wrapping_mul(0x9E37_79B9));
            lp.grain.layer_read = sp.grain.layer_throw(layer, sp.sample_rate);
            // A layer is *delayed* by its share of the hop, exactly as the
            // offline renderer delays it — which is what interleaves the frames
            // rather than having every layer transform on the same block.
            let off = ((((hop * layer as u64) / live as u64) as f32) * spread) as u64;

            // Before its own delay has elapsed a layer has nothing to say, and
            // the offline sum has nothing from it there either.
            let end = self.position + n as u64;
            if end <= off {
                continue;
            }
            let skip = off.saturating_sub(self.position) as usize;
            let take = n - skip;
            let at = (self.position + skip as u64) - off;

            let i = layer as usize - 1;
            // Seek only when the layer has actually lost its place. Re-seeking
            // every block would throw away the splice chain WSOLA depends on
            // and make the layers sound nothing like the render.
            if self.layer_at.get(i).copied() != Some(at) {
                self.seek_layer(i, at, &lp);
            }
            self.render_layer(i, &mut buf[..take * channels], channels, src, &lp);
            if let Some(slot) = self.layer_at.get_mut(i) {
                *slot = at + take as u64;
            }
            for k in 0..take * channels {
                out[skip * channels + k] += buf[k];
            }
        }
        self.layer_buf = buf;

        // Blind square root, exactly as the offline renderer applies it, so the
        // file and the transport are the same sound at every layer count.
        //
        // `out` is the raw sum of `live` layers. Decorrelated, that sum is
        // about root-N times one layer, so dividing by root-N puts it back —
        // which is `layer_gain(N) / N`, not `layer_gain(N)`. Getting that the
        // wrong way round is a factor of N and it is not subtle.
        let lift = fx::grain::layer_gain(live) / live as f32;
        for v in out.iter_mut() {
            *v *= lift;
        }
    }

    fn seek_layer(&mut self, i: usize, at: u64, lp: &StreamParams) {
        let Some(bank) = self.bank.as_mut() else { return };
        match bank.algorithm {
            Algorithm::Wsola => {
                if let Some(e) = bank.wsola.get_mut(i) {
                    e.seek(at, lp.in_frames, &stretch_params(lp), lp.semitones);
                }
            }
            Algorithm::Vocoder => {
                if let Some(e) = bank.vocoder.get_mut(i) {
                    e.seek(at, lp.in_frames, &stretch_params(lp), lp.semitones);
                }
            }
            Algorithm::Pvsola => {
                if let Some(e) = bank.pvsola.get_mut(i) {
                    e.seek(at, lp.in_frames, &stretch_params(lp), &lp.pvsola);
                }
            }
            Algorithm::Hybrid => {
                let parts = std::sync::Arc::clone(&self.parts);
                if let Some(e) = bank.hybrid.get_mut(i) {
                    e.seek(at, &parts, &stretch_params(lp), lp.hybrid);
                }
            }
            Algorithm::Granular => {}
        }
    }

    fn render_layer(
        &mut self,
        i: usize,
        out: &mut [f32],
        channels: usize,
        src: &Source,
        lp: &StreamParams,
    ) {
        let parts = std::sync::Arc::clone(&self.parts);
        let Some(bank) = self.bank.as_mut() else {
            out.fill(0.0);
            return;
        };
        match bank.algorithm {
            Algorithm::Wsola => {
                if let Some(e) = bank.wsola.get_mut(i) {
                    e.render_pitched(out, channels, &src.samples, &stretch_params(lp), lp.semitones);
                }
            }
            Algorithm::Vocoder => {
                if let Some(e) = bank.vocoder.get_mut(i) {
                    e.render_pitched(out, channels, &src.samples, &stretch_params(lp), lp.semitones);
                }
            }
            Algorithm::Pvsola => {
                if let Some(e) = bank.pvsola.get_mut(i) {
                    e.render(out, channels, &src.samples, &stretch_params(lp), &lp.pvsola);
                }
            }
            Algorithm::Hybrid => {
                if let Some(e) = bank.hybrid.get_mut(i) {
                    e.render(out, channels, &parts, &stretch_params(lp), lp.hybrid);
                }
            }
            Algorithm::Granular => out.fill(0.0),
        }
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
            Algorithm::Hybrid => {
                // Nothing separated yet — the pass is still running on another
                // thread. The grain cloud covers the gap rather than silence.
                if self.parts.is_empty() {
                    return self.grain.render(out, channels, src, sp, events);
                }
                let parts = std::sync::Arc::clone(&self.parts);
                self.hybrid
                    .render(out, channels, &parts, &stretch_params(sp), sp.hybrid);
                0
            }
            _ => self.grain.render(out, channels, src, sp, events),
        }
    }
}
