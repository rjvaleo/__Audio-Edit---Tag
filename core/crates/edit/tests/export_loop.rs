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

/// A source whose sample value is its frame index over 10,000, so any frame in
/// the output can be traced back to the frame it came from.
///
/// Over ten thousand rather than a thousand because the quantiser clamps at
/// full scale: a ramp that reaches 1.6 comes back as a flat 1.0 and every test
/// that reads a value learns nothing.
fn ramp_reader(frames: usize, channels: u16) -> Reader<SliceSource<Vec<u8>>> {
    let mut bytes = Vec::new();
    for i in 0..frames {
        for ch in 0..channels {
            let v = i as f32 / 10_000.0 + ch as f32 * 0.25;
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
/// The ramp makes this checkable by value: frame 1000 of the source reads 0.1,
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
    assert!((a - 0.1150).abs() < 1e-4, "expected source frame 1150, got value {a}");
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
        (s[0] - 0.1).abs() < 1e-4,
        "the first repeat was faded in: {} instead of 0.1",
        s[0],
    );
    // Nor is the very end, so the file can be re-looped downstream.
    let tail_end = s[s.len() - 1].abs();
    assert!(tail_end > 0.15, "the last repeat was faded out: {tail_end}");
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
    assert!(s[40].abs() > 0.05, "a short loop came out all ramp: {}", s[40]);
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
    // The ramp puts channel 1 exactly 0.25 above channel 0, everywhere.
    for f in [150usize, 300, 900] {
        let l = s[f * 2];
        let r = s[f * 2 + 1];
        assert!((r - l - 0.25).abs() < 1e-5, "frame {f}: channels drifted, {l} vs {r}");
    }
}

// ------------------------------------------------------------------- the tail

/// A rack with one reverb in it, decaying long enough to be worth measuring.
fn reverb_rack(decay: f32) -> Rack {
    let mut rack = Rack::new();
    rack.push(fx::shape::make(
        fx::shape::ShapeKind::SchroederReverb,
        SR,
        1,
        &[("decay".to_string(), decay), ("mix".to_string(), 1.0)],
    ));
    rack
}

/// Asked for a tail, the file runs on past the last repeat.
///
/// This is the whole point of the feature: without it the reverb is truncated
/// on the last musical frame, which is what every export did before.
#[test]
fn a_tail_runs_on_past_the_last_repeat() {
    let list = EditList::identity(4000, 1, SR);
    let plan = LoopPlan { from: 1000, to: 1600, repeats: 2, tail: true };
    let (frames, _) = export(&list, &plan, &mut reverb_rack(0.9));
    assert!(
        frames > 1200,
        "the tail added nothing — {frames} frames for 1200 frames of audio",
    );
}

/// And the same export without a tail stops dead, so the difference is the tail
/// and not something else about the reverb.
#[test]
fn the_tail_is_what_makes_the_difference() {
    let list = EditList::identity(4000, 1, SR);
    let with = LoopPlan { from: 1000, to: 1600, repeats: 2, tail: true };
    let without = LoopPlan { from: 1000, to: 1600, repeats: 2, tail: false };
    let (a, _) = export(&list, &with, &mut reverb_rack(0.9));
    let (b, _) = export(&list, &without, &mut reverb_rack(0.9));
    assert_eq!(b, 1200, "the no-tail export was not exactly the musical length");
    assert!(a > b, "tail {a} frames vs no tail {b} — the flag did nothing");
}

/// The tail ends where the sound does: quiet at the end, and not padded out to
/// the cap when the reverb finished long before it.
#[test]
fn the_tail_ends_quiet_and_is_not_padded_to_the_cap() {
    let list = EditList::identity(4000, 1, SR);
    let plan = LoopPlan { from: 1000, to: 1600, repeats: 2, tail: true };
    let (frames, s) = export(&list, &plan, &mut reverb_rack(0.5));

    let cap = 1200 + fx::TAIL_CAP_SECONDS * SR as u64;
    assert!(frames < cap, "the tail ran to the {cap}-frame cap instead of stopping");

    // The last thing in the file is below the floor the countdown uses.
    let last = s[s.len() - 1].abs();
    assert!(
        last <= fx::TAIL_SILENCE,
        "the file ends at {last}, above the {} floor — it was cut while still sounding",
        fx::TAIL_SILENCE,
    );
}

/// A longer decay gets a longer tail. The length is measured, not assumed.
#[test]
fn a_longer_reverb_gets_a_longer_tail() {
    let list = EditList::identity(4000, 1, SR);
    let plan = LoopPlan { from: 1000, to: 1600, repeats: 1, tail: true };
    let (short, _) = export(&list, &plan, &mut reverb_rack(0.3));
    let (long, _) = export(&list, &plan, &mut reverb_rack(0.95));
    assert!(
        long > short,
        "decay 0.95 gave {long} frames, decay 0.3 gave {short} — the tail is not measured",
    );
}

/// The cap holds.
///
/// A decay of 0.9995 is documented in `reverb.rs` as minutes long, and `freeze`
/// is unbounded outright — without a ceiling the render would not finish. The
/// countdown must lose to the cap here, not the other way round.
///
/// Freeze itself is deliberately *not* what is tested: switched on before any
/// audio reaches the reverb it holds an empty buffer, so it is silent by
/// construction and would pass this for the wrong reason.
#[test]
fn the_cap_bounds_an_endless_tail() {
    let list = EditList::identity(4000, 1, SR);
    let plan = LoopPlan { from: 1000, to: 1600, repeats: 1, tail: true };
    let (frames, s) = export(&list, &plan, &mut reverb_rack(0.9995));
    let cap = 600 + fx::TAIL_CAP_SECONDS * SR as u64;
    assert_eq!(frames, cap, "a minutes-long reverb was not stopped at the cap");
    // And it was cut off mid-sound, which is what hitting a ceiling means.
    let last = s[s.len() - 1].abs();
    assert!(last > fx::TAIL_SILENCE, "it went quiet on its own; the cap was not what stopped it");
}

/// A rack that cannot ring gets no tail at all.
///
/// The regression this pins: the first cut of the tail counted down four
/// seconds of quiet before stopping, and a dry chain never interrupts that
/// countdown — so every tailed export from a rack with no reverb in it carried
/// four seconds of digital silence on the end. Measured on a real export before
/// it was found: 8.500s of file for 4.500s of audio.
#[test]
fn a_dry_rack_gets_no_tail() {
    let list = EditList::identity(4000, 1, SR);
    let plan = LoopPlan { from: 1000, to: 1600, repeats: 2, tail: true };
    let (frames, _) = export(&list, &plan, &mut Rack::default());
    assert_eq!(
        frames, 1200,
        "a rack with nothing to ring appended {} frames of silence",
        frames - 1200,
    );
}

/// The tail ends in silence, not on the last audible sample.
#[test]
fn the_tail_ends_in_silence() {
    let list = EditList::identity(4000, 1, SR);
    let plan = LoopPlan { from: 1000, to: 1600, repeats: 1, tail: true };
    let (_, s) = export(&list, &plan, &mut reverb_rack(0.7));
    let last = s[s.len() - 1].abs();
    assert!(last <= fx::TAIL_SILENCE, "the file ends at {last}, still sounding");
}
