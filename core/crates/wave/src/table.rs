//! Wavetables: frames of one cycle each, stored at 2048 samples, with
//! band-limited mip levels.
//!
//! **Everything here runs off the audio thread.** Building a table allocates
//! and does a few thousand FFTs; the synth only ever reads a finished table
//! through an `Arc`, and the caller drops a replaced one on its own thread.
//!
//! # Import: resampled in the spectrum
//!
//! A frame of any length is transformed, its harmonics are copied into a
//! 2048-point spectrum, and the result is transformed back. That is exact for
//! every harmonic both sizes can hold, which time-domain interpolation is not:
//! linear interpolation from 256 points dulls the top octave and adds images,
//! and the error is audible on a bright frame. Power-of-two lengths go straight
//! through audio-core's FFT; any other length goes through Bluestein's
//! algorithm on the same FFT, so a 600-sample frame is as exact as a 512 one.
//!
//! DC is dropped on the way (bin 0 is simply not copied), and so is the source's
//! Nyquist bin, whose phase is ambiguous. Each frame is then normalised to a
//! peak of 1, as the mock-up's `norm()` does to every frame it builds. A silent
//! frame stays silent.
//!
//! # Mip levels: by harmonic count
//!
//! Level 0 keeps everything a 2048-point frame can hold (1023 harmonics).
//! Level *L* above it keeps `1024 >> L` harmonics: 512, 256, … down to 1 at
//! level 10, which is a pure sine. Eleven levels, each the full 2048 samples
//! wide. Keeping every level full width costs memory (11 × 8 KB a frame, 23 MB
//! for the largest table) but it means a level with few harmonics is read
//! with almost no interpolation error, which is where the aliasing test's last
//! decibels come from. The oscillator picks the level whose top harmonic stays
//! under Nyquist at the note's real slope (see `osc.rs`).
//!
//! Each level is made by zeroing bins in the spectrum and inverting, so a level
//! has *no* energy above its limit, only the f32 rounding of the transform.

use audio_core::fft::fft;

/// Samples in one stored frame.
pub const FRAME_LEN: usize = 2048;
/// For wrapping an index into a frame.
pub const FRAME_MASK: usize = FRAME_LEN - 1;
/// Mip levels per table.
pub const MIP_LEVELS: usize = 11;
/// The most frames a table holds. Extra frames on import are dropped.
pub const MAX_FRAMES: usize = 256;

/// The highest harmonic kept at a mip level.
pub fn harmonic_limit(level: usize) -> usize {
    if level == 0 {
        FRAME_LEN / 2 - 1
    } else {
        ((FRAME_LEN / 2) >> level.min(MIP_LEVELS - 1)).max(1)
    }
}

/// A finished, band-limited wavetable. Immutable once built.
pub struct Wavetable {
    frames: usize,
    /// `levels[L]` holds every frame at level `L`, frame after frame.
    levels: Vec<Box<[f32]>>,
    /// The steepest slope of any frame at each level, in units per cycle. FM
    /// uses it to know how far the modulator can bend the carrier's phase.
    slope: [f32; MIP_LEVELS],
}

impl std::fmt::Debug for Wavetable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Wavetable").field("frames", &self.frames).finish()
    }
}

impl Wavetable {
    /// Build a table from frames of any length (64 to 4096 is the contract;
    /// anything from 4 up is handled the same way). At most [`MAX_FRAMES`]
    /// are kept. No frames gives a table of one silent frame.
    pub fn from_frames(frames: &[Vec<f32>]) -> Wavetable {
        let count = frames.len().clamp(1, MAX_FRAMES);
        let mut levels: Vec<Box<[f32]>> =
            (0..MIP_LEVELS).map(|_| vec![0.0f32; count * FRAME_LEN].into_boxed_slice()).collect();
        let mut re = vec![0.0f32; FRAME_LEN];
        let mut im = vec![0.0f32; FRAME_LEN];
        for f in 0..count {
            let Some(src) = frames.get(f) else { break };
            let (sre, sim) = spectrum_any(src);
            let n = src.len();
            if n < 4 {
                continue;
            }
            // Harmonics the source can hold, without its Nyquist bin.
            let top = ((n - 1) / 2).min(harmonic_limit(0));
            let scale = FRAME_LEN as f32 / n as f32;
            // Level 0 first, to find the peak that normalises every level.
            fill_bins(&mut re, &mut im, &sre, &sim, top, scale);
            inverse(&mut re, &mut im);
            let peak = re.iter().fold(0.0f32, |m, v| m.max(v.abs()));
            if peak < 1e-9 {
                continue;
            }
            let gain = 1.0 / peak;
            for (level, data) in levels.iter_mut().enumerate() {
                let out = &mut data[f * FRAME_LEN..(f + 1) * FRAME_LEN];
                if level == 0 {
                    for (o, v) in out.iter_mut().zip(re.iter()) {
                        *o = v * gain;
                    }
                    continue;
                }
                let mut lre = vec![0.0f32; FRAME_LEN];
                let mut lim = vec![0.0f32; FRAME_LEN];
                fill_bins(&mut lre, &mut lim, &sre, &sim, top.min(harmonic_limit(level)), scale * gain);
                inverse(&mut lre, &mut lim);
                out.copy_from_slice(&lre);
            }
        }
        let mut slope = [0.0f32; MIP_LEVELS];
        for (level, data) in levels.iter().enumerate() {
            let mut m = 0.0f32;
            for frame in data.chunks_exact(FRAME_LEN) {
                for i in 0..FRAME_LEN {
                    m = m.max((frame[(i + 1) & FRAME_MASK] - frame[i]).abs());
                }
            }
            slope[level] = m * FRAME_LEN as f32;
        }
        Wavetable { frames: count, levels, slope }
    }

    pub fn frame_count(&self) -> usize {
        self.frames
    }

    /// Frame `index` at full bandwidth (level 0).
    pub fn frame(&self, index: usize) -> &[f32] {
        self.level(0, index)
    }

    /// Frame `index` at a mip level.
    pub fn level(&self, level: usize, index: usize) -> &[f32] {
        let i = index.min(self.frames - 1);
        &self.levels[level.min(MIP_LEVELS - 1)][i * FRAME_LEN..(i + 1) * FRAME_LEN]
    }

    /// Every frame of a level, back to back.
    #[inline]
    pub(crate) fn data(&self, level: usize) -> &[f32] {
        &self.levels[level]
    }

    /// The steepest slope at a level, in units per cycle.
    #[inline]
    pub(crate) fn max_slope(&self, level: usize) -> f32 {
        self.slope[level.min(MIP_LEVELS - 1)]
    }

    /// Each frame drawn at `points` points, for the page. Read from level 0
    /// with linear interpolation: this is a picture of the stored wave, not a
    /// resampling of it, so it passes through the stored values.
    pub fn preview(&self, points: usize) -> Vec<Vec<f32>> {
        (0..self.frames)
            .map(|f| {
                let frame = self.frame(f);
                (0..points)
                    .map(|i| {
                        let p = i as f32 * FRAME_LEN as f32 / points as f32;
                        let j = p as usize & FRAME_MASK;
                        let u = p - p.floor();
                        frame[j] + (frame[(j + 1) & FRAME_MASK] - frame[j]) * u
                    })
                    .collect()
            })
            .collect()
    }
}

/// Copy harmonics `1..=top` of a source spectrum into a 2048-point one, with
/// their mirror images so the inverse is real.
fn fill_bins(re: &mut [f32], im: &mut [f32], sre: &[f32], sim: &[f32], top: usize, scale: f32) {
    re.iter_mut().for_each(|v| *v = 0.0);
    im.iter_mut().for_each(|v| *v = 0.0);
    for k in 1..=top {
        re[k] = sre[k] * scale;
        im[k] = sim[k] * scale;
        re[FRAME_LEN - k] = sre[k] * scale;
        im[FRAME_LEN - k] = -sim[k] * scale;
    }
}

/// In-place inverse FFT by conjugation; the real part is the signal.
fn inverse(re: &mut [f32], im: &mut [f32]) {
    let n = re.len() as f32;
    im.iter_mut().for_each(|v| *v = -*v);
    fft(re, im);
    re.iter_mut().for_each(|v| *v /= n);
    im.iter_mut().for_each(|v| *v = -*v / n);
}

/// The forward DFT of a real signal of any length.
pub(crate) fn spectrum_any(x: &[f32]) -> (Vec<f32>, Vec<f32>) {
    let n = x.len();
    if n == 0 {
        return (Vec::new(), Vec::new());
    }
    if n.is_power_of_two() {
        let mut re = x.to_vec();
        let mut im = vec![0.0f32; n];
        fft(&mut re, &mut im);
        return (re, im);
    }
    // Bluestein: a DFT of length n as a convolution of length m >= 2n - 1,
    // which the radix-2 FFT can do. The chirp's angle is computed from
    // k² mod 2n in f64 so it stays exact for long frames.
    let m = (2 * n - 1).next_power_of_two();
    let chirp: Vec<(f64, f64)> = (0..n)
        .map(|k| {
            let k2 = ((k as u64 * k as u64) % (2 * n as u64)) as f64;
            let a = -std::f64::consts::PI * k2 / n as f64;
            (a.cos(), a.sin())
        })
        .collect();
    let mut are = vec![0.0f32; m];
    let mut aim = vec![0.0f32; m];
    for k in 0..n {
        are[k] = (x[k] as f64 * chirp[k].0) as f32;
        aim[k] = (x[k] as f64 * chirp[k].1) as f32;
    }
    let mut bre = vec![0.0f32; m];
    let mut bim = vec![0.0f32; m];
    bre[0] = chirp[0].0 as f32;
    bim[0] = -chirp[0].1 as f32;
    for k in 1..n {
        bre[k] = chirp[k].0 as f32;
        bim[k] = -chirp[k].1 as f32;
        bre[m - k] = bre[k];
        bim[m - k] = bim[k];
    }
    fft(&mut are, &mut aim);
    fft(&mut bre, &mut bim);
    for k in 0..m {
        let (r, i) = (are[k] * bre[k] - aim[k] * bim[k], are[k] * bim[k] + aim[k] * bre[k]);
        are[k] = r;
        aim[k] = i;
    }
    inverse(&mut are, &mut aim);
    let mut re = vec![0.0f32; n];
    let mut im = vec![0.0f32; n];
    for k in 0..n {
        let (cr, ci) = (are[k] as f64, aim[k] as f64);
        re[k] = (cr * chirp[k].0 - ci * chirp[k].1) as f32;
        im[k] = (cr * chirp[k].1 + ci * chirp[k].0) as f32;
    }
    (re, im)
}

// ── built-in tables ─────────────────────────────────────────────────────────

/// Frames per built-in table.
pub const BUILTIN_FRAMES: usize = 64;

/// The five built-in tables, by name, as frames of [`FRAME_LEN`] samples.
///
/// These are the mock-up kit's `TABLES` recipes, rendered at 2048 samples a
/// frame instead of 256: the same 48 harmonics with the same amplitudes, each
/// frame normalised to a peak of 1. The names are the patch's table names.
pub fn builtin_tables() -> Vec<(String, Vec<Vec<f32>>)> {
    BUILTIN_NAMES.iter().map(|name| (name.to_string(), builtin_frames(name).unwrap_or_default())).collect()
}

/// The built-in names, in the kit's order.
pub const BUILTIN_NAMES: [&str; 5] = ["Formant Sweep", "Glass Organ", "Vowel Ah–Oo", "Hollow Pulse", "Grit Saw"];

/// One built-in table's frames, or `None` for an unknown name.
pub fn builtin_frames(name: &str) -> Option<Vec<Vec<f32>>> {
    let recipe: fn(usize, f64) -> f64 = match name {
        "Formant Sweep" => formant_sweep,
        "Glass Organ" => glass_organ,
        "Vowel Ah–Oo" => vowel,
        "Hollow Pulse" => hollow_pulse,
        "Grit Saw" => grit_saw,
        _ => return None,
    };
    Some(additive(BUILTIN_FRAMES, recipe))
}

/// The kit's `additive()`: harmonics 1..48 of `amp(k, t)` summed as sines,
/// `t` running 0..1 across the frames, each frame normalised.
fn additive(frames: usize, amp: fn(usize, f64) -> f64) -> Vec<Vec<f32>> {
    // sin(2πki/N) is sin of (k·i mod N): one table serves every harmonic.
    let sin: Vec<f64> =
        (0..FRAME_LEN).map(|i| (std::f64::consts::TAU * i as f64 / FRAME_LEN as f64).sin()).collect();
    (0..frames)
        .map(|f| {
            let t = f as f64 / (frames - 1) as f64;
            let mut a = vec![0.0f64; FRAME_LEN];
            for k in 1..=48usize {
                let g = amp(k, t);
                if g == 0.0 {
                    continue;
                }
                for (i, v) in a.iter_mut().enumerate() {
                    *v += g * sin[(k * i) & FRAME_MASK];
                }
            }
            let m = a.iter().fold(0.0f64, |m, v| m.max(v.abs()));
            a.iter().map(|v| if m > 0.0 { (v / m) as f32 } else { 0.0 }).collect()
        })
        .collect()
}

fn formant_sweep(k: usize, t: f64) -> f64 {
    let kf = k as f64;
    let saw = 1.0 / kf;
    let sq = if k % 2 == 1 { 1.0 / kf } else { 0.0 };
    let form = (-((kf - (3.0 + t * 16.0)) / 2.4).powi(2)).exp() / kf.sqrt() + if k == 1 { 0.35 } else { 0.0 };
    if t < 1.0 / 3.0 {
        let u = t * 3.0;
        return (if k == 1 { 1.0 } else { 0.0 }) * (1.0 - u) + saw * u;
    }
    if t < 2.0 / 3.0 {
        let u = (t - 1.0 / 3.0) * 3.0;
        return saw * (1.0 - u) + sq * u;
    }
    let u = (t - 2.0 / 3.0) * 3.0;
    sq * (1.0 - u) + form * u
}

fn glass_organ(k: usize, t: f64) -> f64 {
    if [1, 2, 3, 4, 6, 8, 12, 16].contains(&k) {
        let kf = k as f64;
        (0.62 + t * 0.3).powf(kf.log2() * 2.0) * (1.0 + 0.4 * (kf * t * 5.0).sin())
    } else {
        0.0
    }
}

fn vowel(k: usize, t: f64) -> f64 {
    let kf = k as f64;
    let f1 = 7.0 - t * 4.0;
    let f2 = 12.0 - t * 6.0;
    ((-((kf - f1) / 1.6).powi(2)).exp() + 0.6 * (-((kf - f2) / 2.0).powi(2)).exp()) / kf.sqrt()
        + if k == 1 { 0.2 } else { 0.0 }
}

fn hollow_pulse(k: usize, t: f64) -> f64 {
    let w = 0.5 - t * 0.44;
    (std::f64::consts::PI * k as f64 * w).sin() / k as f64
}

fn grit_saw(k: usize, t: f64) -> f64 {
    (1.0 / k as f64) * (1.0 + t * 1.5 * ((k * 7919) % 13) as f64 / 13.0 - t * 0.3)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Harmonic magnitudes of a 2048-point frame, by a plain f64 DFT, so the
    /// check does not share the code it checks.
    fn harmonics(frame: &[f32]) -> Vec<f64> {
        let n = frame.len();
        (0..=n / 2)
            .map(|k| {
                let (mut r, mut i) = (0.0f64, 0.0f64);
                for (j, v) in frame.iter().enumerate() {
                    let a = std::f64::consts::TAU * ((k * j) % n) as f64 / n as f64;
                    r += *v as f64 * a.cos();
                    i -= *v as f64 * a.sin();
                }
                (r * r + i * i).sqrt() * 2.0 / n as f64
            })
            .collect()
    }

    fn naive_saw(n: usize) -> Vec<f32> {
        (0..n).map(|i| 1.0 - 2.0 * i as f32 / n as f32).collect()
    }

    #[test]
    fn every_mip_level_has_no_energy_above_its_harmonic_limit() {
        // A naive saw has every harmonic, so every level has something to cut.
        let table = Wavetable::from_frames(&[naive_saw(FRAME_LEN)]);
        for level in 0..MIP_LEVELS {
            let h = harmonics(table.level(level, 0));
            let limit = harmonic_limit(level);
            let kept: f64 = h[1..=limit].iter().map(|v| v * v).sum();
            let above: f64 = h[limit + 1..].iter().map(|v| v * v).sum();
            let db = 10.0 * (above / kept).log10();
            assert!(db < -110.0, "level {level}: {db:.1} dB above harmonic {limit}");
            // And what it keeps is the saw's, not something duller.
            assert!(h[limit] > 0.5 / limit as f64 * 0.5, "level {level} lost its top harmonic");
        }
    }

    #[test]
    fn import_removes_dc_and_normalises() {
        let frame: Vec<f32> = (0..512).map(|i| 0.3 + 0.2 * (std::f32::consts::TAU * i as f32 / 512.0).sin()).collect();
        let table = Wavetable::from_frames(&[frame]);
        let f = table.frame(0);
        let mean: f32 = f.iter().sum::<f32>() / f.len() as f32;
        let peak = f.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        assert!(mean.abs() < 1e-5, "DC left: {mean}");
        assert!((peak - 1.0).abs() < 1e-4, "peak {peak}");
    }

    fn resample_error(n: usize) -> f32 {
        // A band-limited frame whose every harmonic both sizes hold: resampled
        // in the spectrum it must come back as the same continuous wave.
        let wave = |x: f64| {
            (std::f64::consts::TAU * x).sin() + 0.5 * (std::f64::consts::TAU * 3.0 * x + 0.4).sin()
                - 0.25 * (std::f64::consts::TAU * 17.0 * x + 1.1).cos()
        };
        let frame: Vec<f32> = (0..n).map(|i| wave(i as f64 / n as f64) as f32).collect();
        let table = Wavetable::from_frames(&[frame]);
        let out = table.frame(0);
        let expect: Vec<f64> = (0..FRAME_LEN).map(|i| wave(i as f64 / FRAME_LEN as f64)).collect();
        let peak = expect.iter().fold(0.0f64, |m, v| m.max(v.abs()));
        out.iter().zip(expect.iter()).map(|(o, e)| (*o as f64 - e / peak).abs() as f32).fold(0.0, f32::max)
    }

    #[test]
    fn from_frames_resamples_256_and_4096_sample_frames_to_2048() {
        for n in [256, 4096] {
            let err = resample_error(n);
            assert!(err < 1e-4, "{n}-sample frame: max error {err}");
        }
    }

    #[test]
    fn a_frame_that_is_not_a_power_of_two_resamples_as_exactly() {
        for n in [600, 1000, 3001] {
            let err = resample_error(n);
            assert!(err < 1e-4, "{n}-sample frame: max error {err}");
        }
    }

    #[test]
    fn builtins_are_five_tables_of_64_frames_at_2048() {
        let tables = builtin_tables();
        let names: Vec<&str> = tables.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, BUILTIN_NAMES);
        for (name, frames) in &tables {
            assert_eq!(frames.len(), 64, "{name}");
            for f in frames {
                assert_eq!(f.len(), FRAME_LEN);
                let peak = f.iter().fold(0.0f32, |m, v| m.max(v.abs()));
                assert!((peak - 1.0).abs() < 1e-6, "{name} frame not normalised: {peak}");
            }
        }
        // Formant Sweep starts on a pure sine, as the kit's recipe says.
        let h = harmonics(&tables[0].1[0]);
        assert!(h[2..].iter().all(|v| *v < 1e-6));
    }

    #[test]
    fn builtins_match_the_kit_at_its_own_resolution() {
        // The kit renders 256 points; ours at 2048 must pass through the same
        // values at every eighth sample (same harmonics, same normalisation —
        // the peak can differ by a hair between the two grids).
        let ours = builtin_frames("Grit Saw").unwrap();
        let kit: Vec<f64> = {
            let t = 1.0;
            let mut a = vec![0.0f64; 256];
            for k in 1..=48usize {
                let g = grit_saw(k, t);
                for (i, v) in a.iter_mut().enumerate() {
                    *v += g * (std::f64::consts::TAU * (k * i) as f64 / 256.0).sin();
                }
            }
            let m = a.iter().fold(0.0f64, |m, v| m.max(v.abs()));
            a.iter().map(|v| v / m).collect()
        };
        let last = &ours[63];
        let err = kit.iter().enumerate().map(|(i, v)| (last[i * 8] as f64 - v).abs()).fold(0.0, f64::max);
        assert!(err < 0.02, "Grit Saw last frame differs from the kit by {err}");
    }

    #[test]
    fn preview_has_the_requested_points_per_frame() {
        let table = Wavetable::from_frames(&builtin_frames("Hollow Pulse").unwrap());
        let p = table.preview(256);
        assert_eq!(p.len(), 64);
        assert!(p.iter().all(|f| f.len() == 256));
        assert_eq!(p[3][8], table.frame(3)[64]);
    }

    #[test]
    fn too_many_frames_are_dropped_and_none_is_one_silent_frame() {
        let many: Vec<Vec<f32>> = (0..300).map(|_| naive_saw(256)).collect();
        assert_eq!(Wavetable::from_frames(&many).frame_count(), MAX_FRAMES);
        let none = Wavetable::from_frames(&[]);
        assert_eq!(none.frame_count(), 1);
        assert!(none.frame(0).iter().all(|v| *v == 0.0));
    }
}
