//! Which parameter reaches which engine — the whole table, pinned.
//!
//! Every engine's panel is built from an assumption about this table: it shows
//! a control exactly when that control reaches the audio for the engine you are
//! in. Both halves matter. A control that reaches the audio with nothing on the
//! panel is unreachable, and a control on the panel that reaches nothing is a
//! lie the interface tells you every time you move it.
//!
//! Neither half is obvious to read off the code, because two of the five
//! engines are built out of the other three and inherit whatever those engines
//! read. So it is measured, and the answer is written down here.

use fx::stretch::{Algorithm, Splice, Stretch, WinShape};

const RATE: u32 = 44_100;

/// Two tones, a noise floor, and hits whose amplitude climbs from barely-there
/// to obvious — in stereo, with the right channel delayed.
///
/// Both of those details are load-bearing, and each of them cost a wrong
/// answer first.
///
/// The **graded** hits are what makes the transient detector's settings
/// measurable. Given hits that are all far above the bar, every sensitivity
/// finds the same ones and every floor admits the same ones, so all three of
/// those controls report dead. They need onsets sitting *near* the threshold
/// before moving the threshold means anything.
///
/// The **delay** is what makes `stereo_link` measurable. Two channels that are
/// scaled copies of each other come out identical whether it is on or off,
/// because the stretch is deterministic and both channels ask it the same
/// question.
fn source() -> Vec<f32> {
    // Long enough that twelve graded hits clear the detector's minimum spacing,
    // and no longer — this table is 240 renders and every frame is paid for
    // five times over.
    let n = 3 * RATE as usize / 2;
    let mut mono: Vec<f32> = (0..n)
        .map(|i| {
            let t = i as f32 / RATE as f32;
            0.22 * (std::f32::consts::TAU * 220.0 * t).sin()
                + 0.15 * (std::f32::consts::TAU * 331.0 * t).sin()
        })
        .collect();

    let mut seed = 12345u32;
    for v in mono.iter_mut() {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        *v += (((seed >> 16) as f32 / 32768.0) - 1.0) * 0.03;
    }

    let count = 12;
    for b in 0..count {
        let at = (n / (count + 1)) * (b + 1);
        let amp = 0.02 + 0.9 * (b as f32 / (count - 1) as f32).powi(2);
        for i in 0..600 {
            if at + i >= n {
                break;
            }
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let noise = ((seed >> 16) as f32 / 32768.0) - 1.0;
            mono[at + i] += noise * (1.0 - i as f32 / 600.0).powi(2) * amp;
        }
    }

    let mut v = vec![0f32; n * 2];
    for i in 0..n {
        v[i * 2] = mono[i];
        v[i * 2 + 1] = if i >= 977 { mono[i - 977] } else { 0.0 };
    }
    v
}

fn differs(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| (x - y).abs()).sum::<f32>() / a.len().max(1) as f32
}

/// Which engines a parameter is expected to reach.
const W: u8 = 1 << 0;
const V: u8 = 1 << 1;
const P: u8 = 1 << 2;
const H: u8 = 1 << 3;
const G: u8 = 1 << 4;
const ALL: u8 = W | V | P | H | G;

#[test]
fn every_parameter_reaches_exactly_the_engines_whose_panel_shows_it() {
    let src = source();
    type Case = (&'static str, u8, Box<dyn Fn(&mut Stretch)>);

    let cases: Vec<Case> = vec![
        // The vocoder's own. PVSOLA runs the vocoder between anchors and the
        // hybrid runs it on the harmonic part, so all three answer these.
        ("vocoder.windowMs", V | P | H, Box::new(|s: &mut Stretch| s.vocoder.window_ms = 92.0)),
        ("vocoder.phaseLock", V | P | H, Box::new(|s: &mut Stretch| s.vocoder.phase_lock = false)),
        ("vocoder.freqTrust", V | P | H, Box::new(|s: &mut Stretch| s.vocoder.freq_trust = 0.2)),
        ("vocoder.phaseSpread", V | P | H, Box::new(|s: &mut Stretch| s.vocoder.phase_spread = 0.0)),
        ("vocoder.peakWidth", V | P | H, Box::new(|s: &mut Stretch| s.vocoder.peak_width = 12)),
        ("vocoder.lockWidth", V | P | H, Box::new(|s: &mut Stretch| s.vocoder.lock_width = 3.0)),
        ("vocoder.magFreeze", V | P | H, Box::new(|s: &mut Stretch| s.vocoder.mag_freeze = 0.9)),
        ("vocoder.magBlur", V | P | H, Box::new(|s: &mut Stretch| s.vocoder.mag_blur = 0.8)),
        ("vocoder.magGate", V | P | H, Box::new(|s: &mut Stretch| s.vocoder.mag_gate = 0.3)),
        ("vocoder.stereoLink", V | P | H, Box::new(|s: &mut Stretch| s.vocoder.stereo_link = true)),

        // WSOLA's own. The hybrid runs WSOLA on the percussive part and holds
        // transient preservation on, which is why the guard and the floor reach
        // it while the switch itself has nothing left to change.
        ("wsola.preserveTransients", W, Box::new(|s: &mut Stretch| {
            s.wsola.preserve_transients = !s.wsola.preserve_transients
        })),
        ("wsola.searchMs", W | H, Box::new(|s: &mut Stretch| s.wsola.search_ms = 0.0)),
        ("wsola.splice", W | H, Box::new(|s: &mut Stretch| s.wsola.splice = Splice::Different)),
        ("wsola.stride", W | H, Box::new(|s: &mut Stretch| s.wsola.stride = 64)),
        ("wsola.shape", W | H, Box::new(|s: &mut Stretch| s.wsola.shape = WinShape::Rect)),

        // PVSOLA's own three, and nothing else answers them.
        ("pvsola.anchorFrames", P, Box::new(|s: &mut Stretch| s.pvsola.anchor_frames = 24)),
        ("pvsola.searchMs", P, Box::new(|s: &mut Stretch| s.pvsola.search_ms = 0.0)),
        ("pvsola.blend", P, Box::new(|s: &mut Stretch| s.pvsola.blend = 0.0)),

        // The hybrid's own eight.
        ("hybrid.fftSize", H, Box::new(|s: &mut Stretch| s.hybrid.fft_size = 1024)),
        ("hybrid.timeSpan", H, Box::new(|s: &mut Stretch| s.hybrid.time_span = 41)),
        ("hybrid.freqSpan", H, Box::new(|s: &mut Stretch| s.hybrid.freq_span = 41)),
        ("hybrid.margin", H, Box::new(|s: &mut Stretch| s.hybrid.margin = 1.0)),
        ("hybrid.morphNoise", H, Box::new(|s: &mut Stretch| s.hybrid.morph_noise = false)),
        ("hybrid.harmonicLevel", H, Box::new(|s: &mut Stretch| s.hybrid.harmonic_level = 0.4)),
        ("hybrid.percussiveLevel", H, Box::new(|s: &mut Stretch| s.hybrid.percussive_level = 0.4)),
        ("hybrid.residualLevel", H, Box::new(|s: &mut Stretch| s.hybrid.residual_level = 0.0)),

        // The shared control model. Every one of these reaches every engine,
        // which is the claim the whole arrangement rests on: each engine lays
        // something down repeatedly, so each has a rate, a length, a place it
        // reads from and a speed it reads at.
        ("grain.densityHz", ALL, Box::new(|s: &mut Stretch| s.grain.density_hz = 60.0)),
        ("grain.overlap", ALL, Box::new(|s: &mut Stretch| s.grain.overlap = 4.0)),
        ("grain.layers", ALL, Box::new(|s: &mut Stretch| s.grain.layers = 4)),
        ("grain.sizeJitter", ALL, Box::new(|s: &mut Stretch| s.grain.size_jitter = 0.5)),
        ("grain.positionJitterMs", ALL, Box::new(|s: &mut Stretch| s.grain.position_jitter_ms = 40.0)),
        ("grain.pitchJitterSemis", ALL, Box::new(|s: &mut Stretch| s.grain.pitch_jitter_semis = 5.0)),
        ("grain.pitchDriftSemis", ALL, Box::new(|s: &mut Stretch| s.grain.pitch_drift_semis = 5.0)),
        ("grain.scan", ALL, Box::new(|s: &mut Stretch| s.grain.scan = -1.0)),
        ("grain.reverse", ALL, Box::new(|s: &mut Stretch| s.grain.reverse = true)),
        ("grain.envelope", ALL, Box::new(|s: &mut Stretch| s.grain.envelope = 1.0)),
        ("grain.panSpread", ALL, Box::new(|s: &mut Stretch| s.grain.pan_spread = 1.0)),
        // These four only mean anything alongside the control they modify, so
        // each turns that one on first. Testing them alone would report a live
        // control dead.
        ("grain.driftRateHz", ALL, Box::new(|s: &mut Stretch| {
            s.grain.pitch_drift_semis = 5.0;
            s.grain.drift_rate_hz = 8.0;
        })),
        ("grain.sizeRange", ALL, Box::new(|s: &mut Stretch| {
            s.grain.size_jitter = 0.5;
            s.grain.size_range = 4.0;
        })),
        ("grain.wrap", ALL, Box::new(|s: &mut Stretch| {
            s.grain.position_jitter_ms = 400.0;
            s.grain.wrap = true;
        })),
        ("grain.layerSpread", ALL, Box::new(|s: &mut Stretch| {
            s.grain.layers = 4;
            s.grain.layer_spread = 3.0;
        })),
        ("grain.linkJitter", ALL, Box::new(|s: &mut Stretch| {
            s.grain.position_jitter_ms = 40.0;
            s.grain.link_jitter = true;
        })),
        ("grain.driftStep", ALL, Box::new(|s: &mut Stretch| {
            s.grain.pitch_drift_semis = 5.0;
            s.grain.drift_step = true;
        })),
        ("grain.seed", ALL, Box::new(|s: &mut Stretch| {
            s.grain.position_jitter_ms = 40.0;
            s.grain.seed = 999;
        })),
    ];

    let engines = [
        (Algorithm::Wsola, W, "WSOLA"),
        (Algorithm::Vocoder, V, "Vocoder"),
        (Algorithm::Pvsola, P, "PVSOLA"),
        (Algorithm::Hybrid, H, "Hybrid"),
        (Algorithm::Granular, G, "Granular"),
    ];

    for (alg, bit, label) in engines {
        let base = Stretch { ratio: 2.0, algorithm: alg, ..Default::default() };
        let plain = base.process(&src, 2, RATE);
        for (name, expect, apply) in &cases {
            let mut s = base;
            apply(&mut s);
            let moved = differs(&plain, &s.process(&src, 2, RATE)) > 1e-6;
            let wanted = expect & bit != 0;
            assert_eq!(
                moved, wanted,
                "{label}: {name} {} the audio, and the table says it {}. \
                 If the routing changed on purpose, the panel in app.js has to change with it.",
                if moved { "reaches" } else { "does not reach" },
                if wanted { "should" } else { "should not" },
            );
        }
    }

    // The transient detector's three, which the panel only shows once
    // preservation is on — so that is the state they are measured in. The
    // hybrid holds it on itself and shows them unconditionally.
    let detector: Vec<Case> = vec![
        ("wsola.sensitivity", W | H, Box::new(|s: &mut Stretch| s.wsola.sensitivity = 0.95)),
        ("wsola.floor", W | H, Box::new(|s: &mut Stretch| s.wsola.floor = 0.0)),
        ("wsola.guardHops", W | H, Box::new(|s: &mut Stretch| s.wsola.guard_hops = 12.0)),
    ];
    for (alg, bit, label) in engines {
        let mut base = Stretch { ratio: 2.0, algorithm: alg, ..Default::default() };
        base.wsola.preserve_transients = true;
        let plain = base.process(&src, 2, RATE);
        for (name, expect, apply) in &detector {
            let mut s = base;
            apply(&mut s);
            let moved = differs(&plain, &s.process(&src, 2, RATE)) > 1e-6;
            let wanted = expect & bit != 0;
            assert_eq!(
                moved, wanted,
                "{label}: {name} {} the audio with the detector on, and the table says it {}.",
                if moved { "reaches" } else { "does not reach" },
                if wanted { "should" } else { "should not" },
            );
        }
    }
}

/// The same graded source, at the detector rather than through the stretch —
/// which is where it is obvious *why* the hits have to be graded.
///
/// Both of these controls move a threshold. Given hits that all sit far above
/// it, moving it finds the same hits every time and the control looks dead;
/// the codebase already had a test asserting only that a looser setting finds
/// *no fewer* onsets, which passes whether or not the control does anything.
#[test]
fn the_detectors_thresholds_admit_more_as_they_are_opened() {
    let stereo = source();
    let mono: Vec<f32> = stereo.chunks(2).map(|c| c[0]).collect();

    let shy = fx::transient::onsets(&mono, 1, RATE, 0.0, 1.0).len();
    let eager = fx::transient::onsets(&mono, 1, RATE, 1.0, 1.0).len();
    assert!(eager > shy, "sensitivity found no more as it opened: {shy} then {eager}");

    let held = fx::transient::onsets(&mono, 1, RATE, 0.5, 2.0).len();
    let free = fx::transient::onsets(&mono, 1, RATE, 0.5, 0.0).len();
    assert!(free > held, "the floor admitted no more as it came off: {held} then {free}");
}
