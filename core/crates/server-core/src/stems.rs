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
    /// A split running on the GPU machine: where, and its job tag.
    remote: Mutex<Option<(crate::gpu::Gpu, String)>>,
    /// Stems back from the GPU machine and unpacked, in the order they landed.
    pub arrived: Mutex<Vec<String>>,
    /// Stems on their way back: (stem, bytes expected, the file growing here).
    pub incoming: Mutex<Vec<(String, u64, PathBuf)>>,
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
        self.arrived.lock().unwrap().clear();
        self.incoming.lock().unwrap().clear();
        *self.started.lock().unwrap() = Some(Instant::now());
        crate::log::line(&format!("split: {source} → {song}"));
        self.say("starting");
    }
    /// What it is doing now, for the page; a new step is also a line in the
    /// activity log (`log.rs`).
    pub fn say(&self, what: &str) {
        if get(&self.phase) != what {
            crate::log::line(&format!("split: {what}"));
        }
        put(&self.phase, what);
    }
    pub fn fail(&self, what: &str) {
        if !what.is_empty() {
            crate::log::line(&format!("split: failed: {what}"));
        }
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
        // Ending ssh does not end Demucs on the other machine: end it there.
        if let Some((gpu, tag)) = self.remote.lock().ok().and_then(|r| r.clone()) {
            gpu.kill_tagged(&tag);
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

/// Separate on the GPU machine: send the song, run Demucs there (Python, CUDA),
/// bring the stems back. Progress into `job` as 0..`share`.
pub fn separate_remote(job: &StemsJob, gpu: &crate::gpu::Gpu, input: &Path, out: &Path, model: &str, share: f64) -> Result<Vec<(String, PathBuf)>, String> {
    let id = format!(
        "mgl-{}",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
    );
    let r = separate_remote_in(job, gpu, input, out, model, share, &id);
    if r.is_err() {
        // Whatever stopped it, the job's own scratch folder there goes too.
        let _ = gpu.ps(&format!("Start-Sleep -Seconds 1; Remove-Item -Recurse -Force '{}' -ErrorAction SilentlyContinue", crate::gpu::win(&format!("{}/demucs/jobs/{id}", gpu.dir))));
        *job.remote.lock().unwrap() = None;
    }
    r
}

fn separate_remote_in(job: &StemsJob, gpu: &crate::gpu::Gpu, input: &Path, out: &Path, model: &str, share: f64, id: &str) -> Result<Vec<(String, PathBuf)>, String> {
    use crate::gpu::{lines_cr, tqdm_percent, win};
    let jobdir = format!("{}/demucs/jobs/{id}", gpu.dir);
    let mut ext = input.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| "wav".into());
    // A WAV or AIFF goes over as FLAC: lossless, about 60 % of the bytes.
    let packed = std::env::temp_dir().join(format!("{id}-song.flac"));
    let mut send = input.to_path_buf();
    if crate::flac::available() && matches!(ext.as_str(), "wav" | "aif" | "aiff") && crate::flac::encode(input, &packed).is_ok() {
        send = packed.clone();
        ext = "flac".into();
    }
    let song = format!("song.{ext}");
    let stop = |job: &StemsJob| -> Result<(), String> {
        if job.cancel.load(Ordering::SeqCst) { Err("stopped".into()) } else { Ok(()) }
    };
    *job.remote.lock().unwrap() = Some((gpu.clone(), id.to_string()));

    job.say(&format!("sending the song to the {}", gpu.host));
    gpu.ps(&format!("New-Item -ItemType Directory -Force -Path '{}' | Out-Null", win(&jobdir)))?;
    let sent = gpu.put(&send, &format!("{jobdir}/{song}"));
    let _ = std::fs::remove_file(&packed);
    sent?;
    job.set_progress(0.1 * share);
    stop(job)?;

    job.say(&format!("splitting on the {}'s GPU", gpu.host));
    gpu.free_gpu();
    let line = format!(
        "cd /d {jd} & set \"TORCH_HOME={}\"& {}\\demucs\\venv\\Scripts\\python.exe -m demucs -n {model} --int24 -d cuda -o {jd}\\out {jd}\\{song}",
        win(&format!("{}/demucs/torch", gpu.dir)),
        win(&gpu.dir),
        jd = win(&jobdir)
    );
    let mut child = gpu.spawn(&line, false)?;
    let err = child.stderr.take();
    let outp = child.stdout.take();
    *job.child.lock().unwrap() = Some(child);
    let tail = std::sync::Arc::new(Mutex::new(String::new()));
    let t2 = tail.clone();
    let reader = std::thread::spawn(move || {
        if let Some(o) = outp {
            lines_cr(o, |l| *t2.lock().unwrap() = l.to_string());
        }
    });
    if let Some(e) = err {
        let t3 = tail.clone();
        // A line in the log at each quarter, and whatever else Demucs says.
        let mut told = 0u32;
        lines_cr(e, |l| {
            if let Some(p) = tqdm_percent(l) {
                job.set_progress((0.1 + 0.6 * p / 100.0) * share);
                let q = (p / 25.0).floor() as u32;
                if q > told {
                    told = q;
                    crate::log::line(&format!("split: {}% split on the {}", q * 25, gpu.host));
                }
            } else if !l.trim().is_empty() {
                crate::log::line(&format!("{}: {}", gpu.host, l.trim()));
                *t3.lock().unwrap() = l.to_string();
            }
        });
    }
    let _ = reader.join();
    let ok = job.child.lock().unwrap().take().map(|mut c| c.wait().map(|s| s.success()).unwrap_or(false)).unwrap_or(false);
    stop(job)?;
    if !ok {
        return Err(format!("Demucs on the {} failed: {}", gpu.host, tail.lock().unwrap()));
    }

    // FLAC for the trip back: lossless, about half the bytes of the WAVs, when
    // this machine can unpack it; plain WAV otherwise.
    let songdir = format!("{jobdir}/out/{model}/song");
    if !crate::flac::available() {
        job.say(&format!("bringing the stems back from the {}", gpu.host));
        let names = gpu.run(&format!("dir /b {}", win(&songdir)))?;
        let files: Vec<(String, PathBuf)> = names.lines().map(str::trim).filter(|n| n.ends_with(".wav")).map(|n| (format!("{songdir}/{n}"), out.join(n))).collect();
        if files.is_empty() {
            return Err("Demucs made no stems".into());
        }
        gpu.get_many(&files)?;
        job.set_progress(share);
        let _ = gpu.ps(&format!("Remove-Item -Recurse -Force '{}'", win(&jobdir)));
        *job.remote.lock().unwrap() = None;
        return Ok(files.into_iter().map(|(r, l)| (r.rsplit('/').next().unwrap_or("").trim_end_matches(".wav").to_string(), l)).collect());
    }
    job.say(&format!("packing the stems on the {}", gpu.host));
    let script = std::env::temp_dir().join(format!("{id}-flac.py"));
    std::fs::write(&script, FLAC_PY).map_err(|e| e.to_string())?;
    gpu.put(&script, &format!("{jobdir}/flac.py"))?;
    let _ = std::fs::remove_file(&script);
    let listed = gpu.run(&format!(
        "{}\\demucs\\venv\\Scripts\\python.exe {}\\flac.py {}",
        win(&gpu.dir),
        win(&jobdir),
        win(&songdir)
    ))?;
    // "name<TAB>bytes" a line.
    let packed: Vec<(String, u64)> = listed
        .lines()
        .filter_map(|l| {
            let mut it = l.trim().split('\t');
            let n = it.next()?.to_string();
            let b = it.next().and_then(|b| b.trim().parse().ok()).unwrap_or(0);
            n.ends_with(".flac").then_some((n, b))
        })
        .collect();
    if packed.is_empty() {
        return Err(format!("Demucs made no stems on the {}", gpu.host));
    }
    stop(job)?;
    crate::log::line(&format!(
        "split: {} stems to bring back, {} in all",
        packed.len(),
        crate::log::mb(packed.iter().map(|(_, b)| b).sum())
    ));
    job.say(&format!("bringing the stems back from the {}", gpu.host));
    // Each stem in its own transfer, unpacked the moment it lands, so the page
    // can fill its lane in then (RJ: "filling in as it comes in").
    *job.incoming.lock().unwrap() = packed
        .iter()
        .map(|(n, b)| (n.trim_end_matches(".flac").to_string(), *b, out.join(format!("{n}.part"))))
        .collect();
    // Empty files first, so the page reads 0 %, not "landed", before each transfer starts.
    for (_, _, part) in job.incoming.lock().unwrap().iter() {
        let _ = std::fs::write(part, b"");
    }
    // Scoped threads, so each can mark its own stem arrived the moment it lands.
    let results: Vec<Result<(String, PathBuf), String>> = std::thread::scope(|sc| {
        let handles: Vec<_> = packed
            .iter()
            .map(|(n, bytes)| {
                let remote = format!("{}:{songdir}/{n}", gpu.host);
                let part = out.join(format!("{n}.part"));
                let flac = out.join(n);
                let wav = out.join(n.replace(".flac", ".wav"));
                let stem = n.trim_end_matches(".flac").to_string();
                sc.spawn(move || -> Result<(String, PathBuf), String> {
                    let t0 = Instant::now();
                    let ok = std::process::Command::new("scp")
                        .args(["-q", "-o", "BatchMode=yes", "-o", "LogLevel=ERROR"])
                        .arg(&remote)
                        .arg(&part)
                        .status()
                        .map_err(|e| e.to_string())?
                        .success();
                    if !ok {
                        return Err(format!("could not fetch {stem}"));
                    }
                    std::fs::rename(&part, &flac).map_err(|e| e.to_string())?;
                    crate::flac::to_wav(&flac, &wav)?;
                    let _ = std::fs::remove_file(&flac);
                    crate::log::line(&format!("split: received {stem} ({}, {})", crate::log::mb(*bytes), crate::log::since(t0)));
                    job.arrived.lock().unwrap().push(stem.clone());
                    Ok((stem, wav))
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap_or_else(|_| Err("a transfer stopped".into()))).collect()
    });
    let mut stems = Vec::new();
    let mut err = None;
    for r in results {
        match r {
            Ok(x) => stems.push(x),
            Err(e) => err = Some(e),
        }
    }
    job.incoming.lock().unwrap().clear();
    if let Some(e) = err {
        return Err(e);
    }
    job.set_progress(share);
    // The job's own scratch folder there, which this created.
    let _ = gpu.ps(&format!("Remove-Item -Recurse -Force '{}'", win(&jobdir)));
    *job.remote.lock().unwrap() = None;
    Ok(stems)
}

/// Run on the GPU machine in Demucs's own environment: each WAV in the folder
/// becomes a 24-bit FLAC of the same samples (read as int32, so nothing is
/// rescaled), the WAV goes, and the FLACs' names are printed.
const FLAC_PY: &str = r#"import glob, os, sys
import soundfile as sf
for p in sorted(glob.glob(os.path.join(sys.argv[1], "*.wav"))):
    info = sf.info(p)
    data, rate = sf.read(p, dtype="int32", always_2d=True)
    f = p[:-4] + ".flac"
    sf.write(f, data, rate, format="FLAC", subtype="PCM_24" if info.subtype in ("PCM_24", "PCM_32", "FLOAT") else info.subtype)
    os.remove(p)
    print(os.path.basename(f) + "\t" + str(os.path.getsize(f)), flush=True)
"#;
