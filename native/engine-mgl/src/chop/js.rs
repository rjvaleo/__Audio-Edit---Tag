//! JavaScript's arithmetic, as the page's V8 does it, so Chop's port gives the
//! page's numbers to the bit.
//!
//! - `Math.round` rounds halves up, towards +∞ (Rust's `round` goes away
//!   from zero).
//! - `Math.exp`, `log`, `log2`, `pow`, `sin` and `cos` are fdlibm's, which
//!   the `libm` crate carries (FreeBSD's msun), the same code on every
//!   machine; the platform's own (Apple's, Microsoft's) differ in last bits.
//! - `Math.log10` and `Math.tanh` are V8's own fdlibm ports, which are not the
//!   versions `libm` took: written out here.
//! - `Math.hypot` is V8's: scaled by the largest, summed with Kahan's
//!   compensation.
//! - Reading past the end of a typed array is `undefined`: NaN in arithmetic,
//!   and `|| 0` makes it (and NaN, and −0) a plain 0.

pub fn round(x: f64) -> f64 {
    let f = x.floor();
    if x - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}

pub fn cos(x: f64) -> f64 {
    libm::cos(x)
}

pub fn sin(x: f64) -> f64 {
    libm::sin(x)
}

pub fn exp(x: f64) -> f64 {
    libm::exp(x)
}

pub fn log(x: f64) -> f64 {
    libm::log(x)
}

pub fn log2(x: f64) -> f64 {
    libm::log2(x)
}

pub fn pow(x: f64, y: f64) -> f64 {
    // V8 answers NaN where IEEE 754-2008 says 1.
    if y.is_nan() || (y.is_infinite() && (x == 1.0 || x == -1.0)) {
        return f64::NAN;
    }
    libm::pow(x, y)
}

/// fdlibm's `e_log10.c`, as V8 has it (`base/ieee754.cc`).
pub fn log10(x: f64) -> f64 {
    const TWO54: f64 = 1.80143985094819840000e+16;
    const IVLN10: f64 = 4.34294481903251816668e-01;
    const LOG10_2HI: f64 = 3.01029995663611771306e-01;
    const LOG10_2LO: f64 = 3.69423907715893078616e-13;
    let mut x = x;
    let bits = x.to_bits();
    let mut hx = (bits >> 32) as i32;
    let lx = bits as u32;
    let mut k: i32 = 0;
    if hx < 0x0010_0000 {
        // x < 2**-1022
        if ((hx & 0x7fff_ffff) as u32 | lx) == 0 {
            return f64::NEG_INFINITY; // log(+-0) = -inf
        }
        if hx < 0 {
            return f64::NAN; // log(-#) = NaN
        }
        k -= 54;
        x *= TWO54; // subnormal: scale up x
        hx = (x.to_bits() >> 32) as i32;
    }
    if hx >= 0x7ff0_0000 {
        return x + x;
    }
    if hx == 0x3ff0_0000 && x.to_bits() as u32 == 0 {
        return 0.0; // log(1) = +0
    }
    k += (hx >> 20) - 1023;
    let i = ((k as u32 & 0x8000_0000) >> 31) as i32;
    hx = (hx & 0x000f_ffff) | ((0x3ff - i) << 20);
    let y = (k + i) as f64;
    let lo = x.to_bits() as u32;
    let x = f64::from_bits(((hx as u32 as u64) << 32) | lo as u64);
    let z = y * LOG10_2LO + IVLN10 * libm::log(x);
    z + y * LOG10_2HI
}

/// fdlibm's `s_tanh.c`, as V8 has it.
pub fn tanh(x: f64) -> f64 {
    let jx = (x.to_bits() >> 32) as i32;
    let ix = jx & 0x7fff_ffff;
    if ix >= 0x7ff0_0000 {
        return if jx >= 0 { 1.0 / x + 1.0 } else { 1.0 / x - 1.0 };
    }
    let z;
    if ix < 0x4036_0000 {
        // |x| < 22
        if ix < 0x3e30_0000 && 1.0e300 + x > 1.0 {
            return x; // |x| < 2**-28
        }
        if ix >= 0x3ff0_0000 {
            let t = libm::expm1(2.0 * x.abs());
            z = 1.0 - 2.0 / (t + 2.0);
        } else {
            let t = libm::expm1(-2.0 * x.abs());
            z = -t / (t + 2.0);
        }
    } else {
        z = 1.0 - 1.0e-300;
    }
    if jx >= 0 {
        z
    } else {
        -z
    }
}

/// `Math.hypot(a, b)`.
pub fn hypot(a: f64, b: f64) -> f64 {
    if a.is_infinite() || b.is_infinite() {
        return f64::INFINITY;
    }
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    let (a, b) = (a.abs(), b.abs());
    let max = if b > a { b } else { a };
    if max == 0.0 {
        return 0.0;
    }
    let mut sum = 0.0f64;
    let mut comp = 0.0f64;
    for v in [a, b] {
        let n = v / max;
        let summand = n * n - comp;
        let pre = sum + summand;
        comp = (pre - sum) - summand;
        sum = pre;
    }
    sum.sqrt() * max
}

/// `Math.max(a, b)`: NaN if either is.
pub fn max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b || (a == 0.0 && b == 0.0 && b.is_sign_negative()) {
        a
    } else {
        b
    }
}

/// `Math.min(a, b)`: NaN if either is.
pub fn min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a < b || (a == 0.0 && b == 0.0 && a.is_sign_negative()) {
        a
    } else {
        b
    }
}

/// A typed array's element: NaN past either end, as `undefined` is.
#[inline]
pub fn at(a: &[f32], i: f64) -> f64 {
    if i >= 0.0 && (i as usize) < a.len() && i.fract() == 0.0 {
        a[i as usize] as f64
    } else {
        f64::NAN
    }
}

/// `(a[i] || 0)`.
#[inline]
pub fn or0(v: f64) -> f64 {
    if v == 0.0 || v.is_nan() {
        0.0
    } else {
        v
    }
}

/// `n.toFixed(0)`: the nearest whole number, halves away from zero.
pub fn fixed0(x: f64) -> String {
    let neg = x < 0.0;
    let a = x.abs();
    let f = a.floor();
    let n = if a - f >= 0.5 { f + 1.0 } else { f };
    if neg && n != 0.0 {
        format!("-{n}")
    } else {
        format!("{n}")
    }
}
