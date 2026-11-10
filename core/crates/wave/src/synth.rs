//! The instrument: a fixed bank of voices, the patch they share, and the
//! calls the engine makes from the audio thread.
//!
//! # Real time
//!
//! `Synth::new` allocates everything the synth will ever use: 40 voice slots,
//! each with its effect lines and comb buffers, the sub-oscillator tables and
//! the work space. After that, [`Synth::render`], [`Synth::note_on`],
//! [`Synth::note_off`], [`Synth::set_param`], [`Synth::set_table`],
//! [`Synth::adopt`] and the controller calls never allocate, never lock and
//! never transform. A `tests/no_alloc.rs` test holds them to that with a
//! counting allocator.
//!
//! Two handovers make that possible, in the engine's `pending_*` style:
//! - a table is built off the audio thread ([`Wavetable::from_frames`]) and
//!   handed in as an `Arc`; [`Synth::set_table`] gives back the one it
//!   replaced, so the caller drops it on its own thread;
//! - a patch is compiled off the audio thread into a [`PatchState`], which is
//!   plain data, and [`Synth::adopt`] copies it in.
//!
//! # Live parameters
//!
//! [`Synth::set_param`] sets a target. Continuous keys glide to it with a
//! 15 ms one-pole, stepped once per control block, and the voices ramp what
//! they derive from it across each block (see `voice.rs`), so a jump from one
//! end of a knob to the other is a fast fade, not a click. Switches and whole
//! numbers take effect at the next block. Adopting a patch glides the same way
//! while notes sound, and snaps when nothing does.
//!
//! # The bank
//!
//! Ported from idMLab's `bank.rs`. Polyphony is 32 held notes. When a 33rd
//! arrives the oldest held note is stolen: it fades over 5 ms rather than
//! stopping dead. There are 8 more slots than the polyphony so that fading
//! voices and release tails have somewhere to ring; only when all 40 are busy
//! is a voice cut outright, the oldest released one first. A key struck again
//! lets its sounding voice go into its release and starts a new one, as idMLab
//! does. Velocity 0 is a note-off, as MIDI has it.
//!
//! Mono and legato use one voice. A held-note stack (most recent wins) brings
//! the voice back to the previous key when the current one is let go. Mono
//! retriggers the envelopes from where they are on every new note; legato
//! retriggers only when no key was held.
//!
//! # Oversampling
//!
//! Off by default. [`Synth::with_oversampling`] runs every voice at twice the
//! rate and brings the mix down through a 63-tap Kaiser half-band filter
//! (flat to 19.6 kHz at 48 kHz, −90 dB from 28.4 kHz). The mip levels are
//! chosen for the doubled rate, so the extra headroom goes to the warps and
//! cycle effects, which are not band-limited by the tables.
//!
//! # The master chain
//!
//! After `master` (and after the half-band, when oversampling), each block
//! goes through the FX view's chain at the output rate (`master_fx.rs`). It
//! reads the same smoothed values the voices do, so a live move or an adopted
//! patch drives it with the same glide. Its tails ring on after the last voice.
//!
//! # Modulation that is not a voice's
//!
//! Every numeric key is a target, the free LFOs' own included. A voice hears
//! the matrix through its own sources (`voice.rs`). What every voice shares —
//! the free LFOs, and the board's controls — hears it once per control block
//! through `gsrc`: this block's macros, mod wheel and aftertouch, the free
//! LFOs as the last block left them, and the per-note sources of the newest
//! sounding voice (0 when nothing sounds). So LFO 1 → LFO 2 Rate with LFO 2 →
//! LFO 1 Rate is a loop one block late by definition, never solved within a
//! block, and it is stable.
//!
//! # Determinism
//!
//! The only randomness is the voices' start phases, noise and `rand` source,
//! all drawn from xorshift seeded by [`Synth::set_seed`] and the note's number
//! in the performance. The chain has none. The same performance renders to
//! the same bits.

use std::sync::Arc;

use crate::env::Stage;
use crate::master_fx::MasterFx;
use crate::patch::*;
use crate::table::Wavetable;
use crate::voice::{modulate, BlockCtx, Scratch, Voice, BLOCK};

/// Held notes before stealing begins.
pub const POLYPHONY: usize = 32;
/// Voice slots: the polyphony plus room for tails and stolen voices fading.
pub const MAX_VOICES: usize = 40;
/// Parameter smoothing time constant.
const SMOOTH_SECONDS: f32 = 0.015;
const DEFAULT_SEED: u32 = 0x2545_F491;

/// One sounding voice, for the page.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct VoiceInfo {
    pub note: u8,
    pub vel: f32,
    /// The amp envelope's level, 0..1.
    pub env: f32,
    pub stage: Stage,
}

/// What `/api/wave/state` reports, in fixed arrays.
#[derive(Clone, Copy, Debug)]
pub struct Telemetry {
    pub voices: [VoiceInfo; MAX_VOICES],
    pub voice_count: usize,
    /// Each oscillator's frame position after modulation (the newest voice's).
    pub pos: [f32; 3],
    /// The four LFOs, −1..1, as the newest voice hears them (after its Rise
    /// and Smooth), or the free-running ones when nothing sounds.
    pub lfo: [f32; 4],
    /// The four LFOs' phases, 0..1, which is what the page draws its dots at:
    /// a free LFO's own, a per-note one's from the newest voice.
    pub lfo_phase: [f32; 4],
    /// Each modulated destination and its value after modulation, in the
    /// key's own units: the newest voice's, or the patch's own sources when
    /// nothing sounds.
    pub mods: [(ParamId, f32); MAX_MODS],
    pub mod_count: usize,
    /// Output peaks with a ~300 ms fall.
    pub peak: [f32; 2],
}

impl Default for Telemetry {
    fn default() -> Self {
        Telemetry {
            voices: [VoiceInfo::default(); MAX_VOICES],
            voice_count: 0,
            pos: [0.0; 3],
            lfo: [0.0; 4],
            lfo_phase: [0.0; 4],
            mods: [(ParamId(0), 0.0); MAX_MODS],
            mod_count: 0,
            peak: [0.0; 2],
        }
    }
}

impl Telemetry {
    pub fn voices(&self) -> &[VoiceInfo] {
        &self.voices[..self.voice_count]
    }
    pub fn mods(&self) -> &[(ParamId, f32)] {
        &self.mods[..self.mod_count]
    }
}

/// Keys held, most recent last, for mono and legato.
struct NoteStack {
    notes: [u8; 32],
    len: usize,
}

impl NoteStack {
    fn remove(&mut self, note: u8) {
        if let Some(i) = self.notes[..self.len].iter().position(|n| *n == note) {
            self.notes.copy_within(i + 1..self.len, i);
            self.len -= 1;
        }
    }
    fn push(&mut self, note: u8) {
        self.remove(note);
        if self.len == self.notes.len() {
            self.notes.copy_within(1.., 0);
            self.len -= 1;
        }
        self.notes[self.len] = note;
        self.len += 1;
    }
    fn top(&self) -> Option<u8> {
        self.len.checked_sub(1).map(|i| self.notes[i])
    }
}

/// The 63-tap half-band decimator.
struct HalfBand {
    taps: [f32; 63],
    hist: [f32; 128],
    w: usize,
}

impl HalfBand {
    fn new() -> HalfBand {
        let n = 63;
        let beta = 9.0f64;
        let i0 = |x: f64| {
            let (mut sum, mut term) = (1.0f64, 1.0f64);
            for k in 1..40 {
                term *= (x / 2.0) / k as f64;
                sum += term * term;
            }
            sum
        };
        let mut taps = [0.0f32; 63];
        let c = (n - 1) as f64 / 2.0;
        let mut total = 0.0;
        for (i, t) in taps.iter_mut().enumerate() {
            let m = i as f64 - c;
            let sinc = if m == 0.0 { 0.5 } else { (std::f64::consts::PI * m * 0.5).sin() / (std::f64::consts::PI * m) };
            let r = m / c;
            let w = i0(beta * (1.0 - r * r).max(0.0).sqrt()) / i0(beta);
            *t = (sinc * w) as f32;
            total += sinc * w;
        }
        for t in taps.iter_mut() {
            *t /= total as f32;
        }
        HalfBand { taps, hist: [0.0; 128], w: 0 }
    }

    #[inline]
    fn push(&mut self, x: f32) {
        self.hist[self.w] = x;
        self.w = (self.w + 1) & 127;
    }

    /// The filtered sample at the newest input.
    #[inline]
    fn out(&self) -> f32 {
        let mut y = 0.0;
        for (k, t) in self.taps.iter().enumerate() {
            // Every other tap of a half-band is zero, bar the centre.
            if k != 31 && (k % 2) == 1 {
                continue;
            }
            y += t * self.hist[(self.w + 127 - k) & 127];
        }
        y
    }
}

pub struct Synth {
    /// The rate the voices run at (twice the output's when oversampling).
    sr: f32,
    out_sr: f32,
    oversample: bool,
    max_block: usize,
    state: PatchState,
    target: [f32; NUM_PARAMS],
    cur: [f32; NUM_PARAMS],
    tables: [Option<Arc<Wavetable>>; 3],
    sub_tables: Box<[Wavetable; 3]>,
    voices: Vec<Voice>,
    scratch: Box<Scratch>,
    serial: u64,
    seed: u32,
    free_phase: [f32; 4],
    /// Whole cycles each free LFO has run, for the random waves.
    free_cycle: [u32; 4],
    global: [f32; SRC_COUNT],
    /// The sources a target that is not a voice's hears (see "Modulation").
    gsrc: [f32; SRC_COUNT],
    /// Every key after modulation by `gsrc`: what the free LFOs run on.
    gvals: [f32; NUM_PARAMS],
    bend: [f32; 2],
    mw: [f32; 2],
    at: [f32; 2],
    stack: NoteStack,
    mono: Option<usize>,
    mix: [[f32; BLOCK]; 2],
    master: f32,
    peak: [f32; 2],
    half: [HalfBand; 2],
    /// The master chain, at the output rate.
    chain: MasterFx,
}

impl Synth {
    /// A synth at `sample_rate`, with the default patch and no tables.
    /// `max_block` is the longest buffer the host will pass; `render` takes any
    /// length, working through it in control blocks.
    pub fn new(sample_rate: f32, max_block: usize) -> Synth {
        Synth::with_oversampling(sample_rate, max_block, false)
    }

    /// The same, running the voices at twice the rate when `oversample` is set.
    pub fn with_oversampling(sample_rate: f32, max_block: usize, oversample: bool) -> Synth {
        let out_sr = if sample_rate.is_finite() && sample_rate > 0.0 { sample_rate } else { 48_000.0 };
        let sr = if oversample { out_sr * 2.0 } else { out_sr };
        let state = PatchState::default();
        let sub = |f: fn(f32) -> f32| {
            let frame: Vec<f32> = (0..crate::table::FRAME_LEN).map(|i| f(i as f32 / crate::table::FRAME_LEN as f32)).collect();
            Wavetable::from_frames(&[frame])
        };
        let sub_tables = Box::new([
            sub(|x| (std::f32::consts::TAU * x).sin()),
            sub(|x| 1.0 - 4.0 * (x - 0.25 - (x - 0.25 + 0.5).floor() + 0.5).abs()),
            sub(|x| if x < 0.5 { 1.0 } else { -1.0 }),
        ]);
        let mut synth = Synth {
            sr,
            out_sr,
            oversample,
            max_block,
            state,
            target: state.values,
            cur: state.values,
            tables: [None, None, None],
            sub_tables,
            voices: (0..MAX_VOICES).map(|_| Voice::new(sr)).collect(),
            scratch: Box::new(Scratch::new()),
            serial: 0,
            seed: DEFAULT_SEED,
            free_phase: [0.0; 4],
            free_cycle: [0; 4],
            global: [0.0; SRC_COUNT],
            gsrc: [0.0; SRC_COUNT],
            gvals: state.values,
            bend: [0.0; 2],
            mw: [0.0; 2],
            at: [0.0; 2],
            stack: NoteStack { notes: [0; 32], len: 0 },
            mono: None,
            mix: [[0.0; BLOCK]; 2],
            master: 0.0,
            peak: [0.0; 2],
            half: [HalfBand::new(), HalfBand::new()],
            chain: MasterFx::new(out_sr, &state.values),
        };
        synth.master = synth.cur[MASTER] * synth.cur[MASTER];
        synth
    }

    pub fn sample_rate(&self) -> f32 {
        self.out_sr
    }

    pub fn is_oversampled(&self) -> bool {
        self.oversample
    }

    pub fn max_block(&self) -> usize {
        self.max_block
    }

    /// Seed the voices' randomness. Takes effect from the next note.
    pub fn set_seed(&mut self, seed: u32) {
        self.seed = seed;
    }

    /// Take a compiled patch. Values glide if notes are sounding, snap if not;
    /// modes, routing, shapes and mod rows change at once.
    pub fn adopt(&mut self, state: PatchState) {
        let idle = self.voices.iter().all(|v| !v.active);
        self.state = state;
        self.target = state.values;
        for (i, k) in KEYS.iter().enumerate() {
            if idle || k.kind != Kind::Smooth {
                self.cur[i] = self.target[i];
            }
        }
        if idle {
            self.master = self.cur[MASTER] * self.cur[MASTER];
        }
        if state.voice_mode == VoiceMode::Poly {
            self.mono = None;
        }
    }

    /// The compiled patch in use, with its values as last set.
    pub fn state(&self) -> PatchState {
        let mut s = self.state;
        s.values = self.target;
        s
    }

    pub fn param_id(&self, key: &str) -> Option<ParamId> {
        param_id(key)
    }

    /// Set a numeric key live. False for an unknown id or a value that is
    /// not a number; the value is clamped to the key's range.
    pub fn set_param(&mut self, id: ParamId, v: f32) -> bool {
        let i = id.index();
        if i >= NUM_PARAMS {
            return false;
        }
        let Some(v) = clamp_value(i, v) else { return false };
        self.target[i] = v;
        if KEYS[i].kind != Kind::Smooth {
            self.cur[i] = v;
        }
        true
    }

    /// Hand a table to an oscillator. The table it had comes back, for the
    /// caller to drop off the audio thread. An oscillator index past 2 gives
    /// the new table straight back.
    pub fn set_table(&mut self, osc: usize, table: Arc<Wavetable>) -> Option<Arc<Wavetable>> {
        match self.tables.get_mut(osc) {
            Some(slot) => slot.replace(table),
            None => Some(table),
        }
    }

    /// Take an oscillator's table away; it falls silent.
    pub fn take_table(&mut self, osc: usize) -> Option<Arc<Wavetable>> {
        self.tables.get_mut(osc).and_then(Option::take)
    }

    pub fn table(&self, osc: usize) -> Option<&Arc<Wavetable>> {
        self.tables.get(osc).and_then(Option::as_ref)
    }

    /// Pitch bend, −1..1, scaled by `voice.bend` semitones.
    pub fn bend(&mut self, v: f32) {
        if v.is_finite() {
            self.bend[1] = v.clamp(-1.0, 1.0);
        }
    }

    pub fn mod_wheel(&mut self, v: f32) {
        if v.is_finite() {
            self.mw[1] = v.clamp(0.0, 1.0);
        }
    }

    /// Channel aftertouch, 0..1.
    pub fn aftertouch(&mut self, v: f32) {
        if v.is_finite() {
            self.at[1] = v.clamp(0.0, 1.0);
        }
    }

    fn glide_seconds(&self) -> f32 {
        let g = self.cur[GLIDE];
        g * g * 2.0
    }

    /// The oldest of the voices `pick` accepts.
    fn oldest(&self, pick: impl Fn(&Voice) -> bool) -> Option<usize> {
        self.voices.iter().enumerate().filter(|(_, v)| v.active && pick(v)).min_by_key(|(_, v)| v.serial).map(|(i, _)| i)
    }

    fn claim(&mut self) -> usize {
        let held = self.voices.iter().filter(|v| v.active && !v.released).count();
        if held >= POLYPHONY {
            if let Some(i) = self.oldest(|v| !v.released) {
                self.voices[i].steal();
            }
        }
        if let Some(i) = self.voices.iter().position(|v| !v.active) {
            return i;
        }
        let i = self.oldest(|v| v.released).or_else(|| self.oldest(|_| true)).unwrap_or(0);
        self.voices[i].kill();
        i
    }

    /// A note, `vel` 0..1. Velocity 0 is a note-off.
    pub fn note_on(&mut self, note: u8, vel: f32) {
        if vel.is_nan() || vel <= 0.0 {
            self.note_off(note);
            return;
        }
        let note = note.min(127);
        let vel = vel.min(1.0);
        self.serial += 1;
        let serial = self.serial;
        match self.state.voice_mode {
            VoiceMode::Poly => {
                self.release_note(note, None);
                let i = self.claim();
                self.voices[i].start(note, vel, serial, self.seed, &self.cur);
            }
            mode => {
                self.stack.push(note);
                let glide = self.glide_seconds();
                let sr = self.sr;
                match self.mono.filter(|&i| self.voices[i].active && !self.voices[i].stealing) {
                    Some(i) => {
                        let v = &mut self.voices[i];
                        let legato = mode == VoiceMode::Legato && !v.released;
                        v.retarget(note, vel, serial, glide, sr, !legato);
                    }
                    None => {
                        let i = self.claim();
                        self.voices[i].start(note, vel, serial, self.seed, &self.cur);
                        self.mono = Some(i);
                    }
                }
            }
        }
    }

    /// Release every voice holding `note`, except `keep`.
    fn release_note(&mut self, note: u8, keep: Option<usize>) {
        for (i, v) in self.voices.iter_mut().enumerate() {
            if Some(i) != keep && v.active && v.note == note && !v.released {
                v.release();
            }
        }
    }

    pub fn note_off(&mut self, note: u8) {
        match self.state.voice_mode {
            VoiceMode::Poly => self.release_note(note, None),
            _ => {
                self.stack.remove(note);
                let glide = self.glide_seconds();
                let sr = self.sr;
                let serial = self.serial;
                if let Some(i) = self.mono {
                    let back = self.stack.top();
                    let v = &mut self.voices[i];
                    if v.active && v.note == note && !v.released {
                        match back {
                            Some(prev) => {
                                let vel = v.vel;
                                v.retarget(prev, vel, serial, glide, sr, false);
                            }
                            None => v.release(),
                        }
                    }
                }
                // Voices left from poly playing still let go.
                let keep = self.mono;
                self.release_note(note, keep);
            }
        }
    }

    /// Release everything; tails ring out.
    pub fn all_notes_off(&mut self) {
        self.stack.len = 0;
        for v in self.voices.iter_mut() {
            v.release();
        }
    }

    /// Silence everything now, the master chain's tails with it.
    pub fn panic(&mut self) {
        self.stack.len = 0;
        self.mono = None;
        for v in self.voices.iter_mut() {
            v.kill();
        }
        self.chain.reset();
    }

    /// Voices sounding, including tails.
    pub fn active_voices(&self) -> usize {
        self.voices.iter().filter(|v| v.active).count()
    }

    /// Render into `left` and `right`, overwriting them.
    pub fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = left.len().min(right.len());
        let step = if self.oversample { BLOCK / 2 } else { BLOCK };
        let mut done = 0;
        let mut pk = [0.0f32; 2];
        while done < n {
            let len = step.min(n - done);
            if self.oversample {
                self.block(len * 2);
                for i in 0..len {
                    for ch in 0..2 {
                        let h = &mut self.half[ch];
                        h.push(self.mix[ch][2 * i]);
                        h.push(self.mix[ch][2 * i + 1]);
                    }
                    left[done + i] = self.half[0].out();
                    right[done + i] = self.half[1].out();
                }
            } else {
                self.block(len);
                left[done..done + len].copy_from_slice(&self.mix[0][..len]);
                right[done..done + len].copy_from_slice(&self.mix[1][..len]);
            }
            // The knobs as this block's glide left them.
            self.chain.process(&self.cur, &mut left[done..done + len], &mut right[done..done + len]);
            for i in done..done + len {
                pk[0] = pk[0].max(left[i].abs());
                pk[1] = pk[1].max(right[i].abs());
            }
            done += len;
        }
        let fall = (-(n as f32) / (0.3 * self.out_sr)).exp();
        for (p, k) in self.peak.iter_mut().zip(pk) {
            *p = (*p * fall).max(k);
        }
        if n < left.len() {
            left[n..].iter_mut().for_each(|v| *v = 0.0);
        }
        if n < right.len() {
            right[n..].iter_mut().for_each(|v| *v = 0.0);
        }
    }

    /// Fill `gsrc`: this block's macros, mod wheel and aftertouch, each free
    /// LFO as it was at the end of the last block, and the per-note sources
    /// (ENV 2–4, velocity, note, rand and the per-note LFOs) of the newest
    /// voice still sounding, or 0 when none is. Every one of them is as of the
    /// last block or this one, never this block's later work, which is what
    /// makes a loop of LFOs moving each other's rates one block late and
    /// stable.
    fn global_sources(&mut self) {
        let newest = self.voices.iter().filter(|v| v.active && !v.stealing).max_by_key(|v| (!v.released, v.serial));
        for i in 0..SRC_COUNT {
            let free_lfo = (SRC_LFO..SRC_LFO + 4).contains(&i) && self.state.lfo_modes[i - SRC_LFO] == LfoMode::Free;
            self.gsrc[i] = if Source(i as u8).is_global() || free_lfo {
                self.global[i]
            } else {
                newest.map_or(0.0, |v| v.src[i])
            };
        }
    }

    /// One control block of `len` samples at the voice rate, into `mix`.
    fn block(&mut self, len: usize) {
        let sr = self.sr;
        let a = 1.0 - (-(len as f32) / (SMOOTH_SECONDS * sr)).exp();
        for (i, k) in KEYS.iter().enumerate() {
            if k.kind == Kind::Smooth {
                self.cur[i] += (self.target[i] - self.cur[i]) * a;
            } else {
                self.cur[i] = self.target[i];
            }
        }
        for c in [&mut self.bend, &mut self.mw, &mut self.at] {
            c[0] += (c[1] - c[0]) * a;
        }
        for m in 0..8 {
            self.global[SRC_MACRO + m] = self.cur[MACRO_BASE + m];
        }
        self.global[SRC_MW] = self.mw[0];
        self.global[SRC_AT] = self.at[0];
        self.global_sources();
        modulate(&self.cur, &self.state, &self.gsrc, &mut self.gvals);
        for l in 0..4 {
            let p = self.free_phase[l] + lfo_hz(&self.gvals, l) * len as f32 / sr;
            let whole = p.floor();
            self.free_cycle[l] = self.free_cycle[l].wrapping_add(whole as u32);
            self.free_phase[l] = p - whole;
            self.global[SRC_LFO + l] = self.state.lfo_shapes[l].value(self.free_phase[l], self.free_cycle[l]) * 2.0 - 1.0;
        }
        for ch in self.mix.iter_mut() {
            ch[..len].iter_mut().for_each(|v| *v = 0.0);
        }
        let ctx = BlockCtx {
            sr,
            len,
            state: &self.state,
            base: &self.cur,
            global: &self.global,
            tables: [self.tables[0].as_deref(), self.tables[1].as_deref(), self.tables[2].as_deref()],
            sub_tables: &self.sub_tables,
            bend: self.bend[0] * self.cur[BEND],
        };
        let [ml, mr] = &mut self.mix;
        for v in self.voices.iter_mut() {
            v.block(&ctx, &mut self.scratch, &mut ml[..len], &mut mr[..len]);
        }
        let g = self.cur[MASTER] * self.cur[MASTER];
        let dg = (g - self.master) / len as f32;
        let mut m = self.master;
        for i in 0..len {
            m += dg;
            ml[i] *= m;
            mr[i] *= m;
        }
        self.master = g;
        if self.mono.is_some_and(|i| !self.voices[i].active) {
            self.mono = None;
        }
    }

    /// Fill `out` with what the page draws. No allocation.
    pub fn telemetry(&self, out: &mut Telemetry) {
        out.voice_count = 0;
        for v in self.voices.iter().filter(|v| v.active) {
            out.voices[out.voice_count] =
                VoiceInfo { note: v.note, vel: v.vel, env: v.amp.value(), stage: v.stage() };
            out.voice_count += 1;
        }
        let newest = self
            .voices
            .iter()
            .filter(|v| v.active && !v.stealing)
            .max_by_key(|v| (!v.released, v.serial));
        let mut global_vals = [0.0f32; NUM_PARAMS];
        let vals: &[f32; NUM_PARAMS] = match newest {
            Some(v) => &v.vals,
            None => {
                let mut src = [0.0f32; SRC_COUNT];
                for (i, s) in src.iter_mut().enumerate() {
                    if Source(i as u8).is_global() || (SRC_LFO..SRC_LFO + 4).contains(&i) {
                        *s = self.global[i];
                    }
                }
                modulate(&self.cur, &self.state, &src, &mut global_vals);
                &global_vals
            }
        };
        for o in 0..3 {
            out.pos[o] = vals[osc_key(o, O_POS)];
        }
        for l in 0..4 {
            // The newest voice's, whatever the mode: a free LFO's value is
            // the same for every voice until its Rise and Smooth shape it.
            out.lfo[l] = match newest {
                None => self.global[SRC_LFO + l],
                Some(v) => v.src[SRC_LFO + l],
            };
            out.lfo_phase[l] = match (self.state.lfo_modes[l], newest) {
                (LfoMode::Free, _) | (_, None) => self.free_phase[l],
                (_, Some(v)) => v.lfo_phase[l],
            };
        }
        out.mod_count = 0;
        let mut seen = 0u128;
        for row in self.state.mods() {
            let d = row.dst.index();
            if seen & (1u128 << d) != 0 {
                continue;
            }
            seen |= 1u128 << d;
            out.mods[out.mod_count] = (row.dst, vals[d]);
            out.mod_count += 1;
        }
        out.peak = self.peak;
    }
}
