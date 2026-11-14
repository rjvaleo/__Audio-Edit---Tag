//! The GPU machine: model work done on another computer over SSH.
//!
//! RJ's iMac has 8 GB and no CUDA; his PC has an RTX 3060 and 64 GB. So the
//! stem splitter (Demucs) and Stable Audio Open Small run on the PC, and this
//! server sends them the work and brings the WAVs back. Nothing here is a
//! service on the PC: it is `ssh` and `scp` with the user's own key, the same as
//! typing them, run by this process. See `docs/STEMS.md`.
//!
//! Configured by `AUDIOLAB_GPU_HOST` (an SSH host, e.g. `pc`) and
//! `AUDIOLAB_GPU_DIR` (where the work lives there), or by `GPU.json` in the
//! data folder: `{"host": "pc", "dir": "C:/Users/rjval/agent-net"}`.

use crate::json::{self, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Clone, Debug)]
pub struct Gpu {
    pub host: String,
    /// The work folder on that machine, with forward slashes.
    pub dir: String,
}

pub fn config(data_dir: &Path) -> Option<Gpu> {
    let from_env = std::env::var("AUDIOLAB_GPU_HOST").ok().filter(|h| !h.trim().is_empty());
    let file = std::fs::read_to_string(data_dir.join("GPU.json")).ok().and_then(|t| json::parse(&t));
    let host = from_env.or_else(|| file.as_ref()?.get("host")?.as_str().map(str::to_string))?;
    let dir = std::env::var("AUDIOLAB_GPU_DIR")
        .ok()
        .or_else(|| file.as_ref()?.get("dir")?.as_str().map(str::to_string))
        .unwrap_or_else(|| "C:/Users/rjval/agent-net".into());
    // Only a plain host alias: it goes on a command line.
    if !host.chars().all(|c| c.is_ascii_alphanumeric() || "-_.@".contains(c)) {
        return None;
    }
    Some(Gpu { host, dir: dir.replace('\\', "/").trim_end_matches('/').to_string() })
}

/// A path on the Windows side, for `cmd`.
pub fn win(p: &str) -> String {
    p.replace('/', "\\")
}

impl Gpu {
    fn ssh(&self) -> Command {
        let mut c = Command::new("ssh");
        c.args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "LogLevel=ERROR", &self.host]);
        c
    }

    /// Run a `cmd` line there and return its output.
    pub fn run(&self, line: &str) -> Result<String, String> {
        let out = self.ssh().arg(line).stdin(Stdio::null()).output().map_err(|e| format!("ssh: {e}"))?;
        let text = String::from_utf8_lossy(&out.stdout).to_string();
        if out.status.success() {
            Ok(text)
        } else {
            Err(format!("{} {}", text.trim(), String::from_utf8_lossy(&out.stderr).trim()).trim().to_string())
        }
    }

    /// Run PowerShell there.
    pub fn ps(&self, script: &str) -> Result<String, String> {
        self.run(&format!("powershell -NoProfile -Command \"{}\"", script.replace('"', "\\\"")))
    }

    pub fn put(&self, local: &Path, remote: &str) -> Result<(), String> {
        let st = Command::new("scp")
            .args(["-q", "-o", "BatchMode=yes", "-o", "LogLevel=ERROR"])
            .arg(local)
            .arg(format!("{}:{}", self.host, remote))
            .status()
            .map_err(|e| format!("scp: {e}"))?;
        st.success().then_some(()).ok_or_else(|| format!("could not send {} to the {}", local.display(), self.host))
    }

    /// Fetch several files at once: one `scp` each, in parallel, which uses the
    /// network about four times better than one after another.
    pub fn get_many(&self, files: &[(String, PathBuf)]) -> Result<(), String> {
        let kids: Vec<_> = files
            .iter()
            .map(|(remote, local)| {
                let part = local.with_extension("part");
                let child = Command::new("scp")
                    .args(["-q", "-o", "BatchMode=yes", "-o", "LogLevel=ERROR"])
                    .arg(format!("{}:{}", self.host, remote))
                    .arg(&part)
                    .spawn();
                (child, part, local.clone())
            })
            .collect();
        let mut err = None;
        for (child, part, local) in kids {
            match child.map_err(|e| e.to_string()).and_then(|mut c| c.wait().map_err(|e| e.to_string())) {
                Ok(s) if s.success() => {
                    if let Err(e) = std::fs::rename(&part, &local) {
                        err = Some(e.to_string());
                    }
                }
                Ok(_) => err = Some(format!("could not fetch {}", local.display())),
                Err(e) => err = Some(e),
            }
        }
        err.map_or(Ok(()), Err)
    }

    /// Start a command there with its output (and errors) streamed back.
    pub fn spawn(&self, line: &str, stdin: bool) -> Result<Child, String> {
        self.ssh()
            .arg(line)
            .stdin(if stdin { Stdio::piped() } else { Stdio::null() })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("ssh: {e}"))
    }

    /// Free the GPU of a language model Ollama may be holding.
    pub fn free_gpu(&self) {
        let _ = self.ps("if (Get-Command ollama -ErrorAction SilentlyContinue) { ollama ps | Select-Object -Skip 1 | ForEach-Object { $n = ($_ -split '\\s+')[0]; if ($n) { ollama stop $n } } }");
    }

    /// End any process there whose command line mentions `tag`.
    pub fn kill_tagged(&self, tag: &str) {
        let tag: String = tag.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
        if tag.is_empty() {
            return;
        }
        let _ = self.ps(&format!(
            "Get-CimInstance Win32_Process | Where-Object {{ $_.CommandLine -like '*{tag}*' -and $_.Name -eq 'python.exe' }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force }}"
        ));
    }
}

/// Read a stream, calling `f` for each line ended by `\n` or `\r` (tqdm draws
/// its bar with `\r`).
pub fn lines_cr(mut r: impl Read, mut f: impl FnMut(&str)) {
    let mut buf = Vec::new();
    let mut b = [0u8; 4096];
    while let Ok(n) = r.read(&mut b) {
        if n == 0 {
            break;
        }
        for &c in &b[..n] {
            if c == b'\n' || c == b'\r' {
                if !buf.is_empty() {
                    f(&String::from_utf8_lossy(&buf));
                    buf.clear();
                }
            } else {
                buf.push(c);
            }
        }
    }
    if !buf.is_empty() {
        f(&String::from_utf8_lossy(&buf));
    }
}

/// A percentage at the start of a tqdm line (`" 45%|####"`).
pub fn tqdm_percent(line: &str) -> Option<f64> {
    let i = line.find('%')?;
    line[..i].trim().rsplit(' ').next()?.parse::<f64>().ok().filter(|p| (0.0..=100.0).contains(p))
}

// ------------------------------------------------------------ sounds from words

/// Stable Audio Open Small, kept loaded on the GPU machine between requests and
/// let go after ten idle minutes, so the GPU is free for anything else.
struct Words {
    child: Child,
    stdin: ChildStdin,
    out: BufReader<ChildStdout>,
    used: Instant,
}

static WORDS: Mutex<Option<Words>> = Mutex::new(None);
const IDLE: Duration = Duration::from_secs(600);

pub struct Made {
    pub remote: String,
    pub seed: u64,
    pub seconds: f64,
}

/// Make `n` sounds from `prompt` there. Blocks; the first request loads the model.
pub fn words(gpu: &Gpu, id: &str, prompt: &str, seconds: f64, n: u32, seed: u64) -> Result<Vec<Made>, String> {
    let mut guard = WORDS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(w) = guard.as_mut() {
        if !matches!(w.child.try_wait(), Ok(None)) {
            *guard = None;
        }
    }
    if guard.is_none() {
        gpu.free_gpu();
        let dir = win(&format!("{}/sao", gpu.dir));
        let mut child = gpu.spawn(&format!("cd /d {dir} & set \"HF_HUB_OFFLINE=1\"& venv\\Scripts\\python.exe make.py --serve"), true)?;
        let stdin = child.stdin.take().ok_or("no stdin")?;
        let mut out = BufReader::new(child.stdout.take().ok_or("no stdout")?);
        if let Some(err) = child.stderr.take() {
            std::thread::spawn(move || lines_cr(err, |_| {}));
        }
        let mut line = String::new();
        loop {
            line.clear();
            if out.read_line(&mut line).map_err(|e| e.to_string())? == 0 {
                let _ = child.kill();
                return Err("the sound maker on the GPU machine did not start".into());
            }
            if json::parse(line.trim()).is_some_and(|v| matches!(v.get("ready"), Some(Value::Bool(true)))) {
                break;
            }
        }
        *guard = Some(Words { child, stdin, out, used: Instant::now() });
        std::thread::spawn(|| loop {
            std::thread::sleep(Duration::from_secs(60));
            let mut g = WORDS.lock().unwrap_or_else(|e| e.into_inner());
            match g.as_mut() {
                Some(w) if w.used.elapsed() > IDLE => {
                    let _ = w.child.kill();
                    *g = None;
                    return;
                }
                Some(_) => {}
                None => return,
            }
        });
    }
    let w = guard.as_mut().unwrap();
    let req = Value::obj()
        .set("id", id)
        .set("prompt", prompt)
        .set("seconds", seconds)
        .set("n", n)
        .set("seed", seed as f64)
        .set("out", format!("tries/mgl/{id}"));
    let sent = w.stdin.write_all(format!("{}\n", req.to_string()).as_bytes()).and_then(|_| w.stdin.flush());
    if let Err(e) = sent {
        *guard = None;
        return Err(format!("the sound maker stopped: {e}"));
    }
    let mut made = Vec::new();
    let mut line = String::new();
    loop {
        line.clear();
        match w.out.read_line(&mut line) {
            Ok(0) | Err(_) => {
                *guard = None;
                return Err("the sound maker stopped mid-request".into());
            }
            Ok(_) => {}
        }
        let Some(v) = json::parse(line.trim()) else { continue };
        if v.get("id").and_then(|i| i.as_str()) != Some(id) {
            continue;
        }
        if let Some(e) = v.get("error").and_then(|e| e.as_str()) {
            w.used = Instant::now();
            return Err(e.to_string());
        }
        if matches!(v.get("done"), Some(Value::Bool(true))) {
            break;
        }
        if let Some(p) = v.get("path").and_then(|p| p.as_str()) {
            let num = |k: &str| if let Some(Value::Num(n)) = v.get(k) { *n } else { 0.0 };
            made.push(Made { remote: format!("{}/sao/{}", gpu.dir, p.replace('\\', "/")), seed: num("seed") as u64, seconds: num("seconds") });
        }
    }
    w.used = Instant::now();
    Ok(made)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_tqdm_bars() {
        assert_eq!(tqdm_percent(" 45%|####      | 140/310"), Some(45.0));
        assert_eq!(tqdm_percent("100%|##########| 310.0/310.0"), Some(100.0));
        assert_eq!(tqdm_percent("no bar here"), None);
        let mut got = Vec::new();
        lines_cr(&b"a\r 10%|#\r 20%|##\nend"[..], |l| got.push(l.to_string()));
        assert_eq!(got, ["a", " 10%|#", " 20%|##", "end"]);
    }

    #[test]
    fn hosts_must_be_plain() {
        let d = std::env::temp_dir().join("gpu-cfg-test");
        let _ = std::fs::create_dir_all(&d);
        std::fs::write(d.join("GPU.json"), r#"{"host": "pc; rm -rf /", "dir": "C:/x"}"#).unwrap();
        if std::env::var("AUDIOLAB_GPU_HOST").is_err() {
            assert!(config(&d).is_none());
            std::fs::write(d.join("GPU.json"), r#"{"host": "pc", "dir": "C:\\Users\\x\\agent-net\\"}"#).unwrap();
            let g = config(&d).unwrap();
            assert_eq!(g.dir, "C:/Users/x/agent-net");
        }
    }
}
