//! The LFOs' waves and their rate law, as the patch stores them and the
//! voices and the free LFOs read them (`docs/WAVE-SYNTH.md`, v7).

use crate::patch::{LfoWave, LFO_RATE, LFO_SYNC, MAX_LFO_POINTS, NUM_PARAMS, TEMPO};

/// An LFO shape in a fixed array.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LfoShape {
    pub points: [(f32, f32); MAX_LFO_POINTS],
    pub len: usize,
    /// The wave; `Drawn` reads `points`.
    pub wave: LfoWave,
    /// Mixed into the random waves' draws, so two LFOs never wander alike.
    pub salt: u32,
}

/// The v7 rate law: `0.02 · 2000^v` Hz free, or with sync a note length at
/// the synth's tempo.
#[inline]
pub fn lfo_hz(vals: &[f32; NUM_PARAMS], l: usize) -> f32 {
    const BEATS: [f32; 9] = [32.0, 16.0, 8.0, 4.0, 2.0, 1.0, 0.5, 0.25, 0.125];
    let v = vals[LFO_RATE + l].clamp(0.0, 1.0);
    if vals[LFO_SYNC + l] >= 0.5 {
        let tempo = vals[TEMPO].clamp(30.0, 300.0);
        tempo / 60.0 / BEATS[(v * 8.0).round() as usize]
    } else {
        0.02 * 2000f32.powf(v)
    }
}

/// A hash of `n` to 0..1, the random waves' draws.
#[inline]
fn rnd01(n: u32) -> f32 {
    let mut x = n.wrapping_mul(0x9E37_79B9) ^ 0x85EB_CA6B;
    x ^= x >> 16;
    x = x.wrapping_mul(0x7FEB_352D);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846C_A68B);
    x ^= x >> 16;
    (x >> 8) as f32 * (1.0 / 16_777_216.0)
}

impl LfoShape {
    pub fn from_points(p: &[(f32, f32)]) -> LfoShape {
        let mut points = [(0.0, 0.0); MAX_LFO_POINTS];
        let len = p.len().min(MAX_LFO_POINTS);
        points[..len].copy_from_slice(&p[..len]);
        if len < 2 {
            // A flat line at the centre: an LFO with no shape is no movement.
            points[0] = (0.0, 0.5);
            points[1] = (1.0, 0.5);
            return LfoShape { points, len: 2, wave: LfoWave::Drawn, salt: 0 };
        }
        LfoShape { points, len, wave: LfoWave::Drawn, salt: 0 }
    }

    pub fn with_wave(mut self, wave: LfoWave, salt: u32) -> LfoShape {
        self.wave = wave;
        self.salt = salt;
        self
    }

    /// The LFO's value, 0..1, at phase `u` of its `cycle`th cycle. Only the
    /// random waves care which cycle it is.
    #[inline]
    pub fn value(&self, u: f32, cycle: u32) -> f32 {
        self.value_as(self.wave, u, cycle)
    }

    /// The same as another wave would give it: what a modulated shape
    /// (`lfoL.shape` as a mod target, `choice.rs`) plays. `Drawn` reads this
    /// shape's points.
    #[inline]
    pub fn value_as(&self, wave: LfoWave, u: f32, cycle: u32) -> f32 {
        let u = if u >= 1.0 { 1.0 } else { u.max(0.0) };
        match wave {
            LfoWave::Sine => 0.5 + 0.5 * (std::f32::consts::TAU * u).sin(),
            LfoWave::Tri => {
                if u < 0.25 {
                    0.5 + 2.0 * u
                } else if u < 0.75 {
                    1.5 - 2.0 * u
                } else {
                    2.0 * u - 1.5
                }
            }
            LfoWave::Up => u,
            LfoWave::Down => 1.0 - u,
            LfoWave::Square => {
                if u < 0.5 {
                    1.0
                } else {
                    0.0
                }
            }
            LfoWave::Steps => {
                let i = ((u * 8.0) as u32).min(7);
                rnd01(self.salt ^ cycle.wrapping_mul(8).wrapping_add(i))
            }
            LfoWave::Smooth => {
                let k = u * 4.0;
                let i = (k as u32).min(3);
                let f = k - i as f32;
                let n = cycle.wrapping_mul(4).wrapping_add(i);
                let (a, b) = (rnd01(self.salt ^ n), rnd01(self.salt ^ n.wrapping_add(1)));
                a + (b - a) * (0.5 - 0.5 * (std::f32::consts::PI * f).cos())
            }
            LfoWave::Drawn => self.at(u),
        }
    }

    /// The kit's `lfoAt`: cosine-eased between points, 0..1.
    #[inline]
    pub fn at(&self, x: f32) -> f32 {
        let pts = &self.points[..self.len];
        for i in 1..pts.len() {
            let (a, b) = (pts[i - 1], pts[i]);
            if x <= b.0 {
                if b.0 == a.0 {
                    return b.1;
                }
                let u = (x - a.0) / (b.0 - a.0);
                return a.1 + (b.1 - a.1) * (0.5 - 0.5 * (std::f32::consts::PI * u).cos());
            }
        }
        pts[pts.len() - 1].1
    }
}
