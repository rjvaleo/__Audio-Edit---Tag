//! Opens the real output device and plays for a moment.
//!
//! Not a test: it needs a sound card, and a machine without one is not a
//! failure. Run it by hand with `cargo run -p engine --example smoke`.

use engine::{Engine, Source};
use fx::grain::{Grain, StreamParams};
use std::sync::Arc;

fn main() {
    let frames = 96_000;
    let samples: Vec<f32> = (0..frames)
        .map(|i| (i as f32 * 440.0 * std::f32::consts::TAU / 48_000.0).sin() * 0.25)
        .collect();
    let source = Arc::new(Source { samples, channels: 1 });

    let params = StreamParams {
        in_frames: frames,
        sample_rate: 48_000,
        ratio: 1.0,
        semitones: 0.0,
        window_ms: 40.0,
        grain: Grain::default(),
    };

    let engine = match Engine::start(params, source) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("could not start: {e}");
            std::process::exit(1);
        }
    };
    println!("device: {} Hz, {} ch", engine.sample_rate, engine.channels);

    engine.shared().play();
    let mut last = 0;
    for _ in 0..10 {
        std::thread::sleep(std::time::Duration::from_millis(100));
        let p = engine.shared().position();
        println!("  position {p} (+{})", p - last);
        last = p;
    }

    if last == 0 {
        eprintln!("FAIL: the callback never ran");
        std::process::exit(1);
    }
    println!("ok: callback ran, {last} frames rendered");
}
