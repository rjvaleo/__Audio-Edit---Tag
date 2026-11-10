//! Pad presets, recorded moves, the grain cap, the audio buffer and automation.

use super::*;

/// A pad source's presets: Hyperprism's factory set for its process, and the
/// user's own. See `padpresets.rs`.
pub(super) fn api_pad_presets(app: &Arc<App>, req: &Request) -> Response {
    let Some(kind) = req.param("kind") else { return Response::error(400, "no kind given") };
    Response::json(
        Value::obj()
            .set("factory", Value::Arr(crate::padpresets::factory(kind)))
            .set("user", Value::Arr(crate::padpresets::user(&app.data_dir, kind)))
            .to_string(),
    )
}

pub(super) fn api_pad_preset_save(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let (Some(kind), Some(name), Some(preset)) =
        (v.get("kind").and_then(Value::as_str), v.get("name").and_then(Value::as_str), v.get("preset"))
    else {
        return Response::error(400, "a preset needs a kind, a name and its settings");
    };
    let name = name.trim();
    if name.is_empty() {
        return Response::error(400, "a preset needs a name");
    }
    match crate::padpresets::save(&app.data_dir, kind, name, preset) {
        Ok(()) => Response::json(Value::obj().set("ok", true).to_string()),
        Err(e) => Response::error(500, &e.to_string()),
    }
}

pub(super) fn api_pad_preset_rename(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let (Some(kind), Some(from), Some(to)) = (
        v.get("kind").and_then(Value::as_str),
        v.get("from").and_then(Value::as_str),
        v.get("to").and_then(Value::as_str).map(str::trim).filter(|t| !t.is_empty()),
    ) else {
        return Response::error(400, "a rename needs a kind, a name and a new name");
    };
    match crate::padpresets::rename(&app.data_dir, kind, from, to) {
        Ok(()) => Response::json(Value::obj().set("ok", true).to_string()),
        Err(e) => Response::error(500, &e.to_string()),
    }
}

pub(super) fn api_pad_preset_delete(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let (Some(kind), Some(name)) = (v.get("kind").and_then(Value::as_str), v.get("name").and_then(Value::as_str)) else {
        return Response::error(400, "a delete needs a kind and a name");
    };
    match crate::padpresets::delete(&app.data_dir, kind, name) {
        Ok(()) => Response::json(Value::obj().set("ok", true).to_string()),
        Err(e) => Response::error(500, &e.to_string()),
    }
}

pub(super) fn record_stretch_moves(app: &Arc<App>, rel: &str, was: &fx::Stretch, now: &fx::Stretch) {
    if app.automation.record_mode() == crate::automation::Record::Off {
        return;
    }
    let spec = app.racks.get(rel);
    for (target, label) in crate::automation::targets(&spec) {
        if !target.starts_with("stretch.") {
            continue;
        }
        let (Some(a), Some(b)) = (
            crate::automation::stretch_field(was, &target),
            crate::automation::stretch_field(now, &target),
        ) else {
            continue;
        };
        if (a - b).abs() < 1e-9 {
            continue;
        }
        let Some(unit) = crate::automation::stretch_unit(&target, b) else {
            continue;
        };
        record_unit(app, rel, &target, &label, unit);
    }
}

/// Write one control's move into its lane, if recording is armed and running.
///
/// The lane value is found by searching `forward`, never by an inverse written
/// out here — see `automation::unit_for`. That is what keeps a recorded take
/// landing on the same number the same lane plays back.
pub(super) fn record_move(
    app: &Arc<App>,
    rel: &str,
    target: &str,
    label: &str,
    forward: impl Fn(f32) -> Option<f32>,
    value: f32,
) {
    let Some(unit) = crate::automation::unit_for(forward, value) else {
        return;
    };
    record_unit(app, rel, target, label, unit);
}

/// Write one lane value into its lane, if recording is armed and running.
///
/// The document's own controls arrive here with the unit already known — their
/// table holds the exact inverse — and the rack's arrive through `record_move`,
/// which searches for it.
pub(super) fn record_unit(app: &Arc<App>, rel: &str, target: &str, label: &str, unit: f32) {
    use crate::automation::Record;
    let mode = app.automation.record_mode();
    if mode == Record::Off {
        return;
    }
    // Armed but stopped is not recording. A slider moved with the transport
    // parked would otherwise stamp a point wherever the playhead was left.
    if !crate::live::with(app, |h| h.shared.is_playing()).unwrap_or(false) {
        return;
    }
    let Some(frame) = crate::automation::playhead(app) else {
        return;
    };
    let rate = app
        .playing
        .read()
        .ok()
        .and_then(|g| g.clone())
        .map_or(48_000, |n| n.doc_rate);
    app.automation.record_point(rel, target, label, unit, frame, rate);
    if mode == Record::Latch {
        app.automation.hold(target, unit);
    }
    let _ = app.automation.save(&app.automation_path());
}

/// Read or set how many grains may be sent for a picture.
///
/// Not a quality setting so much as a spending one: the schedule is refetched
/// while a control is being dragged, so this is how much work each of those
/// costs. Nothing on screen draws more than a couple of thousand marks, but a
/// denser sample makes a thinned cloud look less obviously sampled, and the
/// right number depends on the machine.
pub(super) fn api_grain_cap(app: &Arc<App>, req: &Request) -> Response {
    if req.method == "POST" {
        let v = json::parse(&String::from_utf8_lossy(&req.body)).unwrap_or(Value::Null);
        let Some(n) = v.get("cap").and_then(|n| match n {
            Value::Num(x) if x.is_finite() && *x >= 500.0 => Some(*x as usize),
            _ => None,
        }) else {
            return Response::error(400, "cap must be a number, at least 500");
        };
        if let Err(e) = app.set_grain_cap(n) {
            return Response::error(500, &e.to_string());
        }
    }
    Response::json(
        Value::obj()
            .set("cap", *app.grain_cap.read().unwrap() as f64)
            .to_string(),
    )
}

/// Read or set how many frames the device is asked for per callback.
///
/// The one cure for a callback that cannot finish in time. Sixteen grain layers
/// under a hybrid stretch is a great deal of arithmetic for one block, and a
/// device default of 512 frames at 48 kHz is about ten milliseconds to do it
/// in; doubling the block doubles the time and doubles the latency, which is
/// the trade and why it is a control rather than a constant.
///
/// Setting it closes the device and opens it again, because a stream's block
/// length is fixed when it is built. Whatever was loaded is reloaded.
pub(super) fn api_audio_buffer(app: &Arc<App>, req: &Request) -> Response {
    if req.method == "POST" {
        let v = json::parse(&String::from_utf8_lossy(&req.body)).unwrap_or(Value::Null);
        let frames = match v.get("frames") {
            // Null, absent, or zero all mean "whatever the device offers".
            None | Some(Value::Null) => None,
            Some(Value::Num(n)) if n.is_finite() && *n >= 32.0 => Some(*n as u32),
            Some(Value::Num(n)) if *n == 0.0 => None,
            _ => return Response::error(400, "frames must be a block size, or null for the device's own"),
        };
        if let Err(e) = crate::live::restart(app, frames) {
            return Response::error(500, &e);
        }
    }
    let asked = *app.buffer_frames.read().unwrap();
    let mut out = Value::obj();
    out = match asked {
        Some(n) => out.set("frames", n as f64),
        None => out.set("frames", Value::Null),
    };
    // What the device is actually running at, which is not always what was
    // asked: a backend may refuse a size and pick its own, and a control that
    // reported the request rather than the result would be lying.
    let running = crate::live::with(app, |h| (h.buffer_frames, h.sample_rate)).ok();
    if let Some((got, rate)) = running {
        out = out.set("sampleRate", rate as f64);
        out = match got {
            Some(n) => out.set("running", n as f64),
            None => out.set("running", Value::Null),
        };
    }
    Response::json(out.to_string())
}

/// Arm or disarm recording, and say what it is set to.
pub(super) fn api_automation_record(app: &Arc<App>, req: &Request) -> Response {
    if req.method == "POST" {
        let v = json::parse(&String::from_utf8_lossy(&req.body)).unwrap_or(Value::Null);
        let Some(mode) = v
            .get("mode")
            .and_then(Value::as_str)
            .and_then(crate::automation::Record::from_str)
        else {
            return Response::error(400, "mode must be off, touch or latch");
        };
        app.automation.set_record_mode(mode);
        if mode == crate::automation::Record::Off {
            crate::grain_notes::end_take(app);
        }
    }
    Response::json(
        Value::obj()
            .set("mode", app.automation.record_mode().as_str())
            .to_string(),
    )
}

/// What the Prism pad can drive on this file, each with its controls and its
/// pair: the one saved with the rack, or the default from Hyperprism's table.
pub(super) fn api_pad(app: &Arc<App>, req: &Request) -> Response {
    let Some(rel) = req.param("p") else {
        return Response::error(400, "no path given");
    };
    let spec = app.racks.get(rel);
    let sources: Vec<Value> = crate::pad::sources(&spec)
        .iter()
        .map(|s| s.to_json(spec.pads.get(&s.id)))
        .collect();
    Response::json(Value::obj().set("sources", Value::Arr(sources)).to_string())
}

/// A take on the pad as one list of `[frame, x, y]`, the two lanes' values at
/// every frame either has a point — so the pad draws the path without
/// working out a curve itself.
pub(super) fn api_automation_path(app: &Arc<App>, req: &Request) -> Response {
    let (Some(rel), Some(x), Some(y)) = (req.param("p"), req.param("x"), req.param("y")) else {
        return Response::error(400, "give p, x and y");
    };
    let points: Vec<Value> = crate::automation::path(&app.automation.get(rel), x, y)
        .into_iter()
        .map(|(f, a, b)| Value::Arr(vec![Value::Num(f as f64), Value::Num(a as f64), Value::Num(b as f64)]))
        .collect();
    Response::json(Value::obj().set("points", Value::Arr(points)).to_string())
}

/// LOOP on the pad: both of its lanes wrap over the take's span, together.
pub(super) fn api_automation_loop(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let (Some(rel), Some(x), Some(y)) = (
        v.get("p").and_then(Value::as_str),
        v.get("x").and_then(Value::as_str),
        v.get("y").and_then(Value::as_str),
    ) else {
        return Response::error(400, "give p, x and y");
    };
    let on = !matches!(v.get("on"), Some(Value::Bool(false)));
    let mut automation = app.automation.get(rel);
    if !crate::automation::loop_path(&mut automation, x, y, on) {
        return Response::error(400, "both controls need a lane with points to loop");
    }
    app.automation.set(rel, automation.clone());
    if let Err(e) = app.automation.save(&app.automation_path()) {
        return Response::error(500, &e.to_string());
    }
    Response::json(automation.to_json().to_string())
}

pub(super) fn api_automation_get(app: &Arc<App>, req: &Request) -> Response {
    let Some(rel) = req.param("p") else {
        return Response::error(400, "no path given");
    };
    let spec = app.racks.get(rel);
    let targets: Vec<Value> = crate::automation::targets(&spec)
        .into_iter()
        .map(|(key, label)| Value::Arr(vec![Value::Str(key), Value::Str(label)]))
        .collect();

    // Refused rather than returned if the file underneath has changed length:
    // the points are frame offsets into audio that is no longer there.
    let stored = app.automation.get(rel);
    let (automation, stale) = match identity_for(app, rel) {
        Some(id) if !stored.matches(id.frames(), id.channels, id.sample_rate) => {
            (crate::automation::Automation::default(), true)
        }
        _ => (stored, false),
    };

    Response::json(
        automation
            .to_json()
            .set("targets", Value::Arr(targets))
            .set("stale", stale)
            .to_string(),
    )
}

pub(super) fn api_automation_set(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(rel) = v.get("p").and_then(|p| p.as_str()) else {
        return Response::error(400, "no path given");
    };
    let mut automation = crate::automation::Automation::from_json(&v);
    // The interface edits lanes and knows nothing of a take's notes.
    if v.get("notes").is_none() {
        automation.notes = app.automation.get(rel).notes;
    }
    // Stamped here, not by the browser: what the lanes were drawn against is a
    // fact about the file on disk, and the one place that knows it is here.
    if let Some(id) = identity_for(app, rel) {
        automation.frames = id.frames();
        automation.channels = id.channels;
        automation.sample_rate = id.sample_rate;
    }
    app.automation.set(rel, automation.clone());
    if let Err(e) = app.automation.save(&app.automation_path()) {
        return Response::error(500, &e.to_string());
    }
    Response::json(automation.to_json().to_string())
}
