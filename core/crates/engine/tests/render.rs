//! The block renderer must agree with the offline one. If it does not, what you
//! hear while working and what lands in the exported file are different sounds.

use engine::{BlockRenderer, Source};
use fx::grain::{Grain, GrainEvent, StreamParams};

const SR: u32 = 48_000;

fn tone(frames: usize, channels: usize) -> Vec<f32> {
    (0..frames * channels)
        .map(|i| {
            let f = (i / channels) as f32;
            (f * 0.01).sin() * 0.5 + (f * 0.031).sin() * 0.3
        })
        .collect()
}

fn params(in_frames: usize, g: Grain, ratio: f32, semis: f32) -> StreamParams {
    StreamParams {
        in_frames,
        sample_rate: SR,
        ratio,
        semitones: semis,
        window_ms: 40.0,
        grain: g,
        algorithm: fx::stretch::Algorithm::Granular,
        wsola: fx::stretch::WsolaParams::default(),

        vocoder: fx::stretch::VocoderParams::default(),


        pvsola: fx::pvsola::PvsolaParams::default(),



        hybrid: fx::hybrid::HybridParams::default(),



        cloud: false,



        cloud_mix: 0.5,
    }
}

/// Render the whole thing in blocks and hand back one contiguous buffer.
fn render_blocks(src: &Source, sp: &StreamParams, block: usize, out_frames: usize) -> Vec<f32> {
    let mut r = BlockRenderer::new(block);
    let mut out = Vec::with_capacity(out_frames * src.channels);
    let mut buf = vec![0f32; block * src.channels];
    let mut evs = [GrainEvent {
        index: 0,
        out_frame: 0,
        src_frame: 0.0,
        size: 0,
        rate: 1.0,
        pitch_semis: 0.0,
    }; 64];

    while out.len() < out_frames * src.channels {
        r.render(&mut buf, src.channels, src, sp, &mut evs);
        out.extend_from_slice(&buf);
    }
    out.truncate(out_frames * src.channels);
    out
}

#[test]
fn block_rendering_matches_the_offline_renderer() {
    let mut g = Grain::default();
    g.size_jitter = 0.35;
    g.position_jitter_ms = 20.0;
    g.pitch_jitter_semis = 2.0;
    g.seed = 99;

    let in_frames = 24_000;
    let src = Source { samples: tone(in_frames, 1), channels: 1 };
    let sp = params(in_frames, g, 1.5, 1.0);

    let offline = fx::grain::granular(&src.samples, 1, SR, 1.5, 1.0, 40.0, &g);
    let live = render_blocks(&src, &sp, 512, offline.len());

    assert_eq!(live.len(), offline.len());
    let mut worst = 0f32;
    for (i, (a, b)) in live.iter().zip(offline.iter()).enumerate() {
        let d = (a - b).abs();
        if d > worst {
            worst = d;
        }
        assert!(d < 1e-5, "frame {i}: live {a} vs offline {b}");
    }
    println!("worst deviation: {worst:e}");
}

/// The device chooses the block size, and it is not always the same from one
/// callback to the next. The sound must not depend on it.
#[test]
fn the_result_does_not_depend_on_the_block_size() {
    let mut g = Grain::default();
    g.size_jitter = 0.2;
    g.pitch_jitter_semis = 4.0;
    g.seed = 5;

    let in_frames = 12_000;
    let src = Source { samples: tone(in_frames, 2), channels: 2 };
    let sp = params(in_frames, g, 2.0, 0.0);
    let frames = sp.plan().out_frames;

    let a = render_blocks(&src, &sp, 64, frames);
    let b = render_blocks(&src, &sp, 1024, frames);

    for (i, (x, y)) in a.iter().zip(b.iter()).enumerate() {
        assert!((x - y).abs() < 1e-5, "sample {i}: block64 {x} vs block1024 {y}");
    }
}

/// Stereo must not smear across channels.
#[test]
fn channels_stay_separate() {
    let in_frames = 8_000;
    let mut samples = vec![0f32; in_frames * 2];
    for f in 0..in_frames {
        samples[f * 2] = 0.5;      // left constant
        samples[f * 2 + 1] = -0.5; // right constant
    }
    let src = Source { samples, channels: 2 };
    let sp = params(in_frames, Grain::default(), 1.0, 0.0);

    let out = render_blocks(&src, &sp, 256, 4_000);
    for f in 200..3_800 {
        assert!((out[f * 2] - 0.5).abs() < 0.02, "left drifted at {f}: {}", out[f * 2]);
        assert!((out[f * 2 + 1] + 0.5).abs() < 0.02, "right drifted at {f}: {}", out[f * 2 + 1]);
    }
}

/// Nothing the controls can express may produce a NaN, an infinity or a value
/// that would slam a speaker.
#[test]
fn the_output_is_always_finite_and_bounded() {
    for (density, overlap, jitter, semis) in
        [(2000.0, 8.0, 1.0, 24.0), (0.5, 1.0, 0.0, -24.0), (0.0, 8.0, 0.9, 0.0)]
    {
        let mut g = Grain::default();
        g.density_hz = density;
        g.overlap = overlap;
        g.size_jitter = jitter;
        g.pitch_jitter_semis = 12.0;
        g.position_jitter_ms = 400.0;

        let in_frames = 9_000;
        let src = Source { samples: tone(in_frames, 1), channels: 1 };
        let sp = params(in_frames, g, 0.5, semis);

        for v in render_blocks(&src, &sp, 128, 6_000) {
            assert!(v.is_finite(), "non-finite output at density {density}");
            assert!(v.abs() <= 4.0, "runaway output {v} at density {density}");
        }
    }
}

/// The device's channel count is not the file's. Most of this library is mono
/// and every Mac outputs stereo, so this is the common case, not the exotic
/// one — and getting it wrong reads the source off the end of its own buffer.
#[test]
fn a_mono_source_feeds_every_output_channel() {
    let in_frames = 8_000;
    let src = Source { samples: vec![0.5; in_frames], channels: 1 };
    let sp = params(in_frames, Grain::default(), 1.0, 0.0);

    let mut r = BlockRenderer::new(256);
    let mut buf = vec![0f32; 256 * 2]; // stereo device, mono file
    let mut evs = [GrainEvent {
        index: 0, out_frame: 0, src_frame: 0.0, size: 0, rate: 1.0, pitch_semis: 0.0,
    }; 64];

    for _ in 0..20 {
        r.render(&mut buf, 2, &src, &sp, &mut evs);
    }
    for f in 0..256 {
        let (l, r_) = (buf[f * 2], buf[f * 2 + 1]);
        assert!((l - 0.5).abs() < 0.02, "left {l} at {f}");
        assert_eq!(l, r_, "mono must be identical on both sides at {f}");
    }
}

/// And the reverse: a stereo file on a mono output must not read past its own
/// frames either.
#[test]
fn a_stereo_source_on_a_mono_output_stays_in_bounds() {
    let in_frames = 6_000;
    let src = Source { samples: vec![0.25; in_frames * 2], channels: 2 };
    let sp = params(in_frames, Grain::default(), 1.0, 0.0);

    let mut r = BlockRenderer::new(128);
    let mut buf = vec![0f32; 128];
    let mut evs = [GrainEvent {
        index: 0, out_frame: 0, src_frame: 0.0, size: 0, rate: 1.0, pitch_semis: 0.0,
    }; 64];

    for _ in 0..40 {
        r.render(&mut buf, 1, &src, &sp, &mut evs);
        assert!(buf.iter().all(|s| s.is_finite()));
    }
}

/// Layers were the one grain control the block renderer did not have. Offline
/// it ran the schedule several times over, re-seeded and offset; live it ran it
/// once. So the cloud you heard while working was a fraction of the cloud that
/// landed in the file, and turning the control up changed one and not the other.
#[test]
fn layers_sound_the_same_live_as_they_do_offline() {
    let mut g = Grain::default();
    g.layers = 5;
    g.size_jitter = 0.35;
    g.position_jitter_ms = 20.0;
    g.pitch_jitter_semis = 2.0;
    g.seed = 99;

    let in_frames = 24_000;
    let src = Source { samples: tone(in_frames, 1), channels: 1 };
    let sp = params(in_frames, g, 1.5, 1.0);

    let offline = fx::grain::granular(&src.samples, 1, SR, 1.5, 1.0, 40.0, &g);
    let live = render_blocks(&src, &sp, 512, offline.len());

    assert_eq!(live.len(), offline.len());
    for (i, (a, b)) in live.iter().zip(offline.iter()).enumerate() {
        assert!((a - b).abs() < 1e-5, "frame {i}: live {a} vs offline {b}");
    }
}

/// The whole point of the control: more layers is a denser cloud, not the same
/// cloud louder. If the renderer ignored it, these would be identical.
#[test]
fn more_layers_is_audibly_more_grains() {
    let in_frames = 24_000;
    let src = Source { samples: tone(in_frames, 1), channels: 1 };

    let mut one = Grain::default();
    one.size_jitter = 0.3;
    one.position_jitter_ms = 30.0;
    one.seed = 7;
    let mut many = one;
    many.layers = 8;

    let frames = params(in_frames, one, 2.0, 0.0).plan().out_frames;
    let a = render_blocks(&src, &params(in_frames, one, 2.0, 0.0), 256, frames);
    let b = render_blocks(&src, &params(in_frames, many, 2.0, 0.0), 256, frames);

    let diff: f32 = a.iter().zip(b.iter()).map(|(x, y)| (x - y).abs()).sum::<f32>()
        / a.len().max(1) as f32;
    assert!(diff > 1e-3, "eight layers sounded the same as one: {diff}");
}

/// A layer spread of zero stacks every layer on the same instants. That is a
/// real setting and it must not be mistaken for the layers doing nothing.
#[test]
fn stacked_layers_still_run_every_schedule() {
    let in_frames = 12_000;
    let src = Source { samples: tone(in_frames, 1), channels: 1 };

    let mut g = Grain::default();
    g.layers = 4;
    g.layer_spread = 0.0;
    g.size_jitter = 0.3;
    g.seed = 3;
    let sp = params(in_frames, g, 1.5, 0.0);

    let offline = fx::grain::granular(&src.samples, 1, SR, 1.5, 0.0, 40.0, &g);
    let live = render_blocks(&src, &sp, 128, offline.len());
    for (i, (a, b)) in live.iter().zip(offline.iter()).enumerate() {
        assert!((a - b).abs() < 1e-5, "frame {i}: live {a} vs offline {b}");
    }
}

/// Moving a shaping control must not reach into grains already sounding.
///
/// A grain runs for tens of milliseconds. Envelope skew, direction and stereo
/// spread used to be read from the live parameters on every block, so a grain
/// half way through its window would have its shape rewritten under it — a step
/// in the middle of a fade, which is a click. Each of these three is checked
/// separately because they break the waveform in different places.
///
/// Measured as the worst second difference across the block where the control
/// moved, against the same measure on a block where nothing moved. Neutered —
/// reading `sp.grain` again instead of the voice's copy — pan spread alone puts
/// a corner of 0.361 in against a steady 0.00033, which is a thousandfold and
/// is exactly the click that was being heard.
#[test]
fn a_control_moved_mid_flight_does_not_reach_into_sounding_grains() {
    let channels = 2;
    let src = Source { samples: tone(SR as usize, channels), channels };
    let block = 256;

    let corner = |v: &[f32], channels: usize| -> f32 {
        let mono: Vec<f32> = v.chunks(channels).map(|f| f[0]).collect();
        mono.windows(3)
            .map(|w| (w[2] - 2.0 * w[1] + w[0]).abs())
            .fold(0f32, f32::max)
    };

    // Forty-millisecond grains at thirty a second, against a block of five and
    // a bit: a block boundary is almost certainly in the middle of several of
    // them rather than neatly between two.
    let base = Grain { density_hz: 30.0, pan_spread: 0.0, ..Grain::default() };

    let panning = Grain { pan_spread: 1.0, ..base };
    for (what, from, moved) in [
        ("pan spread", base, Grain { pan_spread: 1.0, ..base }),
        ("envelope", base, Grain { envelope: 0.05, ..base }),
        ("direction", base, Grain { reverse: true, ..base }),
        // Re-seeding deals a new cloud. It must deal the grains still to come,
        // so this one starts already panning — otherwise it is the spread
        // being tested a second time rather than the seed.
        ("seed", panning, Grain { seed: 12_345, ..panning }),
    ] {
        let steady = params(src.frames(), from, 4.0, 0.0);
        let after = params(src.frames(), moved, 4.0, 0.0);

        let mut r = BlockRenderer::new(block);
        let mut buf = vec![0f32; block * channels];
        let mut evs = [GrainEvent {
            index: 0, out_frame: 0, src_frame: 0.0, size: 0, rate: 1.0, pitch_semis: 0.0,
        }; 64];

        // Settle, so grains are genuinely in the air at the boundary.
        for _ in 0..8 {
            r.render(&mut buf, channels, &src, &steady, &mut evs);
        }
        let mut held = Vec::new();
        r.render(&mut buf, channels, &src, &steady, &mut evs);
        held.extend_from_slice(&buf);
        let quiet = corner(&held, channels);

        // Two frames of the settled block, then the block where it moved.
        let mut joined = held[held.len() - 2 * channels..].to_vec();
        r.render(&mut buf, channels, &src, &after, &mut evs);
        joined.extend_from_slice(&buf);
        let jolt = corner(&joined, channels);

        assert!(
            jolt < quiet * 4.0,
            "{what} put a corner of {jolt:.5} in against a steady {quiet:.5}"
        );
    }
}
