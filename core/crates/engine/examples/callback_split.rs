//! Where a block's time actually goes, so optimisation aims at the right thing.
use engine::{Source, Stretcher};
use fx::grain::StreamParams;
use fx::stretch::Algorithm;
const SR: u32 = 48_000;
const BLOCK: usize = 2048;

fn main() {
    let ch = 2;
    let n = SR as usize * 4;
    let mut samples = Vec::with_capacity(n * ch);
    for i in 0..n {
        let t = i as f32 / SR as f32;
        let s = (t * 200.0 * std::f32::consts::TAU).sin() * 0.3
              + (t * 700.0 * std::f32::consts::TAU).sin() * 0.2;
        for _ in 0..ch { samples.push(s); }
    }
    let src = Source { samples, channels: ch };
    let budget = BLOCK as f64 / SR as f64;

    let mut sp = StreamParams::new(n, SR);
    sp.algorithm = Algorithm::Vocoder;
    sp.ratio = 8.0;
    sp.grain.layers = 3;
    sp.vocoder.window_ms = 190.0;

    let mut st = Stretcher::new(BLOCK, ch, SR);
    st.set_bank(engine::stretcher::LayerBank::build(
        sp.algorithm, sp.grain.layers, BLOCK, ch, SR));
    st.seek(0, &sp);
    let mut out = vec![0f32; BLOCK * ch];
    let mut ev = vec![fx::grain::GrainEvent {
        index: 0, out_frame: 0, src_frame: 0.0, size: 0, rate: 1.0, pitch_semis: 0.0 }; 8192];
    for _ in 0..15 { st.render(&mut out, ch, &src, &sp, &mut ev); }

    // The stretch alone.
    let mut t = 0.0f64;
    for _ in 0..150 {
        let t0 = std::time::Instant::now();
        st.render(&mut out, ch, &src, &sp, &mut ev);
        t += t0.elapsed().as_secs_f64();
    }
    println!("  stretch (3 layers, vocoder 190ms) : {:>6.2}% of budget", t / 150.0 / budget * 100.0);

    // The window recomputation `measure` does per FFT, on its own.
    const FFT_SIZE: usize = 1024;
    let mut win = vec![0f32; FFT_SIZE];
    let t0 = std::time::Instant::now();
    let reps = 150;
    for _ in 0..reps {
        for i in 0..FFT_SIZE {
            win[i] = 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (FFT_SIZE - 1) as f32).cos();
        }
    }
    let per = t0.elapsed().as_secs_f64() / reps as f64;
    println!("  the Hann window, recomputed       : {:>6.2}% of budget, each time it is built", per / budget * 100.0);
    println!("    (built once per {} samples, so ~{:.0} times a second)", FFT_SIZE, SR as f64 / FFT_SIZE as f64);
    println!("    = {:>6.2}% of budget amortised over every block", per / budget * 100.0 * (BLOCK as f64 / FFT_SIZE as f64));
    std::hint::black_box(&win);
}
