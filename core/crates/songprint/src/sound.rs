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
                let next = onsets.iter().copied().find(|&o| o > h.t + 0.08).unwrap_or(f32::MAX);
                let len = (next - h.t - 0.01).clamp(0.1, hit_length(kind));
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
    fn lowpass(rate: u32, hz: f32, q: f32, ch: usize) -> Self {
        let w = 2.0 * PI * hz / rate as f32;
        let (cw, sw) = (w.cos(), w.sin());
        let al = sw / (2.0 * q);
        let a0 = 1.0 + al;
        Biquad { b: [(1.0 - cw) / 2.0 / a0, (1.0 - cw) / a0, (1.0 - cw) / 2.0 / a0], a: [-2.0 * cw / a0, (1.0 - al) / a0], z: vec![[0.0; 2]; ch] }
    }
    /// A peaking bell, `db` at `hz` (negative to cut).
    fn peaking(rate: u32, hz: f32, q: f32, db: f32, ch: usize) -> Self {
        let a = 10f32.powf(db / 40.0);
        let w = 2.0 * PI * hz / rate as f32;
        let (cw, sw) = (w.cos(), w.sin());
        let al = sw / (2.0 * q);
        let a0 = 1.0 + al / a;
        Biquad { b: [(1.0 + al * a) / a0, -2.0 * cw / a0, (1.0 - al * a) / a0], a: [-2.0 * cw / a0, (1.0 - al / a) / a0], z: vec![[0.0; 2]; ch] }
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

/// Take the mud out of a bass note (RJ, 14 Nov 2026, on the song's own kit:
/// "The bass is really muddy"): a high-pass under its fundamental for the
/// rumble, and the low mids, where a bass stem's boom and the kick's bleed pile
/// up, cut by `cut_db` at `mud_hz`, a broad bell.
pub fn unmud(s: &Sound, fundamental_hz: f32, mud_hz: f32, cut_db: f32) -> Sound {
    let ch = s.channels.max(1);
    let mut hp = Biquad::highpass(s.rate, (fundamental_hz * 0.5).max(20.0), 0.707, ch);
    let mut bell = Biquad::peaking(s.rate, mud_hz, 0.8, cut_db, ch);
    let mut y = s.clone();
    for i in 0..y.frames() {
        for c in 0..ch {
            let v = y.x[i * ch + c];
            y.x[i * ch + c] = bell.run(hp.run(v, c), c);
        }
    }
    y
}

/// Where the next sound starts in a cut: once the sound has peaked (within its
/// first 80 ms) and begun to fall, the first place the level climbs back 6 dB
/// or more over the lowest it had fallen to, for 10 ms, while still within
/// 45 dB of the peak. Seconds from the start, at that lowest point, or None
/// when the sound only dies away. (RJ: "there's like some stuff after the
/// sounds": the next hit, or the next note, caught in the cut.)
pub fn next_attack(s: &Sound) -> Option<f32> {
    next_attack_over(s, 0.005, -45.0, 0.0)
}

/// `next_attack`, the level read over `frame` seconds (for a low note, two of
/// its cycles or more, so the wave's own rise and fall is not taken for one),
/// and the climb counted only when it comes back within `floor_db` of the
/// peak (for a held note, a few dB: a new note, not the sound's own wobble),
/// and only from `settle` seconds in (a note that swells after its pluck).
pub fn next_attack_over(s: &Sound, frame: f32, floor_db: f32, settle: f32) -> Option<f32> {
    let x = mono(s);
    let w = ((frame * s.rate as f32) as usize).max(1);
    let env: Vec<f32> = x.chunks(w).map(|c| (c.iter().map(|v| v * v).sum::<f32>() / c.len() as f32).sqrt()).collect();
    let head = ((0.08 / frame).ceil() as usize).max(2).min(env.len());
    let (pi, pk) = env[..head].iter().enumerate().fold((0, 0.0f32), |m, (i, v)| if *v > m.1 { (i, *v) } else { m });
    if pk <= 1e-9 {
        return None;
    }
    let floor = pk * 10f32.powf(floor_db / 20.0);
    let from = (pi + 1).max((settle * s.rate as f32) as usize / w);
    let (mut lo, mut lo_i) = (env.get(from).copied().unwrap_or(pk).min(pk), from);
    for i in from..env.len().saturating_sub(1) {
        if env[i] < lo {
            lo = env[i];
            lo_i = i;
        } else if env[i] > lo * 2.0 && env[i + 1] > lo * 2.0 && env[i] > floor {
            return Some((lo_i * w) as f32 / s.rate as f32);
        }
    }
    None
}

/// From `from` seconds on, only what is under `hz` (a 4-pole low-pass, faded
/// in over 8 ms): a kick's body kept while the hat or snare that came in over
/// its tail is taken out.
pub fn low_after(s: &Sound, from: f32, hz: f32) -> Sound {
    let ch = s.channels.max(1);
    let (mut a, mut b) = (Biquad::lowpass(s.rate, hz, 0.707, ch), Biquad::lowpass(s.rate, hz, 0.707, ch));
    let at = (from.max(0.0) * s.rate as f32) as usize;
    let fade = ((0.008 * s.rate as f32) as usize).max(1);
    let mut y = s.clone();
    for i in 0..y.frames() {
        let g = (i.saturating_sub(at) as f32 / fade as f32).min(1.0) * (i >= at) as u8 as f32;
        for c in 0..ch {
            let v = y.x[i * ch + c];
            let lp = b.run(a.run(v, c), c);
            y.x[i * ch + c] = v * (1.0 - g) + lp * g;
        }
    }
    y
}

/// Where a sound has died away: the first `frame`-long stretch after its peak
/// (within its first 80 ms) that is `db` or more under it. Seconds, or None.
pub fn dies_at(s: &Sound, frame: f32, db: f32) -> Option<f32> {
    let x = mono(s);
    let w = ((frame * s.rate as f32) as usize).max(1);
    let env: Vec<f32> = x.chunks(w).map(|c| (c.iter().map(|v| v * v).sum::<f32>() / c.len() as f32).sqrt()).collect();
    let head = ((0.08 / frame).ceil() as usize).max(2).min(env.len());
    let (pi, pk) = env[..head].iter().enumerate().fold((0, 0.0f32), |m, (i, v)| if *v > m.1 { (i, *v) } else { m });
    let floor = pk * 10f32.powf(db / 20.0);
    (pi + 1..env.len()).find(|&i| env[i] < floor).map(|i| (i * w) as f32 / s.rate as f32)
}

/// The first `secs` of a sound.
pub fn until(s: &Sound, secs: f32) -> Sound {
    let n = ((secs.max(0.0) * s.rate as f32) as usize).min(s.frames());
    Sound { rate: s.rate, channels: s.channels, x: s.x[..n * s.channels].to_vec() }
}

/// How steady a held note's pitch is: YIN over 90 ms windows from 30 ms in to
/// 85% of the way through. (its median pitch as MIDI, the spread in cents, the
/// share of windows that were pitched), or None when none were.
pub fn steadiness(s: &Sound) -> Option<(f32, f32, f32)> {
    let x = mono(s);
    let r = s.rate as f32;
    let (win, hop) = ((0.09 * r) as usize, (0.03 * r) as usize);
    let (a, z) = ((0.03 * r) as usize, (x.len() as f32 * 0.85) as usize);
    let mut got: Vec<f32> = Vec::new();
    let mut tried = 0;
    let mut i = a;
    while i + win <= z {
        tried += 1;
        if let Some((hz, ap)) = crate::pitch::yin(&x[i..i + win], r, 25.0, 400.0) {
            if ap < 0.35 {
                got.push(crate::pitch::midi(hz));
            }
        }
        i += hop;
    }
    if got.is_empty() {
        return None;
    }
    got.sort_by(f32::total_cmp);
    let med = got[got.len() / 2];
    let mut dev: Vec<f32> = got.iter().map(|m| (m - med).abs() * 100.0).collect();
    dev.sort_by(f32::total_cmp);
    Some((med, dev[dev.len() / 2] * 1.4826, got.len() as f32 / tried.max(1) as f32))
}

/// What a drum hit is like, for making a kit around it.
#[derive(Clone, Copy, Debug)]
pub struct Character {
    /// Its pitch, as a MIDI note with cents, if it has one.
    pub pitch: Option<f32>,
    /// Seconds from its peak to 30 dB down.
    pub decay: f32,
    /// Zero crossings a second: a rough brightness.
    pub zcr: f32,
}

fn mono(s: &Sound) -> Vec<f32> {
    let ch = s.channels.max(1);
    (0..s.frames()).map(|i| (0..ch).map(|c| s.x[i * ch + c]).sum::<f32>() / ch as f32).collect()
}

/// The pitch of a hit, read just after its attack (YIN, 30 Hz to 1 kHz).
pub fn pitch_of(s: &Sound) -> Option<f32> {
    let x = mono(s);
    let r = s.rate as f32;
    let peak = x.iter().enumerate().fold((0, 0.0f32), |m, (i, v)| if v.abs() > m.1 { (i, v.abs()) } else { m }).0;
    let a = peak + (0.02 * r) as usize;
    let z = (a + (0.18 * r) as usize).min(x.len());
    if z <= a {
        return None;
    }
    crate::pitch::yin(&x[a..z], r, 30.0, 1000.0).filter(|(_, ap)| *ap < 0.4).map(|(hz, _)| crate::pitch::midi(hz))
}

pub fn character(s: &Sound) -> Character {
    let x = mono(s);
    let r = s.rate as f32;
    let w = ((0.01 * r) as usize).max(1);
    let env: Vec<f32> = x.chunks(w).map(|c| (c.iter().map(|v| v * v).sum::<f32>() / c.len() as f32).sqrt()).collect();
    let (pi, pk) = env.iter().enumerate().fold((0, 0.0f32), |m, (i, v)| if *v > m.1 { (i, *v) } else { m });
    let floor = pk * 10f32.powf(-30.0 / 20.0);
    let end = (pi..env.len()).find(|&i| env[i] < floor).unwrap_or(env.len());
    let zc = x.windows(2).filter(|p| (p[0] <= 0.0) != (p[1] <= 0.0)).count() as f32;
    Character { pitch: pitch_of(s), decay: (end - pi) as f32 * w as f32 / r, zcr: zc / (x.len().max(1) as f32 / r) }
}

/// Shift the pitch by `semitones`, the tape way: faster and shorter going up.
pub fn shift(s: &Sound, semitones: f32) -> Sound {
    if semitones.abs() < 0.01 {
        return s.clone();
    }
    let f = 2f64.powf(semitones as f64 / 12.0);
    let mut y = resample(s, ((s.rate as f64) / f).round().max(1000.0) as u32);
    y.rate = s.rate;
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
    fn character_and_shift() {
        // a 55 Hz (A1) hit decaying over about a quarter second
        let rate = 44100;
        let n = (rate as f32 * 0.6) as usize;
        let s = Sound { rate, channels: 1, x: (0..n).map(|i| { let t = i as f32 / rate as f32; (2.0 * PI * 55.0 * t).sin() * (-t * 12.0).exp() }).collect() };
        let c = character(&s);
        assert!((c.pitch.unwrap() - 33.0).abs() < 0.3, "{:?}", c.pitch);
        assert!(c.decay > 0.25 && c.decay < 0.34, "{}", c.decay); // e^-12t is 30 dB down at ln(31.6)/12 = 0.29 s
        let up = shift(&s, 2.0);
        assert!((pitch_of(&up).unwrap() - 35.0).abs() < 0.3);
        assert!(up.frames() < s.frames());
    }

    #[test]
    fn unmud_cuts_the_low_mids_and_keeps_the_note() {
        let lo = unmud(&tone(44100, 55.0, 1.0), 55.0, 300.0, -5.0);
        let mid = unmud(&tone(44100, 300.0, 1.0), 55.0, 300.0, -5.0);
        let pk = |s: &Sound| s.x[20000..].iter().fold(0.0f32, |m, v| m.max(v.abs()));
        assert!((pk(&lo) - 0.5).abs() < 0.08, "the note itself: {}", pk(&lo));
        assert!((pk(&mid) - 0.5 * 10f32.powf(-5.0 / 20.0)).abs() < 0.02, "300 Hz: {}", pk(&mid));
        let rumble = unmud(&tone(44100, 15.0, 1.0), 55.0, 300.0, -5.0);
        assert!(pk(&rumble) < 0.2, "rumble under the note: {}", pk(&rumble));
    }

    #[test]
    fn next_attack_finds_the_next_hit() {
        // a hit dying away, and a second one at 0.3 s
        let rate = 44100;
        let hit = |t: f32| if t < 0.0 { 0.0 } else { (2.0 * PI * 80.0 * t).sin() * (-t * 20.0).exp() };
        let n = (rate as f32 * 0.6) as usize;
        let two = Sound { rate, channels: 1, x: (0..n).map(|i| { let t = i as f32 / rate as f32; hit(t) + 0.5 * hit(t - 0.3) }).collect() };
        let at = next_attack(&two).expect("the second hit");
        assert!(at > 0.27 && at <= 0.3, "{at}");
        let one = Sound { rate, channels: 1, x: (0..n).map(|i| hit(i as f32 / rate as f32)).collect() };
        assert_eq!(next_attack(&one), None);
        // held to its own level, the second hit (6 dB under the first) is not a new note
        assert_eq!(next_attack_over(&two, 0.025, -4.0, 0.0), None);
        assert_eq!(next_attack_over(&two, 0.005, -45.0, 0.35), None, "the second hit, in the settling time");
        assert!((until(&two, at).seconds() - at).abs() < 0.001);
        // e^-20t is 30 dB down at ln(31.6)/20 = 0.17 s
        let d = dies_at(&one, 0.01, -30.0).unwrap();
        assert!(d > 0.15 && d < 0.2, "{d}");
    }

    #[test]
    fn low_after_keeps_the_body_and_drops_the_highs() {
        let rate = 44100;
        let n = (rate as f32 * 0.4) as usize;
        let s = Sound { rate, channels: 1, x: (0..n).map(|i| { let t = i as f32 / rate as f32; 0.4 * (2.0 * PI * 60.0 * t).sin() + 0.4 * (2.0 * PI * 6000.0 * t).sin() }).collect() };
        let y = low_after(&s, 0.1, 160.0);
        let rms = |a: usize, z: usize, x: &[f32]| (x[a..z].iter().map(|v| v * v).sum::<f32>() / (z - a) as f32).sqrt();
        assert!((rms(0, 4000, &y.x) - rms(0, 4000, &s.x)).abs() < 1e-4, "before: untouched");
        let tail = rms(10000, 17000, &y.x);
        assert!((tail - 0.4 / 2f32.sqrt()).abs() < 0.04, "after: the 60 Hz alone, {tail}");
    }

    #[test]
    fn steadiness_of_a_held_note() {
        let (m, spread, voiced) = steadiness(&tone(44100, 55.0, 0.8)).unwrap();
        assert!((m - 33.0).abs() < 0.1 && spread < 5.0 && voiced > 0.9, "{m} {spread} {voiced}");
        // a slide from 55 to 82 Hz spreads
        let rate = 44100;
        let n = (rate as f32 * 0.8) as usize;
        let mut ph = 0.0f32;
        let slide = Sound { rate, channels: 1, x: (0..n).map(|i| { let f = 55.0 + 27.0 * i as f32 / n as f32; ph += 2.0 * PI * f / rate as f32; ph.sin() * 0.5 }).collect() };
        assert!(steadiness(&slide).unwrap().1 > 100.0);
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
