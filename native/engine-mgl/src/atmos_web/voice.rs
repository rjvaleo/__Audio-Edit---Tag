//! `atmosPlay` (`ui/sequencer/atmos.js`): one note of Atmosphere's browser
//! voice, built node for node as the page builds it, on the Chromium graph of
//! `dsp_core::chromium`.
//!
//! The page computes in JavaScript doubles and hands Web Audio 32-bit floats;
//! so does this. Its `Math.random` is the generator the owner supplies.

use dsp_core::chromium::graph::{params::*, FilterType, Graph, NodeId, WaveId};

use super::patch::{at_exp, Kind, Patch};
use super::{Rng, MAX_VOICE_NODES};

const SINE: WaveId = WaveId(0);
const SQUARE: WaveId = WaveId(1);
const SAWTOOTH: WaveId = WaveId(2);
const TRIANGLE: WaveId = WaveId(3);

/// `AT_LEVEL`.
const LEVEL_GLASS: f64 = 1000.0;
const LEVEL_BREATH: f64 = 100.0;
const LEVEL_CHOIR: f64 = 15.0;
const LEVEL_SPECTRUM: f64 = 2.2;
const LEVEL_CLOUD: f64 = 2.0;

/// `AT_VOWELS`.
const VOWELS: [[f64; 3]; 5] = [[730.0, 1090.0, 2440.0], [530.0, 1840.0, 2480.0], [270.0, 2290.0, 3010.0], [570.0, 840.0, 2410.0], [300.0, 870.0, 2240.0]];

/// The buses every voice listens to, in the page's order.
#[derive(Clone, Copy, Debug)]
pub struct Buses {
    pub detune: NodeId,
    pub pan: NodeId,
    pub air: NodeId,
    pub blend: NodeId,
    pub vowel: NodeId,
    pub fit: NodeId,
    pub cutoff: NodeId,
}

/// One note: what `atmosPlay` keeps of it.
pub struct Voice {
    pub start: f64,
    pub end: f64,
    pub env: NodeId,
    /// Its sources, to stop.
    pub srcs: Vec<NodeId>,
    /// Bus to node-parameter links, undone at clean-up.
    pub links: Vec<(NodeId, NodeId, u8)>,
    /// Every node it made, to free once it is silent for good.
    pub nodes: Vec<NodeId>,
    pub cleaned: bool,
    pub used: bool,
}

impl Voice {
    pub fn new() -> Self {
        Voice {
            start: 0.0,
            end: 0.0,
            env: NodeId(0),
            srcs: Vec::with_capacity(MAX_VOICE_NODES),
            links: Vec::with_capacity(MAX_VOICE_NODES),
            nodes: Vec::with_capacity(MAX_VOICE_NODES),
            cleaned: false,
            used: false,
        }
    }
}

/// What a caller adds to a note (`o` in `atmosPlay`).
#[derive(Clone, Copy, Debug, Default)]
pub struct Options {
    pub gain: Option<f64>,
    pub atk: Option<f64>,
    pub rel: Option<f64>,
}

/// A periodic wave, or one of the built-in types.
#[derive(Clone, Copy)]
enum Shape {
    Wave(WaveId),
}

/// The note being built (`ctx` in atmos.js).
struct Ctx {
    time: f64,
    end: f64,
    dur: f64,
    dg: NodeId,
    glide: f64,
    from: f64,
}

/// The cloud's two waves for a number of partials, once made.
pub trait CloudWaves {
    fn cloud(&mut self, g: &mut Graph, n: usize, rng: &mut dyn Rng) -> Option<(WaveId, WaveId)>;
}

/// Builds one note into `v`. `None` if the graph ran out of nodes.
pub struct Builder<'a> {
    pub g: &'a mut Graph,
    pub at: &'a Patch,
    pub buses: Buses,
    pub noise: dsp_core::chromium::graph::BufferId,
    pub rng: &'a mut dyn Rng,
    pub clouds: &'a mut dyn CloudWaves,
    pub v: &'a mut Voice,
}

impl<'a> Builder<'a> {
    fn node(&mut self, n: Option<NodeId>) -> Option<NodeId> {
        let n = n?;
        self.v.nodes.push(n);
        Some(n)
    }
    fn gain(&mut self, value: Option<f64>) -> Option<NodeId> {
        let n = self.g.gain();
        let n = self.node(n)?;
        if let Some(v) = value {
            self.g.set(n, GAIN, v as f32);
        }
        Some(n)
    }
    fn link(&mut self, bus: NodeId, dest: NodeId, param: u8) {
        self.g.connect_param(bus, dest, param);
        self.v.links.push((bus, dest, param));
    }
    fn start(&mut self, src: NodeId, t: f64, end: f64) {
        self.g.start(src, t);
        self.g.stop(src, end);
        self.v.srcs.push(src);
    }

    /// `atmosPlay` from "const v = …" on: the note, into `into`.
    pub fn play(&mut self, freq: f64, time: f64, dur: f64, o: Options, into: NodeId, prev_freq: &mut f64, glide_allowed: bool) -> Option<()> {
        let at = self.at;
        let a = o.atk.unwrap_or(at_exp(at.atk, 1.0, 10000.0) / 1000.0);
        let d = at_exp(at.dec, 1.0, 10000.0) / 1000.0;
        let s = at.sus / 100.0;
        let r = o.rel.unwrap_or(at_exp(at.rel, 10.0, 20000.0) / 1000.0);
        let peak = 0.32 * (at.vol / 100.0) * o.gain.unwrap_or(1.0);
        let env = self.gain(None)?;
        self.v.env = env;
        self.g.set_value_at_time(env, GAIN, 0.0, time);
        self.g.set_target_at_time(env, GAIN, peak as f32, time, (a / 3.0).max(0.001));
        self.g.set_target_at_time(env, GAIN, (peak * s) as f32, time + a, (d / 3.0).max(0.001));
        self.g.cancel_and_hold_at_time(env, GAIN, time + dur);
        self.g.set_target_at_time(env, GAIN, 0.0, time + dur, (r / 5.0).max(0.004));
        self.v.end = time + dur + r * 1.25 + 0.05;
        let out = self.voice_filter(env, freq, time, dur)?;
        self.g.connect(out, into);
        // Blend: equal power, and the bus an LFO could sweep it with.
        let b = at.blend / 100.0;
        let ga = self.gain(None)?;
        let gb = self.gain(None)?;
        let inv = self.gain(None)?;
        self.g.set(ga, GAIN, (b * core::f64::consts::PI / 2.0).cos() as f32);
        self.g.set(gb, GAIN, (b * core::f64::consts::PI / 2.0).sin() as f32);
        self.g.set(inv, GAIN, -0.7);
        self.link(self.buses.blend, inv, GAIN);
        self.g.connect_param(inv, ga, GAIN);
        let fwd = self.gain(Some(0.7))?;
        self.link(self.buses.blend, fwd, GAIN);
        self.g.connect_param(fwd, gb, GAIN);
        self.g.connect(ga, env);
        self.g.connect(gb, env);
        // Drift: one slow wander every oscillator shares.
        let drift = at.drift / 100.0;
        let dl = self.g.oscillator(SINE);
        let dl = self.node(dl)?;
        let rate = 0.06 + self.rng.next() * 0.2;
        self.g.set(dl, FREQUENCY, rate as f32);
        let dg = self.gain(Some(drift * 12.0))?;
        self.g.connect(dl, dg);
        let end = self.v.end;
        self.start(dl, time, end);
        // Glide, from where the last note was.
        let glide = if !glide_allowed || at.glide <= 0.0 { 0.0 } else { at_exp(at.glide, 5.0, 2000.0) / 1000.0 };
        let from = if glide > 0.0 && *prev_freq > 0.0 { *prev_freq / freq } else { 1.0 };
        if glide_allowed {
            *prev_freq = freq;
        }
        let ctx = Ctx { time, end, dur, dg, glide, from };
        for (w, dest) in [(0usize, ga), (1usize, gb)] {
            let osc = &at.osc[w];
            let p = (osc.p1 / 100.0, osc.p2 / 100.0, osc.p3 / 100.0);
            let f = freq * 2f64.powf(osc.oct);
            match osc.kind {
                Kind::Classic => self.classic(f, dest, p, &ctx)?,
                Kind::Supersaw => self.supersaw(f, dest, p, &ctx)?,
                Kind::Spectrum => self.spectrum(f, dest, p, &ctx)?,
                Kind::Choir => self.choir(f, dest, p, &ctx)?,
                Kind::Glass => self.glass(f, dest, p, &ctx)?,
                Kind::Breath => self.breath(f, dest, p, &ctx)?,
                Kind::Cloud => self.cloud(f, dest, p, &ctx)?,
                Kind::Endless => self.endless(f, dest, p, &ctx)?,
            }
        }
        // Sub: a sine an octave down.
        if at.sub > 0.0 {
            let g = self.gain(Some((at.sub / 100.0) * 0.45))?;
            self.osc(&ctx, freq / 2.0, Shape::Wave(SINE), g, 0.0, 0.0, false)?;
            self.g.connect(g, env);
        }
        // Air: noise above 3 kHz.
        if at.air > 0.0 {
            let n = self.noise_src(time, end)?;
            let hp = self.g.biquad(FilterType::Highpass);
            let hp = self.node(hp)?;
            self.g.set(hp, FREQUENCY, 3000.0);
            let g = self.gain(Some((at.air / 100.0) * 0.18))?;
            self.link(self.buses.air, g, GAIN);
            self.g.connect(n, hp);
            self.g.connect(hp, g);
            self.g.connect(g, env);
        }
        Some(())
    }

    /// `atVoiceFilter`: the voice's own filter, or none when open and still.
    fn voice_filter(&mut self, env: NodeId, freq: f64, time: f64, dur: f64) -> Option<NodeId> {
        let at = self.at;
        let cut = at_exp(at.flt_cut, 30.0, 20000.0);
        let amt = at.flt_amt / 100.0;
        let ty = at.flt_type.round() as i32;
        if ty == 0 && at.flt_cut >= 100.0 && amt == 0.0 {
            return Some(env);
        }
        let kind = match ty {
            1 => FilterType::Bandpass,
            2 => FilterType::Highpass,
            _ => FilterType::Lowpass,
        };
        let f = self.g.biquad(kind);
        let f = self.node(f)?;
        self.link(self.buses.cutoff, f, DETUNE_FILTER);
        self.g.set(f, Q, (0.5 + (at.flt_res / 100.0) * 14.5) as f32);
        let key = 2f64.powf(((at.flt_key / 100.0) * (69.0 + 12.0 * (freq / 440.0).log2() - 60.0)) / 12.0);
        let base = (cut * key).max(20.0).min(20000.0);
        let to = |x: f64| (base * 2f64.powf(4.0 * amt * x)).max(20.0).min(20000.0);
        let a = at_exp(at.flt_atk, 1.0, 10000.0) / 1000.0;
        let d = at_exp(at.flt_dec, 1.0, 10000.0) / 1000.0;
        let s = at.flt_sus / 100.0;
        let r = at_exp(at.flt_rel, 10.0, 20000.0) / 1000.0;
        self.g.set_value_at_time(f, FREQUENCY, base as f32, time);
        if amt != 0.0 {
            self.g.set_target_at_time(f, FREQUENCY, to(1.0) as f32, time, (a / 3.0).max(0.001));
            self.g.set_target_at_time(f, FREQUENCY, to(s) as f32, time + a, (d / 3.0).max(0.001));
            self.g.cancel_and_hold_at_time(f, FREQUENCY, time + dur);
            self.g.set_target_at_time(f, FREQUENCY, base as f32, time + dur, (r / 5.0).max(0.004));
        }
        self.g.connect(env, f);
        Some(f)
    }

    /// `atOsc`: one oscillator, `cents` off, panned to `pan`.
    fn osc(&mut self, ctx: &Ctx, f: f64, shape: Shape, dest: NodeId, cents: f64, pan: f64, bus: bool) -> Option<NodeId> {
        let Shape::Wave(w) = shape;
        let o = self.g.oscillator(w);
        let o = self.node(o)?;
        self.g.set(o, DETUNE_OSC, cents as f32);
        if ctx.glide > 0.0 && ctx.from != 1.0 {
            self.g.set_value_at_time(o, FREQUENCY, (f * ctx.from) as f32, ctx.time);
            self.g.exponential_ramp_to_value_at_time(o, FREQUENCY, f as f32, ctx.time + ctx.glide);
        } else {
            self.g.set(o, FREQUENCY, f as f32);
        }
        self.g.connect_param(ctx.dg, o, DETUNE_OSC);
        if bus {
            self.link(self.buses.detune, o, DETUNE_OSC);
        }
        let mut out = o;
        if pan != 0.0 && !pan.is_nan() {
            let p = self.g.panner();
            let p = self.node(p)?;
            self.g.set(p, PAN, pan.clamp(-1.0, 1.0) as f32);
            if bus {
                self.link(self.buses.pan, p, PAN);
            }
            self.g.connect(o, p);
            out = p;
        }
        self.g.connect(out, dest);
        self.start(o, ctx.time, ctx.end);
        Some(o)
    }

    /// `atNoiseSrc`.
    fn noise_src(&mut self, t: f64, end: f64) -> Option<NodeId> {
        let s = self.g.buffer_source(self.noise);
        let s = self.node(s)?;
        let loop_start = self.rng.next() * 1.5;
        self.g.set_loop(s, true, loop_start, 0.0);
        self.start(s, t, end);
        Some(s)
    }

    /// `atUnison`.
    fn unison(&mut self, ctx: &Ctx, f: f64, wave: WaveId, dest: NodeId, n: usize, spread_mul: f64) -> Option<()> {
        let at = self.at;
        let g = self.gain(Some(1.0 / (n as f64).sqrt()))?;
        self.g.connect(g, dest);
        let det = at.detune * spread_mul;
        let width = at.width / 100.0;
        for i in 0..n {
            let x = if n == 1 { 0.0 } else { (i as f64 / (n - 1) as f64) * 2.0 - 1.0 };
            let jitter = (self.rng.next() - 0.5) * at.drift * 0.08;
            self.osc(ctx, f, Shape::Wave(wave), g, x * det + jitter, x * width, true)?;
        }
        Some(())
    }

    fn classic(&mut self, f: f64, dest: NodeId, p: (f64, f64, f64), ctx: &Ctx) -> Option<()> {
        let wave = [SINE, TRIANGLE, SAWTOOTH, SQUARE][js_round(p.0 * 3.0).clamp(0.0, 3.0) as usize];
        let n = js_round(self.at.unison) as usize;
        self.unison(ctx, f, wave, dest, n.max(1), 1.0)
    }

    fn supersaw(&mut self, f: f64, dest: NodeId, p: (f64, f64, f64), ctx: &Ctx) -> Option<()> {
        let n = (js_round(self.at.unison) as usize).max(5);
        self.unison(ctx, f, SAWTOOTH, dest, n, 0.5 + p.0 * 1.5)
    }

    fn spectrum(&mut self, f: f64, dest: NodeId, p: (f64, f64, f64), ctx: &Ctx) -> Option<()> {
        let at = self.at;
        let cents = at.scale();
        let n = 4 + js_round(p.2 * 20.0) as usize;
        let e = 2.2 - p.1 * 1.8;
        let width = at.width / 100.0;
        let g = self.gain(None)?;
        let mut sum = 0.0;
        let mut parts = [(0usize, 0.0f64, 0.0f64, 0.0f64); 32];
        for k in 1..=n {
            let h = 1200.0 * (k as f64).log2();
            let mut near = h;
            let mut best = f64::INFINITY;
            for o in 0..=6 {
                for ct in cents {
                    let s = o as f64 * 1200.0 + ct;
                    let dd = (s - h).abs();
                    if dd < best {
                        best = dd;
                        near = s;
                    }
                }
            }
            let amp = 1.0 / (k as f64).powf(e);
            sum += amp;
            parts[k - 1] = (k, h, near, amp);
        }
        self.g.set(g, GAIN, (LEVEL_SPECTRUM / sum) as f32);
        self.g.connect(g, dest);
        for &(k, h, near, amp) in &parts[..n] {
            let pg = self.gain(Some(amp))?;
            self.g.connect(pg, g);
            let pan = if k == 1 { 0.0 } else { (if k % 2 == 1 { 1.0 } else { -1.0 }) * width * 0.6 };
            let o = self.osc(ctx, f * k as f64, Shape::Wave(SINE), pg, (near - h) * p.0, pan, true)?;
            if k > 1 && near != h {
                let fg = self.gain(Some(near - h))?;
                self.link(self.buses.fit, fg, GAIN);
                self.g.connect_param(fg, o, DETUNE_OSC);
            }
        }
        Some(())
    }

    fn choir(&mut self, f: f64, dest: NodeId, p: (f64, f64, f64), ctx: &Ctx) -> Option<()> {
        let at = self.at;
        let voices = 1 + js_round(p.1 * 7.0) as usize;
        let mix = self.gain(Some(1.0 / (voices as f64).sqrt()))?;
        let vib = self.g.oscillator(SINE);
        let vib = self.node(vib)?;
        let rate = 4.8 + self.rng.next() * 0.8;
        self.g.set(vib, FREQUENCY, rate as f32);
        let vg = self.gain(Some(9.0))?;
        self.g.connect(vib, vg);
        self.start(vib, ctx.time, ctx.end);
        let width = at.width / 100.0;
        for i in 0..voices {
            let x = if voices == 1 { 0.0 } else { (i as f64 / (voices - 1) as f64) * 2.0 - 1.0 };
            let o = self.osc(ctx, f, Shape::Wave(SAWTOOTH), mix, x * (at.detune * 0.6 + 6.0), x * width, true)?;
            self.g.connect_param(vg, o, DETUNE_OSC);
        }
        let fm = vowel(p.0);
        let amps = [1.0, 0.55, 0.3];
        let qs = [9.0, 12.0, 14.0];
        let out = self.gain(Some(LEVEL_CHOIR))?;
        self.g.connect(out, dest);
        let mut breath = None;
        if p.2 > 0.0 {
            let b = self.gain(Some(p.2 * 0.5))?;
            let n = self.noise_src(ctx.time, ctx.end)?;
            self.g.connect(n, b);
            breath = Some(b);
        }
        for (i, hz) in fm.iter().enumerate() {
            let bp = self.g.biquad(FilterType::Bandpass);
            let bp = self.node(bp)?;
            let g = self.gain(None)?;
            let vb = self.gain(None)?;
            self.g.set(bp, FREQUENCY, *hz as f32);
            self.g.set(bp, Q, qs[i] as f32);
            self.g.set(vb, GAIN, [200.0, 600.0, 400.0][i]);
            self.link(self.buses.vowel, vb, GAIN);
            self.g.connect_param(vb, bp, FREQUENCY);
            self.g.set(g, GAIN, amps[i] as f32);
            self.g.connect(mix, bp);
            if let Some(b) = breath {
                self.g.connect(b, bp);
            }
            self.g.connect(bp, g);
            self.g.connect(g, out);
        }
        Some(())
    }

    fn glass(&mut self, f: f64, dest: NodeId, p: (f64, f64, f64), ctx: &Ctx) -> Option<()> {
        const STR: [f64; 6] = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
        const BELL: [f64; 6] = [1.0, 2.756, 5.404, 8.933, 13.34, 18.64];
        let tau = 0.3 + p.1 * 6.0;
        let strike = p.2;
        let ex = self.gain(None)?;
        let out = self.gain(None)?;
        self.g.set(ex, GAIN, 1.0);
        self.g.set(out, GAIN, 1.0);
        self.g.connect(out, dest);
        let n = self.noise_src(ctx.time, ctx.end)?;
        let burst = self.gain(None)?;
        let bow = self.gain(None)?;
        let lp = self.g.biquad(FilterType::Lowpass);
        let lp = self.node(lp)?;
        self.g.set_value_at_time(burst, GAIN, (strike * 1.2) as f32, ctx.time);
        self.g.set_target_at_time(burst, GAIN, 0.0, ctx.time + 0.002, 0.004);
        self.g.set(bow, GAIN, ((1.0 - strike) * 0.12) as f32);
        self.g.set(lp, FREQUENCY, (f * 6.0).min(18000.0) as f32);
        self.g.connect(n, burst);
        self.g.connect(burst, ex);
        self.g.connect(n, lp);
        self.g.connect(lp, bow);
        self.g.connect(bow, ex);
        for k in 0..6 {
            let ratio = STR[k] + (BELL[k] - STR[k]) * p.0;
            let fk = f * ratio;
            if fk > 18000.0 {
                continue;
            }
            let tk = tau / ((k + 1) as f64).sqrt();
            let q = (core::f64::consts::PI * fk * tk).min(4000.0).max(2.0);
            let bp = self.g.biquad(FilterType::Bandpass);
            let bp = self.node(bp)?;
            let g = self.gain(None)?;
            self.g.set(bp, FREQUENCY, fk as f32);
            self.g.set(bp, Q, q as f32);
            self.g.set(g, GAIN, (LEVEL_GLASS * (q / fk).sqrt() / ((k + 1) as f64).powf(0.7)) as f32);
            self.g.connect(ex, bp);
            self.g.connect(bp, g);
            self.g.connect(g, out);
        }
        Some(())
    }

    fn breath(&mut self, f: f64, dest: NodeId, p: (f64, f64, f64), ctx: &Ctx) -> Option<()> {
        let q = 4.0 + p.0 * 70.0;
        let n = self.noise_src(ctx.time, ctx.end)?;
        for (mul, lvl) in [(1.0, 1.0), (2.0, 0.35 + p.1 * 0.5)] {
            let bp = self.g.biquad(FilterType::Bandpass);
            let bp = self.node(bp)?;
            let g = self.gain(None)?;
            self.g.set(bp, FREQUENCY, (f * mul) as f32);
            self.g.set(bp, Q, (q * if mul == 1.0 { 1.0 } else { 0.6 + (1.0 - p.1) * 0.4 }) as f32);
            self.g.set(g, GAIN, (LEVEL_BREATH * (q / (f * mul)).sqrt() * lvl) as f32);
            self.g.connect(n, bp);
            self.g.connect(bp, g);
            self.g.connect(g, dest);
        }
        Some(())
    }

    fn cloud(&mut self, f: f64, dest: NodeId, p: (f64, f64, f64), ctx: &Ctx) -> Option<()> {
        let at = self.at;
        let n = 8 + js_round(p.2 * 56.0) as usize;
        let (w0, w1) = self.clouds.cloud(self.g, n, self.rng)?;
        let g1 = self.gain(None)?;
        let g2 = self.gain(None)?;
        let lfo = self.g.oscillator(SINE);
        let lfo = self.node(lfo)?;
        let lg = self.gain(None)?;
        let inv = self.gain(None)?;
        self.g.set(lfo, FREQUENCY, (0.03 + p.1 * 0.6) as f32);
        self.g.set(lg, GAIN, 0.5);
        self.g.set(inv, GAIN, -0.5);
        self.g.connect(lfo, lg);
        self.g.connect(lfo, inv);
        self.g.set(g1, GAIN, 0.5);
        self.g.set(g2, GAIN, 0.5);
        self.g.connect_param(lg, g1, GAIN);
        self.g.connect_param(inv, g2, GAIN);
        self.start(lfo, ctx.time, ctx.end);
        let smear = p.0 * 15.0;
        let width = at.width / 100.0;
        self.osc(ctx, f, Shape::Wave(w0), g1, -smear, -width * 0.7, true)?;
        self.osc(ctx, f, Shape::Wave(w1), g2, smear, width * 0.7, true)?;
        let out = self.gain(Some(LEVEL_CLOUD))?;
        self.g.connect(g1, out);
        self.g.connect(g2, out);
        self.g.connect(out, dest);
        Some(())
    }

    fn endless(&mut self, f: f64, dest: NodeId, p: (f64, f64, f64), ctx: &Ctx) -> Option<()> {
        let at = self.at;
        let rise = (p.0 - 0.5) * 2.0;
        let sigma = 0.8 + p.1 * 1.5;
        let out = self.gain(Some(0.55))?;
        self.g.connect(out, dest);
        for k in 0..6i32 {
            let fk = f * 2f64.powf((k - 2) as f64);
            let g = self.gain(None)?;
            if fk < 20.0 || fk > 16000.0 {
                continue;
            }
            self.g.set(g, GAIN, (-((k - 2) as f64).powi(2) / (2.0 * sigma * sigma)).exp() as f32);
            self.g.connect(g, out);
            let pan = (if k % 2 == 1 { 1.0 } else { -1.0 }) * (at.width / 100.0) * 0.5;
            let o = self.osc(ctx, fk, Shape::Wave(SINE), g, 0.0, pan, true)?;
            if rise != 0.0 {
                self.g.cancel_scheduled_values(o, FREQUENCY, ctx.time);
                self.g.set_value_at_time(o, FREQUENCY, fk as f32, ctx.time);
                self.g.exponential_ramp_to_value_at_time(o, FREQUENCY, (fk * 2f64.powf(rise)) as f32, ctx.time + ctx.dur.max(0.05));
            }
        }
        Some(())
    }
}

/// `atVowel`: the three formants, between the five vowels.
fn vowel(u: f64) -> [f64; 3] {
    let x = u.clamp(0.0, 1.0) * 4.0;
    let i = (x.floor() as usize).min(3);
    let f = x - i as f64;
    let mut out = [0.0; 3];
    for k in 0..3 {
        out[k] = VOWELS[i][k] + (VOWELS[i + 1][k] - VOWELS[i][k]) * f;
    }
    out
}

/// JavaScript's `Math.round`: halves toward +∞.
pub fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}
