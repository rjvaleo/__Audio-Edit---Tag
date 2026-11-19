//! An audio-owned producer and a helper-owned sink. The callback only pushes
//! preallocated slots; polling, user code and joining happen off audio.
use crate::{spsc, EventKind, Io, Kind, Module, ModuleFactory};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
mod helper;
use helper::Sink;

#[derive(Clone, Copy, Debug)]
pub struct RecordedFrame {
    pub frame: u64,
    pub rate: f32,
    pub samples: [f32; 2],
}

/// Live cumulative loss for this recorder instance. One overflow notice is
/// sent through Back, and remains accurate while the sink is still stalled.
#[derive(Clone, Debug)]
pub struct DroppedFrames(Arc<AtomicU64>);
impl DroppedFrames {
    pub fn frames(&self) -> u64 {
        self.0.load(Ordering::Relaxed)
    }
}
#[derive(Clone, Debug)]
pub enum RecorderReport {
    Overflow(DroppedFrames),
    StoppedForRate {
        frame: u64,
        old_rate: f32,
        new_rate: f32,
    },
}
#[derive(Clone, Debug)]
pub struct RecordingReport {
    pub module: crate::ModuleId,
    pub report: RecorderReport,
}

pub struct Recorder {
    tx: spsc::Producer<RecordedFrame>,
    _worker: helper::Worker,
    sink: Sink,
    capacity: usize,
    rate: f32,
    active: bool,
    disabled: bool,
    dropped: DroppedFrames,
    notified: bool,
    overflow: bool,
    rate_report: Option<RecorderReport>,
}
impl Recorder {
    /// Param 0, >= 0.5 starts and < 0.5 stops, on the event's exact frame.
    pub const RECORD: u32 = 0;
    /// At least `capacity` stereo frames (rounded to a power of two).
    /// The sink runs only on a helper. Removal/engine destruction joins it
    /// on the controller thread after draining; the sink must eventually return.
    pub fn new(capacity: usize, sink: impl FnMut(RecordedFrame) + Send + 'static) -> Self {
        Self::with_sink(capacity, Sink::new(sink))
    }
    fn with_sink(capacity: usize, sink: Sink) -> Self {
        let (tx, worker) = helper::spawn(capacity, sink.clone());
        Self {
            tx,
            _worker: worker,
            sink,
            capacity,
            rate: 0.0,
            active: false,
            disabled: false,
            dropped: DroppedFrames(Arc::new(AtomicU64::new(0))),
            notified: false,
            overflow: false,
            rate_report: None,
        }
    }
}
impl Module for Recorder {
    fn factory(&self) -> Option<ModuleFactory> {
        let capacity = self.capacity;
        let sink = self.sink.clone();
        Some(Box::new(move |_, _| {
            Box::new(Self::with_sink(capacity, sink.clone()))
        }))
    }
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn prepare(&mut self, rate: f32, _: usize) {
        self.rate = rate;
    }
    fn handle(&mut self, event: &EventKind) {
        if let EventKind::Param {
            index: Self::RECORD,
            value,
        } = *event
        {
            if !self.disabled {
                self.active = value >= 0.5;
            }
        }
    }
    fn process(&mut self, io: &mut Io) {
        if !self.active {
            return;
        }
        let (l, r) = io.ins.audio(0);
        for i in 0..io.n {
            if self
                .tx
                .push(RecordedFrame {
                    frame: io.frame + i as u64,
                    rate: io.rate,
                    samples: [l[i], r[i]],
                })
                .is_err()
            {
                self.dropped.0.fetch_add(1, Ordering::Relaxed);
                if !self.notified {
                    self.overflow = true;
                }
            }
        }
    }
    fn rate_change(&mut self, rate: f32, frame: u64) {
        if self.active {
            self.rate_report = Some(RecorderReport::StoppedForRate {
                frame,
                old_rate: self.rate,
                new_rate: rate,
            });
        }
        self.active = false;
        self.disabled = true;
    }
    fn rehome(&mut self, _: [f64; 8], _: f32) {
        // A remembered Start must not restart recording after a rate change.
        self.active = false;
    }
    fn recording_report(&mut self) -> Option<RecorderReport> {
        if self.overflow {
            self.overflow = false;
            self.notified = true;
            Some(RecorderReport::Overflow(self.dropped.clone()))
        } else {
            self.rate_report.take()
        }
    }
}
