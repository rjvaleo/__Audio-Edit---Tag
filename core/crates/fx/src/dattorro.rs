//! Modules from Jon Dattorro's three-part "Effect Design" tutorial.
//!
//! The section references in this file point to the page-marked extracts in
//! `Reference Docs/md/dattorro-effect-design-part-*.md`.  These are deliberately
//! small, independently patchable building blocks; the plate keeps its feedback
//! tank internal because a zero-delay cycle in the outer graph would be noncausal.

use crate::params::{ParamSpec, Params};
use crate::Effect;
use std::f32::consts::{PI, TAU};


mod plate;
pub use plate::*;
mod filters;
pub use filters::*;
mod delays;
pub use delays::*;
mod noise;
pub use noise::*;
mod primitives;
pub use primitives::*;
mod pitch;
pub use pitch::*;
struct Delay {
    b: Vec<f32>,
    w: usize,
}
impl Delay {
    fn new(n: usize) -> Self {
        Self {
            b: vec![0.0; n.max(2)],
            w: 0,
        }
    }
    fn tap(&self, delay: f32) -> f32 {
        let n = self.b.len();
        let p = (self.w as f32 - delay).rem_euclid(n as f32);
        let i = p.floor() as usize;
        let f = p - i as f32;
        self.b[i % n] + (self.b[(i + 1) % n] - self.b[i % n]) * f
    }
    fn push(&mut self, x: f32) {
        self.b[self.w] = x;
        self.w = (self.w + 1) % self.b.len();
    }
    fn step(&mut self, x: f32) -> f32 {
        let y = self.b[self.w];
        self.push(x);
        y
    }
    fn clear(&mut self) {
        self.b.fill(0.0);
        self.w = 0;
    }
}
fn ap(d: &mut Delay, x: f32, g: f32) -> f32 {
    let z = d.b[d.w];
    let y = z - g * x;
    d.push(x + g * y);
    y
}
fn ap_mod(d: &mut Delay, x: f32, g: f32, delay: f32) -> f32 {
    let z = d.tap(delay);
    let y = z - g * x;
    d.push(x + g * y);
    y
}

#[cfg(test)]
mod tests;
