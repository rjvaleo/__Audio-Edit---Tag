//! The core of the local server: `App` and its state, http, json, persistence,
//! and the engine control the state holds (the live engine, grains, the rack,
//! automation, MIDI, the Wave synth and board). Every area crate builds on it;
//! see `docs/SERVER-CRATES.md`.

pub mod annot;
pub mod automation;
pub mod capture;
pub mod docs;
pub mod flac;
pub mod gpu;
pub mod grain_lfos;
pub mod grain_notes;
pub mod http;
pub mod json;
pub mod live;
pub mod log;
/// MIDI in for the Wave synth. See `docs/WAVE-SYNTH.md`.
pub mod midi;
pub mod offline;
pub mod pad;
pub mod persist;
pub mod rack;
pub mod rendercache;
pub mod safety;
pub mod state;
pub mod stems;
pub mod usertags;
/// The picture for a video export. See `docs/VIDEO-EXPORT.md`.
pub mod video;
/// The Wave page's FX board (v8): `/api/wave/board*`, `/api/wave/boards`,
/// `/api/wave/fx`. See `docs/WAVE-SYNTH.md`.
pub mod wave_board;
/// The Wave page's synth: `/api/wave/*`. See `docs/WAVE-SYNTH.md`.
pub mod wave_synth;
