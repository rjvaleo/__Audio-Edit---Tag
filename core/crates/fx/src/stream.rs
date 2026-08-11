//! Stretching a block at a time, for the audio callback.
//!
//! The engines in this crate were written as whole-buffer renders: hand them a
//! file, get a file back. That is the wrong shape for playback. An audio
//! callback is handed a few hundred frames, must return before the device wants
//! them, and must not allocate on the way — so an engine that needs the whole
//! input before it can produce the first sample can only ever be heard by
//! rendering it first and playing the result.
//!
//! A streaming engine keeps its own state between blocks instead. WSOLA's is
//! small and obvious: where it read from last, where it is writing to, and the
//! stretch of waveform it expects to follow what it just laid down. Everything
//! else it needs is either in the source or in the parameters.
//!
//! Two rules shape everything here, and both are load-bearing.
//!
//! **No allocation once built.** Every buffer is sized at construction from the
//! widest settings the controls allow, not from the current ones, because the
//! current ones can change between two blocks and a resize in the callback is a
//! dropout. Anything that genuinely must allocate — the transient map, which is
//! computed from the whole file — is built on the caller's thread and handed
//! over, the same way the rack is.
//!
//! **The offline render drives the same streamer.** `stretch::wsola` is now a
//! loop over this, so "what you hear is what you export" is true by
//! construction rather than by a test that has to be remembered. If the two
//! ever disagree it is a bug in one caller, not a difference between two
//! algorithms.

use crate::stretch::{VocoderParams, WinShape, WsolaParams};
use crate::Grain;

/// The longest window any control allows, in milliseconds. Buffers are sized
/// from this rather than from the current setting, because the setting can move
/// between blocks.
const MAX_WINDOW_MS: f32 = 2000.0;

/// Everything a streaming engine needs that is not the audio itself.
///
/// Copied into the callback each block, so it must stay cheap to copy — which
/// is why the transient map is not in here but held by the streamer.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StretchParams {
    pub ratio: f32,
    pub window_ms: f32,
    pub sample_rate: u32,
    pub wsola: WsolaParams,
    pub vocoder: VocoderParams,
    pub grain: Grain,
}

/// How a block-at-a-time engine is driven.
///
/// Deliberately the same shape as `engine::BlockRenderer`, which is the grain
/// cloud's version of exactly this — one of these can stand in for it.
pub trait Streamer: Send {
    /// Fill `out` (interleaved, `channels` wide) with the next block, reading
    /// from `input`. Must not allocate.
    fn render(&mut self, out: &mut [f32], channels: usize, input: &[f32], p: &StretchParams);

    /// Move to an output frame. Anything in flight belongs to where we were.
    fn seek(&mut self, out_frame: u64, input_frames: usize, p: &StretchParams);

    /// Output frames produced so far.
    fn position(&self) -> u64;
}

/// Waveform-similarity overlap-add, a block at a time.
///
/// The overlap-add is the only awkward part. A window laid down at the current
/// write position runs on past the end of this block, so the sum cannot be
/// divided by its window total until every window that touches a frame has been
/// laid down. Frames are therefore accumulated into a ring long enough to hold
/// the widest window, and only handed out once the write pointer has passed
/// them — at which point nothing further can contribute.
pub struct WsolaStream {
    /// Accumulated output, interleaved, not yet normalised.
    acc: Vec<f32>,
    /// Summed window height per frame, alongside `acc`.
    norm: Vec<f32>,
    /// Frames in the ring.
    ring: usize,
    channels: usize,

    /// The segment expected to follow what was just written; the next window is
    /// chosen to resemble it.
    expect: Vec<f32>,
    /// Precomputed window, when nothing varies its length.
    window: Vec<f32>,
    /// The shape `window` was built for, so it is rebuilt only when it changes.
    window_for: Option<(usize, WinShape, u32)>,

    /// Where the next window reads from.
    read: usize,
    /// Output frame the next window is laid at.
    write: u64,
    /// Output frames already handed out.
    emitted: u64,
    /// Grain index, which is what all the randomness is addressed by.
    index: u64,
    first: bool,

    /// Where each output instant comes from, when transients are being held at
    /// their original rate. `None` is the ordinary case and means a straight
    /// line, which is arithmetic rather than a lookup — worth the branch
    /// because the alternative is rebuilding a map every time the ratio moves,
    /// and the ratio moves under the pointer.
    ///
    /// Built off the audio thread when it is needed at all, because deriving it
    /// runs an onset detector over the whole file and allocates.
    map: Option<crate::transient::TimeMap>,
    /// Dropped because the ring could not hold the window. Surfaced rather than
    /// silently degrading, exactly as the voice pool's overflow is.
    pub overflows: u64,
}

impl WsolaStream {
    /// Build one sized for the widest settings the controls allow.
    ///
    /// `max_block` is the largest block the device may ask for. Everything is
    /// allocated here and nothing after.
    pub fn new(max_block: usize, channels: usize, sample_rate: u32) -> Self {
        let channels = channels.max(1);
        let max_win = (((MAX_WINDOW_MS / 1000.0) * sample_rate.max(1) as f32) as usize).max(64);
        // A window laid at the far end of a block still has to fit, so the ring
        // holds a block and a window and one spare frame to keep the write
        // pointer from ever meeting the read pointer exactly.
        let ring = max_block.max(1) + max_win + 1;
        WsolaStream {
            acc: vec![0.0; ring * channels],
            norm: vec![0.0; ring],
            ring,
            channels,
            expect: vec![0.0; max_win * channels],
            window: Vec::with_capacity(max_win),
            window_for: None,
            read: 0,
            write: 0,
            emitted: 0,
            index: 0,
            first: true,
            map: None,
            overflows: 0,
        }
    }

    /// Hand over a freshly built transient map, or `None` for a straight line.
    ///
    /// Separate from `render` because building one walks the whole file. The
    /// caller does it on its own thread and leaves the result here, which is
    /// the same arrangement the rack uses for the same reason.
    pub fn set_map(&mut self, map: Option<crate::transient::TimeMap>) {
        self.map = map;
    }

    /// Where the read pointer nominally sits for an output frame.
    ///
    /// Without transient preservation this is a straight line and needs no map
    /// at all, which is what lets the ratio move freely without anything being
    /// rebuilt off-thread.
    #[inline]
    fn nominal(&self, out_frame: f64, ratio: f32, in_frames: usize) -> f32 {
        match &self.map {
            Some(m) => m.input_at(out_frame) as f32,
            None => (out_frame / ratio.max(1e-6) as f64).clamp(0.0, in_frames as f64) as f32,
        }
    }

    /// The map the current parameters imply. Allocates — never call from the
    /// audio thread.
    pub fn build_map(
        input: &[f32],
        channels: usize,
        sample_rate: u32,
        ratio: f32,
        hop_out: usize,
        p: &WsolaParams,
    ) -> Option<crate::transient::TimeMap> {
        if !p.preserve_transients {
            return None;
        }
        let in_frames = input.len() / channels.max(1);
        let hits = crate::transient::onsets(input, channels, sample_rate, p.sensitivity, p.floor);
        let guard = ((hop_out as f32) * p.guard_hops.clamp(1.0, 16.0)) as usize;
        Some(crate::transient::TimeMap::with_transients(
            in_frames,
            ratio,
            &hits,
            guard.max(1),
        ))
    }

    fn clear_ring(&mut self) {
        self.acc.fill(0.0);
        self.norm.fill(0.0);
    }

    /// Rebuild the precomputed window only when its shape actually changed.
    fn ensure_window(&mut self, len: usize, shape: WinShape, skew: f32) {
        let key = (len, shape, skew.to_bits());
        if self.window_for == Some(key) {
            return;
        }
        self.window.clear();
        for i in 0..len {
            self.window.push(crate::stretch::shape_at(i, len, shape, skew));
        }
        self.window_for = Some(key);
    }
}

impl Streamer for WsolaStream {
    fn position(&self) -> u64 {
        self.emitted
    }

    fn seek(&mut self, out_frame: u64, input_frames: usize, p: &StretchParams) {
        self.clear_ring();
        self.emitted = out_frame;
        self.write = out_frame;
        self.first = true;
        let sr = p.sample_rate.max(1) as f32;
        let win = (((p.window_ms.clamp(5.0, MAX_WINDOW_MS) / 1000.0) * sr) as usize).max(64) & !1;
        let hop = crate::stretch::hop_frames(&p.grain, win, sr).max(1);
        // The index is derived from where we are rather than from how many
        // windows have been laid, so seeking to a moment gives the same splices
        // as playing to it. The grain cloud does the same, for the same reason.
        self.index = out_frame / hop as u64;
        let nominal = self.nominal(out_frame as f64, p.ratio, input_frames);
        let scan = p.grain.scan.clamp(-4.0, 4.0);
        let swept = if scan < 0.0 {
            input_frames as f32 + nominal * scan
        } else {
            nominal * scan
        };
        // This layer's own throw, so layers read different audio rather than
        // the same instant laid down a fixed offset apart — which is a delay
        // line and combs.
        self.read = crate::stretch::place(swept + p.grain.layer_read, input_frames, p.grain.wrap);
    }

    fn render(&mut self, out: &mut [f32], channels: usize, input: &[f32], p: &StretchParams) {
        let channels = channels.max(1).min(self.channels);
        let frames = out.len() / channels.max(1);
        out.fill(0.0);
        let in_frames = input.len() / channels.max(1);
        if frames == 0 || in_frames == 0 {
            return;
        }

        let sr = p.sample_rate.max(1) as f32;
        let ratio = p.ratio.clamp(0.01, 100.0);
        let win = (((p.window_ms.clamp(5.0, MAX_WINDOW_MS) / 1000.0) * sr) as usize).max(64) & !1;
        let hop_out = crate::stretch::hop_frames(&p.grain, win, sr).max(1);
        let search = (((p.wsola.search_ms.clamp(0.0, 200.0)) / 1000.0) * sr) as usize;
        let g = &p.grain;
        let steady = g.size_jitter.abs() < 1e-6;
        let pos_jitter = (g.position_jitter_ms / 1000.0) * sr;
        let scan = g.scan.clamp(-4.0, 4.0);

        if steady {
            self.ensure_window(win, p.wsola.shape, g.envelope);
        }

        // Lay down every window that starts before the end of what this block
        // has to hand out. A window reaching past that is fine — the ring holds
        // it and the next block finishes it.
        let need = self.emitted + frames as u64;
        while self.write < need {
            let pos = if self.first {
                self.first = false;
                self.read
            } else {
                crate::stretch::best_offset(
                    input,
                    channels,
                    self.read,
                    search,
                    &self.expect[..hop_out * channels],
                    hop_out,
                    p.wsola,
                )
            };

            let len = crate::stretch::grain_size(g, self.index, win);
            let take = if pos_jitter > 0.0 {
                let j = pos_jitter * g.rand_bipolar(self.index, g.salt(5));
                crate::stretch::place(pos as f32 + j, in_frames, g.wrap)
            } else {
                pos
            };
            let rate = crate::stretch::grain_rate(g, self.index, self.write as f32 / sr);
            let (gl, gr) = crate::grain::pan_gains(g, self.index, channels);
            let span = (len as f32) * rate;

            if len >= self.ring {
                // Wider than the ring can hold. Only reachable if a device asks
                // for a far larger block than it promised; counted rather than
                // written past the end of the buffer.
                self.overflows += 1;
            } else {
                for i in 0..len {
                    let w = if steady {
                        self.window[i]
                    } else {
                        crate::stretch::shape_at(i, len, p.wsola.shape, g.envelope)
                    };
                    let frame = self.write + i as u64;
                    let slot = (frame % self.ring as u64) as usize;
                    let step = if g.reverse {
                        span - (i as f32) * rate
                    } else {
                        (i as f32) * rate
                    };
                    let src = take as f32 + step;
                    if src >= (in_frames - 1) as f32 || src < 0.0 {
                        continue;
                    }
                    for ch in 0..channels {
                        let pan = if ch == 0 { gl } else { gr };
                        self.acc[slot * self.channels + ch] += crate::stretch::read_at(
                            input, channels, ch, src, in_frames,
                        ) * w * pan;
                    }
                    self.norm[slot] += w;
                }
            }

            // What naturally follows the window just taken.
            let tail = pos + hop_out;
            for i in 0..hop_out {
                for ch in 0..channels {
                    let s = (tail + i) * channels + ch;
                    self.expect[i * channels + ch] =
                        if s < input.len() { input[s] } else { 0.0 };
                }
            }

            self.write += hop_out as u64;
            self.index += 1;
            let nominal = self.nominal(self.write as f64, ratio, in_frames);
            let swept = if scan < 0.0 {
                in_frames as f32 + nominal * scan
            } else {
                nominal * scan
            };
            self.read = crate::stretch::place(swept + g.layer_read, in_frames, g.wrap);
        }

        // Hand out the finished frames and clear them for reuse. Nothing can
        // contribute to a frame the write pointer has already passed.
        for f in 0..frames {
            let frame = self.emitted + f as u64;
            let slot = (frame % self.ring as u64) as usize;
            let n = self.norm[slot];
            for ch in 0..channels {
                let v = self.acc[slot * self.channels + ch];
                out[f * channels + ch] = if n > 1e-6 { v / n } else { v };
            }
            for ch in 0..self.channels {
                self.acc[slot * self.channels + ch] = 0.0;
            }
            self.norm[slot] = 0.0;
        }
        self.emitted = need;
    }
}

/// A streaming engine with pitch shifting on the end of it.
///
/// Pitch is time stretching plus resampling: stretch by the pitch factor on top
/// of the ratio, then read the result back that much faster. The two length
/// changes cancel and the duration is the ratio's alone. The offline renderer
/// does exactly this, so streaming has to as well or the two stop matching —
/// pitch is not something that can be folded into the splice and still be the
/// same sound.
///
/// The resampler pulls: to hand out N frames it needs about N × pitch frames of
/// stretched audio, which it takes from the inner engine in chunks and keeps in
/// a ring. Sized for the widest pitch the control allows, so nothing is
/// allocated once it exists.
pub struct Pitched<S: Streamer> {
    inner: S,
    ring: PitchRing,
    scratch: Vec<f32>,
}

/// The widest pitch shift the control allows, as a rate multiplier. Buffers are
/// sized from this, not from the current setting.
const MAX_PITCH: f32 = 20.0;

/// The resampling half of pitch shifting, with no engine attached.
///
/// [`Pitched`] is this plus a [`Streamer`]. PVSOLA and the hybrid cannot be
/// `Streamer`s — one needs parameters of its own and the other reads a
/// separated source rather than the input — so they drive this directly
/// instead. **One implementation either way**, which is the whole point: two
/// resamplers is two different sounds, and it would be the third time this
/// project had the same thing implemented twice and drifting.
///
/// It **pulls**. To hand out N frames it needs about N × pitch frames of
/// stretched audio, which the owner renders in chunks and pushes in. Sized for
/// the widest pitch the control allows, so nothing is allocated once it exists.
pub struct PitchRing {
    /// Stretched audio waiting to be read back at a rate.
    buf: Vec<f32>,
    ring: usize,
    channels: usize,
    /// Stretched frames pushed in so far, counted from the start of the file.
    made: u64,
    /// Where the read position was when the pitch last changed.
    base: f64,
    /// Output frames read since then.
    ///
    /// The read position is *derived* from these two rather than accumulated,
    /// so that at a steady pitch it is exactly `f × pitch` — the same
    /// expression the offline resampler uses. Accumulating would drift away
    /// from it over a long render.
    since: u64,
    last_pitch: f32,
    /// Output frames handed out.
    emitted: u64,
    /// The earliest stretched frame this run holds.
    ///
    /// The interpolator reaches one frame back, and after a seek there is
    /// nothing there. The offline resampler clamps its index to the start of
    /// the buffer; this clamps to the start of the run, which is the same
    /// thing said in streaming terms.
    origin: u64,
    /// How much the engine is asked for at a time.
    chunk: usize,
}

impl PitchRing {
    pub fn new(max_block: usize, channels: usize) -> Self {
        let channels = channels.max(1);
        let chunk = max_block.max(1);
        // Room for the fastest read the control allows, plus one chunk so a
        // pull always has somewhere to land, plus the four frames the
        // interpolator spans.
        let ring = ((max_block as f32 * MAX_PITCH) as usize) + chunk + 8;
        PitchRing {
            buf: vec![0.0; ring * channels],
            ring,
            channels,
            made: 0,
            base: 0.0,
            since: 0,
            last_pitch: 1.0,
            emitted: 0,
            origin: 0,
            chunk,
        }
    }

    /// The fractional read position along the stretched timeline.
    fn pos(&self) -> f64 {
        self.base + self.since as f64 * self.last_pitch as f64
    }

    /// Rebase when the pitch moves, so a change does not jump the read.
    fn retune(&mut self, pitch: f32) {
        if (pitch - self.last_pitch).abs() > 1e-9 {
            self.base = self.pos();
            self.since = 0;
            self.last_pitch = pitch;
        }
    }

    /// Semitones as a rate multiplier, clamped where the buffers assume.
    pub fn factor(semitones: f32) -> f32 {
        2f32.powf(semitones / 12.0).clamp(1.0 / MAX_PITCH, MAX_PITCH)
    }

    /// The ratio the engine underneath must be driven at.
    ///
    /// Pitch shifting is stretching plus reading back faster, so the engine
    /// runs at ratio × pitch and the extra length is taken back out by the
    /// read rate. The two cancel and the duration is the ratio's alone.
    pub fn inner_params(p: &StretchParams, pitch: f32) -> StretchParams {
        let mut inner = *p;
        inner.ratio = (p.ratio * pitch).clamp(0.01, 100.0);
        inner
    }

    pub fn chunk(&self) -> usize {
        self.chunk
    }

    pub fn made(&self) -> u64 {
        self.made
    }

    pub fn position(&self) -> u64 {
        self.emitted
    }

    /// How many stretched frames must be in hand before `frames` can be read.
    ///
    /// Three past the last one the read lands on, because the interpolator
    /// spans four frames and reaches two forward.
    pub fn need(&mut self, frames: usize, pitch: f32) -> u64 {
        self.retune(pitch);
        if frames == 0 {
            return self.made;
        }
        let last = self.pos() + (frames - 1) as f64 * pitch as f64;
        last.floor() as u64 + 3
    }

    /// Take `n` freshly stretched frames from `src`.
    pub fn push(&mut self, src: &[f32], n: usize, channels: usize) {
        let channels = channels.max(1).min(self.channels);
        for i in 0..n {
            let slot = ((self.made + i as u64) % self.ring as u64) as usize;
            for ch in 0..channels {
                self.buf[slot * self.channels + ch] = src[i * channels + ch];
            }
        }
        self.made += n as u64;
    }

    /// Read `out.len() / channels` frames back at `pitch`.
    pub fn read(&mut self, out: &mut [f32], channels: usize, pitch: f32) {
        self.retune(pitch);
        let channels = channels.max(1).min(self.channels);
        let frames = out.len() / channels.max(1);
        let base = self.base;
        let since = self.since;
        for f in 0..frames {
            let at = base + (since + f as u64) as f64 * pitch as f64;
            let i = at.floor() as i64;
            let t = (at - i as f64) as f32;
            let mut tap = |k: i64, ch: usize| -> f32 {
                let idx = (i + k).max(self.origin as i64) as u64;
                let slot = (idx % self.ring as u64) as usize;
                self.buf[slot * self.channels + ch]
            };
            for ch in 0..channels {
                let (m1, p0, p1, p2) = (tap(-1, ch), tap(0, ch), tap(1, ch), tap(2, ch));
                // The same four-point Hermite the offline renderer uses. It
                // was linear here once, which is why a pitched stream and a
                // pitched export were audibly the same and numerically not.
                out[f * channels + ch] = crate::stretch::hermite(m1, p0, p1, p2, t);
            }
        }
        self.since += frames as u64;
        self.emitted += frames as u64;
    }

    /// Keep the counters in step while the ring is being bypassed.
    ///
    /// At unity pitch the engine already produces at the right rate, so the
    /// ring is skipped entirely — but its idea of where it is has to keep up,
    /// or the first block after the slider leaves unity reads from the wrong
    /// place. Deliberately not `seek`: that clears the buffer, and clearing
    /// twenty thousand samples on every block of a callback that is doing no
    /// resampling at all is work for nothing.
    pub fn advance_unpitched(&mut self, frames: usize) {
        self.emitted += frames as u64;
        self.base = self.emitted as f64;
        self.since = 0;
        self.last_pitch = 1.0;
        self.made = self.emitted;
        self.origin = self.emitted;
    }

    /// Move to an output frame. Returns the stretched frame the engine
    /// underneath must be seeked to.
    pub fn seek(&mut self, out_frame: u64, pitch: f32) -> u64 {
        // Derived from the output frame, not from wherever the read had got
        // to, so a seek to frame zero lands on exactly `f × pitch` — which is
        // what the offline renderer computes for the same frame.
        self.base = 0.0;
        self.since = out_frame;
        self.last_pitch = pitch;
        let at = self.pos();
        self.made = at as u64;
        self.origin = at as u64;
        self.emitted = out_frame;
        self.buf.fill(0.0);
        at as u64
    }
}

impl<S: Streamer> Pitched<S> {
    /// Wrap an engine. The engine is built by the caller because each has its
    /// own idea of what it needs; everything after that is common.
    pub fn new(inner: S, max_block: usize, channels: usize) -> Self {
        let channels = channels.max(1);
        Pitched {
            inner,
            ring: PitchRing::new(max_block, channels),
            scratch: vec![0.0; max_block.max(1) * channels],
        }
    }

    /// The engine underneath, for whatever it alone understands — WSOLA's
    /// transient map, for instance.
    pub fn inner_mut(&mut self) -> &mut S {
        &mut self.inner
    }

    pub fn inner(&self) -> &S {
        &self.inner
    }

    /// Render `frames` of output at `semitones`, reading from `input`.
    pub fn render_pitched(
        &mut self,
        out: &mut [f32],
        channels: usize,
        input: &[f32],
        p: &StretchParams,
        semitones: f32,
    ) {
        let pitch = PitchRing::factor(semitones);
        if (pitch - 1.0).abs() < 1e-6 {
            // Nothing to resample; the engine is already producing at the right
            // rate, so do not pay for a copy through the ring.
            let frames = out.len() / channels.max(1);
            self.inner.render(out, channels, input, p);
            self.ring.advance_unpitched(frames);
            return;
        }
        let inner = PitchRing::inner_params(p, pitch);
        let frames = out.len() / channels.max(1);
        let need = self.ring.need(frames, pitch);
        while self.ring.made() < need {
            let n = self.ring.chunk().min((need - self.ring.made()) as usize);
            self.inner.render(&mut self.scratch[..n * channels], channels, input, &inner);
            self.ring.push(&self.scratch, n, channels);
        }
        self.ring.read(out, channels, pitch);
    }

    pub fn position(&self) -> u64 {
        self.ring.position()
    }

    /// Move to an output frame. The engine underneath is seeked to the matching
    /// place on the *stretched* timeline, which runs `pitch` times faster.
    pub fn seek(&mut self, out_frame: u64, input_frames: usize, p: &StretchParams, semitones: f32) {
        let pitch = PitchRing::factor(semitones);
        let at = self.ring.seek(out_frame, pitch);
        self.inner.seek(at, input_frames, &PitchRing::inner_params(p, pitch));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stretch::{Algorithm, Stretch};

    const RATE: u32 = 44_100;

    fn busy(secs: f32, channels: usize) -> Vec<f32> {
        let n = (RATE as f32 * secs) as usize;
        let mut seed = 12345u32;
        let mut v = Vec::with_capacity(n * channels);
        for i in 0..n {
            let t = i as f32 / RATE as f32;
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let noise = ((seed >> 16) as f32 / 32768.0) - 1.0;
            let into = i % 5512;
            let hit = if into < 700 {
                noise * (1.0 - into as f32 / 700.0).powi(2) * 0.7
            } else {
                0.0
            };
            let s = 0.3 * (std::f32::consts::TAU * 220.0 * t).sin() + noise * 0.05 + hit;
            for ch in 0..channels {
                v.push(if ch == 0 { s } else { s * 0.7 });
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

    /// Drive the streamer to produce the whole thing, in blocks.
    fn streamed(input: &[f32], channels: usize, spec: &Stretch, block: usize) -> Vec<f32> {
        let p = params(spec);
        let in_frames = input.len() / channels;
        let want = ((in_frames as f64) * spec.ratio as f64).round() as usize;

        let sr = RATE as f32;
        let win = (((spec.window_ms.clamp(5.0, 2000.0) / 1000.0) * sr) as usize).max(64) & !1;
        let hop = crate::stretch::hop_frames(&spec.grain, win, sr).max(1);

        let mut s = WsolaStream::new(block, channels, RATE);
        s.set_map(WsolaStream::build_map(input, channels, RATE, spec.ratio, hop, &spec.wsola));
        s.seek(0, in_frames, &p);

        let mut out = vec![0f32; want * channels];
        let mut at = 0usize;
        let mut buf = vec![0f32; block * channels];
        while at < want {
            let n = block.min(want - at);
            s.render(&mut buf[..n * channels], channels, input, &p);
            out[at * channels..(at + n) * channels].copy_from_slice(&buf[..n * channels]);
            at += n;
        }
        out
    }

    fn spec(ratio: f32) -> Stretch {
        Stretch { ratio, algorithm: Algorithm::Wsola, ..Default::default() }
    }

    /// The claim the whole file rests on: what a callback produces block by
    /// block is what the offline render produces in one go.
    #[test]
    fn streaming_matches_the_offline_render() {
        let src = busy(0.5, 2);
        for ratio in [0.5f32, 2.0, 4.0] {
            let s = spec(ratio);
            let offline = s.process(&src, 2, RATE);
            let live = streamed(&src, 2, &s, 512);
            assert_eq!(offline.len(), live.len(), "lengths differ at {ratio}x");
            let worst = offline
                .iter()
                .zip(&live)
                .map(|(a, b)| (a - b).abs())
                .fold(0f32, f32::max);
            assert!(worst < 1e-5, "at {ratio}x the two paths differ by {worst:.2e}");
        }
    }

    /// And it must not depend on the block size, or the sound would change with
    /// the device's buffer setting.
    #[test]
    fn the_block_size_does_not_change_the_sound() {
        let src = busy(0.4, 2);
        let s = spec(3.0);
        let a = streamed(&src, 2, &s, 64);
        let b = streamed(&src, 2, &s, 1024);
        let worst = a.iter().zip(&b).map(|(x, y)| (x - y).abs()).fold(0f32, f32::max);
        assert!(worst < 1e-5, "the block size changed the audio by {worst:.2e}");
    }

    #[test]
    fn the_grain_controls_reach_the_streaming_engine_too() {
        let src = busy(0.4, 2);
        let mut s = spec(3.0);
        let plain = streamed(&src, 2, &s, 256);
        s.grain.overlap = 4.0;
        let moved = streamed(&src, 2, &s, 256);
        let d: f32 = plain.iter().zip(&moved).map(|(a, b)| (a - b).abs()).sum();
        assert!(d > 1e-3, "overlap did not reach the streaming engine");
    }

    /// Seeking lands on the right material, but cannot reproduce the splice
    /// chain that led there.
    ///
    /// This is a property of the algorithm and not a shortcut. Each window's
    /// position is chosen to continue the one before it, so where WSOLA is at
    /// any moment depends on every splice since the last seek — there is no
    /// closed form for it the way there is for a grain, whose randomness is
    /// addressed by index. What can be promised is that the audio after a seek
    /// is the same material at the same instant, at the same level.
    #[test]
    fn seeking_lands_on_the_same_material_even_though_the_splices_differ() {
        let src = busy(0.5, 2);
        let s = spec(2.0);
        let whole = streamed(&src, 2, &s, 256);

        let p = params(&s);
        let in_frames = src.len() / 2;
        let sr = RATE as f32;
        let win = (((s.window_ms / 1000.0) * sr) as usize).max(64) & !1;
        let hop = crate::stretch::hop_frames(&s.grain, win, sr).max(1);
        let mut st = WsolaStream::new(512, 2, RATE);
        st.set_map(WsolaStream::build_map(&src, 2, RATE, s.ratio, hop, &s.wsola));

        // Land on a hop boundary: between them the overlap-add is mid-window,
        // and no engine of this kind can reproduce a partial window it never
        // laid down.
        let at = (hop * 20) as u64;
        st.seek(at, in_frames, &p);
        // Enough blocks to get a window past the seam, where the overlap-add
        // has reached full depth again.
        let want = win + 512;
        let mut buf = vec![0f32; want * 2];
        for c in buf.chunks_mut(512 * 2) {
            let n = c.len() / 2;
            st.render(&mut c[..n * 2], 2, &src, &p);
        }

        let from = at as usize + win;
        let a = &whole[from * 2..(from + 256) * 2];
        let b = &buf[win * 2..(win + 256) * 2];
        let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
        let ea: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
        let eb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
        let corr = dot / (ea * eb + 1e-12);
        assert!(corr > 0.8, "seeking landed somewhere else: correlation {corr:.3}");
        assert!(
            (ea / eb - 1.0).abs() < 0.25,
            "seeking changed the level: {ea:.3} against {eb:.3}"
        );
    }

    #[test]
    fn silence_streams_to_silence() {
        let src = vec![0f32; 20_000];
        let out = streamed(&src, 1, &spec(3.0), 256);
        assert!(out.iter().all(|v| v.abs() < 1e-6));
    }
}
