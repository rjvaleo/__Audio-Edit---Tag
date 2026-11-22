#include "GrainPictures.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <limits>

namespace gpic
{
namespace
{
constexpr double PI = 3.14159265358979323846;
constexpr double TAU = PI * 2; // WV_TAU
const char* const HEAD_COL = "hsl(200,70%,68%)"; // GS_HEAD_COL
const char* const START = "#8fe388";            // GS_START
const char* const SEP_TONE = "#f0b060";         // GS_SEP_COL
const char* const SEP_HITS = "#78e2ec";
const char* const SEP_AIR = "#a88ce8";

juce::String U (const char* s) { return juce::String::fromUTF8 (s); }

// A JavaScript number as a string: integers as integers, anything else as
// near as a CSS reader needs.
juce::String numStr (double v)
{
    if (std::isnan (v))
        return "NaN";
    if (std::isinf (v))
        return v > 0 ? "Infinity" : "-Infinity";
    if (v == std::floor (v) && std::abs (v) < 1e15)
        return juce::String ((long long) v);
    char b[40];
    std::snprintf (b, sizeof b, "%.17g", v);
    return b;
}

// wvClamp
double clamp (double v, double a = 0, double b = 1) { return std::max (a, std::min (b, v)); }

double modp (double x, double m) { return std::fmod (std::fmod (x, m) + m, m); }

// gsIsBlack
bool isBlack (int n)
{
    const int k = ((n % 12) + 12) % 12;
    return k == 1 || k == 3 || k == 6 || k == 8 || k == 10;
}

// gsEnvShape
double envShape (double u, double p)
{
    return u < p ? 0.5 - 0.5 * std::cos (PI * u / p) : 0.5 + 0.5 * std::cos (PI * (u - p) / (1 - p));
}

// gsLvl (gsFx2)
juce::String lvl (double v) { return v <= 0 ? juce::String ("out") : toFixed (v, 2) + U ("×"); }

juce::String bloomA (const Cl& cl, const juce::String& a) { return "rgba(" + cl.bloom + "," + a + ")"; }

double rd (const Inputs& in, const std::string& k) { return in.read ? in.read (k) : 0.0; }

// gsReadSpeed: how fast the read moves through the sound, seconds of it a second.
double readSpeed (const Inputs& in)
{
    return (in.engine == "pvsola" ? 1.0 : rd (in, "scan")) / rd (in, "ratio");
}

// gsReadWrap
double readWrap (const Inputs& in, double rp)
{
    const double a = in.loopA, b = in.loopB, len = in.hasFile ? in.fileLen : 1;
    const double wr = rd (in, "wrap");
    if (wr != 0 && !std::isnan (wr))
        return in.loopOn ? a + modp (rp - a, b - a) : modp (rp, len);
    return in.loopOn ? clamp (rp, a, b) : clamp (rp, 0, len);
}

// engineFromSrc, rateScale
double engineFromSrc (const Inputs& in, double f)
{
    const double rateScale = (in.viewRate ? in.viewRate : 48000) / (in.deviceRate ? in.deviceRate : 48000);
    return (f / rateScale) * in.timeRatio;
}

// ─────────────────────────────────────────────── the wave kit (390-wave-kit.js)

using Pt = std::pair<double, double>;

// wvPath
c2d::Path path (const std::function<Pt (double)>& fn, int n)
{
    c2d::Path p;
    for (int i = 0; i <= n; i++)
    {
        const auto [x, y] = fn ((double) i / n);
        if (i)
            p.lineTo (x, y);
        else
            p.moveTo (x, y);
    }
    return p;
}

// wvTrace
void trace (c2d::Context& c, const c2d::Path& p, const Cl& cl, double lw = 1.6, double g = 1)
{
    c.lineJoin = "round";
    c.lineCap = "round";
    const double glow = cl.glow * g;
    if (glow > 0)
    {
        c.setStroke (bloomA (cl, numStr (0.16 * glow)));
        c.lineWidth = lw * 3.6;
        c.shadowBlur = 10 * glow;
        c.setShadow (bloomA (cl, numStr (0.4 * std::min (1.0, glow))));
        c.stroke (p);
        c.shadowBlur = 0;
    }
    c.setStroke (cl.wave);
    c.lineWidth = lw;
    c.stroke (p);
}

// wvUnder
void under (c2d::Context& c, const c2d::Path& p, double x0, double x1, double base, double top, const Cl& cl, double a = 0.2)
{
    c2d::Path f (p);
    f.lineTo (x1, base);
    f.lineTo (x0, base);
    f.closePath();
    auto g = c.createLinearGradient (0, top, 0, base);
    g.addColorStop (0, bloomA (cl, numStr (a)));
    g.addColorStop (1, bloomA (cl, "0"));
    c.fillStyle = g;
    c.fill (f);
}

// wvDot
void dot (c2d::Context& c, double x, double y, double r, const juce::String& col)
{
    c.setFill (col);
    c.shadowBlur = 9;
    c.setShadow (col);
    c.beginPath();
    c.arc (x, y, r, 0, TAU);
    c.fill();
    c.shadowBlur = 0;
}

// ─────────────────────────────────────────────────────────── the transform

struct FftTables
{
    std::vector<int> rev;
    std::vector<double> cos, sin, win;
    FftTables() : rev (NFFT), cos (NFFT / 2), sin (NFFT / 2), win (NFFT)
    {
        const int N = NFFT, bits = (int) std::log2 (N);
        for (int i = 0; i < N; i++)
        {
            int r = 0;
            for (int b = 0; b < bits; b++)
                if (i & (1 << b))
                    r |= 1 << (bits - 1 - b);
            rev[(size_t) i] = r;
        }
        for (int i = 0; i < N / 2; i++)
        {
            cos[(size_t) i] = std::cos (2 * PI * i / N);
            sin[(size_t) i] = -std::sin (2 * PI * i / N);
        }
        for (int i = 0; i < N; i++)
            win[(size_t) i] = 0.5 - 0.5 * std::cos (2 * PI * i / N);
    }
};

const FftTables& fftTables()
{
    static const FftTables t;
    return t;
}

// gsFft
void fft (std::vector<double>& re, std::vector<double>& im)
{
    const int N = NFFT;
    const auto& T = fftTables();
    for (int i = 0; i < N; i++)
    {
        const int j = T.rev[(size_t) i];
        if (j > i)
        {
            std::swap (re[(size_t) i], re[(size_t) j]);
            std::swap (im[(size_t) i], im[(size_t) j]);
        }
    }
    for (int size = 2; size <= N; size *= 2)
    {
        const int half = size / 2, step = N / size;
        for (int s = 0; s < N; s += size)
        {
            for (int k = 0; k < half; k++)
            {
                const size_t w = (size_t) (k * step), a = (size_t) (s + k), b = a + (size_t) half;
                const double tr = re[b] * T.cos[w] - im[b] * T.sin[w], ti = re[b] * T.sin[w] + im[b] * T.cos[w];
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
            }
        }
    }
}

bool sameKey (const std::vector<double>& p, const std::vector<double>& q)
{
    if (p.size() != q.size())
        return false;
    for (size_t i = 0; i < p.size(); i++)
        if (!(p[i] == q[i] || (std::isnan (p[i]) && std::isnan (q[i]))))
            return false;
    return true;
}

// ──────────────────────────────────────────────────── the engine's close-up

// gsLensWave: the sound itself round the head, scaled to what is there.
c2d::Path lensWave (const Pcm& pcm, double head, double span, double wy, double A, const std::function<double (double)>& X)
{
    const long long i0 = (long long) std::floor ((head - span / 2) * pcm.sr), N = (long long) std::floor (span * pcm.sr);
    double lp = 0.001;
    for (long long i = 0; i < N; i += 7)
        lp = std::max (lp, std::abs (pcm.at (i0 + i)));
    return path ([&] (double u) { return Pt { X (u), wy - pcm.at (i0 + (long long) std::floor (u * N)) / lp * A }; }, 600);
}

// gsSpliceWin: a splice's window, as the Window choice draws it.
double spliceWin (double u, double shape)
{
    if (shape == 1)
        return 1 - std::abs (2 * u - 1);
    if (shape == 2)
        return u > 0 && u < 1 ? 1 : 0;
    return envShape (u, 0.5);
}

// gsLensSplice: WSOLA: the two windows being joined, the search round the join, the hits.
void lensSplice (c2d::Context& c, double w, double h, const Cl& cl, const Pcm& pcm, double head, const Inputs& in)
{
    const double span = 0.3;
    auto X = [&] (double u) { return 8 + u * (w - 16); };
    const auto pts = lensWave (pcm, head, span, h * 0.5, h * 0.36, X);
    c.setStroke (bloomA (cl, ".25"));
    c.lineWidth = 1;
    c.stroke (pts);
    const double win = rd (in, "windowMs") / 1000, srch = rd (in, "searchMs") / 1000, ww = win / span, ov = rd (in, "overlap"), shape = rd (in, "spliceShape");
    const std::pair<double, bool> joins[] = { { -ww * 0.5, true }, { ww * 0.5 * (1 - 1 / ov), false } };
    for (const auto& [o, dim] : joins)
    {
        const double x0 = X (0.5 + o - ww / 2), x1 = X (0.5 + o + ww / 2);
        c.save();
        c.beginPath();
        c.rect (x0, 0, x1 - x0, h);
        c.clip();
        trace (c, pts, cl, dim ? 1 : 1.4, dim ? 0.3 : 0.8);
        c.restore();
        c.setStroke (dim ? "rgba(255,255,255,.2)" : "rgba(255,255,255,.55)");
        c.lineWidth = 1;
        c.stroke (path ([&] (double u) { return Pt { x0 + u * (x1 - x0), h - 14 - spliceWin (u, shape) * std::min (24.0, h * 0.3) }; }, 30));
    }
    const double sx = std::max (8.0, X (0.5) - srch / span * (w - 16)), ex = std::min (w - 8, X (0.5) + srch / span * (w - 16));
    const juce::String col = "#cfa66c";
    c.setStroke (col);
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo (sx, 22);
    c.lineTo (ex, 22);
    c.moveTo (sx, 18);
    c.lineTo (sx, 26);
    c.moveTo (ex, 18);
    c.lineTo (ex, 26);
    c.stroke();
    const double pi = rd (in, "splicePick");
    const juce::String pick = pi == 0 ? "best" : pi == 1 ? "worst" : pi == 2 ? "loud" : "undefined";
    const juce::String tx = rd (in, "searchMs") < 0.25 ? juce::String ("plain OLA") : U ("search ±") + toFixed (rd (in, "searchMs"), 1) + U (" ms · pick ") + pick;
    c.setFill (col);
    c.fillText (tx, clamp (sx, 190, w - 8 - c.measureText (tx)), 16);
    const double thr = 0.3 + (1 - rd (in, "sensitivity")) * 0.6, t0 = head - span / 2;
    c.setStroke ("rgba(240,170,150,.9)");
    c.lineWidth = 1;
    for (const auto& o : pcm.on)
    {
        const double u = (o.t - t0) / span;
        if (u < 0 || u > 1 || o.s < thr)
            continue;
        c.beginPath();
        c.moveTo (X (u), 28);
        c.lineTo (X (u), h - 6);
        c.stroke();
    }
}

// gsLensFrame: Vocoder and PVSOLA: one analysis frame's spectrum under its
// waveform, with Freeze, Blur, Gate and the peaks it locks to.
void lensFrame (c2d::Context& c, double w, double h, const Cl& cl, const Pcm& pcm, double head, const Inputs& in, State& st)
{
    const double span = 0.6;
    auto X = [&] (double u) { return 8 + u * (w - 16); };
    const auto pts = lensWave (pcm, head, span, h * 0.3, h * 0.2, X);
    c.setStroke (bloomA (cl, ".25"));
    c.lineWidth = 1;
    c.stroke (pts);
    trace (c, pts, cl, 0.9, 0.3);
    const auto& cur = headBands (pcm, head, st);
    const double fz = rd (in, "magFreeze"), bl = rd (in, "magBlur"), gate = rd (in, "magGate"), pw = jsRound (rd (in, "peakWidth"));
    if (!st.held || fz < 0.005)
        st.held = cur;
    const double sy = h - 8, sh = h * 0.55, bw = (w - 16) / NB;
    const auto& held = *st.held;
    const int blurR = (int) jsRound (bl * 6);
    for (int b = 0; b < NB; b++)
    {
        double v = cur[(size_t) b] * (1 - fz) + held[(size_t) b] * fz;
        if (bl > 0)
        {
            double s = 0, n = 0;
            for (int j = -blurR; j <= blurR; j++)
            {
                s += cur[(size_t) clamp (b + j, 0, NB - 1)];
                n++;
            }
            v = v * (1 - bl) + s / n * bl;
        }
        v = std::pow (v, 1.8);
        c.setFill (v < gate * 0.8 ? juce::String ("rgba(255,255,255,.08)") : bloomA (cl, toFixed (0.25 + 0.6 * v, 3)));
        c.fillRect (8 + b * bw, sy - v * sh, std::max (1.0, bw - 1), v * sh);
    }
    if (gate > 0.005)
    {
        const double gy = sy - gate * 0.8 * sh;
        const juce::String col = "#79bfc3";
        c.setStroke (col);
        c.lineWidth = 1;
        c.setLineDash ({ 4, 4 });
        c.beginPath();
        c.moveTo (8, gy);
        c.lineTo (w - 8, gy);
        c.stroke();
        c.setLineDash ({});
        c.setFill (col);
        c.fillText ("gate", w - 34, gy - 3);
    }
    for (int b = 2; b < NB - 2; b++)
    {
        const float v = cur[(size_t) b];
        if (v > 0.8 && v >= cur[(size_t) b - 1] && v >= cur[(size_t) b + 1] && v >= cur[(size_t) b - 2] && v >= cur[(size_t) b + 2])
        {
            c.setFill ("rgba(169,155,224,.25)");
            c.fillRect (8 + (b - pw / 2) * bw, sy - sh - 4, pw * bw, sh + 4);
            dot (c, 8 + (b + 0.5) * bw, sy - v * sh - 4, 2, "#a99be0");
        }
    }
    if (in.engine == "pvsola")
    {
        // Where the anchors really fall in this stretch of the sound.
        const double fn = rd (in, "vocWindowMs") / 1000 / 2 * rd (in, "anchorFrames"), t0 = head - span / 2;
        c.setFill ("#cfa66c");
        // (fn > 0: the page's loop never ends on a step of none or backwards.)
        if (fn > 0 && span / fn < 200)
            for (double s = std::ceil (t0 / fn) * fn; s < t0 + span; s += fn)
            {
                const double x = X ((s - t0) / span);
                c.beginPath();
                c.moveTo (x - 3, 18);
                c.lineTo (x + 3, 18);
                c.lineTo (x, 23);
                c.fill();
            }
    }
}

// gsLensSeparation: Hybrid: tone, hits and air, a lane each, moving with the head.
void lensSeparation (c2d::Context& c, double w, double h, const Pcm& pcm, double head, const Inputs& in, State& st)
{
    const auto& sep = separate (pcm, head, in, st);
    struct Row
    {
        const char* n;
        const char* col;
        const char* k;
    };
    const std::vector<Row> rows = { { "TONE", SEP_TONE, "harmonicLevel" }, { "HITS", SEP_HITS, "percussiveLevel" }, { "AIR", SEP_AIR, "residualLevel" } };
    const double top = 17, rh = (h - top - 3) / 3;
    const bool narrow = rh < 11;
    const double lx = narrow ? 8 : 72, W = w - lx - 8, t0 = head - 0.6;
    auto X = [&] (double t) { return lx + (t - t0) / 1.2 * W; };
    c.save();
    c.beginPath();
    c.rect (lx, top - 1, W, h - top + 1);
    c.clip();
    for (size_t r = 0; r < rows.size(); r++)
    {
        const juce::String col = rows[r].col;
        const double mid = top + r * rh + rh / 2, A = rh * 0.46;
        const auto& e = sep.lanes[r];
        c2d::Path up;
        for (int i = 0; i < sep.C; i++)
        {
            const double v = std::sqrt (e[(size_t) i] / sep.top) * A, x = X (sep.start + (i + 0.5) * sep.hop);
            if (i)
                up.lineTo (x, mid - v);
            else
                up.moveTo (x, mid - v);
        }
        for (int i = sep.C - 1; i >= 0; i--)
            up.lineTo (X (sep.start + (i + 0.5) * sep.hop), mid + std::sqrt (e[(size_t) i] / sep.top) * A);
        up.closePath();
        c.setFill (col);
        c.globalAlpha = 0.55f;
        c.fill (up);
        c.globalAlpha = 1;
        c.setStroke (col);
        c.lineWidth = 0.8f;
        c.stroke (up);
    }
    c.restore();
    c.setFill ("rgba(255,255,255,.55)");
    c.fillRect (X (head) - 0.5, top - 1, 1, h - top + 1);
    // Lanes too thin to name are named along the top.
    double right = w - 8;
    std::vector<Row> order = rows;
    if (narrow)
        std::reverse (order.begin(), order.end());
    for (size_t r = 0; r < order.size(); r++)
    {
        const juce::String tx = juce::String (order[r].n) + " " + lvl (rd (in, order[r].k));
        c.setFill (order[r].col);
        if (!narrow)
        {
            c.fillText (tx, 8, top + r * rh + rh / 2 + 3);
            continue;
        }
        right -= c.measureText (tx);
        c.fillText (tx, right, 12);
        right -= 12;
    }
}

// gsLensSchedule: Granular: where the grains read against time, each its own
// window. While it sounds, the grains that did; while it is still, the
// engine's own plan.
void lensSchedule (c2d::Context& c, double w, double h, const Cl& cl, const Inputs& in)
{
    if (!in.hasFile)
        return;
    const double flen = in.fileLen, fsr = in.fileRate;
    const bool live = in.headLive;
    const double sc = readSpeed (in), sp = rd (in, "positionJitterMs") / 1000;
    const double a = in.loopA, b = in.loopB;
    double L0 = b - a;
    if (L0 == 0 || std::isnan (L0))
        L0 = flen;
    const double ctr = readWrap (in, in.head + rd (in, "position") * flen), half = std::max (0.15, sp * 1.6 + std::abs (sc) * 2.2);
    auto Y = [&] (double s) { return h / 2 + 4 - (std::fmod (std::fmod (s - ctr + L0 / 2, L0) + L0, L0) - L0 / 2) / half * (h / 2 - 18); };
    // Past on the left and now on the right while it plays; now on the left and
    // what is coming on the right while it does not.
    auto X = [&] (double t) { return live ? w - 8 - t / 2 * (w - 16) : 8 + t / 2 * (w - 16); };
    const double sgn = live ? -1 : 1;
    c.setStroke ("rgba(255,255,255,.05)");
    c.lineWidth = 1;
    for (int i = 1; i < 8; i++)
    {
        c.beginPath();
        c.moveTo (8 + i * (w - 16) / 8, 18);
        c.lineTo (8 + i * (w - 16) / 8, h - 6);
        c.stroke();
    }
    const double far = ctr + sgn * 2 * sc, x0 = X (0), x1 = X (2);
    if (sp > 0)
    {
        c.setFill ("rgba(124,240,208,.06)");
        c.beginPath();
        c.moveTo (x0, Y (ctr + sp));
        c.lineTo (x1, Y (far + sp));
        c.lineTo (x1, Y (far - sp));
        c.lineTo (x0, Y (ctr - sp));
        c.fill();
    }
    c.setStroke ("rgba(255,255,255,.18)");
    c.setLineDash ({ 3, 4 });
    c.beginPath();
    c.moveTo (x0, Y (ctr));
    c.lineTo (x1, Y (far));
    c.stroke();
    c.setLineDash ({});
    const double pk = 0.06 + 0.88 * rd (in, "envelope"), base = rd (in, "semitones");
    auto bell = [&] (double x, double y, double size, double hh, double al) {
        const double bw = std::max (3.0, size / 2 * (w - 16));
        c.setStroke (bloomA (cl, toFixed (al, 2)));
        c.lineWidth = 1;
        c.stroke (path ([&] (double u) { return Pt { x - bw / 2 + u * bw, y - envShape (u, pk) * hh }; }, 12));
    };
    int n = 0;
    if (live)
    {
        const double now = in.now;
        for (long long i = (long long) in.sounded.size() - 1; i >= 0 && n < 320; i--, n++)
        {
            const auto& e = in.sounded[(size_t) i];
            const double age = now - e.at;
            if (age > 2)
                break;
            // How far from the note a grain was thrown lifts it: the only size the
            // engine reports besides its length.
            bell (X (age), Y (e.src), e.size, 6 + std::min (8.0, std::abs (e.semis - base)), 0.2 + 0.65 * (1 - age / 2));
        }
    }
    else
    {
        const double sr = in.planRate ? in.planRate : fsr;
        const double at = engineFromSrc (in, in.cue * fsr) / (in.deviceRate ? in.deviceRate : 48000) * sr, span = 2 * sr;
        for (const auto& ev : in.plan)
        {
            if (ev.outFrame < at || ev.outFrame > at + span || n >= 260)
                continue;
            const double dt = (ev.outFrame - at) / sr;
            const double level = std::isnan (ev.level) ? 0 : ev.level;
            bell (X (dt), Y (ev.srcFrame / sr), ev.size / sr, 5 + 7 * clamp (level * 4), 0.2 + 0.65 * (1 - dt / 2));
            n++;
        }
    }
    dot (c, x0, Y (ctr), 3, cl.acc);
    c.setFill (cl.t3);
    c.fillText (U ("±") + numStr (jsRound (half * 1000)) + " ms round the head", 8, h - 6);
    if (!n)
        c.fillText (live ? "no grains are sounding" : "nothing planned at Start", 8, h / 2 + 3);
}
} // namespace

// ───────────────────────────────────────────────────────────── the formats

double jsRound (double v)
{
    if (!std::isfinite (v))
        return v;
    double r = std::floor (v);
    if (v - r >= 0.5)
        r += 1;
    return r;
}

juce::String toFixed (double v, int digits)
{
    if (std::isnan (v))
        return "NaN";
    if (std::abs (v) >= 1e21)
        return numStr (v);
    const bool neg = v < 0;
    const double x = std::abs (v);
    // The exact decimal value; a tie goes to the larger, as the spec has it
    // (printf rounds a tie to even).
    char exact[400];
    std::snprintf (exact, sizeof exact, "%.80f", x);
    std::string s (exact);
    const auto dotAt = s.find ('.');
    std::string ip = s.substr (0, dotAt), fp = s.substr (dotAt + 1);
    std::string keep = fp.substr (0, (size_t) digits), rest = fp.substr ((size_t) digits);
    // Above a half, or exactly a half: both go up.
    const bool up = !rest.empty() && rest[0] >= '5';
    std::string all = ip + keep;
    if (up)
    {
        int i = (int) all.size() - 1;
        for (; i >= 0; i--)
        {
            if (all[(size_t) i] == '9')
                all[(size_t) i] = '0';
            else
            {
                all[(size_t) i]++;
                break;
            }
        }
        if (i < 0)
            all = "1" + all;
    }
    const size_t il = all.size() - (size_t) digits;
    std::string out = all.substr (0, il);
    if (digits > 0)
        out += "." + all.substr (il);
    return juce::String (neg ? "-" : "") + juce::String (out);
}

juce::String fmtS (double s)
{
    return s < 1 ? numStr (jsRound (s * 1000)) + " ms" : toFixed (s, 2) + " s";
}

juce::String keyName (int n)
{
    static const char* const names[] = { "C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B" };
    const int fl = (int) std::floor (n / 12.0);
    return U (names[((n % 12) + 12) % 12]) + numStr (fl - 1);
}

juce::String noteName (double f)
{
    const double m = 69 + 12 * std::log2 (f / 440), r = jsRound (m), c = jsRound ((m - r) * 100);
    return keyName ((int) r) + (c != 0 && !std::isnan (c) ? (c > 0 ? U (" +") : U (" −")) + numStr (std::abs (c)) + U ("¢") : juce::String());
}

juce::String voiceCol (int key, double a)
{
    const int hue = 200 + (key * 47) % 150; // gsVoiceHue
    return "hsla(" + numStr (hue) + ",70%,68%," + numStr (a) + ")";
}

juce::String lensLabel (const Inputs& in)
{
    const auto& e = in.engine;
    if (e == "granular")
        return in.headLive ? U ("GRAIN SCHEDULE · last 2 s") : U ("GRAIN SCHEDULE · next 2 s");
    if (e == "wsola")
        return U ("SPLICE · close-up at the head");
    if (e == "hybrid")
        return U ("SEPARATION · tone, hits and air at the head");
    if (e == "pvsola")
        return U ("FRAME · re-anchored every ") + numStr (jsRound (rd (in, "anchorFrames"))) + " frames";
    return U ("FRAME · the spectrum under the head");
}

// ────────────────────────────────────────────────────────────── the samples

double Pcm::at (long long i) const
{
    if (i < 0 || (size_t) i >= n || !data)
        return 0;
    const double v = data[(size_t) i];
    return std::isnan (v) ? 0 : v;
}

void power (const Pcm& pcm, long long at, float* out, State& st)
{
    const auto& win = fftTables().win;
    auto& re = st.re;
    auto& im = st.im;
    const long long s0 = at - NFFT / 2;
    for (int i = 0; i < NFFT; i++)
    {
        re[(size_t) i] = pcm.at (s0 + i) * win[(size_t) i];
        im[(size_t) i] = 0;
    }
    fft (re, im);
    for (int b = 0; b < NB; b++)
    {
        double m = 0;
        for (int k = pcm.k0[(size_t) b]; k < pcm.k1[(size_t) b] && k < NFFT / 2; k++)
        {
            const double v = re[(size_t) k] * re[(size_t) k] + im[(size_t) k] * im[(size_t) k];
            if (v > m)
                m = v;
        }
        out[b] = (float) m;
    }
}

void bandsInto (const Pcm& pcm, long long at, float* out, State& st)
{
    power (pcm, at, out, st);
    for (int b = 0; b < NB; b++)
        out[b] = (float) clamp ((10 * std::log10 (out[b] / pcm.top + 1e-12) + 78 + (double) b / NB * 22) / 80);
}

const std::vector<float>& headBands (const Pcm& pcm, double head, State& st)
{
    const long long at = (long long) jsRound (head * pcm.sr);
    if (st.bandsAt != at || st.bandsGen != st.gen)
    {
        st.bandsAt = at;
        st.bandsGen = st.gen;
        bandsInto (pcm, at, st.bands.data(), st);
    }
    return st.bands;
}

Pcm analyse (const float* data, size_t n, double sr, State& st)
{
    Pcm pcm;
    pcm.k0.assign (NB, 0);
    pcm.k1.assign (NB, 0);
    for (int b = 0; b < NB; b++)
    {
        const double f0 = 40 * std::pow (500.0, (double) b / NB), f1 = 40 * std::pow (500.0, (double) (b + 1) / NB);
        pcm.k0[(size_t) b] = std::max (1, (int) std::floor (f0 / sr * NFFT));
        pcm.k1[(size_t) b] = std::max (pcm.k0[(size_t) b] + 1, (int) std::ceil (f1 / sr * NFFT));
    }
    pcm.data = data;
    pcm.n = n;
    pcm.sr = sr;
    pcm.len = (double) n / sr;
    for (size_t i = 0; i < n; i++)
    {
        const double v = std::abs ((double) data[i]);
        if (v > pcm.peak)
            pcm.peak = v;
    }
    std::vector<float> col ((size_t) NB);
    for (int c = 0; c < PCM_COLS; c++)
    {
        power (pcm, (long long) std::floor ((c + 0.5) / PCM_COLS * (double) n), col.data(), st);
        for (int b = 0; b < NB; b++)
            if (col[(size_t) b] > pcm.top)
                pcm.top = col[(size_t) b];
    }
    // Energy in 10 ms frames, and its rises.
    const long long hop = std::max (1LL, (long long) jsRound (sr * 0.01)), F = (long long) n / hop;
    std::vector<float> env ((size_t) F);
    for (long long f = 0; f < F; f++)
    {
        double q = 0;
        for (long long i = f * hop; i < (f + 1) * hop; i++)
            q += (double) data[i] * (double) data[i];
        env[(size_t) f] = (float) std::sqrt (q / (double) hop);
    }
    {
        std::vector<float> sorted = env;
        // Float32Array's sort: numbers ascending, NaN last.
        std::sort (sorted.begin(), sorted.end(), [] (float p, float q) {
            if (std::isnan (p))
                return false;
            if (std::isnan (q))
                return true;
            return p < q;
        });
        const double m = F > 0 ? (double) sorted[(size_t) (F >> 1)] : 0;
        pcm.med = (m != 0 && !std::isnan (m)) ? m : 0.01;
    }
    std::vector<float> fl ((size_t) F, 0.0f);
    double mf = 0;
    for (long long f = 2; f < F; f++)
    {
        fl[(size_t) f] = (float) std::max (0.0, std::sqrt ((double) env[(size_t) f]) - std::sqrt ((double) env[(size_t) f - 2]));
        if (fl[(size_t) f] > mf)
            mf = fl[(size_t) f];
    }
    for (long long f = 3; f < F - 1; f++)
    {
        const size_t i = (size_t) f;
        if (!(fl[i] > fl[i - 1] && fl[i] >= fl[i + 1] && fl[i] > mf * 0.12))
            continue;
        const double t = f * 0.01;
        if (!pcm.on.empty() && t - pcm.on.back().t < 0.06)
        {
            auto& last = pcm.on.back();
            if (fl[i] / mf > last.s)
            {
                last.t = t;
                last.s = fl[i] / mf;
                last.l = env[i];
            }
        }
        else
            pcm.on.push_back ({ t, fl[i] / mf, (double) env[i] });
    }
    return pcm;
}

juce::String noteFor (const Inputs& in)
{
    if (!in.hasFile)
        return {};
    if (in.fileLen > PCM_MAX_S)
        return "Over " + numStr (PCM_MAX_S / 60) + " minutes: not analysed";
    return in.note;
}

const Pcm* pcmFor (const Inputs& in, State& st)
{
    if (!in.hasFile || in.fileLen > PCM_MAX_S || !in.samples || !in.count || !(in.rate > 0))
        return nullptr;
    if (!st.analysed || st.src != in.samples || st.srcN != in.count || st.srcRate != in.rate || st.srcSerial != in.serial)
    {
        // gsPicTake
        st.src = in.samples;
        st.srcN = in.count;
        st.srcRate = in.rate;
        st.srcSerial = in.serial;
        st.analysed = true;
        st.gen++;
        st.pcm = analyse (in.samples, in.count, in.rate, st);
        st.held.reset();
        st.sep.reset();
    }
    return &st.pcm;
}

const Sep& separate (const Pcm& pcm, double head, const Inputs& in, State& st)
{
    std::vector<double> key;
    for (const char* k : { "timeSpan", "freqSpan", "margin", "fftSize", "harmonicLevel", "percussiveLevel", "residualLevel" })
        key.push_back (rd (in, k));
    if (st.sep && st.sep->gen == st.gen && sameKey (st.sep->key, key) && std::abs (st.sep->head - head) < 0.06)
        return *st.sep;
    const double span = 1.4;
    const int C = 170;
    std::vector<float> cols ((size_t) (C * NB));
    const double hop = span / C;
    const double start = head - span / 2;
    std::vector<float> frame ((size_t) NB);
    for (int c = 0; c < C; c++)
    {
        bandsInto (pcm, (long long) jsRound ((start + (c + 0.5) * hop) * pcm.sr), frame.data(), st);
        std::copy (frame.begin(), frame.end(), cols.begin() + c * NB);
    }
    // Hold and Spread are in the engine's frames and bins; its hop is a quarter
    // of Resolution. Spread is on these log bands the way the mock-up had it.
    const double hopE = rd (in, "fftSize") / 4 / pcm.sr;
    const int kt = (int) std::max (1.0, jsRound (rd (in, "timeSpan") / 2 * hopE / hop)), kf = (int) std::max (1.0, jsRound (rd (in, "freqSpan") / 4));
    const double mg = rd (in, "margin");
    std::vector<float> pw (cols.size());
    for (size_t i = 0; i < cols.size(); i++)
        pw[i] = (float) std::pow (10.0, ((double) cols[i] * 80 - 80) / 10);
    double L[3];
    const char* lk[3] = { "harmonicLevel", "percussiveLevel", "residualLevel" };
    for (int r = 0; r < 3; r++)
        L[r] = std::min (1.4, rd (in, lk[r]));
    Sep sep;
    for (auto& lane : sep.lanes)
        lane.assign ((size_t) C, 0.0f);
    double top = 1e-6;
    for (int c = 0; c < C; c++)
    {
        for (int b = 0; b < NB; b++)
        {
            double hs = 0, hn = 0, ps = 0, pn = 0;
            for (int j = -kt; j <= kt; j++)
            {
                const int q = c + j;
                if (q >= 0 && q < C)
                {
                    hs += pw[(size_t) (q * NB + b)];
                    hn++;
                }
            }
            for (int j = -kf; j <= kf; j++)
            {
                const int q = b + j;
                if (q >= 0 && q < NB)
                {
                    ps += pw[(size_t) (c * NB + q)];
                    pn++;
                }
            }
            const double hh = hs / hn, p = ps / pn;
            const int cls = hh > p * mg ? 0 : p > hh * mg ? 1 : 2;
            auto& cell = sep.lanes[cls][(size_t) c];
            cell = (float) (cell + std::pow ((double) cols[(size_t) (c * NB + b)], 1.5) * L[cls]);
        }
        for (int r = 0; r < 3; r++)
            if (sep.lanes[r][(size_t) c] > top)
                top = sep.lanes[r][(size_t) c];
    }
    sep.gen = st.gen;
    sep.key = key;
    sep.head = head;
    sep.start = start;
    sep.hop = hop;
    sep.C = C;
    sep.top = top;
    sep.span = span;
    st.sep = std::move (sep);
    return *st.sep;
}

// ───────────────────────────────────────────────────────── labels and heads

void lbl (c2d::Context& c, const juce::String& tx, float x, float y, const juce::String& col, const juce::String& bg, const juce::String& al)
{
    const float tw = c.measureText (tx), x0 = al == "right" ? x - tw : x;
    c.setFill (bg);
    c.fillRect (x0 - 4, y - 9, tw + 8, 12);
    c.setFill (col);
    c.fillText (tx, x0, y);
}

void headLabels (c2d::Context& c, std::vector<HeadLabel> heads, float y0, float step)
{
    double last = -1e9;
    int row = 0;
    std::stable_sort (heads.begin(), heads.end(), [] (const HeadLabel& p, const HeadLabel& q) { return p.x < q.x; });
    for (const auto& h : heads)
    {
        row = h.x - last < 34 ? row + 1 : 0;
        last = h.x;
        lbl (c, h.t, h.x + 4, y0 + row * step, h.col);
    }
}

void drawVoiceHeads (c2d::Context& c, const std::function<float (double)>& X, float top, float bot, float labelY, float step,
                     const Inputs& in, const std::function<bool (double)>& within)
{
    std::vector<HeadLabel> labels;
    for (const auto& h : in.heads)
    {
        if (within && !within (h.src))
            continue;
        const float x = X (h.src);
        const double al = std::max (0.2, std::min (1.0, h.env * 1.4));
        const auto col = voiceCol (h.key, al);
        c.save();
        c.setFill (col);
        c.shadowBlur = 8;
        c.setShadow (voiceCol (h.key, 0.8));
        c.fillRect (x - 0.75f, top, 1.5f, bot - top);
        c.restore();
        labels.push_back ({ x, keyName (h.key), col });
    }
    c.font = "600 9px " + in.cl.mono;
    headLabels (c, labels, labelY, step);
}

void drawNoteHead (c2d::Context& c, float x, float top, float bot, float labelY, const Inputs& in)
{
    c.save();
    c.setFill (HEAD_COL);
    c.shadowBlur = 8;
    c.setShadow (HEAD_COL);
    c.fillRect (x - 0.75f, top, 1.5f, bot - top);
    c.restore();
    c.font = "600 9px " + in.cl.mono;
    if (in.lastKey)
        lbl (c, keyName (*in.lastKey), x + 4, labelY, HEAD_COL);
}

void picLabel (c2d::Context& c, float w, const Cl& cl, const juce::String& left, const juce::String& right)
{
    c.font = "9px " + cl.mono;
    c.setFill (cl.t3);
    c.fillText (left, 8, 12);
    if (right.isNotEmpty())
    {
        c.textAlign = "right";
        c.fillText (right, w - 8, 12);
        c.textAlign = "left";
    }
}

void picNote (c2d::Context& c, float h, const Cl& cl, const juce::String& note)
{
    c.font = "9px " + cl.mono;
    c.setFill (cl.t3);
    c.fillText (note.isNotEmpty() ? note : juce::String ("Open a sound"), 8, h - 8);
}

// ─────────────────────────────────────────────────────────────── at the head

// gsDrawHeadPic: the spectrum under the newest note, before and after its
// pitch, on a piano, naming the note in the sound and the note you hear.
void headPic (c2d::Context& c, float wf, float hf, const Inputs& in, State& st)
{
    const double w = wf, h = hf;
    const Pcm* pcm = pcmFor (in, st);
    const auto& cl = in.cl;
    const double hd = in.head;
    st.drawnHead++;
    c.clearRect (0, 0, w, h);
    c.font = "9px " + cl.mono;
    if (!pcm)
    {
        picLabel (c, w, cl, "AT THE HEAD");
        picNote (c, h, cl, noteFor (in));
        return;
    }
    const auto& sp = headBands (*pcm, hd, st);
    auto fr = [] (double k) { return 40 * std::pow (500.0, k / (NB - 1)); };
    const double f0 = 50, f1 = 9000;
    auto X = [&] (double f) { return 8 + std::log (f / f0) / std::log (f1 / f0) * (w - 16); };
    const double kb = 10, base = h - kb - 5, top = 20, H0 = base - top;
    for (int m = 31; m <= 110; m++)
    {
        const double x = X (440 * std::pow (2.0, (m - 69.5) / 12)), x2 = X (440 * std::pow (2.0, (m - 68.5) / 12));
        if (x2 < 8 || x > w - 8)
            continue;
        c.setFill (isBlack (m) ? "rgba(255,255,255,.05)" : "rgba(255,255,255,.16)");
        c.fillRect (std::max (8.0, x) + 0.5, h - kb - 3, std::max (1.0, std::min (w - 8, x2) - std::max (8.0, x) - 1), kb);
        if (m % 12 == 0)
        {
            c.setFill (cl.t3);
            c.fillText ("C" + numStr (m / 12 - 1), x + 1, h - kb - 6);
        }
    }
    const double stp = (in.keysPitch ? *in.keysPitch : in.bend * in.bendRange) + rd (in, "semitones"), pr = std::pow (2.0, stp / 12);
    auto sv = [&] (int i) { return std::pow ((double) sp[(size_t) i], 1.7); };
    auto pts = [&] (double mul) {
        c2d::Path p;
        bool first = true;
        for (int i = 0; i < NB; i++)
        {
            const double f = fr (i) * mul;
            if (f < f0 || f > f1)
                continue;
            const double x = X (f), y = base - sv (i) * H0;
            if (first)
            {
                p.moveTo (x, base);
                first = false;
            }
            p.lineTo (x, y);
        }
        return p;
    };
    const auto p0 = pts (1);
    c2d::Path pf (p0);
    pf.lineTo (X (std::min (f1, fr (NB - 1))), base);
    c.setFill ("rgba(150,160,182,.16)");
    c.fill (pf);
    c.setStroke ("rgba(150,160,182,.55)");
    c.lineWidth = 1;
    c.stroke (p0);
    trace (c, pts (pr), cl, 1.3, 0.7);
    // The strongest partial between 60 Hz and 2 kHz.
    int bk = -1;
    double bv = 0;
    for (int i = 2; i < NB - 2; i++)
    {
        const double f = fr (i);
        if (f < 60 || f > 2000)
            continue;
        const double q = sp[(size_t) i] + 0.5 * ((double) sp[(size_t) i - 1] + sp[(size_t) i + 1]);
        if (q > bv)
        {
            bv = q;
            bk = i;
        }
    }
    if (bk > 0)
    {
        const double a = sp[(size_t) bk - 1], b = sp[(size_t) bk], d = sp[(size_t) bk + 1];
        double den = 2 * (a - 2 * b + d);
        if (den == 0 || std::isnan (den))
            den = 1;
        const double off = (a - d) / den;
        const double f = 40 * std::pow (500.0, (bk + clamp (off, -0.5, 0.5)) / (NB - 1)), y = base - sv (bk) * H0;
        c.setLineDash ({ 2, 3 });
        c.setStroke ("rgba(150,160,182,.6)");
        c.beginPath();
        c.moveTo (X (f), y);
        c.lineTo (X (f), base);
        c.stroke();
        c.setStroke (cl.acc);
        c.beginPath();
        c.moveTo (X (f * pr), y);
        c.lineTo (X (f * pr), base);
        c.stroke();
        c.setLineDash ({});
        dot (c, X (f), y, 2.5, "rgba(190,198,214,.9)");
        dot (c, X (f * pr), y, 3, cl.acc);
        c.font = "600 9px " + cl.mono;
        const juce::String t1 = "source " + noteName (f);
        c.setFill (cl.t2);
        c.fillText (t1, 8, 12);
        c.setFill (cl.acc);
        c.fillText ("heard " + noteName (f * pr), 8 + c.measureText (t1) + 14, 12);
        c.font = "9px " + cl.mono;
    }
    c.setFill (cl.t3);
    c.textAlign = "right";
    c.fillText (U ("AT THE HEAD · ") + toFixed (hd, 2) + U (" s · ") + (stp >= 0 ? U ("+") : U ("−")) + toFixed (std::abs (stp), 2) + " st", w - 8, 12);
    c.textAlign = "left";
}

// ─────────────────────────────────────────────────────────────── the time map

// gsDrawMapPic: read position against time since the key went down, with its
// wraps: the path a note takes from Start, and the place the head has got to.
void mapPic (c2d::Context& c, float wf, float hf, const Inputs& in, State& st)
{
    const double w = wf, h = hf;
    const auto& cl = in.cl;
    st.drawnMap++;
    c.clearRect (0, 0, w, h);
    c.font = "9px " + cl.mono;
    if (!in.hasFile)
    {
        picLabel (c, w, cl, "TIME MAP");
        return;
    }
    const double flen = in.fileLen;
    const double a = in.loopA, b = in.loopB, L = b - a, sp = readSpeed (in);
    const double per = std::abs (sp) > 1e-4 ? L / std::abs (sp) : std::numeric_limits<double>::infinity();
    const double span = std::isfinite (per) ? clamp (per * 2.3, 2, 90) : 8, top = 16, bot = h - 14;
    auto Y = [&] (double s) { return bot - s / flen * (bot - top); };
    auto X = [&] (double t) { return 8 + t / span * (w - 16); };
    const double cue = in.cue;
    c.setFill ("rgba(124,240,208,.06)");
    c.fillRect (8, Y (b), w - 16, Y (a) - Y (b));
    c.setStroke ("rgba(124,240,208,.35)");
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo (8, Y (a));
    c.lineTo (w - 8, Y (a));
    c.moveTo (8, Y (b));
    c.lineTo (w - 8, Y (b));
    c.stroke();
    c.setStroke (START);
    c.setLineDash ({ 2, 3 });
    c.beginPath();
    c.moveTo (8, Y (cue));
    c.lineTo (w - 8, Y (cue));
    c.stroke();
    c.setLineDash ({});
    // A held note goes round the brackets whatever the loop light says; the
    // transport, with Run on, only with it lit.
    const bool loops = !in.run || in.loopOn;
    const int n = 400;
    double hd = cue, py = Y (hd);
    c.setStroke (cl.t);
    c.lineWidth = 1.3f;
    c.beginPath();
    c.moveTo (X (0), py);
    for (int i = 1; i <= n; i++)
    {
        double nh = hd + sp * span / n;
        bool jump = false;
        if (loops)
        {
            if (nh > b)
            {
                nh = a + modp (nh - a, L);
                jump = true;
            }
            else if (nh < a && sp < 0)
            {
                nh = b - modp (a - nh, L);
                jump = true;
            }
        }
        else
            nh = clamp (nh, 0, flen);
        hd = nh;
        const double x = X ((double) i / n * span), y = Y (hd);
        if (jump)
        {
            c.stroke();
            c.setLineDash ({ 2, 2 });
            c.setStroke ("rgba(255,255,255,.25)");
            c.beginPath();
            c.moveTo (x, py);
            c.lineTo (x, y);
            c.stroke();
            c.setLineDash ({});
            c.setStroke (cl.t);
            c.beginPath();
            c.moveTo (x, y);
        }
        else
            c.lineTo (x, y);
        py = y;
    }
    c.stroke();
    if (in.headLive)
        dot (c, X (std::min (in.now - in.keyDownAt, span)), Y (in.head), 3.2, in.noteHead ? juce::String (HEAD_COL) : juce::String ("#fff"));
    c.setFill (cl.t3);
    c.fillText ("TIME MAP", 8, 11);
    c.textAlign = "right";
    c.fillText (std::isfinite (per) ? "wraps every " + fmtS (per) : juce::String ("frozen"), w - 8, 11);
    c.fillText (fmtS (span) + U (" →"), w - 8, h - 3);
    c.textAlign = "left";
    c.fillText ("key down", 8, h - 3);
}

// ──────────────────────────────────────────────────────── the engine's close-up

// gsDrawLens
void lens (c2d::Context& c, float wf, float hf, const Inputs& in, State& st)
{
    const double w = wf, h = hf;
    const Pcm* pcm = pcmFor (in, st);
    const auto& cl = in.cl;
    const auto& e = in.engine;
    st.drawnLens++;
    c.clearRect (0, 0, w, h);
    picLabel (c, w, cl, lensLabel (in), e == "granular" ? U ("read position ↑ · time →") : juce::String());
    if (e == "granular")
    {
        lensSchedule (c, w, h, cl, in);
        return;
    }
    if (!pcm)
    {
        picNote (c, h, cl, noteFor (in));
        return;
    }
    const double head = in.head;
    if (e == "wsola")
        lensSplice (c, w, h, cl, *pcm, head, in);
    else if (e == "hybrid")
        lensSeparation (c, w, h, *pcm, head, in, st);
    else
        lensFrame (c, w, h, cl, *pcm, head, in, st);
}

// ─────────────────────────────────────────────────── before and after the chain

// gsDrawFxWave: before the chain, thin and grey, and after it, bright and
// filled, on one scale. Stopped there is no after; before is then the loop
// itself.
void fxWave (c2d::Context& c, float wf, float hf, const Inputs& in, State& st, const FxMeters& m)
{
    const double w = wf, h = hf;
    const auto& cl = in.cl;
    using Fn = std::function<double (double)>;
    auto read = [] (const std::vector<float>& xy) -> Fn {
        if (xy.size() < 8)
            return {};
        return [&xy] (double u) {
            const double n = (double) xy.size() / 2, i = std::min (n - 1, std::floor (u * n));
            const size_t k = (size_t) (i * 2);
            return (double) xy[k] + (double) xy[k + 1];
        };
    };
    Fn pre = read (m.preLissajous);
    double peak = 0.05;
    juce::String label = "LIVE";
    const Fn post = read (m.lissajous);
    const Pcm* pcm = pcmFor (in, st);
    if (!post && pcm)
    {
        const double a = in.loopA, b = in.loopB;
        const long long i0 = (long long) std::floor (a * pcm->sr), N = std::max (1LL, (long long) std::floor ((b - a) * pcm->sr));
        pre = [pcm, i0, N] (double u) { return pcm->at (i0 + (long long) std::floor (u * (double) N)) / pcm->peak * 1.6; };
        label = "the loop";
    }
    else if (!post)
        label = "";
    const int pts = 700;
    auto measure = [&] (const Fn& fn) {
        for (int i = 0; i <= pts; i++)
            peak = std::max (peak, std::abs (fn ((double) i / pts)));
    };
    if (pre)
        measure (pre);
    if (post)
        measure (post);
    auto curve = [&] (const Fn& fn) { return path ([&] (double u) { return Pt { 8 + u * (w - 16), h / 2 - fn (u) / peak * h * 0.42 }; }, pts); };
    c.setFill ("rgba(255,255,255,.05)");
    c.fillRect (8, h / 2, w - 16, 1);
    if (pre)
    {
        c.setStroke ("rgba(150,160,182,.45)");
        c.lineWidth = 0.8f;
        c.stroke (curve (pre));
    }
    if (post)
    {
        const auto p = curve (post);
        c2d::Path f (p);
        f.lineTo (w - 8, h / 2);
        f.lineTo (8, h / 2);
        c.setFill (bloomA (cl, ".12"));
        c.fill (f);
        trace (c, p, cl, 1.2, 0.8);
    }
    c.font = "9px " + cl.mono;
    c.setFill ("rgba(150,160,182,.8)");
    c.fillText ("before", 10, 11);
    if (post)
    {
        c.setFill (cl.t);
        c.fillText ("after", 54, 11);
    }
    c.setFill (cl.t3);
    c.textAlign = "right";
    c.fillText (label, w - 8, 11);
    c.textAlign = "left";
}

// gsDrawFxSpectrum
void fxSpectrum (c2d::Context& c, float wf, float hf, const Inputs& in, State& st, const FxMeters& m)
{
    const double w = wf, h = hf;
    const auto& cl = in.cl;
    using Fn = std::function<double (double)>;
    auto X = [&] (double u) { return 8 + u * (w - 16); };
    auto Y = [&] (double v) { return h - 4 - clamp (v) * (h - 10); };
    auto read = [] (const std::vector<float>& b) -> Fn {
        if (b.empty())
            return {};
        return [&b] (double u) { return ((double) b[(size_t) std::min ((double) b.size() - 1, std::floor (u * (double) b.size()))] + 84) / 84; };
    };
    Fn before = read (m.preSpectrum);
    juce::String label = "LIVE";
    const Fn after = read (m.spectrum);
    const Pcm* pcm = pcmFor (in, st);
    if (!after && pcm)
    {
        const auto& sp = headBands (*pcm, in.head, st);
        before = [&sp] (double u) { return sp[(size_t) clamp (jsRound (std::log (20 * std::pow (1000.0, u) / 40) / std::log (500.0) * (NB - 1)), 0, NB - 1)] * 0.85; };
        label = "at the head";
    }
    else if (!after)
        label = "";
    c.font = "9px " + cl.mono;
    const std::pair<double, const char*> ticks[] = { { 100, "100" }, { 1000, "1k" }, { 10000, "10k" } };
    for (const auto& [f, tx] : ticks)
    {
        const double x = X (std::log (f / 20) / std::log (1000.0));
        c.setFill ("rgba(255,255,255,.07)");
        c.fillRect (x, 0, 1, h);
        c.setFill (cl.t3);
        c.fillText (tx, x + 3, h - 4);
    }
    if (before)
    {
        c.setStroke (bloomA (cl, ".28"));
        c.lineWidth = 1;
        c.stroke (path ([&] (double u) { return Pt { X (u), Y (before (u)) }; }, 300));
    }
    if (after)
    {
        const auto p = path ([&] (double u) { return Pt { X (u), Y (after (u)) }; }, 300);
        under (c, p, 8, w - 8, h, 0, cl, 0.14);
        trace (c, p, cl, 1.2, 0.6);
    }
    c.setFill (cl.t3);
    c.textAlign = "right";
    c.fillText (label, w - 8, 11);
    c.textAlign = "left";
}
} // namespace gpic
