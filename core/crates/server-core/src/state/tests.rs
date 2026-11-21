use super::*;

fn row(folder: &str, category: &str, machine: &str, dur: f64) -> FileRow {
    FileRow {
        folder: folder.into(),
        rel_path: "a.wav".into(),
        filename: "a.wav".into(),
        subdir: String::new(),
        bytes: 1000,
        duration: dur,
        sample_rate: 44100,
        bits: 16,
        channels: 2,
        format: "WAV".into(),
        category: category.into(),
        confidence: "medium".into(),
        machine: machine.into(),
        ..Default::default()
    }
}

#[test]
fn a_uniform_folder_gets_high_confidence() {
    let mut idx = Index {
        files: (0..6).map(|_| row("kits", "DRUM-ONESHOT", "TR-808", 0.3)).collect(),
        folders: Vec::new(),
    };
    idx.rebuild_folders();
    let f = &idx.folders[0];
    assert_eq!(f.confidence, "high");
    assert_eq!((f.level1.as_str(), f.level2.as_str()), ("Drum", "Machine"));
}

#[test]
fn a_mixed_folder_gets_low_confidence() {
    // No category dominates, so the grouping is a guess and must say so.
    let mut files = Vec::new();
    for c in ["DRUM-ONESHOT", "LOOP", "VOCAL", "FX", "CHOP", "SAMPLE"] {
        files.push(row("misc", c, "", 1.0));
    }
    let mut idx = Index { files, folders: Vec::new() };
    idx.rebuild_folders();
    assert_eq!(idx.folders[0].confidence, "low");
}

#[test]
fn a_small_but_uniform_folder_is_not_called_high_confidence() {
    // Three files all agreeing is not the same evidence as thirty.
    let mut idx = Index {
        files: (0..3).map(|_| row("tiny", "LOOP", "", 2.0)).collect(),
        folders: Vec::new(),
    };
    idx.rebuild_folders();
    assert_eq!(idx.folders[0].confidence, "medium");
}

#[test]
fn non_audio_files_do_not_dilute_the_dominant_category() {
    let mut files: Vec<FileRow> = (0..5).map(|_| row("kits", "DRUM-ONESHOT", "TR-909", 0.3)).collect();
    for _ in 0..20 {
        files.push(row("kits", "CACHE", "", 0.0));
    }
    let mut idx = Index { files, folders: Vec::new() };
    idx.rebuild_folders();
    let f = &idx.folders[0];
    assert_eq!(f.audio_files, 5);
    assert_eq!(f.files, 25);
    assert_eq!(f.confidence, "high");
}

#[test]
fn a_soft_sampler_is_filed_as_a_kit_not_a_machine() {
    let mut idx = Index {
        files: (0..6).map(|_| row("battery kit", "DRUM-ONESHOT", "NI Battery", 0.3)).collect(),
        folders: Vec::new(),
    };
    idx.rebuild_folders();
    assert_eq!(idx.folders[0].level2, "Kit");
}

#[test]
fn minutes_are_summed_from_audio_only() {
    let mut idx = Index {
        files: vec![
            row("f", "LOOP", "", 60.0),
            row("f", "LOOP", "", 60.0),
            row("f", "CACHE", "", 9999.0),
        ],
        folders: Vec::new(),
    };
    idx.rebuild_folders();
    assert!((idx.folders[0].minutes - 2.0).abs() < 1e-9);
}
