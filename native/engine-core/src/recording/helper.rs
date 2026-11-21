//! Controller-created helper lifetime. This module is never called by
//! Recorder::process/handle/report; the audio producer only touches spsc.
use super::RecordedFrame;
use crate::spsc;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread::{self, JoinHandle};
use std::time::Duration;

#[derive(Clone)]
pub(super) struct Sink(Arc<Mutex<Box<dyn FnMut(RecordedFrame) + Send>>>);
impl Sink {
    pub(super) fn new(sink: impl FnMut(RecordedFrame) + Send + 'static) -> Self {
        Self(Arc::new(Mutex::new(Box::new(sink))))
    }
}
pub(super) struct Worker {
    stop: Arc<AtomicBool>,
    helper: Option<JoinHandle<()>>,
}
pub(super) fn spawn(capacity: usize, sink: Sink) -> (spsc::Producer<RecordedFrame>, Worker) {
    let (tx, mut rx) = spsc::channel(capacity);
    let stop = Arc::new(AtomicBool::new(false));
    let done = stop.clone();
    let helper = thread::Builder::new()
        .name("native-recorder".into())
        .spawn(move || {
            loop {
                if let Some(frame) = rx.pop() {
                    (sink.0.lock().unwrap())(frame);
                } else if done.load(Ordering::Acquire) {
                    // Acquire observes producer pushes before controller shutdown.
                    while let Some(frame) = rx.pop() {
                        (sink.0.lock().unwrap())(frame);
                    }
                    break;
                } else {
                    thread::sleep(Duration::from_millis(1));
                }
            }
        })
        .expect("recorder helper");
    (
        tx,
        Worker {
            stop,
            helper: Some(helper),
        },
    )
}
impl Drop for Worker {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(helper) = self.helper.take() {
            let _ = helper.join();
        }
    }
}
