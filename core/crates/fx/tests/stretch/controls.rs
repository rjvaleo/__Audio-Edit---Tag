//! The deliberate controls, and the grain controls on all three engines.

use super::*;

// ===================================================== the deliberate controls
//
// Every knob below used to be a constant, and every one of them was a constant
// because that value is where the algorithm works. So there are two things to
// check and they pull in opposite directions: leaving them alone must reproduce
// the old sound *exactly*, and moving them must actually reach the audio rather
// than being read and dropped. A control that changes nothing is worse than no
// control, because you cannot hear that it is broken.

/// A chord over noise: partials for the vocoder to hold together and a floor
/// for it to smear, which is enough for any of these to show up.
pub(super) fn busy(rate: u32, secs: f32) -> Vec<f32> {
    let n = (secs * rate as f32) as usize;
    let mut seed = 99u32;
    (0..n)
        .map(|i| {
            let t = i as f32 / rate as f32;
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let noise = ((seed >> 16) as f32 / 32768.0) - 1.0;
            let tone = (std::f32::consts::TAU * 220.0 * t).sin()
                + (std::f32::consts::TAU * 277.0 * t).sin() * 0.7
                + (std::f32::consts::TAU * 330.0 * t).sin() * 0.5;
            tone * 0.25 + noise * 0.06
        })
        .collect()
}

pub(super) fn differs(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    if n == 0 {
        return f32::INFINITY;
    }
    a.iter().zip(b.iter()).take(n).map(|(x, y)| (x - y).abs()).sum::<f32>() / n as f32
}

#[test]
fn every_wsola_control_left_alone_is_the_sound_it_always_made() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    let base = Stretch { ratio: 2.0, ..Default::default() }.process(&src, 1, rate);

    // Spelled out rather than `..Default::default()`, because the point is that
    // these particular values are the ones the algorithm used to hard-code.
    let mut same = Stretch { ratio: 2.0, ..Default::default() };
    same.grain.overlap = 2.0;
    same.wsola.search_ms = 10.0;
    same.grain.overlap = 2.0;
    same.wsola.splice = fx::stretch::Splice::Similar;
    same.wsola.stride = 4;
    same.wsola.shape = fx::stretch::WinShape::Hann;
    assert_eq!(base, same.process(&src, 1, rate));
}

#[test]
fn every_vocoder_control_left_alone_is_the_sound_it_always_made() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    let mut base = Stretch { ratio: 2.0, algorithm: Algorithm::Vocoder, ..Default::default() };
    let plain = base.process(&src, 1, rate);

    base.grain.scan = 1.0;
    base.vocoder.freq_trust = 1.0;
    base.vocoder.phase_spread = 1.0;
    base.vocoder.peak_width = 2;
    base.vocoder.lock_width = 1.0;
    base.vocoder.mag_freeze = 0.0;
    base.vocoder.mag_blur = 0.0;
    base.vocoder.mag_gate = 0.0;
    assert_eq!(plain, base.process(&src, 1, rate));
}

#[test]
fn every_grain_control_left_alone_is_the_sound_it_always_made() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    let mut base = Stretch { ratio: 2.0, algorithm: Algorithm::Granular, ..Default::default() };
    base.grain.size_jitter = 0.3;
    base.grain.pitch_jitter_semis = 2.0;
    let plain = base.process(&src, 1, rate);

    base.grain.scan = 1.0;
    base.grain.reverse = false;
    base.grain.envelope = 0.5;
    base.grain.size_range = 1.0;
    base.grain.wrap = false;
    base.grain.layer_spread = 1.0;
    base.grain.link_jitter = false;
    base.grain.drift_step = false;
    base.grain.pan_spread = 0.0;
    assert_eq!(plain, base.process(&src, 1, rate));
}

/// Each control, one at a time, against the same source. Every one of them has
/// to reach the audio — and the length must survive, because these are meant to
/// change the character of a stretch, not what the timeline says it is.
#[test]
fn each_wsola_control_reaches_the_audio() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    let base = Stretch { ratio: 2.0, quality: Quality::Best, ..Default::default() };
    let plain = base.process(&src, 1, rate);

    let cases: Vec<(&str, Box<dyn Fn(&mut Stretch)>)> = vec![
        ("search 0 — plain overlap-add", Box::new(|s: &mut Stretch| s.wsola.search_ms = 0.0)),
        ("search 120ms", Box::new(|s: &mut Stretch| s.wsola.search_ms = 120.0)),
        ("overlap 4", Box::new(|s: &mut Stretch| s.grain.overlap = 4.0)),
        ("worst splice", Box::new(|s: &mut Stretch| s.wsola.splice = fx::stretch::Splice::Different)),
        ("loudest splice", Box::new(|s: &mut Stretch| s.wsola.splice = fx::stretch::Splice::Loudest)),
        ("stride 64", Box::new(|s: &mut Stretch| s.wsola.stride = 64)),
        ("rect window", Box::new(|s: &mut Stretch| s.wsola.shape = fx::stretch::WinShape::Rect)),
        ("triangle window", Box::new(|s: &mut Stretch| s.wsola.shape = fx::stretch::WinShape::Triangle)),
    ];

    for (name, set) in cases {
        let mut s = base;
        set(&mut s);
        let out = s.process(&src, 1, rate);
        assert_eq!(out.len(), plain.len(), "{name} changed the length");
        assert!(differs(&plain, &out) > 1e-4, "{name} did nothing");
    }
}

#[test]
fn each_vocoder_control_reaches_the_audio() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    let base = Stretch { ratio: 2.0, algorithm: Algorithm::Vocoder, ..Default::default() };
    let plain = base.process(&src, 1, rate);

    let cases: Vec<(&str, Box<dyn Fn(&mut Stretch)>)> = vec![
        ("no frequency trust", Box::new(|s: &mut Stretch| s.vocoder.freq_trust = 0.0)),
        ("frequency trust 3", Box::new(|s: &mut Stretch| s.vocoder.freq_trust = 3.0)),
        ("no phase spread", Box::new(|s: &mut Stretch| s.vocoder.phase_spread = 0.0)),
        ("peak width 8", Box::new(|s: &mut Stretch| s.vocoder.peak_width = 8)),
        ("lock width 2.5", Box::new(|s: &mut Stretch| s.vocoder.lock_width = 2.5)),
        ("spectral freeze", Box::new(|s: &mut Stretch| s.vocoder.mag_freeze = 1.0)),
        ("magnitude blur", Box::new(|s: &mut Stretch| s.vocoder.mag_blur = 0.6)),
        ("magnitude gate", Box::new(|s: &mut Stretch| s.vocoder.mag_gate = 0.3)),
    ];

    for (name, set) in cases {
        let mut s = base;
        set(&mut s);
        let out = s.process(&src, 1, rate);
        assert_eq!(out.len(), plain.len(), "{name} changed the length");
        assert!(differs(&plain, &out) > 1e-4, "{name} did nothing");
    }
}

#[test]
fn each_grain_control_reaches_the_audio() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    let mut base = Stretch { ratio: 2.0, algorithm: Algorithm::Granular, ..Default::default() };
    // Jitter on, so the controls that steer the *randomness* have randomness to
    // steer. With every jitter at zero, linking their streams is a no-op and the
    // test would be asserting something it cannot see.
    base.grain.size_jitter = 0.4;
    base.grain.position_jitter_ms = 40.0;
    base.grain.pitch_jitter_semis = 3.0;
    base.grain.pitch_drift_semis = 2.0;
    base.grain.layers = 3;
    let plain = base.process(&src, 1, rate);

    let cases: Vec<(&str, Box<dyn Fn(&mut Stretch)>)> = vec![
        ("frozen scan", Box::new(|s: &mut Stretch| s.grain.scan = 0.0)),
        ("reverse scan", Box::new(|s: &mut Stretch| s.grain.scan = -1.0)),
        ("reversed grains", Box::new(|s: &mut Stretch| s.grain.reverse = true)),
        ("percussive envelope", Box::new(|s: &mut Stretch| s.grain.envelope = 0.0)),
        ("swelling envelope", Box::new(|s: &mut Stretch| s.grain.envelope = 1.0)),
        ("wide size range", Box::new(|s: &mut Stretch| s.grain.size_range = 6.0)),
        ("wrapping positions", Box::new(|s: &mut Stretch| s.grain.wrap = true)),
        ("stacked layers", Box::new(|s: &mut Stretch| s.grain.layer_spread = 0.0)),
        ("linked jitter", Box::new(|s: &mut Stretch| s.grain.link_jitter = true)),
        ("stepped drift", Box::new(|s: &mut Stretch| s.grain.drift_step = true)),
    ];

    for (name, set) in cases {
        let mut s = base;
        set(&mut s);
        let out = s.process(&src, 1, rate);
        assert_eq!(out.len(), plain.len(), "{name} changed the length");
        assert!(differs(&plain, &out) > 1e-4, "{name} did nothing");
    }
}

/// Pan is the one grain control that needs two channels to mean anything, and
/// it must not quietly change the level while it moves things about.
#[test]
fn pan_spread_widens_without_costing_level() {
    let rate = 44_100;
    let mono = busy(rate, 1.0);
    let src: Vec<f32> = mono.iter().flat_map(|v| [*v, *v]).collect();

    let mut base = Stretch { ratio: 2.0, algorithm: Algorithm::Granular, ..Default::default() };
    base.grain.size_jitter = 0.3;
    let centred = base.process(&src, 2, rate);

    let mut wide = base;
    wide.grain.pan_spread = 1.0;
    let wide = wide.process(&src, 2, rate);

    let side = |v: &[f32]| -> f32 {
        let n = v.len() / 2;
        (0..n).map(|f| (v[f * 2] - v[f * 2 + 1]).abs()).sum::<f32>() / n.max(1) as f32
    };
    // A mono source panned nowhere has no side content at all.
    assert!(side(&centred) < 1e-6, "centred grains were not centred");
    assert!(side(&wide) > 1e-3, "spread grains produced no width");

    let level = |v: &[f32]| (v.iter().map(|x| x * x).sum::<f32>() / v.len().max(1) as f32).sqrt();
    let (a, b) = (level(&centred), level(&wide));
    assert!(
        (b / a.max(1e-9) - 1.0).abs() < 0.25,
        "spreading changed the level: {a} to {b}"
    );
}

/// The detector floor was added to stop it firing on numerical ripple through a
/// held tone. Removing it deliberately has to bring that back, or the control
/// is not reaching the thing it claims to.
#[test]
fn removing_the_detector_floor_lets_a_steady_tone_trigger() {
    let rate = 44_100;
    let n = 2 * rate as usize;
    let tone: Vec<f32> = (0..n)
        .map(|i| (std::f32::consts::TAU * 440.0 * i as f32 / rate as f32).sin())
        .collect();
    let with = fx::transient::onsets(&tone, 1, rate, 0.5, 1.0).len();
    let without = fx::transient::onsets(&tone, 1, rate, 0.5, 0.0).len();
    assert_eq!(with, 0, "the floor stopped working");
    assert!(without > 5, "removing the floor changed nothing: {without}");
}

/// The vocoder transforms each channel on its own, so nothing is looking after
/// the relationship *between* them — and that relationship is the stereo image.
///
/// Measured directly: the right channel is the left delayed by eight samples,
/// which is a pure inter-channel phase difference and correlates at exactly 1.0
/// at that lag. Independent, the stretch degrades it to 0.988; linked, it comes
/// through at 1.0, because every channel is moved by the same correction and so
/// keeps whatever it was doing relative to the others.
#[test]
fn linking_the_channels_keeps_the_stereo_image_intact() {
    let rate = 44_100;
    let left = busy(rate, 1.0);
    let delay = 8usize;
    let src: Vec<f32> = (0..left.len())
        .flat_map(|i| [left[i], if i >= delay { left[i - delay] } else { 0.0 }])
        .collect();

    // The best correlation between the two channels, and the lag it happens at.
    let agreement = |v: &[f32]| -> (isize, f32) {
        let m = v.len() / 2;
        let (a, b) = (m / 4, m * 3 / 4);
        let mut best = (0isize, -2.0f32);
        for lag in -64isize..=64 {
            let (mut dot, mut ea, mut eb) = (0.0f32, 0.0f32, 0.0f32);
            for i in a..b {
                let j = i as isize + lag;
                if j < 0 || j as usize >= m {
                    continue;
                }
                let (x, y) = (v[i * 2], v[j as usize * 2 + 1]);
                dot += x * y;
                ea += x * x;
                eb += y * y;
            }
            let s = if ea > 1e-9 && eb > 1e-9 { dot / (ea.sqrt() * eb.sqrt()) } else { 0.0 };
            if s > best.1 {
                best = (lag, s);
            }
        }
        best
    };

    let (src_lag, src_score) = agreement(&src);
    assert_eq!(src_lag, delay as isize, "the source was not a clean delay");
    assert!(src_score > 0.9999, "the source was not a clean delay: {src_score}");

    let base = Stretch { ratio: 2.0, algorithm: Algorithm::Vocoder, ..Default::default() };
    let mut linked = base;
    linked.vocoder.stereo_link = true;

    let (free_lag, free_score) = agreement(&base.process(&src, 2, rate));
    let (held_lag, held_score) = agreement(&linked.process(&src, 2, rate));

    assert_eq!(free_lag, delay as isize);
    assert_eq!(held_lag, delay as isize);
    assert!(held_score > 0.999, "linked lost the image: {held_score}");
    assert!(free_score < 0.995, "independent channels did not drift: {free_score}");
    assert!(held_score > free_score, "linking made it worse: {held_score} vs {free_score}");
}

/// Linking must not flatten a genuinely wide source into mono. It shares the
/// stretch's correction, not the phase itself.
#[test]
fn linking_does_not_collapse_a_wide_source() {
    let rate = 44_100;
    let left = busy(rate, 1.0);
    let right: Vec<f32> = left.iter().rev().copied().collect();
    let src: Vec<f32> = left.iter().zip(right.iter()).flat_map(|(l, r)| [*l, *r]).collect();

    let mut linked = Stretch { ratio: 2.0, algorithm: Algorithm::Vocoder, ..Default::default() };
    linked.vocoder.stereo_link = true;
    let out = linked.process(&src, 2, rate);

    let n = out.len() / 2;
    let side = (0..n).map(|f| (out[f * 2] - out[f * 2 + 1]).abs()).sum::<f32>() / n.max(1) as f32;
    let level = (out.iter().map(|x| x * x).sum::<f32>() / out.len().max(1) as f32).sqrt();
    assert!(side > level * 0.5, "two unrelated channels were flattened together: {side} vs {level}");
}

#[test]
fn stereo_link_left_alone_is_the_sound_it_always_made() {
    let rate = 44_100;
    let mono = busy(rate, 0.5);
    let src: Vec<f32> = mono.iter().flat_map(|v| [*v, *v * 0.6]).collect();
    let base = Stretch { ratio: 1.5, algorithm: Algorithm::Vocoder, ..Default::default() };
    let mut same = base;
    same.vocoder.stereo_link = false;
    assert_eq!(base.process(&src, 2, rate), same.process(&src, 2, rate));
}

// ============================ the grain controls, on all three engines
//
// Density, overlap, the jitters and the drift began as the cloud's own, but
// every one of these engines lays something down repeatedly — so every one has
// a rate, a length, a place it reads from and a speed it reads at. The controls
// now drive all three. Which means two things have to hold for each engine:
// left alone they change nothing, and moved they reach the audio.

/// Every grain control at its default, spelled out rather than spread, because
/// the claim is that *these particular values* reproduce the old sound.
pub(super) fn inert_grain() -> fx::Grain {
    fx::Grain {
        density_hz: 0.0,
        overlap: 2.0,
        size_jitter: 0.0,
        position_jitter_ms: 0.0,
        pitch_jitter_semis: 0.0,
        pitch_drift_semis: 0.0,
        drift_rate_hz: 0.5,
        layers: 1,
        seed: 1,
        ..fx::Grain::default()
    }
}

#[test]
fn the_grain_controls_are_inert_on_every_engine() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    for alg in [Algorithm::Wsola, Algorithm::Vocoder] {
        let base = Stretch { ratio: 2.0, algorithm: alg, ..Default::default() };
        let plain = base.process(&src, 1, rate);
        let same = Stretch { grain: inert_grain(), ..base };
        assert_eq!(plain, same.process(&src, 1, rate), "{alg:?} moved without being asked");
    }
}

/// One case per control per engine. A knob that is read and dropped is worse
/// than no knob, because you cannot hear that it is broken.
#[test]
fn each_grain_control_reaches_wsola_and_the_vocoder() {
    let rate = 44_100;
    let src = busy(rate, 1.0);

    let cases: Vec<(&str, Box<dyn Fn(&mut fx::Grain)>)> = vec![
        ("density", Box::new(|g: &mut fx::Grain| g.density_hz = 120.0)),
        ("overlap", Box::new(|g: &mut fx::Grain| g.overlap = 5.0)),
        ("layers", Box::new(|g: &mut fx::Grain| g.layers = 4)),
        ("size jitter", Box::new(|g: &mut fx::Grain| g.size_jitter = 0.5)),
        ("position jitter", Box::new(|g: &mut fx::Grain| g.position_jitter_ms = 60.0)),
        ("pitch jitter", Box::new(|g: &mut fx::Grain| g.pitch_jitter_semis = 5.0)),
        ("pitch drift", Box::new(|g: &mut fx::Grain| g.pitch_drift_semis = 4.0)),
    ];

    for alg in [Algorithm::Wsola, Algorithm::Vocoder] {
        let base = Stretch { ratio: 2.0, algorithm: alg, ..Default::default() };
        let plain = base.process(&src, 1, rate);
        for (name, set) in &cases {
            let mut g = fx::Grain::default();
            set(&mut g);
            let out = Stretch { grain: g, ..base }.process(&src, 1, rate);
            assert_eq!(out.len(), plain.len(), "{alg:?}/{name} changed the length");
            assert!(differs(&plain, &out) > 1e-4, "{alg:?}/{name} did nothing");
            assert!(out.iter().all(|v| v.is_finite()), "{alg:?}/{name} produced NaN");
        }
    }
}

/// Drift rate only means anything once there is drift to shape, so it needs its
/// own case rather than a line in the sweep above.
#[test]
fn drift_rate_shapes_the_drift_on_every_engine() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    for alg in [Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Granular] {
        let mut slow = Stretch { ratio: 2.0, algorithm: alg, ..Default::default() };
        slow.grain.pitch_drift_semis = 5.0;
        slow.grain.drift_rate_hz = 0.2;
        let mut fast = slow;
        fast.grain.drift_rate_hz = 8.0;
        let a = slow.process(&src, 1, rate);
        let b = fast.process(&src, 1, rate);
        assert!(differs(&a, &b) > 1e-4, "{alg:?}: drift rate did nothing");
    }
}

/// Layers must not quietly change the level. Whether they sum coherently or
/// not depends on how much jitter is on, so the scaling is measured rather
/// than assumed — this is the check that it works out either way.
#[test]
fn layers_hold_the_level_on_every_engine() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    for alg in [Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Granular] {
        for jitter in [0.0f32, 0.5] {
            // Granular with no jitter at all is several copies of the same
            // audio, which sum coherently — and `layer_gain` lifts them by √N
            // on top of that, deliberately. See `grain::layer_tests`. Every
            // other combination has to hold its level.
            if alg == Algorithm::Granular && jitter == 0.0 {
                continue;
            }
            let mut one = Stretch { ratio: 2.0, algorithm: alg, ..Default::default() };
            one.grain.size_jitter = jitter;
            one.grain.position_jitter_ms = jitter * 80.0;
            let mut many = one;
            many.grain.layers = 6;

            let a = rms(&one.process(&src, 1, rate));
            let b = rms(&many.process(&src, 1, rate));
            assert!(
                (b / a.max(1e-9) - 1.0).abs() < 0.3,
                "{alg:?} at jitter {jitter}: six layers moved the level from {a} to {b}"
            );
        }
    }
}

/// The extended grain controls, on all three engines.
///
/// Four of these already reached WSOLA and the vocoder — size range, layer
/// spread, linked jitter and stepped drift all run through shared helpers — and
/// the other five did not, so half the panel worked and half quietly did
/// nothing. They all work now, each in the engine's own terms: a window is a
/// splice for WSOLA and an analysis frame for the vocoder, but both have a read
/// pointer, a direction, an envelope and a place in the stereo field.
#[test]
fn every_extended_grain_control_reaches_every_engine() {
    let rate = 44_100;
    let mono = busy(rate, 1.0);
    let src: Vec<f32> = mono.iter().flat_map(|v| [*v, *v * 0.8]).collect();

    let cases: Vec<(&str, Box<dyn Fn(&mut fx::Grain)>)> = vec![
        ("scan frozen", Box::new(|g: &mut fx::Grain| g.scan = 0.0)),
        ("scan reversed", Box::new(|g: &mut fx::Grain| g.scan = -1.0)),
        ("reverse", Box::new(|g: &mut fx::Grain| g.reverse = true)),
        ("envelope percussive", Box::new(|g: &mut fx::Grain| g.envelope = 0.05)),
        ("envelope swelling", Box::new(|g: &mut fx::Grain| g.envelope = 0.95)),
        ("size range", Box::new(|g: &mut fx::Grain| g.size_range = 6.0)),
        ("wrap", Box::new(|g: &mut fx::Grain| { g.position_jitter_ms = 300.0; g.wrap = true })),
        ("layer spread", Box::new(|g: &mut fx::Grain| { g.layers = 4; g.layer_spread = 0.0 })),
        ("link jitter", Box::new(|g: &mut fx::Grain| g.link_jitter = true)),
        ("drift step", Box::new(|g: &mut fx::Grain| g.drift_step = true)),
        ("pan spread", Box::new(|g: &mut fx::Grain| g.pan_spread = 1.0)),
    ];

    for alg in [Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Granular] {
        // A baseline with the jitters already on, so the controls that steer
        // randomness have randomness to steer.
        let mut base = Stretch { ratio: 2.0, algorithm: alg, ..Default::default() };
        base.grain.size_jitter = 0.4;
        base.grain.position_jitter_ms = 40.0;
        base.grain.pitch_jitter_semis = 3.0;
        base.grain.pitch_drift_semis = 4.0;
        let plain = base.process(&src, 2, rate);

        for (name, set) in &cases {
            let mut g = base.grain;
            set(&mut g);
            let out = Stretch { grain: g, ..base }.process(&src, 2, rate);
            assert_eq!(out.len(), plain.len(), "{alg:?}/{name} changed the length");
            assert!(differs(&plain, &out) > 1e-4, "{alg:?}/{name} did nothing");
            assert!(out.iter().all(|v| v.is_finite()), "{alg:?}/{name} produced NaN");
            assert!(out.iter().all(|v| v.abs() < 4.0), "{alg:?}/{name} ran away");
        }
    }
}

/// And left alone they still reproduce the sound the engines always made.
#[test]
fn the_extended_grain_controls_are_inert_on_every_engine() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    for alg in [Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Granular] {
        let base = Stretch { ratio: 2.0, algorithm: alg, ..Default::default() };
        let plain = base.process(&src, 1, rate);

        let mut same = base;
        same.grain.scan = 1.0;
        same.grain.reverse = false;
        same.grain.envelope = 0.5;
        same.grain.size_range = 1.0;
        same.grain.wrap = false;
        same.grain.layer_spread = 1.0;
        same.grain.link_jitter = false;
        same.grain.drift_step = false;
        same.grain.pan_spread = 0.0;
        assert_eq!(plain, same.process(&src, 1, rate), "{alg:?} moved without being asked");
    }
}

/// Pan needs two channels to mean anything, and it must place things without
/// quietly changing the level — on every engine, not just the cloud.
#[test]
fn pan_spread_widens_every_engine_without_costing_level() {
    let rate = 44_100;
    let mono = busy(rate, 1.0);
    let src: Vec<f32> = mono.iter().flat_map(|v| [*v, *v]).collect();
    let side = |v: &[f32]| -> f32 {
        let n = v.len() / 2;
        (0..n).map(|f| (v[f * 2] - v[f * 2 + 1]).abs()).sum::<f32>() / n.max(1) as f32
    };
    let level = |v: &[f32]| (v.iter().map(|x| x * x).sum::<f32>() / v.len().max(1) as f32).sqrt();

    for alg in [Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Granular] {
        let mut base = Stretch { ratio: 2.0, algorithm: alg, ..Default::default() };
        base.grain.size_jitter = 0.3;
        let centred = base.process(&src, 2, rate);
        let mut wide = base;
        wide.grain.pan_spread = 1.0;
        let wide = wide.process(&src, 2, rate);

        assert!(side(&centred) < 1e-4, "{alg:?}: a mono source was not centred to begin with");
        assert!(side(&wide) > 1e-3, "{alg:?}: spreading produced no width");
        let (a, b) = (level(&centred), level(&wide));
        assert!(
            (b / a.max(1e-9) - 1.0).abs() < 0.3,
            "{alg:?}: spreading moved the level from {a} to {b}"
        );
    }
}

/// The reconstruction must not amplify its own edges.
///
/// The vocoder divides by the summed *square* of the window, which tails toward
/// nothing where only one frame is present. With the guard at 1e-6 that
/// division was turning a correctly quiet edge into a peak twenty times the
/// source — which is what it had been doing since the overlap control moved.
#[test]
fn no_engine_amplifies_its_own_edges() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    let peak = |v: &[f32]| v.iter().fold(0.0f32, |m, x| m.max(x.abs()));
    let want = peak(&src);
    for alg in [Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Granular] {
        for overlap in [1.5f32, 2.0, 4.0, 8.0] {
            let mut s = Stretch { ratio: 2.0, algorithm: alg, ..Default::default() };
            s.grain.overlap = overlap;
            let out = s.process(&src, 1, rate);
            let got = peak(&out);
            assert!(
                got < want * 2.0,
                "{alg:?} at overlap {overlap}: peak {got:.3} against a source of {want:.3}"
            );
        }
    }
}
