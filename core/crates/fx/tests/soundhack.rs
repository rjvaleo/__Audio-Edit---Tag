//! SoundHack's time scale, through the paths MultiGrainLive uses: the
//! document's `Stretch` and an export. The DSP itself is tested where it
//! lives, in prism-grain's `soundhack.rs`.

use fx::soundhack::{SoundHackParams, Version};
use fx::stretch::{Algorithm, Stretch};

const SR: u32 = 48_000;

fn source(frames: usize) -> Vec<f32> {
    (0..frames * 2)
        .map(|i| {
            let t = (i / 2) as f32 / SR as f32;
            let f0 = 180.0 + 900.0 * t;
            (t * f0 * std::f32::consts::TAU).sin() * 0.3
                + (t * f0 * 3.0 * std::f32::consts::TAU).sin() * 0.15
                + ((i * 2654435761) % 1000) as f32 / 1000.0 * 0.02
        })
        .collect()
}

fn soundhack(ratio: f32, version: Version) -> Stretch {
    Stretch { ratio, algorithm: Algorithm::SoundHack, soundhack: SoundHackParams { version }, ..Default::default() }
}

fn moved(a: &[f32], b: &[f32]) -> f32 {
    assert_eq!(a.len(), b.len());
    let peak = a.iter().fold(0.0f32, |m, v| m.max(v.abs())).max(1e-6);
    a.iter().zip(b).fold(0.0f32, |m, (x, y)| m.max((x - y).abs())) / peak
}

/// The switch reaches an export wherever the two versions differ, which is
/// any ratio that is not a whole number.
#[test]
fn the_version_switch_reaches_the_render() {
    let src = source(SR as usize / 2);
    for r in [0.75f32, 1.5, 3.3] {
        let a = soundhack(r, Version::V0888).process(&src, 2, SR);
        let b = soundhack(r, Version::V0896).process(&src, 2, SR);
        assert!(moved(&a, &b) > 0.05, "{r}: {}", moved(&a, &b));
    }
}

/// And at 2× the two are one sound: both pick hops 64/128, and a
/// whole-number scale makes the two wrap orders the same phase.
#[test]
fn at_a_whole_ratio_the_versions_agree() {
    let src = source(SR as usize / 2);
    let a = soundhack(2.0, Version::V0888).process(&src, 2, SR);
    let b = soundhack(2.0, Version::V0896).process(&src, 2, SR);
    assert!(moved(&a, &b) < 3e-3, "{}", moved(&a, &b));
}

/// Choosing it is an edit even at 1×: the export runs it rather than handing
/// back the file, and the document counts as touched.
#[test]
fn at_unity_it_is_still_soundhack() {
    let src = source(SR as usize / 4);
    let s = soundhack(1.0, Version::V0896);
    assert!(!s.is_identity());
    let out = s.process(&src, 2, SR);
    assert_eq!(out.len(), src.len());
    assert!(moved(&src, &out) > 1e-3);
}

/// The length is the ratio's, pitch or no pitch.
#[test]
fn the_promised_length_holds() {
    let src = source(SR as usize / 4);
    for (r, st) in [(0.5f32, 0.0f32), (2.0, 0.0), (3.0, 7.0), (1.0, -12.0)] {
        let s = Stretch { semitones: st, ..soundhack(r, Version::V0896) };
        let out = s.process(&src, 2, SR);
        assert_eq!(out.len(), ((src.len() / 2) as f64 * r as f64).round() as usize * 2, "{r} {st}");
        assert!(out.iter().all(|v| v.is_finite()));
    }
}

/// SoundHack had no grain controls, so the shared ones do not reach it:
/// layers, jitter and drift leave the render as it was.
#[test]
fn the_grain_controls_do_not_reach_it() {
    let src = source(SR as usize / 4);
    let plain = soundhack(1.5, Version::V0896);
    let mut busy = plain;
    busy.grain.layers = 4;
    busy.grain.pitch_jitter_semis = 3.0;
    busy.grain.size_jitter = 0.5;
    assert_eq!(plain.process(&src, 2, SR), busy.process(&src, 2, SR));
}
