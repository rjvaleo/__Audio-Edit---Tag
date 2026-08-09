//! Validation against sounds whose answer is already known.
//!
//! This is the test that decides whether any of the rest is worth trusting. A
//! classifier that has been wired up wrongly does not fail loudly — it returns
//! 521 confident-looking numbers that mean nothing. The only way to tell the
//! difference is to hand it files where the right answer is known in advance
//! and check what comes back.
//!
//! The library's own filenames supply that ground truth. The model never sees
//! them: it is given decoded samples and nothing else. So when a file called
//! `snare 1.wav` comes back as a snare drum, that is the audio path working
//! end to end — decode, mono, band-limited resample, presentation, inference,
//! label policy — and not a filename leaking through.

use std::path::PathBuf;

fn library(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../Audio Library/Even More Da Heat")
        .join(name)
}

fn mono(name: &str) -> Vec<f32> {
    let path = library(name);
    let mut r = audio_core::open(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let info = *r.info();
    let samples = r.read_frames(0, info.frames()).expect("read");
    yamnet::to_mono_16k(&samples, info.channels as usize, info.sample_rate)
}

fn model() -> yamnet::Model {
    yamnet::Model::load_default().expect("the model ships in models/ beside the app")
}

fn words(top: &[yamnet::Detection]) -> String {
    top.iter().map(|d| format!("{} {:.2}", d.label, d.score)).collect::<Vec<_>>().join(", ")
}

/// Any label that puts the sound in the drum family.
fn drummy(top: &[yamnet::Detection]) -> bool {
    top.iter().any(|d| {
        let l = d.label.to_lowercase();
        l.contains("drum") || l.contains("percussion") || l.contains("snare")
    })
}

#[test]
fn snares_are_heard_as_drums_from_the_audio_alone() {
    let m = model();
    for name in ["snare 1.wav", "snare 3.wav", "snare 4.wav"] {
        let top = m.label(&mono(name), 4).expect("inference");
        assert!(drummy(&top), "{name} came back as: {}", words(&top));
    }
}

#[test]
fn at_least_one_snare_is_named_exactly() {
    // Not every one of them: a 100 ms hit is genuinely hard, and claiming
    // otherwise would make this test a lie. But if none of five snares is ever
    // called a snare, the model is not earning its place.
    let m = model();
    let named = ["snare 1.wav", "snare 3.wav", "snare 4.wav"].iter().any(|n| {
        m.label(&mono(n), 5)
            .map(|t| t.iter().any(|d| d.label == "Snare drum"))
            .unwrap_or(false)
    });
    assert!(named, "no snare in the library was identified as a snare drum");
}

#[test]
fn a_909_kick_is_heard_as_a_drum_machine() {
    let m = model();
    let top = m.label(&mono("kick 909 1?.wav"), 4).expect("inference");
    assert!(drummy(&top), "the kick came back as: {}", words(&top));
}

#[test]
fn a_piano_loop_is_heard_as_a_piano() {
    let m = model();
    let top = m.label(&mono("jazz loop.wav"), 4).expect("inference");
    let l: Vec<&str> = top.iter().map(|d| d.label.as_str()).collect();
    assert!(
        l.iter().any(|n| n.contains("Piano") || n.contains("Keyboard")),
        "the jazz loop came back as: {}",
        words(&top)
    );
}

/// The presentation step is load-bearing, and this proves it rather than
/// asserting it in a comment.
#[test]
fn presentation_is_what_makes_a_short_one_shot_work() {
    let m = model();
    let s = mono("snare 3.wav");

    let raw = m.label_raw(&s, 4).expect("inference");
    let shown = m.label(&s, 4).expect("inference");

    assert!(!drummy(&raw), "raw got it right, so this test proves nothing: {}", words(&raw));
    assert!(drummy(&shown), "presented, it should be a drum: {}", words(&shown));
}

#[test]
fn the_vague_label_is_kept_off_a_sound_that_has_a_real_one() {
    let m = model();
    let top = m.label(&mono("snare 1.wav"), 4).expect("inference");
    assert!(
        !top.iter().any(|d| d.label == "Music"),
        "\"Music\" should not survive next to a specific label: {}",
        words(&top)
    );
}
