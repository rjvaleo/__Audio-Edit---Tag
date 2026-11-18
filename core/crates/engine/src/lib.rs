//! Real-time audio engine.
//!
//! Three layers, deliberately separable:
//!
//! - [`render`] turns the grain stream into blocks of audio. Pure, no device.
//! - [`stretcher`] holds every engine the callback can run and switches between
//!   them, so choosing an engine changes what you hear and not only what you
//!   export.
//! - [`transport`] adds play, seek, looping and live parameter exchange. Still
//!   no device — this is the audio callback minus the sound card, so it can be
//!   tested frame by frame.
//! - [`synth`] is the Wave page's synth deck, which has no transport and is
//!   mixed in before the master ceiling (`decks.rs`).
//! - [`keys`] is the Grain page's notes: AMP, Glide, Bend and Run, on the grain
//!   deck.
//! - [`voices`] is Poly: a full engine per held key.
//! - [`device`] opens the output and pumps the other two. As thin as possible,
//!   because it is the only part a test cannot reach.
//!
//! [`device`] and [`input`] are the only parts that touch the sound card
//! (cpal). They sit behind the `device` feature, on by default, so a host
//! with its own sound card code can build the rest without them.

pub mod brackets;
pub mod convert;
pub mod decks;
#[cfg(feature = "device")]
pub mod device;
pub mod glide;
#[cfg(feature = "device")]
pub mod input;
pub mod keys;
pub mod octaves;
pub mod seqbus;
pub mod synth;
pub mod transport;
pub mod voices;

// The renderer and the stretcher live in prism-grain, shared with idMLab, and
// keep their old paths here.
pub use prism_grain::{render, stretcher};

pub use decks::Decks;
pub use keys::{GrainKeys, KeyMode};
pub use convert::{conform_channels, resample};
#[cfg(feature = "device")]
pub use device::{spawn, spawn_with, Engine, Handle};
pub use render::{BlockRenderer, Source};
pub use seqbus::SeqBus;
pub use synth::{SynthDeck, WaveEvent, WaveShared, WAVE_POINTS};
pub use stretcher::Stretcher;
pub use transport::{Core, Shared};
