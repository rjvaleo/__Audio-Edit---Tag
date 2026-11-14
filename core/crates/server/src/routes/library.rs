//! The library: state, browse, folders, order, files, stats, scan and save.

use super::*;

pub(super) fn api_state(app: &Arc<App>) -> Response {
    let lib = app.library_path();
    let idx = app.index.read().unwrap();
    let (running, done, total, current) = app.scan.snapshot();
    let v = Value::obj()
        // Which interface this binary is serving. See `ui_build_id`.
        .set("uiBuild", format!("{:016x}", ui_build_id()))
        .set(
            "library",
            lib.as_ref()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
        )
        .set("indexed", !idx.is_empty())
        .set("files", idx.files.len())
        .set("folders", idx.folders.len())
        .set(
            "scan",
            Value::obj()
                .set("running", running)
                .set("done", done)
                .set("total", total)
                .set("current", current),
        );
    Response::json(v.to_string())
}

/// Directory listing for the folder picker.
///
/// This deliberately reaches outside the library — it is how the user chooses
/// one in the first place. It lists directory names only, never file contents.
pub(super) fn api_browse(req: &Request) -> Response {
    let raw = req.param("path").unwrap_or("");
    let path = if raw.is_empty() {
        home_dir().unwrap_or_else(|| PathBuf::from("/"))
    } else {
        PathBuf::from(raw)
    };

    let Ok(entries) = std::fs::read_dir(&path) else {
        return Response::error(403, "cannot read that folder");
    };

    let mut dirs: Vec<Value> = Vec::new();
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if e.path().is_dir() {
            dirs.push(
                Value::obj()
                    .set("name", name)
                    .set("path", e.path().to_string_lossy().to_string()),
            );
        }
    }
    dirs.sort_by_key(|d| {
        d.get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("")
            .to_lowercase()
    });

    // Shortcuts the user is likely to want, so they are not forced to walk up
    // from wherever the picker happens to open.
    let mut places: Vec<Value> = Vec::new();
    for (label, p) in candidate_places() {
        if p.is_dir() {
            places.push(
                Value::obj()
                    .set("name", label)
                    .set("path", p.to_string_lossy().to_string()),
            );
        }
    }

    Response::json(
        Value::obj()
            .set("path", path.to_string_lossy().to_string())
            .set(
                "parent",
                path.parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default(),
            )
            .set("dirs", Value::Arr(dirs))
            .set("places", Value::Arr(places))
            .to_string(),
    )
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Useful starting points, per platform.
fn candidate_places() -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    if let Some(h) = home_dir() {
        out.push(("Home".to_string(), h.clone()));
        for sub in ["Desktop", "Documents", "Music", "Downloads"] {
            out.push((sub.to_string(), h.join(sub)));
        }
    }
    #[cfg(target_os = "macos")]
    {
        // External drives, which is where a library this size usually lives.
        if let Ok(vols) = std::fs::read_dir("/Volumes") {
            for v in vols.flatten() {
                out.push((
                    v.file_name().to_string_lossy().to_string(),
                    v.path(),
                ));
            }
        }
    }
    #[cfg(windows)]
    {
        for letter in b'A'..=b'Z' {
            let p = PathBuf::from(format!("{}:\\", letter as char));
            if p.is_dir() {
                out.push((format!("{}:", letter as char), p));
            }
        }
    }
    out
}

pub(super) fn api_set_library(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(p) = v.get("path").and_then(|p| p.as_str()) else {
        return Response::error(400, "no path given");
    };
    let path = PathBuf::from(p);
    if !path.is_dir() {
        return Response::error(400, "that folder does not exist");
    }
    match app.set_library(path.clone()) {
        Ok(()) => Response::json(
            Value::obj()
                .set("ok", true)
                .set("library", path.to_string_lossy().to_string())
                .to_string(),
        ),
        Err(e) => Response::error(500, &e.to_string()),
    }
}

pub(super) fn api_folders(app: &Arc<App>) -> Response {
    let idx = app.index.read().unwrap();
    let arr: Vec<Value> = idx
        .folders
        .iter()
        .map(|f| {
            Value::obj()
                .set("name", f.name.clone())
                .set("level1", f.level1.clone())
                .set("level2", f.level2.clone())
                .set("machine", f.machine.clone())
                .set("confidence", f.confidence.clone())
                .set("files", f.files)
                .set("audioFiles", f.audio_files)
                .set("headerFiles", f.header_files)
                .set("bytes", f.bytes)
                .set("minutes", f.minutes)
                .set("categories", f.categories.clone())
                .set("instruments", f.instruments.clone())
                .set("formats", f.formats.clone())
                .set("tags", f.tags.clone())
        })
        .collect();
    Response::json(Value::Arr(arr).to_string())
}

/// The user's hand-arranged folder order, if they have rearranged the tree.
pub(super) fn api_order_get(app: &Arc<App>) -> Response {
    let names = std::fs::read_to_string(app.order_path())
        .ok()
        .and_then(|raw| json::parse(&raw))
        .and_then(|v| match v {
            Value::Arr(a) => Some(a),
            _ => None,
        })
        .unwrap_or_default();
    Response::json(Value::Arr(names).to_string())
}

pub(super) fn api_order_set(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(Value::Arr(names)) = v.get("order").cloned() else {
        return Response::error(400, "expected an \"order\" array");
    };
    // Store names only; a folder that later disappears simply drops out of the
    // ordering rather than leaving a hole.
    let cleaned: Vec<Value> = names
        .into_iter()
        .filter(|n| matches!(n, Value::Str(s) if !s.is_empty()))
        .collect();
    match std::fs::write(app.order_path(), Value::Arr(cleaned).to_string()) {
        Ok(()) => Response::json(Value::obj().set("ok", true).to_string()),
        Err(e) => Response::error(500, &e.to_string()),
    }
}

pub(super) fn api_files(app: &Arc<App>, req: &Request) -> Response {
    let Some(folder) = req.param("folder") else {
        return Response::error(400, "no folder given");
    };
    let idx = app.index.read().unwrap();
    let arr: Vec<Value> = idx
        .files
        .iter()
        .filter(|f| f.folder == folder)
        .map(|f| {
            Value::obj()
                .set("path", format!("{}/{}", f.folder, f.rel_path))
                .set("name", f.filename.clone())
                .set("subdir", f.subdir.clone())
                .set("bytes", f.bytes)
                .set("duration", f.duration)
                .set("sampleRate", f.sample_rate)
                .set("bits", f.bits)
                .set("channels", f.channels)
                .set("format", f.format.clone())
                .set("category", f.category.clone())
                .set("confidence", f.confidence.clone())
                .set("machine", f.machine.clone())
                .set("instrument", f.instrument.clone())
                .set("bpm", f.bpm.clone())
                .set("why", f.reasons.clone())
        })
        .collect();
    Response::json(Value::Arr(arr).to_string())
}

/// Resolve a library-relative path from the `p` query parameter.
pub(super) fn library_file(app: &Arc<App>, req: &Request) -> Result<PathBuf, Response> {
    let Some(lib) = app.library_path() else {
        return Err(Response::error(400, "no library chosen"));
    };
    let Some(rel) = req.param("p") else {
        return Err(Response::error(400, "no path given"));
    };
    resolve_within(&lib, rel).ok_or_else(|| Response::error(404, "no such file in the library"))
}

pub(super) fn api_stats(app: &Arc<App>, req: &Request) -> Response {
    let path = match library_file(app, req) {
        Ok(p) => p,
        Err(r) => return r,
    };
    let mut reader = match audio_core::open(&path) {
        Ok(r) => r,
        Err(e) => return Response::error(400, &e.to_string()),
    };
    let info = *reader.info();
    let s = match reader.stats() {
        Ok(s) => s,
        Err(e) => return Response::error(500, &e.to_string()),
    };
    Response::json(
        Value::obj()
            .set("peak", s.peak)
            .set("peakDbfs", s.peak_dbfs)
            .set("rms", s.rms)
            .set("rmsDbfs", s.rms_dbfs)
            .set("correlation", s.correlation.map(|c| c as f64))
            .set("dualMono", s.dual_mono)
            .set("clipped", s.clipped_samples)
            .set("sampleRate", info.sample_rate)
            .set("channels", info.channels)
            .set("bits", info.bits)
            .set("frames", info.frames())
            .set("duration", info.duration_secs())
            .set("container", format!("{:?}", info.container))
            .to_string(),
    )
}

pub(super) fn api_scan_status(app: &Arc<App>) -> Response {
    let (running, done, total, current) = app.scan.snapshot();
    Response::json(
        Value::obj()
            .set("running", running)
            .set("done", done)
            .set("total", total)
            .set("current", current)
            .to_string(),
    )
}

pub(super) fn api_scan_start(app: &Arc<App>) -> Response {
    let Some(lib) = app.library_path() else {
        return Response::error(400, "no library chosen");
    };
    if app.scan.running.swap(true, Ordering::SeqCst) {
        return Response::error(400, "a scan is already running");
    }
    app.scan.cancel.store(false, Ordering::Relaxed);

    let app2 = Arc::clone(app);
    std::thread::spawn(move || {
        let result = run_scan(&app2, &lib);
        if let Err(e) = result {
            if let Ok(mut c) = app2.scan.current.lock() {
                *c = format!("failed: {e}");
            }
        }
        app2.scan.running.store(false, Ordering::SeqCst);
    });

    Response::json(Value::obj().set("ok", true).to_string())
}

fn run_scan(app: &Arc<App>, lib: &Path) -> std::io::Result<()> {
    let roots = indexer::library_roots(lib)?;
    app.scan.total.store(roots.len(), Ordering::Relaxed);
    app.scan.done.store(0, Ordering::Relaxed);

    let mut all = Vec::new();
    for r in &roots {
        if app.scan.cancel.load(Ordering::Relaxed) {
            break;
        }
        if let Ok(mut c) = app.scan.current.lock() {
            *c = r.clone();
        }
        all.extend(indexer::scan_folder(lib, r)?);
        app.scan.done.fetch_add(1, Ordering::Relaxed);
    }

    std::fs::create_dir_all(&app.data_dir)?;
    Index::save(&all, &app.index_path())?;

    let mut idx = Index {
        files: all.iter().map(Into::into).collect(),
        folders: Vec::new(),
    };
    idx.rebuild_folders();
    *app.index.write().unwrap() = idx;

    if let Ok(mut c) = app.scan.current.lock() {
        *c = String::new();
    }
    Ok(())
}

/// Persist tag edits: into the overrides file, and into a `_TAGS.txt` beside
/// the audio. Neither touches an audio file.
pub(super) fn api_save(app: &Arc<App>, req: &Request) -> Response {
    let Some(payload) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(lib) = app.library_path() else {
        return Response::error(400, "no library chosen");
    };

    // Merge with what is already stored rather than replacing it, and merge
    // field by field: the browser only sends the fields that changed, so
    // replacing an entry wholesale would silently clear the others.
    let mut current = app.overrides.read().unwrap().clone();
    let mut folders_touched: Vec<String> = Vec::new();

    for (section, key_is_path) in [("folders", false), ("files", true)] {
        let Some(edits) = payload.get(section).and_then(|f| f.as_obj()) else { continue };
        for (name, edit) in edits {
            merge_entry(&mut current, section, name, edit);
            let folder = if key_is_path {
                name.split('/').next().unwrap_or(name).to_string()
            } else {
                name.clone()
            };
            if !folders_touched.contains(&folder) {
                folders_touched.push(folder);
            }
        }
    }

    if let Err(e) = std::fs::write(app.overrides_path(), current.to_string()) {
        return Response::error(500, &e.to_string());
    }

    // `_TAGS.txt` is regenerated from the whole stored set rather than appended
    // to, so there is one writer and no need to parse back a file we wrote.
    let mut written = 0usize;
    for folder in &folders_touched {
        if write_tags_file(&lib, folder, &current).is_ok() {
            written += 1;
        }
    }
    *app.overrides.write().unwrap() = current;

    Response::json(
        Value::obj()
            .set("ok", true)
            .set("foldersWritten", written)
            .to_string(),
    )
}

/// Fold one edit into `root[section][name]`, keeping fields it does not mention.
pub(super) fn merge_entry(root: &mut Value, section: &str, name: &str, edit: &Value) {
    let Value::Obj(m) = root else { return };
    let Value::Obj(sm) = m.entry(section.into()).or_insert_with(Value::obj) else { return };
    let slot = sm.entry(name.to_string()).or_insert_with(Value::obj);
    let Some(fields) = edit.as_obj() else { return };
    if let Value::Obj(existing) = slot {
        for (k, v) in fields {
            existing.insert(k.clone(), v.clone());
        }
    }
}

pub(super) fn write_tags_file(lib: &Path, folder: &str, all: &Value) -> std::io::Result<()> {
    let rel = format!("{folder}/_TAGS.txt");
    let Some(path) = resolve_for_write(lib, &rel) else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "folder is outside the library",
        ));
    };

    let field = |v: &Value, k: &str| {
        v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
    };
    let blank = Value::obj();
    let f = all.get("folders").and_then(|x| x.get(folder)).unwrap_or(&blank);

    let mut body = format!(
        "# Audio Library tags\n\
         # Written by the library browser. Describes this folder and its files.\n\
         # Nothing was renamed, moved or deleted. Safe to delete this file.\n\
         \n\
         folder:      {folder}\n\
         level1:      {}\n\
         level2:      {}\n\
         tags:        {}\n\
         notes:       {}\n",
        field(f, "level1"),
        field(f, "level2"),
        field(f, "tags"),
        field(f, "notes"),
    );

    if let Some(files) = all.get("files").and_then(|x| x.as_obj()) {
        let prefix = format!("{folder}/");
        for (rel_path, edit) in files.iter().filter(|(p, _)| p.starts_with(&prefix)) {
            body.push_str(&format!(
                "\nfile:        {}\n\
                 level1:      {}\n\
                 level2:      {}\n\
                 tags:        {}\n\
                 notes:       {}\n",
                &rel_path[prefix.len()..],
                field(edit, "level1"),
                field(edit, "level2"),
                field(edit, "tags"),
                field(edit, "notes"),
            ));
        }
    }
    body.push_str("\nedited:      by hand in the library browser\n");
    std::fs::write(path, body)
}

// ======================================================== the live engine
//
// Playback is the engine's, not the browser's. These endpoints are the whole
// interface to it: one expensive call to load a file, and a handful of cheap
// ones that only ever touch atomics.

/// The drum machines in the library, for the sequencer's Band (`ui/sequencer/drums.js`):
/// every `<brand>/<machine>/` folder under a `many_drum_machines` folder at the
/// library's root or one or two folders down, with its audio files' names. Paths
/// are the library's own, for `/audio?p=`.
pub(super) fn api_seq_kits(app: &Arc<App>) -> Response {
    let Some(lib) = app.library_path() else {
        return Response::json("[]".to_string());
    };
    let mut roots: Vec<PathBuf> = Vec::new();
    let mut look = |dir: &Path| {
        let p = dir.join("many_drum_machines");
        if p.is_dir() && !roots.contains(&p) {
            roots.push(p);
        }
    };
    look(&lib);
    if let Ok(rd) = std::fs::read_dir(&lib) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                look(&p);
                if let Ok(rd2) = std::fs::read_dir(&p) {
                    for e2 in rd2.flatten() {
                        if e2.path().is_dir() {
                            look(&e2.path());
                        }
                    }
                }
            }
        }
    }
    let audio = |n: &str| {
        let l = n.to_lowercase();
        !l.starts_with('.') && (l.ends_with(".wav") || l.ends_with(".aif") || l.ends_with(".aiff"))
    };
    let mut out: Vec<Value> = Vec::new();
    for root in roots.iter().take(2) {
        let Ok(brands) = std::fs::read_dir(root) else { continue };
        for b in brands.flatten() {
            if !b.path().is_dir() {
                continue;
            }
            // A machine's files may sit in the brand's folder itself, or one down.
            let mut dirs = vec![b.path()];
            if let Ok(ms) = std::fs::read_dir(b.path()) {
                for m in ms.flatten() {
                    if m.path().is_dir() {
                        dirs.push(m.path());
                    }
                }
            }
            for d in dirs {
                let Ok(fs) = std::fs::read_dir(&d) else { continue };
                let mut files: Vec<String> = fs
                    .flatten()
                    .filter(|f| f.path().is_file())
                    .map(|f| f.file_name().to_string_lossy().to_string())
                    .filter(|n| audio(n))
                    .collect();
                if files.len() < 3 {
                    continue;
                }
                files.sort();
                let Ok(rel) = d.strip_prefix(&lib) else { continue };
                let name = d
                    .file_name()
                    .map(|n| n.to_string_lossy().replace('_', " "))
                    .unwrap_or_default();
                out.push(
                    Value::obj()
                        .set("name", name)
                        .set("path", rel.to_string_lossy().to_string())
                        .set("files", Value::Arr(files.into_iter().map(Value::from).collect())),
                );
            }
        }
    }
    Response::json(Value::Arr(out).to_string())
}
