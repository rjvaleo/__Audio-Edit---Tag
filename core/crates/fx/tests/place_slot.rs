//! A Reverb slot carries Place (prism-fx `place`): off, the slot renders
//! exactly as without it; on, its controls move live like any other.

use fx::prism::prism_fx::place::{Place, PlaceSettings};
use fx::{prism, Rack};

const SR: u32 = 48_000;

fn noise(n: usize) -> Vec<f32> {
    let mut x = 77u32;
    (0..n).map(|_| { x ^= x << 13; x ^= x >> 17; x ^= x << 5; x as f32 / u32::MAX as f32 - 0.5 }).collect()
}

fn rack(place: Option<PlaceSettings>) -> Rack {
    let mut r = Rack::new();
    r.push(prism::make("schroeder-reverb", SR, 2, &[]).unwrap());
    if let Some(s) = place {
        let mut p = Box::new(Place::new(SR as f32));
        p.set(s);
        r.set_slot_place(0, Some(p));
    }
    r.reserve_mix(4096);
    r
}

fn run(r: &mut Rack) -> Vec<u32> {
    let mut buf = noise(48_000);
    for b in buf.chunks_mut(512) {
        r.process(b, 2, SR);
    }
    buf.iter().map(|x| x.to_bits()).collect()
}

#[test]
fn an_off_place_is_bit_identical_to_none() {
    let off = PlaceSettings { on: false, ..PlaceSettings::default() };
    assert_eq!(run(&mut rack(Some(off))), run(&mut rack(None)));
}

#[test]
fn place_moves_live_and_is_heard() {
    let mut r = rack(Some(PlaceSettings { on: false, ..PlaceSettings::default() }));
    assert_eq!(r.get_param(0, "place.on"), Some(0.0));
    assert!(r.set_param(0, "place.on", 1.0));
    assert!(r.set_param(0, "place.dist", 80.0));
    assert_eq!(r.get_param(0, "place.dist"), Some(80.0));
    assert!(!r.set_param(0, "place.nothing", 1.0));
    assert_ne!(run(&mut r), run(&mut rack(None)), "on, it changes the sound");
    // a slot without one has no such controls
    let mut bare = rack(None);
    assert!(!bare.set_param(0, "place.on", 1.0));
    assert_eq!(bare.get_param(0, "place.on"), None);
}
