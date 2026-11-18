//! The parts every model is built from: a delay line read between samples, a
//! one-pole filter, a DC blocker, a two-pole resonator, a state-variable
//! filter, an envelope, a noise source. No allocation after construction.

/// The longest note period the delay lines hold: 20 Hz at 96 kHz, and some.
pub const MAX_DELAY: usize = 8192;

/// White noise, the same every run for the same seed (xorshift).
#[derive(Clone)]
pub struct Noise(u32);
impl Noise {
    pub fn new(seed: u32) -> Self {
        Noise(seed.max(1))
    }
    #[inline]
    pub fn next(&mut self) -> f32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        (x as f32 / u32::MAX as f32) * 2.0 - 1.0
    }
}

/// A delay line read at a fractional length (linear between samples, so its
/// delay is exact and only its top end is softened).
#[derive(Clone)]
pub struct Delay {
    buf: Vec<f32>,
    w: usize,
}
impl Delay {
    pub fn new() -> Self {
        Delay { buf: vec![0.0; MAX_DELAY], w: 0 }
    }
    pub fn clear(&mut self) {
        self.buf.iter_mut().for_each(|x| *x = 0.0);
    }
    /// The sample written `d` samples ago (1 ≤ d < MAX_DELAY − 1).
    #[inline]
    pub fn read(&self, d: f32) -> f32 {
        let d = d.clamp(1.0, (MAX_DELAY - 2) as f32);
        let i = d.floor();
        let f = d - i;
        let n = MAX_DELAY;
        let a = self.buf[(self.w + n - i as usize) % n];
        let b = self.buf[(self.w + n - i as usize - 1) % n];
        a + (b - a) * f
    }
    #[inline]
    pub fn write(&mut self, x: f32) {
        self.w = (self.w + 1) % MAX_DELAY;
        self.buf[self.w] = x;
    }
}

/// y = (1 − b)·x + b·y₋₁: a gentle low-pass, its delay at low frequencies
/// b / (1 − b) samples.
#[derive(Clone, Default)]
pub struct OnePole {
    pub b: f32,
    y: f32,
}
impl OnePole {
    #[inline]
    pub fn tick(&mut self, x: f32) -> f32 {
        self.y = (1.0 - self.b) * x + self.b * self.y;
        self.y
    }
    pub fn clear(&mut self) {
        self.y = 0.0;
    }
}

/// Takes the DC off a loop that blows or bows.
#[derive(Clone, Default)]
pub struct DcBlock {
    x1: f32,
    y1: f32,
}
impl DcBlock {
    #[inline]
    pub fn tick(&mut self, x: f32) -> f32 {
        let y = x - self.x1 + 0.995 * self.y1;
        self.x1 = x;
        self.y1 = flush(y);
        y
    }
}

/// A first-order all-pass, for a string's stiffness: high partials arrive a
/// little early, so they sit sharp, as in a piano or a harp.
#[derive(Clone, Default)]
pub struct AllPass1 {
    pub a: f32,
    x1: f32,
    y1: f32,
}
impl AllPass1 {
    #[inline]
    pub fn tick(&mut self, x: f32) -> f32 {
        let y = self.a * x + self.x1 - self.a * self.y1;
        self.x1 = x;
        self.y1 = flush(y);
        y
    }
    /// Its delay at low frequencies, in samples.
    pub fn delay(&self) -> f32 {
        (1.0 - self.a) / (1.0 + self.a)
    }
}

/// A decaying sine: one mode of a bar, a bell, a glass or a drumhead. Struck
/// with a unit impulse it rings at amplitude one.
#[derive(Clone, Default)]
pub struct Mode {
    a1: f32,
    a2: f32,
    b0: f32,
    y1: f32,
    y2: f32,
    pub gain: f32,
}
impl Mode {
    pub fn set(&mut self, hz: f32, t60: f32, sr: f32) {
        let w = (2.0 * std::f32::consts::PI * hz / sr).min(3.1);
        let r = (-6.9078 / (t60.max(0.005) * sr)).exp();
        self.a1 = 2.0 * r * w.cos();
        self.a2 = -r * r;
        self.b0 = w.sin();
    }
    #[inline]
    pub fn tick(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.a1 * self.y1 + self.a2 * self.y2;
        self.y2 = self.y1;
        self.y1 = flush(y);
        y * self.gain
    }
    pub fn clear(&mut self) {
        self.y1 = 0.0;
        self.y2 = 0.0;
    }
    /// How much it is ringing now.
    pub fn level(&self) -> f32 {
        (self.y1 * self.y1 + self.y2 * self.y2).sqrt() * self.gain.abs()
    }
}

/// A state-variable filter (topology-preserving): low, band or high pass,
/// stable however fast its cutoff moves.
#[derive(Clone, Default)]
pub struct Svf {
    ic1: f32,
    ic2: f32,
}
impl Svf {
    /// One sample at `hz` and `q`; `kind` 0 low, 1 band, 2 high.
    #[inline]
    pub fn tick(&mut self, x: f32, hz: f32, q: f32, kind: u8, sr: f32) -> f32 {
        let g = (std::f32::consts::PI * (hz / sr).clamp(1e-5, 0.49)).tan();
        let k = 1.0 / q.max(0.3);
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        let a3 = g * a2;
        let v3 = x - self.ic2;
        let v1 = a1 * self.ic1 + a2 * v3;
        let v2 = self.ic2 + a2 * self.ic1 + a3 * v3;
        self.ic1 = flush(2.0 * v1 - self.ic1);
        self.ic2 = flush(2.0 * v2 - self.ic2);
        match kind {
            0 => v2,
            1 => v1,
            _ => x - k * v1 - v2,
        }
    }
}

/// Attack, decay, sustain, release. Attack is a line; decay and release fall
/// as a capacitor does.
#[derive(Clone, Default)]
pub struct Adsr {
    pub level: f32,
    stage: u8, // 0 idle, 1 attack, 2 decay/sustain, 3 release
}
impl Adsr {
    pub fn start(&mut self) {
        self.stage = 1;
    }
    pub fn release(&mut self) {
        if self.stage != 0 {
            self.stage = 3;
        }
    }
    pub fn idle(&self) -> bool {
        self.stage == 0
    }
    pub fn releasing(&self) -> bool {
        self.stage == 3
    }
    /// One sample with times in seconds.
    #[inline]
    pub fn tick(&mut self, a: f32, d: f32, s: f32, r: f32, sr: f32) -> f32 {
        match self.stage {
            1 => {
                self.level += 1.0 / (a.max(0.0005) * sr);
                if self.level >= 1.0 {
                    self.level = 1.0;
                    self.stage = 2;
                }
            }
            2 => {
                let c = 1.0 - (-4.6 / (d.max(0.001) * sr)).exp();
                self.level += (s - self.level) * c;
            }
            3 => {
                let c = 1.0 - (-6.9 / (r.max(0.002) * sr)).exp();
                self.level -= self.level * c;
                if self.level < 1e-5 {
                    self.level = 0.0;
                    self.stage = 0;
                }
            }
            _ => {}
        }
        self.level
    }
}

/// Values too small to hear are made zero, so a loop that has died away does
/// not crawl through subnormal numbers.
#[inline]
pub fn flush(x: f32) -> f32 {
    if x.abs() < 1e-20 {
        0.0
    } else {
        x
    }
}

/// A soft limit for the excitation of a nonlinear loop.
#[inline]
pub fn soft(x: f32) -> f32 {
    x / (1.0 + x.abs())
}
