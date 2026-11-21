//! Atmosphere as the web page plays it: its browser voice (`atmosPlay`, the
//! eight kinds the Band and Draw still play), Character and Sympathy, on a
//! port of Chromium's own Web Audio (`dsp_core::chromium`), so it plays what
//! the page plays, sample for sample.
//!
//! [`AtmosWeb`] is the instrument; [`AtmosWebModule`](crate::AtmosWebModule)
//! wraps it as a module of the native engine.

pub mod module;
pub mod patch;
pub mod voice;

use dsp_core::chromium::graph::{params::*, Buffer, BufferId, FilterType, Graph, NodeId, WaveId};
use dsp_core::chromium::wave::Wave;
use dsp_core::chromium::QUANTUM;

pub use patch::{Kind, Patch, SymTune};
use voice::{Buses, Builder, CloudWaves, Options, Voice};

/// The most nodes one note can make (a scale spectrum on both oscillators
/// with every partial, and the rest).
pub const MAX_VOICE_NODES: usize = 256;
/// `AT_MAX_VOICES`.
pub const MAX_VOICES: usize = 16;

/// `Math.random`, as the owner supplies it.
pub trait Rng {
    fn next(&mut self) -> f64;
}

/// mulberry32, as the reference renders' spec draws it, and as this module
/// draws its own.
#[derive(Clone, Copy, Debug)]
pub struct Mulberry32(pub u32);

impl Rng for Mulberry32 {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / 4294967296.0
    }
}

/// `atNoise`: two seconds of the page's white noise.
pub fn noise(sample_rate: f32) -> Vec<f32> {
    let n = (sample_rate as f64 * 2.0) as usize;
    let mut out = Vec::with_capacity(n);
    let mut seed: f64 = 12345.0;
    for _ in 0..n {
        // (seed * 1103515245 + 12345) & 0x7fffffff, in doubles as JS does.
        let p = seed * 1103515245.0 + 12345.0;
        let bits = (p as u64) & 0x7fff_ffff;
        seed = bits as f64;
        out.push((seed / 0x3fff_ffff as f64 - 1.0) as f32);
    }
    out
}

/// The cloud's random waves (`atCloudWaves`), made once per number of
/// partials and kept: here in a few pairs of waves made when the instrument
/// is, so a note never allocates. When every pair is taken, the one used
/// longest ago is drawn again for the new count (the page keeps every count
/// it has seen; four at once is more than any patch asks for).
pub struct Clouds {
    pairs: [(WaveId, WaveId); CLOUD_PAIRS],
    n: [usize; CLOUD_PAIRS],
    used: [u64; CLOUD_PAIRS],
    tick: u64,
}

const CLOUD_PAIRS: usize = 4;

impl Clouds {
    fn new(g: &mut Graph) -> Self {
        let mut pairs = [(WaveId(0), WaveId(0)); CLOUD_PAIRS];
        for p in pairs.iter_mut() {
            let rate = g.sample_rate();
            *p = (g.add_wave(Wave::lazy(rate, 65, 8)), g.add_wave(Wave::lazy(rate, 65, 8)));
        }
        Clouds { pairs, n: [0; CLOUD_PAIRS], used: [0; CLOUD_PAIRS], tick: 0 }
    }
}

impl CloudWaves for Clouds {
    fn cloud(&mut self, g: &mut Graph, n: usize, rng: &mut dyn Rng) -> Option<(WaveId, WaveId)> {
        let n = n.clamp(1, 64);
        self.tick += 1;
        if let Some(k) = self.n.iter().position(|&m| m == n) {
            self.used[k] = self.tick;
            return Some(self.pairs[k]);
        }
        let k = (0..CLOUD_PAIRS).min_by_key(|&k| self.used[k]).unwrap_or(0);
        for w in [self.pairs[k].0, self.pairs[k].1] {
            let mut re = [0.0f32; 65];
            let mut im = [0.0f32; 65];
            for p in 1..=n {
                let a = (0.6 + rng.next() * 0.4) / (p as f64).powf(0.9);
                let ph = rng.next() * core::f64::consts::PI * 2.0;
                re[p] = (a * ph.cos()) as f32;
                im[p] = (a * ph.sin()) as f32;
            }
            g.set_custom_wave(w, &re[..n + 1], &im[..n + 1]);
        }
        self.n[k] = n;
        self.used[k] = self.tick;
        Some(self.pairs[k])
    }
}

/// One slot of the pool: a note, and its place in the order they came.
struct Slot {
    voice: Voice,
    order: u64,
}

/// Atmosphere's browser voice on its own graph.
pub struct AtmosWeb {
    pub g: Graph,
    pub at: Patch,
    buses: Buses,
    noise: BufferId,
    clouds: Clouds,
    pub rng: Mulberry32,
    slots: Vec<Slot>,
    next_order: u64,
    prev_freq: f64,
    /// Atmosphere's input (`atIn`): Character, then Sympathy beside it.
    pub at_in: NodeId,
    ch: Character,
    /// Where Character and Sympathy meet (`atFxIn`): this instrument's output.
    pub fx_in: NodeId,
    sym_in: NodeId,
    sym_out: NodeId,
    bank: Vec<(NodeId, NodeId)>,
    sym_key: Option<SymKey>,
    /// For the reference renders: a gain straight to the destination (the
    /// spec's "direct"), Atmosphere's output stage and the page's master.
    direct: NodeId,
    out: NodeId,
    /// Audio handed in from outside (the physical voice, in the page), into
    /// `atIn` ahead of every note.
    ext_in: Option<NodeId>,
}

/// `atCharChain`'s nodes.
struct Character {
    shaper: NodeId,
    wow_out: NodeId,
    flut_out: NodeId,
    ens_dry: NodeId,
    ens_wet: NodeId,
    /// The three swept delays' LFOs: (oscillator, its gain, rate multiplier).
    ens: [(NodeId, NodeId, f64); 3],
    post: NodeId,
}

/// What Sympathy was last tuned to (`atSymKey`).
#[derive(Clone, Copy, PartialEq)]
struct SymKey {
    root_hz: f64,
    cents: [f64; 32],
    cents_len: usize,
    tune: SymTune,
    ring: f64,
    mat: f64,
}

/// Where a note goes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Route {
    /// Atmosphere's own chain: Character and Sympathy (`atIn`).
    Page,
    /// Straight out, past everything (the reference renders' "direct").
    Direct,
}

impl AtmosWeb {
    /// Built as `atmosInit` builds it, with `patch` in place, its random
    /// numbers from `seed`.
    pub fn new(sample_rate: f32, patch: Patch, seed: u32) -> Self {
        Self::build(sample_rate, patch, seed, false)
    }

    /// The same, with an audio input into Atmosphere's chain ahead of the
    /// notes, as the page's physical voice is.
    pub fn with_input(sample_rate: f32, patch: Patch, seed: u32) -> Self {
        Self::build(sample_rate, patch, seed, true)
    }

    fn build(sample_rate: f32, patch: Patch, seed: u32, with_input: bool) -> Self {
        let mut g = Graph::new(sample_rate, 8192, 16384);
        let noise = g.add_buffer(Buffer { channels: vec![noise(sample_rate)], sample_rate });
        // The destination, and on it the page's master with Atmosphere's
        // output stage before it (atOut, at AT_OUT_TRIM, then atTrem).
        let out = g.explicit_gain(2).expect("room");
        let master = g.gain().expect("room");
        g.set(master, GAIN, 0.3);
        g.connect(master, out);
        // atmosInit: Character (atCharChain), then the rest.
        let ch = character(&mut g);
        let ext_in = if with_input {
            let i = g.input().expect("room");
            g.connect(i, ch.inp);
            Some(i)
        } else {
            None
        };
        let fx_in = g.gain().expect("room");
        let at_out = g.gain().expect("room");
        g.set(at_out, GAIN, 0.7);
        let trem = g.gain().expect("room");
        g.set(trem, GAIN, 1.0);
        g.connect(at_out, trem);
        g.connect(trem, master);
        g.connect(fx_in, at_out);
        g.connect(ch.chain.post, fx_in);
        let sym_in = g.gain().expect("room");
        let sym_out = g.gain().expect("room");
        g.connect(ch.chain.post, sym_in);
        g.connect(sym_out, fx_in);
        // The buses (made after Character in the page; their order matters
        // to nothing).
        let mut bus = || {
            let s = g.constant().expect("a fresh graph has room");
            g.set(s, OFFSET, 0.0);
            g.start(s, 0.0);
            s
        };
        let buses = Buses { detune: bus(), pan: bus(), air: bus(), blend: bus(), vowel: bus(), fit: bus(), cutoff: bus() };
        let direct = g.gain().expect("room");
        g.connect(direct, out);
        let mut slots = Vec::with_capacity(MAX_VOICES * 2);
        for _ in 0..MAX_VOICES * 2 {
            slots.push(Slot { voice: Voice::new(), order: 0 });
        }
        let clouds = Clouds::new(&mut g);
        let mut a = AtmosWeb {
            g,
            at: patch,
            buses,
            noise,
            clouds,
            rng: Mulberry32(seed),
            slots,
            next_order: 1,
            prev_freq: 0.0,
            at_in: ch.inp,
            ch: ch.chain,
            fx_in,
            sym_in,
            sym_out,
            bank: Vec::with_capacity(24),
            sym_key: None,
            direct,
            out,
            ext_in,
        };
        a.apply_global();
        a
    }

    /// `atmosApplyGlobal`: warmth, wow, ensemble and Sympathy's level, gliding
    /// to their values from now (and Sympathy retuned at the next note).
    pub fn apply_global(&mut self) {
        let now = self.g.current_time();
        let at = &self.at;
        let warm = at.warm / 100.0;
        let k = 1.0 + warm * 5.0;
        let mut curve = [0.0f32; 1024];
        for (i, c) in curve.iter_mut().enumerate() {
            let x = (i as f64 / 1023.0) * 2.0 - 1.0;
            *c = if warm <= 0.001 { x as f32 } else { ((k * x).tanh() / k.tanh()) as f32 };
        }
        let wow = at.wow / 100.0;
        let ens = at.ens / 100.0;
        let rate = patch::at_exp(at.ens_rate, 0.05, 2.0);
        let sym = (at.sym / 100.0) * 0.9;
        let ch = &self.ch;
        let g = &mut self.g;
        g.set_curve(ch.shaper, &curve);
        g.set_target_at_time(ch.wow_out, GAIN, (wow * 0.004) as f32, now, 0.03);
        g.set_target_at_time(ch.flut_out, GAIN, (wow * 0.0004) as f32, now, 0.03);
        g.set_target_at_time(ch.ens_wet, GAIN, (ens * 0.75) as f32, now, 0.03);
        g.set_target_at_time(ch.ens_dry, GAIN, (1.0 - ens * 0.3) as f32, now, 0.03);
        for &(osc, gain, r) in &ch.ens {
            g.set_target_at_time(osc, FREQUENCY, (rate * r) as f32, now, 0.03);
            g.set_target_at_time(gain, GAIN, (0.0035 * ens) as f32, now, 0.03);
        }
        g.set_target_at_time(self.sym_in, GAIN, sym as f32, now, 0.03);
        self.sym_key = None;
    }

    /// `atmosRetuneSympathy`: resonators on the scale, made again when the
    /// tuning, ring or material changed.
    pub fn retune_sympathy(&mut self) {
        let at = &self.at;
        let key = SymKey { root_hz: at.root_hz, cents: at.cents, cents_len: at.cents_len, tune: at.sym_tune, ring: at.sym_ring, mat: at.sym_mat };
        if self.sym_key == Some(key) && !self.bank.is_empty() {
            return;
        }
        self.sym_key = Some(key);
        for &(bp, g) in self.bank.iter() {
            self.g.disconnect(bp, g, None);
            self.g.disconnect(g, self.sym_out, None);
            self.g.free_quiet(bp);
            self.g.free_quiet(g);
        }
        self.bank.clear();
        let cents = at.scale();
        let mut set = [0.0f64; 32];
        let n = match at.sym_tune {
            SymTune::Root => 1,
            SymTune::Fifths => {
                let best = cents.iter().fold(cents[0], |best, &c| if (c - 702.0).abs() < (best - 702.0).abs() { c } else { best });
                set[1] = best;
                2
            }
            SymTune::Degrees => {
                set[..cents.len()].copy_from_slice(cents);
                cents.len()
            }
        };
        let tau = patch::at_exp(at.sym_ring, 0.3, 10.0);
        let mat = at.sym_mat / 100.0;
        let root = at.root_hz;
        for o in -1i32..=1 {
            for &ct in &set[..n] {
                let f = root * 2f64.powf((o as f64 * 1200.0 + ct) / 1200.0);
                if f < 30.0 || f > 12000.0 || self.bank.len() >= 24 {
                    continue;
                }
                let q = (core::f64::consts::PI * f * tau / (1.0 + (1.0 - mat) * (o * o) as f64)).min(3000.0).max(2.0);
                let Some(bp) = self.g.biquad(FilterType::Bandpass) else { return };
                let Some(g) = self.g.gain() else { return };
                self.g.set(bp, FREQUENCY, f as f32);
                self.g.set(bp, Q, q as f32);
                self.g.set(g, GAIN, (q.sqrt() * 0.05 * 2f64.powf((mat - 0.5) * o as f64 * 1.5)) as f32);
                self.g.connect(self.sym_in, bp);
                self.g.connect(bp, g);
                self.g.connect(g, self.sym_out);
                self.bank.push((bp, g));
            }
        }
    }

    /// `atmosPlay(freq, time, dur, o)` into the voice's output. The slot of
    /// the note, to let go of early ([`AtmosWeb::release`]).
    pub fn play(&mut self, freq: f64, time: f64, dur: f64, o: Options, into: Route) -> Option<usize> {
        self.retune_sympathy();
        let now = self.g.current_time();
        // Notes the context has finished playing let go of the buses.
        for s in self.slots.iter_mut() {
            if s.voice.used && !s.voice.cleaned && s.voice.end < now {
                for &(bus, dest, k) in s.voice.links.iter() {
                    self.g.disconnect(bus, dest, Some(k));
                }
                s.voice.links.clear();
                s.voice.cleaned = true;
            }
        }
        // The oldest still sounding at `time` fades if there are too many
        // (each taken off the list as it is stolen, as `shift` does).
        let mut sounding = [0usize; MAX_VOICES * 2];
        let mut count = 0;
        for (i, s) in self.slots.iter().enumerate() {
            if s.voice.used && !s.voice.cleaned && s.voice.end > time {
                sounding[count] = i;
                count += 1;
            }
        }
        sounding[..count].sort_unstable_by_key(|&i| self.slots[i].order);
        let mut first = 0;
        while count - first >= MAX_VOICES {
            self.steal(sounding[first], time);
            first += 1;
        }
        let slot = self.slots.iter().position(|s| !s.voice.used)?;
        let order = self.next_order;
        self.next_order += 1;
        let voice = &mut self.slots[slot].voice;
        voice.srcs.clear();
        voice.links.clear();
        voice.nodes.clear();
        voice.cleaned = false;
        voice.used = true;
        voice.start = time;
        self.slots[slot].order = order;
        let built = {
            let mut b = Builder {
                g: &mut self.g,
                at: &self.at,
                buses: self.buses,
                noise: self.noise,
                rng: &mut self.rng,
                clouds: &mut self.clouds,
                v: &mut self.slots[slot].voice,
            };
            let dest = if into == Route::Page { self.at_in } else { self.direct };
            b.play(freq, time, dur, o, dest, &mut self.prev_freq, true)
        };
        if built.is_none() {
            // Out of room: undo what was made.
            self.free_slot(slot);
            return None;
        }
        Some(slot)
    }

    /// `atStealOldest`.
    fn steal(&mut self, slot: usize, time: f64) {
        let v = &mut self.slots[slot].voice;
        self.g.cancel_scheduled_values(v.env, GAIN, time);
        self.g.set_target_at_time(v.env, GAIN, 0.0, time, 0.03);
        for &s in v.srcs.iter() {
            self.g.stop(s, time + 0.25);
        }
        v.end = time + 0.25;
    }

    /// A held key let go (`kyAtmosOn`'s `release`).
    pub fn release(&mut self, slot: usize, at: f64) {
        let r = patch::at_exp(self.at.rel, 10.0, 20000.0) / 1000.0;
        let v = &mut self.slots[slot].voice;
        if !v.used {
            return;
        }
        self.g.cancel_scheduled_values(v.env, GAIN, at);
        self.g.cancel_and_hold_at_time(v.env, GAIN, at);
        self.g.set_target_at_time(v.env, GAIN, 0.0, at, (r / 5.0).max(0.004));
        v.end = at + r * 1.25 + 0.05;
        for &s in v.srcs.iter() {
            self.g.stop(s, v.end);
        }
    }

    fn free_slot(&mut self, slot: usize) {
        let v = &mut self.slots[slot].voice;
        for &n in v.nodes.iter() {
            self.g.free_quiet(n);
        }
        v.nodes.clear();
        v.srcs.clear();
        v.links.clear();
        v.used = false;
    }

    /// Set a value by the page's name for it, as the page does when a control
    /// moves (`atmosRead`): it glides there from now. False for a name it
    /// does not know.
    pub fn set(&mut self, key: &str, v: f64) -> bool {
        if !self.at.set(key, v) {
            return false;
        }
        self.apply_global();
        true
    }

    /// One quantum of Atmosphere's output (`atFxIn`, before its effects and
    /// its output level), with `input` handed in through its input.
    pub fn render_output(&mut self, input: Option<(&[f32], &[f32])>, l: &mut [f32], r: &mut [f32]) {
        if let Some(i) = self.ext_in {
            self.g.set_input(i, input);
        }
        self.g.render(&[self.fx_in]);
        let b = self.g.bus(self.fx_in);
        let n = l.len().min(r.len()).min(QUANTUM);
        let right = if b.channels == 2 { 1 } else { 0 };
        l[..n].copy_from_slice(&b.data[0][..n]);
        r[..n].copy_from_slice(&b.data[right][..n]);
        self.collect();
    }

    /// Whether any note is still sounding.
    pub fn sounding(&self) -> usize {
        self.slots.iter().filter(|s| s.voice.used).count()
    }

    /// Let every note go at `at`.
    pub fn release_all(&mut self, at: f64) {
        for slot in 0..self.slots.len() {
            if self.slots[slot].voice.used && self.slots[slot].voice.end > at {
                self.release(slot, at);
            }
        }
    }

    /// Notes that are over, and silent for good, give their nodes back.
    fn collect(&mut self) {
        for slot in 0..self.slots.len() {
            let v = &self.slots[slot].voice;
            if !v.used || v.end > self.g.current_time() {
                continue;
            }
            let done = v.srcs.iter().all(|s| self.g.finished(*s)) && v.nodes.iter().all(|n| self.g.silent(*n));
            if done {
                self.free_slot(slot);
            }
        }
    }

    /// Render one quantum (128 frames) into `l` and `r`: what reaches the
    /// page's destination.
    pub fn render(&mut self, l: &mut [f32], r: &mut [f32]) {
        self.g.render(&[self.out]);
        let b = self.g.bus(self.out);
        let n = l.len().min(r.len()).min(QUANTUM);
        l[..n].copy_from_slice(&b.data[0][..n]);
        r[..n].copy_from_slice(&b.data[1][..n]);
        self.collect();
    }
}

struct Built {
    inp: NodeId,
    chain: Character,
}

/// `atLfo`: a sine into a gain.
fn lfo(g: &mut Graph, rate: f64, depth: f64) -> (NodeId, NodeId) {
    let o = g.oscillator(WaveId(0)).expect("room");
    let out = g.gain().expect("room");
    g.set(o, FREQUENCY, rate as f32);
    g.set(out, GAIN, depth as f32);
    g.connect(o, out);
    g.start(o, 0.0);
    (o, out)
}

/// `atCharChain`: warmth, tape wow, and the ensemble (three slowly swept
/// delays, left, centre and right, beside the dry).
fn character(g: &mut Graph) -> Built {
    let inp = g.gain().expect("room");
    let shaper = g.wave_shaper(&[], 2).expect("room");
    let wow = g.delay(0.1).expect("room");
    g.set(wow, DELAY_TIME, 0.012);
    let (_, wow_out) = lfo(g, 0.6, 0.0);
    let (_, flut_out) = lfo(g, 6.8, 0.0);
    g.connect_param(wow_out, wow, DELAY_TIME);
    g.connect_param(flut_out, wow, DELAY_TIME);
    g.connect(inp, shaper);
    g.connect(shaper, wow);
    let post = g.gain().expect("room");
    let ens_dry = g.gain().expect("room");
    let ens_wet = g.gain().expect("room");
    g.connect(wow, ens_dry);
    g.connect(ens_dry, post);
    let mut ens = [(NodeId(0), NodeId(0), 0.0); 3];
    for (k, (base, pan, rate)) in [(0.011, -0.7, 1.0), (0.017, 0.0, 1.13), (0.023, 0.7, 0.87)].into_iter().enumerate() {
        let d = g.delay(0.1).expect("room");
        let p = g.panner().expect("room");
        let (o, out) = lfo(g, 0.3 * rate, 0.0);
        g.set(d, DELAY_TIME, base as f32);
        g.connect_param(out, d, DELAY_TIME);
        g.set(p, PAN, pan as f32);
        g.connect(wow, d);
        g.connect(d, p);
        g.connect(p, ens_wet);
        ens[k] = (o, out, rate);
    }
    g.connect(ens_wet, post);
    Built { inp, chain: Character { shaper, wow_out, flut_out, ens_dry, ens_wet, ens, post } }
}
