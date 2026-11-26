//! The FX modules on the canvas: added, and their calls (`na_fx_call`).

use super::{catalogue_json, effect, FxPart, LEVELS, PLAYER, RACK, SUM};
use crate::{engine_id, AppError, Part, Session};
use engine_core::port;
use serde_json::{json, Value};

fn op_is(v: &Value, op: &str) -> bool {
    v.get("op").and_then(Value::as_str) == Some(op)
}

/// A new slot's id, as the page makes one (`fx-<time>-<random>`), unique here.
fn fresh_id() -> String {
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    format!("{:x}-{}", t, N.fetch_add(1, std::sync::atomic::Ordering::Relaxed))
}

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
            "presets" => self.fx_presets(id, rack, max_block, v),
            other => Err(bad(format!("no FX call {other:?}"))),
        }
    }

    /// The page's preset bar (Grain's, MGL's `PRESETS.json` shape): `{op:
    /// "places", mine, mgl}`, `list`, `save` (the rack, under `name`), `apply`
    /// (a preset's rack settings onto the slots there, as MGL's apply moves
    /// them; the stretch is Grain's, for the document, and stays there),
    /// `update`, `delete`, and A/B: `{op: "ab", to: "a" | "b"}` (the rack
    /// kept for the side left, the other side's put back).
    fn fx_presets(&mut self, id: u32, rack: u32, max_block: usize, v: &Value) -> Result<Value, AppError> {
        use crate::grain::presets::{self, Places, Preset};
        let op = v.get("op").and_then(Value::as_str).unwrap_or("list");
        let (ctl, f) = self.ctl_and_fx(id)?;
        if op == "places" {
            f.places = Places::from_json(v);
            return Ok(f.places.list());
        }
        let places = f.places.clone();
        match op {
            "list" => Ok(places.list()),
            "save" => {
                let name = v.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
                if name.is_empty() {
                    return Err(bad("a preset needs a name"));
                }
                let note = v.get("note").and_then(Value::as_str).unwrap_or("").to_string();
                let out = places.store(Preset { name: name.clone(), note, path: String::new(), stretch: Default::default(), rack: f.rack.clone() }).map_err(bad)?;
                f.preset = name;
                Ok(out)
            }
            "apply" => {
                let name = v.get("name").and_then(Value::as_str).ok_or_else(|| bad("no name given"))?;
                let p = places.find(name).ok_or_else(|| bad("no such preset"))?;
                let next = presets::rack_with(&f.rack, &p.rack);
                f.rack = next;
                f.preset = name.to_string();
                f.lay(ctl, rack, max_block)?;
                Ok(json!({ "rack": f.rack.to_json(), "preset": f.preset }))
            }
            "ab" => {
                let to = if v.get("to").and_then(Value::as_str) == Some("b") { 1 } else { 0 };
                if to != f.side {
                    let keep = f.rack.clone();
                    let other = f.ab[to].take();
                    f.ab[f.side] = Some(keep.clone());
                    f.side = to;
                    if let Some(r) = other {
                        f.rack = r;
                        f.lay(ctl, rack, max_block)?;
                    } else {
                        f.ab[to] = Some(keep);
                    }
                }
                Ok(json!({ "side": if f.side == 1 { "b" } else { "a" }, "rack": f.rack.to_json() }))
            }
            "update" => places.update(v).map_err(bad),
            "delete" => places.delete(v.get("name").and_then(Value::as_str).unwrap_or("")).map_err(bad),
            other => Err(bad(format!("no preset op {other:?}"))),
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
            // MGL's Add menu (`addFxModule`): a mode of a module, at its defaults.
            "add" if v.get("suite").is_some() || v.get("mode").is_some() => {
                let kind = v.get("kind").and_then(Value::as_str).unwrap_or("");
                let mut slot = super::default_slot(kind).ok_or_else(|| bad("no such effect"))?;
                slot["id"] = json!(format!("fx-{}", fresh_id()));
                if let (Some(s), Some(m)) = (v.get("suite"), v.get("mode")) {
                    slot["suite"] = s.clone();
                    slot["mode"] = m.clone();
                    slot["rev"] = v.get("rev").cloned().unwrap_or(json!(1.0));
                }
                let mut all = f.rack.to_json();
                let slots = all["slots"].as_array_mut().ok_or_else(|| bad("the rack could not do that"))?;
                let i = at("at").unwrap_or(slots.len()).min(slots.len());
                slots.insert(i, slot);
                Ok(f.rack_set(ctl, rack, max_block, &all)?)
            }
            // The card's Mode (`fxSwitchMode`), and its look (`face`).
            "mode" | "face" => {
                let i = at("at").ok_or_else(|| bad("no slot given"))?;
                let mut all = f.rack.to_json();
                let old = all["slots"].get(i).cloned().ok_or_else(|| bad("no such slot"))?;
                let next = if op_is(v, "mode") {
                    match super::switch_mode(&old, v.get("suite").and_then(Value::as_str).unwrap_or(""), v.get("mode").and_then(Value::as_str).unwrap_or("")) {
                        Some(n) => n,
                        None => return Ok(f.rack.to_json()),
                    }
                } else {
                    let mut n = old;
                    n["face"] = json!(if v.get("face").and_then(Value::as_str) == Some("mgl") { "mgl" } else { "original" });
                    n
                };
                all["slots"][i] = next;
                Ok(f.rack_set(ctl, rack, max_block, &all)?)
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
