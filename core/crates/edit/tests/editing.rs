//! The edit engine's contract.
//!
//! Every test renders and inspects actual samples rather than asserting on the
//! clip list, because the clip list is an implementation detail and the samples
//! are what the user hears.

use audio_core::{AudioInfo, Codec, Container, Endian, Reader, SliceSource};
use edit::render::{measure_peak, render, render_to_wav};
use edit::{EditList, FadeShape, Range, Session};

/// A source whose sample value equals its frame index divided by 1000, so any
/// frame can be identified from its value alone.
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
            sample_rate: 1000,
            channels,
            bits: 32,
            data_offset: 0,
            data_len: len,
        },
    )
}

fn identity(frames: u64) -> EditList {
    EditList::identity(frames, 1, 1000)
}

fn rendered(list: &EditList, reader: &mut Reader<SliceSource<Vec<u8>>>) -> Vec<f32> {
    render(list, reader, 0, list.frames()).expect("render")
}

// ------------------------------------------------------------------ identity

#[test]
fn an_untouched_document_renders_the_source_exactly() {
    let mut r = ramp_reader(100, 1);
    let list = identity(100);
    let out = rendered(&list, &mut r);
    assert_eq!(out.len(), 100);
    for (i, v) in out.iter().enumerate() {
        assert!((v - i as f32 / 1000.0).abs() < 1e-6, "frame {i}");
    }
}

#[test]
fn an_identity_document_knows_it_is_unedited() {
    assert!(identity(100).is_identity());
    let mut l = identity(100);
    l.cut(Range::new(10, 20));
    assert!(!l.is_identity());
}

// ----------------------------------------------------------------------- cut

#[test]
fn cutting_removes_the_range_and_closes_the_gap() {
    let mut r = ramp_reader(100, 1);
    let mut list = identity(100);
    list.cut(Range::new(20, 30));

    assert_eq!(list.frames(), 90);
    let out = rendered(&list, &mut r);
    // Frame 19 then frame 30: the cut material must be gone, not silenced.
    assert!((out[19] - 0.019).abs() < 1e-6);
    assert!((out[20] - 0.030).abs() < 1e-6);
}

#[test]
fn cutting_from_the_start_works() {
    let mut r = ramp_reader(100, 1);
    let mut list = identity(100);
    list.cut(Range::new(0, 10));
    assert_eq!(list.frames(), 90);
    assert!((rendered(&list, &mut r)[0] - 0.010).abs() < 1e-6);
}

#[test]
fn cutting_to_the_end_works() {
    let mut list = identity(100);
    list.cut(Range::new(90, 100));
    assert_eq!(list.frames(), 90);
}

#[test]
fn cutting_everything_leaves_an_empty_document() {
    let mut list = identity(100);
    list.cut(Range::new(0, 100));
    assert_eq!(list.frames(), 0);
    assert!(list.clips.is_empty());
}

#[test]
fn two_separate_cuts_both_take_effect() {
    let mut r = ramp_reader(100, 1);
    let mut list = identity(100);
    list.cut(Range::new(60, 70));
    list.cut(Range::new(20, 30)); // earlier range, after the timeline shifted
    assert_eq!(list.frames(), 80);

    let out = rendered(&list, &mut r);
    assert!((out[19] - 0.019).abs() < 1e-6);
    assert!((out[20] - 0.030).abs() < 1e-6);
}

#[test]
fn a_cut_past_the_end_is_ignored() {
    let mut list = identity(100);
    list.cut(Range::new(200, 300));
    assert_eq!(list.frames(), 100);
}

#[test]
fn an_empty_cut_does_nothing() {
    let mut list = identity(100);
    list.cut(Range::new(50, 50));
    assert_eq!(list.frames(), 100);
}

#[test]
fn a_backwards_range_is_treated_as_the_range_it_describes() {
    let mut a = identity(100);
    let mut b = identity(100);
    a.cut(Range::new(20, 30));
    b.cut(Range::new(30, 20));
    assert_eq!(a.frames(), b.frames());
}

// -------------------------------------------------------------------- silence

#[test]
fn silencing_keeps_the_length_but_zeroes_the_audio() {
    let mut r = ramp_reader(100, 1);
    let mut list = identity(100);
    list.silence(Range::new(20, 30));

    assert_eq!(list.frames(), 100);
    let out = rendered(&list, &mut r);
    for i in 20..30 {
        assert_eq!(out[i], 0.0, "frame {i} should be silent");
    }
    assert!((out[19] - 0.019).abs() < 1e-6);
    assert!((out[30] - 0.030).abs() < 1e-6);
}

// ----------------------------------------------------------------------- gain

#[test]
fn a_six_db_boost_roughly_doubles_the_amplitude() {
    let mut r = ramp_reader(100, 1);
    let mut list = identity(100);
    list.gain_db(Range::new(0, 100), 6.0206);
    let out = rendered(&list, &mut r);
    assert!((out[50] - 0.100).abs() < 1e-3, "got {}", out[50]);
}

#[test]
fn gain_applies_only_inside_the_range() {
    let mut r = ramp_reader(100, 1);
    let mut list = identity(100);
    list.gain_db(Range::new(50, 100), -6.0206);
    let out = rendered(&list, &mut r);
    assert!((out[49] - 0.049).abs() < 1e-6, "outside the range");
    assert!((out[50] - 0.025).abs() < 1e-3, "inside the range");
}

#[test]
fn gain_changes_compound() {
    let mut r = ramp_reader(100, 1);
    let mut list = identity(100);
    list.gain_db(Range::new(0, 100), 6.0206);
    list.gain_db(Range::new(0, 100), 6.0206);
    let out = rendered(&list, &mut r);
    assert!((out[50] - 0.200).abs() < 1e-3, "got {}", out[50]);
}

// ---------------------------------------------------------------------- fades

#[test]
fn a_linear_fade_in_starts_silent_and_reaches_unity() {
    let mut r = ramp_reader(100, 1);
    let mut list = identity(100);
    list.fade_in(Range::new(0, 100), 50, FadeShape::Linear);
    let out = rendered(&list, &mut r);

    assert_eq!(out[0], 0.0, "a fade-in must start at silence");
    // Halfway through a linear fade the gain is 0.5.
    assert!((out[25] - 0.025 * 0.5).abs() < 1e-4, "got {}", out[25]);
    // Past the fade the signal is untouched.
    assert!((out[70] - 0.070).abs() < 1e-6);
}

#[test]
fn a_linear_fade_out_ends_at_silence() {
    let mut r = ramp_reader(100, 1);
    let mut list = identity(100);
    list.fade_out(Range::new(0, 100), 50, FadeShape::Linear);
    let out = rendered(&list, &mut r);

    assert!((out[10] - 0.010).abs() < 1e-6, "before the fade, untouched");
    assert!(out[99].abs() < 1e-3, "must end near silence, got {}", out[99]);
    assert!(out[99] < out[60], "must be descending");
}

#[test]
fn an_equal_power_fade_sits_above_a_linear_one_at_the_midpoint() {
    // This is the whole reason the shape is selectable: two linear fades
    // crossfaded together dip in the middle, equal-power ones do not.
    let mut r1 = ramp_reader(100, 1);
    let mut r2 = ramp_reader(100, 1);
    let mut lin = identity(100);
    let mut eq = identity(100);
    lin.fade_in(Range::new(0, 100), 100, FadeShape::Linear);
    eq.fade_in(Range::new(0, 100), 100, FadeShape::EqualPower);

    let a = rendered(&lin, &mut r1);
    let b = rendered(&eq, &mut r2);
    assert!(b[50] > a[50], "equal-power should be louder at the midpoint");
}

#[test]
fn a_fade_survives_a_later_cut_elsewhere() {
    let mut r = ramp_reader(100, 1);
    let mut list = identity(100);
    list.fade_in(Range::new(0, 100), 20, FadeShape::Linear);
    list.cut(Range::new(60, 70));
    let out = rendered(&list, &mut r);
    assert_eq!(out[0], 0.0, "the fade must still be there");
    assert_eq!(list.frames(), 90);
}

// -------------------------------------------------------------------- reverse

#[test]
fn reversing_the_whole_document_plays_it_backwards() {
    let mut r = ramp_reader(100, 1);
    let mut list = identity(100);
    list.reverse(Range::new(0, 100));
    let out = rendered(&list, &mut r);

    assert_eq!(out.len(), 100);
    assert!((out[0] - 0.099).abs() < 1e-6, "got {}", out[0]);
    assert!((out[99] - 0.000).abs() < 1e-6, "got {}", out[99]);
}

#[test]
fn reversing_twice_returns_the_original() {
    let mut r = ramp_reader(60, 1);
    let mut list = identity(60);
    list.reverse(Range::new(0, 60));
    list.reverse(Range::new(0, 60));
    let out = rendered(&list, &mut r);
    for (i, v) in out.iter().enumerate() {
        assert!((v - i as f32 / 1000.0).abs() < 1e-6, "frame {i} = {v}");
    }
}

// ------------------------------------------------------------------ normalize

#[test]
fn normalising_brings_the_peak_to_the_target() {
    let mut r = ramp_reader(100, 1);
    // The ramp peaks at 0.099.
    let mut list = identity(100);
    let peak = measure_peak(&list, &mut r).expect("measure");
    assert!((peak - 0.099).abs() < 1e-6);

    list.normalize(peak, 0.0);
    let after = measure_peak(&list, &mut r).expect("measure");
    assert!((after - 1.0).abs() < 1e-4, "got {after}");
}

#[test]
fn normalising_to_minus_three_db_lands_there() {
    let mut r = ramp_reader(100, 1);
    let mut list = identity(100);
    let peak = measure_peak(&list, &mut r).unwrap();
    list.normalize(peak, -3.0);
    let after = measure_peak(&list, &mut r).unwrap();
    let db = 20.0 * after.log10();
    assert!((db + 3.0).abs() < 0.05, "got {db} dB");
}

#[test]
fn normalising_silence_does_nothing_rather_than_dividing_by_zero() {
    let mut list = identity(100);
    let before = list.clone();
    list.normalize(0.0, 0.0);
    assert_eq!(list, before);
}

// --------------------------------------------------------------- multichannel

#[test]
fn channels_stay_aligned_through_a_cut() {
    let mut r = ramp_reader(100, 2);
    let mut list = EditList::identity(100, 2, 1000);
    list.cut(Range::new(20, 30));
    let out = render(&list, &mut r, 0, list.frames()).unwrap();

    assert_eq!(out.len(), 90 * 2);
    // Right channel is always left + 0.5 in this fixture.
    for i in 0..90 {
        let l = out[i * 2];
        let rch = out[i * 2 + 1];
        assert!((rch - l - 0.5).abs() < 1e-5, "frame {i} lost alignment");
    }
}

#[test]
fn channels_stay_aligned_through_a_reverse() {
    let mut r = ramp_reader(50, 2);
    let mut list = EditList::identity(50, 2, 1000);
    list.reverse(Range::new(0, 50));
    let out = render(&list, &mut r, 0, list.frames()).unwrap();
    for i in 0..50 {
        assert!((out[i * 2 + 1] - out[i * 2] - 0.5).abs() < 1e-5, "frame {i}");
    }
}

// ------------------------------------------------------------ partial renders

#[test]
fn rendering_a_window_matches_the_same_span_of_a_full_render() {
    let mut r1 = ramp_reader(200, 1);
    let mut r2 = ramp_reader(200, 1);
    let mut list = identity(200);
    list.cut(Range::new(50, 60));
    list.fade_in(Range::new(0, 190), 30, FadeShape::Linear);

    let full = render(&list, &mut r1, 0, list.frames()).unwrap();
    let part = render(&list, &mut r2, 40, 60).unwrap();
    for i in 0..60 {
        assert!(
            (full[40 + i] - part[i]).abs() < 1e-6,
            "window differs at {i}: {} vs {}",
            full[40 + i],
            part[i]
        );
    }
}

// ------------------------------------------------------------------- sessions

#[test]
fn undo_restores_the_previous_state() {
    let mut s = Session::new(identity(100));
    s.apply(|l| l.cut(Range::new(20, 30)));
    assert_eq!(s.list().frames(), 90);
    assert!(s.undo());
    assert_eq!(s.list().frames(), 100);
}

#[test]
fn redo_reapplies_what_undo_took_away() {
    let mut s = Session::new(identity(100));
    s.apply(|l| l.cut(Range::new(20, 30)));
    s.undo();
    assert!(s.redo());
    assert_eq!(s.list().frames(), 90);
}

#[test]
fn undo_walks_back_through_several_edits() {
    let mut s = Session::new(identity(100));
    s.apply(|l| l.cut(Range::new(90, 100)));
    s.apply(|l| l.cut(Range::new(80, 90)));
    s.apply(|l| l.cut(Range::new(70, 80)));
    assert_eq!(s.list().frames(), 70);
    s.undo();
    s.undo();
    assert_eq!(s.list().frames(), 90);
}

#[test]
fn a_new_edit_clears_the_redo_stack() {
    // Otherwise redo would jump to a state that never followed from here.
    let mut s = Session::new(identity(100));
    s.apply(|l| l.cut(Range::new(20, 30)));
    s.undo();
    s.apply(|l| l.cut(Range::new(0, 5)));
    assert!(!s.can_redo());
}

#[test]
fn an_edit_that_changes_nothing_is_not_recorded() {
    let mut s = Session::new(identity(100));
    assert!(!s.apply(|l| l.cut(Range::new(50, 50))));
    assert!(!s.can_undo(), "a no-op must not consume an undo step");
}

#[test]
fn undo_on_a_fresh_session_is_harmless() {
    let mut s = Session::new(identity(100));
    assert!(!s.undo());
    assert_eq!(s.list().frames(), 100);
}

#[test]
fn revert_returns_to_the_untouched_source_and_is_itself_undoable() {
    let mut s = Session::new(identity(100));
    s.apply(|l| l.cut(Range::new(20, 30)));
    s.apply(|l| l.gain_db(Range::new(0, 90), -6.0));
    s.revert();
    assert!(s.list().is_identity());
    s.undo();
    assert!(!s.list().is_identity());
}

// -------------------------------------------------------------------- export

#[test]
fn exporting_produces_a_wav_of_the_edited_length() {
    let mut r = ramp_reader(1000, 1);
    let mut list = identity(1000);
    list.cut(Range::new(0, 500));

    let mut out = Vec::new();
    let frames = render_to_wav(&list, &mut r, &mut out, 24).unwrap();
    assert_eq!(frames, 500);

    assert_eq!(&out[0..4], b"RIFF");
    assert_eq!(&out[8..12], b"WAVE");
    // 44-byte header plus 500 frames x 1 channel x 3 bytes.
    assert_eq!(out.len(), 44 + 500 * 3);
}

#[test]
fn an_export_can_be_read_back_by_our_own_probe() {
    let mut r = ramp_reader(300, 2);
    let mut list = EditList::identity(300, 2, 1000);
    list.cut(Range::new(100, 200));

    let mut bytes = Vec::new();
    render_to_wav(&list, &mut r, &mut bytes, 16).unwrap();

    let mut src = SliceSource::new(bytes);
    let info = audio_core::probe(&mut src).expect("the export must be readable");
    assert_eq!(info.channels, 2);
    assert_eq!(info.sample_rate, 1000);
    assert_eq!(info.frames(), 200);
}

#[test]
fn a_boosted_export_clamps_instead_of_wrapping() {
    // Gain past unity is legal in the edit list; quantising it must saturate,
    // not wrap around into the opposite polarity.
    let mut r = ramp_reader(100, 1);
    let mut list = identity(100);
    list.gain_db(Range::new(0, 100), 40.0);

    let mut bytes = Vec::new();
    render_to_wav(&list, &mut r, &mut bytes, 16).unwrap();

    let mut src = SliceSource::new(bytes);
    let info = audio_core::probe(&mut src).unwrap();
    let mut back = Reader::new(src, info);
    let samples = back.read_frames(0, 100).unwrap();
    assert!(
        samples.iter().all(|v| *v >= -1.0 && *v <= 1.0),
        "clamping failed"
    );
    assert!(samples[99] > 0.9, "loud material should stay loud");
}

// -------------------------------------------------- byte-range wav rendering

#[test]
fn the_edited_stream_length_matches_what_is_rendered() {
    let mut r = ramp_reader(500, 2);
    let mut list = EditList::identity(500, 2, 1000);
    list.cut(Range::new(0, 100));

    let declared = edit::render::wav_stream_len(&list, 16);
    let mut whole = Vec::new();
    render_to_wav(&list, &mut r, &mut whole, 16).unwrap();
    assert_eq!(declared, whole.len() as u64);
}

#[test]
fn a_byte_range_matches_the_same_slice_of_the_whole_stream() {
    // Seeking in the browser depends on this exactly. An off-by-one here plays
    // as a burst of noise at every seek.
    let mut r1 = ramp_reader(500, 2);
    let mut r2 = ramp_reader(500, 2);
    let mut list = EditList::identity(500, 2, 1000);
    list.cut(Range::new(200, 250));
    list.gain_db(Range::new(0, 100), -6.0);

    let mut whole = Vec::new();
    render_to_wav(&list, &mut r1, &mut whole, 16).unwrap();

    for (start, end) in [(0u64, 43u64), (0, 100), (44, 500), (43, 47), (1000, 1500)] {
        let part = edit::render::wav_bytes(&list, &mut r2, start, end, 16).unwrap();
        let expect = &whole[start as usize..=(end as usize).min(whole.len() - 1)];
        assert_eq!(part, expect, "range {start}-{end} differs");
    }
}

#[test]
fn a_range_starting_mid_frame_still_lines_up() {
    // 2 channels of 16-bit is 4 bytes per frame; byte 47 is inside a frame.
    let mut r1 = ramp_reader(200, 2);
    let mut r2 = ramp_reader(200, 2);
    let list = EditList::identity(200, 2, 1000);

    let mut whole = Vec::new();
    render_to_wav(&list, &mut r1, &mut whole, 16).unwrap();
    let part = edit::render::wav_bytes(&list, &mut r2, 47, 137, 16).unwrap();
    assert_eq!(part, &whole[47..=137]);
}

#[test]
fn a_range_past_the_end_returns_nothing_rather_than_failing() {
    let mut r = ramp_reader(100, 1);
    let list = EditList::identity(100, 1, 1000);
    let out = edit::render::wav_bytes(&list, &mut r, 99999, 100999, 16).unwrap();
    assert!(out.is_empty());
}

// ============================================================ effects in render

use fx::comp::CompSettings;
use fx::eq::{Band, EqSettings};
use fx::{Compressor, Eq, Gain, Rack};

#[test]
fn an_empty_rack_renders_identically_to_no_rack() {
    let mut r1 = ramp_reader(500, 1);
    let mut r2 = ramp_reader(500, 1);
    let list = identity(500);
    let plain = render(&list, &mut r1, 0, 500).unwrap();
    let racked =
        edit::render::render_fx(&list, &mut r2, &mut Rack::new(), 0, 500).unwrap();
    assert_eq!(plain, racked);
}

#[test]
fn a_gain_effect_reaches_the_rendered_output() {
    let mut r = ramp_reader(100, 1);
    let list = identity(100);
    let mut rack = Rack::new();
    rack.push(Box::new(Gain { db: 6.0206 }));
    let out = edit::render::render_fx(&list, &mut r, &mut rack, 0, 100).unwrap();
    // Frame 50 of the ramp is 0.050; doubled it is 0.100.
    assert!((out[50] - 0.100).abs() < 1e-3, "got {}", out[50]);
}

#[test]
fn effects_stack_on_top_of_clip_gain_rather_than_replacing_it() {
    let mut r = ramp_reader(100, 1);
    let mut list = identity(100);
    list.gain_db(Range::new(0, 100), 6.0206); // clip-level
    let mut rack = Rack::new();
    rack.push(Box::new(Gain { db: 6.0206 })); // rack-level
    let out = edit::render::render_fx(&list, &mut r, &mut rack, 0, 100).unwrap();
    assert!((out[50] - 0.200).abs() < 2e-3, "got {}", out[50]);
}

#[test]
fn the_rack_runs_after_the_cut_not_before_it() {
    // Effects apply to the edited timeline. If they ran on the source, a cut
    // would move which audio they had already processed.
    let mut r = ramp_reader(100, 1);
    let mut list = identity(100);
    list.cut(Range::new(0, 50));
    let mut rack = Rack::new();
    rack.push(Box::new(Gain { db: 6.0206 }));
    let out = edit::render::render_fx(&list, &mut r, &mut rack, 0, 50).unwrap();
    assert_eq!(out.len(), 50);
    // First surviving frame is source frame 50 = 0.050, doubled.
    assert!((out[0] - 0.100).abs() < 1e-3, "got {}", out[0]);
}

#[test]
fn a_windowed_render_with_a_filter_matches_the_full_render() {
    // This is what pre-roll exists for. Without it a filter would restart from
    // silence at the window boundary and the two would diverge badly.
    let sr = 1000;
    let frames = 4000;
    let mut r1 = ramp_reader(frames as usize, 1);
    let mut r2 = ramp_reader(frames as usize, 1);
    let list = EditList::identity(frames, 1, sr);

    let settings = EqSettings {
        low: Band { freq: 80.0, q: 0.7, gain_db: 8.0 },
        ..EqSettings::default()
    };
    let mut rack1 = Rack::new();
    rack1.push(Box::new(Eq::new(settings)));
    let full = edit::render::render_fx(&list, &mut r1, &mut rack1, 0, frames).unwrap();

    let mut rack2 = Rack::new();
    rack2.push(Box::new(Eq::new(settings)));
    let window = edit::render::render_fx(&list, &mut r2, &mut rack2, 2000, 500).unwrap();

    assert_eq!(window.len(), 500);
    let mut worst = 0f32;
    for i in 0..500 {
        worst = worst.max((full[2000 + i] - window[i]).abs());
    }
    assert!(worst < 1e-3, "windowed render drifted from the full one by {worst}");
}

#[test]
fn a_compressor_in_the_rack_pulls_down_a_loud_export() {
    let sr = 48000;
    let frames = 24000u64;
    // Build a loud constant-amplitude source.
    let mut bytes = Vec::new();
    for i in 0..frames {
        let v = if (i / 24) % 2 == 0 { 0.9f32 } else { -0.9f32 };
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    let len = bytes.len() as u64;
    let mut reader = Reader::new(
        SliceSource::new(bytes),
        AudioInfo {
            container: Container::Raw,
            codec: Codec::PcmF32,
            endian: Endian::Little,
            sample_rate: sr,
            channels: 1,
            bits: 32,
            data_offset: 0,
            data_len: len,
        },
    );
    let list = EditList::identity(frames, 1, sr);

    let mut rack = Rack::new();
    rack.push(Box::new(Compressor::new(CompSettings {
        threshold_db: -24.0,
        ratio: 8.0,
        attack_ms: 1.0,
        knee_db: 0.0,
        ..CompSettings::default()
    })));

    // Measure after the attack has finished, not across the whole file: the
    // peak of the entire render legitimately includes the initial transient
    // that a 1 ms attack lets through before it clamps down.
    let out = edit::render::render_fx(&list, &mut reader, &mut rack, 0, frames).unwrap();
    let settled = &out[out.len() / 2..];
    let peak = settled.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    assert!(peak < 0.5, "compressor should have pulled 0.9 well down, got {peak}");

    // And the transient really is still there at the start, which is the point
    // of having an attack time at all.
    let opening = out[..48].iter().fold(0.0f32, |m, v| m.max(v.abs()));
    assert!(opening > peak, "the attack should let the initial transient through");
}

#[test]
fn removing_an_effect_restores_the_original_exactly() {
    // The non-destructive guarantee: the rack is not baked in anywhere.
    let mut r1 = ramp_reader(200, 1);
    let mut r2 = ramp_reader(200, 1);
    let list = identity(200);

    let before = render(&list, &mut r1, 0, 200).unwrap();

    let mut rack = Rack::new();
    rack.push(Box::new(Eq::new(EqSettings {
        mid: Band { freq: 200.0, q: 1.0, gain_db: 12.0 },
        ..EqSettings::default()
    })));
    let _ = edit::render::render_fx(&list, &mut r2, &mut rack, 0, 200).unwrap();

    rack.slots.clear();
    let mut r3 = ramp_reader(200, 1);
    let after = edit::render::render_fx(&list, &mut r3, &mut rack, 0, 200).unwrap();
    assert_eq!(before, after);
}

// =============================================================== stretching

#[test]
fn a_stretched_document_reports_the_stretched_length() {
    let mut list = identity(1000);
    list.stretch = fx::Stretch { ratio: 2.0, ..fx::Stretch::default() };
    assert_eq!(list.base_frames(), 1000);
    assert_eq!(list.frames(), 2000);
    assert!(list.is_stretched());
}

#[test]
fn stretching_renders_the_length_it_promised() {
    let mut r = ramp_reader(4000, 1);
    let mut list = EditList::identity(4000, 1, 8000);
    list.stretch = fx::Stretch { ratio: 1.5, ..fx::Stretch::default() };
    let out = edit::render::render_all_stretched(&list, &mut r, &mut Rack::new()).unwrap();
    assert_eq!(out.len() as u64, list.frames());
}

#[test]
fn a_cut_then_a_stretch_compose() {
    // Edits happen on the pre-stretch timeline; the stretch scales the result.
    let mut list = identity(1000);
    list.cut(Range::new(0, 400));
    list.stretch = fx::Stretch { ratio: 2.0, ..fx::Stretch::default() };
    assert_eq!(list.base_frames(), 600);
    assert_eq!(list.frames(), 1200);
}

#[test]
fn edit_operations_still_address_the_unstretched_timeline() {
    // If cut used the stretched length it would run off the end of the clips.
    let mut r = ramp_reader(1000, 1);
    let mut list = identity(1000);
    list.stretch = fx::Stretch { ratio: 3.0, ..fx::Stretch::default() };
    list.cut(Range::new(0, 500));
    assert_eq!(list.base_frames(), 500);
    let out = edit::render::render(&list, &mut r, 0, 500).unwrap();
    assert!((out[0] - 0.500).abs() < 1e-6, "cut landed wrong: {}", out[0]);
}

#[test]
fn an_unstretched_document_is_unaffected_by_the_stretch_path() {
    let mut r1 = ramp_reader(500, 1);
    let mut r2 = ramp_reader(500, 1);
    let list = identity(500);
    let plain = render(&list, &mut r1, 0, 500).unwrap();
    let via_all = edit::render::render_all_stretched(&list, &mut r2, &mut Rack::new()).unwrap();
    assert_eq!(plain, via_all);
}

#[test]
fn a_windowed_render_of_a_stretched_document_is_not_silently_wrong() {
    // render_fx must notice the stretch rather than returning raw clip audio.
    let mut r = ramp_reader(4000, 1);
    let mut list = EditList::identity(4000, 1, 8000);
    list.stretch = fx::Stretch { ratio: 2.0, ..fx::Stretch::default() };
    let win = edit::render::render_fx(&list, &mut r, &mut Rack::new(), 5000, 500).unwrap();
    assert_eq!(win.len(), 500);

    let all = edit::render::render_all_stretched(&list, &mut r, &mut Rack::new()).unwrap();
    for i in 0..500 {
        assert_eq!(win[i], all[5000 + i], "window differs at {i}");
    }
}

#[test]
fn stretching_does_not_touch_the_source() {
    let mut list = identity(1000);
    list.stretch = fx::Stretch { ratio: 0.5, semitones: 7.0, ..fx::Stretch::default() };
    // Reverting drops the stretch along with everything else.
    let mut s = Session::new(list);
    assert!(!s.list().is_identity());
    s.revert();
    assert!(s.list().is_identity());
    assert!(!s.list().is_stretched());
}

// ------------------------------------------------------------- the Peak edits

#[test]
fn cropping_keeps_the_selection_and_nothing_else() {
    let mut r = ramp_reader(1000, 1);
    let mut list = identity(1000);
    list.crop(Range::new(200, 300));

    assert_eq!(list.frames(), 100);
    let out = rendered(&list, &mut r);
    assert_eq!(out.len(), 100);
    for (i, v) in out.iter().enumerate() {
        assert!((v - (200 + i) as f32 / 1000.0).abs() < 1e-6, "frame {i} is {v}");
    }
}

#[test]
fn cropping_the_whole_document_changes_nothing() {
    let mut list = identity(1000);
    list.crop(Range::new(0, 1000));
    assert!(list.is_identity());
}

#[test]
fn cropping_an_empty_or_out_of_range_selection_leaves_the_document_alone() {
    let mut list = identity(1000);
    list.crop(Range::new(500, 500));
    assert!(list.is_identity());
    list.crop(Range::new(2000, 3000));
    assert!(list.is_identity());
}

#[test]
fn cropping_survives_an_earlier_cut() {
    // Crop addresses the timeline as it stands, not the source.
    let mut r = ramp_reader(1000, 1);
    let mut list = identity(1000);
    list.cut(Range::new(0, 500)); // timeline is now source frames 500..1000
    list.crop(Range::new(100, 200)); // which is source 600..700

    let out = rendered(&list, &mut r);
    assert_eq!(out.len(), 100);
    assert!((out[0] - 0.600).abs() < 1e-6, "starts at {}", out[0]);
}

#[test]
fn duplicating_repeats_the_selection_in_place_and_pushes_the_rest_along() {
    let mut r = ramp_reader(1000, 1);
    let mut list = identity(1000);
    list.duplicate(Range::new(100, 200), 1);

    assert_eq!(list.frames(), 1100);
    let out = rendered(&list, &mut r);
    // 0..100 untouched, then the selection twice, then the rest.
    assert!((out[50] - 0.050).abs() < 1e-6);
    assert!((out[150] - 0.150).abs() < 1e-6, "first copy: {}", out[150]);
    assert!((out[250] - 0.150).abs() < 1e-6, "second copy: {}", out[250]);
    assert!((out[300] - 0.200).abs() < 1e-6, "the rest resumes: {}", out[300]);
}

#[test]
fn duplicating_more_than_once_lays_down_that_many_extra_copies() {
    let mut r = ramp_reader(1000, 1);
    let mut list = identity(1000);
    list.duplicate(Range::new(0, 100), 3);

    assert_eq!(list.frames(), 1300);
    let out = rendered(&list, &mut r);
    for copy in 0..4 {
        assert!(
            (out[copy * 100 + 10] - 0.010).abs() < 1e-6,
            "copy {copy} is wrong: {}",
            out[copy * 100 + 10]
        );
    }
}

#[test]
fn duplicating_zero_times_is_inert() {
    let mut list = identity(1000);
    list.duplicate(Range::new(100, 200), 0);
    assert!(list.is_identity());
}

#[test]
fn insert_silence_pushes_everything_after_it_later_rather_than_overwriting() {
    // This is the one Peak command ours got wrong: `silence` overwrites, and
    // there was no way to make a document longer.
    let mut r = ramp_reader(1000, 1);
    let mut list = identity(1000);
    list.insert_silence(400, 100);

    assert_eq!(list.frames(), 1100, "the document must get longer");
    let out = rendered(&list, &mut r);
    assert!((out[399] - 0.399).abs() < 1e-6);
    for i in 400..500 {
        assert_eq!(out[i], 0.0, "frame {i} should be silent");
    }
    assert!((out[500] - 0.400).abs() < 1e-6, "the audio resumes where it left off: {}", out[500]);
}

#[test]
fn silence_can_be_inserted_at_either_end() {
    let mut r = ramp_reader(100, 1);
    let mut list = identity(100);
    list.insert_silence(0, 10);
    list.insert_silence(110, 10);

    assert_eq!(list.frames(), 120);
    let out = rendered(&list, &mut r);
    assert_eq!(out[0], 0.0);
    assert!((out[10] - 0.000).abs() < 1e-6);
    assert_eq!(out[119], 0.0);
}

#[test]
fn inserted_silence_stays_silent_when_the_gain_around_it_is_changed() {
    // A silent clip says what it *is*, not what its level happens to be, so
    // an absolute gain over the top of it cannot make it play audio.
    let mut r = ramp_reader(1000, 1);
    let mut list = identity(1000);
    list.insert_silence(400, 100);
    list.set_gain(Range::new(0, list.base_frames()), 1.0);

    let out = rendered(&list, &mut r);
    for i in 400..500 {
        assert_eq!(out[i], 0.0, "frame {i} came back to life");
    }
}

#[test]
fn inserting_no_silence_is_inert() {
    let mut list = identity(1000);
    list.insert_silence(400, 0);
    assert!(list.is_identity());
}

#[test]
fn silence_inserted_past_the_end_lands_at_the_end_rather_than_being_dropped() {
    let mut list = identity(100);
    list.insert_silence(9999, 10);
    assert_eq!(list.frames(), 110);
}

#[test]
fn rms_normalising_reaches_the_level_it_was_asked_for() {
    let mut list = identity(1000);
    // A signal measuring 0.1 RMS asked for -20 dB (0.1) needs no change.
    list.normalize_rms(0.1, 0.2, -20.0, -0.1);
    assert!((list.clips[0].gain - 1.0).abs() < 1e-6, "gain {}", list.clips[0].gain);

    let mut list = identity(1000);
    // 0.05 RMS asked for -20 dB is a doubling, and its peak has room.
    list.normalize_rms(0.05, 0.1, -20.0, -0.1);
    assert!((list.clips[0].gain - 2.0).abs() < 1e-4, "gain {}", list.clips[0].gain);
}

#[test]
fn rms_normalising_gives_up_level_rather_than_passing_the_ceiling() {
    // Peak soft-clips here; we hold the ceiling and come out quieter, which is
    // the honest half of the same bargain and needs no clipper.
    let mut list = identity(1000);
    // Doubling would put the peak at 1.8, well over the ceiling.
    list.normalize_rms(0.05, 0.9, -20.0, -0.1);
    let g = list.clips[0].gain;
    let ceiling = 10f32.powf(-0.1 / 20.0);
    assert!((0.9 * g - ceiling).abs() < 1e-4, "peak lands at {}", 0.9 * g);
    assert!(g < 2.0, "the ceiling must have cost some level");
}

#[test]
fn rms_normalising_silence_does_nothing_rather_than_dividing_by_zero() {
    let mut list = identity(1000);
    list.normalize_rms(0.0, 0.0, -20.0, -0.1);
    assert!(list.is_identity());
    assert!(list.clips[0].gain.is_finite());
}

// -------------------------------------------- measuring, stripping, repairing

/// A reader over arbitrary mono samples, for the measured operations.
fn reader_from(samples: &[f32], channels: u16) -> Reader<SliceSource<Vec<u8>>> {
    let mut bytes = Vec::new();
    for v in samples {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    let len = bytes.len() as u64;
    Reader::new(
        SliceSource::new(bytes),
        AudioInfo {
            container: Container::Raw,
            codec: Codec::PcmF32,
            endian: Endian::Little,
            sample_rate: 1000,
            channels,
            bits: 32,
            data_offset: 0,
            data_len: len,
        },
    )
}

#[test]
fn find_peak_lands_on_the_loudest_sample() {
    let mut s = vec![0.1f32; 1000];
    s[640] = -0.87;
    let mut r = reader_from(&s, 1);
    let list = identity(1000);
    let (frame, value) =
        edit::analyse::find_peak(&list, &mut r, &mut Rack::new(), Range::new(0, 0))
            .unwrap()
            .unwrap();
    assert_eq!(frame, 640);
    assert!((value - 0.87).abs() < 1e-6, "value {value}");
}

#[test]
fn find_peak_only_looks_inside_the_selection() {
    let mut s = vec![0.1f32; 1000];
    s[640] = 0.87; // outside
    s[200] = 0.4; // inside
    let mut r = reader_from(&s, 1);
    let list = identity(1000);
    let (frame, value) =
        edit::analyse::find_peak(&list, &mut r, &mut Rack::new(), Range::new(100, 300))
            .unwrap()
            .unwrap();
    assert_eq!(frame, 200);
    assert!((value - 0.4).abs() < 1e-6);
}

#[test]
fn find_peak_measures_the_edited_timeline_not_the_file() {
    // The loud sample is cut out, so it must not be found.
    let mut s = vec![0.1f32; 1000];
    s[640] = 0.87;
    let mut r = reader_from(&s, 1);
    let mut list = identity(1000);
    list.cut(Range::new(600, 700));
    let (_, value) = edit::analyse::find_peak(&list, &mut r, &mut Rack::new(), Range::new(0, 0))
        .unwrap()
        .unwrap();
    assert!((value - 0.1).abs() < 1e-6, "still found {value}");
}

#[test]
fn rms_is_measured_across_the_whole_document() {
    // A square wave at 0.5 has an RMS of 0.5.
    let s: Vec<f32> = (0..1000).map(|i| if i % 2 == 0 { 0.5 } else { -0.5 }).collect();
    let mut r = reader_from(&s, 1);
    let list = identity(1000);
    let rms = edit::analyse::measure_rms(&list, &mut r, &mut Rack::new(), Range::new(0, 0)).unwrap();
    assert!((rms - 0.5).abs() < 1e-4, "rms {rms}");
}

#[test]
fn stripping_silence_by_removing_it_shortens_the_document() {
    let mut s = vec![0.5f32; 300];
    s.extend(std::iter::repeat(0.0).take(400));
    s.extend(std::iter::repeat(0.5).take(300));
    let mut r = reader_from(&s, 1);
    let mut list = identity(1000);

    let p = edit::analyse::StripParams {
        threshold_db: -40.0,
        min_frames: 100,
        pad_frames: 0,
        hop: 10,
    };
    let runs =
        edit::analyse::silent_runs(&list, &mut r, &mut Rack::new(), Range::new(0, 0), &p).unwrap();
    assert_eq!(runs.len(), 1, "{runs:?}");

    list.strip_silence(&runs, edit::analyse::StripMode::Remove);
    assert_eq!(list.frames(), 600);
    let out = rendered(&list, &mut r);
    assert!(out.iter().all(|v| (v.abs() - 0.5).abs() < 1e-6), "a gap survived");
}

#[test]
fn stripping_silence_by_flattening_it_keeps_the_timing() {
    let mut s = vec![0.5f32; 300];
    s.extend(std::iter::repeat(0.001).take(400)); // very quiet, not silent
    s.extend(std::iter::repeat(0.5).take(300));
    let mut r = reader_from(&s, 1);
    let mut list = identity(1000);

    let p = edit::analyse::StripParams {
        threshold_db: -40.0,
        min_frames: 100,
        pad_frames: 0,
        hop: 10,
    };
    let runs =
        edit::analyse::silent_runs(&list, &mut r, &mut Rack::new(), Range::new(0, 0), &p).unwrap();
    list.strip_silence(&runs, edit::analyse::StripMode::Silence);

    assert_eq!(list.frames(), 1000, "flattening must not change the length");
    let out = rendered(&list, &mut r);
    for i in 300..700 {
        assert_eq!(out[i], 0.0, "frame {i} was only reduced, not silenced");
    }
    assert!((out[100] - 0.5).abs() < 1e-6, "the loud part must be untouched");
}

#[test]
fn several_runs_are_all_removed_and_none_lands_in_the_wrong_place() {
    // Applying the runs front to back would move every later one; this is the
    // test that catches it.
    let mut s = Vec::new();
    for _ in 0..3 {
        s.extend(std::iter::repeat(0.5f32).take(200));
        s.extend(std::iter::repeat(0.0f32).take(200));
    }
    let mut r = reader_from(&s, 1);
    let mut list = identity(1200);

    let p = edit::analyse::StripParams {
        threshold_db: -40.0,
        min_frames: 100,
        pad_frames: 0,
        hop: 10,
    };
    let runs =
        edit::analyse::silent_runs(&list, &mut r, &mut Rack::new(), Range::new(0, 0), &p).unwrap();
    assert_eq!(runs.len(), 3, "{runs:?}");

    list.strip_silence(&runs, edit::analyse::StripMode::Remove);
    assert_eq!(list.frames(), 600);
    let out = rendered(&list, &mut r);
    assert!(out.iter().all(|v| (v - 0.5).abs() < 1e-6), "silence left behind");
}

#[test]
fn stripping_nothing_leaves_the_document_untouched() {
    let mut list = identity(1000);
    list.strip_silence(&[], edit::analyse::StripMode::Remove);
    assert!(list.is_identity());
}

#[test]
fn repairing_a_click_removes_the_step_it_was_making() {
    // A sine with one sample driven to full scale.
    let mut s: Vec<f32> = (0..1000)
        .map(|i| (i as f32 / 40.0 * std::f32::consts::TAU).sin() * 0.3)
        .collect();
    s[500] = 0.99;
    let mut r = reader_from(&s, 1);

    let list = identity(1000);
    let before =
        edit::analyse::find_click(&list, &mut r, &mut Rack::new(), Range::new(480, 520))
            .unwrap()
            .unwrap();
    assert_eq!(before.0, 500, "the click should be found where it is");

    let mut fixed = identity(1000);
    fixed.repair_click(Range::new(496, 504), 4);
    let after = edit::analyse::find_click(&fixed, &mut r, &mut Rack::new(), Range::new(470, 530))
        .unwrap()
        .unwrap();
    assert!(
        after.1 < before.1 / 10.0,
        "the click is still there: was {:.4}, now {:.4}",
        before.1,
        after.1
    );
}

#[test]
fn repairing_a_click_costs_only_the_frames_it_took_out() {
    let mut list = identity(1000);
    list.repair_click(Range::new(496, 504), 4);
    assert_eq!(list.frames(), 992);
}

#[test]
fn repairing_at_the_very_start_is_not_a_panic() {
    let mut list = identity(1000);
    list.repair_click(Range::new(0, 8), 4);
    assert_eq!(list.frames(), 992);

    let mut list = identity(1000);
    list.repair_click(Range::new(996, 1000), 4);
    assert_eq!(list.frames(), 996);
}

#[test]
fn repairing_nothing_is_inert() {
    let mut list = identity(1000);
    list.repair_click(Range::new(500, 500), 4);
    assert!(list.is_identity());
}

#[test]
fn a_snapped_cut_clicks_far_less_than_an_unsnapped_one() {
    // Snap and the edit engine, together, doing the thing snap exists for.
    let s: Vec<f32> = (0..2000)
        .map(|i| (i as f32 / 100.0 * std::f32::consts::TAU).sin() * 0.8)
        .collect();
    let mut r = reader_from(&s, 1);

    let mut step_after_cutting = |a: u64, b: u64| -> f32 {
        let mut list = identity(2000);
        list.cut(Range::new(a, b));
        let out = render(&list, &mut r, 0, list.frames()).unwrap();
        (out[a as usize] - out[a as usize - 1]).abs()
    };

    // Both edges chosen at a peak of the cycle, and out of phase with each other.
    let (a, b) = (325u64, 1075u64);
    let raw = step_after_cutting(a, b);

    let sa = edit::snap::nearest_zero_crossing(&s, 1, 0, a, 30).unwrap();
    let sb = edit::snap::nearest_zero_crossing(&s, 1, 0, b, 30).unwrap();
    let snapped = step_after_cutting(sa, sb);

    assert!(raw > 1.0, "the unsnapped cut should step badly, stepped {raw:.4}");
    assert!(snapped < raw / 20.0, "snapped {snapped:.4} vs raw {raw:.4}");
}

/// A source that counts how much of the file gets read.
///
/// Timing is the wrong ruler for this — a wall-clock measurement reports the
/// scheduler as often as it reports the code — but the number of bytes pulled
/// off the source is exact, deterministic, and is precisely the quantity that
/// went quadratic.
struct Counting {
    bytes: Vec<u8>,
    reads: std::sync::Arc<std::sync::atomic::AtomicU64>,
}

impl audio_core::RandomAccessSource for Counting {
    fn read_at(&mut self, offset: u64, buf: &mut [u8]) -> std::io::Result<usize> {
        let start = (offset as usize).min(self.bytes.len());
        let n = buf.len().min(self.bytes.len() - start);
        buf[..n].copy_from_slice(&self.bytes[start..start + n]);
        self.reads
            .fetch_add(n as u64, std::sync::atomic::Ordering::Relaxed);
        Ok(n)
    }
    fn len(&self) -> std::io::Result<u64> {
        Ok(self.bytes.len() as u64)
    }
}

#[test]
fn measuring_a_stretched_document_reads_it_once_not_once_per_block() {
    // A stretched timeline is rendered whole and sliced, so a measurement that
    // asked for it a block at a time re-rendered the entire file for every
    // block. On a thirty-second sound at 6× that looked exactly like a hang.
    let frames = 300_000usize;
    let mut bytes = Vec::new();
    for i in 0..frames {
        bytes.extend_from_slice(&((i as f32 / 50.0).sin() * 0.4).to_le_bytes());
    }
    let len = bytes.len() as u64;
    let reads = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let mut r = Reader::new(
        Counting { bytes, reads: reads.clone() },
        AudioInfo {
            container: Container::Raw,
            codec: Codec::PcmF32,
            endian: Endian::Little,
            sample_rate: 44_100,
            channels: 1,
            bits: 32,
            data_offset: 0,
            data_len: len,
        },
    );

    let mut list = EditList::identity(frames as u64, 1, 44_100);
    list.stretch = fx::Stretch { ratio: 6.0, ..fx::Stretch::default() };
    assert!(list.frames() > 1_500_000, "the stretch should have taken effect");

    edit::analyse::measure_level(&list, &mut r, &mut Rack::new(), Range::new(0, 0)).unwrap();

    let read = reads.load(std::sync::atomic::Ordering::Relaxed);
    assert!(
        read < len * 3,
        "read {read} bytes of a {len}-byte file — it is rendering per block again"
    );
}

#[test]
fn a_block_boundary_is_not_reported_as_a_click() {
    // A windowed render resets the rack and gives it a fixed pre-roll, so two
    // blocks rendered independently do not join continuously once anything in
    // the rack has memory. Reading them side by side reported a click at every
    // multiple of the block size, on audio that had none — this file has one
    // real spike, and the detector must find that and not the joins.
    const BLOCK: usize = 65536;
    let frames = BLOCK * 3;
    let mut s: Vec<f32> = (0..frames)
        .map(|i| (i as f32 / 40.0).sin() * 0.3)
        .collect();
    let spike = BLOCK + 12_345;
    s[spike] = 0.95;
    let mut r = reader_from(&s, 1);

    // A compressor is the cheapest thing in the rack with memory.
    let mut rack = Rack::new();
    rack.push(Box::new(fx::Compressor::new(fx::comp::CompSettings {
        threshold_db: -30.0,
        ratio: 8.0,
        attack_ms: 5.0,
        release_ms: 200.0,
        ..fx::comp::CompSettings::default()
    })));
    assert!(!rack.is_empty());

    let list = EditList::identity(frames as u64, 1, 44_100);
    let (at, _) = edit::analyse::find_click(&list, &mut r, &mut rack, Range::new(0, 0))
        .unwrap()
        .unwrap();
    assert!(
        (at as i64 - spike as i64).abs() < 4,
        "found the click at {at}, the real one is at {spike}"
    );
}
