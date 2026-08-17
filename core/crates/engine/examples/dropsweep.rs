//! Which settings drop audio, measured rather than guessed.
//!
//! The real-time path is clean of allocation and of blocking locks — every
//! buffer is sized in a constructor and every lock on the callback path is a
//! `try_lock`. So a dropout here is never contention; it is a block that cost
//! more than it was worth. This finds the ones that do.
use engine::{Source, Stretcher};
use fx::grain::StreamParams;
use fx::stretch::Algorithm;

const SR: u32 = 48_000;
const BLOCK: usize = 2048;          // the configured buffer

fn cost(sp: &StreamParams, src: &Source, ch: usize) -> (f64, f64, usize) {
    let budget = BLOCK as f64 / SR as f64;
    let mut st = Stretcher::new(BLOCK, ch, SR);
    st.set_bank(engine::stretcher::LayerBank::build(
        sp.algorithm, sp.grain.layers, BLOCK, ch, SR));
    // The hybrid works on a *separated* source and is handed it from off the
    // audio thread. Without this it has nothing to do and reports a tenth of a
    // percent — which is not "fast", it is "not running", and reporting it as a
    // cost would be a lie.
    if sp.algorithm == Algorithm::Hybrid {
        st.set_parts(std::sync::Arc::new(fx::hstream::Parts::separate(
            &src.samples, ch, sp.hybrid)));
    }
    st.seek(0, sp);
    let mut out = vec![0f32; BLOCK * ch];
    let mut ev = vec![fx::grain::GrainEvent {
        index: 0, out_frame: 0, src_frame: 0.0, size: 0, rate: 1.0, pitch_semis: 0.0 }; 8192];
    for _ in 0..12 { st.render(&mut out, ch, src, sp, &mut ev); }
    let mut c = Vec::with_capacity(120);
    for _ in 0..120 {
        let t0 = std::time::Instant::now();
        st.render(&mut out, ch, src, sp, &mut ev);
        c.push(t0.elapsed().as_secs_f64() / budget * 100.0);
    }
    c.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mean = c.iter().sum::<f64>() / c.len() as f64;
    // Is it producing anything? A cost of a tenth of a percent means the engine
    // is not running, not that it is fast — and reporting that as "cheap" would
    // be worse than not measuring it.
    let peak = out.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    (mean, c[114], if peak < 1e-6 { usize::MAX } else { c.iter().filter(|x| **x > 100.0).count() })
}

fn main() {
    let ch = 2;
    let n = SR as usize * 5;
    let mut samples = Vec::with_capacity(n * ch);
    for i in 0..n {
        let t = i as f32 / SR as f32;
        let s = (t * 180.0 * std::f32::consts::TAU).sin() * 0.3
              + (t * 613.0 * std::f32::consts::TAU).sin() * 0.2
              + if i % 12000 < 80 { 0.4 } else { 0.0 };
        for _ in 0..ch { samples.push(s); }
    }
    let src = Source { samples, channels: ch };

    println!("per-block cost at {BLOCK} frames / {SR} Hz, stereo. over = blocks past budget, of 120\n");
    println!("  {:<9} {:>6} {:>7} {:>8} {:>7} {:>7} {:>6}", "engine", "layers", "window", "mean", "p95", "over", "verdict");
    for alg in [Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Pvsola,
                Algorithm::Hybrid, Algorithm::Granular] {
        for layers in [1u32, 3, 8] {
            for win in [46.0f32, 190.0] {
                let mut sp = StreamParams::new(n, SR);
                sp.algorithm = alg;
                sp.ratio = 8.0;
                sp.grain.layers = layers;
                sp.grain.overlap = 2.0;
                sp.window_ms = win;
                sp.vocoder.window_ms = win;
                // The granular engine's layering does not go through the
                // bank at all — `LayerBank::build` has an empty arm for it — so
                // this harness cannot speak for it and says so rather than
                // printing a number that looks like an answer.
                if alg == Algorithm::Granular {
                    println!("  {:<9} {:>6} {:>6.0}ms {:>7} {:>6} {:>7} {:>6}",
                        format!("{alg:?}"), layers, win, "-", "-", "-", "not measured");
                    continue;
                }
                let (mean, p95, over) = cost(&sp, &src, ch);
                let verdict = if over == usize::MAX { "SILENT" }
                    else if over > 6 { "DROPS" } else if p95 > 100.0 { "risky" } else { "ok" };
                let shown = if over == usize::MAX { "-".to_string() } else { over.to_string() };
                println!("  {:<9} {:>6} {:>6.0}ms {:>7.1}% {:>6.1}% {:>7} {:>6}",
                    format!("{alg:?}"), layers, win, mean, p95, shown, verdict);
            }
        }
    }
}
