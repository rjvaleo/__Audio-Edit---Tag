//! A board compiled for the audio thread.
//!
//! # Off the audio thread, everything
//!
//! [`BoardPlan::compile`] checks the board, puts its stages in order, builds
//! every kernel (`prism_fx` allocates all it needs in `new`), and allocates a
//! stereo buffer of one control block for every out port. Each in port is a
//! list of the buffers its cables come from. What is left for the audio
//! thread is sums, kernels and gains over memory the plan already holds; the
//! synth adopts a plan through the engine's pending-swap pattern and hands
//! the one it replaces back to be dropped elsewhere (`synth.rs`).
//!
//! # A block
//!
//! Every stage runs in order. A stage first sums each in port's cables, then
//! does its kind's work into its out buffers:
//! - an input copies its signal at `level²`;
//! - an effect runs its kernel in place over its input;
//! - Drive is the old chain's unit, with its own mix;
//! - a split copies its input to every out;
//! - a mix sums its ins, each at its level in dB (−60 dB is silence);
//! - a gain scales by its dB;
//! - a pan is a constant-power balance: left `cos(max(p, 0) · π/2)`, right
//!   `cos(max(−p, 0) · π/2)`, `p = pan / 100`, so the centre is unity;
//! - a dry/wet's `send` copies `i`, and its `o` is `i · (1 − w) + ret · w`,
//!   `w = wet / 100`.
//!
//! Gains are ramped across the block from where the last one ended, so a
//! jump is a fast fade. The out node's input is the board's output.
//!
//! # Switched off
//!
//! A node's switch crossfades it with what it passes when off (its main
//! input, or silence for an input) over 10 ms, as the old chain's units did.
//! All the way off, the work is skipped and the output is that signal to the
//! bit; an effect or a Drive left that way is cleared when it next comes in,
//! so it never opens with an old tail.
//!
//! # Sounds
//!
//! [`BoardPlan::compile_with`] asks for each sound a node names and hands it
//! to the kernel, which may allocate there, then prepares the kernel. A node
//! whose effect takes a sound and was given none passes its input through,
//! skipped as a node switched off is.
//!
//! # Controls
//!
//! Each control keeps the value it was set to (`vals`) and the value the node
//! runs at (`cur`). A modulated control runs at its set value moved in the
//! control's own normalised range (the kernel's descriptor, log where it is
//! log) by the sum of its rows, clamped once; when its rows go it returns to
//! its set value. A kernel is told only when the value it runs at changes,
//! and glides there by its own smoothing.

use std::sync::Arc;

use prism_fx::{DynKernel, ParamSpec};

use super::{Board, BoardError, BoardModRow, Kind, SENDS};
use crate::master_fx::Drive;
use crate::patch::SRC_COUNT;
use crate::voice::BLOCK;

/// One control block of stereo.
pub(crate) type Stereo = [[f32; BLOCK]; 2];

/// Silence for every send, for a plan run on its own.
static NO_SENDS: [Stereo; SENDS] = [[[0.0; BLOCK]; 2]; SENDS];

/// The switch's crossfade.
const FADE_SECONDS: f32 = 0.010;
/// How fast a node's level meter falls.
const PEAK_SECONDS: f32 = 0.3;

/// A sound for an effect that takes one: interleaved, `channels` wide, at
/// its own rate. Decoded by whoever compiles the plan, never here.
#[derive(Clone, Debug)]
pub struct Sound {
    pub samples: Arc<Vec<f32>>,
    pub channels: usize,
    pub rate: f32,
}

/// A run of `wires`: the buffers summed into one in port.
#[derive(Clone, Copy, Default)]
struct Span {
    start: u16,
    len: u16,
}

struct PNode {
    kind: Kind,
    specs: &'static [ParamSpec],
    ins: [Span; 4],
    n_in: usize,
    /// The buffer of each out port.
    outs: [usize; 3],
    n_out: usize,
    /// Each control as set.
    vals: Vec<f32>,
    /// Each control as the node runs it.
    cur: Vec<f32>,
    /// This block's sum of mod rows, per control.
    acc: Vec<f32>,
    /// The controls with rows this block, and the last.
    now: u64,
    modded: u64,
    kernel: Option<Box<dyn DynKernel>>,
    drive: Option<Drive>,
    /// The gains the last block ended on (see `targets`).
    gains: [f32; 4],
    want: bool,
    /// The switch's crossfade, 0 (off) to 1 (in).
    on: f32,
    /// Holds state from before it was last all the way off.
    stale: bool,
    /// Takes a sound and has none: it passes its input through.
    unsounded: bool,
    peak: [f32; 2],
}

impl PNode {
    /// Run a control at `v`, telling the kernel if it moved.
    fn apply(&mut self, p: usize, v: f32) {
        if self.cur[p] != v {
            self.cur[p] = v;
            if let Some(k) = self.kernel.as_mut() {
                k.set_param(p, v);
            }
        }
    }

    /// The out port the node's meter reads: a dry/wet's `o`, else the first.
    fn main_out(&self) -> usize {
        match self.kind {
            Kind::DryWet => self.outs[1],
            _ => self.outs[0],
        }
    }

    fn clear(&mut self) {
        if let Some(k) = self.kernel.as_mut() {
            k.reset();
        }
        if let Some(d) = self.drive.as_mut() {
            d.reset();
        }
    }
}

/// A gain in dB, with the bottom of a mix's travel as silence.
#[inline]
fn gain_db(db: f32) -> f32 {
    if db <= -60.0 {
        0.0
    } else {
        10f32.powf(db / 20.0)
    }
}

/// The gains a routing node's controls ask for, in its own order: an input's
/// level, a mix's four ins, a gain's, a pan's left and right, a dry/wet's
/// wet, a Drive's mix.
fn targets(kind: Kind, cur: &[f32]) -> [f32; 4] {
    match kind {
        Kind::Voice | Kind::Send(_) => [cur[0] * cur[0], 0.0, 0.0, 0.0],
        Kind::Mix => [gain_db(cur[1]), gain_db(cur[2]), gain_db(cur[3]), gain_db(cur[4])],
        Kind::Gain => [gain_db(cur[0]), 0.0, 0.0, 0.0],
        Kind::Pan => {
            let p = (cur[0] / 100.0).clamp(-1.0, 1.0);
            let h = std::f32::consts::FRAC_PI_2;
            [(p.max(0.0) * h).cos(), ((-p).max(0.0) * h).cos(), 0.0, 0.0]
        }
        Kind::DryWet => [(cur[0] / 100.0).clamp(0.0, 1.0), 0.0, 0.0, 0.0],
        Kind::Drive => [cur[2].clamp(0.0, 1.0), 0.0, 0.0, 0.0],
        _ => [0.0; 4],
    }
}

/// Sum the buffers of `span` into `dst`.
fn gather(bufs: &[Stereo], wires: &[u16], span: Span, dst: &mut Stereo, n: usize) {
    for ch in dst.iter_mut() {
        ch[..n].iter_mut().for_each(|v| *v = 0.0);
    }
    for &w in &wires[span.start as usize..(span.start + span.len) as usize] {
        let src = &bufs[w as usize];
        for ch in 0..2 {
            for i in 0..n {
                dst[ch][i] += src[ch][i];
            }
        }
    }
}

fn copy(src: &Stereo, dst: &mut Stereo, n: usize) {
    for ch in 0..2 {
        dst[ch][..n].copy_from_slice(&src[ch][..n]);
    }
}

fn meter(peak: &mut [f32; 2], buf: &Stereo, n: usize, fall: f32) {
    for ch in 0..2 {
        let m = buf[ch][..n].iter().fold(0.0f32, |m, v| m.max(v.abs()));
        peak[ch] = (peak[ch] * fall).max(m);
    }
}

/// A board ready to run.
pub struct BoardPlan {
    sr: f32,
    sig: u64,
    nodes: Vec<PNode>,
    /// (node, stage), in an order where every stage's inputs have run.
    steps: Vec<(u16, u8)>,
    bufs: Vec<Stereo>,
    wires: Vec<u16>,
    /// What a node passes when off; also its input sum.
    bypass: Box<Stereo>,
    work: Box<Stereo>,
    sends: u8,
    out: Option<usize>,
    /// The switch's crossfade, per sample.
    fade: f32,
}

impl BoardPlan {
    /// Check and build `board` at `sample_rate`. Allocates; never call it on
    /// the audio thread.
    pub fn compile(board: &Board, sample_rate: f32) -> Result<BoardPlan, BoardError> {
        BoardPlan::compile_with(board, sample_rate, &|_| None)
    }

    /// The same, with each node's sound (`Node::sound`) found by `sounds`:
    /// a name it has no sound for leaves that node passing its input through.
    pub fn compile_with(board: &Board, sample_rate: f32, sounds: &dyn Fn(&str) -> Option<Sound>) -> Result<BoardPlan, BoardError> {
        let sr = if sample_rate.is_finite() && sample_rate > 0.0 { sample_rate } else { 48_000.0 };
        let checked = board.check()?;
        let mut first_buf = Vec::with_capacity(checked.nodes.len());
        let mut n_bufs = 0;
        for r in &checked.nodes {
            first_buf.push(n_bufs);
            n_bufs += r.outs.len();
        }
        let mut wires = Vec::with_capacity(checked.cables.len());
        let mut nodes = Vec::with_capacity(checked.nodes.len());
        for (i, (r, n)) in checked.nodes.iter().zip(&board.nodes).enumerate() {
            let mut ins = [Span::default(); 4];
            for (p, span) in ins.iter_mut().enumerate().take(r.ins.len()) {
                let start = wires.len();
                for c in checked.cables.iter().filter(|c| c[2] == i && c[3] == p) {
                    wires.push((first_buf[c[0]] + c[1]) as u16);
                }
                *span = Span { start: start as u16, len: (wires.len() - start) as u16 };
            }
            let mut outs = [0; 3];
            for (p, o) in outs.iter_mut().enumerate().take(r.outs.len()) {
                *o = first_buf[i] + p;
            }
            let mut unsounded = false;
            let kernel = match r.kind {
                Kind::Fx(e) => {
                    let mut k = (e.make)(sr);
                    for (j, v) in r.vals.iter().enumerate() {
                        if k.param(j) != *v {
                            k.set_param(j, *v);
                        }
                    }
                    if r.kind.takes_sound() {
                        match n.sound.as_deref().and_then(sounds) {
                            Some(s) => k.set_sound(&s.samples, s.channels, s.rate),
                            None => unsounded = true,
                        }
                    }
                    // Glides land: a board opens at its settings.
                    k.reset();
                    Some(k)
                }
                _ => None,
            };
            let drive = matches!(r.kind, Kind::Drive).then(|| Drive::new(sr, r.vals[0]));
            nodes.push(PNode {
                kind: r.kind,
                specs: r.kind.params(),
                ins,
                n_in: r.ins.len(),
                outs,
                n_out: r.outs.len(),
                vals: r.vals.clone(),
                cur: r.vals.clone(),
                acc: vec![0.0; r.vals.len()],
                now: 0,
                modded: 0,
                kernel,
                drive,
                gains: targets(r.kind, &r.vals),
                want: n.on,
                on: if n.on { 1.0 } else { 0.0 },
                stale: false,
                unsounded,
                peak: [0.0; 2],
            });
        }
        let mut sends = 0u8;
        for c in &checked.cables {
            if let Kind::Send(s) = checked.nodes[c[0]].kind {
                sends |= 1 << s;
            }
        }
        Ok(BoardPlan {
            sr,
            sig: board.sig(),
            out: nodes.iter().position(|n| matches!(n.kind, Kind::Out)),
            nodes,
            steps: checked.order.iter().map(|&(n, s)| (n as u16, s as u8)).collect(),
            bufs: vec![[[0.0; BLOCK]; 2]; n_bufs],
            wires,
            bypass: Box::new([[0.0; BLOCK]; 2]),
            work: Box::new([[0.0; BLOCK]; 2]),
            sends,
            fade: 1.0 / (FADE_SECONDS * sr).max(1.0),
        })
    }

    pub fn sample_rate(&self) -> f32 {
        self.sr
    }

    /// The [`Board::sig`] of the board this was built from.
    pub fn sig(&self) -> u64 {
        self.sig
    }

    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    /// Whether a node takes a sound and was given none, so passes its input
    /// through.
    pub fn unsounded(&self, node: usize) -> bool {
        self.nodes.get(node).is_some_and(|n| n.unsounded)
    }

    /// Which sends (a bit each, in [`SENDS`] order) the board has cabled, so
    /// the voices work out only those.
    pub fn sends(&self) -> u8 {
        self.sends
    }

    /// Set a node's control live, in real units, clamped. A modulated control
    /// takes it as the value its rows move from. False for a node or control
    /// that does not exist, or one that changes the ports.
    pub fn set_param(&mut self, node: usize, param: usize, value: f32) -> bool {
        let Some(nd) = self.nodes.get_mut(node) else { return false };
        if param >= nd.specs.len() || nd.kind.structural() == Some(param) || !value.is_finite() {
            return false;
        }
        let v = nd.specs[param].clamp(value);
        nd.vals[param] = v;
        if param >= 64 || nd.modded & (1u64 << param) == 0 {
            nd.apply(param, v);
        }
        true
    }

    /// The value a node's control runs at now, after modulation.
    pub fn param(&self, node: usize, param: usize) -> Option<f32> {
        self.nodes.get(node).and_then(|n| n.cur.get(param).copied())
    }

    /// Switch a node in or out; it crossfades over 10 ms.
    pub fn set_on(&mut self, node: usize, on: bool) -> bool {
        match self.nodes.get_mut(node) {
            Some(nd) => {
                nd.want = on;
                true
            }
            None => false,
        }
    }

    /// Every node's output level, `[left, right]`, with a 300 ms fall, in the
    /// board's order. Returns how many were written.
    pub fn peaks(&self, out: &mut [[f32; 2]]) -> usize {
        let n = self.nodes.len().min(out.len());
        for (o, nd) in out.iter_mut().zip(&self.nodes) {
            *o = nd.peak;
        }
        n
    }

    /// Silence every tail now.
    pub fn reset(&mut self) {
        for nd in self.nodes.iter_mut() {
            nd.clear();
            nd.stale = false;
            nd.peak = [0.0; 2];
        }
    }

    /// Apply this block's board rows with these source values.
    pub(crate) fn modulate(&mut self, rows: &[BoardModRow], src: &[f32; SRC_COUNT]) {
        for row in rows {
            let Some(nd) = self.nodes.get_mut(row.node as usize) else { continue };
            let p = row.param as usize;
            if p >= nd.specs.len() || p >= 64 {
                continue;
            }
            let via = row.via.map_or(1.0, |s| src[s.index()]);
            let x = row.amt * row.curve.apply(src[row.src.index()]) * via;
            if nd.now & (1u64 << p) == 0 {
                nd.now |= 1u64 << p;
                nd.acc[p] = 0.0;
            }
            nd.acc[p] += x;
        }
        for nd in self.nodes.iter_mut() {
            let mut bits = nd.now | nd.modded;
            while bits != 0 {
                let p = bits.trailing_zeros() as usize;
                bits &= bits - 1;
                let spec = &nd.specs[p];
                let v = if nd.now & (1u64 << p) != 0 { spec.from_unit(spec.to_unit(nd.vals[p]) + nd.acc[p]) } else { nd.vals[p] };
                nd.apply(p, v);
            }
            nd.modded = nd.now;
            nd.now = 0;
        }
    }

    /// Run the board over `left` and `right` in place, as its voice input,
    /// with every send silent. Any length.
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = left.len().min(right.len());
        let mut done = 0;
        while done < n {
            let len = BLOCK.min(n - done);
            self.block(&mut left[done..done + len], &mut right[done..done + len], &NO_SENDS);
            done += len;
        }
    }

    /// One control block (at most [`BLOCK`] frames): `l` and `r` hold the
    /// voice and get the board's output; `sends` the sends, at this rate.
    pub(crate) fn block(&mut self, l: &mut [f32], r: &mut [f32], sends: &[Stereo; SENDS]) {
        let n = l.len().min(r.len()).min(BLOCK);
        let fall = (-(n as f32) / (PEAK_SECONDS * self.sr)).exp();
        for s in 0..self.steps.len() {
            let (node, stage) = self.steps[s];
            self.run(node as usize, stage as usize, n, l, r, sends, fall);
        }
        match self.out {
            Some(o) => {
                let nd = &mut self.nodes[o];
                gather(&self.bufs, &self.wires, nd.ins[0], &mut self.work, n);
                meter(&mut nd.peak, &self.work, n, fall);
                l[..n].copy_from_slice(&self.work[0][..n]);
                r[..n].copy_from_slice(&self.work[1][..n]);
            }
            None => {
                l[..n].iter_mut().for_each(|v| *v = 0.0);
                r[..n].iter_mut().for_each(|v| *v = 0.0);
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn run(&mut self, node: usize, stage: usize, n: usize, l: &[f32], r: &[f32], sends: &[Stereo; SENDS], fall: f32) {
        let BoardPlan { nodes, bufs, wires, bypass, work, fade, .. } = self;
        let nd = &mut nodes[node];
        let (bypass, work) = (&mut **bypass, &mut **work);
        match nd.kind {
            Kind::Out => return,
            Kind::Split => {
                gather(bufs, wires, nd.ins[0], bypass, n);
                for p in 0..nd.n_out {
                    copy(bypass, &mut bufs[nd.outs[p]], n);
                }
                meter(&mut nd.peak, bypass, n, fall);
                return;
            }
            Kind::DryWet if stage == 0 => {
                gather(bufs, wires, nd.ins[0], bypass, n);
                copy(bypass, &mut bufs[nd.outs[0]], n);
                return;
            }
            k if k.is_input() => {
                for ch in bypass.iter_mut() {
                    ch[..n].iter_mut().for_each(|v| *v = 0.0);
                }
            }
            _ => gather(bufs, wires, nd.ins[0], bypass, n),
        }
        let o = nd.main_out();
        let want = if nd.want { 1.0 } else { 0.0 };
        if nd.unsounded || (want == 0.0 && nd.on == 0.0) {
            copy(bypass, &mut bufs[o], n);
            nd.stale = true;
            meter(&mut nd.peak, bypass, n, fall);
            return;
        }
        if nd.on == 0.0 && nd.stale {
            nd.clear();
            nd.stale = false;
        }
        let g0 = nd.gains;
        let g1 = targets(nd.kind, &nd.cur);
        nd.gains = g1;
        let ramp = |k: usize, i: usize| g0[k] + (g1[k] - g0[k]) * (i + 1) as f32 / n as f32;
        match nd.kind {
            Kind::Voice => {
                let out = &mut bufs[o];
                for i in 0..n {
                    let g = ramp(0, i);
                    out[0][i] = l[i] * g;
                    out[1][i] = r[i] * g;
                }
            }
            Kind::Send(s) => {
                let out = &mut bufs[o];
                for i in 0..n {
                    let g = ramp(0, i);
                    out[0][i] = sends[s][0][i] * g;
                    out[1][i] = sends[s][1][i] * g;
                }
            }
            Kind::Fx(_) => {
                let [ol, or] = &mut bufs[o];
                ol[..n].copy_from_slice(&bypass[0][..n]);
                or[..n].copy_from_slice(&bypass[1][..n]);
                if let Some(k) = nd.kernel.as_mut() {
                    k.process(&mut ol[..n], &mut or[..n]);
                }
            }
            Kind::Drive => {
                let out = &mut bufs[o];
                copy(bypass, out, n);
                if let Some(d) = nd.drive.as_mut() {
                    let [ol, or] = out;
                    d.process(nd.cur[0], nd.cur[1], &mut ol[..n], &mut or[..n]);
                }
                for i in 0..n {
                    let m = ramp(0, i);
                    for ch in 0..2 {
                        out[ch][i] = bypass[ch][i] * (1.0 - m) + out[ch][i] * m;
                    }
                }
            }
            Kind::Mix => {
                for ch in bufs[o].iter_mut() {
                    ch[..n].iter_mut().for_each(|v| *v = 0.0);
                }
                for p in 0..nd.n_in {
                    gather(bufs, wires, nd.ins[p], work, n);
                    let out = &mut bufs[o];
                    for i in 0..n {
                        let g = ramp(p, i);
                        out[0][i] += work[0][i] * g;
                        out[1][i] += work[1][i] * g;
                    }
                }
            }
            Kind::Gain => {
                let out = &mut bufs[o];
                for i in 0..n {
                    let g = ramp(0, i);
                    out[0][i] = bypass[0][i] * g;
                    out[1][i] = bypass[1][i] * g;
                }
            }
            Kind::Pan => {
                let out = &mut bufs[o];
                for i in 0..n {
                    out[0][i] = bypass[0][i] * ramp(0, i);
                    out[1][i] = bypass[1][i] * ramp(1, i);
                }
            }
            Kind::DryWet => {
                gather(bufs, wires, nd.ins[1], work, n);
                let out = &mut bufs[o];
                for i in 0..n {
                    let w = ramp(0, i);
                    out[0][i] = bypass[0][i] * (1.0 - w) + work[0][i] * w;
                    out[1][i] = bypass[1][i] * (1.0 - w) + work[1][i] * w;
                }
            }
            Kind::Out | Kind::Split => {}
        }
        let out = &mut bufs[o];
        if !(want == 1.0 && nd.on == 1.0) {
            let mut on = nd.on;
            for i in 0..n {
                // Toward the switch, and still once there: a unit all the way
                // in must not step a fade's worth out every other sample.
                on = if want > on {
                    (on + *fade).min(1.0)
                } else if want < on {
                    (on - *fade).max(0.0)
                } else {
                    on
                };
                for ch in 0..2 {
                    out[ch][i] = bypass[ch][i] + (out[ch][i] - bypass[ch][i]) * on;
                }
            }
            nd.on = on;
            if on == 0.0 {
                nd.stale = true;
            }
        }
        meter(&mut nd.peak, out, n, fall);
    }
}
