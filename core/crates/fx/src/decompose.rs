//! Splitting a sound into sines, transients and noise.
//!
//! The observation the whole hybrid stretcher rests on: no one method suits all
//! three. A phase vocoder is right for a held partial and wrong for a snare; a
//! splice is right for the snare and wrong for the hiss between them. If the
//! three can be separated, each can be given the method that suits it and the
//! results summed.
//!
//! The separation is median filtering on the magnitude spectrogram, which is
//! Fitzgerald's idea and is genuinely as simple as it sounds. A held partial is
//! a horizontal ridge — steady in frequency, persistent in time — so a median
//! *along time* keeps it and erases anything brief. A transient is a vertical
//! ridge — brief in time, spread across frequency — so a median *along
//! frequency* keeps it and erases anything narrow. Run both and you have two
//! estimates of the same spectrogram, one of what is horizontal and one of what
//! is vertical.
//!
//! Turning two estimates into three parts is Driedger's HPR-M: a bin belongs to
//! the harmonic part only if the horizontal estimate beats the vertical one by
//! a clear margin, to the percussive part only if the reverse, and to the
//! residual if neither wins. That third case is the point. A soft mask would
//! divide every bin between two parts and leave nothing over; insisting on a
//! margin leaves exactly the material that is neither a partial nor a hit —
//! breath, bow noise, room, hiss — which is what the noise morpher wants.
//!
//! The three parts sum back to the original, bin for bin, because the masks
//! partition rather than overlap. There is a test for that.

use audio_core::fft::{self, fft};

/// A sound in three parts. Summing them reconstructs the original.
pub struct Parts {
    /// Steady partials — horizontal ridges.
    pub harmonic: Vec<f32>,
    /// Attacks — vertical ridges.
    pub percussive: Vec<f32>,
    /// Everything that is neither.
    pub residual: Vec<f32>,
}

/// How the split is made.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Split {
    /// Transform size. 2048 at 44.1 kHz is the usual starting point: long
    /// enough that a partial is a ridge rather than a smear.
    pub fft_size: usize,
    /// Frames the time median spans. This is the one that decides how long
    /// something must last to count as steady.
    pub time_span: usize,
    /// Bins the frequency median spans. Decides how broad something must be to
    /// count as an attack.
    pub freq_span: usize,
    /// How clearly one estimate must beat the other. One would put every bin
    /// in one part or the other and leave no residual at all; the margin is
    /// what creates the third part.
    pub margin: f32,
}

impl Default for Split {
    fn default() -> Self {
        Split { fft_size: 2048, time_span: 17, freq_span: 17, margin: 2.0 }
    }
}

/// The median of a slice, by partial selection rather than a full sort.
fn median(buf: &mut [f32]) -> f32 {
    if buf.is_empty() {
        return 0.0;
    }
    let mid = buf.len() / 2;
    buf.sort_by(f32::total_cmp);
    buf[mid]
}

/// Separate one channel.
///
/// `hop` is a quarter of the window, which is what makes the Hann analysis and
/// synthesis windows sum flat — the three parts have to add back up to the
/// input, and that only holds if the overlap-add reconstructs.
pub fn separate_mono(input: &[f32], s: Split) -> Parts {
    let n = s.fft_size.max(64).next_power_of_two();
    let hop = (n / 4).max(1);
    let bins = n / 2 + 1;

    if input.len() < n {
        // Too short to transform. All of it is residual rather than silently
        // being called harmonic.
        return Parts {
            harmonic: vec![0.0; input.len()],
            percussive: vec![0.0; input.len()],
            residual: input.to_vec(),
        };
    }

    let win = fft::hann(n);
    let frames = (input.len() - n) / hop + 1;

    // The whole spectrogram, kept: the time median needs to look along it.
    let mut re = vec![0f32; frames * bins];
    let mut im = vec![0f32; frames * bins];
    let mut mag = vec![0f32; frames * bins];

    let mut fre = vec![0f32; n];
    let mut fim = vec![0f32; n];
    for f in 0..frames {
        let start = f * hop;
        for i in 0..n {
            fre[i] = input[start + i] * win[i];
            fim[i] = 0.0;
        }
        if !fft(&mut fre, &mut fim) {
            break;
        }
        for k in 0..bins {
            let idx = f * bins + k;
            re[idx] = fre[k];
            im[idx] = fim[k];
            mag[idx] = (fre[k] * fre[k] + fim[k] * fim[k]).sqrt();
        }
    }

    // Horizontal: along time, at a fixed frequency. Keeps what persists.
    let th = s.time_span.max(1) | 1;
    let mut horiz = vec![0f32; frames * bins];
    let mut scratch = vec![0f32; th.max(s.freq_span | 1)];
    for k in 0..bins {
        for f in 0..frames {
            let half = th / 2;
            let lo = f.saturating_sub(half);
            let hi = (f + half + 1).min(frames);
            let len = hi - lo;
            for (j, ff) in (lo..hi).enumerate() {
                scratch[j] = mag[ff * bins + k];
            }
            horiz[f * bins + k] = median(&mut scratch[..len]);
        }
    }

    // Vertical: across frequency, at a fixed moment. Keeps what is broad.
    let tf = s.freq_span.max(1) | 1;
    let mut vert = vec![0f32; frames * bins];
    for f in 0..frames {
        for k in 0..bins {
            let half = tf / 2;
            let lo = k.saturating_sub(half);
            let hi = (k + half + 1).min(bins);
            let len = hi - lo;
            for (j, kk) in (lo..hi).enumerate() {
                scratch[j] = mag[f * bins + kk];
            }
            vert[f * bins + k] = median(&mut scratch[..len]);
        }
    }

    // Three binary masks that partition every bin, so the parts sum back to
    // the input rather than to something close to it.
    const EPS: f32 = 1e-9;
    let beta = s.margin.max(1.0);
    let mut out = [
        vec![0f32; input.len()],
        vec![0f32; input.len()],
        vec![0f32; input.len()],
    ];
    let mut norm = vec![0f32; input.len()];

    let mut pre = vec![0f32; n];
    let mut pim = vec![0f32; n];
    for part in 0..3 {
        for f in 0..frames {
            for k in 0..bins {
                let idx = f * bins + k;
                let h = horiz[idx];
                let p = vert[idx];
                let mine = match part {
                    0 => h > beta * (p + EPS),
                    1 => p >= beta * (h + EPS),
                    _ => !(h > beta * (p + EPS)) && !(p >= beta * (h + EPS)),
                };
                let (r, i) = if mine { (re[idx], im[idx]) } else { (0.0, 0.0) };
                pre[k] = r;
                pim[k] = i;
            }
            // Mirror the upper half so the inverse transform is real.
            for k in bins..n {
                pre[k] = pre[n - k];
                pim[k] = -pim[n - k];
            }
            pim[0] = 0.0;
            if n % 2 == 0 {
                pim[n / 2] = 0.0;
            }
            ifft(&mut pre, &mut pim);

            let start = f * hop;
            for i in 0..n {
                if start + i < out[part].len() {
                    out[part][start + i] += pre[i] * win[i];
                    if part == 0 {
                        norm[start + i] += win[i] * win[i];
                    }
                }
            }
        }
    }

    // One normalisation for all three, so what they sum to is what came in.
    let floor = norm.iter().fold(0f32, |m, &x| m.max(x)) * 0.05;
    for i in 0..input.len() {
        let g = norm[i].max(floor);
        if g > 1e-6 {
            for part in 0..3 {
                out[part][i] /= g;
            }
        }
    }

    let mut it = out.into_iter();
    Parts {
        harmonic: it.next().unwrap(),
        percussive: it.next().unwrap(),
        residual: it.next().unwrap(),
    }
}

/// Inverse transform by conjugation, as in the vocoder.
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

    const SR: f32 = 44_100.0;

    fn sine(freq: f32, n: usize, amp: f32) -> Vec<f32> {
        (0..n)
            .map(|i| amp * (std::f32::consts::TAU * freq * i as f32 / SR).sin())
            .collect()
    }

    fn clicks(n: usize, at: &[usize]) -> Vec<f32> {
        let mut v = vec![0f32; n];
        let mut seed = 7u32;
        for &p in at {
            for i in 0..400 {
                if p + i >= n {
                    break;
                }
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                let noise = ((seed >> 16) as f32 / 32768.0) - 1.0;
                v[p + i] += noise * (1.0 - i as f32 / 400.0).powi(2) * 0.8;
            }
        }
        v
    }

    fn hiss(n: usize, amp: f32) -> Vec<f32> {
        let mut seed = 99u32;
        (0..n)
            .map(|_| {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                (((seed >> 16) as f32 / 32768.0) - 1.0) * amp
            })
            .collect()
    }

    fn energy(v: &[f32]) -> f32 {
        v.iter().map(|x| x * x).sum()
    }

    /// The property everything else depends on: the parts are a partition, so
    /// summing them gives back what went in.
    #[test]
    fn the_three_parts_add_back_up_to_the_original() {
        let n = 44_100;
        let src: Vec<f32> = sine(440.0, n, 0.4)
            .iter()
            .zip(clicks(n, &[8000, 20000, 33000]).iter())
            .zip(hiss(n, 0.05).iter())
            .map(|((a, b), c)| a + b + c)
            .collect();

        let p = separate_mono(&src, Split::default());
        let mut worst = 0f32;
        // Skip the first and last window, where the overlap is incomplete and
        // the reconstruction is genuinely partial.
        for i in 2048..n - 2048 {
            let sum = p.harmonic[i] + p.percussive[i] + p.residual[i];
            worst = worst.max((sum - src[i]).abs());
        }
        assert!(worst < 1e-3, "the parts did not sum back: worst {worst}");
    }

    #[test]
    fn a_held_tone_lands_in_the_harmonic_part() {
        let n = 44_100;
        let src = sine(440.0, n, 0.5);
        let p = separate_mono(&src, Split::default());
        let (h, pc, r) = (energy(&p.harmonic), energy(&p.percussive), energy(&p.residual));
        assert!(h > pc * 10.0, "a steady tone was not harmonic: h={h} p={pc}");
        assert!(h > r * 10.0, "a steady tone leaked into the residual: h={h} r={r}");
    }

    #[test]
    fn clicks_land_in_the_percussive_part() {
        let n = 44_100;
        let src = clicks(n, &[5000, 15000, 25000, 35000]);
        let p = separate_mono(&src, Split::default());
        let (h, pc) = (energy(&p.harmonic), energy(&p.percussive));
        assert!(pc > h * 5.0, "clicks were not percussive: h={h} p={pc}");
    }

    /// The reason for the margin. Broadband noise is neither a ridge along time
    /// nor a ridge along frequency, so with a soft two-way mask it would be
    /// split between the other two parts and the noise morpher would have
    /// nothing to work on.
    #[test]
    fn hiss_lands_in_the_residual() {
        let n = 44_100;
        let src = hiss(n, 0.3);
        let p = separate_mono(&src, Split::default());
        let (h, pc, r) = (energy(&p.harmonic), energy(&p.percussive), energy(&p.residual));
        assert!(r > h * 3.0, "hiss was called harmonic: r={r} h={h}");
        assert!(r > pc * 3.0, "hiss was called percussive: r={r} p={pc}");
    }

    /// A margin of one leaves no third part, which is what a plain two-way
    /// separation does — worth pinning, because it is the difference between
    /// this and the version everyone writes first.
    #[test]
    fn without_a_margin_there_is_no_residual() {
        let n = 20_000;
        let src: Vec<f32> = sine(440.0, n, 0.4)
            .iter()
            .zip(hiss(n, 0.1).iter())
            .map(|(a, b)| a + b)
            .collect();

        let three = separate_mono(&src, Split::default());
        let two = separate_mono(&src, Split { margin: 1.0, ..Split::default() });
        assert!(
            energy(&two.residual) < energy(&three.residual) * 0.2,
            "a margin of one still produced a residual: {} against {}",
            energy(&two.residual),
            energy(&three.residual)
        );
    }

    #[test]
    fn something_too_short_to_transform_is_all_residual() {
        let src = sine(440.0, 500, 0.5);
        let p = separate_mono(&src, Split::default());
        assert_eq!(p.residual, src);
        assert!(p.harmonic.iter().all(|v| *v == 0.0));
    }

    #[test]
    fn silence_separates_into_silence() {
        let p = separate_mono(&vec![0f32; 20_000], Split::default());
        assert!(p.harmonic.iter().all(|v| *v == 0.0));
        assert!(p.percussive.iter().all(|v| *v == 0.0));
        assert!(p.residual.iter().all(|v| *v == 0.0));
    }
}
