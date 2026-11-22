//! MultiGrainLive's own instruments and effects as modules of the native
//! engine. Each wraps MGL's code as it is, so a fix made for MGL is a fix
//! here, and each is checked against what that code plays on its own.

mod ceiling;
pub mod atmos;
pub mod atmos_web;
pub mod chop;
pub mod demo;
pub mod edit_player;
pub mod fxchain;
pub mod rack;
mod fx;
pub mod grain;
pub mod sound;
mod suite;
mod wave;
pub mod wave_view;

pub use crate::atmos::{Atmos, AtmosState, AtmosView, Tuning};
pub use crate::atmos_web::module::{AtmosWebModule, AtmosWebState};
pub use crate::ceiling::Ceiling;
pub use crate::chop::{Chop, ChopThing};
pub use crate::rack::{Board, BoardThing, Rack, RackThing, Scope, SCOPE_LEN};
pub use mgl_fx::RackMeters;
pub use crate::fx::{Fx,FxState};
pub use crate::grain::{Grain, GrainThing, GrainState, Handle};
pub use crate::sound::Document;
pub use crate::edit_player::{EditPlayer, Transport};
pub use crate::suite::{Suite, SuiteThing, SuiteState};
pub use crate::wave::{Wave, WaveThing, WaveState};
pub use crate::wave_view::{WaveView, WAVE_POINTS};
