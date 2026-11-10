//! Presets.

use super::*;

pub(super) fn api_presets_list(app: &Arc<App>) -> Response {
    let presets = app.presets.read().unwrap();
    let arr: Vec<Value> = presets.values().map(|p| p.to_json()).collect();
    Response::json(Value::obj().set("presets", Value::Arr(arr)).to_string())
}

/// Capture the current settings of a file under a name.
pub(super) fn api_preset_save(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let name = v.get("name").and_then(|n| n.as_str()).unwrap_or("").trim().to_string();
    if name.is_empty() {
        return Response::error(400, "a preset needs a name");
    }
    let Some(rel) = v.get("p").and_then(|p| p.as_str()) else {
        return Response::error(400, "no path given");
    };
    // The file has to exist; it does not have to have been edited.
    //
    // This used to require an edit document and refuse without one, which meant
    // a file whose settings were all in the rack — the maximiser turned up and
    // nothing else — reported that it had no settings to save while plainly
    // having some. A file with no stretch spec has the default one, which is a
    // perfectly good thing to store alongside a rack.
    if identity_for(app, rel).is_none() {
        return Response::error(404, "no such file in the library");
    }

    let preset = crate::persist::Preset {
        name: name.clone(),
        note: v.get("note").and_then(|n| n.as_str()).unwrap_or("").to_string(),
        // The sound this was taken from, so it can be recalled with it.
        path: rel.to_string(),
        stretch: app.edits.snapshot(rel).map(|l| l.stretch).unwrap_or_default(),
        rack: app.racks.get(rel),
    };
    {
        let mut presets = app.presets.write().unwrap();
        presets.insert(name.clone(), preset);
        if let Err(e) = crate::persist::save_presets(&app.presets_path(), &presets) {
            return Response::error(500, &e.to_string());
        }
    }
    api_presets_list(app)
}

/// Drop a saved preset onto a file. Only settings move — no audio, no edits.
pub(super) fn api_preset_apply(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let (Some(name), Some(rel)) = (
        v.get("name").and_then(|n| n.as_str()),
        v.get("p").and_then(|p| p.as_str()),
    ) else {
        return Response::error(400, "need a preset name and a path");
    };
    let Some(preset) = app.presets.read().unwrap().get(name).cloned() else {
        return Response::error(404, "no such preset");
    };
    let with_sound = matches!(v.get("withSound"), Some(Value::Bool(true)));

    // With sound, the preset's own file is the target — that is the whole
    // point of it. A preset written before presets knew about sounds has no
    // path, and one whose sound has since been moved or deleted cannot be
    // honoured; both say so rather than quietly applying to whatever happens
    // to be open, which would be a different thing from the one asked for.
    let rel: &str = if with_sound {
        if preset.path.is_empty() {
            return Response::error(
                409,
                "this preset was saved before presets remembered their sound, so there is nothing to load",
            );
        }
        if identity_for(app, &preset.path).is_none() {
            return Response::error(
                404,
                &format!("the sound this preset was made from is not in the library: {}", preset.path),
            );
        }
        &preset.path
    } else {
        rel
    };

    let Some(identity) = identity_for(app, rel) else {
        return Response::error(404, "no such file in the library");
    };

    // "With sound" is a complete recall: the file, the rack, the settings, all
    // of it overwritten. Without it a preset is what it has always been —
    // settings you drop onto the chain you have already built — except that it
    // no longer evicts that chain. See `docs/PRESETS-WITH-SOUND.md`.
    if with_sound {
        // The rack moves whenever the preset holds anything but a factory rack.
        //
        // This used to ask whether the *slots* were empty, which is a different
        // question: the channel maximiser lives in the rack beside the slots
        // rather than in a place of its own, so a preset that is nothing but a
        // maximiser setting has no slots and was silently dropped. The guard is
        // still here — a preset holding a factory rack should not wipe the one
        // you have — it now just asks about the whole rack.
        if preset.rack != crate::rack::RackSpec::empty() {
            app.set_rack(rel, preset.rack.clone());
        }
    } else {
        // Settings only. Nothing is added, nothing removed, nothing reordered:
        // a preset with a reverb dropped onto a rack with no reverb adds no
        // reverb. Matched by kind and by position *among slots of that kind*,
        // so a preset built with the EQ first still finds the EQ in a chain
        // that has it third.
        let mut mine = app.racks.get(rel);
        let mut used = vec![false; mine.slots.len()];
        for from in &preset.rack.slots {
            let hit = mine.slots.iter().enumerate().position(|(i, slot)| {
                !used[i] && std::mem::discriminant(slot) == std::mem::discriminant(from)
            });
            if let Some(i) = hit {
                if mine.slots[i].take_settings_from(from) {
                    used[i] = true;
                }
            }
        }
        // The master is part of the rack and not a slot, so it has to be
        // carried across by hand or a preset that is only a maximiser setting
        // would do nothing at all.
        mine.master = preset.rack.master;
        app.set_rack(rel, mine);
    }
    let stretch = preset.stretch;
    // Applied as an ordinary edit, so it lands on the undo stack like anything
    // else and can simply be undone.
    let out = app.edits.with(rel, || identity, |s| {
        s.apply(|l| l.stretch = stretch);
        crate::docs::edit_json(s.list(), s.can_undo(), s.can_redo())
    });
    app.save_sessions();

    // And put it on the engine, so "with sound" means the sound is actually
    // there rather than merely named. After the edit, so what gets loaded is
    // the document the preset just made.
    if with_sound {
        if let Some(path) = app.library_path().and_then(|l| resolve_within(&l, rel)) {
            let _ = crate::live::load(app, rel, &path, crate::live::Playing::Document);
        }
    }

    // The path is returned either way, so the interface knows which file it is
    // now looking at — with sound that is not the one it asked about.
    Response::json(out.set("path", rel.to_string()).to_string())
}

/// Edit a stored preset in place: its name, its note, or any of its values.
///
/// Separate from saving because the two want opposite things. Saving captures
/// whatever a file currently has and needs that file; this writes values given
/// outright and must work with nothing open at all, which is the whole point of
/// a manager — the preset is the thing being edited, not the sound.
///
/// Absent means unchanged here as everywhere else, so the manager can send back
/// only the part it touched.
pub(super) fn api_preset_update(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(name) = v.get("name").and_then(|n| n.as_str()) else {
        return Response::error(400, "no name given");
    };
    let Some(mut preset) = app.presets.read().unwrap().get(name).cloned() else {
        return Response::error(404, "no such preset");
    };

    // Renaming to a name already in use would silently swallow the other one.
    let renamed = match v.get("to").and_then(|t| t.as_str()).map(str::trim) {
        Some(to) if to.is_empty() => return Response::error(400, "a preset needs a name"),
        Some(to) if to != name => {
            if app.presets.read().unwrap().contains_key(to) {
                return Response::error(409, "a preset with that name already exists");
            }
            preset.name = to.to_string();
            true
        }
        _ => false,
    };
    if let Some(note) = v.get("note").and_then(|n| n.as_str()) {
        preset.note = note.to_string();
    }
    // The values go through exactly the same readers the document uses, so the
    // manager cannot store anything the engines would refuse — every clamp is
    // applied once, in one place, and this is not a second place.
    if let Some(s) = v.get("stretch") {
        preset.stretch = crate::persist::stretch_from_json(s);
    }
    if let Some(r) = v.get("rack") {
        preset.rack = crate::rack::RackSpec::from_json(r);
    }

    {
        let mut presets = app.presets.write().unwrap();
        if renamed {
            presets.remove(name);
        }
        presets.insert(preset.name.clone(), preset);
        if let Err(e) = crate::persist::save_presets(&app.presets_path(), &presets) {
            return Response::error(500, &e.to_string());
        }
    }
    api_presets_list(app)
}

/// Store a new preset from values given outright, with no file involved.
///
/// The manager's Duplicate. It copies the *draft* rather than what is stored,
/// so a copy can be taken of edits without committing them to the original.
pub(super) fn api_preset_duplicate(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let name = v.get("name").and_then(|n| n.as_str()).unwrap_or("").trim().to_string();
    if name.is_empty() {
        return Response::error(400, "a preset needs a name");
    }
    if app.presets.read().unwrap().contains_key(&name) {
        return Response::error(409, "a preset with that name already exists");
    }

    let preset = crate::persist::Preset {
        name: name.clone(),
        note: v.get("note").and_then(|n| n.as_str()).unwrap_or("").to_string(),
        path: v.get("path").and_then(|n| n.as_str()).unwrap_or("").to_string(),
        stretch: v.get("stretch").map(crate::persist::stretch_from_json).unwrap_or_default(),
        rack: v
            .get("rack")
            .map(crate::rack::RackSpec::from_json)
            .unwrap_or_else(crate::rack::RackSpec::empty),
    };
    {
        let mut presets = app.presets.write().unwrap();
        presets.insert(name, preset);
        if let Err(e) = crate::persist::save_presets(&app.presets_path(), &presets) {
            return Response::error(500, &e.to_string());
        }
    }
    api_presets_list(app)
}

pub(super) fn api_preset_delete(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(name) = v.get("name").and_then(|n| n.as_str()) else {
        return Response::error(400, "no name given");
    };
    {
        let mut presets = app.presets.write().unwrap();
        presets.remove(name);
        if let Err(e) = crate::persist::save_presets(&app.presets_path(), &presets) {
            return Response::error(500, &e.to_string());
        }
    }
    api_presets_list(app)
}
