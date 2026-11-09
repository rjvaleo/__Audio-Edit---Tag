//! What a voice costs, per engine, and how many fit (`voices.rs`).
//!
//! A cloud voice is cheap and a phase-vocoder voice is not, so no one number is
//! right for all five; the governor measures this at run time and uses it.
//! Printed with `-- --nocapture`; the seed values in `voices.rs` are these
//! numbers rounded up.

use engine::voices::stock;
use engine::{Core, GrainKeys, KeyMode, Shared, Source};
use fx::grain::{Grain, StreamParams};
use fx::stretch::Algorithm;
use std::sync::Arc;

const SR: u32 = 48_000;
const BLOCK: usize = 512;

#[cfg(unix)]
fn cpu_now() -> f64 {
    let mut t = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    // SAFETY: `t` is a valid timespec for the call to fill.
    unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t) };
    t.tv_sec as f64 + t.tv_nsec as f64 * 1e-9
}
#[cfg(not(unix))]
fn cpu_now() -> f64 {
    use std::sync::OnceLock;
    static T0: OnceLock<std::time::Instant> = OnceLock::new();
    T0.get_or_init(std::time::Instant::now).elapsed().as_secs_f64()
}

#[test]
fn what_a_voice_costs_and_how_many_fit() {
    let ch = 2;
    let n = SR as usize * 5;
    let mut seed = 7u32;
    let mut samples = Vec::with_capacity(n * ch);
    for i in 0..n {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        let s = ((i as f32) * 0.01).sin() * 0.4 + (((seed >> 16) as f32 / 32768.0) - 1.0) * 0.05;
        for _ in 0..ch {
            samples.push(s);
        }
    }
    let src = Arc::new(Source { samples, channels: ch });
    let budget = BLOCK as f64 / SR as f64;

    for alg in [Algorithm::Granular, Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Pvsola, Algorithm::Hybrid] {
        for voices in [1u8, 4] {
            let sp = StreamParams { algorithm: alg, ratio: 4.0, grain: Grain::default(), ..StreamParams::new(n, SR) };
            let shared = Shared::new(sp, Arc::clone(&src));
            if alg == Algorithm::Hybrid {
                shared.set_parts(Arc::new(fx::hstream::Parts::separate(&src.samples, ch, sp.hybrid)));
            }
            let keys = Arc::new(GrainKeys::new());
            keys.set_run(false);
            keys.set_mode(KeyMode::Poly);
            keys.set_amp(0.002, 0.01, 1.0, 0.02);
            stock(&shared, voices as usize + 2, BLOCK, ch);
            let mut core = Core::new(BLOCK, ch, sp, Arc::clone(&src)).with_keys(Arc::clone(&keys));
            for v in 0..voices {
                // Spread across the octave, pitched as a chord would be.
                keys.note_on(60 + v * 3, 0.8);
            }
            let mut buf = vec![0f32; BLOCK * ch];
            for _ in 0..40 {
                core.fill(&mut buf, ch, &shared);
            }
            let runs = 300;
            let mut times = Vec::with_capacity(runs);
            for _ in 0..runs {
                let t = cpu_now();
                core.fill(&mut buf, ch, &shared);
                times.push(cpu_now() - t);
            }
            let total: f64 = times.iter().sum();
            times.sort_by(f64::total_cmp);
            let p95 = times[(runs as f64 * 0.95) as usize];
            let mean_pc = 100.0 * (total / runs as f64) / budget / voices as f64;
            let worst_pc = 100.0 * p95 / budget / voices as f64;
            println!(
                "{alg:?} x{voices}: mean {mean_pc:.2}% a voice, p95 {worst_pc:.2}%; about {} fit at 70%; measured by the governor {:.2}%",
                (70.0 / mean_pc).floor(),
                shared.voices.cost(alg) * 100.0
            );
            assert!(mean_pc < 70.0, "{alg:?}: {mean_pc:.1}% a voice");
            assert!(worst_pc < mean_pc * 4.0 + 20.0, "{alg:?}: works in bursts: p95 {worst_pc:.1}% against {mean_pc:.1}%");
        }
    }
}
