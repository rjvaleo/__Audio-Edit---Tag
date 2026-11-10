//! Transport and parameter exchange between the UI and the audio thread.
//!
//! The audio callback must never block and never allocate. Everything here is
//! built around that: scalars are atomics, and the two compound values —
//! the parameters and the source — sit behind mutexes the callback only ever
//! *tries* to take. If the UI thread happens to hold one, the callback keeps
//! using the copy it already has and picks the change up next block. At a few
//! hundred frames a block that is under three milliseconds late, which is
//! inaudible; blocking there would be a dropout, which is not.

use fx::grain::{GrainEvent, StreamParams};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::render::Source;
use crate::seqbus::{SeqBus, SEQ_BUS_FRAMES, SEQ_STOP_FADE_FRAMES};
use crate::stretcher::Stretcher;

/// Frames of fade either side of a loop wrap. A jump lands mid-waveform and
/// clicks without it.
const LOOP_FADE_FRAMES: usize = 512; // ~11 ms at 48 kHz

/// The tail constants live in `fx` now, because the offline renderer rings out
/// too and the two must not drift — see `fx::TAIL_SILENCE`.
use fx::{tail_budget, TAIL_SILENCE};

mod shared;
mod pitch_time;
pub use pitch_time::*;
mod audio_thread;

/// The shortest loop the wrap-and-crossfade path will accept.
///
/// Not a musical limit. It is where *wrapping* stops being the right mechanism:
/// 64 frames is 750 Hz at 48 kHz, so the seam rate is already inside the audio
/// band, and every wrap calls [`Stretcher::seek`], which re-primes the engine —
/// FFT state for the vocoder. The cost per second of audio climbs without
/// bound as the loop shortens. Loops below this want a phase accumulator over
/// the loop region rather than a smaller number here.
pub(crate) const MIN_LOOP_FRAMES: u64 = 64;

/// How much fade the seam of a loop this long can afford.
///
/// A quarter of the loop, capped at the usual [`LOOP_FADE_FRAMES`]. Ordinary
/// loops are far longer than 2 kframes and get the full fade; the quarter is
/// what keeps a short loop from being eaten by its own seam, since a 600-frame
/// loop given 512 frames of fade either side is almost entirely ramp.
///
/// This replaces a guard that refused to loop at all below `LOOP_FADE_FRAMES *
/// 2`. Refusing was the wrong failure: `loop_bounds` returning `None` means
/// "not looping" to the caller, which then plays to the end of the document and
/// pauses. A short loop stopped playback instead of degrading it, and did so
/// silently. Degrading is the whole point — the fade shrinks, the seam gets
/// harder, and at the bottom of the range the fade *is* the waveform.
pub(crate) fn loop_fade(a: u64, b: u64) -> usize {
    let quarter = (b.saturating_sub(a) / 4) as usize;
    LOOP_FADE_FRAMES.min(quarter)
}

/// Window for the output spectrum. About 21 ms at 48 kHz — enough resolution to
/// be worth looking at, cheap enough to run in the callback.
const FFT_SIZE: usize = 1024;

/// Columns in the published waveform. A divisor of [`FFT_SIZE`], so each column
/// is a whole number of samples and none is wider than its neighbours.
const WAVE_POINTS: usize = 128;

/// Audio kept off the output, waiting to be written somewhere.
pub struct Capture {
    pub samples: Vec<f32>,
    pub channels: usize,
    pub sample_rate: u32,
    /// True if the reserved space ran out and the tail was dropped.
    pub full: bool,
}

/// Shared between the UI threads and the audio callback.
pub struct Shared {
    /// Poly's voices: what the feeder has built, and what the page reads back.
    pub voices: crate::voices::VoiceFeed,
    params: Mutex<StreamParams>,
    source: Mutex<Arc<Source>>,
    /// Grains that started recently, for the swarm. Bounded: the visualiser
    /// missing a frame's worth matters far less than the audio stalling.
    events: Mutex<Vec<GrainEvent>>,

    /// Somewhere to put what came out, when someone asked for it to be kept.
    ///
    /// Fixed capacity, allocated before recording starts, so the callback only
    /// ever copies into memory that already exists. `try_lock` because the only
    /// other party is the one call that stops the recording, and a block that
    /// arrives during that hand-over is worth losing far more than the audio is
    /// worth stalling.
    capture: Mutex<Option<Capture>>,
    capturing: AtomicBool,

    playing: AtomicBool,
    /// Published by the callback; read by the UI for the playhead.
    position: AtomicU64,
    /// Requested seek, or -1 for none.
    seek: AtomicI64,
    loop_on: AtomicBool,
    loop_a: AtomicU64,
    loop_b: AtomicU64,
    /// The loop the callback actually used, resolved.
    ///
    /// `loop_b` of zero means "the whole document", and only the callback
    /// knows how long that is under the current ratio. Anything outside that
    /// wanting to know where the playhead will wrap has to be told, rather
    /// than work it out again — which is the mistake the comment on
    /// `loop_bounds` was already written about.
    heard_a: AtomicU64,
    heard_b: AtomicU64,
    /// How far ahead of the speaker the engine is, in frames.
    ///
    /// The position counter counts frames *produced*, and the device holds a
    /// buffer of them before any reach a speaker. Drawing a playhead from the
    /// counter therefore draws it ahead of the sound. This is what the backend
    /// reports as the gap between the callback and the moment its first sample
    /// is heard, so it is measured rather than assumed.
    latency: AtomicU64,
    /// Output gain, as f32 bits.
    gain: AtomicU32,
    /// Hyperprism's Playback Speed, as f32 bits: the rate the engine's output
    /// is read at before the rack, so pitch and time move together, as tape
    /// does. 1 is as it is.
    speed: AtomicU32,
    /// See `set_glide`. f32 bits.
    glide: AtomicU32,
    /// Hyperprism's left and right faders, as f32 bits, after the rack and the
    /// grain fader.
    gain_l: AtomicU32,
    gain_r: AtomicU32,
    /// Hyperprism's Pitch Time Changer, when it is on.
    pitch_time: Mutex<PitchTime>,
    /// Hyperprism's Post-Roll, in frames: how long the transport plays on past
    /// the end of the document, the rack running on silence.
    post_roll: AtomicU64,
    /// Silent, whatever the gain: the GRAIN source switch. The engine keeps
    /// running, so the transport and everything clocked from it carry on.
    mute: AtomicBool,
    /// The sequencer's sound, waiting for the frames it belongs at. See
    /// [`crate::seqbus`].
    pub seq: SeqBus,
    /// Grains dropped because the voice pool was full.
    pub overflows: AtomicU64,

    // ─────────────────────────────────────────────────────── what a block costs
    //
    // The one property that separates a live engine from a rendered one is that
    // a block must be made faster than it plays, and until now nothing measured
    // it outside a test. A 300-render sweep found the median randomised hybrid
    // at three times real time and the vocoder sitting on the line, which is a
    // dropout you cannot see coming. See `docs/GLITCH-SWEEP.md`.
    //
    // Measured rather than predicted. A cost model over window, layers and
    // density would have to be refitted every time the DSP changed, and would
    // still be wrong about the machine it is running on; the callback already
    // knows exactly how long it took. Two clock reads a block, both from the
    // vDSO, against a budget of milliseconds.
    /// Load of the last block, as a millionth of the real-time budget.
    ///
    /// Fixed point because this is an atomic and the audio thread may not take a
    /// lock to publish a float. A million is 100% of the budget.
    load_now: AtomicU32,
    /// A slow average of the same, so a meter does not flicker.
    load_mean: AtomicU32,
    /// The worst block since the last reset. What matters is the worst, not the
    /// mean — a mean of 40% with a spike to 150% is a click every few seconds.
    load_worst: AtomicU32,
    /// Blocks that took longer to make than to play.
    pub late_blocks: AtomicU64,
    /// The worst block since the analytics sampler last looked. Kept apart
    /// from `load_worst`, which the interface resets by hand, so neither
    /// reader disturbs the other. See `take_load_window`.
    load_window: AtomicU32,
    /// Late blocks since the engine started, never reset — the sampler counts
    /// the difference between two readings.
    late_total: AtomicU64,

    // ───────────────────────────────────────────────────────────── the governor
    //
    // Layers are the dominant multiplier — each is another whole engine — so
    // they are what gets shed when the callback cannot keep up. Sixteen vocoder
    // layers at a long window measured 113% of the budget with blocks arriving
    // late, and a dropout is worse than a thinner cloud by a distance.
    //
    // Deliberately hysteretic. Shedding on one late block would make the sound
    // flap every time the machine hiccuped, and recovering instantly would put
    // it straight back over. It falls fast and climbs slowly.
    /// The most layers the callback may run right now.
    layer_cap: AtomicU32,
    /// Whether the governor may take layers away.
    ///
    /// **Off by default: the engine plays what you asked for.** Shedding was
    /// the only behaviour, and what it looks like from outside is the program
    /// quietly overriding a setting — "5 of 12 layers" at 29% load, with no
    /// note of when it might give them back. A tool that changes your numbers
    /// without being asked is worse than one that struggles audibly, because
    /// the struggle is information and the silence is not.
    ///
    /// On, it does what it always did: sheds a layer at a time when blocks
    /// actually miss their deadline, so an over-ambitious setting costs a
    /// thinner cloud rather than holes in the sound. The load readout says
    /// which is happening either way.
    shed_layers: AtomicBool,
    /// Evidence for shedding, and evidence for recovering.
    hot: AtomicU32,
    cool: AtomicU32,
    /// Layers the callback actually ran last block, for the interface to report.
    pub layers_running: AtomicU32,

    /// A rack waiting to be adopted by the audio thread.
    ///
    /// Handed over rather than shared: effects carry filter state that only the
    /// audio thread may touch. The UI thread builds one and leaves it here; the
    /// callback takes ownership on its next block. Building it on this side is
    /// also what keeps the allocation off the audio thread.
    /// Outer Option is "a change is waiting"; inner is the new value, where
    /// None means the rack was removed. One Option cannot say both.
    pending_rack: Mutex<Option<Option<fx::Rack>>>,

    /// A transient map waiting to be adopted by the audio thread.
    ///
    /// Handed over for the same reason the rack is: deriving one runs an onset
    /// detector over the whole file, which is an allocation and a long walk,
    /// and neither belongs in a callback. `None` inside means a straight line,
    /// which is the ordinary case and needs no map at all.
    pending_map: Mutex<Option<Option<fx::transient::TimeMap>>>,

    /// The source split into partials, attacks and everything else, waiting to
    /// be adopted. Handed over for the same reason as the map: separating runs
    /// two spectrogram passes per channel over the whole file.
    ///
    /// It does not depend on the ratio, so it survives every parameter move —
    /// only opening a file or changing the separation itself rebuilds it.
    pending_parts: Mutex<Option<Arc<fx::hstream::Parts>>>,

    /// Extra engine instances for the layers past the first, waiting to be
    /// adopted. Handed over for the usual reason: sixteen of anything here is
    /// megabytes, and a callback may not allocate.
    pending_bank: Mutex<Option<crate::stretcher::LayerBank>>,
    /// How many layers the last bank handed over was built for.
    bank_layers: AtomicU32,

    /// Peak levels either side of every rack slot, and each slot's own scalar.
    ///
    /// Shared with whatever rack the audio thread currently holds, so a rack
    /// swap does not lose the meters — they belong to the transport, not to any
    /// one chain.
    rack_meters: Arc<fx::RackMeters>,

    /// Control-rate writes from automation: `(slot, key, value)`.
    ///
    /// Unlike every other `pending_` here, the callback **reads this without
    /// taking it**. The others are handed over once and consumed; these arrive
    /// continuously, and taking the vector would mean the audio thread dropping
    /// a `Vec` of `String`s several times a second — a free, on the thread that
    /// may not allocate or free. Leaving it in place also means a block that
    /// arrives between control ticks re-applies the last values rather than
    /// letting them lapse, which costs nothing because the writes are absolute.
    ///
    /// The control thread overwrites it, so the old vector is dropped there.
    automation: Mutex<Vec<(usize, String, f32)>>,

    /// Control writes from a hand on a control, applied every block.
    ///
    /// Separate from `automation` because the two have different lifetimes: the
    /// runner replaces its vector wholesale on every tick, and a manual write
    /// has to survive between ticks. Applied *before* automation, so a lane
    /// wins over a knob for the same control rather than the two flickering.
    ///
    /// Cleared when the rack is rebuilt — the new rack already has these values
    /// baked into it, and replaying them would be writing yesterday's numbers
    /// over today's.
    manual: Mutex<Vec<(usize, String, f32)>>,

    /// Magnitudes of the most recent output block, 0..255 per bin.
    ///
    /// Taken from what actually left the engine, so the spectrum shows the
    /// grains and the rack, not a guess at them. The browser used to do this
    /// with an AnalyserNode on the media element; there is no media element
    /// any more, and this is the more truthful measurement anyway.
    spectrum: Mutex<Vec<u8>>,

    /// The shape of recent output, -127..127, one point per column a display
    /// wants. Taken from the same window the spectrum is taken from, so the
    /// two describe the same instant.
    ///
    /// This is what a compressor's display draws its signal from: a meter says
    /// how loud, and only a waveform says what the threshold is actually
    /// cutting into.
    waveform: Mutex<Vec<i8>>,

    /// The master bus, with the two channels kept apart. See [`Scope`].
    scope: Mutex<Scope>,

    /// The block as it reaches the rack, for the "before" on the Grain page's
    /// effects screen. Written only while `pre_rack_left` is above zero: frames
    /// still owed since somebody last asked, counted down by the callback, so a
    /// page that goes away stops the cost by itself.
    pre_rack: Mutex<Scope>,
    pre_rack_left: AtomicU32,
}

/// Frames of master output kept for the meters.
///
/// Set by the slowest consumer: a true VU integrates over 300 ms, which is
/// 14,400 frames at 48 kHz. This covers that with room to spare, and covers a
/// 4096-point transform four times over. 128 KB, sized once, never grown.
pub const SCOPE_FRAMES: usize = 16_384;

/// The last [`SCOPE_FRAMES`] of what left the engine, L and R apart.
///
/// The callback's entire job here is to copy into this. No window, no
/// transform, no log10 — everything the meters show is worked out from it on a
/// thread that is allowed to take its time.
///
/// This exists because `measure` sums to mono before it does anything else, and
/// a Lissajous plots L against R. A mono sum has already thrown away the only
/// thing a goniometer draws. See `docs/MASTER-BUS.md`.
pub struct Scope {
    pub l: Vec<f32>,
    pub r: Vec<f32>,
    /// Where the next frame goes, and therefore where the ring's oldest frame
    /// is once it has wrapped.
    pub at: usize,
    pub filled: bool,
    /// Zero until something has actually played, which is how a caller tells
    /// "silence" from "nothing has happened yet".
    pub rate: u32,
}

impl Scope {
    fn new() -> Self {
        Scope {
            l: vec![0.0; SCOPE_FRAMES],
            r: vec![0.0; SCOPE_FRAMES],
            at: 0,
            filled: false,
            rate: 0,
        }
    }

    /// Interleaved output in, two rings out.
    ///
    /// A mono stream is written to both sides, so a Lissajous of a mono file
    /// draws the 45-degree line it ought to rather than nothing at all.
    fn write(&mut self, out: &[f32], channels: usize, rate: u32) {
        let ch = channels.max(1);
        self.rate = rate;
        for f in 0..out.len() / ch {
            let a = out[f * ch];
            let b = if ch > 1 { out[f * ch + 1] } else { a };
            self.l[self.at] = a;
            self.r[self.at] = b;
            self.at += 1;
            if self.at >= SCOPE_FRAMES {
                self.at = 0;
                self.filled = true;
            }
        }
    }

    /// The ring, oldest first. `None` until something has been written.
    fn snapshot(&self) -> Option<(Vec<f32>, Vec<f32>, u32)> {
        if self.rate == 0 {
            return None;
        }
        let (mut l, mut r) = (Vec::new(), Vec::new());
        if self.filled {
            l.reserve_exact(SCOPE_FRAMES);
            r.reserve_exact(SCOPE_FRAMES);
            l.extend_from_slice(&self.l[self.at..]);
            l.extend_from_slice(&self.l[..self.at]);
            r.extend_from_slice(&self.r[self.at..]);
            r.extend_from_slice(&self.r[..self.at]);
        } else {
            if self.at == 0 {
                return None;
            }
            l.extend_from_slice(&self.l[..self.at]);
            r.extend_from_slice(&self.r[..self.at]);
        }
        Some((l, r, self.rate))
    }
}

/// The audio thread's own state. Lives in the callback closure, touched by
/// nothing else.
pub struct Core {
    renderer: Stretcher,
    rack: Option<fx::Rack>,
    /// The rack being faded out of, and how many frames of the fade are left.
    ///
    /// Swapping outright takes every delay line, filter and reverb tail in the
    /// chain with it, and starts the new chain from silence. That is heard as
    /// the tail stopping dead and a step where the two meet — a click, and the
    /// reason changing a module never felt like changing a module. The old
    /// chain keeps running for a moment instead, and the two are mixed.
    leaving: Option<(fx::Rack, usize)>,
    /// The block as it arrived, so the outgoing rack sees the same input the
    /// incoming one does. Sized once, like everything else here.
    rack_dry: Vec<f32>,
    /// Mono sum of recent output, for the spectrum. Fixed size, filled as a
    /// ring so a block smaller than the window still produces a full frame.
    fft_in: Vec<f32>,
    fft_at: usize,
    fft_re: Vec<f32>,
    fft_im: Vec<f32>,
    fft_bins: Vec<u8>,
    params: StreamParams,
    source: Arc<Source>,
    /// Frames of processing a stopped rack still has left before it is treated
    /// as finished.
    ///
    /// What lets a reverb decay after the transport stops instead of being cut
    /// off mid-tail — and what stops a stopped transport processing silence for
    /// as long as the application is open.
    tail_left: u64,
    scratch: Vec<GrainEvent>,
    /// Where each driven control currently *is*, as opposed to where it has
    /// been asked to go. See [`Smoothed`].
    smoothing: Vec<Smoothed>,
    /// Where in the block each run of grain was rendered from: offset, output
    /// frame, frames. The sequencer's sound is taken at the same output frames,
    /// so a loop's wrap inside a block puts it on the same side of the seam as
    /// the grain. Sized once, in `new`.
    seq_runs: Vec<(usize, u64, usize)>,
    /// How much of the sequencer's fade is left after a stop, and the output
    /// frame it has reached.
    seq_fade: usize,
    seq_fade_at: u64,
    /// Rendered frames the varispeed has not read past yet, interleaved, and
    /// how many there are. Sized once for the fastest speed.
    vs: Vec<f32>,
    vs_frames: usize,
    /// Where the read sits between `vs[0]` and `vs[1]`.
    vs_frac: f64,
    /// Hyperprism's shifter for the Pitch Time Changer, built once, and the
    /// settings it was last given.
    ptc: Option<Box<dyn fx::Effect>>,
    ptc_now: PitchTime,
    /// Speed and Pitch as Hyperprism's smoothing has them now. See `ptc_glided`.
    ptc_glide: crate::glide::Glide<2>,
    /// What the document asks for, before the glide: `params` is what plays.
    target: StreamParams,
    /// Stretch and Pitch, glided. See `glide.rs`.
    glide: crate::glide::Glide<2>,
    /// Frames of post-roll left, once the end has been passed.
    post_left: Option<u64>,
    /// The L and R faders where they are, where they are going, where the
    /// ramp began, and how far into its 1024 frames it is.
    fader_now: [f32; 2],
    fader_to: [f32; 2],
    fader_from: [f32; 2],
    fader_step: usize,
    /// The Grain page's keys: AMP, Glide, Bend and Run (`keys.rs`). Inert until
    /// somebody plays one.
    keys: crate::keys::KeyPlayer,
    /// The same keys in Poly: a full engine per note (`voices.rs`).
    poly: crate::voices::Poly,
}

/// Hyperprism ramped a fader to a new gain in a straight line over this many
/// frames.
const FADER_RAMP: usize = 1024;

/// One control on its way to a new value.
///
/// A control written straight into an effect jumps at a block boundary, and a
/// discontinuity in a gain, a mix or a filter frequency is a click — the thing
/// people call zipper noise when it happens repeatedly. Every write from a hand
/// on a slider or from an automation lane therefore lands here first and is
/// walked toward its target over a few milliseconds instead.
///
/// The control's name is held inline rather than as a `String`, because the
/// audio thread may not allocate and the effect needs the name back to write it.
/// Thirty-two bytes covers every key in this codebase; a longer one is not
/// smoothed rather than truncated into some other control's name.
#[derive(Clone, Copy)]
struct Smoothed {
    slot: usize,
    key: [u8; 32],
    key_len: usize,
    current: f32,
    target: f32,
}

impl Smoothed {
    fn name(&self) -> &str {
        // Written from a `&str`, so it is still valid UTF-8.
        std::str::from_utf8(&self.key[..self.key_len]).unwrap_or("")
    }
    fn is(&self, slot: usize, key: &str) -> bool {
        self.slot == slot && self.name() == key
    }
}

/// How long a control takes to reach a new value, in seconds.
///
/// Long enough that a step cannot click, short enough that a control still
/// feels attached to the hand moving it. Fifteen milliseconds is about the
/// shortest that reliably does the first.
const SMOOTH_SECONDS: f32 = 0.015;

/// The most controls that can be smoothed at once. Past this the newest write
/// is applied directly, which is worse than smoothing and far better than
/// allocating in the callback.
const MAX_SMOOTHED: usize = 96;

/// Frames between control updates while something is moving.
///
/// A block is a few hundred frames, and moving a control once per block still
/// steps it by several dB — which is the click, just at a lower rate. So while
/// anything is travelling the rack is run in short pieces with the controls
/// nudged between them. About two thirds of a millisecond at 48 kHz, which is
/// far below what an ear resolves as an edge.
///
/// The chunking only happens while something is actually moving. A rack whose
/// controls are all where they were asked to be is processed in one go, exactly
/// as before, so this costs nothing when nobody is touching anything.
const CONTROL_CHUNK: usize = 8;

/// How long a rack swap takes to cross over.
///
/// Twenty milliseconds at the usual rates — long enough to spread the step
/// below hearing, short enough that changing a module still feels immediate.
/// In frames rather than seconds for the same reason the pitch glide is: the
/// figure only has to be about right, and threading a sample rate to it would
/// buy nothing.
const RACK_FADE_FRAMES: usize = 960;

/// Controls that must **not** be interpolated.
///
/// A ramp through the values between two settings is meaningless for these: a
/// filter type halfway between a bell and a notch is not a filter, and three
/// and a half notches is not a number of notches. Everything else — every gain,
/// mix, frequency, time and depth — is continuous and is smoothed.
///
/// Toggles are deliberately absent: a switch read as `>= 0.5` simply flips
/// halfway through the ramp, which is a switch happening 7 ms late and not a
/// wrong value.
fn is_stepped(key: &str) -> bool {
    matches!(key, "mode" | "notches" | "layers" | "fftSize" | "interpolation")
}



/// Another deck's block added into this one, sample for sample.
#[inline]
fn add_block(out: &mut [f32], extra: &[f32]) {
    for (o, x) in out.iter_mut().zip(extra) {
        *o += *x;
    }
}

/// Keep a copy of the block, if anyone asked. Last, so what lands on disk is
/// what came out of the speakers rather than some earlier stage of it.
fn capture_block(out: &[f32], shared: &Shared) {
    if shared.capturing.load(Ordering::Acquire) {
        if let Ok(mut g) = shared.capture.try_lock() {
            if let Some(c) = g.as_mut() {
                let room = c.samples.capacity() - c.samples.len();
                let n = room.min(out.len());
                if n > 0 {
                    // Within the capacity reserved before recording began,
                    // so this cannot allocate.
                    c.samples.extend_from_slice(&out[..n]);
                }
                if n < out.len() {
                    c.full = true;
                }
            }
        }
    }
}

/// One stereo frame added into an interleaved block at `base`: left and right on
/// the first two channels, or their mean on a mono device.
#[inline]
fn add_frame(out: &mut [f32], base: usize, channels: usize, l: f32, r: f32) {
    if channels == 1 {
        out[base] += 0.5 * (l + r);
    } else {
        out[base] += l;
        out[base + 1] += r;
    }
}

pub(crate) fn report(shared: &Shared, events: &[GrainEvent]) {
    if events.is_empty() {
        return;
    }
    if let Ok(mut g) = shared.events.try_lock() {
        // Bounded: if the UI stops draining, drop the oldest rather than grow.
        if g.len() > 4096 {
            g.clear();
        }
        g.extend_from_slice(events);
    }
}

/// Ramp the last `n` frames of a block down to silence.
fn fade_out(block: &mut [f32], channels: usize, n: usize) {
    let channels = channels.max(1);
    let frames = block.len() / channels;
    let n = n.min(frames);
    for i in 0..n {
        let k = 1.0 - (i + 1) as f32 / n as f32;
        let f = frames - n + i;
        for ch in 0..channels {
            block[f * channels + ch] *= k;
        }
    }
}

/// Ramp the first `n` frames of a block up from silence.
fn fade_in(block: &mut [f32], channels: usize, n: usize) {
    let channels = channels.max(1);
    let frames = block.len() / channels;
    let n = n.min(frames);
    for i in 0..n {
        let k = (i + 1) as f32 / n as f32;
        for ch in 0..channels {
            block[i * channels + ch] *= k;
        }
    }
}

#[cfg(test)]
mod tests;
