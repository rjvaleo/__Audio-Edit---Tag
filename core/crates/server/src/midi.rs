//! MIDI in, for the Wave synth.
//!
//! **Opened lazily, on a thread of its own.** The first time any `/api/wave/*`
//! route is used, [`ensure`] starts a thread that opens every MIDI input port
//! there is and listens to all of them, then looks again every few seconds for
//! ports that have appeared (a keyboard plugged in after the app started) or
//! gone (one unplugged). Nothing waits for it: a machine with no CoreMIDI, or
//! no ports, logs that once and the app carries on exactly as before, playing
//! from the page.
//!
//! Every port is listened to on every channel. This is a synth with one patch;
//! asking which keyboard and which channel would be a question with only one
//! sensible answer.
//!
//! What is understood: note on and off (a note on at velocity 0 is an off, as
//! running-status keyboards send it), CC 1 as the mod wheel, pitch bend,
//! channel aftertouch, and CC 120 / 123 (all sound off, all notes off) as
//! releasing every key. Everything is pushed onto the synth deck's lock-free
//! queue (`engine::synth`), so CoreMIDI's thread never waits on anything.
//!
//! `MGL_NO_MIDI` set in the environment keeps it closed: the tests set it,
//! because a test that opened the machine's MIDI ports would be listening to
//! whatever the person running it was playing.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use engine::{WaveEvent, WaveShared};

/// How often to look for ports that have come or gone.
const RESCAN: Duration = Duration::from_secs(3);

/// Start listening, once per process. Returns at once.
pub fn ensure(shared: &Arc<WaveShared>, started: &AtomicBool) {
    if std::env::var_os("MGL_NO_MIDI").is_some() {
        return;
    }
    if started.swap(true, Ordering::AcqRel) {
        return;
    }
    let shared = Arc::clone(shared);
    let spawned = std::thread::Builder::new().name("midi-in".into()).spawn(move || run(shared));
    if let Err(e) = spawned {
        eprintln!("MIDI: could not start the listening thread ({e}); the Wave synth plays from the page only");
    }
}

/// The listening thread. Never returns.
fn run(shared: Arc<WaveShared>) {
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
                    let sh = Arc::clone(&shared);
                    match input.connect(&port, "MultiGrainLive Wave", move |_, msg, _| {
                        if let Some(e) = parse(msg) {
                            sh.push(e);
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
                    eprintln!("MIDI unavailable ({e}); the Wave synth plays from the page only");
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

    #[test]
    fn short_and_unknown_messages_are_ignored() {
        assert_eq!(parse(&[]), None);
        assert_eq!(parse(&[0x90, 60]), None);
        assert_eq!(parse(&[0xf8]), None);
        assert_eq!(parse(&[0xc0, 5]), None);
    }
}
