//! Tempo, beats and bars from an onset envelope.

/// Onset envelope from fine frames: each band scaled to its own spread, summed,
/// with the slow part taken away so only the attacks remain.
pub fn envelope(bands: &[[f32; 3]]) -> Vec<f32> {
    let mut scale = [0.0f32; 3];
    for b in 0..3 {
        let mut v: Vec<f32> = bands.iter().map(|x| x[b]).collect();
        scale[b] = percentile(&mut v, 0.95).max(1e-6);
    }
    let raw: Vec<f32> = bands.iter().map(|x| x[0] / scale[0] + x[1] / scale[1] + x[2] / scale[2]).collect();
    detrend(&raw, 32)
}

/// Subtract a running mean of +-w frames and keep the positive part.
pub fn detrend(x: &[f32], w: usize) -> Vec<f32> {
    let n = x.len();
    let mut pre = vec![0.0f64; n + 1];
    for i in 0..n {
        pre[i + 1] = pre[i] + x[i] as f64;
    }
    (0..n)
        .map(|i| {
            let a = i.saturating_sub(w);
            let b = (i + w + 1).min(n);
            let m = (pre[b] - pre[a]) / (b - a) as f64;
            (x[i] as f64 - m).max(0.0) as f32
        })
        .collect()
}

pub fn percentile(v: &mut [f32], q: f32) -> f32 {
    if v.is_empty() {
        return 0.0;
    }
    let k = ((v.len() - 1) as f32 * q) as usize;
    v.select_nth_unstable_by(k, |a, b| a.total_cmp(b));
    v[k]
}

/// Best tempo in `env` (frames at `fr` per second), 60-200 BPM, leaning to
/// 120. Returns (bpm, confidence 0..1).
pub fn tempo(env: &[f32], fr: f32) -> (f32, f32) {
    let lag_of = |bpm: f32| fr * 60.0 / bpm;
    let (lo, hi) = (lag_of(200.0) as usize, lag_of(60.0).ceil() as usize + 1);
    if env.len() < hi * 6 {
        return (0.0, 0.0);
    }
    // A short triangular smoothing, so attacks a frame apart still line up.
    let env: Vec<f32> = (0..env.len())
        .map(|i| {
            let g = |k: isize| env.get((i as isize + k).max(0) as usize).copied().unwrap_or(0.0);
            (g(-2) + 2.0 * g(-1) + 3.0 * g(0) + 2.0 * g(1) + g(2)) / 9.0
        })
        .collect();
    let ac: Vec<f64> = (0..=2 * hi + 2)
        .map(|l| env.iter().zip(&env[l..]).map(|(a, b)| (*a as f64) * (*b as f64)).sum::<f64>() / (env.len() - l) as f64)
        .collect();
    // Count each lag together with its double, so the beat (not the half-beat) wins.
    let score = |l: usize| -> f64 {
        let bpm = fr * 60.0 / l as f32;
        let w = (-0.5 * ((bpm / 120.0).log2() / 0.9).powi(2)).exp() as f64;
        let d = ac[2 * l] * 0.5;
        w * (ac[l] + d)
    };
    let mut best = lo;
    for l in lo..=hi {
        if score(l) > score(best) {
            best = l;
        }
    }
    // Parabolic refinement on the raw autocorrelation.
    let (a, b, c) = (ac[best - 1], ac[best], ac[best + 1]);
    let den = a - 2.0 * b + c;
    let d = if den.abs() > 1e-12 { (0.5 * (a - c) / den).clamp(-0.5, 0.5) } else { 0.0 };
    let lag = best as f64 + d;
    let mean = ac[lo..=hi].iter().sum::<f64>() / (hi - lo + 1) as f64;
    let conf = if ac[0] > 0.0 { ((b - mean) / (ac[0] - mean)).clamp(0.0, 1.0) as f32 } else { 0.0 };
    ((fr as f64 * 60.0 / lag) as f32, conf)
}

/// Dynamic-programming beat tracker (after Ellis 2007, from the paper):
/// each beat is an onset plus the best earlier beat, penalised by how far the
/// gap strays from the period. Returns beat positions in frames.
pub fn beats(env: &[f32], period: f32, tightness: f32) -> Vec<f32> {
    let n = env.len();
    if n == 0 || period < 2.0 {
        return Vec::new();
    }
    let mut sd = env.iter().map(|x| (*x as f64).powi(2)).sum::<f64>() / n as f64;
    sd = sd.sqrt().max(1e-9);
    let e: Vec<f64> = env.iter().map(|x| *x as f64 / sd).collect();
    let mut score = vec![0.0f64; n];
    let mut back = vec![usize::MAX; n];
    let (pmin, pmax) = ((period * 0.5) as usize, (period * 2.0) as usize);
    for t in 0..n {
        let mut best = 0.0;
        let mut arg = usize::MAX;
        if t >= pmin {
            for tau in t.saturating_sub(pmax)..=t - pmin {
                let g = ((t - tau) as f64 / period as f64).ln();
                let s = score[tau] - tightness as f64 * g * g;
                if arg == usize::MAX || s > best {
                    best = s;
                    arg = tau;
                }
            }
        }
        score[t] = e[t] + if arg == usize::MAX { 0.0 } else { best };
        back[t] = arg;
    }
    // Finish at the best score within the last period.
    let tail = n.saturating_sub(period as usize + 1);
    let mut t = (tail..n).max_by(|a, b| score[*a].total_cmp(&score[*b])).unwrap_or(n - 1);
    let mut out = Vec::new();
    loop {
        out.push(t as f32);
        let b = back[t];
        if b == usize::MAX {
            break;
        }
        t = b;
    }
    out.reverse();
    // Refine each beat to the envelope's peak within +-2 frames, as a centroid.
    out.iter()
        .map(|&b| {
            let c = b as usize;
            let (a, z) = (c.saturating_sub(2), (c + 3).min(n));
            let w: f64 = e[a..z].iter().sum();
            if w > 0.0 {
                (a..z).map(|i| i as f64 * e[i]).sum::<f64>() as f32 / w as f32
            } else {
                b
            }
        })
        .collect()
}

/// Which beat of four is the downbeat: kicks on 1 (and 3), the backbeat on 2
/// and 4, and changes (a new bass note, a new chord) on 1. With a kick on every
/// beat and no backbeat, 1 and 3 only differ by the changes.
pub fn downbeat(low_at_beat: &[f32], mid_at_beat: &[f32], change_at_beat: &[f32]) -> usize {
    let mut best = (0usize, f32::MIN);
    for o in 0..4 {
        let mut s = 0.0;
        for (i, (&k, &m)) in low_at_beat.iter().zip(mid_at_beat).enumerate() {
            match (i + 4 - o) % 4 {
                0 => s += k - m + change_at_beat.get(i).copied().unwrap_or(0.0),
                2 => s += 0.5 * k - m,
                _ => s += m,
            }
        }
        if s > best.1 {
            best = (o, s);
        }
    }
    best.0
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A click every beat at 123 BPM, with weaker off-beats.
    fn clicks(bpm: f32, fr: f32, secs: f32) -> Vec<f32> {
        let n = (fr * secs) as usize;
        let p = fr * 60.0 / bpm;
        let mut v = vec![0.0f32; n];
        let mut k = 0.0f32;
        let mut i = 0;
        while (k as usize) < n {
            v[k as usize] = if i % 2 == 0 { 1.0 } else { 0.6 };
            k += p / 2.0;
            i += 1;
        }
        v
    }

    #[test]
    fn finds_the_tempo_not_its_double() {
        let fr = 44100.0 / 256.0;
        for bpm in [96.0f32, 118.0, 123.0, 140.0] {
            let (t, _) = tempo(&clicks(bpm, fr, 40.0), fr);
            assert!((t - bpm).abs() < 1.0, "{bpm}: got {t}");
        }
    }

    #[test]
    fn beats_land_on_the_clicks() {
        let fr = 44100.0 / 256.0;
        let env = clicks(120.0, fr, 30.0);
        let p = fr * 60.0 / 120.0;
        let b = beats(&env, p, 300.0);
        assert!(b.len() >= 55, "{} beats", b.len());
        for w in b.windows(2) {
            assert!(((w[1] - w[0]) - p).abs() < 2.0);
        }
    }

    #[test]
    fn backbeat_marks_the_downbeat() {
        // kick on every beat, snare on beats 2 and 4, starting on beat 3 of a bar
        let low = vec![1.0; 16];
        let mid: Vec<f32> = (0..16).map(|i| if (i + 2) % 4 == 1 || (i + 2) % 4 == 3 { 1.0 } else { 0.0 }).collect();
        let change: Vec<f32> = (0..16).map(|i| if (i + 2) % 4 == 0 { 1.0 } else { 0.0 }).collect();
        assert_eq!(downbeat(&low, &mid, &change), 2);
    }
}
