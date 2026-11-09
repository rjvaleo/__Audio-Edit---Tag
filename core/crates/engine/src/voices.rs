//! Poly on the Grain page: a full engine per held key (`docs/GRAIN-SYNTH.md`
//! arrives with the cut-over; until then `grain-redesign/BUILD-PLAN.md`).
//!
//! `keys.rs` is Mono and Legato: one head, the deck's own [`Stretcher`], and
//! AMP on the block. This is the third mode. Every key goes to a voice of its
//! own, with its own read head starting at Start, its own pitch, its own AMP,
//! going round the region for as long as it is held. The voices are summed
//! before the deck's feedback and before the rack (RJ, 8 Nov 2026: "all modules
//! should be able to play polyphonically"), so effect tails ring on over them
//! the way they do over one note.
//!
//! # What a voice is
//!
//! A [`Stretcher::voice`]: the one engine this document uses, its layers, and a
//! grain cloud, at one note's semitones. That is the same code the transport
//! runs, so a note sounds as the document does. A phase vocoder is far heavier
//! than a grain stream, so there is no one number of voices: see below.
//!
//! # Nothing here allocates on the audio thread
//!
//! [`VoiceFeed`] sits in [`Shared`]. A voice is built on another thread
//! ([`spawn_feeder`], or [`stock`] when something wants them up front) and
//! reaches [`Poly`] through a `try_lock`; one of the wrong shape leaves the same
//! way, to be dropped elsewhere. An empty pool only makes a note wait a moment.
//!
//! # How many
//!
//! As many as it can carry (RJ): no number is fixed. Each block the voices'
//! cost is measured per voice, and [`cap_for`] answers how many fit in what the
//! rest of the block has left. Past that the oldest is faded out over a few
//! milliseconds, without a click, for the new one. Blocks that really do miss
//! their deadline shed a voice each time the evidence mounts up, by the rule
//! `Shared::govern` keeps for layers.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Instant;

use fx::grain::{GrainEvent, StreamParams};
use fx::hstream::Parts;
use fx::stretch::Algorithm;
use fx::transient::TimeMap;

use crate::keys::KeyPlayer;
use crate::render::Source;
use crate::stretcher::Stretcher;
use crate::transport::{loop_fade, report, Shared};

/// How many voices the pool can list. A slot is a pointer, so this is not a
/// polyphony: it is only so that the lists are sized once.
const POOL_SLOTS: usize = 1024;
/// How many note-ons can be waiting at once. One per key.
const PENDING_SLOTS: usize = 128;
/// How long a stolen voice takes to go, in seconds: short enough that a new
/// note is not late, long enough that nothing clicks.
const STEAL_SECONDS: f32 = 0.012;
/// The fade in of a new voice's head, as `keys.rs`, in seconds.
const FADE_IN_SECONDS: f32 = 0.005;
/// Below this AMP has finished and the voice can go.
const AMP_SILENT: f32 = 1e-4;
/// The share of a block the voices may take, with room left for whatever comes.
const TARGET_LOAD: f32 = 0.70;
/// What a voice is reckoned to cost before one has been measured, by engine, as
/// a share of a block: from the `poly_cost` test on this machine, rounded up.
const SEED_COST: [f32; 5] = [0.01, 0.03, 0.03, 0.06, 0.08];

fn alg_index(a: Algorithm) -> usize {
    match a {
        Algorithm::Wsola => 1,
        Algorithm::Vocoder => 2,
        Algorithm::Pvsola => 3,
        Algorithm::Hybrid => 4,
        _ => 0,
    }
}

/// How many to keep ready by engine: the cheap ones in quantity, because they
/// are what a chord asks for, the costly ones as many as have been seen to fit.
fn spare_for(a: Algorithm) -> usize {
    match a {
        Algorithm::Granular => 12,
        Algorithm::Wsola | Algorithm::Vocoder => 8,
        _ => 4,
    }
}

/// How many new heads a block may start. A seek clears a voice's rings, which
/// on Hybrid is several megabytes of memset, and a chord of them in one block
/// is what would be late.
fn starts_for(a: Algorithm) -> usize {
    match a {
        Algorithm::Granular => 16,
        Algorithm::Wsola | Algorithm::Vocoder => 4,
        _ => 1,
    }
}

/// What a voice was built to play.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Shape {
    algorithm: Algorithm,
    layers: u32,
}

impl Shape {
    fn of(p: &StreamParams) -> Shape {
        let algorithm = p.algorithm;
        // A cloud's layers live inside its renderer and cost no extra engine.
        let layers = if algorithm == Algorithm::Granular { 1 } else { p.grain.layers.max(1) };
        Shape { algorithm, layers }
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Stage {
    Attack,
    Decay,
    Release,
}

struct Voice {
    engine: Stretcher,
    shape: Shape,
    key: u8,
    id: u32,
    vel: f32,
    level: f32,
    stage: Stage,
    attack_step: f32,
    release_tau: f32,
    /// Frames left of the steal, and of the fade in.
    steal_left: u32,
    steal_len: u32,
    fade_left: u32,
    fade_len: u32,
    /// Frames left of the rising side of a seam, after a wrap.
    seam_in: u32,
    seam_len: u32,
    scan: f32,
    /// Semitones it is playing at, for the read-back.
    semis: f32,
}

impl Voice {
    fn build(shape: Shape, max_block: usize, channels: usize, sp: &StreamParams) -> Box<Voice> {
        let mut engine = Stretcher::voice(shape.algorithm, shape.layers, max_block, channels, sp.sample_rate);
        // The first seek touches every page it will use, here rather than on the
        // first note.
        engine.seek(0, sp);
        Box::new(Voice {
            engine,
            shape,
            key: 0,
            id: 0,
            vel: 1.0,
            level: 0.0,
            stage: Stage::Release,
            attack_step: 0.0,
            release_tau: 1.0,
            steal_left: 0,
            steal_len: 0,
            fade_left: 0,
            fade_len: 0,
            seam_in: 0,
            seam_len: 0,
            scan: 1.0,
            semis: 0.0,
        })
    }

    fn stealing(&self) -> bool {
        self.steal_left > 0
    }

    fn released(&self) -> bool {
        self.stage == Stage::Release
    }

    fn release(&mut self, seconds: f32) {
        self.release_tau = seconds / 4.0 + 0.002;
        self.stage = Stage::Release;
    }

    fn steal(&mut self, frames: u32) {
        if !self.stealing() {
            self.steal_left = frames.max(1);
            self.steal_len = self.steal_left;
        }
    }
}

/// One note, as the Grain page should draw it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Head {
    pub key: u8,
    pub voice: u32,
    /// Where it is reading, in source frames.
    pub src: f32,
    /// AMP and velocity, 0..1.
    pub env: f32,
}

/// The voices' half of [`Shared`]: everything the other threads can see or do.
pub struct VoiceFeed {
    ready: Mutex<Vec<Box<Voice>>>,
    retired: Mutex<Vec<Box<Voice>>>,
    retired_parts: Mutex<Vec<Arc<Parts>>>,
    heads: Mutex<Vec<Head>>,
    /// Poly is selected, so the feeder should keep some ready.
    want: AtomicBool,
    /// Voices of the right shape waiting on the audio thread.
    free: AtomicU32,
    live: AtomicU32,
    pending: AtomicU32,
    running: AtomicU32,
    cap: AtomicU32,
    /// A ceiling set by hand, for a test or a slow machine. Nought is none.
    ceiling: AtomicU32,
    /// An export: there is no deadline, and every voice asked for is played.
    offline: AtomicBool,
    cost_ppm: [AtomicU32; 5],
}

impl VoiceFeed {
    pub fn new() -> VoiceFeed {
        VoiceFeed {
            ready: Mutex::new(Vec::with_capacity(POOL_SLOTS)),
            retired: Mutex::new(Vec::with_capacity(POOL_SLOTS)),
            retired_parts: Mutex::new(Vec::with_capacity(16)),
            heads: Mutex::new(Vec::with_capacity(POOL_SLOTS)),
            want: AtomicBool::new(false),
            free: AtomicU32::new(0),
            live: AtomicU32::new(0),
            pending: AtomicU32::new(0),
            running: AtomicU32::new(0),
            cap: AtomicU32::new(u32::MAX),
            ceiling: AtomicU32::new(0),
            offline: AtomicBool::new(false),
            cost_ppm: Default::default(),
        }
    }

    /// Where every note is reading, as of the last block.
    pub fn heads(&self) -> Vec<Head> {
        self.heads.lock().map(|g| g.clone()).unwrap_or_default()
    }

    /// How many voices the last block ran.
    pub fn running(&self) -> u32 {
        self.running.load(Ordering::Relaxed)
    }

    /// How many the governor says fit.
    pub fn cap(&self) -> u32 {
        self.cap.load(Ordering::Relaxed)
    }

    /// What a voice of this engine has been costing, as a share of a block.
    pub fn cost(&self, a: Algorithm) -> f32 {
        self.cost_ppm[alg_index(a)].load(Ordering::Relaxed) as f32 / 1_000_000.0
    }

    /// Hold the voices to `n`. Nought gives the governor its head back.
    pub fn set_ceiling(&self, n: u32) {
        self.ceiling.store(n, Ordering::Relaxed);
    }

    /// An export: play every voice, and take no notice of how long it takes.
    pub fn set_offline(&self, on: bool) {
        self.offline.store(on, Ordering::Relaxed);
    }

    fn stock_of(&self) -> usize {
        self.free.load(Ordering::Relaxed) as usize + self.ready.lock().map_or(0, |g| g.len())
    }
}

impl Default for VoiceFeed {
    fn default() -> Self {
        VoiceFeed::new()
    }
}

/// How many voices fit: what is left of the target once everything else in the
/// block has been paid for, over what a voice costs.
pub fn cap_for(block_load: f32, voice_load: f32, per_voice: f32) -> u32 {
    let other = (block_load - voice_load).max(0.0);
    let room = (TARGET_LOAD - other).max(0.0);
    ((room / per_voice.max(1e-4)).floor() as u32).max(1)
}

/// Build one voice if the pool is short, and drop what has been retired. `true`
/// if there is more to do straight away. Allocates; never the audio thread.
pub fn feed(shared: &Shared, max_block: usize, channels: usize) -> bool {
    let f = &shared.voices;
    // Dropped out here so no lock is held across a free of many megabytes.
    // Drained rather than taken: the lists keep their capacity for the callback.
    let retired: Vec<_> = f.retired.lock().map(|mut g| g.drain(..).collect()).unwrap_or_default();
    let parts: Vec<_> = f.retired_parts.lock().map(|mut g| g.drain(..).collect()).unwrap_or_default();
    let dropped = !retired.is_empty() || !parts.is_empty();
    drop(retired);
    drop(parts);
    if !f.want.load(Ordering::Relaxed) {
        return false;
    }
    let Some(sp) = shared.params() else { return dropped };
    let shape = Shape::of(&sp);
    let mut stale = Vec::new();
    if let Ok(mut g) = f.ready.lock() {
        let mut i = 0;
        while i < g.len() {
            if g[i].shape == shape {
                i += 1;
            } else {
                stale.push(g.swap_remove(i));
            }
        }
    }
    let waiting = f.pending.load(Ordering::Relaxed) as usize;
    let target = spare_for(sp.algorithm).max(waiting + 1);
    let total = f.live.load(Ordering::Relaxed) as usize + f.stock_of();
    if f.stock_of() >= target || total >= POOL_SLOTS {
        return dropped || !stale.is_empty();
    }
    let v = Voice::build(shape, max_block, channels, &sp);
    if let Ok(mut g) = f.ready.lock() {
        if g.len() < g.capacity() {
            g.push(v);
        }
    }
    true
}

/// Build `n` voices now, for a test or an export.
pub fn stock(shared: &Shared, n: usize, max_block: usize, channels: usize) {
    let f = &shared.voices;
    let Some(sp) = shared.params() else { return };
    let shape = Shape::of(&sp);
    while f.stock_of() < n {
        let v = Voice::build(shape, max_block, channels, &sp);
        if let Ok(mut g) = f.ready.lock() {
            g.push(v);
        }
    }
}

/// The thread that keeps the pool topped up. Lasts as long as the deck does.
pub fn spawn_feeder(shared: Weak<Shared>, max_block: usize, channels: usize) {
    let _ = std::thread::Builder::new().name("grain-voices".into()).spawn(move || loop {
        let Some(s) = shared.upgrade() else { break };
        let more = feed(&s, max_block, channels);
        drop(s);
        if !more {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    });
}

#[derive(Clone, Copy, Default)]
struct Pending {
    key: u8,
    id: u32,
    vel: f32,
    off: bool,
}

/// What a block of voices needs to know, worked out once.
struct Block<'a> {
    src: &'a Source,
    doc: &'a StreamParams,
    channels: usize,
    bounds: Option<(u64, u64)>,
    seam: u32,
    dk: f32,
    sustain: f32,
    sample_rate: f32,
}

/// The audio thread's half. No allocation after it is built.
pub struct Poly {
    active: Vec<Box<Voice>>,
    free: Vec<Box<Voice>>,
    pending: [Pending; PENDING_SLOTS],
    n_pending: usize,
    mix: Vec<f32>,
    buf: Vec<f32>,
    max_block: usize,
    channels: usize,
    parts: Arc<Parts>,
    map: Option<Arc<TimeMap>>,
    /// Keeping a dropped `Parts` for the feeder when its lock was taken.
    parted: Option<Arc<Parts>>,
    cost: [f32; 5],
    /// Time spent rendering voices this block, in seconds.
    spent: f64,
    /// A head started this block. A start is a burst (a seek, and PVSOLA's
    /// first whole run), so its block says nothing about the running cost.
    started: bool,
    hot: u32,
    cool: u32,
    /// The ceiling the misses have earned, and how many blocks of ease back to
    /// taking one more.
    shed: u32,
    published: bool,
}

impl Poly {
    pub fn new(max_block: usize, channels: usize) -> Poly {
        let wide = max_block.max(1) * channels.max(1);
        Poly {
            active: Vec::with_capacity(POOL_SLOTS),
            free: Vec::with_capacity(POOL_SLOTS),
            pending: [Pending::default(); PENDING_SLOTS],
            n_pending: 0,
            // Enough for the varispeed's top speed, as `Core::vs` is sized.
            mix: vec![0.0; wide * crate::transport::MAX_SPEED as usize + 4 * channels.max(1)],
            buf: vec![0.0; wide],
            max_block: max_block.max(1),
            channels: channels.max(1),
            parts: Arc::new(Parts::default()),
            map: None,
            parted: None,
            cost: SEED_COST,
            spent: 0.0,
            started: false,
            hot: 0,
            cool: 0,
            shed: u32::MAX,
            published: false,
        }
    }

    /// Whether anything is sounding, or about to.
    pub fn active(&self) -> bool {
        !self.active.is_empty() || self.n_pending > 0
    }

    pub fn note_on(&mut self, key: u8, id: u32, vel: f32) {
        if self.n_pending < self.pending.len() {
            self.pending[self.n_pending] = Pending { key, id, vel, off: false };
            self.n_pending += 1;
        }
    }

    pub fn note_off(&mut self, key: u8, release: f32) {
        // A note still waiting for a voice is played, and let go at once.
        for p in &mut self.pending[..self.n_pending] {
            if p.key == key {
                p.off = true;
            }
        }
        for v in &mut self.active {
            if v.key == key && !v.released() {
                v.release(release);
            }
        }
    }

    pub fn all_off(&mut self, release: f32) {
        for p in &mut self.pending[..self.n_pending] {
            p.off = true;
        }
        for v in &mut self.active {
            if !v.released() {
                v.release(release);
            }
        }
    }

    /// A new Stretch: every voice keeps its place in the sound.
    pub fn rescale(&mut self, by: f64, doc: &StreamParams) {
        for v in &mut self.active {
            let there = (v.engine.position() as f64 * by).round().max(0.0) as u64;
            let vp = voice_params(doc, v.shape, v.key, v.semis);
            v.engine.rescale(there, &vp);
        }
    }

    /// A Scan moved under held notes: the cloud reads on from the same place
    /// (`KeyPlayer::scan_moved`). Only the cloud, for the reason given there.
    pub fn scan_moved(&mut self, doc: &StreamParams) {
        for v in &mut self.active {
            let (was, now) = (v.scan, doc.grain.scan);
            v.scan = now;
            if was == now || was * now <= 0.0 || v.shape.algorithm != Algorithm::Granular {
                continue;
            }
            let there = (v.engine.position() as f64 * was as f64 / now as f64).round() as u64;
            let vp = voice_params(doc, v.shape, v.key, v.semis);
            v.engine.rescale(there, &vp);
        }
    }

    /// Take what the feeder has built, and hand it what is no longer any use.
    pub fn pickup(&mut self, shared: &Shared, keys: &KeyPlayer, doc: &StreamParams) {
        let want = keys.poly_selected() || self.active();
        shared.voices.want.store(want, Ordering::Relaxed);
        if !want && self.free.is_empty() {
            return;
        }
        let shape = Shape::of(doc);
        if let Ok(mut g) = shared.voices.ready.try_lock() {
            while let Some(v) = g.pop() {
                self.free.push(v);
            }
        }
        // One a block is plenty: this is only ever a change of settings.
        if let Some(i) = self.free.iter().position(|v| v.shape != shape) {
            if let Ok(mut g) = shared.voices.retired.try_lock() {
                if g.len() < g.capacity() {
                    g.push(self.free.swap_remove(i));
                }
            }
        }
        let right = self.free.iter().filter(|v| v.shape == shape).count() as u32;
        shared.voices.free.store(right, Ordering::Relaxed);
        shared.voices.live.store(self.active.len() as u32, Ordering::Relaxed);
        shared.voices.pending.store(self.n_pending as u32, Ordering::Relaxed);
    }

    /// Take the deck's latest separation and map; a voice reads what the
    /// transport reads.
    pub fn adopt(&mut self, renderer: &Stretcher, shared: &Shared) {
        if let Some(old) = self.parted.take() {
            self.retire_parts(old, shared);
        }
        if !Arc::ptr_eq(&self.parts, renderer.parts()) {
            let parts = Arc::clone(renderer.parts());
            for v in self.active.iter_mut().chain(self.free.iter_mut()) {
                v.engine.set_parts(Arc::clone(&parts));
            }
            let old = std::mem::replace(&mut self.parts, parts);
            self.retire_parts(old, shared);
        }
        let map = renderer.map();
        let same = match (&self.map, map) {
            (None, None) => true,
            (Some(a), Some(b)) => Arc::ptr_eq(a, b),
            _ => false,
        };
        if !same {
            self.map = map.cloned();
            for v in self.active.iter_mut().chain(self.free.iter_mut()) {
                v.engine.adopt_map(self.map.clone());
            }
        }
    }

    fn retire_parts(&mut self, old: Arc<Parts>, shared: &Shared) {
        match shared.voices.retired_parts.try_lock() {
            Ok(mut g) if g.len() < g.capacity() => g.push(old),
            _ => self.parted = Some(old),
        }
    }

    fn take_free(&mut self, shape: Shape) -> Option<Box<Voice>> {
        let i = self.free.iter().rposition(|v| v.shape == shape)?;
        Some(self.free.swap_remove(i))
    }

    /// Start waiting notes, shed what will not fit, and move any held note to a
    /// voice of a new shape. `mono_busy` holds off new heads while a note from
    /// another mode is still being cut.
    pub fn begin(
        &mut self,
        keys: &KeyPlayer,
        doc: &StreamParams,
        bounds: Option<(u64, u64)>,
        shared: &Shared,
        mono_busy: bool,
    ) {
        if !self.active() {
            return;
        }
        let shape = Shape::of(doc);
        let offline = shared.voices.offline.load(Ordering::Relaxed);
        let cap = if offline { u32::MAX } else { self.cap(shared) };
        let sr = doc.sample_rate.max(1) as f32;
        let steal_frames = (STEAL_SECONDS * sr) as u32;

        // A setting changed under held notes: each goes across to a voice of the
        // new shape, from where it has got to, and the old fades out under it.
        if let Some(i) = self.active.iter().position(|v| v.shape != shape && !v.released() && !v.stealing()) {
            if let Some(mut n) = self.take_free(shape) {
                let at = self.active[i].engine.position();
                let (key, id, vel, level, stage) = {
                    let o = &self.active[i];
                    (o.key, o.id, o.vel, o.level, o.stage)
                };
                self.begin_voice(&mut n, key, id, vel, keys, doc, at);
                n.level = level;
                n.stage = stage;
                n.fade_left = steal_frames.max(1);
                n.fade_len = n.fade_left;
                self.active[i].steal(steal_frames);
                self.active.push(n);
            }
        }

        // Over the cap: the oldest goes, one a block, so a shed is not a hole.
        let running = self.active.iter().filter(|v| !v.stealing()).count() as u32;
        if running > cap {
            if let Some(v) = self.active.iter_mut().find(|v| !v.stealing()) {
                v.steal(steal_frames);
            }
        }

        if mono_busy || self.n_pending == 0 {
            return;
        }
        // More waiting than can sound: the oldest of them would only be stolen
        // the moment it started, so they are the ones that do not.
        while self.n_pending > cap as usize {
            self.pending.copy_within(1..self.n_pending, 0);
            self.n_pending -= 1;
        }
        let limit = if offline { usize::MAX } else { starts_for(doc.algorithm) };
        let mut started = 0;
        while started < limit && self.n_pending > 0 && self.active.len() < self.active.capacity() {
            let running = self.active.iter().filter(|v| !v.stealing()).count() as u32;
            if running >= cap {
                if let Some(v) = self.active.iter_mut().find(|v| !v.stealing()) {
                    v.steal(steal_frames);
                }
            }
            let Some(mut n) = self.take_free(shape) else { break };
            let p = self.pending[0];
            self.pending.copy_within(1..self.n_pending, 0);
            self.n_pending -= 1;
            let start = crate::brackets::frame(keys.start_frame(doc.plan().out_frames as u64), doc);
            let at = match bounds {
                Some((a, b)) if start < a || start >= b => a,
                _ => start,
            };
            self.begin_voice(&mut n, p.key, p.id, p.vel, keys, doc, at);
            if p.off {
                n.release(keys.amp().3);
            }
            self.active.push(n);
            started += 1;
            self.started = true;
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn begin_voice(&self, v: &mut Voice, key: u8, id: u32, vel: f32, keys: &KeyPlayer, doc: &StreamParams, at: u64) {
        let sr = doc.sample_rate.max(1) as f32;
        v.key = key;
        v.id = id;
        v.vel = vel;
        v.level = 0.0;
        let attack = keys.amp().0 + 0.004;
        v.attack_step = 1.0 / (attack * sr).max(1.0);
        v.stage = Stage::Attack;
        v.steal_left = 0;
        v.steal_len = 0;
        v.seam_in = 0;
        v.fade_len = ((FADE_IN_SECONDS * sr) as u32).max(1);
        v.fade_left = v.fade_len;
        v.scan = doc.grain.scan;
        v.semis = keys.key_semitones(key) + keys.bend_now();
        v.engine.set_parts(Arc::clone(&self.parts));
        v.engine.adopt_map(self.map.clone());
        let vp = voice_params(doc, v.shape, key, v.semis);
        v.engine.seek(at, &vp);
    }

    fn cap(&self, shared: &Shared) -> u32 {
        let c = shared.voices.cap.load(Ordering::Relaxed);
        let ceiling = shared.voices.ceiling.load(Ordering::Relaxed);
        if ceiling > 0 { c.min(ceiling) } else { c }
    }

    /// Fill the mix with `frames` of every voice, ready to be summed.
    #[allow(clippy::too_many_arguments)]
    pub fn render(
        &mut self,
        frames: usize,
        src: &Source,
        doc: &StreamParams,
        keys: &KeyPlayer,
        bounds: Option<(u64, u64)>,
        shared: &Shared,
        events: &mut [GrainEvent],
        speed: f32,
    ) {
        let ch = self.channels;
        let span = (frames * ch).min(self.mix.len());
        self.mix[..span].fill(0.0);
        let (_, decay, sustain, _) = keys.amp();
        // A voice is played in the frames the varispeed reads, so its AMP runs
        // at the block's time, not at the rendered frames'.
        let sr = doc.sample_rate.max(1) as f32 * speed.max(0.01);
        let per = |tau: f32| 1.0 - (-1.0 / (tau.max(1e-4) * sr)).exp();
        let b = Block {
            src,
            doc,
            channels: ch,
            bounds,
            seam: bounds.map_or(512, |(a, e)| loop_fade(a, e) as u32),
            dk: per(decay / 3.0 + 0.001),
            sustain,
            sample_rate: sr,
        };
        let started = Instant::now();
        let mut scratch = std::mem::take(&mut self.buf);
        let mut mix = std::mem::take(&mut self.mix);
        for v in &mut self.active {
            v.semis = keys.key_semitones(v.key) + keys.bend_now();
            render_voice(v, &mut mix[..span], &mut scratch, &b, self.max_block, shared, events);
        }
        self.buf = scratch;
        self.mix = mix;
        self.spent += started.elapsed().as_secs_f64();
        // A voice that has gone is put back where the feeder can see it.
        let mut i = 0;
        while i < self.active.len() {
            if self.active[i].gone() {
                let v = self.active.remove(i);
                self.free.push(v);
            } else {
                i += 1;
            }
        }
    }

    /// The mix `render` made.
    pub fn mix(&self, samples: usize) -> &[f32] {
        &self.mix[..samples.min(self.mix.len())]
    }

    /// Say what happened this block, and work out how many voices fit next.
    pub fn end_block(&mut self, shared: &Shared, frames: usize, sample_rate: u32, doc: &StreamParams) {
        let live = self.active.len();
        let f = &shared.voices;
        f.running.store(live as u32, Ordering::Relaxed);
        if live > 0 || self.published {
            if let Ok(mut g) = f.heads.try_lock() {
                g.clear();
                for v in &self.active {
                    let at = v.engine.position();
                    g.push(Head {
                        key: v.key,
                        voice: v.id,
                        src: crate::brackets::read_at(at, doc),
                        env: (v.level * v.vel).clamp(0.0, 1.0),
                    });
                }
                self.published = live > 0;
            }
        }
        let a = alg_index(doc.algorithm);
        if live > 0 && frames > 0 && sample_rate > 0 {
            let budget = frames as f64 / sample_rate as f64;
            let per_block = (self.spent / budget) as f32;
            let per_voice = per_block / live as f32;
            if !self.started {
                // A slow average, for a number that has to mean "a voice", not
                // this block's luck.
                self.cost[a] += (per_voice - self.cost[a]) / 32.0;
                f.cost_ppm[a].store((self.cost[a] * 1e6) as u32, Ordering::Relaxed);
                let (now, mean, _) = shared.load();
                self.govern(now, mean, live as u32);
                let voices = per_block.min(mean);
                f.cap.store(cap_for(mean, voices, self.cost[a]).min(self.shed), Ordering::Relaxed);
            }
        } else if !self.active() {
            self.shed = u32::MAX;
            self.hot = 0;
            self.cool = 0;
            f.cap.store(cap_for(0.0, 0.0, self.cost[a]), Ordering::Relaxed);
        }
        self.spent = 0.0;
        self.started = false;
    }

    /// `Shared::govern`, for voices: a run of missed deadlines is a voice too
    /// many, and only a long easy stretch earns one back.
    fn govern(&mut self, now: f32, mean: f32, running: u32) {
        const SHED_AT: u32 = 64;
        const EASY: f32 = 0.45;
        const OVER: f32 = 0.9;
        let step = if now >= 1.0 {
            32
        } else if now > OVER {
            4
        } else {
            0
        };
        if step > 0 {
            self.hot += step;
            if self.hot >= SHED_AT {
                self.hot = 0;
                self.cool = 0;
                let base = self.shed.min(running);
                if base > 1 {
                    self.shed = base - 1;
                }
            }
            return;
        }
        self.hot = self.hot.saturating_sub(1);
        if mean < EASY && self.shed != u32::MAX {
            self.cool += 1;
            if self.cool >= 400 {
                self.cool = 0;
                self.shed += 1;
            }
        } else {
            self.cool = 0;
        }
    }
}

impl Voice {
    /// Stolen and faded, or released and silent.
    fn gone(&self) -> bool {
        (self.steal_len > 0 && self.steal_left == 0) || (self.released() && self.level == 0.0)
    }
}

/// The document's parameters at this voice's own pitch, with the engine it
/// was built for: a voice of the old engine plays on while a new one arrives.
fn voice_params(doc: &StreamParams, shape: Shape, key: u8, semis: f32) -> StreamParams {
    let mut p = *doc;
    p.algorithm = shape.algorithm;
    p.semitones = (doc.semitones + semis).clamp(-48.0, 48.0);
    // Two voices on one key are the same note twice; different keys are
    // different notes and should not throw the same grains.
    p.grain.seed = doc.grain.seed.wrapping_add((key as u32).wrapping_mul(0x9E37_79B9));
    p
}

/// Run one voice into the mix: its own loop, its own seam, its own AMP.
fn render_voice(
    v: &mut Voice,
    mix: &mut [f32],
    scratch: &mut [f32],
    b: &Block<'_>,
    max_block: usize,
    shared: &Shared,
    events: &mut [GrainEvent],
) {
    let ch = b.channels;
    let frames = mix.len() / ch;
    let mut done = 0;
    let vp = voice_params(b.doc, v.shape, v.key, v.semis);
    v.engine.set_map_pitch(vp.semitones);
    while done < frames {
        let pos = v.engine.position();
        let mut chunk = (frames - done).min(max_block);
        if let Some((_, end)) = b.bounds {
            chunk = chunk.min(end.saturating_sub(pos).max(1) as usize);
        }
        let out = &mut scratch[..chunk * ch];
        let n = v.engine.render(out, ch, b.src, &vp, events);
        if n > 0 {
            for e in &mut events[..n] {
                e.voice = v.id;
            }
            report(shared, &events[..n]);
        }
        let spliced = v.shape.algorithm != Algorithm::Granular;
        if let (true, Some((_, end))) = (spliced, b.bounds) {
            // The two sides of a seam, in frames of the voice's own read, so
            // the ramp is the same wherever a block boundary falls.
            for f in 0..chunk {
                let left = end.saturating_sub(pos + f as u64 + 1) as u32;
                let mut g = 1.0;
                if left < b.seam {
                    g = left as f32 / b.seam.max(1) as f32;
                }
                if v.seam_in > 0 {
                    g *= 1.0 - v.seam_in as f32 / v.seam_len.max(1) as f32;
                    v.seam_in -= 1;
                }
                for s in &mut out[f * ch..(f + 1) * ch] {
                    *s *= g;
                }
            }
        }
        let wrapped = b.bounds.is_some_and(|(_, end)| pos + chunk as u64 >= end);
        v.amp(out, &mut mix[done * ch..(done + chunk) * ch], b);
        done += chunk;
        if wrapped {
            let (a, _) = b.bounds.unwrap_or((0, 0));
            if spliced {
                v.engine.seek(a, &vp);
                v.seam_in = b.seam;
                v.seam_len = b.seam;
            } else {
                // Sounding grains carry over the wrap: a seek would drop them.
                v.engine.rescale(a, &vp);
            }
        }
    }
}

impl Voice {
    /// AMP, and the steal and the fade in, then into the mix.
    fn amp(&mut self, out: &[f32], mix: &mut [f32], b: &Block<'_>) {
        let ch = b.channels;
        let rk = 1.0 - (-1.0 / (self.release_tau.max(1e-4) * b.sample_rate)).exp();
        for (f, frame) in out.chunks(ch).enumerate() {
            match self.stage {
                Stage::Attack => {
                    self.level += self.attack_step;
                    if self.level >= 1.0 {
                        self.level = 1.0;
                        self.stage = Stage::Decay;
                    }
                }
                Stage::Decay => self.level += (b.sustain - self.level) * b.dk,
                Stage::Release => {
                    self.level -= self.level * rk;
                    if self.level < AMP_SILENT {
                        self.level = 0.0;
                    }
                }
            }
            let mut g = self.level * self.vel;
            if self.fade_left > 0 {
                g *= 1.0 - self.fade_left as f32 / self.fade_len.max(1) as f32;
                self.fade_left -= 1;
            }
            if self.steal_len > 0 {
                g *= self.steal_left as f32 / self.steal_len.max(1) as f32;
                self.steal_left = self.steal_left.saturating_sub(1);
            }
            for (c, s) in frame.iter().enumerate() {
                mix[f * ch + c] += s * g;
            }
        }
    }
}
