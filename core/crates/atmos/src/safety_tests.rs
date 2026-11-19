use super::*;

#[test]
fn non_finite_controls_and_notes_do_not_poison_other_voices() {
    let mut synth = Synth::new(48_000.0);
    for key in ["a.model", "a.p0", "b.fine", "blend", "flt.cut", "lfo1.rate", "lfo1.target"] {
        for value in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            assert!(!synth.set(key, value), "{key}");
        }
    }
    synth.note_on(1, 220.0, 0.8, 0);
    for value in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        synth.note_on(2, value, 0.8, 0);
        synth.note_on(3, 330.0, value, 0);
    }
    let (mut l, mut r) = ([0.0; 512], [0.0; 512]);
    synth.render(&mut l, &mut r);
    assert!(l.iter().chain(&r).all(|x| x.is_finite()));
    assert!(l.iter().any(|x| *x != 0.0));
    assert_eq!(synth.voices.iter().filter(|v| v.id >= 0).count(), 1);
}

#[test]
fn a_bad_voice_clears_once_and_can_be_reused() {
    let mut synth = Synth::new(48_000.0);
    synth.start(1, 220.0, 0.8);
    synth.start(2, 330.0, 0.8);
    synth.voices[0].amp.level = f32::NAN;
    let (mut l, mut r) = ([0.0; 128], [0.0; 128]);
    synth.render(&mut l, &mut r);
    assert!(synth.voices[0].free());
    assert!(synth.voices[0].osc.iter().flatten().all(Osc::faulted));
    assert!(l.iter().chain(&r).all(|x| x.is_finite()));
    assert!(l.iter().any(|x| *x != 0.0));
    // An idle, quarantined voice does not clear again each sample.
    synth.voices[0].osc[0][0].view[0] = 0.25;
    synth.render(&mut l, &mut r);
    assert_eq!(synth.voices[0].osc[0][0].view[0], 0.25);
    synth.start(3, 440.0, 0.8);
    assert_eq!(synth.voices[0].id, 3);
    assert!(synth.voices[0].osc.iter().flatten().all(|o| !o.faulted()));
    synth.render(&mut l, &mut r);
    assert!(l.iter().chain(&r).all(|x| x.is_finite()));
}

#[test]
fn skipping_unused_starts_would_change_later_unison_samples() {
    let mut reference = Synth::new(48_000.0);
    let mut skipped = Synth::new(48_000.0);
    let mut unused = Voice::new(48_000.0, 0);
    for s in [&mut reference, &mut skipped] {
        s.set("a.model", 3.0);
        s.set("b.model", 3.0);
        s.start(1, 220.0, 0.8);
    }
    // Simulate starting only the first unison copy, leaving the others as
    // they were before the note. Today's dormant copies remember the note.
    for o in 0..2 {
        for u in 1..UNISON {
            std::mem::swap(&mut skipped.voices[0].osc[o][u], &mut unused.osc[o][u]);
        }
    }
    let (mut a, mut b, mut c, mut d) = ([0.0; 128], [0.0; 128], [0.0; 128], [0.0; 128]);
    reference.render(&mut a, &mut b);
    skipped.render(&mut c, &mut d);
    assert_eq!(a.map(f32::to_bits), c.map(f32::to_bits));
    reference.set("unison", 3.0);
    skipped.set("unison", 3.0);
    reference.render(&mut a, &mut b);
    skipped.render(&mut c, &mut d);
    let first = a.iter().zip(c).position(|(x, y)| x.to_bits() != y.to_bits()).unwrap();
    println!("UNUSED_START first_sample={} old={:08x} skipped={:08x}", 128 + first, a[first].to_bits(), c[first].to_bits());
}
