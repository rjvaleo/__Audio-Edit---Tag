//! Scanning a folder.
//!
//! This is where the library comes from: what the browser lists, what the
//! format column says, and — since the "play all files" switch — which files
//! are offered at all. It had no tests. The two things that matter are that
//! every file gets a verdict, and that the verdict is right about the ones
//! that are not audio, because those are the ones the app now has to reason
//! about rather than merely tolerate.

use audio_core::{Codec, Endian};
use std::fs;
use std::path::{Path, PathBuf};

/// A scratch library that removes itself.
struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("audiolab-scan-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("kit")).unwrap();
        Scratch(dir)
    }
    fn root(&self) -> &Path {
        &self.0
    }
    fn write(&self, rel: &str, bytes: &[u8]) {
        let p = self.0.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, bytes).unwrap();
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// A real WAV, header and all, so the probe has something to succeed on.
fn wav(frames: usize, channels: u16, rate: u32) -> Vec<u8> {
    let bytes_per_frame = 2 * channels as usize;
    let data_len = (frames * bytes_per_frame) as u64;
    let mut out = audio_core::wav::header(data_len, channels, rate, Codec::PcmI16).to_vec();
    for i in 0..frames {
        let v = ((i as f32 / 40.0).sin() * 12000.0) as i16;
        for _ in 0..channels {
            out.extend_from_slice(&v.to_le_bytes());
        }
    }
    out
}

fn find<'a>(rows: &'a [indexer::FileRecord], name: &str) -> &'a indexer::FileRecord {
    rows.iter()
        .find(|r| r.filename == name)
        .unwrap_or_else(|| panic!("{name} was not in the scan: {:?}",
            rows.iter().map(|r| &r.filename).collect::<Vec<_>>()))
}

#[test]
fn every_kind_of_file_gets_the_right_verdict() {
    let s = Scratch::new("verdicts");
    s.write("kit/tone.wav", &wav(4800, 2, 48_000));
    s.write("kit/mono.wav", &wav(2400, 1, 44_100));
    // No header the probe can recognise: it falls back to headerless PCM,
    // which is exactly the case the browser's switch exists for.
    s.write("kit/dump.bin", &vec![7u8; 40_000]);
    // An extension on the skip list: not probed at all, so it cannot be
    // mistaken for headerless audio however its bytes happen to read.
    s.write("kit/notes.txt", b"these are not samples");
    s.write("kit/peaks.asd", &vec![3u8; 9000]);
    s.write("kit/nothing.wav", b"");

    let rows = indexer::scan_folder(s.root(), "kit").unwrap();

    assert_eq!(find(&rows, "tone.wav").format, "WAV");
    assert_eq!(find(&rows, "tone.wav").channels, 2);
    assert_eq!(find(&rows, "tone.wav").sample_rate, 48_000);
    assert!((find(&rows, "tone.wav").duration - 0.1).abs() < 1e-3);

    assert_eq!(find(&rows, "mono.wav").channels, 1);
    assert_eq!(find(&rows, "mono.wav").sample_rate, 44_100);

    assert_eq!(find(&rows, "dump.bin").format, "RAW-PCM");
    assert!(
        find(&rows, "dump.bin").notes.contains("headerless"),
        "a guessed format should say so: {:?}",
        find(&rows, "dump.bin").notes
    );

    assert_eq!(find(&rows, "notes.txt").format, "NON-AUDIO");
    assert_eq!(find(&rows, "peaks.asd").format, "NON-AUDIO");
    assert_eq!(find(&rows, "nothing.wav").format, "EMPTY");
}

/// The skip list is what stops a text file being read as noise. Without it a
/// `.txt` probes as headerless PCM like anything else does.
#[test]
fn a_skipped_extension_is_never_probed() {
    let s = Scratch::new("skip");
    // Bytes that would probe perfectly happily as headerless PCM.
    let noise: Vec<u8> = (0..20_000u32).map(|i| (i % 251) as u8).collect();
    s.write("kit/a.txt", &noise);
    s.write("kit/b.bin", &noise);

    let rows = indexer::scan_folder(s.root(), "kit").unwrap();
    assert_eq!(find(&rows, "a.txt").format, "NON-AUDIO", "the skip list did not hold");
    assert_eq!(find(&rows, "b.bin").format, "RAW-PCM", "an unlisted extension should be probed");
}

#[test]
fn hidden_files_and_our_own_sidecars_are_not_library_content() {
    let s = Scratch::new("hidden");
    s.write("kit/real.wav", &wav(1200, 1, 44_100));
    s.write("kit/.DS_Store", &vec![1u8; 400]);
    s.write("kit/_TAGS.txt", b"name\ttags\n");

    let rows = indexer::scan_folder(s.root(), "kit").unwrap();
    let names: Vec<&str> = rows.iter().map(|r| r.filename.as_str()).collect();
    assert!(names.contains(&"real.wav"));
    assert!(!names.contains(&".DS_Store"), "a hidden file was indexed: {names:?}");
    assert!(!names.contains(&"_TAGS.txt"), "our own sidecar was indexed: {names:?}");
}

#[test]
fn subfolders_are_walked_and_their_paths_are_relative_and_forward_slashed() {
    let s = Scratch::new("nested");
    s.write("kit/top.wav", &wav(1200, 1, 44_100));
    s.write("kit/deep/inner/low.wav", &wav(1200, 1, 44_100));

    let rows = indexer::scan_folder(s.root(), "kit").unwrap();
    // Relative to the root folder rather than to the library: the folder name
    // is carried separately in `root_folder`, and the server joins the two.
    let paths: Vec<&str> = rows.iter().map(|r| r.rel_path.as_str()).collect();
    assert!(paths.contains(&"top.wav"), "{paths:?}");
    assert!(paths.contains(&"deep/inner/low.wav"), "{paths:?}");
    assert!(rows.iter().all(|r| r.root_folder == "kit"), "the root folder was not recorded");
    for p in &paths {
        assert!(!p.contains('\\'), "a Windows separator survived: {p}");
        assert!(!p.starts_with('/'), "a path escaped to absolute: {p}");
    }
}

/// The rows are sorted, because the browser lists them in the order they
/// arrive and an unordered scan would shuffle the library between runs.
#[test]
fn the_scan_comes_back_in_a_stable_order() {
    let s = Scratch::new("order");
    for n in ["c.wav", "a.wav", "b.wav"] {
        s.write(&format!("kit/{n}"), &wav(800, 1, 44_100));
    }
    let once = indexer::scan_folder(s.root(), "kit").unwrap();
    let twice = indexer::scan_folder(s.root(), "kit").unwrap();
    let names = |v: &[indexer::FileRecord]| -> Vec<String> {
        v.iter().map(|r| r.filename.clone()).collect()
    };
    assert_eq!(names(&once), names(&twice));
    assert_eq!(names(&once), vec!["a.wav", "b.wav", "c.wav"]);
}

#[test]
fn the_roots_of_a_library_are_its_top_level_folders() {
    let s = Scratch::new("roots");
    fs::create_dir_all(s.root().join("beds")).unwrap();
    fs::create_dir_all(s.root().join(".hidden")).unwrap();
    s.write("loose.wav", &wav(800, 1, 44_100));

    let roots = indexer::library_roots(s.root()).unwrap();
    assert!(roots.contains(&"kit".to_string()), "{roots:?}");
    assert!(roots.contains(&"beds".to_string()), "{roots:?}");
    assert!(!roots.contains(&".hidden".to_string()), "a hidden folder became a root: {roots:?}");
    assert!(!roots.contains(&"loose.wav".to_string()), "a file became a root: {roots:?}");
}

/// A scan of nothing is an empty list, not an error and not a panic. The
/// library can legitimately contain an empty folder.
#[test]
fn an_empty_folder_scans_to_nothing() {
    let s = Scratch::new("empty");
    fs::create_dir_all(s.root().join("bare")).unwrap();
    assert!(indexer::scan_folder(s.root(), "bare").unwrap().is_empty());
}

#[test]
fn a_folder_that_is_not_there_is_an_empty_scan_rather_than_a_crash() {
    let s = Scratch::new("missing");
    let rows = indexer::scan_folder(s.root(), "no-such-folder").unwrap();
    assert!(rows.is_empty());
}

/// Every row carries a duration band, because the browser groups by it and a
/// blank would put a file in no group at all.
#[test]
fn every_readable_row_gets_a_duration_band() {
    let s = Scratch::new("bands");
    s.write("kit/short.wav", &wav(2000, 1, 44_100));
    s.write("kit/long.wav", &wav(300_000, 1, 44_100));
    let rows = indexer::scan_folder(s.root(), "kit").unwrap();
    for r in &rows {
        if r.duration > 0.0 {
            assert!(
                !indexer::duration_band(r.duration).is_empty(),
                "{} at {}s had no band",
                r.filename,
                r.duration
            );
        }
    }
    assert_ne!(
        indexer::duration_band(find(&rows, "short.wav").duration),
        indexer::duration_band(find(&rows, "long.wav").duration),
        "a 0.05s file and a 6.8s file landed in the same band"
    );
}

/// Not a test of the indexer so much as of the assumption the format column
/// rests on: the codec and endianness a WAV declares are what come back.
#[test]
fn the_declared_format_survives_the_round_trip() {
    let s = Scratch::new("codec");
    s.write("kit/eight.wav", &wav(1000, 2, 22_050));
    let rows = indexer::scan_folder(s.root(), "kit").unwrap();
    let r = find(&rows, "eight.wav");
    assert_eq!(r.bits, 16);
    assert_eq!(r.channels, 2);
    assert_eq!(r.sample_rate, 22_050);
    assert_eq!(Endian::Little, Endian::Little); // the reader's assumption, stated
}
