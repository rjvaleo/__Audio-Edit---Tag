//! Three decks on one output.
//!
//! Two of them are transports (RJ, 6 Nov 2026: "make each effect its own
//! instance so that the hyperprism panel can have its own sound loaded, and it
//! runs independently of the grain engine"). A deck is what used to be the
//! whole engine: a [`Core`] on the audio thread and the [`Shared`] everyone
//! else talks to — its own sound, transport, stretch, Pitch Time Changer,
//! glide, faders and effect chain. The grain deck is the one there always was,
//! and keeps the scope, the sequencer bus and the recorder. The Prism deck is a
//! second one.
//!
//! The third is the Wave page's synth ([`SynthDeck`], `synth.rs`), which has no
//! transport at all and renders every block.
//!
//! # The mix, and why it is in this order
//!
//! 1. The synth deck renders first, into a block of its own.
//! 2. The grain deck fills the output and adds the synth's block **before** its
//!    soft ceiling, capture, scope and spectrum (`Core::fill_with`), on the
//!    playing and the stopped path alike. So a note on the Wave page is
//!    softened, recorded and metered like the grain is, and is heard with the
//!    grain transport stopped.
//! 3. The Prism deck fills a block of its own and is added last.
//!
//! **The Prism deck still sums after the ceiling**, as it did before the synth
//! arrived: it is not softened by the master ceiling, does not reach the
//! capture and does not move the master meters. That is left as it was on
//! purpose; changing what Prism sounds like is not part of adding the synth.

use crate::synth::SynthDeck;
use crate::transport::{Core, Shared};

pub struct Decks {
    main: Core,
    prism: Core,
    synth: Option<SynthDeck>,
    /// The Prism deck's block, sized once: the callback may not allocate.
    scratch: Vec<f32>,
}

impl Decks {
    pub fn new(main: Core, prism: Core, max_block: usize, channels: usize) -> Self {
        Decks { main, prism, synth: None, scratch: vec![0.0; max_block.max(1) * channels.max(1)] }
    }

    /// The same, with the synth deck mixed in. Built with the device's rate
    /// and the same largest block as the others.
    pub fn with_synth(mut self, synth: SynthDeck) -> Self {
        self.synth = Some(synth);
        self
    }

    /// One block of all of them. Each deck's `Shared` is its own: nothing one
    /// is told reaches another. The synth deck holds its own handle.
    pub fn fill(&mut self, out: &mut [f32], channels: usize, main: &Shared, prism: &Shared) {
        let frames = out.len() / channels.max(1);
        match self.synth.as_mut() {
            Some(s) => {
                let block = s.render(frames, channels);
                self.main.fill_with(out, channels, main, Some(block));
            }
            None => self.main.fill(out, channels, main),
        }
        let n = out.len().min(self.scratch.len());
        let block = &mut self.scratch[..n];
        self.prism.fill(block, channels, prism);
        for (o, p) in out.iter_mut().zip(block.iter()) {
            *o += *p;
        }
    }
}
