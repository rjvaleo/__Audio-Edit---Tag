//! Modules from Jon Dattorro's three-part "Effect Design" tutorial.
//!
//! The section references in this file point to the page-marked extracts in
//! `Reference Docs/md/dattorro-effect-design-part-*.md`.  These are deliberately
//! small, independently patchable building blocks; the plate keeps its feedback
//! tank internal because a zero-delay cycle in the outer graph would be noncausal.

use crate::params::{ParamSpec, Params};
use crate::Effect;
use std::f32::consts::{PI, TAU};

// ------------------------------------------------ plate (Part 1, Fig. 1)

pub(crate) const PLATE_SPECS: &[ParamSpec] = &[
    ParamSpec::new("predelayMs", "Predelay", 0.0, 250.0, 0.0).unit("ms"),
    ParamSpec::new("bandwidth", "Bandwidth", 0.0, 1.0, 0.9995),
    ParamSpec::new("inputDiffusion1", "Input diffusion 1", 0.0, 0.999, 0.75),
    ParamSpec::new("inputDiffusion2", "Input diffusion 2", 0.0, 0.999, 0.625),
    ParamSpec::new("decay", "Decay", 0.0, 0.9999, 0.5),
    ParamSpec::new("decayDiffusion1", "Decay diffusion 1", 0.0, 0.999, 0.7),
    ParamSpec::new("decayDiffusion2", "Decay diffusion 2", 0.0, 0.999, 0.5),
    ParamSpec::new("damping", "Damping", 0.0, 1.0, 0.0005),
    ParamSpec::new("modRateHz", "Mod rate", 0.01, 5.0, 0.3)
        .log()
        .unit("Hz"),
    ParamSpec::new("modDepth", "Mod depth", 0.0, 32.0, 8.0).unit("smp"),
    ParamSpec::new("wet", "Wet", 0.0, 1.0, 0.35),
    ParamSpec::new("dry", "Dry", 0.0, 1.0, 1.0),
];

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

/// The compact figure-eight plate in Part 1, Fig. 1. Delay lengths are the
/// published prime lengths, scaled from 29,761 Hz to the running sample rate.
pub struct Plate {
    p: [f32; 12],
    pred: Delay,
    input: [Delay; 4],
    tank: [Delay; 8],
    bw: f32,
    damp: [f32; 2],
    phase: f64,
    sr: u32,
}
impl Plate {
    pub fn new(sr: u32) -> Self {
        let sc = sr.max(1) as f32 / 29761.0;
        let n = |x: usize| ((x as f32 * sc).round() as usize).max(2);
        Self {
            p: [
                0.0, 0.9995, 0.75, 0.625, 0.5, 0.7, 0.5, 0.0005, 0.3, 8.0, 0.35, 1.0,
            ],
            pred: Delay::new((sr as usize / 4).max(2)),
            input: [
                Delay::new(n(142)),
                Delay::new(n(107)),
                Delay::new(n(379)),
                Delay::new(n(277)),
            ],
            tank: [
                Delay::new(n(672) + 64),
                Delay::new(n(4453)),
                Delay::new(n(1800)),
                Delay::new(n(3720)),
                Delay::new(n(908) + 64),
                Delay::new(n(4217)),
                Delay::new(n(2656)),
                Delay::new(n(3163)),
            ],
            bw: 0.0,
            damp: [0.0; 2],
            phase: 0.0,
            sr,
        }
    }
}
impl Effect for Plate {
    fn process(&mut self, b: &mut [f32], channels: usize, sample_rate: u32) {
        if sample_rate != self.sr {
            return;
        }
        let chn = channels.max(1);
        for fr in b.chunks_mut(chn) {
            let dry_l = fr[0];
            let dry_r = if fr.len() > 1 { fr[1] } else { dry_l };
            let mono = (dry_l + dry_r) * 0.5;
            self.bw += self.p[1] * (mono - self.bw);
            let pd = (self.p[0] * sample_rate as f32 / 1000.0).min((self.pred.b.len() - 1) as f32);
            let mut x = self.pred.tap(pd);
            self.pred.push(self.bw);
            x = ap(&mut self.input[0], x, self.p[2]);
            x = ap(&mut self.input[1], x, self.p[2]);
            x = ap(&mut self.input[2], x, self.p[3]);
            x = ap(&mut self.input[3], x, self.p[3]);
            let fb_l = self.tank[7].tap((self.tank[7].b.len() - 1) as f32) * self.p[4];
            let fb_r = self.tank[3].tap((self.tank[3].b.len() - 1) as f32) * self.p[4];
            let md = self.p[9] * (self.phase as f32).sin();
            let dl = (self.tank[0].b.len() - 64) as f32 + md;
            let dr = (self.tank[4].b.len() - 64) as f32 - md;
            let mut l = ap_mod(&mut self.tank[0], x + fb_l, self.p[5], dl);
            l = self.tank[1].step(l);
            self.damp[0] += (1.0 - self.p[7]) * (l - self.damp[0]);
            l = ap(&mut self.tank[2], self.damp[0] * self.p[4], self.p[6]);
            l = self.tank[3].step(l);
            let mut r = ap_mod(&mut self.tank[4], x + fb_r, self.p[5], dr);
            r = self.tank[5].step(r);
            self.damp[1] += (1.0 - self.p[7]) * (r - self.damp[1]);
            r = ap(&mut self.tank[6], self.damp[1] * self.p[4], self.p[6]);
            r = self.tank[7].step(r);
            self.phase = (self.phase + TAU as f64 * self.p[8] as f64 / sample_rate as f64)
                .rem_euclid(TAU as f64);
            fr[0] = dry_l * self.p[11] + (l + r * 0.35) * self.p[10];
            if fr.len() > 1 {
                fr[1] = dry_r * self.p[11] + (r + l * 0.35) * self.p[10];
            }
        }
    }
    fn reset(&mut self) {
        self.pred.clear();
        for d in &mut self.input {
            d.clear()
        }
        for d in &mut self.tank {
            d.clear()
        }
        self.bw = 0.0;
        self.damp = [0.0; 2];
        self.phase = 0.0;
    }
    fn name(&self) -> &'static str {
        "Dattorro plate"
    }
}
impl Params for Plate {
    fn specs(&self) -> &'static [ParamSpec] {
        PLATE_SPECS
    }
    fn get(&self, k: &str) -> Option<f32> {
        PLATE_SPECS
            .iter()
            .position(|s| s.key == k)
            .map(|i| self.p[i])
    }
    fn set(&mut self, k: &str, v: f32) -> bool {
        if let Some(i) = PLATE_SPECS.iter().position(|s| s.key == k) {
            self.p[i] = PLATE_SPECS[i].clamp(v);
            true
        } else {
            false
        }
    }
}

// ---------------------------------------------------------------- filters (Part 1, sections 2-3)

pub(crate) const FILTER_SPECS: &[ParamSpec] = &[
    ParamSpec::new("frequency", "Frequency", 20.0, 20_000.0, 1000.0)
        .log()
        .unit("Hz"),
    ParamSpec::new("bandwidth", "Bandwidth", 1.0, 10_000.0, 200.0)
        .log()
        .unit("Hz"),
    ParamSpec::new("gainDb", "Gain", -24.0, 24.0, 6.0).unit("dB"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MusicalFilterMode {
    Notch,
    Resonator,
    Regalia,
}

pub struct MusicalFilter {
    mode: MusicalFilterMode,
    frequency: f32,
    bandwidth: f32,
    gain_db: f32,
    mix: f32,
    // Direct-form II transposed state, one pair per channel.
    z1: [f32; 8],
    z2: [f32; 8],
}

impl MusicalFilter {
    pub fn new(mode: MusicalFilterMode) -> Self {
        Self {
            mode,
            frequency: 1000.0,
            bandwidth: 200.0,
            gain_db: 6.0,
            mix: 1.0,
            z1: [0.0; 8],
            z2: [0.0; 8],
        }
    }

    fn coeffs(&self, sr: u32) -> [f32; 5] {
        // Dattorro defines the excursion at the half-power points.  Converting
        // that musical bandwidth to Q gives the same pole radius relation while
        // remaining well behaved as the centre approaches either rail.
        let fs = sr.max(1) as f32;
        let f = self.frequency.clamp(1.0, fs * 0.49);
        let q = (f / self.bandwidth.max(0.1)).max(0.025);
        let w = TAU * f / fs;
        let (s, c) = w.sin_cos();
        let alpha = s / (2.0 * q);
        let (b0, b1, b2, a0, a1, a2) = match self.mode {
            MusicalFilterMode::Notch => (1.0, -2.0 * c, 1.0, 1.0 + alpha, -2.0 * c, 1.0 - alpha),
            MusicalFilterMode::Resonator => {
                (alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * c, 1.0 - alpha)
            }
            MusicalFilterMode::Regalia => {
                // The Regalia-Mitra boost/cut transfer has the same normalized
                // peaking response; this form avoids the lattice's fixed-point
                // magnitude-truncation concern (Part 1, 2.4.3).
                let a = 10f32.powf(self.gain_db / 40.0);
                (
                    1.0 + alpha * a,
                    -2.0 * c,
                    1.0 - alpha * a,
                    1.0 + alpha / a,
                    -2.0 * c,
                    1.0 - alpha / a,
                )
            }
        };
        [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0]
    }
}

impl Effect for MusicalFilter {
    fn process(&mut self, buf: &mut [f32], channels: usize, sample_rate: u32) {
        let c = self.coeffs(sample_rate);
        let n = channels.max(1).min(8);
        for frame in buf.chunks_mut(channels.max(1)) {
            for ch in 0..n.min(frame.len()) {
                let x = frame[ch];
                let y = c[0] * x + self.z1[ch];
                self.z1[ch] = c[1] * x - c[3] * y + self.z2[ch];
                self.z2[ch] = c[2] * x - c[4] * y;
                let y = if y.is_finite() { y } else { 0.0 };
                frame[ch] = x + (y - x) * self.mix;
            }
        }
    }
    fn reset(&mut self) {
        self.z1 = [0.0; 8];
        self.z2 = [0.0; 8];
    }
    fn name(&self) -> &'static str {
        match self.mode {
            MusicalFilterMode::Notch => "Dattorro notch",
            MusicalFilterMode::Resonator => "Dattorro resonator",
            MusicalFilterMode::Regalia => "Regalia-Mitra EQ",
        }
    }
}

impl Params for MusicalFilter {
    fn specs(&self) -> &'static [ParamSpec] {
        FILTER_SPECS
    }
    fn get(&self, k: &str) -> Option<f32> {
        match k {
            "frequency" => Some(self.frequency),
            "bandwidth" => Some(self.bandwidth),
            "gainDb" => Some(self.gain_db),
            _ => None,
        }
    }
    fn set(&mut self, k: &str, v: f32) -> bool {
        match k {
            "frequency" => self.frequency = FILTER_SPECS[0].clamp(v),
            "bandwidth" => self.bandwidth = FILTER_SPECS[1].clamp(v),
            "gainDb" => self.gain_db = FILTER_SPECS[2].clamp(v),
            _ => return false,
        };
        true
    }
}

pub(crate) const CHAMBERLIN_SPECS: &[ParamSpec] = &[
    ParamSpec::new("lowOn", "Low on", 0.0, 1.0, 1.0),
    ParamSpec::new("lowFreq", "Low frequency", 20.0, 18_000.0, 1000.0)
        .log()
        .unit("Hz"),
    ParamSpec::new("lowQ", "Low Q", 0.2, 10.0, 0.7),
    ParamSpec::new("lowAmp", "Low amplitude", 0.0, 1.0, 1.0),
    ParamSpec::new("bandOn", "Band on", 0.0, 1.0, 0.0),
    ParamSpec::new("bandFreq", "Band frequency", 20.0, 18_000.0, 1000.0)
        .log()
        .unit("Hz"),
    ParamSpec::new("bandQ", "Band Q", 0.2, 10.0, 1.0),
    ParamSpec::new("bandAmp", "Band amplitude", 0.0, 1.0, 0.0),
    ParamSpec::new("highOn", "High on", 0.0, 1.0, 0.0),
    ParamSpec::new("highFreq", "High frequency", 20.0, 18_000.0, 1000.0)
        .log()
        .unit("Hz"),
    ParamSpec::new("highQ", "High Q", 0.2, 10.0, 0.7),
    ParamSpec::new("highAmp", "High amplitude", 0.0, 1.0, 0.0),
    ParamSpec::new("notchOn", "Notch on", 0.0, 1.0, 0.0),
    ParamSpec::new("notchFreq", "Notch frequency", 20.0, 18_000.0, 1000.0)
        .log()
        .unit("Hz"),
    ParamSpec::new("notchQ", "Notch Q", 0.2, 10.0, 1.0),
    ParamSpec::new("notchAmp", "Notch amplitude", 0.0, 1.0, 0.0),
    ParamSpec::new("drive", "Drive", 0.25, 8.0, 1.0)
        .log()
        .unit("x"),
];

pub struct Chamberlin {
    p: [f32; 17],
    low: [[f32; 8]; 4],
    band: [[f32; 8]; 4],
}
impl Default for Chamberlin {
    fn default() -> Self {
        Self {
            p: [
                1.0, 1000.0, 0.7, 1.0, 0.0, 1000.0, 1.0, 0.0, 0.0, 1000.0, 0.7, 0.0, 0.0, 1000.0,
                1.0, 0.0, 1.0,
            ],
            low: [[0.0; 8]; 4],
            band: [[0.0; 8]; 4],
        }
    }
}
impl Effect for Chamberlin {
    fn process(&mut self, buf: &mut [f32], channels: usize, sample_rate: u32) {
        let chn = channels.max(1).min(8);
        let sr = sample_rate.max(1) as f32;
        for fr in buf.chunks_mut(channels.max(1)) {
            for ch in 0..chn.min(fr.len()) {
                let x = (fr[ch] * self.p[16]).tanh();
                let mut sum = 0.0;
                for mode in 0..4 {
                    let base = mode * 4;
                    if self.p[base] < 0.5 || self.p[base + 3] <= 0.0001 {
                        continue;
                    }
                    let f =
                        (2.0 * (PI * self.p[base + 1].min(sr * 0.45) / (2.0 * sr)).sin()).min(0.99);
                    let resonance = ((self.p[base + 2] - 0.2) / 9.8).clamp(0.0, 1.0);
                    let damp = (2.0 * (1.0 - resonance).max(0.02)).min(2.0 / f - f * 0.5);
                    let mut hi = 0.0;
                    for _ in 0..2 {
                        self.low[mode][ch] += f * self.band[mode][ch];
                        hi = x - self.low[mode][ch] - damp * self.band[mode][ch];
                        self.band[mode][ch] += f * hi;
                    }
                    let value = match mode {
                        0 => self.low[mode][ch],
                        1 => self.band[mode][ch],
                        2 => hi,
                        _ => hi + self.low[mode][ch],
                    };
                    sum += value * self.p[base + 3];
                }
                fr[ch] = sum.tanh();
            }
        }
    }
    fn reset(&mut self) {
        self.low = [[0.0; 8]; 4];
        self.band = [[0.0; 8]; 4];
    }
    fn name(&self) -> &'static str {
        "Chamberlin filter"
    }
}
impl Params for Chamberlin {
    fn specs(&self) -> &'static [ParamSpec] {
        CHAMBERLIN_SPECS
    }
    fn get(&self, k: &str) -> Option<f32> {
        CHAMBERLIN_SPECS
            .iter()
            .position(|s| s.key == k)
            .map(|i| self.p[i])
    }
    fn set(&mut self, k: &str, v: f32) -> bool {
        if let Some(i) = CHAMBERLIN_SPECS.iter().position(|s| s.key == k) {
            self.p[i] = CHAMBERLIN_SPECS[i].clamp(v);
            true
        } else {
            false
        }
    }
}

// -------------------------------------------------- moving delays (Part 2)

pub(crate) const MOD_DELAY_SPECS: &[ParamSpec] = &[
    ParamSpec::new("delayMs", "Delay", 0.1, 100.0, 14.0)
        .log()
        .unit("ms"),
    ParamSpec::new("depthMs", "Depth", 0.0, 50.0, 7.0).unit("ms"),
    ParamSpec::new("rateHz", "Rate", 0.01, 20.0, 0.55)
        .log()
        .unit("Hz"),
    ParamSpec::new("feedback", "Feedback", -0.98, 0.98, 0.12),
    ParamSpec::new("wet", "Wet", 0.0, 1.0, 0.8),
    ParamSpec::new("dry", "Dry", 0.0, 1.0, 1.0),
    ParamSpec::new("stereo", "Stereo phase", 0.0, 1.0, 0.5),
    ParamSpec::new("allpass", "All-pass interp", 0.0, 1.0, 0.0),
];
pub(crate) const FLANGER_SPECS: &[ParamSpec] = &[
    ParamSpec::new("delayMs", "Delay", 0.1, 100.0, 1.5)
        .log()
        .unit("ms"),
    ParamSpec::new("depthMs", "Depth", 0.0, 50.0, 1.2).unit("ms"),
    ParamSpec::new("rateHz", "Rate", 0.01, 20.0, 0.3)
        .log()
        .unit("Hz"),
    ParamSpec::new("feedback", "Feedback", -0.98, 0.98, 0.65),
    ParamSpec::new("wet", "Wet", 0.0, 1.0, 1.0),
    ParamSpec::new("dry", "Dry", 0.0, 1.0, 1.0),
    ParamSpec::new("stereo", "Stereo phase", 0.0, 1.0, 0.5),
    ParamSpec::new("allpass", "All-pass interp", 0.0, 1.0, 0.0),
];
pub(crate) const VIBRATO_SPECS: &[ParamSpec] = &[
    ParamSpec::new("delayMs", "Delay", 0.1, 100.0, 8.0)
        .log()
        .unit("ms"),
    ParamSpec::new("depthMs", "Depth", 0.0, 50.0, 3.0).unit("ms"),
    ParamSpec::new("rateHz", "Rate", 0.01, 20.0, 0.3)
        .log()
        .unit("Hz"),
    ParamSpec::new("feedback", "Feedback", -0.98, 0.98, 0.0),
    ParamSpec::new("wet", "Wet", 0.0, 1.0, 1.0),
    ParamSpec::new("dry", "Dry", 0.0, 1.0, 0.0),
    ParamSpec::new("stereo", "Stereo phase", 0.0, 1.0, 0.5),
    ParamSpec::new("allpass", "All-pass interp", 0.0, 1.0, 1.0),
];

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ModDelayMode {
    Chorus,
    Flanger,
    Vibrato,
}
pub struct ModDelay {
    mode: ModDelayMode,
    p: [f32; 8],
    buf: Vec<f32>,
    write: usize,
    phase: f64,
    ap_x: [f32; 8],
    ap_y: [f32; 8],
    channels: usize,
    sr: u32,
}
impl ModDelay {
    pub fn new(mode: ModDelayMode, sr: u32, channels: usize) -> Self {
        let mut p = [14.0, 7.0, 0.55, 0.12, 0.8, 1.0, 0.5, 0.0];
        match mode {
            ModDelayMode::Flanger => {
                p[0] = 1.5;
                p[1] = 1.2;
                p[3] = 0.65;
                p[4] = 1.0;
            }
            ModDelayMode::Vibrato => {
                p[0] = 8.0;
                p[1] = 3.0;
                p[4] = 1.0;
                p[5] = 0.0
            }
            _ => {}
        };
        let ch = channels.max(1);
        Self {
            mode,
            p,
            buf: vec![0.0; ((sr as f32 * 0.16) as usize + 4) * ch],
            write: 0,
            phase: 0.0,
            ap_x: [0.0; 8],
            ap_y: [0.0; 8],
            channels: ch,
            sr,
        }
    }
    fn read(&mut self, ch: usize, delay: f32) -> f32 {
        let frames = self.buf.len() / self.channels;
        let pos = (self.write / self.channels) as f32 - delay;
        let pos = pos.rem_euclid(frames as f32);
        let i = pos.floor() as usize;
        let frac = pos - i as f32;
        let x0 = self.buf[(i % frames) * self.channels + ch];
        let x1 = self.buf[((i + 1) % frames) * self.channels + ch];
        if self.p[7] < 0.5 {
            x0 + (x1 - x0) * frac
        } else {
            let a = (1.0 - frac) / (1.0 + frac).max(1e-6);
            let y = a * (x0 - self.ap_y[ch]) + self.ap_x[ch];
            let y = if y.is_finite() {
                y.clamp(-8.0, 8.0)
            } else {
                0.0
            };
            self.ap_x[ch] = x1;
            self.ap_y[ch] = y;
            y
        }
    }
}
impl Effect for ModDelay {
    fn process(&mut self, b: &mut [f32], channels: usize, sample_rate: u32) {
        if channels.max(1) != self.channels || sample_rate != self.sr {
            return;
        }
        let sr = sample_rate as f32;
        let frames = self.buf.len() / self.channels;
        for fr in b.chunks_mut(channels.max(1)) {
            let ph = self.phase as f32;
            for ch in 0..self.channels.min(fr.len()).min(8) {
                let phase = ph + self.p[6] * ch as f32 * PI;
                let d = ((self.p[0] + self.p[1] * phase.sin()).max(0.05) * sr / 1000.0)
                    .min((frames - 2) as f32);
                let wet = self.read(ch, d);
                let x = fr[ch];
                self.buf[self.write + ch] = x + wet * self.p[3];
                fr[ch] = x * self.p[5] + wet * self.p[4];
            }
            self.write = (self.write + self.channels) % self.buf.len();
            self.phase = (self.phase + TAU as f64 * self.p[2] as f64 / sample_rate as f64)
                .rem_euclid(TAU as f64);
        }
    }
    fn reset(&mut self) {
        self.buf.fill(0.0);
        self.write = 0;
        self.phase = 0.0;
        self.ap_x = [0.0; 8];
        self.ap_y = [0.0; 8];
    }
    fn name(&self) -> &'static str {
        match self.mode {
            ModDelayMode::Chorus => "White chorus",
            ModDelayMode::Flanger => "Flanger",
            ModDelayMode::Vibrato => "Vibrato",
        }
    }
}
impl Params for ModDelay {
    fn specs(&self) -> &'static [ParamSpec] {
        match self.mode {
            ModDelayMode::Flanger => FLANGER_SPECS,
            ModDelayMode::Vibrato => VIBRATO_SPECS,
            _ => MOD_DELAY_SPECS,
        }
    }
    fn get(&self, k: &str) -> Option<f32> {
        self.specs()
            .iter()
            .position(|s| s.key == k)
            .map(|i| self.p[i])
    }
    fn set(&mut self, k: &str, v: f32) -> bool {
        if let Some(i) = self.specs().iter().position(|s| s.key == k) {
            self.p[i] = self.specs()[i].clamp(v);
            true
        } else {
            false
        }
    }
}

// ------------------------------------------------ PN noise (Part 3, section 8)
pub(crate) const PN_SPECS: &[ParamSpec] = &[
    ParamSpec::new("clockHz", "Clock", 1.0, 48000.0, 48000.0)
        .log()
        .unit("Hz"),
    ParamSpec::new("level", "Level", 0.0, 1.0, 0.1),
    ParamSpec::new("mix", "Mix", 0.0, 1.0, 0.25),
    ParamSpec::new("seed", "Seed", 1.0, 16777215.0, 1.0),
];
pub struct PnNoise {
    p: [f32; 4],
    reg: u32,
    phase: f32,
    last: f32,
    equalized: bool,
    lp: f32,
}
impl PnNoise {
    pub fn new(equalized: bool) -> Self {
        Self {
            p: [48000.0, 0.1, 0.25, 1.0],
            reg: 1,
            phase: 0.0,
            last: 0.0,
            equalized,
            lp: 0.0,
        }
    }
}
impl Effect for PnNoise {
    fn process(&mut self, b: &mut [f32], channels: usize, sr: u32) {
        for fr in b.chunks_mut(channels.max(1)) {
            self.phase += self.p[0] / sr.max(1) as f32;
            if self.phase >= 1.0 {
                self.phase -= self.phase.floor();
                let bit =
                    ((self.reg >> 0) ^ (self.reg >> 1) ^ (self.reg >> 3) ^ (self.reg >> 4)) & 1;
                self.reg = (self.reg >> 1) | (bit << 23);
                if self.reg == 0 {
                    self.reg = 1
                }
                let mut n = (self.reg as f32 / 8388607.5) - 1.0;
                if self.equalized {
                    self.lp += 0.35 * (n - self.lp);
                    n = (n - self.lp) * 1.35;
                }
                self.last = n * self.p[1];
            }
            for x in fr {
                *x = *x * (1.0 - self.p[2]) + self.last * self.p[2];
            }
        }
    }
    fn reset(&mut self) {
        self.reg = (self.p[3] as u32).max(1) & 0xffffff;
        self.phase = 0.0;
        self.last = 0.0;
        self.lp = 0.0;
    }
    fn name(&self) -> &'static str {
        if self.equalized {
            "Equalized multibit PN"
        } else {
            "Multibit PN"
        }
    }
}
impl Params for PnNoise {
    fn specs(&self) -> &'static [ParamSpec] {
        PN_SPECS
    }
    fn get(&self, k: &str) -> Option<f32> {
        PN_SPECS.iter().position(|s| s.key == k).map(|i| self.p[i])
    }
    fn set(&mut self, k: &str, v: f32) -> bool {
        if let Some(i) = PN_SPECS.iter().position(|s| s.key == k) {
            self.p[i] = PN_SPECS[i].clamp(v);
            if i == 3 {
                self.reg = (self.p[3] as u32).max(1) & 0xffffff;
            }
            true
        } else {
            false
        }
    }
}

// ------------------------------------------ reusable paper primitives/effects

pub(crate) const DIFFUSER_SPECS: &[ParamSpec] = &[
    ParamSpec::new("delayMs", "Delay", 0.1, 100.0, 12.0)
        .log()
        .unit("ms"),
    ParamSpec::new("coefficient", "Coefficient", -0.999, 0.999, 0.625),
    ParamSpec::new("wet", "Wet", 0.0, 1.0, 1.0),
    ParamSpec::new("dry", "Dry", 0.0, 1.0, 0.0),
];

/// First-order lattice all-pass from Part 1, section 1.3.3.
pub struct AllpassDiffuser {
    p: [f32; 4],
    d: Vec<Delay>,
    sr: u32,
}
impl AllpassDiffuser {
    pub fn new(sr: u32, channels: usize) -> Self {
        Self {
            p: [12.0, 0.625, 1.0, 0.0],
            d: (0..channels.max(1).min(8))
                .map(|_| Delay::new((sr as usize / 8).max(2)))
                .collect(),
            sr,
        }
    }
}
impl Effect for AllpassDiffuser {
    fn process(&mut self, b: &mut [f32], channels: usize, sample_rate: u32) {
        if sample_rate != self.sr {
            return;
        }
        let n = channels.max(1).min(self.d.len());
        let delay = (self.p[0] * sample_rate as f32 / 1000.0).max(1.0);
        for fr in b.chunks_mut(channels.max(1)) {
            for ch in 0..n.min(fr.len()) {
                let x = fr[ch];
                let y = ap_mod(&mut self.d[ch], x, self.p[1], delay);
                fr[ch] = x * self.p[3] + y * self.p[2];
            }
        }
    }
    fn reset(&mut self) {
        for d in &mut self.d {
            d.clear()
        }
    }
    fn name(&self) -> &'static str {
        "All-pass diffuser"
    }
}
impl Params for AllpassDiffuser {
    fn specs(&self) -> &'static [ParamSpec] {
        DIFFUSER_SPECS
    }
    fn get(&self, k: &str) -> Option<f32> {
        DIFFUSER_SPECS
            .iter()
            .position(|s| s.key == k)
            .map(|i| self.p[i])
    }
    fn set(&mut self, k: &str, v: f32) -> bool {
        if let Some(i) = DIFFUSER_SPECS.iter().position(|s| s.key == k) {
            self.p[i] = DIFFUSER_SPECS[i].clamp(v);
            true
        } else {
            false
        }
    }
}

pub(crate) const DAMPING_SPECS: &[ParamSpec] = &[
    ParamSpec::new("cutoffHz", "Cutoff", 20.0, 20000.0, 6000.0)
        .log()
        .unit("Hz"),
    ParamSpec::new("wet", "Wet", 0.0, 1.0, 1.0),
    ParamSpec::new("dry", "Dry", 0.0, 1.0, 0.0),
];
pub struct DampingFilter {
    p: [f32; 3],
    z: [f32; 8],
}
impl Default for DampingFilter {
    fn default() -> Self {
        Self {
            p: [6000.0, 1.0, 0.0],
            z: [0.0; 8],
        }
    }
}
impl Effect for DampingFilter {
    fn process(&mut self, b: &mut [f32], channels: usize, sr: u32) {
        let n = channels.max(1).min(8);
        let a = 1.0 - (-TAU * self.p[0] / sr.max(1) as f32).exp();
        for fr in b.chunks_mut(channels.max(1)) {
            for ch in 0..n.min(fr.len()) {
                let x = fr[ch];
                self.z[ch] += a * (x - self.z[ch]);
                fr[ch] = x * self.p[2] + self.z[ch] * self.p[1];
            }
        }
    }
    fn reset(&mut self) {
        self.z = [0.0; 8]
    }
    fn name(&self) -> &'static str {
        "Damping filter"
    }
}
impl Params for DampingFilter {
    fn specs(&self) -> &'static [ParamSpec] {
        DAMPING_SPECS
    }
    fn get(&self, k: &str) -> Option<f32> {
        DAMPING_SPECS
            .iter()
            .position(|s| s.key == k)
            .map(|i| self.p[i])
    }
    fn set(&mut self, k: &str, v: f32) -> bool {
        if let Some(i) = DAMPING_SPECS.iter().position(|s| s.key == k) {
            self.p[i] = DAMPING_SPECS[i].clamp(v);
            true
        } else {
            false
        }
    }
}

pub(crate) const FILTER_BANK_SPECS: &[ParamSpec] = &[
    ParamSpec::new("notchOn", "Notch", 0.0, 1.0, 1.0),
    ParamSpec::new("notchHz", "Notch frequency", 20.0, 20000.0, 500.0)
        .log()
        .unit("Hz"),
    ParamSpec::new("notchQ", "Notch Q", 0.2, 18.0, 4.0),
    ParamSpec::new("notchAmp", "Notch amplitude", 0.0, 1.0, 1.0),
    ParamSpec::new("resonatorOn", "Resonator", 0.0, 1.0, 1.0),
    ParamSpec::new("resonatorHz", "Resonator frequency", 20.0, 20000.0, 1200.0)
        .log()
        .unit("Hz"),
    ParamSpec::new("resonatorQ", "Resonator Q", 0.2, 18.0, 5.0),
    ParamSpec::new("resonatorAmp", "Resonator amplitude", 0.0, 1.0, 0.7),
    ParamSpec::new("regaliaOn", "Regalia-Mitra", 0.0, 1.0, 1.0),
    ParamSpec::new("regaliaHz", "Regalia frequency", 20.0, 20000.0, 3000.0)
        .log()
        .unit("Hz"),
    ParamSpec::new("regaliaQ", "Regalia Q", 0.2, 18.0, 2.0),
    ParamSpec::new("regaliaAmp", "Regalia amplitude", 0.0, 1.0, 0.7),
    ParamSpec::new("dampingOn", "Damping", 0.0, 1.0, 1.0),
    ParamSpec::new("dampingHz", "Damping cutoff", 20.0, 20000.0, 6000.0)
        .log()
        .unit("Hz"),
    ParamSpec::new("dampingQ", "Damping Q", 0.2, 18.0, 0.7),
    ParamSpec::new("dampingAmp", "Damping amplitude", 0.0, 1.0, 1.0),
];

pub struct DattorroFilterBank {
    p: [f32; 16],
    notch: MusicalFilter,
    resonator: MusicalFilter,
    regalia: MusicalFilter,
    damping: DampingFilter,
}
impl Default for DattorroFilterBank {
    fn default() -> Self {
        Self {
            p: [
                1.0, 500.0, 4.0, 1.0, 1.0, 1200.0, 5.0, 0.7, 1.0, 3000.0, 2.0, 0.7, 1.0, 6000.0,
                0.7, 1.0,
            ],
            notch: MusicalFilter::new(MusicalFilterMode::Notch),
            resonator: MusicalFilter::new(MusicalFilterMode::Resonator),
            regalia: MusicalFilter::new(MusicalFilterMode::Regalia),
            damping: DampingFilter::default(),
        }
    }
}
impl Effect for DattorroFilterBank {
    fn process(&mut self, b: &mut [f32], channels: usize, sr: u32) {
        self.notch.frequency = self.p[1];
        self.notch.bandwidth = self.p[1] / self.p[2];
        self.notch.mix = self.p[3];
        if self.p[0] >= 0.5 {
            self.notch.process(b, channels, sr);
        }
        self.resonator.frequency = self.p[5];
        self.resonator.bandwidth = self.p[5] / self.p[6];
        self.resonator.mix = self.p[7];
        if self.p[4] >= 0.5 {
            self.resonator.process(b, channels, sr);
        }
        self.regalia.frequency = self.p[9];
        self.regalia.bandwidth = self.p[9] / self.p[10];
        self.regalia.gain_db = 12.0 * self.p[11];
        self.regalia.mix = self.p[11];
        if self.p[8] >= 0.5 {
            self.regalia.process(b, channels, sr);
        }
        let cutoff = (self.p[13] * (self.p[14] / 0.7).sqrt()).clamp(20.0, 20000.0);
        self.damping.p = [cutoff, self.p[15], 1.0 - self.p[15]];
        if self.p[12] >= 0.5 {
            self.damping.process(b, channels, sr);
        }
    }
    fn reset(&mut self) {
        self.notch.reset();
        self.resonator.reset();
        self.regalia.reset();
        self.damping.reset();
    }
    fn name(&self) -> &'static str {
        "Dattorro filter bank"
    }
}
impl Params for DattorroFilterBank {
    fn specs(&self) -> &'static [ParamSpec] {
        FILTER_BANK_SPECS
    }
    fn get(&self, k: &str) -> Option<f32> {
        FILTER_BANK_SPECS
            .iter()
            .position(|s| s.key == k)
            .map(|i| self.p[i])
    }
    fn set(&mut self, k: &str, v: f32) -> bool {
        if let Some(i) = FILTER_BANK_SPECS.iter().position(|s| s.key == k) {
            self.p[i] = FILTER_BANK_SPECS[i].clamp(v);
            true
        } else {
            false
        }
    }
}

pub(crate) const ECHO_SPECS: &[ParamSpec] = &[
    ParamSpec::new("delayMs", "Delay", 1.0, 4000.0, 350.0)
        .log()
        .unit("ms"),
    ParamSpec::new("feedback", "Feedback", -0.98, 0.98, 0.35),
    ParamSpec::new("damping", "Damping", 0.0, 1.0, 0.2),
    ParamSpec::new("wet", "Wet", 0.0, 1.0, 0.5),
    ParamSpec::new("dry", "Dry", 0.0, 1.0, 1.0),
    // How long the read pointer takes to travel to a new delay time.
    //
    // Moving the pointer *is* the sweep: while it is travelling, output is read
    // at a rate other than one sample per sample, and that is a pitch shift —
    // the tape-delay glide. At zero it jumps, which is silent only if the two
    // delay times happen to line up and is a click otherwise.
    ParamSpec::new("glideMs", "Glide", 0.0, 4000.0, 220.0).unit("ms"),
];
pub struct Echo {
    p: [f32; 6],
    d: Vec<Delay>,
    lp: [f32; 8],
    /// Where each channel's read pointer actually is, in samples.
    ///
    /// Kept per sample rather than worked out per block: recomputing it once a
    /// block and holding it means a delay time that changes lands as a step at
    /// the block boundary. No sweep, and a click.
    cur: [f32; 8],
    /// Whether `cur` has ever been placed. The first block snaps to the target
    /// instead of gliding up from zero.
    placed: bool,
    sr: u32,
}
impl Echo {
    pub fn new(sr: u32, channels: usize) -> Self {
        Self {
            p: [350.0, 0.35, 0.2, 0.5, 1.0, 220.0],
            d: (0..channels.max(1).min(8))
                .map(|_| Delay::new(sr as usize * 4 + 4))
                .collect(),
            lp: [0.0; 8],
            cur: [0.0; 8],
            placed: false,
            sr,
        }
    }
}
impl Effect for Echo {
    fn process(&mut self, b: &mut [f32], channels: usize, sample_rate: u32) {
        if sample_rate != self.sr {
            return;
        }
        let n = channels.max(1).min(self.d.len());
        let target = self.p[0] * sample_rate as f32 / 1000.0;
        if !self.placed {
            self.cur = [target; 8];
            self.placed = true;
        }
        // One-pole glide, per sample. A time constant rather than a fixed rate:
        // the pointer sets off quickly and eases in, which is how a tape delay
        // behaves when the knob moves and why the pitch bend decays instead of
        // stopping dead on arrival.
        let k = if self.p[5] <= 0.0 {
            1.0
        } else {
            1.0 - (-1.0 / (self.p[5] * 0.001 * sample_rate as f32).max(1.0)).exp()
        };
        for fr in b.chunks_mut(channels.max(1)) {
            for ch in 0..n.min(fr.len()) {
                self.cur[ch] += (target - self.cur[ch]) * k;
                let x = fr[ch];
                let y = self.d[ch].tap(self.cur[ch]);
                self.lp[ch] += (1.0 - self.p[2]) * (y - self.lp[ch]);
                self.d[ch].push(x + self.lp[ch] * self.p[1]);
                fr[ch] = x * self.p[4] + y * self.p[3];
            }
        }
    }
    fn reset(&mut self) {
        for d in &mut self.d {
            d.clear()
        }
        self.lp = [0.0; 8];
        // The pointer is placed again on the next block, so a render that
        // starts somewhere else does not open with a sweep it never asked for.
        self.placed = false;
    }
    fn name(&self) -> &'static str {
        "Echo"
    }
}
impl Params for Echo {
    fn specs(&self) -> &'static [ParamSpec] {
        ECHO_SPECS
    }
    fn get(&self, k: &str) -> Option<f32> {
        ECHO_SPECS
            .iter()
            .position(|s| s.key == k)
            .map(|i| self.p[i])
    }
    fn set(&mut self, k: &str, v: f32) -> bool {
        if let Some(i) = ECHO_SPECS.iter().position(|s| s.key == k) {
            self.p[i] = ECHO_SPECS[i].clamp(v);
            true
        } else {
            false
        }
    }
}

pub(crate) const LESLIE_SPECS: &[ParamSpec] = &[
    ParamSpec::new("rateHz", "Rate", 0.1, 12.0, 1.2)
        .log()
        .unit("Hz"),
    ParamSpec::new("depthMs", "Doppler", 0.0, 8.0, 2.0).unit("ms"),
    ParamSpec::new("amDepth", "Amplitude", 0.0, 1.0, 0.35),
    ParamSpec::new("width", "Stereo width", 0.0, 1.0, 1.0),
    ParamSpec::new("wet", "Wet", 0.0, 1.0, 1.0),
    ParamSpec::new("dry", "Dry", 0.0, 1.0, 0.0),
];
pub struct Leslie {
    p: [f32; 6],
    d: Delay,
    phase: f64,
    sr: u32,
}
impl Leslie {
    pub fn new(sr: u32, _channels: usize) -> Self {
        Self {
            p: [1.2, 2.0, 0.35, 1.0, 1.0, 0.0],
            d: Delay::new((sr as usize / 20).max(8)),
            phase: 0.0,
            sr,
        }
    }
}
impl Effect for Leslie {
    fn process(&mut self, b: &mut [f32], channels: usize, sample_rate: u32) {
        if sample_rate != self.sr {
            return;
        }
        let n = channels.max(1);
        for fr in b.chunks_mut(n) {
            let x = fr.iter().take(2).copied().sum::<f32>() / fr.len().min(2).max(1) as f32;
            self.d.push(x);
            let ph = self.phase as f32;
            for ch in 0..fr.len().min(2) {
                let side = if ch == 0 { -1.0 } else { 1.0 };
                let osc = (ph + side * self.p[3] * PI * 0.5).sin();
                let delay = (3.0 + self.p[1] * (1.0 + osc)) * sample_rate as f32 / 1000.0;
                let y = self.d.tap(delay) * (1.0 - self.p[2] + self.p[2] * (0.5 + 0.5 * osc));
                fr[ch] = fr[ch] * self.p[5] + y * self.p[4];
            }
            self.phase = (self.phase + TAU as f64 * self.p[0] as f64 / sample_rate as f64)
                .rem_euclid(TAU as f64);
        }
    }
    fn reset(&mut self) {
        self.d.clear();
        self.phase = 0.0
    }
    fn name(&self) -> &'static str {
        "Leslie"
    }
}
impl Params for Leslie {
    fn specs(&self) -> &'static [ParamSpec] {
        LESLIE_SPECS
    }
    fn get(&self, k: &str) -> Option<f32> {
        LESLIE_SPECS
            .iter()
            .position(|s| s.key == k)
            .map(|i| self.p[i])
    }
    fn set(&mut self, k: &str, v: f32) -> bool {
        if let Some(i) = LESLIE_SPECS.iter().position(|s| s.key == k) {
            self.p[i] = LESLIE_SPECS[i].clamp(v);
            true
        } else {
            false
        }
    }
}

pub(crate) const SINGLE_PN_SPECS: &[ParamSpec] = &[
    ParamSpec::new("clockHz", "Clock", 1.0, 48000.0, 48000.0)
        .log()
        .unit("Hz"),
    ParamSpec::new("level", "Level", 0.0, 1.0, 0.1),
    ParamSpec::new("mix", "Mix", 0.0, 1.0, 1.0),
    ParamSpec::new("seed", "Seed", 1.0, 16777215.0, 1.0),
];
pub struct SingleBitPn {
    p: [f32; 4],
    reg: u32,
    phase: f32,
    last: f32,
}
impl Default for SingleBitPn {
    fn default() -> Self {
        Self {
            p: [48000.0, 0.1, 1.0, 1.0],
            reg: 1,
            phase: 0.0,
            last: 0.1,
        }
    }
}
impl Effect for SingleBitPn {
    fn process(&mut self, b: &mut [f32], channels: usize, sr: u32) {
        for fr in b.chunks_mut(channels.max(1)) {
            self.phase += self.p[0] / sr.max(1) as f32;
            if self.phase >= 1.0 {
                self.phase -= self.phase.floor();
                let bit =
                    ((self.reg >> 0) ^ (self.reg >> 1) ^ (self.reg >> 3) ^ (self.reg >> 4)) & 1;
                self.reg = (self.reg >> 1) | (bit << 23);
                if self.reg == 0 {
                    self.reg = 1
                }
                self.last = if self.reg & 1 == 0 {
                    -self.p[1]
                } else {
                    self.p[1]
                };
            }
            for x in fr {
                *x = *x * (1.0 - self.p[2]) + self.last * self.p[2];
            }
        }
    }
    fn reset(&mut self) {
        self.reg = (self.p[3] as u32).max(1) & 0xffffff;
        self.phase = 0.0;
        self.last = self.p[1]
    }
    fn name(&self) -> &'static str {
        "Single-bit PN"
    }
}
impl Params for SingleBitPn {
    fn specs(&self) -> &'static [ParamSpec] {
        SINGLE_PN_SPECS
    }
    fn get(&self, k: &str) -> Option<f32> {
        SINGLE_PN_SPECS
            .iter()
            .position(|s| s.key == k)
            .map(|i| self.p[i])
    }
    fn set(&mut self, k: &str, v: f32) -> bool {
        if let Some(i) = SINGLE_PN_SPECS.iter().position(|s| s.key == k) {
            self.p[i] = SINGLE_PN_SPECS[i].clamp(v);
            if i == 3 {
                self.reg = (self.p[3] as u32).max(1) & 0xffffff
            }
            true
        } else {
            false
        }
    }
}

// ------------------------------------ windowed pitch effects (Part 2, 4.4/6)

struct PitchCore {
    d: Vec<Delay>,
    phase: f64,
    sr: u32,
    channels: usize,
}
impl PitchCore {
    fn new(sr: u32, channels: usize) -> Self {
        let ch = channels.max(1).min(8);
        Self {
            d: (0..ch)
                .map(|_| Delay::new((sr as usize / 2).max(8)))
                .collect(),
            phase: 0.25,
            sr,
            channels: ch,
        }
    }
    fn frame(&mut self, input: &[f32], out: &mut [f32], ratio: f32, window_ms: f32) {
        let win = (window_ms * self.sr as f32 / 1000.0).clamp(32.0, (self.d[0].b.len() - 2) as f32);
        for ch in 0..self.channels.min(input.len()).min(out.len()) {
            self.d[ch].push(input[ch]);
            let p = self.phase as f32;
            let p2 = (p + 0.5).fract();
            let a = self.d[ch].tap(1.0 + p * win);
            let b = self.d[ch].tap(1.0 + p2 * win);
            let wa = 0.5 - 0.5 * (TAU * p).cos();
            let wb = 1.0 - wa;
            out[ch] = a * wa + b * wb;
        }
        self.phase = (self.phase + (1.0 - ratio) as f64 / win as f64).rem_euclid(1.0);
    }
    fn reset(&mut self) {
        for d in &mut self.d {
            d.clear()
        }
        self.phase = 0.25;
    }
}

pub(crate) const PITCH_SPECS: &[ParamSpec] = &[
    ParamSpec::new("semitones", "Pitch", -24.0, 24.0, 7.0).unit("st"),
    ParamSpec::new("windowMs", "Window", 10.0, 250.0, 60.0)
        .log()
        .unit("ms"),
    ParamSpec::new("feedback", "Feedback", 0.0, 0.95, 0.0),
    ParamSpec::new("wet", "Wet", 0.0, 1.0, 0.5),
    ParamSpec::new("dry", "Dry", 0.0, 1.0, 1.0),
];
pub struct PitchShifter {
    p: [f32; 5],
    core: PitchCore,
    fb: [f32; 8],
}
impl PitchShifter {
    pub fn new(sr: u32, channels: usize) -> Self {
        Self {
            p: [7.0, 60.0, 0.0, 0.5, 1.0],
            core: PitchCore::new(sr, channels),
            fb: [0.0; 8],
        }
    }
}
impl Effect for PitchShifter {
    fn process(&mut self, b: &mut [f32], channels: usize, sr: u32) {
        if sr != self.core.sr {
            return;
        }
        let n = channels.max(1);
        let ratio = 2f32.powf(self.p[0] / 12.0);
        let mut input = [0.0; 8];
        let mut wet = [0.0; 8];
        for fr in b.chunks_mut(n) {
            for ch in 0..fr.len().min(8) {
                input[ch] = fr[ch] + self.fb[ch] * self.p[2];
            }
            self.core.frame(&input, &mut wet, ratio, self.p[1]);
            for ch in 0..fr.len().min(8) {
                let dry = fr[ch];
                self.fb[ch] = wet[ch];
                fr[ch] = dry * self.p[4] + wet[ch] * self.p[3];
            }
        }
    }
    fn reset(&mut self) {
        self.core.reset();
        self.fb = [0.0; 8]
    }
    fn name(&self) -> &'static str {
        "Harmonizer"
    }
}
impl Params for PitchShifter {
    fn specs(&self) -> &'static [ParamSpec] {
        PITCH_SPECS
    }
    fn get(&self, k: &str) -> Option<f32> {
        PITCH_SPECS
            .iter()
            .position(|s| s.key == k)
            .map(|i| self.p[i])
    }
    fn set(&mut self, k: &str, v: f32) -> bool {
        if let Some(i) = PITCH_SPECS.iter().position(|s| s.key == k) {
            self.p[i] = PITCH_SPECS[i].clamp(v);
            true
        } else {
            false
        }
    }
}

pub(crate) const DETUNE_SPECS: &[ParamSpec] = &[
    ParamSpec::new("cents", "Detune", 1.0, 100.0, 12.0)
        .log()
        .unit("ct"),
    ParamSpec::new("windowMs", "Window", 10.0, 250.0, 80.0)
        .log()
        .unit("ms"),
    ParamSpec::new("wet", "Wet", 0.0, 1.0, 0.65),
    ParamSpec::new("dry", "Dry", 0.0, 1.0, 1.0),
];
pub struct Detune {
    p: [f32; 4],
    up: PitchCore,
    down: PitchCore,
}
impl Detune {
    pub fn new(sr: u32, channels: usize) -> Self {
        Self {
            p: [12.0, 80.0, 0.65, 1.0],
            up: PitchCore::new(sr, channels),
            down: PitchCore::new(sr, channels),
        }
    }
}
impl Effect for Detune {
    fn process(&mut self, b: &mut [f32], channels: usize, sr: u32) {
        if sr != self.up.sr {
            return;
        }
        let n = channels.max(1);
        let r = 2f32.powf(self.p[0] / 1200.0);
        let mut input = [0.0; 8];
        let mut u = [0.0; 8];
        let mut d = [0.0; 8];
        for fr in b.chunks_mut(n) {
            for ch in 0..fr.len().min(8) {
                input[ch] = fr[ch]
            }
            self.up.frame(&input, &mut u, r, self.p[1]);
            self.down.frame(&input, &mut d, 1.0 / r, self.p[1]);
            for ch in 0..fr.len().min(8) {
                let shifted = if fr.len() > 1 {
                    if ch % 2 == 0 {
                        u[ch]
                    } else {
                        d[ch]
                    }
                } else {
                    (u[ch] + d[ch]) * 0.5
                };
                fr[ch] = fr[ch] * self.p[3] + shifted * self.p[2];
            }
        }
    }
    fn reset(&mut self) {
        self.up.reset();
        self.down.reset()
    }
    fn name(&self) -> &'static str {
        "Detune"
    }
}
impl Params for Detune {
    fn specs(&self) -> &'static [ParamSpec] {
        DETUNE_SPECS
    }
    fn get(&self, k: &str) -> Option<f32> {
        DETUNE_SPECS
            .iter()
            .position(|s| s.key == k)
            .map(|i| self.p[i])
    }
    fn set(&mut self, k: &str, v: f32) -> bool {
        if let Some(i) = DETUNE_SPECS.iter().position(|s| s.key == k) {
            self.p[i] = DETUNE_SPECS[i].clamp(v);
            true
        } else {
            false
        }
    }
}

pub(crate) const DOUBLER_SPECS: &[ParamSpec] = &[
    ParamSpec::new("delayMs", "Delay", 5.0, 100.0, 32.0)
        .log()
        .unit("ms"),
    ParamSpec::new("variationMs", "Variation", 0.0, 20.0, 3.0).unit("ms"),
    ParamSpec::new("rateHz", "Rate", 0.05, 5.0, 0.35)
        .log()
        .unit("Hz"),
    ParamSpec::new("wet", "Wet", 0.0, 1.0, 0.65),
    ParamSpec::new("dry", "Dry", 0.0, 1.0, 1.0),
];
pub struct Doubler {
    p: [f32; 5],
    d: Vec<Delay>,
    phase: f64,
    sr: u32,
}
impl Doubler {
    pub fn new(sr: u32, channels: usize) -> Self {
        Self {
            p: [32.0, 3.0, 0.35, 0.65, 1.0],
            d: (0..channels.max(1).min(8))
                .map(|_| Delay::new((sr as usize / 5).max(8)))
                .collect(),
            phase: 0.0,
            sr,
        }
    }
}
impl Effect for Doubler {
    fn process(&mut self, b: &mut [f32], channels: usize, sample_rate: u32) {
        if sample_rate != self.sr {
            return;
        }
        let n = channels.max(1).min(self.d.len());
        for fr in b.chunks_mut(channels.max(1)) {
            for ch in 0..n.min(fr.len()) {
                let x = fr[ch];
                let phase = self.phase as f32 + ch as f32 * 1.7;
                let delay =
                    (self.p[0] + self.p[1] * phase.sin()).max(1.0) * sample_rate as f32 / 1000.0;
                let y = self.d[ch].tap(delay);
                self.d[ch].push(x);
                fr[ch] = x * self.p[4] + y * self.p[3];
            }
            self.phase = (self.phase + TAU as f64 * self.p[2] as f64 / sample_rate as f64)
                .rem_euclid(TAU as f64);
        }
    }
    fn reset(&mut self) {
        for d in &mut self.d {
            d.clear()
        }
        self.phase = 0.0
    }
    fn name(&self) -> &'static str {
        "Doubler"
    }
}
impl Params for Doubler {
    fn specs(&self) -> &'static [ParamSpec] {
        DOUBLER_SPECS
    }
    fn get(&self, k: &str) -> Option<f32> {
        DOUBLER_SPECS
            .iter()
            .position(|s| s.key == k)
            .map(|i| self.p[i])
    }
    fn set(&mut self, k: &str, v: f32) -> bool {
        if let Some(i) = DOUBLER_SPECS.iter().position(|s| s.key == k) {
            self.p[i] = DOUBLER_SPECS[i].clamp(v);
            true
        } else {
            false
        }
    }
}

pub(crate) const DOPPLER_SPECS: &[ParamSpec] = &[
    ParamSpec::new("distanceMs", "Distance", 0.1, 1500.0, 40.0)
        .log()
        .unit("ms"),
    ParamSpec::new("velocityMps", "Velocity", -150.0, 150.0, 0.0).unit("m/s"),
    ParamSpec::new("wet", "Wet", 0.0, 1.0, 1.0),
    ParamSpec::new("dry", "Dry", 0.0, 1.0, 0.0),
];

/// Part 2 sections 4.1/4.4: Doppler is a delay whose length changes at a
/// constant physical velocity. Positive velocity is recession, so delay grows
/// by v/c samples per sample (c = 343 m/s) and the observed pitch falls.
pub struct Doppler {
    p: [f32; 4],
    delay: Vec<Delay>,
    current_samples: f32,
    sr: u32,
}

impl Doppler {
    pub fn new(sr: u32, channels: usize) -> Self {
        Self {
            p: [40.0, 0.0, 1.0, 0.0],
            delay: (0..channels.max(1).min(8))
                .map(|_| Delay::new((sr as usize * 2).max(8)))
                .collect(),
            current_samples: 40.0 * sr as f32 / 1000.0,
            sr,
        }
    }
}

impl Effect for Doppler {
    fn process(&mut self, buffer: &mut [f32], channels: usize, sample_rate: u32) {
        if sample_rate != self.sr {
            return;
        }
        let n = channels.max(1).min(self.delay.len());
        for frame in buffer.chunks_mut(channels.max(1)) {
            for ch in 0..n.min(frame.len()) {
                let dry = frame[ch];
                let wet = self.delay[ch].tap(self.current_samples.max(1.0));
                self.delay[ch].push(dry);
                frame[ch] = dry * self.p[3] + wet * self.p[2];
            }
            self.current_samples = (self.current_samples + self.p[1] / 343.0)
                .clamp(1.0, (self.delay[0].b.len() - 2) as f32);
        }
    }
    fn reset(&mut self) {
        for d in &mut self.delay {
            d.clear();
        }
        self.current_samples = self.p[0] * self.sr as f32 / 1000.0;
    }
    fn name(&self) -> &'static str {
        "Doppler"
    }
}

impl Params for Doppler {
    fn specs(&self) -> &'static [ParamSpec] {
        DOPPLER_SPECS
    }
    fn get(&self, key: &str) -> Option<f32> {
        DOPPLER_SPECS
            .iter()
            .position(|s| s.key == key)
            .map(|i| self.p[i])
    }
    fn set(&mut self, key: &str, value: f32) -> bool {
        if let Some(i) = DOPPLER_SPECS.iter().position(|s| s.key == key) {
            self.p[i] = DOPPLER_SPECS[i].clamp(value);
            if i == 0 {
                self.current_samples = self.p[0] * self.sr as f32 / 1000.0;
            }
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: u32 = 48_000;
    fn tone(hz: f32, n: usize) -> Vec<f32> {
        (0..n)
            .map(|i| (TAU * hz * i as f32 / SR as f32).sin() * 0.25)
            .collect()
    }
    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|v| v * v).sum::<f32>() / x.len().max(1) as f32).sqrt()
    }

    #[test]
    fn the_published_notch_rejects_its_centre_more_than_a_distant_tone() {
        let mut centre = tone(1000.0, 48000);
        let mut away = tone(3000.0, 48000);
        let mut a = MusicalFilter::new(MusicalFilterMode::Notch);
        a.process(&mut centre, 1, SR);
        let mut b = MusicalFilter::new(MusicalFilterMode::Notch);
        b.process(&mut away, 1, SR);
        assert!(rms(&centre[2000..]) < rms(&away[2000..]) * 0.15);
    }

    #[test]
    fn the_resonator_passes_its_centre_more_than_a_distant_tone() {
        let mut centre = tone(1000.0, 48000);
        let mut away = tone(3000.0, 48000);
        let mut a = MusicalFilter::new(MusicalFilterMode::Resonator);
        a.process(&mut centre, 1, SR);
        let mut b = MusicalFilter::new(MusicalFilterMode::Resonator);
        b.process(&mut away, 1, SR);
        assert!(rms(&centre[2000..]) > rms(&away[2000..]) * 5.0);
    }

    #[test]
    fn regalia_mitra_boost_and_cut_move_the_same_band_opposite_ways() {
        let src = tone(1000.0, 24000);
        let mut up = src.clone();
        let mut down = src.clone();
        let mut a = MusicalFilter::new(MusicalFilterMode::Regalia);
        a.set("gainDb", 12.0);
        a.process(&mut up, 1, SR);
        let mut b = MusicalFilter::new(MusicalFilterMode::Regalia);
        b.set("gainDb", -12.0);
        b.process(&mut down, 1, SR);
        assert!(rms(&up[2000..]) > rms(&src[2000..]) * 1.8);
        assert!(rms(&down[2000..]) < rms(&src[2000..]) * 0.65);
    }

    #[test]
    fn chamberlin_exposes_distinct_simultaneous_responses() {
        let src = tone(200.0, 12000);
        let mut low = src.clone();
        let mut high = src.clone();
        let mut l = Chamberlin::default();
        l.process(&mut low, 1, SR);
        let mut h = Chamberlin::default();
        h.set("lowOn", 0.0);
        h.set("lowAmp", 0.0);
        h.set("highOn", 1.0);
        h.set("highAmp", 1.0);
        h.process(&mut high, 1, SR);
        assert!(rms(&low[1000..]) > rms(&high[1000..]) * 2.0);
    }

    #[test]
    fn moving_delay_keeps_length_and_is_independent_of_block_boundaries() {
        let src = tone(440.0, 8192);
        let mut whole = src.clone();
        let mut split = src.clone();
        let mut a = ModDelay::new(ModDelayMode::Chorus, SR, 1);
        a.process(&mut whole, 1, SR);
        let mut b = ModDelay::new(ModDelayMode::Chorus, SR, 1);
        for block in split.chunks_mut(127) {
            b.process(block, 1, SR)
        }
        assert_eq!(whole.len(), src.len());
        assert_eq!(whole, split);
    }

    #[test]
    fn pn_noise_is_deterministic_but_the_seed_selects_another_sequence() {
        let mut a = vec![0.0; 1024];
        let mut b = a.clone();
        let mut c = a.clone();
        let mut x = PnNoise::new(false);
        x.process(&mut a, 1, SR);
        let mut y = PnNoise::new(false);
        y.process(&mut b, 1, SR);
        let mut z = PnNoise::new(false);
        z.set("seed", 12345.0);
        z.process(&mut c, 1, SR);
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert!(a.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn the_plate_is_causal_and_keeps_ringing_after_the_impulse() {
        let mut x = vec![0.0; SR as usize * 2];
        x[0] = 1.0;
        let mut p = Plate::new(SR);
        p.set("dry", 0.0);
        p.set("wet", 1.0);
        p.process(&mut x, 1, SR);
        assert!(x.iter().all(|v| v.is_finite()));
        assert!(
            x[1000..].iter().any(|v| v.abs() > 1e-7),
            "the tank produced no tail"
        );
        let middle = rms(&x[SR as usize / 2..SR as usize]);
        let late = rms(&x[SR as usize + SR as usize / 2..]);
        assert!(
            late < middle,
            "decay did not decay: middle {middle}, late {late}"
        );
    }

    #[test]
    fn standalone_allpass_preserves_steady_state_level_and_changes_phase() {
        let src = tone(997.0, 24000);
        let mut out = src.clone();
        let mut fx = AllpassDiffuser::new(SR, 1);
        fx.process(&mut out, 1, SR);
        assert!((rms(&out[4000..]) / rms(&src[4000..]) - 1.0).abs() < 0.03);
        assert_ne!(&out[4000..5000], &src[4000..5000]);
    }

    #[test]
    fn damping_removes_high_frequency_more_than_low_frequency() {
        let mut low = tone(200.0, 24000);
        let mut high = tone(8000.0, 24000);
        let mut a = DampingFilter::default();
        a.set("cutoffHz", 1000.0);
        a.process(&mut low, 1, SR);
        let mut b = DampingFilter::default();
        b.set("cutoffHz", 1000.0);
        b.process(&mut high, 1, SR);
        assert!(rms(&low[2000..]) > rms(&high[2000..]) * 2.0);
    }

    #[test]
    fn echo_places_the_impulse_at_the_requested_delay_and_repeats_it() {
        let mut x = vec![0.0; 24000];
        x[0] = 1.0;
        let mut e = Echo::new(SR, 1);
        e.set("delayMs", 100.0);
        e.set("feedback", 0.5);
        e.set("damping", 0.0);
        e.set("dry", 0.0);
        e.set("wet", 1.0);
        e.process(&mut x, 1, SR);
        assert!(x[4799].abs() < 1e-6 && x[4800] > 0.99);
        assert!((x[9600] - 0.5).abs() < 0.02);
    }

    #[test]
    fn leslie_moves_a_mono_tone_across_stereo_without_changing_length() {
        let mono = tone(440.0, 24000);
        let mut stereo: Vec<f32> = mono.iter().flat_map(|x| [*x, *x]).collect();
        let before = stereo.len();
        let mut l = Leslie::new(SR, 2);
        l.process(&mut stereo, 2, SR);
        assert_eq!(stereo.len(), before);
        assert!(stereo.chunks_exact(2).any(|f| (f[0] - f[1]).abs() > 1e-4));
    }

    #[test]
    fn single_bit_pn_is_bipolar_deterministic_and_never_sticks() {
        let mut a = vec![0.0; 4096];
        let mut b = a.clone();
        let mut x = SingleBitPn::default();
        x.process(&mut a, 1, SR);
        let mut y = SingleBitPn::default();
        y.process(&mut b, 1, SR);
        assert_eq!(a, b);
        assert!(a.iter().any(|v| *v > 0.0) && a.iter().any(|v| *v < 0.0));
        assert!(a.iter().all(|v| (*v).abs() <= 1.0));
    }

    fn crossings(x: &[f32]) -> usize {
        x.windows(2).filter(|w| w[0] <= 0.0 && w[1] > 0.0).count()
    }

    #[test]
    fn harmonizer_moves_pitch_an_octave_without_changing_length() {
        let mut x = tone(440.0, SR as usize);
        let n = x.len();
        let mut p = PitchShifter::new(SR, 1);
        p.set("semitones", 12.0);
        p.set("wet", 1.0);
        p.set("dry", 0.0);
        p.process(&mut x, 1, SR);
        assert_eq!(x.len(), n);
        let cycles = crossings(&x[12000..]);
        assert!(
            (cycles as i32 - 660).abs() < 30,
            "expected roughly 880 Hz after warmup, got {cycles} cycles"
        );
    }

    #[test]
    fn detune_makes_two_opposed_pitch_copies_in_stereo() {
        let mono = tone(440.0, 24000);
        let mut x: Vec<f32> = mono.iter().flat_map(|v| [*v, *v]).collect();
        let mut d = Detune::new(SR, 2);
        d.process(&mut x, 2, SR);
        assert!(x
            .chunks_exact(2)
            .skip(4000)
            .any(|f| (f[0] - f[1]).abs() > 1e-3));
    }

    #[test]
    fn doubler_has_a_real_second_arrival() {
        let mut x = vec![0.0; 12000];
        x[0] = 1.0;
        let mut d = Doubler::new(SR, 1);
        d.set("delayMs", 40.0);
        d.set("variationMs", 0.0);
        d.set("dry", 0.0);
        d.set("wet", 1.0);
        d.process(&mut x, 1, SR);
        assert!(x[1919].abs() < 1e-6 && x[1920].abs() > 0.5);
    }

    #[test]
    fn receding_doppler_source_lowers_pitch_without_changing_length() {
        let mut x = tone(440.0, SR as usize);
        let n = x.len();
        let mut d = Doppler::new(SR, 1);
        d.set("distanceMs", 40.0);
        d.set("velocityMps", 60.0);
        d.set("wet", 1.0);
        d.set("dry", 0.0);
        d.process(&mut x, 1, SR);
        assert_eq!(x.len(), n);
        let cycles = crossings(&x[12000..]);
        assert!(
            cycles < 350,
            "a receding source should be below 440 Hz; got {cycles} cycles"
        );
    }

    /// The delay has to *travel* to a new time, not jump to it.
    ///
    /// Moving the read pointer is what makes the sweep: while it travels the
    /// output is read at a rate other than one sample per sample, which is a
    /// pitch shift. This used to work out the tap once per block and hold it,
    /// so a delay-time change landed as a step at the block boundary — no
    /// sweep, and a click where the two delay times did not line up.
    #[test]
    fn changing_the_delay_time_sweeps_rather_than_jumping() {
        let sr = 48_000u32;
        let mut echo = Echo::new(sr, 1);
        // All wet, no feedback, so what comes out is only the delay line.
        for (k, v) in [("delayMs", 200.0), ("feedback", 0.0), ("damping", 0.0),
                       ("wet", 1.0), ("dry", 0.0), ("glideMs", 200.0)] {
            assert!(Params::set(&mut echo, k, v), "no {k}");
        }

        // Fill the line with a steady tone, then move the delay time.
        let tone: Vec<f32> = (0..sr as usize).map(|i| (i as f32 * 0.05).sin() * 0.5).collect();
        let mut warm = tone[..sr as usize / 2].to_vec();
        Effect::process(&mut echo, &mut warm, 1, sr);

        assert!(Params::set(&mut echo, "delayMs", 400.0));
        let mut moving = tone[sr as usize / 2..].to_vec();
        Effect::process(&mut echo, &mut moving, 1, sr);

        // While the pointer travels the output is resampled, so its zero
        // crossings cannot match the input's over the same span.
        let crossings = |x: &[f32]| x.windows(2).filter(|w| (w[0] < 0.0) != (w[1] < 0.0)).count();
        let src = crossings(&tone[sr as usize / 2..sr as usize / 2 + 9600]);
        let out = crossings(&moving[..9600]);
        assert!(
            (src as i32 - out as i32).abs() > 20,
            "the delay did not sweep: {src} crossings in, {out} out"
        );

        // And it settles: once the glide is done the pitch is back to the source.
        let mut settled = tone[..9600].to_vec();
        Effect::process(&mut echo, &mut settled, 1, sr);
        let after = crossings(&settled);
        let steady = crossings(&tone[..9600]);
        assert!(
            (steady as i32 - after as i32).abs() <= 8,
            "the delay never settled: {steady} expected, {after} got"
        );
    }

    /// Glide at zero is the old behaviour, kept for anyone who wants the jump.
    #[test]
    fn a_zero_glide_arrives_immediately() {
        let sr = 48_000u32;
        let mut echo = Echo::new(sr, 1);
        for (k, v) in [("delayMs", 100.0), ("feedback", 0.0), ("wet", 1.0),
                       ("dry", 0.0), ("glideMs", 0.0)] {
            assert!(Params::set(&mut echo, k, v));
        }
        let mut buf = vec![0.0f32; 512];
        Effect::process(&mut echo, &mut buf, 1, sr);
        assert!(Params::set(&mut echo, "delayMs", 300.0));
        let mut next = vec![0.0f32; 512];
        Effect::process(&mut echo, &mut next, 1, sr);
        // One sample in and the pointer is already there.
        assert!((echo.cur[0] - 300.0 * sr as f32 / 1000.0).abs() < 1.0);
    }
}
