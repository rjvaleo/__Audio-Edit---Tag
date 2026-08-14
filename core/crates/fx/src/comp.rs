//! Feed-forward compressor with a soft knee.
//!
//! The detector is linked across channels — one envelope derived from the
//! loudest channel drives the gain for all of them. Independent per-channel
//! detection would pull the stereo image toward whichever side is quieter.

use crate::Effect;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CompSettings {
    pub threshold_db: f32,
    /// 1.0 is no compression; 20.0 is close to limiting.
    pub ratio: f32,
    pub attack_ms: f32,
    pub release_ms: f32,
    /// Width of the soft knee in dB. 0 is a hard corner.
    pub knee_db: f32,
    pub makeup_db: f32,
}

impl Default for CompSettings {
    fn default() -> Self {
        CompSettings {
            threshold_db: -18.0,
            ratio: 4.0,
            attack_ms: 10.0,
            release_ms: 120.0,
            knee_db: 6.0,
            makeup_db: 0.0,
        }
    }
}

pub struct Compressor {
    pub settings: CompSettings,
    /// Smoothed gain reduction in dB, always <= 0.
    envelope_db: f32,
    /// Largest reduction applied since the last reset, for the UI meter.
    max_reduction_db: f32,
}

impl Compressor {
    pub fn new(settings: CompSettings) -> Self {
        Compressor { settings, envelope_db: 0.0, max_reduction_db: 0.0 }
    }

    /// Peak gain reduction seen so far, as a positive number of dB.
    pub fn gain_reduction_db(&self) -> f32 {
        -self.max_reduction_db
    }

    /// The static curve: input level in, output level out, both dB.
    fn curve(&self, level_db: f32) -> f32 {
        let s = &self.settings;
        let ratio = s.ratio.max(1.0);
        let knee = s.knee_db.max(0.0);
        let over = level_db - s.threshold_db;

        if knee > 0.0 && over > -knee / 2.0 && over < knee / 2.0 {
            // Quadratic bend across the knee, so the onset is not audible as a
            // sudden corner on material sitting right at the threshold.
            let x = over + knee / 2.0;
            level_db + (1.0 / ratio - 1.0) * x * x / (2.0 * knee)
        } else if over <= 0.0 {
            level_db
        } else {
            s.threshold_db + over / ratio
        }
    }
}

/// One-pole smoothing coefficient for a given time constant.
fn coeff(ms: f32, sample_rate: u32) -> f32 {
    let sr = sample_rate.max(1) as f32;
    let t = (ms.max(0.01) / 1000.0) * sr;
    (-1.0 / t).exp()
}

const MIN_DB: f32 = -120.0;

impl Effect for Compressor {
    fn process(&mut self, buf: &mut [f32], channels: usize, sample_rate: u32) {
        let channels = channels.max(1);
        let atk = coeff(self.settings.attack_ms, sample_rate);
        let rel = coeff(self.settings.release_ms, sample_rate);
        let makeup = 10f32.powf(self.settings.makeup_db / 20.0);

        let frames = buf.len() / channels;
        for f in 0..frames {
            let base = f * channels;

            // Detector: the loudest channel in this frame.
            let mut peak = 0f32;
            for ch in 0..channels {
                let a = buf[base + ch].abs();
                if a > peak {
                    peak = a;
                }
            }
            let level_db = if peak > 0.0 { 20.0 * peak.log10() } else { MIN_DB };
            let target_db = (self.curve(level_db) - level_db).min(0.0);

            // Attack when clamping down harder, release when letting go.
            let c = if target_db < self.envelope_db { atk } else { rel };
            self.envelope_db = target_db + c * (self.envelope_db - target_db);
            if !self.envelope_db.is_finite() {
                self.envelope_db = 0.0;
            }
            if self.envelope_db < self.max_reduction_db {
                self.max_reduction_db = self.envelope_db;
            }

            let g = 10f32.powf(self.envelope_db / 20.0) * makeup;
            for ch in 0..channels {
                buf[base + ch] *= g;
            }
        }
    }

    fn reset(&mut self) {
        self.envelope_db = 0.0;
        self.max_reduction_db = 0.0;
    }

    fn name(&self) -> &'static str {
        "Compressor"
    }

    /// Current gain reduction, as positive dB. This is the number that says
    /// whether the compressor is working, and the only one worth a meter.
    fn telemetry(&self) -> f32 {
        -self.envelope_db
    }

    fn get_param(&self, key: &str) -> Option<f32> {
        Some(match key {
            "thresholdDb" => self.settings.threshold_db,
            "ratio" => self.settings.ratio,
            "attackMs" => self.settings.attack_ms,
            "releaseMs" => self.settings.release_ms,
            "kneeDb" => self.settings.knee_db,
            "makeupDb" => self.settings.makeup_db,
            _ => return None,
        })
    }

    /// The same ranges the interface offers — see [`crate::eq::EQ_FREQ_MIN`].
    fn set_param(&mut self, key: &str, value: f32) -> bool {
        match key {
            "thresholdDb" => self.settings.threshold_db = value.clamp(COMP_THRESHOLD_MIN, 0.0),
            "ratio" => self.settings.ratio = value.clamp(COMP_RATIO_MIN, COMP_RATIO_MAX),
            "attackMs" => self.settings.attack_ms = value.clamp(COMP_ATTACK_MIN, COMP_ATTACK_MAX),
            "releaseMs" => {
                self.settings.release_ms = value.clamp(COMP_RELEASE_MIN, COMP_RELEASE_MAX)
            }
            "kneeDb" => self.settings.knee_db = value.clamp(0.0, COMP_KNEE_MAX),
            "makeupDb" => self.settings.makeup_db = value.clamp(COMP_MAKEUP_MIN, COMP_MAKEUP_MAX),
            _ => return false,
        }
        true
    }
}

pub const COMP_THRESHOLD_MIN: f32 = -60.0;
pub const COMP_RATIO_MIN: f32 = 1.0;
pub const COMP_RATIO_MAX: f32 = 20.0;
pub const COMP_ATTACK_MIN: f32 = 0.05;
pub const COMP_ATTACK_MAX: f32 = 500.0;
pub const COMP_RELEASE_MIN: f32 = 5.0;
pub const COMP_RELEASE_MAX: f32 = 3000.0;
pub const COMP_KNEE_MAX: f32 = 24.0;
pub const COMP_MAKEUP_MIN: f32 = -24.0;
pub const COMP_MAKEUP_MAX: f32 = 24.0;
