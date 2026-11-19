#![allow(dead_code)]
use serde_json::{json, Value};
use std::{path::PathBuf, process::Command};

pub const SR: usize = 48_000;
#[cfg(unix)]
pub fn cpu_now() -> f64 {
    let mut t = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    // SAFETY: the timespec is writable; a failed clock is not a measurement.
    assert_eq!(unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t) }, 0);
    t.tv_sec as f64 + t.tv_nsec as f64 * 1e-9
}
#[cfg(not(unix))]
pub fn cpu_now() -> f64 { panic!("this measurement requires the thread CPU clock") }

pub fn measure(case: &str, block: usize, mut render: impl FnMut(usize)) -> Value {
    // Half a second before timing; then exactly five seconds, including the
    // short final block. Each time is divided by that block's actual slot.
    for _ in 0..(SR / 2).div_ceil(block) { render(block); }
    let mut times = Vec::new();
    let mut left = SR * 5;
    while left > 0 {
        let n = left.min(block);
        let start = cpu_now();
        render(n);
        times.push((cpu_now() - start) * 100.0 * SR as f64 / n as f64);
        left -= n;
    }
    times.sort_by(f64::total_cmp);
    let median = times[times.len() / 2];
    let p99 = times[((times.len() as f64 * 0.99).ceil() as usize - 1).min(times.len() - 1)];
    let worst = *times.last().unwrap();
    let over50 = times.iter().filter(|&&t| t > 50.0).count();
    let over100 = times.iter().filter(|&&t| t > 100.0).count();
    println!("{case:42} {block:4} median {median:9.3}% p99 {p99:9.3}% worst {worst:9.3}% >50 {over50:5} >100 {over100:5}");
    json!({"case":case,"block":block,"median_pct":median,"p99_pct":p99,"worst_pct":worst,"over_50":over50,"over_100":over100})
}
fn command(cmd: &str, args: &[&str]) -> String {
    let out = Command::new(cmd).args(args).output().expect("measurement metadata");
    assert!(out.status.success(), "{cmd} {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8(out.stdout).unwrap().trim().to_owned()
}
pub fn write(name: &str, rows: Vec<Value>) {
    let data = json!({"machine":command("uname", &["-n"]),"cpu":command("sysctl", &["-n","machdep.cpu.brand_string"]),
        "commit":command("git", &["rev-parse","HEAD"]),"clock":"CLOCK_THREAD_CPUTIME_ID","rows":rows});
    let path = std::env::var_os("BENCH_OUT").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(format!("target/{name}-worst-block.json")));
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).unwrap(); }
    std::fs::write(&path, serde_json::to_vec_pretty(&data).unwrap()).unwrap();
    println!("JSON {}", path.display());
}
