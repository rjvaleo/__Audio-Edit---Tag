//! PAR (SUITE-PLAN §5, P0): every one of the rack's 111 menu kinds renders
//! bit-identically to the golden set recorded before the suite layer was built.
//!
//! The kinds, as the rack builds them: the 33 shape kinds (`shape::make`), the
//! native EQ, compressor and gain, and all 86 `prism:<id>` entries
//! (`PrismEffect::as_built`). Each at its defaults, with each control at both
//! ends, and with a control moved while it runs; mono and stereo; blocks of 512
//! and 61. Through the rack's own interface: interleaved, controls by key.
//!
//! Record once, review, commit: `PAR_RECORD=1 cargo test -p fx --release --test par_golden`.
//! Never re-record to make a failure go away: a changed hash is a changed sound.

use fx::params::Params;
use fx::prism::PrismEffect;
use fx::shape::ShapeKind;
use fx::Effect;
use fx::params::ParamSpec;
use std::fmt::Write as _;

const SR: u32 = 48_000;
const FRAMES: usize = 12_000;
const GOLDEN: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/par.tsv");

fn source(channels: usize) -> Vec<f32> {
    let mut out = Vec::with_capacity(FRAMES * channels);
    let mut x = 0x2545_f491_u32;
    for n in 0..FRAMES {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        let noise = (x as f32 / u32::MAX as f32) * 2.0 - 1.0;
        let t = n as f32 / SR as f32;
        let (l, r) = if n == 0 {
            (1.0, -0.7)
        } else {
            match (n / 3_000) % 4 {
                0 => ((t * 440.0 * std::f32::consts::TAU).sin() * 0.6, (t * 660.0 * std::f32::consts::TAU).sin() * 0.4),
                1 => (noise * 0.5, -noise * 0.3),
                2 => ((t * 97.0 * std::f32::consts::TAU).sin() * 0.95, noise * 0.05),
                _ => (0.0, 0.0),
            }
        };
        out.push(l);
        if channels > 1 {
            out.push(r);
        }
    }
    out
}

fn hash(buf: &[f32]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for x in buf {
        for b in x.to_bits().to_le_bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    h
}

/// A kind as the rack builds it, with these stored controls.
#[derive(Clone)]
enum Kind {
    Shape(ShapeKind),
    Eq,
    Comp,
    Gain,
    Prism(&'static str),
}

fn build(k: &Kind, channels: usize, settings: &[(String, f32)]) -> Box<dyn Effect> {
    let keyed = |mut e: Box<dyn Effect>| {
        for (key, v) in settings {
            e.set_param(key, *v);
        }
        e
    };
    match k {
        Kind::Shape(s) => fx::shape::make(*s, SR, channels, settings),
        Kind::Eq => keyed(Box::new(fx::Eq::new(fx::eq::EqSettings::default()))),
        Kind::Comp => keyed(Box::new(fx::Compressor::new(fx::comp::CompSettings::default()))),
        Kind::Gain => keyed(Box::new(fx::Gain { db: 0.0 })),
        Kind::Prism(id) => {
            let mut e = PrismEffect::as_built(id, SR).unwrap();
            for (key, v) in settings {
                Params::set(&mut e, key, *v);
            }
            Box::new(e)
        }
    }
}

fn specs(k: &Kind) -> &'static [ParamSpec] {
    match k {
        Kind::Shape(s) => s.specs(),
        Kind::Eq => fx::prism::specs("eq").unwrap(),
        Kind::Comp => fx::prism::specs("compressor").unwrap(),
        Kind::Gain => fx::prism::specs("gain").unwrap(),
        Kind::Prism(id) => fx::prism::specs(id).unwrap(),
    }
}

fn kinds() -> Vec<(String, Kind)> {
    let mut v: Vec<(String, Kind)> = ShapeKind::ALL.iter().map(|k| (k.as_str().to_string(), Kind::Shape(*k))).collect();
    v.push(("eq".into(), Kind::Eq));
    v.push(("comp".into(), Kind::Comp));
    v.push(("gain".into(), Kind::Gain));
    for e in fx::prism::catalogue() {
        v.push((format!("prism:{}", e.descriptor.id), Kind::Prism(e.descriptor.id)));
    }
    v
}

fn render(k: &Kind, channels: usize, block: usize, settings: &[(String, f32)], moves: &[(usize, String, f32)]) -> u64 {
    let mut e = build(k, channels, settings);
    let mut buf = source(channels);
    for (i, chunk) in buf.chunks_mut(block * channels).enumerate() {
        for (at, key, v) in moves {
            if *at == i {
                e.set_param(key, *v);
            }
        }
        e.process(chunk, channels, SR);
    }
    hash(&buf)
}

fn render_all() -> String {
    let mut out = String::new();
    for (name, k) in kinds() {
        let mut row = |sc: String, h: u64| writeln!(out, "{name}\t{sc}\t{h:016x}").unwrap();
        for (ch, bl) in [(2, 512), (2, 61), (1, 512)] {
            row(format!("default/{ch}ch/{bl}"), render(&k, ch, bl, &[], &[]));
        }
        for p in specs(&k) {
            for (tag, v) in [("min", p.min), ("max", p.max)] {
                row(format!("{}={tag}", p.key), render(&k, 2, 512, &[(p.key.to_string(), v)], &[]));
            }
            let far = if (p.default - p.min).abs() > (p.default - p.max).abs() { p.min } else { p.max };
            let n = FRAMES / 61;
            row(format!("{}~moved", p.key), render(&k, 2, 61, &[], &[(n / 3, p.key.to_string(), far), (2 * n / 3, p.key.to_string(), p.default)]));
        }
    }
    out
}

#[test]
fn every_rack_kind_renders_as_recorded() {
    assert_eq!(kinds().len(), 137, "33 shape kinds + eq, comp, gain + 101 prism entries (P4 adds Freeverb, JCRev, Ambient FDN and the 12 Network modes)");
    let now = render_all();
    if std::env::var_os("PAR_RECORD").is_some() {
        std::fs::write(GOLDEN, &now).unwrap();
        return;
    }
    let golden = std::fs::read_to_string(GOLDEN).expect("no golden set: record it first (PAR_RECORD=1)");
    let g: std::collections::HashMap<(&str, &str), &str> = golden
        .lines()
        .map(|l| {
            let mut f = l.split('\t');
            ((f.next().unwrap(), f.next().unwrap()), f.next().unwrap())
        })
        .collect();
    let mut bad = Vec::new();
    for l in now.lines() {
        let mut f = l.split('\t');
        let (id, sc, h) = (f.next().unwrap(), f.next().unwrap(), f.next().unwrap());
        match g.get(&(id, sc)) {
            Some(x) if *x == h => {}
            Some(x) => bad.push(format!("{id} {sc}: {h} (golden {x})")),
            None => bad.push(format!("{id} {sc}: not in the golden set")),
        }
    }
    assert_eq!(golden.lines().count(), now.lines().count(), "scenario count changed");
    assert!(bad.is_empty(), "{} renders changed:\n{}", bad.len(), bad.join("\n"));
}
