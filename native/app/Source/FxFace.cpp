#include "FxFace.h"

#include "Canvas2D.h"
#include "FxReverb.h"
#include "GrainPictures.h"
#include "Host.h"
#include "Places.h"
#include "SoundFace.h"

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
juce::String textOf (const juce::var& n)
{
    if (auto* t = n["text"].getArray(); t != nullptr && ! t->isEmpty())
        return (*t)[0]["text"].toString();
    return {};
}
const juce::var* findIn (const juce::var& n, const std::function<bool (const juce::var&)>& want)
{
    if (want (n))
        return &n;
    if (auto* kids = n["kids"].getArray())
        for (const auto& k : *kids)
            if (auto* f = findIn (k, want))
                return f;
    return nullptr;
}
void eachIn (const juce::var& n, const std::function<void (const juce::var&)>& f)
{
    f (n);
    if (auto* kids = n["kids"].getArray())
        for (const auto& k : *kids)
            eachIn (k, f);
}
juce::var obj() { return juce::var (new juce::DynamicObject()); }
void put (juce::var& o, const juce::Identifier& k, const juce::var& v)
{
    if (auto* d = o.getDynamicObject())
        d->setProperty (k, v);
}
juce::String uni (const char* s) { return juce::String::fromUTF8 (s); }
juce::String fixed (double v, int places)
{
    const double p = std::pow (10.0, places);
    const double r = std::floor (std::abs (v) * p + 0.5) / p;
    auto s = juce::String (r, places);
    return v < 0 && r != 0.0 ? "-" + s : s;
}
// `gsFxSideText`: a side fader's dB.
juce::String sideText (double u)
{
    const double db = 20 * std::log10 (juce::jmax (1e-9, std::pow (u / 0.8, 2.0)));
    return db <= -60 ? uni ("\xe2\x88\x92\xe2\x88\x9e") : juce::String (db > 0.04 ? "+" : db < -0.04 ? uni ("\xe2\x88\x92") : juce::String()) + fixed (std::abs (db), 1);
}
// The page's short names on the strip (`gsFxShort`).
juce::String shortName (const juce::String& kind, const juce::var& api)
{
    static const std::map<juce::String, juce::String> own { { "eq", "EQ" }, { "comp", "Comp" }, { "gain", "Gain" } };
    if (auto it = own.find (kind); it != own.end())
        return it->second;
    if (auto* sh = api["shapers"].getArray())
        for (const auto& s : *sh)
            if (s["kind"].toString() == kind)
            {
                auto l = s["label"].toString();
                return l.length() > 10 ? l.substring (0, 9) + uni ("\xe2\x80\xa6") : l;
            }
    return kind;
}
juce::String clock (double secs)
{
    const int m = (int) (secs / 60);
    const double s = secs - m * 60;
    return juce::String (m) + ":" + (s < 10 ? "0" : "") + fixed (s, 2);
}
} // namespace

FxFace::FxFace (Call c, uint32_t i, bool page) : call (std::move (c)), id (i), isPage (page)
{
    buf.resize (1u << 20);
    api = fx ("catalogue");
    if (isPage)
    {
        indexPage();
        auto o = obj();
        put (o, "op", "places");
        put (o, "mine", places::home().getChildFile ("presets").getChildFile ("fx").getChildFile ("PRESETS.json").getFullPathName());
        put (o, "mgl", places::mgl().getChildFile ("PRESETS.json").getFullPathName());
        places::home().getChildFile ("presets").getChildFile ("fx").createDirectory();
        presets = fx ("presets", o);
        search = std::make_unique<juce::TextEditor>();
        search->setTextToShowWhenEmpty ("search the words", juce::Colours::grey);
        search->onTextChange = [this] {
            query = search->getText().trim().toLowerCase();
            pcShown = 40;
            repaint();
        };
        addChildComponent (*search);
        setSize (1500, 975);
        loadPc();
    }
    reload();
    startTimerHz (30);
}

FxFace::~FxFace()
{
    stopTimer();
}

void FxFace::say (const juce::String& s)
{
    if (onMessage && s.isNotEmpty())
        onMessage (s);
}

juce::var FxFace::fx (const char* what, const juce::var& body)
{
    const auto text = body.isVoid() ? std::string() : juce::JSON::toString (body, true).toStdString();
    juce::String err;
    auto run = [&] {
        return call ([&] (NaApp* a) {
            const int32_t n = na_fx_call (a, id, what, text.empty() ? nullptr : text.c_str(), buf.data(), (uint32_t) buf.size());
            if (n < 0)
                err = juce::String (naText ([a] (char* eb, uint32_t ec) { return na_error (a, eb, ec); }));
            return (int64_t) n;
        });
    };
    auto n = run();
    if (n >= (int64_t) buf.size() && err.isEmpty())
    {
        buf.resize ((size_t) n + 4096);
        // Only what reads asks again; an action's answer is read back through "info".
        const auto w = juce::String (what);
        if (w == "catalogue" || w == "info" || w == "levels" || (w == "rack" && body["op"].toString() == "get") || (w == "presets" && body["op"].toString() == "list"))
            n = run();
        else
            return fx ("info");
    }
    if (err.isNotEmpty() || n < 0)
    {
        say (err);
        return {};
    }
    return juce::JSON::parse (juce::String::fromUTF8 (buf.data(), (int) juce::jmin ((int64_t) buf.size() - 1, n)));
}

void FxFace::reload()
{
    readInfo (fx ("info"));
}

void FxFace::readInfo (const juce::var& v)
{
    if (! v.isObject())
        return;
    infoV = v;
    const auto& t = v["transport"];
    volume = dnum (t["volume"], 0.85);
    sideL = dnum (t["sideL"], 0.8);
    sideR = dnum (t["sideR"], 0.8);
    playing = (bool) t["playing"];
    position = dnum (t["position"]);
    soundInfo = juce::var();
    if (v["sound"].isInt() || v["sound"].isInt64() || v["sound"].isDouble())
    {
        const auto sid = (uint32_t) (int) v["sound"];
        soundInfo = juce::JSON::parse (juce::String (naText ([this, sid] (char* b, uint32_t cap) {
            return (uint32_t) juce::jmax ((int64_t) 0, call ([&] (NaApp* a) { return (int64_t) na_sound_info (a, sid, b, cap); }));
        })));
    }
    layoutCards();
    repaint();
}

void FxFace::layoutCards()
{
    const auto* slots = infoV["rack"]["slots"].getArray();
    const int n = slots == nullptr ? 0 : slots->size();
    while ((int) cards.size() > n)
        cards.pop_back();
    while ((int) cards.size() < n)
        cards.push_back (std::make_unique<FxCard> (api));
    for (int i = 0; i < n; ++i)
    {
        auto& c = *cards[(size_t) i];
        c.set (juce::JSON::parse (juce::JSON::toString ((*slots)[i])), infoV["rack"]["ranges"]);
        c.front = i == front;
        c.send = [this, i] (const juce::var& msg) { send (i, msg); };
        c.changed = [this, i] { if (isPage) mark ({ cardX (i), railBox.getY() - 4, cards[(size_t) i]->width(), 408 }); else mark (getLocalBounds().toFloat()); };
    }
    if (! isPage && n > 0)
        setSize ((int) cards[0]->width(), (int) cards[0]->height());
}

float FxFace::cardX (int i) const
{
    float x = railBox.getX() - scroll;
    for (int k = 0; k < i && k < (int) cards.size(); ++k)
        x += cards[(size_t) k]->width() + 10;
    return x;
}

void FxFace::send (int slot, const juce::var& msg)
{
    auto m = juce::JSON::parse (juce::JSON::toString (msg));
    const auto op = m["op"].toString();
    if (op == "open")
    {
        if (reverb == nullptr)
            reverb = std::make_unique<FxReverb> (*this);
        reverb->open (slot);
        return;
    }
    if (op == "advanced")
        return;
    if (op == "slot")
    {
        // A slot's own fields changed (an EQ band's switch or type): the rack set again.
        auto rack = juce::JSON::parse (juce::JSON::toString (infoV["rack"]));
        if (auto* slots = rack["slots"].getArray(); slots != nullptr && slot < slots->size())
            slots->set (slot, m["slot"]);
        put (rack, "op", "set");
        m = rack;
    }
    else
        put (m, "at", slot);
    if (op == "param")
    {
        fx ("rack", m);
        if (reverb != nullptr)
            reverb->changed();
        return;   // the card has its new value already
    }
    auto answer = fx ("rack", m);
    if (answer.isObject())
        reload();
    if (isPage && (op == "bypass" || op == "face" || op == "slot"))
    {
        mark ({ cardX (slot), railBox.getY() - 4, slot < (int) cards.size() ? cards[(size_t) slot]->width() : 400, 408 });
        mark ({ 0, 38, 700, 44 });
    }
    else
        mark (isPage ? juce::Rectangle<float> (0, 0, 1388, 990) : getLocalBounds().toFloat());
    if (reverb != nullptr)
        reverb->changed();
}

void FxFace::indexPage()
{
    const auto& cap = face::page ("fx");
    ids.clear();
    look.clear();
    eachIn (cap["pageOpen"]["tree"], [this] (const juce::var& n) {
        const auto nid = n["id"].toString();
        if (nid.isNotEmpty())
            ids[nid] = { rectOf (n["rect"]), n };
        if (hasClass (n, "fx-module-viewport"))
            viewport = rectOf (n["rect"]);
        const auto f = n["data"]["f"].toString();
        if (hasClass (n, "gs-chip") && f.isNotEmpty())
            ids["from:" + f] = { rectOf (n["rect"]), n };
        if (hasClass (n, "fx-row") && ! look.count ("row"))
            look["row"] = n;
        if (hasClass (n, "gs-tile") && n["data"].hasProperty ("ci") && ! look.count ("tile"))
            look["tile"] = n;
        if (hasClass (n, "gs-chip") && hasClass (n, "on") && f.isNotEmpty())
            look["chipOn"] = n;
        if (hasClass (n, "gs-chip") && ! hasClass (n, "on") && f.isNotEmpty() && ! look.count ("chipOff"))
            look["chipOff"] = n;
    });
    railBox = ids.count ("fxModuleRail") ? ids["fxModuleRail"].r : juce::Rectangle<float> (14, 312, 706, 400);
    // Left out of the frame: what is drawn live.
    auto build = [&] (std::unique_ptr<face::Chrome>& ch, const juce::var& t) {
        ch = std::make_unique<face::Chrome> (t);
        eachIn (t["tree"], [&] (const juce::var& n) {
            const int ni = (int) n["i"];
            const auto nid = n["id"].toString();
            if (nid == "fxModuleRail" || nid == "gsFxAddCard" || nid == "fxPcList" || nid == "fxFrom")
                ch->skip.insert (ni);
            if (hasClass (n, "gs-tile") || nid == "gsFxPlus")
                ch->skip.insert (ni);
            if (nid == "fxOpenName" || nid == "fxOpenLen" || nid == "fxOpenNote" || nid == "fxPcCount" || nid == "gsFdLRo" || nid == "gsFdLRRo" || nid == "gsFdRRo" || nid == "gsMeta")
                ch->skipText.insert (ni);
            if (textOf (n) == "No preset")
                ch->skipText.insert (ni);
        });
    };
    build (frame, cap["page"]);
    build (frameOpen, cap["pageOpen"]);
    // MGL's Now bar is the shell's: Edit's capture has it (every theme), and
    // FX's own capture of it came out hidden.
    const auto& now = face::page ("edit")["nowbarOpen"];
    nowFrame = std::make_unique<face::Chrome> (now);
    eachIn (now["tree"], [this] (const juce::var& n) {
        const auto nid = n["id"].toString();
        if (nid.isNotEmpty())
            ids["now:" + nid] = { rectOf (n["rect"]), n };
        if (nid == "timeNow" || nid == "nbName" || nid == "nbMeta")
            nowFrame->skipText.insert ((int) n["i"]);
    });
    stampSeen = face::stamp();
    frameImage = {};
}

// ───────────────────────────────────────────────────────────── live

void FxFace::timerCallback()
{
    if (stampSeen != face::stamp())
    {
        if (isPage)
            indexPage();
        for (auto& c : cards)
            c->set (c->slot());
        repaint();
    }
    // What it holds read again now and then (a sound cabled in, a patch loaded).
    if (++ticks % 30 == 0 && dragCard < 0 && dragFader.isEmpty())
    {
        const auto before = juce::JSON::toString (infoV["rack"]) + juce::JSON::toString (infoV["sound"]);
        const auto v = fx ("info");
        if (v.isObject() && juce::JSON::toString (v["rack"]) + juce::JSON::toString (v["sound"]) != before)
            readInfo (v);
    }
    // The output, for OUT, SPECTRUM and the meters.
    std::vector<float> mono (2048);
    const auto t = fx ("transport", obj());
    if (t.isObject())
    {
        const bool was = playing;
        playing = (bool) t["playing"];
        position = dnum (t["position"]);
        peakL = dnum (t["peakL"]) > 0 ? 20 * std::log10 (dnum (t["peakL"])) : -120;
        peakR = dnum (t["peakR"]) > 0 ? 20 * std::log10 (dnum (t["peakR"])) : -120;
        if (was != playing && isPage)
            mark ({ -pageX, nowY, 1500, 48 });
    }
    const auto lv = fx ("levels");
    if (auto* st = lv["stages"].getArray())
    {
        for (int i = 0; i < (int) cards.size() && i + 1 <= st->size(); ++i)
        {
            const auto in = (*st)[i];
            const double pk = juce::jmax (dnum (in[0]), dnum (in[1]));
            const double tel = dnum (lv["telemetry"][i]);
            cards[(size_t) i]->setLive (pk > 0 ? std::optional<double> (20 * std::log10 (pk)) : std::nullopt, tel);
        }
        if (auto* last = st->size() > 0 ? &st->getReference (st->size() - 1) : nullptr)
        {
            const double l = dnum ((*last)[0]), r = dnum ((*last)[1]);
            vuL = l > 0 ? 20 * std::log10 (l) : -120;
            vuR = r > 0 ? 20 * std::log10 (r) : -120;
        }
    }
    const int got = (int) call ([&] (NaApp* a) { return (int64_t) na_fx_scope (a, id, mono.data(), (uint32_t) mono.size()); });
    outL.assign (mono.begin(), mono.begin() + juce::jmax (0, got));
    outR = outL;
    if (isPage)
    {
        mark ({ 14, 732, 1360, 220 });
        for (int i = 0; i < (int) cards.size(); ++i)
            if (cards[(size_t) i]->kind().contains ("comp") || cards[(size_t) i]->kind().contains ("gate") || cards[(size_t) i]->kind().contains ("maximizer"))
                mark ({ cardX (i), railBox.getY(), cards[(size_t) i]->width(), 400 });
        if (playing)
            mark ({ -pageX, nowY, 1500, 48 });
    }
}

void FxFace::mark (juce::Rectangle<float> a)
{
    const auto r = (isPage ? a.translated (pageX, 0) : a).getSmallestIntegerContainer().expanded (2);
    dirty.push_back (r);
    repaint (r);
}

double FxFace::paintDirty (float scale)
{
    auto list = dirty;
    dirty.clear();
    const auto t0 = juce::Time::getMillisecondCounterHiRes();
    juce::Rectangle<int> all;
    for (const auto& r : list)
        all = all.isEmpty() ? r : all.getUnion (r);
    if (all.isEmpty())
        return 0;
    juce::Image im (juce::Image::ARGB, juce::jmax (1, (int) ((float) all.getWidth() * scale)), juce::jmax (1, (int) ((float) all.getHeight() * scale)), true);
    juce::Graphics g (im);
    g.addTransform (juce::AffineTransform::translation ((float) -all.getX(), (float) -all.getY()).scaled (scale));
    g.reduceClipRegion (all);
    paint (g);
    return juce::Time::getMillisecondCounterHiRes() - t0;
}

// ───────────────────────────────────────────────────────────── the PC's library

void FxFace::loadPc()
{
    pcList = juce::var();
    juce::Component::SafePointer<FxFace> self (this);
    juce::Thread::launch ([self] {
        juce::URL url (SoundFace::server() + "/api/pc/library");
        juce::String body;
        if (auto in = url.createInputStream (juce::URL::InputStreamOptions (juce::URL::ParameterHandling::inAddress).withConnectionTimeoutMs (4000)))
            body = in->readEntireStreamAsString();
        auto v = juce::JSON::parse (body);
        juce::MessageManager::callAsync ([self, v, body] {
            if (self == nullptr)
                return;
            self->pcList = v.isArray() ? v : juce::var (juce::Array<juce::var>());
            if (! v.isArray())
                self->pcList.getDynamicObject();
            self->repaint();
        });
    });
}

juce::Array<juce::var> FxFace::pcHits() const
{
    juce::Array<juce::var> out;
    if (auto* l = pcList.getArray())
        for (const auto& x : *l)
        {
            const bool fromOk = fromFilter == "all" || (fromFilter == "mgl" ? x["source"].toString() == "MGL" : x["model"].toString() == fromFilter);
            const auto words = (x["prompt"].toString() + " " + x["label"].toString()).toLowerCase();
            if (fromOk && (query.isEmpty() || words.contains (query)))
                out.add (x);
        }
    return out;
}

// ───────────────────────────────────────────────────────────── drawing

void FxFace::text (juce::Graphics& g, const juce::String& nid, const juce::String& t, juce::Justification just)
{
    if (auto it = ids.find (nid); it != ids.end())
        face::paintText (g, it->second.n, it->second.r, t, just);
}

void FxFace::paint (juce::Graphics& g)
{
    if (! isPage)
    {
        if (! cards.empty())
            cards[0]->paint (g, {});
        return;
    }
    const auto clip = g.getClipBounds().toFloat();
    // The window's middle around the page, as MGL's.
    g.fillAll (face::colour (face::page ("fx")["page"]["backdrop"]));
    {
        juce::Graphics::ScopedSaveState keep (g);
        g.addTransform (juce::AffineTransform::translation (pageX, 0));
        const auto pc = clip.translated (-pageX, 0);
        // The page's foot is under the Now bar, as in MGL's window.
        g.reduceClipRegion (juce::Rectangle<int> (0, 0, 1388, (int) nowY));
        drawFrame (g);
        if (pc.intersects (juce::Rectangle<float> (0, 0, 1388, 90)))
        {
            drawPresetBar (g);
            drawStrip (g);
        }
        if (pc.intersects (juce::Rectangle<float> (0, 86, 1388, 180)))
            drawSources (g);
        if (pc.intersects (viewport))
            drawRail (g);
        if (pc.intersects (juce::Rectangle<float> (0, 730, 1388, 260)))
            drawBottom (g);
        if (picker.isNotEmpty())
            drawPicker (g);
    }
    if (clip.intersects (juce::Rectangle<float> (0, nowY, 1500, 48)))
        drawNow (g);
}

void FxFace::drawFrame (juce::Graphics& g)
{
    const bool open = soundInfo.isObject() && dnum (soundInfo["frames"]) > 0;
    const float scale = juce::jmax (1.0f, g.getInternalContext().getPhysicalPixelScaleFactor());
    const auto sig = juce::String (open ? "open" : "closed") + juce::String (scale) + juce::String (face::stamp());
    if (frameSig != sig || frameImage.isNull())
    {
        frameSig = sig;
        frameImage = juce::Image (juce::Image::ARGB, (int) std::ceil (1388 * scale), (int) std::ceil (990 * scale), true);
        juce::Graphics ig (frameImage);
        ig.addTransform (juce::AffineTransform::scale (scale));
        (open ? frameOpen : frame)->paintLook (ig);
    }
    g.setOpacity (1.0f);
    g.drawImage (frameImage, { 0, 0, 1388, 990 });
}

void FxFace::drawPresetBar (juce::Graphics& g)
{
    const auto name = infoV["preset"].toString();
    if (auto* n = findIn (face::page ("fx")["page"]["tree"], [] (const juce::var& x) { return textOf (x) == "No preset"; }))
        face::paintText (g, *n, rectOf ((*n)["rect"]), name.isEmpty() ? juce::String ("No preset") : name);
    // A/B: the side shown lit.
    if (auto* ab = findIn (face::page ("fx")["page"]["tree"], [] (const juce::var& x) { return x["id"].toString() == "gsAB"; }))
        if (auto* kids = (*ab)["kids"].getArray(); kids != nullptr && kids->size() >= 2)
        {
            const bool b = infoV["side"].toString() == "b";
            const auto* on = findIn (*ab, [] (const juce::var& x) { return hasClass (x, "on"); });
            const auto* off = findIn (*ab, [&] (const juce::var& x) { return x["tag"].toString() == "button" && ! hasClass (x, "on"); });
            if (on != nullptr && off != nullptr)
                for (int k = 0; k < 2; ++k)
                {
                    const auto& btn = (*kids)[k];
                    const auto* lk = (k == 1) == b ? on : off;
                    face::paintBox (g, *lk, rectOf (btn["rect"]));
                    face::paintText (g, *lk, rectOf (btn["rect"]), textOf (btn), juce::Justification::centred);
                }
        }
}

void FxFace::drawStrip (juce::Graphics& g)
{
    // FX, each slot's tile (its light, its picture, its short name), ＋.
    const auto& lk = look["tile"];
    if (! lk.isObject())
        return;
    const auto t0 = rectOf (lk["rect"]);
    float x = t0.getX();
    const auto font = face::mono (11, 600);
    for (int i = 0; i < (int) cards.size(); ++i)
    {
        const auto& c = *cards[(size_t) i];
        // The page's own tile for this kind where its capture has one.
        if (auto* own = findIn (face::page ("fx")["page"]["tree"], [&] (const juce::var& n) { return hasClass (n, "gs-tile") && n["data"]["kind"].toString() == c.kind(); }))
        {
            const auto r0 = rectOf ((*own)["rect"]);
            frame->drawPart (g, *own, { x - r0.getX(), 0 });
            if ((bool) c.slot()["bypassed"])
            {
                g.setColour (juce::Colours::black.withAlpha (0.45f));
                g.fillRoundedRectangle (r0.withX (x).reduced (1), 6);
            }
            ids["tile:" + juce::String (i)] = { r0.withX (x), *own };
            x += r0.getWidth() + 11;   // the strip's gap (the page's tiles)
            continue;
        }
        const auto name = shortName (c.kind(), api);
        const float w = 44 + juce::GlyphArrangement::getStringWidth (font, name);
        juce::Rectangle<float> r (x, t0.getY(), w, t0.getHeight());
        face::paintBox (g, lk, r);
        const bool on = ! (bool) c.slot()["bypassed"];
        g.setColour (on ? c2d::css (face::page ("fx")["cl"]["on"].toString()) : juce::Colours::grey.withAlpha (0.5f));
        g.fillEllipse (x + 8, r.getCentreY() - 3.5f, 7, 7);
        g.setColour (c2d::css (face::page ("fx")["cl"]["--gs-t"].toString()));
        g.setFont (font);
        g.drawText (name, juce::Rectangle<float> (x + 40, r.getY(), w - 40, r.getHeight()), juce::Justification::centredLeft);
        ids["tile:" + juce::String (i)] = { r, lk };
        x += w + 11;
    }
    if (auto it = ids.find ("gsFxPlus"); it != ids.end())
    {
        const auto r = it->second.r.withX (x - 7);   // ＋ sits 4 after the last tile
        face::paintBox (g, it->second.n, r);
        face::paintText (g, it->second.n, r, uni ("\xef\xbc\x8b"), juce::Justification::centred);
        ids["plus"] = { r, it->second.n };
    }
}

void FxFace::drawSources (juce::Graphics& g)
{
    const bool open = soundInfo.isObject() && dnum (soundInfo["frames"]) > 0;
    const auto name = soundInfo["origin"]["name"].toString();
    text (g, "fxOpenName", open ? (name.isEmpty() ? juce::String ("sound") : name) : "Nothing open");
    const double secs = open ? dnum (soundInfo["frames"]) / juce::jmax (1.0, dnum (soundInfo["rate"], 48000)) : 0;
    text (g, "fxOpenLen", open ? fixed (secs, 2) + " s" : juce::String());
    text (g, "fxOpenNote", open ? "Played straight, through the effects below. Add one with + Add effect."
                                : "Pick a sound from the PC's library, or double-click one in your library (the drawer).");
    // The PC's library: its chips with their counts, the count, the rows.
    const auto list = pcList.getArray();
    const auto hits = pcHits();
    text (g, "fxPcCount", list != nullptr ? juce::String (hits.size()) + " of " + juce::String (list->size()) : juce::String(), juce::Justification::centredRight);
    static const char* FROM[][2] = { { "all", "All" }, { "stable-audio-open-small", "Stable Audio" }, { "tangoflux", "TangoFlux" }, { "ace-step-1.5", "ACE-Step" }, { "mgl", "Made for MGL" } };
    float cx = ids.count ("from:all") ? ids["from:all"].r.getX() : 371;
    for (const auto& f : FROM)
    {
        int n = 0;
        if (list != nullptr)
            for (const auto& x : *list)
                n += (juce::String (f[0]) == "all" || (juce::String (f[0]) == "mgl" ? x["source"].toString() == "MGL" : x["model"].toString() == f[0])) ? 1 : 0;
        const auto& lk = fromFilter == f[0] ? look["chipOn"] : look["chipOff"];
        if (! lk.isObject())
            continue;
        const auto label = juce::String (f[1]) + uni (" \xc2\xb7 ") + juce::String (n);
        const auto r0 = rectOf (lk["rect"]);
        const float w = juce::GlyphArrangement::getStringWidth (face::font (lk["text"][0]["font"]), label) + 18;
        juce::Rectangle<float> r (cx, r0.getY(), w, r0.getHeight());
        face::paintBox (g, lk, r);
        face::paintText (g, lk, r, label, juce::Justification::centred);
        ids["from:" + juce::String (f[0])] = { r, lk };
        cx += w + 4;
    }
    // The search's placeholder, as the page shows it while empty.
    if (query.isEmpty() && ids.count ("fxQ") > 0 && (search == nullptr || ! search->isVisible()))
    {
        g.setColour (c2d::css (face::page ("fx")["cl"]["--gs-t3"].toString()));
        g.setFont (face::sans (11));
        g.drawText ("search the words", ids["fxQ"].r.withTrimmedLeft (8), juce::Justification::centredLeft);
    }
    const auto& box = ids["fxPcList"];
    const auto& row = look["row"];
    juce::Graphics::ScopedSaveState keep (g);
    g.reduceClipRegion (box.r.toNearestInt());
    if (list == nullptr || hits.isEmpty() || ! row.isObject())
    {
        if (box.ok())
        {
            g.setColour (c2d::css (face::page ("fx")["cl"]["--gs-t3"].toString()));
            g.setFont (face::sans (11));
            g.drawText (list == nullptr ? uni ("reading the PC\xe2\x80\x99s library\xe2\x80\xa6") : list->isEmpty() ? uni ("Nothing in the PC\xe2\x80\x99s library yet.") : juce::String ("Nothing matches."),
                        box.r.withHeight (16).translated (2, 2), juce::Justification::centredLeft);
        }
        return;
    }
    const auto r0 = rectOf (row["rect"]);
    for (int i = 0; i < juce::jmin (pcShown, hits.size()); ++i)
    {
        juce::Rectangle<float> r (box.r.getX() + (float) (i % 2) * (r0.getWidth() + 10), box.r.getY() + (float) (i / 2) * (r0.getHeight() + 3), r0.getWidth(), r0.getHeight());
        if (r.getY() > box.r.getBottom())
            break;
        face::paintBox (g, row, r);
        const auto& x = hits[i];
        const auto words = (x["label"].toString().isNotEmpty() ? x["label"].toString() + uni (" \xc2\xb7 ") : juce::String()) + (x["prompt"].toString().isNotEmpty() ? x["prompt"].toString() : x["file"].toString().fromLastOccurrenceOf ("/", false, false));
        g.setColour (c2d::css (face::page ("fx")["cl"]["--gs-t"].toString()));
        g.setFont (face::sans (11));
        g.drawText (uni ("\xe2\x96\xb6"), r.withWidth (18).translated (4, 0), juce::Justification::centred);
        g.drawText (words, r.withTrimmedLeft (26).withTrimmedRight (170), juce::Justification::centredLeft, true);
        g.setColour (c2d::css (face::page ("fx")["cl"]["--gs-t3"].toString()));
        g.setFont (face::mono (10));
        const auto model = x["model"].toString();
        const auto shortModel = model == "stable-audio-open-small" ? juce::String ("Small") : model == "tangoflux" ? juce::String ("TangoFlux") : model == "ace-step-1.5" ? juce::String ("ACE-Step") : model;
        g.drawText (shortModel + (x["source"].toString() == "MGL" ? uni (" \xc2\xb7 MGL") : juce::String()) + uni (" \xc2\xb7 ") + fixed (dnum (x["seconds"]), 1) + " s", r.withTrimmedRight (6), juce::Justification::centredRight);
        ids["pc:" + juce::String (i)] = { r, x };
    }
}

void FxFace::drawRail (juce::Graphics& g)
{
    juce::Graphics::ScopedSaveState keep (g);
    g.reduceClipRegion (viewport.expanded (0, 4).toNearestInt());
    for (int i = 0; i < (int) cards.size(); ++i)
    {
        const float x = cardX (i);
        if (x > viewport.getRight() || x + cards[(size_t) i]->width() < viewport.getX())
            continue;
        cards[(size_t) i]->front = i == front;
        cards[(size_t) i]->paint (g, { x, railBox.getY() });
    }
    // The ADD card after the last.
    const auto& cap = face::page ("fx")["page"];
    if (auto* add = findIn (cap["tree"], [] (const juce::var& x) { return x["id"].toString() == "gsFxAddCard"; }))
    {
        const float x = cardX ((int) cards.size());
        const auto r = rectOf ((*add)["rect"]);
        frame->drawPart (g, *add, { x - r.getX(), 0 });
        ids["add"] = { r.withX (x), *add };
    }
}

void FxFace::drawBottom (juce::Graphics& g)
{
    const auto& cl = face::page ("fx")["cl"];
    auto canvasAt = [&] (const char* k, const std::function<void (c2d::Context&, float, float)>& draw) {
        if (auto it = ids.find (k); it != ids.end())
        {
            juce::Graphics::ScopedSaveState keep (g);
            g.reduceClipRegion (it->second.r.toNearestInt());
            g.setOrigin (it->second.r.getPosition().toInt());
            c2d::Context c (g, it->second.r.getWidth(), it->second.r.getHeight());
            draw (c, it->second.r.getWidth(), it->second.r.getHeight());
        }
    };
    static gpic::State picState;
    gpic::FxMeters m;
    for (size_t i = 0; i < outL.size(); i += juce::jmax ((size_t) 1, outL.size() / 512))
    {
        m.lissajous.push_back (outL[i]);
        m.lissajous.push_back (outR[i]);
    }
    gpic::Inputs in;
    in.note = soundInfo.isObject() ? juce::String() : juce::String ("Open a sound");
    bool sounding = false;
    for (auto x : outL)
        sounding = sounding || std::abs (x) > 1.0e-6f;
    if (sounding || playing)
    {
        canvasAt ("gsFxOut", [&] (c2d::Context& c, float w, float h) { gpic::fxWave (c, w, h, in, picState, m); });
        canvasAt ("gsFxSpec", [&] (c2d::Context& c, float w, float h) { gpic::fxSpectrum (c, w, h, in, picState, m); });
    }
    const auto track = cl["track"].toString(), bloom = cl["bloom"].toString(), tcol = cl["t"].toString(), t3 = cl["t3"].toString(), on = cl["on"].toString(), acc = cl["acc"].toString(), mono = cl["mono"].toString();
    auto fader = [&] (const char* cid, const char* ro, double u, const juce::String& txt) {
        canvasAt (cid, [&] (c2d::Context& c, float w, float h) {
            const float y = 8 + (float) (1 - u) * (h - 16);
            c.setFill (track);
            c.fillRect (w / 2 - 1, 8, 2, h - 16);
            c.setFill ("rgba(" + bloom + ",.55)");
            c.fillRect (w / 2 - 1, y, 2, h - 8 - y);
            c.setFill (tcol);
            c.beginPath();
            c.roundRect (w / 2 - 12, y - 3, 24, 6, 2);
            c.fill();
        });
        text (g, ro, txt, juce::Justification::centred);
    };
    fader ("gsFdLR", "gsFdLRRo", volume, juce::String ((int64_t) std::floor (volume * 100 + 0.5)) + "%");
    fader ("gsFdL", "gsFdLRo", sideL, sideText (sideL));
    fader ("gsFdR", "gsFdRRo", sideR, sideText (sideR));
    // The meters (the page's gsFxDrawOutput).
    double corrNow = 0;
    {
        double lr = 0, ll = 0, rr = 0;
        for (size_t i = 0; i < outL.size(); ++i)
        {
            lr += outL[i] * outR[i];
            ll += outL[i] * outL[i];
            rr += outR[i] * outR[i];
        }
        corrNow = ll > 1e-12 && rr > 1e-12 ? lr / std::sqrt (ll * rr) : 0;
        corr = corr * 0.8 + corrNow * 0.2;
    }
    canvasAt ("gsFxMeters", [&] (c2d::Context& c, float w, float h) {
        const float top = 30, bot = h - 34;
        auto y = [&] (double db) { return top + (float) (juce::jmax (-60.0, juce::jmin (6.0, db)) / -66 + 6.0 / 66) * (bot - top); };
        auto dbText = [] (double d) { return d <= -119 ? uni ("\xe2\x88\x92\xe2\x88\x9e") : fixed (d, 1); };
        c.font = "9px " + mono;
        c.setFill (t3);
        c.textAlign = "left";
        c.fillText ("PEAK", 6, 11);
        c.textAlign = "right";
        c.fillText (dbText (peakL) + "  " + dbText (peakR) + " dB", w - 6, 11);
        for (int db : { 6, 0, -6, -12, -24, -36, -48, -60 })
        {
            c.fillText (db > 0 ? "+" + juce::String (db) : juce::String (db), w - 4, y (db) + 3);
            c.setFill ("rgba(255,255,255,.05)");
            c.fillRect (44, y (db), w - 76, 1);
            c.setFill (t3);
        }
        c.textAlign = "center";
        for (int k = 0; k < 2; ++k)
        {
            const float x = k == 0 ? 60.0f : 100.0f;
            c.setFill (t3);
            c.fillText (k == 0 ? "L" : "R", x, top - 5);
            c.setFill ("rgba(255,255,255,.06)");
            c.fillRect (x - 6, top, 12, bot - top);
            const double vu = k == 0 ? vuL : vuR, pk = k == 0 ? peakL : peakR;
            if (vu <= -119)
                continue;
            c.setFill ("rgba(" + bloom + ",.8)");
            const float yy = y (juce::jmax (-60.0, vu));
            c.fillRect (x - 6, yy, 12, bot - yy);
            c.setFill (on);
            c.fillRect (x - 6, y (pk), 12, 2);
        }
        const float cy = h - 14, x0 = 8, cw = w - 16;
        c.setFill ("rgba(255,255,255,.06)");
        c.fillRect (x0, cy - 3, cw, 6);
        c.setFill ("rgba(255,255,255,.2)");
        c.fillRect (x0 + cw / 2 - 0.5f, cy - 6, 1, 12);
        const float cv = x0 + (float) (corr + 1) / 2 * cw;
        c.setFill (corr < 0 ? juce::String ("#ff6b5e") : acc);
        c.fillRect (juce::jmin (cv, x0 + cw / 2), cy - 3, std::abs (cv - (x0 + cw / 2)), 6);
        c.setFill (t3);
        c.textAlign = "left";
        c.fillText (uni ("\xe2\x88\x92") + "1", x0, cy - 7);
        c.textAlign = "right";
        c.fillText ("+1", x0 + cw, cy - 7);
        c.textAlign = "center";
        c.fillText ("CORR " + juce::String (corr >= 0 ? "+" : uni ("\xe2\x88\x92")) + fixed (std::abs (corr), 2), w / 2, cy - 7);
    });
}

void FxFace::drawNow (juce::Graphics& g)
{
    // MGL's Now bar, the page's transport, under the page across the middle.
    const auto& cap = face::page ("fx");
    juce::Graphics::ScopedSaveState keep (g);
    g.addTransform (juce::AffineTransform::translation (0, nowY));
    nowFrame->paintLook (g);
    auto t = [&] (const char* k, const juce::String& s, juce::Justification j = juce::Justification::centredLeft) {
        if (auto it = ids.find ("now:" + juce::String (k)); it != ids.end())
            face::paintText (g, it->second.n, it->second.r, s, j);
    };
    const double rate = juce::jmax (1.0, dnum (soundInfo["rate"], 48000));
    t ("timeNow", clock (position / rate));
    t ("nbName", soundInfo.isObject() ? soundInfo["origin"]["name"].toString() : juce::String ("Nothing open"));
    t ("nbMeta", soundInfo.isObject() ? fixed (dnum (soundInfo["frames"]) / rate, 2) + " s" : juce::String());
    if (playing)
        if (auto it = ids.find ("now:playBtn"); it != ids.end())
        {
            g.setColour (c2d::css (cap["cl"]["on"].toString()).withAlpha (0.35f));
            g.drawRoundedRectangle (it->second.r.reduced (1), 6, 1.5f);
        }
}

void FxFace::drawPicker (juce::Graphics& g)
{
    // The Add menu over the page: the modules, or one module's modes.
    const auto& cap = face::page ("fx")["picker"];
    const auto& tree = cap[juce::Identifier (picker)];
    if (! tree.isObject())
        return;
    static std::map<juce::String, std::unique_ptr<face::Chrome>> chromes;
    static int seen = -1;
    if (seen != face::stamp())
    {
        chromes.clear();
        seen = face::stamp();
    }
    auto& ch = chromes[picker];
    if (ch == nullptr)
        ch = std::make_unique<face::Chrome> (tree);
    const auto r = rectOf (tree["tree"]["rect"]);
    const float tall = juce::jmin (r.getHeight(), 900.0f);
    const juce::Point<float> at ((1388 - r.getWidth()) / 2, 60);
    g.setColour (juce::Colours::black.withAlpha (0.35f));
    g.fillRect (juce::Rectangle<float> (-pageX, 0, 1500, 990));
    juce::Graphics::ScopedSaveState keep (g);
    g.reduceClipRegion (juce::Rectangle<float> (at.x, at.y, r.getWidth(), tall).toNearestInt());
    ch->drawPart (g, tree["tree"], at);
    pickHits.clear();
    eachIn (tree["tree"], [&] (const juce::var& n) {
        const auto rr = rectOf (n["rect"]) + at;
        const auto& d = n["data"];
        if (hasClass (n, "fx-picker-cat") && d.hasProperty ("group"))
            pickHits.push_back ({ rr, [this, grp = d["group"].toString()] { openPicker (grp); } });
        if (hasClass (n, "fx-picker-item") && d.hasProperty ("kind"))
        {
            // The card itself drawn small in its thumbnail, as the page does.
            if (auto* th = findIn (n, [] (const juce::var& x) { return hasClass (x, "fx-picker-thumb"); }))
            {
                // Each card drawn once, small, and kept.
                static std::map<juce::String, juce::Image> thumbs;
                static int thumbsFor = -1;
                if (thumbsFor != face::stamp())
                {
                    thumbs.clear();
                    thumbsFor = face::stamp();
                }
                const auto tr = rectOf ((*th)["rect"]) + at;
                auto& im = thumbs[d["kind"].toString()];
                if (im.isNull())
                {
                    FxCard thumb (api);
                    auto slot = obj();
                    put (slot, "kind", d["kind"]);
                    put (slot, "id", "thumb");
                    thumb.set (slot);
                    const float s = juce::jmin (tr.getWidth() / thumb.width(), tr.getHeight() / thumb.height()) * 2;
                    im = juce::Image (juce::Image::ARGB, juce::jmax (1, (int) (thumb.width() * s)), juce::jmax (1, (int) (thumb.height() * s)), true);
                    juce::Graphics tg (im);
                    tg.addTransform (juce::AffineTransform::scale (s));
                    thumb.paint (tg, {});
                }
                const float w = (float) im.getWidth() / 2, h = (float) im.getHeight() / 2;
                g.setOpacity (1.0f);
                g.drawImage (im, { tr.getX() + (tr.getWidth() - w) / 2, tr.getY(), w, h });
            }
            pickHits.push_back ({ rr, [this, k = d["kind"].toString(), s = d["suite"].toString(), m = d["mode"].toString()] {
                auto o = obj();
                put (o, "op", "add");
                put (o, "kind", k);
                put (o, "suite", s);
                put (o, "mode", m);
                if (auto* ss = api["suites"].getArray())
                    for (const auto& su : *ss)
                        if (auto* fs = su["families"].getArray())
                            for (const auto& f : *fs)
                                if (auto* ms = f["modes"].getArray())
                                    for (const auto& md : *ms)
                                        if (su["id"].toString() == s && md["id"].toString() == m)
                                            put (o, "rev", md["rev"]);
                picker.clear();
                fx ("rack", o);
                reload();
                front = (int) cards.size() - 1;
                scroll = juce::jmax (0.0f, cardX ((int) cards.size()) + scroll + 196 - viewport.getRight());
                say ("Added " + (cards.empty() ? k : shortName (k, api)));
            } });
        }
        if (n["id"].toString() == "fxPickerClose")
            pickHits.push_back ({ rr, [this] { picker.clear(); repaint(); } });
        if (n["id"].toString() == "fxPickerBack")
            pickHits.push_back ({ rr, [this] { openPicker ("top"); } });
    });
}

void FxFace::openPicker (const juce::String& which)
{
    picker = which;
    mark ({ 0, 0, 1388, 990 });
}

// ───────────────────────────────────────────────────────────── the hand

juce::Rectangle<float> FxFace::where (const juce::String& part) const
{
    auto pg = [this] (juce::Rectangle<float> r) { return isPage ? r.translated (pageX, 0) : r; };
    auto has = [this] (const juce::String& k) { auto it = ids.find (k); return it == ids.end() ? juce::Rectangle<float>() : it->second.r; };
    if (part.startsWith ("card:"))
    {
        const int i = part.fromFirstOccurrenceOf ("card:", false, false).getIntValue();
        if (i < 0 || i >= (int) cards.size())
            return {};
        const juce::Point<float> at = isPage ? juce::Point<float> (cardX (i), railBox.getY()) : juce::Point<float>();
        const auto sub = part.fromFirstOccurrenceOf ("/", false, false);
        const auto r = sub.isEmpty() ? juce::Rectangle<float> (0, 0, cards[(size_t) i]->width(), 400) : cards[(size_t) i]->where (sub);
        return pg (r + at);
    }
    if (part == "fader:l") return pg (has ("gsFdL"));
    if (part == "fader:lr") return pg (has ("gsFdLR"));
    if (part == "fader:r") return pg (has ("gsFdR"));
    if (part == "play") return has ("now:playBtn").translated (0, nowY);
    if (part == "stop") return has ("now:stopBtn").translated (0, nowY);
    if (part == "loop") return has ("now:loopBtn").translated (0, nowY);
    if (part == "addChip") return pg (has ("gsFxAddChip"));
    if ((part.startsWith ("addItem:") || part.startsWith ("addCat:")) && picker.isEmpty())
        return {};
    if (part.startsWith ("addItem:") || part.startsWith ("addCat:"))
    {
        const auto& cap = face::page ("fx")["picker"][juce::Identifier (picker)];
        const auto r0 = rectOf (cap["tree"]["rect"]);
        const juce::Point<float> at ((1388 - r0.getWidth()) / 2, 60);
        juce::Rectangle<float> out;
        eachIn (cap["tree"], [&] (const juce::var& n) {
            const auto& d = n["data"];
            if (part.startsWith ("addItem:") && d["suite"].toString() + "/" + d["mode"].toString() == part.fromFirstOccurrenceOf (":", false, false) && hasClass (n, "fx-picker-item"))
                out = rectOf (n["rect"]) + at;
            if (part.startsWith ("addCat:") && d["group"].toString() == part.fromFirstOccurrenceOf (":", false, false) && hasClass (n, "fx-picker-cat"))
                out = rectOf (n["rect"]) + at;
        });
        return pg (out);
    }
    return pg (has (part));
}

void FxFace::mouseDown (const juce::MouseEvent& e)
{
    if (blocked && blocked (e))
        return;
    const auto p = toPage (e.position);
    downAt = p;
    dragCard = dragFrom = -1;
    dragFader.clear();
    if (! isPage)
    {
        if (! cards.empty() && cards[0]->mouseDown (p, e.mods))
        {
            dragCard = 0;
            repaint();
        }
        return;
    }
    if (picker.isNotEmpty())
    {
        for (const auto& [r, f] : pickHits)
            if (r.contains (p))
            {
                f();
                repaint();
                return;
            }
        const auto r0 = rectOf (face::page ("fx")["picker"][juce::Identifier (picker)]["tree"]["rect"]);
        if (! juce::Rectangle<float> ((1388 - r0.getWidth()) / 2, 60, r0.getWidth(), r0.getHeight()).contains (p))
            picker.clear();
        repaint();
        return;
    }
    // The Now bar.
    if (e.position.y >= nowY)
    {
        auto o = obj();
        if (where ("play").contains (e.position))
            put (o, "play", ! playing);
        else if (where ("stop").contains (e.position))
        {
            put (o, "play", false);
            put (o, "seek", 0);
        }
        else if (where ("loop").contains (e.position))
        {
            looping = ! looping;
            auto l = obj();
            put (l, "on", looping);
            put (l, "a", 0);
            put (l, "b", 0);
            put (o, "loop", l);
        }
        else
            return;
        fx ("transport", o);
        reload();
        return;
    }
    // A card.
    for (int i = 0; i < (int) cards.size(); ++i)
    {
        const juce::Point<float> at (cardX (i), railBox.getY());
        if (! juce::Rectangle<float> (at.x, at.y, cards[(size_t) i]->width(), 400).contains (p) || ! viewport.contains (p))
            continue;
        front = i;
        if (cards[(size_t) i]->onHeader (p - at))
        {
            dragFrom = i;
            return;
        }
        if (cards[(size_t) i]->mouseDown (p - at, e.mods))
            dragCard = i;
        repaint();
        return;
    }
    if (ids.count ("add") && ids["add"].r.contains (p))
        return openPicker ("top");
    if (ids.count ("plus") && ids["plus"].r.contains (p))
        return openPicker ("top");
    if (where ("addChip").translated (-pageX, 0).contains (p))
        return openPicker ("top");
    for (int i = 0; i < (int) cards.size(); ++i)
        if (auto it = ids.find ("tile:" + juce::String (i)); it != ids.end() && it->second.r.contains (p))
        {
            if (p.x < it->second.r.getX() + 20)
            {
                auto o = obj();
                put (o, "op", "bypass");
                put (o, "on", (bool) cards[(size_t) i]->slot()["bypassed"]);
                send (i, o);
            }
            else
            {
                // Open at that card: scrolled to it, in front.
                front = i;
                scroll = juce::jlimit (0.0f, juce::jmax (0.0f, cardX ((int) cards.size()) + scroll + 196 - viewport.getRight()), cardX (i) + scroll - railBox.getX());
                repaint();
            }
            return;
        }
    // The faders.
    for (const char* f : { "l", "lr", "r" })
        if (where ("fader:" + juce::String (f)).translated (-pageX, 0).contains (p))
        {
            dragFader = f;
            downValue = juce::String (f) == "l" ? sideL : juce::String (f) == "r" ? sideR : volume;
            mouseDrag (e);
            return;
        }
    // The PC's library.
    for (const char* f : { "all", "stable-audio-open-small", "tangoflux", "ace-step-1.5", "mgl" })
        if (ids.count ("from:" + juce::String (f)) && ids["from:" + juce::String (f)].r.contains (p))
        {
            fromFilter = f;
            pcShown = 40;
            repaint();
            return;
        }
    if (ids.count ("fxPcReload") && ids["fxPcReload"].r.contains (p))
        return loadPc();
    if (ids.count ("fxQ") && ids["fxQ"].r.contains (p))
    {
        search->setBounds (ids["fxQ"].r.translated (pageX, 0).toNearestInt());
        search->setVisible (true);
        search->grabKeyboardFocus();
        return;
    }
    for (int i = 0; i < pcShown; ++i)
        if (auto it = ids.find ("pc:" + juce::String (i)); it != ids.end() && it->second.r.contains (p))
        {
            if (wantSound)
                wantSound (it->second.n["file"].toString());
            return;
        }
    if (ids.count ("fxDrawer") && ids["fxDrawer"].r.contains (p))
    {
        if (wantSound)
            wantSound ({});
        return;
    }
    if (ids.count ("fxSave") && ids["fxSave"].r.contains (p))
        return say ("Save with effects: not in the app yet (MGL renders the sound through the chain into an FX folder beside it)");
    // The preset bar.
    auto* tree = &face::page ("fx")["page"]["tree"];
    if (auto* ab = findIn (*tree, [] (const juce::var& x) { return x["id"].toString() == "gsAB"; }))
        if (auto* kids = (*ab)["kids"].getArray())
            for (int k = 0; k < juce::jmin (2, kids->size()); ++k)
                if (rectOf ((*kids)[k]["rect"]).contains (p))
                {
                    auto o = obj();
                    put (o, "op", "ab");
                    put (o, "to", k == 0 ? "a" : "b");
                    fx ("presets", o);
                    reload();
                    return;
                }
    if (ids.count ("gsPb") && ids["gsPb"].r.contains (p))
        return presetMenu();
}

void FxFace::presetMenu()
{
    presets = fx ("presets", [] { auto o = obj(); put (o, "op", "list"); return o; }());
    juce::PopupMenu m;
    juce::StringArray names;
    if (auto* l = presets["presets"].getArray())
        for (const auto& p : *l)
        {
            names.add (p["name"].toString());
            m.addItem (names.size(), p["name"].toString() + (p["from"].toString() == "mgl" ? "  (MGL)" : ""), true, p["name"].toString() == infoV["preset"].toString());
        }
    m.addSeparator();
    m.addItem (10000, "Save as" + uni ("\xe2\x80\xa6"));
    m.showMenuAsync (juce::PopupMenu::Options(), [this, names] (int r) {
        if (r <= 0)
            return;
        auto o = obj();
        if (r == 10000)
        {
            auto* w = new juce::AlertWindow ("Save the rack", "A name for it:", juce::MessageBoxIconType::NoIcon);
            w->addTextEditor ("name", infoV["preset"].toString());
            w->addButton ("Save", 1);
            w->addButton ("Cancel", 0);
            w->enterModalState (true, juce::ModalCallbackFunction::create ([this, w] (int ok) {
                if (ok == 1)
                {
                    auto s = obj();
                    put (s, "op", "save");
                    put (s, "name", w->getTextEditorContents ("name"));
                    fx ("presets", s);
                    reload();
                }
            }), true);
            return;
        }
        put (o, "op", "apply");
        put (o, "name", names[r - 1]);
        fx ("presets", o);
        reload();
    });
}

void FxFace::mouseDrag (const juce::MouseEvent& e)
{
    const auto p = toPage (e.position);
    if (! dragFader.isEmpty())
    {
        const auto r = where ("fader:" + dragFader).translated (-pageX, 0);
        const double u = juce::jlimit (0.0, 1.0, 1.0 - (p.y - r.getY() - 8) / juce::jmax (1.0f, r.getHeight() - 16));
        auto o = obj();
        if (dragFader == "lr")
        {
            volume = u;
            put (o, "volume", u);
        }
        else
        {
            (dragFader == "l" ? sideL : sideR) = u;
            put (o, dragFader == "l" ? "sideL" : "sideR", u);
        }
        fx ("transport", o);
        mark ({ 1024, 732, 170, 220 });
        return;
    }
    if (dragFrom >= 0)
        return;
    if (dragCard >= 0 && dragCard < (int) cards.size())
    {
        const juce::Point<float> at = isPage ? juce::Point<float> (cardX (dragCard), railBox.getY()) : juce::Point<float>();
        cards[(size_t) dragCard]->mouseDrag (p - at, e.mods);
        repaint ((isPage ? juce::Rectangle<float> (at.x + pageX, at.y, cards[(size_t) dragCard]->width(), 400) : getLocalBounds().toFloat()).getSmallestIntegerContainer());
    }
}

void FxFace::mouseUp (const juce::MouseEvent& e)
{
    const auto p = toPage (e.position);
    if (dragFrom >= 0)
    {
        // A card's title dragged along the rail: moved there.
        int to = dragFrom;
        for (int i = 0; i < (int) cards.size(); ++i)
            if (p.x >= cardX (i) && p.x < cardX (i) + cards[(size_t) i]->width() + 10)
                to = i;
        if (to != dragFrom && std::abs (p.x - downAt.x) > 8)
        {
            auto o = obj();
            put (o, "op", "move");
            put (o, "from", dragFrom);
            put (o, "to", to);
            fx ("rack", o);
            front = to;
            reload();
        }
    }
    if (dragCard >= 0 && dragCard < (int) cards.size())
        cards[(size_t) dragCard]->mouseUp();
    dragCard = dragFrom = -1;
    dragFader.clear();
}

void FxFace::mouseDoubleClick (const juce::MouseEvent& e)
{
    const auto p = toPage (e.position);
    for (const char* f : { "l", "lr", "r" })
        if (where ("fader:" + juce::String (f)).translated (-pageX, 0).contains (p))
        {
            // `gsFxResetSides`, and the volume's own default.
            auto o = obj();
            if (juce::String (f) == "lr")
                put (o, "volume", volume = 0.85);
            else
                put (o, juce::String (f) == "l" ? "sideL" : "sideR", (juce::String (f) == "l" ? sideL : sideR) = 0.8);
            fx ("transport", o);
            repaint();
            return;
        }
    for (int i = 0; i < (int) cards.size(); ++i)
    {
        const juce::Point<float> at = isPage ? juce::Point<float> (cardX (i), railBox.getY()) : juce::Point<float>();
        if (juce::Rectangle<float> (at.x, at.y, cards[(size_t) i]->width(), 400).contains (p) && cards[(size_t) i]->doubleClick (p - at))
        {
            repaint();
            return;
        }
    }
}

void FxFace::mouseWheelMove (const juce::MouseEvent& e, const juce::MouseWheelDetails& w)
{
    const auto p = toPage (e.position);
    for (int i = 0; i < (int) cards.size(); ++i)
    {
        const juce::Point<float> at = isPage ? juce::Point<float> (cardX (i), railBox.getY()) : juce::Point<float>();
        if (juce::Rectangle<float> (at.x, at.y, cards[(size_t) i]->width(), 400).contains (p) && std::abs (w.deltaY) > std::abs (w.deltaX)
            && cards[(size_t) i]->wheel (p - at, w.deltaY, e.mods.isShiftDown()))
        {
            repaint();
            return;
        }
    }
    // The rail scrolls sideways (a sideways swipe, or Shift and the wheel).
    if (isPage && viewport.contains (p))
    {
        const float d = std::abs (w.deltaX) > 0 ? w.deltaX : (e.mods.isShiftDown() ? w.deltaY : 0);
        const float most = juce::jmax (0.0f, cardX ((int) cards.size()) + scroll + 196 - viewport.getRight());
        scroll = juce::jlimit (0.0f, most, scroll - d * 200);
        repaint();
        return;
    }
    if (blocked)
        blocked (e);
}
