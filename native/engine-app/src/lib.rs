//! The app's side of the native app: what is on the canvas, and everything
//! done for it off the audio thread that is more than a knob.
//!
//! A [`Session`] holds the canvas: its modules, where each sits, their
//! cables, and each module's own state (Wave's patch, say). It drives the
//! engine's [`Controller`]: it adds the engine modules a canvas module is
//! made of, cables them, sends knobs and notes, and builds and hands over
//! what a module needs (a compiled patch, a table, a board). It saves the
//! canvas to one JSON file and loads it back.
//!
//! Nothing here runs on the audio thread. The audio half is the
//! [`AudioEngine`] that [`Session::new`] hands back beside it.
//!
//! A canvas module may be several engine modules: Output is a mixer into
//! MGL's ceiling. Canvas module `n`'s engine modules are numbered `n * 16`
//! and up.
//!
//! Each kind of module lists its controls ([`controls`]); the app builds a
//! face from that list. Control `i` of a module is set with
//! [`Session::set`]: a knob or a switch by its value, a choice by the
//! number of its option.

pub mod annot;
pub mod atmos_part;
pub mod edit_part;
mod mgl_rack;
pub mod sound_part;
mod sound_link;
pub mod wave_patch;
mod wave_part;
// MGL's /api/wave routes, answered for a Wave on the canvas.
pub mod wave_api;

use engine_core::{engine, port, AudioEngine, Config, Controller, EventKind, Kind, ModuleId, NoteEvent, NoteKind, PatchError};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

pub use atmos_part::{fx_kinds_json, AtmosPart};
pub use edit_part::EditPart;
pub use sound_part::SoundPart;
pub use wave_part::{frames_256, frames_for, read_table_wav, set_table_dirs, table_names, WavePart};
use wave_part::Tables;

/// What the patch file says it is.
pub const FORMAT: &str = "idmlab-patch";
pub const VERSION: u64 = 1;

/// One kind of module the canvas can hold.
pub struct KindInfo {
    /// Its name in a patch file and in the C interface.
    pub id: &'static str,
    /// Its title on the canvas.
    pub title: &'static str,
    /// Its face, in pixels. Fixed: it never grows or shrinks.
    pub width: u32,
    pub height: u32,
    /// Its sockets, in order: what plugs in, and what comes out.
    pub ins: &'static [(&'static str, Kind)],
    pub outs: &'static [(&'static str, Kind)],
    /// Whether its face carries a keyboard.
    pub keyboard: bool,
}

/// The Sound module's face, and the Edit page's (`edit_part.rs`).
pub const SOUND_W: u32 = 320;
pub const SOUND_H: u32 = 132;
pub const EDIT_W: u32 = 1500;
pub const EDIT_H: u32 = 1100;

/// Atmosphere's face's height, in pixels.
pub const ATMOS_HEIGHT: u32 = 998;

/// Every kind there is, in the order the app offers them.
pub static KINDS: &[KindInfo] = &[
    KindInfo {
        id: "wave",
        title: "Wave",
        // MGL's Wave page at its own size: the face inside idMLab's frame.
        width: 1900,
        height: 1052,
        ins: &[("Notes", Kind::Notes)],
        outs: &[("Audio", Kind::Audio)],
        keyboard: true,
    },
    KindInfo {
        id: "atmos",
        title: "Atmosphere",
        // MGL's Atmosphere page at its own size: the face inside idMLab's frame.
        width: 1500,
        height: ATMOS_HEIGHT,
        ins: &[("Notes", Kind::Notes)],
        outs: &[("Audio", Kind::Audio)],
        keyboard: true,
    },
    // MGL's sound document: a file from disk or the library, and its edits.
    KindInfo { id: "sound", title: "Sound", width: SOUND_W, height: SOUND_H, ins: &[], outs: &[("Sound", Kind::Sound)], keyboard: false },
    KindInfo {
        id: "edit",
        title: "Edit",
        // MGL's Edit page as RJ uses it (a 1668 x 1100 window, the rail 168
        // wide): the page and the Now Playing bar under it.
        width: EDIT_W,
        height: EDIT_H,
        ins: &[("Sound", Kind::Sound)],
        outs: &[("Audio", Kind::Audio)],
        keyboard: false,
    },
    KindInfo { id: "midi-in", title: "MIDI In", width: 246, height: 73, ins: &[], outs: &[("Notes", Kind::Notes)], keyboard: false },
    KindInfo {
        id: "output",
        title: "Audio Output",
        width: 246,
        height: 73,
        ins: &[("Audio", Kind::Audio), ("Audio 2", Kind::Audio), ("Audio 3", Kind::Audio), ("Audio 4", Kind::Audio)],
        outs: &[],
        keyboard: false,
    },
];

pub fn kind(id: &str) -> Option<&'static KindInfo> {
    KINDS.iter().find(|k| k.id == id)
}

/// One control on a module's face.
#[derive(Clone, Debug, PartialEq)]
pub enum Control {
    /// A knob from `min` to `max`; `step` 0 is smooth, 1 whole numbers.
    Knob { key: String, min: f32, max: f32, step: f32, default: f32 },
    /// On (1) or off (0).
    Switch { key: String, default: f32 },
    /// One of a list; the value is the option's number.
    Choice { key: String, options: Vec<String>, default: usize },
}

impl Control {
    pub fn key(&self) -> &str {
        match self {
            Control::Knob { key, .. } | Control::Switch { key, .. } | Control::Choice { key, .. } => key,
        }
    }
}

/// The MIDI channels a MIDI in listens to: 0 every channel, 1 to 16 one.
fn channel_options() -> Vec<String> {
    std::iter::once("Any channel".to_string()).chain((1..=16).map(|c| format!("Channel {c}"))).collect()
}

/// A kind's controls, in the order the face shows them and [`Session::set`]
/// numbers them.
pub fn controls(kind: &str) -> Vec<Control> {
    match kind {
        "wave" => wave_part::controls(),
        "midi-in" => vec![Control::Choice { key: "channel".into(), options: channel_options(), default: 0 }],
        _ => Vec::new(),
    }
}

pub fn kinds_json() -> Value {
    let sockets = |s: &[(&str, Kind)]| {
        Value::Array(
            s.iter()
                .map(|(name, kind)| {
                    let mut o = Map::new();
                    o.insert("name".into(), (*name).into());
                    o.insert("type".into(), kind_name(*kind).into());
                    Value::Object(o)
                })
                .collect(),
        )
    };
    Value::Array(
        KINDS
            .iter()
            .map(|k| {
                let mut o = Map::new();
                o.insert("id".into(), k.id.into());
                o.insert("title".into(), k.title.into());
                o.insert("width".into(), k.width.into());
                o.insert("height".into(), k.height.into());
                o.insert("ins".into(), sockets(k.ins));
                o.insert("outs".into(), sockets(k.outs));
                o.insert("keyboard".into(), k.keyboard.into());
                Value::Object(o)
            })
            .collect(),
    )
}

pub fn controls_json(kind: &str) -> Value {
    Value::Array(
        controls(kind)
            .into_iter()
            .map(|c| {
                let mut o = Map::new();
                match c {
                    Control::Knob { key, min, max, step, default } => {
                        o.insert("type".into(), "knob".into());
                        o.insert("key".into(), key.into());
                        o.insert("min".into(), wave_patch::num(min));
                        o.insert("max".into(), wave_patch::num(max));
                        o.insert("step".into(), wave_patch::num(step));
                        o.insert("default".into(), wave_patch::num(default));
                    }
                    Control::Switch { key, default } => {
                        o.insert("type".into(), "switch".into());
                        o.insert("key".into(), key.into());
                        o.insert("default".into(), wave_patch::num(default));
                    }
                    Control::Choice { key, options, default } => {
                        o.insert("type".into(), "choice".into());
                        o.insert("key".into(), key.into());
                        o.insert("options".into(), Value::Array(options.into_iter().map(Value::String).collect()));
                        o.insert("default".into(), default.into());
                    }
                }
                Value::Object(o)
            })
            .collect(),
    )
}

fn kind_name(kind: Kind) -> &'static str {
    match kind {
        Kind::Audio => "audio",
        Kind::Notes => "notes",
        Kind::Control => "control",
        Kind::Clock => "clock",
        Kind::Sound => "sound",
    }
}

/// Why something was refused. The C interface turns each into a code.
#[derive(Debug, PartialEq)]
pub enum AppError {
    /// The engine refused it.
    Engine(PatchError),
    NoSuchModule(u32),
    NoSuchKind(String),
    NoSuchSocket,
    NoSuchControl(u32),
    /// A socket of one type cabled to another.
    KindsDiffer,
    /// An input already has its cable.
    Taken,
    /// A patch file that could not be read, and why.
    BadFile(String),
}

impl From<PatchError> for AppError {
    fn from(e: PatchError) -> AppError {
        AppError::Engine(e)
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Engine(e) => write!(f, "the engine refused it: {e:?}"),
            AppError::NoSuchModule(id) => write!(f, "no module {id}"),
            AppError::NoSuchKind(k) => write!(f, "no kind of module called {k:?}"),
            AppError::NoSuchSocket => write!(f, "no such socket"),
            AppError::NoSuchControl(i) => write!(f, "no control {i}"),
            AppError::KindsDiffer => write!(f, "those sockets take different things"),
            AppError::Taken => write!(f, "that input already has a cable"),
            AppError::BadFile(why) => write!(f, "{why}"),
        }
    }
}

/// A canvas module's own state.
enum Part {
    Wave(Box<WavePart>),
    Atmos(Box<AtmosPart>),
    /// Which channel it listens to: 0 all, 1 to 16 one.
    MidiIn { channel: u8 },
    Output,
    Sound(Box<SoundPart>),
    Edit(Box<EditPart>),
}

struct Placed {
    kind: &'static KindInfo,
    x: f32,
    y: f32,
    part: Part,
}

/// A cable on the canvas: (module, socket) to (module, socket).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Wire {
    pub from: (u32, u32),
    pub to: (u32, u32),
}

/// The canvas and the engine's app half.
pub struct Session {
    ctl: Controller,
    rate: f32,
    modules: BTreeMap<u32, Placed>,
    wires: Vec<Wire>,
    next: u32,
    /// The app's own view of the canvas (zoom, scroll), kept as it gave it.
    view: Value,
    tables: Tables,
    max_block: usize,
    /// Where Wave's presets go and MGL's are read (`wave_api`).
    wave_dirs: wave_api::WaveDirs,
}

/// Canvas module `id`'s `k`th engine module.
fn engine_id(id: u32, k: u32) -> ModuleId {
    id * 16 + k
}

impl Session {
    /// A new, empty canvas, and the audio half for the sound card's thread.
    pub fn new(rate: f32, max_block: usize) -> (Session, AudioEngine) {
        Session::with_config(rate, Config { max_block: max_block.max(1), ..Config::default() })
    }

    pub fn with_config(rate: f32, config: Config) -> (Session, AudioEngine) {
        let max_block = config.max_block.max(1);
        let (ctl, audio) = engine(rate, config);
        let session = Session {
            ctl,
            rate,
            modules: BTreeMap::new(),
            wires: Vec::new(),
            next: 1,
            view: Value::Null,
            tables: Tables::new(),
            max_block,
            wave_dirs: wave_api::WaveDirs::default(),
        };
        (session, audio)
    }

    pub fn rate(&self) -> f32 {
        self.rate
    }

    pub fn controller(&mut self) -> &mut Controller {
        &mut self.ctl
    }

    /// Put a module of `kind` on the canvas at (`x`, `y`). Returns its number.
    pub fn add(&mut self, kind: &str, x: f32, y: f32) -> Result<u32, AppError> {
        let id = self.next;
        self.add_as(id, kind, x, y, None)?;
        Ok(id)
    }

    fn add_as(&mut self, id: u32, kind_id: &str, x: f32, y: f32, saved: Option<&Value>) -> Result<(), AppError> {
        let info = kind(kind_id).ok_or_else(|| AppError::NoSuchKind(kind_id.into()))?;
        let mut part = match info.id {
            "wave" => {
                let mut patch = match saved.and_then(|s| s.get("wave")) {
                    Some(p) => wave_patch::patch_from_json(p, wave::Patch::default()).map_err(AppError::BadFile)?,
                    None => wave::Patch::default(),
                };
                wave_patch::ensure(&mut patch);
                let part = WavePart::new(patch);
                self.ctl.add(engine_id(id, 0), Box::new(part.module(self.rate)))?;
                Part::Wave(Box::new(part))
            }
            "atmos" => {
                let mut part = AtmosPart::new(saved.and_then(|s| s.get("atmos")))?;
                let (v, w, f) = (engine_id(id, atmos_part::VOICE), engine_id(id, atmos_part::WEB), engine_id(id, atmos_part::FX));
                self.ctl.add(v, Box::new(part.voice_module(self.rate)))?;
                self.ctl.add(w, Box::new(part.web_module(self.rate)))?;
                self.ctl.add(f, Box::new(part.fx_module(self.rate)))?;
                self.ctl.connect(port(v, 0), port(w, 1))?;
                self.ctl.connect(port(w, 0), port(f, 0))?;
                part.lay(&mut self.ctl, f, self.rate, self.max_block)?;
                Part::Atmos(Box::new(part))
            }
            "sound" => {
                self.ctl.add(engine_id(id, 0), Box::new(engine_core::basics::SoundSource::new()))?;
                let mut part = SoundPart::empty();
                if let Some(state) = saved.and_then(|s| s.get("sound")) {
                    sound_link::restore(&mut part, state, self.rate);
                }
                Part::Sound(Box::new(part))
            }
            "edit" => {
                let part = EditPart::new(saved.and_then(|s| s.get("edit")));
                self.ctl.add(engine_id(id, 0), Box::new(engine_mgl::EditPlayer::new(part.transport.clone())))?;
                Part::Edit(Box::new(part))
            }
            "midi-in" => {
                let channel = saved.and_then(|s| s.get("channel")).and_then(Value::as_u64).unwrap_or(0).min(16) as u8;
                self.ctl.add(engine_id(id, 0), Box::new(engine_core::basics::Keys::new()))?;
                Part::MidiIn { channel }
            }
            "output" => {
                self.ctl.add(engine_id(id, 0), Box::new(engine_core::basics::Mix::new(info.ins.len())))?;
                self.ctl.add(engine_id(id, 1), Box::new(engine_mgl::Ceiling))?;
                self.ctl.connect(port(engine_id(id, 0), 0), port(engine_id(id, 1), 0))?;
                self.ctl.connect_out(port(engine_id(id, 1), 0))?;
                Part::Output
            }
            _ => return Err(AppError::NoSuchKind(kind_id.into())),
        };
        self.ctl.commit()?;
        if let Part::Wave(w) = &mut part {
            w.hand_over_board(&mut self.ctl, engine_id(id, 0), self.rate);
        }
        let hand = matches!(&part, Part::Sound(s) if s.is_open());
        self.modules.insert(id, Placed { kind: info, x, y, part });
        if hand {
            self.sound_hand_over(id)?;
        }
        self.next = self.next.max(id + 1);
        self.sync_tables();
        Ok(())
    }

    /// Take a module off the canvas, and every cable to and from it.
    pub fn remove(&mut self, id: u32) -> Result<(), AppError> {
        let placed = self.modules.remove(&id).ok_or(AppError::NoSuchModule(id))?;
        let count = match placed.part {
            Part::Output => 2,
            Part::Atmos(_) => 3,
            _ => 1,
        };
        for k in 0..count {
            self.ctl.remove(engine_id(id, k));
        }
        self.wires.retain(|w| w.from.0 != id && w.to.0 != id);
        self.ctl.commit()?;
        Ok(())
    }

    pub fn place(&mut self, id: u32, x: f32, y: f32) -> Result<(), AppError> {
        let m = self.modules.get_mut(&id).ok_or(AppError::NoSuchModule(id))?;
        m.x = x;
        m.y = y;
        Ok(())
    }

    pub fn set_view(&mut self, view: Value) {
        self.view = view;
    }

    pub fn view(&self) -> &Value {
        &self.view
    }

    /// The engine socket a canvas socket is.
    fn engine_out(&self, (id, socket): (u32, u32)) -> Result<(engine_core::PortRef, Kind), AppError> {
        let m = self.modules.get(&id).ok_or(AppError::NoSuchModule(id))?;
        let (_, kind) = m.kind.outs.get(socket as usize).ok_or(AppError::NoSuchSocket)?;
        let k = if matches!(m.part, Part::Atmos(_)) { atmos_part::FX } else { 0 };
        Ok((port(engine_id(id, k), socket), *kind))
    }

    fn engine_in(&self, (id, socket): (u32, u32)) -> Result<(engine_core::PortRef, Kind), AppError> {
        let m = self.modules.get(&id).ok_or(AppError::NoSuchModule(id))?;
        let (_, kind) = m.kind.ins.get(socket as usize).ok_or(AppError::NoSuchSocket)?;
        Ok((port(engine_id(id, 0), socket), *kind))
    }

    /// Cable an output socket to an input socket.
    pub fn connect(&mut self, from: (u32, u32), to: (u32, u32)) -> Result<(), AppError> {
        let (out, a) = self.engine_out(from)?;
        let (inp, b) = self.engine_in(to)?;
        if a != b {
            return Err(AppError::KindsDiffer);
        }
        let wire = Wire { from, to };
        if self.wires.contains(&wire) {
            return Ok(());
        }
        if self.wires.iter().any(|w| w.to == to) {
            return Err(AppError::Taken);
        }
        self.ctl.connect(out, inp)?;
        if let Err(e) = self.ctl.commit() {
            self.ctl.disconnect(out, inp);
            return Err(e.into());
        }
        self.wires.push(wire);
        Ok(())
    }

    pub fn disconnect(&mut self, from: (u32, u32), to: (u32, u32)) -> Result<(), AppError> {
        let wire = Wire { from, to };
        let Some(at) = self.wires.iter().position(|w| *w == wire) else { return Err(AppError::NoSuchSocket) };
        let (out, _) = self.engine_out(from)?;
        let (inp, _) = self.engine_in(to)?;
        self.ctl.disconnect(out, inp);
        self.ctl.commit()?;
        self.wires.remove(at);
        Ok(())
    }

    pub fn wires(&self) -> &[Wire] {
        &self.wires
    }

    pub fn ids(&self) -> Vec<u32> {
        self.modules.keys().copied().collect()
    }

    /// Set control `index` of module `id`: a knob or a switch to `value`, a
    /// choice to option number `value`.
    pub fn set(&mut self, id: u32, index: u32, value: f32) -> Result<(), AppError> {
        let m = self.modules.get_mut(&id).ok_or(AppError::NoSuchModule(id))?;
        match &mut m.part {
            Part::Wave(w) => {
                w.set(&mut self.ctl, engine_id(id, 0), index, value)?;
                self.sync_tables();
                Ok(())
            }
            Part::MidiIn { channel } => {
                if index != 0 {
                    return Err(AppError::NoSuchControl(index));
                }
                *channel = (value.max(0.0) as u8).min(16);
                Ok(())
            }
            Part::Output | Part::Atmos(_) | Part::Sound(_) | Part::Edit(_) => Err(AppError::NoSuchControl(index)),
        }
    }

    /// Every control's value as the face shows it (a choice as its option's
    /// number).
    pub fn values(&self, id: u32) -> Result<Vec<f32>, AppError> {
        let m = self.modules.get(&id).ok_or(AppError::NoSuchModule(id))?;
        Ok(match &m.part {
            Part::Wave(w) => w.values(),
            Part::MidiIn { channel } => vec![*channel as f32],
            Part::Output | Part::Atmos(_) | Part::Sound(_) | Part::Edit(_) => Vec::new(),
        })
    }

    /// A note played on a module's own keyboard, heard from the next block.
    pub fn note(&mut self, id: u32, on: bool, note: u8, velocity: f32) -> Result<u64, AppError> {
        let m = self.modules.get(&id).ok_or(AppError::NoSuchModule(id))?;
        if matches!(m.part, Part::Output | Part::Sound(_) | Part::Edit(_)) {
            return Err(AppError::NoSuchSocket);
        }
        let event = if on { NoteEvent::on(note.min(127), velocity.clamp(0.0, 1.0)) } else { NoteEvent::off(note.min(127)) };
        Ok(self.ctl.send(engine_id(id, 0), EventKind::Note(event))?)
    }

    /// One MIDI message to a MIDI in module, as MGL hears one
    /// (`server-core/src/midi.rs` `parse`): notes go down its cable; the
    /// pitch wheel, the mod wheel (CC 1) and channel aftertouch go to every
    /// Wave its cable reaches. Anything else, or another channel, is ignored.
    pub fn midi(&mut self, id: u32, msg: &[u8]) -> Result<(), AppError> {
        let m = self.modules.get(&id).ok_or(AppError::NoSuchModule(id))?;
        let Part::MidiIn { channel } = m.part else { return Err(AppError::NoSuchModule(id)) };
        let Some(&status) = msg.first() else { return Ok(()) };
        if status < 0x80 || status >= 0xf0 {
            return Ok(());
        }
        if channel != 0 && (status & 0x0f) + 1 != channel {
            return Ok(());
        }
        let data = |i: usize| msg.get(i).map(|b| b & 0x7f);
        let keys = engine_id(id, 0);
        let note = |kind: NoteKind, note: u8, vel: f32| NoteEvent { kind, ..NoteEvent::on(note, vel) };
        let wheel = |s: &mut Session, index: u32, value: f32| -> Result<(), AppError> {
            for w in s.wires.clone().iter().filter(|w| w.from.0 == id) {
                if matches!(s.modules.get(&w.to.0).map(|m| &m.part), Some(Part::Wave(_))) {
                    s.ctl.send(engine_id(w.to.0, 0), EventKind::Param { index, value })?;
                }
            }
            Ok(())
        };
        match status & 0xf0 {
            0x90 => {
                let (Some(n), Some(v)) = (data(1), data(2)) else { return Ok(()) };
                let event = if v == 0 { NoteEvent::off(n) } else { NoteEvent::on(n, v as f32 / 127.0) };
                self.ctl.send(keys, EventKind::Note(event))?;
            }
            0x80 => {
                let Some(n) = data(1) else { return Ok(()) };
                self.ctl.send(keys, EventKind::Note(NoteEvent::off(n)))?;
            }
            0xb0 => match (data(1), data(2)) {
                (Some(1), Some(v)) => wheel(self, engine_mgl::Wave::MOD_WHEEL, v as f32 / 127.0)?,
                (Some(120 | 123), Some(_)) => {
                    self.ctl.send(keys, EventKind::Note(note(NoteKind::AllOff, 0, 0.0)))?;
                }
                _ => {}
            },
            0xe0 => {
                let (Some(lo), Some(hi)) = (data(1), data(2)) else { return Ok(()) };
                let v = ((hi as i32) << 7 | lo as i32) - 8192;
                let b = if v >= 0 { v as f32 / 8191.0 } else { v as f32 / 8192.0 };
                wheel(self, engine_mgl::Wave::BEND, b.clamp(-1.0, 1.0))?;
            }
            0xd0 => {
                let Some(v) = data(1) else { return Ok(()) };
                wheel(self, engine_mgl::Wave::AFTERTOUCH, v as f32 / 127.0)?;
            }
            _ => {}
        }
        Ok(())
    }

    /// Now and then, on the app's thread: free what the audio thread has
    /// finished with, and hand over the tables that have finished building.
    pub fn collect(&mut self) {
        self.ctl.collect();
        self.sound_collect();
        if self.tables.take_built() {
            self.sync_tables();
        }
    }

    /// Where saved tables are, first first (see [`set_table_dirs`]); every
    /// table not found before is looked for again.
    pub fn table_dirs(&mut self, dirs: Vec<std::path::PathBuf>) {
        set_table_dirs(dirs);
        self.tables.look_again();
        self.sync_tables();
    }

    /// Wait until every table asked for is built and handed over. For tests
    /// and offline renders; the app never waits.
    pub fn settle(&mut self) {
        while self.tables.pending() {
            self.tables.wait_one();
            self.sync_tables();
        }
        self.sync_tables();
    }

    fn sync_tables(&mut self) {
        let mut wanted = Vec::new();
        for (id, m) in self.modules.iter_mut() {
            if let Part::Wave(w) = &mut m.part {
                w.sync(&mut self.ctl, engine_id(*id, 0), &mut self.tables);
                wanted.extend(w.wanted());
            }
        }
        self.tables.keep(&wanted);
    }

    /// The canvas as a patch file.
    pub fn save(&self) -> Value {
        let modules = self
            .modules
            .iter()
            .map(|(id, m)| {
                let mut o = Map::new();
                o.insert("id".into(), (*id).into());
                o.insert("kind".into(), m.kind.id.into());
                o.insert("x".into(), wave_patch::num(m.x));
                o.insert("y".into(), wave_patch::num(m.y));
                match &m.part {
                    Part::Wave(w) => {
                        o.insert("wave".into(), wave_patch::patch_json(w.patch()));
                    }
                    Part::Atmos(a) => {
                        o.insert("atmos".into(), a.state());
                        o.insert("name".into(), a.name().into());
                    }
                    Part::MidiIn { channel } => {
                        o.insert("channel".into(), (*channel).into());
                    }
                    Part::Output => {}
                    Part::Sound(s) => {
                        o.insert("sound".into(), s.state());
                    }
                    Part::Edit(e) => {
                        o.insert("edit".into(), e.ui.clone());
                    }
                }
                Value::Object(o)
            })
            .collect();
        let cables = self
            .wires
            .iter()
            .map(|w| {
                let mut o = Map::new();
                o.insert("from".into(), Value::Array(vec![w.from.0.into(), w.from.1.into()]));
                o.insert("to".into(), Value::Array(vec![w.to.0.into(), w.to.1.into()]));
                Value::Object(o)
            })
            .collect();
        let mut o = Map::new();
        o.insert("format".into(), FORMAT.into());
        o.insert("version".into(), VERSION.into());
        o.insert("modules".into(), Value::Array(modules));
        o.insert("cables".into(), Value::Array(cables));
        o.insert("view".into(), self.view.clone());
        Value::Object(o)
    }

    /// Empty the canvas and put a saved one in its place. A file that can't
    /// be read leaves the canvas as it was.
    pub fn load(&mut self, file: &Value) -> Result<(), AppError> {
        let bad = |why: &str| AppError::BadFile(why.into());
        if file.get("format").and_then(Value::as_str) != Some(FORMAT) {
            return Err(bad("not an idMLab patch"));
        }
        let modules = file.get("modules").and_then(Value::as_array).ok_or_else(|| bad("modules must be a list"))?;
        let mut parsed = Vec::new();
        for m in modules {
            let id = m.get("id").and_then(Value::as_u64).filter(|id| *id > 0 && *id < (u32::MAX / 16) as u64);
            let kind_id = m.get("kind").and_then(Value::as_str);
            let (Some(id), Some(kind_id)) = (id, kind_id) else { return Err(bad("a module needs an id and a kind")) };
            if kind(kind_id).is_none() {
                return Err(AppError::NoSuchKind(kind_id.into()));
            }
            if let Some(p) = m.get("wave") {
                wave_patch::patch_from_json(p, wave::Patch::default()).map_err(AppError::BadFile)?;
            }
            if let Some(p) = m.get("atmos") {
                AtmosPart::new(Some(p))?;
            }
            let at = |k: &str| m.get(k).and_then(Value::as_f64).unwrap_or(0.0) as f32;
            parsed.push((id as u32, kind_id, at("x"), at("y"), m));
        }
        let mut cables = Vec::new();
        for c in file.get("cables").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]) {
            let end = |k: &str| match c.get(k).and_then(Value::as_array).map(Vec::as_slice) {
                Some([a, b]) => Some((a.as_u64()? as u32, b.as_u64()? as u32)),
                _ => None,
            };
            let (Some(from), Some(to)) = (end("from"), end("to")) else { return Err(bad("a cable is from [module, socket] to [module, socket]")) };
            cables.push((from, to));
        }
        self.clear()?;
        for (id, kind_id, x, y, m) in parsed {
            self.add_as(id, kind_id, x, y, Some(m))?;
        }
        for (from, to) in cables {
            self.connect(from, to)?;
        }
        self.view = file.get("view").cloned().unwrap_or(Value::Null);
        Ok(())
    }

    /// Take everything off the canvas.
    pub fn clear(&mut self) -> Result<(), AppError> {
        for id in self.ids() {
            self.remove(id)?;
        }
        self.next = 1;
        Ok(())
    }

    /// The canvas as the app draws it: each module's kind, place and the
    /// values of its controls, and the cables.
    pub fn describe(&self) -> Value {
        let modules = self
            .modules
            .iter()
            .map(|(id, m)| {
                let mut o = Map::new();
                o.insert("id".into(), (*id).into());
                o.insert("kind".into(), m.kind.id.into());
                o.insert("x".into(), wave_patch::num(m.x));
                o.insert("y".into(), wave_patch::num(m.y));
                let values = self.values(*id).unwrap_or_default();
                o.insert("values".into(), Value::Array(values.into_iter().map(wave_patch::num).collect()));
                match &m.part {
                    Part::Wave(w) => {
                        o.insert("name".into(), w.patch().name.as_str().into());
                    }
                    Part::Atmos(a) => {
                        o.insert("atmos".into(), a.state());
                        o.insert("name".into(), a.name().into());
                    }
                    Part::Sound(s) => {
                        o.insert("sound".into(), s.edit_json());
                        o.insert("name".into(), s.origin().get("name").cloned().unwrap_or(Value::Null));
                    }
                    _ => {}
                }
                Value::Object(o)
            })
            .collect();
        let mut o = self.save();
        if let Some(obj) = o.as_object_mut() {
            obj.insert("modules".into(), Value::Array(modules));
        }
        o
    }

    /// Set any of Wave module `id`'s keys by name (a number, a name, or an
    /// LFO's points), as the Wave page sets them.
    pub fn wave_set(&mut self, id: u32, key: &str, value: &Value) -> Result<(), AppError> {
        match self.modules.get_mut(&id).map(|m| &mut m.part) {
            Some(Part::Wave(w)) => w.set_key(&mut self.ctl, engine_id(id, 0), key, value)?,
            _ => return Err(AppError::NoSuchModule(id)),
        }
        self.sync_tables();
        Ok(())
    }

    /// The pitch wheel (`which` 0, -1 to 1), the mod wheel (1) or aftertouch
    /// (2, both 0 to 1) to Wave module `id`, as its page's wheels send them.
    pub fn wave_wheel(&mut self, id: u32, which: u32, value: f32) -> Result<(), AppError> {
        if !matches!(self.modules.get(&id).map(|m| &m.part), Some(Part::Wave(_))) {
            return Err(AppError::NoSuchModule(id));
        }
        let index = match which {
            0 => engine_mgl::Wave::BEND,
            1 => engine_mgl::Wave::MOD_WHEEL,
            2 => engine_mgl::Wave::AFTERTOUCH,
            _ => return Err(AppError::NoSuchControl(which)),
        };
        let value = if which == 0 { value.clamp(-1.0, 1.0) } else { value.clamp(0.0, 1.0) };
        self.ctl.send(engine_id(id, 0), EventKind::Param { index, value })?;
        Ok(())
    }

    /// Wave module `id`'s patch, for its preset to be saved.
    pub fn wave_patch(&self, id: u32) -> Result<&wave::Patch, AppError> {
        match self.modules.get(&id).map(|m| &m.part) {
            Some(Part::Wave(w)) => Ok(w.patch()),
            _ => Err(AppError::NoSuchModule(id)),
        }
    }

    /// Give Wave module `id` a whole patch: a preset, MGL's or one saved here.
    pub fn load_wave_patch(&mut self, id: u32, json: &Value) -> Result<(), AppError> {
        let mut patch = wave_patch::patch_from_json(json, wave::Patch::default()).map_err(AppError::BadFile)?;
        wave_patch::ensure(&mut patch);
        let rate = self.rate;
        match self.modules.get_mut(&id).map(|m| &mut m.part) {
            Some(Part::Wave(w)) => w.adopt(&mut self.ctl, engine_id(id, 0), patch, rate),
            _ => return Err(AppError::NoSuchModule(id)),
        }
        self.sync_tables();
        Ok(())
    }

    fn atmos(&self, id: u32) -> Result<&AtmosPart, AppError> {
        match self.modules.get(&id).map(|m| &m.part) {
            Some(Part::Atmos(a)) => Ok(a),
            _ => Err(AppError::NoSuchModule(id)),
        }
    }

    /// Set one of Atmosphere module `id`'s keys by the page's name for it
    /// (a knob's id at its raw value, a select's value, or `fx`, the whole
    /// chain; `fx.<slot>.<key>` moves one control of the running chain).
    /// A key it does not keep is ignored.
    /// Atmosphere module `id` as one of MGL's presets, named `name` (and
    /// known by it from now on).
    pub fn atmos_preset(&mut self, id: u32, name: &str) -> Result<Value, AppError> {
        let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        match self.modules.get_mut(&id).map(|m| &mut m.part) {
            Some(Part::Atmos(a)) => Ok(a.preset(name, ms)),
            _ => Err(AppError::NoSuchModule(id)),
        }
    }

    /// Give Atmosphere module `id` one of MGL's presets: what it holds of
    /// Atmosphere's controls. How many controls it set.
    pub fn load_atmos_preset(&mut self, id: u32, preset: &Value) -> Result<usize, AppError> {
        let (rate, max_block) = (self.rate, self.max_block);
        match self.modules.get_mut(&id).map(|m| &mut m.part) {
            Some(Part::Atmos(a)) => a.load_preset(&mut self.ctl, engine_id(id, 0), preset, rate, max_block),
            _ => Err(AppError::NoSuchModule(id)),
        }
    }

    pub fn atmos_set(&mut self, id: u32, key: &str, value: &Value) -> Result<(), AppError> {
        let (rate, max_block) = (self.rate, self.max_block);
        match self.modules.get_mut(&id).map(|m| &mut m.part) {
            Some(Part::Atmos(a)) => a.set(&mut self.ctl, engine_id(id, 0), key, value, rate, max_block),
            _ => Err(AppError::NoSuchModule(id)),
        }
    }

    /// Atmosphere module `id`'s state: every key the page keeps, and its value.
    pub fn atmos_state(&self, id: u32) -> Result<Value, AppError> {
        Ok(self.atmos(id)?.state())
    }

    /// What oscillator `which` (0 A, 1 B) of Atmosphere module `id` shows
    /// now: its model's number, or None when nothing sounds.
    pub fn atmos_view(&self, id: u32, which: usize, out: &mut [f32; 32]) -> Result<Option<usize>, AppError> {
        Ok(self.atmos(id)?.view(which, out))
    }

    /// The pitch of the last note Atmosphere module `id` started, however it
    /// came (its keys, a cable, a sequencer); 0 before any.
    pub fn atmos_hz(&self, id: u32) -> Result<f32, AppError> {
        Ok(self.atmos(id)?.last_hz())
    }

    /// The last `out.len()` frames (at most [`engine_mgl::SCOPE_LEN`]) of
    /// Atmosphere module `id`'s output, mono, oldest first. How many.
    pub fn atmos_scope(&self, id: u32, out: &mut [f32]) -> Result<usize, AppError> {
        Ok(self.atmos(id)?.scope.read(out))
    }

    /// Atmosphere module `id`'s FX line: its output peak, and each slot's
    /// (peak, how hard it works), since the last reading.
    pub fn atmos_fx_meter(&self, id: u32) -> Result<(f32, Vec<(f32, f32)>), AppError> {
        Ok(self.atmos(id)?.fx_meter())
    }
}
