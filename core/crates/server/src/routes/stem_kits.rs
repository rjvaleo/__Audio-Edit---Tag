//! A split song's own sounds, as a kit the Band plays (14 Nov 2026). RJ, on the
//! Clone page's takes not sounding like his song: "Try doing what you say with
//! playing sounds from the library", that is, the Band playing the song's own
//! drum hits and bass notes, cut from its stems, in place of MGL's synth.
//!
//! `POST /api/stems/own-kit {"p": "Stems/<song>"}` cuts, from the song's stems:
//! - its clearest kick, snare and closed hat (songprint's `find_hits`, the same
//!   finder the Stems page's Make uses), and an open hat (the hat that rings
//!   longest);
//! - held bass notes across the song's range, at least two semitones apart,
//!   each with the pitch measured on the cut itself (cents included), so a
//!   sampler plays any note from the nearest one;
//!
//! cleaned (`sound::clean`) and written to `Stems/<song>/kit/`, with a
//! `kit.json` saying which file is which. The drums are named as the Band's kit
//! menu reads names (`kick.wav`, `snare.wav`, `closed hat.wav`, `open hat.wav`),
//! the bass notes `bass note <midi>.wav`, and the kit list (`/api/seq/kits`,
//! `library.rs`) offers every such folder as "<song> (its own)". Cutting again
//! replaces the folder's files.
//!
//! RJ, on the first cut: "The bass is really muddy. And there's like some stuff
//! after the sounds". So every sound ends where the next one starts in the stem
//! (`sound::next_attack`), a hit with no room before the next is passed over
//! for one that has it, and a bass note is one whose pitch holds steady, with
//! no kick on its attack, the higher notes preferred, its low mids cut
//! (`sound::unmud`).

use super::*;
use songprint::sound;

pub(super) fn api_stems_own_kit(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else { return Response::error(400, "invalid JSON") };
    let Some(rel) = v.get("p").and_then(|p| p.as_str()).map(str::to_string) else { return Response::error(400, "no song given") };
    let Some(lib) = app.library_path() else { return Response::error(400, "no library chosen") };
    let Some(dir) = resolve_within(&lib, &rel) else { return Response::error(404, "no such song in the library") };
    if !dir.join("drums.wav").is_file() {
        return Response::error(400, "that song has no drums stem: split it on the Stems page first");
    }
    match cut_own_kit(&dir, &dir.join("kit"), &rel) {
        Ok(out) => Response::json(out.to_string()),
        Err(e) => Response::error(500, &e),
    }
}

/// The longest each sound is cut, before it is ended at the next one.
const LONGEST: [(&str, f32); 4] = [("kick", 0.7), ("snare", 0.5), ("chh", 0.3), ("ohh", 0.9)];
/// The least of each that still sounds like itself: a hit with less room
/// before the next is passed over while a roomier one is found.
const BODY: [(&str, f32); 4] = [("kick", 0.18), ("snare", 0.14), ("chh", 0.04), ("ohh", 0.25)];
fn of(t: &[(&str, f32)], slot: &str) -> f32 {
    t.iter().find(|x| x.0 == slot).map(|x| x.1).unwrap_or(0.3)
}

/// Clean a sound ended at `end` seconds: the fade a quarter of it, 8–40 ms,
/// the tail trimmed where it falls 45 dB under the peak.
fn finish(s: &sound::Sound, end: f32) -> sound::Sound {
    let s = sound::until(s, end);
    let fade = (s.seconds() * 250.0).clamp(8.0, 40.0);
    sound::clean(&s, &sound::Clean { trim_db: -45.0, fade_in_ms: 1.5, fade_out_ms: fade, peak_db: Some(-1.0) })
}

/// A candidate drum hit, cut to where the next sound starts.
struct Cut {
    t: f32,
    sound: sound::Sound,
    room: f32,
    score: f32,
    decay: f32,
}

fn cut_own_kit(dir: &Path, kit: &Path, rel: &str) -> Result<Value, String> {
    let drums = dir.join("drums.wav");
    std::fs::create_dir_all(kit).map_err(|e| e.to_string())?;
    // Bass notes are named by pitch, so last time's would stay beside this
    // time's: clear them first.
    if let Ok(rd) = std::fs::read_dir(kit) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if n.starts_with("bass note ") && n.ends_with(".wav") {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    let mut made: Vec<String> = Vec::new();
    let mut put = |file: &str, snd: &sound::Sound| -> bool {
        let ok = sound::write_wav(&kit.join(file), snd).is_ok();
        if ok {
            made.push(file.to_string());
        }
        ok
    };

    // The drums: up to eight of each kind, best first, at least a second
    // apart, each cut to where the next sound starts; the best with room for
    // its body wins.
    let hits = sound::find_hits(&drums, 8, 1.0)?;
    let cuts = |kind: sound::Kind, slot: &str| -> Vec<Cut> {
        let (longest, body) = (of(&LONGEST, slot), of(&BODY, slot));
        hits.iter()
            .filter(|h| h.kind == kind)
            .filter_map(|h| {
                let s = sound::cut(&drums, h.t, longest).ok()?;
                // `cut` starts 18 ms before the onset; `len` runs from it.
                let mut end = sound::next_attack(&s).unwrap_or(s.seconds());
                if slot != "ohh" {
                    end = end.min(h.len + 0.018);
                }
                let room = end.min(longest);
                let score = h.purity * h.strength.min(1.5) * (room / body).min(1.0).powi(2);
                // A kick with no room keeps its body: what came in over its
                // tail is filtered out instead, all but the kick's own low end.
                let sound = if slot == "kick" && room < body { finish(&sound::low_after(&s, room, 160.0), body) } else { finish(&s, room) };
                let decay = sound::character(&sound).decay;
                Some(Cut { t: h.t, sound, room, score, decay })
            })
            .collect()
    };
    let best = |v: &[Cut]| -> Option<usize> { (0..v.len()).max_by(|&a, &b| v[a].score.total_cmp(&v[b].score)) };
    let mut drum_files = Value::obj();
    for (slot, file, kind) in [("kick", "kick.wav", sound::Kind::Kick), ("snare", "snare.wav", sound::Kind::Snare)] {
        let v = cuts(kind, slot);
        if let Some(i) = best(&v) {
            if put(file, &v[i].sound) {
                drum_files = drum_files.set(slot, file.to_string());
            }
        }
    }
    // The hats: the closed one is the best short hat; the open one, another
    // hat, the one that rings longest with room to.
    let chh = cuts(sound::Kind::Hat, "chh");
    let closed_t = best(&chh).map(|i| chh[i].t);
    if let Some(i) = best(&chh) {
        if put("closed hat.wav", &chh[i].sound) {
            drum_files = drum_files.set("chh", "closed hat.wav".to_string());
        }
    }
    let ohh = cuts(sound::Kind::Hat, "ohh");
    let open = (0..ohh.len())
        .filter(|&i| Some(ohh[i].t) != closed_t && ohh[i].room >= of(&BODY, "ohh"))
        .max_by(|&a, &b| ohh[a].decay.total_cmp(&ohh[b].decay))
        .or_else(|| best(&ohh));
    if let Some(i) = open {
        if put("open hat.wav", &ohh[i].sound) {
            drum_files = drum_files.set("ohh", "open hat.wav".to_string());
        }
    }

    let mut bass_files: Vec<Value> = Vec::new();
    for (midi, s) in bass_notes(dir) {
        let file = format!("bass note {midi:.2}.wav");
        if put(&file, &s) {
            let len = (s.seconds() as f64 * 1000.0).round() / 1000.0;
            bass_files.push(Value::obj().set("file", file).set("midi", (midi as f64 * 100.0).round() / 100.0).set("len", len));
        }
    }

    if made.is_empty() {
        return Err("nothing clear enough to cut from that song's stems".into());
    }
    let song = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let out = Value::obj()
        .set("song", song)
        .set("path", format!("{}/kit", rel.trim_end_matches('/')))
        .set("drums", drum_files)
        .set("bass", Value::Arr(bass_files));
    let _ = std::fs::write(kit.join("kit.json"), out.to_string());
    Ok(out)
}

/// A bass note from the reading, before it is cut.
struct Cand {
    t: f64,
    secs: f64,
    midi: f64,
    pre: f64,
}

/// The held bass notes to keep, low to high: (the pitch measured on the cut,
/// the cleaned note).
fn bass_notes(dir: &Path) -> Vec<(f32, sound::Sound)> {
    let bass = dir.join("bass.wav");
    let Some(a) = std::fs::read_to_string(dir.join("songprint.json")).ok().and_then(|t| json::parse(&t)) else { return vec![] };
    if !bass.is_file() {
        return vec![];
    }
    let num = |x: Option<&Value>| if let Some(Value::Num(n)) = x { Some(*n) } else { None };
    let bpm = num(a.get("tempo").and_then(|t| t.get("bpm"))).unwrap_or(120.0);
    let step_s = 60.0 / bpm / 4.0;
    let bars: Vec<&Value> = a.get("bars").and_then(|b| b.arr()).map(|b| b.iter().collect()).unwrap_or_default();
    let bar_t = |i: usize| bars.get(i).and_then(|b| num(b.get("t"))).filter(|t| t.is_finite());
    // The kick's strength on a step: a bass stem carries the kick's bleed.
    let kick = |bar: usize, step: usize| -> f64 {
        let (b, s) = (bar + step / 16, step % 16);
        bars.get(b).and_then(|x| x.get("kick")).and_then(|k| k.arr()).and_then(|k| num(k.get(s))).unwrap_or(0.0)
    };
    let mut notes: Vec<(f64, usize, usize, f64, f64, f64)> = Vec::new(); // t, bar, step, len, midi, vel
    for n in a.get("bass").and_then(|b| b.get("notes")).and_then(|n| n.arr()).unwrap_or(&[]) {
        let Some(f) = n.arr() else { continue };
        let g = |i: usize| num(f.get(i)).unwrap_or(0.0);
        let (bar, step) = (g(0) as usize, g(1) as usize);
        let Some(t0) = bar_t(bar) else { continue };
        notes.push((t0 + step as f64 * step_s, bar, step, g(2), g(3), g(4)));
    }
    notes.sort_by(|a, b| a.0.total_cmp(&b.0));

    // A first ranking from the reading alone: long, strong, no kick on the
    // attack and, less, none under it.
    let mut by_pitch: std::collections::BTreeMap<i32, Vec<Cand>> = Default::default();
    for (i, &(t, bar, step, len, midi, vel)) in notes.iter().enumerate() {
        if len < 2.0 || vel < 0.15 {
            continue;
        }
        let next = notes.get(i + 1).map(|n| n.0).unwrap_or(f64::MAX);
        let secs = (len * step_s).min(next - t).min(1.6);
        if secs < 0.2 {
            continue;
        }
        let kick_in = (1..len as usize).map(|k| kick(bar, step + k)).fold(0.0, f64::max);
        let pre = vel.min(1.2) * secs.min(1.0) / (1.0 + 2.0 * kick(bar, step)) / (1.0 + 0.5 * kick_in);
        by_pitch.entry(midi.round() as i32).or_default().push(Cand { t, secs, midi, pre });
    }

    // Then the best four of each pitch cut and measured: where it really
    // starts (the quiet before its attack), where the next sound starts, and
    // how steady its pitch is.
    let mut picks: Vec<(f64, f32, sound::Sound)> = Vec::new(); // quality, midi, sound
    for (_, mut v) in by_pitch {
        v.sort_by(|a, b| b.pre.total_cmp(&a.pre));
        let mut best: Option<(f64, f32, sound::Sound)> = None;
        for c in v.iter().take(4) {
            let Ok(raw) = sound::read_span(&bass, (c.t - 0.04) as f32, (c.t + c.secs) as f32) else { continue };
            let start = quiet_before(&raw, 0.07);
            let s = sound::Sound { rate: raw.rate, channels: raw.channels, x: raw.x[start * raw.channels..].to_vec() };
            if s.frames() == 0 {
                continue;
            }
            let hz = 440.0 * 2f64.powf((c.midi - 69.0) / 12.0);
            // It ends at the next note, or where it has died 30 dB away.
            let frame = (2.0 / hz as f32).max(0.005);
            let end = [sound::next_attack_over(&s, frame, -4.0, 0.15), sound::dies_at(&s, frame, -30.0)].into_iter().flatten().fold(s.seconds(), f32::min);
            let s = sound::until(&s, end);
            if s.seconds() < 0.2 {
                continue;
            }
            // A bass too gritty to measure keeps the reading's pitch, a last
            // resort: ranked well under any note that measures.
            let (med, spread, voiced) = match sound::steadiness(&s) {
                Some((m, sp, v)) if v >= 0.5 => {
                    // YIN on a bass whose fundamental is weak can read its octave.
                    let Some(m) = [0.0, -12.0, 12.0].iter().map(|o| m + o).find(|m| (*m as f64 - c.midi).abs() <= 0.6) else { continue };
                    (m, sp, v)
                }
                _ => (c.midi as f32, 30.0, 0.25),
            };
            let higher = 1.0 + 0.04 * (med as f64 - 28.0).max(0.0);
            let q = c.pre * (s.seconds() as f64).min(1.0) / (1.0 + spread as f64 / 15.0) * voiced as f64 * higher;
            if best.as_ref().map(|b| q > b.0).unwrap_or(true) {
                best = Some((q, med, s));
            }
        }
        picks.extend(best);
    }
    picks.sort_by(|a, b| b.0.total_cmp(&a.0));
    let top = picks.first().map(|p| p.0).unwrap_or(0.0);
    let mut kept: Vec<(f32, sound::Sound)> = Vec::new();
    for (q, midi, s) in picks {
        if kept.len() < 8 && q >= top * 0.2 && kept.iter().all(|k| (k.0 - midi).abs() >= 2.0) {
            let hz = 440.0 * 2f32.powf((midi - 69.0) / 12.0);
            let s = sound::unmud(&s, hz, 280.0, -4.0);
            let fade = (s.seconds() * 1000.0 * 0.12).clamp(15.0, 40.0);
            kept.push((midi, sound::clean(&s, &sound::Clean { trim_db: -50.0, fade_in_ms: 3.0, fade_out_ms: fade, peak_db: Some(-1.0) })));
        }
    }
    kept.sort_by(|a, b| a.0.total_cmp(&b.0));
    kept
}

/// The quietest 5 ms in the first `within` seconds: where a note begins after
/// the last one's tail, not where the grid says.
fn quiet_before(s: &sound::Sound, within: f32) -> usize {
    let ch = s.channels.max(1);
    let w = ((0.005 * s.rate as f32) as usize).max(1);
    let n = ((within * s.rate as f32) as usize).min(s.frames());
    let e = |i: usize| s.x[i * ch..(i + w) * ch].iter().map(|v| v * v).sum::<f32>();
    (0..n.saturating_sub(w)).step_by((w / 2).max(1)).min_by(|&a, &b| e(a).total_cmp(&e(b))).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Cut the own kit of every split song in `OWN_KIT_STEMS` into
    /// `OWN_KIT_OUT/<song>/`, leaving the library alone, to listen to:
    /// `OWN_KIT_STEMS=… OWN_KIT_OUT=… cargo test -p server own_kits -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn own_kits() {
        let (Ok(stems), Ok(out)) = (std::env::var("OWN_KIT_STEMS"), std::env::var("OWN_KIT_OUT")) else { return };
        for e in std::fs::read_dir(&stems).unwrap().flatten() {
            let dir = e.path();
            if !dir.join("drums.wav").is_file() {
                continue;
            }
            let name = e.file_name().to_string_lossy().to_string();
            match cut_own_kit(&dir, &Path::new(&out).join(&name), &name) {
                Ok(v) => println!("{name}: {}", v.to_string()),
                Err(e) => println!("{name}: {e}"),
            }
        }
    }
}
