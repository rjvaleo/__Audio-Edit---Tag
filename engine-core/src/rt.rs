//! Marks the audio thread while it renders.
//!
//! With the `rt-check` feature a test installs an allocator that asks
//! [`in_audio`] on every allocation and counts the ones made while it is
//! true. The marker also keeps panic hooks silent in production callbacks.

use std::cell::Cell;

thread_local! {
    static DEPTH: Cell<u32> = const { Cell::new(0) };
}

/// Held for the length of a render.
pub struct Guard(());

pub fn enter() -> Guard {
    let _ = DEPTH.try_with(|depth| depth.set(depth.get() + 1));
    Guard(())
}

impl Drop for Guard {
    fn drop(&mut self) {
        let _ = DEPTH.try_with(|depth| depth.set(depth.get().saturating_sub(1)));
    }
}

/// True on a thread that is inside a render.
pub fn in_audio() -> bool {
    DEPTH.try_with(|depth| depth.get() > 0).unwrap_or(false)
}

/// Install once, off the audio thread. Other threads keep the host's hook.
pub(crate) fn install_panic_hook() {
    static INSTALL: std::sync::Once = std::sync::Once::new();
    INSTALL.call_once(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            if !in_audio() {
                previous(info);
            }
        }));
    });
}
