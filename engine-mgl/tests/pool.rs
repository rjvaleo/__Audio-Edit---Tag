use engine_core::basics::Sine;
use engine_core::*;
use engine_mgl::{Fx, Wave};
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};
static HEAP: AtomicUsize = AtomicUsize::new(0);
struct Counting;
fn count() {
    if rt::in_audio() {
        HEAP.fetch_add(1, Ordering::Relaxed);
    }
}
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        count();
        System.alloc(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        count();
        System.dealloc(p, l)
    }
}
#[global_allocator]
static ALLOCATOR: Counting = Counting;
fn run(parallel: bool, effect: Option<&str>, block: usize, host_mode: bool) -> (Vec<f32>, usize) {
    let (mut ctl, mut audio) = engine(
        48000.0,
        Config {
            parallel,
            max_block: 512,
            fade_frames: 0,
            ..Config::default()
        },
    );
    if effect.is_some() {
        ctl.add(1, Box::new(Sine::new(220.0, 0.1))).unwrap();
    }
    for id in 10..18 {
        let module: Box<dyn Module> = if let Some(name) = effect {
            let mut fx = Fx::new(name, 48000.0).unwrap();
            if fx.descriptor().sound.is_some() {
                let (sound, channels, rate) = prism_fx::contract::test_sound();
                fx = fx.sound(&sound, channels, rate);
            }
            Box::new(fx)
        } else {
            Box::new(engine_mgl::demo::wave(48000.0))
        };
        ctl.add(id, module).unwrap();
        if effect.is_some() {
            ctl.connect(port(1, 0), port(id, 0)).unwrap();
        }
        ctl.connect_out(port(id, 0)).unwrap();
    }
    ctl.commit().unwrap();
    if effect.is_none() {
        for id in 10..18 {
            for note in 0..16 {
                ctl.send(id, EventKind::Note(NoteEvent::on(36 + note * 3, 0.5)))
                    .unwrap();
            }
        }
    }
    let mut result = Vec::with_capacity(32 * block * 2);
    let mut l = vec![0.0; block];
    let mut r = l.clone();
    let blocks = if effect.is_some() && block == 512 {
        8
    } else {
        32
    };
    for index in 0..blocks {
        if effect.is_none() && index == 16 {
            for id in 10..18 {
                ctl.send(
                    id,
                    EventKind::Param {
                        index: Wave::BEND,
                        value: 0.2,
                    },
                )
                .unwrap();
            }
        }
        let before = HEAP.load(Ordering::Relaxed);
        let _mode = host_mode.then(guard::NoDenormals::new);
        audio.render(&mut l, &mut r);
        assert_eq!(
            HEAP.load(Ordering::Relaxed),
            before,
            "heap work: parallel={parallel} effect={effect:?} block={index}"
        );
        assert!(l.iter().chain(&r).all(|v| v.is_finite()));
        for (l, r) in l.iter().zip(&r) {
            result.push(*l);
            result.push(*r);
        }
    }
    (result, audio.worker_jobs())
}
fn same(a: &[f32], b: &[f32], name: &str) {
    assert_eq!(a.len(), b.len());
    for (i, (a, b)) in a.iter().zip(b).enumerate() {
        assert_eq!(a.to_bits(), b.to_bits(), "{name}, sample {i}");
    }
}
#[test]
fn real_parallel_waves_and_every_catalogue_effect_match_and_allocate_nothing() {
    let reference = control_burst(false, 8);
    assert_eq!(reference, control_burst(false, 512));
    assert_eq!(reference, control_burst(true, 512));
    for host in [false, true] {
        for block in [64, 128, 512] {
            let (serial, _) = run(false, None, block, host);
            let (parallel, jobs) = run(true, None, block, host);
            same(&serial, &parallel, "Wave");
            assert!(jobs > 0);
        }
    }
    for entry in prism_fx::CATALOG {
        let name = entry.descriptor.id;
        let (serial, _) = run(false, Some(name), 512, false);
        let (parallel, jobs) = run(true, Some(name), 512, false);
        same(&serial, &parallel, name);
        if Fx::new(name, 48000.0).unwrap().parallel_weight() > 0 {
            assert!(jobs > 0, "{name} actually ran in parallel");
        } else {
            assert_eq!(jobs, 0, "cheap kernel {name} stayed serial");
        }
    }
}

fn control_burst(parallel:bool,block:usize)->Vec<u32>{
    use engine_core::basics::Gain;
    let(mut ctl,mut audio)=engine(48000.0,Config{parallel,max_block:512,fade_frames:0,..Config::default()});
    for id in 10..18 {
        ctl.add(id,Box::new(engine_mgl::demo::wave(48000.0))).unwrap();
        ctl.add(id+100,Box::new(Gain::new(0.5))).unwrap();
        ctl.connect(port(id,0),port(id+100,0)).unwrap();ctl.connect_out(port(id+100,0)).unwrap();
    }
    ctl.commit().unwrap();
    for id in 10..18 {for note in 0..16 {ctl.send(id,EventKind::Note(NoteEvent::on(36+note*3,0.5))).unwrap();}}
    for event in 0..256 {
        ctl.send_at(event*8,110+(event%8)as u32,EventKind::Param{index:0,value:if (event/8)%2==0{0.5}else{0.25}}).unwrap();
    }
    let(mut l,mut r)=(vec![0.0;block],vec![0.0;block]);let mut bits=Vec::with_capacity(4096);
    for _ in 0..2048/block {
        let heap=HEAP.load(Ordering::Relaxed);audio.render(&mut l,&mut r);
        assert_eq!(HEAP.load(Ordering::Relaxed),heap);
        bits.extend(l.iter().chain(&r).map(|v|v.to_bits()));
    }
    // Normalize the output interleave for comparisons between block sizes.
    let mut planar=Vec::with_capacity(bits.len());
    for side in 0..2 {for chunk in bits.chunks(block*2){planar.extend_from_slice(&chunk[side*block..(side+1)*block]);}}
    if parallel {assert!(audio.worker_jobs()>0);}
    planar
}
