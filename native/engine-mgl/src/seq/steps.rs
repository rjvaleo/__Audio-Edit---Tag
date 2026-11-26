//! The scale sequencer's note-making, as `app.js` and `bridge.js` have it:
//! which step plays at each boundary (`getNextStep` live, `stepAtBoundary`
//! in a film), its pitch in the scale (`getFreqForDegree`, `centsToHz`), the
//! keys' pitches (`compute88Notes`, `kyHz`), the pulse width the PW LFOs move
//! per step, and the grid the film lays its steps on (`k * d - at0`).
//!
//! Where the page draws `Math.random` (the "rand" direction) a seeded draw
//! stands in for it.

use crate::atmos_web::Rng;
use dsp_core::chromium::fdlibm;

/// One step (`steps[i]`, or the Journey's moved copy of it).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Step {
    pub degree: i32,
    pub rest: bool,
    /// How many steps it is held (`played.hold`, 1 when unset).
    pub hold: f64,
    /// A second note half a step later (`played.double`).
    pub double: bool,
    /// A pitch of its own (`played.freq`), instead of its degree's.
    pub freq: Option<f64>,
}

impl Step {
    pub const fn degree(degree: i32) -> Self {
        Step { degree, rest: false, hold: 1.0, double: false, freq: None }
    }
}

/// `SEQ_MAX_STEPS`.
pub const MAX_STEPS: usize = 64;

/// `direction`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Fwd,
    Rev,
    Ping,
    Rand,
}

impl Direction {
    pub fn from_name(s: &str) -> Self {
        match s {
            "fwd" => Direction::Fwd,
            "rev" => Direction::Rev,
            "ping" => Direction::Ping,
            _ => Direction::Rand,
        }
    }
}

/// A scale: its degrees in cents from the root, and the root.
#[derive(Clone, Debug, PartialEq)]
pub struct Scale {
    pub cents: Vec<f64>,
    pub root_hz: f64,
}

/// `centsToHz`.
pub fn cents_to_hz(root_hz: f64, cents: f64) -> f64 {
    root_hz * fdlibm::pow(2.0, cents / 1200.0)
}

/// JavaScript's `%`: the sign of the dividend.
fn js_rem(a: i32, b: i32) -> i32 {
    a % b
}

impl Scale {
    /// `getFreqForDegree`: see [`degree_hz`].
    pub fn freq_for_degree(&self, degree: i32) -> f64 {
        degree_hz(&self.cents, self.root_hz, degree)
    }

    /// `compute88Notes`' pitch for a key: see [`key_hz`].
    pub fn key_hz(&self, midi: i32, root_midi: i32, root_octave: i32) -> Option<f64> {
        key_hz(&self.cents, self.root_hz, midi, root_midi, root_octave)
    }
}

/// `getFreqForDegree`: degree `d` of the scale `cents` from `root_hz`,
/// octaves above (or below) for degrees past its end. A negative degree
/// indexes as the page's does (`deg[d]` of a negative `d` is undefined
/// there, so NaN).
pub fn degree_hz(cents: &[f64], root_hz: f64, degree: i32) -> f64 {
    let n = cents.len() as i32;
    if n == 0 {
        return f64::NAN;
    }
    let oct = (degree as f64 / n as f64).floor();
    let d = js_rem(degree, n);
    if d < 0 {
        return f64::NAN;
    }
    cents_to_hz(root_hz, cents[d as usize] + oct * 1200.0)
}

/// `compute88Notes`' pitch for MIDI key `midi` in the scale `cents` from
/// `root_hz`, with the root's MIDI note `root_midi + (root_octave + 1) *
/// 12`, or `None` outside A0..C8.
pub fn key_hz(cents: &[f64], root_hz: f64, midi: i32, root_midi: i32, root_octave: i32) -> Option<f64> {
    if !(21..=108).contains(&midi) || cents.is_empty() {
        return None;
    }
    let root_midi_num = root_midi + (root_octave + 1) * 12;
    let diff = midi - root_midi_num;
    let total = (diff * 100) as f64;
    let scale_octave = (total / 1200.0).floor();
    let mut best = 0usize;
    let mut best_dist = f64::INFINITY;
    for (d, c) in cents.iter().enumerate() {
        let dist = (total - (c + scale_octave * 1200.0)).abs();
        if dist < best_dist {
            best_dist = dist;
            best = d;
        }
    }
    Some(cents_to_hz(root_hz, cents[best] + scale_octave * 1200.0))
}

/// `updateRoot`: the root's pitch, A4 (MIDI 69) at 440 Hz.
pub fn root_hz(root_midi: i32, root_octave: i32) -> f64 {
    let midi_num = root_midi + (root_octave + 1) * 12;
    440.0 * fdlibm::pow(2.0, (midi_num - 69) as f64 / 12.0)
}

/// `stepAtBoundary`: the step a film plays at boundary `k` of `n` steps.
pub fn step_at_boundary(k: u64, n: usize, dir: Direction, rng: &mut dyn Rng) -> usize {
    let n = n.max(1) as u64;
    (match dir {
        Direction::Fwd => k % n,
        Direction::Rev => (n - 1 - (k % n) + n) % n,
        Direction::Ping => {
            let period = (2 * n).saturating_sub(2).max(1);
            let r = k % period;
            if r < n {
                r
            } else {
                period - r
            }
        }
        Direction::Rand => (rng.next() * n as f64).floor() as u64,
    }) as usize
}

/// The live scheduler's position: `currentStep` and `pingDir`, moved on by
/// `getNextStep`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cursor {
    pub current: i32,
    pub ping_dir: i32,
}

impl Default for Cursor {
    fn default() -> Self {
        Cursor { current: 0, ping_dir: 1 }
    }
}

impl Cursor {
    /// `getNextStep` over `active` steps.
    pub fn next(&mut self, active: usize, dir: Direction, rng: &mut dyn Rng) -> usize {
        let active = active.max(1) as i32;
        match dir {
            Direction::Fwd => self.current = (self.current + 1) % active,
            Direction::Rev => self.current = (self.current - 1 + active) % active,
            Direction::Ping => {
                self.current += self.ping_dir;
                if self.current >= active {
                    self.current = active - 2;
                    self.ping_dir = -1;
                }
                if self.current < 0 {
                    self.current = 1;
                    self.ping_dir = 1;
                }
            }
            Direction::Rand => self.current = (rng.next() * active as f64).floor() as i32,
        }
        self.current as usize
    }
}

/// The PW LFOs' phases (`lfo.phase` of those whose target is "pw"), moved on
/// one step and summed (`pwMod`), and the width the next pulse takes.
pub fn pulse_width_step(lfos: &mut [(f64, f64, f64)], step_dur: f64, pulse_width: f64) -> f64 {
    let mut pw_mod = 0.0;
    for (phase, rate, depth) in lfos.iter_mut() {
        *phase += *rate * step_dur * 2.0 * core::f64::consts::PI;
        pw_mod += fdlibm::sin(*phase) * *depth * 0.45;
    }
    0.05f64.max(0.95f64.min(pulse_width + pw_mod))
}

/// A film's grid: the boundaries from the one at or after `at0`, each with
/// its time from the film's start (`k * d - at0`), until `end`.
pub fn film_grid(at0: f64, d: f64, end: f64) -> impl Iterator<Item = (u64, f64)> {
    let first = 0f64.max(((at0 - 1e-9) / d).ceil()) as u64;
    (first..).map(move |k| (k, k as f64 * d - at0)).take_while(move |&(_, t)| t < end)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::atmos_web::Mulberry32;

    fn major() -> Scale {
        Scale { cents: vec![0.0, 200.0, 400.0, 500.0, 700.0, 900.0, 1100.0], root_hz: 440.0 }
    }

    #[test]
    fn degrees_climb_the_scale_and_its_octaves() {
        let s = major();
        assert_eq!(s.freq_for_degree(0), 440.0);
        assert_eq!(s.freq_for_degree(7), 880.0);
        assert_eq!(s.freq_for_degree(4), 440.0 * fdlibm::pow(2.0, 700.0 / 1200.0));
        assert!(s.freq_for_degree(-1).is_nan());
    }

    #[test]
    fn a_film_reads_each_direction_as_the_page_does() {
        let mut r = Mulberry32(1);
        let fwd: Vec<usize> = (0..10).map(|k| step_at_boundary(k, 4, Direction::Fwd, &mut r)).collect();
        assert_eq!(fwd, [0, 1, 2, 3, 0, 1, 2, 3, 0, 1]);
        let rev: Vec<usize> = (0..6).map(|k| step_at_boundary(k, 4, Direction::Rev, &mut r)).collect();
        assert_eq!(rev, [3, 2, 1, 0, 3, 2]);
        let ping: Vec<usize> = (0..9).map(|k| step_at_boundary(k, 4, Direction::Ping, &mut r)).collect();
        assert_eq!(ping, [0, 1, 2, 3, 2, 1, 0, 1, 2]);
    }

    #[test]
    fn the_live_cursor_moves_as_get_next_step_does() {
        let mut r = Mulberry32(1);
        let mut c = Cursor::default();
        let ping: Vec<usize> = (0..8).map(|_| c.next(4, Direction::Ping, &mut r)).collect();
        assert_eq!(ping, [1, 2, 3, 2, 1, 0, 1, 2]);
        let mut c = Cursor::default();
        let rev: Vec<usize> = (0..5).map(|_| c.next(4, Direction::Rev, &mut r)).collect();
        assert_eq!(rev, [3, 2, 1, 0, 3]);
    }

    #[test]
    fn the_grid_starts_at_the_first_boundary_past_at0() {
        let g: Vec<(u64, f64)> = film_grid(0.3, 0.25, 1.0).collect();
        assert_eq!(g.iter().map(|x| x.0).collect::<Vec<_>>(), [2, 3, 4, 5]);
        assert!((g[0].1 - 0.2).abs() < 1e-12);
    }
}
