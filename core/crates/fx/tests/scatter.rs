//! Layers should form a cloud, not a comb.
//!
//! Before the scatter control existed, every layer read the *same* instant of
//! the source and was laid down a fixed fraction of a hop later. That is a
//! delay line, and regular delays make regular notches: at sixteen layers the
//! spectrum's ripple went from 7.8 dB to 11.9 dB and the level wandered between
//! 1.4x and 0.8x. Adding layers made the sound thinner and hollower, which is
//! the opposite of what the control is for.
//!
//! Scatter throws each layer's read pointer somewhere else, so the layers are
//! different audio rather than copies of one. They then sum like a crowd.

use fx::stretch::{Algorithm, Stretch};

const SR: u32 = 48_000;

fn source(n: usize) -> Vec<f32> {
    let mut seed = 7u32;
    (0..n)
        .map(|i| {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            0.3 * ((i as f32) * 0.02).sin() + (((seed >> 16) as f32 / 32768.0) - 1.0) * 0.25
        })
        .collect()
}

/// How comb-like a spectrum is: the spread of its bins in dB. A smooth
/// spectrum has small ripple; regular notches make it large.
fn ripple(v: &[f32], at: usize) -> f32 {
    let n = 4096;
    let w = audio_core::fft::hann(n);
    let mut re: Vec<f32> = (0..n).map(|i| v[at + i] * w[i]).collect();
    let mut im = vec![0f32; n];
    audio_core::fft::fft(&mut re, &mut im);
    let db: Vec<f32> = (0..n / 2)
        .map(|k| 20.0 * (re[k] * re[k] + im[k] * im[k]).sqrt().max(1e-9).log10())
        .collect();
    let (lo, hi) = (40, db.len() - 40);
    let mean: f32 = db[lo..hi].iter().sum::<f32>() / (hi - lo) as f32;
    (db[lo..hi].iter().map(|d| (d - mean).powi(2)).sum::<f32>() / (hi - lo) as f32).sqrt()
}

fn render(alg: Algorithm, layers: u32, scatter: f32) -> Vec<f32> {
    let src = source(SR as usize);
    let mut s = Stretch { ratio: 4.0, window_ms: 60.0, algorithm: alg, ..Default::default() };
    s.grain.layers = layers;
    s.grain.layer_scatter = scatter;
    s.process(&src, 1, SR)
}

/// The engines that lay one signal down repeatedly all comb without it. The
/// hybrid does not, because its three parts are already different signals —
/// which is worth knowing rather than asserting away.
#[test]
fn scatter_turns_a_comb_back_into_a_cloud() {
    for alg in [
        Algorithm::Granular,
        Algorithm::Wsola,
        Algorithm::Vocoder,
        Algorithm::Pvsola,
    ] {
        let one = ripple(&render(alg, 1, 0.0), 40_000);
        let stacked = ripple(&render(alg, 16, 0.0), 40_000);
        let scattered = ripple(&render(alg, 16, 1.0), 40_000);

        assert!(
            stacked > one + 1.5,
            "{alg:?}: sixteen stacked layers did not comb ({stacked:.2} dB against {one:.2})"
        );
        assert!(
            scattered < stacked - 1.5,
            "{alg:?}: scatter did not smooth the comb ({scattered:.2} dB against {stacked:.2})"
        );
        assert!(
            scattered <= one + 1.0,
            "{alg:?}: scattered layers are still rougher than one ({scattered:.2} against {one:.2})"
        );
    }
}

/// The hybrid separates before it stretches, so its layers are already three
/// different signals and never combed in the first place.
#[test]
fn the_hybrid_does_not_comb_with_or_without_scatter() {
    let one = ripple(&render(Algorithm::Hybrid, 1, 0.0), 40_000);
    for scatter in [0.0f32, 1.0] {
        let many = ripple(&render(Algorithm::Hybrid, 16, scatter), 40_000);
        assert!(
            many < one + 1.5,
            "the hybrid combed at scatter {scatter} ({many:.2} dB against {one:.2})"
        );
    }
}

/// Inert at its default, exactly — the rule every control here answers to.
#[test]
fn scatter_at_zero_is_what_it_always_was() {
    for alg in [Algorithm::Granular, Algorithm::Wsola, Algorithm::Vocoder] {
        let src = source(SR as usize / 2);
        let mut a = Stretch { ratio: 3.0, algorithm: alg, ..Default::default() };
        a.grain.layers = 4;
        let mut b = a;
        b.grain.layer_scatter = 0.0;
        b.grain.layer_scatter_ms = 900.0;
        assert_eq!(
            a.process(&src, 1, SR),
            b.process(&src, 1, SR),
            "{alg:?}: the range moved the sound with scatter at zero"
        );
    }
}

/// And the range reaches the audio, or it is a decoration.
#[test]
fn the_range_decides_how_far_the_layers_are_thrown() {
    let src = source(SR as usize / 2);
    for alg in [Algorithm::Granular, Algorithm::Wsola, Algorithm::Vocoder] {
        let mut near = Stretch { ratio: 3.0, algorithm: alg, ..Default::default() };
        near.grain.layers = 8;
        near.grain.layer_scatter = 1.0;
        near.grain.layer_scatter_ms = 10.0;
        let mut far = near;
        far.grain.layer_scatter_ms = 900.0;

        let a = near.process(&src, 1, SR);
        let b = far.process(&src, 1, SR);
        let d: f32 = a.iter().zip(&b).map(|(x, y)| (x - y).abs()).sum::<f32>() / a.len() as f32;
        assert!(d > 1e-4, "{alg:?}: the range did not reach the audio");
    }
}
