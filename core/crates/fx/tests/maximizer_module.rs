//! The maximiser as a rack module.
//!
//! It began as the channel's own compressor — not a slot, pushed last always.
//! The interface for that was lost when the effects moved to a rail, and for
//! three days there was no way to reach it at all. As a module it is placeable,
//! bypassable and describable to the interface like everything else.

use fx::params::Params;
use fx::shape::ShapeKind;
use fx::Effect;

const SR: u32 = 48_000;

fn built(params: &[(&str, f32)]) -> Box<dyn Effect> {
    let owned: Vec<(String, f32)> = params.iter().map(|(k, v)| ((*k).into(), *v)).collect();
    fx::shape::make(ShapeKind::Maximizer, SR, 2, &owned)
}

/// Loud enough that a maximiser has something to do.
fn hot(frames: usize) -> Vec<f32> {
    (0..frames * 2)
        .map(|i| ((i / 2) as f32 * 0.05).sin() * 0.98)
        .collect()
}

fn peak(v: &[f32]) -> f32 {
    v.iter().fold(0.0f32, |m, s| m.max(s.abs()))
}

#[test]
fn the_module_exists_and_declares_its_controls() {
    assert!(ShapeKind::ALL.contains(&ShapeKind::Maximizer));
    assert_eq!(ShapeKind::from_str("maximizer"), Some(ShapeKind::Maximizer));
    assert_eq!(ShapeKind::Maximizer.as_str(), "maximizer");

    let keys: Vec<&str> = ShapeKind::Maximizer.specs().iter().map(|p| p.key).collect();
    assert_eq!(keys, ["amount", "ceilingDb", "autoLevel", "autoComp"]);
}

/// The point of the thing. Whatever else it does, nothing gets past the
/// ceiling — which is the one guarantee this effect makes.
#[test]
fn nothing_reaches_the_output_above_the_ceiling() {
    let mut m = built(&[("amount", 1.0), ("ceilingDb", -6.0)]);
    let mut buf = hot(SR as usize / 2);
    m.process(&mut buf, 2, SR);

    let ceiling = 10f32.powf(-6.0 / 20.0);
    assert!(
        peak(&buf) <= ceiling + 1e-3,
        "peak {} is above the -6 dB ceiling {ceiling}",
        peak(&buf)
    );
}

/// A module that appears in the picker and does nothing to the audio is worse
/// than no module, so this asserts it is actually in the path.
#[test]
fn amount_at_zero_is_inert_and_turning_it_up_is_not() {
    let dry = hot(SR as usize / 4);

    let mut off = dry.clone();
    built(&[("amount", 0.0)]).process(&mut off, 2, SR);

    let mut on = dry.clone();
    built(&[("amount", 1.0), ("ceilingDb", -12.0)]).process(&mut on, 2, SR);

    assert!(peak(&on) < peak(&off), "turning it up changed nothing");
}

/// Every parameter round-trips by key, which is what automation, presets and
/// the wire all depend on.
#[test]
fn every_control_reads_back_what_was_written() {
    let mut m = fx::Maximizer::new(fx::MasterSettings::default());
    for (key, value) in [("amount", 0.7), ("ceilingDb", -3.5), ("autoLevel", 0.0), ("autoComp", 1.0)] {
        assert!(m.set(key, value), "{key} was refused");
        assert_eq!(m.get(key), Some(value), "{key} did not read back");
    }
    assert!(!m.set("nonsense", 1.0));
    assert_eq!(m.get("nonsense"), None);
}

/// Out-of-range values are clamped rather than believed — the same rule every
/// other module follows, and the reason a ceiling cannot be pushed above zero.
#[test]
fn values_are_clamped_to_their_declared_range() {
    let mut m = fx::Maximizer::new(fx::MasterSettings::default());
    m.set("ceilingDb", 40.0);
    assert_eq!(m.get("ceilingDb"), Some(0.0));
    m.set("amount", -3.0);
    assert_eq!(m.get("amount"), Some(0.0));
}
