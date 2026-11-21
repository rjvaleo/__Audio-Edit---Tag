//! A cable adds nothing of its own. What a module puts out arrives with every
//! bit as it was, which is what lets a module in the engine be checked
//! against recorded hashes of the same code played alone.

mod common;
use common::*;
use engine_core::basics::Gain;
use engine_core::*;

const MINUS_ZERO: u32 = (-0.0f32).to_bits();

#[test]
fn the_output_carries_a_negative_zero_as_it_is() {
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Dc(-0.0))).unwrap();
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit().unwrap();
    let (l, r) = render(&mut audio, 64, 16);
    assert!(
        l.iter().chain(&r).all(|v| v.to_bits() == MINUS_ZERO),
        "adding the cable to silence turned -0.0 into {:?}",
        l[0]
    );
}

#[test]
fn two_cables_into_one_input_sum_only_each_other() {
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Dc(-0.0))).unwrap();
    ctl.add(2, Box::new(Dc(-0.0))).unwrap();
    ctl.add(3, Box::new(Gain::new(1.0))).unwrap();
    ctl.connect(port(1, 0), port(3, 0)).unwrap();
    ctl.connect(port(2, 0), port(3, 0)).unwrap();
    ctl.connect_out(port(3, 0)).unwrap();
    ctl.commit().unwrap();
    let (l, r) = render(&mut audio, 64, 16);
    assert!(
        l.iter().chain(&r).all(|v| v.to_bits() == MINUS_ZERO),
        "-0.0 + -0.0 is -0.0, but the sum started from +0.0 and gave {:?}",
        l[0]
    );
}

#[test]
fn an_input_with_no_cable_is_still_silence() {
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(3, Box::new(Gain::new(1.0))).unwrap();
    ctl.connect_out(port(3, 0)).unwrap();
    ctl.commit().unwrap();
    let (l, r) = render(&mut audio, 64, 16);
    assert!(l.iter().chain(&r).all(|v| v.to_bits() == 0));
}
