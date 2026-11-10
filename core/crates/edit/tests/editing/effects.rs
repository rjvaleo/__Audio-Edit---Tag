//! Effects in render, and stretching.

use super::*;

// ============================================================ effects in render


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
