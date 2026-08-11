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

/// Window for the output spectrum. About 21 ms at 48 kHz — enough resolution to
/// be worth looking at, cheap enough to run in the callback.
const FFT_SIZE: usize = 1024;

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

    /// Magnitudes of the most recent output block, 0..255 per bin.
    ///
    /// Taken from what actually left the engine, so the spectrum shows the
    /// grains and the rack, not a guess at them. The browser used to do this
    /// with an AnalyserNode on the media element; there is no media element
    /// any more, and this is the more truthful measurement anyway.
    spectrum: Mutex<Vec<u8>>,
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
            gain: AtomicU32::new(1.0f32.to_bits()),
            overflows: AtomicU64::new(0),
            pending_rack: Mutex::new(None),
            pending_map: Mutex::new(None),
            spectrum: Mutex::new(Vec::new()),
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

    pub fn set_loop(&self, on: bool, a: u64, b: u64) {
        self.loop_a.store(a, Ordering::Release);
        self.loop_b.store(b, Ordering::Release);
        self.loop_on.store(on, Ordering::Release);
    }

    /// Hand a freshly built rack to the audio thread. Replacing an unclaimed
    /// one is fine: only the newest settings matter.
    /// Leave a transient map for the audio thread to pick up.
    pub fn set_map(&self, map: Option<fx::transient::TimeMap>) {
        if let Ok(mut g) = self.pending_map.lock() {
            *g = Some(map);
        }
    }

    pub fn set_rack(&self, rack: Option<fx::Rack>) {
        if let Ok(mut g) = self.pending_rack.lock() {
            *g = Some(rack);
        }
    }

    pub fn set_gain(&self, g: f32) {
        self.gain.store(g.clamp(0.0, 4.0).to_bits(), Ordering::Release);
    }

    pub fn spectrum(&self) -> Vec<u8> {
        self.spectrum.lock().map(|g| g.clone()).unwrap_or_default()
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
        if b > a + LOOP_FADE_FRAMES as u64 * 2 {
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
}

impl Core {
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
            fft_in: vec![0.0; FFT_SIZE],
            fft_at: 0,
            fft_re: vec![0.0; FFT_SIZE],
            fft_im: vec![0.0; FFT_SIZE],
            fft_bins: vec![0; FFT_SIZE / 2 + 1],
            params,
            source,
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
                self.rack = next;
            }
        }
        if let Ok(mut g) = shared.pending_map.try_lock() {
            if let Some(next) = g.take() {
                self.renderer.set_map(next);
            }
        }

        let seek = shared.seek.swap(-1, Ordering::AcqRel);
        if seek >= 0 {
            self.renderer.seek(seek as u64, &self.params);
        }

        if !shared.is_playing() {
            out.fill(0.0);
            shared
                .position
                .store(self.renderer.position(), Ordering::Release);
            return;
        }

        let frames = out.len() / channels;
        let end = self.params.plan().out_frames as u64;
        let bounds = shared.loop_bounds(end);

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
                    fade_out(slice, channels, LOOP_FADE_FRAMES);
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
                fade_in(&mut out[start * channels..], channels, LOOP_FADE_FRAMES);
            }
        }

        // The rack runs on the block, after the grains and before the fader,
        // exactly as the offline render orders it.
        if let Some(rack) = self.rack.as_mut() {
            rack.process(out, channels, self.params.sample_rate);
        }

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
