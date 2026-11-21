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

use server_ui::ui_build_id;

/// How many files one measuring pass takes on before answering.
///
/// The number is a compromise between a request that returns and a queue that
/// drains. Thirty-two files is a second or two of work on a normal library, and
/// ordinary use of the interface produces requests often enough that a few
/// hundred unmeasured files are worked through in the background of a session
/// rather than in front of one stalled click.
const PASS_BATCH: usize = 32;

/// How often the classifier's answers reach disk within a pass.
const LABEL_FLUSH: usize = 8;

mod library;
pub use library::*;
mod listen_tags;
pub use listen_tags::*;
mod map;
pub use map::*;
mod audio_view;
pub use audio_view::*;
