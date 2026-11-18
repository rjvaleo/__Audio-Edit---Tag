//! Same patch, same stamped messages: same samples.

mod common;
use common::*;

#[test]
fn the_full_patch_plays_the_same_twice() {
    let (l1, r1) = full_run(256);
    let (l2, r2) = full_run(256);
    assert!(peak(&l1) > 0.05, "the patch should be heard, peak {}", peak(&l1));
    assert!(l1 != r1, "the player is not the same on both sides");
    assert_same("left", &l1, &l2);
    assert_same("right", &r1, &r2);
}
