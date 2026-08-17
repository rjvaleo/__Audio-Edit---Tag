//! Do Freeze, Blur and Gate reach the sound — live, not just offline?
//!
//! Reported as "I can't hear freeze, blur or gate in any of the engines". The
//! offline render and the live engine are different code paths; the ear only
//! ever hears the live one.

use fx::stream::{StretchParams, Streamer};
use fx::vstream::VocoderStream;

const SR: u32 = 48_000;

/// A source whose **spectrum moves**, which is the whole point.
///
/// The first version of this was three constant sines. Blur and Gate measured
/// strongly against it and Freeze measured 1.2% of peak — and I nearly reported
/// Freeze as broken on the strength of that. It is not: *Freeze holds the
/// magnitude spectrum where it is*, and on material whose spectrum never moves
/// there is by definition nothing to hold. The test was asking a question the
/// signal could not answer.
///
/// So: a sweep, plus harmonics that come and go. Now all three controls have
/// something to act on and the measurement means what it says.
fn source(frames: usize, channels: usize) -> Vec<f32> {
    let mut v = Vec::with_capacity(frames * channels);
    for i in 0..frames {
        let t = i as f32 / SR as f32;
        let dur = frames as f32 / SR as f32;
        // A rising sweep: every frame's spectrum is somewhere new.
        let f0 = 180.0 + 1600.0 * (t / dur);
        let mut s = (t * f0 * std::f32::consts::TAU).sin() * 0.30;
        // Harmonics that fade in and out at different rates, so the *shape* of
        // the spectrum changes as well as its position.
        s += (t * f0 * 2.0 * std::f32::consts::TAU).sin() * 0.22 * (t * 1.7).sin().abs();
        s += (t * f0 * 3.0 * std::f32::consts::TAU).sin() * 0.16 * (t * 2.9).cos().abs();
        s += ((i * 2654435761) % 1000) as f32 / 1000.0 * 0.05;
        for _ in 0..channels {
            v.push(s);
        }
    }
    v
}

fn params() -> StretchParams {
    let mut sp = StretchParams {
        ratio: 2.0,
        window_ms: 40.0,
        sample_rate: SR,
        wsola: Default::default(),
        vocoder: Default::default(),
        grain: Default::default(),
    };
    sp.vocoder.window_ms = 46.0;
    sp
}

/// Render through the live streaming vocoder.
fn live(sp: &StretchParams, src: &[f32], channels: usize) -> Vec<f32> {
    let block = 1024;
    let mut s = VocoderStream::new(block, channels);
    s.seek(0, src.len() / channels, sp);
    let mut out = vec![0.0f32; block * channels];
    let mut all = Vec::new();
    for _ in 0..60 {
        s.render(&mut out, channels, src, sp);
        all.extend_from_slice(&out);
    }
    all
}

fn difference(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    let mut worst = 0.0f32;
    for i in 0..n {
        worst = worst.max((a[i] - b[i]).abs());
    }
    worst
}

/// Each control, on its own, must change what comes out of the live engine.
#[test]
fn freeze_blur_and_gate_all_reach_the_live_engine() {
    let channels = 2;
    let src = source(SR as usize * 2, channels);
    let base = live(&params(), &src, channels);

    let mut report = Vec::new();
    for name in ["freeze", "blur", "gate"] {
        let mut sp = params();
        match name {
            "freeze" => sp.vocoder.mag_freeze = 1.0,
            "blur" => sp.vocoder.mag_blur = 1.0,
            _ => sp.vocoder.mag_gate = 0.9,
        }
        let other = live(&sp, &src, channels);
        let d = difference(&base, &other);
        report.push(format!("{name} at full changes the output by {d:.6}"));
        assert!(
            d > 1e-3,
            "{name} at full changes the live output by {d} — inaudible.\nall: {report:?}",
        );
    }
    println!("{}", report.join("\n"));
}

/// And they must be *usefully* different from each other in strength.
///
/// A control that technically moves a sample but needs a microscope is a
/// control nobody can hear, which is the actual complaint.
#[test]
fn each_control_is_strong_enough_to_hear() {
    let channels = 2;
    let src = source(SR as usize * 2, channels);
    let base = live(&params(), &src, channels);
    let peak = base.iter().fold(0.0f32, |m, v| m.max(v.abs())).max(1e-9);

    for name in ["freeze", "blur", "gate"] {
        let mut sp = params();
        match name {
            "freeze" => sp.vocoder.mag_freeze = 1.0,
            "blur" => sp.vocoder.mag_blur = 1.0,
            _ => sp.vocoder.mag_gate = 0.9,
        }
        let other = live(&sp, &src, channels);
        let rel = difference(&base, &other) / peak;
        println!("  {name}: {:.1}% of peak", rel * 100.0);
        assert!(
            rel > 0.05,
            "{name} at full moves the output by {:.3}% of peak — that is not audible",
            rel * 100.0,
        );
    }
}

/// At unity, does the offline render still hear these controls?
///
/// `Stretch::is_identity()` tests ratio, semitones, the grain settings and the
/// cloud — and **not** the vocoder's own controls. So a document at ratio 1.0
/// with Blur wound to full short-circuits to the input untouched, and three
/// controls on the panel do nothing at all with no indication of why.
#[test]
fn at_unity_the_spectrum_controls_still_do_something() {
    let channels = 2;
    let src = source(SR as usize, channels);

    let mut dry = fx::Stretch::default();
    dry.algorithm = fx::stretch::Algorithm::Vocoder;
    dry.ratio = 1.0;
    dry.semitones = 0.0;

    let base = dry.process(&src, channels, SR);

    for (name, set) in [
        ("blur", 1usize),
        ("gate", 2),
        ("freeze", 3),
    ] {
        let mut s = dry;
        match set {
            1 => s.vocoder.mag_blur = 1.0,
            2 => s.vocoder.mag_gate = 0.9,
            _ => s.vocoder.mag_freeze = 1.0,
        }
        let other = s.process(&src, channels, SR);
        let d = difference(&base, &other);
        println!("  at ratio 1.0, {name} changes the render by {d:.6}");
        assert!(
            d > 1e-3,
            "at ratio 1.0 with {name} at full the render is unchanged ({d}) — \
             `is_identity` short-circuits before the vocoder ever runs, and the \
             control silently does nothing",
        );
    }
}

/// And live, at unity? The live engine has no identity shortcut of its own.
///
/// This is the one that says whether the bug is "the export is deaf to these
/// controls" or "everything is". They are different bugs with different fixes,
/// and guessing which would have been the third mistake in this investigation.
#[test]
fn at_unity_the_live_engine_still_hears_them() {
    let channels = 2;
    let src = source(SR as usize, channels);
    let mut sp = params();
    sp.ratio = 1.0;

    let base = live(&sp, &src, channels);
    let peak = base.iter().fold(0.0f32, |m, v| m.max(v.abs())).max(1e-9);

    for name in ["freeze", "blur", "gate"] {
        let mut s = sp;
        match name {
            "freeze" => s.vocoder.mag_freeze = 1.0,
            "blur" => s.vocoder.mag_blur = 1.0,
            _ => s.vocoder.mag_gate = 0.9,
        }
        let d = difference(&base, &live(&s, &src, channels)) / peak;
        println!("  live at ratio 1.0, {name}: {:.1}% of peak", d * 100.0);
        assert!(d > 0.05, "live at unity, {name} does nothing ({:.3}%)", d * 100.0);
    }
}
