//! How hard the machine is working, sampled for the Analytics tab.
//!
//! One thread, started with the server. Every second it reads the process's
//! CPU time (one `getrusage`); every ten seconds while something is playing or
//! exporting — every sixty otherwise — it writes one row: the engine's load
//! against its real-time budget, the worst block since the last row, late
//! blocks, layers, CPU, memory, and what was running. A row whose worst block
//! passed 90% is also kept as a spike, for longer. An export is timed from start
//! to finish and kept as one row. See `docs/ANALYTICS.md`.
//!
//! **The audio thread is not asked for anything.** The engine already measures
//! every block's cost into atomics; this reads them. The engine is never opened
//! from here and never waited for: `live::try_peek` gives up rather than block.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::analytics;
use crate::json::Value;
use crate::state::App;

pub const BUSY_EVERY: Duration = Duration::from_secs(10);
pub const QUIET_EVERY: Duration = Duration::from_secs(60);
/// The first row comes soon after start, so a fresh session has a reading.
const FIRST_AFTER: Duration = Duration::from_secs(2);
pub const SPIKE_AT: f32 = 0.9;

/// `perf-YYYY-MM-DD.jsonl`, by UTC day.
pub fn day_file(t_ms: f64) -> String {
    format!("perf-{}.jsonl", analytics::day(t_ms))
}

/// `spikes-YYYY-MM.jsonl`.
pub fn spike_file(t_ms: f64) -> String {
    analytics::month_file(t_ms).replacen("events-", "spikes-", 1)
}

/// This process's CPU seconds (user + system) and its peak resident memory in
/// bytes.
pub fn usage() -> (f64, u64) {
    // SAFETY: getrusage fills the struct it is given and nothing else.
    let mut ru: libc::rusage = unsafe { std::mem::zeroed() };
    if unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut ru) } != 0 {
        return (0.0, 0);
    }
    let secs = |t: libc::timeval| t.tv_sec as f64 + t.tv_usec as f64 / 1e6;
    // Bytes on macOS, kilobytes on Linux.
    let rss = if cfg!(target_os = "macos") { ru.ru_maxrss as u64 } else { ru.ru_maxrss as u64 * 1024 };
    (secs(ru.ru_utime) + secs(ru.ru_stime), rss)
}

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

fn round(v: f64, places: i32) -> f64 {
    let m = 10f64.powi(places);
    (v * m).round() / m
}

/// What the machine was doing, most expensive first.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Act {
    Video,
    Export,
    Play,
    Quiet,
}

impl Act {
    pub fn name(self) -> &'static str {
        match self {
            Act::Video => "video",
            Act::Export => "export",
            Act::Play => "play",
            Act::Quiet => "quiet",
        }
    }
    pub fn every(self) -> Duration {
        if self == Act::Quiet { QUIET_EVERY } else { BUSY_EVERY }
    }
}

/// The readings between two rows.
#[derive(Default)]
pub struct Window {
    pub cpu_sum: f64,
    pub cpu_max: f64,
    pub ticks: u32,
}

impl Window {
    pub fn add(&mut self, cpu_pct: f64) {
        self.cpu_sum += cpu_pct;
        self.cpu_max = self.cpu_max.max(cpu_pct);
        self.ticks += 1;
    }
    pub fn mean(&self) -> f64 {
        if self.ticks == 0 { 0.0 } else { self.cpu_sum / self.ticks as f64 }
    }
}

/// An export being timed.
struct Timing {
    video: bool,
    started: Instant,
    t: f64,
    cpu_max: f64,
}

/// The sampler's latest one-second CPU reading, for a sample asked for by
/// request (`sample_now`). f64 bits.
static LAST_PCT: AtomicU64 = AtomicU64::new(0);
/// The late-block total at the last row, shared by the thread and `sample_now`.
static LATE_PREV: Mutex<Option<u64>> = Mutex::new(None);

pub fn start(app: Arc<App>) {
    let _ = std::thread::Builder::new()
        .name("analytics-perf".into())
        .spawn(move || run(app));
}

fn activity(app: &Arc<App>) -> (Act, bool, bool) {
    let video = crate::video::job().running.load(Ordering::Relaxed);
    let export = app.export.running.load(Ordering::Relaxed);
    let playing = crate::live::try_peek(app, |h| h.shared.is_playing()).unwrap_or(false);
    let act = if video { Act::Video } else if export { Act::Export } else if playing { Act::Play } else { Act::Quiet };
    (act, video, export)
}

/// Write one row now, and a spike beside it if its worst block passed the line.
fn write_row(app: &Arc<App>, act: Act, win: &Window, rss: u64) {
    let row = sample(app, act, win, rss);
    let t = now_ms();
    let worst = match row.get("worst") {
        Some(Value::Num(n)) => *n,
        _ => 0.0,
    };
    let line = row.set("t", t).set("k", "perf");
    let _ = analytics::append_line(&app.data_dir, &day_file(t), &line.to_string());
    if worst >= SPIKE_AT as f64 {
        let _ = analytics::append_line(&app.data_dir, &spike_file(t), &line.set("k", "spike").to_string());
    }
}

/// A row on request, outside the schedule. The CPU figure is the sampler's
/// latest one-second reading.
pub fn sample_now(app: &Arc<App>) {
    let (act, _, _) = activity(app);
    let mut win = Window::default();
    win.add(f64::from_bits(LAST_PCT.load(Ordering::Relaxed)));
    write_row(app, act, &win, usage().1);
}

/// Five times a second it looks at the export flags — atomics only — so an
/// export is timed to within a fifth of a second; once a second it reads the
/// CPU; and on the schedule it writes a row.
fn run(app: Arc<App>) {
    const TICK: Duration = Duration::from_millis(200);
    let began = Instant::now();
    let mut last_row: Option<Instant> = None;
    let (mut cpu_prev, _) = usage();
    let mut wall_prev = Instant::now();
    let mut win = Window::default();
    let mut timing: Option<Timing> = None;
    let mut serial = app.export.serial.load(Ordering::Relaxed);
    let mut vserial = crate::video::job().serial.load(Ordering::Relaxed);
    let mut pct = 0.0;
    let mut n: u64 = 0;
    loop {
        std::thread::sleep(TICK);
        n += 1;
        let wall = Instant::now();
        let mut rss = 0;
        if n % 5 == 0 {
            let (cpu, r) = usage();
            rss = r;
            let dt = wall.duration_since(wall_prev).as_secs_f64().max(1e-3);
            pct = ((cpu - cpu_prev) / dt * 100.0).max(0.0);
            cpu_prev = cpu;
            wall_prev = wall;
            LAST_PCT.store(pct.to_bits(), Ordering::Relaxed);
            win.add(pct);
        }
        let (act, video, export) = activity(&app);

        // Exports, start to finish. A finished export bumps its serial, so one
        // that came and went between two looks is still counted.
        let s_now = app.export.serial.load(Ordering::Relaxed);
        let v_now = crate::video::job().serial.load(Ordering::Relaxed);
        let finished_audio = s_now != serial;
        let finished_video = v_now != vserial;
        serial = s_now;
        vserial = v_now;
        if video || export {
            match timing.as_mut() {
                Some(tm) => {
                    tm.video |= video;
                    tm.cpu_max = tm.cpu_max.max(pct);
                }
                None => timing = Some(Timing { video, started: wall, t: now_ms(), cpu_max: pct }),
            }
        } else if let Some(tm) = timing.take() {
            write_export(&app, &tm, if rss > 0 { rss } else { usage().1 });
        } else if finished_audio || finished_video {
            // Too quick to be seen running: counted, with no time to report.
            write_export(&app, &Timing { video: finished_video, started: wall, t: now_ms(), cpu_max: pct }, usage().1);
        }

        let due = match last_row {
            None => wall.duration_since(began) >= FIRST_AFTER,
            Some(at) => wall.duration_since(at) >= act.every(),
        };
        if !due {
            continue;
        }
        last_row = Some(wall);
        write_row(&app, act, &win, if rss > 0 { rss } else { usage().1 });
        win = Window::default();
    }
}

/// One row's worth of readings. Engine fields are absent when there is no
/// engine open, rather than zero, so a quiet machine does not read as an idle
/// engine.
fn sample(app: &Arc<App>, act: Act, win: &Window, rss: u64) -> Value {
    let mut row = Value::obj()
        .set("act", act.name())
        .set("cpu", round(win.mean(), 1))
        .set("cpuMax", round(win.cpu_max, 1))
        .set("rss", round(rss as f64 / 1_048_576.0, 1));
    let playing = app.playing.read().ok().and_then(|p| p.clone());
    let engine = crate::live::try_peek(app, |h| {
        let (now, mean, _) = h.shared.load();
        let (worst, late_total) = h.shared.take_load_window();
        let params = if act == Act::Quiet { None } else { h.shared.params() };
        (now, mean, worst, late_total, h.shared.layer_cap(), h.shared.layers_running.load(Ordering::Relaxed), h.shared.sheds_layers(), params)
    });
    if let Some((now, mean, worst, late_total, cap, running, shed, params)) = engine {
        let mut prev = LATE_PREV.lock().unwrap_or_else(|p| p.into_inner());
        let late = prev.map(|p| late_total.saturating_sub(p)).unwrap_or(0);
        *prev = Some(late_total);
        row = row
            .set("now", round(now as f64, 3))
            .set("mean", round(mean as f64, 3))
            .set("worst", round(worst as f64, 3))
            .set("late", late as f64)
            .set("cap", cap as f64)
            .set("layers", running as f64)
            .set("shed", shed);
        if let Some(p) = params {
            row = row.set("ratio", round(p.ratio as f64, 3)).set("win", round(p.window_ms as f64, 1));
        }
    }
    if act != Act::Quiet {
        if let Some(np) = playing {
            let fx: Vec<Value> = app.racks.get(&np.rel).slots.iter().map(|s| Value::from(s.kind_label())).collect();
            row = row.set("fx", Value::Arr(fx)).set("file", short_name(&np.rel));
        }
    }
    row
}

fn write_export(app: &Arc<App>, tm: &Timing, rss: u64) {
    let took = tm.started.elapsed().as_secs_f64();
    let e = &app.export;
    let rate = e.rate.load(Ordering::Relaxed) as f64;
    let len = if rate > 0.0 { e.frames.load(Ordering::Relaxed) as f64 / rate } else { 0.0 };
    let error = e.error.lock().map(|x| x.clone()).unwrap_or_default();
    let path = e.path.lock().map(|x| x.clone()).unwrap_or_default();
    let mut row = Value::obj()
        .set("t", tm.t)
        .set("k", "export")
        .set("kind", if tm.video { "video" } else { "mix" })
        .set("took", round(took, 2))
        .set("cpuMax", round(tm.cpu_max, 1))
        .set("rss", round(rss as f64 / 1_048_576.0, 1))
        .set("ok", error.is_empty() && !e.cancelled())
        .set("file", short_name(&path));
    if took < 0.05 {
        row = row.set("quick", true);
    }
    if len > 0.0 && took >= 0.05 {
        row = row.set("len", round(len, 2)).set("speed", round(len / took, 2));
    }
    let _ = analytics::append_line(&app.data_dir, &spike_file(tm.t).replacen("spikes-", "exports-", 1), &row.to_string());
}

/// The last two parts of a path: enough to recognise, nothing about where.
fn short_name(p: &str) -> String {
    let parts: Vec<&str> = p.split('/').filter(|s| !s.is_empty()).collect();
    parts[parts.len().saturating_sub(2)..].join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn files_are_named_by_utc_day_and_month() {
        assert_eq!(day_file(1_793_793_600_000.0), "perf-2026-11-04.jsonl");
        assert_eq!(spike_file(1_793_793_600_000.0), "spikes-2026-11.jsonl");
    }

    #[test]
    fn busy_is_sampled_more_often_than_quiet() {
        assert_eq!(Act::Play.every(), BUSY_EVERY);
        assert_eq!(Act::Video.every(), BUSY_EVERY);
        assert_eq!(Act::Quiet.every(), QUIET_EVERY);
    }

    #[test]
    fn a_window_averages_and_keeps_its_peak() {
        let mut w = Window::default();
        assert_eq!(w.mean(), 0.0);
        for v in [10.0, 30.0, 20.0] {
            w.add(v);
        }
        assert!((w.mean() - 20.0).abs() < 1e-9);
        assert_eq!(w.cpu_max, 30.0);
    }

    #[test]
    fn this_process_has_cpu_time_and_memory() {
        let (cpu, rss) = usage();
        assert!(cpu > 0.0);
        assert!(rss > 1_000_000);
    }

    #[test]
    fn a_short_name_keeps_two_parts() {
        assert_eq!(short_name("/Users/x/Library/kit/tone.wav"), "kit/tone.wav");
        assert_eq!(short_name("tone.wav"), "tone.wav");
    }
}
