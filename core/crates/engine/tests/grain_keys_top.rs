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
/// Also answers the slowest block it took once settled, and the middle one of
/// the forty, in milliseconds of this thread's CPU (a block of 512 at 48 kHz
/// plays for 10.7).
fn play(alg: Algorithm, mode: KeyMode, src: &Arc<Source>, parts: Option<&Arc<fx::hstream::Parts>>, note: u8, octaves: bool) -> (Vec<f32>, f64, f64) {
    let sp = deck(alg);
    let shared = Shared::new(sp, Arc::clone(src));
    if let Some(p) = parts {
        shared.set_parts(Arc::clone(p));
    }
    if octaves {
        shared.build_octaves();
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
    let mut took = Vec::with_capacity(40);
    let mut timed = |core: &mut Core, buf: &mut [f32]| {
        let t = cpu_now();
        core.fill(buf, 1, &shared);
        took.push((cpu_now() - t) * 1000.0);
    };
    // The first blocks of a note are its seek, which every engine pays once
    // (and PVSOLA's first whole run): settled, it is what a held note costs.
    for _ in 0..20 {
        core.fill(&mut buf[..], 1, &shared);
    }
    let mut got = Vec::with_capacity(40 * BLOCK);
    for _ in 0..40 {
        timed(&mut core, &mut buf[..]);
        got.extend_from_slice(&buf);
    }
    took.sort_by(f64::total_cmp);
    (got, took[took.len() - 1], took[took.len() / 2])
}

/// Seconds of CPU this thread has used: what a block costs, without the time
/// the system gave the core to something else (as `pv_cost.rs`).
#[cfg(unix)]
fn cpu_now() -> f64 {
    let mut t = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    // SAFETY: `t` is a valid timespec for the call to fill.
    unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t) };
    t.tv_sec as f64 + t.tv_nsec as f64 * 1e-9
}
#[cfg(not(unix))]
fn cpu_now() -> f64 {
    use std::sync::OnceLock;
    static T0: OnceLock<std::time::Instant> = OnceLock::new();
    T0.get_or_init(std::time::Instant::now).elapsed().as_secs_f64()
}

fn tone() -> Arc<Source> {
    let w = std::f64::consts::TAU * TONE / SR as f64;
    Arc::new(Source { samples: (0..FILE).map(|i| ((i as f64 * w).sin() * 0.5) as f32).collect(), channels: 1 })
}

/// The top note costs what C8 does (RJ, 17 Nov 2026): on the copy of the sound
/// two octaves up, G9 is read at 12, under C8's 16. Before, it was read at 48
/// and PVSOLA, the hybrid and SoundHack took two to three times longer than a
/// block plays for. The worst block of a held G9 has to be well inside the
/// budget on every engine, and its middle block no worse than half as much
/// again as C8's.
///
/// **The middle block, not the worst, against C8.** The worst of forty blocks
/// is whichever one the machine was busiest for, even counted in the thread's
/// own CPU time: on GitHub's shared runner C8's own worst SoundHack block was
/// 1.04 ms in one run and 2.64 in another, and G9 against it failed twice (20
/// Nov) with every block far inside the budget. The middle block is what a
/// held note costs, the same on every run; a G9 read from the wrong copy costs
/// two to three times more in every block, the middle one included.
#[test]
fn the_top_key_costs_no_more_than_c8_on_every_engine() {
    let src = tone();
    let budget = BLOCK as f64 / SR as f64 * 1000.0;
    let mut wrong = Vec::new();
    for alg in ENGINES {
        let parts = (alg == Algorithm::Hybrid)
            .then(|| Arc::new(fx::hstream::Parts::separate(&src.samples, 1, params(alg).hybrid)));
        // The best of three, so one block the machine was busy for is not a failure.
        let cost = |note: u8| {
            (0..3).map(|_| play(alg, KeyMode::Mono, &src, parts.as_ref(), note, true))
                .fold((f64::MAX, f64::MAX), |(w, m), (_, worst, mid)| (w.min(worst), m.min(mid)))
        };
        let ((c8w, c8), (g9w, g9)) = (cost(108), cost(127));
        eprintln!("{alg:?}: middle block C8 {c8:.2} ms, G9 {g9:.2} ms; worst C8 {c8w:.2}, G9 {g9w:.2}; of {budget:.1}");
        // Held to where the thread's own CPU time can be read: on the PC's
        // Windows this is the wall clock, and another run sharing the machine
        // once made a G9 block 24 ms there. The numbers are printed either way.
        if cfg!(unix) && (g9w > budget * 0.75 || g9 > c8 * 1.5 + 0.5) {
            wrong.push(format!("{alg:?}: G9 middle {g9:.2} ms against C8 {c8:.2} ms, worst {g9w:.2} against a budget of {budget:.1}"));
        }
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

#[test]
fn every_key_up_to_g9_sounds_a_semitone_above_the_one_below_on_every_engine() {
    let src = tone();
    let mut wrong = Vec::new();
    for alg in ENGINES {
        let parts = (alg == Algorithm::Hybrid)
            .then(|| Arc::new(fx::hstream::Parts::separate(&src.samples, 1, params(alg).hybrid)));
        for mode in [KeyMode::Poly, KeyMode::Mono] {
            let mut line = format!("{alg:?} {mode:?}:");
            for note in NOTES {
                // Poly plays from the copies an octave or more up, as the deck
                // does once they are made; Mono from the sound itself, as it
                // does until then. Both have to be in tune.
                let (got, ms, _) = play(alg, mode, &src, parts.as_ref(), note, mode == KeyMode::Poly);
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

