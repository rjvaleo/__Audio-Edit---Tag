//! The windowed pitch effects (Part 2, 4.4/6).

use super::*;

// ------------------------------------ windowed pitch effects (Part 2, 4.4/6)

struct PitchCore {
    d: Vec<Delay>,
    phase: f64,
    sr: u32,
    channels: usize,
}
impl PitchCore {
    pub(super) fn new(sr: u32, channels: usize) -> Self {
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
    pub(super) fn reset(&mut self) {
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
    // Air, at sea level, around 20 °C. A physical constant right up until
    // you want the sweep to be unnatural, which is most of why anyone
    // reaches for a Doppler in the first place.
    ParamSpec::new("speedMps", "Speed of sound", 20.0, 2000.0, 343.0).log().unit("m/s"),
];

/// Part 2 sections 4.1/4.4: Doppler is a delay whose length changes at a
/// constant physical velocity. Positive velocity is recession, so delay grows
/// by v/c samples per sample (c = 343 m/s) and the observed pitch falls.
pub struct Doppler {
    p: [f32; 5],
    delay: Vec<Delay>,
    current_samples: f32,
    sr: u32,
}

impl Doppler {
    pub fn new(sr: u32, channels: usize) -> Self {
        Self {
            p: [40.0, 0.0, 1.0, 0.0, 343.0],
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
            self.current_samples = (self.current_samples + self.p[1] / self.p[4].max(1.0))
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
