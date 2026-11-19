//! The patch, compiled: the order the modules run in and the buffers they
//! read and write.
//!
//! Made on the app's thread, where allocating is allowed, and then only run.
//! Nothing here is chosen by chance: modules run lowest number first wherever
//! the cables leave a choice, and cables meeting at one input are summed in
//! the order of their sources. The same patch always gives the same plan.
//!
//! A patch change is two plans. The first holds the new patch and, beside
//! it, what the change took away: removed audio and control cables fading
//! out, and removed modules still running so they have something to fade.
//! New cables fade in. When the fades are over the second plan, the new patch
//! alone, takes its place.

mod parallel;
use crate::engine::PatchError;
use crate::guard::all_finite;
use crate::module::{EventKind, Inputs, Io, Module, Outputs, Thing};
use crate::sound::Sounds;
use crate::types::{Buf, Cable, Kind, ModuleId, NoteEvent, PortRef};
use std::collections::{BTreeMap, BTreeSet};
use std::panic::{catch_unwind, AssertUnwindSafe};

/// Module numbers stop here, so the audio thread can find a module by its
/// number in a table.
pub(crate) const MAX_MODULE_ID: ModuleId = 1 << 16;

/// What the controller remembers about a module once the module itself has
/// gone to the audio thread.
#[derive(Clone)]
pub(crate) struct Info {
    pub parallel: usize,
    pub inputs: Vec<Kind>,
    pub outputs: Vec<Kind>,
    pub feedback_delay: usize,
    pub latency: usize,
    pub tail: usize,
    pub can_sleep: bool,
}

/// A patch as the controller holds it: which modules, which cables, and
/// which outputs the sound card hears.
#[derive(Clone, Default)]
pub(crate) struct PatchState {
    pub infos: BTreeMap<ModuleId, Info>,
    pub cables: BTreeSet<Cable>,
    pub outs: BTreeSet<PortRef>,
}

/// What a cable does when its plan lands.
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Fade {
    /// It was there before and stays.
    Steady,
    /// New: rises from silence.
    In,
    /// Taken away: falls to silence.
    Out,
}

#[derive(Clone, Copy)]
pub(crate) struct Mark {
    pub fade: Fade,
    /// Carry on from the level the same cable had in the plan before.
    pub inherit: bool,
}

/// What a patch change took away and is still fading out: the removed
/// modules kept running, the cables and outputs falling to silence.
#[derive(Clone, Default)]
pub(crate) struct Ghosts {
    pub infos: BTreeMap<ModuleId, Info>,
    pub cables: BTreeMap<Cable, Mark>,
    pub outs: BTreeSet<PortRef>,
}

impl Ghosts {
    /// Is anything in here actually fading?
    pub(crate) fn fading(&self) -> bool {
        !self.outs.is_empty() || self.cables.values().any(|mark| mark.fade == Fade::Out)
    }
}

/// Everything a plan is compiled from.
#[derive(Clone)]
pub(crate) struct Spec<'a> {
    pub infos: BTreeMap<ModuleId, &'a Info>,
    /// Modules the change removed, kept running while they fade.
    pub ghosts: BTreeSet<ModuleId>,
    pub cables: BTreeMap<Cable, Mark>,
    pub outs: BTreeMap<PortRef, Mark>,
    pub fade_frames: usize,
    pub generation: u64,
    pub max_block: usize,
}

fn fades(kind: Option<Kind>) -> bool {
    matches!(kind, Some(Kind::Audio | Kind::Control))
}

impl<'a> Spec<'a> {
    /// The patch as it is `now`, marking what is new since the one `sent`.
    /// `replaced` are numbers given to a different module since then: their
    /// cables start afresh. `settled`: nothing fades (the plan that follows a
    /// change once its fades are over).
    pub(crate) fn of(
        now: &'a PatchState,
        sent: &PatchState,
        replaced: &BTreeSet<ModuleId>,
        fade_frames: usize,
        generation: u64,
        max_block: usize,
        settled: bool,
    ) -> Spec<'a> {
        let mark = |known: bool, a: ModuleId, b: ModuleId| -> Mark {
            let swapped = replaced.contains(&a) || replaced.contains(&b);
            if settled || fade_frames == 0 {
                Mark {
                    fade: Fade::Steady,
                    inherit: true,
                }
            } else if known && !swapped {
                Mark {
                    fade: Fade::Steady,
                    inherit: true,
                }
            } else {
                Mark {
                    fade: Fade::In,
                    inherit: !swapped,
                }
            }
        };
        Spec {
            infos: now.infos.iter().map(|(id, info)| (*id, info)).collect(),
            ghosts: BTreeSet::new(),
            cables: now
                .cables
                .iter()
                .map(|c| {
                    (
                        *c,
                        mark(sent.cables.contains(c), c.from.module, c.to.module),
                    )
                })
                .collect(),
            outs: now
                .outs
                .iter()
                .map(|p| (*p, mark(sent.outs.contains(p), p.module, p.module)))
                .collect(),
            fade_frames,
            generation,
            max_block,
        }
    }

    /// Add what the change took away, to fade it out, and whatever the
    /// change before was still fading (`lingering`). Returns all that was
    /// added.
    pub(crate) fn add_ghosts(
        &mut self,
        now: &PatchState,
        sent: &'a PatchState,
        lingering: &'a Ghosts,
        replaced: &BTreeSet<ModuleId>,
    ) -> Ghosts {
        let mut added = Ghosts::default();
        if self.fade_frames == 0 {
            return added;
        }
        let removed: BTreeSet<ModuleId> = sent
            .infos
            .keys()
            .filter(|id| !now.infos.contains_key(id))
            .copied()
            .collect();
        let kind_of = |cable: &Cable| {
            sent.infos
                .get(&cable.from.module)
                .and_then(|info| info.outputs.get(cable.from.port as usize))
                .copied()
        };
        let gone: Vec<Cable> = sent
            .cables
            .iter()
            .filter(|c| {
                !now.cables.contains(c)
                    && !replaced.contains(&c.from.module)
                    && !replaced.contains(&c.to.module)
            })
            .copied()
            .collect();
        let gone_outs: Vec<PortRef> = sent
            .outs
            .iter()
            .filter(|p| !now.outs.contains(p) && !replaced.contains(&p.module))
            .copied()
            .collect();

        // Removed modules that can still be heard, and the removed modules
        // that feed them.
        let mut kept: BTreeSet<ModuleId> = BTreeSet::new();
        for cable in &gone {
            if fades(kind_of(cable))
                && removed.contains(&cable.from.module)
                && !removed.contains(&cable.to.module)
            {
                kept.insert(cable.from.module);
            }
        }
        for port in &gone_outs {
            if removed.contains(&port.module) {
                kept.insert(port.module);
            }
        }
        loop {
            let before = kept.len();
            for cable in &gone {
                if kept.contains(&cable.to.module) && removed.contains(&cable.from.module) {
                    kept.insert(cable.from.module);
                }
            }
            if kept.len() == before {
                break;
            }
        }

        const OUT: Mark = Mark {
            fade: Fade::Out,
            inherit: true,
        };
        let here = |id: &ModuleId| now.infos.contains_key(id) || kept.contains(id);
        for cable in &gone {
            if !here(&cable.from.module) || !here(&cable.to.module) {
                continue;
            }
            if fades(kind_of(cable)) {
                added.cables.insert(*cable, OUT);
            } else if kept.contains(&cable.to.module) {
                // Notes, clock and sound do not fade: they keep feeding a
                // removed module until it has faded.
                added.cables.insert(
                    *cable,
                    Mark {
                        fade: Fade::Steady,
                        inherit: true,
                    },
                );
            }
        }
        for port in &gone_outs {
            if here(&port.module) {
                added.outs.insert(*port);
            }
        }
        for id in &kept {
            self.infos.insert(*id, &sent.infos[id]);
            added.infos.insert(*id, sent.infos[id].clone());
        }

        // What the change before was still fading carries on, unless this
        // change put it back or gave its number to another module.
        for (id, info) in &lingering.infos {
            if !self.infos.contains_key(id) {
                self.infos.insert(*id, info);
                added.infos.insert(*id, info.clone());
            }
        }
        let swapped = |id: &ModuleId| {
            replaced.contains(id)
                || (now.infos.contains_key(id) && lingering.infos.contains_key(id))
        };
        for (cable, mark) in &lingering.cables {
            let alive = now.cables.contains(cable) || added.cables.contains_key(cable);
            let ends = self.infos.contains_key(&cable.from.module)
                && self.infos.contains_key(&cable.to.module);
            if !alive && ends && !swapped(&cable.from.module) && !swapped(&cable.to.module) {
                added.cables.insert(*cable, *mark);
            }
        }
        for port in &lingering.outs {
            if !now.outs.contains(port)
                && self.infos.contains_key(&port.module)
                && !swapped(&port.module)
            {
                added.outs.insert(*port);
            }
        }

        for (cable, mark) in &added.cables {
            self.cables.insert(*cable, *mark);
        }
        for port in &added.outs {
            self.outs.insert(*port, OUT);
        }
        for id in added.infos.keys() {
            self.ghosts.insert(*id);
        }
        added
    }
}

#[derive(Clone, Copy)]
enum Op {
    Process(usize),
    /// The first half of a module that closes a loop: give out what is stored.
    Emit(usize),
    /// The second half: take in.
    Absorb(usize),
}

/// Ring and scratch storage are made during compile. Running only replaces samples.
struct AudioDelay {
    l: Box<[f32]>,
    r: Box<[f32]>,
    left: Box<[f32]>,
    right: Box<[f32]>,
    at: usize,
}
impl AudioDelay {
    fn new(frames: usize, block: usize) -> Self {
        Self {
            l: vec![0.0; frames].into_boxed_slice(),
            r: vec![0.0; frames].into_boxed_slice(),
            left: vec![0.0; block].into_boxed_slice(),
            right: vec![0.0; block].into_boxed_slice(),
            at: 0,
        }
    }
    fn run<'a>(&'a mut self, l: &[f32], r: &[f32]) -> (&'a [f32], &'a [f32]) {
        for i in 0..l.len() {
            self.left[i] = self.l[self.at];
            self.right[i] = self.r[self.at];
            self.l[self.at] = l[i];
            self.r[self.at] = r[i];
            self.at += 1;
            if self.at == self.l.len() {
                self.at = 0;
            }
        }
        (&self.left[..l.len()], &self.right[..r.len()])
    }
}
fn inherit_delay(now: &mut Src, old: &mut Src) {
    if let (Some(now), Some(old)) = (&mut now.delay, &mut old.delay) {
        if now.l.len() == old.l.len() {
            std::mem::swap(now, old);
        }
    }
}

/// One cable into an input, or one output on its way to the sound card.
struct Src {
    place: usize,
    from: PortRef,
    /// Its level now, and the level it is heading for (1, or 0 when fading out).
    gain: f32,
    target: f32,
    inherit: bool,
    delay: Option<AudioDelay>,
}

impl Src {
    fn new(place: usize, from: PortRef, mark: Mark) -> Src {
        let (gain, target) = match mark.fade {
            Fade::Steady => (1.0, 1.0),
            Fade::In => (0.0, 1.0),
            // Silent unless it takes its level from the plan before, which
            // is where anything still fading out must have been.
            Fade::Out => (0.0, 0.0),
        };
        Src {
            place,
            from,
            gain,
            target,
            inherit: mark.inherit,
            delay: None,
        }
    }

    fn silent(&self) -> bool {
        self.gain == 0.0 && self.target == 0.0
    }

    fn full(&self) -> bool {
        self.gain == 1.0 && self.target == 1.0
    }
}

/// The cables into one input, summed into a buffer of the input's own.
struct Mix {
    input: usize,
    scratch: usize,
    /// Audio or control: the kinds that are summed and faded. Otherwise notes.
    fades: bool,
    sources: Vec<Src>,
}

struct Node {
    reads: Vec<crate::pool::ReadBuf>,
    weight: usize,
    id: ModuleId,
    /// `None` until the audio thread hands the module over from the plan before.
    module: Option<Box<dyn Module>>,
    /// Removed from the patch; running only until the fades are over.
    ghost: bool,
    dead: bool,
    panic: Option<Thing>,
    tail: usize,
    tail_left: usize,
    asleep: bool,
    can_sleep: bool,
    /// Where each input reads from, as a place in the pool.
    inputs: Vec<usize>,
    mixes: Vec<Mix>,
    out_start: usize,
    out_count: usize,
}

struct Level { ops: Vec<Op>, serial: Vec<Op>, parallel: Vec<Op>, weight: usize, heavy: usize }
pub(crate) struct Plan {
    levels: Vec<Level>,
    jobs: Vec<parallel::Job>,
    nodes: Vec<Node>,
    ops: Vec<Op>,
    /// Every buffer. The first five are the silent input of each kind.
    pool: Vec<Buf>,
    /// Module number to its place in `nodes`.
    by_id: Vec<u32>,
    /// What the sound card hears: these outputs, summed.
    out: Vec<Src>,
    /// The longest piece this plan may be run in: the shortest delay closing a loop.
    piece: usize,
    /// How far a fading cable's level moves each sample.
    step: f32,
    /// Frames until every fade is certainly over.
    fade_left: usize,
    generation: u64,
    /// Pieces of a module's output silenced because they were not all numbers,
    /// since the engine last asked.
    tripped: u64,
}

const NOWHERE: u32 = u32::MAX;

/// Can `to` be reached by following cables out of `from`?
fn reaches(next: &[BTreeSet<usize>], from: usize, to: usize) -> bool {
    let mut seen = vec![false; next.len()];
    let mut stack: Vec<usize> = next[from].iter().copied().collect();
    while let Some(node) = stack.pop() {
        if node == to {
            return true;
        }
        if !seen[node] {
            seen[node] = true;
            stack.extend(next[node].iter().copied());
        }
    }
    false
}

impl Plan {
    /// The plan of an empty patch: silence.
    pub(crate) fn empty(max_block: usize) -> Plan {
        Plan {
            levels: Vec::new(),
            jobs: Vec::new(),
            nodes: Vec::new(),
            ops: Vec::new(),
            pool: Kind::ALL
                .iter()
                .map(|kind| Buf::new(*kind, max_block))
                .collect(),
            by_id: Vec::new(),
            out: Vec::new(),
            piece: usize::MAX,
            step: 1.0,
            fade_left: 0,
            generation: 0,
            tripped: 0,
        }
    }

    /// Compile a plan. Modules in `staged` (new since the last plan) move
    /// into it; the rest are picked up from the plan before when this one
    /// lands. Nothing is taken from `staged` unless it compiles.
    pub(crate) fn compile(
        spec: &Spec,
        staged: &mut BTreeMap<ModuleId, Box<dyn Module>>,
    ) -> Result<Plan, PatchError> {
        let infos = &spec.infos;
        let max_block = spec.max_block;
        let ids: Vec<ModuleId> = infos.keys().copied().collect();
        let node_of: BTreeMap<ModuleId, usize> = ids
            .iter()
            .enumerate()
            .map(|(node, id)| (*id, node))
            .collect();
        let count = ids.len();

        // Which module feeds which.
        let mut next: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); count];
        for cable in spec.cables.keys() {
            next[node_of[&cable.from.module]].insert(node_of[&cable.to.module]);
        }
        // A module on a loop that declares a delay is run in two halves.
        let on_loop: Vec<bool> = (0..count).map(|node| reaches(&next, node, node)).collect();
        let split: Vec<bool> = (0..count)
            .map(|node| on_loop[node] && infos[&ids[node]].feedback_delay > 0)
            .collect();

        // The order. A step is (module, half); a whole module is half 0.
        type Step = (usize, u8);
        let takes_in = |node: usize| -> Step { (node, split[node] as u8) };
        let mut must_follow: BTreeSet<(Step, Step)> = BTreeSet::new();
        let mut waiting: BTreeMap<Step, usize> = BTreeMap::new();
        for node in 0..count {
            waiting.insert((node, 0), 0);
            for &reader in &next[node] {
                must_follow.insert(((node, 0), takes_in(reader)));
            }
            if split[node] {
                waiting.insert((node, 1), 0);
                must_follow.insert(((node, 0), (node, 1)));
            }
        }
        for (_, after) in &must_follow {
            *waiting.get_mut(after).expect("every step is listed") += 1;
        }
        let mut ready: BTreeSet<Step> = waiting
            .iter()
            .filter(|(_, count)| **count == 0)
            .map(|(step, _)| *step)
            .collect();
        let mut steps: Vec<Step> = Vec::with_capacity(waiting.len());
        while let Some(step) = ready.pop_first() {
            steps.push(step);
            for (_, after) in must_follow.range((step, (0, 0))..=(step, (usize::MAX, u8::MAX))) {
                let count = waiting.get_mut(after).expect("every step is listed");
                *count -= 1;
                if *count == 0 {
                    ready.insert(*after);
                }
            }
        }
        if steps.len() < waiting.len() {
            let stuck = (0..count)
                .filter(|node| on_loop[*node] && !split[*node] && !steps.contains(&(*node, 0)))
                .map(|node| ids[node])
                .collect();
            return Err(PatchError::Cycle(stuck));
        }

        let mut arrival = vec![0usize; count];
        let mut input_latency = vec![0usize; count];
        for &(node, half) in &steps {
            if half != 0 || on_loop[node] {
                continue;
            }
            let latest = spec
                .cables
                .keys()
                .filter(|c| {
                    c.to.module == ids[node]
                        && infos[&ids[node]].inputs[c.to.port as usize] == Kind::Audio
                })
                .map(|c| arrival[node_of[&c.from.module]])
                .max()
                .unwrap_or(0);
            input_latency[node] = latest;
            arrival[node] = latest.saturating_add(infos[&ids[node]].latency);
        }

        // The pool: the silent inputs, then for each module its mixing
        // buffers and its outputs side by side. An audio or control input
        // with any cable gets a mixing buffer, in case the cable must fade.
        let mut pool: Vec<Buf> = Kind::ALL
            .iter()
            .map(|kind| Buf::new(*kind, max_block))
            .collect();
        let mut sources: Vec<Vec<Vec<(PortRef, Mark)>>> = Vec::with_capacity(count);
        let mut scratch: Vec<Vec<usize>> = Vec::with_capacity(count);
        let mut out_start = vec![0usize; count];
        for node in 0..count {
            let id = ids[node];
            let info = infos[&id];
            let mut node_sources = Vec::with_capacity(info.inputs.len());
            let mut node_scratch = Vec::with_capacity(info.inputs.len());
            for (input, kind) in info.inputs.iter().enumerate() {
                let to = PortRef {
                    module: id,
                    port: input as u32,
                };
                let from: Vec<(PortRef, Mark)> = spec
                    .cables
                    .iter()
                    .filter(|(cable, _)| cable.to == to)
                    .map(|(cable, mark)| (cable.from, *mark))
                    .collect();
                if from.len() > 1 && matches!(kind, Kind::Clock | Kind::Sound) {
                    return Err(PatchError::ManySources(to));
                }
                let mixed = match kind {
                    Kind::Audio | Kind::Control => !from.is_empty(),
                    _ => from.len() > 1,
                };
                if mixed {
                    node_scratch.push(pool.len());
                    pool.push(Buf::new(*kind, max_block));
                } else {
                    node_scratch.push(usize::MAX);
                }
                node_sources.push(from);
            }
            out_start[node] = pool.len();
            for kind in &info.outputs {
                pool.push(Buf::new(*kind, max_block));
            }
            sources.push(node_sources);
            scratch.push(node_scratch);
        }
        let place = |port: &PortRef| out_start[node_of[&port.module]] + port.port as usize;

        let mut nodes = Vec::with_capacity(count);
        for node in 0..count {
            let id = ids[node];
            let info = infos[&id];
            let mut inputs = Vec::with_capacity(info.inputs.len());
            let mut mixes = Vec::new();
            for (input, kind) in info.inputs.iter().enumerate() {
                let from = &sources[node][input];
                let buffer = scratch[node][input];
                inputs.push(if from.is_empty() {
                    kind.index()
                } else if buffer == usize::MAX {
                    place(&from[0].0)
                } else {
                    mixes.push(Mix {
                        input,
                        scratch: buffer,
                        fades: matches!(kind, Kind::Audio | Kind::Control),
                        sources: from
                            .iter()
                            .map(|(port, mark)| {
                                let mut src = Src::new(place(port), *port, *mark);
                                if *kind == Kind::Audio && !on_loop[node] {
                                    let frames = input_latency[node]
                                        .saturating_sub(arrival[node_of[&port.module]]);
                                    if frames > 0 {
                                        src.delay = Some(AudioDelay::new(frames, max_block));
                                    }
                                }
                                src
                            })
                            .collect(),
                    });
                    buffer
                });
            }
            nodes.push(Node {
                reads: vec![crate::pool::ReadBuf::empty(); info.inputs.len()],
                weight: info.parallel,
                id,
                module: None,
                ghost: spec.ghosts.contains(&id),
                dead: false,
                panic: None,
                tail: info.tail,
                tail_left: 0,
                asleep: false,
                can_sleep: info.can_sleep
                    && !on_loop[node]
                    && !info.inputs.is_empty()
                    && info.inputs.iter().all(|k| *k == Kind::Audio),
                inputs,
                mixes,
                out_start: out_start[node],
                out_count: info.outputs.len(),
            });
        }

        let mut by_id = vec![NOWHERE; ids.last().map_or(0, |id| *id as usize + 1)];
        for (node, id) in ids.iter().enumerate() {
            by_id[*id as usize] = node as u32;
        }
        let ops: Vec<Op> = steps
            .iter()
            .map(|&(node, half)| match (split[node], half) {
                (false, _) => Op::Process(node),
                (true, 0) => Op::Emit(node),
                (true, _) => Op::Absorb(node),
            })
            .collect();
        // Feedback's emit/absorb ordering remains on the original serial path.
        // For a DAG every predecessor is in an earlier level, so no job reads
        // another job's outputs while that level is in flight.
        let mut levels: Vec<Level> = Vec::new();
        if !split.iter().any(|split| *split) {
            let mut depth = vec![0usize; count];
            for &(node, _) in &steps {
                let level = depth[node];
                while levels.len() <= level { levels.push(Level { ops: Vec::new(), serial: Vec::new(), parallel: Vec::new(), weight: 0, heavy: 0 }); }
                levels[level].ops.push(Op::Process(node));
                let weight = infos[&ids[node]].parallel;
                if weight == 0 { levels[level].serial.push(Op::Process(node)); }
                else { levels[level].parallel.push(Op::Process(node)); }
                levels[level].weight += weight;
                levels[level].heavy += usize::from(weight > 0);
                for &to in &next[node] { depth[to] = depth[to].max(level + 1); }
            }
        }
        let piece = (0..count)
            .filter(|node| split[*node])
            .map(|node| infos[&ids[node]].feedback_delay)
            .min()
            .unwrap_or(usize::MAX);
        let output_latency = spec
            .outs
            .keys()
            .map(|port| arrival[node_of[&port.module]])
            .max()
            .unwrap_or(0);
        let out = spec
            .outs
            .iter()
            .map(|(port, mark)| {
                let mut src = Src::new(place(port), *port, *mark);
                let frames = output_latency.saturating_sub(arrival[node_of[&port.module]]);
                if frames > 0 {
                    src.delay = Some(AudioDelay::new(frames, max_block));
                }
                src
            })
            .collect();

        // Nothing can fail from here, so the new modules may move in.
        for node in &mut nodes {
            node.module = staged.remove(&node.id);
        }
        Ok(Plan {
            levels,
            jobs: Vec::with_capacity(count),
            nodes,
            ops,
            pool,
            by_id,
            out,
            piece,
            step: if spec.fade_frames == 0 {
                1.0
            } else {
                1.0 / spec.fade_frames as f32
            },
            fade_left: spec.fade_frames + 2,
            generation: spec.generation,
            tripped: 0,
        })
    }

    /// How many pieces were silenced since this was last asked.
    pub(crate) fn take_tripped(&mut self) -> u64 {
        std::mem::take(&mut self.tripped)
    }

    pub(crate) fn piece(&self) -> usize {
        self.piece
    }

    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }

    fn node_of(&self, id: ModuleId) -> Option<usize> {
        match self.by_id.get(id as usize) {
            Some(&node) if node != NOWHERE => Some(node as usize),
            _ => None,
        }
    }

    /// Take over, from the plan before, every module this plan also has, and
    /// the level of every cable both have. Audio thread: boxes and numbers
    /// change hands, nothing is made or freed.
    pub(crate) fn rehome(&mut self, old: &Plan, rate: f32) {
        for node in &mut self.nodes {
            let Some(from) = old.node_of(node.id) else { continue; };
            let before = &old.nodes[from];
            node.dead = before.dead;
            if let (Some(module), Some(previous)) = (node.module.as_mut(), before.module.as_ref()) {
                if let Err(payload) = catch_unwind(AssertUnwindSafe(|| {
                    previous.visit_events(&mut |event| module.handle(&event));
                    module.rehome(previous.rate_state(), rate);
                    module.transfer(previous.as_ref(), rate);
                })) {
                    node.dead = true;
                    node.panic = Some(payload);
                }
            }
        }
    }

    pub(crate) fn adopt(&mut self, old: &mut Plan) {
        for node in &mut self.nodes {
            let Some(from) = old.node_of(node.id) else {
                continue;
            };
            if node.module.is_none() {
                node.module = old.nodes[from].module.take();
                node.dead = old.nodes[from].dead;
                node.tail_left = old.nodes[from].tail_left;
            }
            let before = &mut old.nodes[from];
            for mix in node.mixes.iter_mut().filter(|mix| mix.fades) {
                let Some(old_mix) = before
                    .mixes
                    .iter_mut()
                    .find(|m| m.fades && m.input == mix.input)
                else {
                    continue;
                };
                for src in mix.sources.iter_mut().filter(|src| src.inherit) {
                    if let Some(was) = old_mix.sources.iter_mut().find(|was| was.from == src.from) {
                        src.gain = was.gain;
                        inherit_delay(src, was);
                    }
                }
            }
        }
        for src in self.out.iter_mut().filter(|src| src.inherit) {
            if let Some(was) = old.out.iter_mut().find(|was| was.from == src.from) {
                src.gain = was.gain;
                inherit_delay(src, was);
            }
        }
    }

    pub(crate) fn handle(&mut self, id: ModuleId, event: &EventKind) {
        if let Some(index) = self.node_of(id) {
            let node = &mut self.nodes[index];
            if node.dead {
                return;
            }
            if let Some(module) = node.module.as_mut() {
                node.tail_left = node.tail;
                if let Err(payload) = catch_unwind(AssertUnwindSafe(|| module.handle(event))) {
                    node.dead = true;
                    node.panic = Some(payload);
                }
            }
        }
    }

    /// Ownership of a returned value or panic payload always leaves the callback.
    pub(crate) fn give(&mut self, id: ModuleId, slot: u32, thing: Thing) -> Option<Thing> {
        let Some(index) = self.node_of(id) else {
            return Some(thing);
        };
        let node = &mut self.nodes[index];
        if node.dead {
            return Some(thing);
        }
        let Some(module) = node.module.as_mut() else {
            return Some(thing);
        };
        match catch_unwind(AssertUnwindSafe(|| module.take(slot, thing))) {
            Ok(done) => done,
            Err(payload) => {
                node.dead = true;
                node.panic = Some(payload);
                None
            }
        }
    }

    pub(crate) fn finished(&mut self) -> Option<Thing> {
        for node in &mut self.nodes {
            if node.dead {
                continue;
            }
            let Some(module) = node.module.as_mut() else {
                continue;
            };
            match catch_unwind(AssertUnwindSafe(|| module.finished())) {
                Ok(Some(done)) => return Some(done),
                Ok(None) => {}
                Err(payload) => {
                    node.dead = true;
                    node.panic = Some(payload);
                }
            }
        }
        None
    }

    pub(crate) fn take_panic(&mut self) -> Option<(ModuleId, Thing)> {
        self.nodes
            .iter_mut()
            .find_map(|node| node.panic.take().map(|payload| (node.id, payload)))
    }

    /// Make `n` samples, and put what the sound card hears into the outputs.
    pub(crate) fn run(
        &mut self,
        n: usize,
        rate: f32,
        frame: u64,
        sounds: &Sounds,
        left: &mut [f32],
        right: &mut [f32],
        workers: Option<&mut crate::pool::Pool>,
    ) {
        let Plan {
            nodes,
            ops,
            levels,
            jobs,
            pool,
            out,
            step,
            fade_left,
            tripped,
            ..
        } = self;
        let step = *step;
        if let Some(workers) = workers.filter(|_| levels.iter().any(|level| level.heavy >= 2)) {
            for level in levels.iter() {
                let active = level.parallel.iter().filter_map(|op| {
                    let Op::Process(index) = *op else { return None; };
                    let node = &nodes[index];
                    (!node.dead && !node.asleep && !(node.ghost && *fade_left == 0) && node.module.as_ref().is_some_and(|module| module.parallel_active())).then_some(node.weight)
                });
                let (heavy, weight) = active.fold((0usize, 0usize), |(count, sum), weight| (count+1, sum+weight));
                if heavy >= 2 && weight.saturating_mul(n) >= 8192 {
                    *tripped += run_ops(nodes, pool, &level.serial, n, rate, frame, sounds, step, *fade_left);
                    jobs.clear();
                    for op in &level.parallel {
                        let Op::Process(index) = *op else { unreachable!() };
                        let node = &mut nodes[index];
                        if !node.dead && !(node.ghost && *fade_left == 0) && node.module.is_some() {
                            mix_inputs(pool, &mut node.mixes, &mut node.inputs, n, step);
                        }
                        for (read, input) in node.reads.iter_mut().zip(&node.inputs) { read.set(&pool[*input]); }
                        jobs.push(parallel::Job::new(node, pool, n, rate, frame, sounds, *fade_left));
                    }
                    parallel::dispatch(workers, jobs);
                    *tripped += jobs.iter().map(|job| job.tripped).sum::<u64>();
                } else {
                    *tripped += run_ops(nodes, pool, &level.ops, n, rate, frame, sounds, step, *fade_left);
                }
            }
        } else {
            *tripped += run_ops(nodes, pool, ops, n, rate, frame, sounds, step, *fade_left);
        }
        let mut any = false;
        for src in out.iter_mut() {
            if let Buf::Audio { l, r, .. } = &pool[src.place] {
                any |= add_stereo(
                    &mut left[..n],
                    &mut right[..n],
                    &l[..n],
                    &r[..n],
                    src,
                    step,
                    !any,
                );
            }
        }
        if !any {
            left[..n].fill(0.0);
            right[..n].fill(0.0);
        }
        *fade_left = fade_left.saturating_sub(n);
    }
}

/// One sample's move of a fading cable's level towards where it is going.
fn moved(gain: f32, target: f32, step: f32) -> f32 {
    if gain < target {
        (gain + step).min(target)
    } else {
        (gain - step).max(target)
    }
}

/// Put one cable into a sum at its level, moving the level as it goes, and
/// say whether anything was put. The level moves once a sample, so the result
/// does not depend on how the audio is cut into pieces.
///
/// The `first` cable in is copied and the rest are added to it. Adding the
/// first to silence instead would turn a negative zero positive, and a cable
/// must carry every bit as it was.
fn add_stereo(
    l: &mut [f32],
    r: &mut [f32],
    from_l: &[f32],
    from_r: &[f32],
    src: &mut Src,
    step: f32,
    first: bool,
) -> bool {
    let (from_l, from_r) = match &mut src.delay {
        Some(delay) => delay.run(from_l, from_r),
        None => (from_l, from_r),
    };
    mix_stereo(l, r, from_l, from_r, &mut src.gain, src.target, step, first)
}
fn mix_stereo(
    l: &mut [f32],
    r: &mut [f32],
    from_l: &[f32],
    from_r: &[f32],
    level: &mut f32,
    target: f32,
    step: f32,
    first: bool,
) -> bool {
    if *level == 0.0 && target == 0.0 {
        return false;
    }
    if *level == 1.0 && target == 1.0 {
        if first {
            l.copy_from_slice(from_l);
            r.copy_from_slice(from_r);
        } else {
            for i in 0..l.len() {
                l[i] += from_l[i];
                r[i] += from_r[i];
            }
        }
        return true;
    }
    let mut gain = *level;
    for i in 0..l.len() {
        if first {
            l[i] = from_l[i] * gain;
            r[i] = from_r[i] * gain;
        } else {
            l[i] += from_l[i] * gain;
            r[i] += from_r[i] * gain;
        }
        gain = moved(gain, target, step);
    }
    *level = gain;
    true
}

fn add_mono(values: &mut [f32], from: &[f32], src: &mut Src, step: f32, first: bool) -> bool {
    if src.silent() {
        return false;
    }
    if src.full() {
        if first {
            values.copy_from_slice(from);
        } else {
            for i in 0..values.len() {
                values[i] += from[i];
            }
        }
        return true;
    }
    let mut gain = src.gain;
    for i in 0..values.len() {
        if first {
            values[i] = from[i] * gain;
        } else {
            values[i] += from[i] * gain;
        }
        gain = moved(gain, src.target, step);
    }
    src.gain = gain;
    true
}

/// Two buffers out of the pool at once, one to write and one to read.
fn pair(pool: &mut [Buf], write: usize, read: usize) -> (&mut Buf, &Buf) {
    if write < read {
        let (low, high) = pool.split_at_mut(read);
        (&mut low[write], &high[0])
    } else {
        let (low, high) = pool.split_at_mut(write);
        (&mut high[0], &low[read])
    }
}

/// Sum the cables that meet at each input, in the plan's fixed order. An
/// input with one cable at full level reads its source directly.
fn mix_inputs(pool: &mut [Buf], mixes: &mut [Mix], inputs: &mut [usize], n: usize, step: f32) {
    for mix in mixes.iter_mut() {
        if mix.fades
            && mix.sources.len() == 1
            && mix.sources[0].full()
            && mix.sources[0].delay.is_none()
        {
            inputs[mix.input] = mix.sources[0].place;
            continue;
        }
        inputs[mix.input] = mix.scratch;
        if let Buf::Notes(notes) = &mut pool[mix.scratch] {
            notes.clear();
        }
        let mut any = false;
        for src in mix.sources.iter_mut() {
            match pair(pool, mix.scratch, src.place) {
                (
                    Buf::Audio { l, r, .. },
                    Buf::Audio {
                        l: from_l,
                        r: from_r,
                        ..
                    },
                ) => {
                    any |= add_stereo(
                        &mut l[..n],
                        &mut r[..n],
                        &from_l[..n],
                        &from_r[..n],
                        src,
                        step,
                        !any,
                    );
                }
                (Buf::Control(values), Buf::Control(from)) => {
                    any |= add_mono(&mut values[..n], &from[..n], src, step, !any);
                }
                (Buf::Notes(notes), Buf::Notes(from)) => {
                    for event in from.as_slice() {
                        notes.push(*event);
                    }
                }
                _ => {}
            }
        }
        match &mut pool[mix.scratch] {
            Buf::Audio { l, r, .. } if !any => {
                l[..n].fill(0.0);
                r[..n].fill(0.0);
            }
            Buf::Control(values) if !any => values[..n].fill(0.0),
            Buf::Notes(notes) => sort_by_offset(notes.as_mut_slice()),
            _ => {}
        }
        pool[mix.scratch].mark_silence(n);
    }
}

/// Earliest first; notes on the same sample keep the order of their cables.
/// An insertion sort, because the library's stable sort may allocate.
fn sort_by_offset(events: &mut [NoteEvent]) {
    for i in 1..events.len() {
        let mut j = i;
        while j > 0 && events[j - 1].offset > events[j].offset {
            events.swap(j - 1, j);
            j -= 1;
        }
    }
}

/// A failed producer supplies no audio, controls, events, clock or sound.
fn silence(bufs: &mut [Buf], n: usize) {
    for buf in bufs {
        match buf {
            Buf::Audio { l, r, silent } => {
                *silent = true;
                l[..n].fill(0.0);
                r[..n].fill(0.0);
            }
            Buf::Control(values) => values[..n].fill(0.0),
            Buf::Notes(notes) => notes.clear(),
            Buf::Clock(clock) => *clock = crate::ClockState::STOPPED,
            Buf::Sound(sound) => *sound = Default::default(),
        }
    }
}

fn run_ops(nodes: &mut [Node], pool: &mut [Buf], ops: &[Op], n: usize, rate: f32,
    frame: u64, sounds: &Sounds, step: f32, fade_left: usize) -> u64 {
    let mut tripped = 0;
        for op in ops.iter() {
            let (index, takes_in, gives_out) = match *op {
                Op::Process(index) => (index, true, true),
                Op::Emit(index) => (index, false, true),
                Op::Absorb(index) => (index, true, false),
            };
            let node = &mut nodes[index];
            if node.ghost && fade_left == 0 {
                continue;
            }
            if node.dead {
                silence(
                    &mut pool[node.out_start..node.out_start + node.out_count],
                    n,
                );
                continue;
            }
            let Some(module) = node.module.as_mut() else {
                continue;
            };
            if takes_in {
                mix_inputs(pool, &mut node.mixes, &mut node.inputs, n, step);
            }
            if node.can_sleep && matches!(op, Op::Process(_)) {
                let quiet = node.inputs.iter().all(|input| pool[*input].is_silent());
                let settled = pool[node.out_start..node.out_start + node.out_count]
                    .iter()
                    .all(Buf::is_silent);
                if quiet && node.tail_left == 0 && settled {
                    if !node.asleep {
                        // Clear the full capacity once: the next piece can
                        // be longer than the piece that first became silent.
                        for buf in &mut pool[node.out_start..node.out_start + node.out_count] {
                            if let Buf::Audio { l, r, silent } = buf {
                                l.fill(0.0);
                                r.fill(0.0);
                                *silent = true;
                            }
                        }
                        node.asleep = true;
                    }
                    continue;
                }
                node.asleep = false;
                if quiet {
                    node.tail_left = node.tail_left.saturating_sub(n);
                } else {
                    node.tail_left = node.tail;
                }
            }
            let out_count = if gives_out { node.out_count } else { 0 };
            let (before, rest) = pool.split_at_mut(node.out_start);
            let (outs, after) = rest.split_at_mut(out_count);
            for buf in outs.iter_mut() {
                if let Buf::Notes(notes) = buf {
                    notes.clear();
                }
            }
            let map: &[usize] = if takes_in { &node.inputs } else { &[] };
            let mut io = Io {
                n,
                rate,
                frame,
                ins: Inputs {
                    reads: None,
                    before,
                    after,
                    gap_start: node.out_start,
                    gap_len: out_count,
                    map,
                    n,
                },
                outs: Outputs { bufs: outs, n },
                sounds,
            };
            let result = catch_unwind(AssertUnwindSafe(|| match *op {
                Op::Process(_) => module.process(&mut io),
                Op::Emit(_) => module.emit(&mut io),
                Op::Absorb(_) => module.absorb(&mut io),
            }));
            if let Err(payload) = result {
                node.dead = true;
                node.panic = Some(payload);
                silence(
                    &mut pool[node.out_start..node.out_start + node.out_count],
                    n,
                );
                continue;
            }
            // A sample that is not a number goes no further than the module
            // that made it: one in a reverb's tank is every sample after, in
            // everything downstream. Its output is silenced for this piece and
            // the module told to clear its memory.
            let mut bad = false;
            for buf in outs.iter_mut() {
                match buf {
                    Buf::Audio { l, r, .. } if !(all_finite(&l[..n]) && all_finite(&r[..n])) => {
                        l[..n].fill(0.0);
                        r[..n].fill(0.0);
                        bad = true;
                    }
                    Buf::Control(values) if !all_finite(&values[..n]) => {
                        values[..n].fill(0.0);
                        bad = true;
                    }
                    _ => {}
                }
            }
            if bad {
                if let Err(payload) = catch_unwind(AssertUnwindSafe(|| module.recover())) {
                    node.dead = true;
                    node.panic = Some(payload);
                    silence(outs, n);
                }
                tripped += 1;
            }
            for buf in outs.iter_mut() {
                buf.mark_silence(n);
            }
        }
    tripped
}
