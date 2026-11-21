use engine_capi::*;
use std::{ptr, sync::Mutex};
/// What a sample is after the sound-card clamp. On x86 the render's
/// denormals-are-zero (stage 0) reads a subnormal as a zero of its sign; Apple
/// silicon's flush-to-zero leaves an input that is only copied alone.
fn through(v: f32) -> f32 {
    if cfg!(target_arch = "x86_64") && v.is_subnormal() {
        0.0f32.copysign(v)
    } else {
        v
    }
}

fn sample(i: usize, c: usize) -> f32 {
    match i % 19 {
        0 => return -0.0,
        1 => return f32::from_bits(1),
        2 => return f32::from_bits(0x8000_0001),
        3 => return 1.0,
        4 => return -1.0,
        _ => {}
    }
    if i % 19 == 0 {
        -0.0
    } else {
        ((i * 71 + c * 193) % 65536) as f32 / 131072.0 - 0.25
    }
}
#[test]
fn c_input_pairs_loop_back_at_every_size_and_old_render_is_silence() {
    unsafe {
        let e = ne_new(48000.0, 257, 0, 0);
        assert_eq!(ne_add(e, 1, NE_INPUT, 1.0, 0.0), 0);
        assert_eq!(ne_connect_out(e, 1, 0), 0);
        assert!(ne_commit(e, 0) > 0);
        let channels: Vec<Vec<f32>> = (0..3)
            .map(|c| (0..4096).map(|i| sample(i, c)).collect())
            .collect();
        let pointers: Vec<*const f32> = channels.iter().map(|v| v.as_ptr()).collect();
        let (mut l, mut r) = ([0.0; 4096], [0.0; 4096]);
        for n in 1..=4096 {
            assert_eq!(
                ne_render_io(e, pointers.as_ptr(), 3, l.as_mut_ptr(), r.as_mut_ptr(), n),
                0
            );
            for i in 0..n as usize {
                assert_eq!(l[i].to_bits(), through(channels[2][i]).to_bits());
                assert_eq!(r[i].to_bits(), 0);
            }
        }
        assert_eq!(ne_render(e, l.as_mut_ptr(), r.as_mut_ptr(), 4096), 0);
        assert!(l.iter().chain(&r).all(|v| v.to_bits() == 0));
        assert_eq!(
            ne_render_io(e, ptr::null(), 0, l.as_mut_ptr(), r.as_mut_ptr(), 4096),
            0
        );
        let nulls = [ptr::null(); 4];
        assert_eq!(
            ne_render_io(e, nulls.as_ptr(), 4, l.as_mut_ptr(), r.as_mut_ptr(), 4096),
            0
        );
        assert_eq!(
            ne_render_io(e, ptr::null(), 1, l.as_mut_ptr(), r.as_mut_ptr(), 64),
            -11
        );
        ne_free(e);
    }
}
unsafe extern "C" fn sink(user: *mut std::ffi::c_void, frame: u64, rate: f32, l: f32, r: f32) {
    assert!(!engine_core::rt::in_audio());
    (&*(user as *const Mutex<Vec<(u64, f32, f32, f32)>>))
        .lock()
        .unwrap()
        .push((frame, rate, l, r));
}
#[test]
fn c_sink_runs_off_audio_and_receives_the_exact_record_interval() {
    unsafe {
        let frames = Box::new(Mutex::new(Vec::<(u64, f32, f32, f32)>::new()));
        let e = ne_new(48000.0, 31, 0, 0);
        assert_eq!(ne_add(e, 1, NE_INPUT, 0.0, 0.0), 0);
        assert_eq!(
            ne_add_recorder(e, 2, 1024, Some(sink), &*frames as *const _ as *mut _),
            0
        );
        assert_eq!(ne_connect(e, 1, 0, 2, 0), 0);
        assert!(ne_commit(e, 0) > 0);
        assert!(ne_param(e, 17, 2, 0, 1.0) > 0);
        assert!(ne_param(e, 101, 2, 0, 0.0) > 0);
        let input: Vec<f32> = (0..125).map(|i| sample(i, 0)).collect();
        let pointers = [input.as_ptr(), input.as_ptr()];
        let (mut l, mut r) = ([0.0; 125], [0.0; 125]);
        assert_eq!(
            ne_render_io(e, pointers.as_ptr(), 2, l.as_mut_ptr(), r.as_mut_ptr(), 125),
            0
        );
        let mut reports = [NeRecordingReport::default(); 4];
        assert_eq!(ne_recording_reports(e, reports.as_mut_ptr(), 4), 0);
        ne_free(e); // Joins the helper and drains remaining accepted frames.
        let frames = frames.lock().unwrap();
        assert_eq!(frames.len(), 84);
        for (i, (frame, rate, l, r)) in frames.iter().enumerate() {
            assert_eq!(*frame, (17 + i) as u64);
            assert_eq!(*rate, 48000.0);
            assert_eq!(l.to_bits(), input[17 + i].to_bits());
            assert_eq!(r.to_bits(), input[17 + i].to_bits());
        }
    }
}

struct Stalled {
    entered: std::sync::atomic::AtomicBool,
    release: std::sync::atomic::AtomicBool,
    frames: std::sync::atomic::AtomicU64,
}
unsafe extern "C" fn stalled_sink(user: *mut std::ffi::c_void, _: u64, _: f32, _: f32, _: f32) {
    use std::sync::atomic::Ordering;
    let state = &*(user as *const Stalled);
    state.entered.store(true, Ordering::Release);
    while !state.release.load(Ordering::Acquire) {
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    state.frames.fetch_add(1, Ordering::Relaxed);
}
#[test]
fn c_overflow_notice_is_once_and_count_remains_live() {
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    unsafe {
        let state = Box::new(Stalled {
            entered: AtomicBool::new(false),
            release: AtomicBool::new(false),
            frames: AtomicU64::new(0),
        });
        let e = ne_new(48000.0, 64, 0, 0);
        assert_eq!(ne_add(e, 1, NE_INPUT, 0.0, 0.0), 0);
        assert_eq!(
            ne_add_recorder(e, 2, 8, Some(stalled_sink), &*state as *const _ as *mut _),
            0
        );
        assert_eq!(ne_connect(e, 1, 0, 2, 0), 0);
        assert!(ne_commit(e, 0) > 0);
        assert!(ne_param(e, 0, 2, 0, 1.0) > 0);
        let (mut l, mut r) = ([0.0; 64], [0.0; 64]);
        let input = [0.25; 64];
        let pointers = [input.as_ptr(), input.as_ptr()];
        assert_eq!(
            ne_render_io(e, pointers.as_ptr(), 2, l.as_mut_ptr(), r.as_mut_ptr(), 64),
            0
        );
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !state.entered.load(Ordering::Acquire) {
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        let mut reports = [NeRecordingReport::default(); 4];
        assert_eq!(ne_recording_reports(e, reports.as_mut_ptr(), 4), 1);
        assert_eq!(reports[0].kind, 1);
        assert_eq!(reports[0].module, 2);
        let first = reports[0].dropped;
        for _ in 0..100 {
            assert_eq!(
                ne_render_io(e, pointers.as_ptr(), 2, l.as_mut_ptr(), r.as_mut_ptr(), 64),
                0
            );
        }
        let dropped = ne_recording_dropped(e, 2);
        assert!(dropped > first);
        assert_eq!(ne_recording_reports(e, reports.as_mut_ptr(), 4), 0);
        state.release.store(true, Ordering::Release);
        ne_free(e);
        assert_eq!(state.frames.load(Ordering::Relaxed) + dropped, 101 * 64);
    }
}
