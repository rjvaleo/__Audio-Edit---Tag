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
        soundhack: Default::default(),
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

/// The "run-idle" and "play-no-run" rows were recorded again on 18 Nov 2026:
/// those two scripts end on a stop, and a stop now leaves from the sound's last
/// frame over five milliseconds where it used to cut. The note scripts never
/// stop the transport and are as they were.
/// The transport rows were checked again on 18 Nov for the five millisecond
/// rise after idle. Four change; the note rows and OFFLINE remain identical.
const BASELINE: &[(&str, u64)] = &[
    ("Granular/1/false/mono", 0x40f921163e915bbf),
    ("Granular/1/false/legato", 0x5344b15655be9c02),
    ("Granular/1/false/run-idle", 0x1d4e2386ba240fb3),
    ("Granular/1/false/play-no-run", 0x5d6a6ea798057847),
    ("Granular/3/false/mono", 0x29909e2d714f9b17),
    ("Granular/3/false/legato", 0x05be8f3909455e77),
    ("Granular/3/false/run-idle", 0xb439bc83ec07fae2),
    ("Granular/3/false/play-no-run", 0xb475cfa5635729a8),
    ("Granular/1/true/mono", 0x40f921163e915bbf),
    ("Granular/1/true/legato", 0x5344b15655be9c02),
    ("Granular/1/true/run-idle", 0x1d4e2386ba240fb3),
    ("Granular/1/true/play-no-run", 0x5d6a6ea798057847),
    ("Wsola/1/false/mono", 0x34da7ccaeb44dedc),
    ("Wsola/1/false/legato", 0xfeeb406cecea1063),
    ("Wsola/1/false/run-idle", 0xcff10c085404b90f),
    ("Wsola/1/false/play-no-run", 0x5986ad0fa2a753d1),
    ("Wsola/3/false/mono", 0x33e2ab2cbdf0fd18),
    ("Wsola/3/false/legato", 0xdc852b462d89c0ab),
    ("Wsola/3/false/run-idle", 0xf9f314128eebbcac),
    ("Wsola/3/false/play-no-run", 0x3973ebaaa808192d),
    ("Wsola/1/true/mono", 0x6a333dc38ac25df5),
    ("Wsola/1/true/legato", 0x4192ebd5b2b9b9c7),
    ("Wsola/1/true/run-idle", 0x9842af62f16197d9),
    ("Wsola/1/true/play-no-run", 0x52d35823995da265),
    ("Vocoder/1/false/mono", 0x1f9ebf7598d446e9),
    ("Vocoder/1/false/legato", 0x6965e342595612fa),
    ("Vocoder/1/false/run-idle", 0xa29de6d46dd2d2f0),
    ("Vocoder/1/false/play-no-run", 0x48c5223044971573),
    ("Vocoder/3/false/mono", 0x142b234996282b5b),
    ("Vocoder/3/false/legato", 0x28d7a66517ab7ec9),
    ("Vocoder/3/false/run-idle", 0x9a8e6ab45c428e5a),
    ("Vocoder/3/false/play-no-run", 0x9a28699e2713729d),
    ("Vocoder/1/true/mono", 0x08040495c61b0566),
    ("Vocoder/1/true/legato", 0xad49bc13a3a0b24f),
    ("Vocoder/1/true/run-idle", 0x2b56d2d829189c88),
    ("Vocoder/1/true/play-no-run", 0xc9be38a180663d1f),
    ("Pvsola/1/false/mono", 0x01e6670d6c9bc2f6),
    ("Pvsola/1/false/legato", 0x19e57e142c7d5841),
    ("Pvsola/1/false/run-idle", 0x74863960e4b0fe57),
    ("Pvsola/1/false/play-no-run", 0x96844e93e47e5804),
    ("Pvsola/3/false/mono", 0x8678880cc2bd960e),
    ("Pvsola/3/false/legato", 0xdfbbabbea1e2db29),
    ("Pvsola/3/false/run-idle", 0x6457a3ced3de5b1a),
    ("Pvsola/3/false/play-no-run", 0x2db332159e16178a),
    ("Pvsola/1/true/mono", 0x0b4f50d14363a863),
    ("Pvsola/1/true/legato", 0x1b3ac2917d25fda9),
    ("Pvsola/1/true/run-idle", 0x18e594b2ff5ce122),
    ("Pvsola/1/true/play-no-run", 0xe87a6a7f1bbe7f6d),
    ("Hybrid/1/false/mono", 0x7670d5fa5e6267cb),
    ("Hybrid/1/false/legato", 0xd59152455a5ba317),
    ("Hybrid/1/false/run-idle", 0x70f46807351c985b),
    ("Hybrid/1/false/play-no-run", 0xf685a922ff8278d1),
    ("Hybrid/3/false/mono", 0x17214179e612cb50),
    ("Hybrid/3/false/legato", 0x6170a747be03cbc4),
    ("Hybrid/3/false/run-idle", 0x33625369fd65b9e2),
    ("Hybrid/3/false/play-no-run", 0x06b43487e9801e1a),
    ("Hybrid/1/true/mono", 0x904d74246a8a240d),
    ("Hybrid/1/true/legato", 0xc0f94a78c716a2c3),
    ("Hybrid/1/true/run-idle", 0x1db105132abbf2e8),
    ("Hybrid/1/true/play-no-run", 0xc2f57919b16528a2),
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
