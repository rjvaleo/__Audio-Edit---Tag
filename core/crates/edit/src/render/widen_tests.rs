use super::*;

/// A mono file played through this program is not a mono sound.
///
/// The transport runs at the *device's* channel count, so the grain
/// engine's pan, the rack's reverbs and the spatialisation are all working
/// in stereo before anything reaches the speakers. Rendering at the file's
/// own width discarded every one of them: `pan_gains` returns (1, 1) below
/// two channels, so the grains did not move at all and the export was mono
/// while the room drew a PAN column and the speakers played a stereo field.
#[test]
fn a_mono_signal_is_laid_across_both_channels() {
    let mono = vec![0.25, -0.5, 0.75];
    let wide = widen(&mono, 1, 2);
    assert_eq!(wide, vec![0.25, 0.25, -0.5, -0.5, 0.75, 0.75]);
}

/// Not halved on the way. What follows is about to *give* this a stereo
/// field; arriving quieter than it was auditioned would be a second fault
/// dressed as gain staging.
#[test]
fn widening_does_not_change_the_level() {
    let mono = vec![1.0, -1.0];
    let wide = widen(&mono, 1, 2);
    assert!(wide.iter().all(|v| v.abs() == 1.0), "the level moved: {wide:?}");
}

/// Already wide enough is left alone, and asking for narrower does not
/// silently throw a channel away.
#[test]
fn nothing_happens_when_there_is_nothing_to_widen() {
    let stereo = vec![0.1, 0.2, 0.3, 0.4];
    assert_eq!(widen(&stereo, 2, 2), stereo);
    assert_eq!(widen(&stereo, 2, 1), stereo);
}

/// Beyond what the file has, the last channel repeats — so a stereo file in
/// a wider document does not leave silent channels in the middle.
#[test]
fn past_the_end_the_last_channel_repeats() {
    let stereo = vec![0.1, 0.2];
    assert_eq!(widen(&stereo, 2, 3), vec![0.1, 0.2, 0.2]);
}
