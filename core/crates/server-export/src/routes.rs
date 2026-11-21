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

use server_compose::routes::identity_for;
use server_library::routes::reindex_for;
use server_engine::routes::{LISSAJOUS_POINTS, MASTER_BANDS, MASTER_BANDS_MAX, MASTER_BANDS_MIN, MASTER_HI_HZ, MASTER_LO_HZ};

mod export;
pub use export::*;
mod video;
pub use video::*;
mod record;
pub use record::*;
