//! Effects from `prism-fx`, as this program drives them: through `Effect` and
//! `Params`, interleaved, a block at a time.
//!
//! The Echo parity test is the gate SHARED-FX.md sets for retiring this
//! program's own Echo: the prism Echo, run through the adapter, has to render
//! what `fx::dattorro::Echo` renders, bit for bit, before documents that use
//! Echo are moved onto it. The old Echo stays in `dattorro.rs` as the
//! reference this test holds the new one to; the rack no longer builds it.

use fx::params::Params;
use fx::prism::{self, PrismEffect};
use fx::Effect;

const SR: u32 = 48_000;

/// A click, then tones and noise, different on each side.
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
            match (n / 5_000) % 3 {
                0 => ((t * 440.0 * std::f32::consts::TAU).sin() * 0.5, (t * 660.0 * std::f32::consts::TAU).sin() * 0.4),
                1 => (noise * 0.3, -noise * 0.2),
                _ => (0.0, 0.0),
            }
        };
        out.push(l);
        if channels > 1 {
            out.push(r);
        }
        for _ in 2..channels {
            out.push(0.25);
        }
    }
    out
}

/// A move: before block `at`, set `key` to `value`.
type Move = (usize, &'static str, f32);

fn render(e: &mut dyn Effect, input: &[f32], channels: usize, block: usize, moves: &[Move]) -> Vec<f32> {
    let mut out = input.to_vec();
    for (i, chunk) in out.chunks_mut(block * channels).enumerate() {
        for &(at, key, value) in moves {
            if at == i {
                assert!(e.set_param(key, value), "no {key}");
            }
        }
        e.process(chunk, channels, SR);
    }
    out
}

/// Wrapped as the rack wrapped it, so moves reach it through `Effect`.
fn old_echo(channels: usize, settings: &[(&str, f32)]) -> fx::Driven<fx::dattorro::Echo> {
    let mut e = fx::dattorro::Echo::new(SR, channels);
    for &(k, v) in settings {
        assert!(Params::set(&mut e, k, v), "no {k}");
    }
    fx::Driven(e)
}

fn new_echo(settings: &[(&str, f32)]) -> PrismEffect {
    let mut e = PrismEffect::new("echo", SR).expect("echo is in the catalogue");
    for &(k, v) in settings {
        assert!(Params::set(&mut e, k, v), "no {k}");
    }
    e
}

fn first_difference(a: &[f32], b: &[f32]) -> Option<(usize, f32, f32)> {
    a.iter().zip(b).position(|(x, y)| x.to_bits() != y.to_bits()).map(|i| (i, a[i], b[i]))
}

// ---------------------------------------------------------------- Echo parity

#[test]
fn the_prism_echo_renders_exactly_what_this_programs_echo_did() {
    let scenarios: &[(&str, &[(&str, f32)], &[Move])] = &[
        ("defaults", &[], &[]),
        (
            "short, dark, negative feedback",
            &[("delayMs", 3.7), ("feedback", -0.9), ("damping", 0.7), ("wet", 1.0), ("dry", 0.0)],
            &[],
        ),
        ("longest and fullest", &[("delayMs", 4_000.0), ("feedback", 0.98), ("damping", 0.0)], &[]),
        (
            "delay moves glide",
            &[("delayMs", 200.0), ("glideMs", 200.0)],
            &[(40, "delayMs", 400.0), (90, "delayMs", 37.0)],
        ),
        ("no glide jumps", &[("glideMs", 0.0), ("delayMs", 100.0)], &[(20, "delayMs", 300.0)]),
        (
            "glide changed mid-move",
            &[("delayMs", 1_000.0), ("glideMs", 4_000.0)],
            &[(20, "delayMs", 10.0), (40, "glideMs", 50.0)],
        ),
    ];
    for &(name, settings, moves) in scenarios {
        for channels in [2, 1] {
            for block in [512, 64, 1_000] {
                let input = source(SR as usize * 5 / 2, channels);
                let was = render(&mut old_echo(channels, settings), &input, channels, block, moves);
                let now = render(&mut new_echo(settings), &input, channels, block, moves);
                assert!(
                    first_difference(&was, &now).is_none(),
                    "{name}, {channels} ch, blocks of {block}: first differs at {:?}",
                    first_difference(&was, &now)
                );
            }
        }
    }
}

#[test]
fn after_a_reset_they_still_agree() {
    let input = source(24_000, 2);
    let mut was = old_echo(2, &[("feedback", 0.7)]);
    let mut now = new_echo(&[("feedback", 0.7)]);
    render(&mut was, &input, 2, 512, &[]);
    render(&mut now, &input, 2, 512, &[]);
    Effect::reset(&mut was);
    Effect::reset(&mut now);
    let (a, b) = (render(&mut was, &input, 2, 512, &[]), render(&mut now, &input, 2, 512, &[]));
    assert!(first_difference(&a, &b).is_none(), "{:?}", first_difference(&a, &b));
}

/// The one difference, and it is deliberate: wet and dry glide over 5 ms where
/// the old Echo stepped them at the block edge. Neither touches the delay
/// line, so once the glide is over the two are the same again.
#[test]
fn a_moved_level_glides_and_then_agrees_again() {
    let input = source(48_000, 2);
    let moves: &[Move] = &[(10, "wet", 1.0), (10, "dry", 0.2)];
    let was = render(&mut old_echo(2, &[]), &input, 2, 512, moves);
    let now = render(&mut new_echo(&[]), &input, 2, 512, moves);
    let moved_at = 10 * 512 * 2;
    assert!(first_difference(&was[..moved_at], &now[..moved_at]).is_none());
    assert!(first_difference(&was[moved_at..moved_at + 64], &now[moved_at..moved_at + 64]).is_some(), "no glide");
    let settled = moved_at + 4_800 * 2;
    for (i, (a, b)) in was[settled..].iter().zip(&now[settled..]).enumerate() {
        assert!((a - b).abs() < 1e-6, "frame {} after settling: {a} vs {b}", i / 2);
    }
}

#[test]
fn the_echo_keeps_every_key_and_range_documents_store() {
    let old = Params::specs(&old_echo(2, &[]).0);
    let new = Params::specs(&new_echo(&[]));
    assert_eq!(old, new);
}

// ---------------------------------------------------------------- the adapter

fn every_prism_effect() -> Vec<PrismEffect> {
    prism::catalogue().iter().map(|e| PrismEffect::new(e.descriptor.id, SR).unwrap()).collect()
}

#[test]
fn every_prism_effect_can_be_built_by_id_and_nothing_else_can() {
    for e in prism::catalogue() {
        assert!(prism::make(e.descriptor.id, SR, 2, &[]).is_some(), "{}", e.descriptor.id);
    }
    assert!(PrismEffect::new("no-such-effect", SR).is_none());
    assert!(prism::make("no-such-effect", SR, 2, &[]).is_none());
}

#[test]
fn every_prism_effect_keeps_the_length_and_stays_finite_at_any_width() {
    for channels in [1, 2, 3] {
        for mut e in every_prism_effect() {
            let input = source(12_000, channels);
            let out = render(&mut e, &input, channels, 512, &[]);
            assert_eq!(out.len(), input.len());
            assert!(out.iter().all(|v| v.is_finite()), "{} at {channels} ch", e.name());
        }
    }
}

#[test]
fn no_prism_effect_depends_on_the_block_size() {
    for (mut a, mut b) in every_prism_effect().into_iter().zip(every_prism_effect()) {
        let input = source(24_000, 2);
        // Past the adapter's own buffer too, so a block it has to split agrees.
        let x = render(&mut a, &input, 2, 64, &[]);
        let y = render(&mut b, &input, 2, 12_000, &[]);
        assert!(first_difference(&x, &y).is_none(), "{}: {:?}", a.name(), first_difference(&x, &y));
    }
}

#[test]
fn a_mono_file_goes_through_the_left_side() {
    for mut e in every_prism_effect() {
        // An effect with its own mono path (the detune averages its two
        // voices) plays one channel as this program's own did, which
        // prism_parity.rs holds it to; it is not the left of a stereo file.
        if prism_fx::make(e.id(), SR as f32).unwrap().has_mono() {
            continue;
        }
        let mono = source(12_000, 1);
        let out = render(&mut e, &mono, 1, 512, &[]);
        // The same as the left of a stereo file with the mono signal on both sides.
        let mut stereo_e = PrismEffect::new(e.id(), SR).unwrap();
        let both: Vec<f32> = mono.iter().flat_map(|s| [*s, *s]).collect();
        let stereo = render(&mut stereo_e, &both, 2, 512, &[]);
        let left: Vec<f32> = stereo.chunks(2).map(|f| f[0]).collect();
        assert!(first_difference(&out, &left).is_none(), "{}", e.id());
    }
}

#[test]
fn channels_past_the_second_pass_through() {
    for mut e in every_prism_effect() {
        let input = source(4_000, 3);
        let out = render(&mut e, &input, 3, 512, &[]);
        assert!(out.chunks(3).all(|f| f[2] == 0.25), "{} touched the third channel", e.id());
    }
}

#[test]
fn parameters_are_read_written_and_bounded_by_the_crates_table() {
    for mut e in every_prism_effect() {
        let d = prism::catalogue().iter().find(|x| x.descriptor.id == e.id()).unwrap().descriptor;
        let specs = Params::specs(&e);
        assert_eq!(specs.len(), d.params.len());
        for (mine, theirs) in specs.iter().zip(d.params) {
            assert_eq!(
                (mine.key, mine.label, mine.min, mine.max, mine.default, mine.log, mine.unit),
                (theirs.key, theirs.label, theirs.min, theirs.max, theirs.default, theirs.log, theirs.unit)
            );
            assert_eq!(Params::get(&e, mine.key), Some(mine.default), "{}.{}", e.id(), mine.key);
            // Past the top by ten ranges: `max * 10` is below a negative top.
            assert!(Params::set(&mut e, mine.key, mine.max + (mine.max - mine.min) * 10.0 + 1.0));
            assert_eq!(Params::get(&e, mine.key), Some(mine.max), "{}.{} unbounded", e.id(), mine.key);
            // The live route goes through `Effect`, and reads the same value.
            assert!(Effect::set_param(&mut e, mine.key, mine.min));
            assert_eq!(Effect::get_param(&e, mine.key), Some(mine.min));
        }
        assert!(!Params::set(&mut e, "no-such-control", 1.0));
        assert_eq!(Params::get(&e, "no-such-control"), None);
    }
}

#[test]
fn a_choice_control_holds_whole_values() {
    let mut e = PrismEffect::new("tremolo", SR).unwrap();
    assert!(Params::set(&mut e, "shape", 1.4));
    assert_eq!(Params::get(&e, "shape"), Some(1.0));
    assert_eq!(prism::clamp("tremolo", "shape", 1.6), Some(2.0));
    assert_eq!(prism::clamp("tremolo", "nope", 1.0), None);
}

#[test]
fn kinds_name_prism_effects_and_old_echo_documents_find_the_new_one() {
    assert_eq!(prism::kind("tremolo"), Some("prism:tremolo"));
    assert_eq!(prism::id_for_kind("prism:tremolo"), Some("tremolo"));
    assert_eq!(prism::id_for_kind("prism:no-such-effect"), None);
    assert_eq!(prism::id_for_kind("tremolo"), None, "a bare id is not a kind");
    // Documents saved before the move name the old Echo.
    assert_eq!(prism::id_for_kind("dattorro_echo"), Some("echo"));
    assert!(fx::shape::ShapeKind::from_str("dattorro_echo").is_none(), "the old Echo is still offered");
}

// ---------------------------------------------------------------- sounds

/// An effect that takes a sound gets it from the cache the host fills, by the
/// name the host gave it; one that takes none ignores it.
#[test]
fn a_remembered_sound_reaches_an_effect_that_takes_one() {
    use std::sync::Arc;
    let mut click = vec![0.0f32; 4_800];
    click[100] = 1.0;
    prism::remember_sound("test/click-at-100.wav", prism::Sound { samples: Arc::new(click), channels: 1, rate: SR as f32 });
    let params = vec![("lengthMs".to_string(), 100.0)];
    let mut e = prism::make_with_sound("convolution", SR, 2, &params, Some("test/click-at-100.wav")).unwrap();
    let x = source(8_000, 2);
    let y = render(e.as_mut(), &x, 2, 512, &[]);
    for i in (512 + 100) * 2..x.len() {
        assert!((y[i] - x[i - (512 + 100) * 2]).abs() < 1e-4, "sample {i}");
    }
    // A name nobody remembered leaves it without one: it passes the sound through.
    let mut e = prism::make_with_sound("convolution", SR, 2, &params, Some("test/never-loaded.wav")).unwrap();
    let y = render(e.as_mut(), &x, 2, 512, &[]);
    assert!((512 * 2..x.len()).all(|i| (y[i] - x[i - 512 * 2]).abs() < 1e-6));
    assert_eq!(prism::sound_input("convolution").map(|s| s.key), Some("impulse"));
    assert!(prism::sound_input("tremolo").is_none());
}

/// Spectral Dynamics takes its threshold sound the same way a convolution
/// takes its impulse: by name, from the cache the host fills.
#[test]
fn spectral_dynamics_takes_a_threshold_sound_by_name() {
    use std::sync::Arc;
    let hum: Vec<f32> = (0..48_000).map(|i| 0.03 * (std::f32::consts::TAU * 3_000.0 * i as f32 / SR as f32).sin()).collect();
    prism::remember_sound("test/hum.wav", prism::Sound { samples: Arc::new(hum.clone()), channels: 1, rate: SR as f32 });
    // The hum under its own print, 6 dB above it, with a 1 kHz tone the print
    // has nothing at: the hum goes and the tone stays. With no print, the
    // threshold is +6 dB for every band and both go.
    let tone: Vec<f32> = (0..48_000).map(|i| 0.1 * (std::f32::consts::TAU * 1_000.0 * i as f32 / SR as f32).sin()).collect();
    let gated = |sound: Option<&str>| {
        let params: Vec<(String, f32)> = vec![
            ("mode".into(), 0.0),
            ("bands".into(), 8.0),
            ("reductionDb".into(), -60.0),
            ("useSound".into(), 1.0),
            ("thresholdDb".into(), 6.0),
        ];
        let mut e = prism::make_with_sound("spectral-dynamics", SR, 2, &params, sound).unwrap();
        let x: Vec<f32> = hum.iter().zip(&tone).flat_map(|(h, t)| [h + t, h + t]).collect();
        let y = render(e.as_mut(), &x, 2, 512, &[]);
        y[48_000..].iter().map(|s| s * s).sum::<f32>()
    };
    let tone_only: f32 = tone[24_000..].iter().map(|s| s * s).sum::<f32>() * 2.0;
    let with = gated(Some("test/hum.wav"));
    assert!((with / tone_only - 1.0).abs() < 0.1, "the tone alone should be left: {with} against {tone_only}");
    assert!(gated(None) < tone_only * 1e-3, "with no print, +6 dB gates everything");
}
