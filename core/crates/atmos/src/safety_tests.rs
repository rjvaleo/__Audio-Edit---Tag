use super::*;

#[test]
fn non_finite_controls_and_notes_do_not_poison_other_voices() {
    let mut synth = Synth::new(48_000.0);
    for key in [
        "a.model",
        "a.p0",
        "b.fine",
        "blend",
        "flt.cut",
        "lfo1.rate",
        "lfo1.target",
    ] {
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
    let first = a
        .iter()
        .zip(c)
        .position(|(x, y)| x.to_bits() != y.to_bits())
        .unwrap();
    println!(
        "UNUSED_START first_sample={} old={:08x} skipped={:08x}",
        128 + first,
        a[first].to_bits(),
        c[first].to_bits()
    );
}

#[test]
fn the_bad_voice_block_is_dropped_without_changing_good_voice_bits() {
    for frames in [1, 7, 64, 128, 512, 1024] {
        let mut bad = Synth::new(48_000.0);
        let mut good = Synth::new(48_000.0);
        for synth in [&mut bad, &mut good] {
            synth.start(1, 220.0, 0.8);
            synth.start(2, 330.0, 0.8);
            // A delayed third note also tests scratch before its first sample.
            synth.note_on(3, 440.0, 0.8, (frames / 2).min(127) as u32);
        }
        bad.voices[0].amp.level = f32::NAN;
        good.voices[0].vel = 0.0;
        let (mut a, mut b, mut c, mut d) = (
            vec![0.0; frames],
            vec![0.0; frames],
            vec![0.0; frames],
            vec![0.0; frames],
        );
        bad.render(&mut a, &mut b);
        good.render(&mut c, &mut d);
        assert_eq!(
            a.iter().map(|x| x.to_bits()).collect::<Vec<_>>(),
            c.iter().map(|x| x.to_bits()).collect::<Vec<_>>(),
            "left, {frames}"
        );
        assert_eq!(
            b.iter().map(|x| x.to_bits()).collect::<Vec<_>>(),
            d.iter().map(|x| x.to_bits()).collect::<Vec<_>>(),
            "right, {frames}"
        );
    }
}

#[test]
fn muted_lfos_keep_their_phase_when_depth_returns() {
    for shape in 0..4 {
        let mut lfo = Lfo {
            shape,
            rate: 0.73,
            depth: 0.0,
            target: 1,
            phase: 0.125,
        };
        let mut phase = lfo.phase;
        for frame in 0..10000 {
            phase += lfo.rate / 48000.0;
            if phase >= 1.0 {
                phase -= 1.0;
            }
            if frame == 5000 {
                lfo.depth = 0.4;
            }
            let p = phase;
            let v = match shape {
                0 => (2.0 * std::f32::consts::PI * p).sin(),
                1 => 1.0 - 4.0 * (p - 0.5).abs(),
                2 => 2.0 * p - 1.0,
                _ => {
                    if p < 0.5 {
                        1.0
                    } else {
                        -1.0
                    }
                }
            };
            let old_sum = 0.0 + v * lfo.depth;
            assert_eq!((0.0 + lfo.tick(48000.0)).to_bits(), old_sum.to_bits());
            assert_eq!(lfo.phase.to_bits(), phase.to_bits());
        }
    }
}

#[test]
fn a_bad_sample_is_caught_even_when_the_voice_ends_in_the_block() {
    let mut synth = Synth::new(48000.0);
    synth.start(1, 220.0, 0.8);
    synth.start(2, 330.0, 0.8);
    synth.voices[0].amp.level = 1e-12;
    synth.voices[0].amp.release();
    synth.voices[0].vel = f32::NAN;
    let (mut l, mut r) = ([0.0; 128], [0.0; 128]);
    synth.render(&mut l, &mut r);
    assert!(l.iter().chain(&r).all(|x| x.is_finite()));
    assert!(l.iter().any(|x| *x != 0.0));
    assert!(synth.voices[0].free());
}
