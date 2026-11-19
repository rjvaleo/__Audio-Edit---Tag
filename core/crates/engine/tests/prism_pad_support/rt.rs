//! Thread-local allocator accounting excludes the concurrent control thread.
#![allow(dead_code)]
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Counts {
    pub alloc: usize,
    pub free: usize,
    pub realloc: usize,
    pub blocking: usize,
}
thread_local! {
    static ACTIVE:Cell<bool>=const {Cell::new(false)};
    static COUNTS:Cell<Counts>=const {Cell::new(Counts{alloc:0,free:0,realloc:0,blocking:0})};
}
fn count(which: u8) {
    if ACTIVE.try_with(Cell::get).unwrap_or(false) {
        COUNTS.with(|c| {
            let mut n = c.get();
            match which {
                0 => n.alloc += 1,
                1 => n.free += 1,
                2 => n.realloc += 1,
                _ => n.blocking += 1,
            }
            c.set(n);
        });
    }
}
struct Counting;
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        count(0);
        System.alloc(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        count(1);
        System.dealloc(p, l)
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        count(2);
        System.realloc(p, l, n)
    }
}
#[global_allocator]
static GLOBAL: Counting = Counting;
pub fn start() {
    COUNTS.with(|c| c.set(Counts::default()));
    ACTIVE.with(|a| a.set(true));
}
pub fn stop() -> Counts {
    ACTIVE.with(|a| a.set(false));
    COUNTS.with(Cell::get)
}
pub fn clean(name: &str, counts: Counts) {
    println!(
        "RT_COUNTS|{name}|{}|{}|{}|{}",
        counts.alloc, counts.free, counts.realloc, counts.blocking
    );
    assert_eq!(counts, Counts::default(), "{name}");
}
// Resolve the system implementations once, then count calls made by this
// executable. A Mach-O interpose section alone misses std's calls from the
// main executable, so the self-test must verify these actual entry points.
#[cfg(target_os = "macos")]
mod locks {
    use super::count;
    use std::ffi::{c_char, c_void};
    use std::sync::atomic::{AtomicPtr, Ordering};
    extern "C" {
        fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void;
    }
    unsafe fn resolve(slot: &AtomicPtr<c_void>, name: &[u8]) -> *mut c_void {
        let mut address = slot.load(Ordering::Acquire);
        if address.is_null() {
            address = dlsym(-1isize as *mut c_void, name.as_ptr().cast());
            if address.is_null() {
                std::process::abort();
            }
            slot.store(address, Ordering::Release);
        }
        address
    }
    #[no_mangle]
    unsafe extern "C" fn pthread_mutex_lock(lock: *mut c_void) -> i32 {
        static REAL: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());
        let real: unsafe extern "C" fn(*mut c_void) -> i32 =
            std::mem::transmute(resolve(&REAL, b"pthread_mutex_lock\0"));
        count(3);
        real(lock)
    }
    #[no_mangle]
    unsafe extern "C" fn os_unfair_lock_lock(lock: *mut u32) {
        static REAL: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());
        let real: unsafe extern "C" fn(*mut u32) =
            std::mem::transmute(resolve(&REAL, b"os_unfair_lock_lock\0"));
        count(3);
        real(lock)
    }
}
pub fn verify() {
    let lock = std::sync::Mutex::new(0);
    drop(lock.lock().unwrap());
    start();
    std::hint::black_box(vec![1u8; std::hint::black_box(64)]);
    drop(lock.lock().unwrap());
    let got = stop();
    assert!(
        got.alloc > 0 && got.free > 0,
        "allocator must catch a deliberate allocation and free: {got:?}"
    );
    #[cfg(target_os = "macos")]
    assert!(
        got.blocking > 0,
        "blocking-lock interposition must catch Mutex::lock: {got:?}"
    );
}
