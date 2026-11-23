//! MGL's deck levels as a module of their own: the transport's gain (and
//! mute), then Hyperprism's L and R faders, each reached over MGL's ramps.
//! Ported line for line from MGL's `apply_levels`
//! (`core/crates/engine/src/transport/audio_thread.rs`), on a stereo bus.
//! The FX page has them under its rack (its OUTPUT faders L, LR and R).

use engine_core::{EventKind, Io, Kind, Module};

/// MGL's `GAIN_RAMP` and `FADER_RAMP`, in frames.
pub const GAIN_RAMP: usize = 480;
pub const FADER_RAMP: usize = 1024;

/// Audio in 0, audio out 0. Knob 0 the gain, 1 mute (on at 0.5 and up),
/// 2 and 3 the left and right faders.
pub struct Levels {
    gain: f32,
    mute: bool,
    sides: [f32; 2],
    gain_from: f32,
    gain_to: f32,
    gain_now: f32,
    gain_step: usize,
    fader_from: [f32; 2],
    fader_to: [f32; 2],
    fader_now: [f32; 2],
    fader_step: usize,
}

impl Levels {
    pub const GAIN: u32 = 0;
    pub const MUTE: u32 = 1;
    pub const LEFT: u32 = 2;
    pub const RIGHT: u32 = 3;

    pub fn new(gain: f32, left: f32, right: f32) -> Levels {
        Levels {
            gain,
            mute: false,
            sides: [left, right],
            gain_from: 1.0,
            gain_to: f32::NAN,
            gain_now: 1.0,
            gain_step: GAIN_RAMP,
            fader_from: [1.0; 2],
            fader_to: [1.0; 2],
            fader_now: [1.0; 2],
            fader_step: FADER_RAMP,
        }
    }
}

impl Module for Levels {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn handle(&mut self, event: &EventKind) {
        if let EventKind::Param { index, value } = *event {
            match index {
                Self::GAIN => self.gain = value,
                Self::MUTE => self.mute = value >= 0.5,
                Self::LEFT => self.sides[0] = value,
                Self::RIGHT => self.sides[1] = value,
                _ => {}
            }
        }
    }
    fn process(&mut self, io: &mut Io) {
        let (il, ir) = io.ins.audio(0);
        let (l, r) = io.outs.audio(0);
        l.copy_from_slice(il);
        r.copy_from_slice(ir);
        let gain = if self.mute { 0.0 } else { self.gain };
        if self.gain_to.is_nan() {
            self.gain_to = gain;
            self.gain_now = gain;
        } else if gain != self.gain_to {
            self.gain_from = self.gain_now;
            self.gain_to = gain;
            self.gain_step = 0;
        }
        if self.gain_step < GAIN_RAMP {
            for f in 0..l.len() {
                if self.gain_step < GAIN_RAMP {
                    self.gain_step += 1;
                    let t = self.gain_step as f32 / GAIN_RAMP as f32;
                    self.gain_now = self.gain_from + (self.gain_to - self.gain_from) * t;
                }
                l[f] *= self.gain_now;
                r[f] *= self.gain_now;
            }
        } else if (gain - 1.0).abs() > 1e-6 {
            for f in 0..l.len() {
                l[f] *= gain;
                r[f] *= gain;
            }
        }
        let [gl, gr] = self.sides;
        if [gl, gr] != self.fader_to {
            self.fader_from = self.fader_now;
            self.fader_to = [gl, gr];
            self.fader_step = 0;
        }
        let still = self.fader_step >= FADER_RAMP;
        if !(still && (self.fader_now[0] - 1.0).abs() < 1e-7 && (self.fader_now[1] - 1.0).abs() < 1e-7) {
            for f in 0..l.len() {
                if self.fader_step < FADER_RAMP {
                    self.fader_step += 1;
                    let t = self.fader_step as f32 / FADER_RAMP as f32;
                    for side in 0..2 {
                        self.fader_now[side] = self.fader_from[side] + (self.fader_to[side] - self.fader_from[side]) * t;
                    }
                }
                l[f] *= self.fader_now[0];
                r[f] *= self.fader_now[1];
            }
        }
    }
}
