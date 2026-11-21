//! Wave's tables on disk and on the wire: the frames a page posts, the
//! previews it draws, and the WAV files they are kept in (`wave_synth.rs`).

use std::path::Path;

use wave::{BUILTIN_NAMES, MAX_FRAMES};

use super::{CYCLE, MAX_FRAME_LEN, MIN_FRAME_LEN};
use crate::json::Value;

/// Frames from the page: 1 to 256 of them, all one length, 64 to 4096 long.
pub(super) fn parse_frames(v: Option<&Value>) -> Result<Vec<Vec<f32>>, String> {
    let rows = v.and_then(Value::arr).ok_or("frames must be a list of lists")?;
    if rows.is_empty() || rows.len() > MAX_FRAMES {
        return Err(format!("a table has 1 to {MAX_FRAMES} frames"));
    }
    let frames = rows
        .iter()
        .map(|r| {
            r.arr()?
                .iter()
                .map(|x| match x {
                    Value::Num(n) if n.is_finite() => Some(*n as f32),
                    _ => None,
                })
                .collect::<Option<Vec<f32>>>()
        })
        .collect::<Option<Vec<_>>>()
        .ok_or("every frame is a list of numbers")?;
    let len = frames[0].len();
    if !(MIN_FRAME_LEN..=MAX_FRAME_LEN).contains(&len) {
        return Err(format!("a frame is {MIN_FRAME_LEN} to {MAX_FRAME_LEN} samples"));
    }
    if frames.iter().any(|f| f.len() != len) {
        return Err("every frame must be the same length".into());
    }
    Ok(frames)
}

/// Each frame as the table will hold it — its DC taken out and its peak at
/// one, as `Wavetable::from_frames` does — at `points` points, read with
/// straight lines and wrapping round. Drawn from the frames directly, so a
/// preview never waits for a table to be built.
pub fn preview(frames: &[Vec<f32>], points: usize) -> Vec<Vec<f32>> {
    frames
        .iter()
        .take(MAX_FRAMES)
        .map(|f| {
            let n = f.len().max(1);
            let mean = f.iter().sum::<f32>() / n as f32;
            let mut out: Vec<f32> = (0..points)
                .map(|i| {
                    let p = i as f32 * n as f32 / points as f32;
                    let j = p as usize % n;
                    let u = p - p.floor();
                    let (a, b) = (f.get(j).copied().unwrap_or(0.0), f.get((j + 1) % n).copied().unwrap_or(0.0));
                    a + (b - a) * u - mean
                })
                .collect();
            let peak = out.iter().fold(0.0f32, |m, v| m.max(v.abs()));
            if peak > 1e-9 {
                out.iter_mut().for_each(|v| *v /= peak);
            }
            out
        })
        .collect()
}

/// A table's frames by name: a built-in, or one saved in `dir`.
pub(super) fn frames_for(dir: &Path, name: &str) -> Option<Vec<Vec<f32>>> {
    if let Some(f) = wave::builtin_frames(name) {
        return Some(f);
    }
    let file = crate::capture::safe(name);
    if file.is_empty() || file.starts_with('.') {
        return None;
    }
    read_table_wav(&std::fs::read(dir.join(format!("{file}.wav"))).ok()?)
}

/// The tables saved in `dir`, by name, with their frame counts.
pub(super) fn user_tables(dir: &Path) -> Vec<(String, usize)> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(dir) else { return out };
    for e in rd.flatten() {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()).map(str::to_lowercase).as_deref() != Some("wav") {
            continue;
        }
        let Some(name) = p.file_stem().map(|s| s.to_string_lossy().to_string()) else { continue };
        if BUILTIN_NAMES.contains(&name.as_str()) {
            continue;
        }
        if let Some(frames) = std::fs::read(&p).ok().and_then(|b| read_table_wav(&b)) {
            out.push((name, frames.len()));
        }
    }
    out.sort_by_key(|(n, _)| n.to_lowercase());
    out
}

/// A table as a mono 32-bit float WAV, frame after frame, with a `clm ` chunk
/// saying how long a frame is — Serum's convention, which other wavetable
/// synths read too.
pub fn table_wav(frames: &[Vec<f32>]) -> Vec<u8> {
    let len = frames.first().map_or(CYCLE, Vec::len);
    let mut clm = format!("<!>{len} 10000000 wavetable (MultiGrainLive)").into_bytes();
    if clm.len() % 2 == 1 {
        clm.push(0);
    }
    let data: Vec<u8> = frames.iter().flatten().flat_map(|v| v.to_le_bytes()).collect();
    let mut out = Vec::with_capacity(44 + clm.len() + 8 + data.len());
    let riff = 4 + (8 + 16) + (8 + clm.len()) + (8 + data.len());
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(riff as u32).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&3u16.to_le_bytes()); // IEEE float
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&48_000u32.to_le_bytes());
    out.extend_from_slice(&(48_000u32 * 4).to_le_bytes());
    out.extend_from_slice(&4u16.to_le_bytes());
    out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(b"clm ");
    out.extend_from_slice(&(clm.len() as u32).to_le_bytes());
    out.extend_from_slice(&clm);
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(&data);
    out
}

/// Frames back out of a table WAV: 32-bit float or 16-bit PCM, the first
/// channel, cut at the `clm ` chunk's frame length (2048 when there is none).
pub fn read_table_wav(b: &[u8]) -> Option<Vec<Vec<f32>>> {
    if b.len() < 12 || &b[0..4] != b"RIFF" || &b[8..12] != b"WAVE" {
        return None;
    }
    let (mut format, mut channels, mut bits, mut len) = (0u16, 1usize, 0u16, CYCLE);
    let mut data: Option<&[u8]> = None;
    let mut at = 12;
    while at + 8 <= b.len() {
        let id = &b[at..at + 4];
        let size = u32::from_le_bytes(b[at + 4..at + 8].try_into().ok()?) as usize;
        let body = &b[at + 8..(at + 8 + size).min(b.len())];
        match id {
            b"fmt " if body.len() >= 16 => {
                format = u16::from_le_bytes([body[0], body[1]]);
                channels = u16::from_le_bytes([body[2], body[3]]).max(1) as usize;
                bits = u16::from_le_bytes([body[14], body[15]]);
            }
            b"clm " => {
                let text = String::from_utf8_lossy(body);
                if let Some(n) = text.strip_prefix("<!>").and_then(|t| t.split_whitespace().next()).and_then(|t| t.parse().ok()) {
                    len = n;
                }
            }
            b"data" => data = Some(body),
            _ => {}
        }
        at += 8 + size + (size & 1);
    }
    let data = data?;
    let samples: Vec<f32> = match (format, bits) {
        (3, 32) => data.chunks_exact(4 * channels).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect(),
        (1, 16) => data.chunks_exact(2 * channels).map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0).collect(),
        _ => return None,
    };
    if !(4..=MAX_FRAME_LEN).contains(&len) || samples.len() < len {
        return None;
    }
    Some(samples.chunks_exact(len).take(MAX_FRAMES).map(<[f32]>::to_vec).collect())
}
