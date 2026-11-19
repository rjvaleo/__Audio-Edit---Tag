//! What travels down a cable.

/// A module's number in the patch. The patch gives it, and it stays the same
/// through a save and a load.
pub type ModuleId = u32;

/// The five kinds of cable. Only like plugs into like.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Kind {
    /// Stereo sound.
    Audio,
    /// Modulation: one value per sample.
    Control,
    /// Notes, each with the sample it starts on.
    Notes,
    /// Playing or stopped, the tempo and the beat position.
    Clock,
    /// Which loaded sound, and which version of it.
    Sound,
}

impl Kind {
    pub const ALL: [Kind; 5] = [
        Kind::Audio,
        Kind::Control,
        Kind::Notes,
        Kind::Clock,
        Kind::Sound,
    ];

    pub(crate) fn index(self) -> usize {
        self as usize
    }
}

/// One socket on one module.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct PortRef {
    pub module: ModuleId,
    pub port: u32,
}

pub fn port(module: ModuleId, port: u32) -> PortRef {
    PortRef { module, port }
}

/// A cable, from an output to an input. Ordered by its source first, which is
/// the order cables meeting at one input are summed in.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Cable {
    pub from: PortRef,
    pub to: PortRef,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoteKind {
    On,
    Off,
    AllOff,
}

/// One note message. `offset` counts samples from the start of the piece of
/// audio being made.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NoteEvent {
    pub offset: u32,
    pub kind: NoteKind,
    pub note: u8,
    pub channel: u8,
    pub velocity: f32,
    pub detune_cents: f32,
}

impl NoteEvent {
    pub fn on(note: u8, velocity: f32) -> Self {
        Self {
            offset: 0,
            kind: NoteKind::On,
            note,
            channel: 0,
            velocity,
            detune_cents: 0.0,
        }
    }

    pub fn off(note: u8) -> Self {
        Self {
            offset: 0,
            kind: NoteKind::Off,
            note,
            channel: 0,
            velocity: 0.0,
            detune_cents: 0.0,
        }
    }
}

/// The clock at the first sample of a piece of audio.
///
/// A module that needs the beat at later samples adds [`ClockState::step`]
/// once per sample, as the clock itself does. The same additions in the same
/// order give the same beat however the audio is cut into pieces.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClockState {
    pub playing: bool,
    pub bpm: f64,
    pub beat: f64,
}

impl ClockState {
    pub const STOPPED: ClockState = ClockState {
        playing: false,
        bpm: 120.0,
        beat: 0.0,
    };

    /// Beats per sample.
    pub fn step(&self, rate: f32) -> f64 {
        self.bpm / (60.0 * rate as f64)
    }
}

/// A loaded sound and its version. Id 0 is "no sound".
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct SoundRef {
    pub id: u32,
    pub version: u32,
}

/// The most notes one cable carries in one piece of audio.
pub const NOTE_CAP: usize = 256;

/// The notes on one cable for one piece of audio. Its room is set when it is
/// made; a note past that is refused, not grown into.
pub struct NoteBuf {
    events: Vec<NoteEvent>,
}

impl NoteBuf {
    pub(crate) fn new() -> Self {
        Self {
            events: Vec::with_capacity(NOTE_CAP),
        }
    }

    /// False when the cable is full and the note was left out.
    pub fn push(&mut self, event: NoteEvent) -> bool {
        if self.events.len() < NOTE_CAP {
            self.events.push(event);
            true
        } else {
            false
        }
    }

    pub fn clear(&mut self) {
        self.events.clear();
    }

    pub fn as_slice(&self) -> &[NoteEvent] {
        &self.events
    }

    pub(crate) fn as_mut_slice(&mut self) -> &mut [NoteEvent] {
        &mut self.events
    }
}

/// One port's storage for one piece of audio.
pub enum Buf {
    Audio {
        l: Box<[f32]>,
        r: Box<[f32]>,
        silent: bool,
    },
    Control(Box<[f32]>),
    Notes(NoteBuf),
    Clock(ClockState),
    Sound(SoundRef),
}

impl Buf {
    /// Positive zero only: treating negative zero as skippable would change
    /// the bits carried by transparent effects and cables.
    pub fn is_silent(&self) -> bool {
        matches!(self, Buf::Audio { silent: true, .. })
    }
    pub(crate) fn mark_silence(&mut self, n: usize) {
        if let Buf::Audio { l, r, silent } = self {
            *silent = l[..n].iter().chain(&r[..n]).all(|x| x.to_bits() == 0);
        }
    }

    pub(crate) fn new(kind: Kind, len: usize) -> Self {
        match kind {
            Kind::Audio => Buf::Audio {
                silent: true,
                l: vec![0.0; len].into_boxed_slice(),
                r: vec![0.0; len].into_boxed_slice(),
            },
            Kind::Control => Buf::Control(vec![0.0; len].into_boxed_slice()),
            Kind::Notes => Buf::Notes(NoteBuf::new()),
            Kind::Clock => Buf::Clock(ClockState::STOPPED),
            Kind::Sound => Buf::Sound(SoundRef::default()),
        }
    }
}
