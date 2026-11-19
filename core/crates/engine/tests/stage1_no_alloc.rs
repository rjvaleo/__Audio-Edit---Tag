//! Warmed callback paths, under contention, over two seconds at 128 frames.
mod stage1_support {
    pub mod rt;
}
use engine::{Core, GrainKeys, KeyMode, Shared, Source};
use fx::{grain::StreamParams, stretch::Algorithm};
use stage1_support::rt;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
const RATE: u32 = 48_000;
const BLOCK: usize = 128;
fn rig(algorithm: Algorithm) -> (Core, Arc<Shared>) {
    audio_core::fft::prime();
    prism_grain::fft::prime();
    let src = Arc::new(Source {
        samples: (0..192_000)
            .map(|i| (i as f32 * 0.02).sin() * 0.3)
            .collect(),
        channels: 1,
    });
    let mut p = StreamParams::new(src.samples.len(), RATE);
    p.algorithm = algorithm;
    p.ratio = 2.0;
    let shared = Arc::new(Shared::new(p, src.clone()));
    if algorithm == Algorithm::Hybrid {
        shared.set_parts(Arc::new(fx::hstream::Parts::separate(
            &src.samples,
            1,
            p.hybrid,
        )));
    }
    let core = Core::new(BLOCK, 1, p, src);
    // Keep the source sounding after warm-up, including at speed 2.
    shared.set_loop(true, 0, 192_000);
    shared.play();
    (core, shared)
}
fn measured(core: &mut Core, shared: &Shared) -> rt::Counts {
    let mut buf = [0.0; BLOCK];
    for _ in 0..1500 {
        core.fill(&mut buf, 1, shared);
    }
    rt::start();
    let mut energy = 0.0f64;
    for _ in 0..750 {
        core.fill(&mut buf, 1, shared);
        energy += buf.iter().map(|&x| (x as f64).powi(2)).sum::<f64>();
    }
    let n = rt::stop();
    assert!(energy > 1e-12, "measured playback must contain audio");
    assert!(buf.iter().all(|x| x.is_finite()));
    n
}
#[test]
fn every_engine_and_varispeed_allocate_and_wait_for_nothing() {
    rt::verify();
    for alg in [
        Algorithm::Granular,
        Algorithm::Wsola,
        Algorithm::Vocoder,
        Algorithm::Pvsola,
        Algorithm::Hybrid,
        Algorithm::SoundHack,
    ] {
        for speed in [1.0, 0.5, 2.0] {
            let (mut core, shared) = rig(alg);
            shared.set_speed(speed);
            rt::clean(
                &format!("{alg:?}/speed={speed}"),
                measured(&mut core, &shared),
            );
        }
    }
}
#[test]
fn a_hundred_millisecond_loop_allocates_and_waits_for_nothing() {
    rt::verify();
    let (mut core, shared) = rig(Algorithm::Wsola);
    shared.set_loop(true, 0, 4800);
    rt::clean("100ms loop", measured(&mut core, &shared));
}
#[test]
fn sixteen_poly_voices_and_eight_steals_allocate_and_wait_for_nothing() {
    rt::verify();
    let (core, shared) = rig(Algorithm::Granular);
    shared.pause();
    let keys = Arc::new(GrainKeys::new());
    keys.set_run(false);
    keys.set_mode(KeyMode::Poly);
    let mut core = core.with_keys(keys.clone());
    for note in 48..64 {
        keys.note_on(note, 0.7);
    }
    let mut buf = [0.0; BLOCK];
    for _ in 0..1500 {
        core.fill(&mut buf, 1, &shared);
    }
    rt::start();
    for block in 0..750 {
        if block < 8 {
            keys.note_on(72 + block as u8, 0.8);
        }
        core.fill(&mut buf, 1, &shared);
    }
    rt::clean("16 Poly + 8 steals", rt::stop());
}
#[test]
fn the_setters_can_run_on_another_thread_throughout_rendering() {
    rt::verify();
    let (mut core, shared) = rig(Algorithm::Wsola);
    let mut rack = fx::Rack::new();
    rack.push(Box::new(fx::Gain { db: 0.0 }));
    rack.reserve_mix(BLOCK);
    shared.set_rack(Some(rack));
    let mut buf = [0.0; BLOCK];
    for _ in 0..1500 {
        core.fill(&mut buf, 1, &shared);
    }
    let done = Arc::new(AtomicBool::new(false));
    let started = Arc::new(std::sync::Barrier::new(2));
    let control_started = started.clone();
    let control = shared.clone();
    let finished = done.clone();
    let writer = std::thread::spawn(move || {
        let mut i = 0;
        control_started.wait();
        while !finished.load(Ordering::Acquire) {
            let mut p = control.params().unwrap();
            p.ratio = if i % 2 == 0 { 1.0 } else { 2.0 };
            p.semitones = (i % 3) as f32;
            control.set_params(p);
            control.set_gain(if i % 2 == 0 { 0.5 } else { 1.0 });
            control.set_manual_param(0, "db", (i % 4) as f32 - 3.0);
            i += 1;
            std::thread::yield_now();
        }
        i
    });
    started.wait();
    rt::start();
    for _ in 0..750 {
        core.fill(&mut buf, 1, &shared);
    }
    let n = rt::stop();
    done.store(true, Ordering::Release);
    assert!(writer.join().unwrap() > 0);
    rt::clean("concurrent setters", n);
}

#[test]
fn the_wave_decks_first_block_and_next_two_seconds_use_fixed_memory() {
    rt::verify();
    let shared = Arc::new(engine::WaveShared::new());
    let frame: Vec<_> = (0..wave::FRAME_LEN)
        .map(|i| (i as f32 * std::f32::consts::TAU / wave::FRAME_LEN as f32).sin())
        .collect();
    shared.set_table(0, Arc::new(wave::Wavetable::from_frames(&[frame])));
    let mut deck = engine::SynthDeck::new(48_000.0, BLOCK, 2, shared.clone());
    shared
        .events
        .push(engine::WaveEvent::NoteOn { note: 69, vel: 0.8 });
    rt::start();
    std::hint::black_box(deck.render(BLOCK, 2));
    let first = rt::stop();
    rt::clean("Wave first block", first);
    rt::start();
    for _ in 0..750 {
        std::hint::black_box(deck.render(BLOCK, 2));
    }
    rt::clean("Wave following 2s", rt::stop());
}
