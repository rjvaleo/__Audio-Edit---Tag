//! The sound bank: loaded sounds the audio thread can read.

use crate::types::SoundRef;
use std::sync::Arc;

/// A loaded sound: finished audio at its own rate.
pub struct SoundData {
    pub rate: f32,
    pub l: Box<[f32]>,
    pub r: Box<[f32]>,
}

impl SoundData {
    pub fn frames(&self) -> usize {
        self.l.len().min(self.r.len())
    }
}

/// Sound ids run from 1 to one less than this.
pub const MAX_SOUNDS: usize = 1024;

/// The bank as the audio thread sees it. Its room is fixed, and a sound it
/// lets go of is handed back to the controller, never freed here.
pub struct Sounds {
    slots: Vec<Option<(u32, Arc<SoundData>)>>,
}

impl Sounds {
    pub(crate) fn new() -> Self {
        let mut slots = Vec::with_capacity(MAX_SOUNDS);
        slots.resize_with(MAX_SOUNDS, || None);
        Self { slots }
    }

    /// The sound, if that version of it is the one loaded.
    pub fn get(&self, sound: SoundRef) -> Option<&SoundData> {
        match self.slots.get(sound.id as usize)? {
            Some((version, data)) if *version == sound.version => Some(data),
            _ => None,
        }
    }

    /// Put a sound in (or take one out) and return whatever must now be
    /// freed elsewhere.
    pub(crate) fn set(
        &mut self,
        id: u32,
        version: u32,
        data: Option<Arc<SoundData>>,
    ) -> Option<Arc<SoundData>> {
        match self.slots.get_mut(id as usize) {
            Some(slot) => {
                let old = slot.take();
                *slot = data.map(|data| (version, data));
                old.map(|(_, data)| data)
            }
            None => data,
        }
    }
}
