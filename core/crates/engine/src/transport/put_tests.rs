//! A host that runs the deck on its own audio thread hands it a rack, the
//! extra layers and a map with the `put` forms. None of them may wait: if
//! another thread is in the slot at that instant, the new thing comes
//! straight back for the host to offer again.

use super::*;
use fx::grain::StreamParams;
use fx::stretch::Algorithm;
use std::sync::mpsc;
use std::time::Duration;

fn shared() -> Arc<Shared> {
    Arc::new(Shared::new(
        StreamParams::new(48_000, 48_000),
        Arc::new(Source { samples: Vec::new(), channels: 2 }),
    ))
}

fn bank() -> crate::stretcher::LayerBank {
    crate::stretcher::LayerBank::build(Algorithm::Wsola, 3, 512, 2, 48_000)
}

/// Hold `slot` here and make the hand-over on a second thread, as the audio
/// thread would while a control thread is in the slot. True if it had not
/// come back after half a second, which is a wait.
fn waits<T>(shared: &Arc<Shared>, slot: &Mutex<T>, put: impl FnOnce(&Shared) + Send + 'static) -> bool {
    let held = slot.lock().unwrap();
    let (done, back) = mpsc::channel();
    let other = Arc::clone(shared);
    let thread = std::thread::spawn(move || {
        put(&other);
        let _ = done.send(());
    });
    let waited = back.recv_timeout(Duration::from_millis(500)).is_err();
    drop(held);
    thread.join().unwrap();
    waited
}

#[test]
fn a_rack_never_waits_for_a_slot_someone_is_in() {
    let s = shared();
    assert!(!waits(&s, &s.pending_rack, |s| {
        let _ = s.put_rack(Some(fx::Rack::new()));
    }));
}

#[test]
fn the_extra_layers_never_wait_for_a_slot_someone_is_in() {
    let s = shared();
    let bank = bank();
    assert!(!waits(&s, &s.pending_bank, move |s| {
        let _ = s.put_bank(bank);
    }));
}

#[test]
fn a_map_never_waits_for_a_slot_someone_is_in() {
    let s = shared();
    assert!(!waits(&s, &s.pending_map, |s| {
        let _ = s.put_map(None);
    }));
}

/// A miss hands the same thing back and leaves the deck as it was; offered
/// again once the slot is free, it lands.
#[test]
fn a_rack_that_missed_comes_back_and_lands_at_the_next_offer() {
    let s = shared();
    let held = s.pending_rack.lock().unwrap();
    let Err(back) = s.put_rack(Some(fx::Rack::new())) else { panic!("it was taken past a held slot") };
    assert!(back.is_some(), "the rack itself comes back");
    assert!(held.is_none(), "nothing was left in the slot");
    drop(held);
    assert!(matches!(s.put_rack(back), Ok(None)), "the slot was free and empty");
    assert!(matches!(&*s.pending_rack.lock().unwrap(), Some(Some(_))), "the rack is waiting for the deck");
}

#[test]
fn layers_that_missed_come_back_and_change_nothing() {
    let s = shared();
    let before = s.bank_layers();
    let held = s.pending_bank.lock().unwrap();
    let Err(back) = s.put_bank(bank()) else { panic!("it was taken past a held slot") };
    assert_eq!(s.bank_layers(), before, "the count of layers is the taken bank's, not an offered one's");
    drop(held);
    assert!(matches!(s.put_bank(back), Ok(None)));
    assert_eq!(s.bank_layers(), 3);
}

#[test]
fn a_map_that_missed_comes_back_and_lands_at_the_next_offer() {
    let s = shared();
    let map = Arc::new(fx::transient::TimeMap::linear(48_000, 2.0));
    let held = s.pending_map.lock().unwrap();
    let Err(back) = s.put_map(Some(Arc::clone(&map))) else { panic!("it was taken past a held slot") };
    assert!(back.as_ref().is_some_and(|m| Arc::ptr_eq(m, &map)), "the same map comes back");
    drop(held);
    assert!(matches!(s.put_map(back), Ok(None)));
    assert!(matches!(&*s.pending_map.lock().unwrap(), Some(Some(m)) if Arc::ptr_eq(m, &map)));
}

/// The control thread's forms still wait their turn: nothing a page sets is
/// lost because the audio thread was in the slot.
#[test]
fn the_control_forms_still_wait_for_the_slot() {
    let s = shared();
    assert!(waits(&s, &s.pending_map, |s| s.set_map(None)));
    assert!(matches!(&*s.pending_map.lock().unwrap(), Some(None)), "and it landed once the slot was free");
}
