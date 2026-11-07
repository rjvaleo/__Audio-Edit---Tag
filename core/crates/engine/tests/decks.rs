//! Two decks on one output (RJ, 6 Nov 2026: "the hyperprism panel can have its
//! own sound loaded, and it runs independently of the grain engine"). The
//! grain deck and the Prism deck each have their own sound, transport, stretch
//! and chain; the callback plays both and adds them. See `decks.rs`.

use engine::{Core, Decks, Shared, Source};
use fx::grain::{Grain, StreamParams};
use std::sync::Arc;

const SR: u32 = 48_000;
const CH: usize = 2;
const BLOCK: usize = 512;

fn tone(hz: f32, frames: usize) -> Arc<Source> {
    let samples = (0..frames * CH)
        .map(|i| ((i / CH) as f32 * hz * std::f32::consts::TAU / SR as f32).sin() * 0.4)
        .collect();
    Arc::new(Source { samples, channels: CH })
}

fn params(in_frames: usize) -> StreamParams {
    StreamParams {
        in_frames,
        sample_rate: SR,
        ratio: 1.0,
        semitones: 0.0,
        window_ms: 40.0,
        grain: Grain::default(),
        algorithm: fx::stretch::Algorithm::Wsola,
        wsola: fx::stretch::WsolaParams::default(),
        vocoder: fx::stretch::VocoderParams::default(),
        pvsola: fx::pvsola::PvsolaParams::default(),
        hybrid: fx::hybrid::HybridParams::default(),
        cloud: false,
        cloud_mix: 0.5,
    }
}

fn deck(src: &Arc<Source>) -> (Core, Arc<Shared>) {
    let p = params(src.samples.len() / CH);
    (Core::new(BLOCK, CH, p, Arc::clone(src)), Arc::new(Shared::new(p, Arc::clone(src))))
}

/// One deck alone, as it played before there were two.
fn alone(src: &Arc<Source>, play: bool, ratio: f32, blocks: usize) -> Vec<f32> {
    let (mut core, shared) = deck(src);
    if ratio != 1.0 {
        let mut p = shared.params().unwrap();
        p.ratio = ratio;
        shared.set_params(p);
    }
    if play {
        shared.play();
    }
    let mut buf = vec![0f32; BLOCK * CH];
    let mut all = Vec::new();
    for _ in 0..blocks {
        core.fill(&mut buf, CH, &shared);
        all.extend_from_slice(&buf);
    }
    all
}

/// Both, through the mixer.
fn both(main: &Arc<Source>, prism: &Arc<Source>, prism_plays: bool, prism_ratio: f32, blocks: usize) -> (Vec<f32>, Arc<Shared>, Arc<Shared>) {
    let (mc, ms) = deck(main);
    let (pc, ps) = deck(prism);
    if prism_ratio != 1.0 {
        let mut p = ps.params().unwrap();
        p.ratio = prism_ratio;
        ps.set_params(p);
    }
    ms.play();
    if prism_plays {
        ps.play();
    }
    let mut decks = Decks::new(mc, pc, BLOCK, CH);
    let mut buf = vec![0f32; BLOCK * CH];
    let mut all = Vec::new();
    for _ in 0..blocks {
        decks.fill(&mut buf, CH, &ms, &ps);
        all.extend_from_slice(&buf);
    }
    (all, ms, ps)
}

fn max_diff(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| (x - y).abs()).fold(0.0, f32::max)
}

#[test]
fn a_stopped_prism_deck_leaves_the_grain_deck_exactly_as_it_was() {
    let a = tone(220.0, SR as usize * 2);
    let b = tone(660.0, SR as usize * 2);
    let (out, ..) = both(&a, &b, false, 1.0, 40);
    assert_eq!(max_diff(&out, &alone(&a, true, 1.0, 40)), 0.0);
}

#[test]
fn both_decks_are_heard_together_each_playing_its_own_sound() {
    let a = tone(220.0, SR as usize * 2);
    let b = tone(660.0, SR as usize * 2);
    let (out, ms, ps) = both(&a, &b, true, 1.0, 40);
    let sum: Vec<f32> = alone(&a, true, 1.0, 40).iter().zip(alone(&b, true, 1.0, 40)).map(|(x, y)| x + y).collect();
    assert!(max_diff(&out, &sum) < 1e-6, "the output is not the two decks added");
    assert!(ps.source().unwrap().samples[CH * 10] != ms.source().unwrap().samples[CH * 10]);
    assert_eq!(ms.position(), ps.position(), "both ran the same blocks");
}

#[test]
fn moving_the_prism_deck_never_touches_the_grain_deck() {
    let a = tone(220.0, SR as usize * 2);
    let b = tone(660.0, SR as usize * 2);
    let (out, ms, _) = both(&a, &b, true, 2.5, 40);
    let prism_only = alone(&b, true, 2.5, 40);
    let main_part: Vec<f32> = out.iter().zip(&prism_only).map(|(x, y)| x - y).collect();
    assert!(max_diff(&main_part, &alone(&a, true, 1.0, 40)) < 1e-6, "the grain deck changed");
    assert_eq!(ms.params().unwrap().ratio, 1.0);
}

#[test]
fn each_deck_has_its_own_transport() {
    let a = tone(220.0, SR as usize);
    let b = tone(660.0, SR as usize);
    let (_, ms, ps) = both(&a, &b, true, 1.0, 4);
    ps.pause();
    ps.request_seek(100);
    assert!(ms.is_playing(), "pausing Prism stopped the grain deck");
    assert!(ms.position() > 0);
}
