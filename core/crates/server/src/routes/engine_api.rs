//! The engine: shed, load, state, transport, sequencer, grains, glide and pad.

use super::*;

/// Whether the engine may take layers away when it cannot keep up.
///
/// Off by default — see `Shared::shed_layers`. This is the switch, and it is
/// the only thing that decides it: the governor reads the flag and nothing
/// else, so there is no second path that can shed while it is off.
pub(super) fn api_engine_shed(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let on = matches!(v.get("on"), Some(Value::Bool(true)));
    let applied = crate::live::with(app, |h| {
        h.shared.set_shed_layers(on);
        h.shared.sheds_layers()
    });
    Response::json(
        Value::obj()
            .set("ok", true)
            // What it actually is now, not what was asked: with no engine open
            // there is nothing to set and saying otherwise would be a lie the
            // interface then displays.
            .set("shedding", *applied.as_ref().unwrap_or(&on))
            .set("engine", applied.is_ok())
            .to_string(),
    )
}

pub(super) fn api_engine_load(app: &Arc<App>, req: &Request) -> Response {
    let path = match library_file(app, req) {
        Ok(p) => p,
        Err(r) => return r,
    };
    let rel = req.param("p").unwrap_or("").to_string();
    // The library auditions the sound; the editor plays the document. Absent
    // means the document, so nothing that predates this asks for a bare file
    // by accident.
    let how = if req.param("raw").is_some_and(|v| v == "1" || v == "true") {
        crate::live::Playing::Raw
    } else {
        crate::live::Playing::Document
    };
    match crate::live::load(app, &rel, &path, how) {
        Ok(l) => Response::json(
            Value::obj()
                .set("frames", l.frames as f64)
                .set("sampleRate", l.sample_rate as f64)
                .to_string(),
        ),
        Err(e) => Response::error(500, &e),
    }
}

pub(super) fn api_engine_state(app: &Arc<App>) -> Response {
    let loaded = app.playing.read().unwrap().clone();
    match crate::live::with(app, |h| {
        Value::obj()
            .set("playing", h.shared.is_playing())
            .set("position", h.shared.position() as f64)
            .set("sampleRate", h.sample_rate as f64)
            // Which document the engine is holding, and how much of it there is
            // at the device's rate — everything a visualiser needs to rebuild
            // the same grain schedule the audio thread is working through.
            .set("capturing", h.shared.is_capturing())
            .set("capturedFrames", h.shared.captured_frames() as f64)
            .set("path", loaded.as_ref().map(|n| n.rel.clone()).unwrap_or_default())
            .set("inFrames", loaded.as_ref().map(|n| n.frames as f64).unwrap_or(0.0))
            // The parameters the audio thread is *actually* using, not the
            // ones on the document. They are usually the same, but a visualiser
            // that reads the document is showing what was asked for rather than
            // what is being heard, and the two part company the moment a
            // slider moves.
            .set(
                "stream",
                h.shared
                    .params()
                    .map(|p| {
                        Value::obj()
                            .set("ratio", p.ratio as f64)
                            .set("semitones", p.semitones as f64)
                            .set("windowMs", p.window_ms as f64)
                            .set("inFrames", p.in_frames as f64)
                            .set("outFrames", p.plan().out_frames as f64)
                            .set("rateHz", p.grain.rate_hz as f64)
                            .set("densityHz", p.grain.density_hz as f64)
                            .set("overlap", p.grain.overlap as f64)
                            .set("sizeJitter", p.grain.size_jitter as f64)
                            .set("positionJitterMs", p.grain.position_jitter_ms as f64)
                            .set("pitchJitterSemis", p.grain.pitch_jitter_semis as f64)
                            .set("pitchDriftSemis", p.grain.pitch_drift_semis as f64)
                            .set("driftRateHz", p.grain.drift_rate_hz as f64)
                            .set("seed", p.grain.seed as f64)
                    })
                    .unwrap_or(Value::Null),
            )
            .set("channels", h.channels as f64)
            .set(
                "overflows",
                h.shared
                    .overflows
                    .load(std::sync::atomic::Ordering::Acquire) as f64,
            )
            // What a block costs against the time it takes to play. One is the
            // line: past it the engine cannot keep up and the device runs dry.
            // Measured in the callback rather than predicted from the controls,
            // because a model would need refitting whenever the DSP changed and
            // would still be guessing about this machine.
            .set("load", {
                let (now, mean, worst) = h.shared.load();
                Value::obj()
                    .set("now", now as f64)
                    .set("mean", mean as f64)
                    .set("worst", worst as f64)
                    .set(
                        "late",
                        h.shared
                            .late_blocks
                            .load(std::sync::atomic::Ordering::Relaxed) as f64,
                    )
                    .set("layerCap", h.shared.layer_cap() as f64)
                    .set("shedding", h.shared.sheds_layers())
                    .set(
                        "layersRunning",
                        h.shared
                            .layers_running
                            .load(std::sync::atomic::Ordering::Relaxed) as f64,
                    )
            })
            .set("device", true)
            .to_string()
    }) {
        Ok(s) => Response::json(s),
        // No audio device is not an error *here*.
        //
        // `live::with` calls `ensure`, which opens the device — so a machine
        // with no output made this route 503, and the interface polls it
        // constantly. Every poll failed, on a box that is otherwise perfectly
        // able to browse, edit and export. The test for this has always been
        // right and has never been able to fail: every machine it ran on had a
        // sound card, until CI.
        //
        // The other engine routes still refuse: transport and grains genuinely
        // cannot do their job without a device, and saying so is honest. This
        // one is a *status* — "what is playing" has a truthful answer when
        // nothing can play, and it is "nothing".
        Err(e) => Response::json(
            Value::obj()
                .set("playing", false)
                .set("position", 0.0)
                .set("sampleRate", 0.0)
                .set("capturing", false)
                .set("capturedFrames", 0.0)
                .set("path", loaded.as_ref().map(|n| n.rel.clone()).unwrap_or_default())
                .set("inFrames", loaded.as_ref().map(|n| n.frames as f64).unwrap_or(0.0))
                .set("stream", Value::Null)
                .set("channels", 0.0)
                .set("overflows", 0.0)
                .set("load", Value::Null)
                // So the interface can say "no audio device" rather than show a
                // transport that silently never moves.
                .set("device", false)
                .set("deviceError", e)
                .to_string(),
        ),
    }
}

pub(super) fn api_engine_transport(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let num = |k: &str| match v.get(k) {
        Some(Value::Num(n)) if n.is_finite() => Some(*n),
        _ => None,
    };

    // `deck: "prism"` drives the Prism deck's transport and faders instead
    // (`engine::decks`); the sequencer's sound is the grain deck's only.
    let prism = is_prism_deck(&v);
    let r = crate::live::with(app, |h| {
        // A new epoch for the sequencer's sound first, so a seek in the same
        // request lands on a bus that has let go of what came before it.
        if let Some(e) = num("seqEpoch") {
            h.shared.seq.advance(e.max(0.0) as u64);
        }
        struct Deck<'a> { shared: &'a std::sync::Arc<engine::Shared> }
        let h = Deck { shared: if prism { &h.prism } else { &h.shared } };
        if let Some(f) = num("seek") {
            h.shared.request_seek(f.max(0.0) as u64);
        }
        if let Some(g) = num("gain") {
            h.shared.set_gain(g as f32);
        }
        if let Some(Value::Bool(m)) = v.get("mute") {
            h.shared.set_mute(*m);
        }
        // Hyperprism's Playback Speed: varispeed before the rack, 0 to 2.
        if let Some(r) = num("speed") {
            h.shared.set_speed(r as f32);
        }
        // Hyperprism's L and R faders, as linear gains; either alone keeps the
        // other where it was.
        if num("gainL").is_some() || num("gainR").is_some() {
            let (l, r) = h.shared.side_gains();
            h.shared.set_side_gains(num("gainL").map_or(l, |g| g as f32), num("gainR").map_or(r, |g| g as f32));
        }
        match v.get("loop") {
            Some(l) => {
                let on = matches!(l.get("on"), Some(Value::Bool(true)));
                let a = match l.get("a") {
                    Some(Value::Num(n)) => *n as u64,
                    _ => 0,
                };
                let b = match l.get("b") {
                    Some(Value::Num(n)) => *n as u64,
                    _ => 0,
                };
                h.shared.set_loop(on, a, b);
            }
            None => {}
        }
        // Play last, so a seek in the same request lands before sound starts.
        match v.get("play") {
            Some(Value::Bool(true)) => {
                if !prism {
                    app.grain_keys.set_played(true);
                }
                h.shared.play()
            }
            Some(Value::Bool(false)) => {
                if !prism {
                    app.grain_keys.set_played(false);
                }
                h.shared.pause()
            }
            _ => {}
        }
        h.shared.position() as f64
    });

    match r {
        Ok(pos) => Response::json(Value::obj().set("position", pos).to_string()),
        Err(e) => Response::error(503, &e),
    }
}

/// The sequencer's sound, for the engine's output — see `engine::seqbus`.
///
/// `at` is the output frame the first of it belongs at, `epoch` the transport's
/// epoch it was stamped under, and the body little-endian floats, interleaved.
/// Never opens the device: sound for an engine that is not running has nowhere
/// to go, and a sound card opened because a page posted samples at it is the
/// side effect `docs/NO-AUDIO-DEVICE.md` is about. The page is told 503 and
/// plays the sequencer itself.
pub(super) fn api_engine_seq(app: &Arc<App>, req: &Request) -> Response {
    let at = req.number::<u64>("at", 0);
    let epoch = req.number::<u64>("epoch", 0);
    let channels = req.number::<usize>("channels", 2).clamp(1, 8);
    if req.body.len() % (4 * channels) != 0 {
        return Response::error(400, "the sound is not whole frames");
    }
    let samples: Vec<f32> = req
        .body
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();
    match crate::live::peek(app, |h| {
        let bounds = if h.shared.is_playing() { h.shared.heard_loop() } else { None };
        let kept = h.shared.seq.write(epoch, at, &samples, channels, h.shared.position(), bounds);
        Value::obj()
            .set("kept", kept as u64)
            .set("epoch", h.shared.seq.epoch())
            .set("sampleRate", h.sample_rate)
            .to_string()
    }) {
        Some(s) => Response::json(s),
        None => Response::error(503, "no engine is running"),
    }
}

/// Grains that have actually sounded since the last ask.
///
/// The swarm is fed from here rather than from a second enumeration, so it
/// cannot show something the speakers did not play.
pub(super) fn api_engine_grains(app: &Arc<App>) -> Response {
    match crate::live::with(app, |h| {
        let events = h.shared.drain_events();
        let sr = h.sample_rate.max(1) as f64;
        let arr: Vec<Value> = events
            .iter()
            .map(|e| {
                Value::obj()
                    .set("voice", e.voice as f64)
                    .set("t", e.out_frame as f64 / sr)
                    .set("src", e.src_frame as f64 / sr)
                    .set("size", e.size as f64 / sr)
                    .set("rate", e.rate as f64)
                    .set("semis", e.pitch_semis as f64)
            })
            .collect();
        let spectrum: Vec<Value> = h
            .shared
            .spectrum()
            .into_iter()
            .map(|b| Value::Num(b as f64))
            .collect();
        let mut v = Value::obj()
            // The held note's head, in output frames, and what it is adding to
            // the pitch: the Grain page draws them while the transport is stopped.
            .set(
                "keys",
                Value::obj()
                    .set("head", app.grain_keys.head() as f64)
                    .set("sounding", app.grain_keys.sounding())
                    .set("noteOns", app.grain_keys.note_ons() as f64)
                    .set("pitch", app.grain_keys.pitch() as f64),
            )
            // Poly: one per note, in the order they were started.
            .set(
                "heads",
                Value::Arr(
                    h.shared
                        .voices
                        .heads()
                        .iter()
                        .map(|k| {
                            Value::obj()
                                .set("key", k.key as f64)
                                .set("voice", k.voice as f64)
                                .set("src", k.src as f64 / sr)
                                .set("env", k.env as f64)
                        })
                        .collect(),
                ),
            )
            .set("position", h.shared.position() as f64)
            // The ratio that position is counted at. The interface turns it
            // into a place in the file with this, not with the document's
            // ratio, which runs ahead of the engine while a slider is dragged.
            .set("ratio", h.shared.params().map(|p| p.ratio as f64).unwrap_or(1.0))
            .set("sampleRate", sr)
            .set("playing", h.shared.is_playing())
            // How far ahead of the speaker the counter is. A playhead drawn
            // straight from `position` leads the sound by this much.
            .set("latency", h.shared.latency_frames() as f64)
            // The sequencer's sound on this output: whether it is coming, and how
            // much of it arrived in time. See `engine::seqbus`.
            .set(
                "seq",
                Value::obj()
                    .set("active", h.shared.seq.is_active())
                    .set("epoch", h.shared.seq.epoch())
                    .set("mixed", h.shared.seq.mixed.load(Ordering::Relaxed))
                    .set("missing", h.shared.seq.missing.load(Ordering::Relaxed))
                    .set("refused", h.shared.seq.refused.load(Ordering::Relaxed)),
            )
            .set("grains", Value::Arr(arr))
            .set("spectrum", Value::Arr(spectrum))
            .set(
                "waveform",
                Value::Arr(
                    h.shared
                        .waveform()
                        .into_iter()
                        .map(|v| Value::Num(v as f64))
                        .collect(),
                ),
            )
            // What the callback is costing, on the same poll as everything else
            // for the same reason: one instant, one answer.
            .set("load", {
                let (now, mean, worst) = h.shared.load();
                Value::obj()
                    .set("now", now as f64)
                    .set("mean", mean as f64)
                    .set("worst", worst as f64)
                    .set(
                        "late",
                        h.shared
                            .late_blocks
                            .load(std::sync::atomic::Ordering::Relaxed) as f64,
                    )
                    // What the governor has done about it. Reported because a
                    // program that quietly plays fewer layers than the control
                    // says is lying about its own settings.
                    .set("layerCap", h.shared.layer_cap() as f64)
                    .set("shedding", h.shared.sheds_layers())
                    .set(
                        "layersRunning",
                        h.shared
                            .layers_running
                            .load(std::sync::atomic::Ordering::Relaxed) as f64,
                    )
                    .set("voices", h.shared.voices.running() as f64)
                    .set("voiceCap", h.shared.voices.cap() as f64)
            })
            // Rides along with the playhead rather than on its own poll: the
            // meters and the position describe the same instant, and fetching
            // them separately lets them disagree.
            .set(
                "rackLevels",
                Value::Arr(
                    h.shared
                        .rack_levels()
                        .into_iter()
                        .map(|(l, r)| Value::Arr(vec![Value::Num(l as f64), Value::Num(r as f64)]))
                        .collect(),
                ),
            )
            .set(
                "rackTelemetry",
                Value::Arr(
                    h.shared
                        .rack_telemetry()
                        .into_iter()
                        .map(|v| Value::Num(v as f64))
                        .collect(),
                ),
            );
        // Where the callback actually wraps. Only it knows what a loop end of
        // zero resolves to, so anything drawing a playhead is told rather than
        // left to work it out and be wrong.
        if let Some((a, b)) = h.shared.heard_loop() {
            v = v.set("loop", Value::obj().set("a", a as f64).set("b", b as f64));
        }
        v.to_string()
    }) {
        Ok(s) => Response::json(s),
        Err(e) => Response::error(503, &e),
    }
}

fn json_num(v: &Value, k: &str) -> Option<f32> {
    match v.get(k) {
        Some(Value::Num(n)) if n.is_finite() => Some(*n as f32),
        _ => None,
    }
}

/// `{smoothing}`, Hyperprism's Smoothing (%), for Stretch and Pitch. Never opens
/// the device: with no engine it is simply not applied, and the pad sends it
/// again when it is next used.
pub(super) fn api_engine_glide(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(s) = json_num(&v, "smoothing") else {
        return Response::error(400, "no smoothing given");
    };
    let s = s.clamp(0.0, 100.0);
    let prism = is_prism_deck(&v);
    let applied = crate::live::peek(app, |h| if prism { h.prism.set_glide(s) } else { h.shared.set_glide(s) }).is_some();
    Response::json(Value::obj().set("ok", true).set("applied", applied).set("smoothing", s as f64).to_string())
}

/// `{ratio?, semitones?}` into what the engine plays, now, and nothing else:
/// not the document, which the pad commits when a drag or a take ends. Light
/// enough for a gesture to send sixty times a second.
pub(super) fn api_engine_pad(app: &Arc<App>, req: &Request) -> Response {
    use crate::automation::{RATIO_MAX, RATIO_MIN, SEMITONE_MAX, SEMITONE_MIN};
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let ratio = json_num(&v, "ratio").map(|r| r.clamp(RATIO_MIN, RATIO_MAX));
    let semis = json_num(&v, "semitones").map(|r| r.clamp(SEMITONE_MIN, SEMITONE_MAX));
    let prism = is_prism_deck(&v);
    let applied = crate::live::peek(app, |h| {
        let d = if prism { &h.prism } else { &h.shared };
        let Some(mut p) = d.params() else { return false };
        if let Some(r) = ratio {
            p.ratio = r;
        }
        if let Some(s) = semis {
            p.semitones = s;
        }
        d.set_params(p);
        true
    })
    .unwrap_or(false);
    Response::json(Value::obj().set("ok", true).set("applied", applied).to_string())
}
