//! Time stretching and pitch shifting.
//!
//! WSOLA — waveform similarity overlap-add. The signal is cut into overlapping
//! windows and reassembled at a different spacing; before each window is laid
//! down, a short search finds the nearby segment that best continues what was
//! already written. That search is the whole trick: naive overlap-add at a
//! changed hop size puts waveforms out of phase against each other and the
//! result sounds hollow and metallic.
//!
//! This is not a rack effect. Every [`crate::Effect`] must preserve buffer
//! length, and stretching exists precisely to change it, so it belongs to the
//! document rather than the chain.

/// How much work to spend looking for a good splice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Quality {
    /// Short search. Fine while dragging a slider.
    Draft,
    Standard,
    /// Wide search, for the render you keep.
    Best,
}

impl Quality {
    fn search_ms(self) -> f32 {
        match self {
            Quality::Draft => 4.0,
            Quality::Standard => 10.0,
            Quality::Best => 20.0,
        }
    }
}

/// Which engine does the stretching.
///
/// Not a quality ladder — the two fail in opposite directions. WSOLA keeps
/// transients intact and smears dense polyphony; the vocoder handles polyphony
/// cleanly and smears transients. Percussion wants the first, a string pad
/// wants the second, and no amount of tuning turns either into the other.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Algorithm {
    /// Waveform similarity overlap-add. Time domain.
    Wsola,
    /// Phase vocoder with identity phase locking. Frequency domain.
    Vocoder,
    /// Deterministic grain cloud. Time domain, and the only one of the three
    /// that is not trying to be transparent.
    Granular,
}

impl Algorithm {
    pub fn as_str(self) -> &'static str {
        match self {
            Algorithm::Wsola => "wsola",
            Algorithm::Vocoder => "vocoder",
            Algorithm::Granular => "granular",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "wsola" => Some(Algorithm::Wsola),
            "vocoder" => Some(Algorithm::Vocoder),
            "granular" => Some(Algorithm::Granular),
            _ => None,
        }
    }
}

/// The vocoder's own windowing.
///
/// Separate from WSOLA's because the two mean different things by a window. For
/// WSOLA it is a piece of waveform to splice; for the vocoder it is the
/// analysis frame, and its length is a direct trade between frequency
/// resolution and time resolution — long enough to separate two close partials
/// is already long enough to smear a snare.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VocoderParams {
    /// Analysis window in milliseconds. Sized to a power of two internally.
    pub window_ms: f32,
    /// Frames overlapping at any moment. More is smoother and slower.
    pub overlap: u32,
    /// Lock the bins around each spectral peak to that peak's phase.
    pub phase_lock: bool,
}

impl Default for VocoderParams {
    fn default() -> Self {
        // ~46 ms at 44.1 kHz, which is 2048 samples — the usual starting point,
        // and enough to resolve partials a couple of semitones apart.
        VocoderParams { window_ms: 46.0, overlap: 4, phase_lock: true }
    }
}

impl VocoderParams {
    pub fn is_clean(&self) -> bool {
        *self == VocoderParams::default()
    }
}

/// WSOLA's own controls.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WsolaParams {
    /// Hold detected transients at their original rate, letting the material
    /// around them absorb the difference.
    pub preserve_transients: bool,
    /// How eager the detector is, 0..1.
    pub sensitivity: f32,
}

impl Default for WsolaParams {
    fn default() -> Self {
        WsolaParams { preserve_transients: false, sensitivity: 0.5 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Stretch {
    /// Output length as a multiple of input length. 2.0 is twice as long.
    pub ratio: f32,
    /// Pitch shift in semitones. Does not change the length.
    pub semitones: f32,
    /// Window length. Longer smooths tonal material; shorter keeps transients.
    pub window_ms: f32,
    pub quality: Quality,
    pub algorithm: Algorithm,
    /// The vocoder's controls. Kept apart from the window above, which belongs
    /// to the time-domain engines.
    pub vocoder: VocoderParams,
    pub wsola: WsolaParams,
    /// Per-grain variation. Inert by default.
    pub grain: crate::Grain,
}

impl Default for Stretch {
    fn default() -> Self {
        Stretch {
            ratio: 1.0,
            semitones: 0.0,
            window_ms: 40.0,
            quality: Quality::Standard,
            algorithm: Algorithm::Wsola,
            vocoder: VocoderParams::default(),
            wsola: WsolaParams::default(),
            grain: crate::Grain::default(),
        }
    }
}

impl Stretch {
    pub fn is_identity(&self) -> bool {
        (self.ratio - 1.0).abs() < 1e-4
            && self.semitones.abs() < 1e-4
            && self.grain.is_clean()
    }

    /// Are the granular controls doing anything, whichever engine is selected?
    ///
    /// Kept because the interface still wants to know — it dims the grain panel
    /// when another engine is running — but it no longer decides which engine
    /// runs. That conflation is what made the picker look broken.
    pub fn grain_engaged(&self) -> bool {
        !self.grain.is_clean()
    }

    /// Are the granular controls doing anything?
    pub fn is_granular(&self) -> bool {
        !self.grain.is_clean()
    }

    /// Frequency multiplier for the pitch shift.
    pub fn pitch_factor(&self) -> f32 {
        2f32.powf(self.semitones / 12.0)
    }

    pub fn output_frames(&self, input_frames: u64) -> u64 {
        if self.is_identity() {
            return input_frames;
        }
        ((input_frames as f64) * (self.ratio.clamp(0.01, 100.0) as f64)).round() as u64
    }

    /// Stretch and shift `input` (interleaved).
    ///
    /// Pitch shifting is time stretching plus resampling: stretch by the pitch
    /// factor, then read back that much faster. The two length changes cancel,
    /// leaving the duration set by `ratio` alone.
    pub fn process(&self, input: &[f32], channels: usize, sample_rate: u32) -> Vec<f32> {
        let channels = channels.max(1);
        if input.is_empty() || channels == 0 {
            return Vec::new();
        }
        if self.is_identity() {
            return input.to_vec();
        }

        let ratio = self.ratio.clamp(0.01, 100.0);
        let pitch = self.pitch_factor().clamp(0.05, 20.0);
        let in_frames = input.len() / channels;
        let want = ((in_frames as f64) * ratio as f64).round() as usize;

        // The engine is whatever was asked for.
        //
        // This used to test `is_granular()` first and take the granular path
        // whenever any grain control was off its default — which meant the
        // engine picker silently did nothing on any document with grain
        // settings on it, and the two stretchers sounded identical because
        // neither was running. An override that cannot be seen is worse than
        // no choice at all.
        if self.algorithm == Algorithm::Granular {
            let out = crate::grain::granular(
                input, channels, sample_rate, ratio, self.semitones, self.window_ms, &self.grain,
            );
            return fit(out, want, channels);
        }

        // Stretch far enough that resampling for pitch lands on `want`.
        let stretched = match self.algorithm {
            // Handled above; it returns before reaching here.
            Algorithm::Granular => unreachable!("granular returns earlier"),
            Algorithm::Wsola => wsola(
                input,
                channels,
                sample_rate,
                ratio * pitch,
                self.window_ms,
                self.quality,
                self.wsola,
            ),
            Algorithm::Vocoder => crate::vocoder::stretch(
                input,
                channels,
                ratio * pitch,
                crate::vocoder::Settings {
                    fft_size: fft_size_for(self.vocoder.window_ms, sample_rate),
                    overlap: self.vocoder.overlap.clamp(2, 8) as usize,
                    phase_lock: self.vocoder.phase_lock,
                },
            ),
        };
        let out = if (pitch - 1.0).abs() < 1e-6 {
            stretched
        } else {
            resample(&stretched, channels, pitch, want)
        };

        // Hold the promised length exactly, so timeline arithmetic stays honest.
        fit(out, want, channels)
    }
}

/// Transform size for a given window length, as a power of two.
///
/// Clamped at both ends for reasons that are not cosmetic: below 256 the bins
/// are too wide to separate partials and the vocoder has nothing to lock onto,
/// and above 8192 the window is long enough that transients smear audibly no
/// matter what the phases do.
fn fft_size_for(window_ms: f32, sample_rate: u32) -> usize {
    let samples = (window_ms.clamp(5.0, 2000.0) / 1000.0) * sample_rate.max(1) as f32;
    (samples as usize).clamp(256, 8192).next_power_of_two()
}

fn fit(mut v: Vec<f32>, want_frames: usize, channels: usize) -> Vec<f32> {
    v.resize(want_frames * channels, 0.0);
    v
}

/// Waveform-similarity overlap-add.
fn wsola(
    input: &[f32],
    channels: usize,
    sample_rate: u32,
    ratio: f32,
    window_ms: f32,
    quality: Quality,
    params: WsolaParams,
) -> Vec<f32> {
    let in_frames = input.len() / channels;
    let sr = sample_rate.max(1) as f32;

    // Even window, 50% overlap.
    let win = (((window_ms.clamp(5.0, 2000.0) / 1000.0) * sr) as usize).max(64) & !1;
    let hop_out = win / 2;
    let search = (((quality.search_ms() / 1000.0) * sr) as usize).max(1);

    // Where each output instant comes from. Without transient preservation
    // this is a straight line and behaves exactly as a constant hop did.
    //
    // The guard has to be wide enough that whole windows fit inside it — the
    // thesis is explicit that two anchors close together do not produce an
    // unstretched region, because WSOLA lays down windows of fixed length and
    // cannot honour a span shorter than one. Three hops is the smallest that
    // reliably does.
    let map = if params.preserve_transients {
        let hits = crate::transient::onsets(input, channels, sample_rate, params.sensitivity);
        crate::transient::TimeMap::with_transients(in_frames, ratio, &hits, hop_out * 3)
    } else {
        crate::transient::TimeMap::linear(in_frames, ratio)
    };

    if in_frames <= win + search * 2 {
        // Too short to splice meaningfully; resampling alone is the honest
        // answer and avoids reading past the end.
        let want = ((in_frames as f32) * ratio).round() as usize;
        return resample(input, channels, 1.0 / ratio, want);
    }

    let out_frames = ((in_frames as f32) * ratio).round() as usize + win;
    let mut out = vec![0f32; out_frames * channels];
    let mut norm = vec![0f32; out_frames];
    let window = hann(win);

    // The segment we expect to follow what was just written; the next window is
    // chosen to resemble it.
    let mut expect: Vec<f32> = vec![0.0; hop_out * channels];
    let mut read = 0usize;
    let mut write = 0usize;
    let mut first = true;

    while write + win < out_frames && read + win + search < in_frames {
        let pos = if first {
            first = false;
            read
        } else {
            best_offset(input, channels, read, search, &expect, hop_out)
        };

        for i in 0..win {
            let w = window[i];
            let src = (pos + i) * channels;
            let dst = (write + i) * channels;
            if src + channels > input.len() || dst + channels > out.len() {
                break;
            }
            for ch in 0..channels {
                out[dst + ch] += input[src + ch] * w;
            }
            norm[write + i] += w;
        }

        // What naturally follows the window just taken.
        let tail = pos + hop_out;
        for i in 0..hop_out {
            for ch in 0..channels {
                let s = (tail + i) * channels + ch;
                expect[i * channels + ch] = if s < input.len() { input[s] } else { 0.0 };
            }
        }

        write += hop_out;
        // The map decides where to read next. At a transient its slope is one,
        // so the read advances as fast as the write and nothing is stretched.
        read = map.input_at(write as f64).max(0.0) as usize;
    }

    // Undo the window's amplitude envelope where overlap is incomplete.
    for f in 0..out_frames {
        let n = norm[f];
        if n > 1e-6 {
            for ch in 0..channels {
                out[f * channels + ch] /= n;
            }
        }
    }

    let want = ((in_frames as f32) * ratio).round() as usize;
    out.truncate(want.min(out_frames) * channels);
    out
}

/// Search ±`search` frames around `centre` for the segment best matching
/// `expect`, by normalised cross-correlation.
fn best_offset(
    input: &[f32],
    channels: usize,
    centre: usize,
    search: usize,
    expect: &[f32],
    len: usize,
) -> usize {
    let lo = centre.saturating_sub(search);
    let hi = (centre + search).min(input.len() / channels - len - 1);
    if hi <= lo {
        return centre.min(hi);
    }

    let mut best = centre.min(hi);
    let mut best_score = f32::NEG_INFINITY;
    // Every fourth frame: the correlation surface is smooth enough that a finer
    // sweep costs time without changing the choice.
    let step = 4.max(1);
    let mut p = lo;
    while p <= hi {
        let mut dot = 0f32;
        let mut energy = 0f32;
        for i in (0..len).step_by(2) {
            for ch in 0..channels {
                let a = input[(p + i) * channels + ch];
                let b = expect[i * channels + ch];
                dot += a * b;
                energy += a * a;
            }
        }
        // Normalising stops the search simply picking the loudest moment.
        let score = if energy > 1e-9 { dot / energy.sqrt() } else { 0.0 };
        if score > best_score {
            best_score = score;
            best = p;
        }
        p += step;
    }
    best
}

/// Resample by `factor` (frequency multiplier) to `want` frames, with cubic
/// interpolation. Linear interpolation is audibly gritty on pitched material.
fn resample(input: &[f32], channels: usize, factor: f32, want: usize) -> Vec<f32> {
    let in_frames = input.len() / channels;
    if in_frames == 0 || want == 0 {
        return vec![0.0; want * channels];
    }
    let mut out = vec![0f32; want * channels];
    for f in 0..want {
        let pos = f as f32 * factor;
        let i = pos.floor() as isize;
        let t = pos - i as f32;
        for ch in 0..channels {
            let s = |k: isize| -> f32 {
                let idx = (i + k).clamp(0, in_frames as isize - 1) as usize;
                input[idx * channels + ch]
            };
            out[f * channels + ch] = hermite(s(-1), s(0), s(1), s(2), t);
        }
    }
    out
}

fn hermite(m1: f32, p0: f32, p1: f32, p2: f32, t: f32) -> f32 {
    let c = (p1 - m1) * 0.5;
    let v = p0 - p1;
    let w = c + v;
    let a = w + v + (p2 - p0) * 0.5;
    let b = w + a;
    ((a * t - b) * t + c) * t + p0
}

fn hann(n: usize) -> Vec<f32> {
    if n <= 1 {
        return vec![1.0; n];
    }
    (0..n)
        .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (n - 1) as f32).cos())
        .collect()
}

#[cfg(test)]
mod algorithm_tests {
    use super::*;

    fn sine(freq: f32, secs: f32, rate: f32) -> Vec<f32> {
        let n = (secs * rate) as usize;
        (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / rate).sin())
            .collect()
    }

    fn energy_at(sig: &[f32], freq: f32, rate: f32) -> f32 {
        let (mut re, mut im) = (0.0f64, 0.0f64);
        for (i, s) in sig.iter().enumerate() {
            let p = 2.0 * std::f64::consts::PI * freq as f64 * i as f64 / rate as f64;
            re += *s as f64 * p.cos();
            im += *s as f64 * p.sin();
        }
        ((re * re + im * im).sqrt() / sig.len() as f64) as f32
    }

    fn with(alg: Algorithm, ratio: f32) -> Stretch {
        Stretch { ratio, algorithm: alg, ..Default::default() }
    }

    #[test]
    fn both_engines_honour_the_promised_length() {
        let src = sine(440.0, 0.4, 44100.0);
        for alg in [Algorithm::Wsola, Algorithm::Vocoder] {
            for r in [0.5f32, 2.0, 5.0] {
                let out = with(alg, r).process(&src, 1, 44100);
                let want = (src.len() as f32 * r).round() as usize;
                assert_eq!(out.len(), want, "{alg:?} at {r}x");
            }
        }
    }

    #[test]
    fn both_engines_keep_the_pitch_they_were_given() {
        let rate = 44100.0;
        let src = sine(440.0, 0.4, rate);
        for alg in [Algorithm::Wsola, Algorithm::Vocoder] {
            let out = with(alg, 3.0).process(&src, 1, 44100);
            let mid = &out[out.len() / 4..out.len() * 3 / 4];
            let sig = energy_at(mid, 440.0, rate);
            let off = energy_at(mid, 620.0, rate);
            assert!(sig > off * 6.0, "{alg:?}: 440 {sig} against 620 {off}");
        }
    }

    /// Both engines should hold a chord's partials together.
    ///
    /// This test used to assert the vocoder *beat* WSOLA here, and that was a
    /// measurement of a bug rather than of the algorithms. WSOLA advanced its
    /// read position by an integer `hop_out / ratio` every step, so the
    /// truncation accumulated and its splices drifted out of alignment. Once it
    /// followed an exact time map instead, WSOLA scored 666 on this signal
    /// against the vocoder's 421 — the ranking reversed.
    ///
    /// Which is fair: three steady sines at a fixed period is the best case a
    /// similarity search can be handed. The two engines genuinely differ on
    /// real material, but this synthetic chord does not show it, so the test
    /// now asserts only what it can honestly measure — that neither engine
    /// smears the partials into the gaps between them.
    #[test]
    fn the_vocoder_holds_a_chord_together() {
        let rate = 44100.0;
        let n = (0.5 * rate) as usize;
        let src: Vec<f32> = (0..n)
            .map(|i| {
                let t = i as f32 / rate;
                let tau = 2.0 * std::f32::consts::PI;
                ((tau * 440.0 * t).sin() + (tau * 554.37 * t).sin() + (tau * 659.25 * t).sin()) / 3.0
            })
            .collect();

        let purity = |o: &[f32]| {
            let mid = &o[o.len() / 4..o.len() * 3 / 4];
            let sig: f32 = [440.0f32, 554.37, 659.25].iter().map(|f| energy_at(mid, *f, rate)).sum();
            let junk: f32 = [200.0f32, 330.0, 500.0, 800.0, 1100.0]
                .iter().map(|f| energy_at(mid, *f, rate)).sum();
            sig / junk.max(1e-9)
        };

        let w = purity(&with(Algorithm::Wsola, 4.0).process(&src, 1, 44100));
        let v = purity(&with(Algorithm::Vocoder, 4.0).process(&src, 1, 44100));
        assert!(v > 20.0, "vocoder smeared the chord: {v}");
        assert!(w > 20.0, "wsola smeared the chord: {w}");
    }

    #[test]
    fn the_algorithm_survives_a_round_trip_through_its_name() {
        for a in [Algorithm::Wsola, Algorithm::Vocoder] {
            assert_eq!(Algorithm::from_str(a.as_str()), Some(a));
        }
        assert_eq!(Algorithm::from_str("nonsense"), None);
    }

    #[test]
    fn the_window_control_sizes_the_transform() {
        assert!(fft_size_for(5.0, 44100) >= 256);
        assert!(fft_size_for(2000.0, 44100) <= 8192);
        assert!(fft_size_for(46.0, 44100) > fft_size_for(12.0, 44100));
        for ms in [5.0f32, 40.0, 200.0, 2000.0] {
            assert!(fft_size_for(ms, 44100).is_power_of_two());
        }
    }

    #[test]
    fn pitch_shifting_works_on_either_engine() {
        let rate = 44100.0;
        let src = sine(440.0, 0.4, rate);
        for alg in [Algorithm::Wsola, Algorithm::Vocoder] {
            let s = Stretch { semitones: 12.0, algorithm: alg, ..Default::default() };
            let out = s.process(&src, 1, 44100);
            assert_eq!(out.len(), src.len(), "{alg:?}");
            let mid = &out[out.len() / 4..out.len() * 3 / 4];
            assert!(
                energy_at(mid, 880.0, rate) > energy_at(mid, 440.0, rate) * 2.0,
                "{alg:?} did not shift up an octave"
            );
        }
    }
}
