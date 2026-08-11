//! Parameters something other than a hand can move.
//!
//! Every control in this crate is a field on a settings struct, which is fine
//! while the only thing setting it is a slider. It stops being fine the moment
//! anything else wants to: an envelope, an LFO, a recorded pass of automation,
//! a follower reading the input. All of those need to name a parameter, know
//! what range it lives in, and write to it at block rate — none of which a
//! struct field offers.
//!
//! So each effect also describes itself: a stable key per parameter, the range
//! it means something over, and how it should be swept. Automation then becomes
//! one small thing that writes keys, rather than a change to every effect.
//!
//! **The key is the contract.** It goes into saved automation and saved
//! presets, so renaming one silently detaches whatever was driving it. Add
//! parameters freely; rename them the way you would rename a column in a file
//! somebody else has on disk.

/// One parameter, described well enough to be driven blind.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ParamSpec {
    /// Stable across versions. This is what automation stores.
    pub key: &'static str,
    /// What a person should see.
    pub label: &'static str,
    pub min: f32,
    pub max: f32,
    pub default: f32,
    /// Sweep it logarithmically. True for anything measured in hertz or
    /// milliseconds, where the useful part of the range is at one end.
    pub log: bool,
    /// What to write after the number.
    pub unit: &'static str,
}

impl ParamSpec {
    pub const fn new(
        key: &'static str,
        label: &'static str,
        min: f32,
        max: f32,
        default: f32,
    ) -> Self {
        ParamSpec { key, label, min, max, default, log: false, unit: "" }
    }

    pub const fn log(mut self) -> Self {
        self.log = true;
        self
    }

    pub const fn unit(mut self, unit: &'static str) -> Self {
        self.unit = unit;
        self
    }

    pub fn clamp(&self, v: f32) -> f32 {
        if !v.is_finite() {
            return self.default;
        }
        v.clamp(self.min.min(self.max), self.max.max(self.min))
    }

    /// Where `v` sits in the range, 0..1 — which is what a modulator produces
    /// and an automation curve stores.
    pub fn to_unit(&self, v: f32) -> f32 {
        let v = self.clamp(v);
        if self.log && self.min > 0.0 && self.max > 0.0 {
            let (a, b) = (self.min.ln(), self.max.ln());
            ((v.max(1e-9).ln() - a) / (b - a)).clamp(0.0, 1.0)
        } else {
            ((v - self.min) / (self.max - self.min)).clamp(0.0, 1.0)
        }
    }

    /// The inverse. A modulator says 0.7; this says what that means.
    ///
    /// Clamped on the way out as well as the way in: a logarithmic sweep goes
    /// through `exp(ln(x))`, which does not land exactly on the end of the
    /// range, and a parameter that reads 19999.992 where its maximum is 20000
    /// is the kind of thing that fails a comparison somewhere much later.
    pub fn from_unit(&self, t: f32) -> f32 {
        let t = t.clamp(0.0, 1.0);
        // The ends exactly, rather than whatever the arithmetic lands on.
        // Clamping is not enough: `exp(ln(20000))` is 19999.992, which is
        // inside the range and so survives a clamp untouched.
        if t <= 0.0 {
            return self.min;
        }
        if t >= 1.0 {
            return self.max;
        }
        let v = if self.log && self.min > 0.0 && self.max > 0.0 {
            let (a, b) = (self.min.ln(), self.max.ln());
            (a + (b - a) * t).exp()
        } else {
            self.min + (self.max - self.min) * t
        };
        self.clamp(v)
    }
}

/// Anything whose parameters can be named, read and written.
///
/// Deliberately small. An effect implements three methods and becomes
/// automatable, modulatable and describable to the interface at once — and a
/// new effect that forgets to is obvious, because nothing can drive it.
pub trait Params {
    fn specs(&self) -> &'static [ParamSpec];

    /// Read one by key. `None` for a key this does not have, which is what a
    /// stale automation lane looks like after a rename.
    fn get(&self, key: &str) -> Option<f32>;

    /// Write one by key, clamped to its own range. `false` if unknown.
    ///
    /// Called per block once automation exists, so it must not allocate and
    /// must not be expensive — anything costly a parameter implies should be
    /// derived at use, not here.
    fn set(&mut self, key: &str, value: f32) -> bool;

    /// The spec for a key, for whatever needs the range rather than the value.
    fn spec(&self, key: &str) -> Option<&'static ParamSpec> {
        self.specs().iter().find(|s| s.key == key)
    }

    /// Put everything back where it started.
    fn reset_params(&mut self) {
        for s in self.specs() {
            self.set(s.key, s.default);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HZ: ParamSpec = ParamSpec::new("hz", "Frequency", 20.0, 20_000.0, 440.0)
        .log()
        .unit("Hz");
    const MIX: ParamSpec = ParamSpec::new("mix", "Mix", 0.0, 1.0, 0.5);

    #[test]
    fn a_value_survives_the_trip_through_unit_and_back() {
        for v in [20.0f32, 100.0, 440.0, 5000.0, 20_000.0] {
            let back = HZ.from_unit(HZ.to_unit(v));
            assert!((back / v - 1.0).abs() < 1e-4, "{v} came back as {back}");
        }
        for v in [0.0f32, 0.25, 0.5, 1.0] {
            assert!((MIX.from_unit(MIX.to_unit(v)) - v).abs() < 1e-6);
        }
    }

    /// The reason a frequency is swept logarithmically: halfway up the control
    /// should be halfway up what you hear, not halfway up the numbers.
    #[test]
    fn a_log_sweep_puts_the_middle_of_the_range_in_the_middle_of_hearing() {
        let mid = HZ.from_unit(0.5);
        assert!(
            (600.0..900.0).contains(&mid),
            "the middle of 20 Hz to 20 kHz should be near 630 Hz, not {mid}"
        );
        assert!(
            (MIX.from_unit(0.5) - 0.5).abs() < 1e-6,
            "a plain range should stay linear"
        );
    }

    #[test]
    fn anything_out_of_range_is_brought_back_in() {
        assert_eq!(MIX.clamp(9.0), 1.0);
        assert_eq!(MIX.clamp(-9.0), 0.0);
        assert_eq!(MIX.clamp(f32::NAN), MIX.default, "a NaN must not propagate");
        assert_eq!(HZ.to_unit(1e9), 1.0);
        assert_eq!(HZ.from_unit(9.0), HZ.max);
    }
}
