//! The rack's kinds as modules and modes (SUITE-PLAN §3.3).
//!
//! The modules themselves live in `prism_fx::suite`. This maps what a rack
//! document stores — a bare shape kind, `eq`, `comp`, `gain`, or
//! `prism:<id>` — to the mode it opens as, and each mode to the one kind it
//! is saved as (its "keeper", §1.3): the name documents already use, so a
//! slot saved by this build still opens in an older one (D14). Loading builds
//! the very same effect as before, so the sound is unchanged by construction.

use crate::shape::ShapeKind;
pub use prism_fx::suite::{Mode, Suite};

/// The module and mode a stored kind opens as.
pub fn mode_of_kind(kind: &str) -> Option<(&'static Suite, &'static Mode)> {
    let kernel = match kind {
        "eq" => "eq",
        "comp" => "compressor",
        "gain" => "gain",
        k => match ShapeKind::from_str(k) {
            Some(s) => s.prism_id(),
            None => crate::prism::id_for_kind(k)?,
        },
    };
    prism_fx::suite::locate(kernel)
}

/// The kind a mode is saved as: the bare shape kind where there is one, the
/// native EQ and compressor, and `prism:<id>` for everything else.
pub fn keeper_kind(mode: &Mode) -> String {
    match mode.kernel {
        "eq" => "eq".into(),
        "compressor" => "comp".into(),
        k => match ShapeKind::ALL.iter().find(|s| s.prism_id() == k) {
            Some(s) => s.as_str().into(),
            None => format!("prism:{k}"),
        },
    }
}
