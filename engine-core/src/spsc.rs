//! A queue from one thread to one other.
//!
//! One side only ever pushes and the other only ever pops, so neither needs a
//! lock: each owns one counter and reads the other's. Its room is set when it
//! is made. A push into a full queue hands the value back; nothing ever waits.
#![allow(unsafe_code)]

use std::cell::UnsafeCell;
use std::mem::MaybeUninit;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

// Separate the independently written counters even on 128-byte cache lines.
#[repr(align(128))]
struct Counter(AtomicUsize);

struct Ring<T> {
    slots: Box<[UnsafeCell<MaybeUninit<T>>]>,
    mask: usize,
    /// Next slot to read. Written only by the consumer.
    head: Counter,
    /// Next slot to write. Written only by the producer.
    tail: Counter,
}

// The two ends never touch the same slot at once: the producer writes only
// slots at or past `tail`, the consumer reads only slots before it, and each
// counter is published after its slot is finished with.
unsafe impl<T: Send> Send for Ring<T> {}
unsafe impl<T: Send> Sync for Ring<T> {}

pub struct Producer<T> {
    ring: Arc<Ring<T>>,
}

pub struct Consumer<T> {
    ring: Arc<Ring<T>>,
}

/// A queue with room for at least `capacity` items (rounded up to a power of two).
pub fn channel<T>(capacity: usize) -> (Producer<T>, Consumer<T>) {
    let size = capacity.max(2).next_power_of_two();
    let slots: Vec<UnsafeCell<MaybeUninit<T>>> =
        (0..size).map(|_| UnsafeCell::new(MaybeUninit::uninit())).collect();
    let ring = Arc::new(Ring {
        slots: slots.into_boxed_slice(),
        mask: size - 1,
        head: Counter(AtomicUsize::new(0)),
        tail: Counter(AtomicUsize::new(0)),
    });
    (Producer { ring: ring.clone() }, Consumer { ring })
}

impl<T> Producer<T> {
    /// `Err` gives the value back when there is no room.
    pub fn push(&mut self, value: T) -> Result<(), T> {
        let ring = &*self.ring;
        let tail = ring.tail.0.load(Ordering::Relaxed);
        let head = ring.head.0.load(Ordering::Acquire);
        if tail.wrapping_sub(head) > ring.mask {
            return Err(value);
        }
        unsafe {
            (*ring.slots[tail & ring.mask].get()).write(value);
        }
        ring.tail.0.store(tail.wrapping_add(1), Ordering::Release);
        Ok(())
    }

    pub fn is_full(&self) -> bool {
        let ring = &*self.ring;
        let tail = ring.tail.0.load(Ordering::Relaxed);
        tail.wrapping_sub(ring.head.0.load(Ordering::Acquire)) > ring.mask
    }
}

impl<T> Consumer<T> {
    pub fn pop(&mut self) -> Option<T> {
        let ring = &*self.ring;
        let head = ring.head.0.load(Ordering::Relaxed);
        if head == ring.tail.0.load(Ordering::Acquire) {
            return None;
        }
        let value = unsafe { (*ring.slots[head & ring.mask].get()).assume_init_read() };
        ring.head.0.store(head.wrapping_add(1), Ordering::Release);
        Some(value)
    }
}

impl<T> Drop for Ring<T> {
    fn drop(&mut self) {
        let mut head = *self.head.0.get_mut();
        let tail = *self.tail.0.get_mut();
        while head != tail {
            unsafe {
                (*self.slots[head & self.mask].get()).assume_init_drop();
            }
            head = head.wrapping_add(1);
        }
    }
}

#[cfg(test)]
mod layout {
    use super::*;
    #[test]
    fn producer_and_consumer_counters_have_their_own_cache_lines() {
        let (producer, _) = channel::<u8>(16);
        let head = &producer.ring.head as *const Counter as usize;
        let tail = &producer.ring.tail as *const Counter as usize;
        assert_eq!(head % 128, 0);
        assert_eq!(tail % 128, 0);
        assert!(head.abs_diff(tail) >= 128);
    }
}
