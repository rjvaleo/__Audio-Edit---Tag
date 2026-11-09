//! Mono, Legato, and ▶ or Run with no key down: the same samples as before Poly
//! existed, bit for bit. The numbers were taken from the build before Phase 7.
//!
//! Run with `-- --nocapture` to see them.

use engine::{Core, GrainKeys, KeyMode, Shared, Source};
use fx::grain::{Grain, StreamParams};
use fx::stretch::Algorithm;
use std::sync::Arc;

const SR: u32 = 48_000;
const BLOCK: usize = 512;
const FILE: usize = 96_000;
const ENGINES: [Algorithm; 5] =
    [Algorithm::Granular, Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Pvsola, Algorithm::Hybrid];

fn source() -> Arc<Source> {
    let mut seed = 7u32;
    let samples = (0..FILE)
        .flat_map(|i| {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let noise = ((seed >> 16) as f32 / 32768.0) - 1.0;
            let s = (i as f32 * 0.02).sin() * 0.4 + noise * 0.05;
            [s, s * 0.8]
        })
        .collect();
    Arc::new(Source { samples, channels: 2 })
}

fn params(alg: Algorithm, ratio: f32, layers: u32, cloud: bool) -> StreamParams {
    let mut sp = StreamParams {
        in_frames: FILE,
        sample_rate: SR,
        ratio,
        semitones: 0.0,
        window_ms: 40.0,
        grain: Grain { layers, ..Grain::default() },
        algorithm: alg,
        wsola: fx::stretch::WsolaParams::default(),
        vocoder: fx::stretch::VocoderParams::default(),
        pvsola: fx::pvsola::PvsolaParams::default(),
        hybrid: fx::hybrid::HybridParams::default(),
        cloud,
        cloud_mix: 0.5,
    };
    sp.semitones = 0.0;
    sp
}

struct Rig {
    core: Core,
    shared: Shared,
    keys: Arc<GrainKeys>,
}

fn rig(alg: Algorithm, ratio: f32, layers: u32, cloud: bool, run: bool) -> Rig {
    let src = source();
    let sp = params(alg, ratio, layers, cloud);
    let shared = Shared::new(sp, Arc::clone(&src));
    if alg == Algorithm::Hybrid {
        shared.set_parts(Arc::new(fx::hstream::Parts::separate(&src.samples, 2, sp.hybrid)));
    }
    if layers > 1 {
        shared.set_bank(engine::stretcher::LayerBank::build(alg, layers, BLOCK, 2, SR));
    }
    let mut rack = fx::Rack::new();
    rack.push(Box::new(fx::Gain { db: -3.0 }));
    rack.reserve_mix(BLOCK);
    shared.set_rack(Some(rack));
    let keys = Arc::new(GrainKeys::new());
    keys.set_run(run);
    keys.set_amp(0.01, 0.05, 0.7, 0.05);
    keys.set_glide(0.02);
    keys.set_start(0.1);
    let core = Core::new(BLOCK, 2, sp, src).with_keys(Arc::clone(&keys));
    Rig { core, shared, keys }
}

/// FNV-1a over the bits of every sample.
fn hash(h: &mut u64, x: &[f32]) {
    for s in x {
        for b in s.to_bits().to_le_bytes() {
            *h ^= b as u64;
            *h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
}

fn pump(r: &mut Rig, h: &mut u64, blocks: usize) {
    let mut buf = vec![0f32; BLOCK * 2];
    for _ in 0..blocks {
        r.core.fill(&mut buf, 2, &r.shared);
        hash(h, &buf);
    }
}

fn played_notes(r: &mut Rig, mode: KeyMode, h: &mut u64) {
    r.keys.set_mode(mode);
    pump(r, h, 4);
    r.keys.note_on(60, 0.8);
    pump(r, h, 40);
    r.keys.note_on(67, 0.6);
    pump(r, h, 40);
    r.keys.note_off(60);
    pump(r, h, 20);
    r.keys.set_bend(1.5);
    pump(r, h, 20);
    r.keys.note_off(67);
    pump(r, h, 40);
    r.keys.set_bend(0.0);
    r.keys.note_on(55, 1.0);
    pump(r, h, 30);
    r.keys.all_off();
    pump(r, h, 40);
}

fn no_notes(r: &mut Rig, h: &mut u64) {
    pump(r, h, 4);
    r.shared.play();
    pump(r, h, 150);
    r.shared.pause();
    pump(r, h, 20);
}

const BASELINE: &[(&str, u64)] = &[
    ("Granular/1/false/mono", 0x40f921163e915bbf),
    ("Granular/1/false/legato", 0x5344b15655be9c02),
    ("Granular/1/false/run-idle", 0x9e40f6344f715004),
    ("Granular/1/false/play-no-run", 0x55ee2c32644913b0),
    ("Granular/3/false/mono", 0x29909e2d714f9b17),
    ("Granular/3/false/legato", 0x05be8f3909455e77),
    ("Granular/3/false/run-idle", 0x452b9c1c8a74e9c0),
    ("Granular/3/false/play-no-run", 0xd302b8df37847df6),
    ("Granular/1/true/mono", 0x40f921163e915bbf),
    ("Granular/1/true/legato", 0x5344b15655be9c02),
    ("Granular/1/true/run-idle", 0x9e40f6344f715004),
    ("Granular/1/true/play-no-run", 0x55ee2c32644913b0),
    ("Wsola/1/false/mono", 0x34da7ccaeb44dedc),
    ("Wsola/1/false/legato", 0xfeeb406cecea1063),
    ("Wsola/1/false/run-idle", 0x82b3676d4e8d36e4),
    ("Wsola/1/false/play-no-run", 0x16fee5e96ff75aa2),
    ("Wsola/3/false/mono", 0x33e2ab2cbdf0fd18),
    ("Wsola/3/false/legato", 0xdc852b462d89c0ab),
    ("Wsola/3/false/run-idle", 0x24bda176f7f35e4f),
    ("Wsola/3/false/play-no-run", 0xfd1b0139b4628676),
    ("Wsola/1/true/mono", 0x6a333dc38ac25df5),
    ("Wsola/1/true/legato", 0x4192ebd5b2b9b9c7),
    ("Wsola/1/true/run-idle", 0x01d7facad9417f5f),
    ("Wsola/1/true/play-no-run", 0xc539b9bbdf2bec55),
    ("Vocoder/1/false/mono", 0xbf7bad675e862ebd),
    ("Vocoder/1/false/legato", 0xbf9253fe9b470775),
    ("Vocoder/1/false/run-idle", 0xc6227bfe2fcd7069),
    ("Vocoder/1/false/play-no-run", 0x925b276299e8b902),
    ("Vocoder/3/false/mono", 0xa416af65c2613d20),
    ("Vocoder/3/false/legato", 0xd610494690a3959b),
    ("Vocoder/3/false/run-idle", 0x94ff99b9e5df4547),
    ("Vocoder/3/false/play-no-run", 0x1b6a2482a6f16700),
    ("Vocoder/1/true/mono", 0x60dd97bab86235a4),
    ("Vocoder/1/true/legato", 0xcbf9ea55af98b9b2),
    ("Vocoder/1/true/run-idle", 0x4437d936b30bc1a2),
    ("Vocoder/1/true/play-no-run", 0x460e309760e6e027),
    ("Pvsola/1/false/mono", 0x01e6670d6c9bc2f6),
    ("Pvsola/1/false/legato", 0x19e57e142c7d5841),
    ("Pvsola/1/false/run-idle", 0xde644555aafcaa74),
    ("Pvsola/1/false/play-no-run", 0xce0a1c668c4b1d67),
    ("Pvsola/3/false/mono", 0x8678880cc2bd960e),
    ("Pvsola/3/false/legato", 0xdfbbabbea1e2db29),
    ("Pvsola/3/false/run-idle", 0x8b9b6ce9659e5c95),
    ("Pvsola/3/false/play-no-run", 0x745d517c4eebff05),
    ("Pvsola/1/true/mono", 0x0b4f50d14363a863),
    ("Pvsola/1/true/legato", 0x1b3ac2917d25fda9),
    ("Pvsola/1/true/run-idle", 0xd89bbf20682c5b0a),
    ("Pvsola/1/true/play-no-run", 0x385b2c5f37a799e3),
    ("Hybrid/1/false/mono", 0x3a6883c50d3fc5f3),
    ("Hybrid/1/false/legato", 0x53010c23262bf244),
    ("Hybrid/1/false/run-idle", 0xa33e2a8b24cdc7c2),
    ("Hybrid/1/false/play-no-run", 0x5f1afd66dd5bc330),
    ("Hybrid/3/false/mono", 0xde30f4fde2e35a90),
    ("Hybrid/3/false/legato", 0x9efcfd63a9f7197b),
    ("Hybrid/3/false/run-idle", 0xebbf4724eb32c6d3),
    ("Hybrid/3/false/play-no-run", 0xc516969710c22afb),
    ("Hybrid/1/true/mono", 0x24c5c33b49f32e57),
    ("Hybrid/1/true/legato", 0x7424016d9476a030),
    ("Hybrid/1/true/run-idle", 0xe25964ccb188127b),
    ("Hybrid/1/true/play-no-run", 0x01058e1d98d708a9),
];

const OFFLINE: &[(&str, u64)] = &[
    ("Granular", 0x107c37d3599f6421),
    ("Wsola", 0xca13397f3a205ed2),
    ("Vocoder", 0x65ae6139fec1ce74),
    ("Pvsola", 0xee979fdbc79da28d),
    ("Hybrid", 0xd77b56f65d7d3765),
];

#[test]
fn the_notes_and_the_transport_are_what_they_were() {
    let mut got: Vec<(String, u64)> = Vec::new();
    for alg in ENGINES {
        for (layers, cloud) in [(1u32, false), (3, false), (1, true)] {
            let name = format!("{alg:?}/{layers}/{cloud}");
            let check = |label: &str, f: &mut dyn FnMut(&mut u64) -> ()| {
                let mut h = 0xcbf2_9ce4_8422_2325u64;
                f(&mut h);
                (format!("{name}/{label}"), h)
            };
            got.push(check("mono", &mut |h| {
                let mut r = rig(alg, 2.0, layers, cloud, false);
                played_notes(&mut r, KeyMode::Mono, h);
            }));
            got.push(check("legato", &mut |h| {
                let mut r = rig(alg, 2.0, layers, cloud, false);
                played_notes(&mut r, KeyMode::Legato, h);
            }));
            got.push(check("run-idle", &mut |h| {
                let mut r = rig(alg, 2.0, layers, cloud, true);
                no_notes(&mut r, h);
            }));
            got.push(check("play-no-run", &mut |h| {
                let mut r = rig(alg, 2.0, layers, cloud, false);
                r.keys.set_played(true);
                no_notes(&mut r, h);
            }));
        }
    }
    for (name, h) in &got {
        println!("    (\"{name}\", 0x{h:016x}),");
    }
    if BASELINE.is_empty() {
        return;
    }
    for (name, h) in &got {
        let want = BASELINE.iter().find(|(n, _)| n == name).unwrap_or_else(|| panic!("no baseline for {name}")).1;
        assert_eq!(*h, want, "{name} has changed");
    }
}

/// And the offline render of every engine at Scan 1.
#[test]
fn offline_renders_at_scan_one_are_what_they_were() {
    let src = source();
    let mut got = Vec::new();
    for alg in ENGINES {
        let s = fx::Stretch { ratio: 2.0, algorithm: alg, ..Default::default() };
        let out = s.process(&src.samples, 2, SR);
        let mut h = 0xcbf2_9ce4_8422_2325u64;
        hash(&mut h, &out);
        got.push((format!("{alg:?}"), h));
    }
    for (name, h) in &got {
        println!("    (\"{name}\", 0x{h:016x}),");
        let want = OFFLINE.iter().find(|(n, _)| n == name).unwrap_or_else(|| panic!("no baseline for {name}")).1;
        assert_eq!(*h, want, "{name} has changed");
    }
}
