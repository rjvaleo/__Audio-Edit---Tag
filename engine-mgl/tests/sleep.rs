//! Audited memoryless effects must wake exactly as an always-running kernel.
mod common;
use common::*;
use engine_core::*;
use engine_mgl::Fx;

struct Source(u8);
impl Module for Source {
    fn inputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn handle(&mut self, event: &EventKind) {
        if let EventKind::Param { value, .. } = *event {
            self.0 = value as u8;
        }
    }
    fn process(&mut self, io: &mut Io) {
        let (l, r) = io.outs.audio(0);
        match self.0 {
            0 => {
                l.fill(0.0);
                r.fill(0.0);
            }
            2 => {
                l.fill(-0.0);
                r.fill(-0.0);
            }
            _ => {
                l.fill(0.25);
                r.fill(-0.125);
            }
        }
    }
}
struct Awake(Fx);
impl Module for Awake {
    fn inputs(&self) -> Vec<Kind> {
        self.0.inputs()
    }
    fn outputs(&self) -> Vec<Kind> {
        self.0.outputs()
    }
    fn prepare(&mut self, rate: f32, block: usize) {
        self.0.prepare(rate, block);
    }
    fn handle(&mut self, event: &EventKind) {
        self.0.handle(event);
    }
    fn process(&mut self, io: &mut Io) {
        self.0.process(io);
    }
}

#[test]
fn audited_effects_sleep_and_wake_with_identical_bits_and_variable_blocks() {
    assert_the_check_is_on();
    for name in ["gain", "swap", "width", "hp-ms-matrix"] {
        let make = |awake| {
            let (mut ctl, audio) = engine(
                RATE,
                Config {
                    max_block: 128,
                    ..exact()
                },
            );
            ctl.add(1, Box::new(Source(1))).unwrap();
            let fx = Fx::new(name, RATE).unwrap().set(0, -6.0);
            assert!(fx.can_sleep());
            ctl.add(
                2,
                if awake {
                    Box::new(Awake(fx)) as Box<dyn Module>
                } else {
                    Box::new(fx)
                },
            )
            .unwrap();
            ctl.connect(port(1, 0), port(2, 0)).unwrap();
            ctl.connect_out(port(2, 0)).unwrap();
            ctl.commit().unwrap();
            (ctl, audio)
        };
        let (mut ctl, mut audio) = make(false);
        let (mut reference_ctl, mut reference) = make(true);
        let (mut l, mut r, mut a, mut b) = ([0.0; 128], [0.0; 128], [0.0; 128], [0.0; 128]);
        for block in 0..1200 {
            for (at, id, value) in [
                (1, 1, 0.0),
                (1000, 2, -12.0),
                (1100, 1, 2.0),
                (1150, 1, 1.0),
            ] {
                if block == at {
                    let event = EventKind::Param { index: 0, value };
                    ctl.send(id, event).unwrap();
                    reference_ctl.send(id, event).unwrap();
                }
            }
            let n = [64, 1, 128, 3][block % 4];
            let before = counted();
            audio.render(&mut l[..n], &mut r[..n]);
            reference.render(&mut a[..n], &mut b[..n]);
            assert_eq!(counted(), before);
            assert!(
                l[..n]
                    .iter()
                    .zip(&a[..n])
                    .chain(r[..n].iter().zip(&b[..n]))
                    .all(|(x, y)| x.to_bits() == y.to_bits()),
                "{name} block {block}"
            );
        }
    }
}

#[test]
fn effect_metadata_is_the_kernels_and_unreviewed_effects_stay_awake() {
    for entry in prism_fx::CATALOG {
        let kernel = (entry.make)(RATE);
        let fx = Fx::new(entry.descriptor.id, RATE).unwrap();
        assert_eq!(fx.latency(), kernel.latency_frames() as usize);
        let t = kernel.tail_seconds();
        let expected = if t.is_finite() && t >= 0.0 {
            (t as f64 * RATE as f64).ceil().min(usize::MAX as f64) as usize
        } else {
            usize::MAX
        };
        assert_eq!(fx.tail(), expected);
        assert_eq!(
            fx.can_sleep(),
            matches!(entry.descriptor.id, "gain" | "swap" | "width" | "hp-ms-matrix")
        );
    }
    assert!(!Fx::new("gain", RATE).unwrap().placed().can_sleep());
    assert!(!engine_core::basics::Sine::new(440.0, 0.1).can_sleep());
}

/// Absolute-frame noise bursts leave alternating short and long quiet gaps.
struct Bursts;
impl Module for Bursts {
    fn inputs(&self) -> Vec<Kind> { vec![] }
    fn outputs(&self) -> Vec<Kind> { vec![Kind::Audio] }
    fn process(&mut self, io: &mut Io) {
        let frame = io.frame;
        let (l, r) = io.outs.audio(0);
        for (i, (l, r)) in l.iter_mut().zip(r).enumerate() {
            let at = frame + i as u64;
            let cycle = at / 48000;
            let schedule = (cycle as u32).wrapping_mul(1664525).wrapping_add(0x037abc91);
            let burst = if cycle % 7 == 0 { 48000 } else { 128 + schedule as u64 % 10000 };
            if at % 48000 < burst {
                let x = (at as u32).wrapping_mul(747796405).wrapping_add(2891336453);
                *l = ((x >> 8) as f32 / 16777216.0 - 0.5) * 0.8;
                *r = (((x.rotate_left(13)) >> 8) as f32 / 16777216.0 - 0.5) * 0.6;
            } else { *l = 0.0; *r = 0.0; }
        }
    }
}
struct Observed {
    fx: Fx,
    sleep: bool,
    calls: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}
impl Module for Observed {
    fn inputs(&self) -> Vec<Kind> { self.fx.inputs() }
    fn outputs(&self) -> Vec<Kind> { self.fx.outputs() }
    fn tail(&self) -> usize { self.fx.tail() }
    fn can_sleep(&self) -> bool { self.sleep && self.fx.can_sleep() }
    fn prepare(&mut self, rate: f32, block: usize) { self.fx.prepare(rate, block); }
    fn handle(&mut self, event: &EventKind) { self.fx.handle(event); }
    fn process(&mut self, io: &mut Io) {
        self.calls.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        self.fx.process(io);
    }
}

#[test]
fn seeded_twenty_two_seconds_per_audited_effect_match_with_asleep_controls() {
    use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
    assert_the_check_is_on();
    for id in ["gain", "swap", "width", "hp-ms-matrix"] {
        for parallel in [false, true] {
            let make = |sleep| {
                let (mut ctl, audio) = engine(RATE, Config { max_block: 512, parallel, ..exact() });
                ctl.add(1, Box::new(Bursts)).unwrap();
                let fx = Fx::new(id, RATE).unwrap();
                assert!(fx.can_sleep(), "{id}");
                let calls = Arc::new(AtomicUsize::new(0));
                ctl.add(2, Box::new(Observed { fx, sleep, calls: calls.clone() })).unwrap();
                ctl.connect(port(1,0), port(2,0)).unwrap();
                ctl.connect_out(port(2,0)).unwrap();
                ctl.commit().unwrap();
                (ctl, audio, calls)
            };
            let (mut ctl, mut audio, calls) = make(true);
            let (mut ctl_ref, mut reference, calls_ref) = make(false);
            let specs = Fx::new(id, RATE).unwrap().descriptor().params;
            let mut seed = 0x037abc91u32;
            let mut at = 0usize;
            let mut next_event = 8000;
            let (mut l, mut r, mut a, mut b) = ([0.0;512],[0.0;512],[0.0;512],[0.0;512]);
            while at < 22 * RATE as usize {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                if at >= next_event && !specs.is_empty() {
                    let index = (seed >> 16) as usize % specs.len();
                    let spec = &specs[index];
                    let value = spec.min + (spec.max-spec.min) * (seed & 65535) as f32 / 65535.0;
                    let event = EventKind::Param { index: index as u32, value };
                    ctl.send(2,event).unwrap(); ctl_ref.send(2,event).unwrap();
                    next_event += 8000;
                }
                let n = (1 + (seed >> 16) as usize % 512).min(22 * RATE as usize-at);
                let before = counted();
                audio.render(&mut l[..n], &mut r[..n]);
                reference.render(&mut a[..n], &mut b[..n]);
                assert_eq!(counted(),before);
                for i in 0..n {
                    assert_eq!(l[i].to_bits(),a[i].to_bits(),"{id} pool={parallel} L {}",at+i);
                    assert_eq!(r[i].to_bits(),b[i].to_bits(),"{id} pool={parallel} R {}",at+i);
                }
                at += n;
            }
            assert!(calls.load(Ordering::Relaxed) < calls_ref.load(Ordering::Relaxed)/2, "{id}: must actually sleep");
        }
    }
}
