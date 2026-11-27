//! The Browse and Library modules: MGL's Browse page (every sound in the
//! library) and its Library page (the PC's own sounds) on the canvas.
//!
//! What they show is the library's, answered by MGL's own routes in the app
//! (`engine-library`); what each keeps of its own is here:
//! - **audition**: MGL hears a sound in Browse by loading the file as it is
//!   and playing it straight through the engine's transport (`playFile`,
//!   `engineLoad(file, { raw })`); the Library page plays the PC's copy, once
//!   or round. Here the module opens the file in a document of its own, hands
//!   it to the bank under its own number, and plays it out of its Audio
//!   socket with Edit's transport (`engine_mgl::EditPlayer`, MGL's transport
//!   without the deck), as the Sound module and Edit do together;
//! - **choosing**: its Sound socket cables into a Sound module's Library
//!   socket; a sound chosen (MGL's double-click, "open it") opens in every
//!   Sound module cabled so, as MGL opens the file as the document;
//! - the page's own state (the pane, the folders open, the filter, the sound
//!   picked, the type, the sort, what is searched), kept as the face hands it
//!   over and saved in the patch, as MGL keeps it in the page and the
//!   browser's storage.

use crate::sound_part::SoundPart;
use engine_mgl::Transport;
use serde_json::{json, Value};
use std::sync::Arc;

/// Which page.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Page {
    Browse,
    Library,
}

/// The Browse page as RJ uses it: MGL's window (1668 x 1100) less its rail.
pub const BROWSE_W: u32 = 1500;
pub const BROWSE_H: u32 = 1100;
/// The Library page: its fixed three columns (360 · 720 · 400) and head,
/// in the same window.
pub const LIBRARY_W: u32 = 1500;
pub const LIBRARY_H: u32 = 1100;

/// The engine modules: the audition's sound (0, the Sound socket's), and its
/// player (1, the Audio socket's).
pub const SOURCE: u32 = 0;
pub const PLAYER: u32 = 1;

pub struct BrowsePart {
    pub page: Page,
    /// What is being heard, as a document of its own.
    pub own: SoundPart,
    pub transport: Arc<Transport>,
    /// The file heard (its full path), and how the page named it.
    pub heard: Option<Value>,
    /// The page's own state, as the face hands it over.
    pub ui: Value,
    /// Bumped whenever what is heard changes.
    pub serial: u64,
}

impl BrowsePart {
    pub fn new(page: Page, saved: Option<&Value>) -> BrowsePart {
        BrowsePart {
            page,
            own: SoundPart::empty(),
            transport: Transport::new(),
            heard: None,
            ui: saved.and_then(|s| s.get("ui")).cloned().unwrap_or(Value::Null),
            serial: 0,
        }
    }

    /// The patch's record of it: the page's state. What was being heard is
    /// not kept: a saved patch opens silent, as MGL's page does.
    pub fn state(&self) -> Value {
        json!({ "ui": self.ui })
    }

    /// Where the head is, in the heard file's own frames, and its length.
    pub fn head(&self, rate: f32) -> (f64, f64) {
        if !self.own.is_open() {
            return (0.0, 0.0);
        }
        let file_rate = self.own.file_rate();
        let at = crate::edit_part::from_bank(self.transport.position(), file_rate, rate);
        (at.min(self.own.frames() as f64), self.own.frames() as f64)
    }

    /// What its face reads back: what is heard, whether it plays, where.
    pub fn info(&self, rate: f32) -> Value {
        let (at, frames) = self.head(rate);
        json!({
            "page": match self.page { Page::Browse => "browse", Page::Library => "library" },
            "heard": self.heard.clone().unwrap_or(Value::Null),
            "playing": self.transport.is_playing(),
            "at": at,
            "frames": frames,
            "rate": self.own.file_rate(),
            "serial": self.serial,
            "ui": self.ui,
        })
    }
}
