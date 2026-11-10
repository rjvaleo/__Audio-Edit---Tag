//! The reusable primitives and effects from the papers.

use super::*;

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
/// Retired from the rack: Echo now comes from `prism-fx` (see `crate::prism`),
/// and documents that name `dattorro_echo` open on that one. This stays as the
/// reference `tests/prism.rs` holds the prism Echo to, bit for bit.
pub struct Echo {
    p: [f32; 6],
    d: Vec<Delay>,
    lp: [f32; 8],
    /// Where each channel's read pointer actually is, in samples.
    ///
    /// Kept per sample rather than worked out per block: recomputing it once a
    /// block and holding it means a delay time that changes lands as a step at
    /// the block boundary. No sweep, and a click.
    pub(super) cur: [f32; 8],
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
    // The horn's own distance. It was a fixed 3 ms — the rate and depth of
    // the rotation were adjustable but the radius it rotated at was not.
    ParamSpec::new("baseMs", "Distance", 0.5, 40.0, 3.0).unit("ms"),
];
pub struct Leslie {
    p: [f32; 7],
    d: Delay,
    phase: f64,
    sr: u32,
}
impl Leslie {
    pub fn new(sr: u32, _channels: usize) -> Self {
        Self {
            p: [1.2, 2.0, 0.35, 1.0, 1.0, 0.0, 3.0],
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
                let delay = (self.p[6] + self.p[1] * (1.0 + osc)) * sample_rate as f32 / 1000.0;
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
