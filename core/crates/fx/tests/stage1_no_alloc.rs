//! Prebuilt effect replacement and modulation while the rack is rendering.
#[path = "../../engine/tests/stage1_support/rt.rs"]
mod rt;
use fx::{
    prism::{catalogue, PrismEffect},
    Gain, Rack,
};
#[test]
fn every_reserved_rack_keeps_rendering_and_swapping_without_memory_or_waits() {
    rt::verify();
    let mut results = Vec::new();
    for entry in catalogue() {
        let id = entry.descriptor.id;
        let mut rack = Rack::new();
        rack.push(Box::new(PrismEffect::new(id, 48_000).unwrap()));
        rack.reserve_mix(256);
        let mut buf = [0.0; 256];
        for (i, s) in buf.iter_mut().enumerate() {
            *s = (i as f32 * 0.017).sin() * 0.1;
        }
        for _ in 0..1500 {
            rack.process(&mut buf, 2, 48_000);
        }
        let mut replacement =
            Some(Box::new(PrismEffect::new(id, 48_000).unwrap()) as Box<dyn fx::Effect>);
        // Warm the replacement off the callback, as when a mode is compiled.
        replacement.as_mut().unwrap().process(&mut buf, 2, 48_000);
        rt::start();
        for block in 0..750 {
            if block == 100 {
                assert!(rack.swap_slot(0, replacement.take().unwrap(), 240).is_ok());
            }
            if let Some(param) = entry.descriptor.params.first() {
                rack.set_param(
                    0,
                    param.key,
                    if block % 2 == 0 {
                        param.default
                    } else {
                        param.min
                    },
                );
            }
            for (i, s) in buf.iter_mut().enumerate() {
                *s = (i as f32 * 0.017).sin() * 0.1;
            }
            rack.process(&mut buf, 2, 48_000);
        }
        let n = rt::stop();
        results.push((id, n));
        drop(rack.take_retired());
    }
    for (id, n) in &results {
        println!(
            "RT_COUNTS|{id}|{}|{}|{}|{}",
            n.alloc, n.free, n.realloc, n.blocking
        );
    }
    assert!(
        results.iter().all(|(_, n)| *n == rt::Counts::default()),
        "rack allocation/lock cases: {results:?}"
    );
}
#[test]
fn a_prepared_dry_mix_allocates_nothing() {
    rt::verify();
    let mut rack = Rack::with_capacity(256);
    rack.push(Box::new(Gain { db: 0.0 }));
    rack.slots[0].set_mix(0.5, 0.0);
    let mut buf = [0.2; 256];
    rt::start();
    rack.process(&mut buf, 2, 48_000);
    rt::clean("prepared dry", rt::stop());
}
#[test]
fn a_prepared_slot_crossfade_allocates_nothing() {
    rt::verify();
    let mut rack = Rack::with_capacity(256);
    rack.push(Box::new(Gain { db: 0.0 }));
    assert!(rack.swap_slot(0, Box::new(Gain { db: -3.0 }), 240).is_ok());
    let mut buf = [0.2; 256];
    rt::start();
    rack.process(&mut buf, 2, 48_000);
    rt::clean("prepared crossfade", rt::stop());
}
#[test]
fn a_prepared_place_allocates_nothing() {
    rt::verify();
    let mut rack = Rack::with_capacity(256);
    rack.push(Box::new(Gain { db: 0.0 }));
    rack.set_slot_place(
        0,
        Some(Box::new(fx::prism::prism_fx::place::Place::new(48_000.0))),
    );
    assert!(rack.set_param(0, "place.on", 1.0));
    let mut buf = [0.2; 256];
    rt::start();
    rack.process(&mut buf, 2, 48_000);
    rt::clean("prepared Place", rt::stop());
}
