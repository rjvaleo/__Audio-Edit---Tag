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
static BLOCK_SIZES: &[usize] = &[256, 512, 1024, 2048];

fn cost(sp: &StreamParams, src: &Source, ch: usize, block: usize) -> (f64, f64, usize) {
    let budget = block as f64 / SR as f64;
    let mut st = Stretcher::new(block, ch, SR);
    st.set_bank(engine::stretcher::LayerBank::build(
        sp.algorithm, sp.grain.layers, block, ch, SR));
    // The hybrid works on a *separated* source and is handed it from off the
    // audio thread. Without this it has nothing to do and reports a tenth of a
    // percent — which is not "fast", it is "not running", and reporting it as a
    // cost would be a lie.
    if sp.algorithm == Algorithm::Hybrid {
        st.set_parts(std::sync::Arc::new(fx::hstream::Parts::separate(
            &src.samples, ch, sp.hybrid)));
    }
    st.seek(0, sp);
    let mut out = vec![0f32; block * ch];
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

    println!("How small a buffer can each setting stand?\n");
    println!("  Lower buffer = lower latency. The limit is the worst *block*, not the average.\n");
    println!("  {:<9} {:>6} {:>7}   {}", "engine", "layers", "window", "256    512   1024   2048   (worst block, % of that buffer's budget)");
    for alg in [Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Pvsola, Algorithm::Hybrid] {
        for layers in [1u32, 3, 8] {
            let win = 190.0f32;
            let mut row = String::new();
            let mut safest = 0usize;
            for &block in BLOCK_SIZES {
                let mut sp = StreamParams::new(n, SR);
                sp.algorithm = alg;
                sp.ratio = 8.0;
                sp.grain.layers = layers;
                sp.grain.overlap = 2.0;
                sp.window_ms = win;
                sp.vocoder.window_ms = win;
                let (_mean, p95, _over) = cost(&sp, &src, ch, block);
                row.push_str(&format!("{p95:>6.0}%"));
                if p95 < 80.0 && safest == 0 { safest = block; }
            }
            let ms = safest as f64 / SR as f64 * 1000.0;
            println!("  {:<9} {:>6} {:>6.0}ms  {}   -> {} ({:.1} ms)",
                format!("{alg:?}"), layers, win, row,
                if safest > 0 { safest.to_string() } else { "none".into() }, ms);
        }
    }
}
