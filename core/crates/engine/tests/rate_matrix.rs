//! Grain engines at each device rate and promised maximum block size.
mod stage1_support {
    pub mod matrix;
}
use engine::{Core, Shared, Source};
use fx::{grain::StreamParams, stretch::Algorithm};
use stage1_support::matrix::{self, Deviation};
use std::sync::Arc;
#[rustfmt::skip]
const ALLOW: &[Deviation] = &[
    Deviation { name: "SoundHack", rate: 44100, block: 16, metric: "dB", measured: -11.669292, why: "Resampled tone/noise through the preserved SoundHack window engine has rate-dependent finite-window level; no output change authorized." },
    Deviation { name: "SoundHack", rate: 44100, block: 64, metric: "dB", measured: -11.669292, why: "Resampled tone/noise through the preserved SoundHack window engine has rate-dependent finite-window level; no output change authorized." },
    Deviation { name: "SoundHack", rate: 44100, block: 480, metric: "dB", measured: -11.669292, why: "Resampled tone/noise through the preserved SoundHack window engine has rate-dependent finite-window level; no output change authorized." },
    Deviation { name: "SoundHack", rate: 44100, block: 512, metric: "dB", measured: -11.669292, why: "Resampled tone/noise through the preserved SoundHack window engine has rate-dependent finite-window level; no output change authorized." },
    Deviation { name: "SoundHack", rate: 44100, block: 1024, metric: "dB", measured: -11.669292, why: "Resampled tone/noise through the preserved SoundHack window engine has rate-dependent finite-window level; no output change authorized." },
    Deviation { name: "SoundHack", rate: 44100, block: 4096, metric: "dB", measured: -11.669292, why: "Resampled tone/noise through the preserved SoundHack window engine has rate-dependent finite-window level; no output change authorized." },
    Deviation { name: "SoundHack", rate: 96000, block: 16, metric: "dB", measured: -4.466567, why: "Resampled tone/noise through the preserved SoundHack window engine has rate-dependent finite-window level; no output change authorized." },
    Deviation { name: "SoundHack", rate: 96000, block: 64, metric: "dB", measured: -4.466567, why: "Resampled tone/noise through the preserved SoundHack window engine has rate-dependent finite-window level; no output change authorized." },
    Deviation { name: "SoundHack", rate: 96000, block: 480, metric: "dB", measured: -4.466567, why: "Resampled tone/noise through the preserved SoundHack window engine has rate-dependent finite-window level; no output change authorized." },
    Deviation { name: "SoundHack", rate: 96000, block: 512, metric: "dB", measured: -4.466567, why: "Resampled tone/noise through the preserved SoundHack window engine has rate-dependent finite-window level; no output change authorized." },
    Deviation { name: "SoundHack", rate: 96000, block: 1024, metric: "dB", measured: -4.466567, why: "Resampled tone/noise through the preserved SoundHack window engine has rate-dependent finite-window level; no output change authorized." },
    Deviation { name: "SoundHack", rate: 96000, block: 4096, metric: "dB", measured: -4.466567, why: "Resampled tone/noise through the preserved SoundHack window engine has rate-dependent finite-window level; no output change authorized." },
];
fn algorithm(name: &str) -> Algorithm {
    match name {
        "Granular" => Algorithm::Granular,
        "Wsola" => Algorithm::Wsola,
        "Vocoder" => Algorithm::Vocoder,
        "Pvsola" => Algorithm::Pvsola,
        "Hybrid" => Algorithm::Hybrid,
        "SoundHack" => Algorithm::SoundHack,
        _ => unreachable!(),
    }
}
#[test]
fn every_grain_engine_at_every_rate_and_block() {
    // Resample and separate once per physical rate, as the app does off-thread.
    let fixtures: Vec<_> = matrix::RATES
        .into_iter()
        .map(|rate| {
            // The grain-hash fixture's tone/noise, resampled from its 48 kHz source.
            let mut seed = 7u32;
            let original: Vec<f32> = (0..96_000)
                .map(|i| {
                    seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                    (i as f32 * 0.02).sin() * 0.4 + ((seed >> 16) as f32 / 32768.0 - 1.0) * 0.05
                })
                .collect();
            let samples = engine::convert::resample(&original, 1, 48_000, rate);
            let src = Arc::new(Source {
                samples,
                channels: 1,
            });
            let p = StreamParams::new(src.samples.len(), rate);
            let parts = Arc::new(fx::hstream::Parts::separate(&src.samples, 1, p.hybrid));
            (rate, src, parts)
        })
        .collect();
    matrix::run(
        &[
            "Granular",
            "Wsola",
            "Vocoder",
            "Pvsola",
            "Hybrid",
            "SoundHack",
        ],
        ALLOW,
        |name, rate, block| {
            let (_, src, parts) = fixtures.iter().find(|(r, _, _)| *r == rate).unwrap();
            let src = src.clone();
            let mut p = StreamParams::new(src.samples.len(), rate);
            p.algorithm = algorithm(name);
            p.ratio = 2.0;
            let shared = Shared::new(p, src.clone());
            if p.algorithm == Algorithm::Hybrid {
                shared.set_parts(parts.clone());
            }
            let mut core = Core::new(block, 1, p, src);
            shared.play();
            let mut output = vec![0.0; rate as usize / 2];
            for chunk in output.chunks_mut(block) {
                core.fill(chunk, 1, &shared);
            }
            assert_eq!(
                shared.bad_blocks.load(std::sync::atomic::Ordering::Relaxed),
                0,
                "{name}/{rate}/{block}"
            );
            output
        },
    );
}
