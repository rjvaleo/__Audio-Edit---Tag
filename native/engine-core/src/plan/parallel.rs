//! The only mutable ranges handed to a worker are its node and output ports.
#![allow(unsafe_code)]
use super::*;
use std::slice;

pub(super) struct Job {
    host: crate::HostInputs<'static>,
    node: *mut Node,
    events: *const (u32, EventKind),
    event_len: usize,
    outs: *mut Buf,
    count: usize,
    n: usize,
    rate: f32,
    frame: u64,
    sounds: *const Sounds,
    fade_left: usize,
    pub(super) tripped: u64,
}
// SAFETY: compiled DAG levels contain each node once. Outputs have disjoint
// ranges, and all reads refer to earlier levels or private pre-mixed inputs.
// The synchronous pool join ends every borrow before the plan can be edited.
unsafe impl Send for Job {}
impl Job {
    pub(super) fn new(
        node: &mut Node,
        pool: &mut [Buf],
        n: usize,
        rate: f32,
        frame: u64,
        sounds: &Sounds,
        fade_left: usize,
        events: &[(u32, EventKind)],
        host: crate::HostInputs,
    ) -> Self {
        assert!(node.out_start + node.out_count <= pool.len());
        Self {
            // SAFETY: like sounds and read buffers, this borrow cannot
            // outlive the synchronous dispatch/join of this callback.
            host: unsafe { std::mem::transmute::<crate::HostInputs<'_>, crate::HostInputs<'static>>(host) },
            outs: unsafe { pool.as_mut_ptr().add(node.out_start) },
            events: events.as_ptr(), event_len: events.len(),
            count: node.out_count,
            node,
            n,
            rate,
            frame,
            sounds,
            fade_left,
            tripped: 0,
        }
    }
}
/// Pool callbacks never unwind past their job, including engine-side faults.
pub(super) fn execute(job: &mut Job) {
    let result = catch_unwind(AssertUnwindSafe(|| unsafe { run(job) }));
    if let Err(payload) = result {
        // SAFETY: this job is still the exclusive owner of these ranges.
        unsafe {
            let node = &mut *job.node;
            node.dead = true;
            node.panic = Some(payload);
            let outs = slice::from_raw_parts_mut(job.outs, job.count);
            for out in outs.iter_mut() { if let Buf::Notes(notes) = out { notes.end(); } }
            silence(outs, job.n);
        }
    }
}
unsafe fn run(job: &mut Job) {
    let node = &mut *job.node;
    let outs = slice::from_raw_parts_mut(job.outs, job.count);
    let n = job.n;
    if node.ghost && job.fade_left == 0 {
        return;
    }
    if node.dead {
        silence(outs, n);
        return;
    }
    let Some(module) = node.module.as_mut() else {
        return;
    };
    if node.can_sleep {
        let quiet = node.reads.iter().all(|read| read.get().is_silent());
        let settled = outs.iter().all(Buf::is_silent);
        if node.event_len == 0 && quiet && node.tail_left == 0 && settled {
            if !node.asleep {
                for buf in outs.iter_mut() {
                    if let Buf::Audio { l, r, silent } = buf {
                        l.fill(0.0);
                        r.fill(0.0);
                        *silent = true;
                    }
                }
                node.asleep = true;
            }
            return;
        }
        node.asleep = false;
        if quiet {
            node.tail_left = node.tail_left.saturating_sub(n);
        } else {
            node.tail_left = node.tail;
        }
    }
    for buf in outs.iter_mut() {
        if let Buf::Notes(notes) = buf {
            notes.clear();
        }
    }
    let mut io = Io {
        host: job.host,
        events: slice::from_raw_parts(job.events, job.event_len),
        scratch: &mut node.scratch,
        n,
        rate: job.rate,
        frame: job.frame,
        ins: Inputs {
            offset: 0, notes: None,
            reads: Some(&node.reads),
            before: &[],
            after: &[],
            gap_start: 0,
            gap_len: 0,
            map: &[],
            n,
        },
        outs: Outputs { bufs: outs, n, rate: job.rate },
        sounds: &*job.sounds,
    };
    if let Err(payload) = catch_unwind(AssertUnwindSafe(|| module.process_events(&mut io))) {
        node.dead = true;
        node.panic = Some(payload);
        for out in outs.iter_mut() { if let Buf::Notes(notes) = out { notes.end(); } }
        silence(outs, n);
        return;
    }
    job.tripped += std::mem::take(&mut node.scratch.tripped);
    if let Some(payload) = node.scratch.panic.take() { node.dead = true; node.panic = Some(payload); }
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
        job.tripped += 1;
    }
    for buf in outs.iter_mut() {
        buf.mark_silence(n);
    }
}

/// Keep the unsafe pool contract here with the callback that catches unwinds.
pub(super) fn dispatch(pool: &mut crate::pool::Pool, jobs: &mut [Job]) {
    // SAFETY: execute catches callback and engine-side unwinds; the compiler
    // supplied disjoint node/output ranges and completed all input sources.
    unsafe {
        pool.run(jobs, execute);
    }
}
