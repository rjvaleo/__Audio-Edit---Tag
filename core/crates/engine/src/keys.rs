//! Notes on the Grain page: the keys, AMP, Glide, Bend and Run
//! (`docs/GRAIN-SYNTH.md` arrives with the cut-over; until then
//! `grain-redesign/ARCHITECTURE.md`).
//!
//! The Wave page's synth is a deck of its own. A note here is different: it
//! plays the grain deck's own engines, so this is a small piece of [`Core`]
//! rather than a fourth deck. Two halves, as `synth.rs` has:
//!
//! - [`GrainKeys`] is what everyone else talks to: the HTTP threads, and the
//!   take being replayed. The server holds one for the life of the process and
//!   hands it to every device it opens, so a device reopened at a new buffer
//!   size keeps the page's settings, and a note sent while it was being
//!   reopened is not lost.
//! - [`KeyPlayer`] lives on the audio thread, inside [`Core`].
//!
//! # What a note may not do
//!
//! **Never touch the document.** The pitch of a key is added to the block's
//! `semitones` and nowhere else, so a key is not an edit and not an undo step.
//! [`crate::glide`] is the same smoothing the HyperStretch pad has; this is a
//! second instance of it, for a different control.
//!
//! # Run, and the two clocks
//!
//! With **Run on** (the default, and the whole of what happens if no page ever
//! says otherwise) nothing here changes a sample: the gate is unity and a key
//! only re-pitches the cloud.
//!
//! With **Run off**, Grain plays like a synth, and the renderer becomes the
//! note's read head: a note-on seeks it to Start, and it loops the region for
//! as long as AMP is open. So it can no longer be the transport as well. A take
//! is measured against the transport, and the transport should not jump because
//! somebody played a note. So with Run off the transport is a plain frame count
//! here ([`KeyPlayer::transport`]) and is what `Shared::position` reports. A key
//! on a stopped transport leaves the transport stopped.
//!
//! # Poly is Phase 7
//!
//! Poly behaves as Mono for now, one head, but every note already has a voice
//! id on its way through here so that Phase 7 does not re-plumb it. The held
//! list is one entry per key, which is what a keyboard can hold down, and says
//! nothing about how many heads there may be.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

use fx::grain::StreamParams;
use fx::stretch::Algorithm;

use crate::glide::Glide;
use crate::synth::{EventQueue, EVENT_CAPACITY};

/// How a run of notes is played.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeyMode {
    /// Each key starts the head again at Start.
    Mono,
    /// Glide between held keys without starting again.
    Legato,
    /// Each key its own head, in Phase 7. Mono until then.
    Poly,
}

impl KeyMode {
    pub fn name(self) -> &'static str {
        match self {
            KeyMode::Mono => "mono",
            KeyMode::Legato => "legato",
            KeyMode::Poly => "poly",
        }
    }

    pub fn from_name(s: &str) -> Option<KeyMode> {
        Some(match s {
            "mono" => KeyMode::Mono,
            "legato" => KeyMode::Legato,
            "poly" => KeyMode::Poly,
            _ => return None,
        })
    }
}

/// Kind in the top byte, then the key, the velocity in sixteen bits and the
/// voice id: one word, so it fits a slot of [`EventQueue`].
#[derive(Clone, Copy, Debug, PartialEq)]
enum KeyEvent {
    On { key: u8, vel: f32, voice: u32 },
    Off { key: u8 },
    AllOff,
    /// Everything let go and the pitch going home: the page was left.
    Reset,
}

impl KeyEvent {
    fn pack(self) -> u64 {
        let (kind, key, vel, voice) = match self {
            KeyEvent::On { key, vel, voice } => (1u64, key, (vel.clamp(0.0, 1.0) * 65535.0).round() as u64, voice),
            KeyEvent::Off { key } => (2, key, 0, 0),
            KeyEvent::AllOff => (3, 0, 0, 0),
            KeyEvent::Reset => (4, 0, 0, 0),
        };
        (kind << 56) | ((key as u64) << 48) | (vel << 32) | voice as u64
    }

    fn unpack(w: u64) -> Option<KeyEvent> {
        let key = (w >> 48) as u8;
        Some(match w >> 56 {
            1 => KeyEvent::On { key, vel: ((w >> 32) & 0xffff) as f32 / 65535.0, voice: w as u32 },
            2 => KeyEvent::Off { key },
            3 => KeyEvent::AllOff,
            4 => KeyEvent::Reset,
            _ => return None,
        })
    }
}

fn get_f32(a: &AtomicU32) -> f32 {
    f32::from_bits(a.load(Ordering::Relaxed))
}

fn put_f32(a: &AtomicU32, v: f32) {
    a.store(v.to_bits(), Ordering::Relaxed);
}

/// Everything the rest of the program says to the grain deck's keys.
pub struct GrainKeys {
    events: EventQueue,
    mode: AtomicU32,
    /// How long a Glide takes to arrive, in seconds. 0 is instant.
    glide: AtomicU32,
    /// Semitones.
    bend: AtomicU32,
    /// Seconds, seconds, 0..1, seconds.
    attack: AtomicU32,
    decay: AtomicU32,
    sustain: AtomicU32,
    release: AtomicU32,
    /// Where a note starts, as a fraction of the document.
    start: AtomicU32,
    run: AtomicBool,
    /// Whether a take's notes should be played back through here.
    replay: AtomicBool,
    /// Whether the Grain page is in front (`brackets.rs`).
    front: AtomicBool,
    /// What each key plays, in semitones: the page's tuning.
    table: Box<[AtomicU32]>,
    next_voice: AtomicU32,
    /// How many keys have ever gone down: an Each note LFO restarts when this
    /// moves (`server::grain_lfos`).
    note_ons: AtomicU64,
    /// Where the note's head is, in output frames, and whether AMP is open.
    head: AtomicU64,
    sounding: AtomicBool,
    /// The semitones the last block added to the document's, after Glide and
    /// with Bend, for the picture of what is heard.
    pitch: AtomicU32,
}

impl Default for GrainKeys {
    fn default() -> Self {
        GrainKeys::new()
    }
}

impl GrainKeys {
    /// Run on, equal temperament from middle C, and nothing else asked for.
    pub fn new() -> GrainKeys {
        GrainKeys {
            events: EventQueue::new(EVENT_CAPACITY),
            mode: AtomicU32::new(0),
            glide: AtomicU32::new(0f32.to_bits()),
            bend: AtomicU32::new(0f32.to_bits()),
            attack: AtomicU32::new(0.1f32.to_bits()),
            decay: AtomicU32::new(0.6f32.to_bits()),
            sustain: AtomicU32::new(0.8f32.to_bits()),
            release: AtomicU32::new(1.5f32.to_bits()),
            start: AtomicU32::new(0f32.to_bits()),
            run: AtomicBool::new(true),
            replay: AtomicBool::new(false),
            front: AtomicBool::new(false),
            table: (0..128).map(|n| AtomicU32::new((n as f32 - 60.0).to_bits())).collect(),
            next_voice: AtomicU32::new(1),
            note_ons: AtomicU64::new(0),
            pitch: AtomicU32::new(0.0f32.to_bits()),
            head: AtomicU64::new(0),
            sounding: AtomicBool::new(false),
        }
    }

    /// Press a key. Answers the note's voice id.
    pub fn note_on(&self, key: u8, vel: f32) -> u32 {
        let voice = self.next_voice.fetch_add(1, Ordering::Relaxed);
        self.note_ons.fetch_add(1, Ordering::Release);
        self.events.push_word(KeyEvent::On { key: key.min(127), vel, voice }.pack());
        voice
    }

    /// How many keys have gone down since the process began.
    pub fn note_ons(&self) -> u64 {
        self.note_ons.load(Ordering::Acquire)
    }

    pub fn note_off(&self, key: u8) {
        self.events.push_word(KeyEvent::Off { key: key.min(127) }.pack());
    }

    /// Let every key go; their releases ring out.
    pub fn all_off(&self) {
        self.events.push_word(KeyEvent::AllOff.pack());
    }

    /// The page has gone: back to what the engine does with no keys at all.
    pub fn reset(&self) {
        self.run.store(true, Ordering::Release);
        self.replay.store(false, Ordering::Release);
        self.front.store(false, Ordering::Release);
        put_f32(&self.bend, 0.0);
        self.events.push_word(KeyEvent::Reset.pack());
    }

    pub fn set_mode(&self, m: KeyMode) {
        self.mode.store(m as u32, Ordering::Relaxed);
    }

    pub fn mode(&self) -> KeyMode {
        match self.mode.load(Ordering::Relaxed) {
            1 => KeyMode::Legato,
            2 => KeyMode::Poly,
            _ => KeyMode::Mono,
        }
    }

    /// How long a Glide takes to arrive, in seconds.
    pub fn set_glide(&self, seconds: f32) {
        put_f32(&self.glide, if seconds.is_finite() { seconds.clamp(0.0, 10.0) } else { 0.0 });
    }

    pub fn glide(&self) -> f32 {
        get_f32(&self.glide)
    }

    /// In semitones, already scaled by the bend range.
    pub fn set_bend(&self, semitones: f32) {
        put_f32(&self.bend, if semitones.is_finite() { semitones.clamp(-48.0, 48.0) } else { 0.0 });
    }

    pub fn bend(&self) -> f32 {
        get_f32(&self.bend)
    }

    /// Attack, decay and release in seconds; sustain 0..1.
    pub fn set_amp(&self, attack: f32, decay: f32, sustain: f32, release: f32) {
        let time = |v: f32| if v.is_finite() { v.clamp(0.0, 30.0) } else { 0.0 };
        put_f32(&self.attack, time(attack));
        put_f32(&self.decay, time(decay));
        put_f32(&self.sustain, if sustain.is_finite() { sustain.clamp(0.0, 1.0) } else { 1.0 });
        put_f32(&self.release, time(release));
    }

    pub fn amp(&self) -> (f32, f32, f32, f32) {
        (get_f32(&self.attack), get_f32(&self.decay), get_f32(&self.sustain), get_f32(&self.release))
    }

    /// Where a note starts, as a fraction of the document, so a new Stretch
    /// does not move it.
    pub fn set_start(&self, fraction: f32) {
        put_f32(&self.start, if fraction.is_finite() { fraction.clamp(0.0, 1.0) } else { 0.0 });
    }

    pub fn start(&self) -> f32 {
        get_f32(&self.start)
    }

    pub fn set_run(&self, on: bool) {
        self.run.store(on, Ordering::Release);
    }

    pub fn run(&self) -> bool {
        self.run.load(Ordering::Acquire)
    }

    pub fn set_replay(&self, on: bool) {
        self.replay.store(on, Ordering::Release);
    }

    pub fn replay(&self) -> bool {
        self.replay.load(Ordering::Acquire)
    }

    /// The Grain page says it is in front, or has gone.
    pub fn set_front(&self, on: bool) {
        self.front.store(on, Ordering::Release);
    }

    pub fn front(&self) -> bool {
        self.front.load(Ordering::Acquire)
    }

    pub fn set_key(&self, key: usize, semitones: f32) {
        if let (Some(a), true) = (self.table.get(key), semitones.is_finite()) {
            put_f32(a, semitones);
        }
    }

    pub fn key_semitones(&self, key: usize) -> f32 {
        self.table.get(key).map_or(0.0, get_f32)
    }

    /// Where the note's head is, in output frames.
    pub fn head(&self) -> u64 {
        self.head.load(Ordering::Acquire)
    }

    /// The semitones the keys are adding now, after Glide and with Bend.
    pub fn pitch(&self) -> f32 {
        get_f32(&self.pitch)
    }

    /// Whether a note is sounding (AMP open, Run off).
    pub fn sounding(&self) -> bool {
        self.sounding.load(Ordering::Acquire)
    }
}

/// The time constant of a Glide, as the Smoothing percentage that gives it.
///
/// The page's Glide is a time; [`crate::glide`] is Hyperprism's, a percentage
/// that picks a coefficient for a step every 512 samples at 44.1 kHz. This is
/// that coefficient, solved backwards.
pub fn smoothing_for(tau_seconds: f32) -> f32 {
    if !(tau_seconds > 0.0) {
        return 0.0;
    }
    let step = crate::glide::STEP_SAMPLES / 44_100.0;
    let a = 1.0 - (-step / tau_seconds as f64).exp();
    (100.0 - ((a * 1e4).max(1.0)).log10() / 0.04).clamp(0.0, 100.0) as f32
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Stage {
    /// Run on and settled: not there at all.
    Open,
    /// Run just turned on: up to unity, then `Open`.
    Opening,
    Attack,
    Decay,
    Release,
    Idle,
}

/// How long the gate takes to open when Run comes on.
const RUN_OPEN_SECONDS: f32 = 0.08;
/// How fast the gate shuts when Run goes off: the note envelope is for notes.
const RUN_SHUT_TAU: f32 = 0.08;
/// Below this AMP has finished, and the head can stop.
const AMP_SILENT: f32 = 1e-4;
/// The notch a restart makes in what is already sounding, and the fade in after
/// it, in seconds. A seek is a jump; these are what keep it from being heard.
const DUCK_SECONDS: f32 = 0.003;
const FADE_IN_SECONDS: f32 = 0.005;

#[derive(Clone, Copy, Default)]
struct Held {
    key: u8,
    voice: u32,
    vel: f32,
}

/// What a block has to do to the renderer, decided before it runs.
#[derive(Clone, Copy, Default, Debug)]
pub struct KeyBlock {
    /// Move the head to Start.
    pub restart: bool,
    /// Run came on: the head goes back to where the transport has got to.
    pub resume: bool,
}

/// The audio thread's half. No allocation after it is built.
pub struct KeyPlayer {
    keys: Arc<GrainKeys>,
    held: [Held; 128],
    n_held: usize,
    /// An Off that arrived in the same block as its On waits one block.
    deferred: Option<KeyEvent>,
    run: bool,
    target: f32,
    glide: Glide<1>,
    bend: f32,
    stage: Stage,
    level: f32,
    attack_step: f32,
    release_tau: f32,
    vel: f32,
    vel_to: f32,
    /// What the restart's notch has made of the block, 0..1.
    notch: f32,
    duck_left: u32,
    fade_left: u32,
    /// A restart waiting for its notch to finish.
    waiting: bool,
    /// The transport, while Run is off. See the module doc.
    clock: u64,
    /// The Scan of the last block, to tell when it moved (`brackets.rs`).
    scan: f32,
}

impl KeyPlayer {
    pub fn new(keys: Arc<GrainKeys>) -> KeyPlayer {
        let run = keys.run();
        let mut glide = Glide::default();
        glide.snap([0.0]);
        KeyPlayer {
            keys,
            held: [Held::default(); 128],
            n_held: 0,
            deferred: None,
            run,
            target: 0.0,
            glide,
            bend: 0.0,
            stage: if run { Stage::Open } else { Stage::Idle },
            level: if run { 1.0 } else { 0.0 },
            attack_step: 0.0,
            release_tau: 1.0,
            vel: 1.0,
            vel_to: 1.0,
            notch: 1.0,
            duck_left: 0,
            fade_left: 0,
            waiting: false,
            clock: 0,
            scan: 1.0,
        }
    }

    /// Whether the renderer is the note's head rather than the transport.
    pub fn clocked(&self) -> bool {
        !self.run
    }

    /// Whether AMP is open: the head should render, whatever the transport is
    /// doing.
    pub fn head_running(&self) -> bool {
        !self.run && self.stage != Stage::Idle
    }

    /// Where the transport is, given where the renderer is.
    pub fn transport(&self, renderer: u64) -> u64 {
        if self.run { renderer } else { self.clock }
    }

    pub fn set_clock(&mut self, frame: u64) {
        self.clock = frame;
    }

    pub fn clock(&self) -> u64 {
        self.clock
    }

    /// A new Stretch: the transport keeps its place in the sound.
    pub fn rescale_clock(&mut self, by: f64) {
        if !self.run {
            self.clock = (self.clock as f64 * by).round().max(0.0) as u64;
        }
    }

    /// The transport's own loop, corrected by Scan when it is the thing being
    /// played and the page is in front to want it (`brackets.rs`).
    pub fn transport_bounds(&self, bounds: Option<(u64, u64)>, p: &StreamParams) -> Option<(u64, u64)> {
        if self.run && self.keys.front() {
            bounds.map(|x| crate::brackets::bounds(x, p))
        } else {
            bounds
        }
    }

    /// Scan moved under a held note: where the head goes so the cloud reads
    /// on from the same place. Only the cloud: the splice and spectral engines
    /// hold their own read, so a relabelled playhead would come apart from
    /// them. A flip or a freeze has no such place, and jumps.
    pub fn scan_moved(&mut self, position: u64, p: &StreamParams) -> Option<u64> {
        let (was, now) = (self.scan, p.grain.scan);
        self.scan = now;
        if !self.head_running() || was == now || was * now <= 0.0 || p.algorithm != Algorithm::Granular {
            return None;
        }
        Some((position as f64 * was as f64 / now as f64).round() as u64)
    }

    /// Where a note starts, in output frames of a document that long.
    pub fn start_frame(&self, out_frames: u64) -> u64 {
        (self.keys.start() as f64 * out_frames as f64).round() as u64
    }

    fn is_held(&self, key: u8) -> bool {
        self.held[..self.n_held].iter().any(|h| h.key == key)
    }

    fn retune(&mut self, key: u8) {
        self.target = self.keys.key_semitones(key as usize);
    }

    fn gate_on(&mut self, vel: f32, sample_rate: f32) {
        self.vel_to = vel;
        if self.level * self.vel < AMP_SILENT {
            self.vel = vel;
        }
        let attack = self.keys.amp().0 + 0.004;
        // From wherever AMP is, so a note on a note does not dip to nothing.
        self.attack_step = (1.0 - self.level).max(0.0) / (attack * sample_rate).max(1.0);
        self.stage = Stage::Attack;
    }

    fn release(&mut self) {
        self.release_tau = self.keys.amp().3 / 4.0 + 0.002;
        if !matches!(self.stage, Stage::Idle) {
            self.stage = Stage::Release;
        }
    }

    /// Ask for the head to go back to Start: at once if nothing can be heard,
    /// otherwise after a notch in what is sounding.
    fn request_restart(&mut self, sample_rate: f32, plan: &mut KeyBlock) {
        if self.level * self.vel * self.notch > AMP_SILENT {
            self.duck_left = ((DUCK_SECONDS * sample_rate) as u32).max(1);
            self.fade_left = 0;
            self.waiting = true;
        } else {
            self.waiting = false;
            self.duck_left = 0;
            self.begin_fade_in(sample_rate);
            plan.restart = true;
        }
    }

    fn begin_fade_in(&mut self, sample_rate: f32) {
        self.notch = 0.0;
        self.fade_left = ((FADE_IN_SECONDS * sample_rate) as u32).max(1);
    }

    fn apply(&mut self, e: KeyEvent, sample_rate: f32, plan: &mut KeyBlock) {
        match e {
            KeyEvent::On { key, vel, voice } => {
                if self.is_held(key) || self.n_held >= self.held.len() {
                    return;
                }
                let released = matches!(self.stage, Stage::Release | Stage::Idle);
                self.held[self.n_held] = Held { key, voice, vel };
                self.n_held += 1;
                self.retune(key);
                if self.run {
                    return;
                }
                let legato = self.keys.mode() == KeyMode::Legato && self.n_held > 1 && !released;
                if !legato {
                    self.gate_on(vel, sample_rate);
                    self.request_restart(sample_rate, plan);
                }
            }
            KeyEvent::Off { key } => {
                let Some(i) = self.held[..self.n_held].iter().position(|h| h.key == key) else { return };
                self.held.copy_within(i + 1..self.n_held, i);
                self.n_held -= 1;
                if self.n_held > 0 {
                    self.retune(self.held[self.n_held - 1].key);
                } else if !self.run {
                    self.release();
                }
            }
            KeyEvent::AllOff => {
                self.n_held = 0;
                if !self.run {
                    self.release();
                }
            }
            KeyEvent::Reset => {
                self.n_held = 0;
                self.target = 0.0;
                if !self.run {
                    self.release();
                }
            }
        }
    }

    /// The top of a block: take what has arrived, and say what it asks of the
    /// renderer. `renderer` is where the renderer is, `playing` the transport.
    pub fn begin(&mut self, frames: usize, sample_rate: u32, renderer: u64, playing: bool) -> KeyBlock {
        let sr = sample_rate.max(1) as f32;
        let mut plan = KeyBlock::default();

        let run = self.keys.run();
        if run != self.run {
            self.run = run;
            if run {
                plan.resume = true;
                self.vel_to = 1.0;
                self.waiting = false;
                self.stage = if playing { Stage::Opening } else { Stage::Open };
                if !playing {
                    self.level = 1.0;
                    self.vel = 1.0;
                }
                self.notch = 1.0;
                self.fade_left = 0;
                self.duck_left = 0;
            } else {
                self.clock = renderer;
                if playing {
                    self.release_tau = RUN_SHUT_TAU;
                    self.stage = Stage::Release;
                } else {
                    self.stage = Stage::Idle;
                    self.level = 0.0;
                }
            }
        }

        if self.waiting && self.duck_left == 0 {
            self.waiting = false;
            self.begin_fade_in(sr);
            plan.restart = true;
        }

        if let Some(e) = self.deferred.take() {
            self.apply(e, sr, &mut plan);
        }
        let mut pressed = false;
        while let Some(w) = self.keys.events.pop_word() {
            let Some(e) = KeyEvent::unpack(w) else { continue };
            // A note shorter than a block still gets its attack.
            if pressed && matches!(e, KeyEvent::Off { .. }) {
                self.deferred = Some(e);
                break;
            }
            if matches!(e, KeyEvent::On { .. }) {
                pressed = true;
            }
            self.apply(e, sr, &mut plan);
        }

        // Bend moves with the wheel, smoothed a little over the steps it
        // arrives in.
        let k = 1.0 - (-(frames as f32) / (0.01 * sr)).exp();
        self.bend += (self.keys.bend() - self.bend) * k;
        if (self.bend - self.keys.bend()).abs() < 1e-4 {
            self.bend = self.keys.bend();
        }
        plan
    }

    /// The semitones this block adds to the document's, after Glide.
    pub fn detune(&mut self, frames: usize, sample_rate: u32) -> f32 {
        // The page's Glide is a time to arrive, about three time constants.
        let smoothing = smoothing_for(self.keys.glide() / 3.0);
        let [now] = self.glide.advance([self.target], frames, sample_rate, smoothing);
        let glided = if (now - self.target).abs() < 1e-4 {
            // Land exactly: a pitch going home has to arrive at nought, which
            // is what leaves the block's `semitones` untouched.
            self.glide.snap([self.target]);
            self.target
        } else {
            now
        };
        put_f32(&self.keys.pitch, glided + self.bend);
        glided + self.bend
    }

    /// AMP, on the block before the rack, so what the effects are holding
    /// rings on after a release.
    pub fn gate(&mut self, out: &mut [f32], channels: usize, sample_rate: u32) {
        if self.stage == Stage::Open && self.notch >= 1.0 && self.fade_left == 0 && self.duck_left == 0 {
            return;
        }
        let ch = channels.max(1);
        let sr = sample_rate.max(1) as f32;
        let (_, decay, sustain, _) = self.keys.amp();
        let per = |tau: f32| 1.0 - (-1.0 / (tau.max(1e-4) * sr)).exp();
        let dk = per(decay / 3.0 + 0.001);
        let rk = per(self.release_tau);
        let vk = per(0.003);
        let open_step = 1.0 / (RUN_OPEN_SECONDS * sr);
        let duck_step = 1.0 / (DUCK_SECONDS * sr).max(1.0);
        let fade_step = 1.0 / (FADE_IN_SECONDS * sr).max(1.0);
        for frame in out.chunks_mut(ch) {
            match self.stage {
                Stage::Open | Stage::Idle => {}
                Stage::Opening => {
                    self.level += open_step;
                    if self.level >= 1.0 {
                        self.level = 1.0;
                        self.stage = Stage::Open;
                    }
                }
                Stage::Attack => {
                    self.level += self.attack_step;
                    if self.level >= 1.0 {
                        self.level = 1.0;
                        self.stage = Stage::Decay;
                    }
                }
                Stage::Decay => self.level += (sustain - self.level) * dk,
                Stage::Release => {
                    self.level -= self.level * rk;
                    if self.level < AMP_SILENT {
                        self.level = 0.0;
                        self.stage = Stage::Idle;
                    }
                }
            }
            self.vel += (self.vel_to - self.vel) * vk;
            if self.duck_left > 0 {
                self.notch = (self.notch - duck_step).max(0.0);
                self.duck_left -= 1;
                if self.duck_left == 0 {
                    self.notch = 0.0;
                }
            } else if self.fade_left > 0 {
                self.notch = (self.notch + fade_step).min(1.0);
                self.fade_left -= 1;
                if self.fade_left == 0 {
                    self.notch = 1.0;
                }
            }
            let g = self.level * self.notch * if self.run { 1.0 } else { self.vel };
            for s in frame.iter_mut() {
                *s *= g;
            }
        }
        if self.run && self.stage == Stage::Open {
            self.vel = 1.0;
        }
    }

    /// The bottom of a block: say where the head got to, and move the
    /// transport on while it is a count of its own. `bounds` is the transport's
    /// own loop.
    pub fn end(&mut self, renderer: u64, frames: usize, playing: bool, bounds: Option<(u64, u64)>) {
        self.keys.head.store(renderer, Ordering::Release);
        self.keys.sounding.store(self.head_running(), Ordering::Release);
        if self.run || !playing {
            return;
        }
        self.clock += frames as u64;
        if let Some((a, b)) = bounds {
            if self.clock >= b {
                self.clock = a + (self.clock - b) % (b - a).max(1);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_event_packs_into_one_word_and_back() {
        let e = KeyEvent::On { key: 72, vel: 1.0, voice: 0xdead_beef };
        assert_eq!(KeyEvent::unpack(e.pack()), Some(e));
        let e = KeyEvent::Off { key: 3 };
        assert_eq!(KeyEvent::unpack(e.pack()), Some(e));
        assert_eq!(KeyEvent::unpack(0), None);
    }

    #[test]
    fn smoothing_gives_back_the_time_it_was_asked_for() {
        assert_eq!(smoothing_for(0.0), 0.0);
        for tau in [0.02f32, 0.1, 0.5] {
            let a = crate::glide::coefficient(smoothing_for(tau));
            let got = -(crate::glide::STEP_SAMPLES / 44_100.0) / (1.0 - a).ln();
            assert!((got as f32 - tau).abs() / tau < 0.05, "{got} for {tau}");
        }
    }
}
