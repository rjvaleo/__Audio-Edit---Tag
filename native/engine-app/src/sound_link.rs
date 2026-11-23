//! The Sound and Edit modules on the canvas: opening a sound, its cable into
//! Edit, and everything Edit asks of the sound on that cable. Kept apart from
//! `lib.rs`, which only names the two kinds and their parts.

use crate::edit_part::{from_bank, to_bank};
use crate::sound_part::{self, SoundPart};
use crate::{engine_id, AppError, Part, Session};
use serde_json::{json, Value};
use std::sync::Arc;

fn bad(why: impl Into<String>) -> AppError {
    AppError::BadFile(why.into())
}

/// A saved Sound module, opened again: its file read from where it was
/// kept, its edits replayed, its markers put back. A file that can't be had
/// leaves it silent, saying so, with everything else kept.
pub(crate) fn restore(part: &mut SoundPart, state: &Value, rate: f32) {
    let origin = state.get("origin").cloned().unwrap_or(Value::Null);
    let ops = state.get("ops").and_then(Value::as_array).cloned().unwrap_or_default();
    let annotations = crate::annot::Annotations::from_json(state.get("annotations").unwrap_or(&Value::Null));
    if origin.is_null() {
        return;
    }
    let file = origin.get("file").and_then(Value::as_str).unwrap_or("");
    match std::fs::read(file) {
        Ok(bytes) => {
            let check = origin.get("check").and_then(Value::as_str).map(str::to_string);
            match part.open(Arc::from(bytes.into_boxed_slice()), origin.clone(), rate as u32) {
                Ok(()) => {
                    let now = part.origin().get("check").and_then(Value::as_str).map(str::to_string);
                    if check.is_some() && check != now {
                        // Another file in its place: its edits would cut the wrong sound.
                        part.lose(origin, ops, annotations, "the file has changed since this patch was saved".into());
                        return;
                    }
                    part.replay(&ops);
                    part.annotations = annotations;
                }
                Err(e) => part.lose(origin, ops, annotations, e),
            }
        }
        Err(_) => part.lose(origin, ops, annotations, "file not found".into()),
    }
}

impl Session {
    fn sound_mut(&mut self, id: u32) -> Result<&mut SoundPart, AppError> {
        match self.modules.get_mut(&id).map(|m| &mut m.part) {
            Some(Part::Sound(s)) => Ok(s),
            _ => Err(AppError::NoSuchModule(id)),
        }
    }

    fn sound_ref(&self, id: u32) -> Result<&SoundPart, AppError> {
        match self.modules.get(&id).map(|m| &m.part) {
            Some(Part::Sound(s)) => Ok(s),
            _ => Err(AppError::NoSuchModule(id)),
        }
    }

    /// Hand Sound module `id`'s edited sound to the engine: into the bank
    /// under its own number, and onto its cable.
    pub(crate) fn sound_hand_over(&mut self, id: u32) -> Result<(), AppError> {
        if id == 0 || id as usize >= engine_core::MAX_SOUNDS {
            return Err(bad("too many modules for the sound bank"));
        }
        let Some(Part::Sound(s)) = self.modules.get_mut(&id).map(|m| &mut m.part) else { return Err(AppError::NoSuchModule(id)) };
        s.hand_over(&mut self.ctl, id, engine_id(id, 0))?;
        Ok(())
    }

    /// Take in what has been measured on a helper thread.
    pub(crate) fn sound_collect(&mut self) {
        for m in self.modules.values_mut() {
            if let Part::Sound(s) = &mut m.part {
                s.take_measured();
            }
        }
    }

    /// Wait for every sound's measures (tests and offline renders).
    pub fn sound_settle(&mut self) {
        for m in self.modules.values_mut() {
            if let Part::Sound(s) = &mut m.part {
                s.wait_measured();
            }
        }
    }

    /// Open the file at `path` in Sound module `id`. `origin` says where it
    /// came from (`{"kind": "file" | "library", "path", "name"}`); the file
    /// read is kept as `origin.file`. With `keep`, a sound that was lost
    /// (its file not found when its patch was loaded) takes back its edits
    /// and markers.
    pub fn sound_open(&mut self, id: u32, path: &str, origin: &Value, keep: bool) -> Result<Value, AppError> {
        let bytes = std::fs::read(path).map_err(|e| bad(format!("{path}: {e}")))?;
        let rate = self.rate as u32;
        let s = self.sound_mut(id)?;
        let (ops, annotations) = if keep { (s.ops().to_vec(), s.annotations.clone()) } else { (Vec::new(), Default::default()) };
        let mut origin = if origin.is_object() { origin.clone() } else { json!({ "kind": "file", "path": path }) };
        if let Some(o) = origin.as_object_mut() {
            o.insert("file".into(), path.into());
            if !o.contains_key("name") {
                let name = std::path::Path::new(path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                o.insert("name".into(), name.into());
            }
        }
        s.open(Arc::from(bytes.into_boxed_slice()), origin, rate).map_err(bad)?;
        if keep {
            s.replay(&ops);
            s.annotations = annotations;
        }
        self.sound_hand_over(id)?;
        self.sound_info(id)
    }

    /// Sound module `id` as its face shows it: the document, its markers.
    pub fn sound_info(&self, id: u32) -> Result<Value, AppError> {
        let s = self.sound_ref(id)?;
        let mut v = s.edit_json();
        if let Some(o) = v.as_object_mut() {
            o.insert("annotations".into(), s.annotations.to_json());
            o.insert("measured".into(), s.measured().is_some().into());
        }
        Ok(v)
    }

    /// Sound module `id`'s own edited timeline in `columns` columns, its first
    /// channel's min and max (its face's strip). How many columns.
    pub fn sound_peaks(&self, id: u32, columns: usize, out: &mut Vec<f32>) -> Result<usize, AppError> {
        let s = self.sound_ref(id)?;
        let mut all = Vec::new();
        let (c, ch, _, _) = s.peaks(0, 0, columns, &mut all);
        out.clear();
        if ch > 0 {
            out.extend_from_slice(&all[..2 * c]);
        }
        Ok(c)
    }

    /// The Sound module cabled into Edit module `id`, if any.
    pub fn sound_of(&self, edit: u32) -> Option<u32> {
        self.wires.iter().find(|w| w.to == (edit, 0)).map(|w| w.from.0).filter(|s| matches!(self.modules.get(s).map(|m| &m.part), Some(Part::Sound(_))))
    }

    fn edit_sound(&mut self, edit: u32) -> Result<(u32, &mut SoundPart), AppError> {
        if !matches!(self.modules.get(&edit).map(|m| &m.part), Some(Part::Edit(_))) {
            return Err(AppError::NoSuchModule(edit));
        }
        let sound = self.sound_of(edit).ok_or_else(|| bad("Open a sound first: cable a Sound module into Edit"))?;
        Ok((sound, self.sound_mut(sound)?))
    }

    fn edit_sound_ref(&self, edit: u32) -> Result<&SoundPart, AppError> {
        let sound = self.sound_of(edit).ok_or_else(|| bad("Open a sound first"))?;
        self.sound_ref(sound)
    }

    /// One of MGL's edit ops on the sound cabled into Edit module `id`, as
    /// `/api/edit` takes it; its answer, as `/api/edit` gives it.
    pub fn edit_op(&mut self, edit: u32, op: &Value) -> Result<Value, AppError> {
        let (sound, s) = self.edit_sound(edit)?;
        let (out, changed) = s.apply(op).map_err(bad)?;
        if changed {
            self.sound_hand_over(sound)?;
        }
        // A Grain on the same sound hears the edit (and an undo of its own moves).
        self.grain_sync();
        self.prism_sync();
        Ok(out)
    }

    /// Markers and regions on Edit module `id`'s sound (`/api/markers`, `/api/annot`).
    pub fn edit_annot(&mut self, edit: u32, op: &Value) -> Result<Value, AppError> {
        let (_, s) = self.edit_sound(edit)?;
        s.annot(op).map_err(bad)
    }

    /// `/api/measure` of `[start, end)` (0, 0 is the whole sound).
    pub fn edit_measure(&mut self, edit: u32, start: u64, end: u64) -> Result<Value, AppError> {
        let (_, s) = self.edit_sound(edit)?;
        s.measure(start, end).ok_or_else(|| bad("could not read the audio"))
    }

    /// The edited timeline's peaks (see `SoundPart::peaks`).
    pub fn edit_peaks(&self, edit: u32, from: u64, to: u64, columns: usize, out: &mut Vec<f32>) -> Result<(usize, usize, u64, u64), AppError> {
        Ok(self.edit_sound_ref(edit)?.peaks(from, to, columns, out))
    }

    pub fn edit_spectrogram(&mut self, edit: u32, from: u64, to: u64, columns: usize, fft: usize, out: &mut Vec<u8>) -> Result<(usize, usize, f32), AppError> {
        let (_, s) = self.edit_sound(edit)?;
        s.spectrogram(from, to, columns, fft, out).ok_or_else(|| bad("could not read the audio"))
    }

    /// Write the edited sound to `path` as a WAV of `bits` (16, 24, or 32 for
    /// float). How many bytes.
    pub fn edit_export(&mut self, edit: u32, path: &str, bits: u16) -> Result<u64, AppError> {
        let (_, s) = self.edit_sound(edit)?;
        let bytes = s.wav(bits).ok_or_else(|| bad("could not render the sound"))?;
        std::fs::write(path, &bytes).map_err(|e| bad(format!("{path}: {e}")))?;
        Ok(bytes.len() as u64)
    }

    fn edit_part(&self, edit: u32) -> Result<&crate::EditPart, AppError> {
        match self.modules.get(&edit).map(|m| &m.part) {
            Some(Part::Edit(e)) => Ok(e),
            _ => Err(AppError::NoSuchModule(edit)),
        }
    }

    /// Edit module `id`'s transport, as MGL's page drives its engine:
    /// `{"play": bool}`, `{"seek": frame}`, `{"loop": {"on", "a", "b"}}`
    /// (`b` 0 the whole sound), frames on the document's timeline.
    pub fn edit_transport(&mut self, edit: u32, msg: &Value) -> Result<(), AppError> {
        let file_rate = self.edit_sound_ref(edit).map(|s| s.file_rate()).unwrap_or(0);
        let rate = self.rate;
        let t = self.edit_part(edit)?.transport.clone();
        if let Some(f) = msg.get("seek").and_then(Value::as_f64) {
            t.seek(to_bank(f, file_rate, rate));
        }
        if let Some(l) = msg.get("loop") {
            let at = |k: &str| l.get(k).and_then(Value::as_f64).unwrap_or(0.0);
            t.set_loop(l.get("on").and_then(Value::as_bool).unwrap_or(false), to_bank(at("a"), file_rate, rate), to_bank(at("b"), file_rate, rate));
        }
        if let Some(p) = msg.get("play").and_then(Value::as_bool) {
            t.play(p);
        }
        Ok(())
    }

    /// Where Edit module `id`'s head is (on the document's timeline), whether
    /// it plays, and its last block's peaks.
    pub fn edit_position(&self, edit: u32) -> Result<(f64, bool, f32, f32), AppError> {
        let file_rate = self.edit_sound_ref(edit).map(|s| s.file_rate()).unwrap_or(0);
        let t = &self.edit_part(edit)?.transport;
        let (l, r) = t.peaks();
        Ok((from_bank(t.position(), file_rate, self.rate), t.is_playing(), l, r))
    }

    /// What Edit module `id`'s face keeps (the view, the selection, its
    /// settings): handed over as it is, saved in the patch.
    pub fn edit_set_ui(&mut self, edit: u32, ui: Value) -> Result<(), AppError> {
        match self.modules.get_mut(&edit).map(|m| &mut m.part) {
            Some(Part::Edit(e)) => {
                e.ui = ui;
                Ok(())
            }
            _ => Err(AppError::NoSuchModule(edit)),
        }
    }

    pub fn edit_ui(&self, edit: u32) -> Result<&Value, AppError> {
        Ok(&self.edit_part(edit)?.ui)
    }

    /// What the page measured from the sound's samples (411): its hits, its
    /// loud spots, its bands over `[a, b)` and their levels; null until made.
    pub fn edit_measures(&self, edit: u32, a: f64, b: f64) -> Result<Value, AppError> {
        let s = self.edit_sound_ref(edit)?;
        let Some(m) = s.measured() else { return Ok(Value::Null) };
        let an = &m.an;
        let (mut lo, mut mi, mut hi) = (0.0f64, 0.0f64, 0.0f64);
        let f_count = an.low.len();
        let whole = b <= a;
        let f0 = if whole { 0 } else { (a / an.hop as f64).floor() as usize };
        let f1 = if whole { f_count } else { (b / an.hop as f64).ceil() as usize };
        for f in f0..f1.min(f_count) {
            lo += an.low[f] as f64;
            mi += an.mid[f] as f64;
            hi += an.high[f] as f64;
        }
        let (la, lb) = if whole { (0.0, s.frames() as f64) } else { (a, b) };
        let lv = sound_part::levels(&m.mono, la, lb);
        Ok(json!({
            "hits": m.hits,
            "loud": m.loud.iter().map(|(at, db)| json!([at, db])).collect::<Vec<_>>(),
            "bands": [lo, mi, hi],
            "levels": lv.map(|(p, r)| json!({ "peak": p, "rms": r })),
            "rate": m.rate,
            "frames": m.mono.len(),
        }))
    }

    /// The page's Rainbow: one colour for each of `columns` columns over
    /// `[from, to)` (`edColumnColours`), into `out` as r, g, b. False until
    /// the sound is measured.
    pub fn edit_colours(&self, edit: u32, from: f64, to: f64, columns: usize, out: &mut Vec<f32>) -> Result<bool, AppError> {
        out.clear();
        let s = self.edit_sound_ref(edit)?;
        let Some(m) = s.measured() else { return Ok(false) };
        let span = if to - from == 0.0 { 1.0 } else { to - from };
        for i in 0..columns {
            let c = sound_part::colour_at(&m.an, from + (i as f64 + 0.5) * span / columns as f64);
            out.extend(c.iter().map(|x| x.trunc() as f32));
        }
        Ok(true)
    }

    /// `n` of the mono samples from `from` (0 outside the sound): the loupe's
    /// and the preview's. How many the sound has.
    pub fn edit_mono(&self, edit: u32, from: i64, out: &mut [f32]) -> Result<usize, AppError> {
        let s = self.edit_sound_ref(edit)?;
        let Some(m) = s.measured() else {
            out.fill(0.0);
            return Ok(0);
        };
        for (k, o) in out.iter_mut().enumerate() {
            let i = from + k as i64;
            *o = if i >= 0 && (i as usize) < m.mono.len() { m.mono[i as usize] } else { 0.0 };
        }
        Ok(m.mono.len())
    }

    /// Where a dragged edge lands (`edEdgeSnap`): on a hit when `hits` and
    /// one is near, then on the nearest zero crossing when `zero`.
    pub fn edit_edge_snap(&self, edit: u32, frame: i64, hits: bool, zero: bool) -> Result<i64, AppError> {
        let s = self.edit_sound_ref(edit)?;
        let Some(m) = s.measured() else { return Ok(frame) };
        let sr = if m.rate == 0 { 44100.0 } else { m.rate as f64 };
        let mut frame = frame;
        if hits {
            if let Some(h) = sound_part::nearest_hit(&m.hits, frame, (0.02 * sr).round() as i64) {
                frame = h as i64;
            }
        }
        if zero {
            frame = sound_part::nearest_zero(&m.mono, frame, (0.012 * sr).round() as i64);
        }
        Ok(frame)
    }
}
