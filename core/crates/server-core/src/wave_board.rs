//! The Wave page's FX board (v8), on the server's side: `/api/wave/board*`,
//! `/api/wave/boards` and `/api/wave/fx`.
//!
//! `docs/WAVE-SYNTH.md` ("v8") is the contract. The model, its checks and the
//! DSP are `wave::board`; the engine half is `engine::synth`'s
//! `WaveShared::set_board`.
//!
//! # Where the board lives
//!
//! In the patch, under `board`, so a preset carries its board and
//! `<data>/wave/patch.json` keeps it. A patch saved before v8 has none; it is
//! given the one its old `fx*` keys make ([`wave::Board::migrate`]) as it is
//! read. What is stored is always complete — every control of every node,
//! clamped — so what is read back needs no defaults filled in.
//!
//! Every change goes to the engine as a whole board. `WaveShared` works out
//! whether that is new structure (compiled and swapped in) or only controls
//! and switches (live writes that keep the effects' tails).
//!
//! # Sounds (v8b)
//!
//! A Convolution or Spectral Dynamics node names its sound by library path
//! (`sound`). The file is decoded here, on the request's thread, into the
//! sounds the rack's effects share (`App::load_effect_sound`), before the
//! board goes to the engine, which hands it to the kernel as it compiles the
//! plan. A sound decoded only after its board was compiled (the stored board,
//! read before any library) has the board compiled again. The replies say,
//! per node, whether its sound is there (`soundState`): `none` and
//! `unreadable` both pass the input through.
//!
//! # Board presets
//!
//! `<data>/wave/boards/<name>.json`, beside the four factory boards built in
//! (`wave_board/factory.json`, the mock-up's examples). Saving under a
//! factory board's name shadows it. Removing one marks it hidden and keeps
//! the file, as Wave's presets do (remove means unlist, never delete); a
//! factory board is hidden by a file saying so.

use std::path::PathBuf;
use std::sync::Arc;

use wave::board::{category_name, fx_entries, suite, Kind, ParamKind};
use wave::{Board, BoardError, Cable, Node, Patch, PatchState, Telemetry};

use crate::http::{Request, Response};
use crate::json::{self, Value};
use crate::state::App;
use crate::wave_synth::{mod_json, parse_mods, WaveState};

/// The four example boards from the mock-up.
static FACTORY: &str = include_str!("wave_board/factory.json");

pub fn route(app: &Arc<App>, req: &Request) -> Response {
    let w = &app.wave;
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/api/wave/board") => Response::json(board_reply(&current(w)).to_string()),
        ("POST", "/api/wave/board") => post_board(app, req),
        ("POST", "/api/wave/board/param") => post_param(app, req),
        ("GET", "/api/wave/boards") => Response::json(Value::Arr(presets(w)).to_string()),
        ("POST", "/api/wave/boards") => post_preset(w, req),
        ("DELETE", "/api/wave/boards") => delete_preset(w, req),
        ("GET", "/api/wave/fx") => Response::json(Value::Arr(fx_list()).to_string()),
        _ => Response::error(404, "no such endpoint"),
    }
}

fn body(req: &Request) -> Result<Value, Response> {
    json::parse(&String::from_utf8_lossy(&req.body))
        .filter(|v| matches!(v, Value::Obj(_)))
        .ok_or_else(|| Response::error(400, "expected a JSON object"))
}

/// `400 {error, cable}`: the cable is the one at fault, when there is one.
fn refused(e: &BoardError) -> Response {
    let mut v = Value::obj().set("error", e.message.as_str());
    if let Some(c) = e.cable {
        v = v.set("cable", c);
    }
    Response::new(400, "application/json; charset=utf-8", v.to_string().into_bytes())
}

fn num(v: f32) -> Value {
    Value::Num(if v.is_finite() { format!("{v}").parse::<f64>().unwrap_or(0.0) } else { 0.0 })
}

/// The patch's board, migrating an old patch's chain if it has none.
pub fn ensure(p: &mut Patch) {
    if p.board.is_none() {
        let mut b = Board::migrate(&p.values).complete().unwrap_or_default();
        b.name = "Master chain".into();
        p.board = Some(b);
    }
}

fn current(w: &WaveState) -> Board {
    let mut p = w.patch();
    ensure(&mut p);
    p.board.unwrap_or_default()
}

// ─────────────────────────────────────────────────────── board ⇄ JSON

/// `{name, nodes:[{id, kind, x, y, on, params, sound?}], cables:[{from, to}]}`,
/// as it is stored. `sound` is on the nodes whose effect takes one: a
/// library path, or null.
pub fn board_json(b: &Board) -> Value {
    board_value(b, false)
}

/// The same with each sound node's `soundState`, for a reply.
fn board_reply(b: &Board) -> Value {
    board_value(b, true)
}

/// `none`, `loaded`, or `unreadable` (named, but not decoded).
fn sound_state(n: &Node) -> &'static str {
    match n.sound.as_deref() {
        None => "none",
        Some(s) if fx::prism::sound(s).is_some() => "loaded",
        Some(_) => "unreadable",
    }
}

fn board_value(b: &Board, states: bool) -> Value {
    let nodes = b
        .nodes
        .iter()
        .map(|n| {
            let params = n.params.iter().map(|(k, v)| (k.clone(), num(*v))).collect();
            let mut v = Value::obj()
                .set("id", n.id.as_str())
                .set("kind", n.kind.as_str())
                .set("x", num(n.x))
                .set("y", num(n.y))
                .set("on", n.on)
                .set("params", Value::Obj(params));
            if Kind::parse(&n.kind).is_some_and(Kind::takes_sound) {
                v = v.set("sound", n.sound.clone().map_or(Value::Null, Value::Str));
                if states {
                    v = v.set("soundState", sound_state(n));
                }
            }
            v
        })
        .collect();
    let port = |(n, p): &(String, String)| Value::Arr(vec![Value::Str(n.clone()), Value::Str(p.clone())]);
    let cables = b.cables.iter().map(|c| Value::obj().set("from", port(&c.from)).set("to", port(&c.to))).collect();
    Value::obj().set("name", b.name.as_str()).set("nodes", Value::Arr(nodes)).set("cables", Value::Arr(cables))
}

/// A board from JSON, shape checked; [`Board::complete`] checks the rest.
pub fn board_from_json(v: &Value) -> Result<Board, BoardError> {
    let bad = |m: String| BoardError { message: m, cable: None };
    if !matches!(v, Value::Obj(_)) {
        return Err(bad("a board is a JSON object".into()));
    }
    let name = v.get("name").and_then(Value::as_str).unwrap_or("").to_string();
    let mut nodes = Vec::new();
    for (i, n) in v.get("nodes").and_then(Value::arr).ok_or_else(|| bad("nodes must be a list".into()))?.iter().enumerate() {
        let s = |k: &str| n.get(k).and_then(Value::as_str);
        let f = |k: &str| match n.get(k) {
            Some(Value::Num(x)) => *x as f32,
            _ => 0.0,
        };
        let (Some(id), Some(kind)) = (s("id"), s("kind")) else {
            return Err(bad(format!("node {i}: needs an id and a kind")));
        };
        let mut node = Node::new(id, kind, f("x"), f("y"));
        node.on = !matches!(n.get("on"), Some(Value::Bool(false)));
        node.sound = match n.get("sound") {
            None | Some(Value::Null) => None,
            Some(Value::Str(p)) => Some(p.clone()).filter(|p| !p.is_empty()),
            Some(_) => return Err(bad(format!("node {id:?}: sound is a library path"))),
        };
        if let Some(params) = n.get("params") {
            let params = params.as_obj().ok_or_else(|| bad(format!("node {id:?}: params must be an object")))?;
            for (k, x) in params {
                let Value::Num(x) = x else { return Err(bad(format!("node {id:?}: {k} must be a number"))) };
                node.params.push((k.clone(), *x as f32));
            }
        }
        nodes.push(node);
    }
    let mut cables = Vec::new();
    for (c, cable) in v.get("cables").and_then(Value::arr).unwrap_or(&[]).iter().enumerate() {
        let end = |k: &str| match cable.get(k).and_then(Value::arr) {
            Some([Value::Str(n), Value::Str(p)]) => Some((n.clone(), p.clone())),
            _ => None,
        };
        let (Some(from), Some(to)) = (end("from"), end("to")) else {
            return Err(BoardError { message: format!("cable {c}: from and to are [nodeId, port]"), cable: Some(c) });
        };
        cables.push(Cable { from, to });
    }
    Board { name, nodes, cables }.complete()
}

// ─────────────────────────────────────────────────────────────── routes

/// Decode every sound `board` names that is not decoded yet. True if one
/// was, so a plan compiled without it wants compiling again.
pub(crate) fn load_sounds(app: &App, board: &Board) -> bool {
    let mut fresh = false;
    for name in board.nodes.iter().filter_map(|n| n.sound.as_deref()) {
        if fx::prism::sound(name).is_none() {
            app.load_effect_sound(name);
            fresh |= fx::prism::sound(name).is_some();
        }
    }
    fresh
}

/// Store `board` in the patch and hand it to the engine, its sounds decoded
/// first; the patch goes too when the board's nodes changed, so its `board:`
/// rows are compiled against the new ones. Saved unless `live`.
fn adopt(app: &App, board: Board, live: bool) -> Result<(), Response> {
    let w = &app.wave;
    let fresh = load_sounds(app, &board);
    let Ok(mut g) = w.inner.lock() else { return Err(Response::error(500, "the synth is wedged")) };
    let mut next = g.patch.clone();
    ensure(&mut next);
    let renumbered = next.board.as_ref().map(Board::sig) != Some(board.sig());
    next.board = Some(board);
    if let Err(e) = w.shared.set_board(next.board.as_ref().unwrap()) {
        return Err(refused(&e));
    }
    if fresh {
        w.shared.rebuild_board();
    }
    if renumbered {
        w.shared.set_patch(PatchState::new(&next));
    }
    if !live {
        g.patch = next;
        if let Err(e) = w.save(&g.patch) {
            return Err(Response::error(500, &format!("could not save the patch: {e}")));
        }
    }
    Ok(())
}

/// `POST /api/wave/board`: a whole board, checked, compiled, swapped in.
fn post_board(app: &App, req: &Request) -> Response {
    let v = match body(req) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let board = match board_from_json(&v) {
        Ok(b) => b,
        Err(e) => return refused(&e),
    };
    match adopt(app, board.clone(), false) {
        Ok(()) => Response::json(board_reply(&board).to_string()),
        Err(r) => r,
    }
}

/// `POST /api/wave/board/param {node, key, value, live?}`: one control,
/// `key: "on"` for the node's switch, or `key: "sound"` for the sound of a
/// node that takes one (a library path, or null for none). Heard at once;
/// stored unless `live`.
fn post_param(app: &App, req: &Request) -> Response {
    let w = &app.wave;
    let v = match body(req) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let s = |k: &str| v.get(k).and_then(Value::as_str);
    let (Some(id), Some(key)) = (s("node"), s("key")) else { return Response::error(400, "node and key are needed") };
    if key == "sound" {
        return post_sound(app, id, v.get("value"), matches!(v.get("live"), Some(Value::Bool(true))));
    }
    let value = match v.get("value") {
        Some(Value::Num(x)) if x.is_finite() => *x as f32,
        Some(Value::Bool(b)) => f32::from(u8::from(*b)),
        _ => return Response::error(400, "value must be a number"),
    };
    let live = matches!(v.get("live"), Some(Value::Bool(true)));
    let mut board = current(w);
    let Some((i, n)) = board.node(id) else { return Response::error(400, &format!("no node {id:?}")) };
    let kind = n.kind.clone();
    let stored = if key == "on" {
        board.nodes[i].on = value >= 0.5;
        Value::Bool(value >= 0.5)
    } else {
        let Some(spec) = Kind::parse(&kind).and_then(|k| k.params().iter().find(|p| p.key == key)) else {
            return Response::error(400, &format!("{kind} has no control {key:?}"));
        };
        let x = spec.clamp(value);
        board.nodes[i] = board.nodes[i].clone().with(key, x);
        num(x)
    };
    // Back into its kind's order, and checked: a new port count may strand a
    // cable.
    let board = match board.complete() {
        Ok(b) => b,
        Err(e) => return refused(&e),
    };
    if let Err(r) = adopt(app, board, live) {
        return r;
    }
    Response::json(Value::obj().set("ok", true).set("node", id).set("key", key).set("value", stored).set("live", live).to_string())
}

/// A node's sound: checked to be a library file that decodes, then the
/// board with it is a new plan.
fn post_sound(app: &App, id: &str, value: Option<&Value>, live: bool) -> Response {
    let sound = match value {
        None | Some(Value::Null) => None,
        Some(Value::Str(p)) => Some(p.trim().to_string()).filter(|p| !p.is_empty()),
        Some(_) => return Response::error(400, "a sound is a library path, or null for none"),
    };
    let mut board = current(&app.wave);
    let Some((i, n)) = board.node(id) else { return Response::error(400, &format!("no node {id:?}")) };
    if !Kind::parse(&n.kind).is_some_and(Kind::takes_sound) {
        return Response::error(400, &format!("{} takes no sound", n.kind));
    }
    if let Some(name) = sound.as_deref() {
        let found = app.library_path().and_then(|lib| crate::safety::resolve_within(&lib, name));
        if found.is_none_or(|p| !p.is_file()) {
            return Response::error(400, &format!("no sound {name:?} in the library"));
        }
        app.load_effect_sound(name);
        if fx::prism::sound(name).is_none() {
            return Response::error(400, &format!("{name:?} could not be read as a sound"));
        }
    }
    board.nodes[i].sound = sound.clone();
    let node = board.nodes[i].clone();
    if let Err(r) = adopt(app, board, live) {
        return r;
    }
    Response::json(
        Value::obj()
            .set("ok", true)
            .set("node", id)
            .set("key", "sound")
            .set("value", sound.map_or(Value::Null, Value::Str))
            .set("soundState", sound_state(&node))
            .set("live", live)
            .to_string(),
    )
}

fn boards_dir(w: &WaveState) -> PathBuf {
    w.dir.join("boards")
}

fn file_name(name: &str) -> Option<String> {
    let f = crate::capture::safe(name.trim()).trim_start_matches('.').to_string();
    (!f.is_empty()).then_some(f)
}

/// The factory boards, as stored presets are: board fields, `mods`, and
/// `factory: true`.
fn factory() -> Vec<Value> {
    json::parse(FACTORY).and_then(|v| v.arr().map(<[Value]>::to_vec)).unwrap_or_default()
}

/// A preset as listed: the board complete, its `mods`, whether it is a
/// factory board.
fn listed(v: &Value, is_factory: bool) -> Option<Value> {
    let board = board_from_json(v).ok()?;
    let mut out = board_json(&board).set("factory", is_factory);
    if let Some(m) = v.get("mods") {
        out = out.set("mods", m.clone());
    }
    Some(out)
}

/// `GET /api/wave/boards`: the factory boards in their order (or what was
/// saved over them), then the saved ones by name. Hidden ones are left out.
fn presets(w: &WaveState) -> Vec<Value> {
    let mut saved: Vec<(String, Value)> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(boards_dir(w)) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            if let Some(v) = std::fs::read_to_string(&p).ok().and_then(|s| json::parse(&s)) {
                let name = v.get("name").and_then(Value::as_str).unwrap_or("").to_string();
                saved.push((name, v));
            }
        }
    }
    saved.sort_by_key(|(n, _)| n.to_lowercase());
    let hidden = |v: &Value| matches!(v.get("hidden"), Some(Value::Bool(true)));
    let mut out = Vec::new();
    for f in factory() {
        let name = f.get("name").and_then(Value::as_str).unwrap_or("").to_string();
        match saved.iter().position(|(n, _)| *n == name) {
            Some(i) => {
                let (_, v) = saved.remove(i);
                if !hidden(&v) {
                    out.extend(listed(&v, false));
                }
            }
            None => out.extend(listed(&f, true)),
        }
    }
    out.extend(saved.iter().filter(|(_, v)| !hidden(v)).filter_map(|(_, v)| listed(v, false)));
    out
}

/// `POST /api/wave/boards {name, board?, mods?}`: save a board preset under
/// `name`, replacing one of that name (the current board when `board` is
/// left out). `mods` are kept as the page sends them, for it to lay into the
/// matrix when the board is loaded.
fn post_preset(w: &WaveState, req: &Request) -> Response {
    let v = match body(req) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let Some(name) = v.get("name").and_then(Value::as_str).map(str::trim).filter(|n| !n.is_empty()) else {
        return Response::error(400, "no name given");
    };
    let Some(file) = file_name(name) else { return Response::error(400, "the name is empty") };
    let mut board = match v.get("board") {
        Some(b) => match board_from_json(b) {
            Ok(b) => b,
            Err(e) => return refused(&e),
        },
        None => current(w),
    };
    board.name = name.to_string();
    let mut held = board_json(&board).set("hidden", false);
    if let Some(m) = v.get("mods") {
        match parse_mods(m) {
            Ok(rows) => held = held.set("mods", Value::Arr(rows.iter().map(mod_json).collect())),
            Err(e) => return Response::error(400, &e),
        }
    }
    let dir = boards_dir(w);
    let path = dir.join(format!("{file}.json"));
    if let Err(e) = std::fs::create_dir_all(&dir).and_then(|_| crate::persist::write_atomic(&path, &held.to_string())) {
        return Response::error(500, &format!("could not save the board: {e}"));
    }
    Response::json(Value::obj().set("ok", true).set("name", name).to_string())
}

/// `DELETE /api/wave/boards?name=`: unlist a board preset. The file stays,
/// marked hidden.
fn delete_preset(w: &WaveState, req: &Request) -> Response {
    let Some(name) = req.param("name").map(str::trim).filter(|n| !n.is_empty()) else {
        return Response::error(400, "no name given");
    };
    let Some(file) = file_name(name) else { return Response::error(400, "the name is empty") };
    let dir = boards_dir(w);
    let path = dir.join(format!("{file}.json"));
    let held = match std::fs::read_to_string(&path).ok().and_then(|s| json::parse(&s)) {
        Some(v) => v,
        None => match factory().into_iter().find(|f| f.get("name").and_then(Value::as_str) == Some(name)) {
            Some(f) => f,
            None => return Response::error(404, &format!("no board called {name:?}")),
        },
    };
    let held = held.set("hidden", true);
    if let Err(e) = std::fs::create_dir_all(&dir).and_then(|_| crate::persist::write_atomic(&path, &held.to_string())) {
        return Response::error(500, &format!("could not unlist the board: {e}"));
    }
    Response::json(Value::obj().set("ok", true).set("name", name).set("hidden", true).to_string())
}

/// `GET /api/wave/fx`: the 82 board effects and their controls. Controls an
/// effect keeps only so old documents open (`inert`) are left out.
fn fx_list() -> Vec<Value> {
    fx_entries()
        .map(|e| {
            let d = e.descriptor;
            let params = d
                .params
                .iter()
                .filter(|p| !p.inert)
                .map(|p| {
                    let mut v = Value::obj()
                        .set("key", p.key)
                        .set("label", p.label)
                        .set("min", num(p.min))
                        .set("max", num(p.max))
                        .set("default", num(p.default))
                        .set("unit", p.unit)
                        .set("log", p.log);
                    match p.kind {
                        ParamKind::Continuous => v,
                        ParamKind::Int => v.set("step", 1.0),
                        ParamKind::Toggle => v.set("step", 1.0).set("toggle", true),
                        ParamKind::Choice(c) => v.set("step", 1.0).set("choices", Value::Arr(c.iter().map(|s| Value::Str(s.to_string())).collect())),
                    }
                })
                .collect();
            let v = Value::obj()
                .set("kind", format!("fx:{}", d.id))
                .set("label", d.label)
                .set("category", category_name(d.category))
                .set("suite", suite(d.id))
                .set("params", Value::Arr(params));
            // The sound it takes, for the page to offer a picker.
            match d.sound {
                Some(snd) => v.set("sound", Value::obj().set("key", snd.key).set("label", snd.label)),
                None => v,
            }
        })
        .collect()
}

/// For `GET /api/wave/state`: each node's output peaks by id, from the board
/// last handed to the engine.
pub fn peaks_json(w: &WaveState, t: &Telemetry, device: bool) -> Value {
    let Some(board) = w.shared.board() else { return Value::obj() };
    let peaks = board
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| {
            let p = if device { t.board().get(i).copied().unwrap_or([0.0; 2]) } else { [0.0; 2] };
            (n.id.clone(), Value::Arr(vec![num(p[0]), num(p[1])]))
        })
        .collect();
    Value::Obj(peaks)
}

#[cfg(test)]
mod tests;
