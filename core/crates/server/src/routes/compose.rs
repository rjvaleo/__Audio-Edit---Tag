//! Markers, visual lanes, compositions, film export and annotations.

use super::*;

pub(super) fn api_markers_get(app: &Arc<App>, req: &Request) -> Response {
    let Some(key) = req.param("p") else {
        return Response::error(400, "no path given");
    };
    let store = app.markers.read().unwrap();
    Response::json(store.get(key).to_json().to_string())
}

/// The picture's automation lanes for one document.
///
/// Kept as they arrive: their shape is the page's — the grain's lane shape,
/// with `visual.` targets — and the server keeps them beside the document and
/// hands them back. See `docs/COMPOSE.md`, phase three.
pub(super) fn api_visual_lanes_get(app: &Arc<App>, req: &Request) -> Response {
    let Some(key) = req.param("p") else {
        return Response::error(400, "no path given");
    };
    let store = app.visual_lanes.read().unwrap();
    Response::json(store.get(key).to_string())
}

pub(super) fn api_visual_lanes_set(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(key) = v.get("p").and_then(|p| p.as_str()).map(str::to_string) else {
        return Response::error(400, "no path given");
    };
    let lanes = match v.get("lanes") {
        Some(Value::Arr(a)) => Value::Arr(a.clone()),
        _ => return Response::error(400, "lanes must be a list"),
    };
    {
        let mut store = app.visual_lanes.write().unwrap();
        store.set(&key, Value::obj().set("lanes", lanes));
        if let Err(e) = store.save(&app.visual_lanes_path()) {
            return Response::error(500, &e.to_string());
        }
    }
    let store = app.visual_lanes.read().unwrap();
    Response::json(store.get(&key).to_string())
}

/// Every composition, by name. See `compose.rs`.
pub(super) fn api_compositions_list(app: &Arc<App>) -> Response {
    let names = crate::compose::list(&app.compositions_path());
    Response::json(
        Value::obj()
            .set("names", Value::Arr(names.into_iter().map(Value::Str).collect()))
            .to_string(),
    )
}

pub(super) fn api_composition_get(app: &Arc<App>, req: &Request) -> Response {
    let Some(name) = req.param("name") else {
        return Response::error(400, "no name given");
    };
    match crate::compose::get(&app.compositions_path(), name) {
        Some(v) => Response::json(v.to_string()),
        None => Response::error(404, "no such composition"),
    }
}

pub(super) fn api_composition_save(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(name) = v.get("name").and_then(|n| n.as_str()).map(str::to_string) else {
        return Response::error(400, "a composition needs a name");
    };
    let Some(composition) = v.get("composition").cloned() else {
        return Response::error(400, "there is nothing to keep");
    };
    if let Err(e) = crate::compose::save(&app.compositions_path(), &name, composition) {
        return Response::error(400, &e.to_string());
    }
    api_compositions_list(app)
}

pub(super) fn api_composition_delete(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(name) = v.get("name").and_then(|n| n.as_str()) else {
        return Response::error(400, "no name given");
    };
    if let Err(e) = crate::compose::delete(&app.compositions_path(), name) {
        return Response::error(500, &e.to_string());
    }
    api_compositions_list(app)
}

/// A film, saved beside the document it was made from — in a folder of its own
/// when one is named, which is how the Compose export puts the sound and the
/// film of a composition together. The film is made in the page, so it arrives
/// here as bytes.
pub(super) fn api_export_film(app: &Arc<App>, req: &Request) -> Response {
    let Some(lib) = app.library_path() else {
        return Response::error(400, "no library chosen");
    };
    let Some(rel) = req.param("p") else {
        return Response::error(400, "no path given");
    };
    if resolve_within(&lib, rel).is_none() {
        return Response::error(404, "no such file in the library");
    }
    if req.body.is_empty() {
        return Response::error(400, "no film");
    }
    // Beside the document the way the sound's export is placed — the library
    // joined to the document's own folder — so the two report the same folder.
    // Built from the canonical path instead, the film came back under
    // `/private/var/…` while the sound beside it said `/var/…`.
    let mut dir = Path::new(rel).parent().map(|p| lib.join(p)).unwrap_or_else(|| lib.clone());
    if let Some(folder) = req.param("folder").map(crate::docs::safe_name).filter(|f| !f.is_empty()) {
        dir = dir.join(folder);
    }
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return Response::error(500, &e.to_string());
    }
    let mut file = req
        .param("file")
        .map(crate::docs::safe_name)
        .filter(|f| !f.is_empty())
        .unwrap_or_else(|| "film".to_string());
    if !file.to_lowercase().ends_with(".mp4") {
        file.push_str(".mp4");
    }
    let target = crate::docs::unique(dir.join(file));
    match std::fs::write(&target, &req.body) {
        Ok(()) => Response::json(
            Value::obj()
                .set("path", target.to_string_lossy().to_string())
                .set("bytes", Value::Num(req.body.len() as f64))
                .to_string(),
        ),
        Err(e) => Response::error(500, &e.to_string()),
    }
}

pub(super) fn api_markers_set(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(key) = v.get("p").and_then(|p| p.as_str()) else {
        return Response::error(400, "no path given");
    };
    let annotations = crate::docs::Annotations::from_json(&v);
    {
        let mut store = app.markers.write().unwrap();
        store.set(key, annotations);
        if let Err(e) = store.save(&app.markers_path()) {
            return Response::error(500, &e.to_string());
        }
    }
    let store = app.markers.read().unwrap();
    Response::json(store.get(key).to_json().to_string())
}

/// Peak's Action-menu commands over markers and regions.
///
/// Separate from `/api/edit` because none of these change audio: they change
/// notes *about* the audio, they have their own store, and putting them on the
/// edit document's undo stack would mean an undo after renaming a marker could
/// take back a cut.
pub(super) fn api_annot(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(rel) = v.get("p").and_then(|p| p.as_str()) else {
        return Response::error(400, "no path given");
    };
    let op = v.get("op").and_then(|o| o.as_str()).unwrap_or("");
    let num = |k: &str| -> u64 {
        match v.get(k) {
            Some(Value::Num(n)) if *n >= 0.0 => *n as u64,
            _ => 0,
        }
    };
    let signed = |k: &str| -> i64 {
        match v.get(k) {
            Some(Value::Num(n)) if n.is_finite() => *n as i64,
            _ => 0,
        }
    };
    let text = |k: &str| -> &str { v.get(k).and_then(|s| s.as_str()).unwrap_or("") };
    let flag = |k: &str| -> bool { matches!(v.get(k), Some(Value::Bool(true))) };

    let span = crate::annot::Span::new(num("start"), num("end"));
    // The document's own length, so a split with no regions has two ends to
    // work with. An unedited file has never been through the edit store.
    let total = app
        .edits
        .snapshot(rel)
        .map(|l| l.frames())
        .or_else(|| identity_for(app, rel).map(|l| l.frames()))
        .unwrap_or(0);

    let mut unknown = false;
    {
        let mut store = app.markers.write().unwrap();
        let mut a = store.get(rel);
        match op {
            "markersToRegions" => a.markers_to_regions(span, flag("each")),
            "splitRegion" => a.split_region(num("pos"), total),
            "nudge" => a.nudge(span, signed("frames")),
            "deleteMarkers" => a.delete_in(span),
            "rename" => {
                let contains = v.get("contains").and_then(|s| s.as_str());
                // Both off would silently rename nothing, which reads as a
                // broken button; markers are what the dialog defaults to.
                let (m, r) = (flag("markers"), flag("regions"));
                let (m, r) = if m || r { (m, r) } else { (true, false) };
                a.rename(span, text("to"), text("startAt"), contains, m, r);
            }
            _ => unknown = true,
        }
        if !unknown {
            store.set(rel, a);
            if let Err(e) = store.save(&app.markers_path()) {
                return Response::error(500, &e.to_string());
            }
        }
    }
    if unknown {
        return Response::error(400, &format!("unknown annotation operation: {op}"));
    }
    let store = app.markers.read().unwrap();
    Response::json(store.get(rel).to_json().to_string())
}

/// Build the starting edit document for a file, straight from its header.
///
/// **A sound opens at its defaults.** It used to open with whatever was last
/// left on it, restored from `SESSIONS.json` — so a file could come up at
/// thirty-six times its length, eleven semitones down, through a rack, because
/// of something done to it in a previous run of the program. Settings that
/// arrive without being asked for are indistinguishable from a bug, and they
/// were being blamed for one.
///
/// Work done in *this* run is not affected: the session is created once per
/// file per process, so switching tabs and coming back keeps everything.
///
/// Sessions are still written. Nothing reads them now, which is a thing to be
/// aware of rather than a thing that costs anything: it means the old
/// behaviour is one line away, and no one's work was thrown out to make this
/// change. Presets are the deliberate way to put settings back on a sound.
pub(super) fn identity_for(app: &Arc<App>, rel: &str) -> Option<edit::EditList> {
    let lib = app.library_path()?;
    let path = resolve_within(&lib, rel)?;
    let reader = audio_core::open(&path).ok()?;
    let info = reader.info();
    Some(edit::EditList::identity(info.frames(), info.channels, info.sample_rate))
}
