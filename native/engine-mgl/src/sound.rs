//! The Sound module's document: a file and the edits made to it.
//!
//! This is the app's side of the Sound module, and it never runs on the audio
//! thread. It holds MultiGrainLive's own edit list for one file (cuts, fades,
//! gain, reverse: nothing is ever written to the file), and after each edit
//! it renders the result into the two forms the engine plays: a sound for
//! the bank, which the Sound module's cable points the other modules at, and
//! the same sound laid out for a grain deck. Either is then handed to the
//! engine stamped with the sample it takes over on.
//!
//! The rendering is MGL's, in MGL's order (`server/src/live.rs`): the list's
//! clips, then the engine's rate, then two channels. The stretch in the list
//! is not rendered: a deck does that as it plays, from [`Document::params`].

use audio_core::{ProbeError, RandomAccessSource, Reader};
use engine_core::SoundData;
use mgl_edit::{EditList, Session};
use mgl_engine::{conform_channels, resample, Source};
use mgl_fx::grain::StreamParams;
use std::io;
use std::sync::Arc;

/// One file and its edit list.
pub struct Document<S: RandomAccessSource> {
    reader: Reader<S>,
    session: Session,
    rate: u32,
}

/// The edited timeline at the engine's rate, in two channels: MGL's order
/// (`server/src/live.rs`), the rate, then the channels.
fn at_rate(samples: &[f32], channels: usize, from: u32, to: u32) -> Vec<f32> {
    let samples = resample(samples, channels, from, to);
    conform_channels(&samples, channels, 2)
}

impl<S: RandomAccessSource> Document<S> {
    /// Open a file (WAV or AIFF) for an engine running at `rate`.
    pub fn open(mut file: S, rate: u32) -> Result<Document<S>, ProbeError> {
        let info = audio_core::probe(&mut file)?;
        let list = EditList::identity(info.frames(), info.channels, info.sample_rate);
        Ok(Document { reader: Reader::new(file, info), session: Session::new(list), rate })
    }

    /// The edits as they stand.
    pub fn list(&self) -> &EditList {
        self.session.list()
    }

    /// Make an edit. False if it changed nothing.
    pub fn edit(&mut self, change: impl FnOnce(&mut EditList)) -> bool {
        self.session.apply(change)
    }

    pub fn undo(&mut self) -> bool {
        self.session.undo()
    }

    pub fn redo(&mut self) -> bool {
        self.session.redo()
    }

    /// Back to the file as it is.
    pub fn revert(&mut self) {
        self.session.revert()
    }

    /// The session: the list, and whether there is anything to undo or redo.
    pub fn session(&self) -> &Session {
        &self.session
    }

    /// The list and the file together, for what must read the audio before
    /// it can decide what to do (snap, normalise, strip silence, find a
    /// click), and for an edit made after it.
    pub fn parts(&mut self) -> (&mut Session, &mut Reader<S>) {
        (&mut self.session, &mut self.reader)
    }

    /// The file as it is, before any edit.
    pub fn reader(&mut self) -> &mut Reader<S> {
        &mut self.reader
    }

    /// The engine's rate, which [`Document::sound`] renders at.
    pub fn rate(&self) -> u32 {
        self.rate
    }

    /// The edited sound, interleaved in two channels at the engine's rate.
    fn rendered(&mut self) -> io::Result<Vec<f32>> {
        let list = self.session.list();
        let channels = (list.channels as usize).max(1);
        let samples = mgl_edit::render::render(list, &mut self.reader, 0, list.base_frames())?;
        Ok(at_rate(&samples, channels, list.sample_rate, self.rate))
    }

    /// The bank's sound from the edited timeline already rendered at the
    /// file's rate (`timeline`, interleaved in the list's channels): the same
    /// as [`Document::sound`], without rendering it again.
    pub fn sound_from(&self, timeline: &[f32]) -> SoundData {
        let list = self.session.list();
        let samples = at_rate(timeline, (list.channels as usize).max(1), list.sample_rate, self.rate);
        let l = samples.iter().step_by(2).copied().collect();
        let r = samples.iter().skip(1).step_by(2).copied().collect();
        SoundData { rate: self.rate as f32, l, r }
    }

    /// The grain deck's sound from the edited timeline already rendered at
    /// the file's rate: the same as [`Document::source`], without rendering
    /// it again.
    pub fn source_from(&self, timeline: &[f32]) -> Arc<Source> {
        let list = self.session.list();
        Arc::new(Source { samples: at_rate(timeline, (list.channels as usize).max(1), list.sample_rate, self.rate), channels: 2 })
    }

    /// The edited sound for a grain deck: at the engine's rate, two channels,
    /// before any stretch (the deck does the stretching).
    pub fn source(&mut self) -> io::Result<Arc<Source>> {
        Ok(Arc::new(Source { samples: self.rendered()?, channels: 2 }))
    }

    /// The edited sound for the sound bank.
    pub fn sound(&mut self) -> io::Result<SoundData> {
        let samples = self.rendered()?;
        let l = samples.iter().step_by(2).copied().collect();
        let r = samples.iter().skip(1).step_by(2).copied().collect();
        Ok(SoundData { rate: self.rate as f32, l, r })
    }

    /// The deck settings the edit list's stretch asks for, for `source`.
    pub fn params(&self, source: &Source) -> StreamParams {
        let stretch = &self.session.list().stretch;
        StreamParams {
            in_frames: source.frames(),
            sample_rate: self.rate,
            ratio: stretch.ratio,
            semitones: stretch.semitones,
            window_ms: stretch.window_ms,
            grain: stretch.grain,
            algorithm: stretch.algorithm,
            wsola: stretch.wsola,
            vocoder: stretch.vocoder,
            pvsola: stretch.pvsola,
            hybrid: stretch.hybrid,
            soundhack: stretch.soundhack,
            cloud: stretch.cloud,
            cloud_mix: stretch.cloud_mix,
        }
    }
}
