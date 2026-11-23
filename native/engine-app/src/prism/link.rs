//! Prism on the canvas: its Sound cable, and everything its face asks.
//!
//! The Sound socket is the app's, as Grain's is: a Sound module cabled in
//! hands the deck its document's sound (rendered for a deck), and a new
//! edit there is a new sound here. Prism has no Notes socket: nothing plays
//! it by notes, in MGL or here.

use super::PrismPart;
use crate::sound_part::SoundPart;
use crate::{engine_id, AppError, Part, Session, Wire};
use engine_core::Kind;
use serde_json::{json, Value};

fn bad(why: impl Into<String>) -> AppError {
    AppError::BadFile(why.into())
}

impl Session {
    pub(crate) fn add_prism(&mut self, id: u32, saved: Option<&Value>) -> Result<Part, AppError> {
        let (part, deck) = PrismPart::new(self.rate, saved.and_then(|s| s.get("prism")));
        self.ctl.add(engine_id(id, 0), Box::new(deck))?;
        Ok(Part::Prism(Box::new(part)))
    }

    fn prism(&mut self, id: u32) -> Result<&mut PrismPart, AppError> {
        match self.modules.get_mut(&id).map(|m| &mut m.part) {
            Some(Part::Prism(g)) => Ok(g),
            _ => Err(AppError::NoSuchModule(id)),
        }
    }

    fn prism_ref(&self, id: u32) -> Result<&PrismPart, AppError> {
        match self.modules.get(&id).map(|m| &m.part) {
            Some(Part::Prism(g)) => Ok(g),
            _ => Err(AppError::NoSuchModule(id)),
        }
    }

    /// The Sound module cabled into Prism module `id`, if any.
    pub fn prism_sound(&self, id: u32) -> Option<u32> {
        self.wires.iter().find(|w| w.to == (id, 0)).map(|w| w.from.0).filter(|s| matches!(self.modules.get(s).map(|m| &m.part), Some(Part::Sound(_))))
    }

    fn prism_doc(&self, id: u32) -> Result<(u32, &SoundPart), AppError> {
        match self.prism_sound(id) {
            Some(s) => match self.modules.get(&s).map(|m| &m.part) {
                Some(Part::Sound(p)) => Ok((s, p)),
                _ => Err(AppError::NoSuchModule(s)),
            },
            None => Ok((0, &self.prism_ref(id)?.own)),
        }
    }

    /// A cable into Prism's Sound socket, or out of it: the app's own.
    pub(crate) fn prism_connect(&mut self, from: (u32, u32), to: (u32, u32), on: bool) -> Option<Result<(), AppError>> {
        if to.1 != 0 || !matches!(self.modules.get(&to.0).map(|m| &m.part), Some(Part::Prism(_))) {
            return None;
        }
        let out_kind = self.modules.get(&from.0).and_then(|m| m.kind.outs.get(from.1 as usize)).map(|(_, k)| *k);
        let wire = Wire { from, to };
        if !on {
            let Some(at) = self.wires.iter().position(|w| *w == wire) else { return Some(Err(AppError::NoSuchSocket)) };
            self.wires.remove(at);
            self.prism_sync();
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
        self.prism_sync();
        Some(Ok(()))
    }

    /// Keep every Prism's deck on its sound: a new one (cabled, uncabled,
    /// edited) is loaded, as `/api/prism/load` loads one.
    pub(crate) fn prism_sync(&mut self) {
        let ids: Vec<u32> = self.modules.iter().filter(|(_, m)| matches!(m.part, Part::Prism(_))).map(|(id, _)| *id).collect();
        for id in ids {
            let Ok((from, doc)) = self.prism_doc(id) else { continue };
            let serial = doc.serial;
            if self.prism_ref(id).map(|g| g.fed()).unwrap_or(None) == Some((from, serial)) {
                continue;
            }
            let o = doc.origin();
            let path = o.get("path").or_else(|| o.get("file")).and_then(Value::as_str).unwrap_or("").to_string();
            let name = o.get("name").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| path.rsplit(['/', '\\']).next().unwrap_or("").to_string());
            let o_file = o.get("file").and_then(Value::as_str).unwrap_or("").to_string();
            let source = doc.grain_source();
            let Ok(g) = self.prism(id) else { continue };
            g.sound_file = o_file;
            if let Some(src) = source {
                g.load(from, serial, src, &name, &path);
            }
        }
    }

    pub(crate) fn prism_collect(&mut self) {
        for m in self.modules.values() {
            if let Part::Prism(g) = &m.part {
                g.handle.collect();
            }
        }
    }

    /// One of Prism module `id`'s calls (see `na_prism_call`).
    pub fn prism_call(&mut self, id: u32, what: &str, v: &Value) -> Result<Value, AppError> {
        let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
        let n = |k: &str| v.get(k).and_then(Value::as_f64).unwrap_or(0.0);
        let t = n("t");
        let g = self.prism(id)?;
        Ok(match what {
            "view" => g.view(),
            "tick" => {
                g.tick(t);
                g.view()
            }
            "state" => g.deck_state(),
            "stretch" => g.stretch_post(v),
            "pad" => g.pad_post(v),
            "glide" => g.glide_post(v).map_err(bad)?,
            "transport" => g.transport(v),
            "rack" => match v.get("op").and_then(Value::as_str).unwrap_or("get") {
                "get" => g.rack.to_json(),
                "set" => g.rack_set(v),
                "param" => {
                    let live = matches!(v.get("live"), Some(Value::Bool(true)));
                    g.rack_param(&s("id"), &s("key"), n("value") as f32, live).map_err(bad)?
                }
                other => return Err(bad(format!("no rack op {other:?}"))),
            },
            "pitchtime" => g.pitch_time(v),
            "sources" => g.pad_sources(),
            "fx" => super::fx().clone(),
            "presets" => {
                if v.get("op").and_then(Value::as_str) == Some("places") {
                    g.places = super::presets::Places::from_json(v);
                    g.presets(&json!({ "op": "list" })).map_err(bad)?
                } else {
                    g.presets(v).map_err(bad)?
                }
            }
            "padop" => {
                g.pad_op(v).map_err(bad)?;
                g.view()
            }
            "lfo" => {
                g.lfo_op(v).map_err(bad)?;
                g.view()
            }
            "source" => {
                g.use_source(&s("id"), t);
                g.view()
            }
            "pick" => {
                g.pick(&s("kind"), &s("id"), t);
                g.view()
            }
            "axis" => {
                g.axis_changed(&s("axis"), &s("key"));
                g.view()
            }
            "limit" => {
                g.limit_changed(&s("field"), n("v"));
                g.view()
            }
            "setting" => {
                g.setting(&s("key"), n("v"), matches!(v.get("commit"), Some(Value::Bool(true))));
                g.view()
            }
            "ptc" => {
                g.ptc_toggle();
                g.view()
            }
            "fader" => {
                g.fader(&s("key"), n("v"));
                g.view()
            }
            "postRoll" => {
                g.post_roll(n("v"));
                g.view()
            }
            "engine" => {
                g.set_engine(&s("v"));
                g.view()
            }
            "chainAdd" => {
                g.chain_add(&s("kind"));
                g.view()
            }
            "chainRemove" => {
                g.chain_remove(&s("id"));
                g.view()
            }
            // The Now Playing bar, Prism's own on its page.
            "deck" => {
                match s("op").as_str() {
                    "play" => {
                        let on = !g.playing();
                        if on && g.source_sound().is_none() {
                            return Err(bad("Choose a sound for Prism first"));
                        }
                        g.transport(&json!({ "play": on }));
                    }
                    "stop" => {
                        g.transport(&json!({ "play": false, "seek": 0 }));
                    }
                    "loop" => {
                        g.looping = !g.looping;
                        let on = g.looping;
                        g.transport(&json!({ "loop": { "on": on, "a": 0, "b": 0 } }));
                    }
                    "seek" => {
                        let ratio = g.stretch.get("ratio").and_then(Value::as_f64).unwrap_or(1.0);
                        let frame = (n("u").clamp(0.0, 1.0) * g.frames as f64 * if ratio == 0.0 { 1.0 } else { ratio }).round();
                        g.transport(&json!({ "seek": frame }));
                    }
                    other => return Err(bad(format!("no deck op {other:?}"))),
                }
                g.view()
            }
            "ui" => {
                g.ui = v.clone();
                Value::Bool(true)
            }
            "info" => json!({ "state": g.state(), "ui": g.ui }),
            other => return Err(bad(format!("no Prism call {other:?}"))),
        })
    }

    /// The deck's sound's peaks in `cols` columns, and their largest.
    pub fn prism_peaks(&self, id: u32, cols: usize, out: &mut Vec<f32>) -> Result<f32, AppError> {
        Ok(self.prism_ref(id)?.peaks(cols, out))
    }
}
