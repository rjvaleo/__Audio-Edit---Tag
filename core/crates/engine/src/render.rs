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
/// stays far below this.
pub const MAX_VOICES: usize = 256;

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
    stream: GrainStream,
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
            stream: GrainStream::new(),
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
        self.stream.seek(out_frame, sp);
        // seek snaps back to the grain covering that moment, which may start
        // before it. Skip anything already finished by the time we arrive.
        while self.stream.out_frame() < out_frame {
            let e = self.stream.next(sp);
            if e.out_frame + e.size as u64 > out_frame {
                self.push(e);
            }
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
        let mut reported = 0;
        while self.stream.out_frame() < block_end {
            let e = self.stream.next(sp);
            if reported < events.len() {
                events[reported] = e;
                reported += 1;
            }
            self.push(e);
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

        // Divide out the summed window so overlapping grains do not pile up.
        for f in 0..frames {
            let n = self.norm[f];
            if n > 1e-6 {
                for ch in 0..channels {
                    out[f * channels + ch] /= n;
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
