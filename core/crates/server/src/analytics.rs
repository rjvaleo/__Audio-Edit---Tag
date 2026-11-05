//! How the app is used, kept on this machine.
//!
//! The interface records what it is asked to do — pages, dock tabs, every
//! control touched, effects, presets, edits, exports — and sends it here in
//! batches. This module only stores and returns it: one JSON line per event,
//! a file per month, plus a catalogue of every control the interface has ever
//! shown, which is what makes "never touched" answerable. Nothing here talks to
//! anything but the disk. See `docs/ANALYTICS.md`.
//!
//! The events are opaque to the server apart from `t`, the time, which decides
//! the month file and the range a read returns. What they mean is the
//! interface's business, so a new kind of event needs no change here.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::json::{self, Value};

/// Appends from two batches landing at once must not interleave mid-line.
static WRITE: Mutex<()> = Mutex::new(());

pub fn dir(data_dir: &Path) -> PathBuf {
    data_dir.join("ANALYTICS")
}

fn catalogue_path(data_dir: &Path) -> PathBuf {
    dir(data_dir).join("CATALOGUE.json")
}

/// `events-YYYY-MM.jsonl` for a time in epoch milliseconds, by UTC.
pub fn month_file(t_ms: f64) -> String {
    let (y, m, _) = civil(t_ms.div_euclid(86_400_000.0) as i64);
    format!("events-{y:04}-{m:02}.jsonl")
}

/// Days since 1970-01-01 to a calendar date (Hinnant's algorithm).
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn time_of(v: &Value) -> Option<f64> {
    match v.get("t") {
        Some(Value::Num(t)) if t.is_finite() && *t >= 0.0 => Some(*t),
        _ => None,
    }
}

/// Store a batch: a JSON array of event objects, or `{"events": [...]}`.
/// Events without a usable `t` are dropped rather than failing the batch —
/// one bad event must not cost the rest. Returns how many were kept.
pub fn append(data_dir: &Path, body: &str) -> Result<usize, String> {
    let v = json::parse(body).ok_or("invalid JSON")?;
    let list = match &v {
        Value::Arr(a) => a.as_slice(),
        Value::Obj(_) => v.get("events").and_then(|e| e.arr()).ok_or("no events")?,
        _ => return Err("expected a list of events".into()),
    };
    let mut by_month: BTreeMap<String, String> = BTreeMap::new();
    let mut kept = 0;
    for e in list {
        let (Value::Obj(_), Some(t)) = (e, time_of(e)) else { continue };
        let lines = by_month.entry(month_file(t)).or_default();
        lines.push_str(&e.to_string());
        lines.push('\n');
        kept += 1;
    }
    if kept == 0 {
        return Ok(0);
    }
    let _guard = WRITE.lock().unwrap_or_else(|p| p.into_inner());
    let d = dir(data_dir);
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    for (name, lines) in by_month {
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(d.join(name))
            .map_err(|e| e.to_string())?;
        f.write_all(lines.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(kept)
}

/// Every event with `from <= t < to`, oldest first, as one JSON array text.
/// The lines are passed through as they were stored, not rebuilt.
pub fn read(data_dir: &Path, from: f64, to: f64) -> String {
    let d = dir(data_dir);
    let mut names: Vec<String> = std::fs::read_dir(&d)
        .map(|it| {
            it.filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| n.starts_with("events-") && n.ends_with(".jsonl"))
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    // Month files outside the range are skipped without being opened.
    let first = month_file(from.max(0.0));
    let last = month_file(to.clamp(0.0, 1e15) - 1.0);
    let mut rows: Vec<(f64, &str)> = Vec::new();
    let texts: Vec<String> = names
        .iter()
        .filter(|n| n.as_str() >= first.as_str() && n.as_str() <= last.as_str())
        .filter_map(|n| std::fs::read_to_string(d.join(n)).ok())
        .collect();
    for text in &texts {
        for line in text.lines() {
            let Some(v) = json::parse(line) else { continue };
            let Some(t) = time_of(&v) else { continue };
            if t >= from && t < to {
                rows.push((t, line));
            }
        }
    }
    rows.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut out = String::with_capacity(rows.iter().map(|r| r.1.len() + 1).sum::<usize>() + 2);
    out.push('[');
    for (i, (_, line)) in rows.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(line);
    }
    out.push(']');
    out
}

/// The controls the interface has shown, keyed by control id.
pub fn catalogue(data_dir: &Path) -> Value {
    std::fs::read_to_string(catalogue_path(data_dir))
        .ok()
        .and_then(|s| json::parse(&s))
        .filter(|v| matches!(v, Value::Obj(_)))
        .unwrap_or_else(Value::obj)
}

/// Merge `{"controls": [{"c": id, ...}, ...]}` into the catalogue. A control
/// already known keeps what it had and takes any new fields; nothing is ever
/// removed, since a control can be on a panel that simply was not open.
pub fn merge_catalogue(data_dir: &Path, body: &str) -> Result<usize, String> {
    let v = json::parse(body).ok_or("invalid JSON")?;
    let list = v.get("controls").and_then(|c| c.arr()).ok_or("no controls")?;
    let _guard = WRITE.lock().unwrap_or_else(|p| p.into_inner());
    let Value::Obj(mut all) = catalogue(data_dir) else { unreachable!() };
    let mut added = 0;
    for c in list {
        let Some(id) = c.get("c").and_then(|s| s.as_str()).filter(|s| !s.is_empty()) else {
            continue;
        };
        let Some(fields) = c.as_obj() else { continue };
        let entry = all.entry(id.to_string()).or_insert_with(|| {
            added += 1;
            Value::obj()
        });
        if let Value::Obj(m) = entry {
            for (k, val) in fields {
                if k != "c" {
                    m.insert(k.clone(), val.clone());
                }
            }
        }
    }
    let d = dir(data_dir);
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let tmp = d.join("CATALOGUE.tmp");
    std::fs::write(&tmp, Value::Obj(all).to_string()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, catalogue_path(data_dir)).map_err(|e| e.to_string())?;
    Ok(added)
}

/// Forget everything recorded. The catalogue goes too: it is a record of what
/// was on screen, which is usage as much as the events are.
pub fn clear(data_dir: &Path) -> Result<(), String> {
    let _guard = WRITE.lock().unwrap_or_else(|p| p.into_inner());
    let d = dir(data_dir);
    match std::fs::remove_dir_all(&d) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("analytics-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    // 2026-11-04T12:00:00Z and 2026-10-31T23:59:59Z.
    const NOV: f64 = 1_793_793_600_000.0;
    const OCT: f64 = 1_793_491_199_000.0;

    #[test]
    fn a_time_lands_in_its_utc_month() {
        assert_eq!(month_file(0.0), "events-1970-01.jsonl");
        assert_eq!(month_file(NOV), "events-2026-11.jsonl");
        assert_eq!(month_file(OCT), "events-2026-10.jsonl");
        assert_eq!(month_file(951_782_400_000.0), "events-2000-02.jsonl"); // 29 Feb 2000
    }

    #[test]
    fn a_batch_is_appended_by_month_and_read_back_in_order() {
        let d = scratch("append");
        let body = format!(
            r#"[{{"t":{},"k":"mode","m":"edit"}},{{"t":{},"k":"ctl","c":"grainSize"}},{{"t":{},"k":"click"}}]"#,
            NOV + 5.0,
            OCT,
            NOV
        );
        assert_eq!(append(&d, &body).unwrap(), 3);
        assert!(dir(&d).join("events-2026-11.jsonl").exists());
        assert!(dir(&d).join("events-2026-10.jsonl").exists());
        let all = json::parse(&read(&d, 0.0, 1e15)).unwrap();
        let ks: Vec<&str> = all.arr().unwrap().iter().map(|e| e.get("k").unwrap().as_str().unwrap()).collect();
        assert_eq!(ks, ["ctl", "click", "mode"]);
    }

    #[test]
    fn a_second_batch_appends_rather_than_replaces() {
        let d = scratch("twice");
        append(&d, &format!(r#"[{{"t":{NOV},"k":"a"}}]"#)).unwrap();
        append(&d, &format!(r#"{{"events":[{{"t":{},"k":"b"}}]}}"#, NOV + 1.0)).unwrap();
        assert_eq!(json::parse(&read(&d, 0.0, 1e15)).unwrap().arr().unwrap().len(), 2);
    }

    #[test]
    fn the_range_is_half_open_and_skips_other_months() {
        let d = scratch("range");
        append(&d, &format!(r#"[{{"t":{OCT},"k":"old"}},{{"t":{NOV},"k":"new"}}]"#)).unwrap();
        let got = json::parse(&read(&d, NOV, NOV + 1.0)).unwrap();
        assert_eq!(got.arr().unwrap().len(), 1);
        assert_eq!(got.arr().unwrap()[0].get("k").unwrap().as_str(), Some("new"));
        assert_eq!(json::parse(&read(&d, OCT, NOV)).unwrap().arr().unwrap().len(), 1);
        assert_eq!(read(&d, NOV + 10.0, NOV + 20.0), "[]");
    }

    #[test]
    fn events_without_a_time_are_dropped_not_fatal() {
        let d = scratch("bad");
        let n = append(&d, &format!(r#"[{{"k":"no-t"}},{{"t":"x"}},3,{{"t":{NOV},"k":"ok"}}]"#)).unwrap();
        assert_eq!(n, 1);
        assert!(append(&d, "not json").is_err());
        assert_eq!(append(&d, "[]").unwrap(), 0);
    }

    #[test]
    fn nothing_recorded_reads_as_empty() {
        let d = scratch("empty");
        assert_eq!(read(&d, 0.0, 1e15), "[]");
        assert_eq!(catalogue(&d), Value::obj());
    }

    #[test]
    fn the_catalogue_merges_and_never_forgets() {
        let d = scratch("cat");
        let n = merge_catalogue(&d, r#"{"controls":[{"c":"grainSize","ck":"slider","p":"stretch"},{"c":""}]}"#).unwrap();
        assert_eq!(n, 1);
        let n = merge_catalogue(&d, r#"{"controls":[{"c":"grainSize","l":"Grain size"},{"c":"playBtn","ck":"button"}]}"#).unwrap();
        assert_eq!(n, 1);
        let cat = catalogue(&d);
        let g = cat.get("grainSize").unwrap();
        assert_eq!(g.get("ck").unwrap().as_str(), Some("slider"));
        assert_eq!(g.get("l").unwrap().as_str(), Some("Grain size"));
        assert!(cat.get("playBtn").is_some());
    }

    #[test]
    fn clear_forgets_events_and_catalogue() {
        let d = scratch("clear");
        append(&d, &format!(r#"[{{"t":{NOV}}}]"#)).unwrap();
        merge_catalogue(&d, r#"{"controls":[{"c":"x"}]}"#).unwrap();
        clear(&d).unwrap();
        assert_eq!(read(&d, 0.0, 1e15), "[]");
        assert_eq!(catalogue(&d), Value::obj());
        clear(&d).unwrap();
    }
}
