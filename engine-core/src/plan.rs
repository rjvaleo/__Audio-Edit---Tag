//! The patch, compiled: the order the modules run in and the buffers they
//! read and write.
//!
//! Made on the app's thread, where allocating is allowed, and then only run.
//! Nothing here is chosen by chance: modules run lowest number first wherever
//! the cables leave a choice, and cables meeting at one input are summed in
//! the order of their sources. The same patch always gives the same plan.

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
pub(crate) struct Info {
    pub inputs: Vec<Kind>,
    pub outputs: Vec<Kind>,
    pub feedback_delay: usize,
}

#[derive(Clone, Copy)]
enum Op {
    Process(usize),
    /// The first half of a module that closes a loop: give out what is stored.
    Emit(usize),
    /// The second half: take in.
    Absorb(usize),
}

/// Several cables into one input: summed into a buffer of the input's own.
struct Mix {
    scratch: usize,
    sources: Vec<usize>,
}

struct Node {
    id: ModuleId,
    /// `None` until the audio thread hands the module over from the plan before.
    module: Option<Box<dyn Module>>,
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
    out: Vec<usize>,
    /// The longest piece this plan may be run in: the shortest delay closing a loop.
    piece: usize,
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
        }
    }

    /// Compile a patch. Modules in `staged` (new since the last plan) move
    /// into the plan; the rest are picked up from the plan before when this
    /// one lands. Nothing is taken from `staged` unless the patch compiles.
    pub(crate) fn compile(
        infos: &BTreeMap<ModuleId, Info>,
        cables: &BTreeSet<Cable>,
        outs: &BTreeSet<PortRef>,
        staged: &mut BTreeMap<ModuleId, Box<dyn Module>>,
        max_block: usize,
    ) -> Result<Plan, PatchError> {
        let ids: Vec<ModuleId> = infos.keys().copied().collect();
        let node_of: BTreeMap<ModuleId, usize> =
            ids.iter().enumerate().map(|(node, id)| (*id, node)).collect();
        let count = ids.len();

        // Which module feeds which.
        let mut next: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); count];
        for cable in cables {
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
        // buffers and its outputs side by side.
        let mut pool: Vec<Buf> = Kind::ALL.iter().map(|kind| Buf::new(*kind, max_block)).collect();
        let mut sources: Vec<Vec<Vec<PortRef>>> = Vec::with_capacity(count);
        let mut scratch: Vec<Vec<usize>> = Vec::with_capacity(count);
        let mut out_start = vec![0usize; count];
        for node in 0..count {
            let id = ids[node];
            let info = &infos[&id];
            let mut node_sources = Vec::with_capacity(info.inputs.len());
            let mut node_scratch = Vec::with_capacity(info.inputs.len());
            for (input, kind) in info.inputs.iter().enumerate() {
                let to = PortRef { module: id, port: input as u32 };
                let from: Vec<PortRef> =
                    cables.iter().filter(|cable| cable.to == to).map(|cable| cable.from).collect();
                if from.len() > 1 {
                    if matches!(kind, Kind::Clock | Kind::Sound) {
                        return Err(PatchError::ManySources(to));
                    }
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
            let info = &infos[&id];
            let mut inputs = Vec::with_capacity(info.inputs.len());
            let mut mixes = Vec::new();
            for (input, kind) in info.inputs.iter().enumerate() {
                let from = &sources[node][input];
                inputs.push(match from.len() {
                    0 => kind.index(),
                    1 => place(&from[0]),
                    _ => {
                        mixes.push(Mix {
                            scratch: scratch[node][input],
                            sources: from.iter().map(place).collect(),
                        });
                        scratch[node][input]
                    }
                });
            }
            nodes.push(Node {
                id,
                module: None,
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
        let out = outs.iter().map(place).collect();

        // Nothing can fail from here, so the new modules may move in.
        for node in &mut nodes {
            node.module = staged.remove(&node.id);
        }
        Ok(Plan { nodes, ops, pool, by_id, out, piece })
    }

    pub(crate) fn piece(&self) -> usize {
        self.piece
    }

    fn node_of(&self, id: ModuleId) -> Option<usize> {
        match self.by_id.get(id as usize) {
            Some(&node) if node != NOWHERE => Some(node as usize),
            _ => None,
        }
    }

    /// Take over, from the plan before, every module this plan also has.
    /// Audio thread: boxes change hands, nothing is made or freed.
    pub(crate) fn adopt(&mut self, old: &mut Plan) {
        for node in &mut self.nodes {
            if node.module.is_none() {
                if let Some(from) = old.node_of(node.id) {
                    node.module = old.nodes[from].module.take();
                }
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

    /// Make `n` samples, and add what the sound card hears into the outputs.
    pub(crate) fn run(
        &mut self,
        n: usize,
        rate: f32,
        frame: u64,
        sounds: &Sounds,
        left: &mut [f32],
        right: &mut [f32],
    ) {
        let Plan { nodes, ops, pool, out, .. } = self;
        for op in ops.iter() {
            let (index, takes_in, gives_out) = match *op {
                Op::Process(index) => (index, true, true),
                Op::Emit(index) => (index, false, true),
                Op::Absorb(index) => (index, true, false),
            };
            let node = &mut nodes[index];
            let Some(module) = node.module.as_mut() else { continue };
            if takes_in {
                mix_inputs(pool, &node.mixes, n);
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
        left[..n].fill(0.0);
        right[..n].fill(0.0);
        for &place in out.iter() {
            if let Buf::Audio { l, r } = &pool[place] {
                for i in 0..n {
                    left[i] += l[i];
                    right[i] += r[i];
                }
            }
        }
    }
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

/// Sum the cables that meet at each shared input, in the plan's fixed order.
fn mix_inputs(pool: &mut [Buf], mixes: &[Mix], n: usize) {
    for mix in mixes {
        match &mut pool[mix.scratch] {
            Buf::Audio { l, r } => {
                l[..n].fill(0.0);
                r[..n].fill(0.0);
            }
            Buf::Control(values) => values[..n].fill(0.0),
            Buf::Notes(notes) => notes.clear(),
            Buf::Clock(_) | Buf::Sound(_) => {}
        }
        for &source in &mix.sources {
            match pair(pool, mix.scratch, source) {
                (Buf::Audio { l, r }, Buf::Audio { l: from_l, r: from_r }) => {
                    for i in 0..n {
                        l[i] += from_l[i];
                        r[i] += from_r[i];
                    }
                }
                (Buf::Control(values), Buf::Control(from)) => {
                    for i in 0..n {
                        values[i] += from[i];
                    }
                }
                (Buf::Notes(notes), Buf::Notes(from)) => {
                    for event in from.as_slice() {
                        notes.push(*event);
                    }
                }
                _ => {}
            }
        }
        if let Buf::Notes(notes) = &mut pool[mix.scratch] {
            sort_by_offset(notes.as_mut_slice());
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
