//! The simple shapers and the ring modulator.

use super::*;

// --------------------------------------------------------------- the simple ones

/// Polarity. Nothing on its own; everything against a copy of itself.
#[derive(Debug, Clone, Copy, Default)]
pub struct Invert;

impl Effect for Invert {
    fn process(&mut self, buf: &mut [f32], _channels: usize, _sample_rate: u32) {
        for s in buf.iter_mut() {
            *s = -*s;
        }
    }
    fn reset(&mut self) {}
    fn name(&self) -> &'static str {
        "Invert"
    }
}

impl Params for Invert {
    fn specs(&self) -> &'static [ParamSpec] {
        &[]
    }
    fn get(&self, _key: &str) -> Option<f32> {
        None
    }
    fn set(&mut self, _key: &str, _value: f32) -> bool {
        false
    }
}

/// Left becomes right. A mono signal notices nothing.
#[derive(Debug, Clone, Copy, Default)]
pub struct SwapChannels;

impl Effect for SwapChannels {
    fn process(&mut self, buf: &mut [f32], channels: usize, _sample_rate: u32) {
        if channels < 2 {
            return;
        }
        for f in buf.chunks_mut(channels) {
            f.swap(0, 1);
        }
    }
    fn reset(&mut self) {}
    fn name(&self) -> &'static str {
        "Swap"
    }
}

impl Params for SwapChannels {
    fn specs(&self) -> &'static [ParamSpec] {
        &[]
    }
    fn get(&self, _key: &str) -> Option<f32> {
        None
    }
    fn set(&mut self, _key: &str, _value: f32) -> bool {
        false
    }
}

/// Mono to stereo and past it, on the mid/side split.
///
/// Zero collapses to the middle, one leaves the sound alone, and beyond one the
/// sides are pushed past what was recorded — which widens an image and hollows
/// anything that was dead centre, because centre *is* the mid signal.
#[derive(Debug, Clone, Copy)]
pub struct Width {
    pub width: f32,
}

pub(super) const WIDTH_SPECS: &[ParamSpec] = &[ParamSpec::new("width", "Width", 0.0, 2.0, 1.0).unit("x")];

impl Default for Width {
    fn default() -> Self {
        Width { width: 1.0 }
    }
}

impl Effect for Width {
    fn process(&mut self, buf: &mut [f32], channels: usize, _sample_rate: u32) {
        if channels < 2 {
            return;
        }
        let w = self.width.clamp(0.0, 2.0);
        for f in buf.chunks_mut(channels) {
            let (l, r) = (f[0], f[1]);
            let mid = (l + r) * 0.5;
            let side = (l - r) * 0.5 * w;
            f[0] = mid + side;
            f[1] = mid - side;
        }
    }
    fn reset(&mut self) {}
    fn name(&self) -> &'static str {
        "Width"
    }
}

impl Params for Width {
    fn specs(&self) -> &'static [ParamSpec] {
        WIDTH_SPECS
    }
    fn get(&self, key: &str) -> Option<f32> {
        (key == "width").then_some(self.width)
    }
    fn set(&mut self, key: &str, value: f32) -> bool {
        if key == "width" {
            self.width = WIDTH_SPECS[0].clamp(value);
            return true;
        }
        false
    }
}

/// Take the offset out.
///
/// A one-pole high pass at a few hertz rather than a subtracted mean: the mean
/// needs the whole file, and an offset that drifts — which is what a bad
/// converter actually produces — is not a constant to subtract.
#[derive(Debug, Clone, Copy)]
pub struct DcOffset {
    pub hz: f32,
    state: [f32; 8],
}

pub(super) const DC_SPECS: &[ParamSpec] = &[ParamSpec::new("hz", "Below", 1.0, 60.0, 5.0)
    .log()
    .unit("Hz")];

impl Default for DcOffset {
    fn default() -> Self {
        DcOffset {
            hz: 5.0,
            state: [0.0; 8],
        }
    }
}

impl Effect for DcOffset {
    fn process(&mut self, buf: &mut [f32], channels: usize, sample_rate: u32) {
        let channels = channels.max(1).min(self.state.len());
        let sr = sample_rate.max(1) as f32;
        let k = (std::f32::consts::TAU * self.hz.clamp(1.0, 60.0) / sr).min(0.5);
        for f in buf.chunks_mut(channels.max(1)) {
            for ch in 0..channels.min(f.len()) {
                self.state[ch] += k * (f[ch] - self.state[ch]);
                f[ch] -= self.state[ch];
            }
        }
    }
    fn reset(&mut self) {
        self.state = [0.0; 8];
    }
    fn name(&self) -> &'static str {
        "DC"
    }
}

impl Params for DcOffset {
    fn specs(&self) -> &'static [ParamSpec] {
        DC_SPECS
    }
    fn get(&self, key: &str) -> Option<f32> {
        (key == "hz").then_some(self.hz)
    }
    fn set(&mut self, key: &str, value: f32) -> bool {
        if key == "hz" {
            self.hz = DC_SPECS[0].clamp(value);
            return true;
        }
        false
    }
}

// ------------------------------------------------------------------ ring mod

/// What the oscillator does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wave {
    Sine,
    Square,
    Saw,
    Triangle,
}

impl Wave {
    pub fn as_str(self) -> &'static str {
        match self {
            Wave::Sine => "sine",
            Wave::Square => "square",
            Wave::Saw => "saw",
            Wave::Triangle => "triangle",
        }
    }
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "sine" => Some(Wave::Sine),
            "square" => Some(Wave::Square),
            "saw" => Some(Wave::Saw),
            "triangle" => Some(Wave::Triangle),
            _ => None,
        }
    }
    fn at(self, phase: f32) -> f32 {
        match self {
            Wave::Sine => (std::f32::consts::TAU * phase).sin(),
            Wave::Square => {
                if phase < 0.5 {
                    1.0
                } else {
                    -1.0
                }
            }
            Wave::Saw => 2.0 * phase - 1.0,
            Wave::Triangle => 4.0 * (phase - 0.5).abs() - 1.0,
        }
    }
}

/// Ring modulation: two signals multiplied.
///
/// The output holds the sum and difference of every pair of frequencies in the
/// two, and nothing of either original — which is why it sounds metallic and
/// why the result is unrelated to the key of what went in. Peak multiplies by
/// whatever is on the clipboard; here it is an oscillator, which is what its
/// own manual suggests trying first, and which can be swept.
#[derive(Debug, Clone, Copy)]
pub struct RingMod {
    pub hz: f32,
    pub mix: f32,
    /// Hertz the oscillator climbs or falls per second. A swept ring modulator
    /// is the sound of something being tuned through a signal.
    pub sweep: f32,
    pub wave: Wave,
    phase: f32,
    swept: f32,
}

pub(super) const RING_SPECS: &[ParamSpec] = &[
    ParamSpec::new("hz", "Frequency", 0.1, 8000.0, 220.0)
        .log()
        .unit("Hz"),
    ParamSpec::new("mix", "Mix", 0.0, 1.0, 1.0),
    ParamSpec::new("sweep", "Sweep", -2000.0, 2000.0, 0.0).unit("Hz/s"),
];

impl Default for RingMod {
    fn default() -> Self {
        RingMod {
            hz: 220.0,
            mix: 1.0,
            sweep: 0.0,
            wave: Wave::Sine,
            phase: 0.0,
            swept: 0.0,
        }
    }
}

impl Effect for RingMod {
    fn process(&mut self, buf: &mut [f32], channels: usize, sample_rate: u32) {
        let channels = channels.max(1);
        let sr = sample_rate.max(1) as f32;
        let mix = self.mix.clamp(0.0, 1.0);
        for f in buf.chunks_mut(channels) {
            let hz = (self.hz + self.swept).clamp(0.01, sr * 0.45);
            let m = self.wave.at(self.phase);
            for s in f.iter_mut() {
                *s = *s * (1.0 - mix) + *s * m * mix;
            }
            self.phase = (self.phase + hz / sr).fract();
            self.swept += self.sweep / sr;
            // The sweep is allowed to run away, so it is folded rather than
            // clamped — a modulator that sticks at the top of its range is a
            // modulator that has stopped modulating.
            if (self.hz + self.swept) > sr * 0.45 || (self.hz + self.swept) < 0.01 {
                self.swept = 0.0;
            }
        }
    }
    fn reset(&mut self) {
        self.phase = 0.0;
        self.swept = 0.0;
    }
    fn name(&self) -> &'static str {
        "Ring"
    }
}

impl Params for RingMod {
    fn specs(&self) -> &'static [ParamSpec] {
        RING_SPECS
    }
    fn get(&self, key: &str) -> Option<f32> {
        match key {
            "hz" => Some(self.hz),
            "mix" => Some(self.mix),
            "sweep" => Some(self.sweep),
            _ => None,
        }
    }
    fn set(&mut self, key: &str, value: f32) -> bool {
        match key {
            "hz" => self.hz = RING_SPECS[0].clamp(value),
            "mix" => self.mix = RING_SPECS[1].clamp(value),
            "sweep" => self.sweep = RING_SPECS[2].clamp(value),
            _ => return false,
        }
        true
    }
}
