#include "WaveDraw.h"

namespace wave
{
namespace
{
constexpr float TAU = juce::MathConstants<float>::twoPi;
constexpr float PI = juce::MathConstants<float>::pi;

juce::String hsla (float h, float s, float l, float a)
{
    return "hsla(" + juce::String (h) + "," + juce::String (s) + "%," + juce::String (l) + "%," + juce::String (a) + ")";
}

struct Ofx
{
    float hue, sat;
    const char* g;
    const char* name;
};
const std::map<juce::String, Ofx>& ofxTable()
{
    static const std::map<juce::String, Ofx> t {
        { "off", { 220, 0, "M2 7 H16", "None" } },
        { "chorus", { 175, 62, "M2 5 C5 1,7 1,9 5 S13 9,16 5 M2 10 C5 6,7 6,9 10 S13 14,16 10", "Chorus" } },
        { "crush", { 38, 62, "M2 12 V9 H5 V5 H8 V3 H11 V6 H14 V10 H16", "Crush" } },
        { "drive", { 12, 62, "M2 12 C4 12,5 3,8 3 H11 C13 3,13 12,16 12", "Drive" } },
        { "delay", { 265, 62, "M3 3 V11 M7 4.5 V9.5 M11 5.5 V8.5 M15 6.3 V7.7", "Delay" } },
        { "phaser", { 205, 62, "M2 7 C4 2,6 12,8 7 S12 2,16 7", "Phaser" } },
        { "ring", { 320, 62, "M2 7 C3 2,4 2,5 7 S7 12,8 7 S10 2,11 7 S13 12,14 7 S15 2,16 7", "Ring" } },
        { "comb", { 125, 62, "M2 4 L4 12 L6 4 L8 12 L10 4 L12 12 L14 4 L16 12", "Comb" } },
    };
    return t;
}

const Ofx& ofx (const juce::String& k)
{
    auto& t = ofxTable();
    auto it = t.find (k);
    return it == t.end() ? t.at ("off") : it->second;
}

// The spectrum's cosines and sines, as the page keeps them (`WV_TRIG`).
const std::vector<std::pair<Frame, Frame>>& trig()
{
    static const auto t = [] {
        std::vector<std::pair<Frame, Frame>> out;
        for (int k = 1; k <= 64; ++k)
        {
            Frame c {}, s {};
            for (int n = 0; n < NP; ++n)
            {
                c[(size_t) n] = (float) std::cos ((double) TAU * k * n / NP);
                s[(size_t) n] = (float) std::sin ((double) TAU * k * n / NP);
            }
            out.push_back ({ c, s });
        }
        return out;
    }();
    return t;
}

void spectrum (const Frame& a, int K, std::vector<float>& re, std::vector<float>& im)
{
    re.assign ((size_t) K, 0.0f);
    im.assign ((size_t) K, 0.0f);
    for (int k = 0; k < K; ++k)
    {
        const auto& [c, s] = trig()[(size_t) k];
        double r = 0, i = 0;
        for (int n = 0; n < NP; ++n)
        {
            r += a[(size_t) n] * c[(size_t) n];
            i += a[(size_t) n] * s[(size_t) n];
        }
        re[(size_t) k] = (float) (r * 2 / NP);
        im[(size_t) k] = (float) (i * 2 / NP);
    }
}

Frame fromSpectrum (const std::vector<float>& re, const std::vector<float>& im)
{
    Frame a {};
    for (size_t k = 0; k < re.size(); ++k)
    {
        const auto& [c, s] = trig()[k];
        for (int n = 0; n < NP; ++n)
            a[(size_t) n] += re[k] * c[(size_t) n] + im[k] * s[(size_t) n];
    }
    return a;
}

Frame norm (Frame a)
{
    float m = 0;
    for (float v : a)
        m = juce::jmax (m, std::abs (v));
    if (m > 0)
        for (auto& v : a)
            v /= m;
    return a;
}

float rnd (float n)
{
    const double x = std::sin ((double) n * 127.1 + 311.7) * 43758.5453;
    return (float) (x - std::floor (x));
}

float lfoAt (const juce::var& pts, float x)
{
    auto* a = pts.getArray();
    if (a == nullptr || a->size() < 2)
        return 0.5f;
    for (int i = 1; i < a->size(); ++i)
    {
        const auto& p = a->getReference (i - 1);
        const auto& q = a->getReference (i);
        const float px = (float) (double) p[0], py = (float) (double) p[1], qx = (float) (double) q[0], qy = (float) (double) q[1];
        if (x <= qx)
        {
            if (std::abs (qx - px) < 1e-9f)
                return qy;
            const float u = (x - px) / (qx - px);
            return py + (qy - py) * (0.5f - 0.5f * std::cos (PI * u));
        }
    }
    return (float) (double) a->getLast()[1];
}

float shapeAt (const juce::String& shape, const juce::var& pts, float u, int cyc)
{
    if (u != 1.0f)
        u = std::fmod (std::fmod (u, 1.0f) + 1.0f, 1.0f);
    if (shape == "sine")
        return 0.5f + 0.5f * std::sin (u * TAU);
    if (shape == "tri")
        return u < 0.25f ? 0.5f + 2 * u : u < 0.75f ? 1.5f - 2 * u : 2 * u - 1.5f;
    if (shape == "up")
        return u;
    if (shape == "down")
        return 1 - u;
    if (shape == "square")
        return u < 0.5f ? 1.0f : 0.0f;
    if (shape == "steps")
        return rnd ((float) (cyc * 8) + std::floor (u * 8));
    if (shape == "smooth")
    {
        const float k = u * 4, i = std::floor (k), f = k - i, a = rnd ((float) cyc * 4 + i), b = rnd ((float) cyc * 4 + i + 1);
        return a + (b - a) * (0.5f - 0.5f * std::cos (PI * f));
    }
    return lfoAt (pts, u);
}
} // namespace

// ─────────────────────────────────────────────────────────────── colours

Cl colours (const juce::var& vars)
{
    auto v = [&] (const char* k, const char* fallback) {
        auto s = vars[k].toString().trim();
        return s.isEmpty() ? juce::String (fallback) : s;
    };
    Cl c;
    c.wave = c2d::css (v ("--wv-wave", "#fff"));
    c.acc = c2d::css (v ("--wv-acc", "#7cf0d0"));
    c.mod = c2d::css (v ("--wv-mod", "#8aa0c8"));
    c.arc = c2d::css (v ("--wv-arc", "#d3d7de"));
    c.track = c2d::css (v ("--wv-track", "#2a2e34"));
    c.t = c2d::css (v ("--wv-t", "#e8eaee"));
    c.t2 = c2d::css (v ("--wv-t2", "#b9bec6"));
    c.t3 = c2d::css (v ("--wv-t3", "#858b94"));
    auto bloom = juce::StringArray::fromTokens (v ("--wv-bloom", "205,225,255"), ",", "");
    if (bloom.size() == 3)
        c.br = bloom[0].getFloatValue(), c.bg = bloom[1].getFloatValue(), c.bb = bloom[2].getFloatValue();
    c.glow = v ("--wv-glow", "1.1").getFloatValue();
    return c;
}

juce::String sourceColour (const juce::String& src)
{
    static const std::map<juce::String, juce::String> col {
        { "env1", "#f0a640" }, { "env2", "#ec7f5c" }, { "env3", "#d9c487" }, { "lfo0", "#5cc8e6" }, { "lfo1", "#a48cf2" },
        { "lfo2", "#ee72a8" }, { "lfo3", "#9bd36c" }, { "amp", "#e8ecf2" }, { "vel", "#8fa6e8" }, { "note", "#a9b8d6" },
        { "mw", "#7f96c8" }, { "at", "#b4a6d8" }, { "rand", "#c9cfdc" },
    };
    auto it = col.find (src);
    return it != col.end() ? it->second : src.startsWith ("macro") ? juce::String ("#e6d8b8") : juce::String ("#8aa0c8");
}

Cl sourceCl (const Cl& base, const juce::String& src)
{
    Cl c = base;
    const auto col = c2d::css (sourceColour (src));
    c.wave = col;
    c.br = col.getRed(), c.bg = col.getGreen(), c.bb = col.getBlue();
    return c;
}

// ───────────────────────────────────────────────────────────────── model

float Model::g (const juce::String& k, float fallback) const
{
    auto it = p.find (k);
    if (it == p.end() || it->second.isVoid() || !(it->second.isDouble() || it->second.isInt() || it->second.isInt64() || it->second.isBool()))
        return fallback;
    return (float) (double) it->second;
}

juce::String Model::s (const juce::String& k) const
{
    auto it = p.find (k);
    return it == p.end() ? juce::String() : it->second.toString();
}

const juce::var& Model::v (const juce::String& k) const
{
    static const juce::var none;
    auto it = p.find (k);
    return it == p.end() ? none : it->second;
}

const Table& Model::table (const juce::String& name)
{
    auto it = tables.find (name);
    if (it == tables.end())
    {
        Table t = loadTable ? loadTable (name) : Table();
        if (t.empty())
        {
            // The page's fallback for a table it can't read: a plain sine.
            Frame f {};
            for (int n = 0; n < NP; ++n)
                f[(size_t) n] = std::sin (TAU * (float) n / NP);
            t = { f, f };
        }
        it = tables.emplace (name, std::move (t)).first;
    }
    return it->second;
}

// ─────────────────────────────────────────────────────────────────── kit

float clamp (float v, float a, float b) { return juce::jmax (a, juce::jmin (b, v)); }

float rd (const Frame& a, float x)
{
    x = std::fmod (std::fmod (x, 1.0f) + 1.0f, 1.0f);
    const float p = x * (float) NP;
    const int i = juce::jmin (NP - 1, (int) std::floor (p));
    const float u = p - (float) i;
    return a[(size_t) i] * (1 - u) + a[(size_t) ((i + 1) % NP)] * u;
}

Frame frameAt (const Table& T, float p)
{
    p = clamp (p) * (float) (T.size() - 1);
    const int i = (int) std::floor (p), j = juce::jmin ((int) T.size() - 1, i + 1);
    const float u = p - (float) i;
    Frame o {};
    for (int n = 0; n < NP; ++n)
        o[(size_t) n] = T[(size_t) i][(size_t) n] * (1 - u) + T[(size_t) j][(size_t) n] * u;
    return o;
}

Frame warp (const Frame& a, const juce::String& mode, float w, const Frame* mod)
{
    static const juce::StringArray modes { "bend", "sync", "pwm", "fold", "mirror", "asym", "quant", "fm" };
    if (mode == "off" || !modes.contains (mode) || w <= 0)
        return a;
    Frame o {};
    for (int n = 0; n < NP; ++n)
    {
        float x = (float) n / NP, y = 0;
        if (mode == "bend")
        {
            const float e = 1 + w * 4;
            x = x < 0.5f ? 0.5f * std::pow (2 * x, e) : 1 - 0.5f * std::pow (2 * (1 - x), e);
            y = rd (a, x);
        }
        else if (mode == "sync")
            y = rd (a, x * (1 + w * 6));
        else if (mode == "pwm")
        {
            const float c = 0.5f - w * 0.45f;
            x = x < c ? x / c * 0.5f : 0.5f + (x - c) / (1 - c) * 0.5f;
            y = rd (a, x);
        }
        else if (mode == "fold")
        {
            y = rd (a, x) * (1 + w * 4);
            int g = 0;
            while (std::abs (y) > 1 && g++ < 20)
                y = y > 1 ? 2 - y : -2 - y;
        }
        else if (mode == "mirror")
        {
            const float m = 0.5f + (1 - w) * 0.5f;
            y = x < m ? rd (a, x / m * 0.5f) : rd (a, 0.5f - (x - m) / (1 - m) * 0.5f);
        }
        else if (mode == "asym")
        {
            const float c = 0.5f + w * 0.4f;
            x = x < c ? x / c * 0.5f : 0.5f + (x - c) / (1 - c) * 0.5f;
            y = rd (a, x);
        }
        else if (mode == "quant")
        {
            const float s = std::round (2 + (1 - w) * 30);
            y = std::round (rd (a, x) * s) / s;
        }
        else if (mode == "fm")
        {
            const Frame& b = mod != nullptr ? *mod : a;
            y = rd (a, x + w * 0.35f * rd (b, x * 2));
        }
        o[(size_t) n] = y;
    }
    return o;
}

Frame ofxShape (const Frame& f, const juce::String& m, float a, float b)
{
    if (m.isEmpty() || m == "off")
        return f;
    Frame o {};
    if (m == "crush")
    {
        const float bits = std::round (2 + (1 - b) * 6), q = std::pow (2.0f, bits - 1);
        const int hold = 1 + (int) std::round (b * 14);
        for (int n = 0; n < NP; ++n)
            o[(size_t) n] = f[(size_t) n] * (1 - a) + std::round (f[(size_t) (n - n % hold)] * q) / q * a;
        return o;
    }
    if (m == "drive")
    {
        const float d = 1 + b * 10;
        for (int n = 0; n < NP; ++n)
            o[(size_t) n] = f[(size_t) n] * (1 - a) + std::tanh (f[(size_t) n] * d) / std::tanh (d) * a;
        return o;
    }
    if (m == "ring")
    {
        const float r = 1 + std::round (b * 7);
        for (int n = 0; n < NP; ++n)
            o[(size_t) n] = f[(size_t) n] * (1 - a) + f[(size_t) n] * std::sin (TAU * r * (float) n / NP) * a;
        return o;
    }
    if (m == "comb")
    {
        std::vector<float> re, im;
        spectrum (f, 48, re, im);
        const float d = 2 + b * 10;
        for (int k = 0; k < 48; ++k)
        {
            const float g = 1 - a * 0.9f * (0.5f + 0.5f * std::cos (TAU * (float) (k + 1) / d));
            re[(size_t) k] *= g;
            im[(size_t) k] *= g;
        }
        return norm (fromSpectrum (re, im));
    }
    return f;
}

std::vector<float> mags (const Frame& a, int K)
{
    std::vector<float> re, im;
    spectrum (a, K, re, im);
    std::vector<float> out ((size_t) K);
    for (int k = 0; k < K; ++k)
        out[(size_t) k] = std::hypot (re[(size_t) k], im[(size_t) k]);
    return out;
}

juce::String lfoShape (const Model& m, int L)
{
    const auto s = m.s ("lfo" + juce::String (L) + ".shape");
    return s.isEmpty() ? "drawn" : s;
}

float lfoVal (const Model& m, int L, float u, int cyc)
{
    return shapeAt (lfoShape (m, L), m.v ("lfo" + juce::String (L) + ".points"), u, cyc);
}

juce::String lfoRateTxt (const Model& m, int L)
{
    static const char* divs[] = { "8 bars", "4 bars", "2 bars", "1 bar", "1/2", "1/4", "1/8", "1/16", "1/32" };
    const auto k = "lfo" + juce::String (L) + ".";
    if (m.g (k + "sync") >= 0.5f)
        return divs[juce::jlimit (0, 8, (int) std::round (clamp (m.g (k + "rate")) * 8))];
    const float h = 0.02f * std::pow (2000.0f, clamp (m.g (k + "rate", 0.4f)));
    return h < 1 ? juce::String (h, 2) + " Hz" : h < 10 ? juce::String (h, 1) + " Hz" : juce::String (juce::roundToInt (h)) + " Hz";
}

juce::String fmtHz (float f) { return f >= 1000 ? juce::String (f / 1000, 1) + " kHz" : juce::String (juce::roundToInt (f)) + " Hz"; }
juce::String fmtMs (float s) { return s < 1 ? juce::String (juce::roundToInt (s * 1000)) + " ms" : juce::String (s, 2) + " s"; }
juce::String fmtC (float s) { return s < 1 ? juce::String (juce::roundToInt (s * 1000)) + "ms" : juce::String (s, 2) + "s"; }

juce::Colour fxCol (const juce::String& k, float l, float a)
{
    const auto& o = ofx (k);
    return c2d::css (hsla (o.hue, o.sat, l, a));
}

juce::String ofxName (const juce::String& k) { return ofx (k).name; }

c2d::Path path (const std::function<juce::Point<float> (float)>& fn, int n)
{
    c2d::Path p;
    for (int i = 0; i <= n; ++i)
    {
        const auto q = fn ((float) i / (float) n);
        if (i)
            p.lineTo (q.x, q.y);
        else
            p.moveTo (q.x, q.y);
    }
    return p;
}

void trace (c2d::Context& c, const c2d::Path& p, const Cl& cl, float lw, float g)
{
    c.lineJoin = "round";
    c.lineCap = "round";
    const float glow = cl.glow * g;
    if (glow > 0)
    {
        c.strokeStyle = cl.bloom (0.16f * glow);
        c.lineWidth = lw * 3.6f;
        c.shadowBlur = 10 * glow;
        c.shadowColor = cl.bloom (0.4f * juce::jmin (1.0f, glow));
        c.stroke (p);
        c.shadowBlur = 0;
    }
    c.strokeStyle = cl.wave;
    c.lineWidth = lw;
    c.stroke (p);
}

void under (c2d::Context& c, const c2d::Path& p, float x0, float x1, float base, float top, const Cl& cl, float a)
{
    c2d::Path f (p);
    f.lineTo (x1, base);
    f.lineTo (x0, base);
    f.closePath();
    auto g = c.createLinearGradient (0, top, 0, base);
    g.stops.push_back ({ 0.0f, cl.bloom (a) });
    g.stops.push_back ({ 1.0f, cl.bloom (0) });
    c.fillStyle = g;
    c.fill (f);
}

void dot (c2d::Context& c, float x, float y, float r, juce::Colour col)
{
    c.fillStyle = col;
    c.shadowBlur = 9;
    c.shadowColor = col;
    c.beginPath();
    c.arc (x, y, r, 0, TAU);
    c.fill();
    c.shadowBlur = 0;
}

void ring (c2d::Context& c, float size, float u, const Cl& cl, bool bip, bool pointer)
{
    const float A0 = PI * 0.75f, SWEEP = PI * 1.5f;
    const float cc = size / 2, r = cc - 4, w = size > 60 ? 3.0f : size >= 40 ? 2.4f : 2.0f;
    u = clamp (u);
    auto arcPath = [&] (float u0, float u1) {
        c2d::Path p;
        if (u1 - u0 < 0.0005f)
            return p;
        p.arc (cc, cc, r, A0 + SWEEP * u0, A0 + SWEEP * u1);
        return p;
    };
    c.save();
    c.lineCap = "round";
    c.lineWidth = w;
    c.strokeStyle = cl.track;
    c.stroke (arcPath (0, 1));
    const float o = bip ? 0.5f : 0.0f;
    c.strokeStyle = cl.arc;
    c.shadowBlur = cl.glow * 3 * 2;
    c.shadowColor = cl.arc.withMultipliedAlpha (0.55f);
    c.stroke (arcPath (juce::jmin (o, u), juce::jmax (o, u)));
    c.shadowBlur = 0;
    if (pointer)
    {
        const float a = A0 + SWEEP * u;
        c.strokeStyle = cl.t;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo (cc + std::cos (a) * r * 0.2f, cc + std::sin (a) * r * 0.2f);
        c.lineTo (cc + std::cos (a) * r * 0.62f, cc + std::sin (a) * r * 0.62f);
        c.stroke();
    }
    c.restore();
}

// ────────────────────────────────────────────────────────────── drawings

Frame waveFor (Model& m, int i, bool dry)
{
    const auto k = "osc" + juce::String (i) + ".";
    Frame f = frameAt (m.table (m.s (k + "table")), clamp (m.g (k + "pos")));
    const int o = i == 1 ? 0 : 1;
    const Frame B = frameAt (m.table (m.s ("osc" + juce::String (o) + ".table")), clamp (m.g ("osc" + juce::String (o) + ".pos")));
    for (int j : { 0, 1 })
        f = warp (f, m.s (k + "warp" + juce::String (j) + ".mode"), clamp (m.g (k + "warp" + juce::String (j) + ".amt")), &B);
    return dry ? f : ofxShape (f, m.s (k + "fx.mode"), m.g (k + "fx.a"), m.g (k + "fx.b"));
}

void draw3D (c2d::Context& c, float w, float h, const Cl& cl, const Table& T, float p, const juce::String& wm, float wa, float rise, float depth, bool floor)
{
    const int n = juce::jmin ((int) T.size(), 28);
    const float cf = p * (float) (n - 1);
    const float sx = w * (0.98f - depth) - 12, amp = h * 0.15f;
    for (int i = n - 1; i >= 0; --i)
    {
        const float d = n > 1 ? (float) i / (float) (n - 1) : 0.0f;
        const Frame a = warp (T[(size_t) std::round (d * (float) (T.size() - 1))], wm, wa);
        const float x0 = 8 + d * w * depth, y0 = h * 0.78f - d * h * rise;
        const auto pts = path ([&] (float u) { return juce::Point<float> (x0 + u * sx, y0 - rd (a, u) * amp); }, 70);
        const float hue = 205 - 175 * d;
        c2d::Path f (pts);
        f.lineTo (x0 + sx, y0);
        f.lineTo (x0, y0);
        f.closePath();
        c.fillStyle = c2d::css (hsla (hue, 70, 55, std::abs ((float) i - cf) < 1 ? 0.22f : 0.05f));
        c.fill (f);
        c.strokeStyle = c2d::css (hsla (hue, 80, 72, 0.2f + 0.45f * (1 - d)));
        c.lineWidth = 1;
        c.stroke (pts);
    }
    const Frame a = warp (frameAt (T, p), wm, wa);
    const float x0 = 8 + p * w * depth, y0 = h * 0.78f - p * h * rise;
    const auto pts = path ([&] (float u) { return juce::Point<float> (x0 + u * sx, y0 - rd (a, u) * amp); }, 160);
    if (floor)
    {
        const float yb = h * 0.8f;
        c.save();
        c.globalAlpha = 0.18f;
        c.strokeStyle = cl.bloom (1);
        c.lineWidth = 1.2f;
        c.stroke (path ([&] (float u) { const float y = y0 - rd (a, u) * amp; return juce::Point<float> (x0 + u * sx, yb + juce::jmax (0.0f, yb - y) * 0.32f); }, 120));
        c.restore();
        auto fg = c.createLinearGradient (0, yb, 0, h);
        fg.stops.push_back ({ 0.0f, cl.bloom (0.05f) });
        fg.stops.push_back ({ 1.0f, juce::Colours::transparentBlack });
        c.fillStyle = fg;
        c.fillRect (0, yb, w, h - yb);
    }
    under (c, pts, x0, x0 + sx, y0, y0 - amp, cl, 0.2f);
    trace (c, pts, cl, 1.6f);
    dot (c, x0 - 4, y0, 2.6f, cl.acc);
}

void drawSpec3D (c2d::Context& c, float w, float h, const Cl& cl, const Table& T, float p, const juce::String& wm, float wa, float rise, float depth)
{
    const int n = 26, K = 40;
    auto db = [] (float v) { return clamp ((20 * std::log10 (juce::jmax (v, 1e-5f)) + 54) / 54); };
    auto ridge = [&] (const std::vector<float>& m, float x0, float y0, float sx, float hh) {
        return path ([&] (float u) {
            const float kf = std::pow ((float) K, u) - 1;
            const int k0 = (int) std::floor (kf), k1 = juce::jmin (K - 1, k0 + 1);
            const float f = kf - (float) k0;
            return juce::Point<float> (x0 + u * sx, y0 - (db (m[(size_t) k0]) * (1 - f) + db (m[(size_t) k1]) * f) * hh);
        }, 90);
    };
    const float sx = w * (0.98f - depth) - 12, hh = h * 0.34f;
    for (int r = n - 1; r >= 0; --r)
    {
        const float d = (float) r / (float) (n - 1);
        const auto m = mags (warp (T[(size_t) std::round (d * (float) (T.size() - 1))], wm, wa), K);
        const float x0 = 8 + d * w * depth, y0 = h * 0.8f - d * h * rise, hue = 205 - 175 * d;
        const auto pts = ridge (m, x0, y0, sx, hh);
        c2d::Path f (pts);
        f.lineTo (x0 + sx, y0);
        f.lineTo (x0, y0);
        f.closePath();
        c.fillStyle = c2d::css (hsla (hue, 70, 55, 0.05f));
        c.fill (f);
        c.strokeStyle = c2d::css (hsla (hue, 80, 72, 0.2f + 0.45f * (1 - d)));
        c.lineWidth = 1;
        c.stroke (pts);
    }
    const auto m = mags (warp (T[(size_t) std::round (p * (float) (T.size() - 1))], wm, wa), K);
    const float x0 = 8 + p * w * depth, y0 = h * 0.8f - p * h * rise;
    const auto pts = ridge (m, x0, y0, sx, hh);
    under (c, pts, x0, x0 + sx, y0, y0 - hh, cl, 0.2f);
    trace (c, pts, cl, 1.6f);
    dot (c, x0 - 4, y0, 2.6f, cl.acc);
    c.font = "9px mono";
    c.fillStyle = cl.t3;
    c.fillText ("SPECTRUM", 8, 13);
    c.textAlign = "right";
    c.fillText (juce::String::fromUTF8 ("low \xe2\x86\x92 high"), w - 8, 13);
    c.textAlign = "left";
}

void drawStrip (c2d::Context& c, float w, float h, const Cl& cl, const Table& T, float p)
{
    const int n = 24;
    const float pad = 6, cw = (w - pad * 2) / (float) n;
    for (int i = 0; i < n; ++i)
    {
        const Frame& f = T[(size_t) std::round ((float) i / (float) (n - 1) * (float) (T.size() - 1))];
        const float x = pad + (float) i * cw;
        const bool on = std::abs ((float) i / (float) (n - 1) - p) < 0.5f / (float) (n - 1);
        c.strokeStyle = on ? cl.wave : cl.bloom (0.3f);
        c.lineWidth = on ? 1.3f : 1.0f;
        c.stroke (path ([&] (float u) { return juce::Point<float> (x + 2 + u * (cw - 4), h / 2 + 2 - rd (f, u) * (h * 0.3f)); }, 18));
    }
    const float x = pad + p * (w - pad * 2);
    c.fillStyle = cl.acc;
    c.shadowBlur = 8;
    c.shadowColor = cl.acc;
    c.fillRect (x - 1, 3, 2, h - 6);
    c.shadowBlur = 0;
}

void drawFace (c2d::Context& c, float w, float h, const Cl& cl, float v, const Frame& wave, const Frame* ghost, bool empty)
{
    const float cx = w / 2, cy = h / 2;
    if (empty)
    {
        c.setLineDash ({ 3, 4 });
        c.strokeStyle = cl.t3;
        c.lineWidth = 1.2f;
        c.beginPath();
        c.arc (cx, cy, w / 2 - 6, 0, TAU);
        c.stroke();
        c.setLineDash ({});
        c.lineWidth = 1.6f;
        c.beginPath();
        c.moveTo (cx - 7, cy);
        c.lineTo (cx + 7, cy);
        c.moveTo (cx, cy - 7);
        c.lineTo (cx, cy + 7);
        c.stroke();
        return;
    }
    ring (c, w, v, cl);
    const float r = w * 0.31f;
    c.save();
    c.beginPath();
    c.arc (cx, cy, r, 0, TAU);
    c.clip();
    if (ghost != nullptr)
    {
        c.strokeStyle = cl.bloom (0.18f);
        c.lineWidth = 1;
        c.stroke (path ([&] (float u) { return juce::Point<float> (cx - r * 0.8f + u * r * 1.6f, cy - rd (*ghost, u) * r * 0.45f); }, 70));
    }
    trace (c, path ([&] (float u) { return juce::Point<float> (cx - r * 0.8f + u * r * 1.6f, cy - rd (wave, u) * r * 0.45f); }, 110), cl, 1.4f, 0.8f);
    c.restore();
}

void drawControlPic (c2d::Context& c, float w, float h, const Cl& cl, float u, const juce::String& key)
{
    const float x = w * 0.23f, y = h * 0.27f, width = w * 0.54f, height = h * 0.46f;
    c.save();
    c.translate (x, y);
    c.lineWidth = 1;
    c.strokeStyle = cl.t3;
    c.beginPath();
    c.moveTo (0, height / 2);
    c.lineTo (width, height / 2);
    c.stroke();
    c.strokeStyle = cl.acc;
    c.beginPath();
    const auto k = key.toLowerCase();
    auto has = [&] (std::initializer_list<const char*> words) {
        for (auto* wd : words)
            if (k.contains (wd))
                return true;
        return false;
    };
    if (has ({ "pan", "width", "spread", "mix", "wet", "dry", "key" }))
    {
        const float at = u * width;
        c.moveTo (at, 0);
        c.lineTo (at, height);
        c.moveTo (0, height);
        c.lineTo (at, height * 0.35f);
        c.lineTo (width, height);
    }
    else if (has ({ "cut", "freq", "tone", "res" }) || (k.contains ("band") && k.contains ("q")))
    {
        const float at = width * (0.15f + 0.7f * u);
        c.moveTo (0, height * 0.2f);
        c.lineTo (at, height * 0.2f);
        c.quadraticCurveTo (at + width * 0.15f, height * 0.05f, width, height);
    }
    else if (has ({ "drive", "gain", "db", "level", "threshold", "ratio" }))
    {
        const float kk = 0.15f + 0.7f * u;
        c.moveTo (0, height);
        c.lineTo (width * kk, height * (1 - kk));
        c.lineTo (width, height * (1 - kk));
    }
    else
    {
        for (int i = 0; i <= 24; ++i)
        {
            const float xx = (float) i / 24 * width, yy = height / 2 - std::sin ((float) i / 24 * PI * (1 + 5 * u)) * height * 0.42f;
            if (i)
                c.lineTo (xx, yy);
            else
                c.moveTo (xx, yy);
        }
    }
    c.stroke();
    c.restore();
}

void drawKnob (c2d::Context& c, float w, float h, const Cl& cl, float v, const juce::String& key, bool bip)
{
    ring (c, w, v, cl, bip, true);
    drawControlPic (c, w, h, cl, v, key);
}

void drawUniFace (c2d::Context& c, float w, float h, const Cl& cl, const Frame& cur, int n, float det, float spr)
{
    const float cx = w / 2, cy = h / 2, r = w * 0.3f;
    ring (c, w, det, cl);
    c.save();
    c.beginPath();
    c.arc (cx, cy, r, 0, TAU);
    c.clip();
    for (int i = 0; i < n; ++i)
    {
        const float off = n > 1 ? (float) i / (float) (n - 1) * 2 - 1 : 0.0f, y = cy - off * det * r * 0.9f;
        const float side = n > 1 ? ((i % 2) ? 1.0f : -1.0f) * std::abs (off) : 0.0f;
        const float x0 = cx - r * 0.85f + side * spr * r * 0.35f, len = r * 1.7f, hue = 205 - 175 * (off + 1) / 2;
        const auto p = path ([&] (float q) { return juce::Point<float> (x0 + q * len, y - rd (cur, q * 2) * r * 0.16f); }, 50);
        if (off == 0.0f || n == 1)
            trace (c, p, cl, 1.1f, 0.5f);
        else
        {
            c.strokeStyle = c2d::css (hsla (hue, 70, 70, 0.7f));
            c.lineWidth = 1;
            c.stroke (p);
        }
    }
    c.restore();
    c.font = "600 9px mono";
    c.fillStyle = cl.t2;
    c.textAlign = "center";
    c.fillText (juce::String (n), cx, h - 3);
    c.textAlign = "left";
}

void drawHBar (c2d::Context& c, float w, float h, const Cl& cl, float v)
{
    const float x = 6 + (w - 12) * v;
    c.save();
    c.beginPath();
    c.rect (6, 3, x - 6, h - 6);
    c.clip();
    c2d::Path p;
    for (int i = 0; i <= 60; ++i)
    {
        const float xx = 6 + (float) i / 60 * (w - 12), u = (float) i / 60, yy = h - 5 - (h - 10) * (1 - std::exp (-u * 5 / (v * 3 + 0.05f)));
        if (i)
            p.lineTo (xx, yy);
        else
            p.moveTo (xx, yy);
    }
    trace (c, p, cl, 1.1f, 0.6f);
    c.restore();
    c.strokeStyle = cl.track;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo (x, 3);
    c.lineTo (w - 6, 3);
    c.stroke();
    c.fillStyle = cl.t;
    c.beginPath();
    c.roundRect (x - 2, 2, 4, h - 4, 2);
    c.fill();
}

void drawRuler (c2d::Context& c, float w, float h, const Cl& cl, int semi, int cents)
{
    const float step = 6, off = (float) semi + (float) cents / 100;
    auto X = [&] (float v) { return w / 2 + (v - off) * step; };
    for (int k = -14; k <= 14; ++k)
    {
        const int v = semi + k;
        const float x = X ((float) v);
        if (x < 4 || x > w - 4)
            continue;
        const int pc = ((v % 12) + 12) % 12;
        const bool oct = pc == 0, blk = pc == 1 || pc == 3 || pc == 6 || pc == 8 || pc == 10;
        const float hh = oct ? h - 14 : blk ? 6.0f : 10.0f;
        c.fillStyle = oct ? cl.t2 : blk ? c2d::css ("rgba(255,255,255,.14)") : c2d::css ("rgba(255,255,255,.26)");
        c.fillRect (x - 0.5f, h - 4 - hh, 1, hh);
        if (oct)
        {
            c.font = "9px mono";
            c.fillStyle = cl.t3;
            c.fillText ((v > 0 ? "+" : "") + juce::String (v / 12), x + 3, 10);
        }
    }
    c.fillStyle = cl.acc;
    c.shadowBlur = 8;
    c.shadowColor = cl.acc;
    c.fillRect (w / 2 - 1, 3, 2, h - 6);
    c.shadowBlur = 0;
}

void drawPhase (c2d::Context& c, float w, float h, const Cl& cl, float ph, const Frame& cur)
{
    ring (c, w, ph, cl);
    const float cx = w / 2, cy = h / 2, r = w * 0.27f;
    trace (c, path ([&] (float u) {
               const float a = u * TAU - PI / 2 + ph * TAU, rr = r * 0.6f + rd (cur, u) * r * 0.32f;
               return juce::Point<float> (cx + std::cos (a) * rr, cy + std::sin (a) * rr);
           }, 70),
           cl, 1, 0.5f);
    const float a = -PI / 2 + ph * TAU;
    c.strokeStyle = cl.acc;
    c.lineWidth = 1.6f;
    c.beginPath();
    c.moveTo (cx + std::cos (a) * r * 0.3f, cy + std::sin (a) * r * 0.3f);
    c.lineTo (cx + std::cos (a) * r, cy + std::sin (a) * r);
    c.stroke();
}

void drawPick (c2d::Context& c, float w, float h, const Cl& cl, const Table& T)
{
    c.strokeStyle = cl.wave;
    c.lineWidth = 1.2f;
    c.stroke (path ([&] (float u) { return juce::Point<float> (1 + u * (w - 2), h / 2 - rd (frameAt (T, u), std::fmod (u * 3, 1.0f)) * (h * 0.4f)); }, 60));
}

void drawLens (c2d::Context& c, float w, float h, const Cl& cl, const Model& m, const Frame& cur, int i)
{
    const auto f = "filt" + juce::String (i) + ".";
    auto fx = [&] (float fr) { return 6 + (std::log10 (fr) - std::log10 (20.0f)) / 3 * (w - 12); };
    const float cut = clamp (m.g (f + "cut")), fc = 20 * std::pow (1000.0f, cut), Q = 0.7f + m.g (f + "res") * 9;
    const auto type = m.s (f + "type");
    auto Hm = [&] (float fr) -> float {
        const float x = fr / fc;
        const float den = std::sqrt ((1 - x * x) * (1 - x * x) + (x / Q) * (x / Q));
        if (type == "hp")
            return x * x / den;
        if (type == "bp")
            return (x / Q) / den * Q * 0.6f;
        if (type == "notch")
            return std::abs (1 - x * x) / den;
        if (type == "comb")
            return 0.55f + 0.45f * std::cos (TAU * fr / fc);
        if (type == "form")
        {
            const float a = std::log2 (fr / fc) / 0.25f, b = std::log2 (fr / (fc * 2.3f)) / 0.25f;
            return 0.2f + std::exp (-(a * a)) + 0.7f * std::exp (-(b * b));
        }
        return 1 / den;
    };
    auto dbY = [&] (float db) { return h * 0.58f - db * 1.4f; };
    c.strokeStyle = c2d::css ("rgba(255,255,255,.05)");
    for (float fr : { 100.0f, 1000.0f, 10000.0f })
    {
        c.beginPath();
        c.moveTo (fx (fr), 3);
        c.lineTo (fx (fr), h - 3);
        c.stroke();
    }
    const auto mg = mags (cur);
    for (int k = 0; k < 48; ++k)
    {
        const float fr = 110.0f * (float) (k + 1);
        if (fr > 20000)
            break;
        const float a = mg[(size_t) k];
        if (a < 0.003f)
            continue;
        const float db = 20 * std::log10 (a), x = fx (fr);
        const float hh = clamp ((db + 48) / 48) * h * 0.55f, fh = clamp ((db + 20 * std::log10 (Hm (fr)) + 48) / 48) * h * 0.55f;
        c.fillStyle = cl.bloom (0.12f);
        c.fillRect (x - 1, h - 3 - hh, 2, hh);
        c.fillStyle = cl.bloom (0.7f);
        c.fillRect (x - 1, h - 3 - fh, 2, fh);
    }
    const auto pts = path ([&] (float u) { const float fr = 20 * std::pow (1000.0f, u); return juce::Point<float> (fx (fr), clamp (dbY (20 * std::log10 (Hm (fr) + 1e-6f)), 3, h - 3)); }, 140);
    under (c, pts, 6, w - 6, h, 0, cl, 0.14f);
    trace (c, pts, cl, 1.5f);
    dot (c, fx (fc), clamp (dbY (20 * std::log10 (Hm (fc) + 1e-6f)), 5, h - 5), 3.5f, cl.acc);
    c.font = "10px mono";
    c.fillStyle = cl.t2;
    c.textAlign = "right";
    c.fillText (fmtHz (fc) + juce::String::fromUTF8 (" \xc2\xb7 Q ") + juce::String (Q, 1), w - 8, 14);
    c.textAlign = "left";
}

juce::String drawOfx (c2d::Context& c, float w, float h, const Cl& cl, Model& m, int i, float t)
{
    const auto k = "osc" + juce::String (i) + ".";
    juce::String K = m.s (k + "fx.mode");
    if (ofxTable().count (K) == 0)
        K = "off";
    const Frame dry = waveFor (m, i, true);
    const float a = clamp (m.g (k + "fx.a")), b = m.g (k + "fx.b");
    auto bg = c.createRadialGradient (w * 0.25f, h * 0.1f, 4, w * 0.5f, h * 0.5f, w * 0.8f);
    bg.stops.push_back ({ 0.0f, fxCol (K, 45, 0.22f) });
    bg.stops.push_back ({ 1.0f, fxCol (K, 30, 0) });
    c.fillStyle = bg;
    c.fillRect (0, 0, w, h);
    auto X = [&] (float u) { return 8 + u * (w - 16); };
    auto Y = [&] (float v, float s = 1) { return h / 2 + 4 - v * h * 0.3f * s; };
    auto fxTrace = [&] (const c2d::Path& p, float lw) {
        c.lineJoin = "round";
        c.lineCap = "round";
        c.strokeStyle = fxCol (K, 60, 0.22f);
        c.lineWidth = lw * 3.6f;
        c.shadowBlur = 10;
        c.shadowColor = fxCol (K, 60, 0.5f);
        c.stroke (p);
        c.shadowBlur = 0;
        c.strokeStyle = fxCol (K, 80);
        c.lineWidth = lw;
        c.stroke (p);
    };
    auto ghost = [&] {
        c.strokeStyle = cl.bloom (0.16f);
        c.lineWidth = 1;
        c.stroke (path ([&] (float u) { return juce::Point<float> (X (u), Y (rd (dry, u * 2))); }, 120));
    };
    juce::String rdText;
    const auto pct = juce::String (juce::roundToInt (a * 100)) + " %";
    const auto dotSep = juce::String::fromUTF8 (" \xc2\xb7 ");
    if (K == "chorus")
    {
        ghost();
        for (int v = 0; v < 3; ++v)
        {
            const float off = std::sin (t * (0.4f + b * 3) + (float) v * 2.1f) * a * 0.06f;
            c.globalAlpha = v ? 0.55f : 1.0f;
            fxTrace (path ([&] (float u) { return juce::Point<float> (X (u), Y (rd (dry, u * 2 + off), 0.9f) + (float) (v - 1) * a * 6); }, 120), 1.1f);
            c.globalAlpha = 1;
        }
        rdText = juce::String (0.1f + b * 4, 1) + " Hz" + dotSep + pct;
    }
    else if (K == "delay")
    {
        const float tm = 0.12f + b * 0.3f, fb = 0.25f + a * 0.6f;
        for (int r = 0; r < 5; ++r)
        {
            const float amp = std::pow (fb, (float) r);
            c.globalAlpha = amp;
            fxTrace (path ([&] (float u) { return juce::Point<float> (X ((float) r * tm + u * tm * 0.85f), Y (rd (dry, u * 2), amp)); }, 40), 1.1f);
            c.globalAlpha = 1;
        }
        rdText = juce::String (juce::roundToInt (60 + b * 440)) + " ms" + dotSep + juce::String (juce::roundToInt (fb * 100)) + " %";
    }
    else if (K == "phaser")
    {
        ghost();
        const float ph = t * (0.3f + b * 2);
        fxTrace (path ([&] (float u) { return juce::Point<float> (X (u), Y (rd (dry, u * 2) * (1 - a * 0.6f) + rd (dry, u * 2 + 0.12f * std::sin (ph)) * a * 0.6f)); }, 140), 1.4f);
        rdText = juce::String (0.1f + b * 2, 1) + " Hz" + dotSep + pct;
    }
    else if (K == "off")
    {
        fxTrace (path ([&] (float u) { return juce::Point<float> (X (u), Y (rd (dry, u * 2))); }, 120), 1.2f);
        rdText = juce::String::fromUTF8 ("\xe2\x80\x94");
    }
    else
    {
        ghost();
        const Frame wet = ofxShape (dry, K, a, b);
        const auto p = path ([&] (float u) { return juce::Point<float> (X (u), Y (rd (wet, u * 2))); }, K == "crush" ? 400 : 160);
        c2d::Path f (p);
        f.lineTo (w - 8, h / 2 + 4);
        f.lineTo (8, h / 2 + 4);
        f.closePath();
        auto gr = c.createLinearGradient (0, 8, 0, h / 2 + 4);
        gr.stops.push_back ({ 0.0f, fxCol (K, 60, 0.17f) });
        gr.stops.push_back ({ 1.0f, fxCol (K, 60, 0) });
        c.fillStyle = gr;
        c.fill (f);
        fxTrace (p, 1.4f);
        rdText = K == "crush"   ? juce::String (juce::roundToInt (2 + (1 - b) * 6)) + " bit" + dotSep + pct
                 : K == "drive" ? juce::String::fromUTF8 ("\xc3\x97") + juce::String (1 + b * 10, 1) + dotSep + pct
                 : K == "ring"  ? juce::String::fromUTF8 ("\xc3\x97") + juce::String (1 + juce::roundToInt (b * 7)) + dotSep + pct
                                : juce::String (2 + b * 10, 1) + dotSep + pct;
    }
    c.font = "9px mono";
    c.fillStyle = cl.t3;
    c.fillText (juce::String::fromUTF8 ("mix \xe2\x86\x92"), 8, h - 6);
    c.textAlign = "right";
    const juce::String knobName = K == "crush" ? "grit" : K == "delay" ? "time" : K == "drive" ? "drive" : (K == "ring" || K == "comb") ? "tune" : "rate";
    c.fillText (knobName + juce::String::fromUTF8 (" \xe2\x86\x95"), w - 8, 13);
    c.textAlign = "left";
    c.fillStyle = c2d::css ("rgba(0,0,0,.6)");
    c.strokeStyle = fxCol (K, 60, 0.5f);
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect (4, 4, 32, 24, 6);
    c.fill();
    c.stroke();
    // The badge: the effect's glyph.
    c2d::Path glyph;
    glyph.p = juce::Drawable::parseSVGPath (ofx (K).g);
    c.save();
    c.translate (9, 7);
    c.scale (1.25f, 1.25f);
    c.strokeStyle = fxCol (K, 76);
    c.lineWidth = 1.7f / 1.25f * 1.1f;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.shadowBlur = 8;
    c.shadowColor = fxCol (K, 76);
    c.stroke (glyph);
    c.restore();
    return rdText;
}

EnvPts envPts (float w, float h, float A, float D, float S, float R)
{
    const float x0 = 8, W = w - 16, top = 8, bot = h - 8;
    const float ta = std::sqrt (A) * 0.22f * W, td = std::sqrt (D) * 0.26f * W, hold = 0.16f * W, tr = std::sqrt (R) * 0.36f * W, sy = bot - (bot - top) * S;
    return { { x0, bot }, { x0 + ta, top }, { x0 + ta + td, sy }, { x0 + ta + td + hold, sy }, { x0 + ta + td + hold + tr, bot } };
}

void drawEnv (c2d::Context& c, float w, float h, const Cl& cl, float A, float D, float S, float R)
{
    const auto P = envPts (w, h, A, D, S, R);
    c2d::Path p;
    p.moveTo (P.o.x, P.o.y);
    p.quadraticCurveTo (P.o.x + (P.a.x - P.o.x) * 0.35f, P.a.y + (P.o.y - P.a.y) * 0.25f, P.a.x, P.a.y);
    p.quadraticCurveTo (P.a.x + (P.d.x - P.a.x) * 0.15f, P.d.y, P.d.x, P.d.y);
    p.lineTo (P.s.x, P.s.y);
    p.quadraticCurveTo (P.s.x + (P.r.x - P.s.x) * 0.15f, P.r.y, P.r.x, P.r.y);
    under (c, p, P.o.x, P.r.x, h, 0, cl, 0.18f);
    trace (c, p, cl, 1.5f);
    for (auto q : { P.a, P.d, P.r })
    {
        c.fillStyle = cl.t;
        c.beginPath();
        c.arc (q.x, q.y, 3, 0, TAU);
        c.fill();
    }
}

void drawLfo (c2d::Context& c, float w, float h, const Cl& cl, const Model& m, int L)
{
    const auto& pts = m.v ("lfo" + juce::String (L) + ".points");
    const bool drawn = lfoShape (m, L) == "drawn";
    auto py = [&] (float q1) { return 8 + (1 - q1) * (h - 16); };
    c.strokeStyle = c2d::css ("rgba(255,255,255,.05)");
    for (int i = 1; i < 8; ++i)
    {
        c.beginPath();
        c.moveTo (8 + (float) i * (w - 16) / 8, 6);
        c.lineTo (8 + (float) i * (w - 16) / 8, h - 6);
        c.stroke();
    }
    c.beginPath();
    c.moveTo (8, h / 2);
    c.lineTo (w - 8, h / 2);
    c.stroke();
    const auto p = path ([&] (float u) { return juce::Point<float> (8 + u * (w - 16), py (lfoVal (m, L, u))); }, 160);
    under (c, p, 8, w - 8, h, 0, cl, 0.16f);
    trace (c, p, cl, 1.5f);
    if (drawn)
        if (auto* a = pts.getArray())
            for (const auto& q : *a)
            {
                c.fillStyle = cl.t;
                c.beginPath();
                c.arc (8 + (float) (double) q[0] * (w - 16), py ((float) (double) q[1]), 3, 0, TAU);
                c.fill();
            }
}
} // namespace wave
