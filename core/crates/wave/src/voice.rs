//! One note: three oscillators, the sub and the noise, two filters, the amp
//! envelope, ENV 2–4, the per-note LFOs and the mod matrix.
//!
//! # Control blocks
//!
//! A voice works in blocks of at most 32 samples. At each block it advances
//! its envelopes and LFOs to the block's end, evaluates the matrix there, and
//! works out every destination's value. Anything that would step audibly
//! (oscillator levels, pans, frame positions, filter coefficients) is then
//! ramped from last block's value to this one across the block, so control
//! rate is 1.5 kHz with no zipper. Pitch, warp amounts and unison are held for
//! the block, which is under a millisecond; the phase stays continuous, so a
//! pitch change is a glide of one block rather than a click. The amp envelope
//! runs per sample on the output, since an attack of a few samples has to be
//! one.
//!
//! # The matrix
//!
//! Every row adds `amt · curve(src) · via` to its destination's normalised
//! value; a destination's rows are summed and the sum is clamped once, so two
//! half-strength rows are exactly one full one (the rule idMLab's matrix
//! settled on). The voice keeps the modulated value of every key, which is
//! what telemetry reports.
//!
//! # Routing
//!
//! Each oscillator goes to Filter 1, Filter 2, both, or around them (`direct`).
//! - **serial**: F1 → F2. Sources routed to F2 join after F1; `both` goes in
//!   at F1, so it passes through both.
//! - **parallel**: the filters side by side and summed; `both` feeds each at
//!   half level, so two open filters leave its level unchanged.
//! - **split**: A → F1 and B → F2 whatever their routes say; C follows its own
//!   route, as in parallel.
//!
//! The sub and the noise have no route of their own; they go in at Filter 1.
//!
//! # Glide
//!
//! Glide is for mono and legato: a new note slides from the pitch the voice is
//! at to the new one, linearly in semitones over `glide² · 2` s. Poly voices
//! start on their note; a chord sliding in from the last note played is not
//! what a poly patch wants.

use crate::env::{Adsr, Stage};
use crate::filter::{cutoff_hz, Filter, FilterParams};
use crate::fx::{OscFx, Shaper};
use crate::osc::{dc_pole, herm, mip_for, next_u32, next_unit, FmSource, OscParams, OscVoice};
use crate::patch::*;
use crate::table::{Wavetable, FRAME_LEN, FRAME_MASK};
use crate::warp::Warp;

/// Samples in a control block.
pub const BLOCK: usize = 32;

/// How long a stolen voice takes to fade.
const STEAL_SECONDS: f32 = 0.005;

/// What every voice shares for one block.
pub(crate) struct BlockCtx<'a> {
    pub sr: f32,
    pub len: usize,
    pub state: &'a PatchState,
    /// The smoothed patch values.
    pub base: &'a [f32; NUM_PARAMS],
    /// Sources that are the same for every voice: macros, mod wheel,
    /// aftertouch, and the free-running LFOs.
    pub global: &'a [f32; SRC_COUNT],
    pub tables: [Option<&'a Wavetable>; 3],
    pub sub_tables: &'a [Wavetable; 3],
    /// Pitch bend in semitones.
    pub bend: f32,
}

/// Work space shared by every voice, so a voice holds no buffers it only
/// needs for the length of a block.
pub(crate) struct Scratch {
    osc: [[f32; BLOCK]; 2],
    bus: [[[f32; BLOCK]; 2]; 4],
}

const BUS_F1: usize = 0;
const BUS_F2: usize = 1;
const BUS_BOTH: usize = 2;
const BUS_DIRECT: usize = 3;

impl Scratch {
    pub fn new() -> Scratch {
        Scratch { osc: [[0.0; BLOCK]; 2], bus: [[[0.0; BLOCK]; 2]; 4] }
    }
}

/// Coloured noise, per voice.
#[derive(Clone, Copy, Default)]
struct Noise {
    b: [f32; 3],
    brown: f32,
}

impl Noise {
    #[inline]
    fn next(&mut self, color: usize, rng: &mut u32) -> f32 {
        let w = (next_u32(rng) as i32) as f32 * (1.0 / 2_147_483_648.0);
        match color {
            0 => w,
            1 => {
                // Paul Kellet's economy pink: three poles, within 0.5 dB.
                self.b[0] = 0.99765 * self.b[0] + w * 0.099_046;
                self.b[1] = 0.963 * self.b[1] + w * 0.296_516_4;
                self.b[2] = 0.57 * self.b[2] + w * 1.052_691_3;
                (self.b[0] + self.b[1] + self.b[2] + w * 0.1848) * 0.25
            }
            _ => {
                self.brown = (self.brown + 0.02 * w) / 1.02;
                self.brown * 3.5
            }
        }
    }
}

pub(crate) struct Voice {
    pub active: bool,
    pub note: u8,
    pub vel: f32,
    pub serial: u64,
    pub released: bool,
    pub stealing: bool,
    steal_gain: f32,
    pub amp: Adsr,
    env: [Adsr; 3],
    pub(crate) lfo_phase: [f32; 4],
    /// Each LFO after its smoothing lag, as of the last block.
    lfo_lag: [f32; 4],
    /// Samples since the note began, for the LFOs' rise.
    age: f32,
    rand: f32,
    rng: u32,
    /// The pitch now, in semitones, gliding toward `glide_to`.
    pub pitch: f32,
    glide_from: f32,
    glide_to: f32,
    glide_t: f32,
    glide_len: f32,
    osc: [OscVoice; 3],
    fx: [OscFx; 3],
    osc_gain: [f32; 3],
    osc_pos: [f32; 3],
    sub_phase: u32,
    sub_gain: f32,
    noise: Noise,
    noise_gain: f32,
    filt: [Filter; 2],
    dc_sub: f32,
    /// Every key's value after modulation, as of the last block.
    pub vals: [f32; NUM_PARAMS],
    pub src: [f32; SRC_COUNT],
    fresh: bool,
}

impl Voice {
    pub fn new(sr: f32) -> Voice {
        Voice {
            active: false,
            note: 0,
            vel: 0.0,
            serial: 0,
            released: false,
            stealing: false,
            steal_gain: 1.0,
            amp: Adsr::new(sr),
            env: [Adsr::new(sr), Adsr::new(sr), Adsr::new(sr)],
            lfo_phase: [0.0; 4],
            lfo_lag: [0.0; 4],
            age: 0.0,
            rand: 0.0,
            rng: 1,
            pitch: 60.0,
            glide_from: 60.0,
            glide_to: 60.0,
            glide_t: 1.0,
            glide_len: 0.0,
            osc: [OscVoice::new(), OscVoice::new(), OscVoice::new()],
            fx: [OscFx::new(sr), OscFx::new(sr), OscFx::new(sr)],
            osc_gain: [0.0; 3],
            osc_pos: [0.0; 3],
            sub_phase: 0,
            sub_gain: 0.0,
            noise: Noise::default(),
            noise_gain: 0.0,
            filt: [Filter::new(sr), Filter::new(sr)],
            dc_sub: 0.0,
            vals: [0.0; NUM_PARAMS],
            src: [0.0; SRC_COUNT],
            fresh: true,
        }
    }

    /// Start a note from silence.
    pub fn start(&mut self, note: u8, vel: f32, serial: u64, seed: u32, base: &[f32; NUM_PARAMS]) {
        self.active = true;
        self.note = note;
        self.vel = vel;
        self.serial = serial;
        self.released = false;
        self.stealing = false;
        self.steal_gain = 1.0;
        // Each note's randomness depends only on the seed and the note's
        // number in the performance, so a replay is the same sound.
        self.rng = seed ^ (serial as u32).wrapping_mul(0x9E37_79B9) ^ 0x5bd1_e995;
        for _ in 0..4 {
            next_u32(&mut self.rng);
        }
        self.rand = next_unit(&mut self.rng);
        self.amp.kill();
        for e in self.env.iter_mut() {
            e.kill();
        }
        self.amp.gate_on();
        for e in self.env.iter_mut() {
            e.gate_on();
        }
        self.lfo_phase = [0.0; 4];
        self.age = 0.0;
        for (o, osc) in self.osc.iter_mut().enumerate() {
            osc.start(base[osc_key(o, O_PHASE)], base[osc_key(o, O_RAND)], &mut self.rng);
        }
        for fx in self.fx.iter_mut() {
            fx.reset();
        }
        for f in self.filt.iter_mut() {
            f.reset();
        }
        self.osc_gain = [0.0; 3];
        self.sub_phase = 0;
        self.sub_gain = 0.0;
        self.noise = Noise::default();
        self.noise_gain = 0.0;
        self.dc_sub = 0.0;
        self.pitch = note as f32;
        self.glide_from = self.pitch;
        self.glide_to = self.pitch;
        self.glide_t = 1.0;
        self.fresh = true;
    }

    /// Move a sounding voice to another note (mono and legato). `retrigger`
    /// restarts the envelopes from where they are.
    pub fn retarget(&mut self, note: u8, vel: f32, serial: u64, glide_seconds: f32, sr: f32, retrigger: bool) {
        self.note = note;
        self.vel = vel;
        self.serial = serial;
        self.released = false;
        self.glide_from = self.pitch;
        self.glide_to = note as f32;
        self.glide_len = glide_seconds * sr;
        self.glide_t = if self.glide_len < 1.0 { 1.0 } else { 0.0 };
        if self.glide_t >= 1.0 {
            self.pitch = self.glide_to;
        }
        if retrigger {
            self.amp.gate_on();
            for e in self.env.iter_mut() {
                e.gate_on();
            }
            self.lfo_phase = [0.0; 4];
            self.age = 0.0;
        }
    }

    pub fn release(&mut self) {
        if !self.active || self.released {
            return;
        }
        self.released = true;
        self.amp.gate_off();
        for e in self.env.iter_mut() {
            e.gate_off();
        }
    }

    /// Fade out fast, for a stolen voice.
    pub fn steal(&mut self) {
        if self.active {
            self.stealing = true;
            self.released = true;
        }
    }

    pub fn kill(&mut self) {
        self.active = false;
        self.stealing = false;
        self.released = false;
        self.amp.kill();
    }

    pub fn stage(&self) -> Stage {
        self.amp.stage()
    }

    /// Render one block and add it to `out`.
    pub fn block(&mut self, ctx: &BlockCtx, sc: &mut Scratch, out_l: &mut [f32], out_r: &mut [f32]) {
        if !self.active {
            return;
        }
        let n = ctx.len.min(BLOCK);
        let sr = ctx.sr;
        let st = ctx.state;

        // ── sources, at the block's end ──────────────────────────────────────
        // Envelope settings come from last block's modulated values (or the
        // patch, on the first block).
        if self.fresh {
            self.vals = *ctx.base;
        }
        for (e, env) in self.env.iter_mut().enumerate() {
            let b = ENV_BASE + e * 4;
            env.set(self.vals[b], self.vals[b + 1], self.vals[b + 2], self.vals[b + 3]);
            self.src[SRC_ENV + e] = env.skip(n);
        }
        for l in 0..4 {
            let shape = &st.lfo_shapes[l];
            let raw = match st.lfo_modes[l] {
                LfoMode::Free => ctx.global[SRC_LFO + l],
                mode => {
                    let rate = 0.2 + self.vals[LFO_RATE + l] * 2.0;
                    let p = self.lfo_phase[l] + rate * n as f32 / sr;
                    self.lfo_phase[l] = if mode == LfoMode::Trig { p.fract() } else { p.min(1.0) };
                    shape.at(self.lfo_phase[l]) * 2.0 - 1.0
                }
            };
            // Smooth: a one-pole lag, up to 200 ms, per voice, so a stepped
            // shape can be rounded off. It starts on the LFO's own value
            // rather than gliding up from nought.
            let tau = self.vals[LFO_SMOOTH + l] * 0.2;
            let lag = if self.fresh || tau <= 1e-4 {
                raw
            } else {
                let a = 1.0 - (-(n as f32) / (tau * sr)).exp();
                self.lfo_lag[l] + (raw - self.lfo_lag[l]) * a
            };
            self.lfo_lag[l] = lag;
            // Rise: the LFO fades in from the note's start, up to 2 s.
            let rise = self.vals[LFO_RISE + l] * 2.0 * sr;
            let g = if rise <= 1.0 { 1.0 } else { (self.age / rise).min(1.0) };
            self.src[SRC_LFO + l] = lag * g;
        }
        self.age += n as f32;
        for m in 0..8 {
            self.src[SRC_MACRO + m] = ctx.global[SRC_MACRO + m];
        }
        self.src[SRC_VEL] = self.vel;
        self.src[SRC_NOTE] = self.note as f32 / 127.0;
        self.src[SRC_MW] = ctx.global[SRC_MW];
        self.src[SRC_AT] = ctx.global[SRC_AT];
        self.src[SRC_RAND] = self.rand;

        // ── the matrix ────────────────────────────────────────────────────────
        modulate(ctx.base, st, &self.src, &mut self.vals);
        let v = &self.vals;

        // ── glide ────────────────────────────────────────────────────────────
        if self.glide_t < 1.0 {
            self.glide_t = (self.glide_t + n as f32 / self.glide_len.max(1.0)).min(1.0);
            self.pitch = self.glide_from + (self.glide_to - self.glide_from) * self.glide_t;
        }
        let pitch = self.pitch + ctx.bend;

        // ── oscillators ──────────────────────────────────────────────────────
        for bus in sc.bus.iter_mut() {
            for ch in bus.iter_mut() {
                ch[..n].iter_mut().for_each(|x| *x = 0.0);
            }
        }
        for o in 0..3 {
            let k = |f: usize| v[osc_key(o, f)];
            let table = ctx.tables[o];
            let on = k(O_ON) >= 0.5 && table.is_some();
            let level = k(O_LEVEL);
            let target = if on { level * level } else { 0.0 };
            let pos = k(O_POS);
            if self.fresh {
                self.osc_gain[o] = target;
                self.osc_pos[o] = pos;
            }
            let (g0, p0) = (self.osc_gain[o], self.osc_pos[o]);
            self.osc_gain[o] = target;
            self.osc_pos[o] = pos;
            let Some(table) = table else { continue };
            if g0 <= 0.0 && target <= 0.0 {
                continue;
            }
            // FM: osc B is the modulator; osc B itself takes osc A. A missing
            // modulator table falls back to the oscillator's own, as the kit
            // falls back to its own frame.
            let other = if o == 1 { 0 } else { 1 };
            let fm = match ctx.tables[other] {
                Some(t) => FmSource { table: t, pos: v[osc_key(other, O_POS)] },
                None => FmSource { table, pos },
            };
            let semis = js_round_f((k(O_PITCH) - 0.5) * 48.0);
            let cents = (k(O_FINE) - 0.5) * 200.0;
            let hz = note_hz(pitch + semis + cents / 100.0);
            let fx_mode = st.fx_modes[o];
            let params = OscParams {
                table,
                pos0: p0,
                pos1: pos,
                warps: [Warp::new(st.warp_modes[o][0], k(O_WARP0)), Warp::new(st.warp_modes[o][1], k(O_WARP1))],
                fm,
                hz,
                uni: k(O_UNI_N) as usize,
                det: k(O_UNI_DET),
                spr: k(O_UNI_SPR),
                pan: (k(O_PAN) - 0.5) * 2.0,
                shaper: Shaper::new(fx_mode, k(O_FX_A), k(O_FX_B)),
                sr,
            };
            let [ol, or] = &mut sc.osc;
            self.osc[o].render(&params, &mut ol[..n], &mut or[..n]);
            self.fx[o].process(fx_mode, k(O_FX_A), k(O_FX_B), sr, &mut ol[..n], &mut or[..n]);
            let bus = match (st.filter_route, o, st.routes[o]) {
                (FilterRoute::Split, 0, _) => BUS_F1,
                (FilterRoute::Split, 1, _) => BUS_F2,
                (_, _, Route::F1) => BUS_F1,
                (_, _, Route::F2) => BUS_F2,
                (_, _, Route::Both) => BUS_BOTH,
                (_, _, Route::Direct) => BUS_DIRECT,
            };
            let dg = (target - g0) / n as f32;
            let mut g = g0;
            for i in 0..n {
                g += dg;
                sc.bus[bus][0][i] += ol[i] * g;
                sc.bus[bus][1][i] += or[i] * g;
            }
        }

        // ── sub and noise, into Filter 1 ─────────────────────────────────────
        let centre = std::f32::consts::FRAC_1_SQRT_2;
        let sub_on = v[SUB_ON] >= 0.5;
        let sub_target = if sub_on { v[SUB_LEVEL] * v[SUB_LEVEL] } else { 0.0 };
        if self.fresh {
            self.sub_gain = sub_target;
        }
        if self.sub_gain > 0.0 || sub_target > 0.0 {
            let shape = (v[SUB_SHAPE] as usize).min(2);
            let oct = v[SUB_OCT].clamp(1.0, 2.0);
            let inc_f = note_hz(pitch - 12.0 * oct) / sr;
            let t = &ctx.sub_tables[shape];
            let (level, _) = mip_for(inc_f);
            let d = t.data(level);
            let inc = (inc_f.clamp(0.0, 0.49) as f64 * 4_294_967_296.0) as u32;
            let (mut g, dg) = (self.sub_gain, (sub_target - self.sub_gain) / n as f32);
            let r = dc_pole(sr);
            for i in 0..n {
                g += dg;
                let p = (self.sub_phase >> 8) as f32 * (FRAME_LEN as f32 / 16_777_216.0);
                let x = herm(d, 0, p as usize & FRAME_MASK, p - p.floor());
                // The square's DC is zero by construction; this only guards
                // against a shape change mid-note leaving an offset.
                self.dc_sub = r * self.dc_sub + (1.0 - r) * x;
                let y = (x - self.dc_sub) * g * centre;
                sc.bus[BUS_F1][0][i] += y;
                sc.bus[BUS_F1][1][i] += y;
                self.sub_phase = self.sub_phase.wrapping_add(inc);
            }
        }
        self.sub_gain = sub_target;

        let noise_target = if v[NOISE_ON] >= 0.5 { v[NOISE_LEVEL] * v[NOISE_LEVEL] } else { 0.0 };
        if self.fresh {
            self.noise_gain = noise_target;
        }
        if self.noise_gain > 0.0 || noise_target > 0.0 {
            let color = (v[NOISE_COLOR] as usize).min(2);
            let (mut g, dg) = (self.noise_gain, (noise_target - self.noise_gain) / n as f32);
            for i in 0..n {
                g += dg;
                let y = self.noise.next(color, &mut self.rng) * g * centre;
                sc.bus[BUS_F1][0][i] += y;
                sc.bus[BUS_F1][1][i] += y;
            }
        }
        self.noise_gain = noise_target;

        // ── filters ──────────────────────────────────────────────────────────
        let fp = |f: usize| {
            let b = FILT_BASE + f * FILT_STRIDE;
            let key = v[b + F_KEY];
            FilterParams {
                typ: st.filter_types[f],
                cut_norm: v[b + F_CUT],
                cut_hz: cutoff_hz(v[b + F_CUT]) * (key * (self.pitch - 60.0) / 12.0).exp2(),
                res: v[b + F_RES],
                drive: v[b + F_DRIVE],
            }
        };
        let (p1, p2) = (fp(0), fp(1));
        let [f1b, f2b, both, direct] = &mut sc.bus;
        match st.filter_route {
            FilterRoute::Serial => {
                for ch in 0..2 {
                    for i in 0..n {
                        f1b[ch][i] += both[ch][i];
                    }
                }
                let [l1, r1] = &mut *f1b;
                self.filt[0].process(&p1, sr, &mut l1[..n], &mut r1[..n]);
                for ch in 0..2 {
                    for i in 0..n {
                        f2b[ch][i] += f1b[ch][i];
                    }
                }
                let [l2, r2] = &mut *f2b;
                self.filt[1].process(&p2, sr, &mut l2[..n], &mut r2[..n]);
                for ch in 0..2 {
                    for i in 0..n {
                        direct[ch][i] += f2b[ch][i];
                    }
                }
            }
            FilterRoute::Parallel | FilterRoute::Split => {
                for ch in 0..2 {
                    for i in 0..n {
                        let h = 0.5 * both[ch][i];
                        f1b[ch][i] += h;
                        f2b[ch][i] += h;
                    }
                }
                let [l1, r1] = &mut *f1b;
                self.filt[0].process(&p1, sr, &mut l1[..n], &mut r1[..n]);
                let [l2, r2] = &mut *f2b;
                self.filt[1].process(&p2, sr, &mut l2[..n], &mut r2[..n]);
                for ch in 0..2 {
                    for i in 0..n {
                        direct[ch][i] += f1b[ch][i] + f2b[ch][i];
                    }
                }
            }
        }

        // ── amp ──────────────────────────────────────────────────────────────
        let (a, d, s, r) = (v[AMP_BASE], v[AMP_BASE + 1], v[AMP_BASE + 2], v[AMP_BASE + 3]);
        self.amp.set(a, d, s, r);
        let steal_step = 1.0 / (STEAL_SECONDS * sr);
        for i in 0..n {
            let e = self.amp.next() * self.vel;
            if self.stealing {
                self.steal_gain = (self.steal_gain - steal_step).max(0.0);
            }
            let g = e * self.steal_gain;
            out_l[i] += direct[0][i] * g;
            out_r[i] += direct[1][i] * g;
        }
        self.fresh = false;
        if !self.amp.is_active() || (self.stealing && self.steal_gain <= 0.0) {
            self.kill();
        }
    }
}

/// The kit's Math.round, for pitch.
#[inline]
fn js_round_f(x: f32) -> f32 {
    (x + 0.5).floor()
}

/// Equal temperament, A4 = 440 Hz.
#[inline]
pub fn note_hz(semitones: f32) -> f32 {
    440.0 * ((semitones - 69.0) / 12.0).exp2()
}

/// Apply the patch's mod rows to `base` with these source values.
pub(crate) fn modulate(base: &[f32; NUM_PARAMS], st: &PatchState, src: &[f32; SRC_COUNT], out: &mut [f32; NUM_PARAMS]) {
    *out = *base;
    let mut acc = [0.0f32; NUM_PARAMS];
    let mut touched = 0u128;
    for row in st.mods() {
        let x = row.curve.apply(src[row.src.index()]);
        let via = row.via.map(|s| src[s.index()]).unwrap_or(1.0);
        let d = row.dst.index();
        acc[d] += row.amt * x * via;
        touched |= 1u128 << d;
    }
    while touched != 0 {
        let d = touched.trailing_zeros() as usize;
        touched &= touched - 1;
        out[d] = denormalise(d, normalise(d, base[d]) + acc[d]);
    }
}
