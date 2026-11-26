//! Accelerate, bound for the Chromium port: a convolution through vDSP's
//! FFTs comes out as the sums do, so its packing and scaling are read right.

use dsp_core::chromium::convolver::Reverb;

#[test]
fn a_convolution_through_accelerate_is_the_convolution() {
    engine_mgl::accelerate::install();
    let mut ir = vec![0.0f32; 20_000];
    let mut s = 7u32;
    for v in ir.iter_mut() {
        s = s.wrapping_mul(1664525).wrapping_add(1013904223);
        *v = (s as f32 / 4294967296.0 - 0.5) * 0.05;
    }
    let mut r = Reverb::new(&[&ir, &ir], 48_000.0, 128, false);
    let quanta = 200;
    let mut x = vec![0.0f32; 128 * quanta];
    x[3] = 1.0;
    x[5000] = -0.7;
    x[9001] = 0.25;
    let (mut yl, mut yr) = (vec![0.0f32; x.len()], vec![0.0f32; x.len()]);
    for q in 0..quanta {
        let src = &x[q * 128..(q + 1) * 128];
        let (l, rr) = (&mut yl[q * 128..(q + 1) * 128], &mut yr[q * 128..(q + 1) * 128]);
        r.process(&[src, src], &mut [l, rr]);
    }
    let mut worst = 0.0f64;
    for t in 0..x.len() {
        let mut want = 0.0f64;
        for (k, h) in ir.iter().enumerate().take(t + 1) {
            want += x[t - k] as f64 * *h as f64;
        }
        worst = worst.max((yl[t] as f64 - want).abs()).max((yr[t] as f64 - want).abs());
    }
    assert!(worst < 1e-5, "worst {worst:e}");
}
