//! The top of the keyboard (RJ, 16 Nov 2026: "the grain engine plays no
//! higher than C8 … we do want to fix that").
//!
//! A key's pitch was clamped to ±48 semitones from middle C, which is C8, and
//! the five engines that pitch through the resampling ring stopped at a rate of
//! 20 (about E8). Every key up to MIDI 127, G9, is 67 semitones up, a rate of
//! 47.9. This plays a 100 Hz tone on every engine, in Poly and in Mono, at
//! notes either side of C8 and up to 127, and **measures** the pitch of what
//! comes out: each note has to sound at 100 Hz × 2^((note − 60) / 12), one
//! semitone above the note below it, with no clamp anywhere.

use engine::voices::stock;
use engine::{Core, GrainKeys, KeyMode, Shared, Source};
use fx::grain::{Grain, StreamParams};
use fx::stretch::Algorithm;
use std::sync::Arc;

const SR: u32 = 48_000;
const BLOCK: usize = 512;
/// Six seconds: at G9 one 40 ms grain reads 1.9 s of the file.
const FILE: usize = SR as usize * 6;
const TONE: f64 = 100.0;
const ENGINES: [Algorithm; 6] = [
    Algorithm::Granular,
    Algorithm::Wsola,
    Algorithm::Vocoder,
    Algorithm::Pvsola,
    Algorithm::Hybrid,
    Algorithm::SoundHack,
];
/// Below C8, C8 itself, the keys that used to sound as C8, and the top.
const NOTES: [u8; 8] = [96, 107, 108, 109, 115, 120, 126, 127];

fn params(alg: Algorithm) -> StreamParams {
    StreamParams {
        in_frames: FILE,
        sample_rate: SR,
        ratio: 1.0,
        semitones: 0.0,
        window_ms: 40.0,
        grain: Grain::default(),
        algorithm: alg,
        wsola: fx::stretch::WsolaParams::default(),
        vocoder: fx::stretch::VocoderParams::default(),
        pvsola: fx::pvsola::PvsolaParams::default(),
        hybrid: fx::hybrid::HybridParams::default(),
        // As in `grain_poly.rs`: 0.896 cancels a partial off its bin's centre,
        // which is SoundHack's own and not what is under test here.
        soundhack: fx::soundhack::SoundHackParams { version: fx::soundhack::Version::V0888 },
        cloud: false,
        cloud_mix: 0.5,
    }
}

/// The deck for `alg`. The cloud throws ten grains a second, so each 40 ms
/// grain stands on its own: overlapping grains of one pure tone, read from
/// different places, interfere, and the sum of them has its peaks on the
/// grain rate's own lines rather than at the note (on main and here alike).
/// One grain at a time is the note and nothing else.
fn deck(alg: Algorithm) -> StreamParams {
    let mut sp = params(alg);
    if alg == Algorithm::Granular {
        sp.grain.rate_hz = 10.0;
    }
    sp
}

/// The grains in `x`: the runs of sound between silences, a tenth trimmed off
/// each end where the envelope is still opening or closing.
fn grains_of(x: &[f32]) -> Vec<&[f32]> {
    let peak = x.iter().fold(0f32, |m, s| m.max(s.abs()));
    let loud = |s: f32| s.abs() > peak * 0.02;
    let mut out = Vec::new();
    let mut i = 0;
    while i < x.len() {
        if !loud(x[i]) {
            i += 1;
            continue;
        }
        let (start, mut last) = (i, i);
        while i < x.len() && i - last < 200 {
            if loud(x[i]) {
                last = i;
            }
            i += 1;
        }
        let len = last - start;
        if len >= 800 {
            out.push(&x[start + len / 10..last - len / 10]);
        }
    }
    out
}

/// The pitch a note came out at: the strongest frequency near it, over the
/// whole of it, or for a cloud the median of its grains, one at a time.
fn pitch_of(alg: Algorithm, x: &[f32], near: f64) -> f64 {
    if alg != Algorithm::Granular {
        return measured(x, near);
    }
    let mut each: Vec<f64> = grains_of(x).into_iter().map(|g| measured(g, near)).collect();
    assert!(each.len() >= 2, "only {} grains to measure", each.len());
    each.sort_by(|a, b| a.partial_cmp(b).unwrap());
    each[each.len() / 2]
}

/// The pitch a note should sound at.
fn want(note: u8) -> f64 {
    TONE * 2f64.powf((note as f64 - 60.0) / 12.0)
}

/// How much of `freq` there is, under a Hann window so the neighbours of a
/// strong partial do not borrow from it.
fn level(x: &[f32], freq: f64) -> f64 {
    let n = x.len() as f64;
    let w = std::f64::consts::TAU * freq / SR as f64;
    let (mut re, mut im) = (0f64, 0f64);
    for (i, s) in x.iter().enumerate() {
        let hann = 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / n).cos();
        let v = *s as f64 * hann;
        re += v * (i as f64 * w).cos();
        im += v * (i as f64 * w).sin();
    }
    (re * re + im * im).sqrt() * 4.0 / n
}

/// The strongest frequency within ±150 cents of `near`, to two cents.
fn measured(x: &[f32], near: f64) -> f64 {
    (-75..=75)
        .map(|c| near * 2f64.powf(c as f64 * 2.0 / 1200.0))
        .map(|f| (f, level(x, f)))
        .fold((near, -1.0), |best, (f, l)| if l > best.1 { (f, l) } else { best })
        .0
}

fn cents(got: f64, want: f64) -> f64 {
    1200.0 * (got / want).log2()
}

/// One note, held on its own, on a fresh deck: what it sounds like once it
/// has settled.
/// Also answers the slowest block it took, in milliseconds (a block of 512 at
/// 48 kHz plays for 10.7).
fn play(alg: Algorithm, mode: KeyMode, src: &Arc<Source>, parts: Option<&Arc<fx::hstream::Parts>>, note: u8) -> (Vec<f32>, f64) {
    let sp = deck(alg);
    let shared = Shared::new(sp, Arc::clone(src));
    if let Some(p) = parts {
        shared.set_parts(Arc::clone(p));
    }
    let keys = Arc::new(GrainKeys::new());
    keys.set_run(false);
    keys.set_mode(mode);
    keys.set_amp(0.005, 0.01, 1.0, 0.02);
    keys.set_glide(0.0);
    if mode == KeyMode::Poly {
        stock(&shared, 8, BLOCK, 1);
    }
    let mut core = Core::new(BLOCK, 1, sp, Arc::clone(src)).with_keys(Arc::clone(&keys));
    keys.note_on(note, 1.0);
    let mut buf = vec![0f32; BLOCK];
    let mut worst = 0f64;
    let mut timed = |core: &mut Core, buf: &mut [f32]| {
        let t = std::time::Instant::now();
        core.fill(buf, 1, &shared);
        worst = worst.max(t.elapsed().as_secs_f64() * 1000.0);
    };
    for _ in 0..20 {
        timed(&mut core, &mut buf[..]);
    }
    let mut got = Vec::with_capacity(40 * BLOCK);
    for _ in 0..40 {
        timed(&mut core, &mut buf[..]);
        got.extend_from_slice(&buf);
    }
    (got, worst)
}

#[test]
fn every_key_up_to_g9_sounds_a_semitone_above_the_one_below_on_every_engine() {
    let w = std::f64::consts::TAU * TONE / SR as f64;
    let src = Arc::new(Source { samples: (0..FILE).map(|i| ((i as f64 * w).sin() * 0.5) as f32).collect(), channels: 1 });
    let mut wrong = Vec::new();
    for alg in ENGINES {
        let parts = (alg == Algorithm::Hybrid)
            .then(|| Arc::new(fx::hstream::Parts::separate(&src.samples, 1, params(alg).hybrid)));
        for mode in [KeyMode::Poly, KeyMode::Mono] {
            let mut line = format!("{alg:?} {mode:?}:");
            for note in NOTES {
                let (got, ms) = play(alg, mode, &src, parts.as_ref(), note);
                if note == 127 {
                    line += &format!(" [G9 worst block {ms:.1} ms of 10.7]");
                }
                let f = pitch_of(alg, &got, want(note));
                let off = cents(f, want(note));
                // A semitone either side has to be well under the note itself:
                // a clamped key sounds a semitone or more below where it should.
                // (A grain is too short a stretch of sound to tell a semitone
                // apart by level; its pitch, to the cent, is the test there.)
                let at = level(&got, want(note));
                let below = level(&got, want(note) / 2f64.powf(1.0 / 12.0));
                let above = level(&got, want(note) * 2f64.powf(1.0 / 12.0));
                let apart = alg == Algorithm::Granular || (at >= 3.0 * below && at >= 3.0 * above && at >= 0.01);
                line += &format!(" {note}={f:.0}Hz({off:+.0}c)");
                if off.abs() > 12.0 || !apart {
                    wrong.push(format!(
                        "{alg:?} {mode:?} note {note}: {f:.1} Hz, {off:+.1} cents from {:.1}; level {at:.4} against {below:.4} a semitone down and {above:.4} up",
                        want(note)
                    ));
                }
            }
            eprintln!("{line}");
        }
    }
    assert!(wrong.is_empty(), "notes not at their pitch:\n{}", wrong.join("\n"));
}

/// The Grain page sends a table of 128 pitches; the top key is +67.
#[test]
fn the_keys_table_reaches_the_top_of_midi() {
    let keys = GrainKeys::new();
    assert_eq!(keys.key_semitones(127), 67.0);
    assert_eq!(keys.key_semitones(108), 48.0);
}
