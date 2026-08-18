//! Master bus metering: VU, correlation and a log-spaced spectrum.
//!
//! Pure arithmetic over a block of samples. Nothing here reads a device, takes
//! a lock or knows what a display looks like — it is given the master bus and
//! returns numbers, which is what makes it testable.
//!
//! See `docs/MASTER-BUS.md` for why this runs here rather than in the audio
//! callback.

/// What 0 VU is worth in dBFS.
///
/// EBU R68. The other common answer is SMPTE's −20; the difference is two dB of
/// assumed headroom and nothing else, and −18 is the more usual default. dBFS
/// is reported alongside so the reference is never in doubt.
pub const VU_REF_DBFS: f32 = -18.0;

/// How long a true VU integrates over.
///
/// 300 ms is the definition, not a taste: it is what makes a VU a loudness
/// meter rather than a level meter, and it is why a separate fast peak is
/// needed beside it to catch anything that hits the ceiling.
pub const VU_INTEGRATION_SECONDS: f32 = 0.300;

/// The window the fast peak is taken over.
///
/// Comfortably longer than the interface's poll, so no transient falls between
/// two reads, and short enough that the marker drops promptly instead of
/// smearing one hit across half a second of polls. The hold and its decay are
/// the display's business, not this function's.
pub const PEAK_WINDOW_SECONDS: f32 = 0.100;

/// Anything quieter than this reads as silence rather than as a number with
/// eighty decibels of nonsense after the point.
pub const FLOOR_DB: f32 = -120.0;

/// Amplitude to dBFS, floored rather than allowed to reach negative infinity.
pub fn db(x: f32) -> f32 {
    let a = x.abs();
    if a <= 0.0 {
        return FLOOR_DB;
    }
    (20.0 * a.log10()).max(FLOOR_DB)
}

/// The last `n` of a slice, or all of it when it is shorter.
fn tail(x: &[f32], n: usize) -> &[f32] {
    if n == 0 || x.len() <= n {
        x
    } else {
        &x[x.len() - n..]
    }
}

pub fn peak(x: &[f32]) -> f32 {
    x.iter().fold(0.0f32, |m, s| m.max(s.abs()))
}

pub fn rms(x: &[f32]) -> f32 {
    if x.is_empty() {
        return 0.0;
    }
    // Summed in f64. A 16k window of f32 squares accumulates visible error in
    // f32, and this number is printed to a decimal place.
    let sum: f64 = x.iter().map(|s| (*s as f64) * (*s as f64)).sum();
    (sum / x.len() as f64).sqrt() as f32
}

/// One channel's reading.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Channel {
    /// RMS over [`VU_INTEGRATION_SECONDS`], as an amplitude.
    pub vu: f32,
    /// The same in dBFS.
    pub vu_db: f32,
    /// The same again relative to [`VU_REF_DBFS`] — this is what a VU face
    /// reads, where 0 is the reference and the red starts just above it.
    pub vu_units: f32,
    /// Peak over [`PEAK_WINDOW_SECONDS`], as an amplitude.
    pub peak: f32,
    pub peak_db: f32,
}

/// Both channels, plus what the pair are doing together.
#[derive(Debug, Clone, PartialEq)]
pub struct Master {
    pub left: Channel,
    pub right: Channel,
    /// −1 (out of phase) to +1 (identical). Zero is uncorrelated, which for a
    /// wide stereo image is normal; sustained negative is a warning, because it
    /// is what disappears when somebody sums to mono.
    pub correlation: f32,
    /// Fraction of frames in the peak window whose magnitude is above the
    /// threshold given — the soft ceiling's knee, so this reads as "how much of
    /// the signal is being rounded off".
    pub over_knee: f32,
    /// Frames the whole reading was taken from.
    pub frames: usize,
}

fn channel(x: &[f32], rate: u32) -> Channel {
    let r = rate.max(1) as f32;
    let v = rms(tail(x, (r * VU_INTEGRATION_SECONDS) as usize));
    let p = peak(tail(x, (r * PEAK_WINDOW_SECONDS) as usize));
    Channel {
        vu: v,
        vu_db: db(v),
        vu_units: db(v) - VU_REF_DBFS,
        peak: p,
        peak_db: db(p),
    }
}

/// Read the master bus.
///
/// `knee` is the amplitude above which the output stage starts rounding peaks
/// off; pass the engine's own constant rather than a guess, or `over_knee` will
/// describe a limiter that does not exist.
pub fn master(l: &[f32], r: &[f32], rate: u32, knee: f32) -> Master {
    let n = l.len().min(r.len());
    let (l, r) = (&l[..n], &r[..n]);
    let win = ((rate.max(1) as f32) * PEAK_WINDOW_SECONDS) as usize;
    let (lw, rw) = (tail(l, win), tail(r, win));

    let over = if lw.is_empty() {
        0.0
    } else {
        let hit = lw
            .iter()
            .zip(rw.iter())
            .filter(|(a, b)| a.abs() > knee || b.abs() > knee)
            .count();
        hit as f32 / lw.len() as f32
    };

    Master {
        left: channel(l, rate),
        right: channel(r, rate),
        correlation: correlation(lw, rw),
        over_knee: over,
        frames: n,
    }
}

/// The normalised cross-correlation of the two channels at zero lag.
///
/// Mean-removed, because a DC offset on one side would otherwise read as
/// correlation that is not there. Two silent channels are defined as +1: they
/// are identical, and a goniometer needle that flails when nothing is playing
/// is worse than one that sits still.
pub fn correlation(l: &[f32], r: &[f32]) -> f32 {
    let n = l.len().min(r.len());
    if n == 0 {
        return 1.0;
    }
    let (mut ml, mut mr) = (0f64, 0f64);
    for i in 0..n {
        ml += l[i] as f64;
        mr += r[i] as f64;
    }
    ml /= n as f64;
    mr /= n as f64;
    let (mut num, mut dl, mut dr) = (0f64, 0f64, 0f64);
    for i in 0..n {
        let a = l[i] as f64 - ml;
        let b = r[i] as f64 - mr;
        num += a * b;
        dl += a * a;
        dr += b * b;
    }
    let den = (dl * dr).sqrt();
    if den <= 1e-20 {
        return 1.0;
    }
    (num / den).clamp(-1.0, 1.0) as f32
}

/// A log-spaced magnitude spectrum in dBFS, ready to plot.
///
/// `size` must be a power of two; the transform is taken over the most recent
/// `size` frames of the mono sum. Bands run from `lo` to `hi` geometrically,
/// which is how a spectrum is read — an octave should occupy the same width
/// wherever it sits.
///
/// Each band reports the **loudest** bin inside it, not the average. A band
/// covering forty bins of which one holds a sine averages that sine away; an
/// analyser that hides a tone is not an analyser.
pub fn spectrum(
    l: &[f32],
    r: &[f32],
    rate: u32,
    size: usize,
    bands: usize,
    lo: f32,
    hi: f32,
) -> Vec<f32> {
    if bands == 0 || rate == 0 || !size.is_power_of_two() {
        return Vec::new();
    }
    let n = l.len().min(r.len());
    if n < size {
        return vec![FLOOR_DB; bands];
    }
    let (ls, rs) = (&l[n - size..], &r[n - size..]);

    let win = crate::fft::hann(size);
    let mut re = vec![0.0f32; size];
    let mut im = vec![0.0f32; size];
    for i in 0..size {
        re[i] = (ls[i] + rs[i]) * 0.5 * win[i];
    }
    if !crate::fft::fft(&mut re, &mut im) {
        return vec![FLOOR_DB; bands];
    }

    // Coherent gain of the Hann window is 0.5, and only half the spectrum is
    // ours — so a full-scale sine lands at 0 dBFS rather than six under it.
    let norm = size as f32 * 0.25;
    let half = size / 2;
    let bin_hz = rate as f32 / size as f32;

    let mut out = Vec::with_capacity(bands);
    let ratio = (hi / lo).powf(1.0 / bands as f32);
    let mut edge = lo;
    for _ in 0..bands {
        let next = edge * ratio;
        // At the bottom a band is narrower than a bin, so `a == b`; take the
        // one bin it falls in rather than an empty range.
        let a = ((edge / bin_hz).floor() as usize).clamp(1, half - 1);
        let b = ((next / bin_hz).ceil() as usize).clamp(a + 1, half);
        let mut m = 0.0f32;
        for i in a..b {
            let v = (re[i] * re[i] + im[i] * im[i]).sqrt();
            if v > m {
                m = v;
            }
        }
        out.push(db(m / norm));
        edge = next;
    }
    out
}

/// Sample pairs for a goniometer, most recent last.
///
/// Contiguous rather than decimated: a Lissajous is a picture of the waveform
/// against itself, and taking every eighth sample draws a picture of a
/// different, aliased signal. A short window of every sample is the honest one.
pub fn lissajous(l: &[f32], r: &[f32], points: usize) -> Vec<(f32, f32)> {
    let n = l.len().min(r.len());
    let take = points.min(n);
    let start = n - take;
    (start..n).map(|i| (l[i], r[i])).collect()
}
