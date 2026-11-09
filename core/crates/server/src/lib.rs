//! The local server behind the browser UI.

pub mod analytics;
pub mod annot;
pub mod automation;
pub mod capture;
pub mod compose;
pub mod docs;
pub mod grain_export;
pub mod grain_lfos;
pub mod grain_notes;
pub mod http;
pub mod live;
/// MIDI in for the Wave synth. See `docs/WAVE-SYNTH.md`.
pub mod midi;
pub mod offline;
pub mod pad;
pub mod perf;
pub mod padpresets;
pub mod json;
pub mod routes;
pub mod persist;
pub mod rack;
pub mod record;
pub mod rendercache;
pub mod retention;
pub mod safety;
pub mod serve;
pub mod state;
pub mod usertags;
/// The Wave page's synth: `/api/wave/*`. See `docs/WAVE-SYNTH.md`.
pub mod wave_synth;
/// The picture for a video export. See `docs/VIDEO-EXPORT.md`.
pub mod video;
