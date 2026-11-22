#include "WaveFace.h"

#include "Host.h"

namespace
{
float num (const juce::var& v, float fallback = 0.0f)
{
    return v.isVoid() || v.isUndefined() ? fallback : (float) (double) v;
}

juce::Rectangle<float> rectOf (const juce::var& r)
{
    return { num (r[0]), num (r[1]), num (r[2]), num (r[3]) };
}

juce::String json (const juce::var& v)
{
    return juce::JSON::toString (v, true);
}

juce::String dataOf (const juce::var& n, const char* k)
{
    return n["data"][k].toString();
}

bool hasClass (const juce::var& n, const char* c)
{
    return juce::StringArray::fromTokens (n["cls"].toString(), " ", "").contains (c);
}

const juce::String minus = juce::String::fromUTF8 ("\xe2\x88\x92"), dotSep = juce::String::fromUTF8 (" \xc2\xb7 ");
} // namespace

WaveFace::WaveFace (Send s, Patch p, Frames f) : send (std::move (s)), readPatch (std::move (p)), chrome (face::page ("wave"))
{
    const auto& captured = face::page ("wave");
    setSize (chrome.getWidth(), chrome.getHeight());
    addAndMakeVisible (chrome);
    setWantsKeyboardFocus (true);
    cl = wave::colours (captured["vars"]);
    model.loadTable = std::move (f);
    // Kept while it is read: the parsed list lives in it.
    const auto listed = juce::JSON::parse (juce::String (naText ([] (char* b, uint32_t c) { return na_controls ("wave", b, c); })));
    if (auto* list = listed.getArray())
        controls = *list;
    index (captured["tree"], -1);
    for (int i = 0; i < 3; ++i)
        if (auto it = byId.find ("wvOfr" + juce::String (i)); it != byId.end())
            chrome.skipText.insert (it->second.i);

    // The other three views, each the page as it shows that view, over Play's
    // frame and under the header's and the dock's live parts.
    ctx.model = &model;
    ctx.cl = &cl;
    ctx.set = [this] (const juce::String& key, const juce::var& value) { set (key, value); };
    ctx.api = [this] (const juce::String& method, const juce::String& path, const juce::var& body, int& status) {
        status = 0;
        return api ? api (method, path, body, status) : juce::var();
    };
    ctx.reload = [this] { reload(); };
    // The rows changed in a view: to the engine (wvSendMods), and every view told.
    ctx.modsChanged = [this] {
        int status = 0;
        auto* body = new juce::DynamicObject();
        body->setProperty ("mods", wave::modsOut (model));
        if (api)
            api ("POST", "/api/wave/mods", juce::var (body), status);
        modsChanged();
    };
    ctx.closeMenus = [this] { closeMenu(); };
    const auto& other = face::page ("wave-views")["views"];
    const char* names[] = { "create", "matrix", "fx" };
    for (int v = 0; v < 3; ++v)
    {
        const auto& cap = other[names[v]];
        if (!cap.isObject())
            continue;
        views[v] = v == 0 ? makeWaveCreate (ctx, cap) : v == 1 ? makeWaveMatrix (ctx, cap) : makeWaveFx (ctx, cap);
        views[v]->setBounds (getLocalBounds());
        addChildComponent (*views[v]);
        // What the header and dock show live is written over every view.
        for (const auto& id : { "wvVoicesRo", "wvOctRo", "wvVelRo" })
            if (auto* n = face::findNode (cap["tree"], "#" + juce::String (id)))
                views[v]->page().skipText.insert ((int) (*n)["i"]);
        for (int m = 0; m < 8; ++m)
            for (const auto& id : { "#wvMacr", "#wvMacn" })
                if (auto* n = face::findNode (cap["tree"], id + juce::String (m)))
                    views[v]->page().skipText.insert ((int) (*n)["i"]);
    }
    if (views[0] != nullptr)
        setCreateTableMenu (*views[0], [this] (juce::Rectangle<float> near, int osc) { tableMenu (near, osc); });
    buildLayers();
    reload();
    startTimerHz (30);
}

float WaveFace::posNow (int i) const
{
    // The engine's frame position after modulation, while it sends one.
    const auto& p = model.tele["pos"];
    if (p.isArray() && p.size() > i)
        return wave::clamp ((float) (double) p[i]);
    const auto mo = wave::modOf (model, "osc" + juce::String (i) + ".pos");
    return wave::clamp (mo.live ? mo.at : model.g ("osc" + juce::String (i) + ".pos"));
}

void WaveFace::poll()
{
    nowT = (float) (juce::Time::getMillisecondCounterHiRes() / 1000.0);
    if (api)
    {
        int status = 0;
        const auto t = api ("GET", "/api/wave/state", {}, status);
        model.tele = status == 200 ? t : juce::var();
    }
    // What each source has done, fifty a second (WV_HIST).
    const double t = nowT;
    if (model.histLast < 0 || t - model.histLast > 1)
        model.histLast = t - 0.02;
    while (t - model.histLast >= 0.02)
    {
        model.histLast += 0.02;
        for (const auto& src : wave::sources())
            model.hist[src.key][(size_t) model.histAt] = wave::srcVal (model, src.key);
        model.histAt = (model.histAt + 1) % 200;
    }
    const auto vs = wave::voices (model);
    juce::String vsig;
    for (const auto& v : vs)
        vsig << v.note << v.stage << ",";
    const bool voicesChanged = vsig != lastVoices;
    lastVoices = vsig;
    // The choices a row steps (wvChoiceTick): lit again only when one moves.
    juce::String csig;
    if (auto* o = model.tele["mod"].getDynamicObject())
        for (const auto& pr : o->getProperties())
            if (pr.value.isString())
                csig << pr.name.toString() << "=" << pr.value.toString() << ",";
    if (csig != lastChoices)
    {
        lastChoices = csig;
        sync();
        for (auto& l : layers)
            if (l.get() != textLayer)
                l->repaint();
    }
    const int n = (int) vs.size();
    if (auto it = byId.find ("wvVoicesRo"); it != byId.end())
    {
        const auto txt = juce::String (n) + " voice" + (n == 1 ? "" : "s");
        if (texts[it->second.i] != txt)
        {
            texts[it->second.i] = txt;
            if (textLayer != nullptr)
                textLayer->repaint();
        }
    }
    // What the engine moves, drawn again: everything a row aims at, the
    // voices, the output, the animated screens.
    if (voicesChanged)
        repaintCanvas ("wvKeys");
    for (const auto& id : { "wvOutWave", "wvMaster", "wvPuck" })
        repaintCanvas (id);
    if (ctx.view == "play")
    {
        juce::StringArray dsts;
        for (const auto& r : model.mods)
            if (!r.off)
                dsts.addIfNotAlreadyThere (r.dst);
        for (const auto& d : dsts)
            repaintFor (d);
        for (int i = 0; i < 3; ++i)
        {
            const auto k = "osc" + juce::String (i) + ".";
            if (!vs.empty() || voicesChanged)
                repaintCanvas ("wvW3d" + juce::String (i));
            const auto fx = model.s (k + "fx.mode");
            if (fx == "chorus" || fx == "phaser")
                repaintCanvas ("wvOfx" + juce::String (i));
        }
        if (model.g ("noise.on") >= 0.5f)
            repaintCanvas ("wvMixL4");
        for (const auto& src : wave::sources())
            if (src.kind == "perf" || src.kind == "macro")
                repaintCanvas ("wvSc" + src.key);
        if (tiles != nullptr)
            tiles->live();
        if (actLayer != nullptr)
            actLayer->repaint();
    }
    if (auto* v = viewFor (ctx.view))
        v->tick (nowT);
}

WaveView* WaveFace::viewFor (const juce::String& v)
{
    const int i = v == "create" ? 0 : v == "matrix" ? 1 : v == "fx" ? 2 : -1;
    return i >= 0 ? views[i].get() : nullptr;
}

// Show one of the page's views (`wvShowView`): its frame and what it draws;
// the header's and the dock's parts stay.
void WaveFace::showView (const juce::String& v)
{
    if (v != "play" && viewFor (v) == nullptr)
        return;
    closeMenu();
    ctx.view = v;
    chrome.setVisible (v == "play");
    for (auto& l : layers)
        l->setVisible (l->shared || v == "play");
    for (auto& w : views)
        if (w != nullptr)
            w->setVisible (w.get() == viewFor (v));
    if (auto* w = viewFor (v))
        w->shown();
    else
        reload();
    if (textLayer != nullptr)
        textLayer->repaint();
}

void WaveFace::index (const juce::var& n, int parent)
{
    const int i = (int) n["i"];
    parentOf[i] = parent;
    Node node { i, rectOf (n["rect"]), n };
    if (n["id"].isString())
        byId[n["id"].toString()] = node;
    // Live parts the frame leaves out: every knob's ring is drawn from its value.
    if (n["svg"].isString() && hasClass (n, "ui-ring"))
        chrome.skip.insert (i);
    if (!dataOf (n, "bindKey").isEmpty())
        choices.push_back (node);
    if (auto* kids = n["kids"].getArray())
        for (const auto& k : *kids)
            index (k, i);
}

void WaveFace::reload()
{
    const auto patch = juce::JSON::parse (readPatch ? readPatch() : juce::String());
    if (auto* params = patch["params"].getDynamicObject())
        for (const auto& prop : params->getProperties())
            model.p[prop.name.toString()] = prop.value;
    // The rows, the macros' names and the board, as the page adopts a patch.
    if (patch["mods"].isArray())
        wave::modsIn (model, patch["mods"]);
    if (auto* names = patch["macroNames"].getArray())
        for (int i = 0; i < 8 && i < names->size(); ++i)
            if (names->getReference (i).toString().isNotEmpty())
                model.macroNames.set (i, names->getReference (i).toString());
    if (patch["board"].isObject())
        model.board = patch["board"];
    if (tiles != nullptr)
        tiles->sync();
    for (auto& l : layers)
        if (l.get() != textLayer)
            l->repaint();
    sync();
    for (auto& w : views)
        if (w != nullptr && w->isVisible())
            w->shown();
}

void WaveFace::set (const juce::String& key, const juce::var& value)
{
    model.p[key] = value;
    if (send)
        send (key, json (value));
    sync();
    repaintFor (key);
    if (tiles != nullptr)
        tiles->changed (key);
    for (auto& w : views)
        if (w != nullptr && w->isVisible())
            w->changed (key);
}

void WaveFace::repaintFor (const juce::String& key)
{
    for (auto& l : layers)
    {
        if (l.get() == textLayer)
            continue;
        bool wants = l->also && l->also (key);
        for (const auto& d : l->deps)
            wants = wants || key.startsWith (d) || d == "*";
        if (wants)
            l->repaint();
    }
}

// The readings and the lit switches, from the patch, as the page writes them.
void WaveFace::sync()
{
    auto txt = [this] (const juce::String& id, const juce::String& t) {
        auto it = byId.find (id);
        if (it == byId.end())
            return;
        chrome.skipText.insert (it->second.i);
        texts[it->second.i] = t;
    };
    const auto pct = [] (float v) { return juce::String (juce::roundToInt (v * 100)) + " %"; };
    for (int i = 0; i < 3; ++i)
    {
        const auto k = "osc" + juce::String (i) + ".";
        const auto& T = model.table (model.s (k + "table"));
        const float p = wave::clamp (model.g (k + "pos"));
        txt ("wvFr" + juce::String (i), juce::String (juce::roundToInt (p * (float) (T.size() - 1)) + 1).paddedLeft ('0', 2) + " / " + juce::String ((int) T.size()));
        for (int j : { 0, 1 })
        {
            const auto mode = model.s (k + "warp" + juce::String (j) + ".mode");
            txt ("wvWv" + juce::String (i) + juce::String (j), mode == "off" ? juce::String::fromUTF8 ("\xe2\x80\x94") : pct (model.g (k + "warp" + juce::String (j) + ".amt")));
        }
        txt ("wvUr" + juce::String (i), juce::String ((int) model.g (k + "uni.n", 1)) + " v" + dotSep + juce::String (juce::roundToInt (model.g (k + "uni.det") * 60)) + " ct");
        const int semi = juce::roundToInt ((model.g (k + "pitch", 0.5f) - 0.5f) * 48), cents = juce::roundToInt ((model.g (k + "fine", 0.5f) - 0.5f) * 200);
        txt ("wvPtr" + juce::String (i), (semi >= 0 ? "+" : minus) + juce::String (std::abs (semi))
                                             + (cents != 0 ? " " + (cents > 0 ? juce::String ("+") : minus) + juce::String (std::abs (cents)) + "c" : juce::String (" st")));
        txt ("wvPhr" + juce::String (i), juce::String (juce::roundToInt (model.g (k + "phase") * 360)) + juce::String::fromUTF8 ("\xc2\xb0"));
        const int pn = juce::roundToInt ((model.g (k + "pan", 0.5f) - 0.5f) * 200);
        txt ("wvPnr" + juce::String (i), pn == 0 ? juce::String ("C") : juce::String (pn < 0 ? "L" : "R") + juce::String (std::abs (pn)));
        txt ("wvOfn" + juce::String (i), wave::ofxName (model.s (k + "fx.mode").isEmpty() ? "off" : model.s (k + "fx.mode")));
        if (auto it = byId.find ("wvTn" + juce::String (i)); it != byId.end())
            txt ("wvTn" + juce::String (i), model.s (k + "table"));
    }
    static const char* warpNames[][2] = { { "off", "Off" }, { "bend", "Bend" }, { "sync", "Sync" }, { "pwm", "PWM" }, { "fold", "Fold" },
                                          { "mirror", "Mirror" }, { "asym", "Asym" }, { "quant", "Quant" }, { "fm", "FM \xe2\x86\x90 B" } };
    static const char* filterNames[][2] = { { "lp", "Low pass" }, { "bp", "Band pass" }, { "hp", "High pass" }, { "notch", "Notch" }, { "comb", "Comb" }, { "form", "Formant" } };
    for (int i = 0; i < 3; ++i)
    {
        const auto k = "osc" + juce::String (i) + ".";
        txt ("wvPkName" + juce::String (i), wave::choiceNow (model, k + "table"));
        for (int j : { 0, 1 })
        {
            const auto mode = wave::choiceNow (model, k + "warp" + juce::String (j) + ".mode");
            juce::String name = "Off";
            for (auto& w : warpNames)
                if (mode == w[0])
                    name = juce::String::fromUTF8 (w[1]);
            txt ("wvWn" + juce::String (i) + juce::String (j), mode == "off" ? juce::String ("Add") : name);
        }
    }
    for (int i : { 0, 1 })
    {
        const auto type = wave::choiceNow (model, "filt" + juce::String (i) + ".type");
        juce::String name = "Low pass";
        for (auto& f : filterNames)
            if (type == f[0])
                name = f[1];
        txt ("wvFtn" + juce::String (i), name);
    }
    txt ("wvBendRo", juce::String::fromUTF8 ("\xc2\xb1") + juce::String ((int) model.g ("voice.bend", 2)));
    for (int i = 0; i < 8; ++i)
        txt ("wvMacn" + juce::String (i), model.macroNames[i]);
    const float glide = model.g ("voice.glide");
    txt ("wvGlRo", glide > 0.005f ? wave::fmtMs (glide * glide * 2) : juce::String ("Off"));
    auto kHz = [] (float f) { return f >= 10000 ? juce::String (juce::roundToInt (f / 1000)) + " kHz" : wave::fmtHz (f); };
    for (int i : { 0, 1 })
    {
        const auto f = "filt" + juce::String (i) + ".";
        txt ("wvCur" + juce::String (i), kHz (20 * std::pow (1000.0f, model.g (f + "cut"))));
        txt ("wvRsr" + juce::String (i), "Q " + juce::String (0.7f + model.g (f + "res") * 9, 1));
        txt ("wvDrr" + juce::String (i), pct (model.g (f + "drive")));
        txt ("wvKyr" + juce::String (i), pct (model.g (f + "key")));
    }
    txt ("wvTempoRo", juce::String (juce::roundToInt (wave::clamp (model.g ("tempo", 120), 30, 300))) + " BPM");
    static const char* names[] = { "C", "C\xe2\x99\xaf", "D", "D\xe2\x99\xaf", "E", "F", "F\xe2\x99\xaf", "G", "G\xe2\x99\xaf", "A", "A\xe2\x99\xaf", "B" };
    txt ("wvOctRo", juce::String::fromUTF8 (names[((kbLo % 12) + 12) % 12]) + juce::String ((int) std::floor ((float) kbLo / 12) - 1));
    txt ("wvVelRo", velText);
    for (int i = 0; i < 8; ++i)
        txt ("wvMacr" + juce::String (i), juce::String (juce::roundToInt (model.g ("macro" + juce::String (i)) * 100)));
    txt ("wvVoicesRo", "0 voices");
    for (int i = 0; i < 3; ++i)
        if (auto it = byId.find ("wvOfr" + juce::String (i)); it != byId.end())
            texts[it->second.i] = wave::ofxText (model, i);
    const auto before = chrome.styleFrom;
    restyleChoices();
    // Draw again only the switches whose light changed.
    for (const auto& [node, look] : chrome.styleFrom)
        if (auto it = before.find (node); it == before.end() || it->second != look)
            if (auto nt = chrome.nodes.find (node); nt != chrome.nodes.end())
                chrome.redraw (rectOf (nt->second["rect"]));
    if (textLayer != nullptr)
        textLayer->repaint();
}

// Each switch lit as the patch says: the page's own lit button's look on the
// one chosen, an unlit one's on the rest.
void WaveFace::restyleChoices()
{
    // A group of the page's own switches lit as the patch says: each drawn
    // with the look of one that was captured lit, or one that wasn't.
    auto light = [this] (const std::vector<const juce::var*>& group, const std::function<bool (const juce::var&)>& on, const juce::var* litLook = nullptr, const juce::var* unlitLook = nullptr) {
        const juce::var *lit = litLook, *unlit = unlitLook;
        for (auto* n : group)
            if (hasClass (*n, "on"))
                lit = lit == nullptr ? n : lit;
            else if (unlit == nullptr)
                unlit = n;
        if (lit == nullptr || unlit == nullptr)
            return;
        for (auto* n : group)
            chrome.styleFrom[(int) (*n)["i"]] = (int) (*(on (*n) ? lit : unlit))["i"];
    };
    std::vector<const juce::var*> powers, strips;
    const juce::var *mpe = nullptr, *litSpan = nullptr;
    std::map<int, std::vector<const juce::var*>> faces;
    for (const auto& [i, n] : chrome.nodes)
    {
        if (dataOf (n, "oscled").isNotEmpty() || dataOf (n, "mixon").isNotEmpty())
            powers.push_back (&n);
        if (dataOf (n, "strip").isNotEmpty())
            if (auto* nm = face::findNode (n, "wv-nm"))
                strips.push_back (nm);
        if (n["id"].toString() == "wvMpe")
            if (auto* kids = n["kids"].getArray(); kids != nullptr && !kids->isEmpty())
                mpe = &kids->getReference (0);
        if (litSpan == nullptr && n["tag"].toString() == "span" && hasClass (n, "on") && parentOf.count (i) > 0 && chrome.nodes.count (parentOf[i]) > 0
            && chrome.nodes[parentOf[i]]["id"].toString() == "wvVoiceMode")
            litSpan = &n;
        if (auto f = dataOf (n, "f"); f.isNotEmpty() && parentOf.count (i) > 0)
            faces[parentOf[i]].push_back (&n);
    }
    auto powered = [this] (const juce::var& n) {
        static const char* mix[] = { "osc0.on", "osc1.on", "osc2.on", "sub.on", "noise.on" };
        const auto osc = dataOf (n, "oscled"), m = dataOf (n, "mixon");
        return model.g (osc.isNotEmpty() ? "osc" + osc + ".on" : juce::String (mix[juce::jlimit (0, 4, m.getIntValue())])) >= 0.5f;
    };
    light (powers, powered);
    // .wv-strip.off: a source switched off has its name dimmed.
    {
        static const char* mix[] = { "osc0.on", "osc1.on", "osc2.on", "sub.on", "noise.on" };
        const juce::var *lit = nullptr, *unlit = nullptr;
        auto stripOf = [this] (const juce::var* nm) -> const juce::var& { return chrome.nodes[parentOf[(int) (*nm)["i"]]]; };
        for (auto* nm : strips)
        {
            auto& slot = hasClass (stripOf (nm), "off") ? unlit : lit;
            if (slot == nullptr)
                slot = nm;
        }
        if (lit != nullptr && unlit != nullptr)
            for (auto* nm : strips)
                chrome.styleFrom[(int) (*nm)["i"]] = (int) (*(model.g (mix[juce::jlimit (0, 4, dataOf (stripOf (nm), "strip").getIntValue())]) >= 0.5f ? lit : unlit))["i"];
    }
    // An oscillator switched off is drawn at .55.
    for (int i = 0; i < 3; ++i)
        if (auto it = byId.find ("wvOsc" + juce::String (i)); it != byId.end())
            chrome.opacityOf[it->second.i] = model.g ("osc" + juce::String (i) + ".on") >= 0.5f ? 1.0f : 0.55f;
    if (mpe != nullptr && litSpan != nullptr)
        light ({ mpe }, [this] (const juce::var&) { return model.g ("voice.mpe") >= 0.5f; }, litSpan, mpe);
    for (auto& [parent, group] : faces)
    {
        const int osc = dataOf (chrome.nodes[parent], "face").getIntValue();
        light (group, [this, osc] (const juce::var& n) { return dataOf (n, "f").toStdString()[0] == model.face[juce::jlimit (0, 2, osc)]; });
    }
    std::map<juce::String, std::vector<const Node*>> groups;
    for (const auto& c : choices)
        groups[dataOf (c.n, "bindKey") + "|" + juce::String (parentOf[c.i])].push_back (&c);
    for (auto& [name, nodes] : groups)
    {
        const auto key = name.upToFirstOccurrenceOf ("|", false, false);
        const Node *lit = nullptr, *unlit = nullptr;
        for (auto* n : nodes)
            (hasClass (n->n, "on") ? lit : unlit) = n;
        if (lit == nullptr || unlit == nullptr)
            continue;
        // A choice a row steps shows the option it is on now (wvChoiceNow).
        const auto now = model.v (key).isString() ? juce::var (wave::choiceNow (model, key)) : model.v (key);
        for (auto* n : nodes)
        {
            const auto value = dataOf (n->n, "bindValue");
            const bool on = now.isString() ? value == now.toString() : std::abs (value.getFloatValue() - (float) (double) now) < 1e-4f;
            chrome.styleFrom[n->i] = on ? lit->i : unlit->i;
        }
    }
}

void WaveFace::drawText (juce::Graphics& g, int node, const juce::String& text)
{
    auto it = chrome.nodes.find (node);
    if (it == chrome.nodes.end())
        return;
    const auto& n = it->second;
    auto* runs = n["text"].getArray();
    const auto r = rectOf (n["rect"]);
    juce::var f;
    juce::Rectangle<float> run = r;
    if (runs != nullptr && runs->size() > 0)
        f = runs->getReference (0)["font"], run = rectOf (runs->getReference (0)["rect"]);
    else
        return;
    const auto font = face::font (f);
    g.setFont (font);
    g.setColour (face::colour (f["colour"]));
    const float w = juce::GlyphArrangement::getStringWidth (font, text);
    const auto align = f["align"].toString();
    float x = run.getX();
    if (align == "right" || align == "end")
        x = run.getRight() - w;
    else if (align == "center")
        x = run.getCentreX() - w / 2;
    const float baseline = run.getY() + (run.getHeight() - (font.getAscent() + font.getDescent())) / 2.0f + font.getAscent();
    juce::GlyphArrangement glyphs;
    glyphs.addLineOfText (font, text, x, baseline);
    glyphs.draw (g);
}

WaveFace::Layer* WaveFace::addLayer (juce::Rectangle<float> r, juce::StringArray deps, std::function<void (juce::Graphics&)> draw)
{
    auto l = std::make_unique<Layer>();
    l->draw = std::move (draw);
    l->deps = std::move (deps);
    l->setBounds (r.getSmallestIntegerContainer());
    l->setInterceptsMouseClicks (false, false);
    l->setBufferedToImage (true);
    addAndMakeVisible (*l);
    layers.push_back (std::move (l));
    return layers.back().get();
}

void WaveFace::addCanvas (const juce::String& id, juce::StringArray deps, std::function<void (c2d::Context&, float, float)> draw)
{
    auto it = chrome.canvases.find (id);
    if (it == chrome.canvases.end())
        return;
    const auto r = rectOf (it->second["rect"]);
    const auto box = r.getSmallestIntegerContainer();
    const juce::Point<float> off (r.getX() - (float) box.getX(), r.getY() - (float) box.getY());
    auto* made = canvasLayers[id] = addLayer (r, std::move (deps), [draw, r, off] (juce::Graphics& g) {
        g.addTransform (juce::AffineTransform::translation (off.x, off.y));
        // A canvas draws nothing outside itself.
        g.reduceClipRegion (juce::Rectangle<float> (r.getWidth(), r.getHeight()).getSmallestIntegerContainer());
        c2d::Context c (g, r.getWidth(), r.getHeight());
        draw (c, r.getWidth(), r.getHeight());
    });
    made->name = id;
}

std::vector<std::pair<juce::String, double>> WaveFace::profile (float scale)
{
    std::vector<std::pair<juce::String, double>> out;
    for (auto& l : layers)
    {
        juce::Image img (juce::Image::ARGB, juce::jmax (1, (int) ((float) l->getWidth() * scale)), juce::jmax (1, (int) ((float) l->getHeight() * scale)), true);
        juce::Graphics g (img);
        g.addTransform (juce::AffineTransform::scale (scale));
        const auto t0 = juce::Time::getMillisecondCounterHiRes();
        l->draw (g);
        out.push_back ({ l->name.isEmpty() ? juce::String ("text/bars") : l->name, juce::Time::getMillisecondCounterHiRes() - t0 });
    }
    std::sort (out.begin(), out.end(), [] (auto& a, auto& b) { return a.second > b.second; });
    return out;
}

// Every canvas the page draws, each with the keys it shows.
void WaveFace::buildLayers()
{
    for (int i = 0; i < 3; ++i)
    {
        const auto si = juce::String (i), k = "osc" + si + ".", o = "osc" + juce::String (i == 1 ? 0 : 1) + ".";
        const juce::StringArray osc { k };
        auto fm = [this, k, o] (const juce::String& key) {
            return key.startsWith (o) && (model.s (k + "warp0.mode") == "fm" || model.s (k + "warp1.mode") == "fm");
        };
        const size_t first = layers.size();
        addCanvas ("wvW3d" + si, osc, [this, i, k] (c2d::Context& c, float w, float h) {
            const auto& T = model.table (wave::choiceNow (model, k + "table"));
            const float p = posNow (i), tilt = model.tilt[i];
            const auto wm = model.s (k + "warp0.mode");
            const auto mwa = wave::modOf (model, k + "warp0.amt");
            const float wa = wave::clamp (mwa.live ? mwa.at : model.g (k + "warp0.amt"));
            if (model.face[i] == 's')
                wave::drawSpec3D (c, w, h, cl, T, p, wm, wa, 0.3f + 0.38f * tilt, 0.18f + 0.14f * tilt);
            else
            {
                // A dot for every voice sounding, round the cycle at its own pitch.
                std::vector<std::pair<float, bool>> dots;
                if (model.g (k + "on") >= 0.5f)
                    for (const auto& v : wave::voices (model))
                        dots.push_back ({ std::fmod (nowT * std::pow (2.0f, (float) (v.note - 60) / 12) * 0.7f, 1.0f), v.stage == 'r' });
                wave::draw3D (c, w, h, cl, T, p, wm, wa, 0.3f + 0.38f * tilt, 0.18f + 0.14f * tilt, true, 28, &dots);
            }
        });
        addCanvas ("wvSt" + si, { k + "table", k + "pos" }, [this, i, k] (c2d::Context& c, float w, float h) {
            const auto mo = wave::modOf (model, k + "pos");
            wave::drawStrip (c, w, h, cl, model.table (wave::choiceNow (model, k + "table")), posNow (i), &mo);
        });
        for (int j : { 0, 1 })
            addCanvas ("wvWp" + si + juce::String (j), osc, [this, i, j, k] (c2d::Context& c, float w, float h) {
                const auto key = k + "warp" + juce::String (j) + ".amt", mode = model.s (k + "warp" + juce::String (j) + ".mode");
                const auto o2 = "osc" + juce::String (i == 1 ? 0 : 1) + ".";
                const auto B = wave::frameAt (model.table (model.s (o2 + "table")), posNow (i == 1 ? 0 : 1));
                const auto f = wave::frameAt (model.table (model.s (k + "table")), posNow (i));
                const auto mo = wave::modOf (model, key);
                const float amt = wave::clamp (mo.live ? mo.at : model.g (key));
                auto C = cl;
                if (mo.col.isNotEmpty())
                    C.mod = c2d::css (mo.col);
                wave::drawFace (c, w, h, C, model.g (key), wave::warp (f, mode, amt, &B), &f, mode == "off", &mo);
            });
        addCanvas ("wvUn" + si, osc, [this, i, k] (c2d::Context& c, float w, float h) {
            const auto mo = wave::modOf (model, k + "uni.det");
            wave::drawUniFace (c, w, h, cl, wave::waveFor (model, i, false), (int) model.g (k + "uni.n", 1), model.g (k + "uni.det"), model.g (k + "uni.spr"), &mo);
        });
        addCanvas ("wvOfx" + si, osc, [this, i] (c2d::Context& c, float w, float h) { wave::drawOfx (c, w, h, cl, model, i, nowT); });
        addCanvas ("wvPt" + si, { k + "pitch", k + "fine" }, [this, k] (c2d::Context& c, float w, float h) {
            const int semi = juce::roundToInt ((model.g (k + "pitch", 0.5f) - 0.5f) * 48), cents = juce::roundToInt ((model.g (k + "fine", 0.5f) - 0.5f) * 200);
            const auto mo = wave::modOf (model, k + "pitch");
            wave::drawRuler (c, w, h, cl, semi, cents, &mo);
        });
        addCanvas ("wvPh" + si, osc, [this, i, k] (c2d::Context& c, float w, float h) {
            const auto mo = wave::modOf (model, k + "phase");
            wave::drawPhase (c, w, h, cl, model.g (k + "phase"), wave::waveFor (model, i, false), &mo);
        });
        addCanvas ("wvPn" + si, { k + "pan" }, [this, k] (c2d::Context& c, float w, float h) {
            const auto mo = wave::modOf (model, k + "pan");
            wave::drawKnob (c, w, h, cl, model.g (k + "pan", 0.5f), k + "pan", true, &mo);
        });
        addCanvas ("wvPk" + si, { k + "table" }, [this, k] (c2d::Context& c, float w, float h) { wave::drawPick (c, w, h, cl, model.table (wave::choiceNow (model, k + "table"))); });
        for (size_t n = first; n < layers.size(); ++n)
            layers[n]->also = fm;
    }
    addCanvas ("wvGlide", { "voice.glide" }, [this] (c2d::Context& c, float w, float h) {
        const auto mo = wave::modOf (model, "voice.glide");
        wave::drawHBar (c, w, h, cl, model.g ("voice.glide"), &mo);
    });
    for (int i : { 0, 1 })
    {
        const auto si = juce::String (i), f = "filt" + si + ".";
        addCanvas ("wvLens" + si, { f, "osc0." }, [this, i] (c2d::Context& c, float w, float h) { wave::drawLens (c, w, h, cl, model, wave::waveFor (model, 0, false), i); });
        for (const auto& knob : { std::pair { "wvCu", "cut" }, { "wvRs", "res" }, { "wvDr", "drive" }, { "wvKy", "key" } })
        {
            const juce::String key = f + knob.second;
            addCanvas (juce::String (knob.first) + si, { key }, [this, key] (c2d::Context& c, float w, float h) {
                const auto mo = wave::modOf (model, key);
                wave::drawKnob (c, w, h, cl, model.g (key), key, false, &mo);
            });
        }
    }
    for (int c = 0; c < 5; ++c)
    {
        const juce::StringArray deps = c < 3 ? juce::StringArray { "osc" + juce::String (c) + "." } : c == 3 ? juce::StringArray { "sub." } : juce::StringArray { "noise." };
        addCanvas ("wvMixL" + juce::String (c), deps, [this, c] (c2d::Context& x, float w, float h) {
            const auto cur = c < 3 ? wave::waveFor (model, c, false) : wave::Frame {};
            wave::drawMix (x, w, h, cl, model, c, c < 3 ? &cur : nullptr, nowT);
        });
    }
    addCanvas ("wvKeys", { "osc0.pos" }, [this] (c2d::Context& c, float, float) {
        // Lit: what is held here, and every voice the engine has not yet let go.
        std::set<int> on (held);
        for (const auto& v : wave::voices (model))
            if (v.stage != 'r')
                on.insert (v.note);
        wave::drawKeys (c, cl, kbLo, [&on] (int n) { return on.count (n) > 0; }, 205 - 175 * wave::clamp (model.g ("osc0.pos")));
    });
    addCanvas ("wvBend", {}, [this] (c2d::Context& c, float w, float h) { wave::drawWheel (c, w, h, cl, bend, true); });
    addCanvas ("wvModw", {}, [this] (c2d::Context& c, float w, float h) { wave::drawWheel (c, w, h, cl, mw, false); });
    addCanvas ("wvPuck", { "osc0.", "filt0.cut" }, [this] (c2d::Context& c, float w, float h) {
        const auto now = (float) juce::Time::getMillisecondCounterHiRes();
        trail.erase (std::remove_if (trail.begin(), trail.end(), [now] (const auto& q) { return now - q[2] >= 1500; }), trail.end());
        wave::drawPuck (c, w, h, cl, model, &trail, now);
    });
    addCanvas ("wvOutWave", {}, [this] (c2d::Context& c, float w, float h) { wave::drawOut (c, w, h, cl, model, nowT); });
    addCanvas ("wvMaster", { "master" }, [this] (c2d::Context& c, float w, float h) {
        float lvl = 0;
        if (auto* p = model.tele["peak"].getArray())
            for (const auto& x : *p)
                lvl = juce::jmax (lvl, (float) (double) x);
        wave::drawMaster (c, w, h, cl, model.g ("master", 0.8f), wave::clamp (lvl));
    });
    for (int i = 0; i < 8; ++i)
        addCanvas ("wvMac" + juce::String (i), { "macro" + juce::String (i), "osc0.table" }, [this, i] (c2d::Context& c, float w, float h) { wave::drawMacro (c, w, h, cl, model, i); });
    for (const auto& src : { "vel", "note", "mw", "at", "rand", "macro0", "macro1", "macro2", "macro3", "macro4", "macro5", "macro6", "macro7" })
    {
        const juce::String s (src);
        addCanvas ("wvSc" + s, { s }, [this, s] (c2d::Context& c, float w, float h) { wave::drawTilePic (c, w, h, cl, model, s); });
    }
    // The envelopes and LFOs (391c-wave-tiles.js), as Matrix has them too.
    WaveTiles::Host th;
    th.chrome = &chrome;
    th.tree = face::page ("wave")["tree"];
    th.model = &model;
    th.cl = &cl;
    th.set = [this] (const juce::String& k, const juce::var& v) { set (k, v); };
    th.addLayer = [this] (const juce::String& name, juce::Rectangle<float> r, std::function<void (juce::Graphics&)> draw) -> juce::Component* {
        const auto box = r.getSmallestIntegerContainer().toFloat();
        const auto off = r.getPosition() - box.getPosition();
        auto* l = addLayer (r, {}, [draw, off] (juce::Graphics& g) {
            g.addTransform (juce::AffineTransform::translation (off.x, off.y));
            draw (g);
        });
        l->name = name;
        return l;
    };
    th.lfoMenu = [this] (juce::Rectangle<float> near, int L) { lfoMenu (near, L); };
    tiles = std::make_unique<WaveTiles> (th, "p");
    // The warps' and effects' glyphs, as the patch has them (the page sets their paths).
    {
        std::vector<std::pair<juce::String, juce::var>> icons;
        for (const auto& [i, n] : chrome.nodes)
        {
            const auto cyc = dataOf (n, "cycle"), fx = dataOf (n, "ofx");
            if (cyc.length() != 2 && fx.isEmpty())
                continue;
            if (auto* svg = face::findNode (n, "svg"))
            {
                chrome.skip.insert ((int) (*svg)["i"]);
                icons.push_back ({ cyc.length() == 2 ? "osc" + cyc.substring (0, 1) + ".warp" + cyc.substring (1) + ".mode" : "osc" + fx + ".fx.mode", *svg });
            }
        }
        juce::Rectangle<float> all;
        for (auto& ic : icons)
            all = all.isEmpty() ? rectOf (ic.second["rect"]) : all.getUnion (rectOf (ic.second["rect"]));
        const auto box = all.expanded (4);
        addLayer (box, { "osc0.", "osc1.", "osc2." }, [this, icons, box] (juce::Graphics& g) {
            for (const auto& [key, svg] : icons)
            {
                const auto now = wave::choiceNow (model, key);
                face::drawIcon (g, svg, key.endsWith ("fx.mode") ? wave::ofxGlyphPath (now) : wave::warpGlyph (now), -box.getPosition());
            }
        });
    }
    // More Sources: each source's light, as bright as it moves (.act).
    std::vector<std::pair<juce::String, juce::Rectangle<float>>> acts;
    for (const auto& [i, n] : chrome.nodes)
        if (hasClass (n, "wv-sc"))
            if (auto* a = face::findNode (n, "act"))
            {
                chrome.skip.insert ((int) (*a)["i"]);
                acts.push_back ({ dataOf (n, "src"), rectOf ((*a)["rect"]) });
            }
    if (!acts.empty())
    {
        juce::Rectangle<float> all;
        for (auto& a : acts)
            all = all.isEmpty() ? a.second : all.getUnion (a.second);
        const auto box = all.expanded (8);
        actLayer = addLayer (box, {}, [this, acts, box] (juce::Graphics& g) {
            for (const auto& [src, r] : acts)
            {
                bool used = false;
                for (const auto& row : model.mods)
                    used = used || (row.src == src && !row.off);
                const float o = used ? 0.3f + 0.7f * std::abs (wave::srcVal (model, src)) : 0.0f;
                if (o <= 0.001f)
                    continue;
                const auto col = c2d::css (wave::sourceColour (src));
                juce::Path p;
                p.addEllipse (r - box.getPosition());
                g.beginTransparencyLayer (o);
                juce::DropShadow (col, 6, {}).drawForPath (g, p);
                g.setColour (col);
                g.fillPath (p);
                g.endTransparencyLayer();
            }
        });
    }
    // The readings, over everything.
    textLayer = addLayer (getLocalBounds().toFloat(), { "*" }, [this] (juce::Graphics& g) { drawTexts (g); });
    for (auto& l : layers)
        l->shared = l.get() == textLayer || sharedArea (l->getBounds().toFloat());
}

void WaveFace::drawTexts (juce::Graphics& g)
{
    const bool play = ctx.view == "play";
    for (const auto& [node, text] : texts)
        if (play || sharedArea (rectOf (chrome.nodes[node]["rect"])))
            drawText (g, node, text);
}

// A choice key's options, as the app layer lists them (na_controls): the
// tables there include the ones saved in MGL.
juce::StringArray WaveFace::options (const juce::String& key) const
{
    for (const auto& c : controls)
        if (c["key"].toString() == key)
            if (auto* o = c["options"].getArray())
            {
                juce::StringArray out;
                for (const auto& x : *o)
                    out.add (x.toString());
                return out;
            }
    return {};
}

const WaveFace::Node* WaveFace::hit (juce::Point<float> at) const
{
    // The smallest marked node under the pointer wins.
    const Node* best = nullptr;
    auto consider = [&] (const Node& n) {
        if (n.r.contains (at) && (best == nullptr || n.r.getWidth() * n.r.getHeight() < best->r.getWidth() * best->r.getHeight()))
            best = &n;
    };
    for (const auto& [id, n] : byId)
        consider (n);
    for (const auto& n : choices)
        consider (n);
    return best;
}

void WaveFace::mouseDown (const juce::MouseEvent& e)
{
    drag = nullptr;
    dragEnd = nullptr;
    if ((blocked && blocked (e)) || !e.mods.isLeftButtonDown())
        return;
    grabKeyboardFocus();
    drag = nullptr;
    dragEnd = nullptr;
    last = e.position;
    const auto at = e.position;
    // A press outside the open menu shuts it (`wvCloseMenus`), and does
    // nothing else when it lands on what opened it.
    if (menuOpen != nullptr)
    {
        closeMenu();
        if (menuR.contains (at))
            return;
    }
    // The view tabs.
    for (const auto& [i, n] : chrome.nodes)
        if (hasClass (n, "wv-tab") && rectOf (n["rect"]).contains (at))
            return showView (dataOf (n, "v"));
    if (ctx.view != "play" && !sharedArea ({ at.x, at.y, 0, 0 }))
    {
        if (auto* v = viewFor (ctx.view); v != nullptr && v->down (e))
            viewDrag = true;
        return;
    }
    // The marked nodes under the pointer, smallest first.
    for (const auto& c : choices)
        if (c.r.contains (at))
        {
            const auto k = dataOf (c.n, "bindKey"), v = dataOf (c.n, "bindValue");
            const bool number = v.containsOnly ("0123456789.-") && v.isNotEmpty() && !model.v (k).isString();
            set (k, number ? juce::var (v.getDoubleValue()) : juce::var (v));
            return;
        }
    // The envelopes' and LFOs' tiles.
    if (tiles != nullptr && tiles->down (e))
    {
        drag = [this] (float, float, const juce::MouseEvent& ev) { tiles->dragged (ev); };
        dragEnd = [this] { tiles->up(); };
        return;
    }
    // Pickers and switches by the attributes the page gives them.
    for (const auto& [i, n] : chrome.nodes)
    {
        const auto r = rectOf (n["rect"]);
        if (!r.contains (at))
            continue;
        if (auto f = dataOf (n, "f"); f.isNotEmpty() && parentOf.count (i) > 0)
            if (auto osc = dataOf (chrome.nodes[parentOf.at (i)], "face"); osc.isNotEmpty())
            {
                model.face[juce::jlimit (0, 2, osc.getIntValue())] = (char) f[0];
                sync();
                repaintCanvas ("wvW3d" + osc);
                return;
            }
        if (n["id"].toString() == "wvMpe")
            return set ("voice.mpe", model.g ("voice.mpe") >= 0.5f ? 0.0 : 1.0);
        if (n["id"].toString() == "wvBendRange")
        {
            const int ranges[] = { 1, 2, 7, 12, 24 };
            int now = 0;
            for (int q = 0; q < 5; ++q)
                if (ranges[q] == (int) model.g ("voice.bend", 2))
                    now = q;
            return set ("voice.bend", ranges[(now + 1) % 5]);
        }
        if (n["id"].toString() == "wvTempoRo")
        {
            // A beat per two pixels, up or across, whole BPM only.
            auto acc = std::make_shared<float> (0.0f);
            const float from = wave::clamp (model.g ("tempo", 120), 30, 300);
            drag = [this, acc, from] (float dx, float dy, const juce::MouseEvent&) {
                *acc += (dx - dy) / 2;
                set ("tempo", std::round (wave::clamp (from + *acc, 30, 300)));
            };
            return;
        }
        if (auto mix = dataOf (n, "mixon"); mix.isNotEmpty())
        {
            static const char* on[] = { "osc0.on", "osc1.on", "osc2.on", "sub.on", "noise.on" };
            const auto k = juce::String (on[juce::jlimit (0, 4, mix.getIntValue())]);
            set (k, model.g (k) >= 0.5f ? 0.0 : 1.0);
            return;
        }
        if (auto oct = dataOf (n, "oct"); oct.isNotEmpty())
        {
            kbLo = juce::jlimit (12, 96, kbLo + oct.getIntValue() * 12);
            sync();
            repaintCanvas ("wvKeys");
            return;
        }
        if (auto led = dataOf (n, "oscled"); led.isNotEmpty())
        {
            const auto k = "osc" + led + ".on";
            set (k, model.g (k) >= 0.5f ? 0.0 : 1.0);
            return;
        }
        if (auto pick = dataOf (n, "pick"); pick.isNotEmpty())
            return tableMenu (r, pick.getIntValue());
        if (auto cyc = dataOf (n, "cycle"); cyc.length() == 2)
            return warpMenu (r, cyc.substring (0, 1).getIntValue(), cyc.substring (1).getIntValue());
        if (auto fx = dataOf (n, "ofx"); fx.isNotEmpty())
            return fxMenu (r, fx.getIntValue());

    }

    // Drags, each as the page wires it.
    auto live = [this] (const juce::String& k, float v) { set (k, v); };
    auto canvasAt = [&] (const juce::String& id) {
        auto it = chrome.canvases.find (id);
        return it != chrome.canvases.end() && rectOf (it->second["rect"]).contains (at);
    };
    for (int i = 0; i < 3; ++i)
    {
        const auto si = juce::String (i), k = "osc" + si + ".";
        if (canvasAt ("wvW3d" + si))
        {
            drag = [this, k, i, live] (float dx, float dy, const juce::MouseEvent&) {
                live (k + "pos", wave::clamp (model.g (k + "pos") + dx / 260));
                model.tilt[i] = wave::clamp (model.tilt[i] - dy / 110);
                repaintCanvas ("wvW3d" + juce::String (i));
            };
            return;
        }
        if (canvasAt ("wvSt" + si))
        {
            const auto r = rectOf (chrome.canvases["wvSt" + si]["rect"]);
            auto setp = [r, k, live] (juce::Point<float> p) { live (k + "pos", wave::clamp ((p.x - r.getX() - 6) / (r.getWidth() - 12))); };
            setp (at);
            drag = [setp] (float, float, const juce::MouseEvent& ev) { setp (ev.position); };
            return;
        }
        for (int j : { 0, 1 })
            if (canvasAt ("wvWp" + si + juce::String (j)) && model.s (k + "warp" + juce::String (j) + ".mode") == "off")
            {
                for (const auto& [ni, n] : chrome.nodes)
                    if (dataOf (n, "cycle") == si + juce::String (j))
                        return warpMenu (rectOf (n["rect"]), i, j);
            }
        if (canvasAt ("wvUn" + si))
        {
            drag = [this, k, live] (float, float dy, const juce::MouseEvent& ev) {
                if (ev.mods.isShiftDown())
                    live (k + "uni.spr", wave::clamp (model.g (k + "uni.spr") - dy / 100));
                else
                    live (k + "uni.det", wave::clamp (model.g (k + "uni.det") - dy / 120));
            };
            return;
        }
        if (canvasAt ("wvOfx" + si))
        {
            drag = [this, k, live] (float dx, float dy, const juce::MouseEvent&) {
                live (k + "fx.a", wave::clamp (model.g (k + "fx.a") + dx / 120));
                live (k + "fx.b", wave::clamp (model.g (k + "fx.b") - dy / 70));
            };
            return;
        }
        if (canvasAt ("wvPt" + si))
        {
            auto acc = std::make_shared<float> (0.0f);
            drag = [this, k, live, acc] (float dx, float dy, const juce::MouseEvent& ev) {
                if (ev.mods.isShiftDown())
                    return live (k + "fine", wave::clamp (model.g (k + "fine", 0.5f) + (dx - dy) / 200));
                *acc += dx - dy;
                const int steps = (int) (*acc / 7);
                if (steps != 0)
                {
                    *acc -= (float) steps * 7;
                    live (k + "pitch", wave::clamp (std::round ((model.g (k + "pitch", 0.5f) + (float) steps / 48) * 48) / 48));
                }
            };
            return;
        }
        if (canvasAt ("wvPh" + si))
        {
            drag = [this, k, live] (float, float dy, const juce::MouseEvent& ev) {
                if (ev.mods.isAltDown())
                    live (k + "rand", wave::clamp (model.g (k + "rand") - dy / 150));
                else
                    live (k + "phase", std::fmod (std::fmod (model.g (k + "phase") - dy / 150, 1.0f) + 1.0f, 1.0f));
            };
            return;
        }
    }
    for (int c = 0; c < 5; ++c)
        if (canvasAt ("wvMixL" + juce::String (c)))
        {
            static const char* lv[] = { "osc0.level", "osc1.level", "osc2.level", "sub.level", "noise.level" };
            const auto r = rectOf (chrome.canvases["wvMixL" + juce::String (c)]["rect"]);
            const auto key = juce::String (lv[c]);
            // Where you click is the level, and it follows the pointer from there.
            auto setLevel = [r, key, live] (juce::Point<float> p) { live (key, wave::clamp ((p.x - r.getX() - 6) / (212.0f - 40 - 12))); };
            setLevel (at);
            drag = [setLevel] (float, float, const juce::MouseEvent& ev) { setLevel (ev.position); };
            return;
        }
    if (canvasAt ("wvKeys"))
    {
        // Glide across the keys; Shift keeps every key crossed sounding.
        const auto r = rectOf (chrome.canvases["wvKeys"]["rect"]);
        auto cur = std::make_shared<int> (-1);
        auto downs = std::make_shared<std::set<int>>();
        auto go = [this, r, cur, downs] (juce::Point<float> p, bool shift) {
            const int n = wave::keyAt (kbLo, p.x - r.getX(), p.y - r.getY());
            if (n < 0 || n == *cur)
                return;
            if (*cur >= 0 && !shift)
            {
                note (*cur, 0, false);
                downs->erase (*cur);
            }
            *cur = n;
            if (downs->count (n) > 0)
                return;
            const float vel = 0.4f + 0.6f * wave::clamp ((p.y - r.getY()) / r.getHeight());
            note (n, vel, true);
            downs->insert (n);
            velText = "vel " + juce::String (juce::roundToInt (vel * 127));
            sync();
        };
        go (at, e.mods.isShiftDown());
        drag = [go] (float, float, const juce::MouseEvent& ev) { go (ev.position, ev.mods.isShiftDown()); };
        dragEnd = [this, downs] {
            for (int n : *downs)
                note (n, 0, false);
            downs->clear();
        };
        return;
    }
    if (canvasAt ("wvBend"))
    {
        drag = [this] (float, float dy, const juce::MouseEvent&) {
            bend = wave::clamp (bend - dy / 50, -1, 1);
            if (onWheel)
                onWheel (0, bend);
            repaintCanvas ("wvBend");
        };
        // It springs back when let go.
        dragEnd = [this] {
            bend = 0;
            if (onWheel)
                onWheel (0, 0);
            repaintCanvas ("wvBend");
        };
        return;
    }
    if (canvasAt ("wvModw"))
    {
        drag = [this] (float, float dy, const juce::MouseEvent&) {
            mw = wave::clamp (mw - dy / 90);
            if (onWheel)
                onWheel (1, mw);
            repaintCanvas ("wvModw");
        };
        return;
    }
    if (canvasAt ("wvPuck"))
    {
        const auto r = rectOf (chrome.canvases["wvPuck"]["rect"]);
        auto setPuck = [this, r, live] (juce::Point<float> p) {
            const float px = wave::clamp ((p.x - r.getX() - 6) / (r.getWidth() - 12)), py = wave::clamp (1 - (p.y - r.getY() - 6) / (r.getHeight() - 12));
            live ("osc0.pos", px);
            live ("filt0.cut", 0.2f + 0.7f * py);
            trail.push_back ({ px, py, (float) juce::Time::getMillisecondCounterHiRes() });
        };
        setPuck (at);
        drag = [setPuck] (float, float, const juce::MouseEvent& ev) { setPuck (ev.position); };
        return;
    }
    if (canvasAt ("wvMaster"))
    {
        drag = [this, live] (float dx, float, const juce::MouseEvent&) { live ("master", wave::clamp (model.g ("master", 0.8f) + dx / 110)); };
        return;
    }
    if (canvasAt ("wvGlide"))
    {
        drag = [this, live] (float dx, float, const juce::MouseEvent&) { live ("voice.glide", wave::clamp (model.g ("voice.glide") + dx / 150)); };
        return;
    }
    for (int i : { 0, 1 })
        if (canvasAt ("wvLens" + juce::String (i)))
        {
            const auto f = "filt" + juce::String (i) + ".";
            drag = [this, f, live] (float dx, float dy, const juce::MouseEvent&) {
                live (f + "cut", wave::clamp (model.g (f + "cut") + dx / 220));
                live (f + "res", wave::clamp (model.g (f + "res") - dy / 80));
            };
            return;
        }
    // A plain knob the page wires with wvV: up and down, Shift for fine.
    for (const auto& [id, n] : chrome.canvases)
    {
        const auto key = dataOf (n, "bindV");
        if (key.isEmpty() || !rectOf (n["rect"]).contains (at))
            continue;
        const float sens = num (n["data"]["bindSens"], 150), lo = num (n["data"]["bindLo"], 0), hi = num (n["data"]["bindHi"], 1);
        drag = [this, key, sens, lo, hi, live] (float, float dy, const juce::MouseEvent& ev) {
            live (key, wave::clamp (model.g (key) - dy / (ev.mods.isShiftDown() ? sens * 5 : sens), lo, hi));
        };
        return;
    }
}

void WaveFace::mouseDrag (const juce::MouseEvent& e)
{
    const auto d = e.position - last;
    last = e.position;
    if (viewDrag)
    {
        if (auto* v = viewFor (ctx.view))
            v->dragged (e);
        return;
    }
    if (drag)
        drag (d.x, d.y, e);
}

void WaveFace::mouseUp (const juce::MouseEvent& e)
{
    if (viewDrag)
    {
        viewDrag = false;
        if (auto* v = viewFor (ctx.view))
            v->up (e);
        return;
    }
    if (dragEnd)
        dragEnd();
    drag = nullptr;
    dragEnd = nullptr;
}

void WaveFace::modsChanged()
{
    if (tiles != nullptr)
        tiles->sync();
    for (auto& l : layers)
        if (l.get() != textLayer)
            l->repaint();
    sync();
}

void WaveFace::mouseWheelMove (const juce::MouseEvent& e, const juce::MouseWheelDetails& w)
{
    if (ctx.view != "play" && !sharedArea ({ e.position.x, e.position.y, 0, 0 }))
        if (auto* v = viewFor (ctx.view); v != nullptr && v->wheel (e, w))
            return;
    // The unison knob turns its voices under the wheel, 1 to 16.
    if (ctx.view == "play")
        for (int i = 0; i < 3; ++i)
            if (auto it = chrome.canvases.find ("wvUn" + juce::String (i)); it != chrome.canvases.end() && rectOf (it->second["rect"]).contains (e.position))
            {
                const auto k = "osc" + juce::String (i) + ".uni.n";
                set (k, juce::jlimit (1, 16, (int) model.g (k, 1) + (w.deltaY > 0 ? 1 : -1)));
                return;
            }
    juce::Component::mouseWheelMove (e, w);
}

void WaveFace::mouseDoubleClick (const juce::MouseEvent& e)
{
    if (ctx.view != "play" && !sharedArea ({ e.position.x, e.position.y, 0, 0 }))
    {
        if (auto* v = viewFor (ctx.view))
            v->doubleClick (e);
        return;
    }
    // The tempo goes back to 120, as the page's does.
    if (auto it = byId.find ("wvTempoRo"); it != byId.end() && it->second.r.contains (e.position))
        set ("tempo", 120);
}

void WaveFace::note (int n, float vel, bool on)
{
    if (on)
        held.insert (n);
    else
        held.erase (n);
    if (onNote)
        onNote (n, vel, on);
    repaintCanvas ("wvKeys");
}

namespace
{
// The computer's keys, in pitch order: A to K the whites, W to U the blacks,
// and on past K as far as the row goes. The same letters the page plays.
const juce::String qwerty ("awsedftgyhujkolp;");
} // namespace

bool WaveFace::keyPressed (const juce::KeyPress& key)
{
    if (key == juce::KeyPress::escapeKey && menuOpen != nullptr)
    {
        closeMenu();
        return true;
    }
    if (auto* v = viewFor (ctx.view); v != nullptr && v->key (key))
        return true;
    if (key.getModifiers().isCommandDown() || key.getModifiers().isAltDown() || key.getModifiers().isCtrlDown())
        return false;
    const auto ch = juce::CharacterFunctions::toLowerCase (key.getTextCharacter());
    if (ch == 'z' || ch == 'x')
    {
        kbLo = juce::jlimit (12, 96, kbLo + (ch == 'z' ? -12 : 12));
        sync();
        repaintCanvas ("wvKeys");
        return true;
    }
    const int i = qwerty.indexOfChar (ch);
    if (i < 0)
        return false;
    if (keyNotes.count (ch) == 0)
    {
        const int n = kbLo + 12 + i;
        keyNotes[ch] = n;
        note (n, 0.8f, true);
        velText = "vel " + juce::String (juce::roundToInt (0.8f * 127));
        sync();
    }
    return true;
}

bool WaveFace::keyStateChanged (bool)
{
    bool any = false;
    for (auto it = keyNotes.begin(); it != keyNotes.end();)
    {
        if (!juce::KeyPress::isKeyCurrentlyDown ((int) it->first))
        {
            note (it->second, 0, false);
            it = keyNotes.erase (it);
            any = true;
        }
        else
            ++it;
    }
    return any;
}

// ─────────────────────────────────────────────────────────────── the menus
//
// The page's own (393b-wave-menus.js, 391c `wvLfoMenu`): tiles, three across,
// each the choice drawn on this oscillator's wave, placed under the control
// that opened it and kept inside the page. One open at a time.

void WaveFace::openMenu (std::unique_ptr<WaveMenu> m, const juce::String& owner, juce::Rectangle<float> near, float dx)
{
    const bool same = menuOpen != nullptr && menuOwner == owner;
    closeMenu();
    if (same)
        return;
    m->place (near, dx, getLocalBounds().toFloat());
    m->onClose = [this] { juce::MessageManager::callAsync ([safe = juce::Component::SafePointer<WaveFace> (this)] { if (safe != nullptr) safe->closeMenu(); }); };
    menuOwner = owner;
    menuR = near;
    addAndMakeVisible (*m);
    menuOpen = std::move (m);
}

void WaveFace::closeMenu()
{
    menuOpen.reset();
    menuOwner.clear();
    menuR = {};
}

namespace
{
const juce::var& menuPart()
{
    return face::page ("wave-views")["parts"]["menu"];
}

juce::Point<float> menuPt (float x, float y) { return { x, y }; }

void strokeSvg (c2d::Context& c, const char* d, float x, float y, float sc, juce::Colour col)
{
    // wvFxIcon: the effect's glyph, glowing in its colour.
    c2d::Path p;
    p.p = juce::Drawable::parseSVGPath (d);
    c.save();
    c.translate (x, y);
    c.scale (sc, sc);
    c.strokeStyle = col;
    c.lineWidth = 1.7f / sc * 1.1f;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.shadowBlur = 8;
    c.shadowColor = col;
    c.stroke (p);
    c.restore();
}

const std::vector<std::pair<juce::String, juce::String>>& warpNames()
{
    static const std::vector<std::pair<juce::String, juce::String>> w {
        { "off", "Off" }, { "bend", "Bend" }, { "sync", "Sync" }, { "pwm", "PWM" }, { "fold", "Fold" },
        { "mirror", "Mirror" }, { "asym", "Asym" }, { "quant", "Quant" }, { "fm", juce::String::fromUTF8 ("FM \xe2\x86\x90 B") },
    };
    return w;
}

const char* ofxGlyph (const juce::String& k)
{
    static const std::map<juce::String, const char*> g {
        { "off", "M2 7 H16" }, { "chorus", "M2 5 C5 1,7 1,9 5 S13 9,16 5 M2 10 C5 6,7 6,9 10 S13 14,16 10" },
        { "crush", "M2 12 V9 H5 V5 H8 V3 H11 V6 H14 V10 H16" }, { "drive", "M2 12 C4 12,5 3,8 3 H11 C13 3,13 12,16 12" },
        { "delay", "M3 3 V11 M7 4.5 V9.5 M11 5.5 V8.5 M15 6.3 V7.7" }, { "phaser", "M2 7 C4 2,6 12,8 7 S12 2,16 7" },
        { "ring", "M2 7 C3 2,4 2,5 7 S7 12,8 7 S10 2,11 7 S13 12,14 7 S15 2,16 7" }, { "comb", "M2 4 L4 12 L6 4 L8 12 L10 4 L12 12 L14 4 L16 12" },
    };
    auto it = g.find (k);
    return it == g.end() ? "M2 7 H16" : it->second;
}

const std::vector<std::pair<juce::String, juce::String>>& lfoShapes()
{
    static const std::vector<std::pair<juce::String, juce::String>> s {
        { "sine", "Sine" }, { "tri", "Triangle" }, { "up", "Saw up" }, { "down", "Saw down" },
        { "square", "Square" }, { "steps", "Random steps" }, { "smooth", "Smooth random" }, { "drawn", "Drawn" },
    };
    return s;
}
} // namespace

void WaveFace::tableMenu (juce::Rectangle<float> near, int i)
{
    const auto k = "osc" + juce::String (i) + ".table";
    std::vector<WaveMenu::Item> items;
    for (const auto& name : options (k))
    {
        WaveMenu::Item it;
        it.label = name;
        it.on = model.s (k) == name;
        it.pic = [this, name] (c2d::Context& c, float, float) {
            const auto f = wave::frameAt (model.table (name), 0.5f);
            wave::trace (c, wave::path ([&] (float u) { return menuPt (4 + u * 80, 19 - wave::rd (f, u) * 14); }, 100), cl, 1.3f, 0.6f);
        };
        it.act = [this, k, name] { set (k, name); };
        items.push_back (std::move (it));
    }
    openMenu (std::make_unique<WaveMenu> (menuPart(), std::move (items), cl.t2, cl.t), "table" + juce::String (i), near, 0);
}

void WaveFace::warpMenu (juce::Rectangle<float> near, int i, int j)
{
    const auto k = "osc" + juce::String (i) + ".";
    const int o = i == 1 ? 0 : 1;
    auto posNow = [this] (int q) {
        const auto& p = ctx.tele["pos"];
        return p.isArray() && p.size() > q ? wave::clamp ((float) (double) p[q]) : wave::clamp (model.g ("osc" + juce::String (q) + ".pos"));
    };
    const auto f = wave::frameAt (model.table (model.s (k + "table")), posNow (i));
    const auto B = wave::frameAt (model.table (model.s ("osc" + juce::String (o) + ".table")), posNow (o));
    const auto mode = k + "warp" + juce::String (j) + ".mode", amt = k + "warp" + juce::String (j) + ".amt";
    std::vector<WaveMenu::Item> items;
    for (const auto& entry : warpNames())
    {
        const auto& key = entry.first;
        const auto& name = entry.second;
        WaveMenu::Item it;
        it.label = key == "off" ? juce::String ("None") : name;
        it.on = model.s (mode) == key;
        it.pic = [this, f, B, key] (c2d::Context& c, float, float) {
            if (key != "off")
            {
                c.strokeStyle = cl.bloom (0.18f);
                c.lineWidth = 1;
                c.stroke (wave::path ([&] (float u) { return menuPt (4 + u * 80, 19 - wave::rd (f, u) * 14); }, 80));
            }
            const auto w = key == "off" ? f : wave::warp (f, key, 0.55f, &B);
            wave::trace (c, wave::path ([&] (float u) { return menuPt (4 + u * 80, 19 - wave::rd (w, u) * 14); }, 120), cl, 1.3f, 0.6f);
        };
        it.act = [this, mode, amt, key] {
            set (mode, key);
            if (key != "off" && model.g (amt) == 0.0f)
                set (amt, 0.4);
        };
        items.push_back (std::move (it));
    }
    openMenu (std::make_unique<WaveMenu> (menuPart(), std::move (items), cl.t2, cl.t), "warp" + juce::String (i) + juce::String (j), near, -120);
}

void WaveFace::fxMenu (juce::Rectangle<float> near, int i)
{
    const auto k = "osc" + juce::String (i) + ".fx.mode";
    const auto dry = wave::waveFor (model, i, true);
    std::vector<WaveMenu::Item> items;
    for (const juce::String key : { "off", "chorus", "crush", "drive", "delay", "phaser", "ring", "comb" })
    {
        WaveMenu::Item it;
        it.label = wave::ofxName (key);
        it.on = model.s (k) == key;
        it.ink = wave::fxCol (key, 78);
        it.pic = [this, dry, key] (c2d::Context& c, float, float) {
            auto bg = c.createLinearGradient (0, 0, 88, 0);
            bg.stops.push_back ({ 0.0f, wave::fxCol (key, 45, 0.25f) });
            bg.stops.push_back ({ 1.0f, wave::fxCol (key, 45, 0) });
            c.fillStyle = bg;
            c.fillRect (0, 0, 88, 38);
            strokeSvg (c, ofxGlyph (key), 2, 10, 1.05f, wave::fxCol (key, 76));
            c.strokeStyle = cl.bloom (0.18f);
            c.lineWidth = 1;
            c.stroke (wave::path ([&] (float u) { return menuPt (24 + u * 60, 19 - wave::rd (dry, u * 2) * 13); }, 80));
            auto fxTrace = [&] (const c2d::Path& p, float lw) {
                c.lineJoin = "round";
                c.lineCap = "round";
                c.strokeStyle = wave::fxCol (key, 60, 0.22f);
                c.lineWidth = lw * 3.6f;
                c.shadowBlur = 10;
                c.shadowColor = wave::fxCol (key, 60, 0.5f);
                c.stroke (p);
                c.shadowBlur = 0;
                c.strokeStyle = wave::fxCol (key, 80);
                c.lineWidth = lw;
                c.stroke (p);
            };
            if (key == "chorus")
            {
                for (int v = 0; v < 3; ++v)
                {
                    c.globalAlpha = v != 0 ? 0.5f : 1.0f;
                    fxTrace (wave::path ([&] (float u) { return menuPt (24 + u * 60, 19 + (float) (v - 1) * 4 - wave::rd (dry, u * 2 + (float) v * 0.03f) * 12); }, 80), 1.1f);
                }
                c.globalAlpha = 1;
            }
            else if (key == "delay")
            {
                for (int r = 0; r < 4; ++r)
                {
                    const float A = std::pow (0.6f, (float) r);
                    c.globalAlpha = A;
                    fxTrace (wave::path ([&] (float u) { return menuPt (24 + (float) r * 16 + u * 13, 19 - wave::rd (dry, u * 2) * 12 * A); }, 30), 1.1f);
                }
                c.globalAlpha = 1;
            }
            else if (key == "phaser")
                fxTrace (wave::path ([&] (float u) { return menuPt (24 + u * 60, 19 - (wave::rd (dry, u * 2) * 0.5f + wave::rd (dry, u * 2 + 0.1f) * 0.5f) * 13); }, 100), 1.2f);
            else
            {
                const auto shaped = wave::ofxShape (dry, key, 0.75f, 0.5f);
                fxTrace (wave::path ([&] (float u) { return menuPt (24 + u * 60, 19 - wave::rd (shaped, u * 2) * 13); }, key == "crush" ? 300 : 120), 1.2f);
            }
        };
        it.act = [this, k, key] { set (k, key); };
        items.push_back (std::move (it));
    }
    openMenu (std::make_unique<WaveMenu> (menuPart(), std::move (items), cl.t2, cl.t), "fx" + juce::String (i), near, -60);
}

void WaveFace::lfoMenu (juce::Rectangle<float> near, int L)
{
    const auto l = "lfo" + juce::String (L);
    const auto col = c2d::css (wave::sourceColour (l));
    std::vector<WaveMenu::Item> items;
    for (const auto& entry : lfoShapes())
    {
        const auto& k = entry.first;
        const auto& name = entry.second;
        WaveMenu::Item it;
        it.label = name;
        it.on = wave::lfoShape (model, L) == k;
        it.ink = col;
        it.pic = [this, col, l, k] (c2d::Context& c, float, float) {
            c.strokeStyle = c2d::css ("rgba(255,255,255,.07)");
            c.beginPath();
            c.moveTo (4, 19);
            c.lineTo (84, 19);
            c.stroke();
            c.lineJoin = "round";
            c.strokeStyle = col;
            c.lineWidth = 1.4f;
            c.shadowBlur = 6;
            c.shadowColor = col;
            const auto pts = model.v (l + ".points");
            c.stroke (wave::path ([&] (float u) { return menuPt (4 + u * 80, 33 - wave::shapeValue (k, pts, u, 0) * 28); }, 120));
            c.shadowBlur = 0;
        };
        it.act = [this, L, l, k] {
            if (k == "drawn")
            {
                // wvToDrawn: the shape it had, as points, then Drawn.
                if (wave::lfoShape (model, L) == "drawn")
                    return;
                juce::Array<juce::var> pts;
                if (wave::lfoShape (model, L) == "square")
                    for (auto q : { std::pair { 0.0, 1.0 }, { 0.49, 1.0 }, { 0.5, 0.0 }, { 0.99, 0.0 }, { 1.0, 1.0 } })
                        pts.add (juce::Array<juce::var> { q.first, q.second });
                else
                    for (int i = 0; i < 9; ++i)
                        pts.add (juce::Array<juce::var> { i / 8.0, std::round (wave::lfoVal (model, L, (float) i / 8, 0) * 1e4) / 1e4 });
                set (l + ".points", pts);
                set (l + ".shape", "drawn");
            }
            else
                set (l + ".shape", k);
        };
        items.push_back (std::move (it));
    }
    openMenu (std::make_unique<WaveMenu> (menuPart(), std::move (items), cl.t2, cl.t), "lfo" + juce::String (L), near, -150);
}
