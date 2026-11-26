// The Reverb window's drawings: ui/app/077-fx-reverb-window.js, line for line.
// See FxReverbDraw.h.
#include "FxReverbDraw.h"

#include "GrainGlyphs.h" // gg::jsString, gg::toFixed: numbers as JS writes them

#ifndef RVD_CONTEXT_STANDIN
#include "Canvas2D.h"
#endif

#include <algorithm>
#include <cmath>
#include <limits>
#include <regex>

// The context's number type: c2d's floats; the test's stand-in takes doubles.
#ifndef RVD_NUM
#define RVD_NUM float
#endif

namespace rvd
{
namespace
{
constexpr double PI = 3.14159265358979323846;
const double NaN = std::numeric_limits<double>::quiet_NaN();
const double Inf = std::numeric_limits<double>::infinity();

// the page's non-ASCII, as UTF-8
const std::string DOT = "\xc2\xb7";        // ·
const std::string SQRT = "\xe2\x88\x9a";   // √
const std::string MINUS = "\xe2\x88\x92";  // −
const std::string LR = "\xe2\x86\x94";     // ↔
const std::string PIc = "\xcf\x80";        // π
const std::string TIMES = "\xc3\x97";      // ×
const std::string SUP4 = "\xe2\x81\xb4";   // ⁴
const std::string SUP8 = "\xe2\x81\xb8";   // ⁸

bool has (const Values& v, const char* k) { return v.count (k) > 0; }
// v.k: NaN where the key is absent (undefined's arithmetic)
double g (const Values& v, const char* k)
{
    auto it = v.find (k);
    return it == v.end() ? NaN : it->second;
}
// v.k ?? d
double gd (const Values& v, const char* k, double d)
{
    auto it = v.find (k);
    return it == v.end() ? d : it->second;
}
// Math.max / Math.min: NaN in, NaN out
double mx (double a, double b) { return std::isnan (a) || std::isnan (b) ? NaN : (a > b ? a : b); }
double mn (double a, double b) { return std::isnan (a) || std::isnan (b) ? NaN : (a < b ? a : b); }
double mn (double a, double b, double c) { return mn (mn (a, b), c); }
double jsRound (double x) { return std::floor (x + 0.5); }
std::string num (double x) { return gg::jsString (x); }

// The context, with the page's numbers handed over as the context takes them.
struct Pen
{
    c2d::Context& c;
    using N = RVD_NUM;
    static N n (double x) { return static_cast<N> (x); }

    void fillStyle (const std::string& s) { c.setFill (s); }
    void strokeStyle (const std::string& s) { c.setStroke (s); }
    void lineWidth (double x) { c.lineWidth = n (x); }
    void lineCap (const char* s) { c.lineCap = s; }
    void font (const char* s) { c.font = s; }
    void setLineDash (std::vector<float> d) { c.setLineDash (std::move (d)); }

    void save() { c.save(); }
    void restore() { c.restore(); }
    void scale (double x, double y) { c.scale (n (x), n (y)); }
    void beginPath() { c.beginPath(); }
    void closePath() { c.closePath(); }
    void moveTo (double x, double y) { c.moveTo (n (x), n (y)); }
    void lineTo (double x, double y) { c.lineTo (n (x), n (y)); }
    void bezierCurveTo (double a, double b, double cc, double d, double x, double y) { c.bezierCurveTo (n (a), n (b), n (cc), n (d), n (x), n (y)); }
    void quadraticCurveTo (double a, double b, double x, double y) { c.quadraticCurveTo (n (a), n (b), n (x), n (y)); }
    void arc (double x, double y, double r, double a0, double a1) { c.arc (n (x), n (y), n (r), n (a0), n (a1)); }
    void ellipse (double x, double y, double rx, double ry, double rot, double a0, double a1) { c.ellipse (n (x), n (y), n (rx), n (ry), n (rot), n (a0), n (a1)); }
    void fill() { c.fill(); }
    void stroke() { c.stroke(); }
    void clip() { c.clip(); }
    void fillRect (double x, double y, double w, double h) { c.fillRect (n (x), n (y), n (w), n (h)); }
    void clearRect (double x, double y, double w, double h) { c.clearRect (n (x), n (y), n (w), n (h)); }
    void fillText (const std::string& s, double x, double y) { c.fillText (s, n (x), n (y)); }
    double measureText (const std::string& s) { return (double) c.measureText (s); }
};

const char* const MONO9 = "9px JetBrains Mono, monospace";
} // namespace

const std::vector<std::string> RV_SHAPES = { "Room", "Hall", "Cathedral", "Dome", "Chamber", "Plate" };

double rvR01 (double v, double lo, double hi) { return mx (0, mn (1, (v - lo) / (hi - lo))); }
std::vector<double> rvSeries (int n, double r, double base)
{
    std::vector<double> out;
    for (int k = 0; k < n; k++)
        out.push_back (base * std::pow (r, k));
    return out;
}
std::vector<double> rvSmLens (const Values& v, int n, double pow)
{
    const double r = 1 - std::pow (0.007071 * g (v, "spacing"), 3);
    const double base = 0.3 + 0.7 * std::sqrt (rvR01 (g (v, "delayMs"), 0, 2000));
    return rvSeries (n, std::pow (r, pow), base);
}

Spec rvNet (const std::string& id, const Values& v)
{
    using Map = std::vector<std::string>;
    auto lr = [] (int n) { Map m; for (int k = 0; k < n; k++) m.push_back (k % 2 ? "R" : "L"); return m; };
    auto rl = [] (int n) { Map m; for (int k = 0; k < n; k++) m.push_back (k % 2 ? "L" : "R"); return m; };
    const double dens = has (v, "density") ? g (v, "density") / 100 : 0.6;
    auto AP = [] (int n, int k = 1) { Column c; c.t = "ap"; c.n = n; c.k = k; return c; };
    auto MX = [] (int n, const char* kind, int stages = 0) { Column c; c.t = "mix"; c.n = n; c.kind = kind; c.stages = stages; return c; };
    auto IO = [] (const char* t, int n, Map map) { Column c; c.t = t; c.n = n; c.map = std::move (map); return c; };
    auto IN = [&] (int n, Map map) { return IO ("in", n, std::move (map)); };
    auto OUT = [&] (int n, Map map) { return IO ("out", n, std::move (map)); };
    auto DL = [] (int n, std::vector<double> len, double w, bool comb = false) { Column c; c.t = "delay"; c.n = n; c.len = std::move (len); c.w = w; c.comb = comb; return c; };
    auto T = [] (const char* t, int n, bool pairs = false) { Column c; c.t = t; c.n = n; c.pairs = pairs; return c; };
    auto every = [] (const std::vector<double>& a, int m, int r) { std::vector<double> o; for (size_t i = 0; i < a.size(); i++) if ((int) i % m == r) o.push_back (a[i]); return o; };
    auto slice = [] (const std::vector<double>& a, size_t b, size_t e) { std::vector<double> o; for (size_t i = b; i < std::min (e, a.size()); i++) o.push_back (a[i]); return o; };
    const Map LRm = { "L", "R" }, LRLR = { "L", "R", "L", "R" };
    auto fb = [] (int from, int to, std::string label, bool crossed = false) { return Feedback { from, to, std::move (label), crossed }; };

    if (id == "sm-gemini") return { { IN (16, lr (16)), DL (16, rvSmLens (v, 16, 1), 3), MX (16, "butterfly", 4), OUT (16, lr (16)) }, { fb (2, 1, SQRT + "f") }, dens, "" };
    if (id == "sm-hydra") return { { IN (8, lr (8)), DL (8, every (rvSmLens (v, 16, 1), 2, 0), 3), MX (8, "butterfly", 3), AP (8), MX (8, "butterfly", 3), OUT (8, LRm) }, { fb (4, 1, SQRT + "f") }, dens, "" };
    if (id == "sm-centaurus") return { { IN (4, LRLR), AP (4), MX (4, "butterfly", 2), AP (4), MX (4, "butterfly", 2), AP (4), MX (4, "butterfly", 2), AP (4), MX (4, "butterfly", 2), OUT (4, LRm) }, {}, dens, MINUS + "g" + SUP4 + " direct" };
    if (id == "sm-sagittarius")
    {
        std::vector<Column> c = { IN (2, LRm) };
        for (int i = 0; i < 8; i++) c.push_back (AP (2)), c.push_back (MX (2, "rot"));
        c.push_back (OUT (2, LRm));
        return { c, {}, dens, MINUS + "g" + SUP8 + " direct" };
    }
    if (id == "sm-great-annihilator") return { { IN (4, LRLR), DL (4, slice (rvSmLens (v, 16, 4), 0, 4), 2.4), MX (4, "butterfly", 2), AP (4), MX (4, "butterfly", 2), AP (4), MX (4, "butterfly", 2), AP (4), MX (4, "butterfly", 2), OUT (4, LRm) }, { fb (8, 1, "f") }, dens, "" };
    if (id == "sm-andromeda")
    {
        std::vector<Column> c = { IN (2, LRm), DL (2, rvSmLens (v, 2, 1), 2.4), MX (2, "rot") };
        for (int i = 0; i < 7; i++) c.push_back (AP (2)), c.push_back (MX (2, "rot"));
        c.push_back (OUT (2, LRm));
        return { c, { fb ((int) c.size() - 2, 1, "g") }, dens, "" };
    }
    if (id == "sm-lyra") return { { IN (4, lr (4)), DL (4, rvSmLens (v, 4, 4), 4), MX (4, "butterfly", 2), OUT (4, lr (4)) }, { fb (2, 1, SQRT + "f") }, dens, "" };
    if (id == "sm-capricorn") return { { IN (8, lr (8)), DL (8, rvSmLens (v, 8, 2), 4), MX (8, "butterfly", 3), OUT (8, lr (8)) }, { fb (2, 1, SQRT + "f") }, dens, "" };
    if (id == "sm-triangulum")
    {
        std::vector<Column> c = { IN (2, LRm) };
        for (int i = 0; i < 7; i++) c.push_back (AP (2)), c.push_back (MX (2, "rot"));
        c.push_back (DL (2, slice (rvSmLens (v, 16, 1), 14, 16), 2)), c.push_back (T ("filter", 2)), c.push_back (OUT (2, LRm));
        return { c, { fb ((int) c.size() - 2, 1, "f " + DOT + " L" + LR + "R", true) }, dens, "" };
    }
    if (id == "sm-lmc") return { { IN (4, LRLR), AP (4), MX (4, "butterfly", 2), AP (4), MX (4, "butterfly", 2), AP (4), MX (4, "butterfly", 2), DL (4, every (rvSmLens (v, 16, 1), 4, 3), 2.2), T ("filter", 4), MX (4, "householder"), OUT (4, LRm) }, { fb (9, 1, "f") }, dens, "" };
    if (id == "sm-cirrus-major") return { { IN (8, rl (8)), T ("filter", 8), DL (8, every (rvSmLens (v, 16, 1), 2, 0), 3), AP (8), MX (8, "butterfly", 3), MX (8, "perm"), OUT (8, LRm) }, { fb (5, 1, SQRT + "f " + DOT + " " + PIc) }, dens, "" };
    if (id == "sm-cirrus-minor") return { { IN (8, rl (8)), DL (8, rvSmLens (v, 8, 2), 3.4), T ("filter", 8), MX (8, "butterfly", 3), MX (8, "perm"), OUT (8, LRm) }, { fb (4, 1, SQRT + "f " + DOT + " " + PIc) }, dens, "" };
    if (id == "freeverb")
    {
        const double L[] = { 1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617 };
        std::vector<double> all (std::begin (L), std::end (L)), len;
        for (double x : L) all.push_back (x + 23);
        for (double x : all) len.push_back ((x / 1640) * (0.55 + 0.45 * g (v, "roomSize")));
        return { { IN (2, LRm), T ("sum", 1), T ("split", 16), DL (16, len, 3.2, true), T ("sum", 2), AP (2, 4), MX (2, "rot"), OUT (2, LRm) }, {}, 1 - g (v, "width") * 0.6, "" };
    }
    if (id == "jcrev")
    {
        const double C[] = { 0.0297, 0.0371, 0.0411, 0.0437 };
        std::vector<double> len;
        for (int r = 0; r < 2; r++) for (double x : C) len.push_back (x / 0.0437);
        return { { IN (2, LRm), T ("split", 8, true), DL (8, len, 3.4, true), T ("sum", 2), AP (2, 2), OUT (2, LRm) }, {}, 0, "" };
    }
    if (id == "ambient-fdn")
    {
        const double TN[] = { 0.153129, 0.210389, 0.127837, 0.256891, 0.174713, 0.192303, 0.125, 0.219991 };
        const double sf = g (v, "size") / 100 * 0.95 + 0.05;
        std::vector<double> len;
        for (double t : TN) len.push_back ((t / 0.256891) * (0.3 + 0.7 * sf));
        return { { IN (2, LRm), T ("taps", 2), T ("split", 8), DL (8, len, 3), AP (8), MX (8, "hadamard"), T ("filter", 8), OUT (8, LRm) }, { fb (6, 3, "g" + DOT + "shelf" + DOT + "LP") }, 1, "" };
    }
    if (id == "schroeder-reverb")
    {
        const double C[] = { 29.7, 37.1, 41.1, 43.7 };
        std::vector<double> all (std::begin (C), std::end (C)), len;
        for (double x : C) all.push_back (x * (1 + g (v, "spread")));
        for (double x : all) len.push_back ((x / 52) * mn (1, 0.35 + 0.08 * g (v, "size")));
        return { { IN (2, LRm), DL (2, { 0.15, 0.15 }, 0.8), T ("split", 8, true), DL (8, len, 3, true), T ("sum", 2), AP (2, 2), OUT (2, LRm) }, {}, 0, "" };
    }
    if (id == "moorer-reverb")
    {
        const double C[] = { 50, 56, 61, 68, 72, 78 };
        std::vector<double> len;
        for (int r = 0; r < 2; r++) for (double x : C) len.push_back ((x / 80) * mn (1, 0.35 + 0.08 * g (v, "size")));
        return { { IN (2, LRm), T ("taps", 2), T ("split", 12, true), DL (12, len, 3, true), T ("filter", 12), T ("sum", 2), AP (2, 1), OUT (2, LRm) }, {}, 0, "" };
    }
    if (id == "dattorro-plate")
        return { { IN (2, LRm), T ("sum", 1), T ("filter", 1), AP (1, 4), T ("split", 2), AP (2, 1), DL (2, { 0.85, 0.72 }, 1.6), T ("filter", 2), AP (2, 1), DL (2, { 0.7, 0.6 }, 1.4), OUT (2, LRm) }, { fb (9, 5, "decay " + DOT + " " + TIMES, true) }, 0, "" };
    if (id == "hp-hall" || id == "hp-medium-room")
        return { { IN (2, LRm), AP (2, 3), T ("split", 4, true), DL (4, id == "hp-hall" ? std::vector<double> { 0.95, 0.82, 0.88, 0.75 } : std::vector<double> { 0.6, 0.5, 0.55, 0.45 }, 2.6), MX (4, "butterfly", 2), T ("filter", 4), OUT (4, LRm) }, { fb (5, 3, "feedback") }, gd (v, "diffusion", 100) / 200, "" };
    if (id == "lxp-chamber" || id == "lxp-hall" || id == "lxp-plate" || id == "lxp-room")
    {
        const double s = rvR01 (g (v, "sizeM"), 3, 60);
        std::vector<double> len;
        for (double x : { 0.9, 0.78, 0.84, 0.7 }) len.push_back (x * (0.35 + 0.65 * s));
        return { { IN (2, LRm), T ("taps", 2), AP (2, 2), T ("split", 4, true), DL (4, len, 2.6), MX (4, "hadamard"), T ("filter", 4), OUT (4, LRm) }, { fb (6, 4, "RT " + DOT + " bass " + DOT + " hi-cut") }, gd (v, "diffusion", 60) / 100, "" };
    }
    if (id == "convolution")
    {
        Column ir = T ("ir", 2);
        ir.w = 6;
        return { { IN (2, LRm), ir, OUT (2, LRm) }, {}, 0, "" };
    }
    if (id == "allpass-diffuser") return { { IN (2, LRm), AP (2, 1), OUT (2, LRm) }, {}, 0, "" };
    return { { IN (2, LRm), OUT (2, LRm) }, {}, 0, "" };
}

std::vector<double> rvLanesY (int n, double top, double bot)
{
    if (n == 1) return { (top + bot) / 2 };
    std::vector<double> out;
    for (int i = 0; i < n; i++)
        out.push_back (top + (bot - top) * ((double) i / (n - 1)));
    return out;
}

void rvDrawNet (c2d::Context& context, double w, double h, const Spec& spec, const NetOptions& opt, const Colours& RV_COL)
{
    Pen ctx { context };
    const double e = opt.e, t = opt.t, mod = opt.mod, rate = opt.rate;
    const bool ice = opt.ice, small = opt.small;
    const std::string rgb = ice ? RV_COL.ice : RV_COL.accent;
    ctx.clearRect (0, 0, w, h);
    const double padX = small ? 10 : 16, top = small ? 8 : 30, bot = h - (small ? 12 : 26);
    std::vector<double> weights;
    for (const auto& c : spec.cols)
    {
        double wt = 1;
        if (c.w) wt = *c.w;
        else if (c.t == "in" || c.t == "out") wt = 0.5;
        else if (c.t == "mix") wt = 0.9;
        else if (c.t == "ap") wt = 0.8 + 0.25 * ((c.k ? c.k : 1) - 1);
        else if (c.t == "filter" || c.t == "sum" || c.t == "split") wt = 0.7;
        else if (c.t == "taps") wt = 0.8;
        else if (c.t == "delay") wt = 2;
        else if (c.t == "ir") wt = 6;
        weights.push_back (wt);
    }
    double total = 0;
    for (double x : weights) total = total + x;
    const double span = w - 2 * padX;
    double x = padX;
    struct Col
    {
        const Column* c;
        double x0, x1;
        std::vector<double> ys;
    };
    std::vector<Col> cols;
    for (size_t i = 0; i < spec.cols.size(); i++)
    {
        const auto& c = spec.cols[i];
        const double cw = span * weights[i] / total;
        cols.push_back ({ &c, x, x + cw, rvLanesY (c.n, top, bot) });
        x += cw;
    }
    auto wob = [&] (int k) { return mod * std::sin (2 * PI * rate * t + (k * PI) / 8) * (small ? 0.8 : 2.2); };
    auto lineCol = [&] (double a) { return "rgba(" + rgb + "," + num (a) + ")"; };
    ctx.lineCap ("round");
    // links between columns
    for (size_t i = 0; i + 1 < cols.size(); i++)
    {
        const auto& a = cols[i];
        const auto& b = cols[i + 1];
        ctx.strokeStyle (lineCol (0.18 + 0.5 * e));
        ctx.lineWidth (small ? 0.7 : 1);
        const auto& from = a.ys;
        const auto& to = b.ys;
        if (from.size() == to.size())
        {
            for (size_t k = 0; k < from.size(); k++)
            {
                const double y = from[k];
                if (a.c->t == "mix" || b.c->t == "mix") continue;
                ctx.beginPath(); ctx.moveTo (a.x1, y + wob ((int) k)); ctx.lineTo (b.x0, to[k] + wob ((int) k)); ctx.stroke();
            }
        }
        else
        {
            // join or fan: each source lane to its share of the targets
            const double nf = (double) from.size(), nt = (double) to.size();
            for (size_t k = 0; k < from.size(); k++)
            {
                const double y = from[k];
                std::vector<double> targets;
                if (to.size() > from.size())
                {
                    for (size_t j = 0; j < to.size(); j++)
                        if (b.c->pairs ? std::floor ((double) j / (nt / nf)) == (double) k : j % from.size() == k)
                            targets.push_back (to[j]);
                }
                else
                    targets.push_back (to[(size_t) std::floor ((double) k * nt / nf)]);
                for (double ty : targets)
                {
                    ctx.beginPath(); ctx.moveTo (a.x1, y); ctx.bezierCurveTo ((a.x1 + b.x0) / 2, y, (a.x1 + b.x0) / 2, ty, b.x0, ty); ctx.stroke();
                }
            }
        }
    }
    // columns
    for (const auto& col : cols)
    {
        const Column& c = *col.c;
        const auto& ys = col.ys;
        const double cw = col.x1 - col.x0, cx = (col.x0 + col.x1) / 2;
        const int n = (int) ys.size();
        if (c.t == "in" || c.t == "out")
        {
            const auto ends = c.t == "in" ? ys : rvLanesY (2, top + (bot - top) * 0.25, bot - (bot - top) * 0.25);
            const char* const LRs[] = { "L", "R" };
            if (c.t == "out")
            {
                for (int k = 0; k < n; k++)
                {
                    const double y = ys[(size_t) k];
                    if ((size_t) k >= c.map.size() || c.map[(size_t) k].empty()) continue;
                    const double ty = c.map[(size_t) k] == "L" ? ends[0] : ends[1];
                    ctx.strokeStyle (lineCol (0.25 + 0.6 * e)); ctx.lineWidth (small ? 0.7 : 1); ctx.beginPath(); ctx.moveTo (col.x0, y + wob (k)); ctx.bezierCurveTo (cx, y, cx, ty, col.x1, ty); ctx.stroke();
                }
                for (int k = 0; k < 2; k++)
                {
                    ctx.fillStyle (lineCol (0.5 + 0.5 * e)); ctx.beginPath(); ctx.arc (col.x1, ends[(size_t) k], small ? 1.8 : 2.6, 0, 7); ctx.fill();
                    if (!small) { ctx.fillStyle (RV_COL.text); ctx.font (MONO9); ctx.fillText (LRs[k], col.x1 + 4, ends[(size_t) k] + 3); }
                }
            }
            else
            {
                const auto src = rvLanesY (2, top + (bot - top) * 0.25, bot - (bot - top) * 0.25);
                for (int k = 0; k < n; k++)
                {
                    const double y = ys[(size_t) k];
                    const double s = (size_t) k < c.map.size() && c.map[(size_t) k] == "L" ? src[0] : src[1];
                    ctx.strokeStyle (lineCol (0.22 + 0.5 * e)); ctx.lineWidth (small ? 0.7 : 1); ctx.beginPath(); ctx.moveTo (col.x0, s); ctx.bezierCurveTo (cx, s, cx, y, col.x1, y + wob (k)); ctx.stroke();
                }
                for (int k = 0; k < 2; k++)
                {
                    ctx.fillStyle (lineCol (0.85)); ctx.beginPath(); ctx.arc (col.x0, src[(size_t) k], small ? 1.8 : 2.6, 0, 7); ctx.fill();
                    if (!small) { ctx.fillStyle (RV_COL.text); ctx.font (MONO9); ctx.fillText (LRs[k], col.x0 - 10, src[(size_t) k] + 3); }
                }
            }
        }
        else if (c.t == "delay")
        {
            const double bh = mx (1.4, mn (small ? 2 : 4, (bot - top) / c.n * 0.42));
            for (int k = 0; k < n; k++)
            {
                const double lenK = (size_t) k < c.len.size() ? c.len[(size_t) k] : NaN;
                const double y = ys[(size_t) k] + wob (k), L = mx (0.04, mn (1, (size_t) k < c.len.size() ? lenK : 0.5)) * cw;
                ctx.fillStyle (RV_COL.dimmer()); ctx.fillRect (col.x0, y - bh / 2, cw, bh);
                ctx.fillStyle (lineCol (0.25 + 0.6 * e)); ctx.fillRect (col.x0, y - bh / 2, L, bh);
                // the pulse: along the bar at this line's own speed
                if (e > 0.02)
                {
                    const double ph = std::fmod ((t * 0.9) / mx (0.15, lenK) + k * 0.37, 1.0);
                    ctx.fillStyle ("rgba(" + rgb + "," + num (mn (1, 0.4 + e)) + ")"); ctx.beginPath(); ctx.arc (col.x0 + ph * L, y, bh * 0.9, 0, 7); ctx.fill();
                }
                if (c.comb) { ctx.strokeStyle (lineCol (0.15 + 0.4 * e)); ctx.lineWidth (small ? 0.6 : 0.8); ctx.beginPath(); ctx.moveTo (col.x0 + L, y); ctx.quadraticCurveTo (col.x0 + L + 4, y - bh * 2.2, col.x0 + L / 2, y - bh * 1.6); ctx.stroke(); }
                ctx.strokeStyle (lineCol (0.18 + 0.4 * e)); ctx.lineWidth (small ? 0.6 : 0.8); ctx.beginPath(); ctx.moveTo (col.x0 + L, y); ctx.lineTo (col.x1, y); ctx.stroke();
            }
        }
        else if (c.t == "ap")
        {
            const int k = c.k ? c.k : 1;
            const double rr = mx (1.6, mn (small ? 2.6 : 5, (bot - top) / c.n * 0.38, cw / (k * 2.6)));
            for (int lane = 0; lane < n; lane++)
            {
                const double y = ys[(size_t) lane] + wob (lane);
                ctx.strokeStyle (lineCol (0.2 + 0.4 * e)); ctx.lineWidth (small ? 0.6 : 0.8); ctx.beginPath(); ctx.moveTo (col.x0, y); ctx.lineTo (col.x1, y); ctx.stroke();
                for (int j = 0; j < k; j++)
                {
                    const double rx = col.x0 + cw * (j + 0.5) / k;
                    ctx.fillStyle (RV_COL.well); ctx.beginPath(); ctx.arc (rx, y, rr, 0, 7); ctx.fill(); ctx.strokeStyle (lineCol (0.45 + 0.55 * e)); ctx.lineWidth (small ? 0.8 : 1.2); ctx.stroke();
                }
            }
        }
        else if (c.t == "mix")
        {
            const double a = 0.06 + 0.8 * spec.dens * (0.4 + 0.6 * e);
            ctx.lineWidth (small ? 0.6 : 0.8);
            if (c.kind == "butterfly" || c.kind == "rot")
            {
                const int stages = c.kind == "rot" ? 1 : c.stages;
                const double sw = cw / stages;
                for (int s = 0; s < stages; s++)
                {
                    const int stride = 1 << s;
                    const double xa = col.x0 + s * sw, xb = xa + sw;
                    for (int j = 0; j < n; j++)
                    {
                        const double y = ys[(size_t) j];
                        const int p = j ^ stride;
                        const double yp = p < n ? ys[(size_t) p] : y;
                        ctx.strokeStyle (lineCol (0.18 + 0.5 * e * (1 - spec.dens * 0.6))); ctx.beginPath(); ctx.moveTo (xa, y + wob (j)); ctx.lineTo (xb, y + wob (j)); ctx.stroke();
                        if (p < n) { ctx.strokeStyle (lineCol (a)); ctx.beginPath(); ctx.moveTo (xa, y + wob (j)); ctx.lineTo (xb, yp + wob (p)); ctx.stroke(); }
                    }
                }
            }
            else if (c.kind == "hadamard")
            {
                for (int j = 0; j < n; j++)
                    for (double y2 : ys)
                    {
                        ctx.strokeStyle (lineCol (a * 0.55)); ctx.beginPath(); ctx.moveTo (col.x0, ys[(size_t) j] + wob (j)); ctx.lineTo (col.x1, y2); ctx.stroke();
                    }
            }
            else if (c.kind == "householder")
            {
                const double my = (top + bot) / 2;
                for (int j = 0; j < n; j++)
                {
                    const double y = ys[(size_t) j];
                    ctx.strokeStyle (lineCol (0.2 + 0.5 * e)); ctx.beginPath(); ctx.moveTo (col.x0, y + wob (j)); ctx.lineTo (col.x1, y + wob (j)); ctx.stroke(); ctx.strokeStyle (lineCol (a)); ctx.beginPath(); ctx.moveTo (col.x0, y); ctx.lineTo (cx, my); ctx.lineTo (col.x1, y); ctx.stroke();
                }
                ctx.fillStyle (lineCol (0.6 + 0.4 * e)); ctx.beginPath(); ctx.arc (cx, my, small ? 1.6 : 2.4, 0, 7); ctx.fill();
            }
            else if (c.kind == "perm")
            {
                const int PIx[] = { 7, 6, 1, 0, 3, 2, 5, 4 };
                for (int j = 0; j < n; j++)
                {
                    const double y = ys[(size_t) j];
                    const int ti = j < 8 ? PIx[j] : j;
                    const double to = ti < n ? ys[(size_t) ti] : NaN;
                    ctx.strokeStyle (lineCol (0.22 + 0.55 * e)); ctx.beginPath(); ctx.moveTo (col.x0, y + wob (j)); ctx.bezierCurveTo (cx, y, cx, to, col.x1, to); ctx.stroke();
                }
            }
        }
        else if (c.t == "filter")
        {
            for (int k = 0; k < n; k++)
            {
                const double y = ys[(size_t) k] + wob (k), fw = mn (cw * 0.7, small ? 7 : 12), fh = mn (small ? 3 : 5, (bot - top) / c.n * 0.4);
                ctx.strokeStyle (lineCol (0.2 + 0.4 * e)); ctx.lineWidth (small ? 0.6 : 0.8); ctx.beginPath(); ctx.moveTo (col.x0, y); ctx.lineTo (cx - fw / 2, y); ctx.moveTo (cx + fw / 2, y); ctx.lineTo (col.x1, y); ctx.stroke();
                ctx.strokeStyle ("rgba(" + (!RV_COL.on.empty() ? RV_COL.onRgb : rgb) + "," + num (0.55 + 0.4 * e) + ")"); ctx.lineWidth (small ? 0.8 : 1.1); ctx.beginPath(); ctx.moveTo (cx - fw / 2, y + fh / 2); ctx.quadraticCurveTo (cx - fw / 4, y - fh, cx, y - fh / 2); ctx.quadraticCurveTo (cx + fw / 4, y, cx + fw / 2, y + fh / 2); ctx.stroke();
            }
        }
        else if (c.t == "sum" || c.t == "split")
        {
            for (double y : ys) { ctx.strokeStyle (lineCol (0.2 + 0.4 * e)); ctx.lineWidth (small ? 0.6 : 0.8); ctx.beginPath(); ctx.moveTo (col.x0, y); ctx.lineTo (col.x1, y); ctx.stroke(); }
            if (c.t == "sum")
                for (double y : ys) { ctx.fillStyle (lineCol (0.5 + 0.5 * e)); ctx.beginPath(); ctx.arc (cx, y, small ? 1.5 : 2.2, 0, 7); ctx.fill(); }
        }
        else if (c.t == "taps")
        {
            for (double y : ys) { ctx.strokeStyle (lineCol (0.2 + 0.4 * e)); ctx.lineWidth (small ? 0.6 : 0.8); ctx.beginPath(); ctx.moveTo (col.x0, y); ctx.lineTo (col.x1, y); ctx.stroke(); }
            const int nt = small ? 9 : 18;
            const double ty = top - (small ? 3 : 9);
            for (int i = 0; i < nt; i++)
            {
                const double tx = col.x0 + cw * (0.08 + 0.84 * std::pow ((double) i / (nt - 1), 0.8));
                const double th = (small ? 4 : 9) * (1 - (double) i / nt) * (0.4 + 0.6 * e);
                ctx.strokeStyle (lineCol (0.35 + 0.5 * e)); ctx.beginPath(); ctx.moveTo (tx, ty + (small ? 5 : 11)); ctx.lineTo (tx, ty + (small ? 5 : 11) - th); ctx.stroke();
            }
        }
        else if (c.t == "ir")
        {
            for (int k = 0; k < n; k++)
            {
                const double y = ys[(size_t) k];
                ctx.strokeStyle (lineCol (0.3 + 0.5 * e)); ctx.lineWidth (small ? 0.6 : 0.8); ctx.beginPath();
                for (int i = 0; i <= 120; i++)
                {
                    const double u = i / 120.0, env = std::exp (-u * 4), nz = std::fmod (std::sin (i * 12.9898 + k * 7) * 43758.5453, 1.0);
                    const double yy = y - env * nz * (small ? 6 : 14);
                    if (i == 0) ctx.moveTo (col.x0 + u * cw, yy);
                    else ctx.lineTo (col.x0 + u * cw, yy);
                }
                ctx.stroke();
            }
        }
    }
    // feedback arcs, under the lanes
    for (const auto& f : spec.fb)
    {
        if (f.from < 0 || f.to < 0 || (size_t) f.from >= cols.size() || (size_t) f.to >= cols.size()) continue;
        const auto& a = cols[(size_t) f.from];
        const auto& b = cols[(size_t) f.to];
        const double y = bot + (small ? 6 : 14), x1 = a.x1, x0 = b.x0;
        ctx.setLineDash (small ? std::vector<float> { 2, 2 } : std::vector<float> { 3, 3 });
        ctx.strokeStyle (lineCol (0.25 + 0.65 * e)); ctx.lineWidth (small ? 0.8 : 1.2);
        ctx.beginPath(); ctx.moveTo (x1, bot); ctx.quadraticCurveTo (x1 + 6, y, (x0 + x1) / 2, y); ctx.quadraticCurveTo (x0 - 6, y, x0, bot); ctx.stroke();
        ctx.setLineDash ({});
        if (f.crossed && !small) { ctx.strokeStyle (lineCol (0.35 + 0.5 * e)); ctx.beginPath(); ctx.moveTo ((x0 + x1) / 2 - 4, y - 4); ctx.lineTo ((x0 + x1) / 2 + 4, y + 4); ctx.moveTo ((x0 + x1) / 2 + 4, y - 4); ctx.lineTo ((x0 + x1) / 2 - 4, y + 4); ctx.stroke(); }
        if (!small) { ctx.fillStyle ("rgba(" + rgb + ",0.9)"); ctx.font (MONO9); const double tw = ctx.measureText (f.label); ctx.fillText (f.label, (x0 + x1) / 2 - tw / 2, y + 10); }
    }
    if (!spec.note.empty() && !small) { ctx.fillStyle (RV_COL.text); ctx.font (MONO9); ctx.fillText (spec.note, w - padX - ctx.measureText (spec.note), h - 4); }
    if (ice && !small) { ctx.fillStyle ("rgba(" + RV_COL.ice + ",0.06)"); ctx.fillRect (0, 0, w, h); }
}

NetOptions rvFrameOptions (const Values& v, double e, double t, bool moving)
{
    NetOptions o;
    o.e = e;
    o.t = moving ? t : 0;
    o.ice = g (v, "freeze") >= 0.5;
    o.mod = moving ? (has (v, "modDepth") ? std::sqrt (g (v, "modDepth") / 100) : has (v, "spinHz") ? 0.4 : 0.15) : 0;
    o.rate = has (v, "modRateHz") ? g (v, "modRateHz") : gd (v, "spinHz", 0.5);
    return o;
}

void rvDrawThumb (c2d::Context& context, const std::string& modeId, const Values& defaults, const Colours& colours, double scale)
{
    Pen ctx { context };
    ctx.scale (scale, scale);
    NetOptions o;
    o.e = 0.6;
    o.t = 0.6;
    o.small = true;
    rvDrawNet (context, 64, 24, rvNet (modeId, defaults), o, colours);
}

void rvOverlay (c2d::Context& context, double w, double h, const Values& v, double e, const Colours& RV_COL)
{
    Pen ctx { context };
    auto hasK = [&] (const char* k) { return has (v, k); };
    auto col = [&] (double a) { return "rgba(" + RV_COL.accent + "," + num (a) + ")"; };
    // tone: a high-pass at the low cut, a low-pass at the high cut
    std::optional<double> lo, hi;
    if (hasK ("lowCutHz")) lo = g (v, "lowCutHz");
    if (hasK ("highCutHz")) hi = g (v, "highCutHz");
    else if (hasK ("rtHiCutHz")) hi = g (v, "rtHiCutHz");
    else if (hasK ("rolloffHz")) hi = g (v, "rolloffHz");
    else if (hasK ("highDampHz")) hi = g (v, "highDampHz");
    if (!hi && hasK ("damping")) hi = 20000 * std::pow (0.05, mn (1, g (v, "damping") > 1 ? g (v, "damping") / 100 : g (v, "damping")));
    if (!hi && hasK ("brightness")) hi = 1500 + 18500 * (g (v, "brightness") / 100);
    auto truthy = [] (const std::optional<double>& x) { return x && std::abs (*x) > 0; }; // JS truthiness: not 0, not NaN
    if (lo || hi)
    {
        const double bw = 132, bh = 34, x0 = w - bw - 10, y0 = h - bh - 18;
        ctx.fillStyle ("rgba(" + RV_COL.white + ",0.03)"); ctx.fillRect (x0, y0, bw, bh);
        ctx.strokeStyle (col (0.35 + 0.6 * e)); ctx.lineWidth (1.4); ctx.beginPath();
        for (int i = 0; i <= 60; i++)
        {
            const double f = 20 * std::pow (1000, i / 60.0);
            double gn = 1;
            if (truthy (lo)) gn *= 1 / std::sqrt (1 + std::pow (*lo / f, 2));
            if (truthy (hi)) gn *= 1 / std::sqrt (1 + std::pow (f / *hi, 2));
            const double y = y0 + bh - 3 - (bh - 6) * mx (0, 1 + std::log10 (mx (gn, 1e-3)) / 2);
            if (i) ctx.lineTo (x0 + (bw * i) / 60, y);
            else ctx.moveTo (x0, y);
        }
        ctx.stroke();
        ctx.fillStyle (RV_COL.text); ctx.font (MONO9);
        auto hz = [] (double x) { return x < 1000 ? num (jsRound (x)) : gg::toFixed (x / 1000, 1) + "k"; };
        ctx.fillText ("tone" + (truthy (lo) ? " " + DOT + " lo " + hz (*lo) : std::string()) + (truthy (hi) ? " " + DOT + " hi " + hz (*hi) : std::string()), x0, y0 - 3);
    }
    // width: the spread of the outputs, as an arc at the right
    std::optional<double> width;
    if (hasK ("width")) width = g (v, "width") >= -1.001 && g (v, "width") <= 1.001 && !hasK ("mix") ? g (v, "width") : (g (v, "width") + 100) / 200;
    else if (hasK ("wide")) width = g (v, "wide") / 200;
    else if (hasK ("spread")) width = g (v, "spread") > 1.001 ? g (v, "spread") / 100 : g (v, "spread") * 4;
    if (width)
    {
        const double cx = w - 12, cy = h / 2, r = mn (46, h * 0.22), span = mx (0.04, mn (1, *width)) * PI * 0.9;
        ctx.strokeStyle (col (0.3 + 0.6 * e)); ctx.lineWidth (3); ctx.lineCap ("round");
        ctx.beginPath(); ctx.arc (cx, cy, r, PI - span / 2, PI + span / 2); ctx.stroke(); ctx.lineCap ("butt");
    }
    // mix: the dry path beside the network, as bright as the dry is
    std::optional<double> dry;
    if (hasK ("mix")) dry = std::cos ((g (v, "mix") > 1.001 ? g (v, "mix") / 100 : g (v, "mix")) * PI / 2);
    else if (hasK ("dry")) dry = g (v, "dry") > 1.001 ? g (v, "dry") / 2 : mn (1, g (v, "dry"));
    else if (hasK ("dryDb")) dry = g (v, "dryDb") < -90 ? 0 : std::pow (10, g (v, "dryDb") / 20);
    if (dry)
    {
        ctx.strokeStyle ("rgba(" + RV_COL.white + "," + num (0.08 + 0.55 * *dry) + ")"); ctx.lineWidth (1.2); ctx.setLineDash ({ 5, 4 });
        ctx.beginPath(); ctx.moveTo (18, 10); ctx.lineTo (w - 18, 10); ctx.stroke(); ctx.setLineDash ({});
        ctx.fillStyle (RV_COL.text); ctx.font (MONO9); ctx.fillText ("dry " + num (jsRound (*dry * 100)) + "%", w / 2 - 18, 21);
    }
}

void rvDrawPadMark (c2d::Context& context, double w, double h, double xUnit, double yUnit, const Colours& RV_COL)
{
    Pen ctx { context };
    const double x = xUnit * w, y = (1 - yUnit) * h;
    ctx.strokeStyle ("rgba(" + RV_COL.white + ",.2)"); ctx.lineWidth (0.6); ctx.setLineDash ({ 2, 3 });
    ctx.beginPath(); ctx.moveTo (x, 0); ctx.lineTo (x, h); ctx.moveTo (0, y); ctx.lineTo (w, y); ctx.stroke(); ctx.setLineDash ({});
    ctx.fillStyle (RV_COL.on); ctx.beginPath(); ctx.arc (x, y, 3.5, 0, 7); ctx.fill();
}

// ── the room ────────────────────────────────────────────────────────────────
Plan rvPlan (int shape)
{
    switch (shape)
    {
        case 0: return { { { -0.5, 0 }, { 0.5, 0 }, { 0.5, 1.15 }, { -0.5, 1.15 } }, 0.32, false };
        case 1: return { { { -0.36, 0 }, { 0.36, 0 }, { 0.36, 1.7 }, { -0.36, 1.7 } }, 0.55, false };
        case 2: return { { { -0.2, 0 }, { 0.2, 0 }, { 0.2, 0.75 }, { 0.55, 0.75 }, { 0.55, 1.05 }, { 0.2, 1.05 }, { 0.2, 1.75 }, { -0.2, 1.75 }, { -0.2, 1.05 }, { -0.55, 1.05 }, { -0.55, 0.75 }, { -0.2, 0.75 } }, 1.0, false };
        case 3:
        {
            Plan p;
            for (int i = 0; i < 28; i++)
            {
                const double a = ((double) i / 28) * 2 * PI;
                p.pts.push_back ({ 0.55 * std::cos (a), 0.6 + 0.6 * std::sin (a) });
            }
            p.ceil = 0.85;
            return p;
        }
        case 4: return { { { -0.42, 0 }, { 0.38, 0 }, { 0.55, 0.45 }, { 0.32, 1.05 }, { -0.3, 1.12 }, { -0.55, 0.5 } }, 0.42, false };
        default: return { { { -0.75, 0.42 }, { 0.75, 0.42 }, { 0.75, 0.72 }, { -0.75, 0.72 } }, 0.06, true };
    }
}
V2 rvMirror (V2 p, V2 a, V2 b)
{
    const double dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const double t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
    const double fx = a[0] + t * dx, fy = a[1] + t * dy;
    return { 2 * fx - p[0], 2 * fy - p[1] };
}
std::optional<V2> rvCross (V2 p, V2 q, V2 a, V2 b)
{
    const V2 r = { q[0] - p[0], q[1] - p[1] }, s2 = { b[0] - a[0], b[1] - a[1] };
    const double d = r[0] * s2[1] - r[1] * s2[0];
    if (std::abs (d) < 1e-9) return std::nullopt;
    const double t = ((a[0] - p[0]) * s2[1] - (a[1] - p[1]) * s2[0]) / d, u = ((a[0] - p[0]) * r[1] - (a[1] - p[1]) * r[0]) / d;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) return V2 { p[0] + t * r[0], p[1] + t * r[1] };
    return std::nullopt;
}
namespace RV3
{
V3 add (V3 a, V3 b) { return { a[0] + b[0], a[1] + b[1], a[2] + b[2] }; }
V3 sub (V3 a, V3 b) { return { a[0] - b[0], a[1] - b[1], a[2] - b[2] }; }
V3 mul (V3 a, double k) { return { a[0] * k, a[1] * k, a[2] * k }; }
double dot (V3 a, V3 b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
V3 rvCross (V3 a, V3 b) { return { a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0] }; }
V3 norm (V3 a)
{
    double l = std::hypot (a[0], a[1], a[2]);
    if (!(l > 0)) l = 1; // `|| 1`: 0 or NaN
    return { a[0] / l, a[1] / l, a[2] / l };
}
} // namespace RV3
bool rvInside (const std::vector<V2>& poly, double x, double y)
{
    bool c = false;
    for (size_t i = 0, j = poly.size() - 1; i < poly.size(); j = i++)
    {
        const double xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if ((yi > y) != (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
}
World rvRoomWorld (const Values& v)
{
    World W;
    W.P = rvPlan ((int) jsRound (g (v, "roomShape")));
    const auto& P = W.P;
    W.depth = -Inf;
    double wideHalf = -Inf;
    for (const auto& q : P.pts) W.depth = mx (W.depth, q[1]), wideHalf = mx (wideHalf, std::abs (q[0]));
    W.wide = wideHalf * 2;
    W.H = P.plate ? 0.5 : 0.2 + 0.75 * P.ceil;
    W.listen = P.plate ? V3 { 0, 0.15, 0.25 } : V3 { 0, W.depth * 0.1, mn (0.13, W.H * 0.4) };
    const double d01 = 0.12 + 0.78 * g (v, "placeDist") / 100;
    W.src = P.plate
                ? V3 { g (v, "placePos") / 100 * 0.6, 0.57, 0.25 }
                : V3 { g (v, "placePos") / 100 * W.wide * 0.36, W.listen[1] + d01 * (W.depth - W.listen[1]) * 0.92, 0.03 + 0.9 * W.H * g (v, "placeHeight") / 100 };
    return W;
}
Camera rvCamera (double w, double h, const World& W, const Cam& RV_CAM)
{
    const V3 target = { 0, W.depth * 0.48, W.H * 0.3 };
    const double R = 1.55 * mx (mx (W.depth, W.wide), W.H * 1.4);
    const double cp = std::cos (RV_CAM.pitch);
    const V3 pos = RV3::add (target, { R * std::sin (RV_CAM.yaw) * cp, -R * std::cos (RV_CAM.yaw) * cp, R * std::sin (RV_CAM.pitch) });
    const V3 f = RV3::norm (RV3::sub (target, pos)), r = RV3::norm (RV3::rvCross (f, { 0, 0, 1 })), u = RV3::rvCross (r, f);
    // Frame the room: project its corners at unit scale, then fit them to the view.
    const Camera C { pos, f, r, u, 1, 0, 0 };
    std::vector<V3> corners;
    for (const auto& q : W.P.pts)
        for (double z : { 0.0, W.H }) corners.push_back ({ q[0], q[1], z });
    corners.push_back (W.listen);
    double x0 = Inf, x1 = -Inf, y0 = Inf, y1 = -Inf;
    for (const auto& p : corners)
    {
        const auto q = rvProj (C, p);
        if (!q) continue;
        x0 = mn (x0, (*q)[0]); x1 = mx (x1, (*q)[0]); y0 = mn (y0, (*q)[1]); y1 = mx (y1, (*q)[1]);
    }
    const double F = mn ((w - 40) / mx (1e-6, x1 - x0), (h - 52) / mx (1e-6, y1 - y0));
    return { pos, f, r, u, F, w / 2 - F * (x0 + x1) / 2, h / 2 + 4 - F * (y0 + y1) / 2 };
}
std::optional<V3> rvProj (const Camera& C, V3 p)
{
    const V3 d = RV3::sub (p, C.pos);
    const double z = RV3::dot (d, C.f);
    if (z < 0.05) return std::nullopt;
    return V3 { C.cx + (C.F * RV3::dot (d, C.r)) / z, C.cy - (C.F * RV3::dot (d, C.u)) / z, z };
}

std::string rvReadout (const Values& v)
{
    const bool on = g (v, "placeOn") >= 0.5;
    const double metres = jsRound (g (v, "roomSizeM") * (0.15 + 0.85 * g (v, "placeDist") / 100) * 0.7);
    if (!on) return "Place off: the mode exactly as measured";
    const double si = jsRound (g (v, "roomShape"));
    const std::string shape = si >= 0 && si < (double) RV_SHAPES.size() ? RV_SHAPES[(size_t) si] : "undefined";
    return shape + " " + DOT + " " + num (jsRound (g (v, "roomSizeM"))) + " m " + DOT + " the sound " + num (metres) + " m away, " + num (jsRound (g (v, "placeHeight"))) + "% up";
}

Room rvDrawRoom (c2d::Context& context, double w, double h, const Values& v, double e, double since, double t, const Colours& RV_COL, const Cam& cam)
{
    Pen ctx { context };
    ctx.clearRect (0, 0, w, h);
    const bool on = g (v, "placeOn") >= 0.5, ice = g (v, "freeze") >= 0.5;
    const std::string rgb = !on ? RV_COL.off : ice ? RV_COL.ice : RV_COL.accent;
    auto col = [&] (double a) { return "rgba(" + rgb + "," + num (a) + ")"; };
    Room RV_ROOM;
    RV_ROOM.W = rvRoomWorld (v);
    RV_ROOM.C = rvCamera (w, h, RV_ROOM.W, cam);
    const World& W = RV_ROOM.W;
    const Camera& C = RV_ROOM.C;
    const Plan& P = W.P;
    const double H = W.H;
    const auto& poly = P.pts;
    auto line = [&] (V3 a, V3 b, const std::string& style, double lw = 1) {
        const auto A = rvProj (C, a), B = rvProj (C, b);
        if (!A || !B) return;
        ctx.strokeStyle (style); ctx.lineWidth (lw); ctx.beginPath(); ctx.moveTo ((*A)[0], (*A)[1]); ctx.lineTo ((*B)[0], (*B)[1]); ctx.stroke();
    };
    auto path3 = [&] (const std::vector<V3>& pts) {
        ctx.beginPath();
        bool started = false;
        for (const auto& p : pts)
        {
            const auto q = rvProj (C, p);
            if (!q) continue;
            if (!started) { ctx.moveTo ((*q)[0], (*q)[1]); started = true; }
            else ctx.lineTo ((*q)[0], (*q)[1]);
        }
    };
    auto at = [&] (double z, bool close) {
        std::vector<V3> o;
        for (const auto& q : poly) o.push_back ({ q[0], q[1], z });
        if (close) o.push_back ({ poly[0][0], poly[0][1], z });
        return o;
    };
    const double floorZ = P.plate ? W.H * 0.5 : 0;
    // the floor, lit by the decay, with its 5 m grid
    path3 (at (floorZ, false)); ctx.closePath();
    ctx.fillStyle (col (0.04 + 0.2 * e)); ctx.fill();
    ctx.save(); ctx.clip();
    const double across = g (v, "roomSizeM") * (P.plate ? 0.25 : 1), step = W.wide / mx (1, across / 5);
    for (double x = -W.wide; x <= W.wide; x += step) line ({ x, -0.2, floorZ }, { x, W.depth + 0.2, floorZ }, col (0.08));
    for (double y = 0; y <= W.depth + 0.2; y += step) line ({ -W.wide, y, floorZ }, { W.wide, y, floorZ }, col (0.08));
    ctx.restore();
    const std::string edge = col (on ? 0.65 : 0.3);
    if (!P.plate)
    {
        // walls: their glow, their edges, and the ceiling's outline
        for (size_t i = 0; i < poly.size(); i++)
        {
            const auto& a = poly[i];
            const auto& b = poly[(i + 1) % poly.size()];
            path3 ({ { a[0], a[1], 0 }, { b[0], b[1], 0 }, { b[0], b[1], H }, { a[0], a[1], H } }); ctx.closePath();
            ctx.fillStyle (col (0.015 + 0.06 * e)); ctx.fill();
            line ({ a[0], a[1], 0 }, { a[0], a[1], H }, col (on ? 0.35 : 0.2));
        }
        path3 (at (0, true)); ctx.strokeStyle (edge); ctx.lineWidth (1.3); ctx.stroke();
        path3 (at (H, true)); ctx.strokeStyle (col (on ? 0.3 : 0.15)); ctx.lineWidth (1); ctx.stroke();
    }
    else
    {
        path3 (at (floorZ, true)); ctx.strokeStyle (edge); ctx.lineWidth (1.3); ctx.stroke();
        for (int k = 0; k < 11; k++)
        {
            const double x = -0.72 + k * 0.144;
            const double a = e * (0.5 + 0.5 * std::sin (t * 9 + k));
            line ({ x, 0.44, floorZ }, { x, 0.7, floorZ }, col (0.1 + 0.7 * a), 1.2);
        }
    }
    const V3 S = W.src, L = W.listen;
    const double speed = 0.9;
    auto okIn = [&] (V3 p) { return P.plate ? true : rvInside (poly, p[0], p[1]) && p[2] >= 0 && p[2] <= H; };
    // the tail: a sphere spreading from the sound
    for (int k = 0; k < 3; k++)
    {
        const double r = since * speed - k * 0.12;
        if (r <= 0) continue;
        const double a = mx (0, e * (1 - k * 0.25)) * mx (0, 1 - r / (mx (W.depth, W.wide) * 1.6));
        if (a < 0.01) continue;
        ctx.strokeStyle (col (0.06 + 0.6 * a)); ctx.lineWidth (1);
        for (int ring : { 0, 1, 2 })
        {
            ctx.beginPath();
            bool pen = false;
            for (int i = 0; i <= 64; i++)
            {
                const double th = ((double) i / 64) * PI * 2;
                const V3 p = ring == 0 ? V3 { S[0] + r * std::cos (th), S[1] + r * std::sin (th), S[2] } : ring == 1 ? V3 { S[0] + r * std::cos (th), S[1], S[2] + r * std::sin (th) } : V3 { S[0], S[1] + r * std::cos (th), S[2] + r * std::sin (th) };
                const auto q = okIn (p) ? rvProj (C, p) : std::nullopt;
                if (!q) { pen = false; continue; }
                if (!pen) { ctx.moveTo ((*q)[0], (*q)[1]); pen = true; }
                else ctx.lineTo ((*q)[0], (*q)[1]);
            }
            ctx.stroke();
        }
    }
    // first reflections from every wall, the floor and the ceiling, lit as they arrive
    auto flash = [&] (double d) { const double x = since - d; return x < 0 ? 0 : std::exp (-x * 6); };
    auto hyp = [] (V3 a) { return std::hypot (a[0], a[1], a[2]); };
    auto ray = [&] (V3 hit) {
        const double dl = hyp (RV3::sub (S, hit)) + hyp (RV3::sub (hit, L)), f = flash (dl / speed);
        line (S, hit, col (0.08 + 0.85 * f), 1); line (hit, L, col (0.08 + 0.85 * f), 1);
        const auto q = rvProj (C, hit);
        if (q) { ctx.fillStyle (col (0.25 + 0.75 * f)); ctx.beginPath(); ctx.arc ((*q)[0], (*q)[1], 2.2, 0, 7); ctx.fill(); }
    };
    if (!P.plate)
    {
        for (size_t i = 0; i < poly.size(); i++)
        {
            const auto& a = poly[i];
            const auto& b = poly[(i + 1) % poly.size()];
            const V2 m2 = rvMirror ({ S[0], S[1] }, a, b);
            const V3 img = { m2[0], m2[1], S[2] };
            const auto c2 = rvCross ({ L[0], L[1] }, { img[0], img[1] }, a, b);
            if (!c2) continue;
            const double tt = std::hypot ((*c2)[0] - L[0], (*c2)[1] - L[1]) / std::hypot (img[0] - L[0], img[1] - L[1]);
            const double z = L[2] + tt * (img[2] - L[2]);
            if (z < 0 || z > H) continue;
            ray ({ (*c2)[0], (*c2)[1], z });
        }
        for (double plane : { 0.0, H })
        {
            const V3 img = { S[0], S[1], 2 * plane - S[2] };
            const double tt = (plane - L[2]) / (img[2] - L[2]);
            const V3 hit = RV3::add (L, RV3::mul (RV3::sub (img, L), tt));
            if (rvInside (poly, hit[0], hit[1])) ray (hit);
        }
    }
    // the direct sound
    line (S, L, "rgba(" + RV_COL.white + "," + num (0.15 + 0.8 * flash (hyp (RV3::sub (S, L)) / speed)) + ")", 1.4);
    // you, and the width of the wet around you
    const double spread = (g (v, "placeSpread") / 200) * PI * 0.95, aim = PI / 2 - (g (v, "placePos") / 100) * 0.6;
    std::vector<V3> arcPts;
    for (int i = 0; i < 25; i++)
    {
        const double a = aim - spread / 2 + (spread * i) / 24;
        arcPts.push_back ({ L[0] + 0.09 * std::cos (a), L[1] + 0.09 * std::sin (a), L[2] });
    }
    path3 (arcPts);
    ctx.strokeStyle (col (0.3 + 0.7 * e)); ctx.lineWidth (3); ctx.lineCap ("round"); ctx.stroke(); ctx.lineCap ("butt");
    const auto Lq = rvProj (C, L);
    if (Lq)
    {
        ctx.fillStyle (RV_COL.textFull); ctx.beginPath(); ctx.arc ((*Lq)[0], (*Lq)[1], mx (3, 9 / (*Lq)[2] * 0.4), 0, 7); ctx.fill();
        const auto nose = rvProj (C, { L[0], L[1] + 0.05, L[2] });
        if (nose) line (L, { L[0], L[1] + 0.05, L[2] }, RV_COL.textFull, 2);
    }
    // the sound: its drop line and shadow, then itself
    line (S, { S[0], S[1], floorZ }, "rgba(" + RV_COL.onRgb + ",.45)", 1);
    const auto sh = rvProj (C, { S[0], S[1], floorZ });
    if (sh) { ctx.fillStyle ("rgba(" + RV_COL.onRgb + ",.18)"); ctx.beginPath(); ctx.ellipse ((*sh)[0], (*sh)[1], 8, 3, 0, 0, 7); ctx.fill(); }
    const auto Sq = rvProj (C, S);
    if (Sq)
    {
        const double rr = mx (4, 14 / (*Sq)[2] * 0.45) * (1 + 0.5 * flash (0));
        ctx.fillStyle (RV_COL.on); ctx.beginPath(); ctx.arc ((*Sq)[0], (*Sq)[1], rr, 0, 7); ctx.fill();
        RV_ROOM.Sq = V3 { (*Sq)[0], (*Sq)[1], rr };
    }
    RV_ROOM.readout = rvReadout (v);
    return RV_ROOM;
}

bool rvRoomOnSound (const Room& room, double x, double y)
{
    return room.Sq && std::hypot (x - (*room.Sq)[0], y - (*room.Sq)[1]) < (*room.Sq)[2] + 10;
}
void rvRoomTurn (Cam& cam, double dx, double dy)
{
    cam.yaw -= dx * 0.008;
    cam.pitch = mx (0.08, mn (1.35, cam.pitch + dy * 0.006));
}
double rvRoomDragHeight (double height, double dy) { return mx (0, mn (100, height - dy * 0.6)); }
bool rvRoomDragSound (const Room& room, double sx, double sy, double& pos, double& dist)
{
    const auto& W = room.W;
    const auto& C = room.C;
    const V3 d = RV3::add (RV3::add (C.f, RV3::mul (C.r, (sx - C.cx) / C.F)), RV3::mul (C.u, -(sy - C.cy) / C.F));
    if (std::abs (d[2]) < 1e-4) return false;
    const double tt = (W.src[2] - C.pos[2]) / d[2];
    if (tt <= 0) return false;
    const V3 p = RV3::add (C.pos, RV3::mul (d, tt));
    pos = mx (-100, mn (100, p[0] / (W.wide * 0.36) * 100));
    dist = mx (0, mn (100, ((p[1] - W.listen[1]) / ((W.depth - W.listen[1]) * 0.92) - 0.12) / 0.78 * 100));
    return true;
}

void Levels::step (double peakIn, double peakOut, double t)
{
    if (peakIn > 0.01 && peakIn > inPeak * 1.41 && t - pingAt > 0.09) pingAt = t;
    inPeak += (peakIn - inPeak) * (peakIn > inPeak ? 0.5 : 0.06);
    const double target = mx (0, mn (1, (20 * std::log10 (mx (peakOut, 1e-4)) + 60) / 60));
    e += (target - e) * 0.12;
}
double Levels::glow() const { return mx (0.06, e); }
bool Levels::moving() const { return e > 0.03; }

// ── Place and the band ─────────────────────────────────────────────────────
const std::vector<PlaceSpec>& RV_PLACE()
{
    static const std::vector<PlaceSpec> p = {
        { "on", "Place", 0, 1, 0, 0, "", false, true, {} },
        { "shape", "Shape", 0, 5, 1, 1, "", false, false, RV_SHAPES },
        { "sizeM", "Room size", 3, 80, 24, 0, "m", true, false, {} },
        { "pos", "Position", -100, 100, -25, 0, "", false, false, {} },
        { "dist", "Distance", 0, 100, 40, 0, "%", false, false, {} },
        { "height", "Height", 0, 100, 35, 0, "%", false, false, {} },
        { "spread", "Spread", 0, 200, 100, 0, "%", false, false, {} },
    };
    return p;
}
Values rvPlaceDefaults()
{
    Values v;
    for (const auto& p : RV_PLACE()) v[p.key] = p.def;
    return v;
}
Values rvRoomValues (const Values& pl, std::optional<double> freeze)
{
    Values pv;
    const std::pair<const char*, const char*> keys[] = { { "placeOn", "on" }, { "roomShape", "shape" }, { "roomSizeM", "sizeM" }, { "placePos", "pos" }, { "placeDist", "dist" }, { "placeHeight", "height" }, { "placeSpread", "spread" } };
    for (const auto& [to, from] : keys)
        if (has (pl, from)) pv[to] = g (pl, from);
    if (freeze) pv["freeze"] = *freeze;
    return pv;
}
const std::map<std::string, Pad>& RV_NEW_PADS()
{
    static const std::map<std::string, Pad> p = {
        { "ambient-fdn", { "size", "decayS" } }, { "schroeder-reverb", { "size", "decay" } },
        { "moorer-reverb", { "size", "decay" } }, { "dattorro-plate", { "damping", "decay" } },
    };
    return p;
}
std::optional<Pad> rvPadOf (const std::string& modeId, const std::optional<Pad>& shaperPad, const std::vector<std::string>& keys)
{
    std::optional<Pad> p = shaperPad;
    if (!p)
        if (auto it = RV_NEW_PADS().find (modeId); it != RV_NEW_PADS().end()) p = it->second;
    auto hasKey = [&] (const std::string& k) { return std::find (keys.begin(), keys.end(), k) != keys.end(); };
    return p && hasKey (p->x) && hasKey (p->y) ? p : std::nullopt;
}
bool rvIsFader (const std::string& k)
{
    static const std::regex re ("^(wet|dry|mix|level|gainDb|outputDb|inputDb|dryDb|erDb|lateDb)$");
    return std::regex_search (k, re);
}
const std::vector<std::string>& RV_ROLES()
{
    static const std::vector<std::string> r = { "time", "space", "tone", "motion", "output", "engine" };
    return r;
}
std::string rvRoleOf (const std::string& role, const std::string& k)
{
    using std::regex;
    if (!role.empty()) return role == "stereo" ? "space" : role;
    static const regex levelDb ("Level$|Db$"), eq ("eq", regex::icase);
    static const regex engine ("smoothing|Step$|inputDiffusion|decayDiffusion|tapSlope|window");
    static const regex motion ("mod|spin|wander", regex::icase);
    static const regex tone ("damp|bandwidth|bright|cut|Cut|bass|Bass|xov|Xov|crossover|eq|hiCut|HiCut|ringModulate|brighten", regex::icase);
    static const regex space ("diffusion|spread|width|wide|shape|density|spacing|size", regex::icase);
    if (rvIsFader (k) || (std::regex_search (k, levelDb) && !std::regex_search (k, eq))) return "output";
    if (std::regex_search (k, engine)) return "engine";
    if (std::regex_search (k, motion)) return "motion";
    if (std::regex_search (k, tone)) return "tone";
    if (std::regex_search (k, space)) return "space";
    return "time";
}
} // namespace rvd
