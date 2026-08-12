//! Three-band parametric EQ: low shelf, peaking mid, high shelf.

use crate::biquad::{Coeffs, State};
use crate::Effect;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Band {
    pub freq: f32,
    pub q: f32,
    pub gain_db: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EqSettings {
    pub low: Band,
    pub mid: Band,
    pub high: Band,
    /// Optional rumble filter, ahead of everything else.
    pub high_pass_hz: f32,
}

impl Default for EqSettings {
    fn default() -> Self {
        EqSettings {
            low: Band { freq: 100.0, q: 0.7, gain_db: 0.0 },
            mid: Band { freq: 1000.0, q: 1.0, gain_db: 0.0 },
            high: Band { freq: 8000.0, q: 0.7, gain_db: 0.0 },
            high_pass_hz: 0.0,
        }
    }
}

pub struct Eq {
    pub settings: EqSettings,
    coeffs: [Coeffs; 4],
    /// Delay lines: one set of four sections per channel.
    states: Vec<[State; 4]>,
    built_for: (u32, EqSettings),
}

impl Eq {
    pub fn new(settings: EqSettings) -> Self {
        Eq {
            settings,
            coeffs: [Coeffs::identity(); 4],
            states: Vec::new(),
            built_for: (0, EqSettings::default()),
        }
    }

    /// Recompute coefficients if the settings or sample rate have changed.
    fn rebuild(&mut self, sample_rate: u32) {
        if self.built_for == (sample_rate, self.settings) {
            return;
        }
        let s = self.settings;
        self.coeffs = [
            if s.high_pass_hz > 20.0 {
                Coeffs::high_pass(s.high_pass_hz, 0.707, sample_rate)
            } else {
                Coeffs::identity()
            },
            Coeffs::low_shelf(s.low.freq, s.low.q, s.low.gain_db, sample_rate),
            Coeffs::peaking(s.mid.freq, s.mid.q, s.mid.gain_db, sample_rate),
            Coeffs::high_shelf(s.high.freq, s.high.q, s.high.gain_db, sample_rate),
        ];
        self.built_for = (sample_rate, s);
    }

    /// Combined magnitude response, for drawing the curve.
    pub fn magnitude_at(&mut self, freq: f32, sample_rate: u32) -> f32 {
        self.rebuild(sample_rate);
        self.coeffs
            .iter()
            .map(|c| c.magnitude_at(freq, sample_rate))
            .product()
    }
}

impl EqSettings {
    /// Whether this EQ has anything to do.
    ///
    /// A bell at 0 dB is unity *algebraically*, but a biquad at unity still
    /// runs the audio through a difference equation, and the arithmetic leaves
    /// about 8e-5 behind. That is inaudible and still enough to break the rule
    /// that a document nobody has touched renders exactly what it did before
    /// the rack existed — which matters more now that the starting chain is
    /// switched on rather than bypassed.
    pub fn is_flat(&self) -> bool {
        self.high_pass_hz <= 0.0
            && [&self.low, &self.mid, &self.high]
                .iter()
                .all(|b| b.gain_db.abs() < 1e-6)
    }
}

impl Effect for Eq {
    fn process(&mut self, buf: &mut [f32], channels: usize, sample_rate: u32) {
        if self.settings.is_flat() {
            // Nothing to do, and nothing left ringing to flush: a flat EQ has
            // never put anything into its own state.
            self.reset();
            return;
        }
        self.rebuild(sample_rate);
        let channels = channels.max(1);
        if self.states.len() < channels {
            self.states.resize(channels, [State::default(); 4]);
        }

        let frames = buf.len() / channels;
        for f in 0..frames {
            for ch in 0..channels {
                let i = f * channels + ch;
                let mut v = buf[i];
                for (sec, c) in self.coeffs.iter().enumerate() {
                    v = self.states[ch][sec].step(c, v);
                }
                buf[i] = v;
            }
        }
    }

    fn reset(&mut self) {
        for st in &mut self.states {
            for s in st.iter_mut() {
                s.reset();
            }
        }
    }

    fn name(&self) -> &'static str {
        "EQ"
    }

    /// `low.freq`, `mid.q`, `high.gainDb`, `highPassHz`.
    ///
    /// Named for the bands this EQ actually has rather than by index. The
    /// coefficients are rebuilt at the top of `process`, so a write here is
    /// heard on the next block without anything else being told.
    ///
    /// The ranges are the same ones the interface offers. They have to be:
    /// automation stores a lane as a unit value, and a reader stricter than the
    /// writer is silent data loss — see `persist::stretch_from_json`.
    fn set_param(&mut self, key: &str, value: f32) -> bool {
        if key == "highPassHz" {
            self.settings.high_pass_hz = value.clamp(0.0, EQ_FREQ_MAX);
            return true;
        }
        let Some((band, field)) = key.split_once('.') else {
            return false;
        };
        let band = match band {
            "low" => &mut self.settings.low,
            "mid" => &mut self.settings.mid,
            "high" => &mut self.settings.high,
            _ => return false,
        };
        match field {
            "freq" => band.freq = value.clamp(EQ_FREQ_MIN, EQ_FREQ_MAX),
            "q" => band.q = value.clamp(EQ_Q_MIN, EQ_Q_MAX),
            "gainDb" => band.gain_db = value.clamp(EQ_GAIN_MIN, EQ_GAIN_MAX),
            _ => return false,
        }
        true
    }
}

/// The EQ's ranges, in one place, for the same reason as [`crate::GAIN_DB_MIN`].
pub const EQ_FREQ_MIN: f32 = 20.0;
pub const EQ_FREQ_MAX: f32 = 20_000.0;
pub const EQ_Q_MIN: f32 = 0.05;
pub const EQ_Q_MAX: f32 = 18.0;
pub const EQ_GAIN_MIN: f32 = -24.0;
pub const EQ_GAIN_MAX: f32 = 24.0;
