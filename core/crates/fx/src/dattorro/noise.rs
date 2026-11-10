//! PN noise (Part 3, section 8).

use super::*;

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
