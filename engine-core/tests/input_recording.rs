#![cfg(feature = "rt-check")]
mod common;
use common::*;
use engine_core::*;
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

struct Counting;
static HEAP: AtomicUsize = AtomicUsize::new(0);
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if engine_core::rt::in_audio() {
            HEAP.fetch_add(1, Ordering::Relaxed);
        }
        System.alloc(layout)
    }
    unsafe fn dealloc(&self, p: *mut u8, layout: Layout) {
        if engine_core::rt::in_audio() {
            HEAP.fetch_add(1, Ordering::Relaxed);
        }
        System.dealloc(p, layout);
    }
}
#[global_allocator]
static ALLOCATOR: Counting = Counting;
fn sample(frame: usize, channel: usize) -> f32 {
    match frame % 19 {
        0 => return -0.0,
        1 => return f32::from_bits(1),
        2 => return f32::from_bits(0x8000_0001),
        3 => return f32::MAX,
        4 => return -f32::MAX,
        _ => {}
    }
    if frame % 19 == 0 {
        -0.0
    } else {
        ((frame.wrapping_mul(747796405).wrapping_add(channel * 7919) >> 8) & 65535) as f32
            / 131072.0
            - 0.25
    }
}
fn wait(mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !condition() {
        assert!(Instant::now() < deadline, "helper did not drain");
        std::thread::sleep(Duration::from_millis(1));
    }
}

#[test]
fn input_loopback_every_size_channels_and_event_offsets() {
    for parallel in [false, true] {
        let (mut ctl, mut audio) = engine(
            RATE,
            Config {
                max_block: 257,
                parallel,
                ..exact()
            },
        );
        ctl.add(1, Box::new(Input::new(&[0, 1, 2]))).unwrap();
        ctl.connect_out(port(1, 1)).unwrap();
        ctl.commit().unwrap();
        // Event subdivision must still read the correct input offset. Input
        // ignores these controls, but the default event dispatcher cuts it.
        for frame in [1, 17, 256, 4097, 9123] {
            ctl.send_at(
                frame,
                1,
                EventKind::Param {
                    index: 0,
                    value: 1.0,
                },
            )
            .unwrap();
        }
        let channels: Vec<Vec<f32>> = (0..5)
            .map(|c| (0..4096).map(|i| sample(i, c)).collect())
            .collect();
        let refs: Vec<&[f32]> = channels.iter().map(Vec::as_slice).collect();
        let (mut l, mut r) = ([0.0; 4096], [0.0; 4096]);
        for n in 1..=4096 {
            let before = HEAP.load(Ordering::Relaxed);
            audio.render_io(&refs, &mut l[..n], &mut r[..n]);
            assert_eq!(HEAP.load(Ordering::Relaxed), before);
            for i in 0..n {
                assert_eq!(l[i].to_bits(), channels[2][i].to_bits());
                assert_eq!(r[i].to_bits(), channels[3][i].to_bits());
            }
        }
        // The odd final host channel keeps its right side silent.
        assert!(ctl.disconnect_out(port(1, 1)));
        ctl.connect_out(port(1, 2)).unwrap();
        ctl.commit().unwrap();
        audio.render_io(&refs, &mut l, &mut r);
        for i in 0..4096 {
            assert_eq!(l[i].to_bits(), channels[4][i].to_bits());
            assert_eq!(r[i].to_bits(), 0);
        }
        audio.render(&mut l, &mut r);
        assert!(l.iter().chain(&r).all(|v| v.to_bits() == 0));
        // A short channel's missing suffix is silence too.
        audio.render_io(
            &[&[], &[], &[], &[], &channels[4][..3]],
            &mut l[..17],
            &mut r[..17],
        );
        assert!(l[3..17].iter().chain(&r[..17]).all(|v| v.to_bits() == 0));
    }
}

#[test]
fn ten_seconds_record_exact_stamped_frames_without_audio_heap_work() {
    for parallel in [false, true] {
        let received = Arc::new(Mutex::new(Vec::<RecordedFrame>::new()));
        let sink = received.clone();
        let recorder = Recorder::new(480_000, move |frame| {
            assert!(!engine_core::rt::in_audio());
            sink.lock().unwrap().push(frame);
        });
        let (mut ctl, mut audio) = engine(
            RATE,
            Config {
                max_block: 257,
                parallel,
                ..exact()
            },
        );
        ctl.add(1, Box::new(Input::new(&[0]))).unwrap();
        ctl.add(2, Box::new(recorder)).unwrap();
        ctl.connect(port(1, 0), port(2, 0)).unwrap();
        ctl.commit().unwrap();
        let start = 37;
        let stop = 479_923;
        ctl.send_at(
            start,
            2,
            EventKind::Param {
                index: Recorder::RECORD,
                value: 1.0,
            },
        )
        .unwrap();
        ctl.send_at(
            stop,
            2,
            EventKind::Param {
                index: Recorder::RECORD,
                value: 0.0,
            },
        )
        .unwrap();
        let (mut l, mut r, mut a, mut b) = ([0.0; 4096], [0.0; 4096], [0.0; 4096], [0.0; 4096]);
        let mut at = 0;
        let mut seed = 39u32;
        while at < 480_000 {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let n = (1 + (seed >> 16) as usize % 4096).min(480_000 - at);
            for i in 0..n {
                a[i] = sample(at + i, 0);
                b[i] = sample(at + i, 1);
            }
            let before = HEAP.load(Ordering::Relaxed);
            audio.render_io(&[&a[..n], &b[..n]], &mut l[..n], &mut r[..n]);
            assert_eq!(HEAP.load(Ordering::Relaxed), before);
            at += n;
        }
        wait(|| received.lock().unwrap().len() == (stop - start) as usize);
        let frames = received.lock().unwrap();
        for (i, x) in frames.iter().enumerate() {
            let frame = i + start as usize;
            assert_eq!(x.frame, frame as u64);
            assert_eq!(x.rate, RATE);
            assert_eq!(x.samples[0].to_bits(), sample(frame, 0).to_bits());
            assert_eq!(x.samples[1].to_bits(), sample(frame, 1).to_bits());
        }
        drop(frames);
        ctl.collect();
        assert!(ctl.take_recording_reports().is_empty());
    }
}

#[test]
fn stalled_sink_drops_and_one_live_counter_reports_every_missing_frame() {
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let frames = Arc::new(Mutex::new(Vec::new()));
    let sink = frames.clone();
    let mut first = true;
    let recorder = Recorder::new(8, move |frame| {
        if first {
            first = false;
            entered_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(10)).unwrap();
        }
        sink.lock().unwrap().push(frame);
    });
    let (mut ctl, mut audio) = engine(
        RATE,
        Config {
            max_block: 64,
            ..exact()
        },
    );
    ctl.add(1, Box::new(Input::new(&[0]))).unwrap();
    ctl.add(2, Box::new(recorder)).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.commit().unwrap();
    ctl.send(
        2,
        EventKind::Param {
            index: Recorder::RECORD,
            value: 1.0,
        },
    )
    .unwrap();
    let (mut l, mut r) = ([0.0; 64], [0.0; 64]);
    let input = [0.25; 64];
    audio.render_io(&[&input, &input], &mut l, &mut r);
    entered_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    ctl.collect();
    let reports = ctl.take_recording_reports();
    assert_eq!(reports.len(), 1);
    assert_eq!(reports[0].module, 2);
    let RecorderReport::Overflow(counter) = &reports[0].report else {
        panic!("overflow")
    };
    let first_count = counter.frames();
    let before = HEAP.load(Ordering::Relaxed);
    for _ in 0..1000 {
        audio.render_io(&[&input, &input], &mut l, &mut r);
    }
    assert_eq!(HEAP.load(Ordering::Relaxed), before);
    assert!(counter.frames() > first_count);
    ctl.send(
        2,
        EventKind::Param {
            index: 0,
            value: 0.0,
        },
    )
    .unwrap();
    audio.render(&mut l, &mut r);
    ctl.collect();
    assert!(ctl.take_recording_reports().is_empty());
    release_tx.send(()).unwrap();
    wait(|| frames.lock().unwrap().len() as u64 + counter.frames() == 1001 * 64);
    assert_eq!(
        frames.lock().unwrap().len() as u64 + counter.frames(),
        1001 * 64
    );
}

#[test]
fn rate_change_stops_recorder_exactly_and_new_start_is_required() {
    let received = Arc::new(Mutex::new(Vec::new()));
    let sink = received.clone();
    let (mut ctl, mut audio) = engine(
        RATE,
        Config {
            max_block: 64,
            fade_frames: 128,
            ..Config::default()
        },
    );
    ctl.add(1, Box::new(Input::new(&[0]))).unwrap();
    ctl.add(
        2,
        Box::new(Recorder::new(1024, move |frame| {
            sink.lock().unwrap().push(frame)
        })),
    )
    .unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.commit().unwrap();
    // Finish patch fades, then record across the requested rate transition.
    let (mut l, mut r) = ([0.0; 64], [0.0; 64]);
    let input = [0.5; 64];
    for _ in 0..4 {
        audio.render_io(&[&input, &input], &mut l, &mut r);
        ctl.collect();
    }
    ctl.send(
        2,
        EventKind::Param {
            index: 0,
            value: 1.0,
        },
    )
    .unwrap();
    audio.render_io(&[&input, &input], &mut l, &mut r);
    let boundary = audio.frame();
    ctl.set_rate(96_000.0).unwrap();
    let before = HEAP.load(Ordering::Relaxed);
    for _ in 0..4 {
        audio.render_io(&[&input, &input], &mut l, &mut r);
    }
    assert_eq!(HEAP.load(Ordering::Relaxed), before);
    ctl.collect();
    let reports = ctl.take_recording_reports();
    assert_eq!(reports.len(), 1);
    assert!(
        matches!(reports[0].report,RecorderReport::StoppedForRate {frame,old_rate:RATE,new_rate:96_000.0} if frame==boundary)
    );
    wait(|| received.lock().unwrap().len() == 64);
    assert!(received
        .lock()
        .unwrap()
        .iter()
        .all(|x| x.frame < boundary && x.rate == RATE));
    ctl.send(
        2,
        EventKind::Param {
            index: 0,
            value: 1.0,
        },
    )
    .unwrap();
    let resume = audio.frame();
    audio.render_io(&[&input, &input], &mut l, &mut r);
    wait(|| received.lock().unwrap().len() == 128);
    let frames = received.lock().unwrap();
    assert_eq!(frames[64].frame, resume);
    assert_eq!(frames[64].rate, 96_000.0);
}

struct HostBranch {
    feedback: bool,
}
impl Module for HostBranch {
    fn inputs(&self) -> Vec<Kind> {
        if self.feedback {
            vec![Kind::Audio]
        } else {
            vec![]
        }
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn parallel_weight(&self) -> usize {
        16
    }
    fn process(&mut self, io: &mut Io) {
        let input = io.host.channel(0, io.frame, io.n);
        let (l, r) = io.outs.audio(0);
        l.copy_from_slice(input);
        r.copy_from_slice(input);
    }
}
#[test]
fn host_borrow_survives_pool_join_and_feedback_island_subdivision() {
    let input: Vec<f32> = (0..4096).map(|i| sample(i, 0)).collect();
    let (mut l, mut r) = ([0.0; 4096], [0.0; 4096]);
    let (mut ctl, mut audio) = engine(
        RATE,
        Config {
            max_block: 512,
            parallel: true,
            ..exact()
        },
    );
    for id in [1, 2] {
        ctl.add(id, Box::new(HostBranch { feedback: false }))
            .unwrap();
    }
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit().unwrap();
    audio.render_io(&[&input], &mut l, &mut r);
    assert!(audio.worker_jobs() > 0);
    for i in 0..4096 {
        assert_eq!(l[i].to_bits(), input[i].to_bits());
    }
    let (mut ctl, mut audio) = engine(
        RATE,
        Config {
            max_block: 512,
            ..exact()
        },
    );
    ctl.add(1, Box::new(HostBranch { feedback: true })).unwrap();
    ctl.add(2, Box::new(engine_core::basics::Delay::new(64)))
        .unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect(port(2, 0), port(1, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    for frame in [23, 109, 1023] {
        ctl.send_at(
            frame,
            1,
            EventKind::Param {
                index: 0,
                value: 1.0,
            },
        )
        .unwrap();
    }
    audio.render_io(&[&input], &mut l, &mut r);
    for i in 0..4096 {
        let expected = if i < 64 { 0.0 } else { input[i - 64] };
        assert_eq!(l[i].to_bits(), expected.to_bits(), "frame {i}");
    }
}
