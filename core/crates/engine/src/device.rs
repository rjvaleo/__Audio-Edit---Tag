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
/// Lay a source out for a device with a different number of channels.
///
/// The streaming engines index their input with the channel count they are
/// *rendering* at, which is the device's. A mono file handed to a stereo device
/// was therefore read two samples at a time — twice too fast, and out of
/// material half way through, which is heard as a fast playback that stops. The
/// grain cloud was the only engine unaffected, because it maps the device's
/// channel back to a source channel before it reads.
///
/// So the source is conformed once, here, off the audio thread, and
/// `Source.channels` always matches the device from then on.
///
/// Widening copies a channel to its neighbours; narrowing averages, because
/// dropping the right half of a stereo file is a worse answer than mixing it.
pub fn conform_channels(input: &[f32], from: usize, to: usize) -> Vec<f32> {
    if from == to || from == 0 || to == 0 || input.is_empty() {
        return input.to_vec();
    }
    let frames = input.len() / from;
    let mut out = vec![0f32; frames * to];
    for f in 0..frames {
        if to < from {
            // Fold everything down into each output channel.
            let mut sum = 0f32;
            for ch in 0..from {
                sum += input[f * from + ch];
            }
            let avg = sum / from as f32;
            for ch in 0..to {
                out[f * to + ch] = avg;
            }
        } else {
            for ch in 0..to {
                out[f * to + ch] = input[f * from + ch.min(from - 1)];
            }
        }
    }
    out
}

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

#[cfg(test)]
mod conform_tests {
    use super::conform_channels;

    #[test]
    fn a_matching_layout_is_handed_straight_back() {
        let v = vec![0.1, 0.2, 0.3, 0.4];
        assert_eq!(conform_channels(&v, 2, 2), v);
        assert_eq!(conform_channels(&v, 1, 1), v);
    }

    #[test]
    fn mono_to_stereo_keeps_every_frame_and_doubles_the_samples() {
        // The whole bug in one assertion: the frame count must not change.
        // Handing a mono buffer to a stereo device without this made the
        // engines read it twice as fast and run out half way.
        let mono = vec![0.1, 0.2, 0.3, 0.4];
        let out = conform_channels(&mono, 1, 2);
        assert_eq!(out.len(), 8);
        assert_eq!(out.len() / 2, mono.len(), "frames changed");
        assert_eq!(out, vec![0.1, 0.1, 0.2, 0.2, 0.3, 0.3, 0.4, 0.4]);
    }

    #[test]
    fn stereo_to_mono_mixes_rather_than_dropping_a_side() {
        // Taking the left channel would silently lose half the recording.
        let stereo = vec![1.0, 0.0, 0.0, 1.0, 0.5, 0.5];
        let out = conform_channels(&stereo, 2, 1);
        assert_eq!(out, vec![0.5, 0.5, 0.5]);
    }

    #[test]
    fn widening_past_two_repeats_the_last_channel_rather_than_going_silent() {
        let stereo = vec![0.1, 0.2];
        assert_eq!(conform_channels(&stereo, 2, 4), vec![0.1, 0.2, 0.2, 0.2]);
    }

    #[test]
    fn nothing_and_nonsense_are_not_panics() {
        assert!(conform_channels(&[], 1, 2).is_empty());
        assert_eq!(conform_channels(&[0.5], 0, 2), vec![0.5]);
        assert_eq!(conform_channels(&[0.5], 1, 0), vec![0.5]);
    }
}
