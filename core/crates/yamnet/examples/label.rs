//! Print what the model hears in each file given to it.
//!
//!     cargo run -p yamnet --release --example label -- "Audio Library/Folder"/*.wav
//!
//! Kept because the only honest way to judge a classifier on this library is to
//! read what it says about files whose answer is already known.

fn main() {
    let model = match yamnet::Model::load_default() {
        Ok(m) => m,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };

    for arg in std::env::args().skip(1) {
        let mut r = match audio_core::open(std::path::Path::new(&arg)) {
            Ok(r) => r,
            Err(e) => {
                println!("{arg}: cannot open ({e})");
                continue;
            }
        };
        let info = *r.info();
        let frames = info.frames();
        let samples = match r.read_frames(0, frames) {
            Ok(s) => s,
            Err(e) => {
                println!("{arg}: cannot read ({e})");
                continue;
            }
        };
        let mono = yamnet::to_mono_16k(&samples, info.channels as usize, info.sample_rate);
        let t = std::time::Instant::now();
        match model.label(&mono, 4) {
            Ok(top) => {
                let name = std::path::Path::new(&arg)
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                let words: Vec<String> = top
                    .iter()
                    .map(|d| format!("{} {:.2}", d.label, d.score))
                    .collect();
                println!(
                    "{:<26} {:>5.2}s  {}   [{:?}]",
                    name,
                    frames as f32 / info.sample_rate as f32,
                    words.join(" | "),
                    t.elapsed()
                );
            }
            Err(e) => println!("{arg}: {e}"),
        }
    }
}
