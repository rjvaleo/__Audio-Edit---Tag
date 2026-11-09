//! What is heard in the first moments of a sound, frame by frame with no sound
//! card: a note's pitch arriving, and the Hybrid engine's separation coming in
//! under a transport that is already playing (RJ, 8 Nov 2026: "a strange
//! glitching in the audio when the file first starts to play").

use engine::{Core, GrainKeys, Shared, Source};
use fx::grain::{Grain, StreamParams};
use fx::hstream::Parts;
use fx::stretch::Algorithm;
use std::sync::Arc;

const SR: u32 = 48_000;
const BLOCK: usize = 512;
/// Far above anything a tone of a few hundred hertz has between three samples,
/// and far below a read that has jumped.
const CORNER: f32 = 0.012;

fn params(in_frames: usize, algorithm: Algorithm, cloud: bool) -> StreamParams {
    let st = fx::Stretch::default();
    StreamParams {
        in_frames,
        sample_rate: SR,
        ratio: 1.0,
        semitones: 0.0,
        window_ms: 40.0,
        grain: Grain::default(),
        algorithm,
        wsola: st.wsola,
        vocoder: st.vocoder,
        pvsola: st.pvsola,
        hybrid: st.hybrid,
        cloud,
        cloud_mix: 0.5,
    }
}

/// A steady tone: any corner in what comes out is the engine's.
fn tone(frames: usize) -> Arc<Source> {
    let samples = (0..frames).map(|i| (i as f32 / SR as f32 * 220.0 * std::f32::consts::TAU).sin() * 0.5).collect();
    Arc::new(Source { samples, channels: 1 })
}

/// A tone whose level says where in the file it was read from.
fn rising(frames: usize) -> Arc<Source> {
    let samples = (0..frames)
        .map(|i| (i as f32 / SR as f32 * 220.0 * std::f32::consts::TAU).sin() * level_at(i as f32 / frames as f32))
        .collect();
    Arc::new(Source { samples, channels: 1 })
}

fn level_at(fraction: f32) -> f32 {
    0.05 + 0.75 * fraction
}

fn pump(core: &mut Core, shared: &Shared, blocks: usize) -> Vec<f32> {
    let mut buf = vec![0f32; BLOCK];
    let mut all = Vec::new();
    for _ in 0..blocks {
        core.fill(&mut buf, 1, shared);
        all.extend_from_slice(&buf);
    }
    all
}

fn corners(x: &[f32]) -> Vec<usize> {
    x.windows(3).enumerate().filter(|(_, w)| (w[2] - 2.0 * w[1] + w[0]).abs() > CORNER).map(|(i, _)| i + 2).collect()
}

fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| v * v).sum::<f32>() / x.len().max(1) as f32).sqrt()
}

fn deck(src: &Arc<Source>, algorithm: Algorithm, cloud: bool) -> (Core, Shared) {
    let sp = params(src.frames(), algorithm, cloud);
    let shared = Shared::new(sp, Arc::clone(src));
    let core = Core::new(BLOCK, 1, sp, Arc::clone(src));
    (core, shared)
}

fn separated(src: &Source, algorithm: Algorithm) -> Arc<Parts> {
    Arc::new(Parts::separate(&src.samples, src.channels, params(src.frames(), algorithm, false).hybrid))
}

/// The page's Glide, a key that is not the file's own pitch, and every engine
/// that shifts by reading a ring back faster. Each step of the Glide retunes the
/// ring, the ring's own rate settles inside a block, and the read used to go
/// back to where that block began.
#[test]
fn a_pitch_arriving_does_not_move_the_read() {
    let src = tone(SR as usize * 4);
    for (alg, name) in [(Algorithm::Wsola, "wsola"), (Algorithm::Vocoder, "vocoder"), (Algorithm::Pvsola, "pvsola"), (Algorithm::Hybrid, "hybrid")] {
        for key in [72u8, 64, 48] {
            let (core, shared) = deck(&src, alg, false);
            let keys = Arc::new(GrainKeys::new());
            let mut core = core.with_keys(Arc::clone(&keys));
            if alg == Algorithm::Hybrid {
                shared.set_parts(separated(&src, alg));
            }
            keys.set_run(false);
            keys.set_glide(0.18);
            keys.set_amp(0.1, 0.1, 1.0, 0.5);
            pump(&mut core, &shared, 4);
            keys.note_on(key, 1.0);
            let out = pump(&mut core, &shared, 120);
            let c = corners(&out);
            assert!(c.is_empty(), "{name}, key {key}: {} corners, the first at {:?}", c.len(), c.first());
        }
    }
}

/// The separation takes a few hundred milliseconds and arrives while the file
/// is playing. The engine it is for had been left at the top of the file, so it
/// began there: the sound jumped back and stayed that far behind the playhead.
#[test]
fn the_separation_arriving_reads_on_from_the_playhead() {
    let frames = SR as usize * 6;
    let src = rising(frames);
    for cloud in [false, true] {
        let (mut core, shared) = deck(&src, Algorithm::Hybrid, cloud);
        pump(&mut core, &shared, 2);
        shared.play();
        let before = pump(&mut core, &shared, 94); // about a second
        shared.set_parts(separated(&src, Algorithm::Hybrid));
        let after = pump(&mut core, &shared, 30);
        let mut heard = before[before.len() - 4096..].to_vec();
        heard.extend_from_slice(&after);
        let c = corners(&heard);
        assert!(c.is_empty(), "cloud {cloud}: {} corners, the first at {:?}", c.len(), c.first());
        // A tenth of a second on, the level is the level of the file there.
        let at = 94 * BLOCK + 4800;
        let want = level_at(at as f32 / frames as f32) * std::f32::consts::FRAC_1_SQRT_2;
        let got = rms(&after[4800..4800 + 4800]);
        assert!(got > want * 0.75, "cloud {cloud}: {got} where the file is {want}: the read went back");
    }
}

/// With the cloud on, the stand-in for the separation and the cloud are the same
/// renderer. Asked for the same frames twice, it lost its place, sought, and
/// dropped every sounding grain, once a block.
#[test]
fn the_cloud_over_a_hybrid_waiting_for_its_separation_keeps_its_grains() {
    let src = tone(SR as usize * 4);
    let (mut core, shared) = deck(&src, Algorithm::Hybrid, true);
    pump(&mut core, &shared, 2);
    shared.play();
    let out = pump(&mut core, &shared, 60);
    let c = corners(&out);
    assert!(c.is_empty(), "{} corners, the first at {:?}", c.len(), c.first());
    assert!(rms(&out[out.len() / 2..]) > 0.1, "it should still be sounding");
}

/// The stand-in plays the place the transport is at, not wherever that renderer
/// was last left.
#[test]
fn the_stand_in_for_the_separation_starts_at_the_playhead() {
    let frames = SR as usize * 6;
    let src = rising(frames);
    let (mut core, shared) = deck(&src, Algorithm::Hybrid, false);
    pump(&mut core, &shared, 2);
    let at = frames / 2;
    shared.request_seek(at as u64);
    pump(&mut core, &shared, 2);
    shared.play();
    let out = pump(&mut core, &shared, 30);
    let want = level_at((at + out.len() / 2) as f32 / frames as f32) * std::f32::consts::FRAC_1_SQRT_2;
    let got = rms(&out[4800..]);
    assert!(got > want * 0.75, "{got} where the file is {want}");
}

/// Coming home to the file's own pitch with no restart: a Legato back to the
/// tonic, the wheel let go. At exactly nought the ring is bypassed, and the
/// engine's next frames are ahead of what had been read out of it.
#[test]
fn a_pitch_coming_home_does_not_skip() {
    let src = tone(SR as usize * 6);
    for (alg, name) in [(Algorithm::Wsola, "wsola"), (Algorithm::Vocoder, "vocoder"), (Algorithm::Pvsola, "pvsola")] {
        let (core, shared) = deck(&src, alg, false);
        let keys = Arc::new(GrainKeys::new());
        let mut core = core.with_keys(Arc::clone(&keys));
        keys.set_run(false);
        keys.set_glide(0.18);
        keys.set_amp(0.05, 0.1, 1.0, 0.5);
        keys.set_mode(engine::KeyMode::Legato);
        pump(&mut core, &shared, 4);
        keys.note_on(60, 1.0);
        pump(&mut core, &shared, 60);
        keys.note_on(67, 1.0);
        let up = pump(&mut core, &shared, 90);
        keys.note_off(67);
        let home = pump(&mut core, &shared, 120);
        for (what, out) in [("up", &up), ("home", &home)] {
            let c = corners(out);
            assert!(c.is_empty(), "{name}, {what}: {} corners, the first at {:?}", c.len(), c.first());
        }
    }
}
