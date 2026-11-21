//! Fixed workers and a bounded, synchronous fork/join. Jobs cannot outlive run.
#![allow(unsafe_code)]
use crate::guard::FloatMode;
use std::cell::UnsafeCell;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};
use std::thread::{self, JoinHandle};

mod semaphore;
use semaphore::Semaphore;

#[derive(Clone, Copy)]
struct Dispatch {
    data: *mut (),
    execute: unsafe fn(*mut (), usize),
    count: usize,
    mode: FloatMode,
}
struct Shared {
    dispatch: UnsafeCell<Dispatch>,
    next: AtomicUsize,
    epoch: AtomicUsize,
    remaining: AtomicUsize,
    stop: AtomicBool,
    started: AtomicBool,
    wake: Vec<Semaphore>,
    done: Semaphore,
    ready: Semaphore,
    jobs: AtomicUsize,
}
// SAFETY: dispatch is changed only with all workers parked. The release/acquire
// on remaining publishes it. Each claimed index gives one exclusive job, and
// done is signalled only after every worker has released its job references.
unsafe impl Send for Shared {}
unsafe impl Sync for Shared {}

pub(crate) struct Pool {
    shared: Arc<Shared>,
    threads: Vec<JoinHandle<()>>,
}
impl Pool {
    pub(crate) fn new(hook: Option<fn(usize)>) -> Option<Self> {
        let count = thread::available_parallelism()
            .ok()?
            .get()
            .saturating_sub(1)
            .min(4);
        if count == 0 {
            return None;
        }
        let wake = (0..count)
            .map(|_| Semaphore::new())
            .collect::<Option<Vec<_>>>()?;
        let shared = Arc::new(Shared {
            dispatch: UnsafeCell::new(Dispatch {
                data: std::ptr::null_mut(),
                execute: empty,
                count: 0,
                mode: FloatMode::capture(),
            }),
            epoch: AtomicUsize::new(0),
            next: AtomicUsize::new(0),
            remaining: AtomicUsize::new(0),
            stop: AtomicBool::new(false),
            started: AtomicBool::new(true),
            wake,
            done: Semaphore::new()?,
            ready: Semaphore::new()?,
            jobs: AtomicUsize::new(0),
        });
        let mut pool = Self {
            shared,
            threads: Vec::with_capacity(count),
        };
        for index in 0..count {
            let shared = Arc::clone(&pool.shared);
            match thread::Builder::new()
                .name(format!("native-audio-{index}"))
                .spawn(move || {
                    let ok = std::panic::catch_unwind(|| {
                        semaphore::raise_priority();
                        if let Some(hook) = hook {
                            hook(index);
                        }
                        let _warm = crate::rt::enter();
                    })
                    .is_ok();
                    if !ok {
                        shared.started.store(false, Ordering::Release);
                    }
                    shared.ready.signal();
                    let mut epoch = 0;
                    loop {
                        shared.wake[index].wait();
                        if shared.stop.load(Ordering::Acquire) {
                            break;
                        }
                        // Acquire the descriptor published before signalling wake.
                        loop {
                            let next = shared.epoch.load(Ordering::Acquire);
                            if next != epoch {
                                epoch = next;
                                break;
                            }
                            std::hint::spin_loop();
                        }
                        drain(&shared, true, if index == 0 { Some(0) } else { None });
                        if shared.remaining.fetch_sub(1, Ordering::AcqRel) == 1 {
                            shared.done.signal();
                        }
                    }
                }) {
                Ok(handle) => pool.threads.push(handle),
                Err(_) => return None,
            }
            pool.shared.ready.wait();
        }
        if !pool.shared.started.load(Ordering::Acquire) {
            return None;
        }
        Some(pool)
    }
    /// # Safety
    /// execute must catch every unwind: the stack descriptor must remain alive
    /// until all workers join. The plan's dispatch wrapper enforces this.
    pub(crate) unsafe fn run<J: Send>(&mut self, jobs: &mut [J], execute: fn(&mut J)) {
        if jobs.is_empty() {
            return;
        }
        if jobs.len() == 1 {
            execute(&mut jobs[0]);
            return;
        }
        struct Batch<J> {
            jobs: *mut J,
            execute: fn(&mut J),
        }
        unsafe fn call<J>(data: *mut (), index: usize) {
            let batch = &*(data as *const Batch<J>);
            (batch.execute)(&mut *batch.jobs.add(index));
        }
        let mut batch = Batch {
            jobs: jobs.as_mut_ptr(),
            execute,
        };
        // SAFETY: run is exclusive, prior dispatch completed, and the stack
        // batch plus caller's jobs stay alive until the done semaphore joins.
        unsafe {
            *self.shared.dispatch.get() = Dispatch {
                data: &mut batch as *mut _ as *mut (),
                execute: call::<J>,
                count: jobs.len(),
                mode: FloatMode::capture(),
            };
        }
        self.shared.next.store(2, Ordering::Relaxed);
        self.shared
            .remaining
            .store(self.threads.len(), Ordering::Release);
        self.shared.epoch.fetch_add(1, Ordering::Release);
        for wake in &self.shared.wake {
            wake.signal();
        }
        drain(&self.shared, false, Some(1));
        for _ in 0..128 {
            if self.shared.remaining.load(Ordering::Acquire) == 0 {
                break;
            }
            std::hint::spin_loop();
        }
        // Consume exactly one completion token, including a fast completion.
        self.shared.done.wait();
        self.shared.remaining.load(Ordering::Acquire);
    }
    pub(crate) fn worker_jobs(&self) -> usize {
        self.shared.jobs.load(Ordering::Relaxed)
    }
}
unsafe fn empty(_: *mut (), _: usize) {}
fn drain(shared: &Shared, worker: bool, first: Option<usize>) {
    // SAFETY: the published descriptor is immutable until the join completes.
    let dispatch = unsafe { *shared.dispatch.get() };
    let _mode = dispatch.mode.enter();
    let _audio = crate::rt::enter();
    if let Some(index) = first {
        if worker {
            shared.jobs.fetch_add(1, Ordering::Relaxed);
        }
        // The first two jobs have fixed owners; all others use the counter.
        unsafe {
            (dispatch.execute)(dispatch.data, index);
        }
    }
    loop {
        let index = shared.next.fetch_add(1, Ordering::Relaxed);
        if index >= dispatch.count {
            break;
        }
        if worker {
            shared.jobs.fetch_add(1, Ordering::Relaxed);
        }
        // SAFETY: atomic claim is unique and in range. The callback's own
        // contract catches panics and releases references before returning.
        unsafe {
            (dispatch.execute)(dispatch.data, index);
        }
    }
}
impl Drop for Pool {
    fn drop(&mut self) {
        // Engine destruction belongs on the controller/host thread.
        self.shared.stop.store(true, Ordering::Release);
        for wake in &self.shared.wake {
            wake.signal();
        }
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
    }
}

/// Only the plan compiler creates these, for sources completed before a
/// level starts. No mutable borrow of the whole buffer pool crosses a join.
#[derive(Clone, Copy)]
pub(crate) struct ReadBuf(*const crate::Buf);
impl ReadBuf {
    pub(crate) fn empty() -> Self {
        Self(std::ptr::null())
    }
    pub(crate) fn set(&mut self, buffer: &crate::Buf) {
        self.0 = buffer;
    }
    pub(crate) fn get(&self) -> &crate::Buf {
        // SAFETY: plan fills each slot before dispatch; sources belong to
        // earlier levels or private mixing buffers. The join bounds this ref.
        unsafe { &*self.0 }
    }
}
unsafe impl Send for ReadBuf {}
unsafe impl Sync for ReadBuf {}
