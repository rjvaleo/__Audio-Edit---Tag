//! Eight-node parametric EQ with shelves, bells, cuts and notches.

use crate::biquad::{Coeffs, State};
use crate::Effect;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Band {
    pub freq: f32,
    pub q: f32,
    pub gain_db: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum EqMode {
    HighPass,
    LowShelf,
    Bell,
    Notch,
    HighShelf,
    LowPass,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EqSettings {
    pub low: Band,
    pub mid: Band,
    pub high: Band,
    /// Optional rumble filter, ahead of everything else.
    pub high_pass_hz: f32,
    pub extra: [Band; 3],
    pub low_pass_hz: f32,
    pub modes: [EqMode; 8],
    pub enabled: [bool; 8],
}

impl Default for EqSettings {
    fn default() -> Self {
        EqSettings {
            low: Band {
                freq: 100.0,
                q: 0.7,
                gain_db: 0.0,
            },
            mid: Band {
                freq: 1000.0,
                q: 1.0,
                gain_db: 0.0,
            },
            high: Band {
                freq: 8000.0,
                q: 0.7,
                gain_db: 0.0,
            },
            high_pass_hz: 0.0,
            extra: [
                Band {
                    freq: 250.0,
                    q: 1.0,
                    gain_db: 0.0,
                },
                Band {
                    freq: 500.0,
                    q: 1.0,
                    gain_db: 0.0,
                },
                Band {
                    freq: 2000.0,
                    q: 1.0,
                    gain_db: 0.0,
                },
            ],
            low_pass_hz: 20000.0,
            modes: [
                EqMode::HighPass,
                EqMode::LowShelf,
                EqMode::Bell,
                EqMode::Bell,
                EqMode::Bell,
                EqMode::Bell,
                EqMode::HighShelf,
                EqMode::LowPass,
            ],
            enabled: [true, true, true, false, false, false, true, false],
        }
    }
}

/// The EQ's ranges, in one place.
///
/// Automation stores a lane as a unit value and the range belongs to the
/// effect, so this is what 0 and 1 mean. The interface reads the same numbers;
/// a reader stricter than the writer is silent data loss.
pub const EQ_FREQ_MIN: f32 = 10.0;
pub const EQ_FREQ_MAX: f32 = 24_000.0;
pub const EQ_Q_MIN: f32 = 0.05;
pub const EQ_Q_MAX: f32 = 18.0;
pub const EQ_GAIN_MIN: f32 = -24.0;
pub const EQ_GAIN_MAX: f32 = 24.0;
/// Below this a high-pass is doing nothing; above it a low-pass is.
pub const EQ_HP_OFF: f32 = 20.0;
pub const EQ_LP_OFF: f32 = 20_000.0;

impl EqSettings {
    /// The eight nodes in the order the chain runs them.
    pub fn bands(&self) -> [Band; 8] {
        [
            Band { freq: self.high_pass_hz, q: 0.707, gain_db: 0.0 },
            self.low,
            self.mid,
            self.extra[0],
            self.extra[1],
            self.extra[2],
            self.high,
            Band { freq: self.low_pass_hz, q: 0.707, gain_db: 0.0 },
        ]
    }

    /// Whether this EQ has anything to do.
    ///
    /// A bell at 0 dB is unity algebraically, but a biquad at unity still runs
    /// the audio through a difference equation and leaves about 8e-5 behind.
    /// Inaudible, and still enough to break the rule that a document nobody has
    /// touched renders exactly what it did before the rack existed — which
    /// matters because the starting chain is switched on rather than bypassed.
    pub fn is_flat(&self) -> bool {
        let bands = self.bands();
        self.enabled.iter().enumerate().all(|(i, on)| {
            !on || match self.modes[i] {
                EqMode::HighPass => bands[i].freq <= EQ_HP_OFF,
                EqMode::LowPass => bands[i].freq >= EQ_LP_OFF,
                _ => bands[i].gain_db.abs() < 1e-6,
            }
        })
    }
}

pub struct Eq {
    pub settings: EqSettings,
    coeffs: [Coeffs; 8],
    states: Vec<[State; 8]>,
    built_for: (u32, EqSettings),
}

impl Eq {
    pub fn new(settings: EqSettings) -> Self {
        Eq {
            settings,
            coeffs: [Coeffs::identity(); 8],
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
        let mut bands = s.bands();
        bands[0].freq = bands[0].freq.max(EQ_HP_OFF);
        self.coeffs = std::array::from_fn(|i| {
            if !s.enabled[i] || (i == 0 && s.high_pass_hz <= EQ_HP_OFF) {
                return Coeffs::identity();
            }
            let b = bands[i];
            match s.modes[i] {
                EqMode::HighPass => Coeffs::high_pass(b.freq, b.q, sample_rate),
                EqMode::LowShelf => Coeffs::low_shelf(b.freq, b.q, b.gain_db, sample_rate),
                EqMode::Bell => Coeffs::peaking(b.freq, b.q, b.gain_db, sample_rate),
                EqMode::Notch => Coeffs::peaking(b.freq, b.q, b.gain_db, sample_rate),
                EqMode::HighShelf => Coeffs::high_shelf(b.freq, b.q, b.gain_db, sample_rate),
                EqMode::LowPass => Coeffs::low_pass(b.freq, b.q, sample_rate),
            }
        });
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
            self.states.resize(channels, [State::default(); 8]);
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
    fn set_param(&mut self, key: &str, value: f32) -> bool {
        let Some(rest) = key.strip_prefix("band.") else {
            return false;
        };
        let mut p = rest.split('.');
        let Some(i) = p
            .next()
            .and_then(|x| x.parse::<usize>().ok())
            .filter(|i| *i < 8)
        else {
            return false;
        };
        let Some(field) = p.next() else { return false };
        if field == "enabled" {
            self.settings.enabled[i] = value >= 0.5;
            return true;
        }
        if field == "mode" {
            self.settings.modes[i] = match value.round() as i32 {
                0 => EqMode::HighPass,
                1 => EqMode::LowShelf,
                2 => EqMode::Bell,
                3 => EqMode::Notch,
                4 => EqMode::HighShelf,
                5 => EqMode::LowPass,
                _ => return false,
            };
            return true;
        }
        let mut bands = [
            Band {
                freq: self.settings.high_pass_hz,
                q: 0.707,
                gain_db: 0.0,
            },
            self.settings.low,
            self.settings.mid,
            self.settings.extra[0],
            self.settings.extra[1],
            self.settings.extra[2],
            self.settings.high,
            Band {
                freq: self.settings.low_pass_hz,
                q: 0.707,
                gain_db: 0.0,
            },
        ];
        match field {
            "freq" => bands[i].freq = value.clamp(EQ_FREQ_MIN, EQ_FREQ_MAX),
            "q" => bands[i].q = value.clamp(EQ_Q_MIN, EQ_Q_MAX),
            "gainDb" => bands[i].gain_db = value.clamp(EQ_GAIN_MIN, EQ_GAIN_MAX),
            _ => return false,
        }
        match i {
            0 => self.settings.high_pass_hz = bands[i].freq,
            1 => self.settings.low = bands[i],
            2 => self.settings.mid = bands[i],
            3..=5 => self.settings.extra[i - 3] = bands[i],
            6 => self.settings.high = bands[i],
            7 => self.settings.low_pass_hz = bands[i].freq,
            _ => {}
        }
        true
    }
}

#[cfg(test)]
mod control_tests {
    use super::*;

    #[test]
    fn every_visual_band_property_is_live_addressable() {
        let mut eq = Eq::new(EqSettings::default());
        assert!(eq.set_param("band.3.enabled", 1.0));
        assert!(eq.set_param("band.3.mode", 3.0));
        assert!(eq.set_param("band.3.freq", 777.0));
        assert!(eq.set_param("band.3.q", 5.5));
        assert!(eq.set_param("band.3.gainDb", -8.0));
        assert!(eq.settings.enabled[3]);
        assert_eq!(eq.settings.modes[3], EqMode::Notch);
        assert_eq!(
            eq.settings.extra[0],
            Band {
                freq: 777.0,
                q: 5.5,
                gain_db: -8.0
            }
        );
    }
}
