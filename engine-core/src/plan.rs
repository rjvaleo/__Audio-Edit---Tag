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

use crate::engine::PatchError;
use crate::module::{EventKind, Inputs, Io, Module, Outputs};
use crate::sound::Sounds;
use crate::types::{Buf, Cable, Kind, ModuleId, NoteEvent, PortRef};
use std::collections::{BTreeMap, BTreeSet};

/// Module numbers stop here, so the audio thread can find a module by its
/// number in a table.
pub(crate) const MAX_MODULE_ID: ModuleId = 1 << 16;

/// What the controller remembers about a module once the module itself has
/// gone to the audio thread.
#[derive(Clone)]
pub(crate) struct Info {
    pub inputs: Vec<Kind>,
    pub outputs: Vec<Kind>,
    pub feedback_delay: usize,
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
                Mark { fade: Fade::Steady, inherit: true }
            } else if known && !swapped {
                Mark { fade: Fade::Steady, inherit: true }
            } else {
                Mark { fade: Fade::In, inherit: !swapped }
            }
        };
        Spec {
            infos: now.infos.iter().map(|(id, info)| (*id, info)).collect(),
            ghosts: BTreeSet::new(),
            cables: now
                .cables
                .iter()
                .map(|c| (*c, mark(sent.cables.contains(c), c.from.module, c.to.module)))
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
        let removed: BTreeSet<ModuleId> =
            sent.infos.keys().filter(|id| !now.infos.contains_key(id)).copied().collect();
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

        const OUT: Mark = Mark { fade: Fade::Out, inherit: true };
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
                added.cables.insert(*cable, Mark { fade: Fade::Steady, inherit: true });
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
        let swapped = |id: &ModuleId| replaced.contains(id) || (now.infos.contains_key(id) && lingering.infos.contains_key(id));
        for (cable, mark) in &lingering.cables {
            let alive = now.cables.contains(cable) || added.cables.contains_key(cable);
            let ends = self.infos.contains_key(&cable.from.module) && self.infos.contains_key(&cable.to.module);
            if !alive && ends && !swapped(&cable.from.module) && !swapped(&cable.to.module) {
                added.cables.insert(*cable, *mark);
            }
        }
        for port in &lingering.outs {
            if !now.outs.contains(port) && self.infos.contains_key(&port.module) && !swapped(&port.module) {
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

/// One cable into an input, or one output on its way to the sound card.
struct Src {
    place: usize,
    from: PortRef,
    /// Its level now, and the level it is heading for (1, or 0 when fading out).
    gain: f32,
    target: f32,
    inherit: bool,
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
        Src { place, from, gain, target, inherit: mark.inherit }
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
    id: ModuleId,
    /// `None` until the audio thread hands the module over from the plan before.
    module: Option<Box<dyn Module>>,
    /// Removed from the patch; running only until the fades are over.
    ghost: bool,
    /// Where each input reads from, as a place in the pool.
    inputs: Vec<usize>,
    mixes: Vec<Mix>,
    out_start: usize,
    out_count: usize,
}

pub(crate) struct Plan {
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
            nodes: Vec::new(),
            ops: Vec::new(),
            pool: Kind::ALL.iter().map(|kind| Buf::new(*kind, max_block)).collect(),
            by_id: Vec::new(),
            out: Vec::new(),
            piece: usize::MAX,
            step: 1.0,
            fade_left: 0,
            generation: 0,
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
        let node_of: BTreeMap<ModuleId, usize> =
            ids.iter().enumerate().map(|(node, id)| (*id, node)).collect();
        let count = ids.len();

        // Which module feeds which.
        let mut next: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); count];
        for cable in spec.cables.keys() {
            next[node_of[&cable.from.module]].insert(node_of[&cable.to.module]);
        }
        // A module on a loop that declares a delay is run in two halves.
        let on_loop: Vec<bool> = (0..count).map(|node| reaches(&next, node, node)).collect();
        let split: Vec<bool> =
            (0..count).map(|node| on_loop[node] && infos[&ids[node]].feedback_delay > 0).collect();

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
        let mut ready: BTreeSet<Step> =
            waiting.iter().filter(|(_, count)| **count == 0).map(|(step, _)| *step).collect();
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

        // The pool: the silent inputs, then for each module its mixing
        // buffers and its outputs side by side. An audio or control input
        // with any cable gets a mixing buffer, in case the cable must fade.
        let mut pool: Vec<Buf> = Kind::ALL.iter().map(|kind| Buf::new(*kind, max_block)).collect();
        let mut sources: Vec<Vec<Vec<(PortRef, Mark)>>> = Vec::with_capacity(count);
        let mut scratch: Vec<Vec<usize>> = Vec::with_capacity(count);
        let mut out_start = vec![0usize; count];
        for node in 0..count {
            let id = ids[node];
            let info = infos[&id];
            let mut node_sources = Vec::with_capacity(info.inputs.len());
            let mut node_scratch = Vec::with_capacity(info.inputs.len());
            for (input, kind) in info.inputs.iter().enumerate() {
                let to = PortRef { module: id, port: input as u32 };
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
                        sources: from.iter().map(|(port, mark)| Src::new(place(port), *port, *mark)).collect(),
                    });
                    buffer
                });
            }
            nodes.push(Node {
                id,
                module: None,
                ghost: spec.ghosts.contains(&id),
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
        let ops = steps
            .iter()
            .map(|&(node, half)| match (split[node], half) {
                (false, _) => Op::Process(node),
                (true, 0) => Op::Emit(node),
                (true, _) => Op::Absorb(node),
            })
            .collect();
        let piece = (0..count)
            .filter(|node| split[*node])
            .map(|node| infos[&ids[node]].feedback_delay)
            .min()
            .unwrap_or(usize::MAX);
        let out = spec.outs.iter().map(|(port, mark)| Src::new(place(port), *port, *mark)).collect();

        // Nothing can fail from here, so the new modules may move in.
        for node in &mut nodes {
            node.module = staged.remove(&node.id);
        }
        Ok(Plan {
            nodes,
            ops,
            pool,
            by_id,
            out,
            piece,
            step: if spec.fade_frames == 0 { 1.0 } else { 1.0 / spec.fade_frames as f32 },
            fade_left: spec.fade_frames + 2,
            generation: spec.generation,
        })
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
    pub(crate) fn adopt(&mut self, old: &mut Plan) {
        for node in &mut self.nodes {
            let Some(from) = old.node_of(node.id) else { continue };
            if node.module.is_none() {
                node.module = old.nodes[from].module.take();
            }
            let before = &old.nodes[from];
            for mix in node.mixes.iter_mut().filter(|mix| mix.fades) {
                let Some(old_mix) = before.mixes.iter().find(|m| m.fades && m.input == mix.input) else {
                    continue;
                };
                for src in mix.sources.iter_mut().filter(|src| src.inherit) {
                    if let Some(was) = old_mix.sources.iter().find(|was| was.from == src.from) {
                        src.gain = was.gain;
                    }
                }
            }
        }
        for src in self.out.iter_mut().filter(|src| src.inherit) {
            if let Some(was) = old.out.iter().find(|was| was.from == src.from) {
                src.gain = was.gain;
            }
        }
    }

    pub(crate) fn handle(&mut self, id: ModuleId, event: &EventKind) {
        if let Some(node) = self.node_of(id) {
            if let Some(module) = self.nodes[node].module.as_mut() {
                module.handle(event);
            }
        }
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
    ) {
        let Plan { nodes, ops, pool, out, step, fade_left, .. } = self;
        let step = *step;
        for op in ops.iter() {
            let (index, takes_in, gives_out) = match *op {
                Op::Process(index) => (index, true, true),
                Op::Emit(index) => (index, false, true),
                Op::Absorb(index) => (index, true, false),
            };
            let node = &mut nodes[index];
            if node.ghost && *fade_left == 0 {
                continue;
            }
            let Some(module) = node.module.as_mut() else { continue };
            if takes_in {
                mix_inputs(pool, &mut node.mixes, &mut node.inputs, n, step);
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
                ins: Inputs { before, after, gap_start: node.out_start, gap_len: out_count, map, n },
                outs: Outputs { bufs: outs, n },
                sounds,
            };
            match *op {
                Op::Process(_) => module.process(&mut io),
                Op::Emit(_) => module.emit(&mut io),
                Op::Absorb(_) => module.absorb(&mut io),
            }
        }
        let mut any = false;
        for src in out.iter_mut() {
            if let Buf::Audio { l, r } = &pool[src.place] {
                any |= add_stereo(&mut left[..n], &mut right[..n], &l[..n], &r[..n], src, step, !any);
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
    if src.silent() {
        return false;
    }
    if src.full() {
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
    let mut gain = src.gain;
    for i in 0..l.len() {
        if first {
            l[i] = from_l[i] * gain;
            r[i] = from_r[i] * gain;
        } else {
            l[i] += from_l[i] * gain;
            r[i] += from_r[i] * gain;
        }
        gain = moved(gain, src.target, step);
    }
    src.gain = gain;
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
        if mix.fades && mix.sources.len() == 1 && mix.sources[0].full() {
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
                (Buf::Audio { l, r }, Buf::Audio { l: from_l, r: from_r }) => {
                    any |= add_stereo(&mut l[..n], &mut r[..n], &from_l[..n], &from_r[..n], src, step, !any);
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
            Buf::Audio { l, r } if !any => {
                l[..n].fill(0.0);
                r[..n].fill(0.0);
            }
            Buf::Control(values) if !any => values[..n].fill(0.0),
            Buf::Notes(notes) => sort_by_offset(notes.as_mut_slice()),
            _ => {}
        }
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
