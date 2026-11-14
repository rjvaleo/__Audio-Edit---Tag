//! The first pass: read a file once, keep only small per-frame numbers.
//!
//! A fifteen-minute song is 40 million samples a channel; holding five of
//! them as `f32` would be most of the machine's memory. So each file is
//! streamed through two short-time Fourier transforms and what survives is a
//! handful of numbers per frame, plus the bass at an eighth of the rate for
//! pitch tracking.

use audio_core::fft;

/// The coarse transform: spectrum shape, chroma, tuning.
pub const COARSE_N: usize = 4096;
pub const COARSE_HOP: usize = 1024;
/// The fine transform: onsets, drum bands.
pub const FINE_N: usize = 1024;
pub const FINE_HOP: usize = 256;
/// The bass is kept at rate / 8 for pitch tracking.
pub const DECIMATE: usize = 8;

/// One coarse frame.
#[derive(Clone, Copy, Default)]
pub struct Coarse {
    /// Sum of power over the spectrum (proportional to mean square).
    pub energy: f32,
    pub centroid: f32,
    pub rolloff: f32,
    /// Geometric over arithmetic mean of power, 0 (tonal) .. 1 (noise).
    pub flatness: f32,
    /// Power above 8 kHz.
    pub hf: f32,
    pub chroma: [f32; 12],
}

/// One fine frame: positive spectral change in three bands and overall.
#[derive(Clone, Copy, Default)]
pub struct Fine {
    pub low: f32,  // 40-150 Hz: kick
    pub mid: f32,  // 200-2500 Hz: snare, clap
    pub high: f32, // 5-15 kHz: hats
    pub all: f32,
}

pub struct Features {
    pub rate: u32,
    pub frames: u64,
    pub coarse: Vec<Coarse>,
    pub fine: Vec<Fine>,
    /// Mono at rate / DECIMATE, low-passed first. Only when asked for.
    pub low_rate: Vec<f32>,
    /// Deviation from 12-TET (re A440) of spectral peaks, 1-cent bins, -50..50.
    pub dev_hist: [f64; 100],
    /// Peak positions within the octave re A, 10-cent bins (120).
    pub oct_hist: [f64; 120],
    /// Per coarse hop, sums of L*L, R*R, L*R (stereo files only).
    pub lr: Vec<[f32; 3]>,
}

struct Stft {
    n: usize,
    hop: usize,
    win: Vec<f32>,
    buf: Vec<f32>,
    start: usize,
    re: Vec<f32>,
    im: Vec<f32>,
    prev: Vec<f32>,
}

impl Stft {
    fn new(n: usize, hop: usize) -> Self {
        Stft { n, hop, win: fft::hann(n), buf: Vec::new(), start: 0, re: vec![0.0; n], im: vec![0.0; n], prev: vec![0.0; n / 2] }
    }
    /// Push samples; call `f` with each full frame's power spectrum (n/2 bins).
    fn push(&mut self, x: &[f32], mut f: impl FnMut(&[f32], &mut [f32])) {
        self.buf.extend_from_slice(x);
        while self.buf.len() - self.start >= self.n {
            let s = &self.buf[self.start..self.start + self.n];
            for i in 0..self.n {
                self.re[i] = s[i] * self.win[i];
                self.im[i] = 0.0;
            }
            fft::fft(&mut self.re, &mut self.im);
            let mut pow = vec![0.0f32; self.n / 2];
            for (k, p) in pow.iter_mut().enumerate() {
                *p = self.re[k] * self.re[k] + self.im[k] * self.im[k];
            }
            f(&pow, &mut self.prev);
            self.start += self.hop;
        }
        if self.start > 1 << 16 {
            self.buf.drain(..self.start);
            self.start = 0;
        }
    }
}

/// Read a whole file. `bass` keeps the decimated signal; `stereo` keeps L/R sums.
pub fn read(path: &std::path::Path, bass: bool, stereo: bool) -> Result<Features, String> {
    let mut rd = audio_core::open(path).map_err(|e| format!("{}: {e:?}", path.display()))?;
    let info = *rd.info();
    let ch = info.channels.max(1) as usize;
    let rate = info.sample_rate;
    let frames = info.frames();
    let hz = |k: usize, n: usize| k as f32 * rate as f32 / n as f32;

    let mut out = Features {
        rate,
        frames,
        coarse: Vec::new(),
        fine: Vec::new(),
        low_rate: Vec::new(),
        dev_hist: [0.0; 100],
        oct_hist: [0.0; 120],
        lr: Vec::new(),
    };
    let mut coarse = Stft::new(COARSE_N, COARSE_HOP);
    let mut fine = Stft::new(FINE_N, FINE_HOP);
    // Four one-pole low-passes at about 1 kHz before taking every 8th sample.
    let a = (-2.0 * std::f32::consts::PI * 1000.0 / rate as f32).exp();
    let mut lp = [0.0f32; 4];
    let mut dec_phase = 0usize;
    let mut lr_acc = [0.0f32; 3];
    let mut lr_n = 0usize;

    // Precomputed bin maps for the coarse transform.
    let half = COARSE_N / 2;
    let pc_of: Vec<i32> = (0..half)
        .map(|k| {
            let f = hz(k, COARSE_N);
            if !(80.0..=2000.0).contains(&f) {
                return -1;
            }
            let midi = 69.0 + 12.0 * (f / 440.0).log2();
            (midi.round() as i32).rem_euclid(12)
        })
        .collect();
    let band = |lo: f32, hi: f32| -> (usize, usize) {
        let b = |f: f32| ((f * FINE_N as f32 / rate as f32).round() as usize).clamp(1, FINE_N / 2 - 1);
        (b(lo), b(hi).max(b(lo) + 1))
    };
    let (kl, kh) = band(40.0, 150.0);
    let (ml, mh) = band(200.0, 2500.0);
    let (hl, hh) = band(5000.0, 15000.0);

    let block = 1u64 << 16;
    let mut pos = 0u64;
    let mut mono = Vec::with_capacity(block as usize);
    while pos < frames {
        let raw = rd.read_frames(pos, block).map_err(|e| e.to_string())?;
        if raw.is_empty() {
            break;
        }
        let got = raw.len() / ch;
        mono.clear();
        for i in 0..got {
            let f = &raw[i * ch..i * ch + ch];
            let m = f.iter().sum::<f32>() / ch as f32;
            mono.push(m);
            if stereo && ch >= 2 {
                lr_acc[0] += f[0] * f[0];
                lr_acc[1] += f[1] * f[1];
                lr_acc[2] += f[0] * f[1];
                lr_n += 1;
                if lr_n == COARSE_HOP {
                    out.lr.push(lr_acc);
                    lr_acc = [0.0; 3];
                    lr_n = 0;
                }
            }
            if bass {
                let mut y = m;
                for s in lp.iter_mut() {
                    *s = a * *s + (1.0 - a) * y;
                    y = *s;
                }
                dec_phase += 1;
                if dec_phase == DECIMATE {
                    dec_phase = 0;
                    out.low_rate.push(y);
                }
            }
        }
        pos += got as u64;

        let cvec = &mut out.coarse;
        let (dh, oh) = (&mut out.dev_hist, &mut out.oct_hist);
        coarse.push(&mono, |pow, _prev| {
            let mut c = Coarse::default();
            let (mut e, mut fe, mut hf, mut lsum) = (0.0f64, 0.0f64, 0.0f64, 0.0f64);
            for (k, &p) in pow.iter().enumerate().skip(1) {
                let p = p as f64;
                e += p;
                fe += p * hz(k, COARSE_N) as f64;
                if hz(k, COARSE_N) > 8000.0 {
                    hf += p;
                }
                lsum += (p + 1e-12).ln();
                if pc_of[k] >= 0 {
                    c.chroma[pc_of[k] as usize] += (p as f32).sqrt();
                }
            }
            let nb = (pow.len() - 1) as f64;
            c.energy = e as f32;
            c.hf = hf as f32;
            if e > 1e-9 {
                c.centroid = (fe / e) as f32;
                c.flatness = ((lsum / nb).exp() / (e / nb)) as f32;
                let mut acc = 0.0;
                for (k, &p) in pow.iter().enumerate().skip(1) {
                    acc += p as f64;
                    if acc >= 0.85 * e {
                        c.rolloff = hz(k, COARSE_N);
                        break;
                    }
                }
                // Tuning: local peaks between 100 Hz and 2 kHz, well above the frame's level.
                let floor = e / nb * 8.0;
                for k in 3..pow.len() - 1 {
                    let f0 = hz(k, COARSE_N);
                    if !(100.0..=2000.0).contains(&f0) {
                        continue;
                    }
                    let (l, m, r) = (pow[k - 1] as f64, pow[k] as f64, pow[k + 1] as f64);
                    if m > l && m >= r && m > floor {
                        let (ll, lm, lr) = ((l + 1e-12).ln(), (m + 1e-12).ln(), (r + 1e-12).ln());
                        let d = 0.5 * (ll - lr) / (ll - 2.0 * lm + lr);
                        let f = (k as f64 + d) * rate as f64 / COARSE_N as f64;
                        let cents = 1200.0 * (f / 440.0).log2();
                        let w = m.sqrt();
                        let dev = cents - 100.0 * (cents / 100.0).round();
                        dh[((dev + 50.0) as usize).min(99)] += w;
                        oh[(cents.rem_euclid(1200.0) / 10.0) as usize % 120] += w;
                    }
                }
            }
            cvec.push(c);
        });

        let fvec = &mut out.fine;
        fine.push(&mono, |pow, prev| {
            let mut f = Fine::default();
            for (k, &p) in pow.iter().enumerate().skip(1) {
                let l = (1.0 + 1e4 * p).ln();
                let d = (l - prev[k]).max(0.0);
                prev[k] = l;
                f.all += d;
                if (kl..kh).contains(&k) {
                    f.low += d;
                } else if (ml..mh).contains(&k) {
                    f.mid += d;
                } else if (hl..hh).contains(&k) {
                    f.high += d;
                }
            }
            fvec.push(f);
        });
    }
    Ok(out)
}
