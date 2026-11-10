//! Fingerprints, the classifier's labels, tags and similar sounds, and their tests.

use super::*;

/// Re-read one folder and fold it back into the index.
///
/// A capture drops a file into the library while the app is running, and until
/// something notices it the browser is describing a directory that no longer
/// matches the disk. Re-scanning the whole library for one new file would be
/// absurd on a large one, so only the folder that changed is re-read and its
/// rows swapped in.
fn reindex_folder(app: &Arc<App>, root: &str) {
    let Some(lib) = app.library_path() else { return };
    let Ok(fresh) = indexer::scan_folder(&lib, root) else { return };

    {
        let mut idx = app.index.write().unwrap();
        idx.files.retain(|f| f.folder != root);
        idx.files.extend(fresh.iter().map(Into::into));
        idx.files.sort_by(|a, b| {
            a.folder.cmp(&b.folder).then(a.rel_path.cmp(&b.rel_path))
        });
        idx.rebuild_folders();
    }

    // Keep the file on disk in step, or the next start would forget it again.
    let all: Vec<indexer::FileRecord> = match indexer::library_roots(&lib) {
        Ok(roots) => roots
            .iter()
            .filter_map(|r| indexer::scan_folder(&lib, r).ok())
            .flatten()
            .collect(),
        Err(_) => return,
    };
    let _ = Index::save(&all, &app.index_path());
}

/// Re-read the folder a path sits in.
pub(super) fn reindex_for(app: &Arc<App>, rel: &str) {
    let root = rel.split('/').next().unwrap_or("");
    if !root.is_empty() {
        reindex_folder(app, root);
    }
}

// ==================================================== similar sounds
//
// Acoustic similarity, not meaning: this finds sounds shaped like the one you
// picked. Fingerprints are built the first time they are asked for and kept
// beside the index, so the cost falls once per file rather than once per search.

pub(super) fn ensure_prints(app: &Arc<App>) -> usize {
    let Some(lib) = app.library_path() else { return 0 };
    // One pass at a time, and this one answers nothing if another is running.
    let Some(_pass) = app.print_pass.enter() else { return 0 };

    // Which files still need measuring, decided while holding only read locks.
    let wanted: Vec<String> = {
        let idx = app.index.read().unwrap();
        let have = app.prints.read().unwrap();
        idx.files
            .iter()
            .filter(|f| f.duration > 0.0)
            // rel_path is relative to its folder, not to the library. The
            // library-relative path — which is what every other endpoint and
            // the interface use as a file's identity — is the two joined.
            .map(|f| format!("{}/{}", f.folder, f.rel_path))
            .filter(|p| have.get(p).is_none())
            .collect()
    };
    if wanted.is_empty() {
        return 0;
    }

    // A slice of the queue, not all of it.
    //
    // A request has to come back. Adding a folder of six hundred sounds made
    // the first request that touched this into a walk of the whole library
    // inside one HTTP handler, and the interface waited on it for as long as it
    // took. The queue is worked through across the requests that ordinary use
    // produces, and each one returns having made the picture a little more
    // complete.
    let batch = wanted.len().min(PASS_BATCH);
    let mut built = Vec::new();
    let (mut no_path, mut no_open, mut no_fp) = (0usize, 0usize, 0usize);
    for rel in wanted.iter().take(batch) {
        let Some(path) = resolve_within(&lib, rel) else { no_path += 1; continue };
        let mut r = match audio_core::open(&path) {
            Ok(r) => r,
            Err(_) => { no_open += 1; continue }
        };
        match search::Fingerprint::of(&mut r) {
            Ok(fp) => built.push((rel.clone(), fp)),
            Err(_) => no_fp += 1,
        }
    }
    // Worth saying out loud: a library where nothing can be measured should not
    // look the same as one where everything matched.
    if built.len() < batch {
        eprintln!(
            "fingerprints: {} of {} measured ({} unresolved, {} unopenable, {} unmeasurable)",
            built.len(), batch, no_path, no_open, no_fp
        );
    }

    let n = built.len();
    {
        let mut store = app.prints.write().unwrap();
        for (rel, fp) in built {
            store.insert(&rel, fp);
        }
        let _ = store.save(&app.prints_path());
    }
    n
}

// ==================================================== what a sound *is*
//
// The fingerprints above say what a sound is like. This says what it is: the
// AudioSet classifier gives it a name from the audio, and files it could not
// name borrow one from a neighbour that it could.

/// Load the classifier, once, on the first request that needs it.
///
/// Returns None when the weights are not on disk. That is a normal state — the
/// rest of the app works without them — so it is reported once and then left
/// alone rather than retried on every request.
fn model(app: &Arc<App>) -> Option<Arc<yamnet::Model>> {
    let mut slot = app.model.lock().unwrap();
    if let Some(m) = slot.as_ref() {
        return Some(m.clone());
    }
    match yamnet::Model::load_default() {
        Ok(m) => {
            let m = Arc::new(m);
            *slot = Some(m.clone());
            Some(m)
        }
        Err(e) => {
            eprintln!("sound labels unavailable: {e}");
            None
        }
    }
}

/// Make sure every file has been through the classifier, then work out who is
/// borrowing a name from whom.
/// When the labels and fingerprints were last written to disk, in seconds.
static LABELS_SAVED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
/// Files the classifier hears per pass: twice the fingerprint pass's batch,
/// since several are heard at once.
const LABEL_BATCH: usize = 64;
/// Only the start of a file is decoded for the model: it listens to three
/// windows of three seconds and no more, and decoding all of an hour-long
/// take to hear nine seconds of it was most of what a pass spent its time on.
const LABEL_LISTEN_SECS: u64 = 10;

/// What the model hears in each of `rels`, and its fingerprint of each, on
/// half the machine's cores at once: the rest stay free for the audio. A file
/// that cannot be read or heard is left out, and asked about again next pass.
fn listen_to(lib: &std::path::Path, model: &Arc<yamnet::Model>, rels: &[String]) -> Vec<(String, Vec<yamnet::Detection>, Vec<f32>)> {
    let threads = std::thread::available_parallelism().map(|n| (n.get() / 2).max(1)).unwrap_or(2);
    let chunk = rels.len().div_ceil(threads).max(1);
    std::thread::scope(|s| {
        let handles: Vec<_> = rels
            .chunks(chunk)
            .map(|part| {
                s.spawn(move || {
                    let mut out = Vec::new();
                    for rel in part {
                        let Some(path) = resolve_within(lib, rel) else { continue };
                        let Ok(mut r) = audio_core::open(&path) else { continue };
                        let info = *r.info();
                        let frames = info.frames().min(info.sample_rate as u64 * LABEL_LISTEN_SECS);
                        let Ok(samples) = r.read_frames(0, frames) else { continue };
                        let mono = yamnet::to_mono_16k(&samples, info.channels as usize, info.sample_rate);
                        // More than the panel shows. Storing the tail costs
                        // almost nothing and means anything built later has
                        // the model's fuller opinion without a second pass.
                        match model.listen(&mono, 8) {
                            // An empty list is a real answer — the model heard
                            // nothing it could name — and storing it stops the
                            // file being heard again on every request.
                            Ok((words, fingerprint)) => out.push((rel.clone(), words, fingerprint)),
                            Err(e) => eprintln!("labelling {rel}: {e}"),
                        }
                    }
                    out
                })
            })
            .collect();
        handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    })
}

pub(super) fn ensure_labels(app: &Arc<App>) -> usize {
    let Some(lib) = app.library_path() else { return 0 };
    // One pass at a time. See `Pass`: this is the flag that stops a slider drag
    // turning one classification of the library into thirteen of them.
    let Some(_pass) = app.label_pass.enter() else { return 0 };

    let wanted: Vec<String> = {
        let idx = app.index.read().unwrap();
        let have = app.labels.read().unwrap();
        let fingerprinted = app.embeddings.read().unwrap();
        // A file is wanted until it has both: its labels, and the model's
        // fingerprint of it for the sound map. One run of the model gives both.
        idx.files
            .iter()
            .filter(|f| f.duration > 0.0)
            .map(|f| format!("{}/{}", f.folder, f.rel_path))
            .filter(|p| !have.measured(p) || !fingerprinted.has(p))
            .collect()
    };

    // A slice of the queue. Classifying one file is a whole decode, a resample
    // and a run of the model, and doing six hundred of them is minutes of work
    // that used to happen inside a single request.
    let batch = wanted.len().min(LABEL_BATCH);
    let mut built = 0usize;
    if batch > 0 {
        let Some(model) = model(app) else { return 0 };

        for (rel, words, fingerprint) in listen_to(&lib, &model, &wanted[..batch]) {
            // A file labelled before fingerprints were kept is only being
            // fingerprinted: what it was heard as stays as it was.
            app.embeddings.write().unwrap().insert(&rel, fingerprint);
            built += 1;
            if !app.labels.read().unwrap().measured(&rel) {
                app.labels.write().unwrap().insert(&rel, words);
            }
        }

        // Written every batch while the files are small, and at most every
        // fifteen seconds once they are not. Writing both after every eighth
        // sound was fine for a few thousand; for eighty thousand fingerprints
        // it rewrote a hundred-odd megabytes eight sounds at a time, and the
        // pass spent its time writing rather than listening. A crash loses at
        // most the last fifteen seconds, which the next pass hears again.
        let due = {
            use std::sync::atomic::Ordering;
            let last = LABELS_SAVED.load(Ordering::Relaxed);
            let small = app.embeddings.read().unwrap().len() < 4000;
            let due = small || wanted.len() <= batch || now_secs().saturating_sub(last) >= 15;
            if due {
                LABELS_SAVED.store(now_secs(), Ordering::Relaxed);
            }
            due
        };
        if built > 0 && due {
            let _ = app.embeddings.read().unwrap().save(&app.embeddings_path());
            let store = app.labels.read().unwrap();
            let _ = store.save(&app.labels_path());
        }
    }

    // Loans depend on which files are present, so they are worked out afresh
    // rather than stored. Only redone when something changed or the derived
    // view is empty, because the ranking behind it is quadratic.
    //
    // Once the queue is drained, not once per batch. The ranking is the
    // expensive part and its answer only settles when there is nothing left to
    // measure, so running it after every slice would be paying the quadratic
    // cost twenty times over to watch an incomplete answer change.
    // Whether this call took on what was left, rather than whether every file
    // in it succeeded. A file the model cannot read never leaves the queue, and
    // counting successes would let one of those hold the ranking back forever.
    let drained = wanted.len() <= batch;
    let stale = (built > 0 && drained) || app.heard.read().unwrap().is_empty();
    if stale {
        ensure_prints(app);
        let prints = app.prints.read().unwrap();
        let store = app.labels.read().unwrap();
        let known = store.by_path.clone();
        drop(store);

        let filled = yamnet::propagate(&known, |path| {
            let Some(query) = prints.get(path) else { return Vec::new() };
            let pairs: Vec<(&str, search::Fingerprint)> =
                prints.by_path.iter().map(|(p, f)| (p.as_str(), *f)).collect();
            search::rank(&query, pairs, path, 8)
                .into_iter()
                // Only a genuinely close sound is worth taking a name from. A
                // library's nearest neighbour is not necessarily a near one:
                // at 0.90 a jazz loop and a hand drum came out as neighbours.
                .filter(|(_, score)| *score >= 0.95)
                .map(|(p, _)| p.to_string())
                .collect()
        });
        *app.heard.write().unwrap() = filled;
    }
    built
}

/// What the classifier makes of one file, ready for JSON.
pub(super) fn heard_value(app: &Arc<App>, rel: &str) -> Value {
    let heard = app.heard.read().unwrap();
    let Some(l) = heard.get(rel) else { return Value::Arr(Vec::new()) };
    Value::Arr(
        l.words
            .iter()
            .map(|d| {
                Value::obj()
                    .set("label", d.label.clone())
                    .set("score", d.score as f64)
                    // Empty when the model heard this file itself. When it did
                    // not, this names the file the label came from, so the
                    // interface can show a borrowed name as borrowed.
                    .set("from", l.from.clone().unwrap_or_default())
            })
            .collect(),
    )
}

/// What the tag fields should say about a file, before anyone edits them.
///
/// Level 1 is the name the classifier put to the sound; level 2 is what it is
/// like. The tags are the searchable pile: the words out of the filename, the
/// two filename fields that are actually reliable — `machine` and `instrument`
/// only ever fire on a real token match — plus everything both systems heard.
///
/// A take number never becomes a tag. `snare 1.wav` offers "snare"; the 1 is
/// which take it is, not what it is.
pub(super) fn suggest_tags(app: &Arc<App>, rel: &str, descriptors: &[&'static str]) -> Value {
    let heard = app.heard.read().unwrap();
    let words = heard.get(rel).map(|l| l.words.clone()).unwrap_or_default();

    let level1 = words.first().map(|d| d.label.clone()).unwrap_or_default();
    let level2 = descriptors.join(", ");

    let mut tags: Vec<String> = yamnet::propagate::name_words(rel);

    if let Some(row) = app
        .index
        .read()
        .unwrap()
        .files
        .iter()
        .find(|f| format!("{}/{}", f.folder, f.rel_path) == rel)
    {
        for extra in [&row.machine, &row.instrument, &row.bpm] {
            if !extra.is_empty() {
                tags.push(extra.to_lowercase());
            }
        }
    }

    for d in &words {
        // Class names like "Vehicle horn, car horn, honking" are three names
        // for one thing; the first is the one worth keeping.
        let head = d.label.split(',').next().unwrap_or(&d.label);
        tags.push(head.trim().to_lowercase());
    }
    tags.extend(descriptors.iter().map(|d| d.to_string()));

    let mut seen: Vec<String> = Vec::new();
    for t in tags {
        if !t.is_empty() && !seen.contains(&t) {
            seen.push(t);
        }
    }

    Value::obj()
        .set("level1", level1)
        .set("level2", level2)
        // Comma-separated, not space-separated: "Snare drum" and "Bass drum"
        // are single tags made of two words, and splitting on spaces would
        // shred them into a pile of "drum".
        .set("tags", seen.join(", "))
}

// ============================================== tags of your own invention
//
// The classifier knows AudioSet's nouns. It will never say "time stretched",
// because that is a category in your work rather than in the world. These are
// taught by example instead: tag a sound and it becomes an exemplar; anything
// close enough to an exemplar gets the tag offered, with the exemplar named.

/// Tags applied by hand, and the ones the system thinks belong here.
pub(super) fn user_tags_value(app: &Arc<App>, rel: &str) -> Value {
    let store = app.user_tags.read().unwrap();
    let mine: Vec<Value> = store.get(rel).into_iter().map(Value::Str).collect();

    // Learning needs a fingerprint for the sound being asked about and for
    // every exemplar. Without one there is nothing to compare, which is not an
    // error — it just means no suggestions yet.
    let prints = app.prints.read().unwrap();
    let learned: Vec<Value> = match prints.get(rel) {
        Some(query) => {
            let pairs: Vec<(&str, &str, search::Fingerprint)> = store
                .pairs()
                .filter_map(|(p, t)| prints.get(p).map(|fp| (p, t, fp)))
                .collect();
            let already = store.get(rel);
            search::learn::suggest(&query, pairs, rel, search::learn::LEARN, 6)
                .into_iter()
                // Never offer something that is already on the sound.
                .filter(|s| !already.contains(&s.tag))
                .map(|s| {
                    Value::obj()
                        .set("tag", s.tag)
                        .set("score", s.score as f64)
                        .set("like", s.like)
                        .set("support", s.support as f64)
                })
                .collect()
        }
        None => Vec::new(),
    };

    Value::obj()
        .set("mine", Value::Arr(mine))
        .set("learned", Value::Arr(learned))
        .set(
            "vocabulary",
            Value::Arr(store.vocabulary().into_iter().map(Value::Str).collect()),
        )
}

/// Replace the hand-applied tags on one sound.
///
/// Whole-list rather than add/remove: the panel always knows the full set, and
/// two half-updates racing each other cannot leave a tag half-applied.
pub(super) fn api_user_tags_set(app: &Arc<App>, req: &Request) -> Response {
    let Some(payload) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(path) = payload.get("path").and_then(|p| p.as_str()) else {
        return Response::error(400, "no path given");
    };
    let tags: Vec<String> = match payload.get("tags") {
        Some(Value::Arr(a)) => {
            a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()
        }
        _ => Vec::new(),
    };

    {
        let mut store = app.user_tags.write().unwrap();
        store.set(path, tags);
        if let Err(e) = store.save(&app.user_tags_path()) {
            return Response::error(500, &e.to_string());
        }
    }
    // Fingerprints are what the learning runs on, so a newly tagged sound is
    // useless as an example until it has one.
    ensure_prints(app);
    Response::json(user_tags_value(app, path).to_string())
}

/// Every sound carrying a given tag, hand-applied or close enough to inherit it.
///
/// This is the tag seen from the other side: not "what is this sound" but
/// "where else does this idea apply", which is what makes a learned tag worth
/// having at all.
pub(super) fn api_user_tag_members(app: &Arc<App>, req: &Request) -> Response {
    let Some(tag) = req.param("tag") else {
        return Response::error(400, "no tag given");
    };
    let tag = tag.trim().to_lowercase();
    ensure_prints(app);

    let store = app.user_tags.read().unwrap();
    let prints = app.prints.read().unwrap();

    let applied: Vec<String> = store
        .pairs()
        .filter(|(_, t)| *t == tag)
        .map(|(p, _)| p.to_string())
        .collect();

    // The exemplars are the same for every candidate, so gather them once
    // rather than rebuilding the list inside the loop.
    let exemplars: Vec<(&str, &str, search::Fingerprint)> = store
        .pairs()
        .filter(|(_, t)| *t == tag)
        .filter_map(|(p, t)| prints.get(p).map(|f| (p, t, f)))
        .collect();

    let mut found: Vec<(f32, String, String)> = Vec::new();
    for (path, fp) in &prints.by_path {
        if applied.contains(path) {
            continue;
        }
        if let Some(s) =
            search::learn::suggest(fp, exemplars.iter().cloned(), path, search::learn::LEARN, 1)
                .first()
        {
            found.push((s.score, path.clone(), s.like.clone()));
        }
    }
    found.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));

    let suggested: Vec<Value> = found
        .into_iter()
        .map(|(score, path, like)| {
            Value::obj()
                .set("path", path)
                .set("score", score as f64)
                .set("like", like)
        })
        .collect();

    Response::json(
        Value::obj()
            .set("tag", tag)
            .set("applied", Value::Arr(applied.into_iter().map(Value::Str).collect()))
            .set("suggested", Value::Arr(suggested))
            .to_string(),
    )
}

/// The tag fields a person has already saved for this file, if any.
pub(super) fn saved_tags(app: &Arc<App>, rel: &str) -> Value {
    let overrides = app.overrides.read().unwrap();
    overrides
        .get("files")
        .and_then(|f| f.get(rel))
        .cloned()
        .unwrap_or(Value::Null)
}

pub(super) fn api_similar(app: &Arc<App>, req: &Request) -> Response {
    let Some(rel) = req.param("p") else {
        return Response::error(400, "no path given");
    };
    let limit = req
        .param("limit")
        .and_then(|l| l.parse::<usize>().ok())
        .unwrap_or(20)
        .clamp(1, 200);

    let built = ensure_prints(app);
    ensure_labels(app);
    let heard = heard_value(app, rel);

    let store = app.prints.read().unwrap();
    let Some(query) = store.get(rel) else {
        return Response::error(404, "that sound could not be measured");
    };

    // Descriptors are relative to the library, so the yardstick is built from
    // every fingerprint we hold, once, and shared by the query and the results.
    let cal = search::Calibration::build(store.by_path.values().copied());

    let pairs: Vec<(&str, search::Fingerprint)> =
        store.by_path.iter().map(|(p, f)| (p.as_str(), *f)).collect();
    let ranked = search::rank(&query, pairs, rel, limit);

    let idx = app.index.read().unwrap();
    let results: Vec<Value> = ranked
        .iter()
        .map(|(path, score)| {
            let meta = idx
                .files
                .iter()
                .find(|f| format!("{}/{}", f.folder, f.rel_path) == **path);
            // Say what is *unlike* about a match as well as how close it is —
            // a number on its own is not a reason.
            let diff = store
                .get(path)
                .map(|fp| {
                    let d = query.largest_differences(&fp);
                    d.first().map(|(n, _)| n.to_string()).unwrap_or_default()
                })
                .unwrap_or_default();
            Value::obj()
                .set("path", path.to_string())
                .set("score", *score as f64)
                .set("differs", diff)
                .set(
                    "tags",
                    Value::Arr(
                        store
                            .get(path)
                            .map(|f| f.descriptors(&cal))
                            .unwrap_or_default()
                            .into_iter()
                            .map(|w| Value::Str(w.to_string()))
                            .collect(),
                    ),
                )
                .set(
                    "name",
                    meta.map(|m| m.filename.clone())
                        .unwrap_or_else(|| path.to_string()),
                )
                .set("seconds", meta.map(|m| m.duration).unwrap_or(0.0))
                .set(
                    "category",
                    meta.map(|m| m.category.clone()).unwrap_or_default(),
                )
        })
        .collect();

    Response::json(
        Value::obj()
            .set("of", rel.to_string())
            // The query's own description, so a caller that only wants to know
            // what one sound is like need not read the whole ranking.
            .set(
                "tags",
                Value::Arr(
                    query
                        .descriptors(&cal)
                        .into_iter()
                        .map(|w| Value::Str(w.to_string()))
                        .collect(),
                ),
            )
            // What it *is*, next to what it is like. One request, because the
            // panel showing them is one panel.
            .set("heard", heard)
            // What the tag fields should say, and what they were last saved as.
            // The interface prefers the saved one; this way it can tell the
            // difference between "nobody has touched this" and "somebody
            // deliberately cleared it".
            .set("suggest", suggest_tags(app, rel, &query.descriptors(&cal)))
            .set("saved", saved_tags(app, rel))
            .set("yourTags", user_tags_value(app, rel))
            .set("measured", built as f64)
            .set("indexed", store.len() as f64)
            .set("results", Value::Arr(results))
            .to_string(),
    )
}

/// What the classifier heard in every file of a folder.
///
/// Separate from `/api/files` because the first call has to put the whole
/// library through the model, and a folder listing should not wait on that.
pub(super) fn api_labels(app: &Arc<App>, req: &Request) -> Response {
    let Some(folder) = req.param("folder") else {
        return Response::error(400, "no folder given");
    };
    let built = ensure_labels(app);

    let paths: Vec<String> = {
        let idx = app.index.read().unwrap();
        idx.files
            .iter()
            .filter(|f| f.folder == folder)
            .map(|f| format!("{}/{}", f.folder, f.rel_path))
            .collect()
    };

    let mut files = Value::obj();
    for p in &paths {
        files = files.set(p.as_str(), heard_value(app, p));
    }
    Response::json(
        Value::obj()
            .set("folder", folder.to_string())
            .set("measured", built as f64)
            // So the interface can say "no model" rather than "no labels",
            // which are different problems with different fixes.
            .set("available", app.model.lock().unwrap().is_some())
            .set("files", files)
            .to_string(),
    )
}

#[cfg(test)]
mod tag_tests {
    use super::*;

    fn edit(pairs: &[(&str, &str)]) -> Value {
        let mut v = Value::obj();
        for (k, val) in pairs {
            v = v.set(*k, val.to_string());
        }
        v
    }

    fn field(root: &Value, section: &str, name: &str, key: &str) -> String {
        root.get(section)
            .and_then(|s| s.get(name))
            .and_then(|e| e.get(key))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string()
    }

    /// The browser sends only the fields that changed. Replacing the entry
    /// wholesale would clear the others without saying so.
    #[test]
    fn editing_one_field_leaves_the_others_alone() {
        let mut root = Value::obj();
        merge_entry(&mut root, "files", "P/a.wav", &edit(&[("level1", "Snare drum"), ("tags", "snare")]));
        merge_entry(&mut root, "files", "P/a.wav", &edit(&[("notes", "cracks nicely")]));

        assert_eq!(field(&root, "files", "P/a.wav", "level1"), "Snare drum");
        assert_eq!(field(&root, "files", "P/a.wav", "tags"), "snare");
        assert_eq!(field(&root, "files", "P/a.wav", "notes"), "cracks nicely");
    }

    #[test]
    fn a_field_can_be_deliberately_cleared() {
        let mut root = Value::obj();
        merge_entry(&mut root, "files", "P/a.wav", &edit(&[("tags", "snare")]));
        merge_entry(&mut root, "files", "P/a.wav", &edit(&[("tags", "")]));
        assert_eq!(field(&root, "files", "P/a.wav", "tags"), "");
    }

    #[test]
    fn files_and_folders_are_kept_apart() {
        let mut root = Value::obj();
        merge_entry(&mut root, "folders", "Pack", &edit(&[("level1", "Sample")]));
        merge_entry(&mut root, "files", "Pack/a.wav", &edit(&[("level1", "Snare drum")]));

        assert_eq!(field(&root, "folders", "Pack", "level1"), "Sample");
        assert_eq!(field(&root, "files", "Pack/a.wav", "level1"), "Snare drum");
    }

    #[test]
    fn one_file_edit_does_not_disturb_another() {
        let mut root = Value::obj();
        merge_entry(&mut root, "files", "P/a.wav", &edit(&[("tags", "kick")]));
        merge_entry(&mut root, "files", "P/b.wav", &edit(&[("tags", "snare")]));
        assert_eq!(field(&root, "files", "P/a.wav", "tags"), "kick");
        assert_eq!(field(&root, "files", "P/b.wav", "tags"), "snare");
    }

    /// The tags file is rewritten from the whole stored set every time, so a
    /// file edited last week must still be in it after one edited today.
    #[test]
    fn the_tags_file_carries_every_file_in_the_folder() {
        let dir = std::env::temp_dir().join(format!("audiolab-tags-{}", std::process::id()));
        let _ = std::fs::create_dir_all(dir.join("Pack"));

        let mut root = Value::obj();
        merge_entry(&mut root, "folders", "Pack", &edit(&[("level1", "Sample")]));
        merge_entry(&mut root, "files", "Pack/old.wav", &edit(&[("tags", "kick")]));
        merge_entry(&mut root, "files", "Pack/new.wav", &edit(&[("tags", "snare")]));
        merge_entry(&mut root, "files", "Other/x.wav", &edit(&[("tags", "elsewhere")]));

        write_tags_file(&dir, "Pack", &root).expect("write");
        let body = std::fs::read_to_string(dir.join("Pack/_TAGS.txt")).unwrap();

        assert!(body.contains("old.wav"), "an earlier edit was dropped:\n{body}");
        assert!(body.contains("new.wav"));
        assert!(body.contains("level1:      Sample"));
        assert!(!body.contains("elsewhere"), "another folder's file leaked in");
        let _ = std::fs::remove_dir_all(dir);
    }
}
