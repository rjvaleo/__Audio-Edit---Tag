// The master bus meters, against signals whose answers are known in advance.
//
// A meter that is merely self-consistent is worthless — it will agree with
// itself about the wrong number forever. Every case here has an arithmetic
// answer that can be worked out on paper, so the test knows what it should say
// rather than recording what it does say.

use audio_core::meter::{self, VU_REF_DBFS};

const SR: u32 = 48_000;

fn sine(hz: f32, amp: f32, frames: usize) -> Vec<f32> {
    (0..frames)
        .map(|i| amp * (2.0 * std::f32::consts::PI * hz * i as f32 / SR as f32).sin())
        .collect()
}

#[test]
fn a_full_scale_sine_reads_three_db_under() {
    // RMS of a sine is its amplitude over root two: 0.7071, which is −3.01 dBFS.
    let s = sine(1000.0, 1.0, SR as usize / 2);
    let m = meter::master(&s, &s, SR, 0.7079);
    assert!((m.left.vu - std::f32::consts::FRAC_1_SQRT_2).abs() < 1e-3,
        "RMS of a full-scale sine came out {}, not 0.7071", m.left.vu);
    assert!((m.left.vu_db + 3.01).abs() < 0.05,
        "{} dBFS, expected −3.01", m.left.vu_db);
    assert!((m.left.peak - 1.0).abs() < 1e-3, "peak {} of a full-scale sine", m.left.peak);
}

#[test]
fn zero_vu_is_eighteen_db_below_full_scale() {
    // The whole point of the reference. A sine whose RMS is −18 dBFS must read
    // 0 on the VU face — get this wrong and every number on the meter is off by
    // a constant nobody will notice until they trust it.
    let amp = 10f32.powf(VU_REF_DBFS / 20.0) * 2f32.sqrt();
    let s = sine(1000.0, amp, SR as usize / 2);
    let m = meter::master(&s, &s, SR, 0.7079);
    assert!(m.left.vu_units.abs() < 0.05,
        "a sine at {} dBFS RMS read {} VU, not 0", m.left.vu_db, m.left.vu_units);
}

#[test]
fn the_vu_integrates_over_three_hundred_milliseconds_and_the_peak_does_not() {
    // A single click at the very end, silence before it. The peak window is
    // 100 ms so it sees the click; the VU averages it across 300 ms so it
    // barely moves. A meter where these two agree is not integrating.
    let mut s = vec![0.0f32; SR as usize];
    *s.last_mut().unwrap() = 1.0;
    let m = meter::master(&s, &s, SR, 0.7079);
    assert!((m.left.peak - 1.0).abs() < 1e-6, "the peak missed the click: {}", m.left.peak);
    assert!(m.left.vu < 0.01,
        "one sample in 300 ms read {} on an integrating meter", m.left.vu);
}

#[test]
fn correlation_knows_mono_from_inverted_from_silence() {
    let a = sine(440.0, 0.5, 8192);
    let inv: Vec<f32> = a.iter().map(|s| -s).collect();
    let silence = vec![0.0f32; 8192];

    assert!((meter::correlation(&a, &a) - 1.0).abs() < 1e-4, "identical channels");
    assert!((meter::correlation(&a, &inv) + 1.0).abs() < 1e-4, "inverted channels");
    // Not NaN, and not flailing: a still needle over silence.
    assert!((meter::correlation(&silence, &silence) - 1.0).abs() < 1e-6, "silence");
}

#[test]
fn a_dc_offset_is_not_mistaken_for_correlation() {
    // Two unrelated signals, one sitting on a large positive offset. Without
    // removing the means this reads as strongly correlated when it is not.
    let a = sine(440.0, 0.3, 8192);
    let b: Vec<f32> = sine(997.0, 0.3, 8192).iter().map(|s| s + 0.8).collect();
    let c = meter::correlation(&a, &b);
    assert!(c.abs() < 0.2, "unrelated channels read {c} correlated");
}

#[test]
fn the_spectrum_finds_a_tone_where_it_actually_is() {
    let hz = 1000.0;
    let s = sine(hz, 1.0, 16_384);
    let bands = meter::spectrum(&s, &s, SR, 4096, 256, 20.0, 20_000.0);
    assert_eq!(bands.len(), 256);

    let (idx, level) = bands.iter().enumerate()
        .fold((0usize, f32::MIN), |(bi, bv), (i, v)| if *v > bv { (i, *v) } else { (bi, bv) });
    // Which band that index is, in Hz.
    let ratio = (20_000f32 / 20.0).powf(1.0 / 256.0);
    let centre = 20.0 * ratio.powf(idx as f32 + 0.5);
    assert!((centre / hz).log2().abs() < 0.15,
        "the loudest band is at {centre:.0} Hz, but the tone is at {hz:.0} Hz");
    // A full-scale sine is 0 dBFS. Hann scalloping can cost a fraction of a dB.
    assert!(level > -1.5 && level < 0.5,
        "a full-scale sine read {level:.2} dBFS, expected about 0");
}

#[test]
fn silence_reads_the_floor_rather_than_negative_infinity() {
    let s = vec![0.0f32; 16_384];
    let bands = meter::spectrum(&s, &s, SR, 4096, 64, 20.0, 20_000.0);
    assert!(bands.iter().all(|v| v.is_finite()), "a non-finite dB value would break the draw");
    assert!(bands.iter().all(|v| *v <= meter::FLOOR_DB + 1e-3), "silence is not at the floor");
    let m = meter::master(&s, &s, SR, 0.7079);
    assert!(m.left.vu_db.is_finite() && m.left.peak_db.is_finite());
}

#[test]
fn a_quiet_band_is_not_averaged_away_by_its_neighbours() {
    // The reason bands report their loudest bin. At the top of the range one
    // band spans dozens of bins; a tone in one of them must still show.
    let s = sine(15_000.0, 1.0, 16_384);
    let bands = meter::spectrum(&s, &s, SR, 4096, 256, 20.0, 20_000.0);
    let loudest = bands.iter().cloned().fold(f32::MIN, f32::max);
    assert!(loudest > -1.5, "a full-scale 15 kHz tone read only {loudest:.1} dBFS");
}

#[test]
fn over_knee_reports_what_the_ceiling_is_actually_rounding() {
    let knee = 0.7079;
    let quiet = sine(200.0, 0.2, SR as usize / 4);
    let loud = sine(200.0, 1.0, SR as usize / 4);
    assert_eq!(meter::master(&quiet, &quiet, SR, knee).over_knee, 0.0,
        "nothing is above the knee in a signal that never reaches it");
    let hot = meter::master(&loud, &loud, SR, knee).over_knee;
    // Half. |sin| exceeds 1/root-2 between 45 and 135 degrees and again between
    // 225 and 315 — 180 degrees of every 360.
    assert!(hot > 0.45 && hot < 0.55, "a full-scale sine sat over the knee {hot:.3} of the time");
}

#[test]
fn the_lissajous_is_contiguous_and_ends_at_now() {
    let l: Vec<f32> = (0..1000).map(|i| i as f32).collect();
    let r: Vec<f32> = (0..1000).map(|i| -(i as f32)).collect();
    let pts = meter::lissajous(&l, &r, 256);
    assert_eq!(pts.len(), 256);
    assert_eq!(pts[255], (999.0, -999.0), "the last point is not the newest sample");
    // Every sample, not every fourth — decimating draws an aliased signal.
    for w in pts.windows(2) {
        assert_eq!(w[1].0 - w[0].0, 1.0, "the trace skips samples");
    }
}

#[test]
fn a_shorter_buffer_than_asked_for_is_not_a_panic() {
    let s = sine(440.0, 0.5, 100);
    let m = meter::master(&s, &s, SR, 0.7079);
    assert_eq!(m.frames, 100);
    assert_eq!(meter::lissajous(&s, &s, 4096).len(), 100);
    assert_eq!(meter::spectrum(&s, &s, SR, 4096, 32, 20.0, 20_000.0).len(), 32);
}
