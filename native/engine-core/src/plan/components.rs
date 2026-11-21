//! Compile feedback islands off audio; render each in its own prepared pool.
use super::*;

pub(super) struct Component {
    nodes: Vec<usize>,
    ops: Vec<Op>,
    pool: Vec<Buf>,
    external: Vec<usize>,
    outputs: Vec<usize>,
    delay: usize,
}

/// Iterative Kosaraju: graph depth never consumes the controller's call stack.
fn groups(next: &[BTreeSet<usize>]) -> (Vec<Vec<usize>>, Vec<usize>) {
    let mut seen = vec![false; next.len()];
    let mut order = Vec::with_capacity(next.len());
    for root in 0..next.len() {
        let mut stack = vec![(root, false)];
        while let Some((node, done)) = stack.pop() {
            if done {
                order.push(node);
                continue;
            }
            if seen[node] {
                continue;
            }
            seen[node] = true;
            stack.push((node, true));
            for &child in next[node].iter().rev() {
                if !seen[child] {
                    stack.push((child, false));
                }
            }
        }
    }
    let mut before = vec![Vec::new(); next.len()];
    for (node, children) in next.iter().enumerate() {
        for &child in children {
            before[child].push(node);
        }
    }
    let mut group_of = vec![usize::MAX; next.len()];
    let mut result = Vec::new();
    for root in order.into_iter().rev() {
        if group_of[root] != usize::MAX {
            continue;
        }
        let group = result.len();
        let mut members = Vec::new();
        let mut stack = vec![root];
        group_of[root] = group;
        while let Some(node) = stack.pop() {
            members.push(node);
            for &parent in &before[node] {
                if group_of[parent] == usize::MAX {
                    group_of[parent] = group;
                    stack.push(parent);
                }
            }
        }
        members.sort_unstable();
        result.push(members);
    }
    (result, group_of)
}
fn kind(buf: &Buf) -> Kind {
    match buf {
        Buf::Audio { .. } => Kind::Audio,
        Buf::Control(_) => Kind::Control,
        Buf::Notes(_) => Kind::Notes,
        Buf::Clock(_) | Buf::ClockFrames(_) => Kind::Clock,
        Buf::Sound(_) | Buf::SoundFrames(_) => Kind::Sound,
    }
}
pub(super) fn compile(
    next: &[BTreeSet<usize>],
    nodes: &[Node],
    ops: &[Op],
    pool: &[Buf],
    delays: &[usize],
    max_block: usize,
) -> (Vec<Level>, Vec<Component>) {
    let (groups, group_of) = groups(next);
    let mut children = vec![BTreeSet::new(); groups.len()];
    let mut waiting = vec![0usize; groups.len()];
    for (node, edges) in next.iter().enumerate() {
        for &child in edges {
            let a = group_of[node];
            let b = group_of[child];
            if a != b && children[a].insert(b) {
                waiting[b] += 1;
            }
        }
    }
    let mut ready = BTreeSet::new();
    for group in 0..groups.len() {
        if waiting[group] == 0 {
            ready.insert((groups[group][0], group));
        }
    }
    let mut depth = vec![0usize; groups.len()];
    let mut levels = Vec::<Level>::new();
    let mut components = Vec::new();
    while let Some((_, group)) = ready.pop_first() {
        let level = depth[group];
        while levels.len() <= level {
            levels.push(Level {
                ops: Vec::new(),
                serial: Vec::new(),
                parallel: Vec::new(),
                weight: 0,
                heavy: 0,
                components: Vec::new(),
            });
        }
        let members = &groups[group];
        let looping = members.len() > 1 || next[members[0]].contains(&members[0]);
        if looping {
            let outputs: BTreeSet<usize> = members
                .iter()
                .flat_map(|&node| {
                    nodes[node].out_start..nodes[node].out_start + nodes[node].out_count
                })
                .collect();
            let mut required = outputs.clone();
            let mut external = BTreeSet::new();
            for &index in members {
                let node = &nodes[index];
                let scratches: BTreeSet<usize> = node.mixes.iter().map(|mix| mix.scratch).collect();
                for &input in &node.inputs {
                    required.insert(input);
                    if !outputs.contains(&input) && !scratches.contains(&input) {
                        external.insert(input);
                    }
                }
                for mix in &node.mixes {
                    required.insert(mix.scratch);
                    for src in &mix.sources {
                        required.insert(src.place);
                        if !outputs.contains(&src.place) {
                            external.insert(src.place);
                        }
                    }
                }
            }
            let local = pool
                .iter()
                .enumerate()
                .map(|(index, buf)| {
                    if required.contains(&index) {
                        Buf::new(kind(buf), max_block)
                    } else {
                        Buf::Control(Box::new([]))
                    }
                })
                .collect();
            let component_ops = ops
                .iter()
                .filter(|op| members.binary_search(&op.node()).is_ok())
                .copied()
                .collect();
            let delay = members
                .iter()
                .filter_map(|&node| (delays[node] > 0).then_some(delays[node]))
                .min()
                .expect("compiled feedback has a delay");
            levels[level].components.push(components.len());
            components.push(Component {
                nodes: members.clone(),
                ops: component_ops,
                pool: local,
                external: external.into_iter().collect(),
                outputs: outputs.into_iter().collect(),
                delay,
            });
        } else {
            let index = members[0];
            let op = Op::Process(index);
            let weight = nodes[index].weight;
            levels[level].ops.push(op);
            if weight == 0 {
                levels[level].serial.push(op);
            } else {
                levels[level].parallel.push(op);
            }
            levels[level].weight += weight;
            levels[level].heavy += usize::from(weight > 0);
        }
        for &child in &children[group] {
            depth[child] = depth[child].max(level + 1);
            waiting[child] -= 1;
            if waiting[child] == 0 {
                ready.insert((groups[child][0], child));
            }
        }
    }
    (levels, components)
}

impl Component {
    pub(super) fn run(
        &mut self,
        nodes: &mut [Node],
        pool: &mut [Buf],
        events: &[(u32, EventKind)],
        local_events: &mut Vec<(u32, EventKind)>,
        n: usize,
        rate: f32,
        frame: u64,
        sounds: &Sounds,
        step: f32,
        fade_left: usize,
        host: crate::HostInputs,
    ) -> u64 {
        // When the callback already fits this loop, no offset views or
        // accumulation are needed. Keep 031's direct-buffer path for it.
        let has_interior_event = self.nodes.iter().any(|&index| {
            let node = &nodes[index];
            events[node.event_source_start..node.event_source_start + node.event_source_len]
                .iter()
                .any(|&(offset, _)| offset > 0 && (offset as usize) < n)
        });
        if n <= self.delay && !has_interior_event {
            return run_ops(
                nodes, pool, &self.ops, n, rate, frame, sounds, step, fade_left, events, host,
            );
        }
        for &output in &self.outputs {
            if let Buf::Notes(notes) = &mut pool[output] {
                notes.end();
                notes.clear();
            }
        }
        let mut at = 0;
        let mut tripped = 0;
        while at < n {
            let mut end = n.min(at + self.delay);
            // Opaque feedback emit/absorb callbacks share state. Controls cut
            // this island only, before both halves, preserving 031's ordering.
            for &index in &self.nodes {
                let node = &nodes[index];
                for &(offset, _) in &events
                    [node.event_source_start..node.event_source_start + node.event_source_len]
                {
                    if offset as usize > at && (offset as usize) < end {
                        end = offset as usize;
                    }
                }
            }
            local_events.clear();
            for &index in &self.nodes {
                let node = &mut nodes[index];
                node.event_start = local_events.len();
                for &(offset, event) in &events
                    [node.event_source_start..node.event_source_start + node.event_source_len]
                {
                    if offset as usize >= at && (offset as usize) < end {
                        local_events.push((offset - at as u32, event));
                    }
                }
                node.event_len = local_events.len() - node.event_start;
            }
            for &input in &self.external {
                copy(&pool[input], &mut self.pool[input], at, 0, end - at, true);
            }
            tripped += run_ops(
                nodes,
                &mut self.pool,
                &self.ops,
                end - at,
                rate,
                frame + at as u64,
                sounds,
                step,
                fade_left.saturating_sub(at),
                local_events,
                host,
            );
            for &output in &self.outputs {
                copy(
                    &self.pool[output],
                    &mut pool[output],
                    0,
                    at,
                    end - at,
                    false,
                );
            }
            for &index in &self.nodes {
                let node = &mut nodes[index];
                if node.dead || !node.hands_back {
                    continue;
                }
                if let Some(module) = node.module.as_mut() {
                    while node.scratch.retired.len() < node.scratch.retired.capacity() {
                        match catch_unwind(AssertUnwindSafe(|| module.finished())) {
                            Ok(Some(thing)) => node.scratch.retired.push_back(thing),
                            Ok(None) => break,
                            Err(payload) => {
                                node.dead = true;
                                node.panic = Some(payload);
                                break;
                            }
                        }
                    }
                }
            }
            at = end;
        }
        for &output in &self.outputs {
            pool[output].mark_silence(n);
        }
        tripped
    }
}
fn copy(from: &Buf, to: &mut Buf, source: usize, dest: usize, n: usize, clear: bool) {
    match (from, &mut *to) {
        (Buf::Audio { l, r, .. }, Buf::Audio { l: a, r: b, .. }) => {
            a[dest..dest + n].copy_from_slice(&l[source..source + n]);
            b[dest..dest + n].copy_from_slice(&r[source..source + n]);
        }
        (Buf::Control(a), Buf::Control(b)) => {
            b[dest..dest + n].copy_from_slice(&a[source..source + n])
        }
        (Buf::Notes(a), Buf::Notes(b)) => {
            b.end();
            if clear {
                b.clear();
            }
            for note in a.as_slice() {
                if note.offset as usize >= source && (note.offset as usize) < source + n {
                    b.push(NoteEvent {
                        offset: note.offset - source as u32 + dest as u32,
                        ..*note
                    });
                }
            }
        }
        (Buf::ClockFrames(a), Buf::ClockFrames(b)) => {
            b[dest..dest + n].copy_from_slice(&a[source..source + n])
        }
        (Buf::SoundFrames(a), Buf::SoundFrames(b)) => {
            b[dest..dest + n].copy_from_slice(&a[source..source + n])
        }
        _ => unreachable!("prepared component buffers retain their kinds"),
    }
    if clear {
        to.mark_silence(n);
    }
}
