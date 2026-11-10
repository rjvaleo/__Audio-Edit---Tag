//! The Prism deck.

use super::*;

/// `deck: "prism"` on a request: the Prism deck rather than the grain engine.
pub(super) fn is_prism_deck(v: &Value) -> bool {
    v.get("deck").and_then(Value::as_str) == Some("prism")
}

/// Load a sound into the Prism deck (`live::load_prism`): its own, apart from
/// whatever the grain engine is playing.
pub(super) fn api_prism_load(app: &Arc<App>, req: &Request) -> Response {
    let path = match library_file(app, req) {
        Ok(p) => p,
        Err(r) => return r,
    };
    let rel = req.param("p").unwrap_or("").to_string();
    match crate::live::load_prism(app, &rel, &path) {
        Ok(l) => Response::json(
            Value::obj()
                .set("path", rel)
                .set("frames", l.frames as f64)
                .set("sampleRate", l.sample_rate as f64)
                .to_string(),
        ),
        Err(e) => Response::error(500, &e),
    }
}

/// The Prism deck as it is: its sound, transport and loop. Never opens the
/// device.
pub(super) fn api_prism_state(app: &Arc<App>) -> Response {
    let path = app.prism_playing.read().unwrap().clone();
    let r = crate::live::peek(app, |h| {
        let d = &h.prism;
        let (lo, hi) = d.heard_loop().unwrap_or((0, 0));
        Value::obj()
            .set("path", path.clone().unwrap_or_default())
            .set("playing", d.is_playing())
            .set("position", d.position() as f64)
            .set("inFrames", d.params().map(|p| p.in_frames as f64).unwrap_or(0.0))
            .set("sampleRate", h.sample_rate as f64)
            .set("latency", d.latency_frames() as f64)
            .set("loopA", lo as f64)
            .set("loopB", hi as f64)
    });
    match r {
        Some(v) => Response::json(v.to_string()),
        None => Response::json(Value::obj().set("path", path.unwrap_or_default()).set("playing", false).to_string()),
    }
}

/// The Prism deck's stretch: the same body the grain panel posts for its own,
/// into the Prism deck only.
pub(super) fn api_prism_stretch(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let s = crate::persist::stretch_from_json(&v);
    let applied = crate::live::peek(app, |h| {
        let d = &h.prism;
        let Some(mut p) = d.params() else { return false };
        let rebank = p.algorithm != s.algorithm || p.grain.layers != s.grain.layers;
        crate::live::merge_stretch(&mut p, &s);
        d.set_params(p);
        if rebank {
            d.set_bank(engine::stretcher::LayerBank::build(
                s.algorithm,
                s.grain.layers,
                crate::live::MAX_BLOCK,
                h.channels,
                h.sample_rate,
            ));
        }
        true
    })
    .unwrap_or(false);
    Response::json(Value::obj().set("ok", true).set("applied", applied).to_string())
}
