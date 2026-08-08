//! Biquad filters, from the RBJ audio EQ cookbook.
//!
//! One filter section per channel: the coefficients are shared but the delay
//! line is not, because sharing state across channels smears the stereo image.

use std::f32::consts::PI;

/// Direct-form-I coefficients, already normalised by a0.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Coeffs {
    pub b0: f32,
    pub b1: f32,
    pub b2: f32,
    pub a1: f32,
    pub a2: f32,
}

impl Coeffs {
    /// A filter that passes everything through untouched.
    pub fn identity() -> Self {
        Coeffs { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0 }
    }

    fn normalise(b0: f32, b1: f32, b2: f32, a0: f32, a1: f32, a2: f32) -> Self {
        // A zero a0 would produce infinities that poison the whole buffer.
        if a0.abs() < 1e-20 || !a0.is_finite() {
            return Coeffs::identity();
        }
        Coeffs { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
    }

    /// Peaking EQ: boost or cut a band centred on `freq`.
    pub fn peaking(freq: f32, q: f32, gain_db: f32, sample_rate: u32) -> Self {
        let (w0, cos_w0, alpha, a) = shelf_terms(freq, q, gain_db, sample_rate);
        let _ = w0;
        Coeffs::normalise(
            1.0 + alpha * a,
            -2.0 * cos_w0,
            1.0 - alpha * a,
            1.0 + alpha / a,
            -2.0 * cos_w0,
            1.0 - alpha / a,
        )
    }

    /// Low shelf: everything below `freq` is lifted or cut.
    pub fn low_shelf(freq: f32, q: f32, gain_db: f32, sample_rate: u32) -> Self {
        let (_, cos_w0, alpha, a) = shelf_terms(freq, q, gain_db, sample_rate);
        let sq = 2.0 * a.sqrt() * alpha;
        Coeffs::normalise(
            a * ((a + 1.0) - (a - 1.0) * cos_w0 + sq),
            2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0),
            a * ((a + 1.0) - (a - 1.0) * cos_w0 - sq),
            (a + 1.0) + (a - 1.0) * cos_w0 + sq,
            -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0),
            (a + 1.0) + (a - 1.0) * cos_w0 - sq,
        )
    }

    /// High shelf: everything above `freq` is lifted or cut.
    pub fn high_shelf(freq: f32, q: f32, gain_db: f32, sample_rate: u32) -> Self {
        let (_, cos_w0, alpha, a) = shelf_terms(freq, q, gain_db, sample_rate);
        let sq = 2.0 * a.sqrt() * alpha;
        Coeffs::normalise(
            a * ((a + 1.0) + (a - 1.0) * cos_w0 + sq),
            -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0),
            a * ((a + 1.0) + (a - 1.0) * cos_w0 - sq),
            (a + 1.0) - (a - 1.0) * cos_w0 + sq,
            2.0 * ((a - 1.0) - (a + 1.0) * cos_w0),
            (a + 1.0) - (a - 1.0) * cos_w0 - sq,
        )
    }

    pub fn high_pass(freq: f32, q: f32, sample_rate: u32) -> Self {
        let (w0, cos_w0, alpha, _) = shelf_terms(freq, q, 0.0, sample_rate);
        let _ = w0;
        Coeffs::normalise(
            (1.0 + cos_w0) / 2.0,
            -(1.0 + cos_w0),
            (1.0 + cos_w0) / 2.0,
            1.0 + alpha,
            -2.0 * cos_w0,
            1.0 - alpha,
        )
    }

    pub fn low_pass(freq: f32, q: f32, sample_rate: u32) -> Self {
        let (_, cos_w0, alpha, _) = shelf_terms(freq, q, 0.0, sample_rate);
        Coeffs::normalise(
            (1.0 - cos_w0) / 2.0,
            1.0 - cos_w0,
            (1.0 - cos_w0) / 2.0,
            1.0 + alpha,
            -2.0 * cos_w0,
            1.0 - alpha,
        )
    }

    /// Magnitude response at `freq`, as a linear multiplier.
    ///
    /// Used by the tests, and by the UI to draw the curve without running audio.
    pub fn magnitude_at(&self, freq: f32, sample_rate: u32) -> f32 {
        let w = 2.0 * PI * freq / sample_rate as f32;
        let (cw, sw) = (w.cos(), w.sin());
        let (c2w, s2w) = ((2.0 * w).cos(), (2.0 * w).sin());
        let num_re = self.b0 + self.b1 * cw + self.b2 * c2w;
        let num_im = -(self.b1 * sw + self.b2 * s2w);
        let den_re = 1.0 + self.a1 * cw + self.a2 * c2w;
        let den_im = -(self.a1 * sw + self.a2 * s2w);
        let num = (num_re * num_re + num_im * num_im).sqrt();
        let den = (den_re * den_re + den_im * den_im).sqrt();
        if den < 1e-20 { 0.0 } else { num / den }
    }
}

/// Shared intermediate terms. `freq` is clamped below Nyquist, because a
/// centre frequency at or above it produces a degenerate, unstable filter.
fn shelf_terms(freq: f32, q: f32, gain_db: f32, sample_rate: u32) -> (f32, f32, f32, f32) {
    let sr = sample_rate.max(1) as f32;
    let f = freq.clamp(1.0, sr * 0.49);
    let q = q.max(0.05);
    let a = 10f32.powf(gain_db / 40.0);
    let w0 = 2.0 * PI * f / sr;
    let alpha = w0.sin() / (2.0 * q);
    (w0, w0.cos(), alpha, a)
}

/// One filter section's delay line, for a single channel.
#[derive(Debug, Clone, Copy, Default)]
pub struct State {
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl State {
    pub fn reset(&mut self) {
        *self = State::default();
    }

    #[inline]
    pub fn step(&mut self, c: &Coeffs, x: f32) -> f32 {
        let y = c.b0 * x + c.b1 * self.x1 + c.b2 * self.x2 - c.a1 * self.y1 - c.a2 * self.y2;
        // A denormal creeping into the feedback path costs orders of magnitude
        // in speed on some CPUs, and a NaN from a bad coefficient would spread
        // through every subsequent sample.
        let y = if y.is_finite() { flush(y) } else { 0.0 };
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}

#[inline]
fn flush(v: f32) -> f32 {
    if v.abs() < 1e-25 { 0.0 } else { v }
}
