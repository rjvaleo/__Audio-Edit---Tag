//! Is the twiddle table worth it, and is it the same answer?
use std::f32::consts::PI;

fn fft_inline(re: &mut [f32], im: &mut [f32]) {
    let n = re.len();
    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 { j ^= bit; bit >>= 1; }
        j |= bit;
        if i < j { re.swap(i, j); im.swap(i, j); }
    }
    let mut len = 2usize;
    while len <= n {
        let ang = -2.0 * PI / len as f32;
        let mut i = 0;
        while i < n {
            for k in 0..len / 2 {
                let a = ang * k as f32;
                let (cr, ci) = (a.cos(), a.sin());
                let (ur, ui) = (re[i + k], im[i + k]);
                let (xr, xi) = (re[i + k + len / 2], im[i + k + len / 2]);
                let vr = xr * cr - xi * ci;
                let vi = xr * ci + xi * cr;
                re[i + k] = ur + vr; im[i + k] = ui + vi;
                re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
            }
            i += len;
        }
        len <<= 1;
    }
}

/// One table of exp(-2*pi*i*j/N) covers every power-of-two size up to N by
/// striding: the twiddle for stage `len`, index `k`, is `table[k * (N/len)]`.
fn table(n: usize) -> Vec<(f32, f32)> {
    (0..n / 2).map(|j| {
        let a = -2.0 * PI * j as f32 / n as f32;
        (a.cos(), a.sin())
    }).collect()
}

fn fft_table(re: &mut [f32], im: &mut [f32], tw: &[(f32, f32)], nmax: usize) {
    let n = re.len();
    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 { j ^= bit; bit >>= 1; }
        j |= bit;
        if i < j { re.swap(i, j); im.swap(i, j); }
    }
    let mut len = 2usize;
    while len <= n {
        let stride = nmax / len;
        let mut i = 0;
        while i < n {
            for k in 0..len / 2 {
                let (cr, ci) = tw[k * stride];
                let (ur, ui) = (re[i + k], im[i + k]);
                let (xr, xi) = (re[i + k + len / 2], im[i + k + len / 2]);
                let vr = xr * cr - xi * ci;
                let vi = xr * ci + xi * cr;
                re[i + k] = ur + vr; im[i + k] = ui + vi;
                re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
            }
            i += len;
        }
        len <<= 1;
    }
}

fn main() {
    const N: usize = 8192;
    let tw = table(N);
    let mk = || (0..N).map(|i| (i as f32 * 0.001).sin() * 0.5).collect::<Vec<f32>>();

    for n in [1024usize, 2048, 4096, 8192] {
        let src: Vec<f32> = mk()[..n].to_vec();
        let (mut a_re, mut a_im) = (src.clone(), vec![0f32; n]);
        let (mut b_re, mut b_im) = (src.clone(), vec![0f32; n]);
        fft_inline(&mut a_re, &mut a_im);
        fft_table(&mut b_re, &mut b_im, &tw, N);
        let mut worst = 0.0f32;
        let mut mag = 0.0f32;
        for i in 0..n {
            worst = worst.max((a_re[i] - b_re[i]).abs()).max((a_im[i] - b_im[i]).abs());
            mag = mag.max(a_re[i].abs()).max(a_im[i].abs());
        }

        let reps = 400;
        let t0 = std::time::Instant::now();
        for _ in 0..reps { let (mut r, mut m) = (src.clone(), vec![0f32; n]); fft_inline(&mut r, &mut m); std::hint::black_box(&r); }
        let inline = t0.elapsed().as_secs_f64() / reps as f64;
        let t1 = std::time::Instant::now();
        for _ in 0..reps { let (mut r, mut m) = (src.clone(), vec![0f32; n]); fft_table(&mut r, &mut m, &tw, N); std::hint::black_box(&r); }
        let tabled = t1.elapsed().as_secs_f64() / reps as f64;

        println!("  n={n:<5} inline {:>7.1} us   table {:>7.1} us   {:.2}x faster   worst diff {:.2e} of peak {:.2}",
            inline * 1e6, tabled * 1e6, inline / tabled, worst, mag);
    }
}
