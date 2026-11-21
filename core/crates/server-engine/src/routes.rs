//! The routes of this area, called from the table in `server`'s `routes.rs`.

// What every route file takes from here (`use super::*`), as when they were
// one module of the server's `routes`.
#[allow(unused_imports)]
use crate::http::{parse_range, Request, Response};
#[allow(unused_imports)]
use crate::json::{self, Value};
#[allow(unused_imports)]
use crate::safety::{resolve_for_write, resolve_within};
#[allow(unused_imports)]
use crate::state::{App, Index};
#[allow(unused_imports)]
use audio_core::{probe, wav, FileSource, RandomAccessSource};
#[allow(unused_imports)]
use std::path::{Path, PathBuf};
#[allow(unused_imports)]
use std::sync::atomic::Ordering;
#[allow(unused_imports)]
use std::sync::Arc;

use server_library::routes::library_file;
use server_compose::routes::identity_for;

mod engine_api;
pub use engine_api::*;
mod grains;
pub use grains::*;
mod fx_rack;
pub use fx_rack::*;
mod pad_automation;
pub use pad_automation::*;
mod prism;
pub use prism::*;
mod edit_view;
pub use edit_view::*;
