//! Scales, the FX catalogue, the rack and its parameters, and pitch-time.

use super::*;

/// What shapers exist and what each one has.
///
/// Served rather than written into the interface twice. Every module the rack
/// draws is built from this, so an effect gains a control by declaring one in
/// `fx::shape` and nothing else needs touching — which is the same reason the
/// rack has one slot variant for all of them rather than nine.
///
/// Automation has its own list (`/api/automation` serves `targets`), because
/// what a lane may address depends on what is actually *in* the rack, not on
/// what could be.
/// The tuning library, grouped for a menu.
///
/// Served rather than written into the interface a second time, for the same
/// reason the shaper catalogue is: one list, one set of cent values, and a
/// scale added in `fx::tuning` needs no work here or in the browser.
pub(super) fn api_scales() -> Response {
    use std::collections::BTreeMap;
    // Grouped in the order the table declares them — the categories run from
    // the familiar to the far away, and sorting them alphabetically would
    // shuffle that into nonsense.
    let mut order: Vec<&str> = Vec::new();
    let mut by: BTreeMap<&str, Vec<Value>> = BTreeMap::new();
    for s in fx::tuning::SCALES {
        if !order.contains(&s.cat) {
            order.push(s.cat);
        }
        by.entry(s.cat).or_default().push(
            Value::obj()
                .set("name", s.name)
                .set("info", s.info)
                .set("degrees", s.cents.len() as f64)
                .set("span", s.span() as f64)
                .set(
                    "cents",
                    Value::Arr(s.cents.iter().map(|c| Value::Num(*c as f64)).collect()),
                ),
        );
    }
    let groups: Vec<Value> = order
        .into_iter()
        .map(|cat| {
            Value::obj()
                .set("category", cat)
                .set("scales", Value::Arr(by.remove(cat).unwrap_or_default()))
        })
        .collect();
    Response::json(Value::obj().set("groups", Value::Arr(groups)).to_string())
}

pub(super) fn api_fx_catalogue() -> Response {
    let kinds: Vec<Value> = fx::shape::ShapeKind::ALL
        .into_iter()
        .map(|k| {
            let params: Vec<Value> = k
                .specs()
                .iter()
                .map(|s| {
                    Value::obj()
                        .set("key", s.key)
                        .set("label", s.label)
                        .set("min", s.min as f64)
                        .set("max", s.max as f64)
                        .set("default", s.default as f64)
                        .set("log", s.log)
                        .set("unit", s.unit)
                })
                .collect();
            Value::obj()
                .set("kind", k.as_str())
                .set("label", k.label())
                .set("params", Value::Arr(params))
        })
        .chain(fx::prism::catalogue().iter().map(|e| prism_entry(e.descriptor)))
        .collect();
    Response::json(Value::obj().set("shapers", Value::Arr(kinds)).to_string())
}

/// A prism effect, shaped like a shaper so the interface draws it the same
/// way, plus what only prism effects carry: the choices a control steps
/// through, and the panel — the original's groups, the controls shown first,
/// and the Prism pad's default pair.
fn prism_entry(d: &'static fx::prism::prism_fx::Descriptor) -> Value {
    use fx::prism::prism_fx::{Category, Display, ParamKind};
    let strs = |xs: &[&str]| Value::Arr(xs.iter().map(|x| Value::from(*x)).collect());
    let params: Vec<Value> = d
        .params
        .iter()
        .map(|p| {
            let v = Value::obj()
                .set("key", p.key)
                .set("label", p.label)
                .set("min", p.min as f64)
                .set("max", p.max as f64)
                .set("default", p.default as f64)
                .set("log", p.log)
                .set("unit", p.unit);
            // A control that only means something in one setting of another.
            let v = match p.when {
                Some((key, value)) => v.set("when", Value::obj().set("key", key).set("value", value as f64)),
                None => v,
            };
            match p.kind {
                ParamKind::Continuous => v,
                ParamKind::Int => v.set("step", 1.0),
                ParamKind::Toggle => v.set("toggle", true),
                ParamKind::Choice(labels) => v.set("step", 1.0).set("choices", strs(labels)),
            }
        })
        .collect();
    let groups: Vec<Value> = d
        .panel
        .groups
        .iter()
        .map(|g| Value::obj().set("label", g.label).set("keys", strs(g.keys)))
        .collect();
    let displays: Vec<&str> = d
        .panel
        .displays
        .iter()
        .map(|x| match x {
            Display::Meter => "meter",
            Display::Curve => "curve",
            Display::Scope => "scope",
            Display::Spectrum => "spectrum",
            Display::Diagram => "diagram",
        })
        .collect();
    let mut panel = Value::obj()
        .set("groups", Value::Arr(groups))
        .set("primary", strs(d.panel.primary))
        .set("displays", strs(&displays));
    if let Some(pad) = d.panel.pad {
        panel = panel.set(
            "pad",
            Value::obj()
                .set("x", pad.x)
                .set("xMin", pad.x_range.0 as f64)
                .set("xMax", pad.x_range.1 as f64)
                .set("y", pad.y)
                .set("yMin", pad.y_range.0 as f64)
                .set("yMax", pad.y_range.1 as f64),
        );
    }
    let category = match d.category {
        Category::Delay => "delay",
        Category::Reverb => "reverb",
        Category::Modulation => "modulation",
        Category::Stereo => "stereo",
        Category::Filter => "filter",
        Category::Spectral => "spectral",
        Category::Pitch => "pitch",
        Category::Distortion => "distortion",
        Category::Dynamics => "dynamics",
        Category::Granular => "granular",
        Category::Utility => "utility",
    };
    let entry = match d.sound {
        Some(input) => Value::obj().set("sound", Value::obj().set("key", input.key).set("label", input.label)),
        None => Value::obj(),
    };
    entry
        .set("kind", fx::prism::kind(d.id).unwrap_or_default())
        .set("label", d.label)
        .set("category", category)
        .set("source", d.source)
        .set("params", Value::Arr(params))
        .set("panel", panel)
}

/// A document's automation, and the menu of what it may address.
///
/// The targets are served with the lanes rather than assembled in the browser,
/// so the list the menu offers and the list playback can resolve are the same
/// list. They came apart on the branch this was ported from and a lane could
/// name a control that silently did nothing.
/// Move one control on one slot, live.
///
/// This is what a hand on a slider sends, and it deliberately does **not**
/// rebuild the rack. Posting the whole spec — which is what the interface used
/// to do, thirty times a second while dragging — builds every effect in the
/// chain again from nothing: delay lines cleared, filters restarted, reverb
/// tails cut off. That is why the effects did not feel connected to the sound.
///
/// The stored spec is still updated, so the waveform, the peaks and the export
/// all agree with what is being heard. Only the *rebuild* is skipped.
pub(super) fn api_rack_param(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(rel) = v.get("p").and_then(Value::as_str) else {
        return Response::error(400, "no path given");
    };
    let Some(id) = v.get("id").and_then(Value::as_str) else {
        return Response::error(400, "no slot given");
    };
    let Some(key) = v.get("key").and_then(Value::as_str) else {
        return Response::error(400, "no control given");
    };
    let value = match v.get("value") {
        Some(Value::Num(n)) if n.is_finite() => *n as f32,
        _ => return Response::error(400, "no value given"),
    };

    let mut spec = app.racks.get(rel);

    // The master is not in `slot_ids` — it cannot be added, removed or
    // reordered, so it has no id of its own. It *is* a slot in the built rack
    // though: `rack_for` pushes the maximiser last, after every spec slot, so
    // its live index is exactly the number of them.
    //
    // Only `amount` travels this way. `Maximizer::set_param` refuses the
    // ceiling on purpose — putting the one guarantee the effect makes on a
    // curve would defeat it — and the two automatic modes change what the
    // maximiser is rather than where it sits. Those arrive with a rebuild, and
    // should.
    if id == "master" {
        if key != "amount" {
            return Response::error(400, "only amount is live on the master");
        }
        let applied = value.clamp(0.0, 1.0);
        spec.master.amount = applied;
        let at = spec.slots.len();
        app.set_rack(rel, spec);
        app.save_sessions();
        if crate::live::holding(app, rel) {
            let _ = crate::live::with(app, |h| crate::live::deck(h, rel).set_manual_param(at, key, applied));
        }
        return Response::json(
            Value::obj()
                .set("id", id.to_string())
                .set("key", key.to_string())
                .set("value", applied as f64)
                .to_string(),
        );
    }

    let Some(slot) = spec.slot_ids.iter().position(|x| x == id) else {
        return Response::error(404, "no such module in the rack");
    };
    // `live`: heard and nothing else (a Prism LFO's swing, `387-prism-lfo.js`).
    // The setting stays the hand's, so it is neither written into the spec nor
    // recorded; only clamped, by the same code, and sent to the engine.
    let live_only = matches!(v.get("live"), Some(Value::Bool(true)));
    if live_only {
        let mut probe = spec.clone();
        if !probe.set_param(slot, key, value) {
            return Response::error(400, "no such control on that module");
        }
        let applied = probe.get_param(slot, key).unwrap_or(value);
        if crate::live::holding(app, rel) {
            let _ = crate::live::with(app, |h| crate::live::deck(h, rel).set_manual_param(slot, key, applied));
        }
        return Response::json(
            Value::obj()
                .set("id", id.to_string())
                .set("key", key.to_string())
                .set("value", applied as f64)
                .set("live", true)
                .to_string(),
        );
    }
    // Written into the spec as well as sent to the engine, and clamped by the
    // same code that clamps everything else, so the two cannot drift.
    if !spec.set_param(slot, key, value) {
        return Response::error(400, "no such control on that module");
    }
    let applied = spec.get_param(slot, key).unwrap_or(value);
    // Kept for the range lookup below; `set` takes the spec by value.
    let spec2 = spec.clone();
    app.set_rack(rel, spec);

    // Only while this document is the one being heard.
    if crate::live::holding(app, rel) {
        let _ = crate::live::with(app, |h| crate::live::deck(h, rel).set_manual_param(slot, key, applied));
        record_move(app, rel, &format!("fx.{id}.{key}"), &format!("{id} — {key}"), |u| {
            spec2.slots.get(slot).and_then(|s| crate::automation::resolve(s, key, u))
        }, applied);
    }
    Response::json(
        Value::obj()
            .set("id", id.to_string())
            .set("key", key.to_string())
            .set("value", applied as f64)
            .to_string(),
    )
}

/// Record whichever of the document's own controls actually moved.
///
/// The stretch route posts the whole panel on every drag, so "what moved" has
/// to be worked out by comparing rather than read off the message. Only the
/// targets the automation menu offers are considered — the rest of the panel
/// has no lane to be written into.
/// Hyperprism's Pitch Time Changer: on or off, and any of its window's
/// settings. Kept with the document's rack, sent to the engine while the
/// document is heard, and recorded into its lanes while REC is armed — the
/// way a pad move on a slot is.
pub(super) fn api_pitch_time(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(rel) = v.get("p").and_then(Value::as_str) else {
        return Response::error(400, "no path given");
    };
    let mut spec = app.racks.get(rel);
    let was = spec.pitch_time;
    let now = crate::rack::merge_pitch_time(was, Some(&v));
    // `live`: heard and nothing else, as on `/api/rack/param` (a Prism LFO's
    // swing). Not kept, not saved, not recorded.
    if matches!(v.get("live"), Some(Value::Bool(true))) {
        if crate::live::holding(app, rel) {
            let _ = crate::live::with(app, |h| crate::live::deck(h, rel).set_pitch_time(now));
        }
        return Response::json(Value::obj().set("ok", true).set("live", true).to_string());
    }
    spec.pitch_time = now;
    app.set_rack(rel, spec);
    app.save_sessions();
    if crate::live::holding(app, rel) {
        let _ = crate::live::with(app, |h| crate::live::deck(h, rel).set_pitch_time(now));
        for (field, a, b) in [
            ("speed", was.speed, now.speed),
            ("pitch", was.pitch, now.pitch),
            ("feedback", was.feedback, now.feedback),
            ("grain", was.grain, now.grain),
            ("xfade", was.xfade, now.xfade),
            ("smoothing", was.smoothing, now.smoothing),
        ] {
            if (a - b).abs() < 1e-9 {
                continue;
            }
            let target = format!("ptc.{field}");
            let Some(unit) = crate::automation::stretch_unit(&target, b) else { continue };
            let label = crate::automation::STRETCH_TARGETS
                .iter()
                .find(|(t, _, _)| *t == target)
                .map(|(_, l, _)| l.to_string())
                .unwrap_or_else(|| target.clone());
            record_unit(app, rel, &target, &label, unit);
        }
    }
    Response::json(crate::rack::pitch_time_to_json(&now).to_string())
}

pub(super) fn api_rack_get(app: &Arc<App>, req: &Request) -> Response {
    let Some(rel) = req.param("p") else {
        return Response::error(400, "no path given");
    };
    let spec = app.racks.get(rel);
    let sr: u32 = req.number("sr", 48000);
    let curve: Vec<Value> = spec
        .eq_curve(sr, 96)
        .into_iter()
        .map(|(f, db)| Value::Arr(vec![Value::Num(f as f64), Value::Num(db as f64)]))
        .collect();
    Response::json(spec.to_json().set("curve", Value::Arr(curve)).to_string())
}

pub(super) fn api_rack_set(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(rel) = v.get("p").and_then(|p| p.as_str()) else {
        return Response::error(400, "no path given");
    };
    let mut spec = crate::rack::RackSpec::from_json(&v);
    // A post that does not mention the Pitch Time Changer or the post-roll
    // keeps what the document has: most of the interface posts a rack for a
    // slot or a pad window and knows nothing of either.
    let had = app.racks.get(rel);
    if v.get("pitchTime").is_none() {
        spec.pitch_time = had.pitch_time;
    }
    if v.get("postRoll").is_none() {
        spec.post_roll = had
            .post_roll
            .into_iter()
            .filter(|(id, _)| id == crate::pad::STRETCH || id == crate::pad::PITCH_TIME || spec.slot_ids.contains(id))
            .collect();
    }
    app.set_rack(rel, spec.clone());
    app.save_sessions();
    // Effects are live: a freshly built rack replaces the one the audio thread
    // holds, on its next block.
    //
    // `keepLive` says the engine is already where it needs to be — a control
    // was moved through `/api/rack/param` and only the document needs catching
    // up. Rebuilding then would clear every delay line and filter in the chain
    // for no reason, which is heard as the reverb tail stopping the instant a
    // slider is released.
    if !matches!(v.get("keepLive"), Some(Value::Bool(true))) {
        // On the deck this document plays on, and only while it is the one
        // that deck holds.
        if crate::live::prism_sound(rel).is_none() || crate::live::holding(app, rel) {
            let _ = crate::live::with(app, |h| {
                crate::live::deck(h, rel)
                    .set_rack(crate::live::rack_for(app, rel, h.sample_rate, h.channels))
            });
        }
    }
    // The Pitch Time Changer is the rack's too, and it is two numbers rather
    // than a chain, so it goes over whether or not the chain was rebuilt.
    if crate::live::holding(app, rel) {
        let spec = app.racks.get(rel);
        let _ = crate::live::with(app, |h| {
            crate::live::deck(h, rel).set_pitch_time(spec.pitch_time);
            crate::live::deck(h, rel).set_post_roll_frames((spec.post_roll_ms() as f64 * 0.001 * h.sample_rate as f64) as u64);
        });
    }

    let sr: u32 = match v.get("sr") {
        Some(Value::Num(n)) => *n as u32,
        _ => 48000,
    };
    let curve: Vec<Value> = spec
        .eq_curve(sr, 96)
        .into_iter()
        .map(|(f, db)| Value::Arr(vec![Value::Num(f as f64), Value::Num(db as f64)]))
        .collect();
    Response::json(spec.to_json().set("curve", Value::Arr(curve)).to_string())
}
