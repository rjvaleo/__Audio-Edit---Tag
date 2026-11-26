//! The FX modules against MGL's own. MGL's `/api/fx` (the catalogue every
//! card is drawn from), recorded from MGL's server, is answered to the
//! letter. Every effect module (every mode of every module MGL offers, all
//! 101 of prism-fx's effects, and the rack's three built-ins) plays what its
//! kernel played when prism-fx's golden set was recorded (prism-fx
//! `tests/golden/par.tsv`, SUITE-PLAN P0), to the bit, through the canvas:
//! made as MGL's Add menu makes the slot, fed the golden's own input, its
//! controls moved through the module's own calls as the golden moves them.
//! The FX page plays the Sound cabled into it and the audio cabled into it
//! through MGL's rack and deck levels; a canvas saved and loaded plays the
//! same; nothing on the audio thread allocates.

#[path = "../../engine-mgl/tests/common/mod.rs"]
mod common;
use common::*;
use engine_app::fx;
use engine_app::Session;
use engine_core::*;
use mgl_fx::prism::prism_fx;
use prism_fx::par;
use serde_json::{json, Value};
use std::collections::HashMap;

// MGL's /api/fx as MGL's own route test recorded it (prism_references.rs).
const GIVEN: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/reference/prism/refs.json");
const GOLDEN: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../GitHub/prism-fx/crates/prism-fx/tests/golden/par.tsv");

/// Plays the golden's input once, from the start, then silence.
struct Feed {
    l: Vec<f32>,
    r: Vec<f32>,
    at: usize,
}

impl Module for Feed {
    fn inputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn process(&mut self, io: &mut Io) {
        let (l, r) = io.outs.audio(0);
        for i in 0..l.len() {
            let n = self.at + i;
            l[i] = self.l.get(n).copied().unwrap_or(0.0);
            r[i] = self.r.get(n).copied().unwrap_or(0.0);
        }
        self.at += l.len();
    }
}

const FEED: ModuleId = 4000 * 16;

/// A canvas with one effect module fed the golden's input and heard.
fn effect_canvas(kind: &str) -> (Session, AudioEngine, u32) {
    let (mut s, audio) = Session::with_config(prism_fx::contract::SAMPLE_RATE, exact());
    let id = s.add(kind, 0.0, 0.0).unwrap();
    let (l, r) = par::input();
    let ctl = s.controller();
    ctl.add(FEED, Box::new(Feed { l, r, at: 0 })).unwrap();
    ctl.connect(port(FEED, 0), port(id * 16, 0)).unwrap();
    ctl.connect_out(port(id * 16, 0)).unwrap();
    ctl.commit().unwrap();
    (s, audio, id)
}

fn golden() -> HashMap<(String, String), String> {
    std::fs::read_to_string(GOLDEN)
        .expect("prism-fx's golden set (GitHub/prism-fx)")
        .lines()
        .map(|l| {
            let f: Vec<&str> = l.split('\t').collect();
            ((f[0].to_string(), f[1].to_string()), f[2].to_string())
        })
        .collect()
}

fn hash(l: &[f32], r: &[f32]) -> String {
    format!("{:016x}", par::hash(l, r))
}

fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Object(x), Value::Object(y)) => x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same(v, w))),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(v, w)| same(v, w)),
        _ => a == b,
    }
}

/// Where two JSON values first differ, for the message.
fn diff(path: &str, a: &Value, b: &Value) -> Option<String> {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            for (k, v) in x {
                match y.get(k) {
                    Some(w) => {
                        if let Some(d) = diff(&format!("{path}.{k}"), v, w) {
                            return Some(d);
                        }
                    }
                    None => return Some(format!("{path}.{k}: ours only")),
                }
            }
            y.keys().find(|k| !x.contains_key(*k)).map(|k| format!("{path}.{k}: MGL's only"))
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                return Some(format!("{path}: {} against {}", x.len(), y.len()));
            }
            x.iter().zip(y).enumerate().find_map(|(i, (v, w))| diff(&format!("{path}[{i}]"), v, w))
        }
        _ => (!same(a, b)).then(|| format!("{path}: {a} against {b}")),
    }
}

#[test]
fn the_catalogue_is_mgls_own() {
    let refs: Value = serde_json::from_str(&std::fs::read_to_string(GIVEN).unwrap()).unwrap();
    let mgl = refs["fx"].clone();
    let ours = fx::catalogue_json();
    if let Some(d) = diff("", &ours, &mgl) {
        panic!("/api/fx differs from MGL's: {d}");
    }
    // Every mode is a module on the canvas (all 101), and the three built-ins.
    let modes: usize = mgl["suites"].as_array().unwrap().iter().map(|s| s["families"].as_array().unwrap().iter().map(|f| f["modes"].as_array().unwrap().len()).sum::<usize>()).sum();
    assert_eq!(modes, 101);
    assert_eq!(fx::effects().len(), 101 + 1, "every mode, and the rack's Gain");
    let mut ids: Vec<&str> = fx::effects().iter().map(|e| e.id.as_str()).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), fx::effects().len(), "one module per effect");
    for e in fx::effects() {
        let k = engine_app::kind(&e.id).unwrap_or_else(|| panic!("{} is not a module", e.id));
        assert_eq!(k.width, fx::card_width(&e.kind));
    }
}

/// The kernel a mode plays and its controls, as the golden was recorded.
fn kernel_of(e: &fx::EffectKind) -> Option<&'static prism_fx::Descriptor> {
    let mode = prism_fx::suite::find_mode(e.suite?, e.mode?)?;
    prism_fx::CATALOG.iter().find(|c| c.descriptor.id == mode.kernel).map(|c| c.descriptor)
}

/// Render the golden's frames out of effect module `kind`, in blocks of
/// `block`, with `moves` (frame, key, value) sent through the module's own
/// call at the start of the block they fall in, as the golden moves them.
/// Beside it, the same through MGL's rack built by hand as MGL's server
/// builds it and moved as `/api/rack/param` moves it (the spec clamps, the
/// live rack takes what it applied). Both hashes.
fn play(kind: &str, block: usize, moves: &[(usize, &str, f32)]) -> (String, String) {
    let (mut s, mut audio, id) = effect_canvas(kind);
    let e = fx::effect(kind).unwrap();
    let mut spec = fx::one_slot(e);
    let mut rack = spec.build(48_000, 2);
    let (mut ml, mut mr) = par::input();
    let mut l = vec![0.0; par::FRAMES];
    let mut r = vec![0.0; par::FRAMES];
    let mut at = 0;
    while at < par::FRAMES {
        let end = (at + block).min(par::FRAMES);
        for (f, key, v) in moves {
            if *f >= at && *f < end {
                s.fx_call(id, "rack", &json!({ "op": "param", "id": "fx-1", "key": key, "value": v })).unwrap();
                assert!(spec.set_param(0, key, *v), "{kind}: no control {key}");
                let applied = spec.get_param(0, key).unwrap_or(*v);
                rack.set_param(0, key, applied);
            }
        }
        audio.render(&mut l[at..end], &mut r[at..end]);
        s.collect();
        mgl_process(&mut rack, &mut ml[at..end], &mut mr[at..end], 48_000);
        at = end;
    }
    (hash(&l, &r), hash(&ml, &mr))
}

#[test]
fn every_effect_module_plays_its_kernels_golden_bits() {
    let g = golden();
    let mut bad = Vec::new();
    let mut mgls_own = Vec::new();
    let mut checked = 0;
    let mut sounds = Vec::new();
    for e in fx::effects() {
        // The Parametric EQ, the Compressor and the Gain are MGL's own built-ins: below.
        if matches!(e.kind.as_str(), "eq" | "comp" | "gain") {
            continue;
        }
        let Some(d) = kernel_of(e) else {
            bad.push(format!("{}: no kernel", e.id));
            continue;
        };
        if d.sound.is_some() {
            // The golden hands these prism-fx's test sound; the canvas hands
            // them the sound cabled in (none here).
            sounds.push(e.id.clone());
            continue;
        }
        let mut check = |sc: String, (got, mgl): (String, String)| {
            checked += 1;
            if got != mgl {
                bad.push(format!("{} ({}) {sc}: {got}, MGL's rack by hand {mgl}", e.id, d.id));
                return;
            }
            match g.get(&(d.id.to_string(), sc.clone())) {
                Some(h) if *h == got => {}
                // MGL's own rack plays it so, and the module plays MGL's rack.
                Some(h) => mgls_own.push(format!("{} ({}) {sc}: {got}, golden {h}", e.id, d.id)),
                None => bad.push(format!("{} ({}) {sc}: not in the golden set", e.id, d.id)),
            }
        };
        check("default/512".into(), play(&e.id, 512, &[]));
        check("default/61".into(), play(&e.id, 61, &[]));
        for p in d.params.iter().filter(|p| !p.inert) {
            let far = if (p.default - p.min).abs() > (p.default - p.max).abs() { p.min } else { p.max };
            check(format!("{}~moved", p.key), play(&e.id, 61, &[(par::FRAMES / 3, p.key, far), (2 * par::FRAMES / 3, p.key, p.default)]));
        }
    }
    assert!(bad.is_empty(), "{} of {checked} renders differ:\n{}", bad.len(), bad.join("\n"));
    assert!(checked > 900, "only {checked} renders checked");
    eprintln!("{checked} renders of {} effect modules, each MGL's rack's to the bit; {} of them prism-fx's golden too.", fx::effects().len() - 3 - sounds.len(), checked - mgls_own.len());
    eprintln!("With a sound input, not checked against the golden: {sounds:?}");
    eprintln!("Where MGL's own rack differs from prism-fx's golden ({}):\n{}", mgls_own.len(), mgls_own.join("\n"));
    // What MGL's rack differs on today, recorded: anything new is a change.
    let known = ["fx:dattorro_flanger", "fx:dattorro_vibrato", "fx:prism:hp-pitch-shifter"];
    for m in &mgls_own {
        assert!(known.iter().any(|k| m.starts_with(&format!("{k} "))), "a new difference from the golden: {m}");
    }
}

/// A block through MGL's rack as MGL's deck runs it: interleaved.
fn mgl_process(rack: &mut mgl_fx::Rack, l: &mut [f32], r: &mut [f32], sr: u32) {
    let mut buf: Vec<f32> = l.iter().zip(r.iter()).flat_map(|(a, b)| [*a, *b]).collect();
    rack.process(&mut buf, 2, sr);
    for (i, f) in buf.chunks_exact(2).enumerate() {
        l[i] = f[0];
        r[i] = f[1];
    }
}

/// The rack's built-ins as MGL's rack plays them: a rack of the one slot built by hand.
#[test]
fn the_built_ins_play_as_mgls_rack() {
    for kind in ["fx:eq", "fx:comp", "fx:gain"] {
        let e = fx::effect(kind).unwrap();
        let mut rack = fx::one_slot(e).build(prism_fx::contract::SAMPLE_RATE as u32, 2);
        let (mut l, mut r) = par::input();
        for at in (0..par::FRAMES).step_by(512) {
            let end = (at + 512).min(par::FRAMES);
            mgl_process(&mut rack, &mut l[at..end], &mut r[at..end], 48_000);
        }
        let want = hash(&l, &r);
        assert_eq!(play(kind, 512, &[]).0, want, "{kind}");
    }
}

/// A Sound module with a WAV of a second of a sine and noise.
fn sound_wav() -> std::path::PathBuf {
    let frames = 48_000usize;
    let mut out = audio_core::wav::header((frames * 4) as u64, 2, 48_000, audio_core::Codec::PcmI16).to_vec();
    let mut seed = 1u32;
    for i in 0..frames {
        seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        let l = ((i as f32 / 25.0).sin() * 9000.0) as i16;
        let r = ((seed >> 16) as i16) / 6;
        out.extend_from_slice(&l.to_le_bytes());
        out.extend_from_slice(&r.to_le_bytes());
    }
    // One file per call: the tests run at once, and one must not read another's half written.
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let d = std::env::temp_dir().join(format!("fx-src-{}-{n}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    let path = d.join("fx.wav");
    std::fs::write(&path, out).unwrap();
    path
}

fn page_canvas() -> (Session, AudioEngine, u32, u32) {
    let (mut s, audio) = Session::with_config(48_000.0, exact());
    let sound = s.add("sound", 0.0, 0.0).unwrap();
    let page = s.add("fx", 400.0, 0.0).unwrap();
    s.connect((sound, 0), (page, 0)).unwrap();
    let path = sound_wav();
    s.sound_open(sound, path.to_str().unwrap(), &json!({ "kind": "file", "path": "fx.wav", "name": "fx.wav" }), false).unwrap();
    let ctl = s.controller();
    ctl.connect_out(port(page * 16 + fx::LEVELS, 0)).unwrap();
    ctl.commit().unwrap();
    (s, audio, sound, page)
}

/// The FX page plays its sound through MGL's factory rack and MGL's deck
/// levels: the document's frames through a rack built by hand as MGL builds
/// it, times the transport's gain, sample for sample.
#[test]
fn the_page_plays_its_sound_through_mgls_rack_and_levels() {
    let (mut s, mut audio, _sound, page) = page_canvas();
    let info = s.fx_call(page, "info", &Value::Null).unwrap();
    assert_eq!(info["rack"]["slots"].as_array().unwrap().len(), 2, "MGL's factory rack: EQ, then the compressor");
    // Played at unity (the LR fader at 1, the sides at unity) to compare.
    s.fx_call(page, "transport", &json!({ "volume": 1.0, "sideL": fx::UNITY, "sideR": fx::UNITY })).unwrap();
    render(&mut audio, 4_096, 256);
    s.fx_call(page, "transport", &json!({ "play": true, "seek": 0 })).unwrap();
    let (l, r) = render(&mut audio, 24_000, 256);
    let start = l.iter().zip(&r).position(|(a, b)| *a != 0.0 || *b != 0.0).expect("it plays");
    assert!(start < 512, "it starts at once ({start})");
    let mut rack = engine_app::grain::rack::RackSpec::from_json(&info["rack"]).build(48_000, 2);
    // The document as the player hands it on: read it back from a second page.
    let (mut s2, mut audio2, _s2, page2) = page_canvas();
    s2.fx_call(page2, "rack", &json!({ "op": "set", "slots": [] })).unwrap();
    s2.fx_call(page2, "transport", &json!({ "volume": 1.0, "sideL": fx::UNITY, "sideR": fx::UNITY })).unwrap();
    render(&mut audio2, 4_096, 256);
    s2.fx_call(page2, "transport", &json!({ "play": true, "seek": 0 })).unwrap();
    let (mut dl, mut dr) = render(&mut audio2, 24_000, 256);
    assert!(peak(&dl) > 0.1 && peak(&dr) > 0.01, "the dry sound plays");
    for at in (start..24_000).step_by(256) {
        let end = (at + 256).min(24_000);
        mgl_process(&mut rack, &mut dl[at..end], &mut dr[at..end], 48_000);
    }
    assert_same("left", &l[start..], &dl[start..]);
    assert_same("right", &r[start..], &dr[start..]);
}

#[test]
fn the_page_takes_audio_cabled_in_and_its_faders_and_powers_are_heard() {
    let (mut s, mut audio, _sound, page) = page_canvas();
    let ctl = s.controller();
    ctl.add(FEED, Box::new(Feed { l: vec![0.25; 200_000], r: vec![-0.25; 200_000], at: 0 })).unwrap();
    ctl.connect(port(FEED, 0), port(page * 16 + fx::SUM, 1)).unwrap();
    ctl.commit().unwrap();
    s.fx_call(page, "rack", &json!({ "op": "set", "slots": [] })).unwrap();
    s.fx_call(page, "transport", &json!({ "volume": 1.0, "sideL": fx::UNITY, "sideR": fx::UNITY })).unwrap();
    let (l, r) = render(&mut audio, 8_192, 256);
    assert_eq!(l[8_000], 0.25);
    assert_eq!(r[8_000], -0.25);
    // The L fader down to nothing, the R to +3.5 dB (the page's top): MGL's ramps land.
    s.fx_call(page, "transport", &json!({ "sideL": 0.0, "sideR": 1.0 })).unwrap();
    let (l, r) = render(&mut audio, 8_192, 256);
    assert_eq!(l[8_000], 0.0);
    let want = -0.25 * ((1.0f64 / fx::UNITY).powi(2)) as f32;
    assert!((r[8_000] - want).abs() < 1e-6, "{} against {want}", r[8_000]);
    // A gain slot added, then switched off and on.
    s.fx_call(page, "transport", &json!({ "sideL": fx::UNITY, "sideR": fx::UNITY })).unwrap();
    s.fx_call(page, "rack", &json!({ "op": "add", "kind": "gain" })).unwrap();
    let id = s.fx_call(page, "rack", &json!({ "op": "get" })).unwrap()["slots"][0]["id"].as_str().unwrap().to_string();
    s.fx_call(page, "rack", &json!({ "op": "param", "id": id, "key": "db", "value": -6.0 })).unwrap();
    let (l, _) = render(&mut audio, 16_384, 256);
    let g = 10f32.powf(-6.0 / 20.0);
    assert!((l[16_000] - 0.25 * g).abs() < 1e-4, "{} against {}", l[16_000], 0.25 * g);
    s.fx_call(page, "rack", &json!({ "op": "bypass", "at": 0, "on": false })).unwrap();
    let (l, _) = render(&mut audio, 16_384, 256);
    assert_eq!(l[16_000], 0.25);
}

#[test]
fn a_canvas_saved_and_loaded_plays_the_same() {
    for kind in ["fx:prism:echo", "fx:dattorro_plate", "fx"] {
        let (mut s, mut audio) = Session::with_config(48_000.0, exact());
        let id = s.add(kind, 0.0, 0.0).unwrap();
        let rack = s.fx_call(id, "rack", &json!({ "op": "get" })).unwrap();
        let slot = rack["slots"][0]["id"].as_str().unwrap().to_string();
        let key = if kind == "fx" { "makeupDb" } else if kind.contains("echo") { "feedback" } else { "decay" };
        let slot_at = if kind == "fx" { rack["slots"][1]["id"].as_str().unwrap().to_string() } else { slot };
        s.fx_call(id, "rack", &json!({ "op": "param", "id": slot_at, "key": key, "value": 0.5 })).unwrap();
        if kind == "fx" {
            s.fx_call(id, "transport", &json!({ "volume": 0.6, "sideL": 0.7 })).unwrap();
        }
        let saved = s.save();
        let (mut t, mut audio2) = Session::with_config(48_000.0, exact());
        t.load(&saved).unwrap();
        let feed = |s: &mut Session, id: u32| {
            let at = if kind == "fx" { port(id * 16 + fx::SUM, 1) } else { port(id * 16, 0) };
            let out = if kind == "fx" { port(id * 16 + fx::LEVELS, 0) } else { port(id * 16, 0) };
            let (l, r) = par::input();
            let ctl = s.controller();
            ctl.add(FEED, Box::new(Feed { l, r, at: 0 })).unwrap();
            ctl.connect(port(FEED, 0), at).unwrap();
            ctl.connect_out(out).unwrap();
            ctl.commit().unwrap();
        };
        feed(&mut s, id);
        feed(&mut t, id);
        assert_eq!(t.fx_call(id, "rack", &json!({ "op": "get" })).unwrap(), s.fx_call(id, "rack", &json!({ "op": "get" })).unwrap());
        let (a, b) = render(&mut audio, 16_000, 256);
        let (c, d) = render(&mut audio2, 16_000, 256);
        assert!(peak(&a) > 0.01, "{kind} plays");
        assert_same(kind, &a, &c);
        assert_same(kind, &b, &d);
    }
}

#[test]
fn nothing_on_the_audio_thread_allocates_while_fx_plays_and_changes() {
    assert_the_check_is_on();
    let (mut s, mut audio, _sound, page) = page_canvas();
    let fxm = s.add("fx:prism:echo", 0.0, 900.0).unwrap();
    s.controller().connect_out(port(fxm * 16, 0)).unwrap();
    s.controller().commit().unwrap();
    s.fx_call(page, "transport", &json!({ "play": true, "loop": { "on": true, "a": 0, "b": 0 } })).unwrap();
    render(&mut audio, 8_192, 256);
    s.collect();
    let before = counted();
    for i in 0..8 {
        s.fx_call(page, "rack", &json!({ "op": "param", "id": "factory-comp", "key": "ratio", "value": 1 + i })).unwrap();
        s.fx_call(page, "rack", &json!({ "op": "bypass", "at": 0, "on": i % 2 == 0 })).unwrap();
        s.fx_call(page, "transport", &json!({ "sideL": 0.5 + 0.05 * i as f64, "volume": 0.7 })).unwrap();
        s.fx_call(fxm, "rack", &json!({ "op": "param", "id": "fx-1", "key": "feedback", "value": 0.1 * i as f64 })).unwrap();
        render(&mut audio, 2_048, 256);
        s.collect();
    }
    assert_eq!(counted() - before, 0, "allocations or frees inside a render; the last sizes: {:?}", last_sizes());
}
