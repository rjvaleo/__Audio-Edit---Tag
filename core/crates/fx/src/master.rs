//! The channel's own compressor, on one knob.
//!
//! The rack already has a compressor with every control a compressor has. This
//! is the other thing people want from one: not a set of decisions, but a
//! single "more" — no compression at the bottom, a maximiser at the top, and
//! the settings in between worked out rather than dialled.
//!
//! Two of those workings-out are worth naming, because they are what "auto"
//! means here.
//!
//! **Auto level** is an AGC, not a normalise. A normalise needs to see the
//! whole file before it can choose a gain, and this has to run in an audio
//! callback where there is no whole file — only the next few hundred frames.
//! So it tracks the level as it goes and walks the makeup gain toward whatever
//! puts the output at the ceiling. That also makes it behave the same live as
//! it does in the exported file, which a look-ahead normalise would not.
//!
//! **Auto compression** sets the threshold from the material instead of from a
//! number of dB. A threshold of −18 dB means something quite different to a
//! quiet recording than to a loud one; a threshold six dB under whatever the
//! signal is actually doing means the same thing to both. So the knob at a
//! given position squeezes by the same amount whatever you feed it.
//!
//! Whatever else happens, the output is held under the ceiling by a hard clamp
//! at the end. A maximiser that can still clip is not one.

use crate::Effect;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MasterSettings {
    pub on: bool,
    /// Nothing at zero, a maximiser at one. Everything else follows from it.
    pub amount: f32,
    /// Walk the makeup gain toward whatever puts the output at the ceiling.
    pub auto_level: bool,
    /// Take the threshold from the material rather than from a fixed dB.
    pub auto_comp: bool,
    /// The level the output is held under, and what auto level aims at.
    pub ceiling_db: f32,
}

impl Default for MasterSettings {
    fn default() -> Self {
        MasterSettings {
            on: false,
            amount: 0.5,
            auto_level: true,
            auto_comp: true,
            // Under nought, because a converter reconstructing a signal that
            // touches full scale can overshoot it.
            ceiling_db: -0.3,
        }
    }
}

impl MasterSettings {
    /// Whether this would change the sound at all.
    pub fn is_active(&self) -> bool {
        self.on && self.amount > 1e-4
    }

    /// How hard it squeezes. One is no compression at all.
    fn ratio(&self) -> f32 {
        // Geometric, so the first half of the knob is the part that shapes and
        // the top of it is the part that limits.
        20f32.powf(self.amount.clamp(0.0, 1.0))
    }

    /// How far under the signal the threshold sits, in dB. Only used when the
    /// threshold is taken from the material.
    fn under_db(&self) -> f32 {
        // Just above it at the bottom of the knob, well under it at the top.
        6.0 - 21.0 * self.amount.clamp(0.0, 1.0)
    }

    /// The fixed threshold, for when it is not taken from the material.
    fn fixed_db(&self) -> f32 {
        -24.0 * self.amount.clamp(0.0, 1.0)
    }

    fn attack_ms(&self) -> f32 {
        // Slower is gentler; a maximiser has to catch the peak it is holding
        // down, so the top of the knob is fast.
        40.0 * (1.0 - self.amount.clamp(0.0, 1.0)) + 1.0
    }

    fn release_ms(&self) -> f32 {
        400.0 * (1.0 - self.amount.clamp(0.0, 1.0)) + 40.0
    }

    fn knee_db(&self) -> f32 {
        // A wide knee low down keeps the onset from being audible; a maximiser
        // wants the corner.
        9.0 * (1.0 - self.amount.clamp(0.0, 1.0)) + 1.0
    }
}

const MIN_DB: f32 = -120.0;

/// The channel compressor and its level tracking.
pub struct Maximizer {
    pub settings: MasterSettings,
    /// Smoothed gain reduction in dB, never above zero.
    envelope_db: f32,
    /// A slow estimate of how loud the material is, for the threshold and the
    /// makeup to be worked out from.
    level_db: f32,
    /// Where the makeup gain has walked to.
    makeup_db: f32,
    /// Deepest reduction since the last reset, for the meter.
    max_reduction_db: f32,
    started: bool,
}

impl Maximizer {
    pub fn new(settings: MasterSettings) -> Self {
        Maximizer {
            settings,
            envelope_db: 0.0,
            level_db: MIN_DB,
            makeup_db: 0.0,
            max_reduction_db: 0.0,
            started: false,
        }
    }

    /// Deepest gain reduction so far, as a positive number of dB.
    pub fn gain_reduction_db(&self) -> f32 {
        -self.max_reduction_db
    }

    /// Where the makeup gain has ended up, in dB.
    pub fn makeup_db(&self) -> f32 {
        self.makeup_db
    }

    /// The static curve: level in, level out, both dB.
    fn curve(&self, level_db: f32, threshold_db: f32) -> f32 {
        let ratio = self.settings.ratio().max(1.0);
        let knee = self.settings.knee_db().max(0.0);
        let over = level_db - threshold_db;

        if knee > 0.0 && over > -knee / 2.0 && over < knee / 2.0 {
            let x = over + knee / 2.0;
            level_db + (1.0 / ratio - 1.0) * x * x / (2.0 * knee)
        } else if over <= 0.0 {
            level_db
        } else {
            threshold_db + over / ratio
        }
    }
}

/// One-pole smoothing coefficient for a time constant.
fn coeff(ms: f32, sample_rate: u32) -> f32 {
    let sr = sample_rate.max(1) as f32;
    let t = (ms.max(0.01) / 1000.0) * sr;
    (-1.0 / t).exp()
}

fn to_db(x: f32) -> f32 {
    if x > 1e-9 {
        20.0 * x.log10()
    } else {
        MIN_DB
    }
}

impl Effect for Maximizer {
    fn process(&mut self, buf: &mut [f32], channels: usize, sample_rate: u32) {
        if !self.settings.is_active() {
            return;
        }
        let channels = channels.max(1);
        let s = self.settings;
        let atk = coeff(s.attack_ms(), sample_rate);
        let rel = coeff(s.release_ms(), sample_rate);
        // The level estimate is deliberately slow — it is meant to describe the
        // passage, not the note, or the threshold would chase every transient
        // and there would be nothing left to compress against.
        let slow = coeff(250.0, sample_rate);
        // The makeup walks even more slowly, because an AGC that can move as
        // fast as the compressor is just a second compressor.
        let walk = coeff(900.0, sample_rate);
        let ceiling = s.ceiling_db;
        let ceiling_lin = 10f32.powf(ceiling / 20.0);

        let frames = buf.len() / channels;
        for f in 0..frames {
            let base = f * channels;

            // Detector: the loudest channel of the frame. Linked, so the image
            // is not pulled toward whichever side happens to be quieter.
            let mut peak = 0f32;
            for ch in 0..channels {
                let a = buf[base + ch].abs();
                if a > peak {
                    peak = a;
                }
            }
            let level_db = to_db(peak);

            // Track the material. Seeded from the first frame that has any
            // level in it, so a file starting in silence does not spend its
            // first second climbing out of −120.
            if !self.started && level_db > MIN_DB + 1.0 {
                self.level_db = level_db;
                self.started = true;
            }
            if level_db > self.level_db {
                // Follow a rise quickly; the loud part is the part that matters.
                self.level_db = level_db;
            } else {
                self.level_db = level_db + slow * (self.level_db - level_db);
            }

            let threshold_db = if s.auto_comp {
                (self.level_db + s.under_db()).clamp(-60.0, 0.0)
            } else {
                s.fixed_db()
            };

            let target_db = (self.curve(level_db, threshold_db) - level_db).min(0.0);
            let c = if target_db < self.envelope_db { atk } else { rel };
            self.envelope_db = target_db + c * (self.envelope_db - target_db);
            if !self.envelope_db.is_finite() {
                self.envelope_db = 0.0;
            }
            if self.envelope_db < self.max_reduction_db {
                self.max_reduction_db = self.envelope_db;
            }

            // Makeup. Auto walks it toward whatever puts the compressed signal
            // at the ceiling; otherwise it is the gain the curve itself implies,
            // so turning the knob up does not make the sound quieter.
            let want_db = if s.auto_level {
                (ceiling - (self.level_db + self.envelope_db)).clamp(0.0, 30.0)
            } else {
                (-self.curve(0.0, threshold_db)).clamp(0.0, 30.0)
            };
            self.makeup_db = want_db + walk * (self.makeup_db - want_db);
            if !self.makeup_db.is_finite() {
                self.makeup_db = 0.0;
            }

            let g = 10f32.powf((self.envelope_db + self.makeup_db) / 20.0);
            for ch in 0..channels {
                // The clamp is what makes the promise keepable. Everything
                // above is smoothed and can be caught out by a transient the
                // attack did not reach in time; this cannot.
                buf[base + ch] = (buf[base + ch] * g).clamp(-ceiling_lin, ceiling_lin);
            }
        }
    }

    fn reset(&mut self) {
        self.envelope_db = 0.0;
        self.level_db = MIN_DB;
        self.makeup_db = 0.0;
        self.max_reduction_db = 0.0;
        self.started = false;
    }

    fn name(&self) -> &'static str {
        "Maximizer"
    }

    /// Only `amount`. The ceiling and the two automatic modes are decisions
    /// about how the maximiser behaves, not things to sweep during a take, and
    /// automating the ceiling would put the one guarantee this effect makes —
    /// nothing above it — on a curve.
    fn set_param(&mut self, key: &str, value: f32) -> bool {
        if key == "amount" {
            self.settings.amount = value.clamp(0.0, 1.0);
            true
        } else {
            false
        }
    }
}
