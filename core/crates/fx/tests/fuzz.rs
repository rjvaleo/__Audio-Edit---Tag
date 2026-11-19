//! The rack owns the finite-input boundary, even for a stateful effect.
use fx::{prism::{catalogue, PrismEffect}, Rack};
#[test]
fn every_effect_recovers_from_a_nan_at_the_rack_input() {
    for entry in catalogue() {
        let id = entry.descriptor.id;
        let mut rack = Rack::new();
        rack.push(Box::new(PrismEffect::new(id, 48_000).unwrap()));
        rack.reserve_mix(8192);
        let mut buf = vec![0.0; 8192];
        buf[17] = f32::NAN;
        rack.process(&mut buf, 2, 48_000);
        assert!(buf.iter().all(|x| *x == 0.0), "{id}: bad block was not silent");
        assert_eq!(rack.tripped(), 1, "{id}");
        for block in 0..4 {
            for (i, x) in buf.iter_mut().enumerate() { *x = if block % 2 == 0 { (i as f32 * 0.017).sin() * 0.2 } else { 0.0 }; }
            rack.process(&mut buf, 2, 48_000);
            assert!(buf.iter().all(|x| x.is_finite()), "{id}: block {block}");
        }
        assert_eq!(rack.tripped(), 1, "{id}: later blocks must be clean");
    }
}
