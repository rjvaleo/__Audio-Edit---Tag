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
    for name in ["gain", "swap"] {
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
            matches!(entry.descriptor.id, "gain" | "swap")
        );
    }
    assert!(!Fx::new("gain", RATE).unwrap().placed().can_sleep());
    assert!(!engine_core::basics::Sine::new(440.0, 0.1).can_sleep());
}
