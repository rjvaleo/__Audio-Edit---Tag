use super::*;

#[test]
fn a_table_wav_reads_back_as_it_was_written() {
    let frames: Vec<Vec<f32>> = (0..3).map(|f| (0..256).map(|i| ((i + f) as f32 / 50.0).sin()).collect()).collect();
    let back = read_table_wav(&table_wav(&frames)).unwrap();
    assert_eq!(back, frames);
}

#[test]
fn a_long_sound_gives_cycle_windows_from_start_to_end() {
    let s: Vec<f32> = (0..CYCLE * 10).map(|i| i as f32).collect();
    let f = slice(&s, 4).unwrap();
    assert_eq!(f.len(), 4);
    assert!(f.iter().all(|x| x.len() == CYCLE));
    assert_eq!(f[0][0], 0.0);
    assert_eq!(*f[3].last().unwrap(), (CYCLE * 10 - 1) as f32);
}

#[test]
fn a_short_sound_is_cut_into_pieces_of_at_least_64() {
    let s = vec![0.5f32; 1000];
    let f = slice(&s, 64).unwrap();
    assert_eq!(f.len(), 1000 / 64);
    assert!(f.iter().all(|x| x.len() >= 64));
    assert!(slice(&[0.0; 10], 4).is_none());
}

#[test]
fn previews_are_normalised_and_the_right_size() {
    let frames = vec![(0..2048).map(|i| 0.5 + 0.25 * (i as f32 / 2048.0 * std::f32::consts::TAU).sin()).collect()];
    let p = preview(&frames, 256);
    assert_eq!(p[0].len(), 256);
    let peak = p[0].iter().fold(0.0f32, |m, v| m.max(v.abs()));
    assert!((peak - 1.0).abs() < 1e-3);
    assert!(p[0][0].abs() < 1e-3, "DC is removed");
}
