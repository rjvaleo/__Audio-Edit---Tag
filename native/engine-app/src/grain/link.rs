//! Grain on the canvas: its Sound cable, and everything its face asks.
//!
//! The Sound socket is the app's, not the engine's: a Sound module's cable
//! into Grain hands the deck the document's sound (rendered for a deck, as
//! MGL's `live::load`) and its stretch, and keeps them in step as they
//! change, wherever the change was made (Grain's controls, Edit's edits and
//! undo). Grain's Notes socket is its deck's notes input.

use super::presets::{self, Places, Preset};
use super::{stretch, GrainPart};
use crate::sound_part::SoundPart;
use crate::{engine_id, AppError, Part, Session, Wire};
use engine_core::Kind;
use mgl_fx::Stretch;
use serde_json::{json, Value};

fn bad(why: impl Into<String>) -> AppError {
    AppError::BadFile(why.into())
}

impl Session {
    /// Grain module `id`'s part, built with its deck in the engine.
    pub(crate) fn add_grain(&mut self, id: u32, saved: Option<&Value>) -> Result<Part, AppError> {
        let (part, deck) = GrainPart::new(self.rate, saved.and_then(|s| s.get("grain")));
        self.ctl.add(engine_id(id, 0), Box::new(deck))?;
        Ok(Part::Grain(Box::new(part)))
    }

    fn grain(&mut self, id: u32) -> Result<&mut GrainPart, AppError> {
        match self.modules.get_mut(&id).map(|m| &mut m.part) {
            Some(Part::Grain(g)) => Ok(g),
            _ => Err(AppError::NoSuchModule(id)),
        }
    }

    fn grain_ref(&self, id: u32) -> Result<&GrainPart, AppError> {
        match self.modules.get(&id).map(|m| &m.part) {
            Some(Part::Grain(g)) => Ok(g),
            _ => Err(AppError::NoSuchModule(id)),
        }
    }

    /// The Sound module cabled into Grain module `id`, if any.
    pub fn grain_sound(&self, id: u32) -> Option<u32> {
        self.wires.iter().find(|w| w.to == (id, 0)).map(|w| w.from.0).filter(|s| matches!(self.modules.get(s).map(|m| &m.part), Some(Part::Sound(_))))
    }

    /// The document Grain module `id` plays: the cabled Sound's, or its own.
    fn grain_doc(&self, id: u32) -> Result<(u32, &SoundPart), AppError> {
        match self.grain_sound(id) {
            Some(s) => match self.modules.get(&s).map(|m| &m.part) {
                Some(Part::Sound(p)) => Ok((s, p)),
                _ => Err(AppError::NoSuchModule(s)),
            },
            None => Ok((0, &self.grain_ref(id)?.own)),
        }
    }

    fn grain_doc_mut(&mut self, id: u32) -> Result<(u32, &mut SoundPart), AppError> {
        match self.grain_sound(id) {
            Some(s) => match self.modules.get_mut(&s).map(|m| &mut m.part) {
                Some(Part::Sound(p)) => Ok((s, p)),
                _ => Err(AppError::NoSuchModule(s)),
            },
            None => Ok((0, &mut self.grain(id)?.own)),
        }
    }

    /// The stretch of Grain module `id`'s document.
    fn grain_stretch(&self, id: u32) -> Stretch {
        self.grain_doc(id).ok().and_then(|(_, d)| d.list().map(|l| l.stretch)).unwrap_or_default()
    }

    /// A cable into Grain's Sound socket, or out of it: the app's own.
    /// `None` when the cable is not one of those.
    pub(crate) fn grain_connect(&mut self, from: (u32, u32), to: (u32, u32), on: bool) -> Option<Result<(), AppError>> {
        if to.1 != 0 || !matches!(self.modules.get(&to.0).map(|m| &m.part), Some(Part::Grain(_))) {
            return None;
        }
        let out_kind = self.modules.get(&from.0).and_then(|m| m.kind.outs.get(from.1 as usize)).map(|(_, k)| *k);
        let wire = Wire { from, to };
        if !on {
            let Some(at) = self.wires.iter().position(|w| *w == wire) else { return Some(Err(AppError::NoSuchSocket)) };
            self.wires.remove(at);
            self.grain_sync();
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
        self.grain_sync();
        Some(Ok(()))
    }

    /// Keep every Grain's deck in step with its document: a new sound
    /// (cabled, uncabled, edited) is loaded; a new stretch is pushed.
    pub(crate) fn grain_sync(&mut self) {
        let ids: Vec<u32> = self.modules.iter().filter(|(_, m)| matches!(m.part, Part::Grain(_))).map(|(id, _)| *id).collect();
        for id in ids {
            let Ok((from, doc)) = self.grain_doc(id) else { continue };
            let (serial, st_serial) = (doc.serial, doc.stretch_serial);
            let stretch = doc.list().map(|l| l.stretch).unwrap_or_default();
            let fed = self.grain_ref(id).map(|g| g.fed()).unwrap_or(None);
            if fed != Some((from, serial)) {
                let source = self.grain_doc(id).ok().and_then(|(_, d)| d.grain_source());
                let Ok(g) = self.grain(id) else { continue };
                if let Some(src) = source {
                    g.load(from, serial, src, &stretch);
                }
                g.seen_stretch = Some((from, st_serial));
            } else if self.grain_ref(id).map(|g| g.seen_stretch) != Ok(Some((from, st_serial))) {
                let Ok(g) = self.grain(id) else { continue };
                g.push(&stretch);
                g.seen_stretch = Some((from, st_serial));
            }
        }
    }

    /// One of MGL's edit ops on Grain module `id`'s document, as `/api/edit`
    /// takes it (the page's controls post `"stretch"`); its answer, as
    /// `/api/edit` gives it.
    pub fn grain_edit(&mut self, id: u32, op: &Value) -> Result<Value, AppError> {
        let (sound, doc) = self.grain_doc_mut(id)?;
        let (out, changed) = doc.apply(op).map_err(bad)?;
        if changed && sound != 0 {
            self.sound_hand_over(sound)?;
        }
        self.grain_sync();
        Ok(out)
    }

    /// `/api/engine/voice` on Grain module `id`'s keys.
    pub fn grain_keys(&mut self, id: u32, v: &Value) -> Result<Value, AppError> {
        Ok(self.grain(id)?.keys(v))
    }

    /// `/api/engine/transport` on Grain module `id`'s deck.
    pub fn grain_transport(&mut self, id: u32, v: &Value) -> Result<Value, AppError> {
        Ok(self.grain(id)?.transport_msg(v))
    }

    /// The pitch wheel from a MIDI In cable, -1 to 1, as MGL's MIDI bends
    /// the grain keys (by the page's bend range).
    pub(crate) fn grain_wheel(&mut self, id: u32, value: f32) {
        if let Ok(g) = self.grain(id) {
            let range = g.voice.get("bendRange").and_then(Value::as_f64).unwrap_or(2.0) as f32;
            g.handle.keys().set_bend(value * range);
        }
    }

    /// `POST /api/engine/lfos` on Grain module `id`.
    pub fn grain_lfos(&mut self, id: u32, v: &Value) -> Result<Value, AppError> {
        self.grain(id)?.lfos_post(v).map_err(bad)
    }

    /// `GET /api/engine/lfos` on Grain module `id`.
    pub fn grain_lfos_state(&self, id: u32) -> Result<Value, AppError> {
        Ok(self.grain_ref(id)?.lfos_get())
    }

    /// One tick of every Grain's LFOs, `dt` seconds after the last.
    pub fn grain_tick(&mut self, dt: f64) {
        let ids: Vec<u32> = self.modules.iter().filter(|(_, m)| matches!(m.part, Part::Grain(_))).map(|(id, _)| *id).collect();
        for id in ids {
            let doc = self.grain_stretch(id);
            if let Ok(g) = self.grain(id) {
                g.tick(dt, &doc);
            }
        }
    }

    /// The rack: `{op: "get"}`, `{op: "set", ...rack}` (`/api/rack`),
    /// `{op: "param", id, key, value, live}` (`/api/rack/param`),
    /// `{op: "add", kind, at}`, `{op: "remove", at}`, `{op: "move", from, to}`,
    /// `{op: "bypass", at, on}`.
    pub fn grain_rack(&mut self, id: u32, v: &Value) -> Result<Value, AppError> {
        let g = self.grain(id)?;
        let at = |k: &str| v.get(k).and_then(Value::as_u64).map(|n| n as usize);
        match v.get("op").and_then(Value::as_str).unwrap_or("get") {
            "get" => Ok(g.rack_json()),
            "set" => Ok(g.rack_set(v)),
            "param" => {
                let slot = v.get("id").and_then(Value::as_str).ok_or_else(|| bad("no slot given"))?;
                let key = v.get("key").and_then(Value::as_str).ok_or_else(|| bad("no control given"))?;
                let value = v.get("value").and_then(Value::as_f64).ok_or_else(|| bad("no value given"))? as f32;
                let live = matches!(v.get("live"), Some(Value::Bool(true)));
                g.rack_param(slot, key, value, live).map_err(bad)
            }
            op @ ("add" | "remove" | "move" | "bypass") => {
                let mut rack = g.rack.clone();
                let ok = match op {
                    "add" => rack.insert(v.get("kind").and_then(Value::as_str).unwrap_or(""), at("at")),
                    "remove" => at("at").is_some_and(|i| rack.remove(i)),
                    "move" => matches!((at("from"), at("to")), (Some(a), Some(b)) if rack.reorder(a, b)),
                    _ => match at("at").and_then(|i| rack.slots.get_mut(i)) {
                        Some(s) => {
                            let on = v.get("on").and_then(Value::as_bool).unwrap_or(!s.bypassed());
                            s.set_bypassed(on);
                            true
                        }
                        None => false,
                    },
                };
                if !ok {
                    return Err(bad("the rack could not do that"));
                }
                Ok(g.rack_set(&rack.to_json()))
            }
            other => Err(bad(format!("no rack op {other:?}"))),
        }
    }

    /// The presets: `{op: "places", mine, mgl}`, `{op: "list"}`, `{op: "save",
    /// name, note}`, `{op: "apply", name}`, `{op: "update", name, to, note}`,
    /// `{op: "delete", name}`.
    pub fn grain_presets(&mut self, id: u32, v: &Value) -> Result<Value, AppError> {
        let op = v.get("op").and_then(Value::as_str).unwrap_or("list");
        if op == "places" {
            let places = Places::from_json(v);
            self.grain(id)?.places = places;
            return Ok(self.grain(id)?.places.list());
        }
        let places = self.grain_ref(id)?.places.clone();
        match op {
            "list" => Ok(places.list()),
            "save" => {
                let name = v.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
                if name.is_empty() {
                    return Err(bad("a preset needs a name"));
                }
                let stretch = self.grain_stretch(id);
                let path = self.grain_doc(id).ok().and_then(|(_, d)| d.origin().get("path").and_then(Value::as_str).map(str::to_string)).unwrap_or_default();
                let rack = self.grain_ref(id)?.rack.clone();
                let note = v.get("note").and_then(Value::as_str).unwrap_or("").to_string();
                places.store(Preset { name, note, path, stretch, rack }).map_err(bad)
            }
            "apply" => {
                let name = v.get("name").and_then(Value::as_str).ok_or_else(|| bad("no name given"))?;
                let p = places.find(name).ok_or_else(|| bad("no such preset"))?;
                let g = self.grain(id)?;
                let had = g.rack.clone();
                g.rack = presets::rack_with(&had, &p.rack);
                g.hand_rack(Some(&had));
                // The stretch whole, as one edit: MGL's `s.apply(|l| l.stretch = ...)`.
                let op = json!({ "op": "setStretch", "stretch": stretch::to_json(&p.stretch) });
                let out = self.grain_edit(id, &op)?;
                Ok(json!({ "edit": out, "rack": self.grain_ref(id)?.rack_json(), "presets": places.list() }))
            }
            "update" => places.update(v).map_err(bad),
            "delete" => places.delete(v.get("name").and_then(Value::as_str).unwrap_or("")).map_err(bad),
            other => Err(bad(format!("no preset op {other:?}"))),
        }
    }

    /// Everything Grain module `id`'s face shows that is not live: its
    /// document (as `/api/edit` answers), where the sound came from, its
    /// markers and regions, the rack, the LFOs, the keys, the transport's
    /// settings, the face's own.
    pub fn grain_info(&self, id: u32) -> Result<Value, AppError> {
        let (from, doc) = self.grain_doc(id)?;
        let g = self.grain_ref(id)?;
        let mut d = doc.edit_json();
        if let Some(o) = d.as_object_mut() {
            o.insert("annotations".into(), doc.annotations.to_json());
            o.insert("soundModule".into(), json!(from));
        }
        Ok(json!({
            "doc": d,
            "rack": g.rack_json(),
            "lfos": super::lfos::bank_json(&g.bank),
            "voice": Value::Object(g.voice.clone()),
            "transport": Value::Object(g.transport.clone()),
            "ui": g.ui,
            "rate": g.rate(),
        }))
    }

    /// The live read-backs (`/api/engine/grains`).
    pub fn grain_read(&self, id: u32) -> Result<Value, AppError> {
        Ok(self.grain_ref(id)?.grains())
    }

    /// The face's own state, kept for the patch.
    pub fn grain_set_ui(&mut self, id: u32, ui: Value) -> Result<(), AppError> {
        self.grain(id)?.ui = ui;
        Ok(())
    }

    /// The document's edited timeline in `columns` columns over `[from, to)`
    /// (0, 0: the whole): its peaks as `SoundPart::peaks` gives them.
    pub fn grain_peaks(&self, id: u32, from: u64, to: u64, columns: usize, out: &mut Vec<f32>) -> Result<(usize, usize, u64, u64), AppError> {
        Ok(self.grain_doc(id)?.1.peaks(from, to, columns, out))
    }

    /// The document's samples as the page decodes them (mono, the file's
    /// rate), from `from`, into `out`; how many there are in all.
    pub fn grain_mono(&self, id: u32, from: usize, out: &mut [f32]) -> Result<usize, AppError> {
        let (_, doc) = self.grain_doc(id)?;
        let Some(m) = doc.measured() else { return Ok(0) };
        let n = m.mono.len();
        for (i, o) in out.iter_mut().enumerate() {
            *o = m.mono.get(from + i).copied().unwrap_or(0.0);
        }
        Ok(n)
    }

    /// The deck's last moments out, left and right (for the meters and the
    /// wave after the effects); how many frames.
    pub fn grain_scope(&self, id: u32, l: &mut [f32], r: &mut [f32]) -> Result<usize, AppError> {
        let g = self.grain_ref(id)?;
        let Some((a, b, _)) = g.handle.scope() else { return Ok(0) };
        let n = l.len().min(r.len()).min(a.len());
        let off = a.len() - n;
        l[..n].copy_from_slice(&a[off..off + n]);
        r[..n].copy_from_slice(&b[off..off + n]);
        Ok(n)
    }

    /// What Grain module `id`'s deck holds now (tests and the bench).
    pub fn grain_deck_params(&self, id: u32) -> Option<mgl_fx::grain::StreamParams> {
        self.grain_ref(id).ok()?.handle.shared().params()
    }

    /// Sound module `id`'s document's stretch (tests).
    pub fn sound_stretch(&self, id: u32) -> Option<Stretch> {
        match self.modules.get(&id).map(|m| &m.part) {
            Some(Part::Sound(s)) => s.list().map(|l| l.stretch),
            _ => None,
        }
    }

    /// Sound module `id`'s sound as a grain deck plays it (tests).
    pub fn sound_source(&self, id: u32) -> Option<std::sync::Arc<mgl_engine::Source>> {
        match self.modules.get(&id).map(|m| &m.part) {
            Some(Part::Sound(s)) => s.grain_source(),
            _ => None,
        }
    }

    /// Free what the decks have finished with, and keep them in step.
    pub(crate) fn grain_collect(&mut self) {
        for m in self.modules.values() {
            if let Part::Grain(g) = &m.part {
                g.handle.collect();
            }
        }
        self.grain_sync();
    }

    /// Each rack slot's level going in and coming out.
    pub fn grain_rack_levels(&self, id: u32) -> Result<Vec<(f32, f32)>, AppError> {
        Ok(self.grain_ref(id)?.handle.rack_levels())
    }
}
