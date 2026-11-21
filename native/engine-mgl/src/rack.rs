//! MultiGrainLive's effects rack, and Wave's effects board, as modules of
//! their own: stereo in, stereo out, for any instrument to be cabled through.
//!
//! The page runs both for Atmosphere (`ui/sequencer/atfx.wasm`: the `fx`
//! crate's `Rack` and `wave::BoardPlan`, built for the browser); Grain's deck
//! and Wave carry their own inside. Here they stand alone, so an instrument's
//! effects are a cable, as everything in the native app is.
//!
//! What runs is built on the app's thread and handed over
//! (`Controller::give(module, 0, thing)`): a rack, or a board. The module
//! keeps it and sends the box back with the one it replaced, to be freed
//! there. Nothing in `process` allocates or frees.

use engine_core::{EventKind, Io, Kind, Module, Thing};
use mgl_fx::ParamIndex;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::sync::Arc;

/// How many frames a [`Scope`] keeps.
pub const SCOPE_LEN: usize = 2048;

/// The last [`SCOPE_LEN`] frames of a module's output, mono, written by the
/// audio thread and read by the face whenever it likes. A reading may mix two
/// blocks; for a picture nobody can tell.
pub struct Scope {
    buf: [AtomicU32; SCOPE_LEN],
    pos: AtomicUsize,
}

impl Scope {
    pub fn new() -> Arc<Scope> {
        Arc::new(Scope { buf: std::array::from_fn(|_| AtomicU32::new(0)), pos: AtomicUsize::new(0) })
    }

    fn write(&self, l: &[f32], r: &[f32]) {
        let mut p = self.pos.load(Ordering::Relaxed);
        for (a, b) in l.iter().zip(r) {
            self.buf[p].store(((a + b) * 0.5).to_bits(), Ordering::Relaxed);
            p = (p + 1) % SCOPE_LEN;
        }
        self.pos.store(p, Ordering::Release);
    }

    /// The last `out.len()` frames (at most [`SCOPE_LEN`]), oldest first.
    /// How many were written.
    pub fn read(&self, out: &mut [f32]) -> usize {
        let n = out.len().min(SCOPE_LEN);
        let end = self.pos.load(Ordering::Acquire);
        let start = (end + SCOPE_LEN - n) % SCOPE_LEN;
        for (i, o) in out[..n].iter_mut().enumerate() {
            *o = f32::from_bits(self.buf[(start + i) % SCOPE_LEN].load(Ordering::Relaxed));
        }
        n
    }
}

/// A rack for [`Rack`], with its controls numbered, built on the app's
/// thread. Knob `slot * 256 + n` is the slot's `n`th control
/// (`fx::ControlMap::index`): the effect's own, then wet and level, then
/// Place's.
pub struct RackThing {
    rack: Option<mgl_fx::Rack>,
    table: Vec<Vec<ParamIndex>>,
}

impl RackThing {
    /// `rack` given room for blocks of `max_block` frames, stereo, so it
    /// never grows in the callback.
    pub fn new(rack: Option<mgl_fx::Rack>, max_block: usize) -> Box<RackThing> {
        let rack = rack.map(|mut r| {
            r.reserve_mix(max_block * 2);
            r
        });
        let table = rack
            .as_ref()
            .map(|r| r.control_maps().iter().map(|m| (0..m.len()).filter_map(|n| m.index(n).map(|(_, i)| i)).collect()).collect())
            .unwrap_or_default();
        Box::new(RackThing { rack, table })
    }

    /// The knob a slot's control is, by its key, for the app to send.
    pub fn knob(rack: &mgl_fx::Rack, slot: usize, key: &str) -> Option<u32> {
        let maps = rack.control_maps();
        let m = maps.get(slot)?;
        (0..m.len()).find(|&n| m.index(n).is_some_and(|(k, _)| k == key)).map(|n| (slot * 256 + n) as u32)
    }

    /// What came back: the rack this one replaced, if any.
    pub fn rack(&self) -> Option<&mgl_fx::Rack> {
        self.rack.as_ref()
    }
}

/// The effects rack: audio in 0, audio out 0. Empty, it passes the sound.
/// Knob [`Rack::switch`]`(slot)` turns a slot on (1) or off (0).
pub struct Rack {
    rack: Option<mgl_fx::Rack>,
    table: Vec<Vec<ParamIndex>>,
    rate: u32,
    scope: Option<Arc<Scope>>,
}

impl Rack {
    pub fn new(rate: f32) -> Rack {
        Rack { rack: None, table: Vec::new(), rate: rate.max(1.0) as u32, scope: None }
    }

    /// The same, writing what it puts out into `scope` every block.
    pub fn with_scope(rate: f32, scope: Arc<Scope>) -> Rack {
        Rack { scope: Some(scope), ..Rack::new(rate) }
    }

    pub const fn switch(slot: usize) -> u32 {
        (1 << 16) + slot as u32
    }
}

impl Module for Rack {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn prepare(&mut self, rate: f32, _max_block: usize) {
        self.rate = rate.max(1.0) as u32;
    }
    fn handle(&mut self, event: &EventKind) {
        if let EventKind::Param { index, value } = *event {
            if index >= Self::switch(0) {
                if let Some(s) = self.rack.as_mut().and_then(|r| r.slots.get_mut((index - Self::switch(0)) as usize)) {
                    s.bypassed = value < 0.5;
                }
                return;
            }
            let (slot, n) = ((index >> 8) as usize, (index & 0xff) as usize);
            if let (Some(rack), Some(&pi)) = (self.rack.as_mut(), self.table.get(slot).and_then(|t| t.get(n))) {
                rack.set_param_index(slot, pi, value);
            }
        }
    }
    fn take(&mut self, _slot: u32, thing: Thing) -> Option<Thing> {
        let mut boxed = match thing.downcast::<RackThing>() {
            Ok(b) => b,
            Err(other) => return Some(other),
        };
        std::mem::swap(&mut boxed.rack, &mut self.rack);
        std::mem::swap(&mut boxed.table, &mut self.table);
        Some(boxed)
    }
    fn process(&mut self, io: &mut Io) {
        let (il, ir) = io.ins.audio(0);
        let (l, r) = io.outs.audio(0);
        l.copy_from_slice(il);
        r.copy_from_slice(ir);
        if let Some(rack) = self.rack.as_mut() {
            rack.process_planar(l, r, self.rate);
        }
        if let Some(scope) = &self.scope {
            scope.write(l, r);
        }
    }
}

/// A board for [`Board`], compiled for the engine's rate on the app's thread.
pub struct BoardThing(pub Option<Box<wave::BoardPlan>>);

/// Wave's effects board on its own: audio in 0, audio out 0. Knob
/// `Board::knob(node, param)` is a node's control; `Board::switch(node)` turns
/// a node on (1) or off (0), as on Wave's own board.
pub struct Board {
    plan: Option<Box<wave::BoardPlan>>,
}

impl Board {
    pub fn new() -> Board {
        Board { plan: None }
    }
    pub const fn knob(node: usize, param: usize) -> u32 {
        ((node as u32) << 8) + param as u32
    }
    pub const fn switch(node: usize) -> u32 {
        (1 << 16) + node as u32
    }
}

impl Default for Board {
    fn default() -> Self {
        Self::new()
    }
}

impl Module for Board {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn handle(&mut self, event: &EventKind) {
        if let (EventKind::Param { index, value }, Some(plan)) = (*event, self.plan.as_mut()) {
            if index >= Self::switch(0) {
                plan.set_on((index - Self::switch(0)) as usize, value >= 0.5);
            } else {
                plan.set_param((index >> 8) as usize, (index & 0xff) as usize, value);
            }
        }
    }
    fn take(&mut self, _slot: u32, thing: Thing) -> Option<Thing> {
        let mut boxed = match thing.downcast::<BoardThing>() {
            Ok(b) => b,
            Err(other) => return Some(other),
        };
        std::mem::swap(&mut boxed.0, &mut self.plan);
        Some(boxed)
    }
    fn process(&mut self, io: &mut Io) {
        let (il, ir) = io.ins.audio(0);
        let (l, r) = io.outs.audio(0);
        l.copy_from_slice(il);
        r.copy_from_slice(ir);
        if let Some(plan) = self.plan.as_mut() {
            plan.process(l, r);
        }
    }
}
