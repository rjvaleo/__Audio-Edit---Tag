#include "WaveBoardKit.h"

#include "Face.h"
#include "Host.h"

namespace board
{
namespace
{
float num (const juce::var& v, float f = 0) { return v.isVoid() || v.isUndefined() ? f : (float) (double) v; }
bool has (const juce::var& o, const juce::String& k) { return o.getDynamicObject() != nullptr && o.getDynamicObject()->hasProperty (k); }
const juce::String minus = juce::String::fromUTF8 ("\xe2\x88\x92");
} // namespace

Kit& Kit::get()
{
    static Kit k = [] {
        Kit kit;
        kit.data = juce::JSON::parse (face::embeddedFile ("wave-board-data.json.gz"));
        kit.rack = juce::JSON::parse (juce::String (naText ([] (char* b, uint32_t c) { return na_fx_kinds (b, c); })));
        if (auto* ss = kit.rack["suites"].getArray())
            for (auto& s : *ss)
                if (auto* fs = s["families"].getArray())
                    for (auto& f : *fs)
                        if (auto* ms = f["modes"].getArray())
                            for (auto& m : *ms)
                                kit.rackLabel[m["id"].toString()] = m["label"].toString();
        return kit;
    }();
    return k;
}

void Kit::setFx (const juce::var& list)
{
    fx = list;
    byKind.clear();
    if (auto* a = list.getArray())
        for (auto& f : *a)
            byKind[f["kind"].toString()] = f;
}

const juce::var* node (const juce::var& b, const juce::String& id)
{
    if (auto* ns = b["nodes"].getArray())
        for (auto& n : *ns)
            if (n["id"].toString() == id)
                return &n;
    return nullptr;
}

bool isIO (const juce::var& n) { return n["kind"].toString().startsWith ("in:") || n["kind"].toString() == "out"; }
bool isFx (const juce::var& n) { return n["kind"].toString().startsWith ("fx:") || n["kind"].toString() == "wave:drive"; }

static const juce::var* fxOf (const juce::var& n)
{
    auto& k = Kit::get();
    auto it = k.byKind.find (n["kind"].toString());
    return it == k.byKind.end() ? nullptr : &it->second;
}

juce::String cat (const juce::var& n)
{
    if (n["kind"].toString() == "wave:drive")
        return "distortion";
    auto* f = fxOf (n);
    return f != nullptr && (*f)["category"].isString() ? (*f)["category"].toString() : juce::String ("utility");
}

juce::String inputName (const juce::String& kind)
{
    if (auto* a = Kit::get().data["inputs"].getArray())
        for (auto& i : *a)
            if (i[0].toString() == kind)
                return i[1].toString();
    return kind;
}

juce::Colour inputColour (const juce::String& kind)
{
    if (auto* a = Kit::get().data["inputs"].getArray())
        for (auto& i : *a)
            if (i[0].toString() == kind)
                return c2d::css (i[2].toString());
    return c2d::css ("#e8eaee");
}

juce::String inputAbout (const juce::String& kind)
{
    if (auto* a = Kit::get().data["inputs"].getArray())
        for (auto& i : *a)
            if (i[0].toString() == kind)
                return i[3].toString();
    return {};
}

juce::String name (const juce::var& n)
{
    const auto kind = n["kind"].toString();
    if (kind.startsWith ("in:"))
        return inputName (kind);
    if (kind == "out")
        return "Out";
    if (kind == "wave:drive")
        return "Drive";
    const auto& routing = Kit::get().data["routing"];
    if (has (routing, kind))
        return routing[juce::Identifier (kind)]["n"].toString();
    if (kind.startsWith ("fx:"))
    {
        auto& rl = Kit::get().rackLabel;
        if (auto it = rl.find (kind.substring (3)); it != rl.end())
            return it->second;
    }
    auto* f = fxOf (n);
    return (f != nullptr ? (*f)["label"].toString() : kind.substring (3)).replace ("Hyperprism ", "");
}

juce::String maker (const juce::var& n)
{
    if (n["kind"].toString() == "wave:drive")
        return "MGL";
    auto* f = fxOf (n);
    return f != nullptr && (*f)["suite"].toString().isNotEmpty() ? (*f)["suite"].toString() : juce::String ("MGL");
}

juce::String catName (const juce::String& c) { return c.isEmpty() ? c : c.substring (0, 1).toUpperCase() + c.substring (1); }

static std::pair<float, float> catHS (const juce::String& c)
{
    const auto& hue = Kit::get().data["catHue"];
    if (!has (hue, c) || (float) (double) hue[juce::Identifier (c)] < 0)
        return { 220.0f, 8.0f };
    return { (float) (double) hue[juce::Identifier (c)], c == "granular" ? 38.0f : 42.0f };
}

juce::Colour catCol (const juce::String& c, float l, float a)
{
    const auto [h, s] = catHS (c);
    return c2d::css ("hsla(" + juce::String (h) + "," + juce::String (s) + "%," + juce::String (l) + "%," + juce::String (a) + ")");
}

juce::String catRGB (const juce::String& c, float l)
{
    const auto hs = catHS (c);
    const float h = hs.first, s0 = hs.second;
    const float s = juce::jmin (100.0f, s0 + 16) / 100, L = l / 100;
    auto k = [h] (float n) { return std::fmod (n + h / 30, 12.0f); };
    const float a = s * juce::jmin (L, 1 - L);
    auto f = [&] (float n) { return L - a * juce::jmax (-1.0f, juce::jmin (k (n) - 3, juce::jmin (9 - k (n), 1.0f))); };
    return juce::String (juce::roundToInt (f (0) * 255)) + "," + juce::String (juce::roundToInt (f (8) * 255)) + "," + juce::String (juce::roundToInt (f (4) * 255));
}

juce::Colour nodeCol (const juce::var& n, const wave::Cl& cl)
{
    const auto kind = n["kind"].toString();
    if (isFx (n))
        return catCol (cat (n), 64);
    if (kind.startsWith ("in:"))
        return inputColour (kind);
    if (kind == "out")
        return cl.acc;
    return cl.t2;
}

juce::Colour familyColour (const juce::String& kind)
{
    auto re = [&] (std::initializer_list<const char*> ws) {
        for (auto* w : ws)
            if (kind.contains (w))
                return true;
        return false;
    };
    if (kind == "eq")
        return c2d::css ("#ff8a3d");
    if (kind == "comp")
        return c2d::css ("#ffb547");
    const auto bare = kind.fromFirstOccurrenceOf ("prism:", false, false).isEmpty() ? kind : kind.fromFirstOccurrenceOf ("prism:", false, false);
    for (auto* u : { "gain", "utility", "width", "dc", "invert", "swap", "fit" })
        if (bare == u)
            return c2d::css ("#c9d3dd");
    if (re ({ "pn_noise", "pn-noise", "single_bit", "single-bit" }))
        return c2d::css ("#7bd88f");
    if (re ({ "reverb", "plate", "diffuser" }))
        return c2d::css ("#2fd4c2");
    if (re ({ "chorus", "flanger", "vibrato", "leslie", "phaser", "ring" }))
        return c2d::css ("#b07cff");
    if (re ({ "harmon", "detune", "doubler", "doppler", "boomerang" }))
        return c2d::css ("#ff5fa2");
    if (re ({ "notch", "resonator", "regalia", "chamberlin", "filter", "damping", "rappify" }))
        return c2d::css ("#ff8a3d");
    if (re ({ "gate", "maxim" }))
        return c2d::css ("#ffb547");
    return c2d::css ("#19b4ff");
}

int portCount (const juce::var& n)
{
    const auto& p = n["params"];
    const auto k = n["kind"].toString() == "split" ? p["outs"] : p["ins"];
    return k.isVoid() ? 2 : juce::roundToInt ((float) (double) k);
}

juce::Array<juce::var> spec (const juce::var& n)
{
    const auto kind = n["kind"].toString();
    const auto& kp = Kit::get().data["kindParams"];
    auto list = [] (const juce::var& a) { juce::Array<juce::var> o; if (auto* x = a.getArray()) o = *x; return o; };
    if (kind.startsWith ("in:"))
        return list (kp["input"]);
    if (kind == "mix")
    {
        auto all = list (kp["mix"]);
        all.removeRange (portCount (n), all.size());
        return all;
    }
    if (has (kp, kind))
        return list (kp[juce::Identifier (kind)]);
    if (kind == "split" || kind == "out")
        return {};
    if (auto* f = fxOf (n))
        return list ((*f)["params"]);
    juce::Array<juce::var> o;
    if (auto* ps = n["params"].getDynamicObject())
        for (auto& pr : ps->getProperties())
        {
            auto* d = new juce::DynamicObject();
            const float v = (float) (double) pr.value;
            d->setProperty ("key", pr.name.toString());
            d->setProperty ("label", pr.name.toString());
            d->setProperty ("min", juce::jmin (0.0f, v));
            d->setProperty ("max", juce::jmax (1.0f, std::abs (v) * 2));
            d->setProperty ("default", v);
            d->setProperty ("unit", "");
            o.add (juce::var (d));
        }
    return o;
}

const juce::var* paramOf (const juce::var& n, const juce::String& key, juce::Array<juce::var>* keep)
{
    static thread_local juce::Array<juce::var> held;
    auto& store = keep != nullptr ? *keep : held;
    store = spec (n);
    for (auto& p : store)
        if (p["key"].toString() == key)
            return &p;
    return nullptr;
}

juce::Array<juce::var> facePr (const juce::var& n)
{
    const auto sp = spec (n);
    const auto& face = Kit::get().data["face"][juce::Identifier (n["kind"].toString())];
    juce::StringArray keys;
    if (auto* f = face.isArray() && face.size() > 0 ? face[0].getArray() : nullptr)
        for (auto& k : *f)
            keys.add (k.toString());
    else
        for (int i = 0; i < juce::jmin (3, sp.size()); ++i)
            keys.add (sp[i]["key"].toString());
    juce::Array<juce::var> out;
    for (auto& k : keys)
        for (auto& p : sp)
            if (p["key"].toString() == k && !p["choices"].isArray() && !(bool) p["toggle"])
                out.add (p);
    return out;
}

static bool plog (const juce::var& p) { return (bool) p["log"] && num (p["min"]) > 0; }

float pn (const juce::var& p, float v)
{
    const float mn = num (p["min"]), mx = num (p["max"]);
    return juce::jlimit (0.0f, 1.0f, plog (p) ? std::log (v / mn) / std::log (mx / mn) : (v - mn) / (std::abs (mx - mn) > 0 ? mx - mn : 1));
}

float pv (const juce::var& p, float u)
{
    u = juce::jlimit (0.0f, 1.0f, u);
    const float mn = num (p["min"]), mx = num (p["max"]);
    const float v = plog (p) ? mn * std::pow (mx / mn, u) : mn + (mx - mn) * u;
    return !p["step"].isVoid() || p["choices"].isArray() || (bool) p["toggle"] ? std::round (v) : v;
}

bool pbip (const juce::var& p) { return num (p["min"]) < 0 && std::abs (num (p["min"]) + num (p["max"])) < 1e-6f; }

float pval (const juce::var& n, const juce::var& p)
{
    const auto& v = n["params"][juce::Identifier (p["key"].toString())];
    return v.isDouble() || v.isInt() ? (float) (double) v : num (p["default"]);
}

juce::String fmtP (const juce::var& p, float v, bool c)
{
    if (auto* ch = p["choices"].getArray())
        return ch->getReference (juce::jlimit (0, ch->size() - 1, juce::roundToInt (v - num (p["min"])))).toString();
    if ((bool) p["toggle"])
        return v >= 0.5f ? "On" : "Off";
    const auto u = p["unit"].toString(), sp = juce::String (c ? "" : " "), sg = v < -1e-9f ? minus : juce::String();
    const float a = std::abs (v);
    auto nm = [c] (float x) { return x >= 100 || (c && x >= 10) ? juce::String (juce::roundToInt (x)) : x >= 10 ? juce::String (x, 1) : juce::String (x, 2); };
    if (p["key"].toString() == "pan")
        return juce::roundToInt (v) == 0 ? juce::String ("C") : juce::String (v < 0 ? "L" : "R") + juce::String (std::abs (juce::roundToInt (v)));
    if (u == "ms")
        return a >= 1000 ? sg + juce::String (a / 1000, 2) + sp + "s" : sg + (a >= 10 ? juce::String (juce::roundToInt (a)) : juce::String (a, 1)) + sp + "ms";
    if (u == "Hz")
        return a >= 1000 ? juce::String (a / 1000, a >= 10000 ? 1 : 2) + (c ? "k" : " kHz") : (a >= 100 ? juce::String (juce::roundToInt (a)) : a >= 10 ? juce::String (a, 1) : juce::String (a, 2)) + sp + "Hz";
    if (u == "dB")
        return v <= -79.5f ? juce::String ("off") : (v > 0.05f ? juce::String ("+") : sg) + (a >= 10 ? juce::String (juce::roundToInt (a)) : juce::String (a, 1)) + sp + "dB";
    if (u == "%")
        return juce::String (juce::roundToInt (v)) + "%";
    if (u == "s")
        return juce::String (v, 2) + sp + "s";
    if (u == ":1")
        return juce::String (v, 1) + ":1";
    if (u == "x" || u == juce::String::fromUTF8 ("\xc3\x97"))
        return juce::String (v, 2) + juce::String::fromUTF8 ("\xc3\x97");
    if (u == juce::String::fromUTF8 ("\xc2\xb0"))
        return juce::String (juce::roundToInt (v)) + juce::String::fromUTF8 ("\xc2\xb0");
    if (u == "st")
        return (v > 0.05f ? juce::String ("+") : sg) + juce::String (a, 1) + sp + "st";
    if (u == "ct")
        return juce::String (juce::roundToInt (v)) + sp + "ct";
    if (u == "oct")
        return juce::String (v, 1) + sp + "oct";
    if (u == "m/s")
        return sg + juce::String (juce::roundToInt (a)) + sp + "m/s";
    if (u == "Hz/s")
        return sg + juce::String (juce::roundToInt (a)) + (c ? "" : " Hz/s");
    if (u == "bits")
        return (a >= 10 ? juce::String (juce::roundToInt (a)) : juce::String (a, 1)) + (c ? "b" : " bits");
    if (u == "samples" || u == "smp")
        return (c ? juce::String (juce::roundToInt (a)) : nm (a)) + sp + "smp";
    if (u.isEmpty())
    {
        if (!p["step"].isVoid())
            return juce::String (juce::roundToInt (v));
        if (num (p["max"]) <= 1.0001f && num (p["min"]) >= -1.0001f)
            return (v < -0.005f ? minus : juce::String()) + juce::String (juce::roundToInt (a * 100)) + "%";
        return sg + nm (a);
    }
    return sg + nm (a) + sp + u;
}

juce::String fitLab (const juce::String& l, float wd, const juce::Font& f)
{
    auto w = [&] (const juce::String& s) { return juce::GlyphArrangement::getStringWidth (f, s); };
    if (w (l) <= wd)
        return l;
    const auto& ab = Kit::get().data["abbr"];
    if (has (ab, l) && w (ab[juce::Identifier (l)].toString()) <= wd)
        return ab[juce::Identifier (l)].toString();
    auto parts = juce::StringArray::fromTokens (l, " ", "");
    for (auto& s : parts)
        if (has (ab, s))
            s = ab[juce::Identifier (s)].toString();
    const auto r = parts.joinIntoString (" ");
    return w (r) <= wd ? r : parts[0];
}

juce::StringArray inPorts (const juce::var& n)
{
    const auto k = n["kind"].toString();
    if (k.startsWith ("in:"))
        return {};
    if (k == "mix")
    {
        juce::StringArray o;
        for (int i = 0; i < portCount (n); ++i)
            o.add ("i" + juce::String (i));
        return o;
    }
    if (k == "drywet")
        return { "i", "ret" };
    return { "i" };
}

juce::StringArray outPorts (const juce::var& n)
{
    const auto k = n["kind"].toString();
    if (k == "out")
        return {};
    if (k == "split")
    {
        juce::StringArray o;
        for (int i = 0; i < portCount (n); ++i)
            o.add ("o" + juce::String (i));
        return o;
    }
    if (k == "drywet")
        return { "send", "o" };
    return { "o" };
}

juce::StringArray deps (const juce::var& n, const juce::String& op)
{
    if (n["kind"].toString() == "drywet")
        return op == "send" ? juce::StringArray { "i" } : juce::StringArray { "i", "ret" };
    return inPorts (n);
}

juce::String mainIn (const juce::var& n) { return n["kind"].toString() == "mix" ? "i0" : "i"; }
juce::String mainOut (const juce::var& n) { return n["kind"].toString() == "split" ? "o0" : "o"; }

juce::String portName (const juce::var& n, const juce::String& p)
{
    const auto k = n["kind"].toString();
    if (k == "mix")
        return "In " + juce::String (p.substring (1).getIntValue() + 1);
    if (k == "split")
        return "Out " + juce::String::charToString ((juce::juce_wchar) ('A' + p.substring (1).getIntValue()));
    return p == "send" ? "Send" : p == "ret" ? "Return" : p == "o" ? "Out" : "In";
}

float nodeW (const juce::var& n) { return isIO (n) ? 104.0f : 152.0f; }

float nodeH (const juce::var& n)
{
    if (isIO (n))
        return 58;
    if (isFx (n))
        return 136;
    const auto k = n["kind"].toString();
    if (k == "split")
        return 38 + (float) portCount (n) * 14 + 8;
    if (k == "mix")
        return 38 + (float) portCount (n) * 26 + 8;
    return k == "drywet" ? 94.0f : 80.0f;
}

float pinY (const juce::var& n, const juce::String& port)
{
    if (isIO (n))
        return 38;
    if (isFx (n))
        return 58;
    const int k = portCount (n);
    const auto kind = n["kind"].toString();
    if (kind == "split")
        return port == "i" ? 38 + (float) k * 7 : 45 + 14 * (float) port.substring (1).getIntValue();
    if (kind == "mix")
        return port == "o" ? 38 + (float) k * 13 : 51 + 26 * (float) port.substring (1).getIntValue();
    if (kind == "drywet")
        return port == "i" || port == "send" ? 50.0f : 74.0f;
    return 55;
}

juce::Point<float> pinXY (const juce::var& n, const juce::String& port, bool out)
{
    return { num (n["x"]) + (out ? nodeW (n) : 0), num (n["y"]) + 1 + pinY (n, port) };
}

bool inputLive (const wave::Model& m, const juce::String& kind)
{
    static const std::map<juce::String, juce::String> k { { "in:osc0", "osc0.on" }, { "in:osc1", "osc1.on" }, { "in:osc2", "osc2.on" }, { "in:sub", "sub.on" }, { "in:noise", "noise.on" } };
    auto it = k.find (kind);
    return it == k.end() || m.g (it->second) >= 0.5f;
}

Origins origins (const juce::var& b, const wave::Model& m, const juce::String& nid, const juce::String& op, Memo& memo)
{
    const auto key = nid + "." + op;
    if (auto it = memo.m.find (key); it != memo.m.end())
        return it->second;
    memo.m[key] = {};
    Origins s;
    const auto* n = node (b, nid);
    if (n == nullptr)
        return s;
    const auto kind = (*n)["kind"].toString();
    if (kind.startsWith ("in:"))
    {
        if (!((*n)["on"].isBool() && !(bool) (*n)["on"]) && inputLive (m, kind))
            s.insert (kind);
        return memo.m[key] = s;
    }
    if (auto* cs = b["cables"].getArray())
        for (const auto& ip : deps (*n, op))
            for (auto& c : *cs)
                if (c["to"][0].toString() == nid && c["to"][1].toString() == ip)
                    for (auto& x : origins (b, m, c["from"][0].toString(), c["from"][1].toString(), memo))
                        s.insert (x);
    return memo.m[key] = s;
}

Origins inOrigins (const juce::var& b, const wave::Model& m, const juce::var& n, Memo& memo)
{
    Origins s;
    if (auto* cs = b["cables"].getArray())
        for (auto& c : *cs)
            if (c["to"][0].toString() == n["id"].toString())
                for (auto& x : origins (b, m, c["from"][0].toString(), c["from"][1].toString(), memo))
                    s.insert (x);
    return s;
}

juce::Colour originCol (const Origins& s, bool& any)
{
    any = !s.empty();
    if (s.size() == 1)
        return inputColour (*s.begin());
    return c2d::css ("#e8eaee");
}

bool reaches (const juce::var& b, const juce::String& nid, const juce::String& ip, const juce::String& tid, const juce::String& top, std::set<juce::String>& seen)
{
    const auto* n = node (b, nid);
    if (n == nullptr)
        return false;
    for (const auto& op : outPorts (*n))
    {
        if (!deps (*n, op).contains (ip))
            continue;
        if (nid == tid && op == top)
            return true;
        const auto k = nid + "." + op;
        if (!seen.insert (k).second)
            continue;
        if (auto* cs = b["cables"].getArray())
            for (auto& c : *cs)
                if (c["from"][0].toString() == nid && c["from"][1].toString() == op && reaches (b, c["to"][0].toString(), c["to"][1].toString(), tid, top, seen))
                    return true;
    }
    return false;
}

std::vector<Step> mainPath (const juce::var& b, bool& ok)
{
    std::vector<Step> st;
    std::set<juce::String> seen;
    const juce::var* n = nullptr;
    if (auto* ns = b["nodes"].getArray())
        for (auto& x : *ns)
            if (x["kind"].toString() == "in:voice")
                n = &x;
    juce::String inP;
    while (n != nullptr && seen.insert ((*n)["id"].toString()).second)
    {
        const auto op = (*n)["kind"].toString() == "out" ? juce::String() : mainOut (*n);
        st.push_back ({ (*n)["id"].toString(), inP, op });
        if (op.isEmpty())
            break;
        const juce::var* next = nullptr;
        if (auto* cs = b["cables"].getArray())
            for (auto& c : *cs)
                if (next == nullptr && c["from"][0].toString() == (*n)["id"].toString() && c["from"][1].toString() == op && seen.count (c["to"][0].toString()) == 0)
                {
                    next = node (b, c["to"][0].toString());
                    inP = c["to"][1].toString();
                }
        n = next;
    }
    ok = !st.empty() && node (b, st.back().id) != nullptr && (*node (b, st.back().id))["kind"].toString() == "out";
    return st;
}

// wvChainLayout, flattened: the effects in the order the chain reads them,
// then those not connected.
juce::StringArray chainIds (const juce::var& b)
{
    std::map<juce::String, juce::StringArray> edges;
    std::map<juce::String, const juce::var*> by;
    if (auto* ns = b["nodes"].getArray())
        for (auto& n : *ns)
            by[n["id"].toString()] = &n, edges[n["id"].toString()] = {};
    if (auto* cs = b["cables"].getArray())
        for (auto& c : *cs)
        {
            const auto a = c["from"][0].toString(), t = c["to"][0].toString();
            if (edges.count (a) > 0 && by.count (t) > 0 && !edges[a].contains (t))
                edges[a].add (t);
        }
    std::set<juce::String> reached, emitted;
    auto distances = [&] (const juce::String& start, const std::set<juce::String>& blocked) {
        std::map<juce::String, int> found;
        std::vector<std::pair<juce::String, int>> q { { start, 0 } };
        for (size_t i = 0; i < q.size(); ++i)
        {
            const auto [id, d] = q[i];
            if (by.count (id) == 0 || blocked.count (id) > 0 || found.count (id) > 0)
                continue;
            found[id] = d;
            for (auto& nx : edges[id])
                q.push_back ({ nx, d + 1 });
        }
        return found;
    };
    auto meeting = [&] (const juce::StringArray& starts, const std::set<juce::String>& blocked) -> juce::String {
        std::vector<std::map<juce::String, int>> maps;
        for (auto& s : starts)
            maps.push_back (distances (s, blocked));
        juce::String best;
        int bestCost = 1 << 30;
        for (auto& [id, d0] : maps[0])
        {
            int cost = 0;
            bool all = true;
            for (auto& m : maps)
            {
                auto it = m.find (id);
                if (it == m.end())
                {
                    all = false;
                    break;
                }
                cost += it->second;
            }
            juce::ignoreUnused (d0);
            if (all && cost < bestCost)
                bestCost = cost, best = id;
        }
        return best;
    };
    juce::StringArray out;
    std::function<void (const juce::String&, const juce::String&, std::set<juce::String>)> walk = [&] (juce::String id, const juce::String& stop, std::set<juce::String> anc) {
        while (by.count (id) > 0 && id != stop && anc.count (id) == 0)
        {
            anc.insert (id);
            reached.insert (id);
            const auto& n = *by[id];
            if (isFx (n) && emitted.insert (id).second)
                out.add (id);
            if (n["kind"].toString() == "out")
                break;
            juce::StringArray next;
            for (auto& x : edges[id])
                if (anc.count (x) == 0)
                    next.add (x);
            if (next.size() < 2)
            {
                if (next.isEmpty())
                    break;
                id = next[0];
                continue;
            }
            const auto join = meeting (next, anc);
            for (auto& p : next)
                walk (p, join, anc);
            if (join.isEmpty())
                break;
            id = join;
        }
    };
    for (auto& [id, n] : by)
        if ((*n)["kind"].toString() == "in:voice")
            walk (id, {}, {});
    for (auto& [id, n] : by)
        if ((*n)["kind"].toString().startsWith ("in:") && (*n)["kind"].toString() != "in:voice" && !edges[id].isEmpty())
            walk (id, {}, {});
    if (auto* ns = b["nodes"].getArray())
        for (auto& n : *ns)
            if (isFx (n) && reached.count (n["id"].toString()) == 0)
                out.add (n["id"].toString());
    return out;
}

juce::String cabPath (float x1, float y1, float x2, float y2, juce::Path& p)
{
    p.clear();
    const float dx = x2 - x1;
    p.startNewSubPath (x1, y1);
    if (dx > 24)
    {
        const float c = juce::jmax (24.0f, dx * 0.45f);
        p.cubicTo (x1 + c, y1, x2 - c, y2, x2, y2);
        return {};
    }
    const float sy = juce::jmax (y1, y2) + juce::jmin (120.0f, 40 + std::abs (dx) * 0.12f), c = 36, mx = (x1 + x2) / 2;
    p.cubicTo (x1 + c, y1, x1 + c, sy, mx, sy);
    // S: the first control point mirrors the last one's.
    p.cubicTo (mx + (mx - (x1 + c)), sy, x2 - c, y2, x2, y2);
    return {};
}
} // namespace board
