//! Typed, controller-built parameter state. A preset preserves command order
//! and uses one ownership hand-over, regardless of its control count.
use crate::{EventKind, Module, Thing};
use std::marker::PhantomData;
pub const PRESET: u32 = u32::MAX;
pub const MAX_PRESET_CONTROLS: usize = 4096;

pub struct Preset<M> {
    controls: Vec<(u32, f32)>,
    marker: PhantomData<fn() -> M>,
}
impl<M: Module> Preset<M> {
    /// Build off audio. Empty state means the wrapper's construction recipe.
    /// Tables, sounds and structural resources retain their existing typed
    /// hand-overs; this state describes all the preset's parameter controls.
    pub fn new(controls: &[(u32, f32)]) -> Self {
        assert!(controls.len() <= MAX_PRESET_CONTROLS);
        let mut values = Vec::with_capacity(MAX_PRESET_CONTROLS);
        values.extend_from_slice(controls);
        Self {
            controls: values,
            marker: PhantomData,
        }
    }
    pub fn controls(&self) -> &[(u32, f32)] {
        &self.controls
    }
    /// Keep the saved recipe current when an individual knob moves.
    pub fn update(&mut self, index: u32, value: f32) {
        for (i, v) in &mut self.controls {
            if *i == index {
                *v = value;
            }
        }
    }
    pub fn visit(thing: &Thing, visit: &mut dyn FnMut(EventKind)) {
        if let Some(state) = thing.downcast_ref::<Self>() {
            for &(index, value) in &state.controls {
                visit(EventKind::Param { index, value });
            }
        }
    }
    /// The temporary empty Vec owns no allocation. While applying commands,
    /// handle() cannot overwrite later duplicate commands in the new recipe.
    pub fn exchange(
        current: &mut Box<Self>,
        mut incoming: Box<Self>,
    ) -> (Box<Self>, Vec<(u32, f32)>) {
        let controls = std::mem::take(&mut incoming.controls);
        (std::mem::replace(current, incoming), controls)
    }
    pub fn restore(&mut self, controls: Vec<(u32, f32)>) {
        self.controls = controls;
    }
    /// Replacement storage was reserved off audio, including the 4096-row case.
    pub fn inherit(&mut self, old: &Self) {
        assert!(self.controls.capacity() >= old.controls.len());
        self.controls.clear();
        self.controls.extend_from_slice(&old.controls);
    }
}
