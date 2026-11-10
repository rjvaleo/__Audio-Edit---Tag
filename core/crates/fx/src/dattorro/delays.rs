//! The moving delays (Part 2).

use super::*;

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
