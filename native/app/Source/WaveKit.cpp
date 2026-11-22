#include "WaveKit.h"

namespace wave
{
namespace
{
juce::String f1 (float v) { return juce::String (v, 1); }
const juce::String minus = juce::String::fromUTF8 ("\xe2\x88\x92");
} // namespace

const std::vector<Source>& sources()
{
    static const std::vector<Source> s = [] {
        std::vector<Source> out;
        for (int m : { 1, 2, 3 })
            out.push_back ({ "env" + juce::String (m), "ENV " + juce::String (m + 1), "env", false });
        for (int l = 0; l < 4; ++l)
            out.push_back ({ "lfo" + juce::String (l), "LFO " + juce::String (l + 1), "lfo", l == 0 });
        const char* perf[][2] = { { "vel", "VEL" }, { "note", "NOTE" }, { "mw", "MW" }, { "at", "AT" }, { "rand", "RAND" } };
        for (int i = 0; i < 5; ++i)
            out.push_back ({ perf[i][0], perf[i][1], "perf", i == 0 });
        for (int i = 0; i < 8; ++i)
            out.push_back ({ "macro" + juce::String (i), "M" + juce::String (i + 1), "macro", i == 0 });
        return out;
    }();
    return s;
}

const Source* sourceOf (const juce::String& key)
{
    for (const auto& s : sources())
        if (s.key == key)
            return &s;
    return nullptr;
}

juce::String srcLab (const juce::String& src)
{
    if (src == "amp")
        return "AMP";
    auto* s = sourceOf (src);
    return s != nullptr ? s->label : src;
}

juce::String srcName (const Model& m, const juce::String& src)
{
    if (src.isEmpty())
        return juce::String::fromUTF8 ("\xe2\x80\x94");
    if (src.startsWith ("macro") && src.length() == 6)
        return m.macroNames[src.getTrailingIntValue()].isNotEmpty() ? m.macroNames[src.getTrailingIntValue()] : src;
    static const std::map<juce::String, juce::String> names {
        { "mw", "Mod wheel" }, { "vel", "Velocity" }, { "at", "Aftertouch" }, { "note", "Note" }, { "rand", "Random" },
        { "env1", "ENV 2" }, { "env2", "ENV 3" }, { "env3", "ENV 4" }, { "lfo0", "LFO 1" }, { "lfo1", "LFO 2" }, { "lfo2", "LFO 3" }, { "lfo3", "LFO 4" },
    };
    auto it = names.find (src);
    return it != names.end() ? it->second : src;
}

juce::String srcGlyph (const Model& m, const juce::String& src, float w, float h)
{
    auto* s = sourceOf (src);
    juce::String d;
    if (s != nullptr && s->kind == "lfo")
    {
        const int L = src.getTrailingIntValue();
        for (int k = 0; k <= 28; ++k)
        {
            const float u = (float) k / 28;
            d << (k != 0 ? "L" : "M") << f1 (1 + u * (w - 2)) << " " << f1 (h - 1 - lfoVal (m, L, u, 0) * (h - 2));
        }
    }
    else if (s != nullptr && s->kind == "macro")
        d << "M2 " << (h - 1) << " A5 5 0 1 1 " << (w - 2) << " " << (h - 1);
    else if (s != nullptr && s->kind == "perf")
    {
        const juce::String H (h - 1), W1 (w - 1);
        if (src == "vel")
            d = "M2 " + H + " V4 M6 " + H + " V2 M10 " + H + " V5";
        else if (src == "note")
            d = "M1 " + H + " L" + W1 + " 1";
        else if (src == "mw")
            d = "M1 " + H + " H5 V3 H" + W1;
        else if (src == "at")
            d = "M1 " + H + " C5 " + H + ",6 2," + W1 + " 2";
        else
            d = "M1 6 H4 V2 H7 V8 H10 V4 H" + W1;
    }
    else
        d << "M1 " << (h - 1) << " L4 1 L7 " << (h / 2) << " H" << (w - 4) << " L" << (w - 1) << " " << (h - 1);
    return d;
}

std::function<juce::String (const juce::var&)>& boardNodeName()
{
    static std::function<juce::String (const juce::var&)> f;
    return f;
}

namespace
{
const juce::var* boardNode (const Model& m, const juce::String& id)
{
    if (auto* ns = m.board["nodes"].getArray())
        for (const auto& n : *ns)
            if (n["id"].toString() == id)
                return &n;
    return nullptr;
}
} // namespace

std::function<juce::String (const juce::var& node, const juce::String& key)>& boardParamLabel();
std::function<juce::String (const juce::var& node, const juce::String& key)>& boardParamLabel()
{
    static std::function<juce::String (const juce::var&, const juce::String&)> f;
    return f;
}

juce::String boardDstName (const Model& m, const juce::String& d, bool shortName)
{
    auto parts = juce::StringArray::fromTokens (d, ":", "");
    const auto id = parts[1], key = parts[2];
    const auto* n = boardNode (m, id);
    juce::String lab = key;
    if (n != nullptr && boardParamLabel())
        lab = boardParamLabel() (*n, key);
    if (shortName)
        return lab;
    return (n != nullptr && boardNodeName() ? boardNodeName() (*n) : id) + juce::String::fromUTF8 (" \xc2\xb7 ") + lab;
}

std::vector<TargetGroup> targetGroups (const Model& m)
{
    std::vector<TargetGroup> G;
    const juce::String grey = "#c9cfdc";
    static const char* osc[][3] = { { "pos", "Position", "Position" }, { "warp0.amt", "Warp 1", "Warp 1" }, { "warp1.amt", "Warp 2", "Warp 2" }, { "uni.det", "Detune", "Unison detune" },
                                    { "uni.spr", "Width", "Unison width" }, { "fx.a", "Effect", "Effect mix" }, { "pitch", "Pitch", "Pitch" }, { "fine", "Fine", "Fine" },
                                    { "phase", "Phase", "Start phase" }, { "rand", "Rand", "Phase rand" }, { "pan", "Pan", "Pan" }, { "table", "Table", "Table" },
                                    { "warp0.mode", "W1 Type", "Warp 1 type" }, { "warp1.mode", "W2 Type", "Warp 2 type" }, { "fx.mode", "FX Type", "Effect type" } };
    for (int o = 0; o < 3; ++o)
    {
        const auto L = juce::String::charToString ((juce::juce_wchar) ('A' + o));
        TargetGroup g { "OSC " + L, grey, {} };
        for (auto& k : osc)
            g.ks.push_back ({ "osc" + juce::String (o) + "." + k[0], k[1], L + " " + k[2] });
        G.push_back (g);
    }
    G.push_back ({ juce::String::fromUTF8 ("SUB \xc2\xb7 NOISE"), grey, { { "sub.level", "Sub", "Sub level" }, { "noise.level", "Noise", "Noise level" } } });
    {
        TargetGroup g { "FILTERS", grey, {} };
        static const char* fk[][3] = { { "cut", "Cut", "Cutoff" }, { "res", "Res", "Res" }, { "drive", "Drive", "Drive" }, { "key", "Key", "Key" }, { "type", "Type", "Type" } };
        for (int f = 0; f < 2; ++f)
            for (auto& k : fk)
                g.ks.push_back ({ "filt" + juce::String (f) + "." + k[0], "F" + juce::String (f + 1) + " " + k[1], "F" + juce::String (f + 1) + " " + k[2] });
        g.ks.push_back ({ "filt.route", "Route", "Filter routing" });
        G.push_back (g);
    }
    {
        TargetGroup g { "MIX", grey, {} };
        for (int o = 0; o < 3; ++o)
        {
            const auto L = juce::String::charToString ((juce::juce_wchar) ('A' + o));
            g.ks.push_back ({ "osc" + juce::String (o) + ".level", L + " Level", L + " Level" });
        }
        G.push_back (g);
    }
    G.push_back ({ "VOICE", grey, { { "voice.glide", "Glide", "Glide" } } });
    for (int l = 0; l < 4; ++l)
    {
        TargetGroup g { "LFO " + juce::String (l + 1), sourceColour ("lfo" + juce::String (l)), {} };
        for (auto& k : { std::pair { "rate", "Rate" }, { "smooth", "Smooth" }, { "rise", "Rise" }, { "shape", "Shape" } })
            g.ks.push_back ({ "lfo" + juce::String (l) + "." + k.first, k.second, "LFO " + juce::String (l + 1) + " " + k.second });
        G.push_back (g);
    }
    for (const juce::String e : { "amp", "env1", "env2", "env3" })
    {
        const auto lab = e == "amp" ? juce::String ("AMP") : srcLab (e);
        const auto full = e == "amp" ? juce::String ("Amp") : srcLab (e);
        TargetGroup g { lab, sourceColour (e), {} };
        for (auto& k : { std::pair { "a", "Attack" }, { "d", "Decay" }, { "s", "Sustain" }, { "r", "Release" } })
            g.ks.push_back ({ e + "." + k.first, k.second, full + " " + k.second });
        G.push_back (g);
    }
    {
        TargetGroup g { "MACROS", "#e6d8b8", {} };
        for (int i = 0; i < 8; ++i)
            g.ks.push_back ({ "macro" + juce::String (i), "M" + juce::String (i + 1), "M" + juce::String (i + 1) + " " + m.macroNames[i] });
        G.push_back (g);
    }
    juce::StringArray board;
    for (const auto& r : m.mods)
        if (r.dst.startsWith ("board:"))
            board.addIfNotAlreadyThere (r.dst);
    if (!board.isEmpty())
    {
        TargetGroup g { "FX BOARD", "#7cf0d0", {} };
        for (const auto& d : board)
            g.ks.push_back ({ d, boardDstName (m, d, true), boardDstName (m, d) });
        G.push_back (g);
    }
    return G;
}

juce::String targetName (const Model& m, const juce::String& t)
{
    if (t.isEmpty())
        return juce::String::fromUTF8 ("\xe2\x80\x94");
    if (t.startsWith ("board:"))
        return boardDstName (m, t);
    for (const auto& G : targetGroups (m))
        for (const auto& k : G.ks)
            if (k.key == t)
                return k.full;
    return t.replaceFirstOccurrenceOf (".", " ");
}

juce::StringArray choiceOpts (const Model& m, const juce::String& k)
{
    const bool osc = k.startsWith ("osc") && k.length() > 4 && juce::CharacterFunctions::isDigit (k[3]);
    const auto rest = k.fromFirstOccurrenceOf (".", false, false);
    if (osc && (rest == "warp0.mode" || rest == "warp1.mode"))
        return { "off", "bend", "sync", "pwm", "fold", "mirror", "asym", "quant", "fm" };
    if (osc && rest == "fx.mode")
        return { "off", "chorus", "crush", "drive", "delay", "phaser", "ring", "comb" };
    if (osc && rest == "table")
    {
        juce::StringArray o { "Formant Sweep", "Glass Organ", juce::String::fromUTF8 ("Vowel Ah\xe2\x80\x93Oo"), "Hollow Pulse", "Grit Saw" };
        for (int i = 0; i < 3; ++i)
            o.addIfNotAlreadyThere (m.s ("osc" + juce::String (i) + ".table"));
        return o;
    }
    if (k.startsWith ("filt") && rest == "type")
        return { "lp", "bp", "hp", "notch", "comb", "form" };
    if (k == "filt.route")
        return { "serial", "parallel", "split" };
    if (k.startsWith ("lfo") && rest == "shape")
        return { "sine", "tri", "up", "down", "square", "steps", "smooth", "drawn" };
    return {};
}

float choiceStep (const Model& m, const juce::String& k)
{
    const auto o = choiceOpts (m, k);
    return o.isEmpty() ? 0.0f : 1.0f / (float) juce::jmax (1, o.size() - 1);
}

juce::String amtTxt (float a)
{
    return (a > 0 ? juce::String ("+") : a < 0 ? minus : juce::String()) + juce::String (juce::roundToInt (std::abs (a) * 100));
}

juce::String rowAmtTxt (const Model& m, const Model::Mod& r)
{
    const float st = choiceStep (m, r.dst);
    if (st <= 0)
        return amtTxt (r.amt);
    return (r.amt > 0 ? juce::String ("+") : r.amt < 0 ? minus : juce::String()) + juce::String (juce::roundToInt (std::abs (r.amt) / st));
}

float snapAmt (const Model& m, const juce::String& k, float a)
{
    const float st = choiceStep (m, k);
    return st > 0 ? clamp (std::round (a / st) * st, -1, 1) : a;
}

float curveAt (const juce::String& k, float x)
{
    return k == "exp" ? x * x * x : k == "log" ? 1 - std::pow (1 - x, 3.0f) : k == "s" ? x * x * (3 - 2 * x) : x;
}

const juce::StringArray& curves()
{
    static const juce::StringArray c { "lin", "exp", "log", "s" };
    return c;
}

ModOf modOf (const Model& m, const juce::String& dst)
{
    ModOf o;
    for (const auto& r : m.mods)
    {
        if (r.dst != dst || r.off)
            continue;
        o.rng += std::abs (r.amt);
        if (o.col.isEmpty())
            o.col = sourceColour (r.src);
    }
    const auto& v = m.tele["mod"][juce::Identifier (dst)];
    if (v.isDouble() || v.isInt())
        o.live = true, o.at = (float) (double) v;
    return o;
}

juce::String choiceNow (const Model& m, const juce::String& k)
{
    const auto& v = m.tele["mod"][juce::Identifier (k)];
    return v.isString() ? v.toString() : m.s (k);
}

std::vector<Voice> voices (const Model& m)
{
    std::vector<Voice> out;
    if (auto* a = m.tele["voices"].getArray())
        for (const auto& v : *a)
        {
            Voice x;
            x.note = (int) v["note"];
            x.vel = (float) (double) v["vel"];
            x.env = (float) (double) v["env"];
            const auto st = v["stage"].toString().toLowerCase();
            x.stage = st.isEmpty() ? 's' : (char) st[0];
            out.push_back (x);
        }
    return out;
}

float lfoPhase (const Model& m, int L)
{
    const auto& p = m.tele["lfo"];
    if (!p.isArray() || p.size() <= L)
        return -1;
    const float ph = (float) (double) p[L];
    return std::fmod (std::fmod (ph, 1.0f) + 1.0f, 1.0f);
}

float srcVal (const Model& m, const juce::String& src)
{
    const auto& T = m.tele;
    if (!T.isObject())
        return 0;
    if (src.startsWith ("lfo"))
    {
        const int L = src.getTrailingIntValue();
        const auto& out = T["lfoValue"];
        if (out.isArray() && out.size() > L)
            return clamp ((float) (double) out[L], -1, 1);
        const float ph = lfoPhase (m, L);
        return ph >= 0 ? lfoVal (m, L, ph) * 2 - 1 : 0;
    }
    if (src.startsWith ("macro"))
        return m.g (src);
    if (src == "mw")
        return m.mw;
    const auto vs = voices (m);
    if (src == "vel")
        return vs.empty() ? 0 : clamp (vs.back().vel);
    if (src == "note")
        return vs.empty() ? 0 : clamp ((float) (vs.back().note - 36) / 60);
    if (src == "at")
        return T["at"].isDouble() ? clamp ((float) (double) T["at"]) : 0;
    if (src == "rand")
        return T["rand"].isDouble() ? clamp ((float) (double) T["rand"]) : 0;
    float e = 0;
    for (const auto& v : vs)
        e = juce::jmax (e, v.env);
    return e;
}

juce::String warpGlyph (const juce::String& k)
{
    static const std::map<juce::String, juce::String> g {
        { "off", "M2 7 H16" }, { "bend", "M2 12 C9 12,9 2,16 2" }, { "sync", "M2 12 L7 3 L7 12 L12 3 L12 12 L16 6" }, { "pwm", "M2 3 H6 V12 H16" },
        { "fold", "M2 12 L5 3 L8 9 L11 3 L14 9 L16 3" }, { "mirror", "M2 12 L9 3 L16 12" }, { "asym", "M2 12 C4 2,6 2,8 7 L16 9" },
        { "quant", "M2 12 H5 V9 H8 V6 H11 V3 H16" }, { "fm", "M2 7 C3 1,4 1,5 7 S6 13,7 7 S9 1,10 7 S13 13,16 7" },
    };
    auto it = g.find (k);
    return it == g.end() ? g.at ("off") : it->second;
}

juce::String ofxGlyphPath (const juce::String& k)
{
    static const std::map<juce::String, juce::String> g {
        { "off", "M2 7 H16" }, { "chorus", "M2 5 C5 1,7 1,9 5 S13 9,16 5 M2 10 C5 6,7 6,9 10 S13 14,16 10" },
        { "crush", "M2 12 V9 H5 V5 H8 V3 H11 V6 H14 V10 H16" }, { "drive", "M2 12 C4 12,5 3,8 3 H11 C13 3,13 12,16 12" },
        { "delay", "M3 3 V11 M7 4.5 V9.5 M11 5.5 V8.5 M15 6.3 V7.7" }, { "phaser", "M2 7 C4 2,6 12,8 7 S12 2,16 7" },
        { "ring", "M2 7 C3 2,4 2,5 7 S7 12,8 7 S10 2,11 7 S13 12,14 7 S15 2,16 7" }, { "comb", "M2 4 L4 12 L6 4 L8 12 L10 4 L12 12 L14 4 L16 12" },
    };
    auto it = g.find (k);
    return it == g.end() ? g.at ("off") : it->second;
}

juce::var modsOut (const Model& m)
{
    juce::Array<juce::var> rows;
    for (const auto& r : m.mods)
    {
        auto* o = new juce::DynamicObject();
        o->setProperty ("src", r.src);
        o->setProperty ("dst", r.dst);
        o->setProperty ("amt", r.amt);
        o->setProperty ("curve", r.curve.isEmpty() ? juce::String ("lin") : r.curve);
        o->setProperty ("via", r.via.isEmpty() ? juce::var() : juce::var (r.via));
        o->setProperty ("on", !r.off);
        rows.add (juce::var (o));
    }
    return rows;
}

void modsIn (Model& m, const juce::var& rows)
{
    m.mods.clear();
    if (auto* a = rows.getArray())
        for (const auto& r : *a)
        {
            Model::Mod x;
            x.src = r["src"].toString();
            x.dst = r["dst"].toString();
            x.amt = (float) (double) r["amt"];
            x.curve = r["curve"].isString() ? r["curve"].toString() : juce::String ("lin");
            x.via = r["via"].isString() ? r["via"].toString() : juce::String();
            x.off = r["on"].isBool() && !(bool) r["on"];
            m.mods.push_back (x);
        }
}
} // namespace wave
