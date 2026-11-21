//! Atmosphere's browser voice, Character and Sympathy against the page: each
//! Atmosphere case of the reference renders, played here and compared
//! sample for sample.
//!
//! The renders are Chromium 151's on the iMac
//! (`WORK DIR/idmlab-move/reference-renders/imac`, see its README: the
//! MacBook's, one folder up, differ in the last bits wherever Accelerate
//! made a wave's tables, and are the same elsewhere). They are read from
//! `MGL_REFERENCE_RENDERS`, by default that folder. Where they are not
//! there (the PC), each case checks the digest it had when it matched.
//!
//! Every case is identical to its render but the cloud: its two waves are
//! random coefficients, and Chromium makes their tables with Accelerate's FFT,
//! whose rounding cannot be followed off a Mac; it is held to a null below
//! -130 dB (it measures -137.5).

use engine_mgl::atmos_web::voice::Options;
use engine_mgl::atmos_web::{AtmosWeb, Patch, Route};
use dsp_core::chromium::graph::Buffer;

const RATE: f32 = 48_000.0;

fn renders_dir() -> std::path::PathBuf {
    std::env::var_os("MGL_REFERENCE_RENDERS")
        .map(Into::into)
        .unwrap_or_else(|| "/Volumes/1 TB Funtime/WORK DIR/idmlab-move/reference-renders/imac".into())
}

/// A reference render: interleaved stereo float, after a 44-byte header.
fn read_wav(name: &str) -> Option<Vec<f32>> {
    let bytes = std::fs::read(renders_dir().join(format!("{name}.wav"))).ok()?;
    Some(bytes[44..].chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect())
}

/// A reference input (mono float WAV).
fn read_input(name: &str) -> Vec<f32> {
    let bytes = std::fs::read(renders_dir().join("inputs").join(format!("{name}.wav")))
        .or_else(|_| std::fs::read(renders_dir().join("..").join("inputs").join(format!("{name}.wav"))))
        .unwrap_or_else(|_| include_bytes!("data/pluck.wav").to_vec());
    bytes[44..].chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect()
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

struct Case {
    id: &'static str,
    seconds: f64,
    set: &'static [(&'static str, f64)],
    seed: u32,
    notes: &'static [(f64, f64, f64)],
    into: Route,
    /// A recorded input fed to Atmosphere from 0 (the "buffer" events).
    input: Option<&'static str>,
}

/// The voice cases' shared settings ("one kind alone on oscillator A").
const ALONE: &[(&str, f64)] = &[
    ("kindB", 0.0), ("atB1", 0.0), ("atB2", 0.0), ("atB3", 0.0), ("atAOct", 0.0), ("atBOct", 0.0), ("atBlend", 0.0),
    ("atUnison", 3.0), ("atDetune", 12.0), ("atWidth", 70.0), ("atDrift", 30.0), ("atSub", 15.0), ("atAir", 10.0),
    ("atGlide", 0.0), ("atAtk", 30.0), ("atDec", 50.0), ("atSus", 70.0), ("atRel", 50.0), ("atVol", 70.0),
];

fn play(case: &Case, extra: &[(&str, f64)]) -> Vec<f32> {
    let mut patch = Patch::default();
    for (k, v) in case.set.iter().chain(extra) {
        assert!(patch.set(k, *v), "{k}");
    }
    let mut a = AtmosWeb::new(RATE, patch, case.seed);
    let frames = (case.seconds * RATE as f64).round() as usize;
    if let Some(name) = case.input {
        // The signal, then silence to the end of the render, in one buffer.
        a.retune_sympathy();
        let mut x = read_input(name);
        x.resize(x.len().max((case.seconds * RATE as f64).ceil() as usize + 256), 0.0);
        let b = a.g.add_buffer(Buffer { channels: vec![x], sample_rate: RATE });
        let src = a.g.buffer_source(b).unwrap();
        a.g.connect(src, a.at_in);
        a.g.start(src, 0.0);
    }
    for &(t, hz, dur) in case.notes {
        a.play(hz, t, dur, Options::default(), case.into).expect("room for the note");
    }
    let mut out = Vec::with_capacity(frames * 2 + 256);
    let (mut l, mut r) = ([0.0f32; 128], [0.0f32; 128]);
    while out.len() < frames * 2 {
        a.render(&mut l, &mut r);
        for k in 0..128 {
            out.push(l[k]);
            out.push(r[k]);
        }
    }
    out.truncate(frames * 2);
    // The page's other channels meet Atmosphere's at its master and its
    // destination: silence there, but not marked silent, so a -0 comes out
    // as +0 (x + 0 is x for every other x).
    for v in out.iter_mut() {
        *v += 0.0;
    }
    out
}

/// Each case's digest when it matched its render on the iMac.
const DIGESTS: &[(&str, u64)] = &[
    ("atmos-voice-classic", 0xb7a11201252add3e),
    ("atmos-voice-supersaw", 0x97fc3b6fd805c4bd),
    ("atmos-voice-spectrum", 0xf7a1ac896293322b),
    ("atmos-voice-choir", 0x0b69e2a5946ff985),
    ("atmos-voice-glass", 0x0768720d155d095f),
    ("atmos-voice-breath", 0x6ea539627b70c4cb),
    ("atmos-voice-cloud", 0x9c93c9d375bcb47b),
    ("atmos-voice-endless", 0x53003c14fa150eb5),
    ("atmos-voice-filter-glide", 0xe9e5750025a3aaf0),
    ("atmos-voice-blend", 0xaf1b3153b2da5a64),
    ("atmos-voice-page", 0x234b14e1a9ff991b),
    ("character-warmth", 0x1cf0da2ff12d81df),
    ("character-wow", 0x19a56ab3ca170a68),
    ("character-ensemble", 0x868a9d5482f1ca49),
    ("character-all", 0x5fdfdc9bbe808f39),
    ("sympathy-degrees", 0xa2419f28af6373e4),
    ("sympathy-fifths-glass", 0xd8df7a3ec2dd4ec6),
    ("sympathy-root-felt", 0x8bd04892e9caecb7),
];

/// Ours against the render: identical (or, for the cloud, near enough), or
/// how far apart. Without the render, against the digest it had.
fn compare(id: &str, ours: &[f32]) -> Result<(), String> {
    if let Some(dir) = std::env::var_os("MGL_DUMP_DIR") {
        let bytes: Vec<u8> = ours.iter().flat_map(|v| v.to_le_bytes()).collect();
        std::fs::write(std::path::Path::new(&dir).join(format!("{id}.f32")), bytes).unwrap();
    }
    let Some(theirs) = read_wav(id) else {
        let want = DIGESTS.iter().find(|d| d.0 == id).map(|d| d.1);
        return match want {
            Some(w) if w == digest(ours) => Ok(()),
            Some(w) => Err(format!("{id}: no render here, and the digest is {:016x}, not {w:016x}", digest(ours))),
            None => Err(format!("{id}: no render here and no digest")),
        };
    };
    assert_eq!(ours.len(), theirs.len(), "{id}: length");
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
    if id == "atmos-voice-cloud" && first.is_some() && null < -130.0 {
        println!("{id}: {diff} samples differ by at most {worst:e}; null {null:.1} dB (Accelerate's FFT)");
        return Ok(());
    }
    match first {
        None => Ok(()),
        Some(i) => Err(format!(
            "{id}: {diff} of {} samples differ, the first at frame {} ({}), ours {} theirs {}; worst {worst:e}; null {:.1} dB",
            ours.len(),
            i / 2,
            if i % 2 == 0 { "left" } else { "right" },
            ours[i],
            theirs[i],
            10.0 * (err / sig.max(1e-30)).log10()
        )),
    }
}

const KINDS: &[(&str, f64, [f64; 3], u32)] = &[
    ("classic", 0.0, [66.0, 0.0, 0.0], 1000),
    ("supersaw", 1.0, [50.0, 0.0, 0.0], 1001),
    ("spectrum", 2.0, [80.0, 45.0, 35.0], 1002),
    ("choir", 3.0, [20.0, 60.0, 35.0], 1003),
    ("glass", 4.0, [80.0, 50.0, 70.0], 1004),
    ("breath", 5.0, [50.0, 30.0, 0.0], 1005),
    ("cloud", 6.0, [50.0, 20.0, 50.0], 1006),
    ("endless", 7.0, [75.0, 50.0, 0.0], 1007),
];

fn kind_case(name: &str) -> (Vec<f32>, String) {
    let (_, kind, p, seed) = *KINDS.iter().find(|k| k.0 == name).unwrap();
    let id = format!("atmos-voice-{name}");
    let leaked: &'static str = Box::leak(id.clone().into_boxed_str());
    let case = Case { id: leaked, seconds: 2.4, set: ALONE, seed, notes: &[(0.0, 220.0, 1.5)], into: Route::Direct, input: None };
    let extra = [("kindA", kind), ("atA1", p[0]), ("atA2", p[1]), ("atA3", p[2])];
    (play(&case, &extra), id)
}

#[test]
fn every_kind_alone_is_the_pages() {
    let mut failures = Vec::new();
    for (name, ..) in KINDS {
        let (ours, id) = kind_case(name);
        match compare(&id, &ours) {
            Ok(()) => println!("{id}: as the page, digest {:016x}", digest(&ours)),
            Err(e) => {
                println!("{e}");
                failures.push(e);
            }
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

#[test]
fn the_filter_and_glide_are_the_pages() {
    const SET: &[(&str, f64)] = &[("kindA", 0.0), ("atA1", 66.0), ("atGlide", 50.0), ("atFltType", 0.0), ("atFltCut", 55.0), ("atFltRes", 40.0), ("atFltAmt", 60.0), ("atFltKey", 50.0)];
    let case = Case { id: "atmos-voice-filter-glide", seconds: 2.6, set: ALONE, seed: 1100, notes: &[(0.0, 220.0, 0.8), (1.0, 330.0, 0.8)], into: Route::Direct, input: None };
    let ours = play(&case, SET);
    if let Err(e) = compare(case.id, &ours) {
        panic!("{e}");
    }
}

#[test]
fn the_blend_is_the_pages() {
    let case = Case { id: "atmos-voice-blend", seconds: 4.0, set: &[("atBOct", 1.0), ("atGlide", 0.0)], seed: 1101, notes: &[(0.0, 220.0, 2.0)], into: Route::Direct, input: None };
    let ours = play(&case, &[]);
    if let Err(e) = compare(case.id, &ours) {
        panic!("{e}");
    }
}

#[test]
fn the_note_through_the_page_is_the_pages() {
    let case = Case { id: "atmos-voice-page", seconds: 4.0, set: &[("atBOct", 1.0), ("atGlide", 0.0)], seed: 1101, notes: &[(0.0, 220.0, 2.0)], into: Route::Page, input: None };
    let ours = play(&case, &[]);
    if let Err(e) = compare(case.id, &ours) {
        panic!("{e}");
    }
}

const CHARACTER: &[(&str, &[(&str, f64)])] = &[
    ("character-warmth", &[("atWarm", 80.0), ("atWow", 0.0), ("atEns", 0.0), ("atSym", 0.0)]),
    ("character-wow", &[("atWarm", 0.0), ("atWow", 90.0), ("atEns", 0.0), ("atSym", 0.0)]),
    ("character-ensemble", &[("atWarm", 0.0), ("atWow", 0.0), ("atEns", 80.0), ("atSym", 0.0), ("atEnsRate", 70.0)]),
    ("character-all", &[("atSym", 0.0)]),
    ("sympathy-degrees", &[("atWarm", 0.0), ("atWow", 0.0), ("atEns", 0.0), ("atSym", 60.0), ("atSymRing", 55.0), ("atSymMat", 50.0), ("symTune", 0.0)]),
    ("sympathy-fifths-glass", &[("atWarm", 0.0), ("atWow", 0.0), ("atEns", 0.0), ("atSym", 80.0), ("atSymRing", 30.0), ("atSymMat", 90.0), ("symTune", 1.0)]),
    ("sympathy-root-felt", &[("atWarm", 0.0), ("atWow", 0.0), ("atEns", 0.0), ("atSym", 80.0), ("atSymRing", 80.0), ("atSymMat", 10.0), ("symTune", 2.0)]),
];

#[test]
fn character_and_sympathy_are_the_pages() {
    let mut failures = Vec::new();
    for (id, set) in CHARACTER {
        let seconds = if id.starts_with("sympathy") { 3.0 } else { 1.5 };
        let case = Case { id, seconds, set, seed: 0, notes: &[], into: Route::Page, input: Some("pluck") };
        let ours = play(&case, &[]);
        match compare(id, &ours) {
            Ok(()) => println!("{id}: as the page, digest {:016x}", digest(&ours)),
            Err(e) => {
                println!("{e}");
                failures.push(e);
            }
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

// ── The module ───────────────────────────────────────────────────────────────

mod common;
use common::*;
use engine_core::*;
use engine_mgl::atmos_web::module::{knob, KEYS};
use engine_mgl::AtmosWebModule;

/// A patch that takes every part of the voice: a cloud on A, a choir on B,
/// the filter moving, Character and Sympathy on.
const MODULE_PATCH: &[(&str, f32)] = &[
    ("kindA", 6.0), ("atA3", 50.0), ("kindB", 3.0), ("atBlend", 50.0), ("atFltType", 0.0), ("atFltCut", 60.0),
    ("atFltAmt", 40.0), ("atRel", 40.0), ("atSym", 60.0), ("atWarm", 40.0), ("atEns", 60.0), ("atWow", 30.0),
];

/// Notes on their own samples, some held over others, some let go early.
fn module_notes() -> Vec<(u64, NoteEvent)> {
    let mut n = Vec::new();
    for (i, key) in [57u8, 64, 60, 69, 52].iter().enumerate() {
        let at = 97 + 4_211 * i as u64;
        n.push((at, NoteEvent::on(*key, 0.4 + 0.1 * i as f32)));
        n.push((at + 9_001, NoteEvent::off(*key)));
    }
    n.sort_by_key(|(at, _)| *at);
    n
}

fn module_render(frames: usize, block: usize) -> (Vec<f32>, Vec<f32>) {
    let mut m = AtmosWebModule::new(RATE);
    for (k, v) in MODULE_PATCH {
        m = m.set(k, *v);
    }
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Script::new(module_notes()))).unwrap();
    ctl.add(2, Box::new(m)).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    render(&mut audio, frames, block)
}

/// The instrument on its own: each note at its own sample's time, as the
/// page's keys play it, a quantum earlier than the module gives it.
fn instrument_render(frames: usize) -> (Vec<f32>, Vec<f32>) {
    let mut patch = Patch::default();
    for (k, v) in MODULE_PATCH {
        assert!(patch.set(k, *v as f64), "{k}");
    }
    let mut a = AtmosWeb::with_input(RATE, patch, 0x41_74_6d_6f);
    let script = module_notes();
    let mut held = [None; 128];
    let (mut l, mut r) = (vec![0.0f32; 128], vec![0.0f32; 128]);
    let (mut ol, mut or) = (vec![0.0f32; 128], vec![0.0f32; 128]);
    let mut next = 0;
    let mut frame = 0u64;
    while (ol.len()) < frames + 256 {
        while next < script.len() && script[next].0 < frame + 128 {
            let (at, note) = script[next];
            let t = at as f64 / RATE as f64;
            let hz = 440.0 * 2f64.powf((note.note as f64 - 69.0) / 12.0);
            match note.kind {
                NoteKind::On => held[note.note as usize] = a.play(hz, t, 3600.0, Options { gain: Some(note.velocity as f64), ..Options::default() }, Route::Page),
                _ => {
                    if let Some(s) = held[note.note as usize].take() {
                        a.release(s, t);
                    }
                }
            }
            next += 1;
        }
        a.render_output(None, &mut l, &mut r);
        ol.extend_from_slice(&l);
        or.extend_from_slice(&r);
        frame += 128;
    }
    // The module is a quantum late: its first quantum is silence.
    ol.truncate(frames);
    or.truncate(frames);
    (ol, or)
}

#[test]
fn every_knob_is_a_control_the_instrument_takes() {
    let mut p = Patch::default();
    for key in KEYS {
        assert!(p.set(key, 1.0), "{key} is not one of the instrument's controls");
    }
    assert_eq!(knob("atBlend"), Some(10));
    assert_eq!(knob("nothing"), None);
}

#[test]
fn the_module_plays_what_the_instrument_plays_whatever_the_blocks() {
    const N: usize = 40_000;
    let (il, ir) = instrument_render(N);
    assert!(peak(&il) > 0.01, "the instrument is heard");
    for block in [128, 256, 7, 1000] {
        let (l, r) = module_render(N, block);
        assert_same(&format!("left, blocks of {block}"), &il, &l);
        assert_same(&format!("right, blocks of {block}"), &ir, &r);
    }
}

#[test]
fn the_module_allocates_nothing_while_it_plays() {
    assert_the_check_is_on();
    let mut m = AtmosWebModule::new(RATE);
    for (k, v) in MODULE_PATCH {
        m = m.set(k, *v);
    }
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Script::new(module_notes()))).unwrap();
    ctl.add(2, Box::new(m)).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    let before = counted();
    let (l, _) = render(&mut audio, 60_000, 128);
    assert!(peak(&l) > 0.01);
    assert_eq!(counted() - before, 0, "allocations or frees inside a render; the last sizes: {:?}", last_sizes());
}
