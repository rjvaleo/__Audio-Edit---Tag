//! Wave's FX board (v8): `/api/wave/board*`, `/api/wave/boards`,
//! `/api/wave/fx` (`wave_board.rs`, `docs/WAVE-SYNTH.md`). None of these open
//! the audio device.

use super::*;
use server::json::Value;

fn ok(app: &Arc<App>, r: Request) -> Value {
    let res = server::routes::route(app, &r);
    assert_eq!(status(&res), 200, "{} {}: {}", r.method, r.path, String::from_utf8_lossy(&res.body));
    json(&res)
}

fn refused(app: &Arc<App>, r: Request) -> Value {
    let res = server::routes::route(app, &r);
    assert_eq!(status(&res), 400, "{} {} was accepted: {}", r.method, r.path, String::from_utf8_lossy(&res.body));
    json(&res)
}

fn node<'a>(b: &'a Value, id: &str) -> &'a Value {
    let nodes = b.get("nodes").and_then(Value::arr).unwrap();
    nodes.iter().find(|n| n.get("id").and_then(Value::as_str) == Some(id)).unwrap_or_else(|| panic!("no node {id}"))
}

/// Voice → gain → out, with every input on the left.
const SMALL: &str = r#"{"name":"Small","nodes":[
    {"id":"v","kind":"in:voice","x":16,"y":16},
    {"id":"a","kind":"in:osc0","x":16,"y":112},
    {"id":"g","kind":"gain","x":200,"y":16,"params":{"db":-6}},
    {"id":"s","kind":"split","x":200,"y":120},
    {"id":"out","kind":"out","x":400,"y":16}],
  "cables":[{"from":["v","o"],"to":["g","i"]},{"from":["g","o"],"to":["s","i"]},{"from":["s","o1"],"to":["out","i"]}]}"#;

#[test]
fn a_new_patch_has_its_old_chain_as_a_board() {
    let s = Scratch::new("wave-board-migrate");
    let app = s.app();
    let b = ok(&app, get("/api/wave/board", &[]));
    let ids: Vec<String> = arr(b.get("nodes").unwrap()).iter().map(|n| text(n, &["id"])).collect();
    assert_eq!(ids, ["invoice", "inA", "inB", "inC", "insub", "innoise", "drive", "chorus", "delay", "reverb", "eq", "out"]);
    assert!(!flag(node(&b, "drive"), &["on"]), "Drive starts off, as the chain's did");
    assert_eq!(num(node(&b, "eq"), &["params", "band.1.gainDb"]), 0.0);
    assert_eq!(arr(node(&b, "eq").get("params").map(|p| Value::Arr(p.as_obj().unwrap().values().cloned().collect())).as_ref().unwrap()).len(), 36, "every control listed");
    assert_eq!(arr(b.get("cables").unwrap()).len(), 6);

    // A patch from before v8, posted whole: its fx keys make its board.
    let p = ok(&app, post("/api/wave/patch", r#"{"params":{"fx2.k1":0.9,"fx4.on":0}}"#));
    let b = p.get("board").unwrap();
    assert!((num(node(b, "delay"), &["params", "feedback"]) - 0.87).abs() < 1e-6);
    assert!(!flag(node(b, "eq"), &["on"]));
    assert_eq!(&ok(&app, get("/api/wave/board", &[])), b);
}

#[test]
fn a_board_is_checked_stored_and_read_back() {
    let s = Scratch::new("wave-board-post");
    let app = s.app();
    let b = ok(&app, post("/api/wave/board", SMALL));
    assert_eq!(num(node(&b, "g"), &["params", "db"]), -6.0);
    assert_eq!(num(node(&b, "s"), &["params", "outs"]), 2.0, "defaults are filled in");
    assert_eq!(num(node(&b, "a"), &["params", "level"]), 1.0);
    assert_eq!(ok(&app, get("/api/wave/board", &[])), b);
    // In the patch, and kept by a fresh process.
    assert_eq!(ok(&app, get("/api/wave/patch", &[])).get("board"), Some(&b));
    assert_eq!(ok(&s.app(), get("/api/wave/board", &[])), b);

    // The 400s.
    let bad = |body: String, says: &str| {
        let e = refused(&app, post("/api/wave/board", &body));
        assert!(text(&e, &["error"]).contains(says), "{} does not say {says:?}", text(&e, &["error"]));
        e
    };
    bad(SMALL.replace(r#""kind":"gain""#, r#""kind":"fx:nothing""#), "unknown kind");
    bad(SMALL.replace(r#"["s","o1"]"#, r#"["s","o2"]"#), "no output");
    bad(SMALL.replace(r#""to":["out","i"]"#, r#""to":["out","x"]"#), "no input");
    bad(SMALL.replace(r#""db":-6"#, r#""dbs":-6"#), "no control");
    let e = bad(SMALL.replace(r#"{"from":["s","o1"],"to":["out","i"]}"#, r#"{"from":["s","o1"],"to":["g","i"]}"#), "loop");
    assert_eq!(num(&e, &["cable"]), 2.0, "names the cable that closes the loop");
    bad("[]".into(), "JSON object");
    assert_eq!(ok(&app, get("/api/wave/board", &[])), b, "a refused board changes nothing");
}

#[test]
fn a_board_control_is_written_live_or_kept() {
    let s = Scratch::new("wave-board-param");
    let app = s.app();
    ok(&app, post("/api/wave/board", SMALL));
    let r = ok(&app, post("/api/wave/board/param", r#"{"node":"g","key":"db","value":99}"#));
    assert_eq!(num(&r, &["value"]), 24.0, "clamped to the control's range");
    let b = ok(&app, get("/api/wave/board", &[]));
    assert_eq!(num(node(&b, "g"), &["params", "db"]), 24.0);
    // Live: heard, not stored.
    ok(&app, post("/api/wave/board/param", r#"{"node":"g","key":"db","value":-3,"live":true}"#));
    assert_eq!(num(node(&ok(&app, get("/api/wave/board", &[])), "g"), &["params", "db"]), 24.0);
    // The switch.
    let r = ok(&app, post("/api/wave/board/param", r#"{"node":"g","key":"on","value":false}"#));
    assert!(!flag(&r, &["value"]));
    assert!(!flag(node(&ok(&app, get("/api/wave/board", &[])), "g"), &["on"]));
    // A port count is structure, checked like any board: three outs, a
    // cable on the third, and then two outs would strand it.
    ok(&app, post("/api/wave/board/param", r#"{"node":"s","key":"outs","value":3}"#));
    let three = SMALL.replace(r#""kind":"split","#, r#""kind":"split","params":{"outs":3},"#).replace(r#"["s","o1"]"#, r#"["s","o2"]"#);
    ok(&app, post("/api/wave/board", &three));
    let e = refused(&app, post("/api/wave/board/param", r#"{"node":"s","key":"outs","value":2}"#));
    assert!(text(&e, &["error"]).contains("no output"), "{}", text(&e, &["error"]));
    assert_eq!(num(&e, &["cable"]), 2.0);
    refused(&app, post("/api/wave/board/param", r#"{"node":"nobody","key":"db","value":1}"#));
    refused(&app, post("/api/wave/board/param", r#"{"node":"g","key":"nothing","value":1}"#));
    refused(&app, post("/api/wave/board/param", r#"{"node":"g","key":"db","value":"loud"}"#));
}

#[test]
fn board_presets_list_the_factory_four_then_the_saved_and_unlist_without_deleting() {
    let s = Scratch::new("wave-board-presets");
    let app = s.app();
    let names = |app: &Arc<App>| -> Vec<String> { arr(&ok(app, get("/api/wave/boards", &[]))).iter().map(|b| text(b, &["name"])).collect() };
    assert_eq!(names(&app), ["Glass Split", "Dub Room", "Grit Bus", "Bubble Garden"]);
    let list = ok(&app, get("/api/wave/boards", &[]));
    let glass = &arr(&list)[0];
    assert!(flag(glass, &["factory"]));
    assert_eq!(arr(glass.get("mods").unwrap()).len(), 3);
    assert_eq!(text(&arr(glass.get("mods").unwrap())[0], &["dst"]), "board:ec:delayMs");
    // Each factory board loads as the board.
    for b in arr(&list) {
        ok(&app, post("/api/wave/board", &b.to_string()));
    }

    // Save one given, and the current one; overwrite by name.
    ok(&app, post("/api/wave/boards", &format!(r#"{{"name":"Mine","board":{SMALL}}}"#)));
    ok(&app, post("/api/wave/boards", r#"{"name":"Also mine"}"#));
    ok(&app, post("/api/wave/boards", &format!(r#"{{"name":"Mine","board":{SMALL},"mods":[{{"src":"macro0","dst":"board:g:db","amt":0.5}}]}}"#)));
    assert_eq!(names(&app), ["Glass Split", "Dub Room", "Grit Bus", "Bubble Garden", "Also mine", "Mine"]);
    let list = ok(&app, get("/api/wave/boards", &[]));
    let mine = arr(&list).into_iter().find(|b| text(b, &["name"]) == "Mine").unwrap();
    assert!(!flag(&mine, &["factory"]));
    assert_eq!(arr(mine.get("mods").unwrap()).len(), 1);
    assert_eq!(text(&arr(&list)[4], &["name"]), "Also mine");
    assert_eq!(text(&arr(arr(&list)[4].get("nodes").unwrap()).last().unwrap(), &["id"]), arr(ok(&app, get("/api/wave/board", &[])).get("nodes").unwrap()).last().map(|n| text(n, &["id"])).unwrap());
    refused(&app, post("/api/wave/boards", r#"{"board":{}}"#));
    refused(&app, post("/api/wave/boards", &format!(r#"{{"name":"Bad","board":{}}}"#, SMALL.replace("gain", "fx:nothing"))));

    // Remove unlists; the file stays. A factory board can be unlisted too.
    ok(&app, req("DELETE", "/api/wave/boards", &[("name", "Mine")], Vec::new()));
    ok(&app, req("DELETE", "/api/wave/boards", &[("name", "Dub Room")], Vec::new()));
    assert_eq!(names(&app), ["Glass Split", "Grit Bus", "Bubble Garden", "Also mine"]);
    assert!(s.data.join("wave/boards/Mine.json").exists(), "remove means unlist, never delete");
    let r = server::routes::route(&app, &req("DELETE", "/api/wave/boards", &[("name", "Nobody")], Vec::new()));
    assert_eq!(status(&r), 404);
    // Saved again, it is listed again.
    ok(&app, post("/api/wave/boards", &format!(r#"{{"name":"Mine","board":{SMALL}}}"#)));
    assert!(names(&app).contains(&"Mine".to_string()));
}

#[test]
fn the_fx_catalogue_state_and_board_mod_rows() {
    let s = Scratch::new("wave-board-fx");
    let app = s.app();
    let fx = ok(&app, get("/api/wave/fx", &[]));
    assert_eq!(arr(&fx).len(), 82);
    let chorus = arr(&fx).into_iter().find(|e| text(e, &["kind"]) == "fx:hp-chorus").unwrap();
    assert_eq!(text(&chorus, &["suite"]), "Hyperprism");
    assert_eq!(text(&chorus, &["category"]), "modulation");
    let rate = arr(chorus.get("params").unwrap()).into_iter().find(|p| text(p, &["key"]) == "rateHz").unwrap();
    assert_eq!((num(&rate, &["min"]), num(&rate, &["max"]), num(&rate, &["default"])), (0.0, 4.0, 2.0));

    ok(&app, post("/api/wave/board", SMALL));
    let st = ok(&app, get("/api/wave/state", &[]));
    let peaks = st.get("board").unwrap().as_obj().unwrap();
    assert_eq!(peaks.keys().cloned().collect::<Vec<_>>(), ["a", "g", "out", "s", "v"]);
    assert_eq!(arr(&peaks["g"]).len(), 2);

    // Board rows share the matrix.
    let m = ok(&app, post("/api/wave/mods", r#"{"mods":[{"src":"lfo0","dst":"board:g:db","amt":0.3},{"src":"lfo1","dst":"osc0.pos","amt":0.2}]}"#));
    assert_eq!(text(&arr(m.get("mods").unwrap())[0], &["dst"]), "board:g:db");
    refused(&app, post("/api/wave/mods", r#"{"mods":[{"src":"lfo0","dst":"board:g","amt":0.3}]}"#));
}

#[test]
fn a_convolution_node_takes_a_library_sound() {
    let s = Scratch::new("wave-board-sound");
    s.sound("kit/ir.wav", 4_000);
    let app = s.app();
    let board = SMALL.replace(r#""kind":"gain","x":200,"y":16,"params":{"db":-6}"#, r#""kind":"fx:convolution","x":200,"y":16"#);
    let b = ok(&app, post("/api/wave/board", &board));
    assert_eq!(node(&b, "g").get("sound"), Some(&Value::Null));
    assert_eq!(text(node(&b, "g"), &["soundState"]), "none", "no sound: it passes its input through, and says so");
    assert!(node(&b, "s").get("sound").is_none(), "only a node that takes a sound has one");

    let r = ok(&app, post("/api/wave/board/param", r#"{"node":"g","key":"sound","value":"kit/ir.wav"}"#));
    assert_eq!(text(&r, &["value"]), "kit/ir.wav");
    assert_eq!(text(&r, &["soundState"]), "loaded");
    let b = ok(&app, get("/api/wave/board", &[]));
    assert_eq!(text(node(&b, "g"), &["sound"]), "kit/ir.wav");
    assert_eq!(text(node(&b, "g"), &["soundState"]), "loaded");
    // Stored in the patch, and read back by a fresh process.
    assert_eq!(text(node(ok(&app, get("/api/wave/patch", &[])).get("board").unwrap(), "g"), &["sound"]), "kit/ir.wav");
    assert_eq!(text(node(&ok(&s.app(), get("/api/wave/board", &[])), "g"), &["sound"]), "kit/ir.wav");
    // Live: heard, not stored.
    ok(&app, post("/api/wave/board/param", r#"{"node":"g","key":"sound","value":null,"live":true}"#));
    assert_eq!(text(node(&ok(&app, get("/api/wave/board", &[])), "g"), &["sound"]), "kit/ir.wav");

    // The 400s: no such file, a path out of the library, not a path, a node
    // that takes no sound, in a whole board too.
    refused(&app, post("/api/wave/board/param", r#"{"node":"g","key":"sound","value":"kit/nothing.wav"}"#));
    refused(&app, post("/api/wave/board/param", r#"{"node":"g","key":"sound","value":"../../etc/passwd"}"#));
    refused(&app, post("/api/wave/board/param", r#"{"node":"g","key":"sound","value":5}"#));
    refused(&app, post("/api/wave/board/param", r#"{"node":"s","key":"sound","value":"kit/ir.wav"}"#));
    let e = refused(&app, post("/api/wave/board", &SMALL.replace(r#""params":{"db":-6}"#, r#""params":{"db":-6},"sound":"kit/ir.wav""#)));
    assert!(text(&e, &["error"]).contains("takes no sound"), "{}", text(&e, &["error"]));
    assert_eq!(text(node(&ok(&app, get("/api/wave/board", &[])), "g"), &["sound"]), "kit/ir.wav", "a refusal changes nothing");

    // Cleared, it passes its input through again.
    let r = ok(&app, post("/api/wave/board/param", r#"{"node":"g","key":"sound","value":null}"#));
    assert_eq!(r.get("value"), Some(&Value::Null));
    assert_eq!(text(&r, &["soundState"]), "none");
    // A whole board may name a sound not in this library: kept, and said.
    let b = ok(&app, post("/api/wave/board", &board.replace(r#""kind":"fx:convolution","#, r#""kind":"fx:convolution","sound":"elsewhere/hall.wav","#)));
    assert_eq!(text(node(&b, "g"), &["soundState"]), "unreadable");

    // The catalogue says which effects take a sound.
    let fx = ok(&app, get("/api/wave/fx", &[]));
    let find = |k: &str| arr(&fx).into_iter().find(|e| text(e, &["kind"]) == k).unwrap();
    assert_eq!(text(&find("fx:convolution"), &["sound", "key"]), "impulse");
    assert_eq!(text(&find("fx:spectral-dynamics"), &["sound", "label"]), "Threshold sound");
    assert!(find("fx:echo").get("sound").is_none());
}
