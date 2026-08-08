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
pub mod eq;
pub mod grain;
pub mod stretch;

pub use biquad::Coeffs;
pub use comp::Compressor;
pub use eq::Eq;
pub use grain::Grain;
pub use stretch::Stretch;

/// Anything that can process audio in place.
pub trait Effect: Send {
    /// Process `buf`, interleaved, `channels` wide.
    fn process(&mut self, buf: &mut [f32], channels: usize, sample_rate: u32);

    /// Clear any internal memory. Called before a render that does not start
    /// where the last one left off.
    fn reset(&mut self);

    /// Short label for the UI.
    fn name(&self) -> &'static str;
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
}

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
