//! Stretching noise by not stretching it.
//!
//! Every stretcher in this crate works by laying the source down repeatedly.
//! That is fine for a partial, which sounds the same each time, and fine for a
//! transient, which is short enough to place. It is exactly wrong for noise.
//! Repeat a piece of hiss and the ear hears the repetition immediately — a
//! metallic ring at the hop rate that no amount of window shaping removes,
//! because the correlation is real and the ear is a correlator. Stretch by ten
//! and the sound is more repetition than noise.
//!
//! The way out, from Moliner, Lehtonen and Välimäki (2023), is to notice that
//! nobody wants *that* noise stretched — they want noise that behaves the way
//! that noise behaved. So: measure the residual's spectral envelope frame by
//! frame, interpolate the envelope along the new, longer timeline, and impose
//! it on freshly generated noise. Nothing is repeated because nothing is
//! reused. A one-second breath becomes ten seconds of breath rather than ten
//! copies of one.
//!
//! Two details make it work. The magnitudes are smoothed across frequency
//! first: the fine structure of a noise spectrum *is* the particular
//! realisation, and keeping it would put the thing being avoided straight back
//! in. And the level is corrected afterwards, because random phases sum
//! incoherently — overlap-adding them gives roughly the root of what
//! overlap-adding coherent frames gives, and the amount depends on the overlap,
//! so it is measured rather than assumed.
//!
//! The noise is generated from the grain seed, not from a running generator,
//! for the reason everything else here is: the waveform, the playback and the
//! exported file are three separate renders and must agree.

use audio_core::fft::{self, fft};

/// How the noise is remade.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Morph {
    pub fft_size: usize,
    /// Bins the envelope smoothing spans. Wide loses the character of the
    /// noise and leaves a flat hiss shaped only in the broadest sense; narrow
    /// keeps enough of the original realisation to start ringing again.
    pub smooth_bins: usize,
    /// Seed for the generated noise.
    pub seed: u32,
}

impl Default for Morph {
    fn default() -> Self {
        Morph { fft_size: 2048, smooth_bins: 9, seed: 1 }
    }
}

/// One splitmix64 round. The same construction the grain cloud uses, for the
/// same reason: randomness addressed by index rather than streamed.
fn rand01(index: u64, salt: u32) -> f32 {
    let mut z = index
        .wrapping_mul(0x9E37_79B9_7F4A_7C15)
        .wrapping_add(salt as u64 ^ 0xD1B5_4A32_D192_ED03);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^= z >> 31;
    ((z >> 40) as f32) / 16_777_216.0
}

/// Remake one channel of noise at `ratio` times the length.
pub fn morph_mono(input: &[f32], ratio: f32, m: Morph) -> Vec<f32> {
    let n = m.fft_size.max(64).next_power_of_two();
    let hop = (n / 4).max(1);
    let bins = n / 2 + 1;
    let ratio = ratio.clamp(0.01, 100.0);
    let want = ((input.len() as f64) * ratio as f64).round() as usize;

    if input.len() < n || want == 0 {
        // Nothing to measure an envelope from. Resampling is the honest answer
        // for something this short, and it cannot ring at the hop rate because
        // there are no hops.
        return resample(input, want);
    }

    let win = fft::hann(n);
    let frames = (input.len() - n) / hop + 1;

    // The envelope: magnitudes, smoothed across frequency so that what is kept
    // is the shape of the noise and not the noise itself.
    let mut env = vec![0f32; frames * bins];
    let mut re = vec![0f32; n];
    let mut im = vec![0f32; n];
    let mut mag = vec![0f32; bins];
    let span = m.smooth_bins.max(1) | 1;
    let half = span / 2;

    for f in 0..frames {
        let start = f * hop;
        for i in 0..n {
            re[i] = input[start + i] * win[i];
            im[i] = 0.0;
        }
        if !fft(&mut re, &mut im) {
            break;
        }
        for k in 0..bins {
            mag[k] = (re[k] * re[k] + im[k] * im[k]).sqrt();
        }
        // Running mean across frequency, in energy rather than amplitude —
        // averaging amplitudes would quietly lose level wherever the spectrum
        // is uneven, which is everywhere.
        for k in 0..bins {
            let lo = k.saturating_sub(half);
            let hi = (k + half + 1).min(bins);
            let mut acc = 0f32;
            for kk in lo..hi {
                acc += mag[kk] * mag[kk];
            }
            env[f * bins + k] = (acc / (hi - lo) as f32).sqrt();
        }
    }

    // Synthesis: as many frames as the new length needs, each reading the
    // envelope from wherever it falls between two analysis frames.
    let out_frames = if want > n { (want - n) / hop + 1 } else { 1 };
    let mut out = vec![0f32; want + n];
    let mut norm = vec![0f32; want + n];

    for f in 0..out_frames {
        let src = (f as f32) / ratio;
        let i0 = (src.floor() as usize).min(frames - 1);
        let i1 = (i0 + 1).min(frames - 1);
        let t = src - src.floor();

        for k in 0..bins {
            let a = env[i0 * bins + k];
            let b = env[i1 * bins + k];
            let mg = a + (b - a) * t;
            // A fresh phase per frame per bin. This is the whole trick: the
            // magnitudes come from the source and the phases never do, so
            // there is nothing for the ear to recognise as a repeat.
            let ph = rand01((f as u64) * bins as u64 + k as u64, m.seed) * std::f32::consts::TAU;
            re[k] = mg * ph.cos();
            im[k] = mg * ph.sin();
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

        let start = f * hop;
        for i in 0..n {
            if start + i < out.len() {
                out[start + i] += re[i] * win[i];
                norm[start + i] += win[i] * win[i];
            }
        }
    }

    let floor = norm.iter().fold(0f32, |a, &b| a.max(b)) * 0.05;
    for i in 0..out.len() {
        let g = norm[i].max(floor);
        if g > 1e-6 {
            out[i] /= g;
        }
    }
    out.truncate(want);

    match_level(&mut out, input, ratio, hop.max(1));
    out
}

/// Put the output's level back where the input's was.
///
/// Random phases overlap-add incoherently, so the synthesised level is short by
/// a factor that depends on the overlap and the spectrum. It is easier and
/// more honest to measure the shortfall than to derive it: walk both signals at
/// the same hop, compare local energy, and ramp the correction between
/// measurements so nothing steps.
fn match_level(out: &mut [f32], input: &[f32], ratio: f32, hop: usize) {
    if out.is_empty() || input.is_empty() {
        return;
    }
    let steps = out.len() / hop + 1;
    let mut gains = Vec::with_capacity(steps + 1);
    for s in 0..=steps {
        let a = s * hop;
        let b = (a + hop).min(out.len());
        let have = rms(&out[a.min(out.len())..b.max(a.min(out.len()))]);

        let sa = ((a as f32) / ratio) as usize;
        let sb = (sa + hop).min(input.len());
        let want = rms(&input[sa.min(input.len())..sb.max(sa.min(input.len()))]);

        // No correction where there is nothing to correct, and never more than
        // 12 dB of it — beyond that it is amplifying the noise floor of a gap.
        gains.push(if have > 1e-9 { (want / have).clamp(0.0, 4.0) } else { 1.0 });
    }
    for i in 0..out.len() {
        let s = i / hop;
        let t = (i % hop) as f32 / hop as f32;
        let g = gains[s] + (gains[(s + 1).min(gains.len() - 1)] - gains[s]) * t;
        out[i] *= g;
    }
}

fn rms(v: &[f32]) -> f32 {
    if v.is_empty() {
        return 0.0;
    }
    (v.iter().map(|x| x * x).sum::<f32>() / v.len() as f32).sqrt()
}

fn resample(input: &[f32], want: usize) -> Vec<f32> {
    if input.is_empty() || want == 0 {
        return vec![0.0; want];
    }
    let step = input.len() as f32 / want as f32;
    (0..want)
        .map(|i| {
            let p = i as f32 * step;
            let a = p.floor() as usize;
            let b = (a + 1).min(input.len() - 1);
            let t = p - a as f32;
            input[a.min(input.len() - 1)] * (1.0 - t) + input[b] * t
        })
        .collect()
}

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

#[cfg(test)]
mod tests {
    use super::*;

    fn hiss(n: usize, amp: f32, seed: u32) -> Vec<f32> {
        let mut s = seed;
        (0..n)
            .map(|_| {
                s = s.wrapping_mul(1664525).wrapping_add(1013904223);
                (((s >> 16) as f32 / 32768.0) - 1.0) * amp
            })
            .collect()
    }

    /// Energy in the top half of the spectrum as a share of the whole. A rough
    /// but sufficient description of where a noise sits.
    fn brightness(v: &[f32]) -> f32 {
        let n = 2048.min(v.len().next_power_of_two() / 2).max(64);
        let mut re: Vec<f32> = v[..n.min(v.len())].to_vec();
        re.resize(n, 0.0);
        let mut im = vec![0f32; n];
        fft(&mut re, &mut im);
        let bins = n / 2;
        let mut lo = 0f32;
        let mut hi = 0f32;
        for k in 1..bins {
            let e = re[k] * re[k] + im[k] * im[k];
            if k < bins / 2 {
                lo += e;
            } else {
                hi += e;
            }
        }
        hi / (lo + hi + 1e-12)
    }

    fn rms_of(v: &[f32]) -> f32 {
        super::rms(v)
    }

    #[test]
    fn the_output_is_the_length_asked_for() {
        let src = hiss(44_100, 0.3, 7);
        for r in [0.5f32, 2.0, 8.0] {
            let out = morph_mono(&src, r, Morph::default());
            assert_eq!(out.len(), ((src.len() as f64) * r as f64).round() as usize);
        }
    }

    #[test]
    fn the_level_survives_the_stretch() {
        let src = hiss(44_100, 0.3, 7);
        let out = morph_mono(&src, 4.0, Morph::default());
        let a = rms_of(&src);
        let b = rms_of(&out[4096..out.len() - 4096]);
        assert!(
            (b / a) > 0.7 && (b / a) < 1.4,
            "level moved by {:.2}x ({a:.4} to {b:.4})",
            b / a
        );
    }

    /// The point of it. A noise's colour is what should survive, and only that.
    #[test]
    fn the_colour_of_the_noise_survives() {
        let mut dark = hiss(44_100, 0.3, 7);
        // One pole of lowpass, enough to make the two obviously different.
        let mut z = 0f32;
        for v in dark.iter_mut() {
            z += 0.05 * (*v - z);
            *v = z * 4.0;
        }
        let bright = hiss(44_100, 0.3, 11);

        let md = morph_mono(&dark, 4.0, Morph::default());
        let mb = morph_mono(&bright, 4.0, Morph::default());
        let (bd, bb) = (brightness(&md[8192..]), brightness(&mb[8192..]));
        assert!(bd < bb * 0.5, "the two noises came out alike: {bd:.3} against {bb:.3}");
    }

    /// The whole reason for the method: nothing in the output is a copy of
    /// anything else in it. Stretching noise the ordinary way leaves the source
    /// material repeated at the hop rate, which shows up as correlation between
    /// two windows a hop apart.
    #[test]
    fn nothing_in_the_output_repeats() {
        let src = hiss(20_000, 0.3, 7);
        let out = morph_mono(&src, 8.0, Morph::default());

        // Windows one source-length apart — where a repeat would land.
        let period = src.len();
        let a = &out[40_000..40_000 + 4096];
        let b = &out[40_000 + period..40_000 + period + 4096];
        let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
        let corr = dot / (rms_of(a) * rms_of(b) * 4096.0 + 1e-12);
        assert!(corr.abs() < 0.2, "the output repeats itself: correlation {corr:.3}");
    }

    /// Same seed, same audio — three separate renders have to agree.
    #[test]
    fn it_is_reproducible() {
        let src = hiss(20_000, 0.3, 7);
        let a = morph_mono(&src, 3.0, Morph::default());
        let b = morph_mono(&src, 3.0, Morph::default());
        assert_eq!(a, b);
    }

    #[test]
    fn silence_stays_silent() {
        let out = morph_mono(&vec![0f32; 20_000], 4.0, Morph::default());
        assert!(out.iter().all(|v| v.abs() < 1e-6), "silence grew a floor");
    }

    #[test]
    fn something_shorter_than_a_window_still_returns_the_right_length() {
        let src = hiss(500, 0.3, 7);
        let out = morph_mono(&src, 4.0, Morph::default());
        assert_eq!(out.len(), 2000);
    }
}
