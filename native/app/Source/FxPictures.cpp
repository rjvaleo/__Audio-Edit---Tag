// MGL's effect cards' pictures and displays, ported string for string. See
// FxPictures.h.
//
// Every expression keeps the JS's order of operations so each double comes
// out as V8 computes it, and nothing may fuse a multiply and an add (JS never
// does; clang does by default on arm64). Math.log and Math.log10 are V8's
// own (fdlibm), since the page writes some of their results out in full;
// Math.sin, cos, exp, pow, tanh, atan, atan2 and asin are the C library's,
// which can differ from V8's fdlibm in the last bit: that would show only
// where a value lands on a rounding edge, and did on none of fxp-test's cases.
//
// The page's regular expressions are std::regex (ECMAScript) on UTF-8: their
// one non-ASCII class (`[−-]`, `[-–—]`) is written as an alternation, and `\s`,
// `\b` and case folding are ASCII's, as JS's are for these labels.

// The JS compares numbers with === and its closures reuse names; the port
// keeps both exactly as the page has them (fxp-test.cpp holds it to the page).
#pragma clang diagnostic ignored "-Wfloat-equal"
#pragma clang diagnostic ignored "-Wshadow-uncaptured-local"

#include "FxPictures.h"
#include "GrainGlyphs.h"

#include <cmath>
#include <cstdint>
#include <cstring>
#include <functional>
#include <limits>
#include <regex>
#include <unordered_map>

#if defined(__clang__)
#pragma clang fp contract(off)
#elif defined(__GNUC__)
#pragma GCC optimize("fp-contract=off")
#elif defined(_MSC_VER)
#pragma fp_contract(off)
#endif

namespace fxp
{
namespace
{
using S = std::string;
const double PI = 3.141592653589793;
const double NaN = std::numeric_limits<double>::quiet_NaN();

// ── JS ─────────────────────────────────────────────────────────────────────

S js (double x) { return gg::jsString (x); }
S fx (double x, int f) { return gg::toFixed (x, f); }

/// `Math.round`.
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
/// A number's truthiness.
bool T (double v) { return ! (v == 0 || std::isnan (v)); }
/// `v || d`.
double orD (double v, double d) { return T (v) ? v : d; }
/// `v | 0`.
int32_t toInt32 (double v)
{
    if (! std::isfinite (v)) return 0;
    double m = std::fmod (std::trunc (v), 4294967296.0);
    if (m < 0) m += 4294967296.0;
    return (int32_t) (uint32_t) m;
}
/// `String(round(v))`.
S rs (double v) { return js (jround (v)); }

S lower (S s)
{
    for (auto& c : s)
        if (c >= 'A' && c <= 'Z') c = (char) (c - 'A' + 'a');
    return s;
}
S upper (S s)
{
    for (auto& c : s)
        if (c >= 'a' && c <= 'z') c = (char) (c - 'a' + 'A');
    return s;
}
std::regex re (const char* p) { return std::regex (p, std::regex::ECMAScript | std::regex::icase); }
std::regex reCase (const char* p) { return std::regex (p, std::regex::ECMAScript); }
bool test (const std::regex& r, const S& s) { return std::regex_search (s, r); }
S replaceFirst (const S& s, const S& a, const S& b)
{
    const auto at = s.find (a);
    return at == S::npos ? s : s.substr (0, at) + b + s.substr (at + a.size());
}
/// JS's `length` (UTF-16 units) of a UTF-8 string.
size_t utf16Length (const S& s)
{
    size_t n = 0;
    for (size_t i = 0; i < s.size();)
    {
        const unsigned char c = (unsigned char) s[i];
        const size_t k = c < 0x80 ? 1 : c < 0xe0 ? 2 : c < 0xf0 ? 3 : 4;
        n += k == 4 ? 2 : 1;
        i += k;
    }
    return n;
}

// ── V8's Math.log and Math.log10 ───────────────────────────────────────────

/// `Math.log`: fdlibm's e_log.c as V8 builds it, copied from GrainGlyphs.cpp
/// (whose `jlog` is private to it); see the note there on the fused products.
double jlogImpl (double x)
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

/// `Math.log10`: fdlibm's e_log10.c as V8 has it (`base::ieee754::log10`),
/// its log being the one above; the two products fused as clang fuses them.
double jlog10Impl (double x)
{
    const double two54 = 1.80143985094819840000e+16, ivln10 = 4.34294481903251816668e-01, log10_2hi = 3.01029995663611771306e-01,
                 log10_2lo = 3.69423907715893078616e-13;
    uint64_t u;
    std::memcpy (&u, &x, 8);
    int32_t hx = (int32_t) (u >> 32);
    uint32_t lx = (uint32_t) u;
    int32_t k = 0;
    if (hx < 0x00100000)
    {
        if (((hx & 0x7fffffff) | (int32_t) lx) == 0) return -std::numeric_limits<double>::infinity();
        if (hx < 0) return NaN;
        k -= 54;
        x *= two54;
        std::memcpy (&u, &x, 8);
        hx = (int32_t) (u >> 32);
        lx = (uint32_t) u;
    }
    if (hx >= 0x7ff00000) return x + x;
    if (hx == 0x3ff00000 && lx == 0) return 0;
    k += (hx >> 20) - 1023;
    const int32_t i = (int32_t) (((uint32_t) k & 0x80000000u) >> 31);
    hx = (hx & 0x000fffff) | ((0x3ff - i) << 20);
    const double y = k + i;
    u = ((uint64_t) (uint32_t) hx << 32) | lx;
    std::memcpy (&x, &u, 8);
    const double z = std::fma (y, log10_2lo, ivln10 * jlogImpl (x));
    return std::fma (y, log10_2hi, z);
}

// ── FXP's drawing kit (64 x 48, ground at 40) ──────────────────────────────

const double B = 40;
double cl (double v, double a = 0, double b = 1) { return jmax (a, jmin (b, v)); }
double lerp (double a, double b, double t) { return a + (b - a) * t; }
double rnd (double i, double s = 7)
{
    const double x = std::sin (i * 127.1 + s * 311.7) * 43758.5453;
    return x - std::floor (x);
}
S L (double x1, double y1, double x2, double y2, const S& c = "f", const S& e = "")
{
    return "<line x1=\"" + N (x1) + "\" y1=\"" + N (y1) + "\" x2=\"" + N (x2) + "\" y2=\"" + N (y2) + "\" class=\"" + c + "\" " + e + "/>";
}
S P (const S& d, const S& c = "a", const S& e = "") { return "<path d=\"" + d + "\" class=\"" + c + "\" " + e + "/>"; }
S C (double x, double y, double r, const S& c = "a")
{
    return "<circle cx=\"" + N (x) + "\" cy=\"" + N (y) + "\" r=\"" + N (jmax (.2, r)) + "\" class=\"" + c + "\"/>";
}
S R (double x, double y, double w, double h, const S& c = "a")
{
    return "<rect x=\"" + N (x) + "\" y=\"" + N (y) + "\" width=\"" + N (jmax (0, w)) + "\" height=\"" + N (jmax (0, h)) + "\" class=\"" + c + "\"/>";
}
S Tx (double x, double y, const S& s, const S& c = "t", const S& a = "start")
{
    return "<text x=\"" + N (x) + "\" y=\"" + N (y) + "\" class=\"" + c + "\" text-anchor=\"" + a + "\">" + s + "</text>";
}
S G() { return L (4, B, 60, B); }
const S dash = "stroke-dasharray=\"2 3\"";
S bell (double cx, double w, double h, double base = B, double peak = .5)
{
    S d;
    for (int i = 0; i <= 16; i++)
    {
        const double t = (double) i / 16, u = t < peak ? .5 * t / peak : .5 + .5 * (t - peak) / (1 - peak);
        d += (i ? "L" : "M") + N (cx - w / 2 + w * t) + " " + N (base - h * .5 * (1 - std::cos (2 * PI * u)));
    }
    return d;
}
using Fn1 = double (*) (double);
double jsSin (double x) { return std::sin (x); }
S wave (double x0, double x1, double y, double amp, double cyc, const S& c = "a", double ph = 0, Fn1 fn = jsSin)
{
    S d;
    for (int i = 0; i <= 64; i++)
    {
        const double t = (double) i / 64;
        d += (i ? "L" : "M") + N (lerp (x0, x1, t)) + " " + N (y - amp * fn ((t * cyc + ph) * 2 * PI));
    }
    return P (d, c);
}
S arrow (double x1, double y1, double x2, double y2, const S& c = "a")
{
    const double a = std::atan2 (y2 - y1, x2 - x1), s = 4;
    return L (x1, y1, x2, y2, c)
         + P ("M" + N (x2 - s * std::cos (a - .5)) + " " + N (y2 - s * std::sin (a - .5)) + "L" + N (x2) + " " + N (y2) + "L" + N (x2 - s * std::cos (a + .5)) + " "
                  + N (y2 - s * std::sin (a + .5)),
              c);
}
S imp (double x, double h, const S& c = "a") { return L (x, B, x, B - h, c); }
S tail (double x0, double len, double h, const S& c = "a")
{
    S d = "M" + N (x0) + " " + N (B - h);
    for (int i = 1; i <= 20; i++)
    {
        const double t = (double) i / 20;
        d += "L" + N (x0 + len * t) + " " + N (B - h * std::exp (-4 * t));
    }
    return P (d, c);
}
S spectrum (const std::function<double (double)>& fn, const S& c = "a")
{
    S d;
    for (int i = 0; i <= 40; i++)
    {
        const double t = (double) i / 40;
        d += (i ? "L" : "M") + N (4 + 56 * t) + " " + N (B - 30 * cl (fn (t)));
    }
    return P (d, c);
}
S bars (int n, const std::function<double (int, int)>& fn, const S& c = "a", double x0 = 6, double x1 = 58)
{
    S s;
    for (int i = 0; i < n; i++)
    {
        const double x = lerp (x0, x1, n > 1 ? (double) i / (n - 1) : .5);
        s += L (x, B, x, B - 30 * cl (fn (i, n)));
        (void) c;
    }
    return s;
}

// ── PIC ────────────────────────────────────────────────────────────────────

using PicFn = std::function<S (double n, double v, const Spec* p)>;
struct PicEntry
{
    const char* name;
    PicFn fn;
};

/// `+((s).match(re) || [d])[0]`.
double firstNumber (const S& s, const std::regex& r, double d)
{
    std::smatch m;
    if (std::regex_search (s, m, r)) return std::strtod (m.str (0).c_str(), nullptr);
    return d;
}

const std::vector<PicEntry>& pics()
{
    static const std::vector<PicEntry> v = {
        // time and delay
        { "delay", [] (double n, double, const Spec*) { return G() + imp (8, 26, "f") + imp (lerp (12, 58, n), 20) + L (8, 8, lerp (12, 58, n), 8, "a") + L (8, 5, 8, 11, "a"); } },
        { "predelay", [] (double n, double, const Spec*) { const double x = lerp (8, 34, n); return G() + imp (6, 26, "f") + L (6, 8, x, 8, "a") + tail (x, 58 - x, 22); } },
        { "feedback", [] (double n, double, const Spec*) {
             S s = G() + imp (6, 28, "f");
             for (int i = 1; i < 6; i++) s += imp (6 + i * 10, 28 * std::pow (n, i));
             return s;
         } },
        { "taps", [] (double, double v, const Spec*) {
             const double k = cl (orD (jround (v), 1), 1, 12);
             S s = G();
             for (int i = 0; i < k; i++) s += imp (8 + i * 48 / jmax (1, orD (k - 1, 1)), 26 - i * 1.5);
             return s;
         } },
        // level and mix
        { "level", [] (double n, double, const Spec*) { return R (26, B - 32, 12, 32, "f") + R (26, B - 32 * n, 12, 32 * n, "af") + L (22, B - 32 * .8, 42, B - 32 * .8, "f") + Tx (46, B - 32 * .8 + 3, "0"); } },
        { "mix", [] (double n, double, const Spec*) {
             return R (14, B - 30 * (1 - n), 12, 30 * (1 - n), "ff") + R (38, B - 30 * n, 12, 30 * n, "af") + G() + Tx (20, 47, "dry", "t", "middle") + Tx (44, 47, "wet", "ta", "middle");
         } },
        // modulation
        { "rate", [] (double n, double, const Spec*) { return wave (4, 60, 22, 11, lerp (.5, 8, n)) + L (4, 22, 60, 22, "f", "stroke-dasharray=\"1 2\""); } },
        { "depth", [] (double n, double, const Spec*) { return wave (4, 60, 22, 14, 2, "f", 0) + wave (4, 60, 22, 14 * n, 2); } },
        // frequency
        { "freq", [] (double n, double, const Spec*) { return G() + spectrum ([n] (double t) { return .15 + .8 * std::exp (-std::pow ((t - n) * 9, 2)); }) + L (4 + 56 * n, B, 4 + 56 * n, B + 4, "a"); } },
        { "lowpass", [] (double n, double, const Spec*) { return G() + spectrum ([n] (double t) { return t < n ? .85 : .85 * std::exp (-(t - n) * 14); }) + L (4 + 56 * n, 6, 4 + 56 * n, B, "f", dash); } },
        { "highpass", [] (double n, double, const Spec*) { return G() + spectrum ([n] (double t) { return t > n ? .85 : .85 * std::exp (-(n - t) * 14); }) + L (4 + 56 * n, 6, 4 + 56 * n, B, "f", dash); } },
        { "q", [] (double n, double, const Spec*) { return G() + spectrum ([n] (double t) { return .1 + .85 * std::exp (-std::pow ((t - .5) * lerp (3, 26, n), 2)); }); } },
        { "xover", [] (double n, double, const Spec*) {
             return G() + spectrum ([n] (double t) { return t < n ? .8 : .35; }, "a") + L (4 + 56 * n, 4, 4 + 56 * n, B, "a") + Tx (8, 9, "lo") + Tx (56, 9, "hi", "t", "end");
         } },
        // dynamics
        { "threshold", [] (double n, double, const Spec*) {
             const double y = lerp (36, 8, n), x = lerp (8, 52, n);
             return L (6, 42, 58, 6) + P ("M6 42L" + N (x) + " " + N (y + 4) + "L58 " + N (y)) + L (4, y + 4, 60, y + 4, "f", dash);
         } },
        { "ratio", [] (double, double v, const Spec*) {
             const double r = jmax (1, orD (v, 1));
             return L (6, 42, 58, 6) + P ("M6 42L26 22L58 " + N (22 - 32 / r * .6)) + Tx (58, 46, fx (orD (v, 1), 1) + ":1", "t", "end");
         } },
        { "attack", [] (double n, double, const Spec*) { const double x = lerp (8, 50, n); return G() + P ("M6 40L" + N (x) + " 10L58 10") + L (6, 44, x, 44, "a"); } },
        { "release", [] (double n, double, const Spec*) {
             const double x = lerp (14, 58, n);
             return G() + P ("M6 10L10 10Q" + N ((10 + x) / 2) + " 10 " + N (x) + " 40") + L (10, 44, x, 44, "a");
         } },
        { "knee", [] (double n, double, const Spec*) {
             const double r = lerp (1, 18, n);
             return L (6, 42, 58, 6) + P ("M6 42L" + N (28 - r) + " " + N (22 + r * .6) + "Q28 22 " + N (28 + r) + " " + N (22 - r * .25) + "L58 14");
         } },
        { "gate", [] (double n, double, const Spec*) {
             const double y = lerp (36, 10, n);
             S s = L (4, y, 60, y, "f", dash);
             for (int i = 0; i < 13; i++)
             {
                 const double h = 6 + 26 * rnd (i, 4), x = 6 + i * 4.3;
                 s += L (x, B, x, B - h, B - h < y ? "a" : "f");
             }
             return s;
         } },
        // space
        { "tail", [] (double n, double, const Spec*) { return G() + imp (6, 28, "f") + tail (6, lerp (8, 54, n), 26); } },
        { "size", [] (double n, double, const Spec*) {
             const double w = lerp (14, 50, n), h = lerp (10, 30, n), x = 32 - w / 2, y = B - h;
             S s = R (x, y, w, h);
             for (int i = 0; i < 4; i++) s += L (32, B - 4, x + w * rnd (i, 2), y + h * rnd (i, 5) * .5, "f");
             return s + C (32, B - 4, 2, "af");
         } },
        { "diffusion", [] (double n, double, const Spec*) {
             S s = G();
             const double k = jround (lerp (4, 40, n));
             for (int i = 0; i < k; i++) s += C (6 + 52 * rnd (i, 3), 8 + 30 * rnd (i, 9), .9, "af");
             return s;
         } },
        { "damping", [] (double n, double, const Spec*) { return G() + tail (6, 52, 24, "f") + tail (6, lerp (52, 12, n), 24) + Tx (58, 9, "hi", "t", "end"); } },
        { "bassRt", [] (double n, double, const Spec*) { return G() + tail (6, 34, 24, "f") + tail (6, lerp (10, 56, n / 1), 24) + Tx (58, 9, "lo", "ta", "end"); } },
        { "tapSlope", [] (double, double v, const Spec*) {
             const double sl = orD (v, 0) / 10;
             S s;
             for (int i = 0; i < 12; i++)
             {
                 const double t = (double) i / 11, trend = 1 - t,
                              h = 30 * cl (trend * (1 + sl * (t - .5) * 1.4) + (sl < 0 ? .1 * (double) (i % 3 == 0) : 0), .05, 1);
                 s += L (6 + i * 4.6, B, 6 + i * 4.6, B - h, "a");
             }
             return P ("M4 40L4 10L60 40Z", "ff") + s;
         } },
        { "shape", [] (double n, double, const Spec*) { return G() + P (bell (lerp (14, 40, n), lerp (16, 40, n), 28, B, cl (n, .1, .9))) + Tx (6, 9, "early"); } },
        { "spread", [] (double n, double, const Spec*) {
             return G() + P (bell (24, lerp (10, 50, n), 24, B, .2)) + L (24 - lerp (10, 50, n) / 2, 44, 24 + lerp (10, 50, n) / 2, 44, "a");
         } },
        { "wander", [] (double n, double, const Spec*) {
             S s;
             for (int k = 0; k < 3; k++) s += wave (4, 60, 14 + k * 11, 4 * n, 2 + k, k ? "f" : "a", rnd (k, 2));
             return s;
         } },
        { "spin", [] (double n, double, const Spec*) {
             S s = C (32, 24, 14, "f");
             for (int i = 0; i < 6; i++)
             {
                 const double a = (double) i / 6 * PI * 2 + n * 3;
                 s += C (32 + 14 * std::cos (a), 24 + 14 * std::sin (a), 1.6, "af");
             }
             return s + arrow (32, 24, 32 + 12 * std::cos (n * 6), 24 + 12 * std::sin (n * 6));
         } },
        // stereo
        { "pan", [] (double n, double, const Spec*) {
             const double a = (n - .5) * 2.4;
             return P ("M10 40A22 22 0 0 1 54 40", "f") + C (32 + 22 * std::sin (a), 40 - 22 * std::cos (a), 3, "af") + Tx (4, 44, "L") + Tx (60, 44, "R", "t", "end");
         } },
        { "width", [] (double n, double, const Spec*) {
             const double d = lerp (1, 22, n);
             return P ("M10 40A22 22 0 0 1 54 40", "f") + C (32 - d, 40 - std::sqrt (484 - d * d), 2.6, "af") + C (32 + d, 40 - std::sqrt (484 - d * d), 2.6, "af") + L (32 - d, 30, 32 + d, 30, "a");
         } },
        // pitch and shaping
        { "pitch", [] (double, double v, const Spec* p) {
             static const auto ct = re ("ct|cent");
             const double st = p && test (ct, p->unit) ? v / 100 : orD (v, 0);
             return wave (4, 46, 24, 9, 2, "f") + wave (4, 46, 24, 9, 2 * std::pow (2, cl (st, -24, 24) / 12))
                  + (std::abs (st) > .01 ? arrow (55, 24, 55, 24 - cl (st / 12, -1, 1) * 14) : C (55, 24, 1.6, "af"));
         } },
        { "bits", [] (double n, double, const Spec*) {
             const double lv = std::pow (2, jround (lerp (1, 6, n)));
             S d;
             for (int i = 0; i <= 48; i++)
             {
                 const double t = (double) i / 48, y = jround (std::sin (t * 2 * PI) * lv / 2) / (lv / 2);
                 d += (i ? "L" : "M") + N (6 + 52 * t) + " " + N (24 - 14 * y);
             }
             return wave (6, 58, 24, 14, 1, "f") + P (d);
         } },
        { "srate", [] (double n, double, const Spec*) {
             const double st = jround (lerp (24, 3, n));
             S d;
             for (int i = 0; i < st; i++)
             {
                 const double t0 = i / st, y = 24 - 14 * std::sin (t0 * 2 * PI);
                 d += (i ? "L" : "M") + N (6 + 52 * t0) + " " + N (y) + "L" + N (6 + 52 * (double) (i + 1) / st) + " " + N (y);
             }
             return wave (6, 58, 24, 14, 1, "f") + P (d);
         } },
        { "drive", [] (double n, double, const Spec*) {
             const double k = lerp (1, 8, n);
             S d;
             for (int i = 0; i <= 48; i++)
             {
                 const double t = (double) i / 48, y = std::tanh (k * std::sin (t * 2 * PI)) / std::tanh (k);
                 d += (i ? "L" : "M") + N (6 + 52 * t) + " " + N (24 - 14 * y);
             }
             return wave (6, 58, 24, 14, 1, "f") + P (d);
         } },
        { "harmonic", [] (double n, double, const Spec* p) {
             static const auto digitsRe = reCase ("\\d+");
             const double k = firstNumber (p ? p->key : S(), digitsRe, 3);
             return bars (8, [n, k] (int i, int) { return i == 0 ? .7 : i == k - 1 ? .7 * n : .06; }, "a");
         } },
        { "polarity", [] (double n, double, const Spec*) { return wave (4, 60, 24, 12, 1.5, "f") + wave (4, 60, 24, n > .5 ? -12 : 12, 1.5); } },
        { "count", [] (double, double v, const Spec*) {
             const double k = cl (orD (jround (v), 1), 1, 16);
             S s;
             for (int i = 0; i < k; i++) s += P (bell (32 + (i - (k - 1) / 2) * lerp (6, 3, k / 16), 22, 22 - i * .4, B), i ? "f" : "a");
             return s + Tx (60, 9, js (k), "ta", "end");
         } },
        { "scatter", [] (double, double v, const Spec*) {
             S s = G();
             const double seed = (double) (toInt32 (v) % 997 + 1);
             for (int i = 0; i < 9; i++) s += C (6 + 52 * rnd (i, seed), 10 + 26 * rnd (i + 9, seed), 1.8, "af");
             return s;
         } },
        { "frames", [] (double n, double, const Spec*) {
             S s;
             const double k = jround (lerp (2, 16, n));
             for (int i = 0; i < k; i++) s += R (6 + i * 52 / k, 12, 52 / k - 1.5, 26, i == 0 ? "a" : "f");
             return s;
         } },
        { "interval", [] (double n, double, const Spec* p) {
             static const std::map<S, int> exact = { { "root", 0 }, { "m2", 1 }, { "M2", 2 }, { "m3", 3 }, { "M3", 4 }, { "4th", 5 }, { "5th", 7 },
                                                     { "m6", 8 }, { "M6", 9 }, { "m7", 10 }, { "M7", 11 }, { "octave", 12 }, { "just", 7 } };
             static const std::map<S, int> loose = { { "root", 0 }, { "octave", 12 }, { "just", 7 } };
             int iv = 7;
             const S label = p ? p->label : S();
             if (auto it = exact.find (label); p && it != exact.end()) iv = it->second;
             else if (auto jt = loose.find (lower (label)); jt != loose.end()) iv = jt->second;
             S s;
             for (int i = 0; i < 13; i++)
             {
                 const bool on = i == 0 || i == iv;
                 s += R (4 + i * 4.4, 10, 4, 28, on && n > .5 ? "af" : on ? "a" : "f");
             }
             return s;
         } },
        { "freeze", [] (double n, double, const Spec*) {
             S s;
             for (int i = 0; i < 9; i++)
                 for (int j = 0; j < 6; j++)
                 {
                     const bool held = n > .5 && i > 3;
                     const double a = rnd ((held ? 3 : i) * 7 + j, 2);
                     if (a > .4) s += R (5 + i * 6, 6 + j * 6, 5, 5, held ? "af" : "ff");
                 }
             return s + (n > .5 ? L (28, 4, 28, 44, "a") : S());
         } },
        { "swap", [] (double n, double, const Spec*) {
             return n > .5 ? arrow (8, 14, 56, 34) + arrow (8, 34, 56, 14) + Tx (4, 10, "L") + Tx (4, 44, "R")
                           : arrow (8, 14, 56, 14) + arrow (8, 34, 56, 34) + Tx (4, 10, "L") + Tx (4, 44, "R");
         } },
        { "link", [] (double n, double, const Spec*) {
             return wave (4, 60, 16, 6, 2) + wave (4, 60, 34, 6, 2, "a", n > .5 ? 0 : .35) + (n > .5 ? L (32, 16, 32, 34, "a", "stroke-dasharray=\"2 2\"") : S());
         } },
        { "smooth", [] (double n, double, const Spec*) {
             const int st = 6;
             S d;
             for (int i = 0; i < st; i++)
             {
                 const double y = 34 - 24 * ((double) i / (st - 1));
                 d += (i ? "L" : "M") + N (6 + i * 9) + " " + N (y) + "L" + N (6 + (i + 1) * 9) + " " + N (y);
             }
             S c = "M6 34";
             for (int i = 1; i <= 30; i++)
             {
                 const double t = (double) i / 30, k = lerp (.02, .9, n);
                 c += "L" + N (6 + 54 * t) + " " + N (34 - 24 * std::pow (jmin (1, jmax (0, (t - k * .3) / jmax (.05, 1 - k * .3))), lerp (1, .5, n)));
             }
             return P (d, "f") + P (c);
         } },
        { "taplevel", [] (double n, double, const Spec* p) {
             static const auto digitRe = reCase ("\\d");
             const double k = firstNumber (p ? p->label : S(), digitRe, 1);
             S s = G() + imp (8, 28, "f");
             for (int i = 1; i <= 3; i++) s += imp (8 + i * 15, i == k ? 28 * n : 12, i == k ? "a" : "f");
             return s;
         } },
        { "xy", [] (double n, double, const Spec* p) {
             static const auto xr = re ("x|right");
             const bool isX = test (xr, p ? p->label : S());
             const double pos = (n - .5) * 44;
             const double sx = 32 + (isX ? pos : 0), sy = 24 - (isX ? 0 : pos * .45);
             return L (6, 24, 58, 24, "f", "stroke-dasharray=\"1 2\"") + L (32, 4, 32, 44, "f", "stroke-dasharray=\"1 2\"") + P ("M28 40L32 32L36 40Z", "f") + C (sx, sy, 3.2, "af") + C (sx, sy, 7, "a");
         } },
        { "grain", [] (double n, double, const Spec*) {
             return G() + P (bell (32, lerp (6, 56, n), 26)) + L (32 - lerp (6, 56, n) / 2, 44, 32 + lerp (6, 56, n) / 2, 44, "a");
         } },
        { "xfade", [] (double n, double, const Spec*) {
             const double o = lerp (2, 24, n);
             return G() + P (bell (22, 28, 26), "f") + P (bell (22 + 28 - o, 28, 26)) + L (22 + 14 - o, 44, 22 + 14, 44, "a");
         } },
        { "flip", [] (double n, double, const Spec*) {
             const double w = lerp (8, 26, n);
             S s = G();
             for (int i = 0; i < 3; i++)
             {
                 const double x = 6 + i * (w + 3);
                 if (x + w > 60) break;
                 s += P (bell (x + w / 2, w, 24, B, i % 2 ? .85 : .15), i % 2 ? "a" : "f");
             }
             return s + arrow (6 + w + 3 + w, 8, 6 + w + 3, 8);
         } },
        { "lfoShape", [] (double n, double, const Spec*) {
             const double k = jround (n * 3);
             static const Fn1 fns[4] = { jsSin, [] (double x) { return 2 / PI * std::asin (std::sin (x)); }, [] (double x) { return std::fmod (x / PI, 2) - 1; },
                                         [] (double x) { return jsign (std::sin (x)); } };
             // JS throws past the four shapes (n outside -1/6 .. 7/6).
             if (! (k >= 0 && k <= 3)) return S();
             return wave (4, 60, 24, 12, 2, "a", 0, fns[(int) k]);
         } },
        { "phase", [] (double n, double, const Spec*) { return wave (4, 60, 24, 12, 1.5, "f") + wave (4, 60, 24, 12, 1.5, "a", n); } },
        { "twoHeads", [] (double n, double, const Spec*) {
             return G() + imp (8, 28, "f") + imp (30, 20) + (n > .5 ? imp (48, 20) : imp (48, 20, "f")) + Tx (60, 9, n > .5 ? "2" : "1", "ta", "end");
         } },
        { "fbInvert", [] (double n, double, const Spec*) {
             S s = L (4, 24, 60, 24, "f");
             for (int i = 0; i < 6; i++)
             {
                 const double h = 18 * std::pow (.7, i) * (n > .5 && i % 2 ? -1 : 1);
                 s += L (8 + i * 10, 24, 8 + i * 10, 24 - h, i ? "a" : "f");
             }
             return s;
         } },
        { "generic", [] (double n, double, const Spec*) {
             const double a0 = PI * .75, a = a0 + n * PI * 1.5, r = 15;
             return P ("M" + N (32 + r * std::cos (a0)) + " " + N (26 + r * std::sin (a0)) + "A15 15 0 1 1 " + N (32 + r * std::cos (a0 + PI * 1.5)) + " " + N (26 + r * std::sin (a0 + PI * 1.5)), "f")
                  + P ("M" + N (32 + r * std::cos (a0)) + " " + N (26 + r * std::sin (a0)) + "A15 15 0 " + (n > 2.0 / 3 ? "1" : "0") + " 1 " + N (32 + r * std::cos (a)) + " " + N (26 + r * std::sin (a)))
                  + L (32, 26, 32 + r * std::cos (a), 26 + r * std::sin (a), "a");
         } },
    };
    return v;
}

const std::unordered_map<S, size_t>& picIndex()
{
    static const auto m = [] {
        std::unordered_map<S, size_t> r;
        for (size_t i = 0; i < pics().size(); ++i) r[pics()[i].name] = i;
        return r;
    }();
    return m;
}

// ── HERO ───────────────────────────────────────────────────────────────────

double hx (double t) { return 10 + t * (HW - 20); }
double hy (double a) { return HH - 14 - a * (HH - 28); }
S hgrid()
{
    S s;
    for (int i = 1; i <= 3; i++) s += "<line x1=\"10\" x2=\"" + js (HW - 10) + "\" y1=\"" + js (hy ((double) i / 4)) + "\" y2=\"" + js (hy ((double) i / 4)) + "\" class=\"hg\"/>";
    return s;
}
using Pts = std::vector<std::pair<double, double>>;
S ptsD (const Pts& pts)
{
    S d;
    for (size_t i = 0; i < pts.size(); ++i) d += (i ? "L" : "M") + N (pts[i].first) + " " + N (pts[i].second);
    return d;
}
S hpath (const Pts& pts, const S& cls = "hc") { return "<path d=\"" + ptsD (pts) + "\" class=\"" + cls + "\"/>"; }
S hcurve (const std::function<double (double)>& fn, bool fill = true)
{
    Pts pts;
    for (int i = 0; i <= 160; i++)
    {
        const double t = (double) i / 160;
        pts.push_back ({ hx (t), hy (cl (fn (t))) });
    }
    return (fill ? "<path d=\"" + ptsD (pts) + "L" + js (hx (1)) + " " + js (hy (0)) + "L" + js (hx (0)) + " " + js (hy (0)) + "Z\" class=\"hf\"/>" : S()) + hpath (pts);
}
S ht (double x, double y, const S& s, const S& a = "start", const S& c = "ht")
{
    return "<text x=\"" + N (x) + "\" y=\"" + N (y) + "\" class=\"" + c + "\" text-anchor=\"" + a + "\">" + s + "</text>";
}
S hfreqAxis()
{
    static const char* const l[4] = { "20", "100", "1k", "10k" };
    S s;
    for (int i = 0; i < 4; i++) s += ht (hx ((double) i / 3) + 2, HH - 2, l[i]);
    return s;
}
double flog (double hz) { return cl (jlogImpl (jmax (20, hz) / 20) / jlogImpl (1000)); }
S himp (double t, double a, const S& cls = "hc")
{
    return "<line x1=\"" + N (hx (t)) + "\" x2=\"" + N (hx (t)) + "\" y1=\"" + js (hy (0)) + "\" y2=\"" + N (hy (a)) + "\" class=\"" + cls + "\"/>";
}
S hsig (const std::function<double (double)>& fn, int n = 400, const S& cls = "hc")
{
    Pts pts;
    for (int i = 0; i <= n; i++)
    {
        const double t = (double) i / n;
        pts.push_back ({ hx (t), HH / 2 - 38 * cl (fn (t), -1, 1) });
    }
    return hpath (pts, cls);
}
double src (double t) { return std::sin (t * 2 * PI * 9) * (.35 + .55 * std::exp (-std::fmod (t * 3, 1) * 4)); }
bool bit (double v) { return v > .5; }
S fmtHz (double hz) { return (hz >= 1000 ? fx (hz / 1000, 1) + "k" : rs (hz)) + " Hz"; }

/// `v.a ?? v.b ?? d`.
double val2 (const Values& v, const S& a, const S& b, double d)
{
    if (auto it = v.find (a); it != v.end()) return it->second;
    return val (v, b, d);
}

S heroModDelay (const Values& v, const S& name)
{
    const double d = val2 (v, "delayMs", "delay", 5), dep = val2 (v, "depthMs", "depth", 2), r = val2 (v, "rateHz", "rate", .5), fb = val (v, "feedback", 0);
    const double span = 40, base = cl (d / span), sw = cl (dep / span);
    S s = hgrid() + ht (12, 12, name + " · delay " + fx (d, 1) + " ms ± " + fx (dep, 1)) + ht (HW - 12, 12, fx (r, 2) + " Hz", "end");
    s += "<rect x=\"10\" y=\"" + js (hy (base + sw)) + "\" width=\"" + js (HW - 20) + "\" height=\"" + N (hy (base - sw) - hy (base + sw)) + "\" class=\"hband\"/>";
    s += hcurve ([=] (double t) { return base + sw * std::sin (t * 2 * PI * cl (r, .05, 8) * 2); }, false);
    const double st = val (v, "stereo", .25);
    s += replaceFirst (hcurve ([=] (double t) { return base + sw * std::sin (t * 2 * PI * cl (r, .05, 8) * 2 + st * 2 * PI); }, false), "class=\"hc\"", "class=\"hd\"");
    for (int k = 1; k < 6; k++) s += himp (.05 + k * .03, .25 * std::pow (std::abs (fb), k), "hd");
    return s + ht (12, HH - 2, "L solid · R dashed");
}
S heroReverb (const Values& v, const S&)
{
    const double dec = val (v, "decay", .7), pd = val (v, "predelayMs", 0) / 500, dif = val (v, "diffusion", .6), size = val (v, "size", .5);
    const bool frz = bit (val (v, "freeze", 0));
    const double air = val (v, "damping", 0);
    const double len = frz ? 2 : lerp (.08, .95, dec), x0 = .02 + cl (pd) * .3;
    S s = hgrid() + himp (.02, .95);
    s += "<line x1=\"" + js (hx (.02)) + "\" x2=\"" + js (hx (x0)) + "\" y1=\"" + js (hy (.98)) + "\" y2=\"" + js (hy (.98)) + "\" class=\"hd\"/>" + ht (hx (.02) + 3, 12, "predelay");
    const double k = jround (lerp (14, 140, dif) * lerp (1.4, .7, size));
    for (int i = 0; i < k; i++)
    {
        const double t = i / k, x = x0 + t * jmin (len, 1 - x0);
        if (x > .99) break;
        s += himp (x, (frz ? .7 : .85 * std::exp (-3 * t / jmin (1, len) * .9)) * (.6 + .4 * rnd (i, 3)) * (1 - air * t * .6), "hc thin");
    }
    return s + ht (HW - 12, 12, frz ? "FROZEN · ∞" : "decay " + fx (dec, 2), "end") + ht (HW - 12, HH - 2, "size " + fx (size, 2) + " · diffusion " + fx (dif, 2), "end");
}
S heroNoise (const Values& v, const S& kind)
{
    const double clk = val (v, "clockHz", 8000), lvl = val (v, "level", .5);
    const double top = flog (clk / 2);
    S s = hgrid() + hfreqAxis();
    if (kind == "pn_noise_eq") s += hcurve ([=] (double t) { return lvl * (.9 - .5 * t) * (t < top ? 1 : std::exp (-(t - top) * 20)); });
    else if (kind == "single_bit_pn") s += hcurve ([=] (double t) { return lvl * (t < top ? .8 * std::pow (std::abs (std::sin (t * 40)), .3) : .05); });
    else s += hcurve ([=] (double t) { return lvl * (t < top ? .8 : std::exp (-(t - top) * 20) * .8); });
    s += "<line x1=\"" + js (hx (top)) + "\" x2=\"" + js (hx (top)) + "\" y1=\"" + js (hy (0)) + "\" y2=\"" + js (hy (1)) + "\" class=\"hd\"/>" + ht (hx (top) + 3, 14, "clock " + fmtHz (clk) + " → content to " + fmtHz (clk / 2));
    return s;
}
struct FBand
{
    S name, type;
    bool on;
    double f, q, a;
};
S heroFilterSet (const std::vector<FBand>& bands)
{
    S s = hgrid() + hfreqAxis();
    auto resp = [&] (double t) {
        double g = 0;
        bool any = false;
        for (const auto& b : bands)
        {
            if (! b.on) continue;
            any = true;
            const double x = flog (b.f), w = lerp (.25, .02, cl (b.q / 10));
            const double d = t - x;
            g += b.a
               * (b.type == "low"     ? (d < 0 ? 1 : std::exp (-d / w))
                  : b.type == "high"  ? (d > 0 ? 1 : std::exp (d / w))
                  : b.type == "notch" ? 1 - std::exp (-(d * d) / (w * w * .4))
                                      : std::exp (-(d * d) / (w * w)));
        }
        return any ? cl (g * .7) : .02;
    };
    s += hcurve (resp);
    for (const auto& b : bands)
        if (b.on)
            s += "<circle cx=\"" + js (hx (flog (b.f))) + "\" cy=\"" + js (hy (cl (resp (flog (b.f))))) + "\" r=\"4\" class=\"hdot\"/>"
               + ht (hx (flog (b.f)), hy (cl (resp (flog (b.f)))) - 8, b.name, "middle");
    return s;
}

S heroUtility (const Values& v)
{
    const double g = val (v, "gainDb", 0), w = val (v, "width", 1);
    const bool inv = bit (val (v, "invert", 0)), sw = bit (val (v, "swap", 0));
    const double cx = HW / 2;
    S s = "<path d=\"M" + js (cx - 90) + " " + js (HH - 14) + "A90 90 0 0 1 " + js (cx + 90) + " " + js (HH - 14) + "\" class=\"hd\" fill=\"none\"/>";
    const double d = 80 * cl (w / 2);
    const std::pair<const char*, double> sides[2] = { { "L", -1 }, { "R", 1 } };
    for (const auto& [k, sg] : sides)
    {
        const double x = cx + sg * d * (sw ? -1 : 1);
        const double y = HH - 14 - std::sqrt (jmax (0, 8100 - std::pow (x - cx, 2)));
        s += "<circle cx=\"" + N (x) + "\" cy=\"" + N (y) + "\" r=\"7\" class=\"hdot\"/>" + ht (x, y + 3, k, "middle", "htd");
    }
    return s + ht (12, 12, (g >= 0 ? "+" : "") + fx (g, 1) + " dB") + ht (HW - 12, 12, S (inv ? "polarity flipped · " : "") + (sw ? "L↔R swapped · " : "") + "width " + fx (w, 2) + "×", "end");
}
S single (const std::function<double (double)>& fn) { return hgrid() + hfreqAxis() + hcurve (fn); }

using HeroFn = std::function<S (const Values&)>;
struct HeroEntry
{
    const char* name;
    HeroFn fn;
};
const std::vector<HeroEntry>& heroes()
{
    static const std::vector<HeroEntry> h = {
        { "ring", [] (const Values& v) {
             const double f = val (v, "hz", 440), mix = val (v, "mix", 1), src0 = 1000;
             S s = hgrid() + hfreqAxis();
             s += himp (flog (src0), .7 * (1 - mix * .9), "hd") + ht (hx (flog (src0)), hy (.75) - 4, "input", "middle");
             const double diff = orD (std::abs (src0 - f), 20);
             s += himp (flog (src0 + f), .7 * mix) + himp (flog (diff), .7 * mix) + ht (hx (flog (src0 + f)), hy (.75) - 16, "sum", "middle") + ht (hx (flog (diff)), hy (.75) + 8, "difference", "end");
             return s + ht (HW - 12, 12, "carrier " + fmtHz (f) + (T (val (v, "sweep", 0)) ? " · sweeping" : ""), "end");
         } },
        { "rappify", [] (const Values& v) {
             const double c = val (v, "hz", 1200), a = val (v, "amount", .5), sp = val (v, "speed", 2);
             S s = hgrid() + hfreqAxis();
             for (int k = -2; k <= 2; k++)
             {
                 const double x = flog (c) + k * .06 * a;
                 s += replaceFirst (hcurve ([=] (double t) { return .1 + .75 * std::exp (-std::pow ((t - x) * 14, 2)); }, false), "class=\"hc\"", S ("class=\"") + (k ? "hd" : "hc") + "\"");
             }
             return s + ht (12, 12, "band at " + fmtHz (c) + ", wobbling " + fx (sp, 1) + "× a second");
         } },
        { "boomerang", [] (const Values& v) {
             const double th = val (v, "throwMs", 300) / 2000, mix = val (v, "mix", .5);
             return hgrid() + hsig ([=] (double t) { return src (t) * (1 - mix * .5); }, 300, "hd") + hsig ([=] (double t) { return t > th ? src (1 - (t - th)) * mix : 0; })
                  + "<line x1=\"" + js (hx (0)) + "\" x2=\"" + js (hx (th)) + "\" y1=\"14\" y2=\"14\" class=\"hc\"/>" + ht (hx (th) + 4, 17, "thrown back " + fx (th * 2000, 0) + " ms, reversed");
         } },
        { "maximizer", [] (const Values& v) {
             const double amt = val (v, "amount", .5), ceil = std::pow (10, val (v, "ceilingDb", -1) / 20), g = 1 + amt * 3;
             S s = hsig ([] (double t) { return src (t); }, 300, "hd") + hsig ([=] (double t) { return std::tanh (src (t) * g / ceil) * ceil; });
             return s + "<line x1=\"10\" x2=\"" + js (HW - 10) + "\" y1=\"" + js (HH / 2 - 38 * ceil) + "\" y2=\"" + js (HH / 2 - 38 * ceil) + "\" class=\"hr\"/>"
                  + ht (HW - 12, HH / 2 - 38 * ceil - 3, "ceiling " + fx (val (v, "ceilingDb", -1), 1) + " dB", "end") + ht (12, 12, "+" + fx (20 * jlog10Impl (g), 1) + " dB pushed in");
         } },
        { "chamberlin", [] (const Values& v) {
             std::vector<FBand> b;
             for (const S t : { "low", "band", "high", "notch" })
                 b.push_back ({ t, t, bit (val (v, t + "On", 0)), val (v, t + "Freq", 1000), val (v, t + "Q", 1), val (v, t + "Amp", 1) });
             return heroFilterSet (b);
         } },
        { "dattorro_filter_bank", [] (const Values& v) {
             std::vector<FBand> b;
             const std::pair<S, S> ks[4] = { { "notch", "notch" }, { "resonator", "band" }, { "regalia", "band" }, { "damping", "low" } };
             for (const auto& [k, t] : ks)
                 b.push_back ({ k, t, bit (val (v, k + "On", 0)), val (v, k + "Hz", 1000), val (v, k + "Q", 1), val (v, k + "Amp", 1) });
             return heroFilterSet (b);
         } },
        { "white_chorus", [] (const Values& v) { return heroModDelay (v, "chorus"); } },
        { "dattorro_flanger", [] (const Values& v) { return heroModDelay (v, "flanger"); } },
        { "dattorro_vibrato", [] (const Values& v) { return heroModDelay (v, "vibrato"); } },
        { "pn_noise", [] (const Values& v) { return heroNoise (v, "pn_noise"); } },
        { "pn_noise_eq", [] (const Values& v) { return heroNoise (v, "pn_noise_eq"); } },
        { "single_bit_pn", [] (const Values& v) { return heroNoise (v, "single_bit_pn"); } },
        { "dattorro_plate", [] (const Values& v) { auto w = v; w["size"] = .6; return heroReverb (w, "plate"); } },
        { "schroeder_reverb", [] (const Values& v) { return heroReverb (v, "schroeder"); } },
        { "moorer_reverb", [] (const Values& v) { return heroReverb (v, "moorer"); } },
        { "allpass_diffuser", [] (const Values& v) {
             const double d = val (v, "delayMs", 10) / 100, c = val (v, "coefficient", .5);
             S s = hgrid() + himp (.03, .9, "hd");
             for (int i = 1; i < 30; i++)
             {
                 const double x = .03 + i * d * .5;
                 if (x > .98) break;
                 s += himp (x, .85 * std::pow (std::abs (c), i * .6) * (i % 2 ? 1 : .7));
             }
             return s + ht (HW - 12, 12, "one click, smeared · coefficient " + fx (c, 2), "end");
         } },
        { "leslie", [] (const Values& v) {
             const double r = val (v, "rateHz", 6), w = val (v, "width", 1);
             const double cx = HW / 2, cy = HH / 2;
             S s = "<circle cx=\"" + js (cx) + "\" cy=\"" + js (cy) + "\" r=\"40\" class=\"hd\" fill=\"none\"/>";
             for (int i = 0; i < 2; i++)
             {
                 const double a = i * PI + r * .4;
                 s += "<line x1=\"" + js (cx) + "\" y1=\"" + js (cy) + "\" x2=\"" + N (cx + 38 * std::cos (a)) + "\" y2=\"" + N (cy + 38 * std::sin (a)) + "\" class=\"hc\"/><circle cx=\""
                    + N (cx + 38 * std::cos (a)) + "\" cy=\"" + N (cy + 38 * std::sin (a)) + "\" r=\"6\" class=\"hdot\"/>";
             }
             s += "<circle cx=\"" + js (cx - 110 * w) + "\" cy=\"" + js (cy) + "\" r=\"5\" class=\"hdot\"/><circle cx=\"" + js (cx + 110 * w) + "\" cy=\"" + js (cy) + "\" r=\"5\" class=\"hdot\"/>"
                + ht (cx - 110 * w, cy + 20, "L mic", "middle") + ht (cx + 110 * w, cy + 20, "R mic", "middle");
             return s + ht (12, 12, "horn spinning " + fx (r, 1) + " times a second") + ht (HW - 12, 12, "doppler " + fx (val (v, "depthMs", 0), 2) + " ms", "end");
         } },
        { "harmonizer", [] (const Values& v) {
             const double st = val (v, "semitones", 7), wet = val (v, "wet", .5);
             return hgrid() + hsig ([] (double t) { return std::sin (t * 2 * PI * 6) * .8; }, 300, "hd")
                  + hsig ([=] (double t) { return std::sin (t * 2 * PI * 6 * std::pow (2, st / 12)) * .8 * wet * 1.6; })
                  + ht (12, 12, S (st >= 0 ? "+" : "") + fx (st, 1) + " semitones · window " + fx (val (v, "windowMs", 50), 0) + " ms");
         } },
        { "detune", [] (const Values& v) {
             const double ct = val (v, "cents", 10);
             return hgrid() + hsig ([=] (double t) { return (std::sin (t * 2 * PI * 12) + std::sin (t * 2 * PI * 12 * std::pow (2, ct / 1200 * 30))) * .45; })
                  + hsig ([=] (double t) { return std::cos (t * PI * ct / 1200 * 30 * 12) * .9; }, 200, "hd") + ht (12, 12, "two copies " + fx (ct, 0) + " cents apart, beating");
         } },
        { "doubler", [] (const Values& v) {
             const double d = val (v, "delayMs", 20) / 100, va = val (v, "variationMs", 5) / 100, wet = val (v, "wet", .5);
             return hgrid() + hsig (src, 300, "hd") + hsig ([=] (double t) { return src (t - d - va * std::sin (t * 8)) * wet * 1.6; })
                  + "<rect x=\"" + js (hx (d - va)) + "\" y=\"8\" width=\"" + N (hx (d + va) - hx (d - va)) + "\" height=\"10\" class=\"hband\"/>"
                  + ht (hx (d + va) + 4, 16, "second take " + fx (d * 100, 0) + " ± " + fx (va * 100, 0) + " ms late");
         } },
        { "doppler", [] (const Values& v) {
             const double dist = val (v, "distanceMs", 20) / 100, vel = val (v, "velocityMps", 20);
             S s = "<line x1=\"10\" x2=\"" + js (HW - 10) + "\" y1=\"30\" y2=\"30\" class=\"hd\"/>" + "<circle cx=\"" + js (HW / 2) + "\" cy=\"" + N (30 + 60 * cl (dist)) + "\" r=\"6\" class=\"hdot\"/>"
                 + ht (HW / 2 + 10, std::strtod (N (34 + 60 * cl (dist)).c_str(), nullptr), "you");
             s += hcurve ([=] (double t) { return .55 + .35 * std::atan ((.5 - t) * vel / 10 / jmax (.05, dist)) / (PI / 2); }, false);
             return s + ht (12, 12, "passing at " + fx (vel, 0) + " m/s — pitch falls as it goes by");
         } },
        { "utility", heroUtility },
        { "phaser", [] (const Values& v) {
             const double n = jround (val (v, "notches", 4)), c = val (v, "centreHz", 1000), sp = val (v, "spread", 1), dep = val (v, "depth", 1), wid = val (v, "resonance", .5),
                          sweep = val (v, "sweep", 1);
             S s = hgrid() + hfreqAxis();
             s += "<rect x=\"" + js (hx (flog (c) - sweep * .05)) + "\" y=\"" + js (hy (1)) + "\" width=\"" + N (hx (flog (c) + sweep * .05) - hx (flog (c) - sweep * .05)) + "\" height=\""
                + N (hy (0) - hy (1)) + "\" class=\"hband\"/>";
             s += hcurve ([=] (double t) {
                 double g = .8;
                 for (int i = 0; i < n; i++)
                 {
                     const double x = flog (c) + (i - (n - 1) / 2) * .08 * sp;
                     g -= dep * .75 * std::exp (-std::pow ((t - x) / (.008 + .03 * wid), 2));
                 }
                 return g;
             });
             return s + ht (12, 12, js (n) + " notches around " + fmtHz (c) + ", sweeping " + fx (sweep, 1) + " oct at " + fx (val (v, "rateHz", .5), 2) + " Hz");
         } },
        { "prism:echo", [] (const Values& v) {
             const double d = val (v, "delayMs", 300) / 2000, fb = val (v, "feedback", .4), wet = val (v, "wet", .5);
             S s = hgrid() + himp (.02, .9, "hd");
             for (int k = 1; k < 12; k++)
             {
                 const double x = .02 + k * d;
                 if (x > .99) break;
                 s += himp (x, .85 * std::pow (std::abs (fb), k - 1) * wet * 1.4);
             }
             return s + ht (12, 12, "echo every " + fx (d * 2000, 0) + " ms, each " + fx (std::abs (fb) * 100, 0) + "% of the last");
         } },
        { "width", [] (const Values& v) { return heroUtility ({ { "width", val (v, "width", 1) }, { "gainDb", 0 } }); } },
        { "gain", [] (const Values& v) {
             const double g = val (v, "db", 0), k = std::pow (10, g / 20);
             return hsig ([] (double t) { return src (t); }, 300, "hd") + hsig ([=] (double t) { return cl (src (t) * k, -1.2, 1.2); }) + ht (12, 12, S (g >= 0 ? "+" : "") + fx (g, 1) + " dB");
         } },
        { "dc", [] (const Values& v) {
             const double x = flog (val (v, "hz", 5));
             return single ([=] (double t) { return t < x ? .75 * std::exp (-(x - t) * 18) : .75; }) + "<line x1=\"" + js (hx (x)) + "\" x2=\"" + js (hx (x)) + "\" y1=\"" + js (hy (0)) + "\" y2=\""
                  + js (hy (1)) + "\" class=\"hd\"/>" + ht (hx (x) + 4, 14, "below " + fmtHz (val (v, "hz", 5)) + " removed");
         } },
        { "invert", [] (const Values&) { return hsig ([] (double t) { return src (t); }, 300, "hd") + hsig ([] (double t) { return -src (t); }) + ht (12, 12, "polarity flipped"); } },
        { "swap", [] (const Values&) { return heroUtility ({ { "swap", 1 }, { "width", 1 } }); } },
        { "fit", [] (const Values& v) {
             const double a = val (v, "amount", .7);
             return hsig ([] (double t) { return src (t) * (.3 + .7 * std::abs (std::sin (t * 5))); }, 300, "hd") + hsig ([=] (double t) { return src (t) * lerp (.3 + .7 * std::abs (std::sin (t * 5)), .8, a); })
                  + ht (12, 12, "loudness evened " + fx (a * 100, 0) + "% over " + fx (val (v, "grainMs", 30), 0) + " ms grains");
         } },
        { "gate", [] (const Values&) { return S(); } },
        { "notch", [] (const Values& v) {
             const double x = flog (val (v, "frequency", 1000)), bw = val (v, "bandwidth", 200) / val (v, "frequency", 1000), mix = val (v, "mix", 1);
             return single ([=] (double t) { return .75 - .7 * mix * std::exp (-std::pow ((t - x) / (.01 + bw * .08), 2)); });
         } },
        { "resonator", [] (const Values& v) {
             const double x = flog (val (v, "frequency", 1000)), bw = val (v, "bandwidth", 200) / val (v, "frequency", 1000), mix = val (v, "mix", 1);
             return single ([=] (double t) { return .12 + .78 * mix * std::exp (-std::pow ((t - x) / (.01 + bw * .08), 2)); });
         } },
        { "regalia", [] (const Values& v) {
             const double x = flog (val (v, "frequency", 1000)), bw = val (v, "bandwidth", 200) / val (v, "frequency", 1000), g = val (v, "gainDb", 6) / 24, mix = val (v, "mix", 1);
             return single ([=] (double t) { return .5 + .45 * g * mix * std::exp (-std::pow ((t - x) / (.01 + bw * .08), 2)); }) + "<line x1=\"10\" x2=\"" + js (HW - 10) + "\" y1=\""
                  + js (hy (.5)) + "\" y2=\"" + js (hy (.5)) + "\" class=\"hd\"/>";
         } },
        { "damping", [] (const Values& v) {
             const double x = flog (val (v, "cutoffHz", 6000));
             return single ([=] (double t) { return t < x ? .75 : .75 * std::exp (-(t - x) * 6); }) + "<line x1=\"" + js (hx (x)) + "\" x2=\"" + js (hx (x)) + "\" y1=\"" + js (hy (0))
                  + "\" y2=\"" + js (hy (1)) + "\" class=\"hd\"/>";
         } },
    };
    return h;
}
const std::unordered_map<S, size_t>& heroIndex()
{
    static const auto m = [] {
        std::unordered_map<S, size_t> r;
        for (size_t i = 0; i < heroes().size(); ++i) r[heroes()[i].name] = i;
        return r;
    }();
    return m;
}

// ── var ────────────────────────────────────────────────────────────────────

S str (const juce::var& v) { return v.isVoid() || v.isUndefined() ? S() : v.toString().toStdString(); }
bool isNum (const juce::var& v) { return v.isInt() || v.isInt64() || v.isDouble() || v.isBool(); }
std::optional<double> num (const juce::var& v)
{
    if (isNum (v)) return (double) v;
    return std::nullopt;
}
juce::var prop (const juce::var& o, const S& k) { return o.getProperty (juce::Identifier (juce::String (k)), juce::var()); }
} // namespace

// ── the controls and values ────────────────────────────────────────────────

Spec Spec::fromVar (const juce::var& p)
{
    Spec s;
    s.key = str (prop (p, "key"));
    s.label = str (prop (p, "label"));
    s.unit = str (prop (p, "unit"));
    s.role = str (prop (p, "role"));
    s.min = num (prop (p, "min")).value_or (NaN);
    s.max = num (prop (p, "max")).value_or (NaN);
    s.step = num (prop (p, "step"));
    s.def = num (prop (p, "default"));
    s.log = (bool) prop (p, "log");
    s.toggle = (bool) prop (p, "toggle");
    if (auto* a = prop (p, "choices").getArray())
    {
        s.hasChoices = true;
        for (const auto& c : *a) s.choices.push_back (str (c));
    }
    return s;
}

double val (const Values& v, const std::string& key, double d)
{
    const auto it = v.find (key);
    return it == v.end() ? d : it->second;
}

const Spec* Model::byKey (const std::string& key) const
{
    for (const auto& p : specs)
        if (p.key == key) return &p;
    return nullptr;
}
double Model::get (const std::string& key) const { return val (values, key, NaN); }

Model fxModel (const juce::var& slot, const juce::var& shaper)
{
    Model m;
    m.kind = str (prop (slot, "kind"));
    auto specsOf = [] (const juce::var& sh) {
        std::vector<Spec> r;
        if (auto* a = prop (sh, "params").getArray())
            for (const auto& p : *a) r.push_back (Spec::fromVar (p));
        return r;
    };
    if (m.kind == "comp")
    {
        if (prop (shaper, "params").isArray()) m.specs = specsOf (shaper);
        else
        {
            auto mk = [] (const char* k, const char* l, double mn, double mx, double d, const char* u, bool lg) {
                Spec s;
                s.key = k, s.label = l, s.min = mn, s.max = mx, s.def = d, s.unit = u, s.log = lg;
                return s;
            };
            m.specs = { mk ("thresholdDb", "Threshold", -60, 0, -18, "dB", false), mk ("ratio", "Ratio", 1, 20, 4, ":1", false), mk ("attackMs", "Attack", .05, 500, 10, "ms", true),
                        mk ("releaseMs", "Release", 5, 3000, 120, "ms", true),   mk ("kneeDb", "Knee", 0, 24, 6, "dB", false),   mk ("makeupDb", "Makeup", -24, 24, 0, "dB", false) };
        }
        for (const auto& p : m.specs)
            if (auto x = num (prop (slot, p.key))) m.values[p.key] = *x;
    }
    else if (m.kind == "gain")
    {
        Spec s;
        s.key = "db", s.label = "Level", s.min = -24, s.max = 24, s.def = 0, s.unit = "dB";
        m.specs = { s };
        if (auto x = num (prop (slot, "db"))) m.values["db"] = *x;
    }
    else
    {
        m.specs = specsOf (shaper);
        const auto params = prop (slot, "params");
        for (const auto& p : m.specs)
        {
            const auto pv = prop (params, p.key);
            if (pv.isUndefined() || pv.isVoid())
            {
                // `slot.params[p.key] = p.default`; a null stays null.
                if (p.def && ! (params.isObject() && params.getDynamicObject()->hasProperty (juce::Identifier (juce::String (p.key))))) m.values[p.key] = *p.def;
            }
            else if (auto x = num (pv))
                m.values[p.key] = *x;
        }
    }
    return m;
}

juce::var findShaper (const juce::var& api, const std::string& kind)
{
    const juce::var list = api.isArray() ? api : prop (api, "shapers");
    if (auto* a = list.getArray())
    {
        for (const auto& s : *a)
            if (str (prop (s, "kind")) == kind) return s;
        return {};
    }
    if (api.isObject() && ! kind.empty()) return prop (api, kind);
    return {};
}

// ── FXP ────────────────────────────────────────────────────────────────────

std::string N (double v) { return js (jround (v * 100) / 100); }
double jsLog (double x) { return jlogImpl (x); }
double jsLog10 (double x) { return jlog10Impl (x); }

std::string pic (const std::string& name, double n, double v, const Spec* p)
{
    const auto& ix = picIndex();
    const auto it = ix.find (name);
    return it == ix.end() ? S() : pics()[it->second].fn (n, v, p);
}

const std::vector<std::string>& picNames()
{
    static const auto v = [] {
        std::vector<S> r;
        for (const auto& e : pics()) r.push_back (e.name);
        return r;
    }();
    return v;
}

std::string picFor (const Spec& p)
{
    using Rule = std::pair<std::regex, const char*>;
    static const std::vector<Rule> LBL = {
        { re ("two heads"), "twoHeads" }, { re ("feedback ?(?:\xe2\x88\x92|-)"), "fbInvert" }, { re ("^lfo ?(speed|freq|rate)"), "rate" }, { re ("^lfo ?depth"), "depth" },
        { re ("^lfo ?shape"), "lfoShape" }, { re ("^lfo ?phase"), "phase" }, { re ("^pitch$"), "pitch" }, { re ("flip length"), "flip" }, { re ("overlap"), "xfade" },
        { re ("g(rain)? ?reversal"), "flip" }, { re ("start vari|oct vari|time vari"), "scatter" }, { re ("^density$"), "diffusion" }, { re ("^response$|^window$"), "grain" },
        { re ("^bands$"), "count" }, { re ("^shape$"), "shape" }, { re ("^spread$"), "spread" }, { re ("^depth$"), "bits" }, { re ("^averaging$"), "smooth" },
    };
    static const std::vector<Rule> RULES = {
        { re ("smooth|speed ch"), "smooth" }, { re ("bright"), "lowpass" }, { re ("\\batt\\."), "taplevel" }, { re ("\\b[xy] \\((right|ahead)"), "xy" }, { re ("x-?fade"), "xfade" },
        { re ("grain size"), "grain" }, { re ("compression"), "ratio" }, { re ("balance"), "pan" }, { re ("freeze"), "freeze" }, { re ("^swap$"), "swap" }, { re ("link"), "link" },
        { re ("tap ?slope"), "tapSlope" }, { re ("^shape$"), "shape" }, { re ("bass ?rt"), "bassRt" }, { re ("xov|cross"), "xover" }, { re ("spin"), "spin" }, { re ("wander"), "wander" },
        { re ("pre ?delay|predelay"), "predelay" }, { re ("diffus"), "diffusion" }, { re ("hi ?cut|roll ?off|damp|hfdamp|low ?pass|lp(f)?\\b|tone"), "lowpass" },
        { re ("lo ?cut|high ?pass|hp(f)?\\b"), "highpass" }, { re ("reverb ?time|decay|\\brt\\b|rt60|tail"), "tail" }, { re ("size|room"), "size" },
        { re ("f(ee)?d?b(ac)?k|regen|recirc|\\bfb\\b|eko ?fb"), "feedback" }, { re ("taps?$|voices|stages|order|count|poles|layers"), "count" },
        { re ("\\bmix\\b|wet|dry|blend|balance|dry\\/wet"), "mix" }, { re ("threshold|thresh"), "threshold" }, { re ("ratio"), "ratio" }, { re ("attack"), "attack" },
        { re ("release|recovery"), "release" }, { re ("knee"), "knee" }, { re ("gate|floor"), "gate" }, { re ("\\bcp ?\\d|cheb"), "harmonic" },
        { re ("bits?\\b|bit ?depth|^depth$"), "bits" }, { re ("sample ?rate|downsamp|decim|srate|averag"), "srate" }, { re ("drive|satur|distort|fold"), "drive" },
        { re ("pitch|shift|semi|transpose|detune|cents|harmon"), "pitch" }, { re ("polarity|invert|flip"), "polarity" }, { re ("\\bpan\\b|position|azim|angle"), "pan" },
        { re ("width|stereo|spread|separ"), "width" }, { re ("rate|speed|lfo|freq ?mod|tempo|bpm"), "rate" }, { re ("depth|amount|intens|mod\\b|sweep|swing|excurs"), "depth" },
        { re ("delay|dly|time|length|ms\\b"), "delay" }, { re ("freq|cutoff|centre|center|\\bhz\\b|band|f0|fc"), "freq" }, { re ("\\bq\\b|reso|bandwidth|\\bbw\\b|slope|width"), "q" },
        { re ("gain|level|\\bdb\\b|makeup|output|input|trim|volume|amp"), "level" }, { re ("seed|random|chaos|jitter|noise"), "scatter" },
    };
    static const auto decimBit = re ("decim|bit");
    static const auto interval = re ("^(root|m2|m3|m6|m7|4th|5th|octave|just)$");
    for (const auto& [r, k] : LBL)
        if (test (r, p.label))
        {
            if (S (k) == "bits" && ! test (decimBit, p.key + p.unit) && p.max != 32 && p.max != 24) break;
            return k;
        }
    if (test (interval, p.label)) return "interval";
    const S s = p.key + " " + p.label, u = p.unit;
    for (const auto& [r, k] : RULES)
        if (test (r, s))
        {
            if (S (k) == "rate" && u == "Hz" && p.max > 200) return "freq";
            if (S (k) == "delay" && u == "s") return "tail";
            return k;
        }
    if (u == "ms") return "delay";
    if (u == "dB") return "level";
    if (u == "Hz") return p.max > 200 ? "freq" : "rate";
    if (u == "%") return "depth";
    if (u == "st" || u == "ct") return "pitch";
    if (u == "m") return "size";
    if (u == "s") return "tail";
    if (u == "bits") return "bits";
    if (u == "\xc2\xb0") return "pan";
    return "generic";
}

std::string svg (const std::string& inner, const std::string& cls) { return "<svg class=\"" + cls + "\" viewBox=\"0 0 64 48\" aria-hidden=\"true\">" + inner + "</svg>"; }

std::string noText (const std::string& s)
{
    // s.replace(/<text[\s\S]*?<\/text>/g, '')
    S out;
    size_t i = 0;
    for (;;)
    {
        const auto a = s.find ("<text", i);
        if (a == S::npos) break;
        const auto b = s.find ("</text>", a + 5);
        if (b == S::npos) break;
        out += s.substr (i, a - i);
        i = b + 7;
    }
    return out + s.substr (i);
}

std::string hero (const std::string& key, const Values& v)
{
    const auto it = heroIndex().find (key);
    return it == heroIndex().end() ? S() : heroes()[it->second].fn (v);
}
bool hasHero (const std::string& key) { return heroIndex().count (key) > 0; }
const std::vector<std::string>& heroKeys()
{
    static const auto v = [] {
        std::vector<S> r;
        for (const auto& e : heroes()) r.push_back (e.name);
        return r;
    }();
    return v;
}
std::string heroFor (const std::string& kind)
{
    static const std::map<S, S> alias = { { "flanger", "dattorro_flanger" }, { "vibrato", "dattorro_vibrato" }, { "echo", "prism:echo" }, { "dattorro_notch", "notch" },
                                          { "dattorro_resonator", "resonator" }, { "regalia_mitra", "regalia" }, { "damping_filter", "damping" }, { "all_pass_diffuser", "allpass_diffuser" } };
    S k = kind.rfind ("prism:", 0) == 0 ? kind.substr (6) : kind;
    for (auto& c : k)
        if (c == '-') c = '_';
    const auto it = alias.find (k);
    return it != alias.end() && ! it->second.empty() ? it->second : k;
}
std::string display (const std::string& inner, bool fill)
{
    return "<svg class=\"fx-disp\" viewBox=\"0 0 " + js (HW) + " " + js (HH) + "\" " + (fill ? "preserveAspectRatio=\"none\" " : "") + "aria-hidden=\"true\">" + inner + "</svg>";
}
std::string padMark (double u, double w, const std::string& xl, const std::string&)
{
    const double X = 10 + u * (HW - 20), Y = HH - 6 - w * (HH - 12);
    return "<line x1=\"" + N (X) + "\" x2=\"" + N (X) + "\" y1=\"0\" y2=\"" + js (HH) + "\" class=\"fx-pad-l\"/><line y1=\"" + N (Y) + "\" y2=\"" + N (Y) + "\" x1=\"0\" x2=\"" + js (HW)
         + "\" class=\"fx-pad-l\"/><circle cx=\"" + N (X) + "\" cy=\"" + N (Y) + "\" r=\"5\" class=\"fx-pad-dot\"/>" + "<text x=\"" + js (HW - 6) + "\" y=\"" + js (HH - 3)
         + "\" class=\"ht fx-pad-ax\" text-anchor=\"end\">" + xl + " →</text>";
}
double rbjDb (int type, double f0, double q, double g, double f, double fs)
{
    const double w0 = 2 * PI * jmin (f0, fs * .49) / fs, cw = std::cos (w0), sw = std::sin (w0), A = std::pow (10, g / 40), al = sw / (2 * jmax (.05, q));
    double b0, b1, b2, a0, a1, a2;
    if (type == 0) { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else if (type == 5) { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else if (type == 2) { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
    else if (type == 3) { b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else
    {
        const double s2 = 2 * std::sqrt (A) * al, lo = type == 1 ? 1 : -1;
        b0 = A * ((A + 1) - lo * (A - 1) * cw + s2); b1 = 2 * lo * A * ((A - 1) - lo * (A + 1) * cw); b2 = A * ((A + 1) - lo * (A - 1) * cw - s2);
        a0 = (A + 1) + lo * (A - 1) * cw + s2; a1 = -2 * lo * ((A - 1) + lo * (A + 1) * cw); a2 = (A + 1) + lo * (A - 1) * cw - s2;
    }
    const double w = 2 * PI * jmin (f, fs * .49) / fs, c1 = std::cos (w), s1 = std::sin (w), c2 = std::cos (2 * w), s2 = std::sin (2 * w);
    const double nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2), dr = a0 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
    return 10 * jlog10Impl ((nr * nr + ni * ni) / (dr * dr + di * di) + 1e-12);
}

// ── 075's helpers ──────────────────────────────────────────────────────────

bool fxIsSwitch (const Spec& p)
{
    static const std::set<S> keys = { "invert", "swap", "freeze", "ampFit", "autoLevel", "autoComp", "allpass" };
    static const auto onRe = reCase ("On$|enabled$");
    return p.toggle || (p.min == 0 && p.max == 1 && p.step && *p.step == 1) || test (onRe, p.key) || keys.count (p.key) > 0;
}
bool fxIsLog (const Spec& p)
{
    return p.log || (p.unit == "Hz" && p.max / jmax (p.min, 1e-9) > 50) || (p.unit == "ms" && p.min > 0 && p.max / p.min > 50);
}
Range fxRange (const juce::var& ranges, const std::string& slotId, const Spec& p)
{
    const auto r = slotId.empty() ? juce::var() : prop (prop (ranges, slotId), p.key);
    if (r.isObject()) return { num (prop (r, "min")).value_or (NaN), num (prop (r, "max")).value_or (NaN), (bool) prop (r, "log") };
    return { p.min, p.max, fxIsLog (p) };
}
double fxUnit (const Range& r, double v)
{
    return jmax (0, jmin (1, r.log && r.min > 0 ? jlogImpl (v / r.min) / jlogImpl (r.max / r.min) : (v - r.min) / orD (r.max - r.min, 1)));
}
double fxFromUnit (const Range& r, double u) { return r.log && r.min > 0 ? r.min * std::pow (r.max / r.min, u) : r.min + (r.max - r.min) * u; }
double fxClamp (const Spec& p, double v)
{
    const double c = jmax (p.min, jmin (p.max, v));
    return p.step && *p.step == 1 ? jround (c) : c;
}
std::string fxFormat (const Spec& p, double v)
{
    if (p.hasChoices)
    {
        const double i = jround (v - p.min);
        if (i >= 0 && i < (double) p.choices.size() && i == std::floor (i)) return p.choices[(size_t) i];
        return rs (v);
    }
    if (p.unit == ":1") return fx (v, 1) + ":1";
    if (p.step && *p.step == 1 && p.unit.empty()) return rs (v);
    return fxValueFormat (p, v);
}
std::string fxShort (const std::string& label, const std::string& group)
{
    static const std::map<S, S> SHORT = { { "amplitude", "Level" },         { "air absorption", "Air" },       { "stereo spread", "Spread" },        { "stereo phase", "Phase" },
                                          { "all-pass interp", "Interp" }, { "speed of sound", "Sound speed" }, { "auto compression", "Auto comp" }, { "stereo width", "Width" } };
    S l = label;
    S g = lower (group);
    if (! g.empty() && g.back() == 's') g.pop_back();
    const auto cut = g.find_first_of (" \t\n\r\f\v-");
    if (cut != S::npos) g = g.substr (0, cut);
    if (! g.empty() && lower (l).rfind (g + " ", 0) == 0) l = l.substr (g.size() + 1);
    if (auto it = SHORT.find (lower (l)); it != SHORT.end()) l = it->second;
    if (! l.empty() && l[0] >= 'a' && l[0] <= 'z') l[0] = (char) (l[0] - 'a' + 'A');
    return l;
}
std::string fxTwin (const std::string& kind)
{
    static const std::map<S, S> m = { { "eq", "prism:eq" },
                                      { "comp", "prism:compressor" },
                                      { "gain", "prism:gain" },
                                      { "dattorro_flanger", "prism:flanger" },
                                      { "dattorro_vibrato", "prism:vibrato" },
                                      { "regalia_mitra", "prism:regalia" } };
    if (auto it = m.find (kind); it != m.end()) return it->second;
    S k = kind;
    for (auto& c : k)
        if (c == '_') c = '-';
    return "prism:" + k;
}
std::string fxFamilyColour (const std::string& kind, const juce::var& api)
{
    if (kind == "eq") return "#ff8a3d";
    if (kind == "comp") return "#ffb547";
    static const auto plain = reCase ("^(prism:)?(gain|utility|width|dc|invert|swap|fit)$");
    static const auto noise = reCase ("pn[_-]noise|single[_-]bit");
    if (test (plain, kind)) return "#c9d3dd";
    if (test (noise, kind)) return "#7bd88f";
    S cat = str (prop (findShaper (api, kind), "category"));
    if (cat.empty()) cat = str (prop (findShaper (api, fxTwin (kind)), "category"));
    static const std::map<S, S> byCat = { { "dynamics", "#ffb547" }, { "filter", "#ff8a3d" }, { "delay", "#19b4ff" },  { "modulation", "#b07cff" },
                                          { "reverb", "#2fd4c2" },   { "pitch", "#ff5fa2" },  { "granular", "#ff5fa2" }, { "spectral", "#7bd88f" } };
    if (auto it = byCat.find (cat); it != byCat.end()) return it->second;
    static const auto rv = reCase ("reverb|plate|diffuser"), md = reCase ("chorus|flanger|vibrato|leslie|phaser|ring"), pt = reCase ("harmon|detune|doubler|doppler|boomerang"),
                      fl = reCase ("notch|resonator|regalia|chamberlin|filter|damping|rappify"), dy = reCase ("gate|maxim");
    return test (rv, kind) ? "#2fd4c2" : test (md, kind) ? "#b07cff" : test (pt, kind) ? "#ff5fa2" : test (fl, kind) ? "#ff8a3d" : test (dy, kind) ? "#ffb547" : "#19b4ff";
}
juce::var fxPanelOf (const juce::var& own, const juce::var& twin, const std::set<std::string>& keys)
{
    for (const auto& sh : { own, twin })
    {
        const auto panel = prop (sh, "panel");
        if (! panel.isObject()) continue;
        std::vector<S> named;
        if (auto* gs = prop (panel, "groups").getArray())
            for (const auto& g : *gs)
                if (auto* ks = prop (g, "keys").getArray())
                    for (const auto& k : *ks) named.push_back (str (k));
        bool every = true;
        for (const auto& k : named) every = every && keys.count (k) > 0;
        if (named.empty() || every) return panel;
    }
    return {};
}

std::string fxKnobPic (const Spec& p, double v, const Range& r) { return noText (pic (picFor (p), fxUnit (r, v), v, &p)); }
std::string fxSliderPic (const Spec& p, double v, const Range& r) { return svg (noText (pic (picFor (p), fxUnit (r, v), v, &p))); }
bool fxTileOn (const Spec& p, double v) { return v >= (p.min + p.max) / 2; }
std::string fxTileHtml (const Spec& p, double v)
{
    const bool on = fxTileOn (p, v);
    return svg (noText (pic (picFor (p), on ? 1 : 0, on ? 1 : 0, &p))) + "<i>" + (on ? "on" : "off") + "</i>";
}
std::string fxFaderTrack (double u)
{
    const double y = 58 - u * 52;
    return "<rect x=\"10\" y=\"4\" width=\"4\" height=\"56\" rx=\"2\" class=\"fxf-bg\"/><rect x=\"10\" y=\"" + fx (y, 1) + "\" width=\"4\" height=\"" + fx (60 - y, 1)
         + "\" rx=\"2\" class=\"fxf-fill\"/>" + "<rect x=\"3\" y=\"" + fx (y - 4, 1) + "\" width=\"18\" height=\"8\" rx=\"2\" class=\"fxf-cap\"/><line x1=\"5\" x2=\"19\" y1=\"" + fx (y, 1)
         + "\" y2=\"" + fx (y, 1) + "\" class=\"fxf-line\"/>";
}
std::string fxAdvancedPic (const Spec& p) { return svg (noText (pic (picFor (p), .6, p.min + (p.max - p.min) * .6, &p))); }
std::string fxDecoratePic (const Spec& p, double v) { return svg (noText (pic (picFor (p), automationUnit (v, p.min, p.max, fxIsLog (p)), v, &p))); }
Spec fxHpMixSpec()
{
    Spec s;
    s.key = "mix", s.label = "Dry / Wet", s.min = 0, s.max = 1;
    return s;
}
double fxHpMixValue (double wet, double dry) { return wet >= .999 ? 1 - dry / 2 : wet / 2; }

std::string fxValueFormat (const Spec& p, double v)
{
    if (p.unit == "Hz") return v >= 1000 ? fx (v / 1000, 2) + " kHz" : (v < 10 ? fx (v, 2) : rs (v)) + " Hz";
    if (p.unit == "ms") return v >= 1000 ? fx (v / 1000, 2) + " s" : rs (v) + " ms";
    if (p.unit == "dB") return fx (v, 1) + " dB";
    if (! p.unit.empty()) return fx (v, 2) + " " + p.unit;
    return p.min >= 0 && p.max <= 1.001 ? rs (v * 100) + "%" : fx (v, 2);
}
double automationUnit (double value, double min, double max, bool log)
{
    return jmax (0, jmin (1, log && min > 0 ? jlogImpl (value / min) / jlogImpl (max / min) : (value - min) / (max - min)));
}
double unitValue (double unit, double min, double max, bool log)
{
    const double u = jmax (0, jmin (1, unit));
    return log && min > 0 ? min * std::pow (max / min, u) : min + (max - min) * u;
}
std::string digits (const std::string& t)
{
    static const std::vector<std::pair<std::regex, S>> words = [] {
        const std::pair<const char*, const char*> w[] = { { "first", "1st" }, { "second", "2nd" },  { "third", "3rd" },     { "fourth", "4th" },   { "fifth", "5th" },
                                                          { "sixth", "6th" }, { "seventh", "7th" }, { "eighth", "8th" },    { "ninth", "9th" },    { "tenth", "10th" },
                                                          { "eleventh", "11th" }, { "twelfth", "12th" }, { "sixteenth", "16th" }, { "zero", "0" }, { "one", "1" },
                                                          { "two", "2" },     { "three", "3" },     { "four", "4" },        { "five", "5" },       { "six", "6" },
                                                          { "seven", "7" },   { "eight", "8" },     { "nine", "9" },        { "ten", "10" },       { "eleven", "11" },
                                                          { "twelve", "12" }, { "sixteen", "16" } };
        std::vector<std::pair<std::regex, S>> r;
        for (const auto& [a, b] : w) r.push_back ({ re ((S ("\\b") + a + "\\b").c_str()), b });
        return r;
    }();
    S out = t;
    for (const auto& [r, n] : words) out = std::regex_replace (out, r, n);
    return out;
}
std::string fitLabel (const std::string& text)
{
    static const auto paren = re ("\\s*\\([^)]*\\)"), dashTail = re ("\\s*(?:-|\xe2\x80\x93|\xe2\x80\x94).*$"), vowel = re ("\\B[aeiou]");
    S t = std::regex_replace (text, paren, "");
    t = std::regex_replace (t, dashTail, "", std::regex_constants::format_first_only);
    const auto ws = " \t\n\r\f\v";
    const auto a = t.find_first_not_of (ws);
    t = a == S::npos ? S() : t.substr (a, t.find_last_not_of (ws) - a + 1);
    t = digits (t);
    if (utf16Length (t) <= 11) return t;
    return std::regex_replace (t, vowel, "");
}

// ── 075b ───────────────────────────────────────────────────────────────────

std::vector<Group> fxRoleGroups (const std::vector<Spec>& specs)
{
    static const std::vector<S> ROLES = { "time", "space", "tone", "motion", "drive", "noise", "dynamics", "pitch", "stereo", "output", "engine" };
    bool any = false;
    for (const auto& p : specs) any = any || ! p.role.empty();
    if (! any)
    {
        Group g;
        for (const auto& p : specs) g.keys.push_back (p.key);
        return { g };
    }
    std::map<S, std::vector<S>> by;
    for (const auto& p : specs)
    {
        const S r = std::find (ROLES.begin(), ROLES.end(), p.role) != ROLES.end() ? p.role : "engine";
        by[r].push_back (p.key);
    }
    std::vector<Group> out;
    for (const auto& r : ROLES)
        if (by.count (r)) out.push_back ({ upper (r.substr (0, 1)) + r.substr (1), by[r] });
    return out;
}

std::string fxDeckDisplay (const Model& m, const juce::var& panel)
{
    const S heroKey = heroFor (m.kind);
    if (! hasHero (heroKey)) return {};
    S inner = hero (heroKey, m.values);
    const auto pad = prop (panel, "pad");
    if (pad.isObject())
    {
        const Spec* px = m.byKey (str (prop (pad, "x")));
        const Spec* py = m.byKey (str (prop (pad, "y")));
        if (px && py)
        {
            const auto n = [&] (const char* k) { return num (prop (pad, k)).value_or (NaN); };
            inner += padMark (automationUnit (m.get (px->key), n ("xMin"), n ("xMax"), fxIsLog (*px)), automationUnit (m.get (py->key), n ("yMin"), n ("yMax"), fxIsLog (*py)), px->label, py->label);
        }
    }
    return display (inner);
}

namespace
{
Meter meter (double unit, const S& text) { return { js (jmax (0, jmin (1, unit)) * 100) + "%", text }; }
const S minusInf = "\xe2\x88\x92\xe2\x88\x9e"; // −∞
const S minus = "\xe2\x88\x92";
} // namespace

DynPaint fxDynamicsPaint (const Model& m, std::optional<double> lvl, bool gate)
{
    auto key = [&] (const char* pattern) {
        const auto r = re (pattern);
        for (const auto& p : m.specs)
            if (test (r, p.key)) return p.key;
        return S();
    };
    const S kTh = key ("threshold"), kRatio = key ("ratio"), kKnee = key ("knee"), kMake = key ("makeup"), kDepth = key ("depth|range|floor");
    const double lo = -72;
    const auto get = [&] (const S& k) { return k.empty() ? NaN : m.get (k); };
    auto out = [&] (double i) {
        const double th = get (kTh);
        if (gate) return i >= th ? i : i - (! kDepth.empty() ? get (kDepth) : 1) * jmin (60, (th - i) * 3);
        const double r = get (kRatio), k = ! kKnee.empty() ? get (kKnee) : 0, d = i - th;
        const double o = 2 * d < -k ? i : 2 * std::abs (d) <= k ? i + (1 / r - 1) * std::pow (d + k / 2, 2) / (2 * jmax (k, .01)) : th + d / r;
        return o + (! kMake.empty() ? get (kMake) : 0);
    };
    const double W = 260, H = 112;
    auto x = [&] (double db) { return (db - lo) / -lo * W; };
    auto y = [&] (double db) { return H - (db - lo) / -lo * H; };
    const double level = lvl.value_or (lo);
    S s;
    for (const double g : { -60.0, -48.0, -36.0, -24.0, -12.0 })
        s += "<line x1=\"" + js (x (g)) + "\" x2=\"" + js (x (g)) + "\" y1=\"0\" y2=\"" + js (H) + "\" class=\"fx-grid\"/><line y1=\"" + js (y (g)) + "\" y2=\"" + js (y (g)) + "\" x1=\"0\" x2=\""
           + js (W) + "\" class=\"fx-grid\"/>";
    s += "<line x1=\"0\" y1=\"" + js (H) + "\" x2=\"" + js (W) + "\" y2=\"0\" class=\"fx-dim\"/>";
    S d;
    for (int i = 0; i <= 96; i++)
    {
        const double db = lo + -lo * i / 96;
        d += (i ? "L" : "M") + fx (x (db), 1) + " " + fx (jmax (0, jmin (H, y (out (db)))), 1);
    }
    s += "<path d=\"" + d + "L" + js (W) + " " + js (H) + "L0 " + js (H) + "Z\" class=\"fx-fill\"/><path d=\"" + d + "\" class=\"fx-line\"/>";
    s += "<line x1=\"" + js (x (get (kTh))) + "\" x2=\"" + js (x (get (kTh))) + "\" y1=\"0\" y2=\"" + js (H) + "\" class=\"fx-thr\"/>";
    if (level > lo) s += "<circle cx=\"" + js (x (level)) + "\" cy=\"" + js (jmax (0, jmin (H, y (out (level))))) + "\" r=\"4.5\" class=\"fx-dot\"/>";
    DynPaint r;
    r.curve = "<svg viewBox=\"0 0 " + js (W) + " " + js (H) + "\" preserveAspectRatio=\"none\" aria-label=\"Transfer curve: drag across for the threshold\">" + s + "</svg>";
    const double gr = level > lo ? jmax (0, level + (gate || kMake.empty() ? 0 : get (kMake)) - out (level)) : 0;
    r.in = meter ((level - lo) / -lo, level > lo ? fx (level, 0) : minusInf);
    r.gr = meter (gr / 24, gr > .05 ? minus + fx (gr, 1) : "0");
    r.out = meter ((out (level) - lo) / -lo, level > lo ? fx (out (level), 0) : minusInf);
    r.caretTop = js ((1 - (get (kTh) - lo) / -lo) * 100) + "%";
    return r;
}

MaxPaint fxMaximizerPaint (const Values& v, std::optional<double> lvl)
{
    const double lo = -48;
    const double drive = 20 * jlog10Impl (1 + val (v, "amount", 0) * 3), level = lvl.value_or (lo);
    const double ceil = val (v, "ceilingDb", NaN);
    MaxPaint r;
    r.curve = display (hero ("maximizer", v), true);
    const double outPk = jmin (ceil, level + drive), gr = jmax (0, level + drive - ceil);
    r.in = meter ((level - lo) / -lo, level > lo ? fx (level, 0) : minusInf);
    r.gr = meter (gr / 18, gr > .05 ? minus + fx (gr, 1) : "0");
    r.out = meter ((outPk - lo) / -lo, level > lo ? fx (outPk, 1) : minusInf);
    r.caretTop = js ((1 - (ceil - lo) / -lo) * 100) + "%";
    return r;
}

const char* const FX_EQ_TYPES[6] = { "highpass", "lowshelf", "bell", "notch", "highshelf", "lowpass" };
const char* const FX_EQ_SHORT[6] = { "HP", "LS", "Bell", "Notch", "HS", "LP" };
const char* const FX_EQ_ICON[6] = { "M2 12Q8 12 10 4L26 4", "M2 10L10 10Q14 4 18 4L26 4", "M2 10Q9 10 14 3Q19 10 26 10", "M2 4L10 4Q14 13 18 4L26 4", "M2 4L10 4Q14 10 18 10L26 10", "M2 4L18 4Q20 12 26 12" };
const char* const FX_EQ_COLOURS[8] = { "#ff5a6e", "#ffa047", "#f5d547", "#4fd67a", "#3fc4ff", "#5a8bff", "#b07cff", "#ff6fd1" };

namespace
{
int eqKind (const EqBand& b)
{
    for (int i = 0; i < 6; ++i)
        if (b.type == FX_EQ_TYPES[i]) return i;
    return -1;
}
bool passOrNotch (const EqBand& b) { return b.type == "highpass" || b.type == "lowpass" || b.type == "notch"; }
S orUndef (const char* const* table, int i) { return i >= 0 ? S (table[i]) : S ("undefined"); }
} // namespace

std::vector<EqBand> defaultEqBands()
{
    return { { "highpass", false, 30, .71, 0 }, { "lowshelf", true, 100, .7, 0 }, { "bell", true, 250, 1, 0 },     { "bell", false, 500, 1, 0 },
             { "bell", false, 2000, 1, 0 },     { "bell", false, 4000, 1, 0 },    { "highshelf", true, 10000, .7, 0 }, { "lowpass", false, 18000, .71, 0 } };
}
std::vector<EqBand> fxEqBands (const juce::var& slot, const juce::var& shaper)
{
    if (str (prop (slot, "kind")) == "eq")
    {
        auto* a = prop (slot, "bands").getArray();
        if (a == nullptr) return defaultEqBands();
        std::vector<EqBand> r;
        for (const auto& b : *a)
            r.push_back ({ str (prop (b, "type")), (bool) prop (b, "enabled"), num (prop (b, "freq")).value_or (NaN), num (prop (b, "q")).value_or (NaN), num (prop (b, "gainDb")).value_or (NaN) });
        return r;
    }
    // `slot.params`, every key of it, with the shaper's defaults filled in.
    auto m = fxModel (slot, shaper);
    if (auto* d = prop (slot, "params").getDynamicObject())
        for (const auto& kv : d->getProperties())
            if (auto x = num (kv.value)) m.values[kv.name.toString().toStdString()] = *x;
    std::vector<EqBand> r;
    for (int i = 0; i < 8; i++)
    {
        const S k = "band." + std::to_string (i) + ".";
        EqBand b;
        const double mode = jround (val (m.values, k + "mode", 2));
        b.type = mode >= 0 && mode < 6 ? FX_EQ_TYPES[(int) mode] : "";
        b.enabled = val (m.values, k + "enabled", 1) >= .5;
        b.freq = val (m.values, k + "freq", NaN);
        b.q = val (m.values, k + "q", .71);
        b.gainDb = val (m.values, k + "gainDb", 0);
        r.push_back (b);
    }
    return r;
}
std::string fxEqCurve (const std::vector<EqBand>& bands, int sel, double fs, const std::vector<double>& spectrum)
{
    const double W = 340, H = 150, fmin = 20, fmax = 20000, gmax = 18;
    auto xOf = [&] (double f) { return (W - 4) * jlogImpl (f / fmin) / jlogImpl (fmax / fmin) + 2; };
    auto yOf = [&] (double g) { return H / 2 - g / gmax * (H / 2 - 10); };
    std::vector<double> freqs;
    for (int i = 0; i < 161; i++) freqs.push_back (fmin * std::pow (fmax / fmin, (double) i / 160));
    auto total = [&] (double f) {
        double a = 0;
        for (const auto& b : bands) a = a + (b.enabled ? rbjDb (eqKind (b), b.freq, b.q, b.gainDb, f, fs) : 0);
        return a;
    };
    S s;
    for (const double g : { -12.0, -6.0, 0.0, 6.0, 12.0 }) s += "<line x1=\"0\" x2=\"" + js (W) + "\" y1=\"" + js (yOf (g)) + "\" y2=\"" + js (yOf (g)) + "\" class=\"fx-grid\"/>";
    for (const double f : { 100.0, 1000.0, 10000.0 })
        s += "<line y1=\"0\" y2=\"" + js (H) + "\" x1=\"" + js (xOf (f)) + "\" x2=\"" + js (xOf (f)) + "\" class=\"fx-grid\"/><text x=\"" + js (xOf (f) + 2) + "\" y=\"" + js (H - 3) + "\" class=\"fx-tx\">"
           + (f >= 1000 ? js (f / 1000) + "k" : js (f)) + "</text>";
    if (! spectrum.empty())
    {
        const double nyq = fs / 2;
        S d = "M0 " + js (H);
        const size_t n = spectrum.size();
        for (size_t i = 1; i < n; i++)
        {
            const double hz = (double) i / (double) (n - 1) * nyq;
            if (hz >= fmin && hz <= fmax) d += "L" + fx (xOf (hz), 1) + " " + fx (H - spectrum[i] / 255 * H * .9, 1);
        }
        s += "<path d=\"" + d + "L" + js (W) + " " + js (H) + "Z\" class=\"fx-spec\"/>";
    }
    for (size_t i = 0; i < bands.size(); ++i)
    {
        const auto& b = bands[i];
        if (! b.enabled) continue;
        S d;
        for (size_t k = 0; k < freqs.size(); ++k)
            d += (k ? "L" : "M") + fx (xOf (freqs[k]), 1) + " " + fx (jmax (1, jmin (H - 1, yOf (rbjDb (eqKind (b), b.freq, b.q, b.gainDb, freqs[k], fs)))), 1);
        const S col = i < 8 ? FX_EQ_COLOURS[i] : "undefined";
        const bool on = (int) i == sel;
        s += "<path d=\"" + d + "L" + js (W) + " " + js (yOf (0)) + "L0 " + js (yOf (0)) + "Z\" fill=\"" + col + "\" opacity=\"" + (on ? "0.26" : "0.1") + "\"/><path d=\"" + d
           + "\" fill=\"none\" stroke=\"" + col + "\" stroke-width=\"" + (on ? "1.5" : "1") + "\" opacity=\".85\"/>";
    }
    S d;
    for (size_t k = 0; k < freqs.size(); ++k) d += (k ? "L" : "M") + fx (xOf (freqs[k]), 1) + " " + fx (jmax (1, jmin (H - 1, yOf (total (freqs[k])))), 1);
    s += "<path d=\"" + d + "\" class=\"fx-sum\"/>";
    for (size_t i = 0; i < bands.size(); ++i)
    {
        const auto& b = bands[i];
        const double x = xOf (jmax (fmin, jmin (fmax, b.freq))), y = passOrNotch (b) ? yOf (0) : yOf (b.gainDb);
        const bool on = (int) i == sel;
        s += "<g data-b=\"" + std::to_string (i) + "\" class=\"fx-node" + (b.enabled ? "" : " off") + "\"><circle cx=\"" + fx (x, 1) + "\" cy=\"" + fx (y, 1) + "\" r=\"" + (on ? "7.5" : "6")
           + "\" fill=\"" + (i < 8 ? FX_EQ_COLOURS[i] : "undefined") + "\" stroke=\"" + (on ? "#fff" : "#04060a") + "\" stroke-width=\"1.4\"/><text x=\"" + fx (x, 1) + "\" y=\"" + fx (y + 3, 1) + "\">"
           + std::to_string (i + 1) + "</text></g>";
    }
    return "<svg viewBox=\"0 0 " + js (W) + " " + js (H) + "\" aria-label=\"EQ curve: drag a numbered node to move its band, scroll on it for Q\">" + s + "</svg>";
}
EqButton fxEqTypeButton (const EqBand& b, int i, int sel)
{
    EqButton r;
    r.cls = S (b.enabled ? "on" : "") + (i == sel ? " sel" : "");
    r.html = "<svg viewBox=\"0 0 28 14\"><path d=\"" + orUndef (FX_EQ_ICON, eqKind (b)) + "\"/></svg>" + std::to_string (i + 1);
    r.title = "Band " + std::to_string (i + 1) + ", " + orUndef (FX_EQ_SHORT, eqKind (b)) + ": click to select, double-click to switch on or off";
    return r;
}
std::string fxEqReadout (const EqBand& b)
{
    const S hz = b.freq >= 1000 ? fx (b.freq / 1000, b.freq >= 10000 ? 0 : 1) + "k" : rs (b.freq);
    return hz + "<br>" + (b.type == "highpass" || b.type == "lowpass" ? S ("12/oct") : b.type == "notch" ? S ("notch") : S (b.gainDb > 0 ? "+" : "") + fx (b.gainDb, 1));
}
std::vector<Spec> fxEqSelSpecs (const EqBand& b, int sel)
{
    std::vector<Spec> r;
    Spec f;
    f.key = "freq", f.label = "Frequency", f.min = 20, f.max = 20000, f.unit = "Hz", f.log = true;
    const auto born = defaultEqBands();
    f.def = sel >= 0 && sel < (int) born.size() ? born[(size_t) sel].freq : 1000;
    r.push_back (f);
    if (! (passOrNotch (b) && b.type != "notch"))
    {
        Spec g;
        g.key = "gainDb", g.label = "Gain", g.min = -24, g.max = 24, g.def = 0, g.unit = "dB";
        r.push_back (g);
    }
    Spec q;
    q.key = "q", q.label = b.type == "highpass" || b.type == "lowpass" ? "Resonance" : "Q", q.min = .05, q.max = 18, q.def = .71, q.log = true;
    r.push_back (q);
    return r;
}

// ── 076 ────────────────────────────────────────────────────────────────────

std::string fxShHue (const std::string& kind)
{
    static const std::map<S, S> HUE = { { "sh-chebyshev", "#2bb39a" }, { "sh-compand", "#d77fd0" },    { "sh-decimate", "#ef6a50" },       { "sh-matrix", "#c9a21f" },
                                        { "sh-phasor", "#5b8cff" },    { "sh-delay", "#6fae3f" },      { "sh-pitchdelay", "#ff8a2a" },     { "sh-flipper", "#2fb0d0" },
                                        { "sh-bubbler", "#9a72f0" },   { "spectral-dynamics", "#3ab585" }, { "convolution", "#d76b6b" } };
    const S k = kind.rfind ("prism:", 0) == 0 ? kind.substr (6) : kind;
    const auto it = HUE.find (k);
    return it == HUE.end() ? "#6fae3f" : it->second;
}
double fxShDialUnit (const Spec& p, double v) { return automationUnit (v, p.min, p.max, fxIsLog (p) && ! (p.step && *p.step == 1)); }
std::string fxShDialPic (const Spec& p, double v) { return noText (pic (picFor (p), fxShDialUnit (p, v), v, &p)); }
std::string fxShChoicePic (const Spec& p, double sv) { return svg (noText (pic (picFor (p), automationUnit (sv, p.min, p.max), sv, &p))); }
double fxLexUnit (const Spec& p, double v) { return fxShDialUnit (p, v); }
std::string fxLexRing (double u)
{
    const double a0 = PI * .75, a = a0 + u * PI * 1.5, r = 22;
    auto pt = [&] (double x) { return fx (32 + r * std::cos (x), 2) + " " + fx (32 + r * std::sin (x), 2); };
    auto arc = [&] (double f, double t, const S& cls) { return t - f < .001 ? S() : "<path d=\"M" + pt (f) + "A22 22 0 " + (t - f > PI ? "1" : "0") + " 1 " + pt (t) + "\" class=\"" + cls + "\"/>"; };
    return arc (a0, a0 + PI * 1.5, "lex-track") + arc (a0, a, "lex-arc") + "<circle cx=\"32\" cy=\"32\" r=\"15\" class=\"lex-cap\"/><line x1=\"32\" y1=\"32\" x2=\"" + fx (32 + 14 * std::cos (a), 2)
         + "\" y2=\"" + fx (32 + 14 * std::sin (a), 2) + "\" class=\"lex-needle\"/>";
}
std::string fxLexReading (const Spec& p, double v) { return upper (fxFormat (p, v)); }
std::string fxLexPic (const Spec& p, double v) { return svg (noText (pic (picFor (p), fxLexUnit (p, v), v, &p))); }
std::string fxLexImpulse (const Values& v)
{
    const double W = 400, H = 70;
    auto x = [&] (double t) { return 10 + t * (W - 20); };
    auto y = [&] (double a) { return H - 8 - a * (H - 16); };
    auto u = [&] (const char* k, double lo, double hi, bool log) { return automationUnit (val (v, k, lo), lo, hi, log); };
    const double rn = u ("reverbTimeS", .1, 20, true), pn = u ("predelayMs", 0, 500, false), zn = u ("sizeM", 2, 80, false), sl = val (v, "tapSlope", 0) / 10;
    const double k = jround (60 - 38 * zn), x0 = .02 + .28 * pn, len = .15 + .75 * rn;
    S s = "<path d=\"M" + js (x (x0)) + " " + js (y (0)) + "L" + js (x (x0)) + " " + js (y (.9)) + "L" + js (x (jmin (1, x0 + len))) + " " + js (y (0)) + "Z\" class=\"lex-trend\"/>";
    for (int i = 0; i < k; i++)
    {
        const double t = i / k, xx = x0 + t * len;
        if (xx > 1) break;
        const double r = std::sin (i * 127.1 + 5 * 311.7) * 43758.5453, rr = r - std::floor (r);
        const double h = jmax (0, jmin (1, (1 - t) * (1 + sl * (t - .5) * 1.4) * (.7 + .3 * rr))) * .9;
        s += "<line x1=\"" + fx (x (xx), 1) + "\" x2=\"" + fx (x (xx), 1) + "\" y1=\"" + js (y (0)) + "\" y2=\"" + fx (y (h), 1) + "\" class=\"lex-tap\"/>";
    }
    return s + "<line x1=\"" + js (x (0)) + "\" x2=\"" + js (x (0)) + "\" y1=\"" + js (y (0)) + "\" y2=\"" + js (y (.95)) + "\" class=\"lex-tap lex-direct\"/>";
}
std::string fxLexImpulsePicture (const Values& v, const Spec* rt)
{
    Spec s;
    s.unit = "s";
    return "<svg viewBox=\"0 0 400 70\" preserveAspectRatio=\"none\" aria-hidden=\"true\">" + fxLexImpulse (v) + "</svg>" + "<span class=\"lex-rt\">IMPULSE · "
         + fxFormat (rt ? *rt : s, val (v, "reverbTimeS", 0)) + "</span>";
}

// ── 073a ───────────────────────────────────────────────────────────────────

namespace
{
const double UI_A0 = PI * 0.75, UI_SWEEP = PI * 1.5;
double uiClamp (double v, double a = 0, double b = 1) { return jmax (a, jmin (b, v)); }
} // namespace

RingGeo uiRingGeo (double s)
{
    const double c = s / 2, r = c - 4;
    return { c, r, r + 3.5, s > 60 ? 3 : s >= 40 ? 2.4 : 2 };
}
std::string uiArc (double c, double r, double u0, double u1)
{
    if (u1 - u0 < 0.0005) return {};
    const double a = UI_A0 + UI_SWEEP * u0, b = UI_A0 + UI_SWEEP * u1;
    return "M" + N (c + r * std::cos (a)) + " " + N (c + r * std::sin (a)) + "A" + N (r) + " " + N (r) + " 0 " + (b - a > PI ? "1" : "0") + " 1 " + N (c + r * std::cos (b)) + " " + N (c + r * std::sin (b));
}
std::string uiKnobHtml (int size, std::optional<bool> faceOpt, const std::string& inner, const std::string& cls)
{
    const bool face = faceOpt.value_or (size >= 40);
    const auto g = uiRingGeo (size);
    const double inset = jround (size * 0.19);
    const S sz = std::to_string (size);
    return "<div class=\"ui-kn s" + sz + (face ? " face" : "") + (cls.empty() ? S() : " " + cls) + "\" style=\"width:" + sz + "px;height:" + sz + "px\">" + "<div class=\"ui-cap" + (face ? " face" : "")
         + "\" style=\"inset:" + js (inset) + "px\"></div>" + "<svg class=\"ui-ring\" viewBox=\"0 0 " + sz + " " + sz + "\" aria-hidden=\"true\">" + "<path class=\"ui-tr\" d=\"" + uiArc (g.c, g.r, 0, 1)
         + "\" stroke-width=\"" + js (g.w) + "\"/><path class=\"ui-ar\" stroke-width=\"" + js (g.w) + "\"/>"
         + "<path class=\"ui-md\"/><circle class=\"ui-live\" r=\"2.4\"/><line class=\"ui-ptr\"/><line class=\"ui-dn\"/></svg>" + inner + "</div>";
}
std::string uiPic (const std::string& inner, const std::string& vb, const std::string& cls)
{
    return "<svg class=\"ui-pic" + (cls.empty() ? S() : " " + cls) + "\" viewBox=\"" + vb + "\" aria-hidden=\"true\">" + inner + "</svg>";
}
RingPaint uiKnobPaint (double size, const RingState& st)
{
    RingPaint p;
    const auto g = uiRingGeo (size);
    const double c = g.c, r = g.r, mr = g.mr, u = uiClamp (orD (st.u, 0)), o = st.bip ? 0.5 : 0;
    p.arD = uiArc (c, r, jmin (o, u), jmax (o, u));
    p.capV = fx (st.bip ? std::abs (u - 0.5) * 2 : u, 3);
    const bool m = st.mod && st.modRng > 0;
    p.modClass = m;
    p.mdD = m ? uiArc (c, mr, uiClamp (u - st.modRng), uiClamp (u + st.modRng)) : S();
    p.mc = m ? st.modCol : S();
    if (m && st.modLive)
    {
        const double a = UI_A0 + UI_SWEEP * uiClamp (*st.modLive);
        p.liveShown = true;
        p.liveCx = N (c + std::cos (a) * mr);
        p.liveCy = N (c + std::sin (a) * mr);
    }
    if (st.pointer)
    {
        const double a = UI_A0 + UI_SWEEP * u;
        p.ptrShown = true;
        p.ptrX1 = N (c + std::cos (a) * r * 0.2);
        p.ptrY1 = N (c + std::sin (a) * r * 0.2);
        p.ptrX2 = N (c + std::cos (a) * r * 0.62);
        p.ptrY2 = N (c + std::sin (a) * r * 0.62);
    }
    if (st.def && std::isfinite (*st.def))
    {
        const double a = UI_A0 + UI_SWEEP * uiClamp (*st.def);
        p.dnSet = true;
        p.dnX1 = N (c + std::cos (a) * (r + 2));
        p.dnY1 = N (c + std::sin (a) * (r + 2));
        p.dnX2 = N (c + std::cos (a) * (r + 5));
        p.dnY2 = N (c + std::sin (a) * (r + 5));
    }
    return p;
}
std::string uiRingBody (double size, const RingState& st)
{
    const auto g = uiRingGeo (size);
    const auto p = uiKnobPaint (size, st);
    S s = "<path class=\"ui-tr\" d=\"" + uiArc (g.c, g.r, 0, 1) + "\" stroke-width=\"" + js (g.w) + "\"/><path class=\"ui-ar\" stroke-width=\"" + js (g.w) + "\" d=\"" + p.arD + "\"/>";
    s += "<path class=\"ui-md\" d=\"" + p.mdD + "\"/>";
    if (p.liveShown) s += "<circle class=\"ui-live\" r=\"2.4\" cx=\"" + p.liveCx + "\" cy=\"" + p.liveCy + "\"/>";
    if (p.ptrShown) s += "<line class=\"ui-ptr\" x1=\"" + p.ptrX1 + "\" y1=\"" + p.ptrY1 + "\" x2=\"" + p.ptrX2 + "\" y2=\"" + p.ptrY2 + "\"/>";
    s += p.dnSet ? "<line class=\"ui-dn\" x1=\"" + p.dnX1 + "\" y1=\"" + p.dnY1 + "\" x2=\"" + p.dnX2 + "\" y2=\"" + p.dnY2 + "\"/>" : S ("<line class=\"ui-dn\"/>");
    return s;
}

// ── 404 ────────────────────────────────────────────────────────────────────

namespace
{
S ggWave (double x0, double x1, double y, double amp, double cycles, const S& cls = "a")
{
    S d;
    for (int i = 0; i <= 64; i++)
    {
        const double t = (double) i / 64;
        d += (i ? "L" : "M") + fx (lerp (x0, x1, t), 2) + " " + fx (y - amp * std::sin (t * cycles * 2 * PI), 2);
    }
    return "<path d=\"" + d + "\" class=\"" + cls + "\" />";
}
} // namespace

std::string gsMixGlyph (double v)
{
    return ggWave (4, 60, 24, 9, 2, "f") + ggWave (4, 60, 24, 9 * v, 3) + "<text x=\"2\" y=\"46\" class=\"t\">dry</text><text x=\"46\" y=\"46\" class=\"ta\">wet</text>";
}
std::string gsLevelGlyph (double v)
{
    const double n = (v + 24) / 36;
    S s;
    for (int i = 0; i < 8; i++)
        s += "<rect x=\"" + js (6 + i * 7) + "\" y=\"" + js (40 - i * 4.4) + "\" width=\"5\" height=\"" + js (4 + i * 4.4) + "\" rx=\"1\" fill=\"" + ((double) i / 8 < n ? "var(--gg)" : "rgba(255,255,255,.12)")
           + "\"/>";
    return s;
}
std::string gsGroupIcon (const std::string& group)
{
    static const std::map<S, S> GI = {
        { "EQ & Compression", "M2 9 C5 9,6 3,9 3 S13 9,16 9" },
        { "Reverb & Delay", "M2 3 V11 M6 5 V9 M10 6 V8 M14 6.5 V7.5" },
        { "Chorus & Phasing", "M2 5 C5 1,7 1,9 5 S13 9,16 5 M2 10 C5 6,7 6,9 10 S13 14,16 10" },
        { "Pitch & Motion", "M2 11 L6 7 L10 9 L16 3" },
        { "Noise & Generators", "M2 7 L3 4 L4 10 L5 3 L6 9 L7 5 L8 11 L9 4 L10 8 L11 6 L12 10 L13 3 L14 9 L16 7" },
        { "Spectral", "M2 12V8M5 12V4M8 12V6M11 12V2M14 12V9" },
        { "Utility & Shaping", "M2 12 C4 12,5 3,8 3 H11 C13 3,13 12,16 12" },
        { "Reverb", "M2 3 V11 M6 5 V9 M10 6 V8 M14 6.5 V7.5" },
        { "Spectral Suite", "M2 12V8M5 12V4M8 12V6M11 12V2M14 12V9" },
        { "Cassette", "M2 4 H16 V11 H2 Z M6 7.5 m-1.5 0 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0 M12 7.5 m-1.5 0 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0" },
        { "Delay", "M2 11 V3 M7 11 V6 M12 11 V8 M16 11 V9.5" },
        { "Modulation", "M2 5 C5 1,7 1,9 5 S13 9,16 5 M2 10 C5 6,7 6,9 10 S13 14,16 10" },
        { "Pitch", "M2 11 L6 7 L10 9 L16 3" },
        { "Dynamics", "M2 12 L8 6 L16 3" },
        { "Saturation", "M2 12 C6 12,6 2,10 2 H16" },
        { "Filter", "M2 9 C5 9,6 3,9 3 S13 9,16 9" },
        { "Stereo", "M2 7 H16 M5 4 L2 7 L5 10 M13 4 L16 7 L13 10" },
        { "Utility", "M2 12 C4 12,5 3,8 3 H11 C13 3,13 12,16 12" },
    };
    const auto it = GI.find (group);
    return it == GI.end() ? S() : it->second;
}
std::string gsRackIcon (const std::string& kind, const std::string& group)
{
    static const std::vector<std::pair<std::regex, S>> RI = {
        { reCase ("(^|[^a-z])eq|equal"), "M1 9 C4 9,5 3,8 3 S12 10,14 7 L17 6" },
        { reCase ("comp|limit"), "M1 12 L9 5 L17 3 M1 5h3M6 5h2M11 5h2M15 5h2" },
        { reCase ("echo|delay"), "M2 2v10M6 4v6M10 5.5v3M14 6.5v1" },
        { reCase ("plate"), "M2 11 L5 3 H16 L13 11 Z M7 7h5" },
        { reCase ("hall|room|chamber|verb"), "M2 3v8M5 4.5v6.5M8 6v5M11 7.5v3.5M14 9v2" },
        { reCase ("chorus|flang|phas"), "M1 7 C3 2,5 2,7 7 S11 12,13 7 S16 3,17 5" },
        { reCase ("dist|drive|crush|fold"), "M1 10 L4 10 L6 3 L9 11 L11 3 L13 10 H17" },
    };
    const S k = lower (kind);
    for (const auto& [r, d] : RI)
        if (test (r, k)) return d;
    return gsGroupIcon (group);
}
std::string gsFkIcon (const std::string& label)
{
    static const std::vector<std::pair<std::regex, S>> FKI = {
        { re ("bass"), "M1 3 C3 3,4 6.5,6 6.5 H11" },
        { re ("rfl|refl"), "M2 1v8M6 4v5M10 6v3" },
        { re ("pre ?delay|predelay"), "M1 8.5 H4 V1.5 C6 1.5,7 8,11 8.5" },
        { re ("early"), "M2 9V2M4 9V4M6 9V3M8 9V6" },
        { re ("mix|wet|dry"), "M1 5a3 3 0 1 0 6 0a3 3 0 1 0-6 0M5 5a3 3 0 1 0 6 0a3 3 0 1 0-6 0" },
        { re ("feedback|regen"), "M2 3h6a2 2 0 0 1 0 4H3M5 5L3 7l2 2" },
        { re ("damp|cut|roll|bandwidth|tone"), "M1 3h5 C8.5 3,9.5 6,11 9" },
        { re ("size|room|space"), "M1 1h10v8H1zM4 3.5h4v3H4z" },
        { re ("diffus"), "M2 2h.1M6 3h.1M10 2h.1M3 6h.1M8 6.5h.1M5 8.5h.1M10 8.5h.1" },
        { re ("shape"), "M1 9 L3 2 L8 3.5 L11 9" },
        { re ("spread|width|stereo"), "M1 5h10M1 5l2-2M1 5l2 2M11 5l-2-2M11 5l-2 2" },
        { re ("spin|wander|mod|rate|depth|rand"), "M1 5 C2.5 1,4 1,5.5 5 S8.5 9,10 5" },
        { re ("slope"), "M2 1v8M5 3v6M8 5v4M11 7v2" },
        { re ("glide"), "M1 8.5 C5 8.5,7 1.5,11 1.5" },
        { re ("decay|reverb time|^rt|time$"), "M1 1.5 C3 1.5,4 8.5,11 8.5" },
        { re ("delay|time"), "M2 1v8M8 3v6M2 5h6" },
        { re ("level|gain|out"), "M1 9 L11 1 V9 Z" },
    };
    for (const auto& [r, d] : FKI)
        if (test (r, label)) return d;
    return {};
}
} // namespace fxp
