// Grain's drawings: everything the page draws on its canvases and every
// reading it writes, ported from its JS line for line through c2d::Context
// (ui/app/401-grain-views.js, 403-grain-modulate.js, 405-grain-keys.js,
// 406-grain-page.js, 408-grain-tray.js, 389-one-keyboard.js, the bars of
// 402-grain-controls.js and the glyphs of grain-glyphs.js).

#include "GrainFace.h"

#include "Canvas2D.h"
#include "GrainGlyphs.h"

#include <cmath>

namespace
{
double dnum (const juce::var& v, double fallback = 0.0)
{
    if (v.isString())
        return v.toString().getDoubleValue();
    if (v.isBool())
        return (bool) v ? 1.0 : 0.0;
    return v.isVoid() || v.isUndefined() ? fallback : (double) v;
}

juce::Rectangle<float> rectOf (const juce::var& r)
{
    return { (float) dnum (r[0]), (float) dnum (r[1]), (float) dnum (r[2]), (float) dnum (r[3]) };
}

bool hasClass (const juce::var& n, const char* c)
{
    return juce::StringArray::fromTokens (n["cls"].toString(), " ", "").contains (c);
}

juce::String uni (const char* s) { return juce::String::fromUTF8 (s); }
double jsRound (double v) { return std::floor (v + 0.5); }
juce::String fixed (double v, int places)
{
    const double p = std::pow (10.0, places);
    double r = std::floor (std::abs (v) * p + 0.5) / p;
    auto s = juce::String (r, places);
    if (v < 0 && ! juce::exactlyEqual (r, 0.0))
        s = "-" + s;
    return s;
}
juce::String rnd (double v) { return juce::String ((int64_t) jsRound (v)); }
double clamp01 (double v) { return juce::jlimit (0.0, 1.0, v); }
constexpr float tau = juce::MathConstants<float>::twoPi;

const juce::String lfoColours[] = { "#5cc8e6", "#a48cf2", "#ee72a8", "#9bd36c" };
const char* const lfoShapePaths[] = {
    "M1 7 C3 0,6 0,8 7 S13 14,15 7", "M1 7 L4.5 1 L11.5 13 L15 7", "M1 13 L14 1 V13", "M1 1 L14 13 V1",
    "M1 2 H8 V12 H15", "M1 9 H4 V3 H7 V11 H10 V5 H13 V8 H15", "M1 9 C3 9,3 3,5 3 S7 11,9 11 S12 5,15 6",
};
const char* const lfoShapes[] = { "sine", "tri", "up", "down", "square", "steps", "smooth" };

double gsRnd (double n)
{
    const double x = std::sin (n * 127.1 + 311.7) * 43758.5453;
    return x - std::floor (x);
}

// gsLfoVal.
double lfoVal (const juce::String& shape, double u, double cyc)
{
    if (! juce::exactlyEqual (u, 1.0))
        u = std::fmod (std::fmod (u, 1.0) + 1.0, 1.0);
    if (shape == "sine")
        return 0.5 + 0.5 * std::sin (u * tau);
    if (shape == "tri")
        return u < 0.25 ? 0.5 + 2 * u : u < 0.75 ? 1.5 - 2 * u : 2 * u - 1.5;
    if (shape == "up")
        return u;
    if (shape == "down")
        return 1 - u;
    if (shape == "square")
        return u < 0.5 ? 1 : 0;
    if (shape == "steps")
        return gsRnd (cyc * 8 + std::floor (u * 8));
    const double k = u * 4, i = std::floor (k), f = k - i, a = gsRnd (cyc * 4 + i), b = gsRnd (cyc * 4 + i + 1);
    return a + (b - a) * (0.5 - 0.5 * std::cos (juce::MathConstants<double>::pi * f));
}

struct Cl
{
    juce::String wave, bloom, acc, on, track, t, t2, t3, mono = "monospace", sans = "sans-serif";
    float glow = 1.1f;
};

// wvPath, wvTrace, wvUnder, wvDot.
c2d::Path wvPath (std::function<std::pair<float, float> (float)> fn, int n)
{
    c2d::Path p;
    for (int i = 0; i <= n; ++i)
    {
        const auto [x, y] = fn ((float) i / (float) n);
        if (i)
            p.lineTo (x, y);
        else
            p.moveTo (x, y);
    }
    return p;
}

void wvTrace (c2d::Context& c, const c2d::Path& p, const Cl& cl, float lw = 1.6f, float g = 1)
{
    c.lineJoin = "round";
    c.lineCap = "round";
    const float glow = cl.glow * g;
    if (glow > 0)
    {
        c.setStroke ("rgba(" + cl.bloom + "," + juce::String (0.16 * glow) + ")");
        c.lineWidth = lw * 3.6f;
        c.shadowBlur = 10 * glow;
        c.setShadow ("rgba(" + cl.bloom + "," + juce::String (0.4 * juce::jmin (1.0f, glow)) + ")");
        c.stroke (p);
        c.shadowBlur = 0;
    }
    c.setStroke (cl.wave);
    c.lineWidth = lw;
    c.stroke (p);
}

void wvUnder (c2d::Context& c, const c2d::Path& p, float x0, float x1, float base, float top, const Cl& cl, float a = 0.2f)
{
    c2d::Path f = p;
    f.lineTo (x1, base);
    f.lineTo (x0, base);
    f.closePath();
    auto g = c.createLinearGradient (0, top, 0, base);
    g.addColorStop (0, "rgba(" + cl.bloom + "," + juce::String (a) + ")");
    g.addColorStop (1, "rgba(" + cl.bloom + ",0)");
    c.fillStyle = g;
    c.fill (f);
}

void wvDot (c2d::Context& c, float x, float y, float r, const juce::String& col)
{
    c.setFill (col);
    c.shadowBlur = 9;
    c.setShadow (col);
    c.beginPath();
    c.arc (x, y, r, 0, tau);
    c.fill();
    c.shadowBlur = 0;
}

// gsLbl: a label on a dark chip, so it reads over the wave.
void gsLbl (c2d::Context& c, const juce::String& tx, float x, float y, const juce::String& col, const juce::String& bg = "rgba(5,6,9,.78)", bool right = false)
{
    const float tw = c.measureText (tx), x0 = right ? x - tw : x;
    c.setFill (bg);
    c.fillRect (x0 - 4, y - 9, tw + 8, 12);
    c.setFill (col);
    c.fillText (tx, x0, y);
}
} // namespace

// ──────────────────────────────────────────────────────────────── the colours

static Cl colours (const juce::var& cl)
{
    Cl c;
    c.wave = cl["wave"].toString();
    c.bloom = cl["bloom"].toString();
    c.acc = cl["acc"].toString();
    c.on = cl["on"].toString();
    c.track = cl["track"].toString();
    c.t = cl["t"].toString();
    c.t2 = cl["t2"].toString();
    c.t3 = cl["t3"].toString();
    c.glow = (float) dnum (cl["glow"], 1.1);
    return c;
}

// ─────────────────────────────────────────────────────────────── the text

void GrainFace::writeText (juce::Graphics& g, const Node& n, const juce::String& text, juce::Justification just)
{
    face::paintText (g, n.n, n.r, text, just);
}

void GrainFace::writeChip (juce::Graphics& g, const Node& n, const juce::String& text, juce::Rectangle<float>* outBox)
{
    // Saying what the page said: its own picture of it.
    if (auto* runs = n.n["text"].getArray(); runs != nullptr && runs->size() == 1 && (*runs)[0]["text"].toString() == text && shown != nullptr)
    {
        shown->drawPart (g, n.n);
        if (outBox != nullptr)
            *outBox = n.r;
        return;
    }
    // A chip that grows with its words (inline-flex, padding 0 7px).
    auto* runs = n.n["text"].getArray();
    const auto f = runs != nullptr && !runs->isEmpty() ? face::font ((*runs)[0]["font"]) : face::sans (11);
    const float w = juce::GlyphArrangement::getStringWidth (f, text) + 14;
    auto r = n.r.withWidth (w);
    face::paintBox (g, n.n, r);
    face::paintText (g, n.n, r.reduced (7, 0), text, juce::Justification::centredLeft);
    if (outBox != nullptr)
        *outBox = r;
}

// ─────────────────────────────────────────────────────────────── the bars

void GrainFace::drawGlyph (juce::Graphics& g, const juce::String& k, juce::Rectangle<float> r, const juce::String& colour, double v)
{
    const auto& c = ctls[k];
    const double t = c.moves && v > 0 ? juce::Time::getMillisecondCounterHiRes() / 1000.0 : 0;
    const std::string inner = k == "seed" ? gg::draw ("seed", v, 0) : gg::draw (k.toStdString(), c.sw ? (v >= 0.5 ? 1 : 0) : v, t);
    if (inner.empty())
        return;
    const auto t3 = captured["cl"]["t3"].toString();
    juce::String s (inner.c_str());
    s = s.replace ("class=\"af\"", "fill=\"" + colour + "\" stroke=\"none\"")
            .replace ("class=\"a\"", "fill=\"none\" stroke=\"" + colour + "\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"")
            .replace ("class=\"ff\"", "fill=\"" + t3 + "\" opacity=\".55\"")
            .replace ("class=\"f\"", "fill=\"none\" stroke=\"" + t3 + "\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" opacity=\".7\"")
            .replace ("class=\"ta\"", "fill=\"" + colour + "\" font-size=\"10\" font-family=\"Menlo\"")
            .replace ("class=\"t\"", "fill=\"" + t3 + "\" font-size=\"10\" font-family=\"Menlo\"");
    const auto key = s + "|" + juce::String (r.getWidth()) + "x" + juce::String (r.getHeight());
    auto& slot = glyphCache[s];
    if (slot == nullptr)
    {
        if (glyphCache.size() > 600)
            glyphCache.clear();
        glyphCache[s] = juce::Drawable::createFromSVGString ("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 48\" width=\"64\" height=\"48\" overflow=\"visible\">" + s + "</svg>");
    }
    juce::ignoreUnused (key);
    if (auto* d = glyphCache[s].get())
    {
        // viewBox 64 x 48 in its box, centred (preserveAspectRatio meet).
        const float sc = juce::jmin (r.getWidth() / 64.0f, r.getHeight() / 48.0f);
        const float ox = r.getX() + (r.getWidth() - 64 * sc) / 2, oy = r.getY() + (r.getHeight() - 48 * sc) / 2;
        d->draw (g, 1.0f, juce::AffineTransform::scale (sc).translated (ox, oy));
    }
}

void GrainFace::drawBar (juce::Graphics& g, const juce::String& k)
{
    if (fxView || shown == nullptr)
        return;
    auto& p = cur();
    auto it = p.bars.find (k);
    if (it == p.bars.end())
        return;
    const auto& b = it->second;
    const auto& c = ctls[k];
    const double v = read (k);
    const float op = dimmed (k) ? 0.3f : 1.0f;
    const auto colour = b.n["data"]["gg"].toString();
    std::set<int> without;
    const auto* svg = child (b.n, "svg");
    if (svg != nullptr)
        without.insert ((int) (*svg)["i"]);
    const auto* bf = child (b.n, "gs-bf");
    const auto* bv = child (b.n, "gs-bv");
    const auto* bw = child (b.n, "gs-bw");
    const auto* tg = child (b.n, "gs-tg");
    const auto* seg = child (b.n, "gs-seg");
    for (const auto* x : { bf, bv, tg })
        if (x != nullptr)
            without.insert ((int) (*x)["i"]);
    if (seg != nullptr)
        if (auto* kids = (*seg)["kids"].getArray())
            for (const auto& kid : *kids)
                without.insert ((int) kid["i"]);
    // An LFO on it: the well's ring in the LFO's colour (gsLfoMarkBar).
    int lfoOn = -1;
    double reach = 0;
    const auto tid = lfoId (k);
    for (int i = 0; i < 4; ++i)
        if (lfo[(size_t) i].targets.contains (tid))
        {
            if (lfoOn < 0)
                lfoOn = i;
            reach += lfo[(size_t) i].depth;
        }
    shown->drawPart (g, b.n, {}, op, &without);

    juce::Graphics::ScopedSaveState keep (g);
    if (op < 1.0f)
        g.beginTransparencyLayer (op);
    if (svg != nullptr)
        drawGlyph (g, k, rectOf ((*svg)["rect"]), colour.isEmpty() ? captured["cl"]["t3"].toString() : colour, v);
    if (c.sw && tg != nullptr)
    {
        const bool on = v >= 0.5;
        const auto r = rectOf ((*tg)["rect"]);
        const auto& look = on ? tgOn : tgOff;
        if (look.isObject())
            face::paintBox (g, look, r);
        if (auto* led = child (*tg, "i"))
        {
            const auto lr = rectOf ((*led)["rect"]);
            if (on)
            {
                const auto col = c2d::css (colour);
                juce::DropShadow (col, 6, {}).drawForRectangle (g, lr.toNearestInt());
                g.setColour (col);
            }
            else
                g.setColour (c2d::css (captured["cl"]["track"].toString()));
            g.fillEllipse (lr);
        }
        if (auto* span = child (*tg, "span"))
        {
            const auto* lookSpan = look.isObject() ? child (look, "span") : nullptr;
            face::paintText (g, lookSpan != nullptr ? *lookSpan : *span, rectOf ((*span)["rect"]).withWidth (200), c.label);
        }
    }
    else if (!c.seg.isEmpty() && seg != nullptr)
    {
        if (auto* kids = (*seg)["kids"].getArray())
            for (int i = 0; i < kids->size(); ++i)
            {
                const auto r = rectOf ((*kids)[i]["rect"]);
                const auto& look = i == (int) v ? segOn : segOff;
                if (look.isObject())
                {
                    face::paintBox (g, look, r);
                    face::paintText (g, look, r, c.seg[i], juce::Justification::centred);
                }
            }
    }
    else if (bw != nullptr)
    {
        const auto wr = rectOf ((*bw)["rect"]);
        const double n = toN (c, v), z = c.bip ? toN (c, 0) : 0, a = juce::jmin (n, z), bb = juce::jmax (n, z);
        const float W = wr.getWidth() - 8;
        juce::Graphics::ScopedSaveState clip (g);
        g.reduceClipRegion (face::box (wr, (*bw)["radius"]));
        if (bf != nullptr)
        {
            juce::Rectangle<float> fr (wr.getX() + 4 + W * (float) a, wr.getY() + 2, W * (float) (bb - a), wr.getHeight() - 4);
            juce::Graphics::ScopedSaveState mirror (g);
            if (n < z)
                g.addTransform (juce::AffineTransform::scale (-1, 1, fr.getCentreX(), 0));
            face::paintBox (g, *bf, fr);
        }
        // The fill's edge in the control's colour.
        {
            const auto col = c2d::css (colour);
            const float ex = n < z ? wr.getX() + 4 + W * (float) a - 1 : wr.getX() + 4 + W * (float) bb - 1;
            juce::DropShadow (col.withMultipliedAlpha (0.6f), 5, {}).drawForRectangle (g, juce::Rectangle<float> (ex, wr.getY() + 2, 2, wr.getHeight() - 4).toNearestInt());
            g.setColour (col);
            g.fillRect (ex, wr.getY() + 2, 2.0f, wr.getHeight() - 4);
        }
        if (lfoOn >= 0)
        {
            const auto mc = c2d::css (lfoColours[lfoOn]);
            g.setColour (mc);
            g.drawRoundedRectangle (wr.reduced (0.75f), 4, 1.5f);
            const double lo = clamp01 (n - reach), hi = clamp01 (n + reach);
            g.setColour (mc.withMultipliedAlpha (0.9f));
            g.fillRect (wr.getX() + 4 + W * (float) lo, wr.getBottom() - 3, W * (float) (hi - lo), 2.0f);
            const double heard = dnum (lfoState["heard"][juce::Identifier (tid)], v);
            const float dx = wr.getX() + 4 + W * (float) toN (c, heard);
            juce::DropShadow (mc, 6, {}).drawForRectangle (g, juce::Rectangle<float> (dx - 2.5f, wr.getBottom() - 6, 5, 5).toNearestInt());
            g.fillEllipse (dx - 2.5f, wr.getBottom() - 6, 5, 5);
        }
        if (bv != nullptr)
        {
            const auto text = fmt (c, v);
            auto* runs = (*bv)["text"].getArray();
            const auto f = runs != nullptr && !runs->isEmpty() ? face::font ((*runs)[0]["font"]) : face::mono (11);
            const float tw = juce::GlyphArrangement::getStringWidth (f, text);
            const auto br = rectOf ((*bv)["rect"]);
            const juce::Rectangle<float> box (br.getRight() - tw - 8, br.getY() - 2, tw + 8, 16);
            face::paintBox (g, *bv, box);
            face::paintText (g, *bv, box.reduced (4, 0), text, juce::Justification::centredRight);
        }
    }
    if (op < 1.0f)
        g.endTransparencyLayer();
}

// ─────────────────────────────────────────────────────────────── SOURCE

void GrainFace::loadPeaks()
{
    const auto [a, b] = cloudView();
    if (fileFrames <= 0)
        return;
    if (std::abs (a - peaksA) < 1e-6 && std::abs (b - peaksB) < 1e-6 && !peaks.empty())
        return;
    const int cols = 1338 - 12;
    std::vector<float> out ((size_t) cols * 3 * 2);
    uint64_t info[3] {};
    int n = 0;
    const auto from = (uint64_t) std::floor (a * fileRate), to = (uint64_t) std::ceil (b * fileRate);
    call ([&] (NaApp* app) -> int64_t {
        n = na_grain_peaks (app, id, from, to, (uint32_t) cols, out.data(), (uint32_t) out.size(), info);
        return 0;
    });
    peakCols = juce::jmax (0, n);
    peaks.assign (out.begin(), out.begin() + (std::ptrdiff_t) juce::jmin ((size_t) peakCols * 3, out.size()));
    peaksA = a;
    peaksB = b;
    // gsRidge: each column's envelope, 0 to 1 of the loudest.
    ridge.assign ((size_t) cols, 0.0f);
    float pk = 0;
    for (int x = 0; x < cols && peakCols > 0; ++x)
    {
        const int i = juce::jlimit (0, peakCols - 1, (int) ((double) x / cols * peakCols));
        const float m = juce::jmax (std::abs (peaks[(size_t) i]), std::abs (peaks[(size_t) (peakCols + i)]));
        const float q = peaks[(size_t) (2 * peakCols + i)];
        ridge[(size_t) x] = m * 0.55f + q * 0.9f;
        pk = juce::jmax (pk, ridge[(size_t) x]);
    }
    if (pk > 0)
        for (auto& r : ridge)
            r /= pk;
    cloudKey.clear();
}

void GrainFace::drawCloudStatic (juce::Graphics& gr, float w, float h)
{
    // gsRenderCloudStatic: the sound, mirrored about its centre, its hue its
    // brightness along time (no spectrum here: the middle hue).
    c2d::Context c (gr, w, h);
    const auto cl = colours (captured["cl"]);
    const auto [a, b] = cloudView();
    const float W = w - 12, yc = h * 0.6f, A = h * 0.27f;
    auto E = [&] (float x) { return ridge.empty() ? 0.0f : ridge[(size_t) juce::jlimit (0, (int) ridge.size() - 1, (int) std::floor (x))]; };
    c.setStroke ("rgba(255,255,255,.03)");
    c.lineWidth = 1;
    c.font = "9px " + cl.mono;
    c.setFill (cl.t3);
    double st = 120;
    for (double s : { 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0 })
        if ((b - a) / s <= 8)
        {
            st = s;
            break;
        }
    for (double s = std::ceil (a / st) * st; s < b; s += st)
    {
        const float x = 6 + (float) ((s - a) / (b - a)) * W;
        c.beginPath();
        c.moveTo (x, 8);
        c.lineTo (x, h - 14);
        c.stroke();
        if (std::abs (s / (st * 2) - jsRound (s / (st * 2))) < 0.01 && x < w - 40)
            c.fillText (fixed (s, st * 2 < 1 ? 2 : 0) + " s", x + 3, h - 4);
    }
    for (int k = 4; k >= 1; --k)
    {
        const auto p = wvPath ([&] (float u) { return std::pair<float, float> (6 + u * W + (float) k * 6, yc - (float) k * 7 - E (u * W) * A * (1 - 0.06f * (float) k)); }, (int) std::floor (W / 2));
        c.setStroke ("hsla(" + juce::String (205 - 28 * k) + ",60%,72%," + fixed (0.04 + 0.025 * (4 - k), 3) + ")");
        c.stroke (p);
    }
    for (int x = 0; x < (int) W; ++x)
    {
        const float e = juce::jmax (0.012f, ridge.empty() ? 0.0f : ridge[(size_t) juce::jmin (x, (int) ridge.size() - 1)]);
        const float hue = 205 - 175 * 0.5f, top = yc - e * A, bot = yc + e * A * 0.92f;
        auto grd = c.createLinearGradient (0, top, 0, bot);
        const auto hs = juce::String (hue);
        grd.addColorStop (0, "hsla(" + hs + ",82%,66%,.6)");
        grd.addColorStop (0.42f, "hsla(" + hs + ",75%,46%,.16)");
        grd.addColorStop (0.58f, "hsla(" + hs + ",75%,46%,.16)");
        grd.addColorStop (1, "hsla(" + hs + ",82%,62%,.4)");
        c.fillStyle = grd;
        c.fillRect (6 + (float) x, top, 1.1f, bot - top);
    }
    const auto top = wvPath ([&] (float u) { return std::pair<float, float> (6 + u * W, yc - E (u * W) * A); }, (int) W);
    const auto bot = wvPath ([&] (float u) { return std::pair<float, float> (6 + u * W, yc + E (u * W) * A * 0.92f); }, (int) W);
    c.setStroke ("rgba(" + cl.bloom + ",.22)");
    c.stroke (bot);
    wvTrace (c, top, cl, 1.2f, 0.8f);
    c.setFill ("rgba(255,255,255,.08)");
    c.fillRect (6, yc - 0.5f, W, 1);
}

void GrainFace::drawCloud (juce::Graphics& gr, float w, float h)
{
    if (fileFrames <= 0)
        return;
    loadPeaks();
    const float scale = gr.getInternalContext().getPhysicalPixelScaleFactor();
    const auto key = juce::String (peaksA) + "|" + juce::String (peaksB) + "|" + juce::String (scale) + "|" + juce::String (face::stamp());
    if (key != cloudKey || !cloudStatic.isValid())
    {
        cloudKey = key;
        cloudStatic = juce::Image (juce::Image::ARGB, (int) std::ceil (w * scale), (int) std::ceil (h * scale), true);
        juce::Graphics cg (cloudStatic);
        cg.addTransform (juce::AffineTransform::scale (scale));
        drawCloudStatic (cg, w, h);
    }
    gr.drawImageTransformed (cloudStatic, juce::AffineTransform::scale (1.0f / scale));
    c2d::Context c (gr, w, h);
    const auto cl = colours (captured["cl"]);
    const auto [a, b] = cloudView();
    const float W = w - 12, yc = h * 0.6f, A = h * 0.27f, K = (h * 0.4f - 16) / 12;
    auto X = [&, va = a, vb = b] (double s) { return (float) (6 + (s - va) / (vb - va) * (w - 12)); };
    const bool act = cloudActive();
    c.font = "9px " + cl.mono;
    for (int s : { 12, 6, 0, -6, -12 })
    {
        const float y = yc - (float) s * K;
        c.setFill (s ? "rgba(255,255,255,.2)" : "rgba(255,255,255,.34)");
        c.fillRect (w - (s % 12 ? 9 : 13), y - 0.5f, s % 12 ? 5.0f : 9.0f, 1);
        if (s % 12 == 0)
        {
            c.setFill (cl.t3);
            c.textAlign = "right";
            c.fillText (s ? (s > 0 ? juce::String ("+12") : uni ("\xe2\x88\x92" "12")) : juce::String ("0 st"), w - 16, y + 3);
            c.textAlign = "left";
        }
    }
    // gsReadWrap.
    auto wrap = [&] (double rp) {
        const auto [la, lb] = loopSecs();
        auto modp = [] (double x, double m) { return std::fmod (std::fmod (x, m) + m, m); };
        if (read ("wrap") >= 0.5)
            return loopOn ? la + modp (rp - la, lb - la) : modp (rp, fileLen());
        return loopOn ? juce::jlimit (la, lb, rp) : juce::jlimit (0.0, fileLen(), rp);
    };
    const double hp = wrap (head() + (act ? read ("position") * fileLen() : 0));
    const float hx = X (hp);
    const double sp = act ? read ("positionJitterMs") / 1000 : 0, ww = read ("windowMs") / 1000;
    if (sp > 0.0005)
    {
        const float x0 = X (hp - sp), x1 = X (hp + sp);
        auto grd = c.createLinearGradient (x0, 0, x1, 0);
        grd.addColorStop (0, "rgba(124,240,208,0)");
        grd.addColorStop (0.5f, "rgba(124,240,208,.05)");
        grd.addColorStop (1, "rgba(124,240,208,0)");
        c.fillStyle = grd;
        c.fillRect (x0, 6, x1 - x0, h - 20);
        c.setStroke ("rgba(124,240,208,.2)");
        c.setLineDash ({ 2, 5 });
        c.beginPath();
        c.moveTo (x0, 10);
        c.lineTo (x0, h - 16);
        c.moveTo (x1, 10);
        c.lineTo (x1, h - 16);
        c.stroke();
        c.setLineDash ({});
    }
    const float bw = juce::jmax (6.0f, X (hp + ww / 2) - X (hp - ww / 2)), bx = hx - bw / 2;
    c.setFill ("rgba(255,255,255,.03)");
    c.setStroke (act ? "rgba(255,255,255,.26)" : "rgba(255,255,255,.13)");
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect (bx, 8, bw, h - 24, 3);
    c.fill();
    c.stroke();
    c.setFill ("rgba(255,255,255,.55)");
    c.beginPath();
    c.roundRect (hx - 6, 5, 12, 4, 2);
    c.fill();
    if (!ridge.empty())
    {
        c.save();
        c.beginPath();
        c.rect (bx, 0, bw, h);
        c.clip();
        const auto p = wvPath ([&] (float u) { const float x = bx + u * bw; return std::pair<float, float> (x, yc - ridge[(size_t) juce::jlimit (0, (int) W - 1, (int) std::floor (x - 6))] * A); }, juce::jmax (4, (int) std::ceil (bw)));
        c.setStroke (cl.acc);
        c.lineWidth = 1.8f;
        c.shadowBlur = 10;
        c.setShadow (cl.acc);
        c.stroke (p);
        c.restore();
    }
    // gsDrawGrains: the next moments of the schedule.
    if (auto* gs = schedule["grains"].getArray())
    {
        const double sr = dnum (schedule["sampleRate"], fileRate);
        const double at = playing ? position / deviceRate : engineFromSrc (head() * fileRate) / deviceRate;
        const double now = at * sr, span = 0.6 * sr, base = read ("semitones");
        const double pk = 0.06 + 0.88 * read ("envelope");
        c.lineWidth = 1;
        c.lineJoin = "round";
        int drawn = 0;
        for (const auto& ev : *gs)
        {
            const double t0 = dnum (ev[0]);
            if (t0 < now || t0 > now + span)
                continue;
            const double s = dnum (ev[1]) / sr, life = dnum (ev[2]) / sr;
            if (s < a || s > b)
                continue;
            const double u = (t0 - now) / span, al = (playing || !held.empty() ? 0.9 : 0.35) * (1 - u * 0.8) * (act ? 1 : 0.35);
            const float x = X (s), w2 = juce::jmax (5.0f, X (s + life / 2) - X (s - life / 2));
            const float y = juce::jlimit (10.0f, h - 16, yc - (float) juce::jlimit (-13.0, 13.0, dnum (ev[3]) - base) * K);
            const float hh = (float) (12 + A * 1.7 * clamp01 (dnum (ev[4]) * 4)) * (act ? 1.0f : 0.6f);
            c2d::Path p;
            p.moveTo (x - w2 / 2, y);
            for (int k = 1; k <= 14; ++k)
            {
                const double q = k / 14.0;
                const double env = q < pk ? 0.5 - 0.5 * std::cos (juce::MathConstants<double>::pi * q / pk) : 0.5 + 0.5 * std::cos (juce::MathConstants<double>::pi * (q - pk) / (1 - pk));
                p.lineTo (x - w2 / 2 + (float) q * w2, y - (float) env * hh);
            }
            c.setFill (act ? "rgba(" + cl.bloom + "," + fixed (al * 0.12, 3) + ")" : "rgba(207,166,108," + fixed (al * 0.1, 3) + ")");
            c.fill (p);
            c.setStroke (act ? "rgba(255,255,255," + fixed (juce::jmin (1.0, al * 0.8), 3) + ")" : "rgba(226,190,140," + fixed (al * 0.6, 3) + ")");
            c.stroke (p);
            if (++drawn >= 140)
                break;
        }
    }
    c.setFill (cl.t2);
    c.fillText ((ww * 1000 < 10 ? fixed (ww * 1000, 1) : rnd (ww * 1000)) + " ms", juce::jmin (bx + bw + 4, w - 60), h - 18);
    drawMarks (gr, w, h);
    drawLoop (gr, w, h);
    // Poly's heads and the note playing.
    c2d::Context c3 (gr, w, h);
    if (auto* hs = live["heads"].getArray())
        for (const auto& hd : *hs)
        {
            const double s = dnum (hd["src"]);
            if (s < a || s > b)
                continue;
            const float x = X (s);
            c3.setStroke ("hsl(200,70%,68%)");
            c3.globalAlpha = (float) juce::jlimit (0.25, 1.0, dnum (hd["env"]));
            c3.beginPath();
            c3.moveTo (x, 18);
            c3.lineTo (x, h - 18);
            c3.stroke();
            c3.globalAlpha = 1;
        }
}

void GrainFace::drawMarks (juce::Graphics& gr, float w, float h)
{
    c2d::Context c (gr, w, h);
    const auto cl = colours (captured["cl"]);
    const auto [a, b] = cloudView();
    auto X = [&, va = a, vb = b] (double s) { return (float) (6 + (s - va) / (vb - va) * (w - 12)); };
    c.save();
    c.beginPath();
    c.rect (6, 0, w - 12, h);
    c.clip();
    c.font = "9px " + cl.mono;
    const auto& e = engine;
    if (e == "wsola" || e == "hybrid")
    {
        const bool pres = e == "hybrid" || read ("preserveTransients") >= 0.5;
        gsLbl (c, "0 transients" + juce::String (pres ? " kept" : ""), 10, h - 20, "#e8a493");
    }
    if (e == "vocoder" || e == "pvsola" || e == "hybrid")
    {
        const double fr = read ("vocWindowMs") / 1000 / 2;
        c.setFill ("rgba(" + cl.bloom + ",.55)");
        if ((b - a) / fr < 600)
            for (double s = std::ceil (a / fr) * fr; s < b; s += fr)
                c.fillRect (X (s) - 0.5f, h - 16, 1, 5);
        const double anchors = read ("anchorFrames");
        if (e == "pvsola")
        {
            const double fn = fr * anchors;
            c.setFill ("rgba(207,166,108,.9)");
            if ((b - a) / fn < 600)
                for (double s = std::ceil (a / fn) * fn; s < b; s += fn)
                {
                    const float x = X (s);
                    c.beginPath();
                    c.moveTo (x - 3, h - 23);
                    c.lineTo (x + 3, h - 23);
                    c.lineTo (x, h - 18);
                    c.fill();
                }
        }
        gsLbl (c, e == "pvsola" ? "frame " + rnd (fr * 1000) + uni (" ms \xc2\xb7 anchor every ") + rnd (fr * anchors * 1000) + " ms" : "frame every " + rnd (fr * 1000) + " ms", e == "hybrid" ? 150.0f : 10.0f, h - 20, cl.t2);
    }
    const double cs = cue / fileRate;
    if (cs >= a && cs <= b)
    {
        const float sx = X (cs);
        c.setStroke ("rgba(143,227,136,.5)");
        c.setLineDash ({ 2, 3 });
        c.beginPath();
        c.moveTo (sx, 12);
        c.lineTo (sx, h - 16);
        c.stroke();
        c.setLineDash ({});
        c.setFill ("#8fe388");
        c.beginPath();
        c.moveTo (sx, 10);
        c.lineTo (sx + 8, 14);
        c.lineTo (sx, 18);
        c.fill();
    }
    const double sc = read ("scan"), r = read ("ratio");
    const auto L = loopSecs();
    const double per = std::abs (sc) > 1e-3 ? (L.second - L.first) * r / std::abs (sc) : INFINITY;
    gsLbl (c, "Stretch " + fixed (r, 2) + uni ("\xc3\x97 \xc2\xb7 Scan ") + fixed (sc, 2) + uni ("\xc3\x97 \xe2\x86\x92 ") + (std::isfinite (per) ? "a pass lasts " + fmtS (per) : juce::String ("frozen at Start")), 10, 16, cl.t2);
    c.restore();
}

void GrainFace::drawLoop (juce::Graphics& gr, float w, float h)
{
    c2d::Context c (gr, w, h);
    const auto cl = colours (captured["cl"]);
    const auto [va, vb] = cloudView();
    auto X = [&, ca = va, cb = vb] (double s) { return (float) (6 + (s - ca) / (cb - ca) * (w - 12)); };
    const auto [a, b] = loopSecs();
    const float bot = h - 14;
    c.save();
    c.beginPath();
    c.rect (4, 0, w - 8, h);
    c.clip();
    // gsDrawAnnotations.
    c.font = "9px " + cl.mono;
    if (auto* rs = annotations["regions"].getArray())
        for (const auto& r : *rs)
        {
            const float x0 = X (dnum (r["start"]) / fileRate), x1 = X (dnum (r["end"]) / fileRate);
            c.setFill ("rgba(124,240,208,.28)");
            c.fillRect (x0, bot - 9, juce::jmax (1.0f, x1 - x0 - 1), 9);
            if (x1 - x0 > c.measureText (r["label"].toString()) + 6)
            {
                c.setFill (cl.t);
                c.fillText (r["label"].toString(), x0 + 3, bot - 2);
            }
        }
    if (auto* ms = annotations["markers"].getArray())
        for (const auto& m : *ms)
        {
            const float x = X (dnum (m["frame"]) / fileRate);
            c.setFill (cl.on);
            c.fillRect (x - 0.5f, 4, 1, bot - 4 - 10);
            c.beginPath();
            c.moveTo (x, 4);
            c.lineTo (x + 6, 7);
            c.lineTo (x, 10);
            c.fill();
            if (m["label"].toString().isNotEmpty())
                gsLbl (c, m["label"].toString(), x + 8, 12, cl.on);
        }
    const float ra = X (a), rb = X (b);
    c.setFill ("rgba(0,0,0,.45)");
    c.fillRect (4, 0, juce::jmax (0.0f, ra - 4), h);
    c.fillRect (rb, 0, juce::jmax (0.0f, w - 4 - rb), h);
    c.setFill ("rgba(255,255,255,.035)");
    c.fillRect (4, bot, w - 8, h - bot);
    c.setStroke (cl.acc);
    c.lineWidth = 1.4f;
    c.beginPath();
    c.moveTo (ra, 1);
    c.lineTo (ra, bot);
    c.moveTo (rb, 1);
    c.lineTo (rb, bot);
    c.stroke();
    for (float x : { ra, rb })
    {
        c.setFill (cl.acc);
        c.beginPath();
        c.roundRect (x - 4, 1, 8, 10, 3);
        c.fill();
        c.setFill ("rgba(0,0,0,.5)");
        c.fillRect (x - 1.5f, 3, 1, 6);
        c.fillRect (x + 0.5f, 3, 1, 6);
    }
    c.font = "600 9px " + cl.mono;
    juce::String label;
    {
        // gsRegLabel.
        juce::String name = hasSel && selB > selA ? "Selection" : "Whole file";
        if (auto* rs = annotations["regions"].getArray())
            for (const auto& r : *rs)
                if (std::abs (dnum (r["start"]) / fileRate - a) < 0.01 && std::abs (dnum (r["end"]) / fileRate - b) < 0.01)
                    name = r["label"].toString();
        label = name + uni (" \xc2\xb7 ") + fixed (a, 2) + uni ("\xe2\x80\x93") + fixed (b, 2) + " s";
    }
    gsLbl (c, label.toUpperCase() + uni (" \xc2\xb7 LOOP ") + fixed (b - a, 2) + " S", w - 16, 16, cl.acc, "rgba(5,6,9,.78)", true);
    c.restore();
}

void GrainFace::drawMini (juce::Graphics& gr, float w, float h)
{
    if (peakCols <= 0)
        return;
    c2d::Context c (gr, w, h);
    float pk = 0.001f;
    for (int i = 0; i < peakCols; ++i)
        pk = juce::jmax (pk, std::abs (peaks[(size_t) i]), std::abs (peaks[(size_t) (peakCols + i)]));
    c.setStroke (captured["cl"]["wave"].toString());
    c.lineWidth = 1;
    c.beginPath();
    for (int x = 0; x < (int) w; ++x)
    {
        const int i = (int) std::floor ((double) x / w * peakCols);
        const float m = juce::jmax (std::abs (peaks[(size_t) i]), std::abs (peaks[(size_t) (peakCols + i)])) / pk * (h / 2 - 1);
        c.moveTo ((float) x + 0.5f, h / 2 - m);
        c.lineTo ((float) x + 0.5f, h / 2 + m);
    }
    c.stroke();
}

// ─────────────────────────────────────────────────────────────── MODULATE

void GrainFace::drawAmp (juce::Graphics& gr, float w, float h)
{
    c2d::Context c (gr, w, h);
    const auto cl = colours (captured["cl"]);
    const float x0 = 8, W = w - 16;
    const float ta = (float) std::sqrt (amp.a) * 0.22f * W, td = (float) std::sqrt (amp.d) * 0.26f * W, hold = 0.16f * W, tr = (float) std::sqrt (amp.r) * 0.36f * W, top = 8, bot = h - 8;
    const float sy = bot - (bot - top) * (float) amp.s;
    const juce::Point<float> o { x0, bot }, pa { x0 + ta, top }, pd { x0 + ta + td, sy }, ps { x0 + ta + td + hold, sy }, pr { x0 + ta + td + hold + tr, bot };
    c2d::Path p;
    p.moveTo (o.x, o.y);
    p.quadraticCurveTo (o.x + (pa.x - o.x) * 0.35f, pa.y + (o.y - pa.y) * 0.25f, pa.x, pa.y);
    p.quadraticCurveTo (pa.x + (pd.x - pa.x) * 0.15f, pd.y, pd.x, pd.y);
    p.lineTo (ps.x, ps.y);
    p.quadraticCurveTo (ps.x + (pr.x - ps.x) * 0.15f, pr.y, pr.x, pr.y);
    wvUnder (c, p, o.x, pr.x, h, 0, cl, 0.18f);
    wvTrace (c, p, cl, 1.5f);
    for (auto q : { pa, pd, pr })
    {
        c.setFill (cl.t);
        c.beginPath();
        c.arc (q.x, q.y, 3, 0, tau);
        c.fill();
    }
}

void GrainFace::drawLfo (juce::Graphics& gr, int i, float w, float h)
{
    c2d::Context c (gr, w, h);
    const auto& L = lfo[(size_t) i];
    const auto col = lfoColours[i];
    // JUCE's var[] on what is not a list reads through null: looked up with care.
    auto* ls = lfoState["lfos"].getArray();
    const juce::var one = ls != nullptr && i < ls->size() ? (*ls)[i] : juce::var();
    const double q = dnum (one["phase"]) + dnum (one["hz"]) * juce::jmax (0.0, juce::Time::getMillisecondCounterHiRes() - lfoAt) / 1000;
    const double cyc = std::floor (q), u0 = q - cyc;
    const bool liveL = !L.targets.isEmpty();
    c.setFill ("rgba(255,255,255,.05)");
    c.fillRect (4, h / 2, w - 8, 1);
    c.setStroke (col);
    c.globalAlpha = liveL ? 0.95f : 0.45f;
    c.lineWidth = 1.4f;
    c.stroke (wvPath ([&] (float u) { return std::pair<float, float> (4 + u * (w - 8), h - 5 - (float) lfoVal (L.shape, u, cyc) * (h - 10)); }, 100));
    c.globalAlpha = 1;
    c.fillStyle = c2d::css (col).withAlpha (0.35f);
    c.fillRect (4 + (float) u0 * (w - 8) - 0.5f, 2, 1, h - 4);
    wvDot (c, 4 + (float) u0 * (w - 8), h - 5 - (float) lfoVal (L.shape, u0, cyc) * (h - 10), 3, col);
}

void GrainFace::drawKnob (juce::Graphics& g, const Node& n, double u, juce::Colour col, const juce::String& text)
{
    // uiKnobPaint at 26: the track, the arc from nought, the pointer; the
    // reading beside it.
    const auto* ring = child (n.n, "ui-ring");
    if (ring == nullptr)
        return;
    const auto r = rectOf ((*ring)["rect"]);
    const float cc = r.getWidth() / 2, rr = cc - 4;
    const float a0 = juce::MathConstants<float>::pi * 0.75f, sweep = juce::MathConstants<float>::pi * 1.5f;
    juce::Path track, arc;
    track.addCentredArc (r.getX() + cc, r.getY() + cc, rr, rr, 0, a0 + juce::MathConstants<float>::halfPi, a0 + sweep + juce::MathConstants<float>::halfPi, true);
    g.setColour (c2d::css (captured["cl"]["track"].toString()));
    g.strokePath (track, juce::PathStrokeType (2.0f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
    if (u > 0.0005)
    {
        arc.addCentredArc (r.getX() + cc, r.getY() + cc, rr, rr, 0, a0 + juce::MathConstants<float>::halfPi, a0 + sweep * (float) u + juce::MathConstants<float>::halfPi, true);
        g.setColour (col);
        g.strokePath (arc, juce::PathStrokeType (2.0f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
    }
    const float a = a0 + sweep * (float) u;
    g.setColour (c2d::css (captured["cl"]["t"].toString()));
    g.drawLine (r.getX() + cc + std::cos (a) * rr * 0.2f, r.getY() + cc + std::sin (a) * rr * 0.2f, r.getX() + cc + std::cos (a) * rr * 0.62f, r.getY() + cc + std::sin (a) * rr * 0.62f, 1.5f);
    if (const auto* v = child (n.n, "ui-kval"))
        face::paintText (g, *v, rectOf ((*v)["rect"]).withWidth (60), text);
}

void GrainFace::drawLfoRow (juce::Graphics& g, int i)
{
    const auto& L = lfo[(size_t) i];
    auto& ids = cur().ids;
    const auto si = juce::String (i);
    const auto col = c2d::css (lfoColours[i]);
    auto seg = [&] (const juce::String& cid, std::function<bool (int)> on, std::function<void (int, juce::Rectangle<float>)> extra) {
        auto it = ids.find (cid);
        if (it == ids.end())
            return;
        if (auto* kids = it->second.n["kids"].getArray())
            for (int j = 0; j < kids->size(); ++j)
            {
                const auto r = rectOf ((*kids)[j]["rect"]);
                const bool isLit = on (j);
                const auto& look = isLit ? segOn : segOff;
                if (look.isObject())
                    face::paintBox (g, look, r);
                if (extra)
                    extra (j, r);
                else if (auto* t = (*kids)[j]["text"].getArray(); t != nullptr && !t->isEmpty())
                    face::paintText (g, look, r, (*t)[0]["text"].toString(), juce::Justification::centred);
            }
    };
    seg ("gsLshp" + si, [&] (int j) { return L.shape == lfoShapes[j]; }, [&] (int j, juce::Rectangle<float> r) {
        // The shape's picture, in the LFO's colour when chosen.
        // viewBox 16 x 14 in an 18 x 12 box: scaled whole and centred.
        juce::Path p = juce::Drawable::parseSVGPath (lfoShapePaths[j]);
        const float sc = juce::jmin (18.0f / 16.0f, 12.0f / 14.0f);
        const auto box = juce::Rectangle<float> (18, 12).withCentre (r.getCentre());
        p.applyTransform (juce::AffineTransform::scale (sc).translated (box.getX() + (18 - 16 * sc) / 2, box.getY() + (12 - 14 * sc) / 2));
        g.setColour (L.shape == lfoShapes[j] ? col : c2d::css (captured["cl"]["t3"].toString()));
        g.strokePath (p, juce::PathStrokeType (1.4f * sc, juce::PathStrokeType::mitered, juce::PathStrokeType::butt));
    });
    seg ("gsLmode" + si, [&] (int j) { return (j == 0) == (L.mode == "free"); }, {});
    seg ("gsLsync" + si, [&] (int j) { return (j == 1) == L.sync; }, {});
    if (auto it = ids.find ("gsLkr" + si); it != ids.end())
        drawKnob (g, it->second, L.rate, col, lfoRate (L));
    if (auto it = ids.find ("gsLkd" + si); it != ids.end())
        drawKnob (g, it->second, L.depth, col, rnd (L.depth * 100) + " %");
    if (auto it = ids.find ("gsLmap" + si); it != ids.end())
    {
        const bool mapping = mapI == i;
        auto r = it->second.r;
        const auto text = mapping ? juce::String ("CLICK A CONTROL") : juce::String ("MAP");
        if (mapping)
        {
            const auto f = face::mono (9, 600);
            r = r.withWidth (juce::GlyphArrangement::getStringWidth (f, text) + 12);
            juce::DropShadow (col, 10, {}).drawForRectangle (g, r.toNearestInt());
            g.setColour (col);
            g.fillRoundedRectangle (r, 3);
            g.setColour (c2d::css (captured["cl"]["--look-chip-ink"].toString()));
            g.setFont (f);
            g.drawText (text, r, juce::Justification::centred);
        }
        else
        {
            face::paintBox (g, it->second.n, r);
            g.setColour (col.withMultipliedAlpha (0.45f));
            g.drawRoundedRectangle (r.reduced (0.5f), 3, 1);
            face::paintText (g, it->second.n, r, text, juce::Justification::centred);
        }
    }
    if (auto it = ids.find ("gsLtg" + si); it != ids.end())
    {
        const auto r = it->second.r;
        if (L.targets.isEmpty())
        {
            // "Moves nothing yet", as the page writes it.
            if (auto* hint = child (it->second.n, "gs-hint"))
                if (auto* runs = (*hint)["text"].getArray())
                    for (const auto& run : *runs)
                        face::paintText (g, *hint, rectOf (run["rect"]).withWidth (80), run["text"].toString());
        }
        else
        {
            float cx = r.getX();
            const auto f = face::sans (10, 500);
            for (int t = 0; t < juce::jmin (4, L.targets.size()); ++t)
            {
                juce::String name = L.targets[t];
                for (const auto& [k, c] : ctls)
                    if (lfoId (k) == L.targets[t])
                        name = c.label;
                const juce::Rectangle<float> chip (cx, r.getY() + (float) (t / 2) * 20.0f, 60, 17);
                g.setColour (col.withAlpha (0.16f));
                g.fillRoundedRectangle (chip, 3);
                g.setColour (c2d::css (captured["cl"]["t"].toString()));
                g.setFont (f);
                g.drawText (name, chip.withTrimmedLeft (6).withTrimmedRight (14), juce::Justification::centredLeft, true);
                g.setColour (c2d::css (captured["cl"]["t3"].toString()));
                g.drawText (uni ("\xc3\x97"), chip.withTrimmedLeft (46), juce::Justification::centred);
                cx += t % 2 == 0 ? 63 : -63;
            }
        }
    }
}

// ────────────────────────────────────────────────────────────── the meters

void GrainFace::drawOutWave (juce::Graphics& gr, float w, float h)
{
    c2d::Context c (gr, w, h);
    const auto cl = colours (captured["cl"]);
    if (outL.size() < 8 || vuDb < -90)
    {
        c.setStroke ("rgba(" + cl.bloom + ",.15)");
        c.beginPath();
        c.moveTo (6, h / 2);
        c.lineTo (w - 6, h / 2);
        c.stroke();
        return;
    }
    const int n = (int) outL.size();
    wvTrace (c, wvPath ([&] (float u) {
        const int i = juce::jmin (n - 1, (int) std::floor (u * (float) n));
        return std::pair<float, float> (6 + u * (w - 12), h / 2 - (float) juce::jlimit (-1.0, 1.0, (outL[(size_t) i] + outR[(size_t) i]) * 1.1) * h * 0.42f);
    }, 240), cl, 1.1f, 0.6f);
}

void GrainFace::drawMaster (juce::Graphics& gr, float w, float h)
{
    c2d::Context c (gr, w, h);
    const auto cl = colours (captured["cl"]);
    const double l = clamp01 ((vuDb + 48) / 48);
    const int n = (int) std::floor ((w - 8) / 4.6f);
    for (int i = 0; i < n; ++i)
    {
        c.setFill ((double) i / n < l ? (i > n - 4 ? cl.on : "rgba(" + cl.bloom + ",.8)") : juce::String ("rgba(255,255,255,.06)"));
        c.fillRect (4 + (float) i * 4.6f, 6, 3, 10);
    }
    c.setFill (cl.t2);
    c.fillRect (4 + (float) volume * (w - 8) - 0.5f, 18, 1.5f, 3);
}

void GrainFace::drawLoad (juce::Graphics& gr, float w, float h)
{
    c2d::Context c (gr, w, h);
    const auto cl = colours (captured["cl"]);
    const bool liveL = playing;
    const double l = juce::jlimit (0.0, 1.2, liveL ? loadWorst : 0.0);
    c.font = "9px " + cl.mono;
    c.setFill (cl.t3);
    c.fillText (liveL ? rnd (loadWorst * 100) + "%" : juce::String ("LOAD"), 4, 14);
    for (int i = 0; i < 10; ++i)
    {
        c.setFill ((double) i / 10 < l ? (i >= 8 ? (l > 1 ? juce::String ("#ff6b5e") : cl.on) : "rgba(" + cl.bloom + ",.8)") : juce::String ("rgba(255,255,255,.06)"));
        c.fillRect (30 + (float) i * 3.2f, 6, 2, 10);
    }
}

// ───────────────────────────────────────────────────────────────── the dock

void GrainFace::drawWheel (juce::Graphics& gr, float w, float h)
{
    c2d::Context c (gr, w, h);
    const auto cl = colours (captured["cl"]);
    const float rest = h / 2, y = rest - (float) bend * (h / 2 - 8);
    for (float yy = 6; yy < h - 4; yy += 4)
    {
        c.setFill ("rgba(255,255,255,.05)");
        c.fillRect (6, yy, w - 12, 1);
    }
    c.setFill ("rgba(" + cl.bloom + ",.25)");
    c.fillRect (5, juce::jmin (rest, y), w - 10, std::abs (rest - y));
    c.setFill (cl.t);
    c.shadowBlur = 8;
    c.setShadow (cl.acc);
    c.beginPath();
    c.roundRect (4, y - 2, w - 8, 4, 2);
    c.fill();
    c.shadowBlur = 0;
    c.setFill (cl.t3);
    c.font = "9px " + cl.mono;
    c.textAlign = "center";
    c.fillText ("PB", w / 2, 10);
}

void GrainFace::drawGlide (juce::Graphics& gr, float w, float h)
{
    c2d::Context c (gr, w, h);
    const auto cl = colours (captured["cl"]);
    const float v = (float) voice.glide, x = 6 + (w - 12) * v;
    c.save();
    c.beginPath();
    c.rect (6, 3, x - 6, h - 6);
    c.clip();
    wvTrace (c, wvPath ([&] (float u) { return std::pair<float, float> (6 + u * (w - 12), h - 5 - (h - 10) * (1 - std::exp (-u * 5 / (v * 3 + 0.05f)))); }, 60), cl, 1.1f, 0.6f);
    c.restore();
    c.setStroke (cl.track);
    c.beginPath();
    c.moveTo (x, 3);
    c.lineTo (w - 6, 3);
    c.stroke();
    c.setFill (cl.t);
    c.beginPath();
    c.roundRect (x - 2, 2, 4, h - 4, 2);
    c.fill();
    c.font = "10px " + cl.mono;
    c.setFill (cl.t2);
    c.textAlign = "right";
    c.fillText (rnd (v * v * 2000) + " ms", w - 6, h / 2 + 3.5f);
    c.textAlign = "left";
    c.setFill (cl.t3);
    c.fillText ("Glide", 8, h / 2 + 3.5f);
}

void GrainFace::drawKeys (juce::Graphics& gr, float w, float h)
{
    // kb1Draw, Grain's hue (165).
    c2d::Context c (gr, w, h);
    const auto cl = colours (captured["cl"]);
    const int lo = juce::jlimit (0, 127 - 49 + 1, 36 + 12 * oct), hue = 165;
    auto black = [] (int n) { const int m = ((n % 12) + 12) % 12; return m == 1 || m == 3 || m == 6 || m == 8 || m == 10; };
    std::map<int, std::pair<float, float>> pos;
    int wi = 0;
    for (int n = lo; n < lo + 49; ++n)
        if (!black (n))
            pos[n] = { (float) wi++ * 28.0f, 28.0f };
    for (int n = lo; n < lo + 49; ++n)
        if (black (n))
            pos[n] = { pos[n - 1].first + 28.0f - 9.0f, 18.0f };
    const auto H = juce::String (hue);
    for (const auto& [n, kw] : pos)
    {
        if (black (n))
            continue;
        const bool on = held.count (n) > 0;
        const float x = kw.first, k = kw.second;
        auto grd = c.createLinearGradient (0, 0, 0, h);
        grd.addColorStop (0, on ? "hsl(" + H + ",35%,30%)" : juce::String ("#2b2e34"));
        grd.addColorStop (1, on ? "hsl(" + H + ",45%,22%)" : juce::String ("#1d1f23"));
        c.fillStyle = grd;
        c.beginPath();
        c.roundRect (x + 1, 0, k - 2, h - 1, std::array<float, 4> { 0, 0, 4, 4 });
        c.fill();
        c.setFill ("rgba(255,255,255,.07)");
        c.fillRect (x + 1, 0, k - 2, 1);
        c.setFill ("rgba(0,0,0,.45)");
        c.fillRect (x + k - 2, 0, 1, h - 1);
        if (on)
        {
            c.setFill ("hsl(" + H + ",70%,62%)");
            c.shadowBlur = 10;
            c.setShadow ("hsl(" + H + ",70%,62%)");
            c.fillRect (x + 3, h - 9, k - 6, 4);
            c.shadowBlur = 0;
        }
        if (((n % 12) + 12) % 12 == 0)
        {
            c.setFill (cl.t3);
            c.font = "9px " + cl.sans;
            c.fillText ("C" + juce::String (n / 12 - 1), x + 4, h - 12);
        }
    }
    for (const auto& [n, kw] : pos)
    {
        if (!black (n))
            continue;
        const bool on = held.count (n) > 0;
        const float x = kw.first, k = kw.second;
        auto grd = c.createLinearGradient (0, 0, 0, 60);
        grd.addColorStop (0, on ? "#2c3038" : "#131417");
        grd.addColorStop (1, on ? "#1d2026" : "#060708");
        c.fillStyle = grd;
        c.shadowBlur = 4;
        c.setShadow ("rgba(0,0,0,.7)");
        c.beginPath();
        c.roundRect (x, 0, k, 60, std::array<float, 4> { 0, 0, 3, 3 });
        c.fill();
        c.shadowBlur = 0;
        if (on)
        {
            c.setFill ("hsl(" + H + ",70%,62%)");
            c.fillRect (x + 2, 60 - 7, k - 4, 3);
        }
    }
}

// ─────────────────────────────────────────────────── switches and readings

void GrainFace::drawSegs (juce::Graphics& g)
{
    auto& ids = cur().ids;
    auto segOf = [&] (const char* cid, std::function<bool (int)> on) {
        if (only.isNotEmpty() && only != cid)
            return;
        auto it = ids.find (cid);
        if (it == ids.end())
            return;
        if (auto* kids = it->second.n["kids"].getArray())
            for (int j = 0; j < kids->size(); ++j)
            {
                const auto r = rectOf ((*kids)[j]["rect"]);
                const auto& look = on (j) ? segOn : segOff;
                if (look.isObject())
                    face::paintBox (g, look, r);
                if (auto* t = (*kids)[j]["text"].getArray(); t != nullptr && !t->isEmpty())
                    face::paintText (g, look, r, (*t)[0]["text"].toString(), juce::Justification::centred);
            }
    };
    static const char* modes[] = { "mono", "legato", "poly" };
    segOf ("gsVmode", [&] (int j) { return voice.mode == modes[juce::jlimit (0, 2, j)]; });
    segOf ("gsAB", [&] (int j) { return (j == 0) == (ab == "A"); });
    // Run, Loop, Follow: lit or not, from the lit page's own.
    auto lamp = [&] (const char* cid, bool on) {
        if (only.isNotEmpty() && only != cid)
            return;
        auto it = ids.find (cid);
        if (it == ids.end())
            return;
        const auto lt = litNodes.ids.find (cid);
        const auto& look = on && lt != litNodes.ids.end() ? lt->second.n : it->second.n;
        auto n = it->second;
        juce::ignoreUnused (n);
        lit->drawPart (g, look, it->second.r.getPosition() - rectOf (look["rect"]).getPosition());
    };
    lamp ("gsRunBtn", voice.run);
    lamp ("gsFollow", follow);
    if (auto it = ids.find ("gsLoopChip"); it != ids.end() && !fxView && (only.isEmpty() || only == "gsLoopChip"))
    {
        // The loop chip follows the region chip, which grows with its words.
        juce::Rectangle<float> reg;
        if (auto rc = ids.find ("gsRegChip"); rc != ids.end())
        {
            const auto [a, b] = loopSecs();
            juce::String name = hasSel && selB > selA ? "Selection" : "Whole file";
            if (auto* rs = annotations["regions"].getArray())
                for (const auto& r : *rs)
                    if (std::abs (dnum (r["start"]) / fileRate - a) < 0.01 && std::abs (dnum (r["end"]) / fileRate - b) < 0.01)
                        name = r["label"].toString();
            writeChip (g, rc->second, name + uni (" \xc2\xb7 ") + fixed (a, 2) + uni ("\xe2\x80\x93") + fixed (b, 2) + " s", &reg);
        }
        auto r = it->second.r;
        if (!reg.isEmpty())
            r.setX (reg.getRight() + 8);
        auto* runs = it->second.n["text"].getArray();
        if (loopOn)
        {
            face::paintBox (g, it->second.n, r);
            g.setColour (c2d::css (captured["cl"]["on"].toString()).withAlpha (0.7f));
            g.drawRoundedRectangle (r.reduced (0.5f), 4, 1);
        }
        else
            face::paintBox (g, it->second.n, r);
        if (runs != nullptr && !runs->isEmpty())
        {
            if (juce::exactlyEqual (r.getX(), it->second.r.getX()) && !loopOn && shown != nullptr)
                shown->drawPart (g, it->second.n);
            else
                face::paintText (g, it->second.n, r.reduced (7, 0), (*runs)[0]["text"].toString());
        }
    }
}

void GrainFace::drawStrip (juce::Graphics& g)
{
    // The rack's tiles, after the FX label (gsFxBuildRow): the captured row
    // (the factory rack's EQ › Comp ＋), its lights as the rack has them; a
    // rack of other slots laid out as the page lays them.
    auto& ids = cur().ids;
    auto it = ids.find ("gsFxStrip");
    if (it == ids.end() || shown == nullptr)
        return;
    auto* slots = rack["slots"].getArray();
    std::vector<juce::var> tiles, arrows;
    juce::var plus, label;
    if (auto* k = it->second.n["kids"].getArray())
        for (const auto& kid : *k)
        {
            if (hasClass (kid, "gs-tplus"))
                plus = kid;
            else if (hasClass (kid, "gs-tile"))
                tiles.push_back (kid);
            else if (hasClass (kid, "gs-ar"))
                arrows.push_back (kid);
            else if (hasClass (kid, "gs-lab2"))
                label = kid;
        }
    const int n = slots != nullptr ? slots->size() : 0;
    bool same = n == (int) tiles.size();
    for (int i = 0; same && i < n; ++i)
        same = (*slots)[i]["kind"].toString() == tiles[(size_t) i]["data"]["kind"].toString();
    std::set<int> without;
    for (const auto& t : tiles)
        without.insert ((int) t["i"]);
    for (const auto& a : arrows)
        without.insert ((int) a["i"]);
    if (!same && plus.isObject())
        without.insert ((int) plus["i"]);
    shown->drawPart (g, it->second.n, {}, 1.0f, &without);
    const auto on = c2d::css (captured["cl"]["on"].toString());
    auto light = [&] (juce::Rectangle<float> led, bool off) {
        if (!off)
            juce::DropShadow (on, 6, {}).drawForRectangle (g, led.toNearestInt());
        g.setColour (off ? c2d::css (captured["cl"]["--look-led-off"].toString()) : on);
        g.fillEllipse (led);
    };
    if (same)
    {
        for (const auto& a : arrows)
            shown->drawPart (g, a);
        for (int i = 0; i < n; ++i)
        {
            const bool off = (bool) (*slots)[i]["bypassed"];
            std::set<int> w2;
            const auto* led = child (tiles[(size_t) i], "gs-led");
            if (led != nullptr)
                w2.insert ((int) (*led)["i"]);
            shown->drawPart (g, tiles[(size_t) i], {}, 1.0f, &w2);
            if (led != nullptr)
                light (rectOf ((*led)["rect"]), off);
            if (off)
            {
                // The name and the picture at .4 (`.gs-tile.off`).
                g.setColour (c2d::css (captured["cl"]["--on-tile"].toString()).withAlpha (0.6f));
                g.fillRect (rectOf (tiles[(size_t) i]["rect"]).withTrimmedLeft (18).reduced (0, 4));
            }
        }
        return;
    }
    if (tiles.empty())
        return;
    const auto& tile = tiles.front();
    float x = rectOf (tile["rect"]).getX();
    const float limit = rectOf (it->second.n["rect"]).getRight() - 30;
    const auto f = face::sans (12, 500);
    for (int i = 0; i < n; ++i)
    {
        const auto kind = (*slots)[i]["kind"].toString();
        const bool off = (bool) (*slots)[i]["bypassed"];
        juce::String name = kind == "eq" ? "EQ" : kind == "comp" ? "Comp" : kind.fromLastOccurrenceOf (":", false, false).replace ("-", " ");
        if (name.length() > 10)
            name = name.fromLastOccurrenceOf (" ", false, false);
        const bool tight = n > 3;
        const float w = 6 + 7 + 5 + 17 + (tight ? 2.0f : 5 + juce::GlyphArrangement::getStringWidth (f, name)) + 8;
        if (x + w > limit)
            break;
        const juce::Rectangle<float> r (x, rectOf (tile["rect"]).getY(), w, rectOf (tile["rect"]).getHeight());
        face::paintBox (g, tile, r);
        const juce::Rectangle<float> led (r.getX() + 6, r.getCentreY() - 3.5f, 7, 7);
        light (led, off);
        const char* icon = "M2 12 C4 12,5 3,8 3 H11 C13 3,13 12,16 12";
        const auto lk = kind.toLowerCase();
        if (lk.contains ("eq") || lk.contains ("equal"))
            icon = "M1 9 C4 9,5 3,8 3 S12 10,14 7 L17 6";
        else if (lk.contains ("comp") || lk.contains ("limit"))
            icon = "M1 12 L9 5 L17 3 M1 5h3M6 5h2M11 5h2M15 5h2";
        else if (lk.contains ("echo") || lk.contains ("delay"))
            icon = "M2 2v10M6 4v6M10 5.5v3M14 6.5v1";
        else if (lk.contains ("plate"))
            icon = "M2 11 L5 3 H16 L13 11 Z M7 7h5";
        else if (lk.contains ("hall") || lk.contains ("room") || lk.contains ("chamber") || lk.contains ("verb"))
            icon = "M2 3v8M5 4.5v6.5M8 6v5M11 7.5v3.5M14 9v2";
        auto p = juce::Drawable::parseSVGPath (icon);
        p.applyTransform (juce::AffineTransform::translation (led.getRight() + 5, r.getCentreY() - 7));
        g.setColour (on.withMultipliedAlpha (off ? 0.4f : 1.0f));
        g.strokePath (p, juce::PathStrokeType (1.4f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
        if (!tight)
        {
            g.setColour (c2d::css (captured["cl"]["t"].toString()).withMultipliedAlpha (off ? 0.4f : 1.0f));
            g.setFont (f);
            g.drawText (name, juce::Rectangle<float> (led.getRight() + 27, r.getY(), 200, r.getHeight()), juce::Justification::centredLeft);
        }
        x += w + 3;
    }
}

void GrainFace::drawTexts (juce::Graphics& g)
{
    auto& ids = cur().ids;
    auto at = [&] (const char* k) -> const Node* {
        if (only.isNotEmpty() && only != k)
            return nullptr;
        auto it = ids.find (k);
        return it == ids.end() ? nullptr : &it->second;
    };
    auto text = [&] (const char* k, const juce::String& s, juce::Justification j = juce::Justification::centredLeft) {
        if (auto* n = at (k))
            writeText (g, *n, s, j);
    };
    const double base = fileFrames / juce::jmax (1.0, fileRate), out = base * dnum (draft["ratio"], 1), semis = dnum (draft["semitones"]);
    text ("gsLength", fixed (base, 2) + uni ("s \xe2\x86\x92 ") + fixed (out, 2) + "s" + (std::abs (semis) < 0.05 ? juce::String() : uni (" \xc2\xb7 pitch ") + (semis > 0 ? "+" : "") + fixed (semis, 1) + " st"));
    if (auto* n = at ("gsMeta"))
    {
        // Whole words only: whatever does not fit goes, last first.
        auto items = juce::StringArray::fromTokens (fileMeta, "|", "");
        auto* runs = n->n["text"].getArray();
        const auto f = runs != nullptr && !runs->isEmpty() ? face::font ((*runs)[0]["font"]) : face::mono (11);
        juce::String s;
        for (int k = items.size(); k >= 0; --k)
        {
            juce::StringArray first;
            for (int j = 0; j < k; ++j)
                first.add (items[j]);
            s = first.joinIntoString (uni (" \xc2\xb7 "));
            if (juce::GlyphArrangement::getStringWidth (f, s) <= n->r.getWidth())
                break;
        }
        writeText (g, *n, s);
    }
    const int L = (int) jsRound (read ("layers"));
    const int run = playing ? (int) dnum (live["load"]["layersRunning"]) : 0;
    const int v = voice.mode == "poly" ? (live["heads"].getArray() != nullptr ? live["heads"].getArray()->size() : 0) : (int) held.size();
    text ("gsVoicesRo", (run && run < L ? juce::String (run) + "/" + juce::String (L) : juce::String (L)) + " layer" + (L > 1 ? "s" : "") + uni (" \xc2\xb7 ") + juce::String (v) + " voice" + (v == 1 ? "" : "s"));
    if (!fxView)
    {
        text ("gsSndName", soundName);
        const auto [ca, cb] = cloudView();
        text ("gsCzRo", czB > czA ? fixed (fileLen() / (cb - ca), 1) + uni ("\xc3\x97") : juce::String ("whole"), juce::Justification::centredRight);
        const double hp = head() + (cloudActive() ? read ("position") * fileLen() : 0);
        const int total = (int) dnum (schedule["total"]);
        text ("gsCloudRo", total > 0 ? juce::String (total) + uni (" grains \xc2\xb7 head ") + fixed (hp, 2) + "s" : uni ("no cloud \xe2\x80\x94 raise Density or Layers"));
        const double ta2 = amp.a * amp.a * 4 + 0.004, td2 = amp.d * amp.d * 4, tr2 = amp.r * amp.r * 6;
        if (auto* n = at ("gsAmpRo"))
        {
            // Two lines, as the page wraps it in its 130 px.
            auto* runs = n->n["text"].getArray();
            const auto f = runs != nullptr && !runs->isEmpty() ? face::font ((*runs)[0]["font"]) : face::mono (11);
            g.setFont (f);
            g.setColour (runs != nullptr && !runs->isEmpty() ? face::colour ((*runs)[0]["font"]["colour"]) : juce::Colours::white);
            const auto s = fmtS (ta2) + uni (" \xc2\xb7 ") + fmtS (td2) + uni (" \xc2\xb7 ") + rnd (amp.s * 100) + uni (" % \xc2\xb7 ") + fmtS (tr2);
            g.drawFittedText (s, n->r.withWidth (130).toNearestInt(), juce::Justification::topLeft, 2, 1.0f);
        }
        text ("gsSeedRo", rnd (dnum (draft["grain"]["seed"], 1)), juce::Justification::centredRight);
        // The tuning, on its chip and in the dock.
        const auto tune = scaleName.isNotEmpty() ? scaleName : juce::exactlyEqual (pitchStep, 1.0) ? juce::String ("Semitone grid") : juce::exactlyEqual (pitchStep, 0.5) ? juce::String ("Half-semitone grid") : pitchStep > 0 ? juce::String (pitchStep) + " st grid" : juce::String ("Tuning: free");
        if (auto* n = at ("gsTuneBtn"))
            writeText (g, *n, tune + uni (" \xe2\x96\xbe"));
    }
    text ("gsOctRo", "C" + juce::String (2 + oct), juce::Justification::centred);
    text ("gsVelRo", velText);
    if (auto* n = at ("gsBendLab"))
        if (auto* b = child (n->n, "b"))
            face::paintText (g, *b, rectOf ((*b)["rect"]).withWidth (30), uni ("\xc2\xb1") + juce::String (voice.bendR));
    if (auto* n = at ("gsKbScale"))
    {
        const auto name = scaleName.isNotEmpty() ? scaleName : juce::exactlyEqual (pitchStep, 1.0) ? juce::String ("12 per octave") : juce::exactlyEqual (pitchStep, 0.5) ? juce::String ("24 per octave") : pitchStep > 0 ? juce::String (pitchStep) + " st grid" : juce::String ("chromatic");
        if (auto* i = child (n->n, "i"))
            face::paintText (g, *i, rectOf ((*i)["rect"]).withWidth (60), "GRAIN");
        if (auto* s = child (n->n, "span"))
            face::paintText (g, *s, rectOf ((*s)["rect"]).withWidth (90), name + uni (" \xe2\x96\xbe"));
    }
    if (auto* n = at ("gsMidiCh"))
        juce::ignoreUnused (n);
    // The preset bar's name and tag.
    std::function<const juce::var* (const juce::var&, const char*)> findCls = [&] (const juce::var& t, const char* cls) -> const juce::var* {
        if (hasClass (t, cls))
            return &t;
        if (auto* k = t["kids"].getArray())
            for (const auto& kid : *k)
                if (auto* f = findCls (kid, cls))
                    return f;
        return nullptr;
    };
    if (auto* cp = at ("gsCpPb"))
        if (auto* nm = findCls (cp->n, "pbar-nm"))
            if (auto* b = child (*nm, "b"))
                face::paintText (g, *b, rectOf ((*b)["rect"]).withWidth (150), cloudPreset.isEmpty() ? juce::String ("No cloud") : cloudPreset);
    if (auto* pb = at ("gsPb"))
        if (auto* nm = findCls (pb->n, "pbar-nm"))
        {
            const auto* b = child (*nm, "b");
            const auto* tg = child (*nm, "pbar-tg");
            const auto name = presetName.isEmpty() ? juce::String ("No preset") : presetName;
            static const std::map<juce::String, juce::String> names { { "wsola", "WSOLA" }, { "vocoder", "Vocoder" }, { "pvsola", "PVSOLA" }, { "hybrid", "Hybrid" }, { "granular", "Granular" }, { "soundhack", "SoundHack" } };
            if (b != nullptr)
            {
                auto* runs = (*b)["text"].getArray();
                const auto f = runs != nullptr ? face::font ((*runs)[0]["font"]) : face::sans (14, 600);
                const auto br = rectOf ((*b)["rect"]);
                face::paintText (g, *b, br.withWidth (200), name);
                if (tg != nullptr)
                {
                    const float x = br.getX() + juce::GlyphArrangement::getStringWidth (f, name) + 6;
                    face::paintText (g, *tg, rectOf ((*tg)["rect"]).withX (x), names.count (engine) ? names.at (engine) : engine);
                }
            }
        }
}

// ────────────────────────────────────────────────────── the effects view

void GrainFace::drawFxView (juce::Graphics& g)
{
    if (!fxView)
        return;
    auto& ids = cur().ids;
    const auto cl = colours (captured["cl"]);
    auto at = [&] (const char* k) -> const Node* { auto it = ids.find (k); return it == ids.end() ? nullptr : &it->second; };
    auto canvasAt = [&] (const char* k, std::function<void (c2d::Context&, float, float)> draw) {
        if (auto* n = at (k))
        {
            juce::Graphics::ScopedSaveState keep (g);
            g.reduceClipRegion (n->r.toNearestInt());
            g.setOrigin (n->r.getPosition().toInt());
            c2d::Context c (g, n->r.getWidth(), n->r.getHeight());
            draw (c, n->r.getWidth(), n->r.getHeight());
        }
    };
    gpic::FxMeters m;
    for (size_t i = 0; i < outL.size(); i += juce::jmax ((size_t) 1, outL.size() / 512))
    {
        m.lissajous.push_back (outL[i]);
        m.lissajous.push_back (outR[i]);
    }
    auto in = picInputs();
    canvasAt ("gsFxOut", [&] (c2d::Context& c, float w, float h) { gpic::fxWave (c, w, h, in, picState, m); });
    canvasAt ("gsFxSpec", [&] (c2d::Context& c, float w, float h) { gpic::fxSpectrum (c, w, h, in, picState, m); });
    auto sideText = [] (double u) {
        const double db = 20 * std::log10 (juce::jmax (1e-9, std::pow (u / 0.8, 2.0)));
        return db <= -60 ? uni ("\xe2\x88\x92\xe2\x88\x9e") : juce::String (db > 0.04 ? "+" : db < -0.04 ? uni ("\xe2\x88\x92") : juce::String()) + fixed (std::abs (db), 1);
    };
    auto fader = [&] (const char* cid, const char* ro, double u, const juce::String& text) {
        canvasAt (cid, [&] (c2d::Context& c, float w, float h) {
            const float y = 8 + (float) (1 - u) * (h - 16);
            c.setFill (cl.track);
            c.fillRect (w / 2 - 1, 8, 2, h - 16);
            c.setFill ("rgba(" + cl.bloom + ",.55)");
            c.fillRect (w / 2 - 1, y, 2, h - 8 - y);
            c.setFill (cl.t);
            c.beginPath();
            c.roundRect (w / 2 - 12, y - 3, 24, 6, 2);
            c.fill();
        });
        if (auto* n = at (ro))
            writeText (g, *n, text, juce::Justification::centred);
    };
    fader ("gsFdLR", "gsFdLRRo", volume, rnd (volume * 100) + "%");
    fader ("gsFdL", "gsFdLRo", sideL, sideText (sideL));
    fader ("gsFdR", "gsFdRRo", sideR, sideText (sideR));
    canvasAt ("gsFxMeters", [&] (c2d::Context& c, float w, float h) {
        const float top = 30, bot = h - 34;
        auto y = [&] (double db) { return top + (float) (juce::jmax (-60.0, juce::jmin (6.0, db)) / -66 + 6.0 / 66) * (bot - top); };
        auto dbText = [] (double d) { return d <= -119 ? uni ("\xe2\x88\x92\xe2\x88\x9e") : fixed (d, 1); };
        c.font = "9px " + cl.mono;
        c.setFill (cl.t3);
        c.textAlign = "left";
        c.fillText ("PEAK", 6, 11);
        c.textAlign = "right";
        c.fillText (dbText (peakL) + "  " + dbText (peakR) + " dB", w - 6, 11);
        for (int db : { 6, 0, -6, -12, -24, -36, -48, -60 })
        {
            c.fillText (db > 0 ? "+" + juce::String (db) : juce::String (db), w - 4, y (db) + 3);
            c.setFill ("rgba(255,255,255,.05)");
            c.fillRect (44, y (db), w - 76, 1);
            c.setFill (cl.t3);
        }
        c.textAlign = "center";
        for (int k = 0; k < 2; ++k)
        {
            const float x = k == 0 ? 60.0f : 100.0f;
            c.setFill (cl.t3);
            c.fillText (k == 0 ? "L" : "R", x, top - 5);
            c.setFill ("rgba(255,255,255,.06)");
            c.fillRect (x - 6, top, 12, bot - top);
            const double vu = k == 0 ? vuL : vuR, pk = k == 0 ? peakL : peakR;
            if (vu <= -119)
                continue;
            c.setFill ("rgba(" + cl.bloom + ",.8)");
            const float yy = y (juce::jmax (-60.0, vu));
            c.fillRect (x - 6, yy, 12, bot - yy);
            c.setFill (cl.on);
            c.fillRect (x - 6, y (pk), 12, 2);
        }
        const float cy = h - 14, x0 = 8, cw = w - 16;
        c.setFill ("rgba(255,255,255,.06)");
        c.fillRect (x0, cy - 3, cw, 6);
        c.setFill ("rgba(255,255,255,.2)");
        c.fillRect (x0 + cw / 2 - 0.5f, cy - 6, 1, 12);
        const float cv = x0 + (float) (corr + 1) / 2 * cw;
        c.setFill (corr < 0 ? juce::String ("#ff6b5e") : cl.acc);
        c.fillRect (juce::jmin (cv, x0 + cw / 2), cy - 3, std::abs (cv - (x0 + cw / 2)), 6);
        c.setFill (cl.t3);
        c.textAlign = "left";
        c.fillText (uni ("\xe2\x88\x92") + "1", x0, cy - 7);
        c.textAlign = "right";
        c.fillText ("+1", x0 + cw, cy - 7);
        c.textAlign = "center";
        c.fillText ("CORR " + juce::String (corr >= 0 ? "+" : uni ("\xe2\x88\x92")) + fixed (std::abs (corr), 2), w / 2, cy - 7);
    });
    static const std::map<juce::String, juce::String> names { { "wsola", "WSOLA" }, { "vocoder", "Vocoder" }, { "pvsola", "PVSOLA" }, { "hybrid", "Hybrid" }, { "granular", "Granular" }, { "soundhack", "SoundHack" } };
    if (auto* n = at ("gsFxBack"))
        writeChip (g, *n, uni ("\xe2\x97\x82 Back to ") + (names.count (engine) ? names.at (engine) : engine));
}

// ───────────────────────────────────────────────────────── the pictures

void GrainFace::loadMono()
{
    // The page's samples (`/audio?dry=1` decoded, 407's gsPcmLoad), once a sound.
    if (monoSerial == docSerial || asCaptured)
        return;
    int64_t n = 0;
    call ([&] (NaApp* a) -> int64_t { n = na_grain_mono (a, id, 0, nullptr, 0); return 0; });
    if (n <= 0)
        return;
    mono.assign ((size_t) n, 0.0f);
    call ([&] (NaApp* a) -> int64_t { return na_grain_mono (a, id, 0, mono.data(), (uint32_t) mono.size()); });
    monoSerial = docSerial;
}

gpic::Inputs GrainFace::picInputs()
{
    loadMono();
    gpic::Inputs in;
    in.samples = mono.empty() ? nullptr : mono.data();
    in.count = mono.size();
    in.rate = fileRate;
    in.serial = (uint64_t) juce::jmax ((int64_t) 0, monoSerial);
    in.note = asCaptured ? juce::String ("Could not read the sound") : mono.empty() ? juce::String (uni ("Reading the sound\xe2\x80\xa6")) : juce::String();
    in.hasFile = fileFrames > 0;
    in.fileLen = fileLen();
    in.fileRate = fileRate;
    in.engine = engine.toStdString();
    in.read = [this] (const std::string& k) { return read (juce::String (k)); };
    in.head = head();
    in.headLive = playing || !held.empty();
    in.noteHead = (bool) live["keys"]["sounding"] && voice.mode != "poly";
    if (auto* hs = live["heads"].getArray())
        for (const auto& h : *hs)
            in.heads.push_back ({ (int) dnum (h["key"], 60), dnum (h["src"]), dnum (h["env"], 1) });
    if (!held.empty())
        in.lastKey = held.rbegin()->first;
    if (live["keys"].isObject())
        in.keysPitch = dnum (live["keys"]["pitch"]);
    in.bend = bend;
    in.bendRange = voice.bendR;
    in.run = voice.run;
    in.loopOn = loopOn;
    in.cue = cue / juce::jmax (1.0, fileRate);
    const auto [a, b] = loopSecs();
    in.loopA = a;
    in.loopB = b;
    in.now = juce::Time::getMillisecondCounterHiRes() / 1000.0;
    in.keyDownAt = in.now;
    const auto& cl = captured["cl"];
    in.cl.wave = cl["wave"].toString();
    in.cl.bloom = cl["bloom"].toString();
    in.cl.acc = cl["acc"].toString();
    in.cl.on = cl["on"].toString();
    in.cl.track = cl["track"].toString();
    in.cl.t = cl["t"].toString();
    in.cl.t2 = cl["t2"].toString();
    in.cl.t3 = cl["t3"].toString();
    in.cl.glow = dnum (cl["glow"], 1.1);
    in.sounded = sounded;
    if (auto* gs = schedule["grains"].getArray())
        for (const auto& e : *gs)
            in.plan.push_back ({ dnum (e[0]), dnum (e[1]), dnum (e[2]), dnum (e[3]), dnum (e[4]), dnum (e[5]), dnum (e[6]), dnum (e[7]) });
    in.planRate = dnum (schedule["sampleRate"]);
    in.planTotal = dnum (schedule["total"]);
    in.timeRatio = dnum (draft["ratio"], 1);
    in.viewRate = fileRate;
    in.deviceRate = deviceRate;
    return in;
}

void GrainFace::drawHeadPic (juce::Graphics& g, float w, float h)
{
    c2d::Context c (g, w, h);
    c.lineJoin = c.lineCap = "round";
    gpic::headPic (c, w, h, picInputs(), picState);
}

void GrainFace::drawMapPic (juce::Graphics& g, float w, float h)
{
    c2d::Context c (g, w, h);
    c.lineJoin = c.lineCap = "round";
    gpic::mapPic (c, w, h, picInputs(), picState);
}

void GrainFace::drawLens (juce::Graphics& g, float w, float h)
{
    c2d::Context c (g, w, h);
    c.lineJoin = c.lineCap = "round";
    gpic::lens (c, w, h, picInputs(), picState);
}
