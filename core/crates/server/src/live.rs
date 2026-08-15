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
use engine::{conform_channels, resample, Handle, Source};
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
    let frames = *app.buffer_frames.read().unwrap();
    *slot = Some(engine::spawn(idle_params(), silent, frames)?);
    Ok(())
}

/// Close the device and open it again at a new block size.
///
/// A stream's block length is fixed when it is built, so this is the only way
/// to change it. Whatever was loaded is loaded again afterwards — the engine
/// that held it is gone, and coming back to a silent transport with the file
/// still named on screen would be worse than a moment's gap.
pub fn restart(app: &Arc<App>, frames: Option<u32>) -> Result<(), String> {
    app.set_buffer_frames(frames)
        .map_err(|e| format!("could not save the buffer size: {e}"))?;

    let held = app.playing.read().ok().and_then(|g| g.clone());
    {
        let mut slot = app
            .audio
            .lock()
            .map_err(|_| "the audio engine is wedged".to_string())?;
        if let Some(h) = slot.take() {
            h.stop();
        }
    }
    ensure(app)?;

    if let Some(now) = held {
        let found = app
            .library_path()
            .and_then(|l| crate::safety::resolve_within(&l, &now.rel));
        if let Some(path) = found {
            let how = if now.document { Playing::Document } else { Playing::Raw };
            let _ = load(app, &now.rel, &path, how);
        }
    }
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
        cloud: false,
        cloud_mix: 0.5,
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

/// Whether the engine is being given a document or a sound.
///
/// Auditioning in the library is the second kind. Clicking a file there is a
/// question about the file — what is this? — and answering it through whatever
/// stretch, grain cloud and effect rack that file was last left with answers a
/// different question entirely. A sound that plays back at thirty-six times its
/// length because of something done to it last week is not an audition.
///
/// The editor is the first kind: there the document is the point.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Playing {
    /// The file itself. No edits, no stretch, no grains, no rack.
    Raw,
    /// The document, with everything on it.
    Document,
}

/// The list to hand the engine.
///
/// Pulled out and made a function of its arguments because it is the whole of
/// the rule, and the rest of `load` is machinery around it.
pub fn playback_list(
    how: Playing,
    saved: Option<edit::EditList>,
    identity: edit::EditList,
) -> edit::EditList {
    match how {
        Playing::Raw => identity,
        Playing::Document => saved.unwrap_or(identity),
    }
}

/// Decode a file, fold in the structural edits, resample to the device, and
/// hand the result to the audio thread.
///
/// This is the expensive call — it is per file opened, not per parameter move.
pub fn load(
    app: &Arc<App>,
    rel: &str,
    path: &std::path::Path,
    how: Playing,
) -> Result<Loaded, String> {
    ensure(app)?;

    let mut reader = audio_core::open(path).map_err(|e| format!("could not open: {e}"))?;
    let info = reader.info();
    let src_rate = info.sample_rate;
    let channels = info.channels.max(1) as usize;

    // The document as it stands, structure only. `render` walks the clips; the
    // stretch on the list is deliberately not applied here, because that is the
    // engine's job now and doing it twice would double the effect.
    let list = playback_list(
        how,
        app.edits.snapshot(rel),
        edit::EditList::identity(info.frames(), info.channels, src_rate),
    );
    let frames = list.base_frames();
    let samples = edit::render::render(&list, &mut reader, 0, frames)
        .map_err(|e| format!("could not render the edit: {e}"))?;

    let (dev_rate, dev_channels) = with(app, |h| (h.sample_rate, h.channels))?;
    let samples = resample(&samples, channels, src_rate, dev_rate);
    // And laid out for the device. The engines index their input with the
    // count they render at, so a mono file on a stereo device was read two
    // samples at a time — twice too fast, and out of material half way. From
    // here on `Source.channels` is the device's, always.
    let samples = conform_channels(&samples, channels, dev_channels);
    let channels = dev_channels.max(1);
    let out_frames = samples.len() / channels;

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
        cloud: list.stretch.cloud,
        cloud_mix: list.stretch.cloud_mix,
    };

    with(app, |h| {
        h.shared.set_source(Arc::clone(&source));
        h.shared.set_params(params);
        h.shared.set_map(map_for(&source, &list.stretch, dev_rate));
        // Whatever was separated belongs to the file that just closed.
        h.shared.set_parts(std::sync::Arc::new(fx::hstream::Parts::default()));
        h.shared.request_seek(0);
        // An audition carries no rack either. `list` is already the bare file
        // when raw, so the stretch and grain settings are gone with it; the
        // rack is held separately and has to be dropped on its own.
        h.shared.set_rack(match how {
            Playing::Raw => None,
            Playing::Document => rack_for(app, rel, h.sample_rate, h.channels),
        });
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
    *app.playing.write().unwrap() = Some(crate::state::NowPlaying {
        rel: rel.to_string(),
        frames: out_frames as u64,
        device_rate: dev_rate,
        document: how == Playing::Document,
        doc_frames: list.frames(),
        doc_channels: list.channels,
        doc_rate: list.sample_rate,
    });

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

/// Fold a document's stretch settings into the parameters the audio thread holds.
///
/// **Field by field, and deliberately not a replacement.** `in_frames` and
/// `sample_rate` describe the *source the engine is holding*, not the document
/// — overwriting them with a document's idea of its own length is how a stale
/// source and fresh parameters get to disagree, which is heard as a sound that
/// plays too fast and then stops.
///
/// The catch with writing it out by hand is the other way round: `vocoder` was
/// missing from this list, so every control on the vocoder panel — the analysis
/// window, phase lock, freeze, blur, gate, all of it — moved the exported file
/// and nothing you could hear, until the file happened to be reloaded. Same
/// family of bug as PVSOLA and the hybrid having no pitch. The test below is
/// what says the list is complete.
pub fn merge_stretch(p: &mut StreamParams, s: &fx::Stretch) {
    p.ratio = s.ratio;
    p.semitones = s.semitones;
    p.window_ms = s.window_ms;
    p.grain = s.grain;
    p.algorithm = s.algorithm;
    p.wsola = s.wsola;
    p.vocoder = s.vocoder;
    p.pvsola = s.pvsola;
    p.hybrid = s.hybrid;
    p.cloud = s.cloud;
    p.cloud_mix = s.cloud_mix;
}

/// Is the engine holding this document?
///
/// The one question that decides whether a parameter may be pushed. What comes
/// out of the speakers has to be what is on the screen, and the two are only
/// the same thing while the engine is holding the document being adjusted.
pub fn holding(app: &Arc<App>, rel: &str) -> bool {
    app.playing
        .read()
        .unwrap()
        .as_ref()
        .is_some_and(|n| n.rel == rel)
}

/// What actually has to be rebuilt for a parameter change to be heard.
///
/// Lifted out of `push_params` because getting it wrong is not a wrong value,
/// it is a glitch — and it has been wrong three times. The rack used to be
/// rebuilt unconditionally, which cut every reverb tail on every slider. Then
/// Density was found re-running an onset detector over the whole source on each
/// step of a drag, and Layers allocating a fresh engine per layer and throwing
/// away every splice history. All three are the same mistake: doing expensive,
/// stateful work to communicate a number.
///
/// The rack is absent on purpose. Nothing about a stretch parameter can require
/// it, and that is enforced by there being no field for it here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Rebuilds {
    /// The transient map: an onset pass over the entire source.
    pub map: bool,
    /// The hybrid's separation: two spectrogram passes per channel.
    pub parts: bool,
    /// One engine allocated per extra layer, and every layer's state discarded.
    pub bank: bool,
}

impl Rebuilds {
    pub fn decide(now: &StreamParams, want: &fx::Stretch) -> Rebuilds {
        // The panel sends `draft` while a control is moving and its real
        // quality when released, so a drag is already distinguishable from a
        // decision without inventing a flag.
        let settled = want.quality != fx::stretch::Quality::Draft;

        Rebuilds {
            // Deferred while dragging: a moment of stale transient placement is
            // inaudible, and rebuilding per step is not.
            map: settled
                && (now.wsola.preserve_transients != want.wsola.preserve_transients
                    || now.wsola.sensitivity != want.wsola.sensitivity
                    || now.wsola.floor != want.wsola.floor
                    || now.wsola.guard_hops != want.wsola.guard_hops
                    || now.ratio != want.ratio
                    || now.window_ms != want.window_ms
                    || now.grain.overlap != want.grain.overlap
                    || now.grain.density_hz != want.grain.density_hz),
            // Only the hybrid separates, and only its own settings decide it.
            // Already off the calling thread, so it does not wait for a release.
            parts: want.algorithm == fx::stretch::Algorithm::Hybrid
                && (now.hybrid.split() != want.hybrid.split()
                    || now.algorithm != fx::stretch::Algorithm::Hybrid),
            // Switching engine is not a drag — the new one has to be there
            // before the next block or it renders with the wrong engine. The
            // layer count is a drag, and waits.
            bank: now.algorithm != want.algorithm
                || (settled && now.grain.layers != want.grain.layers),
        }
    }
}

/// Push the performance parameters of a document at the engine.
///
/// Called on every slider move, so it must stay cheap: no decode, no render,
/// and — since the rack rebuild was taken out — no allocation at all on the
/// ordinary path. What is left that is not cheap is gated by [`Rebuilds`].
pub fn push_params(app: &Arc<App>, rel: &str, list: &edit::EditList) -> Result<(), String> {
    // Parameters belong to the audio the engine is holding, and only a load
    // changes that. Opening a second sound and moving a slider before playing
    // it used to push the new document's settings onto the old one's buffer:
    // the parameters then say one length and the samples are another, which is
    // heard as a sound playing at the wrong speed and stopping early. It is
    // also, more simply, the wrong sound.
    //
    // Nothing is lost by returning here. A load reads the document as it
    // stands, so the settings being pushed are picked up in full the moment
    // this sound is actually played.
    if !holding(app, rel) {
        return Ok(());
    }
    with(app, |h| {
        // Decided against what the audio thread is actually running, before the
        // new values are merged over it — after the merge there is nothing left
        // to compare. See `Rebuilds`.
        let r = match h.shared.params() {
            Some(mut p) => {
                let r = Rebuilds::decide(&p, &list.stretch);
                merge_stretch(&mut p, &list.stretch);
                h.shared.set_params(p);
                r
            }
            None => Rebuilds::default(),
        };
        let (want_map, want_parts, want_bank) = (r.map, r.parts, r.bank);
        if want_parts {
            if let Some(src) = h.shared.source() {
                separate_soon(app, rel, src, list.stretch.hybrid);
            }
        }
        // An onset detector over the whole file, on this thread. Only when it
        // can have changed, only once the drag has settled, and not at all
        // while transients are not being preserved — which is the usual case.
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
        // The rack is deliberately *not* rebuilt here.
        //
        // This runs on every stretch and grain parameter, and handing over a
        // fresh rack replaces every filter, delay line and reverb tail in the
        // chain — heard as the effects ducking out and fading back in on each
        // slider move. The three things above are each guarded for exactly that
        // reason; this one was not, and it was the loudest of the four.
        //
        // Nothing here needs it. The rack belongs to `load` (the file changed)
        // and to `/api/rack` (its structure changed); a stretch parameter is
        // neither. `/api/rack` already learned this and guards on `keepLive` —
        // its comment says so in as many words.
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
                .and_then(|g| g.as_ref().map(|n| n.rel.clone()));
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


#[cfg(test)]
mod rebuild_tests {
    use super::Rebuilds;
    use fx::grain::StreamParams;

    const SR: u32 = 48_000;

    /// What the audio thread is holding for an untouched document.
    ///
    /// Derived by folding the document's own defaults in, rather than trusting
    /// `StreamParams::new` to agree with `Stretch::default()` — they do not
    /// (one starts on the grain cloud, the other does not), and a baseline that
    /// already differs would make every test below pass for the wrong reason.
    fn running() -> StreamParams {
        let mut p = StreamParams::new(48_000, SR);
        super::merge_stretch(&mut p, &fx::Stretch::default());
        p
    }

    /// A document at the quality the panel sends when a control is released.
    fn released(f: impl FnOnce(&mut fx::Stretch)) -> fx::Stretch {
        let mut s = fx::Stretch::default();
        s.quality = fx::stretch::Quality::Standard;
        f(&mut s);
        s
    }

    fn dragging(f: impl FnOnce(&mut fx::Stretch)) -> fx::Stretch {
        let mut s = released(f);
        s.quality = fx::stretch::Quality::Draft;
        s
    }

    /// The glitch. Density is in the transient map's inputs, so every step of
    /// the drag re-ran an onset detector over the whole source.
    #[test]
    fn density_does_not_rebuild_the_map_while_the_control_is_moving() {
        let now = running();
        let mid = dragging(|s| {
            s.wsola.preserve_transients = true;
            s.grain.density_hz = 120.0;
        });
        assert!(!Rebuilds::decide(&now, &mid).map, "rebuilt mid-drag");

        let end = released(|s| {
            s.wsola.preserve_transients = true;
            s.grain.density_hz = 120.0;
        });
        assert!(Rebuilds::decide(&now, &end).map, "never rebuilt at all");
    }

    /// The other one. Each step allocated a fresh engine per layer and threw
    /// away every layer's splice history.
    #[test]
    fn layers_does_not_rebuild_the_bank_while_the_control_is_moving() {
        let now = running();
        assert!(!Rebuilds::decide(&now, &dragging(|s| s.grain.layers = 8)).bank);
        assert!(Rebuilds::decide(&now, &released(|s| s.grain.layers = 8)).bank);
    }

    /// But switching engine cannot wait: the next block would render with the
    /// wrong one.
    #[test]
    fn changing_engine_rebuilds_the_bank_even_mid_drag() {
        let now = running();
        // Deliberately not the one the document already starts on, or this
        // would assert nothing.
        let moved = dragging(|s| s.algorithm = fx::stretch::Algorithm::Vocoder);
        assert_ne!(now.algorithm, moved.algorithm, "the test picked the same engine");
        assert!(Rebuilds::decide(&now, &moved).bank);
    }

    /// Nothing moved, nothing rebuilds — however many times the panel posts.
    #[test]
    fn an_unchanged_document_rebuilds_nothing() {
        let now = running();
        let same = released(|_| {});
        assert_eq!(Rebuilds::decide(&now, &same), Rebuilds::default());
    }

    /// The separation is already off this thread, so it does not wait — but it
    /// only happens on the engine that has one.
    #[test]
    fn only_the_hybrid_separates() {
        let now = running();
        let h = dragging(|s| s.algorithm = fx::stretch::Algorithm::Hybrid);
        assert!(Rebuilds::decide(&now, &h).parts);
        assert!(!Rebuilds::decide(&now, &dragging(|s| s.algorithm = fx::stretch::Algorithm::Vocoder)).parts);
    }
}

#[cfg(test)]
mod merge_tests {
    use super::merge_stretch;
    use fx::grain::StreamParams;

    /// Every field of the document's stretch has to reach the audio thread.
    ///
    /// `vocoder` was missing, so the whole vocoder panel moved the export and
    /// nothing that could be heard. Written as "change everything, then check
    /// nothing is still at its default" so the next field added is covered by
    /// this test without anyone remembering to come back here.
    #[test]
    fn every_stretch_setting_reaches_the_parameters() {
        let mut s = fx::Stretch::default();
        s.ratio = 3.5;
        s.semitones = -7.0;
        s.window_ms = 123.0;
        s.algorithm = fx::stretch::Algorithm::Pvsola;
        s.grain.layers = 9;
        s.wsola.stride = 17;
        s.vocoder.window_ms = 321.0;
        s.vocoder.phase_lock = !fx::Stretch::default().vocoder.phase_lock;
        s.pvsola.anchor_frames = 21;
        s.hybrid.margin = 4.5;

        let mut p = StreamParams::new(1000, 48_000);
        merge_stretch(&mut p, &s);

        assert_eq!(p.ratio, 3.5);
        assert_eq!(p.semitones, -7.0);
        assert_eq!(p.window_ms, 123.0);
        assert_eq!(p.algorithm, fx::stretch::Algorithm::Pvsola);
        assert_eq!(p.grain.layers, 9);
        assert_eq!(p.wsola.stride, 17);
        assert_eq!(p.vocoder.window_ms, 321.0, "the vocoder panel is not reaching the audio");
        assert_eq!(p.vocoder.phase_lock, s.vocoder.phase_lock);
        assert_eq!(p.pvsola.anchor_frames, 21);
        assert_eq!(p.hybrid.margin, 4.5);
    }

    /// And nothing about the *source* may be overwritten by the document.
    ///
    /// The engine's length belongs to the buffer it is holding. A document
    /// saying otherwise is how a stale source and fresh parameters disagree,
    /// which is heard as a sound that plays too fast and then stops.
    #[test]
    fn the_sources_own_facts_survive_a_merge() {
        let mut p = StreamParams::new(176_228, 48_000);
        let s = fx::Stretch { ratio: 36.6, ..fx::Stretch::default() };
        merge_stretch(&mut p, &s);
        assert_eq!(p.in_frames, 176_228, "the document overwrote the source length");
        assert_eq!(p.sample_rate, 48_000, "the document overwrote the device rate");
    }
}
