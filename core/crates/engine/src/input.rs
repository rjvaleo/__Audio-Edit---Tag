//! Recording what comes *in* — a microphone, an instrument, a line from
//! somewhere else.
//!
//! Everything else in this program reads a file. This is the one place audio
//! enters from outside, and it is the only feature that can lose something that
//! never existed anywhere else, so the rules are stricter than elsewhere:
//!
//! - **The buffer is allocated when you arm, not when you start.** A recording
//!   that begins by allocating megabytes has already missed its first moment,
//!   and the input callback may not allocate at all.
//! - **A block that cannot be stored is counted, not dropped silently.** If the
//!   lock is contended or the ceiling is reached, [`Level::overruns`] says so
//!   and the interface can tell you the take is not what you heard.
//! - **Nothing is written to disk here.** The samples are handed back and the
//!   server decides where they land, exactly as a capture does.
//!
//! Monitoring is deliberately *not* offered. Feeding the input back to the
//! output through a machine's own converters is a feedback path and a latency
//! problem, and every interface that does it well does it in hardware.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

/// The most audio one take may hold, in seconds.
///
/// Ten minutes of 48 kHz stereo is about 230 MB. Reserved up front, because
/// growing a buffer inside the input callback is exactly the allocation that
/// makes a recording drop samples.
pub const MAX_SECONDS: f32 = 600.0;

/// What the interface needs to draw while a take is running.
#[derive(Debug, Clone, Copy, Default)]
pub struct Level {
    pub left: f32,
    pub right: f32,
    pub frames: u64,
    /// Blocks the callback could not store. Any number above zero means the
    /// take has a hole in it.
    pub overruns: u64,
}

/// Shared between the input callback and everyone else.
pub struct Input {
    recording: AtomicBool,
    peak_l: AtomicU32,
    peak_r: AtomicU32,
    frames: AtomicU64,
    overruns: AtomicU64,
    /// Reserved at arm time and never grown afterwards.
    buf: Mutex<Vec<f32>>,
    channels: usize,
    sample_rate: u32,
}

impl Input {
    pub fn new(channels: usize, sample_rate: u32) -> Self {
        Input {
            recording: AtomicBool::new(false),
            peak_l: AtomicU32::new(0),
            peak_r: AtomicU32::new(0),
            frames: AtomicU64::new(0),
            overruns: AtomicU64::new(0),
            buf: Mutex::new(Vec::new()),
            channels: channels.max(1),
            sample_rate: sample_rate.max(1),
        }
    }

    /// Reserve room for a take. Called when arming, off the audio thread.
    pub fn reserve(&self, seconds: f32) {
        let want = (seconds.max(0.0) * self.sample_rate as f32) as usize * self.channels;
        if let Ok(mut b) = self.buf.lock() {
            b.clear();
            let have = b.capacity();
            b.reserve_exact(want.saturating_sub(have));
        }
    }

    /// Take a block from the device.
    ///
    /// Metering happens whether or not a take is running, so the interface can
    /// show a level while armed and you can set your gain before committing.
    pub fn push(&self, block: &[f32]) {
        let ch = self.channels;
        let (mut l, mut r) = (0.0f32, 0.0f32);
        for frame in block.chunks(ch) {
            l = l.max(frame[0].abs());
            r = r.max(frame.get(1).copied().unwrap_or(frame[0]).abs());
        }
        self.peak_l.store(l.to_bits(), Ordering::Release);
        self.peak_r.store(r.to_bits(), Ordering::Release);

        if !self.recording.load(Ordering::Acquire) {
            return;
        }
        // `try_lock`, because the alternative is blocking the device's thread.
        // A block that cannot be taken is counted; see `Level::overruns`.
        match self.buf.try_lock() {
            Ok(mut b) => {
                if b.len() + block.len() <= b.capacity() {
                    b.extend_from_slice(block);
                    self.frames
                        .store((b.len() / ch) as u64, Ordering::Release);
                } else {
                    // Out of reserved room: the take is as long as it is going
                    // to get, and saying so is better than a silent stop.
                    self.overruns.fetch_add(1, Ordering::Relaxed);
                }
            }
            Err(_) => {
                self.overruns.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    pub fn start(&self) {
        if let Ok(mut b) = self.buf.lock() {
            b.clear();
        }
        self.frames.store(0, Ordering::Release);
        self.overruns.store(0, Ordering::Release);
        self.recording.store(true, Ordering::Release);
    }

    pub fn stop(&self) {
        self.recording.store(false, Ordering::Release);
    }

    pub fn is_recording(&self) -> bool {
        self.recording.load(Ordering::Acquire)
    }

    pub fn level(&self) -> Level {
        Level {
            left: f32::from_bits(self.peak_l.load(Ordering::Acquire)),
            right: f32::from_bits(self.peak_r.load(Ordering::Acquire)),
            frames: self.frames.load(Ordering::Acquire),
            overruns: self.overruns.load(Ordering::Acquire),
        }
    }

    pub fn channels(&self) -> usize {
        self.channels
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// Stop and hand the take over, leaving the buffer empty.
    pub fn take(&self) -> Vec<f32> {
        self.stop();
        match self.buf.lock() {
            Ok(mut b) => std::mem::take(&mut b),
            Err(_) => Vec::new(),
        }
    }
}

/// An open input device, and the buffer it is filling.
///
/// The stream is held here and closes when this is dropped, which is what
/// releases the device — and on macOS, what makes the microphone indicator go
/// out. Disarming really does let go.
pub struct Recorder {
    pub input: Arc<Input>,
    pub device: String,
    _stream: cpal::Stream,
}

/// Every input the machine offers, by name.
///
/// The default first, since that is what most people want and it saves a
/// choice. Names can repeat on some hosts; they are what the OS reports and
/// there is nothing better to key on.
pub fn devices() -> Vec<String> {
    let host = cpal::default_host();
    let mut out = Vec::new();
    // `to_string` rather than a `name()` call: cpal 0.18 dropped the method and
    // made the device's `Display` the name.
    if let Some(d) = host.default_input_device() {
        out.push(d.to_string());
    }
    if let Ok(list) = host.input_devices() {
        for d in list {
            let n = d.to_string();
            if !out.contains(&n) {
                out.push(n);
            }
        }
    }
    out
}

/// Open an input device and start metering.
///
/// `device` names one from [`devices`]; `None` takes the default. Failure here
/// is ordinary — no input at all, a device that will not do f32, or, on macOS,
/// microphone access refused — so it is reported rather than panicked on. The
/// permission case is worth naming in the message, because the fix is in System
/// Settings and nothing in this program can do it for you.
pub fn open(device: Option<&str>) -> Result<Recorder, String> {
    let host = cpal::default_host();
    let dev = match device {
        Some(want) => host
            .input_devices()
            .map_err(|e| format!("could not list input devices: {e}"))?
            .find(|d| d.to_string() == want)
            .ok_or_else(|| format!("no input device called {want:?}"))?,
        None => host
            .default_input_device()
            .ok_or_else(|| "no audio input device".to_string())?,
    };
    let name = dev.to_string();
    let config = dev.default_input_config().map_err(|e| {
        format!(
            "could not open {name:?}: {e}. On macOS this is usually microphone \
             access — grant it in System Settings ▸ Privacy & Security ▸ Microphone"
        )
    })?;

    let sample_rate = config.sample_rate();
    let channels = config.channels() as usize;
    let format = config.sample_format();
    let cfg: cpal::StreamConfig = config.into();

    let input = Arc::new(Input::new(channels, sample_rate));
    let for_cb = Arc::clone(&input);
    let err = |e| eprintln!("input stream error: {e}");

    let stream = match format {
        cpal::SampleFormat::F32 => dev
            .build_input_stream(
                cfg,
                move |data: &[f32], _: &cpal::InputCallbackInfo| for_cb.push(data),
                err,
                None,
            )
            .map_err(|e| format!("could not open {name:?}: {e}"))?,
        other => {
            return Err(format!(
                "{name:?} records {other:?}, and only f32 is handled"
            ))
        }
    };
    stream
        .play()
        .map_err(|e| format!("could not start {name:?}: {e}"))?;

    Ok(Recorder { input, device: name, _stream: stream })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metering_runs_before_a_take_does() {
        let i = Input::new(2, 48_000);
        i.push(&[0.5, -0.25, 0.1, 0.0]);
        let l = i.level();
        assert!((l.left - 0.5).abs() < 1e-6);
        assert!((l.right - 0.25).abs() < 1e-6);
        // Nothing kept: you can set a level before committing to a take.
        assert_eq!(l.frames, 0);
        assert!(i.take().is_empty());
    }

    #[test]
    fn a_take_keeps_what_it_was_given_and_reports_its_length() {
        let i = Input::new(2, 48_000);
        i.reserve(1.0);
        i.start();
        i.push(&[0.1, 0.2, 0.3, 0.4]);
        i.push(&[0.5, 0.6]);
        assert_eq!(i.level().frames, 3);
        let taken = i.take();
        assert_eq!(taken, vec![0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
        assert!(!i.is_recording(), "taking a recording ends it");
        assert!(i.take().is_empty(), "and leaves nothing behind");
    }

    /// The ceiling has to be visible. A take that quietly stopped early would
    /// be found out later, by which time the performance is over.
    #[test]
    fn running_out_of_room_is_counted_rather_than_hidden() {
        let i = Input::new(1, 1000);
        i.reserve(0.004); // four frames
        i.start();
        i.push(&[0.1, 0.2, 0.3, 0.4]);
        assert_eq!(i.level().overruns, 0);
        i.push(&[0.5]);
        assert!(i.level().overruns > 0, "the ceiling passed unremarked");
        // What was captured before the ceiling is still good.
        assert_eq!(i.take(), vec![0.1, 0.2, 0.3, 0.4]);
    }

    #[test]
    fn starting_a_second_take_does_not_keep_the_first() {
        let i = Input::new(1, 48_000);
        i.reserve(1.0);
        i.start();
        i.push(&[0.1, 0.2]);
        i.start();
        i.push(&[0.9]);
        assert_eq!(i.take(), vec![0.9]);
    }

    /// The callback must not allocate. Reserving up front is what prevents it,
    /// so the capacity must not move once a take is running.
    #[test]
    fn a_take_never_grows_its_buffer_while_it_runs() {
        let i = Input::new(2, 48_000);
        i.reserve(2.0);
        let before = i.buf.lock().unwrap().capacity();
        i.start();
        for _ in 0..500 {
            i.push(&[0.3; 256]);
        }
        assert_eq!(
            i.buf.lock().unwrap().capacity(),
            before,
            "the buffer reallocated mid-take"
        );
    }

    #[test]
    fn a_mono_device_reports_the_same_level_on_both_sides() {
        let i = Input::new(1, 48_000);
        i.push(&[0.4, -0.7, 0.2]);
        let l = i.level();
        assert!((l.left - 0.7).abs() < 1e-6);
        assert!((l.right - l.left).abs() < 1e-6);
    }
}
