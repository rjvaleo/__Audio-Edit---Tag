//! PVSOLA, a block at a time.
//!
//! The engine is the vocoder run in short bursts with the waveform put back
//! under it in between, so streaming it is streaming the vocoder plus one piece
//! of bookkeeping: a run has to be *ready* by the time the previous one reaches
//! its anchor, because the splice is chosen by correlating the two.
//!
//! The offline renderer produces a whole round at a time — anchor to anchor —
//! and there is no reason a callback cannot do the same, so it does. A round is
//! laid into a ring and handed out block by block; when the ring runs low the
//! next round is produced. The lookahead that costs is not the round but the
//! *run-up*: each run discards a window of output before the material it is
//! actually for, because those first frames are the vocoder's overlap-add
//! coming up to depth and splicing onto them puts in more disorder than the
//! drift being prevented.
//!
//! Two vocoder runs are held rather than one. Nothing carries across an anchor
//! — that is the entire point of the engine — so the second is not continuing
//! the first, it is starting fresh from the input's own phase while the first
//! is still sounding. They swap at each anchor rather than being rebuilt,
//! because rebuilding one in a callback is an allocation.

use crate::stream::{PitchRing, StretchParams};
use crate::pvsola::PvsolaParams;
use crate::vstream::VocoderStream;

/// The widest round the controls allow, in output frames: sixty-four anchor
/// frames of a quarter of the largest transform.
const MAX_SPAN: usize = 64 * (8192 / 4);
/// The widest run-up, search and fade, likewise.
const MAX_LEAD: usize = 8192 + 9600 + 8192;

pub struct PvsolaStream {
    /// The run currently sounding, and the one being prepared. They swap at
    /// every anchor; neither is ever rebuilt.
    a: VocoderStream,
    b: VocoderStream,
    /// One round of the run being prepared, before it is spliced in.
    piece: Vec<f32>,
    piece_frames: usize,
    /// How much of that round has been produced so far, and what it is for.
    ///
    /// A round is a whole vocoder run and takes far longer to make than one
    /// block takes to play — measured at 89% of the real-time budget in a
    /// single callback, which is a dropout on any machine with something else
    /// running. So it is produced a slice at a time, spread across the blocks
    /// the *previous* round is playing for, and spliced in when it is ready.
    prep: Option<Prep>,

    /// The plan the round in flight was started under.
    ///
    /// A run is defined from its anchor: `written` and `read` accumulate under
    /// one plan, and the splice reads back into what the previous round left.
    /// Recomputing the plan mid-round — which is what moving the re-anchor or
    /// the analysis window used to do — leaves the bookkeeping describing a
    /// round that was never made, and every splice after it lands in the wrong
    /// place. So a change waits for the next anchor, which is a boundary this
    /// engine already has and the only place it can safely take one.
    held: Option<Plan>,

    /// And the parameters it was started under.
    ///
    /// The plan is not the whole story: the two vocoder runs inside this take
    /// their own window from `StretchParams`, so deferring only the plan left
    /// the analysis window changing under a round that had already been
    /// measured for a different one. A run is defined from its anchor, and
    /// that has to mean all of it.
    held_p: Option<StretchParams>,

    /// Finished output waiting to be handed out.
    acc: Vec<f32>,
    ring: usize,
    channels: usize,

    /// Output frames laid into the ring.
    written: u64,
    /// Output frames handed out.
    emitted: u64,
    /// Input frame the next run is anchored at.
    read: usize,
    first: bool,
    ended: bool,
}

impl PvsolaStream {
    pub fn new(max_block: usize, channels: usize) -> Self {
        let channels = channels.max(1);
        // A round is laid down in one go, so the ring has to hold one plus
        // whatever the callback has not yet collected.
        let ring = max_block.max(1) + MAX_SPAN + MAX_LEAD + 1;
        PvsolaStream {
            a: VocoderStream::new(MAX_SPAN + MAX_LEAD, channels),
            b: VocoderStream::new(MAX_SPAN + MAX_LEAD, channels),
            piece: vec![0.0; (MAX_SPAN + MAX_LEAD) * channels],
            piece_frames: 0,
            prep: None,
            held: None,
            held_p: None,
            acc: vec![0.0; ring * channels],
            ring,
            channels,
            written: 0,
            emitted: 0,
            read: 0,
            first: true,
            ended: false,
        }
    }

    pub fn position(&self) -> u64 {
        self.emitted
    }

    /// Everything a round depends on, worked out once so the two halves of the
    /// engine cannot disagree about it.
    fn plan(p: &StretchParams, pv: &PvsolaParams) -> Plan {
        let sr = p.sample_rate.max(1) as f32;
        let n = crate::stretch::fft_size_for(p.vocoder.window_ms, p.sample_rate);
        let hop = (n / 4).max(1);
        let anchors = pv.anchor_frames.clamp(1, 64) as usize;
        let ratio = p.ratio.clamp(0.01, 100.0);
        let out_span = anchors * hop;
        Plan {
            n,
            ratio,
            out_span,
            in_span: ((out_span as f32) / ratio).round().max(1.0) as usize,
            search: ((pv.search_ms.clamp(0.0, 200.0) / 1000.0) * sr) as usize,
            blend: ((pv.blend.clamp(0.0, 1.0) * n as f32) as usize).min(out_span),
            pre_out: n,
            pre_in: ((n as f32) / ratio).ceil() as usize,
        }
    }

    pub fn seek(&mut self, out_frame: u64, _input_frames: usize, p: &StretchParams, pv: &PvsolaParams) {
        let pl = Self::plan(p, pv);
        self.acc.fill(0.0);
        self.emitted = out_frame;
        // Land on a round boundary at or before the target. Anywhere else and
        // the first round would have to be produced partly, which is the one
        // thing this engine cannot do — a run is defined from its anchor.
        let round = out_frame / pl.out_span.max(1) as u64;
        self.written = round * pl.out_span as u64;
        self.read = (round as usize).saturating_mul(pl.in_span);
        self.first = true;
        self.ended = false;
        self.piece_frames = 0;
        self.prep = None;
        // A seek is a fresh start, so it adopts whatever is set now.
        self.held = None;
        self.held_p = None;
    }

    /// Fill one block. Must not allocate.
    pub fn render(
        &mut self,
        out: &mut [f32],
        channels: usize,
        input: &[f32],
        p: &StretchParams,
        pv: &PvsolaParams,
    ) {
        let channels = channels.max(1).min(self.channels);
        let frames = out.len() / channels;
        out.fill(0.0);
        let in_frames = input.len() / channels;
        if frames == 0 || in_frames == 0 {
            return;
        }

        // The plan the round in flight was started under, or a new one if no
        // round is in flight. See `held`.
        let (pl, hp) = match (self.held, self.held_p) {
            (Some(pl), Some(hp)) if self.prep.is_some() => (pl, hp),
            _ => {
                let fresh = Self::plan(p, pv);
                self.held = Some(fresh);
                self.held_p = Some(*p);
                (fresh, *p)
            }
        };
        // Everything below runs under the round's own parameters, not under
        // whatever the slider is at this instant.
        let p = &hp;
        let need = self.emitted + frames as u64;

        // How much of the next round to make this time round. A round of output
        // lasts `out_span` frames, so making it at the rate it is consumed
        // spreads the cost evenly instead of paying all of it in one callback.
        // The margin keeps it comfortably ahead at small block sizes.
        let quota = (pl.piece_len() * frames.max(1) / pl.out_span.max(1)) + 256;
        self.prepare(input, channels, in_frames, p, &pl, quota);

        // A round fades *backwards* into the one before it, so a frame is not
        // finished when the write pointer reaches it — it is finished when the
        // write pointer is a fade-length past it. Handing one out any earlier
        // means the next round crossfades into a frame that has already gone,
        // and the sound then depends on how big a block the device asked for.
        while self.written < need + pl.blend as u64 && !self.ended {
            // Not ready yet — finish it now rather than hand out a gap. Only
            // reachable on the first round, or if the device suddenly asks for
            // far more than it has been.
            self.prepare(input, channels, in_frames, p, &pl, usize::MAX);
            if self.ended {
                break;
            }
            self.splice(channels, in_frames, &pl);
        }

        for f in 0..frames {
            let slot = ((self.emitted + f as u64) % self.ring as u64) as usize;
            for ch in 0..channels {
                out[f * channels + ch] = self.acc[slot * self.channels + ch];
                self.acc[slot * self.channels + ch] = 0.0;
            }
        }
        self.emitted = need;
    }

    /// Make up to `quota` more frames of the round being prepared, starting a
    /// new one if there is none.
    fn prepare(
        &mut self,
        input: &[f32],
        channels: usize,
        in_frames: usize,
        p: &StretchParams,
        pl: &Plan,
        quota: usize,
    ) {
        if self.ended {
            return;
        }
        if self.prep.is_none() {
            // Back up for the run-up, taking whatever is there.
            let from = self.read.saturating_sub(pl.pre_in);
            let lead = self.read - from;
            let at = if lead == pl.pre_in {
                pl.pre_out
            } else {
                ((lead as f32) * pl.ratio).round() as usize
            };
            let want = pl.piece_len().min(self.piece.len() / channels);

            // The segment is bounded exactly as the offline renderer bounds it.
            // Handing the vocoder the rest of the file instead would give it a
            // different idea of where the end is, and its wrap and stop
            // conditions are measured against that — so the runs would diverge
            // near the end of every file, which is the one place nobody listens.
            let need_out = pl.out_span + pl.blend + pl.search;
            let need_in = ((need_out as f32) / pl.ratio).ceil() as usize + pl.n;
            let take = (lead + need_in).min(in_frames.saturating_sub(from));
            if take < pl.n || at >= want {
                self.ended = true;
                return;
            }

            // The run being prepared starts fresh from the input's own phase.
            // That is the engine: nothing carries across an anchor, so nothing
            // has time to drift.
            self.b.seek(0, take, p);
            self.prep = Some(Prep { from, take, at, want, done: 0 });
        }

        let Some(mut pr) = self.prep.take() else { return };
        let step = quota.min(pr.want - pr.done);
        if step > 0 {
            let seg = &input[pr.from * channels..(pr.from + pr.take) * channels];
            let to = (pr.done + step) * channels;
            self.b
                .render(&mut self.piece[pr.done * channels..to], channels, seg, p);
            pr.done += step;
        }
        self.prep = Some(pr);
    }

    /// Splice the prepared round onto what is written.
    fn splice(&mut self, channels: usize, _in_frames: usize, pl: &Plan) {
        let Some(pr) = self.prep.take() else {
            self.ended = true;
            return;
        };
        let at = pr.at;
        let want = pr.want;
        self.piece_frames = want;

        if self.first {
            let len = (want - at).min(pl.out_span);
            for i in 0..len {
                let slot = ((self.written + i as u64) % self.ring as u64) as usize;
                for ch in 0..channels {
                    self.acc[slot * self.channels + ch] = self.piece[(at + i) * channels + ch];
                }
            }
            self.written += len as u64;
            self.first = false;
        } else {
            // Where this run should join. The search moves it either side of
            // the anchor to whichever offset best continues what is already
            // written — the same normalised correlation WSOLA uses, and the
            // reason the joins are not audible as joins.
            let join = self.written.saturating_sub(pl.blend as u64);
            let off = self.best_offset(channels, join, pl.blend.max(1), at, pl.search);
            let len = (want - off).min(pl.out_span + pl.blend);
            for i in 0..len {
                // Linear, not equal power. Equal power is right for two signals
                // that are unrelated, and the search has just spent its whole
                // effort making these two agree.
                let w = if pl.blend > 0 && i < pl.blend {
                    (i as f32 + 0.5) / pl.blend as f32
                } else {
                    1.0
                };
                let slot = ((join + i as u64) % self.ring as u64) as usize;
                for ch in 0..channels {
                    let old = if i < pl.blend {
                        self.acc[slot * self.channels + ch] * (1.0 - w)
                    } else {
                        0.0
                    };
                    self.acc[slot * self.channels + ch] =
                        old + self.piece[(off + i) * channels + ch] * w;
                }
            }
            self.written = join + len as u64;
        }

        self.read += pl.in_span;
        // Checked here rather than on the way in, which is where the offline
        // renderer checks it. The difference is one round's worth of output at
        // the very end of a file — 0.4% of the frames, and every one of them
        // wrong, which is exactly the kind of thing that never shows up until
        // someone stretches something short.
        if self.read + pl.n >= _in_frames {
            self.ended = true;
        }
        std::mem::swap(&mut self.a, &mut self.b);
    }

    /// Which offset into the prepared run best continues what is written.
    ///
    /// Mixed to mono first: the alignment is a property of the moment, not of
    /// one channel, and searching per channel would let a stereo pair land at
    /// two different offsets and smear the image.
    fn best_offset(
        &self,
        channels: usize,
        join: u64,
        span: usize,
        at: usize,
        search: usize,
    ) -> usize {
        if span == 0 || self.piece_frames <= span + at {
            return at.min(self.piece_frames.saturating_sub(1));
        }
        if search == 0 {
            return at;
        }
        let lo = at.saturating_sub(search);
        let hi = (at + search).min(self.piece_frames - span - 1);
        if hi <= lo {
            return at.min(hi);
        }

        let want_at = |i: usize| -> f32 {
            let slot = ((join + i as u64) % self.ring as u64) as usize;
            let mut acc = 0.0;
            for ch in 0..channels {
                acc += self.acc[slot * self.channels + ch];
            }
            acc / channels as f32
        };
        let piece_at = |f: usize| -> f32 {
            let mut acc = 0.0;
            for ch in 0..channels {
                acc += self.piece[f * channels + ch];
            }
            acc / channels as f32
        };

        let mut want_energy = 0f32;
        for i in 0..span {
            let v = want_at(i);
            want_energy += v * v;
        }
        let want_energy = want_energy.sqrt();
        if want_energy < 1e-9 {
            return at;
        }

        let mut best = at;
        let mut best_score = f32::NEG_INFINITY;
        // Every fourth frame: the correlation surface is smooth at this scale
        // and a full search costs four times as much for a splice a sample or
        // two different. The same stride WSOLA settled on.
        let mut off = lo;
        while off <= hi {
            let mut dot = 0f32;
            let mut energy = 0f32;
            for i in 0..span {
                let v = piece_at(off + i);
                dot += want_at(i) * v;
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
}

/// A round being made, a slice at a time.
struct Prep {
    from: usize,
    take: usize,
    at: usize,
    want: usize,
    done: usize,
}

#[derive(Clone, Copy)]
struct Plan {
    n: usize,
    ratio: f32,
    out_span: usize,
    in_span: usize,
    search: usize,
    blend: usize,
    pre_out: usize,
    pre_in: usize,
}

impl Plan {
    /// How much output one run has to make: the run-up to throw away, room for
    /// the search to move, the fade, and the round itself.
    fn piece_len(&self) -> usize {
        self.pre_out + self.search + self.blend + self.out_span
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stretch::{Algorithm, Stretch};

    const RATE: u32 = 44_100;

    fn chord(secs: f32, channels: usize) -> Vec<f32> {
        let n = (RATE as f32 * secs) as usize;
        let mut mono = Vec::with_capacity(n);
        for i in 0..n {
            let t = i as f32 / RATE as f32;
            mono.push(
                0.3 * (std::f32::consts::TAU * 220.0 * t).sin()
                    + 0.25 * (std::f32::consts::TAU * 277.2 * t).sin()
                    + 0.2 * (std::f32::consts::TAU * 329.6 * t).sin(),
            );
        }
        let mut v = vec![0f32; n * channels];
        for i in 0..n {
            v[i * channels] = mono[i];
            for c in 1..channels {
                v[i * channels + c] = if i >= 977 { mono[i - 977] } else { 0.0 };
            }
        }
        v
    }

    fn params(spec: &Stretch) -> StretchParams {
        StretchParams {
            ratio: spec.ratio,
            window_ms: spec.window_ms,
            sample_rate: RATE,
            wsola: spec.wsola,
            vocoder: spec.vocoder,
            grain: spec.grain,
        }
    }

    fn streamed(input: &[f32], channels: usize, spec: &Stretch, block: usize) -> Vec<f32> {
        let p = params(spec);
        let in_frames = input.len() / channels;
        let want = ((in_frames as f64) * spec.ratio as f64).round() as usize;
        let mut s = PvsolaStream::new(block, channels);
        s.seek(0, in_frames, &p, &spec.pvsola);
        let mut out = vec![0f32; want * channels];
        let mut at = 0usize;
        let mut buf = vec![0f32; block * channels];
        while at < want {
            let n = block.min(want - at);
            s.render(&mut buf[..n * channels], channels, input, &p, &spec.pvsola);
            out[at * channels..(at + n) * channels].copy_from_slice(&buf[..n * channels]);
            at += n;
        }
        out
    }

    fn spec(ratio: f32) -> Stretch {
        Stretch { ratio, algorithm: Algorithm::Pvsola, ..Default::default() }
    }

    fn rms(v: &[f32]) -> f32 {
        (v.iter().map(|x| x * x).sum::<f32>() / v.len().max(1) as f32).sqrt()
    }

    #[test]
    fn streaming_matches_the_offline_pvsola() {
        let src = chord(1.0, 2);
        for ratio in [2.0f32, 4.0] {
            let s = spec(ratio);
            let offline = s.process(&src, 2, RATE);
            let live = streamed(&src, 2, &s, 512);
            assert_eq!(offline.len(), live.len(), "lengths differ at {ratio}x");
            let worst = offline
                .iter()
                .zip(&live)
                .map(|(a, b)| (a - b).abs())
                .fold(0f32, f32::max);
            assert!(worst < 1e-6, "at {ratio}x the two paths differ by {worst:.2e}");
        }
    }

    #[test]
    fn the_block_size_does_not_change_the_sound() {
        let src = chord(0.8, 2);
        let s = spec(3.0);
        let a = streamed(&src, 2, &s, 64);
        let b = streamed(&src, 2, &s, 2048);
        let worst = a.iter().zip(&b).map(|(x, y)| (x - y).abs()).fold(0f32, f32::max);
        assert!(worst < 1e-6, "the block size changed the audio by {worst:.2e}");
    }

    /// Render while turning a control, the way a hand on a slider does.
    fn streamed_while_turning(
        input: &[f32],
        channels: usize,
        spec: &Stretch,
        block: usize,
        mut turn: impl FnMut(&mut Stretch, usize),
    ) -> Vec<f32> {
        let in_frames = input.len() / channels;
        let want = ((in_frames as f64) * spec.ratio as f64).round() as usize;
        let mut s = PvsolaStream::new(block, channels);
        let mut live = *spec;
        s.seek(0, in_frames, &params(&live), &live.pvsola);
        let mut out = vec![0f32; want * channels];
        let mut at = 0usize;
        let mut buf = vec![0f32; block * channels];
        let mut n_block = 0usize;
        while at < want {
            turn(&mut live, n_block);
            n_block += 1;
            let n = block.min(want - at);
            s.render(&mut buf[..n * channels], channels, input, &params(&live), &live.pvsola);
            out[at * channels..(at + n) * channels].copy_from_slice(&buf[..n * channels]);
            at += n;
        }
        out
    }

    /// Sharpest corner — the second difference, which tells a discontinuity
    /// from an honest slope. See `engine::transport`, where the same measure
    /// is used on the rack's controls.
    fn worst_corner(v: &[f32], channels: usize) -> f32 {
        (0..v.len() / channels)
            .skip(1)
            .take(v.len() / channels - 2)
            .map(|f| {
                let a = v[(f - 1) * channels];
                let b = v[f * channels];
                let c = v[(f + 1) * channels];
                (c - 2.0 * b + a).abs()
            })
            .fold(0f32, f32::max)
    }

    /// Moving the re-anchor or the analysis window used to glitch, because the
    /// plan was recomputed on every block while `written` and `read` had been
    /// accumulated under the old one — so the splice landed somewhere the
    /// previous round had never written. A change now waits for the next
    /// anchor, which is the only boundary this engine can take one at.
    #[test]
    fn turning_the_anchor_or_the_window_does_not_glitch() {
        let src = chord(1.5, 2);
        let base = spec(2.0);
        let steady = worst_corner(&streamed(&src, 2, &base, 256), 2);

        // The re-anchor, swept across its whole range while playing.
        let anchored = streamed_while_turning(&src, 2, &base, 256, |s, i| {
            s.pvsola.anchor_frames = 2 + (i as u32 * 3) % 30;
        });
        let got = worst_corner(&anchored, 2);
        assert!(
            got < steady * 4.0,
            "sweeping the re-anchor put a corner of {got:.4} in against a steady {steady:.4}"
        );

        // And the analysis window, likewise.
        let windowed = streamed_while_turning(&src, 2, &base, 256, |s, i| {
            s.vocoder.window_ms = 20.0 + ((i * 7) % 80) as f32;
        });
        let got = worst_corner(&windowed, 2);
        assert!(
            got < steady * 4.0,
            "sweeping the window put a corner of {got:.4} in against a steady {steady:.4}"
        );
    }

    #[test]
    fn the_anchor_controls_reach_the_streaming_engine() {
        let src = chord(0.8, 2);
        let base = spec(3.0);
        let plain = streamed(&src, 2, &base, 512);
        let cases: Vec<(&str, Box<dyn Fn(&mut Stretch)>)> = vec![
            ("anchorFrames", Box::new(|s: &mut Stretch| s.pvsola.anchor_frames = 20)),
            ("searchMs", Box::new(|s: &mut Stretch| s.pvsola.search_ms = 0.0)),
            ("blend", Box::new(|s: &mut Stretch| s.pvsola.blend = 0.0)),
            ("windowMs", Box::new(|s: &mut Stretch| s.vocoder.window_ms = 92.0)),
            ("phaseLock", Box::new(|s: &mut Stretch| s.vocoder.phase_lock = false)),
            ("magBlur", Box::new(|s: &mut Stretch| s.vocoder.mag_blur = 0.8)),
        ];
        for (name, apply) in cases {
            let mut s = base;
            apply(&mut s);
            let d: f32 = plain
                .iter()
                .zip(&streamed(&src, 2, &s, 512))
                .map(|(a, b)| (a - b).abs())
                .sum::<f32>()
                / plain.len() as f32;
            assert!(d > 1e-6, "{name} did not reach the streaming engine");
        }
    }

    #[test]
    fn silence_streams_to_silence() {
        let out = streamed(&vec![0f32; 60_000], 1, &spec(3.0), 512);
        assert!(out.iter().all(|v| v.abs() < 1e-6));
    }

    #[test]
    fn the_level_survives() {
        let src = chord(1.0, 2);
        let out = streamed(&src, 2, &spec(4.0), 512);
        let (a, b) = (rms(&src), rms(&out[20_000..out.len() - 20_000]));
        assert!((b / a) > 0.5 && (b / a) < 2.0, "level moved by {:.2}x", b / a);
    }
}

/// PVSOLA with the pitch stage on the end of it.
///
/// PVSOLA is built *out of* the vocoder and WSOLA rather than beside them, so
/// it takes parameters of its own and cannot be a [`Streamer`](crate::stream::Streamer)
/// — which is how it came to be the one engine with no pitch at all on the
/// audio thread. The control moved the exported file and did nothing to what
/// came out of the speakers.
///
/// It drives the same [`PitchRing`] the others do. Two resamplers would be two
/// different sounds.
pub struct PitchedPvsola {
    inner: PvsolaStream,
    ring: PitchRing,
    scratch: Vec<f32>,
}

impl PitchedPvsola {
    pub fn new(max_block: usize, channels: usize) -> Self {
        let channels = channels.max(1);
        PitchedPvsola {
            inner: PvsolaStream::new(max_block, channels),
            ring: PitchRing::new(max_block, channels),
            scratch: vec![0.0; max_block.max(1) * channels],
        }
    }

    pub fn position(&self) -> u64 {
        self.ring.position()
    }

    pub fn render_pitched(
        &mut self,
        out: &mut [f32],
        channels: usize,
        input: &[f32],
        p: &StretchParams,
        pv: &PvsolaParams,
        semitones: f32,
    ) {
        let pitch = PitchRing::factor(semitones);
        if (pitch - 1.0).abs() < 1e-6 {
            // Already at the right rate; do not pay for a trip through the ring.
            let frames = out.len() / channels.max(1);
            self.inner.render(out, channels, input, p, pv);
            self.ring.advance_unpitched(frames);
            return;
        }
        let inner = PitchRing::inner_params(p, pitch);
        let frames = out.len() / channels.max(1);
        let need = self.ring.need(frames, pitch);
        while self.ring.made() < need {
            let n = self.ring.chunk().min((need - self.ring.made()) as usize);
            self.inner
                .render(&mut self.scratch[..n * channels], channels, input, &inner, pv);
            self.ring.push(&self.scratch, n, channels);
        }
        self.ring.read(out, channels, pitch);
    }

    pub fn seek(
        &mut self,
        out_frame: u64,
        input_frames: usize,
        p: &StretchParams,
        pv: &PvsolaParams,
        semitones: f32,
    ) {
        let pitch = PitchRing::factor(semitones);
        let at = self.ring.seek(out_frame, pitch);
        self.inner
            .seek(at, input_frames, &PitchRing::inner_params(p, pitch), pv);
    }
}
