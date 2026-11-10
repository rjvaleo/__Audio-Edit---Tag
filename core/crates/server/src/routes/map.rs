//! Sounds, the space, the map and the sound map.

use super::*;

/// Everything known about every sound, in one request.
///
/// The other endpoints are each shaped for one panel. This one is shaped for
/// whatever comes next — a visualiser, an export, an experiment — and the point
/// of it is that nothing has to be looked up a second time. Identity, format,
/// what the indexer decided from the name, what the model heard, what the
/// fingerprint measured (all twelve dimensions, not just the three the space
/// view projects onto), where it sits in that space, and any tags a person has
/// saved or the machine would suggest.
///
/// It is deliberately verbose. A library of ten thousand files is a few
/// megabytes of JSON, which is nothing next to fetching it in pieces.
pub(super) fn api_sounds(app: &Arc<App>) -> Response {
    ensure_prints(app);
    ensure_labels(app);

    let prints = app.prints.read().unwrap();
    let cal = search::Calibration::build(prints.by_path.values().copied());
    let idx = app.index.read().unwrap();

    let axis = |n: &str| search::NAMES.iter().position(|x| *x == n).unwrap();
    let (bright, low, pulse, density, flat, noisy) = (
        axis("brightness"), axis("low"), axis("pulse"),
        axis("density"), axis("flatness"), axis("noisiness"),
    );

    let sounds: Vec<Value> = idx
        .files
        .iter()
        .map(|f| {
            let path = format!("{}/{}", f.folder, f.rel_path);
            let fp = prints.get(&path);
            let words = fp.map(|p| p.descriptors(&cal)).unwrap_or_default();

            // Every dimension by name, so a caller never has to know the order
            // they happen to be stored in.
            let mut measured = Value::obj();
            if let Some(p) = &fp {
                for (i, name) in search::NAMES.iter().enumerate() {
                    measured = measured.set(*name, p.v[i] as f64);
                }
                // The note is not a dimension, so it is named beside them.
                measured = measured
                    .set("pitchHz", p.pitch.hz as f64)
                    .set("pitchClarity", p.pitch.clarity as f64)
                    .set("note", p.pitch.note().map(Value::Str).unwrap_or(Value::Null));
            }

            let place = fp.map(|p| {
                Value::obj()
                    .set("x", (p.v[bright] - p.v[low] * 0.5) as f64)
                    .set("y", (p.v[pulse] * 0.6 + p.v[density] * 0.4) as f64)
                    .set("z", (p.v[flat] * 0.5 + p.v[noisy] * 0.5) as f64)
            });

            Value::obj()
                .set("path", path.clone())
                .set("folder", f.folder.clone())
                .set("subdir", f.subdir.clone())
                .set("name", f.filename.clone())
                .set("stem", f.stem.clone())
                .set("ext", f.ext.clone())
                .set("parentChain", f.parent_chain.clone())
                // The file as it sits on disk.
                .set("bytes", f.bytes as f64)
                .set("modified", f.modified.clone())
                .set("format", f.format.clone())
                .set("sampleRate", f.sample_rate as f64)
                .set("bits", f.bits as f64)
                .set("channels", f.channels as f64)
                .set("seconds", f.duration)
                // What the filename classifier made of it. Kept because it is
                // occasionally right and always explains itself, not because it
                // is trusted over the audio.
                .set("category", f.category.clone())
                .set("confidence", f.confidence.clone())
                .set("machine", f.machine.clone())
                .set("instrument", f.instrument.clone())
                .set("bpm", f.bpm.clone())
                .set("why", f.reasons.clone())
                .set("notes", f.notes.clone())
                .set(
                    "nameWords",
                    Value::Arr(
                        yamnet::propagate::name_words(&path)
                            .into_iter()
                            .map(Value::Str)
                            .collect(),
                    ),
                )
                .set(
                    "filenameDescriptors",
                    Value::Arr(f.descriptors.iter().cloned().map(Value::Str).collect()),
                )
                // Which numbered series it belongs to, if any.
                .set(
                    "series",
                    Value::obj()
                        .set("root", f.series_root.clone())
                        .set("index", f.series_index.map(|i| i as f64).unwrap_or(0.0))
                        .set("size", f.series_size.map(|s| s as f64).unwrap_or(0.0))
                        .set("family", yamnet::propagate::family(&path)),
                )
                // What it is, what it is like, and where that puts it.
                .set("heard", heard_value(app, &path))
                .set(
                    "soundsLike",
                    Value::Arr(words.iter().map(|w| Value::Str(w.to_string())).collect()),
                )
                .set("measured", measured)
                .set("place", place.unwrap_or(Value::Null))
                .set("suggested", suggest_tags(app, &path, &words))
                .set("saved", saved_tags(app, &path))
                .set("yourTags", user_tags_value(app, &path))
        })
        .collect();

    Response::json(
        Value::obj()
            .set("count", sounds.len() as f64)
            .set(
                "dimensions",
                Value::Arr(search::NAMES.iter().map(|n| Value::Str(n.to_string())).collect()),
            )
            .set("axes", Value::Arr(vec![
                Value::Str("dark → bright".into()),
                Value::Str("sustained → rhythmic".into()),
                Value::Str("tonal → noisy".into()),
            ]))
            .set("sounds", Value::Arr(sounds))
            .to_string(),
    )
}

/// Every sound as a point in a navigable space.
///
/// The three axes are named rather than derived. A principal-component
/// projection would pack more variance into three numbers, but its axes mean
/// nothing you can say out loud — and the point of flying through this space is
/// to know which way is brighter. Duration is carried separately because it
/// sets how long each shape is drawn, not where it sits.
pub(super) fn api_space(app: &Arc<App>) -> Response {
    let built = ensure_prints(app);
    let store = app.prints.read().unwrap();
    let idx = app.index.read().unwrap();

    let idx_of = |n: &str| search::NAMES.iter().position(|x| *x == n).unwrap();
    let (bright, low, pulse, density, flat, noisy, dur) = (
        idx_of("brightness"), idx_of("low"), idx_of("pulse"),
        idx_of("density"), idx_of("flatness"), idx_of("noisiness"), idx_of("duration"),
    );

    let cal = search::Calibration::build(store.by_path.values().copied());

    let points: Vec<Value> = store
        .by_path
        .iter()
        .map(|(path, fp)| {
            let meta = idx
                .files
                .iter()
                .find(|f| format!("{}/{}", f.folder, f.rel_path) == *path);
            let words: Vec<Value> = fp
                .descriptors(&cal)
                .into_iter()
                .map(|w| Value::Str(w.to_string()))
                .collect();
            Value::obj()
                .set("path", path.clone())
                .set("name", meta.map(|m| m.filename.clone()).unwrap_or_else(|| path.clone()))
                // dark to bright, sustained to rhythmic, tonal to noisy.
                .set("x", (fp.v[bright] - fp.v[low] * 0.5) as f64)
                .set("y", (fp.v[pulse] * 0.6 + fp.v[density] * 0.4) as f64)
                .set("z", (fp.v[flat] * 0.5 + fp.v[noisy] * 0.5) as f64)
                .set("length", fp.v[dur] as f64)
                .set("seconds", meta.map(|m| m.duration).unwrap_or(0.0))
                // Hz, 0 when the sound has no steady note.
                .set("pitchHz", fp.pitch.hz as f64)
                .set("pitchClarity", fp.pitch.clarity as f64)
                .set("note", fp.pitch.note().map(Value::Str).unwrap_or(Value::Null))
                .set("tags", Value::Arr(words))
        })
        .collect();

    Response::json(
        Value::obj()
            .set("measured", built as f64)
            .set("axes", Value::Arr(vec![
                Value::Str("dark → bright".into()),
                Value::Str("sustained → rhythmic".into()),
                Value::Str("tonal → noisy".into()),
            ]))
            .set("points", Value::Arr(points))
            .to_string(),
    )
}

/// The sound map: every measured sound placed and styled, ready to draw.
///
/// The rules live in `search::map` and are tested there; this only gathers
/// what they need and names the result. `waiting` counts the indexed sounds
/// not yet measured — the measuring happens a batch per request, so the
/// interface asks again until it reaches nought and the map fills in as it
/// does. See `docs/SOUND-MAP.md`.
pub(super) fn api_map(app: &Arc<App>) -> Response {
    ensure_prints(app);
    ensure_labels(app);

    let prints = app.prints.read().unwrap();
    let idx = app.index.read().unwrap();
    let heard = app.heard.read().unwrap();
    let cal = search::Calibration::build(prints.by_path.values().copied());

    let files: std::collections::HashMap<String, &crate::state::FileRow> = idx
        .files
        .iter()
        .map(|f| (format!("{}/{}", f.folder, f.rel_path), f))
        .collect();
    let waiting = files
        .iter()
        .filter(|(p, f)| f.duration > 0.0 && prints.get(p).is_none())
        .count();

    // Only sounds still in the index: a fingerprint outlives a file that has
    // since been moved, and a point that cannot be played is a lie.
    let entries: Vec<(&String, search::Fingerprint, &crate::state::FileRow)> = prints
        .by_path
        .iter()
        .filter_map(|(p, fp)| files.get(p).map(|f| (p, *fp, *f)))
        .collect();
    let placed = search::map::place(&entries.iter().map(|e| e.1).collect::<Vec<_>>());

    let triple = |c: [f32; 3]| Value::Arr(c.iter().map(|v| Value::Num(*v as f64)).collect());
    let points: Vec<Value> = entries
        .iter()
        .zip(&placed)
        .map(|((path, fp, f), at)| {
            let top = heard.get(path.as_str()).and_then(|l| l.words.first().map(|w| (w.label.clone(), l.from.clone())));
            let (label, from) = top.unwrap_or_default();
            Value::obj()
                .set("path", path.to_string())
                .set("name", f.filename.clone())
                .set("folder", f.folder.clone())
                .set("seconds", f.duration)
                .set("axes", triple(at.axes))
                .set("islands", triple(at.islands))
                .set("size", at.size as f64)
                .set("rough", at.rough as f64)
                .set("crisp", at.crisp as f64)
                .set("pulseHz", at.pulse_hz as f64)
                .set("pitched", at.pitched)
                .set("hz", fp.pitch.hz as f64)
                .set("note", fp.pitch.note().map(Value::Str).unwrap_or(Value::Null))
                // The twelve, in `dimensions` order, for the info card.
                .set("v", Value::Arr(fp.v.iter().map(|x| Value::Num(*x as f64)).collect()))
                .set("family", search::map::family(&label))
                .set("label", label)
                // Set when the label was lent by a neighbour rather than heard.
                .set("from", from.unwrap_or_default())
                .set(
                    "words",
                    Value::Arr(fp.descriptors(&cal).into_iter().map(|w| Value::Str(w.to_string())).collect()),
                )
        })
        .collect();

    Response::json(
        Value::obj()
            .set("count", points.len() as f64)
            .set("waiting", waiting as f64)
            .set(
                "dimensions",
                Value::Arr(search::NAMES.iter().map(|n| Value::Str(n.to_string())).collect()),
            )
            .set("axes", Value::Arr(vec![
                Value::Str("tonal → noisy".into()),
                Value::Str("low → high".into()),
                Value::Str("short → long".into()),
            ]))
            .set("points", Value::Arr(points))
            .to_string(),
    )
}

/// When the sound map was last asked for, in seconds since 1970, and whether
/// the thread listening to the library on its behalf is running.
static MAP_ASKED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static MAP_LISTENING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// How long after the map was last asked for the listening carries on.
const MAP_IDLE_SECS: u64 = 20;

pub(super) fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Listen to the library, a batch at a time, for as long as the map is open.
///
/// Off the request: a batch is a decode and a run of the model for each of
/// thirty-two files, seconds of work, and the map has to answer at once. In a
/// library of eighty thousand sounds this is hours in all, so it only runs
/// while someone is looking, and stops a little after they close the map.
fn listen_while_the_map_is_open(app: &Arc<App>) {
    use std::sync::atomic::Ordering;
    MAP_ASKED.store(now_secs(), Ordering::Relaxed);
    if MAP_LISTENING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            let measured = ensure_prints(&app);
            let heard = ensure_labels(&app);
            let idle = now_secs().saturating_sub(MAP_ASKED.load(Ordering::Relaxed)) > MAP_IDLE_SECS;
            if (measured == 0 && heard == 0) || idle {
                break;
            }
        }
        MAP_LISTENING.store(false, Ordering::SeqCst);
    });
}

/// The sound map: every sound in the library a dot, placed so that sounds the
/// model hears as alike sit together, with the clusters that forms and their
/// names. See `search::soundmap`.
///
/// `listening` says how many sounds are still to be heard; the page asks again
/// until it is nought. Laying a large library out is seconds of work, so while
/// sounds are still arriving the map is only worked out again once there are a
/// quarter more of them, or once what they were heard as becomes known.
pub(super) fn api_soundmap(app: &Arc<App>) -> Response {
    listen_while_the_map_is_open(app);

    let (files, inputs, listening, key, fingerprinted, named) = {
        let prints = app.prints.read().unwrap();
        let idx = app.index.read().unwrap();
        let loaned = app.heard.read().unwrap();
        let measured = app.labels.read().unwrap();
        // What each sound was heard as, loans included, is worked out by the
        // listening pass a few seconds after the program starts. Until then,
        // what was measured is used, so the clusters are named from the start
        // rather than by their words alone.
        let heard = if loaned.is_empty() { &measured.by_path } else { &*loaned };
        let fingerprints = app.embeddings.read().unwrap();
        let cal = search::Calibration::build(prints.by_path.values().copied());
        let pulse = search::NAMES.iter().position(|n| *n == "pulse").unwrap();
        let density = search::NAMES.iter().position(|n| *n == "density").unwrap();
        let bright = search::NAMES.iter().position(|n| *n == "brightness").unwrap();

        // Only what can be played. The index also lists what sits beside the
        // audio — Ableton's `.asd` analysis files, a Mac's `Icon_` and
        // `Desktop DB` — at no length at all, and a dot that plays nothing is
        // a lie.
        let mut files = Vec::new();
        let mut inputs = Vec::new();
        let mut key = std::collections::hash_map::DefaultHasher::new();
        let mut fingerprinted = 0usize;
        for f in idx.files.iter().filter(|f| f.duration > 0.0) {
            use std::hash::Hash;
            let path = format!("{}/{}", f.folder, f.rel_path);
            let fp = prints.get(&path);
            let labels: Vec<String> = heard
                .get(path.as_str())
                .map(|l| l.words.iter().take(3).map(|w| w.label.clone()).collect())
                .unwrap_or_default();
            let words: Vec<String> = fp.map(|p| p.descriptors(&cal).into_iter().map(|w| w.to_string()).collect()).unwrap_or_default();
            let embedding = fingerprints.get(&path).map(|e| search::soundmap::Embedding { scale: e.scale, bytes: e.bytes.clone() });
            path.hash(&mut key);
            embedding.is_some().hash(&mut key);
            fingerprinted += embedding.is_some() as usize;
            let family = search::map::family(labels.first().map(String::as_str).unwrap_or("")).to_string();
            files.push(
                Value::obj()
                    .set("path", path.clone())
                    .set("name", f.filename.clone())
                    .set("family", family.clone())
                    .set("words", Value::Arr(words.iter().map(|w| Value::Str(w.clone())).collect()))
                    .set("heard", Value::Arr(labels.iter().map(|w| Value::Str(w.clone())).collect()))
                    .set("seconds", f.duration)
                    .set("kind", f.category.clone())
                    .set("note", fp.and_then(|p| p.pitch.note()).map(Value::Str).unwrap_or(Value::Null))
                    // A sound that repeats steadily: drawn with a ring.
                    .set("loops", fp.is_some_and(|p| p.v[pulse] > 0.62 && p.v[density] > 0.2))
                    .set("bright", fp.map(|p| Value::Num(cal.rank(bright, p.v[bright]) as f64)).unwrap_or(Value::Null)),
            );
            inputs.push(search::soundmap::Input { embedding, heard: labels, family, words });
        }
        use std::hash::Hasher;
        (files, inputs, files_listening(&idx, &fingerprints), key.finish(), fingerprinted, !loaned.is_empty())
    };

    // Locks let go before the work, so the listening thread is never held up
    // by it.
    let cached = app.soundmap.read().unwrap().clone();
    let stale = match &cached {
        None => true,
        Some(c) if c.key == key => false,
        Some(c) => listening == 0 || named != c.named || fingerprinted >= c.heard + c.heard / 4 + 16,
    };
    let (map, current) = if stale {
        let m = std::sync::Arc::new(search::soundmap::build(&inputs));
        *app.soundmap.write().unwrap() = Some(crate::state::MapCache { key, heard: fingerprinted, named, map: m.clone() });
        (m, true)
    } else {
        let c = cached.unwrap();
        (c.map.clone(), c.key == key)
    };

    // A sound added since the map was worked out is not on it yet, and waits
    // with those still being listened to.
    let fits = map.points.len() == files.len();
    let sounds: Vec<Value> = files
        .into_iter()
        .enumerate()
        .map(|(i, o)| {
            let p = map.points.get(i).filter(|_| fits);
            o.set("at", p.and_then(|p| p.at).map(|a| Value::Arr(vec![Value::Num(a[0] as f64), Value::Num(a[1] as f64)])).unwrap_or(Value::Null))
                .set("cluster", p.and_then(|p| p.cluster).map(|c| Value::Num(c as f64)).unwrap_or(Value::Null))
                .set("near", Value::Arr(p.map(|p| p.near.iter().map(|n| Value::Num(*n as f64)).collect()).unwrap_or_default()))
        })
        .collect();
    let clusters: Vec<Value> = map
        .clusters
        .iter()
        .map(|c| {
            Value::obj()
                .set("name", c.name.clone())
                .set("family", c.family.clone())
                .set("size", c.members.len() as f64)
                .set("centre", Value::Arr(vec![Value::Num(c.centre[0] as f64), Value::Num(c.centre[1] as f64)]))
        })
        .collect();
    Response::json(
        Value::obj()
            .set("count", sounds.len() as f64)
            .set("listening", listening as f64)
            // False while sounds heard since are waiting for the next layout.
            .set("current", current)
            .set("sounds", Value::Arr(sounds))
            .set("clusters", Value::Arr(clusters))
            .to_string(),
    )
}

fn files_listening(idx: &crate::state::Index, fingerprints: &yamnet::embed::Embeddings) -> usize {
    idx.files
        .iter()
        .filter(|f| f.duration > 0.0 && !fingerprints.has(&format!("{}/{}", f.folder, f.rel_path)))
        .count()
}

/// A sound's closest matches on the map, best first: `?i=` is its place in the
/// map's list. Asked for when a sound is pointed at, because for a large
/// library working them out for every sound up front is minutes of work.
pub(super) fn api_soundmap_near(app: &Arc<App>, req: &Request) -> Response {
    let Some(i) = req.param("i").and_then(|v| v.parse::<usize>().ok()) else {
        return Response::error(400, "no sound given");
    };
    let Some(c) = app.soundmap.read().unwrap().clone() else {
        return Response::error(404, "no map yet");
    };
    let near = c.map.nearest(i, search::soundmap::NEAR);
    Response::json(Value::obj().set("i", i as f64).set("near", Value::Arr(near.into_iter().map(|n| Value::Num(n as f64)).collect())).to_string())
}
