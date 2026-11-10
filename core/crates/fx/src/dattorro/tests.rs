use super::*;

const SR: u32 = 48_000;
fn tone(hz: f32, n: usize) -> Vec<f32> {
    (0..n)
        .map(|i| (TAU * hz * i as f32 / SR as f32).sin() * 0.25)
        .collect()
}
fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| v * v).sum::<f32>() / x.len().max(1) as f32).sqrt()
}

#[test]
fn the_published_notch_rejects_its_centre_more_than_a_distant_tone() {
    let mut centre = tone(1000.0, 48000);
    let mut away = tone(3000.0, 48000);
    let mut a = MusicalFilter::new(MusicalFilterMode::Notch);
    a.process(&mut centre, 1, SR);
    let mut b = MusicalFilter::new(MusicalFilterMode::Notch);
    b.process(&mut away, 1, SR);
    assert!(rms(&centre[2000..]) < rms(&away[2000..]) * 0.15);
}

#[test]
fn the_resonator_passes_its_centre_more_than_a_distant_tone() {
    let mut centre = tone(1000.0, 48000);
    let mut away = tone(3000.0, 48000);
    let mut a = MusicalFilter::new(MusicalFilterMode::Resonator);
    a.process(&mut centre, 1, SR);
    let mut b = MusicalFilter::new(MusicalFilterMode::Resonator);
    b.process(&mut away, 1, SR);
    assert!(rms(&centre[2000..]) > rms(&away[2000..]) * 5.0);
}

#[test]
fn regalia_mitra_boost_and_cut_move_the_same_band_opposite_ways() {
    let src = tone(1000.0, 24000);
    let mut up = src.clone();
    let mut down = src.clone();
    let mut a = MusicalFilter::new(MusicalFilterMode::Regalia);
    a.set("gainDb", 12.0);
    a.process(&mut up, 1, SR);
    let mut b = MusicalFilter::new(MusicalFilterMode::Regalia);
    b.set("gainDb", -12.0);
    b.process(&mut down, 1, SR);
    assert!(rms(&up[2000..]) > rms(&src[2000..]) * 1.8);
    assert!(rms(&down[2000..]) < rms(&src[2000..]) * 0.65);
}

#[test]
fn chamberlin_exposes_distinct_simultaneous_responses() {
    let src = tone(200.0, 12000);
    let mut low = src.clone();
    let mut high = src.clone();
    let mut l = Chamberlin::default();
    l.process(&mut low, 1, SR);
    let mut h = Chamberlin::default();
    h.set("lowOn", 0.0);
    h.set("lowAmp", 0.0);
    h.set("highOn", 1.0);
    h.set("highAmp", 1.0);
    h.process(&mut high, 1, SR);
    assert!(rms(&low[1000..]) > rms(&high[1000..]) * 2.0);
}

#[test]
fn moving_delay_keeps_length_and_is_independent_of_block_boundaries() {
    let src = tone(440.0, 8192);
    let mut whole = src.clone();
    let mut split = src.clone();
    let mut a = ModDelay::new(ModDelayMode::Chorus, SR, 1);
    a.process(&mut whole, 1, SR);
    let mut b = ModDelay::new(ModDelayMode::Chorus, SR, 1);
    for block in split.chunks_mut(127) {
        b.process(block, 1, SR)
    }
    assert_eq!(whole.len(), src.len());
    assert_eq!(whole, split);
}

#[test]
fn pn_noise_is_deterministic_but_the_seed_selects_another_sequence() {
    let mut a = vec![0.0; 1024];
    let mut b = a.clone();
    let mut c = a.clone();
    let mut x = PnNoise::new(false);
    x.process(&mut a, 1, SR);
    let mut y = PnNoise::new(false);
    y.process(&mut b, 1, SR);
    let mut z = PnNoise::new(false);
    z.set("seed", 12345.0);
    z.process(&mut c, 1, SR);
    assert_eq!(a, b);
    assert_ne!(a, c);
    assert!(a.iter().all(|v| v.is_finite()));
}

#[test]
fn the_plate_is_causal_and_keeps_ringing_after_the_impulse() {
    let mut x = vec![0.0; SR as usize * 2];
    x[0] = 1.0;
    let mut p = Plate::new(SR);
    p.set("dry", 0.0);
    p.set("wet", 1.0);
    p.process(&mut x, 1, SR);
    assert!(x.iter().all(|v| v.is_finite()));
    assert!(
        x[1000..].iter().any(|v| v.abs() > 1e-7),
        "the tank produced no tail"
    );
    let middle = rms(&x[SR as usize / 2..SR as usize]);
    let late = rms(&x[SR as usize + SR as usize / 2..]);
    assert!(
        late < middle,
        "decay did not decay: middle {middle}, late {late}"
    );
}

#[test]
fn standalone_allpass_preserves_steady_state_level_and_changes_phase() {
    let src = tone(997.0, 24000);
    let mut out = src.clone();
    let mut fx = AllpassDiffuser::new(SR, 1);
    fx.process(&mut out, 1, SR);
    assert!((rms(&out[4000..]) / rms(&src[4000..]) - 1.0).abs() < 0.03);
    assert_ne!(&out[4000..5000], &src[4000..5000]);
}

#[test]
fn damping_removes_high_frequency_more_than_low_frequency() {
    let mut low = tone(200.0, 24000);
    let mut high = tone(8000.0, 24000);
    let mut a = DampingFilter::default();
    a.set("cutoffHz", 1000.0);
    a.process(&mut low, 1, SR);
    let mut b = DampingFilter::default();
    b.set("cutoffHz", 1000.0);
    b.process(&mut high, 1, SR);
    assert!(rms(&low[2000..]) > rms(&high[2000..]) * 2.0);
}

#[test]
fn echo_places_the_impulse_at_the_requested_delay_and_repeats_it() {
    let mut x = vec![0.0; 24000];
    x[0] = 1.0;
    let mut e = Echo::new(SR, 1);
    e.set("delayMs", 100.0);
    e.set("feedback", 0.5);
    e.set("damping", 0.0);
    e.set("dry", 0.0);
    e.set("wet", 1.0);
    e.process(&mut x, 1, SR);
    assert!(x[4799].abs() < 1e-6 && x[4800] > 0.99);
    assert!((x[9600] - 0.5).abs() < 0.02);
}

#[test]
fn leslie_moves_a_mono_tone_across_stereo_without_changing_length() {
    let mono = tone(440.0, 24000);
    let mut stereo: Vec<f32> = mono.iter().flat_map(|x| [*x, *x]).collect();
    let before = stereo.len();
    let mut l = Leslie::new(SR, 2);
    l.process(&mut stereo, 2, SR);
    assert_eq!(stereo.len(), before);
    assert!(stereo.chunks_exact(2).any(|f| (f[0] - f[1]).abs() > 1e-4));
}

#[test]
fn single_bit_pn_is_bipolar_deterministic_and_never_sticks() {
    let mut a = vec![0.0; 4096];
    let mut b = a.clone();
    let mut x = SingleBitPn::default();
    x.process(&mut a, 1, SR);
    let mut y = SingleBitPn::default();
    y.process(&mut b, 1, SR);
    assert_eq!(a, b);
    assert!(a.iter().any(|v| *v > 0.0) && a.iter().any(|v| *v < 0.0));
    assert!(a.iter().all(|v| (*v).abs() <= 1.0));
}

fn crossings(x: &[f32]) -> usize {
    x.windows(2).filter(|w| w[0] <= 0.0 && w[1] > 0.0).count()
}

#[test]
fn harmonizer_moves_pitch_an_octave_without_changing_length() {
    let mut x = tone(440.0, SR as usize);
    let n = x.len();
    let mut p = PitchShifter::new(SR, 1);
    p.set("semitones", 12.0);
    p.set("wet", 1.0);
    p.set("dry", 0.0);
    p.process(&mut x, 1, SR);
    assert_eq!(x.len(), n);
    let cycles = crossings(&x[12000..]);
    assert!(
        (cycles as i32 - 660).abs() < 30,
        "expected roughly 880 Hz after warmup, got {cycles} cycles"
    );
}

#[test]
fn detune_makes_two_opposed_pitch_copies_in_stereo() {
    let mono = tone(440.0, 24000);
    let mut x: Vec<f32> = mono.iter().flat_map(|v| [*v, *v]).collect();
    let mut d = Detune::new(SR, 2);
    d.process(&mut x, 2, SR);
    assert!(x
        .chunks_exact(2)
        .skip(4000)
        .any(|f| (f[0] - f[1]).abs() > 1e-3));
}

#[test]
fn doubler_has_a_real_second_arrival() {
    let mut x = vec![0.0; 12000];
    x[0] = 1.0;
    let mut d = Doubler::new(SR, 1);
    d.set("delayMs", 40.0);
    d.set("variationMs", 0.0);
    d.set("dry", 0.0);
    d.set("wet", 1.0);
    d.process(&mut x, 1, SR);
    assert!(x[1919].abs() < 1e-6 && x[1920].abs() > 0.5);
}

#[test]
fn receding_doppler_source_lowers_pitch_without_changing_length() {
    let mut x = tone(440.0, SR as usize);
    let n = x.len();
    let mut d = Doppler::new(SR, 1);
    d.set("distanceMs", 40.0);
    d.set("velocityMps", 60.0);
    d.set("wet", 1.0);
    d.set("dry", 0.0);
    d.process(&mut x, 1, SR);
    assert_eq!(x.len(), n);
    let cycles = crossings(&x[12000..]);
    assert!(
        cycles < 350,
        "a receding source should be below 440 Hz; got {cycles} cycles"
    );
}

/// The delay has to *travel* to a new time, not jump to it.
///
/// Moving the read pointer is what makes the sweep: while it travels the
/// output is read at a rate other than one sample per sample, which is a
/// pitch shift. This used to work out the tap once per block and hold it,
/// so a delay-time change landed as a step at the block boundary — no
/// sweep, and a click where the two delay times did not line up.
#[test]
fn changing_the_delay_time_sweeps_rather_than_jumping() {
    let sr = 48_000u32;
    let mut echo = Echo::new(sr, 1);
    // All wet, no feedback, so what comes out is only the delay line.
    for (k, v) in [("delayMs", 200.0), ("feedback", 0.0), ("damping", 0.0),
                   ("wet", 1.0), ("dry", 0.0), ("glideMs", 200.0)] {
        assert!(Params::set(&mut echo, k, v), "no {k}");
    }

    // Fill the line with a steady tone, then move the delay time.
    let tone: Vec<f32> = (0..sr as usize).map(|i| (i as f32 * 0.05).sin() * 0.5).collect();
    let mut warm = tone[..sr as usize / 2].to_vec();
    Effect::process(&mut echo, &mut warm, 1, sr);

    assert!(Params::set(&mut echo, "delayMs", 400.0));
    let mut moving = tone[sr as usize / 2..].to_vec();
    Effect::process(&mut echo, &mut moving, 1, sr);

    // While the pointer travels the output is resampled, so its zero
    // crossings cannot match the input's over the same span.
    let crossings = |x: &[f32]| x.windows(2).filter(|w| (w[0] < 0.0) != (w[1] < 0.0)).count();
    let src = crossings(&tone[sr as usize / 2..sr as usize / 2 + 9600]);
    let out = crossings(&moving[..9600]);
    assert!(
        (src as i32 - out as i32).abs() > 20,
        "the delay did not sweep: {src} crossings in, {out} out"
    );

    // And it settles: once the glide is done the pitch is back to the source.
    let mut settled = tone[..9600].to_vec();
    Effect::process(&mut echo, &mut settled, 1, sr);
    let after = crossings(&settled);
    let steady = crossings(&tone[..9600]);
    assert!(
        (steady as i32 - after as i32).abs() <= 8,
        "the delay never settled: {steady} expected, {after} got"
    );
}

/// Glide at zero is the old behaviour, kept for anyone who wants the jump.
#[test]
fn a_zero_glide_arrives_immediately() {
    let sr = 48_000u32;
    let mut echo = Echo::new(sr, 1);
    for (k, v) in [("delayMs", 100.0), ("feedback", 0.0), ("wet", 1.0),
                   ("dry", 0.0), ("glideMs", 0.0)] {
        assert!(Params::set(&mut echo, k, v));
    }
    let mut buf = vec![0.0f32; 512];
    Effect::process(&mut echo, &mut buf, 1, sr);
    assert!(Params::set(&mut echo, "delayMs", 300.0));
    let mut next = vec![0.0f32; 512];
    Effect::process(&mut echo, &mut next, 1, sr);
    // One sample in and the pointer is already there.
    assert!((echo.cur[0] - 300.0 * sr as f32 / 1000.0).abs() < 1.0);
}

/// The plate has to answer quickly.
///
/// It used to read only the ends of its tank delay lines, so nothing came
/// out for about a quarter of a second — no early reflections at all, on a
/// reverb whose whole first section is a diffuser. Table 2's earliest tap
/// is 187 samples in, and reading the network is what makes the difference.
#[test]
fn the_plate_answers_within_a_few_milliseconds() {
    let sr = 48_000u32;
    let mut p = Plate::new(sr);
    assert!(Params::set(&mut p, "wet", 1.0));
    assert!(Params::set(&mut p, "dry", 0.0));
    assert!(Params::set(&mut p, "predelayMs", 0.0));
    let mut b = vec![0.0f32; sr as usize * 2];
    b[0] = 1.0;
    b[1] = 1.0;
    Effect::process(&mut p, &mut b, 2, sr);
    let first = (0..b.len() / 2)
        .find(|&i| b[i * 2].abs() > 1e-5)
        .map(|f| f as f32 * 1000.0 / sr as f32)
        .expect("the plate produced nothing at all");
    assert!(
        first < 40.0,
        "the first reflection arrived after {first:.0} ms; the earliest tap is at about 6"
    );
}

/// §1.3.6: the tap structure "produces a synthetic stereo image", because
/// the input is summed to mono before the tank and every difference between
/// the ears is made by the taps. With the extra cross-feed at zero, the two
/// channels still have to differ.
#[test]
fn the_tap_network_makes_the_stereo_image_by_itself() {
    let sr = 48_000u32;
    let mut p = Plate::new(sr);
    Params::set(&mut p, "wet", 1.0);
    Params::set(&mut p, "dry", 0.0);
    Params::set(&mut p, "crossfeed", 0.0);
    let mut b = vec![0.0f32; sr as usize * 2];
    b[0] = 1.0;
    b[1] = 1.0;
    Effect::process(&mut p, &mut b, 2, sr);
    let worst = (0..b.len() / 2)
        .map(|f| (b[f * 2] - b[f * 2 + 1]).abs())
        .fold(0f32, f32::max);
    assert!(worst > 1e-3, "both ears got the same signal: {worst:.2e}");
}

/// Seven taps a side, summed, must be denser than one end-of-line read.
#[test]
fn the_tap_network_is_denser_than_a_single_read() {
    let sr = 48_000u32;
    let mut p = Plate::new(sr);
    Params::set(&mut p, "wet", 1.0);
    Params::set(&mut p, "dry", 0.0);
    let mut b = vec![0.0f32; sr as usize];
    b[0] = 1.0;
    b[1] = 1.0;
    Effect::process(&mut p, &mut b, 2, sr);
    // Echo density in the first 100 ms: how many samples carry something.
    let n = (sr as usize / 10) * 2;
    let live = b[..n].iter().filter(|v| v.abs() > 1e-6).count();
    assert!(
        live > n / 4,
        "only {live} of {n} samples in the first 100 ms carry anything"
    );
}

/// A predelay of zero has to mean no predelay.
///
/// `Delay::tap` reads `w - delay`, and the slot at `w` holds the sample
/// from a whole buffer ago rather than the newest one — so a tap of zero
/// asked for the present and got a quarter of a second in the past.
#[test]
fn a_plate_with_no_predelay_does_not_wait_a_quarter_of_a_second() {
    let sr = 48_000u32;
    let first_out = |ms: f32| {
        let mut p = Plate::new(sr);
        assert!(Params::set(&mut p, "wet", 1.0));
        assert!(Params::set(&mut p, "dry", 0.0));
        assert!(Params::set(&mut p, "predelayMs", ms));
        let mut b = vec![0.0f32; sr as usize * 2];
        b[0] = 1.0;
        b[1] = 1.0;
        Effect::process(&mut p, &mut b, 2, sr);
        (0..b.len() / 2)
            .find(|&i| b[i * 2].abs() > 1e-5)
            .map(|f| f as f32 * 1000.0 / sr as f32)
    };
    let none = first_out(0.0).expect("a plate with no predelay produced nothing");
    let some = first_out(50.0).expect("a plate with 50 ms produced nothing");
    // Whatever the tank's own latency is, asking for 50 ms more must cost
    // about 50 ms more — and asking for none must not cost the longest
    // predelay the buffer can hold.
    assert!(
        (some - none - 50.0).abs() < 5.0,
        "50 ms of predelay moved the onset by {:.1} ms",
        some - none
    );
}

/// Controls that used to be constants, and the audit that found them.
///
/// Each of these was a number decided inside the DSP with no key to reach
/// it. `mix` was the worst: `MusicalFilter::process` already read it, so
/// the notch, the resonator and the Regalia-Mitra were the only modules in
/// the rack with no dry path and no way to ask for one.
#[test]
fn the_controls_that_were_hiding_inside_the_effects_all_do_something() {
    let sr = 48_000u32;
    let tone: Vec<f32> = (0..4096)
        .map(|i| (i as f32 / 9.0).sin() * 0.4 + (i as f32 / 2.3).sin() * 0.2)
        .collect();
    let run = |e: &mut dyn Effect, n: usize| {
        let mut b = tone[..n].to_vec();
        e.process(&mut b, 2, sr);
        b
    };
    let differs = |a: &[f32], b: &[f32]| {
        a.iter().zip(b).map(|(x, y)| (x - y).abs()).fold(0f32, f32::max)
    };

    // The three musical filters now have a dry path.
    for mode in [
        MusicalFilterMode::Notch,
        MusicalFilterMode::Resonator,
        MusicalFilterMode::Regalia,
    ] {
        let mut wet = MusicalFilter::new(mode);
        assert!(Params::set(&mut wet, "mix", 1.0), "{mode:?} has no mix");
        let mut dry = MusicalFilter::new(mode);
        assert!(Params::set(&mut dry, "mix", 0.0));
        let (a, b) = (run(&mut wet, 2048), run(&mut dry, 2048));
        assert!(differs(&a, &b) > 0.01, "{mode:?}: mix changed nothing");
        // Fully dry is the input, untouched.
        assert!(differs(&b, &tone[..2048]) < 1e-6, "{mode:?}: dry is not dry");
    }

    // The plate's stereo cross-feed. Fed from one side only, and run long
    // enough for the tank to have something in it to cross over — the
    // first output does not arrive for about a quarter of a second.
    let mut one_sided = vec![0.0f32; 200_000];
    for i in 0..100_000 {
        one_sided[i * 2] = (i as f32 / 7.0).sin() * 0.5;
    }
    let plate_run = |cross: f32| {
        let mut p = Plate::new(sr);
        assert!(Params::set(&mut p, "crossfeed", cross));
        assert!(Params::set(&mut p, "wet", 1.0));
        assert!(Params::set(&mut p, "dry", 0.0));
        let mut b = one_sided.clone();
        Effect::process(&mut p, &mut b, 2, sr);
        b
    };
    assert!(differs(&plate_run(0.0), &plate_run(1.0)) > 1e-4, "plate width");

    // The Leslie's horn distance.
    let leslie_run = |base: f32| {
        let mut l = Leslie::new(sr, 2);
        assert!(Params::set(&mut l, "baseMs", base));
        assert!(Params::set(&mut l, "wet", 1.0));
        assert!(Params::set(&mut l, "dry", 0.0));
        let mut b = tone.clone();
        Effect::process(&mut l, &mut b, 2, sr);
        b
    };
    assert!(differs(&leslie_run(1.0), &leslie_run(30.0)) > 1e-4, "leslie distance");

    // And the speed of sound the Doppler travels through.
    let mut air = Doppler::new(sr, 2);
    let mut soup = Doppler::new(sr, 2);
    for (e, v) in [(&mut air, 343.0f32), (&mut soup, 40.0f32)] {
        assert!(Params::set(e, "speedMps", v));
        assert!(Params::set(e, "velocityMps", 20.0));
    }
    assert!(differs(&run(&mut air, 4096), &run(&mut soup, 4096)) > 1e-4, "speed of sound");
}
