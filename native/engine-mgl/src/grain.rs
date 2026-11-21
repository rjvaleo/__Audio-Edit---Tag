//! MultiGrainLive's grain deck as a module.
//!
//! The deck is MGL's own `Core`, unchanged. In MGL the server writes what the
//! deck needs into a `Shared` and the deck tries each of its locks once a
//! block. Here the engine's messages are written into the module's `Shared`
//! between blocks, on the audio thread, and the deck reads them as it always
//! has. No other thread writes there, so those tries succeed at once.
//!
//! Two things cross to another thread, and the audio thread waits for
//! neither. What the deck has finished with (a rack that has faded out, a
//! replaced bank or map) goes on `Shared`'s list, and the app frees it with
//! [`Handle::collect`]; the deck only tries that list's lock, and keeps the
//! thing for the next block when the app holds it. And `collect` reads the
//! sound and its separation (to make the copies an octave up that the top
//! keys play from), so a new sound or separation is only offered: if
//! `collect` is mid-read, it waits in this module for the next line.

use engine_core::{EventKind, Io, Kind, Module, NoteEvent, NoteKind, Thing};
use mgl_engine::stretcher::LayerBank;
use mgl_engine::transport::PitchTime;
use mgl_engine::{Core, GrainKeys, KeyMode, Shared, Source};
use mgl_fx::grain::GrainEvent;
use mgl_fx::transient::TimeMap;
use mgl_fx::grain::StreamParams;
use mgl_fx::hstream::Parts;
use std::sync::Arc;

/// Knob numbers.
pub const PLAY: u32 = 0;
/// 0 Mono, 1 Legato, 2 Poly.
pub const KEY_MODE: u32 = 1;
pub const RUN: u32 = 2;
pub const PLAYED: u32 = 3;
/// Semitones.
pub const BEND: u32 = 4;
/// The keys' envelope, in seconds (sustain is a level).
pub const AMP_ATTACK: u32 = 5;
pub const AMP_DECAY: u32 = 6;
pub const AMP_SUSTAIN: u32 = 7;
pub const AMP_RELEASE: u32 = 8;
/// Seconds.
pub const KEY_GLIDE: u32 = 9;
/// Where a key starts the sound, as a fraction of its length.
pub const START: u32 = 10;
/// The deck's level, 0 to 4.
pub const GAIN: u32 = 11;
pub const MUTE: u32 = 12;
/// Varispeed, 0 to 2.
pub const SPEED: u32 = 13;
/// How slowly the settings glide to a change, 0 to 100.
pub const SMOOTHING: u32 = 14;
/// The left and right faders, as gains.
pub const SIDE_LEFT: u32 = 15;
pub const SIDE_RIGHT: u32 = 16;
/// The most voices Poly may sound at once; the oldest gives way to a new
/// note past it. 0: as many as there are.
pub const VOICES: u32 = 17;

/// The kinds of thing that can be kept waiting for the deck, in the order
/// they are offered again.
const PARAMS: usize = 0;
const SOUND: usize = 1;
const PARTS: usize = 2;
const RACK: usize = 3;
const BANK: usize = 4;
const MAP: usize = 5;
const KINDS: usize = 6;

/// What the deck is handed while it plays, built on the app's thread
/// (`Controller::give`, slot 0).
pub enum GrainThing {
    /// The engine and all its settings.
    Params(StreamParams),
    /// The sound, at the engine's rate, two channels.
    Source(Arc<Source>),
    /// The rack after the engines, or none. Sized for the deck's block by
    /// whoever builds it: `reserve_mix(grid * 2)`, two channels.
    Rack(Option<mgl_fx::Rack>),
    /// The layers' engines.
    Bank(LayerBank),
    /// The sound's separated parts (the Hybrid engine's).
    Parts(Arc<Parts>),
    /// The transient map, or none for a straight line.
    Map(Option<Arc<TimeMap>>),
    /// Jump to this sample of the stretched sound.
    Seek(u64),
    /// Loop between two samples of the stretched sound, or stop looping.
    Loop { on: bool, a: u64, b: u64 },
    /// The Pitch Time Changer.
    PitchTime(PitchTime),
    /// How long to play on after the end, in samples.
    PostRoll(u64),
    /// On its way back: the separations a new one replaced, for the app to
    /// free.
    OldParts([Option<Arc<Parts>>; 2]),
    /// What a box holds on its way back, once the deck has taken its contents.
    Taken,
}

/// The app's side of a deck, for any thread but the audio one: it frees what
/// the deck has finished with, and reads where the deck is and what it is
/// playing. The app calls `collect` now and then, as it does the engine's own.
///
/// It reads only what the audio thread publishes without waiting. It cannot
/// change the deck: every change goes through the engine, stamped.
pub struct Handle {
    shared: Arc<Shared>,
    grid: usize,
}

impl Handle {
    /// Free what the deck has finished with: racks it has faded out of, and
    /// replaced sounds, banks and maps.
    pub fn collect(&self) {
        self.shared.collect();
    }

    pub fn is_playing(&self) -> bool {
        self.shared.is_playing()
    }

    /// Where the deck is, in samples of the stretched sound.
    pub fn position(&self) -> u64 {
        self.shared.position()
    }

    /// The loop it last played, if it is looping.
    pub fn heard_loop(&self) -> Option<(u64, u64)> {
        self.shared.heard_loop()
    }

    /// The output's spectrum: 513 bands, 0 to 255.
    pub fn spectrum(&self) -> Vec<u8> {
        self.shared.spectrum()
    }

    /// The output's shape: 128 columns, -127 to 127.
    pub fn waveform(&self) -> Vec<i8> {
        self.shared.waveform()
    }

    /// Make voices for Poly until there are `voices` of the kind the deck's
    /// settings now call for (new settings need new voices). They reach the
    /// deck at its next block, so a key played before then waits for one.
    pub fn stock_voices(&self, voices: usize) {
        mgl_engine::voices::stock(&self.shared, voices, self.grid, 2);
    }

    /// How many voices the last block played.
    pub fn voices_running(&self) -> u32 {
        self.shared.voices.running()
    }

    /// The last moments of the deck's output, left and right, and its rate:
    /// for a scope.
    pub fn scope(&self) -> Option<(Vec<f32>, Vec<f32>, u32)> {
        self.shared.scope_snapshot()
    }

    /// The level going into and coming out of each slot of the deck's rack.
    pub fn rack_levels(&self) -> Vec<(f32, f32)> {
        self.shared.rack_levels()
    }

    /// The grains started since this was last called, for a grain view.
    pub fn grains(&self) -> Vec<GrainEvent> {
        self.shared.drain_events()
    }
}

/// The grain deck. Input 0 takes notes, output 0 is audio.
///
/// The deck's sound depends on the size of the blocks it is asked for, so it
/// is always asked for whole blocks of `grid` samples on fixed lines, and a
/// note, a knob or a new sound takes effect on the first line at or after
/// its sample. What it plays is then the same however the sound card's
/// blocks fall.
pub type GrainState = engine_core::Preset<Grain>;

pub struct Grain {
    preset: Box<GrainState>,
    rebuildable: bool,
    core: Core,
    shared: Arc<Shared>,
    keys: Arc<GrainKeys>,
    /// A hold of this module's own on the sound last handed to the deck, so
    /// that replacing a sound here never drops the last hold on one.
    source: Arc<Source>,
    /// What could not be handed to the deck yet (another thread was in its
    /// slot at that instant: MGL's housekeeping thread reads the sound and
    /// the separation, the app's `stock_voices` the settings), one of each
    /// kind, still in its box, offered again at every line until taken.
    waiting: [Option<Box<GrainThing>>; KINDS],
    /// Boxes finished with after a second offer, on their way back.
    done: [Option<Box<GrainThing>>; 8],
    amp: [f32; 4],
    sides: [f32; 2],
    grid: usize,
    /// The block last made, left and right interleaved, and how many of its
    /// frames have gone out.
    block: Vec<f32>,
    used: usize,
}

impl Grain {
    /// A deck for `rate` (the engine's) playing `source` with `params`.
    /// `grid` is the deck's own block: it renders that many samples at a
    /// time, and a note, a knob or a new sound takes effect on the first
    /// line of the grid at or after its sample.
    pub fn new(rate: u32, grid: usize, params: StreamParams, source: Arc<Source>) -> Grain {
        // The transforms' tables, built here and not in the first block.
        audio_core::fft::prime();
        prism_grain::fft::prime();
        let grid = grid.max(1);
        let params = StreamParams { sample_rate: rate, ..params };
        let keys = Arc::new(GrainKeys::new());
        let (attack, decay, sustain, release) = keys.amp();
        let shared = Arc::new(Shared::new(params, Arc::clone(&source)));
        // Poly's voices are never limited by how long a block took: that is
        // the clock on the wall, and the same performance must play the same
        // twice. They are limited by a number (`VOICES`, or `poly`).
        shared.voices.set_offline(true);
        Grain {
            preset: Box::new(GrainState::new(&[])),
            rebuildable: true,
            core: Core::new(grid, 2, params, Arc::clone(&source)).with_keys(Arc::clone(&keys)),
            shared,
            keys,
            source,
            waiting: [const { None }; KINDS],
            done: Default::default(),
            amp: [attack, decay, sustain, release],
            sides: [1.0; 2],
            grid,
            block: vec![0.0; grid * 2],
            used: grid,
        }
    }

    /// Start with this rack after the engines. It is given room here for the
    /// deck's stereo block (the grid, two channels), off the audio thread:
    /// since the rack went planar (MGL 66cc8ed) it grows its scratch on the
    /// first block bigger than it was given, which would be in the callback.
    pub fn rack(mut self, mut rack: mgl_fx::Rack) -> Grain {
        self.rebuildable = false;
        rack.reserve_mix(self.grid * 2);
        self.shared.set_rack(Some(rack));
        self
    }

    /// Start with the sound's separated parts (the Hybrid engine's).
    pub fn parts(mut self, parts: Arc<Parts>) -> Grain {
        self.rebuildable = false;
        self.shared.set_parts(parts);
        self
    }

    /// Offer the deck what is in the box. The box comes back when it is
    /// finished with; `None` means the deck could not take it this instant
    /// and it waits here for the next line. A newer thing of the same kind
    /// takes the place of one still waiting, which then goes back unused.
    fn hand(&mut self, mut boxed: Box<GrainThing>) -> Option<Box<GrainThing>> {
        // Each arm leaves in the box what goes back to the app, or, on a
        // miss, the thing itself to offer again.
        let (kind, taken) = match std::mem::replace(&mut *boxed, GrainThing::Taken) {
            GrainThing::Params(params) => {
                let taken = self.shared.put_params(params);
                if !taken {
                    *boxed = GrainThing::Params(params);
                }
                (PARAMS, taken)
            }
            GrainThing::Source(source) => match self.shared.put_source(Arc::clone(&source)) {
                Ok(in_slot) => {
                    // The box goes back holding this module's hold on the
                    // old sound. The deck's own hold goes on its list when
                    // it takes the new one, and whichever is let go last is
                    // freed by the app, not here.
                    let old = std::mem::replace(&mut self.source, source);
                    // One more hold on a sound `old` also holds.
                    drop(in_slot);
                    *boxed = GrainThing::Source(old);
                    (SOUND, true)
                }
                Err(offered) => {
                    // A second hold on `source`, which stays in the box.
                    drop(offered);
                    *boxed = GrainThing::Source(source);
                    (SOUND, false)
                }
            },
            GrainThing::Parts(parts) => match self.shared.put_parts(Arc::clone(&parts)) {
                Ok(old) => {
                    // The deck holds the new one now, so this is not the last.
                    drop(parts);
                    *boxed = GrainThing::OldParts(old);
                    (PARTS, true)
                }
                Err(offered) => {
                    drop(offered);
                    *boxed = GrainThing::Parts(parts);
                    (PARTS, false)
                }
            },
            // For these three, MGL's `put` forms: the new thing is left for
            // the deck, and whatever was still waiting there unclaimed goes
            // back in the box. What the deck itself replaces goes on its
            // list, for the app's `Handle::collect`.
            GrainThing::Rack(rack) => match self.shared.put_rack(rack) {
                Ok(unclaimed) => {
                    if let Some(unclaimed) = unclaimed {
                        *boxed = GrainThing::Rack(unclaimed);
                    }
                    (RACK, true)
                }
                Err(rack) => {
                    *boxed = GrainThing::Rack(rack);
                    (RACK, false)
                }
            },
            GrainThing::Bank(bank) => match self.shared.put_bank(bank) {
                Ok(unclaimed) => {
                    if let Some(unclaimed) = unclaimed {
                        *boxed = GrainThing::Bank(unclaimed);
                    }
                    (BANK, true)
                }
                Err(bank) => {
                    *boxed = GrainThing::Bank(bank);
                    (BANK, false)
                }
            },
            GrainThing::Map(map) => match self.shared.put_map(map) {
                Ok(unclaimed) => {
                    if let Some(unclaimed) = unclaimed {
                        *boxed = GrainThing::Map(unclaimed);
                    }
                    (MAP, true)
                }
                Err(map) => {
                    *boxed = GrainThing::Map(map);
                    (MAP, false)
                }
            },
            GrainThing::Seek(frame) => {
                self.shared.request_seek(frame);
                return Some(boxed);
            }
            GrainThing::Loop { on, a, b } => {
                self.shared.set_loop(on, a, b);
                return Some(boxed);
            }
            GrainThing::PitchTime(settings) => {
                self.shared.set_pitch_time(settings);
                return Some(boxed);
            }
            GrainThing::PostRoll(frames) => {
                self.shared.set_post_roll_frames(frames);
                return Some(boxed);
            }
            old @ (GrainThing::OldParts(_) | GrainThing::Taken) => {
                *boxed = old;
                return Some(boxed);
            }
        };
        if taken {
            // An older one of its kind still waiting must not land after it.
            let stale = self.waiting[kind].take();
            self.set_aside(stale);
            Some(boxed)
        } else {
            self.waiting[kind].replace(boxed)
        }
    }

    /// Offer again what the deck could not take last time.
    fn offer_again(&mut self) {
        for kind in 0..KINDS {
            if let Some(waiting) = self.waiting[kind].take() {
                let finished = self.hand(waiting);
                self.set_aside(finished);
            }
        }
    }

    /// Keep a box that is finished with until the engine next asks for what
    /// has finished, which it does after every piece of audio.
    fn set_aside(&mut self, boxed: Option<Box<GrainThing>>) {
        let Some(boxed) = boxed else { return };
        match self.done.iter_mut().find(|slot| slot.is_none()) {
            Some(free) => *free = Some(boxed),
            // No room, which takes eight superseded hand-overs between two
            // pieces of audio. It must not be freed here, so it is let go of
            // without being freed: a few hundred bytes lost, once.
            None => std::mem::forget(boxed),
        }
    }

    /// Start with the layers' engines.
    pub fn bank(mut self, bank: LayerBank) -> Grain {
        self.rebuildable = false;
        self.shared.set_bank(bank);
        self
    }

    /// Make `voices` voices for Poly now, and hold Poly to that many. In MGL
    /// a helper thread makes voices as keys ask and the number allowed
    /// follows how long each block took; here they are made before the deck
    /// plays and the number is fixed, so a performance plays the same twice.
    pub fn poly(self, voices: usize) -> Grain {
        self.shared.voices.set_ceiling(voices as u32);
        mgl_engine::voices::stock(&self.shared, voices, self.grid, 2);
        self
    }

    /// Make the copies of the sound an octave or more up now, which keys
    /// above C8 play from. Without this they are made by a helper thread
    /// when such a key first asks (`Handle::collect` starts it), and until
    /// they arrive the key plays from the sound itself.
    pub fn octaves(mut self) -> Grain {
        self.rebuildable = false;
        self.shared.build_octaves();
        self
    }

    /// The app's side of this deck. Take it before the module goes into the
    /// patch.
    pub fn handle(&self) -> Handle {
        Handle { shared: Arc::clone(&self.shared), grid: self.grid }
    }

    fn play(&mut self, note: &NoteEvent) {
        match note.kind {
            NoteKind::On => {
                self.keys.note_on(note.note, note.velocity);
            }
            NoteKind::Off => self.keys.note_off(note.note),
            NoteKind::AllOff => self.keys.all_off(),
        }
    }

    fn knob(&mut self, index: u32, value: f32) {
        let on = value >= 0.5;
        match index {
            PLAY if on => self.shared.play(),
            PLAY => self.shared.pause(),
            KEY_MODE => self.keys.set_mode(match value as u32 {
                0 => KeyMode::Mono,
                1 => KeyMode::Legato,
                _ => KeyMode::Poly,
            }),
            RUN => self.keys.set_run(on),
            PLAYED => self.keys.set_played(on),
            BEND => self.keys.set_bend(value),
            AMP_ATTACK..=AMP_RELEASE => {
                self.amp[(index - AMP_ATTACK) as usize] = value;
                let [attack, decay, sustain, release] = self.amp;
                self.keys.set_amp(attack, decay, sustain, release);
            }
            KEY_GLIDE => self.keys.set_glide(value),
            START => self.keys.set_start(value),
            VOICES => self.shared.voices.set_ceiling(value.max(0.0) as u32),
            GAIN => self.shared.set_gain(value),
            MUTE => self.shared.set_mute(on),
            SPEED => self.shared.set_speed(value),
            SMOOTHING => self.shared.set_glide(value),
            SIDE_LEFT | SIDE_RIGHT => {
                self.sides[(index - SIDE_LEFT) as usize] = value;
                self.shared.set_side_gains(self.sides[0], self.sides[1]);
            }
            _ => {}
        }
    }
}

impl Module for Grain {
    fn preset_type(&self)->Option<std::any::TypeId> {Some(std::any::TypeId::of::<GrainState>())}
    fn visit_preset(&self,thing:&engine_core::Thing,visit:&mut dyn FnMut(EventKind)) {GrainState::visit(thing,visit);}

    fn transfer(&mut self,from:&dyn Module,_rate:f32) {
        if let Some(from)=(from as &dyn std::any::Any).downcast_ref::<Self>() {self.preset.inherit(&from.preset);}
    }
    fn factory(&self) -> Option<engine_core::ModuleFactory> {
        if !self.rebuildable { return None; }
        let shared = Arc::clone(&self.shared); let grid = self.grid;
        Some(Box::new(move |rate, _| {
            let params = shared.params().expect("grain settings poisoned");
            let source = shared.source().expect("grain source poisoned");
            Box::new(Grain::new(rate as u32, grid, params, source).poly(shared.voices.cap() as usize))
        }))
    }
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Notes]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    /// A message lands between two pieces of audio. The deck has already
    /// made its block up to the next line, so this is first heard from there.
    fn handle(&mut self, event: &EventKind) {
        if let EventKind::Param {index,value}=*event {self.preset.update(index,value);}
        match *event {
            EventKind::Param { index, value } => self.knob(index, value),
            EventKind::Note(note) => self.play(&note),
            _ => {}
        }
    }
    fn process(&mut self, io: &mut Io) {
        let notes = io.ins.notes(0);
        let (l, r) = io.outs.audio(0);
        let n = l.len();
        let mut next = 0;
        let mut at = 0;
        while at < n {
            if self.used == self.grid {
                // A line: the notes due by now, then the deck's next block.
                while next < notes.len() && notes[next].offset as usize <= at {
                    self.play(&notes[next]);
                    next += 1;
                }
                if self.waiting.iter().any(Option::is_some) {
                    self.offer_again();
                }
                self.core.fill(&mut self.block, 2, &self.shared);
                self.used = 0;
            }
            let run = (self.grid - self.used).min(n - at);
            for (i, frame) in self.block[self.used * 2..(self.used + run) * 2].chunks_exact(2).enumerate() {
                l[at + i] = frame[0];
                r[at + i] = frame[1];
            }
            self.used += run;
            at += run;
        }
        // Notes after this piece's last line are first heard from the next.
        while next < notes.len() {
            self.play(&notes[next]);
            next += 1;
        }
    }
    fn take(&mut self, slot: u32, thing: Thing) -> Option<Thing> {
        if slot==engine_core::PRESET {
            let incoming=match thing.downcast::<GrainState>() {Ok(state)=>state,Err(other)=>return Some(other)};
            let (old,controls)=GrainState::exchange(&mut self.preset,incoming);
            for &(index,value) in &controls {self.handle(&EventKind::Param {index,value});}
            self.preset.restore(controls);
            return Some(old as engine_core::Thing);
        }

        match thing.downcast::<GrainThing>() {
            Ok(boxed) => self.hand(boxed).map(|boxed| boxed as Thing),
            Err(other) => Some(other),
        }
    }
    fn finished(&mut self) -> Option<Thing> {
        self.done.iter_mut().find_map(|slot| slot.take()).map(|boxed| boxed as Thing)
    }
    fn hands_back(&self) -> bool {
        true
    }
}
