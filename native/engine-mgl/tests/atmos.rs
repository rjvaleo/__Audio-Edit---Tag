//! Atmosphere in the native engine: what `atmos::Synth` plays when driven
//! directly, sample for sample, whatever the blocks.

mod common;
use common::*;
use engine_core::*;
use engine_mgl::atmos::{knob, KEYS};
use engine_mgl::Atmos;

/// Its controls: a string model against a bell, two copies, the filter moving.
const PATCH: &[(&str, f32)] = &[
    ("a.model", 0.0), ("b.model", 3.0), ("blend", 0.4), ("unison", 2.0), ("detune", 12.0),
    ("flt.type", 1.0), ("flt.cut", 2400.0), ("flt.amt", 0.5), ("rel", 0.3),
    ("lfo1.target", 1.0), ("lfo1.rate", 3.0), ("lfo1.depth", 0.4),
];

/// A run of notes, each on its own sample, some held over others.
fn notes() -> Vec<(u64, NoteEvent)> {
    let mut n = Vec::new();
    for (i, key) in [48u8, 55, 60, 64, 67, 72].iter().enumerate() {
        let at = 211 + 3_517 * i as u64;
        n.push((at, NoteEvent::on(*key, 0.5 + 0.08 * i as f32)));
        n.push((at + 5_003, NoteEvent::off(*key)));
    }
    n.sort_by_key(|(at, _)| *at);
    n
}

/// The synth on its own: each note given its sample as a delay into the one
/// render that holds it.
fn direct(frames: usize) -> (Vec<f32>, Vec<f32>) {
    let mut s = atmos::Synth::new(RATE);
    for (k, v) in PATCH {
        assert!(s.set(k, *v), "{k}");
    }
    let (mut l, mut r) = (vec![0.0; frames], vec![0.0; frames]);
    let block = 128;
    let script = notes();
    let mut next = 0;
    let mut at = 0;
    while at < frames {
        let n = block.min(frames - at);
        while next < script.len() && (script[next].0 as usize) < at + n {
            let (frame, note) = script[next];
            let hz = 440.0 * 2f32.powf((note.note as f32 - 69.0) / 12.0);
            let delay = (frame as usize - at) as u32;
            match note.kind {
                NoteKind::On => s.note_on(note.note as i32, hz, note.velocity, delay),
                _ => s.note_off(note.note as i32, delay),
            }
            next += 1;
        }
        s.render(&mut l[at..at + n], &mut r[at..at + n]);
        at += n;
    }
    (l, r)
}

fn ours(frames: usize, block: usize) -> (Vec<f32>, Vec<f32>) {
    let mut m = Atmos::new(RATE);
    for (k, v) in PATCH {
        m = m.set(k, *v);
    }
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Script::new(notes()))).unwrap();
    ctl.add(2, Box::new(m)).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    render(&mut audio, frames, block)
}

#[test]
fn every_knob_is_a_control_the_synth_takes() {
    let mut s = atmos::Synth::new(RATE);
    for key in KEYS {
        assert!(s.set(key, 0.5), "{key} is not one of the synth's controls");
    }
    assert_eq!(knob("flt.cut"), Some(28));
    assert_eq!(knob("nothing"), None);
}

#[test]
fn it_plays_what_the_synth_plays_whatever_the_blocks() {
    const N: usize = 30_000;
    let (dl, dr) = direct(N);
    assert!(peak(&dl) > 0.01, "the synth is heard");
    for block in [128, 256, 7, 1000] {
        let (l, r) = ours(N, block);
        assert_same(&format!("left, blocks of {block}"), &dl, &l);
        assert_same(&format!("right, blocks of {block}"), &dr, &r);
    }
}

#[test]
fn it_allocates_nothing_while_it_plays() {
    assert_the_check_is_on();
    let mut m = Atmos::new(RATE);
    for (k, v) in PATCH {
        m = m.set(k, *v);
    }
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Script::new(notes()))).unwrap();
    ctl.add(2, Box::new(m)).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    let before = counted();
    let (l, _) = render(&mut audio, 30_000, 128);
    assert!(peak(&l) > 0.01);
    assert_eq!(counted() - before, 0, "allocations or frees inside a render; the last sizes: {:?}", last_sizes());
}
