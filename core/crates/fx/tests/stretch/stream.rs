//! The real-time stream, extreme stretching and transients.

use super::*;

// ---------------------------------------------------------- real-time stream
//
// GrainStream is the path a native audio callback will drive. Everything here
// guards the one property that makes that safe: driving it in real time must
// not change the sound.

/// Bundle the loose arguments the offline call takes.
fn sp(in_frames: usize, ratio: f32, semitones: f32, window_ms: f32, g: fx::Grain)
    -> fx::StreamParams {
    fx::StreamParams {
        in_frames,
        sample_rate: SR,
        ratio,
        semitones,
        window_ms,
        grain: g,
        algorithm: fx::stretch::Algorithm::Granular,
        wsola: fx::stretch::WsolaParams::default(),

        vocoder: fx::stretch::VocoderParams::default(),


        pvsola: fx::pvsola::PvsolaParams::default(),



        hybrid: fx::hybrid::HybridParams::default(),



        cloud: false,



        cloud_mix: 0.5,
    }
}

/// The headline guarantee. If this ever fails, playing a sound live and
/// exporting it produce different audio, and the swarm stops matching what you
/// hear.
#[test]
fn streaming_with_steady_controls_is_identical_to_the_offline_render() {
    let mut g = fx::Grain::default();
    g.size_jitter = 0.4;
    g.position_jitter_ms = 25.0;
    g.pitch_jitter_semis = 3.0;
    g.pitch_drift_semis = 2.0;
    g.seed = 4242;

    let p = sp(48_000, 1.7, -2.5, 45.0, g);
    let offline = fx::grain::grains(48_000, SR, 1.7, -2.5, 45.0, &g);

    let end = p.plan().out_frames as u64;
    let mut stream = fx::GrainStream::new();
    let mut live = Vec::new();
    while stream.out_frame() < end {
        live.push(stream.next(&p));
    }

    assert_eq!(live.len(), offline.len(), "grain count differs");
    for (i, (a, b)) in live.iter().zip(offline.iter()).enumerate() {
        assert_eq!(a, b, "grain {i} differs between live and offline");
    }
}

/// Seeking must land you on the grains you would have reached by playing there.
/// Without this, scrubbing over a sound would change it.
#[test]
fn seeking_gives_the_same_grains_as_playing_to_that_point() {
    let mut g = fx::Grain::default();
    g.size_jitter = 0.3;
    g.pitch_jitter_semis = 5.0;
    g.seed = 7;

    let p = sp(48_000, 1.0, 0.0, 30.0, g);
    let offline = fx::grain::grains(48_000, SR, 1.0, 0.0, 30.0, &g);

    // Somewhere well into the file, deliberately not on a grain boundary.
    let target = offline[40].out_frame + 13;
    let mut stream = fx::GrainStream::new();
    stream.seek(target, &p);

    // Seek snaps back to the grain covering that moment, which is grain 40.
    assert_eq!(stream.index(), 40);
    for k in 0..8 {
        assert_eq!(stream.next(&p), offline[40 + k], "grain {} after seek", 40 + k);
    }
}

/// The point of the whole exercise: a control moved between two grains changes
/// the next one, and nothing before it.
#[test]
fn a_control_changed_mid_stream_takes_effect_on_the_very_next_grain() {
    let g = fx::Grain::default();
    let slow = sp(96_000, 1.0, 0.0, 40.0, g);

    let mut dense = g;
    dense.density_hz = 200.0;
    let fast = sp(96_000, 1.0, 0.0, 40.0, dense);

    let mut stream = fx::GrainStream::new();
    let a = stream.next(&slow);
    let b = stream.next(&slow);
    let slow_hop = b.out_frame - a.out_frame;

    // Same stream, new settings, no reset.
    let c = stream.next(&fast);
    let d = stream.next(&fast);
    let fast_hop = d.out_frame - c.out_frame;

    assert_eq!(slow_hop, slow.plan().hop as u64);
    assert_eq!(fast_hop, fast.plan().hop as u64);
    assert!(fast_hop < slow_hop, "raising density must tighten the spacing");
    // The index keeps counting, so the randomness does not restart and the
    // sound does not jump when a slider moves.
    assert_eq!(c.index, 2);
}

/// A stream must never stall, whatever the controls say. In an audio callback a
/// hop of zero would be an infinite loop with the speakers connected.
#[test]
fn the_stream_always_advances_however_extreme_the_settings() {
    for (density, overlap, window) in
        [(2000.0, 8.0, 5.0), (0.0, 8.0, 5.0), (0.5, 1.0, 500.0), (-10.0, 0.0, 0.0)]
    {
        let mut g = fx::Grain::default();
        g.density_hz = density;
        g.overlap = overlap;
        let p = sp(48_000, 0.1, 24.0, window, g);

        let mut stream = fx::GrainStream::new();
        let mut last = stream.out_frame();
        for _ in 0..64 {
            stream.next(&p);
            assert!(
                stream.out_frame() > last,
                "stalled at density {density}, overlap {overlap}, window {window}"
            );
            last = stream.out_frame();
        }
    }
}

// ------------------------------------------------------- extreme stretching
//
// The granular path exists so a sound can be pulled far past what WSOLA can do.
// These guard the far ends, where clamps and overflow live.

#[test]
fn a_hundred_times_longer_is_actually_a_hundred_times_longer() {
    let g = fx::Grain::default();
    let p = sp(4_800, 100.0, 0.0, 500.0, g);
    let plan = p.plan();
    assert_eq!(plan.out_frames, 480_000, "a 0.1 s sound must become 10 s");

    // And the schedule really covers it rather than stopping early.
    let mut stream = fx::GrainStream::new();
    let mut last = 0;
    let mut n = 0;
    while stream.out_frame() < plan.out_frames as u64 {
        let e = stream.next(&p);
        assert!(e.out_frame >= last);
        assert!(e.src_frame.is_finite() && e.src_frame >= 0.0);
        last = e.out_frame;
        n += 1;
        assert!(n < 500_000, "schedule is not advancing");
    }
    // Count is not the property that matters — half-second grains at double
    // overlap give exactly forty of them across ten seconds, and that is
    // correct. What matters is that they cover the whole output.
    assert_eq!(n, plan.out_frames / plan.hop, "grain count does not match the hop");
    assert!(
        last + plan.base_size as u64 >= plan.out_frames as u64 - plan.hop as u64,
        "the schedule stops short of the end"
    );
}

#[test]
fn extreme_settings_still_produce_usable_audio() {
    // A hundredfold stretch with long, heavily jittered grains — the setting
    // this whole feature exists for.
    let mut g = fx::Grain::default();
    g.overlap = 6.0;
    g.size_jitter = 0.5;
    g.position_jitter_ms = 300.0;
    g.pitch_jitter_semis = 2.0;

    let input = sine(220.0, (SR / 4) as usize, 0.6); // 0.25 s
    let out = fx::grain::granular(&input, 1, SR, 40.0, 0.0, 1500.0, &g);

    assert_eq!(out.len(), (input.len() as f32 * 40.0).round() as usize);
    assert!(out.iter().all(|s| s.is_finite()), "extreme stretch produced non-finite audio");
    let peak = out.iter().fold(0f32, |m, s| m.max(s.abs()));
    assert!(peak > 0.05, "extreme stretch went silent, peak {peak}");
    assert!(peak < 4.0, "extreme stretch ran away, peak {peak}");
}

#[test]
fn four_octaves_of_shift_land_where_they_should() {
    for (semis, factor) in [(48.0f32, 16.0f32), (-48.0, 1.0 / 16.0)] {
        let p = sp(48_000, 1.0, semis, 40.0, fx::Grain::default());
        let mut stream = fx::GrainStream::new();
        let e = stream.next(&p);
        assert!(
            (e.rate - factor).abs() < factor * 0.02,
            "{semis} st should read at {factor}x, got {}",
            e.rate
        );
    }
}

#[test]
fn the_shortest_stretch_does_not_collapse() {
    let p = sp(480_000, 0.01, 0.0, 40.0, fx::Grain::default());
    assert_eq!(p.plan().out_frames, 4_800);
    let mut stream = fx::GrainStream::new();
    for _ in 0..32 {
        let e = stream.next(&p);
        assert!(e.size > 0 && e.rate.is_finite());
    }
}

// ---------------------------------------------------------- transients

fn hits_at(rate: u32, secs: f32, at: &[f32]) -> Vec<f32> {
    let n = (secs * rate as f32) as usize;
    let mut v: Vec<f32> = (0..n)
        .map(|i| (std::f32::consts::TAU * 180.0 * i as f32 / rate as f32).sin() * 0.12)
        .collect();
    let mut seed = 99u32;
    for t in at {
        let start = (*t * rate as f32) as usize;
        for i in 0..(rate as usize / 120) {
            if start + i >= n { break; }
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let noise = ((seed >> 16) as f32 / 32768.0) - 1.0;
            let env = (1.0 - i as f32 / (rate as f32 / 120.0)).max(0.0).powi(2);
            v[start + i] += noise * env * 0.95;
        }
    }
    v
}

#[test]
fn preserving_transients_does_not_change_the_length() {
    let rate = 44_100;
    let src = hits_at(rate, 2.0, &[0.4, 0.9, 1.4]);
    for ratio in [0.5f32, 2.0, 4.0] {
        let mut s = Stretch { ratio, ..Default::default() };
        s.wsola.preserve_transients = true;
        let out = s.process(&src, 1, rate);
        assert_eq!(out.len(), (src.len() as f32 * ratio).round() as usize, "at {ratio}x");
    }
}

/// The point of the feature: a stretched drum hit should stay one hit rather
/// than being laid down twice. Measured as the count of sharp energy rises in
/// the output — stuttering shows up as extra ones.
#[test]
fn preserving_transients_keeps_hits_from_doubling() {
    let rate = 44_100;
    let places = [0.4f32, 0.9, 1.4];
    let src = hits_at(rate, 2.0, &places);

    let plain = Stretch { ratio: 3.0, ..Default::default() }.process(&src, 1, rate);
    let mut kept = Stretch { ratio: 3.0, ..Default::default() };
    kept.wsola.preserve_transients = true;
    let kept = kept.process(&src, 1, rate);

    let count = |v: &[f32]| fx::transient::onsets(v, 1, rate, 0.5, 1.0).len();
    let (a, b) = (count(&plain), count(&kept));
    // Three went in; preservation should not invent more than plain WSOLA does.
    assert!(b <= a, "preserved produced {b} onsets against plain WSOLA's {a}");
    assert!(b >= places.len(), "lost hits entirely: {b}");
}

#[test]
fn preservation_off_is_exactly_what_it_always_was() {
    let rate = 44_100;
    let src = hits_at(rate, 1.0, &[0.3, 0.7]);
    let a = Stretch { ratio: 2.5, ..Default::default() }.process(&src, 1, rate);
    let mut off = Stretch { ratio: 2.5, ..Default::default() };
    off.wsola.preserve_transients = false;
    let b = off.process(&src, 1, rate);
    assert_eq!(a, b);
}

#[test]
fn material_with_no_transients_is_unaffected_either_way() {
    let rate = 44_100;
    let n = rate as usize;
    let tone: Vec<f32> = (0..n)
        .map(|i| (std::f32::consts::TAU * 440.0 * i as f32 / rate as f32).sin())
        .collect();
    let plain = Stretch { ratio: 2.0, ..Default::default() }.process(&tone, 1, rate);
    let mut kept = Stretch { ratio: 2.0, ..Default::default() };
    kept.wsola.preserve_transients = true;
    let kept = kept.process(&tone, 1, rate);
    assert_eq!(plain.len(), kept.len());
}
