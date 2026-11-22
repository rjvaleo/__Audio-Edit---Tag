// The pictures every node on the FX board draws of what it does to the sound
// coming in (ui/app/397-wave-board-inspector.js `wvDrawNodePic`, `wvDrawFxPic`,
// `wvDrawRoutingPic`, `wvDrawIOPic`, `wvInputWave`), line for line.

#include "WaveBoardPics.h"

namespace board
{
namespace
{
constexpr float TAU = juce::MathConstants<float>::twoPi;
constexpr float PI = juce::MathConstants<float>::pi;
using wave::Frame;
float clampf (float v, float a = 0, float b = 1) { return juce::jlimit (a, b, v); }
float rnd (float n)
{
    const double x = std::sin ((double) n * 127.1 + 311.7) * 43758.5453;
    return (float) (x - std::floor (x));
}
float rgx (const juce::String& s) { juce::ignoreUnused (s); return 0; }

Frame sine()
{
    Frame f {};
    for (int n = 0; n < wave::NP; ++n)
        f[(size_t) n] = std::sin (TAU * (float) n / wave::NP);
    return f;
}

wave::Cl tinted (const wave::Cl& cl, const juce::String& rgb, juce::Colour wave)
{
    wave::Cl C = cl;
    C.wave = wave;
    auto p = juce::StringArray::fromTokens (rgb, ",", "");
    if (p.size() == 3)
        C.br = p[0].getFloatValue(), C.bg = p[1].getFloatValue(), C.bb = p[2].getFloatValue();
    return C;
}

bool matchKey (const juce::String& key, const juce::String& re)
{
    // The page's regexes are short and plain: alternatives, ^ and $, /i.
    for (auto alt : juce::StringArray::fromTokens (re, "|", ""))
    {
        const bool start = alt.startsWith ("^"), end = alt.endsWith ("$");
        auto core = alt.trimCharactersAtStart ("^").trimCharactersAtEnd ("$");
        const auto k = key.toLowerCase();
        core = core.toLowerCase();
        if (start && end ? k == core : start ? k.startsWith (core) : end ? k.endsWith (core) : k.contains (core))
            return true;
    }
    return false;
}
} // namespace

Frame inputWave (Pics& P, const juce::String& kind)
{
    if (auto it = P.waves.find (kind); it != P.waves.end())
        return it->second;
    auto& m = *P.model;
    Frame f {};
    const int osc = kind == "in:osc0" ? 0 : kind == "in:osc1" ? 1 : kind == "in:osc2" ? 2 : -1;
    if (osc >= 0)
        f = wave::waveFor (m, osc, false);
    else if (kind == "in:sub")
    {
        const int sh = (int) m.g ("sub.shape");
        for (int n = 0; n < wave::NP; ++n)
        {
            const float x = (float) n / wave::NP;
            f[(size_t) n] = sh == 1 ? (x < 0.25f ? 4 * x : x < 0.75f ? 2 - 4 * x : 4 * x - 4) : sh == 2 ? (x < 0.5f ? 0.8f : -0.8f) : std::sin (TAU * x);
        }
    }
    else if (kind == "in:noise")
    {
        if (P.noiseAt < 0 || P.t - P.noiseAt > 0.12f)
        {
            for (auto& v : P.noise)
                v = juce::Random::getSystemRandom().nextFloat() * 2 - 1;
            P.noiseAt = P.t;
        }
        f = P.noise;
    }
    else
    {
        // The voice: A and B, through Filter 1 as a running average.
        const auto a = wave::waveFor (m, 0, false), b = wave::waveFor (m, 1, false);
        const int k = juce::roundToInt (2 + (1 - clampf (m.g ("filt0.cut"))) * 16);
        for (int n = 0; n < wave::NP; ++n)
        {
            float v = 0;
            for (int j = 0; j < k; ++j)
            {
                const int q = (n - j + wave::NP) % wave::NP;
                v += a[(size_t) q] * 0.6f + b[(size_t) q] * 0.4f;
            }
            f[(size_t) n] = v / (float) k;
        }
        f = wave::normalised (f);
    }
    P.waves[kind] = f;
    return f;
}

static std::vector<float> waveSpec (Pics& P, const Frame& wv)
{
    // Keyed by the wave's first samples: the same wave drawn twice in a frame is worked out once.
    const auto key = juce::String (wv[3], 6) + juce::String (wv[97], 6) + juce::String (wv[201], 6);
    if (auto it = P.specs.find (key); it != P.specs.end())
        return it->second;
    return P.specs[key] = wave::magsOf (wave::spectrumOf (wv, 32));
}

juce::String fxFamily (const juce::var& n)
{
    if (n["kind"].toString() == "wave:drive")
        return "drive";
    auto& k = Kit::get();
    auto it = k.byKind.find (n["kind"].toString());
    const auto l = it != k.byKind.end() ? it->second["label"].toString() : n["kind"].toString();
    const auto c = cat (n);
    auto has = [&] (std::initializer_list<const char*> ws) { for (auto* w : ws) if (l.contains (w)) return true; return false; };
    if (has ({ "Low Pass", "Damping", "Chamberlin" })) return "lp";
    if (has ({ "High Pass" }) || (l.startsWith ("DC") && l.length() == 2)) return "hp";
    if (has ({ "Regalia" })) return "bell";
    if (has ({ "Band Pass", "resonator", "Rappify" })) return "bp";
    if (has ({ "Band Reject", "notch" })) return "notch";
    if (has ({ "Comb Filter" })) return "comb";
    if (l == "EQ") return "eq";
    if (has ({ "filter bank" })) return "bank";
    if (has ({ "Gate" })) return "gate";
    if (c == "dynamics") return "comp";
    if (l == "Hyperprism Doppler") return "room";
    if (l == "Swap") return "swap";
    if (c == "stereo") return "field";
    if (c == "delay") return "taps";
    if (l == "Convolution") return "conv";
    if (c == "reverb") return "tail";
    if (has ({ "Chorus", "chorus" })) return "chorus";
    if (has ({ "Flanger", "flanger", "Phaser", "phasor" })) return "phaser";
    if (has ({ "Tremolo" })) return "trem";
    if (has ({ "Ring" })) return "ring";
    if (c == "modulation") return "vib";
    if (c == "pitch") return "pitch";
    if (has ({ "chebyshev" })) return "cheby";
    if (c == "distortion") return "crush";
    if (c == "spectral") return "spec";
    if (c == "granular") return "grains";
    if (has ({ "PN noise" })) return "noise";
    if (l == "Invert") return "invert";
    return "gain";
}

void drawFxPic (c2d::Context& c, float w, float h, Pics& P, const juce::var& n)
{
    juce::ignoreUnused (rgx);
    auto& m = *P.model;
    const auto& cl = *P.cl;
    const auto ct = cat (n);
    const auto C = tinted (cl, catRGB (ct), c2d::css ("rgb(" + catRGB (ct, 82) + ")"));
    const float t = P.t;
    const auto o = inOrigins (*P.board, m, n, P.memo);
    const Frame wv = o.empty() ? sine() : inputWave (P, *o.begin());
    const auto sp = spec (n);
    const bool big = w > 200;
    auto bg = c.createRadialGradient (w * 0.3f, 0, 4, w * 0.5f, h * 0.6f, w * 0.8f);
    bg.stops.push_back ({ 0.0f, catCol (ct, 40, 0.22f) });
    bg.stops.push_back ({ 1.0f, catCol (ct, 30, 0) });
    c.fillStyle = bg;
    c.fillRect (0, 0, w, h);
    struct F_
    {
        float v = 0, u = 0;
        juce::var p;
        bool ok = false;
    };
    auto F = [&] (std::initializer_list<const char*> res) {
        F_ r;
        for (auto* re : res)
            for (auto& p : sp)
            {
                const auto key = p["key"].toString();
                const juce::String rs (re);
                const bool exact = !rs.containsAnyOf ("|^$") && !rs.startsWith ("~");
                const bool hit = exact ? key == rs : matchKey (key, rs.trimCharactersAtStart ("~"));
                if (hit)
                {
                    r.v = pval (n, p);
                    r.u = pn (p, r.v);
                    r.p = p;
                    r.ok = true;
                    return r;
                }
            }
        return r;
    };
    auto X = [&] (float u) { return 4 + u * (w - 8); };
    const float mid = h / 2, A = h * 0.36f;
    auto inn = [&] (float u) { return wave::rd (wv, u * 2); };
    auto T = [&] (const c2d::Path& p, float lw = 1.3f, float gl = 0.7f) { wave::trace (c, p, C, lw, gl); };
    auto Uf = [&] (const c2d::Path& p, float base, float top = 4, float a = 0.16f) { wave::under (c, p, X (0), X (1), base, top, C, a); };
    auto ghost = [&] (const std::function<float (float)>& fn) {
        c.strokeStyle = C.bloom (0.24f);
        c.lineWidth = 1;
        c.stroke (wave::path ([&] (float u) { return juce::Point<float> (X (u), mid - fn (u) * A); }, big ? 200 : 110));
    };
    auto wavef = [&] (const std::function<float (float)>& fn, float lw = 1.3f) {
        const auto p = wave::path ([&] (float u) { return juce::Point<float> (X (u), mid - fn (u) * A); }, big ? 240 : 130);
        Uf (p, mid, 4, 0.1f);
        T (p, lw);
    };
    const bool live = !wave::voices (m).empty() || P.peak (n["id"].toString()) > 0.001f;
    auto fu = [] (float hz) { return clampf (std::log (juce::jmax (20.0f, hz) / 20) / std::log (1000.0f)); };
    auto resp = [&] (const std::function<float (float)>& fn, float lo = -36, float hi = 18) {
        auto dbY = [&] (float d) { return clampf (4 + (hi - d) / (hi - lo) * (h - 8), 2, h - 2); };
        const auto mg = waveSpec (P, wv);
        for (int k = 0; k < 32; ++k)
        {
            const float u = fu (110.0f * (float) (k + 1));
            if (u >= 1)
                break;
            const float a = mg[(size_t) k];
            if (a < 0.004f)
                continue;
            const float hh = clampf ((20 * std::log10 (a) + fn (u) + 48) / 48) * (h - 8) * 0.8f;
            c.fillStyle = C.bloom (0.42f);
            c.fillRect (X (u) - 1, h - 4 - hh, big ? 2.0f : 1.5f, hh);
        }
        c.setStroke ("rgba(255,255,255,.07)");
        c.beginPath();
        c.moveTo (X (0), dbY (0));
        c.lineTo (X (1), dbY (0));
        c.stroke();
        const auto p = wave::path ([&] (float u) { return juce::Point<float> (X (u), dbY (fn (u))); }, big ? 160 : 90);
        Uf (p, h, 4, 0.14f);
        T (p, 1.4f);
    };
    const auto fam = fxFamily (n);
    auto label = [&] {
        auto& k = Kit::get();
        auto it = k.byKind.find (n["kind"].toString());
        return it != k.byKind.end() ? it->second["label"].toString() : juce::String();
    };
    if (fam == "lp" || fam == "hp" || fam == "bp" || fam == "notch" || fam == "bell")
    {
        const auto fr = F ({ "~freq|hz$|cutoff|frequency" }), q = F ({ "~^q$|lowq|resonance" }), bw = F ({ "~bandwidth" }), gn = F ({ "~gaindb" });
        const float f0 = fu (fr.ok ? fr.v : 1000);
        const float Q = q.ok ? 0.6f + q.u * 9 : bw.ok ? 0.6f + (1 - bw.u) * 8 : 1.4f;
        resp ([&] (float u) {
            const float r = std::pow (1000.0f, u - f0), peak = q.ok ? q.u * 14 * std::exp (-std::pow ((u - f0) / 0.035f, 2.0f)) : 0.0f;
            if (fam == "lp") return -10 * std::log10 (1 + std::pow (r, 4.0f)) + peak;
            if (fam == "hp") return -10 * std::log10 (1 + std::pow (r, -4.0f)) + peak;
            if (fam == "bell") return (gn.ok ? gn.v : 9) * std::exp (-std::pow ((u - f0) * Q * 3, 2.0f));
            const float b = -10 * std::log10 (1 + std::pow ((r - 1 / r) * Q, 2.0f));
            return fam == "bp" ? b : juce::jmax (-36.0f, -10 * std::log10 (1 + 1 / (std::pow ((r - 1 / r) * Q, 2.0f) + 1e-4f)));
        });
    }
    else if (fam == "eq")
    {
        std::vector<std::array<F_, 3>> B6;
        for (int i = 1; i <= 6; ++i)
        {
            const auto si = juce::String (i);
            const auto fk = "band." + si + ".freq", gk = "band." + si + ".gainDb", qk = "band." + si + ".q";
            B6.push_back ({ F ({ fk.toRawUTF8() }), F ({ gk.toRawUTF8() }), F ({ qk.toRawUTF8() }) });
        }
        const auto hp = F ({ "band.0.freq" }), hpOn = F ({ "band.0.enabled" });
        resp ([&] (float u) {
            float d = 0;
            for (size_t i = 0; i < B6.size(); ++i)
            {
                const auto& [f, g, q] = B6[i];
                if (!f.ok || !g.ok)
                    continue;
                const float x = u - fu (f.v);
                d += i == 0 ? g.v / (1 + std::exp (x * 30)) : i == 5 ? g.v / (1 + std::exp (-x * 30)) : g.v * std::exp (-std::pow (x * (1 + (q.ok ? q.v : 0.7f)) * 3, 2.0f));
            }
            return hp.ok && hpOn.ok && hpOn.v != 0.0f ? d - 10 * std::log10 (1 + std::pow (std::pow (1000.0f, u - fu (hp.v)), -4.0f)) : d;
        }, -24, 24);
    }
    else if (fam == "bank")
    {
        const auto nt = F ({ "notchHz" }), rs = F ({ "resonatorHz" }), rg = F ({ "regaliaHz" }), dm = F ({ "dampingHz" });
        resp ([&] (float u) {
            const float a = u - fu (nt.ok ? nt.v : 500), b = u - fu (rs.ok ? rs.v : 2000), r = std::pow (1000.0f, u - fu (dm.ok ? dm.v : 8000));
            return -24 * std::exp (-std::pow (a / 0.03f, 2.0f)) + 12 * std::exp (-std::pow (b / 0.04f, 2.0f)) + (rg.ok ? 6 * std::exp (-std::pow ((u - fu (rg.v)) / 0.06f, 2.0f)) : 0.0f) - 10 * std::log10 (1 + r * r);
        });
    }
    else if (fam == "comb")
    {
        const auto d = F ({ "~delay" }), dp = F ({ "~depth" }), fb = F ({ "~feedback" });
        const float k = 2 + (d.ok ? d.u : 0.5f) * 14, a = dp.ok ? dp.u : 0.6f;
        const auto p = wave::path ([&] (float u) { return juce::Point<float> (X (u), mid + 4 - (0.5f + 0.5f * std::cos (TAU * u * k)) * a * A * 2 + A * (a - 0.5f)); }, big ? 240 : 140);
        Uf (p, h, 4, 0.15f);
        T (p, 1.4f);
        if (fb.ok && fb.u > 0.05f)
        {
            c.strokeStyle = C.bloom (0.25f);
            c.stroke (wave::path ([&] (float u) { return juce::Point<float> (X (u), mid + 4 - std::pow (0.5f + 0.5f * std::cos (TAU * u * k), 1 + fb.u * 6) * A * 2 + A * 0.4f); }, 140));
        }
    }
    else if (fam == "comp" || fam == "gate")
    {
        const auto th = F ({ "~thresh" }), ra = F ({ "~^ratio" }), am = F ({ "~^amount" }), ce = F ({ "~ceiling" }), cp = F ({ "~compressiondb" }), dp = F ({ "~^depth" });
        float Tt = th.ok ? th.v : -18, R = ra.ok ? ra.v : 4, gain = 0;
        const float ceil = ce.ok ? ce.v : 0;
        if (cp.ok)
        {
            Tt = cp.v * 0.5f;
            R = 1 + std::abs (cp.v) / 12;
        }
        if (am.ok && !ra.ok)
        {
            R = 1 + am.u * 10;
            Tt = -6 - am.u * 24;
            gain = am.u * 8;
        }
        auto tf = [&] (float x) { return fam == "gate" ? (x < Tt ? Tt + (x - Tt) * (1 + (dp.ok ? dp.u : 1) * 3) : x) : juce::jmin (ceil, (x < Tt ? x : Tt + (x - Tt) / R) + gain); };
        auto Xd = [&] (float d) { return X (clampf ((d + 60) / 60)); };
        auto Yd = [&] (float d) { return h - 4 - clampf ((d + 60) / 60) * (h - 8); };
        c.setStroke ("rgba(255,255,255,.08)");
        c.setLineDash ({ 2, 3 });
        c.beginPath();
        c.moveTo (Xd (-60), Yd (-60));
        c.lineTo (Xd (0), Yd (0));
        c.stroke();
        c.setLineDash ({});
        const auto p = wave::path ([&] (float u) { const float x = -60 + u * 60; return juce::Point<float> (Xd (x), Yd (tf (x))); }, 80);
        Uf (p, h, 4, 0.14f);
        T (p, 1.5f);
        c.fillStyle = C.bloom (0.5f);
        c.fillRect (Xd (Tt) - 0.5f, 4, 1, h - 8);
        const float lv = -36 + 28 * (0.5f + 0.5f * std::sin (t * 2.6f)) * (live ? 1.0f : 0.6f);
        wave::dot (c, Xd (lv), Yd (tf (lv)), big ? 3.5f : 2.5f, C.wave);
    }
    else if (fam == "taps")
    {
        const auto d = F ({ "~delay|throw|distance|^time" }), fl = F ({ "~flips" }), fb = F ({ "~feedback" }), mx = F ({ "~^mix$|^wet$" }), d2 = F ({ "delay2Ms" });
        const auto lab = label();
        const float dms = fl.ok ? fl.v * 1000 : d.ok ? d.v : 300, span = juce::jmax (dms * 4.2f, lab == "Doubler" ? 120.0f : 900.0f);
        const bool rev = lab.contains ("Boomerang") || lab.contains ("flipper");
        const float fa = fb.ok ? juce::jmin (0.95f, std::abs (fb.v) / ((float) (double) fb.p["max"] > 1.5f ? 100.0f : 1.0f)) : 0.4f, ma = mx.ok ? mx.u : 0.6f;
        c.setFill ("rgba(255,255,255,.16)");
        c.fillRect (X (0), 8, 1.5f, h - 12);
        c.fillStyle = C.bloom (0.12f);
        c.fillRect (X (std::fmod (t * 1000, span) / span), 3, 1, h - 6);
        auto train = [&] (float dt, float a0, juce::Colour col) {
            for (int k = 1; k < 12; ++k)
            {
                const float x = (float) k * dt / span;
                if (x > 1)
                    break;
                const float hh = a0 * std::pow (fa, (float) (k - 1)) * (h - 10);
                if (hh < 1)
                    break;
                if (rev)
                {
                    c2d::Path q;
                    q.moveTo (X (x) - juce::jmin (18.0f, dt / span * (w - 8) * 0.8f), h - 4);
                    q.lineTo (X (x), h - 4 - hh);
                    q.lineTo (X (x), h - 4);
                    q.closePath();
                    c.fillStyle = col.withAlpha (0.35f);
                    c.fill (q);
                }
                c.strokeStyle = col;
                c.lineWidth = big ? 2.0f : 1.6f;
                c.shadowBlur = 8;
                c.shadowColor = col;
                c.beginPath();
                c.moveTo (X (x), h - 4);
                c.lineTo (X (x), h - 4 - hh);
                c.stroke();
                c.shadowBlur = 0;
            }
        };
        train (dms, 0.4f + 0.6f * ma, c2d::css ("rgb(" + catRGB (ct, 80) + ")"));
        if (d2.ok)
            train (d2.v, 0.3f + 0.5f * ma, c2d::css ("rgb(" + catRGB (ct, 64) + ")"));
    }
    else if (fam == "tail" || fam == "conv")
    {
        const auto pre = F ({ "~predelay" }), len = F ({ "reverbTimeS", "decay", "lengthMs", "feedback", "size", "delayMs" }), df = F ({ "~diffusion" }), wt = F ({ "~^mix$|^wet$" }),
                   dm = F ({ "~damp|rolloff|brightness|hicut" });
        const float p0 = pre.ok ? pre.u * 0.22f : 0.02f, tau = 0.05f + (len.ok ? len.u : 0.5f) * 0.42f, den = df.ok ? 0.4f + 0.6f * df.u : 0.8f, a0 = wt.ok ? 0.35f + 0.65f * wt.u : 0.8f;
        const int N = big ? 120 : 64;
        const float fr = std::floor (t * 9);
        c.setFill ("rgba(255,255,255,.22)");
        c.fillRect (X (0), 6, 1.5f, h - 10);
        for (int k = 0; k < N; ++k)
        {
            const float x = (float) k / (float) N;
            if (x < p0)
                continue;
            const float e = std::exp (-(x - p0) / tau) * a0, r = fam == "conv" ? 0.55f + 0.45f * std::cos ((float) k * 0.9f) : (1 - den) + den * rnd ((float) k * 7.3f + fr * 0.37f), hh = e * r * (h - 8);
            if (hh < 0.6f)
                continue;
            const float br = dm.ok ? 1 - dm.u * 0.5f * x : 1.0f;
            c.fillStyle = C.bloom (0.25f + 0.55f * e * br);
            c.fillRect (X (x), h - 4 - hh, big ? 1.4f : 1.2f, hh);
        }
        T (wave::path ([&] (float u) { return juce::Point<float> (X (u), u < p0 ? h - 4 : h - 4 - std::exp (-(u - p0) / tau) * a0 * (h - 8)); }, 80), 1.1f, 0.5f);
    }
    else if (fam == "chorus")
    {
        const auto rt = F ({ "~rate" }), dp = F ({ "~depth" });
        const float a = dp.ok ? dp.u : 0.4f;
        ghost (inn);
        for (int j = 0; j < 3; ++j)
        {
            const float off = a * 0.05f * std::sin (t * TAU * (rt.ok ? 0.2f + rt.v * 0.3f : 0.5f) + (float) j * 2.1f);
            c.globalAlpha = j != 0 ? 0.55f : 1.0f;
            wavef ([&] (float u) { return wave::rd (wv, u * 2 + off + (float) j * a * 0.012f); }, j != 0 ? 1.0f : 1.3f);
        }
        c.globalAlpha = 1;
    }
    else if (fam == "phaser")
    {
        const auto rt = F ({ "~rate" }), dp = F ({ "~depth" }), fb = F ({ "~feedback|resonance" });
        const float a = dp.ok ? dp.u : 0.5f, lf = std::sin (t * TAU * (rt.ok ? juce::jmin (2.0f, rt.v) : 0.4f));
        const bool flg = label().contains ("lang");
        resp ([&] (float u) {
            if (flg)
            {
                const float k = 3 + (1 + lf * a) * 5;
                return -18 * std::pow (1 - (0.5f + 0.5f * std::cos (TAU * u * k)), 1 + (fb.ok ? fb.u * 2 : 0.0f));
            }
            float d = 0;
            for (int i = 0; i < 4; ++i)
            {
                const float c0 = 0.25f + (float) i * 0.16f + lf * a * 0.08f;
                d -= 22 * a * std::exp (-std::pow ((u - c0) / (0.02f + (1 - (fb.ok ? fb.u : 0.3f)) * 0.02f), 2.0f));
            }
            return d;
        });
    }
    else if (fam == "trem")
    {
        const auto rt = F ({ "~rate" }), dp = F ({ "~depth" });
        const float a = dp.ok ? dp.u : 0.6f, ph = t * TAU * (rt.ok ? juce::jmin (3.0f, rt.v) * 0.5f : 0.6f);
        auto env = [&] (float u) { return 1 - a * (0.5f + 0.5f * std::sin (TAU * u * 3 - ph)); };
        ghost (inn);
        wavef ([&] (float u) { return inn (u) * env (u); });
        c.setLineDash ({ 2, 3 });
        c.strokeStyle = C.bloom (0.45f);
        c.stroke (wave::path ([&] (float u) { return juce::Point<float> (X (u), mid - env (u) * A); }, 60));
        c.setLineDash ({});
    }
    else if (fam == "vib")
    {
        const auto rt = F ({ "~rate" }), dp = F ({ "~depth|amdepth" });
        const float a = dp.ok ? dp.u : 0.5f, ph = t * TAU * (rt.ok ? juce::jmin (3.0f, rt.v) * 0.4f : 0.6f);
        ghost (inn);
        wavef ([&] (float u) { return wave::rd (wv, u * 2 + a * 0.07f * std::sin (TAU * u * 2.5f - ph)); });
    }
    else if (fam == "ring")
    {
        const auto hz = F ({ "~hz$" }), dp = F ({ "~depth|^mix$" });
        const float k = 2 + (hz.ok ? hz.u : 0.5f) * 9, a = dp.ok ? 0.3f + 0.7f * dp.u : 1.0f;
        ghost (inn);
        c.strokeStyle = C.bloom (0.18f);
        c.stroke (wave::path ([&] (float u) { return juce::Point<float> (X (u), mid - std::sin (TAU * u * k + t * 3) * A * 0.5f); }, 100));
        wavef ([&] (float u) { return inn (u) * (1 - a + a * std::sin (TAU * u * k + t * 3)); });
    }
    else if (fam == "pitch")
    {
        const auto st = F ({ "semitones" }), ce = F ({ "cents" }), pc = F ({ "pitch" });
        const auto lab = label();
        const float r = pc.ok ? juce::jmax (0.25f, pc.v / 100) : std::pow (2.0f, ((st.ok ? st.v : 0) + (ce.ok ? ce.v / 100 : 0) + (lab == "Detune" ? 0.6f : 0)) / 12);
        ghost (inn);
        wavef ([&] (float u) { return wave::rd (wv, u * 2 * r + t * 0.15f * (r - 1)); });
        if (lab == "Harmonizer")
        {
            c.globalAlpha = 0.5f;
            wavef ([&] (float u) { return wave::rd (wv, u * 2 * r * 1.26f); }, 1);
            c.globalAlpha = 1;
        }
    }
    else if (fam == "drive")
    {
        const auto dr = F ({ "drive" });
        const float d = 1 + (dr.ok ? dr.v : 0.45f) * 12;
        ghost (inn);
        wavef ([&] (float u) { return std::tanh (inn (u) * d) / std::tanh (d); });
    }
    else if (fam == "crush")
    {
        const auto bt = F ({ "~bits|^depth$" }), rt = F ({ "~^rate$|averaging" });
        const float bits = bt.ok ? ((float) (double) bt.p["max"] > 2 ? bt.v : 2 + bt.u * 14) : 6.0f, q = std::pow (2.0f, juce::jmax (1.0f, bits) - 1);
        const float hold = rt.ok ? (rt.p["key"].toString() == "averaging" ? 1 + rt.u * 0.12f * wave::NP : 1 + (1 - rt.u) * 20) : 6.0f;
        const int N = big ? 200 : 120;
        c2d::Path p;
        ghost (inn);
        for (int i = 0; i <= N; ++i)
        {
            const float u = (float) i / (float) N, uh = std::floor (u * wave::NP * 2 / hold) * hold / (wave::NP * 2), y = std::round (wave::rd (wv, uh * 2) * q) / q;
            if (i)
                p.lineTo (X (u), mid - y * A);
            else
                p.moveTo (X (u), mid - y * A);
        }
        Uf (p, mid, 4, 0.12f);
        T (p, 1.2f);
    }
    else if (fam == "cheby")
    {
        const int tk[] = { 1, 2, 3, 4, 5, 7 };
        float lv[6] {};
        float tot = 0;
        for (int i = 0; i < 6; ++i)
        {
            const auto key = "t" + juce::String (tk[i]) + "Db";
            const auto q = F ({ key.toRawUTF8() });
            lv[i] = q.ok && q.v > -59 ? std::pow (10.0f, q.v / 20) : 0.0f;
            tot += lv[i];
        }
        ghost (inn);
        wavef ([&] (float u) {
            const float x = inn (u);
            float y = 0;
            for (int i = 0; i < 6; ++i)
                y += lv[i] * std::cos ((float) tk[i] * std::acos (clampf (x, -1, 1)));
            return clampf (y / juce::jmax (1.0f, tot) * 1.2f, -1.2f, 1.2f);
        });
        for (int i = 0; i < 6; ++i)
        {
            const float hh = lv[i] * (h * 0.34f);
            c.fillStyle = C.bloom (0.55f);
            c.fillRect (w - 6 - (float) (6 - i) * (big ? 7.0f : 5.0f), h - 3 - hh, big ? 5.0f : 3.0f, hh);
        }
    }
    else if (fam == "field" || fam == "swap")
    {
        const auto wd = F ({ "~width|side|^level$|^depth$" }), pnp = F ({ "~balance|position|^pan$|direction|rotate" }), rt = F ({ "~rate" });
        const bool ap = label().contains ("Auto-Pan");
        float ang = pnp.ok ? (pnp.u - 0.5f) * PI * 0.5f : 0.0f;
        if (ap)
            ang = (wd.ok ? wd.u : 0.7f) * std::sin (t * TAU * (rt.ok ? rt.v * 0.5f : 0.4f)) * PI * 0.25f;
        const float sw = ap ? 0.15f : wd.ok ? 0.1f + wd.u * 0.9f : 0.6f, cx = w / 2, cy = h / 2, r = h * 0.42f;
        c.setStroke ("rgba(255,255,255,.07)");
        c.beginPath();
        c.moveTo (cx - r, cy - r);
        c.lineTo (cx + r, cy + r);
        c.moveTo (cx + r, cy - r);
        c.lineTo (cx - r, cy + r);
        c.moveTo (cx, cy - r);
        c.lineTo (cx, cy + r);
        c.stroke();
        c.font = "600 9px mono";
        c.fillStyle = cl.t3;
        c.fillText (fam == "swap" ? "R" : "L", cx - r - 9, cy - r + 6);
        c.fillText (fam == "swap" ? "L" : "R", cx + r + 3, cy - r + 6);
        T (wave::path ([&] (float u) {
               const float mm = wave::rd (wv, u * 3), s = wave::rd (wv, u * 3 + 0.17f) * sw, x = s * std::cos (ang) - mm * std::sin (ang), y = s * std::sin (ang) + mm * std::cos (ang);
               return juce::Point<float> (cx + x * r * (fam == "swap" ? -1.0f : 1.0f), cy - y * r);
           }, big ? 260 : 160),
           1, 0.6f);
    }
    else if (fam == "room")
    {
        const auto x = F ({ "xM" }), y = F ({ "yM" });
        const float cx = w / 2, ly = h - 6, sx = cx + (x.ok ? x.v / 20 : 0) * (w / 2 - 10), sy = ly - clampf (((y.ok ? y.v : 10) + 20) / 40) * (h - 12);
        c.setStroke ("rgba(255,255,255,.08)");
        c.strokeRect (6, 3, w - 12, h - 6);
        for (int k = 0; k < 4; ++k)
        {
            const float rr = std::fmod (t * 30 + (float) k * 14, 56.0f);
            c.strokeStyle = C.bloom (0.4f * (1 - rr / 56));
            c.beginPath();
            c.arc (sx, sy, rr, 0, TAU);
            c.stroke();
        }
        wave::dot (c, sx, sy, 3, C.wave);
        c.fillStyle = cl.t2;
        c.beginPath();
        c.moveTo (cx, ly - 6);
        c.lineTo (cx - 4, ly);
        c.lineTo (cx + 4, ly);
        c.fill();
    }
    else if (fam == "spec")
    {
        const auto th = F ({ "thresholdDb" }), ra = F ({ "ratio" }), md = F ({ "mode" });
        const auto mg = waveSpec (P, wv);
        const float ty = th.ok ? clampf (1 - (th.v + 120) / 144) : 0.5f, bw = (w - 8) / 32;
        for (int k = 0; k < 32; ++k)
        {
            const float a = clampf ((20 * std::log10 (mg[(size_t) k] + 1e-6f) + 60) / 60), hh = a * (h - 8), tt = ty * (h - 8);
            float h2 = hh;
            if (md.ok && md.v == 2.0f && hh > tt)
                h2 = tt + (hh - tt) / (ra.ok ? ra.v : 2);
            if (md.ok && md.v == 0.0f && hh < tt)
                h2 = hh * 0.25f;
            c.fillStyle = C.bloom (0.18f);
            c.fillRect (4 + (float) k * bw, h - 4 - hh, bw - 1, hh);
            c.fillStyle = C.bloom (0.7f);
            c.fillRect (4 + (float) k * bw, h - 4 - h2, bw - 1, h2);
        }
        c.strokeStyle = C.wave;
        c.setLineDash ({ 3, 3 });
        c.beginPath();
        c.moveTo (4, h - 4 - ty * (h - 8));
        c.lineTo (w - 4, h - 4 - ty * (h - 8));
        c.stroke();
        c.setLineDash ({});
    }
    else if (fam == "grains")
    {
        const auto dn = F ({ "density" }), gs = F ({ "grainSize" });
        const int N = juce::roundToInt (4 + (dn.ok ? dn.u : 0.5f) * (big ? 30.0f : 18.0f));
        const float gw = 6 + (gs.ok ? gs.u : 0.4f) * (big ? 40.0f : 22.0f);
        ghost (inn);
        for (int i = 0; i < N; ++i)
        {
            const float x = std::fmod (rnd ((float) i * 3.1f) + t * 0.08f * (float) (1 + i % 3), 1.0f), y = mid + (rnd ((float) i * 7.7f) - 0.5f) * h * 0.5f, a = 0.35f + 0.6f * rnd ((float) i * 1.3f);
            auto gr = c.createRadialGradient (X (x), y, 0, X (x), y, gw / 2);
            gr.stops.push_back ({ 0.0f, C.bloom (0.6f * a) });
            gr.stops.push_back ({ 1.0f, C.bloom (0) });
            c.fillStyle = gr;
            c.fillRect (X (x) - gw / 2, y - gw / 2, gw, gw);
        }
    }
    else if (fam == "noise")
    {
        const auto ck = F ({ "clockHz" }), lvp = F ({ "level" });
        const int st = juce::roundToInt (6 + (ck.ok ? ck.u : 0.5f) * (big ? 90.0f : 50.0f));
        const float a = lvp.ok ? 0.25f + 0.75f * lvp.u : 0.7f, fr = std::floor (t * 12);
        const auto lab = label();
        const bool sb = lab.contains ("Single"), eq = lab.contains ("Equalized");
        c2d::Path p;
        ghost (inn);
        float py = 0;
        for (int k = 0; k < st; ++k)
        {
            float y = sb ? (rnd ((float) k + fr * 31) > 0.5f ? 1.0f : -1.0f) : rnd ((float) k * 1.7f + fr * 31) * 2 - 1;
            if (eq)
                y = (y + py) / 2;
            py = y;
            const float x0 = X ((float) k / (float) st), x1 = X ((float) (k + 1) / (float) st);
            if (k)
                p.lineTo (x0, mid - y * A * a);
            else
                p.moveTo (x0, mid - y * A * a);
            p.lineTo (x1, mid - y * A * a);
        }
        T (p, 1.1f);
    }
    else if (fam == "invert")
    {
        ghost (inn);
        wavef ([&] (float u) { return -inn (u); });
    }
    else
    {
        const auto gd = F ({ "~gaindb|^db$" }), wdt = F ({ "width" });
        const float g0 = gd.ok ? std::pow (10.0f, gd.v / 20) : 1.0f;
        ghost (inn);
        wavef ([&] (float u) { return clampf (inn (u) * g0, -1.25f, 1.25f); });
        if (wdt.ok)
        {
            c.font = "600 9px mono";
            c.fillStyle = cl.t3;
            c.fillText ("width " + juce::String (wdt.v, 2) + juce::String::fromUTF8 ("\xc3\x97"), 6, 10);
        }
    }
    if (o.empty())
    {
        c.font = "500 9px sans";
        c.fillStyle = cl.t3;
        c.textAlign = "right";
        c.fillText ("nothing in yet", w - 6, 11);
        c.textAlign = "left";
    }
    if (n["on"].isBool() && !(bool) n["on"])
    {
        c.setFill ("rgba(0,0,0,.4)");
        c.fillRect (0, 0, w, h);
        c.font = "600 9px mono";
        c.fillStyle = cl.t2;
        c.textAlign = "center";
        c.fillText ("BYPASSED", w / 2, h / 2 + 3);
        c.textAlign = "left";
    }
}

void drawRoutingPic (c2d::Context& c, float w, float h, Pics& P, const juce::var& n)
{
    auto& m = *P.model;
    const auto& cl = *P.cl;
    const float t = P.t;
    const auto o = inOrigins (*P.board, m, n, P.memo);
    bool any = false;
    const auto col = originCol (o, any);
    auto C = cl;
    if (any)
        C.wave = col, C.br = col.getRed(), C.bg = col.getGreen(), C.bb = col.getBlue();
    const Frame wv = o.empty() ? sine() : inputWave (P, *o.begin());
    auto X = [&] (float u) { return 4 + u * (w - 8); };
    const float mid = h / 2, A = h * 0.36f;
    const bool big = w > 200;
    const auto kind = n["kind"].toString();
    auto val = [&] (const juce::var& p) { return pn (p, pval (n, p)); };
    if (kind == "split")
    {
        const int rows = portCount (n);
        const float y0 = h / 2;
        for (int i = 0; i < rows; ++i)
        {
            const float y = h / (float) rows * ((float) i + 0.5f);
            c2d::Path p;
            p.moveTo (2, y0);
            p.bezierCurveTo (w * 0.45f, y0, w * 0.45f, y, w - 2, y);
            wave::trace (c, p, C, 1.3f, any ? 0.7f : 0.0f);
            if (any)
            {
                const float u = std::fmod (t * 0.8f, 1.0f);
                wave::dot (c, 2 + (w - 4) * u, y0 + (y - y0) * (u * u * (3 - 2 * u)), 1.8f, C.wave);
            }
            if (big)
            {
                c.font = "600 9px mono";
                c.fillStyle = cl.t3;
                c.fillText (juce::String::charToString ((juce::juce_wchar) ('A' + i)), w - 12, y - 4);
            }
        }
        return;
    }
    if (kind == "mix")
    {
        const auto sp = spec (n);
        const float bw = (w - 16) / (float) juce::jmax (1, sp.size());
        for (int i = 0; i < sp.size(); ++i)
        {
            Origins s;
            if (auto* cs = (*P.board)["cables"].getArray())
                for (auto& cb : *cs)
                    if (cb["to"][0].toString() == n["id"].toString() && cb["to"][1].toString() == "i" + juce::String (i))
                        for (auto& x : origins (*P.board, m, cb["from"][0].toString(), cb["from"][1].toString(), P.memo))
                            s.insert (x);
            const float hh = val (sp[i]) * (h - 16);
            bool a2 = false;
            const auto cc = originCol (s, a2);
            c.fillStyle = a2 ? cc : c2d::css ("rgba(255,255,255,.15)");
            c.globalAlpha = a2 ? 0.75f : 0.4f;
            c.fillRect (8 + (float) i * bw + bw * 0.2f, h - 6 - hh, bw * 0.6f, hh);
            c.globalAlpha = 1;
            c.font = "600 9px mono";
            c.fillStyle = cl.t3;
            c.fillText ("IN " + juce::String (i + 1), 8 + (float) i * bw + bw * 0.2f, 12);
        }
        return;
    }
    const auto sp = spec (n);
    if (sp.isEmpty())
        return;
    const auto& p0 = sp[0];
    if (kind == "gain")
    {
        const float g0 = std::pow (10.0f, pval (n, p0) / 20);
        c.setStroke ("rgba(255,255,255,.12)");
        c.stroke (wave::path ([&] (float u) { return juce::Point<float> (X (u), mid - wave::rd (wv, u * 2) * A); }, 80));
        wave::trace (c, wave::path ([&] (float u) { return juce::Point<float> (X (u), mid - clampf (wave::rd (wv, u * 2) * g0, -1.3f, 1.3f) * A); }, big ? 200 : 80), C, 1.2f, any ? 0.7f : 0.0f);
        return;
    }
    if (kind == "pan")
    {
        const float pvv = pval (n, p0) / 100, L = std::cos (juce::jmax (pvv, 0.0f) * PI / 2), R = std::cos (juce::jmax (-pvv, 0.0f) * PI / 2);
        for (int i = 0; i < 2; ++i)
        {
            const float v = i ? R : L;
            c.fillStyle = any ? col : c2d::css ("rgba(255,255,255,.2)");
            c.globalAlpha = 0.25f + 0.6f * v;
            const float y = i ? mid + 2 : 4.0f, hh = mid - 6;
            c.fillRect (14, y, (w - 20) * v, hh);
            c.globalAlpha = 1;
            c.font = "600 9px mono";
            c.fillStyle = cl.t3;
            c.fillText (i ? "R" : "L", 3, y + hh - 2);
        }
        return;
    }
    if (kind == "drywet")
    {
        const float mm = val (p0);
        c.strokeStyle = C.bloom (0.2f + 0.5f * (1 - mm));
        c.lineWidth = 1;
        c.stroke (wave::path ([&] (float u) { return juce::Point<float> (X (u), mid - wave::rd (wv, u * 2) * A); }, big ? 160 : 40));
        c.globalAlpha = 0.3f + 0.7f * mm;
        wave::trace (c, wave::path ([&] (float u) { return juce::Point<float> (X (u), mid - wave::rd (wv, u * 2 + 0.04f * std::sin (u * 9 + t)) * A * 0.8f); }, big ? 160 : 40), C, 1.2f, 0.6f);
        c.globalAlpha = 1;
    }
}

void drawIOPic (c2d::Context& c, float w, float h, Pics& P, const juce::var& n)
{
    auto& m = *P.model;
    const auto& cl = *P.cl;
    const bool big = w > 200;
    const float pk = P.peak (n["id"].toString());
    const auto kind = n["kind"].toString();
    if (kind == "out")
    {
        const auto o = inOrigins (*P.board, m, n, P.memo);
        float top = 0;
        if (auto* a = m.tele["peak"].getArray())
            for (auto& x : *a)
                top = juce::jmax (top, (float) (double) x);
        const float lv = o.empty() ? 0.0f : clampf (juce::jmax (pk, top));
        const int N = big ? 40 : 18;
        const float bw = (w - 8) / (float) N;
        for (int r = 0; r < 2; ++r)
            for (int i = 0; i < N; ++i)
            {
                const bool on = (float) i / (float) N < lv * (r ? 0.94f : 1.0f);
                c.fillStyle = on ? ((float) i > (float) N * 0.85f ? cl.acc : cl.bloom (0.85f)) : c2d::css ("rgba(255,255,255,.06)");
                c.fillRect (4 + (float) i * bw, r ? h / 2 + 2 : 4.0f, bw - 1.5f, h / 2 - 6);
            }
        return;
    }
    const bool live = !(n["on"].isBool() && !(bool) n["on"]) && inputLive (m, kind);
    const auto ic = inputColour (kind);
    auto C = cl;
    C.wave = ic, C.br = ic.getRed(), C.bg = ic.getGreen(), C.bb = ic.getBlue();
    if (!live)
    {
        c.setStroke ("rgba(255,255,255,.15)");
        c.beginPath();
        c.moveTo (4, h / 2);
        c.lineTo (w - 4, h / 2);
        c.stroke();
        return;
    }
    const auto wv = inputWave (P, kind);
    const float a = pk > 0.001f ? 0.35f + 0.65f * clampf (pk * 2) : 0.35f;
    c.globalAlpha = pk > 0.001f ? 1.0f : 0.55f;
    const auto p = wave::path ([&] (float u) { return juce::Point<float> (4 + u * (w - 8), h / 2 - wave::rd (wv, u * (big ? 3.0f : 2.0f)) * h * 0.36f * a); }, big ? 240 : 90);
    wave::under (c, p, 4, w - 4, h / 2, 2, C, 0.12f);
    wave::trace (c, p, C, big ? 1.4f : 1.1f, 0.7f);
    c.globalAlpha = 1;
}

void drawNodePic (c2d::Context& c, float w, float h, Pics& P, const juce::var& n)
{
    if (isIO (n))
        drawIOPic (c, w, h, P, n);
    else if (isFx (n))
        drawFxPic (c, w, h, P, n);
    else
        drawRoutingPic (c, w, h, P, n);
}

void drawBoardKnob (c2d::Context& c, float s, Pics& P, const juce::var& n, const juce::var& p)
{
    const auto mo = wave::modOf (*P.model, "board:" + n["id"].toString() + ":" + p["key"].toString());
    const float v = pn (p, pval (n, p));
    wave::ring (c, s, v, *P.cl, pbip (p), true, &mo);
    wave::drawControlPic (c, s, s, *P.cl, v, p["key"].toString());
}

float Pics::peak (const juce::String& id) const
{
    const auto& p = model->tele["board"][juce::Identifier (id)];
    if (!p.isArray())
        return 0;
    return juce::jmax (0.0f, (float) (double) p[0], (float) (double) p[1]);
}
} // namespace board
