//! Where each sound goes in the 3D map, and how it is drawn.
//!
//! The placement rules are the map's whole meaning — "up is higher, right is
//! noisier, far is longer" — so they are tested here, against fingerprints
//! built by hand, rather than trusted to look right on screen.

use search::map::{family, place};
use search::pitch::Pitch;
use search::{Fingerprint, DIMS, NAMES};

fn dim(name: &str) -> usize {
    NAMES.iter().position(|n| *n == name).unwrap()
}

/// A middling sound, then the named dimensions set.
fn sound(set: &[(&str, f32)], hz: f32, clarity: f32) -> Fingerprint {
    let mut v = [0.5; DIMS];
    for (name, x) in set {
        v[dim(name)] = *x;
    }
    Fingerprint { v, pitch: Pitch { hz, clarity } }
}

fn note(hz: f32) -> Fingerprint {
    sound(&[("flatness", 0.05)], hz, 0.95)
}

fn drum(brightness: f32) -> Fingerprint {
    sound(&[("brightness", brightness), ("flatness", 0.6)], 0.0, 0.2)
}

const X: usize = 0;
const Y: usize = 1;
const Z: usize = 2;

#[test]
fn every_sound_is_placed_inside_the_unit_cube() {
    let prints = vec![note(110.0), note(880.0), drum(0.2), drum(0.9), sound(&[], 0.0, 0.0)];
    let placed = place(&prints);
    assert_eq!(placed.len(), prints.len());
    for p in &placed {
        for c in p.axes.iter().chain(p.islands.iter()) {
            assert!(c.is_finite() && (0.0..=1.0).contains(c), "out of the cube: {p:?}");
        }
        for s in [p.size, p.rough, p.crisp] {
            assert!((0.0..=1.0).contains(&s), "style out of range: {p:?}");
        }
    }
}

#[test]
fn a_higher_note_sits_higher() {
    let placed = place(&[note(440.0), note(110.0), note(1760.0)]);
    assert!(placed[1].axes[Y] < placed[0].axes[Y]);
    assert!(placed[0].axes[Y] < placed[2].axes[Y]);
}

#[test]
fn an_unpitched_sound_sits_by_its_brightness() {
    let placed = place(&[drum(0.8), drum(0.1), drum(0.5)]);
    assert!(placed[1].axes[Y] < placed[2].axes[Y]);
    assert!(placed[2].axes[Y] < placed[0].axes[Y]);
}

/// Each kind is ranked within itself, so the lowest note and the darkest drum
/// both sit near the floor. In Hz against a spectrum's centre they would be
/// thousands apart, and nearly everything would pile up at one end.
#[test]
fn the_lowest_note_and_the_darkest_drum_share_the_floor() {
    let placed = place(&[note(55.0), note(220.0), note(880.0), drum(0.1), drum(0.5), drum(0.9)]);
    assert!(placed[0].axes[Y] < 0.25, "lowest note at {}", placed[0].axes[Y]);
    assert!(placed[3].axes[Y] < 0.25, "darkest drum at {}", placed[3].axes[Y]);
    assert!(placed[2].axes[Y] > 0.75 && placed[5].axes[Y] > 0.75);
}

#[test]
fn a_noisy_sound_sits_right_of_a_held_note() {
    let placed = place(&[note(220.0), sound(&[("flatness", 0.95)], 0.0, 0.05)]);
    assert!(placed[0].axes[X] < placed[1].axes[X]);
}

#[test]
fn a_long_sound_sits_further_away() {
    let placed = place(&[
        sound(&[("duration", 0.9)], 0.0, 0.0),
        sound(&[("duration", 0.1)], 0.0, 0.0),
    ]);
    assert!(placed[1].axes[Z] < placed[0].axes[Z]);
}

#[test]
fn louder_is_bigger_and_a_pitched_sound_says_so() {
    let placed = place(&[
        sound(&[("loudness", 0.9)], 330.0, 0.95),
        sound(&[("loudness", 0.2)], 0.0, 0.1),
    ]);
    assert!(placed[0].size > placed[1].size);
    assert!(placed[0].pitched && !placed[1].pitched);
}

#[test]
fn a_sharp_punchy_hit_is_crisper_than_a_swell() {
    let placed = place(&[
        sound(&[("attack", 0.05), ("crest", 0.9)], 0.0, 0.0),
        sound(&[("attack", 0.95), ("crest", 0.1)], 0.0, 0.0),
    ]);
    assert!(placed[0].crisp > placed[1].crisp);
}

#[test]
fn only_a_repeating_sound_pulses() {
    let placed = place(&[
        sound(&[("pulse", 0.9), ("density", 0.5)], 0.0, 0.0),
        sound(&[("pulse", 0.1), ("density", 0.5)], 0.0, 0.0),
    ]);
    // Density is onsets per second over 0..12, so 0.5 is six a second.
    assert!((placed[0].pulse_hz - 6.0).abs() < 0.01, "got {}", placed[0].pulse_hz);
    assert_eq!(placed[1].pulse_hz, 0.0);
}

fn gap(a: [f32; 3], b: [f32; 3]) -> f32 {
    (0..3).map(|i| (a[i] - b[i]).powi(2)).sum::<f32>().sqrt()
}

/// The second layout: alike sounds together, whatever their axes say.
#[test]
fn alike_sounds_form_an_island() {
    let mut prints = Vec::new();
    // Two tight families and a loner, among a spread of others.
    for i in 0..5 {
        let d = i as f32 * 0.01;
        prints.push(sound(&[("brightness", 0.1 + d), ("flatness", 0.1), ("duration", 0.2)], 0.0, 0.0));
        prints.push(sound(&[("brightness", 0.9 - d), ("flatness", 0.9), ("duration", 0.8)], 0.0, 0.0));
    }
    for i in 0..10 {
        let t = i as f32 / 9.0;
        prints.push(sound(&[("brightness", t), ("pulse", 1.0 - t), ("low", t * t)], 0.0, 0.0));
    }
    let placed = place(&prints);
    let within = gap(placed[0].islands, placed[2].islands);
    let across = gap(placed[0].islands, placed[1].islands);
    assert!(within * 4.0 < across, "within a family {within:.3}, across {across:.3}");
}

#[test]
fn placement_is_the_same_every_time() {
    let prints: Vec<_> = (0..30)
        .map(|i| {
            let t = i as f32 / 29.0;
            sound(&[("brightness", t), ("duration", 1.0 - t), ("pulse", (t * 7.0).fract())], 0.0, 0.0)
        })
        .collect();
    let a = place(&prints);
    let b = place(&prints);
    for (p, q) in a.iter().zip(&b) {
        assert_eq!(p.axes, q.axes);
        assert_eq!(p.islands, q.islands);
    }
}

#[test]
fn nothing_and_one_are_placed_without_dividing_by_zero() {
    assert!(place(&[]).is_empty());
    let one = place(&[note(440.0)]);
    for c in one[0].axes.iter().chain(one[0].islands.iter()) {
        assert!((c - 0.5).abs() < 1e-6, "a library of one sits in the middle: {:?}", one[0]);
    }
}

#[test]
fn labels_are_grouped_into_families() {
    assert_eq!(family("Snare drum"), "percussion");
    assert_eq!(family("Drum machine"), "percussion");
    assert_eq!(family("Hi-hat"), "percussion");
    assert_eq!(family("Speech"), "voice");
    assert_eq!(family("Chant"), "voice");
    assert_eq!(family("Synthesizer"), "instrument");
    assert_eq!(family("Piano"), "instrument");
    assert_eq!(family("Plucked string instrument"), "instrument");
    assert_eq!(family("Music"), "music");
    assert_eq!(family("Ambient music"), "music");
    assert_eq!(family("Vehicle"), "machine");
    assert_eq!(family("Siren"), "machine");
    assert_eq!(family("Rain"), "nature");
    assert_eq!(family("Heart sounds, heartbeat"), "nature");
    assert_eq!(family(""), "unknown");
    assert_eq!(family("Squeak"), "other");
}

/// One odd sound must not shrink the rest of the library into a corner: the
/// islands are scaled by where most sounds are, and an outlier is held at the
/// edge of the world rather than setting its size.
#[test]
fn one_outlier_does_not_squash_the_islands() {
    let mut prints: Vec<_> = (0..40)
        .map(|i| {
            let t = i as f32 / 39.0;
            sound(&[("brightness", 0.3 + 0.4 * t), ("pulse", 0.6 - 0.3 * t), ("duration", 0.4 + 0.2 * (t * 5.0).fract())], 0.0, 0.0)
        })
        .collect();
    let mut odd = [1.0; DIMS];
    odd[dim("loudness")] = 0.0;
    prints.push(Fingerprint { v: odd, pitch: Pitch::default() });

    let placed = place(&prints);
    let spread = (0..3)
        .map(|k| {
            let (lo, hi) = placed[..40].iter().fold((1f32, 0f32), |(lo, hi), p| (lo.min(p.islands[k]), hi.max(p.islands[k])));
            hi - lo
        })
        .fold(0.0, f32::max);
    assert!(spread > 0.5, "forty sounds squeezed into {spread:.2} of the world by one outlier");
}
