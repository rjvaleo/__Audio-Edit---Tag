//! The Edit module: MGL's Edit page on the sound cabled into it.
//!
//! The document is the Sound module's (`sound_part.rs`); Edit works on it, as
//! MGL's Edit page works on the open document, so an edit made here is heard
//! wherever the sound goes. What Edit keeps of its own:
//! - its transport (`engine_mgl::EditPlayer`), playing the edited sound out
//!   of its own audio socket, as MGL's transport plays the document;
//! - what its face shows and how (the view, the selection, the cursor, the
//!   loop, snap, the fade curve, what is shown on the wave, the knobs behind
//!   the ▾, the bar's layout): MGL keeps these in the page and the browser's
//!   storage; here they are kept as the face hands them over, and saved in
//!   the patch.

use engine_mgl::Transport;
use serde_json::Value;
use std::sync::Arc;

pub struct EditPart {
    pub transport: Arc<Transport>,
    pub ui: Value,
}

impl EditPart {
    pub fn new(saved: Option<&Value>) -> EditPart {
        EditPart { transport: Transport::new(), ui: saved.cloned().unwrap_or(Value::Null) }
    }
}

/// A frame of the document's timeline (its file's rate) as a frame of the
/// sound in the bank (the engine's rate), and back.
pub fn to_bank(frame: f64, file_rate: u32, rate: f32) -> u64 {
    if file_rate == 0 {
        return frame.max(0.0) as u64;
    }
    (frame.max(0.0) * rate as f64 / file_rate as f64).round() as u64
}

pub fn from_bank(frame: u64, file_rate: u32, rate: f32) -> f64 {
    if rate <= 0.0 || file_rate == 0 {
        return frame as f64;
    }
    frame as f64 * file_rate as f64 / rate as f64
}
