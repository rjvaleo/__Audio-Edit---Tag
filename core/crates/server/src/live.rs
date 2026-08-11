//! The bridge between the edit document and the audio thread.
//!
//! Two kinds of change land here, and they are treated differently on purpose.
//!
//! **Structure** — cuts, fades, reverse, gain — is rendered offline into the
//! buffer the engine reads from. You do not move those while listening, and
//! folding them in once means the callback never has to walk a clip list.
//!
//! **Performance** — stretch, pitch, every grain control, the effect rack — is
//! live. Those are the ones you hold while the sound is playing, so they are
//! read afresh inside the audio callback and never rebuild anything.

use std::sync::Arc;

use crate::state::App;
use engine::{resample, Handle, Source};
use fx::grain::StreamParams;

/// Open the device on first use.
///
/// Deferred rather than done at startup: a machine with no output device should
/// still be able to browse and tag a library, and the error should surface when
/// someone actually asks for sound.
pub fn ensure(app: &Arc<App>) -> Result<(), String> {
    let mut slot = app
        .audio
        .lock()
        .map_err(|_| "the audio engine is wedged".to_string())?;
    if slot.is_some() {
        return Ok(());
    }
    let silent = Arc::new(Source {
        samples: Vec::new(),
        channels: 1,
    });
    *slot = Some(engine::spawn(idle_params(), silent)?);
    Ok(())
}

/// The largest block the device may ask for, which is what every engine here
/// sizes its buffers from. Matches what `Engine::start` hands `Core`.
const MAX_BLOCK: usize = 8192;

fn idle_params() -> StreamParams {
    StreamParams {
        in_frames: 0,
        sample_rate: 48_000,
        ratio: 1.0,
        semitones: 0.0,
        window_ms: 40.0,
        grain: fx::Grain::default(),
        // Nothing is loaded, so the engine that can start from nothing.
        algorithm: fx::stretch::Algorithm::Granular,
        wsola: fx::stretch::WsolaParams::default(),

        vocoder: fx::stretch::VocoderParams::default(),


        pvsola: fx::pvsola::PvsolaParams::default(),



        hybrid: fx::hybrid::HybridParams::default(),
    }
}

/// Run `f` with the audio handle, opening the device if this is the first ask.
pub fn with<T>(app: &Arc<App>, f: impl FnOnce(&Handle) -> T) -> Result<T, String> {
    ensure(app)?;
    let slot = app
        .audio
        .lock()
        .map_err(|_| "the audio engine is wedged".to_string())?;
    let handle = slot.as_ref().ok_or_else(|| "no audio device".to_string())?;
    Ok(f(handle))
}

/// What the engine is currently playing.
pub struct Loaded {
    /// Frames of source, at the device's rate.
    pub frames: u64,
    pub sample_rate: u32,
}

/// Decode a file, fold in the structural edits, resample to the device, and
/// hand the result to the audio thread.
///
/// This is the expensive call — it is per file opened, not per parameter move.
pub fn load(app: &Arc<App>, rel: &str, path: &std::path::Path) -> Result<Loaded, String> {
    ensure(app)?;

    let mut reader = audio_core::open(path).map_err(|e| format!("could not open: {e}"))?;
    let info = reader.info();
    let src_rate = info.sample_rate;
    let channels = info.channels.max(1) as usize;

    // The document as it stands, structure only. `render` walks the clips; the
    // stretch on the list is deliberately not applied here, because that is the
    // engine's job now and doing it twice would double the effect.
    let list = app
        .edits
        .snapshot(rel)
        .unwrap_or_else(|| edit::EditList::identity(info.frames(), info.channels, src_rate));
    let frames = list.base_frames();
    let samples = edit::render::render(&list, &mut reader, 0, frames)
        .map_err(|e| format!("could not render the edit: {e}"))?;

    let (dev_rate, _dev_channels) = with(app, |h| (h.sample_rate, h.channels))?;
    let samples = resample(&samples, channels, src_rate, dev_rate);
    let out_frames = if channels > 0 { samples.len() / channels } else { 0 };

    let source = Arc::new(Source { samples, channels });
    let params = StreamParams {
        in_frames: out_frames,
        sample_rate: dev_rate,
        ratio: list.stretch.ratio,
        semitones: list.stretch.semitones,
        window_ms: list.stretch.window_ms,
        grain: list.stretch.grain,
        algorithm: list.stretch.algorithm,
        wsola: list.stretch.wsola,
        vocoder: list.stretch.vocoder,
        pvsola: list.stretch.pvsola,
        hybrid: list.stretch.hybrid,
    };

    with(app, |h| {
        h.shared.set_source(Arc::clone(&source));
        h.shared.set_params(params);
        h.shared.set_map(map_for(&source, &list.stretch, dev_rate));
        // Whatever was separated belongs to the file that just closed.
        h.shared.set_parts(std::sync::Arc::new(fx::hstream::Parts::default()));
        h.shared.request_seek(0);
        h.shared.set_rack(rack_for(app, rel, h.sample_rate, h.channels));
    })?;

    if list.stretch.algorithm == fx::stretch::Algorithm::Hybrid {
        separate_soon(app, rel, Arc::clone(&source), list.stretch.hybrid);
    }
    let _ = with(app, |h| {
        h.shared.set_bank(engine::stretcher::LayerBank::build(
            list.stretch.algorithm,
            list.stretch.grain.layers,
            MAX_BLOCK,
            h.channels,
            h.sample_rate,
        ));
    });

    // Remember what is loaded, so anything drawing the grain cloud can find the
    // document whose parameters produced it.
    *app.playing.write().unwrap() = Some((rel.to_string(), out_frames as u64, dev_rate));

    Ok(Loaded {
        frames: out_frames as u64,
        sample_rate: dev_rate,
    })
}

/// Build the live rack for a file, or `None` when nothing is switched in.
pub fn rack_for(app: &Arc<App>, rel: &str, sample_rate: u32, channels: usize) -> Option<fx::Rack> {
    let spec = app.racks.get(rel);
    let rack = spec.build(sample_rate, channels);
    if rack.is_empty() {
        None
    } else {
        Some(rack)
    }
}

/// Push the performance parameters of a document at the engine.
///
/// Called on every slider move, so it must stay cheap: no decode, no render,
/// no allocation beyond the rack itself.
pub fn push_params(app: &Arc<App>, rel: &str, list: &edit::EditList) -> Result<(), String> {
    with(app, |h| {
        let mut want_map = false;
        let mut want_parts = false;
        let mut want_bank = false;
        if let Some(mut p) = h.shared.params() {
            // Only the transient map is expensive to derive, and only these
            // decide it. Everything else can move under the pointer for free.
            // Separating runs two spectrogram passes per channel, and it does
            // not depend on the ratio — only on these four. So dragging the
            // stretch slider on the hybrid costs what it costs on the vocoder.
            want_parts = list.stretch.algorithm == fx::stretch::Algorithm::Hybrid
                && (p.hybrid.split() != list.stretch.hybrid.split()
                    || p.algorithm != fx::stretch::Algorithm::Hybrid);

            // Building a bank allocates one engine per extra layer, so it
            // happens only when the engine or the layer count actually moves —
            // not on every slider.
            want_bank = p.algorithm != list.stretch.algorithm
                || p.grain.layers != list.stretch.grain.layers;

            want_map = p.wsola.preserve_transients != list.stretch.wsola.preserve_transients
                || p.wsola.sensitivity != list.stretch.wsola.sensitivity
                || p.wsola.floor != list.stretch.wsola.floor
                || p.wsola.guard_hops != list.stretch.wsola.guard_hops
                || p.ratio != list.stretch.ratio
                || p.window_ms != list.stretch.window_ms
                || p.grain.overlap != list.stretch.grain.overlap
                || p.grain.density_hz != list.stretch.grain.density_hz;

            p.ratio = list.stretch.ratio;
            p.semitones = list.stretch.semitones;
            p.window_ms = list.stretch.window_ms;
            p.grain = list.stretch.grain;
            p.algorithm = list.stretch.algorithm;
            p.wsola = list.stretch.wsola;
            p.pvsola = list.stretch.pvsola;
            p.hybrid = list.stretch.hybrid;
            h.shared.set_params(p);
        }
        // Rebuilding runs an onset detector over the whole file, so it happens
        // on this thread and only when it can have changed — and not at all
        // while transients are not being preserved, which is the usual case.
        if want_parts {
            if let Some(src) = h.shared.source() {
                separate_soon(app, rel, src, list.stretch.hybrid);
            }
        }
        if want_map && list.stretch.wsola.preserve_transients {
            if let Some(src) = h.shared.source() {
                h.shared.set_map(map_for(&src, &list.stretch, h.sample_rate));
            }
        } else if want_map {
            h.shared.set_map(None);
        }
        if want_bank {
            h.shared.set_bank(engine::stretcher::LayerBank::build(
                list.stretch.algorithm,
                list.stretch.grain.layers,
                MAX_BLOCK,
                h.channels,
                h.sample_rate,
            ));
        }
        h.shared.set_rack(rack_for(app, rel, h.sample_rate, h.channels));
    })
}

/// Split the source into partials, attacks and everything else, on a thread of
/// its own.
///
/// It costs about a tenth of a second per second of stereo — three seconds for
/// a half-minute file — so it cannot happen on the request thread, and it must
/// not happen at all for the four engines that do not need it. Until the result
/// arrives the hybrid plays the grain cloud rather than silence.
///
/// The answer is thrown away if the file has changed by the time it is ready.
/// Switching sounds quickly is exactly when a slow pass is most likely to land
/// late, and separated audio from the wrong file is worse than none.
fn separate_soon(
    app: &Arc<App>,
    rel: &str,
    source: Arc<Source>,
    hybrid: fx::hybrid::HybridParams,
) {
    let app = Arc::clone(app);
    let rel = rel.to_string();
    let _ = std::thread::Builder::new()
        .name("separate".into())
        .spawn(move || {
            let parts =
                fx::hstream::Parts::separate(&source.samples, source.channels, hybrid);
            let still = app
                .playing
                .read()
                .ok()
                .and_then(|g| g.as_ref().map(|(p, _, _)| p.clone()));
            if still.as_deref() != Some(rel.as_str()) {
                return;
            }
            let _ = with(&app, |h| h.shared.set_parts(std::sync::Arc::new(parts)));
        });
}

/// The map WSOLA needs for a document, or `None` for a straight line.
///
/// Runs the onset detector, so it belongs on whatever thread called in and
/// never on the audio thread.
fn map_for(
    source: &Source,
    stretch: &fx::Stretch,
    sample_rate: u32,
) -> Option<fx::transient::TimeMap> {
    if !stretch.wsola.preserve_transients {
        return None;
    }
    let hop = fx::grain::plan(
        source.frames(),
        sample_rate,
        stretch.ratio,
        stretch.window_ms,
        &stretch.grain,
    )
    .hop
    .max(1);
    fx::stream::WsolaStream::build_map(
        &source.samples,
        source.channels,
        sample_rate,
        stretch.ratio,
        hop,
        &stretch.wsola,
    )
}

