//! Every control must change the rendered file.
//!
//! Written after "I can't hear freeze, blur or gate in any of the engines",
//! which turned out to be three controls that worked live and did **nothing**
//! to an exported file at ratio 1.0 — because `is_identity()` did not know they
//! existed, so the export short-circuited before the vocoder ever ran.
//!
//! 969 tests did not catch it. Every one of them asked whether a control does
//! the right thing; none asked the prior question, **does this control reach the
//! render at all**. That is a different question and it needs its own sweep,
//! because the failure is not a wrong value — it is a value that never arrives.
//!
//! So: set each control away from its default, render through the same path the
//! export uses, and require the samples to move. One test per engine, so a
//! failure names the engine and the control rather than "something, somewhere".
//!
//! **Ratio 1.0 is tested deliberately.** That is where the bug lived, and it is
//! the default state of every freshly opened sound — the most likely place for a
//! control to be silently inert and the least likely to be tested by hand.

use fx::stretch::{Algorithm, Stretch};

const SR: u32 = 48_000;

/// Material whose spectrum moves.
///
/// A stationary signal is the wrong ruler here and it has already cost time
/// once: Freeze *holds the magnitude spectrum*, so against three constant sines
/// it measured 1.2% of peak and looked broken when it was not. A sweep with
/// harmonics coming and going gives every control something to act on.
fn source(frames: usize, channels: usize) -> Vec<f32> {
    let mut v = Vec::with_capacity(frames * channels);
    for i in 0..frames {
        let t = i as f32 / SR as f32;
        let dur = frames as f32 / SR as f32;
        let f0 = 180.0 + 1600.0 * (t / dur);
        let mut s = (t * f0 * std::f32::consts::TAU).sin() * 0.30;
        s += (t * f0 * 2.0 * std::f32::consts::TAU).sin() * 0.22 * (t * 1.7).sin().abs();
        s += (t * f0 * 3.0 * std::f32::consts::TAU).sin() * 0.16 * (t * 2.9).cos().abs();
        // A few transients, so the transient-preserving controls have edges.
        if i % 9000 < 60 {
            s += 0.5;
        }
        s += ((i * 2654435761) % 1000) as f32 / 1000.0 * 0.04;
        for _ in 0..channels {
            v.push(s);
        }
    }
    v
}

fn base(alg: Algorithm, ratio: f32) -> Stretch {
    let mut s = Stretch::default();
    s.algorithm = alg;
    s.ratio = ratio;
    s
}

/// How far apart two renders are, relative to the signal's own level.
///
/// Length is part of the answer: a control that changes the output length has
/// unmistakably reached the render.
fn moved(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return f32::INFINITY;
    }
    let peak = a.iter().fold(0.0f32, |m, v| m.max(v.abs())).max(1e-6);
    let mut worst = 0.0f32;
    for (x, y) in a.iter().zip(b.iter()) {
        worst = worst.max((x - y).abs());
    }
    worst / peak
}

/// Run one engine's controls and report every one that does not arrive.
/// Controls that legitimately do nothing in a given case, with the reason.
///
/// Every entry here is a claim that has been checked. The list is deliberately
/// explicit rather than a tolerance: "this control is inert here and that is
/// correct" is a statement about the design, and it should have to be written
/// down and defended, not inferred from a threshold.
fn expected_inert(alg: Algorithm, ratio: f32, name: &str) -> Option<&'static str> {
    // At unity a *time* stretcher has nothing to do, and passing the samples
    // through untouched is the right answer — bit-perfect beats re-synthesised.
    // So every control that shapes *how* a stretch is performed has nothing to
    // act on. That is the whole point of `is_identity`.
    //
    // Note what is **not** in this list: `mag_freeze`, `mag_blur` and `mag_gate`.
    // Those are effects rather than stretch settings, they must work at unity,
    // and the fact that they did not is the bug this file was written for.
    let shapes_a_stretch = matches!(name, "window_ms")
        || name.starts_with("wsola.")
        || name.starts_with("pvsola.")
        || matches!(
            name,
            "vocoder.window_ms"
                | "vocoder.phase_lock"
                | "vocoder.freq_trust"
                | "vocoder.phase_spread"
        );
    if ratio == 1.0 && shapes_a_stretch {
        return Some("at unity there is no stretch for this to shape");
    }
    // `window_ms` is the window for WSOLA, the granular engine and the hybrid's
    // WSOLA stage. The vocoder and PVSOLA size their transform from
    // `vocoder.window_ms` and never read this one.
    //
    // **A real finding about the interface, not the DSP.** The standard `Window`
    // row binds to this field and is shown on all five engines as one of the
    // three always-first controls — so on the vocoder and on PVSOLA it is a
    // prominent control that moves nothing. Written down rather than tolerated.
    if name == "window_ms" && matches!(alg, Algorithm::Vocoder | Algorithm::Pvsola) {
        return Some("this engine sizes its window from `vocoder.window_ms`");
    }
    // The cloud *is* the granular engine — `with_cloud` returns the dry signal
    // rather than mixing it over itself. At unity it still registers, because
    // switching it on is what stops the document being an identity at all.
    // The hybrid's separation margin, with both halves summed back at full
    // level, still reconstructs the input — so at unity it has nothing to
    // change. Turn a level down and the separation becomes audible, which is
    // what `remixes_the_parts` now registers.
    if name == "hybrid.margin" && ratio == 1.0 {
        return Some("at full levels the two halves sum back to the input");
    }
    if name == "cloud" && alg == Algorithm::Granular && ratio != 1.0 {
        return Some("the cloud is the granular engine; it is not mixed over itself");
    }
    None
}

fn sweep(alg: Algorithm, ratio: f32, controls: &[(&str, fn(&mut Stretch))]) {
    let channels = 2;
    let src = source(SR as usize, channels);
    let reference = base(alg, ratio).process(&src, channels, SR);

    let mut dead = Vec::new();
    for (name, set) in controls {
        let mut s = base(alg, ratio);
        set(&mut s);
        let out = s.process(&src, channels, SR);
        let d = moved(&reference, &out);
        let inert = !(d > 1e-4);
        match (inert, expected_inert(alg, ratio, name)) {
            (true, None) => dead.push(format!("{name} (moved {d:.2e})")),
            // A control that was supposed to be inert and is not means the
            // reason written above has stopped being true.
            (false, Some(why)) => dead.push(format!(
                "{name} DOES move the render, but is listed as inert because \"{why}\"                  — the exclusion is stale"
            )),
            _ => {}
        }
    }
    assert!(
        dead.is_empty(),
        "{alg:?} at ratio {ratio}: these controls do not reach the render at all \
         — the same class of fault as Freeze/Blur/Gate at unity:\n  {}",
        dead.join("\n  ")
    );
}

/// Controls every engine has.
fn common() -> Vec<(&'static str, fn(&mut Stretch))> {
    vec![
        ("ratio", |s: &mut Stretch| s.ratio *= 1.7),
        ("semitones", |s: &mut Stretch| s.semitones = 5.0),
        ("window_ms", |s: &mut Stretch| s.window_ms = 120.0),
        ("grain.density_hz", |s: &mut Stretch| s.grain.density_hz = 60.0),
        ("grain.overlap", |s: &mut Stretch| s.grain.overlap = 3.0),
        ("grain.size_jitter", |s: &mut Stretch| s.grain.size_jitter = 0.6),
        ("grain.position_jitter_ms", |s: &mut Stretch| s.grain.position_jitter_ms = 200.0),
        ("grain.pitch_jitter_semis", |s: &mut Stretch| s.grain.pitch_jitter_semis = 6.0),
        ("grain.envelope", |s: &mut Stretch| s.grain.envelope = 0.9),
        ("grain.layers", |s: &mut Stretch| s.grain.layers = 3),
        ("grain.reverse", |s: &mut Stretch| s.grain.reverse = true),
        ("cloud", |s: &mut Stretch| { s.cloud = true; s.cloud_mix = 0.8; }),
    ]
}

#[test]
fn wsola_controls_reach_the_render() {
    let mut c = common();
    c.extend::<Vec<(&'static str, fn(&mut Stretch))>>(vec![
        ("wsola.preserve_transients", |s: &mut Stretch| s.wsola.preserve_transients = !s.wsola.preserve_transients),
        ("wsola.search_ms", |s: &mut Stretch| s.wsola.search_ms = 40.0),
        ("wsola.splice", |s: &mut Stretch| s.wsola.splice = fx::stretch::Splice::Different),
    ]);
    sweep(Algorithm::Wsola, 2.0, &c);
    sweep(Algorithm::Wsola, 1.0, &c);
}

#[test]
fn vocoder_controls_reach_the_render() {
    let mut c = common();
    c.extend::<Vec<(&'static str, fn(&mut Stretch))>>(vec![
        ("vocoder.window_ms", |s: &mut Stretch| s.vocoder.window_ms = 120.0),
        ("vocoder.phase_lock", |s: &mut Stretch| s.vocoder.phase_lock = !s.vocoder.phase_lock),
        ("vocoder.freq_trust", |s: &mut Stretch| s.vocoder.freq_trust = 0.3),
        ("vocoder.phase_spread", |s: &mut Stretch| s.vocoder.phase_spread = 0.9),
        ("vocoder.mag_freeze", |s: &mut Stretch| s.vocoder.mag_freeze = 1.0),
        ("vocoder.mag_blur", |s: &mut Stretch| s.vocoder.mag_blur = 1.0),
        ("vocoder.mag_gate", |s: &mut Stretch| s.vocoder.mag_gate = 0.9),
    ]);
    sweep(Algorithm::Vocoder, 2.0, &c);
    // The case that was broken.
    sweep(Algorithm::Vocoder, 1.0, &c);
}

#[test]
fn pvsola_controls_reach_the_render() {
    let mut c = common();
    c.extend::<Vec<(&'static str, fn(&mut Stretch))>>(vec![
        ("pvsola.anchor_frames", |s: &mut Stretch| s.pvsola.anchor_frames = 32),
        ("pvsola.search_ms", |s: &mut Stretch| s.pvsola.search_ms = 40.0),
        ("pvsola.blend", |s: &mut Stretch| s.pvsola.blend = 0.9),
        ("vocoder.mag_blur", |s: &mut Stretch| s.vocoder.mag_blur = 1.0),
        ("vocoder.mag_gate", |s: &mut Stretch| s.vocoder.mag_gate = 0.9),
    ]);
    sweep(Algorithm::Pvsola, 2.0, &c);
    sweep(Algorithm::Pvsola, 1.0, &c);
}

#[test]
fn hybrid_controls_reach_the_render() {
    let mut c = common();
    c.extend::<Vec<(&'static str, fn(&mut Stretch))>>(vec![
        ("hybrid.margin", |s: &mut Stretch| s.hybrid.margin = 4.0),
        ("hybrid.morph_noise", |s: &mut Stretch| s.hybrid.morph_noise = !s.hybrid.morph_noise),
        ("hybrid.harmonic_level", |s: &mut Stretch| s.hybrid.harmonic_level = 0.2),
        ("hybrid.percussive_level", |s: &mut Stretch| s.hybrid.percussive_level = 0.2),
        ("vocoder.mag_blur", |s: &mut Stretch| s.vocoder.mag_blur = 1.0),
        ("vocoder.mag_gate", |s: &mut Stretch| s.vocoder.mag_gate = 0.9),
    ]);
    sweep(Algorithm::Hybrid, 2.0, &c);
    sweep(Algorithm::Hybrid, 1.0, &c);
}

#[test]
fn granular_controls_reach_the_render() {
    let c = common();
    sweep(Algorithm::Granular, 2.0, &c);
    sweep(Algorithm::Granular, 1.0, &c);
}

/// A control that reaches the render must also make the document count as
/// edited — or it is dropped when the file is closed.
///
/// This is the *other* half of the Freeze/Blur/Gate fault, and the half that
/// silently threw away work: `App::save_sessions` forgets any document whose
/// `is_identity()` is true, so a setting that does not register there does not
/// survive the session.
#[test]
fn a_control_that_changes_the_sound_counts_as_edited() {
    let channels = 2;
    let src = source(SR as usize / 2, channels);

    let mut dead = Vec::new();
    for alg in [
        Algorithm::Wsola,
        Algorithm::Vocoder,
        Algorithm::Pvsola,
        Algorithm::Hybrid,
        Algorithm::Granular,
    ] {
        let reference = base(alg, 1.0).process(&src, channels, SR);
        for (name, set) in common().iter().chain(
            [
                ("vocoder.mag_freeze", (|s: &mut Stretch| s.vocoder.mag_freeze = 1.0) as fn(&mut Stretch)),
                ("vocoder.mag_blur", |s: &mut Stretch| s.vocoder.mag_blur = 1.0),
                ("vocoder.mag_gate", |s: &mut Stretch| s.vocoder.mag_gate = 0.9),
            ]
            .iter(),
        ) {
            let mut s = base(alg, 1.0);
            set(&mut s);
            let changed = moved(&reference, &s.process(&src, channels, SR)) > 1e-4;
            if changed && s.is_identity() {
                dead.push(format!("{alg:?} / {name}"));
            }
        }
    }
    assert!(
        dead.is_empty(),
        "these change the sound but report `is_identity()` — the export skips \
         them and the session forgets them:\n  {}",
        dead.join("\n  ")
    );
}
