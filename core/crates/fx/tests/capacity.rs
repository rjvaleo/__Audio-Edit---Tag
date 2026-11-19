//! Explicit live capacities leave the growing offline constructors unchanged.
#[path = "../../engine/tests/stage1_support/rt.rs"]
mod rt;
use fx::{eq::EqSettings, Effect, Eq, Gain, Rack};

fn rack(prepared: bool, samples: usize) -> Rack {
    let mut rack = if prepared {
        Rack::with_capacity(samples)
    } else {
        Rack::new()
    };
    rack.push(Box::new(Gain { db: -2.0 }));
    rack.slots[0].set_mix(0.5, 0.0);
    assert!(rack.swap_slot(0, Box::new(Gain { db: -5.0 }), 240).is_ok());
    let mut place = Box::new(fx::prism::prism_fx::place::Place::new(48_000.0));
    place.set(Default::default());
    rack.set_slot_place(0, Some(place));
    rack
}

#[test]
fn the_offline_constructor_still_grows_for_a_4096_frame_block() {
    rt::verify();
    let input: Vec<_> = (0..8192).map(|i| (i as f32 * 0.017).sin() * 0.2).collect();
    let mut offline = rack(false, input.len());
    let mut prepared = rack(true, input.len());
    let (mut a, mut b) = (input.clone(), input);
    rt::start();
    offline.process(&mut a, 2, 48_000);
    let growing = rt::stop();
    assert!(
        growing.alloc + growing.realloc > 0,
        "offline scratch must still grow: {growing:?}"
    );
    rt::start();
    prepared.process(&mut b, 2, 48_000);
    let fixed = rt::stop();
    rt::clean("prepared 4096-frame rack", fixed);
    assert_eq!(
        a.iter().map(|s| s.to_bits()).collect::<Vec<_>>(),
        b.iter().map(|s| s.to_bits()).collect::<Vec<_>>()
    );
    assert_eq!(offline.tripped(), 0);
    assert_eq!(prepared.tripped(), 0);
}

#[test]
fn prepared_eq_uses_no_memory_on_first_block_or_a_smaller_channel_count() {
    rt::verify();
    let mut settings = EqSettings::default();
    settings.low.gain_db = 6.0;
    // Spare states must not participate when fewer channels are rendered.
    let mut prepared = Eq::with_channels(settings, 8);
    let mut offline = Eq::new(settings);
    let mut a: Vec<_> = (0..256).map(|i| (i as f32 * 0.03).sin() * 0.2).collect();
    let mut b = a.clone();
    rt::start();
    prepared.process(&mut a, 2, 48_000);
    let fixed = rt::stop();
    rt::clean("prepared Eq first stereo block", fixed);
    offline.process(&mut b, 2, 48_000);
    assert_eq!(
        a.iter().map(|s| s.to_bits()).collect::<Vec<_>>(),
        b.iter().map(|s| s.to_bits()).collect::<Vec<_>>()
    );
    let mut wide = [0.1; 1024];
    rt::start();
    prepared.process(&mut wide, 8, 48_000);
    let fixed = rt::stop();
    rt::clean("prepared Eq eight channels", fixed);
    assert!(wide.iter().all(|s| s.is_finite()));
}
