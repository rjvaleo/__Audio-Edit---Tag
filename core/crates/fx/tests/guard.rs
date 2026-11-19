//! A bad slot is silenced and reset without spoiling the next block.
use fx::{Effect, Gain, Rack};
use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};

struct BadOnce {
    fired: bool,
    resets: Arc<AtomicUsize>,
}

impl Effect for BadOnce {
    fn process(&mut self, buf: &mut [f32], _: usize, _: u32) {
        if !self.fired {
            buf[0] = f32::NAN;
            self.fired = true;
        }
    }
    fn reset(&mut self) { self.resets.fetch_add(1, Ordering::SeqCst); }
    fn name(&self) -> &'static str { "Bad once" }
}

#[test]
fn a_bad_slot_is_silent_once_and_reset_once() {
    let resets = Arc::new(AtomicUsize::new(0));
    let mut rack = Rack::new();
    rack.push(Box::new(Gain { db: -6.0 }));
    rack.push(Box::new(BadOnce { fired: false, resets: resets.clone() }));
    rack.push(Box::new(Gain { db: 3.0 }));
    // Inserting a slot may reset it; count only recovery during processing.
    let before = resets.load(Ordering::SeqCst);
    let mut buf = vec![0.25; 1024];
    rack.process(&mut buf, 2, 48_000);
    assert!(buf.iter().all(|v| *v == 0.0));
    assert_eq!(rack.tripped(), 1);
    assert_eq!(resets.load(Ordering::SeqCst), before + 1);
    let mut clean = Rack::new();
    clean.push(Box::new(Gain { db: -6.0 }));
    clean.push(Box::new(Gain { db: 3.0 }));
    let mut expected = vec![0.25; 1024];
    buf.fill(0.25);
    rack.process(&mut buf, 2, 48_000);
    clean.process(&mut expected, 2, 48_000);
    assert!(buf.iter().all(|v| v.is_finite()));
    assert_eq!(buf, expected);
    assert_eq!(rack.tripped(), 1);
    assert_eq!(resets.load(Ordering::SeqCst), before + 1);
}
