//! What Wave shows while it plays, for the face to read from another thread:
//! the synth's telemetry (`wave::Synth::telemetry`, what MGL's
//! `/api/wave/state` reports) and the last [`WAVE_POINTS`] samples out.
//!
//! The audio thread writes it every few milliseconds of audio; the app reads
//! it whenever it likes. No lock and no allocation on either side: every
//! value is an atomic word, and a sequence number (odd while a write is under
//! way) tells a reader whether what it read is one whole snapshot. A reader
//! that keeps meeting a write takes what it has after a few tries; for a
//! picture nobody can tell.

use std::sync::atomic::{fence, AtomicU32, Ordering};
use std::sync::Arc;
use wave::board::MAX_NODES;
use wave::choice::CHOICES;
use wave::patch::MAX_MODS;
use wave::{ParamId, Stage, Telemetry, VoiceInfo, MAX_VOICES};

/// Samples of output kept: what the Wave page draws as its live wave.
pub const WAVE_POINTS: usize = 256;

fn word() -> AtomicU32 {
    AtomicU32::new(0)
}

fn words<const N: usize>() -> [AtomicU32; N] {
    std::array::from_fn(|_| word())
}

fn stage_word(s: Stage) -> u32 {
    match s {
        Stage::Idle => 0,
        Stage::Attack => 1,
        Stage::Decay => 2,
        Stage::Sustain => 3,
        Stage::Release => 4,
    }
}

fn word_stage(w: u32) -> Stage {
    match w {
        1 => Stage::Attack,
        2 => Stage::Decay,
        3 => Stage::Sustain,
        4 => Stage::Release,
        _ => Stage::Idle,
    }
}

pub struct WaveView {
    seq: AtomicU32,
    /// Each voice: note, velocity, envelope, stage.
    voices: [[AtomicU32; 4]; MAX_VOICES],
    voice_count: AtomicU32,
    pos: [AtomicU32; 3],
    lfo: [AtomicU32; 4],
    lfo_phase: [AtomicU32; 4],
    /// Each modulated destination: its parameter number and its value.
    mods: [[AtomicU32; 2]; MAX_MODS],
    mod_count: AtomicU32,
    peak: [AtomicU32; 2],
    board: [[AtomicU32; 2]; MAX_NODES],
    board_count: AtomicU32,
    choice: [AtomicU32; CHOICES],
    choice_touched: AtomicU32,
    wave: [AtomicU32; WAVE_POINTS],
}

fn put(a: &AtomicU32, v: f32) {
    a.store(v.to_bits(), Ordering::Relaxed);
}

fn get(a: &AtomicU32) -> f32 {
    f32::from_bits(a.load(Ordering::Relaxed))
}

impl WaveView {
    pub fn new() -> Arc<WaveView> {
        Arc::new(WaveView {
            seq: word(),
            voices: std::array::from_fn(|_| words()),
            voice_count: word(),
            pos: words(),
            lfo: words(),
            lfo_phase: words(),
            mods: std::array::from_fn(|_| words()),
            mod_count: word(),
            peak: words(),
            board: std::array::from_fn(|_| words()),
            board_count: word(),
            choice: words(),
            choice_touched: word(),
            wave: words(),
        })
    }

    /// How many snapshots have been written: it moves while the engine runs.
    pub fn written(&self) -> u32 {
        self.seq.load(Ordering::Acquire) / 2
    }

    /// One snapshot, from the audio thread: `t`, and `ring` (the last
    /// [`WAVE_POINTS`] samples, the oldest at `at`).
    pub(crate) fn write(&self, t: &Telemetry, ring: &[f32; WAVE_POINTS], at: usize) {
        let s = self.seq.load(Ordering::Relaxed);
        self.seq.store(s.wrapping_add(1), Ordering::Relaxed);
        fence(Ordering::Release);
        let nv = t.voice_count.min(MAX_VOICES);
        for (slot, v) in self.voices.iter().zip(&t.voices[..nv]) {
            slot[0].store(v.note as u32, Ordering::Relaxed);
            put(&slot[1], v.vel);
            put(&slot[2], v.env);
            slot[3].store(stage_word(v.stage), Ordering::Relaxed);
        }
        self.voice_count.store(nv as u32, Ordering::Relaxed);
        for (a, v) in self.pos.iter().zip(&t.pos) {
            put(a, *v);
        }
        for (a, v) in self.lfo.iter().zip(&t.lfo) {
            put(a, *v);
        }
        for (a, v) in self.lfo_phase.iter().zip(&t.lfo_phase) {
            put(a, *v);
        }
        let nm = t.mod_count.min(MAX_MODS);
        for (slot, (id, v)) in self.mods.iter().zip(&t.mods[..nm]) {
            slot[0].store(id.0 as u32, Ordering::Relaxed);
            put(&slot[1], *v);
        }
        self.mod_count.store(nm as u32, Ordering::Relaxed);
        for (a, v) in self.peak.iter().zip(&t.peak) {
            put(a, *v);
        }
        let nb = t.board_count.min(MAX_NODES);
        for (slot, p) in self.board.iter().zip(&t.board[..nb]) {
            put(&slot[0], p[0]);
            put(&slot[1], p[1]);
        }
        self.board_count.store(nb as u32, Ordering::Relaxed);
        for (a, c) in self.choice.iter().zip(&t.choice) {
            a.store(*c as u32, Ordering::Relaxed);
        }
        self.choice_touched.store(t.choice_touched, Ordering::Relaxed);
        for (i, a) in self.wave.iter().enumerate() {
            put(a, ring[(at + i) % WAVE_POINTS]);
        }
        self.seq.store(s.wrapping_add(2), Ordering::Release);
    }

    fn read_once(&self, t: &mut Telemetry, wave: &mut [f32; WAVE_POINTS]) {
        let nv = (self.voice_count.load(Ordering::Relaxed) as usize).min(MAX_VOICES);
        for (out, slot) in t.voices[..nv].iter_mut().zip(&self.voices) {
            *out = VoiceInfo {
                note: slot[0].load(Ordering::Relaxed) as u8,
                vel: get(&slot[1]),
                env: get(&slot[2]),
                stage: word_stage(slot[3].load(Ordering::Relaxed)),
            };
        }
        t.voice_count = nv;
        for (o, a) in t.pos.iter_mut().zip(&self.pos) {
            *o = get(a);
        }
        for (o, a) in t.lfo.iter_mut().zip(&self.lfo) {
            *o = get(a);
        }
        for (o, a) in t.lfo_phase.iter_mut().zip(&self.lfo_phase) {
            *o = get(a);
        }
        let nm = (self.mod_count.load(Ordering::Relaxed) as usize).min(MAX_MODS);
        for (o, slot) in t.mods[..nm].iter_mut().zip(&self.mods) {
            *o = (ParamId(slot[0].load(Ordering::Relaxed) as u16), get(&slot[1]));
        }
        t.mod_count = nm;
        for (o, a) in t.peak.iter_mut().zip(&self.peak) {
            *o = get(a);
        }
        let nb = (self.board_count.load(Ordering::Relaxed) as usize).min(MAX_NODES);
        for (o, slot) in t.board[..nb].iter_mut().zip(&self.board) {
            *o = [get(&slot[0]), get(&slot[1])];
        }
        t.board_count = nb;
        for (o, a) in t.choice.iter_mut().zip(&self.choice) {
            *o = a.load(Ordering::Relaxed) as u8;
        }
        t.choice_touched = self.choice_touched.load(Ordering::Relaxed);
        for (o, a) in wave.iter_mut().zip(&self.wave) {
            *o = get(a);
        }
    }

    /// The latest snapshot into `t` and `wave` (oldest sample first). Returns
    /// [`WaveView::written`] as it was then.
    pub fn read(&self, t: &mut Telemetry, wave: &mut [f32; WAVE_POINTS]) -> u32 {
        let mut s1 = 0;
        for _ in 0..16 {
            s1 = self.seq.load(Ordering::Acquire);
            if s1 & 1 == 1 {
                std::hint::spin_loop();
                continue;
            }
            self.read_once(t, wave);
            fence(Ordering::Acquire);
            if self.seq.load(Ordering::Relaxed) == s1 {
                return s1 / 2;
            }
        }
        // Writes kept landing: take what there is.
        self.read_once(t, wave);
        s1 / 2
    }
}
