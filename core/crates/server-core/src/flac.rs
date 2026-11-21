//! FLAC back to WAV, for stems that came over the network packed.
//!
//! macOS's own `afconvert` decodes, to integer PCM at the FLAC's bit depth, so
//! a 24-bit WAV packed to FLAC and unpacked here is the same samples it started
//! as. Where there is no `afconvert`, the stems are asked for as WAV instead
//! (`available()`), and nothing here runs.

use std::path::Path;
use std::process::{Command, Stdio};

const AFCONVERT: &str = "/usr/bin/afconvert";

pub fn available() -> bool {
    Path::new(AFCONVERT).is_file()
}

/// Decode `flac` to a 24-bit little-endian PCM WAV at `wav`.
pub fn to_wav(flac: &Path, wav: &Path) -> Result<(), String> {
    let tmp = wav.with_extension("wav.part");
    let st = Command::new(AFCONVERT)
        .args(["-f", "WAVE", "-d", "LEI24"])
        .arg(flac)
        .arg(&tmp)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("afconvert: {e}"))?;
    if !st.success() {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("could not unpack {}", flac.display()));
    }
    std::fs::rename(&tmp, wav).map_err(|e| e.to_string())
}

/// Pack a WAV or AIFF as FLAC for the trip out: lossless, at its own bit depth.
pub fn encode(src: &Path, flac: &Path) -> Result<(), String> {
    let st = Command::new(AFCONVERT)
        .args(["-f", "flac", "-d", "flac"])
        .arg(src)
        .arg(flac)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("afconvert: {e}"))?;
    st.success().then_some(()).ok_or_else(|| format!("could not pack {}", src.display()))
}
