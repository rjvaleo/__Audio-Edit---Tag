//! What the "Breaking" preset costs per block, and where the cost is.
//!
//! Vocoder at ratio 19.4, a 386 ms analysis window (clamped to the 8192-point
//! maximum), three layers, and the grain cloud mixed in at 41% — which is a
//! whole second engine running beside the first.
use engine::{Source, Stretcher};
use fx::grain::StreamParams;
use fx::stretch::Algorithm;
const SR: u32 = 48_000;

fn breaking(in_frames: usize) -> StreamParams {
    let mut sp = StreamParams::new(in_frames, SR);
    sp.algorithm = Algorithm::Vocoder;
    sp.ratio = 19.408859;
    sp.semitones = -9.629;
    sp.window_ms = 1314.879;
    sp.vocoder.window_ms = 386.3403;
    sp.vocoder.phase_lock = true;
    sp.vocoder.peak_width = 2;
    sp.grain.layers = 3;
    sp.grain.layer_spread = 1.0;
    sp.grain.overlap = 2.0;
    sp.grain.density_hz = 0.0;
    sp.grain.position_jitter_ms = 500.0;
    sp.grain.pitch_jitter_semis = 2.2072368;
    sp.grain.drift_rate_hz = 0.5;
    sp.grain.envelope = 0.5;
    sp.cloud = true;
    sp.cloud_mix = 0.41;
    sp
}

/// The preset's own rack: a four-band EQ and a compressor.
///
/// The engine runs this on every block *after* the stretch, so it is part of
/// the same budget. Measuring the stretch alone flatters the picture.
fn rack(sr: u32, ch: usize) -> fx::Rack {
    let mut r = fx::Rack::new();
    let mut eq = fx::eq::EqSettings::default();
    eq.high_pass_hz = 195.03;
    eq.low = fx::eq::Band { freq: 195.03, q: 0.7, gain_db: 0.0 };
    eq.mid = fx::eq::Band { freq: 1000.0, q: 1.0, gain_db: 0.0 };
    eq.high = fx::eq::Band { freq: 244.52, q: 0.7, gain_db: 16.37 };
    r.push(Box::new(fx::eq::Eq::new(eq)));
    r.push(Box::new(fx::comp::Compressor::new(fx::comp::CompSettings {
        threshold_db: -25.086,
        ratio: 10.9,
        attack_ms: 10.0,
        release_ms: 120.0,
        knee_db: 18.216,
        makeup_db: 6.8,
    })));
    let _ = (sr, ch);
    r
}

fn run(label: &str, sp: &StreamParams, src: &Source, block: usize, ch: usize) {
    let budget = block as f64 / SR as f64;
    let mut st = Stretcher::new(block, ch, SR);
    st.set_bank(engine::stretcher::LayerBank::build(
        sp.algorithm, sp.grain.layers, block, ch, SR));
    st.seek(0, sp);
    let mut out = vec![0f32; block * ch];
    let mut ev = vec![fx::grain::GrainEvent {
        index: 0, out_frame: 0, src_frame: 0.0, size: 0, rate: 1.0, pitch_semis: 0.0 }; 4096];
    let mut rk = rack(SR, ch);
    for _ in 0..20 { st.render(&mut out, ch, src, sp, &mut ev); }
    let mut costs = Vec::new();
    for _ in 0..200 {
        let t0 = std::time::Instant::now();
        st.render(&mut out, ch, src, sp, &mut ev);
        rk.process(&mut out, ch, SR);
        costs.push(t0.elapsed().as_secs_f64() / budget * 100.0);
    }
    costs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mean: f64 = costs.iter().sum::<f64>() / costs.len() as f64;
    println!("  {label:<28} mean {mean:>6.1}%  p50 {:>6.1}%  p95 {:>6.1}%  max {:>6.1}%  over budget: {}/200",
        costs[100], costs[190], costs[199],
        costs.iter().filter(|c| **c > 100.0).count());
}

/// What a *seek* costs, against one block's budget.
///
/// Every parameter change that `Rebuilds::decide` calls structural re-seeks the
/// engine, and a seek happens inside the audio callback. If it costs more than
/// a block, the device runs dry — and it is invisible to any steady-state
/// measurement, which is why the load meter's `worst` can be over budget while
/// a two-hundred-block sweep says everything is fine.
fn seek_cost(sp: &StreamParams, src: &Source, block: usize, ch: usize) {
    let budget = block as f64 / SR as f64;
    let mut st = Stretcher::new(block, ch, SR);
    st.set_bank(engine::stretcher::LayerBank::build(
        sp.algorithm, sp.grain.layers, block, ch, SR));
    let mut out = vec![0f32; block * ch];
    let mut ev = vec![fx::grain::GrainEvent {
        index: 0, out_frame: 0, src_frame: 0.0, size: 0, rate: 1.0, pitch_semis: 0.0 }; 4096];
    st.seek(0, sp);
    for _ in 0..10 { st.render(&mut out, ch, src, sp, &mut ev); }

    let mut worst = 0.0f64;
    let mut total = 0.0f64;
    let n = 40;
    for i in 0..n {
        let t0 = std::time::Instant::now();
        st.seek((i as u64 + 1) * 40_000, sp);
        let d = t0.elapsed().as_secs_f64() / budget * 100.0;
        worst = worst.max(d);
        total += d;
        st.render(&mut out, ch, src, sp, &mut ev);
    }
    println!("    seek: mean {:>7.1}%  worst {:>7.1}% of one block's budget", total / n as f64, worst);
}

/// Does the extra overlap buy anything audible?
///
/// At density 91 the hop is 527 frames against an 8192-point window — 15.5x
/// overlap. A phase vocoder is normally run at 4x. If the output at a capped
/// hop is indistinguishable, the extra 4x of work is pure waste and capping it
/// is free; if it is different, capping changes the sound and is a decision
/// rather than a fix.
fn overlap_worth(src: &Source, ch: usize) {
    let n = src.samples.len() / ch;
    let mk = |hop_density: f32| {
        let mut st = fx::Stretch::default();
        st.algorithm = Algorithm::Vocoder;
        st.ratio = 19.408859;
        st.semitones = -9.629;
        st.window_ms = 1314.879;
        st.vocoder.window_ms = 386.3403;
        st.vocoder.phase_lock = true;
        st.vocoder.peak_width = 2;
        st.grain.layers = 1;            // one layer, so this is about the hop
        st.grain.overlap = 2.0;
        st.grain.density_hz = hop_density;
        st.grain.envelope = 0.5;
        st
    };
    let a = mk(91.0).process(&src.samples, ch, SR);
    // 46.9 Hz is the density at which a hop of win/8 (1024 frames, 8x overlap)
    // would be reached — the clamp under consideration.
    for d in [46.9f32, 24.0, 12.0] {
        let b = mk(d).process(&src.samples, ch, SR);
        let m = a.len().min(b.len());
        let peak = a.iter().take(m).fold(0.0f32, |x, v| x.max(v.abs())).max(1e-9);
        let mut worst = 0.0f32;
        let mut sum = 0.0f64;
        for i in 0..m {
            let e = (a[i] - b[i]).abs();
            worst = worst.max(e);
            sum += (e * e) as f64;
        }
        let rms = (sum / m as f64).sqrt() as f32 / peak;
        println!("    density 91 (hop 527) vs density {d:>4} (hop {:>5}): rms diff {:>6.2}% of peak, worst {:>6.1}%",
            (SR as f32 / d) as usize, rms * 100.0, worst / peak * 100.0);
    }
    let _ = n;
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

    println!("fft for 386.3ms = {}", fx::stretch::fft_size_for(386.3403, SR));
    {
        let g0 = breaking(n).grain;
        let mut g1 = g0; g1.density_hz = 91.0;
        let win = 8192usize;
        println!("  synthesis hop at density 0  : {} frames", fx::stretch::hop_frames(&g0, win, SR as f32));
        println!("  synthesis hop at density 91 : {} frames", fx::stretch::hop_frames(&g1, win, SR as f32));
    }
    // Clipping, or dropouts? They sound different and have different fixes.
    {
        let mut sp = breaking(n);
        sp.grain.density_hz = 91.0;
        let block = 2048usize;
        let mut st = Stretcher::new(block, ch, SR);
        st.set_bank(engine::stretcher::LayerBank::build(
            sp.algorithm, sp.grain.layers, block, ch, SR));
        st.seek(0, &sp);
        let mut out = vec![0f32; block * ch];
        let mut ev = vec![fx::grain::GrainEvent {
            index: 0, out_frame: 0, src_frame: 0.0, size: 0, rate: 1.0, pitch_semis: 0.0 }; 4096];
        let mut rk = rack(SR, ch);
        let (mut dry_peak, mut wet_peak, mut over) = (0.0f32, 0.0f32, 0usize);
        let (mut soft_peak, mut soft_over) = (0.0f32, 0usize);
        let mut total = 0usize;
        for _ in 0..300 {
            st.render(&mut out, ch, &src, &sp, &mut ev);
            for v in out.iter() { dry_peak = dry_peak.max(v.abs()); }
            rk.process(&mut out, ch, SR);
            for v in out.iter() {
                wet_peak = wet_peak.max(v.abs());
                if v.abs() > 1.0 { over += 1; }
                total += 1;
            }
            // The same block through the soft ceiling — every block, not the
            // last one. Comparing one block against a 300-block maximum is how
            // the first version of this reported -13 dBFS and meant nothing.
            let mut soft = out.clone();
            fx::soften(&mut soft);
            for v in soft.iter() {
                soft_peak = soft_peak.max(v.abs());
                if v.abs() > 1.0 { soft_over += 1; }
            }
        }
        let db = |x: f32| 20.0 * x.max(1e-9).log10();
        println!("level, over {} blocks at 2048:", 300);
        println!("  peak out of the stretch  : {:.3}  ({:+.1} dBFS)", dry_peak, db(dry_peak));
        println!("  peak after the rack      : {:.3}  ({:+.1} dBFS)", wet_peak, db(wet_peak));
        println!("  samples past full scale  : {} of {}  ({:.2}%)", over, total,
                 over as f64 / total as f64 * 100.0);
        println!("  after the soft ceiling   : {:.3}  ({:+.1} dBFS), {} past full scale",
                 soft_peak, db(soft_peak), soft_over);
    }

    println!("is the extra overlap doing anything?");
    overlap_worth(&src, ch);

    for block in [512usize, 1024, 2048] {
        println!("block {block}:");
        run("Breaking (density 0)", &breaking(n), &src, block, ch);
        let mut again = breaking(n);
        again.grain.density_hz = 91.0;      // the *only* difference
        run("Breaking Again (density 91)", &again, &src, block, ch);
        let mut capped = again; capped.grain.density_hz = 46.9;   // hop 1024, 8x overlap
        run("...Again, hop capped at win/8", &capped, &src, block, ch);
        let mut one = again; one.grain.layers = 1;
        run("...Again with 1 layer", &one, &src, block, ch);
    }
}
