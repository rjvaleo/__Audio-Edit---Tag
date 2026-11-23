//! The Chop module: MGL's Chop page (`ui/app/400-chop-cut.js` ..
//! `406-chop-page.js`), cutting the sound cabled into it.
//!
//! The page's arithmetic is `engine_mgl::chop` (the cuts, the edits, the
//! measures, the sound of a slice, Write's bytes: each the page's to the bit).
//! This is the page's state around it, kept as the page keeps it: the two
//! slots A and B by the page's own keys at their raw values (`CHOP_DEF`),
//! the preset's name, S and E, the slices with their flags, the picks, what
//! Detect said, and the face's own (`ui`). The sound is the cabled Sound
//! module's document (`chop_link.rs`), measured on a helper thread
//! (`chopAnalyse`). What the engine's `Chop` plays is rendered here, off the
//! audio thread, and handed over whole (`Controller::give`).

use engine_mgl::chop::{self, listen::Analysis, Div, Feel, Filter, Measure, Mode, Page, Placed, PlayingNow, Settings, Slice};
use engine_mgl::ChopThing;
use serde_json::{json, Map, Value};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// The page's fixed size (`CHOP_W`, `CHOP_H`).
pub const CHOP_W: u32 = 1432;
pub const CHOP_H: u32 = 1000;
/// How long things must be still before what plays is rendered again.
pub const QUIET: Duration = Duration::from_millis(150);

/// `CHOP_DEF`: every setting, at the page's start.
pub fn chop_def() -> Map<String, Value> {
    let v = json!({
        "mode": "transient", "sens": 60, "topDb": 40, "minDur": 40, "pad": 12,
        "div": "8", "feel": "straight", "nudge": 0, "shuffle": 50,
        "gate": 100, "smooth": 0, "tail": false, "tailMs": 80,
        "bars": 1, "beats": 0, "sig": 4, "tempo": 0, "pitch": 0, "stretch": 0, "sync": "free",
        "envOn": false, "attack": 0, "decay": 5000,
        "trOn": false, "trThresh": -30, "trAmount": 0, "trAttack": 20, "trRelease": 100, "trGain": 0,
        "eqOn": false, "loCut": 15, "lowF": 100, "lowG": 0, "lowQ": 1, "highF": 2500, "highG": 0, "highQ": 1, "hiCut": 20000,
        "fltOn": false, "fltType": "lp", "fltFreq": 1000, "fltQ": 0.7, "drive": 0, "gain": 0, "mix": 100,
        "outMidi": false, "outSfz": false,
    });
    match v {
        Value::Object(m) => m,
        _ => Map::new(),
    }
}

/// A page value as a number (a number, or a string of one, as JavaScript's
/// arithmetic reads it); `d` when it is neither.
fn num_of(v: Option<&Value>, d: f64) -> f64 {
    match v {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(d),
        Some(Value::String(s)) => s.trim().parse().unwrap_or(d),
        Some(Value::Bool(b)) => *b as u8 as f64,
        _ => d,
    }
}

/// A page value's truth, as `if (cp.tail)` reads it.
fn truth(v: Option<&Value>) -> bool {
    match v {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|x| x != 0.0 && !x.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        _ => false,
    }
}

fn text_of<'a>(v: Option<&'a Value>, d: &'a str) -> &'a str {
    v.and_then(Value::as_str).unwrap_or(d)
}

/// The engine's settings from the page's `cp`.
pub fn settings_of(cp: &Map<String, Value>) -> Settings {
    let d = Settings::default();
    let n = |k: &str, d: f64| num_of(cp.get(k), d);
    let b = |k: &str| truth(cp.get(k));
    Settings {
        mode: match text_of(cp.get("mode"), "transient") {
            "silence" => Mode::Silence,
            "grid" => Mode::Grid,
            _ => Mode::Transient,
        },
        sens: n("sens", d.sens),
        top_db: n("topDb", d.top_db),
        min_dur: n("minDur", d.min_dur),
        pad: n("pad", d.pad),
        div: match cp.get("div") {
            Some(Value::String(s)) if s == "bar" => Div::Bar,
            v => Div::Of(num_of(v, 8.0)),
        },
        feel: match text_of(cp.get("feel"), "straight") {
            "dot" => Feel::Dot,
            "trip" => Feel::Trip,
            _ => Feel::Straight,
        },
        nudge: n("nudge", d.nudge),
        shuffle: n("shuffle", d.shuffle),
        gate: n("gate", d.gate),
        smooth: n("smooth", d.smooth),
        tail: b("tail"),
        tail_ms: n("tailMs", d.tail_ms),
        bars: n("bars", d.bars),
        beats: n("beats", d.beats),
        sig: n("sig", d.sig),
        tempo: n("tempo", d.tempo),
        pitch: n("pitch", d.pitch),
        stretch: n("stretch", d.stretch),
        lock: text_of(cp.get("sync"), "free") == "lock",
        env_on: b("envOn"),
        attack: n("attack", d.attack),
        decay: n("decay", d.decay),
        tr_on: b("trOn"),
        tr_thresh: n("trThresh", d.tr_thresh),
        tr_amount: n("trAmount", d.tr_amount),
        tr_attack: n("trAttack", d.tr_attack),
        tr_release: n("trRelease", d.tr_release),
        tr_gain: n("trGain", d.tr_gain),
        eq_on: b("eqOn"),
        lo_cut: n("loCut", d.lo_cut),
        low_f: n("lowF", d.low_f),
        low_g: n("lowG", d.low_g),
        low_q: n("lowQ", d.low_q),
        high_f: n("highF", d.high_f),
        high_g: n("highG", d.high_g),
        high_q: n("highQ", d.high_q),
        hi_cut: n("hiCut", d.hi_cut),
        flt_on: b("fltOn"),
        flt_type: Filter::named(text_of(cp.get("fltType"), "lp")),
        flt_freq: n("fltFreq", d.flt_freq),
        flt_q: n("fltQ", d.flt_q),
        drive: n("drive", d.drive),
        gain: n("gain", d.gain),
        mix: n("mix", d.mix),
    }
}

/// `chopPresetTag`: what a setting cuts by, "Grid · 1/16", "Transient".
pub fn preset_tag(cp: &Map<String, Value>) -> String {
    let mut c = chop_def();
    for (k, v) in cp {
        c.insert(k.clone(), v.clone());
    }
    let mode = text_of(c.get("mode"), "transient").to_string();
    if mode != "grid" {
        let mut ch = mode.chars();
        return match ch.next() {
            Some(f) => f.to_uppercase().collect::<String>() + ch.as_str(),
            None => String::new(),
        };
    }
    match c.get("div") {
        Some(Value::String(s)) if s == "bar" => "Grid · 1 bar".into(),
        Some(Value::String(s)) => format!("Grid · 1/{s}"),
        Some(v) => format!("Grid · 1/{}", chop::js::num(num_of(Some(v), 8.0))),
        None => "Grid · 1/8".into(),
    }
}

/// A slice's flags as the state gives them: 1 locked, 2 moved, 4 muted, 8 rev.
pub fn flags_of(x: &Slice) -> u64 {
    (x.locked as u64) | (x.moved as u64) << 1 | (x.muted as u64) << 2 | (x.rev as u64) << 3
}

pub fn slice_from(s: i64, e: i64, f: u64) -> Slice {
    Slice { s, e, locked: f & 1 != 0, moved: f & 2 != 0, muted: f & 4 != 0, rev: f & 8 != 0 }
}

/// Where the sound came from, as the state says it.
#[derive(Clone, Debug, Default)]
pub struct SoundFacts {
    pub name: String,
    pub stem: String,
    pub path: String,
    /// "file" (from disk: the slices go beside it) or "library" (MGL's,
    /// read only: the slices go in the app's home).
    pub kind: String,
    /// The file on disk, when there is one.
    pub file: String,
    pub bits: Value,
    pub format: Value,
}

/// What was last handed to the engine: where each thing sits, for the playhead.
#[derive(Default)]
pub struct Built {
    /// Each slice's start, at the time.
    pub starts: Vec<i64>,
    pub preview: Vec<Placed>,
    pub ratchet: Vec<Placed>,
    /// Each clip's first channel at the file's rate: the slices, then
    /// Preview, then Ratchet (`na_chop_out`).
    pub left: Vec<Vec<f32>>,
}

pub struct ChopPart {
    /// `chopSlots`: A and B, each the page's `cp`.
    pub slots: [Map<String, Value>; 2],
    /// B in use.
    pub b: bool,
    /// `chopPresetName`.
    pub preset: String,
    /// `chopTempoSaid.text`.
    pub said: String,
    /// The face's own: tool, view, colour, soft.
    pub ui: Value,
    /// The page with its sound; none with nothing cabled.
    pub page: Option<Page>,
    pub facts: SoundFacts,
    /// The analysis of this sound, once made.
    pub an: Option<Arc<Analysis>>,
    pub measures: Vec<Measure>,
    analysing: Option<mpsc::Receiver<(u64, Analysis)>>,
    /// Up whenever the samples cut change.
    pub sound_serial: u64,
    /// Up whenever anything in the state changes.
    pub serial: u64,
    /// The document fed in: (Sound module, its serial), and its samples' check.
    pub fed: Option<(u32, u64)>,
    pub check: Option<u64>,
    /// A patch's slices, waiting for their sound to come back.
    pub saved: Option<Value>,
    /// What plays has to be rendered again; since when.
    pub dirty: bool,
    pub changed: Instant,
    pub built: Built,
    /// The engine's rate (what plays is rendered at the file's, then
    /// brought to this).
    pub engine_rate: u32,
    pub playing: Arc<chop::ChopPlaying>,
    /// `na_chop_render`'s last slice: (serial, slice, its first channel).
    pub render_cache: Option<(u64, usize, Vec<f32>)>,
    /// Where presets and the library's slices go.
    pub home: Option<std::path::PathBuf>,
    seed: u64,
}

impl ChopPart {
    pub fn new(engine_rate: u32, playing: Arc<chop::ChopPlaying>, saved: Option<&Value>) -> ChopPart {
        let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0x9e37_79b9_7f4a_7c15);
        let mut part = ChopPart {
            slots: [chop_def(), chop_def()],
            b: false,
            preset: String::new(),
            said: String::new(),
            ui: Value::Null,
            page: None,
            facts: SoundFacts::default(),
            an: None,
            measures: Vec::new(),
            analysing: None,
            sound_serial: 0,
            serial: 1,
            fed: None,
            check: None,
            saved: None,
            dirty: false,
            changed: Instant::now(),
            built: Built::default(),
            engine_rate,
            playing,
            render_cache: None,
            home: None,
            seed: seed | 1,
        };
        if let Some(s) = saved {
            part.restore(s);
        }
        part
    }

    /// `cp`: the slot in use.
    pub fn cp(&self) -> &Map<String, Value> {
        &self.slots[self.b as usize]
    }

    pub fn cp_mut(&mut self) -> &mut Map<String, Value> {
        &mut self.slots[self.b as usize]
    }

    /// The page's settings to its `cp`.
    pub fn take_cp(&mut self) {
        let s = settings_of(self.cp());
        if let Some(p) = self.page.as_mut() {
            p.settings = s;
        }
    }

    /// Something in the state changed.
    pub fn touch(&mut self) {
        self.serial += 1;
        self.render_cache = None;
    }

    /// What plays must be rendered again (after a moment's quiet).
    pub fn stale(&mut self) {
        self.dirty = true;
        self.changed = Instant::now();
        self.touch();
    }

    /// `chopChanged`: the slices changed; measured again, rendered again.
    pub fn changed(&mut self) {
        self.measure();
        self.stale();
    }

    /// `chopMeasureSlices`.
    pub fn measure(&mut self) {
        self.measures = match (&self.page, &self.an) {
            (Some(p), Some(an)) => p.measure_all(an),
            _ => Vec::new(),
        };
    }

    /// `chopRecut()`, and everything after it.
    pub fn recut(&mut self) {
        self.take_cp();
        if let Some(p) = self.page.as_mut() {
            p.recut();
        }
        self.changed();
    }

    /// `chopSetting(key, v)`: false for a key the page does not have.
    pub fn set(&mut self, key: &str, v: Value) -> bool {
        if !chop_def().contains_key(key) {
            return false;
        }
        self.cp_mut().insert(key.into(), v);
        if chop::RECUT_KEYS.contains(&key) {
            self.recut();
        } else {
            self.take_cp();
            self.stale();
        }
        true
    }

    /// `chopApply(values)`: `CHOP_DEF` with the values over it, then cut again.
    pub fn apply(&mut self, values: &Map<String, Value>) {
        let mut cp = chop_def();
        for (k, v) in values {
            cp.insert(k.clone(), v.clone());
        }
        *self.cp_mut() = cp;
        self.recut();
    }

    /// `chopSwitchAB`.
    pub fn switch_ab(&mut self, b: bool) {
        self.b = b;
        self.recut();
    }

    /// `chopSetBars`: Bars and Beats in both slots, and cut again.
    pub fn set_bars(&mut self, bars: f64, beats: f64) {
        for s in self.slots.iter_mut() {
            s.insert("bars".into(), num_json(bars));
            s.insert("beats".into(), num_json(beats));
        }
        self.recut();
    }

    /// `chopDetect`.
    pub fn detect(&mut self) {
        let Some(p) = &self.page else { return };
        let t = p.find_tempo();
        let (text, bars) = chop::detect_said(t.as_ref());
        self.said = text;
        match bars {
            Some((bars, beats)) => self.set_bars(bars, beats),
            None => self.touch(),
        }
    }

    /// `chopScaleBars(f)`.
    pub fn scale(&mut self, f: f64) {
        let s = settings_of(self.cp());
        let (text, bars, beats) = chop::scale_bars(s.bars, s.beats, s.sig, f);
        self.said = text;
        self.set_bars(bars, beats);
    }

    /// The dice's next number, 0 to 1 (xorshift64*).
    fn random(&mut self) -> f64 {
        let mut x = self.seed;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.seed = x;
        (x.wrapping_mul(0x2545_f491_4f6c_dd1d) >> 11) as f64 / (1u64 << 53) as f64
    }

    /// `chopDice`: new settings for the cutting and the sound, in the page's ranges.
    pub fn dice(&mut self) {
        let mut r = |a: f64, b: f64| -> f64 { a + self.random() * (b - a) };
        let mut vals: Vec<f64> = Vec::new();
        for (a, b) in [(35.0, 90.0), (0.0, 1.0), (0.0, 1.0), (0.0, 1.0), (52.0, 66.0), (0.0, 1.0), (40.0, 100.0), (0.0, 6.0), (0.0, 1.0), (0.0, 1.0), (0.0, 1.0)] {
            vals.push(r(a, b));
        }
        let mut more: Vec<f64> = Vec::new();
        for (a, b) in [(200f64.ln(), 8000f64.ln()), (0.5, 6.0), (0.0, 1.0), (0.0, 60.0)] {
            more.push(r(a, b));
        }
        let pick = |xs: &[Value], u: f64| xs[((u * xs.len() as f64).floor() as usize).min(xs.len() - 1)].clone();
        let round = |v: f64| chop::js::round(v);
        let mut cp = self.cp().clone();
        cp.insert("sens".into(), num_json(round(vals[0])));
        cp.insert("div".into(), pick(&[json!("4"), json!("8"), json!("8"), json!("16"), json!("16"), json!("32")], vals[1]));
        cp.insert("feel".into(), pick(&[json!("straight"), json!("straight"), json!("dot"), json!("trip")], vals[2]));
        cp.insert("nudge".into(), json!(0));
        cp.insert("shuffle".into(), num_json(round(pick(&[json!(50.0), json!(50.0), json!(vals[4])], vals[3]).as_f64().unwrap_or(50.0))));
        cp.insert("gate".into(), num_json(round(pick(&[json!(100.0), json!(vals[6])], vals[5]).as_f64().unwrap_or(100.0))));
        cp.insert("smooth".into(), num_json(round(vals[7] * 2.0) / 2.0));
        cp.insert("pitch".into(), pick(&[json!(0), json!(0), json!(-12), json!(-5), json!(5), json!(7), json!(12)], vals[8]));
        cp.insert("fltOn".into(), json!(vals[9] < 0.5));
        cp.insert("fltType".into(), pick(&[json!("lp"), json!("bp"), json!("hp")], vals[10]));
        cp.insert("fltFreq".into(), num_json(round(more[0].exp())));
        cp.insert("fltQ".into(), num_json(chop::js::fixed(more[1], 2).parse().unwrap_or(0.7)));
        cp.insert("drive".into(), num_json(round(pick(&[json!(0.0), json!(more[3])], more[2]).as_f64().unwrap_or(0.0))));
        self.apply(&cp);
    }

    /// The patch's record of it.
    pub fn state(&self) -> Value {
        let mut o = json!({
            "slots": { "a": self.slots[0], "b": self.slots[1], "which": if self.b { "b" } else { "a" } },
            "preset": self.preset,
            "ui": self.ui,
        });
        let (check, rest) = match (&self.page, self.check) {
            (Some(p), Some(c)) => (Some(c), Some(self.cut_json(p))),
            // Still waiting for its sound: what the patch had, kept.
            _ => match &self.saved {
                Some(s) => (s.get("check").and_then(Value::as_str).and_then(|h| u64::from_str_radix(h, 16).ok()), s.get("cut").cloned()),
                None => (None, None),
            },
        };
        if let (Some(c), Some(r), Some(obj)) = (check, rest, o.as_object_mut()) {
            obj.insert("check".into(), format!("{c:016x}").into());
            obj.insert("cut".into(), r);
        }
        o
    }

    /// S and E, the slices, the picks and Detect's words.
    fn cut_json(&self, p: &Page) -> Value {
        json!({
            "region": [p.region.0, p.region.1],
            "slices": p.slices.iter().map(|x| json!([x.s, x.e, flags_of(x)])).collect::<Vec<_>>(),
            "current": p.current,
            "sel": p.sel,
            "tempoSaid": self.said,
        })
    }

    fn restore(&mut self, s: &Value) {
        if let Some(slots) = s.get("slots") {
            for (k, at) in [("a", 0), ("b", 1)] {
                if let Some(cp) = slots.get(k).and_then(Value::as_object) {
                    let mut m = chop_def();
                    for (key, v) in cp {
                        m.insert(key.clone(), v.clone());
                    }
                    self.slots[at] = m;
                }
            }
            self.b = slots.get("which").and_then(Value::as_str) == Some("b");
        }
        self.preset = s.get("preset").and_then(Value::as_str).unwrap_or("").to_string();
        self.ui = s.get("ui").cloned().unwrap_or(Value::Null);
        if s.get("check").is_some() && s.get("cut").is_some() {
            self.saved = Some(json!({ "check": s["check"], "cut": s["cut"] }));
        }
    }

    /// A new sound: `chopTake(channels, rate, stem, { detect })`, unless it
    /// is the one a patch was saved with, when its slices come back as they were.
    pub fn take(&mut self, channels: Vec<Vec<f32>>, rate: f64, facts: SoundFacts, check: u64) {
        self.facts = facts;
        self.check = Some(check);
        self.sound_serial += 1;
        self.said.clear();
        self.an = None;
        self.measures.clear();
        let mut page = Page::new(channels, rate, settings_of(self.cp()));
        let saved = self.saved.take().filter(|s| s.get("check").and_then(Value::as_str) == Some(format!("{check:016x}").as_str()));
        // The analysis, on a helper thread (`chopAnalyse`).
        let (tx, rx) = mpsc::channel();
        let (mono, serial) = (page.mono.clone(), self.sound_serial);
        std::thread::spawn(move || {
            let an = engine_mgl::chop::analyse(&mono, rate);
            let _ = tx.send((serial, an));
        });
        self.analysing = Some(rx);
        match saved.as_ref().and_then(|s| s.get("cut")) {
            Some(cut) => {
                let n = |v: &Value| v.as_f64().unwrap_or(0.0) as i64;
                let len = page.len;
                if let Some([s, e]) = cut.get("region").and_then(Value::as_array).map(Vec::as_slice) {
                    page.region = (n(s).clamp(0, len), n(e).clamp(0, len));
                }
                if let Some(list) = cut.get("slices").and_then(Value::as_array) {
                    page.slices = list
                        .iter()
                        .filter_map(|x| x.as_array())
                        .filter(|x| x.len() >= 2)
                        .map(|x| slice_from(n(&x[0]).clamp(0, len), n(&x[1]).clamp(0, len), x.get(2).and_then(Value::as_u64).unwrap_or(0)))
                        .collect();
                }
                page.current = cut.get("current").and_then(Value::as_i64).unwrap_or(-1);
                page.sel = cut.get("sel").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_i64).collect()).unwrap_or_default();
                self.said = cut.get("tempoSaid").and_then(Value::as_str).unwrap_or("").to_string();
                self.page = Some(page);
                self.changed();
            }
            None => {
                self.page = Some(page);
                self.changed();
                self.detect();
            }
        }
    }

    /// No sound: the page with no file.
    pub fn drop_sound(&mut self) {
        if self.page.is_none() && self.check.is_none() {
            return;
        }
        self.page = None;
        self.facts = SoundFacts::default();
        self.check = None;
        self.an = None;
        self.measures.clear();
        self.analysing = None;
        self.sound_serial += 1;
        self.stale();
    }

    /// Take the analysis if it has come. True if it came now.
    pub fn take_analysis(&mut self, wait: bool) -> bool {
        let Some(rx) = &self.analysing else { return false };
        let got = if wait { rx.recv().ok() } else { rx.try_recv().ok() };
        let done = got.is_some() || matches!(rx.try_recv(), Err(mpsc::TryRecvError::Disconnected));
        if done {
            self.analysing = None;
        }
        match got {
            Some((serial, an)) if serial == self.sound_serial => {
                self.an = Some(Arc::new(an));
                self.measure();
                self.touch();
                true
            }
            _ => false,
        }
    }

    pub fn analysing(&self) -> bool {
        self.analysing.is_some()
    }

    /// What the engine's Chop plays, rendered from the page now: brought to
    /// the engine's rate, with where everything sits kept for the playhead.
    pub fn build(&mut self) -> Box<ChopThing> {
        self.dirty = false;
        let Some(page) = &self.page else {
            self.built = Built::default();
            return Box::new(ChopThing::default());
        };
        let (mut thing, preview, ratchet) = ChopThing::with_maps(page);
        let mut left: Vec<Vec<f32>> = thing.slices.iter().map(|c| c.l.clone()).collect();
        left.push(thing.preview.l.clone());
        left.push(thing.ratchet.l.clone());
        self.built = Built { starts: page.slices.iter().map(|x| x.s).collect(), preview, ratchet, left };
        let (from, to) = (page.rate as u32, self.engine_rate);
        if from != to && from > 0 && to > 0 {
            let conv = |c: &mut chop::Clip| {
                c.l = mgl_engine::resample(&c.l, 1, from, to);
                c.r = mgl_engine::resample(&c.r, 1, from, to);
            };
            for c in thing.slices.iter_mut() {
                conv(c);
            }
            conv(&mut thing.preview);
            conv(&mut thing.ratchet);
        }
        thing
    }

    /// The engine's frames as the file's.
    fn file_frames(&self, pos: i64) -> f64 {
        match &self.page {
            Some(p) if self.engine_rate > 0 => pos as f64 * p.rate / self.engine_rate as f64,
            _ => pos as f64,
        }
    }

    /// What the module plays now: its kind (`""`, `slice`, `preview`,
    /// `ratchet`), and where in the sound (`chopPlayhead`), or -1.
    pub fn playhead(&self) -> (&'static str, f64) {
        let now: PlayingNow = self.playing.read();
        let b = &self.built;
        let in_map = |map: &[Placed], t: f64| -> f64 {
            for m in map {
                if t >= m.at as f64 && t < (m.at + m.len) as f64 {
                    return m.s as f64 + (t - m.at as f64) / m.k;
                }
            }
            -1.0
        };
        match now.transport {
            1 => ("preview", in_map(&b.preview, self.file_frames(now.transport_pos))),
            2 => {
                let len = b.left.last().map_or(0, Vec::len) as f64;
                let t = self.file_frames(now.transport_pos);
                ("ratchet", in_map(&b.ratchet, if len > 0.0 { t % len } else { t }))
            }
            _ if now.slice_on => {
                let i = now.slice as usize;
                let t = self.file_frames(now.slice_pos);
                let len = b.left.get(i).map_or(0, Vec::len) as f64;
                match b.starts.get(i) {
                    Some(&s) if t < len => ("slice", s as f64 + t),
                    Some(_) => ("slice", -1.0),
                    None => ("slice", -1.0),
                }
            }
            _ => ("", -1.0),
        }
    }

    /// `chopDrawOut`'s samples: what plays now, channel 0, from where it has
    /// got to, wrapping a looped one. How many; 0 when nothing plays.
    pub fn out(&self, out: &mut [f32]) -> usize {
        let now = self.playing.read();
        let b = &self.built;
        let n = b.left.len();
        let (clip, pos, looped) = match now.transport {
            1 if n >= 2 => (&b.left[n - 2], now.transport_pos, false),
            2 if n >= 1 => (&b.left[n - 1], now.transport_pos, true),
            _ if now.slice_on => match b.left.get(now.slice as usize) {
                Some(c) if (now.slice as usize) < n.saturating_sub(2) => (c, now.slice_pos, false),
                _ => return 0,
            },
            _ => return 0,
        };
        let at = self.file_frames(pos).floor() as i64;
        let len = clip.len() as i64;
        for (k, o) in out.iter_mut().enumerate() {
            let j = at + k as i64;
            let j = if looped && len > 0 { j.rem_euclid(len) } else { j };
            *o = if j >= 0 && j < len { clip[j as usize] } else { 0.0 };
        }
        out.len()
    }

    /// How many analysis frames there are, and one array (`which` 0 low, 1
    /// mid, 2 high, 3 cent, 4 flat, 5 zcr, 6 rms, 7 rise, 8 hz, 9 clar).
    pub fn analysis(&self, which: u32) -> Option<&[f32]> {
        let an = self.an.as_ref()?;
        Some(match which {
            0 => &an.low,
            1 => &an.mid,
            2 => &an.high,
            3 => &an.cent,
            4 => &an.flat,
            5 => &an.zcr,
            6 => &an.rms,
            7 => &an.rise,
            8 => &an.hz,
            9 => &an.clar,
            _ => return None,
        })
    }

    /// Slice `i`'s first channel as it sounds now (`chopSliceAudio(i)`).
    pub fn render(&mut self, i: usize) -> Option<&[f32]> {
        let page = self.page.as_ref()?;
        if i >= page.slices.len() {
            return None;
        }
        let fresh = matches!(&self.render_cache, Some((s, k, _)) if *s == self.serial && *k == i);
        if !fresh {
            let c = page.slice_audio(i, 0).into_iter().next().unwrap_or_default();
            self.render_cache = Some((self.serial, i, c));
        }
        self.render_cache.as_ref().map(|(_, _, c)| c.as_slice())
    }

    /// The tempo numbers: `chopBpm`, `chopPlayBpm`, `chopStepBeats`.
    pub fn tempos(&self) -> (f64, f64, f64) {
        let s = settings_of(self.cp());
        match &self.page {
            Some(p) => (p.bpm(), p.play_bpm(), p.step_beats()),
            None => {
                let probe = Page { settings: s.clone(), ..empty_page() };
                let play = if s.tempo > 0.0 { s.tempo } else { 120.0 };
                (120.0, play, probe.step_beats())
            }
        }
    }

    /// The state, as `na_chop_call` answers it.
    pub fn state_json(&self) -> Value {
        let (bpm, play, step) = self.tempos();
        let sound = self.page.as_ref().map(|p| {
            json!({
                "name": self.facts.name, "stem": self.facts.stem, "path": self.facts.path, "kind": self.facts.kind,
                "rate": p.rate, "len": p.len, "channels": p.channels.len(), "bits": self.facts.bits, "format": self.facts.format,
                "serial": self.sound_serial,
            })
        });
        let slices: Vec<Value> = match &self.page {
            Some(p) => p.slices.iter().enumerate().map(|(i, x)| json!([x.s, x.e, flags_of(x), self.measures.get(i).map_or("", |m| m.kind)])).collect(),
            None => Vec::new(),
        };
        let an = self.an.as_ref().map(|a| json!({ "pulse": a.pulse, "hits": a.hits, "F": a.frames, "HOP": a.hop, "N": a.n }));
        let (kind, _) = self.playhead();
        json!({
            "serial": self.serial,
            "sound": sound,
            "cp": self.cp(),
            "which": if self.b { "b" } else { "a" },
            "preset": self.preset,
            "tag": preset_tag(self.cp()),
            "region": self.page.as_ref().map_or([0, 0], |p| [p.region.0, p.region.1]),
            "slices": slices,
            "current": self.page.as_ref().map_or(-1, |p| p.current),
            "sel": self.page.as_ref().map_or(Vec::new(), |p| p.sel.clone()),
            "an": an,
            "analysing": self.analysing(),
            "bpm": bpm, "playBpm": play, "stepBeats": step,
            "tempoSaid": self.said,
            "playing": kind,
            "ui": self.ui,
        })
    }
}

/// A Page with no sound, for its arithmetic on settings alone.
fn empty_page() -> Page {
    Page { channels: Vec::new(), rate: 1.0, len: 0, mono: Vec::new(), rms: Vec::new(), region: (0, 0), settings: Settings::default(), slices: Vec::new(), seq_tempo: None, sel: Vec::new(), current: -1 }
}

/// A number as the page would hold it: whole numbers as integers.
pub fn num_json(v: f64) -> Value {
    if v.fract() == 0.0 && v.abs() < 9e15 {
        json!(v as i64)
    } else {
        json!(v)
    }
}
