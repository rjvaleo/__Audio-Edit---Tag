//! The FX view's board (v8): the synth's master bus as a graph of effects
//! that the player patches, in the spirit of Plogue Bidule.
//!
//! # The model
//!
//! A [`Board`] is a name, its [`Node`]s and its [`Cable`]s. It is what the
//! patch stores under `board`, and on its own it is a board preset. A node has
//! a stable string `id`, a `kind`, a place on the canvas, a power switch and
//! its controls by key, in real units. The kinds:
//!
//! | Kind | Ins | Outs | Controls |
//! |---|---|---|---|
//! | `in:voice` | | `o` | `level` |
//! | `in:osc0` `in:osc1` `in:osc2` `in:sub` `in:noise` | | `o` | `level` |
//! | `out` | `i` | | |
//! | `fx:<id>` | `i` | `o` | the effect's own (`prism-fx`) |
//! | `wave:drive` | `i` | `o` | `drive` `tone` `mix` |
//! | `split` | `i` | `o0` `o1` (`o2`) | `outs` |
//! | `mix` | `i0` `i1` (`i2` `i3`) | `o` | `ins`, `l0`…`l3` dB |
//! | `gain` | `i` | `o` | `db` |
//! | `pan` | `i` | `o` | `pan` −100..100 |
//! | `drywet` | `i` `ret` | `send` `o` | `wet` % |
//!
//! `in:voice` is everything after the filters, the board's main input. The
//! other inputs are sends: each source's signal before the filters, after the
//! amp envelope, summed over the voices. Every input is scaled by `master`
//! first, as the old chain's input was, and by its own `level` squared (the
//! synth's level law). `fx:<id>` is any of the 82 effects in the mock-up's
//! FX-LIST: the `prism-fx` catalogue without the four older approximations
//! it replaced ([`RETIRED`]). `wave:drive` is the old chain's Drive, kept so a
//! migrated patch sounds the same.
//!
//! # Cables
//!
//! A cable runs from an out port to an in port. An out may feed any number of
//! ins; the cables into one in are summed. No cable may close a loop: the
//! check names the first one that would. The dry/wet node is two stages —
//! `send` copies `i`, and `o` mixes `i` with `ret` — so a branch from `send`
//! back into `ret` is not a loop, though one from `o` back into `ret` is.
//!
//! # Switched off
//!
//! A node that is off passes its main input through (`i`, or `i0` for a
//! mix); an input that is off is silent; a split and the out ignore it. See
//! `plan.rs` for how it fades.
//!
//! # Sounds (v8b)
//!
//! An effect that takes a sound as well as its input — Convolution its
//! impulse response, Spectral Dynamics its threshold sound — names it in the
//! node's `sound`, a library path. The board holds only the name: the server
//! decodes the file off the audio thread, and [`BoardPlan::compile_with`]
//! hands it to the kernel before the plan is swapped in. A changed sound is a
//! new plan, since a kernel takes a sound only off the audio thread. A
//! Convolution node with no sound, or one that could not be read, passes its
//! input through, to the bit; Spectral Dynamics keeps its level-only mode.
//!
//! # Modulation
//!
//! A mod row's `dst` may be `board:<nodeId>:<key>`. Such rows live in the
//! patch's `mods` with the rest (the 64-row limit is shared) and are compiled
//! here, against the board, into [`BoardModRow`]s by node and control
//! position. A row naming a node or control the board lacks is skipped, as an
//! unknown key is in the matrix. `outs` and `ins` change the ports, so they
//! are not targets.

use prism_fx::{Category, Entry};

use crate::patch::{Curve, Mod, Patch, Source, MAX_MODS};

mod migrate;
mod plan;

pub use migrate::input_nodes;
pub use prism_fx::{ParamKind, ParamSpec};
pub use plan::{BoardPlan, Sound};
pub(crate) use plan::Stereo;

/// Most nodes a board may have.
pub const MAX_NODES: usize = 64;
/// Most cables a board may have.
pub const MAX_CABLES: usize = 256;
/// The send inputs, in order: `in:osc0`, `in:osc1`, `in:osc2`, `in:sub`,
/// `in:noise`.
pub const SENDS: usize = 5;
/// The send each oscillator, the sub and the noise feed.
pub const SEND_OSC0: usize = 0;
pub const SEND_SUB: usize = 3;
pub const SEND_NOISE: usize = 4;

/// The four older approximations FX-LIST.md drops for the exact Hyperprism
/// ports that replaced them. They stay in `prism-fx` for the rack's old
/// documents; a board cannot have them.
pub static RETIRED: [&str; 4] = ["tremolo", "decimator", "multi-delay", "stereo-matrix"];

/// The board's effects: the 82 of FX-LIST.md, in the catalogue's order.
pub fn fx_entries() -> impl Iterator<Item = &'static Entry> {
    prism_fx::CATALOG.iter().filter(|e| !RETIRED.contains(&e.descriptor.id))
}

/// Which family an effect comes from, by its id: `Hyperprism`, `SoundHack`,
/// `Lexicon`, or empty for the app's own.
pub fn suite(id: &str) -> &'static str {
    if id.starts_with("hp-") {
        "Hyperprism"
    } else if id.starts_with("sh-") || id == "convolution" || id == "spectral-dynamics" {
        "SoundHack"
    } else if id.starts_with("lxp-") {
        "Lexicon"
    } else {
        ""
    }
}

/// A category as the page names it.
pub fn category_name(c: Category) -> &'static str {
    match c {
        Category::Delay => "delay",
        Category::Reverb => "reverb",
        Category::Modulation => "modulation",
        Category::Stereo => "stereo",
        Category::Filter => "filter",
        Category::Spectral => "spectral",
        Category::Pitch => "pitch",
        Category::Distortion => "distortion",
        Category::Dynamics => "dynamics",
        Category::Granular => "granular",
        Category::Utility => "utility",
    }
}

// ─────────────────────────────────────────────────────────────── kinds

const fn db(key: &'static str, label: &'static str, min: f32, max: f32) -> ParamSpec {
    ParamSpec::new(key, label, min, max, 0.0).unit("dB")
}

static IN_PARAMS: [ParamSpec; 1] = [ParamSpec::new("level", "Level", 0.0, 1.0, 1.0)];
static SPLIT_PARAMS: [ParamSpec; 1] = [ParamSpec::new("outs", "Outs", 2.0, 3.0, 2.0).kind(ParamKind::Int)];
static MIX_PARAMS: [ParamSpec; 5] = [
    ParamSpec::new("ins", "Ins", 2.0, 4.0, 2.0).kind(ParamKind::Int),
    db("l0", "In 1", -60.0, 6.0),
    db("l1", "In 2", -60.0, 6.0),
    db("l2", "In 3", -60.0, 6.0),
    db("l3", "In 4", -60.0, 6.0),
];
static GAIN_PARAMS: [ParamSpec; 1] = [db("db", "Gain", -24.0, 24.0)];
static PAN_PARAMS: [ParamSpec; 1] = [ParamSpec::new("pan", "Pan", -100.0, 100.0, 0.0)];
static DRYWET_PARAMS: [ParamSpec; 1] = [ParamSpec::new("wet", "Wet", 0.0, 100.0, 35.0).unit("%")];
static DRIVE_PARAMS: [ParamSpec; 3] = [
    ParamSpec::new("drive", "Drive", 0.0, 1.0, 0.45),
    ParamSpec::new("tone", "Tone", 0.0, 1.0, 0.3),
    ParamSpec::new("mix", "Mix", 0.0, 1.0, 0.7),
];

static NO_PORTS: [&str; 0] = [];
static ONE_IN: [&str; 1] = ["i"];
static ONE_OUT: [&str; 1] = ["o"];
static MIX_INS: [&str; 4] = ["i0", "i1", "i2", "i3"];
static SPLIT_OUTS: [&str; 3] = ["o0", "o1", "o2"];
static DRYWET_INS: [&str; 2] = ["i", "ret"];
static DRYWET_OUTS: [&str; 2] = ["send", "o"];

/// What a node is.
#[derive(Clone, Copy)]
pub enum Kind {
    Voice,
    /// A send, by its index in [`SENDS`].
    Send(usize),
    Out,
    Fx(&'static Entry),
    Drive,
    Split,
    Mix,
    Gain,
    Pan,
    DryWet,
}

impl std::fmt::Debug for Kind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Kind::Fx(e) => write!(f, "Fx({})", e.descriptor.id),
            Kind::Send(s) => write!(f, "Send({s})"),
            k => f.write_str(match k {
                Kind::Voice => "Voice",
                Kind::Out => "Out",
                Kind::Drive => "Drive",
                Kind::Split => "Split",
                Kind::Mix => "Mix",
                Kind::Gain => "Gain",
                Kind::Pan => "Pan",
                _ => "DryWet",
            }),
        }
    }
}

impl Kind {
    pub fn parse(s: &str) -> Option<Kind> {
        Some(match s {
            "in:voice" => Kind::Voice,
            "in:osc0" => Kind::Send(0),
            "in:osc1" => Kind::Send(1),
            "in:osc2" => Kind::Send(2),
            "in:sub" => Kind::Send(SEND_SUB),
            "in:noise" => Kind::Send(SEND_NOISE),
            "out" => Kind::Out,
            "wave:drive" => Kind::Drive,
            "split" => Kind::Split,
            "mix" => Kind::Mix,
            "gain" => Kind::Gain,
            "pan" => Kind::Pan,
            "drywet" => Kind::DryWet,
            _ => {
                let id = s.strip_prefix("fx:")?;
                if RETIRED.contains(&id) {
                    return None;
                }
                Kind::Fx(prism_fx::find(id)?)
            }
        })
    }

    /// Every control, in order: a control's position is its index.
    pub fn params(self) -> &'static [ParamSpec] {
        match self {
            Kind::Voice | Kind::Send(_) => &IN_PARAMS,
            Kind::Out => &[],
            Kind::Fx(e) => e.descriptor.params,
            Kind::Drive => &DRIVE_PARAMS,
            Kind::Split => &SPLIT_PARAMS,
            Kind::Mix => &MIX_PARAMS,
            Kind::Gain => &GAIN_PARAMS,
            Kind::Pan => &PAN_PARAMS,
            Kind::DryWet => &DRYWET_PARAMS,
        }
    }

    /// The control that sets how many ports the node has: a split's `outs`, a
    /// mix's `ins`.
    pub fn structural(self) -> Option<usize> {
        matches!(self, Kind::Split | Kind::Mix).then_some(0)
    }

    /// Whether the node's effect takes a sound (`Node::sound`).
    pub fn takes_sound(self) -> bool {
        matches!(self, Kind::Fx(e) if e.descriptor.sound.is_some())
    }

    /// Takes a sound and does nothing without one, so passes its input
    /// through: Convolution. Spectral Dynamics has its levels without one.
    pub fn needs_sound(self) -> bool {
        self.takes_sound() && !matches!(self, Kind::Fx(e) if e.descriptor.id == "spectral-dynamics")
    }

    pub fn is_input(self) -> bool {
        matches!(self, Kind::Voice | Kind::Send(_))
    }

    /// The in ports, for `count` from the structural control.
    pub fn ins(self, count: usize) -> &'static [&'static str] {
        match self {
            Kind::Voice | Kind::Send(_) => &NO_PORTS,
            Kind::Mix => &MIX_INS[..count.clamp(2, 4)],
            Kind::DryWet => &DRYWET_INS,
            _ => &ONE_IN,
        }
    }

    /// The out ports, for `count` from the structural control.
    pub fn outs(self, count: usize) -> &'static [&'static str] {
        match self {
            Kind::Out => &NO_PORTS,
            Kind::Split => &SPLIT_OUTS[..count.clamp(2, 3)],
            Kind::DryWet => &DRYWET_OUTS,
            _ => &ONE_OUT,
        }
    }

    /// The node's stages: which in ports (a bit each) feed which out ports.
    /// Every kind is one stage but the dry/wet, whose `send` hears only `i`.
    pub(crate) fn stages(self) -> &'static [(u8, u8)] {
        match self {
            Kind::DryWet => &[(0b01, 0b01), (0b11, 0b10)],
            _ => &[(0xff, 0xff)],
        }
    }
}

// ─────────────────────────────────────────────────────────────── the model

#[derive(Clone, Debug, PartialEq)]
pub struct Node {
    pub id: String,
    pub kind: String,
    pub x: f32,
    pub y: f32,
    pub on: bool,
    /// Controls by key, in real units. One left out takes its default.
    pub params: Vec<(String, f32)>,
    /// The sound an effect that takes one is given, as a library path.
    pub sound: Option<String>,
}

impl Node {
    pub fn new(id: &str, kind: &str, x: f32, y: f32) -> Node {
        Node { id: id.into(), kind: kind.into(), x, y, on: true, params: Vec::new(), sound: None }
    }

    pub fn with_sound(mut self, sound: &str) -> Node {
        self.sound = (!sound.is_empty()).then(|| sound.to_string());
        self
    }

    pub fn with(mut self, key: &str, value: f32) -> Node {
        self.params.retain(|(k, _)| k != key);
        self.params.push((key.into(), value));
        self
    }

    pub fn switched(mut self, on: bool) -> Node {
        self.on = on;
        self
    }

    pub fn param(&self, key: &str) -> Option<f32> {
        self.params.iter().find(|(k, _)| k == key).map(|(_, v)| *v)
    }
}

/// `from` an out port to an in port, each `(nodeId, port)`.
#[derive(Clone, Debug, PartialEq)]
pub struct Cable {
    pub from: (String, String),
    pub to: (String, String),
}

impl Cable {
    pub fn new(from: &str, from_port: &str, to: &str, to_port: &str) -> Cable {
        Cable { from: (from.into(), from_port.into()), to: (to.into(), to_port.into()) }
    }
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Board {
    pub name: String,
    pub nodes: Vec<Node>,
    pub cables: Vec<Cable>,
}

/// Why a board was refused. `cable` is the index of the cable at fault, when
/// one is: for a loop, the first cable that closes it.
#[derive(Clone, Debug, PartialEq)]
pub struct BoardError {
    pub message: String,
    pub cable: Option<usize>,
}

impl std::fmt::Display for BoardError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

fn refuse<T>(message: String) -> Result<T, BoardError> {
    Err(BoardError { message, cable: None })
}

/// A node as checked: its kind, every control's value, its ports.
pub(crate) struct Resolved {
    pub kind: Kind,
    pub vals: Vec<f32>,
    pub ins: &'static [&'static str],
    pub outs: &'static [&'static str],
}

/// A board as checked: nodes in the board's order, cables as
/// `[from node, out port, to node, in port]`, and the stages in an order
/// where everything a stage reads has already run.
pub(crate) struct Checked {
    pub nodes: Vec<Resolved>,
    pub cables: Vec<[usize; 4]>,
    pub order: Vec<(usize, usize)>,
}

/// Whether stage `to` can be reached from stage `from` along `edges`.
fn reaches(edges: &[Vec<usize>], from: usize, to: usize) -> bool {
    let mut seen = vec![false; edges.len()];
    let mut stack = vec![from];
    while let Some(s) = stack.pop() {
        if s == to {
            return true;
        }
        if std::mem::replace(&mut seen[s], true) {
            continue;
        }
        stack.extend(edges[s].iter().copied());
    }
    false
}

impl Board {
    /// Check everything: kinds, ids, controls, ports, loops. The error names
    /// what is wrong in words the page can show.
    pub(crate) fn check(&self) -> Result<Checked, BoardError> {
        if self.nodes.len() > MAX_NODES {
            return refuse(format!("a board has at most {MAX_NODES} nodes"));
        }
        if self.cables.len() > MAX_CABLES {
            return refuse(format!("a board has at most {MAX_CABLES} cables"));
        }
        let mut nodes = Vec::with_capacity(self.nodes.len());
        for (i, n) in self.nodes.iter().enumerate() {
            if n.id.is_empty() || n.id.len() > 64 || n.id.contains(':') {
                return refuse(format!("node {i}: an id is 1 to 64 characters, without ':'"));
            }
            if self.nodes[..i].iter().any(|m| m.id == n.id) {
                return refuse(format!("two nodes are called {:?}", n.id));
            }
            let Some(kind) = Kind::parse(&n.kind) else {
                return refuse(format!("node {:?}: unknown kind {:?}", n.id, n.kind));
            };
            if n.sound.as_deref().is_some_and(|s| !s.is_empty()) && !kind.takes_sound() {
                return refuse(format!("node {:?}: {} takes no sound", n.id, n.kind));
            }
            let specs = kind.params();
            let mut vals: Vec<f32> = specs.iter().map(|p| p.default).collect();
            for (k, v) in &n.params {
                let Some(j) = specs.iter().position(|p| p.key == k) else {
                    return refuse(format!("node {:?}: {} has no control {k:?}", n.id, n.kind));
                };
                if !v.is_finite() {
                    return refuse(format!("node {:?}: {k} must be a number", n.id));
                }
                vals[j] = specs[j].clamp(*v);
            }
            let count = kind.structural().map_or(0, |j| vals[j] as usize);
            nodes.push(Resolved { kind, vals, ins: kind.ins(count), outs: kind.outs(count) });
        }
        if nodes.iter().filter(|r| matches!(r.kind, Kind::Out)).count() > 1 {
            return refuse("a board has one out".into());
        }
        let index = |id: &str| self.nodes.iter().position(|n| n.id == id);

        let mut first = Vec::with_capacity(nodes.len());
        let mut total = 0;
        for r in &nodes {
            first.push(total);
            total += r.kind.stages().len();
        }
        let mut edges: Vec<Vec<usize>> = vec![Vec::new(); total];
        let mut cables = Vec::with_capacity(self.cables.len());
        for (c, cable) in self.cables.iter().enumerate() {
            let ((fa, fp), (ta, tp)) = (&cable.from, &cable.to);
            let Some(a) = index(fa) else { return Err(BoardError { message: format!("cable {c}: no node {fa:?}"), cable: Some(c) }) };
            let Some(b) = index(ta) else { return Err(BoardError { message: format!("cable {c}: no node {ta:?}"), cable: Some(c) }) };
            let Some(ap) = nodes[a].outs.iter().position(|p| p == fp) else {
                return Err(BoardError { message: format!("cable {c}: {fa} has no output {fp:?}"), cable: Some(c) });
            };
            let Some(bp) = nodes[b].ins.iter().position(|p| p == tp) else {
                return Err(BoardError { message: format!("cable {c}: {ta} has no input {tp:?}"), cable: Some(c) });
            };
            if let Some(j) = cables.iter().position(|x| *x == [a, ap, b, bp]) {
                return Err(BoardError { message: format!("cable {c} repeats cable {j}"), cable: Some(c) });
            }
            let from = first[a] + nodes[a].kind.stages().iter().position(|s| s.1 >> ap & 1 == 1).unwrap_or(0);
            let into: Vec<usize> = nodes[b]
                .kind
                .stages()
                .iter()
                .enumerate()
                .filter(|(_, s)| s.0 >> bp & 1 == 1)
                .map(|(k, _)| first[b] + k)
                .collect();
            if into.iter().any(|&t| reaches(&edges, t, from)) {
                return Err(BoardError {
                    message: format!("cable {c} ({fa}.{fp} → {ta}.{tp}) would loop {fa} back into itself"),
                    cable: Some(c),
                });
            }
            edges[from].extend(into);
            cables.push([a, ap, b, bp]);
        }

        // Kahn's order, the lowest stage first among those ready, so the same
        // board always runs in the same order.
        let mut waiting = vec![0usize; total];
        for e in edges.iter().flatten() {
            waiting[*e] += 1;
        }
        let mut done = vec![false; total];
        let mut order = Vec::with_capacity(total);
        while let Some(s) = (0..total).find(|&s| !done[s] && waiting[s] == 0) {
            done[s] = true;
            for e in &edges[s] {
                waiting[*e] -= 1;
            }
            let node = first.iter().rposition(|&f| f <= s).unwrap_or(0);
            order.push((node, s - first[node]));
        }
        debug_assert_eq!(order.len(), total, "the loop check let a loop through");
        Ok(Checked { nodes, cables, order })
    }

    /// The board with every control listed, in each kind's order, clamped to
    /// its range: what is stored, so what is read back is complete. An error
    /// is anything [`BoardPlan::compile`] would refuse.
    pub fn complete(&self) -> Result<Board, BoardError> {
        let checked = self.check()?;
        let nodes = self
            .nodes
            .iter()
            .zip(&checked.nodes)
            .map(|(n, r)| Node {
                id: n.id.clone(),
                kind: n.kind.clone(),
                x: if n.x.is_finite() { n.x } else { 0.0 },
                y: if n.y.is_finite() { n.y } else { 0.0 },
                on: n.on,
                params: r.kind.params().iter().zip(&r.vals).map(|(p, v)| (p.key.to_string(), *v)).collect(),
                sound: n.sound.clone().filter(|s| !s.is_empty()),
            })
            .collect();
        Ok(Board { name: self.name.clone(), nodes, cables: self.cables.clone() })
    }

    /// The node with this id, and its position.
    pub fn node(&self, id: &str) -> Option<(usize, &Node)> {
        self.nodes.iter().enumerate().find(|(_, n)| n.id == id)
    }

    /// A number that changes whenever a node is added, removed, renamed,
    /// moved in the list or given another kind: what a compiled mod row's
    /// node and control positions depend on.
    pub fn sig(&self) -> u64 {
        let mut h = 0xcbf2_9ce4_8422_2325u64;
        let mut eat = |b: u8| {
            h ^= b as u64;
            h = h.wrapping_mul(0x0000_0100_0000_01b3);
        };
        for n in &self.nodes {
            n.id.bytes().for_each(&mut eat);
            eat(0);
            n.kind.bytes().for_each(&mut eat);
            eat(1);
        }
        h
    }

    /// The same nodes, kinds, port counts, sounds and cables: the boards
    /// differ at most in their controls, switches, places and name, which
    /// reach a running plan as live writes rather than as a new plan.
    pub fn same_structure(&self, other: &Board) -> bool {
        let count = |n: &Node| match Kind::parse(&n.kind) {
            Some(k) => k.structural().map(|j| {
                let spec = &k.params()[j];
                spec.clamp(n.param(spec.key).unwrap_or(spec.default))
            }),
            None => None,
        };
        self.nodes.len() == other.nodes.len()
            && self.cables == other.cables
            && self.nodes.iter().zip(&other.nodes).all(|(a, b)| a.id == b.id && a.kind == b.kind && count(a) == count(b) && a.sound == b.sound)
    }
}

// ─────────────────────────────────────────────────────────── modulation

/// One mod row onto a board control, compiled.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BoardModRow {
    pub src: Source,
    /// The node's position in the board.
    pub node: u8,
    /// The control's position in its kind.
    pub param: u8,
    pub amt: f32,
    pub curve: Curve,
    pub via: Option<Source>,
}

/// `board:<nodeId>:<key>` → (node id, key).
pub fn parse_dst(dst: &str) -> Option<(&str, &str)> {
    let (node, key) = dst.strip_prefix("board:")?.split_once(':')?;
    (!node.is_empty() && !key.is_empty()).then_some((node, key))
}

/// The patch's board rows, compiled against its board (the migrated one when
/// it has none), and that board's [`Board::sig`].
pub(crate) fn patch_mods(patch: &Patch) -> ([BoardModRow; MAX_MODS], usize, u64) {
    let blank = BoardModRow { src: Source(0), node: 0, param: 0, amt: 0.0, curve: Curve::Lin, via: None };
    let mut rows = [blank; MAX_MODS];
    let mut count = 0;
    let any = patch.mods.iter().any(|m| parse_dst(&m.dst).is_some());
    let migrated;
    let board = match &patch.board {
        Some(b) => b,
        None if any => {
            migrated = Board::migrate(&patch.values);
            &migrated
        }
        None => return (rows, 0, Board::migrate(&patch.values).sig()),
    };
    for m in &patch.mods {
        if count == MAX_MODS {
            break;
        }
        if let Some(row) = board_row(m, board) {
            rows[count] = row;
            count += 1;
        }
    }
    (rows, count, board.sig())
}

fn board_row(m: &Mod, board: &Board) -> Option<BoardModRow> {
    if !m.on {
        return None;
    }
    let (id, key) = parse_dst(&m.dst)?;
    let (node, n) = board.node(id)?;
    let kind = Kind::parse(&n.kind)?;
    let param = kind.params().iter().position(|p| p.key == key)?;
    if kind.structural() == Some(param) || kind.params()[param].inert || param >= 64 {
        return None;
    }
    let src = Source::parse(&m.src)?;
    let curve = Curve::parse(if m.curve.is_empty() { "lin" } else { &m.curve })?;
    let via = match m.via.as_deref() {
        None | Some("") => None,
        Some(v) => Some(Source::parse(v)?),
    };
    m.amt.is_finite().then_some(BoardModRow { src, node: node as u8, param: param as u8, amt: m.amt.clamp(-1.0, 1.0), curve, via })
}

#[cfg(test)]
mod tests;
