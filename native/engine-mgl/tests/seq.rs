//! Seq's Classic synth and its delay against the page: each Classic case of
//! the reference renders (`tests/ui/reference-renders/manifest.json`), played
//! here from the manifest's own settings and events, and compared sample for
//! sample with the render Chromium made of the page.
//!
//! The renders are the iMac's (`WORK DIR/idmlab-move/reference-renders/
//! imac-classic`, made with its `tools/all.sh`): the MacBook's, one folder
//! up, differ in the last bits wherever Accelerate made a wave's tables, as
//! Atmosphere's did. They are read from `MGL_REFERENCE_RENDERS`, by default
//! that folder.
//!
//! The pulse wave is a custom periodic wave, whose tables Chromium makes with
//! Accelerate's FFT: its rounding cannot be followed exactly, so that case is
//! held to a null below -120 dB instead.

use engine_mgl::seq::{Adsr, Classic, Delay, Lfo, Settings, Shape, SpaceSettings, Target};
use serde_json::Value;

const RATE: f32 = 48_000.0;

fn renders_dir() -> std::path::PathBuf {
    std::env::var_os("MGL_REFERENCE_RENDERS")
        .map(Into::into)
        .unwrap_or_else(|| "/Volumes/1 TB Funtime/WORK DIR/idmlab-move/reference-renders/imac-classic".into())
}

fn manifest() -> Value {
    let p = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/ui/reference-renders/manifest.json");
    serde_json::from_str(&std::fs::read_to_string(p).expect("the manifest")).expect("json")
}

fn read_wav(name: &str) -> Option<Vec<f32>> {
    let bytes = std::fs::read(renders_dir().join(format!("{name}.wav"))).ok()?;
    Some(bytes[44..].chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect())
}

/// FNV-1a over the samples' bits.
fn digest(x: &[f32]) -> u64 {
    let mut h: u64 = 1469598103934665603;
    for v in x {
        for b in v.to_bits().to_le_bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(1099511628211);
        }
    }
    h
}

/// `set` laid over `base`, as the spec's `over` does.
fn over(base: &Value, set: Option<&Value>) -> Value {
    match (base, set) {
        (_, None) => base.clone(),
        (Value::Object(b), Some(Value::Object(s))) => {
            let mut out = b.clone();
            for (k, v) in s {
                out.insert(k.clone(), over(b.get(k).unwrap_or(&Value::Null), Some(v)));
            }
            Value::Object(out)
        }
        (_, Some(s)) => s.clone(),
    }
}

fn f(v: &Value, k: &str) -> f64 {
    v[k].as_f64().unwrap_or_else(|| panic!("{k}"))
}

fn adsr(v: &Value) -> Adsr {
    Adsr { a: f(v, "a"), d: f(v, "d"), s: f(v, "s"), r: f(v, "r") }
}

/// The case's state as Classic's settings, as `R.apply` puts it in the page.
fn settings(state: &Value) -> Settings {
    let q = &state["seq"];
    let c = &state["classic"];
    let mel = &state["band"]["ch"]["Mel"];
    let at = &state["atmos"];
    let lfos: Vec<Lfo> = c["lfos"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| Lfo {
            rate: f(l, "rate"),
            depth: f(l, "depth"),
            wave: Shape::from_name(l["wave"].as_str().unwrap()).unwrap(),
            target: Target::from_name(l["target"].as_str().unwrap()),
        })
        .collect();
    let d = &c["delay"];
    Settings {
        bpm: f(q, "bpm"),
        step_beats: f(q, "stepBeats"),
        wave: Shape::from_name(c["wave"].as_str().unwrap()).unwrap(),
        pulse_width: f(c, "pulseWidth"),
        adsr: adsr(&c["adsr"]),
        volume: f(c, "volume"),
        cutoff: f(&c["filter"], "cutoff"),
        q: f(&c["filter"], "q"),
        filter_env: adsr(&c["filter"]["env"]),
        amount: f(&c["filter"], "amount"),
        key_follow: f(&c["filter"], "keyFollow"),
        lfos: [lfos[0], lfos[1], lfos[2]],
        delay: Delay { subdiv: f(d, "subdiv"), feedback: f(d, "feedback"), wet: f(d, "wet"), spread: f(d, "spread"), hi_cut: f(d, "hiCut") },
        tape_ips: f(c, "tapeIps"),
        mel_level: mel["lv"].as_f64().unwrap_or(80.0),
        mel_pan: mel["pan"].as_f64().unwrap_or(0.0),
        mel_dly: mel["dly"].as_f64().unwrap_or(100.0),
        mel_spc: mel["spc"].as_f64().unwrap_or(100.0),
        space: SpaceSettings {
            wet: f(at, "atRevWet"),
            size: f(at, "atRevSize"),
            pre: f(at, "atRevPre"),
            damp: f(at, "atRevDamp"),
            shim: f(at, "atRevShim"),
            spread: f(at, "atRevSpread"),
            low_cut: f(at, "atLowCut"),
        },
    }
}

/// One case played: its events laid as the spec lays them, rendered.
fn play(m: &Value, case: &Value) -> Vec<f32> {
    let state = over(&m["defaults"], case.get("set"));
    let s = settings(&state);
    let seconds = f(case, "seconds");
    let frames = (seconds * RATE as f64).round() as usize;
    let mut c = Classic::new(RATE, s);
    // Events at a later time wait for the render to reach it (`off.suspend`).
    let mut later: Vec<(f64, Value)> = Vec::new();
    for e in case["events"].as_array().unwrap() {
        match e["type"].as_str().unwrap() {
            "note" => {
                if let Some(pw) = e["pulseWidth"].as_f64() {
                    c.current_pw = pw;
                }
                assert!(c.play_note(f(e, "hz"), f(e, "t"), e["hold"].as_f64().unwrap_or(1.0)));
            }
            "key" => later.push((f(e, "t"), e.clone())),
            "freeze" => later.push((f(e, "t"), e.clone())),
            "tapeGlide" => {
                c.bpm_target = f(e, "bpm");
                c.tape_glide(f(e, "t"));
            }
            other => panic!("not a Classic event: {other}"),
        }
    }
    let mut out = Vec::with_capacity(frames * 2 + 256);
    let (mut l, mut r) = ([0.0f32; 128], [0.0f32; 128]);
    while out.len() < frames * 2 {
        let now = c.g.current_time();
        for (_, e) in later.iter().filter(|(t, _)| *t == now) {
            if e["type"] == "freeze" {
                c.freeze(true);
                continue;
            }
            let held = c.key_on(f(e, "hz"), f(e, "vel")).expect("room for the key");
            c.release(held, f(e, "release"));
        }
        c.render(&mut l, &mut r);
        for k in 0..128 {
            out.push(l[k]);
            out.push(r[k]);
        }
    }
    out.truncate(frames * 2);
    // Unlike Atmosphere's cases, nothing unmarked-silent meets Classic's at
    // the destination: a -0 the render makes stays -0.
    out
}

/// Ours against the render: identical (the pulse: near enough), or how far
/// apart.
fn compare(id: &str, ours: &[f32]) -> Result<String, String> {
    if let Some(dir) = std::env::var_os("MGL_DUMP_DIR") {
        let bytes: Vec<u8> = ours.iter().flat_map(|v| v.to_le_bytes()).collect();
        std::fs::write(std::path::Path::new(&dir).join(format!("{id}.f32")), bytes).unwrap();
    }
    let Some(theirs) = read_wav(id) else {
        return Err(format!("{id}: no render here (digest {:016x})", digest(ours)));
    };
    if ours.len() != theirs.len() {
        return Err(format!("{id}: {} samples, the render has {}", ours.len(), theirs.len()));
    }
    let mut first = None;
    let (mut diff, mut worst, mut err, mut sig) = (0usize, 0.0f64, 0.0f64, 0.0f64);
    for (i, (a, b)) in ours.iter().zip(&theirs).enumerate() {
        sig += (*b as f64).powi(2);
        if a.to_bits() != b.to_bits() {
            diff += 1;
            first.get_or_insert(i);
            let d = (*a as f64 - *b as f64).abs();
            worst = worst.max(d);
            err += d * d;
        }
    }
    let null = 10.0 * (err / sig.max(1e-30)).log10();
    match first {
        None => Ok(format!("{id}: identical ({:016x})", digest(ours))),
        Some(_) if id == "classic-wave-pulse" && null < -120.0 => {
            Ok(format!("{id}: {diff} samples differ by at most {worst:e}; null {null:.1} dB (Accelerate's FFT)"))
        }
        Some(i) => Err(format!(
            "{id}: {diff} of {} samples differ, the first at frame {} ({}), ours {} theirs {}; worst {worst:e}; null {null:.1} dB",
            ours.len(),
            i / 2,
            if i % 2 == 0 { "left" } else { "right" },
            ours[i],
            theirs[i],
        )),
    }
}

fn run(only: impl Fn(&str) -> bool) {
    let m = manifest();
    let mut failed = Vec::new();
    for case in m["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        if !(case["instrument"] == "classic" || case["instrument"] == "space") || !only(id) {
            continue;
        }
        match compare(id, &play(&m, case)) {
            Ok(s) => println!("{s}"),
            Err(e) => {
                println!("{e}");
                failed.push(e);
            }
        }
    }
    assert!(failed.is_empty(), "{} case(s) differ:\n{}", failed.len(), failed.join("\n"));
}

#[test]
fn classic_plays_the_pages_renders() {
    run(|id| !id.starts_with("classic-delay-tape-glide"));
}

#[test]
fn the_tape_glide_plays_the_pages_renders() {
    run(|id| id.starts_with("classic-delay-tape-glide"));
}

/// Where the filter's silence falls (a probe, kept for the next port).
#[test]
#[ignore]
fn probe_filter_tail() {
    let m = manifest();
    let case = m["cases"].as_array().unwrap().iter().find(|c| c["id"] == "classic-wave-sawtooth").unwrap().clone();
    let state = over(&m["defaults"], case.get("set"));
    let mut c = Classic::new(RATE, settings(&state));
    for e in case["events"].as_array().unwrap() {
        c.play_note(f(e, "hz"), f(e, "t"), e["hold"].as_f64().unwrap_or(1.0));
    }
    let (mut l, mut r) = ([0.0f32; 128], [0.0f32; 128]);
    for q in 0..290 {
        c.render(&mut l, &mut r);
        if (255..290).contains(&q) {
            let b = c.g.bus(dsp_core::chromium::graph::NodeId(3));
            let neg = b.data[0].iter().filter(|v| **v == 0.0 && v.is_sign_negative()).count();
            let nz = b.data[0].iter().filter(|v| **v != 0.0).count();
            println!("q{q}: filter silent={} nonzero={nz} neg0={neg} out0={:e} sounding={}", c.g.silent(dsp_core::chromium::graph::NodeId(3)), l[0], c.sounding());
        }
    }
}

/// Cases of one's own against Chromium's renders of them (raw interleaved
/// floats beside the cases file): `SEQ_PROBE=<cases.json>`. Values only;
/// the sign of zeros is reported apart.
#[test]
#[ignore]
fn probe_cases() {
    let Some(path) = std::env::var_os("SEQ_PROBE") else { return };
    let path = std::path::PathBuf::from(path);
    let m = manifest();
    let cases: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    for case in cases.as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let ours = play(&m, case);
        let bytes = std::fs::read(path.with_file_name(format!("{id}.raw"))).unwrap();
        let theirs: Vec<f32> = bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
        let (mut vals, mut signs, mut first) = (0, 0, None);
        for (i, (a, b)) in ours.iter().zip(&theirs).enumerate() {
            if a != b {
                vals += 1;
                first.get_or_insert(i);
            } else if a.to_bits() != b.to_bits() {
                signs += 1;
            }
        }
        println!("{id}: {vals} values differ (first at frame {:?}), {signs} signs of zero", first.map(|i| i / 2));
        if let Some(i) = first {
            for j in i..(i + 12).min(ours.len()) {
                println!("  frame {} {}: ours {:e} theirs {:e}", j / 2, if j % 2 == 0 { "L" } else { "R" }, ours[j], theirs[j]);
            }
        }
    }
}
