//! Chop in the native engine: the page's arithmetic, to the bit, against a
//! recording of the page itself; and the module playing what it is handed,
//! allocating nothing.
//!
//! `tests/reference/chop/chop-port.json` is what `tests/ui/chop-port.spec.mjs`
//! recorded in Chromium (made with `native/tools/chop-references.py`): every
//! case's settings, and what came back, its arrays of floats as their length
//! and FNV-1a hash. `CHOP_PORT_REF=<the full recording>`
//! (`WORK DIR/idmlab-move/reference-renders/chop-port`) says where a float
//! array first differs.

mod common;
use common::*;
use engine_core::*;
use engine_mgl::chop::{self, listen, Div, Feel, Filter, Flag, Mode, Page, Render, Settings, Slice, TailParams};
use engine_mgl::{Chop, ChopThing};
use serde_json::Value;
use std::path::PathBuf;

fn here() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/reference/chop")
}

fn floats(bytes: &[u8]) -> Vec<f32> {
    bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect()
}

/// The break, a channel a buffer.
fn input(doc: &Value) -> (Vec<Vec<f32>>, f64) {
    let inp = &doc["input"];
    let all = floats(&std::fs::read(here().join(inp["file"].as_str().unwrap())).unwrap());
    let ch = inp["channels"].as_u64().unwrap() as usize;
    let chs = (0..ch).map(|c| all.iter().skip(c).step_by(ch).copied().collect()).collect();
    (chs, inp["rate"].as_f64().unwrap())
}

fn doc() -> Value {
    serde_json::from_str(&std::fs::read_to_string(here().join("chop-port.json")).unwrap()).unwrap()
}

fn fnv(a: &[f32]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for v in a {
        for b in v.to_le_bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
    }
    format!("{h:016x}")
}

/// What went wrong, gathered so one run says everything.
#[derive(Default)]
struct Check {
    faults: Vec<String>,
    counted: usize,
}

impl Check {
    fn f32s(&mut self, what: &str, want: &Value, got: &[f32]) {
        self.counted += got.len();
        let n = want["n"].as_u64().unwrap() as usize;
        if n == got.len() && want["fnv"].as_str().unwrap() == fnv(got) {
            return;
        }
        let mut say = format!("{what}: {} floats against {n}", got.len());
        if let Ok(dir) = std::env::var("CHOP_PORT_REF") {
            let file = PathBuf::from(dir).join(want["f32"].as_str().unwrap());
            if let Ok(bytes) = std::fs::read(&file) {
                let w = floats(&bytes);
                if let Some(i) = first_difference(&w, got) {
                    say += &format!(", first differs at {i}: {:?} against the page's {:?}", got.get(i), w.get(i));
                }
            }
        } else {
            say += " (CHOP_PORT_REF names the recording, to say where)";
        }
        self.faults.push(say);
    }
    fn num(&mut self, what: &str, want: &Value, got: f64) {
        self.counted += 1;
        let w = want.as_f64().unwrap_or(f64::NAN);
        if w.to_bits() != got.to_bits() && !(w == 0.0 && got == 0.0) {
            self.faults.push(format!("{what}: {got:?} against the page's {w:?}"));
        }
    }
    fn f64s(&mut self, what: &str, want: &Value, got: &[f64]) {
        let w = want["f64"].as_array().unwrap();
        if w.len() != got.len() {
            self.faults.push(format!("{what}: {} doubles against {}", got.len(), w.len()));
            return;
        }
        for (i, (w, g)) in w.iter().zip(got).enumerate() {
            self.num(&format!("{what}[{i}]"), w, *g);
        }
    }
    fn ints(&mut self, what: &str, want: &Value, got: &[i64]) {
        self.counted += got.len();
        let w: Vec<i64> = want.as_array().unwrap().iter().map(|v| v.as_f64().unwrap() as i64).collect();
        if w != got {
            self.faults.push(format!("{what}: {got:?} against the page's {w:?}"));
        }
    }
    fn pairs(&mut self, what: &str, want: &Value, got: &[[i64; 2]]) {
        let flat: Vec<i64> = got.iter().flatten().copied().collect();
        let w: Vec<Value> = want.as_array().unwrap().iter().flat_map(|p| p.as_array().unwrap().clone()).collect();
        self.ints(what, &Value::Array(w), &flat);
    }
    fn tail(&mut self, what: &str, want: &Value, got: &TailParams) {
        match got {
            TailParams::No { reason } => {
                if want["viable"] != Value::Bool(false) || want["reason"].as_str() != Some(reason.as_str()) {
                    self.faults.push(format!("{what}: not viable, {reason:?}, against the page's {want}"));
                }
            }
            TailParams::Yes(t) => {
                if want["viable"] != Value::Bool(true) || want["clamped"] != Value::Bool(t.clamped) {
                    self.faults.push(format!("{what}: {t:?} against the page's {want}"));
                    return;
                }
                for (k, v) in [
                    ("tailLen", t.tail_len as f64),
                    ("actualMs", t.actual_ms),
                    ("requestedTailMs", t.requested_tail_ms),
                    ("loopStart", t.loop_start as f64),
                    ("numCycles", t.num_cycles as f64),
                    ("xfLen", t.xf_len as f64),
                    ("totalFrames", t.total_frames as f64),
                    ("sliceLen", t.slice_len as f64),
                ] {
                    self.num(&format!("{what}.{k}"), &want[k], v);
                }
            }
        }
    }
    fn render(&mut self, what: &str, want: &Value, got: &Render) {
        self.chans(&format!("{what}.chs"), &want["chs"], &got.chs);
        let map = want["map"].as_array().unwrap();
        if map.len() != got.map.len() {
            self.faults.push(format!("{what}: {} placed against {}", got.map.len(), map.len()));
            return;
        }
        for (i, (w, g)) in map.iter().zip(&got.map).enumerate() {
            for (k, v) in [("at", g.at as f64), ("len", g.len as f64), ("s", g.s as f64), ("k", g.k)] {
                self.num(&format!("{what}.map[{i}].{k}"), &w[k], v);
            }
        }
    }
    fn chans(&mut self, what: &str, want: &Value, got: &[Vec<f32>]) {
        let w = want.as_array().unwrap();
        if w.len() != got.len() {
            self.faults.push(format!("{what}: {} channels against {}", got.len(), w.len()));
            return;
        }
        for (c, (w, g)) in w.iter().zip(got).enumerate() {
            self.f32s(&format!("{what}[{c}]"), w, g);
        }
    }
}

/// One of the page's settings, by its name, at its raw value.
fn set_one(s: &mut Settings, k: &str, v: &Value) {
    let n = || v.as_f64().unwrap();
    let b = || v.as_bool().unwrap();
    let t = || v.as_str().unwrap();
    match k {
        "mode" => s.mode = match t() { "silence" => Mode::Silence, "grid" => Mode::Grid, _ => Mode::Transient },
        "sens" => s.sens = n(),
        "topDb" => s.top_db = n(),
        "minDur" => s.min_dur = n(),
        "pad" => s.pad = n(),
        "div" => s.div = if t() == "bar" { Div::Bar } else { Div::Of(t().parse().unwrap()) },
        "feel" => s.feel = match t() { "dot" => Feel::Dot, "trip" => Feel::Trip, _ => Feel::Straight },
        "nudge" => s.nudge = n(),
        "shuffle" => s.shuffle = n(),
        "gate" => s.gate = n(),
        "smooth" => s.smooth = n(),
        "tail" => s.tail = b(),
        "tailMs" => s.tail_ms = n(),
        "bars" => s.bars = n(),
        "beats" => s.beats = n(),
        "sig" => s.sig = n(),
        "tempo" => s.tempo = n(),
        "pitch" => s.pitch = n(),
        "stretch" => s.stretch = n(),
        "sync" => s.lock = t() == "lock",
        "envOn" => s.env_on = b(),
        "attack" => s.attack = n(),
        "decay" => s.decay = n(),
        "trOn" => s.tr_on = b(),
        "trThresh" => s.tr_thresh = n(),
        "trAmount" => s.tr_amount = n(),
        "trAttack" => s.tr_attack = n(),
        "trRelease" => s.tr_release = n(),
        "trGain" => s.tr_gain = n(),
        "eqOn" => s.eq_on = b(),
        "loCut" => s.lo_cut = n(),
        "lowF" => s.low_f = n(),
        "lowG" => s.low_g = n(),
        "lowQ" => s.low_q = n(),
        "highF" => s.high_f = n(),
        "highG" => s.high_g = n(),
        "highQ" => s.high_q = n(),
        "hiCut" => s.hi_cut = n(),
        "fltOn" => s.flt_on = b(),
        "fltType" => s.flt_type = Filter::named(t()),
        "fltFreq" => s.flt_freq = n(),
        "fltQ" => s.flt_q = n(),
        "drive" => s.drive = n(),
        "gain" => s.gain = n(),
        "mix" => s.mix = n(),
        other => panic!("a setting the test does not know: {other}"),
    }
}

/// The page's settings, from its names: the starting ones with `set` over them.
fn settings(set: &Value) -> Settings {
    let mut s = Settings::default();
    let Some(set) = set.as_object() else { return s };
    for (k, v) in set {
        set_one(&mut s, k, v);
    }
    s
}

/// The page for a case: the break, its settings, its slices marked.
fn page_for(chs: &[Vec<f32>], rate: f64, case: &Value) -> Page {
    let mut page = Page::new(chs.to_vec(), rate, settings(&case["set"]));
    if let Some(flags) = case["flags"].as_object() {
        for (flag, list) in flags {
            for i in list.as_array().unwrap() {
                let x = &mut page.slices[i.as_u64().unwrap() as usize];
                match flag.as_str() {
                    "rev" => x.rev = true,
                    "muted" => x.muted = true,
                    other => panic!("no such flag: {other}"),
                }
            }
        }
    }
    page
}

fn span(c: &[f32], v: &Value) -> Vec<f32> {
    let (s, e) = (v[0].as_u64().unwrap() as usize, v[1].as_u64().unwrap() as usize);
    c[s..e].to_vec()
}

#[test]
fn it_gives_the_pages_numbers_to_the_bit() {
    let doc = doc();
    let (chs, rate) = input(&doc);
    let mut check = Check::default();
    let cases = doc["cases"].as_array().unwrap();
    for case in cases {
        let id = case["id"].as_str().unwrap();
        let page = page_for(&chs, rate, case);
        let v = &case["value"];
        let segs = |m: &Value| {
            chop::detect_segs(&chop::build_rms(&page.mono), m["topDb"].as_f64().unwrap(), m["minDur"].as_f64().unwrap(), m["pad"].as_f64().unwrap(), page.rate, page.len)
        };
        // What every case records of the page: its slices and its tempos.
        let slices: Vec<[i64; 2]> = page.slices.iter().map(|x| [x.s, x.e]).collect();
        check.pairs(&format!("{id}: the slices"), &case["slices"], &slices);
        check.num(&format!("{id}: bpm"), &case["bpm"], page.bpm());
        check.num(&format!("{id}: playBpm"), &case["playBpm"], page.play_bpm());
        match case["what"].as_str().unwrap() {
            "mono" => check.f32s(id, v, &page.mono),
            "rms" => check.f64s(id, v, &page.rms),
            "segs" => check.pairs(id, v, &segs(case)),
            "tails" => {
                for (i, [s, e]) in segs(case).into_iter().enumerate() {
                    check.tail(&format!("{id}[{i}]"), &v[i], &chop::tail_params(s, e, case["tailMs"].as_f64().unwrap(), rate));
                }
            }
            "tailsAt" => {
                for (i, sp) in case["spans"].as_array().unwrap().iter().enumerate() {
                    for (j, t) in case["tails"].as_array().unwrap().iter().enumerate() {
                        let p = chop::tail_params(sp[0].as_i64().unwrap(), sp[1].as_i64().unwrap(), t.as_f64().unwrap(), rate);
                        check.tail(&format!("{id}[{i}][{j}]"), &v[i][j], &p);
                    }
                }
            }
            "onsets" => check.ints(id, v, &page.onsets()),
            "cuts" => check.pairs(id, v, &slices),
            "tempo" => {
                check.num(&format!("{id}.bpm"), &v["bpm"], page.bpm());
                let found = page.find_tempo().expect("a tempo");
                let w = &v["found"];
                for (k, g) in [("bpm", found.bpm), ("heard", found.heard), ("bars", found.bars), ("beats", found.beats), ("off", found.off), ("sure", found.sure)] {
                    check.num(&format!("{id}.found.{k}"), &w[k], g);
                }
                if w["whole"] != Value::Bool(found.whole) {
                    check.faults.push(format!("{id}.found.whole: {}", found.whole));
                }
            }
            "analyse" => {
                let a = listen::analyse(&page.mono, rate);
                check.num(&format!("{id}.F"), &v["F"], a.frames as f64);
                check.num(&format!("{id}.HOP"), &v["HOP"], a.hop as f64);
                check.num(&format!("{id}.N"), &v["N"], a.n as f64);
                for (k, arr) in [
                    ("low", &a.low), ("mid", &a.mid), ("high", &a.high), ("cent", &a.cent), ("flat", &a.flat),
                    ("zcr", &a.zcr), ("rms", &a.rms), ("rise", &a.rise), ("hz", &a.hz), ("clar", &a.clar),
                ] {
                    check.f32s(&format!("{id}.{k}"), &v[k], arr);
                }
                check.num(&format!("{id}.pulse"), &v["pulse"], a.pulse);
                check.num(&format!("{id}.hits"), &v["hits"], a.hits);
            }
            "resample" => {
                let c = span(&chs[0], &case["span"]);
                for (i, r) in case["ratios"].as_array().unwrap().iter().enumerate() {
                    check.f32s(&format!("{id}[{i}]"), &v[i], &chop::resample(&c, r.as_f64().unwrap()));
                }
            }
            "biquad" => {
                for (i, f) in case["filters"].as_array().unwrap().iter().enumerate() {
                    let k = chop::biquad(Filter::named(f[0].as_str().unwrap()), f[1].as_f64().unwrap(), f[2].as_f64().unwrap(), f[3].as_f64().unwrap(), rate);
                    check.f64s(&format!("{id}[{i}].k"), &v[i]["k"], &k);
                    let mut c = span(&chs[0], &case["span"]);
                    chop::run_biquad(&mut c, &k);
                    check.f32s(&format!("{id}[{i}].out"), &v[i]["out"], &c);
                }
            }
            "pingpong" => {
                for (i, t) in case["tails"].as_array().unwrap().iter().enumerate() {
                    let (inter, p) = chop::ping_pong_tail(&chs, t[0].as_i64().unwrap(), t[1].as_i64().unwrap(), t[2].as_f64().unwrap(), rate).unwrap();
                    check.f32s(&format!("{id}[{i}]"), &v[i]["interleaved"], &inter);
                    check.num(&format!("{id}[{i}].totalFrames"), &v[i]["totalFrames"], p.total_frames as f64);
                    check.tail(&format!("{id}[{i}].params"), &v[i]["params"], &TailParams::Yes(p));
                }
            }
            "slice" => check.chans(id, v, &page.slice_audio(case["index"].as_u64().unwrap() as usize, 0)),
            "preview" => check.render(id, v, &page.render_preview()),
            "ratchet" => check.render(id, v, &page.render_ratchet()),
            other => panic!("a case the test does not know: {other}"),
        }
    }
    assert!(check.faults.is_empty(), "{} differences from the page:\n{}", check.faults.len(), check.faults.join("\n"));
    assert!(cases.len() >= 47 && check.counted > 1_000_000, "{} cases, {} values", cases.len(), check.counted);
    println!("chop: {} cases, {} values, every one the page's to the bit", cases.len(), check.counted);
}

#[test]
fn v8s_own_maths() {
    use engine_mgl::chop::js;
    assert_eq!(js::round(2.5), 3.0);
    assert_eq!(js::round(-2.5), -2.0);
    assert_eq!(js::round(0.49999999999999994), 0.0);
    assert_eq!(js::fixed0(2.5), "3");
    assert_eq!(js::fixed0(35.0), "35");
    assert_eq!(js::log10(1000.0), 3.0);
    assert_eq!(js::log10(1.0), 0.0);
    assert_eq!(js::log10(0.0), f64::NEG_INFINITY);
    assert_eq!(js::tanh(0.0), 0.0);
    assert_eq!(js::tanh(30.0), 1.0);
    assert_eq!(js::hypot(3.0, 4.0), 5.0);
    assert!(js::pow(1.0, f64::INFINITY).is_nan());
}

// ------------------------------------------------- the module

const BLOCK: usize = 128;

/// The break on a quarter grid, through the EQ and the filter, at 100 BPM.
fn page() -> Page {
    let doc = doc();
    let (chs, rate) = input(&doc);
    let mut s = Settings { mode: Mode::Grid, div: Div::Of(4.0), tempo: 100.0, stretch: 50.0, ..Settings::default() };
    s.eq_on = true;
    s.low_g = 4.0;
    s.flt_on = true;
    s.flt_type = Filter::Bp;
    s.flt_freq = 900.0;
    s.drive = 30.0;
    Page::new(chs, rate, s)
}

/// Slices 0, 2 and 3 on notes, on their own samples; 2 again over itself.
fn notes() -> Vec<(u64, NoteEvent)> {
    vec![
        (301, NoteEvent::on(36, 1.0)),
        (9_000, NoteEvent::off(36)),
        (13_007, NoteEvent::on(38, 0.4)),
        (20_513, NoteEvent::on(38, 0.9)),
        (40_001, NoteEvent::on(39, 0.7)),
    ]
}

/// What the notes should sound: each slice's render, added in from its note.
fn expected(page: &Page, frames: usize) -> (Vec<f32>, Vec<f32>) {
    let (mut l, mut r) = (vec![0.0f32; frames], vec![0.0f32; frames]);
    for (at, n) in notes() {
        if n.kind != NoteKind::On {
            continue;
        }
        let chs = page.slice_audio((n.note - 36) as usize, 0);
        for j in 0..chs[0].len() {
            let i = at as usize + j;
            if i < frames {
                l[i] += chs[0][j];
                r[i] += chs[1][j];
            }
        }
    }
    (l, r)
}

fn played(page: &Page, frames: usize, block: usize, uneven: bool) -> (Vec<f32>, Vec<f32>) {
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Script::new(notes()))).unwrap();
    ctl.add(2, Box::new(Chop::new())).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    ctl.give(2, 0, ChopThing::new(page)).unwrap();
    if uneven {
        render_uneven(&mut audio, frames, 7)
    } else {
        render(&mut audio, frames, block)
    }
}

#[test]
fn it_plays_each_slice_from_its_note_whatever_the_blocks() {
    let page = page();
    const N: usize = 60_000;
    let (el, er) = expected(&page, N);
    assert!(peak(&el) > 0.01, "the slices are heard");
    for block in [BLOCK, 64, 1000, 7] {
        let (l, r) = played(&page, N, block, false);
        assert_same(&format!("left, blocks of {block}"), &el, &l);
        assert_same(&format!("right, blocks of {block}"), &er, &r);
    }
    let (l, r) = played(&page, N, 0, true);
    assert_same("left, uneven blocks", &el, &l);
    assert_same("right, uneven blocks", &er, &r);
}

#[test]
fn preview_plays_once_and_ratchet_goes_round() {
    let page = page();
    let preview = page.render_preview();
    let ratchet = page.render_ratchet();
    let frames = preview.chs[0].len() + 5_000;
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(2, Box::new(Chop::new())).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    ctl.give(2, 0, ChopThing::new(&page)).unwrap();
    ctl.send(2, EventKind::Param { index: chop::TRANSPORT, value: 1.0 }).unwrap();
    let (l, _) = render(&mut audio, frames, BLOCK);
    assert_same("Preview", &preview.chs[0], &l[..preview.chs[0].len()]);
    assert_eq!(peak(&l[preview.chs[0].len()..]), 0.0, "Preview plays once");

    ctl.send(2, EventKind::Param { index: chop::TRANSPORT, value: 2.0 }).unwrap();
    let n = ratchet.chs[0].len();
    let (l, r) = render(&mut audio, 2 * n + 300, BLOCK);
    let round: Vec<f32> = ratchet.chs[0].iter().chain(&ratchet.chs[0]).chain(&ratchet.chs[0][..300]).copied().collect();
    let round_r: Vec<f32> = ratchet.chs[1].iter().chain(&ratchet.chs[1]).chain(&ratchet.chs[1][..300]).copied().collect();
    assert_same("Ratchet, left, round and round", &round, &l);
    assert_same("Ratchet, right", &round_r, &r);

    ctl.send(2, EventKind::Param { index: chop::TRANSPORT, value: 0.0 }).unwrap();
    let (l, _) = render(&mut audio, 1_000, BLOCK);
    assert_eq!(peak(&l), 0.0, "stopped");
}

#[test]
fn it_allocates_nothing_while_it_plays_or_takes_new_slices() {
    assert_the_check_is_on();
    let page = page();
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Script::new(notes()))).unwrap();
    ctl.add(2, Box::new(Chop::new())).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    ctl.give(2, 0, ChopThing::new(&page)).unwrap();
    let a = ChopThing::new(&page);
    let b = ChopThing::new(&page);
    let before = counted();
    let (l, _) = render(&mut audio, 30_000, BLOCK);
    ctl.give(2, 0, a).unwrap();
    ctl.send(2, EventKind::Param { index: chop::TRANSPORT, value: 2.0 }).unwrap();
    let (l2, _) = render(&mut audio, 20_000, BLOCK);
    ctl.give(2, 0, b).unwrap();
    ctl.send(2, EventKind::Param { index: chop::TRANSPORT, value: 1.0 }).unwrap();
    render(&mut audio, 10_000, BLOCK);
    assert_eq!(counted() - before, 0, "allocations or frees inside a render; the last sizes: {:?}", last_sizes());
    assert!(peak(&l) > 0.01 && peak(&l2) > 0.01);
    // A render that arrives while something sounds waits for the next press
    // (the page's sound plays on from what it was rendered from), and the one
    // it then replaces is kept until the next arrives: of the three given
    // here, one has come back, one plays and one is kept.
    assert!(ctl.collect().things >= 1, "the replaced slices came back to be freed");
}

// ------------------------------------------------- the edits, the measures, Write

fn edits_doc() -> Value {
    serde_json::from_str(&std::fs::read_to_string(here().join("chop-edits.json")).unwrap()).unwrap()
}

fn fnv_bytes(b: &[u8]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for &x in b {
        h ^= x as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

/// The page's state as `chop-edits.spec.mjs` runs it: the page and its two slots.
struct Run {
    page: Page,
    slots: [Settings; 2],
    b: bool,
    said: String,
}

impl Run {
    fn new(chs: &[Vec<f32>], rate: f64) -> Run {
        Run { page: Page::new(chs.to_vec(), rate, Settings::default()), slots: [Settings::default(), Settings::default()], b: false, said: String::new() }
    }

    fn cp(&mut self) -> &mut Settings {
        &mut self.slots[self.b as usize]
    }

    fn take_slot(&mut self) {
        self.page.settings = self.slots[self.b as usize].clone();
    }

    fn bars(&mut self, bars: f64, beats: f64) {
        for s in self.slots.iter_mut() {
            s.bars = bars;
            s.beats = beats;
        }
        self.take_slot();
        self.page.recut();
    }

    fn op(&mut self, op: &Value) {
        let a = op.as_array().unwrap();
        let i = |k: usize| a[k].as_f64().unwrap() as i64;
        match a[0].as_str().unwrap() {
            "set" => {
                for kv in a[1].as_array().unwrap() {
                    let k = kv[0].as_str().unwrap();
                    set_one(self.cp(), k, &kv[1]);
                    self.take_slot();
                    if chop::RECUT_KEYS.contains(&k) {
                        self.page.recut();
                    }
                }
            }
            "region" => self.page.set_region(i(1), i(2)),
            "lock" => assert!(self.page.toggle_lock(i(1) as usize)),
            "move" => {
                let to = if a[4].as_bool().unwrap() { self.page.snap_near(i(3)) } else { i(3) };
                self.page.move_edge(i(1) as usize, a[2].as_str().unwrap() == "s", to);
            }
            "delete" => {
                self.page.delete_cut(i(1) as usize);
            }
            "add" => {
                self.page.add_cut(i(1));
            }
            "pick" => self.page.pick(i(1), a[2].as_bool().unwrap()),
            "toggle" => {
                self.page.toggle(Flag::named(a[1].as_str().unwrap()).unwrap());
            }
            "recut" => self.page.recut(),
            "detect" => {
                let t = self.page.find_tempo();
                let (text, bars) = chop::detect_said(t.as_ref());
                self.said = text;
                if let Some((bars, beats)) = bars {
                    self.bars(bars, beats);
                }
            }
            "scale" => {
                let cp = self.cp().clone();
                let (text, bars, beats) = chop::scale_bars(cp.bars, cp.beats, cp.sig, a[1].as_f64().unwrap());
                self.said = text;
                self.bars(bars, beats);
            }
            "ab" => {
                self.b = a[1].as_str().unwrap() == "B";
                self.take_slot();
                self.page.recut();
            }
            "flag" => {
                let f = Flag::named(a[1].as_str().unwrap()).unwrap();
                for k in a[2].as_array().unwrap() {
                    f.set(&mut self.page.slices[k.as_u64().unwrap() as usize], true);
                }
            }
            other => panic!("no such op {other}"),
        }
    }

    fn check(&self, check: &mut Check, what: &str, want: &Value) {
        let flags = |x: &Slice| (x.locked as i64) | (x.moved as i64) << 1 | (x.muted as i64) << 2 | (x.rev as i64) << 3;
        let got: Vec<i64> = self.page.slices.iter().flat_map(|x| [x.s, x.e, flags(x)]).collect();
        let w: Vec<Value> = want["slices"].as_array().unwrap().iter().flat_map(|p| p.as_array().unwrap().clone()).collect();
        check.ints(&format!("{what}.slices"), &Value::Array(w), &got);
        check.ints(&format!("{what}.sel"), &want["sel"], &self.page.sel);
        check.ints(&format!("{what}.current/region"), &Value::Array(vec![want["current"].clone(), want["region"][0].clone(), want["region"][1].clone()]), &[self.page.current, self.page.region.0, self.page.region.1]);
        for (k, s) in [("a", &self.slots[0]), ("b", &self.slots[1])] {
            check.num(&format!("{what}.{k}.bars"), &want[k][0], s.bars);
            check.num(&format!("{what}.{k}.beats"), &want[k][1], s.beats);
        }
        check.num(&format!("{what}.bpm"), &want["bpm"], self.page.bpm());
        check.text(&format!("{what}.said"), &want["said"], &self.said);
        check.text(&format!("{what}.which"), &want["which"], if self.b { "b" } else { "a" });
    }
}

impl Check {
    fn text(&mut self, what: &str, want: &Value, got: &str) {
        self.counted += 1;
        if want.as_str() != Some(got) {
            self.faults.push(format!("{what}: {got:?} against the page's {want}"));
        }
    }
    fn bytes(&mut self, what: &str, want: &Value, got: &[u8]) {
        self.counted += got.len();
        let n = want["n"].as_u64().unwrap() as usize;
        if n == got.len() && want["fnv"].as_str().unwrap() == fnv_bytes(got) {
            return;
        }
        let mut say = format!("{what}: {} bytes against {n}", got.len());
        if let Ok(dir) = std::env::var("CHOP_EDITS_REF") {
            if let Ok(w) = std::fs::read(PathBuf::from(dir).join(want["u8"].as_str().unwrap())) {
                if let Some(i) = w.iter().zip(got).position(|(a, b)| a != b) {
                    say += &format!(", first differs at byte {i}: {} against the page's {}", got[i], w[i]);
                }
            }
        }
        self.faults.push(say);
    }
}

/// The page's hand edits, its measures, its tail badges, Write's WAVs, MIDI
/// and SFZ, Detect and ½× / 2×, step by step, against a recording of the page
/// (`tests/ui/chop-edits.spec.mjs`).
#[test]
fn its_edits_measures_and_writing_are_the_pages() {
    let doc = edits_doc();
    let (chs, rate) = input(&doc);
    let an = {
        let p = Page::new(chs.clone(), rate, Settings::default());
        listen::analyse(&p.mono, rate)
    };
    let mut check = Check::default();
    let cases = doc["cases"].as_array().unwrap();
    for case in cases {
        let id = case["id"].as_str().unwrap();
        let mut run = Run::new(&chs, rate);
        let steps = case["steps"].as_array().unwrap();
        run.check(&mut check, &format!("{id}[start]"), &steps[0]);
        for (k, op) in case["ops"].as_array().unwrap().iter().enumerate() {
            run.op(op);
            run.check(&mut check, &format!("{id}[{k}: {op}]"), &steps[k + 1]);
        }
        let page = &run.page;
        let v = &case["value"];
        match case["what"].as_str().unwrap_or("") {
            "" => {}
            "measures" => {
                let w = v.as_array().unwrap();
                assert_eq!(w.len(), page.slices.len(), "{id}: slices measured");
                for (i, (w, x)) in w.iter().zip(&page.slices).enumerate() {
                    let m = page.measure(&an, x);
                    for (k, g) in [
                        ("low", m.low), ("mid", m.mid), ("high", m.high), ("cent", m.cent), ("flat", m.flat), ("zcr", m.zcr), ("db", m.db),
                        ("peakDb", m.peak_db), ("crest", m.crest), ("dur", m.dur), ("clarity", m.clarity), ("hz", m.hz),
                    ] {
                        check.num(&format!("{id}.m[{i}].{k}"), &w[k], g);
                    }
                    check.text(&format!("{id}.m[{i}].kind"), &w["kind"], m.kind);
                    check.num(&format!("{id}.m[{i}].attackMs"), &w["attackMs"], page.attack_ms(x));
                    let note = if m.hz != 0.0 { chop::note(m.hz) } else { String::new() };
                    check.text(&format!("{id}.m[{i}].note"), &w["note"], &note);
                }
            }
            "tails" => {
                let (badges, cycles) = page.tail_badges();
                let w = v["badges"].as_array().unwrap();
                assert_eq!(w.len(), badges.len(), "{id}: badges");
                for (i, (w, b)) in w.iter().zip(&badges).enumerate() {
                    check.text(&format!("{id}.badge[{i}].cls"), &w["cls"], b.cls);
                    check.text(&format!("{id}.badge[{i}].text"), &w["text"], &b.text);
                    check.text(&format!("{id}.badge[{i}].title"), &w["title"], &b.title);
                }
                check.text(&format!("{id}.cycles"), &v["cycles"], &cycles);
            }
            "wav" => {
                let w = v.as_array().unwrap();
                assert_eq!(w.len(), page.slices.len(), "{id}: WAVs");
                for (i, w) in w.iter().enumerate() {
                    check.bytes(&format!("{id}.wav[{i}]"), w, &page.slice_wav(i));
                }
            }
            "write" => {
                let written: Vec<usize> = (0..page.slices.len()).filter(|&i| !page.slices[i].muted).collect();
                let names: Vec<String> = written.iter().map(|&i| chop::slice_name("reference", i)).collect();
                check.ints(&format!("{id}.written"), &v["written"], &written.iter().map(|&i| i as i64).collect::<Vec<_>>());
                for (i, n) in names.iter().enumerate() {
                    check.text(&format!("{id}.names[{i}]"), &v["names"][i], n);
                }
                check.bytes(&format!("{id}.midi"), &v["midi"], &page.midi(&written));
                check.text(&format!("{id}.sfz"), &v["sfz"], &page.sfz("reference", &names));
            }
            other => panic!("a case the test does not know: {other}"),
        }
    }
    assert!(check.faults.is_empty(), "{} differences from the page:\n{}", check.faults.len(), check.faults.join("\n"));
    assert!(cases.len() >= 35, "{} cases", cases.len());
    println!("chop edits: {} cases, {} values, every one the page's", cases.len(), check.counted);
}

#[test]
fn javascripts_numbers_as_text() {
    use engine_mgl::chop::js;
    assert_eq!(js::fixed(2.5, 0), "3");
    assert_eq!(js::fixed(0.125, 2), "0.13");
    assert_eq!(js::fixed(1.005, 2), "1.00");
    assert_eq!(js::fixed(-0.04, 1), "-0.0");
    assert_eq!(js::fixed(-0.0, 1), "0.0");
    assert_eq!(js::fixed(9.995, 2), "9.99");
    assert_eq!(js::fixed(99.96, 1), "100.0");
    assert_eq!(js::fixed(119.75, 1), "119.8");
    assert_eq!(js::num(80.0), "80");
    assert_eq!(js::num(82.5), "82.5");
    assert_eq!(js::num(-0.0), "0");
    assert_eq!(js::num(0.1 + 0.2), "0.30000000000000004");
    assert_eq!(js::num(1e21), "1e+21");
    assert_eq!(js::num(1.5e-7), "1.5e-7");
    assert_eq!(chop::note(440.0), "A4");
    assert_eq!(chop::note(55.0), "A1");
    assert_eq!(chop::note(277.2), "C#4");
}

/// The module's read-back says what it plays and where it has got to.
#[test]
fn it_says_what_it_plays() {
    let page = page();
    let (mut ctl, mut audio) = engine(RATE, exact());
    let chop_m = Chop::new();
    let said = chop_m.playing();
    ctl.add(2, Box::new(chop_m)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    ctl.give(2, 0, ChopThing::new(&page)).unwrap();
    render(&mut audio, 128, BLOCK);
    assert_eq!(said.read().transport, 0);
    assert!(!said.read().slice_on);
    ctl.send(2, EventKind::Param { index: chop::PLAY, value: 2.0 }).unwrap();
    render(&mut audio, 1000, 100);
    let r = said.read();
    assert!(r.slice_on && r.slice == 2 && r.slice_pos == 1000, "{r:?}");
    // A note plays the same, from its key.
    ctl.send(2, EventKind::Note(NoteEvent::on(37, 1.0))).unwrap();
    render(&mut audio, 300, 100);
    let r = said.read();
    assert!(r.slice_on && r.slice == 1 && r.slice_pos == 300, "{r:?}");
    let len = page.slice_audio(1, 0)[0].len();
    render(&mut audio, len, 128);
    assert!(!said.read().slice_on, "it ended");
    ctl.send(2, EventKind::Param { index: chop::TRANSPORT, value: 2.0 }).unwrap();
    render(&mut audio, 500, 100);
    let r = said.read();
    assert_eq!((r.transport, r.transport_pos), (2, 500));
    ctl.send(2, EventKind::Param { index: chop::TRANSPORT, value: 0.0 }).unwrap();
    render(&mut audio, 100, 100);
    assert_eq!(said.read().transport, 0);
}
