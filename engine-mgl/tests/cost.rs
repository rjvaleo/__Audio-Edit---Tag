//! What the real modules cost: a measurement, not a pass or fail. Run it in
//! a release build, with nothing else on the machine:
//!
//!     cargo test --release -p engine-mgl --test cost -- --ignored --nocapture
//!
//! Every block is 128 samples at 48 kHz, so the slot is 2.667 ms.

mod common;
use common::*;
use engine_core::basics::{Player, SoundSource};
use engine_core::*;
use engine_mgl::grain::{self, Grain};
use engine_mgl::{Fx, Wave};
use prism_fx::{contract, par, CATALOG};
use std::sync::Arc;
use std::time::Instant;
use wave::{builtin_frames, Patch, PatchState, Wavetable};

const BLOCK: usize = 128;
const SLOT_MS: f64 = 1000.0 * BLOCK as f64 / 48_000.0;

/// The time each of `blocks` renders took, in milliseconds, shortest first.
fn timed(audio: &mut AudioEngine, blocks: usize) -> Vec<f64> {
    let mut l = [0.0f32; BLOCK];
    let mut r = [0.0f32; BLOCK];
    let mut times = Vec::with_capacity(blocks);
    let thread_cpu = std::env::var_os("NATIVE_COST_THREAD_CPU").is_some();
    for _ in 0..blocks {
        if thread_cpu {
            let start = cpu_seconds();
            audio.render(&mut l, &mut r);
            times.push((cpu_seconds() - start) * 1000.0);
        } else {
            let start = Instant::now();
            audio.render(&mut l, &mut r);
            times.push(start.elapsed().as_secs_f64() * 1000.0);
        }
    }
    times.sort_by(|a, b| a.total_cmp(b));
    times
}

/// Optional diagnostic clock: excludes time the scheduler ran another thread.
/// Select identically on the before/after branches; wall time stays the default.
fn cpu_seconds() -> f64 {
    #[cfg(unix)]
    unsafe {
        let mut t = libc::timespec { tv_sec: 0, tv_nsec: 0 };
        assert_eq!(libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t), 0);
        t.tv_sec as f64 + t.tv_nsec as f64 * 1e-9
    }
    #[cfg(not(unix))]
    panic!("the optional thread CPU diagnostic needs a Unix clock");
}

fn at(times: &[f64], part: f64) -> f64 {
    times[((times.len() - 1) as f64 * part) as usize]
}

fn line(name: &str, times: &[f64]) -> String {
    let p99 = at(times, 0.99);
    format!(
        "{name:<28} median {:.4} ms   99th {:.4} ms ({:.1}% of the slot)   longest {:.4} ms",
        at(times, 0.5),
        p99,
        100.0 * p99 / SLOT_MS,
        times[times.len() - 1]
    )
}

fn input(ctl: &mut Controller) {
    let (l, r) = par::input();
    let sound = ctl
        .load_sound(1, SoundData { rate: contract::SAMPLE_RATE, l: l.into_boxed_slice(), r: r.into_boxed_slice() })
        .unwrap();
    ctl.add(1, Box::new(SoundSource::new())).unwrap();
    ctl.send(1, EventKind::Sound { slot: 0, sound }).unwrap();
    ctl.add(2, Box::new(Player::new(1.0))).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
}

fn effect(id: &str) -> Fx {
    let mut fx = Fx::new(id, contract::SAMPLE_RATE).unwrap();
    if fx.descriptor().sound.is_some() {
        let (samples, channels, rate) = contract::test_sound();
        fx = fx.sound(&samples, channels, rate);
    }
    fx
}

fn synth() -> Wave {
    let mut wave = Wave::new(RATE).patch(PatchState::new(&Patch::default())).seed(1);
    for (osc, name) in ["Formant Sweep", "Vowel Ah–Oo", "Glass Organ"].into_iter().enumerate() {
        wave = wave.table(osc, Arc::new(Wavetable::from_frames(&builtin_frames(name).unwrap())));
    }
    wave
}

#[test]
#[ignore = "a measurement: run it alone, in a release build"]
fn what_each_effect_costs() {
    let mut rows = Vec::new();
    for e in CATALOG {
        let (mut ctl, mut audio) = engine(RATE, exact());
        input(&mut ctl);
        ctl.add(3, Box::new(effect(e.descriptor.id))).unwrap();
        ctl.connect(port(2, 0), port(3, 0)).unwrap();
        ctl.connect_out(port(3, 0)).unwrap();
        ctl.commit().unwrap();
        timed(&mut audio, 200);
        rows.push((e.descriptor.id, timed(&mut audio, 3_000)));
    }
    rows.sort_by(|a, b| at(&b.1, 0.99).total_cmp(&at(&a.1, 0.99)));
    println!("\nEach effect alone, fed a sound, 8 seconds each; costliest first:");
    for (id, times) in rows.iter().take(12) {
        println!("{}", line(id, times));
    }
    let all: f64 = rows.iter().map(|(_, times)| at(times, 0.99)).sum();
    println!("... {} effects; the cheapest: {}", rows.len(), line(rows[rows.len() - 1].0, &rows[rows.len() - 1].1));
    println!("All {} at once would take about {:.3} ms a block ({:.0}% of the slot)", rows.len(), all, 100.0 * all / SLOT_MS);
}

#[test]
#[ignore = "a measurement: run it alone, in a release build"]
fn what_the_wave_synth_costs() {
    for held in [1usize, 8, 16, 32] {
        let (mut ctl, mut audio) = engine(RATE, exact());
        ctl.add(1, Box::new(synth())).unwrap();
        ctl.connect_out(port(1, 0)).unwrap();
        ctl.commit().unwrap();
        for i in 0..held {
            ctl.send(1, EventKind::Note(NoteEvent::on(36 + (i as u8 * 5) % 48, 0.8))).unwrap();
        }
        timed(&mut audio, 200);
        let times = timed(&mut audio, 3_000);
        println!("{}", line(&format!("Wave, {held} notes held"), &times));
    }
}

/// Something like a real patch: the synth with 16 notes held through a
/// chorus, a delay and the largest reverb, beside a sound through an EQ, a
/// compressor and a plate, all into a maximiser.
#[test]
#[ignore = "a measurement: run it alone, in a release build"]
fn what_a_full_patch_costs() {
    let (mut ctl, mut audio) = engine(RATE, exact());
    input(&mut ctl);
    ctl.add(10, Box::new(synth())).unwrap();
    let chain = |ctl: &mut Controller, from: ModuleId, first: ModuleId, ids: &[&str]| {
        let mut last = from;
        for (i, id) in ids.iter().enumerate() {
            let module = first + i as ModuleId;
            ctl.add(module, Box::new(effect(id))).unwrap();
            ctl.connect(port(last, 0), port(module, 0)).unwrap();
            last = module;
        }
        last
    };
    let synth_end = chain(&mut ctl, 10, 20, &["hp-chorus", "multi-delay", "sm-great-annihilator"]);
    let sound_end = chain(&mut ctl, 2, 30, &["eq", "compressor", "dattorro-plate"]);
    ctl.add(40, Box::new(effect("maximizer"))).unwrap();
    ctl.connect(port(synth_end, 0), port(40, 0)).unwrap();
    ctl.connect(port(sound_end, 0), port(40, 0)).unwrap();
    ctl.connect_out(port(40, 0)).unwrap();
    ctl.commit().unwrap();
    for i in 0..16u8 {
        ctl.send(10, EventKind::Note(NoteEvent::on(36 + (i * 5) % 48, 0.8))).unwrap();
    }
    timed(&mut audio, 200);
    let times = timed(&mut audio, 6_000);
    println!("{}", line("Synth + 7 effects + a sound", &times));
}

/// MGL's grain deck: each engine playing its sound straight, then Poly with
/// eight keys held.
#[test]
#[ignore = "a measurement: run it alone, in a release build"]
fn what_the_grain_deck_costs() {
    use mgl_engine::Source;
    use mgl_fx::grain::{Grain as Settings, StreamParams};
    use mgl_fx::stretch::Algorithm;
    let frames = 96_000;
    let mut seed = 7u32;
    let samples: Vec<f32> = (0..frames)
        .flat_map(|i| {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let noise = ((seed >> 16) as f32 / 32768.0) - 1.0;
            let s = (i as f32 * 0.02).sin() * 0.4 + noise * 0.05;
            [s, s * 0.8]
        })
        .collect();
    let source = Arc::new(Source { samples, channels: 2 });
    let params = |algorithm| StreamParams {
        in_frames: frames,
        sample_rate: 48_000,
        ratio: 2.0,
        semitones: 0.0,
        window_ms: 40.0,
        grain: Settings::default(),
        algorithm,
        wsola: Default::default(),
        vocoder: Default::default(),
        pvsola: Default::default(),
        hybrid: Default::default(),
        soundhack: Default::default(),
        cloud: false,
        cloud_mix: 0.5,
    };
    for algorithm in [Algorithm::Granular, Algorithm::Wsola, Algorithm::Vocoder, Algorithm::Pvsola] {
        for keys in [0u8, 8] {
            let mut deck = Grain::new(48_000, BLOCK, params(algorithm), Arc::clone(&source));
            if keys > 0 {
                deck = deck.poly(keys as usize);
            }
            let (mut ctl, mut audio) = engine(RATE, exact());
            ctl.add(1, Box::new(deck)).unwrap();
            ctl.connect_out(port(1, 0)).unwrap();
            ctl.commit().unwrap();
            if keys == 0 {
                ctl.send(1, EventKind::Param { index: grain::RUN, value: 1.0 }).unwrap();
                ctl.send(1, EventKind::Param { index: grain::PLAY, value: 1.0 }).unwrap();
            } else {
                ctl.send(1, EventKind::Param { index: grain::RUN, value: 0.0 }).unwrap();
                ctl.send(1, EventKind::Param { index: grain::KEY_MODE, value: 2.0 }).unwrap();
                for i in 0..keys {
                    ctl.send(1, EventKind::Note(NoteEvent::on(48 + i * 3, 0.8))).unwrap();
                }
            }
            // 2.9 seconds in all: the sound, stretched to twice its two
            // seconds, is still playing at the end.
            timed(&mut audio, 100);
            let times = timed(&mut audio, 1_000);
            let what = if keys == 0 { "playing".to_string() } else { format!("Poly, {keys} keys") };
            println!("{}", line(&format!("Grain {algorithm:?}, {what}"), &times));
        }
    }
}

// ---- For a profiler: one thing, played for a set time (PROFILE_SECONDS,
// 12 if not set). `tools/profile-on-mbp.sh <name>` runs one of these on the
// MacBook under macOS's `sample` and prints where the time went.

fn profile_seconds() -> f64 {
    std::env::var("PROFILE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(12.0)
}

fn keep_rendering(audio: &mut AudioEngine) {
    let mut l = [0.0f32; BLOCK];
    let mut r = [0.0f32; BLOCK];
    let until = Instant::now() + std::time::Duration::from_secs_f64(profile_seconds());
    let mut blocks = 0u64;
    while Instant::now() < until {
        for _ in 0..64 {
            audio.render(&mut l, &mut r);
        }
        blocks += 64;
    }
    println!("{blocks} blocks of {BLOCK} in {} s: {:.1} times real time", profile_seconds(), blocks as f64 * BLOCK as f64 / 48_000.0 / profile_seconds());
}

#[test]
#[ignore = "for a profiler"]
fn profile_wave_32() {
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(synth())).unwrap();
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit().unwrap();
    for i in 0..32 {
        ctl.send(1, EventKind::Note(NoteEvent::on(36 + (i as u8 * 5) % 48, 0.8))).unwrap();
    }
    keep_rendering(&mut audio);
}

fn profile_deck(engine_number: u32, keys: u8) {
    let mut deck = engine_mgl::demo::grain(48_000, engine_number, BLOCK, keys as usize);
    // Round and round the whole sound, so it never runs out.
    let _ = &mut deck;
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(deck)).unwrap();
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit().unwrap();
    if keys == 0 {
        ctl.give(1, 0, Box::new(engine_mgl::GrainThing::Loop { on: true, a: 0, b: 190_000 })).unwrap();
        ctl.send(1, EventKind::Param { index: grain::RUN, value: 1.0 }).unwrap();
        ctl.send(1, EventKind::Param { index: grain::PLAY, value: 1.0 }).unwrap();
    } else {
        ctl.send(1, EventKind::Param { index: grain::RUN, value: 0.0 }).unwrap();
        ctl.send(1, EventKind::Param { index: grain::KEY_MODE, value: 2.0 }).unwrap();
        for i in 0..keys {
            ctl.send(1, EventKind::Note(NoteEvent::on(48 + i * 3, 0.8))).unwrap();
        }
    }
    keep_rendering(&mut audio);
}

#[test]
#[ignore = "for a profiler"]
fn profile_wsola_poly_8() {
    profile_deck(1, 8);
}

#[test]
#[ignore = "for a profiler"]
fn profile_vocoder() {
    profile_deck(2, 0);
}

#[test]
#[ignore = "for a profiler"]
fn profile_pvsola() {
    profile_deck(3, 0);
}

#[test]
#[ignore = "for a profiler"]
fn profile_pvsola_poly_8() {
    profile_deck(3, 8);
}

#[test]
#[ignore = "a measurement: run it alone, in a release build"]
fn stamped_message_bursts() {
    let config = Config { max_block: BLOCK, queue: 4096, fade_frames: 0, ..Config::default() };
    let (mut ctl, mut audio) = engine(RATE, config);
    ctl.add(1, Box::new(engine_core::basics::Sine::new(997.0, 0.25))).unwrap();
    ctl.add(2, Box::new(engine_core::basics::Gain::new(1.0))).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    let (mut l, mut r) = ([0.0; BLOCK], [0.0; BLOCK]);
    for _ in 0..100 { audio.render(&mut l, &mut r); }
    ctl.collect();
    let (mut first, mut second) = (Vec::with_capacity(64), Vec::with_capacity(64));
    for _ in 0..64 {
        for times in [&mut first, &mut second] {
            let base = audio.frame();
            // Scrambled stamps, with 32 messages on each of the 128 frames.
            // Enqueuing is the control thread's work, outside the timed block.
            for n in 0..4096 {
                ctl.send_at(base + ((n * 73) % BLOCK) as u64, 2,
                    EventKind::Param { index: 0, value: if n % 2 == 0 { 0.25 } else { 0.75 } }).unwrap();
            }
            let start = Instant::now();
            audio.render(&mut l, &mut r);
            times.push(start.elapsed().as_secs_f64() * 1000.0);
            assert!(l.iter().chain(&r).all(|v| v.is_finite()));
            ctl.collect();
        }
    }
    first.sort_by(f64::total_cmp);
    second.sort_by(f64::total_cmp);
    println!("{}", line("4096 stamps: first block", &first));
    println!("{}", line("4096 stamps: next block", &second));
    println!("BURST_WORST_MS {:.6}", first[63].max(second[63]));
}

/// Sixteen four-effect branches, half fed the source and half unconnected.
/// Non-unity gains exercise the complete kernel rather than its identity exit.
#[test]
#[ignore = "a measurement: run it alone, in a release build"]
fn what_a_half_silent_patch_costs() {
    let (mut ctl, mut audio) = engine(RATE, exact());
    input(&mut ctl);
    for branch in 0..16u32 {
        let first = 100 + branch * 4;
        for i in 0..4u32 {
            let id = first + i;
            ctl.add(id, Box::new(Fx::new("gain", RATE).unwrap().set(0, -6.0))).unwrap();
            if i > 0 { ctl.connect(port(id - 1, 0), port(id, 0)).unwrap(); }
            else if branch % 2 == 0 { ctl.connect(port(2, 0), port(id, 0)).unwrap(); }
        }
        ctl.connect_out(port(first + 3, 0)).unwrap();
    }
    ctl.commit().unwrap();
    timed(&mut audio, 200);
    let times = timed(&mut audio, 6000);
    println!("{}", line("64 effects, half silent", &times));
}

/// Both clocks are sampled around the same callback. CPU is the calling
/// audio thread's time, not the workers' summed CPU consumption.
#[test]
#[ignore = "a measurement: run it alone, in a release build"]
fn parallel_branches_and_join_overhead() {
    use engine_core::basics::{Gain, Sine};
    struct Forced(Gain);
    impl Module for Forced {
        fn parallel_weight(&self)->usize{1024}
        fn inputs(&self)->Vec<Kind>{self.0.inputs()}
        fn outputs(&self)->Vec<Kind>{self.0.outputs()}
        fn process(&mut self,io:&mut Io){self.0.process(io);}
    }
    for block in [64,128,512] {
        for patch in ["wave16","light","forced-light"] {
            for parallel in [false,true] {
                let (mut ctl,mut audio)=engine(RATE,Config{parallel,max_block:512,fade_frames:0,..Config::default()});
                if patch!="wave16"{ctl.add(1,Box::new(Sine::new(220.0,0.1))).unwrap();}
                for id in 10..18 {
                    let module:Box<dyn Module>=match patch {
                        "wave16"=>Box::new(synth()),
                        "forced-light"=>Box::new(Forced(Gain::new(0.5))),
                        _=>Box::new(Gain::new(0.5)),
                    };
                    ctl.add(id,module).unwrap();
                    if patch!="wave16"{ctl.connect(port(1,0),port(id,0)).unwrap();}
                    ctl.connect_out(port(id,0)).unwrap();
                }
                ctl.commit().unwrap();
                if patch=="wave16" {
                    for id in 10..18 {for note in 0..16{ctl.send(id,EventKind::Note(NoteEvent::on(36+note*3,0.5))).unwrap();}}
                }
                let mut l=vec![0.0;block];let mut r=l.clone();
                for _ in 0..100{audio.render(&mut l,&mut r);}
                let mut wall=Vec::with_capacity(1000);let mut cpu=Vec::with_capacity(1000);
                for _ in 0..1000 {
                    let start_cpu=cpu_seconds();let start=Instant::now();
                    audio.render(&mut l,&mut r);
                    let elapsed=start.elapsed().as_secs_f64()*1000.0;
                    cpu.push((cpu_seconds()-start_cpu)*1000.0);wall.push(elapsed);
                }
                wall.sort_by(f64::total_cmp);cpu.sort_by(f64::total_cmp);
                println!("POOL_ROW patch={patch} block={block} parallel={parallel} wall_median={:.6} wall_p99={:.6} wall_worst={:.6} cpu_median={:.6} cpu_p99={:.6} cpu_worst={:.6} worker_jobs={}",at(&wall,0.5),at(&wall,0.99),wall[999],at(&cpu,0.5),at(&cpu,0.99),cpu[999],audio.worker_jobs());
                if parallel && patch!="light"{assert!(audio.worker_jobs()>0);}else{assert_eq!(audio.worker_jobs(),0);}
            }
        }
    }
}

#[test]
#[ignore = "a measurement: run it alone, in a release build"]
fn parallel_break_even_sweep() {
    struct Work(usize,f32);
    impl Module for Work {
        fn parallel_weight(&self)->usize{1024}
        fn inputs(&self)->Vec<Kind>{vec![]}
        fn outputs(&self)->Vec<Kind>{vec![Kind::Audio]}
        fn process(&mut self,io:&mut Io){
            let (l,r)=io.outs.audio(0);
            for i in 0..io.n {
                let mut value=self.1;
                for _ in 0..self.0{value=value*0.99991+0.00001;}
                l[i]=std::hint::black_box(value);r[i]=value;self.1+=0.0000001;
            }
        }
    }
    for work in [0,2,8,32,48,64,128,512] {
        for parallel in [false,true] {
            let (mut ctl,mut audio)=engine(RATE,Config{parallel,max_block:64,fade_frames:0,..Config::default()});
            for id in 1..=8{ctl.add(id,Box::new(Work(work,0.25))).unwrap();ctl.connect_out(port(id,0)).unwrap();}
            ctl.commit().unwrap();let mut l=[0.0;64];let mut r=l;
            for _ in 0..100{audio.render(&mut l,&mut r);}
            let mut wall=Vec::with_capacity(1000);let mut cpu=Vec::with_capacity(1000);
            for _ in 0..1000{let cpu_start=cpu_seconds();let start=Instant::now();audio.render(&mut l,&mut r);wall.push(start.elapsed().as_secs_f64()*1000.0);cpu.push((cpu_seconds()-cpu_start)*1000.0);}
            wall.sort_by(f64::total_cmp);cpu.sort_by(f64::total_cmp);
            println!("BREAK_ROW work={work} parallel={parallel} wall_median={:.6} wall_p99={:.6} wall_worst={:.6} cpu_median={:.6} cpu_p99={:.6} cpu_worst={:.6}",at(&wall,0.5),at(&wall,0.99),wall[999],at(&cpu,0.5),at(&cpu,0.99),cpu[999]);
        }
    }
}

#[test]
#[ignore = "a measurement: run it alone, in a release build"]
fn parallel_effect_gate_probe() {
    use engine_core::basics::Sine;
    for entry in CATALOG {
        if !matches!(entry.descriptor.category,prism_fx::Category::Reverb|prism_fx::Category::Spectral){continue;}
        for block in [64,128,512] {
            for parallel in [false,true] {
                let (mut ctl,mut audio)=engine(RATE,Config{parallel,max_block:512,fade_frames:0,..Config::default()});
                ctl.add(1,Box::new(Sine::new(220.0,0.1))).unwrap();
                for id in 10..18{ctl.add(id,Box::new(effect(entry.descriptor.id))).unwrap();ctl.connect(port(1,0),port(id,0)).unwrap();ctl.connect_out(port(id,0)).unwrap();}
                ctl.commit().unwrap();let mut l=vec![0.0;block];let mut r=l.clone();
                for _ in 0..50{audio.render(&mut l,&mut r);}
                let mut times=Vec::with_capacity(200);
                for _ in 0..200{let start=Instant::now();audio.render(&mut l,&mut r);times.push(start.elapsed().as_secs_f64()*1000.0);}
                times.sort_by(f64::total_cmp);
                println!("EFFECT_ROW id={} block={block} parallel={parallel} median={:.6} worst={:.6} jobs={}",entry.descriptor.id,at(&times,0.5),times[199],audio.worker_jobs());
            }
        }
    }
}
