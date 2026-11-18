//! Nothing in the engine's source may be able to make a thread wait: no
//! lock, no channel that blocks, no sleep, no file, no network, no printing.

use std::fs;
use std::path::Path;

const FORBIDDEN: [&str; 14] = [
    "Mutex", "RwLock", "Condvar", "Barrier", "mpsc", "thread::sleep", "thread::park", "std::fs",
    "std::net", "std::io", "println!", "eprintln!", "dbg!", ".lock()",
];

#[test]
fn the_engines_source_has_nothing_that_waits() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = 0;
    let mut lines = 0;
    for entry in fs::read_dir(&src).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        files += 1;
        for (number, line) in fs::read_to_string(&path).unwrap().lines().enumerate() {
            let code = line.trim_start();
            if code.starts_with("//") {
                continue;
            }
            lines += 1;
            for word in FORBIDDEN {
                assert!(
                    !code.contains(word),
                    "{}:{}: `{word}` can make a thread wait",
                    path.display(),
                    number + 1
                );
            }
        }
    }
    assert!(files >= 9 && lines > 600, "the scan found the engine: {files} files, {lines} lines");
}
