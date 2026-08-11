//! The vocoder, stopped periodically and put back on the ground.
//!
//! A phase vocoder's error is cumulative. Each frame's phase is guessed from
//! the last one's plus the frequency it measured, and each guess is slightly
//! wrong, so over a long stretch the partials drift out of the relationship
//! they had with each other. That is the phasiness — the hollow, reverberant
//! quality that says *vocoder* before it says anything about the material. It
//! gets worse the longer the stretch runs, which is exactly the case the
//! vocoder is otherwise best at.
//!
//! PVSOLA (Moinet and Dutoit, DAFx-12) fixes it by not letting the drift
//! accumulate. Run the vocoder for a handful of frames, then stop trusting the
//! propagated phase entirely: go back to the input, take a raw segment, find
//! where it best continues what has been written using WSOLA's similarity
//! search, cross-fade it in, and start the vocoder again from there with its
//! phase reset to that segment's actual phase.
//!
//! What comes out is the vocoder's tonal handling with a time-domain anchor
//! every few frames, so nothing has long enough to drift. The cost is one knob
//! nobody wants: re-anchor too often and the WSOLA splices dominate and the
//! transients start doubling; too rarely and the phasiness comes back. Four to
//! eight frames is the paper's range and the default sits inside it.
//!
//! This is built on top of the two engines rather than beside them. The
//! vocoder runs on segments of the input; the splice search is the same
//! normalised correlation WSOLA uses. Both keep their own extended parameters,
//! so everything that breaks them on purpose still breaks this.

use crate::stretch::Stretch;

/// How often to stop trusting the phase.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PvsolaParams {
    /// Synthesis frames between re-anchors. This is the whole trade.
    pub anchor_frames: u32,
    /// How far either side of the nominal position to search for the splice,
    /// in milliseconds. Zero anchors wherever the arithmetic says, which
    /// re-introduces the discontinuity the search exists to hide.
    pub search_ms: f32,
    /// Length of the cross-fade into each anchor, as a fraction of the
    /// analysis window. Zero butt-joins them, which is a click at the anchor
    /// rate — a rhythm you can hear the mechanism in.
    pub blend: f32,
}

impl Default for PvsolaParams {
    fn default() -> Self {
        PvsolaParams { anchor_frames: 6, search_ms: 10.0, blend: 0.5 }
    }
}

impl PvsolaParams {
    pub fn is_clean(&self) -> bool {
        *self == PvsolaParams::default()
    }
}

/// Stretch `input` (interleaved) by `ratio`, re-anchoring as we go.
pub fn stretch(
    input: &[f32],
    channels: usize,
    sample_rate: u32,
    ratio: f32,
    spec: &Stretch,
    p: PvsolaParams,
) -> Vec<f32> {
    let channels = channels.max(1);
    let in_frames = input.len() / channels;
    let ratio = ratio.clamp(0.01, 100.0);
    let want = ((in_frames as f64) * ratio as f64).round() as usize;
    if in_frames == 0 || want == 0 {
        return vec![0.0; want * channels];
    }

    let sr = sample_rate.max(1) as f32;
    let n = crate::stretch::fft_size_for(spec.vocoder.window_ms, sample_rate);
    let anchors = p.anchor_frames.clamp(1, 64) as usize;
    let hop = (n / 4).max(1);

    // How much output one run of the vocoder produces, and how much input it
    // consumes to do it. The whole schedule follows from these two.
    let out_span = anchors * hop;
    let in_span = ((out_span as f32) / ratio).round().max(1.0) as usize;

    // Too short for even one segment plus its search. The plain vocoder is the
    // honest answer rather than an anchoring scheme that would fire once.
    if in_frames < in_span + n * 2 {
        let mut s = *spec;
        s.algorithm = crate::stretch::Algorithm::Vocoder;
        s.ratio = ratio;
        s.semitones = 0.0;
        return s.process(input, channels, sample_rate);
    }

    let search = (((p.search_ms.clamp(0.0, 200.0)) / 1000.0) * sr) as usize;
    let blend = ((p.blend.clamp(0.0, 1.0) * n as f32) as usize).min(out_span);

    // Each run reaches back a little before the material it is being asked
    // for, and throws away what it makes there. Without it the splice would be
    // cut from the first frames the vocoder produced, and those are its
    // ramp-up — the overlap-add has not reached full depth yet, so the
    // waveform there is not what the algorithm actually makes. Anchoring onto
    // that put more disorder into the output than the drift it was there to
    // prevent.
    //
    // The run-up is measured in *output* frames, which is where the ramp
    // actually is: it lasts until the overlap-add is a full window deep,
    // whatever the ratio. Measuring it in input frames instead — the obvious
    // way, and the way this was first written — makes the discarded run-up
    // grow with the ratio while the material it protects stays the same size,
    // so the cost goes up with the square of the stretch. At 16× that was
    // twenty seconds where this is four.
    let pre_out = n;
    let pre_in = ((pre_out as f32) / ratio).ceil() as usize;

    // How much output is wanted from each run: the span, the fade into it, and
    // room for the search to move. The segment is sized from that rather than
    // from a guess, which is what stops each run vocoding five times the audio
    // it will use.
    let need_out = out_span + blend + search;
    let need_in = ((need_out as f32) / ratio).ceil() as usize + n;

    let mut out = vec![0f32; (want + out_span + n) * channels];
    let mut written = 0usize; // frames of `out` that hold finished audio
    let mut read = 0usize; // input frame the next run is anchored at

    while written < want {
        // Back up for the run-up, taking whatever is there.
        let from = read.saturating_sub(pre_in);
        let lead = read - from; // input frames of run-up actually available
        let take = (lead + need_in).min(in_frames - from);
        if take < n {
            break;
        }
        let seg = &input[from * channels..(from + take) * channels];

        let mut s = *spec;
        s.algorithm = crate::stretch::Algorithm::Vocoder;
        s.ratio = ratio;
        s.semitones = 0.0;
        // Each run starts with no phase history at all — which is the point.
        // Nothing carries over from the previous segment, so nothing can drift
        // across an anchor.
        let piece = s.process(seg, channels, sample_rate);
        let piece_frames = piece.len() / channels;
        if piece_frames == 0 {
            break;
        }
        // Where in this run's output the anchor instant fell.
        let at = if lead == pre_in { pre_out } else { ((lead as f32) * ratio).round() as usize };
        if at >= piece_frames {
            break;
        }

        if written == 0 {
            let len = (piece_frames - at).min(out_span);
            for i in 0..len * channels {
                out[i] = piece[at * channels + i];
            }
            written = len;
        } else {
            // Where the new run should join. The search moves it either side of
            // the anchor to whichever offset best continues what is already
            // written — the same normalised correlation WSOLA uses, and the
            // reason the joins are not audible as joins.
            let join = written.saturating_sub(blend);
            let off = best_offset(&out, channels, join, blend.max(1), &piece, at, search);

            let avail = piece_frames - off;
            let len = avail.min(out_span + blend);
            for i in 0..len {
                // Linear, not equal power. Equal power is right for two signals
                // that are unrelated, and the search has just spent its whole
                // effort making these two agree — fading correlated material
                // that way sums to more than either side and puts a bump at
                // every anchor.
                let w = if blend > 0 && i < blend {
                    (i as f32 + 0.5) / blend as f32
                } else {
                    1.0
                };
                for c in 0..channels {
                    let o = (join + i) * channels + c;
                    if o >= out.len() {
                        break;
                    }
                    let old = if i < blend { out[o] * (1.0 - w) } else { 0.0 };
                    out[o] = old + piece[(off + i) * channels + c] * w;
                }
            }
            written = (join + len).min(out.len() / channels);
        }

        read += in_span;
        if read + n >= in_frames {
            break;
        }
    }

    out.truncate(want * channels);
    out.resize(want * channels, 0.0);
    out
}

/// Which offset into `piece` best continues what is already written.
///
/// Normalised correlation against the last `span` frames of the output, mixed
/// to mono first — the alignment is a property of the moment, not of one
/// channel, and searching per channel would let a stereo pair land at two
/// different offsets and smear the image.
fn best_offset(
    out: &[f32],
    channels: usize,
    join: usize,
    span: usize,
    piece: &[f32],
    at: usize,
    search: usize,
) -> usize {
    let piece_frames = piece.len() / channels;
    if span == 0 || piece_frames <= span + at {
        return at.min(piece_frames.saturating_sub(1));
    }
    if search == 0 {
        return at;
    }
    let lo = at.saturating_sub(search);
    let hi = (at + search).min(piece_frames - span - 1);
    if hi <= lo {
        return at.min(hi);
    }

    let mono = |buf: &[f32], f: usize| -> f32 {
        let mut acc = 0f32;
        for c in 0..channels {
            acc += buf[f * channels + c];
        }
        acc / channels as f32
    };

    let mut want = Vec::with_capacity(span);
    for i in 0..span {
        let f = join + i;
        want.push(if (f + 1) * channels <= out.len() { mono(out, f) } else { 0.0 });
    }
    let want_energy: f32 = want.iter().map(|x| x * x).sum::<f32>().sqrt();
    if want_energy < 1e-9 {
        return at;
    }

    let mut best = at;
    let mut best_score = f32::NEG_INFINITY;
    // Every fourth frame: the correlation surface is smooth at this scale and
    // a full search costs four times as much for a splice a sample or two
    // different. The same stride WSOLA settled on.
    let mut off = lo;
    while off <= hi {
        let mut dot = 0f32;
        let mut energy = 0f32;
        for i in 0..span {
            let v = mono(piece, off + i);
            dot += want[i] * v;
            energy += v * v;
        }
        let score = dot / (want_energy * energy.sqrt() + 1e-9);
        if score > best_score {
            best_score = score;
            best = off;
        }
        off += 4;
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stretch::Algorithm;

    const SR: u32 = 44_100;

    fn spec() -> Stretch {
        Stretch { algorithm: Algorithm::Pvsola, ..Stretch::default() }
    }

    fn sine(freq: f32, n: usize, amp: f32) -> Vec<f32> {
        (0..n)
            .map(|i| amp * (std::f32::consts::TAU * freq * i as f32 / SR as f32).sin())
            .collect()
    }

    fn chord(n: usize) -> Vec<f32> {
        let a = sine(220.0, n, 0.3);
        let b = sine(277.2, n, 0.25);
        let c = sine(329.6, n, 0.2);
        (0..n).map(|i| a[i] + b[i] + c[i]).collect()
    }

    fn rms(v: &[f32]) -> f32 {
        if v.is_empty() {
            return 0.0;
        }
        (v.iter().map(|x| x * x).sum::<f32>() / v.len() as f32).sqrt()
    }

    #[test]
    fn the_output_is_the_length_asked_for() {
        let src = chord(44_100);
        for r in [0.5f32, 2.0, 6.0] {
            let out = stretch(&src, 1, SR, r, &spec(), PvsolaParams::default());
            assert_eq!(out.len(), ((src.len() as f64) * r as f64).round() as usize);
        }
    }

    #[test]
    fn stereo_stays_interleaved() {
        let mono = chord(30_000);
        let mut st = Vec::with_capacity(mono.len() * 2);
        for &v in &mono {
            st.push(v);
            st.push(v * 0.5);
        }
        let out = stretch(&st, 2, SR, 3.0, &spec(), PvsolaParams::default());
        assert_eq!(out.len(), 90_000 * 2);
    }

    #[test]
    fn the_level_survives() {
        let src = chord(44_100);
        let out = stretch(&src, 1, SR, 4.0, &spec(), PvsolaParams::default());
        let (a, b) = (rms(&src), rms(&out[8192..out.len() - 8192]));
        assert!((b / a) > 0.5 && (b / a) < 2.0, "level moved by {:.2}x", b / a);
    }

    #[test]
    fn nothing_leaves_the_range() {
        let src = chord(44_100);
        let out = stretch(&src, 1, SR, 8.0, &spec(), PvsolaParams::default());
        let peak = out.iter().fold(0f32, |m, v| m.max(v.abs()));
        assert!(peak < 4.0, "the output ran away: peak {peak:.2}");
        assert!(out.iter().all(|v| v.is_finite()));
    }

    fn saw(f: f32, n: usize, a: f32) -> Vec<f32> {
        (0..n)
            .map(|i| {
                let p = (f * i as f32 / SR as f32).fract();
                a * (2.0 * p - 1.0)
            })
            .collect()
    }

    /// How much the output still looks like the source it came from, averaged
    /// across the whole stretch. Best correlation over one period of lag,
    /// because the absolute phase is not the claim — the *shape* is.
    ///
    /// A spectral measure will not see this. Phasiness does not move energy to
    /// new frequencies; it moves the partials out of the phase relationship
    /// that gave the waveform its shape, and the magnitude spectrum is blind to
    /// that by construction. The first version of this test measured spectral
    /// purity, reported that PVSOLA was worse than the plain vocoder, and was
    /// measuring nothing at all.
    fn shape(out: &[f32], src: &[f32], ratio: f32, period: usize) -> f32 {
        let win = period * 4;
        let (mut acc, mut count) = (0f32, 0usize);
        let mut at = 20_000;
        while at + win < out.len().saturating_sub(20_000) {
            let a = &out[at..at + win];
            let s0 = ((at as f32) / ratio) as usize;
            if s0 + period + win >= src.len() {
                break;
            }
            let ea: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
            let mut best = 0f32;
            for lag in 0..period {
                let b = &src[s0 + lag..s0 + lag + win];
                let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
                let eb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
                best = best.max(dot / (ea * eb + 1e-12));
            }
            acc += best;
            count += 1;
            at += win;
        }
        if count == 0 {
            return 0.0;
        }
        acc / count as f32
    }

    /// The thing it is for, and the shape of the improvement is as telling as
    /// its size: the vocoder's error grows with the ratio because the drift is
    /// cumulative, and PVSOLA's does not, because nothing is allowed to
    /// accumulate for more than a handful of frames.
    #[test]
    fn it_holds_the_waveform_better_than_the_vocoder_and_by_more_the_longer_the_stretch() {
        let src = saw(110.0, 44_100, 0.5);
        let period = (SR as f32 / 110.0) as usize;

        let mut margin = Vec::new();
        for r in [4.0f32, 8.0, 16.0] {
            let mut plain = spec();
            plain.algorithm = Algorithm::Vocoder;
            plain.ratio = r;
            let v = shape(&plain.process(&src, 1, SR), &src, r, period);
            let pv = shape(
                &stretch(&src, 1, SR, r, &spec(), PvsolaParams::default()),
                &src,
                r,
                period,
            );
            assert!(pv > v, "at {r}x the anchoring made it worse: {pv:.4} against {v:.4}");
            margin.push(pv - v);
        }
        assert!(
            margin[2] > margin[0],
            "the gain did not widen with the ratio, so nothing cumulative is being prevented: \
             {:.4} at 16x against {:.4} at 4x",
            margin[2],
            margin[0]
        );
    }

    /// The other side of the trade, stated rather than hidden. Re-anchoring
    /// buys waveform fidelity with small splice artefacts, so the output is
    /// slightly peakier than the vocoder's — measured here so that a future
    /// change which makes it much peakier is caught rather than shipped.
    #[test]
    fn the_splices_cost_a_little_peakiness() {
        let src = saw(110.0, 44_100, 0.5);
        let crest = |v: &[f32]| -> f32 {
            let r = (v.iter().map(|x| x * x).sum::<f32>() / v.len() as f32).sqrt();
            v.iter().fold(0f32, |m, x| m.max(x.abs())) / (r + 1e-12)
        };
        let out = stretch(&src, 1, SR, 8.0, &spec(), PvsolaParams::default());
        let c = crest(&out[20_000..out.len() - 20_000]);
        assert!(c < 3.5, "the splices are doing real damage: crest {c:.2}");
    }

    /// The one knob. If the anchor rate does not change the audio it is not a
    /// control, and this engine is a slower vocoder.
    #[test]
    fn the_anchor_rate_reaches_the_audio() {
        let src = chord(44_100);
        let often = stretch(
            &src,
            1,
            SR,
            4.0,
            &spec(),
            PvsolaParams { anchor_frames: 2, ..PvsolaParams::default() },
        );
        let rarely = stretch(
            &src,
            1,
            SR,
            4.0,
            &spec(),
            PvsolaParams { anchor_frames: 32, ..PvsolaParams::default() },
        );
        let diff: f32 = often.iter().zip(&rarely).map(|(a, b)| (a - b).abs()).sum();
        assert!(diff > 1.0, "the anchor rate did nothing: total difference {diff:.4}");
    }

    #[test]
    fn the_search_reaches_the_audio() {
        let src = chord(44_100);
        let with = stretch(&src, 1, SR, 4.0, &spec(), PvsolaParams::default());
        let without = stretch(
            &src,
            1,
            SR,
            4.0,
            &spec(),
            PvsolaParams { search_ms: 0.0, ..PvsolaParams::default() },
        );
        let diff: f32 = with.iter().zip(&without).map(|(a, b)| (a - b).abs()).sum();
        assert!(diff > 1.0, "the splice search did nothing: total difference {diff:.4}");
    }

    #[test]
    fn something_too_short_to_anchor_falls_back_to_the_vocoder() {
        let src = sine(440.0, 3000, 0.5);
        let out = stretch(&src, 1, SR, 4.0, &spec(), PvsolaParams::default());
        assert_eq!(out.len(), 12_000);
        assert!(rms(&out) > 1e-3, "the fallback produced silence");
    }

    /// The cost has to grow with the ratio, not with its square.
    ///
    /// This engine re-runs the vocoder on overlapping segments, so anything
    /// that is discarded per run is paid for on every run. When the discarded
    /// run-up was measured in input frames it grew with the ratio while the
    /// material it protected did not, and a 16× stretch cost five times what it
    /// should — which is the kind of thing that is invisible until someone
    /// waits for it. The bound is loose because this is wall-clock on a shared
    /// machine; quadratic would miss it by a factor of four even so.
    #[test]
    fn the_cost_grows_with_the_ratio_and_not_its_square() {
        let src = chord(44_100 * 2);
        let time = |r: f32| {
            let s = Stretch { ratio: r, algorithm: Algorithm::Pvsola, ..Default::default() };
            let t = std::time::Instant::now();
            let out = s.process(&src, 1, SR);
            assert!(!out.is_empty());
            t.elapsed().as_secs_f64()
        };
        // Warm the caches so the first call is not the slow one by accident.
        time(2.0);
        let (a, b) = (time(4.0), time(16.0));
        let grew = b / a.max(1e-6);
        assert!(
            grew < 8.0,
            "four times the ratio cost {grew:.1} times the work, which is the square rather \
             than the ratio ({a:.3}s against {b:.3}s)"
        );
    }

    #[test]
    fn silence_stretches_to_silence() {
        let out = stretch(&vec![0f32; 44_100], 1, SR, 4.0, &spec(), PvsolaParams::default());
        assert!(out.iter().all(|v| v.abs() < 1e-5));
    }
}
