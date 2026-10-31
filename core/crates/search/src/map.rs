//! Where each sound goes in the 3D map, and how it is drawn.
//!
//! Two layouts of the same objects, both inside the unit cube so the interface
//! only has to scale them:
//!
//! * **axes**, which mean something you can say out loud. Up is higher, right
//!   is noisier, further away is longer. See `docs/SOUND-MAP.md`.
//! * **islands**, which do not. Sounds that sound alike sit together, by the
//!   same distance "find similar" ranks with, whatever their axes say.
//!
//! Every axis is a rank within the library rather than a raw value. A raw
//! value bunches: loudness spans a tenth of its range here, and most of a
//! library is the same length give or take. Ranked, the world fills.
//!
//! Nothing here knows about Babylon, `wgpu` or a screen. The renderer is told
//! where things are and what they look like, and can be replaced without
//! touching a rule.

use crate::{Fingerprint, DIMS, NAMES};

/// One sound, placed and styled.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Placed {
    /// x: tonal to noisy. y: low to high. z: short to long. Each 0..1.
    pub axes: [f32; 3],
    /// The similarity layout, 0..1 on each side, the middle at 0.5.
    pub islands: [f32; 3],
    /// 0..1, from loudness.
    pub size: f32,
    /// 0..1: how rough its surface is, from how noisy it is.
    pub rough: f32,
    /// 0..1: a crisp edge for a sharp, punchy start; soft for a swell.
    pub crisp: f32,
    /// How often it throbs, in hits a second. 0 for a sound that does not
    /// repeat, which is drawn still.
    pub pulse_hz: f32,
    /// Has a note. Drawn as a solid; the rest as grain.
    pub pitched: bool,
}

/// Above this the envelope repeats steadily enough to call it a pulse.
const PULSE: f32 = 0.5;

/// The densest the fingerprint measures, in onsets a second.
const DENSITY_MAX: f32 = 12.0;

/// Past this many sounds the islands are the projection alone. Refining them
/// compares every pair, which at ten thousand sounds is too slow to wait for.
const REFINE_MAX: usize = 3_000;

fn dim(name: &str) -> usize {
    NAMES.iter().position(|n| *n == name).expect("a fingerprint dimension")
}

/// Place every sound. The order of the result is the order given.
pub fn place(prints: &[Fingerprint]) -> Vec<Placed> {
    let n = prints.len();
    if n == 0 {
        return Vec::new();
    }
    let col = |name: &str| -> Vec<f32> { prints.iter().map(|p| p.v[dim(name)]).collect() };

    // Height: each kind ranked within itself, so the lowest note and the
    // darkest drum share the floor. A note's height in Hz and a drum's
    // spectral centre are thousands apart, and only one sound in seven in a
    // real library has a note at all.
    let pitched: Vec<bool> = prints.iter().map(|p| p.pitch.hz > 0.0).collect();
    let register: Vec<f32> = prints
        .iter()
        .zip(&pitched)
        .map(|(p, &has)| if has { p.pitch.hz.ln() } else { p.v[dim("brightness")] })
        .collect();
    let mut height = vec![0.5; n];
    for kind in [true, false] {
        let members: Vec<usize> = (0..n).filter(|i| pitched[*i] == kind).collect();
        let ranks = ranks(&members.iter().map(|i| register[*i]).collect::<Vec<_>>());
        for (i, r) in members.iter().zip(ranks) {
            height[*i] = r;
        }
    }

    // Left to right: a held note to hiss. Clarity says how periodic it is;
    // flatness how evenly its energy is spread. Either alone mistakes a chord
    // or a filtered noise for the other.
    let noise: Vec<f32> = prints
        .iter()
        .map(|p| 0.5 * (1.0 - p.pitch.clarity) + 0.5 * p.v[dim("flatness")])
        .collect();
    let across = ranks(&noise);
    let depth = ranks(&col("duration"));
    let size = ranks(&col("loudness"));
    let rough = ranks(&noise);
    let (attack, crest) = (ranks(&col("attack")), ranks(&col("crest")));
    let islands = islands(prints);

    (0..n)
        .map(|i| {
            let p = &prints[i];
            let repeats = p.v[dim("pulse")] > PULSE;
            Placed {
                axes: [across[i], height[i], depth[i]],
                islands: islands[i],
                size: size[i],
                rough: rough[i],
                crisp: 0.5 * (1.0 - attack[i]) + 0.5 * crest[i],
                pulse_hz: if repeats { p.v[dim("density")] * DENSITY_MAX } else { 0.0 },
                pitched: pitched[i],
            }
        })
        .collect()
}

/// Each value's place among the others, 0..1, ties in the middle of their run.
/// One value alone sits at 0.5.
fn ranks(values: &[f32]) -> Vec<f32> {
    let n = values.len();
    if n <= 1 {
        return vec![0.5; n];
    }
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by(|a, b| values[*a].total_cmp(&values[*b]));
    let mut out = vec![0.0; n];
    let mut i = 0;
    while i < n {
        let mut j = i;
        while j + 1 < n && values[order[j + 1]] == values[order[i]] {
            j += 1;
        }
        // Positions i..=j share a value: all of them get the middle of the run.
        let r = (i + j) as f32 * 0.5 / (n - 1) as f32;
        for k in i..=j {
            out[order[k]] = r;
        }
        i = j + 1;
    }
    out
}

/// The similarity layout.
///
/// Twelve dimensions cannot be drawn, so they are flattened to three. First by
/// their three main directions, which keeps as much of the spread as any flat
/// view can; then each sound is moved, a little at a time, until the distances
/// on screen match the distances "find similar" measures as well as three
/// dimensions allow (SMACOF stress majorisation). The first step alone keeps
/// the big picture but squashes small islands into their neighbours; the
/// second pulls them apart.
fn islands(prints: &[Fingerprint]) -> Vec<[f32; 3]> {
    let n = prints.len();
    let mean: Vec<f64> = (0..DIMS)
        .map(|d| prints.iter().map(|p| p.v[d] as f64).sum::<f64>() / n as f64)
        .collect();
    let centred: Vec<[f64; DIMS]> = prints
        .iter()
        .map(|p| std::array::from_fn(|d| p.v[d] as f64 - mean[d]))
        .collect();

    let axes = principal_axes(&centred);
    let mut x: Vec<[f64; 3]> = centred
        .iter()
        .map(|c| std::array::from_fn(|k| (0..DIMS).map(|d| c[d] * axes[k][d]).sum()))
        .collect();

    if n > 2 && n <= REFINE_MAX {
        let target = |i: usize, j: usize| prints[i].distance(&prints[j]) as f64;
        for _ in 0..60 {
            x = guttman(&x, &target);
        }
    }

    // Into the unit cube, the same scale on every side so the shape is not
    // stretched. Centred on the median and sized by where nine sounds in ten
    // fall, not by the furthest: scaled to the extremes, one odd file squeezed
    // the whole of a real library into a clump a sixth of the world wide. The
    // few beyond are held at the edge.
    let mid: [f64; 3] = std::array::from_fn(|k| {
        let mut c: Vec<f64> = x.iter().map(|p| p[k]).collect();
        c.sort_by(f64::total_cmp);
        c[c.len() / 2]
    });
    let mut out: Vec<f64> = x.iter().flat_map(|p| (0..3).map(move |k| (p[k] - mid[k]).abs())).collect();
    out.sort_by(f64::total_cmp);
    let reach = out[((out.len() - 1) as f64 * 0.9) as usize];
    x.iter()
        .map(|p| {
            std::array::from_fn(|k| {
                if reach > 1e-12 { (0.5 + 0.5 * (p[k] - mid[k]) / reach).clamp(0.0, 1.0) as f32 } else { 0.5 }
            })
        })
        .collect()
}

/// The three directions the sounds spread furthest along, by power iteration
/// on their covariance. Deterministic: it starts from the same vector every
/// time, so the map does not turn itself inside out between visits.
fn principal_axes(centred: &[[f64; DIMS]]) -> [[f64; DIMS]; 3] {
    let mut cov = [[0.0; DIMS]; DIMS];
    for c in centred {
        for a in 0..DIMS {
            for b in 0..DIMS {
                cov[a][b] += c[a] * c[b];
            }
        }
    }
    let mut found: Vec<[f64; DIMS]> = Vec::new();
    for k in 0..3 {
        let mut v: [f64; DIMS] = std::array::from_fn(|d| if d == k { 1.0 } else { 0.1 });
        for _ in 0..200 {
            let mut w: [f64; DIMS] = std::array::from_fn(|a| (0..DIMS).map(|b| cov[a][b] * v[b]).sum());
            // Keep it apart from the directions already taken.
            for f in &found {
                let dot: f64 = (0..DIMS).map(|d| w[d] * f[d]).sum();
                for d in 0..DIMS {
                    w[d] -= dot * f[d];
                }
            }
            let len = w.iter().map(|x| x * x).sum::<f64>().sqrt();
            if len < 1e-12 {
                break;
            }
            v = w.map(|x| x / len);
        }
        found.push(v);
    }
    [found[0], found[1], found[2]]
}

/// One step of SMACOF: every point moves to where its target distances say it
/// should be, given where everything else is now. Each step can only lower the
/// mismatch, so a fixed number of them is safe.
fn guttman(x: &[[f64; 3]], target: &dyn Fn(usize, usize) -> f64) -> Vec<[f64; 3]> {
    let n = x.len();
    let mut out = vec![[0.0; 3]; n];
    for i in 0..n {
        let mut acc = [0.0; 3];
        let mut diag = 0.0;
        for j in 0..n {
            if i == j {
                continue;
            }
            let d = (0..3).map(|k| (x[i][k] - x[j][k]).powi(2)).sum::<f64>().sqrt();
            let b = if d > 1e-12 { target(i, j) / d } else { 0.0 };
            diag += b;
            for k in 0..3 {
                acc[k] -= b * x[j][k];
            }
        }
        for k in 0..3 {
            out[i][k] = (acc[k] + diag * x[i][k]) / n as f64;
        }
    }
    out
}

/// Which family an AudioSet label belongs to, for colour.
///
/// Seven families, because colour can only carry a handful before two of them
/// look the same. Machines are checked first, so a vehicle horn is a machine
/// and not a brass instrument; instruments before music, so "Musical
/// instrument" is an instrument.
pub fn family(label: &str) -> &'static str {
    let l = label.to_lowercase();
    if l.trim().is_empty() {
        return "unknown";
    }
    let any = |words: &[&str]| words.iter().any(|w| l.contains(w));
    if any(&[
        "vehicle", "train", "engine", "car ", "siren", "tools", "mechani", "sonar", "radio", "motor",
        "aircraft", "alarm", "beep", "buzzer", "static", "telephone", "printer", "drill", "hum", "clock",
        "tick", "machine gun", "boat", "helicopter", "power tool",
    ]) {
        return "machine";
    }
    if any(&[
        "drum", "snare", "hi-hat", "cymbal", "percussion", "clap", "tabla", "cowbell", "tambourine",
        "gong", "rimshot", "wood block", "maraca", "shaker",
    ]) {
        return "percussion";
    }
    if any(&[
        "speech", "chant", "sing", "voice", "vocal", "choir", "conversation", "narration", "whisper",
        "shout", "yell", "laugh", "babbl", "rapping", "humming", "mantra", "yodel", "child", "male",
        "female", "crying", "scream",
    ]) {
        return "voice";
    }
    if any(&[
        "instrument", "synth", "piano", "keyboard", "organ", "guitar", "string", "violin", "flute",
        "trumpet", "brass", "plucked", "sine wave", "harp", "bell", "glockenspiel", "marimba", "sampler",
        "saxophone", "clarinet", "cello", "harmonica", "accordion", "sitar", "mallet", "bass",
    ]) {
        return "instrument";
    }
    if any(&["music", "song", "jingle", "techno", "house", "ambient", "hip hop", "dub", "electronica"]) {
        return "music";
    }
    if any(&[
        "rain", "water", "wind", "thunder", "bird", "animal", "dog", "cat", "insect", "heart", "breath",
        "ocean", "stream", "fire", "frog", "wave", "rustl",
    ]) {
        return "nature";
    }
    "other"
}
