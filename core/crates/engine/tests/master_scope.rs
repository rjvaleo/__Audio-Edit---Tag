//! The master bus ring.
//!
//! Every meter in the right-hand tray reads this, so a fault here is invisible
//! until three displays are all quietly wrong together. The ring is written by
//! the audio callback a block at a time and read whole from another thread, and
//! the two things that can go wrong are the wrap and the channel order.
//!
//! See `docs/MASTER-BUS.md`.

use engine::transport::{Shared, SCOPE_FRAMES};
use engine::Source;
use fx::grain::StreamParams;
use std::sync::Arc;

const SR: u32 = 48_000;

fn shared() -> Shared {
    Shared::new(
        StreamParams::new(1000, SR),
        Arc::new(Source { samples: Vec::new(), channels: 1 }),
    )
}

/// Interleaved stereo where the two sides are told apart by sign.
fn block(from: usize, frames: usize) -> Vec<f32> {
    let mut v = Vec::with_capacity(frames * 2);
    for i in 0..frames {
        v.push((from + i) as f32);
        v.push(-((from + i) as f32));
    }
    v
}

#[test]
fn nothing_has_played_yet_is_not_silence() {
    // A caller has to be able to tell "no signal" from "no engine". Returning
    // sixteen thousand zeros for the second would draw a meter pinned at the
    // floor and look exactly like a working meter on a quiet passage.
    assert!(shared().scope_snapshot().is_none());
}

#[test]
fn the_channels_do_not_cross() {
    let s = shared();
    s.push_scope(&block(0, 512), 2, SR);
    let (l, r, rate) = s.scope_snapshot().expect("nothing came back");
    assert_eq!(rate, SR);
    assert_eq!(l.len(), 512);
    assert_eq!(r.len(), 512);
    for i in 0..512 {
        assert_eq!(l[i], i as f32, "left is wrong at {i}");
        assert_eq!(r[i], -(i as f32), "right is wrong at {i} — the channels crossed");
    }
}

#[test]
fn blocks_arrive_in_the_order_they_were_played() {
    let s = shared();
    s.push_scope(&block(0, 300), 2, SR);
    s.push_scope(&block(300, 300), 2, SR);
    s.push_scope(&block(600, 300), 2, SR);
    let (l, _, _) = s.scope_snapshot().unwrap();
    assert_eq!(l.len(), 900);
    for i in 0..900 {
        assert_eq!(l[i], i as f32, "out of order at {i}");
    }
}

#[test]
fn the_ring_wraps_and_the_snapshot_is_still_in_time_order() {
    // The one that matters. Once it has wrapped, the newest sample sits in the
    // middle of the array and the oldest one after it — a snapshot that just
    // copied the buffer would hand a display a picture spliced at a random
    // point, which draws as a discontinuity that is not in the audio.
    let s = shared();
    let mut at = 0;
    while at < SCOPE_FRAMES * 2 {
        s.push_scope(&block(at, 1000), 2, SR);
        at += 1000;
    }
    let (l, r, _) = s.scope_snapshot().unwrap();
    assert_eq!(l.len(), SCOPE_FRAMES, "a wrapped ring should be exactly full");

    // The last sample written is the last sample returned.
    let newest = (at - 1) as f32;
    assert_eq!(*l.last().unwrap(), newest, "the newest sample is not last");
    assert_eq!(*r.last().unwrap(), -newest);
    // And every step from there back is contiguous.
    for i in 1..SCOPE_FRAMES {
        assert_eq!(l[i] - l[i - 1], 1.0, "the ring is spliced at {i}");
    }
}

#[test]
fn a_block_longer_than_the_ring_leaves_only_its_tail() {
    // Pathological, but a device can be asked for a very large buffer and the
    // arithmetic should not wrap into nonsense.
    let s = shared();
    let n = SCOPE_FRAMES + 5_000;
    s.push_scope(&block(0, n), 2, SR);
    let (l, _, _) = s.scope_snapshot().unwrap();
    assert_eq!(l.len(), SCOPE_FRAMES);
    assert_eq!(*l.last().unwrap(), (n - 1) as f32);
    assert_eq!(l[0], (n - SCOPE_FRAMES) as f32);
}

#[test]
fn mono_is_written_to_both_sides() {
    // Otherwise a goniometer of a mono file draws nothing at all, when what it
    // should draw is the 45-degree line that says "this is mono".
    let s = shared();
    let mono: Vec<f32> = (0..256).map(|i| i as f32).collect();
    s.push_scope(&mono, 1, SR);
    let (l, r, _) = s.scope_snapshot().unwrap();
    assert_eq!(l, r, "mono did not reach the right channel");
    assert_eq!(l.len(), 256);
}

#[test]
fn more_than_two_channels_meters_the_first_two() {
    let s = shared();
    let mut v = Vec::new();
    for i in 0..100 {
        v.extend_from_slice(&[i as f32, -(i as f32), 99.0, 99.0]);
    }
    s.push_scope(&v, 4, SR);
    let (l, r, _) = s.scope_snapshot().unwrap();
    assert_eq!(l.len(), 100);
    assert_eq!(l[42], 42.0);
    assert_eq!(r[42], -42.0);
}

#[test]
fn clearing_drops_it_back_to_nothing_has_played() {
    let s = shared();
    s.push_scope(&block(0, 512), 2, SR);
    assert!(s.scope_snapshot().is_some());
    s.clear_scope();
    // The rate survives — the device has not gone away — but there is no
    // signal, so the snapshot has nothing to hand back.
    assert!(s.scope_snapshot().is_none(), "a cleared ring still reported a signal");
}
