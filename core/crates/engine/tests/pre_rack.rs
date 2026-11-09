//! The block as it reaches the rack, for the "before" on the Grain page's
//! effects screen: nothing when nobody has asked, and exact when somebody has.

use engine::{Core, Shared, Source};
use fx::grain::{Grain, StreamParams};
use fx::Gain;
use std::sync::Arc;

const SR: u32 = 48_000;
const BLOCK: usize = 512;

fn rig() -> (Core, Shared) {
    let samples: Vec<f32> = (0..96_000).map(|i| (i as f32 * 0.02).sin() * 0.2).collect();
    let src = Arc::new(Source { samples, channels: 1 });
    let sp = StreamParams {
        in_frames: 96_000,
        sample_rate: SR,
        ratio: 1.0,
        semitones: 0.0,
        window_ms: 40.0,
        grain: Grain::default(),
        algorithm: fx::stretch::Algorithm::Granular,
        wsola: fx::stretch::WsolaParams::default(),
        vocoder: fx::stretch::VocoderParams::default(),
        pvsola: fx::pvsola::PvsolaParams::default(),
        hybrid: fx::hybrid::HybridParams::default(),
        cloud: false,
        cloud_mix: 0.5,
    };
    let shared = Shared::new(sp, Arc::clone(&src));
    let core = Core::new(BLOCK, 1, sp, src);
    (core, shared)
}

fn six_db_rack() -> fx::Rack {
    let mut r = fx::Rack::new();
    r.push(Box::new(Gain { db: 6.0206 }));
    r
}

fn pump(core: &mut Core, shared: &Shared, blocks: usize) {
    let mut buf = vec![0.0f32; BLOCK];
    for _ in 0..blocks {
        core.fill(&mut buf, 1, shared);
    }
}

#[test]
fn nothing_is_written_while_nobody_asks() {
    let (mut core, shared) = rig();
    shared.set_rack(Some(six_db_rack()));
    shared.play();
    pump(&mut core, &shared, 40);
    assert!(shared.scope_snapshot().is_some(), "nothing played");
    assert!(shared.pre_rack_snapshot().is_none(), "the ring was written with nobody asking");
}

#[test]
fn asked_for_it_is_the_block_before_the_chain() {
    let (mut core, shared) = rig();
    shared.set_rack(Some(six_db_rack()));
    shared.play();
    // Past the rack's arrival and its crossfade, so what is compared is settled.
    pump(&mut core, &shared, 40);
    shared.want_pre_rack(SR);
    pump(&mut core, &shared, 30);
    let (pre, _, rate) = shared.pre_rack_snapshot().expect("asked for and nothing came");
    let (post, _, _) = shared.scope_snapshot().unwrap();
    assert_eq!(rate, SR);
    assert_eq!(pre.len(), 30 * BLOCK);
    let post = &post[post.len() - pre.len()..];
    let mut heard = 0.0f32;
    for (a, b) in pre.iter().zip(post) {
        assert!((a * 2.0 - b).abs() < 1e-3, "before {a} and after {b} are not one +6 dB apart");
        heard = heard.max(a.abs());
    }
    assert!(heard > 0.05, "the ring is silence");
}

#[test]
fn with_no_rack_before_and_after_are_the_same_sound() {
    let (mut core, shared) = rig();
    shared.play();
    shared.want_pre_rack(SR);
    pump(&mut core, &shared, 8);
    let (pre, _, _) = shared.pre_rack_snapshot().unwrap();
    let (post, _, _) = shared.scope_snapshot().unwrap();
    assert_eq!(pre, post[post.len() - pre.len()..]);
}

#[test]
fn it_stops_by_itself_when_the_asking_stops() {
    let (mut core, shared) = rig();
    shared.play();
    shared.want_pre_rack((BLOCK * 3) as u32);
    pump(&mut core, &shared, 20);
    let (pre, _, _) = shared.pre_rack_snapshot().unwrap();
    assert_eq!(pre.len(), BLOCK * 3, "it went on past what was asked for");
}
