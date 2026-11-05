//! How long analytics are kept, and the daily summaries that outlive them.
//!
//! Detail is kept for a while and then rolled up: before a day's events and
//! performance rows are deleted they are summarised into one line of
//! `DAILY.jsonl` — time per page and dock tab, uses and value ranges per
//! control, panel heat, page paths, the pointer grids, counts, and load
//! percentiles. A summary day is a few kilobytes. On top of the ages there is
//! a cap on the whole folder: over it, the oldest detailed files go first and
//! summaries last.
//!
//! Runs on its own thread: thirty seconds after the server starts, then once a
//! day, and never while an export is running. See `docs/ANALYTICS.md`.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use crate::analytics::{self, day, dir};
use crate::json::{self, Value};
use crate::state::App;

const DAY_MS: f64 = 86_400_000.0;
/// A gap longer than this between two events is idle, as in the interface.
const IDLE_MS: f64 = 60_000.0;

#[derive(Clone, Debug, PartialEq)]
pub struct Retention {
    /// Usage events and the pointer grids in them.
    pub events: u32,
    /// Performance rows.
    pub perf: u32,
    /// Spikes and export timings.
    pub spikes: u32,
    /// Daily summaries.
    pub daily: u32,
    /// The whole folder, in megabytes.
    pub cap_mb: u32,
}

impl Default for Retention {
    fn default() -> Self {
        Retention { events: 90, perf: 30, spikes: 180, daily: 730, cap_mb: 100 }
    }
}

impl Retention {
    pub fn to_json(&self) -> Value {
        Value::obj()
            .set("events", self.events)
            .set("perf", self.perf)
            .set("spikes", self.spikes)
            .set("daily", self.daily)
            .set("capMB", self.cap_mb)
    }

    /// Fields present in `v` replace the current ones, clamped to something
    /// sane: at least a day, at most ten years, a cap of 5 MB to 10 GB.
    pub fn merge(&self, v: &Value) -> Retention {
        let get = |k: &str, cur: u32, lo: u32, hi: u32| match v.get(k) {
            Some(Value::Num(n)) if n.is_finite() => (*n as i64).clamp(lo as i64, hi as i64) as u32,
            _ => cur,
        };
        Retention {
            events: get("events", self.events, 1, 3650),
            perf: get("perf", self.perf, 1, 3650),
            spikes: get("spikes", self.spikes, 1, 3650),
            daily: get("daily", self.daily, 1, 3650),
            cap_mb: get("capMB", self.cap_mb, 5, 10_000),
        }
    }
}

fn settings_path(data_dir: &Path) -> std::path::PathBuf {
    dir(data_dir).join("RETENTION.json")
}

pub fn settings(data_dir: &Path) -> Retention {
    std::fs::read_to_string(settings_path(data_dir))
        .ok()
        .and_then(|s| json::parse(&s))
        .map(|v| Retention::default().merge(&v))
        .unwrap_or_default()
}

pub fn save_settings(data_dir: &Path, r: &Retention) -> Result<(), String> {
    std::fs::create_dir_all(dir(data_dir)).map_err(|e| e.to_string())?;
    std::fs::write(settings_path(data_dir), r.to_json().to_string()).map_err(|e| e.to_string())
}

// ------------------------------------------------------------- what is there

/// Which retention a file falls under, from its name.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Kind {
    Events,
    Perf,
    Spikes,
    Daily,
    Other,
}

pub fn kind_of(name: &str) -> Kind {
    if name.starts_with("events-") {
        Kind::Events
    } else if name.starts_with("perf-") {
        Kind::Perf
    } else if name.starts_with("spikes-") || name.starts_with("exports-") {
        Kind::Spikes
    } else if name == "DAILY.jsonl" {
        Kind::Daily
    } else {
        Kind::Other
    }
}

/// The date a detail file's name carries, `YYYY-MM-DD` or `YYYY-MM`.
fn stamp(name: &str) -> &str {
    let body = name.trim_end_matches(".jsonl");
    body.find('-').map(|i| &body[i + 1..]).unwrap_or("")
}

fn files(data_dir: &Path) -> Vec<(String, u64)> {
    let mut out: Vec<(String, u64)> = std::fs::read_dir(dir(data_dir))
        .map(|it| {
            it.filter_map(|e| e.ok())
                .filter_map(|e| Some((e.file_name().to_string_lossy().into_owned(), e.metadata().ok()?.len())))
                .collect()
        })
        .unwrap_or_default();
    out.sort();
    out
}

/// Size on disk by kind, and the settings, and the last purge.
pub fn storage(data_dir: &Path) -> Value {
    let mut by: BTreeMap<&str, u64> = BTreeMap::new();
    let mut total = 0;
    for (n, len) in files(data_dir) {
        let k = match kind_of(&n) {
            Kind::Events => "events",
            Kind::Perf => "perf",
            Kind::Spikes => "spikes",
            Kind::Daily => "daily",
            Kind::Other => "other",
        };
        *by.entry(k).or_default() += len;
        total += len;
    }
    let mut kinds = Value::obj();
    for k in ["events", "perf", "spikes", "daily", "other"] {
        kinds = kinds.set(k, *by.get(k).unwrap_or(&0) as f64);
    }
    let last = std::fs::read_to_string(dir(data_dir).join("PURGE.json")).ok().and_then(|s| json::parse(&s)).unwrap_or(Value::Null);
    Value::obj()
        .set("bytes", total as f64)
        .set("kinds", kinds)
        .set("retention", settings(data_dir).to_json())
        .set("last", last)
}

// ------------------------------------------------------------- the summary

fn num(v: &Value, k: &str) -> Option<f64> {
    match v.get(k) {
        Some(Value::Num(n)) if n.is_finite() => Some(*n),
        _ => None,
    }
}

fn s<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(|x| x.as_str())
}

fn bump(m: &mut BTreeMap<String, f64>, k: &str, by: f64) {
    *m.entry(k.to_string()).or_default() += by;
}

fn obj(m: &BTreeMap<String, f64>) -> Value {
    let mut o = Value::obj();
    for (k, v) in m {
        o = o.set(k, (v * 10.0).round() / 10.0);
    }
    o
}

fn percentile(sorted: &[f64], q: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let i = ((sorted.len() - 1) as f64 * q).round() as usize;
    sorted[i.min(sorted.len() - 1)]
}

/// One day's events and performance rows, as one summary line.
pub fn summarise_day(day_name: &str, events: &[Value], perf: &[Value]) -> Value {
    const USES: [&str; 9] = ["ctl", "toggle", "seg", "field", "click", "menu", "key", "view", "dock"];
    let mut ev: Vec<&Value> = events.iter().filter(|e| num(e, "t").is_some()).collect();
    ev.sort_by(|a, b| num(a, "t").partial_cmp(&num(b, "t")).unwrap_or(std::cmp::Ordering::Equal));

    let (mut pages, mut docks, mut heat, mut paths, mut counts) =
        (BTreeMap::new(), BTreeMap::new(), BTreeMap::new(), BTreeMap::new(), BTreeMap::new());
    let mut active = 0.0;
    let mut idle = 0.0;
    let mut sessions: BTreeSet<&str> = BTreeSet::new();
    let mut controls: BTreeMap<String, Value> = BTreeMap::new();
    let mut mouse: BTreeMap<String, (f64, f64, BTreeMap<u64, f64>, BTreeMap<u64, f64>)> = BTreeMap::new();

    // Time: between consecutive events of a session, each gap capped.
    let mut by_session: BTreeMap<&str, Vec<&Value>> = BTreeMap::new();
    for e in &ev {
        if matches!(s(e, "k"), Some("mouse") | Some("lof")) {
            continue;
        }
        let sid = s(e, "s").unwrap_or("");
        sessions.insert(sid);
        by_session.entry(sid).or_default().push(e);
    }
    for list in by_session.values() {
        for w in list.windows(2) {
            let gap = (num(w[1], "t").unwrap() - num(w[0], "t").unwrap()).max(0.0);
            let used = gap.min(IDLE_MS);
            active += used;
            idle += (gap - IDLE_MS).max(0.0);
            let m = s(w[0], "m").unwrap_or("");
            bump(&mut pages, m, used);
            if m == "edit" {
                if let Some(dk) = s(w[0], "dk") {
                    bump(&mut docks, dk, used);
                }
            }
        }
    }

    for e in &ev {
        let k = s(e, "k").unwrap_or("");
        let d = e.get("d");
        match k {
            "mode" => {
                if let Some(from) = d.and_then(|d| s(d, "from")) {
                    bump(&mut paths, &format!("{from}>{}", s(e, "m").unwrap_or("")), 1.0);
                }
            }
            "mouse" => {
                let Some(d) = d else { continue };
                let (gw, gh) = (num(d, "gw").unwrap_or(0.0), num(d, "gh").unwrap_or(0.0));
                let g = mouse.entry(s(e, "m").unwrap_or("").to_string()).or_insert((gw, gh, BTreeMap::new(), BTreeMap::new()));
                for (key, into) in [("move", &mut g.2), ("click", &mut g.3)] {
                    if let Some(list) = d.get(key).and_then(|l| l.arr()) {
                        for pair in list.chunks(2) {
                            if let [Value::Num(c), Value::Num(n)] = pair {
                                *into.entry(*c as u64).or_default() += n;
                            }
                        }
                    }
                }
                continue;
            }
            _ => {}
        }
        if ["edit", "export", "file", "fx.add", "fx.remove", "preset", "error", "record"].contains(&k) {
            bump(&mut counts, k, 1.0);
        }
        if let Some(p) = s(e, "p") {
            if USES.contains(&k) || k.starts_with("fx.") {
                bump(&mut heat, if p.starts_with("fx:") { "fxModuleRail" } else { p }, 1.0);
            }
        }
        let Some(c) = s(e, "c").filter(|_| USES.contains(&k)) else { continue };
        let entry = controls.entry(c.to_string()).or_insert_with(|| {
            let mut o = Value::obj().set("n", 0.0);
            for f in ["ck", "p", "l"] {
                if let Some(x) = s(e, f) {
                    o = o.set(f, x);
                }
            }
            o
        });
        let n = num(entry, "n").unwrap_or(0.0) + 1.0;
        let mut o = entry.clone().set("n", n).set("last", num(e, "t").unwrap_or(0.0));
        for f in ["lo", "hi"] {
            if let Some(x) = num(e, f) {
                o = o.set(f, x);
            }
        }
        if k == "ctl" {
            for f in ["min", "max", "to"] {
                let Some(x) = num(e, f) else { continue };
                if num(&o, "min").map_or(true, |m| x < m) {
                    o = o.set("min", x);
                }
                if num(&o, "max").map_or(true, |m| x > m) {
                    o = o.set("max", x);
                }
            }
        }
        *entry = o;
    }

    let mut out = Value::obj()
        .set("day", day_name)
        .set("sessions", sessions.len())
        .set("events", ev.len())
        .set("active", active.round())
        .set("idle", idle.round())
        .set("pages", obj(&pages))
        .set("docks", obj(&docks))
        .set("heat", obj(&heat))
        .set("paths", obj(&paths))
        .set("counts", obj(&counts))
        .set("controls", Value::Obj(controls));
    let mut m = Value::obj();
    for (page, (gw, gh, mv, cl)) in mouse {
        let sparse = |g: &BTreeMap<u64, f64>| Value::Arr(g.iter().flat_map(|(c, n)| [Value::Num(*c as f64), Value::Num(*n)]).collect());
        m = m.set(&page, Value::obj().set("gw", gw).set("gh", gh).set("move", sparse(&mv)).set("click", sparse(&cl)));
    }
    out = out.set("mouse", m);

    // Load while busy only: a quiet machine's load says nothing.
    let busy: Vec<&Value> = perf.iter().filter(|r| s(r, "act").is_some_and(|a| a != "quiet")).collect();
    let mut means: Vec<f64> = busy.iter().filter_map(|r| num(r, "mean")).collect();
    means.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let worst = busy.iter().filter_map(|r| num(r, "worst")).fold(0.0, f64::max);
    let late: f64 = perf.iter().filter_map(|r| num(r, "late")).sum();
    let cpus: Vec<f64> = perf.iter().filter_map(|r| num(r, "cpu")).collect();
    let cpu = if cpus.is_empty() { 0.0 } else { cpus.iter().sum::<f64>() / cpus.len() as f64 };
    out.set(
        "perf",
        Value::obj()
            .set("rows", perf.len())
            .set("busy", busy.len())
            .set("p50", percentile(&means, 0.5))
            .set("p95", percentile(&means, 0.95))
            .set("worst", worst)
            .set("late", late)
            .set("cpu", (cpu * 10.0).round() / 10.0)
            .set("cpuMax", perf.iter().filter_map(|r| num(r, "cpuMax")).fold(0.0, f64::max))
            .set("rss", perf.iter().filter_map(|r| num(r, "rss")).fold(0.0, f64::max)),
    )
}

// ------------------------------------------------------------- the purge

fn read_lines(path: &Path) -> Vec<Value> {
    std::fs::read_to_string(path).map(|t| t.lines().filter_map(json::parse).collect()).unwrap_or_default()
}

/// Keep only the lines of `path` that `keep` says to; the file goes when
/// nothing is left. Returns the bytes removed.
fn rewrite(path: &Path, keep: impl Fn(&Value) -> bool) -> u64 {
    let Ok(text) = std::fs::read_to_string(path) else { return 0 };
    let before = text.len() as u64;
    let kept: Vec<&str> = text.lines().filter(|l| json::parse(l).is_some_and(|v| keep(&v))).collect();
    if kept.is_empty() {
        let _ = std::fs::remove_file(path);
        return before;
    }
    if kept.len() == text.lines().count() {
        return 0;
    }
    let body = kept.join("\n") + "\n";
    let tmp = path.with_extension("tmp");
    if std::fs::write(&tmp, &body).is_ok() && std::fs::rename(&tmp, path).is_ok() {
        before.saturating_sub(body.len() as u64)
    } else {
        0
    }
}

/// Summarise every finished day not yet summarised, then delete what is past
/// its age, then trim to the cap. `now_ms` is passed in so tests can choose it.
pub fn purge(data_dir: &Path, now_ms: f64) -> Value {
    let r = settings(data_dir);
    let d = dir(data_dir);
    let today = day(now_ms);
    let _guard = analytics::lock();

    // ---- summaries for finished days
    let daily_path = d.join("DAILY.jsonl");
    let done: BTreeSet<String> = read_lines(&daily_path).iter().filter_map(|v| s(v, "day").map(String::from)).collect();
    let mut ev_by_day: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    let mut perf_by_day: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for (n, _) in files(data_dir) {
        let into = match kind_of(&n) {
            Kind::Events => &mut ev_by_day,
            Kind::Perf => &mut perf_by_day,
            _ => continue,
        };
        for v in read_lines(&d.join(&n)) {
            if let Some(t) = num(&v, "t") {
                let dn = day(t);
                if dn < today && !done.contains(&dn) {
                    into.entry(dn).or_default().push(v);
                }
            }
        }
    }
    let days: BTreeSet<String> = ev_by_day.keys().chain(perf_by_day.keys()).cloned().collect();
    let mut summarised = 0;
    if !days.is_empty() {
        let mut out = String::new();
        for dn in &days {
            let e = ev_by_day.remove(dn).unwrap_or_default();
            let p = perf_by_day.remove(dn).unwrap_or_default();
            out.push_str(&summarise_day(dn, &e, &p).to_string());
            out.push('\n');
            summarised += 1;
        }
        if std::fs::create_dir_all(&d).is_ok() {
            use std::io::Write;
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&daily_path) {
                let _ = f.write_all(out.as_bytes());
            }
        }
    }

    // ---- by age
    let cutoff = |days: u32| now_ms - days as f64 * DAY_MS;
    let mut removed = 0u64;
    for (n, _) in files(data_dir) {
        let p = d.join(&n);
        removed += match kind_of(&n) {
            Kind::Events => { let c = cutoff(r.events); rewrite(&p, |v| num(v, "t").is_some_and(|t| t >= c)) }
            Kind::Spikes => { let c = cutoff(r.spikes); rewrite(&p, |v| num(v, "t").is_some_and(|t| t >= c)) }
            Kind::Perf => {
                // A whole day per file: it goes when its day is past.
                let keep_from = day(cutoff(r.perf));
                if stamp(&n) < keep_from.as_str() {
                    let len = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                    if std::fs::remove_file(&p).is_ok() { len } else { 0 }
                } else {
                    0
                }
            }
            Kind::Daily => {
                let keep_from = day(cutoff(r.daily));
                rewrite(&p, |v| s(v, "day").is_some_and(|dn| dn >= keep_from.as_str()))
            }
            Kind::Other => 0,
        };
    }

    // ---- to the cap: oldest detail first, by the date in the name, then the
    // oldest summaries.
    let cap = r.cap_mb as u64 * 1_048_576;
    let mut total: u64 = files(data_dir).iter().map(|f| f.1).sum();
    if total > cap {
        let mut detail: Vec<(String, String, u64)> = files(data_dir)
            .into_iter()
            .filter(|(n, _)| matches!(kind_of(n), Kind::Events | Kind::Perf | Kind::Spikes))
            .map(|(n, len)| (stamp(&n).to_string(), n, len))
            .collect();
        detail.sort();
        for (_, n, len) in detail {
            if total <= cap {
                break;
            }
            if std::fs::remove_file(d.join(&n)).is_ok() {
                total -= len;
                removed += len;
            }
        }
        while total > cap {
            let lines = read_lines(&daily_path);
            if lines.len() <= 1 {
                break;
            }
            let drop = (lines.len() / 10).max(1);
            let oldest: BTreeSet<String> = lines.iter().take(drop).filter_map(|v| s(v, "day").map(String::from)).collect();
            let freed = rewrite(&daily_path, |v| s(v, "day").is_some_and(|dn| !oldest.contains(dn)));
            if freed == 0 {
                break;
            }
            total -= freed.min(total);
            removed += freed;
        }
    }

    let report = Value::obj()
        .set("at", now_ms)
        .set("summarised", summarised as f64)
        .set("removed", removed as f64)
        .set("bytes", files(data_dir).iter().map(|f| f.1).sum::<u64>() as f64);
    let _ = std::fs::write(d.join("PURGE.json"), report.to_string());
    report
}

fn now_ms() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}

/// Thirty seconds after start, then daily; an export in progress puts it off
/// by ten minutes.
pub fn start(app: Arc<App>) {
    let _ = std::thread::Builder::new().name("analytics-purge".into()).spawn(move || {
        std::thread::sleep(Duration::from_secs(30));
        loop {
            if app.export.running.load(Ordering::Relaxed) || crate::video::job().running.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_secs(600));
                continue;
            }
            purge(&app.data_dir, now_ms());
            std::thread::sleep(Duration::from_secs(86_400));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("retention-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    const DAY4: f64 = 1_793_750_400_000.0; // 2026-11-04T00:00Z

    fn put(d: &Path, name: &str, lines: &[String]) {
        for l in lines {
            analytics::append_line(d, name, l).unwrap();
        }
    }

    #[test]
    fn settings_default_merge_and_clamp() {
        let d = scratch("settings");
        assert_eq!(settings(&d), Retention::default());
        let r = settings(&d).merge(&json::parse(r#"{"events":7,"capMB":1,"perf":"x"}"#).unwrap());
        assert_eq!(r.events, 7);
        assert_eq!(r.cap_mb, 5);
        assert_eq!(r.perf, 30);
        save_settings(&d, &r).unwrap();
        assert_eq!(settings(&d), r);
    }

    #[test]
    fn a_day_is_summarised_with_time_controls_paths_and_load() {
        let t = DAY4 + 3_600_000.0;
        let ev: Vec<Value> = [
            format!(r#"{{"t":{t},"s":"a","k":"session","m":"overview"}}"#),
            format!(r#"{{"t":{},"s":"a","k":"mode","m":"edit","d":{{"from":"overview"}}}}"#, t + 10_000.0),
            format!(r#"{{"t":{},"s":"a","k":"ctl","m":"edit","dk":"stretch","c":"g","ck":"slider","p":"grainControls","min":5,"max":9,"to":7,"lo":0,"hi":10}}"#, t + 20_000.0),
            format!(r#"{{"t":{},"s":"a","k":"ctl","m":"edit","dk":"stretch","c":"g","min":2,"max":3,"to":3}}"#, t + 200_000.0),
            format!(r#"{{"t":{},"s":"a","k":"mouse","m":"edit","d":{{"gw":4,"gh":2,"move":[1,3],"click":[]}}}}"#, t + 1.0),
            format!(r#"{{"t":{},"s":"a","k":"mouse","m":"edit","d":{{"gw":4,"gh":2,"move":[1,2,5,1],"click":[5,1]}}}}"#, t + 2.0),
        ]
        .iter()
        .map(|l| json::parse(l).unwrap())
        .collect();
        let perf: Vec<Value> = [
            r#"{"t":1,"act":"play","mean":0.2,"worst":0.5,"late":0,"cpu":40}"#,
            r#"{"t":2,"act":"play","mean":0.6,"worst":1.2,"late":3,"cpu":80}"#,
            r#"{"t":3,"act":"quiet","mean":0.0,"worst":0.0,"cpu":0}"#,
        ]
        .iter()
        .map(|l| json::parse(l).unwrap())
        .collect();
        let sum = summarise_day("2026-11-04", &ev, &perf);
        assert_eq!(num(&sum, "sessions"), Some(1.0));
        // 10 s on Browse, 10 s plus a capped 60 s on Edit, the rest idle.
        assert_eq!(num(sum.get("pages").unwrap(), "overview"), Some(10_000.0));
        assert_eq!(num(sum.get("pages").unwrap(), "edit"), Some(70_000.0));
        assert_eq!(num(&sum, "idle"), Some(120_000.0));
        assert_eq!(num(sum.get("docks").unwrap(), "stretch"), Some(60_000.0));
        let g = sum.get("controls").unwrap().get("g").unwrap();
        assert_eq!((num(g, "n"), num(g, "min"), num(g, "max"), num(g, "hi")), (Some(2.0), Some(2.0), Some(9.0), Some(10.0)));
        assert_eq!(num(sum.get("paths").unwrap(), "overview>edit"), Some(1.0));
        assert_eq!(num(sum.get("heat").unwrap(), "grainControls"), Some(1.0));
        let m = sum.get("mouse").unwrap().get("edit").unwrap();
        assert_eq!(m.get("move").unwrap().to_string(), "[1,5,5,1]");
        let p = sum.get("perf").unwrap();
        assert_eq!((num(p, "busy"), num(p, "worst"), num(p, "late"), num(p, "cpu")), (Some(2.0), Some(1.2), Some(3.0), Some(40.0)));
    }

    #[test]
    fn purge_summarises_finished_days_once_then_deletes_by_age() {
        let d = scratch("purge");
        let old = DAY4 - 100.0 * DAY_MS;
        let recent = DAY4 - DAY_MS + 5_000.0;
        put(&d, &analytics::month_file(old), &[format!(r#"{{"t":{old},"s":"a","k":"click","c":"x","p":"lane"}}"#)]);
        put(&d, &analytics::month_file(recent), &[format!(r#"{{"t":{recent},"s":"b","k":"click","c":"y","p":"lane"}}"#)]);
        put(&d, &crate::perf::day_file(old), &[format!(r#"{{"t":{old},"act":"play","mean":0.3}}"#)]);
        put(&d, &crate::perf::day_file(recent), &[format!(r#"{{"t":{recent},"act":"play","mean":0.4}}"#)]);
        // Today's events are not summarised: the day is not over.
        put(&d, &analytics::month_file(DAY4 + 1.0), &[format!(r#"{{"t":{},"s":"c","k":"click"}}"#, DAY4 + 1.0)]);

        let rep = purge(&d, DAY4 + 3_600_000.0);
        assert_eq!(num(&rep, "summarised"), Some(2.0));
        assert!(num(&rep, "removed").unwrap() > 0.0);
        let daily = read_lines(&dir(&d).join("DAILY.jsonl"));
        assert_eq!(daily.iter().filter_map(|v| s(v, "day")).collect::<Vec<_>>(), [day(old), day(recent)]);
        // Detail past 90 days is gone; the recent day and today stay.
        let all = json::parse(&analytics::read(&d, 0.0, 1e15)).unwrap();
        assert_eq!(all.arr().unwrap().len(), 2);
        assert!(!dir(&d).join(crate::perf::day_file(old)).exists());
        assert!(dir(&d).join(crate::perf::day_file(recent)).exists());
        // A second run summarises nothing new.
        assert_eq!(num(&purge(&d, DAY4 + 3_600_000.0), "summarised"), Some(0.0));
        assert!(dir(&d).join("PURGE.json").exists());
    }

    #[test]
    fn over_the_cap_the_oldest_detail_goes_first() {
        let d = scratch("cap");
        save_settings(&d, &Retention { cap_mb: 5, ..Retention::default() }).unwrap();
        let big = "x".repeat(1_048_576);
        // Six files of 1 MB each across six days, all within the ages.
        for i in 0..6 {
            let t = DAY4 - (6 - i) as f64 * DAY_MS;
            // Filler the parser rejects at its first byte: size without cost.
            put(&d, &crate::perf::day_file(t), &[format!(r#"{{"t":{t},"act":"quiet"}}"#), format!("#{big}")]);
        }
        purge(&d, DAY4 + 1.0);
        let left: Vec<String> = files(&d).into_iter().map(|f| f.0).filter(|n| n.starts_with("perf-")).collect();
        assert!(!left.contains(&crate::perf::day_file(DAY4 - 6.0 * DAY_MS)), "{left:?}");
        assert!(left.contains(&crate::perf::day_file(DAY4 - DAY_MS)), "{left:?}");
        let total: u64 = files(&d).iter().map(|f| f.1).sum();
        assert!(total <= 5 * 1_048_576, "{total}");
    }

    #[test]
    fn storage_reports_sizes_by_kind() {
        let d = scratch("storage");
        put(&d, "events-2026-11.jsonl", &[r#"{"t":1}"#.to_string()]);
        put(&d, "perf-2026-11-04.jsonl", &[r#"{"t":1}"#.to_string()]);
        let st = storage(&d);
        assert_eq!(num(st.get("kinds").unwrap(), "events"), Some(8.0));
        assert_eq!(num(st.get("kinds").unwrap(), "perf"), Some(8.0));
        assert_eq!(num(st.get("retention").unwrap(), "events"), Some(90.0));
    }
}
