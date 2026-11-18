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
    for _ in 0..blocks {
        let start = Instant::now();
        audio.render(&mut l, &mut r);
        times.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    times.sort_by(|a, b| a.total_cmp(b));
    times
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
            timed(&mut audio, 200);
            let times = timed(&mut audio, 3_000);
            let what = if keys == 0 { "playing".to_string() } else { format!("Poly, {keys} keys") };
            println!("{}", line(&format!("Grain {algorithm:?}, {what}"), &times));
        }
    }
}
