//! Getting audio into the shape the model was trained on: 16 kHz, mono.
//!
//! The band-limiting matters more than it looks. Going from 48 kHz to 16 kHz
//! discards everything above 8 kHz, and content above that line does not
//! politely vanish — it folds back down as an alias. A hi-hat, whose energy is
//! mostly above 8 kHz, would arrive at the model as a spray of phantom
//! mid-range noise, and the model would then put a confident name to something
//! that was never in the file.
//!
//! The playback engine's `resample` is plain linear interpolation, which is
//! right for its job and wrong for this one: it does no filtering at all. So
//! this is a separate windowed-sinc pass rather than a reuse of that. There is
//! a test below that feeds in a 12 kHz tone and insists the 4 kHz alias it
//! would otherwise produce is not there.

use std::f64::consts::PI;

/// What YAMNet was trained at. Not negotiable.
pub const RATE: u32 = 16_000;

/// How many sinc zero-crossings either side of centre. Wider is sharper and
/// slower; 16 puts the stopband well below anything the model will notice.
const ZEROS: f64 = 16.0;

/// Mix to mono and resample to 16 kHz.
pub fn to_mono_16k(interleaved: &[f32], channels: usize, from: u32) -> Vec<f32> {
    let channels = channels.max(1);
    let frames = interleaved.len() / channels;

    // Sum to mono: what a sound *is* does not depend on where it sits in the
    // stereo field, and the model has one input channel regardless.
    let mut mono = Vec::with_capacity(frames);
    for f in 0..frames {
        let mut s = 0.0f32;
        for ch in 0..channels {
            s += interleaved[f * channels + ch];
        }
        mono.push(s / channels as f32);
    }

    resample(&mono, from, RATE)
}

fn sinc(x: f64) -> f64 {
    if x.abs() < 1e-9 {
        1.0
    } else {
        let p = PI * x;
        p.sin() / p
    }
}

/// Band-limited resample of a mono signal.
pub fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == 0 || to == 0 || input.is_empty() || from == to {
        return input.to_vec();
    }
    let ratio = to as f64 / from as f64;

    // Cutoff in cycles per input sample. When downsampling, the limit is the
    // *output* Nyquist, not the input's — that is the whole point. The 0.92
    // leaves a little transition room so the corner is not sitting exactly on
    // the fold-over frequency.
    let cutoff = 0.5f64.min(0.5 * ratio) * 0.92;
    let half = (ZEROS / (2.0 * cutoff)).ceil() as isize;

    let out_len = ((input.len() as f64) * ratio).round() as usize;
    let last = input.len() as isize - 1;
    let mut out = Vec::with_capacity(out_len);

    for f in 0..out_len {
        let centre = f as f64 / ratio;
        let base = centre.floor() as isize;
        let (mut acc, mut norm) = (0.0f64, 0.0f64);

        for i in (base - half)..=(base + half) {
            let d = i as f64 - centre;
            let w = d / half as f64;
            if w.abs() > 1.0 {
                continue;
            }
            // Blackman: a low sidelobe matters here, since a sidelobe is
            // exactly the leakage that becomes an alias.
            let t = PI * w;
            let win = 0.42 + 0.5 * t.cos() + 0.08 * (2.0 * t).cos();
            let tap = sinc(2.0 * cutoff * d) * win;

            // Clamping at the edges repeats the end sample rather than
            // treating the file as if silence surrounded it, which would put a
            // click at both ends of every sound.
            let idx = i.clamp(0, last) as usize;
            acc += input[idx] as f64 * tap;
            norm += tap;
        }

        // Normalising by the tap sum pins the DC gain at exactly one, so a
        // resampled sound is neither quieter nor louder than it was.
        out.push(if norm.abs() > 1e-12 { (acc / norm) as f32 } else { 0.0 });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(freq: f32, secs: f32, rate: u32) -> Vec<f32> {
        let n = (secs * rate as f32) as usize;
        (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / rate as f32).sin())
            .collect()
    }

    /// Energy near `freq`, by direct correlation. Avoids depending on an FFT
    /// length lining up with the tone.
    fn energy_at(sig: &[f32], freq: f32, rate: u32) -> f32 {
        let (mut re, mut im) = (0.0f64, 0.0f64);
        for (i, s) in sig.iter().enumerate() {
            let p = 2.0 * std::f64::consts::PI * freq as f64 * i as f64 / rate as f64;
            re += *s as f64 * p.cos();
            im += *s as f64 * p.sin();
        }
        ((re * re + im * im).sqrt() / sig.len() as f64) as f32
    }

    #[test]
    fn a_tone_below_the_new_nyquist_survives_at_the_same_level() {
        let src = tone(1000.0, 0.5, 48_000);
        let out = resample(&src, 48_000, 16_000);
        let before = energy_at(&src, 1000.0, 48_000);
        let after = energy_at(&out, 1000.0, 16_000);
        assert!(
            (after / before - 1.0).abs() < 0.05,
            "1 kHz should pass through untouched: {before} -> {after}"
        );
    }

    /// The test this module exists for.
    ///
    /// 12 kHz cannot be represented at 16 kHz. Resampled honestly it should be
    /// filtered away; resampled naively it reappears at |12000 - 16000| =
    /// 4 kHz, and the model is then looking at a sound that was never played.
    #[test]
    fn content_above_the_new_nyquist_does_not_fold_back_as_an_alias() {
        let src = tone(12_000.0, 0.5, 48_000);
        let out = resample(&src, 48_000, 16_000);

        let alias = energy_at(&out, 4_000.0, 16_000);
        let reference = energy_at(&tone(4_000.0, 0.5, 16_000), 4_000.0, 16_000);
        assert!(
            alias < reference * 0.01,
            "12 kHz folded back to 4 kHz at {alias} against a real tone's {reference}"
        );
    }

    /// Proof that the previous test is measuring something real: the naive
    /// method this module deliberately avoids does fail it.
    #[test]
    fn linear_interpolation_would_have_folded_it_back() {
        let src = tone(12_000.0, 0.5, 48_000);
        let naive: Vec<f32> = (0..src.len() / 3).map(|i| src[i * 3]).collect();
        let alias = energy_at(&naive, 4_000.0, 16_000);
        let reference = energy_at(&tone(4_000.0, 0.5, 16_000), 4_000.0, 16_000);
        assert!(
            alias > reference * 0.5,
            "expected the naive path to alias badly, got {alias} vs {reference}"
        );
    }

    #[test]
    fn length_follows_the_rate_ratio() {
        let src = vec![0.0f32; 48_000];
        assert_eq!(resample(&src, 48_000, 16_000).len(), 16_000);
        assert_eq!(resample(&src, 48_000, 48_000).len(), 48_000);
    }

    #[test]
    fn stereo_is_summed_to_one_channel() {
        // Left and right in antiphase cancel; that is what summing means.
        let n = 16_000;
        let mut inter = Vec::with_capacity(n * 2);
        for i in 0..n {
            let v = (i as f32 * 0.01).sin();
            inter.push(v);
            inter.push(-v);
        }
        let out = to_mono_16k(&inter, 2, RATE);
        assert!(out.iter().all(|s| s.abs() < 1e-6), "antiphase should cancel");
    }

    #[test]
    fn a_mono_file_already_at_the_right_rate_is_passed_through() {
        let src = tone(440.0, 0.1, RATE);
        let out = to_mono_16k(&src, 1, RATE);
        assert_eq!(out.len(), src.len());
        for (a, b) in src.iter().zip(&out) {
            assert!((a - b).abs() < 1e-6);
        }
    }

    #[test]
    fn upsampling_preserves_the_tone_too() {
        let src = tone(1000.0, 0.2, 8_000);
        let out = resample(&src, 8_000, 16_000);
        assert_eq!(out.len(), 3200);
        let before = energy_at(&src, 1000.0, 8_000);
        let after = energy_at(&out, 1000.0, 16_000);
        assert!((after / before - 1.0).abs() < 0.05, "{before} -> {after}");
    }

    #[test]
    fn silence_and_emptiness_are_handled_without_panicking() {
        assert!(resample(&[], 48_000, 16_000).is_empty());
        assert!(resample(&[0.0; 100], 0, 16_000).len() == 100);
        assert!(to_mono_16k(&[], 0, 48_000).is_empty());
    }
}
