//! A mode switch reaches the running rack as a swap of one slot (SUITE-PLAN
//! §2.0): the new effect is built off the audio thread, the slot fades from
//! the old to the new over 20 ms with an equal-power curve, both running, and
//! every other slot goes on untouched — its delay lines and tails are not
//! rebuilt. The old effect waits in `take_retired`, to be dropped off the
//! audio thread.

use fx::{prism, swap_fade_frames, Effect, Gain, Rack};

const SR: u32 = 48_000;
const CH: usize = 2;

fn tone(frames: usize, hz: f32) -> Vec<f32> {
    let mut v = Vec::with_capacity(frames * CH);
    for n in 0..frames {
        let s = 0.4 * (std::f32::consts::TAU * hz * n as f32 / SR as f32).sin();
        v.extend([s, s * 0.8]);
    }
    v
}

fn echo() -> Box<dyn Effect> {
    prism::make("echo", SR, CH, &[("feedback".into(), 0.8)]).unwrap()
}

fn gain(db: f32) -> Box<dyn Effect> {
    Box::new(Gain { db })
}

fn run(rack: &mut Rack, buf: &mut [f32]) {
    for b in buf.chunks_mut(256 * CH) {
        rack.process(b, CH, SR);
    }
}

#[test]
fn twenty_ms_is_the_fade() {
    assert_eq!(swap_fade_frames(48_000), 960);
    assert_eq!(swap_fade_frames(44_100), 882);
}

#[test]
fn the_other_slots_keep_their_tails_and_after_the_fade_the_slot_is_its_new_effect() {
    // An echo with a long tail ahead of the slot being switched. A whole-rack
    // rebuild would empty the echo; a slot swap must not touch it.
    let input = tone(48_000, 330.0);
    let at = 24_000 * CH;
    let mut swapped = Rack::new();
    swapped.push(echo());
    swapped.push(gain(0.0));
    swapped.reserve_mix(256 * CH);
    let mut a = input.clone();
    run(&mut swapped, &mut a[..at]);
    assert!(swapped.swap_slot(1, gain(-6.0), swap_fade_frames(SR)).is_ok());
    assert!(swapped.swapping(1));
    run(&mut swapped, &mut a[at..]);
    assert!(!swapped.swapping(1));

    // The same chain with the new gain put straight in at the same moment.
    let mut direct = Rack::new();
    direct.push(echo());
    direct.push(gain(0.0));
    let mut b = input.clone();
    run(&mut direct, &mut b[..at]);
    direct.slots[1].effect = gain(-6.0);
    run(&mut direct, &mut b[at..]);

    let fade = swap_fade_frames(SR) * CH;
    assert_ne!(a[at..at + fade], b[at..at + fade], "the fade is heard");
    for i in at + fade..a.len() {
        assert_eq!(a[i].to_bits(), b[i].to_bits(), "sample {i}: the echo's tail was disturbed");
    }
    // The old gain waits to be dropped off the audio thread, once.
    assert!(swapped.take_retired().is_some());
    assert!(swapped.take_retired().is_none());
}

#[test]
fn a_swap_does_not_click() {
    // From an echo to a plain gain on a running tone: no step beyond what the
    // two effects' own outputs make, allowing the √2 an equal-power fade of
    // correlated signals can reach.
    let input = tone(9_600, 220.0);
    let at = 4_800 * CH;
    let alone = |e: Box<dyn Effect>| {
        let mut r = Rack::new();
        r.push(e);
        let mut x = input.clone();
        run(&mut r, &mut x);
        x
    };
    let (old, new) = (alone(echo()), alone(gain(0.0)));
    let mut rack = Rack::new();
    rack.push(echo());
    let mut y = input.clone();
    run(&mut rack, &mut y[..at]);
    rack.swap_slot(0, gain(0.0), swap_fade_frames(SR)).ok().unwrap();
    run(&mut rack, &mut y[at..]);
    for i in at + CH..y.len() {
        let own = (old[i] - old[i - CH]).abs().max((new[i] - new[i - CH]).abs());
        assert!((y[i] - y[i - CH]).abs() <= std::f32::consts::SQRT_2 * own + 0.001, "click at {i}");
    }
}

#[test]
fn a_second_swap_while_one_fades_is_handed_back_and_a_missing_slot_too() {
    let mut rack = Rack::new();
    rack.push(gain(0.0));
    rack.swap_slot(0, gain(-3.0), swap_fade_frames(SR)).ok().unwrap();
    assert!(rack.swap_slot(0, gain(-6.0), swap_fade_frames(SR)).is_err());
    assert!(rack.swap_slot(5, gain(-6.0), swap_fade_frames(SR)).is_err());
}

#[test]
fn a_bypassed_slot_takes_its_new_effect_at_once() {
    let mut rack = Rack::new();
    rack.push_slot(gain(0.0), true);
    rack.swap_slot(0, gain(-6.0), swap_fade_frames(SR)).ok().unwrap();
    assert!(!rack.swapping(0), "nothing is heard from a bypassed slot, so there is nothing to fade");
    assert_eq!(rack.slots[0].effect.get_param("db"), Some(-6.0));
    assert!(rack.take_retired().is_some());
}

#[test]
fn controls_written_during_the_fade_reach_the_new_effect() {
    let mut rack = Rack::new();
    rack.push(gain(0.0));
    rack.swap_slot(0, gain(-6.0), swap_fade_frames(SR)).ok().unwrap();
    assert!(rack.set_param(0, "db", -12.0));
    assert_eq!(rack.get_param(0, "db"), Some(-12.0));
    let mut x = tone(2_000, 100.0);
    run(&mut rack, &mut x);
    assert_eq!(rack.slots[0].effect.get_param("db"), Some(-12.0));
}
