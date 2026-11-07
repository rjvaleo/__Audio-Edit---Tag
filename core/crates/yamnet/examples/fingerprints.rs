//! Fingerprint a list of library files and print one JSON line each, for
//! looking at what the sound map will be laid out by without a server.
//!
//!   cargo run --release -p yamnet --example fingerprints -- <library> <list.txt>
//!
//! `list.txt` is one path per line, relative to `<library>`.

use std::io::Write;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (root, list) = (std::path::PathBuf::from(&args[1]), std::fs::read_to_string(&args[2]).unwrap());
    let model = yamnet::Model::load_default().expect("model");
    let out = std::io::stdout();
    let mut out = out.lock();
    for rel in list.lines().filter(|l| !l.is_empty()) {
        let Ok(mut r) = audio_core::open(&root.join(rel)) else { continue };
        let info = *r.info();
        let Ok(samples) = r.read_frames(0, info.frames()) else { continue };
        let mono = yamnet::to_mono_16k(&samples, info.channels as usize, info.sample_rate);
        let Ok((_, e)) = model.listen(&mono, 3) else { continue };
        let v: Vec<String> = e.iter().map(|x| format!("{:.4}", x)).collect();
        writeln!(out, "{{\"p\":{:?},\"e\":[{}]}}", rel, v.join(",")).unwrap();
    }
}
