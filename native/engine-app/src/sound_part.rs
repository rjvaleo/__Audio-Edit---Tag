//! The Sound module: one sound and everything done to it.
//!
//! It holds MGL's document for one file (`engine_mgl::Document`: the file and
//! its edit list; nothing is ever written to the file), the markers and
//! regions on it, and its clipboard. Its cable carries the edited sound to
//! whatever is plugged in (Edit now; Grain, Chop and Prism later), so an edit
//! made in Edit is heard wherever the sound goes, as in MGL, where Edit and
//! Grain work on one document.
//!
//! The edits are MGL's `/api/edit`, op for op
//! (`core/crates/server-engine/src/routes/edit_view.rs`, `api_edit_apply`):
//! the same reading of the message, the same snap, the same measurements
//! before the edit, the same calls into MGL's `edit` crate, and the same
//! answer. Where MGL measures through the document's rack (Grain's), this
//! document has none, so it measures through an empty one, which is what MGL
//! does for a sound with nothing in its rack. Grain's stretch op comes with
//! Grain.
//!
//! What the Edit page reads from the sound is made here too, as MGL's server
//! and page make it: the peaks of the edited timeline (`/api/peaks?clips=1`),
//! the spectrogram (`/api/spectrogram`, of the file as it is, as MGL draws
//! it), the measures (`/api/measure`), and the page's own measures of the
//! document's samples (`ui/app/411-edit-sound.js`: Chop's analysis, the hits,
//! the loud spots, the levels, the zero crossings), from the same samples the
//! page decodes (`/audio?dry=1`).

use crate::annot::{Annotations, Span};
use audio_core::{Reader, SliceSource};
use engine_core::{Controller, EventKind, ModuleId, SoundRef};
use engine_mgl::chop::listen::{self, Analysis};
use engine_mgl::Document;
use mgl_edit::{snap::SnapUnit, Clip, EditList, FadeShape, Range};
use serde_json::{json, Map, Value};
use std::sync::mpsc;
use std::sync::Arc;

type Bytes = Arc<[u8]>;
type Src = SliceSource<Bytes>;

/// What the page measured from the document's own samples (411).
pub struct Measured {
    pub rate: u32,
    pub mono: Vec<f32>,
    pub an: Analysis,
    pub hits: Vec<u64>,
    /// (where, its level in dB)
    pub loud: Vec<(f64, f64)>,
}

pub struct SoundPart {
    origin: Value,
    bytes: Option<Bytes>,
    doc: Option<Document<Src>>,
    /// Why it is silent, when its file could not be had.
    missing: Option<String>,
    /// Every edit made, in order, for the patch: replayed on load, it gives
    /// the same document, the same undo history and the same clipboard.
    ops: Vec<Value>,
    pub annotations: Annotations,
    clipboard: Option<Vec<Clip>>,
    /// The edited timeline at the file's rate, interleaved in its channels
    /// (`/api/peaks?clips=1`'s frames).
    dry: Vec<f32>,
    measured: Option<Arc<Measured>>,
    measuring: Option<mpsc::Receiver<Measured>>,
    /// Bumped whenever the sound changes, so a face knows to read it again.
    pub serial: u64,
    sound: SoundRef,
}

fn num(v: &Value, k: &str) -> u64 {
    match v.get(k).and_then(Value::as_f64) {
        Some(n) if n >= 0.0 => n as u64,
        _ => 0,
    }
}

fn float(v: &Value, k: &str, d: f32) -> f32 {
    match v.get(k).and_then(Value::as_f64) {
        Some(n) => n as f32,
        None => d,
    }
}

/// The rack MGL measures this document through: its factory chain, for the
/// file's rate and channels (`mgl_rack.rs`).
fn rack_for(reader: &Reader<Src>) -> mgl_fx::Rack {
    let i = reader.info();
    crate::mgl_rack::factory(i.sample_rate, i.channels as usize)
}

/// Pull one position onto the nearest zero crossing (MGL's `snap_to_zero`).
fn snap_to_zero(list: &EditList, reader: &mut Reader<Src>, rack: &mut mgl_fx::Rack, pos: u64, radius: u64) -> u64 {
    let total = list.frames();
    let channels = list.channels.max(1) as usize;
    let from = pos.saturating_sub(radius);
    let count = (pos + radius + 1).min(total).saturating_sub(from);
    if count < 2 {
        return pos;
    }
    match mgl_edit::render::render_fx(list, reader, rack, from, count) {
        Ok(buf) => mgl_edit::snap::nearest_zero_crossing(&buf, channels, from, pos, radius).unwrap_or(pos),
        Err(_) => pos,
    }
}

impl SoundPart {
    pub fn empty() -> SoundPart {
        SoundPart {
            origin: Value::Null,
            bytes: None,
            doc: None,
            missing: None,
            ops: Vec::new(),
            annotations: Annotations::default(),
            clipboard: None,
            dry: Vec::new(),
            measured: None,
            measuring: None,
            serial: 0,
            sound: SoundRef::default(),
        }
    }

    /// Open `bytes` (a WAV or AIFF file) for an engine at `rate`. `origin` is
    /// where it came from, as the patch keeps it.
    pub fn open(&mut self, bytes: Bytes, origin: Value, rate: u32) -> Result<(), String> {
        let doc = Document::open(SliceSource::new(bytes.clone()), rate).map_err(|e| format!("{e}"))?;
        let mut origin = origin;
        if let Some(o) = origin.as_object_mut() {
            o.insert("bytes".into(), (bytes.len() as u64).into());
            o.insert("check".into(), format!("{:016x}", fnv(&bytes)).into());
        }
        *self = SoundPart { serial: self.serial + 1, sound: self.sound, ..SoundPart::empty() };
        self.origin = origin;
        self.bytes = Some(bytes);
        self.doc = Some(doc);
        self.rebuild();
        Ok(())
    }

    /// A sound whose file could not be had: silent, saying why, keeping
    /// where it came from and what was done to it for when it is found.
    pub fn lose(&mut self, origin: Value, ops: Vec<Value>, annotations: Annotations, why: String) {
        *self = SoundPart { serial: self.serial + 1, sound: self.sound, ..SoundPart::empty() };
        self.origin = origin;
        self.ops = ops;
        self.annotations = annotations;
        self.missing = Some(why);
    }

    pub fn is_open(&self) -> bool {
        self.doc.is_some()
    }

    pub fn origin(&self) -> &Value {
        &self.origin
    }

    pub fn ops(&self) -> &[Value] {
        &self.ops
    }

    pub fn list(&self) -> Option<&EditList> {
        self.doc.as_ref().map(|d| d.list())
    }

    /// The file's own rate (the timeline's).
    pub fn file_rate(&self) -> u32 {
        self.list().map_or(0, |l| l.sample_rate)
    }

    pub fn channels(&self) -> usize {
        self.list().map_or(0, |l| l.channels.max(1) as usize)
    }

    /// Frames on the edited timeline.
    pub fn frames(&self) -> u64 {
        self.list().map_or(0, |l| l.frames())
    }

    /// The edited timeline's samples, interleaved, at the file's rate.
    pub fn dry(&self) -> &[f32] {
        &self.dry
    }

    pub fn measured(&self) -> Option<&Arc<Measured>> {
        self.measured.as_ref()
    }

    /// The document now, as MGL's `/api/edit` answers (`docs::edit_json`),
    /// with the clipboard's length and what the Sound module shows.
    pub fn edit_json(&self) -> Value {
        let Some(doc) = &self.doc else {
            return json!({ "open": false, "missing": self.missing, "origin": self.origin });
        };
        let l = doc.list();
        let s = doc.session();
        let clips: Vec<Value> = l
            .clips
            .iter()
            .map(|c| json!({ "srcStart": c.src_start, "len": c.len, "gain": c.gain, "fadeIn": c.fade_in.frames, "fadeOut": c.fade_out.frames, "reversed": c.reversed }))
            .collect();
        json!({
            "open": true,
            "origin": self.origin,
            "frames": l.frames(),
            "baseFrames": l.base_frames(),
            "sourceFrames": l.source_frames,
            "duration": l.duration_secs(),
            "sampleRate": l.sample_rate,
            "channels": l.channels,
            "edited": !l.is_identity(),
            "stretch": { "ratio": l.stretch.ratio, "semitones": l.stretch.semitones, "active": l.is_stretched() },
            "clips": clips,
            "canUndo": s.can_undo(),
            "canRedo": s.can_redo(),
            "clipboard": self.clipboard.as_ref().map_or(0, |c| c.iter().map(|c| c.len).sum::<u64>()),
            "serial": self.serial,
        })
    }

    /// One of MGL's edit ops, as `/api/edit` takes it. Its answer, as
    /// `/api/edit` gives it; `changed` is whether the sound is now different.
    pub fn apply(&mut self, v: &Value) -> Result<(Value, bool), String> {
        let doc = self.doc.as_mut().ok_or("Open a sound first")?;
        let op = v.get("op").and_then(Value::as_str).unwrap_or("");
        let shape = if v.get("shape").and_then(Value::as_str) == Some("linear") { FadeShape::Linear } else { FadeShape::EqualPower };
        let unit = SnapUnit::from_str(v.get("snap").and_then(Value::as_str).unwrap_or("off"));
        let (asked_start, asked_end) = (num(v, "start"), num(v, "end"));
        let before = doc.list().clone();
        let (session, reader) = doc.parts();
        let list = session.list().clone();
        let (start, end) = match unit {
            SnapUnit::Off => (asked_start, asked_end),
            SnapUnit::Grid(n) => (mgl_edit::snap::snap_grid(asked_start, n), mgl_edit::snap::snap_grid(asked_end, n)),
            SnapUnit::ZeroCrossing => {
                // One measuring, one rack, as MGL's: both ends through it.
                let mut rack = rack_for(reader);
                let radius = mgl_edit::snap::radius_frames(list.sample_rate);
                let a = snap_to_zero(&list, reader, &mut rack, asked_start, radius);
                (a, snap_to_zero(&list, reader, &mut rack, asked_end, radius))
            }
        };
        let range = Range::new(start, end);

        // What must read the audio before it can decide, as MGL measures it.
        let measured_peak = (op == "normalize")
            .then(|| {
                let mut rack = rack_for(reader);
                mgl_edit::render::measure_peak_fx(&list, reader, &mut rack).ok()
            })
            .flatten();
        let measured_level = (op == "normalizeRms")
            .then(|| {
                let mut rack = rack_for(reader);
                mgl_edit::analyse::measure_level(&list, reader, &mut rack, range).ok()
            })
            .flatten();
        let silent_runs = (op == "stripSilence")
            .then(|| {
                let rate = list.sample_rate.max(1);
                let ms = |k: &str, d: f32| -> u64 { (float(v, k, d).max(0.0) / 1000.0 * rate as f32) as u64 };
                let params = mgl_edit::analyse::StripParams {
                    threshold_db: float(v, "thresholdDb", -40.0).clamp(-90.0, 0.0),
                    min_frames: ms("minMs", 100.0),
                    pad_frames: ms("padMs", 10.0),
                    hop: mgl_edit::analyse::envelope_frames(rate),
                };
                let mut rack = rack_for(reader);
                mgl_edit::analyse::silent_runs(&list, reader, &mut rack, range, &params).ok()
            })
            .flatten();
        let click_cut = (op == "repairClick")
            .then(|| {
                let mut rack = rack_for(reader);
                let (at, _) = mgl_edit::analyse::find_click(&list, reader, &mut rack, range).ok()??;
                let rate = list.sample_rate.max(1);
                let half = ((float(v, "widthMs", 1.0).clamp(0.05, 50.0) / 2000.0) * rate as f32).max(1.0) as u64;
                let radius = (half / 2).max(1);
                let lo = at.saturating_sub(half);
                let hi = (at + half).min(list.frames());
                let a = snap_to_zero(&list, reader, &mut rack, lo, radius);
                let b = snap_to_zero(&list, reader, &mut rack, hi, radius);
                let (a, b) = if b > a { (a, b) } else { (lo, hi) };
                Some((Range::new(a, b), radius))
            })
            .flatten();
        let pasting = if op == "paste" {
            match self.clipboard.as_ref() {
                Some(clips) => Some(clips.clone()),
                None => return Err("nothing has been copied".into()),
            }
        } else {
            None
        };
        let mut copied: Option<Vec<Clip>> = None;
        let s = session;
        match op {
            "copy" => copied = Some(s.list().copy(range)),
            "cut" => {
                copied = Some(s.list().copy(range));
                s.apply(|l| l.cut(range));
            }
            "delete" => {
                s.apply(|l| l.cut(range));
            }
            "paste" => {
                if let Some(clips) = pasting.as_ref() {
                    s.apply(|l| l.paste(start, Some(range), clips));
                }
            }
            "silence" => {
                s.apply(|l| l.silence(range));
            }
            "gain" => {
                let db = float(v, "db", 0.0);
                s.apply(|l| l.gain_db(range, db));
            }
            "fadeIn" => {
                let n = num(v, "frames");
                s.apply(|l| l.fade_in(range, n, shape));
            }
            "fadeOut" => {
                let n = num(v, "frames");
                s.apply(|l| l.fade_out(range, n, shape));
            }
            "reverse" => {
                s.apply(|l| l.reverse(range));
            }
            "split" => {
                let p = num(v, "pos");
                s.apply(|l| {
                    l.split_at(p);
                });
            }
            "crop" => {
                s.apply(|l| l.crop(range));
            }
            "duplicate" => {
                let n = num(v, "count").clamp(1, 128) as u32;
                s.apply(|l| l.duplicate(range, n));
            }
            "insertSilence" => {
                let frames = if v.get("frames").is_some() {
                    num(v, "frames")
                } else {
                    let rate = s.list().sample_rate.max(1) as f32;
                    (float(v, "ms", 0.0).max(0.0) / 1000.0 * rate) as u64
                };
                s.apply(|l| l.insert_silence(start, frames));
            }
            "normalize" => {
                if let Some(peak) = measured_peak {
                    let target = float(v, "db", -0.3);
                    s.apply(|l| l.normalize(peak, target));
                }
            }
            "normalizeRms" => {
                if let Some((peak, rms)) = measured_level {
                    let target = float(v, "db", -12.0).clamp(-60.0, 0.0);
                    let ceiling = float(v, "ceilingDb", -0.3).clamp(-60.0, 0.0);
                    s.apply(|l| l.normalize_rms(rms, peak, target, ceiling));
                }
            }
            "stripSilence" => {
                if let Some(runs) = silent_runs.as_ref() {
                    let mode = match v.get("mode").and_then(Value::as_str) {
                        Some("silence") => mgl_edit::analyse::StripMode::Silence,
                        _ => mgl_edit::analyse::StripMode::Remove,
                    };
                    s.apply(|l| l.strip_silence(runs, mode));
                }
            }
            "repairClick" => {
                if let Some((cut, taper)) = click_cut {
                    s.apply(|l| l.repair_click(cut, taper));
                }
            }
            "undo" => {
                s.undo();
            }
            "redo" => {
                s.redo();
            }
            "revert" => s.revert(),
            _ => return Err(format!("unknown edit operation: {op}")),
        }
        if let Some(clips) = copied.filter(|c| !c.is_empty()) {
            self.clipboard = Some(clips);
        }
        self.ops.push(v.clone());
        let changed = *self.doc.as_ref().map(|d| d.list()).unwrap() != before;
        if changed {
            self.rebuild();
        }
        let mut out = self.edit_json();
        if unit != SnapUnit::Off {
            if let Some(o) = out.as_object_mut() {
                o.insert("snapped".into(), json!({ "start": start, "end": end, "unit": unit.as_str() }));
            }
        }
        Ok((out, changed))
    }

    /// Markers and regions: `{"op":"set", markers, regions}` puts them as
    /// given (`/api/markers`); any other op is Peak's (`/api/annot`).
    pub fn annot(&mut self, v: &Value) -> Result<Value, String> {
        let op = v.get("op").and_then(Value::as_str).unwrap_or("");
        let span = Span::new(num(v, "start"), num(v, "end"));
        let total = self.frames();
        let signed = |k: &str| -> i64 {
            match v.get(k).and_then(Value::as_f64) {
                Some(n) if n.is_finite() => n as i64,
                _ => 0,
            }
        };
        let text = |k: &str| -> &str { v.get(k).and_then(Value::as_str).unwrap_or("") };
        let flag = |k: &str| -> bool { v.get(k).and_then(Value::as_bool) == Some(true) };
        let a = &mut self.annotations;
        match op {
            "set" => *a = Annotations::from_json(v),
            "markersToRegions" => a.markers_to_regions(span, flag("each")),
            "splitRegion" => a.split_region(num(v, "pos"), total),
            "nudge" => a.nudge(span, signed("frames")),
            "deleteMarkers" => a.delete_in(span),
            "rename" => {
                let contains = v.get("contains").and_then(Value::as_str);
                let (m, r) = (flag("markers"), flag("regions"));
                let (m, r) = if m || r { (m, r) } else { (true, false) };
                a.rename(span, text("to"), text("startAt"), contains, m, r);
            }
            _ => return Err(format!("unknown annotation operation: {op}")),
        }
        Ok(self.annotations.to_json())
    }

    /// `/api/measure`: the level of a range, its peak and its worst click.
    pub fn measure(&mut self, start: u64, end: u64) -> Option<Value> {
        let doc = self.doc.as_mut()?;
        let list = doc.list().clone();
        let range = Range::new(start, end);
        let r = doc.reader();
        // One measuring, one rack, as `/api/measure`'s.
        let mut rack = rack_for(r);
        let (peak, rms) = mgl_edit::analyse::measure_level(&list, r, &mut rack, range).ok()?;
        let peak_at = mgl_edit::analyse::find_peak(&list, r, &mut rack, range).ok()?;
        let click = mgl_edit::analyse::find_click(&list, r, &mut rack, range).ok()?;
        let db = |x: f32| -> f64 { if x <= 0.0 { -144.0 } else { 20.0 * (x as f64).log10() } };
        let mut o = Map::new();
        o.insert("peak".into(), (peak as f64).into());
        o.insert("peakDb".into(), db(peak).into());
        o.insert("rms".into(), (rms as f64).into());
        o.insert("rmsDb".into(), db(rms).into());
        o.insert("frames".into(), list.frames().into());
        o.insert("sampleRate".into(), (list.sample_rate as f64).into());
        if let Some((frame, value)) = peak_at {
            o.insert("peakFrame".into(), frame.into());
            o.insert("peakValue".into(), (value as f64).into());
        }
        if let Some((frame, dev)) = click {
            o.insert("clickFrame".into(), frame.into());
            o.insert("clickDeviation".into(), (dev as f64).into());
        }
        Some(Value::Object(o))
    }

    /// `/api/peaks?clips=1&from&to&cols`: each channel's min, max and RMS in
    /// `columns` columns over `[from, to)`, as `peak_tile` makes them, into
    /// `out` as [channel][min, max, rms][column]. Returns (columns, channels,
    /// from, to) as clamped.
    pub fn peaks(&self, from: u64, to: u64, columns: usize, out: &mut Vec<f32>) -> (usize, usize, u64, u64) {
        out.clear();
        let channels = self.channels();
        let total = self.frames();
        if channels == 0 {
            return (0, 0, 0, 0);
        }
        let to = if to == 0 { total } else { to.min(total) };
        let start = from.min(total);
        let count = to.saturating_sub(start);
        let columns = columns.clamp(1, 8192).max(1).min(count.max(1) as usize);
        let mut mins = vec![f32::INFINITY; columns * channels];
        let mut maxs = vec![f32::NEG_INFINITY; columns * channels];
        let mut sums = vec![0f64; columns * channels];
        let mut counts = vec![0u64; columns];
        for f in 0..count {
            let col = ((f as u128 * columns as u128) / count.max(1) as u128) as usize;
            let col = col.min(columns - 1);
            counts[col] += 1;
            let base = ((start + f) as usize) * channels;
            for ch in 0..channels {
                let v = self.dry.get(base + ch).copied().unwrap_or(0.0);
                let idx = ch * columns + col;
                if v < mins[idx] {
                    mins[idx] = v;
                }
                if v > maxs[idx] {
                    maxs[idx] = v;
                }
                sums[idx] += (v as f64) * (v as f64);
            }
        }
        out.reserve(columns * channels * 3);
        for ch in 0..channels {
            for (k, which) in [0, 1, 2].iter().enumerate() {
                let _ = k;
                for col in 0..columns {
                    let idx = ch * columns + col;
                    let n = counts[col];
                    out.push(if n == 0 {
                        0.0
                    } else {
                        match which {
                            0 => if mins[idx].is_finite() { mins[idx] } else { 0.0 },
                            1 => if maxs[idx].is_finite() { maxs[idx] } else { 0.0 },
                            _ => (sums[idx] / n as f64).sqrt() as f32,
                        }
                    });
                }
            }
        }
        (columns, channels, start, start + count)
    }

    /// `/api/spectrogram`: of the file as it is (as MGL draws it), one byte a
    /// cell, bins of column 0 first. (columns, bins, maxHz).
    pub fn spectrogram(&mut self, from: u64, to: u64, columns: usize, fft: usize, out: &mut Vec<u8>) -> Option<(usize, usize, f32)> {
        let doc = self.doc.as_mut()?;
        let r = doc.reader();
        let frames = r.info().frames();
        let to = if to == 0 { frames } else { to.min(frames) };
        let s = r.spectrogram(from, to.saturating_sub(from), columns.clamp(1, 2048), fft.clamp(64, 8192)).ok()?;
        out.clear();
        out.extend_from_slice(&s.data);
        Some((s.columns, s.bins, s.max_hz))
    }

    /// The edited sound as a WAV file, as MGL's edit crate writes one
    /// (`wav_bytes`): 16 or 24-bit, or 32-bit float.
    pub fn wav(&mut self, bits: u16) -> Option<Vec<u8>> {
        let doc = self.doc.as_mut()?;
        let list = doc.list().clone();
        let total = mgl_edit::render::wav_stream_len(&list, bits);
        mgl_edit::render::wav_bytes(&list, doc.reader(), 0, total.saturating_sub(1), bits).ok()
    }

    /// Render again what the edits change: the timeline's samples, the
    /// page's measures of them (on a helper thread), and the sound handed to
    /// the engine (on the next [`SoundPart::hand_over`]).
    fn rebuild(&mut self) {
        self.serial += 1;
        self.dry.clear();
        self.measured = None;
        let Some(doc) = self.doc.as_mut() else { return };
        let list = doc.list().clone();
        let channels = list.channels.max(1) as usize;
        let identity = list.clips.len() == 1 && list.clips[0] == Clip::new(0, list.source_frames);
        let mut plain = list.clone();
        plain.stretch = Default::default();
        self.dry = mgl_edit::render::render(&plain, doc.reader(), 0, plain.base_frames()).unwrap_or_default();
        // What the page decodes from `/audio?dry=1`: the file as it is when
        // its clips are the whole file, else the edited clips as 16-bit WAV.
        let rate = list.sample_rate;
        let frames = self.dry.len() / channels;
        let mut mono = vec![0.0f32; frames];
        for c in 0..channels {
            for (i, m) in mono.iter_mut().enumerate() {
                let x = self.dry[i * channels + c];
                let d = if identity { x } else { ((x.clamp(-1.0, 1.0) * 32767.0) as i16) as f32 / 32768.0 };
                *m = (*m as f64 + d as f64 / channels as f64) as f32;
            }
        }
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let an = listen::analyse(&mono, rate as f64);
            let hits = find_hits(&an, rate);
            let loud = find_loud(&an, rate);
            let _ = tx.send(Measured { rate, mono, an, hits, loud });
        });
        self.measuring = Some(rx);
    }

    /// Take the page's measures once they are made. True if they came now.
    pub fn take_measured(&mut self) -> bool {
        let Some(rx) = &self.measuring else { return false };
        match rx.try_recv() {
            Ok(m) => {
                self.measured = Some(Arc::new(m));
                self.measuring = None;
                self.serial += 1;
                true
            }
            Err(mpsc::TryRecvError::Empty) => false,
            Err(mpsc::TryRecvError::Disconnected) => {
                self.measuring = None;
                false
            }
        }
    }

    /// Wait for the page's measures (tests and offline renders).
    pub fn wait_measured(&mut self) {
        if let Some(rx) = self.measuring.take() {
            if let Ok(m) = rx.recv() {
                self.measured = Some(Arc::new(m));
                self.serial += 1;
            }
        }
    }

    /// Put the edited sound in the engine's bank under `bank`, and point the
    /// module's source at it.
    pub fn hand_over(&mut self, ctl: &mut Controller, bank: u32, source: ModuleId) -> Result<(), engine_core::PatchError> {
        let Some(doc) = self.doc.as_mut() else {
            self.sound = SoundRef::default();
            ctl.send(source, EventKind::Sound { slot: 0, sound: self.sound })?;
            return Ok(());
        };
        // The timeline rendered for the page's samples is the one the bank
        // plays, at the engine's rate: rendered once, not twice.
        let data = doc.sound_from(&self.dry);
        self.sound = ctl.load_sound(bank, data)?;
        ctl.send(source, EventKind::Sound { slot: 0, sound: self.sound })?;
        Ok(())
    }

    /// The patch's record of it: where it came from, the edits, the markers.
    pub fn state(&self) -> Value {
        json!({ "origin": self.origin, "ops": self.ops, "annotations": self.annotations.to_json() })
    }

    /// Replay saved edits onto a just-opened document.
    pub fn replay(&mut self, ops: &[Value]) {
        for op in ops {
            let _ = self.apply(op);
        }
    }
}

/// FNV-1a, 64 bits: a check that a file is the one the patch was made with.
fn fnv(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

// ── the page's own measures (ui/app/411-edit-sound.js) ──────────────────────

/// `edFindHits`: a frame's energy well over the four before it, loud enough to
/// matter, at most one every 50 ms.
pub fn find_hits(an: &Analysis, rate: u32) -> Vec<u64> {
    let (rms, hop, f_count) = (&an.rms, an.hop, an.rms.len());
    let mut top = 0.0f64;
    for f in 0..f_count {
        top = top.max(rms[f] as f64);
    }
    let mut out = Vec::new();
    let sr = if rate == 0 { 44100.0 } else { rate as f64 };
    let gap = ((0.05 * sr / hop as f64).round()).max(1.0) as i64;
    let mut last: i64 = -1_000_000_000;
    for f in 4..f_count {
        let before = (rms[f - 1] as f64 + rms[f - 2] as f64 + rms[f - 3] as f64 + rms[f - 4] as f64) / 4.0;
        let x = rms[f] as f64;
        if x > before * 1.8 && x > top * 0.06 && f as i64 - last >= gap {
            out.push((f * hop) as u64);
            last = f as i64;
        }
    }
    out
}

/// `edFindLoud`: a quarter of a second at a time, those within 3 dB of the
/// loudest and above -40 dB. (where, dB)
pub fn find_loud(an: &Analysis, rate: u32) -> Vec<(f64, f64)> {
    let (rms, hop, f_count) = (&an.rms, an.hop, an.rms.len());
    let sr = if rate == 0 { 44100.0 } else { rate as f64 };
    let w = ((0.25 * sr / hop as f64).round()).max(1.0) as usize;
    let mut win = Vec::new();
    let mut f = 0;
    while f + w <= f_count {
        let mut s = 0.0f64;
        for k in 0..w {
            s += (rms[f + k] as f64).powi(2);
        }
        win.push(((f as f64 + w as f64 / 2.0) * hop as f64, 10.0 * (s / w as f64 + 1e-12).log10()));
        f += w;
    }
    let top = win.iter().fold(-120.0f64, |m, x| m.max(x.1));
    win.into_iter().filter(|x| x.1 > top - 3.0 && x.1 > -40.0).collect()
}

/// Chop's Spectrum colours: low violet, mid green, high white (403).
pub const CHOP_LOW: [f64; 3] = [132.0, 104.0, 255.0];
pub const CHOP_MID: [f64; 3] = [32.0, 236.0, 168.0];
pub const CHOP_HIGH: [f64; 3] = [255.0, 255.0, 255.0];

/// `edColourAt`: the colour of the sound at a frame, from its bands.
pub fn colour_at(an: &Analysis, frame: f64) -> [f64; 3] {
    let n = an.low.len();
    if n == 0 {
        return CHOP_MID;
    }
    let f = (frame / an.hop as f64).floor().clamp(0.0, (n - 1) as f64) as usize;
    let (l, m, h) = ((an.low[f] as f64).powi(2), (an.mid[f] as f64).powi(2), (an.high[f] as f64).powi(2));
    let t = l + m + h + 1e-9;
    let mix = |i: usize| (CHOP_LOW[i] * l + CHOP_MID[i] * m + CHOP_HIGH[i] * h) / t;
    [mix(0), mix(1), mix(2)]
}

/// `edLevels`: peak and RMS of `[a, b)` of the mono, in dB.
pub fn levels(mono: &[f32], a: f64, b: f64) -> Option<(f64, f64)> {
    let a = (a as i64).max(0) as usize;
    let b = ((b as i64).max(0) as usize).min(mono.len());
    if b <= a {
        return None;
    }
    let (mut pk, mut sq) = (0.0f64, 0.0f64);
    let step = ((b - a) / 400000).max(1);
    let mut i = a;
    while i < b {
        let v = (mono[i] as f64).abs();
        if v > pk {
            pk = v;
        }
        sq += v * v;
        i += step;
    }
    let db = |x: f64| if x > 1e-9 { 20.0 * x.log10() } else { -120.0 };
    Some((db(pk), db((sq / ((b - a) as f64 / step as f64).ceil()).sqrt())))
}

/// `edNearestHit`: the nearest hit within `reach` frames.
pub fn nearest_hit(hits: &[u64], frame: i64, reach: i64) -> Option<u64> {
    let (mut best, mut bd) = (None, reach);
    for &h in hits {
        let d = (h as i64 - frame).abs();
        if d < bd {
            bd = d;
            best = Some(h);
        }
    }
    best
}

/// `edNearestZero`: the nearest zero crossing within `reach`, or the frame.
pub fn nearest_zero(mono: &[f32], frame: i64, reach: i64) -> i64 {
    for k in 0..reach {
        for j in [frame + k, frame - k] {
            if j > 0 && (j as usize) < mono.len() {
                let (p, q) = (mono[j as usize - 1], mono[j as usize]);
                if (p <= 0.0) != (q <= 0.0) {
                    return if p.abs() < q.abs() { j - 1 } else { j };
                }
            }
        }
    }
    frame
}
