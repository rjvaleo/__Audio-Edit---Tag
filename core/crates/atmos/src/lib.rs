//! Atmosphere, the sequencer page's own synth, as a physical-modelling engine
//! (RJ, 17 Nov 2026: "its oscillators should be physically modeled"; "builds
//! all of the modeled instruments"). Plan: `WORK DIR/page-mockups/
//! ATMOS-PHYS-PLAN.md`; the models are in [`models`].
//!
//! The whole voice is here: two oscillators (each one of ten models, with its
//! octave, fine tune and up to three unison copies), their blend, a sub, air,
//! glide and drift; the voice's own filter and its envelope; the Amp; and
//! Atmosphere's three LFOs. Sixteen voices. It runs natively for its tests and
//! in the browser's AudioWorklet (`ui/sequencer/atmos-worklet.js`, built as
//! `atmos.wasm` by `tools/build-fx-wasm.sh`); Character, Sympathy and the FX
//! line come after it, in the page.
//!
//! Controls are set by name ([`Synth::set`]); notes start and stop by an id
//! (the key) at a sample offset, so a key lands where it was played.

mod memo;
use memo::Memo;
pub mod dsp;
pub mod models;

use dsp::*;
use models::{Osc, MODELS};

pub const VOICES: usize = 16;
const UNISON: usize = 3;

/// Every control, by the name the page sends.
#[derive(Clone)]
pub struct Params {
    pub model: [usize; 2],
    pub p: [[f32; 4]; 2],
    pub oct: [f32; 2],
    pub fine: [f32; 2],
    pub blend: f32,
    pub unison: usize,
    pub detune: f32,
    pub width: f32,
    pub drift: f32,
    pub sub: f32,
    pub air: f32,
    pub glide: f32,
    pub atk: f32,
    pub dec: f32,
    pub sus: f32,
    pub rel: f32,
    pub vol: f32,
    pub flt_type: u8,
    pub flt_cut: f32,
    pub flt_q: f32,
    pub flt_key: f32,
    pub flt_amt: f32,
    pub flt_atk: f32,
    pub flt_dec: f32,
    pub flt_sus: f32,
    pub flt_rel: f32,
    pub fit: f32,
    pub lfo: [Lfo; 3],
}

impl Default for Params {
    fn default() -> Self {
        Params {
            model: [0, 3],
            p: [MODELS[0].3, MODELS[3].3],
            oct: [0.0; 2],
            fine: [0.0; 2],
            blend: 0.4,
            unison: 1,
            detune: 18.0,
            width: 0.8,
            drift: 0.35,
            sub: 0.0,
            air: 0.0,
            glide: 0.0,
            atk: 0.005,
            dec: 0.6,
            sus: 0.8,
            rel: 1.2,
            vol: 0.7,
            flt_type: 0,
            flt_cut: 20000.0,
            flt_q: 0.8,
            flt_key: 0.0,
            flt_amt: 0.0,
            flt_atk: 0.04,
            flt_dec: 0.25,
            flt_sus: 0.5,
            flt_rel: 2.0,
            fit: 0.0,
            lfo: [Lfo::default(), Lfo::default(), Lfo::default()],
        }
    }
}

/// One of Atmosphere's LFOs: free-running, shared by every voice.
#[derive(Clone, Default)]
pub struct Lfo {
    pub shape: u8, // 0 sine, 1 tri, 2 saw, 3 square
    pub rate: f32,
    pub depth: f32,
    pub target: u8, // see LFO_TARGETS
    phase: f32,
}
/// What an LFO can move.
pub const LFO_TARGETS: &[&str] = &["", "cutoff", "detune", "volume", "pan", "blend", "air", "vowel", "fit"];

impl Lfo {
    #[inline]
    fn tick(&mut self, sr: f32) -> f32 {
        self.phase += self.rate / sr;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
        let p = self.phase;
        let v = match self.shape {
            0 => (2.0 * std::f32::consts::PI * p).sin(),
            1 => 1.0 - 4.0 * (p - 0.5).abs(),
            2 => 2.0 * p - 1.0,
            _ => {
                if p < 0.5 {
                    1.0
                } else {
                    -1.0
                }
            }
        };
        v * self.depth
    }
}

/// The LFOs' values this sample, by target.
#[derive(Default, Clone, Copy)]
struct Mods {
    cutoff: f32,
    detune: f32,
    volume: f32,
    pan: f32,
    blend: f32,
    air: f32,
    vowel: f32,
    fit: f32,
}

struct Voice {
    id: i32,
    age: u64,
    hz: f32,
    target_hz: f32,
    vel: f32,
    osc: [[Osc; UNISON]; 2],
    pitch_math: [Memo<1, f32>; 2],
    sub_phase: f32,
    drift: f32,
    drift_v: f32,
    amp: Adsr,
    fenv: Adsr,
    svf: [Svf; 2],
    air_hp: f32,
    noise: Noise,
    steal: u32, // samples of a fast fade before a stolen voice starts again
    last: [f32; 2], // what it last added to the mix, for a steal to carry on from
}

impl Voice {
    fn new(sr: f32, n: u32) -> Self {
        let mk = |k: u32| Osc::new(sr, 1 + n * 97 + k * 13);
        Voice {
            id: -1,
            age: 0,
            hz: 220.0,
            target_hz: 220.0,
            vel: 0.0,
            osc: [[mk(0), mk(1), mk(2)], [mk(3), mk(4), mk(5)]],
            pitch_math: [Memo::new(); 2],
            sub_phase: 0.0,
            drift: 0.0,
            drift_v: 0.0,
            amp: Adsr::default(),
            fenv: Adsr::default(),
            svf: Default::default(),
            air_hp: 0.0,
            noise: Noise::new(7 + n * 31),
            steal: 0,
            last: [0.0; 2],
        }
    }
    fn free(&self) -> bool {
        self.id < 0 && self.amp.idle()
    }
}

enum Event {
    On { at: u32, id: i32, hz: f32, vel: f32 },
    Off { at: u32, id: i32 },
}

pub struct Synth {
    pub sr: f32,
    pub params: Params,
    voices: Vec<Voice>,
    events: Vec<Event>,
    clock: u64,
    last_hz: f32,
    scale: Vec<f32>,
    last_voice: usize,
    /// What stolen voices were sounding when they were taken, dying away. A
    /// voice taken for a new note is started again from nothing, and its old
    /// sound used to stop on that sample: a click. Now it leaves from where it
    /// was, over a few milliseconds, under the new note's own fade in.
    carry: [f32; 2],
    carry_k: f32,
    glide_math: Memo<2, f32>,
    ratio_math: [[Memo<1, f32>; UNISON]; 2],
    pan_math: [[Memo<1, [f32; 2]>; UNISON]; 2],
}

impl Synth {
    pub fn new(sr: f32) -> Self {
        Synth {
            glide_math: Memo::new(),
            ratio_math: [[Memo::new(); UNISON]; 2],
            pan_math: [[Memo::new(); UNISON]; 2],
            sr,
            params: Params::default(),
            voices: (0..VOICES as u32).map(|n| Voice::new(sr, n)).collect(),
            events: Vec::with_capacity(64),
            clock: 0,
            last_hz: 0.0,
            scale: vec![0.0, 200.0, 400.0, 500.0, 700.0, 900.0, 1100.0],
            last_voice: 0,
            carry: [0.0; 2],
            // Down by 60 dB in 10 ms.
            carry_k: (-6.9 / (0.010 * sr.max(1.0))).exp(),
        }
    }

    /// The scale's degrees in cents, for the modal models' Fit.
    pub fn set_scale(&mut self, cents: &[f32]) {
        self.scale = cents.to_vec();
    }

    /// One control, by name. Unknown names are ignored (false).
    pub fn set(&mut self, key: &str, v: f32) -> bool {
        let p = &mut self.params;
        let ab = key.strip_prefix("a.").map(|r| (0usize, r)).or_else(|| key.strip_prefix("b.").map(|r| (1usize, r)));
        if let Some((o, rest)) = ab {
            match rest {
                "model" => p.model[o] = (v.max(0.0) as usize).min(MODELS.len() - 1),
                "p0" => p.p[o][0] = v.clamp(0.0, 1.0),
                "p1" => p.p[o][1] = v.clamp(0.0, 1.0),
                "p2" => p.p[o][2] = v.clamp(0.0, 1.0),
                "p3" => p.p[o][3] = v.clamp(0.0, 1.0),
                "oct" => p.oct[o] = v.clamp(-3.0, 3.0),
                "fine" => p.fine[o] = v.clamp(-100.0, 100.0),
                _ => return false,
            }
            return true;
        }
        if let Some(rest) = key.strip_prefix("lfo") {
            let n = rest.chars().next().and_then(|c| c.to_digit(10)).unwrap_or(0) as usize;
            if !(1..=3).contains(&n) {
                return false;
            }
            let l = &mut p.lfo[n - 1];
            match &rest[1..] {
                ".shape" => l.shape = v as u8,
                ".rate" => l.rate = v.clamp(0.0, 40.0),
                ".depth" => l.depth = v.clamp(0.0, 1.0),
                ".target" => l.target = (v.max(0.0) as u8).min(LFO_TARGETS.len() as u8 - 1),
                _ => return false,
            }
            return true;
        }
        match key {
            "blend" => p.blend = v.clamp(0.0, 1.0),
            "unison" => p.unison = (v.round() as usize).clamp(1, UNISON),
            "detune" => p.detune = v.clamp(0.0, 100.0),
            "width" => p.width = v.clamp(0.0, 1.0),
            "drift" => p.drift = v.clamp(0.0, 1.0),
            "sub" => p.sub = v.clamp(0.0, 1.0),
            "air" => p.air = v.clamp(0.0, 1.0),
            "glide" => p.glide = v.clamp(0.0, 5.0),
            "atk" => p.atk = v.clamp(0.0005, 20.0),
            "dec" => p.dec = v.clamp(0.001, 20.0),
            "sus" => p.sus = v.clamp(0.0, 1.0),
            "rel" => p.rel = v.clamp(0.002, 30.0),
            "vol" => p.vol = v.clamp(0.0, 1.0),
            "flt.type" => p.flt_type = (v.max(0.0) as u8).min(2),
            "flt.cut" => p.flt_cut = v.clamp(20.0, 20000.0),
            "flt.q" => p.flt_q = v.clamp(0.3, 20.0),
            "flt.key" => p.flt_key = v.clamp(0.0, 1.0),
            "flt.amt" => p.flt_amt = v.clamp(-1.0, 1.0),
            "flt.atk" => p.flt_atk = v.clamp(0.0005, 20.0),
            "flt.dec" => p.flt_dec = v.clamp(0.001, 20.0),
            "flt.sus" => p.flt_sus = v.clamp(0.0, 1.0),
            "flt.rel" => p.flt_rel = v.clamp(0.002, 30.0),
            "fit" => p.fit = v.clamp(0.0, 1.0),
            _ => return false,
        }
        true
    }

    /// A key down, `delay` samples from the start of the next render.
    pub fn note_on(&mut self, id: i32, hz: f32, vel: f32, delay: u32) {
        // Invalid note inputs cannot be allowed into oscillator memory.
        if !hz.is_finite() || hz <= 0.0 || !vel.is_finite() || vel <= 0.0 {
            self.note_off(id, delay);
            return;
        }
        if self.events.len() < self.events.capacity() {
            self.events.push(Event::On { at: delay, id, hz, vel });
        }
    }
    pub fn note_off(&mut self, id: i32, delay: u32) {
        if self.events.len() < self.events.capacity() {
            self.events.push(Event::Off { at: delay, id });
        }
    }
    /// Every voice let go.
    pub fn all_off(&mut self) {
        self.events.clear();
        for v in &mut self.voices {
            v.id = -1;
            v.amp.release();
            v.fenv.release();
            for o in v.osc.iter_mut().flatten() {
                o.release();
            }
        }
    }

    /// How many voices are sounding.
    pub fn sounding(&self) -> usize {
        self.voices.iter().filter(|v| !v.amp.idle()).count()
    }

    /// The most recent voice's oscillator `which` (0 A, 1 B): its model and
    /// what it shows. None when nothing sounds.
    pub fn view(&self, which: usize) -> Option<(usize, &[f32; 32])> {
        let v = &self.voices[self.last_voice];
        if v.amp.idle() {
            return None;
        }
        let o = &v.osc[which.min(1)][0];
        Some((o.kind(), &o.view))
    }

    fn start(&mut self, id: i32, hz: f32, vel: f32) {
        // The same key again restarts its voice; else a free one; else the oldest.
        let i = self
            .voices
            .iter()
            .position(|v| v.id == id)
            .or_else(|| self.voices.iter().position(|v| v.free()))
            .unwrap_or_else(|| (0..VOICES).max_by_key(|&k| self.voices[k].age).unwrap_or(0));
        let p = self.params.clone();
        let from = if p.glide > 0.0 && self.last_hz > 0.0 { self.last_hz } else { hz };
        self.last_hz = hz;
        self.last_voice = i;
        let scale = &self.scale;
        let v = &mut self.voices[i];
        let was_sounding = !v.amp.idle();
        if was_sounding {
            self.carry[0] += v.last[0];
            self.carry[1] += v.last[1];
        }
        v.last = [0.0; 2];
        v.id = id;
        v.age = 0;
        v.vel = vel;
        v.target_hz = hz;
        v.hz = from;
        v.steal = if was_sounding { (0.004 * self.sr) as u32 } else { 0 };
        v.amp.level = if was_sounding { v.amp.level } else { 0.0 };
        v.amp.start();
        v.fenv.start();
        for o in 0..2 {
            for u in 0..UNISON {
                v.osc[o][u].fit = p.fit;
                v.osc[o][u].start(p.model[o], from * 2f32.powf(p.oct[o]), vel, p.p[o], scale);
            }
        }
    }

    fn stop(&mut self, id: i32) {
        for v in &mut self.voices {
            if v.id == id {
                v.id = -1;
                v.amp.release();
                v.fenv.release();
                for o in v.osc.iter_mut().flatten() {
                    o.release();
                }
            }
        }
    }

    /// Render `l.len()` samples into `l` and `r` (overwritten).
    pub fn render(&mut self, l: &mut [f32], r: &mut [f32]) {
        let n = l.len().min(r.len());
        l[..n].iter_mut().for_each(|x| *x = 0.0);
        r[..n].iter_mut().for_each(|x| *x = 0.0);
        let sr = self.sr;
        for i in 0..n {
            // Notes due now.
            let mut k = 0;
            while k < self.events.len() {
                let due = match &self.events[k] {
                    Event::On { at, .. } | Event::Off { at, .. } => *at as usize <= i,
                };
                if due {
                    match self.events.remove(k) {
                        Event::On { id, hz, vel, .. } => self.start(id, hz, vel),
                        Event::Off { id, .. } => self.stop(id),
                    }
                } else {
                    k += 1;
                }
            }
            // The LFOs.
            let mut m = Mods::default();
            for lf in self.params.lfo.iter_mut() {
                let x = lf.tick(sr);
                match LFO_TARGETS.get(lf.target as usize).copied().unwrap_or("") {
                    "cutoff" => m.cutoff += x * 2400.0,
                    "detune" => m.detune += x * 50.0,
                    "volume" => m.volume += x * 0.5,
                    "pan" => m.pan += x,
                    "blend" => m.blend += x * 0.5,
                    "air" => m.air += x * 0.5,
                    "vowel" => m.vowel += x * 0.5,
                    "fit" => m.fit += x * 0.5,
                    _ => {}
                }
            }
            let (a, b) = self.voice_sum(&m, i);
            l[i] = a;
            r[i] = b;
        }
        for e in &mut self.events {
            match e {
                Event::On { at, .. } | Event::Off { at, .. } => *at = at.saturating_sub(n as u32),
            }
        }
        self.clock += n as u64;
    }

    #[inline]
    fn voice_sum(&mut self, m: &Mods, i: usize) -> (f32, f32) {
        let p = &self.params;
        let sr = self.sr;
        let (mut sl, mut sr_) = (0.0, 0.0);
        let blend = (p.blend + m.blend).clamp(0.0, 1.0);
        let ga = (blend * std::f32::consts::FRAC_PI_2).cos();
        let gb = (blend * std::f32::consts::FRAC_PI_2).sin();
        let uni = p.unison.clamp(1, UNISON);
        let filter_on = p.flt_type != 0 || p.flt_cut < 19990.0 || p.flt_amt != 0.0 || m.cutoff != 0.0;
        let vowel_shift = m.vowel;
        for v in self.voices.iter_mut() {
            if v.amp.idle() {
                continue;
            }
            v.age += 1;
            // Glide, then drift: a slow wander of its own.
            if p.glide > 0.0 {
                let c = self.glide_math.get([p.glide, sr], || 1.0 - (-1.0 / (p.glide * sr * 0.3)).exp());
                v.hz += (v.target_hz - v.hz) * c;
            } else {
                v.hz = v.target_hz;
            }
            v.drift_v = v.drift_v * 0.9995 + v.noise.next() * 0.0005;
            v.drift = (v.drift + v.drift_v * 0.01).clamp(-1.0, 1.0) * 0.99999;
            let cents = m.detune + v.drift * p.drift * 12.0;
            let amp = v.amp.tick(p.atk, p.dec, p.sus, p.rel, sr);
            let fe = v.fenv.tick(p.flt_atk, p.flt_dec, p.flt_sus, p.flt_rel, sr);
            let (mut vl, mut vr) = (0.0, 0.0);
            for o in 0..2 {
                let g = if o == 0 { ga } else { gb };
                if g < 1e-4 {
                    continue;
                }
                let exponent = p.oct[o] + (p.fine[o] + cents) / 1200.0;
                let ratio = if p.drift == 0.0 && m.detune == 0.0 {
                    v.pitch_math[o].get([exponent], || 2f32.powf(exponent))
                } else {
                    2f32.powf(exponent)
                };
                let base = v.hz * ratio;
                for u in 0..uni {
                    let spread = if uni > 1 { u as f32 / (uni - 1) as f32 * 2.0 - 1.0 } else { 0.0 };
                    let osc = &mut v.osc[o][u];
                    let exponent = spread * p.detune * 0.5 / 1200.0;
                    let ratio = self.ratio_math[o][u].get([exponent], || 2f32.powf(exponent));
                    osc.set_hz(base * ratio);
                    if vowel_shift != 0.0 && i % 32 == 0 {
                        let mut pp = p.p[o];
                        pp[0] = (pp[0] + vowel_shift).clamp(0.0, 1.0);
                        osc.set_params(pp);
                    } else if i % 32 == 0 {
                        osc.set_params(p.p[o]);
                    }
                    let y = osc.tick() * MODEL_GAIN[osc.kind()] * g / (uni as f32).sqrt();
                    // A to the left of B, the copies spread across Width.
                    let pan = ((spread * 0.7 + if o == 0 { -0.3 } else { 0.3 }) * p.width + m.pan).clamp(-1.0, 1.0);
                    let a = (pan + 1.0) * std::f32::consts::FRAC_PI_4;
                    let [left, right] = if m.pan == 0.0 {
                        self.pan_math[o][u].get([a], || [a.cos(), a.sin()])
                    } else {
                        [a.cos(), a.sin()]
                    };
                    vl += y * left;
                    vr += y * right;
                }
            }
            // Sub, an octave down; air, noise over the top.
            if p.sub > 0.0 {
                v.sub_phase = (v.sub_phase + v.hz * 0.5 / sr) % 1.0;
                let s = (2.0 * std::f32::consts::PI * v.sub_phase).sin() * p.sub * 0.45;
                vl += s;
                vr += s;
            }
            let air = (p.air + m.air).clamp(0.0, 1.0);
            if air > 0.0 {
                let nz = v.noise.next();
                let hp = nz - v.air_hp;
                v.air_hp += (nz - v.air_hp) * 0.08;
                vl += hp * air * 0.12;
                vr += hp * air * 0.12;
            }
            // Its own filter, one per voice.
            if filter_on {
                let key = 2f32.powf(p.flt_key * (12.0 * (v.hz / 261.63).log2()) / 12.0);
                let hz = p.flt_cut * key * 2f32.powf(4.0 * p.flt_amt * fe + m.cutoff / 1200.0);
                // Envelopes, cutoff LFOs and a gliding key-tracked cutoff move each sample.
                let cache = p.flt_amt == 0.0 && m.cutoff == 0.0 && (p.flt_key == 0.0 || p.glide == 0.0);
                vl = v.svf[0].tick_coefficients(vl, hz, p.flt_q, p.flt_type, sr, cache);
                vr = v.svf[1].tick_coefficients(vr, hz, p.flt_q, p.flt_type, sr, cache);
            }
            let mut g = amp * v.vel * p.vol * 0.32 * (1.0 + m.volume).max(0.0);
            if v.steal > 0 {
                v.steal -= 1;
                g *= 1.0 - v.steal as f32 / (0.004 * sr);
            }
            v.last = [vl * g, vr * g];
            sl += v.last[0];
            sr_ += v.last[1];
            if v.amp.idle() {
                v.id = -1;
                v.last = [0.0; 2];
            }
        }
        if self.carry != [0.0; 2] {
            sl += self.carry[0];
            sr_ += self.carry[1];
            self.carry[0] *= self.carry_k;
            self.carry[1] *= self.carry_k;
            // Done when it is too small to hear, and at once if it is not a number.
            let live = |x: f32| x.abs() >= 1e-6 && x.is_finite();
            if !self.carry[0].is_finite() || !self.carry[1].is_finite() || !(live(self.carry[0]) || live(self.carry[1])) {
                self.carry = [0.0; 2];
            }
        }
        (sl, sr_)
    }
}

/// Each model's level, so a note of any model sits near a sine's at the same
/// Volume (measured by `tests/models.rs`, `every_model_sits_near_a_sines_level`).
pub const MODEL_GAIN: [f32; 10] = [1.089, 0.648, 0.904, 0.414, 0.562, 1.109, 4.121, 1.216, 0.96, 1.0];

// ─── The browser's side: C functions over one interleaved stereo buffer ──────
#[cfg(target_arch = "wasm32")]
mod web {
    use super::*;

    const MAX: usize = 4096;
    struct G {
        synth: Synth,
        l: Vec<f32>,
        r: Vec<f32>,
        out: Vec<f32>,
        text: Vec<u8>,
        scale: Vec<f32>,
        view: Vec<f32>,
    }
    static mut S: Option<G> = None;
    #[allow(static_mut_refs)]
    fn g() -> &'static mut G {
        unsafe {
            S.get_or_insert_with(|| G {
                synth: Synth::new(48_000.0),
                l: vec![0.0; MAX],
                r: vec![0.0; MAX],
                out: vec![0.0; MAX * 2],
                text: vec![0; 64],
                scale: vec![0.0; 64],
                view: vec![0.0; 32],
            })
        }
    }

    #[no_mangle]
    pub extern "C" fn at_init(sr: f32) {
        g().synth = Synth::new(sr);
    }
    #[no_mangle]
    pub extern "C" fn at_text() -> *mut u8 {
        g().text.as_mut_ptr()
    }
    #[no_mangle]
    pub extern "C" fn at_set(len: usize, v: f32) -> u32 {
        let s = g();
        let k = std::str::from_utf8(&s.text[..len.min(64)]).unwrap_or("").to_string();
        s.synth.set(&k, v) as u32
    }
    #[no_mangle]
    pub extern "C" fn at_note_on(id: i32, hz: f32, vel: f32, delay: u32) {
        g().synth.note_on(id, hz, vel, delay);
    }
    #[no_mangle]
    pub extern "C" fn at_note_off(id: i32, delay: u32) {
        g().synth.note_off(id, delay);
    }
    #[no_mangle]
    pub extern "C" fn at_all_off() {
        g().synth.all_off();
    }
    #[no_mangle]
    pub extern "C" fn at_scale_buf() -> *mut f32 {
        g().scale.as_mut_ptr()
    }
    #[no_mangle]
    pub extern "C" fn at_scale(n: usize) {
        let s = g();
        let c = s.scale[..n.min(64)].to_vec();
        s.synth.set_scale(&c);
    }
    #[no_mangle]
    pub extern "C" fn at_buf() -> *mut f32 {
        g().out.as_mut_ptr()
    }
    /// Render `frames` into the buffer, interleaved L R.
    #[no_mangle]
    pub extern "C" fn at_render(frames: usize) {
        let s = g();
        let n = frames.min(MAX);
        let (l, r) = (&mut s.l[..n], &mut s.r[..n]);
        s.synth.render(l, r);
        for i in 0..n {
            s.out[2 * i] = s.l[i];
            s.out[2 * i + 1] = s.r[i];
        }
    }
    #[no_mangle]
    pub extern "C" fn at_sounding() -> u32 {
        g().synth.sounding() as u32
    }
    #[no_mangle]
    pub extern "C" fn at_view_buf() -> *mut f32 {
        g().view.as_mut_ptr()
    }
    /// Copy oscillator `which`'s picture into the view buffer; its model, or −1.
    #[no_mangle]
    pub extern "C" fn at_view(which: usize) -> i32 {
        let s = g();
        match s.synth.view(which) {
            Some((k, v)) => {
                let v = *v;
                s.view.copy_from_slice(&v);
                k as i32
            }
            None => -1,
        }
    }
}
