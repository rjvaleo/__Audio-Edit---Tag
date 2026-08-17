//! Exporting a loop, with a tail.
//!
//! Every test here reads the AIFF that was actually written and looks at the
//! samples in it. Asserting on the plan would only prove the plan was copied
//! into a struct; the questions that matter are how long the file is, whether
//! the repeats are the same audio, whether the seam dips, and whether the tail
//! ends where the sound does.

use audio_core::{AudioInfo, Codec, Container, Endian, Reader, SliceSource};
use edit::render::{render_loop_to_aiff_controlled, LoopPlan};
use edit::EditList;
use fx::Rack;

const SR: u32 = 1000;

/// A source whose sample value is its frame index over 1000, so any frame in
/// the output can be traced back to the frame it came from.
fn ramp_reader(frames: usize, channels: u16) -> Reader<SliceSource<Vec<u8>>> {
    let mut bytes = Vec::new();
    for i in 0..frames {
        for ch in 0..channels {
            let v = i as f32 / 1000.0 + ch as f32 * 0.5;
            bytes.extend_from_slice(&v.to_le_bytes());
        }
    }
    let len = bytes.len() as u64;
    Reader::new(
        SliceSource::new(bytes),
        AudioInfo {
            container: Container::Raw,
            codec: Codec::PcmF32,
            endian: Endian::Little,
            sample_rate: SR,
            channels,
            bits: 32,
            data_offset: 0,
            data_len: len,
        },
    )
}

fn meta() -> audio_core::aiff::Meta {
    audio_core::aiff::Meta::default()
}

/// Render a plan and hand back the 32-bit float samples that landed in the file.
fn export(list: &EditList, plan: &LoopPlan, rack: &mut Rack) -> (u64, Vec<f32>) {
    let mut reader = ramp_reader(list.base_frames() as usize, list.channels);
    let mut out: Vec<u8> = Vec::new();
    let frames = render_loop_to_aiff_controlled(
        list,
        &mut reader,
        rack,
        &mut out,
        32,
        &meta(),
        plan,
        |_, _| {},
    )
    .expect("loop export");

    // Straight back out of the container, big-endian float, so what is checked
    // is what a reader of the file would get.
    let ch = list.channels.max(1) as usize;
    let want = frames as usize * ch;
    let body = &out[out.len() - want * 4..];
    let samples = body
        .chunks_exact(4)
        .map(|b| f32::from_be_bytes([b[0], b[1], b[2], b[3]]))
        .collect::<Vec<f32>>();
    (frames, samples)
}

/// N repeats is exactly N times the loop. Not about — exactly.
///
/// The seam is a dip through zero rather than an overlap, so nothing is eaten
/// by it and the arithmetic stays honest however many repeats are asked for.
#[test]
fn repeats_are_exact_multiples_of_the_loop() {
    let list = EditList::identity(4000, 1, SR);
    for repeats in [1u32, 2, 3, 7] {
        let plan = LoopPlan { from: 1000, to: 1600, repeats, tail: false };
        let (frames, samples) = export(&list, &plan, &mut Rack::default());
        assert_eq!(
            frames,
            600 * repeats as u64,
            "{repeats} repeats of a 600-frame loop came out {frames} frames",
        );
        assert_eq!(samples.len(), frames as usize);
    }
}

/// Every repeat is the same stretch of the file, not the file marching on.
///
/// The ramp makes this checkable by value: frame 1000 of the source reads 1.0,
/// so every repeat has to start there again rather than at 1600.
#[test]
fn every_repeat_reads_the_same_source_frames() {
    let list = EditList::identity(4000, 1, SR);
    let plan = LoopPlan { from: 1000, to: 1600, repeats: 3, tail: false };
    let (_, s) = export(&list, &plan, &mut Rack::default());

    // A quarter into each repeat, past any seam ramp on either side.
    let quarter = 150;
    let a = s[quarter];
    for r in 1..3usize {
        let v = s[r * 600 + quarter];
        assert!(
            (v - a).abs() < 1e-6,
            "repeat {r} reads {v} where repeat 0 reads {a} — the loop is not repeating",
        );
    }
    // And it really is the loop's start, not the document's.
    assert!((a - 1.150).abs() < 1e-3, "expected source frame 1150, got value {a}");
}

/// The seam dips to silence and comes back, the way the transport's does.
#[test]
fn the_seam_fades_through_zero() {
    let list = EditList::identity(4000, 1, SR);
    let plan = LoopPlan { from: 1000, to: 1600, repeats: 2, tail: false };
    let (_, s) = export(&list, &plan, &mut Rack::default());

    // 600 frames / 4 = 150, so the seam is a 150-frame ramp either side.
    let last = s[599].abs();
    let first = s[600].abs();
    let middle = s[300].abs();
    assert!(last < middle * 0.05, "end of repeat 0 is {last}, not faded (mid {middle})");
    assert!(first < middle * 0.05, "start of repeat 1 is {first}, not faded (mid {middle})");

    // And the very start is *not* ramped — playback enters the first repeat
    // normally, so ramping it would be a fade-in the listener never asked for.
    assert!(
        (s[0] - 1.0).abs() < 1e-3,
        "the first repeat was faded in: {} instead of 1.0",
        s[0],
    );
    // Nor is the very end, so the file can be re-looped downstream.
    let tail_end = s[s.len() - 1].abs();
    assert!(tail_end > 1.0, "the last repeat was faded out: {tail_end}");
}

/// A short loop is not eaten by its own seam.
#[test]
fn a_short_loop_gets_a_shorter_seam() {
    let list = EditList::identity(4000, 1, SR);
    // 80 frames: a quarter is 20, far below the 512-frame cap.
    let plan = LoopPlan { from: 1000, to: 1080, repeats: 2, tail: false };
    let (frames, s) = export(&list, &plan, &mut Rack::default());
    assert_eq!(frames, 160);
    // The middle of each repeat still carries full-level audio rather than
    // being all ramp.
    assert!(s[40].abs() > 1.0, "a short loop came out all ramp: {}", s[40]);
}

/// With no tail asked for, the file stops on the last musical frame.
#[test]
fn no_tail_means_no_extra_frames() {
    let list = EditList::identity(4000, 1, SR);
    let plan = LoopPlan { from: 1000, to: 1600, repeats: 2, tail: false };
    let (frames, _) = export(&list, &plan, &mut Rack::default());
    assert_eq!(frames, 1200);
}

/// An empty range is refused rather than silently exported as something else.
#[test]
fn an_empty_loop_range_is_an_error() {
    let list = EditList::identity(4000, 1, SR);
    let mut reader = ramp_reader(4000, 1);
    let mut out: Vec<u8> = Vec::new();
    let plan = LoopPlan { from: 1600, to: 1600, repeats: 2, tail: false };
    let r = render_loop_to_aiff_controlled(
        &list,
        &mut reader,
        &mut Rack::default(),
        &mut out,
        32,
        &meta(),
        &plan,
        |_, _| {},
    );
    assert!(r.is_err(), "an empty loop range was accepted");
}

/// Two channels stay two channels, and stay in step.
#[test]
fn stereo_survives_the_tiling() {
    let list = EditList::identity(4000, 2, SR);
    let plan = LoopPlan { from: 1000, to: 1600, repeats: 2, tail: false };
    let (frames, s) = export(&list, &plan, &mut Rack::default());
    assert_eq!(frames, 1200);
    assert_eq!(s.len(), 1200 * 2);
    // The ramp puts channel 1 exactly 0.5 above channel 0, everywhere.
    for f in [150usize, 300, 900] {
        let l = s[f * 2];
        let r = s[f * 2 + 1];
        assert!((r - l - 0.5).abs() < 1e-5, "frame {f}: channels drifted, {l} vs {r}");
    }
}
