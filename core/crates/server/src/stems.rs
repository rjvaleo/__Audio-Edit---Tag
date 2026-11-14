//! Splitting a song into stems with HT-Demucs, run as a helper program.
//!
//! `demucs-rs` (Apache-2.0, Rust on Burn, Metal on the Mac) is a few hundred
//! crates and a GPU layer; this server has a handful. So it stays a separate
//! program, started for one song at a time at low priority, spoken to over its
//! MCP mode (newline-delimited JSON-RPC on stdin and stdout), which reports
//! progress and can be stopped. It exits when the song is done, so the model's
//! gigabytes are given back between songs.

use crate::json::{self, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;

/// The models the helper knows, and what to call them.
pub const MODELS: [(&str, &str); 3] = [("htdemucs", "4 stems"), ("htdemucs_6s", "6 stems"), ("htdemucs_ft", "Best (fine-tuned)")];

pub const STEMS: [&str; 4] = ["drums", "bass", "vocals", "other"];

#[derive(Default)]
pub struct StemsJob {
    pub running: AtomicBool,
    pub cancel: AtomicBool,
    /// 0..1000.
    pub progress: AtomicU64,
    /// Bumped when a run ends, however it ends.
    pub serial: AtomicU64,
    pub phase: Mutex<String>,
    /// The song's folder, library-relative (`Stems/<name>`).
    pub song: Mutex<String>,
    pub source: Mutex<String>,
    pub error: Mutex<String>,
    pub started: Mutex<Option<Instant>>,
    /// How long the last run took, milliseconds.
    pub took_ms: AtomicU64,
    child: Mutex<Option<Child>>,
}

fn put(m: &Mutex<String>, s: &str) {
    if let Ok(mut x) = m.lock() {
        x.clear();
        x.push_str(s);
    }
}

pub fn get(m: &Mutex<String>) -> String {
    m.lock().map(|x| x.clone()).unwrap_or_default()
}

impl StemsJob {
    pub fn begin(&self, source: &str, song: &str) {
        self.cancel.store(false, Ordering::Relaxed);
        self.progress.store(0, Ordering::Relaxed);
        put(&self.source, source);
        put(&self.song, song);
        put(&self.error, "");
        *self.started.lock().unwrap() = Some(Instant::now());
        self.say("starting");
    }
    pub fn say(&self, what: &str) {
        put(&self.phase, what);
    }
    pub fn fail(&self, what: &str) {
        put(&self.error, what);
    }
    pub fn set_progress(&self, f: f64) {
        self.progress.store((f.clamp(0.0, 1.0) * 1000.0) as u64, Ordering::Relaxed);
    }
    pub fn elapsed(&self) -> f64 {
        self.started.lock().unwrap().map_or(0.0, |t| t.elapsed().as_secs_f64())
    }
    /// Stop: flag it and end the helper, which closes its pipe and ends the read.
    pub fn stop(&self) {
        self.cancel.store(true, Ordering::SeqCst);
        if let Ok(mut c) = self.child.lock() {
            if let Some(ch) = c.as_mut() {
                let _ = ch.kill();
            }
        }
    }
}

/// Where the helper lives: `AUDIOLAB_DEMUCS`, or `demucs` in the models folder
/// found the way YAMNet's is (`AUDIOLAB_MODELS`, beside the program, or up from
/// the working directory).
pub fn demucs_path() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("AUDIOLAB_DEMUCS") {
        return Some(PathBuf::from(p)).filter(|p| p.is_file());
    }
    let name = if cfg!(windows) { "demucs.exe" } else { "demucs" };
    let mut tries: Vec<PathBuf> = Vec::new();
    if let Some(dir) = std::env::var_os("AUDIOLAB_MODELS") {
        tries.push(PathBuf::from(dir).join(name));
    }
    if let Some(dir) = std::env::current_exe().ok().as_ref().and_then(|p| p.parent()) {
        tries.push(dir.join("models").join(name));
        tries.push(dir.join("../models").join(name));
    }
    if let Ok(cwd) = std::env::current_dir() {
        for dir in cwd.ancestors().take(6) {
            tries.push(dir.join("models").join(name));
        }
    }
    tries.into_iter().find(|p| p.is_file())
}

fn send(w: &mut impl Write, v: &Value) -> std::io::Result<()> {
    w.write_all(v.to_string().as_bytes())?;
    w.write_all(b"\n")?;
    w.flush()
}

/// Separate `input` into `out`. Blocks until done, stopped or failed; reports
/// progress into `job` as 0..`share` of the bar.
pub fn separate(job: &StemsJob, exe: &Path, input: &Path, out: &Path, model: &str, share: f64) -> Result<Vec<(String, PathBuf)>, String> {
    let mut cmd = if cfg!(unix) {
        // Low priority, so the machine (and the audio) stay responsive.
        let mut c = Command::new("nice");
        c.arg("-n").arg("10").arg(exe);
        c
    } else {
        Command::new(exe)
    };
    cmd.arg("--mcp").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = cmd.spawn().map_err(|e| format!("could not start {}: {e}", exe.display()))?;
    let mut stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    *job.child.lock().unwrap() = Some(child);
    let finish = |job: &StemsJob| {
        if let Some(mut c) = job.child.lock().unwrap().take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    };

    let call = Value::obj()
        .set("jsonrpc", "2.0")
        .set("id", 2u32)
        .set("method", "tools/call")
        .set(
            "params",
            Value::obj()
                .set("name", "separate_stems")
                .set(
                    "arguments",
                    Value::obj()
                        .set("input", input.to_string_lossy().to_string())
                        .set("model", model)
                        .set("output_dir", out.to_string_lossy().to_string()),
                )
                .set("_meta", Value::obj().set("progressToken", "split")),
        );
    let hello = Value::obj()
        .set("jsonrpc", "2.0")
        .set("id", 1u32)
        .set("method", "initialize")
        .set("params", Value::obj().set("protocolVersion", "2025-06-18").set("capabilities", Value::obj()).set("clientInfo", Value::obj().set("name", "mgl").set("version", "1")));
    let sent = send(&mut stdin, &hello)
        .and_then(|_| send(&mut stdin, &Value::obj().set("jsonrpc", "2.0").set("method", "notifications/initialized")))
        .and_then(|_| send(&mut stdin, &call));
    if let Err(e) = sent {
        finish(job);
        return Err(format!("could not talk to the helper: {e}"));
    }
    job.say("loading the model");

    let mut result: Option<Result<Vec<(String, PathBuf)>, String>> = None;
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { break };
        let Some(msg) = json::parse(&line) else { continue };
        if msg.get("method").and_then(|m| m.as_str()) == Some("notifications/progress") {
            if let Some(p) = msg.get("params") {
                if let Some(Value::Num(n)) = p.get("progress") {
                    job.set_progress(n / 100.0 * share);
                }
                if let Some(m) = p.get("message").and_then(|m| m.as_str()) {
                    job.say(m);
                }
            }
            continue;
        }
        if !matches!(msg.get("id"), Some(Value::Num(n)) if *n == 2.0) {
            continue;
        }
        if let Some(err) = msg.get("error") {
            result = Some(Err(err.get("message").and_then(|m| m.as_str()).unwrap_or("the helper refused").to_string()));
            break;
        }
        let Some(res) = msg.get("result") else { continue };
        if matches!(res.get("isError"), Some(Value::Bool(true))) {
            let text = res
                .get("content")
                .and_then(|c| c.arr())
                .and_then(|a| a.first())
                .and_then(|c| c.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or("separation failed");
            result = Some(Err(text.to_string()));
            break;
        }
        let stems = res
            .get("structuredContent")
            .and_then(|s| s.get("stems"))
            .and_then(|s| s.arr())
            .map(|a| {
                a.iter()
                    .filter_map(|s| Some((s.get("id")?.as_str()?.to_string(), PathBuf::from(s.get("path")?.as_str()?))))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        result = Some(Ok(stems));
        break;
    }
    drop(stdin);
    finish(job);
    if job.cancel.load(Ordering::SeqCst) {
        return Err("stopped".into());
    }
    result.unwrap_or_else(|| Err("the helper stopped without an answer".into()))
}

/// A song's name from its file: no extension, no leading track number.
pub fn song_name(file: &Path) -> String {
    let stem = file.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let t = stem.trim_start_matches(|c: char| c.is_ascii_digit()).trim_start();
    let t = t.strip_prefix("- ").or_else(|| t.strip_prefix(". ")).unwrap_or(t).trim();
    if t.is_empty() { stem } else { t.to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_lose_their_track_numbers() {
        assert_eq!(song_name(Path::new("/x/02 - Downtime In The Hangar.aif")), "Downtime In The Hangar");
        assert_eq!(song_name(Path::new("On The Verge.aif")), "On The Verge");
        assert_eq!(song_name(Path::new("1971.wav")), "1971");
    }
}
