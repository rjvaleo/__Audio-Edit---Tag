//! Cache for renders that cannot be streamed.
//!
//! A stretched document has to be rendered whole — WSOLA picks each splice from
//! the one before it, so an arbitrary output frame is not addressable without
//! producing everything up to it. The waveform, the audio stream and the export
//! all want the same buffer, so it is built once and shared.

use std::io;
use std::sync::{Arc, Mutex};

/// Holds one render. A second file simply replaces it: the editor works on one
/// document at a time, and keeping several megabyte buffers alive for tabs the
/// user is not looking at costs more than rebuilding.
#[derive(Default)]
pub struct RenderCache {
    inner: Mutex<Option<(String, Arc<Vec<f32>>)>>,
}

impl RenderCache {
    pub fn get_or_build(
        &self,
        key: &str,
        build: impl FnOnce() -> io::Result<Vec<f32>>,
    ) -> io::Result<Arc<Vec<f32>>> {
        if let Some((k, v)) = self.inner.lock().unwrap().as_ref() {
            if k == key {
                return Ok(Arc::clone(v));
            }
        }
        // Built outside the lock: rendering a long file would otherwise block
        // every other request for the duration.
        let built = Arc::new(build()?);
        *self.inner.lock().unwrap() = Some((key.to_string(), Arc::clone(&built)));
        Ok(built)
    }

    pub fn clear(&self) {
        *self.inner.lock().unwrap() = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn the_second_request_for_the_same_key_does_not_rebuild() {
        let cache = RenderCache::default();
        let builds = AtomicUsize::new(0);
        let build = || {
            builds.fetch_add(1, Ordering::SeqCst);
            Ok(vec![1.0f32, 2.0, 3.0])
        };
        let a = cache.get_or_build("k1", build).unwrap();
        let b = cache.get_or_build("k1", build).unwrap();
        assert_eq!(builds.load(Ordering::SeqCst), 1);
        assert_eq!(*a, *b);
    }

    #[test]
    fn a_different_key_rebuilds() {
        // The key carries the edit and rack settings, so changing a slider must
        // invalidate — otherwise the waveform would keep showing the old render.
        let cache = RenderCache::default();
        let builds = AtomicUsize::new(0);
        let mut build = |v: f32| {
            builds.fetch_add(1, Ordering::SeqCst);
            Ok(vec![v])
        };
        assert_eq!(*cache.get_or_build("k1", || build(1.0)).unwrap(), vec![1.0]);
        assert_eq!(*cache.get_or_build("k2", || build(2.0)).unwrap(), vec![2.0]);
        // Back to k1, but the cache now holds k2, so this rebuilds.
        assert_eq!(*cache.get_or_build("k1", || build(9.0)).unwrap(), vec![9.0]);
        assert_eq!(builds.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn a_failed_build_is_not_cached() {
        let cache = RenderCache::default();
        let bad = || Err(io::Error::new(io::ErrorKind::Other, "nope"));
        assert!(cache.get_or_build("k", bad).is_err());
        assert_eq!(*cache.get_or_build("k", || Ok(vec![5.0f32])).unwrap(), vec![5.0]);
    }

    #[test]
    fn clearing_forces_a_rebuild() {
        let cache = RenderCache::default();
        let builds = AtomicUsize::new(0);
        let build = || {
            builds.fetch_add(1, Ordering::SeqCst);
            Ok(vec![0.0f32])
        };
        cache.get_or_build("k", build).unwrap();
        cache.clear();
        cache.get_or_build("k", build).unwrap();
        assert_eq!(builds.load(Ordering::SeqCst), 2);
    }
}
