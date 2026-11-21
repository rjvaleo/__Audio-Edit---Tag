//! What a short loop costs each engine, per wrap: a measurement for the
//! question of how short a loop may be (RJ, 21 Nov 2026: "down to like a
//! sample"). Run alone, release, `-- --ignored --nocapture`.
use engine::{Core, GrainKeys, Shared, Source};
use fx::grain::{Grain, StreamParams};
use fx::stretch::Algorithm;
use std::sync::Arc;
use std::time::Instant;

const SR: u32 = 48_000;
const BLOCK: usize = 128;
const FILE: usize = 96_000;

fn source() -> Arc<Source> {
    let samples = (0..FILE).flat_map(|i| { let s = (i as f32 * 0.02).sin() * 0.4; [s, s * 0.8] }).collect();
    Arc::new(Source { samples, channels: 2 })
}

fn params(alg: Algorithm) -> StreamParams {
    StreamParams {
        in_frames: FILE, sample_rate: SR, ratio: 1.0, semitones: 0.0, window_ms: 40.0,
        grain: Grain::default(), algorithm: alg,
        wsola: Default::default(), vocoder: Default::default(), pvsola: Default::default(),
        hybrid: Default::default(), soundhack: Default::default(), cloud: false, cloud_mix: 0.5,
    }
}

/// Seconds of thread time to render one second, with this loop (or none).
fn cost(alg: Algorithm, looped: Option<u64>) -> f64 {
    let src = source();
    let sp = params(alg);
    let shared = Shared::new(sp, Arc::clone(&src));
    if alg == Algorithm::Hybrid {
        shared.set_parts(Arc::new(fx::hstream::Parts::separate(&src.samples, 2, sp.hybrid)));
    }
    let keys = Arc::new(GrainKeys::new());
    let mut core = Core::new(BLOCK, 2, sp, src).with_keys(keys);
    if let Some(n) = looped { shared.set_loop(true, 30_000, 30_000 + n); }
    shared.play();
    let mut buf = vec![0f32; BLOCK * 2];
    for _ in 0..40 { core.fill(&mut buf, 2, &shared); }
    let t = Instant::now();
    for _ in 0..(SR as usize / BLOCK) { core.fill(&mut buf, 2, &shared); }
    std::hint::black_box(&buf);
    t.elapsed().as_secs_f64()
}

#[test]
#[ignore = "a measurement"]
fn short_loops_cost() {
    for alg in [Algorithm::Granular, Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Pvsola, Algorithm::Hybrid] {
        let best = |l| (0..3).map(|_| cost(alg, l)).fold(f64::INFINITY, f64::min);
        let free = best(None);
        let rows: Vec<String> = [1u64, 8, 32, 65, 128, 512, 4800].iter().map(|&n| {
            let c = best(Some(n));
            let wraps = SR as f64 / n as f64;
            format!("{n} frames {:.1}% (per wrap {:.2} us)", c * 100.0, (c - free).max(0.0) / wraps * 1e6)
        }).collect();
        println!("{alg:?}: no loop {:.1}% of real time; {}", free * 100.0, rows.join("; "));
    }
}
