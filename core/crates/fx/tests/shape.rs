//! What each shaping effect must actually do to a sound.
//!
//! Every one of these is a rack effect, so three things hold for all of them
//! before anything specific to what they are: the buffer keeps its length, the
//! output stays finite, and nothing runs away. Those are asserted once, for all
//! of them, and then each gets a test of the thing it is *for* — because "it
//! changed the audio" is true of a bug as well.

use fx::params::Params;
use fx::shape::*;
use fx::Effect;

const SR: u32 = 48_000;

fn tone(secs: f32, hz: f32, channels: usize) -> Vec<f32> {
    let n = (SR as f32 * secs) as usize;
    let mut v = Vec::with_capacity(n * channels);
    for i in 0..n {
        let s = 0.5 * (std::f32::consts::TAU * hz * i as f32 / SR as f32).sin();
        for c in 0..channels {
            v.push(if c == 0 { s } else { s * 0.5 });
        }
    }
    v
}

/// Loud bursts with quiet between them, which is what a gate and a follower
/// are for.
fn bursts(secs: f32, channels: usize) -> Vec<f32> {
    let n = (SR as f32 * secs) as usize;
    let mut seed = 7u32;
    let mut v = Vec::with_capacity(n * channels);
    for i in 0..n {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        let noise = ((seed >> 16) as f32 / 32768.0) - 1.0;
        let loud = (i / 4800) % 2 == 0;
        let s = noise * if loud { 0.5 } else { 0.002 };
        for c in 0..channels {
            // Decorrelated, or anything working on the sides has nothing to
            // work on and reports itself dead.
            v.push(if c == 0 { s } else { s * 0.4 + noise * 0.05 });
        }
    }
    v
}

fn rms(v: &[f32]) -> f32 {
    (v.iter().map(|x| x * x).sum::<f32>() / v.len().max(1) as f32).sqrt()
}
fn peak(v: &[f32]) -> f32 {
    v.iter().fold(0f32, |m, x| m.max(x.abs()))
}

/// Run one in blocks, as the rack does.
fn run(fx: &mut dyn Effect, input: &[f32], channels: usize, block: usize) -> Vec<f32> {
    let mut out = input.to_vec();
    for c in out.chunks_mut(block * channels) {
        fx.process(c, channels, SR);
    }
    out
}

fn all() -> Vec<Box<dyn Effect>> {
    vec![
        Box::new(Invert),
        Box::new(SwapChannels),
        Box::new(Width { width: 1.8 }),
        Box::new(DcOffset::default()),
        Box::new(RingMod::default()),
        Box::new(Rappify::default()),
        Box::new(ReverseMix::new(SR, 2)),
        Box::new(AmplitudeFit::default()),
        Box::new(Gate::default()),
    ]
}

#[test]
fn every_effect_keeps_the_length_and_stays_finite() {
    let src = bursts(0.5, 2);
    for mut fx in all() {
        let out = run(fx.as_mut(), &src, 2, 512);
        let name = fx.name();
        assert_eq!(out.len(), src.len(), "{name} changed the buffer length");
        assert!(out.iter().all(|v| v.is_finite()), "{name} produced non-finite samples");
        assert!(peak(&out) < 8.0, "{name} ran away: peak {:.2}", peak(&out));
    }
}

/// Block size must not change the sound. Every one of these carries state
/// between calls, and a state machine that depends on how often it is asked is
/// one that sounds different on a different sound card.
#[test]
fn no_effect_depends_on_the_block_size() {
    let src = bursts(0.4, 2);
    for (mut a, mut b) in all().into_iter().zip(all()) {
        let name = a.name();
        let x = run(a.as_mut(), &src, 2, 64);
        let y = run(b.as_mut(), &src, 2, 1024);
        let worst = x.iter().zip(&y).map(|(p, q)| (p - q).abs()).fold(0f32, f32::max);
        assert!(worst < 1e-5, "{name} depends on the block size: {worst:.2e}");
    }
}

/// Reset must actually put one back. The rack calls it before a render that
/// does not continue the last one, and a filter that keeps its memory across
/// that makes the first moment of a render depend on the render before it.
#[test]
fn reset_returns_every_effect_to_where_it_started() {
    let src = bursts(0.2, 2);
    for (mut a, mut b) in all().into_iter().zip(all()) {
        let name = a.name();
        let first = run(a.as_mut(), &src, 2, 256);
        let _ = run(a.as_mut(), &src, 2, 256);
        a.reset();
        let again = run(a.as_mut(), &src, 2, 256);
        let fresh = run(b.as_mut(), &src, 2, 256);
        assert_eq!(first, fresh, "{name} is not deterministic from a clean start");
        let worst = again.iter().zip(&fresh).map(|(p, q)| (p - q).abs()).fold(0f32, f32::max);
        assert!(worst < 1e-6, "{name} kept state across a reset: {worst:.2e}");
    }
}

// ------------------------------------------------------- what each is for

#[test]
fn invert_flips_polarity_and_nothing_else() {
    let src = tone(0.1, 440.0, 2);
    let out = run(&mut Invert, &src, 2, 256);
    for (a, b) in src.iter().zip(&out) {
        assert_eq!(*b, -*a);
    }
}

#[test]
fn swap_moves_left_to_right() {
    let src = tone(0.05, 440.0, 2);
    let out = run(&mut SwapChannels, &src, 2, 256);
    for i in (0..src.len()).step_by(2) {
        assert_eq!(out[i], src[i + 1]);
        assert_eq!(out[i + 1], src[i]);
    }
    // A mono signal has nothing to swap and must be untouched.
    let mono = tone(0.05, 440.0, 1);
    assert_eq!(run(&mut SwapChannels, &mono, 1, 256), mono);
}

/// Zero collapses to the middle; past one the sides grow. Measured on the
/// difference between the channels, which is what "width" means.
#[test]
fn width_collapses_and_widens_the_sides() {
    let src = tone(0.1, 440.0, 2);
    let side = |v: &[f32]| -> f32 {
        rms(&v.chunks(2).map(|f| (f[0] - f[1]) * 0.5).collect::<Vec<_>>())
    };
    let was = side(&src);
    assert!(side(&run(&mut Width { width: 0.0 }, &src, 2, 256)) < was * 0.01, "did not collapse");
    let wide = side(&run(&mut Width { width: 2.0 }, &src, 2, 256));
    assert!(wide > was * 1.8, "did not widen: {wide:.4} against {was:.4}");
    // And at one it is inert — to float precision, which is what a mid/side
    // round trip can promise. `(l+r)/2 + (l-r)/2` is exactly `l` on paper.
    let flat = run(&mut Width { width: 1.0 }, &src, 2, 256);
    let worst = flat.iter().zip(&src).map(|(a, b)| (a - b).abs()).fold(0f32, f32::max);
    assert!(worst < 1e-6, "width of one was not inert: {worst:.2e}");
}

#[test]
fn the_dc_filter_removes_an_offset_and_leaves_the_tone() {
    let mut src = tone(0.5, 440.0, 1);
    for s in src.iter_mut() {
        *s += 0.3;
    }
    let out = run(&mut DcOffset::default(), &src, 1, 256);
    // Past the filter's own settling time.
    let tail = &out[SR as usize / 4..];
    let mean = tail.iter().sum::<f32>() / tail.len() as f32;
    assert!(mean.abs() < 0.01, "the offset survived: mean {mean:.4}");
    assert!(rms(tail) > 0.3, "it took the tone with it: {:.3}", rms(tail));
}

/// Ring modulation puts sum and difference tones where the original was and
/// leaves nothing of either — that is the whole character of it.
#[test]
fn ring_modulation_moves_the_energy_off_the_original_pitch() {
    let src = tone(0.5, 1000.0, 1);
    let mut fx = RingMod::default();
    fx.set("hz", 300.0);
    fx.set("mix", 1.0);
    let out = run(&mut fx, &src, 1, 256);

    let at = |v: &[f32], hz: f32| -> f32 {
        let n = 8192;
        let w = audio_core::fft::hann(n);
        let mut re: Vec<f32> = (0..n).map(|i| v[SR as usize / 8 + i] * w[i]).collect();
        let mut im = vec![0f32; n];
        audio_core::fft::fft(&mut re, &mut im);
        let k = (hz * n as f32 / SR as f32).round() as usize;
        (re[k] * re[k] + im[k] * im[k]).sqrt()
    };
    assert!(at(&out, 1000.0) < at(&src, 1000.0) * 0.1, "the carrier survived");
    assert!(at(&out, 700.0) > at(&src, 700.0) * 20.0, "no difference tone at 700 Hz");
    assert!(at(&out, 1300.0) > at(&src, 1300.0) * 20.0, "no sum tone at 1300 Hz");
}

/// Rappify is a band-pass that follows the envelope, so what comes out of
/// broadband material is narrower than what went in.
#[test]
fn rappify_narrows_the_spectrum() {
    let src = bursts(0.5, 1);
    let out = { let mut r = Rappify::default(); r.set("amount", 1.0); run(&mut r, &src, 1, 256) };
    let spread = |v: &[f32]| -> f32 {
        let n = 8192;
        let w = audio_core::fft::hann(n);
        let mut re: Vec<f32> = (0..n).map(|i| v[4800 + i] * w[i]).collect();
        let mut im = vec![0f32; n];
        audio_core::fft::fft(&mut re, &mut im);
        let mag: Vec<f32> = (1..n / 2).map(|k| (re[k] * re[k] + im[k] * im[k]).sqrt()).collect();
        let total: f32 = mag.iter().sum();
        if total <= 1e-9 {
            return 0.0;
        }
        // Where the energy sits, as a share of the band it could occupy.
        let centre: f32 = mag.iter().enumerate().map(|(k, m)| k as f32 * m).sum::<f32>() / total;
        (mag.iter().enumerate().map(|(k, m)| (k as f32 - centre).powi(2) * m).sum::<f32>()
            / total)
            .sqrt()
    };
    assert!(
        // Measured at 0.82 with the amount at full. Stated rather than
        // rounded down to something that looks better.
        spread(&out) < spread(&src) * 0.85,
        "rappify did not narrow anything: {:.0} against {:.0}",
        spread(&out),
        spread(&src)
    );
    assert!(rms(&out) > 1e-4, "rappify silenced it");
}

/// The point of the live version: what comes back is the recent past, in
/// reverse. Measured by correlating the output against the input reversed.
#[test]
fn the_boomerang_plays_the_recent_past_backwards() {
    let src = bursts(1.0, 1);
    let mut fx = ReverseMix::new(SR, 1);
    fx.set("throwMs", 200.0);
    fx.set("mix", 1.0);
    let out = run(&mut fx, &src, 1, 256);

    let at = SR as usize / 2;
    let win = 2000;
    let a = &out[at..at + win];
    // What should be arriving is the source *from here backwards*. Comparing
    // against a window a throw earlier is a different claim and the first
    // version of this test made it — the reversal is measured from the moment
    // the pass begins, not from the far end of the buffer.
    let b: Vec<f32> = (0..win).map(|i| src[at - i]).collect();
    let dot: f32 = a.iter().zip(&b).map(|(x, y)| x * y).sum();
    let corr = dot / (rms(a) * rms(&b) * win as f32 + 1e-12);
    assert!(corr > 0.5, "nothing reversed came back: correlation {corr:.3}");
}

/// Amplitude fit brings quiet passages up to meet loud ones — so the spread
/// between them narrows, which is the whole effect.
#[test]
fn amplitude_fit_flattens_loud_against_quiet() {
    let src = bursts(1.0, 1);
    let out = {
        let mut a = AmplitudeFit::default();
        a.set("amount", 1.0);
        // Below its floor a quiet stretch is treated as silence and left
        // alone, which is the floor doing its job. The quiet here is -54 dB,
        // so the floor has to be under that for this to be a test of the fit
        // rather than a test of the floor.
        a.set("floorDb", -80.0);
        run(&mut a, &src, 1, 256)
    };
    // Loud runs 0..4800 and quiet 4800..9600, so measure inside each rather
    // than across the edge where the follower is still moving.
    let span = |v: &[f32]| -> f32 {
        let loud = rms(&v[2000..4600]);
        let quiet = rms(&v[6800..9400]);
        loud / quiet.max(1e-9)
    };
    assert!(
        span(&out) < span(&src) * 0.5,
        "nothing was flattened: {:.1} against {:.1}",
        span(&out),
        span(&src)
    );
}

#[test]
fn the_gate_shuts_below_the_threshold_and_opens_above_it() {
    let src = bursts(1.0, 1);
    let mut fx = Gate::default();
    fx.set("thresholdDb", -30.0);
    fx.set("attackMs", 1.0);
    fx.set("releaseMs", 20.0);
    let out = run(&mut fx, &src, 1, 256);
    // Well inside each stretch, past the attack and release.
    let loud_in = rms(&src[1500..4600]);
    let loud_out = rms(&out[1500..4600]);
    // Late in the quiet stretch, past several release constants — measuring
    // while the gate is still closing measures the release, not the gate.
    let quiet_out = rms(&out[8600..9500]);
    assert!(loud_out > loud_in * 0.7, "the gate shut on the loud part");
    // Measured at 2e-4 against an input of 1.2e-3, which is the gate at full
    // depth after several release constants. Stated rather than wished for.
    assert!(
        quiet_out < rms(&src[8600..9500]) * 0.25,
        "the gate did not close: {quiet_out:.2e}"
    );
}

// ------------------------------------------------- the modulation contract

/// Every parameter has to be readable, writable and bounded by its own spec.
/// This is what automation will drive, so a parameter that does not answer here
/// is one nothing can ever move.
#[test]
fn every_parameter_can_be_read_written_and_bounded() {
    fn check(p: &mut dyn Params, name: &str) {
        for s in p.specs() {
            assert!(p.get(s.key).is_some(), "{name}: {} cannot be read", s.key);
            assert!(p.set(s.key, s.default), "{name}: {} cannot be written", s.key);

            p.set(s.key, 1e9);
            let hi = p.get(s.key).unwrap();
            assert!(hi <= s.max, "{name}: {} went past its maximum ({hi})", s.key);
            p.set(s.key, -1e9);
            let lo = p.get(s.key).unwrap();
            assert!(lo >= s.min, "{name}: {} went below its minimum ({lo})", s.key);

            p.set(s.key, f32::NAN);
            assert!(
                p.get(s.key).unwrap().is_finite(),
                "{name}: {} accepted a NaN",
                s.key
            );

            assert!(p.spec(s.key).is_some(), "{name}: {} has no spec", s.key);
        }
        assert!(!p.set("nonsense", 1.0), "{name} accepted a key it does not have");
        assert!(p.get("nonsense").is_none(), "{name} answered for a key it does not have");
    }

    check(&mut Width::default(), "Width");
    check(&mut DcOffset::default(), "DC");
    check(&mut RingMod::default(), "Ring");
    check(&mut Rappify::default(), "Rappify");
    check(&mut ReverseMix::new(SR, 2), "Boomerang");
    check(&mut AmplitudeFit::default(), "Fit");
    check(&mut Gate::default(), "Gate");
}

/// Moving a parameter has to reach the audio. A control that reads back what
/// you wrote and changes nothing is the same defect as one that does not
/// store it, and harder to see.
#[test]
fn every_parameter_reaches_the_audio() {
    let src = bursts(0.3, 2);

    /// Built through `Params::set`, which is the path automation will use —
    /// so this checks the control and its wiring together rather than the
    /// struct field behind it.
    fn moved<E>(name: &str, key: &str, a: f32, b: f32, mut mk: impl FnMut() -> E)
    where
        E: Effect + Params + 'static,
    {
        let src = bursts(0.3, 2);
        let mut x = mk();
        let mut y = mk();
        assert!(x.set(key, a), "{name}: {key} is not a key it has");
        assert!(y.set(key, b), "{name}: {key} is not a key it has");
        let p = run(&mut x, &src, 2, 256);
        let q = run(&mut y, &src, 2, 256);
        let d: f32 = p.iter().zip(&q).map(|(m, n)| (m - n).abs()).sum::<f32>() / p.len() as f32;
        assert!(d > 1e-6, "{name}: {key} did not reach the audio");
    }

    moved("Width", "width", 0.2, 1.9, Width::default);
    moved("DC", "hz", 1.0, 60.0, DcOffset::default);
    moved("Ring", "hz", 80.0, 3000.0, RingMod::default);
    moved("Ring", "mix", 0.0, 1.0, RingMod::default);
    moved("Ring", "sweep", 0.0, 800.0, RingMod::default);
    moved("Rappify", "amount", 0.1, 1.0, Rappify::default);
    moved("Rappify", "hz", 100.0, 4000.0, Rappify::default);
    moved("Rappify", "speed", 2.0, 180.0, Rappify::default);
    moved("Fit", "grainMs", 8.0, 400.0, AmplitudeFit::default);
    moved("Fit", "amount", 0.1, 1.0, AmplitudeFit::default);
    moved("Gate", "thresholdDb", -70.0, -10.0, Gate::default);
    moved("Gate", "depth", 0.1, 1.0, Gate::default);
    moved("Boomerang", "mix", 0.0, 1.0, || ReverseMix::new(SR, 2));
    moved("Boomerang", "throwMs", 40.0, 900.0, || {
        let mut e = ReverseMix::new(SR, 2);
        e.mix = 1.0;
        e
    });
    let _ = src;
}

/// Parameters may be written every block once automation exists, so writing one
/// must not be expensive and must not throw the effect's state away.
#[test]
fn writing_a_parameter_every_block_does_not_disturb_the_sound() {
    let src = bursts(0.3, 2);
    let mut steady = Rappify::default();
    let a = run(&mut steady, &src, 2, 256);

    let mut poked = Rappify::default();
    let mut out = src.clone();
    for c in out.chunks_mut(256 * 2) {
        // The same value, written again. Nothing should move.
        poked.set("amount", poked.get("amount").unwrap());
        poked.set("hz", poked.get("hz").unwrap());
        poked.process(c, 2, SR);
    }
    let worst = a.iter().zip(&out).map(|(x, y)| (x - y).abs()).fold(0f32, f32::max);
    assert!(worst < 1e-9, "rewriting a parameter disturbed the state: {worst:.2e}");
}
