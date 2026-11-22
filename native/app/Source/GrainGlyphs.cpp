// The Grain page's glyphs: MGL's `ui/grain-glyphs.js`, line for line. See
// GrainGlyphs.h.
//
// Each expression keeps the JS's order of operations, so every double comes
// out as V8 computes it, and no multiply and add may be fused into one
// (JS never fuses; clang does by default on arm64).

#include "GrainGlyphs.h"

#include <charconv>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <cstdio>
#include <limits>
#include <unordered_map>

#if defined(__clang__)
#pragma clang fp contract(off)
#elif defined(__GNUC__)
#pragma GCC optimize("fp-contract=off")
#elif defined(_MSC_VER)
#pragma fp_contract(off)
#endif

namespace gg
{
// ── JS's numbers ─────────────────────────────────────────────────────────────

/// `Number.prototype.toString()`: the shortest digits that read back as `x`,
/// laid out by the spec's rules (fixed from 1e-6 up to 1e21, exponent beyond).
std::string jsString (double x)
{
    if (std::isnan (x)) return "NaN";
    if (x == 0) return "0";
    if (x < 0) return "-" + jsString (-x);
    if (std::isinf (x)) return "Infinity";

    char buf[64];
    auto r = std::to_chars (buf, buf + sizeof (buf), x, std::chars_format::scientific);
    *r.ptr = 0;
    // "d.ddde+XX" or "de+XX"
    std::string digits;
    const char* p = buf;
    for (; *p && *p != 'e'; ++p)
        if (*p != '.') digits += *p;
    const int e = std::atoi (p + 1);
    const int k = (int) digits.size(), n = e + 1;

    if (k <= n && n <= 21) return digits + std::string ((size_t) (n - k), '0');
    if (0 < n && n <= 21) return digits.substr (0, (size_t) n) + "." + digits.substr ((size_t) n);
    if (-6 < n && n <= 0) return "0." + std::string ((size_t) -n, '0') + digits;
    const int ex = n - 1;
    std::string s = digits.substr (0, 1);
    if (k > 1) s += "." + digits.substr (1);
    s += ex < 0 ? "e-" : "e+";
    s += std::to_string (ex < 0 ? -ex : ex);
    return s;
}

/// `Number.prototype.toFixed(f)`: the exact value rounded to `f` places, a
/// tie going away from zero (the larger n of the spec), "-" only for x < 0.
std::string toFixed (double x, int f)
{
    if (! std::isfinite (x)) return jsString (x);
    std::string sign;
    if (x < 0) { sign = "-"; x = -x; }
    if (x >= 1e21) return sign + jsString (x);
    if (x == 0) x = 0.0; // -0 is not < 0: "0.00"

    char buf[400];
    // A tie at f places is exactly an odd multiple of 2^-(f+1); printf would
    // round it to even, JS rounds it up. Anything else printf rounds exactly.
    const double y = std::ldexp (x, f + 1);
    if (y == std::floor (y) && std::fmod (y, 2.0) == 1.0)
    {
        std::snprintf (buf, sizeof (buf), "%.*f", f + 1, x); // exact, ends in 5
        std::string s (buf);
        s.pop_back();
        if (! s.empty() && s.back() == '.') s.pop_back();
        int i = (int) s.size() - 1;
        for (; i >= 0; --i)
        {
            if (s[(size_t) i] == '.') continue;
            if (s[(size_t) i] == '9') { s[(size_t) i] = '0'; continue; }
            ++s[(size_t) i];
            break;
        }
        if (i < 0) s.insert (s.begin(), '1');
        return sign + s;
    }
    std::snprintf (buf, sizeof (buf), "%.*f", f, x);
    return sign + buf;
}

namespace
{
const double PI = 3.141592653589793;
const double NaN = std::numeric_limits<double>::quiet_NaN();

/// `Math.round`: the nearest integer, a half going up; -0 kept.
double jround (double x)
{
    if (! std::isfinite (x) || x == 0) return x;
    if (x > 0 && x < 0.5) return 0.0;
    if (x < 0 && x >= -0.5) return -0.0;
    double r = std::floor (x);
    if (x - r >= 0.5) r += 1;
    return r;
}
double jmax (double a, double b)
{
    if (std::isnan (a) || std::isnan (b)) return NaN;
    if (a == 0 && b == 0) return (std::signbit (a) && std::signbit (b)) ? -0.0 : 0.0;
    return a > b ? a : b;
}
double jmin (double a, double b)
{
    if (std::isnan (a) || std::isnan (b)) return NaN;
    if (a == 0 && b == 0) return (std::signbit (a) || std::signbit (b)) ? -0.0 : 0.0;
    return a < b ? a : b;
}
double jsign (double x)
{
    if (std::isnan (x)) return NaN;
    if (x > 0) return 1;
    if (x < 0) return -1;
    return x;
}
/// JS's truthiness, for a number.
bool T (double v) { return ! (v == 0 || std::isnan (v)); }
/// JS's `%`, for numbers.
double jmod (double a, double b) { return std::fmod (a, b); }

/// `Math.log` as V8 computes it: fdlibm's e_log.c (V8's `base::ieee754::log`),
/// which differs from the C library's in the last bit for about 2% of inputs;
/// Vocoder's window writes the result out in full, so it must be V8's. Node's
/// V8 on arm64 is built by clang with its default contraction, which fuses
/// each `a * b + c` of the C into one fma (the left product first); those
/// fusions are written out here with std::fma, so the result is the same on
/// every machine (checked against Node's Math.log on a million inputs).
double jlog (double x)
{
    auto F = [] (double a, double b, double c) { return std::fma (a, b, c); };
    const double ln2_hi = 6.93147180369123816490e-01, ln2_lo = 1.90821492927058770002e-10, two54 = 1.80143985094819840000e+16,
                 Lg1 = 6.666666666666735130e-01, Lg2 = 3.999999999940941908e-01, Lg3 = 2.857142874366239149e-01,
                 Lg4 = 2.222219843214978396e-01, Lg5 = 1.818357216161805012e-01, Lg6 = 1.531383769920937332e-01,
                 Lg7 = 1.479819860511658591e-01;
    auto words = [] (double d, int32_t& hi, uint32_t& lo) {
        uint64_t u;
        std::memcpy (&u, &d, 8);
        hi = (int32_t) (u >> 32);
        lo = (uint32_t) u;
    };
    auto setHigh = [] (double& d, int32_t hi) {
        uint64_t u;
        std::memcpy (&u, &d, 8);
        u = ((uint64_t) (uint32_t) hi << 32) | (u & 0xffffffffu);
        std::memcpy (&d, &u, 8);
    };

    double hfsq, f, s, z, R, w, t1, t2, dk;
    int32_t k, hx, i, j;
    uint32_t lx;
    words (x, hx, lx);

    k = 0;
    if (hx < 0x00100000)
    { // x < 2**-1022
        if (((hx & 0x7fffffff) | (int32_t) lx) == 0) return -std::numeric_limits<double>::infinity();
        if (hx < 0) return NaN;
        k -= 54;
        x *= two54; // subnormal, scale up
        words (x, hx, lx);
    }
    if (hx >= 0x7ff00000) return x + x;
    k += (hx >> 20) - 1023;
    hx &= 0x000fffff;
    i = (hx + 0x95f64) & 0x100000;
    setHigh (x, hx | (i ^ 0x3ff00000)); // normalize x or x/2
    k += (i >> 20);
    f = x - 1.0;
    if ((0x000fffff & (2 + hx)) < 3)
    { // -2**-20 <= f < 2**-20
        if (f == 0.0)
        {
            if (k == 0) return 0.0;
            dk = (double) k;
            return F (dk, ln2_hi, dk * ln2_lo);
        }
        R = f * f * F (-0.33333333333333333, f, 0.5);
        if (k == 0) return f - R;
        dk = (double) k;
        return F (dk, ln2_hi, -(F (-dk, ln2_lo, R) - f));
    }
    s = f / (2.0 + f);
    dk = (double) k;
    z = s * s;
    i = hx - 0x6147a;
    w = z * z;
    j = 0x6b851 - hx;
    t1 = w * F (w, F (w, Lg6, Lg4), Lg2);
    t2 = z * F (w, F (w, F (w, Lg7, Lg5), Lg3), Lg1);
    i |= j;
    R = t2 + t1;
    if (i > 0)
    {
        hfsq = 0.5 * f * f;
        if (k == 0) return f - F (-s, hfsq + R, hfsq);
        return F (dk, ln2_hi, -((hfsq - F (s, hfsq + R, dk * ln2_lo)) - f));
    }
    if (k == 0) return F (-s, f - R, f);
    return F (dk, ln2_hi, -(F (s, f - R, -(dk * ln2_lo)) - f));
}

std::string fx (double x) { return toFixed (x, 2); }
std::string n (double x) { return jsString (x); }

// ── the drawing kit ──────────────────────────────────────────────────────────

const double GG_BASE = 40;

double ggRnd (double i, double s = 7)
{
    const double x = std::sin (i * 127.1 + s * 311.7) * 43758.5453;
    return x - std::floor (x);
}
double ggLerp (double a, double b, double t) { return a + (b - a) * t; }
double ggClamp (double v, double a, double b) { return jmax (a, jmin (v, b)); }
double ggJ (double i, double s, double t)
{
    const double u = t * 3 + ggRnd (i, 99), k = std::floor (u), f = u - k, e = f * f * (3 - 2 * f);
    const double a = T (t) ? ggRnd (i, s + k) : ggRnd (i, s), b = ggRnd (i, s + k + 1);
    return ggLerp (a, T (t) ? b : a, e) - 0.5;
}
double ggLog (double v, double a, double b) { return ggClamp (jlog (jmax (v, a) / a) / jlog (b / a), 0, 1); }

std::string ggBell (double cx, double w, double h, double base = GG_BASE, double peak = 0.5)
{
    const int N = 16;
    std::string d;
    d.reserve (17 * 14);
    for (int i = 0; i <= N; i++)
    {
        const double t = (double) i / N, u = t < peak ? 0.5 * t / peak : 0.5 + 0.5 * (t - peak) / (1 - peak);
        const double y = base - h * 0.5 * (1 - std::cos (2 * PI * u));
        d += i ? 'L' : 'M';
        d += fx (cx - w / 2 + w * t);
        d += ' ';
        d += fx (y);
    }
    return d;
}
std::string ggP (const std::string& d, const char* cls = "a", const char* extra = "")
{
    std::string s;
    s.reserve (d.size() + 32);
    s += "<path d=\"";
    s += d;
    s += "\" class=\"";
    s += cls;
    s += "\" ";
    s += extra;
    s += "/>";
    return s;
}
std::string ggL (double x1, double y1, double x2, double y2, const char* cls = "f", const char* extra = "")
{
    std::string s;
    s.reserve (80);
    s += "<line x1=\"";
    s += fx (x1);
    s += "\" y1=\"";
    s += fx (y1);
    s += "\" x2=\"";
    s += fx (x2);
    s += "\" y2=\"";
    s += fx (y2);
    s += "\" class=\"";
    s += cls;
    s += "\" ";
    s += extra;
    s += "/>";
    return s;
}
std::string ggC (double x, double y, double r, const char* cls = "a")
{
    return "<circle cx=\"" + fx (x) + "\" cy=\"" + fx (y) + "\" r=\"" + n (r) + "\" class=\"" + cls + "\"/>";
}
std::string ggGround() { return ggL (4, GG_BASE, 60, GG_BASE); }
const char* const ggDash = "stroke-dasharray=\"2 3\"";
const char* const ggDot = "stroke-dasharray=\"1 2\"";

std::string ggWave (double x0, double x1, double y, double amp, double cycles, const char* cls = "a")
{
    std::string d;
    d.reserve (65 * 14);
    for (int i = 0; i <= 64; i++)
    {
        const double t = (double) i / 64;
        d += i ? 'L' : 'M';
        d += fx (ggLerp (x0, x1, t));
        d += ' ';
        d += fx (y - amp * std::sin (t * cycles * 2 * PI));
    }
    return ggP (d, cls);
}
std::string ggArrow (double x1, double y1, double x2, double y2, const char* cls = "a")
{
    const double a = std::atan2 (y2 - y1, x2 - x1), s = 4;
    return ggL (x1, y1, x2, y2, cls)
         + ggP ("M" + n (x2 - s * std::cos (a - 0.5)) + " " + n (y2 - s * std::sin (a - 0.5)) + "L" + n (x2) + " " + n (y2) + "L"
                    + n (x2 - s * std::cos (a + 0.5)) + " " + n (y2 - s * std::sin (a + 0.5)),
                cls);
}
std::string ggSource (double y = 14)
{
    std::string s;
    for (int i = 0; i < 27; i++)
    {
        const double x = 6 + i * 2, h = 1 + 5 * ggRnd (i, 3);
        s += ggL (x, y - h / 2, x, y + h / 2);
    }
    return s;
}

std::string ggSeg (double cx, double w, double h, double shape)
{
    const double x0 = cx - w / 2, x1 = cx + w / 2, top = GG_BASE - h;
    if (shape == 2) return "M" + n (x0) + " " + n (GG_BASE) + "L" + n (x0) + " " + n (top) + "L" + n (x1) + " " + n (top) + "L" + n (x1) + " " + n (GG_BASE);
    if (shape == 1) return "M" + n (x0) + " " + n (GG_BASE) + "L" + n (cx) + " " + n (top) + "L" + n (x1) + " " + n (GG_BASE);
    return ggBell (cx, w, h);
}

const double GG_SPEC[] = { 0.25, 0.5, 0.95, 0.45, 0.2, 0.35, 0.75, 0.3, 0.15, 0.55, 0.85, 0.4, 0.2, 0.3 };
const int GG_SPEC_N = 14;

template <typename Cls>
std::string ggBars (const double* heights, int count, Cls cls, double x0 = 6, double gap = 4)
{
    std::string s;
    for (int i = 0; i < count; i++)
    {
        const double h = heights[i], x = x0 + i * gap;
        s += ggL (x, 42, x, 42 - jmax (0.5, h * 30), cls (h, i));
    }
    return s;
}
std::string ggBins (double y0 = 8, double y1 = 42)
{
    std::string s;
    for (double x = 8; x <= 56; x += 8) s += ggL (x, y0, x, y1, "f", ggDot);
    return s;
}
std::string ggLevel (double v)
{
    const double h = ggClamp (v / 2, 0, 1) * 36;
    return ggL (58, 42, 58, 6, "f") + ggL (55, 24, 61, 24, "f") + (h > 0 ? ggL (58, 42, 58, 42 - h) : std::string());
}
std::string ggHit (double x, double h, const char* cls = "a")
{
    return ggP ("M" + n (x - 3) + " 40L" + n (x) + " " + n (40 - h) + "L" + n (x + 3) + " 40", cls);
}

// ── the drawings, by control key ─────────────────────────────────────────────

using Draw = std::string (*) (double v, double t);

std::string searchMs (double v, double)
{
    const std::string base = ggGround() + ggP (ggBell (20, 28, 24), "f");
    if (v <= 0) return base + ggP (ggBell (38, 28, 24), "a", ggDash);
    const double w = ggLerp (4, 40, ggLog (v, 0.5, 200));
    return base + ggP (ggBell (38, 28, 24))
         + ggL (38 - w / 2, 8, 38 + w / 2, 8, "a") + ggL (38 - w / 2, 5, 38 - w / 2, 11, "a") + ggL (38 + w / 2, 5, 38 + w / 2, 11, "a");
}

const std::vector<std::pair<std::string, Draw>>& table()
{
    static const std::vector<std::pair<std::string, Draw>> t = {
        { "ratio", [] (double v, double) -> std::string {
             const double w = ggLerp (4, 56, ggLog (v, 0.01, 100));
             return ggL (22, 12, 42, 12) + ggL (22, 9, 22, 15) + ggL (42, 9, 42, 15)
                  + ggWave (32 - w / 2, 32 + w / 2, 32, 5, 3)
                  + ggL (32 - w / 2, 26, 32 - w / 2, 38, "a") + ggL (32 + w / 2, 26, 32 + w / 2, 38, "a");
         } },
        { "semitones", [] (double v, double) -> std::string {
             return ggWave (6, 46, 26, 9, 2, "f") + ggWave (6, 46, 26, 9, 2 * std::pow (2, v / 24))
                  + (std::fabs (v) > 0.05 ? ggArrow (55, 26, 55, 26 - v / 48 * 16) : ggC (55, 26, 1.6, "af"));
         } },
        { "windowMs", [] (double v, double) -> std::string {
             const double w = ggLerp (6, 56, ggLog (v, 5, 2000));
             return ggGround() + ggP (ggBell (32, w, 26)) + ggL (32 - w / 2, 44, 32 + w / 2, 44);
         } },
        { "position", [] (double v, double) -> std::string {
             const double x = ggLerp (6, 58, (ggClamp (v, -1, 1) + 1) / 2);
             return ggSource (16) + ggL (x, 6, x, 30, "a") + ggP ("M" + n (x - 3) + " 6L" + n (x + 3) + " 6L" + n (x) + " 10Z", "af")
                  + ggGround() + ggP (ggBell (x, 12, 8));
         } },
        { "rateHz", [] (double v, double) -> std::string {
             if (v <= 0) return ggL (4, GG_BASE, 60, GG_BASE, "f", ggDash);
             const double N = jround (ggLerp (2, 24, ggClamp (v / 500, 0, 1)));
             std::string s = ggGround();
             for (double i = 0; i < N; i++) s += ggC (6 + 52 * (i + 0.5) / N, GG_BASE - 6, 1.6, "af");
             return s + ggP (ggBell (6 + 52 * 0.5 / N, 6, 12));
         } },
        { "densityHz", [] (double v, double) -> std::string {
             if (v <= 0) return ggGround() + ggP (ggBell (22, 18, 20), "f", ggDash) + ggP (ggBell (42, 18, 20), "f", ggDash);
             const double N = jround (ggLerp (2, 14, ggClamp (v / 500, 0, 1)));
             std::string s = ggGround();
             for (double i = 0; i < N; i++) s += ggP (ggBell (10 + 44 * i / jmax (1, N - 1), 16, 22));
             return s;
         } },
        { "layers", [] (double v, double) -> std::string {
             const double N = ggClamp (jround (v), 1, 8);
             std::string s;
             for (double i = 0; i < N; i++) s += ggP (ggBell (32, 30, 6, 40 - i * 4.4));
             return s + (v > 8 ? "<text x=\"50\" y=\"8\" class=\"t\">+" + n (jround (v) - 8) + "</text>" : std::string());
         } },
        { "overlap", [] (double v, double) -> std::string {
             const double w = 24, hop = w / jmax (1, v);
             std::string s = ggGround() + ggL (32, 8, 32, 44, "f", ggDot);
             for (double x = 4 + w / 2; x <= 60 - w / 2 + 0.01; x += hop) s += ggP (ggBell (x, w, 24), std::fabs (x - 32) < w / 2 ? "a" : "f");
             return s;
         } },
        { "sizeJitter", [] (double v, double t) -> std::string {
             std::string s = ggGround();
             for (int i = 0; i < 5; i++)
             {
                 const double k = 1 + ggClamp (v, 0, 1) * ggJ (i, 11, t) * 1.8;
                 s += ggP (ggBell (8 + i * 12, 10 * k, 18 * k));
             }
             return s;
         } },
        { "positionJitterMs", [] (double v, double t) -> std::string {
             std::string s = ggGround();
             for (int i = 0; i < 5; i++)
             {
                 const double x0 = 8 + i * 12, x = x0 + ggJ (i, 5, t) * 28 * ggClamp (v / 500, 0, 1);
                 s += ggL (x0, 42, x0, 46) + ggP (ggBell (ggClamp (x, 5, 59), 8, 18));
             }
             return s;
         } },
        { "pitchJitterSemis", [] (double v, double t) -> std::string {
             std::string s = ggL (4, 24, 60, 24, "f", ggDot);
             for (int i = 0; i < 9; i++)
             {
                 const double x = 6 + i * 6.5, y = 24 + ggJ (i, 9, t) * 36 * ggClamp (v / 24, 0, 1);
                 s += ggL (x, y, x + 4, y, "a");
             }
             return s;
         } },
        { "pitchDriftSemis", [] (double v, double t) -> std::string {
             const double amp = ggClamp (v / 24, 0, 1) * 16, ph = t * 0.4;
             std::string d;
             for (int i = 0; i <= 64; i++)
             {
                 const double u = (double) i / 64;
                 d += i ? 'L' : 'M';
                 d += fx (4 + 56 * u) + " " + fx (24 - amp * std::sin ((u + ph) * 2 * PI));
             }
             std::string s = ggP (d, "f");
             for (int i = 0; i < 9; i++)
             {
                 const double u = (i + 0.3) / 9, x = 4 + 56 * u, y = 24 - amp * std::sin ((u + ph) * 2 * PI);
                 s += ggL (x, y, x + 4, y, "a");
             }
             return s;
         } },
        { "driftRateHz", [] (double v, double t) -> std::string {
             const double cyc = ggLerp (0.5, 6, ggLog (v, 0.01, 10)), ph = t * ggClamp (v, 0, 4);
             std::string d;
             for (int i = 0; i <= 64; i++)
             {
                 const double u = (double) i / 64;
                 d += i ? 'L' : 'M';
                 d += fx (4 + 56 * u) + " " + fx (24 - 10 * std::sin ((u * cyc + ph) * 2 * PI));
             }
             return ggP (d) + ggL (4, 24, 60, 24, "f", ggDot);
         } },
        { "scan", [] (double v, double) -> std::string {
             if (std::fabs (v) < 0.005) return ggSource (14) + ggC (32, 32, 3, "af") + ggC (32, 32, 7);
             const double len = jmin (std::fabs (v), 2) / 2 * 24, d = jsign (v);
             return ggSource (14) + ggArrow (32 - d * len, 32, 32 + d * len, 32);
         } },
        { "envelope", [] (double v, double) -> std::string {
             return ggGround() + ggP (ggBell (32, 48, 30, GG_BASE, ggLerp (0.06, 0.94, ggClamp (v, 0, 1))));
         } },
        { "sizeRange", [] (double v, double) -> std::string {
             return ggGround() + ggP (ggBell (32, jmin (56, 7 * v), 26), "a", "stroke-dasharray=\"2 2\"")
                  + ggP (ggBell (32, 7, 26), "f");
         } },
        { "layerSpread", [] (double v, double) -> std::string {
             std::string s;
             for (int i = 0; i < 5; i++) s += ggP (ggBell (14 + i * ggClamp (v, 0, 4) / 4 * 9, 14, 6, 40 - i * 7));
             return s;
         } },
        { "panSpread", [] (double v, double) -> std::string {
             std::string s = ggP ("M18 40A14 14 0 0 1 46 40", "f") + ggL (26, 40, 38, 40) + ggC (32, 40, 2, "f");
             for (int i = 0; i < 7; i++)
             {
                 const double a = (ggRnd (i, 4) - 0.5) * 2 * ggClamp (v, 0, 1) * 1.3;
                 s += ggC (32 + 26 * std::sin (a), 40 - 26 * std::cos (a), 2, "af");
             }
             return s + "<text x=\"6\" y=\"44\" class=\"t\">L</text><text x=\"54\" y=\"44\" class=\"t\">R</text>";
         } },
        { "layerScatter", [] (double v, double) -> std::string {
             std::string s = ggL (32, 6, 32, 44, "f", ggDot);
             for (int i = 0; i < 6; i++) s += ggP (ggBell (32 + (ggRnd (i, 13) - 0.5) * 44 * ggClamp (v, 0, 1), 12, 5, 42 - i * 6.5));
             return s;
         } },
        { "layerScatterMs", [] (double v, double) -> std::string {
             const double w = ggLerp (4, 54, ggLog (v, 1, 2000));
             std::string s = ggGround() + ggP (ggBell (32, 10, 20), "f")
                           + ggL (32 - w / 2, 14, 32 + w / 2, 14, "a") + ggL (32 - w / 2, 11, 32 - w / 2, 17, "a") + ggL (32 + w / 2, 11, 32 + w / 2, 17, "a");
             for (int i = 0; i < 4; i++) s += ggC (32 + (ggRnd (i, 2) - 0.5) * w, 24, 1.6, "af");
             return s;
         } },
        { "searchMs", searchMs },
        { "splicePick", [] (double v, double) -> std::string {
             const double k = jround (v);
             const std::string next = k == 2 ? ggWave (32, 60, 24, 14, 2) : ggWave (32, 60, 24, k == 1 ? -7 : 7, 2);
             return ggWave (4, 32, 24, 7, 2, "f") + ggL (32, 8, 32, 40, "f", ggDot) + next;
         } },
        { "spliceShape", [] (double v, double) -> std::string {
             const double k = jround (v);
             return ggGround() + ggP (ggSeg (20, 28, 24, k), "f") + ggP (ggSeg (44, 28, 24, k));
         } },
        { "stride", [] (double v, double) -> std::string {
             const double gap = ggLerp (2.5, 24, ggLog (v, 1, 128));
             std::string s = ggGround() + ggP (ggBell (32, 30, 22), "f") + ggL (8, 10, 56, 10, "f");
             for (double x = 8; x <= 56.01; x += gap) s += ggL (x, 7, x, 13, "a");
             return s;
         } },
        { "seed", [] (double v, double) -> std::string {
             std::string s = ggGround();
             for (int i = 0; i < 7; i++)
             {
                 const double x = 9 + i * 7.6 + (ggRnd (i, jmod (v, 9973)) - 0.5) * 6, h = 8 + 22 * ggRnd (i + 7, jmod (v, 9973));
                 s += ggP (ggBell (x, 8, h));
             }
             return s;
         } },

        // the second Object.assign
        { "shVersion", [] (double v, double) -> std::string {
             const std::string base = ggL (4, 40, 60, 40, "f", ggDot);
             if (! T (jround (v))) return base + ggL (6, 40, 60, 10, "a");
             const double w = 21.6;
             std::string d;
             for (double x = 6; x < 59.99; x += w)
             {
                 const double x2 = jmin (x + w, 60);
                 d += "M" + toFixed (x, 1) + " 40L" + toFixed (x2, 1) + " " + toFixed (40 - (x2 - x) / w * 30, 1);
             }
             return base + ggP (d, "a");
         } },
        { "cloudMix", [] (double v, double) -> std::string {
             const double t = ggClamp (v, 0, 1);
             std::string s = ggGround() + ggWave (4, 60, 26, 10 * (1 - t) + 0.5, 3, "f");
             for (int i = 0; i < 6; i++) s += ggP (ggBell (8 + i * 9.6, 10, jmax (1, 22 * t)));
             return s;
         } },
        { "sensitivity", [] (double v, double) -> std::string {
             const double line = ggLerp (8, 34, ggClamp (v, 0, 1));
             static const double hits[][2] = { { 12, 30 }, { 24, 12 }, { 36, 22 }, { 48, 8 }, { 56, 18 } };
             std::string s = ggGround() + ggL (4, 40 - line, 60, 40 - line, "f", ggDash);
             for (const auto& xh : hits) s += ggHit (xh[0], xh[1], xh[1] >= line ? "a" : "f");
             return s;
         } },
        { "floor", [] (double v, double) -> std::string {
             const double line = ggLerp (6, 34, ggClamp (v / 2, 0, 1));
             static const double hits[][2] = { { 10, 14 }, { 22, 30 }, { 34, 10 }, { 46, 24 }, { 56, 34 } };
             std::string s = ggGround() + ggWave (4, 60, 37, 1.5, 6, "f") + ggL (4, 40 - line, 60, 40 - line, "f", ggDash);
             for (const auto& xh : hits) s += ggHit (xh[0], xh[1], xh[1] > line ? "a" : "f");
             return s;
         } },
        { "guardHops", [] (double v, double) -> std::string {
             const double w = ggLerp (4, 54, ggLog (v, 1, 16));
             return ggGround() + ggHit (32, 30) + ggL (32 - w / 2, 6, 32 + w / 2, 6)
                  + ggL (32 - w / 2, 3, 32 - w / 2, 9) + ggL (32 + w / 2, 3, 32 + w / 2, 9)
                  + ggL (32 - w / 2, 12, 32 - w / 2, 40, "f", ggDot) + ggL (32 + w / 2, 12, 32 + w / 2, 40, "f", ggDot);
         } },
        { "anchorFrames", [] (double v, double) -> std::string {
             const double every = jmax (1, jround (v));
             std::string s = ggWave (4, 60, 24, 8, 3, "f");
             for (int i = 0; i < 24; i++)
             {
                 const double x = 4 + i * (56.0 / 23);
                 s += jmod (i, jmin (every, 24)) == 0 ? ggL (x, 8, x, 40) : ggL (x, 38, x, 42, "f");
             }
             return s;
         } },
        { "anchorSearchMs", [] (double v, double) -> std::string { return searchMs (v, 0); } },
        { "blend", [] (double v, double) -> std::string {
             const double w = ggLerp (0, 30, ggClamp (v, 0, 1));
             if (w < 1) return ggGround() + ggWave (4, 32, 26, 9, 1.5, "f") + ggWave (32, 60, 26, 9, 1.5) + ggL (32, 10, 32, 42);
             return ggGround() + ggWave (4, 32 + w / 2, 26, 9, 1.5, "f") + ggWave (32 - w / 2, 60, 26, 9, 1.5)
                  + ggL (32 - w / 2, 40, 32 + w / 2, 10) + ggL (32 - w / 2, 10, 32 + w / 2, 40, "f");
         } },
        { "vocWindowMs", [] (double v, double) -> std::string {
             const double t = ggLog (v, 5, 500), w = ggLerp (10, 56, t), N = jround (ggLerp (3, 12, t));
             std::string s = ggP ("M" + n (32 - w / 2) + " 22L" + n (32 - w / 2) + " 8L" + n (32 + w / 2) + " 8L" + n (32 + w / 2) + " 22", "f");
             for (double i = 0; i < N; i++)
             {
                 const double x = 6 + 52 * (i + 0.5) / N;
                 s += ggL (x, 42, x, 42 - (6 + 12 * GG_SPEC[(int) jmod (i, GG_SPEC_N)]));
             }
             return s;
         } },
        { "harmonicLevel", [] (double v, double) -> std::string {
             const double k = ggClamp (v / 2, 0, 1);
             std::string s = ggLevel (v);
             for (double y : { 12.0, 22.0, 32.0 }) s += k > 0 ? ggL (6, y, 6 + 44 * jmax (0.08, k), y) : ggL (6, y, 50, y, "f", ggDash);
             return s;
         } },
        { "percussiveLevel", [] (double v, double) -> std::string {
             const double k = ggClamp (v / 2, 0, 1);
             std::string s = ggLevel (v);
             for (double x : { 12.0, 26.0, 40.0 }) s += k > 0 ? ggL (x, 42, x, 42 - 34 * jmax (0.08, k)) : ggL (x, 42, x, 8, "f", ggDash);
             return s;
         } },
        { "residualLevel", [] (double v, double) -> std::string {
             const double N = jround (ggClamp (v / 2, 0, 1) * 28);
             std::string s = ggLevel (v);
             for (int i = 0; i < 28; i++)
             {
                 const double x = 6 + ggRnd (i, 21) * 44, y = 8 + ggRnd (i, 22) * 32;
                 s += i < N ? ggC (x, y, 1.3, "af") : (i % 4 ? std::string() : ggC (x, y, 0.8, "f"));
             }
             return s;
         } },
        { "timeSpan", [] (double v, double) -> std::string {
             const double w = ggLerp (6, 52, ggLog (v, 3, 101));
             return ggL (6, 30, 58, 30, "f") + ggL (32 - w / 2, 30, 32 + w / 2, 30)
                  + ggL (32 - w / 2, 14, 32 + w / 2, 14) + ggL (32 - w / 2, 11, 32 - w / 2, 17) + ggL (32 + w / 2, 11, 32 + w / 2, 17);
         } },
        { "freqSpan", [] (double v, double) -> std::string {
             const double h = ggLerp (4, 34, ggLog (v, 3, 101));
             return ggL (28, 6, 28, 44, "f") + ggL (28, 25 + h / 2, 28, 25 - h / 2)
                  + ggL (44, 25 - h / 2, 44, 25 + h / 2) + ggL (41, 25 - h / 2, 47, 25 - h / 2) + ggL (41, 25 + h / 2, 47, 25 + h / 2);
         } },
        { "margin", [] (double v, double) -> std::string {
             const double k = ggClamp ((v - 1) / 7, 0, 1);
             std::string s = ggGround() + ggL (16, 40, 16, 10) + ggL (48, 40, 48, 10 + 22 * k, "f");
             const double N = jround (k * 12);
             for (double i = 0; i < N; i++) s += ggC (24 + ggRnd (i, 31) * 16, 12 + ggRnd (i, 32) * 26, 1.2, "af");
             return s;
         } },
        { "fftSize", [] (double v, double) -> std::string {
             const double N = jround (ggLerp (4, 28, ggLog (v, 256, 8192)));
             std::string s = ggGround();
             for (double i = 0; i < N; i++)
             {
                 const double x = 6 + 52 * (i + 0.5) / N;
                 s += ggL (x, 40, x, 40 - (4 + 26 * GG_SPEC[(int) jmod (i, GG_SPEC_N)] * (0.5 + 0.5 * std::sin (i / N * PI))));
             }
             return s;
         } },
        { "magFreeze", [] (double v, double) -> std::string {
             const double t = ggClamp (v, 0, 1);
             std::string s;
             for (int f = 0; f < 3; f++)
             {
                 double heights[5];
                 for (int i = 0; i < 5; i++) heights[i] = ggLerp (GG_SPEC[(i + f * 3) % GG_SPEC_N], GG_SPEC[i], f ? t : 1);
                 const char* cls = f ? "a" : "f";
                 s += ggBars (heights, 5, [cls] (double, int) { return cls; }, 6 + f * 20, 3.2);
             }
             return s;
         } },
        { "magBlur", [] (double v, double) -> std::string {
             const double t = ggClamp (v, 0, 1);
             return ggGround() + ggP (ggBell (18, ggLerp (4, 26, t), ggLerp (30, 12, t))) + ggP (ggBell (44, ggLerp (4, 26, t), ggLerp (22, 10, t)))
                  + ggL (18, 40, 18, 10, "f", ggDot) + ggL (44, 40, 44, 18, "f", ggDot);
         } },
        { "magGate", [] (double v, double) -> std::string {
             const double line = ggClamp (v, 0, 1);
             return ggBars (GG_SPEC, GG_SPEC_N, [line] (double h, int) { return h >= line ? "a" : "f"; })
                  + (line > 0 ? ggL (4, 42 - line * 30, 60, 42 - line * 30, "f", ggDash) : std::string());
         } },
        { "freqTrust", [] (double v, double) -> std::string {
             const double x = ggLerp (24, 29, ggClamp (v, 0, 1));
             return ggBins() + ggL (24, 42, 24, 14, "f") + ggP (ggBell (x, 10, 28)) + ggC (x, 10, 1.6, "af");
         } },
        { "phaseSpread", [] (double v, double) -> std::string {
             const double r = ggLerp (0, 24, ggClamp (v / 4, 0, 1));
             std::string s = ggBins() + ggL (32, 42, 32, 10);
             if (r > 1) s += ggArrow (32, 26, 32 - r, 26) + ggArrow (32, 26, 32 + r, 26);
             return s;
         } },
        { "peakWidth", [] (double v, double) -> std::string {
             const double N = ggClamp (jround (v), 1, 16), k = jmin (N, 6);
             std::string s = ggGround();
             for (int i = -6; i <= 6; i++)
             {
                 const double x = 32 + i * 4.2, h = 32 * std::exp ((double) -(i * i) / 8);
                 s += ggL (x, 40, x, 40 - jmax (1, h), std::abs (i) <= k ? "a" : "f");
             }
             return s + (N > 6 ? "<text x=\"50\" y=\"8\" class=\"t\">" + n (N) + "</text>" : std::string());
         } },
        { "lockWidth", [] (double v, double) -> std::string {
             const double lock = ggClamp (v, 0, 1);
             std::string s;
             for (int i = -3; i <= 3; i++)
             {
                 const double x = 32 + i * 8, a = i ? (1 - lock) * (ggRnd (i + 3, 41) - 0.5) * 3 : 0;
                 s += ggC (x, 26, 3.4, "f") + ggL (x, 26, x + 7 * std::sin (a + 0.6), 26 - 7 * std::cos (a + 0.6), "a");
             }
             return s + ggL (32, 40, 32, 34, "f");
         } },

        // the switches, and grain feedback
        { "driftStep", [] (double v, double) -> std::string {
             std::string d;
             for (int i = 0; i <= 64; i++)
             {
                 const double u = (double) i / 64;
                 d += i ? 'L' : 'M';
                 d += fx (4 + 56 * u) + " " + fx (24 - 12 * std::sin (u * 2 * PI));
             }
             if (! T (v)) return ggP (d);
             std::string st;
             for (int i = 0; i < 7; i++)
             {
                 const double u0 = (double) i / 7, u1 = (double) (i + 1) / 7, y = 24 - 12 * std::sin ((u0 + 0.5 / 7) * 2 * PI);
                 st += i ? "L" : "M";
                 st += fx (4 + 56 * u0) + " " + fx (y) + "L" + fx (4 + 56 * u1) + " " + fx (y);
             }
             return ggP (d, "f") + ggP (st);
         } },
        { "reverse", [] (double v, double) -> std::string {
             return ggGround() + ggP (ggBell (32, 30, 22, GG_BASE, T (v) ? 0.8 : 0.2)) + (T (v) ? ggArrow (46, 10, 18, 10) : ggArrow (18, 10, 46, 10));
         } },
        { "wrap", [] (double v, double) -> std::string {
             return ggSource (30) + ggL (6, 22, 58, 22, "f")
                  + (T (v) ? ggP ("M50 22 C 62 22, 62 8, 32 8 C 4 8, 2 22, 14 22") + ggArrow (10, 22, 14, 22) : ggArrow (40, 22, 58, 22) + ggL (58, 16, 58, 28));
         } },
        { "cloud", [] (double v, double) -> std::string {
             std::string s = ggWave (4, 60, 30, 8, 3, T (v) ? "f" : "a");
             if (T (v))
                 for (int i = 0; i < 5; i++) s += ggP (ggBell (10 + i * 11, 10, 14 + 6 * ggRnd (i, 2), 22));
             return s;
         } },
        { "morphNoise", [] (double v, double) -> std::string {
             std::string t;
             for (int i = 0; i < 22; i++) t += ggC (6 + ggRnd (i, T (v) ? 50 : 51) * 52, 8 + ggRnd (i, T (v) ? 52 : 53) * 30, 1.3, T (v) ? "af" : "f");
             return t + (T (v) ? ggArrow (14, 44, 50, 44) : std::string());
         } },
        { "phaseLock", [] (double v, double) -> std::string {
             std::string t;
             for (int i = -2; i <= 2; i++)
             {
                 const double x = 32 + i * 11, a = T (v) ? 0.6 : 0.6 + (ggRnd (i + 2, 44) - 0.5) * 2.4;
                 t += ggC (x, 24, 4.5, "f") + ggL (x, 24, x + 8 * std::sin (a), 24 - 8 * std::cos (a), "a");
             }
             return t;
         } },
        { "stereoLink", [] (double v, double) -> std::string {
             return ggWave (4, 60, 16, 6, 2) + ggWave (4, 60, 34, 6, 2, T (v) ? "a" : "f")
                  + (T (v) ? ggL (32, 20, 32, 30, "a", "stroke-dasharray=\"2 2\"") : std::string())
                  + "<text x=\"0\" y=\"12\" class=\"t\">L</text><text x=\"0\" y=\"44\" class=\"t\">R</text>";
         } },
        { "linkJitter", [] (double v, double) -> std::string {
             static const double ys[] = { 10, 24, 38 };
             std::string out;
             for (int i = 0; i < 3; i++)
             {
                 const double y = ys[i];
                 std::string d;
                 for (int k = 0; k <= 10; k++)
                 {
                     const double j = ggRnd (k + (T (v) ? 0 : i * 13), 61) - 0.5;
                     d += k ? "L" : "M";
                     d += fx (6 + k * 5.2) + " " + fx (y + j * 8);
                 }
                 out += ggP (d, T (v) || i == 0 ? "a" : "f");
             }
             return out;
         } },
        { "preserveTransients", [] (double v, double) -> std::string {
             return ggGround() + ggWave (4, 60, 37, 1.5, 6, "f") + ggP ("M29 40L32 10L35 40", T (v) ? "a" : "f")
                  + (T (v) ? ggL (22, 6, 42, 6) + ggL (22, 3, 22, 9) + ggL (42, 3, 42, 9) : std::string());
         } },
        { "fbAmount", [] (double v, double) -> std::string {
             std::string t = ggGround();
             for (int k = 0; k < 5; k++)
             {
                 const double a = std::pow (jmax (v, 0.001), k);
                 if (k && a < 0.04) break;
                 t += ggP (ggBell (10 + k * 11, 9, 28 * a), k ? "a" : "f");
             }
             return t;
         } },
        { "fbTimeMs", [] (double v, double) -> std::string {
             const double w = ggLerp (6, 40, ggLog (v, 20, 2000));
             return ggGround() + ggP (ggBell (12, 10, 26), "f") + ggP (ggBell (12 + w, 10, 16)) + ggL (12, 8, 12 + w, 8) + ggL (12, 5, 12, 11) + ggL (12 + w, 5, 12 + w, 11);
         } },
        { "fbSmear", [] (double v, double) -> std::string {
             std::string t = ggGround();
             for (int k = 0; k < 4; k++) t += ggP (ggBell (12 + k * 13, 8 + k * 10 * v, 26 - k * 5), k ? "a" : "f");
             return t;
         } },
        { "fbDamp", [] (double v, double) -> std::string {
             std::string t;
             static const double hh[] = { 0.9, 0.6, 0.8, 0.5, 0.7, 0.4 };
             for (int k = 0; k < 4; k++)
                 for (int i = 0; i < 6; i++)
                 {
                     const double x = 6 + k * 14 + i * 2, top = hh[i] * std::pow (1 - 0.85 * v * i / 5, k);
                     t += ggL (x, 42, x, 42 - 28 * top, k ? "a" : "f");
                 }
             return t;
         } },
        { "fbShift", [] (double v, double) -> std::string {
             std::string t;
             for (int k = 0; k < 4; k++)
             {
                 const double y = 24 - k * v / 12 * 6;
                 t += ggL (6 + k * 14, y, 16 + k * 14, y, k ? "a" : "f");
             }
             return t + ggL (4, 24, 60, 24, "f", ggDot);
         } },
        { "fbHold", [] (double v, double) -> std::string {
             std::string t = ggGround();
             for (int k = 0; k < 5; k++) t += ggP (ggBell (10 + k * 11, 9, T (v) ? 22 : 22 * std::pow (0.6, k)), k ? "a" : "f");
             return t;
         } },
    };
    return t;
}

using Eng = std::string (*)();

const std::vector<std::pair<std::string, Eng>>& engTable()
{
    static const std::vector<std::pair<std::string, Eng>> t = {
        { "wsola", []() -> std::string {
             return ggGround() + ggP (ggBell (20, 26, 24), "f") + ggP (ggBell (40, 26, 24)) + ggL (30, 8, 50, 8, "a") + ggL (30, 5, 30, 11, "a") + ggL (50, 5, 50, 11, "a");
         } },
        { "vocoder", []() -> std::string {
             static const double hs[] = { 0.3, 0.8, 0.5, 0.95, 0.4 };
             std::string s;
             for (int f = 0; f < 3; f++)
                 for (int i = 0; i < 5; i++) s += ggL (8 + f * 18 + i * 3, 42, 8 + f * 18 + i * 3, 42 - hs[i] * 26, f == 1 ? "a" : "f");
             return s;
         } },
        { "pvsola", []() -> std::string {
             static const double hs[] = { 0.3, 0.8, 0.5, 0.95 };
             std::string s;
             for (int f = 0; f < 3; f++)
                 for (int i = 0; i < 4; i++) s += ggL (6 + f * 20 + i * 3, 40, 6 + f * 20 + i * 3, 40 - hs[i] * 22, "f");
             for (double x : { 18.0, 38.0, 58.0 })
                 s += ggL (x, 8, x, 44, "a") + ggP ("M" + n (x - 3) + " 8L" + n (x + 3) + " 8L" + n (x) + " 12Z", "af");
             return s;
         } },
        { "hybrid", []() -> std::string {
             std::string s;
             for (double y : { 12.0, 20.0, 28.0 }) s += ggL (6, y, 34, y, "a");
             for (double x : { 42.0, 50.0 }) s += ggL (x, 8, x, 40, "a");
             for (int i = 0; i < 6; i++) s += ggC (8 + ggRnd (i, 71) * 50, 34 + ggRnd (i, 72) * 8, 1.2, "af");
             return s;
         } },
        { "granular", []() -> std::string {
             std::string s = ggGround();
             for (int i = 0; i < 7; i++) s += ggP (ggBell (8 + i * 8 + (ggRnd (i, 81) - 0.5) * 4, 9, 10 + 20 * ggRnd (i, 82)));
             return s;
         } },
        { "soundhack", []() -> std::string {
             static const double hs[] = { 0.4, 0.9, 0.6, 0.3 };
             static const double x0s[] = { 6, 42 };
             std::string s;
             for (int f = 0; f < 2; f++)
                 for (int i = 0; i < 4; i++) s += ggL (x0s[f] + i * 4, 42, x0s[f] + i * 4, 42 - hs[i] * 26, f ? "a" : "f");
             return s + ggC (32, 14, 6, "f") + ggL (32, 14, 36, 10, "a");
         } },
    };
    return t;
}

template <typename Fn>
const std::unordered_map<std::string, Fn>& lookup (const std::vector<std::pair<std::string, Fn>>& t)
{
    static const std::unordered_map<std::string, Fn> m (t.begin(), t.end());
    return m;
}

const std::unordered_map<std::string, std::string>& groupTable()
{
    static const std::unordered_map<std::string, std::string> m = [] {
        std::unordered_map<std::string, std::string> g = {
            { "ratio", "time" }, { "semitones", "time" }, { "windowMs", "time" },
            { "position", "shape" }, { "rateHz", "shape" }, { "densityHz", "shape" }, { "layers", "shape" }, { "overlap", "shape" },
            { "sizeJitter", "shape" }, { "positionJitterMs", "shape" },
            { "pitchJitterSemis", "pitch" }, { "pitchDriftSemis", "pitch" }, { "driftRateHz", "pitch" },
            { "scan", "scan" }, { "envelope", "scan" }, { "sizeRange", "scan" }, { "layerSpread", "scan" }, { "panSpread", "scan" },
            { "layerScatter", "scan" }, { "layerScatterMs", "scan" },
            { "searchMs", "shape" }, { "splicePick", "shape" }, { "spliceShape", "shape" }, { "stride", "shape" }, { "seed", "shape" },
            { "cloudMix", "time" }, { "sensitivity", "time" }, { "anchorFrames", "time" }, { "vocWindowMs", "time" },
            { "harmonicLevel", "time" }, { "percussiveLevel", "time" }, { "residualLevel", "time" },
            { "floor", "shape" }, { "guardHops", "shape" }, { "anchorSearchMs", "shape" }, { "blend", "shape" },
            { "timeSpan", "shape" }, { "freqSpan", "shape" }, { "margin", "shape" }, { "fftSize", "shape" },
            { "magFreeze", "pitch" }, { "magBlur", "pitch" }, { "magGate", "pitch" },
            { "freqTrust", "pitch" }, { "phaseSpread", "pitch" }, { "peakWidth", "pitch" }, { "lockWidth", "pitch" },
        };
        for (const char* k : { "driftStep", "reverse", "wrap", "cloud", "morphNoise", "phaseLock", "stereoLink", "linkJitter", "preserveTransients", "shVersion",
                               "fbAmount", "fbTimeMs", "fbSmear", "fbDamp", "fbShift", "fbHold" })
            if (g[k].empty()) g[k] = "shape";
        return g;
    }();
    return m;
}

const std::unordered_map<std::string, std::string>& facetTable()
{
    static const std::unordered_map<std::string, std::string> m = [] {
        const std::vector<std::pair<const char*, std::vector<const char*>>> by = {
            { "time", { "ratio", "windowMs", "position", "positionJitterMs", "rateHz", "densityHz", "overlap", "sizeJitter", "sizeRange", "scan",
                        "searchMs", "stride", "anchorFrames", "anchorSearchMs", "reverse", "wrap", "fbTimeMs" } },
            { "pitch", { "semitones", "pitchJitterSemis", "pitchDriftSemis", "driftRateHz", "freqTrust", "driftStep", "fbShift" } },
            { "tone", { "vocWindowMs", "timeSpan", "freqSpan", "margin", "fftSize", "magFreeze", "magBlur", "magGate", "phaseSpread", "peakWidth",
                        "lockWidth", "splicePick", "morphNoise", "phaseLock", "fbSmear", "fbDamp", "shVersion" } },
            { "attack", { "sensitivity", "floor", "guardHops", "envelope", "spliceShape", "blend", "preserveTransients" } },
            { "space", { "layers", "layerSpread", "panSpread", "layerScatter", "layerScatterMs", "seed", "linkJitter", "stereoLink", "cloud", "fbAmount", "fbHold" } },
            { "level", { "cloudMix", "harmonicLevel", "percussiveLevel", "residualLevel" } },
        };
        std::unordered_map<std::string, std::string> f;
        for (const auto& [facet, ks] : by)
            for (const char* k : ks) f[k] = facet;
        return f;
    }();
    return m;
}
} // namespace

std::string draw (const std::string& key, double v, double t)
{
    const auto& m = lookup (table());
    const auto it = m.find (key);
    return it == m.end() ? std::string() : it->second (v, t);
}

std::string engine (const std::string& alg)
{
    const auto& m = lookup (engTable());
    const auto it = m.find (alg);
    return it == m.end() ? std::string() : it->second();
}

bool has (const std::string& key) { return lookup (table()).count (key) != 0; }

const std::vector<std::string>& movingKeys()
{
    static const std::vector<std::string> v = { "sizeJitter", "positionJitterMs", "pitchJitterSemis", "pitchDriftSemis", "driftRateHz" };
    return v;
}

bool moves (const std::string& key)
{
    for (const auto& k : movingKeys())
        if (k == key) return true;
    return false;
}

std::string facet (const std::string& key)
{
    const auto& m = facetTable();
    const auto it = m.find (key);
    return it == m.end() ? std::string ("time") : it->second;
}

std::string group (const std::string& key)
{
    const auto& m = groupTable();
    const auto it = m.find (key);
    return it == m.end() ? std::string() : it->second;
}

const std::vector<std::string>& keys()
{
    static const std::vector<std::string> v = [] {
        std::vector<std::string> k;
        for (const auto& e : table()) k.push_back (e.first);
        return k;
    }();
    return v;
}

const std::vector<std::string>& engines()
{
    static const std::vector<std::string> v = [] {
        std::vector<std::string> k;
        for (const auto& e : engTable()) k.push_back (e.first);
        return k;
    }();
    return v;
}

const std::vector<std::pair<std::string, std::string>>& facets()
{
    static const std::vector<std::pair<std::string, std::string>> v = {
        { "time", "Time" }, { "pitch", "Pitch" }, { "tone", "Timbre" }, { "attack", "Attack" }, { "space", "Space" }, { "level", "Level" }
    };
    return v;
}

const std::vector<std::string>& pick()
{
    static const std::vector<std::string> v = { "similar", "different", "loudest" };
    return v;
}

const std::vector<std::string>& shape()
{
    static const std::vector<std::string> v = { "hann", "triangle", "rect" };
    return v;
}
} // namespace gg
