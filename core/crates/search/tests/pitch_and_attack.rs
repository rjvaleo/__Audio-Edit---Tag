//! Pitch and attack: the two measurements the 3D browser places sounds by that
//! the fingerprint either lacked or got wrong.
//!
//! Pitch is the note, not the brightness: a bright low synth and a dull high
//! flute must come apart here even where the spectrum's centre says otherwise.
//! Attack is the rise of the first event, not the time to the loudest moment:
//! in a loop the loudest hit can come anywhere, and that says nothing about how
//! the sound starts.

use audio_core::{probe, Reader, SliceSource};
use search::{Fingerprint, NAMES};

const SR: u32 = 48_000;
const TAU: f32 = std::f32::consts::TAU;

/// Minimal 32-bit float WAV.
fn wav(samples: &[f32]) -> Vec<u8> {
    let data: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
    let mut b = Vec::new();
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&((36 + data.len()) as u32).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&3u16.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&SR.to_le_bytes());
    b.extend_from_slice(&(SR * 4).to_le_bytes());
    b.extend_from_slice(&4u16.to_le_bytes());
    b.extend_from_slice(&32u16.to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&(data.len() as u32).to_le_bytes());
    b.extend_from_slice(&data);
    b
}

fn fp(samples: &[f32]) -> Fingerprint {
    let mut src = SliceSource::new(wav(samples));
    let info = probe(&mut src).expect("probe");
    let mut r = Reader::new(src, info);
    Fingerprint::of(&mut r).expect("fingerprint")
}

fn frames(secs: f32) -> usize {
    (SR as f32 * secs) as usize
}

fn tone(hz: f32, secs: f32, amp: f32) -> Vec<f32> {
    (0..frames(secs)).map(|i| (i as f32 * hz * TAU / SR as f32).sin() * amp).collect()
}

/// Twenty harmonics falling as 1/k: rich enough that a detector fooled by the
/// strongest partial, or by the spacing of two of them, picks the wrong octave.
fn saw(hz: f32, secs: f32) -> Vec<f32> {
    (0..frames(secs))
        .map(|i| {
            let t = i as f32 / SR as f32;
            (1..=20).map(|k| (t * hz * k as f32 * TAU).sin() / k as f32).sum::<f32>() * 0.3
        })
        .collect()
}

fn noise(secs: f32, amp: f32) -> Vec<f32> {
    let mut x = 12345u32;
    (0..frames(secs))
        .map(|_| {
            x = x.wrapping_mul(1664525).wrapping_add(1013904223);
            ((x >> 8) as f32 / 8_388_608.0 - 1.0) * amp
        })
        .collect()
}

/// A snare-ish burst: noise, loud at once, gone in a tenth of a second.
fn burst(secs: f32, amp: f32) -> Vec<f32> {
    noise(secs, amp)
        .into_iter()
        .enumerate()
        .map(|(i, s)| s * (-(i as f32) / (SR as f32 * 0.03)).exp())
        .collect()
}

fn silence(secs: f32) -> Vec<f32> {
    vec![0.0; frames(secs)]
}

fn cat(parts: &[Vec<f32>]) -> Vec<f32> {
    parts.concat()
}

fn attack(f: &Fingerprint) -> f32 {
    f.v[NAMES.iter().position(|n| *n == "attack").unwrap()]
}

fn assert_pitch(samples: &[f32], want: f32) {
    let p = fp(samples).pitch;
    assert!(
        (p.hz - want).abs() / want < 0.01,
        "wanted {want} Hz, measured {} Hz (clarity {:.2})",
        p.hz,
        p.clarity
    );
    assert!(p.clarity > 0.8, "a steady tone at {want} Hz is clearly pitched, got {:.2}", p.clarity);
}

// ---------------------------------------------------------------- pitch

#[test]
fn a_sine_is_measured_at_its_frequency() {
    assert_pitch(&tone(110.0, 1.0, 0.5), 110.0);
    assert_pitch(&tone(440.0, 1.0, 0.5), 440.0);
}

#[test]
fn a_harmonic_rich_tone_is_measured_at_its_fundamental_not_an_octave_off() {
    assert_pitch(&saw(220.0, 1.0), 220.0);
    assert_pitch(&saw(82.4, 1.0), 82.4);
}

#[test]
fn the_range_reaches_a_sub_bass_and_a_high_whistle() {
    assert_pitch(&tone(41.2, 1.5, 0.5), 41.2);
    assert_pitch(&tone(1760.0, 1.0, 0.5), 1760.0);
}

#[test]
fn pitch_does_not_depend_on_level() {
    assert_pitch(&tone(330.0, 1.0, 0.01), 330.0);
}

#[test]
fn a_late_start_is_still_measured() {
    assert_pitch(&cat(&[silence(0.8), tone(196.0, 1.0, 0.5), silence(0.5)]), 196.0);
}

#[test]
fn noise_has_no_pitch() {
    let p = fp(&noise(2.0, 0.5)).pitch;
    assert_eq!(p.hz, 0.0, "noise was given {} Hz", p.hz);
    assert!(p.clarity < 0.5, "noise is not pitched, got clarity {:.2}", p.clarity);
}

#[test]
fn a_noise_hit_has_no_pitch() {
    let p = fp(&cat(&[burst(0.3, 0.8), silence(0.2)])).pitch;
    assert_eq!(p.hz, 0.0, "a noise burst was given {} Hz", p.hz);
}

#[test]
fn silence_has_no_pitch() {
    let p = fp(&silence(1.0)).pitch;
    assert_eq!(p.hz, 0.0);
    assert_eq!(p.clarity, 0.0);
}

#[test]
fn a_pitch_is_named_as_a_note() {
    let named = |hz: f32| search::pitch::Pitch { hz, clarity: 1.0 }.note();
    assert_eq!(named(440.0).as_deref(), Some("A4"));
    assert_eq!(named(110.0).as_deref(), Some("A2"));
    assert_eq!(named(261.63).as_deref(), Some("C4"));
    assert_eq!(named(277.18).as_deref(), Some("C#4"));
    assert_eq!(named(0.0), None);
}

// ---------------------------------------------------------------- attack

#[test]
fn a_loop_whose_loudest_hit_comes_late_still_has_a_short_attack() {
    let mut parts = Vec::new();
    for i in 0..6 {
        let amp = if i == 5 { 0.9 } else { 0.4 };
        parts.push(burst(0.5, amp));
    }
    let a = attack(&fp(&cat(&parts)));
    assert!(a < 0.45, "a loop of hits starts sharply, attack read {a:.2}");
}

#[test]
fn a_hit_after_silence_has_a_short_attack() {
    let a = attack(&fp(&cat(&[silence(0.6), burst(0.4, 0.8)])));
    assert!(a < 0.45, "the silence before a hit is not its attack, read {a:.2}");
}

#[test]
fn a_slow_swell_has_a_long_attack() {
    let swell: Vec<f32> = tone(220.0, 2.5, 0.6)
        .into_iter()
        .enumerate()
        .map(|(i, s)| s * (i as f32 / frames(1.5) as f32).min(1.0))
        .collect();
    let a = attack(&fp(&swell));
    assert!(a > 0.9, "a swell over a second and a half, attack read {a:.2}");
}

/// Every file that starts at full level has an attack of nothing, so ties are
/// common. A tie must rank in the middle of its run: at the bottom, the whole
/// run counted as the sharpest fifth of the library at once.
#[test]
fn a_tied_value_ranks_in_the_middle_of_its_run() {
    let at = |v: f32| Fingerprint { v: [v; search::DIMS], pitch: Default::default() };
    let cal = search::Calibration::build([at(0.0), at(0.0), at(0.0), at(0.0), at(0.5), at(1.0)]);
    let r = cal.rank(0, 0.0);
    assert!((r - 2.0 / 6.0).abs() < 1e-6, "four ties at the bottom of six rank {r}");
    assert_eq!(cal.rank(0, -1.0), 0.0);
    assert_eq!(cal.rank(0, 2.0), 1.0);
}

// ---------------------------------------------------------------- store

#[test]
fn the_store_keeps_pitch() {
    let dir = std::env::temp_dir().join("audiolab-search-pitch-test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("FINGERPRINTS.tsv");

    let mut s = search::store::Store::default();
    s.insert("a.wav", fp(&tone(110.0, 1.0, 0.5)));
    s.insert("n.wav", fp(&noise(1.0, 0.5)));
    s.save(&path).unwrap();

    let back = search::store::Store::load(&path);
    let a = back.get("a.wav").unwrap().pitch;
    assert!((a.hz - 110.0).abs() < 1.1, "got {} Hz back", a.hz);
    assert!(a.clarity > 0.8);
    assert_eq!(back.get("n.wav").unwrap().pitch.hz, 0.0);
}
