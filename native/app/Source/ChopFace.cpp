#include "ChopFace.h"

#include "Canvas2D.h"
#include "ChopUtil.h"
#include "Host.h"
#include "Places.h"

#include <cmath>

using namespace chopu;

namespace
{
// Where the lit capture's and the page's own nodes are kept in each Chrome's
// node map, so a switch can be drawn with either's look.
constexpr int litOff = 100000, pageOff = 200000;

const char* const modes[] = { "transient", "silence", "grid" };
const char* const divs[] = { "bar", "2", "4", "8", "16", "32" };
const char* const feels[] = { "straight", "dot", "trip" };
const char* const tools[] = { "pointer", "audition", "lock", "pencil" };
const char* const syncs[] = { "free", "lock" };
const char* const followModes[] = { "scroll", "page" };
const char* const fltTypes[] = { "lp", "bp", "hp" };
const char* const views[] = { "spectrum", "bright", "noise", "pitch", "attack", "level", "kind", "white" };
const char* const fxNames[] = { "env", "trans", "eq", "filter" };
const char* const fxOn[] = { "envOn", "trOn", "eqOn", "fltOn" };

// The texts the face writes itself (the page sets them from its state).
const char* const liveTexts[] = { "chopCycles", "chopTempoSaid", "chopBpm", "chopBpmNote", "chopStatus", "chopStatus2", "chopMeta", "chopSoft",
                                  "chopZoomRo", "chopPickRo", "chopPickAn", "chopPassRo", "chopHeard", "chopPattern" };

juce::StringArray arr (const char* const* a, int n)
{
    juce::StringArray s;
    for (int i = 0; i < n; ++i)
        s.add (a[i]);
    return s;
}
} // namespace

// ─────────────────────────────────────────────────────────────── building

ChopFace::ChopFace (Call c, uint32_t i)
    : call (std::move (c)), id (i), captured (face::page ("chop"))
{
    data = juce::JSON::parse (face::embeddedFile ("chop-page.json"));
    setSize (1432, 1000);
    setWantsKeyboardFocus (true);
    // Where Chop keeps its presets and writes a library sound's slices.
    chopCall ("home", put (obj(), "home", places::home().getFullPathName()));

    // Every knob, as the page's tables have them.
    auto knobOf = [] (const juce::var& s, const juce::String& group) {
        Knob k;
        k.key = s["key"].toString();
        k.label = s["label"].toString();
        k.min = dnum (s["min"]);
        k.max = dnum (s["max"], 1);
        k.step = dnum (s["step"], 0);
        k.def = dnum (s["def"]);
        k.log = (bool) s["log"];
        k.title = s["title"].toString();
        k.facet = s["facet"].toString();
        k.group = group;
        const auto w = s["when"].toString();
        k.when = w.contains ("'transient'") ? "transient" : w.contains ("'silence'") ? "silence" : w.contains ("'grid'") && w.contains ("!==") ? "!grid" : w.contains ("'grid'") ? "grid" : "";
        return k;
    };
    if (auto* groups = data["knobs"].getArray())
        for (const auto& grp : *groups)
            if (auto* specs = grp[1].getArray())
                for (const auto& s : *specs)
                {
                    auto k = knobOf (s, grp[0].toString());
                    knobs[k.key] = k;
                    knobOrder.push_back (k.key);
                }
    for (auto* fx : fxNames)
        if (auto* specs = data["fx"][fx]["specs"].getArray())
            for (const auto& s : *specs)
            {
                auto k = knobOf (s, fx);
                k.fx = true;
                k.fxLook = ix (data["fxLook"][juce::Identifier (k.key)], 0).toString();
                k.facet = ix (data["fxLook"][juce::Identifier (k.key)], 1).toString();
                knobs[k.key] = k;
                knobOrder.push_back (k.key);
            }

    page = std::make_unique<face::Chrome> (captured["page"]);
    empty = std::make_unique<face::Chrome> (captured["empty"]);
    index (captured["page"]["tree"], ids, {});
    index (captured["lit"]["tree"], litIds, {});
    index (captured["empty"]["tree"], emptyIds, {});

    // Every chrome can borrow the page's and the lit page's looks.
    std::function<void (face::Chrome&, const juce::var&, int)> adopt = [&] (face::Chrome& ch, const juce::var& n, int off) {
        ch.nodes[(int) n["i"] + off] = n;
        if (auto* k = n["kids"].getArray())
            for (const auto& kid : *k)
                adopt (ch, kid, off);
    };
    for (auto* ch : { page.get(), empty.get() })
    {
        adopt (*ch, captured["page"]["tree"], pageOff);
        adopt (*ch, captured["lit"]["tree"], litOff);
    }

    // Left out of the captures: what the face draws itself, live.
    auto prepare = [&] (face::Chrome& ch, const juce::var& tree) {
        std::function<void (const juce::var&, bool, bool)> go = [&] (const juce::var& n, bool inKnob, bool inBar) {
            const int ni = (int) n["i"];
            const auto nid = n["id"].toString();
            const bool knob = inKnob || hasClass (n, "chop-knob");
            const bool bar = inBar || hasClass (n, "chop-fx-bar");
            if (hasClass (n, "chop-layer") || hasClass (n, "chop-row") || hasClass (n, "ui-ring") || hasClass (n, "ui-cap") || hasClass (n, "chop-stat")
                || hasClass (n, "chop-said") || hasClass (n, "chop-edited") || hasClass (n, "sr") || hasClass (n, "chop-ovhead") || hasClass (n, "lgw")
                || (knob && hasClass (n, "ui-pic")) || (bar && hasClass (n, "gg")))
            {
                ch.skip.insert (ni);
                return;
            }
            if (hasClass (n, "ui-kval") || (nid.isNotEmpty() && arr (liveTexts, (int) std::size (liveTexts)).contains (nid))
                || n["data"]["pb"].toString() == "label" || n["data"]["pb"].toString() == "tag")
                ch.skipText.insert (ni);
            if (auto* k = n["kids"].getArray())
                for (const auto& kid : *k)
                    go (kid, knob, bar);
        };
        go (tree, false, false);
    };
    prepare (*page, captured["page"]["tree"]);
    prepare (*empty, captured["empty"]["tree"]);
    addChildComponent (*page);
    addChildComponent (*empty);

    // Looks the list's rows take, from the page and the lit page.
    auto firstOf = [] (const juce::var& tree, std::function<bool (const juce::var&)> want) -> juce::var {
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
    const auto& pt = captured["page"]["tree"];
    const auto& lt = captured["lit"]["tree"];
    rowPlain = firstOf (pt, [] (const juce::var& n) { return hasClass (n, "chop-row") && !hasClass (n, "current") && !hasClass (n, "picked"); });
    rowCurrent = firstOf (pt, [] (const juce::var& n) { return hasClass (n, "chop-row") && hasClass (n, "current"); });
    rowPicked = firstOf (lt, [] (const juce::var& n) { return hasClass (n, "chop-row") && hasClass (n, "picked") && !hasClass (n, "current"); });
    rowMuted = firstOf (lt, [] (const juce::var& n) { return hasClass (n, "chop-row") && hasClass (n, "muted"); });
    badgeOk = firstOf (lt, [] (const juce::var& n) { return hasClass (n, "tail-badge") && hasClass (n, "ok"); });
    badgeClamped = firstOf (lt, [] (const juce::var& n) { return hasClass (n, "tail-badge") && hasClass (n, "clamped"); });
    badgeSkip = firstOf (lt, [] (const juce::var& n) { return hasClass (n, "tail-badge") && hasClass (n, "skip"); });

    buildLayers();
    reload();
    startTimerHz (30);
}

ChopFace::~ChopFace()
{
    stopTimer();
}

void ChopFace::index (const juce::var& n, std::map<juce::String, Node>& into, const juce::String& prefix)
{
    const auto r = rectOf (n["rect"]);
    const Node node { (int) n["i"], r, n };
    const auto nid = n["id"].toString();
    if (nid.isNotEmpty())
        into[nid] = node;
    const auto k = n["data"]["k"].toString();
    if (k.isNotEmpty() && (hasClass (n, "chop-knob") || hasClass (n, "chop-fx-bar")))
        into["knob:" + k] = node;
    if (k.isNotEmpty() && hasClass (n, "chop-stat"))
        into["stat:" + k] = node;
    const auto fx = n["data"]["fx"].toString();
    if (fx.isNotEmpty())
        into["fx:" + fx] = node;
    if (hasClass (n, "chop-fxs-on"))
        into["pwr:" + prefix] = node;
    if (hasClass (n, "chop-fxs-body"))
        into["body:" + prefix] = node;
    if (hasClass (n, "chop-pic"))
        into["pic:" + prefix] = node;
    if (hasClass (n, "chop-flt-type"))
        into["fltType"] = node;
    if (hasClass (n, "chop-tail-on"))
        into["tailOn"] = node;
    if (hasClass (n, "chop-said"))
        into["said"] = node;
    if (hasClass (n, "chop-edited"))
        into["edited"] = node;
    if (hasClass (n, "newtab"))
        into["newtab"] = node;
    if (hasClass (n, "chop-list") || hasClass (n, "chop-lh"))
        into[hasClass (n, "chop-lh") ? "listHead" : "list"] = node;
    const auto pb = n["data"]["pb"].toString();
    if (pb.isNotEmpty())
        into["pb:" + pb] = node;
    if (auto* kids = n["kids"].getArray())
        for (const auto& kid : *kids)
            index (kid, into, fx.isNotEmpty() ? fx : prefix);
}

const juce::var* ChopFace::child (const juce::var& n, const juce::String& cls) const
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

juce::String ChopFace::cs (const juce::String& token) const
{
    return captured["page"].isObject() ? captured["cl"][juce::Identifier (token)].toString() : juce::String();
}

juce::Colour ChopFace::cl (const juce::String& token) const
{
    const auto s = cs (token);
    return s.isEmpty() ? juce::Colours::white : c2d::css (s);
}

ChopFace::Layer* ChopFace::addLayer (const juce::String& n, juce::Rectangle<float> r, std::function<void (juce::Graphics&)> draw)
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

void ChopFace::repaintLayer (const juce::String& n)
{
    if (auto it = named.find (n); it != named.end())
        it->second->repaint();
    else
        for (auto& l : layers)
            if (l->name.startsWith (n + ":"))
                l->repaint();
}

void ChopFace::buildLayers()
{
    auto at = [this] (const juce::String& nid) { return ids.count (nid) > 0 ? ids[nid].r : juce::Rectangle<float>(); };
    auto canvas = [&] (const juce::String& name, const juce::String& nid, std::function<void (juce::Graphics&, float, float)> draw, bool always = false) {
        const auto r = at (nid);
        addLayer (name, r, [this, r, draw, always] (juce::Graphics& g) {
            if (!always && !hasSound())
                return;
            draw (g, r.getWidth(), r.getHeight());
        });
    };
    // The detail: the sound (kept as a picture), what lies over it, the playhead.
    canvas ("wave", "chopWave", [this] (juce::Graphics& g, float w, float h) { drawWave (g, w, h); });
    canvas ("overlay", "chopWave", [this] (juce::Graphics& g, float w, float h) { drawOverlay (g, w, h); });
    canvas ("ph", "chopWave", [this] (juce::Graphics& g, float w, float h) { drawPlayhead (g, w, h); });
    canvas ("overview", "chopOverview", [this] (juce::Graphics& g, float w, float h) { drawOverview (g, w, h); });
    canvas ("out", "chopOut", [this] (juce::Graphics& g, float w, float h) { drawOut (g, w, h); }, true);
    canvas ("slicepic", "chopSlicePic", [this] (juce::Graphics& g, float w, float h) { drawSlicePic (g, w, h); });
    canvas ("pass", "chopPassPic", [this] (juce::Graphics& g, float w, float h) { drawPass (g, w, h); });
    // A module that is off shows its picture at .42 (`.chop-fxs.off .chop-pic`).
    auto dimmedBy = [this] (const char* on, std::function<void (juce::Graphics&, float, float)> draw) {
        return [this, on, draw] (juce::Graphics& g, float w, float h) {
            const bool lit = flag (on);
            if (!lit)
                g.beginTransparencyLayer (0.42f);
            draw (g, w, h);
            if (!lit)
                g.endTransparencyLayer();
        };
    };
    canvas ("env", "chopPicEnv", dimmedBy ("envOn", [this] (juce::Graphics& g, float w, float h) { drawEnv (g, w, h); }), true);
    canvas ("tr", "chopPicTr", dimmedBy ("trOn", [this] (juce::Graphics& g, float w, float h) { drawTransient (g, w, h); }), true);
    canvas ("eq", "chopPicEq", dimmedBy ("eqOn", [this] (juce::Graphics& g, float w, float h) { drawEq (g, w, h); }), true);
    canvas ("flt", "chopPicFlt", dimmedBy ("fltOn", [this] (juce::Graphics& g, float w, float h) { drawFilter (g, w, h); }), true);
    addLayer ("legend", at ("chopLegend").withWidth (842).expanded (2), [this, at] (juce::Graphics& g) {
        g.setOrigin (-at ("chopLegend").expanded (2).getSmallestIntegerContainer().getPosition());
        drawLegend (g);
    });
    addLayer ("list", at ("chopList"), [this] (juce::Graphics& g) {
        g.setOrigin (-ids["chopList"].r.getSmallestIntegerContainer().getPosition());
        drawList (g);
    });
    for (const auto& k : knobOrder)
    {
        auto it = ids.find ("knob:" + k);
        if (it == ids.end())
            continue;
        // The knob and all it holds (a processing bar's knob hangs below its row).
        juce::Rectangle<float> all = it->second.r;
        std::function<void (const juce::var&)> grow = [&] (const juce::var& n) {
            all = all.getUnion (rectOf (n["rect"]));
            if (auto* kk = n["kids"].getArray())
                for (const auto& x : *kk)
                    grow (x);
        };
        grow (it->second.n);
        const auto r = all.expanded (6);
        addLayer ("knob:" + k, r, [this, k, r] (juce::Graphics& g) {
            g.setOrigin (-r.getSmallestIntegerContainer().getPosition());
            drawKnob (g, k);
        });
    }
    // The readings the page writes, each where the page puts it.
    for (auto* t : liveTexts)
    {
        auto r = at (t);
        if (r.isEmpty() && r.getWidth() <= 0)
            r = r.withWidth (1);
        const juce::String nid (t);
        // Room to grow: a reading is as long as its words.
        if (nid == "chopTempoSaid")
            r = juce::Rectangle<float> (r.getX(), 113, 270, 20);
        else if (nid == "chopHeard")
            r = juce::Rectangle<float> (r.getX(), 652, 300, 18);
        else if (nid == "chopPickAn" || nid == "chopPickRo" || nid == "chopPassRo" || nid == "chopMeta" || nid == "chopZoomRo")
            r = r.withX (r.getX() - 160).withWidth (r.getWidth() + 320).expanded (0, 3);
        else
            r = r.expanded (40, 3);
        addLayer ("texts:" + nid, r, [this, nid, r] (juce::Graphics& g) {
            g.setOrigin (-r.getSmallestIntegerContainer().getPosition());
            only = nid;
            drawTexts (g);
            only.clear();
        });
    }
    addLayer ("texts:foot", { 12, 958, 1040, 34 }, [this] (juce::Graphics& g) {
        g.setOrigin (-12, -958);
        only = "foot";
        drawTexts (g);
        only.clear();
    });
    addLayer ("texts:pbar", { 840, 16, 226, 24 }, [this] (juce::Graphics& g) {
        g.setOrigin (-840, -16);
        only = "pbar";
        drawTexts (g);
        only.clear();
    });
}

// ───────────────────────────────────────────────────────── the module's state

juce::var ChopFace::chopCall (const char* what, const juce::var& body)
{
    juce::String out;
    const auto json = body.isVoid() ? juce::String ("{}") : juce::JSON::toString (body, true);
    call ([&] (NaApp* a) -> int64_t {
        // One call: a reply is the whole state at most, so the room is ample.
        static thread_local std::vector<char> buf (1 << 22);
        int32_t n = na_chop_call (a, id, what, json.toRawUTF8(), buf.data(), (uint32_t) buf.size());
        if (n >= (int32_t) buf.size())
        {
            buf.resize ((size_t) n + 1);
            n = na_chop_call (a, id, "state", "{}", buf.data(), (uint32_t) buf.size());
        }
        out = n > 0 ? juce::String::fromUTF8 (buf.data(), juce::jmin (n, (int32_t) buf.size() - 1)) : juce::String();
        // Refused: why, so the page can say it (the original toasts every failure).
        if (n < 0)
        {
            char why[512] = {};
            na_error (a, why, sizeof why);
            auto* o = new juce::DynamicObject();
            o->setProperty ("error", juce::String::fromUTF8 (why));
            out = juce::JSON::toString (juce::var (o), true);
        }
        return n;
    });
    return juce::JSON::parse (out);
}

double ChopFace::num (const juce::String& k) const
{
    const auto& cp = state["cp"];
    if (cp.hasProperty (k))
        return dnum (cp[juce::Identifier (k)]);
    if (state.hasProperty (k))
        return dnum (state[juce::Identifier (k)]);
    auto it = knobs.find (k);
    return it != knobs.end() ? it->second.def : dnum (data["def"][juce::Identifier (k)]);
}

juce::String ChopFace::str (const juce::String& k) const
{
    const auto& cp = state["cp"];
    if (cp.hasProperty (k))
        return cp[juce::Identifier (k)].toString();
    return data["def"][juce::Identifier (k)].toString();
}

bool ChopFace::flag (const juce::String& k) const
{
    const auto& cp = state["cp"];
    const auto v = cp.hasProperty (k) ? cp[juce::Identifier (k)] : data["def"][juce::Identifier (k)];
    return v.isBool() ? (bool) v : !juce::exactlyEqual (dnum (v), 0.0);
}

void ChopFace::take (const juce::var& answer)
{
    if (answer["said"].isString())
        say (answer["said"].toString());
    if (answer["error"].isString())
        say (answer["error"].toString());
    if (answer["state"].isObject())
        readState (answer["state"]);
}

void ChopFace::readState (const juce::var& s)
{
    state = s;
    // Fewer slices than before: the list is not left scrolled past its end.
    if (auto it = ids.find ("list"); it != ids.end())
        if (auto* sl = s["slices"].getArray())
            listScroll = juce::jlimit (0.0f, juce::jmax (0.0f, (float) sl->size() * 20 - it->second.r.getHeight()), listScroll);
    serial = (int64_t) dnum (s["serial"], -1);
    slices.clear();
    if (auto* a = s["slices"].getArray())
        for (const auto& x : *a)
        {
            Slice sl;
            sl.s = (int64_t) dnum (ix (x, 0));
            sl.e = (int64_t) dnum (ix (x, 1));
            const int f = (int) dnum (ix (x, 2));
            sl.locked = (f & 1) != 0;
            sl.moved = (f & 2) != 0;
            sl.muted = (f & 4) != 0;
            sl.rev = (f & 8) != 0;
            sl.kind = ix (x, 3).toString();
            slices.push_back (sl);
        }
    sel.clear();
    if (auto* a = s["sel"].getArray())
        for (const auto& x : *a)
            sel.insert ((int) dnum (x));
    current = (int) dnum (s["current"], -1);
    regionS = (int64_t) dnum (ix (s["region"], 0));
    regionE = (int64_t) dnum (ix (s["region"], 1));
    playing = s["playing"].toString();
    const auto& snd = s["sound"];
    const bool had = len > 0;
    len = snd.isObject() ? (int64_t) dnum (snd["len"]) : 0;
    rate = snd.isObject() ? dnum (snd["rate"], 48000) : 48000;
    const auto ss = snd.isObject() ? (int64_t) dnum (snd["serial"], 0) : -1;
    if (ss != soundSerial)
    {
        soundSerial = ss;
        loadSound();
        if (!had || viewB <= viewA || viewB > (double) len)
        {
            viewA = 0;
            viewB = (double) juce::jmax<int64_t> (1, len);
        }
        laneWaveKey.clear();
    }
    if (!anReady && s["an"].isObject())
        loadAnalysis();
    if (s["ui"].isObject() && !uiRead)
    {
        uiRead = true;
        restoreUi (s["ui"]);
    }
    // What the picked slice is now, and the tails on every row.
    if (hasSound())
    {
        tails = chopCall ("tails", {});
        const int i = current >= 0 ? current : 0;
        sliceInfo = i < (int) slices.size() ? chopCall ("slice", put (obj(), "i", i)) : juce::var();
        rendered.clear();
        if (i < (int) slices.size())
        {
            call ([&] (NaApp* a) -> int64_t {
                rendered.resize (1 << 16);
                int32_t n = na_chop_render (a, id, i, rendered.data(), (uint32_t) rendered.size());
                if (n > (int32_t) rendered.size())
                {
                    rendered.resize ((size_t) n);
                    n = na_chop_render (a, id, i, rendered.data(), (uint32_t) rendered.size());
                }
                rendered.resize ((size_t) juce::jmax (0, n));
                return n;
            });
        }
    }
    page->setVisible (hasSound());
    empty->setVisible (!hasSound());
    shown = hasSound() ? page.get() : empty.get();
    for (auto& l : layers)
        l->toFront (false);
    const double t0 = juce::Time::getMillisecondCounterHiRes();
    restyle();
    restyleMs = juce::Time::getMillisecondCounterHiRes() - t0;
    for (auto& l : layers)
        l->repaint();
}

void ChopFace::loadSound()
{
    mono.clear();
    an.clear();
    anF = 0;
    anReady = false;
    peak = 0.001f;
    if (!state["sound"].isObject())
        return;
    call ([&] (NaApp* a) -> int64_t {
        const int64_t n = na_chop_mono (a, id, 0, nullptr, 0);
        mono.resize ((size_t) juce::jmax<int64_t> (0, n));
        for (int64_t at = 0; at < n; at += 1 << 20)
            na_chop_mono (a, id, at, mono.data() + at, (uint32_t) juce::jmin<int64_t> (1 << 20, n - at));
        return n;
    });
    // `chopPeakOf`: the loudest sample, which the waveform is scaled to.
    float pk = 0;
    for (auto v : mono)
        pk = juce::jmax (pk, std::abs (v));
    peak = juce::jmax (0.001f, pk);
}

void ChopFace::loadAnalysis()
{
    an.assign (10, {});
    call ([&] (NaApp* a) -> int64_t {
        anF = na_chop_analysis (a, id, 0, nullptr, 0);
        for (uint32_t k = 0; k < 10 && anF > 0; ++k)
        {
            an[k].resize ((size_t) anF);
            na_chop_analysis (a, id, k, an[k].data(), (uint32_t) anF);
        }
        return anF;
    });
    anReady = anF > 0;
    laneWaveKey.clear();
}

void ChopFace::reload()
{
    uiRead = false;
    const auto a = chopCall ("state", {});
    readState (a["state"].isObject() ? a["state"] : a);
}

void ChopFace::keepUi()
{
    auto ui = obj();
    put (ui, "tool", tool);
    put (ui, "colour", colour);
    auto view = obj();
    put (view, "a", viewA);
    put (view, "b", viewB);
    put (view, "follow", follow);
    put (view, "mode", followMode);
    put (ui, "view", view);
    auto soft = obj();
    put (soft, "on", softOn);
    put (soft, "alpha", softAlpha);
    put (ui, "soft", soft);
    chopCall ("ui", ui);
}

void ChopFace::restoreUi (const juce::var& ui)
{
    if (ui["tool"].isString())
        tool = ui["tool"].toString();
    if (ui["colour"].isString())
        colour = ui["colour"].toString();
    const auto& v = ui["view"];
    if (v.isObject())
    {
        follow = (bool) v["follow"];
        followMode = v["mode"].toString() == "page" ? "page" : "scroll";
        const double a = dnum (v["a"]), b = dnum (v["b"]);
        if (b > a && b <= (double) len && len > 0)
        {
            viewA = a;
            viewB = b;
        }
    }
    if (ui["soft"].isObject())
    {
        softOn = (bool) ui["soft"]["on"];
        softAlpha = juce::jlimit (0.05, 0.9, dnum (ui["soft"]["alpha"], 0.3));
    }
}

// ─────────────────────────────────────────────────── the switches, lit or not

void ChopFace::restyle()
{
    const juce::String mode = str ("mode");
    for (auto* ch : { page.get(), empty.get() })
    {
        auto& my = ch == page.get() ? ids : emptyIds;
        std::map<int, int> st;
        std::map<int, float> op;
        auto kidI = [] (const Node& seg, int j) { return (int) dnum (ix (seg.n["kids"], j)["i"], -1); };
        // A row of choices: each lit as the page's chosen one, or as one not.
        auto seg = [&] (const juce::String& sid, const juce::StringArray& vals, const juce::String& v, int onLook, int offLook) {
            auto it = my.find (sid);
            if (it == my.end())
                return;
            for (int j = 0; j < vals.size(); ++j)
            {
                const int k = kidI (it->second, j);
                if (k >= 0)
                    st[k] = vals[j] == v ? onLook : offLook;
            }
        };
        auto look = [&] (const std::map<juce::String, Node>& from, const juce::String& sid, int j, int off) {
            auto it = from.find (sid);
            if (it == from.end())
                return -1;
            return (j < 0 ? it->second.i : kidI (it->second, j)) + off;
        };
        auto pageKid = [&] (const juce::String& sid, int j) { return look (ids, sid, j, pageOff); };
        auto litKid = [&] (const juce::String& sid, int j) { return look (litIds, sid, j, litOff); };

        seg ("chopMode", arr (modes, 3), mode, pageKid ("chopMode", 0), pageKid ("chopMode", 1));
        const bool grid = mode == "grid";
        seg ("chopDiv", arr (divs, 6), str ("div"), grid ? litKid ("chopDiv", 4) : pageKid ("chopDiv", 3), grid ? litKid ("chopDiv", 0) : pageKid ("chopDiv", 0));
        seg ("chopFeel", arr (feels, 3), str ("feel"), grid ? litKid ("chopFeel", 0) : pageKid ("chopFeel", 0), grid ? litKid ("chopFeel", 1) : pageKid ("chopFeel", 1));
        seg ("chopTools", arr (tools, 4), tool, pageKid ("chopTools", 0), pageKid ("chopTools", 1));
        seg ("chopSync", arr (syncs, 2), str ("sync"), pageKid ("chopSync", 0), pageKid ("chopSync", 1));
        seg ("chopFollowMode", arr (followModes, 2), followMode, pageKid ("chopFollowMode", 0), pageKid ("chopFollowMode", 1));
        seg ("chopColour", arr (views, 8), colour, pageKid ("chopColour", 0), pageKid ("chopColour", 1));
        seg ("fltType", arr (fltTypes, 3), str ("fltType"), pageKid ("fltType", 0), pageKid ("fltType", 1));
        seg ("chopAB", juce::StringArray { "a", "b" }, state["which"].toString().isEmpty() ? juce::String ("a") : state["which"].toString(), pageKid ("chopAB", 0), pageKid ("chopAB", 1));

        // Buttons on or off: their lit look from the lit page.
        auto tog = [&] (const juce::String& sid, bool on, int onLook, int offLook) {
            auto it = my.find (sid);
            if (it != my.end() && onLook >= 0 && offLook >= 0)
                st[it->second.i] = on ? onLook : offLook;
        };
        for (const char* b : { "chopPreview", "chopRatchet", "chopOutMidi", "chopOutSfz", "chopSoft" })
        {
            const juce::String bid (b);
            const bool on = bid == "chopPreview" ? playing == "preview" : bid == "chopRatchet" ? playing == "ratchet" : bid == "chopSoft" ? softOn : flag (bid == "chopOutMidi" ? "outMidi" : "outSfz");
            tog (bid, on, look (litIds, bid, -1, litOff), look (ids, bid, -1, pageOff));
        }
        tog ("chopFollow", follow, look (ids, "chopFollow", -1, pageOff), look (litIds, "chopFollow", -1, litOff));
        tog ("tailOn", flag ("tail"), look (litIds, "tailOn", -1, litOff), look (ids, "tailOn", -1, pageOff));
        for (int f = 0; f < 4; ++f)
        {
            const juce::String fx (fxNames[f]);
            const bool on = flag (fxOn[f]);
            tog ("pwr:" + fx, on, look (litIds, "pwr:" + fx, -1, litOff), look (ids, "pwr:" + fx, -1, pageOff));
            for (const auto& part : { juce::String ("body:"), juce::String ("pic:") })
                if (auto it = my.find (part + fx); it != my.end())
                    op[it->second.i] = on ? 1.0f : 0.42f;
        }
        // Nothing hides: a knob that makes no cuts in this mode dims (`chopReflect`).
        for (const auto& [k, kn] : knobs)
            if (auto it = my.find ("knob:" + k); it != my.end())
                op[it->second.i] = knobDim (k) ? 0.36f : 1.0f;
        // Write: only with a slice not muted, and a sound.
        if (auto it = my.find ("chopWrite"); it != my.end())
        {
            bool any = false;
            for (const auto& x : slices)
                any = any || !x.muted;
            op[it->second.i] = any && hasSound() ? 1.0f : 0.4f;
        }

        // Draw again only where something changed, neighbours merged into
        // one area (each redraw walks the whole capture).
        std::set<int> changed;
        for (const auto& [i, j] : st)
            if (ch->styleFrom.count (i) == 0 || ch->styleFrom[i] != j)
                changed.insert (i);
        for (const auto& [i, o] : op)
            if (ch->opacityOf.count (i) == 0 || std::abs (ch->opacityOf[i] - o) > 1e-4f)
                changed.insert (i);
        ch->styleFrom = st;
        ch->opacityOf = op;
        std::vector<juce::Rectangle<float>> areas;
        for (int i : changed)
            if (auto n = ch->nodes.find (i); n != ch->nodes.end())
            {
                auto r = rectOf (n->second["rect"]).expanded (6);
                for (bool merged = true; merged;)
                {
                    merged = false;
                    for (auto a = areas.begin(); a != areas.end(); ++a)
                        if (a->expanded (40).intersects (r))
                        {
                            r = r.getUnion (*a);
                            areas.erase (a);
                            merged = true;
                            break;
                        }
                }
                areas.push_back (r);
            }
        for (const auto& r : areas)
            ch->redraw (r);
    }
}

bool ChopFace::knobDim (const juce::String& k) const
{
    auto it = knobs.find (k);
    if (it == knobs.end())
        return false;
    const auto mode = str ("mode");
    const auto& w = it->second.when;
    if (k == "tailMs")
        return !flag ("tail");
    if (w.isEmpty())
        return false;
    if (w == "!grid")
        return mode == "grid";
    return mode != w;
}

// ─────────────────────────────────────────────────────────────── readings

juce::String ChopFace::fmtKnob (const Knob& k, double v) const
{
    const auto& key = k.key;
    auto ms = [] (double x) { return (x < 10 ? fixed (x, 1) : rnd (x)) + " ms"; };
    auto db = [] (double x) { return (x > 0 ? "+" : "") + fixed (x, 1) + " dB"; };
    auto pct = [] (double x) { return rnd (x) + "%"; };
    auto hz = [] (double x) { return x >= 1000 ? fixed (x / 1000, x >= 10000 ? 1 : 2) + " kHz" : rnd (x) + " Hz"; };
    auto q = [] (double x) { return fixed (x, 2); };
    if (key == "sens" || key == "bars" || key == "beats")
        return rnd (v);
    if (key == "topDb")
        return rnd (v) + " dB";
    if (key == "minDur" || key == "pad" || key == "smooth" || key == "tailMs" || key == "attack" || key == "trAttack" || key == "trRelease")
        return ms (v);
    if (key == "nudge" || key == "shuffle" || key == "gate" || key == "stretch" || key == "trAmount" || key == "drive" || key == "mix")
        return pct (v);
    if (key == "sig")
        return rnd (v) + "/4";
    if (key == "tempo")
        return v > 0 ? fixed (v, 1) : juce::String ("orig");
    if (key == "pitch")
        return (v > 0 ? "+" : "") + fixed (v, 1) + " st";
    if (key == "decay")
        return v >= 5000 ? juce::String ("off") : v >= 1000 ? fixed (v / 1000, 2) + " s" : rnd (v) + " ms";
    if (key == "trThresh" || key == "trGain" || key == "lowG" || key == "highG" || key == "gain")
        return db (v);
    if (key == "lowQ" || key == "highQ" || key == "fltQ")
        return q (v);
    return hz (v);
}

void ChopFace::writeText (juce::Graphics& g, const juce::String& nid, const juce::String& text, juce::Colour* tint)
{
    const auto& my = shown == empty.get() ? emptyIds : ids;
    const Node* node = nullptr;
    if (auto a = my.find (nid); a != my.end())
        node = &a->second;
    else if (auto b = ids.find (nid); b != ids.end())
        node = &b->second;
    if (node == nullptr || text.isEmpty())
        return;
    const auto& n = node->n;
    const auto* run = n["text"].isArray() ? &n["text"][0] : nullptr;
    const juce::var f = run != nullptr ? (*run)["font"] : n["font"];
    const auto fnt = face::font (f);
    g.setFont (fnt);
    g.setColour (tint != nullptr ? *tint : face::colour (f["colour"]));
    const auto r = node->r;
    const float baseline = r.getY() + (r.getHeight() - (fnt.getAscent() + fnt.getDescent())) / 2.0f + fnt.getAscent();
    // Those after a row's spring (`chop-grow`, `justify-content: space-between`)
    // keep their right edge where the page put it.
    static const juce::StringArray rightEdged { "chopPickRo", "chopPassRo", "chopPattern", "chopZoomRo" };
    const bool right = f["align"].toString() == "right" || f["align"].toString() == "end" || rightEdged.contains (nid);
    juce::Graphics::ScopedSaveState clip (g);
    if (nid == "chopPickRo")
        g.reduceClipRegion (juce::Rectangle<int> (32, 648, 436, 20));
    else if (nid == "chopPassRo")
        g.reduceClipRegion (juce::Rectangle<int> (490, 648, 436, 20));
    const bool centre = f["align"].toString() == "center";
    const float w = juce::GlyphArrangement::getStringWidth (fnt, text);
    const float x = right ? r.getRight() - w : centre ? r.getCentreX() - w / 2 : r.getX();
    juce::GlyphArrangement glyphs;
    glyphs.addLineOfText (fnt, text, x, baseline);
    glyphs.draw (g);
}

juce::String ChopFace::stat (const juce::String& k) const
{
    if (!hasSound() || len <= 0)
        return k == "clips" ? "0" : k == "ratio" ? "0%" : k == "avg" ? "0 ms" : k == "dur" ? "0 s" : uni ("\xe2\x80\x93");
    const double dur = (double) len / rate;
    double total = 0;
    for (const auto& x : slices)
        total += (double) (x.e - x.s);
    total /= rate;
    const double avg = slices.empty() ? 0 : total / (double) slices.size();
    const auto& a = state["an"];
    if (k == "clips")
        return juce::String ((int) slices.size());
    if (k == "ratio")
        return rnd (total / dur * 100) + "%";
    if (k == "avg")
        return fixed (avg * 1000, 0) + " ms";
    if (k == "dur")
        return fixed (dur, 2) + " s";
    if (k == "pulse")
        return a.isObject() ? rnd (dnum (a["pulse"]) * 100) + "%" : uni ("\xe2\x80\x93");
    return a.isObject() ? fixed (dnum (a["hits"]), 1) : uni ("\xe2\x80\x93");
}

void ChopFace::drawTexts (juce::Graphics& g)
{
    const auto& o = only;
    const bool snd = hasSound();
    auto divName = [this] { const auto d = str ("div"); return d == "bar" ? juce::String ("1 bar") : "1/" + d; };
    if (o == "chopStatus" && snd)
    {
        const double play = num ("playBpm"), own = bpm();
        const auto feel = str ("feel");
        auto t = divName() + (feel == "dot" ? " dotted" : feel == "trip" ? " triplet" : "") + uni (" \xc2\xb7 plays at ") + fixed (play, 1) + " BPM";
        if (std::abs (play - own) > 0.05)
            t += " (from " + fixed (own, 1) + ")";
        writeText (g, o, t);
    }
    else if (o == "chopStatus2" && snd)
        writeText (g, o, "chop every " + fixed (num ("stepBeats") * 60 / num ("playBpm"), 3) + " s");
    else if (o == "chopBpm" || o == "chopBpmNote")
    {
        const double own = snd ? bpm() : 120.0;
        const bool bad = own < 30 || own > 300;
        auto tint = cl ("--chop-bad");
        if (o == "chopBpm")
            writeText (g, o, fixed (own, 1), bad ? &tint : nullptr);
        else
            writeText (g, o, bad ? "check Bars and Beats" : "BPM of the sound", bad ? &tint : nullptr);
    }
    else if (o == "chopTempoSaid")
    {
        // Left in Time's header, after its name.
        auto it = ids.find ("chopTempoSaid");
        if (it != ids.end())
        {
            g.setFont (face::sans (9));
            g.setColour (cl ("t3"));
            g.drawText (state["tempoSaid"].toString(), juce::Rectangle<float> (it->second.r.getX(), 113, 270, 20), juce::Justification::centredLeft, false);
        }
    }
    else if (o == "chopCycles")
    {
        auto t = tails["cycles"].toString();
        if (t.isEmpty())
            t = juce::String (juce::jlimit (2, 8, (int) std::ceil (500 / num ("tailMs")))) + " cycles";
        writeText (g, o, t);
    }
    else if (o == "chopMeta" && snd)
    {
        const auto& s = state["sound"];
        juce::StringArray parts;
        if (s["format"].toString().isNotEmpty())
            parts.add (s["format"].toString());
        if (dnum (s["rate"]) > 0)
            parts.add (rnd (dnum (s["rate"])) + " Hz");
        if (dnum (s["bits"]) > 0)
            parts.add (rnd (dnum (s["bits"])) + "-bit");
        if (dnum (s["channels"]) > 0)
            parts.add (rnd (dnum (s["channels"])) + " ch");
        parts.add (fixed ((double) len / rate, 2) + " s");
        writeText (g, o, parts.joinIntoString (uni (" \xc2\xb7 ")));
    }
    else if (o == "chopSoft")
        writeText (g, o, uni ("\xe2\x97\x90 ") + (softOn ? rnd (softAlpha * 100) + "%" : juce::String ("soften")));
    else if (o == "chopZoomRo" && snd)
        writeText (g, o, fixed ((viewB - viewA) / rate, 2) + " s shown");
    else if (o == "chopPattern" && snd)
        writeText (g, o, state["sound"]["stem"].toString() + "_####.wav");
    else if (o == "chopPickRo" && snd && sliceInfo.isObject())
    {
        const int i = current >= 0 ? current : 0;
        const auto& tl = sliceInfo["tail"];
        auto t = juce::String (i + 1) + uni (" \xc2\xb7 ") + fixed (dnum (sliceInfo["inLen"]) / rate * 1000, 0) + uni (" ms in \xe2\x86\x92 ") + fixed (dnum (sliceInfo["outLen"]) / rate * 1000, 0) + " ms out";
        if (tl.isObject() && (bool) tl["viable"])
            t += uni (" \xc2\xb7 tail ") + fixed (dnum (tl["actualMs"]), 0) + uni (" ms \xc3\x97 ") + rnd (dnum (tl["numCycles"]));
        if (i < (int) slices.size() && slices[(size_t) i].rev)
            t += uni (" \xc2\xb7 reversed");
        writeText (g, o, t);
    }
    else if (o == "chopPickAn" && snd && sliceInfo["m"].isObject())
    {
        const auto& m = sliceInfo["m"];
        auto pc = [] (double v) { return rnd (v * 100) + "%"; };
        auto fq = [] (double v) { return v >= 1000 ? fixed (v / 1000, 1) + " kHz" : rnd (v) + " Hz"; };
        const auto dot = uni (" \xc2\xb7 ");
        auto t = m["kind"].toString() + dot + "lo " + pc (dnum (m["low"])) + dot + "hi " + pc (dnum (m["high"])) + dot + "bright " + fq (dnum (m["cent"])) + dot + "noise " + pc (dnum (m["flat"]))
                 + dot + (dnum (m["hz"]) > 0 ? sliceInfo["note"].toString() : juce::String ("no pitch")) + dot + "attack " + rnd (dnum (sliceInfo["attackMs"])) + " ms" + dot + "crest " + fixed (dnum (m["crest"]), 0) + " dB";
        juce::Graphics::ScopedSaveState keep (g);
        g.reduceClipRegion (juce::Rectangle<int> (24, 760, 452, 21));
        writeText (g, o, t);
    }
    else if (o == "chopPassRo" && snd)
    {
        writeText (g, o, juce::String (passPlayed) + uni (" slices \xc2\xb7 ") + juce::String (passFires) + " fires on " + divName());
    }
    else if (o == "pbar")
    {
        auto lab = ids.find ("pb:label"), tag = ids.find ("pb:tag");
        if (lab == ids.end() || tag == ids.end())
            return;
        const auto name = state["preset"].toString().isEmpty() ? juce::String ("No preset") : state["preset"].toString();
        const auto lf = face::font (lab->second.n["text"][0]["font"]);
        const auto tf = face::font (tag->second.n["text"][0]["font"]);
        const float lw = juce::GlyphArrangement::getStringWidth (lf, name);
        face::paintText (g, lab->second.n, lab->second.r.withWidth (lw + 2), name);
        const float gap = tag->second.r.getX() - lab->second.r.getRight();
        const auto tr = tag->second.r.withX (lab->second.r.getX() + lw + gap).withWidth (juce::jmax (1.0f, 1048 - (lab->second.r.getX() + lw + gap)));
        auto tagText = state["tag"].toString();
        if (tagText.isEmpty())
            tagText = "Transient";
        face::paintText (g, tag->second.n, tr, tagText);
        juce::ignoreUnused (tf);
    }
    else if (o == "foot")
    {
        // The foot, laid out as the page's flex row: each count, what was
        // edited, what was said.
        float x = 21;
        for (const char* k : { "clips", "ratio", "avg", "dur", "pulse", "hits" })
        {
            auto it = ids.find ("stat:" + juce::String (k));
            if (it == ids.end())
                continue;
            const auto& n = it->second.n;
            const auto* b = child (n, "b");
            if (b == nullptr)
                continue;
            const auto v = stat (k);
            const auto bf = face::font ((*b)["text"][0]["font"]);
            const float bw = juce::GlyphArrangement::getStringWidth (bf, v);
            face::paintText (g, *b, juce::Rectangle<float> (x, rectOf ((*b)["rect"]).getY(), bw + 2, rectOf ((*b)["rect"]).getHeight()), v);
            const auto& run = n["text"][0];
            const auto lf = face::font (run["font"]);
            const auto label = run["text"].toString();
            const float lw = juce::GlyphArrangement::getStringWidth (lf, " " + label);
            face::paintText (g, n, juce::Rectangle<float> (x + bw, rectOf (run["rect"]).getY(), lw + 2, rectOf (run["rect"]).getHeight()), " " + label);
            x += bw + lw + 10;
        }
        int moved = 0, locked = 0;
        for (const auto& s : slices)
        {
            moved += s.moved ? 1 : 0;
            locked += s.locked ? 1 : 0;
        }
        juce::StringArray ed;
        if (moved > 0)
            ed.add (juce::String (moved) + " moved");
        if (locked > 0)
            ed.add (juce::String (locked) + " locked");
        if (!ed.isEmpty())
            if (auto it = litIds.find ("edited"); it != litIds.end())
            {
                const auto t = ed.joinIntoString (uni (" \xc2\xb7 "));
                const auto f = face::font (it->second.n["text"][0]["font"]);
                const float w = juce::GlyphArrangement::getStringWidth (f, t);
                face::paintText (g, it->second.n, juce::Rectangle<float> (x, it->second.r.getY(), w + 2, it->second.r.getHeight()), t);
                x += w + 10;
            }
        const auto& from = said.isEmpty() ? ids : litIds;
        if (auto sit = from.find ("said"); sit != from.end())
        {
            const auto t = said.isEmpty() ? data["hint"].toString() : said;
            juce::Graphics::ScopedSaveState keep (g);
            g.reduceClipRegion (juce::Rectangle<int> ((int) x, 958, juce::jmax (1, 1046 - (int) x), 34));
            face::paintText (g, sit->second.n, juce::Rectangle<float> (x, sit->second.r.getY(), 1046 - x, sit->second.r.getHeight()), t);
        }
    }
}

// ────────────────────────────────────────────────────────────── the clock

void ChopFace::timerCallback()
{
    const auto p = chopCall ("playing", {});
    const auto kind = p["kind"].toString();
    const double at = dnum (p["at"], -1);
    const auto ser = (int64_t) dnum (p["serial"], -1);
    if (ser != serial)
    {
        reload();
        return;
    }
    const bool was = playAt >= 0 || playing.isNotEmpty();
    if (kind != playing)
    {
        playing = kind;
        restyle();
        repaintLayer ("pass");
    }
    playAt = at;
    if (at >= 0 || was)
    {
        followHead (at);
        repaintLayer ("ph");
        repaintLayer ("out");
        repaintLayer ("overview");
    }
}

// ─────────────────────────────────────────────────────────────── the view

void ChopFace::zoom (double factor, double at)
{
    const double L = juce::jmax (256.0, juce::jmin ((double) len, (viewB - viewA) * factor));
    const double a = juce::jmax (0.0, juce::jmin ((double) len - L, at - (at - viewA) * L / (viewB - viewA)));
    viewA = a;
    viewB = a + L;
    laneChanged();
}

void ChopFace::fit()
{
    viewA = 0;
    viewB = (double) juce::jmax<int64_t> (1, len);
    laneChanged();
}

void ChopFace::laneChanged()
{
    for (const char* l : { "wave", "overlay", "ph", "overview", "texts:chopZoomRo" })
        repaintLayer (l);
    keepUi();
}

void ChopFace::followHead (double at)
{
    // `chopFollow`: keep the playhead on screen while Follow is on.
    if (!follow || at < 0)
        return;
    const double L = viewB - viewA;
    if (L >= (double) len || (at >= viewA && at <= viewB - L * 0.05 && followMode == "page"))
        return;
    const double a = followMode == "page" ? ((at < viewA || at > viewB - L * 0.05) ? at : viewA) : at - L / 2;
    const double na = juce::jmax (0.0, juce::jmin ((double) len - L, a));
    if (std::abs (na - viewA) < 1e-9)
        return;
    viewA = na;
    viewB = na + L;
    for (const char* l : { "wave", "overlay", "overview", "texts:chopZoomRo" })
        repaintLayer (l);
}

juce::Rectangle<float> ChopFace::laneRect() const
{
    auto it = ids.find ("chopWave");
    return it != ids.end() ? it->second.r : juce::Rectangle<float> (24, 322, 1384, 320);
}

double ChopFace::laneFrame (float x) const
{
    const auto r = laneRect();
    const double f = frameOf (juce::jlimit (0.0, 1.0, (double) (x - r.getX()) / r.getWidth()));
    return juce::jlimit (0.0, (double) len, f);
}

juce::Rectangle<float> ChopFace::where (const juce::String& part) const
{
    if (part == "lane")
        return laneRect();
    if (part.startsWith ("knob:"))
    {
        auto it = ids.find (part);
        if (it == ids.end())
            return {};
        if (const auto* kn = child (it->second.n, "ui-kn"))
            return rectOf ((*kn)["rect"]);
        return it->second.r;
    }
    if (part.startsWith ("row:"))
    {
        auto it = ids.find ("list");
        if (it == ids.end())
            return {};
        const int i = part.fromFirstOccurrenceOf (":", false, false).getIntValue();
        return juce::Rectangle<float> (it->second.r.getX(), it->second.r.getY() + (float) i * 20 - listScroll, it->second.r.getWidth(), 20);
    }
    auto it = ids.find (part);
    return it != ids.end() ? it->second.r : juce::Rectangle<float>();
}

// ─────────────────────────────────────────────────────────────── actions

void ChopFace::say (const juce::String& s)
{
    said = s;
    repaintLayer ("texts:foot");
    if (onMessage && s.isNotEmpty())
        onMessage (s);
}

void ChopFace::set (const juce::String& key, const juce::var& v)
{
    take (chopCall ("set", put (obj(), juce::Identifier (key), v)));
}

void ChopFace::setKnob (const juce::String& key, double v, bool live)
{
    juce::ignoreUnused (live);
    const auto answer = chopCall ("set", put (obj(), juce::Identifier (key), v));
    // The knob's own layer at once; the rest of the page with the state.
    take (answer);
}

void ChopFace::pick (int i, bool add)
{
    auto body = put (obj(), "i", i);
    put (body, "add", add);
    take (chopCall ("pick", body));
    // Its row comes into view in the list (`chopSelect`).
    if (auto it = ids.find ("list"); it != ids.end() && i >= 0)
    {
        const float h = it->second.r.getHeight(), top = (float) i * 20;
        if (top < listScroll)
            listScroll = top;
        else if (top + 20 > listScroll + h)
            listScroll = top + 20 - h;
        repaint();
    }
}

void ChopFace::playSlice (int i, bool pickIt)
{
    auto body = put (obj(), "i", i);
    put (body, "pick", pickIt);
    take (chopCall ("play", body));
}

juce::String ChopFace::knobAt (juce::Point<float> p) const
{
    for (const auto& k : knobOrder)
    {
        auto it = ids.find ("knob:" + k);
        if (it == ids.end())
            continue;
        // The knob's ring takes a drag (the page's `.ui-kn`), bars and knobs alike.
        if (const auto* kn = child (it->second.n, "ui-kn"))
            if (rectOf ((*kn)["rect"]).expanded (2).contains (p))
                return k;
    }
    return {};
}

int ChopFace::rowAt (juce::Point<float> p) const
{
    auto it = ids.find ("list");
    if (it == ids.end() || !it->second.r.contains (p))
        return -1;
    const int i = (int) std::floor ((p.y - it->second.r.getY() + listScroll) / 20);
    return i >= 0 && i < (int) slices.size() ? i : -1;
}

void ChopFace::presetMenu (juce::Rectangle<float> near)
{
    const auto list = chopCall ("presets", put (obj(), "op", "list"));
    juce::PopupMenu m;
    const auto* a = list["presets"].getArray() != nullptr ? list["presets"].getArray() : list["list"].getArray() != nullptr ? list["list"].getArray() : list.getArray();
    if (a == nullptr || a->isEmpty())
        m.addItem (-1, "No presets yet: Save keeps these settings", false);
    else
        for (int i = 0; i < a->size(); ++i)
        {
            const auto& p = a->getReference (i);
            m.addItem (i + 1, p["name"].toString() + "    " + p["tag"].toString(), true, p["name"].toString() == state["preset"].toString());
        }
    juce::var keep = a != nullptr ? juce::var (*a) : juce::var();
    m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (this).withTargetScreenArea (localAreaToGlobal (near.toNearestInt())), [this, keep] (int r) {
        if (r <= 0 || !keep.isArray() || r > keep.size())
            return;
        auto body = put (obj(), "op", "load");
        put (body, "name", keep[r - 1]["name"]);
        take (chopCall ("presets", body));
    });
}

void ChopFace::presetStep (int by)
{
    const auto list = chopCall ("presets", put (obj(), "op", "list"));
    const auto* a = list["presets"].getArray() != nullptr ? list["presets"].getArray() : list["list"].getArray() != nullptr ? list["list"].getArray() : list.getArray();
    if (a == nullptr || a->isEmpty())
        return;
    int i = -1;
    for (int k = 0; k < a->size(); ++k)
        if (a->getReference (k)["name"].toString() == state["preset"].toString())
            i = k;
    const int n = a->size();
    const int next = i < 0 ? (by > 0 ? 0 : n - 1) : ((i + by) % n + n) % n;
    auto body = put (obj(), "op", "load");
    put (body, "name", a->getReference (next)["name"]);
    take (chopCall ("presets", body));
}

void ChopFace::morePresets (juce::Rectangle<float> near)
{
    juce::PopupMenu m;
    m.addItem (1, "Save as...");
    m.addItem (2, "Rename...", state["preset"].toString().isNotEmpty());
    m.addItem (3, "Init");
    m.addItem (4, "Delete", state["preset"].toString().isNotEmpty());
    m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (this).withTargetScreenArea (localAreaToGlobal (near.toNearestInt())), [this] (int r) { presetAct (r); });
}

// 1 Save as, 2 Rename, 3 Init, 4 Delete (`106-preset-bar-pop.js`).
void ChopFace::presetAct (int r)
{
    {
        const auto cur = state["preset"].toString();
        if (r == 1 || r == 2)
        {
            // The names there are: a new one starts as the current, or "Preset N".
            const auto list = chopCall ("presets", put (obj(), "op", "list"));
            juce::StringArray names;
            if (auto* a = list["presets"].getArray())
                for (const auto& p : *a)
                    names.add (p["name"].toString());
            const auto start = cur.isNotEmpty() ? cur : "Preset " + juce::String (names.size() + 1);
            auto* w = new juce::AlertWindow (r == 1 ? "Save as" : "Rename", r == 1 ? "A name for these settings" : "A new name for " + cur, juce::MessageBoxIconType::NoIcon);
            w->addTextEditor ("name", start);
            w->addButton ("OK", 1, juce::KeyPress (juce::KeyPress::returnKey));
            w->addButton ("Cancel", 0, juce::KeyPress (juce::KeyPress::escapeKey));
            w->enterModalState (true, juce::ModalCallbackFunction::create ([this, w, r, cur, names] (int ok) {
                const auto name = w->getTextEditorContents ("name").trim();
                if (ok == 1 && r == 2 && name != cur && names.contains (name))
                    return say ("That name is taken");
                if (ok == 1 && name.isNotEmpty() && !(r == 2 && name == cur))
                {
                    auto body = put (obj(), "op", r == 1 ? "save" : "rename");
                    put (body, "name", r == 1 ? name : cur);
                    put (body, "to", name);
                    take (chopCall ("presets", body));
                }
            }), true);
        }
        else if (r == 3)
            take (chopCall ("presets", put (obj(), "op", "init")));
        else if (r == 4)
        {
            juce::Component::SafePointer<ChopFace> safe (this);
            juce::AlertWindow::showOkCancelBox (juce::MessageBoxIconType::NoIcon, juce::String::fromUTF8 ("Delete \xe2\x80\x9c") + cur + juce::String::fromUTF8 ("\xe2\x80\x9d?"), "It can't be undone.", "Delete", "Cancel", this,
                juce::ModalCallbackFunction::create ([safe, cur] (int ok) {
                    if (ok != 1 || safe == nullptr)
                        return;
                    auto body = put (obj(), "op", "remove");
                    put (body, "name", cur);
                    safe->take (safe->chopCall ("presets", body));
                }));
        }
    }
}

// ─────────────────────────────────────────────────────────────── gestures

bool ChopFace::keyPressed (const juce::KeyPress& k)
{
    // The preset bar's own keys: F2 renames, shift-command-S saves as.
    if (k.getKeyCode() == juce::KeyPress::F2Key && state["preset"].toString().isNotEmpty())
        return presetAct (2), true;
    if (k.getModifiers().isCommandDown() && k.getModifiers().isShiftDown() && (k.getKeyCode() == 'S' || k.getKeyCode() == 's'))
        return presetAct (1), true;
    // Delete takes out the picked cut (`chopWireLane`).
    if ((k == juce::KeyPress::deleteKey || k == juce::KeyPress::backspaceKey) && current >= 0 && hasSound())
    {
        take (chopCall ("delete", put (obj(), "i", current)));
        return true;
    }
    return false;
}

void ChopFace::mouseDown (const juce::MouseEvent& e)
{
    if (blocked && blocked (e))
        return;
    // The left button only, as every handler of the page's is.
    if (!e.mods.isLeftButtonDown())
        return;
    grabKeyboardFocus();
    const auto p = e.position;
    down = p;
    grab = Grab::none;
    grabMoved = false;

    // A knob: drag up or down, Shift for fine (`uiKnob`).
    if (const auto k = knobAt (p); k.isNotEmpty())
    {
        const auto& kn = knobs[k];
        grab = Grab::knob;
        grabKey = k;
        grabU = toU (kn, num (k));
        grabY = p.y;
        return;
    }
    auto in = [&] (const juce::String& nid) {
        auto it = ids.find (nid);
        return it != ids.end() && it->second.r.contains (p);
    };
    auto kidIn = [&] (const juce::String& nid) -> int {
        auto it = ids.find (nid);
        if (it == ids.end() || !it->second.r.contains (p))
            return -1;
        if (auto* kids = it->second.n["kids"].getArray())
            for (int j = 0; j < kids->size(); ++j)
                if (rectOf (kids->getReference (j)["rect"]).contains (p))
                    return j;
        return -1;
    };
    // The rows of choices.
    if (int j = kidIn ("chopMode"); j >= 0)
        return set ("mode", modes[j]);
    if (int j = kidIn ("chopDiv"); j >= 0)
        return set ("div", divs[j]);
    if (int j = kidIn ("chopFeel"); j >= 0)
        return set ("feel", feels[j]);
    if (int j = kidIn ("chopSync"); j >= 0)
        return set ("sync", syncs[j]);
    if (int j = kidIn ("fltType"); j >= 0)
        return set ("fltType", fltTypes[j]);
    if (int j = kidIn ("chopTools"); j >= 0)
    {
        tool = tools[j];
        keepUi();
        restyle();
        return;
    }
    if (int j = kidIn ("chopFollowMode"); j >= 0)
    {
        followMode = followModes[j];
        keepUi();
        restyle();
        return;
    }
    if (int j = kidIn ("chopColour"); j >= 0)
    {
        colour = views[j];
        keepUi();
        restyle();
        laneWaveKey.clear();
        for (const char* l : { "wave", "overview", "legend", "list" })
            repaintLayer (l);
        return;
    }
    if (int j = kidIn ("chopAB"); j >= 0)
        return take (chopCall ("ab", put (obj(), "which", j == 0 ? "a" : "b")));

    // The buttons.
    if (in ("chopRev"))
        return take (chopCall ("toggle", put (obj(), "flag", "rev")));
    if (in ("chopMute"))
        return take (chopCall ("toggle", put (obj(), "flag", "muted")));
    if (in ("chopRedetect"))
        return take (chopCall ("recut", {}));
    if (in ("chopDetect"))
        return take (chopCall ("detect", {}));
    if (in ("chopHalf"))
        return take (chopCall ("scale", put (obj(), "f", 0.5)));
    if (in ("chopDouble"))
        return take (chopCall ("scale", put (obj(), "f", 2)));
    if (in ("chopPreview"))
        return take (chopCall ("preview", {}));
    if (in ("chopRatchet"))
        return take (chopCall ("ratchet", {}));
    if (in ("chopToRegions"))
        return take (chopCall ("toRegions", {}));
    if (in ("chopWrite"))
    {
        bool any = false;
        for (const auto& x : slices)
            any = any || !x.muted;
        if (any && hasSound())
        {
            say ("Writing...");
            take (chopCall ("write", {}));
        }
        return;
    }
    if (in ("chopOutMidi"))
        return set ("outMidi", !flag ("outMidi"));
    if (in ("chopOutSfz"))
        return set ("outSfz", !flag ("outSfz"));
    if (in ("tailOn"))
        return set ("tail", !flag ("tail"));
    for (int f = 0; f < 4; ++f)
        if (in ("pwr:" + juce::String (fxNames[f])))
            return set (fxOn[f], !flag (fxOn[f]));
    if (in ("chopSoft"))
    {
        softOn = !softOn;
        keepUi();
        restyle();
        repaintLayer ("overlay");
        repaintLayer ("texts:chopSoft");
        return;
    }
    if (in ("chopZoomIn") && hasSound())
        return zoom (0.6, (viewA + viewB) / 2);
    if (in ("chopZoomOut") && hasSound())
        return zoom (1 / 0.6, (viewA + viewB) / 2);
    if (in ("chopZoomFit") && hasSound())
        return fit();
    if (in ("chopFollow"))
    {
        follow = !follow;
        keepUi();
        restyle();
        return;
    }
    if (in ("chopDice"))
        return take (chopCall ("dice", {}));
    if (in ("chopCapture"))
        return say ("Take reads MGL's Recordings: open the newest take in a Sound module and cable it in");
    if (in ("newtab"))
    {
        if (!hasSound() && wantSound)
            wantSound();
        else
            say ("The sound is the Sound module cabled into Chop's Sound socket");
        return;
    }
    if (in ("pb:prev"))
        return presetStep (-1);
    if (in ("pb:next"))
        return presetStep (1);
    if (in ("pb:open"))
        return presetMenu (ids["pb:open"].r);
    if (in ("pb:save"))
    {
        const auto cur = state["preset"].toString();
        if (cur.isEmpty())
            return presetAct (1);
        auto body = put (obj(), "op", "save");
        put (body, "name", cur);
        return take (chopCall ("presets", body));
    }
    if (in ("pb:more"))
        return morePresets (ids["pb:more"].r);

    if (!hasSound())
        return;

    // The overview: the white window dragged; double-click for the whole sound.
    if (in ("chopOverview"))
    {
        grab = Grab::overview;
        mouseDrag (e);
        return;
    }

    // The slice list: a click picks (Shift adds); ▶ plays.
    if (int i = rowAt (p); i >= 0)
    {
        const auto row = where ("row:" + juce::String (i));
        if (p.x >= row.getX() + 322 && p.x < row.getX() + 338)
            return playSlice (i, true);
        return pick (i, e.mods.isShiftDown());
    }

    // The lane (`chopWireLane`).
    const auto lane = laneRect();
    if (!lane.contains (p))
        return;
    const bool onRuler = p.y < lane.getY() + 18;
    if (tool == "pencil" && !onRuler)
        return take (chopCall ("add", put (obj(), "at", laneFrame (p.x))));
    const auto px = [&] (double f) { return lane.getX() + (float) (xOf (f) * lane.getWidth()); };
    if (onRuler)
    {
        // The cuts' handles (12 wide) and S and E sit over the rest.
        for (auto it = drawnCuts.rbegin(); it != drawnCuts.rend(); ++it)
            if (std::abs (p.x - px ((double) slices[(size_t) *it].s)) <= 6)
            {
                grab = Grab::edge;
                grabI = *it;
                grabSide = "s";
                grabRuler = true;
                if (tool == "lock")
                {
                    grab = Grab::none;
                    take (chopCall ("lock", put (obj(), "i", grabI)));
                }
                return;
            }
        for (const auto& [which, f] : { std::pair<juce::String, int64_t> { "e", regionE }, { "s", regionS } })
        {
            const float x = px ((double) f);
            const bool hit = which == "s" ? (p.x >= x && p.x <= x + 14) : (p.x <= x && p.x >= x - 14);
            if (hit && p.y >= lane.getY() + 2 && p.y <= lane.getY() + 15)
            {
                grab = Grab::region;
                grabSide = which;
                grabStart = laneFrame (p.x);
                grabR0s = (double) regionS;
                grabR0e = (double) regionE;
                return;
            }
        }
        const double at = laneFrame (p.x);
        if (at > (double) regionS && at < (double) regionE)
        {
            grab = Grab::region;
            grabSide = "both";
            grabStart = at;
            grabR0s = (double) regionS;
            grabR0e = (double) regionE;
        }
        return;
    }
    // An edge (8 wide), then the slice under it.
    const bool contig = str ("mode") != "silence";
    for (auto it = drawnSlices.rbegin(); it != drawnSlices.rend(); ++it)
    {
        const auto& x = slices[(size_t) *it];
        const bool atS = std::abs (p.x - px ((double) x.s)) <= 4;
        const bool atE = !contig && std::abs (p.x - px ((double) x.e)) <= 4;
        if (atS || atE)
        {
            if (tool == "lock")
                return take (chopCall ("lock", put (obj(), "i", *it)));
            grab = Grab::edge;
            grabI = *it;
            grabSide = atS ? "s" : "e";
            grabRuler = false;
            return;
        }
    }
    const double at = laneFrame (p.x);
    for (int i = 0; i < (int) slices.size(); ++i)
        if (at >= (double) slices[(size_t) i].s && at < (double) slices[(size_t) i].e)
        {
            if (tool == "audition")
                return playSlice (i, false);
            if (tool == "lock")
                return take (chopCall ("lock", put (obj(), "i", i)));
            pick (i, e.mods.isShiftDown());
            if (!e.mods.isShiftDown())
                playSlice (i, true);
            return;
        }
}

double ChopFace::toU (const Knob& k, double v) const
{
    // `uiScale`.
    const bool lg = k.log && k.min > 0;
    const double u = lg ? std::log (juce::jmax (v, k.min) / k.min) / std::log (k.max / k.min) : (v - k.min) / (!juce::exactlyEqual (k.max, k.min) ? (k.max - k.min) : 1);
    return juce::jlimit (0.0, 1.0, u);
}

double ChopFace::fromU (const Knob& k, double u) const
{
    const bool lg = k.log && k.min > 0;
    double v = lg ? k.min * std::pow (k.max / k.min, u) : k.min + u * (k.max - k.min);
    if (k.step > 0)
        v = jsRound (v / k.step) * k.step;
    return v;
}

void ChopFace::mouseDrag (const juce::MouseEvent& e)
{
    const auto p = e.position;
    grabMoved = grabMoved || p.getDistanceFrom (down) > 2;
    if (grab == Grab::knob)
    {
        const auto& kn = knobs[grabKey];
        grabU = juce::jlimit (0.0, 1.0, grabU + (grabY - p.y) / (e.mods.isShiftDown() ? 160.0 * 5 : 160.0));
        grabY = p.y;
        const double v = fromU (kn, grabU);
        if (std::abs (v - num (grabKey)) > 1e-12)
            setKnob (grabKey, v, true);
        return;
    }
    if (grab == Grab::overview)
    {
        const auto r = ids["chopOverview"].r;
        const double L = viewB - viewA;
        viewA = juce::jmax (0.0, juce::jmin ((double) len - L, (p.x - r.getX()) / r.getWidth() * (double) len - L / 2));
        viewB = viewA + L;
        for (const char* l : { "wave", "overlay", "ph", "overview" })
            repaintLayer (l);
        return;
    }
    if (grab == Grab::edge && grabI >= 0 && grabI < (int) slices.size())
    {
        if (!grabMoved)
            return;
        const auto lane = laneRect();
        auto body = put (obj(), "i", grabI);
        put (body, "side", grabSide);
        put (body, "to", laneFrame (p.x));
        put (body, "snap", !e.mods.isAltDown());
        take (chopCall ("move", body));
        grabAway = grabRuler && (p.y < lane.getY() - 24 || p.y > lane.getY() + 48);
        going = grabAway ? grabI : -1;
        if (grabI < (int) slices.size())
        {
            const auto& x = slices[(size_t) grabI];
            const double f = grabSide == "s" ? (double) x.s : (double) x.e;
            readoutAt = f;
            readout = grabAway ? juce::String ("let go to delete")
                               : (grabSide == "s" ? "start " : "end ") + fixed (f / rate, 3) + uni (" s \xc2\xb7 ") + fixed ((double) (x.e - x.s) / rate * 1000, 0) + " ms";
        }
        repaintLayer ("overlay");
        return;
    }
    if (grab == Grab::region)
    {
        const double g = juce::jmax (16.0, jsRound (rate * 0.005));
        const double at = laneFrame (p.x);
        if (grabSide == "s")
            regionS = (int64_t) juce::jmax (0.0, juce::jmin ((double) regionE - g, at));
        else if (grabSide == "e")
            regionE = (int64_t) juce::jmin ((double) len, juce::jmax ((double) regionS + g, at));
        else
        {
            const double d = juce::jmax (-grabR0s, juce::jmin ((double) len - grabR0e, at - grabStart));
            regionS = (int64_t) (grabR0s + d);
            regionE = (int64_t) (grabR0e + d);
        }
        repaintLayer ("overlay");
        repaintLayer ("overview");
    }
}

void ChopFace::mouseUp (const juce::MouseEvent&)
{
    const auto was = grab;
    grab = Grab::none;
    if (was == Grab::knob)
    {
        setKnob (grabKey, num (grabKey), false);
        return;
    }
    if (was == Grab::overview)
    {
        keepUi();
        return;
    }
    if (was == Grab::edge)
    {
        readout.clear();
        going = -1;
        if (grabAway)
            take (chopCall ("delete", put (obj(), "i", grabI)));
        else if (grabMoved)
            take (chopCall ("moved", {}));
        else
            pick (grabI, false);
        grabAway = false;
        repaintLayer ("overlay");
        return;
    }
    if (was == Grab::region)
    {
        if (!juce::exactlyEqual ((double) regionS, grabR0s) || !juce::exactlyEqual ((double) regionE, grabR0e))
        {
            auto body = put (obj(), "s", (double) regionS);
            put (body, "e", (double) regionE);
            take (chopCall ("region", body));
        }
    }
}

void ChopFace::mouseDoubleClick (const juce::MouseEvent& e)
{
    const auto p = e.position;
    // A knob's whole element resets it (`uiKnob`'s dblclick).
    for (const auto& k : knobOrder)
    {
        auto it = ids.find ("knob:" + k);
        if (it != ids.end() && it->second.r.contains (p))
        {
            setKnob (k, knobs[k].def, false);
            return;
        }
    }
    if (!hasSound())
        return;
    if (ids.count ("chopOverview") > 0 && ids["chopOverview"].r.contains (p))
        return fit();
    const auto lane = laneRect();
    if (lane.contains (p) && p.y < lane.getY() + 18)
        take (chopCall ("whole", {}));
}

void ChopFace::mouseWheelMove (const juce::MouseEvent& e, const juce::MouseWheelDetails& w)
{
    const auto p = e.position;
    // The browser's deltaY, from the wheel's.
    const double dy = -(double) w.deltaY * 100, dx = -(double) w.deltaX * 100;
    if (const auto k = knobAt (p); k.isNotEmpty())
    {
        const auto& kn = knobs[k];
        const double u = juce::jlimit (0.0, 1.0, toU (kn, num (k)) - (dy > 0 ? 1 : dy < 0 ? -1 : 0) * 0.03 * (e.mods.isShiftDown() ? 0.2 : 1));
        setKnob (k, fromU (kn, u), false);
        return;
    }
    if (ids.count ("chopSoft") > 0 && ids["chopSoft"].r.contains (p))
    {
        softOn = true;
        softAlpha = juce::jlimit (0.05, 0.9, softAlpha - (dy > 0 ? 1 : dy < 0 ? -1 : 0) * 0.05);
        keepUi();
        restyle();
        repaintLayer ("overlay");
        repaintLayer ("texts:chopSoft");
        return;
    }
    if (ids.count ("list") > 0 && ids["list"].r.contains (p))
    {
        const float most = juce::jmax (0.0f, (float) slices.size() * 20 - ids["list"].r.getHeight());
        listScroll = juce::jlimit (0.0f, most, listScroll + (float) dy * 0.5f);
        repaintLayer ("list");
        return;
    }
    const auto lane = laneRect();
    if (hasSound() && lane.contains (p))
    {
        if (std::abs (dx) > std::abs (dy) || e.mods.isShiftDown())
        {
            const double L = viewB - viewA, d = (!juce::exactlyEqual (dx, 0.0) ? dx : dy) / lane.getWidth() * L;
            viewA = juce::jmax (0.0, juce::jmin ((double) len - L, viewA + d));
            viewB = viewA + L;
            laneChanged();
        }
        else
            zoom (std::exp (dy * 0.002), laneFrame (p.x));
        return;
    }
    Component::mouseWheelMove (e, w);
}
