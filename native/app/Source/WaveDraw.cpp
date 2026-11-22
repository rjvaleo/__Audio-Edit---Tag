#include "WaveDraw.h"
#include "WaveKit.h"

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

Spec spectrumOf (const Frame& a, int K)
{
    Spec s;
    spectrum (a, K, s.re, s.im);
    return s;
}

Frame fromSpec (const std::vector<float>& re, const std::vector<float>& im) { return fromSpectrum (re, im); }
Frame normalised (Frame a) { return norm (a); }
float shapeValue (const juce::String& shape, const juce::var& points, float u, int cyc) { return shapeAt (shape, points, u, cyc); }

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

std::vector<float> magsOf (const Spec& sp)
{
    std::vector<float> out (sp.re.size());
    for (size_t k = 0; k < sp.re.size(); ++k)
        out[k] = std::hypot (sp.re[k], sp.im[k]);
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

void ring (c2d::Context& c, float size, float u, const Cl& cl, bool bip, bool pointer, const ModOf* mod)
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
    // What moves it (uiKnobPaint's .ui-md and .ui-live): its reach either
    // side, just outside the ring, in the source's colour; where it is now.
    if (mod != nullptr && mod->rng > 0)
    {
        const float mr = r + 3.5f;
        c2d::Path md;
        const float u0 = clamp (u - mod->rng), u1 = clamp (u + mod->rng);
        if (u1 - u0 >= 0.0005f)
            md.arc (cc, cc, mr, A0 + SWEEP * u0, A0 + SWEEP * u1);
        c.lineCap = "round";
        c.lineWidth = 2;
        c.strokeStyle = mod->col.isNotEmpty() ? c2d::css (mod->col) : cl.mod;
        c.stroke (md);
        if (mod->live)
        {
            const float a = A0 + SWEEP * clamp (mod->at);
            c.fillStyle = cl.acc;
            c.shadowBlur = 6;
            c.shadowColor = cl.acc;
            c.beginPath();
            c.arc (cc + std::cos (a) * mr, cc + std::sin (a) * mr, 2.4f, 0, TAU);
            c.fill();
            c.shadowBlur = 0;
        }
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

void draw3D (c2d::Context& c, float w, float h, const Cl& cl, const Table& T, float p, const juce::String& wm, float wa, float rise, float depth, bool floor, int most,
             const std::vector<std::pair<float, bool>>* voiceDots)
{
    const int n = juce::jmin ((int) T.size(), most);
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
    // A dot for every voice the engine has sounding, running round the cycle
    // at its own pitch: its phase now, and whether it is in its release.
    if (voiceDots != nullptr)
        for (const auto& [ph, released] : *voiceDots)
        {
            c.globalAlpha = released ? 0.4f : 1.0f;
            dot (c, x0 + ph * sx, y0 - rd (a, ph) * amp, 2.8f, cl.acc);
            c.globalAlpha = 1.0f;
        }
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

void drawStrip (c2d::Context& c, float w, float h, const Cl& cl0, const Table& T, float p, const ModOf* mod)
{
    Cl cl = cl0;
    if (mod != nullptr && mod->col.isNotEmpty())
        cl.mod = c2d::css (mod->col);
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
    if (mod != nullptr && mod->rng > 0)
    {
        const float a = pad + clamp (p - mod->rng) * (w - pad * 2), b = pad + clamp (p + mod->rng) * (w - pad * 2);
        c.strokeStyle = cl.mod;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo (a, 5);
        c.lineTo (a, 2);
        c.lineTo (b, 2);
        c.lineTo (b, 5);
        c.stroke();
    }
    const float x = pad + p * (w - pad * 2);
    c.fillStyle = cl.acc;
    c.shadowBlur = 8;
    c.shadowColor = cl.acc;
    c.fillRect (x - 1, 3, 2, h - 6);
    c.shadowBlur = 0;
}

void drawFace (c2d::Context& c, float w, float h, const Cl& cl, float v, const Frame& wave, const Frame* ghost, bool empty, const ModOf* mod)
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
    ring (c, w, v, cl, false, false, mod);
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

void drawKnob (c2d::Context& c, float w, float h, const Cl& cl, float v, const juce::String& key, bool bip, const ModOf* mod)
{
    ring (c, w, v, cl, bip, true, mod);
    drawControlPic (c, w, h, cl, v, key);
}

void drawUniFace (c2d::Context& c, float w, float h, const Cl& cl, const Frame& cur, int n, float det, float spr, const ModOf* mod)
{
    const float cx = w / 2, cy = h / 2, r = w * 0.3f;
    ring (c, w, det, cl, false, false, mod);
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

void drawHBar (c2d::Context& c, float w, float h, const Cl& cl, float v, const ModOf* mod)
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
    if (mod != nullptr && mod->rng > 0)
    {
        c.fillStyle = mod->col.isNotEmpty() ? c2d::css (mod->col) : cl.mod;
        c.fillRect (6 + (w - 12) * clamp (v - mod->rng), h - 3, (w - 12) * (clamp (v + mod->rng) - clamp (v - mod->rng)), 2);
        if (mod->live)
            dot (c, 6 + (w - 12) * clamp (mod->at), h - 2, 2, cl.acc);
    }
}

void drawRuler (c2d::Context& c, float w, float h, const Cl& cl, int semi, int cents, const ModOf* mod)
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
    if (mod != nullptr && mod->rng > 0)
    {
        c.fillStyle = mod->col.isNotEmpty() ? c2d::css (mod->col) : cl.mod;
        c.globalAlpha = 0.6f;
        c.fillRect (w / 2 - mod->rng * 48 * step, h - 3, mod->rng * 96 * step, 2);
        c.globalAlpha = 1;
    }
    c.fillStyle = cl.acc;
    c.shadowBlur = 8;
    c.shadowColor = cl.acc;
    c.fillRect (w / 2 - 1, 3, 2, h - 6);
    c.shadowBlur = 0;
}

void drawPhase (c2d::Context& c, float w, float h, const Cl& cl, float ph, const Frame& cur, const ModOf* mod)
{
    ring (c, w, ph, cl, false, false, mod);
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
    const auto mc = modOf (m, f + "cut");
    const float cut = clamp (mc.live ? mc.at : m.g (f + "cut")), fc = 20 * std::pow (1000.0f, cut), Q = 0.7f + m.g (f + "res") * 9;
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
    if (mc.rng > 0)
    {
        const float base = m.g (f + "cut");
        const auto band = mc.col.isNotEmpty() ? c2d::css (mc.col) : cl.mod;
        c.fillStyle = band.withMultipliedAlpha (0.14f);
        const float x0 = fx (20 * std::pow (1000.0f, clamp (base - mc.rng))), x1 = fx (20 * std::pow (1000.0f, clamp (base + mc.rng)));
        c.fillRect (x0, 3, x1 - x0, h - 6);
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
    const auto ma = modOf (m, k + "fx.a");
    const float a = clamp (ma.live ? ma.at : m.g (k + "fx.a")), b = m.g (k + "fx.b");
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

juce::String ofxText (const Model& m, int i)
{
    const auto k = "osc" + juce::String (i) + ".";
    juce::String K = m.s (k + "fx.mode");
    if (ofxTable().count (K) == 0)
        K = "off";
    const auto ma = modOf (m, k + "fx.a");
    const float a = clamp (ma.live ? ma.at : m.g (k + "fx.a")), b = m.g (k + "fx.b");
    const auto pct = juce::String (juce::roundToInt (a * 100)) + " %";
    const auto dotSep = juce::String::fromUTF8 (" \xc2\xb7 ");
    if (K == "chorus")
        return juce::String (0.1f + b * 4, 1) + " Hz" + dotSep + pct;
    if (K == "delay")
        return juce::String (juce::roundToInt (60 + b * 440)) + " ms" + dotSep + juce::String (juce::roundToInt ((0.25f + a * 0.6f) * 100)) + " %";
    if (K == "phaser")
        return juce::String (0.1f + b * 2, 1) + " Hz" + dotSep + pct;
    if (K == "off")
        return juce::String::fromUTF8 ("\xe2\x80\x94");
    if (K == "crush")
        return juce::String (juce::roundToInt (2 + (1 - b) * 6)) + " bit" + dotSep + pct;
    if (K == "drive")
        return juce::String::fromUTF8 ("\xc3\x97") + juce::String (1 + b * 10, 1) + dotSep + pct;
    if (K == "ring")
        return juce::String::fromUTF8 ("\xc3\x97") + juce::String (1 + juce::roundToInt (b * 7)) + dotSep + pct;
    return juce::String (2 + b * 10, 1) + dotSep + pct;
}

EnvPts envPts (float w, float h, float A, float D, float S, float R)
{
    const float x0 = 8, W = w - 16, top = 8, bot = h - 8;
    const float ta = std::sqrt (A) * 0.22f * W, td = std::sqrt (D) * 0.26f * W, hold = 0.16f * W, tr = std::sqrt (R) * 0.36f * W, sy = bot - (bot - top) * S;
    return { { x0, bot }, { x0 + ta, top }, { x0 + ta + td, sy }, { x0 + ta + td + hold, sy }, { x0 + ta + td + hold + tr, bot } };
}

void drawEnv (c2d::Context& c, float w, float h, const Cl& cl, float A, float D, float S, float R, const std::vector<std::pair<char, float>>* voices)
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
    // Where each voice is on it, from the engine's stage and level (wvEnvDot).
    if (voices != nullptr)
        for (const auto& [st, env] : *voices)
        {
            const float lvl = clamp (env);
            auto lerp = [] (juce::Point<float> a, juce::Point<float> b, float u) { return a + (b - a) * u; };
            juce::Point<float> d;
            if (st == 'a')
                d = lerp (P.o, P.a, lvl);
            else if (st == 'd')
                d = lerp (P.a, P.d, S < 1 ? clamp ((1 - lvl) / (1 - S)) : 1);
            else if (st == 'r')
                d = lerp (P.s, P.r, S > 0 ? clamp (1 - lvl / S) : 1);
            else
                d = { (P.d.x + P.s.x) / 2, P.s.y };
            dot (c, d.x, d.y, 3, cl.acc);
        }
}

void drawLfo (c2d::Context& c, float w, float h, const Cl& cl, const Model& m, int L)
{
    const float ph = lfoPhase (m, L);
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
    if (ph >= 0)
    {
        c.strokeStyle = cl.acc.withMultipliedAlpha (0.5f);
        c.beginPath();
        c.moveTo (8 + ph * (w - 16), 6);
        c.lineTo (8 + ph * (w - 16), h - 6);
        c.stroke();
        dot (c, 8 + ph * (w - 16), py (lfoVal (m, L, ph)), 3.4f, cl.acc);
    }
}
juce::String dbTxt (float v)
{
    if (v < 0.01f)
        return juce::String::fromUTF8 ("\xe2\x88\x92\xe2\x88\x9e");
    const float d = 20 * std::log10 (v * v + 1e-9f);
    return (d < 0 ? juce::String::fromUTF8 ("\xe2\x88\x92") : juce::String ("+")) + juce::String (std::abs (d), 1);
}

void drawMix (c2d::Context& x, float W0, float h, const Cl& cl, const Model& m, int c, const Frame* cur, float t)
{
    static const char* on[] = { "osc0.on", "osc1.on", "osc2.on", "sub.on", "noise.on" };
    static const char* lv[] = { "osc0.level", "osc1.level", "osc2.level", "sub.level", "noise.level" };
    const float w = W0 - 40;
    const float v = clamp (m.g (lv[c])), X = 6 + (w - 12) * v, a = 0.4f + 0.6f * v;
    x.globalAlpha = m.g (on[c]) >= 0.5f ? 1.0f : 0.35f;
    x.save();
    x.beginPath();
    x.rect (6, 2, X - 6, h - 4);
    x.clip();
    c2d::Path p;
    juce::Colour col = juce::Colours::transparentBlack;
    auto line = [&] (int n, const std::function<float (float)>& y) {
        for (int i = 0; i <= n; ++i)
        {
            const float u = (float) i / (float) n, yy = y (u);
            if (i)
                p.lineTo (6 + u * (w - 12), yy);
            else
                p.moveTo (6 + u * (w - 12), yy);
        }
    };
    if (c < 3 && cur != nullptr)
        line (140, [&] (float u) { return h / 2 - rd (*cur, u * 4) * (h * 0.36f) * a; });
    else if (c == 3)
    {
        const int shape = (int) m.g ("sub.shape");
        auto sh = [shape] (float q) {
            if (shape == 1)
                return 1 - 4 * std::abs (std::fmod (std::fmod (q + 0.25f, 1.0f) + 1.0f, 1.0f) - 0.5f);
            if (shape == 2)
                return (std::fmod (q, 1.0f) < 0.5f ? 1.0f : -1.0f) * 0.8f;
            return std::sin (q * TAU);
        };
        const float oct = m.g ("sub.oct", 1);
        const float cyc = 4 / std::pow (2.0f, oct > 0 ? oct : 1.0f);
        line (140, [&] (float u) { return h / 2 - sh (u * cyc) * (h * 0.36f) * a; });
    }
    else
    {
        // Noise in its own colour, reseeded fourteen times a second.
        long long sd = 7 + ((long long) std::floor (t * 14)) % 997;
        float pr = 0;
        const int nc = (int) m.g ("noise.color", 1);
        static const char* cols[] = { "#e9edf2", "#f2a3c0", "#c08f60" };
        col = c2d::css (cols[juce::jlimit (0, 2, nc)]);
        line (170, [&] (float) {
            sd = (sd * 16807) % 2147483647;
            const float r = (float) sd / 2147483647.0f * 2 - 1;
            pr = nc == 0 ? r : nc == 1 ? pr * 0.6f + r * 0.6f : pr * 0.9f + r * 0.35f;
            return h / 2 - clamp (pr, -1, 1) * (h * 0.4f) * a;
        });
    }
    if (col.getAlpha() > 0)
    {
        x.strokeStyle = col;
        x.lineWidth = 1.1f;
        x.shadowBlur = 6;
        x.shadowColor = col;
        x.stroke (p);
        x.shadowBlur = 0;
    }
    else
        trace (x, p, cl, 1.1f, 0.6f);
    x.restore();
    x.strokeStyle = cl.track;
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo (X, h / 2);
    x.lineTo (w - 6, h / 2);
    x.stroke();
    {
        static const char* levels[] = { "osc0.level", "osc1.level", "osc2.level", "sub.level", "noise.level" };
        const auto mm = modOf (m, levels[juce::jlimit (0, 4, c)]);
        if (mm.rng > 0)
        {
            const float a0 = clamp (v - mm.rng), a1 = clamp (v + mm.rng);
            x.fillStyle = mm.col.isNotEmpty() ? c2d::css (mm.col) : cl.mod;
            x.fillRect (6 + (w - 12) * a0, h - 3, (w - 12) * (a1 - a0), 2);
            if (mm.live)
                dot (x, 6 + (w - 12) * clamp (mm.at), h - 2, 2, mm.col.isNotEmpty() ? c2d::css (mm.col) : cl.acc);
        }
    }
    x.fillStyle = cl.t;
    x.beginPath();
    x.roundRect (X - 2, 2, 4, h - 4, 2);
    x.fill();
    x.font = "9px mono";
    x.textAlign = "right";
    x.fillStyle = cl.t2;
    x.fillText (dbTxt (v), W0 - 6, h / 2 + 3.5f);
    x.textAlign = "left";
    x.globalAlpha = 1;
}

namespace
{
constexpr int KB_N = 49;
constexpr float KB_WW = 28, KB_BW = 18, KB_BH = 60, KB_H = 100;
bool black (int n)
{
    const int pc = ((n % 12) + 12) % 12;
    return pc == 1 || pc == 3 || pc == 6 || pc == 8 || pc == 10;
}
} // namespace

std::map<int, KeyRect> keyLayout (int lo)
{
    std::map<int, KeyRect> pos;
    int i = 0;
    for (int n = lo; n < lo + KB_N; ++n)
        if (!black (n))
            pos[n] = { (float) i++ * KB_WW, KB_WW, false };
    for (int n = lo; n < lo + KB_N; ++n)
        if (black (n))
            pos[n] = { pos[n - 1].x + KB_WW - KB_BW / 2, KB_BW, true };
    return pos;
}

int keyAt (int lo, float x, float y)
{
    const auto L = keyLayout (lo);
    for (const auto& [n, k] : L)
        if (k.black && x >= k.x && x < k.x + k.w && y < KB_BH)
            return n;
    for (const auto& [n, k] : L)
        if (!k.black && x >= k.x && x < k.x + k.w)
            return n;
    return -1;
}

void drawKeys (c2d::Context& c, const Cl& cl, int lo, const std::function<bool (int)>& lit, float hue)
{
    const auto L = keyLayout (lo);
    const float h = KB_H;
    for (const auto& [n, k] : L)
    {
        if (k.black)
            continue;
        const bool on = lit (n);
        auto gr = c.createLinearGradient (0, 0, 0, h);
        gr.addColorStop (0, on ? "hsl(" + juce::String (hue) + ",35%,30%)" : "#2b2e34");
        gr.addColorStop (1, on ? "hsl(" + juce::String (hue) + ",45%,22%)" : "#1d1f23");
        c.fillStyle = gr;
        c.beginPath();
        c.roundRect (k.x + 1, 0, k.w - 2, h - 1, std::array<float, 4> { 0, 0, 4, 4 });
        c.fill();
        c.setFill ("rgba(255,255,255,.07)");
        c.fillRect (k.x + 1, 0, k.w - 2, 1);
        c.setFill ("rgba(0,0,0,.45)");
        c.fillRect (k.x + k.w - 2, 0, 1, h - 1);
        if (on)
        {
            c.setFill ("hsl(" + juce::String (hue) + ",70%,62%)");
            c.shadowBlur = 10;
            c.shadowColor = c2d::css ("hsl(" + juce::String (hue) + ",70%,62%)");
            c.fillRect (k.x + 3, h - 9, k.w - 6, 4);
            c.shadowBlur = 0;
        }
        if (((n % 12) + 12) % 12 == 0)
        {
            c.fillStyle = cl.t3;
            c.font = "9px sans";
            c.fillText ("C" + juce::String ((int) std::floor ((float) n / 12) - 1), k.x + 4, h - 12);
        }
    }
    for (const auto& [n, k] : L)
    {
        if (!k.black)
            continue;
        const bool on = lit (n);
        auto gr = c.createLinearGradient (0, 0, 0, KB_BH);
        gr.addColorStop (0, on ? "#2c3038" : "#131417");
        gr.addColorStop (1, on ? "#1d2026" : "#060708");
        c.fillStyle = gr;
        c.shadowBlur = 4;
        c.setShadow ("rgba(0,0,0,.7)");
        c.beginPath();
        c.roundRect (k.x, 0, k.w, KB_BH, std::array<float, 4> { 0, 0, 3, 3 });
        c.fill();
        c.shadowBlur = 0;
        if (on)
        {
            c.setFill ("hsl(" + juce::String (hue) + ",70%,62%)");
            c.fillRect (k.x + 2, KB_BH - 7, k.w - 4, 3);
        }
    }
}

void drawWheel (c2d::Context& c, float w, float h, const Cl& cl, float v, bool bip)
{
    const float rest = bip ? h / 2 : h - 6, y = bip ? h / 2 - v * (h / 2 - 8) : h - 6 - v * (h - 12);
    for (float yy = 6; yy < h - 4; yy += 4)
    {
        c.setFill ("rgba(255,255,255,.05)");
        c.fillRect (6, yy, w - 12, 1);
    }
    auto gr = c.createLinearGradient (0, rest, 0, y);
    gr.stops.push_back ({ 0.0f, cl.acc.withMultipliedAlpha (0.10f) });
    gr.stops.push_back ({ 1.0f, cl.acc.withMultipliedAlpha (0.55f) });
    c.fillStyle = gr;
    c.fillRect (5, juce::jmin (rest, y), w - 10, std::abs (rest - y));
    c.fillStyle = cl.t;
    c.shadowBlur = 8;
    c.shadowColor = cl.acc;
    c.beginPath();
    c.roundRect (4, y - 2, w - 8, 4, 2);
    c.fill();
    c.shadowBlur = 0;
    c.fillStyle = cl.t3;
    c.font = "9px mono";
    c.textAlign = "center";
    c.fillText (bip ? "PB" : "MOD", w / 2, 10);
    c.textAlign = "left";
}

void drawPuck (c2d::Context& c, float w, float h, const Cl& cl, Model& m, const std::vector<std::array<float, 3>>* trail, float nowMs)
{
    const auto& T = m.table (m.s ("osc0.table"));
    for (int gx = 0; gx < 4; ++gx)
        for (int gy = 0; gy < 4; ++gy)
        {
            const auto f = frameAt (T, (float) gx / 3);
            const float cw = (w - 12) / 4, ch = (h - 12) / 4, x0 = 6 + (float) gx * cw, y0 = 6 + (float) (3 - gy) * ch;
            c.strokeStyle = cl.bloom (0.08f + 0.14f * (float) gy / 3);
            c.lineWidth = 1;
            c.stroke (path ([&] (float u) { return juce::Point<float> (x0 + 3 + u * (cw - 6), y0 + ch / 2 - rd (f, u) * ch * 0.3f * (0.5f + (float) gy / 6)); }, 20));
        }
    // Where the puck has been in the last second and a half, fading.
    if (trail != nullptr)
        for (const auto& q : *trail)
        {
            const float a = 1 - (nowMs - q[2]) / 1500;
            if (a <= 0)
                continue;
            c.fillStyle = cl.acc.withMultipliedAlpha (std::round (a * 60) / 100);
            c.beginPath();
            c.arc (6 + q[0] * (w - 12), 6 + (1 - q[1]) * (h - 12), 2 * a + 0.5f, 0, TAU);
            c.fill();
        }
    dot (c, 6 + clamp (m.g ("osc0.pos")) * (w - 12), 6 + (1 - clamp ((m.g ("filt0.cut") - 0.2f) / 0.7f)) * (h - 12), 4.5f, cl.acc);
}

// What you hear (wvDrawOut): the engine's output wave when it sends one,
// otherwise the sounding oscillators' cycles summed and scaled by its peak.
// Flat when nothing sounds.
void drawOut (c2d::Context& c, float w, float h, const Cl& cl, Model& m, float t)
{
    const auto& T = m.tele;
    auto* wave = T["wave"].getArray();
    const bool hasWave = wave != nullptr && wave->size() > 1;
    float peak = 0;
    if (auto* p = T["peak"].getArray())
        for (const auto& x : *p)
            peak = juce::jmax (peak, (float) (double) x);
    if (!hasWave && (voices (m).empty() || peak <= 0))
    {
        c.strokeStyle = cl.bloom (0.15f);
        c.beginPath();
        c.moveTo (6, h / 2);
        c.lineTo (w - 6, h / 2);
        c.stroke();
        return;
    }
    if (hasWave)
    {
        const int n = wave->size();
        trace (c, path ([&] (float u) { return juce::Point<float> (6 + u * (w - 12), h / 2 - clamp ((float) (double) wave->getReference (juce::jmin (n - 1, juce::roundToInt (u * (float) (n - 1)))), -1, 1) * h * 0.42f); }, juce::jmin (300, n)), cl, 1.2f, 0.6f);
        return;
    }
    struct W
    {
        Frame f;
        float l, r;
    };
    std::vector<W> ws;
    for (int i = 0; i < 3; ++i)
        if (m.g ("osc" + juce::String (i) + ".on") >= 0.5f)
            ws.push_back ({ waveFor (m, i, false), std::pow (m.g ("osc" + juce::String (i) + ".level"), 2.0f), std::pow (2.0f, (float) juce::roundToInt ((m.g ("osc" + juce::String (i) + ".pitch", 0.5f) - 0.5f) * 48) / 12) });
    if (ws.empty())
        return;
    const float ph = t * 3;
    float norm = 0;
    for (auto& x : ws)
        norm += x.l;
    if (norm <= 0)
        norm = 1;
    trace (c, path ([&] (float u) {
               float y = 0;
               for (auto& x : ws)
                   y += rd (x.f, (u * 4 + ph) * x.r) * x.l;
               return juce::Point<float> (6 + u * (w - 12), h / 2 - y / norm * clamp (peak) * h * 0.42f);
           }, 300),
           cl, 1.2f, 0.6f);
}

void drawMaster (c2d::Context& c, float w, float h, const Cl& cl, float master, float lvl)
{
    for (int i = 0; i < 24; ++i)
    {
        const bool on = (float) i / 24 < lvl;
        c.fillStyle = on ? (i > 20 ? cl.acc : cl.bloom (0.8f)) : c2d::css ("rgba(255,255,255,.06)");
        c.fillRect (4 + (float) i * 4.7f, 6, 3, 10);
    }
    const float x = 4 + clamp (master) * (w - 8);
    c.fillStyle = cl.t;
    c.beginPath();
    c.roundRect (x - 1.5f, 2, 3, h - 4, 1.5f);
    c.fill();
}

void drawMacro (c2d::Context& c, float w, float h, const Cl& cl, Model& m, int i)
{
    const float v = m.g ("macro" + juce::String (i)), cx = w / 2, cy = h / 2, r = w * 0.26f;
    const auto mo = modOf (m, "macro" + juce::String (i));
    ring (c, w, v, cl, false, false, &mo);
    c.save();
    c.strokeStyle = cl.wave;
    c.fillStyle = cl.bloom (0.8f);
    c.lineWidth = 1.3f;
    c.lineCap = "round";
    c.lineJoin = "round";
    const float L = cx - r;
    switch (i)
    {
        case 0:
            for (int q = 0; q < 6; ++q)
            {
                const float hh = r * 1.4f * (0.25f + 0.75f * std::pow (1 - (float) q / 6, 2 - 1.8f * v));
                c.fillRect (L + (float) q * r / 3 + 1, cy + r * 0.7f - hh, r / 5, hh);
            }
            break;
        case 1:
            c.stroke (path ([&] (float u) { return juce::Point<float> (L + u * 2 * r, cy - std::sin (u * TAU * 2) * r * 0.7f * v); }, 40));
            break;
        case 2:
        {
            const float d = r * 0.2f + r * 0.75f * v;
            c.beginPath();
            c.moveTo (cx - d, cy - 4);
            c.lineTo (cx - d - 4, cy);
            c.lineTo (cx - d, cy + 4);
            c.moveTo (cx + d, cy - 4);
            c.lineTo (cx + d + 4, cy);
            c.lineTo (cx + d, cy + 4);
            c.moveTo (cx - d, cy);
            c.lineTo (cx + d, cy);
            c.stroke();
            break;
        }
        case 3:
            c.stroke (path ([&] (float u) {
                float y = std::sin (u * TAU) * (1 + v * 4);
                int g = 0;
                while (std::abs (y) > 1 && g++ < 9)
                    y = y > 1 ? 2 - y : -2 - y;
                return juce::Point<float> (L + u * 2 * r, cy - y * r * 0.7f);
            }, 60));
            break;
        case 4:
            for (int q = 0; q < 5; ++q)
            {
                const float a = std::pow (0.35f + 0.55f * v, (float) q);
                c.globalAlpha = a;
                c.fillRect (L + (float) q * r * 0.42f, cy + r * 0.7f - r * 1.4f * a, 2, r * 1.4f * a);
            }
            break;
        case 5:
        {
            const auto f = frameAt (m.table (m.s ("osc0.table")), v);
            c.stroke (path ([&] (float u) { return juce::Point<float> (L + u * 2 * r, cy - rd (f, u) * r * 0.7f); }, 50));
            break;
        }
        case 6:
            c.stroke (path ([&] (float u) { return juce::Point<float> (L + u * 2 * r, cy + r * 0.7f - juce::jmin (1.0f, u / (0.05f + v * 0.9f)) * r * 1.4f); }, 40));
            break;
        default:
            c.stroke (path ([&] (float u) { return juce::Point<float> (L + u * 2 * r, cy + r * 0.2f - (1 / (1 + std::exp (-(u - 0.6f) * 12))) * r * 0.9f * v); }, 40));
    }
    c.restore();
    // A notch on the rim for every route it drives.
    const auto me = "macro" + juce::String (i);
    int n = 0;
    for (const auto& row : m.mods)
        n += row.src == me || row.via == me ? 1 : 0;
    for (int q = 0; q < n; ++q)
    {
        const float a = PI * 0.75f + PI * 1.5f * ((float) q + 0.5f) / (float) n;
        c.fillStyle = cl.mod;
        c.beginPath();
        c.arc (cx + std::cos (a) * (w / 2 - 0.5f), cy + std::sin (a) * (w / 2 - 0.5f), 1.3f, 0, TAU);
        c.fill();
    }
}

void drawTilePic (c2d::Context& c, float w, float h, const Cl& cl, const Model& m, const juce::String& src)
{
    const auto col = c2d::css (sourceColour (src));
    const auto C = sourceCl (cl, src);
    auto line = [&] (const c2d::Path& p, float lw = 1.3f) {
        c.lineJoin = "round";
        c.lineCap = "round";
        c.strokeStyle = col;
        c.lineWidth = lw;
        c.shadowBlur = 6;
        c.shadowColor = col;
        c.stroke (p);
        c.shadowBlur = 0;
    };
    auto fill = [&] (const c2d::Path& p, float x0, float x1) {
        c2d::Path f (p);
        f.lineTo (x1, h - 1);
        f.lineTo (x0, h - 1);
        f.closePath();
        c.fillStyle = C.bloom (0.14f);
        c.fill (f);
    };
    const auto* S = sourceOf (src);
    const auto kind = S != nullptr ? S->kind : juce::String();
    if (kind == "lfo")
    {
        const int L = src.getTrailingIntValue();
        const auto p = path ([&] (float u) { return juce::Point<float> (1 + u * (w - 2), h - 2 - lfoVal (m, L, u) * (h - 4)); }, 48);
        fill (p, 1, w - 1);
        line (p);
        const float ph = lfoPhase (m, L);
        if (ph >= 0)
            dot (c, 1 + ph * (w - 2), h - 2 - lfoVal (m, L, ph) * (h - 4), 1.9f, juce::Colours::white);
    }
    else if (kind == "env")
    {
        const auto P = envPts (w + 12, h + 12, m.g (src + ".a"), m.g (src + ".d"), m.g (src + ".s"), m.g (src + ".r"));
        c2d::Path p;
        auto sh = [] (juce::Point<float> q) { return q - juce::Point<float> (6, 6); };
        p.moveTo (sh (P.o).x, sh (P.o).y);
        for (auto q : { P.a, P.d, P.s, P.r })
            p.lineTo (sh (q).x, sh (q).y);
        fill (p, 2, P.r.x - 6);
        line (p);
    }
    else if (kind == "macro")
    {
        const float v = m.g (src), cx = w / 2, cy = h / 2 + 1, r = h / 2 - 2, a0 = PI * 0.75f;
        c.lineCap = "round";
        c.setStroke ("rgba(255,255,255,.1)");
        c.lineWidth = 2;
        c.beginPath();
        c.arc (cx, cy, r, a0, a0 + PI * 1.5f);
        c.stroke();
        c.strokeStyle = col;
        c.shadowBlur = 6;
        c.shadowColor = col;
        c.beginPath();
        c.arc (cx, cy, r, a0, a0 + PI * 1.5f * v + 1e-4f);
        c.stroke();
        c.shadowBlur = 0;
    }
    else if (src == "note")
    {
        for (int k = 0; k <= 24; ++k)
        {
            const float x = 1 + (float) k / 24 * (w - 2);
            const bool blk = black (k);
            c.setFill (blk ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.18)");
            c.fillRect (x, h - (blk ? 4.0f : 6.0f), 1, blk ? 4.0f : 6.0f);
        }
        c.strokeStyle = C.bloom (0.35f);
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo (1, h - 7);
        c.lineTo (w - 1, 1);
        c.stroke();
        const float v = srcVal (m, src);
        dot (c, 1 + v * (w - 2), h - 7 - v * (h - 8), 2, col);
    }
    else
    {
        // The playing hand: its last four seconds, newest at the right.
        auto y = [&] (float v) { return h - 2 - clamp (v) * (h - 4); };
        auto it = m.hist.find (src);
        const auto p = path ([&] (float u) {
            const float v = it == m.hist.end() ? 0.0f : it->second[(size_t) ((m.histAt + juce::roundToInt (u * 199)) % 200)];
            return juce::Point<float> (1 + u * (w - 2), y (v));
        }, 60);
        fill (p, 1, w - 1);
        line (p);
        dot (c, w - 2, y (srcVal (m, src)), 1.9f, juce::Colours::white);
    }
}
} // namespace wave
