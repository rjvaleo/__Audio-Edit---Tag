#include "EditFace.h"

#include "Canvas2D.h"

#include <cmath>

namespace
{
float numOf (const juce::var& v, float fallback = 0.0f)
{
    if (v.isString())
        return v.toString().getFloatValue();
    return v.isVoid() || v.isUndefined() ? fallback : (float) (double) v;
}

double dnum (const juce::var& v, double fallback = 0.0)
{
    if (v.isString())
        return v.toString().getDoubleValue();
    return v.isVoid() || v.isUndefined() ? fallback : (double) v;
}

juce::Rectangle<float> rectOf (const juce::var& r)
{
    return { numOf (r[0]), numOf (r[1]), numOf (r[2]), numOf (r[3]) };
}

juce::String dataOf (const juce::var& n, const char* k)
{
    return n["data"][k].toString();
}

bool hasClass (const juce::var& n, const char* c)
{
    return juce::StringArray::fromTokens (n["cls"].toString(), " ", "").contains (c);
}

juce::String fixed (double v, int places) { return juce::String (v, places); }
juce::String uni (const char* s) { return juce::String::fromUTF8 (s); }

// The ops that refit the view and drop the selection (060's STRUCTURAL), and
// those worth snapping (300's SNAPPABLE).
const juce::StringArray structural { "cut", "delete", "paste", "crop", "duplicate", "insertSilence", "reverse", "silence",
                                     "fadeIn", "fadeOut", "gain", "normalize", "normalizeRms", "stripSilence", "repairClick",
                                     "split", "undo", "redo", "revert" };
const juce::StringArray snappable { "cut", "copy", "delete", "paste", "crop", "silence", "fadeIn", "fadeOut", "reverse",
                                    "duplicate", "insertSilence", "split" };

// A deep copy of a captured tree with every node's index moved on, so it can
// lend its look inside another capture without its numbers meeting that one's.
juce::var renumbered (const juce::var& n, int by)
{
    auto* o = n.getDynamicObject();
    if (o == nullptr)
        return n;
    auto copy = o->clone();
    copy->setProperty ("i", (int) n["i"] + by);
    if (auto* kids = n["kids"].getArray())
    {
        juce::Array<juce::var> k;
        for (const auto& kid : *kids)
            k.add (renumbered (kid, by));
        copy->setProperty ("kids", k);
    }
    return juce::var (copy.release());
}

// edFmt (412).
juce::String fmtDb (double v) { return (v > 0 ? "+" : "") + fixed (v, 1) + " dB"; }
juce::String fmtDbn (double v) { return fixed (v, 1) + " dB"; }
juce::String fmtMs (double v) { return v >= 1000 ? fixed (v / 1000.0, 2) + " s" : v < 10 ? fixed (v, 2) + " ms" : juce::String (juce::roundToInt (v)) + " ms"; }
juce::String fmtX (double v) { return uni ("\xc3\x97") + juce::String (juce::roundToInt (v)); }
juce::String fmtFor (const juce::String& param, double v)
{
    if (param == "gainDb")
        return fmtDb (v);
    if (param == "minMs" || param == "padMs" || param == "insMs" || param == "widthMs")
        return fmtMs (v);
    if (param == "dupCount")
        return fmtX (v);
    return fmtDbn (v);
}

constexpr int lookBy = 100000;
} // namespace

// ─────────────────────────────────────────────────────────────── building

EditFace::EditFace (Call c, uint32_t i)
    : call (std::move (c)), id (i), captured (face::page ("edit")),
      emptyPage (captured["empty"]), openPage (captured["open"]), nowbar (captured["nowbar"]), nowbarOpen (captured["nowbarOpen"])
{
    data = juce::JSON::parse (face::embeddedFile ("edit-page.json"));
    vars = captured["open"]["vars"];
    setSize (1500, 1100);
    setWantsKeyboardFocus (true);
    for (auto* p : { &emptyPage, &openPage })
        addChildComponent (*p);
    for (auto* p : { &nowbar, &nowbarOpen })
    {
        addChildComponent (*p);
        p->setTopLeftPosition (0, 1052);
    }
    index (captured["open"]["tree"], openIds);
    index (captured["empty"]["tree"], emptyIds);
    index (captured["nowbar"]["tree"], nowIds, 1052);
    index (captured["nowbarLit"]["tree"], litIds, 1052);
    auto node = [this] (const juce::String& k) { return openIds[k].r; };
    laneR = node ("lane");
    waveR = node ("waveCanvas");
    specR = node ("specCanvas");
    timeR = node ("edTimeCanvas");
    levelR = node ("edLevelCanvas");
    poR = node ("poCanvas");
    counterR = node ("edCounters");
    sideR = node ("edSide");
    barR = node ("waveTools");

    // What the face draws itself, live, is left out of the frames.
    for (auto* m : { &openIds, &emptyIds })
    {
        auto& page = m == &openIds ? openPage : emptyPage;
        for (const char* k : { "waveTools", "selection", "cue", "playhead", "edHands", "laneSplit", "edLoupe", "edPreview", "tabBar" })
            if (m->count (k) > 0)
                page.skip.insert ((*m)[k].i);
        for (const char* k : { "edmPeakV", "edmRmsV", "edmHits", "edmLoud", "poZoomRo" })
            if (m->count (k) > 0)
                page.skipText.insert ((*m)[k].i);
    }
    // The counters' values.
    std::function<void (const juce::var&, face::Chrome&)> counters = [&] (const juce::var& n, face::Chrome& page) {
        // The counters' cells grow with what they say (their flex), so the face
        // lays them out; and the meters' readings are written whole.
        if (hasClass (n, "ed-c"))
            page.skip.insert ((int) n["i"]);
        if (hasClass (n, "ed-vm"))
            if (auto* kids = n["kids"].getArray())
                for (const auto& k : *kids)
                    if (k["tag"].toString() == "span")
                        page.skip.insert ((int) k["i"]);
        if (auto* kids = n["kids"].getArray())
            for (const auto& k : *kids)
                counters (k, page);
    };
    counters (captured["open"]["tree"], openPage);
    counters (captured["empty"]["tree"], emptyPage);
    for (auto* p : { &nowbar, &nowbarOpen })
    {
        for (const char* k : { "timeNow", "nbName", "nbMeta", "nbDb", "nbBpmV", "loopLabel" })
            if (nowIds.count (k) > 0)
                p->skipText.insert (nowIds[k].i);
        if (nowIds.count ("volume") > 0)
            p->skip.insert (nowIds["volume"].i);
    }

    // The bar: its own frames, laid out whole, seen through its place on the page.
    barEmpty = std::make_unique<face::Chrome> (captured["bar"]["empty"]);
    barOpen = std::make_unique<face::Chrome> (captured["bar"]["open"]);
    barCustom = std::make_unique<face::Chrome> (captured["bar"]["custom"]);
    index (captured["bar"]["open"]["tree"], barIds);
    std::map<juce::String, Node> customIds;
    std::function<void (const juce::var&)> cmds = [&] (const juce::var& n) {
        const auto cmdId = dataOf (n, "cmd"), m = dataOf (n, "more");
        if (cmdId.isNotEmpty() && hasClass (n, "wt-btn"))
            barCmds[cmdId] = { (int) n["i"], rectOf (n["rect"]), n };
        if (m.isNotEmpty())
            barMore[m] = { (int) n["i"], rectOf (n["rect"]), n };
        if (auto* kids = n["kids"].getArray())
            for (const auto& k : *kids)
                cmds (k);
    };
    cmds (captured["bar"]["open"]["tree"]);
    std::function<void (const juce::var&)> emptyCmdsOf = [&] (const juce::var& n) {
        const auto cmdId = dataOf (n, "cmd");
        if (cmdId.isNotEmpty() && hasClass (n, "wt-btn"))
        {
            auto copy = renumbered (n, lookBy);
            emptyCmds[cmdId] = { (int) copy["i"], rectOf (n["rect"]), copy };
            barOpen->nodes[(int) copy["i"]] = copy;
        }
        if (auto* kids = n["kids"].getArray())
            for (const auto& k : *kids)
                emptyCmdsOf (k);
    };
    emptyCmdsOf (captured["bar"]["empty"]["tree"]);
    barOpen->skip.insert (barIds["wtBits"].i);
    struct Clip final : public juce::Component
    {
    };
    barClip = std::make_unique<Clip>();
    barClip->setInterceptsMouseClicks (false, false);
    barClip->setBounds (barR.toNearestInt());
    for (auto* b : { barEmpty.get(), barOpen.get(), barCustom.get() })
        barClip->addChildComponent (*b);
    addAndMakeVisible (*barClip);

    for (const auto& [k, v] : std::map<juce::String, bool> { { "rainbow", true }, { "spec", true }, { "level", true }, { "hits", false }, { "loud", false }, { "snapHits", false } })
        prefs[k] = v;
    if (auto* o = data["params"].getDynamicObject())
        for (const auto& p : o->getProperties())
            params[p.name.toString()] = (double) p.value;

    buildLayers();
    reload();
    startTimerHz (30);
}

EditFace::~EditFace()
{
    stopTimer();
    pop.reset();
}

void EditFace::index (const juce::var& n, std::map<juce::String, Node>& ids, float dy)
{
    const auto key = n["id"].toString();
    if (key.isNotEmpty())
        ids[key] = { (int) n["i"], rectOf (n["rect"]).translated (0, dy), n };
    if (auto* kids = n["kids"].getArray())
        for (const auto& k : *kids)
            index (k, ids, dy);
}

juce::Colour EditFace::ink (const juce::String& token, const juce::String& fallback) const
{
    const auto s = vars[juce::Identifier (token)].toString();
    return c2d::css (s.isEmpty() ? fallback : s);
}

EditFace::Layer* EditFace::addLayer (const juce::String& n, juce::Rectangle<float> r, std::function<void (juce::Graphics&)> draw)
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

void EditFace::repaintLayer (const juce::String& n)
{
    if (auto it = named.find (n); it != named.end())
        it->second->repaint();
}

void EditFace::buildLayers()
{
    // Each drawing in its own layer, drawn again only when what it shows moves.
    auto at = [] (juce::Graphics& g, juce::Rectangle<float> r, Layer* l) { g.setOrigin (-l->getPosition()); juce::ignoreUnused (r); };
    Layer* l = nullptr;
    // The wave, its spectrogram, rulers and marks: drawn into a picture again
    // only when what they show has changed.
    l = addLayer ("wave", laneR, [this] (juce::Graphics& g) {
        const float scale = g.getInternalContext().getPhysicalPixelScaleFactor();
        juce::String key;
        key << viewFrom << "|" << viewTo << "|" << peakCols << "|" << peakCh << "|" << (int64_t) serial << "|" << split << "|" << (int) measured << "|"
            << (int) colours.size() << "|" << (spec.isValid() ? spec.getWidth() : 0) << "|" << scale << "|" << (int) open << "|" << face::stamp();
        for (const auto& [k, v] : prefs)
            key << (v ? "1" : "0");
        if (key != waveKey || !waveShot.isValid())
        {
            waveKey = key;
            waveShot = juce::Image (juce::Image::ARGB, std::max (1, juce::roundToInt (laneR.getWidth() * scale)), std::max (1, juce::roundToInt (laneR.getHeight() * scale)), true);
            juce::Graphics w (waveShot);
            w.addTransform (juce::AffineTransform::scale (scale).translated (-laneR.getX() * scale, -laneR.getY() * scale));
            drawSpec (w);
            drawWave (w);
            drawLevel (w);
            drawMarks (w);
        }
        g.drawImage (waveShot, juce::Rectangle<float> (0, 0, laneR.getWidth(), laneR.getHeight()));
    });
    l = addLayer ("time", timeR, [this] (juce::Graphics& g) { g.setOrigin (-timeR.getPosition().toInt()); drawTime (g); });
    l = addLayer ("overlay", laneR, [this] (juce::Graphics& g) { g.setOrigin (-laneR.getPosition().toInt()); drawOverlay (g); });
    l = addLayer ("overview", openIds["pageOv"].r, [this] (juce::Graphics& g) { g.setOrigin (-openIds["pageOv"].r.getPosition().toInt()); drawOverview (g); });
    l = addLayer ("tabs", openIds["editTools"].r, [this] (juce::Graphics& g) { g.setOrigin (-openIds["editTools"].r.getPosition().toInt()); drawTabs (g); });
    l = addLayer ("counters", counterR, [this] (juce::Graphics& g) { g.setOrigin (-counterR.getPosition().toInt()); drawCounters (g); });
    l = addLayer ("meters", openIds["edMeters"].r, [this] (juce::Graphics& g) { g.setOrigin (-openIds["edMeters"].r.getPosition().toInt()); drawMeters (g); });
    l = addLayer ("now", { 0, 1052, 1500, 48 }, [this] (juce::Graphics& g) { g.setOrigin ({ 0, -1052 }); drawNow (g); });
    // The bar's bit depth beside Export (wtBits), which scrolls with the bar.
    l = addLayer ("barText", barR, [this] (juce::Graphics& g) {
        if (customizing || barIds.count ("wtBits") == 0)
            return;
        const auto& n = barIds["wtBits"];
        const auto r = n.r.translated (0, -(float) barScroll);
        face::paintBox (g, n.n, r);
        g.setFont (face::font (n.n["font"]));
        g.setColour (face::colour (n.n["font"]["colour"]));
        g.drawText (exportBits == 32 ? juce::String ("32-bit float") : juce::String (exportBits) + "-bit", r.reduced (8, 0), juce::Justification::centredLeft, true);
    });
    juce::ignoreUnused (at, l);
}

// ─────────────────────────────────────────────────────────── the document

void EditFace::readSound()
{
    const auto text = juce::String (call ([this] (NaApp* a) -> int64_t {
        std::vector<char> buf (1 << 16);
        auto n = na_sound_of (a, id);
        if (n < 0)
            return -1;
        int32_t len = na_sound_info (a, (uint32_t) n, buf.data(), (uint32_t) buf.size());
        if (len >= (int32_t) buf.size())
        {
            buf.resize ((size_t) len + 1);
            len = na_sound_info (a, (uint32_t) n, buf.data(), (uint32_t) buf.size());
        }
        infoText = len > 0 ? juce::String::fromUTF8 (buf.data(), len) : juce::String();
        return len;
    }) >= 0 ? infoText : juce::String());
    const auto info = juce::JSON::parse (text);
    const bool was = open;
    open = (bool) info["open"];
    if (!open)
    {
        name = info["origin"]["name"].toString();
        meta = info["missing"].toString();
        frames = 0;
        serial = -1;
        measured = false;
        measures = juce::var();
        annotations = juce::var();
        canUndo = canRedo = edited = false;
        if (was)
            refit();
        return;
    }
    name = info["origin"]["name"].toString();
    frames = dnum (info["frames"]);
    baseFrames = dnum (info["baseFrames"]);
    sr = dnum (info["sampleRate"], 44100);
    canUndo = (bool) info["canUndo"];
    canRedo = (bool) info["canRedo"];
    edited = (bool) info["edited"];
    clipboard = dnum (info["clipboard"]);
    ratio = dnum (info["stretch"]["ratio"], 1);
    annotations = info["annotations"];
    const auto dur = frames / sr;
    meta = fixed (dur, 2) + "s";
    const auto s = (int64_t) dnum (info["serial"]);
    const bool fresh = s != serial;
    serial = s;
    if (fresh || !was)
    {
        measured = (bool) info["measured"];
        measures = juce::JSON::parse (juce::String (call ([this] (NaApp* a) -> int64_t {
            std::vector<char> buf (1 << 20);
            const double a0 = hasSel ? selA : 0, b0 = hasSel ? selB : 0;
            const int32_t len = na_edit_measures (a, id, a0, b0, buf.data(), (uint32_t) buf.size());
            infoText = len > 0 && len < (int32_t) buf.size() ? juce::String::fromUTF8 (buf.data(), len) : juce::String();
            return 0;
        }) == 0 ? infoText : juce::String()));
        if (!was)
            viewFrom = viewTo = 0;
        if (viewTo <= viewFrom || viewTo > frames)
            refit();
        loadPeaks();
        loadOverview();
        loadSpectrogram();
    }
}

void EditFace::refit()
{
    viewFrom = 0;
    viewTo = frames;
}

void EditFace::reload()
{
    const auto ui = juce::JSON::parse (juce::String (call ([this] (NaApp* a) -> int64_t {
        std::vector<char> buf (1 << 16);
        const int32_t len = na_edit_ui (a, id, buf.data(), (uint32_t) buf.size());
        infoText = len > 0 && len < (int32_t) buf.size() ? juce::String::fromUTF8 (buf.data(), len) : juce::String();
        return 0;
    }) == 0 ? infoText : juce::String()));
    restore (ui);
    serial = -1;
    readSound();
    applyLoop();
    syncBar();
    for (auto& l : layers)
        l->repaint();
}

void EditFace::restore (const juce::var& ui)
{
    if (!ui.isObject())
        return;
    viewFrom = dnum (ui["view"]["from"]);
    viewTo = dnum (ui["view"]["to"]);
    hasSel = ui["sel"].isObject();
    selA = dnum (ui["sel"]["start"]);
    selB = dnum (ui["sel"]["end"]);
    cue = dnum (ui["cue"]);
    loopOn = (bool) ui["loop"];
    snap = ui["snap"].toString().isNotEmpty() ? ui["snap"].toString() : juce::String ("zero");
    fadeShape = ui["fadeShape"].toString().isNotEmpty() ? ui["fadeShape"].toString() : juce::String ("equalPower");
    if (auto* o = ui["prefs"].getDynamicObject())
        for (const auto& p : o->getProperties())
            prefs[p.name.toString()] = (bool) p.value;
    if (auto* o = ui["params"].getDynamicObject())
        for (const auto& p : o->getProperties())
            params[p.name.toString()] = (double) p.value;
    exportBits = ui["bits"].isVoid() ? 24 : (int) ui["bits"];
    split = ui["split"].isVoid() ? 64.0 : dnum (ui["split"]);
    poA = dnum (ui["zoom"][0]);
    poB = dnum (ui["zoom"][1]);
}

void EditFace::restoreForBench (const juce::var& ui)
{
    restore (ui);
    loadPeaks();
    loadSpectrogram();
    applyLoop();
    syncBar();
    keep();
    for (auto& l : layers)
        l->repaint();
}

juce::String EditFace::stateJson() const
{
    auto* o = new juce::DynamicObject();
    auto* view = new juce::DynamicObject();
    view->setProperty ("from", viewFrom);
    view->setProperty ("to", viewTo);
    o->setProperty ("view", view);
    if (hasSel)
    {
        auto* s = new juce::DynamicObject();
        s->setProperty ("start", selA);
        s->setProperty ("end", selB);
        o->setProperty ("sel", s);
    }
    o->setProperty ("cue", cue);
    o->setProperty ("loop", loopOn);
    o->setProperty ("snap", snap);
    o->setProperty ("fadeShape", fadeShape);
    auto* pr = new juce::DynamicObject();
    for (const auto& [k, v] : prefs)
        pr->setProperty (k, v);
    o->setProperty ("prefs", pr);
    auto* pa = new juce::DynamicObject();
    for (const auto& [k, v] : params)
        pa->setProperty (k, v);
    o->setProperty ("params", pa);
    o->setProperty ("bits", exportBits);
    o->setProperty ("split", split);
    o->setProperty ("zoom", juce::Array<juce::var> { poA, poB });
    o->setProperty ("head", head);
    o->setProperty ("playing", playing);
    o->setProperty ("customizing", customizing);
    return juce::JSON::toString (juce::var (o), true);
}

void EditFace::keep()
{
    const auto s = stateJson();
    call ([this, s] (NaApp* a) -> int64_t { return na_edit_set_ui (a, id, s.toRawUTF8()); });
}

// ───────────────────────────────────────────────────────── reading the sound

double EditFace::fx (double frame) const
{
    const double w = laneR.getWidth() - 2;
    return viewTo > viewFrom ? (frame - viewFrom) / (viewTo - viewFrom) * w : 0;
}

double EditFace::frameAt (float x) const
{
    const double w = laneR.getWidth() - 2;
    const double frac = juce::jlimit (0.0, 1.0, (x - laneR.getX() - 1) / w);
    return std::round (viewFrom + frac * (viewTo - viewFrom));
}

// The lane's split: the wave over the spectrogram while it shows.
static juce::Rectangle<float> waveArea (juce::Rectangle<float> lane, bool spec, double split)
{
    const float h = lane.getHeight() - 1;
    return { lane.getX() + 1, lane.getY(), lane.getWidth() - 2, spec ? std::round (h * (float) split / 100.0f) : h };
}

void EditFace::loadPeaks()
{
    peaks.clear();
    colours.clear();
    peakCols = peakCh = 0;
    if (!open || frames <= 0)
        return;
    // One column per device pixel, as `lanePixels` asks (the page is seen at 2x).
    const int cols = juce::jlimit (200, 8192, (int) std::round ((laneR.getWidth() - 2) * 2));
    std::vector<uint64_t> info (3);
    peaks.resize ((size_t) cols * 3 * 8);
    const auto from = (uint64_t) std::max (0.0, viewFrom), to = (uint64_t) std::max (0.0, viewTo);
    const int got = (int) call ([&] (NaApp* a) -> int64_t { return na_edit_peaks (a, id, from, to, (uint32_t) cols, peaks.data(), (uint32_t) peaks.size(), info.data()); });
    if (got <= 0)
    {
        peaks.clear();
        return;
    }
    peakCols = got;
    peakCh = (int) info[0];
    peaksFrom = (double) info[1];
    peaksTo = (double) info[2];
    peaks.resize ((size_t) (peakCols * 3 * peakCh));
    colours.resize ((size_t) peakCols * 3);
    if (call ([&] (NaApp* a) -> int64_t { return na_edit_colours (a, id, peaksFrom, peaksTo, (uint32_t) peakCols, colours.data()); }) != 1)
        colours.clear();
    repaintLayer ("wave");
    repaintLayer ("time");
    repaintLayer ("overlay");
}

void EditFace::loadOverview()
{
    overview.clear();
    ovColours.clear();
    ovCols = 0;
    if (!open || frames <= 0)
        return;
    std::vector<uint64_t> info (3);
    overview.resize (1400 * 3 * 8);
    const int got = (int) call ([&] (NaApp* a) -> int64_t { return na_edit_peaks (a, id, 0, 0, 1400, overview.data(), (uint32_t) overview.size(), info.data()); });
    if (got <= 0)
    {
        overview.clear();
        return;
    }
    ovCols = got;
    overview.resize ((size_t) (ovCols * 3 * (int) info[0]));
    repaintLayer ("overview");
}

void EditFace::loadSpectrogram()
{
    spec = {};
    if (!open || !prefs["spec"] || frames <= 0)
        return;
    const int cols = juce::jlimit (200, 1200, (int) std::floor (laneR.getWidth() - 2));
    std::vector<uint8_t> lvl ((size_t) cols * 8193);
    float info[2] {};
    const auto from = (uint64_t) std::max (0.0, viewFrom), to = (uint64_t) std::max (0.0, viewTo);
    const int got = (int) call ([&] (NaApp* a) -> int64_t { return na_edit_spectrogram (a, id, from, to, (uint32_t) cols, 1024, lvl.data(), (uint32_t) lvl.size(), info); });
    if (got <= 0)
        return;
    const int bins = (int) info[0];
    const double maxHz = info[1] > 0 ? info[1] : 22050;
    // drawSpectrogram (240): log rows, the loudest bin of each, the ramp, the relief.
    const double fmin = std::min (30.0, maxHz / 2), span = std::log (maxHz / fmin);
    std::vector<int> lo ((size_t) bins), hi ((size_t) bins);
    for (int r = 0; r < bins; ++r)
    {
        const double f0 = fmin * std::exp (span * ((double) r / bins)), f1 = fmin * std::exp (span * ((double) (r + 1) / bins));
        int a = (int) std::floor ((f0 / maxHz) * (bins - 1)), b = (int) std::ceil ((f1 / maxHz) * (bins - 1));
        a = std::max (0, std::min (bins - 1, a));
        b = std::max (a, std::min (bins - 1, b));
        lo[(size_t) r] = a;
        hi[(size_t) r] = b;
    }
    std::vector<uint8_t> grid ((size_t) got * (size_t) bins);
    for (int c = 0; c < got; ++c)
        for (int r = 0; r < bins; ++r)
        {
            uint8_t m = 0;
            for (int b = lo[(size_t) r]; b <= hi[(size_t) r]; ++b)
                m = std::max (m, lvl[(size_t) (c * bins + b)]);
            grid[(size_t) (c * bins + r)] = m;
        }
    static const std::pair<double, std::array<int, 3>> stops[] = {
        { 0.00, { 4, 5, 14 } }, { 0.16, { 28, 16, 68 } }, { 0.34, { 88, 24, 118 } }, { 0.52, { 156, 38, 106 } },
        { 0.68, { 214, 76, 66 } }, { 0.83, { 244, 148, 38 } }, { 0.94, { 252, 210, 96 } }, { 1.00, { 255, 250, 226 } },
    };
    static std::array<uint8_t, 768> lut = [] {
        std::array<uint8_t, 768> l {};
        for (int i = 0; i < 256; ++i)
        {
            const double t = i / 255.0;
            std::array<int, 3> col = stops[7].second;
            for (int s = 1; s < 8; ++s)
                if (t <= stops[s].first)
                {
                    const auto& [p1, c1] = stops[s - 1];
                    const auto& [p2, c2] = stops[s];
                    const double k = p2 - p1 <= 0 ? 0 : (t - p1) / (p2 - p1);
                    for (int j = 0; j < 3; ++j)
                        col[(size_t) j] = (int) (c1[(size_t) j] + (c2[(size_t) j] - c1[(size_t) j]) * k);
                    break;
                }
            for (int j = 0; j < 3; ++j)
                l[(size_t) (i * 3 + j)] = (uint8_t) col[(size_t) j];
        }
        return l;
    }();
    constexpr double relief = 2.6;
    juce::Image img (juce::Image::RGB, got, bins, false);
    juce::Image::BitmapData px (img, juce::Image::BitmapData::writeOnly);
    for (int c = 0; c < got; ++c)
    {
        const int here = c * bins, left = c > 0 ? here - bins : -1, right = c < got - 1 ? here + bins : -1;
        for (int b = 0; b < bins; ++b)
        {
            const double dx = ((right < 0 ? 0 : grid[(size_t) (right + b)]) - (left < 0 ? 0 : grid[(size_t) (left + b)])) / 255.0;
            const double dy = ((b < bins - 1 ? grid[(size_t) (here + b + 1)] : 0) - (b > 0 ? grid[(size_t) (here + b - 1)] : 0)) / 255.0;
            const double shade = 1 + (dx - dy) * 1.15 * relief;
            const int k = grid[(size_t) (here + b)] * 3;
            auto ch = [&] (int j) { return (uint8_t) juce::jlimit (0.0, 255.0, std::floor (lut[(size_t) (k + j)] * shade)); };
            px.setPixelColour (c, bins - 1 - b, juce::Colour (ch (0), ch (1), ch (2)));
        }
    }
    spec = img;
    repaintLayer ("wave");
}

// ────────────────────────────────────────────────────────────── the drawings

void EditFace::writeText (juce::Graphics& g, const Node& n, const juce::String& text, juce::Justification j)
{
    face::paintText (g, n.n, n.r, text, j);
}

// One captured part, drawn whole at an offset: its box, its words (or ones
// given for it), its icons and what is inside it.
static void paintTree (juce::Graphics& g, const juce::var& n, juce::Point<float> by, const std::map<int, juce::String>* texts = nullptr, juce::Rectangle<float>* size = nullptr)
{
    auto r = rectOf (n["rect"]) + by;
    if (size != nullptr && !size->isEmpty())
        r = *size, size = nullptr;
    if (numOf (n["opacity"], 1.0f) <= 0.001f)
        return;
    face::paintBox (g, n, r);
    if (n["svg"].isString())
    {
        static std::map<juce::String, std::unique_ptr<juce::Drawable>> cache;
        auto& d = cache[n["svg"].toString()];
        if (d == nullptr)
            d = juce::Drawable::createFromSVGString (n["svg"].toString());
        if (d != nullptr)
            d->drawWithin (g, r, juce::RectanglePlacement::stretchToFit, 1.0f);
    }
    const int i = (int) n["i"];
    if (texts != nullptr && texts->count (i) > 0)
    {
        if (auto* runs = n["text"].getArray(); runs != nullptr && !runs->isEmpty())
            face::paintText (g, n, rectOf (runs->getReference (0)["rect"]) + by, texts->at (i), juce::Justification::centredLeft);
    }
    else if (auto* runs = n["text"].getArray())
        for (const auto& run : *runs)
        {
            juce::DynamicObject::Ptr one = new juce::DynamicObject();
            one->setProperty ("text", juce::Array<juce::var> { run });
            face::paintText (g, juce::var (one.get()), rectOf (run["rect"]) + by, run["text"].toString(), juce::Justification::centredLeft);
        }
    if (auto* kids = n["kids"].getArray())
        for (const auto& k : *kids)
            paintTree (g, k, by, texts);
}

void EditFace::drawWave (juce::Graphics& gr)
{
    if (!open || peaks.empty() || peakCols <= 0 || peakCh <= 0)
        return;
    const auto area = waveArea (laneR, prefs["spec"], split);
    const float w = area.getWidth(), h = area.getHeight();
    juce::Graphics::ScopedSaveState keepIt (gr);
    gr.reduceClipRegion (area.toNearestInt());
    gr.addTransform (juce::AffineTransform::translation (area.getX(), area.getY()));
    c2d::Context ctx (gr, w, h);
    const int nch = peakCh;
    const float laneH = h / (float) nch;
    const auto accent = ink ("--look-wave", "#ffffff");
    const double span = peaksTo - peaksFrom;
    const bool sampleMode = span > 0 && peakCols >= span;
    const bool rainbow = !sampleMode && prefs["rainbow"] && !colours.empty();
    auto at = [this] (int ch, int which, int i) { return peaks[(size_t) ((ch * 3 + which) * peakCols + i)]; };
    for (int ch = 0; ch < nch; ++ch)
    {
        const float top = (float) ch * laneH, mid = top + laneH / 2, half = (laneH / 2) * 0.92f, colW = w / (float) peakCols;
        ctx.setStroke ("rgba(255,255,255,0.07)");
        ctx.beginPath();
        ctx.moveTo (0, mid);
        ctx.lineTo (w, mid);
        ctx.stroke();
        auto inkAt = [&] (int i) {
            return rainbow ? juce::Colour ((juce::uint8) colours[(size_t) i * 3], (juce::uint8) colours[(size_t) i * 3 + 1], (juce::uint8) colours[(size_t) i * 3 + 2]) : accent;
        };
        if (sampleMode)
        {
            // drawSamples (040): stems, the line between, a dot on each.
            const int n = (int) std::min ((double) peakCols, span);
            const float gap = w / (float) span;
            auto xAt = [&] (int i) { return (float) (i / span * w); };
            auto yAt = [&] (int i) { return mid - at (ch, 1, i) * half; };
            if (gap >= 4)
            {
                ctx.strokeStyle = accent;
                ctx.globalAlpha = 0.3f;
                ctx.lineWidth = 1;
                ctx.beginPath();
                for (int i = 0; i < n; ++i)
                {
                    ctx.moveTo (xAt (i), mid);
                    ctx.lineTo (xAt (i), yAt (i));
                }
                ctx.stroke();
            }
            ctx.strokeStyle = accent;
            ctx.globalAlpha = 0.55f;
            ctx.lineWidth = 1;
            ctx.lineJoin = "round";
            ctx.beginPath();
            for (int i = 0; i < n; ++i)
                i == 0 ? ctx.moveTo (xAt (i), yAt (i)) : ctx.lineTo (xAt (i), yAt (i));
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.fillStyle = accent;
            const float rad = std::min (3.0f, std::max (1.0f, gap / 3));
            if (gap >= 3)
                for (int i = 0; i < n; ++i)
                {
                    ctx.beginPath();
                    ctx.arc (xAt (i), yAt (i), rad, 0, juce::MathConstants<float>::twoPi);
                    ctx.fill();
                }
        }
        else
        {
            ctx.fillStyle = accent;
            ctx.globalAlpha = 0.34f;
            for (int i = 0; i < peakCols; ++i)
            {
                const float y1 = mid - at (ch, 1, i) * half, y2 = mid - at (ch, 0, i) * half;
                if (rainbow)
                    ctx.fillStyle = inkAt (i);
                ctx.fillRect ((float) i * colW, y1, std::max (colW - 0.3f, 0.6f), std::max (y2 - y1, 1.0f));
            }
            ctx.globalAlpha = 1;
            for (int i = 0; i < peakCols; ++i)
            {
                const float r = at (ch, 2, i) * half;
                if (rainbow)
                    ctx.fillStyle = inkAt (i);
                ctx.fillRect ((float) i * colW, mid - r, std::max (colW - 0.3f, 0.6f), std::max (r * 2, 1.0f));
            }
        }
        if (ch > 0)
        {
            ctx.setStroke ("rgba(255,255,255,0.06)");
            ctx.beginPath();
            ctx.moveTo (0, top);
            ctx.lineTo (w, top);
            ctx.stroke();
        }
    }
}

void EditFace::drawSpec (juce::Graphics& g)
{
    if (!open || !prefs["spec"] || !spec.isValid())
        return;
    const auto area = waveArea (laneR, true, split);
    const juce::Rectangle<float> r (area.getX(), area.getBottom(), area.getWidth(), laneR.getBottom() - 1 - area.getBottom());
    g.setImageResamplingQuality (juce::Graphics::highResamplingQuality);
    g.drawImage (spec, r);
}

void EditFace::drawTime (juce::Graphics& gr)
{
    // edPaintTime (413).
    if (!open || !(viewTo > viewFrom))
        return;
    const auto r = timeR;
    juce::Graphics::ScopedSaveState keepIt (gr);
    gr.reduceClipRegion (r.toNearestInt());
    gr.addTransform (juce::AffineTransform::translation (r.getX(), r.getY()));
    const float w = r.getWidth(), h = r.getHeight();
    c2d::Context g (gr, w, h);
    const double span = (viewTo - viewFrom) / sr;
    static const double steps[] = { 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60 };
    double st = 60;
    for (auto s : steps)
        if (s / span * w > 70)
        {
            st = s;
            break;
        }
    auto x = [&] (double t) { return (float) ((t * sr - viewFrom) / (viewTo - viewFrom) * w); };
    g.font = "9px monospace";
    g.textBaseline = "top";
    g.fillStyle = ink ("--look-text-3", "#858b94");
    for (double t = std::floor (viewFrom / sr / st) * st; t <= viewTo / sr + st; t += st)
    {
        const float px = x (t);
        g.globalAlpha = 0.8f;
        g.fillRect (px, 0, 1, h);
        g.globalAlpha = 0.4f;
        for (int j = 1; j < 5; ++j)
            g.fillRect (x (t + st * j / 5), h * 0.6f, 1, h);
        g.globalAlpha = 1;
        g.fillText (st < 0.1 ? fixed (t, 3) : st < 1 ? fixed (t, 1) + " s" : fixed (t, 0) + " s", px + 3, 2);
    }
}

void EditFace::drawLevel (juce::Graphics& gr)
{
    // edPaintLevel (413): drawn as long as the page is, a sound open or not.
    if (!prefs["level"])
        return;
    const auto wave = waveArea (laneR, prefs["spec"], split);
    const juce::Rectangle<float> r (levelR.getX(), wave.getY(), levelR.getWidth(), wave.getHeight());
    juce::Graphics::ScopedSaveState keepIt (gr);
    gr.addTransform (juce::AffineTransform::translation (r.getX(), r.getY()));
    const float w = r.getWidth(), h = r.getHeight();
    c2d::Context g (gr, w, h);
    const int nch = open && peakCh > 0 ? peakCh : 1;
    const float laneH = h / (float) nch;
    g.font = "9px monospace";
    g.textAlign = "right";
    g.textBaseline = "middle";
    g.fillStyle = ink ("--look-text-3", "#858b94");
    for (int ch = 0; ch < nch; ++ch)
    {
        const float mid = (float) ch * laneH + laneH / 2, half = (laneH / 2) * 0.92f;
        for (int db : { 0, -3, -6, -12, -24 })
        {
            const float a = std::pow (10.0f, (float) db / 20.0f);
            for (int s : { 1, -1 })
            {
                const float y = mid - (float) s * a * half;
                g.globalAlpha = 0.7f;
                g.fillRect (w - 5, y, 5, 1);
                g.globalAlpha = 1;
                if (s > 0 && laneH > 90)
                    g.fillText (db == 0 ? juce::String ("0") : juce::String (db), w - 7, y + (db == 0 ? 5.0f : 0.0f));
            }
        }
        g.globalAlpha = 0.5f;
        g.fillRect (w - 8, mid, 8, 1);
        g.globalAlpha = 1;
    }
}

void EditFace::drawMarks (juce::Graphics& gr)
{
    // edPaintMarks (413).
    if (!open || !measures.isObject() || !(viewTo > viewFrom))
        return;
    const auto r = waveArea (laneR, prefs["spec"], split);
    juce::Graphics::ScopedSaveState keepIt (gr);
    gr.reduceClipRegion (r.toNearestInt());
    gr.addTransform (juce::AffineTransform::translation (r.getX(), r.getY()));
    const float w = r.getWidth(), h = r.getHeight();
    c2d::Context g (gr, w, h);
    auto x = [&] (double f) { return (float) ((f - viewFrom) / (viewTo - viewFrom) * w); };
    if (prefs["hits"])
        if (auto* hits = measures["hits"].getArray())
        {
            g.setFill ("rgba(255,255,255,.6)");
            for (const auto& f : *hits)
            {
                const float px = x (dnum (f));
                if (px < 0 || px > w)
                    continue;
                g.fillRect (px, 0, 1, 9);
                g.beginPath();
                g.moveTo (px - 2.5f, 9);
                g.lineTo (px + 3.5f, 9);
                g.lineTo (px + 0.5f, 13);
                g.fill();
            }
        }
    if (prefs["loud"])
        if (auto* loud = measures["loud"].getArray())
        {
            g.setFill ("#ff6a3d");
            g.setShadow ("#ff6a3d");
            g.shadowBlur = 4;
            for (const auto& s : *loud)
            {
                const float px = x (dnum (s[0]));
                if (px < 0 || px > w)
                    continue;
                g.beginPath();
                g.moveTo (px, h - 11);
                g.lineTo (px + 5, h - 2);
                g.lineTo (px - 5, h - 2);
                g.fill();
            }
            g.shadowBlur = 0;
        }
}

juce::String EditFace::fmtTime (double sec) const
{
    if (!std::isfinite (sec) || sec < 0)
        sec = 0;
    const int m = (int) std::floor (sec / 60), s = (int) std::floor (std::fmod (sec, 60.0)), ms = (int) std::floor (std::fmod (sec, 1.0) * 1000);
    return juce::String (m).paddedLeft ('0', 2) + ":" + juce::String (s).paddedLeft ('0', 2) + "." + juce::String (ms).paddedLeft ('0', 3);
}

void EditFace::drawOverlay (juce::Graphics& g)
{
    if (!open || !(viewTo > viewFrom))
        return;
    const float x0 = laneR.getX() + 1, top = laneR.getY(), H = laneR.getHeight() - 1, W = laneR.getWidth() - 2;
    juce::Graphics::ScopedSaveState keepIt (g);
    g.reduceClipRegion (juce::Rectangle<float> (x0, top, W, H).toNearestInt());
    // The selection.
    if (hasSel && selB > selA)
    {
        const float a = x0 + (float) fx (selA), b = x0 + (float) fx (selB);
        face::paintBox (g, openIds["selection"].n, { a, top, std::max (1.0f, b - a), H });
    }
    // The cursor (the cue) and the playhead.
    if (cue >= viewFrom && cue <= viewTo)
    {
        const auto& n = openIds["cue"];
        paintTree (g, n.n, { x0 + (float) fx (cue) - n.r.getX(), 0 });
    }
    if (playing && head >= viewFrom && head <= viewTo)
    {
        const auto& n = openIds["playhead"];
        paintTree (g, n.n, { x0 + (float) fx (head) - n.r.getX(), 0 });
    }
    // The handles on the selection (414).
    if (selOn())
    {
        const auto& hands = openIds["edHands"].n;
        const auto* kids = hands["kids"].getArray();
        const float a = (float) fx (selA), b = (float) fx (selB);
        if (kids != nullptr && !(b < 0 || a > W))
        {
            const float ca = std::max (0.0f, a), cb = std::min (W, b);
            const auto lv = measures["levels"];
            const bool hasLv = lv.isObject();
            const double fi = live == "fi" ? liveV : 0, fo = live == "fo" ? liveV : 0, gdb = live == "g" ? liveV : 0;
            const int nch = std::max (1, peakCh);
            const float waveH = waveArea (laneR, prefs["spec"], split).getHeight();
            const float laneH = waveH / (float) nch, half = (laneH / 2) * 0.92f;
            const double peak = hasLv ? dnum (lv["peak"]) : 0;
            const double k = std::min (1.02, std::pow (10.0, (peak + gdb) / 20));
            const float y = laneH / 2 - (float) k * half;
            auto px = [&] (double ms) { return (float) ((ms / 1000 * sr) / (viewTo - viewFrom) * W); };
            for (const auto& kid : *kids)
            {
                const auto cls = kid["cls"].toString();
                const auto r = rectOf (kid["rect"]);
                if (cls == "ed-gl")
                    face::paintBox (g, kid, { x0 + ca, top + y, cb - ca, r.getHeight() });
                else if (cls == "ed-gl lo")
                    face::paintBox (g, kid, { x0 + ca, top + laneH - y, cb - ca, r.getHeight() });
                else if (cls.startsWith ("ed-gg"))
                {
                    const auto text = std::abs (gdb) > 0 ? (gdb > 0 ? "+" : "") + fixed (gdb, 1) + " dB" : hasLv ? fixed (peak, 1) + " dB" : juce::String ("level");
                    const float cx = x0 + (ca + cb) / 2, cy = top + std::min (laneH - 14, y + 24);
                    const float tw = juce::GlyphArrangement::getStringWidth (face::font (kid["text"][0]["font"]), text) + 20;
                    const juce::Rectangle<float> box (cx - tw / 2, cy - r.getHeight() / 2, tw, r.getHeight());
                    face::paintBox (g, kid, box);
                    face::paintText (g, kid, box, text, juce::Justification::centred);
                }
                else if (cls == "ed-fh")
                {
                    const bool in = dataOf (kid, "h") == "fi";
                    const float cx = x0 + (in ? a + px (fi) : b - px (fo));
                    const float dx = cx - r.getCentreX();
                    std::map<int, juce::String> label;
                    if (auto* sub = kid["kids"].getArray())
                        for (const auto& s : *sub)
                            label[(int) s["i"]] = (in ? fi : fo) > 0 ? fmtMs (in ? fi : fo) : juce::String ("fade");
                    paintTree (g, kid, { dx, 0 }, &label);
                }
                else if (cls == "ed-chip")
                {
                    const float cx = x0 + (ca + cb) / 2, dx = cx - r.getCentreX();
                    std::map<int, juce::String> words;
                    if (auto* sub = kid["kids"].getArray())
                        for (const auto& s : *sub)
                        {
                            const int si = (int) s["i"];
                            if (s["tag"].toString() == "b")
                                words[si] = fixed ((selB - selA) / sr, 3) + " s";
                            else if (s["tag"].toString() == "span")
                                words[si] = hasLv ? fixed (dnum (lv["rms"]), 1) + " dB RMS" : juce::String();
                            else if (dataOf (s, "x") == "curve")
                                words[si] = fadeShape == "linear" ? "linear fades" : "smooth fades";
                        }
                    paintTree (g, kid, { dx, 0 }, &words);
                }
            }
            // The fade's curve while one is held, and the preview (edPaintPreview).
            if (fi > 0 || fo > 0)
            {
                const float wv = std::max (1.0f, px (fi > 0 ? fi : fo)), xs = x0 + (fi > 0 ? a : b - wv);
                juce::Path p;
                for (int i = 0; i <= 30; ++i)
                {
                    const double u = i / 30.0, v = fadeShape == "linear" ? (fi > 0 ? u : 1 - u) : std::sin ((fi > 0 ? u : 1 - u) * juce::MathConstants<double>::halfPi);
                    const float px2 = xs + (float) (u * wv), py = top + (float) (waveH * 0.04 + (1 - v) * waveH * 0.9);
                    i == 0 ? p.startNewSubPath (px2, py) : p.lineTo (px2, py);
                }
                g.setColour (juce::Colour (0xffffb547));
                g.strokePath (p, juce::PathStrokeType (1.5f));
            }
            if (live.isNotEmpty() && !previewMono.empty())
            {
                const float pa = x0 + a, pw = std::max (1.0f, b - a), mid = top + waveH / 2, hh = mid - top;
                const float half2 = hh * 0.92f;
                g.setColour (juce::Colour::fromFloatRGBA (10 / 255.0f, 12 / 255.0f, 16 / 255.0f, 0.82f));
                g.fillRect (pa, top, pw, waveH);
                g.setColour (juce::Colour (0xffffc46e));
                const double n = selB - selA, kk = live == "g" ? std::pow (10.0, liveV / 20) : 1;
                const double fn = live == "fi" || live == "fo" ? std::round (liveV / 1000 * sr) : 0;
                const int cols = (int) pw;
                for (int xx = 0; xx < cols; ++xx)
                {
                    const size_t i0 = (size_t) std::floor ((double) xx / cols * n), i1 = std::max (i0 + 1, (size_t) std::floor ((double) (xx + 1) / cols * n));
                    float mn = 0, mx = 0;
                    const size_t step = std::max<size_t> (1, (i1 - i0) / 48);
                    for (size_t i = i0; i < i1 && i < previewMono.size(); i += step)
                        mn = std::min (mn, previewMono[i]), mx = std::max (mx, previewMono[i]);
                    const double off = (xx + 0.5) / cols * n;
                    double env = kk;
                    auto curve = [this] (double u) { return fadeShape == "linear" ? u : std::sin (u * juce::MathConstants<double>::halfPi); };
                    if (live == "fi" && off < fn)
                        env = curve (off / fn);
                    if (live == "fo" && n - off < fn)
                        env = curve ((n - off) / fn);
                    const float t2 = (float) juce::jlimit (-1.0, 1.0, mx * env), b2 = (float) juce::jlimit (-1.0, 1.0, mn * env);
                    g.fillRect (pa + (float) xx, mid - t2 * half2, 1.0f, std::max (1.0f, (t2 - b2) * half2));
                }
            }
        }
    }
    // The loupe on an edge being moved (edLoupe).
    if (loupeAt >= 0 && !loupeSamples.empty())
    {
        const auto& tree = captured["loupe"]["tree"];
        const auto lr = rectOf (tree["rect"]);
        const float lx = std::max (4.0f, std::min (W - 224, (float) fx (loupeAt) - 110));
        const juce::Point<float> by (x0 + lx - lr.getX(), 0);
        const double v = loupeSamples[80];
        const bool ok = std::abs (v) < 0.02;
        std::map<int, juce::String> say;
        juce::Rectangle<float> cv;
        if (auto* kids = tree["kids"].getArray())
            for (const auto& k : *kids)
            {
                if (k["tag"].toString() == "span")
                    say[(int) k["i"]] = fmtTime (loupeAt / sr) + uni (" \xc2\xb7 ") + (ok ? juce::String ("on zero, clean") : "off zero " + fixed (v, 3) + ", may click");
                if (k["tag"].toString() == "canvas")
                    cv = rectOf (k["rect"]) + by;
            }
        paintTree (g, tree, by, &say);
        if (!cv.isEmpty())
        {
            juce::Graphics::ScopedSaveState s2 (g);
            g.addTransform (juce::AffineTransform::translation (cv.getX(), cv.getY()));
            c2d::Context c (g, cv.getWidth(), cv.getHeight());
            const float w = cv.getWidth(), h = cv.getHeight();
            const int R = 80;
            c.setFill ("rgba(255,255,255,.1)");
            c.fillRect (0, h / 2, w, 1);
            c.setFill ("rgba(255,181,71,.6)");
            c.fillRect (w / 2, 0, 1, h);
            c.strokeStyle = ink ("--look-wave", "#fff");
            c.lineWidth = 1.5f;
            c.beginPath();
            for (int kk = -R; kk <= R; ++kk)
            {
                const float px2 = w / 2 + (float) kk / R * w / 2, py = h / 2 - loupeSamples[(size_t) (kk + R)] * h / 2 * 1.5f;
                kk == -R ? c.moveTo (px2, py) : c.lineTo (px2, py);
            }
            c.stroke();
            c.setFill (ok ? "#3ad59b" : "#ff7a70");
            c.beginPath();
            c.arc (w / 2, h / 2 - (float) v * h / 2 * 1.5f, 4, 0, 7);
            c.fill();
        }
    }
}

void EditFace::drawCounters (juce::Graphics& g)
{
    // edPaintCounters (413): with no sound, the whole of nothing.
    const double total = open ? frames : 0;
    const bool sel = hasSel && selB > selA;
    const double a = sel ? selA : 0, b = sel ? selB : total;
    const auto lv = measures["levels"];
    const bool has = lv.isObject();
    auto t = [this] (double f) { return fmtTime (f / sr); };
    const juce::String all = sel ? juce::String() : uni (" \xc2\xb7 all");
    std::map<juce::String, std::pair<juce::String, juce::String>> cells {
        { "cursor", { "Cursor", t (playing ? head : cue) } },
        { "start", { "Start" + all, t (a) } }, { "end", { "End" + all, t (b) } },
        { "length", { "Length" + all, fixed ((b - a) / sr, 3) + " s" } },
        { "peak", { "Peak" + all, has ? fixed (dnum (lv["peak"]), 1) + " dB" : uni ("\xe2\x80\x94") } },
        { "rms", { "RMS" + all, has ? fixed (dnum (lv["rms"]), 1) + " dB" : uni ("\xe2\x80\x94") } },
        { "view", { "View", fixed (open ? (viewTo - viewFrom) / sr : 0.0, 3) + " s" } },
    };
    // The cells side by side, each as wide as its label or its value, with the
    // page's padding (`.ed-c`), from where the first one starts.
    std::vector<juce::var> list;
    std::function<void (const juce::var&)> find = [&] (const juce::var& n) {
        if (hasClass (n, "ed-c"))
            list.push_back (n);
        else if (auto* kids = n["kids"].getArray())
            for (const auto& k : *kids)
                find (k);
    };
    find ((open ? openIds : emptyIds)["edCounters"].n);
    float x = list.empty() ? 0 : rectOf (list.front()["rect"]).getX();
    for (const auto& n : list)
    {
        const auto key = dataOf (n, "c");
        const auto r = rectOf (n["rect"]);
        auto* kids = n["kids"].getArray();
        if (kids == nullptr || kids->size() < 2 || cells.count (key) == 0)
            continue;
        const auto& lab = kids->getReference (0);
        const auto& val = kids->getReference (1);
        const auto lr = rectOf (lab["rect"]), vr = rectOf (val["rect"]);
        const float pad = lr.getX() - r.getX();
        const auto label = cells[key].first.toUpperCase(), value = cells[key].second;
        auto widthOf = [] (const juce::var& k, const juce::String& words) { return juce::GlyphArrangement::getStringWidth (face::font (k["text"][0]["font"]), words); };
        const float w = std::max (widthOf (lab, label), widthOf (val, value)) + 2 * pad;
        const juce::Rectangle<float> box (x, r.getY(), w, r.getHeight());
        face::paintBox (g, n, box);
        face::paintText (g, lab, juce::Rectangle<float> (x + pad, lr.getY(), w, lr.getHeight()), label);
        face::paintText (g, val, juce::Rectangle<float> (x + pad, vr.getY(), w, vr.getHeight()), value);
        x += w;
    }

}

void EditFace::drawMeters (juce::Graphics& g)
{
    // edPaintMeters (413).
    const auto lv = measures["levels"];
    const bool has = open && lv.isObject();
    auto pc = [] (double db) { return juce::jlimit (0.0, 1.0, (db + 60) / 60); };
    for (const char* k : { "edmPeak", "edmRms" })
    {
        const auto& n = openIds[k];
        const auto well = n.r.withY (n.r.getY() - 81).withHeight (84);
        const double db = has ? dnum (lv[juce::String (k) == "edmPeak" ? "peak" : "rms"]) : -200;
        const float h = has ? (float) (pc (db) * 84) : 0;
        if (h > 0)
            face::paintBox (g, n.n, { n.r.getX(), n.r.getBottom() - h, n.r.getWidth(), h });
        // "peak <b>−7.7</b>", centred over the well as the page sets it.
        const auto& v = openIds[juce::String (k) + "V"];
        const auto word = juce::String (k) == "edmPeak" ? "peak " : "rms ";
        const auto value = has ? fixed (db, 1) : uni ("\xe2\x80\x94");
        const auto fv = face::font (v.n["text"][0]["font"]);
        const float ww = juce::GlyphArrangement::getStringWidth (fv, word + value);
        const auto vm = n.r.withY (v.r.getY()).withHeight (v.r.getHeight()).expanded (3, 0);
        face::paintText (g, v.n, juce::Rectangle<float> (vm.getCentreX() - ww / 2, vm.getY(), ww + 4, vm.getHeight()), word + value);
        juce::ignoreUnused (well);
    }
    const auto& bandsN = openIds["edmBands"];
    if (open && measures.isObject())
    {
        const double lo = dnum (measures["bands"][0]), mi = dnum (measures["bands"][1]), hi = dnum (measures["bands"][2]);
        const double t = lo + mi + hi > 0 ? lo + mi + hi : 1;
        float x = bandsN.r.getX();
        const juce::Colour cols[] = { juce::Colour (132, 104, 255), juce::Colour (32, 236, 168), juce::Colour (255, 255, 255) };
        const double vals[] = { lo, mi, hi };
        juce::Graphics::ScopedSaveState s (g);
        g.reduceClipRegion (face::box (bandsN.r, bandsN.n["radius"]));
        for (int i = 0; i < 3; ++i)
        {
            const float w = (float) (vals[i] / t) * bandsN.r.getWidth();
            g.setColour (cols[i]);
            g.fillRect (x, bandsN.r.getY(), w, bandsN.r.getHeight());
            x += w;
        }
    }
    const auto count = [this] (const char* k) { return open ? juce::String (measures[k].isArray() ? measures[k].getArray()->size() : 0) : juce::String ("0"); };
    writeText (g, openIds["edmHits"], count ("hits"));
    writeText (g, openIds["edmLoud"], count ("loud"));
}

void EditFace::drawTabs (juce::Graphics& g)
{
    // The file tabs (`renderTabs`): the open sound's name, and ＋.
    const auto& n = openIds["tabBar"];
    paintTree (g, n.n, {});
    if (open && name.isNotEmpty())
    {
        g.setFont (face::sans (11, 500));
        g.setColour (ink ("--look-text", "#e8eaee"));
        g.drawText (name + (edited ? uni (" \xe2\x80\xa2") : juce::String()), juce::Rectangle<float> (n.r.getRight() + 8, n.r.getY(), 400, n.r.getHeight()), juce::Justification::centredLeft);
    }
}

void EditFace::drawNow (juce::Graphics& g)
{
    auto& ids = nowIds;
    writeText (g, ids["timeNow"], fmtTime ((playing ? head : cue) / sr), juce::Justification::centred);
    writeText (g, ids["nbBpmV"], uni ("\xe2\x80\x94"));
    writeText (g, ids["nbName"], open ? name : name.isNotEmpty() ? name + uni (" \xe2\x80\x94 ") + meta : juce::String ("no sound"));
    if (open)
    {
        // The meta sits after the name, as the page lays it.
        auto r = ids["nbName"].r;
        const float w = juce::GlyphArrangement::getStringWidth (face::font (ids["nbName"].n["text"][0]["font"]), name);
        g.setFont (face::mono (10));
        g.setColour (ink ("--look-text-3", "#858b94"));
        g.drawText (meta, juce::Rectangle<float> (r.getX() + w + 8, r.getY(), 300, r.getHeight()), juce::Justification::centredLeft);
        if (loopOn)
        {
            g.drawText (hasSel ? "selection" : "whole file", juce::Rectangle<float> (r.getX() + w + 70, r.getY(), 200, r.getHeight()), juce::Justification::centredLeft);
        }
    }
    // The meter: falls gently, rises at once (nbPaintMeter).
    auto pc = [] (double db) { return (float) juce::jlimit (0.0, 1.0, (db + 60) / 60); };
    for (auto [k, db] : { std::pair<const char*, float> { "nbMeterL", meterL }, { "nbMeterR", meterR } })
    {
        const auto& m = ids[k];
        const float w = pc (db) * 96;
        if (w > 0)
        {
            juce::var look = m.n;
            if (auto* o = look.getDynamicObject(); o != nullptr && !o->hasProperty ("bg") && !o->hasProperty ("layers"))
                o->setProperty ("bg", juce::Array<juce::var> { 58, 213, 155, 1 });
            face::paintBox (g, look, m.r.withWidth (w));
        }
    }
    // The volume (a range input): its track, and how far up it is (0.85).
    if (ids.count ("volume") > 0)
    {
        const auto r = ids["volume"].r;
        const auto track = juce::Rectangle<float> (r.getX(), r.getCentreY() - 2, r.getWidth(), 4);
        g.setColour (ink ("--look-well", "#06070a"));
        g.fillRoundedRectangle (track, 2);
        g.setColour (ink ("--look-text-2", "#b9bec6"));
        g.fillRoundedRectangle (track.withWidth (r.getWidth() * 0.85f), 2);
        g.setColour (ink ("--look-text", "#e8eaee"));
        g.fillEllipse (juce::Rectangle<float> (10, 10).withCentre ({ r.getX() + r.getWidth() * 0.85f, r.getCentreY() }));
    }
    const float top = std::max (meterL, meterR);
    writeText (g, ids["nbDb"], top > -90 ? fixed (top, 1) + " dB" : uni ("\xe2\x88\x92\xe2\x88\x9e"), juce::Justification::centredRight);
    // Playing, and the loop on: the transport's lit switches, as the page lights them.
    if (playing)
        paintTree (g, litIds["playBtn"].n, { 0, 1052 });
    if (loopOn)
        paintTree (g, litIds["loopBtn"].n, { 0, 1052 });
}

// ─────────────────────────────────────────────────── the overview (416)

namespace
{
const juce::String gsStart = "#8fe388";

void gsLbl (c2d::Context& c, const juce::String& tx, float x, float y, const juce::String& col, const juce::String& bg = "rgba(5,6,9,.78)")
{
    const float tw = c.measureText (tx);
    c.setFill (bg);
    c.fillRect (x - 4, y - 9, tw + 8, 12);
    c.setFill (col);
    c.fillText (tx, x, y);
}
} // namespace

void EditFace::drawOverview (juce::Graphics& gr)
{
    {
        // The zoom's reading (poZoomRo), in its own place beside the strip.
        const double len = frames / sr;
        const bool z = open && poB > poA;
        const double L = z ? std::min (poB - poA, len) : len;
        if (open)
            writeText (gr, openIds["poZoomRo"], z ? fixed (len / L, len / L < 10 ? 1 : 0) + uni ("\xc3\x97") : juce::String ("whole"), juce::Justification::centred);
    }
    const auto& well = openIds["poCanvas"];
    const auto r = well.r;
    juce::Graphics::ScopedSaveState keepIt (gr);
    gr.reduceClipRegion (r.toNearestInt());
    gr.addTransform (juce::AffineTransform::translation (r.getX(), r.getY()));
    const float w = r.getWidth(), h = r.getHeight();
    c2d::Context c (gr, w, h);
    const auto t3 = vars["--look-text-3"].toString().isNotEmpty() ? vars["--look-text-3"].toString() : juce::String ("#858b94");
    const auto t1 = vars["--look-text"].toString().isNotEmpty() ? vars["--look-text"].toString() : juce::String ("#e8eaee");
    const auto acc = vars["--look-accent"].toString().isNotEmpty() ? vars["--look-accent"].toString() : juce::String ("#7cf0d0");
    const auto on = vars["--on"].toString().isNotEmpty() ? vars["--on"].toString() : juce::String ("#ffb547");
    const auto bloom = vars["--look-bloom"].toString().isNotEmpty() ? vars["--look-bloom"].toString() : juce::String ("205,225,255");
    c.font = "11px sans-serif";
    // The zoom's reading, beside it.
    const double len = frames / sr;
    const bool zoomed = open && poB > poA;
    double va = 0, vb = 1;
    if (open)
    {
        if (zoomed)
        {
            const double L = std::min (poB - poA, len);
            va = juce::jlimit (0.0, len - L, poA);
            vb = va + L;
        }
        else
            vb = len;
    }
    if (!open || ovCols <= 0)
    {
        c.setFill (t3);
        c.fillText (open ? "Reading the sound…" : "Open a sound", 16, std::min (24.0f, h / 2 + 4));
        return;
    }
    const float W = w - 12;
    auto X = [&] (double s) { return (float) (6 + (s - va) / (vb - va) * W); };
    const double la = hasSel && selB > selA ? selA / sr : 0, lb = hasSel && selB > selA ? selB / sr : len;
    const float bot = h - 13, mid = (bot + 4) / 2, A = (bot - 8) / 2;
    // The loudest of the whole sound, to scale by.
    float pk = 0.001f;
    for (int i = 0; i < ovCols; ++i)
        pk = std::max ({ pk, std::abs (overview[(size_t) i]), std::abs (overview[(size_t) (ovCols + i)]) });
    c.save();
    c.beginPath();
    c.rect (4, 0, w - 8, h);
    c.clip();
    // The detail at the strip's width while zoomed (poDetailWant).
    std::vector<float> det;
    int detCols = 0;
    if (zoomed)
    {
        const int cols = std::max (200, (int) std::round (w - 12));
        std::vector<uint64_t> info (3);
        det.resize ((size_t) cols * 3 * 8);
        detCols = (int) call ([&] (NaApp* a) -> int64_t { return na_edit_peaks (a, id, (uint64_t) std::floor (va * sr), (uint64_t) std::ceil (vb * sr), (uint32_t) cols, det.data(), (uint32_t) det.size(), info.data()); });
    }
    std::vector<float> lit ((size_t) W * 3);
    const bool coloured = measured && call ([&] (NaApp* a) -> int64_t { return na_edit_colours (a, id, va * sr, vb * sr, (uint32_t) W, lit.data()); }) == 1;
    c.setFill ("rgba(" + bloom + ",.3)");
    for (int x = 0; x < (int) W; ++x)
    {
        const double u0 = va + (vb - va) * x / W, u1 = va + (vb - va) * (x + 1) / W;
        // poPeakIn: the loudest of the peaks between two times.
        auto peakIn = [&] (const std::vector<float>& p, int n, double from, double to) {
            const double k = n / std::max (1.0, to - from);
            const int i0 = std::max (0, (int) std::floor ((u0 * sr - from) * k)), i1 = std::min (n, std::max (i0 + 1, (int) std::ceil ((u1 * sr - from) * k)));
            float m = 0;
            for (int i = i0; i < i1; ++i)
                m = std::max ({ m, std::abs (p[(size_t) i]), std::abs (p[(size_t) (n + i)]) });
            return m;
        };
        const float m = std::min (1.0f, (detCols > 0 ? peakIn (det, detCols, std::floor (va * sr), std::ceil (vb * sr)) : peakIn (overview, ovCols, 0, frames)) / pk) * A;
        if (coloured)
            c.fillStyle = juce::Colour ((juce::uint8) lit[(size_t) x * 3], (juce::uint8) lit[(size_t) x * 3 + 1], (juce::uint8) lit[(size_t) x * 3 + 2]).withAlpha (0.9f);
        c.fillRect (6 + (float) x, mid - m, 1, m * 2);
    }
    // The time, on steps that fit.
    c.font = "9px monospace";
    const double span = vb - va;
    static const double steps[] = { 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300 };
    double st = 600;
    for (auto s : steps)
        if (span / s <= 12)
        {
            st = s;
            break;
        }
    const int dp = st < 0.1 ? 2 : st < 1 ? 1 : 0;
    for (double s = std::ceil (va / st) * st; s < vb; s += st)
    {
        const float x = X (s);
        if (x > w - 84)
            break;
        c.setFill ("rgba(255,255,255,.05)");
        c.fillRect (x, 4, 1, bot - 4);
        c.setFill (t3);
        c.fillText (fixed (s, dp) + " s", x + 3, h - 3);
    }
    c.textAlign = "right";
    c.fillText (zoomed ? fixed (va, 2) + uni ("\xe2\x80\x93") + fixed (vb, 2) + " of " + fixed (len, 1) + " s" : fixed (len, 1) + " s", w - 8, h - 3);
    c.textAlign = "left";
    // The markers and regions (gsDrawAnnotations).
    c.font = "9px monospace";
    if (auto* regions = annotations["regions"].getArray())
        for (const auto& rg : *regions)
        {
            const float x0 = X (dnum (rg["start"]) / sr), x1 = X (dnum (rg["end"]) / sr);
            c.setFill ("rgba(124,240,208,.28)");
            c.fillRect (x0, bot - 9, std::max (1.0f, x1 - x0 - 1), 9);
            const auto label = rg["label"].toString();
            if (x1 - x0 > c.measureText (label) + 6)
            {
                c.setFill (t1);
                c.fillText (label, x0 + 3, bot - 2);
            }
        }
    if (auto* markers = annotations["markers"].getArray())
        for (const auto& m : *markers)
        {
            const float x = X (dnum (m["frame"]) / sr);
            c.setFill (on);
            c.fillRect (x - 0.5f, 4, 1, bot - 4 - 10);
            c.beginPath();
            c.moveTo (x, 4);
            c.lineTo (x + 6, 7);
            c.lineTo (x, 10);
            c.fill();
            if (m["label"].toString().isNotEmpty())
                gsLbl (c, m["label"].toString(), x + 8, 12, on);
        }
    // The loop: outside dimmed, the brackets to drag.
    const float ra = X (la), rb = X (lb);
    c.setFill ("rgba(0,0,0,.45)");
    c.fillRect (4, 0, std::max (0.0f, ra - 4), h);
    c.fillRect (rb, 0, std::max (0.0f, w - 4 - rb), h);
    c.setFill ("rgba(124,240,208,.05)");
    c.fillRect (ra, 0, rb - ra, bot);
    // The lane's detail, as a box to drag (poBox).
    if (viewTo > viewFrom && viewTo - viewFrom < frames * 0.999)
    {
        const float x0 = X (viewFrom / sr), x1 = std::max (x0 + 3, X (viewTo / sr));
        c.setFill ("rgba(255,255,255,.07)");
        c.fillRect (x0, 4, x1 - x0, bot - 4);
        c.save();
        c.setStroke (t1);
        c.globalAlpha = 0.7f;
        c.lineWidth = 1;
        c.strokeRect (x0 + 0.5f, 4.5f, x1 - x0 - 1, bot - 5);
        c.restore();
    }
    c.setStroke (acc);
    c.lineWidth = 1.4f;
    c.beginPath();
    c.moveTo (ra, 4);
    c.lineTo (ra, bot);
    c.moveTo (rb, 4);
    c.lineTo (rb, bot);
    c.stroke();
    for (float x : { ra, rb })
    {
        c.setFill (acc);
        c.beginPath();
        c.roundRect (x - 4, 4, 8, 16, 3);
        c.fill();
        c.setFill ("rgba(0,0,0,.5)");
        c.fillRect (x - 1.5f, 7, 1, 10);
        c.fillRect (x + 0.5f, 7, 1, 10);
    }
    c.font = "600 10px monospace";
    // gsRegLabel.
    juce::String what = hasSel && selB > selA ? "Selection" : "Whole file";
    if (auto* regions = annotations["regions"].getArray())
        for (const auto& rg : *regions)
            if (std::abs (dnum (rg["start"]) / sr - la) < 0.01 && std::abs (dnum (rg["end"]) / sr - lb) < 0.01)
                what = rg["label"].toString();
    const auto label = (what + uni (" \xc2\xb7 ") + fixed (la, 2) + uni ("\xe2\x80\x93") + fixed (lb, 2) + " s" + uni (" \xc2\xb7 ") + "LOOP " + fixed (lb - la, 2) + " S").toUpperCase();
    gsLbl (c, label, std::min (std::max (ra + 9, 10.0f), w - 240), 15, acc);
    // Start.
    const float sx = X (cue / sr);
    c.setStroke (gsStart);
    c.lineWidth = 1.4f;
    c.beginPath();
    c.moveTo (sx, 22);
    c.lineTo (sx, bot);
    c.stroke();
    c.setFill (gsStart);
    c.beginPath();
    c.moveTo (sx, 22);
    c.lineTo (sx + 9, 26.5f);
    c.lineTo (sx, 31);
    c.fill();
    c.font = "600 9px monospace";
    if (h >= 56)
        gsLbl (c, "START " + fixed (cue / sr, 2), sx + 12, 30, gsStart);
    if (playing)
    {
        const float hx = X (head / sr);
        c.setFill (t1);
        c.fillRect (hx - 0.75f, 4, 1.5f, bot - 4);
        gsLbl (c, "HEAD", hx + 4, bot - 4, t1);
    }
    c.restore();
    if (zoomed)
    {
        c.setFill ("rgba(255,255,255,.08)");
        c.fillRect (6, 0, W, 3);
        c.setFill (acc);
        c.fillRect (6 + (float) (va / len) * W, 0, std::max (3.0f, (float) (span / len) * W), 3);
    }
}

// ────────────────────────────────────────────────────────────── the bar

bool EditFace::enabled (const juce::String& cmd) const
{
    const bool file = open, sel = file && hasSel && selB > selA;
    if (cmd == "undo")
        return canUndo;
    if (cmd == "redo")
        return canRedo;
    if (cmd == "paste" || cmd == "insertClip")
        return open && clipboard > 0;
    if (cmd == "regionsFromHits")
        return file && measures["hits"].isArray() && measures["hits"].getArray()->size() > 1;
    if (auto* groups = data["groups"].getArray())
        for (const auto& gp : *groups)
            if (auto* items = gp[1].getArray())
                for (const auto& it : *items)
                    if (it["id"].toString() == cmd)
                    {
                        const auto need = it["need"].toString();
                        return need == "sel" ? sel : need == "file" ? file : true;
                    }
    return true;
}

bool EditFace::lit (const juce::String& cmd) const
{
    auto p = [this] (const char* k) { auto it = prefs.find (k); return it != prefs.end() && it->second; };
    if (cmd == "edRainbow") return p ("rainbow");
    if (cmd == "edSpec") return p ("spec");
    if (cmd == "edLevel") return p ("level");
    if (cmd == "edHits") return p ("hits");
    if (cmd == "edLoud") return p ("loud");
    if (cmd == "snapHits") return p ("snapHits");
    if (cmd == "curveEq") return fadeShape != "linear";
    if (cmd == "curveLin") return fadeShape == "linear";
    if (cmd == "snapZero") return snap == "zero";
    if (cmd == "snapCd") return snap == "cd";
    if (cmd == "snapOff") return snap == "off";
    return false;
}

void EditFace::syncBar()
{
    // wtSync: dim what has nothing to act on, light the current choices. The
    // looks are the page's own: a button as it is with nothing open, a lit one,
    // an unlit one.
    const auto litLook = barCmds.count ("snapZero") ? barCmds["snapZero"].i : -1;
    const auto unlitLook = barCmds.count ("cut") ? barCmds["cut"].i : -1;
    for (auto& [cmd, n] : barCmds)
    {
        const bool capturedLit = n.n["data"]["pressed"].isVoid() ? juce::StringArray { "edRainbow", "edSpec", "edLevel", "curveEq", "snapZero" }.contains (cmd) : false;
        const bool capturedOn = !(cmd == "paste" || cmd == "insertClip" || cmd == "regionsFromHits");
        const bool on = enabled (cmd), l = lit (cmd);
        int look = -1;
        if (!on)
            look = emptyCmds.count (cmd) ? emptyCmds[cmd].i : -1;
        else if (l != capturedLit || !capturedOn)
            look = l ? litLook : unlitLook;
        const auto it = barOpen->styleFrom.find (n.i);
        const int was = it == barOpen->styleFrom.end() ? -1 : it->second;
        if (look != was)
        {
            if (look < 0)
                barOpen->styleFrom.erase (n.i);
            else
                barOpen->styleFrom[n.i] = look;
            barOpen->redraw (n.r.expanded (2));
        }
    }
    emptyPage.setVisible (!open);
    openPage.setVisible (open);
    nowbar.setVisible (!open);
    nowbarOpen.setVisible (open);
    barOpen->setVisible (!customizing);
    barEmpty->setVisible (false);
    barCustom->setVisible (customizing);
    for (auto* b : { barOpen.get(), barCustom.get() })
        b->setTopLeftPosition (0, -(int) std::round (barScroll));
    repaintLayer ("barText");
}

juce::String EditFace::commandAt (juce::Point<float> p, bool* more) const
{
    if (!barR.contains (p))
        return {};
    const auto q = p - barR.getPosition() + juce::Point<float> (0, (float) barScroll);
    for (const auto& [cmd, n] : barMore)
        if (n.r.contains (q))
        {
            if (more != nullptr)
                *more = true;
            return cmd;
        }
    for (const auto& [cmd, n] : barCmds)
        if (n.r.contains (q))
        {
            if (more != nullptr)
                *more = false;
            return cmd;
        }
    return {};
}

juce::String EditFace::titleFor (const juce::String& cmd) const
{
    // edTitleFor: its name, its key, what its knobs are set to.
    juce::String nm, key;
    if (auto* groups = data["groups"].getArray())
        for (const auto& gp : *groups)
            if (auto* items = gp[1].getArray())
                for (const auto& it : *items)
                    if (it["id"].toString() == cmd)
                        nm = it["name"].toString(), key = it["key"].toString();
    juce::StringArray set;
    if (auto* ks = data["knobs"][juce::Identifier (cmd)].getArray())
        for (const auto& k : *ks)
        {
            const auto p = k[0].toString();
            const auto v = params.count (p) ? params.at (p) : 0.0;
            set.add (k[1].toString() + " " + fmtFor (p, v));
        }
    juce::StringArray parts { nm };
    if (key.isNotEmpty())
        parts.add (key);
    if (!set.isEmpty())
        parts.add ("(" + set.joinIntoString (", ") + ")");
    return parts.joinIntoString ("  ");
}

// ─────────────────────────────────────────────────────────── the transport

void EditFace::transport (const juce::var& msg)
{
    const auto s = juce::JSON::toString (msg, true);
    call ([this, s] (NaApp* a) -> int64_t { return na_edit_transport (a, id, s.toRawUTF8()); });
}

void EditFace::applyLoop()
{
    // applyLoop (020): the selection if there is one, else the whole sound (0).
    const bool sel = hasSel && selB > selA;
    auto* l = new juce::DynamicObject();
    l->setProperty ("on", loopOn);
    l->setProperty ("a", sel ? selA : 0.0);
    l->setProperty ("b", sel ? selB : 0.0);
    auto* o = new juce::DynamicObject();
    o->setProperty ("loop", juce::var (l));
    transport (juce::var (o));
    repaintLayer ("now");
    repaintLayer ("overview");
}

void EditFace::seek (double frame)
{
    auto* o = new juce::DynamicObject();
    o->setProperty ("seek", std::max (0.0, frame));
    transport (juce::var (o));
    head = std::max (0.0, frame);
}

void EditFace::play()
{
    // playFile: the same sound, so play toggles; from the cue when it starts.
    if (!open)
    {
        say ("Open a sound first");
        return;
    }
    auto* o = new juce::DynamicObject();
    if (playing)
        o->setProperty ("play", false);
    else
    {
        if (!(loopOn && hasSel) && head >= frames - 1)
            o->setProperty ("seek", cue);
        o->setProperty ("play", true);
    }
    playing = !playing;
    transport (juce::var (o));
    repaintLayer ("now");
}

void EditFace::stop()
{
    // Stop returns to the cue.
    auto* o = new juce::DynamicObject();
    o->setProperty ("play", false);
    o->setProperty ("seek", cue);
    transport (juce::var (o));
    playing = false;
    head = cue;
    for (auto n : { "now", "overlay", "overview", "counters" })
        repaintLayer (n);
}

void EditFace::timerCallback()
{
    double out[4] {};
    if (call ([&] (NaApp* a) -> int64_t { return na_edit_position (a, id, out); }) != 0)
        return;
    const bool was = playing;
    const double before = head;
    head = out[0];
    playing = out[1] > 0.5;
    auto db = [] (double p) { return p > 1e-6 ? 20 * std::log10 (p) : -120.0; };
    const float l = (float) db (out[2]), r = (float) db (out[3]);
    // A VU: rises at once, falls 3 dB a tick (nbPaintMeter).
    meterL = l > meterL ? l : std::max (l, meterL - 3);
    meterR = r > meterR ? r : std::max (r, meterR - 3);
    // Follow, scrolling (followPlayhead): the head kept in the middle while zoomed in.
    if (playing && open && viewTo - viewFrom < frames && (head < viewFrom || head >= viewTo || true))
    {
        const double span = viewTo - viewFrom;
        double a = std::max (0.0, std::min (frames - span, std::round (head - span / 2)));
        if (std::abs (a - viewFrom) >= 1)
        {
            viewFrom = a;
            viewTo = a + span;
            loadPeaks();
            loadSpectrogram();
        }
    }
    if (std::abs (head - before) > 0 || playing != was || meterL > -119 || meterR > -119)
        for (auto n : { "now", "overlay", "overview", "counters" })
            repaintLayer (n);
    // The sound changed elsewhere, or was measured.
    static int tick = 0;
    if (++tick % 3 == 0)
    {
        const auto serial0 = serial;
        const bool o0 = open;
        readSound();
        if (serial != serial0 || open != o0)
        {
            syncBar();
            for (auto& ly : layers)
                ly->repaint();
        }
    }
}

// ──────────────────────────────────────────────────────────── the commands

void EditFace::say (const juce::String& s)
{
    if (onMessage)
        onMessage (s);
}

bool EditFace::needSel()
{
    if (!open)
    {
        say ("Open a sound first");
        return false;
    }
    if (!hasSel || selB - selA < 1)
    {
        say ("Select a range first");
        return false;
    }
    return true;
}

std::pair<double, double> EditFace::selOrCue() const
{
    if (hasSel && selB > selA)
        return { selA, selB };
    return { cue, cue };
}

juce::var EditFace::edit (juce::var body, bool snapIt)
{
    // editCmd (300) and editOp (060).
    if (!open)
        return {};
    const auto op = body["op"].toString();
    if (snapIt && snappable.contains (op) && snap != "off")
        body.getDynamicObject()->setProperty ("snap", snap);
    const double askedA = dnum (body["start"]), askedB = dnum (body["end"]);
    const auto text = juce::JSON::toString (body, true);
    juce::String err;
    const auto out = juce::String (call ([&] (NaApp* a) -> int64_t {
        std::vector<char> buf (1 << 18);
        int32_t n = na_edit_op (a, id, text.toRawUTF8(), buf.data(), (uint32_t) buf.size());
        if (n < 0)
        {
            char e[512] {};
            na_error (a, e, sizeof e);
            err = juce::String::fromUTF8 (e);
            return n;
        }
        if (n >= (int32_t) buf.size())
            n = (int32_t) buf.size() - 1;
        infoText = juce::String::fromUTF8 (buf.data(), n);
        return 0;
    }) == 0 ? infoText : juce::String());
    if (err.isNotEmpty() || out.isEmpty())
    {
        say (err.isNotEmpty() ? err : juce::String ("The edit did not take"));
        return {};
    }
    const auto answer = juce::JSON::parse (out);
    afterEdit (body, answer);
    const auto s = answer["snapped"];
    if (s.isObject())
    {
        const double moved2 = std::abs (dnum (s["start"]) - askedA) + std::abs (dnum (s["end"]) - askedB);
        if (moved2 > 0)
            say ("Snapped to " + (s["unit"].toString() == "zero" ? juce::String ("zero crossings") : s["unit"].toString().toUpperCase()) + uni (" \xe2\x80\x94 moved ") + juce::String ((int64_t) moved2) + " sample" + (moved2 < 1.5 ? "" : "s"));
    }
    return answer;
}

void EditFace::afterEdit (const juce::var& body, const juce::var& answer)
{
    const auto op = body["op"].toString();
    canUndo = (bool) answer["canUndo"];
    canRedo = (bool) answer["canRedo"];
    clipboard = dnum (answer["clipboard"]);
    const double nframes = dnum (answer["frames"], frames);
    if (structural.contains (op))
    {
        hasSel = false;
        frames = nframes;
        refit();
    }
    else if (hasSel)
    {
        selA = std::min (selA, nframes);
        selB = std::min (selB, nframes);
        if (selB - selA < 2)
            hasSel = false;
    }
    readSound();
    applyLoop();
    syncBar();
    keep();
    for (auto& l : layers)
        l->repaint();
}

void EditFace::annot (const juce::var& body)
{
    if (!open)
    {
        say ("Open a sound first");
        return;
    }
    const auto text = juce::JSON::toString (body, true);
    call ([&] (NaApp* a) -> int64_t {
        std::vector<char> buf (1 << 18);
        return na_edit_annot (a, id, text.toRawUTF8(), buf.data(), (uint32_t) buf.size());
    });
    readSound();
    repaintLayer ("overview");
}

namespace
{
juce::var obj (std::initializer_list<std::pair<const char*, juce::var>> kv)
{
    auto* o = new juce::DynamicObject();
    for (const auto& [k, v] : kv)
        o->setProperty (k, v);
    return juce::var (o);
}
} // namespace

void EditFace::zoom (double factor)
{
    if (frames <= 0)
        return;
    const double centre = (viewFrom + viewTo) / 2;
    double span = (viewTo - viewFrom) / factor;
    span = std::max (8.0, std::min (span, frames));
    const double b = std::min (frames, std::round (centre + span / 2));
    const double a = std::max (0.0, b - std::round (span));
    viewFrom = a;
    viewTo = b;
    loadPeaks();
    loadSpectrogram();
    keep();
    repaintLayer ("overview");
    repaintLayer ("counters");
}

void EditFace::centreOn (double frame)
{
    const double span = viewTo - viewFrom;
    if (frames <= 0 || span <= 0 || span >= frames || (frame >= viewFrom && frame < viewTo))
        return;
    viewFrom = std::max (0.0, std::min (frames - span, std::round (frame - span / 2)));
    viewTo = viewFrom + span;
    loadPeaks();
    loadSpectrogram();
}

void EditFace::fitSelection()
{
    if (!needSel())
        return;
    const double pad = std::max (1.0, std::round ((selB - selA) * 0.02));
    viewFrom = std::max (0.0, selA - pad);
    viewTo = std::min (frames, selB + pad);
    loadPeaks();
    loadSpectrogram();
    keep();
}

void EditFace::zoomToSample (bool end)
{
    if (frames <= 0)
        return;
    const double at = hasSel ? (end ? selB : selA) : cue;
    viewFrom = std::max (0.0, std::min (frames - 8, std::round (at - 4)));
    viewTo = viewFrom + 8;
    loadPeaks();
    loadSpectrogram();
    keep();
}

void EditFace::setSnap (const juce::String& unit)
{
    snap = unit;
    syncBar();
    keep();
    say (unit == "off" ? juce::String ("Snap off") : "Snapping to " + (unit == "zero" ? juce::String ("zero crossings") : unit.toUpperCase()));
}

void EditFace::toggle (const juce::String& k)
{
    prefs[k] = !prefs[k];
    if (k == "spec")
        loadSpectrogram();
    syncBar();
    keep();
    repaintLayer ("wave");
}

void EditFace::exportWav()
{
    if (!open)
        return;
    auto chooser = std::make_shared<juce::FileChooser> ("Export the edited sound", juce::File::getSpecialLocation (juce::File::userDocumentsDirectory).getChildFile (juce::File::createLegalFileName (name).upToLastOccurrenceOf (".", false, false) + " edit.wav"), "*.wav");
    juce::Component::SafePointer<EditFace> safe (this);
    chooser->launchAsync (juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::warnAboutOverwriting, [safe, chooser] (const juce::FileChooser& fc) {
        if (safe == nullptr || fc.getResult() == juce::File())
            return;
        const auto path = fc.getResult().getFullPathName();
        const int bits = safe->exportBits;
        const auto n = safe->call ([&] (NaApp* a) -> int64_t { return na_edit_export (a, safe->id, path.toRawUTF8(), (uint32_t) bits); });
        safe->say (n > 0 ? "Exported " + juce::String (safe->frames / safe->sr, 2) + "s, " + juce::String (bits == 32 ? "32-bit float" : juce::String (bits) + "-bit") + uni (" WAV \xe2\x80\x94 ") + fc.getResult().getFileName()
                         : juce::String ("Export failed"));
    });
}

void EditFace::addMarker()
{
    if (!open)
        return;
    const double frame = hasSel ? selA : std::round (playing ? head : cue);
    const int n = annotations["markers"].isArray() ? annotations["markers"].getArray()->size() : 0;
    auto* w = new juce::AlertWindow ("Marker name:", {}, juce::MessageBoxIconType::NoIcon);
    w->addTextEditor ("name", "m" + juce::String (n + 1));
    w->addButton ("OK", 1, juce::KeyPress (juce::KeyPress::returnKey));
    w->addButton ("Cancel", 0, juce::KeyPress (juce::KeyPress::escapeKey));
    juce::Component::SafePointer<EditFace> safe (this);
    w->enterModalState (true, juce::ModalCallbackFunction::create ([safe, w, frame] (int r) {
        if (safe == nullptr || r != 1)
            return;
        auto a = safe->annotations.isObject() ? safe->annotations : obj ({ { "markers", juce::Array<juce::var>() }, { "regions", juce::Array<juce::var>() } });
        juce::Array<juce::var> ms;
        if (auto* m = a["markers"].getArray())
            ms = *m;
        ms.add (obj ({ { "frame", frame }, { "label", w->getTextEditorContents ("name") } }));
        safe->annot (obj ({ { "op", "set" }, { "markers", ms }, { "regions", a["regions"] } }));
    }), true);
}

void EditFace::addRegion()
{
    if (!hasSel)
    {
        say ("Select a range first");
        return;
    }
    const int n = annotations["regions"].isArray() ? annotations["regions"].getArray()->size() : 0;
    auto* w = new juce::AlertWindow ("Region name:", {}, juce::MessageBoxIconType::NoIcon);
    w->addTextEditor ("name", "r" + juce::String (n + 1));
    w->addButton ("OK", 1, juce::KeyPress (juce::KeyPress::returnKey));
    w->addButton ("Cancel", 0, juce::KeyPress (juce::KeyPress::escapeKey));
    juce::Component::SafePointer<EditFace> safe (this);
    const double a0 = selA, b0 = selB;
    w->enterModalState (true, juce::ModalCallbackFunction::create ([safe, w, a0, b0] (int r) {
        if (safe == nullptr || r != 1)
            return;
        auto a = safe->annotations;
        juce::Array<juce::var> rs;
        if (auto* m = a["regions"].getArray())
            rs = *m;
        rs.add (obj ({ { "start", a0 }, { "end", b0 }, { "label", w->getTextEditorContents ("name") } }));
        safe->annot (obj ({ { "op", "set" }, { "markers", a["markers"] }, { "regions", rs } }));
    }), true);
}

void EditFace::setSelectionDialog()
{
    if (!open)
    {
        say ("Open a sound first");
        return;
    }
    // Peak's Set Selection, as the page asks it.
    auto* w = new juce::AlertWindow ("Set selection", "Start and end are read in the units chosen above. Change the units before typing.", juce::MessageBoxIconType::NoIcon);
    w->addComboBox ("units", { "seconds", "milliseconds", "samples" }, "Units");
    const double a = hasSel ? selA : 0, b = hasSel ? selB : frames;
    w->addTextEditor ("start", juce::String (a / sr, 6), "Start");
    w->addTextEditor ("end", juce::String (b / sr, 6), "End");
    w->addButton ("OK", 1, juce::KeyPress (juce::KeyPress::returnKey));
    w->addButton ("Cancel", 0, juce::KeyPress (juce::KeyPress::escapeKey));
    juce::Component::SafePointer<EditFace> safe (this);
    w->enterModalState (true, juce::ModalCallbackFunction::create ([safe, w] (int r) {
        if (safe == nullptr || r != 1)
            return;
        auto& f = *safe;
        const int u = w->getComboBoxComponent ("units")->getSelectedItemIndex();
        const double scale = u == 2 ? 1 : u == 1 ? f.sr / 1000 : f.sr;
        const double a1 = juce::jlimit (0.0, f.frames, std::round (w->getTextEditorContents ("start").getDoubleValue() * scale));
        const double b1 = juce::jlimit (0.0, f.frames, std::round (w->getTextEditorContents ("end").getDoubleValue() * scale));
        if (b1 <= a1)
        {
            f.say ("The end must come after the start");
            return;
        }
        f.hasSel = true;
        f.selA = a1;
        f.selB = b1;
        f.cue = a1;
        f.applyLoop();
        f.syncBar();
        f.keep();
        for (auto& l : f.layers)
            l->repaint();
    }), true);
}

void EditFace::goTo()
{
    if (!open)
    {
        say ("Open a sound first");
        return;
    }
    // Peak's Go To: a marker, a region, or a time typed.
    juce::StringArray places { "Start of file" };
    std::vector<std::pair<double, double>> where { { 0, -1 } };
    if (hasSel)
    {
        places.add ("Start of selection"), where.push_back ({ selA, -1 });
        places.add ("End of selection"), where.push_back ({ selB, -1 });
    }
    if (auto* ms = annotations["markers"].getArray())
        for (const auto& m : *ms)
            places.add ("Marker: " + (m["label"].toString().isNotEmpty() ? m["label"].toString() : juce::String ("(unnamed)")) + uni (" \xe2\x80\x94 ") + fmtTime (dnum (m["frame"]) / sr)), where.push_back ({ dnum (m["frame"]), -1 });
    if (auto* rs = annotations["regions"].getArray())
        for (const auto& rg : *rs)
            places.add ("Region: " + (rg["label"].toString().isNotEmpty() ? rg["label"].toString() : juce::String ("(unnamed)")) + uni (" \xe2\x80\x94 ") + fmtTime (dnum (rg["start"]) / sr)), where.push_back ({ dnum (rg["start"]), dnum (rg["end"]) });
    places.add (uni ("A time I will type\xe2\x80\xa6"));
    where.push_back ({ -1, -1 });
    auto* w = new juce::AlertWindow ("Go to", uni ("The time field is only read when \xe2\x80\x9c" "A time I will type\xe2\x80\x9d is chosen."), juce::MessageBoxIconType::NoIcon);
    w->addComboBox ("where", places, "Location");
    w->addTextEditor ("seconds", "0", "Time (seconds)");
    w->addButton ("OK", 1, juce::KeyPress (juce::KeyPress::returnKey));
    w->addButton ("Cancel", 0, juce::KeyPress (juce::KeyPress::escapeKey));
    juce::Component::SafePointer<EditFace> safe (this);
    w->enterModalState (true, juce::ModalCallbackFunction::create ([safe, w, where] (int r) {
        if (safe == nullptr || r != 1)
            return;
        auto& f = *safe;
        const auto [fa, fb] = where[(size_t) std::max (0, w->getComboBoxComponent ("where")->getSelectedItemIndex())];
        double frame = fa;
        if (fa < 0)
            frame = std::round (w->getTextEditorContents ("seconds").getDoubleValue() * f.sr);
        if (fb >= 0)
            f.hasSel = true, f.selA = fa, f.selB = fb;
        f.cue = std::max (0.0, frame);
        f.centreOn (f.cue);
        f.keep();
        for (auto& l : f.layers)
            l->repaint();
    }), true);
}

void EditFace::regionsFromHits()
{
    // edRegionsFromHits (412).
    auto* hits = measures["hits"].getArray();
    if (hits == nullptr || hits->size() < 2)
        return;
    const double a = hasSel ? selA : 0, b = hasSel ? selB : frames;
    std::vector<double> pts;
    for (const auto& h : *hits)
        if (dnum (h) >= a && dnum (h) < b)
            pts.push_back (dnum (h));
    pts.push_back (b);
    if (pts.size() < 2)
    {
        say ("No hits in the selection");
        return;
    }
    juce::Array<juce::var> rs;
    if (auto* r = annotations["regions"].getArray())
        rs = *r;
    const int start = rs.size();
    for (size_t i = 0; i + 1 < pts.size(); ++i)
        rs.add (obj ({ { "start", pts[i] }, { "end", pts[i + 1] }, { "label", "hit " + juce::String (start + (int) i + 1) } }));
    annot (obj ({ { "op", "set" }, { "markers", annotations["markers"] }, { "regions", rs } }));
    say (juce::String ((int) pts.size() - 1) + " region" + (pts.size() == 2 ? "" : "s") + ", one per hit");
}

void EditFace::findPeak()
{
    if (!open)
    {
        say ("Open a sound first");
        return;
    }
    const uint64_t a = hasSel ? (uint64_t) selA : 0, b = hasSel ? (uint64_t) selB : 0;
    const auto r = juce::JSON::parse (juce::String (call ([&] (NaApp* ap) -> int64_t {
        std::vector<char> buf (4096);
        const int32_t n = na_edit_measure (ap, id, a, b, buf.data(), (uint32_t) buf.size());
        infoText = n > 0 ? juce::String::fromUTF8 (buf.data(), n) : juce::String();
        return 0;
    }) == 0 ? infoText : juce::String()));
    if (r["peakFrame"].isVoid())
    {
        say ("Nothing to measure");
        return;
    }
    cue = dnum (r["peakFrame"]);
    centreOn (cue);
    say ("Peak " + fixed (dnum (r["peakDb"]), 2) + " dB at " + fmtTime (cue / sr) + (hasSel ? " in the selection" : ""));
    keep();
    for (auto& l : layers)
        l->repaint();
}

void EditFace::run (const juce::String& c)
{
    // edRun: the command, with its knobs' values where it has any.
    auto p = [this] (const char* k) { return params[k]; };
    const auto [sa, sb] = selOrCue();
    const auto opSel = [&] (const char* op) {
        // The edit tools' buttons (060): a selection first, then editCmd.
        if (!open)
            return say ("Open a sound first");
        if (!hasSel)
            return say ("Select a range first");
        auto body = obj ({ { "op", op }, { "start", selA }, { "end", selB } });
        if (juce::String (op) == "fadeIn" || juce::String (op) == "fadeOut")
        {
            body.getDynamicObject()->setProperty ("frames", selB - selA);
            body.getDynamicObject()->setProperty ("shape", fadeShape);
        }
        edit (body, true);
    };
    if (c == "edRainbow") toggle ("rainbow");
    else if (c == "edSpec") toggle ("spec");
    else if (c == "edLevel") toggle ("level");
    else if (c == "edHits") toggle ("hits");
    else if (c == "edLoud") toggle ("loud");
    else if (c == "snapHits") toggle ("snapHits");
    else if (c == "undo" || c == "redo" || c == "revert") edit (obj ({ { "op", c } }), false);
    else if (c == "cut" || c == "crop" || c == "silence" || c == "fadeIn" || c == "fadeOut" || c == "reverse")
        opSel (c.toRawUTF8());
    else if (c == "copy")
    {
        if (!needSel())
            return;
        edit (obj ({ { "op", "copy" }, { "start", selA }, { "end", selB } }), true);
        if (clipboard > 0)
            say ("Copied " + fmtTime (clipboard / sr));
    }
    else if (c == "paste" || c == "insertClip")
    {
        if (!open)
            return say ("Open a sound first");
        if (clipboard <= 0)
            return say ("Copy or cut something in this sound first");
        const double at = sa;
        edit (c == "paste" ? obj ({ { "op", "paste" }, { "start", sa }, { "end", sb } }) : obj ({ { "op", "paste" }, { "start", at }, { "end", at } }), true);
        if (c == "insertClip")
            say ("Inserted " + fmtTime (clipboard / sr) + " at " + fmtTime (at / sr));
    }
    else if (c == "delete")
    {
        if (needSel())
            edit (obj ({ { "op", "delete" }, { "start", selA }, { "end", selB } }), true);
    }
    else if (c == "duplicate")
    {
        if (needSel())
            edit (obj ({ { "op", "duplicate" }, { "start", selA }, { "end", selB }, { "count", p ("dupCount") } }), true);
    }
    else if (c == "insertSilence")
    {
        if (!open)
            return say ("Open a sound first");
        const double at = hasSel ? selA : cue;
        edit (obj ({ { "op", "insertSilence" }, { "start", at }, { "end", at }, { "ms", p ("insMs") } }), true);
    }
    else if (c == "stripSilence")
    {
        if (!open)
            return say ("Open a sound first");
        const double before = frames;
        edit (obj ({ { "op", "stripSilence" }, { "start", hasSel ? selA : 0.0 }, { "end", hasSel ? selB : 0.0 }, { "thresholdDb", p ("thr") }, { "minMs", p ("minMs") }, { "padMs", p ("padMs") }, { "mode", "remove" } }), false);
        say (std::abs (before - frames) < 0.5 ? juce::String ("No silence found at that threshold") : "Removed " + fixed ((before - frames) / sr, 2) + "s");
    }
    else if (c == "curveEq" || c == "curveLin")
    {
        fadeShape = c == "curveLin" ? "linear" : "equalPower";
        syncBar();
        keep();
        repaintLayer ("overlay");
    }
    else if (c == "gain")
    {
        if (!open)
            return say ("Open a sound first");
        const bool whole = !(hasSel && selB > selA);
        edit (obj ({ { "op", "gain" }, { "db", p ("gainDb") }, { "start", whole ? 0.0 : selA }, { "end", whole ? frames : selB } }), false);
    }
    else if (c == "normalize")
    {
        if (!open)
            return say ("Open a sound first");
        edit (obj ({ { "op", "normalize" }, { "db", p ("normDb") } }), false);
        say ("Normalized to " + juce::String (p ("normDb")) + " dB");
    }
    else if (c == "normalizeRms")
    {
        if (!open)
            return say ("Open a sound first");
        auto level = [this] {
            return juce::JSON::parse (juce::String (call ([this] (NaApp* a) -> int64_t {
                std::vector<char> buf (4096);
                const int32_t n = na_edit_measure (a, id, 0, 0, buf.data(), (uint32_t) buf.size());
                infoText = n > 0 ? juce::String::fromUTF8 (buf.data(), n) : juce::String();
                return 0;
            }) == 0 ? infoText : juce::String()));
        };
        const auto r0 = level();
        edit (obj ({ { "op", "normalizeRms" }, { "db", p ("rmsDb") }, { "ceilingDb", p ("ceilDb") } }), false);
        const auto r1 = level();
        if (r0.isObject() && r1.isObject())
            say ("RMS " + fixed (dnum (r0["rmsDb"]), 1) + uni (" \xe2\x86\x92 ") + fixed (dnum (r1["rmsDb"]), 1) + " dB, peak " + fixed (dnum (r1["peakDb"]), 1) + " dB");
    }
    else if (c == "findPeak") findPeak();
    else if (c == "repairClick")
    {
        if (!needSel())
            return;
        const double before = frames;
        edit (obj ({ { "op", "repairClick" }, { "start", selA }, { "end", selB }, { "widthMs", p ("widthMs") } }), false);
        const double gone = before - frames;
        say (gone > 0 ? uni ("Repaired \xe2\x80\x94 ") + juce::String ((int64_t) gone) + " samples removed" : juce::String ("No click found in the selection"));
    }
    else if (c == "selectAll")
    {
        if (frames > 0)
            hasSel = true, selA = 0, selB = frames, applyLoop();
    }
    else if (c == "deselect") hasSel = false, applyLoop();
    else if (c == "setSelection") setSelectionDialog();
    else if (c == "goTo") goTo();
    else if (c == "zoomIn") zoom (2);
    else if (c == "zoomOut") zoom (0.5);
    else if (c == "fit") { refit(); loadPeaks(); loadSpectrogram(); keep(); }
    else if (c == "fitSel") fitSelection();
    else if (c == "sample") zoomToSample (false);
    else if (c == "marker") addMarker();
    else if (c == "region") addRegion();
    else if (c == "splitRegion")
    {
        const int was = annotations["regions"].isArray() ? annotations["regions"].getArray()->size() : 0;
        annot (obj ({ { "op", "splitRegion" }, { "pos", hasSel ? selA : cue } }));
        const int now = annotations["regions"].isArray() ? annotations["regions"].getArray()->size() : 0;
        say (now > was ? juce::String ("Split") : uni ("Nothing to split at the cursor \xe2\x80\x94 put it inside a region, or somewhere other than the very start"));
    }
    else if (c == "markersToRegions")
    {
        annot (obj ({ { "op", "markersToRegions" }, { "start", hasSel ? selA : 0.0 }, { "end", hasSel ? selB : 0.0 }, { "each", false } }));
        const int n = annotations["regions"].isArray() ? annotations["regions"].getArray()->size() : 0;
        say (juce::String (n) + " region" + (n == 1 ? "" : "s"));
    }
    else if (c == "regionsFromHits") regionsFromHits();
    else if (c == "snapZero") setSnap ("zero");
    else if (c == "snapCd") setSnap ("cd");
    else if (c == "snapOff") setSnap ("off");
    else if (c == "export") exportWav();
    else if (c == "video") say ("The video export comes with the Visual module");
    else if (c == "wtEdit") customizing = true;
    else if (c == "wtDone") customizing = false;
    else if (c == "wtReset") barScroll = 0;
    syncBar();
    keep();
    for (auto& l : layers)
        l->repaint();
}

// ──────────────────────────────────────────────────────────── the pop-ups

namespace
{
// A colour an SVG element of `cls` was drawn with (`attr`: "stroke" or "fill").
juce::Colour svgColour (const juce::String& svg, const juce::String& cls, const char* attr, juce::Colour fallback)
{
    const int at = svg.indexOf ("class=\"" + cls + "\"");
    if (at < 0)
        return fallback;
    const auto tag = svg.substring (at, svg.indexOfChar (at, '>'));
    const auto key = juce::String (" ") + attr + "=\"";
    const int k = tag.indexOf (key);
    if (k < 0)
        return fallback;
    const auto v = tag.substring (k + key.length(), tag.indexOfChar (k + key.length(), '"'));
    auto c = c2d::css (v);
    const int o = tag.indexOf (" opacity=\"");
    if (o >= 0)
        c = c.withMultipliedAlpha (tag.substring (o + 10, tag.indexOfChar (o + 10, '"')).getFloatValue());
    return c;
}

// ED_GLYPH (412): what each setting does, drawn from its value (0 to 1).
std::pair<juce::String, juce::String> glyph (const juce::String& key, double n)
{
    auto r = [] (double x) { return juce::String (x, 1); };
    juce::String a, f;
    if (key == "gainDb")
    {
        const double k = 0.2 + n * 1.6;
        for (int i = 0; i <= 20; ++i)
            a << (i ? "L" : "M") << juce::String (1 + i) << " " << r (8 - std::sin (i / 20.0 * juce::MathConstants<double>::pi * 4) * std::min (7.0, 3.5 * k));
        f = "M1 1H21M1 15H21";
    }
    else if (key == "normDb")
    {
        const double y = 8 - n * 7;
        f = "M1 " + r (y) + "H21M1 " + r (16 - y) + "H21";
        a = "M1 8L4 " + r (y) + "L6 " + r (16 - y) + "L9 5L11 11L14 " + r (y) + "L16 " + r (16 - y) + "L21 8";
    }
    else if (key == "rmsDb")
    {
        const double h = 1 + n * 6;
        f = "M1 1H21M1 15H21";
        a = "M2 " + r (8 - h) + "H20V" + r (8 + h) + "H2Z";
    }
    else if (key == "ceilDb")
    {
        const double y = 7.5 - n * 6.5;
        a = "M1 " + r (y) + "H21";
        f = "M1 8L4 3L6 13L9 5L11 11L14 4L16 12L21 8";
    }
    else if (key == "thr")
    {
        const double y = 8 - n * 6;
        f = "M1 " + r (y) + "H21";
        a = "M1 8L3 2L5 14L7 8H14L16 4L18 12L21 8";
    }
    else if (key == "minMs")
    {
        const double w = 2 + n * 12;
        a = "M1 8L3 3L5 13L6 8H" + r (6 + w) + "L" + r (8 + w) + " 3L" + r (10 + w) + " 13L21 8";
        f = "M6 15H" + r (6 + w);
    }
    else if (key == "padMs")
    {
        const double w = 1 + n * 5;
        f = "M8 8H14";
        a = "M" + r (8 - w) + " 3V13M" + r (14 + w) + " 3V13";
    }
    else if (key == "insMs")
    {
        const double w = 2 + n * 14;
        a = "M1 8H" + r (11 - w / 2) + "M" + r (11 + w / 2) + " 8H21";
        f = "M" + r (11 - w / 2) + " 3V13M" + r (11 + w / 2) + " 3V13";
    }
    else if (key == "widthMs")
        a = "M1 9C4 6 6 12 9 9L10 " + r (9 - (1 - n) * 7) + "L11 " + r (9 + (1 - n) * 5) + "L12 9C15 6 17 12 21 9";
    else if (key == "dupCount")
    {
        const int k = 1 + (int) std::round (n * 4);
        for (int i = 0; i < k; ++i)
            a << "M" << r (2 + i * (18.0 / k)) << " 4h" << r (18.0 / k - 1.5) << "v8h-" << r (18.0 / k - 1.5) << "Z";
    }
    return { a, f };
}

struct KnobSpec
{
    juce::String param, label;
    double min = 0, max = 1, step = 0, def = 0;
    bool log = false;
};

double knobPos (const KnobSpec& k, double v)
{
    return juce::jlimit (0.0, 1.0, k.log ? std::log (std::max (v, k.min) / k.min) / std::log (k.max / k.min) : (v - k.min) / (k.max - k.min));
}
double knobVal (const KnobSpec& k, double t) { return k.log ? k.min * std::pow (k.max / k.min, t) : k.min + t * (k.max - k.min); }

// The settings behind a command's ▾ (edKnobsOpen): its knobs and the command.
struct KnobPop final : public juce::Component
{
    juce::var tree;
    std::vector<KnobSpec> specs;
    std::map<juce::String, double>* params = nullptr;
    std::function<void()> changed, runIt;
    bool canRun = true;
    std::vector<juce::Rectangle<float>> knobR, valueR;
    std::vector<juce::var> knobN;
    juce::Rectangle<float> runR;
    int turning = -1;
    float lastY = 0;
    double pos = 0;

    KnobPop (const juce::var& t, std::vector<KnobSpec> s, std::map<juce::String, double>* p) : tree (t), specs (std::move (s)), params (p)
    {
        const auto r = rectOf (tree["rect"]);
        setSize ((int) r.getWidth(), (int) r.getHeight());
        if (auto* kids = tree["kids"].getArray())
            for (const auto& k : *kids)
            {
                if (hasClass (k, "knob"))
                    knobN.push_back (k), knobR.push_back (rectOf (k["rect"]));
                if (hasClass (k, "ed-krun"))
                    runR = rectOf (k["rect"]);
            }
    }

    void paint (juce::Graphics& g) override
    {
        face::paintBox (g, tree, rectOf (tree["rect"]));
        for (size_t i = 0; i < knobN.size() && i < specs.size(); ++i)
        {
            const auto& kn = knobN[i];
            const auto& spec = specs[i];
            const double v = (*params)[spec.param], t = knobPos (spec, v);
            face::paintBox (g, kn, knobR[i]);
            if (auto* kids = kn["kids"].getArray())
                for (const auto& k : *kids)
                {
                    const auto r = rectOf (k["rect"]);
                    if (k["svg"].isString() && hasClass (k, "gl"))
                    {
                        const auto svg = k["svg"].toString();
                        const auto [a, f] = glyph (spec.param, t);
                        const auto tr = juce::AffineTransform::scale (r.getWidth() / 22.0f, r.getHeight() / 16.0f).translated (r.getX(), r.getY());
                        if (f.isNotEmpty())
                        {
                            auto p = juce::Drawable::parseSVGPath (f);
                            g.setColour (svgColour (svg, "f", "stroke", juce::Colours::grey));
                            g.strokePath (p, juce::PathStrokeType (1.0f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded), tr);
                        }
                        auto p = juce::Drawable::parseSVGPath (a);
                        g.setColour (svgColour (svg, "a", "stroke", juce::Colours::white));
                        g.strokePath (p, juce::PathStrokeType (1.4f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded), tr);
                    }
                    else if (k["svg"].isString())
                    {
                        // The knob (072): bezel, cap, the track and the arc, the pointer.
                        const auto svg = k["svg"].toString();
                        const float s = r.getWidth() / 44.0f;
                        auto at = [&] (double u) {
                            const double ang = juce::MathConstants<double>::pi * 0.75 + juce::MathConstants<double>::pi * 1.5 * u;
                            return juce::Point<float> ((float) (22 - 15 * std::cos (ang - juce::MathConstants<double>::halfPi)), (float) (22 - 15 * std::sin (ang - juce::MathConstants<double>::halfPi)));
                        };
                        auto arc = [&] (double from, double to) {
                            juce::Path p;
                            const int n = 48;
                            for (int j = 0; j <= n; ++j)
                            {
                                const auto q = at (from + (to - from) * j / n);
                                j == 0 ? p.startNewSubPath (q) : p.lineTo (q);
                            }
                            return p;
                        };
                        const auto tr = juce::AffineTransform::scale (s).translated (r.getX(), r.getY());
                        g.setColour (svgColour (svg, "bezel", "stroke", juce::Colours::black));
                        g.drawEllipse (juce::Rectangle<float> (9, 9, 26, 26).transformedBy (tr), s);
                        g.setColour (svgColour (svg, "cap", "fill", juce::Colours::darkgrey));
                        g.fillEllipse (juce::Rectangle<float> (11.5f, 11.5f, 21, 21).transformedBy (tr));
                        g.setColour (svgColour (svg, "cap", "stroke", juce::Colours::transparentBlack));
                        g.drawEllipse (juce::Rectangle<float> (11.5f, 11.5f, 21, 21).transformedBy (tr), s);
                        g.setColour (svgColour (svg, "track", "stroke", juce::Colours::white.withAlpha (0.1f)));
                        g.strokePath (arc (0, 1), juce::PathStrokeType (3, juce::PathStrokeType::curved, juce::PathStrokeType::rounded), tr);
                        if (t > 0.001)
                        {
                            g.setColour (svgColour (svg, "arc", "stroke", juce::Colours::white));
                            g.strokePath (arc (0, t), juce::PathStrokeType (3, juce::PathStrokeType::curved, juce::PathStrokeType::rounded), tr);
                        }
                        const auto q = at (t);
                        g.setColour (svgColour (svg, "ptr", "stroke", juce::Colours::white));
                        g.drawLine (juce::Line<float> (juce::Point<float> (22, 22), juce::Point<float> (22 + (q.x - 22) * 0.72f, 22 + (q.y - 22) * 0.72f)).toFloat().withShortenedStart (0).withShortenedEnd (0), 1.5f * s);
                        juce::ignoreUnused (tr);
                    }
                    else if (hasClass (k, "v"))
                        face::paintText (g, k, r, fmtFor (spec.param, v), juce::Justification::centred);
                    else
                        face::paintText (g, k, r, k["text"][0]["text"].toString(), juce::Justification::centred);
                }
        }
        if (auto* kids = tree["kids"].getArray())
            for (const auto& k : *kids)
                if (hasClass (k, "ed-krun"))
                {
                    juce::Graphics::ScopedSaveState s (g);
                    if (!canRun)
                        g.beginTransparencyLayer (0.4f);
                    paintTree (g, k, {});
                    if (!canRun)
                        g.endTransparencyLayer();
                }
    }

    int knobAt (juce::Point<float> p) const
    {
        for (size_t i = 0; i < knobR.size(); ++i)
            if (knobR[i].contains (p))
                return (int) i;
        return -1;
    }
    void mouseDown (const juce::MouseEvent& e) override
    {
        turning = knobAt (e.position);
        if (turning >= 0 && turning < (int) specs.size())
        {
            lastY = e.position.y;
            pos = knobPos (specs[(size_t) turning], (*params)[specs[(size_t) turning].param]);
        }
        else if (runR.contains (e.position) && canRun && runIt)
            runIt();
    }
    void mouseDrag (const juce::MouseEvent& e) override
    {
        if (turning < 0 || turning >= (int) specs.size())
            return;
        // A full turn is 160 pixels; Shift is fine.
        const double fine = e.mods.isShiftDown() ? 0.2 : 1;
        pos = juce::jlimit (0.0, 1.0, pos + ((lastY - e.position.y) / 160.0) * fine);
        lastY = e.position.y;
        const auto& s = specs[(size_t) turning];
        const double v = knobVal (s, pos);
        (*params)[s.param] = s.step > 0 ? std::round (v / s.step) * s.step : v;
        repaint();
    }
    void mouseUp (const juce::MouseEvent&) override
    {
        if (turning >= 0 && changed)
            changed();
        turning = -1;
    }
    void mouseDoubleClick (const juce::MouseEvent& e) override
    {
        const int k = knobAt (e.position);
        if (k >= 0 && k < (int) specs.size())
        {
            (*params)[specs[(size_t) k].param] = specs[(size_t) k].def;
            repaint();
            if (changed)
                changed();
        }
    }
    void mouseWheelMove (const juce::MouseEvent& e, const juce::MouseWheelDetails& w) override
    {
        const int k = knobAt (e.position);
        if (k < 0 || k >= (int) specs.size())
            return;
        const auto& s = specs[(size_t) k];
        const double fine = e.mods.isShiftDown() ? 0.2 : 1;
        const double t = juce::jlimit (0.0, 1.0, knobPos (s, (*params)[s.param]) + (w.deltaY > 0 ? 1 : -1) * 0.03 * fine);
        const double v = knobVal (s, t);
        (*params)[s.param] = s.step > 0 ? std::round (v / s.step) * s.step : v;
        repaint();
        if (changed)
            changed();
    }
};

// The pie round the pointer (415): eight commands, ⌘K in its middle.
struct PiePop final : public juce::Component
{
    juce::var tree;
    std::function<bool (const juce::String&)> ok;
    std::function<void (const juce::String&)> pick;
    PiePop (const juce::var& t) : tree (t) { setSize (260, 220); }
    juce::Point<float> centre() const { return { 130, 110 }; }
    void paint (juce::Graphics& g) override
    {
        if (auto* kids = tree["kids"].getArray())
            for (const auto& k : *kids)
            {
                const auto cmd = dataOf (k, "cmd");
                juce::Graphics::ScopedSaveState s (g);
                const bool on = cmd.isEmpty() || ok (cmd);
                if (!on)
                    g.beginTransparencyLayer (0.4f);
                paintTree (g, k, centre());
                if (!on)
                    g.endTransparencyLayer();
            }
    }
    void mouseDown (const juce::MouseEvent& e) override
    {
        if (auto* kids = tree["kids"].getArray())
            for (const auto& k : *kids)
                if ((rectOf (k["rect"]) + centre()).contains (e.position))
                {
                    const auto cmd = dataOf (k, "cmd");
                    if (cmd.isEmpty())
                        return pick ("*");
                    if (ok (cmd))
                        return pick (cmd);
                }
    }
};

// ⌘K (415): every command by name, its section and its key.
struct CmdPop final : public juce::Component, private juce::TextEditor::Listener
{
    juce::var tree, data;
    juce::TextEditor input;
    std::vector<std::pair<juce::String, juce::String>> all, rows;   // (id, section)
    int pickAt = 0;
    float scroll = 0;
    juce::var rowOn, rowOff, inputN;
    juce::Rectangle<float> listR;
    std::function<bool (const juce::String&)> ok;
    std::function<void (const juce::String&)> pick;
    std::function<void()> close;
    std::map<juce::String, std::unique_ptr<juce::Drawable>> icons;

    CmdPop (const juce::var& t, const juce::var& d, std::vector<std::pair<juce::String, juce::String>> list) : tree (t), data (d), all (std::move (list))
    {
        const auto r = rectOf (tree["rect"]);
        setSize ((int) r.getWidth(), (int) r.getHeight());
        if (auto* kids = tree["kids"].getArray())
            for (const auto& k : *kids)
            {
                if (k["tag"].toString() == "input")
                    inputN = k;
                if (hasClass (k, "ed-klist"))
                {
                    listR = rectOf (k["rect"]);
                    if (auto* rs = k["kids"].getArray())
                        for (const auto& row : *rs)
                        {
                            if (hasClass (row, "on") && rowOn.isVoid())
                                rowOn = row;
                            else if (!hasClass (row, "on") && rowOff.isVoid())
                                rowOff = row;
                        }
                }
            }
        input.setBounds (rectOf (inputN["rect"]).reduced (10, 4).toNearestInt());
        input.setColour (juce::TextEditor::backgroundColourId, juce::Colours::transparentBlack);
        input.setColour (juce::TextEditor::outlineColourId, juce::Colours::transparentBlack);
        input.setColour (juce::TextEditor::focusedOutlineColourId, juce::Colours::transparentBlack);
        input.setColour (juce::TextEditor::textColourId, face::colour (inputN["font"]["colour"]).withAlpha (1.0f));
        input.setFont (face::font (inputN["font"]));
        input.setTextToShowWhenEmpty (uni ("Type a command: fade, normalize, strip, region\xe2\x80\xa6"), juce::Colours::grey);
        input.addListener (this);
        addAndMakeVisible (input);
        filter();
    }
    void filter()
    {
        const auto q = input.getText().trim().toLowerCase();
        rows.clear();
        for (const auto& [cmd, sec] : all)
        {
            juce::String nm;
            if (auto* groups = data["groups"].getArray())
                for (const auto& gp : *groups)
                    if (auto* items = gp[1].getArray())
                        for (const auto& it : *items)
                            if (it["id"].toString() == cmd)
                                nm = it["name"].toString();
            if (q.isEmpty() || (nm + " " + data["words"][juce::Identifier (cmd)].toString() + " " + sec + " " + cmd).toLowerCase().contains (q))
                rows.push_back ({ cmd, sec });
        }
        pickAt = juce::jlimit (0, std::max (0, (int) rows.size() - 1), pickAt);
        repaint();
    }
    void textEditorTextChanged (juce::TextEditor&) override
    {
        pickAt = 0;
        filter();
    }
    void textEditorReturnKeyPressed (juce::TextEditor&) override { choose (pickAt); }
    void textEditorEscapeKeyPressed (juce::TextEditor&) override { close(); }
    bool keyPressed (const juce::KeyPress& k) override
    {
        if (k == juce::KeyPress::downKey)
            pickAt = std::min ((int) rows.size() - 1, pickAt + 1);
        else if (k == juce::KeyPress::upKey)
            pickAt = std::max (0, pickAt - 1);
        else
            return false;
        const float rowH = rowStep();
        if ((float) pickAt * rowH - scroll > listR.getHeight() - rowH)
            scroll = (float) pickAt * rowH - listR.getHeight() + rowH;
        if ((float) pickAt * rowH < scroll)
            scroll = (float) pickAt * rowH;
        repaint();
        return true;
    }
    float rowStep() const { return rowOff.isObject() ? rectOf (rowOff["rect"]).getHeight() + 1 : 33; }
    void choose (int i)
    {
        if (i >= 0 && i < (int) rows.size() && ok (rows[(size_t) i].first))
            pick (rows[(size_t) i].first);
    }
    void paint (juce::Graphics& g) override
    {
        face::paintBox (g, tree, rectOf (tree["rect"]));
        face::paintBox (g, inputN, rectOf (inputN["rect"]));
        juce::Graphics::ScopedSaveState s (g);
        g.reduceClipRegion (listR.toNearestInt());
        const float step = rowStep();
        for (size_t i = 0; i < rows.size(); ++i)
        {
            const auto& look = (int) i == pickAt && rowOn.isObject() ? rowOn : rowOff;
            const auto base = rectOf (look["rect"]);
            const float d0 = rowOn.isObject() ? rectOf (rowOn["rect"]).getY() - listR.getY() : 0;
            const float y = listR.getY() + d0 + (float) i * step - scroll;
            const juce::Point<float> by (0, y - base.getY());
            if (y > listR.getBottom() || y + step < listR.getY())
                continue;
            const bool on = ok (rows[i].first);
            juce::Graphics::ScopedSaveState s2 (g);
            if (!on)
                g.beginTransparencyLayer (0.45f);
            face::paintBox (g, look, base + by);
            const auto& cmd = rows[i].first;
            juce::String nm, key;
            if (auto* groups = data["groups"].getArray())
                for (const auto& gp : *groups)
                    if (auto* items = gp[1].getArray())
                        for (const auto& it : *items)
                            if (it["id"].toString() == cmd)
                                nm = it["name"].toString(), key = it["key"].toString();
            if (auto* kids = look["kids"].getArray())
                for (const auto& k : *kids)
                {
                    const auto r = rectOf (k["rect"]) + by;
                    if (k["svg"].isString())
                    {
                        auto& d = icons[cmd];
                        if (d == nullptr)
                        {
                            const auto col = face::colour (k["svg"].toString().contains ("stroke=\"") ? juce::var() : juce::var());
                            juce::ignoreUnused (col);
                            auto svg = k["svg"].toString();
                            const int a = svg.indexOf (">") + 1, b = svg.lastIndexOf ("</svg>");
                            juce::String stroke = "currentColor";
                            const int sk = svg.indexOf ("stroke=\"");
                            if (sk >= 0)
                                stroke = svg.substring (sk + 8, svg.indexOfChar (sk + 8, '"'));
                            juce::ignoreUnused (a, b);
                            d = juce::Drawable::createFromSVGString ("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"" + stroke + "\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">"
                                                                   + data["svg"][juce::Identifier (cmd)].toString().replace ("currentColor", stroke) + "</svg>");
                        }
                        if (d != nullptr)
                            d->drawWithin (g, r, juce::RectanglePlacement::stretchToFit, 1.0f);
                    }
                    else if (hasClass (k, "ed-kg"))
                        face::paintText (g, k, r.withWidth (200), rows[i].second.toUpperCase());
                    else if (hasClass (k, "ed-kn"))
                        face::paintText (g, k, r.withWidth (360), nm);
                    else if (k["tag"].toString() == "kbd" && key.isNotEmpty())
                    {
                        const float w = juce::GlyphArrangement::getStringWidth (face::font (k["text"][0]["font"]), key);
                        face::paintText (g, k, juce::Rectangle<float> (r.getRight() - w, r.getY(), w, r.getHeight()), key);
                    }
                }
            if (!on)
                g.endTransparencyLayer();
        }
    }
    void mouseDown (const juce::MouseEvent& e) override
    {
        if (!listR.contains (e.position))
            return;
        const float d0 = rowOn.isObject() ? rectOf (rowOn["rect"]).getY() - listR.getY() : 0;
        choose ((int) std::floor ((e.position.y - listR.getY() - d0 + scroll) / rowStep()));
    }
    void mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails& w) override
    {
        scroll = juce::jlimit (0.0f, std::max (0.0f, (float) rows.size() * rowStep() - listR.getHeight()), scroll - w.deltaY * 200);
        repaint();
    }
};
} // namespace

void EditFace::openKnobs (const juce::String& cmd)
{
    pop.reset();
    popCmd = cmd;
    std::vector<KnobSpec> specs;
    if (auto* ks = data["knobs"][juce::Identifier (cmd)].getArray())
        for (const auto& k : *ks)
            specs.push_back ({ k[0].toString(), k[1].toString(), dnum (k[2]), dnum (k[3]), dnum (k[4]), dnum (data["params"][juce::Identifier (k[0].toString())]), (bool) k[5] });
    auto p = std::make_unique<KnobPop> (captured["knobs"][juce::Identifier (cmd)]["tree"], specs, &params);
    p->canRun = enabled (cmd);
    p->changed = [this] { keep(); };
    p->runIt = [this, cmd] { pop.reset(); run (cmd); };
    // Out to the left of the bar, level with the command.
    const auto b = barCmds[cmd].r.translated (barR.getX(), barR.getY() - (float) barScroll);
    const int x = std::max (8, (int) (sideR.getX() - (float) p->getWidth() - 8));
    const int y = std::max (8, std::min (1100 - p->getHeight() - 8, (int) (b.getCentreY() - (float) p->getHeight() / 2)));
    p->setTopLeftPosition (x, y);
    addAndMakeVisible (*p);
    pop = std::move (p);
}

void EditFace::openPie (juce::Point<float> at)
{
    pop.reset();
    popCmd = "pie";
    auto p = std::make_unique<PiePop> (captured["pie"]["tree"]);
    p->ok = [this] (const juce::String& c) { return c == "region" || c == "cut" || c == "copy" || c == "delete" || c == "crop" || c == "reverse" ? (open && hasSel) : enabled (c); };
    p->pick = [this] (const juce::String& c) {
        juce::MessageManager::callAsync ([safe = juce::Component::SafePointer<EditFace> (this), c] {
            if (safe == nullptr)
                return;
            safe->pop.reset();
            if (c == "*")
                safe->openCommands();
            else
                safe->run (c);
        });
    };
    const float x = juce::jlimit (110.0f, 1500.0f - 110, at.x), y = juce::jlimit (100.0f, 1100.0f - 100, at.y);
    p->setTopLeftPosition ((int) (x - 130), (int) (y - 110));
    addAndMakeVisible (*p);
    pop = std::move (p);
}

void EditFace::openCommands()
{
    pop.reset();
    popCmd = "k";
    std::vector<std::pair<juce::String, juce::String>> list;
    // Every command, by its section in the bar, then the hidden ones (edKList).
    juce::StringArray order;
    if (auto* o = data["order"].getArray())
        for (const auto& t : *o)
            order.add (t.toString());
    juce::StringArray hidden;
    if (auto* h = data["hidden"].getArray())
        for (const auto& t : *h)
            hidden.add (t.toString());
    std::vector<std::pair<int, juce::var>> groups;
    if (auto* gs = data["groups"].getArray())
        for (const auto& gp : *gs)
        {
            const int at = order.indexOf (gp[0].toString());
            groups.push_back ({ at < 0 ? order.size() : at, gp });
        }
    std::stable_sort (groups.begin(), groups.end(), [] (const auto& a, const auto& b) { return a.first < b.first; });
    for (const auto& [at, gp] : groups)
        if (auto* items = gp[1].getArray())
            for (const auto& it : *items)
                if (!hidden.contains (it["id"].toString()))
                    list.push_back ({ it["id"].toString(), gp[0].toString() });
    for (const auto& h : hidden)
        list.push_back ({ h, "Hidden" });
    auto p = std::make_unique<CmdPop> (captured["cmdk"]["tree"], data, list);
    p->ok = [this] (const juce::String& c) { return enabled (c); };
    p->pick = [this] (const juce::String& c) {
        juce::MessageManager::callAsync ([safe = juce::Component::SafePointer<EditFace> (this), c] {
            if (safe == nullptr)
                return;
            safe->pop.reset();
            safe->run (c);
        });
    };
    p->close = [this] { juce::MessageManager::callAsync ([safe = juce::Component::SafePointer<EditFace> (this)] { if (safe != nullptr) safe->pop.reset(); }); };
    p->setTopLeftPosition ((1500 - p->getWidth()) / 2, 120);
    addAndMakeVisible (*p);
    p->input.grabKeyboardFocus();
    pop = std::move (p);
}

// ──────────────────────────────────────────────────────────── the mouse

juce::Rectangle<float> EditFace::where (const juce::String& part) const
{
    auto at = [&] (const std::map<juce::String, Node>& m, const juce::String& k) { auto it = m.find (k); return it == m.end() ? juce::Rectangle<float>() : it->second.r; };
    if (part == "lane")
        return laneR;
    if (part == "wave")
        return waveArea (laneR, prefs.count ("spec") && prefs.at ("spec"), split);
    if (part == "bar")
        return barR;
    if (part == "overview")
        return poR;
    if (part.startsWith ("cmd:"))
        return at (barCmds, part.substring (4)).translated (barR.getX(), barR.getY() - (float) barScroll);
    if (part.startsWith ("more:"))
        return at (barMore, part.substring (5)).translated (barR.getX(), barR.getY() - (float) barScroll);
    if (part == "play" || part == "stop" || part == "loop")
        return at (nowIds, part + "Btn");
    if (part == "cmdk")
        return at (openIds, "edCmdK");
    if (part == "fit" || part == "zoomIn" || part == "zoomOut")
        return at (openIds, part == "fit" ? "poZoomFit" : part == "zoomIn" ? "poZoomIn" : "poZoomOut");
    if (part == "split")
    {
        const auto w = waveArea (laneR, true, split);
        return { w.getX(), w.getBottom() - 4, w.getWidth(), 9 };
    }
    if (part == "pop" && pop != nullptr)
        return pop->getBounds().toFloat();
    return at (openIds, part);
}

namespace
{
// The handles' places now (414), for a press to find.
struct Hands
{
    juce::Rectangle<float> fi, fo, pill;
    std::vector<std::pair<juce::String, juce::Rectangle<float>>> chip;
};
} // namespace

static Hands handsOf (const juce::var& tree, float x0, float top, float a, float b, float W, float pillY)
{
    Hands h;
    const float ca = std::max (0.0f, a), cb = std::min (W, b);
    if (auto* kids = tree["kids"].getArray())
        for (const auto& kid : *kids)
        {
            const auto cls = kid["cls"].toString();
            const auto r = rectOf (kid["rect"]);
            if (cls == "ed-fh")
                (dataOf (kid, "h") == "fi" ? h.fi : h.fo) = r.withCentre ({ x0 + (dataOf (kid, "h") == "fi" ? a : b), r.getCentreY() });
            else if (cls.startsWith ("ed-gg"))
                h.pill = juce::Rectangle<float> (70, r.getHeight()).withCentre ({ x0 + (ca + cb) / 2, top + pillY });
            else if (cls == "ed-chip")
            {
                const float dx = x0 + (ca + cb) / 2 - r.getCentreX();
                if (auto* sub = kid["kids"].getArray())
                    for (const auto& s : *sub)
                        if (dataOf (s, "x").isNotEmpty())
                            h.chip.push_back ({ dataOf (s, "x"), rectOf (s["rect"]).translated (dx, 0) });
            }
        }
    return h;
}

void EditFace::mouseDown (const juce::MouseEvent& e)
{
    const auto p = e.position;
    grab = Grab::none;
    moved = 0;
    down = p;
    if (pop != nullptr && !pop->getBounds().toFloat().contains (p))
        pop.reset();
    if (blocked && blocked (e))
        return;
    grabKeyboardFocus();
    // The bar.
    bool more = false;
    if (const auto cmd = commandAt (p, &more); cmd.isNotEmpty())
    {
        if (more)
            popCmd == cmd && pop != nullptr ? pop.reset() : openKnobs (cmd);
        else if (enabled (cmd))
            run (cmd);
        return;
    }
    if (barR.contains (p))
    {
        // Customize, at the bar's foot.
        const auto q = p - barR.getPosition() + juce::Point<float> (0, (float) barScroll);
        std::function<juce::String (const juce::var&)> tool = [&] (const juce::var& n) -> juce::String {
            if (rectOf (n["rect"]).contains (q))
                for (const char* t : { "wtEdit", "wtDone", "wtReset", "wtAdd" })
                    if (hasClass (n, t))
                        return t;
            if (auto* kids = n["kids"].getArray())
                for (const auto& k : *kids)
                    if (auto r = tool (k); r.isNotEmpty())
                        return r;
            return {};
        };
        if (const auto t = tool (captured["bar"][customizing ? "custom" : "open"]["tree"]); t.isNotEmpty())
            run (t);
        else if (barIds.count ("wtBits") && barIds["wtBits"].r.contains (q))
        {
            juce::PopupMenu m;
            for (int b : { 16, 24, 32 })
                m.addItem (b == 32 ? "32-bit float" : juce::String (b) + "-bit", true, b == exportBits, [this, b] { exportBits = b; keep(); repaintLayer ("barText"); });
            m.showMenuAsync (juce::PopupMenu::Options().withTargetScreenArea (localAreaToGlobal (barIds["wtBits"].r.translated (barR.getX(), barR.getY() - (float) barScroll).toNearestInt())));
        }
        return;
    }
    // The Now bar.
    if (nowIds["playBtn"].r.contains (p))
        return play();
    if (nowIds["stopBtn"].r.contains (p))
        return stop();
    if (nowIds["loopBtn"].r.contains (p))
    {
        loopOn = !loopOn;
        applyLoop();
        keep();
        return;
    }
    if (openIds["edCmdK"].r.contains (p))
        return openCommands();
    if (openIds["tabBar"].r.contains (p))
    {
        if (wantSound)
            wantSound();
        return;
    }
    if (!open)
        return;
    // The overview's buttons.
    if (openIds["poZoomFit"].r.contains (p))
    {
        poA = poB = 0;
        keep();
        return repaintLayer ("overview");
    }
    if (openIds["poZoomIn"].r.contains (p) || openIds["poZoomOut"].r.contains (p))
    {
        const bool in = openIds["poZoomIn"].r.contains (p);
        const double len = frames / sr;
        const double va = poB > poA ? poA : 0, vb = poB > poA ? poB : len;
        const double at = in ? (playing ? head / sr : cue / sr) : (va + vb) / 2;
        const double L = std::max (0.01, (vb - va) * (in ? 0.5 : 2));
        if (L >= len * 0.999)
            poA = poB = 0;
        else
        {
            double a = at - (at - va) / (vb - va) * L, b = a + L;
            if (a < 0)
                b -= a, a = 0;
            if (b > len)
                a -= b - len, b = len;
            poA = a, poB = b;
        }
        keep();
        return repaintLayer ("overview");
    }
    // The overview strip (poWire).
    if (poR.contains (p))
    {
        grab = Grab::overview;
        const double len = frames / sr;
        const double va = poB > poA ? poA : 0, vb = poB > poA ? poB : len;
        const float W = poR.getWidth() - 12;
        auto atS = [&] (float x) { return va + (x - poR.getX() - 6) / W * (vb - va); };
        auto X = [&] (double s) { return (float) (poR.getX() + 6 + (s - va) / (vb - va) * W); };
        s0 = juce::jlimit (0.0, len, atS (p.x));
        if (e.mods.isAltDown())
        {
            poGrab = "scrub";
            seek (s0 * sr);
            return;
        }
        const double la = hasSel && selB > selA ? selA / sr : 0, lb = hasSel && selB > selA ? selB / sr : len;
        const float bot = poR.getY() + poR.getHeight() - 13;
        poGrab = "sel";
        bool nearEnd = std::abs (p.x - X (la)) < 6 || std::abs (p.x - X (lb)) < 6;
        if (!nearEnd && p.y >= bot - 10 && p.y <= bot + 1)
            if (auto* rs = annotations["regions"].getArray())
                for (const auto& rg : *rs)
                    if (p.x >= X (dnum (rg["start"]) / sr) && p.x <= X (dnum (rg["end"]) / sr))
                    {
                        hasSel = true, selA = dnum (rg["start"]), selB = dnum (rg["end"]);
                        applyLoop();
                        poGrab = "";
                        return;
                    }
        if (std::abs (p.x - X (la)) < 6)
            poGrab = "a";
        else if (std::abs (p.x - X (lb)) < 6)
            poGrab = "b";
        else if (std::abs (p.x - X (cue / sr)) < 6)
            poGrab = "cue";
        else if (viewTo - viewFrom < frames * 0.999 && p.x >= X (viewFrom / sr) && p.x <= X (viewTo / sr))
        {
            poGrab = "pan";
            s0 = atS (p.x);
            grabFrom = viewFrom;
        }
        grabTo = la, anchor = lb;
        return;
    }
    // The split between the wave and the spectrogram.
    if (prefs["spec"] && where ("split").contains (p))
    {
        grab = Grab::split;
        return;
    }
    if (!laneR.contains (p))
        return;
    // Right-click on the wave: the pie (415).
    if (e.mods.isPopupMenu())
        return openPie (p);
    const float x0 = laneR.getX() + 1, W = laneR.getWidth() - 2;
    // The handles (414).
    if (selOn())
    {
        const auto lv = measures["levels"];
        const int nch = std::max (1, peakCh);
        const float H = waveArea (laneR, prefs["spec"], split).getHeight(), laneH = H / (float) nch, half = (laneH / 2) * 0.92f;
        const double pk = lv.isObject() ? std::pow (10.0, dnum (lv["peak"]) / 20) : 1;
        const float y = laneH / 2 - (float) std::min (1.02, pk) * half;
        const auto h = handsOf (openIds["edHands"].n, x0, laneR.getY(), (float) fx (selA), (float) fx (selB), W, std::min (laneH - 14, y + 24));
        for (const auto& [x, r] : h.chip)
            if (r.contains (p))
            {
                if (x == "curve")
                    run (fadeShape == "linear" ? "curveEq" : "curveLin");
                else
                    run (x);
                return;
            }
        juce::String kind = h.fi.expanded (2).contains (p) ? "fi" : h.fo.expanded (2).contains (p) ? "fo" : h.pill.contains (p) ? "g" : "";
        if (kind.isNotEmpty())
        {
            grab = Grab::hand;
            live = kind;
            liveV = 0;
            handLenMs = (selB - selA) / sr * 1000;
            handMsPerPx = (viewTo - viewFrom) / W / sr * 1000;
            handPk = pk;
            handYPk = laneH / 2 - (float) pk * half;
            previewMono.assign ((size_t) (selB - selA), 0.0f);
            call ([&] (NaApp* a) -> int64_t { return na_edit_mono (a, id, (int64_t) selA, previewMono.data(), (uint32_t) previewMono.size()); });
            return;
        }
    }
    // The wave: a click moves the cursor, a drag selects, ⌥ scrubs, an edge moves (040).
    grab = Grab::lane;
    anchor = frameAt (p.x);
    if (e.mods.isAltDown())
    {
        grab = Grab::scrub;
        seek (anchor);
        return;
    }
    if (selOn())
    {
        const float px = p.x - x0;
        if (std::abs (px - fx (selA)) < 6)
            grab = Grab::edge, anchor = selB;
        else if (std::abs (px - fx (selB)) < 6)
            grab = Grab::edge, anchor = selA;
        if (grab == Grab::edge)
            return;
    }
    hasSel = false;
    applyLoop();
    cue = anchor;
    seek (anchor);
    syncBar();
    for (auto n : { "overlay", "overview", "counters", "now" })
        repaintLayer (n);
}

void EditFace::mouseDrag (const juce::MouseEvent& e)
{
    const auto p = e.position;
    moved += std::abs (p.x - down.x);
    if (grab == Grab::split)
    {
        const float h = laneR.getHeight() - 1;
        split = juce::jlimit (25.0, 88.0, (double) ((p.y - laneR.getY()) / h * 100));
        loadPeaks();
        repaintLayer ("wave");
        repaintLayer ("overlay");
        return;
    }
    if (grab == Grab::hand)
    {
        const int nch = std::max (1, peakCh);
        const float H = waveArea (laneR, prefs["spec"], split).getHeight(), laneH = H / (float) nch, half = (laneH / 2) * 0.92f;
        if (live == "g")
        {
            const double ny = juce::jlimit (2.0, (double) laneH / 2 - 2, handYPk + (p.y - down.y));
            const double npk = (laneH / 2 - ny) / half;
            liveV = juce::jlimit (-36.0, 24.0, 20 * std::log10 (std::max (1e-6, npk) / handPk));
        }
        else
            liveV = juce::jlimit (0.0, handLenMs, (live == "fi" ? 1 : -1) * (p.x - down.x) * handMsPerPx);
        repaintLayer ("overlay");
        return;
    }
    if (grab == Grab::overview)
    {
        const double len = frames / sr;
        const double va = poB > poA ? poA : 0, vb = poB > poA ? poB : len;
        const float W = poR.getWidth() - 12;
        const double at = va + (p.x - poR.getX() - 6) / W * (vb - va), s = juce::jlimit (0.0, len, at);
        const double a = grabTo, b = anchor;
        auto setLoop = [&] (double lo0, double hi0) {
            // gsSetLoop: as short as one sample.
            const double lo = juce::jlimit (0.0, len, std::min (lo0, hi0)), hi = juce::jlimit (0.0, len, std::max (lo0, hi0));
            const double st = std::round (lo * sr);
            hasSel = true, selA = st, selB = std::max (st + 1, std::round (hi * sr));
            if (cue < selA || cue >= selB)
                cue = selA;
            applyLoop();
        };
        if (poGrab == "scrub" || (poGrab.isNotEmpty() && poGrab != "pan" && e.mods.isAltDown()))
            seek (s * sr);
        else if (poGrab == "a")
            setLoop (std::min (s, b - 1 / sr), b);
        else if (poGrab == "b")
            setLoop (a, std::max (s, a + 1 / sr));
        else if (poGrab == "cue")
            cue = std::round (s * sr);
        else if (poGrab == "sel" && moved > 3)
        {
            setLoop (std::min (s0, s), std::max (s0, s));
            cue = std::round (std::min (s0, s) * sr);
        }
        else if (poGrab == "pan" && moved > 3)
        {
            const double span = viewTo - viewFrom;
            const double from = std::round (juce::jlimit (0.0, frames - span, grabFrom + (at - s0) * sr));
            if (std::abs (from - viewFrom) > 0.5)
            {
                viewFrom = from;
                viewTo = from + span;
                loadPeaks();
                loadSpectrogram();
            }
        }
        for (auto n : { "overlay", "overview", "counters", "now", "meters" })
            repaintLayer (n);
        return;
    }
    if (grab == Grab::scrub)
    {
        seek (frameAt (p.x));
        return;
    }
    if (grab != Grab::lane && grab != Grab::edge)
        return;
    double now = frameAt (p.x);
    if (grab == Grab::edge)
        now = (double) call ([&] (NaApp* a) -> int64_t { return na_edit_edge_snap (a, id, (int64_t) now, prefs["snapHits"] ? 1u : 0u, snap == "zero" ? 1u : 0u); });
    else if (std::abs (now - anchor) < (viewTo - viewFrom) / 500)
        return;
    if (std::abs (now - anchor) < 0.5)
        return;
    hasSel = true;
    selA = std::min (anchor, now);
    selB = std::max (anchor, now);
    cue = selA;
    applyLoop();
    if (grab == Grab::edge)
    {
        loupeAt = now;
        loupeSamples.assign (161, 0.0f);
        call ([&] (NaApp* a) -> int64_t { return na_edit_mono (a, id, (int64_t) now - 80, loupeSamples.data(), 161); });
    }
    syncBar();
    for (auto n : { "overlay", "overview", "counters", "meters", "now" })
        repaintLayer (n);
}

void EditFace::mouseUp (const juce::MouseEvent&)
{
    const auto g = grab;
    grab = Grab::none;
    if (g == Grab::hand)
    {
        const auto kind = live;
        const double v = liveV;
        live = {};
        previewMono.clear();
        // edKeepPlace: the edit, then the selection and the view put back.
        const bool sel = hasSel;
        const double a = selA, b = selB, from = viewFrom, to = viewTo;
        if (kind == "g" && std::abs (v) >= 0.05)
            edit (obj ({ { "op", "gain" }, { "db", std::round (v * 10) / 10 }, { "start", selA }, { "end", selB } }), false);
        else if ((kind == "fi" || kind == "fo") && v >= 1)
            edit (obj ({ { "op", kind == "fi" ? "fadeIn" : "fadeOut" }, { "start", selA }, { "end", selB }, { "frames", std::max (1.0, std::round (v / 1000 * sr)) }, { "shape", fadeShape } }), true);
        if (sel && b <= frames)
            hasSel = true, selA = a, selB = b, applyLoop();
        if (to > from && to <= frames)
        {
            viewFrom = from, viewTo = to;
            loadPeaks();
            loadSpectrogram();
        }
        keep();
        repaintLayer ("overlay");
        return;
    }
    if (g == Grab::overview)
    {
        // A click, in the box or out of it, moves Start.
        if ((poGrab == "sel" || poGrab == "pan") && moved <= 3)
        {
            cue = std::round (juce::jlimit (0.0, frames / sr, s0) * sr);
            seek (cue);
        }
        else if (poGrab.isNotEmpty() && poGrab != "scrub" && poGrab != "pan" && loopOn && hasSel)
            seek (selA);
        poGrab = {};
        syncBar();
        keep();
        repaintLayer ("overview");
        return;
    }
    if (g == Grab::edge)
    {
        loupeAt = -1;
        loupeSamples.clear();
    }
    if (g == Grab::lane || g == Grab::edge)
    {
        applyLoop();
        // Looping a fresh selection starts from its beginning.
        if (loopOn && hasSel)
            seek (selA);
        syncBar();
        keep();
        readSound();
        for (auto n : { "overlay", "counters", "meters" })
            repaintLayer (n);
    }
    if (g == Grab::split)
        keep();
}

void EditFace::mouseMove (const juce::MouseEvent& e)
{
    juce::ignoreUnused (e);
}

void EditFace::mouseDoubleClick (const juce::MouseEvent& e)
{
    const auto p = e.position;
    if (nowIds["stopBtn"].r.contains (p))
    {
        // Back to the top of the file; the cue stays.
        auto* o = new juce::DynamicObject();
        o->setProperty ("play", false);
        o->setProperty ("seek", 0.0);
        transport (juce::var (o));
        playing = false;
        head = 0;
        repaintLayer ("now");
        return;
    }
    if (poR.contains (p))
    {
        poA = poB = 0;
        keep();
        repaintLayer ("overview");
        return;
    }
    if (prefs["spec"] && where ("split").contains (p))
    {
        split = 64;
        keep();
        loadPeaks();
        repaintLayer ("wave");
    }
}

void EditFace::mouseWheelMove (const juce::MouseEvent& e, const juce::MouseWheelDetails& w)
{
    const auto p = e.position;
    if (barR.contains (p))
    {
        // The bar's sections scroll when they are taller than it.
        const float content = numOf (captured["bar"][customizing ? "custom" : "open"]["size"][1], barR.getHeight());
        barScroll = juce::jlimit (0.0, (double) std::max (0.0f, content - barR.getHeight()), barScroll - w.deltaY * 120);
        syncBar();
        return;
    }
    if (poR.contains (p) && open)
    {
        const double len = frames / sr;
        const double va = poB > poA ? poA : 0, vb = poB > poA ? poB : len;
        const float W = poR.getWidth() - 12;
        if (e.mods.isShiftDown() || std::abs (w.deltaX) > std::abs (w.deltaY))
        {
            if (poB > poA)
            {
                const double ds = -(e.mods.isShiftDown() ? (std::abs (w.deltaY) > 0 ? w.deltaY : w.deltaX) : w.deltaX) * 100 / W * (vb - va);
                const double L = vb - va;
                poA = juce::jlimit (0.0, len - L, poA + ds);
                poB = poA + L;
            }
        }
        else
        {
            const double at = va + (p.x - poR.getX() - 6) / W * (vb - va);
            const double k = std::exp (juce::jlimit (-60.0, 60.0, (double) -w.deltaY * 100) * 0.006);
            const double L = std::max (0.01, (vb - va) * k);
            if (L >= len * 0.999)
                poA = poB = 0;
            else
            {
                double a = at - (at - va) / (vb - va) * L, b = a + L;
                if (a < 0)
                    b -= a, a = 0;
                if (b > len)
                    a -= b - len, b = len;
                poA = a, poB = b;
            }
        }
        keep();
        repaintLayer ("overview");
    }
}

// ───────────────────────────────────────────────────────────────── the keys

bool EditFace::keyPressed (const juce::KeyPress& k)
{
    // 320-keyboard.js's shortcuts, and the bar's.
    const auto m = k.getModifiers();
    const bool mod = m.isCommandDown();
    const auto c = k.getTextCharacter();
    const int code = k.getKeyCode();
    if (code == juce::KeyPress::spaceKey)
        return play(), true;
    if (mod && !m.isShiftDown() && (c == 'z' || code == 'Z'))
        return run ("undo"), true;
    if (mod && m.isShiftDown() && (c == 'z' || c == 'Z' || code == 'Z'))
        return run ("redo"), true;
    if (mod && c == '`')
        return run ("crop"), true;
    if (mod && !m.isShiftDown() && code == 'X')
        return run ("cut"), true;
    if (mod && !m.isShiftDown() && code == 'C' && hasSel)
        return run ("copy"), true;
    if (mod && !m.isShiftDown() && code == 'V')
        return run ("paste"), true;
    if (mod && m.isShiftDown() && code == 'V')
        return run ("insertClip"), true;
    if (!mod && (code == juce::KeyPress::deleteKey || code == juce::KeyPress::backspaceKey) && hasSel)
        return run ("delete"), true;
    if (mod && !m.isShiftDown() && code == 'G')
        return run ("goTo"), true;
    if (mod && m.isShiftDown() && (c == ']' || c == '}'))
        return run ("fitSel"), true;
    if (!mod && m.isShiftDown() && code == juce::KeyPress::leftKey)
        return zoomToSample (false), true;
    if (!mod && m.isShiftDown() && code == juce::KeyPress::rightKey)
        return zoomToSample (true), true;
    if (mod && code == 'A')
        return run ("selectAll"), true;
    if (mod && code == 'K')
        return openCommands(), true;
    if (mod && code == 'E')
        return run ("export"), true;
    if (!mod && (c == 'm' || c == 'M'))
        return run ("marker"), true;
    if (!mod && (c == 'r' || c == 'R'))
        return run ("region"), true;
    if (!mod && (c == '+' || c == '='))
        return run ("zoomIn"), true;
    if (!mod && (c == '-' || c == '_'))
        return run ("zoomOut"), true;
    if (code == juce::KeyPress::escapeKey)
    {
        if (pop != nullptr)
            return pop.reset(), true;
        hasSel = false;
        cue = 0;
        applyLoop();
        syncBar();
        keep();
        for (auto& l : layers)
            l->repaint();
        return true;
    }
    return false;
}

std::vector<std::pair<juce::String, double>> EditFace::profile (float scale)
{
    std::vector<std::pair<juce::String, double>> out;
    for (auto& l : layers)
    {
        juce::Image img (juce::Image::ARGB, std::max (1, (int) ((float) l->getWidth() * scale)), std::max (1, (int) ((float) l->getHeight() * scale)), true);
        juce::Graphics g (img);
        g.addTransform (juce::AffineTransform::scale (scale));
        const auto t0 = juce::Time::getMillisecondCounterHiRes();
        l->draw (g);
        out.push_back ({ l->name, juce::Time::getMillisecondCounterHiRes() - t0 });
    }
    std::sort (out.begin(), out.end(), [] (const auto& a, const auto& b) { return a.second > b.second; });
    return out;
}
