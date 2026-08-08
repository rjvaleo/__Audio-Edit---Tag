//! The effect rack's contract, measured on real signals rather than asserted
//! against coefficient values.

use fx::biquad::Coeffs;
use fx::comp::CompSettings;
use fx::eq::{Band, EqSettings};
use fx::{Compressor, Effect, Eq, Gain, Rack};

const SR: u32 = 48000;

fn sine(freq: f32, frames: usize, amp: f32) -> Vec<f32> {
    (0..frames)
        .map(|i| amp * (2.0 * std::f32::consts::PI * freq * i as f32 / SR as f32).sin())
        .collect()
}

/// RMS of the last half, so filter start-up transients are excluded.
fn settled_rms(buf: &[f32]) -> f32 {
    let tail = &buf[buf.len() / 2..];
    (tail.iter().map(|v| v * v).sum::<f32>() / tail.len() as f32).sqrt()
}

/// Measured gain at a frequency, in dB.
fn gain_db_at(effect: &mut dyn Effect, freq: f32) -> f32 {
    let input = sine(freq, SR as usize / 2, 0.25);
    let mut out = input.clone();
    effect.reset();
    effect.process(&mut out, 1, SR);
    20.0 * (settled_rms(&out) / settled_rms(&input)).log10()
}

fn eq_with(f: impl FnOnce(&mut EqSettings)) -> Eq {
    let mut s = EqSettings::default();
    f(&mut s);
    Eq::new(s)
}

// ====================================================================== gain

#[test]
fn gain_of_six_db_doubles_amplitude() {
    let mut g = Gain { db: 6.0206 };
    let mut buf = vec![0.5f32; 16];
    g.process(&mut buf, 1, SR);
    for v in buf {
        assert!((v - 1.0).abs() < 1e-3, "got {v}");
    }
}

#[test]
fn gain_of_zero_db_is_a_no_op() {
    let mut g = Gain { db: 0.0 };
    let original = sine(1000.0, 128, 0.4);
    let mut buf = original.clone();
    g.process(&mut buf, 1, SR);
    assert_eq!(buf, original);
}

// ======================================================================== eq

#[test]
fn a_flat_eq_leaves_the_signal_alone() {
    let mut eq = eq_with(|_| {});
    for f in [100.0, 1000.0, 8000.0] {
        let db = gain_db_at(&mut eq, f);
        assert!(db.abs() < 0.1, "flat EQ moved {f} Hz by {db} dB");
    }
}

#[test]
fn a_mid_boost_lifts_its_centre_frequency() {
    let mut eq = eq_with(|s| s.mid = Band { freq: 1000.0, q: 1.0, gain_db: 9.0 });
    let db = gain_db_at(&mut eq, 1000.0);
    assert!((db - 9.0).abs() < 0.7, "expected about +9 dB at centre, got {db}");
}

#[test]
fn a_mid_boost_leaves_distant_frequencies_alone() {
    // The point of a parametric band is that it is local. A boost that lifts
    // everything is just a gain control.
    let mut eq = eq_with(|s| s.mid = Band { freq: 1000.0, q: 2.0, gain_db: 12.0 });
    let far = gain_db_at(&mut eq, 60.0);
    assert!(far.abs() < 1.5, "60 Hz moved by {far} dB from a 1 kHz band");
}

#[test]
fn a_mid_cut_attenuates_its_centre_frequency() {
    let mut eq = eq_with(|s| s.mid = Band { freq: 2000.0, q: 1.0, gain_db: -12.0 });
    let db = gain_db_at(&mut eq, 2000.0);
    assert!((db + 12.0).abs() < 0.8, "expected about -12 dB, got {db}");
}

#[test]
fn a_higher_q_narrows_the_band() {
    let mut wide = eq_with(|s| s.mid = Band { freq: 1000.0, q: 0.5, gain_db: 12.0 });
    let mut narrow = eq_with(|s| s.mid = Band { freq: 1000.0, q: 4.0, gain_db: 12.0 });
    // An octave away, the narrow band should have let go far more than the wide one.
    let w = gain_db_at(&mut wide, 2000.0);
    let n = gain_db_at(&mut narrow, 2000.0);
    assert!(w > n + 2.0, "wide {w} dB should exceed narrow {n} dB an octave out");
}

#[test]
fn the_low_shelf_lifts_the_bottom_and_not_the_top() {
    let mut eq = eq_with(|s| s.low = Band { freq: 200.0, q: 0.7, gain_db: 9.0 });
    let low = gain_db_at(&mut eq, 50.0);
    let high = gain_db_at(&mut eq, 8000.0);
    assert!((low - 9.0).abs() < 1.0, "50 Hz got {low} dB");
    assert!(high.abs() < 0.5, "8 kHz got {high} dB and should be untouched");
}

#[test]
fn the_high_shelf_lifts_the_top_and_not_the_bottom() {
    let mut eq = eq_with(|s| s.high = Band { freq: 4000.0, q: 0.7, gain_db: 9.0 });
    let high = gain_db_at(&mut eq, 12000.0);
    let low = gain_db_at(&mut eq, 100.0);
    assert!((high - 9.0).abs() < 1.0, "12 kHz got {high} dB");
    assert!(low.abs() < 0.5, "100 Hz got {low} dB and should be untouched");
}

#[test]
fn the_high_pass_removes_rumble_and_keeps_the_rest() {
    let mut eq = eq_with(|s| s.high_pass_hz = 200.0);
    let sub = gain_db_at(&mut eq, 30.0);
    let mid = gain_db_at(&mut eq, 2000.0);
    assert!(sub < -20.0, "30 Hz should be well down, got {sub} dB");
    assert!(mid.abs() < 0.5, "2 kHz should pass, got {mid} dB");
}

#[test]
fn the_predicted_curve_matches_what_the_filter_actually_does() {
    // The UI draws the response from magnitude_at without running audio; if it
    // disagrees with the filter the picture is a lie.
    let mut eq = eq_with(|s| s.mid = Band { freq: 1500.0, q: 1.4, gain_db: -8.0 });
    for f in [200.0, 800.0, 1500.0, 3000.0, 9000.0] {
        let predicted = 20.0 * eq.magnitude_at(f, SR).log10();
        let measured = gain_db_at(&mut eq, f);
        assert!(
            (predicted - measured).abs() < 0.6,
            "at {f} Hz: predicted {predicted:.2} dB, measured {measured:.2} dB"
        );
    }
}

#[test]
fn eq_keeps_channels_independent() {
    // Left loud, right silent. If the filter states are shared, the right
    // channel picks up energy that was never there.
    let mut eq = eq_with(|s| s.mid = Band { freq: 1000.0, q: 1.0, gain_db: 12.0 });
    let left = sine(1000.0, 4800, 0.5);
    let mut buf = Vec::new();
    for v in &left {
        buf.push(*v);
        buf.push(0.0);
    }
    eq.process(&mut buf, 2, SR);
    let right_energy: f32 = buf.iter().skip(1).step_by(2).map(|v| v.abs()).sum();
    assert!(right_energy < 1e-4, "silent channel picked up {right_energy}");
}

#[test]
fn eq_does_not_change_the_buffer_length() {
    let mut eq = eq_with(|s| s.mid.gain_db = 6.0);
    let mut buf = sine(440.0, 1000, 0.3);
    eq.process(&mut buf, 1, SR);
    assert_eq!(buf.len(), 1000);
}

#[test]
fn an_absurd_frequency_does_not_produce_nonsense() {
    // A centre frequency above Nyquist would make a naive biquad blow up.
    let mut eq = eq_with(|s| s.mid = Band { freq: 200000.0, q: 1.0, gain_db: 12.0 });
    let mut buf = sine(1000.0, 4800, 0.3);
    eq.process(&mut buf, 1, SR);
    assert!(buf.iter().all(|v| v.is_finite()), "filter produced NaN or infinity");
    assert!(buf.iter().all(|v| v.abs() < 100.0), "filter ran away");
}

// ================================================================ compressor

fn comp_with(f: impl FnOnce(&mut CompSettings)) -> Compressor {
    let mut s = CompSettings::default();
    f(&mut s);
    Compressor::new(s)
}

#[test]
fn a_signal_below_the_threshold_passes_untouched() {
    let mut c = comp_with(|s| {
        s.threshold_db = -6.0;
        s.knee_db = 0.0;
        s.ratio = 4.0;
    });
    // -20 dBFS, well under the threshold.
    let input = sine(1000.0, 24000, 0.1);
    let mut out = input.clone();
    c.process(&mut out, 1, SR);
    let db = 20.0 * (settled_rms(&out) / settled_rms(&input)).log10();
    assert!(db.abs() < 0.2, "quiet signal was moved by {db} dB");
}

#[test]
fn a_signal_above_the_threshold_is_pulled_down() {
    let mut c = comp_with(|s| {
        s.threshold_db = -24.0;
        s.ratio = 4.0;
        s.knee_db = 0.0;
        s.attack_ms = 1.0;
    });
    let input = sine(1000.0, 48000, 0.9);
    let mut out = input.clone();
    c.process(&mut out, 1, SR);
    let db = 20.0 * (settled_rms(&out) / settled_rms(&input)).log10();
    assert!(db < -5.0, "loud signal should be reduced, got {db} dB");
}

#[test]
fn a_higher_ratio_compresses_harder() {
    let make = |ratio: f32| {
        let mut c = comp_with(|s| {
            s.threshold_db = -24.0;
            s.ratio = ratio;
            s.knee_db = 0.0;
            s.attack_ms = 1.0;
        });
        let input = sine(1000.0, 48000, 0.9);
        let mut out = input.clone();
        c.process(&mut out, 1, SR);
        20.0 * (settled_rms(&out) / settled_rms(&input)).log10()
    };
    let gentle = make(2.0);
    let hard = make(10.0);
    assert!(hard < gentle - 3.0, "10:1 ({hard}) should exceed 2:1 ({gentle})");
}

#[test]
fn a_ratio_of_one_does_nothing() {
    let mut c = comp_with(|s| {
        s.threshold_db = -40.0;
        s.ratio = 1.0;
        s.knee_db = 0.0;
    });
    let input = sine(1000.0, 24000, 0.9);
    let mut out = input.clone();
    c.process(&mut out, 1, SR);
    let db = 20.0 * (settled_rms(&out) / settled_rms(&input)).log10();
    assert!(db.abs() < 0.2, "1:1 changed the level by {db} dB");
}

#[test]
fn makeup_gain_lifts_the_result() {
    let level = |makeup: f32| {
        let mut c = comp_with(|s| {
            s.threshold_db = -24.0;
            s.ratio = 4.0;
            s.makeup_db = makeup;
            s.attack_ms = 1.0;
        });
        let mut out = sine(1000.0, 48000, 0.9);
        c.process(&mut out, 1, SR);
        20.0 * settled_rms(&out).log10()
    };
    assert!((level(6.0) - level(0.0) - 6.0).abs() < 0.3);
}

#[test]
fn compression_reduces_the_range_between_loud_and_quiet() {
    // The actual job: the gap between a loud passage and a quiet one shrinks.
    let mut c = comp_with(|s| {
        s.threshold_db = -30.0;
        s.ratio = 8.0;
        s.attack_ms = 1.0;
        s.release_ms = 20.0;
        s.knee_db = 0.0;
    });
    let mut buf = sine(1000.0, 24000, 0.9);
    buf.extend(sine(1000.0, 24000, 0.05));
    let before = 20.0 * (settled_rms(&buf[..24000]) / settled_rms(&buf[24000..])).log10();
    c.process(&mut buf, 1, SR);
    let after = 20.0 * (settled_rms(&buf[..24000]) / settled_rms(&buf[24000..])).log10();
    assert!(after < before - 5.0, "range went from {before} dB to {after} dB");
}

#[test]
fn a_slow_attack_lets_the_transient_through() {
    let peak_after = |attack_ms: f32| {
        let mut c = comp_with(|s| {
            s.threshold_db = -30.0;
            s.ratio = 10.0;
            s.attack_ms = attack_ms;
            s.knee_db = 0.0;
        });
        let mut buf = sine(1000.0, 4800, 1.0);
        c.process(&mut buf, 1, SR);
        // The first millisecond, before a slow attack has clamped down.
        buf[..48].iter().fold(0.0f32, |m, v| m.max(v.abs()))
    };
    assert!(
        peak_after(50.0) > peak_after(0.1) + 0.05,
        "a slow attack must pass more of the initial transient"
    );
}

#[test]
fn the_soft_knee_bends_earlier_than_a_hard_one() {
    // Measured at the threshold itself, where a hard corner has not yet begun
    // to act but a soft knee is already half-way into its bend.
    //
    // A square wave, not a sine: the detector follows the peak, and a sine's
    // peak swings through every cycle, which smears the very difference under
    // test. A square holds |amplitude| constant so the level is exactly -20 dBFS.
    let square = |frames: usize, amp: f32| -> Vec<f32> {
        (0..frames)
            .map(|i| if (i / 24) % 2 == 0 { amp } else { -amp })
            .collect()
    };

    let at = |knee: f32| {
        let mut c = comp_with(|s| {
            s.threshold_db = -20.0;
            s.ratio = 8.0;
            s.knee_db = knee;
            s.attack_ms = 1.0;
        });
        let input = square(48000, 0.1); // exactly -20 dBFS
        let mut out = input.clone();
        c.process(&mut out, 1, SR);
        20.0 * (settled_rms(&out) / settled_rms(&input)).log10()
    };

    let soft = at(12.0);
    let hard = at(0.0);
    assert!(hard.abs() < 0.1, "a hard knee at the threshold should do nothing, got {hard}");
    assert!(soft < -0.5, "a 12 dB knee should already be bending, got {soft}");
}

#[test]
fn the_detector_is_linked_across_channels() {
    // A loud left channel must duck the right channel too, or the image shifts
    // every time one side gets loud.
    let mut c = comp_with(|s| {
        s.threshold_db = -30.0;
        s.ratio = 8.0;
        s.attack_ms = 1.0;
    });
    let loud = sine(1000.0, 24000, 0.9);
    let quiet = sine(1000.0, 24000, 0.02);
    let mut buf = Vec::new();
    for i in 0..loud.len() {
        buf.push(loud[i]);
        buf.push(quiet[i]);
    }
    let before: Vec<f32> = buf.iter().skip(1).step_by(2).copied().collect();
    c.process(&mut buf, 2, SR);
    let after: Vec<f32> = buf.iter().skip(1).step_by(2).copied().collect();
    assert!(
        settled_rms(&after) < settled_rms(&before) * 0.8,
        "the quiet channel should have been ducked with the loud one"
    );
}

#[test]
fn silence_does_not_produce_nan() {
    let mut c = comp_with(|_| {});
    let mut buf = vec![0.0f32; 4800];
    c.process(&mut buf, 1, SR);
    assert!(buf.iter().all(|v| v.is_finite() && *v == 0.0));
}

#[test]
fn gain_reduction_is_reported_for_the_meter() {
    let mut c = comp_with(|s| {
        s.threshold_db = -30.0;
        s.ratio = 8.0;
        s.attack_ms = 1.0;
    });
    let mut buf = sine(1000.0, 48000, 0.9);
    c.process(&mut buf, 1, SR);
    assert!(c.gain_reduction_db() > 5.0, "got {}", c.gain_reduction_db());
}

// ====================================================================== rack

#[test]
fn an_empty_rack_changes_nothing() {
    let mut rack = Rack::new();
    let original = sine(440.0, 512, 0.3);
    let mut buf = original.clone();
    rack.process(&mut buf, 1, SR);
    assert_eq!(buf, original);
}

#[test]
fn a_bypassed_effect_is_skipped() {
    let mut rack = Rack::new();
    rack.push(Box::new(Gain { db: 12.0 }));
    rack.slots[0].bypassed = true;
    let original = sine(440.0, 512, 0.3);
    let mut buf = original.clone();
    rack.process(&mut buf, 1, SR);
    assert_eq!(buf, original);
}

#[test]
fn effects_apply_in_order() {
    let mut rack = Rack::new();
    rack.push(Box::new(Gain { db: 6.0 }));
    rack.push(Box::new(Gain { db: 6.0 }));
    let mut buf = vec![0.1f32; 8];
    rack.process(&mut buf, 1, SR);
    // Two 6 dB stages is 12 dB, a factor of about four.
    assert!((buf[0] - 0.4).abs() < 0.01, "got {}", buf[0]);
}

#[test]
fn reordering_a_rack_changes_the_result() {
    // Compressing then boosting is not the same as boosting then compressing,
    // and the rack must preserve that difference.
    let build = |comp_first: bool| {
        let mut rack = Rack::new();
        if comp_first {
            rack.push(Box::new(Compressor::new(CompSettings {
                threshold_db: -24.0, ratio: 8.0, attack_ms: 1.0, knee_db: 0.0,
                ..CompSettings::default()
            })));
            rack.push(Box::new(Gain { db: 12.0 }));
        } else {
            rack.push(Box::new(Gain { db: 12.0 }));
            rack.push(Box::new(Compressor::new(CompSettings {
                threshold_db: -24.0, ratio: 8.0, attack_ms: 1.0, knee_db: 0.0,
                ..CompSettings::default()
            })));
        }
        let mut buf = sine(1000.0, 48000, 0.2);
        rack.process(&mut buf, 1, SR);
        settled_rms(&buf)
    };
    let a = build(true);
    let b = build(false);
    assert!((a - b).abs() > 0.01, "order made no difference: {a} vs {b}");
}

#[test]
fn an_empty_or_fully_bypassed_rack_needs_no_preroll() {
    let mut rack = Rack::new();
    assert_eq!(rack.preroll_frames(SR), 0);
    rack.push(Box::new(Gain { db: 3.0 }));
    rack.slots[0].bypassed = true;
    assert_eq!(rack.preroll_frames(SR), 0);
}

#[test]
fn an_active_rack_asks_for_preroll() {
    let mut rack = Rack::new();
    rack.push(Box::new(Eq::new(EqSettings::default())));
    assert!(rack.preroll_frames(SR) > 0);
}

#[test]
fn resetting_clears_filter_memory() {
    // Two runs from a clean state must be identical, or seeking gives a
    // different result each time you land on the same spot.
    let mut rack = Rack::new();
    rack.push(Box::new(Eq::new(EqSettings {
        mid: Band { freq: 900.0, q: 2.0, gain_db: 10.0 },
        ..EqSettings::default()
    })));

    let input = sine(900.0, 2048, 0.4);
    let mut first = input.clone();
    rack.process(&mut first, 1, SR);
    rack.reset();
    let mut second = input.clone();
    rack.process(&mut second, 1, SR);
    assert_eq!(first, second);
}

#[test]
fn identity_coefficients_pass_audio_through_unchanged() {
    let c = Coeffs::identity();
    assert!((c.magnitude_at(1000.0, SR) - 1.0).abs() < 1e-6);
}
