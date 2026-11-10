//! Stem and full export, the render job and its tests.

use super::*;

/// Render the edited result to a new file. Never writes over the source.
/// The sequencer's part of a sound export, summed into the file just written.
///
/// The sequencer is Web Audio in the page and the server never hears it, so
/// the page renders it offline for the export's length and posts it here as
/// little-endian f32, interleaved. The export is read back, the stem summed
/// in — clamped at the rails, then under the same soft ceiling every export
/// gets, since the writer applies it — and the file written again.
/// `grain=0` zeroes the export's own sound first — the GRAIN source switch
/// off — so a stem alone, or silence, is what an export of one source is.
/// With no path given it is the export that last finished.
pub(super) fn api_export_stem(app: &Arc<App>, req: &Request) -> Response {
    let Some(lib) = app.library_path() else {
        return Response::error(400, "no library chosen");
    };
    let path: PathBuf = match req.param("p") {
        Some(rel) => match resolve_within(&lib, rel) {
            Some(p) => p,
            None => return Response::error(404, "no such file in the library"),
        },
        None => {
            let last = app.export.path.lock().map(|x| x.clone()).unwrap_or_default();
            if last.is_empty() {
                return Response::error(400, "nothing has been exported");
            }
            PathBuf::from(last)
        }
    };
    let bits = req.param("bits").and_then(|b| b.parse::<u16>().ok()).unwrap_or(24);
    let grain = req.param("grain").map_or(true, |g| g != "0");
    let stem_rate = req.param("rate").and_then(|r| r.parse::<u32>().ok()).unwrap_or(0);
    let stem_channels = req.param("channels").and_then(|c| c.parse::<u16>().ok()).unwrap_or(2);
    if req.body.len() % 4 != 0 {
        return Response::error(400, "the stem is not whole samples");
    }
    let stem: Vec<f32> = req
        .body
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();
    match mix_stem_into(&path, &stem, stem_rate, stem_channels, grain, bits) {
        Ok(frames) => Response::json(Value::obj().set("frames", frames).to_string()),
        Err(e) => Response::error(500, &e.to_string()),
    }
}

/// Read an exported AIFF back, silence it if asked, sum a stem in, write it
/// again. The stem is read at its own rate against the file's, nearest
/// frame; a mono stem is put on every channel.
fn mix_stem_into(
    path: &Path,
    stem: &[f32],
    stem_rate: u32,
    stem_channels: u16,
    grain: bool,
    bits: u16,
) -> std::io::Result<u64> {
    let mut reader = audio_core::open(path)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))?;
    let info = *reader.info();
    let channels = info.channels.max(1) as usize;
    let rate = info.sample_rate;
    let frames = info.frames();
    let mut audio = reader.read_frames(0, frames)?;
    if !grain {
        for s in audio.iter_mut() {
            *s = 0.0;
        }
    }
    if !stem.is_empty() {
        let sc = stem_channels.max(1) as usize;
        let ratio = if stem_rate > 0 && stem_rate != rate { stem_rate as f64 / rate as f64 } else { 1.0 };
        let stem_frames = stem.len() / sc;
        for i in 0..frames as usize {
            let sf = (i as f64 * ratio) as usize;
            if sf >= stem_frames {
                break;
            }
            for c in 0..channels {
                let s = stem[sf * sc + c.min(sc - 1)];
                let o = &mut audio[i * channels + c];
                *o = (*o + s).clamp(-1.0, 1.0);
            }
        }
    }
    let meta = audio_core::aiff::Meta {
        annotation: Some(if grain {
            "with the sequencer".to_string()
        } else {
            "the sequencer alone".to_string()
        }),
        ..Default::default()
    };
    let mut rack = crate::rack::RackSpec::empty().build(rate, channels);
    let file = std::fs::File::create(path)?;
    let mut out = std::io::BufWriter::new(file);
    edit::render::write_aiff_controlled(
        audio, channels as u16, rate, &mut rack, &mut out, bits, &meta, |_, _| {},
    )
}

pub(super) fn api_export_status(app: &Arc<App>) -> Response {
    let e = &app.export;
    let done = e.done.load(Ordering::Relaxed);
    let total = e.total.load(Ordering::Relaxed).max(1);
    Response::json(
        Value::obj()
            .set("running", e.running.load(Ordering::Relaxed))
            .set("done", done)
            .set("total", total)
            // Sent resolved as well as raw: the browser should not have to know
            // that a stretch counts its work in passes.
            .set("fraction", (done as f64 / total as f64).min(1.0))
            .set("phase", e.phase.lock().map(|x| x.clone()).unwrap_or_default())
            .set("path", e.path.lock().map(|x| x.clone()).unwrap_or_default())
            .set("error", e.error.lock().map(|x| x.clone()).unwrap_or_default())
            .set("frames", e.frames.load(Ordering::Relaxed))
            .set("serial", e.serial.load(Ordering::Relaxed))
            .set("cancelled", e.cancelled())
            .set("sampleRate", e.rate.load(Ordering::Relaxed))
            // The loop the render went round, for the sequencer's part to go
            // round the same one. Null when the export is not a loop.
            .set("loop", match e.loop_frames.load(Ordering::Relaxed) {
                0 => Value::Null,
                frames => Value::obj()
                    .set("from", e.loop_from.load(Ordering::Relaxed))
                    .set("frames", frames)
                    .set("repeats", e.loop_repeats.load(Ordering::Relaxed)),
            })
            .to_string(),
    )
}

pub(super) fn api_export_stop(app: &Arc<App>) -> Response {
    app.export.cancel.store(true, Ordering::Relaxed);
    app.export.say("stopping");
    Response::json(Value::obj().set("ok", true).to_string())
}

pub(super) fn api_export(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(rel) = v.get("p").and_then(|p| p.as_str()) else {
        return Response::error(400, "no path given");
    };
    let bits = match v.get("bits") {
        Some(Value::Num(n)) => *n as u16,
        _ => 24,
    };
    // The loop, in **source** frames — which is what the selection already is.
    // Mapping it through the stretch happens below, where the ratio is known;
    // the browser holds engine frames, at the device rate, which is a different
    // number. All optional: absent is the whole-file export, unchanged.
    let num = |k: &str| match v.get(k) {
        Some(Value::Num(n)) => Some(*n),
        _ => None,
    };
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
    // A file with nothing done to it is still worth exporting — it is how a
    // sound is converted, and how the settings on screen are written down. The
    // old guard refused, which was fine while opening a sound restored its
    // last session and never fine after that.
    let list = match app.edits.snapshot(rel) {
        Some(l) => l,
        None => match identity_for(app, rel) {
            Some(l) => l,
            None => return Response::error(404, "no such file in the library"),
        },
    };
    if list.frames() == 0 {
        return Response::error(400, "the edit is empty — nothing to export");
    }

    let automation = app
        .automation
        .get_for(rel, list.frames(), list.channels, list.sample_rate);

    let plan = loop_plan(&list, loop_from, loop_to, repeats, want_tail);

    // Beside the original, named for the engine and the three settings that
    // decide what you hear. Everything else goes *inside* the file.
    let mut target = crate::docs::export_target_looped(
        &lib,
        rel,
        &list.stretch,
        plan.as_ref().map(|p| (p.repeats, p.tail)),
    );
    // Into a folder of its own beside the document, when one is named — the
    // Compose export puts the sound and the film of a composition together.
    if let Some(folder) = v
        .get("folder")
        .and_then(|f| f.as_str())
        .map(crate::docs::safe_name)
        .filter(|f| !f.is_empty())
    {
        if let (Some(parent), Some(name)) = (target.parent().map(Path::to_path_buf), target.file_name().map(|n| n.to_os_string())) {
            target = crate::docs::unique(parent.join(folder).join(name));
        }
    }
    if let Some(parent) = target.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return Response::error(500, &e.to_string());
        }
    }

    // What the bar is measured against, decided before anything starts.
    //
    // Reading the base, the stretch's own passes, and one pass to write. The
    // three cost wildly different amounts per frame — the stretch dominates a
    // big export by a distance — so this is a proportion, not a prediction of
    // time. It is honest about *what it is doing* at every moment, which is
    // what the phase name is for.
    // Counted to match exactly what the renderer steps, phase by phase. Getting
    // this wrong is not cosmetic: the first cut counted a reading pass that the
    // unstretched path does not make, and the bar stopped at 50% on a finished
    // export.
    let stretched = list.is_stretched();
    let total_work = export_total_work(&list, plan.as_ref());

    let plan_looped = plan.is_some();
    if app.export.running.swap(true, Ordering::SeqCst) {
        return Response::error(400, "an export is already running");
    }
    app.export.begin(total_work);
    app.export.set_loop(list.sample_rate, loop_report(&list, plan.as_ref()));

    // Off the request thread. The server is a thread per connection
    // (`serve.rs:37`) with no lock held across a render, so the status route
    // stays answerable the whole time — which is the point.
    let app2 = Arc::clone(app);
    let rel2 = rel.to_string();
    let src2 = src.clone();
    let target2 = target.clone();
    std::thread::spawn(move || {
        let app = &app2;
        let rel = rel2.as_str();
        let outcome = run_export(
            app, rel, &src2, &target2, &list, &automation, plan.as_ref(), bits,
        );
        match outcome {
            Ok(frames) if !app.export.cancelled() => {
                app.export.frames.store(frames, Ordering::Relaxed);
                if let Ok(mut x) = app.export.path.lock() {
                    *x = target2.to_string_lossy().to_string();
                }
                app.export.say("done");
            }
            Ok(_) => {
                // Cancelled: the part-written file is not an export and would
                // only be found later and wondered about.
                let _ = std::fs::remove_file(&target2);
                app.export.say("cancelled");
            }
            // A cancel arrives as an error, because that is how a render stops
            // partway — `Interrupted` from the block loops, or a short buffer
            // from a stretch that broke out of its chunk loop. Neither is a
            // failure and neither should be reported as one.
            Err(e) if app.export.cancelled() || e.kind() == std::io::ErrorKind::Interrupted => {
                let _ = std::fs::remove_file(&target2);
                app.export.say("cancelled");
            }
            Err(e) => {
                let _ = std::fs::remove_file(&target2);
                if let Ok(mut x) = app.export.error.lock() {
                    *x = e.to_string();
                }
                app.export.say("failed");
            }
        }
        app.export.serial.fetch_add(1, Ordering::SeqCst);
        app.export.running.store(false, Ordering::SeqCst);
    });

    Response::json(
        Value::obj()
            .set("ok", true)
            .set("started", true)
            .set("total", total_work)
            .set("path", target.to_string_lossy().to_string())
            .set("looped", plan_looped)
            .to_string(),
    )
}

/// The render itself, on its own thread, reporting as it goes.
#[allow(clippy::too_many_arguments)]
/// How wide the render should be.
///
/// **The width the sound is heard in, not the width the file was recorded in.**
/// The transport runs at the *device's* channel count — `transport.rs` says so
/// where it takes it — so a mono file is already being played through a stereo
/// chain, and everything that makes it stereo happens in that chain: the grain
/// engine's own pan, the rack's reverbs and delays, the spatialisation. Render
/// it one channel wide and every one of those is discarded: `pan_gains` returns
/// (1, 1) below two channels, so the grains do not move at all, and the room
/// goes on drawing a PAN column the file cannot hold.
///
/// **So a mono document always renders stereo.** Not "when the rack has
/// something in it" or "when the grain engine is panning": the processing can
/// always make stereo, and which of it happens to be switched on when the
/// button is pressed is not a thing the file format should depend on. A rule
/// with conditions in it is a rule that produces a mono file on Tuesday and a
/// stereo one on Wednesday from the same sound, and leaves whoever collected
/// them to work out why.
///
/// A wider document is left exactly as it is.
fn render_channels(list: &edit::EditList) -> u16 {
    list.channels.max(2)
}

/// What the export's bar is measured against, decided before anything starts.
///
/// Reading the base, the stretch's own passes, and one pass to write. The three
/// cost wildly different amounts per frame — the stretch dominates a big export
/// by a distance — so this is a proportion, not a prediction of time. It is
/// honest about *what it is doing* at every moment, which is what the phase name
/// is for.
///
/// Counted to match exactly what the renderer steps, phase by phase. Getting it
/// wrong is not cosmetic: the first cut counted a reading pass that the
/// unstretched path does not make, and the bar stopped at 50% on a finished
/// export.
///
/// **Shared with the video export**, which renders the same sound through the
/// same `run_export` before it films anything. That render used to report
/// nothing at all — the numbers went into `app.export` while the video's status
/// route read the video job, so a stretch that takes minutes sat at a hard zero
/// and read as a hang. One total, counted once, for the one render.
/// The selection, in source frames, as a loop plan in output frames — or none
/// when there is no loop.
///
/// Source frames to output frames. `list.frames()` is the document after the
/// stretch and `base_frames()` before it, so their ratio is the mapping — and it
/// is exactly the one the renderer's own output was built at, which asking
/// `Stretch::output_frames` again would only approximate.
///
/// **One mapping for the sound and the film.** The film used to round a float
/// ratio where the sound divided exactly, so the same selection could come out a
/// frame longer in one than the other — a frame a repeat, which over a few
/// hundred repeats is a sequencer part drifting off the loop it was laid on.
pub fn loop_plan(
    list: &edit::EditList,
    from: u64,
    to: u64,
    repeats: u32,
    tail: bool,
) -> Option<edit::render::LoopPlan> {
    if repeats < 1 || to <= from {
        return None;
    }
    let base = list.base_frames().max(1);
    let to_out = |f: u64| ((f as u128 * list.frames() as u128) / base as u128) as u64;
    Some(edit::render::LoopPlan { from: to_out(from), to: to_out(to), repeats, tail })
}

/// What a loop plan is reported as: where it starts, how long it is, and how
/// many times round, clamped to the document the way the renderer clamps it.
pub(super) fn loop_report(list: &edit::EditList, plan: Option<&edit::render::LoopPlan>) -> Option<(u64, u64, u32)> {
    let p = plan?;
    let end = list.frames();
    let (from, to) = (p.from.min(end), p.to.min(end));
    (to > from).then(|| (from, to - from, p.repeats.max(1)))
}

pub fn export_total_work(list: &edit::EditList, plan: Option<&edit::render::LoopPlan>) -> u64 {
    let base_frames = list.base_frames();
    let stretched = list.is_stretched();
    // Reading is only its own phase when the stretch needs the whole document
    // up front; otherwise it happens inside the block loop and is counted there.
    let reading = if stretched { base_frames } else { list.frames() };
    let stretching = list.stretch.work_frames(base_frames);
    match plan {
        Some(p) => {
            // read/stretch, then one rack pass over the tiled stream — including
            // the silence appended for the tail, which the rack really does run
            // over. The final quantise-and-write pass is not counted: it is a
            // few percent of the whole and its length is not known until the
            // tail has been measured.
            let musical = p.to.saturating_sub(p.from) * p.repeats.max(1) as u64;
            let pad = if p.tail { fx::TAIL_CAP_SECONDS * list.sample_rate as u64 } else { 0 };
            reading + stretching + musical + pad
        }
        // The unstretched whole-file path steps only its write loop.
        None if !stretched => list.frames(),
        None => reading + stretching + list.frames(),
    }
}

pub(super) fn run_export(
    app: &Arc<App>,
    rel: &str,
    src: &std::path::Path,
    target: &std::path::Path,
    list: &edit::EditList,
    automation: &crate::automation::Automation,
    plan: Option<&edit::render::LoopPlan>,
    bits: u16,
) -> std::io::Result<u64> {
    let mut reader = audio_core::open(src)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))?;
    let file = std::fs::File::create(target)?;
    let mut out = std::io::BufWriter::new(file);
    let spec = app.racks.get(rel);
    let meta = crate::docs::export_meta(rel, list, &spec, automation);
    // The document, at the width it is going to be heard in. `render` widens
    // the file's frames to match as it reads them.
    let wide = edit::EditList { channels: render_channels(list), ..list.clone() };
    let list = &wide;
    let mut rack = spec.build(list.sample_rate, list.channels as usize);

    let progress = app.export.clone();
    let phase_of = progress.clone();
    let stop_of = app.export.clone();
    let watch = edit::render::Watch {
        phase: &move |name: &'static str| phase_of.say(name),
        progress: &move |n: u64| {
            progress.step(n);
            !progress.cancelled()
        },
        stop: &move || stop_of.cancelled(),
    };

    // The lanes are resolved at the same document frames the playhead reports,
    // so the file is what was auditioned rather than a second interpretation
    // of it. `writes` is reused across blocks; the export is not real-time but
    // there is no reason to allocate a vector per kilo-frame either.
    let mut writes = Vec::new();
    let sample_rate = list.sample_rate;
    // Hyperprism's Pitch Time Changer, if the document has it on: varispeed and
    // its shifter between the stretch and the rack, as the audio thread runs it.
    let pitch_time = spec.pitch_time;
    // Hyperprism's Post-Roll: the effects run on silence past the end, so the
    // file holds their tails.
    let post_roll_frames = (spec.post_roll_ms() as f64 * 0.001 * list.sample_rate as f64) as usize;
    let ptc_lanes = automation.lanes.iter().any(|l| l.enabled && l.target.starts_with("ptc."));
    let control = |rack: &mut fx::Rack, frame: u64| {
        crate::automation::rack_controls(&automation, &spec, frame, sample_rate, &mut writes);
        for (slot, key, value) in writes.iter() {
            rack.set_param(*slot, key, *value);
        }
    };

    // A lane on the *stretch* cannot go through the one-pass renderer: it
    // applies the stretch whole, with one set of parameters. That path runs the
    // same streaming engine the audio thread runs, so the file follows the
    // curve for the same reason the speakers do.
    let rendered = if plan.is_none() && crate::grain_export::wanted(app, rel, automation) {
        crate::grain_export::write(app, rel, &mut reader, list, automation, &spec, &mut out, bits, &meta)
    } else if let Some(plan) = plan {
        // The loop takes precedence over the streaming-stretch path: a lane on
        // the stretch and a looped export together would need the streaming
        // engine restarted per repeat, which is a different piece of work. The
        // lane is still followed *within* the loop by the control hook.
        edit::render::render_loop_to_aiff_watched(
            list, &mut reader, &mut rack, &mut out, bits, &meta, plan, control, Some(&watch),
        )
    } else if crate::offline::needs_streaming(automation) || pitch_time.on || post_roll_frames > 0 {
        app.export.say(edit::render::phase::READING);
        match edit::render::render(list, &mut reader, 0, list.base_frames()) {
            Ok(base) => {
                app.export.step(list.base_frames());
                app.export.say(edit::render::phase::STRETCHING);
                // Lanes on the stretch need the streaming engine; without them
                // the one-pass stretch gives the document its exact length.
                let mut audio = if crate::offline::needs_streaming(automation) {
                    crate::offline::stretch_with_automation(
                        &base,
                        list.channels as usize,
                        list.sample_rate,
                        &list.stretch,
                        automation,
                    )
                } else if list.is_stretched() {
                    list.stretch.process(&base, list.channels as usize, list.sample_rate)
                } else {
                    base
                };
                if pitch_time.on {
                    audio = engine::transport::pitch_time_offline(
                        &audio,
                        list.channels as usize,
                        list.sample_rate,
                        1024,
                        |frame| {
                            let mut pt = pitch_time;
                            if ptc_lanes {
                                crate::automation::apply_pitch_time(automation, &mut pt, frame, sample_rate);
                            }
                            pt
                        },
                    );
                }
                audio.resize(audio.len() + post_roll_frames * list.channels as usize, 0.0);
                app.export.say(edit::render::phase::WRITING);
                edit::render::write_aiff_controlled(
                    audio, list.channels, list.sample_rate, &mut rack, &mut out, bits, &meta,
                    control,
                )
            }
            Err(e) => Err(e),
        }
    } else {
        edit::render::render_to_aiff_watched(
            list, &mut reader, &mut rack, &mut out, bits, &meta, control, Some(&watch),
        )
    };
    rendered
}


#[cfg(test)]
mod loop_plan_tests {
    use super::*;

    /// The film used to round a float ratio where the sound divided exactly.
    /// At two and a half times, source frame 9001 lands on output frame 22502.5:
    /// the sound took 22502 and the film 22503 — a frame a repeat between the two.
    #[test]
    fn a_selection_maps_to_output_frames_by_exact_division() {
        let mut list = edit::EditList::identity(44_100, 2, 44_100);
        list.stretch.ratio = 2.5;
        let frames = list.frames() as u128;
        let p = loop_plan(&list, 1_000, 9_001, 3, true).expect("a loop");
        assert_eq!(p.from, (1_000u128 * frames / 44_100) as u64);
        assert_eq!(p.to, (9_001u128 * frames / 44_100) as u64);
        assert_eq!((p.repeats, p.tail), (3, true));
        assert!(loop_plan(&list, 5, 5, 3, false).is_none(), "an empty selection is not a loop");
        assert!(loop_plan(&list, 0, 10, 0, false).is_none(), "no repeats is not a loop");
    }

    #[test]
    fn a_loop_is_reported_clamped_to_the_document() {
        let list = edit::EditList::identity(1_000, 1, 48_000);
        let over = edit::render::LoopPlan { from: 900, to: 5_000, repeats: 0, tail: false };
        assert_eq!(loop_report(&list, Some(&over)), Some((900, 100, 1)));
        let past = edit::render::LoopPlan { from: 2_000, to: 5_000, repeats: 2, tail: false };
        assert_eq!(loop_report(&list, Some(&past)), None);
        assert_eq!(loop_report(&list, None), None);
    }
}

#[cfg(test)]
mod stem_tests {
    use super::*;

    fn write_test_aiff(path: &Path, audio: Vec<f32>, channels: u16, rate: u32) {
        let mut rack = crate::rack::RackSpec::empty().build(rate, channels as usize);
        let file = std::fs::File::create(path).unwrap();
        let mut out = std::io::BufWriter::new(file);
        edit::render::write_aiff_controlled(
            audio, channels, rate, &mut rack, &mut out, 24,
            &audio_core::aiff::Meta::default(), |_, _| {},
        )
        .unwrap();
    }

    fn read_back(path: &Path) -> Vec<f32> {
        let mut r = audio_core::open(path).unwrap();
        let n = r.info().frames();
        r.read_frames(0, n).unwrap()
    }

    #[test]
    fn a_stem_is_summed_in_and_the_rails_hold() {
        let dir = std::env::temp_dir().join(format!("stem-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("take.aif");
        // Four stereo frames at 0.5, then one at 0.9 to be pushed past the rail.
        write_test_aiff(&path, vec![0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.9, 0.9], 2, 48000);
        // A stereo stem: 0.25 left, -0.25 right, and 0.5 on the last frame.
        let stem = vec![0.25, -0.25, 0.25, -0.25, 0.25, -0.25, 0.25, -0.25, 0.5, 0.5];
        let n = mix_stem_into(&path, &stem, 48000, 2, true, 24).unwrap();
        assert_eq!(n, 5);
        let got = read_back(&path);
        assert!((got[0] - 0.75).abs() < 1e-3, "left did not sum: {}", got[0]);
        assert!((got[1] - 0.25).abs() < 1e-3, "right did not sum: {}", got[1]);
        // 0.9 + 0.5 clamps to the rail and then takes the same soft ceiling
        // every export gets, so it lands just under it rather than on it.
        assert!(got[8] > 0.9 && got[8] <= 1.0, "the rail did not hold: {}", got[8]);
    }

    #[test]
    fn grain_off_silences_the_export_and_a_mono_stem_goes_on_every_channel() {
        let dir = std::env::temp_dir().join(format!("stem-mono-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("take.aif");
        write_test_aiff(&path, vec![0.5; 8], 2, 48000);
        let stem = vec![0.1, 0.2, 0.3, 0.4];
        mix_stem_into(&path, &stem, 48000, 1, false, 24).unwrap();
        let got = read_back(&path);
        for f in 0..4 {
            let want = stem[f];
            assert!((got[f * 2] - want).abs() < 1e-3, "frame {f} left: {}", got[f * 2]);
            assert!((got[f * 2 + 1] - want).abs() < 1e-3, "frame {f} right: {}", got[f * 2 + 1]);
        }
    }

    #[test]
    fn a_stem_at_another_rate_is_read_against_the_file_s() {
        let dir = std::env::temp_dir().join(format!("stem-rate-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("take.aif");
        write_test_aiff(&path, vec![0.0; 8], 1, 24000);
        // A 48k stem: every other sample lands on a 24k frame.
        let stem = vec![0.1, 0.9, 0.2, 0.9, 0.3, 0.9, 0.4, 0.9];
        mix_stem_into(&path, &stem, 48000, 1, true, 24).unwrap();
        let got = read_back(&path);
        for (f, want) in [0.1f32, 0.2, 0.3, 0.4].iter().enumerate() {
            assert!((got[f] - want).abs() < 1e-3, "frame {f}: {}", got[f]);
        }
    }
}

// ------------------------------------------------------------- analytics
