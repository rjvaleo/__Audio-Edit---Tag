//! Three methods on three parts of the same sound.
//!
//! The other engines each pick one compromise and live with it. The vocoder is
//! right about a held chord and wrong about a snare; WSOLA is right about the
//! snare and smears the chord; both are wrong about hiss, which neither can
//! stretch without repeating. Every one of them is applying a single method to
//! material that is not one thing.
//!
//! So separate first. [`crate::decompose`] splits the input into partials,
//! attacks and everything else, and each part goes to the method that suits it:
//!
//! | Part | Method | Because |
//! |---|---|---|
//! | Harmonic | phase vocoder | partials keep their phase relationship |
//! | Percussive | WSOLA | an attack survives being placed, not interpolated |
//! | Residual | noise morphing | fresh noise shaped like the old, so nothing repeats |
//!
//! Then sum. The parts are a partition of the original spectrum, so at a ratio
//! of one the sum is the original — there is a test for it, and it is the check
//! that the routing has not quietly gained or lost a part.
//!
//! This is the most expensive engine here by a wide margin: two spectrogram
//! passes for the separation, then a vocoder, a WSOLA and a morph. But the
//! separation does not depend on the ratio — splitting a sound up is a property
//! of the sound, not of what is being done to it — so it happens once, off the
//! audio thread, and after that this engine runs in the callback like the rest.
//! See [`crate::hstream`].

use crate::decompose::Split;
use crate::stretch::Stretch;

/// What the hybrid engine does with each part.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HybridParams {
    /// FFT size for the separation. Longer separates a partial from its
    /// neighbours more cleanly and blurs the attacks it is trying to isolate.
    pub fft_size: u32,
    /// How long something must last to count as steady, in frames.
    pub time_span: u32,
    /// How broad something must be to count as an attack, in bins.
    pub freq_span: u32,
    /// How clearly one has to beat the other. One leaves no residual at all,
    /// so the noise morpher gets nothing and the engine becomes a two-way
    /// split — audibly different, and worth being able to hear.
    pub margin: f32,
    /// Rebuild the residual as fresh noise. Off, the residual is stretched
    /// with WSOLA like the attacks, which is what every other engine does to
    /// it and is the comparison worth having.
    pub morph_noise: bool,
    /// Level of each part in the sum. At one the parts add back to what came
    /// in; away from it the balance of a sound between its tone, its hits and
    /// its air can be set by hand, which no other engine here will do.
    pub harmonic_level: f32,
    pub percussive_level: f32,
    pub residual_level: f32,
}

impl Default for HybridParams {
    fn default() -> Self {
        HybridParams {
            fft_size: 2048,
            time_span: 17,
            freq_span: 17,
            margin: 2.0,
            morph_noise: true,
            harmonic_level: 1.0,
            percussive_level: 1.0,
            residual_level: 1.0,
        }
    }
}

impl HybridParams {
    pub fn is_clean(&self) -> bool {
        *self == HybridParams::default()
    }

    pub fn split(&self) -> Split {
        Split {
            fft_size: (self.fft_size as usize).clamp(256, 8192),
            time_span: (self.time_span as usize).clamp(3, 101),
            freq_span: (self.freq_span as usize).clamp(3, 101),
            margin: self.margin.clamp(1.0, 8.0),
        }
    }
}

/// Stretch `input` (interleaved) by `ratio`, each part its own way.
///
/// A loop over [`crate::hstream::HybridStream`], which is the same code the
/// audio callback runs — the last of the five engines to be arranged that way.
///
/// The separation happens first and once. It does not depend on the ratio at
/// all: splitting a sound into partials, attacks and everything else is a
/// property of the sound rather than of what is being done to it. That is what
/// makes this engine streamable, and it is also why dragging the stretch slider
/// on the hybrid costs what dragging it on the vocoder costs.
pub fn stretch(
    input: &[f32],
    channels: usize,
    sample_rate: u32,
    ratio: f32,
    spec: &Stretch,
    p: HybridParams,
) -> Vec<f32> {
    let channels = channels.max(1);
    let in_frames = input.len() / channels;
    let want = ((in_frames as f64) * ratio as f64).round() as usize;
    if in_frames == 0 || want == 0 {
        return vec![0.0; want * channels];
    }

    let parts = crate::hstream::Parts::separate(input, channels, p);
    let sp = crate::stream::StretchParams {
        ratio,
        window_ms: spec.window_ms,
        sample_rate,
        wsola: spec.wsola,
        vocoder: spec.vocoder,
        grain: spec.grain,
    };

    // Layered like the other four, so the shared grain controls reach this one
    // as well. The callback does not layer — see `crate::stream` — so at more
    // than one layer this path and live playback are different sounds; there is
    // a test pinning that until layering is either taught to the streaming
    // engines or dropped from them.
    let hop_l = crate::stretch::hop_frames(
        &spec.grain,
        crate::stretch::fft_size_for(spec.vocoder.window_ms, sample_rate),
        sample_rate.max(1) as f32,
    );
    crate::stretch::layered(&spec.grain, channels, hop_l, |g| {
        let mut sp = sp;
        sp.grain = *g;
        one(&parts, channels, sample_rate, ratio, spec, p, &sp, want)
    })
}

/// One layer of the hybrid: three engines on three parts, summed.
#[allow(clippy::too_many_arguments)]
fn one(
    parts: &crate::hstream::Parts,
    channels: usize,
    sample_rate: u32,
    ratio: f32,
    spec: &Stretch,
    p: HybridParams,
    sp: &crate::stream::StretchParams,
    want: usize,
) -> Vec<f32> {
    const CHUNK: usize = 1 << 16;
    let mut hs = crate::hstream::HybridStream::new(CHUNK, channels, sample_rate);
    // The attacks are stretched with transient preservation on, so they need a
    // map — derived from the percussive part rather than the whole sound, which
    // is the point of having separated it.
    let win = (((spec.window_ms.clamp(5.0, 2000.0) / 1000.0) * sample_rate.max(1) as f32) as usize)
        .max(64);
    let hop = crate::stretch::hop_frames(&sp.grain, win, sample_rate.max(1) as f32).max(1);
    let mut wp = spec.wsola;
    wp.preserve_transients = true;
    hs.set_map(crate::stream::WsolaStream::build_map(
        &parts.percussive,
        channels,
        sample_rate,
        ratio,
        hop,
        &wp,
    ));
    hs.seek(0, parts, sp, p);

    let mut out = vec![0.0; want * channels];
    let mut at = 0usize;
    while at < want {
        let take = CHUNK.min(want - at);
        hs.render(
            &mut out[at * channels..(at + take) * channels],
            channels,
            parts,
            sp,
            p,
        );
        at += take;
    }
    out
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::stretch::Algorithm;

    const SR: u32 = 44_100;

    fn spec() -> Stretch {
        Stretch { algorithm: Algorithm::Hybrid, ..Stretch::default() }
    }

    fn sine(freq: f32, n: usize, amp: f32) -> Vec<f32> {
        (0..n)
            .map(|i| amp * (std::f32::consts::TAU * freq * i as f32 / SR as f32).sin())
            .collect()
    }

    fn hiss(n: usize, amp: f32, seed: u32) -> Vec<f32> {
        let mut s = seed;
        (0..n)
            .map(|_| {
                s = s.wrapping_mul(1664525).wrapping_add(1013904223);
                (((s >> 16) as f32 / 32768.0) - 1.0) * amp
            })
            .collect()
    }

    fn mixed(n: usize) -> Vec<f32> {
        let tone = sine(440.0, n, 0.4);
        let air = hiss(n, 0.05, 3);
        let mut v: Vec<f32> = tone.iter().zip(&air).map(|(a, b)| a + b).collect();
        for &p in &[8000usize, 20000, 33000] {
            let mut s = 5u32;
            for i in 0..300 {
                if p + i >= n {
                    break;
                }
                s = s.wrapping_mul(1664525).wrapping_add(1013904223);
                let e = (1.0 - i as f32 / 300.0).powi(2);
                v[p + i] += (((s >> 16) as f32 / 32768.0) - 1.0) * e * 0.7;
            }
        }
        v
    }

    fn rms(v: &[f32]) -> f32 {
        if v.is_empty() {
            return 0.0;
        }
        (v.iter().map(|x| x * x).sum::<f32>() / v.len() as f32).sqrt()
    }

    #[test]
    fn the_output_is_the_length_asked_for() {
        let src = mixed(44_100);
        for r in [0.5f32, 2.0, 6.0] {
            let out = stretch(&src, 1, SR, r, &spec(), HybridParams::default());
            assert_eq!(out.len(), ((src.len() as f64) * r as f64).round() as usize);
        }
    }

    #[test]
    fn stereo_stays_interleaved_and_the_right_length() {
        let mono = mixed(20_000);
        let mut st = Vec::with_capacity(mono.len() * 2);
        for &v in &mono {
            st.push(v);
            st.push(v * 0.5);
        }
        let out = stretch(&st, 2, SR, 3.0, &spec(), HybridParams::default());
        assert_eq!(out.len(), 60_000 * 2);
    }

    #[test]
    fn the_level_survives_a_long_stretch() {
        let src = mixed(44_100);
        let out = stretch(&src, 1, SR, 6.0, &spec(), HybridParams::default());
        let a = rms(&src);
        let b = rms(&out[8192..out.len() - 8192]);
        assert!((b / a) > 0.5 && (b / a) < 2.0, "level moved by {:.2}x", b / a);
    }

    #[test]
    fn nothing_leaves_the_range() {
        let src = mixed(44_100);
        let out = stretch(&src, 1, SR, 8.0, &spec(), HybridParams::default());
        let peak = out.iter().fold(0f32, |m, v| m.max(v.abs()));
        assert!(peak < 4.0, "the output ran away: peak {peak:.2}");
        assert!(out.iter().all(|v| v.is_finite()), "the output has non-finite samples");
    }

    /// The three levels are the reason to reach for this engine over the
    /// others: it is the only one that can turn a sound's air down without
    /// touching its tone.
    #[test]
    fn the_part_levels_reach_the_audio() {
        let src = mixed(44_100);
        let all = stretch(&src, 1, SR, 2.0, &spec(), HybridParams::default());
        let no_air = stretch(
            &src,
            1,
            SR,
            2.0,
            &spec(),
            HybridParams { residual_level: 0.0, ..HybridParams::default() },
        );
        assert!(rms(&no_air) < rms(&all), "muting the residual changed nothing");

        let no_tone = stretch(
            &src,
            1,
            SR,
            2.0,
            &spec(),
            HybridParams { harmonic_level: 0.0, ..HybridParams::default() },
        );
        assert!(
            rms(&no_tone) < rms(&all) * 0.6,
            "muting the harmonic part barely moved the level: {:.4} against {:.4}",
            rms(&no_tone),
            rms(&all)
        );
    }

    /// Turning the morph off has to be audible, or the switch is decoration.
    #[test]
    fn the_noise_switch_reaches_the_audio() {
        let src = mixed(20_000);
        let a = stretch(&src, 1, SR, 4.0, &spec(), HybridParams::default());
        let b = stretch(
            &src,
            1,
            SR,
            4.0,
            &spec(),
            HybridParams { morph_noise: false, ..HybridParams::default() },
        );
        let diff: f32 = a.iter().zip(&b).map(|(x, y)| (x - y).abs()).sum();
        assert!(diff > 1.0, "the noise switch did nothing: total difference {diff:.4}");
    }

    #[test]
    fn a_margin_of_one_still_produces_audio() {
        let src = mixed(20_000);
        let out = stretch(
            &src,
            1,
            SR,
            3.0,
            &spec(),
            HybridParams { margin: 1.0, ..HybridParams::default() },
        );
        assert_eq!(out.len(), 60_000);
        assert!(rms(&out) > 1e-4, "a two-way split produced silence");
    }

    #[test]
    fn silence_stretches_to_silence() {
        let out = stretch(&vec![0f32; 20_000], 1, SR, 4.0, &spec(), HybridParams::default());
        assert!(out.iter().all(|v| v.abs() < 1e-5));
    }

    #[test]
    fn something_too_short_to_separate_still_returns_the_right_length() {
        let src = sine(440.0, 400, 0.5);
        let out = stretch(&src, 1, SR, 4.0, &spec(), HybridParams::default());
        assert_eq!(out.len(), 1600);
    }
}
