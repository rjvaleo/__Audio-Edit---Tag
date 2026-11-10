//! The filters (Part 1, sections 2-3).

use super::*;

// ---------------------------------------------------------------- filters (Part 1, sections 2-3)

pub(crate) const FILTER_SPECS: &[ParamSpec] = &[
    ParamSpec::new("frequency", "Frequency", 20.0, 20_000.0, 1000.0)
        .log()
        .unit("Hz"),
    ParamSpec::new("bandwidth", "Bandwidth", 1.0, 10_000.0, 200.0)
        .log()
        .unit("Hz"),
    ParamSpec::new("gainDb", "Gain", -24.0, 24.0, 6.0).unit("dB"),
    // Already read by `process` and with no key to reach it, which made these
    // three the only modules in the rack with no dry path at all.
    ParamSpec::new("mix", "Dry / wet", 0.0, 1.0, 1.0),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MusicalFilterMode {
    Notch,
    Resonator,
    Regalia,
}

pub struct MusicalFilter {
    mode: MusicalFilterMode,
    pub(super) frequency: f32,
    pub(super) bandwidth: f32,
    pub(super) gain_db: f32,
    pub(super) mix: f32,
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
            "mix" => Some(self.mix),
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
            "mix" => self.mix = FILTER_SPECS[3].clamp(v),
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
