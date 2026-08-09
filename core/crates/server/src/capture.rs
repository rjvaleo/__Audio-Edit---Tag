//! Keeping what came out of the speakers.
//!
//! Everything else in this app renders: it reads the document, computes the
//! result, and writes that. A capture is the opposite — it keeps the actual
//! output of the audio thread, grains, rack, fader and all, exactly as heard.
//! The two can differ, and when they do the recording is the honest one, since
//! it is the thing that was in the room.
//!
//! The file lands beside its original in the library. That is the one place in
//! the app that writes audio into the library at all, so it is worth being
//! plain about the rules: it never overwrites, it never touches the original,
//! and if the name is taken it takes the next one.

use std::path::{Path, PathBuf};

/// How much output to reserve room for. Ten minutes at 48 kHz stereo is about
/// 230 MB, which is a lot of memory but far less than the surprise of a
/// recording that stopped early without saying so.
pub const MAX_SECONDS: f32 = 600.0;

/// A short word for what the sound went through, for the filename.
///
/// The point of a capture is usually "this, but processed", so the name should
/// say which processing. Ordered by how much it changes the sound, and only the
/// strongest is used — a filename is not a changelog.
pub fn module_name(list: &edit::EditList, rack: &Option<fx::Rack>) -> String {
    let st = &list.stretch;
    let mut parts: Vec<&str> = Vec::new();

    if st.is_granular() {
        parts.push("granular");
    } else if list.is_stretched() {
        parts.push("stretched");
    }
    if st.semitones.abs() > 1e-3 {
        parts.push("pitched");
    }
    if let Some(r) = rack {
        if !r.is_empty() {
            parts.push("fx");
        }
    }
    if parts.is_empty() {
        "live".into()
    } else {
        parts.join("-")
    }
}

/// `2026-08-09 143201`, from the system clock, without pulling in a date crate.
///
/// The civil-from-days conversion is Howard Hinnant's, which is exact for any
/// date this program will ever see and is fifteen lines. A dependency for a
/// filename would have been a poor trade against the cross-compile.
pub fn stamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let days = (secs / 86_400) as i64;
    let tod = secs % 86_400;
    let (h, m, s) = (tod / 3600, (tod % 3600) / 60, tod % 60);

    // Shift the epoch to 0000-03-01 so leap days land at the end of the cycle.
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };

    format!("{year:04}-{month:02}-{d:02} {h:02}{m:02}{s:02}")
}

/// Strip anything a filesystem would rather not see.
pub fn safe(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if (c as u32) < 0x20 => ' ',
            c => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

/// Where the recording of `rel` should go: beside it, named for what it is.
///
/// Returns the path and whether it had to fall back out of the library — a
/// read-only pack, or a library that has moved, should cost the recording a
/// tidy location rather than costing it the audio.
pub fn target(lib: &Path, data_dir: &Path, rel: &str, module: &str) -> (PathBuf, bool) {
    let stem = Path::new(rel)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "capture".into());
    let name = safe(&format!("{stem} {module} {}.wav", stamp()));

    let beside = Path::new(rel).parent().map(|p| p.join(&name));
    if let Some(candidate) = beside.and_then(|r| crate::safety::resolve_for_write(lib, &r.to_string_lossy())) {
        if let Some(parent) = candidate.parent() {
            if parent.is_dir() {
                return (unique(candidate), false);
            }
        }
    }
    // Fallback: beside the app's own data, which is always ours to write to.
    let mut fallback = data_dir.join("Captures");
    let _ = std::fs::create_dir_all(&fallback);
    fallback.push(name);
    (unique(fallback), true)
}

/// Never overwrite. A recording is not reproducible, so the one thing that must
/// not happen is a second take quietly replacing the first.
fn unique(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = path.extension().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "wav".into());
    for n in 2..1000 {
        let next = path.with_file_name(format!("{stem} ({n}).{ext}"));
        if !next.exists() {
            return next;
        }
    }
    path
}

/// Write interleaved f32 as a 24-bit WAV.
///
/// 24-bit because the engine works in float and a capture is a master, not a
/// sketch; 16 would throw away headroom that the granular path can genuinely
/// use.
pub fn write_wav(path: &Path, samples: &[f32], channels: usize, sample_rate: u32) -> std::io::Result<u64> {
    use std::io::Write;

    let channels = channels.max(1) as u16;
    let frames = (samples.len() / channels as usize) as u64;
    let data_len = frames * channels as u64 * 3;

    let file = std::fs::File::create(path)?;
    let mut out = std::io::BufWriter::new(file);
    out.write_all(&audio_core::wav::header(
        data_len,
        channels,
        sample_rate,
        audio_core::Codec::PcmI24,
    ))?;

    let mut bytes = Vec::with_capacity(3 * 8192);
    for chunk in samples.chunks(8192) {
        bytes.clear();
        for v in chunk {
            // Clamp before scaling: the fader and the rack can both push past
            // full scale, and wrapping would turn a loud moment into a click.
            let clamped = v.clamp(-1.0, 1.0);
            let q = (clamped * 8_388_607.0) as i32;
            bytes.extend_from_slice(&q.to_le_bytes()[..3]);
        }
        out.write_all(&bytes)?;
    }
    out.flush()?;
    Ok(frames)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stamp_is_a_date_and_a_time() {
        let s = stamp();
        assert_eq!(s.len(), 17, "{s}");
        assert_eq!(&s[4..5], "-");
        assert_eq!(&s[7..8], "-");
        assert_eq!(&s[10..11], " ");
        let year: i32 = s[..4].parse().unwrap();
        assert!(year >= 2024 && year < 2200, "{s}");
    }

    #[test]
    fn separators_never_reach_the_filesystem() {
        assert_eq!(safe("a/b\\c:d*e?f\"g<h>i|j"), "a-b-c-d-e-f-g-h-i-j");
    }

    #[test]
    fn a_plain_playback_is_named_live() {
        let list = edit::EditList::identity(1000, 2, 48_000);
        assert_eq!(module_name(&list, &None), "live");
    }

    #[test]
    fn the_name_says_what_was_done_to_it() {
        let mut list = edit::EditList::identity(1000, 2, 48_000);
        list.stretch.ratio = 8.0;
        list.stretch.semitones = -5.0;
        assert_eq!(module_name(&list, &None), "stretched-pitched");
    }

    #[test]
    fn a_second_take_does_not_replace_the_first() {
        let dir = std::env::temp_dir().join(format!("audiolab-cap-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let first = dir.join("take.wav");
        std::fs::write(&first, b"x").unwrap();
        let second = unique(first.clone());
        assert_ne!(second, first);
        assert!(second.to_string_lossy().contains("(2)"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_written_capture_reads_back_at_the_right_length() {
        let dir = std::env::temp_dir().join(format!("audiolab-capw-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("out.wav");

        let frames = 500usize;
        let samples: Vec<f32> = (0..frames * 2)
            .map(|i| ((i as f32) * 0.01).sin() * 0.5)
            .collect();
        let written = write_wav(&path, &samples, 2, 48_000).unwrap();
        assert_eq!(written, frames as u64);

        let mut r = audio_core::open(&path).unwrap();
        assert_eq!(r.info().channels, 2);
        assert_eq!(r.info().sample_rate, 48_000);
        assert_eq!(r.info().frames(), frames as u64);

        // And the audio survived the round trip.
        let back = r.read_frames(0, frames as u64).unwrap();
        for (a, b) in samples.iter().zip(&back) {
            assert!((a - b).abs() < 1e-4, "{a} vs {b}");
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn clipping_is_clamped_rather_than_wrapped() {
        let dir = std::env::temp_dir().join(format!("audiolab-capc-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("hot.wav");
        write_wav(&path, &[2.0, -2.0, 0.0, 0.0], 1, 48_000).unwrap();

        let mut r = audio_core::open(&path).unwrap();
        let back = r.read_frames(0, 4).unwrap();
        assert!(back[0] > 0.99 && back[0] <= 1.0, "{}", back[0]);
        assert!(back[1] < -0.99 && back[1] >= -1.0, "{}", back[1]);
        let _ = std::fs::remove_dir_all(dir);
    }
}
