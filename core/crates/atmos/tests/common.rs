//! Shared by the tests: render a note, read its pitch and level.
#![allow(dead_code)]
use atmos::{models::MODELS, Synth};

pub const SR: f32 = 48_000.0;

/// One note of model `m` on oscillator A alone, held `hold` s, rendered `secs` s.
pub fn note(m: usize, hz: f32, hold: f32, secs: f32, set: &[(&str, f32)]) -> Vec<f32> {
    let mut s = Synth::new(SR);
    s.set("a.model", m as f32);
    for (k, d) in MODELS[m].3.iter().enumerate() {
        s.set(&format!("a.p{k}"), *d);
    }
    s.set("blend", 0.0);
    s.set("drift", 0.0);
    s.set("width", 0.0);
    s.set("atk", 0.002);
    s.set("sus", 1.0);
    s.set("rel", 0.05);
    for (k, v) in set {
        s.set(k, *v);
    }
    s.note_on(1, hz, 0.9, 0);
    let n = (secs * SR) as usize;
    let (mut l, mut r) = (vec![0.0; n], vec![0.0; n]);
    let hold_n = (hold * SR) as usize;
    let mut out = Vec::with_capacity(n);
    let mut i = 0;
    while i < n {
        let b = 128.min(n - i);
        if i <= hold_n && hold_n < i + b {
            s.note_off(1, (hold_n - i) as u32);
        }
        s.render(&mut l[..b], &mut r[..b]);
        for k in 0..b {
            out.push((l[k] + r[k]) * 0.5);
        }
        i += b;
    }
    out
}

pub fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| v * v).sum::<f32>() / x.len().max(1) as f32).sqrt()
}

/// The pitch near `hz`: the autocorrelation's peak within ±8 % of the period,
/// interpolated; in cents from `hz`.
pub fn cents_off(x: &[f32], hz: f32) -> f32 {
    let p = SR / hz;
    let lo = (p * 0.92) as usize;
    let hi = (p * 1.08) as usize + 2;
    let w = (SR * 0.25) as usize;
    let x = &x[..w.min(x.len() - hi)];
    let ac = |lag: usize| -> f32 { (0..x.len()).map(|i| x[i] * x.get(i + lag).copied().unwrap_or(0.0)).sum() };
    let mut best = lo;
    let mut bv = f32::MIN;
    let vals: Vec<f32> = (lo..=hi).map(ac).collect();
    for (k, v) in vals.iter().enumerate() {
        if *v > bv {
            bv = *v;
            best = lo + k;
        }
    }
    let k = best - lo;
    let (a, b, c) = (vals[k.saturating_sub(1)], vals[k], vals[(k + 1).min(vals.len() - 1)]);
    let d = if a - 2.0 * b + c != 0.0 { 0.5 * (a - c) / (a - 2.0 * b + c) } else { 0.0 };
    let lag = best as f32 + d;
    1200.0 * (p / lag).log2()
}

/// Energy at `f` Hz (Goertzel).
pub fn energy_at(x: &[f32], f: f32) -> f32 {
    let w = 2.0 * std::f32::consts::PI * f / SR;
    let c = 2.0 * w.cos();
    let (mut s1, mut s2) = (0.0f32, 0.0f32);
    for &v in x {
        let s0 = v + c * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    (s1 * s1 + s2 * s2 - c * s1 * s2).sqrt() / x.len() as f32
}

/// The pitch near `hz` from the spectrum: the strongest frequency within ±60
/// cents (Goertzel on a fine grid, interpolated), in cents from `hz`.
pub fn peak_cents(x: &[f32], hz: f32) -> f32 {
    let steps: Vec<f32> = (-240..=240).map(|k| k as f32 * 0.25).collect();
    let e: Vec<f32> = steps.iter().map(|c| energy_at(x, hz * 2f32.powf(c / 1200.0))).collect();
    let k = (0..e.len()).max_by(|&a, &b| e[a].partial_cmp(&e[b]).unwrap()).unwrap();
    if k == 0 || k == e.len() - 1 {
        return steps[k];
    }
    let (a, b, c) = (e[k - 1], e[k], e[k + 1]);
    let d = if a - 2.0 * b + c != 0.0 { 0.5 * (a - c) / (a - 2.0 * b + c) } else { 0.0 };
    steps[k] + d * 0.25
}
