//! The sound map. Where a sound lands is the map's whole meaning — near means
//! "the model hears these as alike" — so it is tested on fingerprints built by
//! hand, in groups whose answer is known, rather than trusted to look right.

use search::soundmap::{build, build_with, Embedding, Input};

/// A fingerprint near direction `g`: mostly that group's own dimensions, a
/// little of everything else, different for each member.
fn fp(g: usize, k: usize) -> Vec<f32> {
    let mut v = vec![0.02f32; 64];
    for d in 0..8 {
        v[g * 8 + d] = 1.0 + ((k * 7 + d * 3) % 5) as f32 * 0.1;
    }
    v[(k * 11) % 64] += 0.3;
    v
}

fn input(g: usize, k: usize, label: &str, family: &str) -> Input {
    Input { embedding: Some(Embedding::from_values(&fp(g, k))), heard: vec![label.to_string()], family: family.to_string(), words: vec![] }
}

/// Three kinds of sound, twelve of each.
fn library() -> Vec<Input> {
    let mut v = Vec::new();
    for k in 0..12 {
        v.push(input(0, k, "Snare drum", "percussion"));
        v.push(input(1, k, "Speech", "voice"));
        v.push(input(2, k, "Piano", "instrument"));
    }
    v
}

fn d(a: [f32; 2], b: [f32; 2]) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt()
}

#[test]
fn every_heard_sound_is_placed_inside_the_unit_square() {
    let m = build(&library());
    assert_eq!(m.points.len(), 36);
    for p in &m.points {
        let at = p.at.expect("placed");
        assert!((0.0..=1.0).contains(&at[0]) && (0.0..=1.0).contains(&at[1]), "{at:?}");
    }
}

#[test]
fn the_dots_next_to_a_sound_are_its_own_kind() {
    // What a map is for: the sounds beside the one under the pointer are like it.
    let m = build(&library());
    let at: Vec<[f32; 2]> = m.points.iter().map(|p| p.at.unwrap()).collect();
    let mut right = 0;
    for i in 0..at.len() {
        let mut by: Vec<usize> = (0..at.len()).filter(|&j| j != i).collect();
        by.sort_by(|&p, &q| d(at[i], at[p]).total_cmp(&d(at[i], at[q])));
        right += by.iter().take(3).filter(|&&j| j % 3 == i % 3).count();
    }
    assert!(right as f32 >= at.len() as f32 * 3.0 * 0.95, "{right} of {} neighbours were the same kind", at.len() * 3);
}

#[test]
fn each_kind_is_a_cluster_named_for_what_it_was_heard_as() {
    let m = build(&library());
    assert_eq!(m.clusters.len(), 3, "{:?}", m.clusters.iter().map(|c| (&c.name, c.members.len())).collect::<Vec<_>>());
    let mut names: Vec<&str> = m.clusters.iter().map(|c| c.name.as_str()).collect();
    names.sort();
    assert_eq!(names, vec!["Piano", "Snare drum", "Speech"]);
    for c in &m.clusters {
        let kind = c.members[0] % 3;
        assert!(c.members.iter().all(|i| i % 3 == kind), "{} mixes kinds", c.name);
        assert!(c.members.iter().all(|&i| m.points[i].cluster.map(|x| &m.clusters[x].name) == Some(&c.name)));
    }
    let snare = m.clusters.iter().find(|c| c.name == "Snare drum").unwrap();
    assert_eq!(snare.family, "percussion");
}

#[test]
fn a_sound_s_closest_matches_are_its_own_kind_best_first() {
    let m = build(&library());
    for (i, p) in m.points.iter().enumerate() {
        assert_eq!(p.near.len(), search::soundmap::NEAR);
        assert!(!p.near.contains(&i));
        assert!(p.near.iter().all(|j| j % 3 == i % 3), "sound {i}: {:?}", p.near);
    }
}

#[test]
fn two_clusters_heard_as_the_same_thing_get_different_names() {
    let mut lib = Vec::new();
    for k in 0..10 {
        lib.push(Input { embedding: Some(Embedding::from_values(&fp(0, k))), heard: vec!["Percussion".into(), "Drum machine".into()], family: "percussion".into(), words: vec![] });
        lib.push(Input { embedding: Some(Embedding::from_values(&fp(4, k))), heard: vec!["Percussion".into(), "Cymbal".into()], family: "percussion".into(), words: vec![] });
    }
    let m = build(&lib);
    assert_eq!(m.clusters.len(), 2);
    assert_ne!(m.clusters[0].name, m.clusters[1].name);
    assert!(m.clusters.iter().all(|c| c.name.starts_with("Percussion")));
}

#[test]
fn a_sound_not_yet_listened_to_has_no_place_and_is_nobody_s_match() {
    let mut lib = library();
    lib[5].embedding = None;
    let m = build(&lib);
    assert_eq!(m.points[5].at, None);
    assert_eq!(m.points[5].cluster, None);
    assert!(m.points.iter().all(|p| !p.near.contains(&5)));
}

#[test]
fn the_same_library_makes_the_same_map() {
    let lib = library();
    assert_eq!(build(&lib), build(&lib));
}

#[test]
fn an_empty_or_tiny_library_does_not_fall_over() {
    assert!(build(&[]).points.is_empty());
    let one = build(&[input(0, 0, "Speech", "voice")]);
    assert!(one.points[0].at.is_some());
    assert!(one.clusters.is_empty());
}

#[test]
fn clusters_nobody_named_are_called_by_how_they_sound() {
    let mut lib = Vec::new();
    for k in 0..10 {
        lib.push(Input { embedding: Some(Embedding::from_values(&fp(0, k))), heard: vec![], family: "unknown".into(), words: vec!["bassy".into(), "short".into()] });
        lib.push(Input { embedding: Some(Embedding::from_values(&fp(4, k))), heard: vec!["Speech".into()], family: "voice".into(), words: vec!["bright".into()] });
    }
    let m = build(&lib);
    let mut names: Vec<&str> = m.clusters.iter().map(|c| c.name.as_str()).collect();
    names.sort();
    assert_eq!(names, vec!["Speech", "bassy, short"]);
}

#[test]
fn a_shared_name_falls_back_to_how_the_sounds_sound() {
    let mut lib = Vec::new();
    for k in 0..10 {
        lib.push(Input { embedding: Some(Embedding::from_values(&fp(0, k))), heard: vec!["Percussion".into()], family: "percussion".into(), words: vec!["dark".into()] });
        lib.push(Input { embedding: Some(Embedding::from_values(&fp(4, k))), heard: vec!["Percussion".into()], family: "percussion".into(), words: vec!["bright".into()] });
    }
    let m = build(&lib);
    let mut names: Vec<&str> = m.clusters.iter().map(|c| c.name.as_str()).collect();
    names.sort();
    assert!(names == vec!["Percussion", "Percussion · bright"] || names == vec!["Percussion", "Percussion · dark"], "{names:?}");
}

#[test]
fn the_map_lies_wider_than_it_is_tall() {
    let m = build(&library());
    let at: Vec<[f32; 2]> = m.points.iter().map(|p| p.at.unwrap()).collect();
    let span = |k: usize| at.iter().map(|a| a[k]).fold(f32::NEG_INFINITY, f32::max) - at.iter().map(|a| a[k]).fold(f32::INFINITY, f32::min);
    assert!(span(0) >= span(1), "across {} up {}", span(0), span(1));
}

#[test]
fn a_large_library_is_laid_out_through_landmarks_and_still_keeps_kinds_together() {
    // Twelve landmarks for thirty-six sounds: the path a library of eighty
    // thousand takes, on one small enough to check by hand.
    let lib = library();
    let m = build_with(&lib, 12);
    assert!(m.points.iter().all(|p| p.at.is_some()));
    assert!(m.points.iter().all(|p| p.near.is_empty()), "matches are found when asked for");
    let at: Vec<[f32; 2]> = m.points.iter().map(|p| p.at.unwrap()).collect();
    let mut right = 0;
    for i in 0..at.len() {
        let mut by: Vec<usize> = (0..at.len()).filter(|&j| j != i).collect();
        by.sort_by(|&p, &q| d(at[i], at[p]).total_cmp(&d(at[i], at[q])));
        right += by.iter().take(3).filter(|&&j| j % 3 == i % 3).count();
    }
    assert!(right as f32 >= at.len() as f32 * 3.0 * 0.9, "{right} of {}", at.len() * 3);
    for i in 0..lib.len() {
        let near = m.nearest(i, 4);
        assert_eq!(near.len(), 4);
        assert!(!near.contains(&i));
        assert!(near.iter().all(|j| j % 3 == i % 3), "sound {i}: {near:?}");
    }
}

#[test]
fn a_fingerprint_kept_as_bytes_is_within_a_byte_of_itself() {
    let v: Vec<f32> = (0..64).map(|i| (i % 9) as f32 * 0.3).collect();
    let e = Embedding::from_values(&v);
    assert_eq!(e.bytes.len(), 64);
    for (a, b) in v.iter().zip(e.values()) {
        assert!((a - b).abs() <= 2.4 / 255.0 + 1e-6);
    }
}
