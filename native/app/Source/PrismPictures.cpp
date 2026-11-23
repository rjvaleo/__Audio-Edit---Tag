// Prism's pictures: ui/app/386-prism-pictures.js (PRISM_PIC) and
// 387-prism-lfo.js (prismLfoWaveIcon), ported line for line. See
// PrismPictures.h.
#include "PrismPictures.h"

#include <cmath>
#include <functional>

namespace ppic
{
namespace
{
using Str = juce::String;
constexpr double B = 40;
constexpr double PI = 3.14159265358979323846;

double cl (double v, double a, double b) { return std::max (a, std::min (b, v)); }
double lerp (double a, double b, double t) { return a + (b - a) * t; }
double jsRound (double v) { return std::floor (v + 0.5); }
// JS's toFixed.
Str fx (double v, int places = 1)
{
    const double p = std::pow (10.0, places);
    const double r = std::floor (std::abs (v) * p + 0.5) / p;
    auto s = Str (r, places);
    return v < 0 && !juce::exactlyEqual (r, 0.0) ? "-" + s : s;
}
// A number as JS writes it into a template string (close enough to draw).
Str nm (double v)
{
    if (std::abs (v - jsRound (v)) < 1e-9)
        return Str ((int64_t) jsRound (v));
    return Str (v, 4).trimCharactersAtEnd ("0");
}
double jsMod (double a, double b) { return std::fmod (a, b); }

Str P (const Str& d, const Str& c = "a", const Str& x = {}) { return "<path d=\"" + d + "\" class=\"" + c + "\" " + x + "/>"; }
Str L (double x1, double y1, double x2, double y2, const Str& c = "f", const Str& x = {})
{
    return "<line x1=\"" + fx (x1) + "\" y1=\"" + fx (y1) + "\" x2=\"" + fx (x2) + "\" y2=\"" + fx (y2) + "\" class=\"" + c + "\" " + x + "/>";
}
Str C (double x, double y, double r, const Str& c = "a") { return "<circle cx=\"" + fx (x) + "\" cy=\"" + fx (y) + "\" r=\"" + nm (r) + "\" class=\"" + c + "\"/>"; }
Str ground() { return L (4, B, 60, B); }
const Str dash = "stroke-dasharray=\"2 3\"";

Str bell (double cx, double w, double h, double base = B)
{
    Str d;
    for (int i = 0; i <= 16; ++i)
    {
        const double t = i / 16.0;
        d << (i ? "L" : "M") << fx (cx - w / 2 + w * t) << " " << fx (base - h * 0.5 * (1 - std::cos (2 * PI * t)));
    }
    return d;
}
Str wave (double x0, double x1, double y, double amp, double cyc, const Str& c = "a", double ph = 0, int shape = 0)
{
    Str d;
    for (int i = 0; i <= 64; ++i)
    {
        const double t = i / 64.0, u = t * cyc + ph;
        const double s = shape == 1 ? 1 - 4 * std::abs (jsMod (u + 0.25, 1) - 0.5) : shape == 2 ? (jsMod (u, 1) < 0.5 ? 1 : -1) : std::sin (u * 2 * PI);
        d << (i ? "L" : "M") << fx (lerp (x0, x1, t)) << " " << fx (y - amp * s);
    }
    return P (d, c);
}
Str arrow (double x1, double y1, double x2, double y2, const Str& c = "a")
{
    const double a = std::atan2 (y2 - y1, x2 - x1), s = 4;
    return L (x1, y1, x2, y2, c) + P ("M" + nm (x2 - s * std::cos (a - 0.5)) + " " + nm (y2 - s * std::sin (a - 0.5)) + "L" + nm (x2) + " " + nm (y2) + "L" + nm (x2 - s * std::cos (a + 0.5)) + " " + nm (y2 - s * std::sin (a + 0.5)), c);
}
double logN (double v, double a, double b) { return cl (std::log (std::max (v, a) / a) / std::log (b / a), 0, 1); }
Str response (const Str& kind, double fc, double q, const Str& c = "a")
{
    Str d;
    for (int i = 0; i <= 48; ++i)
    {
        const double x = 6 + i, f = i / 48.0, r = (f - fc) * 6;
        const double peak = q * 0.12 * std::exp (-r * r * (2 + q));
        double g;
        if (kind == "lp")
            g = (f <= fc ? 1 : std::max (0.0, 1 - (f - fc) * 4)) + peak;
        else if (kind == "hp")
            g = (f >= fc ? 1 : std::max (0.0, 1 - (fc - f) * 4)) + peak;
        else if (kind == "bp")
            g = std::exp (-r * r * (0.4 + q * 0.6));
        else
            g = 1 - std::exp (-r * r * (0.4 + q * 0.6));
        d << (i ? "L" : "M") << fx (x + 2) << " " << fx (B - 4 - cl (g, 0, 1.4) * 26);
    }
    return ground() + P (d, c);
}
Str filterOf (const Str& kind)
{
    if (kind == "prism:hp-low-pass") return "lp";
    if (kind == "prism:hp-high-pass") return "hp";
    if (kind == "prism:hp-band-pass") return "bp";
    if (kind == "prism:hp-band-reject") return "br";
    return "lp";
}
Str text (double x, double y, const Str& t) { return "<text x=\"" + nm (x) + "\" y=\"" + nm (y) + "\" class=\"t\">" + t + "</text>"; }
Str rect (double x, double y, double w, double h, const Str& c) { return "<rect x=\"" + nm (x) + "\" y=\"" + nm (y) + "\" width=\"" + nm (w) + "\" height=\"" + nm (h) + "\" class=\"" + c + "\"/>"; }

using Fn = std::function<Str (double v, double n, const Str& kind)>;
std::map<Str, Fn>& draws();

Str hp (const Str& key, double v, double n = 0, const Str& kind = {})
{
    auto& m = draws();
    auto it = m.find (key);
    return it == m.end() ? Str() : it->second (v, n, kind);
}

std::map<Str, Fn>& draws()
{
    static std::map<Str, Fn> m;
    if (!m.empty())
        return m;
    // ── time & pitch
    m["ratio"] = [] (double v, double, const Str&) {
        Str s = ground();
        const int k = (int) jsRound (cl (6 / v, 2, 12));
        for (int i = 0; i < k; ++i)
            s += P (bell (8 + i * (48.0 / std::max (1, k - 1)), 9, 16));
        return s;
    };
    m["semitones"] = [] (double v, double, const Str&) { return wave (6, 58, 24, 9, 2, "f") + wave (6, 58, 24, 9, 2 * std::pow (2, v / 12)); };
    m["pitch"] = [] (double v, double, const Str&) { return wave (6, 58, 24, 9, 2, "f") + wave (6, 58, 24, 9, 2 * v / 100); };
    m["pitchScale"] = [] (double v, double, const Str&) { return wave (6, 58, 24, 9, 2, "f") + wave (6, 58, 24, 9, 2 * std::max (0.1, v)); };
    m["windowMs"] = [] (double, double n, const Str&) { return ground() + P (bell (32, lerp (8, 54, n), 28)); };
    m["cloudMix"] = [] (double, double n, const Str&) {
        Str s = ground() + P (bell (32, 40, 26), "f");
        for (int i = 0; i < 5; ++i)
            s += P (bell (10 + i * 11, 10, 22 * n));
        return s;
    };
    m["speed"] = [] (double v, double, const Str&) {
        const double n = logN (v, 25, 400);
        Str s = ground();
        for (int i = 0; i < 3; ++i)
            s += P (bell (14 + i * lerp (22, 8, n), 10, 18), "f");
        return s + arrow (10, 12, lerp (22, 56, n), 12);
    };
    m["grain"] = [] (double, double n, const Str&) { return ground() + P (bell (22, 10, 20), "f") + P (bell (40, lerp (6, 40, n), 26)); };
    m["xfade"] = [] (double, double n, const Str&) { return ground() + P (bell (22, 26, 24), "f") + P (bell (22 + lerp (26, 6, n), 26, 24)); };
    // ── smoothing
    m["smoothing"] = [] (double, double n, const Str&) {
        const double k = lerp (0.2, 14, n);
        Str d;
        for (int i = 0; i <= 40; ++i)
        {
            const double t = i / 40.0, y = t < 0.2 ? 0 : 1 - std::exp (-(t - 0.2) * 40 / (k + 0.5));
            d << (i ? "L" : "M") << fx (8 + t * 48) << " " << fx (36 - y * 24);
        }
        return P ("M8 36L17.6 36L17.6 12L56 12", "f", dash) + P (d);
    };
    m["smoothingStep"] = [] (double v, double, const Str&) {
        const double n = logN (v, 1, 2048), w = lerp (2, 16, n);
        Str d = "M6 36";
        double y = 36;
        for (double x = 6; x < 58; x += w)
        {
            y = 36 - 24 * ((x - 6) / 52);
            d << "L" << fx (x) << " " << fx (y) << "L" << fx (std::min (58.0, x + w)) << " " << fx (y);
        }
        return L (6, 36, 58, 12, "f", dash) + P (d);
    };
    // ── level
    m["outputDb"] = [] (double v, double, const Str&) { const double g = std::pow (10, v / 20); return L (4, 24, 60, 24) + wave (6, 58, 24, 7, 3, "f") + wave (6, 58, 24, cl (7 * g, 0.5, 18), 3); };
    m["gainDb"] = [] (double v, double, const Str&) { const double g = std::pow (10, v / 20); return L (4, 24, 60, 24) + wave (6, 58, 24, 14, 3, "f") + wave (6, 58, 24, cl (14 * g, 0.3, 16), 3); };
    m["volumeDb"] = [] (double v, double, const Str&) { return hp ("gainDb", v); };
    m["mix"] = [] (double, double n, const Str&) { return wave (6, 58, 16, 7 * (1 - n) + 0.5, 3, "f") + wave (6, 58, 34, 7 * n + 0.5, 5); };
    m["att1Db"] = [] (double v, double, const Str&) { return ground() + P (bell (12, 10, 26), "f") + P (bell (30, 10, 26 * std::pow (10, -v / 20))); };
    m["att2Db"] = [] (double v, double, const Str&) { return ground() + P (bell (12, 10, 26), "f") + P (bell (40, 10, 26 * std::pow (10, -v / 20))); };
    m["att3Db"] = [] (double v, double, const Str&) { return ground() + P (bell (12, 10, 26), "f") + P (bell (52, 10, 26 * std::pow (10, -v / 20))); };
    // ── delays
    m["delayMs"] = [] (double, double n, const Str&) { return ground() + P (bell (10, 9, 26), "f") + P (bell (lerp (14, 56, std::sqrt (n)), 9, 20)) + arrow (10, 8, lerp (14, 56, std::sqrt (n)), 8, "f"); };
    m["delay1Ms"] = [] (double, double n, const Str&) { return ground() + P (bell (10, 9, 26), "f") + P (bell (lerp (14, 56, n), 9, 20)); };
    m["delay2Ms"] = [] (double, double n, const Str&) { return ground() + P (bell (10, 9, 26), "f") + P (bell (lerp (14, 56, n), 9, 14)); };
    m["feedback"] = [] (double, double n, const Str&) {
        Str s = ground() + P (bell (8, 7, 26), "f");
        for (int i = 1; i <= 6; ++i)
        {
            const double h = 26 * std::pow (n, i);
            if (h > 0.6)
                s += P (bell (8 + i * 8.5, 7, h));
        }
        return s;
    };
    m["crossfade"] = [] (double v, double, const Str&) {
        const double n = logN (v, 64, 32768), w = lerp (4, 40, n);
        return P ("M6 12L" + nm (32 - w / 2) + " 12L" + nm (32 + w / 2) + " 36L58 36", "f") + P ("M6 36L" + nm (32 - w / 2) + " 36L" + nm (32 + w / 2) + " 12L58 12");
    };
    m["leftTapMs"] = [] (double, double n, const Str&) { return L (6, 16, 58, 16) + ground() + C (lerp (8, 56, n), 16, 3); };
    m["rightTapMs"] = [] (double, double n, const Str&) { return L (6, 16, 58, 16) + ground() + C (lerp (8, 56, n), B, 3); };
    m["lookAhead"] = [] (double v, double, const Str&) { const double n = logN (v, 128, 2048); return ground() + P (bell (40, 12, 26), "f") + arrow (40, 8, lerp (36, 8, n), 8); };
    m["followMs"] = [] (double, double n, const Str&) { return wave (6, 58, 24, 10, 2, "f") + P ("M6 24C" + nm (lerp (10, 40, n)) + " 24 " + nm (lerp (16, 50, n)) + " 14 58 14"); };
    // ── modulation
    m["rateHz"] = [] (double, double n, const Str&) { return L (4, 24, 60, 24) + wave (6, 58, 24, 9, lerp (0.5, 6, n)); };
    m["depth"] = [] (double, double n, const Str&) { return L (4, 24, 60, 24) + L (6, 24 - 14, 58, 24 - 14, "f", dash) + L (6, 24 + 14, 58, 24 + 14, "f", dash) + wave (6, 58, 24, 14 * n + 0.3, 2.5); };
    m["lfoShape"] = [] (double v, double, const Str&) { return L (4, 24, 60, 24) + wave (6, 58, 24, 11, 2, "a", 0, (int) jsRound (v)); };
    m["stereoPhaseDeg"] = [] (double v, double, const Str&) { return wave (6, 58, 16, 6, 2, "f") + wave (6, 58, 34, 6, 2, "a", v / 360); };
    m["startPhaseDeg"] = [] (double v, double, const Str&) {
        const double a = v / 180 * PI;
        return C (32, 24, 14, "f") + L (32, 24, 32 + 14 * std::cos (a), 24 - 14 * std::sin (a), "a") + C (32 + 14 * std::cos (a), 24 - 14 * std::sin (a), 2.5, "af");
    };
    m["baseHz"] = [] (double v, double, const Str&) {
        const double n = logN (v, 20, 10000);
        Str d;
        for (int i = 0; i <= 48; ++i)
        {
            const double f = i / 48.0, r = (f - n) * 10;
            d << (i ? "L" : "M") << Str (8 + i) << " " << fx (B - 4 - 26 * (1 - 0.8 * std::exp (-r * r)));
        }
        return ground() + P (d);
    };
    m["stages"] = [] (double v, double, const Str&) {
        const double k = jsRound (v / 2);
        Str d;
        for (int i = 0; i <= 48; ++i)
        {
            const double f = i / 48.0;
            d << (i ? "L" : "M") << Str (8 + i) << " " << fx (B - 4 - 26 * (1 - 0.85 * std::pow (std::abs (std::cos (f * k * PI)), 6)));
        }
        return ground() + P (d);
    };
    m["notchDepth"] = [] (double, double n, const Str&) {
        Str d;
        for (int i = 0; i <= 48; ++i)
        {
            const double f = i / 48.0, r = (f - 0.5) * 9;
            d << (i ? "L" : "M") << Str (8 + i) << " " << fx (B - 4 - 26 * (1 - n * std::exp (-r * r)));
        }
        return ground() + P (d);
    };
    // ── filters
    m["freqHz"] = [] (double v, double, const Str& kind) { return response (filterOf (kind), logN (v, 20, 20000), 1.5); };
    m["q"] = [] (double v, double, const Str& kind) { return response (filterOf (kind), 0.5, v); };
    m["lowCutHz"] = [] (double v, double, const Str&) { return response ("hp", logN (v, 20, 20000) * 0.7, 0.5); };
    m["lowCutQ"] = [] (double v, double, const Str&) { return response ("hp", 0.35, v * 2); };
    m["brightness"] = [] (double, double n, const Str&) { return ground() + P ("M8 14L56 " + fx (lerp (38, 14, n))) + L (8, 14, 56, 14, "f", dash); };
    m["rate"] = [] (double, double n, const Str&) {
        const int k = (int) jsRound (lerp (3, 26, n));
        Str d;
        for (int i = 0; i < k; ++i)
        {
            const double x0 = 6 + i * 52.0 / k, x1 = 6 + (i + 1) * 52.0 / k, y = 24 - 12 * std::sin ((i + 0.5) / k * 4 * PI);
            d << (i ? "L" : "M") << fx (x0) << " " << fx (y) << "L" << fx (x1) << " " << fx (y);
        }
        return wave (6, 58, 24, 12, 2, "f") + P (d);
    };
    m["bits"] = [] (double v, double, const Str&) {
        const double lv = std::pow (2, jsRound (v)) / 2;
        Str d;
        for (int i = 0; i <= 64; ++i)
        {
            const double t = i / 64.0, y = jsRound (std::sin (t * 4 * PI) * std::min (lv, 6.0)) / std::min (lv, 6.0);
            d << (i ? "L" : "M") << fx (6 + t * 52) << " " << fx (24 - 12 * y);
        }
        return wave (6, 58, 24, 12, 2, "f") + P (d);
    };
    // ── reverb
    m["diffusion"] = [] (double, double n, const Str&) {
        Str s = ground();
        const int k = (int) jsRound (lerp (2, 18, n / 1.5));
        for (int i = 0; i < k; ++i)
        {
            const double x = 8 + i * (48.0 / k) + 3 * std::sin (i * 7.1);
            s += L (x, B, x, B - 24 * std::exp (-i / (k * 0.6)), "a");
        }
        return s;
    };
    m["size"] = [] (double, double n, const Str&) {
        const double w = lerp (16, 52, n), h = lerp (10, 30, n);
        return rect (32 - w / 2, B - h, w, h, "a") + C (32, B - 4, 2, "af");
    };
    // ── space
    m["level"] = [] (double v, double, const Str&) { const double w = cl (v / 100, 0, 3) * 8; return L (32, 8, 32, B, "f", dash) + C (32 - w, 24, 4) + C (32 + w, 24, 4); };
    m["xM"] = [] (double v, double, const Str&) { return L (6, 24, 58, 24, "f") + C (32, 40, 3, "f") + C (32 + v / 100 * 24, 24, 3.5, "af"); };
    m["yM"] = [] (double v, double, const Str&) { return L (32, 6, 32, 42, "f") + C (32, 40, 3, "f") + C (32, 24 - v / 100 * 16, 3.5, "af"); };
    m["balance"] = [] (double v, double, const Str&) { return L (8, 24, 56, 24, "f") + text (4, 28, "L") + text (56, 28, "R") + C (32 + v / 100 * 22, 24, 4, "af"); };
    m["position"] = [] (double, double n, const Str&) { return L (8, 24, 56, 24, "f") + text (4, 28, "L") + text (56, 28, "R") + C (lerp (10, 54, n), 24, 4, "af"); };
    m["panLaw"] = [] (double v, double, const Str&) {
        const int k = (int) jsRound (v);
        Str d, e;
        for (int i = 0; i <= 32; ++i)
        {
            const double t = i / 32.0;
            const double g = k == 0 ? std::cos (t * PI / 2) : k == 1 ? std::min (1.0, 2 * (1 - t)) : 1 - t;
            const double h = k == 0 ? std::sin (t * PI / 2) : k == 1 ? std::min (1.0, 2 * t) : t;
            d << (i ? "L" : "M") << nm (8 + t * 48) << " " << fx (B - 30 * g);
            e << (i ? "L" : "M") << nm (8 + t * 48) << " " << fx (B - 30 * h);
        }
        return ground() + P (d) + P (e, "f");
    };
    m["leftGain"] = [] (double, double n, const Str&) { return L (8, B, 56, B) + rect (14, B - 30 * n, 12, 30 * n, "af") + rect (38, 10, 12, 30, "f"); };
    m["rightGain"] = [] (double, double n, const Str&) { return L (8, B, 56, B) + rect (14, 10, 12, 30, "f") + rect (38, B - 30 * n, 12, 30 * n, "af"); };
    auto ms = [] (double s, bool mid) {
        Str r = L (6, 24, 58, 24, "f") + text (10, 44, "M") + text (42, 44, "S");
        if (mid)
            return r + rect (10, s > 0 ? 24 - 14 * s : 24, 10, std::abs (14 * s), "af") + rect (40, 16, 10, 8, "f");
        return r + rect (10, 12, 10, 12, "f") + rect (40, s > 0 ? 24 - 14 * s : 24, 10, std::abs (14 * s), "af");
    };
    m["sideVolume"] = [ms] (double v, double, const Str&) { return ms (cl (v / 400, -1, 1), false); };
    m["sideGain"] = [ms] (double v, double, const Str&) { return ms (cl (v / 90, -1, 1), false); };
    m["midGain"] = [ms] (double v, double, const Str&) { return ms (cl (v / 400, -1, 1), true); };
    m["input"] = [] (double v, double, const Str&) { return !juce::exactlyEqual (v, 0.0) ? P ("M6 14L30 24L58 24") + P ("M6 34L30 24", "a") : P ("M6 14L58 14") + P ("M6 34L58 34", "f"); };
    m["mono"] = [] (double v, double, const Str&) { return hp ("input", v); };
    m["output"] = [] (double v, double, const Str&) {
        return !juce::exactlyEqual (v, 0.0) ? L (6, 24, 58, 24, "f") + arrow (6, 14, 50, 34) + text (52, 44, "R") : L (6, 24, 58, 24, "f") + arrow (6, 34, 50, 14) + text (52, 12, "L");
    };
    // ── dynamics
    m["attackMs"] = [] (double v, double, const Str&) { const double n = logN (v + 1, 1, 1001); return ground() + P ("M6 " + nm (B) + "L" + fx (lerp (8, 34, n)) + " 10L44 10L58 " + nm (B)) + P ("M6 40L6 10L44 10", "f", dash); };
    m["releaseMs"] = [] (double v, double, const Str&) { const double n = logN (v + 1, 1, 1001); return ground() + P ("M6 " + nm (B) + "L10 10L30 10C" + nm (lerp (32, 58, n)) + " 10 " + nm (lerp (34, 58, n)) + " " + nm (B) + " 58 " + nm (B)); };
    m["thresholdDb"] = [] (double v, double, const Str&) {
        const double y = 24 - 14 * std::pow (10, v / 20);
        return wave (6, 58, 24, 14, 3, "f") + L (4, y, 60, y, "a", "stroke-dasharray=\"4 2\"") + L (4, 48 - y, 60, 48 - y, "a", "stroke-dasharray=\"4 2\"");
    };
    m["compressionDb"] = [] (double v, double, const Str&) {
        const double k = cl (1 + (-v) / 12, 1, 9), th = 24;
        Str d;
        for (int i = 0; i <= 40; ++i)
        {
            const double x = i / 40.0 * 40, y = x < th ? x : th + (x - th) / k;
            d << (i ? "L" : "M") << fx (12 + x) << " " << fx (44 - y);
        }
        return L (12, 44, 52, 4, "f", dash) + P (d);
    };
    // The LFOs' own controls (387) and the Takes bank's.
    m["lfoRate"] = [] (double v, double, const Str&) { return L (4, 24, 60, 24) + wave (6, 58, 24, 9, std::max (0.5, std::min (8.0, v))); };
    m["lfoDepth"] = [] (double, double n, const Str&) { return L (4, 24, 60, 24) + L (6, 10, 58, 10, "f", dash) + L (6, 38, 58, 38, "f", dash) + wave (6, 58, 24, 14 * n + 0.3, 2); };
    m["lfoPw"] = [] (double v, double, const Str&) {
        const double w = v / 100 * 26;
        return P ("M6 36L6 12L" + nm (6 + w) + " 12L" + nm (6 + w) + " 36L32 36L32 12L" + nm (32 + w) + " 12L" + nm (32 + w) + " 36L58 36");
    };
    m["pbSpeed"] = [] (double v, double, const Str&) { return hp ("speed", v / 128 * 100); };
    m["postRoll"] = [] (double, double n, const Str&) {
        return ground() + P (bell (14, 12, 26), "f") + P ("M20 " + nm (B - 14) + "C" + fx (26 + 30 * n) + " " + nm (B - 6) + " " + fx (30 + 30 * n) + " " + nm (B) + " " + fx (32 + 26 * n) + " " + nm (B));
    };
    return m;
}

const std::map<Str, juce::StringArray>& facets()
{
    static const std::map<Str, juce::StringArray> f {
        { "time", { "ratio", "windowMs", "speed", "grain", "xfade", "delayMs", "delay1Ms", "delay2Ms", "feedback", "crossfade", "leftTapMs", "rightTapMs", "smoothing", "smoothingStep", "rateHz", "startPhaseDeg", "followMs", "lookAhead", "lfoRate", "lfoDepth", "lfoPw", "pbSpeed", "postRoll" } },
        { "pitch", { "semitones", "pitch", "pitchScale", "depth", "lfoShape" } },
        { "tone", { "freqHz", "q", "lowCutHz", "lowCutQ", "brightness", "baseHz", "stages", "notchDepth", "rate", "bits", "diffusion" } },
        { "attack", { "attackMs", "releaseMs", "thresholdDb", "compressionDb" } },
        { "space", { "size", "level", "xM", "yM", "balance", "position", "panLaw", "stereoPhaseDeg", "sideVolume", "sideGain", "midGain", "input", "mono", "output", "leftGain", "rightGain" } },
        { "level", { "outputDb", "gainDb", "volumeDb", "mix", "att1Db", "att2Db", "att3Db", "cloudMix" } },
    };
    return f;
}

// The value of attribute `a` in an element's markup.
Str attr (const Str& el, const Str& a)
{
    const auto at = el.indexOf (" " + a + "=\"");
    if (at < 0)
        return {};
    const auto from = at + a.length() + 3;
    return el.substring (from, el.indexOfChar (from, '"'));
}
} // namespace

Str hpDraw (const Str& key, double v, double n, const Str& kind) { return hp (key, v, n, kind); }
bool hasDraw (const Str& key) { return draws().count (key) > 0; }

Str procIcon (const Str& kind)
{
    if (kind == "stretch") return hp ("ratio", 2);
    if (kind == "ptc")
    {
        Str s = ground();
        for (int i = 0; i < 3; ++i)
            s += P (bell (12 + i * 13, 9, 18), "f");
        return s + arrow (8, 10, 56, 10);
    }
    if (kind == "prism:hp-low-pass") return response ("lp", 0.45, 1.5);
    if (kind == "prism:hp-high-pass") return response ("hp", 0.55, 1.5);
    if (kind == "prism:hp-band-pass") return response ("bp", 0.5, 2);
    if (kind == "prism:hp-band-reject") return response ("br", 0.5, 2);
    if (kind == "prism:hp-comb-filter") return hp ("stages", 8);
    if (kind == "prism:hp-single-delay") return hp ("delay1Ms", 0, 0.6);
    if (kind == "prism:hp-echo") return hp ("feedback", 0, 0.75);
    if (kind == "prism:hp-echotranz")
    {
        Str s = ground() + P (bell (8, 7, 26), "f");
        for (int i = 1; i <= 4; ++i)
            s += P (bell (8 + i * 11, 7, 26 * std::pow (0.7, i)), "a", "transform=\"translate(0 " + Str (i * -2) + ")\"");
        return s;
    }
    if (kind == "prism:hp-multi-delay") return ground() + P (bell (8, 7, 26), "f") + P (bell (26, 7, 20)) + P (bell (40, 7, 14)) + P (bell (54, 7, 9));
    if (kind == "prism:hp-medium-room") return hp ("size", 0, 0.45);
    if (kind == "prism:hp-hall") return hp ("size", 0, 1);
    if (kind == "prism:hp-chorus") return wave (6, 58, 22, 8, 2, "f") + wave (6, 58, 26, 8, 2.2);
    if (kind == "prism:hp-flanger") return hp ("stages", 6) + arrow (14, 6, 50, 6, "f");
    if (kind == "prism:hp-ring-modulator")
    {
        Str d;
        for (int i = 0; i <= 64; ++i)
        {
            const double t = i / 64.0;
            d << (i ? "L" : "M") << fx (6 + t * 52) << " " << fx (24 - 14 * std::sin (t * 12 * PI) * std::sin (t * 2 * PI));
        }
        return L (4, 24, 60, 24) + P (d);
    }
    if (kind == "prism:hp-vibrato")
    {
        Str d;
        for (int i = 0; i <= 80; ++i)
        {
            const double t = i / 80.0, ph = t * 5 + 0.6 * std::sin (t * 2 * PI * 2);
            d << (i ? "L" : "M") << fx (6 + t * 52) << " " << fx (24 - 10 * std::sin (ph * 2 * PI));
        }
        return P (d);
    }
    if (kind == "prism:hp-tremolo")
    {
        Str d;
        for (int i = 0; i <= 80; ++i)
        {
            const double t = i / 80.0;
            d << (i ? "L" : "M") << fx (6 + t * 52) << " " << fx (24 - 14 * (0.55 + 0.45 * std::sin (t * 4 * PI)) * std::sin (t * 16 * PI));
        }
        return L (4, 24, 60, 24) + P (d);
    }
    if (kind == "prism:hp-frequency-modulator")
    {
        Str d;
        for (int i = 0; i <= 80; ++i)
        {
            const double t = i / 80.0, ph = t * 4 + 0.25 * std::sin (t * 2 * PI * 6);
            d << (i ? "L" : "M") << fx (6 + t * 52) << " " << fx (24 - 12 * std::sin (ph * 2 * PI));
        }
        return P (d);
    }
    if (kind == "prism:hp-phaser") return hp ("stages", 4);
    if (kind == "prism:hp-pitch-shifter") return hp ("semitones", 7);
    if (kind == "prism:hp-more-stereo") return hp ("level", 250);
    if (kind == "prism:hp-doppler") return L (6, 30, 58, 30, "f") + C (32, 42, 3, "f") + arrow (10, 22, 54, 22) + C (30, 22, 3.5, "af");
    if (kind == "prism:hp-pan") return hp ("balance", -50);
    if (kind == "prism:hp-auto-pan") return L (8, 24, 56, 24, "f") + text (4, 28, "L") + text (56, 28, "R") + P ("M14 24C20 10 44 10 50 24", "a") + C (50, 24, 3.5, "af");
    if (kind == "prism:hp-stereo-dynamics") return hp ("rightGain", 0, 0.5);
    if (kind == "prism:hp-quasi-stereo") return hp ("input", 0).replaceSection (hp ("input", 0).indexOf ("class=\"f\""), 9, "class=\"a\"");
    if (kind == "prism:hp-ms-matrix") return hp ("sideVolume", 200);
    if (kind == "prism:hp-hyper-stereo") return hp ("level", 300);
    if (kind == "prism:hp-noise-gate") return hp ("thresholdDb", -12);
    if (kind == "prism:hp-compressor") return hp ("compressionDb", -48);
    if (kind == "prism:hp-sonic-decimator") return hp ("bits", 3);
    return {};
}

Str facetOf (const Str& key)
{
    for (const auto& [f, keys] : facets())
        if (keys.contains (key))
            return f;
    return "level";
}

Str lfoWaveIcon (const Str& shape)
{
    Str d;
    if (shape == "random")
    {
        const double ys[] = { 0.6, -0.4, 0.9, -0.8, 0.2 };
        for (int k = 0; k < 5; ++k)
            d << (k ? "L" : "M") << fx (2 + k * 7.2) << " " << nm (10 - 7 * ys[k]) << "L" << fx (2 + (k + 1) * 7.2) << " " << nm (10 - 7 * ys[k]);
        return d;
    }
    for (int i = 0; i <= 40; ++i)
    {
        const double u = i / 40.0;
        double y = 0;
        if (shape == "sine") y = std::sin (u * 2 * PI);
        else if (shape == "triangle") y = 1 - 4 * std::abs (u - 0.5);
        else if (shape == "square") y = u < 0.5 ? 1 : -1;
        else if (shape == "saw") y = 2 * u - 1;
        else if (shape == "pulse") y = u < 0.25 ? 1 : -1;
        d << (i ? "L" : "M") << fx (2 + u * 36) << " " << fx (10 - 7 * y);
    }
    return d;
}

// ─────────────────────────────────────────────────────────────── styling

Style Style::fromCaptured (const Str& svg, bool nonScaling)
{
    Style s;
    s.nonScaling = nonScaling;
    int at = 0;
    while ((at = svg.indexOf (at, "<")) >= 0)
    {
        const auto end = svg.indexOfChar (at, '>');
        if (end < 0)
            break;
        const auto el = svg.substring (at, end);
        at = end;
        const auto c = attr (el, "class");
        if (c.isEmpty() || s.cls[c].found)
            continue;
        auto& k = s.cls[c];
        k.found = true;
        k.fill = attr (el, "fill");
        k.stroke = attr (el, "stroke");
        k.width = attr (el, "stroke-width").getFloatValue();
        k.cap = attr (el, "stroke-linecap");
        k.join = attr (el, "stroke-linejoin");
        k.opacity = attr (el, "opacity").isEmpty() ? 1.0f : attr (el, "opacity").getFloatValue();
        k.hidden = attr (el, "display") == "none";
    }
    // What a picture's template may not hold, as the page's CSS has it.
    auto& a = s.cls["a"];
    if (!a.found)
    {
        a.found = true;
        a.stroke = "rgba(200,200,200,1)";
        a.width = nonScaling ? 1.4f : 2.2f;
    }
    if (!s.cls["af"].found)
    {
        auto& af = s.cls["af"];
        af.found = true;
        af.fill = a.stroke;
        af.stroke = "none";
    }
    if (!s.cls["f"].found)
    {
        auto& f = s.cls["f"];
        f.found = true;
        f.stroke = nonScaling ? "rgba(255,255,255,0.3)" : "rgba(123,129,135,1)";
        f.width = nonScaling ? 1.0f : 1.6f;
        f.opacity = nonScaling ? 1.0f : 0.7f;
    }
    if (!s.cls["t"].found)
    {
        auto& t = s.cls["t"];
        t.found = true;
        t.fill = s.cls["f"].stroke;
        t.hidden = nonScaling;
    }
    return s;
}

Style Style::tinted (juce::Colour c) const
{
    Style s = *this;
    const auto css = "rgba(" + Str (c.getRed()) + "," + Str (c.getGreen()) + "," + Str (c.getBlue()) + "," + Str (c.getFloatAlpha()) + ")";
    s.cls["a"].stroke = css;
    s.cls["af"].fill = css;
    return s;
}

void draw (juce::Graphics& g, const Str& body, juce::Rectangle<float> box, const Style& st, float vbW, float vbH, bool stretch)
{
    if (body.isEmpty() || box.isEmpty())
        return;
    const float sc = std::min (box.getWidth() / vbW, box.getHeight() / vbH);
    // Each class written out as attributes; the widths of a picture whose
    // strokes don't scale are screen px, so in the viewBox's units they grow.
    Str doc = body;
    for (const auto& [name, k] : st.cls)
    {
        Str a;
        if (k.hidden)
            a = "display=\"none\"";
        else
        {
            const float w = st.nonScaling && !stretch ? k.width / sc : k.width;
            a << "fill=\"" << (k.fill.isEmpty() ? Str ("none") : k.fill) << "\" stroke=\"" << (k.stroke.isEmpty() ? Str ("none") : k.stroke)
              << "\" stroke-width=\"" << Str (w, 3) << "\" stroke-linecap=\"" << (k.cap.isEmpty() ? Str ("butt") : k.cap)
              << "\" stroke-linejoin=\"" << (k.join.isEmpty() ? Str ("miter") : k.join) << "\" opacity=\"" << Str (k.opacity, 3) << "\"";
            if (name == "t")
                a << " font-family=\"Menlo\" font-size=\"" << Str (st.fontSize) << "\"";
        }
        doc = doc.replace ("class=\"" + name + "\"", a);
    }
    static std::map<Str, std::unique_ptr<juce::Drawable>> cache;
    const auto whole = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 " + Str (vbW) + " " + Str (vbH) + "\" width=\"" + Str (vbW) + "\" height=\"" + Str (vbH) + "\">" + doc + "</svg>";
    auto& d = cache[whole];
    if (d == nullptr)
    {
        if (cache.size() > 4000)
        {
            cache.clear();
            return draw (g, body, box, st, vbW, vbH, stretch);
        }
        d = juce::Drawable::createFromSVGString (whole);
    }
    if (d == nullptr)
        return;
    if (stretch)
        d->drawWithin (g, box, juce::RectanglePlacement::stretchToFit, 1.0f);
    else
    {
        const auto t = juce::AffineTransform::scale (sc).translated (box.getX() + (box.getWidth() - vbW * sc) / 2, box.getY() + (box.getHeight() - vbH * sc) / 2);
        d->draw (g, 1.0f, t);
    }
}
} // namespace ppic
