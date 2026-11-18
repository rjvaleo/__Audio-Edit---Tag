//! The effect rack.
//!
//! Effects are non-destructive like everything else here: they live in a chain
//! attached to a file and are applied while rendering. Nothing is written to
//! the source, and removing an effect restores the original exactly.
//!
//! Every effect processes interleaved f32 in place and must not change the
//! buffer length — the edit engine's timeline arithmetic depends on it.

pub mod biquad;
// The sound engine lives in prism-grain, shared with idMLab. Its modules keep
// their old paths here, so nothing that reads `fx::grain` or `fx::stretch`
// had to change when they moved.
pub use prism_grain::{
    decompose, grain, hstream, hybrid, noise, nstream, pstream, pvsola, soundhack, stream, stretch, transient,
    tuning, vocoder, vstream,
};
pub mod comp;
pub mod dattorro;
pub mod eq;
pub mod master;
pub mod params;
pub mod phaser;
pub mod prism;
pub mod reverb;
pub mod shape;
pub mod suite;

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
/// True if every sample is a number: no NaN, no infinity. One pass over the
/// bits with no early way out, so it is a handful of instructions a block.
#[inline]
pub fn all_finite(buf: &[f32]) -> bool {
    const EXP: u32 = 0x7f80_0000;
    let mut bad = 0u32;
    for x in buf {
        bad |= ((x.to_bits() & EXP) == EXP) as u32;
    }
    bad == 0
}

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

/// Progress through a long render, and a way to stop it; see `prism_grain::tick`.
pub use prism_grain::{tick, Progress};

/// Where the soft ceiling starts. Below this nothing is touched at all.
///
/// −3 dBFS. Ordinary material never reaches it, so the curve is inaudible until
/// something is genuinely too loud.
pub const CEILING_KNEE: f32 = 0.7079458;

/// Round the peaks instead of slicing them.
///
/// A hard clip is a corner, and a corner is broadband distortion — it puts
/// energy at every frequency at once, which is the crackle you hear when a mix
/// runs hot. This is the same idea a mastering saturator uses: leave everything
/// below the knee exactly as it is, and bend what is above it along a `tanh`
/// that approaches full scale without ever reaching it.
///
/// Chosen over a limiter deliberately. A limiter holds the level by riding gain,
/// which is transparent until it is not and then audibly ducks whatever else is
/// playing. Asked which was preferred, the answer was "some light distortion
/// rather than hard clips" — so this colours the peak and leaves everything
/// else alone.
///
/// Zero latency, and no state: a sample's output depends on that sample only, so
/// it cannot pump, cannot overshoot, and behaves the same offline as live.
/// `tanh` is only evaluated for samples above the knee, which on normal material
/// is none of them.
#[inline]
pub fn soft_ceiling(x: f32) -> f32 {
    let a = x.abs();
    if a <= CEILING_KNEE {
        return x;
    }
    // Not a number: silence. The comparison above is false for one, and
    // `tanh` would hand it on to the converter.
    if a.is_nan() {
        return 0.0;
    }
    let span = CEILING - CEILING_KNEE;
    let y = CEILING_KNEE + span * ((a - CEILING_KNEE) / span).tanh();
    if x < 0.0 { -y } else { y }
}

/// Where the curve asymptotes: a hair under full scale, not at it.
///
/// `tanh` reaches 1.0 exactly in f32 arithmetic once its argument passes about
/// nine, so aiming at 1.0 puts every heavily-driven sample on the same value —
/// a flat top, which is the corner this exists to avoid. Aiming just under
/// leaves the output strictly inside full scale for any finite input.
///
/// −0.009 dB. Inaudible as a level; the point is only that it is not 1.0.
pub const CEILING: f32 = 0.999;

/// Apply it across a block.
pub fn soften(buf: &mut [f32]) {
    for s in buf.iter_mut() {
        *s = soft_ceiling(*s);
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

/// The control a slot's own Wet/dry goes by, 0..1. Addressed like any other
/// control (`/api/rack/param`, the smoothing in `transport.rs`).
pub const SLOT_WET: &str = "slot.wet";
/// The control a slot's own Level goes by, in dB.
pub const SLOT_LEVEL: &str = "slot.level";
pub const SLOT_LEVEL_MIN: f32 = -24.0;
pub const SLOT_LEVEL_MAX: f32 = 12.0;

/// How long a slot's Wet/dry and Level take to arrive, as a time constant.
const SLOT_MIX_TAU: f32 = 0.01;

/// How long a slot takes to fade from one effect to the next when its mode is
/// switched: 20 ms (SUITE-PLAN §2.0).
pub fn swap_fade_frames(sample_rate: u32) -> usize {
    sample_rate as usize / 50
}

/// Place's controls (prism-fx `place`), as a Reverb slot names them.
pub const PLACE_KEYS: [&str; 7] = ["place.on", "place.shape", "place.sizeM", "place.pos", "place.dist", "place.height", "place.spread"];

/// Write one of Place's controls into its settings, clamped. False for a key
/// that is not one of [`PLACE_KEYS`].
pub fn place_set(s: &mut prism::prism_fx::place::PlaceSettings, key: &str, v: f32) -> bool {
    if !v.is_finite() {
        return false;
    }
    match key {
        "place.on" => s.on = v >= 0.5,
        "place.shape" => s.shape = v.round().clamp(0.0, 5.0) as u8,
        "place.sizeM" => s.size_m = v.clamp(3.0, 80.0),
        "place.pos" => s.pos = v.clamp(-100.0, 100.0),
        "place.dist" => s.dist = v.clamp(0.0, 100.0),
        "place.height" => s.height = v.clamp(0.0, 100.0),
        "place.spread" => s.spread = v.clamp(0.0, 200.0),
        _ => return false,
    }
    true
}

/// Read one of Place's controls.
pub fn place_get(s: &prism::prism_fx::place::PlaceSettings, key: &str) -> Option<f32> {
    Some(match key {
        "place.on" => if s.on { 1.0 } else { 0.0 },
        "place.shape" => s.shape as f32,
        "place.sizeM" => s.size_m,
        "place.pos" => s.pos,
        "place.dist" => s.dist,
        "place.height" => s.height,
        "place.spread" => s.spread,
        _ => return None,
    })
}

pub struct Slot {
    pub effect: Box<dyn Effect>,
    pub bypassed: bool,
    /// Where a Reverb slot's sound sits (prism-fx `place`): before its effect,
    /// and Spread after it. Off, nothing.
    place: Option<Box<prism::prism_fx::place::Place>>,
    /// The effect this slot is fading to, and how far through the fade it is.
    incoming: Option<Box<dyn Effect>>,
    fade_at: usize,
    fade_len: usize,
    /// The effect a finished fade left behind, waiting to be dropped off the
    /// audio thread (`Rack::take_retired`).
    retired: Option<Box<dyn Effect>>,
    /// Where this module's footer is set: 0..1, and dB.
    wet: f32,
    level_db: f32,
    /// As a straight gain, and where each actually is on the way there.
    gain: f32,
    wet_now: f32,
    gain_now: f32,
}

impl Slot {
    fn new(effect: Box<dyn Effect>, bypassed: bool) -> Slot {
        Slot {
            effect,
            bypassed,
            place: None,
            incoming: None,
            fade_at: 0,
            fade_len: 0,
            retired: None,
            wet: 1.0,
            level_db: 0.0,
            gain: 1.0,
            wet_now: 1.0,
            gain_now: 1.0,
        }
    }

    /// Run the slot's effect — or, while it is fading to another, both, the
    /// old on `buf` and the new on a copy in `x`, joined with an equal-power
    /// curve. Past the fade's end the output is the new effect's own, bit for
    /// bit, and the old one is retired.
    fn run(&mut self, buf: &mut [f32], channels: usize, sample_rate: u32, x: &mut Vec<f32>) {
        let Some(next) = self.incoming.as_mut() else {
            self.effect.process(buf, channels, sample_rate);
            return;
        };
        // Only ever grown off the audio thread: `Rack::reserve_mix`.
        if x.len() < buf.len() {
            x.resize(buf.len(), 0.0);
        }
        let x = &mut x[..buf.len()];
        x.copy_from_slice(buf);
        self.effect.process(buf, channels, sample_rate);
        next.process(x, channels, sample_rate);
        let ch = channels.max(1);
        for (f, (o, n)) in buf.chunks_mut(ch).zip(x.chunks(ch)).enumerate() {
            let at = self.fade_at + f;
            if at >= self.fade_len {
                o.copy_from_slice(n);
                continue;
            }
            let t = at as f32 / self.fade_len as f32 * std::f32::consts::FRAC_PI_2;
            let (g_old, g_new) = (t.cos(), t.sin());
            for (o, n) in o.iter_mut().zip(n) {
                *o = *o * g_old + *n * g_new;
            }
        }
        self.fade_at += buf.len() / ch;
        if self.fade_at >= self.fade_len {
            self.land();
        }
    }

    /// Finish a fade: the new effect is the slot's, the old one waits.
    fn land(&mut self) {
        if let Some(next) = self.incoming.take() {
            self.retired = Some(std::mem::replace(&mut self.effect, next));
        }
    }

    /// Put the footer somewhere at once: for a slot being built, not played.
    pub fn set_mix(&mut self, wet: f32, level_db: f32) {
        self.set_wet(wet);
        self.set_level(level_db);
        self.wet_now = self.wet;
        self.gain_now = self.gain;
    }

    fn set_wet(&mut self, v: f32) {
        if v.is_finite() {
            self.wet = v.clamp(0.0, 1.0);
        }
    }

    fn set_level(&mut self, db: f32) {
        if db.is_finite() {
            self.level_db = db.clamp(SLOT_LEVEL_MIN, SLOT_LEVEL_MAX);
            self.gain = if self.level_db == 0.0 { 1.0 } else { 10f32.powf(self.level_db / 20.0) };
        }
    }

    /// Nothing to do but run the effect, which is almost always.
    fn plain(&self) -> bool {
        self.wet == 1.0 && self.gain == 1.0 && self.wet_now == 1.0 && self.gain_now == 1.0
    }

    /// Mix what came out of the effect with what went in, and trim it.
    fn blend(&mut self, wet: &mut [f32], dry: &[f32], channels: usize, sample_rate: u32) {
        let ch = channels.max(1);
        let k = 1.0 - (-1.0 / (SLOT_MIX_TAU * sample_rate.max(1) as f32)).exp();
        for (w, d) in wet.chunks_mut(ch).zip(dry.chunks(ch)) {
            self.wet_now += (self.wet - self.wet_now) * k;
            self.gain_now += (self.gain - self.gain_now) * k;
            for (w, d) in w.iter_mut().zip(d) {
                *w = (*d + (*w - *d) * self.wet_now) * self.gain_now;
            }
        }
        // Land, so a footer put back where it was costs nothing again.
        if (self.wet - self.wet_now).abs() < 1e-5 {
            self.wet_now = self.wet;
        }
        if (self.gain - self.gain_now).abs() < 1e-5 {
            self.gain_now = self.gain;
        }
    }
}

/// An ordered chain of effects.
///
/// Order matters and is the user's to choose — EQ before a compressor changes
/// what the compressor reacts to, which is a different sound from EQ after it.
#[derive(Default)]
pub struct Rack {
    pub slots: Vec<Slot>,
    meters: Option<Arc<RackMeters>>,
    /// What went into a module with a footer in use. See [`Rack::reserve_mix`].
    dry: Vec<f32>,
    /// What went into a slot fading between two effects, for the new one.
    xfade: Vec<f32>,
    /// Place works on the two sides apart.
    place_l: Vec<f32>,
    place_r: Vec<f32>,
    /// How many times a block that was not all numbers was caught and
    /// silenced. See [`Rack::process`].
    tripped: u32,
}

impl Rack {
    pub fn new() -> Self {
        Rack { slots: Vec::new(), meters: None, dry: Vec::new(), xfade: Vec::new(), place_l: Vec::new(), place_r: Vec::new(), tripped: 0 }
    }

    /// How many blocks have been silenced because an effect, or what came into
    /// the rack, gave a sample that was not a number.
    pub fn tripped(&self) -> u32 {
        self.tripped
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
        self.slots.push(Slot::new(effect, false));
    }

    /// Push an effect that may already be switched out.
    ///
    /// Callers that address slots by position need every slot present, bypassed
    /// or not — see `RackSpec::build`.
    pub fn push_slot(&mut self, effect: Box<dyn Effect>, bypassed: bool) {
        self.slots.push(Slot::new(effect, bypassed));
    }

    pub fn is_empty(&self) -> bool {
        self.slots.iter().all(|s| s.bypassed) || self.slots.is_empty()
    }

    pub fn reset(&mut self) {
        for s in &mut self.slots {
            s.effect.reset();
            if let Some(n) = s.incoming.as_mut() {
                n.reset();
            }
            if let Some(p) = s.place.as_mut() {
                p.reset();
            }
        }
    }

    /// Room for a block of this many samples, so that a footer moved while
    /// the audio thread is running the rack does not have to allocate there.
    pub fn reserve_mix(&mut self, samples: usize) {
        if self.dry.len() < samples {
            self.dry.resize(samples, 0.0);
        }
        if self.xfade.len() < samples {
            self.xfade.resize(samples, 0.0);
        }
        if self.place_l.len() < samples {
            self.place_l.resize(samples, 0.0);
            self.place_r.resize(samples, 0.0);
        }
    }

    /// Give slot `slot` a Place, or take it away. Built off the audio thread.
    pub fn set_slot_place(&mut self, slot: usize, place: Option<Box<prism::prism_fx::place::Place>>) {
        if let Some(s) = self.slots.get_mut(slot) {
            s.place = place;
        }
    }

    /// Fade slot `slot` to `effect` over `fade_frames` (SUITE-PLAN §2.0): what
    /// a mode switch does to the running rack. Every other slot goes on as it
    /// was. `effect` is built off the audio thread; nothing here allocates or
    /// frees, and the effect a fade leaves behind waits in
    /// [`Rack::take_retired`]. A bypassed slot takes it at once.
    ///
    /// Handed back if there is no such slot, or the slot is still fading or
    /// still holds a retired effect.
    pub fn swap_slot(&mut self, slot: usize, effect: Box<dyn Effect>, fade_frames: usize) -> Result<(), Box<dyn Effect>> {
        if !self.can_swap(slot) {
            return Err(effect);
        }
        let s = &mut self.slots[slot];
        s.incoming = Some(effect);
        s.fade_at = 0;
        s.fade_len = fade_frames.max(1);
        if s.bypassed {
            s.land();
        }
        Ok(())
    }

    /// Whether [`Rack::swap_slot`] would take an effect for slot `slot` now.
    pub fn can_swap(&self, slot: usize) -> bool {
        self.slots.get(slot).is_some_and(|s| s.incoming.is_none() && s.retired.is_none())
    }

    /// Whether slot `slot` is fading between two effects.
    pub fn swapping(&self, slot: usize) -> bool {
        self.slots.get(slot).is_some_and(|s| s.incoming.is_some())
    }

    /// An effect a finished fade left behind, for the caller to drop off the
    /// audio thread. One at a time; None when there is nothing waiting.
    pub fn take_retired(&mut self) -> Option<Box<dyn Effect>> {
        self.slots.iter_mut().find_map(|s| s.retired.take())
    }

    /// **A sample that is not a number never gets past the stage that made
    /// it.** One NaN in a reverb's tank or a filter's memory stays there for
    /// good and every block after it is NaN too. So what comes in is checked,
    /// and what each effect gives: a bad block is silenced and that effect's
    /// memory cleared, and the ones before and after it carry on.
    pub fn process(&mut self, buf: &mut [f32], channels: usize, sample_rate: u32) {
        if !all_finite(buf) {
            buf.fill(0.0);
            self.tripped = self.tripped.wrapping_add(1);
        }
        if let Some(m) = &self.meters {
            m.write(0, buf, channels);
        }
        for (i, s) in self.slots.iter_mut().enumerate() {
            if !s.bypassed {
                let placed = s.place.as_ref().is_some_and(|p| p.settings().on);
                if placed {
                    place_pass(s.place.as_deref_mut().unwrap(), buf, channels, &mut self.place_l, &mut self.place_r, true);
                }
                if s.plain() {
                    s.run(buf, channels, sample_rate, &mut self.xfade);
                    if placed {
                        place_pass(s.place.as_deref_mut().unwrap(), buf, channels, &mut self.place_l, &mut self.place_r, false);
                    }
                } else {
                    // Only ever grown off the audio thread: a rack built for
                    // the device has `reserve_mix`ed its largest block.
                    if self.dry.len() < buf.len() {
                        self.dry.resize(buf.len(), 0.0);
                    }
                    let dry = &mut self.dry[..buf.len()];
                    dry.copy_from_slice(buf);
                    s.run(buf, channels, sample_rate, &mut self.xfade);
                    if placed {
                        place_pass(s.place.as_deref_mut().unwrap(), buf, channels, &mut self.place_l, &mut self.place_r, false);
                    }
                    s.blend(buf, dry, channels, sample_rate);
                }
                if !all_finite(buf) {
                    buf.fill(0.0);
                    s.effect.reset();
                    if let Some(n) = s.incoming.as_mut() {
                        n.reset();
                    }
                    if let Some(p) = s.place.as_mut() {
                        p.reset();
                    }
                    self.tripped = self.tripped.wrapping_add(1);
                }
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
        let Some(s) = self.slots.get_mut(slot) else { return false };
        match key {
            SLOT_WET => {
                s.set_wet(value);
                true
            }
            SLOT_LEVEL => {
                s.set_level(value);
                true
            }
            k if k.starts_with("place.") => match s.place.as_deref_mut() {
                Some(p) => {
                    let mut st = p.settings();
                    if place_set(&mut st, k, value) {
                        p.set(st);
                        true
                    } else {
                        false
                    }
                }
                None => false,
            },
            // While a slot fades, a control reaches the effect it is fading
            // to; the one leaving takes it too, where it has it.
            _ => {
                let old = s.effect.set_param(key, value);
                match s.incoming.as_mut() {
                    Some(n) => n.set_param(key, value),
                    None => old,
                }
            }
        }
    }

    /// Where a control currently sits, for anything that has to move it from
    /// there rather than to it.
    pub fn get_param(&self, slot: usize, key: &str) -> Option<f32> {
        let s = self.slots.get(slot)?;
        match key {
            SLOT_WET => Some(s.wet),
            SLOT_LEVEL => Some(s.level_db),
            k if k.starts_with("place.") => s.place.as_ref().and_then(|p| place_get(&p.settings(), k)),
            _ => match s.incoming.as_ref() {
                Some(n) => n.get_param(key),
                None => s.effect.get_param(key),
            },
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

/// Run Place on an interleaved block: before the effect (the room) or after
/// it (Spread). Its scratch is only grown off the audio thread
/// ([`Rack::reserve_mix`]).
fn place_pass(p: &mut prism::prism_fx::place::Place, buf: &mut [f32], channels: usize, l: &mut Vec<f32>, r: &mut Vec<f32>, before: bool) {
    let ch = channels.max(1);
    let frames = buf.len() / ch;
    if l.len() < frames {
        l.resize(frames, 0.0);
        r.resize(frames, 0.0);
    }
    let (l, r) = (&mut l[..frames], &mut r[..frames]);
    for (f, frame) in buf.chunks(ch).enumerate() {
        l[f] = frame[0];
        r[f] = if ch > 1 { frame[1] } else { frame[0] };
    }
    if before {
        p.before(l, r);
    } else {
        p.after(l, r);
    }
    for (f, frame) in buf.chunks_mut(ch).enumerate() {
        if ch > 1 {
            frame[0] = l[f];
            frame[1] = r[f];
        } else {
            frame[0] = 0.5 * (l[f] + r[f]);
        }
    }
}
