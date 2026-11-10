//! AIFF export, and copy and paste.

use super::*;

// ------------------------------------------------------------ AIFF export

/// The whole point of writing our own AIFF: that we can read it again.
///
/// Byte order is the trap. A file written little-endian behind a big-endian
/// header does not fail to open — it opens and is loud noise, which is the
/// sort of mistake that reaches a listener rather than a compiler.
fn export_aiff(list: &EditList, r: &mut Reader<SliceSource<Vec<u8>>>, bits: u16,
               meta: &audio_core::aiff::Meta) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    edit::render::render_to_aiff_fx(list, r, &mut Rack::new(), &mut out, bits, meta).unwrap();
    out
}

#[test]
fn an_exported_aiff_reads_back_as_the_same_audio() {
    for bits in [16u16, 24, 32] {
        let source: Vec<f32> = (0..2000)
            .map(|i| (i as f32 / 40.0).sin() * 0.8)
            .collect();
        let mut r = reader_from(&source, 1);
        let list = EditList::identity(2000, 1, 44_100);
        let bytes = export_aiff(&list, &mut r, bits, &audio_core::aiff::Meta::default());

        let mut src = SliceSource::new(bytes);
        let info = audio_core::probe(&mut src).expect("our own reader could not open it");
        assert_eq!(info.sample_rate, 44_100, "{bits}-bit: the rate did not survive");
        assert_eq!(info.channels, 1, "{bits}-bit: the channel count did not survive");
        assert_eq!(info.bits, bits, "{bits}-bit: the depth did not survive");
        assert_eq!(info.frames(), 2000, "{bits}-bit: the length did not survive");

        let mut back = Reader::new(src, info);
        let read = back.read_frames(0, 2000).unwrap();
        // 16-bit quantising is the coarsest of the three.
        let tol = if bits == 16 { 1e-4 } else { 1e-6 };
        let worst = source
            .iter()
            .zip(&read)
            .map(|(a, b)| (a - b).abs())
            .fold(0f32, f32::max);
        assert!(worst < tol, "{bits}-bit: the samples came back {worst:.2e} out");
    }
}

#[test]
fn a_stereo_export_keeps_its_channels_the_right_way_round() {
    // Interleaving and byte order can each be wrong on their own.
    let mut samples = Vec::new();
    for i in 0..1000 {
        samples.push((i as f32 / 50.0).sin() * 0.7);
        samples.push(-0.25);
    }
    let mut r = reader_from(&samples, 2);
    let list = EditList::identity(1000, 2, 48_000);
    let bytes = export_aiff(&list, &mut r, 24, &audio_core::aiff::Meta::default());

    let mut src = SliceSource::new(bytes);
    let info = audio_core::probe(&mut src).unwrap();
    assert_eq!(info.channels, 2);
    let mut back = Reader::new(src, info);
    let read = back.read_frames(0, 1000).unwrap();
    for f in 0..1000 {
        assert!((read[f * 2 + 1] + 0.25).abs() < 1e-6, "the right channel is wrong at {f}");
    }
    // Frame 50's left channel sits at index 100 in both, interleaved by two.
    assert!((read[100] - samples[100]).abs() < 1e-6, "the left channel is wrong");
    assert!((read[600] - samples[600]).abs() < 1e-6, "the left channel drifts");
}

#[test]
fn the_settings_do_not_stop_the_file_opening() {
    // Every reader must skip the chunks it does not know. Ours is the one that
    // has to, because these files go straight back into the library.
    let source = vec![0.3f32; 500];
    let mut r = reader_from(&source, 1);
    let list = EditList::identity(500, 1, 44_100);
    let meta = audio_core::aiff::Meta {
        name: Some("kick 1.wav".into()),
        annotation: Some("Audio Edit & Tag — wsola at 1.00x".into()),
        settings: Some("{\"app\":\"Audio Edit & Tag\",\"version\":1}".into()),
    };
    let bytes = export_aiff(&list, &mut r, 24, &meta);

    // The settings really are in there, behind the signature.
    let at = bytes.windows(4).position(|w| w == b"APPL").expect("no APPL chunk");
    assert_eq!(&bytes[at + 8..at + 12], b"AuLb");
    assert!(
        String::from_utf8_lossy(&bytes[at..]).contains("\"version\":1"),
        "the settings are not in the file"
    );

    let mut src = SliceSource::new(bytes);
    let info = audio_core::probe(&mut src).expect("the metadata broke the file");
    assert_eq!(info.frames(), 500);
    let mut back = Reader::new(src, info);
    let read = back.read_frames(0, 500).unwrap();
    assert!((read[250] - 0.3).abs() < 1e-6, "the samples moved");
}

#[test]
fn an_odd_number_of_bytes_still_leaves_a_well_formed_file() {
    // 24-bit mono at an odd frame count: the sound data is an odd length and
    // needs a pad byte the header has already accounted for.
    let source = vec![0.5f32; 333];
    let mut r = reader_from(&source, 1);
    let list = EditList::identity(333, 1, 44_100);
    let bytes = export_aiff(&list, &mut r, 24, &audio_core::aiff::Meta::default());

    let form = u32::from_be_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize;
    assert_eq!(form + 8, bytes.len(), "FORM's size disagrees with the file");
    assert_eq!(bytes.len() % 2, 0, "the file ends misaligned");

    let mut src = SliceSource::new(bytes);
    let info = audio_core::probe(&mut src).unwrap();
    assert_eq!(info.frames(), 333);
}

// ── copy and paste ───────────────────────────────────────────────────────────

#[test]
fn copying_leaves_the_document_as_it_was() {
    let list = identity(100);
    let clips = list.copy(Range::new(20, 30));
    assert_eq!(clips.iter().map(|c| c.len).sum::<u64>(), 10);
    assert!(list.is_identity(), "copy changed the document");
}

#[test]
fn pasting_at_a_point_inserts_the_copy_there() {
    let mut r = ramp_reader(100, 1);
    let mut list = identity(100);
    let clips = list.copy(Range::new(20, 30));
    list.paste(50, None, &clips);

    assert_eq!(list.frames(), 110);
    let out = rendered(&list, &mut r);
    // Frame 49, then the copy of 20..30, then frame 50 again.
    assert!((out[49] - 0.049).abs() < 1e-6);
    assert!((out[50] - 0.020).abs() < 1e-6);
    assert!((out[59] - 0.029).abs() < 1e-6);
    assert!((out[60] - 0.050).abs() < 1e-6);
}

#[test]
fn pasting_over_a_selection_replaces_it() {
    let mut r = ramp_reader(100, 1);
    let mut list = identity(100);
    let clips = list.copy(Range::new(0, 5));
    list.paste(40, Some(Range::new(40, 60)), &clips);

    assert_eq!(list.frames(), 85);
    let out = rendered(&list, &mut r);
    assert!((out[39] - 0.039).abs() < 1e-6);
    assert!((out[40] - 0.000).abs() < 1e-6);
    assert!((out[44] - 0.004).abs() < 1e-6);
    assert!((out[45] - 0.060).abs() < 1e-6);
}

#[test]
fn a_copy_keeps_what_was_done_to_it() {
    // Reversed material pastes reversed: the copy is of what you hear.
    let mut r = ramp_reader(100, 1);
    let mut list = identity(100);
    list.reverse(Range::new(10, 20));
    let clips = list.copy(Range::new(10, 20));
    list.paste(100, None, &clips);

    assert_eq!(list.frames(), 110);
    let out = rendered(&list, &mut r);
    assert!((out[100] - 0.019).abs() < 1e-6);
    assert!((out[109] - 0.010).abs() < 1e-6);
}

#[test]
fn pasting_past_the_end_lands_at_the_end() {
    let mut list = identity(100);
    let clips = list.copy(Range::new(0, 10));
    list.paste(5000, None, &clips);
    assert_eq!(list.frames(), 110);
}
