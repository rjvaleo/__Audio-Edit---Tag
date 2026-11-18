//! Marks the audio thread while it renders.
//!
//! With the `rt-check` feature a test installs an allocator that asks
//! [`in_audio`] on every allocation and counts the ones made while it is
//! true. Without the feature all of this is nothing.

#[cfg(feature = "rt-check")]
use std::cell::Cell;

#[cfg(feature = "rt-check")]
thread_local! {
    static DEPTH: Cell<u32> = const { Cell::new(0) };
}

/// Held for the length of a render.
pub struct Guard(());

pub fn enter() -> Guard {
    #[cfg(feature = "rt-check")]
    let _ = DEPTH.try_with(|depth| depth.set(depth.get() + 1));
    Guard(())
}

impl Drop for Guard {
    fn drop(&mut self) {
        #[cfg(feature = "rt-check")]
        let _ = DEPTH.try_with(|depth| depth.set(depth.get().saturating_sub(1)));
    }
}

/// True on a thread that is inside a render.
pub fn in_audio() -> bool {
    #[cfg(feature = "rt-check")]
    {
        DEPTH.try_with(|depth| depth.get() > 0).unwrap_or(false)
    }
    #[cfg(not(feature = "rt-check"))]
    {
        false
    }
}
