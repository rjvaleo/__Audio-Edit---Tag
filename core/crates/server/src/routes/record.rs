//! Recording, capture and saving a chop.

use super::*;

/// What the input is doing: the devices, what is armed, and the level.
///
/// Polled while the record panel is open, so it has to be cheap. Listing the
/// devices is the expensive part and is only done when nothing is armed — once
/// a device is open, the list cannot change without the stream noticing.
pub(super) fn api_record_state(app: &Arc<App>) -> Response {
    let held = app.recorder.lock().ok();
    let armed = held.as_ref().and_then(|g| g.as_ref());
    let mut out = Value::obj().set("armed", armed.is_some());

    match armed {
        Some(r) => {
            let l = r.input.level();
            out = out
                .set("device", r.device.clone())
                .set("recording", r.input.is_recording())
                .set("channels", r.input.channels() as f64)
                .set("sampleRate", r.input.sample_rate())
                .set("frames", l.frames as f64)
                .set("seconds", l.frames as f64 / r.input.sample_rate().max(1) as f64)
                .set("maxSeconds", engine::input::MAX_SECONDS as f64)
                .set("left", l.left as f64)
                .set("right", l.right as f64)
                // Above zero means the take has a hole in it. Reported rather
                // than smoothed over: a recording that quietly lost a block is
                // found out later, when the take cannot be done again.
                .set("overruns", l.overruns as f64);
        }
        None => {
            out = out.set(
                "devices",
                Value::Arr(
                    engine::input::devices()
                        .into_iter()
                        .map(Value::Str)
                        .collect(),
                ),
            );
        }
    }
    Response::json(out.to_string())
}

/// Arm, start, stop or disarm the input.
///
/// Arming opens the device and starts metering but keeps nothing — that is what
/// lets you set a level before committing. Starting reserves nothing new, so
/// the first sample of a take is the first sample the device gave us after the
/// button, not after an allocation.
pub(super) fn api_record(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let action = v.get("action").and_then(Value::as_str).unwrap_or("");
    match action {
        "arm" => {
            let want = v.get("device").and_then(Value::as_str);
            let r = match engine::input::open(want) {
                Ok(r) => r,
                Err(e) => return Response::error(503, &e),
            };
            r.input.reserve(engine::input::MAX_SECONDS);
            if let Ok(mut g) = app.recorder.lock() {
                *g = Some(r);
            }
            api_record_state(app)
        }
        "disarm" => {
            // Dropping the recorder closes the stream, which is what releases
            // the device and puts out the microphone indicator.
            if let Ok(mut g) = app.recorder.lock() {
                *g = None;
            }
            api_record_state(app)
        }
        "start" => {
            let ok = app
                .recorder
                .lock()
                .ok()
                .and_then(|g| g.as_ref().map(|r| r.input.start()))
                .is_some();
            if !ok {
                return Response::error(409, "nothing is armed");
            }
            api_record_state(app)
        }
        "stop" => api_record_stop(app, &v),
        other => Response::error(400, &format!("unknown record action {other:?}")),
    }
}

/// End the take and write it.
///
/// The samples are taken out of the recorder first and the file written after,
/// so the device is free again as soon as possible and a slow disk cannot cost
/// the next take.
fn api_record_stop(app: &Arc<App>, v: &Value) -> Response {
    let taken = {
        let Ok(g) = app.recorder.lock() else {
            return Response::error(500, "the recorder is wedged");
        };
        let Some(r) = g.as_ref() else {
            return Response::error(409, "nothing is armed");
        };
        let level = r.input.level();
        (
            r.input.take(),
            r.input.channels(),
            r.input.sample_rate(),
            level.overruns,
        )
    };
    let (samples, channels, sample_rate, overruns) = taken;
    if samples.is_empty() {
        return Response::error(400, "the take is empty — nothing was recorded");
    }

    let name = v
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(crate::record::default_name);
    let lib = app.library_path();
    let (path, outside) = crate::record::target(lib.as_deref(), &app.data_dir, &name);
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return Response::error(500, &e.to_string());
        }
    }
    let frames = match crate::capture::write_wav(&path, &samples, channels, sample_rate) {
        Ok(f) => f,
        Err(e) => return Response::error(500, &e.to_string()),
    };

    Response::json(
        Value::obj()
            .set("ok", true)
            .set("path", path.to_string_lossy().to_string())
            .set(
                "rel",
                crate::record::relative(lib.as_deref(), &path).unwrap_or_default(),
            )
            .set("outside", outside)
            .set("frames", frames)
            .set("seconds", frames as f64 / sample_rate.max(1) as f64)
            .set("channels", channels as f64)
            .set("sampleRate", sample_rate)
            .set("overruns", overruns as f64)
            .to_string(),
    )
}

/// Arm or finish a capture.
///
/// `{on:true}` starts keeping the output; `{on:false}` stops and writes it
/// beside the original. The file is what came out of the speakers rather than a
/// fresh render of the document — the two can differ, and when they do the
/// recording is the one that was actually in the room.
pub(super) fn api_capture(app: &Arc<App>, req: &Request) -> Response {
    let v = json::parse(&String::from_utf8_lossy(&req.body)).unwrap_or_else(Value::obj);
    let on = matches!(v.get("on"), Some(Value::Bool(true)));

    if on {
        let started = crate::live::with(app, |h| {
            h.shared.start_capture(h.channels, h.sample_rate, crate::capture::MAX_SECONDS);
        });
        return match started {
            Ok(()) => Response::json(Value::obj().set("capturing", true).to_string()),
            Err(e) => Response::error(503, &e),
        };
    }

    let taken = match crate::live::with(app, |h| h.shared.take_capture()) {
        Ok(t) => t,
        Err(e) => return Response::error(503, &e),
    };
    let Some(cap) = taken else {
        return Response::json(Value::obj().set("capturing", false).set("frames", 0.0).to_string());
    };
    if cap.samples.is_empty() {
        return Response::json(
            Value::obj().set("capturing", false).set("frames", 0.0).to_string(),
        );
    }

    // Name it for the sound it came from and what that sound was going through.
    let rel = app.playing.read().unwrap().as_ref().map(|n| n.rel.clone()).unwrap_or_default();
    let list = app.edits.snapshot(&rel);
    let module = match &list {
        Some(l) => crate::capture::module_name(
            l,
            &crate::live::rack_for(app, &rel, l.sample_rate, l.channels as usize),
        ),
        None => "live".to_string(),
    };

    let Some(lib) = app.library_path() else {
        return Response::error(400, "no library chosen");
    };
    let (path, outside) = crate::capture::target(&lib, &app.data_dir, &rel, &module);

    match crate::capture::write_wav(&path, &cap.samples, cap.channels, cap.sample_rate) {
        Ok(frames) => {
            // The file exists now; the browser should be able to see it without
            // the user going looking for a rescan button.
            if !outside {
                reindex_for(app, &rel);
            }
            Response::json(
            Value::obj()
                .set("capturing", false)
                .set("frames", frames as f64)
                .set("seconds", frames as f64 / cap.sample_rate.max(1) as f64)
                .set("path", path.to_string_lossy().to_string())
                .set("name", path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default())
                // True when it could not be put beside the original — a
                // read-only pack, say — and went to the app's own folder.
                .set("elsewhere", outside)
                // True when the reservation ran out and the tail was dropped.
                .set("truncated", cap.full)
                .to_string(),
            )
        }
        Err(e) => Response::error(500, &e.to_string()),
    }
}

/// One slice from the Chop panel, written beside the sound it was cut from.
///
/// The panel cuts and encodes the slices in the browser, exactly as Recycle
/// Reborn did, and sends each here as a WAV. It goes into `<stem> slices/`
/// next to the source, so a chopped break lands in the library as a folder of
/// hits. Never over an existing file: chopping again with other settings adds
/// beside the last pass rather than quietly replacing it.
pub(super) fn api_chop_save(app: &Arc<App>, req: &Request) -> Response {
    let Some(lib) = app.library_path() else {
        return Response::error(400, "no library chosen");
    };
    let rel = req.param("p").unwrap_or("");
    if resolve_within(&lib, rel).map_or(true, |p| !p.is_file()) {
        return Response::error(404, "no such file in the library");
    }
    // Only a name: whatever path it carries is flattened into the folder.
    // A slice is a WAV. Beside the slices can go the MIDI file that plays them
    // in their places and the SFZ that maps them to keys; nothing else.
    let name = crate::capture::safe(req.param("name").unwrap_or(""));
    let lower = name.to_ascii_lowercase();
    let b = &req.body;
    if lower.ends_with(".wav") && name.len() > 4 {
        if b.len() < 44 || &b[0..4] != b"RIFF" || &b[8..12] != b"WAVE" {
            return Response::error(400, "a slice is a WAV file");
        }
    } else if lower.ends_with(".mid") && name.len() > 4 {
        if b.len() < 14 || &b[0..4] != b"MThd" {
            return Response::error(400, "a .mid is a MIDI file");
        }
    } else if lower.ends_with(".sfz") && name.len() > 4 {
        if b.len() > 1 << 20 || std::str::from_utf8(b).is_err() {
            return Response::error(400, "an .sfz is a text file");
        }
    } else {
        return Response::error(400, "a slice is named for a .wav, .mid or .sfz file");
    }

    let source = Path::new(rel);
    let stem = source.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "slices".into());
    let folder = source.parent().unwrap_or(Path::new("")).join(crate::capture::safe(&format!("{stem} slices")));
    let Some(dir) = resolve_for_write(&lib, &folder.to_string_lossy()) else {
        return Response::error(400, "the slices cannot go there");
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return Response::error(500, &e.to_string());
    }
    let path = crate::capture::unique(dir.join(&name));
    if let Err(e) = std::fs::write(&path, b) {
        return Response::error(500, &e.to_string());
    }
    reindex_for(app, rel);
    let written = folder.join(path.file_name().unwrap_or_default());
    Response::json(
        Value::obj()
            .set("path", written.to_string_lossy().replace('\\', "/"))
            .set("name", path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default())
            .to_string(),
    )
}
