//! The Prism pad's default pairs for the shapers: which two controls a
//! Hyperprism process put on its square, and over what part of each range.
//! See docs/HYPERPRISM.md, *The processes*.

use fx::params::ParamSpec;
use fx::shape::ShapeKind;

/// Hyperprism's processes that this program already has, as shapers, and the
/// pair each one gets.
const PAIRS: &[(ShapeKind, &str, &str)] = &[
    (ShapeKind::Chamberlin, "lowFreq", "lowQ"),
    (ShapeKind::DattorroNotch, "frequency", "bandwidth"),
    (ShapeKind::Phaser, "rateHz", "depth"),
    (ShapeKind::Flanger, "rateHz", "depthMs"),
    (ShapeKind::WhiteChorus, "rateHz", "depthMs"),
    (ShapeKind::Ring, "hz", "mix"),
    (ShapeKind::Vibrato, "rateHz", "depthMs"),
    (ShapeKind::SchroederReverb, "wet", "decay"),
    (ShapeKind::MoorerReverb, "wet", "decay"),
    (ShapeKind::Gate, "attackMs", "thresholdDb"),
];

fn spec(kind: ShapeKind, key: &str) -> &'static ParamSpec {
    kind.specs().iter().find(|s| s.key == key).unwrap_or_else(|| panic!("{} has no {key}", kind.as_str()))
}

#[test]
fn each_hyperprism_process_here_has_its_pair() {
    for &(kind, x, y) in PAIRS {
        let pad = kind.pad().unwrap_or_else(|| panic!("{} has no pad pair", kind.as_str()));
        assert_eq!((pad.x, pad.y), (x, y), "{}", kind.as_str());
    }
}

#[test]
fn every_pair_names_two_real_controls_and_stays_inside_their_ranges() {
    for kind in ShapeKind::ALL {
        let Some(pad) = kind.pad() else { continue };
        assert_ne!(pad.x, pad.y, "{}", kind.as_str());
        for (key, (lo, hi)) in [(pad.x, pad.x_range), (pad.y, pad.y_range)] {
            let s = spec(kind, key);
            assert!(lo != hi, "{}.{key}: an empty sweep", kind.as_str());
            for end in [lo, hi] {
                assert!(
                    end >= s.min && end <= s.max,
                    "{}.{key}: {end} is outside {}..{}",
                    kind.as_str(),
                    s.min,
                    s.max
                );
            }
        }
    }
}

#[test]
fn only_the_hyperprism_processes_have_one() {
    let with: Vec<&str> = ShapeKind::ALL.iter().filter(|k| k.pad().is_some()).map(|k| k.as_str()).collect();
    let expected: Vec<&str> = PAIRS.iter().map(|(k, _, _)| k.as_str()).collect();
    let mut a = with.clone();
    let mut b = expected.clone();
    a.sort();
    b.sort();
    assert_eq!(a, b);
}
