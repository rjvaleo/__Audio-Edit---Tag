//! The pad and its takes: `ui/app/385-hyperstretch.js` (the `hs` object),
//! ported line for line from the page's JavaScript, in doubles as the page
//! computes. Times are the face's clock in milliseconds (the page's
//! `performance.now()`), handed in, so a test can play a take exactly.
//!
//! What moving the pad does to the sound (`hsApply`) is the module's
//! (`mod.rs`): this says where the hand is and what the two controls are to
//! be; the module writes them as the page writes them.

use engine_mgl::chop::js;
use serde_json::{json, Value};

/// `HS_TICK`: a take holds at most a point per tick.
pub const HS_TICK: f64 = 1000.0 / 60.15;

pub fn clamp01(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}

/// `hsCoef`: the one-pole coefficient Hyperprism's Smoothing (%) stands for.
pub fn coef(s: f64) -> f64 {
    (f64::powf(10.0, 0.04 * (100.0 - s)) + 1e-9).floor() * 0.0001
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Pt {
    pub x: f64,
    pub y: f64,
    pub t: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Take {
    pub pts: Vec<Pt>,
    pub dur: f64,
    pub shape: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Lim {
    pub x_lo: f64,
    pub x_hi: f64,
    pub y_lo: f64,
    pub y_hi: f64,
}

/// An axis's control, as far as the pad's arithmetic needs it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Axis {
    pub log: bool,
    pub stepped: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Ready,
    Rec,
    Play,
    Pause,
}

impl Mode {
    pub fn name(self) -> &'static str {
        match self {
            Mode::Ready => "ready",
            Mode::Rec => "rec",
            Mode::Play => "play",
            Mode::Pause => "pause",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Anchor {
    x: f64,
    y: f64,
    mode: Option<u8>, // 0 h, 1 v, 2 diag, 3 anti
}

/// What a move asks of the module: the hand moved (write both controls),
/// the deck to play or pause, the glide to be sent, the take store to keep.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Asks {
    pub apply: bool,
    pub play: bool,
    pub pause: bool,
    pub glide: bool,
    pub commit: bool,
    pub keep: bool,
}

impl Asks {
    fn or(&mut self, o: Asks) {
        self.apply |= o.apply;
        self.play |= o.play;
        self.pause |= o.pause;
        self.glide |= o.glide;
        self.commit |= o.commit;
        self.keep |= o.keep;
    }
}

/// The page's `hs`.
#[derive(Debug, Clone)]
pub struct Pad {
    pub w: f64,
    pub h: f64,
    pub axes: (Option<String>, Option<String>),
    pub ax: (Axis, Axis),
    pub lim: Lim,
    pub hand: (f64, f64),
    pub mode: Mode,
    pub slot: usize,
    pub slots: [Option<Take>; 4],
    pub rec: Option<Vec<Pt>>,
    rec_t0: f64,
    last_tick: i64,
    t0: f64,
    pause_at: f64,
    pub rate: f64,
    pub dir: String,
    pub glide: f64,
    pub throw_on: bool,
    pub loop_on_release: bool,
    pub down: bool,
    pub hover: Option<(f64, f64)>,
    vel: (f64, f64),
    prev: Option<((f64, f64), f64)>,
    anchor: Option<Anchor>,
    pub ghost: Option<(f64, f64)>,
    last: f64,
    held_play: bool,
    /// The glide last sent (`hs.sent`).
    pub sent: Option<f64>,
    rng: u64,
}

impl Default for Pad {
    fn default() -> Self {
        Pad {
            w: 220.0,
            h: 220.0,
            axes: (Some("ratio".into()), Some("semitones".into())),
            ax: (Axis { log: true, stepped: false }, Axis { log: false, stepped: false }),
            lim: Lim { x_lo: 100.0, x_hi: 0.01, y_lo: -48.0, y_hi: 48.0 },
            hand: (0.5, 0.5),
            mode: Mode::Ready,
            slot: 0,
            slots: [None, None, None, None],
            rec: None,
            rec_t0: 0.0,
            last_tick: -1,
            t0: 0.0,
            pause_at: 0.0,
            rate: 1.0,
            dir: "fwd".into(),
            glide: 50.0,
            throw_on: false,
            loop_on_release: false,
            down: false,
            hover: None,
            vel: (0.0, 0.0),
            prev: None,
            anchor: None,
            ghost: None,
            last: 0.0,
            held_play: false,
            sent: None,
            rng: 0x2545_f491_4f6c_dd1d,
        }
    }
}

impl Pad {
    // ───────────────────────────────────────────── the arithmetic

    fn span(&self, x_axis: bool, lim: &Lim) -> (f64, f64, bool) {
        let (lo, hi) = if x_axis { (lim.x_lo, lim.x_hi) } else { (lim.y_lo, lim.y_hi) };
        let a = if x_axis { self.ax.0 } else { self.ax.1 };
        (lo, hi, a.log && lo > 0.0 && hi > 0.0)
    }

    /// `hsValue`.
    pub fn value_in(&self, x_axis: bool, f: f64, lim: &Lim) -> f64 {
        let (lo, hi, log) = self.span(x_axis, lim);
        let t = if x_axis { f } else { 1.0 - f };
        let v = if log { lo * f64::powf(hi / lo, t) } else { lo + t * (hi - lo) };
        let a = if x_axis { self.ax.0 } else { self.ax.1 };
        if a.stepped {
            js_round(v)
        } else {
            v
        }
    }

    pub fn value(&self, x_axis: bool, f: f64) -> f64 {
        self.value_in(x_axis, f, &self.lim)
    }

    /// `hsFrac`.
    pub fn frac_in(&self, x_axis: bool, v: f64, lim: &Lim) -> f64 {
        let (lo, hi, log) = self.span(x_axis, lim);
        if !v.is_finite() || lo == hi {
            return 0.5;
        }
        let t = if log {
            if v > 0.0 {
                js::log(v / lo) / js::log(hi / lo)
            } else {
                0.0
            }
        } else {
            (v - lo) / (hi - lo)
        };
        if x_axis {
            t
        } else {
            1.0 - t
        }
    }

    pub fn frac(&self, x_axis: bool, v: f64) -> f64 {
        self.frac_in(x_axis, v, &self.lim)
    }

    /// `hsRescale`: a new window, every point keeping its value.
    pub fn rescale(&mut self, next: Lim) {
        let o = self.lim;
        let mx = |p: &Pad, x: f64| p.frac_in(true, p.value_in(true, x, &o), &next);
        let my = |p: &Pad, y: f64| p.frac_in(false, p.value_in(false, y, &o), &next);
        let me = self.clone();
        for s in self.slots.iter_mut().flatten() {
            for q in s.pts.iter_mut() {
                *q = Pt { x: mx(&me, q.x), y: my(&me, q.y), t: q.t };
            }
        }
        if let Some(r) = self.rec.as_mut() {
            for q in r.iter_mut() {
                *q = Pt { x: mx(&me, q.x), y: my(&me, q.y), t: q.t };
            }
        }
        self.hand = (mx(&me, self.hand.0), my(&me, self.hand.1));
        self.lim = next;
    }

    // ───────────────────────────────────────────── the hand

    /// `hsLock`: Shift's lock, in pad pixels.
    fn lock(&mut self, p: (f64, f64), shift: bool) -> (f64, f64) {
        if !shift {
            self.anchor = None;
            return p;
        }
        let (w, h) = (self.w, self.h);
        if self.anchor.is_none() {
            self.anchor = Some(Anchor { x: self.hand.0, y: self.hand.1, mode: None });
        }
        let a = self.anchor.as_mut().unwrap();
        let (dh, dv) = ((p.0 - a.x) * w, (p.1 - a.y) * h);
        if a.mode.is_none() && (dh.abs() >= 1.0 || dv.abs() >= 1.0) {
            a.mode = Some(if (dh.abs() - dv.abs()).abs() < 1.0 {
                if js_sign(dh) == js_sign(dv) {
                    2
                } else {
                    3
                }
            } else if dh.abs() > dv.abs() {
                0
            } else {
                1
            });
        }
        let a = *a;
        match a.mode {
            Some(0) => (p.0, a.y),
            Some(1) => (a.x, p.1),
            Some(2) => (clamp01(a.x + dv / w), p.1),
            Some(3) => (clamp01(a.x - dv / w), p.1),
            _ => p,
        }
    }

    /// `hsMoveTo`.
    fn move_to(&mut self, p: (f64, f64), t: f64, record: bool) -> Asks {
        self.hand = p;
        if record && self.mode == Mode::Rec {
            self.add_point(p, t);
        }
        Asks { apply: true, ..Asks::default() }
    }

    /// `pointerdown`. `playing`: the deck is playing; `has_sound`: it has one.
    pub fn down(&mut self, p: (f64, f64), t: f64, has_sound: bool, playing: bool) -> Asks {
        if self.mode == Mode::Pause {
            return Asks::default();
        }
        let p = (clamp01(p.0), clamp01(p.1));
        self.anchor = None;
        self.prev = Some((p, t));
        self.down = true;
        self.vel = (0.0, 0.0);
        self.held_play = has_sound && !playing;
        let mut a = Asks::default();
        if self.mode != Mode::Rec {
            a.or(self.start_rec(t, has_sound, playing));
        }
        if self.held_play {
            a.play = true;
        }
        a.or(self.move_to(p, t, true));
        a
    }

    /// `pointermove`.
    pub fn moved(&mut self, raw: (f64, f64), t: f64, shift: bool) -> Asks {
        let raw = (clamp01(raw.0), clamp01(raw.1));
        self.hover = Some(raw);
        if !self.down {
            return Asks::default();
        }
        let p = self.lock(raw, shift);
        let (pp, pt) = self.prev.unwrap_or((p, t));
        let dt = (t - pt).max(1.0);
        self.vel = ((p.0 - pp.0) / dt, (p.1 - pp.1) / dt);
        self.prev = Some((p, t));
        self.move_to(p, t, true)
    }

    /// `pointerleave`.
    pub fn leave(&mut self) {
        if !self.down {
            self.hover = None;
        }
    }

    /// `release`. `playing`: the deck is playing.
    pub fn up(&mut self, t: f64, playing: bool) -> Asks {
        if !self.down {
            return Asks::default();
        }
        self.down = false;
        let pt = self.prev.map(|(_, pt)| pt).unwrap_or(t);
        let thrown = self.throw_on && t - pt < 60.0 && js::hypot(self.vel.0, self.vel.1) > 1e-5;
        if !thrown {
            self.vel = (0.0, 0.0);
        }
        let goes_on = thrown || (self.loop_on_release && self.mode == Mode::Rec);
        let mut a = Asks::default();
        if self.loop_on_release && self.mode == Mode::Rec && !thrown {
            self.stop_rec(t);
            a.or(self.play(t, true, playing));
            a.play = false;
        }
        if self.held_play && !goes_on && playing {
            a.pause = true;
        }
        self.held_play = false;
        a.commit = true;
        a.keep = true;
        a
    }

    /// `dblclick`: the point to the centre.
    pub fn centre(&mut self, t: f64) -> Asks {
        if self.mode == Mode::Rec {
            self.stop_rec(t);
        }
        if self.mode == Mode::Play {
            self.mode = Mode::Ready;
        }
        let mut a = self.move_to((0.5, 0.5), t, false);
        a.commit = true;
        a.keep = true;
        a
    }

    /// `keydown`: an arrow nudges, only while recording; `alt` ×10.
    pub fn nudge(&mut self, dx: f64, dy: f64, alt: bool, t: f64) -> Asks {
        if self.mode != Mode::Rec {
            return Asks::default();
        }
        let px = if alt { 10.0 } else { 1.0 };
        let p = (clamp01(self.hand.0 + dx * px / self.w), clamp01(self.hand.1 + dy * px / self.h));
        self.move_to(p, t, true)
    }

    // ───────────────────────────────────────────── the transport

    /// ●.
    pub fn rec_button(&mut self, t: f64, has_sound: bool, playing: bool) -> Asks {
        if self.mode == Mode::Rec {
            return Asks::default();
        }
        let mut a = self.start_rec(t, has_sound, playing);
        self.add_point(self.hand, t);
        a.keep = true;
        a
    }

    /// ▶.
    pub fn play_button(&mut self, t: f64, has_sound: bool, playing: bool) -> Asks {
        if self.mode == Mode::Pause {
            self.t0 += t - self.pause_at;
            self.mode = Mode::Play;
            return Asks::default();
        }
        if self.mode == Mode::Rec {
            self.stop_rec(t);
        }
        let mut a = self.play(t, has_sound, playing);
        a.keep = true;
        a
    }

    /// ❚❚.
    pub fn pause_button(&mut self, t: f64) {
        if self.mode == Mode::Play {
            self.mode = Mode::Pause;
            self.pause_at = t;
        } else if self.mode == Mode::Pause {
            self.t0 += t - self.pause_at;
            self.mode = Mode::Play;
        }
    }

    /// ■: ends a take.
    pub fn stop_button(&mut self, t: f64) -> Asks {
        if self.mode == Mode::Rec {
            self.stop_rec(t);
        }
        self.mode = Mode::Ready;
        self.vel = (0.0, 0.0);
        Asks { commit: true, keep: true, ..Asks::default() }
    }

    /// ⏮.
    pub fn rewind(&mut self, t: f64) -> Asks {
        self.t0 = t;
        let first = self.slots[self.slot].as_ref().and_then(|s| s.pts.first().copied());
        match first {
            Some(q) => self.move_to((q.x, q.y), t, false),
            None => Asks::default(),
        }
    }

    fn start_rec(&mut self, t: f64, has_sound: bool, playing: bool) -> Asks {
        self.rec = Some(Vec::new());
        self.rec_t0 = t;
        self.last_tick = -1;
        self.mode = Mode::Rec;
        Asks { glide: true, play: has_sound && !playing, ..Asks::default() }
    }

    /// `hsAddPoint`: at most one a tick, on the tick grid.
    fn add_point(&mut self, p: (f64, f64), t: f64) {
        let Some(rec) = self.rec.as_mut() else { return };
        let tick = ((t - self.rec_t0) / HS_TICK).floor() as i64;
        if tick == self.last_tick {
            if let Some(q) = rec.last_mut() {
                q.x = p.0;
                q.y = p.1;
            }
            return;
        }
        self.last_tick = tick;
        rec.push(Pt { x: p.0, y: p.1, t: tick as f64 * HS_TICK });
    }

    fn stop_rec(&mut self, t: f64) {
        let Some(rec) = self.rec.take() else { return };
        if !rec.is_empty() {
            self.slots[self.slot] = Some(Take { pts: rec, dur: HS_TICK.max(t - self.rec_t0), shape: None });
        }
        self.mode = Mode::Ready;
    }

    fn play(&mut self, t: f64, has_sound: bool, playing: bool) -> Asks {
        if self.slots[self.slot].as_ref().is_none_or(|s| s.pts.is_empty()) {
            self.mode = Mode::Ready;
            return Asks::default();
        }
        self.mode = Mode::Play;
        self.t0 = t;
        Asks { glide: true, play: has_sound && !playing, ..Asks::default() }
    }

    /// A take's slot chosen.
    pub fn pick_slot(&mut self, i: usize, t: f64) -> Asks {
        if self.mode == Mode::Rec {
            self.stop_rec(t);
        }
        self.slot = i.min(3);
        if self.mode == Mode::Play && self.slots[self.slot].is_none() {
            self.mode = Mode::Ready;
        }
        Asks { keep: true, ..Asks::default() }
    }

    fn random(&mut self) -> f64 {
        // xorshift64*: the page's Math.random, which no two runs share anyway.
        self.rng ^= self.rng >> 12;
        self.rng ^= self.rng << 25;
        self.rng ^= self.rng >> 27;
        (self.rng.wrapping_mul(0x2545_f491_4f6c_dd1d) >> 11) as f64 / (1u64 << 53) as f64
    }

    /// `hsShape`: a shape drawn into the take, and played.
    pub fn shape(&mut self, kind: &str, t: f64, has_sound: bool, playing: bool) -> Asks {
        let dur = 4000.0;
        let n = (dur / HS_TICK).floor() as usize;
        let mut pts = Vec::with_capacity(n);
        let (mut rx, mut ry, mut vx, mut vy) = (self.hand.0, self.hand.1, 0.0f64, 0.0f64);
        let pi = std::f64::consts::PI;
        for i in 0..n {
            let a = (i as f64 / n as f64) * pi * 2.0;
            let (x, y) = match kind {
                "circle" => (0.5 + 0.38 * super::jsmath::cos(a), 0.5 + 0.38 * super::jsmath::sin(a)),
                "eight" => (0.5 + 0.38 * super::jsmath::sin(a), 0.5 + 0.36 * super::jsmath::sin(2.0 * a)),
                "liss" => (0.5 + 0.4 * super::jsmath::sin(3.0 * a), 0.5 + 0.4 * super::jsmath::sin(2.0 * a + 0.6)),
                _ => {
                    vx = vx * 0.96 + (self.random() - 0.5) * 0.004;
                    vy = vy * 0.96 + (self.random() - 0.5) * 0.004;
                    rx = clamp01(rx + vx);
                    ry = clamp01(ry + vy);
                    (rx, ry)
                }
            };
            pts.push(Pt { x: clamp01(x), y: clamp01(y), t: i as f64 * HS_TICK });
        }
        if self.mode == Mode::Rec {
            self.rec = None;
        }
        self.slots[self.slot] = Some(Take { pts, dur, shape: Some(kind.to_string()) });
        let mut a = self.play(t, has_sound, playing);
        a.keep = true;
        a
    }

    /// The source or the sound changed: a take ends, a playing one stops.
    pub fn interrupt(&mut self, t: f64) {
        if self.mode == Mode::Rec {
            self.stop_rec(t);
        }
        if self.mode == Mode::Play {
            self.mode = Mode::Ready;
        }
    }

    // ───────────────────────────────────────────── time

    /// `hsFrame`: the take's clock, the throw, and the ring.
    pub fn frame(&mut self, now: f64) -> Asks {
        let dt = 100f64.min(now - if self.last == 0.0 { now } else { self.last });
        self.last = now;
        let mut a = Asks::default();
        if self.mode == Mode::Play {
            if let Some(take) = self.slots[self.slot].as_ref().filter(|s| !s.pts.is_empty()) {
                let e = (now - self.t0) * self.rate;
                let d = take.dur;
                let u = if self.dir == "pp" {
                    let m = e % (2.0 * d);
                    if m < d {
                        m
                    } else {
                        2.0 * d - m
                    }
                } else {
                    let u = e % d;
                    if self.dir == "rev" {
                        d - u
                    } else {
                        u
                    }
                };
                let (mut lo, mut hi, mut k) = (0i64, take.pts.len() as i64 - 1, 0usize);
                while lo <= hi {
                    let mid = (lo + hi) >> 1;
                    if take.pts[mid as usize].t <= u {
                        k = mid as usize;
                        lo = mid + 1;
                    } else {
                        hi = mid - 1;
                    }
                }
                let q = take.pts[k];
                if q.x != self.hand.0 || q.y != self.hand.1 {
                    a.or(self.move_to((q.x, q.y), now, false));
                }
            }
        } else if self.throw_on && !self.down && self.mode != Mode::Pause && self.vel.0.abs() + self.vel.1.abs() > 2e-5 {
            let (mut x, mut y) = (self.hand.0 + self.vel.0 * dt, self.hand.1 + self.vel.1 * dt);
            let (mut vx, mut vy) = self.vel;
            if x < 0.0 {
                x = -x;
                vx = -vx;
            }
            if x > 1.0 {
                x = 2.0 - x;
                vx = -vx;
            }
            if y < 0.0 {
                y = -y;
                vy = -vy;
            }
            if y > 1.0 {
                y = 2.0 - y;
                vy = -vy;
            }
            let f = f64::powf(0.9988, dt);
            self.vel = (vx * f, vy * f);
            a.or(self.move_to((x, y), now, true));
        }
        let k = 1.0 - f64::powf(1.0 - coef(self.glide), dt * 44.1 / 512.0);
        let g = self.ghost.get_or_insert(self.hand);
        g.0 += (self.hand.0 - g.0) * k;
        g.1 += (self.hand.1 - g.1) * k;
        a
    }

    // ───────────────────────────────────────────── kept

    /// What `hsSaveTakes` keeps: `{lim, axes, slots}`.
    pub fn takes_json(&self) -> Value {
        let slots: Vec<Value> = self.slots.iter().map(|s| s.as_ref().map_or(Value::Null, take_json)).collect();
        json!({
            "lim": { "xLo": self.lim.x_lo, "xHi": self.lim.x_hi, "yLo": self.lim.y_lo, "yHi": self.lim.y_hi },
            "axes": { "x": self.axes.0, "y": self.axes.1 },
            "slots": slots,
        })
    }

    /// `hsLoadTakes`' first half: the takes kept, with their window and axes.
    pub fn load_takes(&mut self, kept: Option<&Value>) {
        self.slots = [None, None, None, None];
        self.axes = (None, None);
        let Some(kept) = kept else { return };
        if let Some(a) = kept.get("slots").and_then(Value::as_array) {
            for (i, s) in a.iter().take(4).enumerate() {
                self.slots[i] = take_from(s);
            }
            if let Some(l) = kept.get("lim").and_then(lim_from) {
                let old = l.x_lo == 4.0 && l.x_hi == 0.25 && l.y_lo == -12.0 && l.y_hi == 12.0;
                if !old {
                    self.lim = l;
                }
            }
            if let Some(a) = kept.get("axes") {
                self.axes = (a.get("x").and_then(Value::as_str).map(str::to_string), a.get("y").and_then(Value::as_str).map(str::to_string));
            }
        }
    }

    /// The settings the page keeps in `hyperstretch.settings`.
    pub fn settings_json(&self) -> Value {
        json!({ "glide": self.glide, "throwOn": self.throw_on, "loopOnRelease": self.loop_on_release, "rate": self.rate, "dir": self.dir, "where": "loop" })
    }

    pub fn settings_from(&mut self, v: &Value) {
        if let Some(g) = v.get("glide").and_then(Value::as_f64) {
            self.glide = g;
        }
        if let Some(b) = v.get("throwOn").and_then(Value::as_bool) {
            self.throw_on = b;
        }
        if let Some(b) = v.get("loopOnRelease").and_then(Value::as_bool) {
            self.loop_on_release = b;
        }
        if let Some(r) = v.get("rate").and_then(Value::as_f64) {
            self.rate = r;
        }
        if let Some(d) = v.get("dir").and_then(Value::as_str) {
            self.dir = d.to_string();
        }
    }

    /// What the face draws from.
    pub fn view(&self) -> Value {
        let pts = if self.mode == Mode::Rec { self.rec.as_ref() } else { self.slots[self.slot].as_ref().map(|s| &s.pts) };
        let path: Vec<f64> = pts.map(|p| p.iter().flat_map(|q| [q.x, q.y]).collect()).unwrap_or_default();
        let slots: Vec<Value> = self
            .slots
            .iter()
            .map(|s| match s {
                Some(s) => json!({ "dur": s.dur, "n": s.pts.len(), "shape": s.shape, "thumb": s.pts.iter().step_by(3).flat_map(|q| [q.x, q.y]).collect::<Vec<f64>>() }),
                None => Value::Null,
            })
            .collect();
        json!({
            "hand": [self.hand.0, self.hand.1],
            "ghost": self.ghost.map(|g| vec![g.0, g.1]).unwrap_or_else(|| vec![self.hand.0, self.hand.1]),
            "hover": self.hover.map(|h| vec![h.0, h.1]),
            "down": self.down,
            "mode": self.mode.name(),
            "slot": self.slot,
            "slots": slots,
            "path": path,
            "recN": self.rec.as_ref().map(Vec::len),
            "rate": self.rate, "dir": self.dir, "glide": self.glide,
            "throwOn": self.throw_on, "loopOnRelease": self.loop_on_release,
            "lim": { "xLo": self.lim.x_lo, "xHi": self.lim.x_hi, "yLo": self.lim.y_lo, "yHi": self.lim.y_hi },
            "size": [self.w, self.h],
        })
    }
}

fn take_json(s: &Take) -> Value {
    let pts: Vec<Value> = s.pts.iter().map(|q| json!({ "x": q.x, "y": q.y, "t": q.t })).collect();
    let mut v = json!({ "pts": pts, "dur": s.dur });
    if let Some(k) = &s.shape {
        v["shape"] = k.as_str().into();
    }
    v
}

fn take_from(v: &Value) -> Option<Take> {
    let pts = v.get("pts")?.as_array()?;
    let pts: Vec<Pt> = pts
        .iter()
        .filter_map(|q| Some(Pt { x: q.get("x")?.as_f64()?, y: q.get("y")?.as_f64()?, t: q.get("t")?.as_f64()? }))
        .collect();
    Some(Take { pts, dur: v.get("dur").and_then(Value::as_f64).unwrap_or(HS_TICK), shape: v.get("shape").and_then(Value::as_str).map(str::to_string) })
}

pub fn lim_from(v: &Value) -> Option<Lim> {
    let n = |k: &str| v.get(k).and_then(Value::as_f64);
    Some(Lim { x_lo: n("xLo")?, x_hi: n("xHi")?, y_lo: n("yLo")?, y_hi: n("yHi")? })
}

/// JavaScript's `Math.round` (halves go up).
pub fn js_round(v: f64) -> f64 {
    (v + 0.5).floor()
}

fn js_sign(v: f64) -> i8 {
    if v > 0.0 {
        1
    } else if v < 0.0 {
        -1
    } else {
        0
    }
}
