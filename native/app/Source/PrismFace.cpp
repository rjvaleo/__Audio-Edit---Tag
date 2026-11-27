// Prism's face: building, the view, the layout of what the panels hold, and
// every control's gesture. See PrismFace.h; the drawings are PrismDraw.cpp.
#include "PrismFace.h"

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
juce::String firstText (const juce::var& n)
{
    auto* t = n["text"].getArray();
    return t != nullptr && !t->isEmpty() ? (*t)[0]["text"].toString() : juce::String();
}
void put (juce::var& o, const juce::Identifier& k, const juce::var& v)
{
    if (auto* d = o.getDynamicObject())
        d->setProperty (k, v);
}
double jsRound (double v) { return std::floor (v + 0.5); }
juce::String fixed (double v, int places)
{
    const double p = std::pow (10.0, places);
    const double r = std::floor (std::abs (v) * p + 0.5) / p;
    auto s = juce::String (r, places);
    return v < 0 && !juce::exactlyEqual (r, 0.0) ? "-" + s : s;
}
const char* const engines[][2] = { { "granular", "Granular" }, { "wsola", "WSOLA" }, { "vocoder", "Vocoder" }, { "pvsola", "PVSOLA" }, { "hybrid", "Hybrid" } };
const std::map<juce::String, double> stretchDefaults { { "ratio", 1 }, { "semitones", 0 }, { "windowMs", 46 }, { "cloudMix", 0.5 } };
const std::map<juce::String, double> ptcDefaults { { "speed", 100 }, { "pitch", 100 }, { "feedback", 0 }, { "grain", 15 }, { "xfade", 100 }, { "smoothing", 50 } };
} // namespace

// ─────────────────────────────────────────────────────────────── building

PrismFace::PrismFace (Call c, uint32_t i)
    : call (std::move (c)), id (i), captured (face::page ("prism"))
{
    setSize (1500, 1100);
    setWantsKeyboardFocus (true);
    frame = std::make_unique<face::Chrome> (captured["page"]);
    addAndMakeVisible (*frame);
    nowFrame = std::make_unique<face::Chrome> (captured["nowbar"]);
    addAndMakeVisible (*nowFrame);
    nowFrame->setTopLeftPosition (0, 1052);

    litC = std::make_unique<face::Chrome> (captured["lit"]);
    echoC = std::make_unique<face::Chrome> (captured["echo"]);
    nowLitC = std::make_unique<face::Chrome> (captured["nowbarLit"]);
    index (captured["page"]["tree"], pageIds, {});
    index (captured["lit"]["tree"], litIds, {});
    index (captured["echo"]["tree"], echoIds, {});
    {
        const auto& at = captured["ptc"]["at"];
        index (captured["ptc"]["tree"], ptcIds, { (float) dnum (at[0]), (float) dnum (at[1]) });
    }
    index (captured["nowbar"]["tree"], nowIds, { 0, 1052 });
    index (captured["nowbarLit"]["tree"], nowLitIds, { 0, 1052 });

    // Templates: the looks the face draws its parts with.
    const auto& pt = captured["page"]["tree"];
    const auto& lt = captured["lit"]["tree"];
    auto keep = [this] (const juce::String& name, const juce::var* n) {
        if (n != nullptr)
            look[name] = *n;
    };
    keep ("segOn", findIn (pt, [] (const juce::var& n) { return n["data"]["hseng"].toString() == "granular"; }));
    keep ("segOff", findIn (pt, [] (const juce::var& n) { return n["data"]["hseng"].toString() == "wsola"; }));
    keep ("knobRow", findIn (pt, [] (const juce::var& n) { return n["data"]["key"].toString() == "ratio" && hasClass (n, "prism-knob"); }));
    keep ("knobRowPlain", findIn (pt, [] (const juce::var& n) { return n["data"]["key"].toString() == "windowMs" && hasClass (n, "prism-knob"); }));
    keep ("ctlPanel", findIn (pt, [] (const juce::var& n) { return hasClass (n, "prism-ctl"); }));
    keep ("lfoPanel", findIn (pt, [] (const juce::var& n) { return hasClass (n, "prism-lfos"); }));
    keep ("ctlHead", findIn (pt, [] (const juce::var& n) { return hasClass (n, "prism-nm") && firstText (n) == "CONTROLS"; }));
    keep ("lfoHead", findIn (pt, [] (const juce::var& n) { return hasClass (n, "prism-nm") && firstText (n) == "LFOS"; }));
    keep ("meta", findIn (pt, [] (const juce::var& n) { return n["id"].toString() == "hsSetSub"; }));
    keep ("lfoMeta", findIn (lt, [] (const juce::var& n) { return hasClass (n, "prism-meta") && firstText (n).startsWith ("click"); }));
    keep ("emptyChips", findIn (pt, [] (const juce::var& n) { return hasClass (n, "prism-meta") && firstText (n).startsWith ("nothing mapped"); }));
    keep ("chip", findIn (lt, [] (const juce::var& n) { return hasClass (n, "plfo-chip"); }));
    keep ("mapOff", findIn (pt, [] (const juce::var& n) { return n["id"].toString() == "prismLfoMap"; }));
    keep ("mapOn", findIn (lt, [] (const juce::var& n) { return n["id"].toString() == "prismLfoMap"; }));
    keep ("tabOn", findIn (pt, [] (const juce::var& n) { return hasClass (n, "plfo-tab") && hasClass (n, "on"); }));
    keep ("tabOff", findIn (pt, [] (const juce::var& n) { return hasClass (n, "plfo-tab") && !hasClass (n, "on"); }));
    keep ("lshapeOn", findIn (pt, [] (const juce::var& n) { return hasClass (n, "plfo-shape") && hasClass (n, "on"); }));
    keep ("lshapeOff", findIn (pt, [] (const juce::var& n) { return hasClass (n, "plfo-shape") && !hasClass (n, "on"); }));
    keep ("well", findIn (pt, [] (const juce::var& n) { return hasClass (n, "plfo-well"); }));
    keep ("groupLabel", findIn (captured["echo"]["tree"], [] (const juce::var& n) { return hasClass (n, "prism-group-label"); }));
    keep ("ptcOn", findIn (captured["ptc"]["tree"], [] (const juce::var& n) { return n["id"].toString() == "prismPtcOn"; }));
    keep ("slotOn", findIn (pt, [] (const juce::var& n) { return hasClass (n, "hs-slot") && hasClass (n, "on"); }));
    keep ("slotOff", findIn (pt, [] (const juce::var& n) { return hasClass (n, "hs-slot") && !hasClass (n, "on"); }));
    keep ("togOff", findIn (pt, [] (const juce::var& n) { return hasClass (n, "hs-tog"); }));
    keep ("togOn", findIn (lt, [] (const juce::var& n) { return hasClass (n, "hs-tog"); }));
    keep ("shapeOn", findIn (lt, [] (const juce::var& n) { return n["data"]["hsshape"].toString() == "circle"; }));
    keep ("recOn", findIn (lt, [] (const juce::var& n) { return n["id"].toString() == "hsRec"; }));
    keep ("chipRec", findIn (lt, [] (const juce::var& n) { return n["id"].toString() == "hsChip"; }));
    keep ("chainSlot", findIn (pt, [] (const juce::var& n) { return hasClass (n, "prism-chain-slot"); }));
    keep ("padOff", findIn (pt, [] (const juce::var& n) { return n["id"].toString() == "hsPad"; }));
    keep ("padRec", findIn (lt, [] (const juce::var& n) { return n["id"].toString() == "hsPad"; }));
    keep ("wellMini", findIn (pt, [] (const juce::var& n) { return hasClass (n, "hs-mini"); }));
    keep ("chainCap", findIn (pt, [] (const juce::var& n) { return hasClass (n, "prism-cap") && firstText (n) == "CHAIN"; }));
    keep ("ffill", findIn (pt, [] (const juce::var& n) { return hasClass (n, "hs-ffill"); }));
    keep ("fline", findIn (pt, [] (const juce::var& n) { return n["data"]["pseudo"].toString() == "::after" && dnum (n["rect"][3]) == 2.0; }));
    keep ("menu", &captured["menus"]["pick"]["tree"]);
    keep ("menuHead", findIn (captured["menus"]["pick"]["tree"], [] (const juce::var& n) { return n["tag"].toString() == "i"; }));
    keep ("menuItem", findIn (captured["menus"]["pick"]["tree"], [] (const juce::var& n) { return hasClass (n, "ppick-i") && !hasClass (n, "on"); }));
    keep ("menuItemOn", findIn (captured["menus"]["pick"]["tree"], [] (const juce::var& n) { return hasClass (n, "ppick-i") && hasClass (n, "on"); }));

    // The pictures' styles, as the page's CSS has them where each sits.
    if (auto* sn = findIn (pt, [] (const juce::var& x) { return hasClass (x, "ui-pic") && hasClass (x, "side"); }))
        sideStyle = ppic::Style::fromCaptured ((*sn)["svg"].toString(), true);
    if (auto* bn = findIn (pt, [] (const juce::var& x) { return hasClass (x, "ui-bpic"); }))
        barStyle = ppic::Style::fromCaptured ((*bn)["svg"].toString(), false);
    if (auto* mn = findIn (pt, [] (const juce::var& x) { return hasClass (x, "pic") && hasClass (x, "gg"); }))
        menuStyle = ppic::Style::fromCaptured ((*mn)["svg"].toString(), false);
    if (auto* pn = findIn (captured["menus"]["pick"]["tree"], [] (const juce::var& x) { return hasClass (x, "pic"); }))
        menuItemStyle = ppic::Style::fromCaptured ((*pn)["svg"].toString(), false);
    else
        menuItemStyle = menuStyle;
    // The pad's strokes: its <svg>'s parts as captured, ready and recording.
    auto inks = [] (const juce::var* svgNode, std::map<juce::String, juce::String>& into) {
        if (svgNode == nullptr)
            return;
        const auto s = (*svgNode)["svg"].toString();
        for (const char* part : { "hsGrid", "hsPath", "hsGhost", "hsHalo", "hsBall" })
        {
            const auto at = s.indexOf ("id=\"" + juce::String (part) + "\"");
            if (at < 0)
                continue;
            const auto el = s.substring (at, s.indexOfChar (at, '>'));
            auto attr = [&el] (const char* a) {
                const auto k = el.indexOf (" " + juce::String (a) + "=\"");
                return k < 0 ? juce::String() : el.substring (k + (int) strlen (a) + 3, el.indexOfChar (k + (int) strlen (a) + 3, '"'));
            };
            into[juce::String (part) + ".fill"] = attr ("fill");
            into[juce::String (part) + ".stroke"] = attr ("stroke");
            into[juce::String (part) + ".width"] = attr ("stroke-width");
        }
    };
    inks (findIn (pt, [] (const juce::var& n) { return n["id"].toString() == "hsSvg"; }), padInk);
    inks (findIn (lt, [] (const juce::var& n) { return n["id"].toString() == "hsSvg"; }), padInkRec);

    // Left out of the frame: what the face draws itself, live.
    auto skipId = [this] (const juce::String& k) {
        if (pageIds.count (k) > 0)
            frame->skip.insert (pageIds[k].i);
    };
    auto skipTextId = [this] (const juce::String& k) {
        if (pageIds.count (k) > 0)
            frame->skipText.insert (pageIds[k].i);
    };
    for (const char* k : { "prismSoundName", "prismSoundMeta", "hsChip", "hsInfo", "hsNow", "hsXName", "hsYName", "prismChain", "hsPad",
                           "prismFaderLRead", "prismFaderLRRead", "prismFaderRRead" })
        juce::String (k).startsWith ("prismFader") || juce::String (k) == "prismChain" || juce::String (k) == "hsPad" ? skipId (k) : skipTextId (k);
    std::function<void (const juce::var&)> leave = [&] (const juce::var& n) {
        const int ni = (int) n["i"];
        const auto nid = n["id"].toString();
        // The Process button's picture and name; the drops' words; the preset's name and tag.
        if (nid == "prismPickBtn")
            if (auto* kids = n["kids"].getArray())
                for (int k = 0; k < juce::jmin (2, kids->size()); ++k)
                    frame->skip.insert ((int) (*kids)[k]["i"]);
        if (hasClass (n, "ui-dt") || n["data"]["pb"].toString() == "label" || n["data"]["pb"].toString() == "tag")
            frame->skipText.insert (ni);
        if (n["data"].hasProperty ("hseng") || hasClass (n, "hs-limat") || hasClass (n, "hs-mini") || hasClass (n, "hs-col")
            || hasClass (n, "hs-slots") || hasClass (n, "prism-rateplay") || hasClass (n, "prism-takebars") || hasClass (n, "prism-glide-kv")
            || hasClass (n, "prism-motion") || hasClass (n, "prism-shapes") || hasClass (n, "hs-ffill") || (n["data"]["pseudo"].toString() == "::after" && dnum (n["rect"][3]) == 2.0))
            frame->skip.insert (ni);
        if (hasClass (n, "prism-cap") && firstText (n) == "CHAIN")
            frame->skip.insert (ni);
        if (auto* kids = n["kids"].getArray())
            for (const auto& k : *kids)
                leave (k);
    };
    leave (pt);
    for (const char* k : { "timeNow", "nbName", "nbMeta", "loopLabel", "nbDb" })
        if (nowIds.count (k) > 0)
            nowFrame->skipText.insert (nowIds[k].i - 0);
    for (const char* k : { "playBtn", "loopBtn" })
        if (nowIds.count (k) > 0)
            nowFrame->skip.insert (nowIds[k].i);

    pick = std::make_unique<Pick> (*this);
    addChildComponent (*pick);

    buildLayers();
    fx = prism ("fx");
    // Presets: the app's own file for Prism, and MGL's (read only).
    {
        auto o = obj();
        put (o, "op", "places");
        put (o, "mine", places::prismPresets().getFullPathName());
        put (o, "mgl", places::mgl().getChildFile ("PAD-PRESETS.json").getFullPathName());
        presetList = prism ("presets", o);
    }
    reload();
    startTimerHz (60);
}

PrismFace::~PrismFace()
{
    stopTimer();
}

juce::var PrismFace::obj() const { return juce::var (new juce::DynamicObject()); }

double PrismFace::now() const
{
    return fixedClock > 0 ? fixedClock : juce::Time::getMillisecondCounterHiRes();
}

void PrismFace::index (const juce::var& n, Ids& into, juce::Point<float> by)
{
    const auto r = rectOf (n["rect"]) + by;
    const N node { (int) n["i"], r, n };
    const auto nid = n["id"].toString();
    if (nid.isNotEmpty())
        into[nid] = node;
    const auto& d = n["data"];
    if (d.isObject())
    {
        if (d.hasProperty ("slot")) into["slot:" + d["slot"].toString()] = node;
        if (d.hasProperty ("hsrate")) into["rate:" + d["hsrate"].toString()] = node;
        if (d.hasProperty ("hsdir")) into["dir:" + d["hsdir"].toString()] = node;
        if (d.hasProperty ("hsshape")) into["shape:" + d["hsshape"].toString()] = node;
        if (d.hasProperty ("hseng")) into["eng:" + d["hseng"].toString()] = node;
        if (d.hasProperty ("for")) into["dd:" + d["for"].toString()] = node;
        if (d.hasProperty ("pb")) into["pb:" + d["pb"].toString()] = node;
        if (d.hasProperty ("key") && hasClass (n, "ui-bar")) into["bar:" + d["key"].toString()] = node;
        if (d.hasProperty ("k") && hasClass (n, "plfo-tab")) into["tab:" + d["k"].toString()] = node;
        if (d.hasProperty ("shape") && hasClass (n, "plfo-shape")) into["lshape:" + d["shape"].toString()] = node;
    }
    if (hasClass (n, "hs-tog"))
        into[into.count ("tog:0") ? "tog:1" : "tog:0"] = node;
    if (hasClass (n, "hs-slots")) into["slots"] = node;
    if (hasClass (n, "prism-glide-kv")) into["glideBox"] = node;
    if (hasClass (n, "hs-padbox")) into["padbox"] = node;
    if (hasClass (n, "prism-takes")) into["takes"] = node;
    if (hasClass (n, "plfo-well")) into["lfoWell"] = node;
    if (hasClass (n, "hs-fwell"))
        into[into.count ("fwell:l") == 0 ? "fwell:l" : into.count ("fwell:lr") == 0 ? "fwell:lr" : "fwell:r"] = node;
    if (auto* kids = n["kids"].getArray())
        for (const auto& k : *kids)
            index (k, into, by);
}

const juce::var* PrismFace::findIn (const juce::var& n, const std::function<bool (const juce::var&)>& want) const
{
    if (want (n))
        return &n;
    if (auto* kids = n["kids"].getArray())
        for (const auto& k : *kids)
            if (auto* f = findIn (k, want))
                return f;
    return nullptr;
}

juce::Colour PrismFace::cl (const juce::String& token, const juce::String& fallback) const
{
    const auto s = captured["cl"][juce::Identifier (token)].toString();
    return c2d::css (s.isEmpty() ? fallback : s);
}

PrismFace::Layer* PrismFace::addLayer (const juce::String& n, juce::Rectangle<float> r, std::function<void (juce::Graphics&)> draw)
{
    auto l = std::make_unique<Layer>();
    l->name = n;
    l->draw = [d = std::move (draw), r] (juce::Graphics& g) {
        g.setOrigin (-r.getSmallestIntegerContainer().getPosition());
        d (g);
    };
    l->setInterceptsMouseClicks (false, false);
    l->setBounds (r.getSmallestIntegerContainer());
    addAndMakeVisible (*l);
    named[n] = l.get();
    layers.push_back (std::move (l));
    return layers.back().get();
}

void PrismFace::repaintLayer (const juce::String& n)
{
    if (auto it = named.find (n); it != named.end())
    {
        it->second->repaint();
        dirty.push_back ({ it->second, it->second->getLocalBounds() });
    }
}

void PrismFace::buildLayers()
{
    addLayer ("src", { 12, 11, 1476, 101 }, [this] (juce::Graphics& g) { drawSource (g); });
    addLayer ("head", { 12, 118, 1476, 48 }, [this] (juce::Graphics& g) { drawHead (g); });
    addLayer ("deck", { 0, 168, 1500, 34 }, [this] (juce::Graphics& g) { drawDeck (g); });
    addLayer ("padhead", { 12, 206, 716, 38 }, [this] (juce::Graphics& g) { drawPadPanel (g); });
    addLayer ("padbg", { 18, 240, 704, 795 }, [this] (juce::Graphics& g) { drawPadBox (g); });
    addLayer ("pad", { 18, 240, 704, 795 }, [this] (juce::Graphics& g) { drawPad (g); });
    addLayer ("ctl", { 730, 200, 408, 846 }, [this] (juce::Graphics& g) { drawControls (g); });
    addLayer ("lfo", { 730, 200, 408, 846 }, [this] (juce::Graphics& g) { drawLfos (g); });
    addLayer ("takes", { 1136, 200, 244, 846 }, [this] (juce::Graphics& g) { drawTakes (g); });
    addLayer ("out", { 1380, 200, 112, 846 }, [this] (juce::Graphics& g) { drawOutput (g); });
    addLayer ("now", { 0, 1052, 1500, 48 }, [this] (juce::Graphics& g) { drawNow (g); });
    pick->toFront (false);
}

// ─────────────────────────────────────────────────────────────── the view

juce::var PrismFace::prism (const char* what, const juce::var& body)
{
    // An action runs once: its answer is read into room enough for it, and
    // if there was not room, the module's view is asked for instead (asking
    // the action again would do it again).
    const auto text = body.isVoid() ? std::string() : juce::JSON::toString (body, true).toStdString();
    juce::String err;
    auto run = [&] (const char* w, const char* json, std::vector<char>& buf) {
        return call ([&] (NaApp* a) {
            const int32_t n = na_prism_call (a, id, w, json, buf.data(), (uint32_t) buf.size());
            if (n < 0)
                err = juce::String (naText ([a] (char* eb, uint32_t ec) { return na_error (a, eb, ec); }));
            return (int64_t) n;
        });
    };
    if (answerBuf.size() < (1u << 20))
        answerBuf.resize (1u << 20);
    auto n = run (what, text.empty() ? nullptr : text.c_str(), answerBuf);
    const bool idempotent = juce::StringArray ({ "view", "fx", "sources", "state", "info" }).contains (what)
                            || (juce::String (what) == "presets" && body["op"].toString() == "list")
                            || (juce::String (what) == "rack" && body["op"].toString() == "get");
    if (n >= (int64_t) answerBuf.size())
    {
        answerBuf.resize ((size_t) n + 4096);
        n = idempotent ? run (what, text.empty() ? nullptr : text.c_str(), answerBuf) : run ("view", nullptr, answerBuf);
    }
    if (err.isNotEmpty() || n < 0)
    {
        say (err);
        return {};
    }
    const auto answer = juce::String::fromUTF8 (answerBuf.data(), (int) juce::jmin ((int64_t) answerBuf.size() - 1, n));
    auto v = juce::JSON::parse (answer);
    if (v.isObject() && v.hasProperty ("pad") && v.hasProperty ("sources"))
    {
        viewText = answer;
        readView (v);
    }
    return v;
}

void PrismFace::reload()
{
    prism ("view");
    loadPresets();
    padSized = false;
    refresh (true);
}

void PrismFace::readView (const juce::var& v)
{
    view = v;
    source = v["source"].toString();
    setup = v["setup"];
    values = v["values"];
    pad = v["pad"];
    lfos = v["lfos"];
    deck = v["deck"];
    sources.clear();
    if (auto* a = v["sources"].getArray())
        sources = *a;
    const auto& s = v["sound"];
    soundName = s["name"].toString();
    soundPath = s["path"].toString();
    frames = dnum (s["frames"]);
    rate = dnum (s["rate"], 48000);
    inFrames = dnum (deck["inFrames"], frames);
    position = dnum (deck["position"]);
    playing = (bool) deck["playing"];
    looping = (bool) deck["looping"];
}

const juce::var* PrismFace::currentSource() const
{
    for (const auto& s : sources)
        if (s["id"].toString() == source)
            return &s;
    return sources.isEmpty() ? nullptr : &sources.getReference (0);
}

const juce::var* PrismFace::control (const juce::String& key) const
{
    if (auto* s = currentSource())
        if (auto* cs = (*s)["controls"].getArray())
            for (const auto& c : *cs)
                if (c["key"].toString() == key)
                    return &c;
    return nullptr;
}

void PrismFace::readMeta()
{
    // The line under SOURCE, as the metastrip says it for the open sound:
    // its format, rate, bits, channels and length.
    const auto key = soundPath + "|" + juce::String (frames) + "|" + juce::String (rate);
    if (key == metaFor)
        return;
    metaFor = key;
    juce::String format, bits, channels;
    const int sound = (int) call ([this] (NaApp* a) { return (int64_t) na_sound_of (a, id); });
    juce::String path = view["sound"]["file"].toString().isNotEmpty() ? view["sound"]["file"].toString() : soundPath;
    if (sound >= 0)
    {
        const auto info = juce::JSON::parse (juce::String (naText ([&] (char* b, uint32_t cap) {
            return (uint32_t) juce::jmax (0, (int) call ([&] (NaApp* a) { return (int64_t) na_sound_info (a, (uint32_t) sound, b, cap); }));
        })));
        if ((int) dnum (info["channels"]) > 0)
            channels = juce::String ((int) dnum (info["channels"])) + " ch";
        if (info["origin"]["file"].toString().isNotEmpty())
            path = info["origin"]["file"].toString();
        else if (info["origin"]["path"].toString().isNotEmpty())
            path = info["origin"]["path"].toString();
    }
    const juce::File file (path);
    if (path.isNotEmpty() && juce::File::isAbsolutePath (path) && file.existsAsFile())
    {
        format = file.getFileExtension().trimCharactersAtStart (".").toLowerCase();
        // A WAV's bits, from its fmt chunk (the library lists them).
        juce::FileInputStream in (file);
        char hdr[12] {};
        if (in.openedOk() && in.read (hdr, 12) == 12 && juce::String (hdr, 4) == "RIFF")
            while (!in.isExhausted())
            {
                char tag[4] {};
                if (in.read (tag, 4) != 4)
                    break;
                const int size = in.readInt();
                if (juce::String (tag, 4) == "fmt ")
                {
                    in.skipNextBytes (14);
                    bits = juce::String ((int) in.readShort()) + "-bit";
                    break;
                }
                in.skipNextBytes (size + (size & 1));
            }
    }
    else if (soundName.containsChar ('.'))
        format = soundName.fromLastOccurrenceOf (".", false, false).toLowerCase();
    juce::StringArray parts;
    if (format.isNotEmpty()) parts.add (format);
    if (rate > 0) parts.add (juce::String ((int) rate) + " Hz");
    if (bits.isNotEmpty()) parts.add (bits);
    if (channels.isNotEmpty()) parts.add (channels);
    if (frames > 0) parts.add (fixed (frames / rate, 2) + " s");
    metaLine = soundName.isEmpty() ? juce::String() : parts.joinIntoString (uni (" \xc2\xb7 "));
}

void PrismFace::loadPresets()
{
    auto o = obj();
    put (o, "op", "list");
    auto r = prism ("presets", o);
    if (r.isObject())
        presetList = r;
}

void PrismFace::refresh (bool all)
{
    readMeta();
    layoutControls();
    if (soundPath + juce::String (frames) != peaksFor)
        loadPeaks();
    auto sig = [this] (const juce::String& layer, const juce::String& s) {
        if (sigs[layer] == s)
            return;
        sigs[layer] = s;
        repaintLayer (layer);
    };
    auto js = [] (const juce::var& v) { return juce::JSON::toString (v, true); };
    const auto& p = pad;
    const double ratio = dnum (view["stretch"]["ratio"], 1);
    const double at = inFrames > 0 ? std::fmod (position / (inFrames * (juce::exactlyEqual (ratio, 0.0) ? 1 : ratio)), 1.0) : 0;
    sig ("src", soundName + metaLine + juce::String ((int) (at * 1454)) + juce::String (peaks.size()));
    sig ("head", source + js (setup) + p["mode"].toString() + p["slot"].toString() + p["loopOnRelease"].toString() + js (presetList["label"]) + js (presetList["tag"]) + js (presetList["at"]));
    sig ("deck", soundName + js (view["chain"]) + juce::String ((int) (at * 420)));
    sig ("padhead", js (p["mode"]) + js (p["slot"]) + js (p["slots"]) + js (p["recN"]) + js (view["stretch"]["algorithm"]) + js (p["ghost"]) + js (setup) + source);
    sig ("padbg", p["mode"].toString() == "rec" ? "rec" : "off");
    sig ("pad", js (p["hand"]) + js (p["ghost"]) + js (p["hover"]) + js (p["down"]) + js (p["mode"]) + juce::String (p["path"].size()) + js (setup) + js (p["lim"]) + source + (limitEdit != nullptr ? limitField : juce::String()));
    juce::String anim;
    if (auto* ls = lfos["lfos"].getArray())
        for (const auto& l : *ls)
            anim << fixed (dnum (l["phase"]), 3) << fixed (dnum (l["now"]), 2);
    // Controls: the panel whole when what it holds or where changed; else
    // only the knobs whose reading or reach moved.
    {
        juce::String geo;
        for (const auto& c : cells)
            geo << c.s.key << c.r.toString() << c.name.joinIntoString ("/") << c.ax << ";";
        const auto panel = source + geo + js (view["ptc"]["on"]) + js (lfos["mapping"]) + ctlPanel.toString();
        if (sigs["ctl"] != panel)
        {
            sigs["ctl"] = panel;
            repaintLayer ("ctl");
            cellSigs.clear();
        }
        if (auto* l = named["ctl"])
            for (const auto& c : cells)
            {
                juce::String m;
                if (auto* ms = view["lfoMarks"].getArray())
                    for (const auto& mk : *ms)
                        if (mk["key"].toString() == c.s.key)
                            m = js (mk);
                const auto cs = c.value.joinIntoString ("/") + fixed (valueOf (c.s.key), 6) + m;
                if (cellSigs[c.s.key] != cs)
                {
                    const bool first = cellSigs.count (c.s.key) == 0;
                    cellSigs[c.s.key] = cs;
                    if (!first)
                    {
                        const auto r = (c.r.expanded (4) - l->getPosition().toFloat()).getSmallestIntegerContainer();
                        l->repaint (r);
                        dirty.push_back ({ l, r });
                    }
                }
            }
    }
    // The LFOs: the panel when it changed; else only the scope and the dots move.
    juce::String lfoStatic;
    if (auto* ls = lfos["lfos"].getArray())
        for (const auto& l : *ls)
            lfoStatic << l["shape"].toString() << dnum (l["rate"]) << dnum (l["depth"]) << dnum (l["pw"]) << js (l["targets"]);
    const auto lfoSig = lfoStatic + js (lfos["sel"]) + js (lfos["mapping"]) + lfoPanel.toString() + source + (grab == Grab::knob && grabLfo ? juce::String (grabV) : juce::String());
    if (sigs["lfo"] != lfoSig)
    {
        sigs["lfo"] = lfoSig;
        repaintLayer ("lfo");
    }
    else if (sigs["lfoAnim"] != anim)
        if (auto* l = named["lfo"])
        {
            const auto sr = (lfoPanel.withHeight (100) - l->getPosition().toFloat()).getSmallestIntegerContainer();
            l->repaint (sr);
            dirty.push_back ({ l, sr });
        }
    sigs["lfoAnim"] = anim;
    sig ("takes", js (p["slots"]) + js (p["slot"]) + js (p["rate"]) + js (p["dir"]) + js (p["throwOn"]) + js (p["loopOnRelease"]) + source);
    // The bars: only the one that moved, and coef with Glide.
    if (auto* l = named["takes"])
    {
        const bool tp = source == "stretch" || source.isEmpty();
        const auto& tk = tp ? pageIds : echoIds;
        const juce::String vals[] = { js (p["glide"]) + js (view["coef"]) + (grab == Grab::bar && grabKey == "smoothing" ? juce::String (grabV) : juce::String()),
                                      js (view["hp"]["speed"]), js (view["postRoll"]) + (grab == Grab::bar && grabKey == "postRoll" ? juce::String (grabV) : juce::String()) };
        const char* keys[] = { "smoothing", "pbSpeed", "postRoll" };
        for (int k = 0; k < 3; ++k)
        {
            const auto sk = juce::String ("bar:") + keys[k];
            if (sigs[sk] == vals[k])
                continue;
            sigs[sk] = vals[k];
            auto it = tk.find (sk);
            if (it == tk.end())
                continue;
            auto r = it->second.r;
            if (k == 0 && tk.count ("glideBox"))
                r = r.getUnion (tk.at ("glideBox").r);
            const auto rr = (r.expanded (2) - l->getPosition().toFloat()).getSmallestIntegerContainer();
            l->repaint (rr);
            dirty.push_back ({ l, rr });
        }
    }
    sig ("out", js (view["hp"]));
    sig ("now", juce::String (playing ? 1 : 0) + juce::String (looping ? 1 : 0) + soundName + juce::String ((int) (position / juce::jmax (1.0, rate) * 1000)));
    if (all)
        for (auto& l : layers)
            l->repaint();
}

void PrismFace::timerCallback()
{
    if (!padSized)
        padSize();
    auto o = obj();
    put (o, "t", now());
    prism ("tick", o);
    refresh (false);
}

void PrismFace::padSize()
{
    padSized = true;
    const auto r = padBox();
    auto o = obj();
    put (o, "op", "size");
    put (o, "w", r.getWidth());
    put (o, "h", r.getHeight());
    prism ("padop", o);
}

void PrismFace::say (const juce::String& s)
{
    if (onMessage)
        onMessage (s);
}

// ─────────────────────────────────────────────── the Controls panel's layout

double PrismFace::valueOf (const juce::String& key) const
{
    if (values.hasProperty (juce::Identifier (key)))
        return dnum (values[juce::Identifier (key)]);
    return 0;
}

std::vector<PrismFace::Spec> PrismFace::specsNow (juce::StringArray* groupsOut, std::vector<juce::StringArray>* groupKeys) const
{
    std::vector<Spec> out;
    const auto* src = currentSource();
    if (src == nullptr)
        return out;
    auto fromControl = [] (const juce::var& c) {
        Spec s;
        s.key = c["key"].toString();
        s.label = c["label"].toString();
        s.unit = c["unit"].toString();
        s.min = dnum (c["min"]);
        s.max = dnum (c["max"], 1);
        s.log = (bool) c["log"];
        s.step = dnum (c["step"]);
        if (auto* ch = c["choices"].getArray())
            for (const auto& x : *ch)
                s.choices.add (x.toString());
        if (c.hasProperty ("default") && !c["default"].isVoid())
        {
            s.def = dnum (c["default"]);
            s.hasDef = true;
        }
        return s;
    };
    const auto sid = (*src)["id"].toString();
    if (sid == "stretch" || sid == "ptc")
    {
        const bool ptc = sid == "ptc";
        if (auto* cs = (*src)["controls"].getArray())
            for (const auto& c : *cs)
            {
                auto s = fromControl (c);
                const auto& d = ptc ? ptcDefaults : stretchDefaults;
                if (auto it = d.find (s.key); it != d.end())
                {
                    s.def = it->second;
                    s.hasDef = true;
                }
                if (ptc)
                    s.step = 1;
                out.push_back (s);
            }
        return out;
    }
    juce::String kind;
    if (auto* ch = view["chain"].getArray())
        for (const auto& c : *ch)
            if (c["id"].toString() == sid)
                kind = c["kind"].toString();
    const juce::var* shaper = nullptr;
    if (auto* shs = fx["shapers"].getArray())
        for (const auto& s : *shs)
            if (s["kind"].toString() == kind)
                shaper = &s;
    if (shaper != nullptr && (*shaper)["params"].size() > 0 && kind != "comp")
    {
        for (const auto& p : *(*shaper)["params"].getArray())
            out.push_back (fromControl (p));
        if (groupsOut != nullptr && groupKeys != nullptr)
            if (auto* gs = (*shaper)["panel"]["groups"].getArray())
                for (const auto& g : *gs)
                {
                    groupsOut->add (g["label"].toString());
                    juce::StringArray keys;
                    if (auto* ks = g["keys"].getArray())
                        for (const auto& k : *ks)
                            keys.add (k.toString());
                    groupKeys->push_back (keys);
                }
        return out;
    }
    if (auto* cs = (*src)["controls"].getArray())
        for (const auto& c : *cs)
        {
            auto s = fromControl (c);
            s.hasDef = false;
            out.push_back (s);
        }
    return out;
}

juce::String PrismFace::fmtKnob (const Spec& s, double v) const
{
    // prismBarFormat (and prismFormat for Stretch and Pitch).
    if (!std::isfinite (v))
        return {};
    if (!s.choices.isEmpty())
    {
        const int k = (int) jsRound (v - s.min);
        return k >= 0 && k < s.choices.size() ? s.choices[k] : juce::String ((int64_t) jsRound (v));
    }
    if (s.key == "ratio")
        return (v >= 10 ? fixed (v, 0) : v >= 1 ? fixed (v, 2) : fixed (v, 3)) + uni ("\xc3\x97");
    if (s.key == "semitones")
        return (v >= 0 ? "+" : "") + fixed (v, 1) + " st";
    const auto n = juce::exactlyEqual (s.step, 1.0) || std::abs (v) >= 10 ? juce::String ((int64_t) jsRound (v)) : fixed (v, 2);
    return s.unit.isNotEmpty() ? n + " " + s.unit : n;
}

double PrismFace::toU (const Spec& s, double v) const
{
    const bool stepped = juce::exactlyEqual (s.step, 1.0) || !s.choices.isEmpty();
    const bool lg = s.log && s.min > 0 && !stepped;
    const double u = lg ? std::log (std::max (v, s.min) / s.min) / std::log (s.max / s.min) : (v - s.min) / (!juce::exactlyEqual (s.max, s.min) ? (s.max - s.min) : 1);
    return juce::jlimit (0.0, 1.0, u);
}

double PrismFace::fromU (const Spec& s, double u) const
{
    const bool stepped = juce::exactlyEqual (s.step, 1.0) || !s.choices.isEmpty();
    const bool lg = s.log && s.min > 0 && !stepped;
    const double step = stepped ? 1 : (s.max - s.min) / 400;
    double v = lg ? s.min * std::pow (s.max / s.min, u) : s.min + u * (s.max - s.min);
    if (step > 0)
        v = jsRound (v / step) * step;
    if (stepped)
        return jsRound (v);
    // Then through the page's hidden range input, whose value is what is sent:
    // a thousand ticks along a log control, min + n steps along a linear one,
    // never under min or over max (so Stretch stops at 0.01, not 0).
    if (lg)
    {
        const double t = jsRound (std::log (juce::jlimit (s.min, s.max, v) / s.min) / std::log (s.max / s.min) * 1000) / 1000;
        return s.min * std::pow (s.max / s.min, t);
    }
    if (step > 0)
        v = s.min + jsRound ((v - s.min) / step) * step;
    return juce::jlimit (s.min, s.max, v);
}

namespace
{
// Words wrapped to a width, as `white-space: normal` breaks them.
juce::StringArray wrap (const juce::Font& f, const juce::String& text, float width, float extraLast = 0)
{
    juce::StringArray lines;
    juce::String line;
    for (const auto& w : juce::StringArray::fromTokens (text, " ", ""))
    {
        const auto tryIt = line.isEmpty() ? w : line + " " + w;
        if (line.isNotEmpty() && juce::GlyphArrangement::getStringWidth (f, tryIt) > width)
        {
            lines.add (line);
            line = w;
        }
        else
            line = tryIt;
    }
    if (line.isNotEmpty())
    {
        if (extraLast > 0 && lines.size() >= 0 && juce::GlyphArrangement::getStringWidth (f, line) + extraLast > width && line.containsChar (' '))
        {
            lines.add (line.upToLastOccurrenceOf (" ", false, false));
            line = line.fromLastOccurrenceOf (" ", false, false);
        }
        lines.add (line);
    }
    return lines;
}
} // namespace

void PrismFace::layoutControls()
{
    // What the panel holds decides its height, and where the LFOs' starts
    // (prismRenderSettings into a grid of 74 px columns, five to a line).
    juce::StringArray groups;
    std::vector<juce::StringArray> groupKeys;
    auto specs = specsNow (&groups, &groupKeys);
    const auto* src = currentSource();
    const auto sid = src != nullptr ? (*src)["id"].toString() : juce::String();
    const auto px = setup["x"].toString(), py = setup["y"].toString();

    const auto& row = look["knobRowPlain"];
    const auto* kn = findIn (row, [] (const juce::var& n) { return hasClass (n, "ui-kname"); });
    const auto* kv = findIn (row, [] (const juce::var& n) { return hasClass (n, "ui-kval"); });
    const auto* axn = findIn (look["knobRow"], [] (const juce::var& n) { return n["data"]["pseudo"].toString() == "::after"; });
    const auto nameFont = kn != nullptr ? face::font ((*kn)["text"][0]["font"]) : face::sans (10, 500);
    const auto valFont = kv != nullptr ? face::font ((*kv)["text"][0]["font"]) : face::mono (10);
    const auto axFont = axn != nullptr ? face::font ((*axn)["text"][0]["font"]) : face::mono (9, 700);

    // The values each knob shows now (an LFO's swing, or the setting).
    auto shown = [this] (const juce::String& key) {
        if (auto* ms = view["lfoMarks"].getArray())
            for (const auto& m : *ms)
                if (m["key"].toString() == key)
                    return dnum (m["v"]);
        return valueOf (key);
    };
    juce::String key = sid + "|";
    for (const auto& s : specs)
        key << s.key << "=" << fmtKnob (s, shown (s.key)) << ";";
    int sel = (int) dnum (lfos["sel"]);
    const auto& L = lfos["lfos"][sel];
    key << "|" << L["shape"].toString() << fmtKnob ({ "lfoRate", "Rate", "Hz", 0.02, 20, 0, 1, true, true, {} }, dnum (L["rate"]));
    if (key == layoutFor)
        return;
    layoutFor = key;

    auto place = [&] (const Spec& s, const juce::String& ax, double v, bool lfoKnob) {
        Cell c;
        c.s = s;
        c.ax = ax;
        c.src = sid;
        c.lfo = lfoKnob;
        const float axW = ax.isNotEmpty() ? 3 + juce::GlyphArrangement::getStringWidth (axFont, ax) : 0;
        c.name = wrap (nameFont, s.label, 74, axW);
        c.value = wrap (valFont, fmtKnob (s, v), 74);
        c.r = { 0, 0, 74, 28.0f + 11.0f * (float) (c.name.size() + c.value.size()) };
        return c;
    };
    auto grid = [&] (std::vector<Cell>& into, float x0, float y0, std::vector<std::pair<juce::String, int>>* labels) {
        // Rows of five; a group's label takes a row of its own.
        float y = y0;
        std::vector<Cell*> rowCells;
        auto flush = [&] {
            if (rowCells.empty())
                return;
            float h = 0;
            for (auto* c : rowCells)
                h = std::max (h, c->r.getHeight());
            for (size_t k = 0; k < rowCells.size(); ++k)
            {
                auto* c = rowCells[k];
                const float ch = c->r.getHeight();
                c->r = { x0 + 74.0f * (float) k, y + (h - ch) / 2, 74, ch };
            }
            y += h + 6;
            rowCells.clear();
        };
        size_t at = 0;
        for (size_t k = 0; k < into.size(); ++k)
        {
            if (labels != nullptr)
                for (auto& [text, before] : *labels)
                    if (before == (int) k)
                    {
                        flush();
                        groupLabels.push_back ({ text, { x0, y + 2, 370, 12 } });
                        y += 2 + 12 + 6;
                    }
            rowCells.push_back (&into[k]);
            if (rowCells.size() == 5)
                flush();
            at = k;
        }
        juce::ignoreUnused (at);
        flush();
        return into.empty() ? y0 : y - 6;
    };

    cells.clear();
    groupLabels.clear();
    std::set<juce::String> seen;
    std::map<juce::String, Spec> byKey;
    for (const auto& s : specs)
        byKey[s.key] = s;
    std::vector<std::pair<juce::String, int>> labels;
    auto add = [&] (const juce::StringArray& keys) {
        for (const auto& k : keys)
        {
            if (byKey.count (k) == 0 || seen.count (k) > 0)
                continue;
            seen.insert (k);
            cells.push_back (place (byKey[k], k == px ? "X" : k == py ? "Y" : "", shown (k), false));
        }
    };
    add ({ px, py });
    for (int g = 0; g < groups.size(); ++g)
    {
        juce::StringArray rest;
        for (const auto& k : groupKeys[(size_t) g])
            if (byKey.count (k) > 0 && seen.count (k) == 0)
                rest.add (k);
        if (rest.isEmpty())
            continue;
        if (groups[g].isNotEmpty() && groups[g] != "Pad")
            labels.push_back ({ groups[g].replace ("Added (not in the original)", uni ("Added \xc2\xb7 not in the original")), (int) cells.size() });
        add (rest);
    }
    {
        juce::StringArray all;
        for (const auto& s : specs)
            all.add (s.key);
        add (all);
    }
    const float bottom = grid (cells, 747, 244, &labels);
    ctlPanel = { 736, 206, 396, (cells.empty() ? 244.0f : bottom) + 11 - 206 };
    lfoPanel = { 736, ctlPanel.getBottom() + 8, 396, 1040 - (ctlPanel.getBottom() + 8) };
    lfoDy = lfoPanel.getY() - 324;
    for (auto& c : cells)
    {
        const float kx = c.r.getX() + 12.5f, ky = c.r.getY();
        c.pic = { kx, ky + 5, 22, 16 };
        c.knob = { kx + 23, ky, 26, 26 };
        c.labelY = ky + 28;
    }

    // The LFO's own knobs: Rate, Depth, and Width for a pulse.
    lfoCells.clear();
    std::vector<std::pair<Spec, juce::String>> ls { { { "lfoRate", "Rate", "Hz", 0.02, 20, 0, 1, true, true, {} }, "rate" },
                                                    { { "lfoDepth", "Depth", "%", 0, 100, 0, 25, false, true, {} }, "depth" } };
    if (L["shape"].toString() == "pulse")
        ls.push_back ({ { "lfoPw", "Width", "%", 5, 95, 0, 25, false, true, {} }, "pw" });
    for (auto& [s, field] : ls)
    {
        auto c = place (s, {}, dnum (L[juce::Identifier (field)]), true);
        c.field = field;
        lfoCells.push_back (c);
    }
    grid (lfoCells, 747, 491 + lfoDy, nullptr);
    for (auto& c : lfoCells)
    {
        const float kx = c.r.getX() + 12.5f, ky = c.r.getY();
        c.pic = { kx, ky + 5, 22, 16 };
        c.knob = { kx + 23, ky, 26, 26 };
        c.labelY = ky + 28;
    }
}

// ─────────────────────────────────────────────────────────────── where

juce::Rectangle<float> PrismFace::padBox() const
{
    auto it = pageIds.find ("padbox");
    return it != pageIds.end() ? it->second.r : juce::Rectangle<float> (23, 244, 694, 785);
}

juce::Point<float> PrismFace::padFrac (juce::Point<float> p) const
{
    const auto r = padBox();
    return { juce::jlimit (0.0f, 1.0f, (p.x - r.getX()) / r.getWidth()), juce::jlimit (0.0f, 1.0f, (p.y - r.getY()) / r.getHeight()) };
}

juce::Rectangle<float> PrismFace::where (const juce::String& part) const
{
    auto idr = [] (const Ids& m, const juce::String& k) {
        auto it = m.find (k);
        return it != m.end() ? it->second.r : juce::Rectangle<float>();
    };
    const bool tp = source == "stretch" || source.isEmpty();
    const auto& tk = tp ? pageIds : echoIds;
    if (part == "pad") return padBox();
    if (part.startsWith ("knob:"))
        for (const auto& c : cells)
            if (c.s.key == part.substring (5))
                return c.knob;
    if (part.startsWith ("lfoKnob:"))
        for (const auto& c : lfoCells)
            if (c.field == part.substring (8))
                return c.knob;
    if (part.startsWith ("seg:")) return idr (pageIds, "eng:" + part.substring (4));
    if (part.startsWith ("slot:")) return idr (tk, "slot:" + part.substring (5));
    if (part.startsWith ("rate:")) return idr (tk, part);
    if (part.startsWith ("dir:")) return idr (tk, part);
    if (part.startsWith ("shape:")) return idr (tk, part);
    if (part.startsWith ("bar:")) return idr (tk, part);
    if (part.startsWith ("tog:")) return idr (tk, part);
    if (part.startsWith ("fader:")) return idr (pageIds, "fwell:" + part.substring (6));
    if (part == "pick") return idr (pageIds, "prismPickBtn");
    if (part.startsWith ("pickItem:") && pick != nullptr)
        for (const auto& it : pick->items)
            if (it.kind == part.substring (9))
                return it.r + pick->getPosition().toFloat();
    if (part.startsWith ("limit:")) return limitBox (part.substring (6));
    if (part.startsWith ("pbar:")) return idr (pageIds, "pb:" + part.substring (5));
    if (part == "rec") return idr (pageIds, "hsRec");
    if (part == "play") return idr (pageIds, "hsPlay");
    if (part == "pause") return idr (pageIds, "hsPause");
    if (part == "stop") return idr (pageIds, "hsStop");
    if (part == "rewind") return idr (pageIds, "hsRewind");
    if (part.startsWith ("lfoShape:")) return idr (pageIds, "lshape:" + part.substring (9)) + juce::Point<float> (0, lfoDy);
    if (part.startsWith ("lfoTab:")) return idr (pageIds, "tab:" + part.substring (7)) + juce::Point<float> (0, lfoDy);
    if (part == "lfoMap") return idr (pageIds, "prismLfoMap") + juce::Point<float> (0, lfoDy);
    if (part == "nowPlay") return idr (nowIds, "playBtn");
    if (part == "nowLoop") return idr (nowIds, "loopBtn");
    if (part == "src") return idr (pageIds, "prismSrc");
    if (part == "x") return idr (pageIds, "dd:prismX");
    if (part == "chainAdd") return idr (pageIds, "dd:prismChainAdd");
    return {};
}

std::vector<std::pair<juce::String, double>> PrismFace::profile (float scale)
{
    std::vector<std::pair<juce::String, double>> out;
    for (auto& l : layers)
    {
        juce::Image im (juce::Image::ARGB, juce::jmax (1, (int) ((float) l->getWidth() * scale)), juce::jmax (1, (int) ((float) l->getHeight() * scale)), true);
        juce::Graphics g (im);
        g.addTransform (juce::AffineTransform::scale (scale));
        const auto t0 = juce::Time::getMillisecondCounterHiRes();
        l->paint (g);
        out.push_back ({ l->name, juce::Time::getMillisecondCounterHiRes() - t0 });
    }
    return out;
}

// ─────────────────────────────────────────────────────────────── gestures

int PrismFace::cellAt (juce::Point<float> p, bool lfo) const
{
    const auto& v = lfo ? lfoCells : cells;
    for (int k = 0; k < (int) v.size(); ++k)
        if (v[(size_t) k].r.contains (p))
            return k;
    return -1;
}

void PrismFace::setKnob (const Cell& c, double v, bool commit)
{
    auto o = obj();
    if (c.lfo)
    {
        put (o, "op", c.field);
        put (o, "v", v);
        prism ("lfo", o);
    }
    else
    {
        put (o, "key", c.s.key);
        put (o, "v", v);
        if (commit)
            put (o, "commit", true);
        prism ("setting", o);
    }
    refresh (false);
}

juce::String PrismFace::barAt (juce::Point<float> p) const
{
    const bool tp = source == "stretch" || source.isEmpty();
    const auto& tk = tp ? pageIds : echoIds;
    for (const char* k : { "smoothing", "pbSpeed", "postRoll" })
    {
        if (!tp && juce::String (k) == "smoothing")
            continue;
        auto it = tk.find ("bar:" + juce::String (k));
        if (it != tk.end() && it->second.r.contains (p))
            return k;
    }
    return {};
}

void PrismFace::setBar (const juce::String& key, double v, bool commit)
{
    auto o = obj();
    if (key == "smoothing")
    {
        put (o, "op", "glide");
        put (o, "v", v);
        prism ("padop", o);
    }
    else if (key == "pbSpeed")
    {
        put (o, "key", "speed");
        put (o, "v", v);
        prism ("fader", o);
    }
    else if (key == "postRoll" && commit)
    {
        put (o, "v", v);
        prism ("postRoll", o);
    }
    refresh (false);
}

void PrismFace::mouseMove (const juce::MouseEvent& e)
{
    if (padBox().contains (e.position) && grab == Grab::none)
    {
        const auto f = padFrac (e.position);
        auto o = obj();
        put (o, "op", "move");
        put (o, "x", f.x);
        put (o, "y", f.y);
        put (o, "t", now());
        put (o, "shift", e.mods.isShiftDown());
        prism ("padop", o);
        refresh (false);
    }
    else if ((bool) pad["hover"].isArray() && grab == Grab::none)
        mouseExit (e);
}

void PrismFace::mouseExit (const juce::MouseEvent&)
{
    if (pad["hover"].isArray() && !(bool) pad["down"])
    {
        auto o = obj();
        put (o, "op", "leave");
        prism ("padop", o);
        refresh (false);
    }
}

void PrismFace::mouseDown (const juce::MouseEvent& e)
{
    if (blocked && blocked (e))
        return;
    if (limitEdit != nullptr)
    {
        typeLimit (limitField, limitEdit->getText());
        return;
    }
    grabKeyboardFocus();
    padHasFocus = false;
    const auto p = e.position;
    auto in = [&] (const Ids& m, const juce::String& k) {
        auto it = m.find (k);
        return it != m.end() && it->second.r.contains (p);
    };
    auto padop = [&] (const juce::String& op, juce::var o = {}) {
        if (!o.isObject())
            o = obj();
        put (o, "op", op);
        put (o, "t", now());
        prism ("padop", o);
        refresh (false);
    };
    auto deckOp = [&] (const juce::String& op, double u = -1) {
        auto o = obj();
        put (o, "op", op);
        if (u >= 0)
            put (o, "u", u);
        prism ("deck", o);
        refresh (false);
    };
    if (e.mods.isPopupMenu())
        return;

    // ── the Now Playing bar: Prism's transport on its page ──
    if (in (nowIds, "playBtn")) return deckOp ("play");
    if (in (nowIds, "stopBtn")) return deckOp ("stop");
    if (in (nowIds, "loopBtn")) return deckOp ("loop");
    if (in (nowIds, "recBtn")) return say ("Capturing what plays is the app's recorder's: cable Prism into one");
    if (in (nowIds, "nbStrip"))
    {
        const auto r = nowIds["nbStrip"].r;
        grab = Grab::seek;
        grabKey = "nbStrip";
        return deckOp ("seek", juce::jlimit (0.0, 1.0, (double) (p.x - r.getX()) / r.getWidth()));
    }
    // ── SOURCE and the mini overview: click or drag to go there ──
    for (const auto& [k, box] : { std::pair<juce::String, juce::Rectangle<float>> { "prismSrc", pageIds["prismSrc"].r }, { "mini", miniBox } })
        if (box.contains (p))
        {
            grab = Grab::seek;
            grabKey = k;
            return deckOp ("seek", juce::jlimit (0.0, 1.0, (double) (p.x - box.getX()) / box.getWidth()));
        }
    if (in (pageIds, "prismEdit"))
        return say ("On the canvas the Sound module is the file: edit Prism's sound in an Edit module cabled to it");
    // ── the head row ──
    if (in (pageIds, "prismPickBtn")) return openPick();
    if (in (pageIds, "dd:prismX")) return axisMenu ("x");
    if (in (pageIds, "dd:prismY")) return axisMenu ("y");
    for (const auto& [k, op] : { std::pair<const char*, const char*> { "hsRec", "rec" }, { "hsPlay", "play" }, { "hsPause", "pause" }, { "hsStop", "stop" }, { "hsRewind", "rewind" } })
        if (in (pageIds, k))
            return padop (op);
    if (in (pageIds, "pb:prev")) return presetStep (-1);
    if (in (pageIds, "pb:next")) return presetStep (1);
    if (in (pageIds, "pb:open")) return presetMenu();
    if (in (pageIds, "pb:save")) return presetSave (false);
    if (in (pageIds, "pb:more"))
    {
        juce::PopupMenu m;
        const auto at = presetList["at"].toString();
        const bool mine = at.startsWith ("u");
        m.addItem (1, "Save as" + uni ("\xe2\x80\xa6"));
        m.addItem (2, "Rename" + uni ("\xe2\x80\xa6"), mine);
        m.addItem (3, "Init: the process's Default Settings");
        m.addItem (4, "Delete", mine);
        m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (this).withTargetScreenArea (localAreaToGlobal (pageIds["pb:more"].r.toNearestInt())), [this] (int r) {
            const auto name = presetList["label"].toString();
            if (r == 1)
                presetSave (true);
            else if (r == 3)
            {
                auto o = obj();
                put (o, "op", "init");
                presetList = prism ("presets", o);
                prism ("view");
                refresh (true);
            }
            else if (r == 4)
            {
                auto o = obj();
                put (o, "op", "delete");
                put (o, "name", name);
                presetList = prism ("presets", o);
                refresh (true);
            }
            else if (r == 2)
            {
                auto* w = new juce::AlertWindow ("Rename the preset", {}, juce::MessageBoxIconType::NoIcon);
                w->addTextEditor ("name", name);
                w->addButton ("Rename", 1);
                w->addButton ("Cancel", 0);
                w->enterModalState (true, juce::ModalCallbackFunction::create ([this, w, name] (int ok) {
                    const auto to = w->getTextEditorContents ("name").trim();
                    if (ok == 1 && to.isNotEmpty())
                    {
                        auto o = obj();
                        put (o, "op", "rename");
                        put (o, "from", name);
                        put (o, "to", to);
                        presetList = prism ("presets", o);
                        refresh (true);
                    }
                }), true);
            }
        });
        return;
    }
    // ── the Sound row ──
    if (in (pageIds, "dd:prismSoundFolder")) return soundMenu (true);
    if (in (pageIds, "dd:prismSoundFile")) return soundMenu (false);
    for (const auto& [sid, r] : chainX)
        if (r.contains (p))
        {
            auto o = obj();
            put (o, "id", sid);
            prism ("chainRemove", o);
            fx = fx.isObject() ? fx : prism ("fx");
            refresh (true);
            return;
        }
    if (in (pageIds, "dd:prismChainAdd")) return chainMenu();
    // ── the pad's head: the engine ──
    for (const auto& eng : engines)
        if (in (pageIds, "eng:" + juce::String (eng[0])))
        {
            auto o = obj();
            put (o, "v", eng[0]);
            prism ("engine", o);
            refresh (false);
            return;
        }
    // ── the pad: its corners' limits, then the pad itself ──
    for (const char* f : { "yHi", "yLo", "xLo", "xHi" })
        if (limitBox (f).contains (p))
            return editLimit (f);
    if (padBox().contains (p))
    {
        padHasFocus = true;
        grab = Grab::pad;
        const auto fr = padFrac (p);
        auto o = obj();
        put (o, "x", fr.x);
        put (o, "y", fr.y);
        return padop ("down", o);
    }
    // ── Controls ──
    if (const int k = cellAt (p, false); k >= 0)
    {
        const auto& c = cells[(size_t) k];
        if ((bool) lfos["mapping"])
        {
            // Mapping an LFO: a click on a control maps it rather than moving it.
            auto o = obj();
            put (o, "op", "toggle");
            put (o, "src", c.src);
            put (o, "key", c.s.key);
            prism ("lfo", o);
            refresh (false);
            return;
        }
        if (c.knob.expanded (2).contains (p) || c.pic.contains (p))
        {
            grab = Grab::knob;
            grabCell = k;
            grabLfo = false;
            grabKey = c.s.key;
            grabV = valueOf (c.s.key);
            grabU = toU (c.s, grabV);
            grabY = p.y;
            refresh (false);
        }
        return;
    }
    if (source == "ptc")
    {
        const auto& b = look["ptcOn"];
        if (b.isObject() && (rectOf (b["rect"]) + juce::Point<float> ((float) dnum (captured["ptc"]["at"][0]), (float) dnum (captured["ptc"]["at"][1]))).contains (p))
        {
            prism ("ptc", obj());
            refresh (false);
            return;
        }
    }
    // ── the LFOs ──
    const juce::Point<float> dy (0, lfoDy);
    if (pageIds.count ("prismLfoMap") && (pageIds["prismLfoMap"].r + dy).contains (p))
    {
        auto o = obj();
        put (o, "op", "map");
        prism ("lfo", o);
        refresh (false);
        return;
    }
    for (int t = 0; t < 4; ++t)
        if (pageIds.count ("tab:" + juce::String (t)) && (pageIds["tab:" + juce::String (t)].r + dy).contains (p))
        {
            auto o = obj();
            put (o, "op", "sel");
            put (o, "i", t);
            prism ("lfo", o);
            refresh (false);
            return;
        }
    for (const char* s : { "sine", "triangle", "square", "saw", "random", "pulse" })
        if (pageIds.count ("lshape:" + juce::String (s)) && (pageIds["lshape:" + juce::String (s)].r + dy).contains (p))
        {
            auto o = obj();
            put (o, "op", "shape");
            put (o, "v", s);
            prism ("lfo", o);
            refresh (false);
            return;
        }
    for (const auto& [k, r] : chainX)
        juce::ignoreUnused (k, r);
    if (const int k = cellAt (p, true); k >= 0)
    {
        const auto& c = lfoCells[(size_t) k];
        if (c.knob.expanded (2).contains (p) || c.pic.contains (p))
        {
            grab = Grab::knob;
            grabCell = k;
            grabLfo = true;
            grabKey = c.s.key;
            grabV = dnum (lfos["lfos"][(int) dnum (lfos["sel"])][juce::Identifier (c.field)]);
            grabU = toU (c.s, grabV);
            grabY = p.y;
        }
        return;
    }
    // A chip's ×: unmap.
    {
        const auto L = lfos["lfos"][(int) dnum (lfos["sel"])];
        const auto& chip = look["chip"];
        if (chip.isObject() && L["targets"].size() > 0)
        {
            const auto* x = findIn (chip, [] (const juce::var& n) { return n["tag"].toString() == "button"; });
            const auto cr = rectOf (chip["rect"]);
            float cx = cr.getX();
            const float y0 = cr.getY() + lfoDy - (rectOf (look["lfoPanel"]["rect"]).getY() - 324);
            juce::ignoreUnused (y0);
            const auto font = (chip["text"].size() > 0 ? face::font (chip["text"][0]["font"]) : face::sans (11));
            const float pad0 = cr.getWidth() - juce::GlyphArrangement::getStringWidth (font, firstText (chip));
            for (int t = 0; t < L["targets"].size(); ++t)
            {
                juce::String label = L["targets"][t]["key"].toString();
                for (const auto& s : sources)
                    if (s["id"].toString() == L["targets"][t]["src"].toString())
                        if (auto* cs = s["controls"].getArray())
                            for (const auto& c : *cs)
                                if (c["key"].toString() == label)
                                    label = c["label"].toString() + (s["id"].toString() == source ? juce::String() : uni (" \xc2\xb7 ") + s["label"].toString());
                const float w = juce::GlyphArrangement::getStringWidth (font, label) + pad0;
                const auto rr = juce::Rectangle<float> (cx, cr.getY() + lfoDy, w, cr.getHeight());
                if (x != nullptr && rr.withLeft (rr.getRight() - rectOf ((*x)["rect"]).getWidth() - 2).contains (p))
                {
                    auto o = obj();
                    put (o, "op", "unmap");
                    put (o, "k", t);
                    prism ("lfo", o);
                    refresh (false);
                    return;
                }
                cx += w + 4;
            }
        }
    }
    // ── Takes ──
    {
        const bool tp = source == "stretch" || source.isEmpty();
        const auto& tk = tp ? pageIds : echoIds;
        for (int s = 0; s < 4; ++s)
            if (in (tk, "slot:" + juce::String (s)))
            {
                auto o = obj();
                put (o, "i", s);
                return padop ("slot", o);
            }
        for (const char* r : { "0.5", "1", "2" })
            if (in (tk, "rate:" + juce::String (r)))
            {
                auto o = obj();
                put (o, "v", juce::String (r).getDoubleValue());
                return padop ("rate", o);
            }
        for (const char* d : { "fwd", "rev", "pp" })
            if (in (tk, "dir:" + juce::String (d)))
            {
                auto o = obj();
                put (o, "v", d);
                return padop ("dir", o);
            }
        for (const char* s : { "circle", "eight", "liss", "drift" })
            if (in (tk, "shape:" + juce::String (s)))
            {
                auto o = obj();
                put (o, "v", s);
                return padop ("shape", o);
            }
        if (in (tk, "tog:0"))
        {
            auto o = obj();
            put (o, "v", !(bool) pad["throwOn"]);
            return padop ("throw", o);
        }
        if (in (tk, "tog:1"))
        {
            auto o = obj();
            put (o, "v", !(bool) pad["loopOnRelease"]);
            return padop ("loopRelease", o);
        }
        const auto b = barAt (p);
        if (b.isNotEmpty())
        {
            // A click sets it, a drag follows, Shift is ten times finer.
            const auto& bn = tk.at ("bar:" + b);
            const auto* bw = findIn (bn.n, [] (const juce::var& n) { return hasClass (n, "ui-bw"); });
            const auto wr = bw != nullptr ? rectOf ((*bw)["rect"]) + (bn.r.getPosition() - rectOf (bn.n["rect"]).getPosition()) : bn.r;
            grab = Grab::bar;
            grabKey = b;
            const double mx = b == "smoothing" ? 100 : b == "pbSpeed" ? 255 : 10000;
            const double cur = b == "smoothing" ? dnum (pad["glide"]) : b == "pbSpeed" ? dnum (view["hp"]["speed"]) : dnum (view["postRoll"]);
            grabU = cur / mx;
            grabX = p.x;
            if (!wr.contains (p))
            {
                // The picture: its double-click resets; a press alone does nothing.
                grab = Grab::none;
                return;
            }
            if (!e.mods.isShiftDown())
                grabU = juce::jlimit (0.0, 1.0, (double) (p.x - wr.getX() - 4) / juce::jmax (1.0f, wr.getWidth() - 8));
            const double step = b == "postRoll" ? 10 : 1;
            grabV = jsRound (grabU * mx / step) * step;
            setBar (b, grabV, false);
            return;
        }
    }
    // ── Output: the faders, their names ──
    for (const auto& [k, key] : { std::pair<const char*, const char*> { "l", "l" }, { "lr", "lr" }, { "r", "r" } })
    {
        const auto fid = "prismFaderZero" + juce::String (k).toUpperCase();
        if (in (pageIds, fid))
        {
            auto o = obj();
            put (o, "key", key);
            put (o, "v", 128);
            prism ("fader", o);
            refresh (false);
            return;
        }
        if (in (pageIds, "fwell:" + juce::String (k)))
        {
            grab = Grab::fader;
            grabKey = key;
            mouseDrag (e);
            return;
        }
    }
}

void PrismFace::mouseDrag (const juce::MouseEvent& e)
{
    const auto p = e.position;
    if (grab == Grab::pad)
    {
        const auto f = padFrac (p);
        auto o = obj();
        put (o, "op", "move");
        put (o, "x", f.x);
        put (o, "y", f.y);
        put (o, "t", now());
        put (o, "shift", e.mods.isShiftDown());
        prism ("padop", o);
        refresh (false);
    }
    else if (grab == Grab::knob)
    {
        // Up or down, 160 px for the whole sweep, Shift five times finer.
        const auto& c = grabLfo ? lfoCells[(size_t) grabCell] : cells[(size_t) grabCell];
        grabU = juce::jlimit (0.0, 1.0, grabU + (grabY - p.y) / (e.mods.isShiftDown() ? 160.0 * 5 : 160.0));
        grabY = p.y;
        const double v = fromU (c.s, grabU);
        grabV = v;
        setKnob (Cell (c), v, false);
    }
    else if (grab == Grab::bar)
    {
        const bool tp = source == "stretch" || source.isEmpty();
        const auto& tk = tp ? pageIds : echoIds;
        const auto& bn = tk.at ("bar:" + grabKey);
        const auto* bw = findIn (bn.n, [] (const juce::var& n) { return hasClass (n, "ui-bw"); });
        const auto wr = bw != nullptr ? rectOf ((*bw)["rect"]) + (bn.r.getPosition() - rectOf (bn.n["rect"]).getPosition()) : bn.r;
        const float W = juce::jmax (1.0f, wr.getWidth() - 8);
        grabU = e.mods.isShiftDown() ? juce::jlimit (0.0, 1.0, grabU + (p.x - grabX) / W * 0.1) : juce::jlimit (0.0, 1.0, (double) (p.x - wr.getX() - 4) / W);
        grabX = p.x;
        const double mx = grabKey == "smoothing" ? 100 : grabKey == "pbSpeed" ? 255 : 10000;
        const double step = grabKey == "postRoll" ? 10 : 1;
        grabV = jsRound (grabU * mx / step) * step;
        setBar (grabKey, grabV, false);
    }
    else if (grab == Grab::fader)
    {
        const auto r = pageIds["fwell:" + grabKey].r;
        const double v = jsRound (juce::jlimit (0.0, 1.0, 1.0 - (double) (p.y - r.getY()) / r.getHeight()) * 255);
        auto o = obj();
        put (o, "key", grabKey);
        put (o, "v", v);
        prism ("fader", o);
        refresh (false);
    }
    else if (grab == Grab::seek)
    {
        const auto box = grabKey == "mini" ? miniBox : grabKey == "nbStrip" ? nowIds["nbStrip"].r : pageIds["prismSrc"].r;
        auto o = obj();
        put (o, "op", "seek");
        put (o, "u", juce::jlimit (0.0, 1.0, (double) (p.x - box.getX()) / box.getWidth()));
        prism ("deck", o);
        refresh (false);
    }
}

void PrismFace::mouseUp (const juce::MouseEvent&)
{
    const auto was = grab;
    grab = Grab::none;
    if (was == Grab::pad)
    {
        auto o = obj();
        put (o, "op", "up");
        put (o, "t", now());
        prism ("padop", o);
    }
    else if (was == Grab::knob && grabCell >= 0)
    {
        const auto& c = grabLfo ? lfoCells[(size_t) grabCell] : cells[(size_t) grabCell];
        if (!grabLfo)
            setKnob (Cell (c), grabV, true);
    }
    else if (was == Grab::bar)
        setBar (grabKey, grabV, true);
    grabCell = -1;
    refresh (false);
}

void PrismFace::mouseDoubleClick (const juce::MouseEvent& e)
{
    const auto p = e.position;
    if (padBox().contains (p) && limitEdit == nullptr)
    {
        // Double-click centres the point.
        auto o = obj();
        put (o, "op", "centre");
        put (o, "t", now());
        prism ("padop", o);
        refresh (false);
        return;
    }
    for (bool lfo : { false, true })
        if (const int k = cellAt (p, lfo); k >= 0)
        {
            const auto c = (lfo ? lfoCells : cells)[(size_t) k];
            if (c.s.hasDef && !(bool) lfos["mapping"])
                setKnob (c, c.s.def, true);
            return;
        }
    const auto b = barAt (p);
    if (b.isNotEmpty())
    {
        setBar (b, b == "smoothing" ? 50 : b == "pbSpeed" ? 128 : 0, true);
        return;
    }
    for (const char* k : { "l", "lr", "r" })
        if (pageIds.count ("fwell:" + juce::String (k)) && pageIds["fwell:" + juce::String (k)].r.contains (p))
        {
            auto o = obj();
            put (o, "key", k);
            put (o, "v", 128);
            prism ("fader", o);
            refresh (false);
            return;
        }
}

void PrismFace::mouseWheelMove (const juce::MouseEvent& e, const juce::MouseWheelDetails& w)
{
    for (bool lfo : { false, true })
        if (const int k = cellAt (e.position, lfo); k >= 0)
        {
            const auto c = (lfo ? lfoCells : cells)[(size_t) k];
            if (!c.knob.expanded (2).contains (e.position))
                return;
            const double base = lfo ? dnum (lfos["lfos"][(int) dnum (lfos["sel"])][juce::Identifier (c.field)]) : valueOf (c.s.key);
            const double dir = w.deltaY > 0 ? 1 : w.deltaY < 0 ? -1 : 0;
            const double u = juce::jlimit (0.0, 1.0, toU (c.s, base) + dir * 0.03 * (e.mods.isShiftDown() ? 0.2 : 1));
            setKnob (c, fromU (c.s, u), true);
            return;
        }
}

bool PrismFace::keyPressed (const juce::KeyPress& k)
{
    if (k == juce::KeyPress::escapeKey)
    {
        if (pickOpen())
        {
            pick->setVisible (false);
            return true;
        }
        if ((bool) lfos["mapping"])
        {
            auto o = obj();
            put (o, "op", "stopMap");
            prism ("lfo", o);
            refresh (false);
            return true;
        }
        return false;
    }
    if (padHasFocus)
    {
        int dx = 0, dy = 0;
        if (k.getKeyCode() == juce::KeyPress::leftKey) dx = -1;
        else if (k.getKeyCode() == juce::KeyPress::rightKey) dx = 1;
        else if (k.getKeyCode() == juce::KeyPress::upKey) dy = -1;
        else if (k.getKeyCode() == juce::KeyPress::downKey) dy = 1;
        if (dx != 0 || dy != 0)
        {
            auto o = obj();
            put (o, "op", "nudge");
            put (o, "dx", dx);
            put (o, "dy", dy);
            put (o, "alt", k.getModifiers().isAltDown());
            put (o, "t", now());
            prism ("padop", o);
            refresh (false);
            return true;
        }
    }
    return false;
}

// ─────────────────────────────────────────────────────────────── menus

void PrismFace::openPick()
{
    if (pickOpen())
    {
        pick->setVisible (false);
        return;
    }
    // prismProcesses: Time & Pitch, the Pitch Time Changer, every Hyperprism
    // process, and anything else already in Prism's chain.
    struct Proc { juce::String sid, kind, label, cat; };
    std::vector<Proc> all { { "stretch", "stretch", "Time & Pitch", "time" }, { "ptc", "ptc", "Pitch Time Changer", "time" } };
    auto slotOf = [this] (const juce::String& kind) {
        juce::String found;
        if (auto* ch = view["chain"].getArray())
            for (const auto& c : *ch)
                if (c["kind"].toString() == kind && found.isEmpty())
                    found = c["id"].toString();
        return found;
    };
    if (auto* shs = fx["shapers"].getArray())
        for (const auto& s : *shs)
        {
            const auto kind = s["kind"].toString();
            if (!kind.startsWith ("prism:hp-"))
                continue;
            const auto cat = s["category"].toString();
            all.push_back ({ slotOf (kind), kind, s["label"].toString().replace ("Hyperprism ", "").trimStart(), cat.isEmpty() ? juce::String ("chain") : cat });
        }
    if (auto* ch = view["chain"].getArray())
        for (const auto& c : *ch)
        {
            const auto kind = c["kind"].toString();
            if (kind.startsWith ("prism:hp-"))
                continue;
            juce::String label;
            for (const auto& s : sources)
                if (s["id"] == c["id"])
                    label = s["label"].toString();
            if (label.isEmpty())
                label = c["label"].toString().isNotEmpty() ? c["label"].toString() : kind;
            all.push_back ({ c["id"].toString(), kind, label, "chain" });
        }
    static const std::map<juce::String, juce::String> groupNames { { "time", "Time" }, { "filter", "Filters" }, { "delay", "Delays" }, { "reverb", "Reverbs" }, { "modulation", "Modulation" },
                                                                  { "pitch", "Pitch" }, { "stereo", "Stereo" }, { "dynamics", "Dynamics" }, { "distortion", "Distortion" }, { "chain", "Also in the chain" } };
    static const std::vector<std::vector<const char*>> columns { { "time", "reverb", "pitch", "distortion" }, { "filter", "dynamics" }, { "delay", "chain" }, { "modulation" }, { "stereo" } };
    pick->items.clear();
    pick->heads.clear();
    // The page's grid: five columns of 152 with 8 between, 6 / 8 inside; a
    // group's name 13 tall, its items 20, 4 under each group.
    float tallest = 0;
    for (size_t col = 0; col < columns.size(); ++col)
    {
        float y = 7;
        const float x = 9 + (152 + 8) * (float) col;
        for (const char* cat : columns[col])
        {
            bool any = false;
            for (const auto& p : all)
                any = any || p.cat == cat;
            if (!any)
                continue;
            pick->heads.push_back ({ groupNames.count (cat) ? groupNames.at (cat) : juce::String (cat), { x, y, 152, 13 } });
            y += 13;
            for (const auto& p : all)
                if (p.cat == cat)
                {
                    pick->items.push_back ({ p.kind, p.sid, p.label, { x, y, 152, 20 }, p.sid.isNotEmpty() && p.sid == source });
                    y += 20;
                }
            y += 4;
        }
        tallest = std::max (tallest, y);
    }
    const auto btn = pageIds["prismPickBtn"].r;
    const float w = 5 * 152 + 4 * 8 + 16 + 2, h = tallest + 6 + 1;
    pick->setBounds (juce::Rectangle<float> (btn.getX(), btn.getBottom() + 3, w, h).getSmallestIntegerContainer());
    pick->setVisible (true);
    pick->toFront (true);
    pick->grabKeyboardFocus();
}

void PrismFace::chosen (const juce::String& kind, const juce::String& sid)
{
    // On the pad if it is there, added to the chain if not.
    auto o = obj();
    put (o, "kind", kind);
    put (o, "id", sid);
    put (o, "t", now());
    prism ("pick", o);
    loadPresets();
    refresh (true);
}

void PrismFace::axisMenu (const juce::String& axis)
{
    const auto* src = currentSource();
    if (src == nullptr)
        return;
    juce::PopupMenu m;
    juce::StringArray keys;
    const auto cur = setup[juce::Identifier (axis)].toString();
    if (auto* cs = (*src)["controls"].getArray())
        for (const auto& c : *cs)
        {
            keys.add (c["key"].toString());
            m.addItem (keys.size(), c["label"].toString(), true, c["key"].toString() == cur);
        }
    m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (this).withTargetScreenArea (localAreaToGlobal (pageIds["dd:prism" + axis.toUpperCase()].r.toNearestInt())), [this, keys, axis] (int r) {
        if (r <= 0)
            return;
        auto o = obj();
        put (o, "axis", axis);
        put (o, "key", keys[r - 1]);
        prism ("axis", o);
        refresh (true);
    });
}

void PrismFace::chainMenu()
{
    // + add effect: the suites' listed modes, as fxPickerCatalogue files them.
    juce::PopupMenu m;
    juce::StringArray kinds;
    if (auto* ss = fx["suites"].getArray())
        for (const auto& s : *ss)
        {
            if (!(bool) s["offered"])
                continue;
            juce::PopupMenu sub;
            if (auto* fams = s["families"].getArray())
                for (const auto& f : *fams)
                {
                    bool header = false;
                    if (auto* modes = f["modes"].getArray())
                        for (const auto& md : *modes)
                        {
                            if (!(bool) md["listed"])
                                continue;
                            if (!header && fams->size() > 1)
                            {
                                sub.addSectionHeader (f["label"].toString());
                                header = true;
                            }
                            kinds.add (md["kind"].toString());
                            sub.addItem (kinds.size(), md["label"].toString().isNotEmpty() ? md["label"].toString() : md["kind"].toString());
                        }
                }
            if (sub.getNumItems() > 0)
                m.addSubMenu (s["label"].toString(), sub);
        }
    m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (this).withTargetScreenArea (localAreaToGlobal (pageIds["dd:prismChainAdd"].r.toNearestInt())), [this, kinds] (int r) {
        if (r <= 0)
            return;
        auto o = obj();
        put (o, "kind", kinds[r - 1]);
        prism ("chainAdd", o);
        refresh (true);
    });
}

void PrismFace::soundMenu (bool folder)
{
    juce::ignoreUnused (folder);
    say ("On the canvas the Sound module chooses Prism's sound: open a file in a Sound module and cable it into Prism's Sound socket");
}

void PrismFace::presetMenu()
{
    loadPresets();
    juce::PopupMenu m;
    juce::StringArray ats;
    const auto at = presetList["at"].toString();
    int n = 0;
    if (auto* fs = presetList["factory"].getArray())
        for (int k = 0; k < fs->size(); ++k)
        {
            ats.add ("f" + juce::String (k));
            ++n;
            m.addItem (n, (*fs)[k]["name"].toString() + "  (Factory)", true, at == ats[n - 1]);
        }
    if (auto* us = presetList["user"].getArray())
        for (int k = 0; k < us->size(); ++k)
        {
            ats.add ("u" + juce::String (k));
            ++n;
            m.addItem (n, (*us)[k]["name"].toString(), true, at == ats[n - 1]);
        }
    if (n == 0)
        m.addItem (-1, "No presets yet for this process", false);
    m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (this).withTargetScreenArea (localAreaToGlobal (pageIds["pb:open"].r.toNearestInt())), [this, ats] (int r) {
        if (r <= 0)
            return;
        auto o = obj();
        put (o, "op", "apply");
        put (o, "at", ats[r - 1]);
        presetList = prism ("presets", o);
        prism ("view");
        refresh (true);
    });
}

void PrismFace::presetStep (int by)
{
    loadPresets();
    juce::StringArray ats;
    if (auto* fs = presetList["factory"].getArray())
        for (int k = 0; k < fs->size(); ++k)
            ats.add ("f" + juce::String (k));
    if (auto* us = presetList["user"].getArray())
        for (int k = 0; k < us->size(); ++k)
            ats.add ("u" + juce::String (k));
    if (ats.isEmpty())
        return say ("No presets yet for this process");
    const int i = ats.indexOf (presetList["at"].toString());
    const int to = i < 0 ? (by > 0 ? 0 : ats.size() - 1) : (i + by + ats.size()) % ats.size();
    auto o = obj();
    put (o, "op", "apply");
    put (o, "at", ats[to]);
    presetList = prism ("presets", o);
    prism ("view");
    refresh (true);
}

void PrismFace::presetSave (bool asNew)
{
    auto store = [this] (const juce::String& name) {
        auto o = obj();
        put (o, "op", "save");
        put (o, "name", name);
        const auto r = prism ("presets", o);
        if (r.isObject())
        {
            presetList = r;
            say ("Saved " + uni ("\xe2\x80\x9c") + name + uni ("\xe2\x80\x9d"));
        }
        refresh (true);
    };
    const auto at = presetList["at"].toString();
    if (!asNew && at.startsWith ("u"))
        return store (presetList["label"].toString());
    auto* w = new juce::AlertWindow ("Save these settings as", {}, juce::MessageBoxIconType::NoIcon);
    w->addTextEditor ("name", at.startsWith ("u") ? presetList["label"].toString() : juce::String ("Preset 1"));
    w->addButton ("Save", 1);
    w->addButton ("Cancel", 0);
    w->enterModalState (true, juce::ModalCallbackFunction::create ([w, store] (int ok) {
        if (ok == 1 && w->getTextEditorContents ("name").trim().isNotEmpty())
            store (w->getTextEditorContents ("name").trim());
    }), true);
}

// ─────────────────────────────────────────────────── the corners' limits

juce::String PrismFace::limitText (const juce::String& field) const
{
    // String(+(+n).toPrecision(6)), as prismRenderBar shows a limit.
    const double v = dnum (setup[juce::Identifier (field)]);
    char b[64];
    std::snprintf (b, sizeof b, "%.6g", v);
    const double r = juce::String (b).getDoubleValue();
    if (r == std::floor (r) && std::abs (r) < 1e15)
        return juce::String ((int64_t) r);
    auto s = juce::String (r, 10).trimCharactersAtEnd ("0");
    return s.endsWithChar ('.') ? s.dropLastCharacters (1) : s;
}

juce::Rectangle<float> PrismFace::limitBox (const juce::String& field, juce::Rectangle<float>* unit) const
{
    // The field sizes to what it holds (field-sizing: content), its unit after.
    const auto box = padBox();
    const auto* in = findIn (captured["page"]["tree"], [] (const juce::var& n) { return n["id"].toString() == "prismYHi"; });
    const auto font = in != nullptr ? face::font ((*in)["font"]) : face::mono (11, 500);
    const float w = std::max (12.0f, juce::GlyphArrangement::getStringWidth (font, limitText (field))) + 6;
    const auto* srcCtl = control (field.startsWith ("x") ? setup["x"].toString() : setup["y"].toString());
    juce::String u;
    if (srcCtl != nullptr)
        u = (*srcCtl)["key"].toString() == "ratio" ? uni ("\xc3\x97") : (*srcCtl)["key"].toString() == "semitones" ? juce::String ("st") : (*srcCtl)["unit"].toString();
    const float uw = juce::GlyphArrangement::getStringWidth (font, u);
    float x = 0, y = 0;
    if (field == "yHi") { x = box.getX() + 6; y = box.getY() + 5; }
    else if (field == "yLo") { x = box.getX() + 6; y = box.getBottom() - 25; }
    else if (field == "xLo") { x = box.getX() + 76; y = box.getBottom() - 25; }
    else { x = box.getRight() - 6 - (w + 1 + uw); y = box.getBottom() - 25; }
    if (unit != nullptr)
        *unit = { x + w + 1, y, uw, 20 };
    return { x, y, w, 20 };
}

void PrismFace::editLimit (const juce::String& field)
{
    limitField = field;
    limitEdit = std::make_unique<juce::TextEditor>();
    limitEdit->setFont (face::mono (11, 500));
    limitEdit->setText (limitText (field), false);
    limitEdit->setColour (juce::TextEditor::backgroundColourId, juce::Colours::black.withAlpha (0.5f));
    limitEdit->setColour (juce::TextEditor::textColourId, cl ("--look-text", "#e8eaee"));
    limitEdit->setColour (juce::TextEditor::outlineColourId, cl ("--look-line", "#2c3036"));
    limitEdit->setIndents (2, 3);
    limitEdit->setBounds (limitBox (field).withWidth (90).getSmallestIntegerContainer());
    limitEdit->onReturnKey = [this] { typeLimit (limitField, limitEdit->getText()); };
    limitEdit->onEscapeKey = [this] {
        juce::MessageManager::callAsync ([sp = juce::Component::SafePointer<PrismFace> (this)] {
            if (sp != nullptr)
                sp->limitEdit.reset();
        });
    };
    limitEdit->onFocusLost = [this] { typeLimit (limitField, limitEdit->getText()); };
    addAndMakeVisible (*limitEdit);
    limitEdit->selectAll();
    limitEdit->grabKeyboardFocus();
    refresh (false);
}

void PrismFace::typeLimit (const juce::String& field, const juce::String& text)
{
    auto o = obj();
    put (o, "field", field);
    put (o, "v", text.trim().getDoubleValue());
    if (text.trim().containsOnly ("0123456789.-+eE") && text.trim().isNotEmpty())
        prism ("limit", o);
    if (limitEdit != nullptr)
        juce::MessageManager::callAsync ([sp = juce::Component::SafePointer<PrismFace> (this)] {
            if (sp != nullptr)
            {
                sp->limitEdit.reset();
                sp->refresh (true);
            }
        });
    refresh (true);
}

bool PrismFace::pickOpen() const
{
    return pick != nullptr && pick->isVisible();
}

void PrismFace::pickAt (juce::Point<float> p)
{
    if (!pickOpen())
        return;
    auto src = juce::Desktop::getInstance().getMainMouseSource();
    const auto lp = p - pick->getPosition().toFloat();
    const auto t = juce::Time::getCurrentTime();
    pick->mouseDown (juce::MouseEvent (src, lp, juce::ModifierKeys (juce::ModifierKeys::leftButtonModifier), 0, 0, 0, 0, 0, pick.get(), pick.get(), t, lp, t, 1, false));
}

double PrismFace::paintDirty (float scale)
{
    std::map<Layer*, juce::Rectangle<int>> merged;
    for (const auto& [l, r] : dirty)
        merged[l] = merged.count (l) ? merged[l].getUnion (r) : r;
    dirty.clear();
    std::vector<std::pair<Layer*, juce::Rectangle<int>>> list (merged.begin(), merged.end());
    const auto t0 = juce::Time::getMillisecondCounterHiRes();
    for (const auto& [l, r] : list)
    {
        juce::Image im (juce::Image::ARGB, juce::jmax (1, (int) ((float) r.getWidth() * scale)), juce::jmax (1, (int) ((float) r.getHeight() * scale)), true);
        juce::Graphics g (im);
        g.addTransform (juce::AffineTransform::translation ((float) -r.getX(), (float) -r.getY()).scaled (scale));
        g.reduceClipRegion (r);
        l->paint (g);
    }
    return juce::Time::getMillisecondCounterHiRes() - t0;
}
