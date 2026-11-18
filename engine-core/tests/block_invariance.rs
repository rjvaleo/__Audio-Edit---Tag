//! The sound card's block size must not change the sound.

mod common;
use common::*;
use engine_core::*;

#[test]
fn every_block_size_gives_the_same_samples() {
    let (l, r) = full_run(256);
    for block in [1, 7, 64, 128, 1000, 4096] {
        let (bl, br) = full_run(block);
        assert_same(&format!("left, blocks of {block}"), &l, &bl);
        assert_same(&format!("right, blocks of {block}"), &r, &br);
    }
}

#[test]
fn uneven_blocks_give_the_same_samples() {
    let (l, r) = full_run(256);
    for seed in [1, 2, 3] {
        let (mut ctl, mut audio) = engine(RATE, Config::default());
        full_patch(&mut ctl);
        script(&mut ctl);
        let (bl, br) = render_uneven(&mut audio, FULL_FRAMES, seed);
        assert_same(&format!("left, uneven {seed}"), &l, &bl);
        assert_same(&format!("right, uneven {seed}"), &r, &br);
    }
}
