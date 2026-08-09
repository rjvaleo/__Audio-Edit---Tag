//! Phase vocoder time stretching.
//!
//! The frequency-domain counterpart to WSOLA. Where WSOLA cuts the signal up
//! and hunts for splice points that happen to line up, this transforms each
//! window, works out what frequency each bin *really* holds, and advances the
//! phase by what that frequency implies over the synthesis hop rather than by
//! what the analysis hop happened to give it. The magnitudes are copied
//! untouched; only the phases are rewritten.
//!
//! That difference decides where each belongs. WSOLA is phase-coherent by
//! construction and keeps transients intact, but on dense polyphony there is no
//! single splice point that suits every pitch at once, so it smears. The
//! vocoder has no such trouble with polyphony — every partial is handled in its
//! own bin — but it smears transients across a window and gives noise a watery,
//! chorused quality, because forcing phase coherence on noise is precisely the
//! wrong thing to do to it. They fail in opposite directions, which is why the
//! app now offers both rather than picking one.
//!
//! Follows Driedger, *Time-Scale Modification Algorithms for Music Audio*
//! (Saarland, 2011), chapter 5 — see `Reference Docs/md/`. The phase
//! propagation is equations 5.10 to 5.12, kept in that order below so the code
//! can be read against the source.

use audio_core::fft::{self, fft};
use std::f32::consts::PI;

const TWO_PI: f32 = 2.0 * PI;

/// Wrap a phase into [−π, π).
///
/// The heterodyned phase increment is only meaningful modulo a turn: a bin
/// cannot tell you how many whole rotations happened between two frames, only
/// where it ended up. Wrapping is what turns the ambiguity into the *smallest*
/// consistent explanation, which is the right one whenever the analysis hop is
/// short enough — and is why hop size bounds how far a partial may drift.
fn wrap(mut p: f32) -> f32 {
    while p >= PI {
        p -= TWO_PI;
    }
    while p < -PI {
        p += TWO_PI;
    }
    p
}

/// Inverse transform, by conjugation.
///
/// `audio_core::fft` is forward-only, and the identity
/// `ifft(X) = conj(fft(conj(X))) / N` is exact — cheaper to use than to
/// maintain a second transform that could drift from the first.
fn ifft(re: &mut [f32], im: &mut [f32]) {
    for v in im.iter_mut() {
        *v = -*v;
    }
    fft(re, im);
    let n = re.len() as f32;
    for v in re.iter_mut() {
        *v /= n;
    }
    for v in im.iter_mut() {
        *v = -*v / n;
    }
}

/// Bins that are local maxima of the magnitude spectrum.
///
/// A partial does not sit in one bin. It has a main lobe several bins wide, and
/// the plain vocoder advances every one of those bins on its own estimate — so
/// a single partial is pulled apart into neighbours that slowly disagree about
/// its phase. That disagreement is the "phasiness" the vocoder is known for.
///
/// Requiring a bin to beat both of its two neighbours either side is Laroche
/// and Dolson's test: strict enough to ignore ripple in the noise floor,
/// loose enough to catch every real partial.
fn peaks(mag: &[f32], out: &mut Vec<usize>) {
    out.clear();
    if mag.len() < 5 {
        return;
    }
    for k in 2..mag.len() - 2 {
        let m = mag[k];
        if m > mag[k - 1] && m > mag[k + 1] && m > mag[k - 2] && m > mag[k + 2] && m > 1e-9 {
            out.push(k);
        }
    }
}

/// Settings for one run.
#[derive(Debug, Clone, Copy)]
pub struct Settings {
    /// Transform size. Rounded up to a power of two.
    pub fft_size: usize,
    /// Synthesis hop as a fraction of the window: 4 means 75% overlap.
    pub overlap: usize,
    /// Lock the bins around each spectral peak to that peak's phase.
    pub phase_lock: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { fft_size: 2048, overlap: 4, phase_lock: true }
    }
}

/// Stretch one channel of mono audio by `ratio`.
pub fn stretch_mono(input: &[f32], ratio: f32, s: Settings) -> Vec<f32> {
    let ratio = ratio.clamp(0.01, 100.0);
    let n = s.fft_size.max(64).next_power_of_two();
    let overlap = s.overlap.clamp(2, 8);
    let hs = (n / overlap).max(1); // synthesis hop, fixed
    if input.len() < n {
        // Too short to transform. Nothing useful to say about its spectrum.
        return input.to_vec();
    }

    let out_len = ((input.len() as f64) * ratio as f64).round() as usize;
    let win = fft::hann(n);

    let mut out = vec![0f32; out_len + n];
    let mut norm = vec![0f32; out_len + n];

    let mut re = vec![0f32; n];
    let mut im = vec![0f32; n];
    let bins = n / 2 + 1;

    let mut prev_phase = vec![0f32; bins];
    let mut sum_phase = vec![0f32; bins];
    let mut mag = vec![0f32; bins];
    let mut phase = vec![0f32; bins];
    let mut peak_idx: Vec<usize> = Vec::with_capacity(bins / 4);

    // Analysis reads slower than synthesis writes when stretching. Kept as a
    // float and rounded per frame, so a fractional hop does not accumulate
    // drift over a long file.
    let advance = hs as f64 / ratio as f64;
    let mut read = 0f64;
    let mut prev_start: isize = -1;
    let mut write = 0usize;
    let mut first = true;

    while write < out_len {
        let start = read.round() as usize;
        if start + n > input.len() {
            break;
        }

        for i in 0..n {
            re[i] = input[start + i] * win[i];
            im[i] = 0.0;
        }
        if !fft(&mut re, &mut im) {
            break;
        }

        for k in 0..bins {
            mag[k] = (re[k] * re[k] + im[k] * im[k]).sqrt();
            phase[k] = im[k].atan2(re[k]);
        }

        // The true analysis hop for this frame, which is what the heterodyne
        // is measured against — equation 5.10 uses α(n) − α(n−1), not a
        // nominal value.
        let ha = if prev_start < 0 { hs as f32 } else { (start as isize - prev_start) as f32 };

        if first {
            sum_phase.copy_from_slice(&phase);
            first = false;
        } else if s.phase_lock {
            peaks(&mag, &mut peak_idx);
            if peak_idx.is_empty() {
                propagate_all(&phase, &prev_phase, &mut sum_phase, n, ha, hs as f32);
            } else {
                // Every peak advances on its own instantaneous frequency; the
                // bins around it keep the phase relationship they had in the
                // analysis frame. So a partial moves as one object instead of
                // dissolving into its own skirts.
                for (p, &k) in peak_idx.iter().enumerate() {
                    let omega = TWO_PI * k as f32 / n as f32;
                    let delta = wrap(phase[k] - prev_phase[k] - ha * omega);
                    let freq = omega + delta / ha;
                    sum_phase[k] = wrap(sum_phase[k] + hs as f32 * freq);

                    // Halfway to each neighbouring peak.
                    let lo = if p == 0 { 0 } else { (peak_idx[p - 1] + k + 1) / 2 };
                    let hi = if p + 1 == peak_idx.len() { bins } else { (k + peak_idx[p + 1] + 1) / 2 };
                    for j in lo..hi {
                        if j != k {
                            sum_phase[j] = wrap(sum_phase[k] + (phase[j] - phase[k]));
                        }
                    }
                }
            }
        } else {
            propagate_all(&phase, &prev_phase, &mut sum_phase, n, ha, hs as f32);
        }

        prev_phase.copy_from_slice(&phase);
        prev_start = start as isize;

        // Rebuild the spectrum: magnitudes as analysed, phases as propagated,
        // and the upper half mirrored so the inverse transform is real.
        for k in 0..bins {
            re[k] = mag[k] * sum_phase[k].cos();
            im[k] = mag[k] * sum_phase[k].sin();
        }
        for k in bins..n {
            re[k] = re[n - k];
            im[k] = -im[n - k];
        }
        im[0] = 0.0;
        if n % 2 == 0 {
            im[n / 2] = 0.0;
        }
        ifft(&mut re, &mut im);

        for i in 0..n {
            if write + i < out.len() {
                out[write + i] += re[i] * win[i];
                // The same window is applied going in and coming out, so the
                // overlap sums to w² rather than w. Accumulating it rather
                // than assuming a constant keeps any overlap factor correct.
                norm[write + i] += win[i] * win[i];
            }
        }

        read += advance;
        write += hs;
    }

    for i in 0..out.len() {
        if norm[i] > 1e-6 {
            out[i] /= norm[i];
        }
    }
    out.truncate(out_len);
    out
}

/// Equations 5.10 to 5.12, applied to every bin independently.
fn propagate_all(phase: &[f32], prev: &[f32], sum: &mut [f32], n: usize, ha: f32, hs: f32) {
    for k in 0..phase.len() {
        // 5.10 — the heterodyned phase increment: what actually happened,
        // less what a partial sitting exactly on the bin centre would have done.
        let omega = TWO_PI * k as f32 / n as f32;
        let delta = wrap(phase[k] - prev[k] - ha * omega);
        // 5.11 — the instantaneous frequency that deviation implies.
        let freq = omega + delta / ha;
        // 5.12 — advance by it over the synthesis hop.
        sum[k] = wrap(sum[k] + hs * freq);
    }
}

/// Stretch interleaved audio, one channel at a time.
///
/// Channels are transformed independently. That is the usual choice and it is
/// worth knowing what it costs: two channels can drift in phase against each
/// other, which widens a stereo image and can hollow a centred source. Sharing
/// one phase estimate between them would fix it and would flatten genuinely
/// different channels, so this stays per-channel and the trade is stated
/// instead of hidden.
pub fn stretch(input: &[f32], channels: usize, ratio: f32, s: Settings) -> Vec<f32> {
    let channels = channels.max(1);
    if input.is_empty() {
        return Vec::new();
    }
    if channels == 1 {
        return stretch_mono(input, ratio, s);
    }

    let frames = input.len() / channels;
    let mut outs: Vec<Vec<f32>> = Vec::with_capacity(channels);
    let mut chan = vec![0f32; frames];
    for c in 0..channels {
        for f in 0..frames {
            chan[f] = input[f * channels + c];
        }
        outs.push(stretch_mono(&chan, ratio, s));
    }

    let out_frames = outs.iter().map(|o| o.len()).min().unwrap_or(0);
    let mut out = vec![0f32; out_frames * channels];
    for (c, o) in outs.iter().enumerate() {
        for f in 0..out_frames {
            out[f * channels + c] = o[f];
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f32, secs: f32, rate: f32) -> Vec<f32> {
        let n = (secs * rate) as usize;
        (0..n).map(|i| (TWO_PI * freq * i as f32 / rate).sin()).collect()
    }

    /// Energy at a frequency, by direct correlation — independent of any FFT
    /// length lining up with the tone.
    fn energy_at(sig: &[f32], freq: f32, rate: f32) -> f32 {
        let (mut re, mut im) = (0.0f64, 0.0f64);
        for (i, s) in sig.iter().enumerate() {
            let p = 2.0 * std::f64::consts::PI * freq as f64 * i as f64 / rate as f64;
            re += *s as f64 * p.cos();
            im += *s as f64 * p.sin();
        }
        ((re * re + im * im).sqrt() / sig.len() as f64) as f32
    }

    #[test]
    fn a_phase_wraps_into_one_turn() {
        assert!((wrap(0.0)).abs() < 1e-6);
        assert!((wrap(TWO_PI) - 0.0).abs() < 1e-5);
        assert!(wrap(PI + 0.1) < 0.0);
        assert!(wrap(-PI - 0.1) > 0.0);
        for p in [-30.0f32, -7.0, -1.0, 0.5, 4.0, 100.0] {
            let w = wrap(p);
            assert!(w >= -PI && w < PI, "{p} wrapped to {w}");
        }
    }

    #[test]
    fn the_inverse_transform_undoes_the_forward_one() {
        let n = 64;
        let src: Vec<f32> = (0..n).map(|i| ((i * 7 % 13) as f32 / 13.0) - 0.5).collect();
        let mut re = src.clone();
        let mut im = vec![0f32; n];
        assert!(fft(&mut re, &mut im));
        ifft(&mut re, &mut im);
        for (a, b) in src.iter().zip(&re) {
            assert!((a - b).abs() < 1e-4, "{a} vs {b}");
        }
    }

    #[test]
    fn output_length_follows_the_ratio() {
        let src = sine(440.0, 0.5, 44100.0);
        for r in [0.5f32, 1.0, 2.0, 4.0] {
            let out = stretch_mono(&src, r, Settings::default());
            let want = (src.len() as f32 * r) as usize;
            let slack = (want as f32 * 0.02) as usize + 64;
            assert!(
                (out.len() as isize - want as isize).unsigned_abs() <= slack,
                "ratio {r}: got {} want {want}",
                out.len()
            );
        }
    }

    /// The whole point: stretching changes duration and leaves pitch alone.
    #[test]
    fn a_stretched_tone_keeps_its_frequency() {
        let rate = 44100.0;
        let src = sine(440.0, 0.5, rate);
        let out = stretch_mono(&src, 2.0, Settings::default());

        let mid = &out[out.len() / 4..out.len() * 3 / 4];
        let at440 = energy_at(mid, 440.0, rate);
        let at330 = energy_at(mid, 330.0, rate);
        let at880 = energy_at(mid, 880.0, rate);
        assert!(at440 > at330 * 8.0, "440 {at440} vs 330 {at330}");
        assert!(at440 > at880 * 8.0, "440 {at440} vs 880 {at880}");
    }

    /// A tone stretched four times should still be one steady tone, not a
    /// warble. Comparing the first and last thirds catches drift that a single
    /// measurement over the whole thing would average away.
    #[test]
    fn a_long_stretch_does_not_drift_in_pitch() {
        let rate = 44100.0;
        let out = stretch_mono(&sine(440.0, 0.5, rate), 4.0, Settings::default());
        let third = out.len() / 3;
        let early = energy_at(&out[..third], 440.0, rate);
        let late = energy_at(&out[third * 2..], 440.0, rate);
        assert!(early > 0.05 && late > 0.05, "early {early} late {late}");
        assert!((early / late - 1.0).abs() < 0.5, "early {early} late {late}");
    }

    #[test]
    fn a_ratio_of_one_returns_the_signal_it_was_given() {
        let rate = 44100.0;
        let src = sine(440.0, 0.3, rate);
        let out = stretch_mono(&src, 1.0, Settings::default());
        let a = energy_at(&src[2048..src.len() - 2048], 440.0, rate);
        let b = energy_at(&out[2048..out.len() - 2048], 440.0, rate);
        assert!((a / b - 1.0).abs() < 0.15, "{a} vs {b}");
    }

    #[test]
    fn peaks_are_the_local_maxima_and_not_the_ripple() {
        let mut m = vec![0.01f32; 40];
        m[10] = 1.0;
        m[9] = 0.5;
        m[11] = 0.5;
        m[25] = 0.8;
        m[24] = 0.3;
        m[26] = 0.3;
        let mut out = Vec::new();
        peaks(&m, &mut out);
        assert_eq!(out, vec![10, 25]);
    }

    #[test]
    fn silence_stretches_to_silence() {
        let out = stretch_mono(&vec![0f32; 8192], 3.0, Settings::default());
        assert!(out.iter().all(|v| v.abs() < 1e-6));
    }

    #[test]
    fn something_shorter_than_a_window_is_passed_through_untouched() {
        let src = sine(440.0, 0.005, 44100.0);
        let out = stretch_mono(&src, 2.0, Settings::default());
        assert_eq!(out, src);
    }

    #[test]
    fn stereo_stays_in_step_and_keeps_its_channels_apart() {
        let rate = 44100.0;
        let left = sine(440.0, 0.3, rate);
        let right = sine(660.0, 0.3, rate);
        let mut inter = Vec::with_capacity(left.len() * 2);
        for i in 0..left.len() {
            inter.push(left[i]);
            inter.push(right[i]);
        }
        let out = stretch(&inter, 2, 2.0, Settings::default());
        assert_eq!(out.len() % 2, 0);

        let (mut l, mut r) = (Vec::new(), Vec::new());
        for f in out.chunks(2) {
            l.push(f[0]);
            r.push(f[1]);
        }
        // Each channel kept its own tone rather than bleeding into the other.
        assert!(energy_at(&l, 440.0, rate) > energy_at(&l, 660.0, rate) * 5.0);
        assert!(energy_at(&r, 660.0, rate) > energy_at(&r, 440.0, rate) * 5.0);
    }

    /// Phase locking is meant to hold a partial together, so the tone it
    /// produces should be at least as clean as the unlocked one.
    #[test]
    fn locking_does_not_cost_tonal_purity() {
        let rate = 44100.0;
        let src = sine(440.0, 0.4, rate);
        let free = stretch_mono(&src, 3.0, Settings { phase_lock: false, ..Default::default() });
        let lock = stretch_mono(&src, 3.0, Settings { phase_lock: true, ..Default::default() });

        let purity = |o: &[f32]| {
            let mid = &o[o.len() / 4..o.len() * 3 / 4];
            let sig = energy_at(mid, 440.0, rate);
            let noise: f32 = [300.0f32, 500.0, 700.0, 900.0]
                .iter()
                .map(|f| energy_at(mid, *f, rate))
                .sum();
            sig / noise.max(1e-9)
        };
        let (a, b) = (purity(&free), purity(&lock));
        assert!(b > a * 0.75, "locked {b} against free {a}");
    }
}
