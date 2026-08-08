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

use crate::render::{BlockRenderer, Source};

/// Frames of fade either side of a loop wrap. A jump lands mid-waveform and
/// clicks without it.
const LOOP_FADE_FRAMES: usize = 512; // ~11 ms at 48 kHz

/// Shared between the UI threads and the audio callback.
pub struct Shared {
    params: Mutex<StreamParams>,
    source: Mutex<Arc<Source>>,
    /// Grains that started recently, for the swarm. Bounded: the visualiser
    /// missing a frame's worth matters far less than the audio stalling.
    events: Mutex<Vec<GrainEvent>>,

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
        }
    }

    pub fn set_params(&self, p: StreamParams) {
        if let Ok(mut g) = self.params.lock() {
            *g = p;
        }
    }

    pub fn params(&self) -> Option<StreamParams> {
        self.params.lock().ok().map(|g| *g)
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

    pub fn set_gain(&self, g: f32) {
        self.gain.store(g.clamp(0.0, 4.0).to_bits(), Ordering::Release);
    }

    /// Take the grains reported since the last call. The visualiser drains
    /// this; nothing else should.
    pub fn drain_events(&self) -> Vec<GrainEvent> {
        match self.events.lock() {
            Ok(mut g) => std::mem::take(&mut *g),
            Err(_) => Vec::new(),
        }
    }

    fn loop_bounds(&self) -> Option<(u64, u64)> {
        if !self.loop_on.load(Ordering::Acquire) {
            return None;
        }
        let a = self.loop_a.load(Ordering::Acquire);
        let b = self.loop_b.load(Ordering::Acquire);
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
    renderer: BlockRenderer,
    params: StreamParams,
    source: Arc<Source>,
    scratch: Vec<GrainEvent>,
}

impl Core {
    pub fn new(max_block: usize, params: StreamParams, source: Arc<Source>) -> Self {
        Core {
            renderer: BlockRenderer::new(max_block),
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
        let bounds = shared.loop_bounds();

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

        let gain = f32::from_bits(shared.gain.load(Ordering::Acquire));
        if (gain - 1.0).abs() > 1e-6 {
            for s in out.iter_mut() {
                *s *= gain;
            }
        }

        shared
            .position
            .store(self.renderer.position(), Ordering::Release);
        shared
            .overflows
            .store(self.renderer.overflows, Ordering::Release);
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
