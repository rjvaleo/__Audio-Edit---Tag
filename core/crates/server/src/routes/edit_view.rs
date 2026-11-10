//! The edit view: get, apply, measure and snap.

use super::*;

pub(super) fn api_edit_get(app: &Arc<App>, req: &Request) -> Response {
    let Some(rel) = req.param("p") else {
        return Response::error(400, "no path given");
    };
    let Some(identity) = identity_for(app, rel) else {
        return Response::error(404, "no such file in the library");
    };
    let out = app.edits.with(rel, || identity, |s| {
        crate::docs::edit_json(s.list(), s.can_undo(), s.can_redo())
    });
    Response::json(out.to_string())
}

/// Open a document, its source and its rack together, for measuring.
///
/// Everything that has to look at the audio before it can decide what to do —
/// snap, normalise, strip silence, find the click — goes through here, and all
/// of it runs **before** the session lock is taken. `EditStore::with` holds a
/// mutex, `std`'s is not reentrant, and a measurement reaching back through the
/// store from inside that closure deadlocks the request and every edit after it.
fn measuring<T>(
    app: &Arc<App>,
    rel: &str,
    fallback: &edit::EditList,
    f: impl FnOnce(
        &edit::EditList,
        &mut audio_core::Reader<audio_core::FileSource>,
        &mut fx::Rack,
    ) -> Option<T>,
) -> Option<T> {
    let list = app.edits.snapshot(rel).unwrap_or_else(|| fallback.clone());
    let path = resolve_within(&app.library_path()?, rel)?;
    let mut reader = audio_core::open(&path).ok()?;
    let (rate, chans) = {
        let i = reader.info();
        (i.sample_rate, i.channels as usize)
    };
    let mut rack = app.racks.get(rel).build(rate, chans);
    f(&list, &mut reader, &mut rack)
}

/// Pull one position onto the nearest place the waveform crosses zero.
///
/// Only the window that could possibly hold the answer is rendered, so this
/// costs a few milliseconds of audio however long the file is. A position with
/// no crossing within reach is returned untouched — snap moves an edit a little
/// or not at all, never somewhere the user did not ask for.
fn snap_to_zero(
    list: &edit::EditList,
    reader: &mut audio_core::Reader<audio_core::FileSource>,
    rack: &mut fx::Rack,
    pos: u64,
    radius: u64,
) -> u64 {
    let total = list.frames();
    let channels = list.channels.max(1) as usize;
    let from = pos.saturating_sub(radius);
    let count = (pos + radius + 1).min(total).saturating_sub(from);
    if count < 2 {
        return pos;
    }
    match edit::render::render_fx(list, reader, rack, from, count) {
        Ok(buf) => edit::snap::nearest_zero_crossing(&buf, channels, from, pos, radius)
            .unwrap_or(pos),
        Err(_) => pos,
    }
}

/// Measure the edited timeline without changing it.
///
/// Peak's Find Peak is exactly this: a measurement that moves the insertion
/// point. It is a separate route rather than an edit operation because it
/// changes nothing, and an entry in the undo history for something that changed
/// nothing is worse than no entry at all.
pub(super) fn api_measure(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(rel) = v.get("p").and_then(|p| p.as_str()) else {
        return Response::error(400, "no path given");
    };
    let Some(identity) = identity_for(app, rel) else {
        return Response::error(404, "no such file in the library");
    };
    let num = |k: &str| -> u64 {
        match v.get(k) {
            Some(Value::Num(n)) if *n >= 0.0 => *n as u64,
            _ => 0,
        }
    };
    let range = edit::Range::new(num("start"), num("end"));

    let out = measuring(app, rel, &identity, |list, r, rack| {
        let (peak, rms) = edit::analyse::measure_level(list, r, rack, range).ok()?;
        let peak_at = edit::analyse::find_peak(list, r, rack, range).ok()?;
        let click = edit::analyse::find_click(list, r, rack, range).ok()?;
        let db = |x: f32| -> f64 {
            if x <= 0.0 {
                -144.0
            } else {
                20.0 * (x as f64).log10()
            }
        };
        let mut o = Value::obj()
            .set("peak", peak as f64)
            .set("peakDb", db(peak))
            .set("rms", rms as f64)
            .set("rmsDb", db(rms))
            .set("frames", list.frames())
            .set("sampleRate", list.sample_rate as f64);
        if let Some((frame, value)) = peak_at {
            o = o.set("peakFrame", frame).set("peakValue", value as f64);
        }
        if let Some((frame, dev)) = click {
            o = o.set("clickFrame", frame).set("clickDeviation", dev as f64);
        }
        Some(o)
    });

    match out {
        Some(o) => Response::json(o.to_string()),
        None => Response::error(500, "could not read the audio"),
    }
}

pub(super) fn api_edit_apply(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(rel) = v.get("p").and_then(|p| p.as_str()) else {
        return Response::error(400, "no path given");
    };
    let Some(identity) = identity_for(app, rel) else {
        return Response::error(404, "no such file in the library");
    };
    let op = v.get("op").and_then(|o| o.as_str()).unwrap_or("");

    // What the document's controls were before this message, so a recorded
    // take can tell which of them the hand actually moved. The stretch route
    // posts the whole panel every time.
    let before = (op == "stretch").then(|| app.edits.snapshot(rel).map(|l| l.stretch)).flatten();

    let num = |k: &str| -> u64 {
        match v.get(k) {
            Some(Value::Num(n)) if *n >= 0.0 => *n as u64,
            _ => 0,
        }
    };
    let float = |k: &str, d: f32| -> f32 {
        match v.get(k) {
            Some(Value::Num(n)) => *n as f32,
            _ => d,
        }
    };
    let shape = if v.get("shape").and_then(|s| s.as_str()) == Some("linear") {
        edit::FadeShape::Linear
    } else {
        edit::FadeShape::EqualPower
    };

    // Where the edit actually lands.
    //
    // Absent means no snap, so every caller that has never heard of it — and
    // every test written before it existed — gets exactly the position it
    // asked for. The interface turns it on, as Peak does by default.
    let unit = edit::snap::SnapUnit::from_str(
        v.get("snap").and_then(|s| s.as_str()).unwrap_or("off"),
    );
    let (asked_start, asked_end) = (num("start"), num("end"));
    let (start, end) = match unit {
        edit::snap::SnapUnit::Off => (asked_start, asked_end),
        edit::snap::SnapUnit::Grid(n) => (
            edit::snap::snap_grid(asked_start, n),
            edit::snap::snap_grid(asked_end, n),
        ),
        edit::snap::SnapUnit::ZeroCrossing => measuring(app, rel, &identity, |list, r, rack| {
            let radius = edit::snap::radius_frames(list.sample_rate);
            Some((
                snap_to_zero(list, r, rack, asked_start, radius),
                snap_to_zero(list, r, rack, asked_end, radius),
            ))
        })
        .unwrap_or((asked_start, asked_end)),
    };
    let range = edit::Range::new(start, end);

    // Everything that has to look at the audio before it can decide happens
    // here, above the session lock. See `measuring`.
    let measured_peak = if op == "normalize" {
        measuring(app, rel, &identity, |list, r, rack| {
            edit::render::measure_peak_fx(list, r, rack).ok()
        })
    } else {
        None
    };

    let measured_level = if op == "normalizeRms" {
        measuring(app, rel, &identity, |list, r, rack| {
            edit::analyse::measure_level(list, r, rack, range).ok()
        })
    } else {
        None
    };

    let silent_runs = if op == "stripSilence" {
        measuring(app, rel, &identity, |list, r, rack| {
            let rate = list.sample_rate.max(1);
            let ms = |k: &str, d: f32| -> u64 {
                (float(k, d).max(0.0) / 1000.0 * rate as f32) as u64
            };
            let params = edit::analyse::StripParams {
                threshold_db: float("thresholdDb", -40.0).clamp(-90.0, 0.0),
                min_frames: ms("minMs", 100.0),
                pad_frames: ms("padMs", 10.0),
                hop: edit::analyse::envelope_frames(rate),
            };
            edit::analyse::silent_runs(list, r, rack, range, &params).ok()
        })
    } else {
        None
    };

    // Repairing a click is a measurement and an excision. The window is centred
    // on the damage and then each edge is pulled to a zero crossing, which is
    // what keeps the join — and so the taper that closes it — as short as it is.
    let click_cut = if op == "repairClick" {
        measuring(app, rel, &identity, |list, r, rack| {
            let (at, _) = edit::analyse::find_click(list, r, rack, range).ok()??;
            let rate = list.sample_rate.max(1);
            let half = ((float("widthMs", 1.0).clamp(0.05, 50.0) / 2000.0) * rate as f32).max(1.0)
                as u64;
            // The snap radius must be smaller than the half-width, or both
            // edges are pulled onto the *same* crossing, the window closes to
            // nothing and the repair silently does nothing at all.
            let radius = (half / 2).max(1);
            let lo = at.saturating_sub(half);
            let hi = (at + half).min(list.frames());
            let a = snap_to_zero(list, r, rack, lo, radius);
            let b = snap_to_zero(list, r, rack, hi, radius);
            // If they still met, the damage is narrower than one crossing
            // apart; take the window as asked rather than nothing.
            let (a, b) = if b > a { (a, b) } else { (lo, hi) };
            Some((edit::Range::new(a, b), radius))
        })
    } else {
        None
    };

    // Paste goes back only into the document the clips were copied from: they
    // index that file's audio.
    let pasting = if op == "paste" {
        match app.clipboard.lock().unwrap().as_ref() {
            Some((from, clips)) if from == rel => Some(clips.clone()),
            Some(_) => return Response::error(409, "paste goes into the sound it was copied from"),
            None => return Response::error(409, "nothing has been copied"),
        }
    } else {
        None
    };
    let mut copied: Option<Vec<edit::Clip>> = None;

    let mut unknown = false;
    let out = app.edits.with(rel, || identity, |s| {
        match op {
            "copy" => { copied = Some(s.list().copy(range)); }
            "cut" => {
                copied = Some(s.list().copy(range));
                s.apply(|l| l.cut(range));
            }
            "delete" => { s.apply(|l| l.cut(range)); }
            "paste" => {
                if let Some(clips) = pasting.as_ref() {
                    s.apply(|l| l.paste(start, Some(range), clips));
                }
            }
            "silence" => { s.apply(|l| l.silence(range)); }
            "gain" => { let db = float("db", 0.0); s.apply(|l| l.gain_db(range, db)); }
            "fadeIn" => { let n = num("frames"); s.apply(|l| l.fade_in(range, n, shape)); }
            "fadeOut" => { let n = num("frames"); s.apply(|l| l.fade_out(range, n, shape)); }
            "reverse" => { s.apply(|l| l.reverse(range)); }
            "stretch" => {
                // Deliberately extreme. A hundred times longer is the point of
                // a granular stretcher: at those ratios the grain window and
                // its jitter are doing the work, not the time base.
                // Absent means unchanged, the same rule the engine settings
                // below already followed. These three used to fall back to
                // their factory values instead, so a control that mentioned
                // only one of them silently reset the other two — invisible
                // today because the panel always posts all three, and a trap
                // for the first caller that does not.
                let cur = s.list().stretch;
                let ratio = float("ratio", cur.ratio).clamp(0.01, 100.0);
                let semis = float("semitones", cur.semitones).clamp(-48.0, 48.0);
                let window = float("windowMs", cur.window_ms).clamp(5.0, 2000.0);
                // Read the current tier from the session already in hand.
                // Going back through the store would re-lock the mutex this
                // closure runs inside, and std's Mutex is not reentrant — that
                // deadlocks the request and every edit after it.
                let quality = match v.get("quality").and_then(|q| q.as_str()) {
                    Some("draft") => fx::stretch::Quality::Draft,
                    Some("best") => fx::stretch::Quality::Best,
                    Some("standard") => fx::stretch::Quality::Standard,
                    // Omitted entirely: keep whatever the document already has,
                    // so a control that does not mention quality cannot reset it.
                    _ => s.list().stretch.quality,
                };
                // Same rule as quality: absent means unchanged, so a control
                // that says nothing about the engine cannot switch it.
                let algorithm = v
                    .get("algorithm")
                    .and_then(|a| a.as_str())
                    .and_then(fx::stretch::Algorithm::from_str)
                    .unwrap_or(s.list().stretch.algorithm);
                // The vocoder's own windowing, kept apart from the window
                // above because the two engines mean different things by it.
                let cv = s.list().stretch.vocoder;
                let vv = v.get("vocoder");
                let vf = |k: &str, d: f32| -> f32 {
                    match vv.and_then(|x| x.get(k)) {
                        Some(Value::Num(n)) if n.is_finite() => *n as f32,
                        _ => d,
                    }
                };
                let vocoder = fx::stretch::VocoderParams {
                    window_ms: vf("windowMs", cv.window_ms).clamp(5.0, 500.0),
                    phase_lock: match vv.and_then(|x| x.get("phaseLock")) {
                        Some(Value::Bool(b)) => *b,
                        _ => cv.phase_lock,
                    },
                    freq_trust: vf("freqTrust", cv.freq_trust).clamp(0.0, 4.0),
                    phase_spread: vf("phaseSpread", cv.phase_spread).clamp(0.0, 4.0),
                    peak_width: vf("peakWidth", cv.peak_width as f32).clamp(1.0, 32.0) as u32,
                    lock_width: vf("lockWidth", cv.lock_width).clamp(0.0, 4.0),
                    mag_freeze: vf("magFreeze", cv.mag_freeze).clamp(0.0, 1.0),
                    mag_blur: vf("magBlur", cv.mag_blur).clamp(0.0, 1.0),
                    mag_gate: vf("magGate", cv.mag_gate).clamp(0.0, 1.0),
                    stereo_link: match vv.and_then(|x| x.get("stereoLink")) {
                        Some(Value::Bool(b)) => *b,
                        _ => cv.stereo_link,
                    },
                };
                // Grain settings arrive as a nested object; anything absent
                // keeps its current value so one slider cannot reset the rest.
                let cur = s.list().stretch.grain;
                let gv = v.get("grain");
                let gf = |k: &str, d: f32| -> f32 {
                    match gv.and_then(|g| g.get(k)) {
                        Some(Value::Num(n)) if n.is_finite() => *n as f32,
                        _ => d,
                    }
                };
                let cw = s.list().stretch.wsola;
                let wv = v.get("wsola");
                let wf = |k: &str, d: f32| -> f32 {
                    match wv.and_then(|x| x.get(k)) {
                        Some(Value::Num(n)) if n.is_finite() => *n as f32,
                        _ => d,
                    }
                };
                let wsola = fx::stretch::WsolaParams {
                    preserve_transients: match wv.and_then(|x| x.get("preserveTransients")) {
                        Some(Value::Bool(b)) => *b,
                        _ => cw.preserve_transients,
                    },
                    sensitivity: wf("sensitivity", cw.sensitivity).clamp(0.0, 1.0),
                    search_ms: wf("searchMs", cw.search_ms).clamp(0.0, 200.0),
                    splice: wv
                        .and_then(|x| x.get("splice"))
                        .and_then(|x| x.as_str())
                        .and_then(fx::stretch::Splice::from_str)
                        .unwrap_or(cw.splice),
                    stride: wf("stride", cw.stride as f32).clamp(1.0, 256.0) as u32,
                    shape: wv
                        .and_then(|x| x.get("shape"))
                        .and_then(|x| x.as_str())
                        .and_then(fx::stretch::WinShape::from_str)
                        .unwrap_or(cw.shape),
                    guard_hops: wf("guardHops", cw.guard_hops).clamp(1.0, 16.0),
                    floor: wf("floor", cw.floor).clamp(0.0, 2.0),
                };

                let cp = s.list().stretch.pvsola;
                let pv = v.get("pvsola");
                let pf = |k: &str, d: f32| -> f32 {
                    match pv.and_then(|x| x.get(k)) {
                        Some(Value::Num(n)) if n.is_finite() => *n as f32,
                        _ => d,
                    }
                };
                let pvsola = fx::pvsola::PvsolaParams {
                    anchor_frames: pf("anchorFrames", cp.anchor_frames as f32).clamp(1.0, 64.0)
                        as u32,
                    search_ms: pf("searchMs", cp.search_ms).clamp(0.0, 200.0),
                    blend: pf("blend", cp.blend).clamp(0.0, 1.0),
                };

                let ch = s.list().stretch.hybrid;
                let hv = v.get("hybrid");
                let hf = |k: &str, d: f32| -> f32 {
                    match hv.and_then(|x| x.get(k)) {
                        Some(Value::Num(n)) if n.is_finite() => *n as f32,
                        _ => d,
                    }
                };
                let hybrid = fx::hybrid::HybridParams {
                    fft_size: hf("fftSize", ch.fft_size as f32).clamp(256.0, 8192.0) as u32,
                    time_span: hf("timeSpan", ch.time_span as f32).clamp(3.0, 101.0) as u32,
                    freq_span: hf("freqSpan", ch.freq_span as f32).clamp(3.0, 101.0) as u32,
                    margin: hf("margin", ch.margin).clamp(1.0, 8.0),
                    morph_noise: match hv.and_then(|x| x.get("morphNoise")) {
                        Some(Value::Bool(b)) => *b,
                        _ => ch.morph_noise,
                    },
                    harmonic_level: hf("harmonicLevel", ch.harmonic_level).clamp(0.0, 4.0),
                    percussive_level: hf("percussiveLevel", ch.percussive_level).clamp(0.0, 4.0),
                    residual_level: hf("residualLevel", ch.residual_level).clamp(0.0, 4.0),
                };

                let grain = fx::Grain {
                    // The cloud's own emission rate. Zero keeps the old rule, so a
                    // document written before this existed sounds as it did.
                    rate_hz: gf("rateHz", cur.rate_hz).clamp(0.0, 2000.0),
                    density_hz: gf("densityHz", cur.density_hz).clamp(0.0, 500.0),
                    layers: gf("layers", cur.layers as f32).clamp(1.0, fx::grain::MAX_LAYERS as f32) as u32,
                    overlap: gf("overlap", cur.overlap).clamp(1.0, 8.0),
                    size_jitter: gf("sizeJitter", cur.size_jitter).clamp(0.0, 1.0),
                    position_jitter_ms: gf("positionJitterMs", cur.position_jitter_ms)
                        .clamp(0.0, 2000.0),
                    pitch_jitter_semis: gf("pitchJitterSemis", cur.pitch_jitter_semis)
                        .clamp(0.0, 24.0),
                    pitch_drift_semis: gf("pitchDriftSemis", cur.pitch_drift_semis)
                        .clamp(0.0, 24.0),
                    drift_rate_hz: gf("driftRateHz", cur.drift_rate_hz).clamp(0.01, 20.0),
                    seed: gf("seed", cur.seed as f32).max(0.0) as u32,
                    position: gf("position", cur.position).clamp(-1.0, 1.0),
                    scan: gf("scan", cur.scan).clamp(-4.0, 4.0),
                    reverse: match gv.and_then(|x| x.get("reverse")) {
                        Some(Value::Bool(b)) => *b,
                        _ => cur.reverse,
                    },
                    envelope: gf("envelope", cur.envelope).clamp(0.0, 1.0),
                    size_range: gf("sizeRange", cur.size_range).clamp(1.0, 8.0),
                    wrap: match gv.and_then(|x| x.get("wrap")) {
                        Some(Value::Bool(b)) => *b,
                        _ => cur.wrap,
                    },
                    layer_spread: gf("layerSpread", cur.layer_spread).clamp(0.0, 4.0),
                    layer_scatter: gf("layerScatter", cur.layer_scatter).clamp(0.0, 1.0),
                    layer_scatter_ms: gf("layerScatterMs", cur.layer_scatter_ms)
                        .clamp(0.0, 5000.0),
                    // Derived per layer while rendering, never carried on the
                    // document.
                    layer_read: 0.0,
                    link_jitter: match gv.and_then(|x| x.get("linkJitter")) {
                        Some(Value::Bool(b)) => *b,
                        _ => cur.link_jitter,
                    },
                    drift_step: match gv.and_then(|x| x.get("driftStep")) {
                        Some(Value::Bool(b)) => *b,
                        _ => cur.drift_step,
                    },
                    pan_spread: gf("panSpread", cur.pan_spread).clamp(0.0, 1.0),
                    fb_amount: gf("fbAmount", cur.fb_amount).clamp(0.0, 0.95),
                    fb_time_ms: gf("fbTimeMs", cur.fb_time_ms).clamp(20.0, 2000.0),
                    fb_smear: gf("fbSmear", cur.fb_smear).clamp(0.0, 1.0),
                    fb_damp: gf("fbDamp", cur.fb_damp).clamp(0.0, 1.0),
                    fb_shift: gf("fbShift", cur.fb_shift).clamp(-12.0, 12.0),
                    fb_hold: match gv.and_then(|x| x.get("fbHold")) {
                        Some(Value::Bool(b)) => *b,
                        _ => cur.fb_hold,
                    },
                };
                // Absent leaves the scale alone, so moving the pitch does not
                // silently clear the tuning it is snapping to.
                let scale = match v.get("scale") {
                    Some(Value::Str(name)) => fx::tuning::by_name(name),
                    _ => s.list().stretch.scale,
                };
                // Snapped here rather than in the interface, so a value posted
                // by anything — a preset, an automation lane, a script — lands
                // on a degree too. The control is continuous until a scale is
                // chosen; see `fx::tuning`.
                // Absent leaves the grid alone too, for the same reason.
                let pitch_step = match v.get("pitchStep") {
                    Some(Value::Num(n)) if n.is_finite() => (*n as f32).clamp(0.0, 12.0),
                    _ => s.list().stretch.pitch_step,
                };
                let semis = fx::tuning::quantise(semis, scale.map(|x| x.name), pitch_step);
                // Feedback's Shift is in the same tuning as Pitch: a return
                // lands on a degree of the scale chosen, as the pitch does.
                let mut grain = grain;
                grain.fb_shift = fx::tuning::quantise(grain.fb_shift, scale.map(|x| x.name), pitch_step).clamp(-12.0, 12.0);
                // Absent leaves what the document already has, so a client that
                // does not know about the cloud cannot switch it off by not
                // mentioning it. Every other field here works the same way.
                let cloud = match v.get("cloud") {
                    Some(Value::Bool(b)) => *b,
                    _ => s.list().stretch.cloud,
                };
                let cloud_mix = match v.get("cloudMix") {
                    Some(Value::Num(n)) if n.is_finite() => (*n as f32).clamp(0.0, 1.0),
                    _ => s.list().stretch.cloud_mix,
                };
                s.apply(|l| {
                    l.stretch = fx::Stretch {
                        ratio, semitones: semis, window_ms: window, quality,
                        algorithm, vocoder, wsola, pvsola, hybrid, grain, scale, pitch_step,
                        cloud, cloud_mix,
                    };
                });
            }
            "split" => { let p = num("pos"); s.apply(|l| { l.split_at(p); }); }
            "crop" => { s.apply(|l| l.crop(range)); }
            "duplicate" => {
                // A hundred copies of a bar is a composition; a hundred
                // thousand is a mistake with a slider.
                let n = num("count").clamp(1, 128) as u32;
                s.apply(|l| l.duplicate(range, n));
            }
            "insertSilence" => {
                let frames = if v.get("frames").is_some() {
                    num("frames")
                } else {
                    // Peak's dialog takes samples, milliseconds or seconds.
                    // Milliseconds is what the interface has a field for.
                    let rate = s.list().sample_rate.max(1) as f32;
                    (float("ms", 0.0).max(0.0) / 1000.0 * rate) as u64
                };
                s.apply(|l| l.insert_silence(start, frames));
            }
            "normalize" => {
                if let Some(peak) = measured_peak {
                    let target = float("db", -0.3);
                    s.apply(|l| l.normalize(peak, target));
                }
            }
            "normalizeRms" => {
                if let Some((peak, rms)) = measured_level {
                    let target = float("db", -12.0).clamp(-60.0, 0.0);
                    let ceiling = float("ceilingDb", -0.3).clamp(-60.0, 0.0);
                    s.apply(|l| l.normalize_rms(rms, peak, target, ceiling));
                }
            }
            "stripSilence" => {
                if let Some(runs) = silent_runs.as_ref() {
                    let mode = match v.get("mode").and_then(|m| m.as_str()) {
                        Some("silence") => edit::analyse::StripMode::Silence,
                        _ => edit::analyse::StripMode::Remove,
                    };
                    s.apply(|l| l.strip_silence(runs, mode));
                }
            }
            "repairClick" => {
                if let Some((cut, taper)) = click_cut {
                    s.apply(|l| l.repair_click(cut, taper));
                }
            }
            "undo" => { s.undo(); }
            "redo" => { s.redo(); }
            "revert" => { s.revert(); }
            _ => unknown = true,
        }
        crate::docs::edit_json(s.list(), s.can_undo(), s.can_redo())
    });

    // Where the edit actually went. A snap that silently moved the edit away
    // from the selection on screen would leave the picture disagreeing with the
    // document, so the interface is told and redraws the selection there.
    let out = if unit == edit::snap::SnapUnit::Off {
        out
    } else {
        out.set(
            "snapped",
            Value::obj().set("start", start).set("end", end).set("unit", unit.as_str()),
        )
    };

    if unknown {
        return Response::error(400, &format!("unknown edit operation: {op}"));
    }
    if let Some(clips) = copied.filter(|c| !c.is_empty()) {
        *app.clipboard.lock().unwrap() = Some((rel.to_string(), clips));
    }
    // How long the clipboard is, for this document; nothing for any other.
    let held = match app.clipboard.lock().unwrap().as_ref() {
        Some((from, clips)) if from == rel => clips.iter().map(|c| c.len).sum::<u64>(),
        _ => 0,
    };
    let out = out.set("clipboard", held);
    app.save_sessions();

    // Performance controls go straight at the audio thread — that is the whole
    // point of the engine, and it happens while sound is coming out. Structural
    // edits change the buffer the engine reads from, so they need the file
    // folding and handing over again; you do not hold a cut while listening.
    if op == "stretch" {
        if let Some(list) = app.edits.snapshot(rel) {
            let _ = crate::live::push_params(app, rel, &list);
            if let Some(was) = before {
                record_stretch_moves(app, rel, &was, &list.stretch);
            }
        }
    } else if op == "copy" {
        // Nothing changed; the engine keeps what it is playing.
    } else if let Some(path) = app.library_path().and_then(|l| resolve_within(&l, rel)) {
        let _ = crate::live::load(app, rel, &path, crate::live::Playing::Document);
    }

    Response::json(out.to_string())
}
