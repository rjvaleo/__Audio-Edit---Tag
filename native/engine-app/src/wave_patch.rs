//! Wave's patch as a file: the same JSON shape MultiGrainLive saves
//! (`server-core/src/wave_synth.rs` `patch_json` and `patch_from_json`, and
//! `wave_board.rs` `board_json` and `board_from_json`), so a patch or a
//! preset saved by MGL's Wave page opens here, and one saved here opens there.
//!
//! MGL writes it with its own JSON code; this writes it with serde_json. The
//! numbers are written the way MGL writes them (an f32 printed at its
//! shortest, then read as a double), so a value reads back as the same f32.

use serde_json::{Map, Value};
use wave::board::Kind as NodeKind;
use wave::choice::choice_id;
use wave::patch::{Source, MAX_LFO_POINTS, MAX_MODS};
use wave::{param_id, Board, BoardError, Cable, Curve, Mod, Node, Patch, POINT_KEYS, STR_KEYS};

/// A number as MGL writes it.
pub fn num(v: f32) -> Value {
    let x = if v.is_finite() { format!("{v}").parse::<f64>().unwrap_or(0.0) } else { 0.0 };
    serde_json::Number::from_f64(x).map_or(Value::from(0), Value::Number)
}

fn num_of(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64().filter(|x| x.is_finite()),
        _ => None,
    }
}

fn mod_json(m: &Mod) -> Value {
    let mut o = Map::new();
    o.insert("src".into(), m.src.as_str().into());
    o.insert("dst".into(), m.dst.as_str().into());
    o.insert("amt".into(), num(m.amt));
    o.insert("curve".into(), m.curve.as_str().into());
    o.insert("via".into(), m.via.clone().map_or(Value::Null, Value::String));
    o.insert("on".into(), m.on.into());
    Value::Object(o)
}

/// One key's value as the patch holds it.
fn param_json(p: &Patch, key: &str) -> Value {
    if let Some(x) = p.get_num(key) {
        return num(x);
    }
    if let Some(s) = p.get_str(key) {
        return s.into();
    }
    match p.get_points(key) {
        Some(pts) => Value::Array(pts.iter().map(|(x, y)| Value::Array(vec![num(*x), num(*y)])).collect()),
        None => Value::Null,
    }
}

/// The patch as MGL stores it: `{params, mods, macroNames, name, tags, board}`.
pub fn patch_json(p: &Patch) -> Value {
    let mut params = Map::new();
    for (key, _) in p.entries() {
        params.insert(key.to_string(), param_json(p, key));
    }
    let mut o = Map::new();
    o.insert("params".into(), Value::Object(params));
    o.insert("mods".into(), Value::Array(p.mods.iter().map(mod_json).collect()));
    o.insert("macroNames".into(), Value::Array(p.macro_names.iter().map(|s| s.as_str().into()).collect()));
    o.insert("name".into(), p.name.as_str().into());
    o.insert("tags".into(), Value::Array(p.tags.iter().map(|t| t.as_str().into()).collect()));
    o.insert("board".into(), p.board.as_ref().map_or(Value::Null, board_json));
    Value::Object(o)
}

/// Set one key from JSON. An unknown key, or a value it does not take, is an
/// error naming it.
pub fn apply_param(p: &mut Patch, key: &str, v: &Value) -> Result<(), String> {
    if param_id(key).is_some() {
        let x = num_of(Some(v)).ok_or_else(|| format!("{key} takes a number"))?;
        return if p.set_num(key, x as f32) { Ok(()) } else { Err(format!("{key} takes a number")) };
    }
    if STR_KEYS.contains(&key) {
        let s = v.as_str().filter(|s| !s.is_empty()).ok_or_else(|| format!("{key} takes a name"))?;
        return if p.set_str(key, s) { Ok(()) } else { Err(format!("{key} does not take {s:?}")) };
    }
    if POINT_KEYS.contains(&key) {
        let pts = v
            .as_array()
            .ok_or_else(|| format!("{key} takes [[x, y], …]"))?
            .iter()
            .map(|pt| match pt.as_array().map(Vec::as_slice) {
                Some([x, y]) => Some((num_of(Some(x))? as f32, num_of(Some(y))? as f32)),
                _ => None,
            })
            .collect::<Option<Vec<_>>>()
            .ok_or_else(|| format!("{key} takes [[x, y], …]"))?;
        return if p.set_points(key, &pts) { Ok(()) } else { Err(format!("{key} needs 2 to {MAX_LFO_POINTS} points")) };
    }
    Err(format!("unknown key {key:?}"))
}

/// The matrix rows, every field checked, as MGL checks them.
pub fn parse_mods(v: &Value) -> Result<Vec<Mod>, String> {
    let rows = v.as_array().ok_or("mods must be a list")?;
    if rows.len() > MAX_MODS {
        return Err(format!("at most {MAX_MODS} mod rows"));
    }
    rows.iter()
        .enumerate()
        .map(|(i, r)| {
            let s = |k: &str| r.get(k).and_then(Value::as_str);
            let src = s("src").filter(|x| Source::parse(x).is_some()).ok_or(format!("mod {i}: unknown src"))?;
            let target = |x: &&str| param_id(x).is_some() || choice_id(x).is_some() || wave::board::parse_dst(x).is_some();
            let dst = s("dst").filter(target).ok_or(format!("mod {i}: unknown dst"))?;
            let amt = num_of(r.get("amt")).ok_or(format!("mod {i}: amt must be a number"))?.clamp(-1.0, 1.0) as f32;
            let curve = s("curve").unwrap_or("lin");
            if Curve::parse(curve).is_none() {
                return Err(format!("mod {i}: unknown curve {curve:?}"));
            }
            let via = match r.get("via") {
                None | Some(Value::Null) => None,
                Some(Value::String(x)) if Source::parse(x).is_some() => Some(x.clone()),
                Some(_) => return Err(format!("mod {i}: unknown via")),
            };
            let on = match r.get("on") {
                None | Some(Value::Null) => true,
                Some(Value::Bool(b)) => *b,
                Some(_) => return Err(format!("mod {i}: on must be true or false")),
            };
            Ok(Mod { src: src.into(), dst: dst.into(), amt, curve: curve.into(), via, on })
        })
        .collect()
}

fn parse_tags(v: Option<&Value>) -> Vec<String> {
    match v {
        Some(Value::Array(a)) => a.iter().filter_map(Value::as_str).map(str::trim).filter(|t| !t.is_empty()).map(String::from).collect(),
        Some(Value::String(s)) => s.split(['·', ',']).map(str::trim).filter(|t| !t.is_empty()).map(String::from).collect(),
        _ => Vec::new(),
    }
}

/// A patch from MGL's shape, laid over `base`. A preset file (`{name,
/// patch: {...}}`) is read for its patch.
pub fn patch_from_json(v: &Value, mut base: Patch) -> Result<Patch, String> {
    let v = match v.get("patch") {
        Some(inner @ Value::Object(_)) if v.get("params").is_none() => inner,
        _ => v,
    };
    if !v.is_object() {
        return Err("a patch is a JSON object".into());
    }
    if let Some(params) = v.get("params") {
        let params = params.as_object().ok_or("params must be an object")?;
        for (k, x) in params {
            apply_param(&mut base, k, x)?;
        }
    }
    if let Some(m) = v.get("mods") {
        base.mods = parse_mods(m)?;
    }
    if let Some(names) = v.get("macroNames") {
        let names = names.as_array().ok_or("macroNames must be a list")?;
        for (slot, n) in base.macro_names.iter_mut().zip(names) {
            if let Some(s) = n.as_str() {
                *slot = s.to_string();
            }
        }
    }
    if let Some(n) = v.get("name").and_then(Value::as_str) {
        base.name = n.to_string();
    }
    if v.get("tags").is_some() {
        base.tags = parse_tags(v.get("tags"));
    }
    base.board = v.get("board").filter(|b| !b.is_null()).map(board_from_json).transpose().map_err(|e| e.message)?;
    ensure(&mut base);
    Ok(base)
}

/// The patch's board, made from an old patch's chain if it has none, as MGL
/// does (`wave_board::ensure`).
pub fn ensure(p: &mut Patch) {
    if p.board.is_none() {
        let mut b = Board::migrate(&p.values).complete().unwrap_or_default();
        b.name = "Master chain".into();
        p.board = Some(b);
    }
}

/// `{name, nodes:[{id, kind, x, y, on, params, sound?}], cables:[{from, to}]}`.
pub fn board_json(b: &Board) -> Value {
    let nodes = b
        .nodes
        .iter()
        .map(|n| {
            let params: Map<String, Value> = n.params.iter().map(|(k, v)| (k.clone(), num(*v))).collect();
            let mut o = Map::new();
            o.insert("id".into(), n.id.as_str().into());
            o.insert("kind".into(), n.kind.as_str().into());
            o.insert("x".into(), num(n.x));
            o.insert("y".into(), num(n.y));
            o.insert("on".into(), n.on.into());
            o.insert("params".into(), Value::Object(params));
            if NodeKind::parse(&n.kind).is_some_and(NodeKind::takes_sound) {
                o.insert("sound".into(), n.sound.clone().map_or(Value::Null, Value::String));
            }
            Value::Object(o)
        })
        .collect();
    let port = |(n, p): &(String, String)| Value::Array(vec![n.as_str().into(), p.as_str().into()]);
    let cables = b
        .cables
        .iter()
        .map(|c| {
            let mut o = Map::new();
            o.insert("from".into(), port(&c.from));
            o.insert("to".into(), port(&c.to));
            Value::Object(o)
        })
        .collect();
    let mut o = Map::new();
    o.insert("name".into(), b.name.as_str().into());
    o.insert("nodes".into(), Value::Array(nodes));
    o.insert("cables".into(), Value::Array(cables));
    Value::Object(o)
}

/// A board from JSON, its shape checked as MGL checks it; [`Board::complete`]
/// checks the rest.
pub fn board_from_json(v: &Value) -> Result<Board, BoardError> {
    let bad = |m: String| BoardError { message: m, cable: None };
    if !v.is_object() {
        return Err(bad("a board is a JSON object".into()));
    }
    let name = v.get("name").and_then(Value::as_str).unwrap_or("").to_string();
    let mut nodes = Vec::new();
    for (i, n) in v.get("nodes").and_then(Value::as_array).ok_or_else(|| bad("nodes must be a list".into()))?.iter().enumerate() {
        let s = |k: &str| n.get(k).and_then(Value::as_str);
        let f = |k: &str| num_of(n.get(k)).unwrap_or(0.0) as f32;
        let (Some(id), Some(kind)) = (s("id"), s("kind")) else {
            return Err(bad(format!("node {i}: needs an id and a kind")));
        };
        let mut node = Node::new(id, kind, f("x"), f("y"));
        node.on = !matches!(n.get("on"), Some(Value::Bool(false)));
        node.sound = match n.get("sound") {
            None | Some(Value::Null) => None,
            Some(Value::String(p)) => Some(p.clone()).filter(|p| !p.is_empty()),
            Some(_) => return Err(bad(format!("node {id:?}: sound is a library path"))),
        };
        if let Some(params) = n.get("params") {
            let params = params.as_object().ok_or_else(|| bad(format!("node {id:?}: params must be an object")))?;
            for (k, x) in params {
                let Some(x) = num_of(Some(x)) else { return Err(bad(format!("node {id:?}: {k} must be a number"))) };
                node.params.push((k.clone(), x as f32));
            }
        }
        nodes.push(node);
    }
    let mut cables = Vec::new();
    for (c, cable) in v.get("cables").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]).iter().enumerate() {
        let end = |k: &str| match cable.get(k).and_then(Value::as_array).map(Vec::as_slice) {
            Some([Value::String(n), Value::String(p)]) => Some((n.clone(), p.clone())),
            _ => None,
        };
        let (Some(from), Some(to)) = (end("from"), end("to")) else {
            return Err(BoardError { message: format!("cable {c}: from and to are [nodeId, port]"), cable: Some(c) });
        };
        cables.push(Cable { from, to });
    }
    Board { name, nodes, cables }.complete()
}
