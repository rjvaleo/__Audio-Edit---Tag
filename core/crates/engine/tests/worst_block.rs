//! Worst-block benchmark for the grain engines (AUDIO-PLAN §3, stage 1 task 1.1; task 003).
//!
//! Run it alone in a release build:
//!
//!     cargo test --release -p engine --test worst_block -- --ignored --nocapture
//!
//! Writes JSON to `BENCH_OUT` (default `target/worst-block.json`) and prints a
//! readable table on stdout. Compare two runs with:
//!
//!     node tools/bench-compare.mjs old.json new.json

use engine::voices::stock;
use engine::{Core, GrainKeys, KeyMode, Shared, Source};
use fx::grain::{Grain, StreamParams};
use fx::stretch::Algorithm;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;

const SR: u32 = 48_000;
const SR_USIZE: usize = 48_000;
const CH: usize = 2;
/// 10 s source: covers warmup + 5 s render + high-pitch grain headroom (G9).
const SRC_FRAMES: usize = SR_USIZE * 10;
const RENDER_SECONDS: usize = 5;
const RENDER_FRAMES: usize = SR_USIZE * RENDER_SECONDS;
const WARMUP_FRAMES: usize = 16_384; // ~0.34 s across all block sizes
const BLOCKS: [usize; 3] = [64, 128, 512];

const ENGINES: [Algorithm; 6] = [
    Algorithm::Granular,
    Algorithm::Wsola,
    Algorithm::Vocoder,
    Algorithm::Pvsola,
    Algorithm::Hybrid,
    Algorithm::SoundHack,
];

fn engine_name(alg: Algorithm) -> &'static str {
    match alg {
        Algorithm::Granular => "Granular",
        Algorithm::Wsola => "Wsola",
        Algorithm::Vocoder => "Vocoder",
        Algorithm::Pvsola => "Pvsola",
        Algorithm::Hybrid => "Hybrid",
        Algorithm::SoundHack => "SoundHack",
    }
}

#[cfg(unix)]
fn cpu_clock_name() -> &'static str {
    "thread-cpu"
}

#[cfg(unix)]
fn cpu_now() -> f64 {
    let mut t = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    // SAFETY: `t` is a valid stack timespec for the kernel to fill.
    unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t) };
    t.tv_sec as f64 + t.tv_nsec as f64 * 1e-9
}

#[cfg(windows)]
mod win_clock {
    use std::sync::OnceLock;
    use std::time::Instant;

    extern "system" {
        fn GetCurrentThread() -> isize;
        fn QueryThreadCycleTime(thread: isize, cycle_time: *mut u64) -> i32;
    }

    struct Cal {
        /// None when QueryThreadCycleTime is unavailable (wall fallback).
        hz: Option<f64>,
        t0: Instant,
    }

    fn raw_cycles() -> Option<u64> {
        let mut cycles = 0u64;
        // SAFETY: GetCurrentThread returns the pseudo-handle for this thread
        // and QueryThreadCycleTime writes into `cycles`.
        let ok = unsafe { QueryThreadCycleTime(GetCurrentThread(), &mut cycles) };
        if ok != 0 { Some(cycles) } else { None }
    }

    fn cal() -> &'static Cal {
        static CAL: OnceLock<Cal> = OnceLock::new();
        CAL.get_or_init(|| {
            // `GetThreadTimes` on Windows steps at the 15.625 ms scheduler
            // tick, coarser than a 64/128/512-sample block. `QueryThreadCycleTime`
            // from the same `kernel32` DLL counts this thread's own invariant-TSC
            // cycles at sub-microsecond resolution while excluding off-CPU
            // preemptions. Calibrate cycles/second against `Instant` across
            // several short spins; taking the maximum picks an unpreempted spin.
            let t0 = Instant::now();
            let mut best = 0.0f64;
            let mut sink = 0.0f64;
            let mut any_ok = false;
            for _ in 0..12 {
                let s = Instant::now();
                let Some(c0) = raw_cycles() else { break };
                any_ok = true;
                while s.elapsed().as_secs_f64() < 0.015 {
                    for i in 1..1024u32 {
                        sink += (i as f64).sqrt();
                    }
                }
                let Some(c1) = raw_cycles() else { break };
                let dt = s.elapsed().as_secs_f64();
                if c1 > c0 && dt > 0.0 {
                    best = best.max((c1 - c0) as f64 / dt);
                }
            }
            std::hint::black_box(sink);
            let hz = if any_ok && best > 1e6 { Some(best) } else { None };
            Cal { hz, t0 }
        })
    }

    pub fn name() -> &'static str {
        if cal().hz.is_some() { "thread-cpu" } else { "wall" }
    }

    pub fn now() -> f64 {
        let c = cal();
        if let Some(hz) = c.hz {
            if let Some(cycles) = raw_cycles() {
                return cycles as f64 / hz;
            }
        }
        c.t0.elapsed().as_secs_f64()
    }
}

#[cfg(windows)]
fn cpu_clock_name() -> &'static str {
    win_clock::name()
}

#[cfg(windows)]
fn cpu_now() -> f64 {
    win_clock::now()
}

#[cfg(not(any(unix, windows)))]
fn cpu_clock_name() -> &'static str {
    "wall"
}

#[cfg(not(any(unix, windows)))]
fn cpu_now() -> f64 {
    use std::sync::OnceLock;
    static T0: OnceLock<std::time::Instant> = OnceLock::new();
    T0.get_or_init(std::time::Instant::now).elapsed().as_secs_f64()
}

/// Same deterministic stereo source pattern as `poly_cost.rs`.
fn build_source() -> Arc<Source> {
    let mut seed = 7u32;
    let mut samples = Vec::with_capacity(SRC_FRAMES * CH);
    for i in 0..SRC_FRAMES {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        let s = ((i as f32) * 0.01).sin() * 0.4 + (((seed >> 16) as f32 / 32768.0) - 1.0) * 0.05;
        for _ in 0..CH {
            samples.push(s);
        }
    }
    Arc::new(Source { samples, channels: CH })
}

struct Row {
    case: String,
    block: usize,
    median_pct: f64,
    p99_pct: f64,
    worst_pct: f64,
    over_50: usize,
    over_100: usize,
}

enum Mode {
    Straight { ratio: f32 },
    Mono { note: u8 },
    Poly { voices: u8 },
    Seek250ms,
    Loop100ms,
}

fn measure(
    alg: Algorithm,
    label: &str,
    mode: Mode,
    block: usize,
    src: &Arc<Source>,
    hybrid_parts: &Arc<fx::hstream::Parts>,
) -> Row {
    let ratio = match mode {
        Mode::Straight { ratio } => ratio,
        Mode::Mono { .. } | Mode::Poly { .. } | Mode::Seek250ms | Mode::Loop100ms => 1.0,
    };
    let sp = StreamParams {
        algorithm: alg,
        ratio,
        grain: Grain::default(),
        ..StreamParams::new(SRC_FRAMES, SR)
    };
    let shared = Shared::new(sp, Arc::clone(src));
    if alg == Algorithm::Hybrid {
        shared.set_parts(Arc::clone(hybrid_parts));
    }

    let mut core = match mode {
        Mode::Straight { .. } => {
            shared.play();
            Core::new(block, CH, sp, Arc::clone(src))
        }
        Mode::Mono { note } => {
            shared.build_octaves();
            let keys = Arc::new(GrainKeys::new());
            keys.set_run(false);
            keys.set_mode(KeyMode::Mono);
            keys.set_amp(0.002, 0.01, 1.0, 0.02);
            keys.set_glide(0.0);
            let core = Core::new(block, CH, sp, Arc::clone(src)).with_keys(Arc::clone(&keys));
            keys.note_on(note, 0.8);
            core
        }
        Mode::Poly { voices } => {
            shared.build_octaves();
            let keys = Arc::new(GrainKeys::new());
            keys.set_run(false);
            keys.set_mode(KeyMode::Poly);
            keys.set_amp(0.002, 0.01, 1.0, 0.02);
            stock(&shared, voices as usize + 2, block, CH);
            let core = Core::new(block, CH, sp, Arc::clone(src)).with_keys(Arc::clone(&keys));
            // C4 (60) up in fifths: 60, 67, 74, 81, 88, 95, 102, 109.
            for v in 0..voices {
                keys.note_on(60 + v * 7, 0.8);
            }
            core
        }
        Mode::Seek250ms => {
            shared.play();
            Core::new(block, CH, sp, Arc::clone(src))
        }
        Mode::Loop100ms => {
            let a = SR as u64;
            let b = a + (SR as u64 / 10); // 100 ms = 4800 frames
            shared.set_loop(true, a, b);
            shared.request_seek(a);
            shared.play();
            Core::new(block, CH, sp, Arc::clone(src))
        }
    };

    let mut buf = vec![0.0f32; block * CH];
    let warmup_blocks = (WARMUP_FRAMES / block).max(20);
    for _ in 0..warmup_blocks {
        core.fill(&mut buf, CH, &shared);
    }

    let total_blocks = RENDER_FRAMES / block;
    let slot_s = block as f64 / SR as f64;
    let seek_interval_frames = SR_USIZE / 4; // 250 ms = 12_000 frames
    let mut frames_since_seek = 0usize;
    let mut seek_step = 1usize;

    let mut pcts = Vec::with_capacity(total_blocks);
    let mut over_50 = 0usize;
    let mut over_100 = 0usize;

    for _ in 0..total_blocks {
        if matches!(mode, Mode::Seek250ms) {
            frames_since_seek += block;
            if frames_since_seek >= seek_interval_frames {
                frames_since_seek -= seek_interval_frames;
                // Jump across the source so every seek actually repositions.
                let target = ((seek_step * 37_000) % (SRC_FRAMES - SR_USIZE * 2)) as u64;
                seek_step += 1;
                shared.request_seek(target);
            }
        }
        let t0 = cpu_now();
        core.fill(&mut buf, CH, &shared);
        let dt = (cpu_now() - t0).max(0.0);
        let pct = 100.0 * dt / slot_s;
        if pct > 50.0 {
            over_50 += 1;
        }
        if pct > 100.0 {
            over_100 += 1;
        }
        pcts.push(pct);
    }

    pcts.sort_by(f64::total_cmp);
    let n = pcts.len();
    let median_pct = pcts[(n - 1) / 2];
    let p99_pct = pcts[((n - 1) as f64 * 0.99) as usize];
    let worst_pct = pcts[n - 1];

    Row {
        case: format!("{}/{label}", engine_name(alg)),
        block,
        median_pct,
        p99_pct,
        worst_pct,
        over_50,
        over_100,
    }
}

fn cmd_out(prog: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(prog).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

fn machine_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| cmd_out("hostname", &[]))
        .unwrap_or_else(|| "unknown".into())
}

fn cpu_name() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Some(s) = cmd_out(
            "pwsh",
            &[
                "-NoProfile",
                "-Command",
                "(Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name).Trim()",
            ],
        ) {
            return s;
        }
        if let Ok(s) = std::env::var("PROCESSOR_IDENTIFIER") {
            if !s.trim().is_empty() {
                return s;
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Some(s) = cmd_out("sysctl", &["-n", "machdep.cpu.brand_string"]) {
            return s;
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(text) = fs::read_to_string("/proc/cpuinfo") {
            if let Some(line) = text.lines().find(|l| l.starts_with("model name")) {
                if let Some((_, v)) = line.split_once(':') {
                    return v.trim().to_string();
                }
            }
        }
    }
    "unknown".into()
}

fn git_commit() -> String {
    cmd_out("git", &["rev-parse", "--short", "HEAD"]).unwrap_or_else(|| "unknown".into())
}

fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

fn write_json(path: &PathBuf, machine: &str, cpu: &str, commit: &str, clock: &str, rows: &[Row]) {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).expect("create BENCH_OUT parent dir");
        }
    }
    let mut s = String::new();
    s.push_str("{\n");
    s.push_str(&format!("  \"machine\": \"{}\",\n", json_escape(machine)));
    s.push_str(&format!("  \"cpu\": \"{}\",\n", json_escape(cpu)));
    s.push_str(&format!("  \"commit\": \"{}\",\n", json_escape(commit)));
    s.push_str(&format!("  \"clock\": \"{}\",\n", json_escape(clock)));
    s.push_str("  \"rows\": [\n");
    for (i, r) in rows.iter().enumerate() {
        let comma = if i + 1 < rows.len() { "," } else { "" };
        s.push_str(&format!(
            "    {{\"case\": \"{}\", \"block\": {}, \"median_pct\": {:.4}, \"p99_pct\": {:.4}, \"worst_pct\": {:.4}, \"over_50\": {}, \"over_100\": {}}}{}\n",
            json_escape(&r.case),
            r.block,
            r.median_pct,
            r.p99_pct,
            r.worst_pct,
            r.over_50,
            r.over_100,
            comma
        ));
    }
    s.push_str("  ]\n}\n");
    fs::write(path, s).expect("write BENCH_OUT JSON");
}

#[test]
#[ignore = "a measurement: run it alone, in a release build"]
fn grain_engines_worst_block_bench() {
    let t_start = std::time::Instant::now();
    // Initialise / calibrate the clock before timing any case.
    let clock = cpu_clock_name();
    let _ = cpu_now();

    let src = build_source();
    let sp0 = StreamParams::new(SRC_FRAMES, SR);
    let hybrid_parts = Arc::new(fx::hstream::Parts::separate(&src.samples, CH, sp0.hybrid));

    let mut rows = Vec::new();

    // 1. Straight playback at ratio 1 and ratio 2 for all six engines.
    for alg in ENGINES {
        for &block in &BLOCKS {
            rows.push(measure(alg, "ratio1", Mode::Straight { ratio: 1.0 }, block, &src, &hybrid_parts));
            rows.push(measure(alg, "ratio2", Mode::Straight { ratio: 2.0 }, block, &src, &hybrid_parts));
        }
    }

    // 2. Mono key held at C2 (36), C5 (72), C8 (108), G9 (127).
    for alg in ENGINES {
        for (tag, note) in [("mono-C2", 36u8), ("mono-C5", 72), ("mono-C8", 108), ("mono-G9", 127)] {
            for &block in &BLOCKS {
                rows.push(measure(alg, tag, Mode::Mono { note }, block, &src, &hybrid_parts));
            }
        }
    }

    // 3. Poly 1, 4, 8 keys held (C4 up in fifths).
    for alg in ENGINES {
        for (tag, voices) in [("poly-1", 1u8), ("poly-4", 4), ("poly-8", 8)] {
            for &block in &BLOCKS {
                rows.push(measure(alg, tag, Mode::Poly { voices }, block, &src, &hybrid_parts));
            }
        }
    }

    // 4. Seek every 250 ms while playing (Wsola, Pvsola).
    for alg in [Algorithm::Wsola, Algorithm::Pvsola] {
        for &block in &BLOCKS {
            rows.push(measure(alg, "seek-250ms", Mode::Seek250ms, block, &src, &hybrid_parts));
        }
    }

    // 5. 100 ms loop (Granular, Wsola).
    for alg in [Algorithm::Granular, Algorithm::Wsola] {
        for &block in &BLOCKS {
            rows.push(measure(alg, "loop-100ms", Mode::Loop100ms, block, &src, &hybrid_parts));
        }
    }

    let machine = machine_name();
    let cpu = cpu_name();
    let commit = git_commit();
    let out_path = std::env::var("BENCH_OUT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("target").join("worst-block.json"));
    write_json(&out_path, &machine, &cpu, &commit, clock, &rows);

    println!(
        "\nGrain worst-block bench: {} rows, clock={clock}, elapsed {:.1}s ({machine} / {cpu} / {commit})",
        rows.len(),
        t_start.elapsed().as_secs_f64()
    );
    println!("JSON written to {}", out_path.display());
    println!(
        "{:<24} {:>5} {:>9} {:>9} {:>9} {:>7} {:>8}",
        "case", "block", "med %", "p99 %", "worst %", ">50%", ">100%"
    );
    for r in &rows {
        println!(
            "{:<24} {:>5} {:>8.2}% {:>8.2}% {:>8.2}% {:>7} {:>8}",
            r.case, r.block, r.median_pct, r.p99_pct, r.worst_pct, r.over_50, r.over_100
        );
    }
}
