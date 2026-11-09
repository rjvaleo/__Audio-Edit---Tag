//! MIDI in: each instrument on its own channel.
//!
//! **Opened lazily, on a thread of its own.** The first time any `/api/wave/*`
//! route is used, or `/api/engine/note` or `/api/engine/voice`, [`ensure`]
//! starts a thread that opens every MIDI input port there is and listens to
//! all of them, then looks again every few seconds for ports that have
//! appeared (a keyboard plugged in after the app started) or gone (one
//! unplugged). Nothing waits for it: a machine with no CoreMIDI, or no ports,
//! logs that once and the app carries on exactly as before, playing from the
//! page.
//!
//! Every port is listened to. **What decides who plays is the channel**: Wave
//! and Grain each listen on one, set on their own pages, so two keyboards or two
//! sequencer tracks can play them at once, whichever page is showing. RJ, 8 Nov
//! 2026: "It should be a separate MIDI channel. Per instrument."
//!
//! What is understood: note on and off (a note on at velocity 0 is an off, as
//! running-status keyboards send it), CC 1 as the mod wheel, pitch bend,
//! channel aftertouch, and CC 120 / 123 (all sound off, all notes off) as
//! releasing every key.
//!
//! # The router
//!
//! [`Router`] holds each instrument's channel: Wave on 1 and Grain on 2 until
//! they are changed. Put on the same channel, the two play together. Grain's
//! notes go to `GrainKeys`, through the same key table and velocity the screen
//! uses, and the pitch bend moves Bend. Everything else is pushed onto the synth
//! deck's lock-free queue (`engine::synth`), so CoreMIDI's thread never waits.
//!
//! A release goes to wherever its press went, so changing a channel with a key
//! down does not leave a note stuck.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::time::Duration;

use engine::{GrainKeys, WaveEvent, WaveShared};

use crate::state::App;

/// How often to look for ports that have come or gone.
const RESCAN: Duration = Duration::from_secs(3);

/// An instrument that can take MIDI.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Instrument {
    Wave,
    Grain,
}

/// What a message does, once it is known who it is for.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Dest {
    Wave(WaveEvent),
    Note { on: bool, key: u8, vel: f32 },
    /// -1..1, as the wheel is: the page's bend range turns it into semitones.
    Bend(f32),
    AllOff,
}

/// A note for the `midi-notes` thread.
type GrainNote = (bool, u8, f32);

// Who a held key was pressed for: either, or both.
const TO_WAVE: u8 = 1;
const TO_GRAIN: u8 = 2;

/// Each instrument's channel, and everything a page wants to know about what
/// the keyboard is doing. Atomics only, so the MIDI thread never waits on
/// anyone.
pub struct Router {
    wave: Arc<WaveShared>,
    grain: Arc<GrainKeys>,
    /// Each instrument's channel, 0..=15.
    channels: [AtomicU8; 2],
    /// Whether the listening thread has been started.
    started: AtomicBool,
    /// The page's Bend range, in semitones.
    bend_range: AtomicU32,
    /// Who each key on each channel went to, so its release can follow it.
    sent: Vec<AtomicU8>,
    /// The keys being held for the Grain page, for it to draw.
    held: [AtomicU64; 2],
    /// Where the wheel is, -1..1, and the last velocity pressed.
    bend: AtomicU32,
    velocity: AtomicU32,
}

impl Router {
    pub fn new(wave: Arc<WaveShared>, grain: Arc<GrainKeys>) -> Router {
        Router {
            wave,
            grain,
            channels: [AtomicU8::new(0), AtomicU8::new(1)],
            started: AtomicBool::new(false),
            bend_range: AtomicU32::new(2f32.to_bits()),
            sent: (0..16 * 128).map(|_| AtomicU8::new(0)).collect(),
            held: std::array::from_fn(|_| AtomicU64::new(0)),
            bend: AtomicU32::new(0f32.to_bits()),
            velocity: AtomicU32::new(0f32.to_bits()),
        }
    }

    /// Set an instrument's channel, 1 to 16 as the page counts them.
    pub fn set_channel(&self, who: Instrument, one_based: u8) {
        self.channels[who as usize].store(one_based.clamp(1, 16) - 1, Ordering::Relaxed);
    }

    /// An instrument's channel, 1 to 16.
    pub fn channel(&self, who: Instrument) -> u8 {
        self.channels[who as usize].load(Ordering::Relaxed) + 1
    }

    /// The page's Bend range, in semitones.
    pub fn set_bend_range(&self, semitones: f32) {
        if semitones.is_finite() {
            self.bend_range.store(semitones.clamp(0.0, 48.0).to_bits(), Ordering::Relaxed);
        }
    }

    /// Where the wheel is, -1..1.
    pub fn bend(&self) -> f32 {
        f32::from_bits(self.bend.load(Ordering::Relaxed))
    }

    /// The last velocity pressed, 0..1.
    pub fn velocity(&self) -> f32 {
        f32::from_bits(self.velocity.load(Ordering::Relaxed))
    }

    /// The keys held for the Grain page, lowest first.
    pub fn held_keys(&self) -> Vec<u8> {
        (0..128u8).filter(|k| self.held[*k as usize / 64].load(Ordering::Relaxed) >> (k % 64) & 1 == 1).collect()
    }

    fn hold(&self, key: u8, down: bool) {
        let bit = 1u64 << (key % 64);
        let word = &self.held[key as usize / 64];
        if down {
            word.fetch_or(bit, Ordering::Relaxed);
        } else {
            word.fetch_and(!bit, Ordering::Relaxed);
        }
    }

    /// Who a message on `channel` (0..=15) is for, and what it means to each:
    /// Wave's part, then Grain's. Updates what is held; the delivery is
    /// [`Router::deliver`].
    pub fn route(&self, e: WaveEvent, channel: u8) -> [Option<Dest>; 2] {
        let ch = channel & 15;
        let wave = ch == self.channels[0].load(Ordering::Relaxed);
        let grain = ch == self.channels[1].load(Ordering::Relaxed);
        let slot = |note: u8| &self.sent[ch as usize * 128 + (note as usize & 127)];
        match e {
            WaveEvent::NoteOn { note, vel } => {
                slot(note).store(if wave { TO_WAVE } else { 0 } | if grain { TO_GRAIN } else { 0 }, Ordering::Relaxed);
                if grain {
                    self.hold(note, true);
                    self.velocity.store(vel.to_bits(), Ordering::Relaxed);
                }
                [wave.then_some(Dest::Wave(e)), grain.then_some(Dest::Note { on: true, key: note, vel })]
            }
            WaveEvent::NoteOff { note } => {
                let was = slot(note).swap(0, Ordering::Relaxed);
                // Nobody saw it pressed: it is still a release, for Wave's own
                // queue to ignore as it always has.
                let (to_wave, to_grain) = if was == 0 { (wave, false) } else { (was & TO_WAVE != 0, was & TO_GRAIN != 0) };
                if to_grain {
                    self.hold(note, false);
                }
                [to_wave.then_some(Dest::Wave(e)), to_grain.then_some(Dest::Note { on: false, key: note, vel: 0.0 })]
            }
            WaveEvent::Bend(v) => {
                if grain {
                    self.bend.store(v.to_bits(), Ordering::Relaxed);
                }
                [wave.then_some(Dest::Wave(e)), grain.then_some(Dest::Bend(v))]
            }
            WaveEvent::AllNotesOff => {
                if grain {
                    self.sent.iter().for_each(|s| { s.fetch_and(!TO_GRAIN, Ordering::Relaxed); });
                    self.held.iter().for_each(|w| w.store(0, Ordering::Relaxed));
                }
                [wave.then_some(Dest::Wave(e)), grain.then_some(Dest::AllOff)]
            }
            // Grain has nothing on the mod wheel or aftertouch yet.
            _ => [wave.then_some(Dest::Wave(e)), None],
        }
    }

    /// Carry out what [`Router::route`] decided. Nothing here waits.
    fn deliver(&self, d: Dest, notes: &Sender<GrainNote>) {
        match d {
            Dest::Wave(e) => {
                self.wave.push(e);
            }
            Dest::Note { on, key, vel } => {
                let _ = notes.send((on, key, vel));
            }
            Dest::Bend(v) => self.grain.set_bend(v * f32::from_bits(self.bend_range.load(Ordering::Relaxed))),
            Dest::AllOff => self.grain.all_off(),
        }
    }
}

/// Start listening, once per process. Returns at once.
pub fn ensure(app: &Arc<App>) {
    if std::env::var_os("MGL_NO_MIDI").is_some() {
        return;
    }
    if app.midi.started.swap(true, Ordering::AcqRel) {
        return;
    }
    let (notes, incoming) = mpsc::channel::<GrainNote>();
    let worker = Arc::clone(app);
    let spawned = std::thread::Builder::new().name("midi-notes".into()).spawn(move || {
        for (on, key, vel) in incoming {
            let _ = crate::grain_notes::play(&worker, on, key, vel);
        }
    });
    if let Err(e) = spawned {
        eprintln!("MIDI: could not start the note thread ({e})");
    }
    let listener = Arc::clone(app);
    let spawned = std::thread::Builder::new().name("midi-in".into()).spawn(move || run(listener, notes));
    if let Err(e) = spawned {
        eprintln!("MIDI: could not start the listening thread ({e}); the pages play from the screen only");
    }
}

/// The listening thread. Never returns.
fn run(app: Arc<App>, notes: Sender<GrainNote>) {
    // Held for as long as each port is there: dropping one closes it.
    let mut open: HashMap<String, midir::MidiInputConnection<()>> = HashMap::new();
    let mut warned_init = false;
    let mut warned_ports: std::collections::HashSet<String> = Default::default();
    let mut said_none = false;
    loop {
        match midir::MidiInput::new("MultiGrainLive") {
            Ok(scan) => {
                let ports: Vec<(String, String, midir::MidiInputPort)> = scan
                    .ports()
                    .into_iter()
                    .map(|p| (p.id(), scan.port_name(&p).unwrap_or_else(|_| "MIDI input".into()), p))
                    .collect();
                open.retain(|id, _| {
                    let keep = ports.iter().any(|(i, _, _)| i == id);
                    if !keep {
                        eprintln!("MIDI: a port went away");
                    }
                    keep
                });
                if ports.is_empty() && !said_none {
                    eprintln!("MIDI: no input ports yet; looking again every {} s", RESCAN.as_secs());
                    said_none = true;
                }
                for (id, name, port) in ports {
                    if open.contains_key(&id) {
                        continue;
                    }
                    let mut input = match midir::MidiInput::new("MultiGrainLive") {
                        Ok(i) => i,
                        Err(_) => break,
                    };
                    // Clock, active sensing and SysEx are not notes.
                    input.ignore(midir::Ignore::All);
                    let app = Arc::clone(&app);
                    let notes = notes.clone();
                    match input.connect(&port, "MultiGrainLive", move |_, msg, _| {
                        if let Some(e) = parse(msg) {
                            for d in app.midi.route(e, msg[0] & 0x0f).into_iter().flatten() {
                                app.midi.deliver(d, &notes);
                            }
                        }
                    }, ()) {
                        Ok(c) => {
                            eprintln!("MIDI: listening to {name}");
                            warned_ports.remove(&id);
                            open.insert(id, c);
                        }
                        Err(e) => {
                            if warned_ports.insert(id) {
                                eprintln!("MIDI: could not open {name} ({e}); will try again");
                            }
                        }
                    }
                }
            }
            Err(e) => {
                if !warned_init {
                    eprintln!("MIDI unavailable ({e}); the pages play from the screen only");
                    warned_init = true;
                }
            }
        }
        std::thread::sleep(RESCAN);
    }
}

/// One MIDI message as the synth hears it, or `None` for anything else.
pub fn parse(msg: &[u8]) -> Option<WaveEvent> {
    let status = *msg.first()?;
    let data = |i: usize| msg.get(i).map(|b| b & 0x7f);
    match status & 0xf0 {
        0x90 => {
            let (note, vel) = (data(1)?, data(2)?);
            Some(if vel == 0 {
                WaveEvent::NoteOff { note }
            } else {
                WaveEvent::NoteOn { note, vel: vel as f32 / 127.0 }
            })
        }
        0x80 => Some(WaveEvent::NoteOff { note: data(1)? }),
        0xb0 => match (data(1)?, data(2)?) {
            (1, v) => Some(WaveEvent::ModWheel(v as f32 / 127.0)),
            (120 | 123, _) => Some(WaveEvent::AllNotesOff),
            _ => None,
        },
        0xe0 => {
            let v = ((data(2)? as i32) << 7 | data(1)? as i32) - 8192;
            // Up is 8191 steps, down 8192: each side reaches its end.
            let b = if v >= 0 { v as f32 / 8191.0 } else { v as f32 / 8192.0 };
            Some(WaveEvent::Bend(b.clamp(-1.0, 1.0)))
        }
        0xd0 => Some(WaveEvent::Aftertouch(data(1)? as f32 / 127.0)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notes_on_any_channel_and_velocity_nought_is_off() {
        assert_eq!(parse(&[0x93, 60, 127]), Some(WaveEvent::NoteOn { note: 60, vel: 1.0 }));
        assert_eq!(parse(&[0x90, 60, 0]), Some(WaveEvent::NoteOff { note: 60 }));
        assert_eq!(parse(&[0x8f, 61, 40]), Some(WaveEvent::NoteOff { note: 61 }));
    }

    #[test]
    fn controllers_bend_and_aftertouch() {
        assert_eq!(parse(&[0xb0, 1, 127]), Some(WaveEvent::ModWheel(1.0)));
        assert_eq!(parse(&[0xb0, 7, 100]), None, "only CC 1 is the wheel");
        assert_eq!(parse(&[0xb2, 123, 0]), Some(WaveEvent::AllNotesOff));
        assert_eq!(parse(&[0xe0, 0x00, 0x40]), Some(WaveEvent::Bend(0.0)));
        assert_eq!(parse(&[0xe0, 0x7f, 0x7f]), Some(WaveEvent::Bend(1.0)));
        assert_eq!(parse(&[0xe0, 0x00, 0x00]), Some(WaveEvent::Bend(-1.0)));
        assert_eq!(parse(&[0xd0, 127]), Some(WaveEvent::Aftertouch(1.0)));
    }

    fn router() -> Router {
        Router::new(Arc::new(WaveShared::new()), Arc::new(GrainKeys::new()))
    }

    fn send(r: &Router, msg: &[u8]) -> [Option<Dest>; 2] {
        r.route(parse(msg).unwrap(), msg[0] & 0x0f)
    }

    #[test]
    fn wave_is_on_one_and_grain_on_two_until_they_are_changed() {
        let r = router();
        assert_eq!(r.channel(Instrument::Wave), 1);
        assert_eq!(r.channel(Instrument::Grain), 2);
        let on = parse(&[0x90, 60, 127]).unwrap();
        assert_eq!(send(&r, &[0x90, 60, 127]), [Some(Dest::Wave(on)), None]);
        assert_eq!(send(&r, &[0x91, 62, 127]), [None, Some(Dest::Note { on: true, key: 62, vel: 1.0 })]);
        assert_eq!(r.held_keys(), vec![62], "only Grain's keys are Grain's to draw");
    }

    #[test]
    fn a_channel_nobody_is_on_goes_nowhere() {
        let r = router();
        assert_eq!(send(&r, &[0x93, 60, 127]), [None, None]);
        assert_eq!(send(&r, &[0xe3, 0x7f, 0x7f]), [None, None]);
        assert!(r.held_keys().is_empty());
    }

    #[test]
    fn each_plays_on_its_own_at_the_same_time() {
        let r = router();
        send(&r, &[0x90, 60, 127]);
        send(&r, &[0x91, 60, 127]);
        assert_eq!(r.held_keys(), vec![60]);
        // Wave's release leaves Grain's note where it is.
        let off = parse(&[0x80, 60, 0]).unwrap();
        assert_eq!(send(&r, &[0x80, 60, 0]), [Some(Dest::Wave(off)), None]);
        assert_eq!(r.held_keys(), vec![60]);
        assert_eq!(send(&r, &[0x81, 60, 0]), [None, Some(Dest::Note { on: false, key: 60, vel: 0.0 })]);
        assert!(r.held_keys().is_empty());
    }

    #[test]
    fn on_the_same_channel_the_two_play_together() {
        let r = router();
        r.set_channel(Instrument::Grain, 1);
        let on = parse(&[0x90, 64, 127]).unwrap();
        assert_eq!(send(&r, &[0x90, 64, 127]), [Some(Dest::Wave(on)), Some(Dest::Note { on: true, key: 64, vel: 1.0 })]);
    }

    #[test]
    fn grain_takes_the_wheel_only_on_its_own_channel() {
        let r = router();
        assert_eq!(send(&r, &[0xe1, 0x7f, 0x7f]), [None, Some(Dest::Bend(1.0))]);
        assert_eq!(r.bend(), 1.0);
        let bend = parse(&[0xe0, 0x00, 0x40]).unwrap();
        assert_eq!(send(&r, &[0xe0, 0x00, 0x40]), [Some(Dest::Wave(bend)), None]);
        assert_eq!(r.bend(), 1.0);
        // No destination on Grain yet.
        assert_eq!(send(&r, &[0xb1, 1, 127]), [None, None]);
        assert_eq!(send(&r, &[0xd1, 127]), [None, None]);
    }

    #[test]
    fn a_release_follows_its_press_when_the_channel_is_changed() {
        let r = router();
        send(&r, &[0x91, 65, 100]);
        r.set_channel(Instrument::Grain, 5);
        assert_eq!(send(&r, &[0x81, 65, 0]), [None, Some(Dest::Note { on: false, key: 65, vel: 0.0 })]);
        assert!(r.held_keys().is_empty());
    }

    #[test]
    fn all_notes_off_clears_the_keys_on_grain() {
        let r = router();
        send(&r, &[0x91, 60, 100]);
        send(&r, &[0x91, 67, 100]);
        assert_eq!(send(&r, &[0xb1, 123, 0]), [None, Some(Dest::AllOff)]);
        assert!(r.held_keys().is_empty());
    }

    #[test]
    fn a_channel_is_one_to_sixteen() {
        let r = router();
        r.set_channel(Instrument::Wave, 0);
        assert_eq!(r.channel(Instrument::Wave), 1);
        r.set_channel(Instrument::Wave, 99);
        assert_eq!(r.channel(Instrument::Wave), 16);
    }

    #[test]
    fn short_and_unknown_messages_are_ignored() {
        assert_eq!(parse(&[]), None);
        assert_eq!(parse(&[0x90, 60]), None);
        assert_eq!(parse(&[0xf8]), None);
        assert_eq!(parse(&[0xc0, 5]), None);
    }
}
