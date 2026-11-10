//! The two new engines, and the cloud's own rate.

use super::*;

// ------------------------------------------------------- the two new engines
//
// PVSOLA and Hybrid drive the other three rather than sitting beside them, so
// what has to be checked is different: not that each has its own DSP — the
// engines they call already have their own tests — but that the routing is
// intact. Every parameter has to reach the audio, every one has to be inert
// where it should be, and the promised length has to hold, because the
// timeline is laid out from the prediction before anything is rendered.

const NEW_ENGINES: [Algorithm; 2] = [Algorithm::Pvsola, Algorithm::Hybrid];

#[test]
fn the_new_engines_honour_the_promised_length() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    for alg in NEW_ENGINES {
        for ratio in [0.25f32, 0.5, 1.5, 4.0, 12.0] {
            let s = Stretch { ratio, algorithm: alg, ..Default::default() };
            let want = s.output_frames(src.len() as u64) as usize;
            assert_eq!(
                s.process(&src, 1, rate).len(),
                want,
                "{alg:?} at {ratio}x did not produce what it promised"
            );
        }
    }
}

#[test]
fn the_new_engines_keep_the_pitch_they_were_given() {
    let rate = 44_100;
    // A steady tone, because pitch is the thing being measured.
    let src: Vec<f32> = (0..rate as usize)
        .map(|i| 0.5 * (std::f32::consts::TAU * 440.0 * i as f32 / rate as f32).sin())
        .collect();
    for alg in NEW_ENGINES {
        let s = Stretch { ratio: 3.0, semitones: 12.0, algorithm: alg, ..Default::default() };
        let out = s.process(&src, 1, rate);
        assert_eq!(out.len(), src.len() * 3, "{alg:?} changed length while shifting pitch");
        // Coarse, but enough to catch an octave going the wrong way or the
        // resampling being skipped entirely.
        let f = dominant(&out[out.len() / 3..out.len() / 3 + 16384], rate);
        assert!(
            (f - 880.0).abs() < 40.0,
            "{alg:?} shifted to {f:.0} Hz rather than 880"
        );
    }
}

#[test]
fn the_new_engines_survive_a_round_trip_through_their_names() {
    for a in NEW_ENGINES {
        assert_eq!(Algorithm::from_str(a.as_str()), Some(a));
    }
}

#[test]
fn the_new_engines_do_not_amplify_their_own_edges() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    let peak = |v: &[f32]| v.iter().fold(0.0f32, |m, x| m.max(x.abs()));
    let want = peak(&src);
    for alg in NEW_ENGINES {
        for ratio in [2.0f32, 8.0] {
            let s = Stretch { ratio, algorithm: alg, ..Default::default() };
            let got = peak(&s.process(&src, 1, rate));
            assert!(
                got < want * 2.0,
                "{alg:?} at {ratio}x: peak {got:.3} against a source of {want:.3}"
            );
        }
    }
}

/// Every control on the two new panels, one at a time. A knob that is read and
/// dropped is worse than no knob, because you cannot hear that it is broken —
/// and both of these engines have a long chain between the control and the
/// audio for a value to go missing in.
#[test]
fn each_new_engine_control_reaches_the_audio() {
    let rate = 44_100;
    let src = busy(rate, 1.0);

    let pv: Vec<(&str, Box<dyn Fn(&mut Stretch)>)> = vec![
        ("anchorFrames", Box::new(|s: &mut Stretch| s.pvsola.anchor_frames = 24)),
        ("searchMs", Box::new(|s: &mut Stretch| s.pvsola.search_ms = 0.0)),
        ("blend", Box::new(|s: &mut Stretch| s.pvsola.blend = 0.0)),
    ];
    let hy: Vec<(&str, Box<dyn Fn(&mut Stretch)>)> = vec![
        ("fftSize", Box::new(|s: &mut Stretch| s.hybrid.fft_size = 1024)),
        ("timeSpan", Box::new(|s: &mut Stretch| s.hybrid.time_span = 41)),
        ("freqSpan", Box::new(|s: &mut Stretch| s.hybrid.freq_span = 41)),
        ("margin", Box::new(|s: &mut Stretch| s.hybrid.margin = 1.0)),
        ("morphNoise", Box::new(|s: &mut Stretch| s.hybrid.morph_noise = false)),
        ("harmonicLevel", Box::new(|s: &mut Stretch| s.hybrid.harmonic_level = 0.4)),
        ("percussiveLevel", Box::new(|s: &mut Stretch| s.hybrid.percussive_level = 0.4)),
        ("residualLevel", Box::new(|s: &mut Stretch| s.hybrid.residual_level = 0.0)),
    ];

    for (alg, cases) in [(Algorithm::Pvsola, pv), (Algorithm::Hybrid, hy)] {
        let base = Stretch { ratio: 3.0, algorithm: alg, ..Default::default() };
        let plain = base.process(&src, 1, rate);
        for (name, apply) in cases {
            let mut s = base;
            apply(&mut s);
            let d = differs(&plain, &s.process(&src, 1, rate));
            assert!(d > 1e-4, "{alg:?}: {name} did not reach the audio (difference {d:.6})");
        }
    }
}

/// Each new engine's parameters belong to it alone. Moving PVSOLA's anchor
/// rate must not change what the Hybrid does, or the panels are lying about
/// which engine they are configuring.
#[test]
fn the_new_engines_ignore_each_others_controls() {
    let rate = 44_100;
    let src = busy(rate, 1.0);

    let hybrid = Stretch { ratio: 3.0, algorithm: Algorithm::Hybrid, ..Default::default() };
    let mut moved = hybrid;
    moved.pvsola.anchor_frames = 40;
    moved.pvsola.blend = 0.0;
    assert_eq!(
        hybrid.process(&src, 1, rate),
        moved.process(&src, 1, rate),
        "the hybrid engine answered PVSOLA's controls"
    );

    let pvsola = Stretch { ratio: 3.0, algorithm: Algorithm::Pvsola, ..Default::default() };
    let mut moved = pvsola;
    moved.hybrid.residual_level = 0.0;
    moved.hybrid.margin = 1.0;
    assert_eq!(
        pvsola.process(&src, 1, rate),
        moved.process(&src, 1, rate),
        "PVSOLA answered the hybrid engine's controls"
    );
}

/// Both new engines run the older ones underneath, so the grain controls have
/// to reach them the same way they reach everything else — that is the whole
/// premise of one shared control model.
#[test]
fn the_grain_controls_reach_the_new_engines_too() {
    let rate = 44_100;
    let src = busy(rate, 1.0);
    for alg in NEW_ENGINES {
        let base = Stretch { ratio: 3.0, algorithm: alg, ..Default::default() };
        let plain = base.process(&src, 1, rate);

        let mut s = base;
        s.grain.overlap = 4.0;
        assert!(
            differs(&plain, &s.process(&src, 1, rate)) > 1e-4,
            "{alg:?} ignored the overlap control"
        );

        let mut s = base;
        s.grain.envelope = 1.0;
        assert!(
            differs(&plain, &s.process(&src, 1, rate)) > 1e-4,
            "{alg:?} ignored the envelope control"
        );

        // And inert where it should be, which is the other half of the claim.
        let same = Stretch { grain: inert_grain(), ..base };
        assert_eq!(
            plain,
            same.process(&src, 1, rate),
            "{alg:?} moved without being asked"
        );
    }
}

/// Strongest bin, in Hz. Enough to tell an octave from a fifth.
fn dominant(v: &[f32], rate: u32) -> f32 {
    let n = 16384usize.min(v.len().next_power_of_two() / 2).max(1024);
    let mut re: Vec<f32> = v[..n.min(v.len())].to_vec();
    re.resize(n, 0.0);
    let w = audio_core::fft::hann(n);
    for i in 0..n {
        re[i] *= w[i];
    }
    let mut im = vec![0f32; n];
    audio_core::fft::fft(&mut re, &mut im);
    let mut best = 1usize;
    let mut best_e = 0f32;
    for k in 1..n / 2 {
        let e = re[k] * re[k] + im[k] * im[k];
        if e > best_e {
            best_e = e;
            best = k;
        }
    }
    best as f32 * rate as f32 / n as f32
}

/// The panels for the two new engines show the vocoder's and WSOLA's own
/// controls, because both engines *run* those engines underneath. That is a
/// promise about routing, and this is the test that keeps it: a control on a
/// panel that does not reach the audio is the same bug as a control that does
/// nothing, and harder to notice because it looks right.
///
/// The transient detector's two settings are absent here on purpose. They are
/// live in the hybrid — the guard reaches it, so the detector is running — but
/// whether they change the output depends on the material, and they are inert
/// on this source for plain WSOLA too. Their coverage is the WSOLA test above.
#[test]
fn the_new_engine_panels_show_only_controls_that_reach_the_audio() {
    let rate = 44_100;
    let src = busy(rate, 1.0);

    let vocoder: Vec<(&str, Box<dyn Fn(&mut Stretch)>)> = vec![
        ("Analysis window", Box::new(|s: &mut Stretch| s.vocoder.window_ms = 92.0)),
        ("phase lock", Box::new(|s: &mut Stretch| s.vocoder.phase_lock = false)),
        ("Freeze", Box::new(|s: &mut Stretch| s.vocoder.mag_freeze = 0.9)),
        ("Blur", Box::new(|s: &mut Stretch| s.vocoder.mag_blur = 0.8)),
        ("Gate", Box::new(|s: &mut Stretch| s.vocoder.mag_gate = 0.3)),
        ("Freq trust", Box::new(|s: &mut Stretch| s.vocoder.freq_trust = 0.2)),
        ("Phase spread", Box::new(|s: &mut Stretch| s.vocoder.phase_spread = 0.0)),
        ("Peak width", Box::new(|s: &mut Stretch| s.vocoder.peak_width = 12)),
        ("Lock width", Box::new(|s: &mut Stretch| s.vocoder.lock_width = 3.0)),
        ("link stereo", Box::new(|s: &mut Stretch| s.vocoder.stereo_link = true)),
    ];
    let splice: Vec<(&str, Box<dyn Fn(&mut Stretch)>)> = vec![
        ("Search", Box::new(|s: &mut Stretch| s.wsola.search_ms = 0.0)),
        ("Pick", Box::new(|s: &mut Stretch| s.wsola.splice = fx::stretch::Splice::Different)),
        ("Window", Box::new(|s: &mut Stretch| s.wsola.shape = fx::stretch::WinShape::Rect)),
        ("Stride", Box::new(|s: &mut Stretch| s.wsola.stride = 64)),
    ];
    // The detector's own settings only bite where there are onsets to find, so
    // they get a source with unmistakable ones rather than the general-purpose
    // one above. This is a property of the detector rather than of the hybrid's
    // routing, and plain WSOLA behaves the same way — which is why *Detector*
    // itself is not here. Its coverage is at the detector, in
    // `transient::sensitivity_opens_the_gate`, exactly as it is for WSOLA.
    let detector: Vec<(&str, Box<dyn Fn(&mut Stretch)>)> = vec![
        ("Floor", Box::new(|s: &mut Stretch| s.wsola.floor = 0.0)),
        ("Guard", Box::new(|s: &mut Stretch| s.wsola.guard_hops = 12.0)),
    ];

    // Stereo, because `link stereo` has nothing to link otherwise — and the
    // right channel is *delayed*, not a scaled copy. Two channels that are
    // scaled copies of each other come out identical linked or not, because
    // the stretch is deterministic and both channels ask it the same question.
    // A scaled copy here made this test claim the control was dead.
    let delay = 977;
    let stereo: Vec<f32> = (0..src.len())
        .flat_map(|i| [src[i], if i >= delay { src[i - delay] } else { 0.0 }])
        .collect();

    for (alg, shown) in [
        // PVSOLA shows the vocoder's controls and deliberately not WSOLA's.
        (Algorithm::Pvsola, vec![&vocoder]),
        // The hybrid runs both, so it shows both.
        (Algorithm::Hybrid, vec![&vocoder, &splice]),
    ] {
        let base = Stretch { ratio: 3.0, algorithm: alg, ..Default::default() };
        let plain = base.process(&stereo, 2, rate);
        for group in shown {
            for (name, apply) in group.iter() {
                let mut s = base;
                apply(&mut s);
                let d = differs(&plain, &s.process(&stereo, 2, rate));
                assert!(d > 1e-6, "{alg:?}: the panel shows {name}, but it does not reach the audio");
            }
        }
    }

    // The hybrid's Transients group, on material that has transients. That
    // these move the audio at all is also the proof that the hybrid really does
    // hold the detector on: nothing on this list is reachable otherwise.
    let hits: Vec<f32> = {
        let mut v = vec![0f32; rate as usize];
        let mut seed = 99u32;
        for beat in 0..8 {
            let at = beat * (rate as usize / 8);
            for i in 0..1200 {
                if at + i >= v.len() {
                    break;
                }
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                let noise = ((seed >> 16) as f32 / 32768.0) - 1.0;
                v[at + i] += noise * (1.0 - i as f32 / 1200.0).powi(3) * 0.9;
            }
        }
        v
    };
    let base = Stretch { ratio: 3.0, algorithm: Algorithm::Hybrid, ..Default::default() };
    let plain = base.process(&hits, 1, rate);
    for (name, apply) in detector.iter() {
        let mut s = base;
        apply(&mut s);
        let d = differs(&plain, &s.process(&hits, 1, rate));
        assert!(d > 1e-6, "Hybrid: the panel shows {name}, but it does not reach the audio");
    }

    // The other half of the claim: PVSOLA finds its splice with its own search,
    // so WSOLA's splice group would be decoration on that panel — and is not
    // shown there. If this ever starts failing, the panel should gain them.
    let base = Stretch { ratio: 3.0, algorithm: Algorithm::Pvsola, ..Default::default() };
    let plain = base.process(&stereo, 2, rate);
    for (name, apply) in splice.iter() {
        let mut s = base;
        apply(&mut s);
        assert_eq!(
            plain,
            s.process(&stereo, 2, rate),
            "PVSOLA answered WSOLA's {name}, so its panel should be showing it"
        );
    }
}

/// The read head has somewhere to sit.
///
/// `scan` could stop the sweep, but only ever parked it at frame zero — so a
/// cloud could be made from one instant and that instant was always the start
/// of the file. There was no way to say "make a cloud from eight seconds in",
/// which is most of what a granular instrument is for.
#[test]
fn a_parked_cloud_reads_from_wherever_the_head_was_put() {
    let sr = 48_000u32;
    let frames = sr as usize; // one second
    let g = |position: f32| fx::Grain {
        // Scan at nothing: the head does not move, so every grain comes from
        // one place and that place is the thing under test.
        scan: 0.0,
        density_hz: 40.0,
        position,
        ..fx::Grain::default()
    };

    for want in [0.0f32, 0.25, 0.5, 0.9] {
        let evs = fx::grain::grains(frames, sr, 4.0, 0.0, 40.0, &g(want));
        assert!(!evs.is_empty(), "no grains at all");
        let at = want * frames as f32;
        for e in &evs {
            assert!(
                (e.src_frame - at).abs() < 2.0,
                "parked at {want} the cloud read from {} instead of {at}",
                e.src_frame
            );
        }
    }
}

/// And zero is exactly where the sweep already began, in both directions.
///
/// Invariant nine. A reverse scan starts at the end of the file, and the offset
/// is measured from wherever the sweep begins — so a document written before
/// this control existed reads from the same frames it always did.
#[test]
fn a_read_position_of_zero_changes_nothing() {
    let sr = 48_000u32;
    let frames = sr as usize / 2;
    for scan in [1.0f32, 0.5, -1.0] {
        let base = fx::Grain { scan, density_hz: 30.0, ..fx::Grain::default() };
        let with = fx::Grain { position: 0.0, ..base };
        let a = fx::grain::grains(frames, sr, 3.0, 0.0, 40.0, &base);
        let b = fx::grain::grains(frames, sr, 3.0, 0.0, 40.0, &with);
        assert_eq!(a.len(), b.len(), "scan {scan}");
        for (x, y) in a.iter().zip(&b) {
            assert_eq!(x.src_frame, y.src_frame, "scan {scan}");
        }
    }
}

/// The picture has to enumerate every layer the renderer runs.
///
/// `grains` ran one schedule while `BlockRenderer` ran up to sixteen, so
/// everything drawn from it — the cloud, the pad, the read band — was a
/// sixteenth of what was being heard, and a stack of layers looked like a
/// single thin stream however high it was set. Invariant three: one
/// enumeration, shared.
#[test]
fn the_enumeration_counts_every_layer_the_renderer_runs() {
    let sr = 48_000u32;
    let frames = sr as usize;
    let one = fx::Grain { density_hz: 60.0, layers: 1, ..fx::Grain::default() };

    let single = fx::grain::grains_layered(frames, sr, 4.0, 0.0, 40.0, &one).len();
    assert!(single > 100, "not enough grains to measure with: {single}");

    for n in [2u32, 4, 16] {
        let many = fx::Grain { layers: n, ..one };
        let got = fx::grain::grains_layered(frames, sr, 4.0, 0.0, 40.0, &many).len();
        // Each layer runs the same schedule, so the count is the layer count
        // over. Exact rather than approximate: a layer half-enumerated is the
        // same bug in a quieter form.
        assert_eq!(got, single * n as usize, "{n} layers enumerated as {got}");
    }
}

/// And they are not all the same grains in the same places.
///
/// A layer is the source read from somewhere else with its own seed. Counting
/// right while stacking identical copies would look correct and sound like one
/// layer turned up.
#[test]
fn each_layer_reads_its_own_place() {
    let sr = 48_000u32;
    let g = fx::Grain {
        density_hz: 40.0,
        layers: 4,
        layer_scatter: 0.8,
        layer_scatter_ms: 300.0,
        ..fx::Grain::default()
    };
    let evs = fx::grain::grains_layered(sr as usize, sr, 4.0, 0.0, 40.0, &g);
    // Grains landing on the same output moment must not all read the same
    // frame of the source.
    let early: Vec<f32> = evs.iter().filter(|e| e.out_frame < 4_000).map(|e| e.src_frame).collect();
    assert!(early.len() >= 4, "only {} grains at the start", early.len());
    let lo = early.iter().cloned().fold(f32::INFINITY, f32::min);
    let hi = early.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    assert!(hi - lo > 1_000.0, "every layer read within {} frames of the others", hi - lo);
}

/// A sampled schedule is the real one, thinned — not a different one.
///
/// The pictures never draw more than a few thousand marks, so the whole
/// enumeration was built and four fifths of it thrown away. Asking only for the
/// grains that survive is worth doing only if they are the same grains: every
/// one has to be an event the full enumeration also contains, the count has to
/// be honest, and the sample has to be spread over the whole render rather than
/// bunched at the start.
#[test]
fn a_sampled_schedule_is_a_faithful_thinning_of_the_whole_one() {
    let sr = 48_000u32;
    let frames = sr as usize;
    let g = fx::Grain {
        density_hz: 120.0,
        layers: 4,
        position_jitter_ms: 90.0,
        pitch_jitter_semis: 5.0,
        pan_spread: 0.7,
        ..fx::Grain::default()
    };

    let full = fx::grain::grains_layered(frames, sr, 8.0, 0.0, 40.0, &g);
    let (sample, total) = fx::grain::grains_sampled(frames, sr, 8.0, 0.0, 40.0, &g, 500, None);

    assert_eq!(total, full.len(), "the reported total is not the real one");
    assert!(!sample.is_empty());
    assert!(sample.len() <= 700, "asked for 500 and got {}", sample.len());

    // In time order, which everything downstream assumes.
    assert!(sample.windows(2).all(|w| w[0].out_frame <= w[1].out_frame));

    // Every sampled grain is a grain the full enumeration also has — same
    // index, same source frame, same size. A sample that invented grains would
    // be a different cloud drawn convincingly.
    let real: std::collections::HashSet<(u64, u64, u32)> = full
        .iter()
        .map(|e| (e.index, e.out_frame, e.size))
        .collect();
    for e in &sample {
        assert!(
            real.contains(&(e.index, e.out_frame, e.size)),
            "grain {} at {} is not in the real schedule",
            e.index,
            e.out_frame
        );
    }

    // Spread over the whole render, not bunched at the front.
    let last = full.last().unwrap().out_frame;
    let reach = sample.last().unwrap().out_frame;
    assert!(
        reach as f64 > last as f64 * 0.9,
        "the sample stops at {reach} of {last}"
    );

    // More than one layer is represented, or it is a sample of one schedule
    // rather than of the stack. Layers cannot be told apart by index — every
    // layer runs the same ordinals — so they are told apart the way they
    // actually differ: each is laid down at its own offset within the hop, so
    // one ordinal appears at several output frames.
    let first = sample[0].index;
    let places = sample
        .iter()
        .filter(|e| e.index == first)
        .map(|e| e.out_frame)
        .collect::<std::collections::HashSet<_>>();
    assert!(places.len() > 1, "grain {first} appears at only one place — one layer");
}

/// Wrapped, the file is a loop: a grain may start anywhere and reads on past
/// the end from the beginning.
///
/// Unwrapped, a grain that would read off the end is held back to the last
/// position where it fits, and one that reads past it anyway holds its final
/// sample — silence with a step in front of it. Wrapped, neither happens.
#[test]
fn a_wrapped_file_has_no_last_safe_position() {
    let sr = 48_000u32;
    let frames = sr as usize / 2;
    // A window that is a quarter of the file, which is what makes the limit
    // bite hard enough to see.
    let win = 125.0;

    let held = fx::Grain { density_hz: 60.0, wrap: false, ..fx::Grain::default() };
    let looped = fx::Grain { wrap: true, ..held };

    let a = fx::grain::grains(frames, sr, 4.0, 0.0, win, &held);
    let b = fx::grain::grains(frames, sr, 4.0, 0.0, win, &looped);

    let last_of = |v: &[fx::grain::GrainEvent]| {
        v.iter().map(|e| e.src_frame).fold(0f32, f32::max)
    };
    let held_reach = last_of(&a) / frames as f32;
    let loop_reach = last_of(&b) / frames as f32;

    assert!(held_reach < 0.8, "held grains reached {held_reach:.2} of the file");
    assert!(
        loop_reach > 0.9,
        "wrapped grains should be able to start anywhere, reached {loop_reach:.2}"
    );
}

/// And the read itself comes back round rather than holding a sample.
#[test]
fn a_wrapped_grain_reads_the_start_of_the_file_after_the_end() {
    let sr = 48_000u32;
    let frames = sr as usize / 4;
    // A ramp, so where in the file a sample came from is readable from its
    // value: the last sample is 1.0 and the first is 0.0.
    let src: Vec<f32> = (0..frames).map(|i| i as f32 / frames as f32).collect();

    let g = fx::Grain {
        density_hz: 20.0,
        wrap: true,
        position: 0.98,
        scan: 0.0,
        ..fx::Grain::default()
    };
    let out = fx::grain::granular(&src, 1, sr, 2.0, 0.0, 120.0, &g);

    // Parked at 98% with a 120 ms window on a 250 ms file, every grain runs off
    // the end. Holding would make the tail a flat line at 1.0; wrapping brings
    // it back to values near zero.
    let low = out.iter().filter(|v| **v > 0.0001 && **v < 0.25).count();
    assert!(
        low > out.len() / 50,
        "only {low} samples of {} came from the start of the file",
        out.len()
    );
}

/// Unwrapped is untouched. Invariant nine.
#[test]
fn wrapping_is_inert_when_it_is_off() {
    let sr = 48_000u32;
    let frames = sr as usize / 2;
    let src: Vec<f32> = (0..frames).map(|i| (i as f32 / 50.0).sin()).collect();
    let g = fx::Grain {
        density_hz: 40.0,
        position_jitter_ms: 60.0,
        pitch_jitter_semis: 4.0,
        size_jitter: 0.4,
        wrap: false,
        ..fx::Grain::default()
    };
    let a = fx::grain::granular(&src, 1, sr, 3.0, 0.0, 60.0, &g);
    let b = fx::grain::granular(&src, 1, sr, 3.0, 0.0, 60.0, &fx::Grain { ..g });
    assert_eq!(a, b);
}

/// Zooming in has to show *more* grains, not fewer.
///
/// The sampler used to spend its cap across the whole document. A cloud of three
/// million grains sent eight thousand, spread evenly — so a window holding a
/// thousandth of the file held about eight of them, and zoomed all the way in
/// you saw three or four marks against a wall of sound. The picture stopped
/// describing the audio at exactly the magnification where it mattered most.
#[test]
fn a_window_spends_the_grain_budget_inside_itself() {
    let sr = 48_000;
    let frames = sr as usize * 10;
    let mut g = fx::Grain::default();
    g.density_hz = 300.0;
    g.layers = 4;
    let cap = 2_000;

    let (whole, total) = fx::grain::grains_sampled(frames, sr, 4.0, 0.0, 40.0, &g, cap, None);
    assert!(total > cap * 10, "not enough grains to be worth sampling: {total}");

    // A hundredth of the output, in the middle.
    let out_frames = (frames as f32 * 4.0) as u64;
    let lo = out_frames / 2;
    let hi = lo + out_frames / 100;
    let (windowed, _) =
        fx::grain::grains_sampled(frames, sr, 4.0, 0.0, 40.0, &g, cap, Some((lo, hi)));

    let inside = |v: &[fx::grain::GrainEvent]| {
        v.iter().filter(|e| e.out_frame >= lo && e.out_frame <= hi).count()
    };
    let before = inside(&whole);
    let after = inside(&windowed);

    assert!(
        after > before * 10,
        "windowing bought almost nothing: {before} grains in view before, {after} after",
    );
    // And it still respects the budget rather than sending everything.
    assert!(
        windowed.len() <= cap * 2,
        "the window ignored the cap: {} grains for a cap of {cap}",
        windowed.len(),
    );
}

/// Without a window, nothing changes. The whole-document picture is what the
/// overview and a zoomed-out editor both draw.
#[test]
fn no_window_still_samples_the_whole_document() {
    let sr = 48_000;
    let frames = sr as usize * 4;
    let mut g = fx::Grain::default();
    g.density_hz = 200.0;
    let cap = 1_000;
    let (all, _) = fx::grain::grains_sampled(frames, sr, 2.0, 0.0, 40.0, &g, cap, None);
    assert!(!all.is_empty());
    let last = all.iter().map(|e| e.out_frame).max().unwrap();
    let out_frames = (frames as f32 * 2.0) as u64;
    assert!(
        last > out_frames / 2,
        "the unwindowed sample stopped at {last} of {out_frames} — it is not covering the file",
    );
}

// ── the cloud's own rate ─────────────────────────────────────────────────────
//
// A grain is an event: the same number are laid down every second whether they
// are short or long. The window used to decide the rate, which is why
// lengthening a grain thinned the cloud.

#[test]
fn the_window_no_longer_decides_how_many_grains_there_are() {
    let sr = 48_000;
    let mut g = fx::Grain::default();
    g.rate_hz = 50.0;

    // Two windows an order of magnitude apart, same rate.
    let short = fx::grain::plan(sr as usize, sr, 1.0, 20.0, &g);
    let long = fx::grain::plan(sr as usize, sr, 1.0, 500.0, &g);

    assert_eq!(short.hop, long.hop, "the window moved the hop");
    // Fifty a second at 48k is a grain every 960 frames.
    assert_eq!(short.hop, 960, "the rate is not what was asked for");
    // And the grains really are the lengths asked for; only the spacing is
    // fixed. A cloud of long grains at the same rate is a denser overlap, not
    // fewer events.
    assert!(long.base_size > short.base_size * 20, "the window stopped mattering entirely");
}

#[test]
fn without_a_rate_the_old_rule_still_runs() {
    let sr = 48_000;
    let g = fx::Grain::default();
    assert_eq!(g.rate_hz, 0.0, "the default changed, and old documents with it");

    // Window over overlap, exactly as before: 40 ms at 2x is a 20 ms hop.
    let p = fx::grain::plan(sr as usize, sr, 1.0, 40.0, &g);
    assert_eq!(p.hop, (0.020 * sr as f32) as usize);

    // And doubling the window still halves the rate, which is the behaviour
    // `rate_hz` exists to replace rather than to delete.
    let wide = fx::grain::plan(sr as usize, sr, 1.0, 80.0, &g);
    assert_eq!(wide.hop, p.hop * 2);
}

#[test]
fn the_cloud_rate_leaves_the_window_engines_alone() {
    let sr = 48_000.0;
    let mut g = fx::Grain::default();
    g.rate_hz = 200.0;

    // `hop_frames` is what WSOLA, the vocoder, PVSOLA and the hybrid read. It
    // must not see this at all: a 200 Hz rate against an 8192-point window is
    // the 15x overlap that measured unplayable, and it is meaningless there
    // anyway — that hop is how far a transform advances.
    let win = 8192;
    let with_rate = fx::stretch::hop_frames(&g, win, sr);
    let without = fx::stretch::hop_frames(&fx::Grain::default(), win, sr);
    assert_eq!(with_rate, without, "the cloud's rate reached a window engine");
}
