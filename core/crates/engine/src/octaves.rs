//! Copies of the sound an octave or more up, for the top of the keyboard.
//!
//! Above C8 the five resampling engines would have to make up to 48 times the
//! frames they hand out, and PVSOLA, the hybrid and SoundHack could not keep
//! up (RJ, 17 Nov 2026). They read a copy of the sound pitched up instead
//! (prism-grain `octave.rs`), which keeps their work where it is at C8.
//!
//! The copies are made here, off the audio thread, only once a note asks for
//! them: the engine raises a flag, the deck's housekeeping thread sees it and
//! starts a thread to build them, and they are left for the audio thread to
//! pick up, as the hybrid's separation is. Until they arrive a high note plays
//! as it did before, at full cost.
//!
//! The audio thread may not free anything, so every set of copies handed to it
//! is also kept here, and only let go once nobody else holds it.

use fx::hstream::Parts;
use prism_grain::octave::Octaves;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::Source;

#[derive(Default)]
pub struct OctaveSlot {
    /// For the audio thread: `Some(copies)` to adopt, `Some(None)` to drop
    /// them (a new sound).
    pending: Mutex<Option<Option<Arc<Octaves>>>>,
    /// A note asked for copies that were not there.
    wanted: AtomicBool,
    building: AtomicBool,
    /// Every set handed over, until nobody else holds it.
    kept: Mutex<Vec<Arc<Octaves>>>,
}

impl OctaveSlot {
    pub fn new() -> Arc<OctaveSlot> {
        let s = OctaveSlot::default();
        // A lock's first use on macOS allocates; the audio thread only tries
        // this one, and must not be first.
        drop(s.pending.lock());
        Arc::new(s)
    }

    /// From the audio thread: a note wants copies.
    pub fn want(&self) {
        self.wanted.store(true, Ordering::Relaxed);
    }

    /// From the audio thread: what to adopt, if anything. Never blocks.
    pub fn take(&self) -> Option<Option<Arc<Octaves>>> {
        self.pending.try_lock().ok().and_then(|mut g| g.take())
    }

    /// A new sound: the copies of the old one are no use.
    pub fn clear(&self) {
        if let Ok(mut g) = self.pending.lock() {
            *g = Some(None);
        }
    }

    /// [`Self::clear`] for the audio thread of a host that hands the new
    /// sound over itself: never waits, and says whether it was done.
    pub fn try_clear(&self) -> bool {
        match self.pending.try_lock() {
            Ok(mut g) => {
                // Every set handed over is also in `kept`, so this frees none.
                *g = Some(None);
                true
            }
            Err(_) => false,
        }
    }

    /// Hand a set over and keep a hold on it.
    fn deliver(&self, o: Arc<Octaves>) {
        if let Ok(mut k) = self.kept.lock() {
            k.push(Arc::clone(&o));
        }
        if let Ok(mut g) = self.pending.lock() {
            *g = Some(Some(o));
        }
    }

    /// Make them now, on this thread: an export, or a test.
    pub fn build_now(&self, source: &Source, parts: Option<&Parts>) {
        self.deliver(Arc::new(Octaves::build(&source.samples, source.channels, parts)));
    }

    /// Housekeeping, off the audio thread: let go of sets nobody else holds
    /// any more, and if a note has asked, start building on a thread of its
    /// own (it walks the whole sound, and the thread that calls this has
    /// voices to make).
    pub fn tend(self: &Arc<Self>, source: Option<Arc<Source>>, parts: Option<Arc<Parts>>) {
        if let Ok(mut k) = self.kept.try_lock() {
            // The newest stays: it may be on its way to the audio thread.
            let n = k.len();
            let mut i = 0;
            k.retain(|o| {
                i += 1;
                i == n || Arc::strong_count(o) > 1
            });
        }
        if !self.wanted.swap(false, Ordering::Relaxed) || self.building.swap(true, Ordering::AcqRel) {
            return;
        }
        let Some(source) = source else {
            self.building.store(false, Ordering::Release);
            return;
        };
        let parts = parts.filter(|p| !p.is_empty() && p.frames() == source.frames());
        // Already made for this sound and these parts: the ask came from an
        // engine that has not picked them up yet, not from anything missing.
        let made = self.kept.try_lock().ok().and_then(|k| k.last().cloned());
        if made.is_some_and(|o| o.is_for(&source.samples) && parts.as_ref().is_none_or(|p| o.is_for_parts(p))) {
            self.building.store(false, Ordering::Release);
            return;
        }
        let me = Arc::clone(self);
        let started = std::thread::Builder::new().name("grain-octaves".into()).spawn(move || {
            me.build_now(&source, parts.as_deref());
            me.building.store(false, Ordering::Release);
        });
        if started.is_err() {
            self.building.store(false, Ordering::Release);
        }
    }
}
