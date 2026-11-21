//! What asking modules "anything to hand back?" costs a big patch at rest
//! (AUDIO-PLAN 4.11, task 055). A measurement, not a check: run it alone,
//! in a release build, with `--ignored --nocapture`.

mod common;
use common::*;
use engine_core::*;
use std::time::Instant;

#[test]
#[ignore]
fn sixty_four_modules_at_rest() {
    let (mut ctl, mut audio) = engine(RATE, exact());
    for id in 1..=64u32 {
        ctl.add(id, Box::new(Dc(0.0))).unwrap();
        ctl.connect_out(port(id, 0)).unwrap();
    }
    ctl.commit().unwrap();
    render(&mut audio, 48_000, 64);
    let mut times = Vec::new();
    for _ in 0..9 {
        let t = Instant::now();
        render(&mut audio, 480_000, 64);
        times.push(t.elapsed().as_secs_f64());
    }
    times.sort_by(f64::total_cmp);
    // 480,000 frames in 64-frame blocks is 7,500 blocks.
    println!(
        "64 modules at rest, 64-frame blocks: median {:.3} us a block (best {:.3}, worst {:.3})",
        times[4] * 1e6 / 7_500.0,
        times[0] * 1e6 / 7_500.0,
        times[8] * 1e6 / 7_500.0
    );
}
