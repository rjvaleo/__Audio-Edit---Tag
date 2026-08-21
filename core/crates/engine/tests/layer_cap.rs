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
    let s = Shared::new(
        StreamParams::new(1000, 48_000),
        Arc::new(Source { samples: Vec::new(), channels: 1 }),
    );
    // The renderer publishes this every block; nothing renders here, so it is
    // set by hand. It matters: the governor sheds from what is *running*, not
    // from the abstract ceiling, so a `Shared` that claims one running layer
    // has nothing it is allowed to take away.
    running(&s, MAX as u32);
    s
}

fn running(s: &Shared, n: u32) {
    s.layers_running.store(n, std::sync::atomic::Ordering::Relaxed);
}

/// A quiet engine keeps every layer it was given.
/// The ceiling, from the one place it is written.
///
/// These read `16` by hand, so raising the real ceiling left four assertions
/// testing a number the program no longer used — three of them still passed,
/// which is the worst way for a test to be wrong.
const MAX: usize = engine::render::MAX_LAYERS;

#[test]
fn an_easy_load_never_shed_a_layer() {
    let s = shared();
    // Shedding is off unless asked for — the engine plays what the control
    // says. These are the governor's own tests, so they turn it on.
    s.set_shed_layers(true);
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
    // Shedding is off unless asked for — the engine plays what the control
    // says. These are the governor's own tests, so they turn it on.
    s.set_shed_layers(true);
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
    // Shedding is off unless asked for — the engine plays what the control
    // says. These are the governor's own tests, so they turn it on.
    s.set_shed_layers(true);
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
    // Shedding is off unless asked for — the engine plays what the control
    // says. These are the governor's own tests, so they turn it on.
    s.set_shed_layers(true);
    let budget = std::time::Duration::from_millis(10);
    for _ in 0..400 {
        s.record_block_cost(budget * 2, budget);
    }
    let shed = s.layer_cap();
    assert!(shed < MAX as u32, "nothing was shed to recover from");

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
    // Shedding is off unless asked for — the engine plays what the control
    // says. These are the governor's own tests, so they turn it on.
    s.set_shed_layers(true);
    let budget = std::time::Duration::from_millis(10);
    for _ in 0..400 {
        s.record_block_cost(budget * 2, budget);
    }
    assert!(s.layer_cap() < MAX as u32);
    s.reset_governor();
    assert_eq!(s.layer_cap(), MAX as u32, "a new document did not restore the layers");
}

/// The load that actually gets complained about: spiky, not sustained.
///
/// "Breaking Again" sits at about 68% of budget and misses roughly 1.5
/// deadlines a second. Every miss is a hole in the sound — a click — and one
/// and a half a second reads as crackling. The governor's original arithmetic
/// added 4 for a busy block and subtracted 1 for every block that was not,
/// which against this pattern comes to +5.8 versus −22.0 a second: it could
/// never reach its threshold, and the engine glitched along at a
/// comfortable-looking average while the user heard it plainly.
#[test]
fn a_spiky_load_that_misses_deadlines_sheds_a_layer() {
    let s = shared();
    // Shedding is off unless asked for — the engine plays what the control
    // says. These are the governor's own tests, so they turn it on.
    s.set_shed_layers(true);
    running(&s, 3);                                     // a three-layer document
    let budget = std::time::Duration::from_millis(43);   // 2048 frames at 48k
    let start = 3;

    // Ten seconds of it: 23 blocks a second, of which about 1.5 are late and
    // the rest sit at a perfectly ordinary two-thirds of budget.
    let mut late_total = 0;
    for block in 0..234 {
        if block % 16 == 0 {
            s.record_block_cost(budget * 3 / 2, budget);     // 150% — missed
            late_total += 1;
        } else {
            s.record_block_cost(budget * 68 / 100, budget);  // 68% — fine
        }
    }

    assert!(late_total > 10, "the test pattern did not miss enough deadlines");
    assert!(
        s.layer_cap() < start,
        "{late_total} missed deadlines in ten seconds shed nothing — still {} layers. \
         A block that misses its deadline is a click, and this is what crackling is.",
        s.layer_cap(),
    );
}

/// Being busy is not the same as being late. A hard-working engine that always
/// makes its deadline must keep every layer it was given.
#[test]
fn busy_but_never_late_sheds_nothing() {
    let s = shared();
    // Shedding is off unless asked for — the engine plays what the control
    // says. These are the governor's own tests, so they turn it on.
    s.set_shed_layers(true);
    let budget = std::time::Duration::from_millis(43);
    let start = s.layer_cap();
    for _ in 0..2000 {
        s.record_block_cost(budget * 85 / 100, budget);   // 85%, never over
    }
    assert_eq!(
        s.layer_cap(), start,
        "layers were shed from a load that never missed a deadline",
    );
}

/// The switch, and the only thing that decides it.
///
/// Shedding is a program overriding a setting you made. That is defensible when
/// the alternative is a hole in the sound, and indefensible as the only
/// behaviour on offer — "5 of 12 layers" at 29% of budget, with no note of when
/// it might give them back, reads as the control being broken.
#[test]
fn the_governor_can_be_switched_off() {
    let s = shared();
    let budget = std::time::Duration::from_millis(10);

    // On, it does what it always did.
    s.set_shed_layers(true);
    for _ in 0..400 {
        s.record_block_cost(budget * 2, budget);
    }
    let shed = s.layer_cap();
    assert!(shed < MAX as u32, "the governor did not shed with the switch on");

    // Off, it hands them straight back rather than climbing home over four
    // hundred easy blocks a layer.
    s.set_shed_layers(false);
    assert_eq!(s.layer_cap(), MAX as u32, "switching it off did not restore the layers");

    // And the same overload no longer takes anything, however long it runs.
    for _ in 0..2_000 {
        s.record_block_cost(budget * 4, budget);
    }
    assert_eq!(
        s.layer_cap(),
        MAX as u32,
        "layers were shed with the governor switched off",
    );
}

/// Off is what a fresh engine starts as.
#[test]
fn the_engine_plays_what_it_is_asked_for_by_default() {
    let s = shared();
    assert!(!s.sheds_layers(), "the governor is on by default");
    let budget = std::time::Duration::from_millis(10);
    for _ in 0..2_000 {
        s.record_block_cost(budget * 4, budget);
    }
    assert_eq!(s.layer_cap(), MAX as u32, "a default engine shed layers");
}
