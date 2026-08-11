//! Finding the moments a stretcher must not touch.
//!
//! WSOLA's worst artefact is stuttering: a drum hit lands inside two
//! overlapping windows, so it is laid down twice and you hear it flam. The cure
//! is not a better splice — it is to stop stretching for a moment. Hold the
//! transient at its original rate and let the material either side absorb the
//! difference.
//!
//! Which means the whole thing turns on knowing where the transients are, and
//! Driedger is specific about which ones matter (chapter 6, and the honest
//! section 6.4 on limits): not every transient stutters. A violin's onsets are
//! usually fine. What causes it is *a short, noise-like burst of energy* — a
//! drum, a cymbal, the percussive front of a piano note.
//!
//! So this measures the rise in energy across the spectrum rather than in the
//! waveform. An amplitude envelope cannot tell a fast crescendo from a snare;
//! the spectrum can, because a snare puts new energy into bands that had none a
//! moment ago. That is spectral flux, and it is the reason this does not simply
//! reuse the envelope-based onset counter in the `search` crate — that one was
//! built to describe how busy a sound is, not to place a cut to the sample.

use audio_core::fft::{fft, hann};

/// How close two transients may be before they are treated as one event.
///
/// Below about 50 ms the ear hears a single articulation rather than two, and
/// protecting them separately would leave no room between the guard regions for
/// the rest of the signal to stretch into.
const MIN_GAP_MS: f32 = 50.0;

/// Onset positions in frames, for a signal that may be multichannel.
///
/// `sensitivity` runs 0..1: zero finds only the most violent events, one takes
/// nearly every rise. The threshold is relative to a running median rather than
/// absolute, so a quiet recording and a loud one behave the same.
/// `floor_scale` multiplies the absolute floor. One is the tuned value; zero
/// removes the floor entirely and leaves only the local median, which is what
/// the detector did before the floor was added — it fires on numerical ripple
/// through a held tone, roughly every fifty milliseconds. That was a bug when
/// it was accidental. Exposed deliberately it is a rhythmic gate.
pub fn onsets(
    input: &[f32],
    channels: usize,
    sample_rate: u32,
    sensitivity: f32,
    floor_scale: f32,
) -> Vec<usize> {
    let channels = channels.max(1);
    let frames = input.len() / channels;
    let sr = sample_rate.max(1) as f32;

    const N: usize = 1024;
    const HOP: usize = 256;
    if frames < N * 2 {
        return Vec::new();
    }

    let win = hann(N);
    let bins = N / 2 + 1;
    let mut re = vec![0f32; N];
    let mut im = vec![0f32; N];
    let mut prev = vec![0f32; bins];
    let mut flux: Vec<f32> = Vec::with_capacity(frames / HOP + 1);

    let mut at = 0usize;
    while at + N <= frames {
        for i in 0..N {
            // Mono sum: an onset is an event in the performance, not in one
            // channel, and a hit panned hard left is still a hit.
            let mut s = 0.0;
            for ch in 0..channels {
                s += input[(at + i) * channels + ch];
            }
            re[i] = (s / channels as f32) * win[i];
            im[i] = 0.0;
        }
        if !fft(&mut re, &mut im) {
            break;
        }

        // Half-wave rectified flux: only *rises* count. Energy leaving a band
        // is a note ending, which never stutters.
        let mut sum = 0.0;
        for k in 0..bins {
            let m = (re[k] * re[k] + im[k] * im[k]).sqrt();
            let d = m - prev[k];
            if d > 0.0 {
                sum += d;
            }
            prev[k] = m;
        }
        flux.push(sum);
        at += HOP;
    }
    if flux.len() < 8 {
        return Vec::new();
    }

    // Threshold against a local median. A fixed threshold picks everything in a
    // loud passage and nothing in a quiet one; the median tracks the material.
    let sens = sensitivity.clamp(0.0, 1.0);
    let span = 12usize;
    let margin = 2.4 - 1.9 * sens; // 2.4× the median at 0, 0.5× at 1
    let min_gap = ((MIN_GAP_MS / 1000.0) * sr) as usize;

    // A local median on its own is not enough. On a steady tone the flux is
    // numerical ripple — tiny, but so is its median, so ripple clears a purely
    // relative bar and the detector fires every fifty milliseconds through a
    // held note. An absolute floor, taken as a share of the largest rise in the
    // whole signal, is what separates "a rise against its neighbours" from "a
    // rise worth stopping the stretcher for".
    let peak = flux.iter().copied().fold(0.0f32, f32::max);
    let floor = peak * (0.28 - 0.22 * sens) * floor_scale.clamp(0.0, 2.0);

    let mut hits: Vec<usize> = Vec::new();
    let mut scratch: Vec<f32> = Vec::with_capacity(span * 2 + 1);
    for i in 1..flux.len() - 1 {
        // A peak, or it is the shoulder of one already found.
        if flux[i] < flux[i - 1] || flux[i] < flux[i + 1] {
            continue;
        }
        let lo = i.saturating_sub(span);
        let hi = (i + span + 1).min(flux.len());
        scratch.clear();
        scratch.extend_from_slice(&flux[lo..hi]);
        scratch.sort_by(f32::total_cmp);
        let median = scratch[scratch.len() / 2];
        if flux[i] < floor || median <= 1e-9 || flux[i] < median * margin {
            continue;
        }

        let frame = i * HOP;
        match hits.last() {
            Some(&last) if frame.saturating_sub(last) < min_gap => {}
            _ => hits.push(frame),
        }
    }
    hits
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A quiet tone with sharp noise bursts dropped into it — the exact case
    /// the thesis describes as artefact-causing.
    fn with_bursts(rate: u32, secs: f32, at: &[f32]) -> Vec<f32> {
        let n = (secs * rate as f32) as usize;
        let mut v: Vec<f32> = (0..n)
            .map(|i| (std::f32::consts::TAU * 220.0 * i as f32 / rate as f32).sin() * 0.15)
            .collect();
        let mut seed = 12345u32;
        for t in at {
            let start = (*t * rate as f32) as usize;
            for i in 0..(rate as usize / 100) {
                if start + i >= n {
                    break;
                }
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                let noise = ((seed >> 16) as f32 / 32768.0) - 1.0;
                // A short burst with a fast decay, like a hit.
                let env = (1.0 - i as f32 / (rate as f32 / 100.0)).max(0.0).powi(2);
                v[start + i] += noise * env * 0.9;
            }
        }
        v
    }

    #[test]
    fn bursts_are_found_where_they_were_put() {
        let rate = 44_100;
        let places = [0.5f32, 1.0, 1.5, 2.0];
        let sig = with_bursts(rate, 2.5, &places);
        let found = onsets(&sig, 1, rate, 0.5, 1.0);

        assert!(!found.is_empty(), "found nothing");
        for p in places {
            let want = (p * rate as f32) as usize;
            let near = found.iter().any(|f| (*f as isize - want as isize).abs() < rate as isize / 20);
            assert!(near, "missed the burst at {p}s; found {found:?}");
        }
    }

    #[test]
    fn a_steady_tone_has_no_transients() {
        let rate = 44_100;
        let n = (2.0 * rate as f32) as usize;
        let sig: Vec<f32> = (0..n)
            .map(|i| (std::f32::consts::TAU * 440.0 * i as f32 / rate as f32).sin())
            .collect();
        let found = onsets(&sig, 1, rate, 0.5, 1.0);
        // The tone's own start is fair game; nothing after it should fire.
        assert!(found.iter().filter(|f| **f > rate as usize / 4).count() == 0, "{found:?}");
    }

    /// Bursts whose amplitude climbs from barely-there to obvious.
    ///
    /// Uniform bursts cannot test a threshold. They all sit far above it, so
    /// every setting finds the same ones and a dead control passes. This needs
    /// hits sitting *near* the bar, which is the only place moving the bar
    /// shows up.
    fn graded_bursts(rate: u32, secs: f32, count: usize) -> Vec<f32> {
        let n = (secs * rate as f32) as usize;
        let mut v: Vec<f32> = (0..n)
            .map(|i| (std::f32::consts::TAU * 220.0 * i as f32 / rate as f32).sin() * 0.12)
            .collect();
        let mut seed = 7u32;
        for b in 0..count {
            let at = (n / (count + 1)) * (b + 1);
            let amp = 0.02 + 0.9 * (b as f32 / (count - 1).max(1) as f32).powi(2);
            for i in 0..600 {
                if at + i >= n {
                    break;
                }
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                let noise = ((seed >> 16) as f32 / 32768.0) - 1.0;
                v[at + i] += noise * (1.0 - i as f32 / 600.0).powi(2) * amp;
            }
        }
        v
    }

    /// This used to assert only that a looser setting found *no fewer* onsets,
    /// which is true of a control that does nothing at all — and on uniform
    /// bursts that is exactly what it was measuring.
    #[test]
    fn sensitivity_opens_the_gate() {
        let rate = 44_100;
        let sig = graded_bursts(rate, 2.0, 12);
        let strict = onsets(&sig, 1, rate, 0.0, 1.0).len();
        let loose = onsets(&sig, 1, rate, 1.0, 1.0).len();
        assert!(loose > strict, "loose {loose} found no more than strict {strict}");
    }

    #[test]
    fn two_hits_inside_the_same_breath_count_once() {
        let rate = 44_100;
        // 10 ms apart — one articulation, not two.
        let sig = with_bursts(rate, 1.0, &[0.5, 0.51]);
        let found = onsets(&sig, 1, rate, 0.5, 1.0);
        let near: Vec<_> = found
            .iter()
            .filter(|f| (**f as f32 / rate as f32 - 0.5).abs() < 0.1)
            .collect();
        assert!(near.len() <= 1, "collapsed to {near:?}");
    }

    #[test]
    fn silence_and_scraps_are_handled_without_panicking() {
        assert!(onsets(&[], 1, 44_100, 0.5, 1.0).is_empty());
        assert!(onsets(&vec![0f32; 100], 1, 44_100, 0.5, 1.0).is_empty());
        assert!(onsets(&vec![0f32; 44_100], 2, 44_100, 0.5, 1.0).is_empty());
    }
}

/// A piecewise-linear map from output time back to input time.
///
/// Driedger's anchor points (section 6.1): a list of pairs saying "this instant
/// in the input belongs at that instant in the output", with linear
/// interpolation between them. A constant stretch is just two anchors, start and
/// end; preserving a transient is four more around it.
#[derive(Debug, Clone)]
pub struct TimeMap {
    /// (input, output) pairs, ascending in both.
    anchors: Vec<(f64, f64)>,
}

impl TimeMap {
    /// A constant stretch — the two-anchor case.
    pub fn linear(in_frames: usize, ratio: f32) -> Self {
        let n = in_frames as f64;
        TimeMap { anchors: vec![(0.0, 0.0), (n, n * ratio as f64)] }
    }

    /// A stretch that leaves each transient alone.
    ///
    /// Around every onset, two anchors are placed `guard` frames either side and
    /// offset equally in input and output, which makes the local slope exactly
    /// one — that stretch of signal passes through at its original rate. Because
    /// both anchors sit on the original straight line, the total length is
    /// unchanged; the segments in between simply have to stretch further to
    /// cover the same ground, which is precisely the compensation the thesis
    /// describes.
    ///
    /// An onset whose guard would collide with its neighbour's is dropped
    /// rather than shrunk: two protected regions that meet leave nothing
    /// between them to absorb the difference, and the arithmetic would demand a
    /// segment stretch of infinity.
    pub fn with_transients(
        in_frames: usize,
        ratio: f32,
        onsets: &[usize],
        guard: usize,
    ) -> Self {
        let n = in_frames as f64;
        let r = ratio as f64;
        let g = guard as f64;
        let mut anchors: Vec<(f64, f64)> = vec![(0.0, 0.0)];

        // Enough room either side for the guard, and for the segment between
        // this onset and the last to still have somewhere to go.
        let mut last_end = 0.0f64;
        for &p in onsets {
            let p = p as f64;
            let (a, b) = (p - g, p + g);
            if a <= last_end + g || b >= n - g {
                continue;
            }
            // Compensation is only possible if the surrounding material can
            // take it: at ratios below one the output segment must stay
            // positive too.
            let out_a = a * r;
            let out_b = out_a + (b - a);
            if out_b >= n * r {
                continue;
            }
            anchors.push((a, out_a));
            anchors.push((b, out_b));
            last_end = b;
        }
        anchors.push((n, n * r));

        // Anchors must ascend in both axes or the inverse is not a function.
        // At extreme ratios the compensation can outrun the material; when it
        // does, fall back rather than emit a map that folds back on itself.
        for w in anchors.windows(2) {
            if w[1].0 <= w[0].0 || w[1].1 <= w[0].1 {
                return TimeMap::linear(in_frames, ratio);
            }
        }
        TimeMap { anchors }
    }

    /// Where in the input the given output instant comes from.
    pub fn input_at(&self, out: f64) -> f64 {
        let a = &self.anchors;
        if out <= a[0].1 {
            return a[0].0;
        }
        if out >= a[a.len() - 1].1 {
            return a[a.len() - 1].0;
        }
        // Few anchors, walked in order — the caller advances monotonically, so
        // a binary search would not earn its complexity.
        for w in a.windows(2) {
            let (i0, o0) = w[0];
            let (i1, o1) = w[1];
            if out <= o1 {
                let t = (out - o0) / (o1 - o0);
                return i0 + t * (i1 - i0);
            }
        }
        a[a.len() - 1].0
    }

    /// The local stretch factor at an output instant. One means untouched.
    pub fn slope_at(&self, out: f64) -> f64 {
        let a = &self.anchors;
        for w in a.windows(2) {
            let (i0, o0) = w[0];
            let (i1, o1) = w[1];
            if out <= o1 {
                return (o1 - o0) / (i1 - i0).max(1e-9);
            }
        }
        1.0
    }

    pub fn anchor_count(&self) -> usize {
        self.anchors.len()
    }
}

#[cfg(test)]
mod map_tests {
    use super::*;

    #[test]
    fn a_plain_stretch_is_a_straight_line() {
        let m = TimeMap::linear(1000, 2.0);
        assert!((m.input_at(0.0) - 0.0).abs() < 1e-6);
        assert!((m.input_at(1000.0) - 500.0).abs() < 1e-6);
        assert!((m.input_at(2000.0) - 1000.0).abs() < 1e-6);
        assert!((m.slope_at(500.0) - 2.0).abs() < 1e-6);
    }

    #[test]
    fn a_transient_passes_through_unstretched() {
        let (n, r, p, g) = (100_000usize, 4.0f32, 50_000usize, 2_000usize);
        let m = TimeMap::with_transients(n, r, &[p], g);
        assert!(m.anchor_count() > 2, "no anchors were inserted");

        // The protected region starts where the first inserted anchor put it —
        // at (p − g)·r, not at p·r. Getting that wrong is how this test first
        // read a slope of 4.25 and looked like a bug in the map.
        let start = (p - g) as f64 * r as f64;
        let middle = start + g as f64;
        assert!((m.slope_at(middle) - 1.0).abs() < 1e-6,
                "slope inside the guard was {}", m.slope_at(middle));

        // Two thousand frames of output should be two thousand of input.
        let a = m.input_at(start);
        let b = m.input_at(start + 2.0 * g as f64);
        assert!(((b - a) - 2.0 * g as f64).abs() < 1.0, "{a} to {b}");

        // And the material *after* it stretches further than nominal to make
        // up the difference. Before it the slope is exactly nominal: both
        // inserted anchors sit on the original line, so the compensation is
        // one-sided, which is how the thesis draws it too.
        assert!((m.slope_at(1_000.0) - r as f64).abs() < 1e-6,
                "before the transient should be untouched: {}", m.slope_at(1_000.0));
        let after = start + 2.0 * g as f64 + 1_000.0;
        assert!(m.slope_at(after) > r as f64, "after: {}", m.slope_at(after));
    }

    #[test]
    fn the_total_length_is_untouched_by_preservation() {
        for ratio in [0.5f32, 2.0, 8.0] {
            let m = TimeMap::with_transients(100_000, ratio, &[30_000, 60_000], 1_500);
            let end = 100_000.0 * ratio as f64;
            assert!((m.input_at(end) - 100_000.0).abs() < 1.0, "ratio {ratio}");
            assert!((m.input_at(0.0)).abs() < 1e-6);
        }
    }

    #[test]
    fn the_map_never_runs_backwards() {
        let m = TimeMap::with_transients(200_000, 6.0, &[20_000, 40_000, 41_000, 90_000], 3_000);
        let end = 200_000.0 * 6.0;
        let mut prev = -1.0;
        for i in 0..2000 {
            let v = m.input_at(end * i as f64 / 2000.0);
            assert!(v >= prev - 1e-6, "went backwards at {i}: {prev} then {v}");
            prev = v;
        }
    }

    #[test]
    fn onsets_too_close_together_are_dropped_not_squeezed() {
        // Guards would overlap; the map must stay sane rather than fold.
        let m = TimeMap::with_transients(100_000, 4.0, &[50_000, 50_500, 51_000], 2_000);
        let mut prev = -1.0;
        for i in 0..500 {
            let v = m.input_at(400_000.0 * i as f64 / 500.0);
            assert!(v >= prev - 1e-6);
            prev = v;
        }
    }

    #[test]
    fn nothing_detected_is_the_plain_line_again() {
        let a = TimeMap::with_transients(10_000, 3.0, &[], 500);
        let b = TimeMap::linear(10_000, 3.0);
        assert_eq!(a.anchor_count(), b.anchor_count());
    }
}
