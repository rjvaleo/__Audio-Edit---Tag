//! The native app's engine core.
//!
//! Two halves joined only by queues. The [`Controller`] lives on the app's
//! thread: it holds the patch, compiles it into a plan and sends plans, knob
//! moves, notes and sounds across. The [`AudioEngine`] lives on the sound
//! card's thread and runs the plan; normal rendering never allocates, locks or waits, and
//! whatever it has finished with goes back to the controller to be freed.
//! A caught panic may allocate inside Rust’s unwinder; its payload also goes
//! back to the controller, and the failed module stays silent until replaced.
//!
//! Every message carries the frame it lands on, and the engine cuts each block
//! at those frames. So the sound is a function of the patch and the stamped
//! messages alone: the block size, and which thread sent what when, do not
//! come into it.

#![deny(unsafe_code)]

pub mod basics;
mod engine;
pub mod guard;
mod module;
mod plan;
mod rebuild;
pub use rebuild::ModuleFactory;
pub mod rt;
mod sound;
pub mod spsc;
mod types;

pub use engine::{engine, AudioEngine, Collected, Config, Controller, Failure, PatchError};
pub use module::{EventKind, Inputs, Io, Module, Outputs, Thing};
pub use sound::{SoundData, Sounds, MAX_SOUNDS};
pub use types::{
    port, Buf, Cable, ClockState, Kind, ModuleId, NoteBuf, NoteEvent, NoteKind, PortRef, SoundRef,
    NOTE_CAP,
};
