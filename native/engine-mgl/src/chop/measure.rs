//! What the page says of each slice (`ui/app/402-chop-listen.js`:
//! `chopMeasure`, `chopKindOf`, `chopAttackMs`, `chopNote`, `chopMedian`) and
//! of its tail (`405-chop-panel.js`: `chopTailUI`'s badges). Doubles, the
//! analysis's floats widened as the page reads them, in the page's order.

use super::{js, tail_params, Analysis, Page, Slice, TailParams};

/// `chopMeasure`'s answer, `x.m` on the page.
#[derive(Clone, Debug, PartialEq)]
pub struct Measure {
    pub low: f64,
    pub mid: f64,
    pub high: f64,
    pub cent: f64,
    pub flat: f64,
    pub zcr: f64,
    pub db: f64,
    pub peak_db: f64,
    pub crest: f64,
    pub dur: f64,
    pub clarity: f64,
    pub hz: f64,
    pub kind: &'static str,
}

/// `chopMedian`: the middle of the sorted values (the upper of two), 0 for none.
pub fn median(a: &[f64]) -> f64 {
    if a.is_empty() {
        return 0.0;
    }
    let mut v = a.to_vec();
    v.sort_by(|x, y| x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal));
    v[a.len() >> 1]
}

const NOTES: [&str; 12] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/// `chopNote`: the nearest note's name, as "C#3".
pub fn note(hz: f64) -> String {
    let m = js::round(69.0 + 12.0 * js::log2(hz / 440.0));
    let k = ((m % 12.0) + 12.0) % 12.0;
    format!("{}{}", NOTES[k as usize], js::num((m / 12.0).floor() - 1.0))
}

/// `chopKindOf`: what a hit most likely is.
pub fn kind_of(m: &Measure) -> &'static str {
    let hz = m.hz != 0.0 && !m.hz.is_nan();
    if m.db < -48.0 {
        "Quiet"
    } else if m.low > 0.55 && m.cent < 2000.0 && m.dur < 300.0 {
        "Kick"
    } else if m.low > 0.4 && hz && m.hz < 200.0 && m.clarity > 0.7 && (m.dur >= 150.0 || m.low > 0.6) {
        "Bass"
    } else if m.low > 0.6 {
        "Bass"
    } else if m.high > 0.6 && m.cent > 6800.0 {
        "Hat"
    } else if m.low < 0.3 && m.high > 0.2 && (m.flat > 0.1 || m.zcr > 0.05) {
        "Snare"
    } else if m.hz >= 200.0 && m.clarity > 0.72 && m.flat < 0.1 {
        "Tone"
    } else {
        "Perc"
    }
}

/// A row's tail badge, as `chopTailUI` sets it: its class (`""`, `skip`,
/// `clamped`, `ok`), its text and its title.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Badge {
    pub cls: &'static str,
    pub text: String,
    pub title: String,
}

impl Page {
    /// `chopMeasure(x)` from the sound's analysis.
    pub fn measure(&self, an: &Analysis, x: &Slice) -> Measure {
        let (fc, hop, n) = (an.frames as f64, an.hop as f64, an.n as f64);
        let clamp = |v: f64, lo: f64, hi: f64| js::max(lo, js::min(hi, v));
        let a = clamp(((x.s as f64 - n / 2.0) / hop).floor(), 0.0, fc - 1.0);
        let b = clamp(((x.e as f64 - n / 2.0) / hop).ceil(), a + 1.0, fc);
        let (a, b) = (a as usize, b as usize);
        let arrs: [&Vec<f32>; 6] = [&an.low, &an.mid, &an.high, &an.cent, &an.flat, &an.zcr];
        let mut g = [0.0f64; 6];
        let mut notes = Vec::new();
        let mut clarity = Vec::new();
        let mut w = 0.0f64;
        for f in a..b {
            let v = an.rms[f] as f64;
            let r = v * v + 1e-12;
            w += r;
            for (k, arr) in arrs.iter().enumerate() {
                g[k] += arr[f] as f64 * r;
            }
            if an.clar[f] as f64 > 0.7 && an.hz[f] > 0.0 {
                notes.push(an.hz[f] as f64);
            }
            clarity.push(an.clar[f] as f64);
        }
        for v in g.iter_mut() {
            *v /= w;
        }
        let m = &self.mono;
        let st = js::max(1.0, ((x.e - x.s) as f64 / 20000.0).floor()) as i64;
        let (mut pk, mut e) = (0.0f64, 0.0f64);
        let mut i = x.s;
        while i < x.e {
            let v = (m[i as usize] as f64).abs();
            if v > pk {
                pk = v;
            }
            e += v * v;
            i += st;
        }
        let rms = (e / ((x.e - x.s) as f64 / st as f64)).sqrt() + 1e-9;
        let enough = notes.len() as f64 >= js::max(2.0, (b - a) as f64 * 0.35);
        let mut r = Measure {
            low: g[0],
            mid: g[1],
            high: g[2],
            cent: g[3],
            flat: g[4],
            zcr: g[5],
            db: 20.0 * js::log10_system(rms),
            peak_db: 20.0 * js::log10_system(pk + 1e-9),
            crest: 20.0 * js::log10_system(pk / rms + 1e-9),
            dur: (x.e - x.s) as f64 / self.rate * 1000.0,
            clarity: median(&clarity),
            hz: if enough { median(&notes) } else { 0.0 },
            kind: "",
        };
        r.kind = kind_of(&r);
        r
    }

    /// `chopMeasureSlices`: every slice measured.
    pub fn measure_all(&self, an: &Analysis) -> Vec<Measure> {
        self.slices.iter().map(|x| self.measure(an, x)).collect()
    }

    /// `chopAttackMs(x)`: from a tenth of the first event's loudest to nine
    /// tenths of its top, in ms.
    pub fn attack_ms(&self, x: &Slice) -> f64 {
        let m = &self.mono;
        let hop = js::max(1.0, (self.rate / 1000.0).floor()) as i64;
        let upto = js::min(x.e as f64, x.s as f64 + self.rate * 2.0);
        let mut bins = Vec::new();
        let mut i = x.s;
        while (i as f64) < upto {
            let mut v = 0.0f64;
            for j in 0..hop {
                v = js::max(v, js::or0(js::at(m, (i + j) as f64)).abs());
            }
            bins.push(v);
            i += hop;
        }
        let env: Vec<f64> = (0..bins.len())
            .map(|i| {
                let mut v = 0.0f64;
                for &b in &bins[i..bins.len().min(i + 30)] {
                    v = js::max(v, b);
                }
                v
            })
            .collect();
        let mut loud = 1e-9f64;
        for &v in &env {
            if v > loud {
                loud = v;
            }
        }
        let start = env.iter().position(|&v| v >= loud * 0.1).unwrap_or(0);
        let mut top = 0.0f64;
        let mut end = env.len();
        for (k, &v) in env.iter().enumerate().skip(start) {
            if v > top {
                top = v;
            } else if v < top * 0.5 {
                end = k;
                break;
            }
        }
        for (k, &v) in env.iter().enumerate().take(end).skip(start) {
            if v >= top * 0.9 {
                return (k - start) as f64;
            }
        }
        0.0
    }

    /// `chopTailUI`: every row's badge, and the `#chopCycles` text.
    pub fn tail_badges(&self) -> (Vec<Badge>, String) {
        let cp = &self.settings;
        let on = cp.tail;
        let req = cp.tail_ms;
        let (mut eligible, mut skipped) = (0, 0);
        let badges = self
            .slices
            .iter()
            .map(|x| {
                let (s, e) = (x.s, x.s + js::max(1.0, js::round((x.e - x.s) as f64 * cp.gate / 100.0)) as i64);
                if !on {
                    return Badge { cls: "", text: String::new(), title: String::new() };
                }
                match tail_params(s, e, req, self.rate) {
                    TailParams::No { reason } => {
                        skipped += 1;
                        Badge { cls: "skip", text: "too short".into(), title: reason }
                    }
                    TailParams::Yes(p) if p.clamped => {
                        eligible += 1;
                        let ms = js::fixed(p.actual_ms, 0);
                        Badge { cls: "clamped", text: format!("↓{ms} ms"), title: format!("requested {}ms clamped to {ms}ms", js::num(req)) }
                    }
                    TailParams::Yes(p) => {
                        eligible += 1;
                        Badge {
                            cls: "ok",
                            text: format!("{} ms", js::fixed(p.actual_ms, 0)),
                            title: format!("{} cycles · ~{}s", p.num_cycles, js::fixed(p.num_cycles as f64 * p.actual_ms / 1000.0, 2)),
                        }
                    }
                }
            })
            .collect();
        let cycles = if on {
            let mut parts = Vec::new();
            if eligible > 0 {
                parts.push(format!("{eligible} ok"));
            }
            if skipped > 0 {
                parts.push(format!("{skipped} short"));
            }
            parts.join(" · ")
        } else {
            format!("{} cycles", js::num(js::max(2.0, js::min(8.0, (500.0 / req).ceil()))))
        };
        (badges, cycles)
    }
}
