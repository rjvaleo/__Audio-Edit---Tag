//! Making sounds from stems: cutting hits and notes out, cleaning them, and
//! upsampling with an exciter. All of it plain DSP from textbook descriptions
//! (RBJ biquads, windowed-sinc interpolation, a tanh exciter).

use crate::features::{self, FINE_HOP, FINE_N};
use std::f32::consts::PI;
use std::io::Write;
use std::path::Path;

/// A sound in memory: interleaved samples.
#[derive(Clone)]
pub struct Sound {
    pub rate: u32,
    pub channels: usize,
    pub x: Vec<f32>,
}

impl Sound {
    pub fn frames(&self) -> usize {
        self.x.len() / self.channels.max(1)
    }
    pub fn peak(&self) -> f32 {
        self.x.iter().fold(0.0f32, |m, v| m.max(v.abs()))
    }
    pub fn seconds(&self) -> f32 {
        self.frames() as f32 / self.rate as f32
    }
}

/// Read `[t0, t1)` seconds of a file.
pub fn read_span(path: &Path, t0: f32, t1: f32) -> Result<Sound, String> {
    let mut rd = audio_core::open(path).map_err(|e| format!("{}: {e:?}", path.display()))?;
    let info = *rd.info();
    let rate = info.sample_rate;
    let a = (t0.max(0.0) * rate as f32) as u64;
    let n = ((t1 - t0).max(0.0) * rate as f32) as u64;
    let x = rd.read_frames(a, n).map_err(|e| e.to_string())?;
    Ok(Sound { rate, channels: info.channels.max(1) as usize, x })
}

/// Write 24-bit PCM WAV.
pub fn write_wav(path: &Path, s: &Sound) -> std::io::Result<()> {
    let n = s.x.len();
    let mut bytes = Vec::with_capacity(44 + n * 3);
    bytes.extend_from_slice(&audio_core::wav::header((n * 3) as u64, s.channels as u16, s.rate, audio_core::Codec::PcmI24));
    for v in &s.x {
        let i = (v.clamp(-1.0, 1.0) * 8_388_607.0).round() as i32;
        bytes.extend_from_slice(&i.to_le_bytes()[..3]);
    }
    let tmp = path.with_extension("wav.part");
    std::fs::File::create(&tmp)?.write_all(&bytes)?;
    std::fs::rename(tmp, path)
}

// ------------------------------------------------------------------ hits

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Kick,
    Snare,
    Hat,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Kind::Kick => "kick",
            Kind::Snare => "snare",
            Kind::Hat => "hat",
        }
    }
}

pub struct Hit {
    pub kind: Kind,
    pub t: f32,
    /// How clearly this onset is its kind: its band against the other two.
    pub purity: f32,
    pub strength: f32,
    /// Seconds to cut: to just before the next hit of any kind, at most
    /// `hit_length(kind)`, so a one-shot is one shot.
    pub len: f32,
}

/// Find the clearest single hits of each kind in a drums stem: onsets where one
/// band (low, mid, high) jumps well above the others, at least `gap` seconds
/// apart, best first.
pub fn find_hits(drums: &Path, per_kind: usize, gap: f32) -> Result<Vec<Hit>, String> {
    let f = features::read(drums, false, false)?;
    let rate = f.rate as f32;
    let t_of = |i: usize| (i * FINE_HOP + FINE_N / 2) as f32 / rate;
    let mut scale = [1.0f32; 3];
    let bands: Vec<[f32; 3]> = f.fine.iter().map(|x| [x.low, x.mid, x.high]).collect();
    for b in 0..3 {
        let mut v: Vec<f32> = bands.iter().map(|x| x[b]).collect();
        scale[b] = crate::rhythm::percentile(&mut v, 0.98).max(1e-6);
    }
    let mut cands: Vec<Hit> = Vec::new();
    let mut onsets: Vec<f32> = Vec::new();
    for i in 2..bands.len().saturating_sub(2) {
        let n = |j: usize| [bands[j][0] / scale[0], bands[j][1] / scale[1], bands[j][2] / scale[2]];
        let c = n(i);
        if (0..3).any(|b| c[b] >= 0.35 && (i - 1..=i + 1).all(|j| j == i || n(j)[b] <= c[b])) {
            onsets.push(t_of(i));
        }
        for (b, kind) in [(0, Kind::Kick), (1, Kind::Snare), (2, Kind::Hat)] {
            // a local peak in its band
            if c[b] < 0.5 || (i - 2..=i + 2).any(|j| j != i && n(j)[b] > c[b]) {
                continue;
            }
            let others = (0..3).filter(|&o| o != b).map(|o| c[o]).fold(0.0f32, f32::max);
            let purity = c[b] / (others + 0.15);
            cands.push(Hit { kind, t: t_of(i), purity, strength: c[b], len: 0.0 });
        }
    }
    let mut out = Vec::new();
    for kind in [Kind::Kick, Kind::Snare, Kind::Hat] {
        let mut k: Vec<&Hit> = cands.iter().filter(|h| h.kind == kind).collect();
        k.sort_by(|a, b| (b.purity * b.strength.min(1.5)).total_cmp(&(a.purity * a.strength.min(1.5))));
        let mut took: Vec<f32> = Vec::new();
        for h in k {
            if took.iter().all(|t| (t - h.t).abs() >= gap) {
                took.push(h.t);
                let next = onsets.iter().copied().find(|&o| o > h.t + 0.04).unwrap_or(f32::MAX);
                let len = (next - h.t - 0.01).clamp(0.06, hit_length(kind));
                out.push(Hit { kind, t: h.t, purity: h.purity, strength: h.strength, len });
                if took.len() >= per_kind {
                    break;
                }
            }
        }
    }
    Ok(out)
}

/// How long a hit of each kind is cut.
pub fn hit_length(kind: Kind) -> f32 {
    match kind {
        Kind::Kick => 0.7,
        Kind::Snare => 0.5,
        Kind::Hat => 0.3,
    }
}

/// Cut a one-shot: a few milliseconds before the onset, to `len` seconds.
pub fn cut(path: &Path, t: f32, len: f32) -> Result<Sound, String> {
    let pre = 0.006;
    read_span(path, t - pre - 0.012, t - pre - 0.012 + len)
}

// ------------------------------------------------------------------ clean

pub struct Clean {
    /// Trim the tail where it falls below this, dB from the peak.
    pub trim_db: f32,
    /// Fade-in at the start and fade-out at the end, milliseconds.
    pub fade_in_ms: f32,
    pub fade_out_ms: f32,
    /// Normalise to this peak, dBFS. None leaves the level.
    pub peak_db: Option<f32>,
}

impl Default for Clean {
    fn default() -> Self {
        Clean { trim_db: -60.0, fade_in_ms: 2.0, fade_out_ms: 20.0, peak_db: Some(-1.0) }
    }
}

pub fn clean(s: &Sound, c: &Clean) -> Sound {
    let ch = s.channels;
    let n = s.frames();
    let x = s.x.clone();
    // Lead-in: start a little before the first sample within 40 dB of the peak.
    let pk = x.iter().fold(0.0f32, |m, v| m.max(v.abs())).max(1e-9);
    let frame_peak = |i: usize, x: &[f32]| (0..ch).map(|k| x[i * ch + k].abs()).fold(0.0, f32::max);
    let first = (0..n).find(|&i| frame_peak(i, &x) > pk * 0.01).unwrap_or(0);
    let start = first.saturating_sub((0.003 * s.rate as f32) as usize);
    let floor = pk * 10f32.powf(c.trim_db / 20.0);
    let last = (0..n).rev().find(|&i| frame_peak(i, &x) > floor).unwrap_or(n.saturating_sub(1));
    let end = (last + 1).max(start + 1).min(n);
    let mut y: Vec<f32> = x[start * ch..end * ch].to_vec();
    let m = end - start;
    // DC: take each channel's mean over what is kept away.
    for k in 0..ch {
        let mean = (0..m).map(|i| y[i * ch + k] as f64).sum::<f64>() / m.max(1) as f64;
        for i in 0..m {
            y[i * ch + k] -= mean as f32;
        }
    }
    let fi = ((c.fade_in_ms / 1000.0 * s.rate as f32) as usize).min(m / 2);
    let fo = ((c.fade_out_ms / 1000.0 * s.rate as f32) as usize).min(m / 2);
    for i in 0..fi {
        let g = (i as f32 / fi as f32).powi(2);
        for k in 0..ch {
            y[i * ch + k] *= g;
        }
    }
    for i in 0..fo {
        let g = (i as f32 / fo as f32).powi(2);
        for k in 0..ch {
            y[(m - 1 - i) * ch + k] *= g;
        }
    }
    if let Some(db) = c.peak_db {
        let p = y.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        if p > 1e-9 {
            let g = 10f32.powf(db / 20.0) / p;
            y.iter_mut().for_each(|v| *v *= g);
        }
    }
    Sound { rate: s.rate, channels: ch, x: y }
}

// ------------------------------------------------------------------ upsample

/// Band-limited resampling by windowed-sinc interpolation (Blackman window,
/// 32 zero crossings each side), cut off at the lower Nyquist.
pub fn resample(s: &Sound, to: u32) -> Sound {
    if to == s.rate {
        return s.clone();
    }
    let ch = s.channels;
    let n = s.frames();
    let ratio = to as f64 / s.rate as f64;
    let m = ((n as f64) * ratio).round() as usize;
    let fc = (1.0f64).min(ratio) * 0.97; // cutoff as a fraction of the source Nyquist
    let half = 32.0 / fc;
    let mut y = vec![0.0f32; m * ch];
    for j in 0..m {
        let t = j as f64 / ratio;
        let a = (t - half).ceil().max(0.0) as usize;
        let z = ((t + half).floor() as usize).min(n.saturating_sub(1));
        for i in a..=z {
            let d = i as f64 - t;
            let sinc = if d.abs() < 1e-9 { 1.0 } else { (std::f64::consts::PI * fc * d).sin() / (std::f64::consts::PI * fc * d) };
            let w = 0.42 + 0.5 * (std::f64::consts::PI * d / half).cos() + 0.08 * (2.0 * std::f64::consts::PI * d / half).cos();
            let k = fc * sinc * w;
            for c in 0..ch {
                y[j * ch + c] += (s.x[i * ch + c] as f64 * k) as f32;
            }
        }
    }
    Sound { rate: to, channels: ch, x: y }
}

/// An RBJ biquad, one per channel.
struct Biquad {
    b: [f32; 3],
    a: [f32; 2],
    z: Vec<[f32; 2]>,
}

impl Biquad {
    fn highpass(rate: u32, hz: f32, q: f32, ch: usize) -> Self {
        let w = 2.0 * PI * hz / rate as f32;
        let (cw, sw) = (w.cos(), w.sin());
        let al = sw / (2.0 * q);
        let a0 = 1.0 + al;
        Biquad { b: [(1.0 + cw) / 2.0 / a0, -(1.0 + cw) / a0, (1.0 + cw) / 2.0 / a0], a: [-2.0 * cw / a0, (1.0 - al) / a0], z: vec![[0.0; 2]; ch] }
    }
    fn run(&mut self, x: f32, c: usize) -> f32 {
        let z = &mut self.z[c];
        let y = self.b[0] * x + z[0];
        z[0] = self.b[1] * x - self.a[0] * y + z[1];
        z[1] = self.b[2] * x - self.a[1] * y;
        y
    }
}

/// Upsample to `to` Hz and add air: the top of the sound is driven through a
/// soft clipper, and only the new harmonics above `above` Hz are mixed back,
/// `air` (0..1) of them. Nothing above the source's own content is real detail;
/// it is brightness that sounds right.
pub fn upsample(s: &Sound, to: u32, air: f32, above: f32) -> Sound {
    let mut y = resample(s, to);
    if air <= 0.0 {
        return y;
    }
    let ch = y.channels;
    let mut hp_in = Biquad::highpass(to, (above * 0.5).max(1000.0), 0.707, ch);
    let mut hp_out = Biquad::highpass(to, above, 0.707, ch);
    let mut hp_out2 = Biquad::highpass(to, above, 0.707, ch);
    let pk = y.peak().max(1e-6);
    let drive = 4.0 / pk;
    for i in 0..y.frames() {
        for c in 0..ch {
            let v = y.x[i * ch + c];
            let band = hp_in.run(v, c);
            let h = (band * drive).tanh() / drive - band; // the harmonics alone
            let h = hp_out2.run(hp_out.run(h, c), c);
            y.x[i * ch + c] = v + air * 3.0 * h;
        }
    }
    y
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(rate: u32, hz: f32, secs: f32) -> Sound {
        let n = (rate as f32 * secs) as usize;
        Sound { rate, channels: 1, x: (0..n).map(|i| (2.0 * PI * hz * i as f32 / rate as f32).sin() * 0.5).collect() }
    }

    #[test]
    fn resampling_keeps_the_pitch_and_level() {
        let s = tone(44100, 1000.0, 0.2);
        let y = resample(&s, 96000);
        assert_eq!(y.frames(), (s.frames() as f64 * 96000.0 / 44100.0).round() as usize);
        // zero crossings per second, away from the edges
        let mid = &y.x[2000..y.frames() - 2000];
        let zc = mid.windows(2).filter(|w| w[0] <= 0.0 && w[1] > 0.0).count() as f32 / (mid.len() as f32 / 96000.0);
        assert!((zc - 1000.0).abs() < 10.0, "{zc}");
        let pk = mid.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        assert!((pk - 0.5).abs() < 0.02, "{pk}");
    }

    #[test]
    fn clean_trims_fades_and_normalises() {
        let mut s = tone(44100, 200.0, 0.5);
        for v in s.x.iter_mut().skip(10000) {
            *v *= 0.0;
        }
        let c = clean(&s, &Clean::default());
        assert!(c.frames() < 11000, "{}", c.frames());
        assert!((c.peak() - 10f32.powf(-1.0 / 20.0)).abs() < 1e-3);
        assert!(c.x[0].abs() < 1e-3 && c.x[c.x.len() - 1].abs() < 1e-3);
    }

    #[test]
    fn air_adds_only_highs() {
        let s = tone(44100, 3000.0, 0.3);
        let plain = upsample(&s, 96000, 0.0, 11000.0);
        let aired = upsample(&s, 96000, 0.8, 11000.0);
        let diff: f32 = plain.x.iter().zip(&aired.x).map(|(a, b)| (a - b).abs()).sum();
        assert!(diff > 1.0, "the exciter did nothing");
        // the 3 kHz body is unchanged: correlation stays near 1
        let dot: f32 = plain.x.iter().zip(&aired.x).map(|(a, b)| a * b).sum();
        let na: f32 = plain.x.iter().map(|a| a * a).sum();
        let nb: f32 = aired.x.iter().map(|b| b * b).sum();
        assert!(dot / (na * nb).sqrt() > 0.98);
    }
}
