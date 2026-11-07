//! ADSR envelopes: the amp envelope and ENV 2–4.
//!
//! Ported from idMLab's `dsp-core/src/envelope.rs`, which made the decision
//! that matters here: an envelope tracks *progress* through each stage instead
//! of running a one-pole toward an overshot target. A one-pole never arrives,
//! so a release decays toward zero without reaching it and the voice either
//! lingers holding a slot or is cut at an arbitrary floor. With progress, a
//! stage of *t* seconds takes *t* seconds and lands exactly on its target, and
//! the voice bank frees a voice the moment its release ends.
//!
//! The shapes are the mock-up's: a linear attack (Web Audio's
//! `linearRampToValueAtTime`), then a decay and release that ease out, which is
//! the curve of its `setTargetAtTime` drawn so it ends on time.
//!
//! The times are the contract's: attack `a²·4` s, decay `d²·4` s, release
//! `r²·6` s. [`Adsr::set`] takes the normalised values and does the mapping, so
//! no caller can apply a different law.

/// Shortest stage. Zero would be a click; this reads as instant.
pub const MIN_STAGE_SEC: f32 = 0.0005;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Stage {
    #[default]
    Idle,
    Attack,
    Decay,
    Sustain,
    Release,
}

impl Stage {
    pub fn as_str(self) -> &'static str {
        match self {
            Stage::Idle => "idle",
            Stage::Attack => "attack",
            Stage::Decay => "decay",
            Stage::Sustain => "sustain",
            Stage::Release => "release",
        }
    }
}

/// The contract's time laws.
pub fn attack_seconds(a: f32) -> f32 {
    a * a * 4.0
}
pub fn decay_seconds(d: f32) -> f32 {
    d * d * 4.0
}
pub fn release_seconds(r: f32) -> f32 {
    r * r * 6.0
}

/// Ease-out that hits both ends exactly.
#[inline]
fn eased(progress: f32) -> f32 {
    let r = 1.0 - progress;
    1.0 - r * r * r
}

#[derive(Clone, Debug)]
pub struct Adsr {
    sample_rate: f32,
    attack: f32,
    decay: f32,
    sustain: f32,
    release: f32,
    stage: Stage,
    progress: f32,
    value: f32,
    stage_start: f32,
}

impl Adsr {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate: if sample_rate > 0.0 { sample_rate } else { 48_000.0 },
            attack: 0.01,
            decay: 0.1,
            sustain: 0.7,
            release: 0.2,
            stage: Stage::Idle,
            progress: 0.0,
            value: 0.0,
            stage_start: 0.0,
        }
    }

    /// The patch's normalised a, d, s, r.
    pub fn set(&mut self, a: f32, d: f32, s: f32, r: f32) {
        self.attack = attack_seconds(a).max(MIN_STAGE_SEC);
        self.decay = decay_seconds(d).max(MIN_STAGE_SEC);
        self.sustain = s.clamp(0.0, 1.0);
        self.release = release_seconds(r).max(MIN_STAGE_SEC);
    }

    pub fn stage(&self) -> Stage {
        self.stage
    }

    pub fn value(&self) -> f32 {
        self.value
    }

    pub fn is_active(&self) -> bool {
        self.stage != Stage::Idle
    }

    /// Note on. Starts from wherever it is, so a retrigger does not click.
    pub fn gate_on(&mut self) {
        self.stage = Stage::Attack;
        self.progress = 0.0;
        self.stage_start = self.value;
    }

    /// Note off, from wherever it is, including mid-attack.
    pub fn gate_off(&mut self) {
        if self.stage == Stage::Idle {
            return;
        }
        self.stage = Stage::Release;
        self.progress = 0.0;
        self.stage_start = self.value;
    }

    pub fn kill(&mut self) {
        self.stage = Stage::Idle;
        self.progress = 0.0;
        self.value = 0.0;
        self.stage_start = 0.0;
    }

    #[inline]
    fn step(&self, seconds: f32) -> f32 {
        1.0 / (seconds * self.sample_rate).max(1.0)
    }

    /// Advance one sample and return the new level.
    #[allow(clippy::should_implement_trait)]
    #[inline]
    pub fn next(&mut self) -> f32 {
        match self.stage {
            Stage::Idle => self.value = 0.0,
            Stage::Attack => {
                self.progress += self.step(self.attack);
                if self.progress >= 1.0 {
                    self.value = 1.0;
                    self.stage = Stage::Decay;
                    self.progress = 0.0;
                    self.stage_start = 1.0;
                } else {
                    self.value = self.stage_start + (1.0 - self.stage_start) * self.progress;
                }
            }
            Stage::Decay => {
                self.progress += self.step(self.decay);
                if self.progress >= 1.0 {
                    self.value = self.sustain;
                    self.stage = Stage::Sustain;
                    self.progress = 0.0;
                } else {
                    self.value = self.stage_start + (self.sustain - self.stage_start) * eased(self.progress);
                }
            }
            // The sustain follows its control while held, as a knob should.
            Stage::Sustain => self.value = self.sustain,
            Stage::Release => {
                self.progress += self.step(self.release);
                if self.progress >= 1.0 {
                    self.value = 0.0;
                    self.stage = Stage::Idle;
                    self.progress = 0.0;
                    self.stage_start = 0.0;
                } else {
                    self.value = self.stage_start * (1.0 - eased(self.progress));
                }
            }
        }
        self.value
    }

    /// Advance `n` samples; the level after the last.
    #[inline]
    pub fn skip(&mut self, n: usize) -> f32 {
        for _ in 0..n {
            self.next();
        }
        self.value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    #[test]
    fn stages_take_their_documented_times() {
        let mut e = Adsr::new(SR);
        e.set(0.5, 0.5, 0.4, 0.5); // 1 s, 1 s, 1.5 s
        e.gate_on();
        let mut n = 0;
        while e.stage() == Stage::Attack {
            e.next();
            n += 1;
        }
        assert!((n as f32 / SR - 1.0).abs() < 0.001, "attack {n}");
        let mut n = 0;
        while e.stage() == Stage::Decay {
            e.next();
            n += 1;
        }
        assert!((n as f32 / SR - 1.0).abs() < 0.001, "decay {n}");
        assert_eq!(e.value(), 0.4);
        e.gate_off();
        let mut n = 0;
        while e.is_active() {
            e.next();
            n += 1;
        }
        assert!((n as f32 / SR - 1.5).abs() < 0.001, "release {n}");
        assert_eq!(e.value(), 0.0);
    }

    #[test]
    fn a_retrigger_starts_from_where_it_is() {
        let mut e = Adsr::new(SR);
        e.set(0.2, 0.2, 0.5, 0.2);
        e.gate_on();
        e.skip(48_000);
        let before = e.value();
        e.gate_on();
        let after = e.next();
        assert!((after - before).abs() < 0.01);
    }
}
