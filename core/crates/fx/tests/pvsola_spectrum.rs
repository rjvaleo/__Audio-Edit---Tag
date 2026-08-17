//! Do the vocoder's spectrum controls reach PVSOLA?
//!
//! PVSOLA *is* the vocoder between anchors, so Freeze, Blur and Gate are on its
//! panel. A control that is shown and does nothing is the same bug as one that
//! does something it should not, and harder to notice.

use fx::stretch::{Algorithm, Stretch};

fn source(frames: usize, channels: usize) -> Vec<f32> {
    // A chord: several partials, which is what the spectrum controls act on.
    let mut v = Vec::with_capacity(frames * channels);
    for i in 0..frames {
        let t = i as f32 / 48_000.0;
        let s = (t * 220.0 * std::f32::consts::TAU).sin() * 0.3
            + (t * 277.0 * std::f32::consts::TAU).sin() * 0.25
            + (t * 330.0 * std::f32::consts::TAU).sin() * 0.2;
        for _ in 0..channels {
            v.push(s);
        }
    }
    v
}

fn render(spec: &Stretch, src: &[f32], channels: usize) -> Vec<f32> {
    spec.process(src, channels, 48_000)
}

fn difference(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    if n == 0 {
        return 0.0;
    }
    a[..n].iter().zip(&b[..n]).map(|(x, y)| (x - y).abs()).sum::<f32>() / n as f32
}

#[test]
fn freeze_blur_and_gate_reach_pvsola() {
    let channels = 2;
    let src = source(48_000, channels);

    let mut base = Stretch::default();
    base.algorithm = Algorithm::Pvsola;
    base.ratio = 3.0;
    let plain = render(&base, &src, channels);

    let cases: Vec<(&str, Box<dyn Fn(&mut Stretch)>)> = vec![
        ("Freeze", Box::new(|s: &mut Stretch| s.vocoder.mag_freeze = 0.9)),
        ("Blur", Box::new(|s: &mut Stretch| s.vocoder.mag_blur = 0.8)),
        ("Gate", Box::new(|s: &mut Stretch| s.vocoder.mag_gate = 0.3)),
    ];

    let mut dead = Vec::new();
    for (name, apply) in cases {
        let mut s = base;
        apply(&mut s);
        let d = difference(&plain, &render(&s, &src, channels));
        println!("{name}: mean difference {d:.9}");
        if d <= 1e-6 {
            dead.push(format!("{name} (difference {d:.9})"));
        }
    }
    assert!(
        dead.is_empty(),
        "these are on the PVSOLA panel and do not reach its audio: {}",
        dead.join(", "),
    );
}

/// Freeze is connected but nearly silent at the default anchor rate.
///
/// Measured on a 1 s chord at 3x, mean absolute difference against the same
/// render with the control at its default:
///
///   Blur   0.267
///   Gate   0.029
///   Freeze 0.0015   ← about 180x weaker than Blur
///
/// So the user reporting "Freeze does nothing on PVSOLA" is reporting something
/// real. It is not disconnected — the test above proves it reaches the audio —
/// it is that the effect is too small to hear at `anchor_frames = 6`.
///
/// The cause is **not** simply that a short anchor gives freeze no time to
/// accumulate, which was the obvious guess and is wrong. Measured across anchor
/// lengths the effect is not monotonic at all:
///
///   anchor  6 → 0.0015
///   anchor 16 → 0.2549
///   anchor 32 → 0.0013
///   anchor 64 → 0.0013
///
/// Sixteen is two orders of magnitude louder than either side of it. Something
/// conditional is happening rather than something gradual, and finding it is
/// the next piece of work here. `pvsola::stretch` falls back to the plain
/// vocoder when the input is too short for one anchored segment, but the source
/// used here clears that bar at every anchor length tested, so the fallback is
/// not the explanation either.
///
/// Pinned so the numbers are recorded and a change to them is noticed.
#[test]
fn freeze_is_measurably_weak_at_the_default_anchor() {
    let channels = 2;
    let src = source(48_000, channels);
    let mut base = Stretch::default();
    base.algorithm = Algorithm::Pvsola;
    base.ratio = 3.0;
    let plain = render(&base, &src, channels);

    let mut frozen = base;
    frozen.vocoder.mag_freeze = 0.9;
    let freeze = difference(&plain, &render(&frozen, &src, channels));

    let mut blurred = base;
    blurred.vocoder.mag_blur = 0.8;
    let blur = difference(&plain, &render(&blurred, &src, channels));

    println!("freeze {freeze:.6} against blur {blur:.6}");
    // Both reach the audio.
    assert!(freeze > 1e-6, "Freeze does not reach PVSOLA at all");
    // And Freeze is the weak one. If this ever stops being true the control has
    // been fixed and this test should be replaced with one that says so.
    assert!(
        freeze < blur / 10.0,
        "Freeze is no longer far weaker than Blur ({freeze:.6} vs {blur:.6}) —          if it was fixed, update this test",
    );
}
