//! Ready-made instruments for the probe, the C interface and the cost
//! measurements: the real modules, set up with something to play.

use crate::{Grain, Wave};
use mgl_engine::Source;
use mgl_fx::grain::{Grain as Settings, StreamParams};
use mgl_fx::stretch::Algorithm;
use std::sync::Arc;
use wave::{builtin_frames, Patch, PatchState, Wavetable};

/// The Wave synth with its default patch and three of its built-in tables.
pub fn wave(rate: f32) -> Wave {
    let mut synth = Wave::new(rate).patch(PatchState::new(&Patch::default())).seed(1);
    for (osc, name) in ["Formant Sweep", "Vowel Ah–Oo", "Glass Organ"].into_iter().enumerate() {
        if let Some(frames) = builtin_frames(name) {
            synth = synth.table(osc, Arc::new(Wavetable::from_frames(&frames)));
        }
    }
    synth
}

/// Two seconds of a tone with a little noise, a different level on each side.
pub fn sound(rate: u32) -> Arc<Source> {
    let frames = 2 * rate as usize;
    let mut seed = 7u32;
    let samples = (0..frames)
        .flat_map(|i| {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let noise = ((seed >> 16) as f32 / 32768.0) - 1.0;
            let s = (i as f32 * 0.02).sin() * 0.4 + noise * 0.05;
            [s, s * 0.8]
        })
        .collect();
    Arc::new(Source { samples, channels: 2 })
}

/// A grain deck playing [`sound`] at half speed: `engine` 0 Granular, 1 WSOLA,
/// 2 Vocoder, 3 PVSOLA; `voices` Poly voices made up front (0: none).
pub fn grain(rate: u32, engine: u32, grid: usize, voices: usize) -> Grain {
    let source = sound(rate);
    let algorithm = match engine {
        1 => Algorithm::Wsola,
        2 => Algorithm::Vocoder,
        3 => Algorithm::Pvsola,
        _ => Algorithm::Granular,
    };
    let params = StreamParams {
        in_frames: source.frames(),
        sample_rate: rate,
        ratio: 2.0,
        semitones: 0.0,
        window_ms: 40.0,
        grain: Settings::default(),
        algorithm,
        wsola: Default::default(),
        vocoder: Default::default(),
        pvsola: Default::default(),
        hybrid: Default::default(),
        soundhack: Default::default(),
        cloud: false,
        cloud_mix: 0.5,
    };
    let deck = Grain::new(rate, grid, params, source);
    if voices > 0 {
        deck.poly(voices)
    } else {
        deck
    }
}
