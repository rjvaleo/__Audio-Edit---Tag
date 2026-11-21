//! Chop, MultiGrainLive's slicer (the Chop page), as a module of the native
//! engine, with the page's arithmetic ported from its JavaScript.
//!
//! The page (`ui/app/400-chop-cut.js`, `401-chop-sound.js`,
//! `402-chop-listen.js`, `406-chop-page.js`) finds the cuts, says what a
//! slice sounds like, renders Preview and Ratchet, and measures the sound.
//! All of it is plain JavaScript: doubles, stored to `Float32Array`s. The
//! port does the same arithmetic in the same order, doubles then a float
//! store, with V8's own `Math` functions ([`js`]), so it gives the page's
//! numbers to the bit (`tests/chop.rs` checks it against a recording of the
//! page, `tests/ui/chop-port.spec.mjs`).
//!
//! - [`Page`] is the page's state: the sound, S and E, the settings and the
//!   slices. Its methods are the page's functions: [`Page::recut`],
//!   [`Page::slice_audio`], [`Page::render_preview`],
//!   [`Page::render_ratchet`], [`Page::find_tempo`].
//! - The functions Recycle Reborn's code had ([`build_rms`], [`detect_segs`],
//!   [`tail_params`], [`ping_pong_tail`]) and the sound's ([`resample`],
//!   [`biquad`], [`run_biquad`]) stand alone, as on the page.
//! - [`listen::analyse`] is `chopAnalyseCore`, the measures of every frame.
//! - [`Chop`] is the module: what a [`ChopThing`] holds, rendered on the
//!   app's thread from a [`Page`] and handed over with `Controller::give`,
//!   played on notes and on the transport knob. Nothing in `process`
//!   allocates or frees.
//!
//! All of this but [`Chop`] runs off the audio thread: it allocates.

pub mod js;
pub mod listen;

use engine_core::{EventKind, Io, Kind, Module, NoteKind, Thing};
pub use listen::{analyse, Analysis, Tempo};

/// `CHOP_FRAME`: the frames of one RMS measure.
pub const FRAME: usize = 512;

// ------------------------------------------------- Recycle Reborn's own code

/// `chopBuildRms`: the RMS of every 512 frames, the last part as it is.
pub fn build_rms(data: &[f32]) -> Vec<f64> {
    let mut frames = Vec::with_capacity(data.len().div_ceil(FRAME));
    let mut i = 0;
    while i < data.len() {
        let end = (i + FRAME).min(data.len());
        let mut s = 0.0f64;
        for &v in &data[i..end] {
            let v = v as f64;
            s += v * v;
        }
        frames.push((s / (end - i) as f64).sqrt());
        i += FRAME;
    }
    frames
}

/// `chopDetectSegs`: the sounds between the silences, as [start, end] frames.
pub fn detect_segs(rms: &[f64], top_db: f64, min_dur_ms: f64, pad_ms: f64, sample_rate: f64, length: i64) -> Vec<[i64; 2]> {
    let fr = FRAME as f64;
    // `Math.max(...rms) || 1e-10`: -Infinity for none, which is truthy.
    let mut peak = f64::NEG_INFINITY;
    for &v in rms {
        peak = js::max(peak, v);
    }
    if peak == 0.0 || peak.is_nan() {
        peak = 1e-10;
    }
    let thresh = peak * js::pow(10.0, -top_db / 20.0);
    let pad_f = js::round((pad_ms / 1000.0) * sample_rate / fr);
    let min_f = js::round((min_dur_ms / 1000.0) * sample_rate / fr);
    let n = rms.len() as f64;
    let mut raw: Vec<[f64; 2]> = Vec::new();
    let (mut inside, mut st) = (false, 0.0f64);
    for (i, &v) in rms.iter().enumerate() {
        let active = v >= thresh;
        let i = i as f64;
        if active && !inside {
            inside = true;
            st = i;
        }
        if !active && inside {
            inside = false;
            let s = js::max(0.0, st - pad_f);
            let e = js::min(n - 1.0, i + pad_f);
            if e - s >= min_f {
                raw.push([s * fr, e * fr]);
            }
        }
    }
    if inside {
        let s = js::max(0.0, st - pad_f);
        let e = n - 1.0;
        if e - s >= min_f {
            raw.push([s * fr, js::min(e * fr, length as f64 - 1.0)]);
        }
    }
    let mut merged: Vec<[f64; 2]> = Vec::new();
    for seg in raw {
        match merged.last_mut() {
            Some(last) if seg[0] <= last[1] => last[1] = js::max(last[1], seg[1]),
            _ => merged.push(seg),
        }
    }
    merged.into_iter().map(|[s, e]| [s as i64, e as i64]).collect()
}

/// What `chopGetTailParams` says of a tail: all of it when it fits, or why not.
#[derive(Clone, Debug, PartialEq)]
pub enum TailParams {
    No { reason: String },
    Yes(Tail),
}

/// A ping-pong tail that fits: its lengths in frames.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tail {
    pub tail_len: i64,
    pub actual_ms: f64,
    pub requested_tail_ms: f64,
    pub clamped: bool,
    pub loop_start: i64,
    pub num_cycles: i64,
    pub xf_len: i64,
    pub total_frames: i64,
    pub slice_len: i64,
}

/// `chopGetTailParams`: the tail as asked, shortened to fit the slice, or why
/// it cannot fit at all.
pub fn tail_params(start: i64, end: i64, requested_tail_ms: f64, sr: f64) -> TailParams {
    let slice_len = (end - start) as f64;
    let slice_dur_ms = slice_len / sr * 1000.0;
    let min_tail = (sr * 0.010).ceil();
    let max_tail_len = (slice_len / 3.5).floor();
    if max_tail_len < min_tail {
        return TailParams::No {
            reason: format!(
                "slice too short ({}ms — need ≥{}ms)",
                js::fixed0(slice_dur_ms),
                js::fixed0(min_tail * 3.5 / sr * 1000.0)
            ),
        };
    }
    let requested_len = (requested_tail_ms / 1000.0 * sr).floor();
    let tail_len = js::min(requested_len, max_tail_len);
    let clamped = tail_len < requested_len;
    let actual_ms = tail_len / sr * 1000.0;
    let xf_len = js::min(128.0, (tail_len / 4.0).floor());
    let loop_start = slice_len - tail_len;
    let num_cycles = js::max(2.0, js::min(8.0, (500.0 / actual_ms).ceil()));
    let total_frames = slice_len + num_cycles * tail_len;
    TailParams::Yes(Tail {
        tail_len: tail_len as i64,
        actual_ms,
        requested_tail_ms,
        clamped,
        loop_start: loop_start as i64,
        num_cycles: num_cycles as i64,
        xf_len: xf_len as i64,
        total_frames: total_frames as i64,
        slice_len: slice_len as i64,
    })
}

/// `chopBuildPingPongTail`: the slice, then its last moments forwards and
/// backwards, fading out. Interleaved, as the original wrote it.
pub fn ping_pong_tail(channels: &[Vec<f32>], start: i64, end: i64, requested_tail_ms: f64, sr: f64) -> Result<(Vec<f32>, Tail), String> {
    let p = match tail_params(start, end, requested_tail_ms, sr) {
        TailParams::Yes(p) => p,
        TailParams::No { reason } => return Err(format!("tail not viable: {reason}")),
    };
    let ch = channels.len();
    let total = p.total_frames as usize;
    let src_at = |src: &[f32], i: i64| js::at(src, (start + i) as f64);
    let mut out_channels = Vec::with_capacity(ch);
    for src in channels {
        let mut out = vec![0.0f32; total];
        for i in 0..p.slice_len {
            out[i as usize] = src_at(src, i) as f32;
        }
        let xf = p.xf_len as f64;
        for i in 0..p.xf_len {
            let t = i as f64 / xf;
            let fade = 0.5 - 0.5 * js::cos(std::f64::consts::PI * t);
            let join = (p.loop_start + i) as usize;
            let loop_val = src_at(src, p.loop_start);
            out[join] = (out[join] as f64 * (1.0 - fade) + loop_val * fade) as f32;
        }
        let all = (p.num_cycles * p.tail_len) as f64;
        for cycle in 0..p.num_cycles {
            let forward = cycle % 2 == 0;
            let offset = p.slice_len + cycle * p.tail_len;
            for i in 0..p.tail_len {
                let src_i = if forward { p.loop_start + i } else { p.loop_start + (p.tail_len - 1 - i) };
                let global = (cycle * p.tail_len + i) as f64 / all;
                let amp = js::cos(global * std::f64::consts::PI / 2.0);
                out[(offset + i) as usize] = (src_at(src, src_i) * amp) as f32;
            }
        }
        out_channels.push(out);
    }
    let mut inter = vec![0.0f32; total * ch];
    for f in 0..total {
        for c in 0..ch {
            inter[f * ch + c] = out_channels[c][f];
        }
    }
    Ok((inter, p))
}

// ------------------------------------------------- the sound of a slice

/// `chopResample`: varispeed, as a sampler does it.
pub fn resample(c: &[f32], ratio: f64) -> Vec<f32> {
    let n = js::max(1.0, (c.len() as f64 / ratio).floor()) as usize;
    let mut out = vec![0.0f32; n];
    for (j, o) in out.iter_mut().enumerate() {
        let p = j as f64 * ratio;
        let i = p.floor();
        let f = p - i;
        *o = (js::or0(js::at(c, i)) * (1.0 - f) + js::or0(js::at(c, i + 1.0)) * f) as f32;
    }
    out
}

/// The RBJ cookbook biquads `chopBiquad` makes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Filter {
    Lp,
    Hp,
    Bp,
    Peak,
}

impl Filter {
    /// By the page's name: `lp`, `hp`, `bp`; anything else is the bell.
    pub fn named(name: &str) -> Filter {
        match name {
            "lp" => Filter::Lp,
            "hp" => Filter::Hp,
            "bp" => Filter::Bp,
            _ => Filter::Peak,
        }
    }
}

/// `chopBiquad`: [b0, b1, b2, a1, a2], each over a0.
pub fn biquad(kind: Filter, f: f64, q: f64, gain_db: f64, sr: f64) -> [f64; 5] {
    let w = 2.0 * std::f64::consts::PI * js::min(f, sr * 0.45) / sr;
    let cs = js::cos(w);
    let sn = js::sin(w);
    let al = sn / (2.0 * q);
    let a = js::pow(10.0, gain_db / 40.0);
    let (b0, b1, b2, a0, a1, a2) = match kind {
        Filter::Lp => {
            let b0 = (1.0 - cs) / 2.0;
            (b0, 1.0 - cs, b0, 1.0 + al, -2.0 * cs, 1.0 - al)
        }
        Filter::Hp => {
            let b0 = (1.0 + cs) / 2.0;
            (b0, -(1.0 + cs), b0, 1.0 + al, -2.0 * cs, 1.0 - al)
        }
        Filter::Bp => (al, 0.0, -al, 1.0 + al, -2.0 * cs, 1.0 - al),
        Filter::Peak => (1.0 + al * a, -2.0 * cs, 1.0 - al * a, 1.0 + al / a, -2.0 * cs, 1.0 - al / a),
    };
    [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0]
}

/// `chopRunBiquad`: the filter through `c`, in place. The state is doubles;
/// only what is written back is a float.
pub fn run_biquad(c: &mut [f32], k: &[f64; 5]) {
    let (mut x1, mut x2, mut y1, mut y2) = (0.0f64, 0.0f64, 0.0f64, 0.0f64);
    for v in c.iter_mut() {
        let x = *v as f64;
        let y = k[0] * x + k[1] * x1 + k[2] * x2 - k[3] * y1 - k[4] * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        *v = y as f32;
    }
}

/// `chopFade`: a raised-cosine fade of `n` frames in at the start and out at the end.
pub fn fade(chs: &mut [Vec<f32>], n: i64) {
    let len = chs[0].len();
    let n = n.min((len / 2) as i64).max(0) as usize;
    for c in chs.iter_mut() {
        for j in 0..n {
            let g = 0.5 - 0.5 * js::cos(std::f64::consts::PI * j as f64 / n as f64);
            c[j] = (c[j] as f64 * g) as f32;
            c[len - 1 - j] = (c[len - 1 - j] as f64 * g) as f32;
        }
    }
}

/// `chopStretch`: longer, by going back and forth over the last moments.
pub fn stretch(chs: &[Vec<f32>], target: usize, rate: f64) -> Vec<Vec<f32>> {
    let len = chs[0].len();
    let l = js::max(8.0, js::min((len as f64 / 4.0).floor(), js::round(rate * 0.05))) as i64;
    let from = len as i64 - l;
    chs.iter()
        .map(|c| {
            let mut out = vec![0.0f32; target];
            out[..len].copy_from_slice(c);
            let mut k = 0i64;
            for j in len..target {
                let cyc = k / l;
                let at = k % l;
                out[j] = js::at(c, (from + if cyc % 2 == 1 { l - 1 - at } else { at }) as f64) as f32;
                k += 1;
            }
            let fd = js::min(js::round(rate * 0.005), (target - len) as f64) as usize;
            for j in 0..fd {
                let i = target - 1 - j;
                out[i] = (out[i] as f64 * (j as f64 / fd as f64)) as f32;
            }
            out
        })
        .collect()
}

// ------------------------------------------------- the settings

/// How the cuts are found.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// At every hit (Sensitivity, Min length).
    Transient,
    /// Between the silences (Recycle Reborn's).
    Silence,
    /// On every grid line.
    Grid,
}

/// The grid's division: a bar, or 1/n.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Div {
    Bar,
    Of(f64),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Feel {
    Straight,
    Dot,
    Trip,
}

/// Every setting the cuts and the sound read: the page's `CHOP_DEF`, named
/// as there. The defaults are the page's starting settings.
#[derive(Clone, Debug, PartialEq)]
pub struct Settings {
    pub mode: Mode,
    pub sens: f64,
    pub top_db: f64,
    pub min_dur: f64,
    pub pad: f64,
    pub div: Div,
    pub feel: Feel,
    pub nudge: f64,
    pub shuffle: f64,
    pub gate: f64,
    pub smooth: f64,
    pub tail: bool,
    pub tail_ms: f64,
    pub bars: f64,
    pub beats: f64,
    pub sig: f64,
    pub tempo: f64,
    pub pitch: f64,
    pub stretch: f64,
    /// Sync `lock`: play at the sequencer's tempo, when there is one.
    pub lock: bool,
    pub env_on: bool,
    pub attack: f64,
    pub decay: f64,
    pub tr_on: bool,
    pub tr_thresh: f64,
    pub tr_amount: f64,
    pub tr_attack: f64,
    pub tr_release: f64,
    pub tr_gain: f64,
    pub eq_on: bool,
    pub lo_cut: f64,
    pub low_f: f64,
    pub low_g: f64,
    pub low_q: f64,
    pub high_f: f64,
    pub high_g: f64,
    pub high_q: f64,
    pub hi_cut: f64,
    pub flt_on: bool,
    pub flt_type: Filter,
    pub flt_freq: f64,
    pub flt_q: f64,
    pub drive: f64,
    pub gain: f64,
    pub mix: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            mode: Mode::Transient,
            sens: 60.0,
            top_db: 40.0,
            min_dur: 40.0,
            pad: 12.0,
            div: Div::Of(8.0),
            feel: Feel::Straight,
            nudge: 0.0,
            shuffle: 50.0,
            gate: 100.0,
            smooth: 0.0,
            tail: false,
            tail_ms: 80.0,
            bars: 1.0,
            beats: 0.0,
            sig: 4.0,
            tempo: 0.0,
            pitch: 0.0,
            stretch: 0.0,
            lock: false,
            env_on: false,
            attack: 0.0,
            decay: 5000.0,
            tr_on: false,
            tr_thresh: -30.0,
            tr_amount: 0.0,
            tr_attack: 20.0,
            tr_release: 100.0,
            tr_gain: 0.0,
            eq_on: false,
            lo_cut: 15.0,
            low_f: 100.0,
            low_g: 0.0,
            low_q: 1.0,
            high_f: 2500.0,
            high_g: 0.0,
            high_q: 1.0,
            hi_cut: 20000.0,
            flt_on: false,
            flt_type: Filter::Lp,
            flt_freq: 1000.0,
            flt_q: 0.7,
            drive: 0.0,
            gain: 0.0,
            mix: 100.0,
        }
    }
}

/// JavaScript's truthiness of a number.
fn truthy(v: f64) -> bool {
    v != 0.0 && !v.is_nan()
}

impl Settings {
    /// `chopHasSound`: anything on that changes a slice from its own samples.
    pub fn has_sound(&self) -> bool {
        self.gate < 100.0 || self.smooth > 0.0 || self.tail || self.pitch != 0.0 || self.env_on || self.tr_on || self.eq_on || self.flt_on
    }
}

/// `chopFx`: the Envelope, Transient, EQ and Filter rows, in place.
pub fn effects(chs: &mut [Vec<f32>], sr: f64, cp: &Settings) {
    let len = chs[0].len();
    if cp.env_on {
        let att = cp.attack / 1000.0 * sr;
        let dec = cp.decay / 1000.0 * sr;
        for i in 0..len {
            let fi = i as f64;
            let a = if att > 0.0 { js::min(1.0, fi / att) } else { 1.0 };
            let d = if cp.decay >= 5000.0 { 1.0 } else { js::exp(-3.0 * js::max(0.0, fi - att) / dec) };
            let g = a * d;
            for c in chs.iter_mut() {
                c[i] = (c[i] as f64 * g) as f32;
            }
        }
    }
    if cp.tr_on {
        let coef = |ms: f64| js::exp(-1.0 / (js::max(0.1, ms) / 1000.0 * sr));
        let (a_f, a_s, r) = (coef(1.0), coef(cp.tr_attack), coef(cp.tr_release));
        let thr = js::pow(10.0, cp.tr_thresh / 20.0);
        let out = js::pow(10.0, cp.tr_gain / 20.0);
        let (mut fast, mut slow) = (0.0f64, 0.0f64);
        for i in 0..len {
            let mut lv = 0.0f64;
            for c in chs.iter() {
                lv = js::max(lv, (c[i] as f64).abs());
            }
            fast = if lv > fast { a_f * fast + (1.0 - a_f) * lv } else { r * fast + (1.0 - r) * lv };
            slow = if lv > slow { a_s * slow + (1.0 - a_s) * lv } else { r * slow + (1.0 - r) * lv };
            let mut g = 1.0;
            if fast > thr {
                g = js::min(8.0, js::max(0.1, js::pow(fast / (slow + 1e-9), cp.tr_amount / 100.0)));
            }
            let m = g * out;
            for c in chs.iter_mut() {
                c[i] = (c[i] as f64 * m) as f32;
            }
        }
    }
    if cp.eq_on {
        let mut bands = Vec::new();
        if cp.lo_cut > 16.0 {
            bands.push(biquad(Filter::Hp, cp.lo_cut, 0.707, 0.0, sr));
        }
        if truthy(cp.low_g) {
            bands.push(biquad(Filter::Peak, cp.low_f, cp.low_q, cp.low_g, sr));
        }
        if truthy(cp.high_g) {
            bands.push(biquad(Filter::Peak, cp.high_f, cp.high_q, cp.high_g, sr));
        }
        if cp.hi_cut < 19990.0 {
            bands.push(biquad(Filter::Lp, cp.hi_cut, 0.707, 0.0, sr));
        }
        for c in chs.iter_mut() {
            for k in &bands {
                run_biquad(c, k);
            }
        }
    }
    if cp.flt_on {
        let k = biquad(cp.flt_type, cp.flt_freq, cp.flt_q, 0.0, sr);
        let d = 1.0 + cp.drive / 10.0;
        let norm = js::tanh(d);
        let g = js::pow(10.0, cp.gain / 20.0);
        let wet = cp.mix / 100.0;
        for c in chs.iter_mut() {
            let dry = c.clone();
            run_biquad(c, &k);
            for i in 0..len {
                let v = c[i] as f64;
                let y = if cp.drive > 0.0 { js::tanh(v * d) / norm } else { v };
                c[i] = ((dry[i] as f64 * (1.0 - wet) + y * wet) * g) as f32;
            }
        }
    }
}

// ------------------------------------------------- the page

/// One slice: its frames, start to end, and its two switches.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Slice {
    pub s: i64,
    pub e: i64,
    pub muted: bool,
    pub rev: bool,
}

/// Where a rendered slice sits in a Preview or a Ratchet: `chopRenderPreview`'s
/// `map`, for a playhead.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Placed {
    pub at: i64,
    pub len: i64,
    pub s: i64,
    pub k: f64,
}

/// A render: a buffer a channel, and where each slice in it came from.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Render {
    pub chs: Vec<Vec<f32>>,
    pub map: Vec<Placed>,
}

/// The Chop page's state: the sound, mixed to mono for the cuts; S and E;
/// the settings; the slices.
#[derive(Clone, Debug)]
pub struct Page {
    pub channels: Vec<Vec<f32>>,
    pub rate: f64,
    pub len: i64,
    pub mono: Vec<f32>,
    pub rms: Vec<f64>,
    /// S and E: what is cut, previewed and written.
    pub region: (i64, i64),
    pub settings: Settings,
    pub slices: Vec<Slice>,
    /// The sequencer's tempo, for Sync `lock`; none when it has none.
    pub seq_tempo: Option<f64>,
}

impl Page {
    /// `chopTake`: a sound's channels, S and E at its ends, cut from the
    /// settings.
    pub fn new(channels: Vec<Vec<f32>>, rate: f64, settings: Settings) -> Page {
        let len = channels.first().map_or(0, |c| c.len());
        let n = channels.len() as f64;
        let mut mono = vec![0.0f32; len];
        for d in &channels {
            for i in 0..len {
                mono[i] = (mono[i] as f64 + d[i] as f64 / n) as f32;
            }
        }
        let rms = build_rms(&mono);
        let mut page = Page {
            channels,
            rate,
            len: len as i64,
            mono,
            rms,
            region: (0, len as i64),
            settings,
            slices: Vec::new(),
            seq_tempo: None,
        };
        page.recut();
        page
    }

    /// New settings, and the cuts found again from them (as `chopApply`).
    pub fn set(&mut self, settings: Settings) {
        self.settings = settings;
        self.recut();
    }

    /// `chopBpm`: the tempo the sound is at, S to E being Bars and Beats.
    pub fn bpm(&self) -> f64 {
        let cp = &self.settings;
        let beats = cp.bars * cp.sig + cp.beats;
        let sec = (self.region.1 - self.region.0) as f64 / self.rate;
        if beats > 0.0 && sec > 0.0 {
            (beats * 60.0) / sec
        } else {
            120.0
        }
    }

    /// `chopPlayBpm`: the knob's, the sequencer's when locked, or its own.
    pub fn play_bpm(&self) -> f64 {
        if self.settings.lock {
            if let Some(t) = self.seq_tempo.filter(|t| *t > 0.0) {
                return t;
            }
        }
        if self.settings.tempo > 0.0 {
            self.settings.tempo
        } else {
            self.bpm()
        }
    }

    /// `chopStepBeats`: one grid step in quarter-note beats.
    pub fn step_beats(&self) -> f64 {
        let cp = &self.settings;
        let base = match cp.div {
            Div::Bar => cp.sig,
            Div::Of(n) => 4.0 / n,
        };
        base * match cp.feel {
            Feel::Dot => 1.5,
            Feel::Trip => 2.0 / 3.0,
            Feel::Straight => 1.0,
        }
    }

    /// `chopGridAt`: grid line `k`, in frames from S, nudged and swung.
    pub fn grid_at(&self, k: i64, step_f: f64) -> f64 {
        let cp = &self.settings;
        let swing = if k % 2 != 0 { ((cp.shuffle - 50.0) / 50.0) * step_f } else { 0.0 };
        (k as f64 + cp.nudge / 100.0) * step_f + swing
    }

    /// `chopGridCuts`.
    pub fn grid_cuts(&self) -> Vec<i64> {
        let (s, e) = self.region;
        let step_f = (self.step_beats() * 60.0 / self.bpm()) * self.rate;
        let mut cuts = vec![s];
        for k in 0..100_000 {
            let at = js::round(s as f64 + self.grid_at(k, step_f));
            if at >= e as f64 {
                break;
            }
            if at > s as f64 {
                cuts.push(at as i64);
            }
        }
        cuts
    }

    /// `chopSnap`: the zero crossing nearest `at`, `reach` frames back at most.
    pub fn snap(&self, at: i64, reach: i64) -> i64 {
        let m = &self.mono;
        for d in 0..=reach {
            for i in [at - d, at + d.min(32)] {
                if i > 0 && (i as usize) < m.len() && ((m[i as usize - 1] <= 0.0) != (m[i as usize] <= 0.0)) {
                    return i;
                }
            }
        }
        at
    }

    /// `chopOnsets`: a cut at every hit.
    pub fn onsets(&self) -> Vec<i64> {
        const HOP: i64 = 256;
        let (s0, e0) = self.region;
        let cp = &self.settings;
        let mono = &self.mono;
        let n = (e0 - s0).div_euclid(HOP);
        if n < 2 {
            return vec![s0];
        }
        let mut db = vec![0.0f32; n as usize];
        let mut prev = if s0 > 0 { mono[s0 as usize - 1] as f64 } else { 0.0 };
        let mut peak = -240.0f64;
        for k in 0..n {
            let mut acc = 0.0f64;
            let a = s0 + k * HOP;
            for j in a..a + HOP {
                let v = mono[j as usize] as f64;
                let d = v - 0.97 * prev;
                prev = v;
                acc += d * d;
            }
            db[k as usize] = (10.0 * js::log10(acc / HOP as f64 + 1e-12)) as f32;
            if db[k as usize] as f64 > peak {
                peak = db[k as usize] as f64;
            }
        }
        let rise = 18.0 - 0.165 * cp.sens;
        let floor = peak - (24.0 + 0.36 * cp.sens);
        let gap = js::max(1.0, js::round((cp.min_dur / 1000.0) * self.rate / HOP as f64)) as i64;
        let mut out = Vec::new();
        let mut last = -1_000_000_000i64;
        for k in 1..n {
            let mut base = 0.0f64;
            let mut m = 0.0f64;
            for j in (k - 6).max(0)..k {
                base += db[j as usize] as f64;
                m += 1.0;
            }
            base /= m;
            let v = db[k as usize] as f64;
            if v - base < rise || v < floor || k - last < gap {
                continue;
            }
            last = k;
            out.push(self.snap(s0 + k * HOP, HOP));
        }
        if out.is_empty() {
            return vec![s0];
        }
        if out[0] - s0 >= gap * HOP {
            let upto = (out[0] - s0).div_euclid(HOP);
            if (0..upto).any(|k| db[k as usize] as f64 >= floor) {
                out.insert(0, s0);
            }
        }
        out
    }

    /// `chopRecut`, from nothing: no locked or moved cuts to keep. A slice
    /// keeps its mute and reverse when one starts where it started.
    pub fn recut(&mut self) {
        let (s0, e0) = self.region;
        let old = std::mem::take(&mut self.slices);
        let mut slices: Vec<Slice> = if self.settings.mode == Mode::Silence {
            let cp = &self.settings;
            detect_segs(&self.rms, cp.top_db, cp.min_dur, cp.pad, self.rate, self.len)
                .into_iter()
                .map(|[s, e]| (s.max(s0), e.min(e0)))
                .filter(|(s, e)| e > s)
                .map(|(s, e)| Slice { s, e, ..Slice::default() })
                .collect()
        } else {
            let mut cuts = if self.settings.mode == Mode::Grid { self.grid_cuts() } else { self.onsets() };
            // `[...new Set(cuts)].sort((a, b) => a - b)`
            cuts.sort();
            cuts.dedup();
            (0..cuts.len())
                .map(|i| Slice { s: cuts[i], e: if i + 1 < cuts.len() { cuts[i + 1] } else { e0 }, ..Slice::default() })
                .collect()
        };
        for x in slices.iter_mut() {
            // `new Map(old.map((x) => [x.s, x]))`: the last of a start wins.
            if let Some(f) = old.iter().rev().find(|o| o.s == x.s) {
                x.muted = f.muted;
                x.rev = f.rev;
            }
        }
        self.slices = slices;
    }

    /// `chopSliceAudio`: slice `i` as channels of samples, everything on.
    /// `slot` is its room in a Preview, which Stretch fills (0: none).
    pub fn slice_audio(&self, i: usize, slot: i64) -> Vec<Vec<f32>> {
        let x = self.slices[i];
        self.sound(x.s, x.e, x.rev, slot, self.settings.tail, self.settings.gate)
    }

    /// `chopSound`: S to E gated, with its tail, reversed, pitched,
    /// stretched, through the rows, faded at its ends.
    pub fn sound(&self, s: i64, e0: i64, rev: bool, slot: i64, tail: bool, gate: f64) -> Vec<Vec<f32>> {
        let cp = &self.settings;
        let rate = self.rate;
        let e = s + js::max(1.0, js::round((e0 - s) as f64 * gate / 100.0)) as i64;
        let mut chs: Option<Vec<Vec<f32>>> = None;
        if tail {
            if let TailParams::Yes(_) = tail_params(s, e, cp.tail_ms, rate) {
                let (inter, p) = ping_pong_tail(&self.channels, s, e, cp.tail_ms, rate).expect("viable");
                let ch = self.channels.len();
                let total = p.total_frames as usize;
                chs = Some((0..ch).map(|c| (0..total).map(|f| inter[f * ch + c]).collect()).collect());
            }
        }
        let mut chs = chs.unwrap_or_else(|| {
            self.channels
                .iter()
                .map(|c| {
                    // `Float32Array.slice(s, e)`, clamped to the array.
                    let a = (s.max(0) as usize).min(c.len());
                    let b = (e.max(0) as usize).min(c.len()).max(a);
                    c[a..b].to_vec()
                })
                .collect()
        });
        if rev {
            chs.iter_mut().for_each(|c| c.reverse());
        }
        if truthy(cp.pitch) {
            let ratio = js::pow(2.0, cp.pitch / 12.0);
            chs = chs.iter().map(|c| resample(c, ratio)).collect();
        }
        let len = chs[0].len() as i64;
        if slot != 0 && cp.stretch > 0.0 && len < slot {
            let target = len + js::round((slot - len) as f64 * cp.stretch / 100.0) as i64;
            chs = stretch(&chs, target as usize, rate);
        }
        effects(&mut chs, rate, cp);
        if cp.smooth > 0.0 {
            fade(&mut chs, js::round(cp.smooth / 1000.0 * rate) as i64);
        }
        chs
    }

    /// `chopRenderPreview`: every slice not muted, S to E, each where it
    /// falls at the play tempo.
    pub fn render_preview(&self) -> Render {
        let (s0, e0) = self.region;
        let k = self.bpm() / self.play_bpm();
        let play: Vec<usize> = (0..self.slices.len()).filter(|&i| {
            let x = self.slices[i];
            !x.muted && x.s >= s0 && x.s < e0
        }).collect();
        let total = js::max(1.0, js::round((e0 - s0) as f64 * k)) as i64;
        let mut out: Vec<Vec<f32>> = self.channels.iter().map(|_| vec![0.0f32; total as usize]).collect();
        let mut map = Vec::new();
        for (n, &i) in play.iter().enumerate() {
            let x = self.slices[i];
            let at = js::round((x.s - s0) as f64 * k) as i64;
            let next = if n + 1 < play.len() { js::round((self.slices[play[n + 1]].s - s0) as f64 * k) as i64 } else { total };
            let slot = (next - at).max(1);
            let chs = self.slice_audio(i, slot);
            let full = chs[0].len() as i64;
            let len = full.min(slot).min(total - at);
            let fd = len.min(js::round(self.rate * 0.004) as i64);
            for (ch, c) in chs.iter().enumerate() {
                let o = &mut out[ch];
                for j in 0..len.max(0) {
                    let g = if full > slot && j >= len - fd { (len - j) as f64 / fd as f64 } else { 1.0 };
                    let idx = (at + j) as usize;
                    o[idx] = (o[idx] as f64 + c[j as usize] as f64 * g) as f32;
                }
            }
            map.push(Placed { at, len, s: x.s, k });
        }
        Render { chs: out, map }
    }

    /// `chopRenderRatchet`: the chop from S firing on every grid line at the
    /// play tempo, for Bars bars, round and round.
    pub fn render_ratchet(&self) -> Render {
        let cp = &self.settings;
        let (s0, e0) = self.region;
        let bpm = self.play_bpm();
        let step_f = (self.step_beats() * 60.0 / bpm) * self.rate;
        let bars = js::min(64.0, js::max(1.0, cp.bars));
        let lp = js::max(1.0, js::round((bars * cp.sig + cp.beats) * 60.0 / bpm * self.rate)) as i64;
        let src = self.sound(s0, e0, false, 0, false, 100.0);
        let mut out: Vec<Vec<f32>> = self.channels.iter().map(|_| vec![0.0f32; lp as usize]).collect();
        let mut map = Vec::new();
        let fd = js::max(16.0, js::round(js::max(cp.smooth, 2.0) / 1000.0 * self.rate));
        for k in 0..100_000 {
            let at = js::round(self.grid_at(k, step_f));
            if at >= lp as f64 {
                break;
            }
            if at < 0.0 {
                continue;
            }
            let at = at as i64;
            let len = (src[0].len() as f64).min(js::round(step_f * cp.gate / 100.0)).min((lp - at) as f64);
            if len <= 0.0 {
                continue;
            }
            let len = len as i64;
            for (ch, c) in src.iter().enumerate() {
                let o = &mut out[ch];
                for j in 0..len {
                    let g = js::min(1.0, js::min(j as f64 / fd, (len - j) as f64 / fd));
                    let idx = (at + j) as usize;
                    o[idx] = (o[idx] as f64 + c[j as usize] as f64 * g) as f32;
                }
            }
            map.push(Placed { at, len, s: s0, k: 1.0 });
        }
        Render { chs: out, map }
    }

    /// `chopFindTempo`: the tempo, and how many whole bars S to E is.
    pub fn find_tempo(&self) -> Option<Tempo> {
        listen::find_tempo(&self.mono, self.rate, self.region, self.settings.sig)
    }
}

// ------------------------------------------------- the module

/// A rendered sound, its two sides; a mono sound has the same on both.
#[derive(Clone, Debug, Default)]
pub struct Clip {
    pub l: Vec<f32>,
    pub r: Vec<f32>,
}

impl Clip {
    fn of(chs: &[Vec<f32>]) -> Clip {
        match chs {
            [] => Clip::default(),
            [one] => Clip { l: one.clone(), r: one.clone() },
            [l, r, ..] => Clip { l: l.clone(), r: r.clone() },
        }
    }
    pub fn len(&self) -> usize {
        self.l.len()
    }
    pub fn is_empty(&self) -> bool {
        self.l.is_empty()
    }
}

/// What [`Chop`] plays, rendered from a [`Page`] on the app's thread: every
/// slice as the page renders it with everything on, and Preview and Ratchet.
#[derive(Clone, Debug, Default)]
pub struct ChopThing {
    pub slices: Vec<Clip>,
    pub preview: Clip,
    pub ratchet: Clip,
}

impl ChopThing {
    pub fn new(page: &Page) -> Box<ChopThing> {
        Box::new(ChopThing {
            slices: (0..page.slices.len()).map(|i| Clip::of(&page.slice_audio(i, 0))).collect(),
            preview: Clip::of(&page.render_preview().chs),
            ratchet: Clip::of(&page.render_ratchet().chs),
        })
    }
}

/// The note slice 0 is on, as in the SFZ Write makes: C1, then up a key a slice.
pub const FIRST_KEY: u8 = 36;
/// Knob 0: 0 stops Preview and Ratchet, 1 plays Preview once, 2 loops Ratchet.
pub const TRANSPORT: u32 = 0;
const VOICES: usize = 16;

#[derive(Clone, Copy)]
enum Source {
    Slice(usize),
    Preview,
    Ratchet,
}

#[derive(Clone, Copy)]
struct Voice {
    source: Source,
    /// Frames into the clip; negative until it starts, inside this block.
    pos: i64,
    looped: bool,
    age: u64,
}

/// Chop's slices as an instrument: input 0 notes, output 0 stereo audio.
/// Note `FIRST_KEY + i` plays slice `i` once from its start, at its own level
/// (one shot, as Write's SFZ maps them; velocity and note-off are not heard).
/// Up to 16 sound at once, the oldest giving way. Knob [`TRANSPORT`] plays
/// Preview (once) or Ratchet (round and round) from the start, or stops them.
pub struct Chop {
    thing: Option<Box<ChopThing>>,
    voices: [Option<Voice>; VOICES],
    transport: Option<Voice>,
    age: u64,
}

impl Chop {
    pub fn new() -> Chop {
        Chop { thing: None, voices: [None; VOICES], transport: None, age: 0 }
    }

    fn start(&mut self, slice: usize, offset: u32) {
        self.age += 1;
        let v = Voice { source: Source::Slice(slice), pos: -(offset as i64), looped: false, age: self.age };
        let free = self.voices.iter().position(|v| v.is_none()).unwrap_or_else(|| {
            let mut oldest = 0;
            for (i, v) in self.voices.iter().enumerate() {
                if v.is_some_and(|v| v.age < self.voices[oldest].map_or(u64::MAX, |o| o.age)) {
                    oldest = i;
                }
            }
            oldest
        });
        self.voices[free] = Some(v);
    }

    fn note(&mut self, key: u8, kind: NoteKind, offset: u32) {
        match kind {
            NoteKind::On => {
                if key >= FIRST_KEY {
                    self.start((key - FIRST_KEY) as usize, offset);
                }
            }
            NoteKind::Off => {}
            NoteKind::AllOff => {
                self.voices = [None; VOICES];
                self.transport = None;
            }
        }
    }

    /// Adds `v`'s clip into `l`/`r`; false once it has ended.
    fn mix(thing: &ChopThing, v: &mut Voice, l: &mut [f32], r: &mut [f32]) -> bool {
        let clip = match v.source {
            Source::Slice(i) => match thing.slices.get(i) {
                Some(c) => c,
                None => return false,
            },
            Source::Preview => &thing.preview,
            Source::Ratchet => &thing.ratchet,
        };
        let n = clip.len() as i64;
        if n == 0 {
            return false;
        }
        for j in 0..l.len() {
            if v.pos >= n {
                if !v.looped {
                    return false;
                }
                v.pos = 0;
            }
            if v.pos >= 0 {
                l[j] += clip.l[v.pos as usize];
                r[j] += clip.r[v.pos as usize];
            }
            v.pos += 1;
        }
        v.looped || v.pos < n
    }
}

impl Default for Chop {
    fn default() -> Self {
        Self::new()
    }
}

impl Module for Chop {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Notes]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn handle(&mut self, event: &EventKind) {
        match *event {
            EventKind::Param { index: TRANSPORT, value } => {
                self.age += 1;
                self.transport = match value.round() as i32 {
                    1 => Some(Voice { source: Source::Preview, pos: 0, looped: false, age: self.age }),
                    2 => Some(Voice { source: Source::Ratchet, pos: 0, looped: true, age: self.age }),
                    _ => None,
                };
            }
            EventKind::Note(n) => self.note(n.note, n.kind, 0),
            _ => {}
        }
    }
    /// A new [`ChopThing`]: what sounds stops, and the old one goes back.
    fn take(&mut self, _slot: u32, thing: Thing) -> Option<Thing> {
        let mut boxed = match thing.downcast::<ChopThing>() {
            Ok(b) => b,
            Err(other) => return Some(other),
        };
        self.voices = [None; VOICES];
        self.transport = None;
        match self.thing.as_mut() {
            Some(mine) => {
                std::mem::swap(mine, &mut boxed);
                Some(boxed)
            }
            None => {
                self.thing = Some(boxed);
                None
            }
        }
    }
    fn process(&mut self, io: &mut Io) {
        for note in io.ins.notes(0) {
            self.note(note.note, note.kind, note.offset);
        }
        let (l, r) = io.outs.audio(0);
        l.fill(0.0);
        r.fill(0.0);
        let Some(thing) = self.thing.as_deref() else {
            self.voices = [None; VOICES];
            return;
        };
        for slot in self.voices.iter_mut() {
            if let Some(v) = slot.as_mut() {
                if !Chop::mix(thing, v, l, r) {
                    *slot = None;
                }
            }
        }
        if let Some(v) = self.transport.as_mut() {
            if !Chop::mix(thing, v, l, r) {
                self.transport = None;
            }
        }
    }
}
