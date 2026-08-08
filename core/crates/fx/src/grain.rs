//! Granular synthesis controls for the time stretcher.
//!
//! WSOLA is a special case of granular: fixed grain size, hop set by the time
//! ratio, and a similarity search to pick splice points. Generalising it gives
//! independent control of when grains happen, how long they are, where they
//! read from, and what pitch each one plays at.
//!
//! **All randomness is a pure function of the grain index and a seed.** Nothing
//! here advances a hidden generator. That is not a stylistic choice: the
//! waveform display, playback and the exported file are rendered by separate
//! calls, and a running RNG would give each of them different audio — the
//! picture would stop matching the sound.

/// Per-grain variation. Defaults are all inert, so a fresh document behaves
/// exactly as the plain stretcher did.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Grain {
    /// Grains per second. Zero derives it from grain size and overlap, which is
    /// the classic behaviour.
    pub density_hz: f32,
    /// How many grains cover any given moment. 2.0 is 50% overlap.
    pub overlap: f32,
    /// Randomises grain length, 0..1 as a fraction of the base size.
    pub size_jitter: f32,
    /// Randomises where in the source each grain reads from, in milliseconds.
    pub position_jitter_ms: f32,
    /// Random pitch offset per grain, in semitones. Instant, uncorrelated.
    pub pitch_jitter_semis: f32,
    /// Slow wandering pitch offset, in semitones. Smooth, correlated in time.
    pub pitch_drift_semis: f32,
    /// How fast the drift wanders, in Hz.
    pub drift_rate_hz: f32,
    /// Chosen by the user; the same seed always gives the same result.
    pub seed: u32,
}

impl Default for Grain {
    fn default() -> Self {
        Grain {
            density_hz: 0.0,
            overlap: 2.0,
            size_jitter: 0.0,
            position_jitter_ms: 0.0,
            pitch_jitter_semis: 0.0,
            pitch_drift_semis: 0.0,
            drift_rate_hz: 0.5,
            seed: 1,
        }
    }
}

impl Grain {
    /// Nothing here would change the sound, so the plain stretcher can be used.
    pub fn is_clean(&self) -> bool {
        self.density_hz <= 0.0
            && (self.overlap - 2.0).abs() < 1e-3
            && self.size_jitter.abs() < 1e-4
            && self.position_jitter_ms.abs() < 1e-4
            && self.pitch_jitter_semis.abs() < 1e-4
            && self.pitch_drift_semis.abs() < 1e-4
    }

    /// Uniform random in 0..1 for grain `index`. `salt` separates the streams,
    /// so changing pitch jitter does not also reshuffle grain sizes.
    pub fn rand01(&self, index: u64, salt: u32) -> f32 {
        let mut x = (index.wrapping_mul(0x9E37_79B9_7F4A_7C15))
            ^ ((self.seed as u64) << 1)
            ^ ((salt as u64).wrapping_mul(0xD1B5_4A32_D192_ED03));
        x ^= x >> 30;
        x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
        x ^= x >> 27;
        x = x.wrapping_mul(0x94D0_49BB_1331_11EB);
        x ^= x >> 31;
        ((x >> 40) as f32) / 16_777_216.0
    }

    /// Bipolar random in -1..1.
    pub fn rand_bipolar(&self, index: u64, salt: u32) -> f32 {
        self.rand01(index, salt) * 2.0 - 1.0
    }

    /// Smooth wander in -1..1 at `t` seconds.
    ///
    /// Value noise rather than white noise: drift is meant to be heard as
    /// slowly going out of tune, which needs neighbouring moments to agree.
    pub fn drift_at(&self, t: f32) -> f32 {
        let rate = self.drift_rate_hz.max(0.01);
        let x = t * rate;
        let i = x.floor().max(0.0) as u64;
        let f = x - x.floor();
        let a = self.rand_bipolar(i, 77);
        let b = self.rand_bipolar(i + 1, 77);
        let s = f * f * (3.0 - 2.0 * f); // smoothstep
        a + (b - a) * s
    }

    /// Pitch offset in semitones for grain `index` starting at `t` seconds.
    pub fn pitch_offset(&self, index: u64, t: f32) -> f32 {
        self.pitch_jitter_semis * self.rand_bipolar(index, 11)
            + self.pitch_drift_semis * self.drift_at(t)
    }
}

/// One grain: where it lands, where it reads from, how long, at what pitch.
///
/// The renderer and the visualiser both consume these, so what you see is
/// necessarily what you hear. Computing them twice would let the two drift.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GrainEvent {
    pub index: u64,
    /// Output frame the grain starts at.
    pub out_frame: u64,
    /// Source frame it reads from, fractional.
    pub src_frame: f32,
    /// Length in output frames.
    pub size: u32,
    /// Read rate; 1.0 is unshifted.
    pub rate: f32,
    /// Total pitch offset in semitones, base plus jitter plus drift.
    pub pitch_semis: f32,
}

/// The grain schedule for a render. Deterministic and cheap — no audio is read.
pub struct GrainPlan {
    pub hop: usize,
    pub base_size: usize,
    pub out_frames: usize,
}

pub fn plan(
    in_frames: usize,
    sample_rate: u32,
    ratio: f32,
    window_ms: f32,
    g: &Grain,
) -> GrainPlan {
    let sr = sample_rate.max(1) as f32;
    let ratio = ratio.clamp(0.1, 10.0);
    let base_size = (((window_ms.clamp(5.0, 500.0) / 1000.0) * sr) as usize).max(32);
    let overlap = g.overlap.clamp(1.0, 8.0);
    let hop = if g.density_hz > 0.0 {
        ((sr / g.density_hz.clamp(0.5, 2000.0)) as usize).max(8)
    } else {
        (base_size as f32 / overlap).max(8.0) as usize
    };
    GrainPlan {
        hop,
        base_size,
        out_frames: ((in_frames as f32) * ratio).round() as usize,
    }
}

/// Enumerate every grain in a render.
pub fn grains(
    in_frames: usize,
    sample_rate: u32,
    ratio: f32,
    semitones: f32,
    window_ms: f32,
    g: &Grain,
) -> Vec<GrainEvent> {
    let sr = sample_rate.max(1) as f32;
    let ratio = ratio.clamp(0.1, 10.0);
    let p = plan(in_frames, sample_rate, ratio, window_ms, g);
    let pos_jitter = (g.position_jitter_ms / 1000.0) * sr;
    let base_rate = 2f32.powf(semitones / 12.0);

    let mut out = Vec::new();
    let mut index: u64 = 0;
    let mut write = 0usize;

    while write < p.out_frames {
        let t = write as f32 / sr;
        let size = if g.size_jitter > 1e-6 {
            let k = 1.0 + g.size_jitter.clamp(0.0, 1.0) * g.rand_bipolar(index, 3);
            ((p.base_size as f32) * k.clamp(0.15, 2.0)) as usize
        } else {
            p.base_size
        }
        .max(16);

        let semis = g.pitch_offset(index, t);
        let rate = (base_rate * 2f32.powf(semis / 12.0)).clamp(0.05, 20.0);

        let nominal = (write as f32) / ratio;
        let jitter = if pos_jitter > 0.0 { pos_jitter * g.rand_bipolar(index, 5) } else { 0.0 };
        let span = (size as f32) * rate;
        let max_start = (in_frames as f32 - span - 1.0).max(0.0);
        let read = (nominal + jitter).clamp(0.0, max_start);

        out.push(GrainEvent {
            index,
            out_frame: write as u64,
            src_frame: read,
            size: size as u32,
            rate,
            pitch_semis: semitones + semis,
        });

        index += 1;
        write += p.hop;
    }
    out
}

/// Render `input` with independent time and pitch, grain by grain.
///
/// `ratio` is output length over input length; `semitones` the base pitch.
pub fn granular(
    input: &[f32],
    channels: usize,
    sample_rate: u32,
    ratio: f32,
    semitones: f32,
    window_ms: f32,
    g: &Grain,
) -> Vec<f32> {
    let channels = channels.max(1);
    let in_frames = input.len() / channels;
    if in_frames == 0 {
        return Vec::new();
    }
    let p = plan(in_frames, sample_rate, ratio, window_ms, g);
    if p.out_frames == 0 {
        return Vec::new();
    }

    let events = grains(in_frames, sample_rate, ratio, semitones, window_ms, g);
    let tail = p.base_size * 2;
    let mut out = vec![0f32; (p.out_frames + tail) * channels];
    let mut norm = vec![0f32; p.out_frames + tail];

    for e in &events {
        let size = e.size as usize;
        for i in 0..size {
            let w = hann_at(i, size);
            let dst = e.out_frame as usize + i;
            if dst >= p.out_frames + tail {
                break;
            }
            let src = e.src_frame + (i as f32) * e.rate;
            for ch in 0..channels {
                out[dst * channels + ch] += sample_at(input, channels, ch, src, in_frames) * w;
            }
            norm[dst] += w;
        }
    }

    // Divide out the summed window so overlapping grains do not pile up.
    for f in 0..p.out_frames {
        let n = norm[f];
        if n > 1e-6 {
            for ch in 0..channels {
                out[f * channels + ch] /= n;
            }
        }
    }
    out.truncate(p.out_frames * channels);
    out
}

/// Hann value at position `i` of `n`, without allocating a table per grain.
#[inline]
fn hann_at(i: usize, n: usize) -> f32 {
    if n <= 1 {
        return 1.0;
    }
    0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (n - 1) as f32).cos()
}

/// Linearly interpolated read, clamped at the edges.
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
