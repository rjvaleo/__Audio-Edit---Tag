//! The plate reverb (Part 1, Fig. 1).

use super::*;

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
    // How much of each output tap crosses to the other side. The tank has two
    // taps and they are only as wide as this lets them be; it was fixed at
    // 0.35, which is a width control nobody could reach.
    ParamSpec::new("crossfeed", "Width", 0.0, 1.0, 0.0),
];


/// The compact figure-eight plate in Part 1, Fig. 1. Delay lengths are the
/// published prime lengths, scaled from 29,761 Hz to the running sample rate.
/// Dattorro's Table 2: the seven output taps per channel, as
/// `(tank index, tap position at 29.761 kHz)`.
///
/// The node names in the paper map onto this tank as: `node24_30` is the left
/// half's long delay, `node31_33` its second decay diffuser, `node33_39` the
/// delay after it, and `node48_54`, `node55_59`, `node59_63` the same three on
/// the right. Every tap position is inside the length of the line it reads,
/// which is the check that the mapping is the right way round.
///
/// Note that the left output reads mostly from the *right* half of the tank and
/// vice versa. That crossing is what §1.3.6 means by the tap structure
/// producing "a synthetic stereo image": the input is summed to mono before the
/// tank, so every difference between the two ears is made here.
const PLATE_TAPS_L: [(usize, usize, f32); 7] = [
    (5, 266, 1.0),
    (5, 2974, 1.0),
    (6, 1913, -1.0),
    (7, 1996, 1.0),
    (1, 1990, -1.0),
    (2, 187, -1.0),
    (3, 1066, -1.0),
];
const PLATE_TAPS_R: [(usize, usize, f32); 7] = [
    (1, 353, 1.0),
    (1, 3627, 1.0),
    (2, 1228, -1.0),
    (3, 2673, 1.0),
    (5, 2111, -1.0),
    (6, 335, -1.0),
    (7, 121, -1.0),
];
/// The gain every tap is taken at, from the same table.
const PLATE_TAP_GAIN: f32 = 0.6;

pub struct Plate {
    p: [f32; 13],
    /// Tap positions in samples at this sample rate, scaled once at build.
    taps: ([usize; 7], [usize; 7]),
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
                0.0, 0.9995, 0.75, 0.625, 0.5, 0.7, 0.5, 0.0005, 0.3, 8.0, 0.35, 1.0, 0.0,
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
            taps: (
                std::array::from_fn(|i| n(PLATE_TAPS_L[i].1)),
                std::array::from_fn(|i| n(PLATE_TAPS_R[i].1)),
            ),
            sr,
        }
    }

    /// Sum one channel's seven taps.
    fn tap_sum(&self, which: &[(usize, usize, f32); 7], scaled: &[usize; 7]) -> f32 {
        let mut acc = 0.0;
        for (i, (line, _, sign)) in which.iter().enumerate() {
            let d = &self.tank[*line];
            let at = scaled[i].min(d.b.len().saturating_sub(2)).max(1);
            acc += sign * PLATE_TAP_GAIN * d.tap(at as f32);
        }
        acc
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
            // At least one sample. `tap` reads `w - delay`, and the slot at
            // `w` is the one about to be overwritten — it still holds the
            // sample from a whole buffer ago. A predelay of zero therefore read
            // 250 ms into the past rather than none at all, which is the
            // opposite of what the control says.
            let pd = (self.p[0] * sample_rate as f32 / 1000.0)
                .clamp(1.0, (self.pred.b.len() - 1) as f32);
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
            // The output is the tap network, not the ends of the tank. Reading
            // only the ends is why this had no early reflections at all: the
            // earliest tap in the table is 187 samples in, and waiting for a
            // whole circuit of the tank instead meant a quarter of a second of
            // silence before anything arrived.
            //
            // `l` and `r` are still needed — they are what was just written
            // into the lines the taps read from, and what feeds back.
            let _ = (l, r);
            let wl = self.tap_sum(&PLATE_TAPS_L, &self.taps.0);
            let wr = self.tap_sum(&PLATE_TAPS_R, &self.taps.1);
            fr[0] = dry_l * self.p[11] + (wl + wr * self.p[12]) * self.p[10];
            if fr.len() > 1 {
                fr[1] = dry_r * self.p[11] + (wr + wl * self.p[12]) * self.p[10];
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
