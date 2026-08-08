//! Real-time audio engine.
//!
//! Three layers, deliberately separable:
//!
//! - [`render`] turns the grain stream into blocks of audio. Pure, no device.
//! - [`transport`] adds play, seek, looping and live parameter exchange. Still
//!   no device — this is the audio callback minus the sound card, so it can be
//!   tested frame by frame.
//! - [`device`] opens the output and pumps the other two. As thin as possible,
//!   because it is the only part a test cannot reach.

pub mod device;
pub mod render;
pub mod transport;

pub use device::{resample, Engine};
pub use render::{BlockRenderer, Source};
pub use transport::{Core, Shared};
