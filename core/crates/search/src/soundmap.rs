//! The sound map: every sound a dot, placed so that sounds the model hears as
//! alike sit together, grouped into the clusters that forms, each cluster
//! named for what its sounds were heard as.
//!
//! What it is laid out by is YAMNet's fingerprint of each sound — the 1,024
//! numbers its last layer describes the audio with (`yamnet::embed`). The
//! twelve measurements in `Fingerprint` were tried first and are too coarse:
//! they say how long, loud and bright a sound is, not what it is, and a map of
//! them is one undifferentiated blob. Sample maps that work (XO, Atlas,
//! AudioStellar, the Infinite Drum Machine) are all built on fingerprints of
//! this kind, flattened to two dimensions the same way, by t-SNE.
//!
//! Nothing here knows about a screen. Positions are in a unit square; the
//! interface scales them, draws them, and plays what is under the pointer.

/// YAMNet's fingerprint of a sound, a byte a number against its own largest
/// value — how `yamnet::embed` keeps it. Eighty thousand of them are 80 MB
/// this way and 330 MB as floats, and similarity moves in the third decimal.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Embedding {
    pub scale: f32,
    pub bytes: Vec<u8>,
}

impl Embedding {
    pub fn from_values(v: &[f32]) -> Embedding {
        let scale = v.iter().fold(0.0f32, |a, b| a.max(*b));
        let bytes = v.iter().map(|x| if scale > 0.0 { (x.max(0.0) / scale * 255.0).round() as u8 } else { 0 }).collect();
        Embedding { scale, bytes }
    }

    pub fn values(&self) -> Vec<f32> {
        self.bytes.iter().map(|b| *b as f32 / 255.0 * self.scale).collect()
    }

    pub fn is_empty(&self) -> bool {
        self.bytes.is_empty()
    }
}

/// One sound, as much of it as the map needs.
#[derive(Debug, Clone, Default)]
pub struct Input {
    /// YAMNet's fingerprint; None until the sound has been listened to.
    pub embedding: Option<Embedding>,
    /// What it was heard as, best first.
    pub heard: Vec<String>,
    /// Its family (`map::family`).
    pub family: String,
    /// The plain words for how it sounds (bright, bassy, short…), for telling
    /// apart two clusters heard as the same thing.
    pub words: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Point {
    /// Where it goes, 0..1 each way; None until it has been listened to.
    pub at: Option<[f32; 2]>,
    /// The cluster it belongs to, if any; a stray between clusters has none.
    pub cluster: Option<usize>,
    /// Its closest matches by fingerprint, best first. Worked out up front
    /// for a small library; for a large one, ask [`SoundMap::nearest`].
    pub near: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Cluster {
    /// What most of its sounds were heard as, made unique among the clusters.
    pub name: String,
    /// The family most of its sounds are in.
    pub family: String,
    pub members: Vec<usize>,
    /// Its middle, in the same unit square.
    pub centre: [f32; 2],
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SoundMap {
    pub points: Vec<Point>,
    pub clusters: Vec<Cluster>,
    /// Every placed sound's fingerprint, shortened to `width` numbers, for
    /// finding a sound's matches when it is asked for. Indexed through `row`.
    reduced: Vec<f32>,
    width: usize,
    row: Vec<Option<usize>>,
}

impl SoundMap {
    /// Sound `i`'s `k` closest matches, best first.
    pub fn nearest(&self, i: usize, k: usize) -> Vec<usize> {
        let Some(p) = self.points.get(i) else { return vec![] };
        if !p.near.is_empty() || self.width == 0 {
            return p.near.iter().take(k).copied().collect();
        }
        let Some(Some(r)) = self.row.get(i) else { return vec![] };
        let w = self.width;
        let me = &self.reduced[r * w..(r + 1) * w];
        let mut best: Vec<(f32, usize)> = Vec::with_capacity(k + 1);
        for (j, row) in self.row.iter().enumerate() {
            let Some(rj) = row else { continue };
            if j == i {
                continue;
            }
            let d = sq(me, &self.reduced[rj * w..(rj + 1) * w]);
            if best.len() < k || d < best[best.len() - 1].0 {
                let at = best.partition_point(|x| x.0 <= d);
                best.insert(at, (d, j));
                best.truncate(k);
            }
        }
        best.into_iter().map(|(_, j)| j).collect()
    }
}

/// Closest matches kept per sound.
pub const NEAR: usize = 6;
/// How many neighbours t-SNE pays attention to. 30 is the usual; a small
/// library gets less so its clusters still form.
const PERPLEXITY: f32 = 30.0;
const ITERATIONS: usize = 750;
/// The fewest sounds that make a cluster.
const MIN_CLUSTER: usize = 4;
/// Up to this many sounds are laid out exactly, every pair compared. Past it
/// (a whole library of tens of thousands would need tens of gigabytes for
/// that), this many landmarks are laid out exactly and every other sound is
/// placed among the landmarks it is most like.
pub const EXACT_MAX: usize = 2000;
/// How many numbers a fingerprint is shortened to for a large library: its
/// main directions of difference, found from the landmarks.
const REDUCED: usize = 64;

pub fn build(inputs: &[Input]) -> SoundMap {
    build_with(inputs, EXACT_MAX)
}

/// [`build`], with the exact limit given: so the large-library path can be
/// tested on a small library.
pub fn build_with(inputs: &[Input], exact_max: usize) -> SoundMap {
    let heard: Vec<usize> = (0..inputs.len())
        .filter(|&i| inputs[i].embedding.as_ref().is_some_and(|e| !e.is_empty()))
        .collect();
    let mut map = SoundMap {
        points: vec![Point { at: None, cluster: None, near: vec![] }; inputs.len()],
        clusters: vec![],
        reduced: vec![],
        width: 0,
        row: vec![None; inputs.len()],
    };
    if heard.is_empty() {
        return map;
    }
    let exact = heard.len() <= exact_max.max(2);

    // The sounds laid out exactly: all of them, or landmarks drawn by a fixed
    // shuffle. Not every n-th: a library is in folder order, and a stride can
    // fall in step with it and pick one kind of sound only.
    let marks: Vec<usize> = if exact {
        heard.clone()
    } else {
        let mix = |i: usize| {
            let mut z = (i as u64).wrapping_add(0x9e3779b97f4a7c15);
            z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
            z ^ (z >> 31)
        };
        let mut by: Vec<usize> = heard.clone();
        by.sort_by_key(|&i| mix(i));
        by.truncate(exact_max);
        by.sort_unstable();
        by
    };
    let full: Vec<Vec<f32>> = marks.iter().map(|&i| prepare(&inputs[i].embedding.as_ref().unwrap().values())).collect();

    // Every sound in the space the matching is done in: the full fingerprint
    // for a small library, its main directions for a large one.
    let (space, width): (Vec<f32>, usize) = if exact {
        let w = full[0].len();
        (full.iter().flatten().copied().collect(), w)
    } else {
        let basis = principal(&full, REDUCED);
        let w = basis.dirs.len();
        let rows = parallel_map(&heard, |&i| basis.project(&prepare(&inputs[i].embedding.as_ref().unwrap().values())));
        (rows.into_iter().flatten().collect(), w)
    };
    for (r, &i) in heard.iter().enumerate() {
        map.row[i] = Some(r);
    }
    let vec_of = |i: usize| -> &[f32] {
        let r = map.row[i].unwrap();
        &space[r * width..(r + 1) * width]
    };

    let m = marks.len();
    let mark_vecs: Vec<&[f32]> = marks.iter().map(|&i| vec_of(i)).collect();
    let mut d = vec![0.0f32; m * m];
    for a in 0..m {
        for b in a + 1..m {
            let v = sq(mark_vecs[a], mark_vecs[b]);
            d[a * m + b] = v;
            d[b * m + a] = v;
        }
    }
    if exact {
        for (a, &i) in marks.iter().enumerate() {
            let mut row: Vec<(usize, f32)> = (0..m).filter(|&b| b != a).map(|b| (b, d[a * m + b])).collect();
            row.sort_by(|p, q| p.1.total_cmp(&q.1).then(p.0.cmp(&q.0)));
            map.points[i].near = row.iter().take(NEAR).map(|(b, _)| marks[*b]).collect();
        }
    }

    let y = tsne(&d, m);
    let at_marks = unit(&y);
    let groups = clusters(&at_marks);
    let mut cluster_of_mark = vec![None; m];
    for (c, g) in groups.iter().enumerate() {
        for &a in g {
            cluster_of_mark[a] = Some(c);
        }
    }
    for (a, &i) in marks.iter().enumerate() {
        map.points[i].at = Some(at_marks[a]);
        map.points[i].cluster = cluster_of_mark[a];
    }

    if !exact {
        // Everything else among the landmarks it is most like: the weighted
        // middle of its three nearest, nudged by a fixed amount of its own so
        // no two sounds land on one spot, and the nearest one's cluster.
        let is_mark: std::collections::HashSet<usize> = marks.iter().copied().collect();
        let rest: Vec<usize> = heard.iter().copied().filter(|i| !is_mark.contains(i)).collect();
        let placed = parallel_map(&rest, |&i| {
            let me = vec_of(i);
            let mut best: Vec<(f32, usize)> = Vec::with_capacity(4);
            for (a, v) in mark_vecs.iter().enumerate() {
                let dd = sq(me, v);
                if best.len() < 3 || dd < best[best.len() - 1].0 {
                    let at = best.partition_point(|x| x.0 <= dd);
                    best.insert(at, (dd, a));
                    best.truncate(3);
                }
            }
            let (mut x, mut y, mut wsum) = (0.0f32, 0.0f32, 0.0f32);
            for &(dd, a) in &best {
                let w = 1.0 / (dd + 1e-4);
                x += at_marks[a][0] * w;
                y += at_marks[a][1] * w;
                wsum += w;
            }
            let h = (i as u64).wrapping_mul(0x9e3779b97f4a7c15);
            let jx = ((h >> 40) as f32 / (1u64 << 24) as f32 - 0.5) * 0.006;
            let jy = (((h >> 16) & 0xff_ffff) as f32 / (1u64 << 24) as f32 - 0.5) * 0.006;
            ([(x / wsum + jx).clamp(0.0, 1.0), (y / wsum + jy).clamp(0.0, 1.0)], cluster_of_mark[best[0].1])
        });
        for (&i, (at, c)) in rest.iter().zip(placed) {
            map.points[i].at = Some(at);
            map.points[i].cluster = c;
        }
        map.reduced = space;
        map.width = width;
    }

    let mut clusters_out: Vec<Cluster> = (0..groups.len())
        .map(|_| Cluster { name: String::new(), family: String::new(), members: vec![], centre: [0.0, 0.0] })
        .collect();
    for (i, p) in map.points.iter().enumerate() {
        if let (Some(c), Some(at)) = (p.cluster, p.at) {
            clusters_out[c].members.push(i);
            clusters_out[c].centre[0] += at[0];
            clusters_out[c].centre[1] += at[1];
        }
    }
    for c in &mut clusters_out {
        let k = c.members.len().max(1) as f32;
        c.centre = [c.centre[0] / k, c.centre[1] / k];
        c.family = majority_family(inputs, &c.members);
    }
    // Biggest first, so the order means something; points renumbered to match.
    let mut order: Vec<usize> = (0..clusters_out.len()).collect();
    order.sort_by(|&a, &b| clusters_out[b].members.len().cmp(&clusters_out[a].members.len()).then(clusters_out[a].members.cmp(&clusters_out[b].members)));
    let mut renum = vec![0; order.len()];
    for (new, &old) in order.iter().enumerate() {
        renum[old] = new;
    }
    for p in &mut map.points {
        p.cluster = p.cluster.map(|c| renum[c]);
    }
    let mut sorted: Vec<Cluster> = order.iter().map(|&o| clusters_out[o].clone()).collect();
    name(inputs, &mut sorted);
    map.clusters = sorted;
    map
}

fn sq(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(p, q)| (p - q) * (p - q)).sum()
}

/// `f` over `items` on every core, in order.
fn parallel_map<T: Sync, R: Send>(items: &[T], f: impl Fn(&T) -> R + Sync) -> Vec<R> {
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(1, 16);
    let chunk = items.len().div_ceil(threads).max(1);
    std::thread::scope(|s| {
        let handles: Vec<_> = items.chunks(chunk).map(|c| s.spawn(|| c.iter().map(&f).collect::<Vec<R>>())).collect();
        handles.into_iter().flat_map(|h| h.join().unwrap()).collect()
    })
}

/// The main directions fingerprints differ along, found from a sample of
/// them by repeatedly multiplying a block of directions by the sample's
/// covariance and straightening them out again (subspace iteration).
struct Basis {
    mean: Vec<f32>,
    dirs: Vec<Vec<f32>>,
}

impl Basis {
    fn project(&self, v: &[f32]) -> Vec<f32> {
        let c: Vec<f32> = v.iter().zip(&self.mean).map(|(a, m)| a - m).collect();
        self.dirs.iter().map(|d| d.iter().zip(&c).map(|(p, q)| p * q).sum()).collect()
    }
}

fn principal(sample: &[Vec<f32>], k: usize) -> Basis {
    let n = sample.len();
    let dim = sample[0].len();
    let mut mean = vec![0.0f32; dim];
    for v in sample {
        for (m, x) in mean.iter_mut().zip(v) {
            *m += x / n as f32;
        }
    }
    let centred: Vec<Vec<f32>> = sample.iter().map(|v| v.iter().zip(&mean).map(|(x, m)| x - m).collect()).collect();
    let k = k.min(dim).min(n);
    let mut rng = Lcg(0xba515);
    let mut dirs: Vec<Vec<f32>> = (0..k).map(|_| (0..dim).map(|_| rng.next() - 0.5).collect()).collect();
    orthonormalise(&mut dirs);
    for _ in 0..12 {
        // C·q = Σ x (x·q): never forming the covariance itself.
        let next = parallel_map(&dirs, |q| {
            let mut out = vec![0.0f32; dim];
            for x in &centred {
                let dot: f32 = x.iter().zip(q).map(|(a, b)| a * b).sum();
                for (o, a) in out.iter_mut().zip(x) {
                    *o += dot * a;
                }
            }
            out
        });
        dirs = next;
        orthonormalise(&mut dirs);
    }
    Basis { mean, dirs }
}

fn orthonormalise(v: &mut [Vec<f32>]) {
    for i in 0..v.len() {
        for j in 0..i {
            let dot: f32 = v[i].iter().zip(&v[j]).map(|(a, b)| a * b).sum();
            let (head, tail) = v.split_at_mut(i);
            for (a, b) in tail[0].iter_mut().zip(&head[j]) {
                *a -= dot * b;
            }
        }
        let len = v[i].iter().map(|a| a * a).sum::<f32>().sqrt();
        if len > 1e-12 {
            for a in &mut v[i] {
                *a /= len;
            }
        }
    }
}

/// Square-rooted, then scaled to length one. The model's values are
/// non-negative and heavy-tailed — a few dimensions shout — and the root lets
/// the quieter ones have a say; unit length makes distance the angle between
/// two fingerprints, which is what "alike" means for them.
fn prepare(e: &[f32]) -> Vec<f32> {
    let r: Vec<f32> = e.iter().map(|v| v.max(0.0).sqrt()).collect();
    let len = r.iter().map(|v| v * v).sum::<f32>().sqrt();
    if len > 0.0 { r.iter().map(|v| v / len).collect() } else { r }
}

/// A fixed sequence, so the same library makes the same map every time.
struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> f32 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((self.0 >> 33) as f32) / (1u64 << 31) as f32
    }
}

/// Exact t-SNE (van der Maaten and Hinton, 2008): similarities in the
/// fingerprint space become probabilities, and points in the plane are moved
/// until their own similarities match. Every pair is compared each step,
/// which is quick for a few thousand sounds.
fn tsne(d: &[f32], n: usize) -> Vec<[f32; 2]> {
    if n == 1 {
        return vec![[0.0, 0.0]];
    }
    let perp = PERPLEXITY.min((n as f32 - 1.0) / 3.0).max(1.5);
    let target = perp.ln();
    let mut p = vec![0.0f32; n * n];
    for i in 0..n {
        let row = &d[i * n..(i + 1) * n];
        let (mut lo, mut hi, mut beta) = (0.0f32, f32::INFINITY, 1.0f32);
        // The row's nearest distance is subtracted before the exponent, so a
        // very tight cluster cannot underflow every weight to zero.
        let dmin = row.iter().enumerate().filter(|(j, _)| *j != i).map(|(_, v)| *v).fold(f32::INFINITY, f32::min);
        let mut w = vec![0.0f32; n];
        for _ in 0..64 {
            let mut sum = 0.0;
            for j in 0..n {
                w[j] = if j == i { 0.0 } else { (-(row[j] - dmin) * beta).exp() };
                sum += w[j];
            }
            let sum = sum.max(1e-12);
            let mut h = 0.0;
            for j in 0..n {
                let q = w[j] / sum;
                if q > 1e-12 {
                    h -= q * q.ln();
                }
            }
            let diff = h - target;
            if diff.abs() < 1e-4 {
                break;
            }
            if diff > 0.0 {
                lo = beta;
                beta = if hi.is_infinite() { beta * 2.0 } else { (beta + hi) / 2.0 };
            } else {
                hi = beta;
                beta = (beta + lo) / 2.0;
            }
        }
        let sum: f32 = w.iter().sum::<f32>().max(1e-12);
        for j in 0..n {
            p[i * n + j] = w[j] / sum;
        }
    }
    for i in 0..n {
        for j in i + 1..n {
            let v = ((p[i * n + j] + p[j * n + i]) / (2.0 * n as f32)).max(1e-12);
            p[i * n + j] = v;
            p[j * n + i] = v;
        }
    }

    let mut rng = Lcg(0x5eed);
    let mut y: Vec<[f32; 2]> = (0..n).map(|_| [(rng.next() - 0.5) * 1e-2, (rng.next() - 0.5) * 1e-2]).collect();
    let mut step = vec![[0.0f32; 2]; n];
    let mut gain = vec![[1.0f32; 2]; n];
    // The rate scikit-learn settled on: a fixed 200 throws a small library
    // apart instead of letting it settle.
    let rate = (n as f32 / 12.0 / 4.0).max(50.0);
    let rows: Vec<usize> = (0..n).collect();
    for it in 0..ITERATIONS {
        let exaggerate = if it < 250 { 12.0 } else { 1.0 };
        let momentum = if it < 250 { 0.5 } else { 0.8 };
        // Two passes over every pair, each spread over the cores: the
        // normalising sum first, then each point's pull and push. The pair
        // weights are worked out again in the second pass rather than kept,
        // which is cheaper than an n-by-n table at two thousand points.
        let yy = &y;
        let z: f32 = parallel_map(&rows, |&i| {
            let mut s = 0.0f32;
            for j in 0..n {
                if j != i {
                    let (dx, dy) = (yy[i][0] - yy[j][0], yy[i][1] - yy[j][1]);
                    s += 1.0 / (1.0 + dx * dx + dy * dy);
                }
            }
            s
        })
        .into_iter()
        .sum::<f32>()
        .max(1e-12);
        let pp = &p;
        let grads = parallel_map(&rows, |&i| {
            let (mut gx, mut gy) = (0.0f32, 0.0f32);
            for j in 0..n {
                if i == j {
                    continue;
                }
                let (dx, dy) = (yy[i][0] - yy[j][0], yy[i][1] - yy[j][1]);
                let v = 1.0 / (1.0 + dx * dx + dy * dy);
                let m = (exaggerate * pp[i * n + j] - v / z) * v;
                gx += m * dx;
                gy += m * dy;
            }
            [4.0 * gx, 4.0 * gy]
        });
        for i in 0..n {
            for c in 0..2 {
                let g = grads[i][c];
                gain[i][c] = if (g > 0.0) == (step[i][c] > 0.0) { (gain[i][c] * 0.8).max(0.01) } else { gain[i][c] + 0.2 };
                step[i][c] = momentum * step[i][c] - rate * gain[i][c] * g;
            }
        }
        for i in 0..n {
            y[i][0] += step[i][0];
            y[i][1] += step[i][1];
        }
        // Keep the whole centred, so nothing drifts.
        let (mx, my) = y.iter().fold((0.0, 0.0), |(a, b), v| (a + v[0], b + v[1]));
        for v in &mut y {
            v[0] -= mx / n as f32;
            v[1] -= my / n as f32;
        }
    }
    y
}

/// Into the unit square, the same scale both ways so the shape is kept, and
/// turned so its long side lies across. t-SNE's answer has no up or down of
/// its own, and a screen is wider than it is tall.
fn unit(y: &[[f32; 2]]) -> Vec<[f32; 2]> {
    let n = y.len().max(1) as f32;
    let (mx, my) = y.iter().fold((0.0, 0.0), |(a, b), v| (a + v[0] / n, b + v[1] / n));
    let (mut sxx, mut syy, mut sxy) = (0.0f32, 0.0f32, 0.0f32);
    for v in y {
        let (dx, dy) = (v[0] - mx, v[1] - my);
        sxx += dx * dx;
        syy += dy * dy;
        sxy += dx * dy;
    }
    let angle = 0.5 * (2.0 * sxy).atan2(sxx - syy);
    let (c, s) = (angle.cos(), angle.sin());
    let y: Vec<[f32; 2]> = y.iter().map(|v| {
        let (dx, dy) = (v[0] - mx, v[1] - my);
        [dx * c + dy * s, -dx * s + dy * c]
    }).collect();
    let (mut x0, mut y0, mut x1, mut y1) = (f32::INFINITY, f32::INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY);
    for v in &y {
        x0 = x0.min(v[0]);
        y0 = y0.min(v[1]);
        x1 = x1.max(v[0]);
        y1 = y1.max(v[1]);
    }
    let span = (x1 - x0).max(y1 - y0).max(1e-9);
    let (ox, oy) = ((1.0 - (x1 - x0) / span) / 2.0, (1.0 - (y1 - y0) / span) / 2.0);
    y.iter().map(|v| [ox + (v[0] - x0) / span, oy + (v[1] - y0) / span]).collect()
}

/// Clusters as they stand on the map: dots within reach of one another, by
/// density (DBSCAN). The reach is set from the map itself — the usual
/// distance to a dot's fourth neighbour — so it works whatever the library's
/// size. A stray near a cluster joins it; one far from all of
/// them belongs to none.
fn clusters(at: &[[f32; 2]]) -> Vec<Vec<usize>> {
    let n = at.len();
    if n < MIN_CLUSTER {
        return vec![];
    }
    let dist = |a: usize, b: usize| ((at[a][0] - at[b][0]).powi(2) + (at[a][1] - at[b][1]).powi(2)).sqrt();
    let mut fourth: Vec<f32> = (0..n)
        .map(|a| {
            let mut r: Vec<f32> = (0..n).filter(|&b| b != a).map(|b| dist(a, b)).collect();
            r.sort_by(f32::total_cmp);
            r[(MIN_CLUSTER - 1).min(r.len() - 1)]
        })
        .collect();
    fourth.sort_by(f32::total_cmp);
    // At 1.6 times this, a 900-sound library came out as one percussion
    // cluster of 272 and a music one of 161, with the piano and the chimes
    // inside it; at 0.8, 133 sounds belonged to nothing.
    let eps = fourth[n / 2];
    let near: Vec<Vec<usize>> = (0..n).map(|a| (0..n).filter(|&b| b != a && dist(a, b) <= eps).collect()).collect();

    let mut label: Vec<Option<usize>> = vec![None; n];
    let mut groups: Vec<Vec<usize>> = Vec::new();
    for a in 0..n {
        if label[a].is_some() || near[a].len() + 1 < MIN_CLUSTER {
            continue;
        }
        let c = groups.len();
        let mut members = vec![a];
        label[a] = Some(c);
        let mut queue = near[a].clone();
        while let Some(b) = queue.pop() {
            if label[b].is_some() {
                continue;
            }
            label[b] = Some(c);
            members.push(b);
            if near[b].len() + 1 >= MIN_CLUSTER {
                queue.extend(near[b].iter().filter(|x| label[**x].is_none()));
            }
        }
        groups.push(members);
    }
    for a in 0..n {
        if label[a].is_some() {
            continue;
        }
        let best = (0..n).filter(|&b| label[b].is_some()).min_by(|&p, &q| dist(a, p).total_cmp(&dist(a, q)));
        if let Some(b) = best {
            if dist(a, b) <= eps * 2.0 {
                let c = label[b].unwrap();
                groups[c].push(a);
            }
        }
    }
    for g in &mut groups {
        g.sort_unstable();
    }
    groups.retain(|g| g.len() >= MIN_CLUSTER);
    groups
}

fn majority_family(inputs: &[Input], members: &[usize]) -> String {
    let mut count: std::collections::BTreeMap<&str, usize> = Default::default();
    for &i in members {
        *count.entry(inputs[i].family.as_str()).or_default() += 1;
    }
    count.into_iter().fold((None, 0), |b, (f, c)| if c > b.1 { (Some(f), c) } else { b }).0.unwrap_or("unknown").to_string()
}

/// Each cluster after what its sounds were most often heard as. Two clusters
/// that would share a name are told apart by the next most common thing in
/// each — another label, then a word for how they sound — and only failing
/// all of that, numbered. A cluster none of whose sounds was named is called
/// by its two commonest words.
fn name(inputs: &[Input], clusters: &mut [Cluster]) {
    let ranked: Vec<Vec<(String, usize)>> = clusters
        .iter()
        .map(|c| {
            let mut count: std::collections::BTreeMap<&str, usize> = Default::default();
            for &i in &c.members {
                // The best label counts double: it is what the sound is; the
                // others are what it is also like.
                for (k, l) in inputs[i].heard.iter().take(3).enumerate() {
                    *count.entry(l.as_str()).or_default() += if k == 0 { 2 } else { 1 };
                }
            }
            let mut v: Vec<(String, usize)> = count.into_iter().map(|(l, c)| (l.to_string(), c)).collect();
            v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
            v
        })
        .collect();
    let words: Vec<Vec<String>> = clusters
        .iter()
        .map(|c| {
            let mut count: std::collections::BTreeMap<&str, usize> = Default::default();
            for &i in &c.members {
                for w in &inputs[i].words {
                    *count.entry(w.as_str()).or_default() += 1;
                }
            }
            let mut v: Vec<(&str, usize)> = count.into_iter().collect();
            v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
            v.into_iter().map(|(w, _)| w.to_string()).collect()
        })
        .collect();
    for (c, r) in ranked.iter().enumerate() {
        clusters[c].name = match r.first() {
            Some(x) => x.0.clone(),
            None if !words[c].is_empty() => words[c].iter().take(2).cloned().collect::<Vec<_>>().join(", "),
            None => "Unnamed".to_string(),
        };
    }
    let mut seen: std::collections::HashMap<String, usize> = Default::default();
    for c in 0..clusters.len() {
        let base = clusters[c].name.clone();
        let taken = *seen.get(&base).unwrap_or(&0);
        if taken > 0 {
            let second = ranked[c]
                .iter()
                .skip(1)
                .map(|x| x.0.clone())
                .chain(words[c].iter().cloned())
                // Not a word the name already has: "bassy, dark · bassy".
                .filter(|l| !base.split(", ").any(|w| w == l))
                .find(|l| !clusters.iter().any(|o| o.name == format!("{base} · {l}")));
            clusters[c].name = match second {
                Some(l) => format!("{base} · {l}"),
                None => format!("{base} {}", taken + 1),
            };
        }
        *seen.entry(base).or_default() += 1;
    }
}
