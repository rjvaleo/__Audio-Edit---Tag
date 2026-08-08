//! Smoke test against a real folder: probe every file and print what we found.
use std::path::Path;

fn main() {
    let root = std::env::args().nth(1).expect("usage: scan <dir>");
    let mut ok = 0;
    let mut failed = 0;
    walk(Path::new(&root), &mut |p| {
        match audio_core::open(p) {
            Ok(mut r) => {
                let i = *r.info();
                let stats = r.stats();
                let tile = r.peak_tile(0, i.frames(), 32);
                println!(
                    "{:<34} {:?} {:?} {}Hz {}ch {}bit {:.2}s  peak {:>7.2}dB  cols {}",
                    p.file_name().unwrap().to_string_lossy(),
                    i.container, i.codec, i.sample_rate, i.channels, i.bits,
                    i.duration_secs(),
                    stats.as_ref().map(|s| s.peak_dbfs).unwrap_or(f32::NAN),
                    tile.map(|t| t.columns).unwrap_or(0),
                );
                ok += 1;
            }
            Err(e) => {
                println!("{:<34} FAILED: {e}", p.file_name().unwrap().to_string_lossy());
                failed += 1;
            }
        }
    });
    println!("\n{ok} probed, {failed} failed");
}

fn walk(dir: &Path, f: &mut impl FnMut(&Path)) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = rd.filter_map(|e| e.ok()).map(|e| e.path()).collect();
    entries.sort();
    for p in entries {
        if p.is_dir() {
            walk(&p, f);
        } else if !p.file_name().map_or(true, |n| n.to_string_lossy().starts_with('.')) {
            f(&p);
        }
    }
}
