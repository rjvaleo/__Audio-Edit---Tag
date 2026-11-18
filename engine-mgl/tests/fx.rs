//! Every effect in prism-fx's catalogue as a module of the native engine.
//!
//! prism-fx keeps a hash of exactly what each effect plays under a fixed set
//! of scenarios (`tests/golden/par.tsv`: defaults, each control at both ends,
//! each control moved while running, blocks of 512 and 61). The same
//! scenarios are played here through the engine: the input comes from the
//! sound bank down a cable, the moves arrive as stamped messages, and the
//! engine's output is hashed. Its mono scenarios are left out: a module's
//! audio is stereo.

mod common;
use common::*;
use engine_core::basics::{Player, SoundSource};
use engine_core::*;
use engine_mgl::Fx;
use prism_fx::{contract, par, CATALOG};
use std::collections::HashMap;
use std::sync::OnceLock;

const GOLDEN: &str =
    concat!(env!("CARGO_MANIFEST_DIR"), "/../../GitHub/prism-fx/crates/prism-fx/tests/golden/par.tsv");

const SOURCE: ModuleId = 1;
const PLAYER: ModuleId = 2;
const FX: ModuleId = 3;

/// prism-fx's scenario input in the sound bank, played into the effect, and
/// the effect to the output.
fn patch(id: &str, setup: &[(usize, f32)]) -> (Controller, AudioEngine) {
    let (l, r) = par::input();
    let (mut ctl, audio) = engine(contract::SAMPLE_RATE, exact());
    let sound = ctl
        .load_sound(1, SoundData { rate: contract::SAMPLE_RATE, l: l.into_boxed_slice(), r: r.into_boxed_slice() })
        .unwrap();
    ctl.add(SOURCE, Box::new(SoundSource::new())).unwrap();
    ctl.send(SOURCE, EventKind::Sound { slot: 0, sound }).unwrap();
    ctl.add(PLAYER, Box::new(Player::new(1.0))).unwrap();
    let mut fx = Fx::new(id, contract::SAMPLE_RATE).expect("an effect in the catalogue");
    if fx.descriptor().sound.is_some() {
        let (samples, channels, rate) = contract::test_sound();
        fx = fx.sound(&samples, channels, rate);
    }
    for &(param, value) in setup {
        fx = fx.set(param, value);
    }
    ctl.add(FX, Box::new(fx)).unwrap();
    ctl.connect(port(SOURCE, 0), port(PLAYER, 0)).unwrap();
    ctl.connect(port(PLAYER, 0), port(FX, 0)).unwrap();
    ctl.connect_out(port(FX, 0)).unwrap();
    ctl.commit().unwrap();
    (ctl, audio)
}

fn knob(ctl: &mut Controller, frame: usize, param: usize, value: f32) {
    ctl.send_at(frame as u64, FX, EventKind::Param { index: param as u32, value }).unwrap();
}

/// One scenario through the engine. prism-fx makes each move at the start of
/// the block it falls in, so that is the sample the message is stamped with.
fn through_engine(id: &str, block: usize, setup: &[(usize, f32)], moves: &[(usize, usize, f32)]) -> u64 {
    let (mut ctl, mut audio) = patch(id, setup);
    for &(frame, param, value) in moves {
        knob(&mut ctl, frame / block * block, param, value);
    }
    let (l, r) = render(&mut audio, par::FRAMES, block);
    par::hash(&l, &r)
}

/// The far end of a control's range from its default, as prism-fx picks it.
fn far_end(p: &prism_fx::ParamSpec) -> f32 {
    if (p.default - p.min).abs() > (p.default - p.max).abs() {
        p.min
    } else {
        p.max
    }
}

/// prism-fx's stereo scenarios for one effect, by its names, through the engine.
fn scenarios(id: &str) -> Vec<(String, u64)> {
    let d = prism_fx::find(id).unwrap().descriptor;
    let mut out = vec![
        ("default/512".to_string(), through_engine(id, 512, &[], &[])),
        ("default/61".to_string(), through_engine(id, 61, &[], &[])),
    ];
    for (i, p) in d.params.iter().enumerate() {
        if p.inert {
            continue;
        }
        out.push((format!("{}=min", p.key), through_engine(id, 512, &[(i, p.min)], &[])));
        out.push((format!("{}=max", p.key), through_engine(id, 512, &[(i, p.max)], &[])));
        let moves = [(par::FRAMES / 3, i, far_end(p)), (2 * par::FRAMES / 3, i, p.default)];
        out.push((format!("{}~moved", p.key), through_engine(id, 61, &[], &moves)));
    }
    out
}

/// Every scenario of every effect through the engine: (effect, scenario, hash).
fn all() -> &'static Vec<(&'static str, String, u64)> {
    static ALL: OnceLock<Vec<(&'static str, String, u64)>> = OnceLock::new();
    ALL.get_or_init(|| {
        let mut out = Vec::new();
        for e in CATALOG {
            for (name, hash) in scenarios(e.descriptor.id) {
                out.push((e.descriptor.id, name, hash));
            }
        }
        out
    })
}

/// The hashes were recorded on Apple silicon. Another processor's arithmetic
/// library rounds a sine or a power differently in the last bit, so there
/// the two tests after this one stand in for it.
#[test]
#[cfg_attr(not(all(target_os = "macos", target_arch = "aarch64")), ignore = "the hashes are Apple silicon's")]
fn every_effect_renders_as_prism_fx_recorded() {
    let golden = std::fs::read_to_string(GOLDEN).expect("prism-fx's golden set");
    let recorded: HashMap<(&str, &str), u64> = golden
        .lines()
        .map(|line| {
            let mut f = line.split('\t');
            let key = (f.next().unwrap(), f.next().unwrap());
            (key, u64::from_str_radix(f.next().unwrap(), 16).unwrap())
        })
        .collect();
    let stereo = recorded.keys().filter(|(_, scenario)| *scenario != "default/mono").count();
    let mut bad = Vec::new();
    for (id, scenario, hash) in all() {
        match recorded.get(&(*id, scenario.as_str())) {
            Some(want) if want == hash => {}
            Some(want) => bad.push(format!("{id} {scenario}: {hash:016x} (recorded {want:016x})")),
            None => bad.push(format!("{id} {scenario}: not in the golden set")),
        }
    }
    assert_eq!(all().len(), stereo, "every recorded stereo scenario is played");
    assert!(stereo > 2500, "the golden set is the whole catalogue: {stereo} scenarios");
    assert!(bad.is_empty(), "{} of {} renders differ:\n{}", bad.len(), stereo, bad.join("\n"));
}

/// The same check without the recorded file: on a processor whose arithmetic
/// library differs from the one the hashes were recorded on, this still says
/// the engine adds and loses nothing.
#[test]
fn through_the_engine_every_effect_renders_what_it_renders_alone() {
    let mut bad = Vec::new();
    let mut checked = 0;
    for e in CATALOG {
        let make = || (e.make)(contract::SAMPLE_RATE);
        let alone: HashMap<String, u64> = par::scenarios(&make).into_iter().collect();
        for (id, scenario, hash) in all().iter().filter(|(id, _, _)| *id == e.descriptor.id) {
            checked += 1;
            if alone.get(scenario) != Some(hash) {
                bad.push(format!("{id} {scenario}"));
            }
        }
    }
    assert_eq!(checked, all().len());
    assert!(bad.is_empty(), "{} of {} renders differ:\n{}", bad.len(), checked, bad.join("\n"));
}

// ---- How far another processor is from Apple silicon.

const REFERENCE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/reference/defaults-apple.f32");

/// Every 61st sample is kept, as prism-fx's own stored renders do.
const KEEP: usize = 61;

/// An effect at its defaults through the engine: the kept samples of the
/// left, then of the right.
fn kept(id: &str) -> Vec<f32> {
    let (_ctl, mut audio) = patch(id, &[]);
    let (l, r) = render(&mut audio, par::FRAMES, 512);
    l.iter().step_by(KEEP).chain(r.iter().step_by(KEEP)).copied().collect()
}

/// Run once on Apple silicon, then commit the file:
/// `cargo test -p engine-mgl --test fx -- --ignored record_apples_renders`.
#[test]
#[ignore = "writes the reference file"]
fn record_apples_renders() {
    assert!(cfg!(all(target_os = "macos", target_arch = "aarch64")), "the reference is Apple silicon's");
    let mut bytes = Vec::new();
    for e in CATALOG {
        for v in kept(e.descriptor.id) {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
    }
    std::fs::create_dir_all(std::path::Path::new(REFERENCE).parent().unwrap()).unwrap();
    std::fs::write(REFERENCE, bytes).unwrap();
}

/// Effects that are further than `FLOOR_DB` from Apple's render on the PC
/// (Windows, x86-64; measured 18 Nov 2026), each with the most it may be:
/// what was measured and about 6 dB over. It is prism-fx's arithmetic that
/// differs between the processors, not the engine: the test above passes
/// there. They are listed so the gap is seen and can't grow unnoticed.
const FURTHER: [(&str, f64); 8] = [
    ("hp-high-pass", -60.0),         // measured -65.9
    ("hp-more-stereo", -70.0),       // -75.7
    ("hp-quasi-stereo", -81.0),      // -87.2
    ("dattorro-filter-bank", -94.0), // -99.8
    ("sh-phasor", -95.0),            // -101.3
    ("regalia", -97.0),              // -103.5
    ("dattorro-notch", -99.0),       // -105.4
    ("dattorro-resonator", -103.0),  // -108.9
];

/// PLAN.md's figure for a processor that isn't Apple's.
const FLOOR_DB: f64 = -120.0;

/// On Apple silicon the renders are the stored ones to the last bit. On any
/// other processor they may differ by a whisper: the difference, against the
/// loudest sample of the stored render, stays under `FLOOR_DB`, except for
/// the effects in `FURTHER`. Run with `--nocapture` to see the figures.
#[test]
fn every_effect_is_close_to_apples_render_on_any_processor() {
    let bytes = std::fs::read(REFERENCE).expect("the reference file: see record_apples_renders");
    let stored: Vec<f32> = bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    let each = 2 * par::FRAMES.div_ceil(KEEP);
    assert_eq!(stored.len(), each * CATALOG.len(), "the catalogue has changed: record the reference again");
    for (id, _) in FURTHER {
        assert!(prism_fx::find(id).is_some(), "{id} is listed as further but is not in the catalogue");
    }
    let mut rows = Vec::new();
    for (e, want) in CATALOG.iter().zip(stored.chunks_exact(each)) {
        let got = kept(e.descriptor.id);
        let exact = first_difference(&got, want).is_none();
        let loudest = peak(want) as f64;
        let apart = got.iter().zip(want).fold(0.0f64, |m, (a, b)| m.max((*a as f64 - *b as f64).abs()));
        let db = if apart == 0.0 || loudest == 0.0 { f64::NEG_INFINITY } else { 20.0 * (apart / loudest).log10() };
        rows.push((e.descriptor.id, exact, db));
    }
    rows.sort_by(|a, b| b.2.total_cmp(&a.2));
    let same = rows.iter().filter(|row| row.1).count();
    println!("{same} of {} effects render Apple's bits here. The furthest from it:", rows.len());
    for (id, _, db) in rows.iter().take(15) {
        println!("  {id:<24} {db:>8.1} dB");
    }
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        assert_eq!(same, rows.len(), "on Apple silicon every render is the stored one");
    }
    let most = |id: &str| FURTHER.iter().find(|(known, _)| *known == id).map_or(FLOOR_DB, |(_, db)| *db);
    let loud: Vec<String> = rows
        .iter()
        .filter(|(id, _, db)| *db > most(id))
        .map(|(id, _, db)| format!("{id}: {db:.1} dB (at most {:.0})", most(id)))
        .collect();
    assert!(loud.is_empty(), "{} effects are further from Apple's render than allowed:\n{}", loud.len(), loud.join("\n"));
}

/// A control moved on a sample that no block starts on, with the audio cut
/// into uneven pieces, against the same in blocks of 512.
#[test]
fn an_effect_does_not_depend_on_how_the_audio_is_cut() {
    let mut bad = Vec::new();
    for e in CATALOG {
        let id = e.descriptor.id;
        let moved = e.descriptor.params.iter().enumerate().find(|(_, p)| !p.inert);
        let play = |uneven: bool| {
            let (mut ctl, mut audio) = patch(id, &[]);
            if let Some((i, p)) = moved {
                knob(&mut ctl, 5333, i, far_end(p));
                knob(&mut ctl, 10_667, i, p.default);
            }
            if uneven {
                render_uneven(&mut audio, par::FRAMES, 11)
            } else {
                render(&mut audio, par::FRAMES, 512)
            }
        };
        let (l, r) = play(false);
        let (ul, ur) = play(true);
        if let Some(i) = first_difference(&l, &ul).or(first_difference(&r, &ur)) {
            bad.push(format!("{id}: first differs at sample {i}"));
        }
    }
    assert!(bad.is_empty(), "{} of {} effects depend on the cut:\n{}", bad.len(), CATALOG.len(), bad.join("\n"));
}

#[test]
fn no_effect_allocates_on_the_audio_thread() {
    assert_the_check_is_on();
    let mut bad = Vec::new();
    for e in CATALOG {
        let id = e.descriptor.id;
        let (mut ctl, mut audio) = patch(id, &[]);
        for (i, p) in e.descriptor.params.iter().enumerate() {
            knob(&mut ctl, 300 + 97 * i, i, p.max);
            knob(&mut ctl, 2500 + 97 * i, i, p.min);
        }
        let before = counted();
        render(&mut audio, 6000, 128);
        if counted() != before {
            bad.push(format!("{id}: {} allocations or frees", counted() - before));
        }
    }
    assert!(bad.is_empty(), "{} effects allocate:\n{}", bad.len(), bad.join("\n"));
}

#[test]
fn an_effect_the_catalogue_does_not_have_is_refused() {
    assert!(Fx::new("no-such-effect", RATE).is_none());
}
