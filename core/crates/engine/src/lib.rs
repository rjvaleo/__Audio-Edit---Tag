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
//! - [`device`] opens the output and pumps the other two. As thin as possible,
//!   because it is the only part a test cannot reach.

pub mod device;
pub mod input;
pub mod seqbus;
pub mod transport;

// The renderer and the stretcher live in prism-grain, shared with idMLab, and
// keep their old paths here.
pub use prism_grain::{render, stretcher};

pub use device::{conform_channels, resample, spawn, Engine, Handle};
pub use render::{BlockRenderer, Source};
pub use seqbus::SeqBus;
pub use stretcher::Stretcher;
pub use transport::{Core, Shared};
