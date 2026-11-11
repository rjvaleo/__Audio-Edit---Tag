//! The patch: every key in `docs/WAVE-SYNTH.md`, and the compiled form the
//! audio thread reads.
//!
//! # One flat map, three kinds of value
//!
//! The page stores every control as the value the mock-up uses, under a flat
//! string key. Here that is three tables:
//! - [`KEYS`]: every **numeric** key, its range and how it moves. Its index is
//!   the key's [`ParamId`], which is what `Synth::set_param` takes, so a live
//!   knob move never touches a string on the audio thread.
//! - [`STR_KEYS`]: the modes and names (`osc0.table`, `filt0.type`, …).
//! - [`POINT_KEYS`]: the four LFO shapes.
//!
//! The table is written out in full rather than generated, so `param_id` is a
//! search over static strings that never allocates, and so a reader can see
//! every key the engine knows in one place.
//!
//! # Values are stored as the page stores them
//!
//! Almost everything is 0..1, and the engine maps it to units with the
//! contract's laws (see `voice.rs`). The few that are not (`oscN.uni.n` 1..16,
//! `sub.shape`, `sub.oct`, `noise.color`, `voice.bend` in semitones) are stored
//! as those numbers. [`Patch::set_num`] clamps to the range and rounds the
//! integer ones.
//!
//! # Modulation is in normalised space
//!
//! A row's `amt` is added to the destination's normalised value, the rows for
//! one destination are summed, and the sum is clamped to 0..1 once. For a 0..1
//! key that is the contract's rule exactly; for a key with another range the
//! value is normalised by its range first, so `+0.5` on `oscN.uni.n` is half
//! the way from 1 to 16, and then rounded.
//!
//! # `Patch` and `PatchState`
//!
//! `Patch` is the editable, serialisable thing: strings, vectors, names. It
//! lives on the server's side. `PatchState` is what it compiles to, off the
//! audio thread: enums instead of strings, the mod rows resolved to ids, LFO
//! points in fixed arrays. It holds no heap memory at all, so handing one to
//! the audio thread and dropping the old one there costs nothing.

use crate::warp::WarpMode;

pub use crate::lfo::{lfo_hz, LfoShape};

/// A numeric key's index in [`KEYS`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ParamId(pub u16);

impl ParamId {
    #[inline]
    pub fn index(self) -> usize {
        self.0 as usize
    }
    pub fn key(self) -> &'static str {
        KEYS.get(self.index()).map(|k| k.key).unwrap_or("")
    }
}

/// How a numeric key moves when it is set live.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// Continuous, glided over ~15 ms by `Synth::set_param`.
    Smooth,
    /// Continuous, taken at once (read only when a note starts, or a range).
    Step,
    /// Whole numbers and switches, taken at once.
    Int,
}

#[derive(Clone, Copy, Debug)]
pub struct KeyDef {
    pub key: &'static str,
    pub min: f32,
    pub max: f32,
    pub kind: Kind,
}

const fn k(key: &'static str, min: f32, max: f32, kind: Kind) -> KeyDef {
    KeyDef { key, min, max, kind }
}

use Kind::{Int, Smooth, Step};

/// Every numeric key. The order is the `ParamId` and the constants below.
pub static KEYS: [KeyDef; NUM_PARAMS] = [
    k("osc0.on", 0.0, 1.0, Int),
    k("osc0.pos", 0.0, 1.0, Smooth),
    k("osc0.warp0.amt", 0.0, 1.0, Smooth),
    k("osc0.warp1.amt", 0.0, 1.0, Smooth),
    k("osc0.uni.n", 1.0, 16.0, Int),
    k("osc0.uni.det", 0.0, 1.0, Smooth),
    k("osc0.uni.spr", 0.0, 1.0, Smooth),
    k("osc0.fx.a", 0.0, 1.0, Smooth),
    k("osc0.fx.b", 0.0, 1.0, Smooth),
    k("osc0.pitch", 0.0, 1.0, Smooth),
    k("osc0.fine", 0.0, 1.0, Smooth),
    k("osc0.phase", 0.0, 1.0, Step),
    k("osc0.rand", 0.0, 1.0, Step),
    k("osc0.pan", 0.0, 1.0, Smooth),
    k("osc0.level", 0.0, 1.0, Smooth),
    k("osc1.on", 0.0, 1.0, Int),
    k("osc1.pos", 0.0, 1.0, Smooth),
    k("osc1.warp0.amt", 0.0, 1.0, Smooth),
    k("osc1.warp1.amt", 0.0, 1.0, Smooth),
    k("osc1.uni.n", 1.0, 16.0, Int),
    k("osc1.uni.det", 0.0, 1.0, Smooth),
    k("osc1.uni.spr", 0.0, 1.0, Smooth),
    k("osc1.fx.a", 0.0, 1.0, Smooth),
    k("osc1.fx.b", 0.0, 1.0, Smooth),
    k("osc1.pitch", 0.0, 1.0, Smooth),
    k("osc1.fine", 0.0, 1.0, Smooth),
    k("osc1.phase", 0.0, 1.0, Step),
    k("osc1.rand", 0.0, 1.0, Step),
    k("osc1.pan", 0.0, 1.0, Smooth),
    k("osc1.level", 0.0, 1.0, Smooth),
    k("osc2.on", 0.0, 1.0, Int),
    k("osc2.pos", 0.0, 1.0, Smooth),
    k("osc2.warp0.amt", 0.0, 1.0, Smooth),
    k("osc2.warp1.amt", 0.0, 1.0, Smooth),
    k("osc2.uni.n", 1.0, 16.0, Int),
    k("osc2.uni.det", 0.0, 1.0, Smooth),
    k("osc2.uni.spr", 0.0, 1.0, Smooth),
    k("osc2.fx.a", 0.0, 1.0, Smooth),
    k("osc2.fx.b", 0.0, 1.0, Smooth),
    k("osc2.pitch", 0.0, 1.0, Smooth),
    k("osc2.fine", 0.0, 1.0, Smooth),
    k("osc2.phase", 0.0, 1.0, Step),
    k("osc2.rand", 0.0, 1.0, Step),
    k("osc2.pan", 0.0, 1.0, Smooth),
    k("osc2.level", 0.0, 1.0, Smooth),
    k("sub.on", 0.0, 1.0, Int),
    k("sub.shape", 0.0, 2.0, Int),
    k("sub.oct", 1.0, 2.0, Int),
    k("sub.level", 0.0, 1.0, Smooth),
    k("noise.on", 0.0, 1.0, Int),
    k("noise.color", 0.0, 2.0, Int),
    k("noise.level", 0.0, 1.0, Smooth),
    k("filt0.cut", 0.0, 1.0, Smooth),
    k("filt0.res", 0.0, 1.0, Smooth),
    k("filt0.drive", 0.0, 1.0, Smooth),
    k("filt0.key", 0.0, 1.0, Smooth),
    k("filt1.cut", 0.0, 1.0, Smooth),
    k("filt1.res", 0.0, 1.0, Smooth),
    k("filt1.drive", 0.0, 1.0, Smooth),
    k("filt1.key", 0.0, 1.0, Smooth),
    k("amp.a", 0.0, 1.0, Step),
    k("amp.d", 0.0, 1.0, Step),
    k("amp.s", 0.0, 1.0, Smooth),
    k("amp.r", 0.0, 1.0, Step),
    k("env1.a", 0.0, 1.0, Step),
    k("env1.d", 0.0, 1.0, Step),
    k("env1.s", 0.0, 1.0, Smooth),
    k("env1.r", 0.0, 1.0, Step),
    k("env2.a", 0.0, 1.0, Step),
    k("env2.d", 0.0, 1.0, Step),
    k("env2.s", 0.0, 1.0, Smooth),
    k("env2.r", 0.0, 1.0, Step),
    k("env3.a", 0.0, 1.0, Step),
    k("env3.d", 0.0, 1.0, Step),
    k("env3.s", 0.0, 1.0, Smooth),
    k("env3.r", 0.0, 1.0, Step),
    k("lfo0.rate", 0.0, 1.0, Smooth),
    k("lfo1.rate", 0.0, 1.0, Smooth),
    k("lfo2.rate", 0.0, 1.0, Smooth),
    k("lfo3.rate", 0.0, 1.0, Smooth),
    k("macro0", 0.0, 1.0, Smooth),
    k("macro1", 0.0, 1.0, Smooth),
    k("macro2", 0.0, 1.0, Smooth),
    k("macro3", 0.0, 1.0, Smooth),
    k("macro4", 0.0, 1.0, Smooth),
    k("macro5", 0.0, 1.0, Smooth),
    k("macro6", 0.0, 1.0, Smooth),
    k("macro7", 0.0, 1.0, Smooth),
    k("voice.glide", 0.0, 1.0, Step),
    k("voice.bend", 0.0, 48.0, Step),
    k("master", 0.0, 1.0, Smooth),
    // ── Keys the page added after the contract (7 Nov 2026) ────────────────
    // Appended so every id above keeps its number. Smooth is a one-pole lag on
    // the LFO, up to 200 ms; rise fades it in from the note's start, up to 2 s.
    k("lfo0.smooth", 0.0, 1.0, Smooth),
    k("lfo1.smooth", 0.0, 1.0, Smooth),
    k("lfo2.smooth", 0.0, 1.0, Smooth),
    k("lfo3.smooth", 0.0, 1.0, Smooth),
    k("lfo0.rise", 0.0, 1.0, Step),
    k("lfo1.rise", 0.0, 1.0, Step),
    k("lfo2.rise", 0.0, 1.0, Step),
    k("lfo3.rise", 0.0, 1.0, Step),
    // Stored for the page; the engine does not act on it yet.
    k("voice.mpe", 0.0, 1.0, Int),
    // The FX view's master chain on the synth's output: Drive, Chorus, Delay,
    // Reverb, EQ, each a switch and three settings. Stored; not yet heard.
    k("fx0.on", 0.0, 1.0, Int),
    k("fx0.k0", 0.0, 1.0, Smooth),
    k("fx0.k1", 0.0, 1.0, Smooth),
    k("fx0.k2", 0.0, 1.0, Smooth),
    k("fx1.on", 0.0, 1.0, Int),
    k("fx1.k0", 0.0, 1.0, Smooth),
    k("fx1.k1", 0.0, 1.0, Smooth),
    k("fx1.k2", 0.0, 1.0, Smooth),
    k("fx2.on", 0.0, 1.0, Int),
    k("fx2.k0", 0.0, 1.0, Smooth),
    k("fx2.k1", 0.0, 1.0, Smooth),
    k("fx2.k2", 0.0, 1.0, Smooth),
    k("fx3.on", 0.0, 1.0, Int),
    k("fx3.k0", 0.0, 1.0, Smooth),
    k("fx3.k1", 0.0, 1.0, Smooth),
    k("fx3.k2", 0.0, 1.0, Smooth),
    k("fx4.on", 0.0, 1.0, Int),
    k("fx4.k0", 0.0, 1.0, Smooth),
    k("fx4.k1", 0.0, 1.0, Smooth),
    k("fx4.k2", 0.0, 1.0, Smooth),
    // ── v7 (7 Nov 2026) ────────────────────────────────────────────────────
    // Sync: 0, `lfoL.rate` is Hz; 1, it picks a note length at `tempo`.
    k("lfo0.sync", 0.0, 1.0, Int),
    k("lfo1.sync", 0.0, 1.0, Int),
    k("lfo2.sync", 0.0, 1.0, Int),
    k("lfo3.sync", 0.0, 1.0, Int),
    // The synth's own tempo, for synced LFOs.
    k("tempo", 30.0, 300.0, Step),
];

pub const NUM_PARAMS: usize = 125;
// The matrix marks the keys it touched in one `u128` (`voice::modulate`,
// `Synth::telemetry`), so there may never be more than 128 numeric keys.
const _: () = assert!(NUM_PARAMS <= 128);

// Indices into KEYS. A test pins them to the strings.
pub const OSC_STRIDE: usize = 15;
pub const O_ON: usize = 0;
pub const O_POS: usize = 1;
pub const O_WARP0: usize = 2;
pub const O_WARP1: usize = 3;
pub const O_UNI_N: usize = 4;
pub const O_UNI_DET: usize = 5;
pub const O_UNI_SPR: usize = 6;
pub const O_FX_A: usize = 7;
pub const O_FX_B: usize = 8;
pub const O_PITCH: usize = 9;
pub const O_FINE: usize = 10;
pub const O_PHASE: usize = 11;
pub const O_RAND: usize = 12;
pub const O_PAN: usize = 13;
pub const O_LEVEL: usize = 14;
pub const SUB_ON: usize = 45;
pub const SUB_SHAPE: usize = 46;
pub const SUB_OCT: usize = 47;
pub const SUB_LEVEL: usize = 48;
pub const NOISE_ON: usize = 49;
pub const NOISE_COLOR: usize = 50;
pub const NOISE_LEVEL: usize = 51;
pub const FILT_BASE: usize = 52;
pub const FILT_STRIDE: usize = 4;
pub const F_CUT: usize = 0;
pub const F_RES: usize = 1;
pub const F_DRIVE: usize = 2;
pub const F_KEY: usize = 3;
/// amp.a; ENV 2–4 (`env1..env3`) follow at +4 each.
pub const AMP_BASE: usize = 60;
pub const ENV_BASE: usize = 64;
pub const LFO_RATE: usize = 76;
pub const MACRO_BASE: usize = 80;
pub const GLIDE: usize = 88;
pub const BEND: usize = 89;
pub const MASTER: usize = 90;
pub const LFO_SMOOTH: usize = 91;
pub const LFO_RISE: usize = 95;
pub const VOICE_MPE: usize = 99;
/// The master chain: `fxI.on` at `FX_BASE + I·4`, `fxI.kJ` after it.
pub const FX_BASE: usize = 100;
pub const FX_STRIDE: usize = 4;
pub const LFO_SYNC: usize = 120;
pub const TEMPO: usize = 124;
/// The FX view's chain, in its order: Drive, Chorus, Delay, Reverb, EQ.
/// The mock-up starts with all five on at settings that make the default
/// patch loud and muddy once they are heard, so the default is lighter:
/// Drive off (its knobs where the mock-up has them), a little chorus, a
/// quiet delay and a small room, and the EQ flat.
pub const FX_ON_DEFAULTS: [f32; 5] = [0.0, 1.0, 1.0, 1.0, 1.0];
pub const FX_DEFAULTS: [[f32; 3]; 5] =
    [[0.45, 0.3, 0.7], [0.35, 0.5, 0.25], [0.4, 0.35, 0.15], [0.45, 0.45, 0.2], [0.5, 0.5, 0.5]];

#[inline]
pub const fn osc_key(osc: usize, field: usize) -> usize {
    osc * OSC_STRIDE + field
}

/// The id of a numeric key. Never allocates; usable on any thread.
pub fn param_id(key: &str) -> Option<ParamId> {
    KEYS.iter().position(|k| k.key == key).map(|i| ParamId(i as u16))
}

/// Normalise a value by its key's range.
#[inline]
pub fn normalise(id: usize, v: f32) -> f32 {
    let d = &KEYS[id];
    if d.max > d.min {
        (v - d.min) / (d.max - d.min)
    } else {
        0.0
    }
}

/// Back from 0..1 to the key's own units, rounding the integer ones.
#[inline]
pub fn denormalise(id: usize, n: f32) -> f32 {
    let d = &KEYS[id];
    let v = d.min + n.clamp(0.0, 1.0) * (d.max - d.min);
    if d.kind == Int {
        v.round()
    } else {
        v
    }
}

/// Clamp (and round) a value into its key's range. `None` if not finite.
pub fn clamp_value(id: usize, v: f32) -> Option<f32> {
    if !v.is_finite() {
        return None;
    }
    let d = &KEYS[id];
    let v = v.clamp(d.min, d.max);
    Some(if d.kind == Int { v.round() } else { v })
}

/// Every string key.
pub static STR_KEYS: [&str; 27] = [
    "osc0.table",
    "osc0.warp0.mode",
    "osc0.warp1.mode",
    "osc0.fx.mode",
    "osc0.route",
    "osc1.table",
    "osc1.warp0.mode",
    "osc1.warp1.mode",
    "osc1.fx.mode",
    "osc1.route",
    "osc2.table",
    "osc2.warp0.mode",
    "osc2.warp1.mode",
    "osc2.fx.mode",
    "osc2.route",
    "filt0.type",
    "filt1.type",
    "filt.route",
    "lfo0.mode",
    "lfo1.mode",
    "lfo2.mode",
    "lfo3.mode",
    "voice.mode",
    "lfo0.shape",
    "lfo1.shape",
    "lfo2.shape",
    "lfo3.shape",
];

/// The LFO shape keys.
pub static POINT_KEYS: [&str; 4] = ["lfo0.points", "lfo1.points", "lfo2.points", "lfo3.points"];

/// Most points an LFO shape may have.
pub const MAX_LFO_POINTS: usize = 64;
/// Most mod rows a patch may have (the matrix's 64).
pub const MAX_MODS: usize = 64;

macro_rules! named_enum {
    ($(#[$m:meta])* $name:ident { $($var:ident = $s:literal),* $(,)? }) => {
        $(#[$m])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
        pub enum $name { #[default] $($var),* }
        impl $name {
            pub const ALL: &'static [$name] = &[$($name::$var),*];
            pub fn parse(s: &str) -> Option<$name> {
                match s { $($s => Some($name::$var),)* _ => None }
            }
            pub fn as_str(self) -> &'static str {
                match self { $($name::$var => $s),* }
            }
        }
    };
}

named_enum!(
    /// A per-oscillator effect (`oscN.fx.mode`).
    FxMode { Off = "off", Chorus = "chorus", Crush = "crush", Drive = "drive", Delay = "delay", Phaser = "phaser", Ring = "ring", Comb = "comb" }
);
named_enum!(
    /// Where an oscillator goes (`oscN.route`).
    Route { F1 = "F1", F2 = "F2", Both = "both", Direct = "direct" }
);
named_enum!(
    /// A filter's model (`filtK.type`).
    FilterType { Lp = "lp", Bp = "bp", Hp = "hp", Notch = "notch", Comb = "comb", Form = "form" }
);
named_enum!(
    /// How the two filters are wired (`filt.route`).
    FilterRoute { Serial = "serial", Parallel = "parallel", Split = "split" }
);
named_enum!(
    /// `lfoL.mode`.
    LfoMode { Free = "free", Trig = "trig", Env = "env" }
);
named_enum!(
    /// `lfoL.shape`: a standard wave, or `drawn` for `lfoL.points`.
    LfoWave {
        Sine = "sine",
        Tri = "tri",
        Up = "up",
        Down = "down",
        Square = "square",
        Steps = "steps",
        Smooth = "smooth",
        Drawn = "drawn",
    }
);
named_enum!(
    /// `voice.mode`.
    VoiceMode { Poly = "poly", Mono = "mono", Legato = "legato" }
);
named_enum!(
    /// A mod row's response curve: the matrix's `curveAt`.
    Curve { Lin = "lin", Exp = "exp", Log = "log", S = "s" }
);

impl Curve {
    /// The mock-up's `curveAt` on 0..1. A bipolar source goes through it by
    /// magnitude and keeps its sign, so an LFO is shaped the same both ways.
    #[inline]
    pub fn apply(self, x: f32) -> f32 {
        let (s, a) = if x < 0.0 { (-1.0, -x) } else { (1.0, x) };
        let y = match self {
            Curve::Lin => a,
            Curve::Exp => a * a * a,
            Curve::Log => {
                let r = 1.0 - a;
                1.0 - r * r * r
            }
            Curve::S => a * a * (3.0 - 2.0 * a),
        };
        s * y
    }
}

/// A modulation source, as an index into a voice's source values.
///
/// `env1..env3` (ENV 2–4), `lfo0..lfo3`, `macro0..macro7`, `vel`, `note`,
/// `mw`, `at`, `rand`. LFOs are −1..1; everything else 0..1. `note` is the MIDI
/// note over 127; `rand` is drawn once per note.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Source(pub u8);

pub const SRC_COUNT: usize = 20;
pub const SRC_ENV: usize = 0;
pub const SRC_LFO: usize = 3;
pub const SRC_MACRO: usize = 7;
pub const SRC_VEL: usize = 15;
pub const SRC_NOTE: usize = 16;
pub const SRC_MW: usize = 17;
pub const SRC_AT: usize = 18;
pub const SRC_RAND: usize = 19;

static SRC_NAMES: [&str; SRC_COUNT] = [
    "env1", "env2", "env3", "lfo0", "lfo1", "lfo2", "lfo3", "macro0", "macro1", "macro2", "macro3", "macro4", "macro5",
    "macro6", "macro7", "vel", "note", "mw", "at", "rand",
];

impl Source {
    pub fn parse(s: &str) -> Option<Source> {
        SRC_NAMES.iter().position(|n| *n == s).map(|i| Source(i as u8))
    }
    pub fn as_str(self) -> &'static str {
        SRC_NAMES.get(self.0 as usize).copied().unwrap_or("")
    }
    #[inline]
    pub fn index(self) -> usize {
        self.0 as usize
    }
    /// Whether the source is the same for every voice.
    pub fn is_global(self) -> bool {
        let i = self.index();
        (SRC_MACRO..SRC_MACRO + 8).contains(&i) || i == SRC_MW || i == SRC_AT
    }
}

/// One row of the matrix, as the page sends it.
#[derive(Clone, Debug, PartialEq)]
pub struct Mod {
    pub src: String,
    pub dst: String,
    pub amt: f32,
    pub curve: String,
    pub via: Option<String>,
    /// A row switched off (v8b) is kept, saved and listed, and moves nothing.
    pub on: bool,
}

impl Mod {
    pub fn new(src: &str, dst: &str, amt: f32) -> Mod {
        Mod { src: src.into(), dst: dst.into(), amt, curve: "lin".into(), via: None, on: true }
    }
    pub fn switched(mut self, on: bool) -> Mod {
        self.on = on;
        self
    }
    pub fn with_curve(mut self, curve: &str) -> Mod {
        self.curve = curve.into();
        self
    }
    pub fn with_via(mut self, via: &str) -> Mod {
        self.via = Some(via.into());
        self
    }
}

/// A value from [`Patch::entries`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Value<'a> {
    Num(f32),
    Str(&'a str),
    Points(&'a [(f32, f32)]),
}

/// The whole editable patch.
#[derive(Clone, Debug, PartialEq)]
pub struct Patch {
    pub values: [f32; NUM_PARAMS],
    pub tables: [String; 3],
    pub warp_modes: [[WarpMode; 2]; 3],
    pub fx_modes: [FxMode; 3],
    pub routes: [Route; 3],
    pub filter_types: [FilterType; 2],
    pub filter_route: FilterRoute,
    pub lfo_modes: [LfoMode; 4],
    pub lfo_waves: [LfoWave; 4],
    pub lfo_points: [Vec<(f32, f32)>; 4],
    pub voice_mode: VoiceMode,
    pub mods: Vec<Mod>,
    pub macro_names: [String; 8],
    pub name: String,
    pub tags: Vec<String>,
    /// The FX view's board (v8). `None` is an old patch: its board is the one
    /// [`Board::migrate`](crate::board::Board::migrate) makes from its `fx*` keys.
    pub board: Option<crate::board::Board>,
}

impl Default for Patch {
    /// The mock-up's starting state (`S` in wave-synth-v6.html).
    fn default() -> Self {
        let mut v = [0.0f32; NUM_PARAMS];
        let osc = |n: usize, f: usize| osc_key(n, f);
        for n in 0..3 {
            v[osc(n, O_ON)] = [1.0, 1.0, 0.0][n];
            v[osc(n, O_POS)] = [0.34, 0.2, 0.6][n];
            v[osc(n, O_WARP0)] = [0.3, 0.15, 0.2][n];
            v[osc(n, O_WARP1)] = [0.0, 0.25, 0.0][n];
            v[osc(n, O_UNI_N)] = [5.0, 3.0, 1.0][n];
            v[osc(n, O_UNI_DET)] = [0.35, 0.2, 0.0][n];
            v[osc(n, O_UNI_SPR)] = [0.7, 0.5, 0.0][n];
            v[osc(n, O_FX_A)] = [0.45, 0.75, 0.35][n];
            v[osc(n, O_FX_B)] = [0.4, 0.6, 0.5][n];
            v[osc(n, O_PITCH)] = [0.5, 0.5 + 12.0 / 48.0, 0.5][n];
            v[osc(n, O_FINE)] = 0.5;
            v[osc(n, O_PHASE)] = 0.0;
            v[osc(n, O_RAND)] = 0.25;
            v[osc(n, O_PAN)] = 0.5;
            v[osc(n, O_LEVEL)] = [0.82, 0.6, 0.4][n];
        }
        v[SUB_ON] = 1.0;
        // A triangle carries on small speakers where a sine all but vanishes.
        v[SUB_SHAPE] = 1.0;
        v[SUB_OCT] = 1.0;
        v[SUB_LEVEL] = 0.28;
        v[NOISE_ON] = 0.0;
        v[NOISE_COLOR] = 1.0;
        v[NOISE_LEVEL] = 0.12;
        for (f, vals) in [[0.55, 0.35, 0.2, 0.5], [0.7, 0.5, 0.0, 0.3]].iter().enumerate() {
            for (j, x) in vals.iter().enumerate() {
                v[FILT_BASE + f * FILT_STRIDE + j] = *x;
            }
        }
        let envs = [[0.06, 0.3, 0.6, 0.45], [0.15, 0.4, 0.3, 0.5], [0.02, 0.2, 0.0, 0.2], [0.4, 0.5, 0.7, 0.7]];
        for (e, vals) in envs.iter().enumerate() {
            for (j, x) in vals.iter().enumerate() {
                v[AMP_BASE + e * 4 + j] = *x;
            }
        }
        // 0.49, 0.20, 1.3 and 0.13 Hz on the v7 rate law.
        for (l, r) in [0.42, 0.3, 0.55, 0.25].iter().enumerate() {
            v[LFO_RATE + l] = *r;
        }
        for (m, x) in [0.5, 0.35, 0.6, 0.2, 0.4, 0.5, 0.3, 0.25].iter().enumerate() {
            v[MACRO_BASE + m] = *x;
        }
        v[GLIDE] = 0.2;
        v[BEND] = 2.0;
        v[MASTER] = 0.8;
        v[TEMPO] = 120.0;
        for (i, ks) in FX_DEFAULTS.iter().enumerate() {
            v[FX_BASE + i * FX_STRIDE] = FX_ON_DEFAULTS[i];
            for (j, x) in ks.iter().enumerate() {
                v[FX_BASE + i * FX_STRIDE + 1 + j] = *x;
            }
        }

        let pts = |p: &[(f32, f32)]| p.to_vec();
        Patch {
            values: v,
            tables: ["Formant Sweep".into(), "Vowel Ah–Oo".into(), "Glass Organ".into()],
            warp_modes: [
                [WarpMode::Bend, WarpMode::Off],
                [WarpMode::Sync, WarpMode::Fm],
                [WarpMode::Fold, WarpMode::Off],
            ],
            fx_modes: [FxMode::Chorus, FxMode::Crush, FxMode::Delay],
            routes: [Route::F1, Route::F1, Route::F2],
            filter_types: [FilterType::Lp, FilterType::Bp],
            filter_route: FilterRoute::Parallel,
            lfo_modes: [LfoMode::Free; 4],
            lfo_waves: [LfoWave::Sine, LfoWave::Drawn, LfoWave::Square, LfoWave::Smooth],
            lfo_points: [
                pts(&[(0.0, 0.5), (0.25, 1.0), (0.5, 0.5), (0.75, 0.0), (1.0, 0.5)]),
                pts(&[(0.0, 0.0), (0.1, 1.0), (0.5, 0.4), (1.0, 0.0)]),
                pts(&[(0.0, 1.0), (0.5, 1.0), (0.5, 0.0), (1.0, 0.0)]),
                pts(&[(0.0, 0.5), (0.2, 0.9), (0.4, 0.2), (0.6, 0.7), (0.8, 0.1), (1.0, 0.5)]),
            ],
            voice_mode: VoiceMode::Poly,
            // Init moves nothing: every routing is one the player made.
            mods: Vec::new(),
            macro_names: ["Brightness", "Movement", "Width", "Grit", "Space", "Morph", "Attack", "Air"]
                .map(String::from),
            name: "Init".into(),
            tags: Vec::new(),
            board: None,
        }
    }
}

/// `oscN.<rest>` → (N, rest).
fn split_osc(key: &str) -> Option<(usize, &str)> {
    let rest = key.strip_prefix("osc")?;
    let b = rest.as_bytes();
    if b.len() < 3 || b[1] != b'.' {
        return None;
    }
    let n = b[0].checked_sub(b'0')? as usize;
    if n > 2 {
        return None;
    }
    Some((n, &rest[2..]))
}

impl Patch {
    /// Set a numeric key, clamped (and rounded, for whole-number keys).
    /// False for an unknown key or a value that is not a number.
    pub fn set_num(&mut self, key: &str, v: f32) -> bool {
        let Some(id) = param_id(key) else { return false };
        let Some(v) = clamp_value(id.index(), v) else { return false };
        self.values[id.index()] = v;
        true
    }

    pub fn get_num(&self, key: &str) -> Option<f32> {
        param_id(key).map(|id| self.values[id.index()])
    }

    /// Set a string key. False for an unknown key or a value the key does not
    /// take. Table names are not checked: the server owns the table list.
    pub fn set_str(&mut self, key: &str, value: &str) -> bool {
        if let Some((n, rest)) = split_osc(key) {
            return match rest {
                "table" => {
                    self.tables[n] = value.to_string();
                    true
                }
                "warp0.mode" | "warp1.mode" => {
                    let j = (rest.as_bytes()[4] - b'0') as usize;
                    WarpMode::parse(value).map(|m| self.warp_modes[n][j] = m).is_some()
                }
                "fx.mode" => FxMode::parse(value).map(|m| self.fx_modes[n] = m).is_some(),
                "route" => Route::parse(value).map(|m| self.routes[n] = m).is_some(),
                _ => false,
            };
        }
        match key {
            "filt0.type" | "filt1.type" => {
                let f = (key.as_bytes()[4] - b'0') as usize;
                FilterType::parse(value).map(|m| self.filter_types[f] = m).is_some()
            }
            "filt.route" => FilterRoute::parse(value).map(|m| self.filter_route = m).is_some(),
            "voice.mode" => VoiceMode::parse(value).map(|m| self.voice_mode = m).is_some(),
            _ => match (lfo_index(key, ".mode"), lfo_index(key, ".shape")) {
                (Some(l), _) => LfoMode::parse(value).map(|m| self.lfo_modes[l] = m).is_some(),
                (_, Some(l)) => LfoWave::parse(value).map(|w| self.lfo_waves[l] = w).is_some(),
                _ => false,
            },
        }
    }

    pub fn get_str(&self, key: &str) -> Option<&str> {
        if let Some((n, rest)) = split_osc(key) {
            return match rest {
                "table" => Some(self.tables[n].as_str()),
                "warp0.mode" => Some(self.warp_modes[n][0].as_str()),
                "warp1.mode" => Some(self.warp_modes[n][1].as_str()),
                "fx.mode" => Some(self.fx_modes[n].as_str()),
                "route" => Some(self.routes[n].as_str()),
                _ => None,
            };
        }
        match key {
            "filt0.type" => Some(self.filter_types[0].as_str()),
            "filt1.type" => Some(self.filter_types[1].as_str()),
            "filt.route" => Some(self.filter_route.as_str()),
            "voice.mode" => Some(self.voice_mode.as_str()),
            _ => lfo_index(key, ".mode")
                .map(|l| self.lfo_modes[l].as_str())
                .or_else(|| lfo_index(key, ".shape").map(|l| self.lfo_waves[l].as_str())),
        }
    }

    /// Set an LFO's shape. Points are clamped to 0..1 and sorted by x, and the
    /// ends are pinned to x = 0 and x = 1 as the contract requires. False for
    /// an unknown key, fewer than two points, more than [`MAX_LFO_POINTS`], or
    /// a value that is not a number.
    pub fn set_points(&mut self, key: &str, points: &[(f32, f32)]) -> bool {
        let Some(l) = lfo_index(key, ".points") else { return false };
        if points.len() < 2 || points.len() > MAX_LFO_POINTS {
            return false;
        }
        if points.iter().any(|(x, y)| !x.is_finite() || !y.is_finite()) {
            return false;
        }
        let mut p: Vec<(f32, f32)> = points.iter().map(|(x, y)| (x.clamp(0.0, 1.0), y.clamp(0.0, 1.0))).collect();
        p.sort_by(|a, b| a.0.total_cmp(&b.0));
        p[0].0 = 0.0;
        let last = p.len() - 1;
        p[last].0 = 1.0;
        self.lfo_points[l] = p;
        true
    }

    pub fn get_points(&self, key: &str) -> Option<&[(f32, f32)]> {
        lfo_index(key, ".points").map(|l| self.lfo_points[l].as_slice())
    }

    /// Every key and its value: numeric keys in [`KEYS`] order, then the
    /// string keys, then the LFO shapes. For the server to serialise.
    pub fn entries(&self) -> impl Iterator<Item = (&'static str, Value<'_>)> + '_ {
        let nums = KEYS.iter().enumerate().map(move |(i, k)| (k.key, Value::Num(self.values[i])));
        let strs = STR_KEYS.iter().map(move |k| (*k, Value::Str(self.get_str(k).unwrap_or(""))));
        let pts = POINT_KEYS.iter().enumerate().map(move |(l, k)| (*k, Value::Points(self.lfo_points[l].as_slice())));
        nums.chain(strs).chain(pts)
    }
}

fn lfo_index(key: &str, suffix: &str) -> Option<usize> {
    let rest = key.strip_prefix("lfo")?.strip_suffix(suffix)?;
    match rest {
        "0" => Some(0),
        "1" => Some(1),
        "2" => Some(2),
        "3" => Some(3),
        _ => None,
    }
}

/// One compiled mod row.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ModRow {
    pub src: Source,
    pub dst: ParamId,
    pub amt: f32,
    pub curve: Curve,
    pub via: Option<Source>,
}

/// A patch compiled for the audio thread. Plain data; no heap.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PatchState {
    pub values: [f32; NUM_PARAMS],
    pub warp_modes: [[WarpMode; 2]; 3],
    pub fx_modes: [FxMode; 3],
    pub routes: [Route; 3],
    pub filter_types: [FilterType; 2],
    pub filter_route: FilterRoute,
    pub lfo_modes: [LfoMode; 4],
    pub lfo_shapes: [LfoShape; 4],
    pub voice_mode: VoiceMode,
    pub mods: [ModRow; MAX_MODS],
    pub mod_count: usize,
    /// The rows onto board controls (`board:<node>:<key>`), compiled against
    /// the patch's board, whose [`Board::sig`](crate::board::Board::sig) is
    /// `board_sig`: a plan from another board ignores them.
    pub board_mods: [crate::board::BoardModRow; MAX_MODS],
    pub board_mod_count: usize,
    pub board_sig: u64,
    /// The rows onto choice keys, and every choice's options (`choice.rs`).
    pub choices: crate::choice::Choices,
}

impl PatchState {
    /// Compile a patch. Mod rows switched off, or naming an unknown source,
    /// destination, curve or via, are skipped, as are rows past
    /// [`MAX_MODS`]; the rest keep their order.
    pub fn new(patch: &Patch) -> PatchState {
        let blank = ModRow { src: Source(0), dst: ParamId(0), amt: 0.0, curve: Curve::Lin, via: None };
        let mut mods = [blank; MAX_MODS];
        let mut mod_count = 0;
        for m in patch.mods.iter().filter(|m| m.on) {
            if mod_count == MAX_MODS {
                break;
            }
            let (Some(src), Some(dst)) = (Source::parse(&m.src), param_id(&m.dst)) else { continue };
            let Some(curve) = Curve::parse(if m.curve.is_empty() { "lin" } else { &m.curve }) else { continue };
            let via = match m.via.as_deref() {
                None | Some("") => None,
                Some(v) => match Source::parse(v) {
                    Some(s) => Some(s),
                    None => continue,
                },
            };
            if !m.amt.is_finite() {
                continue;
            }
            mods[mod_count] = ModRow { src, dst, amt: m.amt.clamp(-1.0, 1.0), curve, via };
            mod_count += 1;
        }
        let (board_mods, board_mod_count, board_sig) = crate::board::patch_mods(patch);
        let mut values = patch.values;
        for (i, v) in values.iter_mut().enumerate() {
            *v = clamp_value(i, *v).unwrap_or(KEYS[i].min);
        }
        PatchState {
            values,
            warp_modes: patch.warp_modes,
            fx_modes: patch.fx_modes,
            routes: patch.routes,
            filter_types: patch.filter_types,
            filter_route: patch.filter_route,
            lfo_modes: patch.lfo_modes,
            lfo_shapes: [0, 1, 2, 3].map(|l| {
                LfoShape::from_points(&patch.lfo_points[l]).with_wave(patch.lfo_waves[l], (l as u32 + 1).wrapping_mul(0x2545_F491))
            }),
            voice_mode: patch.voice_mode,
            mods,
            mod_count,
            board_mods,
            board_mod_count,
            board_sig,
            choices: crate::choice::Choices::new(patch),
        }
    }

    pub fn mods(&self) -> &[ModRow] {
        &self.mods[..self.mod_count]
    }

    pub fn board_mods(&self) -> &[crate::board::BoardModRow] {
        &self.board_mods[..self.board_mod_count]
    }
}

impl Default for PatchState {
    fn default() -> Self {
        PatchState::new(&Patch::default())
    }
}

#[cfg(test)]
mod tests;
