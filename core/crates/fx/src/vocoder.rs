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
/// `width` is how many neighbours each side a bin must beat. Two is Laroche
/// and Dolson's test: strict enough to ignore ripple in the noise floor, loose
/// enough to catch every real partial. Wider finds fewer peaks, so more of the
/// spectrum ends up locked to whichever peak claims it.
fn peaks(mag: &[f32], width: usize, out: &mut Vec<usize>) {
    out.clear();
    let w = width.clamp(1, 32);
    if mag.len() < w * 2 + 1 {
        return;
    }
    'bins: for k in w..mag.len() - w {
        let m = mag[k];
        if m <= 1e-9 {
            continue;
        }
        for d in 1..=w {
            if m <= mag[k - d] || m <= mag[k + d] {
                continue 'bins;
            }
        }
        out.push(k);
    }
}

/// Magnitude processing, before any of it becomes phase.
///
/// The vocoder normally copies magnitudes through untouched and rewrites only
/// phase. These three are the whole of what it does not normally do: gate,
/// blur sideways, and carry forward. Order matters — freezing last means the
/// held spectrum is the gated and blurred one, which is what you would expect
/// having set the other two first.
fn shape_magnitudes(
    mag: &mut [f32],
    held: &mut [f32],
    scratch: &mut [f32],
    s: &Settings,
    first: bool,
) {
    let gate = s.mag_gate.clamp(0.0, 1.0);
    if gate > 0.0 {
        let peak = mag.iter().copied().fold(0.0f32, f32::max);
        let bar = peak * gate;
        for m in mag.iter_mut() {
            if *m < bar {
                *m = 0.0;
            }
        }
    }

    let blur = s.mag_blur.clamp(0.0, 1.0);
    if blur > 0.0 {
        // A three-tap mean, applied as many times as the amount asks for, so
        // the control keeps going after one pass has stopped making a
        // difference. Whole passes plus a mix for the fraction.
        let passes = (blur * 6.0).floor() as usize;
        let frac = blur * 6.0 - passes as f32;
        for pass in 0..=passes {
            let n = mag.len();
            for k in 0..n {
                let a = mag[k.saturating_sub(1)];
                let b = mag[k];
                let c = mag[(k + 1).min(n - 1)];
                scratch[k] = (a + b + c) / 3.0;
            }
            // The last pass is only partly applied, so the control is smooth
            // across the boundary between one pass and two.
            let amount = if pass == passes { frac } else { 1.0 };
            if amount <= 0.0 {
                break;
            }
            for k in 0..n {
                mag[k] += (scratch[k] - mag[k]) * amount;
            }
        }
    }

    let freeze = s.mag_freeze.clamp(0.0, 1.0);
    if freeze > 0.0 {
        // Seeded from the first frame, so full freeze holds that frame rather
        // than holding the silence the buffer started as.
        if first {
            held.copy_from_slice(mag);
        }
        for k in 0..mag.len() {
            let v = held[k] + (mag[k] - held[k]) * (1.0 - freeze);
            held[k] = v;
            mag[k] = v;
        }
    } else {
        held.copy_from_slice(mag);
    }
}

/// Settings for one run. See [`crate::stretch::VocoderParams`] for what each of
/// the deliberately-wrong ones does to the sound.
#[derive(Debug, Clone, Copy)]
pub struct Settings {
    /// Transform size. Rounded up to a power of two.
    pub fft_size: usize,
    /// Lock the bins around each spectral peak to that peak's phase.
    pub phase_lock: bool,
    /// Multiplies the analysis hop, breaking its link to the ratio.
    pub hop_skew: f32,
    /// Scales the measured deviation from the bin centre frequency.
    pub freq_trust: f32,
    /// Scales the phase relationship a locked bin keeps with its peak.
    pub phase_spread: f32,
    /// Neighbours a bin must beat on each side to be a peak.
    pub peak_width: usize,
    /// Scales each peak's locked region.
    pub lock_width: f32,
    /// Carries magnitudes forward between frames. One holds the first frame.
    pub mag_freeze: f32,
    /// Smears magnitudes across neighbouring bins.
    pub mag_blur: f32,
    /// Silences bins below this share of the frame's loudest.
    pub mag_gate: f32,
    /// Drive every channel's phase from their sum rather than each on its own.
    pub stereo_link: bool,
    /// The controls the grain cloud named. Here a window is an analysis frame:
    /// density and overlap set how often one is taken, size jitter varies the
    /// spacing they are laid back down at, position jitter moves where each one
    /// reads from, and the pitch jitter and drift transpose each frame.
    pub grain: crate::Grain,
    /// Needed only to read `density_hz` in frames.
    pub sample_rate: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            fft_size: 2048,
            phase_lock: true,
            hop_skew: 1.0,
            freq_trust: 1.0,
            phase_spread: 1.0,
            peak_width: 2,
            lock_width: 1.0,
            mag_freeze: 0.0,
            mag_blur: 0.0,
            mag_gate: 0.0,
            stereo_link: false,
            grain: crate::Grain::default(),
            sample_rate: 48_000,
        }
    }
}

/// Stretch one channel of mono audio by `ratio`.
pub fn stretch_mono(input: &[f32], ratio: f32, s: Settings) -> Vec<f32> {
    let ratio = ratio.clamp(0.01, 100.0);
    let n = s.fft_size.max(64).next_power_of_two();
    // How often a frame is taken and laid back down. Density and overlap are the
    // grain cloud's controls; a frame is this engine's window.
    let hs = crate::stretch::hop_frames(&s.grain, n, s.sample_rate.max(1) as f32).max(1);
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
    let mut held = vec![0f32; bins];
    let mut scratch = vec![0f32; bins];
    let mut phase = vec![0f32; bins];
    let mut peak_idx: Vec<usize> = Vec::with_capacity(bins / 4);

    // Analysis reads slower than synthesis writes when stretching. Kept as a
    // float and rounded per frame, so a fractional hop does not accumulate
    // drift over a long file.
    //
    // The skew multiplies it, which is what severs the read pointer from the
    // ratio. At zero the pointer never moves at all and every output frame is
    // resynthesised from the same instant.
    let skew = s.hop_skew.clamp(0.0, 4.0) as f64;
    let advance = (hs as f64 / ratio as f64) * skew;
    let span = input.len().saturating_sub(n).max(1);
    let mut read = 0f64;
    let mut prev_start: isize = -1;
    let mut write = 0usize;
    let mut first = true;
    let mut index = 0u64;

    // Where the grain controls reach a frequency-domain engine. Position
    // jitter moves where a frame reads from; size jitter varies the spacing
    // frames are laid back down at, which is the nearest thing a fixed
    // transform has to a varying window.
    let g = s.grain;
    let sr = s.sample_rate.max(1) as f32;
    let pos_jitter = (g.position_jitter_ms / 1000.0) * sr;

    while write < out_len {
        let jitter = if pos_jitter > 0.0 {
            (pos_jitter * g.rand_bipolar(index, g.salt(5))) as f64
        } else {
            0.0
        };
        let mut start = (read + jitter).max(0.0).round() as usize;
        if start + n > input.len() {
            // At the nominal hop, running out of source is the end of the job.
            // Off it, the read pointer is sweeping at a speed that has nothing
            // to do with the output length, so wrap and keep going rather than
            // trail off into padding.
            if (skew - 1.0).abs() < 1e-6 {
                break;
            }
            read %= span as f64;
            start = read.round() as usize;
            if start + n > input.len() {
                break;
            }
            // A wrap is a discontinuity; a hop measured across it would be a
            // large negative number and the phase estimate nonsense.
            prev_start = -1;
        }
        let start = start.min(input.len().saturating_sub(n));

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
        shape_magnitudes(&mut mag, &mut held, &mut scratch, &s, first);

        // The true analysis hop for this frame, which is what the heterodyne
        // is measured against — equation 5.10 uses α(n) − α(n−1), not a
        // nominal value. A zero hop — which a frozen read pointer produces —
        // has no deviation to measure and would divide by nothing.
        let ha = if prev_start < 0 { hs as f32 } else { (start as isize - prev_start) as f32 };
        let ha = if ha.abs() < 1e-6 { hs as f32 } else { ha };

        if first {
            sum_phase.copy_from_slice(&phase);
            first = false;
        } else if s.phase_lock {
            peaks(&mag, s.peak_width, &mut peak_idx);
            if peak_idx.is_empty() {
                propagate_all(&phase, &prev_phase, &mut sum_phase, n, ha, hs as f32, &s);
            } else {
                // Every peak advances on its own instantaneous frequency; the
                // bins around it keep the phase relationship they had in the
                // analysis frame. So a partial moves as one object instead of
                // dissolving into its own skirts.
                let trust = s.freq_trust.clamp(0.0, 4.0);
                let spread = s.phase_spread.clamp(0.0, 4.0);
                let width = s.lock_width.clamp(0.0, 4.0);
                for (p, &k) in peak_idx.iter().enumerate() {
                    let omega = TWO_PI * k as f32 / n as f32;
                    let delta = wrap(phase[k] - prev_phase[k] - ha * omega);
                    let freq = omega + (delta / ha) * trust;
                    sum_phase[k] = wrap(sum_phase[k] + hs as f32 * freq);

                    // Halfway to each neighbouring peak, scaled. Past one the
                    // regions overlap and a peak imposes its phase on ground
                    // that belongs to the next one along.
                    let mid_lo = if p == 0 { 0 } else { (peak_idx[p - 1] + k + 1) / 2 };
                    let mid_hi =
                        if p + 1 == peak_idx.len() { bins } else { (k + peak_idx[p + 1] + 1) / 2 };
                    let lo = k.saturating_sub((((k - mid_lo) as f32) * width) as usize);
                    let hi = (k + (((mid_hi - k) as f32) * width) as usize).min(bins);
                    for j in lo..hi {
                        if j != k {
                            sum_phase[j] = wrap(sum_phase[k] + (phase[j] - phase[k]) * spread);
                        }
                    }
                }
            }
        } else {
            propagate_all(&phase, &prev_phase, &mut sum_phase, n, ha, hs as f32, &s);
        }

        // Pitch jitter and drift, per frame. Scaling the phase advance
        // transposes what the frame will resynthesise as.
        let rate = crate::stretch::grain_rate(&g, index, write as f32 / sr);
        if (rate - 1.0).abs() > 1e-6 {
            for k in 0..bins {
                sum_phase[k] = wrap(sum_phase[k] * rate);
            }
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
        write += crate::stretch::grain_size(&g, index, hs).max(1);
        index += 1;
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
fn propagate_all(
    phase: &[f32],
    prev: &[f32],
    sum: &mut [f32],
    n: usize,
    ha: f32,
    hs: f32,
    s: &Settings,
) {
    // How much of the measured deviation to believe. At one this is 5.11 as
    // written; at zero every bin is declared to sit exactly on its own centre
    // frequency, which quantises the whole sound to the transform's grid.
    let trust = s.freq_trust.clamp(0.0, 4.0);
    for k in 0..phase.len() {
        // 5.10 — the heterodyned phase increment: what actually happened,
        // less what a partial sitting exactly on the bin centre would have done.
        let omega = TWO_PI * k as f32 / n as f32;
        let delta = wrap(phase[k] - prev[k] - ha * omega);
        // 5.11 — the instantaneous frequency that deviation implies.
        let freq = omega + (delta / ha) * trust;
        // 5.12 — advance by it over the synthesis hop.
        sum[k] = wrap(sum[k] + hs * freq);
    }
}

/// Stretch interleaved audio.
///
/// Channels are transformed independently by default. That is the usual choice
/// and it is worth knowing what it costs: two channels drift in phase against
/// each other, which widens a stereo image and can hollow a centred source.
/// `stereo_link` is the other answer — see [`stretch_linked`]. Neither is right
/// for every source, so both are here and the trade is stated rather than hidden.
pub fn stretch(input: &[f32], channels: usize, ratio: f32, s: Settings) -> Vec<f32> {
    let channels = channels.max(1);
    if input.is_empty() {
        return Vec::new();
    }
    if channels == 1 {
        return stretch_mono(input, ratio, s);
    }
    if s.stereo_link {
        return stretch_linked(input, channels, ratio, s);
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

/// Stretch every channel against one shared phase estimate.
///
/// The independent version is not wrong, it is answering a different question.
/// Each channel gets the best phase for itself, and nothing is looking after
/// the relationship *between* them — which is where a stereo image lives. Two
/// channels of the same centred source drift apart, and the middle of the
/// picture thins out.
///
/// So: the channels are summed to a reference, the propagation runs once on
/// that, and every channel receives the same *correction* rather than the same
/// phase. A channel keeps whatever it was doing relative to the reference, so
/// the difference between left and right survives the stretch untouched. The
/// sum is free — the transform is linear, so adding the spectra is adding the
/// signals.
///
/// The cost is the mirror of the other one: two genuinely unrelated channels
/// are now told to agree about a phase neither of them measured. That is why
/// this is a switch and not the default.
fn stretch_linked(input: &[f32], channels: usize, ratio: f32, s: Settings) -> Vec<f32> {
    let ratio = ratio.clamp(0.01, 100.0);
    let n = s.fft_size.max(64).next_power_of_two();
    let hs = crate::stretch::hop_frames(&s.grain, n, s.sample_rate.max(1) as f32).max(1);
    let frames = input.len() / channels;
    if frames < n {
        return input.to_vec();
    }

    let out_frames = ((frames as f64) * ratio as f64).round() as usize;
    let win = fft::hann(n);
    let bins = n / 2 + 1;

    let mut out = vec![0f32; (out_frames + n) * channels];
    let mut norm = vec![0f32; out_frames + n];

    // Per channel, because each keeps its own magnitudes and its own phase.
    let mut re = vec![vec![0f32; n]; channels];
    let mut im = vec![vec![0f32; n]; channels];
    let mut mag = vec![vec![0f32; bins]; channels];
    let mut phase = vec![vec![0f32; bins]; channels];
    let mut held = vec![vec![0f32; bins]; channels];
    let mut scratch = vec![0f32; bins];

    // The reference: the channels summed. One phase estimate for all of them.
    let mut ref_mag = vec![0f32; bins];
    let mut ref_phase = vec![0f32; bins];
    let mut prev_ref = vec![0f32; bins];
    let mut sum_phase = vec![0f32; bins];
    let mut corr = vec![0f32; bins];
    let mut peak_idx: Vec<usize> = Vec::with_capacity(bins / 4);

    let skew = s.hop_skew.clamp(0.0, 4.0) as f64;
    let advance = (hs as f64 / ratio as f64) * skew;
    let span = frames.saturating_sub(n).max(1);
    let mut read = 0f64;
    let mut prev_start: isize = -1;
    let mut write = 0usize;
    let mut first = true;
    let mut index = 0u64;

    // The same grain controls the independent path honours, so linking the
    // channels does not quietly switch half the panel off.
    let g = s.grain;
    let sr = s.sample_rate.max(1) as f32;
    let pos_jitter = (g.position_jitter_ms / 1000.0) * sr;

    while write < out_frames {
        let jitter = if pos_jitter > 0.0 {
            (pos_jitter * g.rand_bipolar(index, g.salt(5))) as f64
        } else {
            0.0
        };
        let mut start = (read + jitter).max(0.0).round() as usize;
        if start + n > frames {
            if (skew - 1.0).abs() < 1e-6 {
                break;
            }
            read %= span as f64;
            start = read.round() as usize;
            if start + n > frames {
                break;
            }
            prev_start = -1;
        }
        let start = start.min(frames.saturating_sub(n));

        let mut ok = true;
        for c in 0..channels {
            for i in 0..n {
                re[c][i] = input[(start + i) * channels + c] * win[i];
                im[c][i] = 0.0;
            }
            if !fft(&mut re[c], &mut im[c]) {
                ok = false;
                break;
            }
            for k in 0..bins {
                mag[c][k] = (re[c][k] * re[c][k] + im[c][k] * im[c][k]).sqrt();
                phase[c][k] = im[c][k].atan2(re[c][k]);
            }
            shape_magnitudes(&mut mag[c], &mut held[c], &mut scratch, &s, first);
        }
        if !ok {
            break;
        }

        // The mid signal's spectrum, without a second transform.
        for k in 0..bins {
            let mut sr = 0.0;
            let mut si = 0.0;
            for c in 0..channels {
                sr += re[c][k];
                si += im[c][k];
            }
            ref_mag[k] = (sr * sr + si * si).sqrt();
            ref_phase[k] = si.atan2(sr);
        }

        let ha = if prev_start < 0 { hs as f32 } else { (start as isize - prev_start) as f32 };
        let ha = if ha.abs() < 1e-6 { hs as f32 } else { ha };

        if first {
            sum_phase.copy_from_slice(&ref_phase);
            first = false;
        } else if s.phase_lock {
            peaks(&ref_mag, s.peak_width, &mut peak_idx);
            if peak_idx.is_empty() {
                propagate_all(&ref_phase, &prev_ref, &mut sum_phase, n, ha, hs as f32, &s);
            } else {
                let trust = s.freq_trust.clamp(0.0, 4.0);
                let spread = s.phase_spread.clamp(0.0, 4.0);
                let width = s.lock_width.clamp(0.0, 4.0);
                for (p, &k) in peak_idx.iter().enumerate() {
                    let omega = TWO_PI * k as f32 / n as f32;
                    let delta = wrap(ref_phase[k] - prev_ref[k] - ha * omega);
                    let freq = omega + (delta / ha) * trust;
                    sum_phase[k] = wrap(sum_phase[k] + hs as f32 * freq);

                    let mid_lo = if p == 0 { 0 } else { (peak_idx[p - 1] + k + 1) / 2 };
                    let mid_hi =
                        if p + 1 == peak_idx.len() { bins } else { (k + peak_idx[p + 1] + 1) / 2 };
                    let lo = k.saturating_sub((((k - mid_lo) as f32) * width) as usize);
                    let hi = (k + (((mid_hi - k) as f32) * width) as usize).min(bins);
                    for j in lo..hi {
                        if j != k {
                            sum_phase[j] = wrap(sum_phase[k] + (ref_phase[j] - ref_phase[k]) * spread);
                        }
                    }
                }
            }
        } else {
            propagate_all(&ref_phase, &prev_ref, &mut sum_phase, n, ha, hs as f32, &s);
        }

        // What the stretch did to the reference, and therefore what every
        // channel is moved by. A channel's offset from the reference is left
        // exactly as measured, and that offset is the stereo image.
        let rate = crate::stretch::grain_rate(&g, index, write as f32 / sr);
        if (rate - 1.0).abs() > 1e-6 {
            for k in 0..bins {
                sum_phase[k] = wrap(sum_phase[k] * rate);
            }
        }
        for k in 0..bins {
            corr[k] = wrap(sum_phase[k] - ref_phase[k]);
        }

        prev_ref.copy_from_slice(&ref_phase);
        prev_start = start as isize;

        for c in 0..channels {
            for k in 0..bins {
                let p = phase[c][k] + corr[k];
                re[c][k] = mag[c][k] * p.cos();
                im[c][k] = mag[c][k] * p.sin();
            }
            for k in bins..n {
                re[c][k] = re[c][n - k];
                im[c][k] = -im[c][n - k];
            }
            im[c][0] = 0.0;
            if n % 2 == 0 {
                im[c][n / 2] = 0.0;
            }
            ifft(&mut re[c], &mut im[c]);

            for i in 0..n {
                let f = write + i;
                if f < out_frames + n {
                    out[f * channels + c] += re[c][i] * win[i];
                }
            }
        }
        for i in 0..n {
            let f = write + i;
            if f < out_frames + n {
                norm[f] += win[i] * win[i];
            }
        }

        read += advance;
        write += crate::stretch::grain_size(&g, index, hs).max(1);
        index += 1;
    }

    for f in 0..out_frames + n {
        let g = norm[f];
        if g > 1e-6 {
            for c in 0..channels {
                out[f * channels + c] /= g;
            }
        }
    }
    out.truncate(out_frames * channels);
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
        peaks(&m, 2, &mut out);
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
