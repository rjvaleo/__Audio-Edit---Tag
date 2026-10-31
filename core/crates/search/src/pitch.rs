//! What note a sound is, and whether it is one at all.
//!
//! Brightness is not pitch. The spectrum's centre moves with the note, but also
//! with the filter, the distortion and the noise in it, so a bright bass and a
//! dull whistle can measure the same. This measures the period instead.
//!
//! The method is YIN (de Cheveigné and Kawahara, 2002): the difference between
//! the signal and a delayed copy of itself, normalised by its own running mean,
//! dips towards zero at every delay that is a whole number of periods. The
//! *first* dip under the threshold is taken, not the deepest: the deepest is
//! often two periods, which is the octave error every simpler method makes on
//! a tone with strong harmonics.
//!
//! The depth of the dip doubles as the answer to "is this pitched at all". A
//! clean tone dips to nearly zero; noise never dips, because no delay makes it
//! look like itself. That number is `clarity`, and a sound whose frames are
//! mostly unclear gets no pitch rather than a confident wrong one. Drums are
//! most of a sample library, and a map that gave every snare a note would put
//! them at random heights.

/// The note a sound sits on, if it has one.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Pitch {
    /// The fundamental in Hz. 0 when the sound has no steady pitch.
    pub hz: f32,
    /// 0..1: how periodic the sound is. Near 1 for a held tone, low for noise,
    /// 0 for silence. Meaningful whether or not `hz` is set.
    pub clarity: f32,
}

/// Lowest and highest fundamentals looked for: below a 5-string bass's B, above
/// the top of a piccolo. Outside these a sample is better described by its
/// brightness than by a note.
const MIN_HZ: f32 = 35.0;
const MAX_HZ: f32 = 2_000.0;

/// A dip below this is a period. YIN's own recommended value.
const THRESHOLD: f32 = 0.15;

/// At most this many frames are examined, spread across the excerpt.
const MAX_FRAMES: usize = 32;

const NAMES: [&str; 12] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

impl Pitch {
    /// The nearest equal-tempered note, as `A4`. None when there is no pitch.
    pub fn note(&self) -> Option<String> {
        if !(self.hz > 0.0) {
            return None;
        }
        let midi = (69.0 + 12.0 * (self.hz / 440.0).log2()).round() as i32;
        Some(format!("{}{}", NAMES[midi.rem_euclid(12) as usize], midi.div_euclid(12) - 1))
    }

    /// Measure a mono excerpt at `sr`.
    pub fn of(mono: &[f32], sr: f32) -> Pitch {
        // Down to 22–32 kHz. The search costs the square of the longest
        // period, and nothing above 2 kHz is looked for, so the extra rate buys
        // only time. Averaging each group is the anti-alias filter: crude, but
        // what it lets through is far above any fundamental searched for.
        let q = ((sr / 24_000.0).round() as usize).max(1);
        let rate = sr / q as f32;
        let x: Vec<f32> = mono.chunks_exact(q).map(|c| c.iter().sum::<f32>() / q as f32).collect();

        let tau_min = ((rate / MAX_HZ).floor() as usize).max(2);
        let tau_max = (rate / MIN_HZ).ceil() as usize;
        let window = tau_max.max(1024);
        let span = window + tau_max + 2;
        if x.len() < span {
            return Pitch::default();
        }

        // Frames spread evenly, so a sound that changes is sampled throughout
        // rather than only where it begins.
        let room = x.len() - span;
        let count = (room / (window / 2) + 1).min(MAX_FRAMES);
        let starts: Vec<usize> = (0..count)
            .map(|i| if count > 1 { room * i / (count - 1) } else { 0 })
            .collect();

        let rms = |s: usize| (x[s..s + window].iter().map(|v| v * v).sum::<f32>() / window as f32).sqrt();
        let levels: Vec<f32> = starts.iter().map(|&s| rms(s)).collect();
        let loudest = levels.iter().cloned().fold(0.0, f32::max);
        // Silence and a tail ten times quieter than the body say nothing about
        // the note. Relative, so a quiet recording is measured as well as a
        // loud one.
        if loudest < 1e-5 {
            return Pitch::default();
        }

        let mut clarity = Vec::new();
        let mut voiced = Vec::new();
        let mut d = vec![0f32; tau_max + 2];
        for (&s, &level) in starts.iter().zip(&levels) {
            if level < loudest * 0.1 {
                continue;
            }
            let (hz, c) = frame(&x[s..s + span], window, tau_min, tau_max, rate, &mut d);
            clarity.push(c);
            if c >= 1.0 - THRESHOLD {
                voiced.push(hz);
            }
        }
        if clarity.is_empty() {
            return Pitch::default();
        }

        // Most of what was heard must agree that there is a note. A sound that
        // is tonal for one frame in eight is a drum with a ring, not a note.
        let heard = clarity.len();
        let clarity = median(&mut clarity);
        if voiced.len() * 2 < heard {
            return Pitch { hz: 0.0, clarity };
        }
        Pitch { hz: median(&mut voiced), clarity }
    }
}

/// One frame: the period it repeats at, as Hz, and how cleanly.
fn frame(x: &[f32], window: usize, tau_min: usize, tau_max: usize, rate: f32, d: &mut [f32]) -> (f32, f32) {
    // The cumulative-mean-normalised difference. d[0] is 1 by definition,
    // which is what keeps a delay of nothing from being a perfect match.
    d[0] = 1.0;
    let mut running = 0.0;
    for tau in 1..=tau_max + 1 {
        let mut sum = 0.0;
        for j in 0..window {
            let diff = x[j] - x[j + tau];
            sum += diff * diff;
        }
        running += sum;
        d[tau] = if running > 0.0 { sum * tau as f32 / running } else { 1.0 };
    }

    // The first dip under the threshold, followed down to its floor.
    let mut best = None;
    let mut tau = tau_min;
    while tau <= tau_max {
        if d[tau] < THRESHOLD {
            while tau < tau_max && d[tau + 1] < d[tau] {
                tau += 1;
            }
            best = Some(tau);
            break;
        }
        tau += 1;
    }
    // None under the threshold: the deepest dip still says how periodic the
    // frame is, even though it is not trusted as a note.
    let tau = best.unwrap_or_else(|| {
        (tau_min..=tau_max).min_by(|a, b| d[*a].total_cmp(&d[*b])).unwrap_or(tau_min)
    });

    // A parabola through the dip and its neighbours puts the period between
    // samples. Without it a high note is quantised to whole samples, which at
    // 24 kHz is a third of a semitone near 1.7 kHz.
    let (a, b, c) = (d[tau - 1], d[tau], d[tau + 1]);
    let bend = a - 2.0 * b + c;
    let shift = if bend.abs() > 1e-9 { (0.5 * (a - c) / bend).clamp(-0.5, 0.5) } else { 0.0 };
    let period = tau as f32 + shift;

    (rate / period, (1.0 - b).clamp(0.0, 1.0))
}

fn median(v: &mut [f32]) -> f32 {
    v.sort_by(f32::total_cmp);
    let n = v.len();
    if n % 2 == 1 { v[n / 2] } else { (v[n / 2 - 1] + v[n / 2]) * 0.5 }
}
