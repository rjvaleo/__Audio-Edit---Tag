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
    let live = [Algorithm::Granular, Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Pvsola];
    // The hybrid is left out here only because it needs a separated source,
    // which the helper above does not have; it has a test of its own.
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

    for alg in [Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Pvsola] {
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

/// Every engine streams now — and the hybrid has a state the others do not:
/// its source has to be separated first, off the audio thread, and until that
/// arrives it has nothing to play. It covers the gap with the grain cloud
/// rather than with silence.
#[test]
fn the_hybrid_plays_the_grain_cloud_until_its_source_has_been_separated() {
    let channels = 2;
    let src = Source { samples: busy(SR as usize / 4, channels), channels };
    let n = src.frames();
    let sp = params(n, Algorithm::Hybrid, 2.0, 0.0);

    for alg in [
        Algorithm::Granular,
        Algorithm::Wsola,
        Algorithm::Vocoder,
        Algorithm::Pvsola,
        Algorithm::Hybrid,
    ] {
        assert!(engine::stretcher::is_live(alg), "{alg:?} should stream");
    }

    // Nothing separated yet.
    let bare = run(&src, &sp, 512, n);
    assert!(rms(&bare) > 1e-3, "the hybrid fell silent with no separated source");

    // And with it, which must be a different sound — otherwise the fallback
    // never stopped.
    let parts = fx::hstream::Parts::separate(&src.samples, channels, sp.hybrid);
    let mut s = Stretcher::new(512, channels, SR);
    s.set_map(None);
    s.set_parts(std::sync::Arc::new(parts));
    s.seek(0, &sp);
    let mut out: Vec<f32> = Vec::new();
    let mut buf = vec![0f32; 512 * channels];
    let mut evs = no_events();
    while out.len() / channels < n {
        s.render(&mut buf, channels, &src, &sp, &mut evs);
        out.extend_from_slice(&buf);
    }
    out.truncate(n * channels);
    assert!(rms(&out) > 1e-3, "the hybrid produced nothing once separated");
    let d: f32 =
        bare.iter().zip(&out).map(|(a, b)| (a - b).abs()).sum::<f32>() / bare.len() as f32;
    assert!(d > 1e-4, "the hybrid played the same thing separated as unseparated");
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

/// Switching engines must not click, and must not dip.
///
/// A click is a step: the new engine starts cold at the playhead and its first
/// sample has nothing to do with the last one the old engine produced. Measured
/// without the crossfade, the switch put a step of 0.62 into a waveform whose
/// neighbouring samples differ by 0.0003 — two thousand times the local motion,
/// which is a loud tick. It also dropped the level to 0.21 from 0.34, because
/// the incoming engine's overlap-add starts empty and ramps.
///
/// Both are measured here against the material's own behaviour either side,
/// rather than against a number picked out of the air.
#[test]
fn switching_engines_does_not_click_or_dip() {
    let channels = 2;
    let src = Source { samples: busy(SR as usize / 2, channels), channels };
    let n = src.frames();
    let block = 256;
    let switch_at = 20;

    for to in [Algorithm::Vocoder, Algorithm::Granular, Algorithm::Pvsola] {
        let mut s = Stretcher::new(block, channels, SR);
        s.set_map(None);
        let mut sp = params(n, Algorithm::Wsola, 4.0, 0.0);
        s.seek(0, &sp);

        let mut buf = vec![0f32; block * channels];
        let mut evs = no_events();
        let mut out: Vec<f32> = Vec::new();
        for i in 0..40 {
            sp.algorithm = if i < switch_at { Algorithm::Wsola } else { to };
            s.render(&mut buf, channels, &src, &sp, &mut evs);
            out.extend_from_slice(&buf);
        }

        let at = switch_at * block;
        let step = |f: usize| {
            (0..channels)
                .map(|c| (out[f * channels + c] - out[(f - 1) * channels + c]).abs())
                .fold(0f32, f32::max)
        };
        let mut nearby: Vec<f32> = (at - 200..at + 200).map(step).collect();
        nearby.sort_by(f32::total_cmp);
        let median = nearby[nearby.len() / 2].max(1e-6);

        assert!(
            step(at) < median * 20.0,
            "switching to {to:?}: a step of {:.5} where neighbouring samples move {median:.5}",
            step(at)
        );

        let rms_of = |a: usize, b: usize| -> f32 {
            let mut acc = 0f32;
            for f in a..b {
                for c in 0..channels {
                    let v = out[f * channels + c];
                    acc += v * v;
                }
            }
            (acc / ((b - a) * channels) as f32).sqrt()
        };
        let before = rms_of(at - 1000, at);
        let across = rms_of(at, at + 1024);
        assert!(
            across > before * 0.7,
            "switching to {to:?}: the level dipped to {across:.4} from {before:.4}"
        );
    }
}

/// Layers reach the callback now, and live matches export at every count.
///
/// This test replaces one that asserted the opposite. The offline renderer used
/// to wrap every engine but the grain cloud in `stretch::layered` while the
/// callback did not layer at all, so at more than one layer the file and the
/// transport were different sounds — true for three commits and caught by
/// nothing, because every other test uses the default of one layer.
///
/// Two things had to change together. The offline path measured one layer's RMS
/// and scaled the sum back to it, which is exact and impossible in a callback;
/// both now apply the same blind square root. And the callback needs one engine
/// instance per layer, which it cannot allocate, so they are built off the
/// audio thread and handed over like the transient map.
#[test]
fn layers_sound_the_same_live_as_they_do_offline() {
    let channels = 2;
    let src = Source { samples: busy(SR as usize / 2, channels), channels };
    let n = src.frames();
    let ratio = 2.0f32;
    let want = ((n as f32) * ratio) as usize;
    let block = 512;

    for alg in [Algorithm::Wsola, Algorithm::Vocoder] {
        let mut sp = params(n, alg, ratio, 0.0);
        sp.grain.layers = 4;
        sp.grain.layer_scatter = 0.6;

        let mut s = Stretcher::new(block, channels, SR);
        s.set_map(None);
        s.set_bank(engine::stretcher::LayerBank::build(alg, 4, block, channels, SR));
        s.seek(0, &sp);
        assert_eq!(s.live_layers(&sp), 4, "{alg:?}: the bank did not take");

        let mut out: Vec<f32> = Vec::new();
        let mut buf = vec![0f32; block * channels];
        let mut evs = no_events();
        while out.len() / channels < want {
            s.render(&mut buf, channels, &src, &sp, &mut evs);
            out.extend_from_slice(&buf);
        }
        out.truncate(want * channels);

        let offline =
            fx::Stretch { ratio, algorithm: alg, grain: sp.grain, ..Default::default() }
                .process(&src.samples, channels, SR);

        // Not bit for bit: each layer is offset within the hop, and offline can
        // start a layer before the file begins where live can only clamp to
        // zero. Everything past that first offset agrees.
        let skip = 4096;
        let worst = out[skip * channels..]
            .iter()
            .zip(&offline[skip * channels..])
            .map(|(a, b)| (a - b).abs())
            .fold(0f32, f32::max);
        assert!(
            worst < 1e-4,
            "{alg:?}: live and export differ by {worst:.2e} at four layers"
        );
    }
}

/// Until a bank arrives the callback plays what it has, which is thinner than
/// asked for and never silent.
#[test]
fn layers_fall_back_to_one_until_the_bank_is_built() {
    let channels = 2;
    let src = Source { samples: busy(SR as usize / 4, channels), channels };
    let n = src.frames();
    let mut sp = params(n, Algorithm::Vocoder, 2.0, 0.0);
    sp.grain.layers = 8;

    let mut s = Stretcher::new(512, channels, SR);
    s.set_map(None);
    s.seek(0, &sp);
    assert_eq!(s.live_layers(&sp), 1, "layers sounded before the bank existed");

    let mut buf = vec![0f32; 512 * channels];
    let mut evs = no_events();
    for _ in 0..8 {
        s.render(&mut buf, channels, &src, &sp, &mut evs);
    }
    assert!(rms(&buf) > 1e-3, "the engine fell silent waiting for its layers");

    s.set_bank(engine::stretcher::LayerBank::build(
        Algorithm::Vocoder,
        8,
        512,
        channels,
        SR,
    ));
    assert_eq!(s.live_layers(&sp), 8, "the bank did not take");
}

/// Every engine has to respect the pitch slider, not just the two that were
/// wrapped for it.
///
/// PVSOLA and the hybrid were built out of the other engines and never got the
/// pitch stage the others have, so the control moved the exported file and did
/// nothing at all to what came out of the callback. The two tests that should
/// have caught it did not: the pitch test only ran WSOLA, and the
/// live-equals-export test ran at zero semitones.
#[test]
fn every_live_engine_respects_the_pitch_slider() {
    let channels = 1;
    let samples: Vec<f32> = (0..SR as usize)
        .map(|i| 0.5 * (std::f32::consts::TAU * 440.0 * i as f32 / SR as f32).sin())
        .collect();
    let src = Source { samples, channels };
    let n = src.frames();

    for alg in [Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Pvsola] {
        let up = run(&src, &params(n, alg, 1.0, 12.0), 512, n);
        let f = dominant(&up[n / 3..n / 3 + 16384]);
        assert!(
            (f - 880.0).abs() < 40.0,
            "{alg:?}: an octave up landed at {f:.0} Hz, not 880"
        );
    }
}

#[test]
fn the_hybrid_respects_the_pitch_slider() {
    let channels = 1;
    let samples: Vec<f32> = (0..SR as usize)
        .map(|i| 0.5 * (std::f32::consts::TAU * 440.0 * i as f32 / SR as f32).sin())
        .collect();
    let src = Source { samples, channels };
    let n = src.frames();
    let sp = params(n, Algorithm::Hybrid, 1.0, 12.0);

    let parts = fx::hstream::Parts::separate(&src.samples, channels, sp.hybrid);
    let mut s = Stretcher::new(512, channels, SR);
    s.set_map(None);
    s.set_parts(std::sync::Arc::new(parts));
    s.seek(0, &sp);
    let mut out: Vec<f32> = Vec::new();
    let mut buf = vec![0f32; 512 * channels];
    let mut evs = no_events();
    while out.len() / channels < n {
        s.render(&mut buf, channels, &src, &sp, &mut evs);
        out.extend_from_slice(&buf);
    }
    let f = dominant(&out[n / 3..n / 3 + 16384]);
    assert!(
        (f - 880.0).abs() < 40.0,
        "the hybrid put an octave up at {f:.0} Hz, not 880"
    );
}

/// And the same audio either way, with the pitch control off its default.
///
/// The existing version of this ran at zero semitones, which is the one
/// setting that cannot tell a missing pitch stage from a working one.
#[test]
fn what_the_callback_plays_is_what_the_file_would_hold_when_pitched() {
    let channels = 2;
    let src = Source { samples: busy(SR as usize / 2, channels), channels };
    let n = src.frames();
    let (ratio, semis) = (2.0f32, 7.0f32);
    let want = ((n as f32) * ratio) as usize;

    for alg in [Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Pvsola] {
        let live = run(&src, &params(n, alg, ratio, semis), 512, want);
        let offline = fx::Stretch { ratio, semitones: semis, algorithm: alg, ..Default::default() }
            .process(&src.samples, channels, SR);

        // Every frame but the last one, exactly.
        //
        // The interpolator reaches two frames forward. At the final output
        // frame the offline render has run out of stretched audio and clamps
        // to its last sample; the stream has no end to run out of and reads
        // the real thing. That is a property of a finite buffer meeting an
        // endless one, not of the two disagreeing — so it is excluded here and
        // bounded below rather than quietly folded into the tolerance.
        let last = (want - 1) * channels;
        let worst = live[..last]
            .iter()
            .zip(&offline[..last])
            .map(|(a, b)| (a - b).abs())
            .fold(0f32, f32::max);
        assert!(worst < 1e-6, "{alg:?}: live and export differ by {worst:.2e} when pitched");

        let edge = live[last..]
            .iter()
            .zip(&offline[last..])
            .map(|(a, b)| (a - b).abs())
            .fold(0f32, f32::max);
        assert!(edge < 0.01, "{alg:?}: the final frame is not just an edge, it is {edge:.2e}");
    }
}
