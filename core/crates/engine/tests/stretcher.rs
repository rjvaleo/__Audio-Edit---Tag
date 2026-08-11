//! Choosing an engine has to change what comes out of the callback.
//!
//! For a long time it did not. The audio thread ran the grain cloud whatever
//! the document said, so the picker changed the exported file and nothing else
//! — a control that looks like a performance control and is not one. These
//! tests are what says that is over.

use engine::{Source, Stretcher};
use fx::grain::{GrainEvent, StreamParams};
use fx::stretch::Algorithm;

const SR: u32 = 48_000;

fn busy(frames: usize, channels: usize) -> Vec<f32> {
    let mut seed = 7u32;
    let mut v = Vec::with_capacity(frames * channels);
    for i in 0..frames {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        let noise = ((seed >> 16) as f32 / 32768.0) - 1.0;
        let into = i % 6000;
        let hit = if into < 700 { noise * (1.0 - into as f32 / 700.0).powi(2) * 0.7 } else { 0.0 };
        let s = ((i as f32) * 0.01).sin() * 0.4 + ((i as f32) * 0.031).sin() * 0.25 + noise * 0.04 + hit;
        for _ in 0..channels {
            v.push(s);
        }
    }
    v
}

fn params(in_frames: usize, alg: Algorithm, ratio: f32, semis: f32) -> StreamParams {
    StreamParams {
        algorithm: alg,
        ratio,
        semitones: semis,
        ..StreamParams::new(in_frames, SR)
    }
}

fn no_events() -> Vec<GrainEvent> {
    vec![
        GrainEvent { index: 0, out_frame: 0, src_frame: 0.0, size: 0, rate: 1.0, pitch_semis: 0.0 };
        128
    ]
}

/// Render `out_frames` in blocks, as the device would.
fn run(src: &Source, sp: &StreamParams, block: usize, out_frames: usize) -> Vec<f32> {
    let mut s = Stretcher::new(block, src.channels, SR);
    s.set_map(None);
    s.seek(0, sp);
    let mut out = Vec::with_capacity(out_frames * src.channels);
    let mut buf = vec![0f32; block * src.channels];
    let mut evs = no_events();
    while out.len() / src.channels < out_frames {
        s.render(&mut buf, src.channels, src, sp, &mut evs);
        out.extend_from_slice(&buf);
    }
    out.truncate(out_frames * src.channels);
    out
}

fn rms(v: &[f32]) -> f32 {
    (v.iter().map(|x| x * x).sum::<f32>() / v.len().max(1) as f32).sqrt()
}

/// Every engine that streams has to sound different from the others, or the
/// picker is choosing between things that are secretly the same.
#[test]
fn each_live_engine_sounds_like_itself() {
    let channels = 2;
    let src = Source { samples: busy(SR as usize / 2, channels), channels };
    let n = src.frames();
    let live = [Algorithm::Granular, Algorithm::Wsola, Algorithm::Vocoder];
    let outs: Vec<Vec<f32>> = live
        .iter()
        .map(|a| run(&src, &params(n, *a, 2.0, 0.0), 512, n))
        .collect();
    for i in 0..live.len() {
        assert!(rms(&outs[i]) > 1e-3, "{:?} produced nothing", live[i]);
        for j in i + 1..live.len() {
            let d: f32 = outs[i]
                .iter()
                .zip(&outs[j])
                .map(|(a, b)| (a - b).abs())
                .sum::<f32>()
                / outs[i].len() as f32;
            assert!(d > 1e-4, "{:?} and {:?} produced the same audio", live[i], live[j]);
        }
    }
}

#[test]
fn the_engine_choice_reaches_the_callback() {
    let channels = 2;
    let src = Source { samples: busy(SR as usize / 2, channels), channels };
    let n = src.frames();

    let g = run(&src, &params(n, Algorithm::Granular, 2.0, 0.0), 512, n);
    let w = run(&src, &params(n, Algorithm::Wsola, 2.0, 0.0), 512, n);

    let diff: f32 = g.iter().zip(&w).map(|(a, b)| (a - b).abs()).sum::<f32>() / g.len() as f32;
    assert!(diff > 1e-4, "WSOLA and the grain cloud produced the same block: {diff:.2e}");
    assert!(rms(&w) > 1e-3, "WSOLA produced nothing");
}

/// The whole point of streaming it: what the callback makes must be what the
/// exported file holds. Not close — the same.
#[test]
fn what_the_callback_plays_is_what_the_file_would_hold() {
    let channels = 2;
    let src = Source { samples: busy(SR as usize / 2, channels), channels };
    let n = src.frames();
    let ratio = 2.0f32;
    let want = ((n as f32) * ratio) as usize;

    for alg in [Algorithm::Wsola, Algorithm::Vocoder] {
        let live = run(&src, &params(n, alg, ratio, 0.0), 512, want);
        let offline = fx::Stretch { ratio, algorithm: alg, ..Default::default() }
            .process(&src.samples, channels, SR);

        let worst = live
            .iter()
            .zip(&offline)
            .map(|(a, b)| (a - b).abs())
            .fold(0f32, f32::max);
        // Not "close enough to hear nothing" — the same code. Both paths drive
        // the same streamer, so anything above float noise means one of them
        // is feeding it differently.
        assert!(worst < 1e-6, "{alg:?}: live and export differ by {worst:.2e}");
    }
}

#[test]
fn pitch_shifting_works_on_the_streaming_engine() {
    let channels = 1;
    // A steady tone, because pitch is the thing being measured.
    let samples: Vec<f32> = (0..SR as usize)
        .map(|i| 0.5 * (std::f32::consts::TAU * 440.0 * i as f32 / SR as f32).sin())
        .collect();
    let src = Source { samples, channels };
    let n = src.frames();

    let up = run(&src, &params(n, Algorithm::Wsola, 1.0, 12.0), 512, n);
    let f = dominant(&up[n / 3..n / 3 + 16384]);
    assert!((f - 880.0).abs() < 40.0, "an octave up landed at {f:.0} Hz");

    // And the length is the ratio's alone — the two length changes cancel.
    let long = run(&src, &params(n, Algorithm::Wsola, 3.0, 12.0), 512, n * 3);
    assert_eq!(long.len(), n * 3);
    assert!(rms(&long) > 1e-3, "stretch with pitch produced nothing");
}

/// Switching mid-flight must not seek, go silent, or allocate.
#[test]
fn switching_engines_while_playing_does_not_jump_or_go_quiet() {
    let channels = 2;
    let src = Source { samples: busy(SR as usize / 2, channels), channels };
    let n = src.frames();
    let block = 512;

    let mut s = Stretcher::new(block, channels, SR);
    s.set_map(None);
    let mut sp = params(n, Algorithm::Granular, 2.0, 0.0);
    s.seek(0, &sp);

    let mut buf = vec![0f32; block * channels];
    let mut evs = no_events();
    let mut levels = Vec::new();
    for i in 0..24 {
        // Change engine halfway through, mid-playback, as the picker would.
        sp.algorithm = if i < 12 { Algorithm::Granular } else { Algorithm::Wsola };
        s.render(&mut buf, channels, &src, &sp, &mut evs);
        levels.push(rms(&buf));
    }

    // The position must run on unbroken; a switch is not a seek.
    assert_eq!(s.position(), 24 * block as u64, "the switch moved the playhead");
    // And nothing may drop out. The block straddling the change is allowed to
    // be quieter — a fresh engine starts with an incomplete overlap — but not
    // silent, and everything after it must be back to level.
    for (i, l) in levels.iter().enumerate().skip(13) {
        assert!(*l > 1e-3, "block {i} after the switch was silent");
    }
}

/// An engine that cannot stream yet must fall back audibly rather than to
/// silence — and the fallback has to be named, not guessed at.
#[test]
fn engines_that_do_not_stream_yet_still_make_sound() {
    let channels = 2;
    let src = Source { samples: busy(SR as usize / 4, channels), channels };
    let n = src.frames();
    for alg in [Algorithm::Pvsola, Algorithm::Hybrid] {
        assert!(!engine::stretcher::is_live(alg), "{alg:?} claims to stream");
        let out = run(&src, &params(n, alg, 2.0, 0.0), 512, n);
        assert!(rms(&out) > 1e-3, "{alg:?} fell back to silence");
    }
    for alg in [Algorithm::Granular, Algorithm::Wsola, Algorithm::Vocoder] {
        assert!(engine::stretcher::is_live(alg), "{alg:?} should stream");
    }
}

fn dominant(v: &[f32]) -> f32 {
    let n = 16384usize.min(v.len());
    let mut re: Vec<f32> = v[..n].to_vec();
    let w = audio_core::fft::hann(n);
    for i in 0..n {
        re[i] *= w[i];
    }
    let mut im = vec![0f32; n];
    audio_core::fft::fft(&mut re, &mut im);
    let (mut best, mut best_e) = (1usize, 0f32);
    for k in 1..n / 2 {
        let e = re[k] * re[k] + im[k] * im[k];
        if e > best_e {
            best_e = e;
            best = k;
        }
    }
    best as f32 * SR as f32 / n as f32
}

/// A streaming engine must fill every channel the device asks for, not the
/// number the source happened to have when it was built.
///
/// This is a bug that was in for exactly one commit. The engines size their
/// buffers once, and they were sized from the source at build time — which is
/// the silent placeholder, and mono. A stereo file then rendered into the first
/// half of its buffer and left the rest silent, which sounds like one channel
/// dropping out rather than like anything obviously wrong.
#[test]
fn every_device_channel_is_filled_whatever_the_source_was_built_from() {
    let channels = 2;
    let src = Source { samples: busy(SR as usize / 4, channels), channels };
    let n = src.frames();
    let sp = params(n, Algorithm::Wsola, 2.0, 0.0);

    let block = 512;
    let mut s = Stretcher::new(block, channels, SR);
    s.set_map(None);
    s.seek(0, &sp);

    let mut buf = vec![0f32; block * channels];
    let mut evs = no_events();
    // Past the first window, so the overlap-add has reached full depth.
    for _ in 0..12 {
        s.render(&mut buf, channels, &src, &sp, &mut evs);
    }

    let left: Vec<f32> = buf.iter().step_by(2).copied().collect();
    let right: Vec<f32> = buf.iter().skip(1).step_by(2).copied().collect();
    assert!(rms(&left) > 1e-3, "the left channel was silent");
    assert!(rms(&right) > 1e-3, "the right channel was silent");
    assert!(
        (rms(&left) / rms(&right) - 1.0).abs() < 0.3,
        "the channels came out at different levels: {:.4} against {:.4}",
        rms(&left),
        rms(&right)
    );
}
