//! Browse and Library on the canvas: the audition, the cable into Sound
//! modules, and the page's own state (see `browse_part.rs`).

use crate::browse_part::{BrowsePart, Page, PLAYER, SOURCE};
use crate::{engine_id, AppError, Part, Session, Wire};
use engine_core::{port, Kind};
use serde_json::{json, Value};
use std::sync::Arc;

fn bad(why: impl Into<String>) -> AppError {
    AppError::BadFile(why.into())
}

impl Session {
    pub(crate) fn add_browse(&mut self, id: u32, page: Page, saved: Option<&Value>) -> Result<Part, AppError> {
        let part = BrowsePart::new(page, saved.and_then(|s| s.get("browse")));
        let (s, p) = (engine_id(id, SOURCE), engine_id(id, PLAYER));
        self.ctl.add(s, Box::new(engine_core::basics::SoundSource::new()))?;
        self.ctl.add(p, Box::new(engine_mgl::EditPlayer::new(part.transport.clone())))?;
        self.ctl.connect(port(s, 0), port(p, 0))?;
        Ok(Part::Browse(Box::new(part)))
    }

    fn browse(&mut self, id: u32) -> Result<&mut BrowsePart, AppError> {
        match self.modules.get_mut(&id).map(|m| &mut m.part) {
            Some(Part::Browse(b)) => Ok(b),
            _ => Err(AppError::NoSuchModule(id)),
        }
    }

    fn browse_ref(&self, id: u32) -> Result<&BrowsePart, AppError> {
        match self.modules.get(&id).map(|m| &m.part) {
            Some(Part::Browse(b)) => Ok(b),
            _ => Err(AppError::NoSuchModule(id)),
        }
    }

    /// The Sound modules cabled from Browse (or Library) module `id`.
    pub fn browse_sounds(&self, id: u32) -> Vec<u32> {
        self.wires
            .iter()
            .filter(|w| w.from == (id, 0) && matches!(self.modules.get(&w.to.0).map(|m| &m.part), Some(Part::Sound(_))))
            .map(|w| w.to.0)
            .collect()
    }

    /// A cable from Browse's or Library's Sound socket into a Sound module's
    /// Library socket, or off it: the app's own, as Grain's Sound cable is.
    pub(crate) fn browse_connect(&mut self, from: (u32, u32), to: (u32, u32), on: bool) -> Option<Result<(), AppError>> {
        let into_sound = to.1 == 0 && matches!(self.modules.get(&to.0).map(|m| &m.part), Some(Part::Sound(_)));
        let from_browse = matches!(self.modules.get(&from.0).map(|m| &m.part), Some(Part::Browse(_))) && from.1 == 0;
        if !into_sound && !from_browse {
            return None;
        }
        let wire = Wire { from, to };
        if !on {
            let at = self.wires.iter().position(|w| *w == wire)?;
            self.wires.remove(at);
            return Some(Ok(()));
        }
        if !into_sound {
            // Browse's Sound goes only into a Sound module.
            return Some(Err(if self.modules.get(&to.0).and_then(|m| m.kind.ins.get(to.1 as usize)).is_none() { AppError::NoSuchSocket } else { AppError::KindsDiffer }));
        }
        let out_kind = self.modules.get(&from.0).and_then(|m| m.kind.outs.get(from.1 as usize)).map(|(_, k)| *k);
        match out_kind {
            None => return Some(Err(AppError::NoSuchSocket)),
            Some(Kind::Sound) if from_browse => {}
            Some(_) => return Some(Err(AppError::KindsDiffer)),
        }
        if self.wires.contains(&wire) {
            return Some(Ok(()));
        }
        if self.wires.iter().any(|w| w.to == to) {
            return Some(Err(AppError::Taken));
        }
        self.wires.push(wire);
        Some(Ok(()))
    }

    /// One of Browse (or Library) module `id`'s calls, `what` naming it:
    /// - `"info"`: what is heard, whether it plays, where, the page's state;
    /// - `"ui"` (`{...}`): the page's own state, kept;
    /// - `"play"` (`{file, path, name}`): MGL's `playFile`: the same sound
    ///   again plays or pauses it; another is opened as it is and played
    ///   from its start;
    /// - `"pause"`, `"stop"` (pause, and the head back to the start), `"seek"`
    ///   (`{frame}`, the file's frames), `"loop"` (`{on}`, the whole sound);
    /// - `"open"` (`{file, path, name}`): the sound chosen, opened in every
    ///   Sound module cabled from this one (`{opened: [ids]}`);
    /// - `"cabled"`: those Sound modules.
    pub fn browse_call(&mut self, id: u32, what: &str, v: &Value) -> Result<Value, AppError> {
        let rate = self.rate;
        match what {
            "info" => Ok(self.browse_ref(id)?.info(rate)),
            "ui" => {
                self.browse(id)?.ui = v.clone();
                Ok(json!({ "ok": true }))
            }
            "play" => {
                let file = v.get("file").and_then(Value::as_str).ok_or_else(|| bad("no file"))?.to_string();
                let b = self.browse(id)?;
                let same = b.heard.as_ref().and_then(|h| h.get("file")).and_then(Value::as_str) == Some(file.as_str());
                if same && b.own.is_open() {
                    let on = !b.transport.is_playing();
                    // It ran to its end: Play plays it again from the top (the
                    // page drops back to the cue when the sound ends).
                    let (at, frames) = b.head(rate);
                    if on && frames > 0.0 && at >= frames - 1.0 {
                        b.transport.seek(0);
                    }
                    b.transport.play(on);
                    return Ok(b.info(rate));
                }
                let bytes = std::fs::read(&file).map_err(|e| bad(format!("{file}: {e}")))?;
                b.transport.play(false);
                let origin = json!({ "kind": "library", "file": file, "path": v.get("path").cloned().unwrap_or(Value::Null), "name": v.get("name").cloned().unwrap_or(Value::Null) });
                b.own.open(Arc::from(bytes.into_boxed_slice()), origin, rate as u32).map_err(bad)?;
                b.heard = Some(v.clone());
                b.serial += 1;
                let (bank, source) = (id, engine_id(id, SOURCE));
                if bank == 0 || bank as usize >= engine_core::MAX_SOUNDS {
                    return Err(bad("too many modules for the sound bank"));
                }
                let Some(Part::Browse(b)) = self.modules.get_mut(&id).map(|m| &mut m.part) else { return Err(AppError::NoSuchModule(id)) };
                b.own.hand_over(&mut self.ctl, bank, source)?;
                b.transport.seek(0);
                b.transport.play(true);
                Ok(b.info(rate))
            }
            "pause" => {
                let b = self.browse(id)?;
                b.transport.play(false);
                Ok(b.info(rate))
            }
            "stop" => {
                let b = self.browse(id)?;
                b.transport.play(false);
                b.transport.seek(0);
                Ok(b.info(rate))
            }
            "seek" => {
                let b = self.browse(id)?;
                let f = v.get("frame").and_then(Value::as_f64).unwrap_or(0.0);
                let file_rate = b.own.file_rate();
                b.transport.seek(crate::edit_part::to_bank(f, file_rate, rate));
                Ok(b.info(rate))
            }
            "loop" => {
                let b = self.browse(id)?;
                let on = v.get("on").and_then(Value::as_bool).unwrap_or(false);
                // The selection's ends, in the file's frames; none is the whole sound.
                let file_rate = b.own.file_rate();
                let end = |k: &str| v.get(k).and_then(Value::as_f64).filter(|f| *f > 0.0).map_or(0, |f| crate::edit_part::to_bank(f, file_rate, rate));
                b.transport.set_loop(on, end("a"), end("b"));
                Ok(b.info(rate))
            }
            "gain" => {
                let b = self.browse(id)?;
                b.transport.set_gain(v.get("gain").and_then(Value::as_f64).unwrap_or(1.0) as f32);
                Ok(b.info(rate))
            }
            "open" => {
                let file = v.get("file").and_then(Value::as_str).ok_or_else(|| bad("no file"))?.to_string();
                self.browse_ref(id)?;
                let origin = json!({ "kind": "library", "path": v.get("path").cloned().unwrap_or(Value::Null), "name": v.get("name").cloned().unwrap_or(Value::Null) });
                let mut opened = Vec::new();
                for s in self.browse_sounds(id) {
                    self.sound_open(s, &file, &origin, false)?;
                    opened.push(s);
                }
                Ok(json!({ "opened": opened }))
            }
            "cabled" => Ok(json!({ "sounds": self.browse_sounds(id) })),
            _ => Err(bad(format!("Browse has no call {what:?}"))),
        }
    }
}
