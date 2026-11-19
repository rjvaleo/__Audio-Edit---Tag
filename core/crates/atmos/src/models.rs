//! The ten oscillators, each a model of a thing that vibrates (RJ, 17 Nov
//! 2026: "its oscillators should be physically modeled"): an exciter driving
//! a body, sample by sample. Plan: `WORK DIR/page-mockups/ATMOS-PHYS-PLAN.md`.
//!
//! Each takes its four controls as 0–1 (`p[0]`…`p[3]`, named in [`MODELS`]),
//! and is retuned every sample (glide, drift, the LFOs) through `set_hz`.

use crate::dsp::*;
use std::f32::consts::PI;

/// The models, in the order the page's cards show them: id, name, its four
/// controls' names, and their defaults.
pub const MODELS: &[(&str, &str, [&str; 4], [f32; 4])] = &[
    ("pluck", "Plucked string", ["Position", "Damping", "Stiffness", "Pick"], [0.2, 0.3, 0.1, 0.6]),
    ("bow", "Bowed string", ["Pressure", "Speed", "Position", "Rosin"], [0.5, 0.5, 0.25, 0.2]),
    ("bar", "Struck bar", ["Material", "Hardness", "Strike", "Decay"], [0.5, 0.5, 0.3, 0.5]),
    ("bell", "Bell", ["Size", "Tierce", "Strike", "Ring"], [0.5, 0.3, 0.5, 0.6]),
    ("glass", "Glass", ["Bow / strike", "Fill", "Ring", "Bright"], [0.2, 0.4, 0.7, 0.5]),
    ("membrane", "Membrane", ["Tension", "Damping", "Strike", "Size"], [0.5, 0.4, 0.3, 0.5]),
    ("pipe", "Blown pipe", ["Breath", "Noise", "Embouchure", "Bore"], [0.6, 0.3, 0.5, 0.0]),
    ("reed", "Reed", ["Pressure", "Stiffness", "Bell", "Noise"], [0.6, 0.5, 0.5, 0.1]),
    ("voice", "Voice", ["Vowel", "Tension", "Breath", "Size"], [0.2, 0.5, 0.3, 0.5]),
    ("classic", "Classic", ["Wave", "", "", ""], [0.66, 0.0, 0.0, 0.0]),
];

pub fn model_index(id: &str) -> Option<usize> {
    MODELS.iter().position(|m| m.0 == id)
}

/// A one-pole low-pass's phase delay at `w` radians a sample: what a loop
/// through it must give back to stay in tune at that frequency.
fn onepole_delay(b: f32, w: f32) -> f32 {
    (b * w.sin()).atan2(1.0 - b * w.cos()) / w.max(1e-6)
}

/// A first-order all-pass's phase delay at `w` (H = (a + z⁻¹) / (1 + a z⁻¹)).
fn allpass_delay(a: f32, w: f32) -> f32 {
    let (c, s) = (w.cos(), w.sin());
    // numerator a + e^{-jw}, denominator 1 + a e^{-jw}
    let (nr, ni) = (a + c, -s);
    let (dr, di) = (1.0 + a * c, -a * s);
    let ph = ni.atan2(nr) - di.atan2(dr);
    -ph / w.max(1e-6)
}

/// The most modes a modal model rings.
const MODES: usize = 10;

/// One running oscillator.
pub struct Osc {
    kind: usize,
    faulted: bool,
    failed: bool,
    sr: f32,
    hz: f32,
    p: [f32; 4],
    held: bool,
    t: u32,
    noise: Noise,
    // waveguides
    d1: Delay,
    d2: Delay,
    lp: OnePole,
    ap: AllPass1,
    dc: DcBlock,
    body: [Mode; 3],
    // modal
    modes: [Mode; MODES],
    ratios: [f32; MODES],
    n_modes: usize,
    pulse: u32, // samples of mallet left
    pulse_len: u32,
    // classic, voice
    phase: f32,
    formants: [Svf; 5],
    // what it shows
    pub view: [f32; 32],
    /// How far the modal models' modes move onto the scale (0–1).
    pub fit: f32,
    /// The sample the note was let go at (0 while held).
    rel_t: f32,
    /// The modal models' decay, kept for retuning as the membrane slackens.
    view_t60: f32,
    view_slope: f32,
    /// The reed's bell filter.
    view_bell: f32,
}

impl Osc {
    pub fn new(sr: f32, seed: u32) -> Self {
        Osc {
            kind: 0,
            faulted: false,
            failed: false,
            sr,
            hz: 220.0,
            p: [0.5; 4],
            held: false,
            t: 0,
            noise: Noise::new(seed),
            d1: Delay::new(),
            d2: Delay::new(),
            lp: OnePole::default(),
            ap: AllPass1::default(),
            dc: DcBlock::default(),
            body: Default::default(),
            modes: Default::default(),
            ratios: [1.0; MODES],
            n_modes: 0,
            pulse: 0,
            pulse_len: 1,
            phase: 0.0,
            formants: Default::default(),
            view: [0.0; 32],
            fit: 0.0,
            rel_t: 0.0,
            view_t60: 1.0,
            view_slope: 0.5,
            view_bell: 0.0,
        }
    }

    pub fn kind(&self) -> usize {
        self.kind
    }

    /// A new note: the body still, then the exciter set going.
    pub fn start(&mut self, kind: usize, hz: f32, vel: f32, p: [f32; 4], scale: &[f32]) {
        self.faulted = false;
        self.kind = kind.min(MODELS.len() - 1);
        self.p = p;
        self.held = true;
        self.t = 0;
        self.rel_t = 0.0;
        self.view_bell = 0.0;
        self.phase = 0.0;
        // Only waveguide models read delay memory. A later waveguide start
        // clears it before use, including after a run of modal notes.
        if matches!(self.kind, 0 | 1 | 6 | 7) {
            self.d1.clear();
            self.d2.clear();
        }
        self.lp.clear();
        self.dc = DcBlock::default();
        self.ap = AllPass1::default();
        for m in self.modes.iter_mut() {
            m.clear();
        }
        self.formants = Default::default();
        self.set_hz(hz);
        match self.kind {
            0 => self.pluck(vel),
            2 | 3 | 4 | 5 => self.modal_setup(vel, scale),
            _ => {}
        }
        // A string's body: three wooden resonances under the string.
        for (b, (f, q)) in self.body.iter_mut().zip([(110.0, 0.08), (230.0, 0.06), (480.0, 0.05)]) {
            b.set(f, q, self.sr);
            b.gain = 1.0;
            b.clear();
        }
    }

    pub fn release(&mut self) {
        if self.held {
            self.held = false;
            self.rel_t = self.t as f32;
        }
    }

    /// Retune without restarting: glide, drift, vibrato.
    #[inline]
    pub fn set_hz(&mut self, hz: f32) {
        self.hz = hz.clamp(16.0, self.sr * 0.45);
    }

    pub fn set_params(&mut self, p: [f32; 4]) {
        self.p = p;
    }

    /// The period in samples.
    fn period(&self) -> f32 {
        self.sr / self.hz
    }

    // ─── Plucked string ──────────────────────────────────────────────────────
    /// The string's shape at the moment of the pluck: a triangle peaked at the
    /// pick position, its corner rounded by how soft the pick is.
    fn pluck(&mut self, vel: f32) {
        let n = self.period().round().max(2.0) as usize;
        let pos = (0.04 + self.p[0] * 0.46).min(0.5);
        let soft = 1.0 - self.p[3];
        let mut lp = OnePole::default();
        lp.b = soft * 0.85;
        for i in 0..n {
            let u = i as f32 / n as f32;
            let tri = if u < pos { u / pos } else { (1.0 - u) / (1.0 - pos) };
            let x = lp.tick(tri - 0.5 + self.noise.next() * 0.15 * self.p[3]);
            self.d1.write(x * vel);
        }
    }

    #[inline]
    fn tick_pluck(&mut self) -> f32 {
        // Damping sets how long it rings (12 s to 0.4 s), and how fast its top
        // dies; the hand stops it on release.
        let damp = self.p[1];
        let t60 = if self.held { 12.0 * (1.0 - damp).powf(2.0) + 0.4 } else { 0.12 };
        self.lp.b = 0.05 + damp * 0.55;
        self.ap.a = -(self.p[2] * 0.7);
        let w = 2.0 * PI / self.period();
        let d = self.period() - onepole_delay(self.lp.b, w) - allpass_delay(self.ap.a, w) - 1.0;
        let g = 10f32.powf(-3.0 / (t60 * self.hz));
        let y = self.d1.read(d.max(1.0));
        let v = self.ap.tick(self.lp.tick(y)) * g;
        self.d1.write(v);
        // The body adds its warmth under the string.
        let b = self.body.iter_mut().map(|m| m.tick(y * 0.02)).sum::<f32>();
        y + b * 0.6
    }

    // ─── Bowed string (after STK's Bowed: two waveguide halves and a bow) ────
    #[inline]
    fn tick_bow(&mut self) -> f32 {
        let pos = 0.05 + self.p[2] * 0.4;
        let base = (self.period() - 2.5).max(4.0);
        let bow_v = if self.held { (0.03 + self.p[1] * 0.25) * (self.t as f32 / (0.08 * self.sr)).min(1.0) } else { 0.0 };
        self.lp.b = 0.35;
        let bridge = -self.lp.tick(self.d2.read(base * pos)) * 0.95;
        let nut = -self.d1.read(base * (1.0 - pos));
        let string_v = bridge + nut;
        let dv = bow_v + self.noise.next() * self.p[3] * 0.02 * bow_v.min(0.1) * 10.0 - string_v;
        // Friction: the bow sticks while the string moves with it, and slips.
        let slope = 5.0 - 4.0 * self.p[0];
        let f = ((dv * slope + 0.001).abs() + 0.75).powf(-4.0).clamp(0.01, 0.98);
        let nv = dv * f;
        self.d1.write(bridge + nv);
        self.d2.write(nut + nv);
        let out = self.d2.read(1.0);
        let b = self.body.iter_mut().map(|m| m.tick(out * 0.05)).sum::<f32>();
        out * 2.0 + b
    }

    // ─── The modal models: bar, bell, glass, membrane ───────────────────────
    fn modal_setup(&mut self, vel: f32, scale: &[f32]) {
        let p = self.p;
        let (ratios, count, t60, decay_slope, hard, strike): ([f32; 10], usize, f32, f32, f32, f32) = match self.kind {
            // Wood (tuned like a marimba's bar, 1 : 4 : 10) to metal (a free bar's own).
            2 => {
                let wood = [1.0, 3.99, 9.9, 17.6, 27.0, 37.9];
                let metal = [1.0, 2.756, 5.404, 8.933, 13.34, 18.64];
                let m = p[0];
                ({ let mut ratios = [0.0; 10];
                    for (k, (a, b)) in wood.iter().zip(metal).enumerate() { ratios[k] = a + (b - a) * m; }
                    ratios }, 6, 0.4 + p[3] * 4.0 * (0.4 + m), 1.6 - m * 1.2, p[1], p[2])
            }
            // Hum, prime, tierce (minor to major), quint, nominal, and above.
            3 => ([0.5, 1.0, 1.183 + p[1] * 0.077, 1.506, 2.0, 2.514, 2.662, 3.011, 4.166, 5.433], 10, 1.5 + p[3] * 9.0 * (0.5 + p[0]), 0.35, 0.7, p[2]),
            // A wine glass; Fill pulls the upper modes in, as water does.
            4 => {
                let f = 1.0 - p[1] * 0.12;
                ([1.0, 2.32 * f, 4.25 * f, 6.63 * f, 9.38 * f, 0.0, 0.0, 0.0, 0.0, 0.0], 5, 1.0 + p[2] * 9.0, 0.5, 0.3 + p[3] * 0.6, 0.3)
            }
            // A drumhead's Bessel ratios; struck in the centre only the round modes sound.
            _ => {
                let all = [1.0, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501, 3.600, 3.652];
                (all, 10, 0.15 + (1.0 - p[1]) * 1.6 * (0.5 + p[3]), 0.6, 0.6, p[2])
            }
        };
        self.n_modes = count.min(MODES);
        for k in 0..self.n_modes {
            let mut q = ratios[k];
            // Fit: each mode moved toward the nearest interval the scale has.
            if self.fit > 0.0 && k > 0 && !scale.is_empty() {
                let c = 1200.0 * q.log2();
                let mut near = c;
                let mut best = f32::MAX;
                for o in 0..8 {
                    for s in scale {
                        let cand = o as f32 * 1200.0 + s;
                        if (cand - c).abs() < best {
                            best = (cand - c).abs();
                            near = cand;
                        }
                    }
                }
                q = 2f32.powf((c + (near - c) * self.fit) / 1200.0);
            }
            self.ratios[k] = q;
            // Where it is struck: a node of a mode does not move it.
            let shape = match self.kind {
                5 if strike < 0.08 && !matches!(k, 0 | 3 | 8) => 0.05,
                _ => ((k as f32 + 1.0) * PI * (0.1 + strike * 0.4)).sin().abs() * 0.8 + 0.2,
            };
            // A hard mallet reaches the high modes; a soft one does not.
            let reach = (-(k as f32) * (1.2 - hard)).exp();
            self.modes[k].gain = vel * shape * reach / (k as f32 + 1.0).sqrt();
        }
        self.retune_modes(t60, decay_slope);
        // The mallet: a short raised-cosine push, 0.3 ms hard to 4 ms soft.
        self.pulse_len = ((0.0003 + (1.0 - hard) * 0.004) * self.sr).max(2.0) as u32;
        self.pulse = self.pulse_len;
        self.view_t60 = t60;
        self.view_slope = decay_slope;
    }

    fn retune_modes(&mut self, t60: f32, slope: f32) {
        for k in 0..self.n_modes {
            let f = self.hz * self.ratios[k];
            let tk = t60 / (1.0 + k as f32 * slope);
            if f < self.sr * 0.45 {
                self.modes[k].set(f, tk, self.sr);
            } else {
                self.modes[k].gain = 0.0;
            }
        }
    }

    #[inline]
    fn tick_modal(&mut self) -> f32 {
        let mut x = 0.0;
        if self.pulse > 0 {
            let u = 1.0 - self.pulse as f32 / self.pulse_len as f32;
            x = (1.0 - (2.0 * PI * u).cos()) * 0.5 / self.pulse_len as f32 * 6.0;
            self.pulse -= 1;
        }
        let glass = self.kind == 4;
        if glass && self.held && self.p[0] < 0.5 {
            // Bowed glass: a finger's friction keeps feeding it while held.
            let amt = (0.5 - self.p[0]) * 2.0;
            let rise = (self.t as f32 / (0.4 * self.sr)).min(1.0);
            x += self.noise.next() * 0.0015 * amt * rise;
        }
        if self.kind == 5 && self.t % 64 == 0 {
            // Tension: the head goes slack as the stroke dies, and the pitch drops a little.
            let drop = 1.0 - (self.p[0] * 0.03) * (1.0 - (-(self.t as f32) / (0.15 * self.sr)).exp());
            let hz = self.hz;
            self.hz = hz * drop;
            let (t, s) = (self.view_t60, self.view_slope);
            self.retune_modes(t, s);
            self.hz = hz;
        }
        let mut y = 0.0;
        for k in 0..self.n_modes {
            y += self.modes[k].tick(x);
        }
        y
    }

    // ─── Blown pipe (after STK's Flute: a jet into a bore) ──────────────────
    #[inline]
    fn tick_pipe(&mut self) -> f32 {
        // A bore tuned to the note (a closed one an octave down, odd
        // harmonics), blown: breath and its turbulence through a jet whose
        // nonlinearity feeds the bore and is fed back by it.
        let closed = self.p[3] > 0.5;
        self.lp.b = 0.25;
        let loop_len = if closed { self.period() * 0.5 } else { self.period() };
        let lp_delay = onepole_delay(self.lp.b, 2.0 * PI / loop_len);
        let d = (loop_len - lp_delay - 1.0).max(1.0);
        let env = if self.held { (self.t as f32 / (0.07 * self.sr)).min(1.0) } else { (1.0 - (self.t as f32 - self.rel_t) / (0.05 * self.sr)).max(0.0) };
        let breath = (0.3 + self.p[0] * 0.7) * env;
        let turb = self.noise.next() * (0.02 + self.p[1] * 0.25) * breath;
        let y = self.lp.tick(self.d1.read(d));
        let y = if closed { -y } else { y };
        // The jet: breath against what the bore sends back, a little later.
        self.d2.write(breath - 0.6 * y);
        let j = self.d2.read((0.5 + self.p[2] * 3.0).max(1.0));
        let jt = (j * (j * j - 1.0)).clamp(-1.0, 1.0);
        // DC off the input, not inside the bore, so the bore's tuning is exact.
        let x = self.dc.tick(turb + 0.6 * jt * breath);
        self.d1.write(y * (0.985 + self.p[0] * 0.012) + x);
        // A full breath at the top of the range can overdrive the bore: kept soft.
        (y * 1.5).tanh() * 0.9
    }

    // ─── Reed (after STK's Clarinet: a reed against a bore) ─────────────────
    #[inline]
    fn tick_reed(&mut self) -> f32 {
        let d = (self.period() * 0.5 - 1.95).max(2.0);
        let env = if self.held { (self.t as f32 / (0.03 * self.sr)).min(1.0) } else { (1.0 - (self.t as f32 - self.rel_t) / (0.04 * self.sr)).max(0.0) };
        let breath = (0.55 + self.p[0] * 0.45) * env + self.noise.next() * self.p[3] * 0.05 * env;
        self.lp.b = 0.5;
        let pd = -0.95 * self.lp.tick(self.d1.read(d)) - breath;
        let slope = -0.44 + 0.26 * self.p[1];
        let reed = (0.7 + slope * pd).clamp(-1.0, 1.0);
        let out = breath + pd * reed;
        self.d1.write(out);
        let y = self.d1.read(1.0);
        // The bell: how much of the top gets out.
        let b = 0.2 + (1.0 - self.p[2]) * 0.7;
        self.ap.a = 0.0;
        self.view_bell = b * self.view_bell + (1.0 - b) * y;
        self.view_bell
    }

    // ─── Voice: a glottis through a vocal tract's formants ──────────────────
    #[inline]
    fn tick_voice(&mut self) -> f32 {
        const V: [[f32; 5]; 5] = [
            [730.0, 1090.0, 2440.0, 3400.0, 4300.0], // ah
            [530.0, 1840.0, 2480.0, 3500.0, 4500.0], // eh
            [270.0, 2290.0, 3010.0, 3600.0, 4600.0], // ee
            [570.0, 840.0, 2410.0, 3300.0, 4200.0],  // oh
            [300.0, 870.0, 2240.0, 3300.0, 4200.0],  // oo
        ];
        let x = self.p[0].clamp(0.0, 1.0) * 4.0;
        let i = (x.floor() as usize).min(3);
        let f = x - i as f32;
        // Size: a longer tract, every formant lower.
        let size = 1.25 - self.p[3] * 0.5;
        let env = if self.held { (self.t as f32 / (0.05 * self.sr)).min(1.0) } else { (1.0 - (self.t as f32 - self.rel_t) / (0.08 * self.sr)).max(0.0) };
        // The glottis: open for part of each cycle (Tension shortens it).
        self.phase += self.hz / self.sr;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
        let open = 0.75 - self.p[1] * 0.4;
        let g = if self.phase < open { (PI * self.phase / open).sin().powi(2) } else { 0.0 };
        let src = (g - open * 0.5) * env + self.noise.next() * self.p[2] * 0.3 * env;
        let mut y = 0.0;
        for k in 0..5 {
            let fk = (V[i][k] + (V[i + 1][k] - V[i][k]) * f) * size;
            let q = 8.0 + k as f32 * 2.0;
            y += self.formants[k].tick(src, fk, q, 1, self.sr) / (k as f32 + 1.0);
        }
        y * 1.5
    }

    // ─── Classic: the analog waves, band-limited ────────────────────────────
    #[inline]
    fn tick_classic(&mut self) -> f32 {
        let dt = self.hz / self.sr;
        self.phase += dt;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
        let t = self.phase;
        let blep = |t: f32| -> f32 {
            if t < dt {
                let x = t / dt;
                x + x - x * x - 1.0
            } else if t > 1.0 - dt {
                let x = (t - 1.0) / dt;
                x * x + x + x + 1.0
            } else {
                0.0
            }
        };
        match (self.p[0] * 3.0).round() as u8 {
            0 => (2.0 * PI * t).sin(),
            1 => 1.0 - 4.0 * (t - 0.5).abs(),
            2 => 2.0 * t - 1.0 - blep(t),
            _ => {
                let sq = if t < 0.5 { 1.0 } else { -1.0 };
                sq + blep(t) - blep((t + 0.5) % 1.0)
            }
        }
    }

    /// One sample.
    #[inline]
    pub fn tick(&mut self) -> f32 {
        let y = match self.kind {
            0 => self.tick_pluck(),
            1 => self.tick_bow(),
            2 | 3 | 4 | 5 => self.tick_modal(),
            6 => self.tick_pipe(),
            7 => self.tick_reed(),
            8 => self.tick_voice(),
            _ => self.tick_classic(),
        };
        self.t = self.t.wrapping_add(1);
        if self.t % 256 == 0 {
            self.fill_view();
        }
        if y.is_finite() {
            y.clamp(-4.0, 4.0)
        } else {
            self.clear_fault();
            0.0
        }
    }

    pub(crate) fn failed(&self) -> bool { self.failed }
    pub(crate) fn acknowledge_fault(&mut self) { self.failed = false; }

    #[cfg(test)]
    pub(crate) fn faulted(&self) -> bool { self.faulted }

    // Keep the allocated delay storage. The synth quarantines this voice at
    // the block boundary; repeated failures do not clear its state again.
    #[cold]
    #[inline(never)]
    pub(crate) fn clear_fault(&mut self) {
        if self.faulted { return; }
        self.faulted = true;
        self.failed = true;
        self.d1.clear();
        self.d2.clear();
        self.lp.clear();
        self.ap = AllPass1::default();
        self.dc = DcBlock::default();
        self.body = Default::default();
        self.modes = Default::default();
        self.formants = Default::default();
        self.phase = 0.0;
        self.view = [0.0; 32];
        self.held = false;
    }

    /// What the page draws: the string's shape along it, each mode's level,
    /// the air in the bore, or the wave.
    fn fill_view(&mut self) {
        match self.kind {
            0 | 1 | 6 | 7 => {
                let len = match self.kind {
                    7 => self.period() * 0.5,
                    _ => self.period(),
                };
                for i in 0..32 {
                    self.view[i] = self.d1.read(1.0 + len * i as f32 / 32.0);
                }
            }
            2 | 3 | 4 | 5 => {
                for i in 0..32 {
                    self.view[i] = if i < self.n_modes { self.modes[i].level() } else if i >= 16 && i - 16 < self.n_modes { self.ratios[i - 16] } else { 0.0 };
                }
            }
            _ => {
                for i in 0..32 {
                    self.view[i] = 0.0;
                }
                self.view[0] = self.phase;
            }
        }
    }
}

#[cfg(test)]
mod state_tests {
    use super::*;

    #[test]
    fn model_switches_match_clearing_both_delay_lines() {
        let mut selected = Osc::new(48_000.0, 17);
        let mut both = Osc::new(48_000.0, 17);
        for previous in 0..MODELS.len() {
            for next in 0..MODELS.len() {
                for kind in [previous, next] {
                    both.d1.clear();
                    both.d2.clear();
                    for osc in [&mut selected, &mut both] {
                        osc.start(kind, 220.0, 0.8, MODELS[kind].3, &[0.0, 300.0, 700.0]);
                    }
                    for sample in 0..512 {
                        assert_eq!(selected.tick().to_bits(), both.tick().to_bits(), "{previous}->{next}, {kind}, {sample}");
                    }
                    assert_eq!(selected.view.map(f32::to_bits), both.view.map(f32::to_bits));
                }
            }
        }
    }

    #[test]
    fn bad_oscillator_state_clears_once_and_restart_recovers() {
        let mut osc = Osc::new(48_000.0, 17);
        osc.start(9, 220.0, 0.8, MODELS[9].3, &[]);
        osc.phase = f32::NAN;
        assert_eq!(osc.tick(), 0.0);
        assert!(osc.faulted());
        osc.view[0] = 0.25;
        for _ in 0..512 { osc.clear_fault(); }
        assert_eq!(osc.view[0], 0.25);
        osc.start(9, 220.0, 0.8, MODELS[9].3, &[]);
        assert!(!osc.faulted());
        assert!(osc.tick().is_finite());
    }
}
