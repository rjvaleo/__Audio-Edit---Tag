//! MultiGrainLive's own instruments and effects as modules of the native
//! engine. Each wraps MGL's code as it is, so a fix made for MGL is a fix
//! here, and each is checked against what that code plays on its own.

mod ceiling;
mod fx;
pub mod grain;
pub mod sound;
mod suite;
mod wave;

pub use crate::ceiling::Ceiling;
pub use crate::fx::Fx;
pub use crate::grain::{Grain, GrainThing, Handle};
pub use crate::sound::Document;
pub use crate::suite::{Suite, SuiteThing};
pub use crate::wave::{Wave, WaveThing};
