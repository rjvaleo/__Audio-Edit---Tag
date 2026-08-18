//! The layer cap must never walk itself down.
//!
//! This mechanism was built once, shipped, and withdrawn the same day for
//! causing the glitching it was meant to prevent — sixteen layers to one while
//! the user listened. The cause was not the decision but how it was applied:
//! the callback wrote the verdict back into its own persistent parameters, so
//! the next decision was made against the reduced number rather than against
//! what was asked for. That is a ratchet, and it is the only thing these tests
//! are really about.

use engine::transport::Shared;
use engine::Source;
use fx::grain::StreamParams;
use std::sync::Arc;

/// A `Shared` needs params and a source to exist; neither is read by the load
/// bookkeeping under test, so an empty one is honest rather than a stub.
fn shared() -> Shared {
    Shared::new(
        StreamParams::new(1000, 48_000),
        Arc::new(Source { samples: Vec::new(), channels: 1 }),
    )
}

/// A quiet engine keeps every layer it was given.
#[test]
fn an_easy_load_never_shed_a_layer() {
    let s = shared();
    let start = s.layer_cap();
    let budget = std::time::Duration::from_millis(10);
    // A tenth of budget, for far longer than the governor's patience.
    for _ in 0..2000 {
        s.record_block_cost(budget / 10, budget);
    }
    assert_eq!(s.layer_cap(), start, "layers were shed from a load of 10%");
}

/// A sustained overload sheds layers — but stops, and does not walk to one.
#[test]
fn an_overload_sheds_layers_and_then_settles() {
    let s = shared();
    let budget = std::time::Duration::from_millis(10);
    let start = s.layer_cap();

    // Well over budget, sustained.
    for _ in 0..80 {
        s.record_block_cost(budget * 2, budget);
    }
    let after = s.layer_cap();
    assert!(after < start, "a sustained overload shed nothing (still {after})");
    assert!(after >= 1, "the cap went below one layer");
}

/// The cap is bounded below by one, however long the overload runs.
///
/// The withdrawn version had no such floor in practice: each block re-read its
/// own reduced answer, so the count collapsed as fast as blocks arrived.
#[test]
fn a_long_overload_cannot_go_below_one_layer() {
    let s = shared();
    let budget = std::time::Duration::from_millis(10);
    for _ in 0..20_000 {
        s.record_block_cost(budget * 3, budget);
    }
    assert_eq!(s.layer_cap(), 1, "the floor is one layer, got {}", s.layer_cap());
}

/// And it climbs back when there is room.
#[test]
fn the_cap_recovers_when_the_load_drops() {
    let s = shared();
    let budget = std::time::Duration::from_millis(10);
    for _ in 0..400 {
        s.record_block_cost(budget * 2, budget);
    }
    let shed = s.layer_cap();
    assert!(shed < 16, "nothing was shed to recover from");

    // Easy again, for long enough to earn a layer back. Recovery is judged on
    // the mean, which is a slow average, so this has to run a while.
    for _ in 0..20_000 {
        s.record_block_cost(budget / 20, budget);
    }
    assert!(
        s.layer_cap() > shed,
        "the cap never recovered: still {} after a long easy run", s.layer_cap(),
    );
}

/// A document change gives it its head back.
#[test]
fn resetting_restores_every_layer() {
    let s = shared();
    let budget = std::time::Duration::from_millis(10);
    for _ in 0..400 {
        s.record_block_cost(budget * 2, budget);
    }
    assert!(s.layer_cap() < 16);
    s.reset_governor();
    assert_eq!(s.layer_cap(), 16, "a new document did not restore the layers");
}
