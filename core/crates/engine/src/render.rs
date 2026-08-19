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

use fx::grain::{layer_count, layer_offset, layer_params, GrainEvent, GrainStream, StreamParams};

/// How many grains may sound at once. At the densest setting the scheduler
/// allows — 2000 grains a second against a half-second window — real overlap
/// stays far below this, but sixteen layers is sixteen independent schedules
/// all sounding at once, so the pool has to hold the sum of them.
pub const MAX_VOICES: usize = 1024;

/// Independent grain streams.
///
/// Re-exported from `fx::grain` rather than declared here. The layer helpers
/// used to live in this file, which meant the *renderer* knew how to lay out
/// sixteen schedules and the enumeration everything else reads — the
/// visualiser, the cloud pad, the read band — knew about exactly one. The
/// picture was a sixteenth of the sound.
pub use fx::grain::MAX_LAYERS;

/// What a grain was born with.
///
/// A grain sounds for up to half a second, and the controls that shape it can
/// move several times while it is still in the air. These used to be read from
/// the live parameters on every block, which meant a grain already half played
/// would change its envelope, flip its direction or jump across the stereo
/// field part way through — each of which is a step in the middle of a window
/// whose whole job is to be smooth, and a step is a click.
///
/// So a grain takes a copy when it starts and keeps it to the end. A control
/// now changes the grains that have not been born yet, which is both
/// click-free and how a granular instrument ought to feel: the cloud drifts to
/// the new setting over a grain's length instead of snapping to it. That
/// drift is the latency, and it is wanted.
///
/// The offline renderer needs none of this — its parameters cannot move part
/// way through a render — so the two still agree frame for frame.
#[derive(Clone, Copy)]
struct Shape {
    /// Where the envelope peaks.
    envelope: f32,
    /// Whether the grain reads backwards.
    reverse: bool,
    /// How far across the stereo field grains are thrown.
    pan_spread: f32,
    /// Which deal of the randomness it was thrown by. Re-seeding deals a new
    /// cloud; it must deal the grains still to come, not the ones in the air.
    seed: u32,
    /// Whether the file is a loop for this grain. Captured with the rest: a
    /// grain that started reading a wrapped file must go on doing so, or its
    /// read would jump the moment the switch moved.
    wrap: bool,
}

#[derive(Clone, Copy)]
struct Voice {
    event: GrainEvent,
    /// Frames of this grain already emitted.
    played: u32,
    /// The settings it started under. Never re-read from the live parameters.
    shape: Shape,
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
    /// The layering lift actually being applied, which walks to the one the
    /// parameters ask for rather than stepping to it.
    ///
    /// Adding a layer changes the gain of everything at once — grains already
    /// sounding included, and unlike their shape this one genuinely has to
    /// apply to them, or the mix would be wrong for as long as the oldest
    /// grain lasts. So it is ramped instead of captured. Not finite means
    /// nothing has been rendered yet, and the first block snaps.
    lift: f32,
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
            shape: Shape {
                envelope: 0.5,
                reverse: false,
                pan_spread: 0.0,
                seed: 0,
                wrap: false,
            },
        };
        BlockRenderer {
            streams: [GrainStream::new(); MAX_LAYERS],
            voices: [empty; MAX_VOICES],
            live: 0,
            position: 0,
            norm: vec![0.0; max_block.max(1)],
            lift: f32::NAN,
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
        // A seek starts at the right gain rather than sliding into it: an
        // offline render of the same frames does, and the two must agree.
        self.lift = fx::grain::layer_gain(sp.grain.layers);
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
                    self.push(e, shape_of(&lp));
                }
            }
            self.streams[l as usize] = s;
        }
    }

    /// Take a grain, stealing the oldest voice if the pool is full.
    ///
    /// It used to drop the *incoming* grain. For a stretcher that is
    /// defensible; for an emitter it is backwards. The newest grain is the one
    /// carrying the material you are listening for, so at the ceiling the cloud
    /// stopped taking in anything new and played out what it already had — a
    /// smear that got staler the harder you pushed it.
    ///
    /// Stealing the oldest keeps the cloud current, and makes the ceiling sound
    /// like a limit on *how many at once* rather than on *how new*. The
    /// overflow counter still counts, because a stolen voice is still a grain
    /// that did not get to finish.
    fn push(&mut self, event: GrainEvent, shape: Shape) {
        if self.live == MAX_VOICES {
            self.overflows += 1;
            // The oldest is the one that has played the most of itself, which
            // is also the one with least left to lose.
            let mut oldest = 0;
            let mut played = 0u32;
            for (i, v) in self.voices[..self.live].iter().enumerate() {
                if v.played >= played {
                    played = v.played;
                    oldest = i;
                }
            }
            self.voices[oldest] = Voice { event, played: 0, shape };
            return;
        }
        self.voices[self.live] = Voice { event, played: 0, shape };
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
                self.push(e, shape_of(&lp));
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
            // The voice's own, not the rack's current. See `Shape`.
            let (gl, gr) = fx::grain::pan_gains_with(
                voice.shape.pan_spread,
                voice.shape.seed,
                voice.event.index,
                channels,
            );
            let skew = voice.shape.envelope;
            let reverse = voice.shape.reverse;

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
                        sample_at(&src.samples, src.channels, sch, pos, src.frames(), voice.shape.wrap)
                            * win * pan;
                }
                self.norm[f] += win;
                played += 1;
            }

            // Keep it only if it has frames left to sound.
            if played < size {
                self.voices[w] = Voice {
                    event: voice.event,
                    played: played as u32,
                    shape: voice.shape,
                };
                w += 1;
            }
        }
        self.live = w;

        // Divide out the summed window so overlapping grains do not pile up,
        // then put back what layering takes away. The same `layer_gain` the
        // offline renderer uses — a second copy of that square root here is
        // exactly the kind of thing that lets the two drift apart.
        let want = fx::grain::layer_gain(sp.grain.layers);
        if !self.lift.is_finite() {
            self.lift = want;
        }
        // About fifteen milliseconds. Slower and adding a layer feels late;
        // faster and the step is back.
        let k = 1.0 - (-1.0f32 / (0.015 * sp.sample_rate.max(1) as f32)).exp();
        // Normalise only where grains pile above unity.
        //
        // Dividing by the summed envelope outright is the right thing for a
        // stretcher and the wrong thing for an emitter. For a grain sounding
        // alone it is `(s·w)/w = s` — the envelope divided straight back out,
        // so the grain plays flat, begins and ends at full amplitude, and
        // clicks at both ends.
        //
        // That has never been audible, and the reason is the coupling this
        // release removes: `hop = size / overlap` *guarantees* grains overlap,
        // so `norm` is always a sum of two or more Hann windows and sits near
        // one. With the cloud's rate free of the window, a low rate or a short
        // grain leaves real gaps — and every grain alone in a gap would lose
        // its shape.
        //
        // So the floor is one. Above it the division behaves exactly as it did:
        // dense clouds hold their level while the texture thickens. Below it
        // grains simply sum, which is what an emitter should do — adding grains
        // adds level the way adding stars adds light — and the silence between
        // them stays silence. The knee is at one grain covering each moment,
        // which is also where the cloud stops being able to reconstruct a
        // signal and starts being a scatter of events: the gain law and the
        // aesthetic change hands in the same place.
        for f in 0..frames {
            self.lift += (want - self.lift) * k;
            let n = self.norm[f].max(1.0);
            for ch in 0..channels {
                out[f * channels + ch] = out[f * channels + ch] / n * self.lift;
            }
        }

        self.position = block_end;
        reported
    }
}

// The Hann envelope used to be duplicated here, with a comment promising it was
// identical to the offline one. It now comes from `fx::grain::env_at`, which is
// the only way that promise can actually be kept once the shape is adjustable.

/// The shaping settings a grain starting now would take.
fn shape_of(sp: &StreamParams) -> Shape {
    Shape {
        envelope: sp.grain.envelope,
        reverse: sp.grain.reverse,
        pan_spread: sp.grain.pan_spread,
        seed: sp.grain.seed,
        wrap: sp.grain.wrap,
    }
}

/// Linearly interpolated read, clamped at the edges. Identical to the offline
/// renderer's.
#[inline]
fn sample_at(
    input: &[f32],
    channels: usize,
    ch: usize,
    pos: f32,
    in_frames: usize,
    wrap: bool,
) -> f32 {
    if in_frames == 0 {
        return 0.0;
    }
    // Identical to the offline renderer's, wrap included. If these two ever
    // disagree, what you hear and what gets written stop being the same sound.
    let p = if wrap {
        pos.rem_euclid(in_frames as f32)
    } else {
        pos.max(0.0)
    };
    let i = p.floor() as usize;
    let t = p - i as f32;
    let (a, b) = if wrap {
        (i % in_frames, (i + 1) % in_frames)
    } else {
        (i.min(in_frames - 1), (i + 1).min(in_frames - 1))
    };
    let s0 = input[a * channels + ch];
    let s1 = input[b * channels + ch];
    s0 + (s1 - s0) * t
}
