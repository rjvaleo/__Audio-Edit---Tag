//! Identity, cut, silence, gain, fades, reverse, normalize, channels, sessions and export.

use super::*;

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
