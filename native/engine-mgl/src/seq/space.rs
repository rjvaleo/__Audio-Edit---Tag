//! Space, the page's reverb (`atmos.js` `atSpaceBuild`, `atSpaceApply`,
//! `atSpaceIR`), as Seq's sound reaches it: the melody channel's send into
//! its gate, its wet into Seq's Vol.
//!
//! gate → pre-delay → low cut → convolver → damp → limiter → dry and the
//! shimmer (two slow chorus lines) → wet. Freeze closes the gate and lets the
//! tail round a loop of a delay and four allpasses.

use dsp_core::chromium::fdlibm;
use dsp_core::chromium::graph::{params::*, FilterType, Graph, NodeId, WaveId};

/// Space's knobs, by the page's names (0..100 each).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpaceSettings {
    pub wet: f64,
    pub size: f64,
    pub pre: f64,
    pub damp: f64,
    pub shim: f64,
    pub spread: f64,
    pub low_cut: f64,
}

impl Default for SpaceSettings {
    fn default() -> Self {
        SpaceSettings { wet: 0.0, size: 60.0, pre: 15.0, damp: 45.0, shim: 30.0, spread: 80.0, low_cut: 0.0 }
    }
}

/// `AT_FREEZE_FB`.
const FREEZE_FB: f64 = 0.96;

/// `atExp`.
fn at_exp(v: f64, lo: f64, hi: f64) -> f64 {
    lo * fdlibm::pow(hi / lo, v / 100.0)
}

/// `atRevRt60`.
fn rt60(v: f64) -> f64 {
    at_exp(v, 0.4, 15.0)
}

pub struct Space {
    pub gate: NodeId,
    pre: NodeId,
    pub low: NodeId,
    conv: NodeId,
    damp: NodeId,
    pub shim: NodeId,
    dry: NodeId,
    pub wet: NodeId,
    frz_in: NodeId,
    frz_fb: NodeId,
    lfo_out: [NodeId; 2],
    ir_key: Option<(String, String)>,
    pub frozen: bool,
}

/// `atSpaceIR`: noise under an exponential decay, the channels as far apart
/// as Spread says, each scaled to unit energy.
pub fn impulse(rate: f32, rt60: f64, spread: f64) -> [Vec<f32>; 2] {
    let rate_d = rate as f64;
    let len = 1f64.max(js_round(16f64.min(rt60 * 1.15 + 0.1) * rate_d)) as usize;
    let mut l = vec![0.0f32; len];
    let mut r = vec![0.0f32; len];
    let mut seed: f64 = 987654321.0;
    let mut rnd = || {
        // (seed * 1664525 + 1013904223) >>> 0, in doubles.
        let v = seed * 1664525.0 + 1013904223.0;
        seed = (v.rem_euclid(4294967296.0)).floor();
        seed / 2147483648.0 - 1.0
    };
    let k = -6.907755 / (rt60 * rate_d);
    let fade = js_round(0.006 * rate_d);
    for i in 0..len {
        let fi = i as f64;
        let e = fdlibm::exp(k * fi) * if fi < fade { fi / fade } else { 1.0 };
        let a = rnd();
        let b = rnd();
        l[i] = (a * e) as f32;
        r[i] = ((spread * b + (1.0 - spread) * a) * e) as f32;
    }
    for ch in [&mut l, &mut r] {
        let mut sum = 0.0f64;
        for v in ch.iter() {
            sum += *v as f64 * *v as f64;
        }
        let g = 1.0 / (if sum != 0.0 { sum } else { 1.0 }).sqrt();
        for v in ch.iter_mut() {
            *v = (*v as f64 * g) as f32;
        }
    }
    [l, r]
}

/// `Math.round`.
fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// `toFixed(2)`, as the page keys its response by it.
fn fixed2(x: f64) -> String {
    format!("{x:.2}")
}

impl Space {
    /// `atSpaceBuild`. `room` is the message.
    pub fn build(g: &mut Graph, seq_vol: NodeId) -> Self {
        let room = "a fresh graph has room";
        let gate = g.gain().expect(room);
        let pre = g.delay(0.25).expect(room);
        let low = g.biquad(FilterType::Highpass).expect(room);
        g.set(low, FREQUENCY, 10.0);
        let conv = g.convolver().expect(room);
        let damp = g.biquad(FilterType::Lowpass).expect(room);
        let lim = g.compressor().expect(room);
        g.set(lim, THRESHOLD, -6.0);
        g.set(lim, KNEE, 6.0);
        g.set(lim, RATIO, 8.0);
        g.set(lim, ATTACK, 0.003);
        g.set(lim, RELEASE, 0.3);
        let dry = g.gain().expect(room);
        let shim = g.gain().expect(room);
        g.set(shim, GAIN, 0.0);
        let wet = g.gain().expect(room);
        g.set(wet, GAIN, 0.0);
        g.connect(gate, pre);
        g.connect(pre, low);
        g.connect(low, conv);
        g.connect(conv, damp);
        g.connect(damp, lim);
        // The freeze loop.
        let frz_in = g.gain().expect(room);
        g.set(frz_in, GAIN, 0.0);
        let frz_d = g.delay(1.0).expect(room);
        g.set(frz_d, DELAY_TIME, 0.731);
        let frz_lp = g.biquad(FilterType::Lowpass).expect(room);
        g.set(frz_lp, FREQUENCY, 9000.0);
        g.set(frz_lp, Q, -3.01);
        let frz_fb = g.gain().expect(room);
        g.set(frz_fb, GAIN, 0.0);
        g.connect(damp, frz_in);
        g.connect(frz_in, frz_d);
        let mut last = frz_d;
        for hz in [310.0, 870.0, 2150.0, 4900.0] {
            let ap = g.biquad(FilterType::Allpass).expect(room);
            g.set(ap, FREQUENCY, hz);
            g.set(ap, Q, 0.6);
            g.connect(last, ap);
            last = ap;
        }
        g.connect(last, frz_lp);
        g.connect(frz_lp, frz_fb);
        g.connect(frz_fb, frz_d);
        g.connect(frz_lp, lim);
        g.connect(lim, dry);
        g.connect(dry, wet);
        // The shimmer: two chorus lines, each a delay swept by a slow LFO.
        let mut lfo_out = [NodeId(0); 2];
        for (i, (base, rate, pan)) in [(0.019f32, 0.21f32, -0.8f32), (0.027, 0.17, 0.8)].into_iter().enumerate() {
            let d = g.delay(0.1).expect(room);
            let p = g.panner().expect(room);
            // atLfo(rate, 0).
            let o = g.oscillator(WaveId(0)).expect(room);
            let out = g.gain().expect(room);
            g.set(o, FREQUENCY, rate);
            g.set(out, GAIN, 0.0);
            g.connect(o, out);
            g.start(o, 0.0);
            g.set(d, DELAY_TIME, base);
            g.connect_param(out, d, DELAY_TIME);
            g.set(p, PAN, pan);
            g.connect(lim, d);
            g.connect(d, p);
            g.connect(p, shim);
            lfo_out[i] = out;
        }
        g.connect(shim, wet);
        g.connect(wet, seq_vol);
        Space { gate, pre, low, conv, damp, shim, dry, wet, frz_in, frz_fb, lfo_out, ir_key: None, frozen: false }
    }

    /// `atSpaceApply`: every knob glides to its value from now (time
    /// constant 0.03 s); the response is made again when Size or Spread
    /// changed (at once, as offline). Allocates when it makes a response.
    pub fn apply(&mut self, g: &mut Graph, s: &SpaceSettings) {
        let now = g.current_time();
        let mut smooth = |g: &mut Graph, n: NodeId, k: u8, v: f64| g.set_target_at_time(n, k, v as f32, now, 0.03);
        smooth(g, self.wet, GAIN, (s.wet / 100.0) * 1.4);
        smooth(g, self.pre, DELAY_TIME, (s.pre * 1.5) / 1000.0);
        smooth(g, self.low, FREQUENCY, if s.low_cut <= 0.0 { 10.0 } else { at_exp(s.low_cut, 20.0, 1000.0) });
        smooth(g, self.damp, FREQUENCY, at_exp(100.0 - s.damp, 800.0, 18000.0));
        let shim = s.shim / 100.0;
        smooth(g, self.shim, GAIN, shim * 0.8);
        smooth(g, self.dry, GAIN, 1.0 - shim * 0.35);
        for o in self.lfo_out {
            smooth(g, o, GAIN, 0.006 * shim);
        }
        smooth(g, self.gate, GAIN, if self.frozen { 0.0 } else { 1.0 });
        smooth(g, self.frz_in, GAIN, if self.frozen { 0.7 } else { 0.0 });
        smooth(g, self.frz_fb, GAIN, if self.frozen { FREEZE_FB } else { 0.0 });
        let rt = rt60(s.size);
        let sp = s.spread / 100.0;
        let key = (fixed2(rt), fixed2(sp));
        if self.ir_key.as_ref() == Some(&key) {
            return;
        }
        self.ir_key = Some(key);
        let [l, r] = impulse(g.sample_rate(), rt, sp);
        g.set_convolver_buffer(self.conv, &[&l, &r], false);
    }
}
