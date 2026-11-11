//! The board an old patch gets: its fixed chain, Voice → Drive → Chorus →
//! Delay → Reverb → EQ → Out, as nodes.
//!
//! Each node is switched as its `fxI.on` and set as `master_fx.rs` sets its
//! unit, so the patch sounds the same (`tests/board.rs` renders both). The
//! chain ran its shared effects fully wet and did each mix itself; here each
//! effect's own wet and dry carry the same law, which the effects make
//! linear: the chorus crossfades (`1 − k2`, `k2`), the delay adds its echoes
//! at `k2`, the reverb is equal-power (`cos`, `sin` of `k2 · π/2`). The
//! Drive is the chain's own unit (`wave:drive`) with its own mix.

use super::{Board, Cable, Node};
use crate::patch::{FX_BASE, FX_STRIDE, NUM_PARAMS};

/// The six inputs down the left edge, as the mock-up places them.
pub fn input_nodes() -> Vec<Node> {
    [("invoice", "in:voice", 16.0), ("inA", "in:osc0", 112.0), ("inB", "in:osc1", 176.0), ("inC", "in:osc2", 240.0), ("insub", "in:sub", 304.0), ("innoise", "in:noise", 368.0)]
        .iter()
        .map(|(id, kind, y)| Node::new(id, kind, 16.0, *y))
        .collect()
}

impl Board {
    /// The board an old patch's master chain makes, from its values.
    pub fn migrate(values: &[f32; NUM_PARAMS]) -> Board {
        let unit = |u: usize| {
            let b = FX_BASE + u * FX_STRIDE;
            (values[b] >= 0.5, [values[b + 1], values[b + 2], values[b + 3]].map(|k| k.clamp(0.0, 1.0)))
        };
        let (drive_on, d) = unit(0);
        let (chorus_on, c) = unit(1);
        let (delay_on, e) = unit(2);
        let (reverb_on, r) = unit(3);
        let (eq_on, q) = unit(4);
        let (sin, cos) = (r[2] * std::f32::consts::FRAC_PI_2).sin_cos();
        let mut nodes = input_nodes();
        nodes.extend([
            Node::new("drive", "wave:drive", 144.0, 16.0)
                .switched(drive_on)
                .with("drive", d[0])
                .with("tone", d[1])
                .with("mix", d[2]),
            Node::new("chorus", "fx:white-chorus", 320.0, 16.0)
                .switched(chorus_on)
                .with("delayMs", 12.0)
                .with("feedback", 0.0)
                .with("stereo", 0.5)
                .with("rateHz", 0.1 * 40f32.powf(c[0]))
                .with("depthMs", c[1] * 8.0)
                .with("wet", c[2])
                .with("dry", 1.0 - c[2]),
            Node::new("delay", "fx:echo", 496.0, 16.0)
                .switched(delay_on)
                .with("delayMs", 20.0 + e[0] * 980.0)
                .with("feedback", 0.15 + e[1] * 0.8)
                .with("damping", 0.2)
                .with("wet", e[2])
                .with("dry", 1.0),
            Node::new("reverb", "fx:dattorro-plate", 496.0, 184.0)
                .switched(reverb_on)
                .with("decay", 0.2 + r[0] * 0.7)
                .with("predelayMs", r[0] * 30.0)
                .with("damping", r[1] * 0.9)
                .with("wet", sin)
                .with("dry", cos),
            Node::new("eq", "fx:eq", 672.0, 184.0)
                .switched(eq_on)
                .with("band.0.enabled", 0.0)
                .with("band.1.gainDb", (q[0] - 0.5) * 30.0)
                .with("band.2.gainDb", (q[1] - 0.5) * 30.0)
                .with("band.2.q", 0.7)
                .with("band.6.gainDb", (q[2] - 0.5) * 30.0),
            Node::new("out", "out", 672.0, 344.0),
        ]);
        let chain = ["invoice", "drive", "chorus", "delay", "reverb", "eq", "out"];
        let cables = chain.windows(2).map(|w| Cable::new(w[0], "o", w[1], "i")).collect();
        Board { name: "Master chain".into(), nodes, cables }
    }
}
