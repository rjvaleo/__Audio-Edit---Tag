//! The Prism page's four LFOs (`ui/app/387-prism-lfo.js`), moved to the app:
//! each with a shape, a rate, a depth and a pulse width; all four always run;
//! a mapped control's value swings around its setting by Depth's share of
//! half its range, heard by the deck and never kept (`live`). The page ticks
//! them each animation frame and sends a swing every 33 ms; the app's face
//! ticks them each frame the same way.

use serde_json::{json, Value};

pub const SHAPES: [&str; 6] = ["sine", "triangle", "square", "saw", "random", "pulse"];
/// `PRISM_LFO_SEND_MS`.
pub const SEND_MS: f64 = 33.0;

#[derive(Debug, Clone, PartialEq)]
pub struct Target {
    pub src: String,
    pub key: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Lfo {
    pub i: u32,
    pub shape: String,
    pub rate: f64,
    pub depth: f64,
    pub pw: f64,
    pub phase: f64,
    pub held: f64,
    pub targets: Vec<Target>,
}

#[derive(Debug, Clone)]
pub struct Lfos {
    pub lfos: Vec<Lfo>,
    pub sel: usize,
    pub mapping: bool,
    pub sent: f64,
    rng: u64,
}

impl Default for Lfos {
    fn default() -> Self {
        let shapes = ["sine", "triangle", "saw", "random"];
        let rates = [0.5, 1.3, 0.25, 4.0];
        Lfos {
            lfos: (0..4).map(|k| Lfo { i: k as u32 + 1, shape: shapes[k].into(), rate: rates[k], depth: 25.0, pw: 25.0, phase: 0.0, held: 0.5, targets: Vec::new() }).collect(),
            sel: 0,
            mapping: false,
            sent: f64::NEG_INFINITY,
            rng: 0x9e37_79b9_7f4a_7c15,
        }
    }
}

/// `prismLfoAt`: one LFO's value, −1…1, at phase `ph` (in cycles).
pub fn at(shape: &str, pw: f64, held: f64, ph: f64) -> f64 {
    let u = ((ph % 1.0) + 1.0) % 1.0;
    match shape {
        "sine" => super::jsmath::sin(u * 2.0 * std::f64::consts::PI),
        "triangle" => 1.0 - 4.0 * (u - 0.5).abs(),
        "square" => {
            if u < 0.5 {
                1.0
            } else {
                -1.0
            }
        }
        "saw" => 2.0 * u - 1.0,
        "pulse" => {
            if u < pw / 100.0 {
                1.0
            } else {
                -1.0
            }
        }
        _ => held * 2.0 - 1.0,
    }
}

impl Lfo {
    pub fn now(&self) -> f64 {
        at(&self.shape, self.pw, self.held, self.phase)
    }

    pub fn drives(&self, src: &str, key: &str) -> bool {
        self.targets.iter().any(|t| t.src == src && t.key == key)
    }
}

impl Lfos {
    fn random(&mut self) -> f64 {
        self.rng ^= self.rng >> 12;
        self.rng ^= self.rng << 25;
        self.rng ^= self.rng >> 27;
        (self.rng.wrapping_mul(0x2545_f491_4f6c_dd1d) >> 11) as f64 / (1u64 << 53) as f64
    }

    /// The phases on by `dt` seconds (at most 0.1, as the page caps it); a
    /// random one holds a new value each cycle.
    pub fn advance(&mut self, dt: f64) {
        let dt = dt.clamp(0.0, 0.1);
        for k in 0..self.lfos.len() {
            let before = self.lfos[k].phase.floor();
            self.lfos[k].phase += self.lfos[k].rate * dt;
            if self.lfos[k].phase.floor() != before {
                let r = self.random();
                self.lfos[k].held = r;
            }
        }
    }

    /// `prismLfoValue`: the value the deck hears for a control of range
    /// `min..max` whose setting is `base`.
    pub fn value(&self, src: &str, key: &str, min: f64, max: f64, stepped: bool, base: f64) -> f64 {
        let mut v = base;
        for l in &self.lfos {
            if l.drives(src, key) {
                v += l.now() * (l.depth / 100.0) * (max - min) / 2.0;
            }
        }
        v = v.clamp(min, max);
        if stepped {
            super::takes::js_round(v)
        } else {
            v
        }
    }

    /// Every target any LFO has, once each.
    pub fn targets(&self) -> Vec<Target> {
        let mut out: Vec<Target> = Vec::new();
        for l in &self.lfos {
            for t in &l.targets {
                if !out.contains(t) {
                    out.push(t.clone());
                }
            }
        }
        out
    }

    /// `prismLfoToggle`: map or unmap a control on the selected LFO; the
    /// mapping ends. Whether no LFO drives it any more (put it back).
    pub fn toggle(&mut self, t: Target) -> bool {
        let l = &mut self.lfos[self.sel];
        match l.targets.iter().position(|x| *x == t) {
            Some(k) => {
                l.targets.remove(k);
            }
            None => l.targets.push(t.clone()),
        }
        self.mapping = false;
        !self.lfos.iter().any(|l| l.targets.contains(&t))
    }

    /// The reach a control shows: each LFO on it, Depth's share of half the
    /// range; and the first one's number (its colour).
    pub fn reach(&self, src: &str, key: &str) -> Option<(f64, u32)> {
        let on: Vec<&Lfo> = self.lfos.iter().filter(|l| l.drives(src, key)).collect();
        let first = on.first()?.i;
        Some((on.iter().map(|l| l.depth / 200.0).sum(), first))
    }

    /// What the page keeps per sound (`prismLfoKeep`).
    pub fn to_json(&self) -> Value {
        let lfos: Vec<Value> = self
            .lfos
            .iter()
            .map(|l| json!({ "shape": l.shape, "rate": l.rate, "depth": l.depth, "pw": l.pw, "targets": l.targets.iter().map(|t| json!({ "src": t.src, "key": t.key })).collect::<Vec<_>>() }))
            .collect();
        Value::Array(lfos)
    }

    /// `prismLfoLoad`.
    pub fn load(&mut self, kept: Option<&Value>) {
        for (k, l) in self.lfos.iter_mut().enumerate() {
            let g = kept.and_then(|v| v.get(k));
            l.targets = g
                .and_then(|g| g.get("targets"))
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(|t| Some(Target { src: t.get("src")?.as_str().filter(|s| !s.is_empty())?.to_string(), key: t.get("key")?.as_str().filter(|s| !s.is_empty())?.to_string() }))
                        .collect()
                })
                .unwrap_or_default();
            if let Some(g) = g {
                if let Some(s) = g.get("shape").and_then(Value::as_str) {
                    l.shape = s.to_string();
                }
                for (f, slot) in [("rate", &mut l.rate), ("depth", &mut l.depth), ("pw", &mut l.pw)] {
                    if let Some(n) = g.get(f).and_then(Value::as_f64) {
                        *slot = n;
                    }
                }
            }
        }
    }

    /// What the face draws: each LFO now.
    pub fn view(&self) -> Value {
        let lfos: Vec<Value> = self
            .lfos
            .iter()
            .map(|l| json!({ "i": l.i, "shape": l.shape, "rate": l.rate, "depth": l.depth, "pw": l.pw, "phase": l.phase, "held": l.held, "now": l.now(), "targets": l.targets.iter().map(|t| json!({ "src": t.src, "key": t.key })).collect::<Vec<_>>() }))
            .collect();
        json!({ "lfos": lfos, "sel": self.sel, "mapping": self.mapping })
    }
}
