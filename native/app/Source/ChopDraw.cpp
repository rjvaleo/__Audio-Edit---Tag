// Chop's face: what it draws, ported from the page's own drawing code
// (ui/app/403-chop-view.js, 404-chop-pictures.js, 405-chop-panel.js'
// pictures, 073a-ui-knob.js' ring, 075-fx-faces.js' FXP pictures).
#include "ChopFace.h"

#include "Canvas2D.h"
#include "ChopUtil.h"

#include <cmath>

using namespace chopu;

namespace
{
using C3 = std::array<float, 3>;
const float pi = juce::MathConstants<float>::pi;

// `CHOP_KIND`, `CHOP_BRIGHT` ... the page's colours for what it measured.
const std::map<juce::String, C3>& kindColours()
{
    static const std::map<juce::String, C3> k { { "Kick", { 120, 104, 255 } }, { "Bass", { 190, 120, 255 } }, { "Snare", { 255, 84, 140 } }, { "Hat", { 125, 235, 255 } },
                                                { "Perc", { 84, 226, 160 } },  { "Tone", { 214, 240, 90 } },  { "Quiet", { 110, 118, 128 } } };
    return k;
}
const std::vector<C3> bright { { 70, 50, 190 }, { 40, 130, 240 }, { 50, 225, 215 }, { 230, 255, 245 } };
const std::vector<C3> noise { { 255, 70, 190 }, { 150, 110, 255 }, { 90, 200, 240 }, { 235, 250, 255 } };
const std::vector<C3> attackRamp { { 50, 58, 92 }, { 80, 110, 200 }, { 120, 225, 255 }, { 255, 255, 255 } };
const std::vector<C3> levelRamp { { 44, 46, 96 }, { 80, 90, 200 }, { 100, 205, 225 }, { 245, 255, 250 } };
const C3 lowC { 132, 104, 255 }, midC { 32, 236, 168 }, highC { 255, 255, 255 }, noNote { 96, 102, 112 };

C3 mix3 (const C3& a, const C3& b, double u)
{
    return { (float) (a[0] + (b[0] - a[0]) * u), (float) (a[1] + (b[1] - a[1]) * u), (float) (a[2] + (b[2] - a[2]) * u) };
}

C3 ramp (const std::vector<C3>& st, double v)
{
    v = juce::jlimit (0.0, 1.0, v) * (double) (st.size() - 1);
    const int i = juce::jmin ((int) st.size() - 2, (int) std::floor (v));
    return mix3 (st[(size_t) i], st[(size_t) i + 1], v - i);
}

// `chopNoteColour`: a colour for each note, yellow-green round to red.
C3 noteColour (int m)
{
    const double h = 70 + (((m % 12) + 12) % 12) * 24, s = 0.85, l = 0.62, a = s * juce::jmin (l, 1 - l);
    auto f = [&] (double n) {
        const double k = std::fmod (n + h / 30, 12.0);
        return (float) (255 * (l - a * juce::jmax (-1.0, juce::jmin (juce::jmin (k - 3, 9 - k), 1.0))));
    };
    return { f (0), f (8), f (4) };
}

juce::Colour col3 (const C3& c, float a = 1.0f) { return rgb3 (c.data(), a); }

// The page's biquads (`chopBiquad`) and their response (`chopMag`).
std::array<double, 5> biquad (const juce::String& type, double f, double q, double gainDb, double sr)
{
    const double w = 2 * juce::MathConstants<double>::pi * juce::jmin (f, sr * 0.45) / sr, cs = std::cos (w), sn = std::sin (w);
    const double al = sn / (2 * q), A = std::pow (10, gainDb / 40);
    double b0, b1, b2, a0, a1, a2;
    if (type == "lp") { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (type == "hp") { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (type == "bp") { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
    return { b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0 };
}
double mag (const std::array<double, 5>& k, double f, double sr)
{
    const double w = 2 * juce::MathConstants<double>::pi * f / sr, cs = std::cos (w), sn = std::sin (w), c2 = std::cos (2 * w), s2 = std::sin (2 * w);
    const double nr = k[0] + k[1] * cs + k[2] * c2, ni = -(k[1] * sn + k[2] * s2), dr = 1 + k[3] * cs + k[4] * c2, di = -(k[3] * sn + k[4] * s2);
    return std::sqrt ((nr * nr + ni * ni) / (dr * dr + di * di + 1e-20));
}

// A picture as the page's SVG builds it: marks, each with its class.
struct Mark
{
    juce::String cls;    // a f af ff
    juce::Path path;
    bool dashed = false;
};
using Pic = std::vector<Mark>;
double lerp (double a, double b, double t) { return a + (b - a) * t; }
double cl01 (double v, double a = 0, double b = 1) { return juce::jmax (a, juce::jmin (b, v)); }
void line (Pic& p, double x1, double y1, double x2, double y2, const char* cls = "f", bool dash = false)
{
    Mark m { cls, {}, dash };
    m.path.startNewSubPath ((float) x1, (float) y1);
    m.path.lineTo ((float) x2, (float) y2);
    p.push_back (m);
}
void svgPath (Pic& p, const juce::String& d, const char* cls = "a")
{
    p.push_back ({ cls, juce::Drawable::parseSVGPath (d), false });
}
void rect (Pic& p, double x, double y, double w, double h, const char* cls = "a")
{
    Mark m { cls, {}, false };
    m.path.addRectangle ((float) x, (float) y, (float) juce::jmax (0.0, w), (float) juce::jmax (0.0, h));
    p.push_back (m);
}
juce::String N (double v) { return juce::String (jsRound (v * 100) / 100); }

// `FXP`'s kit, on 64 x 48 with the ground at 40.
constexpr double B = 40;
void G (Pic& p) { line (p, 4, B, 60, B); }
void spectrum (Pic& p, const std::function<double (double)>& fn, const char* cls = "a")
{
    juce::String d;
    for (int i = 0; i <= 40; ++i)
    {
        const double t = i / 40.0;
        d << (i ? "L" : "M") << N (4 + 56 * t) << " " << N (B - 30 * cl01 (fn (t)));
    }
    svgPath (p, d, cls);
}
void wave (Pic& p, double x0, double x1, double y, double amp, double cyc, const char* cls = "a", double ph = 0)
{
    juce::String d;
    for (int i = 0; i <= 64; ++i)
    {
        const double t = i / 64.0;
        d << (i ? "L" : "M") << N (lerp (x0, x1, t)) << " " << N (y - amp * std::sin ((t * cyc + ph) * 2 * juce::MathConstants<double>::pi));
    }
    svgPath (p, d, cls);
}

// `FXP.PIC`, the pictures Chop's processing controls use.
Pic fxp (const juce::String& name, double n)
{
    Pic p;
    if (name == "attack")
    {
        const double x = lerp (8, 50, n);
        G (p);
        svgPath (p, "M6 " + N (B) + "L" + N (x) + " 10L58 10");
        line (p, 6, 44, x, 44, "a");
    }
    else if (name == "release")
    {
        const double x = lerp (14, 58, n);
        G (p);
        svgPath (p, "M6 10L10 10Q" + N ((10 + x) / 2) + " 10 " + N (x) + " " + N (B));
        line (p, 10, 44, x, 44, "a");
    }
    else if (name == "threshold")
    {
        const double y = lerp (36, 8, n), x = lerp (8, 52, n);
        line (p, 6, 42, 58, 6);
        svgPath (p, "M6 42L" + N (x) + " " + N (y + 4) + "L58 " + N (y));
        line (p, 4, y + 4, 60, y + 4, "f", true);
    }
    else if (name == "depth")
    {
        wave (p, 4, 60, 22, 14, 2, "f", 0);
        wave (p, 4, 60, 22, 14 * n, 2);
    }
    else if (name == "level")
    {
        rect (p, 26, B - 32, 12, 32, "f");
        rect (p, 26, B - 32 * n, 12, 32 * n, "af");
        line (p, 22, B - 32 * .8, 42, B - 32 * .8);
    }
    else if (name == "mix")
    {
        rect (p, 14, B - 30 * (1 - n), 12, 30 * (1 - n), "ff");
        rect (p, 38, B - 30 * n, 12, 30 * n, "af");
        G (p);
    }
    else if (name == "freq")
    {
        G (p);
        spectrum (p, [n] (double t) { return .15 + .8 * std::exp (-std::pow ((t - n) * 9, 2)); });
        line (p, 4 + 56 * n, B, 4 + 56 * n, B + 4, "a");
    }
    else if (name == "lowpass")
    {
        G (p);
        spectrum (p, [n] (double t) { return t < n ? .85 : .85 * std::exp (-(t - n) * 14); });
        line (p, 4 + 56 * n, 6, 4 + 56 * n, B, "f", true);
    }
    else if (name == "highpass")
    {
        G (p);
        spectrum (p, [n] (double t) { return t > n ? .85 : .85 * std::exp (-(n - t) * 14); });
        line (p, 4 + 56 * n, 6, 4 + 56 * n, B, "f", true);
    }
    else if (name == "q")
    {
        G (p);
        spectrum (p, [n] (double t) { return .1 + .85 * std::exp (-std::pow ((t - .5) * lerp (3, 26, n), 2)); });
    }
    else if (name == "drive")
    {
        const double k = lerp (1, 8, n);
        juce::String d;
        for (int i = 0; i <= 48; ++i)
        {
            const double t = i / 48.0, y = std::tanh (k * std::sin (t * 2 * juce::MathConstants<double>::pi)) / std::tanh (k);
            d << (i ? "L" : "M") << N (6 + 52 * t) << " " << N (24 - 14 * y);
        }
        wave (p, 6, 58, 24, 14, 1, "f");
        svgPath (p, d);
    }
    return p;
}

// `CHOP_GLYPH`: the pictures beside Detect, Grid, Slice and Time's knobs (22 x 16).
juce::String R1 (double x) { return fixed (x, 1); }
Pic glyph (const juce::String& key, double n, double v)
{
    Pic p;
    auto A = [&] (const juce::String& d) { svgPath (p, d, "a"); };
    auto F = [&] (const juce::String& d) { svgPath (p, d, "f"); };
    if (key == "sens")
    {
        F ("M1 14H3L4 3 6 14H8L9 8 11 14H13L14 6 16 14H18L19 10 21 14");
        A ("M1 " + R1 (2 + n * 11) + "H21");
    }
    else if (key == "topDb")
    {
        F ("M1 8C3 2 6 2 8 8S9 8 10 8 12 2 15 2 19 8 21 8M1 8C3 14 6 14 8 8M10 8C12 14 15 14 21 8");
        A ("M1 " + R1 (2 + (1 - n) * 5) + "H21M1 " + R1 (14 - (1 - n) * 5) + "H21");
    }
    else if (key == "minDur")
    {
        const double w = 3 + n * 8;
        A ("M" + R1 (11 - w) + " 3V13M" + R1 (11 + w) + " 3V13");
        F ("M" + R1 (11 - w) + " 8H" + R1 (11 + w));
    }
    else if (key == "pad")
    {
        const double w = 3 + n * 6;
        F ("M8 8C9 3 13 3 14 8S9 13 8 8");
        A ("M" + R1 (7 - w) + " 3V13M" + R1 (15 + w) + " 3V13");
    }
    else if (key == "nudge")
    {
        juce::String d;
        for (int i = 0; i < 4; ++i)
            d << "M" << R1 (3 + i * 5 + (n - 0.5) * 5) << " 3V13";
        F ("M1 14H21");
        A (d);
    }
    else if (key == "shuffle")
    {
        juce::String d;
        for (int i = 0; i < 5; ++i)
            d << "M" << R1 (2 + i * 4.5 + (i % 2 ? n * 4 : 0)) << " 3V13";
        A (d);
    }
    else if (key == "gate")
    {
        A ("M2 13V4H" + R1 (2 + 18 * n) + "V13");
        F ("M" + R1 (2 + 18 * n) + " 13H20");
    }
    else if (key == "smooth")
        A ("M2 13L" + R1 (2 + n * 8) + " 4H" + R1 (20 - n * 8) + "L20 13");
    else if (key == "tailMs")
    {
        juce::String d = "M2 8";
        for (int i = 0; i < 6; ++i)
            d << "L" << (4 + i * 3) << " " << R1 (8 + (2 + n * 4) * (1 - i / 6.0) * (i % 2 ? 1 : -1));
        A (d);
    }
    else if (key == "bars")
    {
        const int k = 1 + (int) jsRound (n * 7);
        const double w = 20.0 / k;
        juce::String d;
        for (int i = 0; i <= k; ++i)
            d << "M" << R1 (1 + i * w) << " 3V13";
        A (d);
    }
    else if (key == "beats")
    {
        const int k = (int) jsRound (n * 15);
        for (int i = 0; i < 16; ++i)
        {
            const auto d = "M" + R1 (2 + (i % 4) * 5.4) + " " + R1 (2 + (i >> 2) * 3.8) + "h.1";
            if (i < k)
                A (d);
            else
                F (d);
        }
    }
    else if (key == "sig")
    {
        const int k = (int) jsRound (v);
        juce::String d;
        for (int i = 0; i < k; ++i)
            d << "M" << R1 (2 + i * (18.0 / juce::jmax (1, k - 1))) << " " << (i ? 7 : 3) << "V13";
        A (d);
    }
    else if (key == "tempo")
    {
        const double t = -0.9 + n * 1.8;
        F ("M6 14L9 2H13L16 14Z");
        A ("M11 14L" + R1 (11 + std::sin (t) * 9) + " " + R1 (14 - std::cos (t) * 11));
    }
    else if (key == "pitch")
    {
        const double y = 14 - n * 12;
        F ("M1 8H21");
        A ("M2 8C8 8 8 " + R1 (y) + " 13 " + R1 (y) + "H20");
    }
    else if (key == "stretch")
    {
        A ("M2 8H8");
        juce::String d = "M8 8";
        for (int i = 0; i < 4; ++i)
            d << "L" << R1 (8 + (i + 1) * (n * 3 + 0.4)) << " " << (i % 2 ? 5 : 11);
        A (d);
        F ("M2 13H20");
    }
    return p;
}

// Draw a picture's marks into `r` (its viewBox `vw` x `vh`), each stroke as
// the page's `vector-effect: non-scaling-stroke` keeps it, in screen pixels.
struct MarkStyle
{
    juce::Colour stroke, fill;
    float width = 1, opacity = 1;
};
void drawPic (juce::Graphics& g, const Pic& pic, juce::Rectangle<float> r, float vw, float vh, const std::map<juce::String, MarkStyle>& styles)
{
    const auto t = juce::AffineTransform::scale (r.getWidth() / vw, r.getHeight() / vh).translated (r.getX(), r.getY());
    for (const auto& m : pic)
    {
        auto it = styles.find (m.cls);
        if (it == styles.end())
            continue;
        const auto& s = it->second;
        auto path = m.path;
        path.applyTransform (t);
        if (m.cls == "af" || m.cls == "ff")
        {
            g.setColour (s.fill.withMultipliedAlpha (s.opacity));
            g.fillPath (path);
            continue;
        }
        g.setColour (s.stroke.withMultipliedAlpha (s.opacity));
        juce::PathStrokeType st (s.width, juce::PathStrokeType::curved, juce::PathStrokeType::rounded);
        if (m.dashed)
        {
            juce::Path d;
            const float dash[] = { 2 * r.getWidth() / vw, 3 * r.getWidth() / vw };
            st.createDashedStroke (d, path, dash, 2);
            g.fillPath (d);
        }
        else
            g.strokePath (path, st);
    }
}

// Paint a captured tree (a legend), `text` changing what a run says.
void paintTree (juce::Graphics& g, const juce::var& n, juce::Point<float> at, const std::function<juce::String (const juce::String&)>& text)
{
    const auto r = rectOf (n["rect"]) + at;
    if (n["bg"].isArray() || n["layers"].isArray() || n["border"].isArray())
        face::paintBox (g, n, r);
    if (auto* runs = n["text"].getArray())
        for (const auto& run : *runs)
        {
            const auto f = face::font (run["font"]);
            const auto rr = rectOf (run["rect"]) + at;
            g.setFont (f);
            g.setColour (face::colour (run["font"]["colour"]));
            const float baseline = rr.getY() + (rr.getHeight() - (f.getAscent() + f.getDescent())) / 2.0f + f.getAscent();
            juce::GlyphArrangement glyphs;
            glyphs.addLineOfText (f, text (run["text"].toString()), rr.getX(), baseline);
            glyphs.draw (g);
        }
    if (auto* kids = n["kids"].getArray())
        for (const auto& k : *kids)
            paintTree (g, k, at, text);
}
} // namespace

// ─────────────────────────────────────────────── the sound and its colours

void ChopFace::peaks (int w, double a0, double b0, std::vector<float>& mx) const
{
    // `chopPeaks`: each column's loudest, scaled to the sound's.
    mx.assign ((size_t) juce::jmax (0, w), 0.0f);
    const double per = (b0 - a0) / w;
    const int64_t st = juce::jmax<int64_t> (1, (int64_t) std::floor (per / 40));
    const float k = 1.0f / peak;
    const auto n = (int64_t) mono.size();
    for (int x = 0; x < w; ++x)
    {
        float hi = 0;
        const auto s = (int64_t) std::floor (a0 + x * per);
        const auto e = juce::jmax (s + 1, (int64_t) std::floor (a0 + (x + 1) * per));
        for (int64_t j = s; j < e; j += st)
        {
            const float v = j >= 0 && j < n ? mono[(size_t) j] : 0.0f;
            hi = juce::jmax (hi, std::abs (v));
        }
        mx[(size_t) x] = juce::jmin (1.0f, hi * k);
    }
}

juce::Colour ChopFace::kindColour (const Slice& x) const
{
    auto it = kindColours().find (x.kind);
    return x.kind.isNotEmpty() && it != kindColours().end() ? col3 (it->second) : cl ("t2");
}

void ChopFace::frameColour (int f, float out[3]) const
{
    auto put3 = [&] (const C3& c) { out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; };
    const auto at = [&] (int k) { return (double) an[(size_t) k][(size_t) f]; };
    if (colour == "spectrum")
    {
        const double l = at (0) * at (0), m = at (1) * at (1), h = at (2) * at (2), t = l + m + h + 1e-9;
        for (int c = 0; c < 3; ++c)
            out[c] = (float) ((lowC[(size_t) c] * l + midC[(size_t) c] * m + highC[(size_t) c] * h) / t);
    }
    else if (colour == "bright")
        put3 (ramp (bright, std::log (juce::jmax (at (3), 150.0) / 150) / std::log (60.0)));
    else if (colour == "noise")
        put3 (ramp (noise, at (4) / 0.55));
    else if (colour == "pitch")
    {
        if (juce::exactlyEqual (at (8), 0.0) || at (9) < 0.55)
            put3 (noNote);
        else
            put3 (mix3 (noNote, noteColour ((int) jsRound (69 + 12 * std::log2 (at (8) / 440))), juce::jmin (1.0, (at (9) - 0.55) / 0.3)));
    }
    else if (colour == "attack")
        put3 (ramp (attackRamp, std::pow (at (7), 0.7)));
    else if (colour == "level")
        put3 (ramp (levelRamp, (20 * std::log10 (at (6) + 1e-9) + 48) / 42));
    else
        put3 ({ 255, 255, 255 });
}

void ChopFace::drawPlain (juce::Graphics& g, const std::vector<float>& mx, int w, float mid, float A, float alpha)
{
    // `chopPlainWave`: a glowing outline over a faint fill.
    juce::Path top, bot, body;
    top.startNewSubPath (0, mid);
    bot.startNewSubPath (0, mid);
    body.startNewSubPath (0, mid);
    for (int x = 0; x < w; ++x)
    {
        top.lineTo ((float) x + 0.5f, mid - mx[(size_t) x] * A - 0.4f);
        bot.lineTo ((float) x + 0.5f, mid + mx[(size_t) x] * A + 0.4f);
        body.lineTo ((float) x + 0.5f, mid - mx[(size_t) x] * A - 0.4f);
    }
    for (int x = w - 1; x >= 0; --x)
        body.lineTo ((float) x + 0.5f, mid + mx[(size_t) x] * A + 0.4f);
    body.closeSubPath();
    const auto wave = cl ("wave");
    g.setColour (wave.withMultipliedAlpha (alpha * 0.3f));
    g.fillPath (body);
    g.setColour (wave.withMultipliedAlpha (alpha));
    const juce::PathStrokeType st (1.1f, juce::PathStrokeType::curved, juce::PathStrokeType::butt);
    g.strokePath (top, st);
    g.strokePath (bot, st);
}

void ChopFace::drawColumns (juce::Graphics& g, const std::vector<float>& mx, int w, float mid, float A, double a0, double b0, float alpha)
{
    // `chopColumns`: each column in the colour of what is there.
    if (colour == "white" || !anReady)
    {
        drawPlain (g, mx, w, mid, A, alpha);
        return;
    }
    const double per = (b0 - a0) / w;
    const int N = 2048, HOP = 512;
    size_t si = 0;
    for (int x = 0; x < w; ++x)
    {
        const double f0 = a0 + x * per, f1 = f0 + per;
        float c[3] = { 70, 74, 82 };
        if (colour == "kind")
        {
            const double at = (f0 + f1) / 2;
            while (si + 1 < slices.size() && (double) slices[si].e <= at)
                ++si;
            if (si < slices.size())
            {
                const auto& q = slices[si];
                auto it = kindColours().find (q.kind);
                if (at >= (double) q.s && at < (double) q.e && it != kindColours().end())
                    for (int k = 0; k < 3; ++k)
                        c[k] = it->second[(size_t) k];
            }
        }
        else
        {
            const int i0 = juce::jmax (0, juce::jmin (anF - 1, (int) std::floor ((f0 - N / 2) / HOP)));
            const int i1 = juce::jmax (i0 + 1, juce::jmin (anF, (int) std::ceil ((f1 - N / 2) / HOP)));
            if (colour == "pitch" || colour == "attack")
            {
                const auto& src = an[colour == "pitch" ? 6u : 7u];
                int b = i0;
                float v = -1;
                for (int f = i0; f < i1; ++f)
                    if (src[(size_t) f] > v)
                    {
                        v = src[(size_t) f];
                        b = f;
                    }
                frameColour (b, c);
            }
            else
            {
                const int st = juce::jmax (1, (int) std::floor ((i1 - i0) / 8.0));
                double r = 0, gg = 0, bl = 0, wt = 1e-12;
                for (int f = i0; f < i1; f += st)
                {
                    float q[3];
                    frameColour (f, q);
                    const double e = (double) an[6][(size_t) f] * an[6][(size_t) f] + 1e-12;
                    r += q[0] * e;
                    gg += q[1] * e;
                    bl += q[2] * e;
                    wt += e;
                }
                c[0] = (float) (r / wt);
                c[1] = (float) (gg / wt);
                c[2] = (float) (bl / wt);
            }
        }
        const float top = mid - mx[(size_t) x] * A, bot = mid + mx[(size_t) x] * A;
        const auto colr = rgb3 (c);
        g.setColour (colr.withMultipliedAlpha (alpha * 0.8f));
        g.fillRect (juce::Rectangle<float> ((float) x, top, 1, juce::jmax (1.0f, bot - top)));
        g.setColour (colr.withMultipliedAlpha (alpha));
        g.fillRect (juce::Rectangle<float> ((float) x, top - 0.6f, 1, 1.5f));
        g.fillRect (juce::Rectangle<float> ((float) x, bot - 0.9f, 1, 1.5f));
    }
}

void ChopFace::drawWave (juce::Graphics& g, float w, float h)
{
    // `chopDrawWave`.
    const float ruler = 18, H = h - ruler, mid = ruler + H / 2, A = H * 0.47f;
    std::vector<float> mx;
    peaks ((int) w, viewA, viewB, mx);
    if (colour == "white")
    {
        // The plain trace's glow: the bloom, blurred, under it.
        juce::Image glowImg (juce::Image::ARGB, (int) w, (int) h, true);
        {
            juce::Graphics gg (glowImg);
            drawPlain (gg, mx, (int) w, mid, A, 0.95f);
        }
        juce::ImageConvolutionKernel k (9);
        k.createGaussianBlur (3.5f * (float) dnum (captured["cl"]["glow"], 1));
        k.applyToImage (glowImg, glowImg, glowImg.getBounds());
        g.setOpacity (0.5f * (float) juce::jmin (1.0, dnum (captured["cl"]["glow"], 1)));
        g.drawImageAt (glowImg, 0, 0);
        g.setOpacity (1);
    }
    drawColumns (g, mx, (int) w, mid, A, viewA, viewB, 0.95f);
    g.setColour (juce::Colours::white.withAlpha (0.08f));
    g.fillRect (juce::Rectangle<float> (0, mid, w, 1));
}

void ChopFace::drawOverview (juce::Graphics& g, float w, float h)
{
    // `chopDrawOverview`, and its playhead (`#chopOverHead`).
    std::vector<float> mx;
    peaks ((int) w, 0, (double) len, mx);
    drawColumns (g, mx, (int) w, h / 2, h * 0.42f, 0, (double) len, 0.85f);
    const auto fx = [&] (double f) { return (float) (f / (double) juce::jmax<int64_t> (1, len) * w); };
    const float lw = 1.5f, gap = lw + 1;
    auto mark = [&] (float a, float b) { g.fillRect (juce::Rectangle<float> (a - lw / 2, 0, b - a + lw, h)); };
    g.setColour (cl ("t").withMultipliedAlpha (0.9f));
    float a = -1e9f, b = -1e9f;
    for (const auto& s : slices)
    {
        const float l = fx ((double) s.s);
        if (l - a < gap)
        {
            b = l;
            continue;
        }
        if (a > -1e9f)
            mark (a, b);
        a = b = l;
    }
    if (a > -1e9f)
        mark (a, b);
    g.setColour (cl ("acc"));
    for (int i = 0; i < (int) slices.size(); ++i)
        if (i == current || sel.count (i) > 0)
            mark (fx ((double) slices[(size_t) i].s), fx ((double) slices[(size_t) i].s));
    const float S = fx ((double) regionS), E = fx ((double) regionE);
    g.setColour (juce::Colours::black.withAlpha (0.62f));
    g.fillRect (juce::Rectangle<float> (0, 0, S, h));
    g.fillRect (juce::Rectangle<float> (E, 0, w - E, h));
    g.setColour (cl ("wave"));
    g.drawRect (juce::Rectangle<float> (fx (viewA) + 0.5f, 1.5f, juce::jmax (4.0f, fx (viewB) - fx (viewA) - 1), h - 3), 1.0f);
    g.fillRect (juce::Rectangle<float> (S - 1, 0, 2, h));
    g.fillRect (juce::Rectangle<float> (E - 1, 0, 2, h));
    if (playAt >= 0)
        g.fillRect (juce::Rectangle<float> (fx (playAt), 0, 1.5f, h));
}

void ChopFace::drawOut (juce::Graphics& g, float w, float h)
{
    // `chopDrawOut`: what you hear, around the playhead.
    const float mid = h / 2;
    juce::Path p;
    p.startNewSubPath (4, mid);
    std::vector<float> d (1600, 0.0f);
    int got = 0;
    if (playing.isNotEmpty())
        call ([&] (NaApp* a) -> int64_t {
            got = na_chop_out (a, id, d.data(), (uint32_t) d.size());
            return got;
        });
    if (got > 0)
        for (int x = 4; x <= (int) w - 4; ++x)
        {
            const int j = (int) std::floor ((float) (x - 4) / (w - 8) * 1600.0f);
            p.lineTo ((float) x, mid - (j < got ? d[(size_t) j] : 0.0f) * h * 0.46f);
        }
    else
        p.lineTo (w - 4, mid);
    g.setColour (playing.isNotEmpty() ? juce::Colour (0xffffb547) : juce::Colours::white.withAlpha (0.55f));
    g.strokePath (p, juce::PathStrokeType (1.2f));
}

void ChopFace::drawLegend (juce::Graphics& g)
{
    // `chopLegend`, as the page laid it out for this Colour, the counts live.
    const auto& tree = captured["legends"][juce::Identifier (colour)]["tree"];
    if (!tree.isObject())
        return;
    const auto at = ids.count ("chopLegend") > 0 ? ids.at ("chopLegend").r.getPosition() : juce::Point<float> (566, 300);
    paintTree (g, tree, at, [this] (const juce::String& t) {
        if (colour != "kind")
            return t;
        const auto k = t.upToFirstOccurrenceOf (" ", false, false);
        if (kindColours().count (k) == 0)
            return t;
        int n = 0;
        for (const auto& s : slices)
            n += s.kind == k ? 1 : 0;
        return k + " " + juce::String (n);
    });
}

// ─────────────────────────────────────────────────────────────── the lane

void ChopFace::drawOverlay (juce::Graphics& g, float w, float h)
{
    // `chopPaintLane`'s overlay, as the page's CSS draws it (chop.css "on the detail").
    drawnSlices.clear();
    drawnCuts.clear();
    const auto px = [&] (double f) { return (float) (xOf (f) * w); };
    const float soft = softOn ? (float) softAlpha : 1.0f;
    const auto S = (double) regionS, E = (double) regionE;
    const auto acc = cl ("acc"), t = cl ("t");
    {
        juce::Graphics::ScopedSaveState keep (g);
        g.setOpacity (soft);
        g.setColour (juce::Colours::black.withAlpha (0.66f));
        g.fillRect (juce::Rectangle<float> (0, 0, px (S), h));
        g.fillRect (juce::Rectangle<float> (px (E), 0, w - px (E), h));
    }
    const auto mode = str ("mode");
    if (mode == "silence")
    {
        // The threshold, on the waveform's scale.
        float maxRms = 0;
        for (size_t i = 0; i < mono.size(); i += 512)
        {
            double s = 0;
            const size_t end = juce::jmin (mono.size(), i + 512);
            for (size_t j = i; j < end; ++j)
                s += (double) mono[j] * mono[j];
            maxRms = juce::jmax (maxRms, (float) std::sqrt (s / (double) (end - i)));
        }
        const double amp = juce::jmin (1.0, maxRms * std::pow (10.0, -num ("topDb") / 20) / peak);
        for (double y : { 50 - amp * 47, 50 + amp * 47 })
        {
            juce::Path l;
            l.startNewSubPath (0, (float) (y / 100 * h) + 0.5f);
            l.lineTo (w, (float) (y / 100 * h) + 0.5f);
            juce::Path dashed;
            const float dash[] = { 3, 3 };
            juce::PathStrokeType (1).createDashedStroke (dashed, l, dash, 2);
            g.setColour (juce::Colours::white.withAlpha (0.45f * soft));
            g.fillPath (dashed);
        }
    }
    const double bpmNow = bpm();
    if (mode == "grid")
    {
        const double stepF = num ("stepBeats") * 60 / bpmNow * rate;
        if ((viewB - viewA) / stepF < 2000)
        {
            g.setColour (juce::Colours::white.withAlpha (0.55f * soft));
            for (int k = 0; k < 100000; ++k)
            {
                const double at = S + ((k + num ("nudge") / 100) * stepF + (k % 2 ? (num ("shuffle") - 50) / 50 * stepF : 0));
                if (at >= E)
                    break;
                if (at >= viewA && at <= viewB)
                    g.fillRect (juce::Rectangle<float> (px (at), h - 6, 1, 6));
            }
        }
    }
    // Lines fade where they are packed (`--chop-a`); a slice is drawn only
    // clear of the last one drawn, the current and picked always.
    int shownN = 0;
    for (const auto& x : slices)
        shownN += (double) x.e >= viewA && (double) x.s <= viewB ? 1 : 0;
    const float lineA = (float) juce::jlimit (0.33, 1.0, (w / (float) juce::jmax (1, shownN)) / 12.0);
    double lastPx = -1e9;
    for (int i = 0; i < (int) slices.size(); ++i)
    {
        const auto& x = slices[(size_t) i];
        if ((double) x.e < viewA || (double) x.s > viewB)
            continue;
        const double at = px ((double) x.s);
        if (i != current && sel.count (i) == 0 && at - lastPx < 3 && !drawnSlices.empty())
            continue;
        lastPx = at;
        drawnSlices.push_back (i);
    }
    const bool contig = mode != "silence";
    const auto tagFont = face::mono (9, 600);
    double lastTag[2] = { -1e9, -1e9 };
    const auto& tmpl = captured["lit"]["tree"];
    juce::ignoreUnused (tmpl);
    for (int i : drawnSlices)
    {
        const auto& x = slices[(size_t) i];
        const bool keep = i == current || sel.count (i) > 0;
        const float x0 = px ((double) x.s), x1 = px ((double) x.e);
        const auto body = juce::Rectangle<float> (x0, 18, x1 - x0, h - 18);
        juce::Graphics::ScopedSaveState s (g);
        g.setOpacity (soft);
        // The wash.
        if (x.muted)
        {
            juce::Graphics::ScopedSaveState c (g);
            g.reduceClipRegion (body.getSmallestIntegerContainer());
            g.setColour (rgba (cs ("--look-well-rgb"), 0.72f));
            g.fillRect (body);
            g.setColour (juce::Colours::white.withAlpha (0.12f));
            const float step = 9 * std::sqrt (2.0f);
            for (float k = body.getX() - body.getHeight() - step; k < body.getRight() + step; k += step)
            {
                juce::Path band;
                const float wd = 3 * std::sqrt (2.0f);
                band.startNewSubPath (k, body.getBottom());
                band.lineTo (k + wd, body.getBottom());
                band.lineTo (k + wd + body.getHeight(), body.getY());
                band.lineTo (k + body.getHeight(), body.getY());
                band.closeSubPath();
                g.fillPath (band);
            }
        }
        else if (i == current || sel.count (i) > 0 || i % 2 == 0)
        {
            g.setColour (i == current ? rgba (cs ("--on-rgb"), 0.30f) : sel.count (i) > 0 ? rgba (cs ("--on-rgb"), 0.18f) : juce::Colours::white.withAlpha (0.075f));
            g.fillRect (body);
        }
        // The number, on two staggered rows.
        const int row = i % 2;
        const auto text = juce::String (i + 1) + (x.rev ? uni ("\xe2\x97\x84") : juce::String());
        const double tagW = text.length() * 6 + 6;
        if (x1 - x0 >= 7 && x0 >= lastTag[row] + 2)
        {
            lastTag[row] = x0 + tagW;
            const float tw = juce::GlyphArrangement::getStringWidth (tagFont, text);
            const auto tr = juce::Rectangle<float> (x0 + 2.5f, 18 + (row ? 15.0f : 2.0f), tw + 5, 12);
            if (!x.muted)
            {
                g.setColour (keep ? acc : kindColour (x));
                g.fillRoundedRectangle (tr, 4);
            }
            g.setColour (juce::Colours::black);
            g.setFont (tagFont);
            juce::GlyphArrangement gl;
            gl.addLineOfText (tagFont, text, tr.getX() + 2.5f, tr.getY() + 1 + (10 - (tagFont.getAscent() + tagFont.getDescent())) / 2 + tagFont.getAscent());
            gl.draw (g);
        }
        // The edge: a line the full height under the ruler.
        auto edge = [&] (float ex, juce::Colour c, float a) {
            g.setColour (juce::Colours::black.withAlpha (0.8f * 0.5f));
            g.fillRect (juce::Rectangle<float> (ex - 2, 18, 4, h - 18));
            g.setColour (c.withMultipliedAlpha (a));
            g.fillRect (juce::Rectangle<float> (ex - 1, 18, 2, h - 18));
        };
        edge (x0, keep ? acc : t, keep ? 1.0f : lineA);
        if (!contig)
            edge (x1, keep ? acc : cl ("t2"), keep ? 1.0f : lineA);
    }
    // The ruler: bars when the tempo is known, the cuts, S and E.
    {
        g.setColour (cl ("--chassis"));
        g.fillRect (juce::Rectangle<float> (0, 0, w, 18));
        g.setColour (cl ("--line"));
        g.fillRect (juce::Rectangle<float> (0, 17, w, 1));
        juce::Graphics::ScopedSaveState s (g);
        g.setOpacity (soft);
        const double barF = num ("sig") * 60 / bpmNow * rate;
        const auto barFont = face::mono (9, 400);
        if ((viewB - viewA) / barF < 400)
            for (int b = 0; S + b * barF < E; ++b)
            {
                const double at = S + b * barF;
                if (at < viewA || at > viewB)
                    continue;
                g.setColour (cl ("--line"));
                g.fillRect (juce::Rectangle<float> (px (at), 0, 1, 17));
                g.setColour (cl ("t3"));
                g.setFont (barFont);
                juce::GlyphArrangement gl;
                gl.addLineOfText (barFont, juce::String (b + 1), px (at) + 4, 3 + (10 - (barFont.getAscent() + barFont.getDescent())) / 2 + barFont.getAscent());
                gl.draw (g);
            }
        double lastCut = -1e9;
        for (int i = 0; i < (int) slices.size(); ++i)
        {
            const auto& x = slices[(size_t) i];
            if ((double) x.s < viewA || (double) x.s > viewB)
                continue;
            const float at = px ((double) x.s);
            const bool keep = i == current || sel.count (i) > 0;
            if (!keep && at - lastCut < 3)
                continue;
            lastCut = at;
            drawnCuts.push_back (i);
            juce::Path tri;
            tri.addTriangle (at - 5, 8, at + 5, 8, at, 18);
            juce::Graphics::ScopedSaveState c (g);
            if (i == going)
                g.setOpacity (soft * 0.3f);
            g.setColour (juce::Colours::black.withAlpha (0.8f * 0.6f));
            g.fillPath (tri, juce::AffineTransform::translation (0, 1));
            g.setColour (keep ? acc : t);
            g.fillPath (tri);
            if (x.locked)
            {
                g.setColour (acc);
                g.drawRect (juce::Rectangle<float> (at + 5, 3, 6.4f, 5.4f), 1.2f);
            }
        }
        const auto flagFont = face::mono (9, 700);
        auto flag = [&] (const juce::String& txt, float x, bool right) {
            const float tw = juce::GlyphArrangement::getStringWidth (flagFont, txt) + 8;
            const auto r = juce::Rectangle<float> (right ? x - tw : x, 2, tw, 13);
            g.setColour (cl ("wave"));
            g.fillRoundedRectangle (r, 4);
            g.setColour (juce::Colours::black);
            juce::GlyphArrangement gl;
            gl.addLineOfText (flagFont, txt, r.getX() + 4, 3 + (10 - (flagFont.getAscent() + flagFont.getDescent())) / 2 + flagFont.getAscent());
            gl.draw (g);
        };
        flag ("S", px (S), false);
        flag ("E", px (E), true);
    }
    // What a drag says.
    if (readout.isNotEmpty())
    {
        const auto f = face::sans (10);
        const float tw = juce::GlyphArrangement::getStringWidth (f, readout) + 10;
        const auto r = juce::Rectangle<float> (px (readoutAt) + 8, 22, tw, 14);
        g.setColour (cl ("--panel-hi"));
        g.fillRoundedRectangle (r, 4);
        g.setColour (t);
        g.setFont (f);
        g.drawText (readout, r.reduced (5, 0), juce::Justification::centredLeft, false);
    }
}

void ChopFace::drawPlayhead (juce::Graphics& g, float w, float h)
{
    juce::ignoreUnused (w);
    if (playAt < 0)
        return;
    const float x = (float) (xOf (playAt) * w);
    const auto wave = cl ("wave");
    for (int k = 3; k >= 1; --k)
    {
        g.setColour (wave.withAlpha (0.12f));
        g.fillRect (juce::Rectangle<float> (x - 1 - (float) k * 2, 0, 2 + (float) k * 4, h));
    }
    g.setColour (wave);
    g.fillRect (juce::Rectangle<float> (x - 1, 0, 2, h));
}

// ─────────────────────────────────────────────────────────────── the pictures

void ChopFace::drawSlicePic (juce::Graphics& g, float w, float h)
{
    // `chopDrawSlice`: the source dim, the render over it, square-rooted.
    const int i = current >= 0 ? current : 0;
    if (i >= (int) slices.size() || rendered.empty())
        return;
    const auto& x = slices[(size_t) i];
    const double inL = (double) (x.e - x.s), L = juce::jmax ((double) rendered.size(), inL);
    const float T = 18, Bm = 15, mid = T + (h - T - Bm) / 2, A = (h - T - Bm) / 2 - 2, W = w - 12;
    auto env = [&] (const float* arr, size_t n) {
        const int M = juce::jmax (1, (int) std::floor ((double) n / L * W));
        std::vector<float> hi ((size_t) M, 0.0f);
        const double per = (double) n / M;
        for (int k = 0; k < M; ++k)
        {
            float m = 0;
            const int stp = juce::jmax (1, (int) std::floor (per / 16));
            for (double j = std::floor (k * per); j < (k + 1) * per; j += stp)
                m = juce::jmax (m, (size_t) j < n ? std::abs (arr[(size_t) j]) : 0.0f);
            hi[(size_t) k] = m;
        }
        return hi;
    };
    const auto src = env (mono.data() + juce::jmin<int64_t> (x.s, (int64_t) mono.size()), (size_t) juce::jmax<int64_t> (0, juce::jmin<int64_t> (x.e, (int64_t) mono.size()) - x.s));
    const auto o = env (rendered.data(), rendered.size());
    float pk = 0.001f;
    for (auto v : src)
        pk = juce::jmax (pk, v);
    for (auto v : o)
        pk = juce::jmax (pk, v);
    auto sc = [&] (float v) { return std::sqrt (v / pk) * A; };
    g.setColour (juce::Colours::white.withAlpha (0.13f));
    for (size_t k = 0; k < src.size(); ++k)
    {
        const float hh = sc (src[k]);
        g.fillRect (juce::Rectangle<float> (6 + (float) k, mid - hh, 1, hh * 2));
    }
    const double gEnd = (double) x.s + juce::jmax (1.0, jsRound (inL * num ("gate") / 100));
    juce::ignoreUnused (gEnd);
    const auto& tl = sliceInfo["tail"];
    const int split = tl.isObject() && (bool) tl["viable"] ? juce::jmin ((int) o.size(), (int) std::floor (dnum (tl["sliceLen"]) / L * W)) : (int) o.size();
    auto edge = [&] (int from, int to, juce::Colour c) {
        for (int sg : { -1, 1 })
        {
            juce::Path p;
            for (int k = from; k < to; ++k)
            {
                const float y = mid + (float) sg * sc (o[(size_t) k]);
                if (k == from)
                    p.startNewSubPath (6 + (float) k + 0.5f, y);
                else
                    p.lineTo (6 + (float) k + 0.5f, y);
            }
            g.setColour (c);
            g.strokePath (p, juce::PathStrokeType (1));
        }
        g.setColour (c.withMultipliedAlpha (0.28f));
        for (int k = from; k < to; ++k)
        {
            const float hh = sc (o[(size_t) k]);
            g.fillRect (juce::Rectangle<float> (6 + (float) k, mid - hh, 1, hh * 2));
        }
    };
    edge (0, split, cl ("wave"));
    if (split < (int) o.size())
        edge (split, (int) o.size(), juce::Colour (0xffffb547));
    if (num ("gate") < 100)
    {
        const float gx = 6 + (float) ((inL * num ("gate") / 100) / L * W);
        juce::Path l;
        l.startNewSubPath (gx, T);
        l.lineTo (gx, h);
        juce::Path d;
        const float dash[] = { 3, 3 };
        juce::PathStrokeType (1).createDashedStroke (d, l, dash, 2);
        g.setColour (juce::Colour (0xffffb547));
        g.fillPath (d);
    }
}

void ChopFace::drawPass (juce::Graphics& g, float w, float h)
{
    // `chopDrawPass`: where each slice lands in Preview, and where Ratchet fires.
    const float T = 20;
    const double S = (double) regionS, E = (double) regionE, play = num ("playBpm"), k = bpm() / play, tot = (E - S) * k;
    const float L0 = 54, W = w - L0 - 8, lane = (h - T - 6) / 2;
    auto sx = [&] (double f) { return L0 + (float) (f / tot * W); };
    std::vector<int> pl;
    for (int i = 0; i < (int) slices.size(); ++i)
        if (!slices[(size_t) i].muted && (double) slices[(size_t) i].s >= S && (double) slices[(size_t) i].s < E)
            pl.push_back (i);
    const auto f = face::mono (9);
    g.setFont (f);
    g.setColour (cl ("t3"));
    auto label = [&] (const juce::String& t, float y) {
        juce::GlyphArrangement gl;
        gl.addLineOfText (f, t, 8, y + (f.getAscent() - f.getDescent()) / 2);
        gl.draw (g);
    };
    label ("Preview", T + lane / 2);
    label ("Ratchet", T + lane * 1.5f + 2);
    for (size_t n = 0; n < pl.size(); ++n)
    {
        const auto& x = slices[(size_t) pl[n]];
        const double at = ((double) x.s - S) * k, next = n + 1 < pl.size() ? ((double) slices[(size_t) pl[n + 1]].s - S) * k : tot;
        const double ln = juce::jmin ((double) (x.e - x.s) * num ("gate") / 100, juce::jmax (1.0, next - at));
        g.setColour (pl[n] == current || playing == "preview" ? juce::Colour (0xffffb547) : juce::Colours::white.withAlpha (pl[n] % 2 ? 0.5f : 0.78f));
        g.fillRect (juce::Rectangle<float> (sx (at), T, juce::jmax (1.5f, (float) (ln / tot * W) - 1), lane - 2));
    }
    const double stepF = num ("stepBeats") * 60 / play * rate;
    const double loop = (juce::jmin (64.0, juce::jmax (1.0, num ("bars"))) * num ("sig") + num ("beats")) * 60 / play * rate;
    const float y2 = T + lane + 2;
    int fires = 0;
    for (int q = 0; q < 100000; ++q)
    {
        const double at = jsRound ((q + num ("nudge") / 100) * stepF + (q % 2 ? (num ("shuffle") - 50) / 50 * stepF : 0));
        if (at >= loop)
            break;
        if (at < 0)
            continue;
        ++fires;
        const double ln = juce::jmin (E - S, jsRound (stepF * num ("gate") / 100));
        g.setColour (playing == "ratchet" ? juce::Colour (0xffffb547) : juce::Colours::white.withAlpha (0.5f));
        g.fillRect (juce::Rectangle<float> (L0 + (float) (at / loop * W), y2, juce::jmax (1.5f, (float) (ln / loop * W) - 1), lane - 2));
    }
    if (passPlayed != (int) pl.size() || passFires != fires)
    {
        passPlayed = (int) pl.size();
        passFires = fires;
        juce::MessageManager::callAsync ([sp = juce::Component::SafePointer<ChopFace> (this)] {
            if (sp != nullptr)
                sp->repaintLayer ("texts:chopPassRo");
        });
    }
}

void ChopFace::drawCurve (juce::Graphics& g, float w, float h, const std::function<float (float, float)>& fn,
                          const std::function<void (juce::Graphics&, float, float)>& under, const juce::String& label)
{
    // `chopCurve`: a white curve on a faint grid.
    g.setColour (juce::Colours::white.withAlpha (0.05f));
    for (float y : { 0.25f, 0.5f, 0.75f })
        g.fillRect (juce::Rectangle<float> (0, h * y - 0.5f, w, 1));
    if (under)
        under (g, w, h);
    juce::Path p;
    for (int x = 4; x <= (int) w - 4; ++x)
    {
        const float y = fn ((float) (x - 4) / (w - 8), h);
        if (x == 4)
            p.startNewSubPath ((float) x, y);
        else
            p.lineTo ((float) x, y);
    }
    const float glow = (float) dnum (captured["cl"]["glow"], 1);
    const auto bloom = rgba (captured["cl"]["bloom"].toString(), 0.5f * juce::jmin (1.0f, glow));
    for (int k = 3; k >= 1; --k)
    {
        g.setColour (bloom.withMultipliedAlpha (0.25f));
        g.strokePath (p, juce::PathStrokeType (1.5f + (float) k * 2.2f * glow, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
    }
    g.setColour (cl ("wave"));
    g.strokePath (p, juce::PathStrokeType (1.5f));
    if (label.isNotEmpty())
    {
        const auto f = face::mono (9);
        g.setFont (f);
        g.setColour (cl ("t3"));
        const float tw = juce::GlyphArrangement::getStringWidth (f, label);
        juce::GlyphArrangement gl;
        gl.addLineOfText (f, label, w - 6 - tw, 12);
        gl.draw (g);
    }
}

void ChopFace::drawEnv (juce::Graphics& g, float w, float h)
{
    const double att = num ("attack"), dec = num ("decay");
    const double span = juce::jmax (600.0, juce::jmin (1500.0, att + (dec >= 5000 ? 500 : dec * 1.2)));
    drawCurve (g, w, h, [=] (float u, float hh) {
        const double ms = u * span;
        const double gg = (att > 0 ? juce::jmin (1.0, ms / att) : 1.0) * (dec >= 5000 ? 1.0 : std::exp (-3 * juce::jmax (0.0, ms - att) / dec));
        return (float) (hh - 8 - gg * (hh - 20));
    }, {}, fixed (span, 0) + " ms");
}

void ChopFace::drawTransient (juce::Graphics& g, float w, float h)
{
    // A hit through the shaper: as it was, faint, and as it comes out.
    const double sr = 2000;
    const int Nn = 700;
    auto co = [&] (double ms) { return std::exp (-1 / (juce::jmax (0.1, ms) / 1000 * sr)); };
    const double aF = co (1), aS = co (num ("trAttack")), r = co (num ("trRelease")), thr = std::pow (10, num ("trThresh") / 20), out = std::pow (10, num ("trGain") / 20);
    double fast = 0, slow = 0, pk = 0;
    std::vector<double> base, shaped;
    for (int i = 0; i < Nn; ++i)
    {
        const double lv = i < 20 ? 0 : 0.8 * std::exp (-(i - 20) / 90.0);
        fast = lv > fast ? aF * fast + (1 - aF) * lv : r * fast + (1 - r) * lv;
        slow = lv > slow ? aS * slow + (1 - aS) * lv : r * slow + (1 - r) * lv;
        const double q = fast > thr ? juce::jmin (8.0, juce::jmax (0.1, std::pow (fast / (slow + 1e-9), num ("trAmount") / 100))) : 1;
        base.push_back (lv);
        shaped.push_back (lv * q * out);
        pk = juce::jmax (pk, juce::jmax (lv * q * out, lv));
    }
    drawCurve (g, w, h, [&] (float u, float hh) { return (float) (hh - 8 - shaped[(size_t) std::floor (u * (Nn - 1))] / pk * (hh - 22)); },
               [&] (juce::Graphics& gg, float ww, float hh) {
                   auto y = [&] (double v) { return (float) (hh - 8 - v / pk * (hh - 22)); };
                   juce::Path p;
                   for (int x = 4; x <= (int) ww - 4; ++x)
                   {
                       const float v = y (base[(size_t) std::floor ((float) (x - 4) / (ww - 8) * (float) (Nn - 1))]);
                       if (x == 4)
                           p.startNewSubPath ((float) x, v);
                       else
                           p.lineTo ((float) x, v);
                   }
                   gg.setColour (juce::Colours::white.withAlpha (0.28f));
                   gg.strokePath (p, juce::PathStrokeType (1));
                   juce::Path l, d;
                   l.startNewSubPath (0, y (thr));
                   l.lineTo (ww, y (thr));
                   const float dash[] = { 3, 3 };
                   juce::PathStrokeType (1).createDashedStroke (d, l, dash, 2);
                   gg.fillPath (d);
               }, {});
}

namespace
{
void freqGrid (juce::Graphics& g, float w, float h, juce::Colour t3)
{
    const auto f = face::mono (9);
    for (int fq : { 100, 1000, 10000 })
    {
        const float x = 4 + (float) (std::log (fq / 20.0) / std::log (1000.0)) * (w - 8);
        g.setColour (juce::Colours::white.withAlpha (0.06f));
        g.fillRect (juce::Rectangle<float> (x, 0, 1, h));
        g.setColour (t3);
        g.setFont (f);
        const auto t = fq >= 1000 ? juce::String (fq / 1000) + "k" : juce::String (fq);
        juce::GlyphArrangement gl;
        gl.addLineOfText (f, t, fq >= 10000 ? x - 19 : x + 3, h - 4);
        gl.draw (g);
    }
}
} // namespace

void ChopFace::drawEq (juce::Graphics& g, float w, float h)
{
    const double sr = 48000;
    std::vector<std::array<double, 5>> bands;
    if (num ("loCut") > 16)
        bands.push_back (biquad ("hp", num ("loCut"), 0.707, 0, sr));
    bands.push_back (biquad ("peak", num ("lowF"), num ("lowQ"), num ("lowG"), sr));
    bands.push_back (biquad ("peak", num ("highF"), num ("highQ"), num ("highG"), sr));
    if (num ("hiCut") < 19990)
        bands.push_back (biquad ("lp", num ("hiCut"), 0.707, 0, sr));
    const auto t3 = cl ("t3");
    drawCurve (g, w, h, [&] (float u, float hh) {
        double db = 0;
        for (const auto& k : bands)
            db += 20 * std::log10 (mag (k, 20 * std::pow (1000.0, (double) u), sr) + 1e-9);
        return (float) juce::jmax (2.0, juce::jmin ((double) hh - 2, hh / 2 - db * (hh / 44)));
    }, [t3] (juce::Graphics& gg, float ww, float hh) { freqGrid (gg, ww, hh, t3); }, {});
}

void ChopFace::drawFilter (juce::Graphics& g, float w, float h)
{
    const double sr = 48000;
    const auto k = biquad (str ("fltType"), num ("fltFreq"), num ("fltQ"), 0, sr);
    const double m = num ("mix") / 100, gn = std::pow (10, num ("gain") / 20);
    const auto t3 = cl ("t3");
    drawCurve (g, w, h, [&] (float u, float hh) {
        const double db = 20 * std::log10 ((mag (k, 20 * std::pow (1000.0, (double) u), sr) * m + (1 - m)) * gn + 1e-9);
        return (float) juce::jmax (2.0, juce::jmin ((double) hh - 2, hh * 0.32 - db * (hh / 44)));
    }, [t3] (juce::Graphics& gg, float ww, float hh) { freqGrid (gg, ww, hh, t3); }, num ("drive") > 0 ? "drive " + rnd (num ("drive")) + "%" : juce::String());
}

// ─────────────────────────────────────────────────────────────── the list

void ChopFace::drawList (juce::Graphics& g)
{
    // `chopTable`: a row a slice, scrolled.
    if (!hasSound() || !rowPlain.isObject())
        return;
    const auto box = ids["list"].r;
    juce::Graphics::ScopedSaveState clip (g);
    g.reduceClipRegion (box.getSmallestIntegerContainer());
    const auto rr = rectOf (rowPlain["rect"]);
    float peakAbs = 0;
    for (size_t i = 0; i < mono.size(); i += 64)
        peakAbs = juce::jmax (peakAbs, std::abs (mono[i]));
    if (peakAbs <= 0)
        peakAbs = 1;
    const int first = juce::jmax (0, (int) std::floor (listScroll / 20));
    const int last = juce::jmin ((int) slices.size(), first + (int) std::ceil (box.getHeight() / 20) + 2);
    const auto& tailRows = tails["rows"].isArray() ? tails["rows"] : tails["badges"];
    for (int i = first; i < last; ++i)
    {
        const auto& x = slices[(size_t) i];
        const float y = box.getY() + (float) i * 20 - listScroll;
        const auto off = juce::Point<float> (box.getX() - rr.getX(), y - rr.getY());
        const auto& tmpl = i == current ? rowCurrent : sel.count (i) > 0 && rowPicked.isObject() ? rowPicked : rowPlain;
        juce::Graphics::ScopedSaveState keep (g);
        if (x.muted)
            g.beginTransparencyLayer (0.45f);
        face::paintBox (g, tmpl, rectOf (tmpl["rect"]) + juce::Point<float> (box.getX() - rectOf (tmpl["rect"]).getX(), y - rectOf (tmpl["rect"]).getY()));
        if (i == current)
        {
            g.setColour (cl ("acc"));
            g.fillRect (juce::Rectangle<float> (box.getX(), y, 2, 20));
        }
        const auto col = kindColour (x);
        auto kid = [&] (int k) -> const juce::var& { return rowPlain["kids"][k]; };
        auto write = [&] (int k, const juce::String& t, juce::Colour* tint, bool right) {
            const auto& n = kid (k);
            const auto r = rectOf (n["rect"]) + off;
            const auto& run = n["text"].isArray() ? n["text"][0] : (i == current ? rowCurrent["kids"][k]["text"][0] : n["text"][0]);
            const juce::var fv = run["font"].isObject() ? run["font"] : rowPlain["kids"][4]["text"][0]["font"];
            const auto f = face::font (fv);
            g.setFont (f);
            auto c = tint != nullptr ? *tint : face::colour (i == current && rowCurrent["kids"][k]["text"].isArray() ? rowCurrent["kids"][k]["text"][0]["font"]["colour"] : fv["colour"]);
            g.setColour (c);
            const float tw = juce::GlyphArrangement::getStringWidth (f, t);
            const float bl = r.getY() + (r.getHeight() - (f.getAscent() + f.getDescent())) / 2 + f.getAscent();
            juce::GlyphArrangement gl;
            gl.addLineOfText (f, t, right ? r.getRight() - tw : r.getX(), bl);
            gl.draw (g);
        };
        auto colC = col;
        write (0, juce::String (i + 1), &colC, true);
        // Its picture (`chop-mini`, 58 x 16 stretched to 36 x 16).
        {
            const int Wm = 28;
            const double per = (double) (x.e - x.s) / Wm;
            float pk = 0;
            juce::Path p;
            for (int c = 0; c < Wm; ++c)
            {
                float m = 0;
                const auto a0 = (int64_t) std::floor ((double) x.s + c * per);
                const int64_t stp = juce::jmax<int64_t> (1, (int64_t) std::floor (per / 24));
                for (int64_t j = a0; (double) j < (double) a0 + per; j += stp)
                    m = juce::jmax (m, j >= 0 && j < (int64_t) mono.size() ? std::abs (mono[(size_t) j]) : 0.0f);
                pk = juce::jmax (pk, m);
                const float hh = juce::jmax (0.4f, m / peakAbs * 7);
                p.startNewSubPath ((float) (c * 2 + 1), 8 - hh);
                p.lineTo ((float) (c * 2 + 1), 8 + hh);
            }
            const auto r = rectOf (kid (1)["rect"]) + off;
            p.applyTransform (juce::AffineTransform::scale (r.getWidth() / 58, r.getHeight() / 16).translated (r.getX(), r.getY()));
            g.setColour (col.withMultipliedAlpha (0.9f));
            g.strokePath (p, juce::PathStrokeType (1.2f * r.getWidth() / 58));
            const double pkDb = 20 * std::log10 (pk / peakAbs + 1e-10);
            write (6, fixed (pkDb, 1), nullptr, true);
        }
        write (2, x.kind, &colC, false);
        // Its flags: locked, reversed, muted.
        {
            static const char* const flagPaths[] = { "M3 6H9V10.5H3ZM4 6V4A2 2 0 0 1 8 4V6", "M9 3L3 6L9 9Z", "M2 5H4L7 2.5V9.5L4 7H2Z" };
            const bool on[] = { x.locked, x.rev, x.muted };
            for (int f = 0; f < 3; ++f)
            {
                const auto r = rectOf (kid (3)["kids"][f]["rect"]) + off;
                auto p = juce::Drawable::parseSVGPath (flagPaths[f]);
                p.applyTransform (juce::AffineTransform::scale (r.getWidth() / 12, r.getHeight() / 12).translated (r.getX(), r.getY()));
                g.setColour (on[f] ? cl ("acc") : cl ("--track"));
                g.strokePath (p, juce::PathStrokeType (1.3f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
            }
        }
        write (4, fixed ((double) x.s / rate, 3), nullptr, true);
        write (5, fixed ((double) (x.e - x.s) / rate * 1000, 0) + " ms", nullptr, true);
        // The tail's badge.
        if (tailRows.isArray() && i < tailRows.size())
        {
            const auto& b = tailRows[i];
            const auto cls = b["cls"].toString();
            const auto& look = cls == "ok" ? badgeOk : cls == "clamped" ? badgeClamped : badgeSkip;
            if (b["text"].toString().isNotEmpty() && look.isObject())
            {
                auto c = face::colour (look["text"][0]["font"]["colour"]);
                const auto r = rectOf (kid (7)["rect"]) + off;
                const auto f = face::font (look["text"][0]["font"]);
                g.setFont (f);
                g.setColour (c);
                const float tw = juce::GlyphArrangement::getStringWidth (f, b["text"].toString());
                juce::GlyphArrangement gl;
                gl.addLineOfText (f, b["text"].toString(), r.getRight() - tw, r.getCentreY() + (f.getAscent() - f.getDescent()) / 2);
                gl.draw (g);
            }
        }
        write (8, uni ("\xe2\x96\xb6"), nullptr, false);
        if (x.muted)
            g.endTransparencyLayer();
    }
}

// ─────────────────────────────────────────────────────────────── the knobs

void ChopFace::drawKnob (juce::Graphics& g, const juce::String& key)
{
    auto it = ids.find ("knob:" + key);
    auto kt = knobs.find (key);
    if (it == ids.end() || kt == knobs.end())
        return;
    const auto& kn = kt->second;
    const auto& n = it->second.n;
    const double v = num (key), u = toU (kn, v);
    float alpha = knobDim (key) ? 0.36f : 1.0f;
    if (kn.fx)
    {
        static const std::map<juce::String, juce::String> onOf { { "env", "envOn" }, { "trans", "trOn" }, { "eq", "eqOn" }, { "filter", "fltOn" } };
        if (!flag (onOf.at (kn.group)))
            alpha *= 0.42f;
    }
    juce::Graphics::ScopedSaveState keep (g);
    if (alpha < 1)
        g.beginTransparencyLayer (alpha);
    const auto facet = cl ("--f-" + (kn.facet.isEmpty() ? juce::String ("level") : kn.facet));
    // The picture: the knob's glyph, or the processing bar's FXP picture.
    {
        const auto& ps = captured["pics"][kn.fx ? "bar" : "knob"];
        auto style = [&] (const char* cls, juce::Colour accent) {
            MarkStyle s;
            const auto& o = ps[cls];
            const auto stroke = o["stroke"].toString(), fill = o["fill"].toString();
            s.stroke = stroke.startsWith ("rgb") ? c2d::css (stroke) : accent;
            s.fill = fill.startsWith ("rgb") ? c2d::css (fill) : (fill.startsWith ("oklch") ? cl ("t3") : accent);
            if (juce::String (cls) == "a")
                s.stroke = accent;
            if (juce::String (cls) == "af")
                s.fill = accent;
            s.width = (float) o["width"].toString().getDoubleValue();
            if (s.width <= 0)
                s.width = 1;
            s.opacity = o["opacity"].isVoid() ? 1.0f : (float) o["opacity"].toString().getDoubleValue();
            return s;
        };
        std::map<juce::String, MarkStyle> styles { { "a", style ("a", facet) }, { "f", style ("f", facet) }, { "af", style ("af", facet) }, { "ff", style ("ff", facet) } };
        if (kn.fx)
        {
            if (const auto* gg = child (n, "gg"))
            {
                auto look = kn.fxLook;
                if (key == "fltFreq")
                    look = str ("fltType") == "bp" ? "freq" : str ("fltType") == "hp" ? "highpass" : "lowpass";
                const double nn = kn.log ? std::log (v / kn.min) / std::log (kn.max / kn.min) : (v - kn.min) / (kn.max - kn.min);
                drawPic (g, fxp (look, juce::jlimit (0.0, 1.0, nn)), rectOf ((*gg)["rect"]), 64, 48, styles);
            }
        }
        else if (const auto* pic = child (n, "ui-pic"))
            drawPic (g, glyph (key, u, v), rectOf ((*pic)["rect"]), 22, 16, styles);
    }
    // The cap, its glow following the value (`--v`).
    if (const auto* cap = child (n, "ui-cap"))
    {
        auto c = juce::JSON::parse (juce::JSON::toString (*cap, true));
        const auto accent = cl ("--look-accent");
        if (auto* lays = c["layers"].getArray(); lays != nullptr && !lays->isEmpty())
            if (auto* stops = lays->getReference (0)["stops"].getArray(); stops != nullptr && !stops->isEmpty())
            {
                juce::Array<juce::var> colr { (int) accent.getRed(), (int) accent.getGreen(), (int) accent.getBlue(), u * 0.42 };
                if (auto* o = stops->getReference (0).getDynamicObject())
                    o->setProperty ("colour", colr);
            }
        if (auto* sh = c["shadows"].getArray(); sh != nullptr && sh->size() >= 5)
            if (auto* o = sh->getReference (4).getDynamicObject())
            {
                juce::Array<juce::var> colr { (int) accent.getRed(), (int) accent.getGreen(), (int) accent.getBlue(), u * 0.28 };
                o->setProperty ("colour", colr);
                o->setProperty ("blur", u * 14);
            }
        face::paintBox (g, c, rectOf ((*cap)["rect"]));
    }
    // The ring: the track, the arc from nought with its glow, the pointer.
    if (const auto* ring = child (n, "ui-ring"))
    {
        const auto r = rectOf ((*ring)["rect"]);
        const float cc = r.getWidth() / 2, rr = cc - 4;
        const float a0 = pi * 0.75f, sweep = pi * 1.5f;
        juce::Path track, arc;
        track.addCentredArc (r.getX() + cc, r.getY() + cc, rr, rr, 0, a0 + pi / 2, a0 + sweep + pi / 2, true);
        g.setColour (cl ("--track"));
        g.strokePath (track, juce::PathStrokeType (2.0f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
        if (u > 0.0005)
        {
            arc.addCentredArc (r.getX() + cc, r.getY() + cc, rr, rr, 0, a0 + pi / 2, a0 + sweep * (float) u + pi / 2, true);
            const auto arcC = cl ("--arc");
            const float glow = (float) dnum (captured["cl"]["glow"], 1);
            g.setColour (arcC.withMultipliedAlpha (0.18f));
            g.strokePath (arc, juce::PathStrokeType (2.0f + 3.0f * glow, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
            g.setColour (arcC);
            g.strokePath (arc, juce::PathStrokeType (2.0f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
        }
        const float a = a0 + sweep * (float) u;
        g.setColour (cl ("t"));
        juce::Path ptr;
        ptr.startNewSubPath (r.getX() + cc + std::cos (a) * rr * 0.2f, r.getY() + cc + std::sin (a) * rr * 0.2f);
        ptr.lineTo (r.getX() + cc + std::cos (a) * rr * 0.62f, r.getY() + cc + std::sin (a) * rr * 0.62f);
        g.strokePath (ptr, juce::PathStrokeType (2.0f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
    }
    // The reading.
    if (const auto* val = child (n, "ui-kval"))
    {
        const auto t = fmtKnob (kn, v);
        const auto r = rectOf ((*val)["rect"]);
        const auto f = face::font ((*val)["text"][0]["font"]);
        const float tw = juce::GlyphArrangement::getStringWidth (f, t) + 6;
        // Centred under the knob, as the page's column centres it.
        const auto lab = child (n, "ui-lab");
        const float cx = lab != nullptr ? rectOf ((*lab)["rect"]).getCentreX() : r.getCentreX();
        face::paintText (g, *val, juce::Rectangle<float> (cx - tw / 2, r.getY(), tw, r.getHeight()), t, juce::Justification::centred);
    }
    if (alpha < 1)
        g.endTransparencyLayer();
}

std::vector<std::pair<juce::String, double>> ChopFace::profile (float scale)
{
    std::vector<std::pair<juce::String, double>> out;
    for (auto& l : layers)
    {
        juce::Image img (juce::Image::ARGB, juce::jmax (1, (int) std::ceil ((float) l->getWidth() * scale)), juce::jmax (1, (int) std::ceil ((float) l->getHeight() * scale)), true);
        juce::Graphics g (img);
        g.addTransform (juce::AffineTransform::scale (scale));
        const double t0 = juce::Time::getMillisecondCounterHiRes();
        l->draw (g);
        out.push_back ({ l->name, juce::Time::getMillisecondCounterHiRes() - t0 });
    }
    return out;
}
