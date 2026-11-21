//! What the Chop page hears in a sound (`ui/app/402-chop-listen.js`): the
//! measures of every frame (`chopAnalyseCore`) and the tempo and bars
//! (`chopTempoCurve`, `chopFindTempo`). Doubles, stored to floats where the
//! page stores to a `Float32Array`, as the page does.

use super::js;
use std::f64::consts::PI;

/// `chopAnalyseCore`'s answer: one value a frame of 2048, every 512.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Analysis {
    pub frames: usize,
    pub hop: usize,
    pub n: usize,
    pub low: Vec<f32>,
    pub mid: Vec<f32>,
    pub high: Vec<f32>,
    pub cent: Vec<f32>,
    pub flat: Vec<f32>,
    pub zcr: Vec<f32>,
    pub rms: Vec<f32>,
    pub rise: Vec<f32>,
    pub hz: Vec<f32>,
    pub clar: Vec<f32>,
    /// How strongly the sound repeats, 0 to 1.
    pub pulse: f64,
    /// Hits a second.
    pub hits: f64,
}

/// `chopAnalyseCore(m, sr)`.
pub fn analyse(m: &[f32], sr: f64) -> Analysis {
    const N: usize = 2048;
    const HOP: usize = 512;
    const HALF: usize = N >> 1;
    let len = m.len();
    let f_count = js::max(1.0, ((len as f64 - N as f64) / HOP as f64).floor() + 1.0) as usize;
    let mk = || vec![0.0f32; f_count];
    let (mut low, mut mid, mut high, mut cent, mut flat) = (mk(), mk(), mk(), mk(), mk());
    let (mut zcr, mut rms, mut rise, mut hz, mut clar) = (mk(), mk(), mk(), mk(), mk());
    let mut re = vec![0.0f64; N];
    let mut im = vec![0.0f64; N];
    let win: Vec<f64> = (0..N).map(|i| 0.5 - 0.5 * js::cos(2.0 * PI * i as f64 / (N - 1) as f64)).collect();
    let bin = sr / N as f64;
    let k250 = (250.0 / bin).floor();
    let k4k = (4000.0 / bin).floor();
    // `(m[i] || 0)`
    let mz = |i: i64| if i < 0 { 0.0 } else { js::or0(js::at(m, i as f64)) };

    let fft = |re: &mut [f64], im: &mut [f64]| {
        let mut j = 0usize;
        for i in 1..N {
            let mut b = N >> 1;
            while j & b != 0 {
                j ^= b;
                b >>= 1;
            }
            j ^= b;
            if i < j {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
        let mut l = 2;
        while l <= N {
            let a = -2.0 * PI / l as f64;
            let wr = js::cos(a);
            let wi = js::sin(a);
            let mut i = 0;
            while i < N {
                let (mut cr, mut ci) = (1.0f64, 0.0f64);
                for j in 0..l >> 1 {
                    let k = i + j;
                    let n = k + (l >> 1);
                    let xr = re[n] * cr - im[n] * ci;
                    let xi = re[n] * ci + im[n] * cr;
                    re[n] = re[k] - xr;
                    im[n] = im[k] - xi;
                    re[k] += xr;
                    im[k] += xi;
                    let t = cr * wr - ci * wi;
                    ci = cr * wi + ci * wr;
                    cr = t;
                }
                i += l;
            }
            l <<= 1;
        }
    };

    let (mut prev_db, mut pre) = (0.0f64, 0.0f64);
    for f in 0..f_count {
        let p = f * HOP;
        for i in 0..N {
            re[i] = mz((p + i) as i64) * win[i];
            im[i] = 0.0;
        }
        fft(&mut re, &mut im);
        let (mut tot, mut cs, mut lg, mut lo, mut hi) = (1e-9f64, 0.0f64, 0.0f64, 0.0f64, 0.0f64);
        for k in 0..=HALF {
            let v = js::hypot(re[k], im[k]);
            let kf = k as f64;
            tot += v;
            cs += kf * bin * v;
            lg += js::log(js::max(v, 1e-9));
            if kf < k250 {
                lo += v;
            }
            if kf >= k4k {
                hi += v;
            }
        }
        low[f] = (lo / tot) as f32;
        high[f] = (hi / tot) as f32;
        mid[f] = (1.0 - low[f] as f64 - high[f] as f64) as f32;
        cent[f] = (cs / tot) as f32;
        let h1 = (HALF + 1) as f64;
        flat[f] = js::min(1.0, js::exp(lg / h1) / (tot / h1)) as f32;

        let (mut z, mut e, mut ed) = (0u32, 0.0f64, 0.0f64);
        let c0 = (p + HALF) as i64 - (HOP >> 1) as i64;
        for i in 0..HOP as i64 {
            let v = mz(c0 + i);
            let u = mz(c0 + i - 1);
            if i != 0 && (u < 0.0) != (v < 0.0) {
                z += 1;
            }
            e += v * v;
            let d = v - 0.97 * pre;
            pre = v;
            ed += d * d;
        }
        zcr[f] = (z as f64 / (HOP - 1) as f64) as f32;
        rms[f] = (e / HOP as f64).sqrt() as f32;
        let db = 10.0 * js::log10(ed / HOP as f64 + 1e-10);
        rise[f] = if f != 0 { js::max(0.0, db - prev_db) } else { 0.0 } as f32;
        prev_db = db;
    }

    // `Float32Array.from(rise).sort()`: numbers, ascending.
    let mut sorted = rise.clone();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let r99 = sorted.get((f_count as f64 * 0.99).floor() as usize).map_or(0.0, |v| *v as f64);
    let r99 = if r99 == 0.0 || r99.is_nan() { 1.0 } else { r99 };
    for v in rise.iter_mut() {
        *v = js::min(1.0, *v as f64 / r99) as f32;
    }
    for f in 1..f_count {
        rise[f] = js::max(rise[f] as f64, rise[f - 1] as f64 * 0.8) as f32;
    }

    // The note, by YIN on 12 kHz.
    let dec = js::max(1.0, js::round(sr / 12000.0)) as usize;
    let rate = sr / dec as f64;
    let mm = len / dec;
    let mut d = vec![0.0f32; mm];
    for (i, o) in d.iter_mut().enumerate() {
        let mut v = 0.0f64;
        for j in 0..dec {
            v += m[i * dec + j] as f64;
        }
        *o = (v / dec as f64) as f32;
    }
    const W: i64 = 512;
    let t_max = js::min((W - 2) as f64, (rate / 35.0).floor()) as i64;
    let t_min = js::max(2.0, (rate / 2000.0).floor()) as i64;
    let step = js::max(2.0, (f_count as f64 / 1500.0).ceil()) as usize;
    let delta = |at: i64, t: i64| {
        let mut v = 0.0f64;
        let mut i = 0;
        while i < W {
            let q = d[(at + i) as usize] as f64 - d[(at + i + t) as usize] as f64;
            v += q * q;
            i += 2;
        }
        v
    };
    let mut f = 0;
    while f < f_count {
        let at = ((f * HOP + HALF) as f64 / dec as f64).floor() as i64 - (W >> 1);
        let mut found = 0i64;
        let mut clarity = 0.0f64;
        if at >= 0 && at + W + t_max < mm as i64 {
            let (mut sum, mut min) = (0.0f64, 1.0f64);
            let mut t = 1;
            while t <= t_max && found == 0 {
                let v = delta(at, t);
                sum += v;
                let mut cm = if sum > 0.0 { v * t as f64 / sum } else { 1.0 };
                if t < t_min {
                    t += 1;
                    continue;
                }
                if cm < min {
                    min = cm;
                }
                if cm >= 0.15 {
                    t += 1;
                    continue;
                }
                let mut tt = t;
                while tt < t_max {
                    let v2 = delta(at, tt + 1);
                    let nx = if sum + v2 > 0.0 { v2 * (tt + 1) as f64 / (sum + v2) } else { 1.0 };
                    if nx >= cm {
                        break;
                    }
                    cm = nx;
                    sum += v2;
                    tt += 1;
                }
                found = tt;
                clarity = 1.0 - cm;
                t += 1;
            }
            if found == 0 {
                clarity = js::max(0.0, 1.0 - min);
            }
        }
        for k in f..f_count.min(f + step) {
            hz[k] = if found != 0 { rate / found as f64 } else { 0.0 } as f32;
            clar[k] = clarity as f32;
        }
        f += step;
    }

    // Does it repeat, and how busy is it.
    let hop_e = js::max(1.0, (sr * 0.01).floor()) as usize;
    let mut big_e = vec![0.0f32; len / hop_e];
    let mut mean = 0.0f64;
    for i in 0..big_e.len() {
        let mut v = 0.0f64;
        let mut j = 0;
        while j < hop_e {
            let x = m[i * hop_e + j] as f64;
            v += x * x;
            j += 2;
        }
        big_e[i] = (v / (hop_e as f64 / 2.0)).sqrt() as f32;
        mean += big_e[i] as f64;
    }
    mean /= if big_e.is_empty() { 1.0 } else { big_e.len() as f64 };
    let (mut on, mut armed) = (0u32, true);
    for i in 1..big_e.len() {
        let (v, p) = (big_e[i] as f64, big_e[i - 1] as f64);
        if v > p * 1.6 && v > mean * 0.8 && armed {
            on += 1;
            armed = false;
        } else if v < mean * 0.6 {
            armed = true;
        }
    }
    let c: Vec<f32> = big_e.iter().map(|&v| (v as f64 - mean) as f32).collect();
    let mut total = 0.0f64;
    for &v in &c {
        total += v as f64 * v as f64;
    }
    let mut pulse = 0.0f64;
    let cl = c.len();
    for l in 6..200.min(cl / 2) {
        let mut a = 0.0f64;
        for i in 0..cl - l {
            a += c[i] as f64 * c[i + l] as f64;
        }
        let s = a / (total * js::max(0.1, (cl - l) as f64 / cl as f64) + 1e-9);
        if s > pulse {
            pulse = s;
        }
    }
    Analysis {
        frames: f_count,
        hop: HOP,
        n: N,
        low,
        mid,
        high,
        cent,
        flat,
        zcr,
        rms,
        rise,
        hz,
        clar,
        pulse: js::min(1.0, pulse),
        hits: on as f64 / (len as f64 / sr),
    }
}

/// `chopTempoCurve`: how strongly the hits repeat at each tempo, for
/// `score`. At most a minute is read, from the middle of S to E.
pub struct TempoCurve {
    ac: Vec<f32>,
    max_lag: f64,
    hop: f64,
}

impl TempoCurve {
    pub fn new(mono: &[f32], rate: f64, region: (i64, i64)) -> Option<TempoCurve> {
        const HOP: i64 = 256;
        let most = js::round(rate * 60.0) as i64;
        let (s0, e0) = region;
        let s = if e0 - s0 > most { s0 + ((e0 - s0 - most) as f64 / 2.0).floor() as i64 } else { s0 };
        let e = if e0 - s0 > most { s + most } else { e0 };
        let n = ((e - s) as f64 / HOP as f64).floor() as i64;
        if n < 64 {
            return None;
        }
        let nu = n as usize;
        let mut db = vec![0.0f32; nu];
        let mut prev = 0.0f64;
        for k in 0..n {
            let mut acc = 0.0f64;
            let a = s + k * HOP;
            for j in a..a + HOP {
                let v = mono[j as usize] as f64;
                let d = v - 0.97 * prev;
                prev = v;
                acc += d * d;
            }
            db[k as usize] = (10.0 * js::log10(acc / HOP as f64 + 1e-10)) as f32;
        }
        let mut rise = vec![0.0f32; nu];
        let mut m = 0.0f64;
        for k in 1..nu {
            rise[k] = js::max(0.0, db[k] as f64 - db[k - 1] as f64) as f32;
            m += rise[k] as f64;
        }
        m /= n as f64;
        for v in rise.iter_mut() {
            *v = (*v as f64 - m) as f32;
        }
        let hop = HOP as f64 / rate;
        let max_lag = js::min((n - 1) as f64, (5.2 / hop).ceil()) as usize;
        let mut ac = vec![0.0f32; max_lag + 2];
        for l in 0..=max_lag {
            let mut v = 0.0f64;
            for k in 0..nu - l {
                v += rise[k] as f64 * rise[k + l] as f64;
            }
            ac[l] = (v / (nu - l) as f64) as f32;
        }
        Some(TempoCurve { ac, max_lag: max_lag as f64, hop })
    }

    fn at(&self, lag: f64) -> f64 {
        if lag >= self.max_lag {
            return 0.0;
        }
        let i = lag.floor();
        let u = lag - i;
        self.ac[i as usize] as f64 * (1.0 - u) + self.ac[i as usize + 1] as f64 * u
    }

    /// A tempo's score: hits at its beat and its multiples, leaning to 120.
    pub fn score(&self, bpm: f64) -> f64 {
        let beat = 60.0 / bpm / self.hop;
        let (mut v, mut w) = (0.0f64, 0.0f64);
        for (q, g) in [(1.0, 1.0), (2.0, 0.8), (4.0, 0.7), (0.5, 0.35), (8.0, 0.5)] {
            let lag = beat * q;
            if lag >= self.max_lag {
                continue;
            }
            v += g * self.at(lag);
            w += g;
        }
        let l2 = js::log2(bpm / 120.0);
        (v / if w == 0.0 { 1.0 } else { w }) / self.ac[0] as f64 * js::exp(-0.5 * (l2 * l2))
    }
}

/// `chopFindTempo`'s answer.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tempo {
    pub bpm: f64,
    /// The best tempo heard, whole bars or not.
    pub heard: f64,
    pub bars: f64,
    pub beats: f64,
    /// S to E is whole bars at `bpm`.
    pub whole: bool,
    /// How far S to E is from `heard`'s count, in ms.
    pub off: f64,
    /// How sure, 0 to 1.
    pub sure: f64,
}

/// `chopFindTempo`: the tempo, and how many whole bars of `sig` S to E is.
pub fn find_tempo(mono: &[f32], rate: f64, region: (i64, i64), sig: f64) -> Option<Tempo> {
    let t = TempoCurve::new(mono, rate, region)?;
    let sec = (region.1 - region.0) as f64 / rate;
    let (mut free, mut fs) = (0.0f64, -1e9f64);
    let mut b = 60.0f64;
    while b <= 200.0 {
        let v = t.score(b);
        if v > fs {
            fs = v;
            free = b;
        }
        b += 0.25;
    }
    let (mut bars, mut bs, mut whole) = (0.0f64, -1e9f64, 0.0f64);
    for n in 1..=999 {
        let n = n as f64;
        let b = n * sig * 60.0 / sec;
        if b < 60.0 {
            continue;
        }
        if b > 200.0 {
            break;
        }
        let v = t.score(b);
        if v > bs {
            bs = v;
            bars = n;
            whole = b;
        }
    }
    let sure = js::max(0.0, js::min(1.0, fs / 0.35));
    let total = js::max(1.0, js::round(sec * free / 60.0));
    let even = total * 60.0 / sec;
    let nb = js::max(1.0, (total / sig).floor());
    let rest = if total < sig { 0.0 } else { total % sig };
    if bars > 0.0 && bs >= fs * 0.8 {
        return Some(Tempo { bpm: whole, heard: free, bars, beats: 0.0, whole: true, off: 0.0, sure });
    }
    if rest == 0.0 && (even - free).abs() / free < 0.015 {
        return Some(Tempo { bpm: even, heard: free, bars: nb, beats: 0.0, whole: true, off: 0.0, sure });
    }
    Some(Tempo { bpm: even, heard: free, bars: nb, beats: rest, whole: false, off: (total * 60.0 / free - sec) * 1000.0, sure })
}
