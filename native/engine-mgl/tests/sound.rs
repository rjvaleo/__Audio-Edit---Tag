//! The Sound module's document: a file, MGL's edit list for it, and the
//! edited sound in the two forms the engine plays.

mod common;
use common::*;
use audio_core::{Codec, Reader, SliceSource};
use engine_core::basics::{Player, SoundSource};
use engine_core::*;
use engine_mgl::grain::{self, Grain};
use engine_mgl::Document;
use mgl_edit::{EditList, Range};
use mgl_engine::{conform_channels, resample, Core, GrainKeys, Shared};
use std::sync::Arc;

const FILE_RATE: u32 = 44_100;
const FRAMES: usize = 22_050;
const SOURCE: ModuleId = 1;
const PLAYER: ModuleId = 2;

/// A WAV file in memory: 16-bit, at 44.1 kHz, a different tone on each side
/// (or one channel).
fn wav(channels: u16) -> Vec<u8> {
    let mut data = Vec::with_capacity(FRAMES * channels as usize * 2);
    for i in 0..FRAMES {
        let t = i as f32 / FILE_RATE as f32;
        let fade = 1.0 - i as f32 / FRAMES as f32;
        for ch in 0..channels {
            let hz = if ch == 0 { 220.0 } else { 331.0 };
            let v = (std::f32::consts::TAU * hz * t).sin() * 0.6 * fade;
            data.extend_from_slice(&((v * 32_767.0) as i16).to_le_bytes());
        }
    }
    let mut file = audio_core::wav::header(data.len() as u64, channels, FILE_RATE, Codec::PcmI16).to_vec();
    file.extend_from_slice(&data);
    file
}

fn open(channels: u16) -> Document<SliceSource<Vec<u8>>> {
    Document::open(SliceSource::new(wav(channels)), RATE as u32).expect("a WAV file")
}

/// A few of MGL's edits: keep the middle, turn part of it round, pull part
/// of it down, fade the end.
fn edits(list: &mut EditList) {
    list.crop(Range::new(2_000, 20_000));
    list.reverse(Range::new(3_000, 9_000));
    list.gain_db(Range::new(0, 4_000), -6.0);
    list.fade_out(Range::new(0, 18_000), 2_000, mgl_edit::FadeShape::Linear);
}

/// What MGL's server hands its engine for the same file and edits
/// (`server/src/live.rs`): the list's clips rendered, resampled to the
/// engine's rate, then laid out in two channels.
fn as_mgl_loads_it(channels: u16, change: impl FnOnce(&mut EditList)) -> Vec<f32> {
    let mut src = SliceSource::new(wav(channels));
    let info = audio_core::probe(&mut src).unwrap();
    let mut list = EditList::identity(info.frames(), info.channels, info.sample_rate);
    change(&mut list);
    let mut reader = Reader::new(src, info);
    let samples = mgl_edit::render::render(&list, &mut reader, 0, list.base_frames()).unwrap();
    let samples = resample(&samples, channels as usize, info.sample_rate, RATE as u32);
    conform_channels(&samples, channels as usize, 2)
}

#[test]
fn the_document_gives_a_deck_what_mgl_gives_its_engine() {
    for channels in [2u16, 1] {
        let mut doc = open(channels);
        let plain = doc.source().unwrap();
        assert_eq!(plain.channels, 2);
        // 22,050 frames at 44.1 kHz are half a second: 24,000 at 48 kHz.
        assert_eq!(plain.frames(), 24_000, "{channels} channels: at the engine's rate");
        assert_same("unedited", &plain.samples, &as_mgl_loads_it(channels, |_| {}));
        assert!(doc.edit(edits));
        let edited = doc.source().unwrap();
        assert_same("edited", &edited.samples, &as_mgl_loads_it(channels, edits));
        assert!(first_difference(&edited.samples, &plain.samples).is_some(), "the edits are heard");
        if channels == 1 {
            assert!(edited.samples.chunks_exact(2).all(|f| f[0] == f[1]), "one channel plays on both sides");
        }
    }
}

#[test]
fn undo_redo_and_revert_give_back_the_same_samples() {
    let mut doc = open(2);
    let plain = doc.source().unwrap();
    doc.edit(edits);
    let edited = doc.source().unwrap();
    assert!(doc.undo());
    assert_same("undone", &doc.source().unwrap().samples, &plain.samples);
    assert!(doc.redo());
    assert_same("redone", &doc.source().unwrap().samples, &edited.samples);
    doc.revert();
    assert_same("reverted", &doc.source().unwrap().samples, &plain.samples);
    // In MGL going back to the file is a step like any other: it can be undone.
    assert!(doc.list().is_identity());
    assert!(doc.undo());
    assert_same("the revert undone", &doc.source().unwrap().samples, &edited.samples);
}

fn planar(interleaved: &[f32]) -> (Vec<f32>, Vec<f32>) {
    (interleaved.iter().step_by(2).copied().collect(), interleaved.iter().skip(1).step_by(2).copied().collect())
}

/// The Sound module's cable points a player at the document's sound; an
/// edit is rendered on the app's thread, loaded into the bank and takes over
/// on its sample; the sound it replaces comes back to be freed.
#[test]
fn an_edit_reaches_the_patch_on_its_sample() {
    let mut doc = open(2);
    let (mut ctl, mut audio) = engine(RATE, exact());
    let first = ctl.load_sound(1, doc.sound().unwrap()).unwrap();
    ctl.add(SOURCE, Box::new(SoundSource::new())).unwrap();
    ctl.send(SOURCE, EventKind::Sound { slot: 0, sound: first }).unwrap();
    ctl.add(PLAYER, Box::new(Player::new(1.0))).unwrap();
    ctl.connect(port(SOURCE, 0), port(PLAYER, 0)).unwrap();
    ctl.connect_out(port(PLAYER, 0)).unwrap();
    ctl.commit().unwrap();

    let (plain_l, plain_r) = planar(&doc.source().unwrap().samples);
    doc.edit(edits);
    let (edit_l, edit_r) = planar(&doc.source().unwrap().samples);
    // The edit lands on sample 5,000: the new sound is loaded for then, and
    // the Sound module's cable carries its new version from then.
    let second = ctl.load_sound_at(5_000, 1, doc.sound().unwrap()).unwrap();
    ctl.send_at(5_000, SOURCE, EventKind::Sound { slot: 0, sound: second }).unwrap();
    let (l, r) = render(&mut audio, 12_000, 128);
    assert_same("left before the edit", &l[..5_000], &plain_l[..5_000]);
    assert_same("right before the edit", &r[..5_000], &plain_r[..5_000]);
    // The player starts a new sound from its beginning.
    assert_same("left after the edit", &l[5_000..], &edit_l[..7_000]);
    assert_same("right after the edit", &r[5_000..], &edit_r[..7_000]);
    assert_eq!(ctl.collect().sounds, 1, "the unedited sound came back to be freed");
}

/// The document feeds a grain deck: its sound and the settings its stretch
/// asks for, the same as MGL's deck given them directly.
#[test]
fn the_document_feeds_a_grain_deck() {
    let mut doc = open(2);
    doc.edit(edits);
    doc.edit(|list| list.stretch.ratio = 1.5);
    let source = doc.source().unwrap();
    let params = doc.params(&source);
    assert_eq!(params.in_frames, source.frames());
    assert_eq!(params.sample_rate, RATE as u32);
    assert_eq!(params.ratio, 1.5);

    let frames = 20_000;
    let grid = 128;
    let shared = Shared::new(params, Arc::clone(&source));
    let keys = Arc::new(GrainKeys::new());
    keys.set_run(true);
    let mut core = Core::new(grid, 2, params, Arc::clone(&source)).with_keys(keys);
    shared.play();
    let mut want = Vec::new();
    let mut buf = vec![0f32; grid * 2];
    while want.len() < frames * 2 {
        core.fill(&mut buf, 2, &shared);
        want.extend_from_slice(&buf);
    }
    want.truncate(frames * 2);
    assert!(peak(&want) > 0.01, "the deck plays the document");

    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Grain::new(RATE as u32, grid, params, source))).unwrap();
    ctl.send(1, EventKind::Param { index: grain::RUN, value: 1.0 }).unwrap();
    ctl.send(1, EventKind::Param { index: grain::PLAY, value: 1.0 }).unwrap();
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit().unwrap();
    let (l, r) = render(&mut audio, frames, 128);
    let got: Vec<f32> = l.iter().zip(&r).flat_map(|(a, b)| [*a, *b]).collect();
    assert_same("the deck fed by the document", &got, &want);
}

#[test]
fn the_bank_from_a_timeline_rendered_once_is_the_bank_rendered_again() {
    // The Sound module renders the edited timeline once, for the Edit page's
    // samples, and hands that to the bank; it must be what `sound` renders.
    for channels in [1, 2] {
        let mut doc = open(channels);
        doc.edit(edits);
        let list = doc.list().clone();
        let mut reader = Reader::new(SliceSource::new(wav(channels)), audio_core::probe(&mut SliceSource::new(wav(channels))).unwrap());
        let timeline = mgl_edit::render::render(&list, &mut reader, 0, list.base_frames()).unwrap();
        let once = doc.sound_from(&timeline);
        let again = doc.sound().unwrap();
        assert_same("left", &once.l, &again.l);
        assert_same("right", &once.r, &again.r);
    }
}
