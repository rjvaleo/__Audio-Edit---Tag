//! Per-oscillator effects, applied per voice, between the oscillator and the
//! filters (`osc → fx → filter`).
//!
//! The mock-up's `ofxShape` defines four of them as operations on the cycle:
//! crush, drive, ring and comb. Those run inside the oscillator, on each
//! unison voice's own phase (see `osc.rs`), because that is what they are: a
//! crush that holds "1 + b·14 samples per 256" is holding a fraction of the
//! *cycle*, and a ring at ratio *r* is a sine at *r* times the note. Done as
//! time-domain effects they would mean something else at every pitch.
//!
//! The other three are time-domain effects and live here, one set per voice
//! per oscillator, on the oscillator's stereo output:
//! - **chorus**: two taps of a short delay (10 ms ± 4 ms) swept by a sine at
//!   `0.1 + b·4` Hz, the right channel's taps a quarter cycle on. `a` is the
//!   mix; the wet signal is the two taps averaged, so it choruses on its own.
//! - **delay**: a feedback delay of `60 + b·440` ms with feedback
//!   `0.25 + a·0.6`; the echoes are added to the dry signal at `a`. A time
//!   change glides over ~50 ms instead of jumping, which would click.
//! - **phaser**: four first-order all-passes swept from 200 Hz to 3.2 kHz by a
//!   sine at `0.1 + b·2` Hz, with a little feedback. `a` blends the all-passed
//!   signal in up to an equal mix, where the notches are deepest.
//!
//! **Memory.** Every voice owns a stereo line of 500 ms per oscillator,
//! allocated with the synth (about 23 MB at 48 kHz for all 40 voice slots).
//! The modes share it, since an oscillator has one effect at a time. A voice
//! reused for a new note clears only what it wrote, so the cost of starting a
//! note is the length of the last echo, not the whole line.

use crate::patch::FxMode;

pub(crate) struct OscFx {
    buf: [Box<[f32]>; 2],
    w: usize,
    /// How much of the line has been written since it was last cleared.
    dirty: usize,
    lfo: f32,
    delay: f32,
    ap: [[f32; 4]; 2],
    fb: [f32; 2],
    mode: FxMode,
}

impl OscFx {
    pub fn new(sample_rate: f32) -> OscFx {
        let len = (sample_rate * 0.5).ceil() as usize + 8;
        OscFx {
            buf: [vec![0.0; len].into_boxed_slice(), vec![0.0; len].into_boxed_slice()],
            w: 0,
            dirty: 0,
            lfo: 0.0,
            delay: -1.0,
            ap: [[0.0; 4]; 2],
            fb: [0.0; 2],
            mode: FxMode::Off,
        }
    }

    /// Forget the last note: clear what was written, reset the states.
    pub fn reset(&mut self) {
        let len = self.buf[0].len();
        let n = self.dirty.min(len);
        for c in self.buf.iter_mut() {
            // The written part ends at `w`; clear back from there.
            for i in 0..n {
                c[(self.w + len - 1 - i) % len] = 0.0;
            }
        }
        self.dirty = 0;
        self.w = 0;
        self.lfo = 0.0;
        self.delay = -1.0;
        self.ap = [[0.0; 4]; 2];
        self.fb = [0.0; 2];
    }

    #[inline]
    fn read(c: &[f32], w: usize, d: f32) -> f32 {
        let len = c.len();
        let rp = w as f32 + len as f32 - d;
        let i = rp as usize;
        let u = rp - i as f32;
        let a = c[i % len];
        let b = c[(i + 1) % len];
        a + (b - a) * u
    }

    /// Process a block in place. Off and the cycle effects do nothing here.
    pub fn process(&mut self, mode: FxMode, a: f32, b: f32, sr: f32, l: &mut [f32], r: &mut [f32]) {
        if mode != self.mode {
            self.reset();
            self.mode = mode;
        }
        let n = l.len().min(r.len());
        let a = a.clamp(0.0, 1.0);
        let b = b.clamp(0.0, 1.0);
        let len = self.buf[0].len();
        let tau = std::f32::consts::TAU;
        match mode {
            FxMode::Chorus => {
                let rate = 0.1 + b * 4.0;
                let step = rate / sr;
                for i in 0..n {
                    self.lfo = (self.lfo + step).fract();
                    let (x0, x1) = (l[i], r[i]);
                    self.buf[0][self.w] = x0;
                    self.buf[1][self.w] = x1;
                    self.w = (self.w + 1) % len;
                    // Taps at 0, ½, ¼ and ¾ of the sweep: one sine and one
                    // cosine give all four.
                    let (sn, cs) = (tau * self.lfo).sin_cos();
                    let tap = |s: f32| (0.010 + 0.004 * s) * sr;
                    let wl = 0.5 * (Self::read(&self.buf[0], self.w, tap(sn)) + Self::read(&self.buf[0], self.w, tap(-sn)));
                    let wr = 0.5 * (Self::read(&self.buf[1], self.w, tap(cs)) + Self::read(&self.buf[1], self.w, tap(-cs)));
                    l[i] = x0 * (1.0 - a) + wl * a;
                    r[i] = x1 * (1.0 - a) + wr * a;
                }
                self.dirty += n;
            }
            FxMode::Delay => {
                let target = ((0.060 + b * 0.440) * sr).clamp(1.0, len as f32 - 3.0);
                if self.delay < 0.0 {
                    self.delay = target;
                }
                let glide = 1.0 - (-1.0 / (0.05 * sr)).exp();
                let fb = 0.25 + a * 0.6;
                for i in 0..n {
                    self.delay += (target - self.delay) * glide;
                    let wl = Self::read(&self.buf[0], self.w, self.delay);
                    let wr = Self::read(&self.buf[1], self.w, self.delay);
                    self.buf[0][self.w] = l[i] + fb * wl;
                    self.buf[1][self.w] = r[i] + fb * wr;
                    self.w = (self.w + 1) % len;
                    l[i] += a * wl;
                    r[i] += a * wr;
                }
                self.dirty += n;
            }
            FxMode::Phaser => {
                let rate = 0.1 + b * 2.0;
                let step = rate / sr;
                for i in 0..n {
                    self.lfo = (self.lfo + step).fract();
                    for ch in 0..2 {
                        let ph = self.lfo + 0.25 * ch as f32;
                        let fc = 200.0 * 16f32.powf(0.5 + 0.5 * (tau * ph).sin());
                        let t = (std::f32::consts::PI * fc / sr).tan();
                        let c = (t - 1.0) / (t + 1.0);
                        let dry = if ch == 0 { l[i] } else { r[i] };
                        let mut x = dry + 0.3 * self.fb[ch];
                        for z in self.ap[ch].iter_mut() {
                            let y = c * x + *z;
                            *z = x - c * y;
                            x = y;
                        }
                        self.fb[ch] = x;
                        let out = dry * (1.0 - 0.5 * a) + x * 0.5 * a;
                        if ch == 0 {
                            l[i] = out;
                        } else {
                            r[i] = out;
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

/// The cycle effects, worked out once per block: `ofxShape`'s constants.
#[derive(Clone, Copy, Debug)]
pub(crate) enum Shaper {
    None,
    /// Quantiser steps `q = 2^(bits−1)`, hold in 256ths of a cycle.
    Crush { a: f32, q: f32, hold: f32 },
    /// `tanh(x·d)/tanh(d)`.
    Drive { a: f32, d: f32, norm: f32 },
    /// Times a sine at `r` times the note.
    Ring { a: f32, r: f32 },
    /// Harmonic comb of period `d` harmonics.
    Comb { a: f32, d: f32 },
}

/// The kit's Math.round.
#[inline]
pub(crate) fn js_round(x: f32) -> f32 {
    (x + 0.5).floor()
}

impl Shaper {
    pub fn new(mode: FxMode, a: f32, b: f32) -> Shaper {
        let a = a.clamp(0.0, 1.0);
        let b = b.clamp(0.0, 1.0);
        match mode {
            FxMode::Crush => {
                let bits = js_round(2.0 + (1.0 - b) * 6.0);
                Shaper::Crush { a, q: 2f32.powf(bits - 1.0), hold: 1.0 + js_round(b * 14.0) }
            }
            FxMode::Drive => {
                let d = 1.0 + b * 10.0;
                Shaper::Drive { a, d, norm: 1.0 / d.tanh() }
            }
            FxMode::Ring => Shaper::Ring { a, r: 1.0 + js_round(b * 7.0) },
            FxMode::Comb => Shaper::Comb { a, d: 2.0 + b * 10.0 },
            _ => Shaper::None,
        }
    }
}
