//! Wave: the wavetable synth behind the Wave page.
//!
//! Pure DSP. No I/O, no threads, no server, no audio device: the engine owns a
//! [`Synth`] in its synth deck and calls it from the callback; the server owns
//! the [`Patch`] and the tables and hands them over. `docs/WAVE-SYNTH.md` is
//! the contract for every key, range and unit law used here.
//!
//! # The hard rule
//!
//! **Nothing allocates, locks or does an FFT inside [`Synth::render`],
//! [`Synth::note_on`], [`Synth::note_off`], [`Synth::set_param`],
//! [`Synth::set_table`], [`Synth::adopt`], [`Synth::bend`],
//! [`Synth::mod_wheel`], [`Synth::aftertouch`] or [`Synth::telemetry`].**
//! Everything they touch is allocated by [`Synth::new`]. The expensive things
//! happen on the caller's thread:
//! - [`Wavetable::from_frames`] resamples, normalises and builds the mips
//!   (FFTs, allocation);
//! - [`PatchState::new`] compiles a [`Patch`] (string parsing);
//! - a table replaced by [`Synth::set_table`] comes back to the caller to be
//!   dropped there.
//!
//! `tests/no_alloc.rs` checks the rule with a counting allocator.
//!
//! # API
//!
//! ```text
//! Wavetable::from_frames(&[Vec<f32>]) -> Wavetable
//! Wavetable::preview(&self, points) -> Vec<Vec<f32>>      frame_count(&self) -> usize
//! builtin_tables() -> Vec<(String, Vec<Vec<f32>>)>
//!
//! Patch::default()        set_num/get_num, set_str/get_str, set_points/get_points
//! Patch::entries()        every key and its Value, for serialising
//! patch.mods: Vec<Mod>    Mod { src, dst, amt, curve, via }
//! PatchState::new(&Patch) param_id(key) -> Option<ParamId>   ParamId::key()
//!
//! Synth::new(sample_rate, max_block)   Synth::with_oversampling(sr, max_block, true)
//! synth.adopt(PatchState)              synth.set_param(ParamId, f32) -> bool
//! synth.set_table(osc, Arc<Wavetable>) -> Option<Arc<Wavetable>>
//! synth.note_on(note, vel)  note_off(note)  bend(-1..1)  mod_wheel(0..1)  aftertouch(0..1)
//! synth.render(&mut left, &mut right)
//! synth.telemetry(&mut Telemetry)
//! ```
//!
//! # Signal path
//!
//! Per voice: three wavetable oscillators (unison, two warp slots, a cycle
//! effect, DC blocker) → each oscillator's time-domain effect → its route →
//! the two filters (serial, parallel or split), with the sub and noise into
//! Filter 1 → the amp envelope × velocity. Voices are summed and scaled by
//! `master`, then run through the master chain (Drive, Chorus, Delay, Reverb,
//! EQ: `master_fx.rs`). The modules' own docs explain each decision.

pub mod env;
pub mod filter;
mod fx;
mod master_fx;
mod osc;
pub mod patch;
pub mod synth;
pub mod table;
mod voice;
pub mod warp;

pub use env::Stage;
pub use patch::{
    lfo_hz, param_id, Curve, FilterRoute, FilterType, FxMode, LfoMode, LfoWave, Mod, ParamId, Patch, PatchState, Route, Value, VoiceMode,
    KEYS, NUM_PARAMS, POINT_KEYS, STR_KEYS,
};
pub use synth::{Synth, Telemetry, VoiceInfo, MAX_VOICES, POLYPHONY};
pub use table::{builtin_frames, builtin_tables, Wavetable, BUILTIN_NAMES, FRAME_LEN, MAX_FRAMES, MIP_LEVELS};
pub use warp::WarpMode;
