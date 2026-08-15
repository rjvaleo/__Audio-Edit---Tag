//! Grains reading the machine's own output instead of the file.
//!
//! The read side of the sixth engine. The load-bearing test is the first one:
//! at the default mix nothing may change, byte for byte, or every document ever
//! saved renders differently than it did.

use engine::{BlockRenderer, OutputRing, Source};
use fx::grain::{Grain, GrainEvent, StreamParams};

const SR: u32 = 48_000;
const BLOCK: usize = 512;

/// The sixth engine. Only this one reads the ring — see the gate test at the
/// bottom — so every test here has to ask for it by name.
fn params(in_frames: usize, g: Grain) -> StreamParams {
    StreamParams {
        grain: g,
        algorithm: fx::stretch::Algorithm::Feedback,
        ..StreamParams::new(in_frames, SR)
    }
}

/// The same document on the engine the sixth grew from.
fn as_granular(in_frames: usize, g: Grain) -> StreamParams {
    StreamParams { algorithm: fx::stretch::Algorithm::Granular, ..params(in_frames, g) }
}

/// A cloud dense enough that every output frame is covered by grains.
fn cloud(ring_mix: f32, ring_reach_ms: f32) -> Grain {
    Grain {
        density_hz: 200.0,
        pan_spread: 0.0,
        ring_mix,
        ring_reach_ms,
        ..Grain::default()
    }
}

fn flat(frames: usize, channels: usize, v: f32) -> Source {
    Source { samples: vec![v; frames * channels], channels }
}

/// Material that actually varies frame to frame. A constant source cannot tell
/// a correct read offset from a wrong one — every read returns the same number —
/// so anything testing *where* in the ring a grain lands needs this.
fn tone(frames: usize, channels: usize) -> Source {
    let samples = (0..frames * channels)
        .map(|i| {
            let f = (i / channels) as f32;
            (f * 0.07).sin() * 0.4 + (f * 0.31).sin() * 0.2
        })
        .collect();
    Source { samples, channels }
}

/// Render `blocks` blocks and hand back everything produced.
fn render(
    src: &Source,
    sp: &StreamParams,
    ring: Option<&OutputRing>,
    channels: usize,
    blocks: usize,
) -> Vec<f32> {
    let mut r = BlockRenderer::new(BLOCK);
    let mut buf = vec![0.0; BLOCK * channels];
    let mut evs = vec![
        GrainEvent {
            index: 0,
            out_frame: 0,
            src_frame: 0.0,
            size: 0,
            rate: 1.0,
            pitch_semis: 0.0,
        };
        512
    ];
    let mut all = Vec::new();
    for _ in 0..blocks {
        buf.iter_mut().for_each(|s| *s = 0.0);
        r.render_with(&mut buf, channels, src, sp, &mut evs, ring);
        all.extend_from_slice(&buf);
    }
    all
}

fn full_ring(v: f32, channels: usize) -> OutputRing {
    let mut ring = OutputRing::new(SR as usize * 2, channels);
    ring.write(&vec![v; SR as usize * channels], channels);
    ring
}

/// Invariant 9. A document that never touches the control must render exactly
/// what it rendered before the control existed — so the ring being present, and
/// full of something loud, must make no difference at all while the mix is zero.
///
/// Byte for byte rather than within a tolerance: the branch is meant to be
/// skipped entirely, not multiplied by zero.
#[test]
fn at_the_default_mix_the_ring_changes_nothing() {
    let src = flat(SR as usize, 1, 0.25);
    let sp = params(SR as usize, cloud(0.0, 250.0));
    let ring = full_ring(0.9, 1);

    let without = render(&src, &sp, None, 1, 4);
    let with = render(&src, &sp, Some(&ring), 1, 4);

    assert_eq!(without, with, "a ring changed the sound at mix zero");
}

/// A reach set but no mix is still an untouched document — which is why reach
/// is deliberately absent from `Grain::is_clean`.
#[test]
fn a_reach_with_no_mix_changes_nothing_either() {
    let src = flat(SR as usize, 1, 0.25);
    let ring = full_ring(0.9, 1);

    let plain = render(&src, &params(SR as usize, cloud(0.0, 250.0)), Some(&ring), 1, 4);
    let reached = render(&src, &params(SR as usize, cloud(0.0, 2000.0)), Some(&ring), 1, 4);

    assert_eq!(plain, reached);
}

/// The read path end to end, without having to reason about envelopes.
///
/// Every source read returns 1.0, and every ring read returns 1.0, so the two
/// renders must agree frame for frame however the grains are shaped, windowed,
/// panned or normalised. If the ring plumbing is wrong this is silence or noise
/// instead.
#[test]
fn a_full_mix_reads_the_ring_the_way_a_grain_reads_a_file() {
    let channels = 1;
    let from_file = render(
        &flat(SR as usize, channels, 1.0),
        &params(SR as usize, cloud(0.0, 100.0)),
        None,
        channels,
        4,
    );
    let from_ring = render(
        &flat(SR as usize, channels, 0.0),
        &params(SR as usize, cloud(1.0, 100.0)),
        Some(&full_ring(1.0, channels)),
        channels,
        4,
    );

    assert!(from_file.iter().any(|s| *s != 0.0), "the file render was silent");
    for (i, (a, b)) in from_file.iter().zip(from_ring.iter()).enumerate() {
        assert!((a - b).abs() < 1e-6, "frame {i}: file {a}, ring {b}");
    }
}

/// Halfway is halfway. Source at zero, ring at one, so the output must land on
/// half of what the same cloud makes from a source of one.
#[test]
fn a_half_mix_lands_between_the_two() {
    let channels = 1;
    let all_file = render(
        &flat(SR as usize, channels, 1.0),
        &params(SR as usize, cloud(0.0, 100.0)),
        None,
        channels,
        4,
    );
    let half = render(
        &flat(SR as usize, channels, 0.0),
        &params(SR as usize, cloud(0.5, 100.0)),
        Some(&full_ring(1.0, channels)),
        channels,
        4,
    );

    for (i, (a, b)) in all_file.iter().zip(half.iter()).enumerate() {
        assert!((a * 0.5 - b).abs() < 1e-6, "frame {i}: expected {}, got {b}", a * 0.5);
    }
}

/// Reach selects *when*, not just *whether*.
///
/// The ring holds one second of silence with a loud stretch only in its oldest
/// quarter. A grain reaching back that far finds it; a grain reaching a little
/// way back finds the silence. If `back` were computed with the wrong sign or
/// scale, both of these would read the same thing.
#[test]
fn reach_chooses_which_part_of_the_ring_is_heard() {
    let channels = 1;
    let mut ring = OutputRing::new(SR as usize * 2, channels);
    // 800 ms of loud, then 200 ms of silence: the loud part is between 200 ms
    // and 1000 ms behind the newest frame.
    ring.write(&vec![1.0; (SR as f32 * 0.8) as usize], channels);
    ring.write(&vec![0.0; (SR as f32 * 0.2) as usize], channels);

    let src = flat(SR as usize, channels, 0.0);
    let near = render(&src, &params(SR as usize, cloud(1.0, 20.0)), Some(&ring), channels, 1);
    let far = render(&src, &params(SR as usize, cloud(1.0, 600.0)), Some(&ring), channels, 1);

    let loudest = |v: &[f32]| v.iter().fold(0.0f32, |m, s| m.max(s.abs()));
    assert!(loudest(&near) < 1e-6, "a short reach found audio in the silent part");
    assert!(loudest(&far) > 0.1, "a long reach did not find the loud part");
}

/// Nothing has been written yet, so there is nothing to read. A feedback path
/// that starts by reading uninitialised memory does not make one glitch, it
/// makes a glitch that then feeds itself.
#[test]
fn a_full_mix_against_an_empty_ring_is_silence_not_noise() {
    let channels = 1;
    let out = render(
        &flat(SR as usize, channels, 0.0),
        &params(SR as usize, cloud(1.0, 250.0)),
        Some(&OutputRing::new(SR as usize, channels)),
        channels,
        4,
    );
    assert!(out.iter().all(|s| *s == 0.0), "an empty ring produced sound");
}

/// The ring is as wide as the device; the file may not be. A mono file into a
/// stereo render must not make the ring read fall off its own stride.
#[test]
fn a_stereo_render_reads_both_sides_of_the_ring() {
    let channels = 2;
    let mut ring = OutputRing::new(SR as usize, channels);
    // Left loud, right silent — so a read that ignored the channel would show.
    let block: Vec<f32> = (0..SR as usize).flat_map(|_| [1.0f32, 0.0]).collect();
    ring.write(&block, channels);

    let out = render(
        &flat(SR as usize, 1, 0.0),
        &params(SR as usize, cloud(1.0, 100.0)),
        Some(&ring),
        channels,
        2,
    );

    let left = out.iter().step_by(2).fold(0.0f32, |m, s| m.max(s.abs()));
    let right = out.iter().skip(1).step_by(2).fold(0.0f32, |m, s| m.max(s.abs()));
    assert!(left > 0.1, "the left side of the ring was not read");
    assert!(right < 1e-6, "the right side was silent in the ring but not in the output");
}

/// Render with the ring advancing exactly as the transport advances it: each
/// block joins the ring once it has been produced.
fn render_feeding_back(
    src: &Source,
    sp: &StreamParams,
    channels: usize,
    block: usize,
    blocks: usize,
) -> Vec<f32> {
    let mut r = BlockRenderer::new(block);
    let mut ring = OutputRing::new(SR as usize * 2, channels);
    let mut buf = vec![0.0; block * channels];
    let mut evs = vec![
        GrainEvent {
            index: 0,
            out_frame: 0,
            src_frame: 0.0,
            size: 0,
            rate: 1.0,
            pitch_semis: 0.0,
        };
        512
    ];
    let mut all = Vec::new();
    for _ in 0..blocks {
        buf.iter_mut().for_each(|s| *s = 0.0);
        r.render_with(&mut buf, channels, src, sp, &mut evs, Some(&ring));
        ring.write(&buf, channels);
        all.extend_from_slice(&buf);
    }
    all
}

/// The sound must not depend on how the audio is cut into blocks.
///
/// `back` turns "how far behind the moment this grain is reading" into "how far
/// behind the ring's newest frame", and the whole difference between those two
/// is where in the current block the frame sits. Get that term wrong and the
/// instrument changes with the device's buffer size — a 512-frame buffer and a
/// 128-frame buffer would be different sounds.
///
/// This is invariant 6 wearing another hat, and it is here rather than as a
/// comment claiming the arithmetic is right because a comment cannot fail.
#[test]
fn the_ring_read_does_not_depend_on_the_block_size() {
    let channels = 1;
    // A tone, not a constant: with flat material every read offset returns the
    // same value and this test cannot fail however wrong the arithmetic is.
    let src = tone(SR as usize, channels);
    // Reach must be well inside what the ring actually accumulates over the
    // run, or every read falls out of range, the ring contributes nothing and
    // this test passes no matter how wrong the arithmetic is. 20 ms is 960
    // frames; the run below produces 8192.
    let sp = params(SR as usize, cloud(0.6, 20.0));

    // Same span of audio, cut four different ways.
    let a = render_feeding_back(&src, &sp, channels, 512, 16);
    let b = render_feeding_back(&src, &sp, channels, 256, 32);
    let c = render_feeding_back(&src, &sp, channels, 128, 64);
    let d = render_feeding_back(&src, &sp, channels, 64, 128);

    assert!(a.iter().any(|s| s.abs() > 1e-3), "the render was silent");
    for (name, other) in [("256", &b), ("128", &c), ("64", &d)] {
        assert_eq!(a.len(), other.len());
        for (i, (x, y)) in a.iter().zip(other.iter()).enumerate() {
            assert!(
                (x - y).abs() < 1e-5,
                "block size {name} diverged at frame {i}: 512 gave {x}, {name} gave {y}"
            );
        }
    }
}

/// The gate. `Granular` must ignore `ring_mix` entirely, however high it is set.
///
/// Not tidiness — it is the reason the sixth engine is a separate variant at
/// all. A grain reading the ring depends on the grains before it, so invariant 6
/// cannot hold for it. Kept to one engine that is a documented property; leaking
/// into `Granular` it would turn every guarantee that engine makes into a
/// conditional one, silently, for any document that happened to carry a mix.
#[test]
fn granular_ignores_the_ring_however_high_the_mix() {
    let channels = 1;
    let src = tone(SR as usize, channels);
    let ring = full_ring(1.0, channels);

    let dry = render(&src, &as_granular(SR as usize, cloud(0.0, 20.0)), None, channels, 4);
    let asked = render(&src, &as_granular(SR as usize, cloud(1.0, 20.0)), Some(&ring), channels, 4);

    assert_eq!(dry, asked, "Granular read the ring");

    // And the same document on the sixth engine does not ignore it, or the
    // assertion above would pass for the wrong reason.
    let heard = render(&src, &params(SR as usize, cloud(1.0, 20.0)), Some(&ring), channels, 4);
    assert!(heard != dry, "Feedback ignored the ring too — the test proves nothing");
}
