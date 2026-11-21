//! Atmosphere's physically modelled oscillators (ATMOS-PHYS-PLAN.md §5).

mod bench_support;
mod common;
use atmos::{models::MODELS, Synth};
use common::*;

/// Seconds of this thread's own work, where the machine keeps that count.
/// Wall time also counts whatever else the machine is doing — the other tests
/// in this binary run beside the cost test — and GitHub's runner once made
/// one second of bow take 0.554 s that way (20 Nov), 0.571 on a MacBook kept
/// busy. Without a thread clock (Windows) it is wall time, as it was.
#[cfg(unix)]
fn work_now() -> f64 {
    bench_support::cpu_now()
}
#[cfg(not(unix))]
fn work_now() -> f64 {
    static T0: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    T0.get_or_init(std::time::Instant::now).elapsed().as_secs_f64()
}

fn idx(id: &str) -> usize {
    atmos::models::model_index(id).unwrap()
}

/// Each model's pitch where it should be, in 12-TET and in just intervals
/// (275 Hz is 5/4 of 220, 330 Hz 3/2). The string, the bars, bells, glass,
/// drumhead, voice, reed and the analog waves to 2 cents; the bowed string
/// to 5 (the bow pulls it); the blown pipe to 20 (the jet pulls it, as a
/// flute's player does).
#[test]
fn every_model_is_in_tune() {
    let mut bad = Vec::new();
    for (m, d) in MODELS.iter().enumerate() {
        let tol = match d.0 {
            "bow" => 5.0,
            "pipe" => 20.0,
            _ => 2.0,
        };
        for hz in [110.0, 220.0, 275.0, 330.0, 440.0, 880.0, 1760.0] {
            // The drumhead with no tension drop, so it holds one pitch.
            let set: Vec<(&str, f32)> = if d.0 == "membrane" { vec![("a.p0", 0.0)] } else { vec![] };
            let x = note(m, hz, 1.2, 1.2, &set);
            let s = &x[(0.1 * SR) as usize..(1.1 * SR) as usize];
            let c = match d.0 {
                "bow" | "pipe" | "reed" => cents_off(s, hz),
                _ => peak_cents(s, hz),
            };
            if c.abs() > tol {
                bad.push(format!("{} at {hz} Hz: {c:.1} cents", d.0));
            }
        }
    }
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}

/// Any model sits within a factor of two of a sine's level at the same Volume.
#[test]
fn every_model_sits_near_a_sines_level() {
    let level = |m: usize| rms(&note(m, 220.0, 0.6, 0.5, &[]));
    let sine = level(idx("classic"));
    for (m, d) in MODELS.iter().enumerate() {
        let r = level(m) / sine;
        assert!((0.5..2.0).contains(&r), "{}: {r:.2} of a sine", d.0);
    }
}

/// No setting of any control, high or low, makes it blow up or go silent forever.
#[test]
fn no_setting_breaks_any_model() {
    for (m, d) in MODELS.iter().enumerate() {
        for v in [0.0f32, 0.5, 1.0] {
            for k in 0..4 {
                for hz in [40.0, 1760.0, 4200.0] {
                    let key = format!("a.p{k}");
                    let x = note(m, hz, 0.25, 0.4, &[(key.as_str(), v)]);
                    let peak = x.iter().fold(0.0f32, |a, s| a.max(s.abs()));
                    assert!(x.iter().all(|s| s.is_finite()), "{} p{k}={v} at {hz}: not finite", d.0);
                    assert!(peak < 1.5, "{} p{k}={v} at {hz}: peak {peak}", d.0);
                }
            }
        }
    }
}

/// A plucked string rings longer the less it is damped.
#[test]
fn a_string_rings_as_long_as_its_damping_says() {
    let pl = idx("pluck");
    let tail = |damp: f32| {
        let x = note(pl, 220.0, 2.0, 2.0, &[("a.p1", damp)]);
        rms(&x[(1.5 * SR) as usize..]) / rms(&x[..(0.2 * SR) as usize])
    };
    assert!(tail(0.0) > tail(0.8) * 4.0, "{} vs {}", tail(0.0), tail(0.8));
}

/// A metal bar's partials are a free bar's (2.76 × the note), not harmonics.
#[test]
fn a_metal_bar_rings_at_a_bars_ratios() {
    let x = note(idx("bar"), 220.0, 1.0, 1.0, &[("a.p0", 1.0), ("a.p1", 1.0)]);
    let s = &x[..(0.5 * SR) as usize];
    let at_ratio = energy_at(s, 220.0 * 2.756);
    let at_harmonic = energy_at(s, 220.0 * 3.0);
    assert!(at_ratio > at_harmonic * 5.0, "{at_ratio} vs {at_harmonic}");
}

/// A bowed string, a pipe, a reed and a voice sound for as long as they are
/// played, and stop when let go; a struck bar rings on by itself.
#[test]
fn the_sustained_models_sound_while_held_and_stop_when_let_go() {
    for id in ["bow", "pipe", "reed", "voice"] {
        let x = note(idx(id), 220.0, 1.0, 1.6, &[("rel", 0.05)]);
        let held = rms(&x[(0.7 * SR) as usize..(0.95 * SR) as usize]);
        let early = rms(&x[(0.2 * SR) as usize..(0.45 * SR) as usize]);
        let after = rms(&x[(1.3 * SR) as usize..]);
        assert!(held > early * 0.4, "{id}: dies while held ({held} vs {early})");
        assert!(after < held * 0.02, "{id}: goes on after release ({after} vs {held})");
    }
}

/// Sixteen voices of any model render in well under real time natively (the
/// browser's build runs slower; a third of real time leaves it room).
#[test]
fn sixteen_voices_cost_under_a_third_of_real_time() {
    let mut worst = (String::new(), 0.0f32);
    for (m, d) in MODELS.iter().enumerate() {
        let mut s = Synth::new(SR);
        s.set("a.model", m as f32);
        s.set("b.model", m as f32);
        s.set("unison", 1.0);
        s.set("flt.cut", 2000.0);
        for k in 0..16 {
            s.note_on(k, 110.0 * (1.0 + k as f32 * 0.1), 0.8, 0);
        }
        let (mut l, mut r) = (vec![0.0; 128], vec![0.0; 128]);
        let t = work_now();
        for _ in 0..(SR as usize / 128) {
            s.render(&mut l, &mut r);
        }
        let took = (work_now() - t) as f32;
        if took > worst.1 {
            worst = (d.0.to_string(), took);
        }
    }
    assert!(worst.1 < 0.33, "{} took {:.3} s for one second", worst.0, worst.1);
}

/// Its own filter, its LFOs and its glide do what they say.
#[test]
fn the_voice_filter_lfos_and_glide_reach_the_sound() {
    let c = idx("classic");
    let open = rms(&note(c, 440.0, 0.5, 0.5, &[("a.p0", 0.66)]));
    let shut = rms(&note(c, 440.0, 0.5, 0.5, &[("a.p0", 0.66), ("flt.cut", 60.0)]));
    assert!(shut < open * 0.2, "filter: {shut} vs {open}");
    // A square LFO at full depth on volume: loud and quiet by turns.
    let x = note(c, 440.0, 1.0, 1.0, &[("lfo1.target", 3.0), ("lfo1.shape", 3.0), ("lfo1.rate", 4.0), ("lfo1.depth", 1.0)]);
    let blocks: Vec<f32> = x.chunks((0.02 * SR) as usize).map(rms).collect();
    let (lo, hi) = blocks[5..].iter().fold((f32::MAX, 0.0f32), |(a, b), v| (a.min(*v), b.max(*v)));
    assert!(hi > lo * 2.0, "volume LFO: {lo} to {hi}");
    // Glide: the second note starts at the first's pitch.
    let mut s = Synth::new(SR);
    s.set("a.model", c as f32);
    s.set("blend", 0.0);
    s.set("drift", 0.0);
    s.set("glide", 1.0);
    s.note_on(1, 220.0, 0.9, 0);
    let (mut l, mut r) = (vec![0.0; 4800], vec![0.0; 4800]);
    s.render(&mut l, &mut r);
    s.note_on(2, 440.0, 0.9, 0);
    let (mut l2, mut r2) = (vec![0.0; 4800], vec![0.0; 4800]);
    s.render(&mut l2, &mut r2);
    let early: Vec<f32> = l2.iter().zip(&r2).map(|(a, b)| a + b).collect();
    assert!(energy_at(&early, 230.0) > energy_at(&early, 440.0), "no glide");
}
