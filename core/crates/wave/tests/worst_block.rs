//! The complete Wave deck path, including event uptake and telemetry.
mod bench_support;
use bench_support::*;
use engine::{SynthDeck, WaveEvent, WaveShared};
use std::sync::Arc;
use wave::{Patch, PatchState};

#[test]
#[ignore = "a measurement: run it alone, in a release build"]
fn wave_worst_block() {
    let mut rows = Vec::new();
    for notes in [1, 8, 16, 32] {
        for unison in [1, 16] {
            for block in [64, 128, 512] {
                let mut patch = Patch::default();
                patch.set_str("voice.mode", "poly");
                for i in 0..3 { patch.set_num(&format!("osc{i}.uni.n"), unison as f32); }
                patch.set_num("amp.s", 1.0);
                let shared = Arc::new(WaveShared::new());
                shared.set_patch(PatchState::new(&patch));
                let mut deck = SynthDeck::new(SR as f32, block, 2, shared.clone());
                for n in 0..notes { assert!(shared.push(WaveEvent::NoteOn { note: 36 + n, vel: 0.8 })); }
                rows.push(measure(&format!("wave-notes{notes}-unison{unison}"), block, |n| {
                    std::hint::black_box(deck.render(n, 2));
                }));
            }
        }
    }
    write("wave", rows);
}
