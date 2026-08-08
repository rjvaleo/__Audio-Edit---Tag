//! Non-destructive editing.
//!
//! An edit is never applied to audio. The document is a list of **clips**, each
//! naming a range of the source file plus the processing to apply to it, and
//! rendering walks that list on demand. Cutting the middle out of an hour-long
//! recording costs two integers, not an hour of copied samples.
//!
//! The source file is opened read-only and is never written. The only way to
//! produce audio from an edit is to render it to a new file.

pub mod ops;
pub mod render;

use std::fmt;

/// A shape applied across a fade.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FadeShape {
    /// Straight line in amplitude. Sounds abrupt on long fades but is what you
    /// want for de-clicking a splice.
    Linear,
    /// Constant-power (quarter-sine). The right default for crossfades, because
    /// two linear fades sum to a dip in the middle.
    EqualPower,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Fade {
    pub frames: u64,
    pub shape: FadeShape,
}

impl Fade {
    pub fn none() -> Self {
        Fade {
            frames: 0,
            shape: FadeShape::Linear,
        }
    }

    /// Gain multiplier `pos` frames into a fade-in of this length.
    pub fn gain_in(&self, pos: u64) -> f32 {
        if self.frames == 0 || pos >= self.frames {
            return 1.0;
        }
        let t = pos as f32 / self.frames as f32;
        match self.shape {
            FadeShape::Linear => t,
            FadeShape::EqualPower => (t * std::f32::consts::FRAC_PI_2).sin(),
        }
    }

    /// Gain multiplier `remaining` frames before the end of a fade-out.
    pub fn gain_out(&self, remaining: u64) -> f32 {
        if self.frames == 0 || remaining >= self.frames {
            return 1.0;
        }
        let t = remaining as f32 / self.frames as f32;
        match self.shape {
            FadeShape::Linear => t,
            FadeShape::EqualPower => (t * std::f32::consts::FRAC_PI_2).sin(),
        }
    }
}

/// A contiguous run of source frames placed on the timeline.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Clip {
    /// First frame in the source file.
    pub src_start: u64,
    /// Length in frames.
    pub len: u64,
    /// Linear gain multiplier, 1.0 for unity.
    pub gain: f32,
    pub fade_in: Fade,
    pub fade_out: Fade,
    /// Play the source backwards.
    pub reversed: bool,
}

impl Clip {
    pub fn new(src_start: u64, len: u64) -> Self {
        Clip {
            src_start,
            len,
            gain: 1.0,
            fade_in: Fade::none(),
            fade_out: Fade::none(),
            reversed: false,
        }
    }

    pub fn src_end(&self) -> u64 {
        self.src_start + self.len
    }
}

/// A half-open frame range on the edit timeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Range {
    pub start: u64,
    pub end: u64,
}

impl Range {
    pub fn new(start: u64, end: u64) -> Self {
        // Accept a backwards drag rather than making the caller normalise it.
        if start <= end {
            Range { start, end }
        } else {
            Range {
                start: end,
                end: start,
            }
        }
    }

    pub fn len(&self) -> u64 {
        self.end - self.start
    }

    pub fn is_empty(&self) -> bool {
        self.end <= self.start
    }
}

/// The edit document for one source file.
#[derive(Debug, Clone, PartialEq)]
pub struct EditList {
    /// Frames in the untouched source.
    pub source_frames: u64,
    pub channels: u16,
    pub sample_rate: u32,
    pub clips: Vec<Clip>,
    /// Time and pitch. Applied after the clips are assembled, because it
    /// changes the length of the result and so cannot live on a clip.
    pub stretch: fx::Stretch,
}

impl EditList {
    /// A document representing the file exactly as it is: one clip, no processing.
    pub fn identity(source_frames: u64, channels: u16, sample_rate: u32) -> Self {
        EditList {
            source_frames,
            channels,
            sample_rate,
            clips: if source_frames == 0 {
                Vec::new()
            } else {
                vec![Clip::new(0, source_frames)]
            },
            stretch: fx::Stretch::default(),
        }
    }

    /// Length of the assembled clips, before stretching.
    pub fn base_frames(&self) -> u64 {
        self.clips.iter().map(|c| c.len).sum()
    }

    /// Total length of the edited result, stretching included.
    pub fn frames(&self) -> u64 {
        self.stretch.output_frames(self.base_frames())
    }

    /// Is the timeline being resampled in time?
    pub fn is_stretched(&self) -> bool {
        !self.stretch.is_identity()
    }

    /// The stretch quality tier as a stable string, for the API.
    pub fn stretch_quality(&self) -> &'static str {
        match self.stretch.quality {
            fx::stretch::Quality::Draft => "draft",
            fx::stretch::Quality::Standard => "standard",
            fx::stretch::Quality::Best => "best",
        }
    }

    pub fn duration_secs(&self) -> f64 {
        if self.sample_rate == 0 {
            0.0
        } else {
            self.frames() as f64 / self.sample_rate as f64
        }
    }

    /// Has anything actually been changed?
    pub fn is_identity(&self) -> bool {
        *self == EditList::identity(self.source_frames, self.channels, self.sample_rate)
    }

    /// Timeline position where clip `i` begins, on the pre-stretch timeline.
    pub fn clip_start(&self, i: usize) -> u64 {
        self.clips[..i].iter().map(|c| c.len).sum()
    }

    /// Find the clip containing frame `pos` on the pre-stretch timeline.
    pub fn locate(&self, pos: u64) -> Option<(usize, u64)> {
        let mut acc = 0u64;
        for (i, c) in self.clips.iter().enumerate() {
            if pos < acc + c.len {
                return Some((i, pos - acc));
            }
            acc += c.len;
        }
        None
    }
}

impl fmt::Display for EditList {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} clip(s), {} frames ({:.2}s)",
            self.clips.len(),
            self.frames(),
            self.duration_secs()
        )
    }
}

/// An edit document plus its undo history.
///
/// History is a stack of whole documents rather than a log of inverse
/// operations. A document is a handful of integers per clip, so snapshots cost
/// bytes — and unlike inverse operations they cannot drift out of step with the
/// thing they are meant to undo.
pub struct Session {
    current: EditList,
    undo: Vec<EditList>,
    redo: Vec<EditList>,
    limit: usize,
}

impl Session {
    pub fn new(list: EditList) -> Self {
        Session {
            current: list,
            undo: Vec::new(),
            redo: Vec::new(),
            limit: 200,
        }
    }

    pub fn list(&self) -> &EditList {
        &self.current
    }

    /// Apply a change, recording the previous state for undo.
    ///
    /// If the change leaves the document untouched, nothing is pushed — an
    /// undo that does nothing is worse than no undo at all.
    pub fn apply(&mut self, f: impl FnOnce(&mut EditList)) -> bool {
        let before = self.current.clone();
        f(&mut self.current);
        if self.current == before {
            return false;
        }
        self.undo.push(before);
        if self.undo.len() > self.limit {
            self.undo.remove(0);
        }
        self.redo.clear();
        true
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    pub fn undo(&mut self) -> bool {
        match self.undo.pop() {
            Some(prev) => {
                self.redo.push(std::mem::replace(&mut self.current, prev));
                true
            }
            None => false,
        }
    }

    pub fn redo(&mut self) -> bool {
        match self.redo.pop() {
            Some(next) => {
                self.undo.push(std::mem::replace(&mut self.current, next));
                true
            }
            None => false,
        }
    }

    /// Throw away every edit and return to the untouched source.
    pub fn revert(&mut self) {
        self.apply(|l| {
            *l = EditList::identity(l.source_frames, l.channels, l.sample_rate);
        });
    }
}
