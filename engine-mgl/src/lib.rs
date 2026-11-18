//! MultiGrainLive's own instruments and effects as modules of the native
//! engine. Each wraps MGL's code as it is, so a fix made for MGL is a fix
//! here, and each is checked against what that code plays on its own.

mod fx;
mod wave;

pub use crate::fx::Fx;
pub use crate::wave::Wave;
