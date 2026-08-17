//! What a block of the "Septermber" preset actually costs.
use engine::{Source, Stretcher};
use fx::grain::StreamParams;
use fx::stretch::Algorithm;
const SR: u32 = 48_000;

fn params(in_frames: usize, layers: u32) -> StreamParams {
    let mut sp = StreamParams::new(in_frames, SR);
    sp.algorithm = Algorithm::Vocoder;
    sp.ratio = 2.2080047;
    sp.window_ms = 42.452709;
    sp.vocoder.window_ms = 185.76761;   // -> a big FFT
    sp.grain.layers = layers;
    sp.grain.layer_spread = 2.18;
    sp.grain.layer_scatter = 0.32;
    sp.grain.layer_scatter_ms = 120.0;
    sp.grain.overlap = 2.0;
    sp.grain.size_jitter = 0.04;
    sp.grain.position_jitter_ms = 500.0;
    sp.grain.envelope = 0.59;
    sp.grain.scan = 1.0;
    sp.grain.wrap = true;
    sp.grain.size_range = 4.5;
    sp.grain.pan_spread = 0.75;
    sp
}

fn main() {
    let ch = 2;
    let n = SR as usize * 6;
    let mut samples = Vec::with_capacity(n * ch);
    for i in 0..n {
        let t = i as f32 / SR as f32;
        let s = (t * 220.0 * std::f32::consts::TAU).sin() * 0.3
            + (t * 277.0 * std::f32::consts::TAU).sin() * 0.25;
        for _ in 0..ch { samples.push(s); }
    }
    let src = Source { samples, channels: ch };

    println!("fft size for 185.8ms = {}", fx::stretch::fft_size_for(185.76761, SR));

    // What the loop is actually quantised to: a synthesis hop is indivisible,
    // and if it is bigger than a block the work cannot help being bursty.
    for win in [46.0f32, 92.0, 185.76761] {
        let sp = params(n, 3);
        let fft = fx::stretch::fft_size_for(win, SR);
        let hs = fx::stretch::hop_frames(&sp.grain, fft, SR as f32).max(1);
        println!(
            "  win {win:>7.1}ms  fft {fft:>5}  synthesis hop {hs:>5} frames  \
= {:.2} blocks of 2048  -> {:.2} hops per block per layer",
            hs as f64 / 2048.0, 2048.0 / hs as f64);
    }
    for win in [46.0f32, 92.0, 185.76761] {
        let block = 2048usize;
        let budget = block as f64 / SR as f64;
        for layers in [1u32, 3] {
            let mut sp = params(n, layers);
            sp.vocoder.window_ms = win;
            let fft = fx::stretch::fft_size_for(win, SR);
            let mut st = Stretcher::new(block, ch, SR);
            st.set_bank(engine::stretcher::LayerBank::build(
                Algorithm::Vocoder, layers, block, ch, SR));
            st.seek(0, &sp);
            let mut out = vec![0f32; block * ch];
            // warm up, then measure the worst block
            let mut ev = vec![fx::grain::GrainEvent { index:0, out_frame:0, src_frame:0.0, size:0, rate:1.0, pitch_semis:0.0 }; 256];
            for _ in 0..20 { st.render(&mut out, ch, &src, &sp, &mut ev); }
            let mut worst = 0f64;
            let mut total = 0f64;
            let rounds = 200;
            for _ in 0..rounds {
                let t0 = std::time::Instant::now();
                st.render(&mut out, ch, &src, &sp, &mut ev);
                let d = t0.elapsed().as_secs_f64();
                if d > worst { worst = d; }
                total += d;
            }
            println!(
                "vocoder window {win:>7.1}ms (fft {fft:>5})  layers {layers}  worst {:>6.1}%  mean {:>5.1}%  spike x{:.1}",
                worst / budget * 100.0, total / rounds as f64 / budget * 100.0, worst / (total / rounds as f64));

            // The distribution, not just the ends. If the work is quantised to
            // whole FFT hops the costs cluster, and the clusters say how many
            // hops a block did.
            if (win - 185.76761).abs() < 1e-3 && layers == 3 {
                let mut costs = Vec::with_capacity(200);
                for _ in 0..200 {
                    let t0 = std::time::Instant::now();
                    st.render(&mut out, ch, &src, &sp, &mut ev);
                    costs.push(t0.elapsed().as_secs_f64() / budget * 100.0);
                }
                costs.sort_by(|a, b| a.partial_cmp(b).unwrap());
                println!("    percentiles: p10 {:.0}%  p50 {:.0}%  p90 {:.0}%  p99 {:.0}%  max {:.0}%",
                    costs[20], costs[100], costs[180], costs[198], costs[199]);
                let mut buckets = [0usize; 7];
                for c in &costs {
                    let b = ((*c / 20.0) as usize).min(6);
                    buckets[b] += 1;
                }
                print!("    histogram (20% bands): ");
                for (i, b) in buckets.iter().enumerate() {
                    if *b > 0 { print!("[{}-{}%: {}] ", i * 20, i * 20 + 20, b); }
                }
                println!();
            }
        }
    }
}
