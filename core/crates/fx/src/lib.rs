//! The effect rack.
//!
//! Effects are non-destructive like everything else here: they live in a chain
//! attached to a file and are applied while rendering. Nothing is written to
//! the source, and removing an effect restores the original exactly.
//!
//! Every effect processes interleaved f32 in place and must not change the
//! buffer length — the edit engine's timeline arithmetic depends on it.

pub mod biquad;
pub mod comp;
pub mod decompose;
pub mod eq;
pub mod grain;
pub mod hstream;
pub mod hybrid;
pub mod master;
pub mod noise;
pub mod params;
pub mod nstream;
pub mod pstream;
pub mod pvsola;
pub mod shape;
pub mod stream;
pub mod stretch;
pub mod vstream;
pub mod transient;
pub mod vocoder;

pub use biquad::Coeffs;
pub use comp::Compressor;
pub use eq::Eq;
pub use grain::{Grain, GrainStream, StreamParams};
pub use master::{MasterSettings, Maximizer};
pub use stretch::Stretch;
pub use vocoder::Settings as VocoderSettings;

/// Anything that can process audio in place.
pub trait Effect: Send {
    /// Process `buf`, interleaved, `channels` wide.
    fn process(&mut self, buf: &mut [f32], channels: usize, sample_rate: u32);

    /// Clear any internal memory. Called before a render that does not start
    /// where the last one left off.
    fn reset(&mut self);

    /// Short label for the UI.
    fn name(&self) -> &'static str;

    /// Control-rate write, used by automation.
    ///
    /// An unknown key is ignored and reported as `false` rather than panicking
    /// or guessing: a lane saved against a control that has since been renamed
    /// should go quiet, not move something else. See [`crate::params`] for where
    /// the keys come from.
    fn set_param(&mut self, _key: &str, _value: f32) -> bool {
        false
    }
}

/// Keeps an effect's [`params::Params`] reachable after it is boxed into a rack.
///
/// `Box<dyn Effect>` erases the concrete type, and `Params` is a second trait —
/// once erased there is no way back to it. Wrapping preserves the one method
/// automation needs without widening `Effect` into a supertrait of `Params`,
/// which would force every effect to describe itself whether or not anything
/// can drive it.
pub struct Driven<T: Effect + params::Params>(pub T);

impl<T: Effect + params::Params> Effect for Driven<T> {
    fn process(&mut self, buf: &mut [f32], channels: usize, sample_rate: u32) {
        self.0.process(buf, channels, sample_rate)
    }
    fn reset(&mut self) {
        self.0.reset()
    }
    fn name(&self) -> &'static str {
        self.0.name()
    }
    fn set_param(&mut self, key: &str, value: f32) -> bool {
        self.0.set(key, value)
    }
}

/// A simple linear gain.
#[derive(Debug, Clone, Copy)]
pub struct Gain {
    pub db: f32,
}

impl Effect for Gain {
    fn process(&mut self, buf: &mut [f32], _channels: usize, _sample_rate: u32) {
        let g = 10f32.powf(self.db / 20.0);
        if (g - 1.0).abs() < 1e-9 {
            return;
        }
        for v in buf.iter_mut() {
            *v *= g;
        }
    }
    fn reset(&mut self) {}
    fn name(&self) -> &'static str {
        "Gain"
    }
    fn set_param(&mut self, key: &str, value: f32) -> bool {
        if key == "db" {
            self.db = value.clamp(GAIN_DB_MIN, GAIN_DB_MAX);
            true
        } else {
            false
        }
    }
}

/// The gain slot's range, in one place.
///
/// Automation stores a lane as a unit value and the range is the effect's, so
/// this is what a lane at 0 and at 1 mean. It has to be the same number the
/// interface's slider uses or a recorded gesture plays back somewhere else —
/// see `automation::rack_controls`.
pub const GAIN_DB_MIN: f32 = -24.0;
pub const GAIN_DB_MAX: f32 = 24.0;

/// One slot in the rack: an effect plus whether it is switched in.
pub struct Slot {
    pub effect: Box<dyn Effect>,
    pub bypassed: bool,
}

/// An ordered chain of effects.
///
/// Order matters and is the user's to choose — EQ before a compressor changes
/// what the compressor reacts to, which is a different sound from EQ after it.
#[derive(Default)]
pub struct Rack {
    pub slots: Vec<Slot>,
}

impl Rack {
    pub fn new() -> Self {
        Rack { slots: Vec::new() }
    }

    pub fn push(&mut self, effect: Box<dyn Effect>) {
        self.slots.push(Slot { effect, bypassed: false });
    }

    /// Push an effect that may already be switched out.
    ///
    /// Callers that address slots by position need every slot present, bypassed
    /// or not — see `RackSpec::build`.
    pub fn push_slot(&mut self, effect: Box<dyn Effect>, bypassed: bool) {
        self.slots.push(Slot { effect, bypassed });
    }

    pub fn is_empty(&self) -> bool {
        self.slots.iter().all(|s| s.bypassed) || self.slots.is_empty()
    }

    pub fn reset(&mut self) {
        for s in &mut self.slots {
            s.effect.reset();
        }
    }

    pub fn process(&mut self, buf: &mut [f32], channels: usize, sample_rate: u32) {
        for s in &mut self.slots {
            if !s.bypassed {
                s.effect.process(buf, channels, sample_rate);
            }
        }
    }

    /// Write one control on one slot. Out-of-range slots and unknown keys are
    /// ignored, for the same reason [`Effect::set_param`] ignores them.
    pub fn set_param(&mut self, slot: usize, key: &str, value: f32) -> bool {
        self.slots
            .get_mut(slot)
            .is_some_and(|s| s.effect.set_param(key, value))
    }

    /// How many frames of audio to run through the rack before the range the
    /// caller actually wants, so filter and envelope state is warmed up.
    ///
    /// Without this, seeking into the middle of a file restarts every filter
    /// from silence and the first fraction of a second sounds wrong.
    pub fn preroll_frames(&self, sample_rate: u32) -> u64 {
        if self.is_empty() {
            0
        } else {
            // 200 ms covers a slow compressor release and settles any biquad.
            (sample_rate as u64) / 5
        }
    }
}
