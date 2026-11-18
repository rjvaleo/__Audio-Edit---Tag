//! Any effect in prism-fx's catalogue as a module.

use engine_core::{EventKind, Io, Kind, Module};
use prism_fx::{Descriptor, DynKernel};

/// One effect from prism-fx's catalogue. Input 0 and output 0 are audio; knob
/// numbers are the effect's own parameter numbers.
///
/// The effect allocates everything when it is made and when it is handed a
/// sound, both before the module goes into the patch.
pub struct Fx {
    kernel: Box<dyn DynKernel>,
}

impl Fx {
    /// The effect with that catalogue id, at its defaults, made for `rate`
    /// (the engine's). None when the catalogue has no such effect.
    pub fn new(id: &str, rate: f32) -> Option<Fx> {
        prism_fx::make(id, rate).map(|kernel| Fx { kernel })
    }

    /// Start with a knob at this value, in the effect's own units.
    pub fn set(mut self, param: usize, value: f32) -> Fx {
        self.kernel.set_param(param, value);
        self
    }

    /// Hand the effect its sound (an impulse, a grain source), interleaved.
    /// Effects that take none ignore it.
    pub fn sound(mut self, samples: &[f32], channels: usize, rate: f32) -> Fx {
        self.kernel.set_sound(samples, channels, rate);
        self
    }

    /// The effect's name, controls and ranges.
    pub fn descriptor(&self) -> &'static Descriptor {
        self.kernel.descriptor()
    }
}

impl Module for Fx {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    /// Going into the patch: the knobs set so far are where the effect
    /// starts, with no glide up to them.
    fn prepare(&mut self, _rate: f32, _max_block: usize) {
        self.kernel.reset();
    }
    fn handle(&mut self, event: &EventKind) {
        if let EventKind::Param { index, value } = *event {
            self.kernel.set_param(index as usize, value);
        }
    }
    fn process(&mut self, io: &mut Io) {
        let (in_l, in_r) = io.ins.audio(0);
        let (l, r) = io.outs.audio(0);
        l.copy_from_slice(in_l);
        r.copy_from_slice(in_r);
        self.kernel.process(l, r);
    }
}
