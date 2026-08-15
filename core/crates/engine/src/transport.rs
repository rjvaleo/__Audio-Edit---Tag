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
use crate::stretcher::Stretcher;

/// Frames of fade either side of a loop wrap. A jump lands mid-waveform and
/// clicks without it.
const LOOP_FADE_FRAMES: usize = 512; // ~11 ms at 48 kHz

/// The shortest loop the wrap-and-crossfade path will accept.
///
/// Not a musical limit. It is where *wrapping* stops being the right mechanism:
/// 64 frames is 750 Hz at 48 kHz, so the seam rate is already inside the audio
/// band, and every wrap calls [`Stretcher::seek`], which re-primes the engine —
/// FFT state for the vocoder. The cost per second of audio climbs without
/// bound as the loop shortens. Loops below this want a phase accumulator over
/// the loop region rather than a smaller number here.
const MIN_LOOP_FRAMES: u64 = 64;

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
fn loop_fade(a: u64, b: u64) -> usize {
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
    /// Grains dropped because the voice pool was full.
    pub overflows: AtomicU64,

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
}

impl Shared {
    pub fn new(params: StreamParams, source: Arc<Source>) -> Self {
        Shared {
            params: Mutex::new(params),
            source: Mutex::new(source),
            events: Mutex::new(Vec::new()),
            playing: AtomicBool::new(false),
            position: AtomicU64::new(0),
            seek: AtomicI64::new(-1),
            loop_on: AtomicBool::new(false),
            loop_a: AtomicU64::new(0),
            loop_b: AtomicU64::new(0),
            heard_a: AtomicU64::new(0),
            heard_b: AtomicU64::new(0),
            latency: AtomicU64::new(0),
            gain: AtomicU32::new(1.0f32.to_bits()),
            overflows: AtomicU64::new(0),
            pending_rack: Mutex::new(None),
            pending_map: Mutex::new(None),
            pending_parts: Mutex::new(None),
            pending_bank: Mutex::new(None),
            rack_meters: Arc::new(fx::RackMeters::new()),
            automation: Mutex::new(Vec::new()),
            manual: Mutex::new(Vec::new()),
            spectrum: Mutex::new(Vec::new()),
            waveform: Mutex::new(Vec::new()),
            capture: Mutex::new(None),
            capturing: AtomicBool::new(false),
        }
    }

    /// Begin keeping what comes out, up to `seconds` of it.
    ///
    /// The whole buffer is reserved now, on this thread, because the callback
    /// is not allowed to allocate. Running out is not an error — the recording
    /// simply stops growing, and the flag says so.
    pub fn start_capture(&self, channels: usize, sample_rate: u32, seconds: f32) {
        let cap = (sample_rate as f32 * seconds) as usize * channels.max(1);
        if let Ok(mut g) = self.capture.lock() {
            *g = Some(Capture {
                samples: Vec::with_capacity(cap),
                channels: channels.max(1),
                sample_rate,
                full: false,
            });
        }
        self.capturing.store(true, Ordering::Release);
    }

    /// Stop, and hand back what was kept.
    pub fn take_capture(&self) -> Option<Capture> {
        self.capturing.store(false, Ordering::Release);
        self.capture.lock().ok().and_then(|mut g| g.take())
    }

    pub fn is_capturing(&self) -> bool {
        self.capturing.load(Ordering::Acquire)
    }

    /// How much has been kept so far, in frames.
    pub fn captured_frames(&self) -> u64 {
        self.capture
            .try_lock()
            .ok()
            .and_then(|g| g.as_ref().map(|c| (c.samples.len() / c.channels.max(1)) as u64))
            .unwrap_or(0)
    }

    pub fn set_params(&self, p: StreamParams) {
        if let Ok(mut g) = self.params.lock() {
            *g = p;
        }
    }

    pub fn params(&self) -> Option<StreamParams> {
        self.params.lock().ok().map(|g| *g)
    }

    /// The audio currently loaded, for callers that need to derive something
    /// from it off the audio thread — the transient map, for instance.
    pub fn source(&self) -> Option<Arc<Source>> {
        self.source.lock().ok().map(|g| Arc::clone(&g))
    }

    pub fn set_source(&self, s: Arc<Source>) {
        if let Ok(mut g) = self.source.lock() {
            *g = s;
        }
    }

    pub fn play(&self) {
        self.playing.store(true, Ordering::Release);
    }

    pub fn pause(&self) {
        self.playing.store(false, Ordering::Release);
    }

    pub fn is_playing(&self) -> bool {
        self.playing.load(Ordering::Acquire)
    }

    pub fn position(&self) -> u64 {
        self.position.load(Ordering::Acquire)
    }

    pub fn request_seek(&self, frame: u64) {
        self.seek.store(frame as i64, Ordering::Release);
    }

    /// The loop the callback last used: start, end, and whether there is one.
    pub fn heard_loop(&self) -> Option<(u64, u64)> {
        let b = self.heard_b.load(Ordering::Acquire);
        if b == 0 {
            None
        } else {
            Some((self.heard_a.load(Ordering::Acquire), b))
        }
    }

    pub fn latency_frames(&self) -> u64 {
        self.latency.load(Ordering::Acquire)
    }

    pub fn set_latency_frames(&self, frames: u64) {
        self.latency.store(frames, Ordering::Release);
    }

    pub fn set_loop(&self, on: bool, a: u64, b: u64) {
        self.loop_a.store(a, Ordering::Release);
        self.loop_b.store(b, Ordering::Release);
        self.loop_on.store(on, Ordering::Release);
    }

    /// Hand a freshly built rack to the audio thread. Replacing an unclaimed
    /// one is fine: only the newest settings matter.
    /// Leave a bank of extra layers for the audio thread to pick up.
    pub fn set_bank(&self, bank: crate::stretcher::LayerBank) {
        if let Ok(mut g) = self.pending_bank.lock() {
            *g = Some(bank);
        }
    }

    /// Leave a freshly separated source for the audio thread to pick up.
    pub fn set_parts(&self, parts: Arc<fx::hstream::Parts>) {
        if let Ok(mut g) = self.pending_parts.lock() {
            *g = Some(parts);
        }
    }

    /// Leave a transient map for the audio thread to pick up.
    pub fn set_map(&self, map: Option<fx::transient::TimeMap>) {
        if let Ok(mut g) = self.pending_map.lock() {
            *g = Some(map);
        }
    }

    pub fn set_rack(&self, mut rack: Option<fx::Rack>) {
        if let Some(r) = rack.as_mut() {
            r.set_meters(Arc::clone(&self.rack_meters));
        }
        if let Ok(mut g) = self.manual.lock() {
            g.clear();
        }
        if let Ok(mut g) = self.pending_rack.lock() {
            *g = Some(rack);
        }
    }

    /// Move one control on one slot, live, without rebuilding anything.
    ///
    /// This is what a hand on a slider sends. Rebuilding the rack to change a
    /// number throws away every delay line, filter and reverb tail in the
    /// chain — which is audible as a click at best and as the tail vanishing at
    /// worst, and is why moving a control never felt connected to the sound.
    pub fn set_manual_param(&self, slot: usize, key: &str, value: f32) {
        if let Ok(mut g) = self.manual.lock() {
            match g.iter_mut().find(|(s, k, _)| *s == slot && k == key) {
                Some(entry) => entry.2 = value,
                None => g.push((slot, key.to_string(), value)),
            }
        }
    }

    /// Peak level either side of each slot: index 0 is the rack's input, index
    /// *n+1* the output of slot *n*.
    pub fn rack_levels(&self) -> Vec<(f32, f32)> {
        self.rack_meters.snapshot()
    }

    /// Each slot's own scalar — gain reduction for a compressor, zero for
    /// anything with nothing worth reporting.
    pub fn rack_telemetry(&self) -> Vec<f32> {
        self.rack_meters.telemetry_snapshot()
    }

    /// Drop the meters to silence. Called when playback stops, so a rail of
    /// meters falls rather than freezing at the last block that was heard.
    pub fn clear_rack_meters(&self) {
        self.rack_meters.clear();
    }

    /// Replace the automation writes the callback applies each block.
    ///
    /// Called from a control thread a hundred or so times a second. The vector
    /// and its strings are built here and dropped here; see
    /// [`Shared::automation`] for why that matters.
    pub fn set_automation(&self, values: Vec<(usize, String, f32)>) {
        if let Ok(mut g) = self.automation.lock() {
            *g = values;
        }
    }

    /// Stop applying automation — on stop, or when the last lane goes away.
    ///
    /// Without this the final values would stay written into the rack after
    /// playback ended, and the next thing to play would start under them.
    pub fn clear_automation(&self) {
        if let Ok(mut g) = self.automation.lock() {
            g.clear();
        }
    }

    /// What the callback is currently applying. For tests and diagnostics.
    pub fn automation_writes(&self) -> Vec<(usize, String, f32)> {
        self.automation.lock().map(|g| g.clone()).unwrap_or_default()
    }

    pub fn set_gain(&self, g: f32) {
        self.gain.store(g.clamp(0.0, 4.0).to_bits(), Ordering::Release);
    }

    pub fn spectrum(&self) -> Vec<u8> {
        self.spectrum.lock().map(|g| g.clone()).unwrap_or_default()
    }

    pub fn waveform(&self) -> Vec<i8> {
        self.waveform.lock().map(|g| g.clone()).unwrap_or_default()
    }

    /// Take the grains reported since the last call. The visualiser drains
    /// this; nothing else should.
    pub fn drain_events(&self) -> Vec<GrainEvent> {
        match self.events.lock() {
            Ok(mut g) => std::mem::take(&mut *g),
            Err(_) => Vec::new(),
        }
    }

    /// `end` is the document's length under the current ratio, used when the
    /// caller asks to loop the whole thing.
    ///
    /// A loop end of zero means "all of it". The alternative is for the UI to
    /// work out the length itself and keep it in step with every ratio change,
    /// which it cannot reliably do — it guessed wrong, and playback ran past
    /// the end of a looping file.
    fn loop_bounds(&self, end: u64) -> Option<(u64, u64)> {
        if !self.loop_on.load(Ordering::Acquire) {
            return None;
        }
        let a = self.loop_a.load(Ordering::Acquire);
        let b = match self.loop_b.load(Ordering::Acquire) {
            0 => end,
            n => n.min(end.max(1)),
        };
        if b > a + MIN_LOOP_FRAMES {
            Some((a, b))
        } else {
            None
        }
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
    scratch: Vec<GrainEvent>,
    /// Where each driven control currently *is*, as opposed to where it has
    /// been asked to go. See [`Smoothed`].
    smoothing: Vec<Smoothed>,
}

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



impl Core {
    /// Point a control at a new value, without moving it yet.
    ///
    /// A control asked for something it is already at costs nothing; a new one
    /// starts from where it was asked to go rather than from zero, so the first
    /// write of a session lands immediately instead of sweeping up from silence.
    fn aim(&mut self, slot: usize, key: &str, value: f32) {
        if let Some(s) = self.smoothing.iter_mut().find(|s| s.is(slot, key)) {
            s.target = value;
            // A control that cannot meaningfully be halfway between two
            // settings jumps: see `is_stepped`.
            if is_stepped(key) {
                s.current = value;
            }
            return;
        }
        // First sight of this control. Start it from wherever the effect
        // actually is and ramp from there — writing it straight through was the
        // click, because the first move of any control is the one that matters.
        // An effect that cannot say where it is gets the value directly, which
        // is the old behaviour and the best that can be done for it.
        let from = self.rack.as_ref().and_then(|r| r.get_param(slot, key));
        if from.is_none() {
            if let Some(rack) = self.rack.as_mut() {
                rack.set_param(slot, key, value);
            }
        }
        let bytes = key.as_bytes();
        if self.smoothing.len() < MAX_SMOOTHED && bytes.len() <= 32 {
            let mut buf = [0u8; 32];
            buf[..bytes.len()].copy_from_slice(bytes);
            self.smoothing.push(Smoothed {
                slot,
                key: buf,
                key_len: bytes.len(),
                current: if is_stepped(key) { value } else { from.unwrap_or(value) },
                target: value,
            });
        }
    }

    /// Run the rack, nudging any travelling control as it goes.
    ///
    /// In one piece when nothing is moving, which is almost always; in short
    /// pieces while something is, so a control arrives as a slope rather than
    /// as an edge. See [`CONTROL_CHUNK`].
    fn process_rack(&mut self, out: &mut [f32], channels: usize) {
        if self.rack.is_none() && self.leaving.is_none() {
            return;
        }
        let ch = channels.max(1);
        let sr = self.params.sample_rate;

        // The rack being left behind has to see the block as it arrived, and
        // the one arriving works in place — so keep a copy first.
        let fading = self.leaving.is_some() && self.rack_dry.len() >= out.len();
        if fading {
            self.rack_dry[..out.len()].copy_from_slice(out);
        }

        self.process_current(out, ch, sr);

        if !fading {
            return;
        }
        let frames = out.len() / ch;
        let mut dry = std::mem::take(&mut self.rack_dry);
        let mut done = false;
        if let Some((old, left)) = self.leaving.as_mut() {
            old.process(&mut dry[..out.len()], ch, sr);
            // Equal gain, not equal power. Two racks fed the same block are
            // two versions of one signal and largely in phase with each other,
            // so a root-two lift through the middle would be a bump rather
            // than a correction. This is the opposite call from switching
            // stretch engines, where the two agree about content and not at
            // all about phase.
            for f in 0..frames {
                let t = ((RACK_FADE_FRAMES - *left + f) as f32 / RACK_FADE_FRAMES as f32)
                    .clamp(0.0, 1.0);
                for c in 0..ch {
                    let i = f * ch + c;
                    out[i] = out[i] * t + dry[i] * (1.0 - t);
                }
            }
            *left = left.saturating_sub(frames);
            done = *left == 0;
        }
        self.rack_dry = dry;
        if done {
            self.leaving = None;
        }
    }

    /// The rack that is actually in the chain, smoothing as it goes.
    fn process_current(&mut self, out: &mut [f32], ch: usize, sr: u32) {
        if self.rack.is_none() {
            return;
        }
        let moving = self
            .smoothing
            .iter()
            .any(|s| (s.current - s.target).abs() > 1e-7);
        if !moving {
            if let Some(rack) = self.rack.as_mut() {
                rack.process(out, ch, sr);
            }
            return;
        }
        for chunk in out.chunks_mut(CONTROL_CHUNK * ch) {
            self.settle(chunk.len() / ch);
            if let Some(rack) = self.rack.as_mut() {
                rack.process(chunk, ch, sr);
            }
        }
    }

    /// Move every driven control one step closer to its target and write it.
    fn settle(&mut self, frames: usize) {
        if self.smoothing.is_empty() {
            return;
        }
        let sr = self.params.sample_rate.max(1) as f32;
        // One pole, per block. The block is short next to the time constant, so
        // treating the whole block as one step is inaudible and costs one
        // multiply per control rather than one per sample.
        let k = (1.0 - (-(frames as f32) / (SMOOTH_SECONDS * sr)).exp()).clamp(0.0, 1.0);
        let Some(rack) = self.rack.as_mut() else { return };
        for s in &mut self.smoothing {
            if (s.current - s.target).abs() < 1e-7 {
                continue;
            }
            s.current += (s.target - s.current) * k;
            // Land exactly rather than approaching forever, so a control that
            // has arrived stops costing anything.
            if (s.current - s.target).abs() < 1e-6 {
                s.current = s.target;
            }
            rack.set_param(s.slot, s.name(), s.current);
        }
    }

    /// `channels` is the *device's* channel count, not the source's.
    ///
    /// The engines size their buffers from it once and never again, so it has
    /// to be the width they will actually be asked to fill. Taking it from the
    /// source was wrong twice over: the source at build time is the silent
    /// placeholder, which is mono, and the source changes every time a file is
    /// opened while the device's width never does. A stereo file rendered into
    /// half its buffer and left the rest silent.
    pub fn new(
        max_block: usize,
        channels: usize,
        params: StreamParams,
        source: Arc<Source>,
    ) -> Self {
        Core {
            renderer: Stretcher::new(max_block, channels.max(1), params.sample_rate),
            rack: None,
            leaving: None,
            rack_dry: vec![0.0; max_block.max(1) * channels.max(1)],
            fft_in: vec![0.0; FFT_SIZE],
            fft_at: 0,
            fft_re: vec![0.0; FFT_SIZE],
            fft_im: vec![0.0; FFT_SIZE],
            fft_bins: vec![0; FFT_SIZE / 2 + 1],
            params,
            source,
            // Capacity up front: `aim` runs in the callback and must never
            // grow this.
            smoothing: Vec::with_capacity(MAX_SMOOTHED),
            scratch: vec![
                GrainEvent {
                    index: 0,
                    out_frame: 0,
                    src_frame: 0.0,
                    size: 0,
                    rate: 1.0,
                    pitch_semis: 0.0,
                };
                128
            ],
        }
    }

    /// Fill one block. This is the whole audio callback, minus the device.
    ///
    /// Split out so the transport can be tested without a sound card — looping,
    /// seeking and stopping are exactly the things that are miserable to debug
    /// through a pair of speakers.
    pub fn fill(&mut self, out: &mut [f32], channels: usize, shared: &Shared) {
        let channels = channels.max(1);

        // Pick up changes if they are free to take, otherwise carry on with
        // what we have. Never block the audio thread.
        if let Ok(g) = shared.params.try_lock() {
            self.params = *g;
        }
        if let Ok(g) = shared.source.try_lock() {
            if !Arc::ptr_eq(&self.source, &g) {
                self.source = Arc::clone(&g);
            }
        }

        if let Ok(mut g) = shared.pending_rack.try_lock() {
            if let Some(next) = g.take() {
                // Keep the old chain alive for the crossfade. It shares the
                // meter block with the new one, so it is silenced first —
                // two writers on the same needles is a flicker between two
                // different chains.
                if let Some(mut old) = self.rack.take() {
                    old.mute_meters();
                    self.leaving = Some((old, RACK_FADE_FRAMES));
                }
                self.rack = next;
            }
        }
        if let Ok(mut g) = shared.pending_map.try_lock() {
            if let Some(next) = g.take() {
                self.renderer.set_map(next);
            }
        }
        if let Ok(mut g) = shared.pending_parts.try_lock() {
            if let Some(next) = g.take() {
                self.renderer.set_parts(next);
            }
        }
        if let Ok(mut g) = shared.pending_bank.try_lock() {
            if let Some(next) = g.take() {
                self.renderer.set_bank(next);
            }
        }
        // Borrowed, never taken — see `Shared::automation`. A contended lock
        // means the writer is mid-update; the previous values are still
        // applied, so skipping a block loses nothing.
        // Aim the smoothers at whatever has been asked for. Manual first, then
        // automation, so a lane wins over a hand on the same control.
        if self.rack.is_some() {
            if let Ok(g) = shared.manual.try_lock() {
                for (slot, key, value) in g.iter() {
                    self.aim(*slot, key, *value);
                }
            }
            if let Ok(g) = shared.automation.try_lock() {
                for (slot, key, value) in g.iter() {
                    self.aim(*slot, key, *value);
                }
            }
        }

        let seek = shared.seek.swap(-1, Ordering::AcqRel);
        if seek >= 0 {
            self.renderer.seek(seek as u64, &self.params);
        }

        if !shared.is_playing() {
            out.fill(0.0);
            // Nothing is passing through the rack, so the meters must fall
            // rather than hold the last block that was heard.
            shared.rack_meters.clear();
            shared
                .position
                .store(self.renderer.position(), Ordering::Release);
            return;
        }

        let frames = out.len() / channels;
        let end = self.params.plan().out_frames as u64;
        let bounds = shared.loop_bounds(end);
        // Publish what was resolved, so a playhead somewhere else can wrap at
        // the same place rather than run past it and be dragged back.
        match bounds {
            Some((a, b)) => {
                shared.heard_a.store(a, Ordering::Release);
                shared.heard_b.store(b, Ordering::Release);
            }
            None => shared.heard_b.store(0, Ordering::Release),
        }

        // Not looping and past the end: stop. The engine has no end of its own
        // — a grain stream is happy to run forever, reading the clamped last
        // sample — so the end has to come from the schedule, which knows how
        // long the current ratio makes the document.
        if bounds.is_none() {
            if end > 0 && self.renderer.position() >= end {
                shared.pause();
                out.fill(0.0);
                shared
                    .position
                    .store(self.renderer.position(), Ordering::Release);
                return;
            }
        }

        // Wrap first if we are already at or past the loop end, so a loop set
        // behind the playhead takes effect immediately.
        if let Some((a, b)) = bounds {
            if self.renderer.position() >= b || self.renderer.position() < a {
                self.renderer.seek(a, &self.params);
            }
        }

        // The seam fade, sized to this loop. Both sides of the wrap use it, so
        // it is resolved once rather than per chunk — and so the ramp down and
        // the ramp up are always the same length.
        let seam = bounds.map_or(LOOP_FADE_FRAMES, |(a, b)| loop_fade(a, b));

        let mut filled = 0usize;
        // Where in this block fresh post-wrap material begins, if it does.
        let mut wrapped_at: Option<usize> = None;
        while filled < frames {
            let want = frames - filled;
            // Never render past the loop end in one go: the wrap has to land on
            // an exact frame or the loop drifts.
            let chunk = match bounds {
                Some((_, b)) => {
                    let room = b.saturating_sub(self.renderer.position()) as usize;
                    want.min(room.max(1))
                }
                None => want,
            };

            let slice = &mut out[filled * channels..(filled + chunk) * channels];
            let n = self
                .renderer
                .render(slice, channels, &self.source, &self.params, &mut self.scratch);
            report(shared, &self.scratch[..n]);

            if let Some((a, b)) = bounds {
                if self.renderer.position() >= b {
                    // Fade the tail of what we just wrote, then jump. One
                    // source, so this is a fade across the seam rather than an
                    // overlap of two copies.
                    fade_out(slice, channels, seam);
                    self.renderer.seek(a, &self.params);
                    wrapped_at = Some(filled + chunk);
                }
            }
            filled += chunk;
        }

        // Ramp the material that came after the jump — and only that. Ramping
        // every block would put an amplitude wobble at the block rate on
        // everything.
        if let Some(start) = wrapped_at {
            if start < frames {
                fade_in(&mut out[start * channels..], channels, seam);
            }
        }

        // The rack runs on the block, after the grains and before the fader,
        // exactly as the offline render orders it.
        self.process_rack(out, channels);

        let gain = f32::from_bits(shared.gain.load(Ordering::Acquire));
        if (gain - 1.0).abs() > 1e-6 {
            for s in out.iter_mut() {
                *s *= gain;
            }
        }

        // Keep a copy, if anyone asked. Last, so what lands on disk is what
        // came out of the speakers rather than some earlier stage of it.
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

        self.measure(out, channels, shared);

        shared
            .position
            .store(self.renderer.position(), Ordering::Release);
        shared
            .overflows
            .store(self.renderer.overflows(), Ordering::Release);
    }

    /// Feed the block into the spectrum window and publish a frame each time it
    /// fills. Allocation-free: every buffer here was sized once, at build.
    fn measure(&mut self, out: &[f32], channels: usize, shared: &Shared) {
        let frames = out.len() / channels.max(1);
        for f in 0..frames {
            let mut sum = 0.0;
            for ch in 0..channels {
                sum += out[f * channels + ch];
            }
            self.fft_in[self.fft_at] = sum / channels as f32;
            self.fft_at += 1;
            if self.fft_at < FFT_SIZE {
                continue;
            }
            self.fft_at = 0;

            for i in 0..FFT_SIZE {
                let w = 0.5
                    - 0.5
                        * (2.0 * std::f32::consts::PI * i as f32 / (FFT_SIZE - 1) as f32).cos();
                self.fft_re[i] = self.fft_in[i] * w;
                self.fft_im[i] = 0.0;
            }
            audio_core::fft::fft(&mut self.fft_re, &mut self.fft_im);

            // dB, mapped to the 0..255 the visualiser already speaks.
            for i in 0..self.fft_bins.len() {
                let m = (self.fft_re[i] * self.fft_re[i] + self.fft_im[i] * self.fft_im[i]).sqrt()
                    / (FFT_SIZE as f32 / 4.0);
                let db = 20.0 * m.max(1e-7).log10();
                let v = ((db + 90.0) / 90.0 * 255.0).clamp(0.0, 255.0);
                self.fft_bins[i] = v as u8;
            }
            if let Ok(mut g) = shared.spectrum.try_lock() {
                g.clear();
                g.extend_from_slice(&self.fft_bins);
            }
            // The same window, reduced to one peak per column. Peak rather than
            // an average: a compressor is reacting to the peaks, so an average
            // would draw a signal that never reaches the threshold the display
            // is drawing across it.
            if let Ok(mut g) = shared.waveform.try_lock() {
                g.clear();
                let step = FFT_SIZE / WAVE_POINTS;
                for i in 0..WAVE_POINTS {
                    let mut peak = 0.0f32;
                    for s in &self.fft_in[i * step..(i + 1) * step] {
                        if s.abs() > peak.abs() {
                            peak = *s;
                        }
                    }
                    g.push((peak.clamp(-1.0, 1.0) * 127.0) as i8);
                }
            }
        }
    }
}

fn report(shared: &Shared, events: &[GrainEvent]) {
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
mod tests {
    use super::*;
    use fx::grain::StreamParams;

    /// A `Shared` is only atomics plus two mutexes; the source never gets read
    /// by `loop_bounds`, so an empty one is honest here rather than a stub.
    fn shared() -> Shared {
        Shared::new(
            StreamParams::new(48_000, 48_000),
            Arc::new(Source { samples: Vec::new(), channels: 2 }),
        )
    }

    /// The bug this replaced: a loop of 1000 output frames is shorter than the
    /// old `LOOP_FADE_FRAMES * 2` guard, so `loop_bounds` returned `None` —
    /// which the caller reads as "not looping", plays to the end of the
    /// document and pauses. A short loop stopped the machine.
    ///
    /// It is stretch-dependent because `a` and `b` are *output* frames: the
    /// same region of source falls under the threshold as the ratio drops.
    #[test]
    fn a_loop_shorter_than_the_old_threshold_is_honoured() {
        let s = shared();
        s.set_loop(true, 0, 1000);
        assert_eq!(s.loop_bounds(100_000), Some((0, 1000)));
    }

    #[test]
    fn a_loop_of_a_few_hundred_frames_is_honoured() {
        let s = shared();
        s.set_loop(true, 4_000, 4_300);
        assert_eq!(s.loop_bounds(100_000), Some((4_000, 4_300)));
    }

    /// Still refused below the point where wrapping is the wrong mechanism —
    /// see `MIN_LOOP_FRAMES`. This is the boundary, not a musical judgement.
    #[test]
    fn a_loop_at_or_under_the_floor_is_still_refused() {
        let s = shared();
        s.set_loop(true, 0, MIN_LOOP_FRAMES);
        assert_eq!(s.loop_bounds(100_000), None);
        s.set_loop(true, 0, MIN_LOOP_FRAMES + 1);
        assert!(s.loop_bounds(100_000).is_some());
    }

    #[test]
    fn loop_off_means_no_bounds_however_long_the_region() {
        let s = shared();
        s.set_loop(false, 0, 50_000);
        assert_eq!(s.loop_bounds(100_000), None);
    }

    /// An ordinary loop is far longer than 2 kframes and is unaffected by any
    /// of this — it gets exactly the fade it always got.
    #[test]
    fn an_ordinary_loop_keeps_the_full_fade() {
        assert_eq!(loop_fade(0, 48_000), LOOP_FADE_FRAMES);
        assert_eq!(loop_fade(10_000, 12_048), LOOP_FADE_FRAMES);
    }

    /// The seam can never eat more than half the loop, because both sides get
    /// `loop_fade` and each is capped at a quarter. That is the property the
    /// old guard was protecting by refusing to loop at all.
    #[test]
    fn the_two_fades_never_cover_more_than_half_a_loop() {
        for len in [65u64, 100, 256, 512, 1000, 2048, 4096, 48_000] {
            let fade = loop_fade(0, len) as u64;
            assert!(
                fade * 2 <= len,
                "a {len}-frame loop got {fade} frames of fade on each side"
            );
        }
    }

    #[test]
    fn a_short_loop_gets_a_short_fade_rather_than_none() {
        assert_eq!(loop_fade(0, 400), 100);
        assert_eq!(loop_fade(0, 100), 25);
        assert!(loop_fade(0, 65) >= 1, "a loop above the floor must still fade");
    }
}
