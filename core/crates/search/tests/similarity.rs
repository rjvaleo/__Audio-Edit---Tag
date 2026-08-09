//! A fingerprint that computes cleanly but ranks nonsense is worse than none,
//! so these tests are about discrimination, not arithmetic.

use audio_core::{probe, SliceSource, Reader};
use search::Fingerprint;

const SR: u32 = 48_000;

/// Minimal 32-bit float WAV.
fn wav(samples: &[f32], channels: u16) -> Vec<u8> {
    let data: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
    let mut b = Vec::new();
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&((36 + data.len()) as u32).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&3u16.to_le_bytes());
    b.extend_from_slice(&channels.to_le_bytes());
    b.extend_from_slice(&SR.to_le_bytes());
    b.extend_from_slice(&(SR * channels as u32 * 4).to_le_bytes());
    b.extend_from_slice(&(channels * 4).to_le_bytes());
    b.extend_from_slice(&32u16.to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&(data.len() as u32).to_le_bytes());
    b.extend_from_slice(&data);
    b
}

fn fp(samples: &[f32]) -> Fingerprint {
    let bytes = wav(samples, 1);
    let mut src = SliceSource::new(bytes);
    let info = probe(&mut src).expect("probe");
    let mut r = Reader::new(src, info);
    Fingerprint::of(&mut r).expect("fingerprint")
}

fn tone(hz: f32, secs: f32, amp: f32) -> Vec<f32> {
    let n = (SR as f32 * secs) as usize;
    (0..n)
        .map(|i| (i as f32 * hz * std::f32::consts::TAU / SR as f32).sin() * amp)
        .collect()
}

fn noise(secs: f32, amp: f32) -> Vec<f32> {
    let n = (SR as f32 * secs) as usize;
    let mut x = 12345u32;
    (0..n)
        .map(|_| {
            x = x.wrapping_mul(1664525).wrapping_add(1013904223);
            ((x >> 8) as f32 / 8_388_608.0 - 1.0) * amp
        })
        .collect()
}

/// A percussive hit: loud immediately, then gone.
fn hit(secs: f32) -> Vec<f32> {
    let n = (SR as f32 * secs) as usize;
    (0..n)
        .map(|i| {
            let env = (-(i as f32) / (SR as f32 * 0.03)).exp();
            (i as f32 * 90.0 * std::f32::consts::TAU / SR as f32).sin() * env
        })
        .collect()
}

#[test]
fn a_sound_is_identical_to_itself() {
    let a = fp(&tone(440.0, 1.0, 0.5));
    assert_eq!(a.distance(&a), 0.0);
    assert_eq!(a.similarity(&a), 1.0);
}

#[test]
fn two_takes_of_the_same_kind_of_sound_rank_above_a_different_kind() {
    let quiet_tone = fp(&tone(440.0, 1.0, 0.5));
    let same_again = fp(&tone(450.0, 1.0, 0.48));
    let hiss = fp(&noise(1.0, 0.5));

    assert!(
        quiet_tone.similarity(&same_again) > quiet_tone.similarity(&hiss),
        "a near-identical tone ({:.3}) must beat noise ({:.3})",
        quiet_tone.similarity(&same_again),
        quiet_tone.similarity(&hiss)
    );
}

#[test]
fn brightness_separates_a_low_tone_from_a_high_one() {
    let low = fp(&tone(80.0, 1.0, 0.5));
    let high = fp(&tone(6000.0, 1.0, 0.5));
    let alsolow = fp(&tone(95.0, 1.0, 0.5));

    assert!(low.similarity(&alsolow) > low.similarity(&high));
    // And the reason given is the brightness, not something incidental.
    let worst = low.largest_differences(&high)[0].0;
    assert!(
        ["brightness", "rolloff", "high", "low"].contains(&worst),
        "expected a spectral reason, got {worst}"
    );
}

#[test]
fn a_percussive_hit_is_not_mistaken_for_a_sustained_tone() {
    let kick = fp(&hit(0.4));
    let kick2 = fp(&hit(0.45));
    let drone = fp(&tone(90.0, 4.0, 0.5));

    assert!(
        kick.similarity(&kick2) > kick.similarity(&drone),
        "two hits ({:.3}) must beat a drone at the same pitch ({:.3})",
        kick.similarity(&kick2),
        kick.similarity(&drone)
    );
}

#[test]
fn ranking_puts_the_closest_first_and_drops_the_query_itself() {
    let q = fp(&tone(440.0, 1.0, 0.5));
    let lib = vec![
        ("me.wav", q),
        ("noise.wav", fp(&noise(1.0, 0.5))),
        ("close.wav", fp(&tone(455.0, 1.0, 0.5))),
        ("kick.wav", fp(&hit(0.4))),
    ];
    let out = search::rank(&q, lib, "me.wav", 10);

    assert_eq!(out.len(), 3, "the query itself must not be suggested");
    assert_eq!(out[0].0, "close.wav", "got {out:?}");
    for w in out.windows(2) {
        assert!(w[0].1 >= w[1].1, "not sorted: {out:?}");
    }
}

#[test]
fn every_dimension_stays_inside_its_range() {
    for s in [tone(20.0, 0.02, 1.0), noise(3.0, 1.0), vec![0.0; 480], hit(0.1)] {
        for (i, v) in fp(&s).v.iter().enumerate() {
            assert!(v.is_finite(), "dimension {i} is not finite");
            assert!((0.0..=1.0).contains(v), "dimension {i} out of range: {v}");
        }
    }
}

#[test]
fn the_store_survives_a_round_trip_and_a_truncated_row() {
    let dir = std::env::temp_dir().join("audiolab-search-test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("FINGERPRINTS.tsv");

    let mut s = search::store::Store::default();
    s.insert("a.wav", fp(&tone(440.0, 0.5, 0.5)));
    s.insert("b.wav", fp(&noise(0.5, 0.5)));
    s.save(&path).unwrap();

    let back = search::store::Store::load(&path);
    assert_eq!(back.len(), 2);
    let a = back.get("a.wav").unwrap();
    for (x, y) in a.v.iter().zip(s.get("a.wav").unwrap().v.iter()) {
        assert!((x - y).abs() < 1e-4, "{x} vs {y}");
    }

    // A half-written final line is padded, not dropped — the same treatment
    // the audio index gives one.
    let text = std::fs::read_to_string(&path).unwrap();
    std::fs::write(&path, format!("{text}c.wav\t0.5\t0.25")).unwrap();
    assert_eq!(search::store::Store::load(&path).len(), 3);

    std::fs::remove_dir_all(&dir).ok();
}
