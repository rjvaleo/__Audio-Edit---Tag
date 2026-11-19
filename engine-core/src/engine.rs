//! The two halves: the controller on the app's thread and the audio engine
//! on the sound card's.

mod waiting;
use waiting::Pending;

use crate::module::{EventKind, Module, Thing};
use crate::plan::{Ghosts, Info, PatchState, Plan, Spec, MAX_MODULE_ID};
use crate::rt;
use crate::sound::{SoundData, Sounds, MAX_SOUNDS};
use crate::spsc::{self, Consumer, Producer};
use crate::types::{Cable, Kind, ModuleId, PortRef, SoundRef};
use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use crate::rebuild::{ModuleFactory, Remember};
use std::sync::Arc;

#[derive(Clone, Copy, Debug)]
pub struct Config {
    /// Opt in to the fixed render pool. Disabled in production defaults.
    pub parallel: bool,
    /// Called once on each worker, before it renders (host workgroup hook).
    pub worker_init: Option<fn(usize)>,
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
        Self {
            parallel: cfg!(feature = "pool-tests"),
            worker_init: None,
            max_block: 1024,
            queue: 4096,
            log_applied: false,
            fade_frames: 480,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum PatchError {
    DuplicateModule(ModuleId),
    BadModuleId(ModuleId),
    NoSuchPort(PortRef),
    KindMismatch {
        from: PortRef,
        to: PortRef,
    },
    /// Only audio goes to the sound card.
    NotAudio(PortRef),
    /// A clock or sound input takes one cable.
    ManySources(PortRef),
    /// These modules form a loop with no delay in it.
    Cycle(Vec<ModuleId>),
    BadSoundId(u32),
    /// The audio thread has not caught up. Nothing was sent.
    QueueFull,
    InvalidRate,
    UnsupportedRate(ModuleId),
    RateBusy,
}

/// What a call to [`Controller::collect`] freed.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Collected {
    pub plans: usize,
    pub sounds: usize,
    /// Things modules were handed and have finished with.
    pub things: usize,
}

struct RateChange {
    old: Option<Box<Plan>>,
    rate: f32,
    old_rate: f32,
    left: Vec<f32>,
    right: Vec<f32>,
    at: usize,
    length: usize,
}

enum Msg {
    Rate { plan: Box<Plan>, change: Box<RateChange> },
    Event {
        module: ModuleId,
        kind: EventKind,
    },
    /// A patch change. `after` is the plan that takes over once the change's
    /// fades are done, when it leaves anything fading out.
    Plan {
        plan: Box<Plan>,
        after: Option<Box<Plan>>,
    },
    /// That second plan, waiting for its frame on the audio thread.
    After(Box<Plan>),
    Sound {
        id: u32,
        version: u32,
        data: Option<Arc<SoundData>>,
    },
    /// Something built on the app's thread, for one module to take.
    Thing {
        module: ModuleId,
        slot: u32,
        thing: Thing,
    },
}

/// A message, the frame it lands on (0: as soon as possible) and its number.
struct Stamped {
    frame: u64,
    seq: u64,
    msg: Msg,
}

/// What the audio thread sends back: things to free, and where messages landed.
enum Back {
    Recording(crate::RecordingReport),
    Failure {
        report: Failure,
        payload: Thing,
    },
    Plan(Box<Plan>),
    Sound(Arc<SoundData>),
    Thing(Thing),
    Applied {
        seq: u64,
        frame: u64,
    },
    /// The fades of this patch change are over and its second plan is in place.
    Settled {
        generation: u64,
    },
}

/// Make an engine: its controller for the app's thread and its audio half
/// for the sound card's.
pub fn engine(rate: f32, config: Config) -> (Controller, AudioEngine) {
    rt::install_panic_hook();
    let max_block = config.max_block.max(1);
    let queue = config.queue.max(16);
    let (tx, rx) = spsc::channel(queue);
    let (back_tx, back_rx) = spsc::channel(queue);
    let bad = Arc::new(AtomicU64::new(0));
    let changing = Arc::new(AtomicBool::new(false));
    let controller = Controller {
        room: queue,
        changing: Arc::clone(&changing),
        factories: BTreeMap::new(),
        preset_types: BTreeMap::new(),
        opaque_state: BTreeSet::new(),
        bad: Arc::clone(&bad),
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
        failures: Vec::new(),
        recording: Vec::new(),
        versions: BTreeMap::new(),
    };
    let audio = AudioEngine {
        events: Vec::with_capacity(queue),
        pieces: 0,
        workers: if config.parallel { crate::pool::Pool::new(config.worker_init) } else { None },
        changing,
        transition: None,
        bad,
        rate,
        max_block,
        frame: 0,
        rx,
        tx: back_tx,
        pending: Pending::new(queue),
        held: Vec::with_capacity(queue),
        room: queue,
        fade: config.fade_frames as u64,
        plan: Box::new(Plan::empty(max_block)),
        sounds: Sounds::new(),
        log_applied: config.log_applied,
        lost: 0,
        failed: false,
    };
    (controller, audio)
}

/// The app's side. Holds the patch and sends everything across.
/// A caught panic. The controller receives each fault once, when it collects.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    ModulePanicked { id: ModuleId },
    BoundaryPanicked,
}

pub struct Controller {
    room: usize,
    changing: Arc<AtomicBool>,
    factories: BTreeMap<ModuleId, ModuleFactory>,
    preset_types: BTreeMap<ModuleId, std::any::TypeId>,
    opaque_state: BTreeSet<ModuleId>,
    failures: Vec<Failure>,
    recording: Vec<crate::RecordingReport>,
    /// See [`Controller::bad_blocks`].
    bad: Arc<AtomicU64>,
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
    /// Construct replacements only on this thread. Existing `add` modules
    /// remain supported; changing their rate requires an explicit factory.
    pub fn add_with_factory(&mut self, id: ModuleId, factory: ModuleFactory) -> Result<(), PatchError> {
        let module = Box::new(Remember::new(factory(self.rate, self.max_block)));
        self.add(id, module)?;
        self.factories.insert(id, factory);
        Ok(())
    }

    pub fn rate(&self) -> f32 { self.rate }

    /// Rebuild the edited patch at a new output rate. Unsupported patches
    /// fail before any controller or audio state changes.
    pub fn set_rate(&mut self, rate: f32) -> Result<u64, PatchError> {
        if !rate.is_finite() || rate <= 0.0 { return Err(PatchError::InvalidRate); }
        if self.changing.load(Ordering::Acquire) { return Err(PatchError::RateBusy); }
        for id in self.now.infos.keys() {
            if !self.factories.contains_key(id) || self.opaque_state.contains(id) { return Err(PatchError::UnsupportedRate(*id)); }
        }
        if self.tx.is_full() { return Err(PatchError::QueueFull); }
        let mut staged = BTreeMap::new();
        let mut patch = self.now.clone();
        for (&id, factory) in &self.factories {
            if !patch.infos.contains_key(&id) { continue; }
            let mut module: Box<dyn Module> = Box::new(Remember::new(factory(rate, self.max_block)));
            module.prepare(rate, self.max_block);
            if let Some(old) = self.staged.get(&id) {
                old.visit_events(&mut |event| module.handle(&event));
            }
            patch.infos.insert(id, Info { parallel: module.parallel_weight(), inputs: module.inputs(), outputs: module.outputs(),
                feedback_delay: module.feedback_delay(), latency: module.latency(),
                tail: module.tail(), can_sleep: module.can_sleep() });
            staged.insert(id, module);
        }
        let generation = self.generation + 1;
        let replaced = BTreeSet::new();
        let spec = Spec::of(&patch, &patch, &replaced, 0, generation, self.max_block, true);
        let mut plan = Box::new(Plan::compile(&spec, &mut staged)?);
        plan.reserve_events(self.room);
        let change = Box::new(RateChange { old: None, rate, old_rate: self.rate,
            left: vec![0.0; self.max_block], right: vec![0.0; self.max_block],
            at: 0, length: self.fade });
        self.changing.store(true, Ordering::Release);
        let seq = match self.push(self.last_plan_frame, Msg::Rate { plan, change }) {
            Ok(seq) => seq,
            Err(error) => { self.changing.store(false, Ordering::Release); return Err(error); }
        };
        self.staged.clear();
        self.now = patch;
        self.sent = self.now.clone();
        self.lingering = Ghosts::default();
        self.generation = generation;
        self.rate = rate;
        Ok(seq)
    }

    /// Add a module to the patch. It is heard after the next `commit`.
    pub fn add(&mut self, id: ModuleId, mut module: Box<dyn Module>) -> Result<(), PatchError> {
        if id > MAX_MODULE_ID {
            return Err(PatchError::BadModuleId(id));
        }
        if self.now.infos.contains_key(&id) {
            return Err(PatchError::DuplicateModule(id));
        }
        if let Some(kind)=module.preset_type() {self.preset_types.insert(id,kind);}
        if let Some(factory) = module.factory() {
            self.factories.insert(id, factory);
            module = Box::new(Remember::new(module));
        }
        module.prepare(self.rate, self.max_block);
        self.now.infos.insert(
            id,
            Info {
                parallel: module.parallel_weight(),
                inputs: module.inputs(),
                outputs: module.outputs(),
                feedback_delay: module.feedback_delay(),
                latency: module.latency(),
                tail: module.tail(),
                can_sleep: module.can_sleep(),
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
        self.factories.remove(&id);
        self.preset_types.remove(&id);
        self.opaque_state.remove(&id);
        self.now
            .cables
            .retain(|cable| cable.from.module != id && cable.to.module != id);
        self.now.outs.retain(|port| port.module != id);
        true
    }

    fn output_kind(&self, port: PortRef) -> Result<Kind, PatchError> {
        self.now
            .infos
            .get(&port.module)
            .and_then(|info| info.outputs.get(port.port as usize))
            .copied()
            .ok_or(PatchError::NoSuchPort(port))
    }

    fn input_kind(&self, port: PortRef) -> Result<Kind, PatchError> {
        self.now
            .infos
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
            Spec::of(
                &self.now,
                &self.sent,
                &replaced,
                self.fade,
                generation,
                self.max_block,
                settled,
            )
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
                after = Plan::compile(&spec(true), &mut BTreeMap::new())
                    .ok()
                    .map(Box::new);
                plan = Some(first);
                lingering = ghosts;
            }
        }
        // Nothing to fade out, or the old cables and the new would make a
        // loop together: the new patch alone, its new cables fading in.
        let mut plan = match plan {
            Some(plan) => plan,
            None => Plan::compile(&spec(false), &mut self.staged)?,
        };
        plan.reserve_events(self.room);
        if let Some(after) = after.as_mut() { after.reserve_events(self.room); }
        let frame = frame.max(self.last_plan_frame);
        let seq = self.push(
            frame,
            Msg::Plan {
                plan: Box::new(plan),
                after,
            },
        )?;
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
            if let Some(info) = self.now.infos.get_mut(&module) {
                info.latency = staged.latency();
                info.tail = staged.tail();
                info.can_sleep = staged.can_sleep();
            }
            return Ok(self.seq);
        }
        self.push(0, Msg::Event { module, kind })
    }

    /// Send a module a message to land on `frame`.
    pub fn send_at(
        &mut self,
        frame: u64,
        module: ModuleId,
        kind: EventKind,
    ) -> Result<u64, PatchError> {
        self.push(frame, Msg::Event { module, kind })
    }

    /// Hand a module something built on this thread, to take at the next
    /// block. What the module returns for it, and the thing itself if the
    /// module is not there, comes back to be freed by `collect`. A module
    /// not yet committed takes it at once.
    pub fn give(&mut self, module: ModuleId, slot: u32, thing: Thing) -> Result<u64, PatchError> {
        let preset=slot==crate::PRESET && self.preset_types.get(&module)==Some(&thing.as_ref().type_id());
        // An arbitrary Thing cannot be cloned or reconstructed generically.
        // Refuse a later rebuild rather than silently discard that state.
        if let Some(staged) = self.staged.get_mut(&module) {
            drop(staged.take(slot, thing));
            if !preset {self.opaque_state.insert(module);}
            return Ok(self.seq);
        }
        let result = self.push(0, Msg::Thing { module, slot, thing });
        if result.is_ok() && !preset { self.opaque_state.insert(module); }
        result
    }

    /// Hand a module something to take on `frame`.
    pub fn give_at(
        &mut self,
        frame: u64,
        module: ModuleId,
        slot: u32,
        thing: Thing,
    ) -> Result<u64, PatchError> {
        let preset=slot==crate::PRESET && self.preset_types.get(&module)==Some(&thing.as_ref().type_id());
        let result = self.push(frame, Msg::Thing { module, slot, thing });
        if result.is_ok() && !preset { self.opaque_state.insert(module); }
        result
    }

    /// Put a sound in the bank under `id`, replacing any there. The version
    /// returned is the one modules must ask for.
    pub fn load_sound(&mut self, id: u32, data: SoundData) -> Result<SoundRef, PatchError> {
        self.load_sound_at(0, id, data)
    }

    pub fn load_sound_at(
        &mut self,
        frame: u64,
        id: u32,
        data: SoundData,
    ) -> Result<SoundRef, PatchError> {
        if id == 0 || id as usize >= MAX_SOUNDS {
            return Err(PatchError::BadSoundId(id));
        }
        let version = self.versions.get(&id).copied().unwrap_or(0) + 1;
        self.push(
            frame,
            Msg::Sound {
                id,
                version,
                data: Some(Arc::new(data)),
            },
        )?;
        self.versions.insert(id, version);
        Ok(SoundRef { id, version })
    }

    /// How many times a module's output, or a whole block on its way out,
    /// was silenced because it held something that was not a number. It
    /// should stay at zero: anything else is a fault in a module, to find.
    pub fn bad_blocks(&self) -> u64 {
        self.bad.load(Ordering::Relaxed)
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
                Back::Recording(report) => self.recording.push(report),
                Back::Failure { report, payload } => {
                    self.failures.push(report);
                    drop(payload);
                }
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
    /// Faults received by collect. Replace the failed module and commit the
    /// rebuilt patch to revive it; ordinary events never retry a dead node.
    /// Recorder notices gathered by collect; overflow counters remain live.
    pub fn take_recording_reports(&mut self) -> Vec<crate::RecordingReport> { std::mem::take(&mut self.recording) }

    pub fn take_failures(&mut self) -> Vec<Failure> {
        std::mem::take(&mut self.failures)
    }

    pub fn take_applied(&mut self) -> Vec<(u64, u64)> {
        std::mem::take(&mut self.applied)
    }
}

/// The sound card's side. `render` is the audio callback.
pub struct AudioEngine {
    events: Vec<(ModuleId, u32, EventKind)>,
    pieces: u64,
    workers: Option<crate::pool::Pool>,
    changing: Arc<AtomicBool>,
    transition: Option<Box<RateChange>>,
    failed: bool,
    bad: Arc<AtomicU64>,
    rate: f32,
    max_block: usize,
    frame: u64,
    rx: Consumer<Stamped>,
    tx: Producer<Back>,
    /// Messages waiting for their frame, earliest first.
    pending: Pending,
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
    pub fn worker_jobs(&self) -> usize { self.workers.as_ref().map_or(0, |pool| pool.worker_jobs()) }

    /// Enclosing plan pieces rendered, excluding the outgoing rate plan.
    pub fn pieces(&self) -> u64 { self.pieces }

    pub fn lost(&self) -> u64 {
        self.lost
    }

    /// Make the next block. Any length; the two sides are filled alike.
    pub fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        self.render_io(&[], left, right);
    }

    /// Planar input channels, borrowed for this callback. Missing channels
    /// or trailing input frames are zero; no additional input latency.
    pub fn render_io(&mut self, inputs: &[&[f32]], left: &mut [f32], right: &mut [f32]) {
        self.render_host(&inputs, left, right);
    }

    /// A host adapter can supply channels without allocating a slice table.
    pub fn render_host(&mut self, inputs: &dyn crate::HostAudio, left: &mut [f32], right: &mut [f32]) {
        let host = crate::HostInputs::new(inputs, self.frame);
        let _guard = rt::enter();
        if self.failed {
            left.fill(0.0);
            right.fill(0.0);
            return;
        }
        let total = left.len().min(right.len());
        self.flush_held();
        self.take_messages();
        let mut pos = 0;
        while pos < total {
            self.apply_due();
            let mut n = (total - pos).min(self.max_block).min(self.plan.piece());
            if let Some(change) = &self.transition {
                n = n.min(change.old.as_ref().unwrap().piece());
            }
            if let Some(boundary) = self.pending.boundary() {
                // Only ownership/graph/sound-bank changes cut the graph.
                let until = boundary - self.frame;
                if until < n as u64 {
                    n = until as usize;
                }
            }
            let frame = self.frame;
            self.events.clear();
            while self.pending.first().is_some_and(|message| message.frame < frame+n as u64) {
                let Stamped { frame: stamp, seq, msg } = self.pending.pop().unwrap();
                let Msg::Event { module, kind } = msg else { unreachable!("structural boundary cuts the piece"); };
                self.events.push((module, (stamp-frame) as u32, kind));
                self.applied(seq, stamp);
            }
            self.gather();
            self.pieces += 1;
            self.plan.run(
                n,
                self.rate,
                frame,
                &self.sounds,
                &mut left[pos..pos + n],
                &mut right[pos..pos + n],
                self.workers.as_mut(),
                &self.events,
                host,
            );
            if let Some(change) = self.transition.as_mut() {
                change.old.as_mut().unwrap().run(n, change.old_rate, frame, &self.sounds,
                    &mut change.left[..n], &mut change.right[..n], self.workers.as_mut(), &self.events, host);
                let tripped = change.old.as_mut().unwrap().take_tripped();
                if tripped > 0 { self.bad.fetch_add(tripped, Ordering::Relaxed); }
                for i in 0..n {
                    let gain = if change.length == 0 { 1.0 } else {
                        ((change.at + i + 1) as f32 / change.length as f32).min(1.0)
                    };
                    if gain < 1.0 {
                        left[pos+i] = change.left[i] * (1.0-gain) + left[pos+i] * gain;
                        right[pos+i] = change.right[i] * (1.0-gain) + right[pos+i] * gain;
                    }
                }
                change.at += n;
            }
            if self.transition.as_ref().is_some_and(|change| change.at >= change.length) {
                self.gather();
                self.report_panics();
                let done = self.transition.take().unwrap();
                self.give_back(Back::Thing(done));
                self.changing.store(false, Ordering::Release);
            }
            pos += n;
            self.frame += n as u64;
            self.gather();
            self.report_panics();
        }
        let tripped = self.plan.take_tripped();
        if tripped > 0 {
            self.bad.fetch_add(tripped, Ordering::Relaxed);
        }
    }

    /// The last stage, for a host about to hand a rendered block to the sound
    /// card: see [`crate::guard::finish`]. Counted with the modules' own.
    pub fn finish(&self, left: &mut [f32], right: &mut [f32]) {
        if crate::guard::finish(left, right) {
            self.bad.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// Last-resort C boundary containment. Never retry a partly unwound engine.
    pub fn contain_panic(&mut self, payload: Thing) {
        self.failed = true;
        self.give_back(Back::Failure {
            report: Failure::BoundaryPanicked,
            payload,
        });
    }

    pub fn failed(&self) -> bool {
        self.failed
    }

    fn recording_reports(&mut self) {
        for _ in 0..self.room {
            let Some(report)=self.plan.recording_report() else { break; };
            self.give_back(Back::Recording(report));
        }
        for _ in 0..self.room {
            let report=self.transition.as_mut().and_then(|change| change.old.as_mut()).and_then(|plan| plan.recording_report());
            let Some(report)=report else { break; };
            self.give_back(Back::Recording(report));
        }
    }

    fn report_panics(&mut self) {
        self.recording_reports();
        while let Some((id, payload)) = self.plan.take_panic() {
            self.give_back(Back::Failure { report: Failure::ModulePanicked { id }, payload });
        }
        loop {
            let panic = self.transition.as_mut().and_then(|change| change.old.as_mut()).and_then(|plan| plan.take_panic());
            let Some((id, payload)) = panic else { break; };
            self.give_back(Back::Failure { report: Failure::ModulePanicked { id }, payload });
        }
    }

    /// Poll before the piece, so a finished() fault cannot publish that
    /// module’s output to downstream consumers for the piece.
    fn gather(&mut self) {
        self.report_panics();
        while self.held.len() < self.room {
            let finished = self.plan.finished().or_else(|| self.transition.as_mut()
                .and_then(|change| change.old.as_mut()).and_then(|plan| plan.finished()));
            match finished {
                Some(thing) => self.give_back(Back::Thing(thing)),
                None => break,
            }
        }
        self.report_panics();
    }

    /// Move what has arrived into the waiting list, in frame order and, on
    /// one frame, in the order sent.
    fn take_messages(&mut self) {
        while self.pending.len() < self.room {
            let Some(mut message) = self.rx.pop() else {
                break;
            };
            if message.frame < self.frame {
                message.frame = self.frame;
            }
            self.pending.push(message);
        }
    }

    fn apply_due(&mut self) {
        while self.pending.boundary().is_some_and(|frame| frame <= self.frame) {
            let Stamped { seq, msg, .. } = self.pending.pop().unwrap();
            match msg {
                Msg::Event { module, kind } => {
                    self.plan.handle(module, &kind);
                    if let Some(change) = self.transition.as_mut() {
                        change.old.as_mut().unwrap().handle(module, &kind);
                    }
                },
                Msg::Rate { mut plan, mut change } => {
                    self.plan.rate_change(change.rate,self.frame);
                    self.recording_reports();
                    plan.rehome(&self.plan, change.rate);
                    change.old = Some(std::mem::replace(&mut self.plan, plan));
                    self.rate = change.rate;
                    self.transition = Some(change);
                },
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
                Msg::Thing {
                    module,
                    slot,
                    thing,
                } => {
                    if let Some(done) = self.plan.give(module, slot, thing) {
                        self.give_back(Back::Thing(done));
                    }
                }
            }
            self.report_panics();
            self.applied(seq, self.frame);
        }
    }

    fn applied(&mut self, seq: u64, frame: u64) {
        if seq != 0 && self.log_applied && self.tx.push(Back::Applied { seq, frame }).is_err() {
            self.lost += 1;
        }
    }

    /// Put a plan in place, keeping the modules and cable levels it shares
    /// with the one before.
    fn land(&mut self, mut plan: Box<Plan>) {
        self.report_panics();
        plan.adopt(&mut self.plan);
        let old = std::mem::replace(&mut self.plan, plan);
        self.give_back(Back::Plan(old));
    }

    /// Line up the plan that takes over when the fades just started are done.
    fn follow_with(&mut self, after: Box<Plan>) {
        if self.pending.len() < self.room {
            let frame = self.frame + self.fade + 2;
            self.pending.push(Stamped { frame, seq: 0, msg: Msg::After(after) });
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
