//! Video export.

use super::*;

/// Start the analysis behind a video export.
///
/// The same body as `/api/export`, plus how the picture is to be taken: `fps`,
/// how many bands the terrain wants, and `outro` — how far the video runs past
/// the sound, **worked out by the interface** from the room's own two constants
/// rather than written down a second time here.
///
/// The audio is rendered by the very same `run_export` the audio export uses,
/// into a scratch file that is read back and deleted. Rendering it twice by two
/// routes would be two things to keep in step, and the whole point of the
/// offline path is that the picture is taken from the audio that is actually in
/// the file.
pub(super) fn api_video(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(rel) = v.get("p").and_then(|p| p.as_str()) else {
        return Response::error(400, "no path given");
    };
    let num = |k: &str| match v.get(k) {
        Some(Value::Num(n)) => Some(*n),
        _ => None,
    };
    let fps = num("fps").unwrap_or(30.0).clamp(1.0, 240.0) as u32;
    let bands = num("bands").unwrap_or(MASTER_BANDS as f64)
        .clamp(MASTER_BANDS_MIN as f64, MASTER_BANDS_MAX as f64) as usize;
    let fft = num("fft").unwrap_or(4096.0).clamp(256.0, 16_384.0) as usize;
    let liss = num("liss").unwrap_or(LISSAJOUS_POINTS as f64).clamp(16.0, 4096.0) as usize;
    let outro = num("outro").unwrap_or(0.0).clamp(0.0, 30.0) as f32;
    let loop_from = num("from").unwrap_or(0.0).max(0.0) as u64;
    let loop_to = num("to").unwrap_or(0.0).max(0.0) as u64;
    let repeats = num("repeats").unwrap_or(0.0).max(0.0) as u32;
    let want_tail = matches!(v.get("tail"), Some(Value::Bool(true)));

    let Some(lib) = app.library_path() else {
        return Response::error(400, "no library chosen");
    };
    let Some(src) = resolve_within(&lib, rel) else {
        return Response::error(404, "no such file in the library");
    };
    // The same document the audio export renders, found the same way.
    let list = match app.edits.snapshot(rel) {
        Some(l) => l,
        None => match identity_for(app, rel) {
            Some(l) => l,
            None => return Response::error(404, "no such file in the library"),
        },
    };
    if list.frames() == 0 {
        return Response::error(400, "the edit is empty — nothing to film");
    }
    let automation = app
        .automation
        .get_for(rel, list.frames(), list.channels, list.sample_rate);
    let plan = loop_plan(&list, loop_from, loop_to, repeats, want_tail);

    let job = crate::video::job();
    if job.running.swap(true, Ordering::SeqCst) {
        return Response::error(400, "a video analysis is already running");
    }
    job.begin(1);
    if let Some((from, frames, repeats)) = loop_report(&list, plan.as_ref()) {
        job.loop_from.store(from, Ordering::Relaxed);
        job.loop_frames.store(frames, Ordering::Relaxed);
        job.loop_repeats.store(repeats as u64, Ordering::Relaxed);
    }

    // The render ahead is the same one an audio export makes, and it reports
    // itself through `app.export`. Started here so that it has a total to count
    // against: without this the video's first phase — which on a long stretch is
    // most of the wait — sat at a hard zero and read as a hang.
    app.export.begin(export_total_work(&list, plan.as_ref()));

    let app2 = Arc::clone(app);
    let rel2 = rel.to_string();
    let scratch = app.data_dir.join("video-render.wav");
    std::thread::spawn(move || {
        let job = crate::video::job();
        let out = (|| -> std::io::Result<()> {
            job.say("rendering");
            run_export(
                &app2, &rel2, &src, &scratch, &list, &automation, plan.as_ref(), 32,
            )?;
            if job.cancelled() {
                return Err(std::io::Error::new(std::io::ErrorKind::Interrupted, "cancelled"));
            }
            job.say("reading");
            let mut reader = audio_core::open(&scratch).map_err(|e| {
                std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string())
            })?;
            let info = *reader.info();
            let audio = reader.read_frames(0, info.frames())?;
            job.say("analysing");
            job.total.store(
                ((info.frames() as f64 / info.sample_rate as f64 + outro as f64)
                    * fps as f64).ceil() as u64,
                Ordering::Relaxed,
            );
            let reel = crate::video::analyse(
                &audio,
                info.channels,
                info.sample_rate,
                fps,
                fft,
                bands,
                MASTER_LO_HZ,
                MASTER_HI_HZ,
                liss,
                outro,
                &|k| {
                    job.done.store(k, Ordering::Relaxed);
                    !job.cancelled()
                },
            );
            let _ = std::fs::remove_file(&scratch);
            match reel {
                Some(r) => {
                    if let Ok(mut x) = job.reel.lock() {
                        *x = Some(r);
                    }
                    job.say("ready");
                    Ok(())
                }
                None => Err(std::io::Error::new(std::io::ErrorKind::Interrupted, "cancelled")),
            }
        })();
        if let Err(e) = out {
            let _ = std::fs::remove_file(&scratch);
            if e.kind() == std::io::ErrorKind::Interrupted || job.cancelled() {
                job.say("cancelled");
            } else {
                if let Ok(mut x) = job.error.lock() {
                    *x = e.to_string();
                }
                job.say("failed");
            }
        }
        job.serial.fetch_add(1, Ordering::SeqCst);
        job.running.store(false, Ordering::SeqCst);
    });

    Response::json(Value::obj().set("ok", true).set("started", true).to_string())
}

pub(super) fn api_video_status(app: &Arc<App>) -> Response {
    let job = crate::video::job();
    let phase = job.phase.lock().map(|x| x.clone()).unwrap_or_default();
    // **While the sound is being rendered, the progress worth reporting is the
    // render's own.** It goes into `app.export`, because it is the same render
    // an audio export makes through the same code — so this route reads it from
    // there rather than the video job, which has nothing to say until the
    // analysis starts. Reported as its own phase either way, so the interface
    // can still name what is happening.
    let rendering = phase == "rendering";
    let done = if rendering {
        app.export.done.load(Ordering::Relaxed)
    } else {
        job.done.load(Ordering::Relaxed)
    };
    let total = if rendering {
        app.export.total.load(Ordering::Relaxed).max(1)
    } else {
        job.total.load(Ordering::Relaxed).max(1)
    };
    let mut v = Value::obj()
        .set("running", job.running.load(Ordering::Relaxed))
        .set("done", done as f64)
        .set("total", total as f64)
        .set("fraction", (done as f64 / total as f64).min(1.0))
        .set("phase", phase.clone())
        // What the render is doing inside itself — reading, stretching,
        // writing. The three cost wildly different amounts per frame, so a bar
        // that only said "rendering" would move in lurches with no account of
        // why. Empty except during that phase.
        .set("stage", if rendering {
            app.export.phase.lock().map(|x| x.clone()).unwrap_or_default()
        } else {
            String::new()
        })
        .set("error", job.error.lock().map(|x| x.clone()).unwrap_or_default())
        .set("serial", job.serial.load(Ordering::Relaxed) as f64);
    // The loop the film's sound went round, as the export reports its own.
    let loop_frames = job.loop_frames.load(Ordering::Relaxed);
    if loop_frames > 0 {
        v = v.set(
            "loop",
            Value::obj()
                .set("from", job.loop_from.load(Ordering::Relaxed) as f64)
                .set("frames", loop_frames as f64)
                .set("repeats", job.loop_repeats.load(Ordering::Relaxed) as f64),
        );
    }
    if let Ok(g) = job.reel.lock() {
        if let Some(r) = g.as_ref() {
            v = v
                .set("frames", r.frames() as f64)
                .set("fps", r.fps as f64)
                .set("bands", r.bands as f64)
                .set("liss", r.liss as f64)
                .set("rate", r.rate as f64)
                .set("channels", r.channels as f64)
                .set("audioFrames", (r.audio.len() / r.channels.max(1) as usize) as f64);
        }
    }
    Response::json(v.to_string())
}

pub(super) fn api_video_stop() -> Response {
    crate::video::job().cancel.store(true, Ordering::Relaxed);
    crate::video::job().say("stopping");
    Response::json(Value::obj().set("ok", true).to_string())
}

/// A run of analysed frames, as raw little-endian `f32`.
///
/// Binary because it is not small: a three-minute file at sixty a second with a
/// full terrain and a thousand-point figure is tens of millions of numbers, and
/// as JSON that is hundreds of megabytes of decimal digits to print and parse.
/// The browser wants a `Float32Array` at the other end either way.
pub(super) fn api_video_frames(req: &Request) -> Response {
    let job = crate::video::job();
    let Ok(g) = job.reel.lock() else {
        return Response::error(500, "the reel is not readable");
    };
    let Some(r) = g.as_ref() else {
        return Response::error(400, "no reel — analyse first");
    };
    let per = r.frame_floats();
    let i = req.param("i").and_then(|v| v.parse::<usize>().ok()).unwrap_or(0);
    let n = req.param("n").and_then(|v| v.parse::<usize>().ok()).unwrap_or(60);
    let total = r.frames();
    if i >= total {
        return Response::ok("application/octet-stream", Vec::new());
    }
    let take = n.min(total - i);
    let slice = &r.data[i * per..(i + take) * per];
    let mut bytes = Vec::with_capacity(slice.len() * 4);
    for v in slice {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    Response::ok("application/octet-stream", bytes)
}

/// The rendered audio, interleaved little-endian `f32`, outro included.
///
/// Not a WAV: what asks for this is a browser audio encoder, which wants plain
/// samples and would only have to unwrap a header again.
pub(super) fn api_video_audio() -> Response {
    let job = crate::video::job();
    let Ok(g) = job.reel.lock() else {
        return Response::error(500, "the reel is not readable");
    };
    let Some(r) = g.as_ref() else {
        return Response::error(400, "no reel — analyse first");
    };
    let mut bytes = Vec::with_capacity(r.audio.len() * 4);
    for v in &r.audio {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    Response::ok("application/octet-stream", bytes)
}
