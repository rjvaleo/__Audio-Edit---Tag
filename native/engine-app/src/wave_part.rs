//! Wave on the canvas: its patch, its tables and its board, kept and handed
//! over the way MultiGrainLive's server does it for the Wave page
//! (`server-core/src/wave_synth.rs`).
//!
//! - A knob that is a number goes to the synth as it is, at once, as MGL's
//!   `set_live`; the patch keeps it.
//! - A choice (a mode, a filter, a table) compiles the whole patch again and
//!   hands it over, as MGL's `post_param` does for a string key.
//! - Tables are by name: the five built-ins, or a table saved as MGL saves
//!   one (`<name>.wav`, 32-bit float with a `clm ` chunk) in one of the
//!   folders given with [`set_table_dirs`]. A table not built yet is built
//!   on a thread of its own, and the oscillators keep what they had until it
//!   is ready. A name found nowhere leaves the oscillator as it was, as an
//!   unknown name does in MGL.
//! - The table bank (the five built-ins, for a mod row that steps tables) is
//!   built and given only while a row wants it, as in MGL.

use crate::{AppError, Control};
use engine_core::{Controller, EventKind, ModuleId};
use engine_mgl::{Wave, WaveThing};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use wave::choice::{choice_id, C_OSC_STRIDE, C_TABLE};
use wave::patch::Kind as KeyKind;
use wave::{
    builtin_frames, BoardPlan, FilterRoute, FilterType, FxMode, LfoMode, LfoWave, Patch, PatchState, Route, VoiceMode, WarpMode,
    Wavetable, BUILTIN_NAMES, FRAME_LEN, KEYS, MAX_FRAMES, NUM_PARAMS, STR_KEYS,
};

/// The folders saved tables are read from, first first.
static TABLE_DIRS: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// Where to find tables saved as files: the app's own folder, then MGL's
/// (`data/wave/tables`), say. Read only; nothing is written there.
pub fn set_table_dirs(dirs: Vec<PathBuf>) {
    if let Ok(mut d) = TABLE_DIRS.lock() {
        *d = dirs;
    }
}

fn table_dirs() -> Vec<PathBuf> {
    TABLE_DIRS.lock().map(|d| d.clone()).unwrap_or_default()
}

/// A name as MGL makes it into a file name (`capture::safe`).
fn safe(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if (c as u32) < 0x20 => ' ',
            c => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

/// The longest frame a table file may have (MGL's `MAX_FRAME_LEN`).
const MAX_FRAME_LEN: usize = 4096;

/// Frames back out of a table WAV, as MGL reads one (`read_table_wav`):
/// 32-bit float or 16-bit PCM, the first channel, cut at the `clm ` chunk's
/// frame length (2048 when there is none).
pub fn read_table_wav(b: &[u8]) -> Option<Vec<Vec<f32>>> {
    if b.len() < 12 || &b[0..4] != b"RIFF" || &b[8..12] != b"WAVE" {
        return None;
    }
    let (mut format, mut channels, mut bits, mut len) = (0u16, 1usize, 0u16, FRAME_LEN);
    let mut data: Option<&[u8]> = None;
    let mut at = 12;
    while at + 8 <= b.len() {
        let id = &b[at..at + 4];
        let size = u32::from_le_bytes(b[at + 4..at + 8].try_into().ok()?) as usize;
        let body = &b[at + 8..(at + 8 + size).min(b.len())];
        match id {
            b"fmt " if body.len() >= 16 => {
                format = u16::from_le_bytes([body[0], body[1]]);
                channels = u16::from_le_bytes([body[2], body[3]]).max(1) as usize;
                bits = u16::from_le_bytes([body[14], body[15]]);
            }
            b"clm " => {
                let text = String::from_utf8_lossy(body);
                if let Some(n) = text.strip_prefix("<!>").and_then(|t| t.split_whitespace().next()).and_then(|t| t.parse().ok()) {
                    len = n;
                }
            }
            b"data" => data = Some(body),
            _ => {}
        }
        at += 8 + size + (size & 1);
    }
    let data = data?;
    let samples: Vec<f32> = match (format, bits) {
        (3, 32) => data.chunks_exact(4 * channels).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect(),
        (1, 16) => data.chunks_exact(2 * channels).map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0).collect(),
        _ => return None,
    };
    if !(4..=MAX_FRAME_LEN).contains(&len) || samples.len() < len {
        return None;
    }
    Some(samples.chunks_exact(len).take(MAX_FRAMES).map(<[f32]>::to_vec).collect())
}

fn saved_table(dir: &Path, name: &str) -> Option<Vec<Vec<f32>>> {
    let file = safe(name);
    if file.is_empty() || file.starts_with('.') {
        return None;
    }
    read_table_wav(&std::fs::read(dir.join(format!("{file}.wav"))).ok()?)
}

/// A table's frames by name: a built-in, or one saved in a table folder.
pub fn frames_for(name: &str) -> Option<Vec<Vec<f32>>> {
    builtin_frames(name).or_else(|| table_dirs().iter().find_map(|d| saved_table(d, name)))
}

/// Every table there is: the built-ins, then the saved ones by name.
pub fn table_names() -> Vec<String> {
    let mut saved = Vec::new();
    for dir in table_dirs() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()).map(str::to_lowercase).as_deref() != Some("wav") {
                continue;
            }
            let Some(name) = p.file_stem().map(|s| s.to_string_lossy().to_string()) else { continue };
            if !BUILTIN_NAMES.contains(&name.as_str()) && !saved.contains(&name) {
                saved.push(name);
            }
        }
    }
    saved.sort_by_key(|n| n.to_lowercase());
    BUILTIN_NAMES.iter().map(|n| n.to_string()).chain(saved).collect()
}

/// The options of a string key, in the order the face lists them.
fn options(key: &str) -> Vec<String> {
    let rest = key.split_once('.').map_or(key, |(_, r)| r);
    if rest == "table" {
        return table_names();
    }
    let fixed: Vec<&'static str> = match (key, rest) {
        (_, "warp0.mode" | "warp1.mode") => WarpMode::ALL.iter().map(|m| m.as_str()).collect(),
        (_, "fx.mode") => FxMode::ALL.iter().map(|m| m.as_str()).collect(),
        (_, "route") if key.starts_with("osc") => Route::ALL.iter().map(|m| m.as_str()).collect(),
        ("filt.route", _) => FilterRoute::ALL.iter().map(|m| m.as_str()).collect(),
        (_, "type") => FilterType::ALL.iter().map(|m| m.as_str()).collect(),
        ("voice.mode", _) => VoiceMode::ALL.iter().map(|m| m.as_str()).collect(),
        (_, "mode") => LfoMode::ALL.iter().map(|m| m.as_str()).collect(),
        (_, "shape") => LfoWave::ALL.iter().map(|m| m.as_str()).collect(),
        _ => Vec::new(),
    };
    fixed.into_iter().map(String::from).collect()
}

/// Wave's controls: every number key in the synth's own order (so control
/// `i` below [`NUM_PARAMS`] is the synth's parameter `i`), then every string
/// key.
pub fn controls() -> Vec<Control> {
    let defaults = Patch::default();
    let mut out: Vec<Control> = KEYS
        .iter()
        .enumerate()
        .map(|(i, k)| {
            let default = defaults.values[i];
            if k.kind == KeyKind::Int && k.min == 0.0 && k.max == 1.0 {
                Control::Switch { key: k.key.into(), default }
            } else {
                let step = if k.kind == KeyKind::Int { 1.0 } else { 0.0 };
                Control::Knob { key: k.key.into(), min: k.min, max: k.max, step, default }
            }
        })
        .collect();
    for key in STR_KEYS.iter() {
        let opts = options(key);
        let default = defaults.get_str(key).and_then(|s| opts.iter().position(|o| *o == s)).unwrap_or(0);
        out.push(Control::Choice { key: (*key).into(), options: opts, default });
    }
    out
}

/// Whether a row (switched on) steps a table, so the bank is wanted.
fn wants_bank(p: &Patch) -> bool {
    p.mods.iter().any(|m| m.on && choice_id(&m.dst).is_some_and(|c| c.index() % C_OSC_STRIDE == C_TABLE && c.index() < 3 * C_OSC_STRIDE))
}

/// Tables built for every Wave on the canvas, by name.
pub(crate) struct Tables {
    built: HashMap<String, Arc<Wavetable>>,
    building: HashSet<String>,
    missing: HashSet<String>,
    tx: Sender<(String, Option<Arc<Wavetable>>)>,
    rx: Receiver<(String, Option<Arc<Wavetable>>)>,
}

impl Tables {
    pub(crate) fn new() -> Tables {
        let (tx, rx) = channel();
        Tables { built: HashMap::new(), building: HashSet::new(), missing: HashSet::new(), tx, rx }
    }

    /// The table called `name`, if it is built; if not, its build is started.
    fn get(&mut self, name: &str) -> Option<Arc<Wavetable>> {
        if let Some(t) = self.built.get(name) {
            return Some(Arc::clone(t));
        }
        if !self.building.contains(name) && !self.missing.contains(name) {
            self.building.insert(name.to_string());
            let (tx, wanted) = (self.tx.clone(), name.to_string());
            let job = move || {
                let table = frames_for(&wanted).map(|f| Arc::new(Wavetable::from_frames(&f)));
                let _ = tx.send((wanted, table));
            };
            if std::thread::Builder::new().name("wave-table".into()).spawn(job).is_err() {
                self.building.remove(name);
            }
        }
        None
    }

    fn arrived(&mut self, (name, table): (String, Option<Arc<Wavetable>>)) {
        self.building.remove(&name);
        match table {
            Some(t) => {
                self.built.insert(name, t);
            }
            // Found nowhere: not looked for again until the folders change.
            None => {
                self.missing.insert(name);
            }
        }
    }

    /// Look again for every table that wasn't found.
    pub(crate) fn look_again(&mut self) {
        self.missing.clear();
    }

    /// Take in what has finished building. True if anything did.
    pub(crate) fn take_built(&mut self) -> bool {
        let mut any = false;
        while let Ok(done) = self.rx.try_recv() {
            self.arrived(done);
            any = true;
        }
        any
    }

    pub(crate) fn pending(&self) -> bool {
        !self.building.is_empty()
    }

    pub(crate) fn wait_one(&mut self) {
        if let Ok(done) = self.rx.recv() {
            self.arrived(done);
        }
    }

    /// Let go of every table no Wave plays.
    pub(crate) fn keep(&mut self, wanted: &[String]) {
        self.built.retain(|name, _| wanted.iter().any(|w| w == name));
    }
}

/// One Wave on the canvas.
pub struct WavePart {
    patch: Patch,
    /// What each oscillator, and each place in the bank, was last given.
    given: [Option<Arc<Wavetable>>; 3],
    bank: [Option<Arc<Wavetable>>; BUILTIN_NAMES.len()],
}

fn same(a: &Option<Arc<Wavetable>>, b: &Arc<Wavetable>) -> bool {
    a.as_ref().is_some_and(|a| Arc::ptr_eq(a, b))
}

impl WavePart {
    pub fn new(patch: Patch) -> WavePart {
        WavePart { patch, given: Default::default(), bank: Default::default() }
    }

    pub fn patch(&self) -> &Patch {
        &self.patch
    }

    /// The engine module, playing this patch (its tables and board follow).
    pub fn module(&self, rate: f32) -> Wave {
        Wave::new(rate).patch(PatchState::new(&self.patch))
    }

    /// Compile the patch's board for `rate` and hand it to the synth. A board
    /// that can't be compiled leaves the synth's as it was.
    pub(crate) fn hand_over_board(&self, ctl: &mut Controller, module: ModuleId, rate: f32) {
        if let Some(board) = &self.patch.board {
            if let Ok(plan) = BoardPlan::compile(board, rate) {
                let _ = ctl.give(module, 0, Box::new(WaveThing::Board(Box::new(plan))));
            }
        }
    }

    /// Control `index`: a number key's value, or a string key's option.
    pub(crate) fn set(&mut self, ctl: &mut Controller, module: ModuleId, index: u32, value: f32) -> Result<(), AppError> {
        let i = index as usize;
        if i < NUM_PARAMS {
            let key = KEYS[i].key;
            if !self.patch.set_num(key, value) {
                return Err(AppError::NoSuchControl(index));
            }
            ctl.send(module, EventKind::Param { index, value: self.patch.values[i] })?;
            return Ok(());
        }
        let key = STR_KEYS.get(i - NUM_PARAMS).ok_or(AppError::NoSuchControl(index))?;
        let opts = options(key);
        let pick = opts.get(value.max(0.0) as usize).ok_or(AppError::NoSuchControl(index))?;
        if !self.patch.set_str(key, pick) {
            return Err(AppError::NoSuchControl(index));
        }
        ctl.give(module, 0, Box::new(WaveThing::Patch(PatchState::new(&self.patch))))?;
        Ok(())
    }

    /// A whole new patch: compiled and handed over, its board too.
    pub(crate) fn adopt(&mut self, ctl: &mut Controller, module: ModuleId, patch: Patch, rate: f32) {
        self.patch = patch;
        let _ = ctl.give(module, 0, Box::new(WaveThing::Patch(PatchState::new(&self.patch))));
        self.hand_over_board(ctl, module, rate);
    }

    /// The face's values: every number key, then each string key's option
    /// (-1 for a table name that isn't one of the built-ins).
    pub fn values(&self) -> Vec<f32> {
        let mut v = self.patch.values.to_vec();
        for key in STR_KEYS.iter() {
            let at = self.patch.get_str(key).and_then(|s| options(key).iter().position(|o| *o == s));
            v.push(at.map_or(-1.0, |i| i as f32));
        }
        v
    }

    /// Every table this Wave plays or wants.
    pub(crate) fn wanted(&self) -> Vec<String> {
        let mut names = self.patch.tables.to_vec();
        if wants_bank(&self.patch) {
            names.extend(BUILTIN_NAMES.iter().map(|n| n.to_string()));
        }
        names
    }

    /// Give each oscillator the table it should have, if it is built; start
    /// building what isn't.
    pub(crate) fn sync(&mut self, ctl: &mut Controller, module: ModuleId, tables: &mut Tables) {
        for osc in 0..3 {
            if let Some(t) = tables.get(&self.patch.tables[osc]) {
                if !same(&self.given[osc], &t) && ctl.give(module, 0, Box::new(WaveThing::Table(osc, Arc::clone(&t)))).is_ok() {
                    self.given[osc] = Some(t);
                }
            }
        }
        if wants_bank(&self.patch) {
            for (i, name) in BUILTIN_NAMES.iter().enumerate() {
                if let Some(t) = tables.get(name) {
                    if !same(&self.bank[i], &t) && ctl.give(module, 0, Box::new(WaveThing::BankTable(i, Arc::clone(&t)))).is_ok() {
                        self.bank[i] = Some(t);
                    }
                }
            }
        }
    }
}
