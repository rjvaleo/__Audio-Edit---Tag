//! The library and search: browsing, tags, the sound map, the audio views.
//!
//! Moved out of the server crate (task 007); `server`'s `routes.rs` is still
//! the one table that calls these. See `docs/SERVER-CRATES.md`.

// The core's modules as `crate::…`, as in the one crate they came from.
pub use server_core::*;

pub mod routes;
