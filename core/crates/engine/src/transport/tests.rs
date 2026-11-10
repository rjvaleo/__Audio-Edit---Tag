use super::*;
use fx::grain::StreamParams;

/// A `Shared` is only atomics plus two mutexes; the source never gets read
/// by `loop_bounds`, so an empty one is honest here rather than a stub.
fn shared() -> Shared {
    Shared::new(
        StreamParams::new(48_000, 48_000),
        Arc::new(Source { samples: Vec::new(), channels: 2 }),
    )
}

/// The analytics window is its own: taking it empties it, and resetting
/// the meter's worst (which the interface does by hand) leaves it alone.
#[test]
fn the_analytics_window_takes_the_worst_and_counts_late_blocks_for_good() {
    use std::time::Duration;
    let s = shared();
    let ms = Duration::from_millis;
    s.record_block_cost(ms(5), ms(10));
    s.record_block_cost(ms(12), ms(10));
    s.record_block_cost(ms(3), ms(10));
    s.reset_load();
    let (worst, late) = s.take_load_window();
    assert!((worst - 1.2).abs() < 1e-3, "{worst}");
    assert_eq!(late, 1);
    let (worst, late) = s.take_load_window();
    assert_eq!(worst, 0.0);
    assert_eq!(late, 1, "the total is never reset");
}

/// The bug this replaced: a loop of 1000 output frames is shorter than the
/// old `LOOP_FADE_FRAMES * 2` guard, so `loop_bounds` returned `None` —
/// which the caller reads as "not looping", plays to the end of the
/// document and pauses. A short loop stopped the machine.
///
/// It is stretch-dependent because `a` and `b` are *output* frames: the
/// same region of source falls under the threshold as the ratio drops.
#[test]
fn a_loop_shorter_than_the_old_threshold_is_honoured() {
    let s = shared();
    s.set_loop(true, 0, 1000);
    assert_eq!(s.loop_bounds(100_000), Some((0, 1000)));
}

#[test]
fn a_loop_of_a_few_hundred_frames_is_honoured() {
    let s = shared();
    s.set_loop(true, 4_000, 4_300);
    assert_eq!(s.loop_bounds(100_000), Some((4_000, 4_300)));
}

/// Still refused below the point where wrapping is the wrong mechanism —
/// see `MIN_LOOP_FRAMES`. This is the boundary, not a musical judgement.
#[test]
fn a_loop_at_or_under_the_floor_is_still_refused() {
    let s = shared();
    s.set_loop(true, 0, MIN_LOOP_FRAMES);
    assert_eq!(s.loop_bounds(100_000), None);
    s.set_loop(true, 0, MIN_LOOP_FRAMES + 1);
    assert!(s.loop_bounds(100_000).is_some());
}

/// A loud, obviously non-silent source, so "did the ring get the audio"
/// is answerable by looking at one number.
fn loud_source(frames: usize, channels: usize) -> Arc<Source> {
    Arc::new(Source {
        samples: vec![0.5; frames * channels],
        channels,
    })
}

/// A playing engine with nothing in it to hear, so what comes out is the
/// sequencer's alone.
fn silent_core(channels: usize) -> (Core, Shared) {
    let src = Arc::new(Source { samples: vec![0.0; 96_000 * channels], channels });
    let sp = StreamParams::new(96_000, 48_000);
    let shared = Shared::new(sp, Arc::clone(&src));
    let core = Core::new(1024, channels, sp, src);
    shared.play();
    (core, shared)
}

#[test]
fn the_sequencer_is_added_on_the_output_frames_the_engine_renders() {
    let (mut core, shared) = silent_core(2);
    shared.request_seek(1_000);
    let run: Vec<f32> = (0..512)
        .flat_map(|i| {
            let v = (1_000 + i) as f32 * 1e-4;
            [v, -v]
        })
        .collect();
    assert_eq!(shared.seq.write(1, 1_000, &run, 2, 0, None), 512);
    let mut buf = vec![0.0; 512 * 2];
    core.fill(&mut buf, 2, &shared);
    for i in 0..512 {
        let v = (1_000 + i) as f32 * 1e-4;
        assert_eq!((buf[i * 2], buf[i * 2 + 1]), (v, -v), "output frame {} is not the sequencer's", 1_000 + i);
    }
    assert_eq!(shared.seq.mixed.load(Ordering::Relaxed), 512);
    assert_eq!(shared.seq.missing.load(Ordering::Relaxed), 0);
}

#[test]
fn round_a_loop_the_sequencer_wraps_on_the_same_frame_as_the_grain() {
    let (mut core, shared) = silent_core(2);
    shared.set_loop(true, 1_000, 1_200);
    shared.request_seek(1_100);
    // The last hundred frames of one pass, and the first hundred of the next.
    shared.seq.write(1, 1_100, &[0.25f32; 100 * 2], 2, 0, None);
    shared.seq.write(1, 1_000, &[-0.125f32; 100 * 2], 2, 0, None);
    let mut buf = vec![0.0; 200 * 2];
    core.fill(&mut buf, 2, &shared);
    assert!(buf[..200].iter().all(|s| *s == 0.25), "before the wrap: {:?}", &buf[..8]);
    assert!(buf[200..].iter().all(|s| *s == -0.125), "after the wrap: {:?}", &buf[200..208]);
}

#[test]
fn grain_off_silences_the_grain_and_not_the_sequencer() {
    let (mut core, shared) = playing_core(2);
    shared.set_mute(true);
    shared.seq.write(1, 0, &[0.125f32; 512 * 2], 2, 0, None);
    let mut buf = vec![0.0; 512 * 2];
    core.fill(&mut buf, 2, &shared);
    assert!(buf.iter().all(|s| *s == 0.125), "{:?}", &buf[..8]);
}

#[test]
fn a_stop_fades_the_sequencer_out_rather_than_cutting_it() {
    let (mut core, shared) = silent_core(1);
    shared.seq.write(1, 0, &[0.5f32; 4_000], 1, 0, None);
    let mut buf = vec![0.0; 256];
    core.fill(&mut buf, 1, &shared);
    assert!(buf.iter().all(|s| *s == 0.5));
    shared.pause();
    let mut after = vec![0.0; 1_024];
    core.fill(&mut after, 1, &shared);
    let n = SEQ_STOP_FADE_FRAMES;
    assert!(after[0] > 0.45 && after[0] <= 0.5, "the fade did not begin where the sound was: {}", after[0]);
    assert!(after[n / 2] > 0.2 && after[n / 2] < 0.3, "halfway: {}", after[n / 2]);
    assert!(after.windows(2).take(n - 1).all(|w| w[1] <= w[0]), "the fade is not a fade");
    assert!(after[n..].iter().all(|s| *s == 0.0), "the sequencer went on after its fade");
}

#[test]
fn sound_that_did_not_come_is_counted_only_while_the_bus_is_in_use() {
    let (mut core, shared) = silent_core(2);
    let mut buf = vec![0.0; 256 * 2];
    core.fill(&mut buf, 2, &shared);
    assert_eq!(shared.seq.missing.load(Ordering::Relaxed), 0, "a bus nobody sends to counted as missing");
    shared.seq.write(1, 256, &[0.1f32; 100 * 2], 2, 0, None);
    core.fill(&mut buf, 2, &shared);
    assert_eq!(shared.seq.mixed.load(Ordering::Relaxed), 100);
    assert_eq!(shared.seq.missing.load(Ordering::Relaxed), 156);
}

fn playing_core(channels: usize) -> (Core, Shared) {
    let src = loud_source(48_000, channels);
    let sp = StreamParams::new(48_000, 48_000);
    let shared = Shared::new(sp, Arc::clone(&src));
    let core = Core::new(512, channels, sp, src);
    shared.play();
    (core, shared)
}





/// The paused branch must keep running the chain rather than returning.
///
/// Cutting a reverb tail on the same sample as the stop is the one thing
/// every listener notices, and it is what this used to do: fill silence and
/// return before `process_rack` was ever reached. The countdown moving is
/// the evidence that the branch is now doing work.
#[test]
fn a_stopped_transport_keeps_processing_the_chain() {
    let (mut core, shared) = playing_core(1);
    shared.set_rack(Some(fx::Rack::new()));
    let mut buf = vec![0.0; 512];
    core.fill(&mut buf, 1, &shared);
    assert!(buf.iter().any(|s| *s != 0.0), "nothing was playing to begin with");

    shared.pause();
    let before = core.tail_left;
    core.fill(&mut buf, 1, &shared);
    assert!(
        core.tail_left < before,
        "the paused branch returned without processing the rack"
    );
}

/// ...but not for ever. A stopped transport must not process silence for as
/// long as the application is open.
#[test]
fn a_stopped_rack_eventually_stops_being_processed() {
    let (mut core, shared) = playing_core(1);
    shared.set_rack(Some(fx::Rack::new()));
    let mut buf = vec![0.0; 512];
    core.fill(&mut buf, 1, &shared);

    shared.pause();
    let budget = tail_budget(48_000);
    // Four seconds of silence, plus a margin.
    for _ in 0..(budget / 512 + 4) {
        core.fill(&mut buf, 1, &shared);
    }
    assert_eq!(core.tail_left, 0, "a silent chain went on being processed");
}

/// And starting again restores it, or a second stop would have no tail.
#[test]
fn playing_again_restores_the_tail_budget() {
    let (mut core, shared) = playing_core(1);
    shared.set_rack(Some(fx::Rack::new()));
    let mut buf = vec![0.0; 512];

    shared.pause();
    for _ in 0..(tail_budget(48_000) / 512 + 4) {
        core.fill(&mut buf, 1, &shared);
    }
    assert_eq!(core.tail_left, 0);

    shared.play();
    core.fill(&mut buf, 1, &shared);
    assert!(core.tail_left > 0, "the budget did not come back on play");
}

/// A control moved while sound is playing must reach the effect.
///
/// Reported as "the compressor threshold does not respond to the slider,
/// but only while a sound is playing" — which is the shape of a live path
/// that never lands, since a stopped transport picks the value up from the
/// spec the next time the rack is built.
#[test]
fn a_control_moved_while_playing_reaches_the_effect() {
    let (mut core, shared) = playing_core(1);

    let mut rack = fx::Rack::new();
    rack.push(Box::new(fx::Compressor::new(fx::comp::CompSettings::default())));
    shared.set_rack(Some(rack));

    let mut buf = vec![0.0; 512];
    // One block to adopt the pending rack.
    core.fill(&mut buf, 1, &shared);
    let before = core
        .rack
        .as_ref()
        .and_then(|r| r.get_param(0, "thresholdDb"))
        .expect("the compressor should report its threshold");

    let want = before - 20.0;
    shared.set_manual_param(0, "thresholdDb", want);

    // Long enough for a 15 ms smoother to arrive.
    for _ in 0..64 {
        core.fill(&mut buf, 1, &shared);
    }
    let after = core
        .rack
        .as_ref()
        .and_then(|r| r.get_param(0, "thresholdDb"))
        .unwrap();
    assert!(
        (after - want).abs() < 0.5,
        "threshold did not reach the effect: asked {want}, arrived {after} (was {before})"
    );
}

#[test]
fn loop_off_means_no_bounds_however_long_the_region() {
    let s = shared();
    s.set_loop(false, 0, 50_000);
    assert_eq!(s.loop_bounds(100_000), None);
}

/// An ordinary loop is far longer than 2 kframes and is unaffected by any
/// of this — it gets exactly the fade it always got.
#[test]
fn an_ordinary_loop_keeps_the_full_fade() {
    assert_eq!(loop_fade(0, 48_000), LOOP_FADE_FRAMES);
    assert_eq!(loop_fade(10_000, 12_048), LOOP_FADE_FRAMES);
}

/// The seam can never eat more than half the loop, because both sides get
/// `loop_fade` and each is capped at a quarter. That is the property the
/// old guard was protecting by refusing to loop at all.
#[test]
fn the_two_fades_never_cover_more_than_half_a_loop() {
    for len in [65u64, 100, 256, 512, 1000, 2048, 4096, 48_000] {
        let fade = loop_fade(0, len) as u64;
        assert!(
            fade * 2 <= len,
            "a {len}-frame loop got {fade} frames of fade on each side"
        );
    }
}

#[test]
fn a_short_loop_gets_a_short_fade_rather_than_none() {
    assert_eq!(loop_fade(0, 400), 100);
    assert_eq!(loop_fade(0, 100), 25);
    assert!(loop_fade(0, 65) >= 1, "a loop above the floor must still fade");
}


// ─────────────────────────────────────────────── Hyperprism's Playback Speed

/// A source with something in every sample, so a frame read from the wrong
/// place shows: a 220 Hz sine, two seconds long.
fn tone_core(channels: usize, block: usize) -> (Core, Shared) {
    let frames = 96_000;
    let samples = (0..frames * channels)
        .map(|i| 0.5 * (std::f32::consts::TAU * 220.0 * (i / channels) as f32 / 48_000.0).sin())
        .collect();
    let src = Arc::new(Source { samples, channels });
    let sp = StreamParams::new(frames, 48_000);
    let shared = Shared::new(sp, Arc::clone(&src));
    let core = Core::new(block, channels, sp, src);
    shared.play();
    (core, shared)
}

fn render(core: &mut Core, shared: &Shared, frames: usize, block: usize, channels: usize) -> Vec<f32> {
    let mut out = Vec::with_capacity(frames * channels);
    let mut buf = vec![0.0; block * channels];
    while out.len() < frames * channels {
        core.fill(&mut buf, channels, shared);
        out.extend_from_slice(&buf);
    }
    out.truncate(frames * channels);
    out
}

// ───────────────────────── clicks under a moving stretch (diagnostic)

/// Samples where the output jumps further than the 220 Hz tone can move in
/// one sample, with some room: a click, a chop or a splice gone wrong.
fn clicks(out: &[f32]) -> usize {
    out.windows(2).filter(|w| (w[1] - w[0]).abs() > 0.08).count()
}

/// How a moving stretch sounds on each engine: steady, gliding, and stepped
/// sixty times a second as the pad sends it. Printed, for diagnosis.
#[test]
#[ignore]
fn diagnose_clicks_under_a_moving_stretch() {
    use fx::stretch::Algorithm;
    for (alg, layers) in [(Algorithm::Granular, 1), (Algorithm::Wsola, 1), (Algorithm::Vocoder, 1), (Algorithm::Pvsola, 1),
                          (Algorithm::Granular, 4), (Algorithm::Wsola, 4), (Algorithm::Vocoder, 4), (Algorithm::Pvsola, 4)] {
        let mut row = Vec::new();
        for case in ["steady", "glide", "steps"] {
            let (mut core, shared) = tone_core(1, 512);
            let mut p = shared.params().unwrap();
            p.algorithm = alg;
            p.grain.layers = layers;
            p.ratio = 1.0;
            shared.set_params(p);
            if layers > 1 { core.renderer.set_bank(crate::stretcher::LayerBank::build(alg, layers, 512, 1, 48_000)); }
            render(&mut core, &shared, 48_000, 512, 1);
            if case == "glide" {
                shared.set_glide(50.0);
                with_ratio(&shared, 2.0, 0.0);
            }
            let mut out = Vec::new();
            for b in 0..188 {
                if case == "steps" {
                    // Up to 2 over two seconds, a new value every 735 frames.
                    if b % 2 == 0 { with_ratio(&shared, 1.0 + b as f32 / 188.0, 0.0); }
                }
                out.extend(render(&mut core, &shared, 512, 512, 1));
            }
            row.push(format!("{case}: {}", clicks(&out)));
        }
        eprintln!("{alg:?} x{layers}: {}", row.join(", "));
    }
}

/// A chirp, 200 Hz rising 400 Hz a second: every engine keeps pitch, so the
/// frequency coming out says where in the file it is reading.
fn chirp_core(block: usize) -> (Core, Shared) {
    let frames = 480_000;
    let mut phase = 0.0f64;
    let samples = (0..frames)
        .map(|i| {
            let t = i as f64 / 48_000.0;
            phase += std::f64::consts::TAU * (200.0 + 400.0 * t) / 48_000.0;
            (0.5 * phase.sin()) as f32
        })
        .collect();
    let src = Arc::new(Source { samples, channels: 1 });
    let sp = StreamParams::new(frames, 48_000);
    let shared = Shared::new(sp, Arc::clone(&src));
    let core = Core::new(block, 1, sp, src);
    shared.play();
    (core, shared)
}

/// Where in the chirp each 50 ms of output reads from, in seconds.
fn chirp_seconds(out: &[f32]) -> Vec<f32> {
    out.chunks_exact(2_400)
        .map(|c| {
            let zc = c.windows(2).filter(|w| (w[0] < 0.0) != (w[1] < 0.0)).count() as f32;
            let hz = zc / 2.0 / 0.05;
            (hz - 200.0) / 400.0
        })
        .collect()
}

/// The moving stretch the pad makes: a glide from ×1 to ×2, or the pad's
/// own steps, up to ×2 a new value every 735 frames. Two seconds of it,
/// a second into the sound.
fn moving(alg: fx::stretch::Algorithm, layers: u32, case: &str, chirp: bool) -> (Vec<f32>, Vec<GrainEvent>) {
    let (mut core, shared) = if chirp { chirp_core(512) } else { tone_core(1, 512) };
    let mut p = shared.params().unwrap();
    p.algorithm = alg;
    p.grain.layers = layers;
    shared.set_params(p);
    if layers > 1 {
        core.renderer.set_bank(crate::stretcher::LayerBank::build(alg, layers, 512, 1, 48_000));
    }
    render(&mut core, &shared, 48_000, 512, 1);
    shared.events.lock().unwrap().clear();
    if case == "glide" {
        shared.set_glide(50.0);
        with_ratio(&shared, 2.0, 0.0);
    }
    let (mut out, mut ev) = (Vec::new(), Vec::new());
    for b in 0..188 {
        if case == "steps" && b % 2 == 0 {
            with_ratio(&shared, 1.0 + b as f32 / 188.0, 0.0);
        }
        out.extend(render(&mut core, &shared, 512, 512, 1));
        ev.extend(shared.events.lock().unwrap().drain(..));
    }
    (out, ev)
}

/// Every block of a moving stretch was a seek and a fade in from silence on
/// the splice and spectral engines, and on every extra layer: heard as
/// chopping and clicks while the pad was dragged. Now they read on.
#[test]
fn a_moving_stretch_does_not_click_on_any_live_engine_or_layer() {
    use fx::stretch::Algorithm;
    for alg in [Algorithm::Granular, Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Pvsola] {
        for layers in [1, 4] {
            for case in ["glide", "steps"] {
                let n = clicks(&moving(alg, layers, case, false).0);
                assert!(n <= 2, "{alg:?} ×{layers} {case}: {n} clicks");
            }
        }
    }
}

/// And without the seek, the read still goes on from where it was, rather
/// than jumping through the file by `frame · Δ(1/ratio)`.
#[test]
fn a_moving_stretch_reads_on_through_the_file_without_jumping() {
    use fx::stretch::Algorithm;
    for alg in [Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Pvsola] {
        for case in ["glide", "steps"] {
            let at = chirp_seconds(&moving(alg, 1, case, true).0);
            let worst = at.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f32::max);
            assert!(worst < 0.15, "{alg:?} {case}: a step of {:.0} ms through the file", worst * 1000.0);
            assert!(at[0] > 0.9 && at[0] < 1.2, "{alg:?} {case}: started at {:.2} s", at[0]);
        }
    }
    // The cloud, by its grains: in order, and never far apart.
    for case in ["glide", "steps"] {
        let (_, mut ev) = moving(Algorithm::Granular, 1, case, true);
        ev.sort_by_key(|e| e.out_frame);
        let back = ev.windows(2).map(|w| w[0].src_frame - w[1].src_frame).fold(0.0f32, f32::max);
        let fwd = ev.windows(2).map(|w| w[1].src_frame - w[0].src_frame).fold(0.0f32, f32::max);
        assert!(back <= 0.0 && fwd < 0.1 * 48_000.0, "granular {case}: back {back}, forward {fwd}");
    }
}

// ───────────────────────── HyperStretch's glide (see `glide.rs`)

fn with_ratio(shared: &Shared, ratio: f32, semitones: f32) {
    let mut p = shared.params().unwrap();
    p.ratio = ratio;
    p.semitones = semitones;
    shared.set_params(p);
}

#[test]
fn without_a_glide_a_new_stretch_plays_at_once() {
    let (mut core, shared) = tone_core(1, 512);
    with_ratio(&shared, 2.0, 5.0);
    render(&mut core, &shared, 512, 512, 1);
    assert_eq!((core.params.ratio, core.params.semitones), (2.0, 5.0));
}

#[test]
fn with_a_glide_stretch_and_pitch_move_by_hyperprisms_steps() {
    let (mut core, shared) = tone_core(1, 512);
    render(&mut core, &shared, 512, 512, 1);
    let (r0, s0) = (core.params.ratio, core.params.semitones);
    shared.set_glide(50.0);
    with_ratio(&shared, r0 + 1.0, s0 + 12.0);
    // 512 frames at 48 kHz holds one step (every 557 samples here), the
    // first on the block's first sample: a hundredth of the way.
    render(&mut core, &shared, 512, 512, 1);
    assert!((core.params.ratio - (r0 + 0.01)).abs() < 1e-4, "{}", core.params.ratio);
    assert!((core.params.semitones - (s0 + 0.12)).abs() < 1e-4, "{}", core.params.semitones);
    // The document's own value is untouched: only what plays glides.
    assert_eq!(shared.params().unwrap().ratio, r0 + 1.0);
}

#[test]
fn stopped_the_glide_is_already_there() {
    let (mut core, shared) = tone_core(1, 512);
    shared.set_glide(80.0);
    render(&mut core, &shared, 512, 512, 1);
    shared.pause();
    with_ratio(&shared, 3.0, -7.0);
    render(&mut core, &shared, 512, 512, 1);
    shared.play();
    render(&mut core, &shared, 512, 512, 1);
    assert_eq!((core.params.ratio, core.params.semitones), (3.0, -7.0));
}

#[test]
fn the_pitch_time_changer_glides_speed_and_pitch_each_on_its_own() {
    let mut g = crate::glide::Glide::<2>::default();
    let mut pt = PitchTime { on: true, speed: 100.0, pitch: 100.0, smoothing: 50.0, ..PitchTime::default() };
    assert_eq!(ptc_glided(&mut g, &pt, false, 512, 44_100), (100.0, 100.0));
    pt.speed = 50.0;
    pt.pitch = 200.0;
    let (s, p) = ptc_glided(&mut g, &pt, true, 512, 44_100);
    assert!((s - 99.5).abs() < 1e-3 && (p - 101.0).abs() < 1e-3, "{s} {p}");
    // The shifter corrects by the ratio of the two as they stand.
    assert!((ptc_ratio(s, p) - 100.0 * 101.0 / 99.5).abs() < 1e-3);
    // Speed never reaches below the original's 1 %.
    pt.speed = 0.0;
    assert_eq!(ptc_glided(&mut g, &pt, false, 512, 44_100).0, 1.0);
    // And the ratio has no limit: Pitch 200 % at Speed 1 % is 200 ×.
    assert_eq!(ptc_ratio(1.0, 200.0), 20_000.0);
}

#[test]
fn the_pitch_time_changer_keeps_the_pitch_past_a_ratio_of_two() {
    // Speed 25 %, Pitch 100 %: four times as long at the same pitch, so
    // the shifter corrects by 400 %, past its Pitch control's 200 %.
    let sr = 44_100u32;
    let tone: Vec<f32> = (0..sr as usize).map(|i| (std::f32::consts::TAU * 200.0 * i as f32 / sr as f32).sin()).collect();
    let pt = PitchTime { on: true, speed: 25.0, pitch: 100.0, ..PitchTime::default() };
    let out = pitch_time_offline(&tone, 1, sr, 512, |_| pt);
    assert!(out.len() > 3 * tone.len(), "{} frames", out.len());
    let mid = &out[sr as usize..3 * sr as usize];
    let hz = mid.windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count() as f32 / 2.0;
    assert!((hz - 200.0).abs() < 8.0, "{hz} Hz, want 200");
}

#[test]
fn at_unit_speed_the_engine_plays_as_it_always_has() {
    let (mut plain, a) = tone_core(2, 256);
    let (mut unit, b) = tone_core(2, 256);
    b.set_speed(1.0);
    assert_eq!(render(&mut plain, &a, 4_096, 256, 2), render(&mut unit, &b, 4_096, 256, 2));
    assert_eq!(a.position(), b.position());
}

#[test]
fn twice_the_speed_reads_every_other_frame() {
    let (mut reference, a) = tone_core(1, 512);
    let (mut fast, b) = tone_core(1, 256);
    b.set_speed(2.0);
    let slow = render(&mut reference, &a, 8_192, 512, 1);
    let quick = render(&mut fast, &b, 4_096, 256, 1);
    for i in 0..quick.len() {
        assert!((quick[i] - slow[2 * i]).abs() < 1e-6, "frame {i}: {} against {}", quick[i], slow[2 * i]);
    }
    assert_eq!(a.position(), b.position(), "both have read the same stretch of the document");
}

#[test]
fn half_speed_reads_between_frames_in_straight_lines() {
    let (mut reference, a) = tone_core(1, 256);
    let (mut slow, b) = tone_core(1, 512);
    b.set_speed(0.5);
    let plain = render(&mut reference, &a, 4_097, 256, 1);
    let half = render(&mut slow, &b, 8_192, 512, 1);
    for i in 0..4_096 {
        assert!((half[2 * i] - plain[i]).abs() < 1e-6, "frame {}", 2 * i);
        let between = 0.5 * (plain[i] + plain[i + 1]);
        assert!((half[2 * i + 1] - between).abs() < 1e-6, "frame {}", 2 * i + 1);
    }
}

#[test]
fn a_change_of_speed_keeps_the_read_continuous() {
    let (mut core, shared) = tone_core(1, 300);
    let mut out = render(&mut core, &shared, 3_000, 300, 1);
    shared.set_speed(1.37);
    out.extend(render(&mut core, &shared, 3_000, 300, 1));
    shared.set_speed(0.61);
    out.extend(render(&mut core, &shared, 3_000, 300, 1));
    // A 220 Hz sine at half scale moves at most 0.5·2π·220·1.37/48 000 per
    // frame; a skipped or repeated read would jump further.
    let step = out.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0f32, f32::max);
    assert!(step < 0.5 * std::f32::consts::TAU * 220.0 * 1.4 / 48_000.0, "{step}");
}


// ───────────────────────────────────────────── Hyperprism's L and R faders

#[test]
fn the_side_faders_scale_their_own_channel_after_the_rack() {
    let (mut plain, a) = tone_core(2, 256);
    let (mut faded, b) = tone_core(2, 256);
    b.set_side_gains(0.5, 1.2);
    let x = render(&mut plain, &a, 2_048, 256, 2);
    let y = render(&mut faded, &b, 2_048, 256, 2);
    // After Hyperprism's 1024-frame ramp, each side sits at its gain.
    for f in 1_024..2_048 {
        assert!((y[2 * f] - 0.5 * x[2 * f]).abs() < 1e-6, "left, frame {f}");
        // Before the soft ceiling, which leaves this tone well alone.
        assert!((y[2 * f + 1] - 1.2 * x[2 * f + 1]).abs() < 1e-5, "right, frame {f}");
    }
}

#[test]
fn unity_side_faders_change_nothing() {
    let (mut plain, a) = tone_core(2, 256);
    let (mut unity, b) = tone_core(2, 256);
    b.set_side_gains(1.0, 1.0);
    assert_eq!(render(&mut plain, &a, 1_024, 256, 2), render(&mut unity, &b, 1_024, 256, 2));
}


// ──────────────────────────────────────── Hyperprism's Pitch Time Changer

#[test]
fn the_pitch_time_changer_off_changes_nothing() {
    let (mut plain, a) = tone_core(2, 256);
    let (mut off, b) = tone_core(2, 256);
    b.set_pitch_time(PitchTime { on: false, speed: 150.0, pitch: 50.0, ..PitchTime::default() });
    assert_eq!(render(&mut plain, &a, 2_048, 256, 2), render(&mut off, &b, 2_048, 256, 2));
}

#[test]
fn the_pitch_time_changer_is_varispeed_then_hyperprisms_shifter() {
    // Speed 150 %, pitch 80 %: the read runs at 1.5 and the shifter takes
    // pitch/speed, all wet, with the window's other settings.
    let settings = PitchTime { on: true, speed: 150.0, pitch: 80.0, feedback: 10.0, grain: 30.0, xfade: 60.0, smoothing: 0.0 };
    let (mut changer, b) = tone_core(2, 256);
    b.set_pitch_time(settings);
    let got = render(&mut changer, &b, 8_192, 256, 2);

    let (mut fast, a) = tone_core(2, 256);
    a.set_speed(1.5);
    let mut want = render(&mut fast, &a, 8_192, 256, 2);
    let mut shifter = fx::prism::make(
        "hp-pitch-shifter",
        48_000,
        2,
        &[
            ("pitch".into(), 100.0 * 80.0 / 150.0),
            ("mix".into(), 100.0),
            ("feedback".into(), 10.0),
            ("grain".into(), 30.0),
            ("xfade".into(), 60.0),
            ("smoothing".into(), 0.0),
        ],
    )
    .unwrap();
    for block in want.chunks_mut(256 * 2) {
        shifter.process(block, 2, 48_000);
    }
    for i in 0..got.len() {
        assert!((got[i] - want[i]).abs() < 1e-5, "sample {i}: {} against {}", got[i], want[i]);
    }
}

#[test]
fn the_pitch_time_changer_runs_time_at_its_speed() {
    let (mut core, shared) = tone_core(1, 256);
    shared.set_pitch_time(PitchTime { on: true, speed: 50.0, pitch: 100.0, ..PitchTime::default() });
    render(&mut core, &shared, 4_096, 256, 1);
    // Half of what was played, plus the one frame the read looks ahead.
    assert!((2_048..=2_049).contains(&shared.position()), "{}", shared.position());
}


// ───────────────────────── the Pitch Time Changer, offline, for an export

#[test]
fn offline_the_pitch_time_changer_is_what_the_engine_plays() {
    // The export's version against the audio thread's: the same varispeed
    // and the same shifter, so the file is what was heard.
    let settings = PitchTime { on: true, speed: 125.0, pitch: 90.0, feedback: 5.0, grain: 20.0, xfade: 80.0, smoothing: 0.0 };
    let (mut plain, a) = tone_core(2, 256);
    let dry = render(&mut plain, &a, 16_384, 256, 2);
    let (mut live, b) = tone_core(2, 256);
    b.set_pitch_time(settings);
    let heard = render(&mut live, &b, 8_192, 256, 2);
    let file = pitch_time_offline(&dry, 2, 48_000, 256, |_| settings);
    for i in 0..heard.len() {
        assert!((file[i] - heard[i]).abs() < 1e-5, "sample {i}: {} against {}", file[i], heard[i]);
    }
    // Time goes as 1/speed: 16 384 frames read at 1.25 make 13 107.
    assert_eq!(file.len() / 2, (16_384.0f64 / 1.25).floor() as usize);
}


#[test]
fn a_fader_moves_in_a_straight_line_over_1024_frames() {
    // Hyperprism ramped a new gain linearly over 1024 frames.
    let (mut plain, a) = tone_core(2, 256);
    let (mut faded, b) = tone_core(2, 256);
    b.set_side_gains(0.5, 1.0);
    let x = render(&mut plain, &a, 2_048, 256, 2);
    let y = render(&mut faded, &b, 2_048, 256, 2);
    for f in [1usize, 256, 512, 1_000] {
        if x[2 * f].abs() < 1e-3 {
            continue;
        }
        let g = y[2 * f] / x[2 * f];
        let want = 1.0 - 0.5 * (f + 1) as f32 / 1_024.0;
        assert!((g - want).abs() < 2e-3, "frame {f}: gain {g}, a straight line says {want}");
    }
}

// ───────────────────────────────────────────── Hyperprism's Post-Roll

#[test]
fn post_roll_runs_the_rack_on_silence_past_the_end() {
    // A 0.5 s document with 0.25 s of post-roll: the transport plays on for
    // that long after the end, then stops.
    let src = Arc::new(Source { samples: vec![0.25; 24_000], channels: 1 });
    let sp = StreamParams::new(24_000, 48_000);
    let shared = Shared::new(sp, Arc::clone(&src));
    let mut core = Core::new(256, 1, sp, src);
    shared.set_post_roll_frames(12_000);
    shared.play();
    let mut buf = vec![0.0; 256];
    let mut played = 0usize;
    while shared.is_playing() && played < 96_000 {
        core.fill(&mut buf, 1, &shared);
        played += 256;
    }
    assert!((36_000..36_000 + 512).contains(&played), "played {played} frames");
}

#[test]
fn no_post_roll_stops_at_the_end() {
    let src = Arc::new(Source { samples: vec![0.25; 24_000], channels: 1 });
    let sp = StreamParams::new(24_000, 48_000);
    let shared = Shared::new(sp, Arc::clone(&src));
    let mut core = Core::new(256, 1, sp, src);
    shared.play();
    let mut buf = vec![0.0; 256];
    let mut played = 0usize;
    while shared.is_playing() && played < 96_000 {
        core.fill(&mut buf, 1, &shared);
        played += 256;
    }
    assert!((24_000..24_000 + 512).contains(&played), "played {played} frames");
}
