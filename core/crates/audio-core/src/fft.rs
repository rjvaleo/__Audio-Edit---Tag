//! Radix-2 FFT and window functions.
//!
//! Hand-written rather than pulled from a crate so the binary stays
//! dependency-free and cross-compiles with no toolchain beyond rustc. The
//! transform is iterative and in-place; there is no recursion and no allocation
//! per call, because the spectrogram runs it a few thousand times per view.

use std::f32::consts::PI;

/// In-place complex FFT. `re` and `im` must be the same power-of-two length.
///
/// Returns `false` and leaves the input untouched if the length is unusable,
/// rather than panicking on data that came in over HTTP.
pub fn fft(re: &mut [f32], im: &mut [f32]) -> bool {
    let n = re.len();
    if n != im.len() || n == 0 || !n.is_power_of_two() {
        return false;
    }
    if n == 1 {
        return true;
    }

    // Bit-reversal permutation.
    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }

    // Butterflies, doubling the block length each pass.
    let mut len = 2usize;
    while len <= n {
        let ang = -2.0 * PI / len as f32;
        let mut i = 0;
        while i < n {
            // Recomputing the twiddle by repeated multiplication accumulates
            // error over long transforms, so derive each from its index.
            for k in 0..len / 2 {
                let a = ang * k as f32;
                let (cr, ci) = (a.cos(), a.sin());
                let (ur, ui) = (re[i + k], im[i + k]);
                let (xr, xi) = (re[i + k + len / 2], im[i + k + len / 2]);
                let vr = xr * cr - xi * ci;
                let vi = xr * ci + xi * cr;
                re[i + k] = ur + vr;
                im[i + k] = ui + vi;
                re[i + k + len / 2] = ur - vr;
                im[i + k + len / 2] = ui - vi;
            }
            i += len;
        }
        len <<= 1;
    }
    true
}

/// Magnitude of each bin up to Nyquist, given a completed transform.
pub fn magnitudes(re: &[f32], im: &[f32]) -> Vec<f32> {
    let half = re.len() / 2 + 1;
    (0..half).map(|i| (re[i] * re[i] + im[i] * im[i]).sqrt()).collect()
}

/// A Hann window of length `n`.
///
/// Without a window, a tone that does not sit exactly on a bin centre smears
/// across the whole spectrum and the spectrogram turns to mush.
pub fn hann(n: usize) -> Vec<f32> {
    if n <= 1 {
        return vec![1.0; n];
    }
    (0..n)
        .map(|i| 0.5 - 0.5 * (2.0 * PI * i as f32 / (n - 1) as f32).cos())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn transform(signal: &[f32]) -> Vec<f32> {
        let mut re = signal.to_vec();
        let mut im = vec![0.0; signal.len()];
        assert!(fft(&mut re, &mut im));
        magnitudes(&re, &im)
    }

    #[test]
    fn a_constant_signal_puts_all_energy_in_the_dc_bin() {
        let mags = transform(&[1.0f32; 64]);
        assert!((mags[0] - 64.0).abs() < 1e-3, "dc bin was {}", mags[0]);
        for (i, m) in mags.iter().enumerate().skip(1) {
            assert!(*m < 1e-3, "bin {i} should be empty, was {m}");
        }
    }

    #[test]
    fn silence_transforms_to_silence() {
        for m in transform(&[0.0f32; 128]) {
            assert!(m < 1e-6);
        }
    }

    #[test]
    fn a_sine_on_a_bin_centre_lands_in_that_bin() {
        // 8 cycles across 128 samples puts the tone exactly on bin 8.
        let n = 128;
        let sig: Vec<f32> = (0..n)
            .map(|i| (2.0 * PI * 8.0 * i as f32 / n as f32).sin())
            .collect();
        let mags = transform(&sig);
        let peak = mags
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
            .unwrap()
            .0;
        assert_eq!(peak, 8);
    }

    #[test]
    fn two_tones_produce_two_peaks() {
        let n = 256;
        let sig: Vec<f32> = (0..n)
            .map(|i| {
                let t = i as f32 / n as f32;
                (2.0 * PI * 10.0 * t).sin() + (2.0 * PI * 40.0 * t).sin()
            })
            .collect();
        let mags = transform(&sig);
        let mut idx: Vec<usize> = (0..mags.len()).collect();
        idx.sort_by(|&a, &b| mags[b].partial_cmp(&mags[a]).unwrap());
        let top: Vec<usize> = idx.into_iter().take(2).collect();
        assert!(top.contains(&10), "expected a peak at bin 10, got {top:?}");
        assert!(top.contains(&40), "expected a peak at bin 40, got {top:?}");
    }

    #[test]
    fn energy_is_conserved() {
        // Parseval: the sum of squares in time equals the sum in frequency,
        // scaled by n. This catches a whole class of indexing mistakes.
        let n = 64;
        let sig: Vec<f32> = (0..n).map(|i| ((i * 7 % 13) as f32 / 13.0) - 0.5).collect();
        let time: f32 = sig.iter().map(|v| v * v).sum();

        let mut re = sig.clone();
        let mut im = vec![0.0; n];
        assert!(fft(&mut re, &mut im));
        let freq: f32 = (0..n).map(|i| re[i] * re[i] + im[i] * im[i]).sum::<f32>() / n as f32;

        assert!((time - freq).abs() < 1e-2, "time {time} vs freq {freq}");
    }

    #[test]
    fn a_non_power_of_two_is_refused_rather_than_panicking() {
        let mut re = vec![0.0f32; 100];
        let mut im = vec![0.0f32; 100];
        assert!(!fft(&mut re, &mut im));
    }

    #[test]
    fn mismatched_buffers_are_refused() {
        let mut re = vec![0.0f32; 64];
        let mut im = vec![0.0f32; 32];
        assert!(!fft(&mut re, &mut im));
    }

    #[test]
    fn a_single_sample_transform_is_a_no_op() {
        let mut re = vec![3.0f32];
        let mut im = vec![0.0f32];
        assert!(fft(&mut re, &mut im));
        assert_eq!(re[0], 3.0);
    }

    #[test]
    fn magnitudes_cover_dc_through_nyquist_inclusive() {
        let mags = transform(&[1.0f32; 64]);
        assert_eq!(mags.len(), 33);
    }

    #[test]
    fn a_hann_window_starts_and_ends_at_zero_and_peaks_in_the_middle() {
        let w = hann(65);
        assert!(w[0].abs() < 1e-6);
        assert!(w[64].abs() < 1e-6);
        assert!((w[32] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn windowing_narrows_a_tone_that_sits_between_bins() {
        // 8.5 cycles falls between bins. Unwindowed it leaks across the whole
        // spectrum; windowed the energy stays local. Compare the far-field.
        let n = 256;
        let raw: Vec<f32> = (0..n)
            .map(|i| (2.0 * PI * 8.5 * i as f32 / n as f32).sin())
            .collect();
        let w = hann(n);
        let windowed: Vec<f32> = raw.iter().zip(&w).map(|(s, k)| s * k).collect();

        let far = |mags: &[f32]| -> f32 { mags[40..].iter().copied().fold(0.0, f32::max) };
        let raw_far = far(&transform(&raw));
        let win_far = far(&transform(&windowed));
        assert!(
            win_far < raw_far * 0.2,
            "windowing should suppress distant leakage: {win_far} vs {raw_far}"
        );
    }
}
