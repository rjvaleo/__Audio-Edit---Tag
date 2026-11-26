#include "GrainFace.h"

#include "Canvas2D.h"
#include "Host.h"
#include "Places.h"

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

// JS's Math.round and toFixed, as the page writes its readings.
double jsRound (double v) { return std::floor (v + 0.5); }
juce::String fixed (double v, int places)
{
    const double p = std::pow (10.0, places);
    double r = std::floor (std::abs (v) * p + 0.5) / p;
    auto s = juce::String (r, places);
    if (v < 0 && r != 0)
        s = "-" + s;
    return s;
}
juce::String rnd (double v) { return juce::String ((int64_t) jsRound (v)); }

juce::var obj() { return juce::var (new juce::DynamicObject()); }
void put (juce::var& o, const juce::Identifier& k, const juce::var& v)
{
    if (auto* d = o.getDynamicObject())
        d->setProperty (k, v);
}

juce::var deepCopy (const juce::var& v)
{
    return juce::JSON::parse (juce::JSON::toString (v, true));
}

double clamp01 (double v) { return juce::jlimit (0.0, 1.0, v); }

const char* const engineIds[] = { "wsola", "vocoder", "pvsola", "hybrid", "granular", "soundhack" };
const juce::String lfoColours[] = { "#5cc8e6", "#a48cf2", "#ee72a8", "#9bd36c" };
const char* const lfoShapes[] = { "sine", "tri", "up", "down", "square", "steps", "smooth" };
const char* const divisions[] = { "8 bars", "4 bars", "2 bars", "1 bar", "1/2", "1/4", "1/8", "1/16", "1/32" };
const double divBeats[] = { 32, 16, 8, 4, 2, 1, 0.5, 0.25, 0.125 };
// The computer's keys, from the tonic (NOTE_KEYS).
const char noteKeys[] = "awsedftgyhujkolp;'";
} // namespace

// ─────────────────────────────────────────────────────────────── building

GrainFace::GrainFace (Call c, uint32_t i)
    : call (std::move (c)), id (i), captured (face::page ("grain"))
{
    data = juce::JSON::parse (face::embeddedFile ("grain-page.json"));
    vars = captured["engines"]["wsola"]["vars"];
    setSize (1388, 990);
    setWantsKeyboardFocus (true);
    velText = uni ("vel \xe2\x80\x94");

    // Every control, as the page's table has it.
    if (auto* o = data["controls"].getDynamicObject())
        for (const auto& p : o->getProperties())
        {
            const auto& v = p.value;
            Ctl ct;
            ct.k = p.name.toString();
            ct.label = v["label"].toString();
            ct.at = v["at"].toString();
            ct.key = v["key"].toString();
            ct.facet = v["facet"].toString();
            ct.full = v["full"].toString();
            ct.min = dnum (v["min"]);
            ct.max = dnum (v["max"], 1);
            ct.d = dnum (v["d"]);
            ct.log = (bool) v["log"];
            ct.bip = (bool) v["bip"];
            ct.sw = (bool) v["sw"];
            ct.odd = (bool) v["odd"];
            ct.moves = (bool) v["moves"];
            ct.scaleStep = v["step"].toString() == "scale";
            ct.step = ct.scaleStep ? 0 : dnum (v["step"]);
            if (!v["detent"].isVoid())
                ct.detent = dnum (v["detent"]);
            if (auto* s = v["seg"].getArray())
                for (const auto& x : *s)
                    ct.seg.add (x.toString());
            if (auto* s = v["vals"].getArray())
                for (const auto& x : *s)
                    ct.vals.add (x.toString());
            ctls[ct.k] = ct;
            ctlOrder.push_back (ct.k);
        }

    // The pages: one per engine, the effects view, the lit one.
    for (auto* e : engineIds)
    {
        auto p = std::make_unique<face::Chrome> (captured["engines"][e]);
        index (captured["engines"][e]["tree"], pageNodes[e]);
        addChildComponent (*p);
        pages[e] = std::move (p);
    }
    {
        auto p = std::make_unique<face::Chrome> (captured["fx"]);
        index (captured["fx"]["tree"], pageNodes["fx"]);
        // The rack's cards are drawn live (FxCard), the ADD card after them.
        for (const char* k : { "fxModuleRail", "gsFxAddCard" })
            if (pageNodes["fx"].ids.count (k) > 0)
                p->skip.insert (pageNodes["fx"].ids[k].i);
        addChildComponent (*p);
        pages["fx"] = std::move (p);
    }
    lit = std::make_unique<face::Chrome> (captured["lit"]);
    index (captured["lit"]["tree"], litNodes);

    // Looks: a switch on and off, a choice's part on and off.
    auto firstOf = [this] (const juce::var& tree, std::function<bool (const juce::var&)> want) -> juce::var {
        juce::var found;
        std::function<void (const juce::var&)> go = [&] (const juce::var& n) {
            if (!found.isVoid())
                return;
            if (want (n))
            {
                found = n;
                return;
            }
            if (auto* k = n["kids"].getArray())
                for (const auto& kid : *k)
                    go (kid);
        };
        go (tree);
        return found;
    };
    const auto& plain = captured["engines"]["wsola"]["tree"];
    tgOn = firstOf (captured["lit"]["tree"], [] (const juce::var& n) { return hasClass (n, "gs-tg") && hasClass (n, "on"); });
    tgOff = firstOf (plain, [] (const juce::var& n) { return hasClass (n, "gs-tg") && !hasClass (n, "on"); });
    segOn = firstOf (plain, [] (const juce::var& n) { return n["tag"].toString() == "span" && hasClass (n, "on") && n["text"].isArray() && n["text"][0]["text"].toString() == "best"; });
    segOff = firstOf (plain, [] (const juce::var& n) { return n["tag"].toString() == "span" && n["text"].isArray() && n["text"][0]["text"].toString() == "worst"; });
    mapOn = firstOf (captured["lit"]["tree"], [] (const juce::var& n) { return n["id"].toString() == "gsLmap0"; });

    // Left out of every page: what the face draws itself.
    for (auto& [name, page] : pages)
    {
        auto& p = pageNodes[name];
        for (const auto& [k, b] : p.bars)
            page->skip.insert (b.i);
        for (const char* k : { "gsSndName", "gsRegChip", "gsLoopChip", "gsCzRo", "gsCloudRo", "gsAmpRo", "gsOctRo", "gsVelRo", "gsSeedRo",
                               "gsMeta", "gsVoicesRo", "gsLength", "gsFollow", "gsRunBtn", "gsTuneBtn", "gsKbScale" })
            if (p.ids.count (k) > 0)
            {
                if (juce::String (k) == "gsRegChip" || juce::String (k) == "gsLoopChip" || juce::String (k) == "gsFollow" || juce::String (k) == "gsRunBtn")
                    page->skip.insert (p.ids[k].i);
                else
                {
                    std::function<void (const juce::var&)> all = [&] (const juce::var& n) {
                        page->skipText.insert ((int) n["i"]);
                        if (auto* kk = n["kids"].getArray())
                            for (const auto& x : *kk)
                                all (x);
                    };
                    all (p.ids[k].n);
                }
            }
        // The segments the face lights, the knobs' rings and readings, the
        // LFOs' map buttons and targets, the bend's range, the preset names.
        std::function<void (const juce::var&, bool)> leave = [&] (const juce::var& n, bool inSeg) {
            const auto nid = n["id"].toString();
            const bool seg = nid.startsWith ("gsLshp") || nid.startsWith ("gsLmode") || nid.startsWith ("gsLsync") || nid == "gsVmode" || nid == "gsAB";
            if (inSeg && (n["tag"].toString() == "span" || n["tag"].toString() == "button"))
                page->skip.insert ((int) n["i"]);
            if (hasClass (n, "ui-ring") || hasClass (n, "ui-kval") || nid.startsWith ("gsLmap") || nid.startsWith ("gsLtg") || hasClass (n, "pbar-nm"))
                page->skip.insert ((int) n["i"]);
            if (nid == "gsBendLab")
                if (auto* k = n["kids"].getArray())
                    for (const auto& kid : *k)
                        if (kid["tag"].toString() == "b")
                            page->skipText.insert ((int) kid["i"]);
            if (nid == "gsFxStrip")
                page->skip.insert ((int) n["i"]);
            if (auto* k = n["kids"].getArray())
                for (const auto& kid : *k)
                    leave (kid, seg || (inSeg && n["tag"].toString() != "span"));
        };
        leave (name == "fx" ? captured["fx"]["tree"] : captured["engines"][juce::Identifier (name)]["tree"], false);
    }

    buildLayers();
    reload();
    startTimerHz (30);
}

GrainFace::~GrainFace()
{
    stopTimer();
}

void GrainFace::index (const juce::var& n, Page& p)
{
    const auto key = n["id"].toString();
    const auto r = rectOf (n["rect"]);
    if (key.isNotEmpty())
        p.ids[key] = { (int) n["i"], r, n };
    const auto k = n["data"]["k"].toString();
    if (k.isNotEmpty() && hasClass (n, "gs-bc"))
        p.bars[k] = { (int) n["i"], r, n };
    const auto e = n["data"]["e"].toString();
    if (e.isNotEmpty() && hasClass (n, "gs-tab"))
        p.tabs[e] = { (int) n["i"], r, n };
    if (auto* kids = n["kids"].getArray())
        for (const auto& kid : *kids)
            index (kid, p);
}

const juce::var* GrainFace::child (const juce::var& n, const juce::String& cls) const
{
    if (auto* kids = n["kids"].getArray())
        for (const auto& k : *kids)
        {
            if (juce::StringArray::fromTokens (k["cls"].toString(), " ", "").contains (cls) || k["tag"].toString() == cls)
                return &k;
            if (auto* deeper = child (k, cls))
                return deeper;
        }
    return nullptr;
}

GrainFace::Page& GrainFace::cur()
{
    return pageNodes[fxView ? juce::String ("fx") : engine];
}

const GrainFace::Page& GrainFace::cur() const
{
    auto it = pageNodes.find (fxView ? juce::String ("fx") : engine);
    return it != pageNodes.end() ? it->second : pageNodes.begin()->second;
}

juce::Colour GrainFace::ink (const juce::String& token, const juce::String& fallback) const
{
    const auto& cl = captured["cl"];
    const auto s = cl[juce::Identifier (token)].toString();
    return c2d::css (s.isEmpty() ? fallback : s);
}

GrainFace::Layer* GrainFace::addLayer (const juce::String& n, juce::Rectangle<float> r, std::function<void (juce::Graphics&)> draw)
{
    auto l = std::make_unique<Layer>();
    l->name = n;
    l->draw = std::move (draw);
    l->setInterceptsMouseClicks (false, false);
    l->setBounds (r.getSmallestIntegerContainer());
    addAndMakeVisible (*l);
    named[n] = l.get();
    layers.push_back (std::move (l));
    return layers.back().get();
}

void GrainFace::repaintLayer (const juce::String& n)
{
    if (auto it = named.find (n); it != named.end())
        it->second->repaint();
    else if (n == "texts" || n == "segs")
        for (auto& l : layers)
            if (l->name.startsWith (n + ":"))
                l->repaint();
}

juce::Rectangle<float> GrainFace::unionOf (const juce::String& cid, bool bar) const
{
    // Where a part is on any of the pages, and room for its shadows.
    juce::Rectangle<float> r;
    for (const auto& [name, p] : pageNodes)
    {
        const auto& m = bar ? p.bars : p.ids;
        if (auto it = m.find (cid); it != m.end())
            r = r.isEmpty() ? it->second.r : r.getUnion (it->second.r);
    }
    return r.isEmpty() ? juce::Rectangle<float> (0, 0, 1, 1) : r.expanded (6);
}

void GrainFace::showPage()
{
    auto* want = pages[fxView ? juce::String ("fx") : engine].get();
    if (want == shown)
        return;
    for (auto& [n, p] : pages)
        p->setVisible (p.get() == want);
    shown = want;
    for (auto& l : layers)
        l->toFront (false);
    repaint();
}

void GrainFace::buildLayers()
{
    // One layer per control the page lays out (every engine's), drawn only
    // when what it shows moves; the canvases and readings each their own.
    std::set<juce::String> keys;
    for (auto& [n, p] : pageNodes)
        for (auto& [k, b] : p.bars)
            keys.insert (k);
    for (const auto& k : keys)
    {
        const auto r = unionOf (k, true);
        addLayer ("bar:" + k, r, [this, k, r] (juce::Graphics& g) {
            g.setOrigin (-r.getSmallestIntegerContainer().getPosition());
            drawBar (g, k);
        });
    }
    auto canvas = [this] (const juce::String& cid, std::function<void (juce::Graphics&, float, float)> draw) {
        const auto& ids = pageNodes["wsola"].ids;
        auto it = ids.find (cid);
        if (it == ids.end())
            return;
        const auto r = it->second.r;
        addLayer (cid, r, [this, r, draw, cid] (juce::Graphics& g) {
            static const juce::StringArray everyView { "gsOutWave", "gsLoadM", "gsMaster", "gsBend", "gsGlide", "gsKeys" };
            if (fxView && !everyView.contains (cid))
                return;
            draw (g, r.getWidth(), r.getHeight());
        });
    };
    canvas ("gsCloud", [this] (juce::Graphics& g, float w, float h) { drawCloud (g, w, h); });
    canvas ("gsSndMini", [this] (juce::Graphics& g, float w, float h) { drawMini (g, w, h); });
    canvas ("gsAmp", [this] (juce::Graphics& g, float w, float h) { drawAmp (g, w, h); });
    for (int i = 0; i < 4; ++i)
        canvas ("gsLsc" + juce::String (i), [this, i] (juce::Graphics& g, float w, float h) { drawLfo (g, i, w, h); });
    canvas ("gsOutWave", [this] (juce::Graphics& g, float w, float h) { drawOutWave (g, w, h); });
    canvas ("gsMaster", [this] (juce::Graphics& g, float w, float h) { drawMaster (g, w, h); });
    canvas ("gsLoadM", [this] (juce::Graphics& g, float w, float h) { drawLoad (g, w, h); });
    canvas ("gsBend", [this] (juce::Graphics& g, float w, float h) { drawWheel (g, w, h); });
    canvas ("gsGlide", [this] (juce::Graphics& g, float w, float h) { drawGlide (g, w, h); });
    canvas ("gsKeys", [this] (juce::Graphics& g, float w, float h) { drawKeys (g, w, h); });
    // The engine's own pictures sit where each engine's page puts them.
    addLayer ("pics", { 734, 241, 640, 617 }, [this] (juce::Graphics& g) {
        if (fxView)
            return;
        g.setOrigin (-734, -241);
        const auto& ids = cur().ids;
        for (const char* cid : { "gsHeadPic", "gsMapPic", "gsLens" })
        {
            auto it = ids.find (cid);
            if (it == ids.end())
                continue;
            juce::Graphics::ScopedSaveState keep (g);
            g.reduceClipRegion (it->second.r.toNearestInt());
            g.setOrigin (it->second.r.getPosition().toInt());
            const float w = it->second.r.getWidth(), h = it->second.r.getHeight();
            if (juce::String (cid) == "gsHeadPic")
                drawHeadPic (g, w, h);
            else if (juce::String (cid) == "gsMapPic")
                drawMapPic (g, w, h);
            else
                drawLens (g, w, h);
        }
    });
    // The effects view's own canvases and readings (404's gsFxDrawOutput).
    addLayer ("fxview", { 0, 0, 1388, 990 }, [this] (juce::Graphics& g) { drawFxView (g); });
    addLayer ("lfoRows", { 745, 279, 618, 232 }, [this] (juce::Graphics& g) {
        if (fxView)
            return;
        g.setOrigin (-745, -279);
        for (int i = 0; i < 4; ++i)
            drawLfoRow (g, i);
    });
    for (const char* cid : { "gsVmode", "gsAB", "gsRunBtn", "gsFollow", "gsLoopChip" })
    {
        auto r = unionOf (cid, false);
        if (juce::String (cid) == "gsLoopChip")
            r = r.getUnion (unionOf ("gsRegChip", false)).withWidth (420);
        addLayer ("segs:" + juce::String (cid), r, [this, cid, r] (juce::Graphics& g) {
            g.setOrigin (-r.getSmallestIntegerContainer().getPosition());
            only = cid;
            drawSegs (g);
            only.clear();
        });
    }
    addLayer ("strip", { 640, 38, 320, 44 }, [this] (juce::Graphics& g) {
        g.setOrigin (-640, -38);
        drawStrip (g);
    });
    for (const char* cid : { "gsLength", "gsMeta", "gsVoicesRo", "gsSndName", "gsCzRo", "gsCloudRo", "gsAmpRo", "gsSeedRo", "gsTuneBtn", "gsOctRo", "gsVelRo", "gsBendLab", "gsKbScale", "gsCpPb", "gsPb" })
    {
        auto r = unionOf (cid, false);
        if (juce::String (cid) == "gsAmpRo")
            r = r.withWidth (140).withHeight (30);
        addLayer ("texts:" + juce::String (cid), r, [this, cid, r] (juce::Graphics& g) {
            g.setOrigin (-r.getSmallestIntegerContainer().getPosition());
            only = cid;
            drawTexts (g);
            only.clear();
        });
    }
}

// ───────────────────────────────────────────────────── the document's values

juce::var GrainFace::home (const Ctl& c) const
{
    // A copy of the var shares its object, so writing to it writes the draft.
    if (!draft.isObject())
        return {};
    if (c.at == "s")
        return draft;
    static const std::map<juce::String, juce::String> sub { { "g", "grain" }, { "w", "wsola" }, { "v", "vocoder" }, { "p", "pvsola" }, { "h", "hybrid" }, { "k", "soundhack" } };
    auto it = sub.find (c.at);
    if (it == sub.end())
        return {};
    const auto v = draft[juce::Identifier (it->second)];
    return v.isObject() ? v : juce::var();
}

double GrainFace::read (const juce::String& k) const
{
    auto it = ctls.find (k);
    if (it == ctls.end())
        return 0;
    const auto& c = it->second;
    const auto h = home (c);
    if (!h.isObject())
        return c.d;
    const auto v = h[juce::Identifier (c.key)];
    if (c.sw)
        return (bool) v ? 1 : 0;
    if (!c.seg.isEmpty())
        return juce::jmax (0, c.vals.indexOf (v.toString()));
    if (v.isVoid() || v.isUndefined())
        return c.d;
    const double d = dnum (v, c.d);
    return std::isfinite (d) ? d : c.d;
}

void GrainFace::write (const juce::String& k, double v)
{
    auto it = ctls.find (k);
    if (it == ctls.end())
        return;
    const auto& c = it->second;
    auto h = home (c);
    if (!h.isObject())
        return;
    juce::var val;
    if (c.sw)
        val = v >= 0.5;
    else if (!c.seg.isEmpty())
        val = c.vals[juce::jlimit (0, c.vals.size() - 1, (int) v)];
    else
        val = v;
    put (h, c.key, val);
}

double GrainFace::toN (const Ctl& c, double v) const
{
    double n = c.log ? std::log (juce::jmax (v, c.min) / c.min) / std::log (c.max / c.min) : (v - c.min) / (c.max - c.min);
    return clamp01 (n);
}

double GrainFace::fromN (const Ctl& c, double n) const
{
    n = clamp01 (n);
    if (c.log)
        n = jsRound (n * 1000) / 1000;
    double v = c.log ? c.min * std::pow (c.max / c.min, n) : c.min + n * (c.max - c.min);
    double step = c.step;
    if (c.scaleStep)
    {
        // scaleStep(): the scale's finest degree, or the grid, or free.
        step = scaleName.isEmpty() ? (pitchStep > 0 ? pitchStep : 0.001) : 0.5;
        if (scaleName.isNotEmpty())
            if (auto* gs = scales["groups"].getArray())
                for (const auto& g : *gs)
                    if (auto* ss = g["scales"].getArray())
                        for (const auto& s : *ss)
                            if (s["name"].toString() == scaleName)
                            {
                                const double span = dnum (s["span"], 1200);
                                double finest = span;
                                auto* cents = s["cents"].getArray();
                                for (int i = 1; cents != nullptr && i < cents->size(); ++i)
                                    finest = juce::jmin (finest, dnum ((*cents)[i]) - dnum ((*cents)[i - 1]));
                                if (cents != nullptr && cents->size() > 0)
                                    finest = juce::jmin (finest, span - dnum (cents->getLast()));
                                step = juce::jmax (0.01, finest / 100);
                            }
    }
    if (step > 0)
        v = jsRound (v / step) * step;
    if (c.odd)
        v = jsRound ((v - 1) / 2) * 2 + 1;
    v = std::round (v * 1e6) / 1e6;
    return juce::jlimit (c.min, c.max, v);
}

bool GrainFace::cloudActive() const
{
    return engine == "granular" || (bool) draft["cloud"];
}

bool GrainFace::dimmed (const juce::String& k) const
{
    if (k == "position" || k == "rateHz")
        return !cloudActive();
    if (k == "cloudMix")
        return read ("cloud") < 0.5;
    if (k == "sensitivity" || k == "floor" || k == "guardHops")
        return engine == "wsola" && read ("preserveTransients") < 0.5;
    return false;
}

juce::String GrainFace::fmt (const Ctl& c, double v) const
{
    const auto& k = c.k;
    auto x2 = [] (double x) { return fixed (x, 2) + uni ("\xc3\x97"); };
    auto ms = [] (double x) { return (x < 10 ? fixed (x, 1) : rnd (x)) + " ms"; };
    auto pc = [] (double x) { return rnd (x * 100) + "%"; };
    auto st = [] (double x) { return uni ("\xc2\xb1") + fixed (x, 1) + " st"; };
    auto lvl = [&] (double x) { return x <= 0 ? juce::String ("out") : x2 (x); };
    auto fs = [] (double x) { return x >= 1000 ? fixed (x / 1000, 2) + " s" : rnd (x) + " ms"; };
    auto hz = [] (double x, const char* off) { return x <= 0 ? juce::String (off) : rnd (x) + "/s"; };
    if (k == "ratio")
        return v >= 10 ? fixed (v, 0) + uni ("\xc3\x97") : v >= 1 ? x2 (v) : fixed (v, 3) + uni ("\xc3\x97");
    if (k == "semitones")
    {
        const juce::String sign = v >= 0 ? "+" : "";
        if (scaleName.isEmpty() && pitchStep > 0)
            return sign + fixed (v, 1) + " st";
        return sign + fixed (v, 2) + uni (" st \xc2\xb7 ") + sign + rnd (v * 100) + uni ("\xc2\xa2");
    }
    if (k == "windowMs" || k == "vocWindowMs")
        return rnd (v) + " ms";
    if (k == "rateHz")
        return hz (v, "off");
    if (k == "densityHz")
        return hz (v, "auto");
    if (k == "overlap")
        return fixed (v, 1) + uni ("\xc3\x97");
    if (k == "envelope")
    {
        if (std::abs (v - 0.5) < 0.005)
            return "symmetric";
        return fixed (v, 2) + (v < 0.5 ? " percussive" : " swelling");
    }
    if (k == "sizeJitter" || k == "sensitivity" || k == "cloudMix" || k == "magBlur")
        return pc (v);
    if (k == "sizeRange" || k == "phaseSpread" || k == "lockWidth")
        return x2 (v);
    if (k == "position")
        return fixed (v * 100, 1) + "%";
    if (k == "scan")
        return std::abs (v) < 0.005 ? juce::String ("frozen") : fixed (v, 2) + uni ("\xc3\x97");
    if (k == "positionJitterMs")
        return rnd (v) + " ms";
    if (k == "pitchJitterSemis" || k == "pitchDriftSemis")
        return st (v);
    if (k == "driftRateHz")
        return fixed (v, 2) + " Hz";
    if (k == "layers")
        return rnd (v) + uni ("\xc3\x97");
    if (k == "layerSpread")
        return v <= 0.005 ? juce::String ("stacked") : x2 (v);
    if (k == "layerScatter")
        return v <= 0 ? juce::String ("stacked") : pc (v);
    if (k == "layerScatterMs" || k == "fbTimeMs")
        return fs (v);
    if (k == "panSpread")
        return v <= 0 ? juce::String ("centred") : pc (v);
    if (k == "fbAmount")
        return v <= 0 ? juce::String ("off") : pc (v);
    if (k == "fbSmear")
        return v <= 0 ? juce::String ("clear") : pc (v);
    if (k == "fbDamp")
        return v <= 0 ? juce::String ("bright") : pc (v);
    if (k == "fbShift")
        return std::abs (v) < 0.005 ? juce::String ("none") : (v > 0 ? "+" : "") + fixed (v, 2) + " st";
    if (k == "harmonicLevel" || k == "percussiveLevel" || k == "residualLevel")
        return lvl (v);
    if (k == "searchMs")
        return v <= 0 ? juce::String ("plain OLA") : fixed (v, 1) + " ms";
    if (k == "stride" || k == "anchorFrames" || k == "timeSpan")
        return rnd (v) + " fr";
    if (k == "floor")
        return v <= 0 ? juce::String ("none") : x2 (v);
    if (k == "guardHops")
        return fixed (v, 1) + " hop";
    if (k == "anchorSearchMs")
        return v <= 0 ? juce::String ("no search") : fixed (v, 1) + " ms";
    if (k == "blend")
        return v <= 0 ? juce::String ("butt join") : pc (v);
    if (k == "freqSpan" || k == "peakWidth")
        return rnd (v) + " bin";
    if (k == "margin")
        return v <= 1.001 ? juce::String ("no air") : x2 (v);
    if (k == "fftSize")
        return rnd (v);
    if (k == "magFreeze")
        return v >= 0.999 ? juce::String ("held") : pc (v);
    if (k == "magGate")
        return v <= 0 ? juce::String ("off") : pc (v);
    if (k == "freqTrust")
        return v <= 0.001 ? juce::String ("to bins") : x2 (v);
    juce::ignoreUnused (ms);
    return fixed (v, 2);
}

void GrainFace::setV (const juce::String& k, double v)
{
    auto it = ctls.find (k);
    if (it == ctls.end() || !std::isfinite (v))
        return;
    const auto& c = it->second;
    if (!c.sw && c.seg.isEmpty())
    {
        v = juce::jlimit (c.min, c.max, v);
        if (c.detent > -1e8 && std::abs (v - c.detent) <= (c.max - c.min) * 0.06)
            v = c.detent;
        if ((k == "semitones" || k == "fbShift") && (scaleName.isNotEmpty() || pitchStep > 0))
        {
            // gsSnapPitch: onto the tuning, as the server will have it.
            juce::Array<double> cents;
            double span = 1200;
            if (scaleName.isNotEmpty())
            {
                if (auto* gs = scales["groups"].getArray())
                    for (const auto& g : *gs)
                        if (auto* ss = g["scales"].getArray())
                            for (const auto& s : *ss)
                                if (s["name"].toString() == scaleName)
                                {
                                    span = dnum (s["span"], 1200);
                                    if (auto* cs = s["cents"].getArray())
                                        for (const auto& x : *cs)
                                            cents.add (dnum (x));
                                }
            }
            else
            {
                const int n = juce::jmax (1, (int) jsRound (12 / pitchStep));
                for (int i = 0; i < n; ++i)
                    cents.add (i * pitchStep * 100);
            }
            if (!cents.isEmpty())
            {
                const double p = span / 100, o = std::floor (v / p), r = v - o * p;
                double best = 0, bd = 1e9;
                cents.add (span);
                for (auto cc : cents)
                    if (std::abs (cc / 100 - r) < bd)
                    {
                        bd = std::abs (cc / 100 - r);
                        best = cc / 100;
                    }
                v = juce::jlimit (c.min, c.max, o * p + best);
            }
        }
    }
    write (k, v);
    repaintLayer ("bar:" + k);
    if (k == "cloud" || k == "preserveTransients")
        for (const char* d : { "position", "rateHz", "cloudMix", "sensitivity", "floor", "guardHops" })
            repaintLayer ("bar:" + juce::String (d));
    repaintLayer ("gsCloud");
    repaintLayer ("pics");
    repaintLayer ("texts");
}

void GrainFace::setN (const juce::String& k, double n)
{
    auto it = ctls.find (k);
    if (it != ctls.end())
        setV (k, fromN (it->second, n));
}

void GrainFace::user (const juce::String& k, double v)
{
    setV (k, v);
    sendSoon (false);
}

void GrainFace::setControl (const juce::String& key, double value, bool commit)
{
    setV (key, value);
    send (!commit);
}

// ──────────────────────────────────────────────────────────── sending

juce::var GrainFace::grainCall (const char* what, const juce::var& body)
{
    juce::String out;
    const auto json = body.isVoid() ? juce::String() : juce::JSON::toString (body, true);
    call ([&] (NaApp* a) -> int64_t {
        out = juce::String::fromUTF8 (naText ([&] (char* b, uint32_t cap) { return (uint32_t) juce::jmax (0, na_grain_call (a, id, what, json.isEmpty() ? nullptr : json.toRawUTF8(), b, cap)); }).c_str());
        return 0;
    });
    return juce::JSON::parse (out);
}

void GrainFace::send (bool liveSend)
{
    if (!draft.isObject())
        return;
    // The tray's send: the stretch's three, the engine and every engine's own,
    // the cloud, and the grain object; `draft` while a hand is on it.
    auto body = deepCopy (draft);
    put (body, "op", "stretch");
    if (liveSend)
        put (body, "quality", "draft");
    if (auto* o = body.getDynamicObject())
    {
        o->removeProperty ("scale");
        o->removeProperty ("pitchStep");
        o->removeProperty ("active");
        o->removeProperty ("granular");
    }
    readDoc (grainCall ("edit", body));
    lastPreview = juce::Time::getMillisecondCounterHiRes();
}

void GrainFace::sendSoon (bool liveSend)
{
    const double now = juce::Time::getMillisecondCounterHiRes();
    if (liveSend)
    {
        if (now - lastPreview >= 90)
            send (true);
        else
            previewDue = true;
        return;
    }
    // The commit after any preview still waiting (gsCommit).
    previewDue = false;
    commitDue = true;
    commitAt = juce::jmax (now, lastPreview + 95);
    if (commitAt <= now)
    {
        commitDue = false;
        send (false);
    }
}

void GrainFace::postAll (const juce::var& extra)
{
    if (!draft.isObject())
        return;
    auto body = deepCopy (draft);
    put (body, "op", "stretch");
    if (auto* e = extra.getDynamicObject())
        for (const auto& p : e->getProperties())
            put (body, p.name, p.value);
    readDoc (grainCall ("edit", body));
}

void GrainFace::readDoc (const juce::var& answer)
{
    if (!answer.isObject())
        return;
    const auto& st = answer["stretch"];
    if (st.isObject())
    {
        // The drafts follow the document (renderStretch, renderGrainParams),
        // except while a hand is on a control.
        if (grab != Grab::bar && grab != Grab::paint && grab != Grab::cloud)
        {
            draft = deepCopy (st);
            const auto alg = st["algorithm"].toString();
            if (alg.isNotEmpty() && alg != engine)
            {
                engine = alg;
                showPage();
            }
        }
        scaleName = st["scale"].toString();
        pitchStep = dnum (st["pitchStep"]);
    }
    for (auto& l : layers)
        if (l->name.startsWith ("bar:"))
            l->repaint();
    repaintLayer ("texts");
    repaintLayer ("gsCloud");
    repaintLayer ("pics");
    repaintLayer ("segs");
}

void GrainFace::reload()
{
    const auto info = grainCall ("info", {});
    if (!info.isObject())
        return;
    doc = info["doc"];
    deviceRate = dnum (info["rate"], 48000);
    fileFrames = dnum (doc["frames"]);
    fileRate = dnum (doc["sampleRate"], 48000);
    annotations = doc["annotations"];
    docSerial = (int64_t) dnum (doc["serial"], -1);
    const auto& origin = doc["origin"];
    soundName = origin["name"].toString();
    {
        // gsMeta's items; drawTexts keeps as many as fit.
        const double bits = dnum (origin["bits"]);
        juce::StringArray items { origin["format"].toString().isEmpty() ? juce::String ("wav") : origin["format"].toString(), juce::String ((int) fileRate) + " Hz",
                                  bits > 0 ? juce::String ((int) bits) + "-bit" : uni ("\xe2\x80\x94"), juce::String ((int) dnum (doc["channels"], 1)) + " ch",
                                  fixed (dnum (doc["duration"]), 2) + "s" };
        fileMeta = items.joinIntoString ("|");
    }
    rack = info["rack"];
    readDoc (doc);
    restore (info["ui"]);
    if (!scales.isObject())
        scales = grainCall ("scales", {});
    {
        // Its presets: the app's own file, then MGL's, read only.
        auto pl = obj();
        put (pl, "op", "places");
        put (pl, "mine", places::grainPresets().getFullPathName());
        put (pl, "mgl", places::mgl().getChildFile ("PRESETS.json").getFullPathName());
        presets = grainCall ("presets", pl);
    }
    loadPeaks();
    showPage();
    voiceSend();
    lfoSend();
    repaint();
}

// ────────────────────────────────────────────────── the page's kept state

void GrainFace::keep()
{
    auto ui = obj();
    put (ui, "ab", ab);
    put (ui, "czA", czA);
    put (ui, "czB", czB);
    put (ui, "loop", loopOn);
    put (ui, "sel", hasSel ? juce::var (juce::Array<juce::var> { selA, selB }) : juce::var());
    put (ui, "cue", cue);
    put (ui, "follow", follow);
    put (ui, "followMode", followMode);
    put (ui, "oct", oct);
    put (ui, "midi", midiChannel);
    put (ui, "volume", volume);
    auto a = obj();
    put (a, "a", amp.a);
    put (a, "d", amp.d);
    put (a, "s", amp.s);
    put (a, "r", amp.r);
    put (ui, "amp", a);
    auto v = obj();
    put (v, "mode", voice.mode);
    put (v, "run", voice.run);
    put (v, "glide", voice.glide);
    put (v, "bendR", voice.bendR);
    put (ui, "voice", v);
    juce::Array<juce::var> ls;
    for (const auto& L : lfo)
    {
        auto o = obj();
        put (o, "shape", L.shape);
        put (o, "rate", L.rate);
        put (o, "sync", L.sync);
        put (o, "mode", L.mode);
        put (o, "depth", L.depth);
        juce::Array<juce::var> t;
        for (const auto& x : L.targets)
            t.add (x);
        put (o, "targets", t);
        ls.add (o);
    }
    put (ui, "lfo", ls);
    put (ui, "preset", presetName);
    const auto json = juce::JSON::toString (ui, true);
    call ([&] (NaApp* app) -> int64_t { return na_grain_call (app, id, "ui", json.toRawUTF8(), nullptr, 0); });
}

void GrainFace::restore (const juce::var& ui)
{
    // The page's own starting values (GS.lfo, GS_AMP_DEF, GS_VOICE_DEF).
    const auto& defs = data["lfo"]["defaults"];
    for (int i = 0; i < 4; ++i)
    {
        const auto& d = defs[i];
        lfo[(size_t) i] = Lfo();
        lfo[(size_t) i].shape = d["shape"].toString();
        lfo[(size_t) i].rate = dnum (d["rate"]);
        lfo[(size_t) i].sync = (bool) d["sync"];
        lfo[(size_t) i].mode = d["mode"].toString();
        lfo[(size_t) i].depth = dnum (d["depth"]);
    }
    if (!ui.isObject())
        return;
    ab = ui["ab"].toString().isEmpty() ? juce::String ("A") : ui["ab"].toString();
    czA = dnum (ui["czA"]);
    czB = dnum (ui["czB"]);
    loopOn = (bool) ui["loop"];
    hasSel = ui["sel"].isArray();
    if (hasSel)
    {
        selA = dnum (ui["sel"][0]);
        selB = dnum (ui["sel"][1]);
    }
    cue = dnum (ui["cue"]);
    follow = ui["follow"].isVoid() ? true : (bool) ui["follow"];
    followMode = ui["followMode"].toString().isEmpty() ? juce::String ("scroll") : ui["followMode"].toString();
    oct = (int) dnum (ui["oct"]);
    midiChannel = (int) dnum (ui["midi"], 2);
    volume = dnum (ui["volume"], 0.85);
    if (ui["amp"].isObject())
        amp = { dnum (ui["amp"]["a"], 0.16), dnum (ui["amp"]["d"], 0.4), dnum (ui["amp"]["s"], 0.78), dnum (ui["amp"]["r"], 0.5) };
    if (ui["voice"].isObject())
    {
        voice.mode = ui["voice"]["mode"].toString().isEmpty() ? juce::String ("mono") : ui["voice"]["mode"].toString();
        voice.run = (bool) ui["voice"]["run"];
        voice.glide = dnum (ui["voice"]["glide"], 0.3);
        voice.bendR = (int) dnum (ui["voice"]["bendR"], 2);
    }
    if (auto* ls = ui["lfo"].getArray())
        for (int i = 0; i < juce::jmin (4, ls->size()); ++i)
        {
            const auto& d = (*ls)[i];
            auto& L = lfo[(size_t) i];
            L.shape = d["shape"].toString();
            L.rate = dnum (d["rate"]);
            L.sync = (bool) d["sync"];
            L.mode = d["mode"].toString();
            L.depth = dnum (d["depth"]);
            L.targets.clear();
            if (auto* t = d["targets"].getArray())
                for (const auto& x : *t)
                    L.targets.add (x.toString());
        }
    presetName = ui["preset"].toString();
}

// ─────────────────────────────────────────────────────────── the engine

double GrainFace::engineFromSrc (double f) const
{
    const double ratio = dnum (draft["ratio"], 1);
    return f / (fileRate / juce::jmax (1.0, deviceRate)) * ratio;
}

double GrainFace::srcFromEngine (double p) const
{
    double ratio = dnum (live["ratio"], 0);
    if (!(ratio > 0) || !playing)
        ratio = dnum (draft["ratio"], 1);
    return p / ratio * (fileRate / juce::jmax (1.0, deviceRate));
}

std::pair<double, double> GrainFace::loopSecs() const
{
    if (fileFrames <= 0)
        return { 0, 1 };
    if (hasSel && selB > selA)
        return { selA / fileRate, selB / fileRate };
    return { 0, fileLen() };
}

std::pair<double, double> GrainFace::cloudView() const
{
    const double len = fileLen();
    if (!(czB > czA))
        return { 0, len };
    const double L = juce::jmin (czB - czA, len), x = juce::jlimit (0.0, len - L, czA);
    return { x, x + L };
}

void GrainFace::transport (const juce::var& msg)
{
    const auto r = grainCall ("transport", msg);
    juce::ignoreUnused (r);
}

void GrainFace::applyLoop()
{
    auto l = obj();
    put (l, "on", loopOn);
    put (l, "a", hasSel && selB > selA ? jsRound (engineFromSrc (selA)) : 0.0);
    put (l, "b", hasSel && selB > selA ? jsRound (engineFromSrc (selB)) : 0.0);
    auto m = obj();
    put (m, "loop", l);
    transport (m);
    keep();
    repaintLayer ("gsCloud");
    repaintLayer ("texts");
}

void GrainFace::seekSource (double frame)
{
    auto m = obj();
    put (m, "seek", juce::jmax (0.0, engineFromSrc (frame)));
    transport (m);
}

void GrainFace::play()
{
    applyLoop();
    seekSource (cue);
    auto m = obj();
    put (m, "play", true);
    put (m, "mute", false);
    transport (m);
    playing = true;
}

void GrainFace::stop()
{
    auto m = obj();
    put (m, "play", false);
    transport (m);
    playing = false;
}

double GrainFace::head() const
{
    // gsHead: the note played last, else the deck's place, else Start.
    if (fileFrames <= 0)
        return 0;
    const auto& keys = live["keys"];
    if ((bool) keys["sounding"] && voice.mode != "poly")
        return dnum (keys["head"]) / juce::jmax (1.0, deviceRate) * (fileRate / fileRate);
    if (auto* hs = live["heads"].getArray(); hs != nullptr && !hs->isEmpty())
        return dnum (hs->getLast()["src"]);
    if (!playing)
        return cue / fileRate;
    double h = srcFromEngine (position) / fileRate;
    const double sc = read ("scan");
    if (voice.run && sc != 1 && std::abs (sc) >= 1e-3 && engine != "pvsola")
        h = sc > 0 ? h * sc : fileLen() + h * sc;
    return std::isfinite (h) ? h : cue / fileRate;
}

void GrainFace::readLive()
{
    live = grainCall ("read", {});
    playing = (bool) live["playing"];
    position = dnum (live["position"]);
    loadWorst = dnum (live["load"]["worst"]);
    // As captured, nothing has run: every LFO at the top of its first cycle.
    lfoState = asCaptured ? juce::var() : grainCall ("lfos-state", {});
    lfoAt = juce::Time::getMillisecondCounterHiRes();
    outL.assign (2048, 0.0f);
    outR.assign (2048, 0.0f);
    int n = 0;
    call ([&] (NaApp* a) -> int64_t {
        n = na_grain_scope (a, id, outL.data(), outR.data(), (uint32_t) outL.size());
        return 0;
    });
    outL.resize ((size_t) juce::jmax (0, n));
    outR.resize ((size_t) juce::jmax (0, n));
    double sum = 0;
    for (int i = 0; i < (int) outL.size(); ++i)
        sum += 0.5 * ((double) outL[(size_t) i] * outL[(size_t) i] + (double) outR[(size_t) i] * outR[(size_t) i]);
    const double rms = outL.empty() ? 0 : std::sqrt (sum / (double) outL.size());
    vuDb = rms > 1e-6 ? 20 * std::log10 (rms) : -96;
    // Each side's level and peak, and how alike they are (the meters).
    double sl = 0, sr = 0, slr = 0, pl = 0, pr = 0;
    for (size_t i = 0; i < outL.size(); ++i)
    {
        sl += (double) outL[i] * outL[i];
        sr += (double) outR[i] * outR[i];
        slr += (double) outL[i] * outR[i];
        pl = juce::jmax (pl, (double) std::abs (outL[i]));
        pr = juce::jmax (pr, (double) std::abs (outR[i]));
    }
    const double frames = (double) juce::jmax ((size_t) 1, outL.size());
    auto db = [] (double v) { return v > 1e-6 ? 20 * std::log10 (v) : -120.0; };
    vuL = db (std::sqrt (sl / frames));
    vuR = db (std::sqrt (sr / frames));
    peakL = db (pl);
    peakR = db (pr);
    corr = sl > 0 && sr > 0 ? slr / std::sqrt (sl * sr) : 0;
}

void GrainFace::warm()
{
    std::vector<face::Chrome*> all;
    for (auto& [n, p] : pages)
        all.push_back (p.get());
    all.push_back (lit.get());
    if (warmed >= all.size())
        return;
    juce::Image img (juce::Image::ARGB, 2776, 1980, true);
    juce::Graphics g (img);
    g.addTransform (juce::AffineTransform::scale (2.0f));
    auto* p = all[warmed++];
    p->setBounds (getLocalBounds());
    p->paintEntireComponent (g, false);
    if (p != shown)
    {
        // Every layer's drawing on that page too (its fonts, its glyphs).
        const bool fx = fxView;
        const auto e = engine;
        for (auto& [name, page] : pages)
            if (page.get() == p)
            {
                fxView = name == "fx";
                if (!fxView)
                    engine = name;
            }
        for (auto& l : layers)
        {
            juce::Graphics::ScopedSaveState keep (g);
            g.setOrigin (l->getPosition());
            l->paint (g);
        }
        fxView = fx;
        engine = e;
    }
}

void GrainFace::timerCallback()
{

    const double now = juce::Time::getMillisecondCounterHiRes();
    if (previewDue && now - lastPreview >= 90)
    {
        previewDue = false;
        send (true);
    }
    if (commitDue && now >= commitAt)
    {
        commitDue = false;
        send (false);
    }
    // The document, when an edit elsewhere has changed it.
    const auto info = grainCall ("info", {});
    const auto serial = (int64_t) dnum (info["doc"]["serial"], -1);
    const auto stretchNow = juce::JSON::toString (info["doc"]["stretch"], true) + juce::JSON::toString (info["rack"], true);
    if (serial != docSerial || stretchNow != docStretch)
    {
        docStretch = stretchNow;
        const bool sound = serial != docSerial;
        doc = info["doc"];
        docSerial = serial;
        fileFrames = dnum (doc["frames"]);
        fileRate = dnum (doc["sampleRate"], 48000);
        annotations = doc["annotations"];
        soundName = doc["origin"]["name"].toString();
        rack = info["rack"];
        readDoc (doc);
        if (sound)
            loadPeaks();
    }
    readLive();
    // The grains sounded since, for the lens (407's gsPicFeed).
    {
        const double t = juce::Time::getMillisecondCounterHiRes() / 1000.0;
        if (auto* gs = live["grains"].getArray())
            for (const auto& e : *gs)
                sounded.push_back ({ t, dnum (e["src"]), dnum (e["size"]), dnum (e["semis"]), (int) dnum (e["voice"]) });
        while (!sounded.empty() && (t - sounded.front().at > 3 || sounded.size() > 600))
            sounded.erase (sounded.begin());
    }
    // The grain schedule around where the deck is, a few times a second.
    if (now - scheduleAt > 200)
    {
        scheduleAt = now;
        const double at = (playing ? position / deviceRate : engineFromSrc (head() * fileRate) / deviceRate) * fileRate;
        auto w = juce::var (new juce::DynamicObject());
        put (w, "from", juce::jmax (0.0, std::floor (at - 0.1 * fileRate)));
        put (w, "to", std::ceil (at + 1.0 * fileRate));
        schedule = asCaptured ? juce::var() : grainCall ("schedule", w);
    }
    repaintLayer ("gsCloud");
    repaintLayer ("gsOutWave");
    repaintLayer ("gsMaster");
    repaintLayer ("gsLoadM");
    for (int i = 0; i < 4; ++i)
        repaintLayer ("gsLsc" + juce::String (i));
    repaintLayer ("lfoRows");
    repaintLayer ("texts");
    repaintLayer ("pics");
    if (fxView)
        repaintLayer ("fxview");
    // The glyphs that move, a dozen times a second (gsAnimateGlyphs).
    static int tick = 0;
    if (++tick % 3 == 0)
        for (const auto& [k, c] : ctls)
            if (c.moves && read (k) > 0)
                repaintLayer ("bar:" + k);
}

// ─────────────────────────────────────────────────────────── the keys

void GrainFace::voicePost (const juce::var& part)
{
    grainCall ("keys", part);
}

void GrainFace::voiceSend()
{
    // gsVoiceSend: everything, as the page has it.
    auto v = obj();
    put (v, "front", true);
    put (v, "bendRange", voice.bendR);
    put (v, "mode", voice.mode);
    put (v, "run", voice.run);
    put (v, "glide", voice.glide * voice.glide * 2);
    put (v, "bend", bend * voice.bendR);
    put (v, "attack", amp.a * amp.a * 4);
    put (v, "decay", amp.d * amp.d * 4);
    put (v, "sustain", amp.s);
    put (v, "release", amp.r * amp.r * 6);
    put (v, "start", fileFrames > 0 ? clamp01 (cue / fileFrames) : 0.0);
    put (v, "replay", true);
    voicePost (v);
}

void GrainFace::note (int n, float vel, bool on)
{
    if (n < 0 || n > 127)
        return;
    if (on)
    {
        if (held.count (n) > 0)
            return;
        held[n] = vel;
        velText = "vel " + juce::String ((int) jsRound (vel * 127));
    }
    else if (held.erase (n) == 0)
        return;
    if (onNote)
        onNote (n, vel, on);
    repaintLayer ("gsKeys");
    repaintLayer ("texts");
}

void GrainFace::setOct (int o)
{
    oct = juce::jlimit (-4, 4, o);
    keep();
    repaintLayer ("gsKeys");
    repaintLayer ("texts");
}

bool GrainFace::keyPressed (const juce::KeyPress& k)
{
    const auto c = (juce::juce_wchar) juce::CharacterFunctions::toLowerCase (k.getTextCharacter());
    if (k.getModifiers().isCommandDown() || k.getModifiers().isAltDown())
        return false;
    if (k.getKeyCode() == juce::KeyPress::escapeKey && mapI >= 0)
    {
        mapI = -1;
        repaintLayer ("lfoRows");
        return true;
    }
    if (c == 'z' || c == 'x')
    {
        setOct (oct + (c == 'z' ? -1 : 1));
        return true;
    }
    for (int i = 0; noteKeys[i] != 0; ++i)
        if (noteKeys[i] == c)
        {
            if (kbd.count (c) == 0)
            {
                const int n = 60 + 12 * oct + i;
                kbd[c] = n;
                note (n, 0.8f, true);
            }
            return true;
        }
    return false;
}

bool GrainFace::keyStateChanged (bool isKeyDown)
{
    if (isKeyDown)
        return false;
    for (auto it = kbd.begin(); it != kbd.end();)
    {
        if (!juce::KeyPress::isKeyCurrentlyDown ((int) it->first) && !juce::KeyPress::isKeyCurrentlyDown ((int) juce::CharacterFunctions::toUpperCase (it->first)))
        {
            note (it->second, 0, false);
            it = kbd.erase (it);
        }
        else
            ++it;
    }
    return false;
}

int GrainFace::keyAt (juce::Point<float> p) const
{
    const auto& ids = pageNodes.at ("wsola").ids;
    auto it = ids.find ("gsKeys");
    if (it == ids.end())
        return -1;
    const auto r = it->second.r;
    const float x = p.x - r.getX(), y = p.y - r.getY();
    if (x < 0 || y < 0 || x >= r.getWidth() || y >= r.getHeight())
        return -1;
    const int lo = juce::jlimit (0, 127 - 49 + 1, 36 + 12 * oct);
    auto black = [] (int n) { const int m = ((n % 12) + 12) % 12; return m == 1 || m == 3 || m == 6 || m == 8 || m == 10; };
    std::map<int, std::pair<float, float>> pos;
    int wi = 0;
    for (int n = lo; n < lo + 49; ++n)
        if (!black (n))
            pos[n] = { (float) wi++ * 28.0f, 28.0f };
    for (int n = lo; n < lo + 49; ++n)
        if (black (n))
            pos[n] = { pos[n - 1].first + 28.0f - 9.0f, 18.0f };
    for (const auto& [n, kw] : pos)
        if (black (n) && x >= kw.first && x < kw.first + kw.second && y < 60)
            return n;
    for (const auto& [n, kw] : pos)
        if (!black (n) && x >= kw.first && x < kw.first + kw.second)
            return n;
    return -1;
}

// ─────────────────────────────────────────────────────────────── the LFOs

juce::String GrainFace::lfoId (const juce::String& k) const
{
    static const std::map<juce::String, juce::String> root { { "s", "stretch" }, { "g", "stretch.grain" }, { "w", "stretch.wsola" }, { "v", "stretch.vocoder" }, { "p", "stretch.pvsola" }, { "h", "stretch.hybrid" }, { "k", "stretch.soundhack" } };
    auto it = ctls.find (k);
    if (it == ctls.end())
        return {};
    auto r = root.find (it->second.at);
    return r == root.end() ? juce::String() : r->second + "." + it->second.key;
}

juce::String GrainFace::lfoRate (const Lfo& L) const
{
    if (L.sync)
        return divisions[(int) jsRound (L.rate * 8)];
    const double h = 0.02 * std::pow (2000.0, L.rate);
    return h < 1 ? fixed (h, 2) + " Hz" : h < 10 ? fixed (h, 1) + " Hz" : rnd (h) + " Hz";
}

juce::var GrainFace::lfoPayload() const
{
    auto p = obj();
    put (p, "bpm", 120);
    juce::Array<juce::var> ls;
    for (const auto& L : lfo)
    {
        auto o = obj();
        put (o, "shape", L.shape);
        put (o, "mode", L.mode);
        put (o, "depth", L.depth);
        if (L.sync)
            put (o, "beats", divBeats[(int) jsRound (L.rate * 8)]);
        else
            put (o, "hz", 0.02 * std::pow (2000.0, L.rate));
        juce::Array<juce::var> ts;
        for (const auto& t : L.targets)
        {
            auto x = obj();
            put (x, "t", t);
            // A bar's own travel (gsLfoTarget).
            for (const auto& [k, c] : ctls)
                if (!c.sw && c.seg.isEmpty() && lfoId (k) == t)
                {
                    put (x, "lo", c.min);
                    put (x, "hi", c.max);
                    put (x, "curve", c.log ? "log" : "lin");
                }
            ts.add (x);
        }
        put (o, "targets", ts);
        ls.add (o);
    }
    put (p, "lfos", ls);
    return p;
}

void GrainFace::lfoSend()
{
    const auto r = grainCall ("lfos", lfoPayload());
    if (auto* refused = r["refused"].getArray(); refused != nullptr && !refused->isEmpty())
        for (auto& L : lfo)
            for (const auto& x : *refused)
                L.targets.removeString (x.toString());
}

void GrainFace::lfoChanged()
{
    lfoSend();
    keep();
    repaintLayer ("lfoRows");
    for (auto& l : layers)
        if (l->name.startsWith ("bar:"))
            l->repaint();
    repaintLayer ("segs");
}

// ───────────────────────────────────────────────────────── A/B, Randomize

juce::var GrainFace::snapshot (bool withRack)
{
    auto s = obj();
    put (s, "stretch", deepCopy (draft));
    put (s, "lfo", juce::JSON::parse (juce::JSON::toString (lfoPayload())));
    if (withRack)
        put (s, "rack", deepCopy (rack));
    return s;
}

void GrainFace::restoreSnapshot (const juce::var& o)
{
    draft = deepCopy (o["stretch"]);
    postAll (juce::var());
    if (o["rack"].isObject())
    {
        auto r = deepCopy (o["rack"]);
        put (r, "op", "set");
        rack = grainCall ("rack", r);
    }
}

void GrainFace::switchAB (const juce::String& k)
{
    if (k == ab || !draft.isObject())
        return;
    abs[ab == "A" ? 0 : 1] = snapshot (true);
    ab = k;
    // The first visit to B is A as it stands, to depart from.
    if (abs[k == "A" ? 0 : 1].isObject())
        restoreSnapshot (abs[k == "A" ? 0 : 1]);
    keep();
    repaintLayer ("segs");
}

void GrainFace::randomize (bool nudge)
{
    if (!draft.isObject())
        return;
    rndPrev = snapshot (false);
    juce::Random r;
    for (const auto& [k, c] : ctls)
    {
        if (k == "semitones" || c.sw || !c.seg.isEmpty())
            continue;
        if (cur().bars.count (k) == 0)
            continue;
        if (nudge)
            setV (k, fromN (c, clamp01 (toN (c, read (k)) + (r.nextDouble() * 2 - 1) * 0.1)));
        else
            setV (k, fromN (c, r.nextDouble()));
    }
    postAll (juce::var());
    repaintLayer ("texts");
}

void GrainFace::say (const juce::String& s)
{
    if (onMessage)
        onMessage (s);
}

juce::String GrainFace::fmtS (double s) const
{
    return s < 1 ? rnd (s * 1000) + " ms" : fixed (s, 2) + " s";
}

juce::String GrainFace::stateJson() const
{
    auto s = obj();
    put (s, "engine", engine);
    put (s, "stretch", draft);
    put (s, "fx", fxView);
    put (s, "loop", loopOn);
    put (s, "cue", cue);
    put (s, "sel", hasSel ? juce::var (juce::Array<juce::var> { selA, selB }) : juce::var());
    put (s, "oct", oct);
    put (s, "voice", voice.mode);
    put (s, "run", voice.run);
    put (s, "held", (int) held.size());
    put (s, "mapI", mapI);
    put (s, "czA", czA);
    put (s, "czB", czB);
    put (s, "amp", juce::Array<juce::var> { amp.a, amp.d, amp.s, amp.r });
    juce::Array<juce::var> ls;
    for (const auto& L : lfo)
        ls.add (juce::var (L.shape + "|" + L.mode + "|" + juce::String (L.sync ? 1 : 0) + "|" + juce::String (L.rate, 3) + "|" + juce::String (L.depth, 3) + "|" + L.targets.joinIntoString (",")));
    put (s, "lfo", ls);
    put (s, "preset", presetName);
    put (s, "ab", ab);
    return juce::JSON::toString (s, true);
}

void GrainFace::chooseEngine (const juce::String& alg)
{
    if (!draft.isObject())
        return;
    fxView = false;
    put (draft, "algorithm", alg);
    engine = alg;
    showPage();
    send (false);
    repaint();
}

juce::Rectangle<float> GrainFace::where (const juce::String& part) const
{
    const auto& p = cur();
    if (part.startsWith ("bar:"))
    {
        auto it = p.bars.find (part.fromFirstOccurrenceOf ("bar:", false, false));
        if (it == p.bars.end())
            return {};
        if (auto* w = child (it->second.n, "gs-bw"))
            return rectOf ((*w)["rect"]);
        if (auto* t = child (it->second.n, "gs-tg"))
            return rectOf ((*t)["rect"]);
        if (auto* s = child (it->second.n, "gs-seg"))
            return rectOf ((*s)["rect"]);
        return it->second.r;
    }
    if (part.startsWith ("tab:"))
    {
        auto it = p.tabs.find (part.fromFirstOccurrenceOf ("tab:", false, false));
        return it == p.tabs.end() ? juce::Rectangle<float>() : it->second.r;
    }
    auto it = p.ids.find (part);
    return it == p.ids.end() ? juce::Rectangle<float>() : it->second.r;
}

std::vector<std::pair<juce::String, double>> GrainFace::profile (float scale)
{
    std::vector<std::pair<juce::String, double>> out;
    for (auto& l : layers)
    {
        if (l->getWidth() <= 0 || l->getHeight() <= 0)
            continue;
        juce::Image img (juce::Image::ARGB, juce::jmax (1, (int) (l->getWidth() * scale)), juce::jmax (1, (int) (l->getHeight() * scale)), true);
        juce::Graphics g (img);
        g.addTransform (juce::AffineTransform::scale (scale));
        const double t0 = juce::Time::getMillisecondCounterHiRes();
        l->paint (g);
        out.push_back ({ l->name, juce::Time::getMillisecondCounterHiRes() - t0 });
    }
    std::sort (out.begin(), out.end(), [] (const auto& a, const auto& b) { return a.second > b.second; });
    return out;
}

// ──────────────────────────────────────────────────────────────── the hands

juce::String GrainFace::barAt (juce::Point<float> p, bool wellOnly) const
{
    for (const auto& [k, b] : cur().bars)
    {
        if (!b.r.contains (p))
            continue;
        if (!wellOnly)
            return k;
        if (auto* w = child (b.n, "gs-bw"); w != nullptr && rectOf ((*w)["rect"]).contains (p))
            return k;
    }
    return {};
}

juce::String GrainFace::loopGrabAt (float x, float y) const
{
    // gsLoopGrab, on SOURCE's own coordinates.
    const auto r = pageNodes.at ("wsola").ids.at ("gsCloud").r;
    const float w = r.getWidth(), h = r.getHeight(), bot = h - 14;
    const auto [va, vb] = cloudView();
    auto X = [&] (double s) { return (float) (6 + (s - va) / (vb - va) * (w - 12)); };
    const auto [a, b] = loopSecs();
    if (auto* regs = annotations["regions"].getArray(); regs != nullptr && y >= bot - 10 && y <= bot + 1)
        for (int i = 0; i < regs->size(); ++i)
            if (x >= X (dnum ((*regs)[i]["start"]) / fileRate) && x <= X (dnum ((*regs)[i]["end"]) / fileRate))
                return "region:" + juce::String (i);
    if (y >= 24 && y < bot && hasSel && selB > selA)
    {
        const float da = std::abs (x - X (a)), db = std::abs (x - X (b));
        if (juce::jmin (da, db) < 6)
            return da <= db ? "a" : "b";
    }
    if (y < 24)
    {
        const float da = std::abs (x - X (a)), db = std::abs (x - X (b)), dc = std::abs (x - X (cue / fileRate));
        const juce::String br = juce::jmin (da, db) < 6 ? (da <= db ? "a" : "b") : "";
        const juce::String cu = dc < 6 ? "cue" : "";
        if (br.isNotEmpty() && cu.isNotEmpty())
            return y < 11 ? br : cu;
        if (br.isNotEmpty() || cu.isNotEmpty())
            return br.isNotEmpty() ? br : cu;
    }
    return y >= bot ? "sel" : "";
}

void GrainFace::mouseMove (const juce::MouseEvent& e)
{
    const auto p = e.position;
    auto cursor = juce::MouseCursor::NormalCursor;
    if (barAt (p, true).isNotEmpty())
        cursor = juce::MouseCursor::LeftRightResizeCursor;
    const auto cr = pageNodes["wsola"].ids["gsCloud"].r;
    if (!fxView && cr.contains (p))
    {
        const auto g = loopGrabAt (p.x - cr.getX(), p.y - cr.getY());
        cursor = g == "a" || g == "b" || g == "cue" ? juce::MouseCursor::LeftRightResizeCursor : g.startsWith ("region") ? juce::MouseCursor::PointingHandCursor : juce::MouseCursor::CrosshairCursor;
    }
    setMouseCursor (cursor);
}

void GrainFace::mouseDown (const juce::MouseEvent& e)
{
    if (blocked && blocked (e))
        return;
    grabKeyboardFocus();
    const auto p = e.position;
    down = last = p;
    moved = 0;
    grab = Grab::none;
    auto& ids = cur().ids;
    auto in = [&] (const char* k) { auto it = ids.find (k); return it != ids.end() && it->second.r.contains (p); };

    // Map: a press on a control maps it and goes no further.
    if (mapI >= 0 && !in (("gsLmap" + juce::String (mapI)).toRawUTF8()))
    {
        const auto k = barAt (p, false);
        if (k.isEmpty())
        {
            mapI = -1;
            repaintLayer ("lfoRows");
            return;
        }
        const auto& c = ctls[k];
        if (c.sw || !c.seg.isEmpty())
        {
            say ("A switch or a choice: an LFO sweeps bars and knobs");
            return;
        }
        const auto tid = lfoId (k);
        const auto why = lfoState["refuse"][juce::Identifier (tid)].toString();
        if (why.isNotEmpty())
        {
            say (why);
            return;
        }
        auto& L = lfo[(size_t) mapI];
        if (L.targets.contains (tid))
            L.targets.removeString (tid);
        else
            L.targets.add (tid);
        if (!e.mods.isShiftDown())
            mapI = -1;
        lfoChanged();
        return;
    }

    // The effects view: its cards, back, add, the three faders.
    if (fxView && fxCardMouse (e, 0))
        return;
    if (fxView)
    {
        if (in ("gsFxBack"))
        {
            fxView = false;
            showPage();
            return;
        }
        if (in ("gsFxAddChip"))
        {
            menu ("fx", ids["gsFxAddChip"].r);
            return;
        }
        for (const char* fd : { "gsFdL", "gsFdLR", "gsFdR" })
            if (in (fd))
            {
                const auto r = ids[fd].r;
                const juce::String which (fd);
                auto setAt = [this, r, which] (float y) {
                    const double u = clamp01 (1 - (y - r.getY() - 8) / (r.getHeight() - 16));
                    auto m = obj();
                    if (which == "gsFdLR")
                    {
                        volume = u;
                        put (m, "gain", volume);
                    }
                    else
                    {
                        (which == "gsFdL" ? sideL : sideR) = u;
                        put (m, which == "gsFdL" ? "gainL" : "gainR", std::pow (u / 0.8, 2.0));
                    }
                    transport (m);
                    repaintLayer ("fxview");
                };
                if (e.getNumberOfClicks() >= 2)
                {
                    setAt (r.getY() + 8 + (float) (1 - (which == "gsFdLR" ? 0.85 : 0.8)) * (r.getHeight() - 16));
                    return;
                }
                setAt (p.y);
                grab = Grab::master;
                grabKey = which;
                return;
            }
    }
    // The engine tabs.
    for (const auto& [eng, t] : cur().tabs)
        if (t.r.contains (p))
        {
            if (e.getNumberOfClicks() == 1)
                chooseEngine (eng);
            return;
        }
    // The bars, switches and choices.
    if (const auto k = barAt (p, false); k.isNotEmpty())
    {
        const auto& c = ctls[k];
        if (dimmed (k))
            return;
        const auto& node = cur().bars[k].n;
        if (auto* svg = child (node, "svg"); svg != nullptr && rectOf ((*svg)["rect"]).contains (p))
        {
            if (e.getNumberOfClicks() >= 2)
                user (k, c.d);
            return;
        }
        if (c.sw)
        {
            if (auto* t = child (node, "gs-tg"); t != nullptr && rectOf ((*t)["rect"]).contains (p))
                user (k, read (k) >= 0.5 ? 0 : 1);
            return;
        }
        if (!c.seg.isEmpty())
        {
            if (auto* s = child (node, "gs-seg"))
                if (auto* kids = (*s)["kids"].getArray())
                    for (int i = 0; i < kids->size(); ++i)
                        if (rectOf ((*kids)[i]["rect"]).contains (p))
                            user (k, i);
            return;
        }
        if (auto* w = child (node, "gs-bw"); w != nullptr && rectOf ((*w)["rect"]).contains (p))
        {
            const auto wr = rectOf ((*w)["rect"]);
            grab = Grab::bar;
            grabKey = k;
            grabN = toN (c, read (k));
            if (!e.mods.isShiftDown())
            {
                grabN = clamp01 ((p.x - wr.getX() - 4) / (wr.getWidth() - 8));
                setN (k, grabN);
                sendSoon (true);
            }
            return;
        }
        return;
    }
    // Painting: a stroke begun between the bars sets each bar it crosses.
    if (in ("gsShared") || in ("gsESects") || in ("gsERight"))
    {
        grab = Grab::paint;
        painted.clear();
        return;
    }
    // The page's own row.
    if (in ("gsRndBtn"))
    {
        randomize (e.mods.isShiftDown());
        return;
    }
    if (in ("gsAB"))
    {
        const auto r = ids["gsAB"].r;
        switchAB (p.x < r.getCentreX() ? "A" : "B");
        return;
    }
    if (in ("gsPb"))
    {
        const auto r = ids["gsPb"].r;
        if (p.x < r.getX() + 28)
            presetStep (-1);
        else if (p.x < r.getX() + 262)
            presetMenu (ids["gsPb"].r);
        else if (p.x < r.getX() + 288)
            presetStep (1);
        else if (p.x >= r.getX() + 358 && p.x < r.getX() + 424)
            savePreset (false);
        else if (p.x >= r.getX() + 428 && p.x < r.getX() + 458)
            presetMenu (ids["gsPb"].r);
        return;
    }
    // The head: the FX strip, the volume, the load meter.
    if (in ("gsFxLab"))
    {
        fxView = !fxView;
        showPage();
        return;
    }
    if (in ("gsMaster"))
    {
        grab = Grab::master;
        grabKey.clear();
        const auto r = ids["gsMaster"].r;
        volume = clamp01 ((p.x - r.getX() - 4) / (r.getWidth() - 8));
        auto m = obj();
        put (m, "gain", volume);
        transport (m);
        repaintLayer ("gsMaster");
        return;
    }
    if (in ("gsFxStrip"))
    {
        // A tile's light turns its effect on and off; the tile opens the
        // effects; ＋ adds one (gsFxBuildRow).
        int ti = 0;
        if (auto* k = ids["gsFxStrip"].n["kids"].getArray())
            for (const auto& kid : *k)
            {
                if (hasClass (kid, "gs-tplus"))
                {
                    if (rectOf (kid["rect"]).contains (p))
                    {
                        menu ("fx", rectOf (kid["rect"]));
                        return;
                    }
                    continue;
                }
                if (!hasClass (kid, "gs-tile"))
                    continue;
                const auto* led = child (kid, "gs-led");
                if (led != nullptr && rectOf ((*led)["rect"]).expanded (3).contains (p))
                {
                    auto op = obj();
                    put (op, "op", "bypass");
                    put (op, "at", ti);
                    rack = grainCall ("rack", op);
                    repaintLayer ("strip");
                    return;
                }
                if (rectOf (kid["rect"]).contains (p))
                {
                    fxView = true;
                    showPage();
                    return;
                }
                ++ti;
            }
        menu ("fx", ids["gsFxStrip"].r);
        return;
    }
    // SOURCE's chips and zoom.
    if (in ("gsLoopChip") || in ("gsTLoop"))
    {
        loopOn = !loopOn;
        applyLoop();
        return;
    }
    if (in ("gsRegChip"))
    {
        auto* regs = annotations["regions"].getArray();
        if (regs == nullptr || regs->isEmpty())
        {
            say ("No regions yet: make them on the Regions page");
            return;
        }
        int at = -1;
        for (int i = 0; i < regs->size(); ++i)
            if (std::abs (dnum ((*regs)[i]["start"]) / fileRate - loopSecs().first) < 0.01)
                at = i;
        const auto& r = (*regs)[(at + 1) % regs->size()];
        hasSel = true;
        selA = dnum (r["start"]);
        selB = dnum (r["end"]);
        cue = selA;
        applyLoop();
        return;
    }
    if (in ("gsFollow"))
    {
        follow = !follow;
        keep();
        repaintLayer ("texts");
        return;
    }
    auto zoom = [this] (double f, double at) {
        const auto [ca, cb] = cloudView();
        const double b = fileLen();
        double na = at - (at - ca) * f, nb = at + (cb - at) * f;
        if (nb - na >= b - 1e-6)
        {
            czA = czB = 0;
            return;
        }
        if (nb - na < 0.03)
            return;
        if (na < 0) { nb -= na; na = 0; }
        if (nb > b) { na -= nb - b; nb = b; }
        czA = na;
        czB = nb;
    };
    if (in ("gsCzIn"))
    {
        zoom (0.5, head());
        repaintLayer ("gsCloud");
        repaintLayer ("texts");
        return;
    }
    if (in ("gsCzOut"))
    {
        const auto [ca, cb] = cloudView();
        zoom (2, (ca + cb) / 2);
        repaintLayer ("gsCloud");
        repaintLayer ("texts");
        return;
    }
    if (in ("gsCzFit"))
    {
        czA = czB = 0;
        repaintLayer ("gsCloud");
        repaintLayer ("texts");
        return;
    }
    if (in ("gsTuneBtn") || in ("gsKbScale"))
    {
        tuneMenu (ids[in ("gsTuneBtn") ? "gsTuneBtn" : "gsKbScale"].r);
        return;
    }
    if (in ("gsReroll"))
    {
        // The tray's own formula: a new seed.
        auto g = draft["grain"];
        if (g.isObject())
            put (g, "seed", (int) juce::Random::getSystemRandom().nextInt (1 << 30) + 1);
        send (false);
        return;
    }
    if (in ("gsEngReset"))
    {
        // Every engine's own controls and the grain's back to where they start.
        for (const auto& [k, c] : ctls)
            if (c.at != "s" || k == "cloudMix")
                write (k, c.d);
        send (false);
        return;
    }
    if (in ("gsSeedRow"))
        return;
    // SOURCE itself.
    if (in ("gsCloud") && !fxView)
    {
        const auto cr = ids["gsCloud"].r;
        const float x = p.x - cr.getX(), y = p.y - cr.getY();
        if (e.getNumberOfClicks() >= 2)
        {
            czA = czB = 0;
            repaintLayer ("gsCloud");
            return;
        }
        const auto [va, vb] = cloudView();
        auto toS = [&, va = va, vb = vb] (float px) { return juce::jlimit (0.0, fileLen(), va + (px - 6) / (cr.getWidth() - 12) * (vb - va)); };
        grabS0 = toS (x);
        grabEnds = loopSecs();
        loopGrab = loopGrabAt (x, y);
        if (loopGrab.startsWith ("region:"))
        {
            const auto& r = annotations["regions"][loopGrab.fromFirstOccurrenceOf (":", false, false).getIntValue()];
            hasSel = true;
            selA = dnum (r["start"]);
            selB = dnum (r["end"]);
            applyLoop();
            return;
        }
        if (e.mods.isAltDown() && y >= cr.getHeight() - 14)
            loopGrab = "scrub";
        if (loopGrab.isEmpty())
        {
            // On the read head's box a drag is Position; ⇧ beside it, the jitters.
            const double w2 = read ("windowMs") / 2000;
            const double hp = head() + (cloudActive() ? read ("position") * fileLen() : 0);
            auto X = [&, va = va, vb = vb] (double s) { return 6 + (s - va) / (vb - va) * (cr.getWidth() - 12); };
            const double bw = juce::jmax (6.0, X (hp + w2) - X (hp - w2));
            if (std::abs (x - X (hp)) <= bw / 2 + 5)
                loopGrab = "pos";
            else if (e.mods.isShiftDown())
                loopGrab = "spray";
            else
                loopGrab = "sel";
        }
        grab = Grab::loop;
        if (loopGrab == "scrub")
            seekSource (grabS0 * fileRate);
        mouseDrag (e);
        return;
    }
    // AMP.
    if (in ("gsAmp"))
    {
        const auto r = ids["gsAmp"].r;
        const float x = p.x - r.getX(), W = r.getWidth() - 16;
        const double ta = std::sqrt (amp.a) * 0.22 * W, td = std::sqrt (amp.d) * 0.26 * W, hold = 0.16 * W, tr = std::sqrt (amp.r) * 0.36 * W;
        const double xa = 8 + ta, xd = xa + td, xr = xd + hold + tr;
        const double da = std::abs (xa - x), dd = std::abs (xd - x), dr = std::abs (xr - x);
        grabKey = da <= dd && da <= dr ? "a" : dd <= dr ? "d" : "r";
        grab = Grab::amp;
        return;
    }
    // The LFO rows.
    for (int i = 0; i < 4; ++i)
    {
        auto& L = lfo[(size_t) i];
        const auto si = juce::String (i);
        auto segHit = [&] (const juce::String& cid) -> int {
            auto it = ids.find (cid);
            if (it == ids.end() || !it->second.r.contains (p))
                return -1;
            if (auto* kids = it->second.n["kids"].getArray())
                for (int j = 0; j < kids->size(); ++j)
                    if (rectOf ((*kids)[j]["rect"]).contains (p))
                        return j;
            return -1;
        };
        if (const int j = segHit ("gsLshp" + si); j >= 0)
        {
            L.shape = lfoShapes[j];
            lfoChanged();
            return;
        }
        if (const int j = segHit ("gsLmode" + si); j >= 0)
        {
            L.mode = j == 0 ? "free" : "trig";
            lfoChanged();
            return;
        }
        if (const int j = segHit ("gsLsync" + si); j >= 0)
        {
            L.sync = j == 1;
            lfoChanged();
            return;
        }
        if (in (("gsLmap" + si).toRawUTF8()))
        {
            mapI = mapI == i ? -1 : i;
            repaintLayer ("lfoRows");
            return;
        }
        for (const char* kk : { "gsLkr", "gsLkd" })
            if (in ((kk + si).toRawUTF8()))
            {
                const bool rate = juce::String (kk) == "gsLkr";
                if (e.getNumberOfClicks() >= 2)
                {
                    (rate ? L.rate : L.depth) = rate ? 0.4 : 0.5;
                    lfoChanged();
                    return;
                }
                grab = Grab::knob;
                grabI = i * 2 + (rate ? 0 : 1);
                grabU = rate ? L.rate : L.depth;
                return;
            }
        if (in (("gsLtg" + si).toRawUTF8()) && !L.targets.isEmpty())
        {
            // A chip's ×: unmap it. (The chips are laid out as drawLfoRow lays them.)
            const auto r = ids["gsLtg" + si].r;
            float cx = r.getX();
            for (int t = 0; t < juce::jmin (4, L.targets.size()); ++t)
            {
                const float cw = 60;
                if (p.x >= cx + cw - 14 && p.x < cx + cw)
                {
                    L.targets.remove (t);
                    lfoChanged();
                    return;
                }
                cx += cw + 3;
            }
            return;
        }
    }
    // The dock.
    if (in ("gsBend"))
    {
        grab = Grab::bend;
        return;
    }
    if (in ("gsGlide"))
    {
        grab = Grab::glide;
        return;
    }
    if (in ("gsOctSeg"))
    {
        const auto r = ids["gsOctSeg"].r;
        if (p.x < r.getX() + r.getWidth() / 3)
            setOct (oct - 1);
        else if (p.x > r.getRight() - r.getWidth() / 3)
            setOct (oct + 1);
        return;
    }
    if (in ("gsVmode"))
    {
        if (auto* kids = ids["gsVmode"].n["kids"].getArray())
            for (int j = 0; j < kids->size(); ++j)
                if (rectOf ((*kids)[j]["rect"]).contains (p))
                {
                    static const char* modes[] = { "mono", "legato", "poly" };
                    voice.mode = modes[juce::jlimit (0, 2, j)];
                    auto v = obj();
                    put (v, "mode", voice.mode);
                    voicePost (v);
                    keep();
                    repaintLayer ("segs");
                }
        return;
    }
    if (in ("gsRunBtn"))
    {
        voice.run = !voice.run;
        auto v = obj();
        put (v, "run", voice.run);
        voicePost (v);
        if (voice.run && !playing)
            play();
        keep();
        repaintLayer ("segs");
        return;
    }
    if (in ("gsBendLab"))
    {
        const int R[] = { 1, 2, 7, 12 };
        int at = 0;
        for (int j = 0; j < 4; ++j)
            if (R[j] == voice.bendR)
                at = j;
        voice.bendR = R[(at + 1) % 4];
        auto v = obj();
        put (v, "bendRange", voice.bendR);
        voicePost (v);
        keep();
        repaintLayer ("texts");
        return;
    }
    if (in ("gsMidiCh"))
    {
        juce::PopupMenu m;
        for (int ch = 1; ch <= 16; ++ch)
            m.addItem (ch, "MIDI " + juce::String (ch), true, ch == midiChannel);
        m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (this).withTargetScreenArea (localAreaToGlobal (ids["gsMidiCh"].r.toNearestInt())), [this] (int r) {
            if (r > 0)
            {
                midiChannel = r;
                keep();
                repaint();
            }
        });
        return;
    }
    if (const int k = keyAt (p); k >= 0)
    {
        grab = Grab::keys;
        keyDown = k;
        const auto r = ids["gsKeys"].r;
        note (k, (float) (0.4 + 0.6 * clamp01 ((p.y - r.getY()) / r.getHeight())), true);
        return;
    }
}

void GrainFace::mouseDrag (const juce::MouseEvent& e)
{
    if (fxDrag >= 0 && fxCardMouse (e, 1))
        return;
    const auto p = e.position;
    const float dx = p.x - last.x, dy = p.y - last.y;
    moved += std::abs (dx) + std::abs (dy);
    last = p;
    auto& ids = cur().ids;
    switch (grab)
    {
        case Grab::bar:
        {
            const auto& c = ctls[grabKey];
            const auto* w = child (cur().bars[grabKey].n, "gs-bw");
            if (w == nullptr)
                break;
            const auto wr = rectOf ((*w)["rect"]);
            if (e.mods.isShiftDown())
                grabN = clamp01 (grabN + dx / (wr.getWidth() - 8) * 0.1);
            else
                grabN = clamp01 ((p.x - wr.getX() - 4) / (wr.getWidth() - 8));
            juce::ignoreUnused (c);
            setN (grabKey, grabN);
            sendSoon (true);
            break;
        }
        case Grab::paint:
        {
            const auto k = barAt (p, false);
            if (k.isEmpty() || painted.count (k) > 0 || dimmed (k))
                break;
            const auto& c = ctls[k];
            if (c.sw || !c.seg.isEmpty())
                break;
            painted.insert (k);
            if (const auto* w = child (cur().bars[k].n, "gs-bw"))
            {
                const auto wr = rectOf ((*w)["rect"]);
                setN (k, (p.x - wr.getX() - 4) / (wr.getWidth() - 8));
                sendSoon (true);
            }
            break;
        }
        case Grab::amp:
        {
            if (grabKey == "a")
                amp.a = juce::jlimit (0.005, 1.0, amp.a + dx / 140.0);
            else if (grabKey == "d")
            {
                amp.d = juce::jlimit (0.01, 1.0, amp.d + dx / 140.0);
                amp.s = clamp01 (amp.s - dy / 60.0);
            }
            else
                amp.r = juce::jlimit (0.01, 1.0, amp.r + dx / 140.0);
            auto v = obj();
            put (v, "attack", amp.a * amp.a * 4);
            put (v, "decay", amp.d * amp.d * 4);
            put (v, "sustain", amp.s);
            put (v, "release", amp.r * amp.r * 6);
            voicePost (v);
            repaintLayer ("gsAmp");
            repaintLayer ("texts");
            break;
        }
        case Grab::knob:
        {
            auto& L = lfo[(size_t) (grabI / 2)];
            grabU = clamp01 (grabU - dy / (e.mods.isShiftDown() ? 150.0 * 5 : 150.0));
            (grabI % 2 == 0 ? L.rate : L.depth) = grabU;
            lfoSend();
            repaintLayer ("lfoRows");
            break;
        }
        case Grab::glide:
        {
            voice.glide = clamp01 (voice.glide + dx / 150.0);
            auto v = obj();
            put (v, "glide", voice.glide * voice.glide * 2);
            voicePost (v);
            repaintLayer ("gsGlide");
            break;
        }
        case Grab::bend:
        {
            bend = juce::jlimit (-1.0, 1.0, bend - dy / 50.0);
            auto v = obj();
            put (v, "bend", bend * voice.bendR);
            voicePost (v);
            repaintLayer ("gsBend");
            break;
        }
        case Grab::master:
        {
            if (grabKey.startsWith ("gsFd"))
            {
                const auto r = ids[grabKey].r;
                const double u = clamp01 (1 - (p.y - r.getY() - 8) / (r.getHeight() - 16));
                auto m = obj();
                if (grabKey == "gsFdLR")
                {
                    volume = u;
                    put (m, "gain", volume);
                }
                else
                {
                    (grabKey == "gsFdL" ? sideL : sideR) = u;
                    put (m, grabKey == "gsFdL" ? "gainL" : "gainR", std::pow (u / 0.8, 2.0));
                }
                transport (m);
                repaintLayer ("fxview");
                break;
            }
            const auto r = ids["gsMaster"].r;
            volume = clamp01 ((p.x - r.getX() - 4) / (r.getWidth() - 8));
            auto m = obj();
            put (m, "gain", volume);
            transport (m);
            repaintLayer ("gsMaster");
            break;
        }
        case Grab::keys:
        {
            const int k = keyAt (p);
            if (k < 0 || k == keyDown)
                break;
            if (!e.mods.isShiftDown() && keyDown >= 0)
                note (keyDown, 0, false);
            const auto r = ids["gsKeys"].r;
            note (k, (float) (0.4 + 0.6 * clamp01 ((p.y - r.getY()) / r.getHeight())), true);
            keyDown = k;
            break;
        }
        case Grab::loop:
        {
            const auto cr = pageNodes["wsola"].ids["gsCloud"].r;
            const float x = p.x - cr.getX(), y = p.y - cr.getY();
            const auto [va, vb] = cloudView();
            const double s = juce::jlimit (0.0, fileLen(), va + (x - 6) / (cr.getWidth() - 12) * (vb - va));
            const double one = 1.0 / juce::jmax (1.0, fileRate);
            auto setLoop = [this] (double a, double b) {
                const double lo = juce::jlimit (0.0, fileLen(), juce::jmin (a, b)), hi = juce::jlimit (0.0, fileLen(), juce::jmax (a, b));
                hasSel = true;
                selA = jsRound (lo * fileRate);
                selB = juce::jmax (selA + 1, jsRound (hi * fileRate));
                if (cue < selA || cue >= selB)
                    cue = selA;
                applyLoop();
            };
            if (loopGrab == "scrub")
                seekSource (s * fileRate);
            else if (loopGrab == "a")
                setLoop (juce::jmin (s, grabEnds.second - one), grabEnds.second);
            else if (loopGrab == "b")
                setLoop (grabEnds.first, juce::jmax (s, grabEnds.first + one));
            else if (loopGrab == "cue")
            {
                cue = jsRound (s * fileRate);
                keep();
            }
            else if (loopGrab == "sel" && moved > 3)
            {
                setLoop (juce::jmin (grabS0, s), juce::jmax (grabS0, s));
                cue = jsRound (juce::jmin (grabS0, s) * fileRate);
            }
            else if (loopGrab == "pos")
            {
                grab = Grab::cloud;
                setV ("position", (s - head()) / juce::jmax (1e-9, fileLen()));
                sendSoon (true);
                grab = Grab::loop;
            }
            else if (loopGrab == "spray")
            {
                const double hp = head() + (cloudActive() ? read ("position") * fileLen() : 0);
                auto X = [&, va = va, vb = vb] (double t) { return 6 + (t - va) / (vb - va) * (cr.getWidth() - 12); };
                const double yc = cr.getHeight() * 0.6, K = (cr.getHeight() * 0.4 - 16) / 12;
                grab = Grab::cloud;
                setV ("positionJitterMs", std::abs (x - X (hp)) / (cr.getWidth() - 12) * (vb - va) * 1000);
                setV ("pitchJitterSemis", std::abs (y - yc) / K);
                sendSoon (true);
                grab = Grab::loop;
            }
            repaintLayer ("gsCloud");
            repaintLayer ("texts");
            break;
        }
        default:
            break;
    }
}

void GrainFace::mouseUp (const juce::MouseEvent& e)
{
    if (fxDrag >= 0 && fxCardMouse (e, 2))
        return;
    switch (grab)
    {
        case Grab::bar:
        case Grab::paint:
            grab = Grab::none;
            sendSoon (false);
            break;
        case Grab::amp:
        case Grab::glide:
        case Grab::knob:
            keep();
            break;
        case Grab::bend:
        {
            bend = 0;
            auto v = obj();
            put (v, "bend", 0);
            voicePost (v);
            repaintLayer ("gsBend");
            break;
        }
        case Grab::keys:
            if (keyDown >= 0)
            {
                for (auto it = held.begin(); it != held.end();)
                {
                    const int n = it->first;
                    ++it;
                    if (kbd.empty() || std::none_of (kbd.begin(), kbd.end(), [n] (const auto& x) { return x.second == n; }))
                        note (n, 0, false);
                }
            }
            keyDown = -1;
            break;
        case Grab::loop:
            if (loopGrab == "sel" && moved <= 3)
            {
                cue = jsRound (grabS0 * fileRate);
                seekSource (cue);
                keep();
            }
            else if (loopGrab == "pos" || loopGrab == "spray")
                sendSoon (false);
            else if (loopGrab != "scrub" && loopOn && hasSel)
                seekSource (selA);
            voiceSend();
            break;
        default:
            break;
    }
    grab = Grab::none;
    repaintLayer ("gsCloud");
}

void GrainFace::mouseDoubleClick (const juce::MouseEvent& e)
{
    if (fxView && fxCardMouse (e, 4))
        return;
    const auto p = e.position;
    // A bar's well: back to its default.
    if (const auto k = barAt (p, true); k.isNotEmpty() && !dimmed (k))
        user (k, ctls[k].d);
    for (const auto& [eng, t] : cur().tabs)
        if (t.r.contains (p))
        {
            // Every control back to its default, engine kept (resetEverything).
            for (const auto& [k, c] : ctls)
                if (k != "semitones")
                    write (k, c.d);
            put (draft, "algorithm", eng);
            send (false);
        }
    if (cur().ids.count ("gsLoadM") > 0 && cur().ids["gsLoadM"].r.contains (p))
        return;
}

void GrainFace::mouseWheelMove (const juce::MouseEvent& e, const juce::MouseWheelDetails& w)
{
    if (fxView && ! fxCards.empty())
    {
        const auto rail = cur().ids.count ("fxModuleRail") ? cur().ids["fxModuleRail"].r.withWidth (1360) : juce::Rectangle<float>();
        for (int i = 0; i < (int) fxCards.size(); ++i)
        {
            const auto at = fxCardAt (i);
            if (juce::Rectangle<float> (at.x, at.y, fxCards[(size_t) i]->width(), 400).contains (e.position) && std::abs (w.deltaY) >= std::abs (w.deltaX)
                && fxCards[(size_t) i]->wheel (e.position - at, w.deltaY, e.mods.isShiftDown()))
            {
                repaintLayer ("fxview");
                return;
            }
        }
        if (rail.contains (e.position))
        {
            float most = 0;
            for (auto& c : fxCards)
                most += c->width() + 10;
            most = juce::jmax (0.0f, most + 196 - rail.getWidth());
            fxScroll = juce::jlimit (0.0f, most, fxScroll - (std::abs (w.deltaX) > 0 ? w.deltaX : (e.mods.isShiftDown() ? w.deltaY : 0)) * 200);
            repaintLayer ("fxview");
            return;
        }
    }
    const auto cr = pageNodes["wsola"].ids["gsCloud"].r;
    if (fxView || !cr.contains (e.position))
    {
        Component::mouseWheelMove (e, w);
        return;
    }
    const auto [ca, cb] = cloudView();
    const double W = cr.getWidth() - 12, x = e.position.x - cr.getX();
    if (e.mods.isShiftDown() || std::abs (w.deltaX) > std::abs (w.deltaY))
    {
        if (czB > czA)
        {
            const double d = -(e.mods.isShiftDown() ? w.deltaY : w.deltaX) * 50 / W * (cb - ca);
            czA += d;
            czB += d;
            const auto v = cloudView();
            czA = v.first;
            czB = v.second;
        }
    }
    else
    {
        const double f = std::exp (juce::jlimit (-60.0, 60.0, (double) -w.deltaY * 100) * 0.006);
        const double at = ca + (x - 6) / W * (cb - ca);
        double na = at - (at - ca) * f, nb = at + (cb - at) * f;
        const double b = fileLen();
        if (nb - na >= b - 1e-6)
            czA = czB = 0;
        else if (nb - na >= 0.03)
        {
            if (na < 0) { nb -= na; na = 0; }
            if (nb > b) { na -= nb - b; nb = b; }
            czA = na;
            czB = nb;
        }
    }
    repaintLayer ("gsCloud");
    repaintLayer ("texts");
}

// ─────────────────────────────────────────────────────────── the menus

void GrainFace::menu (const juce::String& which, juce::Rectangle<float> near)
{
    if (which != "fx")
        return;
    // The strip: open the effects view, a slot's light, add one.
    juce::PopupMenu m;
    m.addItem (1, fxView ? "Back to the engine" : "Open the effects");
    if (auto* slots = rack["slots"].getArray())
        for (int i = 0; i < slots->size(); ++i)
        {
            juce::PopupMenu s;
            const bool off = (bool) (*slots)[i]["bypassed"];
            s.addItem (100 + i, off ? "Turn on" : "Turn off");
            s.addItem (200 + i, "Remove");
            m.addSubMenu ((*slots)[i]["kind"].toString(), s);
        }
    juce::PopupMenu add;
    int n = 1000;
    for (const char* k : { "eq", "comp", "gain", "prism:echo", "prism:dattorro-plate", "prism:lxp-hall", "prism:lxp-room" })
        add.addItem (n++, k);
    m.addSubMenu (uni ("\xef\xbc\x8b Add an effect"), add);
    m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (this).withTargetScreenArea (localAreaToGlobal (near.toNearestInt())), [this] (int r) {
        if (r == 1)
        {
            fxView = !fxView;
            showPage();
            return;
        }
        auto op = obj();
        if (r >= 100 && r < 200)
        {
            put (op, "op", "bypass");
            put (op, "at", r - 100);
        }
        else if (r >= 200 && r < 300)
        {
            put (op, "op", "remove");
            put (op, "at", r - 200);
        }
        else if (r >= 1000)
        {
            static const char* kinds[] = { "eq", "comp", "gain", "prism:echo", "prism:dattorro-plate", "prism:lxp-hall", "prism:lxp-room" };
            put (op, "op", "add");
            put (op, "kind", kinds[r - 1000]);
        }
        else
            return;
        rack = grainCall ("rack", op);
        repaintLayer ("strip");
    });
}

void GrainFace::tuneMenu (juce::Rectangle<float> near)
{
    juce::PopupMenu m;
    m.addItem (1, "Free", true, scaleName.isEmpty() && pitchStep == 0);
    m.addItem (2, "Semitone grid", true, scaleName.isEmpty() && pitchStep == 1);
    m.addItem (3, "Half-semitone grid", true, scaleName.isEmpty() && pitchStep == 0.5);
    juce::StringArray names;
    if (auto* gs = scales["groups"].getArray())
        for (const auto& g : *gs)
        {
            juce::PopupMenu sub;
            if (auto* ss = g["scales"].getArray())
                for (const auto& s : *ss)
                {
                    names.add (s["name"].toString());
                    sub.addItem (100 + names.size() - 1, s["name"].toString(), true, s["name"].toString() == scaleName);
                }
            m.addSubMenu (g["category"].toString(), sub);
        }
    m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (this).withTargetScreenArea (localAreaToGlobal (near.toNearestInt())), [this, names] (int r) {
        if (r <= 0)
            return;
        // pickScale: posted with the current pitch, so it snaps at once.
        auto extra = obj();
        if (r >= 100)
            put (extra, "scale", names[r - 100]);
        else
        {
            put (extra, "scale", "");
            put (extra, "pitchStep", r == 1 ? 0.0 : r == 2 ? 1.0 : 0.5);
        }
        postAll (extra);
    });
}

void GrainFace::presetMenu (juce::Rectangle<float> near)
{
    presets = grainCall ("presets", [] { auto o = obj(); put (o, "op", "list"); return o; }());
    juce::PopupMenu m;
    juce::StringArray names;
    if (auto* ps = presets["presets"].getArray())
        for (const auto& p : *ps)
        {
            names.add (p["name"].toString());
            m.addItem (names.size(), p["name"].toString() + (p["from"].toString() == "mgl" ? "  (MGL)" : ""), true, p["name"].toString() == presetName);
        }
    if (names.isEmpty())
        m.addItem (-1, "No presets yet", false);
    m.addSeparator();
    m.addItem (9001, "Save as" + uni ("\xe2\x80\xa6"));
    m.addItem (9002, "Rename" + uni ("\xe2\x80\xa6"), presetName.isNotEmpty());
    m.addItem (9003, "Delete", presetName.isNotEmpty());
    m.addItem (9004, "Init: every control to its default");
    m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (this).withTargetScreenArea (localAreaToGlobal (near.toNearestInt())), [this, names] (int r) {
        if (r > 0 && r <= names.size())
        {
            auto op = obj();
            put (op, "op", "apply");
            put (op, "name", names[r - 1]);
            const auto a = grainCall ("presets", op);
            if (a.isObject())
            {
                presetName = names[r - 1];
                rack = a["rack"];
                readDoc (a["edit"]);
                keep();
                say ("Applied " + uni ("\xe2\x80\x9c") + presetName + uni ("\xe2\x80\x9d"));
            }
            repaint();
        }
        else if (r == 9001)
            savePreset (true);
        else if (r == 9003)
        {
            auto op = obj();
            put (op, "op", "delete");
            put (op, "name", presetName);
            grainCall ("presets", op);
            presetName.clear();
            keep();
            repaint();
        }
        else if (r == 9002)
        {
            auto* w = new juce::AlertWindow ("Rename the preset", {}, juce::MessageBoxIconType::NoIcon);
            w->addTextEditor ("name", presetName);
            w->addButton ("Rename", 1);
            w->addButton ("Cancel", 0);
            w->enterModalState (true, juce::ModalCallbackFunction::create ([this, w] (int ok) {
                if (ok == 1)
                {
                    auto op = obj();
                    put (op, "op", "update");
                    put (op, "name", presetName);
                    put (op, "to", w->getTextEditorContents ("name"));
                    grainCall ("presets", op);
                    presetName = w->getTextEditorContents ("name");
                    keep();
                    repaint();
                }
            }), true);
        }
        else if (r == 9004)
        {
            for (const auto& [k, c] : ctls)
                if (k != "semitones")
                    write (k, c.d);
            send (false);
        }
    });
}

void GrainFace::presetStep (int by)
{
    presets = grainCall ("presets", [] { auto o = obj(); put (o, "op", "list"); return o; }());
    auto* ps = presets["presets"].getArray();
    if (ps == nullptr || ps->isEmpty())
        return;
    int at = -1;
    for (int i = 0; i < ps->size(); ++i)
        if ((*ps)[i]["name"].toString() == presetName)
            at = i;
    at = ((at + by) % ps->size() + ps->size()) % ps->size();
    auto op = obj();
    put (op, "op", "apply");
    put (op, "name", (*ps)[at]["name"]);
    const auto a = grainCall ("presets", op);
    if (a.isObject())
    {
        presetName = (*ps)[at]["name"].toString();
        rack = a["rack"];
        readDoc (a["edit"]);
        keep();
    }
    repaint();
}

void GrainFace::savePreset (bool asNew)
{
    auto store = [this] (const juce::String& name) {
        auto op = obj();
        put (op, "op", "save");
        put (op, "name", name);
        grainCall ("presets", op);
        presetName = name;
        keep();
        say ("Saved " + uni ("\xe2\x80\x9c") + name + uni ("\xe2\x80\x9d"));
        repaint();
    };
    if (!asNew && presetName.isNotEmpty())
    {
        store (presetName);
        return;
    }
    auto* w = new juce::AlertWindow ("Save these settings as", {}, juce::MessageBoxIconType::NoIcon);
    w->addTextEditor ("name", presetName.isEmpty() ? juce::String ("Preset 1") : presetName);
    w->addButton ("Save", 1);
    w->addButton ("Cancel", 0);
    w->enterModalState (true, juce::ModalCallbackFunction::create ([w, store] (int ok) {
        if (ok == 1 && w->getTextEditorContents ("name").trim().isNotEmpty())
            store (w->getTextEditorContents ("name").trim());
    }), true);
}

// ───────────────────────────────────────────────────── the effects view's cards

void GrainFace::syncFxCards()
{
    const auto now = juce::JSON::toString (rack);
    if (now == fxCardsFor && (int) fxCards.size() == (rack["slots"].isArray() ? rack["slots"].getArray()->size() : 0))
        return;
    fxCardsFor = now;
    if (! fxApi.isObject())
    {
        // MGL's /api/fx: the FX modules' call answers it for any module.
        std::vector<char> b (1u << 20);
        const auto n = call ([&] (NaApp* a) { return (int64_t) na_fx_call (a, id, "catalogue", nullptr, b.data(), (uint32_t) b.size()); });
        if (n > 0 && n < (int64_t) b.size())
            fxApi = juce::JSON::parse (juce::String::fromUTF8 (b.data(), (int) n));
    }
    const auto* slots = rack["slots"].getArray();
    const int n = slots == nullptr ? 0 : slots->size();
    while ((int) fxCards.size() > n)
        fxCards.pop_back();
    while ((int) fxCards.size() < n)
        fxCards.push_back (std::make_unique<FxCard> (fxApi));
    for (int i = 0; i < n; ++i)
    {
        auto& c = *fxCards[(size_t) i];
        c.set (juce::JSON::parse (juce::JSON::toString ((*slots)[i])), rack["ranges"]);
        c.send = [this, i] (const juce::var& msg) {
            auto m = juce::JSON::parse (juce::JSON::toString (msg));
            const auto op = m["op"].toString();
            if (op == "open" || op == "advanced")
                return;
            if (op == "slot")
            {
                // A slot's own fields (an EQ band's switch or type): the rack set again.
                auto all = juce::JSON::parse (juce::JSON::toString (rack));
                if (auto* slots = all["slots"].getArray(); slots != nullptr && i < slots->size())
                    slots->set (i, m["slot"]);
                put (all, "op", "set");
                m = all;
            }
            put (m, "at", i);
            // Grain's rack takes "on" as the slot's bypass.
            if (op == "bypass")
                put (m, "on", ! (bool) m["on"]);
            const auto r = grainCall ("rack", m);
            if (op != "param" && r.isObject())
                rack = r.hasProperty ("slots") ? r : grainCall ("rack", [] { auto o = obj(); put (o, "op", "get"); return o; }());
            else if (op == "param")
            {
                // The card has its value already; the rack's copy follows.
                auto o = obj();
                put (o, "op", "get");
                rack = grainCall ("rack", o);
                fxCardsFor = juce::JSON::toString (rack);
            }
            repaintLayer ("fxview");
        };
        c.changed = [this] { repaintLayer ("fxview"); };
    }
}

juce::Point<float> GrainFace::fxCardAt (int i) const
{
    auto it = pageNodes.find ("fx");
    if (it == pageNodes.end() || it->second.ids.count ("fxModuleRail") == 0)
        return {};
    const auto rail = it->second.ids.at ("fxModuleRail").r;
    float x = rail.getX() - fxScroll;
    for (int k = 0; k < i && k < (int) fxCards.size(); ++k)
        x += fxCards[(size_t) k]->width() + 10;
    return { x, rail.getY() };
}

bool GrainFace::fxCardMouse (const juce::MouseEvent& e, int kind)
{
    syncFxCards();
    if (kind == 1 || kind == 2)
    {
        if (fxDrag < 0 || fxDrag >= (int) fxCards.size())
            return false;
        auto& c = *fxCards[(size_t) fxDrag];
        if (kind == 1)
            c.mouseDrag (e.position - fxCardAt (fxDrag), e.mods);
        else
        {
            c.mouseUp();
            fxDrag = -1;
        }
        repaintLayer ("fxview");
        return true;
    }
    for (int i = 0; i < (int) fxCards.size(); ++i)
    {
        const auto at = fxCardAt (i);
        auto& c = *fxCards[(size_t) i];
        if (! juce::Rectangle<float> (at.x, at.y, c.width(), 400).contains (e.position))
            continue;
        if (kind == 4 ? c.doubleClick (e.position - at) : c.mouseDown (e.position - at, e.mods))
        {
            if (kind == 0)
                fxDrag = i;
            repaintLayer ("fxview");
            return true;
        }
    }
    return false;
}
