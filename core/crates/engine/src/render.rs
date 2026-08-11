//! Block-based granular rendering.
//!
//! The offline renderer in `fx::grain::granular` lays every grain into one big
//! buffer and normalises at the end. An audio callback cannot do that: it is
//! handed a few hundred frames at a time and must return before the device
//! wants them, having allocated nothing.
//!
//! So grains become *voices*. A grain that starts in this block but runs longer
//! than it stays active into the next, carrying its position with it. The pool
//! is a fixed array — running out of slots drops the newest grain rather than
//! allocating, because a click is better than a dropout and an allocation in an
//! audio callback risks both.
//!
//! Voices are kept in spawn order so that, for any output frame, contributions
//! are summed in the same order the offline renderer would use. That is what
//! lets the two agree bit for bit rather than merely closely.

use fx::grain::{GrainEvent, GrainStream, StreamParams};

/// How many grains may sound at once. At the densest setting the scheduler
/// allows — 2000 grains a second against a half-second window — real overlap
/// stays far below this, but sixteen layers is sixteen independent schedules
/// all sounding at once, so the pool has to hold the sum of them.
pub const MAX_VOICES: usize = 1024;

/// Independent grain streams. Matches the clamp in `fx::grain::granular`, and
/// has to: a layer the renderer refuses to run is a layer you hear offline and
/// not while playing.
pub const MAX_LAYERS: usize = 16;

#[derive(Clone, Copy)]
struct Voice {
    event: GrainEvent,
    /// Frames of this grain already emitted.
    played: u32,
}

/// The source a render reads from: interleaved, with its channel count.
pub struct Source {
    pub samples: Vec<f32>,
    pub channels: usize,
}

impl Source {
    pub fn frames(&self) -> usize {
        if self.channels == 0 {
            0
        } else {
            self.samples.len() / self.channels
        }
    }
}

/// Renders the grain stream a block at a time.
///
/// Holds no audio of its own and never allocates once built, so it is safe to
/// drive from the audio thread.
pub struct BlockRenderer {
    /// One schedule per layer. A layer is not the same grains packed tighter —
    /// it is the source read from another place entirely, with its own seed and
    /// its own offset within the hop, which is why each needs its own stream.
    streams: [GrainStream; MAX_LAYERS],
    voices: [Voice; MAX_VOICES],
    live: usize,
    /// Output frame the next block starts at.
    position: u64,
    /// Summed window per frame, for the overlap normalisation. Sized once.
    norm: Vec<f32>,
    /// Dropped because the pool was full. Surfaced so it can be seen rather
    /// than silently degrading.
    pub overflows: u64,
}

impl BlockRenderer {
    pub fn new(max_block: usize) -> Self {
        let empty = Voice {
            event: GrainEvent {
                index: 0,
                out_frame: 0,
                src_frame: 0.0,
                size: 0,
                rate: 1.0,
                pitch_semis: 0.0,
            },
            played: 0,
        };
        BlockRenderer {
            streams: [GrainStream::new(); MAX_LAYERS],
            voices: [empty; MAX_VOICES],
            live: 0,
            position: 0,
            norm: vec![0.0; max_block.max(1)],
            overflows: 0,
        }
    }

    pub fn position(&self) -> u64 {
        self.position
    }

    /// Move the playhead. Sounding grains are dropped: they belong to where you
    /// were, not where you are going.
    pub fn seek(&mut self, out_frame: u64, sp: &StreamParams) {
        self.position = out_frame;
        self.live = 0;
        let layers = layer_count(sp);
        for l in 0..layers {
            let lp = layer_params(sp, l);
            let off = layer_offset(sp, l, layers);
            // Copied out and back rather than borrowed, because pushing a voice
            // needs the renderer and the stream lives inside it.
            let mut s = self.streams[l as usize];
            // The stream counts in its own timeline; the offset is what puts a
            // layer's grains between the previous layer's rather than on top.
            s.seek(out_frame.saturating_sub(off), &lp);
            // seek snaps back to the grain covering that moment, which may start
            // before it. Skip anything already finished by the time we arrive.
            while s.out_frame() + off < out_frame {
                let mut e = s.next(&lp);
                e.out_frame += off;
                if e.out_frame + e.size as u64 > out_frame {
                    self.push(e);
                }
            }
            self.streams[l as usize] = s;
        }
    }

    fn push(&mut self, event: GrainEvent) {
        if self.live == MAX_VOICES {
            self.overflows += 1;
            return;
        }
        self.voices[self.live] = Voice { event, played: 0 };
        self.live += 1;
    }

    /// Fill `out` (interleaved, `channels` wide) with the next block.
    ///
    /// `events` collects the grains that started in this block, for the
    /// visualiser. It is a plain slice so the caller owns the memory; grains
    /// past its end are still rendered, just not reported.
    pub fn render(
        &mut self,
        out: &mut [f32],
        channels: usize,
        src: &Source,
        sp: &StreamParams,
        events: &mut [GrainEvent],
    ) -> usize {
        let channels = channels.max(1);
        let frames = out.len() / channels;
        out.fill(0.0);
        if frames == 0 || src.frames() == 0 {
            return 0;
        }
        if self.norm.len() < frames {
            // Only ever hit if the device hands us a bigger block than promised.
            self.norm.resize(frames, 0.0);
        }
        self.norm[..frames].fill(0.0);

        let block_end = self.position + frames as u64;

        // Spawn everything that begins inside this block. Parameters are read
        // by the stream at each grain, so a slider moved a moment ago shapes
        // the very next one.
        //
        // Layer by layer, which is the order the offline renderer sums them in.
        let mut reported = 0;
        let layers = layer_count(sp);
        for l in 0..layers {
            let lp = layer_params(sp, l);
            let off = layer_offset(sp, l, layers);
            let mut s = self.streams[l as usize];
            while s.out_frame() + off < block_end {
                let mut e = s.next(&lp);
                e.out_frame += off;
                if reported < events.len() {
                    events[reported] = e;
                    reported += 1;
                }
                self.push(e);
            }
            self.streams[l as usize] = s;
        }

        // Sum the voices. Spawn order, so the arithmetic matches offline.
        let mut w = 0;
        for v in 0..self.live {
            let voice = self.voices[v];
            let size = voice.event.size as usize;
            let mut played = voice.played as usize;
            // Envelope shape, direction and stereo place all come from the same
            // helpers the offline renderer uses, so live playback and the file
            // that gets exported are the same sound.
            let (gl, gr) = fx::grain::pan_gains(&sp.grain, voice.event.index, channels);
            let skew = sp.grain.envelope;
            let reverse = sp.grain.reverse;

            // Where in this block the grain's next frame lands.
            let start = if voice.event.out_frame > self.position {
                (voice.event.out_frame - self.position) as usize
            } else {
                0
            };

            for f in start..frames {
                if played >= size {
                    break;
                }
                let win = fx::grain::env_at(played, size, skew);
                let step = if reverse { (size - 1 - played) as f32 } else { played as f32 };
                let pos = voice.event.src_frame + step * voice.event.rate;
                for ch in 0..channels {
                    // The device's channel count is not the file's. A mono file
                    // on a stereo output feeds both sides; the source must be
                    // indexed with its own stride, or the read runs off the end.
                    let sch = ch.min(src.channels.saturating_sub(1));
                    let pan = if ch == 0 { gl } else { gr };
                    out[f * channels + ch] +=
                        sample_at(&src.samples, src.channels, sch, pos, src.frames()) * win * pan;
                }
                self.norm[f] += win;
                played += 1;
            }

            // Keep it only if it has frames left to sound.
            if played < size {
                self.voices[w] = Voice {
                    event: voice.event,
                    played: played as u32,
                };
                w += 1;
            }
        }
        self.live = w;

        // Divide out the summed window so overlapping grains do not pile up,
        // then put back what layering takes away. The same `layer_gain` the
        // offline renderer uses — a second copy of that square root here is
        // exactly the kind of thing that lets the two drift apart.
        let lift = fx::grain::layer_gain(sp.grain.layers);
        for f in 0..frames {
            let n = self.norm[f];
            if n > 1e-6 {
                for ch in 0..channels {
                    out[f * channels + ch] = out[f * channels + ch] / n * lift;
                }
            }
        }

        self.position = block_end;
        reported
    }
}

// The Hann envelope used to be duplicated here, with a comment promising it was
// identical to the offline one. It now comes from `fx::grain::env_at`, which is
// the only way that promise can actually be kept once the shape is adjustable.

/// How many schedules are running. Clamped exactly as the offline renderer
/// clamps it, so the two never disagree about how many there are.
fn layer_count(sp: &StreamParams) -> u32 {
    sp.grain.layers.clamp(1, MAX_LAYERS as u32)
}

/// A layer's own parameters. Re-seeding is what makes it an independent cloud
/// rather than the same one drawn twice; layer zero keeps the seed it was given
/// so a single-layer render is untouched by any of this.
fn layer_params(sp: &StreamParams, layer: u32) -> StreamParams {
    let mut lp = *sp;
    if layer > 0 {
        lp.grain.seed = sp.grain.seed.wrapping_add(layer.wrapping_mul(0x9E37_79B9));
    }
    lp.grain.layer_read = sp.grain.layer_throw(layer, sp.sample_rate);
    lp
}

/// Where a layer sits within the hop. Even spacing scaled by the spread
/// control, so at zero they stack and are merely louder.
fn layer_offset(sp: &StreamParams, layer: u32, layers: u32) -> u64 {
    if layer == 0 || layers <= 1 {
        return 0;
    }
    let hop = sp.plan().hop.max(1) as u64;
    let even = (hop * layer as u64) / layers as u64;
    ((even as f32) * sp.grain.layer_spread.clamp(0.0, 4.0)) as u64
}

/// Linearly interpolated read, clamped at the edges. Identical to the offline
/// renderer's.
#[inline]
fn sample_at(input: &[f32], channels: usize, ch: usize, pos: f32, in_frames: usize) -> f32 {
    if in_frames == 0 {
        return 0.0;
    }
    let p = pos.max(0.0);
    let i = p.floor() as usize;
    let t = p - i as f32;
    let a = i.min(in_frames - 1);
    let b = (i + 1).min(in_frames - 1);
    let s0 = input[a * channels + ch];
    let s1 = input[b * channels + ch];
    s0 + (s1 - s0) * t
}
