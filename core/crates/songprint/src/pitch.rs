//! Pitch: one bass note at a time (YIN, from the paper), keys and chords from chroma.

pub const NAMES: [&str; 12] = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

/// YIN fundamental (de Cheveigné and Kawahara 2002). Returns (Hz, aperiodicity)
/// or None when nothing periodic is found between `fmin` and `fmax`.
pub fn yin(x: &[f32], rate: f32, fmin: f32, fmax: f32) -> Option<(f32, f32)> {
    let tmax = (rate / fmin) as usize;
    let tmin = ((rate / fmax) as usize).max(2);
    if x.len() < 2 * tmax + 2 {
        return None;
    }
    let w = x.len() - tmax - 1;
    let mut d = vec![0.0f64; tmax + 2];
    for (tau, dv) in d.iter_mut().enumerate().skip(1) {
        let mut s = 0.0f64;
        for j in 0..w {
            let e = (x[j] - x[j + tau]) as f64;
            s += e * e;
        }
        *dv = s;
    }
    // Cumulative mean normalised difference.
    let mut cm = vec![1.0f64; tmax + 2];
    let mut run = 0.0;
    for tau in 1..=tmax + 1 {
        run += d[tau];
        cm[tau] = if run > 0.0 { d[tau] * tau as f64 / run } else { 1.0 };
    }
    let mut pick = None;
    for tau in tmin..=tmax {
        if cm[tau] < 0.15 {
            let mut t = tau;
            while t < tmax && cm[t + 1] < cm[t] {
                t += 1;
            }
            pick = Some(t);
            break;
        }
    }
    let t = match pick {
        Some(t) => t,
        None => {
            let t = (tmin..=tmax).min_by(|a, b| cm[*a].total_cmp(&cm[*b]))?;
            if cm[t] > 0.35 {
                return None;
            }
            t
        }
    };
    let (a, b, c) = (cm[t - 1], cm[t], cm[t + 1]);
    let den = a - 2.0 * b + c;
    let off = if den.abs() > 1e-12 { (0.5 * (a - c) / den).clamp(-0.5, 0.5) } else { 0.0 };
    Some((rate / (t as f64 + off) as f32, b as f32))
}

pub fn midi(hz: f32) -> f32 {
    69.0 + 12.0 * (hz / 440.0).log2()
}

/// Krumhansl-Kessler key profiles (published probe-tone ratings).
const MAJOR: [f32; 12] = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR: [f32; 12] = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

fn corr(a: &[f32; 12], b: &[f32; 12], shift: usize) -> f32 {
    let ma = a.iter().sum::<f32>() / 12.0;
    let mb = b.iter().sum::<f32>() / 12.0;
    let (mut s, mut va, mut vb) = (0.0, 0.0, 0.0);
    for i in 0..12 {
        let x = a[(i + shift) % 12] - ma;
        let y = b[i] - mb;
        s += x * y;
        va += x * x;
        vb += y * y;
    }
    if va * vb > 0.0 { s / (va * vb).sqrt() } else { 0.0 }
}

/// (tonic pitch class, minor?, correlation)
pub fn key(chroma: &[f32; 12]) -> (usize, bool, f32) {
    let mut best = (0, false, f32::MIN);
    for t in 0..12 {
        for (minor, prof) in [(false, &MAJOR), (true, &MINOR)] {
            let r = corr(chroma, prof, t);
            if r > best.2 {
                best = (t, minor, r);
            }
        }
    }
    best
}

pub fn key_name(t: usize, minor: bool) -> String {
    format!("{} {}", NAMES[t], if minor { "minor" } else { "major" })
}

/// Chord shapes, as pitch classes above the root.
const CHORDS: [(&str, &[usize]); 8] = [
    ("", &[0, 4, 7]),
    ("m", &[0, 3, 7]),
    ("5", &[0, 7]),
    ("sus4", &[0, 5, 7]),
    ("sus2", &[0, 2, 7]),
    ("m7", &[0, 3, 7, 10]),
    ("7", &[0, 4, 7, 10]),
    ("maj7", &[0, 4, 7, 11]),
];

/// Best chord for a bar's chroma: (name, cosine similarity), or None if quiet.
pub fn chord(chroma: &[f32; 12]) -> Option<(String, f32)> {
    let norm = chroma.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm < 1e-9 {
        return None;
    }
    let mut best = (String::new(), f32::MIN);
    for root in 0..12 {
        for (name, shape) in CHORDS {
            let mut t = [0.0f32; 12];
            for &s in shape {
                t[(root + s) % 12] = 1.0;
            }
            // The plain triad is preferred over its sevenths and fifths on a tie.
            let bias = if name.is_empty() || name == "m" { 0.02 } else { 0.0 };
            let tn = (shape.len() as f32).sqrt();
            let cos = (0..12).map(|i| chroma[i] * t[i]).sum::<f32>() / (norm * tn) + bias;
            if cos > best.1 {
                best = (format!("{}{}", NAMES[root], name), cos);
            }
        }
    }
    Some(best)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(hz: f32, rate: f32, n: usize) -> Vec<f32> {
        (0..n).map(|i| (2.0 * std::f32::consts::PI * hz * i as f32 / rate).sin() * 0.5).collect()
    }

    #[test]
    fn yin_hears_a_dub_bass() {
        let rate = 44100.0 / 8.0;
        for hz in [41.2f32, 55.0, 87.3, 130.8] {
            let (f, _) = yin(&sine(hz, rate, 1024), rate, 30.0, 400.0).unwrap();
            assert!((midi(f) - midi(hz)).abs() < 0.1, "{hz}: {f}");
        }
    }

    #[test]
    fn keys_and_chords() {
        // F minor scale, tonic and fifth weighted
        let mut c = [0.0f32; 12];
        for (pc, w) in [(5, 3.0), (7, 1.0), (8, 2.0), (10, 1.0), (0, 2.5), (1, 1.0), (3, 1.0)] {
            c[pc] = w;
        }
        let (t, minor, _) = key(&c);
        assert_eq!(key_name(t, minor), "F minor");
        let mut ch = [0.0f32; 12];
        ch[5] = 1.0;
        ch[8] = 0.8;
        ch[0] = 0.9;
        assert_eq!(chord(&ch).unwrap().0, "Fm");
        ch[3] = 0.8;
        assert_eq!(chord(&ch).unwrap().0, "Fm7");
    }
}
