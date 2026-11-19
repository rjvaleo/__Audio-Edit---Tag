//! A held A4 at every device rate and exact maximum block size.
#[path = "../../engine/tests/stage1_support/matrix.rs"]
mod matrix;
use matrix::Deviation;
use std::sync::Arc;
use wave::*;
const ALLOW: &[Deviation] = &[];
#[test]
fn wave_at_every_rate_and_block() {
    matrix::run(&["Wave"], ALLOW, |_, rate, block| {
        let frame: Vec<f32> = (0..FRAME_LEN)
            .map(|i| (std::f32::consts::TAU * i as f32 / FRAME_LEN as f32).sin())
            .collect();
        let table = Arc::new(Wavetable::from_frames(&[frame]));
        let mut p = Patch::default();
        for osc in 1..3 {
            p.set_num(&format!("osc{osc}.on"), 0.0);
        }
        for slot in 0..5 {
            p.set_num(&format!("fx{slot}.on"), 0.0);
        }
        p.set_num("sub.on", 0.0);
        p.set_num("noise.on", 0.0);
        p.set_num("osc0.uni.n", 1.0);
        p.set_num("osc0.rand", 0.0);
        p.set_num("amp.a", 0.0);
        p.set_num("amp.s", 1.0);
        let mut synth = Synth::new(rate as f32, block);
        synth.adopt(PatchState::new(&p));
        synth.set_table(0, table);
        synth.note_on(69, 0.8);
        assert_eq!(synth.max_block(), block);
        let mut l = vec![0.0; rate as usize / 2];
        let mut r = l.clone();
        for (a, b) in l.chunks_mut(block).zip(r.chunks_mut(block)) {
            synth.render(a, b);
        }
        assert!(r.iter().all(|x| x.is_finite()));
        l
    });
}
