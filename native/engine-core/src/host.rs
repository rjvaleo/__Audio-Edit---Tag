//! Borrowed host audio: never copied into an engine-owned staging allocation.

/// Read-only planar host input. Implementations must remain immutable for
/// the entire render, including the synchronous render-pool join.
pub trait HostAudio: Sync {
    fn channel(&self, channel: usize) -> &[f32];
}
impl HostAudio for &[&[f32]] {
    fn channel(&self, channel: usize) -> &[f32] {
        self.get(channel).copied().unwrap_or(&[])
    }
}

#[derive(Clone, Copy)]
pub struct HostInputs<'a> {
    source: &'a dyn HostAudio,
    frame: u64,
}
impl<'a> HostInputs<'a> {
    pub(crate) fn new(source: &'a dyn HostAudio, frame: u64) -> Self {
        Self { source, frame }
    }
    /// Missing channels and missing trailing frames are silence. The view
    /// follows absolute frames through graph, event and feedback subdivisions.
    pub fn channel(&self, channel: usize, frame: u64, n: usize) -> &'a [f32] {
        let Some(offset) = frame
            .checked_sub(self.frame)
            .and_then(|n| usize::try_from(n).ok())
        else {
            return &[];
        };
        let samples = self.source.channel(channel);
        samples
            .get(offset..offset.saturating_add(n).min(samples.len()))
            .unwrap_or(&[])
    }
}

/// Copy selected host channel pairs into patch ports. Pair 0 is channels
/// 0/1, pair 1 is 2/3, and so on. An odd final channel has a silent right side.
pub struct Input {
    pairs: Vec<usize>,
}
impl Input {
    pub fn new(pairs: &[usize]) -> Self {
        Self {
            pairs: pairs.to_vec(),
        }
    }
}
impl crate::Module for Input {
    fn factory(&self) -> Option<crate::ModuleFactory> {
        let pairs = self.pairs.clone();
        Some(Box::new(move |_, _| Box::new(Self::new(&pairs))))
    }
    fn inputs(&self) -> Vec<crate::Kind> {
        vec![]
    }
    fn outputs(&self) -> Vec<crate::Kind> {
        vec![crate::Kind::Audio; self.pairs.len()]
    }
    fn process(&mut self, io: &mut crate::Io) {
        for (port, pair) in self.pairs.iter().enumerate() {
            let (l, r) = io.outs.audio(port);
            for (out, channel) in [
                (l, pair.saturating_mul(2)),
                (r, pair.saturating_mul(2).saturating_add(1)),
            ] {
                let input = io.host.channel(channel, io.frame, io.n);
                out[..input.len()].copy_from_slice(input);
                out[input.len()..].fill(0.0);
            }
        }
    }
}
