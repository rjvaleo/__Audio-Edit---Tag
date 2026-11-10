//! The Peak edits: measuring, stripping, repairing.

use super::*;

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
pub(super) fn reader_from(samples: &[f32], channels: u16) -> Reader<SliceSource<Vec<u8>>> {
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
