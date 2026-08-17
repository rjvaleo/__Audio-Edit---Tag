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
pub mod dattorro;
pub mod decompose;
pub mod eq;
pub mod grain;
pub mod hstream;
pub mod hybrid;
pub mod master;
pub mod noise;
pub mod params;
pub mod phaser;
pub mod nstream;
pub mod pstream;
pub mod pvsola;
pub mod reverb;
pub mod shape;
pub mod stream;
pub mod stretch;
pub mod tuning;
pub mod vstream;
pub mod transient;
pub mod vocoder;

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

pub use biquad::Coeffs;
pub use comp::Compressor;
pub use eq::Eq;
pub use grain::{Grain, GrainStream, StreamParams};
pub use master::{MasterSettings, Maximizer};
pub use stretch::Stretch;
pub use vocoder::Settings as VocoderSettings;

/// The most stages a rack can meter: every slot, plus the input, plus the master.
pub const MAX_RACK_STAGES: usize = 65;

/// Peak meters either side of every slot, written from the audio thread.
///
/// Atomics rather than a channel: the callback may not allocate or block, and a
/// meter that misses an update is a meter that is one block stale, which nobody
/// can see. Stage 0 is the rack's input; stage *n+1* is the output of slot *n*.
pub struct RackMeters {
    left: [AtomicU32; MAX_RACK_STAGES],
    right: [AtomicU32; MAX_RACK_STAGES],
    telemetry: [AtomicU32; MAX_RACK_STAGES],
}

impl RackMeters {
    pub fn new() -> Self {
        Self {
            left: std::array::from_fn(|_| AtomicU32::new(0)),
            right: std::array::from_fn(|_| AtomicU32::new(0)),
            telemetry: std::array::from_fn(|_| AtomicU32::new(0)),
        }
    }

    fn write(&self, stage: usize, buf: &[f32], channels: usize) {
        if stage >= MAX_RACK_STAGES {
            return;
        }
        let channels = channels.max(1);
        let (mut l, mut r) = (0.0f32, 0.0f32);
        for frame in buf.chunks(channels) {
            l = l.max(frame[0].abs());
            r = r.max(frame.get(1).copied().unwrap_or(frame[0]).abs());
        }
        self.left[stage].store(l.to_bits(), Ordering::Release);
        self.right[stage].store(r.to_bits(), Ordering::Release);
    }

    fn write_telemetry(&self, stage: usize, value: f32) {
        if stage < MAX_RACK_STAGES {
            self.telemetry[stage].store(value.to_bits(), Ordering::Release);
        }
    }

    pub fn snapshot(&self) -> Vec<(f32, f32)> {
        (0..MAX_RACK_STAGES)
            .map(|i| {
                (
                    f32::from_bits(self.left[i].load(Ordering::Acquire)),
                    f32::from_bits(self.right[i].load(Ordering::Acquire)),
                )
            })
            .collect()
    }

    pub fn telemetry_snapshot(&self) -> Vec<f32> {
        self.telemetry
            .iter()
            .map(|v| f32::from_bits(v.load(Ordering::Acquire)))
            .collect()
    }

    /// Zero everything. Called when playback stops, so the meters fall to
    /// silence rather than freezing at whatever was last heard.
    pub fn clear(&self) {
        for i in 0..MAX_RACK_STAGES {
            self.left[i].store(0, Ordering::Release);
            self.right[i].store(0, Ordering::Release);
            self.telemetry[i].store(0, Ordering::Release);
        }
    }
}

impl Default for RackMeters {
    fn default() -> Self {
        Self::new()
    }
}

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

    /// Read one control back.
    ///
    /// The mirror of [`Effect::set_param`], and needed for the same reason a
    /// fader needs to know where it is: a value can only be moved *smoothly*
    /// from somewhere, and the only thing that knows where a live effect
    /// currently sits is the effect.
    fn get_param(&self, _key: &str) -> Option<f32> {
        None
    }

    /// One scalar the interface can show for this effect, or zero.
    ///
    /// A compressor reports its current gain reduction as positive dB, which is
    /// the number that tells you whether it is doing anything. Effects with no
    /// such number say nothing rather than inventing one.
    fn telemetry(&self) -> f32 {
        0.0
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
    fn get_param(&self, key: &str) -> Option<f32> {
        self.0.get(key)
    }
    fn telemetry(&self) -> f32 {
        self.0.telemetry()
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
    fn get_param(&self, key: &str) -> Option<f32> {
        (key == "db").then_some(self.db)
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
/// Below this peak, a chain with nothing going into it counts as quiet.
///
/// About -80 dBFS: long after a reverb tail has gone, but above the
/// denormal-scale noise that would otherwise keep a rack running for ever.
///
/// Here rather than in the engine because both the live transport and the
/// offline renderer have to agree on when a tail has finished. They had no
/// reason to agree while only one of them had a tail; now that the export can
/// ring out too, a difference between them would mean the file did not end
/// where the sound did.
/// Somewhere for a long render to say how far it has got.
///
/// `Fn` behind a shared reference rather than `&mut dyn FnMut`, so it can be
/// copied into every engine and every closure without borrow gymnastics — the
/// stretchers nest (layers drive whole engine runs) and a `&mut` would have to
/// be reborrowed through each. The one implementation that matters writes
/// atomics, which needs no mutation.
///
/// The argument is **frames produced since the last call**, not a total. Only
/// the caller knows how many passes an engine will make, so accumulating is its
/// job; an engine just says what it did.
/// Returning `false` means "give up" — see [`tick`].
pub type Progress<'a> = Option<&'a (dyn Fn(u64) -> bool + Sync)>;

/// Report `n` more frames. `false` back means the caller wants to stop.
///
/// The stop channel rides on the progress one rather than being a second
/// argument because they are needed in exactly the same places — the chunk
/// loops — and a stretch that cannot be interrupted is a cancel button that
/// does nothing for minutes on a big render.
///
/// Stopping leaves the rest of the output buffer as the zeros it was allocated
/// with, so the length is still right and the caller gets a partial render
/// rather than a corrupt one. Nothing in the app keeps it: the only caller that
/// stops is an export being cancelled, and that deletes the file.
#[inline]
#[must_use]
pub fn tick(p: Progress, n: u64) -> bool {
    match p {
        Some(f) => f(n),
        None => true,
    }
}

pub const TAIL_SILENCE: f32 = 1e-4;

/// How long a chain goes on being processed after it last made a sound.
///
/// Four seconds covers any reverb worth having and the gap between repeats of a
/// slow delay. A countdown rather than a switch, so a delay that is briefly
/// silent between taps is not mistaken for a finished one.
pub fn tail_budget(sample_rate: u32) -> u64 {
    sample_rate as u64 * 4
}

/// The longest an offline tail may run, whatever the countdown says.
///
/// Reverb `freeze` is documented as the only way to reach an actually infinite
/// tail — it is unbounded by construction, and a render has to end. Live
/// playback needs no such cap because stopping is a thing the listener does.
pub const TAIL_CAP_SECONDS: u64 = 30;

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
    meters: Option<Arc<RackMeters>>,
}

impl Rack {
    pub fn new() -> Self {
        Rack { slots: Vec::new(), meters: None }
    }

    /// Share a meter block with whoever is drawing it. The rack writes; the
    /// interface reads a snapshot whenever it likes.
    pub fn set_meters(&mut self, meters: Arc<RackMeters>) {
        self.meters = Some(meters);
    }

    /// Stop writing meters.
    ///
    /// A rack being faded out of shares its meter block with the one coming
    /// in. Two writers on the same needles is a flicker between two different
    /// chains, and the one you want to watch is the one arriving.
    pub fn mute_meters(&mut self) {
        self.meters = None;
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
        if let Some(m) = &self.meters {
            m.write(0, buf, channels);
        }
        for (i, s) in self.slots.iter_mut().enumerate() {
            if !s.bypassed {
                s.effect.process(buf, channels, sample_rate);
            }
            // Metered even when bypassed, so a switched-out slot reads as
            // passing its input through rather than as silence.
            if let Some(m) = &self.meters {
                m.write(i + 1, buf, channels);
                m.write_telemetry(i + 1, s.effect.telemetry());
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

    /// Where a control currently sits, for anything that has to move it from
    /// there rather than to it.
    pub fn get_param(&self, slot: usize, key: &str) -> Option<f32> {
        self.slots.get(slot).and_then(|s| s.effect.get_param(key))
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
