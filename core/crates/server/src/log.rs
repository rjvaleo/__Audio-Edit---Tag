//! The server's activity log: one line a step, with the time of day, to the
//! server's output. RJ, 14 Nov 2026: a stem split ran on the GPU and "nothing
//! showed up down there". Each step of a split (sending, splitting, each stem
//! arriving, reading it, done or failed), what the GPU machine says, and every
//! Make request (`/api/stems/*`, `/api/clone/*`) and any request that takes
//! longer than two seconds now write a line.

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// The local time of day, `HH:MM:SS`.
fn clock() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as libc::time_t).unwrap_or(0);
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    // SAFETY: both pointers are to locals that outlive the call. Windows (the
    // PC runs the tests) has `localtime_s`, its arguments the other way round.
    #[cfg(unix)]
    unsafe { libc::localtime_r(&secs, &mut tm) };
    #[cfg(windows)]
    unsafe { libc::localtime_s(&mut tm, &secs) };
    format!("{:02}:{:02}:{:02}", tm.tm_hour, tm.tm_min, tm.tm_sec)
}

/// One line in the activity log.
pub fn line(what: &str) {
    eprintln!("{} {}", clock(), what.trim_end());
}

/// Whether a request is one the log always tells of: the Make jobs.
pub fn always(method: &str, path: &str) -> bool {
    method == "POST" && (path.starts_with("/api/stems/") || path.starts_with("/api/clone/"))
}

/// A request that has finished: logged if it is a Make job or took long.
pub fn request(method: &str, path: &str, status: u16, took: Duration) {
    if always(method, path) || took > Duration::from_secs(2) {
        line(&format!("{method} {path} → {status} in {}", secs(took)));
    }
}

/// `1.2 s`, `3 min 4 s`.
pub fn secs(d: Duration) -> String {
    let s = d.as_secs_f64();
    if s < 60.0 { format!("{s:.1} s") } else { format!("{} min {} s", (s / 60.0) as u64, (s % 60.0) as u64) }
}

/// `12.3 MB`.
pub fn mb(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / 1_048_576.0)
}

/// Since `t0`, as [`secs`] has it.
pub fn since(t0: Instant) -> String {
    secs(t0.elapsed())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn make_jobs_are_always_told_of_and_the_rest_only_when_slow() {
        assert!(always("POST", "/api/stems/split"));
        assert!(always("POST", "/api/clone/keep"));
        assert!(!always("GET", "/api/stems"));
        assert!(!always("POST", "/api/engine/transport"));
        assert_eq!(clock().len(), 8);
        assert_eq!(mb(3 * 1_048_576 / 2), "1.5 MB");
        assert_eq!(secs(Duration::from_millis(1234)), "1.2 s");
        assert_eq!(secs(Duration::from_secs(185)), "3 min 5 s");
    }
}
