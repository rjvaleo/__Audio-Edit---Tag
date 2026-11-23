//! Chop on the canvas: its Sound cable, and everything its face asks
//! (`na_chop_call` and the binary calls). See `CHOP-API.md`
//! (`WORK DIR/idmlab-move/api-runs/a3`).
//!
//! The Sound socket is the app's, as Grain's is: a Sound module's cable hands
//! Chop the document's edited timeline at the file's rate (`SoundPart::dry`),
//! channel by channel. A new sound (cabled, uncabled, or its samples
//! changed by an edit) is the page's `chopTake`. Chop's Notes socket is the
//! engine Chop's notes input.

use crate::chop_part::{self, ChopPart, SoundFacts, QUIET};
use crate::{engine_id, AppError, Part, Session, Wire};
use engine_core::{EventKind, Kind, NoteEvent, NoteKind};
use engine_mgl::chop::{self, Flag, TailParams};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

fn bad(why: impl Into<String>) -> AppError {
    AppError::BadFile(why.into())
}

/// A check of the samples: they changed, or they did not.
pub fn fingerprint(dry: &[f32], rate: u32, channels: usize) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325 ^ ((rate as u64) << 8) ^ channels as u64;
    for v in dry {
        h = (h ^ v.to_bits() as u64).wrapping_mul(0x0000_0100_0000_01b3);
    }
    h ^ dry.len() as u64
}

/// MGL's `capture::safe`: what a file system would rather not see, made plain.
pub fn safe(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if (c as u32) < 0x20 => ' ',
            c => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

/// MGL's `capture::unique`: never over a file that is there.
pub fn unique(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = path.extension().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "wav".into());
    for n in 2..1000 {
        let next = path.with_file_name(format!("{stem} ({n}).{ext}"));
        if !next.exists() {
            return next;
        }
    }
    path
}

/// The page's stem: the name without its extension (`/\.[^.]+$/`).
fn stem_of(name: &str) -> String {
    match name.rfind('.') {
        Some(i) if i + 1 < name.len() && !name[i + 1..].contains('.') => name[..i].to_string(),
        _ => name.to_string(),
    }
}

/// The presets file's list, `[{name, cp}]`.
fn read_presets(path: &Path) -> Vec<Value> {
    std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).and_then(|v| v.as_array().cloned()).unwrap_or_default()
}

/// `chopStorePresets`: sorted by name, and kept.
fn store_presets(path: &Path, mut list: Vec<Value>) -> Result<(), AppError> {
    let name = |v: &Value| v.get("name").and_then(Value::as_str).unwrap_or("").to_string();
    list.sort_by(|a, b| {
        let (a, b) = (name(a), name(b));
        a.to_lowercase().cmp(&b.to_lowercase()).then(a.cmp(&b))
    });
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| bad(e.to_string()))?;
    }
    std::fs::write(path, serde_json::to_string_pretty(&Value::Array(list)).unwrap_or_default()).map_err(|e| bad(e.to_string()))
}

/// A switch's truth, as the page's `if (cp.outMidi)`.
fn truth(v: Option<&Value>) -> bool {
    match v {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|x| x != 0.0),
        _ => false,
    }
}

fn int(v: &Value, k: &str) -> Option<i64> {
    v.get(k).and_then(Value::as_f64).filter(|x| x.is_finite()).map(|x| chop::js::round(x) as i64)
}

impl Session {
    /// Chop module `id`'s part, with its engine Chop.
    pub(crate) fn add_chop(&mut self, id: u32, saved: Option<&Value>) -> Result<Part, AppError> {
        let m = engine_mgl::Chop::new();
        let playing = m.playing();
        self.ctl.add(engine_id(id, 0), Box::new(m))?;
        Ok(Part::Chop(Box::new(ChopPart::new(self.rate as u32, playing, saved.and_then(|s| s.get("chop"))))))
    }

    fn chop(&mut self, id: u32) -> Result<&mut ChopPart, AppError> {
        match self.modules.get_mut(&id).map(|m| &mut m.part) {
            Some(Part::Chop(c)) => Ok(c),
            _ => Err(AppError::NoSuchModule(id)),
        }
    }

    fn chop_ref(&self, id: u32) -> Result<&ChopPart, AppError> {
        match self.modules.get(&id).map(|m| &m.part) {
            Some(Part::Chop(c)) => Ok(c),
            _ => Err(AppError::NoSuchModule(id)),
        }
    }

    fn chop_ids(&self) -> Vec<u32> {
        self.modules.iter().filter(|(_, m)| matches!(m.part, Part::Chop(_))).map(|(id, _)| *id).collect()
    }

    /// The Sound module cabled into Chop module `id`, if any.
    pub fn chop_sound(&self, id: u32) -> Option<u32> {
        self.wires.iter().find(|w| w.to == (id, 0)).map(|w| w.from.0).filter(|s| matches!(self.modules.get(s).map(|m| &m.part), Some(Part::Sound(_))))
    }

    /// A cable into Chop's Sound socket, or out of it: the app's own.
    pub(crate) fn chop_connect(&mut self, from: (u32, u32), to: (u32, u32), on: bool) -> Option<Result<(), AppError>> {
        if to.1 != 0 || !matches!(self.modules.get(&to.0).map(|m| &m.part), Some(Part::Chop(_))) {
            return None;
        }
        let out_kind = self.modules.get(&from.0).and_then(|m| m.kind.outs.get(from.1 as usize)).map(|(_, k)| *k);
        let wire = Wire { from, to };
        if !on {
            let Some(at) = self.wires.iter().position(|w| *w == wire) else { return Some(Err(AppError::NoSuchSocket)) };
            self.wires.remove(at);
            self.chop_sync();
            return Some(Ok(()));
        }
        match out_kind {
            None => return Some(Err(AppError::NoSuchSocket)),
            Some(k) if k != Kind::Sound => return Some(Err(AppError::KindsDiffer)),
            _ => {}
        }
        if self.wires.contains(&wire) {
            return Some(Ok(()));
        }
        if self.wires.iter().any(|w| w.to == to) {
            return Some(Err(AppError::Taken));
        }
        self.wires.push(wire);
        self.chop_sync();
        Some(Ok(()))
    }

    /// Keep every Chop's sound in step with its cable: a new sound is taken,
    /// none is none.
    pub(crate) fn chop_sync(&mut self) {
        for id in self.chop_ids() {
            let doc = self.chop_sound(id).and_then(|s| match self.modules.get(&s).map(|m| &m.part) {
                Some(Part::Sound(p)) if p.is_open() && p.frames() > 0 => Some((s, p.serial)),
                _ => None,
            });
            let Ok(c) = self.chop_ref(id) else { continue };
            if doc == c.fed {
                continue;
            }
            let Some((s, serial)) = doc else {
                if let Ok(c) = self.chop(id) {
                    c.fed = None;
                    c.drop_sound();
                }
                let _ = self.chop_hand(id);
                continue;
            };
            let Some(Part::Sound(p)) = self.modules.get(&s).map(|m| &m.part) else { continue };
            let (ch, rate, dry) = (p.channels().max(1), p.file_rate(), p.dry());
            let check = fingerprint(dry, rate, ch);
            let same = c.page.is_some() && c.check == Some(check) && c.fed.map(|f| f.0) == Some(s);
            if same {
                if let Ok(c) = self.chop(id) {
                    c.fed = Some((s, serial));
                }
                continue;
            }
            let frames = dry.len() / ch;
            let channels: Vec<Vec<f32>> = (0..ch).map(|k| (0..frames).map(|i| dry[i * ch + k]).collect()).collect();
            let o = p.origin();
            let txt = |k: &str| o.get(k).and_then(Value::as_str).unwrap_or("").to_string();
            let file = txt("file");
            let path = if txt("path").is_empty() { file.clone() } else { txt("path") };
            let name = if txt("name").is_empty() { Path::new(&path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default() } else { txt("name") };
            let facts = SoundFacts {
                stem: stem_of(&name),
                name,
                path,
                kind: if txt("kind") == "library" { "library".into() } else { "file".into() },
                file,
                bits: o.get("bits").cloned().unwrap_or(Value::Null),
                format: o.get("format").cloned().unwrap_or(Value::Null),
            };
            if let Ok(c) = self.chop(id) {
                c.fed = Some((s, serial));
                c.take(channels, rate as f64, facts, check);
            }
        }
    }

    /// Hand Chop module `id`'s engine what plays now, rendered from the page.
    fn chop_hand(&mut self, id: u32) -> Result<(), AppError> {
        let thing = self.chop(id)?.build();
        self.ctl.give(engine_id(id, 0), 0, thing)?;
        Ok(())
    }

    /// Now and then: the cables, the analyses that have come, and what plays
    /// rendered again once things have been still a moment.
    pub(crate) fn chop_collect(&mut self) {
        self.chop_sync();
        for id in self.chop_ids() {
            let Ok(c) = self.chop(id) else { continue };
            c.take_analysis(false);
            if c.dirty && c.changed.elapsed() >= QUIET {
                let _ = self.chop_hand(id);
            }
        }
    }

    /// Wait for every Chop's analysis, and hand over what plays (tests and
    /// offline renders).
    pub fn chop_settle(&mut self) {
        self.chop_sync();
        for id in self.chop_ids() {
            let Ok(c) = self.chop(id) else { continue };
            c.take_analysis(true);
            if c.dirty {
                let _ = self.chop_hand(id);
            }
        }
    }

    /// The module's own message, heard from the next block.
    fn chop_send(&mut self, id: u32, kind: EventKind) -> Result<(), AppError> {
        self.ctl.send(engine_id(id, 0), kind)?;
        Ok(())
    }

    /// `chopStop`: everything it plays stops.
    fn chop_stop(&mut self, id: u32) -> Result<(), AppError> {
        let off = NoteEvent { kind: NoteKind::AllOff, ..NoteEvent::on(0, 0.0) };
        self.chop_send(id, EventKind::Note(off))
    }

    /// Rendered now if anything changed since: before anything plays.
    fn chop_fresh(&mut self, id: u32) -> Result<(), AppError> {
        if self.chop_ref(id)?.dirty {
            self.chop_hand(id)?;
        }
        Ok(())
    }

    /// Preview (1) or Ratchet (2), as its button: playing, it stops.
    fn chop_transport(&mut self, id: u32, which: u32, name: &str) -> Result<(), AppError> {
        let c = self.chop_ref(id)?;
        if c.playhead().0 == name {
            return self.chop_stop(id);
        }
        if c.page.is_none() {
            return Ok(());
        }
        self.chop_fresh(id)?;
        self.chop_stop(id)?;
        self.chop_send(id, EventKind::Param { index: chop::TRANSPORT, value: which as f32 })
    }

    /// `na_chop_call`: one of the page's functions, named by `what` (see
    /// `CHOP-API.md`), with its JSON. Its answer.
    pub fn chop_call(&mut self, id: u32, what: &str, v: &Value) -> Result<Value, AppError> {
        self.chop_ref(id)?;
        self.chop_sync();
        self.chop(id)?.take_analysis(false);
        let state = |s: &Session| -> Result<Value, AppError> { Ok(json!({ "state": s.chop_ref(id)?.state_json() })) };
        let no_sound = || bad("Chop a sound first: cable a Sound in");
        match what {
            "state" => state(self),
            "set" => {
                let c = self.chop(id)?;
                // `{key: value}`, or `[[key, value], ...]` to keep an order.
                let pairs: Vec<(String, Value)> = match v {
                    Value::Object(m) => m.iter().map(|(k, x)| (k.clone(), x.clone())).collect(),
                    Value::Array(a) => a.iter().filter_map(|p| Some((p.get(0)?.as_str()?.to_string(), p.get(1)?.clone()))).collect(),
                    _ => Vec::new(),
                };
                for (k, x) in pairs {
                    if !c.set(&k, x) {
                        return Err(bad(format!("Chop has no setting {k:?}")));
                    }
                }
                state(self)
            }
            "apply" => {
                let values = v.get("values").and_then(Value::as_object).cloned().unwrap_or_default();
                self.chop(id)?.apply(&values);
                state(self)
            }
            "ab" => {
                let b = matches!(v.get("which").and_then(Value::as_str), Some("b" | "B"));
                self.chop(id)?.switch_ab(b);
                state(self)
            }
            "dice" => {
                self.chop(id)?.dice();
                state(self)
            }
            "detect" => {
                self.chop(id)?.detect();
                state(self)
            }
            "scale" => {
                let f = v.get("f").and_then(Value::as_f64).ok_or_else(|| bad("scale by what?"))?;
                self.chop(id)?.scale(f);
                state(self)
            }
            "region" | "whole" => {
                let c = self.chop(id)?;
                let Some(p) = c.page.as_mut() else { return Err(no_sound()) };
                let (s, e) = if what == "whole" { (0, p.len) } else { (int(v, "s").unwrap_or(0).clamp(0, p.len), int(v, "e").unwrap_or(p.len).clamp(0, p.len)) };
                if e <= s {
                    return Err(bad("S must come before E"));
                }
                p.region = (s, e);
                c.recut();
                state(self)
            }
            "recut" => {
                self.chop(id)?.recut();
                state(self)
            }
            "pick" => {
                let c = self.chop(id)?;
                let Some(p) = c.page.as_mut() else { return Err(no_sound()) };
                p.pick(int(v, "i").unwrap_or(-1), v.get("add").and_then(Value::as_bool).unwrap_or(false));
                c.touch();
                state(self)
            }
            "toggle" => {
                let flag = match v.get("flag").and_then(Value::as_str) {
                    Some("rev") => Flag::Rev,
                    Some("muted") => Flag::Muted,
                    _ => return Err(bad("toggle rev or muted")),
                };
                let c = self.chop(id)?;
                let Some(p) = c.page.as_mut() else { return Err(no_sound()) };
                if !p.toggle(flag) {
                    return Ok(json!({ "said": "Pick a slice first (shift-click for more)", "state": c.state_json() }));
                }
                c.changed();
                state(self)
            }
            "lock" | "delete" => {
                let i = int(v, "i").filter(|i| *i >= 0).ok_or_else(|| bad("which slice?"))? as usize;
                let c = self.chop(id)?;
                let Some(p) = c.page.as_mut() else { return Err(no_sound()) };
                let done = if what == "lock" { p.toggle_lock(i) } else { p.delete_cut(i) };
                if !done {
                    return Err(bad(format!("no slice {i}")));
                }
                c.changed();
                state(self)
            }
            "move" => {
                let i = int(v, "i").filter(|i| *i >= 0).ok_or_else(|| bad("which slice?"))? as usize;
                let to = int(v, "to").ok_or_else(|| bad("to where?"))?;
                let start = v.get("side").and_then(Value::as_str) != Some("e");
                let snap = v.get("snap").and_then(Value::as_bool).unwrap_or(false);
                let c = self.chop(id)?;
                let Some(p) = c.page.as_mut() else { return Err(no_sound()) };
                let to = if snap { p.snap_near(to) } else { to };
                p.move_edge(i, start, to);
                c.touch();
                state(self)
            }
            "moved" => {
                self.chop(id)?.changed();
                state(self)
            }
            "add" => {
                let at = int(v, "at").ok_or_else(|| bad("add where?"))?;
                let c = self.chop(id)?;
                let Some(p) = c.page.as_mut() else { return Err(no_sound()) };
                p.add_cut(at);
                c.changed();
                state(self)
            }
            "play" => {
                let i = int(v, "i").filter(|i| *i >= 0).ok_or_else(|| bad("which slice?"))?;
                let pick = v.get("pick").and_then(Value::as_bool).unwrap_or(true);
                let c = self.chop(id)?;
                let Some(p) = c.page.as_mut() else { return Err(no_sound()) };
                if pick {
                    p.pick(i, false);
                    c.touch();
                }
                let exists = c.page.as_ref().is_some_and(|p| (i as usize) < p.slices.len());
                if exists {
                    self.chop_fresh(id)?;
                    self.chop_stop(id)?;
                    self.chop_send(id, EventKind::Param { index: chop::PLAY, value: i as f32 })?;
                }
                state(self)
            }
            "preview" => {
                self.chop_transport(id, 1, "preview")?;
                state(self)
            }
            "ratchet" => {
                self.chop_transport(id, 2, "ratchet")?;
                state(self)
            }
            "stop" => {
                self.chop_stop(id)?;
                state(self)
            }
            "playing" => Ok(self.chop_playing(id)?),
            "slice" => self.chop_slice(id, int(v, "i").unwrap_or(-1)),
            "tails" => {
                let c = self.chop_ref(id)?;
                let (badges, cycles) = match &c.page {
                    Some(p) => p.tail_badges(),
                    None => (Vec::new(), String::new()),
                };
                Ok(json!({ "badges": badges.iter().map(|b| json!({ "cls": b.cls, "text": b.text, "title": b.title })).collect::<Vec<_>>(), "cycles": cycles }))
            }
            "write" => self.chop_write(id),
            "toRegions" => self.chop_to_regions(id),
            "presets" => self.chop_presets(id, v),
            "home" => {
                let home = v.get("home").and_then(Value::as_str).filter(|h| !h.is_empty()).map(PathBuf::from);
                self.chop(id)?.home = home;
                state(self)
            }
            "ui" => {
                let c = self.chop(id)?;
                c.ui = v.clone();
                c.touch();
                state(self)
            }
            other => Err(bad(format!("no Chop call {other:?}"))),
        }
    }

    /// `chopPlayhead`, and the state's serial: cheap, for every frame.
    pub fn chop_playing(&self, id: u32) -> Result<Value, AppError> {
        let c = self.chop_ref(id)?;
        let (kind, at) = c.playhead();
        Ok(json!({ "kind": kind, "at": if at < 0.0 { -1.0 } else { at }, "serial": c.serial }))
    }

    /// Slice `i`'s readings, as the slice's panel shows them.
    fn chop_slice(&mut self, id: u32, i: i64) -> Result<Value, AppError> {
        let c = self.chop_ref(id)?;
        let Some(p) = &c.page else { return Err(bad("Chop a sound first: cable a Sound in")) };
        let Some(x) = usize::try_from(i).ok().and_then(|i| p.slices.get(i)) else { return Err(bad(format!("no slice {i}"))) };
        let m = c.measures.get(i as usize).map(|m| {
            json!({ "kind": m.kind, "low": m.low, "mid": m.mid, "high": m.high, "cent": m.cent, "flat": m.flat, "zcr": m.zcr,
                "db": m.db, "peakDb": m.peak_db, "crest": m.crest, "dur": m.dur, "clarity": m.clarity, "hz": m.hz })
        });
        let note = c.measures.get(i as usize).filter(|m| m.hz != 0.0).map(|m| chop::note(m.hz)).unwrap_or_default();
        let cp = &p.settings;
        let tail = if cp.tail {
            let e = x.s + chop::js::max(1.0, chop::js::round((x.e - x.s) as f64 * cp.gate / 100.0)) as i64;
            Some(match chop::tail_params(x.s, e, cp.tail_ms, p.rate) {
                TailParams::Yes(t) => json!({ "viable": true, "actualMs": t.actual_ms, "numCycles": t.num_cycles, "clamped": t.clamped, "reason": "", "sliceLen": t.slice_len }),
                TailParams::No { reason } => json!({ "viable": false, "actualMs": 0, "numCycles": 0, "clamped": false, "reason": reason, "sliceLen": e - x.s }),
            })
        } else {
            None
        };
        let x = *x;
        let attack = p.attack_ms(&x);
        let c = self.chop(id)?;
        let out_len = c.render(i as usize).map_or(0, |r| r.len());
        Ok(json!({ "m": m, "note": note, "attackMs": attack, "inLen": x.e - x.s, "outLen": out_len, "tail": tail }))
    }

    /// `chopWriteAll`: every slice not muted, as `chopSliceWav` makes it,
    /// then the MIDI file and the SFZ if asked for. Beside a file from disk,
    /// in `<its folder>/<stem> slices/`; a sound from MGL's library, in
    /// `<home>/slices/<stem> slices/`. Nothing is written over.
    fn chop_write(&mut self, id: u32) -> Result<Value, AppError> {
        let c = self.chop_ref(id)?;
        let Some(p) = &c.page else { return Err(bad("Chop a sound first: cable a Sound in")) };
        if p.slices.is_empty() {
            return Err(bad("No slices to write"));
        }
        let f = &c.facts;
        let folder_name = safe(&format!("{} slices", f.stem));
        let dir = if f.kind == "library" || f.file.is_empty() {
            let home = c.home.as_ref().ok_or_else(|| bad("Chop has no home to write the library's slices to"))?;
            home.join("slices").join(&folder_name)
        } else {
            Path::new(&f.file).parent().unwrap_or(Path::new("")).join(&folder_name)
        };
        std::fs::create_dir_all(&dir).map_err(|e| bad(format!("{}: {e}", dir.display())))?;
        let put = |name: &str, bytes: &[u8]| -> Result<String, AppError> {
            let path = unique(dir.join(safe(name)));
            std::fs::write(&path, bytes).map_err(|e| bad(format!("{}: {e}", path.display())))?;
            Ok(path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default())
        };
        let mut written = Vec::new();
        let mut names = Vec::new();
        for i in (0..p.slices.len()).filter(|&i| !p.slices[i].muted) {
            names.push(put(&chop::slice_name(&f.stem, i), &p.slice_wav(i))?);
            written.push(i);
        }
        let mut extra = Vec::new();
        let mut files = names.clone();
        if truth(c.cp().get("outMidi")) {
            files.push(put(&format!("{}.mid", f.stem), &p.midi(&written))?);
            extra.push("MIDI");
        }
        if truth(c.cp().get("outSfz")) {
            files.push(put(&format!("{}.sfz", f.stem), p.sfz(&f.stem, &names).as_bytes())?);
            extra.push("SFZ");
        }
        let folder = dir.to_string_lossy().to_string();
        let said = format!("Wrote {} slices{} to {folder}", written.len(), if extra.is_empty() { String::new() } else { format!(" and the {}", extra.join(" and ")) });
        Ok(json!({ "said": said, "folder": folder, "names": files }))
    }

    /// `chopToRegions`: a region a slice not muted, in the cabled Sound's
    /// regions, beside what is there; one with the same ends is not added twice.
    fn chop_to_regions(&mut self, id: u32) -> Result<Value, AppError> {
        let sound = self.chop_sound(id);
        let c = self.chop_ref(id)?;
        let (Some(sound), Some(p)) = (sound, &c.page) else { return Ok(json!({ "said": "Chop the selected sound first", "added": 0 })) };
        let stem = c.facts.stem.clone();
        let slices = p.slices.clone();
        let Some(Part::Sound(s)) = self.modules.get_mut(&sound).map(|m| &mut m.part) else { return Err(AppError::NoSuchModule(sound)) };
        let regions = &mut s.annotations.regions;
        let have: std::collections::HashSet<(u64, u64)> = regions.iter().map(|r| (r.start, r.end)).collect();
        let mut added = 0;
        for (i, x) in slices.iter().enumerate() {
            let key = (x.s.max(0) as u64, x.e.max(0) as u64);
            if x.muted || have.contains(&key) {
                continue;
            }
            regions.push(crate::annot::Region { start: key.0, end: key.1, label: format!("{stem} {}", i + 1) });
            added += 1;
        }
        regions.sort_by_key(|r| r.start);
        let said = if added > 0 { format!("{added} slices added to Regions") } else { "Every slice is in Regions already".into() };
        Ok(json!({ "said": said, "added": added }))
    }

    /// The preset bar (`405b-chop-presets.js`'s adapter): `list`, `save`,
    /// `load`, `rename`, `remove`, `init`.
    fn chop_presets(&mut self, id: u32, v: &Value) -> Result<Value, AppError> {
        let op = v.get("op").and_then(Value::as_str).unwrap_or("list");
        let name = v.get("name").and_then(Value::as_str).unwrap_or("").to_string();
        if op == "init" {
            let c = self.chop(id)?;
            c.preset.clear();
            c.apply(&Map::new());
            c.detect();
            return Ok(json!({ "state": c.state_json() }));
        }
        let c = self.chop(id)?;
        let path = c.home.as_ref().ok_or_else(|| bad("Chop has no home for its presets"))?.join("presets").join("chop").join("presets.json");
        let list = read_presets(&path);
        let nm = |p: &Value| p.get("name").and_then(Value::as_str).unwrap_or("").to_string();
        match op {
            "list" => {}
            "save" => {
                if name.trim().is_empty() {
                    return Err(bad("a preset needs a name"));
                }
                let mut l: Vec<Value> = list.into_iter().filter(|p| nm(p) != name).collect();
                l.push(json!({ "name": name, "cp": c.cp() }));
                store_presets(&path, l)?;
                c.preset = name;
                c.touch();
            }
            "load" => {
                let got = list.iter().find(|p| nm(p) == name).ok_or_else(|| bad("That preset is gone"))?;
                let cp = got.get("cp").and_then(Value::as_object).cloned().unwrap_or_default();
                c.preset = name;
                c.apply(&cp);
            }
            "rename" => {
                let to = v.get("to").and_then(Value::as_str).unwrap_or("").to_string();
                if to.trim().is_empty() {
                    return Err(bad("a preset needs a name"));
                }
                let l = list
                    .into_iter()
                    .map(|mut p| {
                        if nm(&p) == name {
                            p["name"] = json!(to);
                        }
                        p
                    })
                    .collect();
                store_presets(&path, l)?;
                if c.preset == name {
                    c.preset = to;
                }
                c.touch();
            }
            "remove" => {
                store_presets(&path, list.into_iter().filter(|p| nm(p) != name).collect())?;
                if c.preset == name {
                    c.preset.clear();
                }
                c.touch();
            }
            other => return Err(bad(format!("no preset op {other:?}"))),
        }
        let c = self.chop_ref(id)?;
        let listed: Vec<Value> = read_presets(&path)
            .iter()
            .map(|p| json!({ "name": nm(p), "tag": chop_part::preset_tag(p.get("cp").and_then(Value::as_object).unwrap_or(&Map::new())) }))
            .collect();
        Ok(json!({ "presets": listed, "state": c.state_json() }))
    }

    /// `chop.mono` from `from` into `out`; the sound's length (0: none).
    pub fn chop_mono(&self, id: u32, from: i64, out: &mut [f32]) -> Result<usize, AppError> {
        let c = self.chop_ref(id)?;
        let Some(p) = &c.page else {
            out.fill(0.0);
            return Ok(0);
        };
        for (k, o) in out.iter_mut().enumerate() {
            let i = from + k as i64;
            *o = if i >= 0 { p.mono.get(i as usize).copied().unwrap_or(0.0) } else { 0.0 };
        }
        Ok(p.mono.len())
    }

    /// One of the analysis's arrays into `out`; F (0 until measured).
    pub fn chop_analysis(&self, id: u32, which: u32, out: &mut [f32]) -> Result<usize, AppError> {
        let c = self.chop_ref(id)?;
        let Some(a) = c.analysis(which) else { return Ok(0) };
        let n = out.len().min(a.len());
        out[..n].copy_from_slice(&a[..n]);
        Ok(a.len())
    }

    /// Slice `i`'s first channel as it sounds now into `out`; its length.
    pub fn chop_render(&mut self, id: u32, i: i64, out: &mut [f32]) -> Result<usize, AppError> {
        let c = self.chop(id)?;
        let Some(r) = usize::try_from(i).ok().and_then(|i| c.render(i)) else { return Err(bad(format!("no slice {i}"))) };
        let n = out.len().min(r.len());
        out[..n].copy_from_slice(&r[..n]);
        Ok(r.len())
    }

    /// What plays now, its first channel, from where it has got to.
    pub fn chop_out(&self, id: u32, out: &mut [f32]) -> Result<usize, AppError> {
        Ok(self.chop_ref(id)?.out(out))
    }

    /// Chop module `id`'s page (tests).
    pub fn chop_page(&self, id: u32) -> Option<&engine_mgl::chop::Page> {
        self.chop_ref(id).ok()?.page.as_ref()
    }
}

