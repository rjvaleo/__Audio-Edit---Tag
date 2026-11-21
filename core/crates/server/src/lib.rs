//! The local server behind the browser UI.
//!
//! Since task 007 it is split by area into crates (`docs/SERVER-CRATES.md`):
//! this one keeps the route table, `serve`, and every old `server::…` path.

pub use server_core::*;
pub use server_compose::compose;
pub use server_engine::padpresets;
pub use server_export::{grain_export, record};
pub use server_stems::make;
pub use server_analytics::{analytics, perf, retention};
pub mod routes;
pub mod serve;
