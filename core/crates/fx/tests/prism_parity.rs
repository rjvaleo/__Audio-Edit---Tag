//! Every effect this program built itself, against the `prism-fx` effect it
//! has moved to, through the rack's own interface: interleaved, a block at a
//! time, controls by key.
//!
//! The gate SHARED-FX.md sets for retiring an effect of this program's own,
//! and the one Echo passed (`prism.rs`): the prism effect, run through
//! `PrismEffect`, renders what this program's effect rendered, bit for bit,
//! before the rack builds it instead. Here for all of them — the thirty-three
//! shape kinds, the EQ, the compressor and the gain — at their defaults, with
//! each control in turn moved across its range, and with controls moved while
//! it runs; mono and stereo, in blocks of several sizes.

use fx::params::Params;
use fx::prism::PrismEffect;
use fx::shape::ShapeKind;
use fx::Effect;
use prism_fx::ParamKind;

const SR: u32 = 48_000;

/// A click, then tones, noise and silence, different on each side.
fn source(frames: usize, channels: usize) -> Vec<f32> {
    let mut out = Vec::with_capacity(frames * channels);
    let mut x = 0x2545_f491_u32;
    for n in 0..frames {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        let noise = (x as f32 / u32::MAX as f32) * 2.0 - 1.0;
        let t = n as f32 / SR as f32;
        let (l, r) = if n == 0 {
            (1.0, -0.7)
        } else {
            match (n / 4_000) % 4 {
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

/// Before block `at`, set `key` to `value`.
type Move = (usize, String, f32);

fn render(e: &mut dyn Effect, input: &[f32], channels: usize, block: usize, moves: &[Move]) -> Vec<f32> {
    let mut out = input.to_vec();
    for (i, chunk) in out.chunks_mut(block * channels).enumerate() {
        for (at, key, value) in moves {
            if *at == i {
                e.set_param(key, *value);
            }
        }
        e.process(chunk, channels, SR);
    }
    out
}

fn first_difference(a: &[f32], b: &[f32]) -> Option<(usize, f32, f32)> {
    a.iter().zip(b).position(|(x, y)| x.to_bits() != y.to_bits()).map(|i| (i, a[i], b[i]))
}

/// What this program built for an effect, before the move.
enum Old {
    Shape(ShapeKind),
    Eq,
    Comp,
    Gain,
    /// The rack's channel maximizer, which the Maximizer kind also is.
    Master,
}

fn old(which: &Old, channels: usize, settings: &[(String, f32)]) -> Box<dyn Effect> {
    match which {
        Old::Shape(kind) => fx::shape::make_own(*kind, SR, channels, settings),
        Old::Eq => keyed(Box::new(fx::Eq::new(fx::eq::EqSettings::default())), settings),
        Old::Comp => keyed(Box::new(fx::Compressor::new(fx::comp::CompSettings::default())), settings),
        Old::Gain => keyed(Box::new(fx::Gain { db: 0.0 }), settings),
        Old::Master => {
            let mut m = fx::Maximizer::new(fx::MasterSettings { on: true, ..Default::default() });
            for (k, v) in settings {
                Params::set(&mut m, k, *v);
            }
            Box::new(fx::Driven(m))
        }
    }
}

fn keyed(mut e: Box<dyn Effect>, settings: &[(String, f32)]) -> Box<dyn Effect> {
    for (k, v) in settings {
        e.set_param(k, *v);
    }
    e
}

fn new(id: &str, settings: &[(String, f32)]) -> Box<dyn Effect> {
    // As the rack builds a moved effect: as made, only stored controls told.
    let mut e = PrismEffect::as_built(id, SR).unwrap_or_else(|| panic!("{id} is not in the catalogue"));
    for (k, v) in settings {
        Params::set(&mut e, k, *v);
    }
    Box::new(e)
}

/// Values worth hearing for a control: across its range, whole where it
/// counts, both ends of a switch, every choice.
fn values(spec: &prism_fx::ParamSpec) -> Vec<f32> {
    match spec.kind {
        ParamKind::Toggle => vec![spec.min, spec.max],
        ParamKind::Choice(options) => (0..options.len()).map(|i| spec.min + i as f32).collect(),
        ParamKind::Int => [0.0, 0.3, 1.0].iter().map(|f| (spec.min + (spec.max - spec.min) * f).round()).collect(),
        ParamKind::Continuous => [0.0, 0.27, 0.8, 1.0].iter().map(|f| spec.min + (spec.max - spec.min) * f).collect(),
    }
}

/// The effects, old and new.
fn pairs() -> Vec<(String, Old, &'static str)> {
    let mut out: Vec<(String, Old, &'static str)> =
        ShapeKind::ALL.iter().map(|k| (k.as_str().to_string(), Old::Shape(*k), k.prism_id())).collect();
    out.push(("eq".into(), Old::Eq, "eq"));
    out.push(("comp".into(), Old::Comp, "compressor"));
    out.push(("gain".into(), Old::Gain, "gain"));
    out.push(("master".into(), Old::Master, "maximizer"));
    out
}

fn check(name: &str, which: &Old, id: &str, settings: &[(String, f32)], moves: &[Move], seconds: f32, failures: &mut Vec<String>) {
    for channels in [2, 1] {
        for block in [512, 61] {
            let input = source((SR as f32 * seconds) as usize, channels);
            let was = render(old(which, channels, settings).as_mut(), &input, channels, block, moves);
            let now = render(new(id, settings).as_mut(), &input, channels, block, moves);
            if let Some(d) = first_difference(&was, &now) {
                failures.push(format!("{name} {settings:?} {moves:?}, {channels} ch, blocks of {block}: first differs at {d:?}"));
                return;
            }
        }
    }
}

#[test]
fn every_effect_renders_exactly_what_this_programs_own_did() {
    let mut failures = Vec::new();
    for (name, which, id) in pairs() {
        let descriptor = prism_fx::find(id).unwrap_or_else(|| panic!("{id} is not in the catalogue")).descriptor;
        check(&name, &which, id, &[], &[], 1.5, &mut failures);
        for spec in descriptor.params {
            for value in values(spec) {
                check(&name, &which, id, &[(spec.key.to_string(), value)], &[], 0.6, &mut failures);
            }
        }
        // Controls moved while it runs: every one, to a third of its range,
        // a few blocks apart.
        let moves: Vec<Move> = descriptor
            .params
            .iter()
            .enumerate()
            .map(|(i, spec)| (3 + i * 2, spec.key.to_string(), spec.clamp(spec.min + (spec.max - spec.min) * 0.33)))
            .collect();
        check(&name, &which, id, &[], &moves, 1.5, &mut failures);
    }
    assert!(failures.is_empty(), "{} differ:\n{}", failures.len(), failures.join("\n"));
}

#[test]
fn every_effect_has_the_same_controls_under_the_same_keys() {
    for (name, which, id) in pairs() {
        let descriptor = prism_fx::find(id).unwrap().descriptor;
        let old_keys: Vec<&str> = match which {
            Old::Shape(kind) => kind.specs().iter().map(|s| s.key).collect(),
            _ => continue,
        };
        // Inert controls included: the Dattorro notch and resonator keep the
        // gain they never read, so documents that stored it still open.
        let new_keys: Vec<&str> = descriptor.params.iter().map(|s| s.key).collect();
        assert_eq!(old_keys, new_keys, "{name}");
        for spec in kind_specs(&which) {
            let p = descriptor.spec(spec.key).unwrap();
            assert_eq!((spec.min, spec.max, spec.default), (p.min, p.max, p.default), "{name}.{}", spec.key);
        }
    }
}

fn kind_specs(which: &Old) -> &'static [fx::params::ParamSpec] {
    match which {
        Old::Shape(kind) => kind.specs(),
        _ => &[],
    }
}

#[test]
fn the_compressor_still_reports_its_gain_reduction() {
    let settings = [("thresholdDb".to_string(), -30.0), ("ratio".to_string(), 8.0)];
    let input = source(SR as usize, 2);
    let mut was = old(&Old::Comp, 2, &settings);
    let mut now = new("compressor", &settings);
    for chunk in input.chunks(512 * 2) {
        let (mut a, mut b) = (chunk.to_vec(), chunk.to_vec());
        was.process(&mut a, 2, SR);
        now.process(&mut b, 2, SR);
        assert_eq!(was.telemetry().to_bits(), now.telemetry().to_bits());
    }
    assert!(now.telemetry() > 1.0, "no reduction reported");
}
