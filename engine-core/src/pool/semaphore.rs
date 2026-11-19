//! OS semaphores: create/destroy off audio, signal/wait at the level boundary.
#![allow(unsafe_code)]

#[cfg(target_vendor = "apple")]
mod os {
    unsafe extern "C" {
        static mach_task_self_: u32;
        fn semaphore_create(task: u32, sem: *mut u32, policy: i32, value: i32) -> i32;
        fn semaphore_destroy(task: u32, sem: u32) -> i32;
        fn semaphore_signal(sem: u32) -> i32;
        fn semaphore_wait(sem: u32) -> i32;
        fn pthread_set_qos_class_self_np(qos: u32, relative: i32) -> i32;
    }
    pub struct Semaphore(u32);
    impl Semaphore {
        pub fn new() -> Option<Self> {
            let mut sem = 0;
            (unsafe { semaphore_create(mach_task_self_, &mut sem, 0, 0) } == 0).then_some(Self(sem))
        }
        pub fn signal(&self) {
            assert_eq!(unsafe { semaphore_signal(self.0) }, 0);
        }
        pub fn wait(&self) {
            loop {
                let code = unsafe { semaphore_wait(self.0) };
                if code == 0 {
                    return;
                }
                assert_eq!(code, 14);
            }
        }
    }
    impl Drop for Semaphore {
        fn drop(&mut self) {
            unsafe {
                semaphore_destroy(mach_task_self_, self.0);
            }
        }
    }
    pub fn raise_priority() {
        unsafe {
            pthread_set_qos_class_self_np(0x21, 0);
        }
    }
}
#[cfg(any(target_os = "linux", target_os = "android"))]
mod os {
    use std::cell::UnsafeCell;
    use std::ffi::c_void;
    unsafe extern "C" {
        fn sem_init(sem: *mut c_void, shared: i32, value: u32) -> i32;
        fn sem_destroy(sem: *mut c_void) -> i32;
        fn sem_post(sem: *mut c_void) -> i32;
        fn sem_wait(sem: *mut c_void) -> i32;
    }
    // Linux/Android sem_t fits in this aligned fixed storage. The Box keeps
    // its address stable from initialization through the final worker join.
    pub struct Semaphore(Box<UnsafeCell<[usize; 8]>>);
    unsafe impl Send for Semaphore {}
    unsafe impl Sync for Semaphore {}
    impl Semaphore {
        fn ptr(&self) -> *mut c_void {
            self.0.get().cast()
        }
        pub fn new() -> Option<Self> {
            let storage = Box::new(UnsafeCell::new([0; 8]));
            if unsafe { sem_init(storage.get().cast(), 0, 0) } == 0 {
                Some(Self(storage))
            } else {
                None
            }
        }
        pub fn signal(&self) {
            assert_eq!(unsafe { sem_post(self.ptr()) }, 0);
        }
        pub fn wait(&self) {
            while unsafe { sem_wait(self.ptr()) } != 0 {}
        }
    }
    impl Drop for Semaphore {
        fn drop(&mut self) {
            unsafe {
                sem_destroy(self.ptr());
            }
        }
    }
    pub fn raise_priority() {} // The host hook may join the device's workgroup.
}
#[cfg(target_os = "windows")]
mod os {
    use std::ffi::c_void;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateSemaphoreW(
            attr: *const c_void,
            initial: i32,
            max: i32,
            name: *const u16,
        ) -> *mut c_void;
        fn ReleaseSemaphore(handle: *mut c_void, count: i32, previous: *mut i32) -> i32;
        fn WaitForSingleObject(handle: *mut c_void, timeout: u32) -> u32;
        fn CloseHandle(handle: *mut c_void) -> i32;
        fn GetCurrentThread() -> *mut c_void;
        fn SetThreadPriority(handle: *mut c_void, priority: i32) -> i32;
    }
    pub struct Semaphore(usize);
    impl Semaphore {
        pub fn new() -> Option<Self> {
            let handle =
                unsafe { CreateSemaphoreW(std::ptr::null(), 0, i32::MAX, std::ptr::null()) };
            (!handle.is_null()).then_some(Self(handle as usize))
        }
        pub fn signal(&self) {
            assert_ne!(
                unsafe { ReleaseSemaphore(self.0 as *mut _, 1, std::ptr::null_mut()) },
                0
            );
        }
        pub fn wait(&self) {
            assert_eq!(
                unsafe { WaitForSingleObject(self.0 as *mut _, u32::MAX) },
                0
            );
        }
    }
    impl Drop for Semaphore {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0 as *mut _);
            }
        }
    }
    pub fn raise_priority() {
        unsafe {
            SetThreadPriority(GetCurrentThread(), 2);
        }
    }
}
pub use os::{raise_priority, Semaphore};
