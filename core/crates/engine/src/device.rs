//! The output device.
//!
//! Everything above this file is testable without a sound card. This is the
//! only part that is not, so it is kept as thin as it can be: open a stream,
//! hand each block to `Core::fill`, and get out of the way.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::Arc;

use crate::render::Source;
use crate::transport::{Core, Shared};
use fx::grain::StreamParams;

pub struct Engine {
    shared: Arc<Shared>,
    /// Dropping this closes the device, so it has to be held even though
    /// nothing reads it.
    _stream: cpal::Stream,
    pub sample_rate: u32,
    pub channels: usize,
}

impl Engine {
    /// Open the default output device and start pulling blocks.
    ///
    /// The device's own sample rate wins. Source audio is resampled to it when
    /// loaded, which keeps the grain scheduler working in one rate rather than
    /// two — the alternative is a resampler in the callback with fractional
    /// state to carry, for no gain.
    pub fn start(params: StreamParams, source: Arc<Source>) -> Result<Engine, String> {
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| "no audio output device".to_string())?;
        let config = device
            .default_output_config()
            .map_err(|e| format!("no default output config: {e}"))?;

        let sample_rate = config.sample_rate();
        let channels = config.channels() as usize;
        let format = config.sample_format();
        let cfg: cpal::StreamConfig = config.into();

        let shared = Arc::new(Shared::new(params, source.clone()));
        let core_shared = Arc::clone(&shared);

        // Generous: the device may ask for more than its stated buffer size,
        // and growing inside the callback would allocate.
        let mut core = Core::new(8192, channels, params, source);

        let err = |e| eprintln!("audio stream error: {e}");

        let stream = match format {
            cpal::SampleFormat::F32 => device.build_output_stream(
                cfg,
                move |out: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    core.fill(out, channels, &core_shared);
                },
                err,
                None,
            ),
            other => {
                return Err(format!(
                    "unsupported output sample format {other:?}; only f32 is handled"
                ))
            }
        }
        .map_err(|e| format!("could not open the output stream: {e}"))?;

        stream
            .play()
            .map_err(|e| format!("could not start the output stream: {e}"))?;

        Ok(Engine {
            shared,
            _stream: stream,
            sample_rate,
            channels,
        })
    }

    pub fn shared(&self) -> &Arc<Shared> {
        &self.shared
    }
}

/// What the rest of the program holds onto.
///
/// [`Engine`] cannot be it: `cpal::Stream` is not `Send` on macOS, and the HTTP
/// server hands its state to whichever thread takes the request. So the stream
/// gets a thread of its own that does nothing but own it, and everyone else
/// talks to the audio through [`Shared`], which is `Send + Sync` by
/// construction.
pub struct Handle {
    pub shared: Arc<Shared>,
    pub sample_rate: u32,
    pub channels: usize,
}

/// Start the engine on its own thread and wait to hear whether it opened.
///
/// Failure here is ordinary — a machine with no output device, or one whose
/// default device does not do f32 — so it is reported, not panicked on.
pub fn spawn(params: StreamParams, source: Arc<Source>) -> Result<Handle, String> {
    let (tx, rx) = std::sync::mpsc::channel();

    std::thread::Builder::new()
        .name("audio-device".into())
        .spawn(move || match Engine::start(params, source) {
            Ok(engine) => {
                let handle = Handle {
                    shared: Arc::clone(engine.shared()),
                    sample_rate: engine.sample_rate,
                    channels: engine.channels,
                };
                if tx.send(Ok(handle)).is_err() {
                    return; // nobody waiting; let the stream close
                }
                // Hold the stream open. The audio runs on the device's own
                // thread; this one exists only to keep `engine` alive.
                loop {
                    std::thread::park();
                }
            }
            Err(e) => {
                let _ = tx.send(Err(e));
            }
        })
        .map_err(|e| format!("could not start the audio thread: {e}"))?;

    rx.recv()
        .map_err(|_| "the audio thread stopped before it opened a device".to_string())?
}

/// Resample interleaved audio to `to` Hz, linearly.
///
/// Done once when a file is loaded, not per block. The grain reader already
/// interpolates linearly on every read, so this adds no error the signal path
/// does not already have.
pub fn resample(input: &[f32], channels: usize, from: u32, to: u32) -> Vec<f32> {
    let channels = channels.max(1);
    if from == to || from == 0 || input.is_empty() {
        return input.to_vec();
    }
    let in_frames = input.len() / channels;
    let out_frames = ((in_frames as f64) * (to as f64) / (from as f64)).round() as usize;
    let mut out = vec![0f32; out_frames * channels];
    let step = (from as f64) / (to as f64);

    for f in 0..out_frames {
        let pos = f as f64 * step;
        let i = pos.floor() as usize;
        let t = (pos - i as f64) as f32;
        let a = i.min(in_frames - 1);
        let b = (i + 1).min(in_frames - 1);
        for ch in 0..channels {
            let s0 = input[a * channels + ch];
            let s1 = input[b * channels + ch];
            out[f * channels + ch] = s0 + (s1 - s0) * t;
        }
    }
    out
}
