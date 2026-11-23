//! `Math.sin` and `Math.cos` as the page's V8 has them now: glibc's
//! (V8's `V8_USE_LIBM_TRIG_FUNCTIONS`), which round correctly in all but
//! vanishingly rare cases. Neither Apple's libm nor fdlibm (the `libm`
//! crate) do: each is a last bit off for some of the page's circle. So the
//! value is worked out in double-double arithmetic (about 106 bits) and
//! rounded once, which is the correctly rounded answer.

#[derive(Clone, Copy)]
struct Dd(f64, f64);

fn two_sum(a: f64, b: f64) -> Dd {
    let s = a + b;
    let bb = s - a;
    Dd(s, (a - (s - bb)) + (b - bb))
}

fn add(a: Dd, b: Dd) -> Dd {
    let s = two_sum(a.0, b.0);
    let t = two_sum(a.1, b.1);
    let s = two_sum(s.0, s.1 + t.0);
    two_sum(s.0, s.1 + t.1)
}

fn mul(a: Dd, b: Dd) -> Dd {
    let p = a.0 * b.0;
    let e = a.0.mul_add(b.0, -p);
    two_sum(p, e + (a.0 * b.1 + a.1 * b.0))
}

fn div_int(a: Dd, d: f64) -> Dd {
    let q1 = a.0 / d;
    let p = q1 * d;
    let e = q1.mul_add(d, -p);
    let q2 = (((a.0 - p) - e) + a.1) / d;
    two_sum(q1, q2)
}

/// π/2 in three parts.
const PIO2: [f64; 3] = [1.570_796_326_794_896_6, 6.123_233_995_736_766e-17, -1.497_384_904_859_169_8e-33];

/// `x` less the nearest multiple `k` of π/2, and `k` mod 4.
fn reduce(x: f64) -> (Dd, i64) {
    let k = (x / PIO2[0]).round();
    let mut r = Dd(x, 0.0);
    for p in PIO2 {
        let prod = k * p;
        let err = k.mul_add(p, -prod);
        r = add(r, Dd(-prod, -err));
    }
    (r, (k as i64).rem_euclid(4))
}

/// sin and cos of a small `r` (|r| ≤ π/4), by their series.
fn series(r: Dd) -> (Dd, Dd) {
    let r2 = mul(r, r);
    let (mut s, mut term) = (r, r);
    let mut n = 1.0;
    for _ in 0..16 {
        term = div_int(mul(term, r2), (n + 1.0) * (n + 2.0));
        term = Dd(-term.0, -term.1);
        s = add(s, term);
        n += 2.0;
    }
    let (mut c, mut term) = (Dd(1.0, 0.0), Dd(1.0, 0.0));
    let mut n = 0.0;
    for _ in 0..16 {
        term = div_int(mul(term, r2), (n + 1.0) * (n + 2.0));
        term = Dd(-term.0, -term.1);
        c = add(c, term);
        n += 2.0;
    }
    (s, c)
}

fn round(a: Dd) -> f64 {
    a.0 + a.1
}

pub fn sin(x: f64) -> f64 {
    if !x.is_finite() {
        return f64::NAN;
    }
    if x == 0.0 || x.abs() > 1e9 {
        return x.sin();
    }
    let (r, k) = reduce(x);
    let (s, c) = series(r);
    match k {
        0 => round(s),
        1 => round(c),
        2 => -round(s),
        _ => -round(c),
    }
}

pub fn cos(x: f64) -> f64 {
    if !x.is_finite() {
        return f64::NAN;
    }
    if x.abs() > 1e9 {
        return x.cos();
    }
    let (r, k) = reduce(x);
    let (s, c) = series(r);
    match k {
        0 => round(c),
        1 => -round(s),
        2 => -round(c),
        _ => round(s),
    }
}
