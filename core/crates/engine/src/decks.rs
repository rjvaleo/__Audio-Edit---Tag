//! Two decks on one output (RJ, 6 Nov 2026: "make each effect its own instance
//! so that the hyperprism panel can have its own sound loaded, and it runs
//! independently of the grain engine").
//!
//! A deck is what used to be the whole engine: a [`Core`] on the audio thread
//! and the [`Shared`] everyone else talks to — its own sound, transport,
//! stretch, Pitch Time Changer, glide, faders and effect chain. The grain deck
//! is the one there always was, and keeps the scope, the sequencer bus and the
//! recorder. The Prism deck is a second one. The callback fills the grain deck
//! into the output, the Prism deck into a block of its own, and adds them, so
//! both leave through the one device on the same frame.

use crate::transport::{Core, Shared};

pub struct Decks {
    main: Core,
    prism: Core,
    /// The Prism deck's block, sized once: the callback may not allocate.
    scratch: Vec<f32>,
}

impl Decks {
    pub fn new(main: Core, prism: Core, max_block: usize, channels: usize) -> Self {
        Decks { main, prism, scratch: vec![0.0; max_block.max(1) * channels.max(1)] }
    }

    /// One block of both. Each deck's `Shared` is its own: nothing one is told
    /// reaches the other.
    pub fn fill(&mut self, out: &mut [f32], channels: usize, main: &Shared, prism: &Shared) {
        self.main.fill(out, channels, main);
        let n = out.len().min(self.scratch.len());
        let block = &mut self.scratch[..n];
        self.prism.fill(block, channels, prism);
        for (o, p) in out.iter_mut().zip(block.iter()) {
            *o += *p;
        }
    }
}
