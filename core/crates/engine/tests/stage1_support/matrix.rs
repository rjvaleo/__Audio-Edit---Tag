//! Test-only signal measurements; no DSP dependencies or production changes.
use std::collections::BTreeSet;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::time::Instant;
pub const RATES: [u32; 3] = [44_100, 48_000, 96_000];
pub const BLOCKS: [usize; 6] = [16, 64, 480, 512, 1024, 4096];
pub struct Deviation {
    pub name: &'static str,
    pub rate: u32,
    pub block: usize,
    pub metric: &'static str,
    pub measured: f64,
    pub why: &'static str,
}
pub fn sine(rate: u32) -> Vec<f32> {
    (0..rate as usize / 2)
        .map(|i| (std::f64::consts::TAU * 440.0 * i as f64 / rate as f64).sin() as f32 * 0.2)
        .collect()
}
fn measure(out: &[f32], rate: u32) -> (f64, f64) {
    let steady = &out[out.len() / 2..];
    let rms =
        (steady.iter().map(|&x| (x as f64).powi(2)).sum::<f64>() / steady.len() as f64).sqrt();
    if rms < 1e-15 {
        return (0.0, rms);
    }
    let n = steady.len().next_power_of_two();
    let mut re = vec![0.0; n];
    let mut im = vec![0.0; n];
    for (i, &x) in steady.iter().enumerate() {
        re[i] = x as f64
            * (0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / (steady.len() - 1) as f64).cos());
    }
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut width = 2;
    while width <= n {
        let angle = -std::f64::consts::TAU / width as f64;
        let (wi, wr) = angle.sin_cos();
        for start in (0..n).step_by(width) {
            let (mut ar, mut ai) = (1.0, 0.0);
            for offset in 0..width / 2 {
                let a = start + offset;
                let b = a + width / 2;
                let (br, bi) = (re[b] * ar - im[b] * ai, re[b] * ai + im[b] * ar);
                let (ur, ui) = (re[a], im[a]);
                re[a] = ur + br;
                im[a] = ui + bi;
                re[b] = ur - br;
                im[b] = ui - bi;
                (ar, ai) = (ar * wr - ai * wi, ar * wi + ai * wr);
            }
        }
        width *= 2;
    }
    let power: Vec<_> = re.iter().zip(&im).map(|(a, b)| a * a + b * b).collect();
    let peak = (1..n / 2 - 1)
        .max_by(|&a, &b| power[a].total_cmp(&power[b]))
        .unwrap();
    let (a, b, c) = (
        power[peak - 1].max(1e-300).ln(),
        power[peak].max(1e-300).ln(),
        power[peak + 1].max(1e-300).ln(),
    );
    let den = a - 2.0 * b + c;
    let offset = if den.abs() > 1e-20 {
        (0.5 * (a - c) / den).clamp(-0.5, 0.5)
    } else {
        0.0
    };
    ((peak as f64 + offset) * rate as f64 / n as f64, rms)
}
pub fn run(
    names: &[&str],
    allow: &[Deviation],
    mut render: impl FnMut(&str, u32, usize) -> Vec<f32>,
) {
    measurement_finds_a_sine_and_its_rms();
    let started = Instant::now();
    let mut used = BTreeSet::new();
    let mut errors = Vec::new();
    for &name in names {
        let reference = render(name, 48_000, 512);
        assert_eq!(reference.len(), 24_000, "{name}: reference length");
        assert!(
            reference.iter().all(|x| x.is_finite()),
            "{name}: reference finite"
        );
        let (base_pitch, base_level) = measure(&reference, 48_000);
        println!("REFERENCE|{name}|{base_pitch:.6}|{base_level:.9}");
        for rate in RATES {
            for block in BLOCKS {
                let output = catch_unwind(AssertUnwindSafe(|| render(name, rate, block)))
                    .unwrap_or_else(|_| {
                        panic!("{name} rate={rate} block={block}: render panicked")
                    });
                assert_eq!(
                    output.len(),
                    rate as usize / 2,
                    "{name} rate={rate} block={block}: length"
                );
                assert!(
                    output.iter().all(|x| x.is_finite()),
                    "{name} rate={rate} block={block}: non-finite"
                );
                let (pitch, level) = measure(&output, rate);
                let cents = if pitch == 0.0 && base_pitch == 0.0 {
                    0.0
                } else {
                    1200.0 * (pitch.max(1e-30) / base_pitch.max(1e-30)).log2()
                };
                let db = 20.0 * (level.max(1e-30) / base_level.max(1e-30)).log10();
                for (metric, value, limit, tolerance) in
                    [("cents", cents, 2.0, 0.05), ("dB", db, 0.5, 0.005)]
                {
                    let listed = allow.iter().enumerate().find(|(_, a)| {
                        a.name == name && a.rate == rate && a.block == block && a.metric == metric
                    });
                    if value.abs() > limit {
                        println!("DEVIATION|{name}|{rate}|{block}|{metric}|{value:.6}");
                        println!("MEASUREMENT|{name}|{rate}|{block}|{pitch:.6}|{level:.9}");
                        match listed {
                            Some((i, a)) if (a.measured - value).abs() <= tolerance => {
                                assert!(!a.why.is_empty());
                                used.insert(i);
                            }
                            Some((_, a)) => errors.push(format!(
                                "{name}/{rate}/{block}/{metric}: {value:.6}, listed {:.6}",
                                a.measured
                            )),
                            None => errors.push(format!(
                                "unlisted {name}/{rate}/{block}/{metric}: {value:.6}"
                            )),
                        }
                    } else if listed.is_some() {
                        errors.push(format!(
                            "resolved deviation {name}/{rate}/{block}/{metric}: {value:.6}"
                        ));
                    }
                }
            }
        }
    }
    for (i, a) in allow.iter().enumerate() {
        if !used.contains(&i) {
            errors.push(format!(
                "unused allowance {}/{}/{}/{}",
                a.name, a.rate, a.block, a.metric
            ));
        }
    }
    println!("MATRIX_SECONDS {:.3}", started.elapsed().as_secs_f64());
    assert!(
        errors.is_empty(),
        "{} matrix deviations:\n{}",
        errors.len(),
        errors.join("\n")
    );
}
fn measurement_finds_a_sine_and_its_rms() {
    for rate in RATES {
        let (hz, rms) = measure(&sine(rate), rate);
        assert!((1200.0 * (hz / 440.0).log2()).abs() < 2.0, "{rate}: {hz}");
        assert!((20.0 * (rms / (0.2 / 2f64.sqrt())).log10()).abs() < 0.02);
    }
}
