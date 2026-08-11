//! A block has to be produced in less time than it takes to play.
//!
//! This is the one property that separates a live engine from a rendered one,
//! and it is invisible in every other test here — a streamer that is correct
//! and slow passes all of them and drops out the moment you press play.
//!
//! What matters is the *worst* block, not the mean. PVSOLA makes a whole
//! vocoder run per anchor, and making it in one callback measured at 89% of the
//! budget on an idle machine, which is a dropout on a busy one. It is made a
//! slice at a time now, spread across the blocks the previous round plays for:
//! same total work, a fifth of the peak.

use engine::{Source, Stretcher};
use fx::grain::{GrainEvent, StreamParams};
use fx::stretch::Algorithm;
const SR: u32 = 48_000;

#[test]
fn no_engine_takes_longer_to_make_a_block_than_the_block_takes_to_play() {
    let ch = 2;
    let n = SR as usize * 5;
    let mut seed = 7u32;
    let mut samples = Vec::with_capacity(n * ch);
    for i in 0..n {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        let s = ((i as f32) * 0.01).sin() * 0.4 + (((seed >> 16) as f32 / 32768.0) - 1.0) * 0.05;
        for _ in 0..ch { samples.push(s); }
    }
    let src = Source { samples, channels: ch };
    let block = 512;
    // The real-time budget: a block must be produced in less than it plays for.
    let budget = block as f64 / SR as f64;

    for alg in [Algorithm::Granular, Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Pvsola, Algorithm::Hybrid] {
        let sp = StreamParams { algorithm: alg, ratio: 6.0, ..StreamParams::new(n, SR) };
        let mut s = Stretcher::new(block, ch, SR);
        s.set_map(None);
        if alg == Algorithm::Hybrid {
            s.set_parts(std::sync::Arc::new(fx::hstream::Parts::separate(
                &src.samples, ch, sp.hybrid)));
        }
        s.seek(0, &sp);
        let mut buf = vec![0f32; block * ch];
        let mut evs = vec![GrainEvent { index:0, out_frame:0, src_frame:0.0, size:0, rate:1.0, pitch_semis:0.0 }; 128];
        // Warm, then measure the worst single block — a callback is judged by
        // its worst, not its average.
        for _ in 0..20 { s.render(&mut buf, ch, &src, &sp, &mut evs); }
        let mut worst = 0f64;
        let mut total = 0f64;
        let runs = 300;
        for _ in 0..runs {
            let t = std::time::Instant::now();
            s.render(&mut buf, ch, &src, &sp, &mut evs);
            let e = t.elapsed().as_secs_f64();
            worst = worst.max(e);
            total += e;
        }
        let worst_pc = 100.0 * worst / budget;
        let mean_pc = 100.0 * (total / runs as f64) / budget;
        println!("{alg:?}: worst {worst_pc:.2}% of budget, mean {mean_pc:.2}%");
        // A wide bound on purpose: this is wall-clock on a shared machine and
        // the point is to catch an engine that does its work in bursts, not to
        // police a few per cent. Measured at the time of writing: granular
        // 0.2%, WSOLA 7.5%, vocoder 13%, PVSOLA 20%.
        assert!(
            worst_pc < 60.0,
            "{alg:?} spent {worst_pc:.1}% of the real-time budget on one block"
        );
    }
}
