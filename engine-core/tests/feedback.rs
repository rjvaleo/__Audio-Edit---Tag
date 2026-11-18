//! Loops of cables: refused without a delay, exact with one.

mod common;
use common::*;
use engine_core::basics::*;
use engine_core::*;

#[test]
fn a_loop_without_a_delay_is_refused() {
    let (mut ctl, mut audio) = engine(RATE, Config::default());
    ctl.add(1, Box::new(Dc(1.0))).unwrap();
    ctl.add(2, Box::new(Gain::new(0.5))).unwrap();
    ctl.add(3, Box::new(Gain::new(0.5))).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect(port(2, 0), port(3, 0)).unwrap();
    ctl.connect(port(3, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(3, 0)).unwrap();
    assert_eq!(ctl.commit(), Err(PatchError::Cycle(vec![2, 3])));
    let (l, _) = render(&mut audio, 256, 64);
    assert!(l.iter().all(|v| *v == 0.0), "nothing was sent, so nothing plays");
    // Take the loop out and the same patch is accepted.
    assert!(ctl.disconnect(port(3, 0), port(2, 0)));
    ctl.commit().unwrap();
    let (l, _) = render(&mut audio, 256, 64);
    assert!(l.iter().all(|v| *v == 0.25));
}

fn echo(block: usize) -> Vec<f32> {
    let (mut ctl, mut audio) = engine(RATE, Config::default());
    ctl.add(1, Box::new(Impulse::new())).unwrap();
    ctl.add(2, Box::new(Delay::new(64))).unwrap();
    ctl.add(3, Box::new(Gain::new(0.5))).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect(port(2, 0), port(3, 0)).unwrap();
    ctl.connect(port(3, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    render(&mut audio, 1000, block).0
}

#[test]
fn a_loop_through_a_delay_rings_exactly() {
    let out = echo(256);
    for (i, v) in out.iter().enumerate() {
        let expected = if i > 0 && i % 64 == 0 { 0.5f32.powi(i as i32 / 64 - 1) } else { 0.0 };
        assert_eq!(*v, expected, "sample {i}");
    }
}

#[test]
fn a_loop_sounds_the_same_at_any_block_size() {
    let reference = echo(256);
    for block in [1, 63, 64, 65, 1000] {
        assert_same(&format!("blocks of {block}"), &reference, &echo(block));
    }
}

#[test]
fn a_delay_can_feed_itself() {
    let (mut ctl, mut audio) = engine(RATE, Config::default());
    ctl.add(1, Box::new(Impulse::new())).unwrap();
    ctl.add(2, Box::new(Delay::new(10))).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect(port(2, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    let (l, _) = render(&mut audio, 200, 256);
    for (i, v) in l.iter().enumerate() {
        assert_eq!(*v, if i > 0 && i % 10 == 0 { 1.0 } else { 0.0 }, "sample {i}");
    }
}

#[test]
fn a_delay_outside_a_loop_just_delays() {
    let (mut ctl, mut audio) = engine(RATE, Config::default());
    ctl.add(1, Box::new(Impulse::new())).unwrap();
    ctl.add(2, Box::new(Delay::new(100))).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    let (l, _) = render(&mut audio, 300, 256);
    assert_eq!(l[100], 1.0);
    assert_eq!(l.iter().sum::<f32>(), 1.0);
}
