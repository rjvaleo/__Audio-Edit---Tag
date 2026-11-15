//! The Stems page: split a song, read what is in it, teach the Band, and make
//! sounds from the stems.
//!
//! Stems go into the library, `Stems/<song>/drums.wav` and so on, beside an
//! analysis (`songprint.json`, `summary.md`, `card.json`) and `stems.json`
//! (where it came from). Sounds made from them go to `Made/<kind>/`. Tries
//! (cut but not kept) sit in the song's hidden `.tries/` folder.

use super::*;
use crate::stems::{self, StemsJob};
use songprint::sound;

fn job(app: &Arc<App>) -> &StemsJob {
    &app.stems
}

fn body(req: &Request) -> Option<Value> {
    json::parse(&String::from_utf8_lossy(&req.body))
}

fn learn_dir(app: &Arc<App>) -> PathBuf {
    app.data_dir.join("BAND-LEARN")
}

/// `Stems/<name>` from a request, checked to be a song folder in the library.
fn song_dir(app: &Arc<App>, rel: &str) -> Result<(PathBuf, PathBuf, String), Response> {
    let Some(lib) = app.library_path() else { return Err(Response::error(400, "no library chosen")) };
    if !rel.starts_with("Stems/") {
        return Err(Response::error(400, "not a stems folder"));
    }
    let Some(dir) = resolve_within(&lib, rel) else { return Err(Response::error(404, "no such stems folder")) };
    if !dir.is_dir() {
        return Err(Response::error(404, "no such stems folder"));
    }
    let name = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    Ok((lib, dir, name))
}

pub(super) fn api_stems_status(app: &Arc<App>) -> Response {
    let j = job(app);
    let exe = stems::demucs_path();
    let gpu = crate::gpu::config(&app.data_dir);
    let models: Vec<Value> = stems::MODELS.iter().map(|(id, label)| Value::obj().set("id", *id).set("label", *label)).collect();
    Response::json(
        Value::obj()
            .set("running", j.running.load(Ordering::Relaxed))
            .set("progress", j.progress.load(Ordering::Relaxed) as f64 / 1000.0)
            .set("phase", stems::get(&j.phase))
            .set("song", stems::get(&j.song))
            .set("source", stems::get(&j.source))
            .set("error", stems::get(&j.error))
            .set("serial", j.serial.load(Ordering::Relaxed))
            .set("elapsed", j.elapsed())
            .set("tookMs", j.took_ms.load(Ordering::Relaxed))
            .set("arrived", j.arrived.lock().unwrap().clone())
            .set("incoming", {
                let inc = j.incoming.lock().unwrap();
                let mut o = Value::obj();
                for (stem, total, part) in inc.iter() {
                    // No part file any more: it has landed and is being unpacked.
                    let f = match std::fs::metadata(part) {
                        Ok(m) if *total > 0 => (m.len() as f64 / *total as f64).min(1.0),
                        Ok(_) => 0.0,
                        Err(_) => 1.0,
                    };
                    o = o.set(stem, f);
                }
                o
            })
            .set("helper", exe.is_some() || gpu.is_some())
            .set("gpu", gpu.map(|g| g.host))
            .set("helperPath", exe.map(|p| p.display().to_string()))
            .set("models", models)
            .to_string(),
    )
}

pub(super) fn api_stems_stop(app: &Arc<App>) -> Response {
    job(app).say("stopping");
    job(app).stop();
    Response::json(Value::obj().set("ok", true).to_string())
}

/// POST {p, model}: split a library file. Answers at once; poll `/api/stems`.
/// The kinds of sound file a song may arrive as from the computer.
const UPLOAD_KINDS: [&str; 9] = ["wav", "wave", "aif", "aiff", "aifc", "flac", "mp3", "m4a", "ogg"];

/// A song from anywhere on the computer, for the split (RJ, 14 Nov 2026:
/// "either pull from the library or just open the regular file load dialog").
/// The browser's own Open dialog sends the file's bytes; they are kept in the
/// library's `Imports/` under a name nothing is using yet, so the split reads
/// it from the library as it reads any other song, and it is there afterwards.
pub(super) fn api_stems_upload(app: &Arc<App>, req: &Request) -> Response {
    let Some(lib) = app.library_path() else { return Response::error(400, "no library chosen") };
    if req.body.is_empty() {
        return Response::error(400, "no file sent");
    }
    let name = crate::docs::safe_name(req.param("name").unwrap_or("song"));
    let ext = std::path::Path::new(&name).extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    if !UPLOAD_KINDS.contains(&ext.as_str()) {
        return Response::error(400, "not a sound file the splitter reads (WAV, AIFF, FLAC, MP3, M4A or Ogg)");
    }
    let _ = std::fs::create_dir_all(lib.join("Imports"));
    let Some(dest) = resolve_for_write(&lib, &format!("Imports/{name}")) else { return Response::error(400, "cannot write there") };
    let dest = crate::docs::unique(dest);
    if let Err(e) = std::fs::write(&dest, &req.body) {
        return Response::error(500, &format!("could not keep the file: {e}"));
    }
    let file = dest.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    Response::json(Value::obj().set("p", format!("Imports/{file}")).set("name", file).to_string())
}

pub(super) fn api_stems_split(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = body(req) else { return Response::error(400, "invalid JSON") };
    let Some(rel) = v.get("p").and_then(|p| p.as_str()).map(str::to_string) else { return Response::error(400, "no file given") };
    let model = v.get("model").and_then(|m| m.as_str()).unwrap_or("htdemucs").to_string();
    if !stems::MODELS.iter().any(|(id, _)| *id == model) {
        return Response::error(400, "unknown model");
    }
    let Some(lib) = app.library_path() else { return Response::error(400, "no library chosen") };
    let Some(src) = resolve_within(&lib, &rel) else { return Response::error(404, "no such file in the library") };
    // The GPU machine when there is one; else the helper on this one.
    let gpu = crate::gpu::config(&app.data_dir);
    let exe = stems::demucs_path();
    if gpu.is_none() && exe.is_none() {
        return Response::error(503, "the stem splitter (demucs) is not installed: put it in the models folder, set AUDIOLAB_DEMUCS, or name a GPU machine (AUDIOLAB_GPU_HOST)");
    }
    let name = crate::docs::safe_name(&stems::song_name(&src));
    if name.is_empty() {
        return Response::error(400, "no name for that file");
    }
    let song_rel = format!("Stems/{name}");
    let Some(out) = resolve_for_write(&lib, &song_rel).or_else(|| {
        let _ = std::fs::create_dir_all(lib.join("Stems"));
        resolve_for_write(&lib, &song_rel)
    }) else {
        return Response::error(400, "cannot write there");
    };
    if job(app).running.swap(true, Ordering::SeqCst) {
        return Response::error(409, "a split is already running");
    }
    job(app).begin(&rel, &song_rel);
    let app2 = Arc::clone(app);
    std::thread::spawn(move || {
        let j = job(&app2);
        let t0 = std::time::Instant::now();
        let outcome = (|| -> Result<(), String> {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            match (&gpu, &exe) {
                (Some(g), _) => stems::separate_remote(j, g, &src, &out, &model, 0.85)?,
                (None, Some(e)) => stems::separate(j, e, &src, &out, &model, 0.85)?,
                (None, None) => return Err("no splitter".into()),
            };
            let secs = t0.elapsed().as_secs_f64();
            let meta = Value::obj()
                .set("source", rel.clone())
                .set("model", model.clone())
                .set("where", gpu.as_ref().map_or("this machine".to_string(), |g| g.host.clone()))
                .set("splitSeconds", (secs * 10.0).round() / 10.0)
                .set("made", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0));
            std::fs::write(out.join("stems.json"), meta.to_string()).map_err(|e| e.to_string())?;
            j.say("reading what is in it");
            j.set_progress(0.88);
            analyse_into(&src, &out, &name, &|m: &str| j.say(m))?;
            Ok(())
        })();
        match outcome {
            Ok(()) => {
                j.set_progress(1.0);
                j.say("done");
            }
            Err(e) => {
                j.fail(&e);
                j.say(if j.cancel.load(Ordering::SeqCst) { "stopped" } else { "failed" });
            }
        }
        reindex_for(&app2, "Stems/");
        j.took_ms.store(t0.elapsed().as_millis() as u64, Ordering::Relaxed);
        j.serial.fetch_add(1, Ordering::Relaxed);
        j.running.store(false, Ordering::SeqCst);
    });
    Response::json(Value::obj().set("ok", true).set("song", song_rel).to_string())
}

/// Read the stems and write `songprint.json`, `summary.md` and a small `card.json`.
fn analyse_into(src: &Path, out: &Path, title: &str, say: &dyn Fn(&str)) -> Result<(), String> {
    let mut log = |m: &str| say(m);
    let r = songprint::analyse(title, src, out, &mut log)?;
    let text = r.json.to_string_pretty();
    std::fs::write(out.join("songprint.json"), &text).map_err(|e| e.to_string())?;
    std::fs::write(out.join("summary.md"), &r.summary).map_err(|e| e.to_string())?;
    let v = json::parse(&text).unwrap_or(Value::Null);
    let num = |a: &Value, k: &str| match a.get(k) {
        Some(Value::Num(n)) => *n,
        _ => 0.0,
    };
    let tempo = v.get("tempo").map(|t| num(t, "bpm")).unwrap_or(0.0);
    let key = v.get("key").and_then(|k| k.get("name")).and_then(|n| n.as_str()).unwrap_or("").to_string();
    let card = Value::obj()
        .set("bpm", tempo)
        .set("key", key)
        .set("bars", num(&v, "bar_count"))
        .set("seconds", num(&v, "duration_s"))
        .set("sections", v.get("sections").and_then(|s| s.arr()).map_or(0, |a| a.len()));
    std::fs::write(out.join("card.json"), card.to_string()).map_err(|e| e.to_string())
}

/// POST {p}: read a split song again (after the analysis has improved), without
/// splitting it again. Takes a few seconds a minute of song.
pub(super) fn api_stems_analyse(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = body(req) else { return Response::error(400, "invalid JSON") };
    let (lib, dir, name) = match song_dir(app, v.get("p").and_then(|p| p.as_str()).unwrap_or("")) {
        Ok(x) => x,
        Err(r) => return r,
    };
    let meta = std::fs::read_to_string(dir.join("stems.json")).ok().and_then(|t| json::parse(&t)).unwrap_or(Value::Null);
    let Some(src) = meta.get("source").and_then(|s| s.as_str()).and_then(|s| resolve_within(&lib, s)) else {
        return Response::error(404, "the song this was split from is not in the library any more");
    };
    match analyse_into(&src, &dir, &name, &|_| {}) {
        Ok(()) => Response::json(Value::obj().set("ok", true).to_string()),
        Err(e) => Response::error(500, &e),
    }
}

/// GET: every split song.
pub(super) fn api_stems_list(app: &Arc<App>) -> Response {
    let Some(lib) = app.library_path() else { return Response::json("[]".into()) };
    let mut rows = Vec::new();
    if let Ok(rd) = std::fs::read_dir(lib.join("Stems")) {
        let mut dirs: Vec<PathBuf> = rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_dir() && p.join("drums.wav").is_file()).collect();
        dirs.sort_by_key(|p| std::fs::metadata(p.join("drums.wav")).and_then(|m| m.modified()).ok());
        dirs.reverse();
        for d in dirs {
            let name = d.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let read = |f: &str| std::fs::read_to_string(d.join(f)).ok().and_then(|t| json::parse(&t)).unwrap_or(Value::Null);
            rows.push(
                Value::obj()
                    .set("p", format!("Stems/{name}"))
                    .set("name", name.clone())
                    .set("meta", read("stems.json"))
                    .set("card", read("card.json"))
                    .set("analysed", d.join("songprint.json").is_file())
                    .set("learnt", learn_dir(app).join(format!("{name}.json")).is_file()),
            );
        }
    }
    Response::json(Value::Arr(rows).to_string())
}

/// GET ?p=Stems/<song>: its files, where it came from, and the whole analysis.
pub(super) fn api_stems_info(app: &Arc<App>, req: &Request) -> Response {
    let (_, dir, name) = match song_dir(app, req.param("p").unwrap_or("")) {
        Ok(x) => x,
        Err(r) => return r,
    };
    let analysis = std::fs::read_to_string(dir.join("songprint.json")).unwrap_or_else(|_| "null".into());
    let meta = std::fs::read_to_string(dir.join("stems.json")).unwrap_or_else(|_| "null".into());
    let files: Vec<Value> = stems::STEMS
        .iter()
        .chain(["guitar", "piano"].iter())
        .filter(|s| dir.join(format!("{s}.wav")).is_file())
        .map(|s| Value::obj().set("stem", *s).set("p", format!("Stems/{name}/{s}.wav")))
        .collect();
    let learnt = learn_dir(app).join(format!("{name}.json")).is_file();
    Response::json(format!(
        "{{\"p\":{},\"name\":{},\"learnt\":{},\"files\":{},\"meta\":{},\"analysis\":{}}}",
        Value::from(format!("Stems/{name}")).to_string(),
        Value::from(name.clone()).to_string(),
        learnt,
        Value::Arr(files).to_string(),
        meta,
        analysis
    ))
}

/// POST {p, gains: [drums, bass, vocals, other]}: the stems summed at those
/// levels into the song's hidden `.mix.wav`, to play with some muted or soloed.
pub(super) fn api_stems_mix(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = body(req) else { return Response::error(400, "invalid JSON") };
    let (_, dir, name) = match song_dir(app, v.get("p").and_then(|p| p.as_str()).unwrap_or("")) {
        Ok(x) => x,
        Err(r) => return r,
    };
    let gains: Vec<f32> = v.get("gains").and_then(|g| g.arr()).map(|a| a.iter().map(|x| if let Value::Num(n) = x { *n as f32 } else { 0.0 }).collect()).unwrap_or_default();
    let mut mix: Option<sound::Sound> = None;
    for (i, s) in stems::STEMS.iter().enumerate() {
        let g = gains.get(i).copied().unwrap_or(1.0);
        let path = dir.join(format!("{s}.wav"));
        let Ok(snd) = sound::read_span(&path, 0.0, 1e6) else { continue };
        match mix.as_mut() {
            None => mix = Some(sound::Sound { rate: snd.rate, channels: snd.channels, x: snd.x.iter().map(|x| x * g).collect() }),
            Some(m) => {
                for (a, b) in m.x.iter_mut().zip(&snd.x) {
                    *a += b * g;
                }
            }
        }
    }
    let Some(m) = mix else { return Response::error(404, "no stems to mix") };
    if let Err(e) = sound::write_wav(&dir.join(".mix.wav"), &m) {
        return Response::error(500, &e.to_string());
    }
    Response::json(Value::obj().set("p", format!("Stems/{name}/.mix.wav")).to_string())
}

/// POST {p}: give the Seq page's Band this song to learn from (its analysis,
/// copied into the app's data). {p, forget: true} takes it back.
pub(super) fn api_stems_learn(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = body(req) else { return Response::error(400, "invalid JSON") };
    let (_, dir, name) = match song_dir(app, v.get("p").and_then(|p| p.as_str()).unwrap_or("")) {
        Ok(x) => x,
        Err(r) => return r,
    };
    let to = learn_dir(app).join(format!("{name}.json"));
    if matches!(v.get("forget"), Some(Value::Bool(true))) {
        let _ = std::fs::remove_file(&to);
    } else {
        let _ = std::fs::create_dir_all(learn_dir(app));
        if let Err(e) = std::fs::copy(dir.join("songprint.json"), &to) {
            return Response::error(500, &format!("not analysed yet: {e}"));
        }
    }
    let n = std::fs::read_dir(learn_dir(app)).map(|r| r.filter_map(|e| e.ok()).filter(|e| e.path().extension().is_some_and(|x| x == "json")).count()).unwrap_or(0);
    Response::json(Value::obj().set("learnt", to.is_file()).set("songs", n).to_string())
}

/// POST {p, kind: "drums" | "bass", per}: cut tries from a song's stems into its
/// `.tries/` folder. Drums: the clearest kicks, snares and hats. Bass: the
/// longest clean notes, one per pitch.
pub(super) fn api_stems_tries(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = body(req) else { return Response::error(400, "invalid JSON") };
    let (_, dir, name) = match song_dir(app, v.get("p").and_then(|p| p.as_str()).unwrap_or("")) {
        Ok(x) => x,
        Err(r) => return r,
    };
    let kind = v.get("kind").and_then(|k| k.as_str()).unwrap_or("drums").to_string();
    let per = match v.get("per") {
        Some(Value::Num(n)) => (*n as usize).clamp(1, 16),
        _ => 4,
    };
    let tries = dir.join(".tries");
    let _ = std::fs::remove_dir_all(&tries);
    if let Err(e) = std::fs::create_dir_all(&tries) {
        return Response::error(500, &e.to_string());
    }
    let mut out = Vec::new();
    let mut put = |label: String, snd: sound::Sound, t: f32, group: &str| {
        let c = sound::clean(&snd, &sound::Clean::default());
        let file = format!("{} {:02}.wav", group, out.len() + 1);
        if sound::write_wav(&tries.join(&file), &c).is_ok() {
            out.push(
                Value::obj()
                    .set("p", format!("Stems/{name}/.tries/{file}"))
                    .set("label", label)
                    .set("group", group.to_string())
                    .set("t", (t as f64 * 100.0).round() / 100.0)
                    .set("seconds", (c.seconds() as f64 * 1000.0).round() / 1000.0),
            );
        }
    };
    if kind == "drums" {
        let drums = dir.join("drums.wav");
        let hits = match sound::find_hits(&drums, per, 2.0) {
            Ok(h) => h,
            Err(e) => return Response::error(500, &e),
        };
        for h in hits {
            if let Ok(s) = sound::cut(&drums, h.t, h.len + 0.018) {
                put(format!("{} at {}:{:04.1}", h.kind.name(), (h.t / 60.0) as u32, h.t % 60.0), s, h.t, h.kind.name());
            }
        }
    } else {
        // Bass notes from the analysis: time from the beat grid, the longest per pitch.
        let Some(a) = std::fs::read_to_string(dir.join("songprint.json")).ok().and_then(|t| json::parse(&t)) else {
            return Response::error(400, "not analysed yet");
        };
        let beats: Vec<f64> = a.get("beats_s").and_then(|b| b.arr()).map(|b| b.iter().filter_map(|x| if let Value::Num(n) = x { Some(*n) } else { None }).collect()).unwrap_or_default();
        let o = match a.get("downbeat_beat") {
            Some(Value::Num(n)) => *n as usize,
            _ => 0,
        };
        let step_t = |bar: usize, step: usize| -> Option<(f64, f64)> {
            let i = o + 4 * bar + step / 4;
            let (b0, b1) = (*beats.get(i)?, *beats.get(i + 1)?);
            Some((b0 + (b1 - b0) * (step % 4) as f64 / 4.0, (b1 - b0) / 4.0))
        };
        let notes = a.get("bass").and_then(|b| b.get("notes")).and_then(|n| n.arr()).map(|n| n.to_vec()).unwrap_or_default();
        let mut best: std::collections::BTreeMap<i32, (f64, f64, f64)> = Default::default(); // midi -> (len_s, t, vel)
        for n in &notes {
            let Some(f) = n.arr() else { continue };
            let g = |i: usize| if let Some(Value::Num(x)) = f.get(i) { *x } else { 0.0 };
            let (bar, step, len, midi, vel) = (g(0) as usize, g(1) as usize, g(2), g(3), g(4));
            if len < 2.0 || vel < 0.3 {
                continue;
            }
            let Some((t, sd)) = step_t(bar, step) else { continue };
            let secs = (len * sd).min(2.0);
            let e = best.entry(midi.round() as i32).or_insert((0.0, 0.0, 0.0));
            if secs * vel > e.0 * e.2 {
                *e = (secs, t, vel);
            }
        }
        let mut picks: Vec<(i32, (f64, f64, f64))> = best.into_iter().collect();
        picks.sort_by(|a, b| (b.1 .0 * b.1 .2).total_cmp(&(a.1 .0 * a.1 .2)));
        picks.truncate(per * 2);
        picks.sort_by_key(|p| p.0);
        let bass = dir.join("bass.wav");
        for (midi, (secs, t, _)) in picks {
            let nm = format!("{}{}", songprint::pitch::NAMES[midi.rem_euclid(12) as usize], midi / 12 - 1);
            if let Ok(s) = sound::read_span(&bass, t as f32 - 0.01, (t + secs + 0.15) as f32) {
                put(format!("bass {nm}"), s, t as f32, &format!("bass {nm}"));
            }
        }
    }
    Response::json(Value::Arr(out).to_string())
}

/// POST {prompt, seconds, n, seed}: sounds from words, made by Stable Audio
/// Open Small on the GPU machine, brought back into `Made/.words/` as tries.
/// The first request loads the model there (a minute or less); later ones take
/// a fraction of a second a sound.
pub(super) fn api_stems_words(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = body(req) else { return Response::error(400, "invalid JSON") };
    let Some(gpu) = crate::gpu::config(&app.data_dir) else {
        return Response::error(503, "sounds from words need the GPU machine: set AUDIOLAB_GPU_HOST, or GPU.json in the data folder");
    };
    let Some(lib) = app.library_path() else { return Response::error(400, "no library chosen") };
    let prompt: String = v.get("prompt").and_then(|p| p.as_str()).unwrap_or("").chars().filter(|c| !c.is_control()).take(300).collect();
    if prompt.trim().is_empty() {
        return Response::error(400, "say what to make");
    }
    let num = |k: &str, d: f64| match v.get(k) {
        Some(Value::Num(n)) => *n,
        _ => d,
    };
    // Each maker's own longest: Small 11 s, TangoFlux 30 s, ACE-Step 10 minutes.
    let longest = match v.get("model").and_then(|m| m.as_str()) { Some("tangoflux") => 30.0, Some("acestep") => 600.0, _ => 11.0 };
    let seconds = num("seconds", 2.0).clamp(0.5, longest);
    let n = num("n", 4.0).clamp(1.0, 8.0) as u32;
    let seed = num("seed", (std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(1) % 100_000) as f64) as u64;
    let id = format!("w{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
    let model = v.get("model").and_then(|m| m.as_str()).unwrap_or("sao").to_string();
    if crate::gpu::maker(&model).is_none() {
        return Response::error(400, "no such sound maker");
    }
    let req = Value::obj().set("prompt", prompt.clone()).set("seconds", seconds).set("n", n).set("seed", seed as f64).set("model", model.clone());
    let made = match crate::gpu::words(&gpu, &id, req) {
        Ok(m) => m,
        Err(e) => return Response::error(502, &e),
    };
    let dir = lib.join("Made").join(".words");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return Response::error(500, &e.to_string());
    }
    let pairs: Vec<(String, PathBuf)> = made.iter().map(|m| (m.remote.clone(), dir.join(format!("{id}-{}.wav", m.seed)))).collect();
    if let Err(e) = gpu.get_many(&pairs) {
        return Response::error(502, &e);
    }
    let _ = gpu.ps(&format!("Remove-Item -Recurse -Force '{}'", crate::gpu::win(&crate::gpu::tries_dir(&gpu, &model, &id))));
    let short: String = prompt.chars().take(40).collect();
    let rows: Vec<Value> = made
        .iter()
        .map(|m| {
            Value::obj()
                .set("p", format!("Made/.words/{id}-{}.wav", m.seed))
                .set("label", format!("{short} · {}", m.seed))
                .set("group", "words")
                .set("seed", m.seed as f64)
                .set("seconds", m.seconds)
        })
        .collect();
    Response::json(Value::Arr(rows).to_string())
}

/// POST {p, n, nearFar, prompt, seed}: variations of a sound in the library.
/// The sound goes to the GPU machine as the guide; Stable Audio Open Small
/// makes `n` new takes of it, spread from a little closer to a little further
/// than `nearFar` (0 close .. 1 far). Tries come back into `Made/.words/`.
pub(super) fn api_stems_vary(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = body(req) else { return Response::error(400, "invalid JSON") };
    let Some(gpu) = crate::gpu::config(&app.data_dir) else {
        return Response::error(503, "variations need the GPU machine: set AUDIOLAB_GPU_HOST, or GPU.json in the data folder");
    };
    let Some(lib) = app.library_path() else { return Response::error(400, "no library chosen") };
    let rel = v.get("p").and_then(|p| p.as_str()).unwrap_or("").to_string();
    let Some(src) = resolve_within(&lib, &rel) else { return Response::error(404, "no such sound in the library") };
    let num = |k: &str, d: f64| match v.get(k) {
        Some(Value::Num(n)) => *n,
        _ => d,
    };
    let n = num("n", 6.0).clamp(1.0, 12.0) as usize;
    let u = num("nearFar", 0.5).clamp(0.0, 1.0);
    // The page's 0..1 onto the model's useful strengths: below 0.25 it hardly
    // changes, at 0.95 it barely listens to the guide.
    let centre = 0.25 + 0.7 * u;
    let (lo, hi) = ((centre - 0.15).max(0.2), (centre + 0.15).min(0.97));
    let levels: Vec<f64> = (0..n).map(|i| if n == 1 { centre } else { lo + (hi - lo) * i as f64 / (n - 1) as f64 }).map(|l| (l * 100.0).round() / 100.0).collect();
    let seed = num("seed", (std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(1) % 100_000) as f64) as u64;
    let name = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let prompt: String = v.get("prompt").and_then(|p| p.as_str()).map(str::to_string).filter(|p| !p.trim().is_empty()).unwrap_or_else(|| name.replace(['_', '-'], " ")).chars().filter(|c| !c.is_control()).take(300).collect();
    let id = format!("v{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
    let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| "wav".into());
    let guide = format!("{}/sao/guides/{id}.{ext}", gpu.dir);
    if let Err(e) = gpu.ps(&format!("New-Item -ItemType Directory -Force -Path '{}' | Out-Null", crate::gpu::win(&format!("{}/sao/guides", gpu.dir)))).and_then(|_| gpu.put(&src, &guide)) {
        return Response::error(502, &e);
    }
    let req = Value::obj()
        .set("prompt", prompt.clone())
        .set("n", n)
        .set("seed", seed as f64)
        .set("init", crate::gpu::win(&guide))
        .set("levels", Value::Arr(levels.iter().map(|l| Value::from(*l)).collect()));
    let made = crate::gpu::words(&gpu, &id, req);
    let _ = gpu.ps(&format!("Remove-Item -Force '{}' -ErrorAction SilentlyContinue", crate::gpu::win(&guide)));
    let made = match made {
        Ok(m) => m,
        Err(e) => return Response::error(502, &e),
    };
    let dir = lib.join("Made").join(".words");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return Response::error(500, &e.to_string());
    }
    let pairs: Vec<(String, PathBuf)> = made.iter().enumerate().map(|(i, m)| (m.remote.clone(), dir.join(format!("{id}-{i:02}.wav")))).collect();
    if let Err(e) = gpu.get_many(&pairs) {
        return Response::error(502, &e);
    }
    let _ = gpu.ps(&format!("Remove-Item -Recurse -Force '{}'", crate::gpu::win(&format!("{}/sao/tries/mgl/{id}", gpu.dir))));
    let words = |l: f64| if l < 0.4 { "close" } else if l < 0.6 { "near" } else if l < 0.8 { "further" } else { "far" };
    let rows: Vec<Value> = made
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let l = m.near_far.unwrap_or(centre);
            Value::obj()
                .set("p", format!("Made/.words/{id}-{i:02}.wav"))
                .set("label", format!("{name} · {} {:.2}", words(l), l))
                .set("group", "vary")
                .set("seed", m.seed as f64)
                .set("nearFar", l)
                .set("seconds", m.seconds)
        })
        .collect();
    Response::json(Value::Arr(rows).to_string())
}

/// Send `guides` (library files) to the GPU machine, run `req` (built from
/// their paths there), bring the tries back as `Made/.words/<id>-NN.wav`, and
/// tidy up there. Each try comes back with its made record and library path.
fn gpu_tries(gpu: &crate::gpu::Gpu, lib: &Path, id: &str, model: &str, guides: &[PathBuf], req: impl FnOnce(Vec<String>) -> Value) -> Result<Vec<(crate::gpu::Made, String)>, Response> {
    let gdir = format!("{}/sao/guides", gpu.dir);
    gpu.ps(&format!("New-Item -ItemType Directory -Force -Path '{}' | Out-Null", crate::gpu::win(&gdir))).map_err(|e| Response::error(502, &e))?;
    let mut there = Vec::new();
    for (k, g) in guides.iter().enumerate() {
        let ext = g.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| "wav".into());
        let remote = format!("{gdir}/{id}-{k}.{ext}");
        gpu.put(g, &remote).map_err(|e| Response::error(502, &e))?;
        there.push(remote);
    }
    let made = crate::gpu::words(gpu, id, req(there.iter().map(|p| crate::gpu::win(p)).collect()).set("model", model));
    for p in &there {
        let _ = gpu.ps(&format!("Remove-Item -Force '{}' -ErrorAction SilentlyContinue", crate::gpu::win(p)));
    }
    let made = made.map_err(|e| Response::error(502, &e))?;
    let dir = lib.join("Made").join(".words");
    std::fs::create_dir_all(&dir).map_err(|e| Response::error(500, &e.to_string()))?;
    let pairs: Vec<(String, PathBuf)> = made.iter().enumerate().map(|(i, m)| (m.remote.clone(), dir.join(format!("{id}-{i:02}.wav")))).collect();
    gpu.get_many(&pairs).map_err(|e| Response::error(502, &e))?;
    let _ = gpu.ps(&format!("Remove-Item -Recurse -Force '{}'", crate::gpu::win(&crate::gpu::tries_dir(gpu, model, id))));
    Ok(made.into_iter().enumerate().map(|(i, m)| (m, format!("Made/.words/{id}-{i:02}.wav"))).collect())
}

fn job_id(tag: &str) -> String {
    format!("{tag}{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0))
}

/// POST {a, b, n, wander, prompt}: blend two library sounds. Both go into the
/// model's own sound space on the GPU machine, and `n` sounds come back from A
/// to B. `wander` (0..1) lets the model re-make each in-between, that loosely.
pub(super) fn api_stems_blend(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = body(req) else { return Response::error(400, "invalid JSON") };
    let Some(gpu) = crate::gpu::config(&app.data_dir) else { return Response::error(503, "blending needs the GPU machine: set AUDIOLAB_GPU_HOST") };
    let Some(lib) = app.library_path() else { return Response::error(400, "no library chosen") };
    let find = |k: &str| v.get(k).and_then(|p| p.as_str()).and_then(|p| resolve_within(&lib, p).map(|f| (p.to_string(), f)));
    let (Some((_, a)), Some((_, b))) = (find("a"), find("b")) else { return Response::error(404, "pick two sounds in the library") };
    let num = |k: &str, d: f64| match v.get(k) {
        Some(Value::Num(n)) => *n,
        _ => d,
    };
    let n = num("n", 7.0).clamp(3.0, 12.0) as usize;
    let wander = num("wander", 0.0).clamp(0.0, 1.0);
    let prompt: String = v.get("prompt").and_then(|p| p.as_str()).unwrap_or("").chars().filter(|c| !c.is_control()).take(300).collect();
    let id = job_id("b");
    let made = match gpu_tries(&gpu, &lib, &id, "sao", &[a.clone(), b.clone()], |g| {
        Value::obj().set("blend", Value::Arr(g.into_iter().map(Value::from).collect())).set("n", n).set("wander", wander).set("prompt", prompt.clone()).set("seed", 1.0)
    }) {
        Ok(m) => m,
        Err(r) => return r,
    };
    let name = |p: &Path| p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let (na, nb) = (name(&a), name(&b));
    let rows: Vec<Value> = made
        .iter()
        .enumerate()
        .map(|(i, (m, p))| {
            let label = if i == 0 { format!("A · {na}") } else if i + 1 == made.len() { format!("B · {nb}") } else { format!("{i}/{} · {na} → {nb}", made.len() - 1) };
            Value::obj().set("p", p.clone()).set("label", label).set("group", "blend").set("seconds", m.seconds).set("t", i as f64 / (made.len().max(2) - 1) as f64)
        })
        .collect();
    Response::json(Value::Arr(rows).to_string())
}

/// The parts a kit can be made of: name, words for the model, for a tuned part
/// (interval above the key, lowest octave, highest octave), and how long it is.
const KIT_PARTS: [(&str, &str, &str, Option<(i32, i32, i32)>, f32); 9] = [
    ("hat", "CLOSED HAT", "closed hi-hat", None, 0.5),
    ("ohat", "OPEN HAT", "open hi-hat", None, 1.2),
    ("shaker", "SHAKER", "shaker", None, 0.8),
    ("rim", "RIM", "rimshot", None, 0.6),
    ("clap", "CLAP", "clap", None, 0.9),
    ("tomlo", "LOW TOM", "low tom drum", Some((0, 2, 3)), 1.2),
    ("tommid", "MID TOM", "mid tom drum", Some((7, 3, 4)), 1.0),
    ("conga", "CONGA", "conga drum", Some((12, 3, 4)), 0.9),
    ("bass", "BASS NOTE", "deep sub bass note", Some((0, 1, 2)), 2.0),
];

/// POST {picks: [p, …], parts: [key, …], style, key?}: a kit around the picks.
/// The picks are measured here (pitch, decay, brightness); each part is made on
/// the GPU machine from words that carry those, guided loosely by the first
/// pick; tuned parts (toms, conga, bass note) are retuned here to the picks' key.
pub(super) fn api_stems_kit(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = body(req) else { return Response::error(400, "invalid JSON") };
    let Some(gpu) = crate::gpu::config(&app.data_dir) else { return Response::error(503, "a kit needs the GPU machine: set AUDIOLAB_GPU_HOST") };
    let Some(lib) = app.library_path() else { return Response::error(400, "no library chosen") };
    let picks: Vec<PathBuf> = v.get("picks").and_then(|a| a.arr()).map(|a| a.iter().filter_map(|p| p.as_str()).filter_map(|p| resolve_within(&lib, p)).collect()).unwrap_or_default();
    if picks.is_empty() {
        return Response::error(400, "pick a sound or two first");
    }
    let keys: Vec<String> = v.get("parts").and_then(|a| a.arr()).map(|a| a.iter().filter_map(|p| p.as_str()).map(str::to_string).collect()).unwrap_or_default();
    let parts: Vec<_> = KIT_PARTS.iter().filter(|p| keys.is_empty() || keys.iter().any(|k| k == p.0)).collect();
    if parts.is_empty() {
        return Response::error(400, "choose at least one part");
    }
    // What the picks are like.
    let chars: Vec<songprint::sound::Character> = picks.iter().filter_map(|p| sound::read_span(p, 0.0, 3.0).ok()).map(|s| songprint::sound::character(&s)).collect();
    let key_pc = match v.get("key") {
        Some(Value::Num(n)) => Some(*n as i32),
        _ => chars.iter().find_map(|c| c.pitch).map(|m| (m.round() as i32).rem_euclid(12)),
    };
    let decay = chars.iter().map(|c| c.decay).sum::<f32>() / chars.len().max(1) as f32;
    let zcr = chars.iter().map(|c| c.zcr).sum::<f32>() / chars.len().max(1) as f32;
    let length = if decay < 0.2 { "short, tight" } else if decay > 0.6 { "long, ringing" } else { "medium decay" };
    let tone = if zcr < 1500.0 { "dark, warm" } else if zcr > 5000.0 { "bright, crisp" } else { "" };
    let style: String = v.get("style").and_then(|p| p.as_str()).unwrap_or("").chars().filter(|c| !c.is_control()).take(120).collect();
    let words = |w: &str| [w, length, tone, style.as_str(), "one shot"].iter().filter(|x| !x.is_empty()).cloned().collect::<Vec<_>>().join(", ");
    let prompts: Vec<String> = parts.iter().map(|p| words(p.2)).collect();
    let secs = parts.iter().map(|p| p.4).fold(0.5f32, f32::max);
    let id = job_id("k");
    // Stable Audio Open Small: the only maker that takes a prompt per try.
    let made = match gpu_tries(&gpu, &lib, &id, "sao", &[], |_| {
        Value::obj().set("prompts", Value::Arr(prompts.iter().cloned().map(Value::from).collect())).set("n", parts.len()).set("seconds", secs as f64).set("seed", (std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(1) % 100_000) as f64)
    }) {
        Ok(m) => m,
        Err(r) => return r,
    };
    let mut rows = Vec::new();
    for ((m, p), part) in made.iter().zip(&parts) {
        let file = lib.join(p);
        let mut label = part.1.to_string();
        let mut note = Value::Null;
        if let Ok(mut s) = sound::read_span(&file, 0.0, part.4 + 0.3) {
            // Each part trimmed to its own length.
            let keep = ((part.4 * s.rate as f32) as usize).min(s.frames()) * s.channels;
            s.x.truncate(keep);
            if let (Some((iv, lo, hi)), Some(pc)) = (part.3, key_pc) {
                if let Some(now) = songprint::sound::pitch_of(&s) {
                    // Only the note's name is set, never more than six semitones: a
                    // low drum's pitch is often read an octave or more out, and a
                    // bigger move sounds sped up. The octave named is the part's own.
                    let want = (pc + iv).rem_euclid(12) as f32;
                    let d = (want - now).rem_euclid(12.0);
                    let d = if d > 6.0 { d - 12.0 } else { d };
                    let t = now + d;
                    let shown = ((pc + iv).rem_euclid(12) + 12 * (lo + 1)) as f32;
                    let _ = hi;
                    s = songprint::sound::shift(&s, t - now);
                    let n = shown.round() as i32;
                    label = format!("{label} · {}{} · tuned {:+.1} st", songprint::pitch::NAMES[n.rem_euclid(12) as usize], n / 12 - 1, t - now);
                    note = Value::from(n as f64);
                }
            }
            let c = sound::clean(&s, &sound::Clean { trim_db: -60.0, fade_in_ms: 1.0, fade_out_ms: 30.0, peak_db: Some(-1.0) });
            let _ = sound::write_wav(&file, &c);
        }
        rows.push(Value::obj().set("p", p.clone()).set("label", label).set("group", "kit").set("part", part.0).set("note", note).set("seconds", m.seconds.min(part.4 as f64)));
    }
    let key = key_pc.map(|k| songprint::pitch::NAMES[k.rem_euclid(12) as usize]).unwrap_or("none");
    Response::json(
        Value::obj()
            .set("tries", Value::Arr(rows))
            .set("key", key)
            .set("words", format!("{length}{}{}", if tone.is_empty() { "" } else { ", " }, tone))
            .to_string(),
    )
}

/// POST {p: a try, rate, air, above, trimDb, fadeOutMs, peakDb, folder, name}:
/// clean it, upsample it, and save it to `Made/<folder>/`.
pub(super) fn api_stems_keep(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = body(req) else { return Response::error(400, "invalid JSON") };
    let Some(lib) = app.library_path() else { return Response::error(400, "no library chosen") };
    let rel = v.get("p").and_then(|p| p.as_str()).unwrap_or("");
    if !rel.starts_with("Stems/") && !rel.starts_with("Made/") {
        return Response::error(400, "only tries can be kept");
    }
    let Some(src) = resolve_within(&lib, rel) else { return Response::error(404, "no such try") };
    let num = |k: &str, d: f64| match v.get(k) {
        Some(Value::Num(n)) => *n,
        _ => d,
    };
    let Ok(snd) = sound::read_span(&src, 0.0, 600.0) else { return Response::error(500, "could not read the try") };
    let c = sound::clean(
        &snd,
        &sound::Clean {
            trim_db: num("trimDb", -60.0) as f32,
            fade_in_ms: 2.0,
            fade_out_ms: num("fadeOutMs", 20.0) as f32,
            peak_db: Some(num("peakDb", -1.0) as f32),
        },
    );
    let rate = num("rate", 0.0) as u32;
    let out = if rate >= 8000 && rate <= 192_000 {
        let up = sound::upsample(&c, rate, num("air", 0.0).clamp(0.0, 1.0) as f32, num("above", 11_000.0) as f32);
        // the exciter can push the peak over; bring it back to the asked level
        sound::clean(&up, &sound::Clean { trim_db: -120.0, fade_in_ms: 0.0, fade_out_ms: 0.0, peak_db: Some(num("peakDb", -1.0) as f32) })
    } else {
        c
    };
    let folder = crate::docs::safe_name(v.get("folder").and_then(|f| f.as_str()).unwrap_or("Sounds"));
    let base = crate::docs::safe_name(v.get("name").and_then(|f| f.as_str()).unwrap_or("sound"));
    let dir = lib.join("Made").join(if folder.is_empty() { "Sounds".into() } else { folder.clone() });
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return Response::error(500, &e.to_string());
    }
    let path = crate::capture::unique(dir.join(format!("{}.wav", if base.is_empty() { "sound" } else { &base })));
    if let Err(e) = sound::write_wav(&path, &out) {
        return Response::error(500, &e.to_string());
    }
    reindex_for(app, "Made/");
    let rel_out = path.strip_prefix(lib.canonicalize().unwrap_or(lib.clone())).or_else(|_| path.strip_prefix(&lib)).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default();
    Response::json(
        Value::obj()
            .set("p", rel_out)
            .set("rate", out.rate)
            .set("seconds", (out.seconds() as f64 * 1000.0).round() / 1000.0)
            .to_string(),
    )
}

/// POST raw interleaved stereo 32-bit floats, `?name=&rate=`: the Clone page's
/// kept take (the Band's piece, rendered in the Seq frame), written to
/// `Made/Clones/<name>.wav`, where Edit, Grain and Chop open it.
pub(super) fn api_clone_keep(app: &Arc<App>, req: &Request) -> Response {
    let Some(lib) = app.library_path() else { return Response::error(400, "no library chosen") };
    if req.body.len() < 8 || req.body.len() % 8 != 0 {
        return Response::error(400, "no sound sent");
    }
    let rate: u32 = req.param("rate").and_then(|r| r.parse().ok()).filter(|r| (8000..=192_000).contains(r)).unwrap_or(48_000);
    let samples: Vec<f32> = req
        .body
        .chunks_exact(4)
        .map(|b| {
            let v = f32::from_le_bytes([b[0], b[1], b[2], b[3]]);
            if v.is_finite() { v.clamp(-1.0, 1.0) } else { 0.0 }
        })
        .collect();
    let base = crate::docs::safe_name(req.param("name").unwrap_or("clone"));
    let dir = lib.join("Made").join("Clones");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return Response::error(500, &e.to_string());
    }
    let path = crate::capture::unique(dir.join(format!("{}.wav", if base.is_empty() { "clone" } else { &base })));
    if let Err(e) = crate::capture::write_wav(&path, &samples, 2, rate) {
        return Response::error(500, &e.to_string());
    }
    reindex_for(app, "Made/");
    let file = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    Response::json(
        Value::obj()
            .set("p", format!("Made/Clones/{file}"))
            .set("seconds", ((samples.len() / 2) as f64 / rate as f64 * 1000.0).round() / 1000.0)
            .to_string(),
    )
}
