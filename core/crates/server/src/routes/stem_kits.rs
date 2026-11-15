//! A split song's own sounds, as a kit the Band plays (14 Nov 2026). RJ, on the
//! Clone page's takes not sounding like his song: "Try doing what you say with
//! playing sounds from the library", that is, the Band playing the song's own
//! drum hits and bass notes, cut from its stems, in place of MGL's synth.
//!
//! `POST /api/stems/own-kit {"p": "Stems/<song>"}` cuts, from the song's stems:
//! - its clearest kick, snare and closed hat (songprint's `find_hits`, the same
//!   finder the Stems page's Make uses), and an open hat (the next clearest hat,
//!   left to ring);
//! - up to three held bass notes, at different pitches, each with the pitch
//!   the reading measured (cents included), so a sampler can play any note
//!   from the nearest one;
//!
//! cleaned (`sound::clean`) and written to `Stems/<song>/kit/`, with a
//! `kit.json` saying which file is which. The drums are named as the Band's kit
//! menu reads names (`kick.wav`, `snare.wav`, `closed hat.wav`, `open hat.wav`),
//! and the kit list (`/api/seq/kits`, `library.rs`) offers every such folder as
//! "<song> (its own)". Cutting again replaces the folder's files.

use super::*;
use songprint::sound;

pub(super) fn api_stems_own_kit(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else { return Response::error(400, "invalid JSON") };
    let Some(rel) = v.get("p").and_then(|p| p.as_str()).map(str::to_string) else { return Response::error(400, "no song given") };
    let Some(lib) = app.library_path() else { return Response::error(400, "no library chosen") };
    let Some(dir) = resolve_within(&lib, &rel) else { return Response::error(404, "no such song in the library") };
    let drums = dir.join("drums.wav");
    if !drums.is_file() {
        return Response::error(400, "that song has no drums stem: split it on the Stems page first");
    }
    let kit = dir.join("kit");
    if let Err(e) = std::fs::create_dir_all(&kit) {
        return Response::error(500, &e.to_string());
    }
    let mut files = Value::obj();
    let mut made: Vec<String> = Vec::new();
    let mut put = |file: &str, snd: sound::Sound| -> bool {
        let c = sound::clean(&snd, &sound::Clean::default());
        let ok = sound::write_wav(&kit.join(file), &c).is_ok();
        if ok {
            made.push(file.to_string());
        }
        ok
    };

    // The drums: the two clearest of each kind, at least two seconds apart.
    let hits = match sound::find_hits(&drums, 2, 2.0) {
        Ok(h) => h,
        Err(e) => return Response::error(500, &e),
    };
    let first = |k: sound::Kind, nth: usize| hits.iter().filter(|h| h.kind == k).nth(nth);
    for (slot, file, kind, nth, ring) in [
        ("kick", "kick.wav", sound::Kind::Kick, 0, false),
        ("snare", "snare.wav", sound::Kind::Snare, 0, false),
        ("chh", "closed hat.wav", sound::Kind::Hat, 0, false),
        // The open hat: another hat, let ring past the next hit.
        ("ohh", "open hat.wav", sound::Kind::Hat, 1, true),
    ] {
        let Some(h) = first(kind, nth).or_else(|| if ring { first(kind, 0) } else { None }) else { continue };
        // In a busy drums stem the next hit comes soon, and a kick cut before it
        // is a click: each kind keeps at least its body, the next hit's bleed
        // faded under it.
        let body = match kind {
            sound::Kind::Kick => 0.28,
            sound::Kind::Snare => 0.2,
            sound::Kind::Hat => 0.06,
        };
        let len = if ring { sound::hit_length(kind).max(0.4) } else { (h.len + 0.018).max(body) };
        if let Ok(s) = sound::cut(&drums, h.t, len) {
            if put(file, s) {
                files = files.set(slot, file.to_string());
            }
        }
    }

    // The bass: held notes from the reading, the strongest and longest, at
    // different pitches; each file says its pitch.
    let mut bass_notes: Vec<Value> = Vec::new();
    let bass = dir.join("bass.wav");
    if let (true, Some(a)) = (bass.is_file(), std::fs::read_to_string(dir.join("songprint.json")).ok().and_then(|t| json::parse(&t))) {
        let num = |x: Option<&Value>| if let Some(Value::Num(n)) = x { Some(*n) } else { None };
        let bpm = num(a.get("tempo").and_then(|t| t.get("bpm"))).unwrap_or(120.0);
        let step_s = 60.0 / bpm / 4.0;
        let bar_t: Vec<f64> = a.get("bars").and_then(|b| b.arr()).map(|b| b.iter().map(|x| num(x.get("t")).unwrap_or(f64::NAN)).collect()).unwrap_or_default();
        let notes = a.get("bass").and_then(|b| b.get("notes")).and_then(|n| n.arr()).map(|n| n.to_vec()).unwrap_or_default();
        // midi (rounded) -> (score, t, seconds, midi with its cents)
        let mut best: std::collections::BTreeMap<i32, (f64, f64, f64, f64)> = Default::default();
        for n in &notes {
            let Some(f) = n.arr() else { continue };
            let g = |i: usize| num(f.get(i)).unwrap_or(0.0);
            let (bar, step, len, midi, vel) = (g(0) as usize, g(1), g(2), g(3), g(4));
            if len < 3.0 || vel < 0.15 {
                continue;
            }
            let Some(t0) = bar_t.get(bar).copied().filter(|t| t.is_finite()) else { continue };
            let secs = (len * step_s).min(1.6);
            let score = secs * vel;
            let e = best.entry(midi.round() as i32).or_insert((0.0, 0.0, 0.0, 0.0));
            if score > e.0 {
                *e = (score, t0 + step * step_s, secs, midi);
            }
        }
        let mut picks: Vec<(f64, f64, f64, f64)> = best.into_values().collect();
        picks.sort_by(|a, b| b.0.total_cmp(&a.0));
        // Three at most, at least four semitones apart, low to high.
        let mut kept: Vec<(f64, f64, f64, f64)> = Vec::new();
        for p in picks {
            if kept.len() < 3 && kept.iter().all(|k| (k.3 - p.3).abs() >= 4.0) {
                kept.push(p);
            }
        }
        kept.sort_by(|a, b| a.3.total_cmp(&b.3));
        for (_, t, secs, midi) in kept {
            let file = format!("bass note {midi:.2}.wav");
            if let Ok(s) = sound::cut(&bass, t as f32, secs as f32) {
                if put(&file, s) {
                    bass_notes.push(Value::obj().set("file", file).set("midi", (midi * 100.0).round() / 100.0));
                }
            }
        }
    }

    if made.is_empty() {
        return Response::error(500, "nothing clear enough to cut from that song's stems");
    }
    let song = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let out = Value::obj()
        .set("song", song)
        .set("path", format!("{}/kit", rel.trim_end_matches('/')))
        .set("drums", files)
        .set("bass", Value::Arr(bass_notes));
    let _ = std::fs::write(kit.join("kit.json"), out.to_string());
    Response::json(out.to_string())
}
