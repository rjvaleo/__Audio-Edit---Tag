//! Notes on the Grain page, on the server's side: `/api/engine/note`,
//! `/api/engine/voice`, and the notes in a REC PERF take.
//!
//! The engine half is `engine::keys`. What is here is the two routes, and the
//! one thing the engine cannot do: put a note on the document's timeline.
//!
//! # A take's notes
//!
//! REC PERF writes the document's automation (`automation.rs`), and a take is
//! its lanes. RJ's decision (8 Nov 2026): it "should record notes". So a note
//! pressed while a take is running is written beside the lanes, on the same
//! timeline: document frames, by `automation::playhead`. Replay is the runner's
//! tick calling [`tick`], which plays what the transport has passed through
//! the same `GrainKeys` a hand would, so Run, Mono, Legato, AMP, Glide and the
//! tuning apply exactly as they did. It is as fine as the runner's 8 ms.
//!
//! LFO swings are not notes and are not here: they are heard and never written
//! (`grain_lfos.rs`), so a take has no record of them.
//!
//! A second pass over a stretch replaces what the first played there, as a
//! lane does. Nothing the keys send is an edit: the document's Pitch, and the
//! undo stack, are not touched by any of this.

use std::sync::{Arc, Mutex};

use engine::KeyMode;

use crate::automation::{Automation, Record, TakeNote};
use crate::http::{Request, Response};
use crate::json::{self, Value};
use crate::midi::Instrument;
use crate::state::{App, NowPlaying};

fn body(req: &Request) -> Result<Value, Response> {
    json::parse(&String::from_utf8_lossy(&req.body))
        .filter(|v| matches!(v, Value::Obj(_)))
        .ok_or_else(|| Response::error(400, "expected a JSON object"))
}

fn num(v: Option<&Value>) -> Option<f32> {
    match v {
        Some(Value::Num(n)) if n.is_finite() => Some(*n as f32),
        _ => None,
    }
}

/// A key down or up, from the screen or from MIDI: answers the note's voice
/// id. Opens the device if it is not yet, because a key is a thing you do to
/// hear something, and writes it into a take if one is running.
pub fn play(app: &Arc<App>, on: bool, key: u8, vel: f32) -> Result<u32, String> {
    crate::live::ensure(app)?;
    let voice = if on { app.grain_keys.note_on(key, vel) } else { app.grain_keys.note_off(key); 0 };
    record(app, on, key, vel);
    Ok(voice)
}

/// `POST /api/engine/note {on, key, velocity}`: a key down or up.
pub fn post_note(app: &Arc<App>, req: &Request) -> Response {
    let v = match body(req) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let Some(key) = num(v.get("key")).filter(|n| (0.0..=127.0).contains(n)) else {
        return Response::error(400, "key must be 0 to 127");
    };
    let key = key.round() as u8;
    let vel = num(v.get("velocity")).unwrap_or(0.8).clamp(0.0, 1.0);
    let on = !matches!(v.get("on"), Some(Value::Bool(false)));
    crate::midi::ensure(app);
    let voice = match play(app, on, key, vel) {
        Ok(v) => v,
        Err(e) => return Response::error(503, &e),
    };
    Response::json(
        Value::obj()
            .set("ok", true)
            .set("key", key as f64)
            .set("on", on)
            .set("voice", voice as f64)
            .to_string(),
    )
}

/// `POST /api/engine/voice`: how the keys play, any part of it. `mode`, `glide`
/// (seconds to arrive), `bend` (semitones), `attack`, `decay`, `release`
/// (seconds), `sustain`, `run`, `start` (a fraction of the document), `keys`
/// (128 semitones, the page's tuning), `replay`, `allOff`, `reset`, and for
/// the page in front: `front` (MIDI goes here, the transport's loop follows
/// Scan), `bendRange` (semitones, for the MIDI wheel).
///
/// Atomics and nothing more: it needs no device, and a page that sends its
/// settings before anything has been played finds them still there when the
/// device opens.
pub fn post_voice(app: &Arc<App>, req: &Request) -> Response {
    let v = match body(req) {
        Ok(v) => v,
        Err(r) => return r,
    };
    crate::midi::ensure(app);
    let k = &app.grain_keys;
    if let Some(Value::Bool(on)) = v.get("front") {
        k.set_front(*on);
    }
    if let Some(b) = num(v.get("bendRange")) {
        app.midi.set_bend_range(b);
    }
    if let Some(m) = v.get("mode").and_then(Value::as_str) {
        let Some(m) = KeyMode::from_name(m) else { return Response::error(400, "mode must be mono, legato or poly") };
        k.set_mode(m);
    }
    if let Some(g) = num(v.get("glide")) {
        k.set_glide(g);
    }
    if let Some(b) = num(v.get("bend")) {
        k.set_bend(b);
    }
    let (a, d, s, r) = k.amp();
    let amp = (num(v.get("attack")), num(v.get("decay")), num(v.get("sustain")), num(v.get("release")));
    if amp != (None, None, None, None) {
        k.set_amp(amp.0.unwrap_or(a), amp.1.unwrap_or(d), amp.2.unwrap_or(s), amp.3.unwrap_or(r));
    }
    if let Some(Value::Bool(on)) = v.get("run") {
        k.set_run(*on);
    }
    if let Some(Value::Bool(on)) = v.get("replay") {
        k.set_replay(*on);
    }
    if let Some(f) = num(v.get("start")) {
        k.set_start(f);
    }
    if let Some(Value::Arr(table)) = v.get("keys") {
        if table.len() != 128 {
            return Response::error(400, "keys must be 128 semitones");
        }
        for (i, s) in table.iter().enumerate() {
            if let Some(s) = num(Some(s)) {
                k.set_key(i, s);
            }
        }
    }
    if matches!(v.get("allOff"), Some(Value::Bool(true))) {
        k.all_off();
    }
    if matches!(v.get("reset"), Some(Value::Bool(true))) {
        k.reset();
    }
    let (a, d, s, r) = k.amp();
    Response::json(
        Value::obj()
            .set("ok", true)
            .set("mode", k.mode().name())
            .set("run", k.run())
            .set("replay", k.replay())
            .set("glide", k.glide() as f64)
            .set("bend", k.bend() as f64)
            .set("attack", a as f64)
            .set("decay", d as f64)
            .set("sustain", s as f64)
            .set("release", r as f64)
            .set("start", k.start() as f64)
            .to_string(),
    )
}

/// `GET /api/engine/midi`: what the keyboard is holding down, for the page to
/// draw on its own keys.
pub fn get_midi(app: &Arc<App>) -> Response {
    let keys = app.midi.held_keys().into_iter().map(|k| Value::Num(k as f64)).collect();
    Response::json(
        Value::obj()
            .set("notes", Value::Arr(keys))
            .set("bend", app.midi.bend() as f64)
            .set("vel", app.midi.velocity() as f64)
            .set("wave", app.midi.channel(Instrument::Wave) as f64)
            .set("grain", app.midi.channel(Instrument::Grain) as f64)
            .to_string(),
    )
}

/// `POST /api/engine/midi`: each instrument's channel, 1 to 16, either or both.
pub fn post_midi(app: &Arc<App>, req: &Request) -> Response {
    let v = match body(req) {
        Ok(v) => v,
        Err(r) => return r,
    };
    for (key, who) in [("wave", Instrument::Wave), ("grain", Instrument::Grain)] {
        if let Some(ch) = num(v.get(key)) {
            if !(1.0..=16.0).contains(&ch) {
                return Response::error(400, "a MIDI channel is 1 to 16");
            }
            app.midi.set_channel(who, ch.round() as u8);
        }
    }
    get_midi(app)
}

// ──────────────────────────────────────────────────────────── recording

/// One pass of REC PERF, as far as its notes go.
#[derive(Debug, Clone, PartialEq)]
struct Pass {
    rel: String,
    /// Frames before this have been dealt with in this pass.
    to: u64,
    /// The furthest the transport has reached, from the runner.
    head: u64,
}

/// The pass in progress, held by [`App`].
#[derive(Default)]
pub struct NoteTake {
    pass: Mutex<Option<Pass>>,
}

/// What the transport is doing, if a document is what it is playing.
fn document_at(app: &Arc<App>) -> Option<(NowPlaying, u64)> {
    let now = app.playing.read().ok().and_then(|g| g.clone()).filter(|n| n.document)?;
    let playing = crate::live::peek(app, |h| h.shared.is_playing())?;
    if !playing {
        return None;
    }
    let frame = crate::automation::playhead(app)?;
    Some((now, frame))
}

fn record(app: &Arc<App>, on: bool, key: u8, vel: f32) {
    if app.automation.record_mode() == Record::Off {
        return;
    }
    let Some((now, frame)) = document_at(app) else { return };
    let Ok(mut g) = app.note_take.pass.lock() else { return };
    let mut pass = g.take().filter(|p| p.rel == now.rel).unwrap_or_else(|| Pass { rel: now.rel.clone(), to: frame, head: frame });
    app.automation.update(&now.rel, |a| lay_note(a, &mut pass, TakeNote { frame, on, key, vel }));
    *g = Some(pass);
    let _ = app.automation.save(&app.automation_path());
}

/// Write one note, taking out whatever an earlier pass played on the stretch
/// between the last one and this.
fn lay_note(a: &mut Automation, pass: &mut Pass, note: TakeNote) {
    let f = note.frame;
    if f + 1 < pass.to {
        // Round the loop, or back to the top: a second run at it.
        pass.to = f;
    }
    if f >= pass.to {
        a.notes.retain(|n| n.frame < pass.to || n.frame > f);
        pass.to = f + 1;
    }
    let at = a.notes.partition_point(|n| n.frame <= f);
    a.notes.insert(at, note);
    pass.head = pass.head.max(f);
}

/// The take has ended: what it passed over after its last note goes too, and
/// no note is left without its end.
fn close_pass(a: &mut Automation, pass: &Pass) {
    if pass.head >= pass.to {
        a.notes.retain(|n| n.frame < pass.to || n.frame > pass.head);
    }
    heal(a, pass.head);
}

/// Pair every note. A key still down when the take stopped is let go where it
/// stopped; a release whose press came before the take is dropped.
fn heal(a: &mut Automation, end: u64) {
    let mut open: Vec<u8> = Vec::new();
    a.notes.retain(|n| {
        if n.on {
            if open.contains(&n.key) {
                return false;
            }
            open.push(n.key);
            true
        } else {
            match open.iter().position(|k| *k == n.key) {
                Some(i) => {
                    open.remove(i);
                    true
                }
                None => false,
            }
        }
    });
    for key in open {
        let at = a.notes.partition_point(|n| n.frame <= end);
        a.notes.insert(at, TakeNote { frame: end, on: false, key, vel: 0.0 });
    }
}

/// REC PERF went off.
pub fn end_take(app: &Arc<App>) {
    let Some(pass) = app.note_take.pass.lock().ok().and_then(|mut g| g.take()) else { return };
    app.automation.update(&pass.rel, |a| close_pass(a, &pass));
    let _ = app.automation.save(&app.automation_path());
}

// ──────────────────────────────────────────────────────────────── replay

/// Where replay has got to. The runner keeps one.
#[derive(Default)]
pub struct Cursor {
    last: Option<u64>,
    open: Vec<u8>,
}

impl Cursor {
    fn stop(&mut self, app: &App) {
        for key in self.open.drain(..) {
            app.grain_keys.note_off(key);
        }
        self.last = None;
    }
}

/// The notes between where replay was and where the transport is: after `last`
/// up to and including `frame`, or exactly at `frame` when it has just begun.
fn due(notes: &[TakeNote], last: Option<u64>, frame: u64) -> &[TakeNote] {
    let from = match last {
        Some(l) => notes.partition_point(|n| n.frame <= l),
        None => notes.partition_point(|n| n.frame < frame),
    };
    let to = notes.partition_point(|n| n.frame <= frame);
    &notes[from..to.max(from)]
}

/// One runner tick: follow the transport through a take's notes.
pub fn tick(app: &Arc<App>, now: &NowPlaying, automation: &Automation, c: &mut Cursor) {
    let Some(playing) = crate::live::try_peek(app, |h| h.shared.is_playing()) else {
        return;
    };
    let recording = app.automation.record_mode() != Record::Off;
    if recording && playing {
        if let Some(frame) = crate::automation::playhead(app) {
            if let Ok(mut g) = app.note_take.pass.lock() {
                if let Some(p) = g.as_mut().filter(|p| p.rel == now.rel) {
                    p.head = p.head.max(frame);
                }
            }
        }
    }
    let k = &app.grain_keys;
    if !playing || recording || !k.replay() || !now.document || automation.notes.is_empty() {
        if !c.open.is_empty() || c.last.is_some() {
            c.stop(app);
        }
        return;
    }
    let Some(frame) = crate::automation::playhead(app) else { return };
    if c.last.is_some_and(|l| frame < l) {
        // Round the loop, or a seek: what was held belongs to where it was.
        c.stop(app);
    }
    for n in due(&automation.notes, c.last, frame) {
        if n.on {
            k.note_on(n.key, n.vel);
            c.open.push(n.key);
        } else {
            k.note_off(n.key);
            c.open.retain(|x| *x != n.key);
        }
    }
    c.last = Some(frame);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn n(frame: u64, on: bool, key: u8) -> TakeNote {
        TakeNote { frame, on, key, vel: 0.5 }
    }

    fn pass() -> Pass {
        Pass { rel: "a.wav".into(), to: 100, head: 100 }
    }

    fn keys(a: &Automation) -> Vec<(u64, bool, u8)> {
        a.notes.iter().map(|n| (n.frame, n.on, n.key)).collect()
    }

    #[test]
    fn a_second_pass_replaces_what_it_plays_over() {
        let mut a = Automation { notes: vec![n(150, true, 60), n(180, false, 60), n(900, true, 70), n(950, false, 70)], ..Default::default() };
        let mut p = pass();
        lay_note(&mut a, &mut p, n(100, true, 64));
        lay_note(&mut a, &mut p, n(200, false, 64));
        // The old pair inside the pass is gone; what lies beyond it stays.
        assert_eq!(keys(&a), [(100, true, 64), (200, false, 64), (900, true, 70), (950, false, 70)]);
        p.head = 400;
        close_pass(&mut a, &p);
        assert_eq!(a.notes.len(), 4);
    }

    #[test]
    fn a_chord_on_one_frame_keeps_all_its_notes() {
        let mut a = Automation::default();
        let mut p = pass();
        lay_note(&mut a, &mut p, n(100, true, 60));
        lay_note(&mut a, &mut p, n(100, true, 64));
        lay_note(&mut a, &mut p, n(100, true, 67));
        assert_eq!(a.notes.len(), 3);
    }

    #[test]
    fn the_end_of_a_pass_clears_what_it_passed_and_lets_held_keys_go() {
        let mut a = Automation { notes: vec![n(300, true, 70), n(350, false, 70)], ..Default::default() };
        let mut p = pass();
        lay_note(&mut a, &mut p, n(100, true, 60));
        p.head = 500;
        close_pass(&mut a, &p);
        assert_eq!(keys(&a), [(100, true, 60), (500, false, 60)]);
    }

    #[test]
    fn a_release_with_no_press_in_the_take_is_dropped() {
        let mut a = Automation { notes: vec![n(10, false, 60), n(20, true, 61), n(30, false, 61)], ..Default::default() };
        heal(&mut a, 40);
        assert_eq!(keys(&a), [(20, true, 61), (30, false, 61)]);
    }

    #[test]
    fn replay_takes_each_note_once() {
        let notes = [n(100, true, 60), n(200, false, 60), n(200, true, 62), n(300, false, 62)];
        assert_eq!(due(&notes, None, 100).len(), 1);
        assert_eq!(due(&notes, Some(100), 150).len(), 0);
        assert_eq!(due(&notes, Some(150), 200).len(), 2);
        assert_eq!(due(&notes, Some(200), 400).len(), 1);
        assert_eq!(due(&notes, Some(400), 500).len(), 0);
    }

    #[test]
    fn a_take_keeps_its_notes_through_json() {
        let a = Automation { notes: vec![n(100, true, 60), n(200, false, 60)], ..Default::default() };
        let b = Automation::from_json(&a.to_json());
        assert_eq!(b.notes, a.notes);
        // A take with none says nothing new.
        assert!(Automation::default().to_json().get("notes").is_none());
    }
}
