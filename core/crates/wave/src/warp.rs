//! The warp slots: what the mock-up kit's `warp()` does to a frame, as a
//! function of phase the oscillator can evaluate per sample.
//!
//! The kit warps a 256-point array and reads the result back with linear
//! interpolation. Here the same maps are applied to the phase (or to the value)
//! on every sample, so the result is the continuous version of the kit's
//! picture: identical maps, no 256-point grid.
//!
//! Two kinds:
//! - **phase warps** (`bend sync pwm mirror asym fm`) move where in the frame
//!   the oscillator reads;
//! - **value warps** (`fold quant`) change what it reads.
//!
//! Two slots chain as the kit chains them: `waveFor` applies slot 0 to the
//! frame and then slot 1 to the result, so slot 1's phase map runs first and
//! slot 0's runs on what it produced. `osc.rs` does that composition.
//!
//! At an amount of zero every mode is the identity, exactly: the kit returns
//! the frame untouched when `w <= 0`, and so does [`Warp::new`]. That matters
//! for `mirror` and `quant`, whose formulas are *not* the identity at zero.
//!
//! # Slope, for the mip level
//!
//! A phase warp reads the frame faster than the phase moves on part of the
//! cycle, and a value warp adds harmonics. Either way the band-limited level
//! has to be chosen for the steepest part, not the average, or the warp aliases.
//! [`Warp::slope`] is that worst case for each mode: the largest derivative of
//! the phase map, or the gain a fold applies. Sync is `1 + amt·6`, as the
//! contract says. Quant is a staircase, which no level can band-limit, so it
//! asks for nothing extra; it is meant to be gritty. FM's slope depends on the
//! modulator's own steepness, so the oscillator adds it (see `osc.rs`).

/// A warp slot's mode, as the patch names it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum WarpMode {
    #[default]
    Off,
    Bend,
    Sync,
    Pwm,
    Fold,
    Mirror,
    Asym,
    Quant,
    Fm,
}

impl WarpMode {
    pub const ALL: [WarpMode; 9] = [
        WarpMode::Off,
        WarpMode::Bend,
        WarpMode::Sync,
        WarpMode::Pwm,
        WarpMode::Fold,
        WarpMode::Mirror,
        WarpMode::Asym,
        WarpMode::Quant,
        WarpMode::Fm,
    ];

    pub fn parse(s: &str) -> Option<WarpMode> {
        WarpMode::ALL.into_iter().find(|m| m.as_str() == s)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            WarpMode::Off => "off",
            WarpMode::Bend => "bend",
            WarpMode::Sync => "sync",
            WarpMode::Pwm => "pwm",
            WarpMode::Fold => "fold",
            WarpMode::Mirror => "mirror",
            WarpMode::Asym => "asym",
            WarpMode::Quant => "quant",
            WarpMode::Fm => "fm",
        }
    }
}

/// One slot with its constants worked out, once per control block.
#[derive(Clone, Copy, Debug)]
pub struct Warp {
    pub mode: WarpMode,
    pub amt: f32,
    /// The mode's constant: bend's exponent, sync's ratio, the split point of
    /// pwm/asym/mirror, fold's gain, quant's step count, fm's depth.
    k: f32,
}

impl Warp {
    pub const OFF: Warp = Warp { mode: WarpMode::Off, amt: 0.0, k: 0.0 };

    pub fn new(mode: WarpMode, amt: f32) -> Warp {
        let w = if amt.is_finite() { amt.clamp(0.0, 1.0) } else { 0.0 };
        if mode == WarpMode::Off || w <= 0.0 {
            return Warp::OFF;
        }
        let k = match mode {
            WarpMode::Off => 0.0,
            WarpMode::Bend => 1.0 + w * 4.0,
            WarpMode::Sync => 1.0 + w * 6.0,
            WarpMode::Pwm => 0.5 - w * 0.45,
            WarpMode::Fold => 1.0 + w * 4.0,
            WarpMode::Mirror => 0.5 + (1.0 - w) * 0.5,
            WarpMode::Asym => 0.5 + w * 0.4,
            // The kit's Math.round: halves go up.
            WarpMode::Quant => (2.0 + (1.0 - w) * 30.0 + 0.5).floor(),
            WarpMode::Fm => w * 0.35,
        };
        Warp { mode, amt: w, k }
    }

    #[inline]
    pub fn is_off(&self) -> bool {
        self.mode == WarpMode::Off
    }

    /// The worst-case speed-up this slot gives the read, excluding FM's
    /// modulator term (the oscillator knows the modulator).
    pub fn slope(&self) -> f32 {
        let k = self.k;
        match self.mode {
            WarpMode::Off | WarpMode::Quant | WarpMode::Fm => 1.0,
            WarpMode::Bend | WarpMode::Sync | WarpMode::Fold => k,
            // Two linear pieces: the shorter one is the steeper.
            WarpMode::Pwm | WarpMode::Asym | WarpMode::Mirror => (0.5 / k).max(0.5 / (1.0 - k)),
        }
    }

    /// FM's depth, the `w·.35` of `x + w·.35·b(2x)`.
    #[inline]
    pub fn fm_depth(&self) -> f32 {
        if self.mode == WarpMode::Fm {
            self.k
        } else {
            0.0
        }
    }

    /// Map a phase in `[0, 1)` for the phase warps (not FM, which needs the
    /// modulator). Value warps and Off return it unchanged.
    #[inline(always)]
    pub fn map_phase(&self, x: f32) -> f32 {
        let k = self.k;
        match self.mode {
            WarpMode::Bend => {
                if x < 0.5 {
                    0.5 * (2.0 * x).powf(k)
                } else {
                    1.0 - 0.5 * (2.0 * (1.0 - x)).powf(k)
                }
            }
            WarpMode::Sync => x * k,
            WarpMode::Pwm | WarpMode::Asym => {
                if x < k {
                    x / k * 0.5
                } else {
                    0.5 + (x - k) / (1.0 - k) * 0.5
                }
            }
            WarpMode::Mirror => {
                if x < k {
                    x / k * 0.5
                } else {
                    0.5 - (x - k) / (1.0 - k) * 0.5
                }
            }
            _ => x,
        }
    }

    /// Apply a value warp to what was read. Phase warps return it unchanged.
    #[inline(always)]
    pub fn map_value(&self, y: f32) -> f32 {
        match self.mode {
            WarpMode::Fold => {
                let mut y = y * self.k;
                let mut g = 0;
                while y.abs() > 1.0 && g < 20 {
                    y = if y > 1.0 { 2.0 - y } else { -2.0 - y };
                    g += 1;
                }
                y
            }
            WarpMode::Quant => (y * self.k + 0.5).floor() / self.k,
            _ => y,
        }
    }

    #[inline(always)]
    pub fn is_value(&self) -> bool {
        matches!(self.mode, WarpMode::Fold | WarpMode::Quant)
    }
}

/// Wrap a phase into `[0, 1)`, as the kit's `rd()` does.
#[inline(always)]
pub fn fract(x: f32) -> f32 {
    x - x.floor()
}

/// One slot applied over `inner`, the wave before it.
#[inline(always)]
pub fn apply<F: Fn(f32) -> f32, M: Fn(f32) -> f32>(w: &Warp, x: f32, inner: F, modulator: &M) -> f32 {
    let x = fract(x);
    match w.mode {
        WarpMode::Off => inner(x),
        WarpMode::Fold | WarpMode::Quant => w.map_value(inner(x)),
        WarpMode::Fm => inner(x + w.k * modulator(2.0 * x)),
        _ => inner(w.map_phase(x)),
    }
}

/// Both slots over `read`, composed as the kit composes them.
#[inline(always)]
pub fn eval<R: Fn(f32) -> f32, M: Fn(f32) -> f32>(warps: &[Warp; 2], x: f32, read: &R, modulator: &M) -> f32 {
    apply(&warps[1], x, |x1| apply(&warps[0], x1, read, modulator), modulator)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The kit's `warp()`, transcribed, on a 256-point array.
    fn kit_warp(a: &[f32], mode: &str, w: f32, m: Option<&[f32]>) -> Vec<f32> {
        let np = a.len();
        let rd = |a: &[f32], x: f32| {
            let x = ((x % 1.0) + 1.0) % 1.0;
            let p = x * a.len() as f32;
            let i = p.floor() as usize;
            let u = p - i as f32;
            a[i % a.len()] * (1.0 - u) + a[(i + 1) % a.len()] * u
        };
        if mode == "off" || w <= 0.0 {
            return a.to_vec();
        }
        (0..np)
            .map(|n| {
                let mut x = n as f32 / np as f32;
                match mode {
                    "bend" => {
                        let e = 1.0 + w * 4.0;
                        x = if x < 0.5 { 0.5 * (2.0 * x).powf(e) } else { 1.0 - 0.5 * (2.0 * (1.0 - x)).powf(e) };
                        rd(a, x)
                    }
                    "sync" => rd(a, x * (1.0 + w * 6.0)),
                    "pwm" => {
                        let c = 0.5 - w * 0.45;
                        x = if x < c { x / c * 0.5 } else { 0.5 + (x - c) / (1.0 - c) * 0.5 };
                        rd(a, x)
                    }
                    "fold" => {
                        let mut y = rd(a, x) * (1.0 + w * 4.0);
                        let mut g = 0;
                        while y.abs() > 1.0 && g < 20 {
                            y = if y > 1.0 { 2.0 - y } else { -2.0 - y };
                            g += 1;
                        }
                        y
                    }
                    "mirror" => {
                        let mm = 0.5 + (1.0 - w) * 0.5;
                        if x < mm {
                            rd(a, x / mm * 0.5)
                        } else {
                            rd(a, 0.5 - (x - mm) / (1.0 - mm) * 0.5)
                        }
                    }
                    "asym" => {
                        let c = 0.5 + w * 0.4;
                        x = if x < c { x / c * 0.5 } else { 0.5 + (x - c) / (1.0 - c) * 0.5 };
                        rd(a, x)
                    }
                    "quant" => {
                        let s = (2.0 + (1.0 - w) * 30.0 + 0.5).floor();
                        (rd(a, x) * s + 0.5).floor() / s
                    }
                    "fm" => {
                        let b = m.unwrap_or(a);
                        rd(a, x + w * 0.35 * rd(b, x * 2.0))
                    }
                    _ => rd(a, x),
                }
            })
            .collect()
    }

    fn test_wave(np: usize) -> Vec<f32> {
        (0..np)
            .map(|i| {
                let x = i as f32 / np as f32;
                0.7 * (std::f32::consts::TAU * x).sin() + 0.3 * (std::f32::consts::TAU * 3.0 * x).cos()
            })
            .collect()
    }

    fn lin(a: &[f32]) -> impl Fn(f32) -> f32 + '_ {
        move |x: f32| {
            let x = fract(x);
            let p = x * a.len() as f32;
            let i = p.floor() as usize;
            let u = p - i as f32;
            a[i % a.len()] * (1.0 - u) + a[(i + 1) % a.len()] * u
        }
    }

    #[test]
    fn each_warp_at_amount_zero_is_the_identity() {
        let a = test_wave(256);
        let read = lin(&a);
        let modulator = |x: f32| (std::f32::consts::TAU * x).sin();
        for mode in WarpMode::ALL {
            let warps = [Warp::new(mode, 0.0), Warp::new(mode, 0.0)];
            for i in 0..1000 {
                let x = i as f32 / 1000.0;
                let y = eval(&warps, x, &read, &modulator);
                assert_eq!(y, read(x), "{} at 0 changed the wave at {x}", mode.as_str());
            }
        }
    }

    #[test]
    fn each_warp_matches_the_kit() {
        // On the kit's own 256-point grid, with the kit's linear read, a
        // single slot must give the kit's numbers.
        let a = test_wave(256);
        let b: Vec<f32> = (0..256).map(|i| (std::f32::consts::TAU * 2.0 * i as f32 / 256.0).sin()).collect();
        let read = lin(&a);
        let modulator = lin(&b);
        for mode in WarpMode::ALL {
            for w in [0.1f32, 0.3, 0.55, 0.8, 1.0] {
                let kit = kit_warp(&a, mode.as_str(), w, Some(&b));
                let warps = [Warp::new(mode, w), Warp::OFF];
                for (n, k) in kit.iter().enumerate() {
                    let y = eval(&warps, n as f32 / 256.0, &read, &modulator);
                    assert!((y - k).abs() < 1e-4, "{} {w} at {n}: {y} vs kit {k}", mode.as_str());
                }
            }
        }
    }

    #[test]
    fn two_slots_compose_as_the_kit_chains_them() {
        // waveFor: f = warp(warp(frame, slot0), slot1). On the kit's grid the
        // second warp reads the first's 256-point result; continuously, slot 1's
        // map runs first. Compare where the grids agree: a phase warp then a
        // value warp, which needs no re-interpolation.
        let a = test_wave(256);
        let read = lin(&a);
        let none = |_: f32| 0.0;
        let kit = kit_warp(&kit_warp(&a, "bend", 0.4, None), "fold", 0.5, None);
        let warps = [Warp::new(WarpMode::Bend, 0.4), Warp::new(WarpMode::Fold, 0.5)];
        for (n, k) in kit.iter().enumerate() {
            let y = eval(&warps, n as f32 / 256.0, &read, &none);
            assert!((y - k).abs() < 1e-4, "at {n}: {y} vs {k}");
        }
    }

    #[test]
    fn the_slope_bounds_the_phase_map() {
        for mode in [WarpMode::Bend, WarpMode::Sync, WarpMode::Pwm, WarpMode::Mirror, WarpMode::Asym] {
            for w in [0.05f32, 0.3, 0.7, 1.0] {
                let warp = Warp::new(mode, w);
                let n = 100_000;
                let mut worst = 0.0f32;
                for i in 0..n - 1 {
                    let (x0, x1) = (i as f32 / n as f32, (i + 1) as f32 / n as f32);
                    let d = (warp.map_phase(x1) - warp.map_phase(x0)).abs() * n as f32;
                    worst = worst.max(d);
                }
                assert!(worst <= warp.slope() * 1.01, "{} {w}: slope {worst} > {}", mode.as_str(), warp.slope());
            }
        }
        assert!((Warp::new(WarpMode::Sync, 0.5).slope() - 4.0).abs() < 1e-6);
    }

    #[test]
    fn modes_round_trip_by_name() {
        for m in WarpMode::ALL {
            assert_eq!(WarpMode::parse(m.as_str()), Some(m));
        }
        assert_eq!(WarpMode::parse("nope"), None);
    }
}
