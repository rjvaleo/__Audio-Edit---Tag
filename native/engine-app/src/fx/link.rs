//! The FX modules on the canvas: added, and their calls (`na_fx_call`).

use super::{catalogue_json, effect, FxPart, LEVELS, PLAYER, RACK, SUM};
use crate::{engine_id, AppError, Part, Session};
use engine_core::port;
use serde_json::{json, Value};

fn bad(why: impl Into<String>) -> AppError {
    AppError::BadFile(why.into())
}

impl Session {
    pub(crate) fn add_fx(&mut self, id: u32, kind: &str, saved: Option<&Value>) -> Result<Part, AppError> {
        let e = match kind.strip_prefix("fx:") {
            Some(_) => Some(effect(kind).ok_or_else(|| AppError::NoSuchKind(kind.into()))?),
            None => None,
        };
        let mut part = FxPart::new(e, self.rate, saved.and_then(|s| s.get("fx")));
        if part.is_page() {
            let (p, s, r, l) = (engine_id(id, PLAYER), engine_id(id, SUM), engine_id(id, RACK), engine_id(id, LEVELS));
            self.ctl.add(p, Box::new(engine_mgl::EditPlayer::new(part.transport.clone())))?;
            self.ctl.add(s, Box::new(engine_core::basics::Mix::new(2)))?;
            self.ctl.add(r, Box::new(part.rack_module(self.rate)))?;
            self.ctl.add(l, Box::new(part.levels_module()))?;
            self.ctl.connect(port(p, 0), port(s, 0))?;
            self.ctl.connect(port(s, 0), port(r, 0))?;
            self.ctl.connect(port(r, 0), port(l, 0))?;
            part.lay(&mut self.ctl, r, self.max_block)?;
        } else {
            let r = engine_id(id, 0);
            self.ctl.add(r, Box::new(part.rack_module(self.rate)))?;
            part.lay(&mut self.ctl, r, self.max_block)?;
        }
        Ok(Part::Fx(Box::new(part)))
    }

    fn fx(&mut self, id: u32) -> Result<&mut FxPart, AppError> {
        match self.modules.get_mut(&id).map(|m| &mut m.part) {
            Some(Part::Fx(f)) => Ok(f),
            _ => Err(AppError::NoSuchModule(id)),
        }
    }

    pub fn fx_ref(&self, id: u32) -> Result<&FxPart, AppError> {
        match self.modules.get(&id).map(|m| &m.part) {
            Some(Part::Fx(f)) => Ok(f),
            _ => Err(AppError::NoSuchModule(id)),
        }
    }

    /// The engine module a canvas FX module's rack is.
    fn fx_rack_id(&self, id: u32) -> Result<u32, AppError> {
        Ok(if self.fx_ref(id)?.is_page() { engine_id(id, RACK) } else { engine_id(id, 0) })
    }

    /// The Sound module cabled into FX page `id`, if any.
    pub fn fx_sound(&self, id: u32) -> Option<u32> {
        self.wires.iter().find(|w| w.to == (id, 0)).map(|w| w.from.0)
    }

    /// One of FX module `id`'s calls, as `na_fx_call` names them:
    /// - `"catalogue"`: MGL's `/api/fx`;
    /// - `"rack"`: `{op: get | set | param | add | remove | move | bypass}`, MGL's
    ///   `/api/rack` and `/api/rack/param` (and the page's own add, remove,
    ///   move and power);
    /// - `"transport"`: `{play, seek, loop, volume, sideL, sideR}`;
    /// - `"levels"`: the meters since the last reading;
    /// - `"info"`: the rack, the face's own, the transport, the effect;
    /// - `"ui"`: keep the face's own state.
    pub fn fx_call(&mut self, id: u32, what: &str, v: &Value) -> Result<Value, AppError> {
        if what == "catalogue" {
            return Ok(catalogue_json());
        }
        let rack = self.fx_rack_id(id)?;
        let max_block = self.max_block;
        match what {
            "rack" => self.fx_rack(id, rack, max_block, v),
            "transport" => {
                let levels = engine_id(id, LEVELS);
                let (ctl, f) = self.ctl_and_fx(id)?;
                Ok(f.transport_msg(ctl, levels, v)?)
            }
            "levels" => Ok(self.fx_ref(id)?.levels()),
            "info" => {
                let mut o = self.fx_ref(id)?.info();
                o["sound"] = json!(self.fx_sound(id));
                Ok(o)
            }
            "ui" => {
                self.fx(id)?.ui = v.clone();
                Ok(Value::Bool(true))
            }
            other => Err(bad(format!("no FX call {other:?}"))),
        }
    }

    fn ctl_and_fx(&mut self, id: u32) -> Result<(&mut engine_core::Controller, &mut FxPart), AppError> {
        match self.modules.get_mut(&id).map(|m| &mut m.part) {
            Some(Part::Fx(f)) => Ok((&mut self.ctl, f)),
            _ => Err(AppError::NoSuchModule(id)),
        }
    }

    fn fx_rack(&mut self, id: u32, rack: u32, max_block: usize, v: &Value) -> Result<Value, AppError> {
        let at = |k: &str| v.get(k).and_then(Value::as_u64).map(|n| n as usize);
        let (ctl, f) = self.ctl_and_fx(id)?;
        match v.get("op").and_then(Value::as_str).unwrap_or("get") {
            "get" => Ok(f.rack.to_json()),
            "set" => Ok(f.rack_set(ctl, rack, max_block, v)?),
            "param" => {
                let slot = v.get("id").and_then(Value::as_str).ok_or_else(|| bad("no slot given"))?;
                let key = v.get("key").and_then(Value::as_str).ok_or_else(|| bad("no control given"))?;
                let value = v.get("value").and_then(Value::as_f64).ok_or_else(|| bad("no value given"))? as f32;
                let live = matches!(v.get("live"), Some(Value::Bool(true)));
                f.rack_param(ctl, rack, slot, key, value, live).map_err(bad)
            }
            "bypass" => {
                let i = at("at").ok_or_else(|| bad("no slot given"))?;
                if !f.bypass(ctl, rack, i, v.get("on").and_then(Value::as_bool))? {
                    return Err(bad("no such slot"));
                }
                Ok(f.rack.to_json())
            }
            op @ ("add" | "remove" | "move") => {
                let mut spec = f.rack.clone();
                let ok = match op {
                    "add" => spec.insert(v.get("kind").and_then(Value::as_str).unwrap_or(""), at("at")),
                    "remove" => at("at").is_some_and(|i| spec.remove(i)),
                    _ => matches!((at("from"), at("to")), (Some(a), Some(b)) if spec.reorder(a, b)),
                };
                if !ok {
                    return Err(bad("the rack could not do that"));
                }
                Ok(f.rack_set(ctl, rack, max_block, &spec.to_json())?)
            }
            other => Err(bad(format!("no rack op {other:?}"))),
        }
    }
}
