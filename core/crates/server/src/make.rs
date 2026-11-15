//! The Make page's own ways, rendered here with MGL's engines (no model, no
//! GPU machine): Mutate (random walks through the shared effects), Texture
//! from (the Grain engine's cloud, offline), and Loop around (the picks in a
//! bar pattern from the songs' own drum analysis, with fills).
//!
//! Every way works on 44.1 kHz stereo and returns finished sounds; the route
//! writes them as tries. See docs/STEMS.md.

use songprint::sound::{self, Sound};

pub const RATE: u32 = 44_100;

/// A small, repeatable random source: the same seed makes the same tries.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ 0xD1B5_4A32_D192_ED03 | 1)
    }
    pub fn next(&mut self) -> u64 {
        // xorshift64*
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    /// 0..1
    pub fn f(&mut self) -> f32 {
        (self.next() >> 40) as f32 / (1u64 << 24) as f32
    }
    /// About normal, mean 0, spread 1 (sum of three uniforms).
    pub fn n(&mut self) -> f32 {
        (self.f() + self.f() + self.f() - 1.5) * 2.0
    }
    pub fn pick<'a, T>(&mut self, v: &'a [T]) -> &'a T {
        &v[(self.next() % v.len().max(1) as u64) as usize]
    }
}

/// Any sound as 44.1 kHz stereo.
pub fn stereo(s: &Sound) -> Sound {
    let s = if s.rate == RATE { Sound { rate: s.rate, channels: s.channels, x: s.x.clone() } } else { sound::resample(s, RATE) };
    let ch = s.channels.max(1);
    let x = match ch {
        2 => s.x,
        1 => s.x.iter().flat_map(|v| [*v, *v]).collect(),
        _ => s.x.chunks(ch).flat_map(|f| [f[0], f[1]]).collect(),
    };
    Sound { rate: RATE, channels: 2, x }
}

fn finish(mut s: Sound, peak_db: f32, fade_out_ms: f32) -> Sound {
    for v in &mut s.x {
        if !v.is_finite() {
            *v = 0.0;
        }
    }
    sound::clean(&s, &sound::Clean { trim_db: -70.0, fade_in_ms: 1.0, fade_out_ms, peak_db: Some(peak_db) })
}

// ------------------------------------------------------------------ mutate

/// The shared effects a mutation draws from: (id, family). "hp" are the
/// Hyperprism ones; "rack" the rest of MGL's own. Utilities (gain, EQ, the
/// dynamics, stereo matrices, noise generators) are left out: they move
/// little, or replace the sound rather than change it.
pub const MUTATORS: &[(&str, &str)] = &[
    ("hp-chorus", "hp"),
    ("hp-flanger", "hp"),
    ("hp-phaser", "hp"),
    ("hp-ring-modulator", "hp"),
    ("hp-frequency-modulator", "hp"),
    ("hp-pitch-shifter", "hp"),
    ("hp-sonic-decimator", "hp"),
    ("hp-comb-filter", "hp"),
    ("hp-band-pass", "hp"),
    ("hp-low-pass", "hp"),
    ("hp-high-pass", "hp"),
    ("hp-tremolo", "hp"),
    ("hp-vibrato", "hp"),
    ("hp-auto-pan", "hp"),
    ("hp-doppler", "hp"),
    ("hp-echo", "hp"),
    ("hp-echotranz", "hp"),
    ("hp-multi-delay", "hp"),
    ("hp-hall", "hp"),
    ("hp-medium-room", "hp"),
    ("echo", "rack"),
    ("boomerang", "rack"),
    ("decimator", "rack"),
    ("ring", "rack"),
    ("phaser", "rack"),
    ("flanger", "rack"),
    ("detune", "rack"),
    ("doubler", "rack"),
    ("harmonizer", "rack"),
    ("leslie", "rack"),
    ("white-chorus", "rack"),
    ("dattorro-plate", "rack"),
    ("dattorro-resonator", "rack"),
    ("lxp-plate", "rack"),
    ("lxp-hall", "rack"),
    ("sh-bubbler", "rack"),
    ("sh-chebyshev", "rack"),
    ("sh-flipper", "rack"),
    ("sh-pitchdelay", "rack"),
    ("rappify", "rack"),
];

/// One effect in a mutation, as a rack slot would store it.
pub struct Step {
    pub id: &'static str,
    pub params: Vec<(String, f32)>,
}

/// Run `steps` over `s`, with room for a tail of up to `tail` seconds.
pub fn run_chain(s: &Sound, steps: &[Step], tail: f32) -> Sound {
    let ch = s.channels.max(1);
    let mut x = s.x.clone();
    x.extend(std::iter::repeat(0.0).take((tail.max(0.0) * s.rate as f32) as usize * ch));
    for st in steps {
        let Some(mut e) = fx::prism::make(st.id, s.rate, ch, &st.params) else { continue };
        e.reset();
        for block in x.chunks_mut(1024 * ch) {
            e.process(block, ch, s.rate);
        }
    }
    Sound { rate: s.rate, channels: ch, x }
}

/// A chain of one to three effects, each control moved from its default by
/// up to `far` (0..1) of its travel.
pub fn mutation(rng: &mut Rng, far: f32, through: &str) -> Vec<Step> {
    let pool: Vec<&'static str> = MUTATORS
        .iter()
        .filter(|(id, fam)| (through == "both" || *fam == through) && fx::prism::specs(id).is_some())
        .map(|(id, _)| *id)
        .collect();
    if pool.is_empty() {
        return Vec::new();
    }
    let k = (1.0 + far * 2.0 + rng.f() * 0.99).floor().clamp(1.0, 3.0) as usize;
    let mut steps: Vec<Step> = Vec::new();
    while steps.len() < k {
        let id = *rng.pick(&pool);
        if steps.iter().any(|s| s.id == id) && pool.len() > k {
            continue;
        }
        let specs = fx::prism::specs(id).unwrap_or(&[]);
        let spread = 0.12 + 0.6 * far;
        let params = specs
            .iter()
            .map(|p| {
                // Housekeeping stays where it is: smoothing, the levels in and
                // out, the mix (the try is levelled after, and a mix of nothing
                // is no mutation).
                if housekeeping(p.key, p.label) {
                    return (p.key.to_string(), p.default);
                }
                // Short of the very ends, where a filter sits at 0 Hz or a
                // feedback runs away.
                let u = (p.to_unit(p.default) + rng.n() * spread).clamp(0.04, 0.96);
                let v = fx::prism::clamp(id, p.key, p.from_unit(u)).unwrap_or(p.default);
                (p.key.to_string(), v)
            })
            .collect();
        steps.push(Step { id, params });
    }
    steps
}

/// A control that keeps a sound tidy rather than changing it.
pub fn housekeeping(key: &str, label: &str) -> bool {
    let k = format!("{} {}", key.to_lowercase(), label.to_lowercase());
    ["smooth", "output", "gain", "level", "dry", "wet", "mix", "interp", "trim", "bypass", "quality", "oversampl"].iter().any(|w| k.contains(w))
}

/// What a chain is, in a few words: each effect's name and its two most moved controls.
pub fn describe(steps: &[Step]) -> String {
    steps
        .iter()
        .map(|st| {
            let specs = fx::prism::specs(st.id).unwrap_or(&[]);
            let mut moved: Vec<(f32, String)> = st
                .params
                .iter()
                .filter_map(|(k, v)| {
                    let p = specs.iter().find(|p| p.key == k && !housekeeping(p.key, p.label))?;
                    let d = (p.to_unit(*v) - p.to_unit(p.default)).abs();
                    let val = if v.abs() >= 100.0 { format!("{v:.0}") } else if v.abs() >= 10.0 { format!("{v:.1}") } else { format!("{v:.2}") };
                    Some((d, format!("{} {val}{}", p.label.to_lowercase(), p.unit)))
                })
                .collect();
            moved.sort_by(|a, b| b.0.total_cmp(&a.0));
            let name = fx::prism::descriptor(st.id).map(|d| d.label.to_string()).unwrap_or_else(|| st.id.to_string());
            let what: Vec<String> = moved.into_iter().take(2).map(|m| m.1).collect();
            if what.is_empty() { name } else { format!("{name} ({})", what.join(", ")) }
        })
        .collect::<Vec<_>>()
        .join(" → ")
}

/// `n` mutations of `s`. Each: (sound, words, the chain as rack slots).
pub fn mutate(s: &Sound, n: usize, far: f32, through: &str, peak_db: f32, seed: u64) -> Vec<(Sound, String, Vec<Step>)> {
    let src = stereo(s);
    let mut out = Vec::new();
    for i in 0..n {
        let mut rng = Rng::new(seed.wrapping_add(i as u64 * 7919));
        // A chain that goes silent or blows up is drawn again.
        for _ in 0..6 {
            let steps = mutation(&mut rng, far, through);
            let tail = 0.3 + 1.7 * far;
            let r = run_chain(&src, &steps, tail);
            let pk = r.x.iter().fold(0.0f32, |m, v| if v.is_finite() { m.max(v.abs()) } else { f32::INFINITY });
            if pk.is_finite() && pk > 1e-4 {
                let words = describe(&steps);
                out.push((finish(r, peak_db, 30.0), words, steps));
                break;
            }
        }
    }
    out
}

// ------------------------------------------------------------------ texture

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Shape {
    Pad,
    Drone,
    Riser,
}

impl Shape {
    pub fn from_str(s: &str) -> Option<Shape> {
        match s {
            "pad" => Some(Shape::Pad),
            "drone" => Some(Shape::Drone),
            "riser" => Some(Shape::Riser),
            _ => None,
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Shape::Pad => "pad",
            Shape::Drone => "drone",
            Shape::Riser => "riser",
        }
    }
}

pub struct Texture {
    pub seconds: f32,
    /// How many times slower the picks are read: 2 to 100.
    pub stretch: f32,
    /// 0..1: how many grains overlap, and how many layers of them.
    pub density: f32,
    /// 0..1: how much room it sits in.
    pub space: f32,
}

/// One texture from `s`. The Grain engine's cloud reads the sound `stretch`
/// times slower, with jitter and drift for life; then it is shaped (a pad
/// swells and fades, a drone sits an octave down, a riser speeds up an octave
/// into its end) and given a room.
pub fn texture(s: &Sound, shape: Shape, t: &Texture, seed: u64) -> Sound {
    let src = stereo(s);
    let frames = src.frames().max(1);
    let want = (t.seconds.clamp(1.0, 60.0) * RATE as f32) as usize;
    let stretch = t.stretch.clamp(1.5, 100.0);
    // Enough source for the length asked: the picks again, end to end, if the
    // stretch alone would not reach it (the offline render stops at 128x).
    let need = ((want as f32 / stretch).ceil() as usize + 1).max(1024);
    let mut base = Vec::with_capacity(need * 2);
    while base.len() / 2 < need {
        base.extend_from_slice(&src.x);
    }
    base.truncate(need.max(frames.min(need)) * 2);
    let mut rng = Rng::new(seed);
    let d = t.density.clamp(0.0, 1.0);
    let mut st = fx::Stretch::default();
    st.algorithm = fx::stretch::Algorithm::Granular;
    st.ratio = (want as f32 / (base.len() / 2) as f32).clamp(1.0, 120.0);
    st.window_ms = 60.0 + 240.0 * rng.f();
    st.semitones = if shape == Shape::Drone { -12.0 } else { 0.0 };
    st.grain.overlap = 2.0 + 6.0 * d;
    st.grain.layers = 1 + (3.0 * d).round() as u32;
    st.grain.layer_scatter = 0.5 * d;
    st.grain.size_jitter = 0.2 + 0.4 * rng.f();
    st.grain.position_jitter_ms = 20.0 + 200.0 * rng.f();
    st.grain.pitch_jitter_semis = 0.05 + 0.2 * rng.f();
    st.grain.pitch_drift_semis = 0.1 + 0.4 * rng.f();
    st.grain.drift_rate_hz = 0.05 + 0.3 * rng.f();
    st.grain.seed = (seed % 1_000_000) as u32 + 1;
    let auto = crate::automation::Automation::default();
    let mut x = crate::offline::stretch_with_automation(&base, 2, RATE, &st, &auto);
    x.truncate(want * 2);
    let mut out = Sound { rate: RATE, channels: 2, x };
    if shape == Shape::Riser {
        out = speed_up(&out, 1.0, 2.0);
    }
    // The shape in level.
    let n = out.frames().max(1);
    for (i, f) in out.x.chunks_mut(2).enumerate() {
        let u = i as f32 / n as f32;
        let g = match shape {
            Shape::Pad => (u / 0.2).min(1.0).powf(1.5) * ((1.0 - u) / 0.3).min(1.0),
            Shape::Drone => (u / 0.05).min(1.0) * ((1.0 - u) / 0.1).min(1.0),
            Shape::Riser => u.powf(2.0) * ((1.0 - u) / 0.01).min(1.0),
        };
        f[0] *= g;
        f[1] *= g;
    }
    // A room: a hall, mixed under.
    let sp = t.space.clamp(0.0, 1.0);
    if sp > 0.01 {
        let wet = run_chain(&out, &[Step { id: "lxp-hall", params: Vec::new() }], 0.0);
        let pd = out.peak().max(1e-6);
        let pw = wet.peak().max(1e-6);
        for (o, w) in out.x.iter_mut().zip(&wet.x) {
            *o = *o * (1.0 - 0.5 * sp) + w * (pd / pw) * sp;
        }
    }
    finish(out, -1.0, 200.0)
}

/// Read `s` at a speed going from `from` to `to` (2 is an octave up), so a
/// sound rises into its end. The length shrinks by the mean speed.
pub fn speed_up(s: &Sound, from: f32, to: f32) -> Sound {
    let ch = s.channels.max(1);
    let n = s.frames();
    let mut out = Vec::with_capacity(s.x.len());
    let mut pos = 0.0f64;
    while (pos as usize) + 1 < n {
        let u = pos as f32 / n as f32;
        let i = pos as usize;
        let fr = (pos - i as f64) as f32;
        for c in 0..ch {
            out.push(s.x[i * ch + c] * (1.0 - fr) + s.x[(i + 1) * ch + c] * fr);
        }
        pos += (from + (to - from) * u) as f64;
    }
    Sound { rate: s.rate, channels: ch, x: out }
}

// ------------------------------------------------------------------ loop

/// A bar of drums: per step (16), velocity 0..1 for kick, snare, hat.
#[derive(Clone, Debug, PartialEq)]
pub struct Bar {
    pub rows: [[f32; 16]; 3],
}

impl Bar {
    /// From songprint's glyphs: `X` loud, `x` soft, `.` none.
    pub fn from_glyphs(kick: &str, snare: &str, hat: &str) -> Bar {
        let row = |s: &str| {
            let mut r = [0.0f32; 16];
            for (i, c) in s.chars().take(16).enumerate() {
                r[i] = match c {
                    'X' => 1.0,
                    'x' => 0.55,
                    _ => 0.0,
                };
            }
            r
        };
        Bar { rows: [row(kick), row(snare), row(hat)] }
    }
}

/// Bars to fall back on when no song is learnt from.
pub fn stock_bars() -> Vec<Bar> {
    vec![
        Bar::from_glyphs("X...X...X...X...", "....X.......X...", "..x...x...x...x."),
        Bar::from_glyphs("X.....x.X.......", "....X.......X..x", "x.x.x.x.x.x.x.x."),
        Bar::from_glyphs("X..x..X...X.....", "....X.......X...", "xxXxxxXxxxXxxxXx"),
        Bar::from_glyphs("X.........X.....", "........X.......", "..X...X...X...X."),
    ]
}

pub struct Loop {
    pub bpm: f32,
    pub bars: usize,
    /// 0..1: 0.5 plays the pattern as learnt; less leaves soft hits out, more adds ghosts.
    pub busy: f32,
    /// 0..1: how much of the last beat becomes a fill.
    pub fills: f32,
    /// 0.5 straight, up to 0.75: where the off 16ths land.
    pub swing: f32,
}

/// Which of the three roles (kick, snare, hat) each pick suits: low and
/// short is a kick, bright is a hat, the rest a snare. One pick plays all
/// three, moved in pitch; every role gets a sound.
pub fn roles(picks: &[Sound]) -> [(Sound, f32); 3] {
    let chars: Vec<sound::Character> = picks.iter().map(sound::character).collect();
    let score = |c: &sound::Character, r: usize| -> f32 {
        let low = c.pitch.map(|m| (60.0 - m) / 30.0).unwrap_or(0.0);
        let bright = (c.zcr / 4000.0).min(2.0);
        match r {
            0 => low - bright,
            1 => 0.5 - (bright - 0.8).abs() - low.abs() * 0.3,
            _ => bright - low * 0.5,
        }
    };
    let mut taken = vec![false; picks.len()];
    let mut out: Vec<Option<(usize, f32)>> = vec![None; 3];
    // Each role its best pick, kick first; picks are reused once all are used.
    for r in [0usize, 2, 1] {
        let free: Vec<usize> = (0..picks.len()).filter(|i| !taken[*i]).collect();
        let pool = if free.is_empty() { (0..picks.len()).collect() } else { free };
        if let Some(&best) = pool.iter().max_by(|a, b| score(&chars[**a], r).total_cmp(&score(&chars[**b], r))) {
            taken[best] = true;
            out[r] = Some((best, 0.0));
        }
    }
    // A pick playing a role it was not chosen for alone is moved to suit it.
    let used: Vec<usize> = out.iter().flatten().map(|o| o.0).collect();
    for r in 0..3 {
        if let Some((i, _)) = out[r] {
            if used.iter().filter(|u| **u == i).count() > 1 {
                out[r] = Some((i, [-7.0, 0.0, 12.0][r]));
            }
        }
    }
    let len = [0.6f32, 0.5, 0.18];
    let mk = |r: usize| {
        let (i, st) = out[r].unwrap_or((0, 0.0));
        let s = stereo(&picks[i]);
        let s = if st != 0.0 { sound::shift(&s, st) } else { s };
        let s = sound::until(&s, len[r]);
        let s = sound::clean(&s, &sound::Clean { trim_db: -60.0, fade_in_ms: 0.5, fade_out_ms: 15.0, peak_db: Some(-1.0) });
        (s, st)
    };
    [mk(0), mk(1), mk(2)]
}

/// The bars, as played: soft hits dropped or ghosts added for Busy, and a fill
/// at the end of the last bar for Fills.
pub fn arrange(bars: &[Bar], l: &Loop, rng: &mut Rng) -> Vec<Bar> {
    let n = l.bars.clamp(1, 8);
    let mut out = Vec::new();
    for b in 0..n {
        // The commonest bar most of the time; another family on the bar before a turn.
        let mut bar = if bars.len() > 1 && n > 1 && b == n - 1 && rng.f() < 0.6 { bars[1 + (rng.next() as usize % (bars.len() - 1))].clone() } else { bars[0].clone() };
        let busy = l.busy.clamp(0.0, 1.0);
        for r in 0..3 {
            for s in 0..16 {
                let v = bar.rows[r][s];
                if v > 0.0 && v < 0.9 && busy < 0.5 && rng.f() < (0.5 - busy) * 2.0 {
                    bar.rows[r][s] = 0.0;
                }
                if v == 0.0 && busy > 0.5 && rng.f() < (busy - 0.5) * [0.15, 0.3, 0.8][r] {
                    bar.rows[r][s] = 0.35 + 0.2 * rng.f();
                }
            }
        }
        out.push(bar);
    }
    // The fill: the last beat (or two) of the last bar, snare rising.
    let f = l.fills.clamp(0.0, 1.0);
    if f > 0.05 && rng.f() < 0.35 + f {
        let last = out.last_mut().unwrap();
        let from = if f > 0.6 { 8 } else { 12 };
        for s in from..16 {
            let u = (s - from) as f32 / (16 - from) as f32;
            last.rows[1][s] = if s % 2 == 0 || f > 0.4 { 0.45 + 0.55 * u } else { 0.0 };
            last.rows[2][s] = 0.0;
            if s == from {
                last.rows[0][s] = last.rows[0][s].max(0.8);
            }
        }
    }
    out
}

/// Render `bars` with `kit` (kick, snare, hat). The length is the bars
/// exactly, and tails wrap round to the start, so it loops without a seam.
pub fn render_loop(bars: &[Bar], kit: &[(Sound, f32); 3], l: &Loop, rng: &mut Rng) -> Sound {
    let step = 60.0 / l.bpm.clamp(40.0, 240.0) / 4.0;
    let total = ((bars.len() as f32 * 16.0 * step) * RATE as f32).round() as usize;
    let mut x = vec![0.0f32; total * 2];
    let swing = (l.swing.clamp(0.5, 0.75) - 0.5) * 2.0 * step;
    for (b, bar) in bars.iter().enumerate() {
        for s in 0..16 {
            for r in 0..3 {
                let v = bar.rows[r][s];
                if v <= 0.0 {
                    continue;
                }
                let t = (b * 16 + s) as f32 * step + if s % 2 == 1 { swing } else { 0.0 } + rng.n() * 0.002;
                let at = ((t.max(0.0)) * RATE as f32) as usize;
                let snd = &kit[r].0;
                let g = v * v;
                // A fill's quick snares are shorter.
                let len = if r == 1 && v < 1.0 && s >= 8 { snd.frames().min((step * 1.5 * RATE as f32) as usize) } else { snd.frames() };
                for i in 0..len {
                    let o = ((at + i) % total) * 2;
                    x[o] += snd.x[i * 2] * g;
                    x[o + 1] += snd.x[i * 2 + 1] * g;
                }
            }
        }
    }
    let mut s = Sound { rate: RATE, channels: 2, x };
    for v in &mut s.x {
        *v = fx::soft_ceiling(*v * 0.7);
    }
    // No trim and no fades: the end meets the start. Only the level is set.
    to_peak(&mut s, -1.0);
    s
}

/// Set the peak, and nothing else: for a sound whose length is its point.
pub fn to_peak(s: &mut Sound, db: f32) {
    let pk = s.peak();
    if pk > 1e-9 && pk.is_finite() {
        let g = 10f32.powf(db / 20.0) / pk;
        for v in &mut s.x {
            *v *= g;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(hz: f32, secs: f32, decay: f32) -> Sound {
        let n = (secs * RATE as f32) as usize;
        Sound { rate: RATE, channels: 1, x: (0..n).map(|i| { let t = i as f32 / RATE as f32; (t * hz * std::f32::consts::TAU).sin() * (-decay * t).exp() * 0.8 }).collect() }
    }

    #[test]
    fn mutations_are_repeatable_and_differ() {
        let s = tone(220.0, 0.5, 6.0);
        let a = mutate(&s, 3, 0.5, "both", -1.0, 42);
        let b = mutate(&s, 3, 0.5, "both", -1.0, 42);
        assert_eq!(a.len(), 3);
        for ((x, wx, _), (y, wy, _)) in a.iter().zip(&b) {
            assert_eq!(wx, wy);
            assert_eq!(x.x, y.x);
            assert!(x.peak() > 0.5 && x.x.iter().all(|v| v.is_finite()));
        }
        assert!(a[0].1 != a[1].1 || a[1].1 != a[2].1, "three mutations were all the same chain");
        let hp = mutate(&s, 4, 0.5, "hp", -1.0, 7);
        assert!(hp.iter().all(|(_, _, st)| st.iter().all(|s| s.id.starts_with("hp-"))));
    }

    #[test]
    fn texture_is_long_and_shaped() {
        let s = tone(330.0, 0.4, 3.0);
        let t = Texture { seconds: 4.0, stretch: 20.0, density: 0.5, space: 0.3 };
        let pad = texture(&s, Shape::Pad, &t, 1);
        assert!((pad.seconds() - 4.0).abs() < 0.6, "pad {} s", pad.seconds());
        let q = pad.frames() / 10;
        let rms = |a: usize, b: usize| (pad.x[a * 2..b * 2].iter().map(|v| v * v).sum::<f32>() / ((b - a) * 2) as f32).sqrt();
        assert!(rms(0, q / 4) < rms(4 * q, 6 * q), "a pad swells in");
        let riser = texture(&s, Shape::Riser, &t, 1);
        let n = riser.frames();
        let r = |a: usize, b: usize| (riser.x[a * 2..b * 2].iter().map(|v| v * v).sum::<f32>()).sqrt();
        assert!(r(0, n / 4) < r(n / 2, n * 3 / 4) || r(n / 2, n * 3 / 4) < r(3 * n / 4, n - 1), "a riser grows");
    }

    #[test]
    fn a_loop_is_its_bars_long_and_puts_the_kick_on_the_one() {
        let kick = tone(55.0, 0.4, 12.0);
        let hat = Sound { rate: RATE, channels: 1, x: (0..4000).map(|i| if i % 2 == 0 { 0.5 } else { -0.5 } * (-(i as f32) / 600.0).exp()).collect() };
        let kit = roles(&[hat.clone(), kick.clone()]);
        // The low one plays kick, the bright one hat.
        assert!(kit[0].0.x.iter().zip(stereo(&kick).x.iter()).take(200).all(|(a, b)| (a.signum() == b.signum()) || a.abs() < 0.05 || b.abs() < 0.05));
        let l = Loop { bpm: 120.0, bars: 2, busy: 0.5, fills: 0.0, swing: 0.5 };
        let mut rng = Rng::new(3);
        let bars = arrange(&stock_bars(), &l, &mut rng);
        assert_eq!(bars.len(), 2);
        let s = render_loop(&bars, &kit, &l, &mut rng);
        assert_eq!(s.frames(), (4.0 * RATE as f32) as usize, "two bars at 120 BPM are four seconds");
        // A bar that starts on a rest keeps its length too.
        let late = vec![Bar::from_glyphs("....X.......X...", "................", "................")];
        let r = render_loop(&late, &kit, &Loop { bpm: 120.0, bars: 1, busy: 0.5, fills: 0.0, swing: 0.5 }, &mut rng);
        assert_eq!(r.frames(), (2.0 * RATE as f32) as usize);
        let e = |a: f32, b: f32| s.x[(a * RATE as f32) as usize * 2..(b * RATE as f32) as usize * 2].iter().map(|v| v * v).sum::<f32>();
        assert!(e(0.0, 0.1) > 4.0 * e(0.3, 0.4), "the kick is on the one, and the gap after it is quiet");
    }

    #[test]
    fn a_fill_takes_the_last_beat() {
        let l = Loop { bpm: 100.0, bars: 1, busy: 0.5, fills: 1.0, swing: 0.5 };
        let bars = arrange(&stock_bars()[..1], &l, &mut Rng::new(1));
        assert!(bars[0].rows[1][12..].iter().filter(|v| **v > 0.0).count() >= 3);
        assert!(bars[0].rows[2][12..].iter().all(|v| *v == 0.0));
    }
}
