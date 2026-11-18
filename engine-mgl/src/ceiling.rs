//! MultiGrainLive's master ceiling as a module.

use engine_core::{Io, Kind, Module};

/// MGL's soft ceiling (`fx::soften`): what every deck's output passes
/// through last, so that nothing leaves at or over full scale. Audio in,
/// audio out, no controls.
pub struct Ceiling;

impl Module for Ceiling {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn process(&mut self, io: &mut Io) {
        let (in_l, in_r) = io.ins.audio(0);
        let (l, r) = io.outs.audio(0);
        l.copy_from_slice(in_l);
        r.copy_from_slice(in_r);
        // It works a sample at a time, so each side alone is the same as
        // MGL's pass over the two interleaved.
        mgl_fx::soften(l);
        mgl_fx::soften(r);
    }
}
