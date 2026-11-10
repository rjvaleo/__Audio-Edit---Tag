//! Analytics.

use super::*;

pub(super) fn api_analytics_append(app: &Arc<App>, req: &Request) -> Response {
    match crate::analytics::append(&app.data_dir, &String::from_utf8_lossy(&req.body)) {
        Ok(n) => Response::json(Value::obj().set("ok", true).set("kept", n).to_string()),
        Err(e) => Response::error(400, &e),
    }
}

/// `?from=&to=` in epoch milliseconds; either may be left out.
pub(super) fn api_analytics_read(app: &Arc<App>, req: &Request) -> Response {
    let from: f64 = req.number("from", 0.0);
    let to: f64 = req.number("to", 1e15);
    let events = crate::analytics::read(&app.data_dir, from, to);
    let cat = crate::analytics::catalogue(&app.data_dir).to_string();
    // The daily summaries in the range too, for the days whose detail has
    // already been purged. The interface uses a summary only for a day it has
    // no events for.
    let (lo, hi) = (crate::analytics::day(from.max(0.0)), crate::analytics::day(to.clamp(0.0, 1e15) - 1.0));
    let daily: Vec<String> = std::fs::read_to_string(crate::analytics::dir(&app.data_dir).join("DAILY.jsonl"))
        .map(|t| {
            t.lines()
                .filter(|l| {
                    json::parse(l)
                        .and_then(|v| v.get("day").and_then(|d| d.as_str()).map(|d| d >= lo.as_str() && d <= hi.as_str()))
                        .unwrap_or(false)
                })
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();
    Response::json(format!(r#"{{"events":{events},"catalogue":{cat},"daily":[{}]}}"#, daily.join(",")))
}

pub(super) fn now_epoch_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

/// Performance rows, spikes and export timings in `?from=&to=`.
pub(super) fn api_analytics_perf(app: &Arc<App>, req: &Request) -> Response {
    let from: f64 = req.number("from", 0.0);
    let to: f64 = req.number("to", 1e15);
    let d = &app.data_dir;
    Response::json(format!(
        r#"{{"perf":{},"spikes":{},"exports":{}}}"#,
        crate::analytics::read_kind(d, "perf-", from, to),
        crate::analytics::read_kind(d, "spikes-", from, to),
        crate::analytics::read_kind(d, "exports-", from, to),
    ))
}

pub(super) fn api_analytics_retention(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let r = crate::retention::settings(&app.data_dir).merge(&v);
    match crate::retention::save_settings(&app.data_dir, &r) {
        Ok(()) => Response::json(crate::retention::storage(&app.data_dir).to_string()),
        Err(e) => Response::error(500, &e),
    }
}

pub(super) fn api_analytics_catalogue(app: &Arc<App>, req: &Request) -> Response {
    match crate::analytics::merge_catalogue(&app.data_dir, &String::from_utf8_lossy(&req.body)) {
        Ok(n) => Response::json(Value::obj().set("ok", true).set("added", n).to_string()),
        Err(e) => Response::error(400, &e),
    }
}

pub(super) fn api_analytics_clear(app: &Arc<App>) -> Response {
    match crate::analytics::clear(&app.data_dir) {
        Ok(()) => Response::json(Value::obj().set("ok", true).to_string()),
        Err(e) => Response::error(500, &e),
    }
}

// ------------------------------------------------------------- HyperStretch
