//! The read stays in the brackets under Scan (`brackets.rs`): a held note, and
//! the transport's own loop while the Grain page is in front, frame by frame
//! with no sound card.
//!
//! The brackets are set the way the page sets them, in output frames by the
//! Stretch alone (`engineFromSrc`), and the read is watched where it happens:
//! the grain events for the cloud, and for the engines that report none, a
//! tone whose loudness is where in the file it was read.

use engine::{Core, GrainKeys, Shared, Source};
use fx::grain::{Grain, StreamParams};
use fx::stretch::Algorithm;
use std::sync::Arc;

const SR: u32 = 48_000;
const BLOCK: usize = 512;
/// Long enough that the engines' windows are small beside the brackets.
const FILE: usize = 96_000;
/// How far a grain's own length may carry the read past a bracket, in source
/// frames: a 40 ms window at Scan 2.
const SLACK: f32 = 4_096.0;

/// A tone getting steadily louder: its level says where it is being read.
fn ramp_source() -> Arc<Source> {
    let samples = (0..FILE)
        .map(|i| (i as f32 * 0.0575).sin() * i as f32 / FILE as f32)
        .collect();
    Arc::new(Source { samples, channels: 1 })
}

fn params(alg: Algorithm, ratio: f32, scan: f32) -> StreamParams {
    StreamParams {
        in_frames: FILE,
        sample_rate: SR,
        ratio,
        semitones: 0.0,
        window_ms: 40.0,
        grain: Grain { scan, ..Grain::default() },
        algorithm: alg,
        wsola: fx::stretch::WsolaParams::default(),
        vocoder: fx::stretch::VocoderParams::default(),
        pvsola: fx::pvsola::PvsolaParams::default(),
        hybrid: fx::hybrid::HybridParams::default(),
        cloud: false,
        cloud_mix: 0.5,
    }
}

struct Rig {
    core: Core,
    shared: Shared,
    keys: Arc<GrainKeys>,
}

fn rig(alg: Algorithm, ratio: f32, scan: f32) -> Rig {
    let src = ramp_source();
    let sp = params(alg, ratio, scan);
    let shared = Shared::new(sp, Arc::clone(&src));
    let keys = Arc::new(GrainKeys::new());
    keys.set_amp(0.002, 0.01, 1.0, 0.02);
    keys.set_glide(0.0);
    let core = Core::new(BLOCK, 1, sp, src).with_keys(Arc::clone(&keys));
    Rig { core, shared, keys }
}

/// The brackets, set as the page sets them: source frames times the Stretch.
fn set_brackets(r: &Rig, ratio: f32, a: f32, b: f32, lit: bool) {
    r.shared.set_loop(lit, (a * ratio) as u64, (b * ratio) as u64);
}

fn pump(r: &mut Rig, blocks: usize) -> Vec<f32> {
    let mut buf = vec![0f32; BLOCK];
    let mut all = Vec::with_capacity(blocks * BLOCK);
    for _ in 0..blocks {
        r.core.fill(&mut buf, 1, &r.shared);
        all.extend_from_slice(&buf);
    }
    all
}

/// Pump, and collect where every grain read from.
fn reads(r: &mut Rig, blocks: usize) -> Vec<f32> {
    let mut buf = vec![0f32; BLOCK];
    let mut all = Vec::new();
    for _ in 0..blocks {
        r.core.fill(&mut buf, 1, &r.shared);
        all.extend(r.shared.drain_events().iter().map(|e| e.src_frame));
    }
    all
}

/// Output frames for `passes` trips round the brackets, as blocks.
fn blocks_for(ratio: f32, scan: f32, a: f32, b: f32, passes: f32) -> usize {
    ((b - a) * ratio / scan.abs() * passes / BLOCK as f32) as usize + 8
}

fn assert_read_stays(reads: &[f32], a: f32, b: f32, what: &str) {
    assert!(reads.len() > 8, "{what}: only {} grains", reads.len());
    let (lo, hi) = reads.iter().fold((f32::MAX, f32::MIN), |(lo, hi), r| (lo.min(*r), hi.max(*r)));
    assert!(lo >= a - SLACK, "{what}: read went below the left bracket: {lo} < {a}");
    assert!(hi <= b + SLACK, "{what}: read went past the right bracket: {hi} > {b}");
    // And it really goes round them, rather than sitting still somewhere legal.
    assert!(lo <= a + SLACK, "{what}: never reached the left bracket: lowest {lo}, {a}");
    assert!(hi >= b - SLACK, "{what}: never reached the right bracket: highest {hi}, {b}");
}

fn note_reads(alg: Algorithm, ratio: f32, scan: f32, a: f32, b: f32) -> Vec<f32> {
    let mut r = rig(alg, ratio, scan);
    r.keys.set_run(false);
    set_brackets(&r, ratio, a, b, false);
    r.keys.set_start(a / FILE as f32);
    r.keys.note_on(60, 1.0);
    reads(&mut r, blocks_for(ratio, scan, a, b, 2.5))
}

#[test]
fn a_held_note_stays_in_the_brackets_at_every_scan() {
    let (a, b) = (24_000.0, 48_000.0);
    for scan in [0.5f32, 2.0, -1.0, -0.5] {
        for ratio in [1.0f32, 2.0] {
            let got = note_reads(Algorithm::Granular, ratio, scan, a, b);
            assert_read_stays(&got, a, b, &format!("granular, Scan {scan}, Stretch {ratio}"));
        }
    }
}

#[test]
fn negative_scan_reads_backward_from_the_right_bracket() {
    let (a, b, ratio) = (24_000.0, 48_000.0, 1.0);
    let got = note_reads(Algorithm::Granular, ratio, -1.0, a, b);
    // The first grains of the note begin at the right bracket and walk down.
    let first = got[..got.len().min(6)].iter().cloned().fold(f32::MIN, f32::max);
    assert!((b - first).abs() < SLACK * 1.5, "first read {first}, right bracket {b}");
    let drops = got.windows(2).filter(|w| w[1] < w[0]).count();
    assert!(drops > got.len() * 3 / 4, "{drops} of {} steps went down", got.len());
}

#[test]
fn a_held_note_at_scan_one_is_the_brackets_as_set() {
    let (a, b, ratio) = (24_000.0, 48_000.0, 2.0);
    let got = note_reads(Algorithm::Granular, ratio, 1.0, a, b);
    assert_read_stays(&got, a, b, "granular, Scan 1");
}

/// The block's loudest sample, a block at a time, as a read position.
fn levels(x: &[f32]) -> Vec<f32> {
    x.chunks_exact(BLOCK * 8).map(|c| c.iter().fold(0f32, |m, s| m.max(s.abs())) * FILE as f32).collect()
}

fn assert_level_stays(levels: &[f32], a: f32, b: f32, what: &str) {
    let tol = (b - a) * 0.2;
    // The attack and the first window of the note are not yet the steady read.
    let body = &levels[2..];
    let hi = body.iter().cloned().fold(0f32, f32::max);
    assert!(hi <= b + tol, "{what}: level {hi} is past the right bracket {b}");
    assert!(hi >= b - tol * 2.0, "{what}: level {hi} never reached the right bracket {b}");
    // The dip at the seam is what pulls a window low, so the floor is a
    // majority's, not every window's.
    let inside = body.iter().filter(|l| **l >= a - tol).count();
    assert!(inside * 10 >= body.len() * 9, "{what}: only {inside} of {} windows were inside", body.len());
}

fn note_levels(alg: Algorithm, scan: f32, a: f32, b: f32) -> Vec<f32> {
    let mut r = rig(alg, 1.0, scan);
    r.keys.set_run(false);
    set_brackets(&r, 1.0, a, b, false);
    r.keys.set_start(a / FILE as f32);
    r.keys.note_on(60, 1.0);
    levels(&pump(&mut r, blocks_for(1.0, scan, a, b, 2.5)))
}

#[test]
fn the_vocoder_stays_in_the_brackets_at_every_scan() {
    let (a, b) = (24_000.0, 48_000.0);
    for scan in [0.5f32, 2.0, -1.0] {
        let got = note_levels(Algorithm::Vocoder, scan, a, b);
        assert_level_stays(&got, a, b, &format!("vocoder, Scan {scan}"));
    }
}

#[test]
fn wsola_stays_in_the_brackets_where_it_can_reach() {
    // WSOLA's read is held at the end of the file's output (`stream.rs`), so a
    // slow Scan cannot reach past `Scan x length`: the 0.5 brackets are in the
    // first half.
    for (scan, a, b) in [(0.5f32, 12_000.0, 24_000.0), (2.0, 24_000.0, 48_000.0), (-1.0, 24_000.0, 48_000.0)] {
        let got = note_levels(Algorithm::Wsola, scan, a, b);
        assert_level_stays(&got, a, b, &format!("wsola, Scan {scan}"));
    }
}

#[test]
fn pvsola_ignores_scan_so_its_loop_is_left_alone() {
    let (a, b) = (24_000.0, 48_000.0);
    // Compared by where the head went, not by sample: the output is a little
    // different off Scan 1, and that difference has not been traced.
    let trail = |scan: f32| {
        let mut r = rig(Algorithm::Pvsola, 1.0, scan);
        r.keys.set_run(false);
        set_brackets(&r, 1.0, a, b, false);
        r.keys.set_start(a / FILE as f32);
        r.keys.note_on(60, 1.0);
        (0..200).map(|_| { pump(&mut r, 1); r.keys.head() }).collect::<Vec<_>>()
    };
    assert_eq!(trail(2.0), trail(1.0));
}

fn transport_reads(front: bool, scan: f32, a: f32, b: f32) -> Vec<f32> {
    let ratio = 2.0;
    let mut r = rig(Algorithm::Granular, ratio, scan);
    set_brackets(&r, ratio, a, b, true);
    r.keys.set_front(front);
    r.shared.request_seek(((if scan < 0.0 { b } else { a }) * ratio / scan.abs()) as u64);
    r.shared.play();
    reads(&mut r, blocks_for(ratio, scan, a, b, 2.5))
}

#[test]
fn with_the_page_in_front_the_transport_loop_stays_in_the_brackets() {
    let (a, b) = (24_000.0, 48_000.0);
    for scan in [0.5f32, 2.0, -1.0] {
        let got = transport_reads(true, scan, a, b);
        assert_read_stays(&got, a, b, &format!("transport, Scan {scan}"));
    }
}

#[test]
fn without_the_page_the_transport_loop_is_todays() {
    // Scan 2 on the old screen: the loop is in output frames and the read
    // runs at twice the file, which is what it has always done.
    let (a, b) = (24_000.0, 48_000.0);
    let got = transport_reads(false, 2.0, a, b);
    assert!(got.iter().any(|r| *r > b + SLACK), "the old loop should still read past the bracket");
}

#[test]
fn scan_one_with_the_page_in_front_is_sample_identical() {
    let (a, b, ratio) = (24_000.0, 48_000.0, 2.0);
    let play = |front: bool| {
        let mut r = rig(Algorithm::Granular, ratio, 1.0);
        set_brackets(&r, ratio, a, b, true);
        r.keys.set_front(front);
        r.shared.request_seek((a * ratio) as u64);
        r.shared.play();
        pump(&mut r, 200)
    };
    assert_eq!(play(true), play(false));
}

#[test]
fn moving_scan_under_a_held_note_keeps_the_read_where_it_was() {
    let (a, b, ratio) = (24_000.0, 72_000.0, 1.0);
    let mut r = rig(Algorithm::Granular, ratio, 1.0);
    r.keys.set_run(false);
    set_brackets(&r, ratio, a, b, false);
    r.keys.set_start(a / FILE as f32);
    r.keys.note_on(60, 1.0);
    let before = reads(&mut r, 60);
    let at = *before.last().unwrap();
    r.shared.set_params(params(Algorithm::Granular, ratio, 0.5));
    let after = reads(&mut r, 8);
    assert!(
        (after[0] - at).abs() < SLACK,
        "the read jumped from {at} to {} when Scan moved",
        after[0]
    );
}
