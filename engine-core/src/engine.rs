//! The two halves: the controller on the app's thread and the audio engine
//! on the sound card's.

use crate::module::{EventKind, Module, Thing};
use crate::plan::{Ghosts, Info, PatchState, Plan, Spec, MAX_MODULE_ID};
use crate::rt;
use crate::sound::{SoundData, Sounds, MAX_SOUNDS};
use crate::spsc::{self, Consumer, Producer};
use crate::types::{Cable, Kind, ModuleId, PortRef, SoundRef};
use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::sync::Arc;

#[derive(Clone, Copy, Debug)]
pub struct Config {
    /// The longest piece of audio made in one go. A bigger block from the
    /// sound card is made in several.
    pub max_block: usize,
    /// Room in each queue, and for messages waiting for their frame.
    pub queue: usize,
    /// Report the frame every message landed on, for a replay.
    pub log_applied: bool,
    /// How long a cable takes to fade in or out when the patch changes, in
    /// frames. 0: changes are instant.
    pub fade_frames: usize,
}

impl Default for Config {
    fn default() -> Self {
        Self { max_block: 1024, queue: 4096, log_applied: false, fade_frames: 480 }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum PatchError {
    DuplicateModule(ModuleId),
    BadModuleId(ModuleId),
    NoSuchPort(PortRef),
    KindMismatch { from: PortRef, to: PortRef },
    /// Only audio goes to the sound card.
    NotAudio(PortRef),
    /// A clock or sound input takes one cable.
    ManySources(PortRef),
    /// These modules form a loop with no delay in it.
    Cycle(Vec<ModuleId>),
    BadSoundId(u32),
    /// The audio thread has not caught up. Nothing was sent.
    QueueFull,
}

/// What a call to [`Controller::collect`] freed.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Collected {
    pub plans: usize,
    pub sounds: usize,
    /// Things modules were handed and have finished with.
    pub things: usize,
}

enum Msg {
    Event { module: ModuleId, kind: EventKind },
    /// A patch change. `after` is the plan that takes over once the change's
    /// fades are done, when it leaves anything fading out.
    Plan { plan: Box<Plan>, after: Option<Box<Plan>> },
    /// That second plan, waiting for its frame on the audio thread.
    After(Box<Plan>),
    Sound { id: u32, version: u32, data: Option<Arc<SoundData>> },
    /// Something built on the app's thread, for one module to take.
    Thing { module: ModuleId, slot: u32, thing: Thing },
}

/// A message, the frame it lands on (0: as soon as possible) and its number.
struct Stamped {
    frame: u64,
    seq: u64,
    msg: Msg,
}

/// What the audio thread sends back: things to free, and where messages landed.
enum Back {
    Plan(Box<Plan>),
    Sound(Arc<SoundData>),
    Thing(Thing),
    Applied { seq: u64, frame: u64 },
    /// The fades of this patch change are over and its second plan is in place.
    Settled { generation: u64 },
}

/// Make an engine: its controller for the app's thread and its audio half
/// for the sound card's.
pub fn engine(rate: f32, config: Config) -> (Controller, AudioEngine) {
    let max_block = config.max_block.max(1);
    let queue = config.queue.max(16);
    let (tx, rx) = spsc::channel(queue);
    let (back_tx, back_rx) = spsc::channel(queue);
    let controller = Controller {
        rate,
        max_block,
        tx,
        rx: back_rx,
        now: PatchState::default(),
        sent: PatchState::default(),
        lingering: Ghosts::default(),
        staged: BTreeMap::new(),
        fade: config.fade_frames,
        generation: 0,
        seq: 0,
        last_plan_frame: 0,
        applied: Vec::new(),
        versions: BTreeMap::new(),
    };
    let audio = AudioEngine {
        rate,
        max_block,
        frame: 0,
        rx,
        tx: back_tx,
        pending: Vec::with_capacity(queue),
        held: Vec::with_capacity(queue),
        room: queue,
        fade: config.fade_frames as u64,
        plan: Box::new(Plan::empty(max_block)),
        sounds: Sounds::new(),
        log_applied: config.log_applied,
        lost: 0,
    };
    (controller, audio)
}

/// The app's side. Holds the patch and sends everything across.
pub struct Controller {
    rate: f32,
    max_block: usize,
    tx: Producer<Stamped>,
    rx: Consumer<Back>,
    /// The patch as edited, and as it was when last sent.
    now: PatchState,
    sent: PatchState,
    /// What the last change left fading out, as far as this thread knows.
    lingering: Ghosts,
    /// Modules added since the last plan, still on this thread.
    staged: BTreeMap<ModuleId, Box<dyn Module>>,
    fade: usize,
    generation: u64,
    seq: u64,
    last_plan_frame: u64,
    applied: Vec<(u64, u64)>,
    versions: BTreeMap<u32, u32>,
}

impl Controller {
    /// Add a module to the patch. It is heard after the next `commit`.
    pub fn add(&mut self, id: ModuleId, mut module: Box<dyn Module>) -> Result<(), PatchError> {
        if id > MAX_MODULE_ID {
            return Err(PatchError::BadModuleId(id));
        }
        if self.now.infos.contains_key(&id) {
            return Err(PatchError::DuplicateModule(id));
        }
        module.prepare(self.rate, self.max_block);
        self.now.infos.insert(
            id,
            Info {
                inputs: module.inputs(),
                outputs: module.outputs(),
                feedback_delay: module.feedback_delay(),
            },
        );
        self.staged.insert(id, module);
        Ok(())
    }

    /// Take a module and its cables out of the patch.
    pub fn remove(&mut self, id: ModuleId) -> bool {
        if self.now.infos.remove(&id).is_none() {
            return false;
        }
        self.staged.remove(&id);
        self.now.cables.retain(|cable| cable.from.module != id && cable.to.module != id);
        self.now.outs.retain(|port| port.module != id);
        true
    }

    fn output_kind(&self, port: PortRef) -> Result<Kind, PatchError> {
        self.now.infos
            .get(&port.module)
            .and_then(|info| info.outputs.get(port.port as usize))
            .copied()
            .ok_or(PatchError::NoSuchPort(port))
    }

    fn input_kind(&self, port: PortRef) -> Result<Kind, PatchError> {
        self.now.infos
            .get(&port.module)
            .and_then(|info| info.inputs.get(port.port as usize))
            .copied()
            .ok_or(PatchError::NoSuchPort(port))
    }

    /// Run a cable from an output to an input of the same kind.
    pub fn connect(&mut self, from: PortRef, to: PortRef) -> Result<(), PatchError> {
        if self.output_kind(from)? != self.input_kind(to)? {
            return Err(PatchError::KindMismatch { from, to });
        }
        self.now.cables.insert(Cable { from, to });
        Ok(())
    }

    pub fn disconnect(&mut self, from: PortRef, to: PortRef) -> bool {
        self.now.cables.remove(&Cable { from, to })
    }

    /// Send an audio output to the sound card. Several are summed.
    pub fn connect_out(&mut self, from: PortRef) -> Result<(), PatchError> {
        if self.output_kind(from)? != Kind::Audio {
            return Err(PatchError::NotAudio(from));
        }
        self.now.outs.insert(from);
        Ok(())
    }

    pub fn disconnect_out(&mut self, from: PortRef) -> bool {
        self.now.outs.remove(&from)
    }

    fn push(&mut self, frame: u64, msg: Msg) -> Result<u64, PatchError> {
        let seq = self.seq + 1;
        match self.tx.push(Stamped { frame, seq, msg }) {
            Ok(()) => {
                self.seq = seq;
                Ok(seq)
            }
            Err(_) => Err(PatchError::QueueFull),
        }
    }

    /// Compile the patch and send it, to land at the next block.
    pub fn commit(&mut self) -> Result<u64, PatchError> {
        self.commit_at(0)
    }

    /// Compile the patch and send it, to land on `frame`. Plans land in the
    /// order they were sent, so a frame earlier than the plan before's is
    /// moved up to it.
    pub fn commit_at(&mut self, frame: u64) -> Result<u64, PatchError> {
        if self.tx.is_full() {
            return Err(PatchError::QueueFull);
        }
        // A number given to a different module since the last plan.
        let replaced: BTreeSet<ModuleId> = self
            .staged
            .keys()
            .filter(|id| self.sent.infos.contains_key(id) || self.lingering.infos.contains_key(id))
            .copied()
            .collect();
        let generation = self.generation + 1;
        let spec = |settled: bool| {
            Spec::of(&self.now, &self.sent, &replaced, self.fade, generation, self.max_block, settled)
        };
        // First choice: the new patch with what was taken away fading out
        // beside it, then the new patch alone once the fades are over.
        let mut plan = None;
        let mut after = None;
        let mut lingering = Ghosts::default();
        let mut fading = spec(false);
        let ghosts = fading.add_ghosts(&self.now, &self.sent, &self.lingering, &replaced);
        if ghosts.fading() {
            if let Ok(first) = Plan::compile(&fading, &mut self.staged) {
                after = Plan::compile(&spec(true), &mut BTreeMap::new()).ok().map(Box::new);
                plan = Some(first);
                lingering = ghosts;
            }
        }
        // Nothing to fade out, or the old cables and the new would make a
        // loop together: the new patch alone, its new cables fading in.
        let plan = match plan {
            Some(plan) => plan,
            None => Plan::compile(&spec(false), &mut self.staged)?,
        };
        let frame = frame.max(self.last_plan_frame);
        let seq = self.push(frame, Msg::Plan { plan: Box::new(plan), after })?;
        self.last_plan_frame = frame;
        self.generation = generation;
        self.sent = self.now.clone();
        self.lingering = lingering;
        Ok(seq)
    }

    /// Send a module a message, to land at the next block. A module not yet
    /// committed is still on this thread and takes it at once.
    pub fn send(&mut self, module: ModuleId, kind: EventKind) -> Result<u64, PatchError> {
        if let Some(staged) = self.staged.get_mut(&module) {
            staged.handle(&kind);
            return Ok(self.seq);
        }
        self.push(0, Msg::Event { module, kind })
    }

    /// Send a module a message to land on `frame`.
    pub fn send_at(&mut self, frame: u64, module: ModuleId, kind: EventKind) -> Result<u64, PatchError> {
        self.push(frame, Msg::Event { module, kind })
    }

    /// Hand a module something built on this thread, to take at the next
    /// block. What the module returns for it, and the thing itself if the
    /// module is not there, comes back to be freed by `collect`. A module
    /// not yet committed takes it at once.
    pub fn give(&mut self, module: ModuleId, slot: u32, thing: Thing) -> Result<u64, PatchError> {
        if let Some(staged) = self.staged.get_mut(&module) {
            drop(staged.take(slot, thing));
            return Ok(self.seq);
        }
        self.push(0, Msg::Thing { module, slot, thing })
    }

    /// Hand a module something to take on `frame`.
    pub fn give_at(&mut self, frame: u64, module: ModuleId, slot: u32, thing: Thing) -> Result<u64, PatchError> {
        self.push(frame, Msg::Thing { module, slot, thing })
    }

    /// Put a sound in the bank under `id`, replacing any there. The version
    /// returned is the one modules must ask for.
    pub fn load_sound(&mut self, id: u32, data: SoundData) -> Result<SoundRef, PatchError> {
        self.load_sound_at(0, id, data)
    }

    pub fn load_sound_at(&mut self, frame: u64, id: u32, data: SoundData) -> Result<SoundRef, PatchError> {
        if id == 0 || id as usize >= MAX_SOUNDS {
            return Err(PatchError::BadSoundId(id));
        }
        let version = self.versions.get(&id).copied().unwrap_or(0) + 1;
        self.push(frame, Msg::Sound { id, version, data: Some(Arc::new(data)) })?;
        self.versions.insert(id, version);
        Ok(SoundRef { id, version })
    }

    /// The number of the last message sent.
    pub fn last_seq(&self) -> u64 {
        self.seq
    }

    /// Free what the audio thread has finished with and gather its reports.
    /// The app calls this now and then; it is the only place old plans, old
    /// modules and old sounds are freed.
    pub fn collect(&mut self) -> Collected {
        self.collect_with(None)
    }

    fn collect_with(&mut self, mut keep: Option<&mut Vec<Thing>>) -> Collected {
        let mut collected = Collected::default();
        while let Some(back) = self.rx.pop() {
            match back {
                Back::Plan(plan) => {
                    drop(plan);
                    collected.plans += 1;
                }
                Back::Sound(sound) => {
                    drop(sound);
                    collected.sounds += 1;
                }
                Back::Thing(thing) => {
                    match keep.as_mut() {
                        Some(keep) => keep.push(thing),
                        None => drop(thing),
                    }
                    collected.things += 1;
                }
                Back::Applied { seq, frame } => self.applied.push((seq, frame)),
                Back::Settled { generation } => {
                    if generation == self.generation {
                        self.lingering = Ghosts::default();
                    }
                }
            }
        }
        collected
    }

    /// [`Self::collect`], keeping what modules handed back instead of
    /// freeing it: a tape that has been recorded, say. Each thing is put on
    /// the end of `keep` for the caller to look into and free.
    pub fn collect_things(&mut self, keep: &mut Vec<Thing>) -> Collected {
        self.collect_with(Some(keep))
    }

    /// Message number and the frame it landed on, for every message since the
    /// last call (when the engine was made with `log_applied`).
    pub fn take_applied(&mut self) -> Vec<(u64, u64)> {
        std::mem::take(&mut self.applied)
    }
}

/// The sound card's side. `render` is the audio callback.
pub struct AudioEngine {
    rate: f32,
    max_block: usize,
    frame: u64,
    rx: Consumer<Stamped>,
    tx: Producer<Back>,
    /// Messages waiting for their frame, earliest first.
    pending: Vec<Stamped>,
    /// Things to free that the queue back had no room for yet.
    held: Vec<Back>,
    room: usize,
    fade: u64,
    plan: Box<Plan>,
    sounds: Sounds,
    log_applied: bool,
    lost: u64,
}

impl AudioEngine {
    /// Frames made so far.
    pub fn frame(&self) -> u64 {
        self.frame
    }

    /// Reports dropped, or things leaked, because the app stopped collecting.
    pub fn lost(&self) -> u64 {
        self.lost
    }

    /// Make the next block. Any length; the two sides are filled alike.
    pub fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        let _guard = rt::enter();
        let total = left.len().min(right.len());
        self.flush_held();
        self.take_messages();
        let mut pos = 0;
        while pos < total {
            self.apply_due();
            let mut n = (total - pos).min(self.max_block).min(self.plan.piece());
            if let Some(next) = self.pending.first() {
                // Cut the piece where the next message lands.
                let until = next.frame - self.frame;
                if until < n as u64 {
                    n = until as usize;
                }
            }
            let frame = self.frame;
            self.plan.run(
                n,
                self.rate,
                frame,
                &self.sounds,
                &mut left[pos..pos + n],
                &mut right[pos..pos + n],
            );
            pos += n;
            self.frame += n as u64;
            self.gather();
        }
    }

    /// Ask the modules what they have finished with, and send it back to be
    /// freed. Only while there is somewhere to put it: a module keeps what
    /// it isn't asked for.
    fn gather(&mut self) {
        while self.held.len() < self.room {
            match self.plan.finished() {
                Some(thing) => self.give_back(Back::Thing(thing)),
                None => break,
            }
        }
    }

    /// Move what has arrived into the waiting list, in frame order and, on
    /// one frame, in the order sent.
    fn take_messages(&mut self) {
        while self.pending.len() < self.room {
            let Some(mut message) = self.rx.pop() else { break };
            if message.frame < self.frame {
                message.frame = self.frame;
            }
            let at = self.pending.partition_point(|waiting| waiting.frame <= message.frame);
            self.pending.insert(at, message);
        }
    }

    fn apply_due(&mut self) {
        while self.pending.first().is_some_and(|message| message.frame <= self.frame) {
            let Stamped { seq, msg, .. } = self.pending.remove(0);
            match msg {
                Msg::Event { module, kind } => self.plan.handle(module, &kind),
                Msg::Plan { plan, after } => {
                    self.land(plan);
                    if let Some(after) = after {
                        self.follow_with(after);
                    }
                }
                Msg::After(plan) => {
                    // Only if the change it follows is still the newest.
                    if plan.generation() == self.plan.generation() {
                        let generation = plan.generation();
                        self.land(plan);
                        // If there is no room to say so, the controller only
                        // carries finished fades along a little longer.
                        let _ = self.tx.push(Back::Settled { generation });
                    } else {
                        self.give_back(Back::Plan(plan));
                    }
                }
                Msg::Sound { id, version, data } => {
                    if let Some(old) = self.sounds.set(id, version, data) {
                        self.give_back(Back::Sound(old));
                    }
                }
                Msg::Thing { module, slot, thing } => {
                    if let Some(done) = self.plan.give(module, slot, thing) {
                        self.give_back(Back::Thing(done));
                    }
                }
            }
            if seq != 0 && self.log_applied && self.tx.push(Back::Applied { seq, frame: self.frame }).is_err() {
                self.lost += 1;
            }
        }
    }

    /// Put a plan in place, keeping the modules and cable levels it shares
    /// with the one before.
    fn land(&mut self, mut plan: Box<Plan>) {
        plan.adopt(&mut self.plan);
        let old = std::mem::replace(&mut self.plan, plan);
        self.give_back(Back::Plan(old));
    }

    /// Line up the plan that takes over when the fades just started are done.
    fn follow_with(&mut self, after: Box<Plan>) {
        if self.pending.len() < self.room {
            let frame = self.frame + self.fade + 2;
            let at = self.pending.partition_point(|waiting| waiting.frame <= frame);
            self.pending.insert(at, Stamped { frame, seq: 0, msg: Msg::After(after) });
        } else {
            self.give_back(Back::Plan(after));
        }
    }

    /// Hand something back to be freed. It must never be freed here.
    fn give_back(&mut self, back: Back) {
        if let Err(back) = self.tx.push(back) {
            if self.held.len() < self.room {
                self.held.push(back);
            } else {
                // No room anywhere: leaking it is the one safe thing left.
                std::mem::forget(back);
                self.lost += 1;
            }
        }
    }

    fn flush_held(&mut self) {
        while let Some(back) = self.held.pop() {
            if let Err(back) = self.tx.push(back) {
                self.held.push(back);
                break;
            }
        }
    }
}
