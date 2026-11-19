//! Identical fixture on 031, 033 and the component scheduler.
mod common;
use common::*;
use engine_core::basics::{Delay, Gain, Sine};
use engine_core::*;
use engine_mgl::Wave;
use std::sync::Arc;
use std::time::Instant;
use wave::{builtin_frames, Patch, PatchState, Wavetable};
fn synth() -> Wave {
    let mut wave = Wave::new(RATE)
        .patch(PatchState::new(&Patch::default()))
        .seed(1);
    for (osc, name) in ["Formant Sweep", "Vowel Ah–Oo", "Glass Organ"]
        .into_iter()
        .enumerate()
    {
        wave = wave.table(
            osc,
            Arc::new(Wavetable::from_frames(&builtin_frames(name).unwrap())),
        );
    }
    wave
}
struct ControlDelay {
    inner: Delay,
    gain: f32,
}
impl Module for ControlDelay {
    fn inputs(&self) -> Vec<Kind> {
        self.inner.inputs()
    }
    fn outputs(&self) -> Vec<Kind> {
        self.inner.outputs()
    }
    fn feedback_delay(&self) -> usize {
        self.inner.feedback_delay()
    }
    fn handle(&mut self, event: &EventKind) {
        if let EventKind::Param { value, .. } = event {
            self.gain = *value;
        }
    }
    fn process(&mut self, io: &mut Io) {
        self.inner.process(io);
        let (l, r) = io.outs.audio(0);
        for v in l.iter_mut().chain(r) {
            *v *= self.gain;
        }
    }
    fn emit(&mut self, io: &mut Io) {
        self.inner.emit(io);
        let (l, r) = io.outs.audio(0);
        for v in l.iter_mut().chain(r) {
            *v *= self.gain;
        }
    }
    fn absorb(&mut self, io: &mut Io) {
        self.inner.absorb(io);
    }
}
fn loop_patch(ctl: &mut Controller, id: u32, delay: usize, controlled: bool) {
    ctl.add(id, Box::new(Sine::new(220.0 + id as f32, 0.03)))
        .unwrap();
    ctl.add(
        id + 1,
        if controlled {
            Box::new(ControlDelay {
                inner: Delay::new(delay),
                gain: 1.0,
            }) as Box<dyn Module>
        } else {
            Box::new(Delay::new(delay))
        },
    )
    .unwrap();
    ctl.add(id + 2, Box::new(Gain::new(0.5))).unwrap();
    ctl.connect(port(id, 0), port(id + 1, 0)).unwrap();
    ctl.connect(port(id + 1, 0), port(id + 2, 0)).unwrap();
    ctl.connect(port(id + 2, 0), port(id + 1, 0)).unwrap();
    ctl.connect_out(port(id + 1, 0)).unwrap();
}
fn patch(case: usize, parallel: bool) -> (Controller, AudioEngine) {
    let (mut ctl, audio) = engine(
        RATE,
        Config {
            parallel,
            max_block: 512,
            fade_frames: 0,
            ..Config::default()
        },
    );
    loop_patch(&mut ctl, 1, 64, case == 4);
    if case == 1 {
        loop_patch(&mut ctl, 100, 96, false);
    }
    if case == 3 {
        for id in 10..14 {
            ctl.add(id, Box::new(synth())).unwrap();
            ctl.connect_out(port(id, 0)).unwrap();
        }
    }
    ctl.commit().unwrap();
    if case == 2 || case == 4 {
        for (frame, gain) in [(31, 0.2), (127, 0.7), (255, 0.3), (513, 0.4), (777, 0.65)] {
            ctl.send_at(
                frame,
                if case == 4 { 2 } else { 3 },
                EventKind::Param {
                    index: 0,
                    value: gain,
                },
            )
            .unwrap();
        }
    }
    if case == 3 {
        for id in 10..14 {
            for note in 0..16 {
                ctl.send(id, EventKind::Note(NoteEvent::on(36 + note * 3, 0.5)))
                    .unwrap();
            }
        }
    }
    (ctl, audio)
}
fn cpu() -> f64 {
    #[cfg(unix)]
    unsafe {
        let mut t = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        assert_eq!(
            libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t),
            0
        );
        t.tv_sec as f64 + t.tv_nsec as f64 * 1e-9
    }
    #[cfg(not(unix))]
    panic!("the optional thread CPU diagnostic needs a Unix clock");
}
fn at(times: &[f64], q: f64) -> f64 {
    times[((times.len() - 1) as f64 * q) as usize]
}
#[test]
#[ignore = "measurement: run alone"]
fn feedback_cost() {
    for block in [64, 128, 512] {
        for parallel in [false, true] {
            let (mut ctl, mut audio) = patch(3, parallel);
            let (mut l, mut r) = (vec![0.0; block], vec![0.0; block]);
            let (mut wall, mut used) = (Vec::with_capacity(300), Vec::with_capacity(300));
            for index in 0..350 {
                let c = cpu();
                let start = Instant::now();
                audio.render(&mut l, &mut r);
                let elapsed = start.elapsed().as_secs_f64() * 1000.0;
                let spent = (cpu() - c) * 1000.0;
                if index >= 50 {
                    wall.push(elapsed);
                    used.push(spent);
                }
                ctl.collect();
            }
            wall.sort_by(f64::total_cmp);
            used.sort_by(f64::total_cmp);
            println!("FEEDBACK_ROW block={block} parallel={parallel} wall_median={:.6} wall_p99={:.6} wall_worst={:.6} cpu_median={:.6} cpu_p99={:.6} cpu_worst={:.6} worker_jobs={}",at(&wall,0.5),at(&wall,0.99),wall[299],at(&used,0.5),at(&used,0.99),used[299],audio.worker_jobs());
        }
    }
}
fn bits_at(parallel: bool, block: usize) -> Vec<u32> {
    let mut result = Vec::new();
    for case in 0..5 {
        let (_ctl, mut audio) = patch(case, parallel);
        let (l, r) = render(&mut audio, 2048, block);
        result.extend(l.iter().chain(&r).map(|v| v.to_bits()));
    }
    result
}
#[test]
#[ignore = "writes the independent 031 reference outside audio"]
fn write_feedback_reference() {
    let bytes: Vec<u8> = bits_at(false, 512)
        .into_iter()
        .flat_map(u32::to_le_bytes)
        .collect();
    std::fs::write(std::env::var("FEEDBACK_REFERENCE").unwrap(), bytes).unwrap();
}
#[test]
fn feedback_matches_031() {
    // The bits 031 recorded are Apple silicon's; another processor's maths
    // differs in the last places (AUDIO-PLAN §9 Q6). There the claim is the
    // scheduling one: every block size, serial or on the pool, gives the bits
    // a 512-frame serial render gives on that machine.
    let reference: Vec<u32> = if cfg!(target_arch = "aarch64") {
        include_bytes!("data/feedback-031.bin")
            .chunks_exact(4)
            .map(|v| u32::from_le_bytes(v.try_into().unwrap()))
            .collect()
    } else {
        bits_at(false, 512)
    };
    for parallel in [false, true] {
        for block in [1, 7, 64, 128, 512] {
            let actual = bits_at(parallel, block);
            assert_eq!(actual.len(), reference.len());
            for (sample, (a, b)) in actual.iter().zip(&reference).enumerate() {
                assert_eq!(
                    a,
                    b,
                    "parallel {parallel}, block {block}, case {}, side {}, sample {}",
                    sample / 4096,
                    (sample % 4096) / 2048,
                    sample % 2048
                );
            }
        }
    }
}
