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
    cl = wave::colours (captured["vars"]);
    model.loadTable = std::move (f);
    if (auto* list = juce::JSON::parse (juce::String (naText ([] (char* b, uint32_t c) { return na_controls ("wave", b, c); }))).getArray())
        controls = *list;
    index (captured["tree"], -1);
    reload();
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
    // A tile's reading: its value in <b>, its bar under it.
    const auto env = dataOf (n, "env"), lfo = dataOf (n, "lfo");
    if (hasClass (n, "wv-rd") && (env.isNotEmpty() || lfo.isNotEmpty()))
    {
        Readout r;
        r.key = dataOf (n, "tgt");
        r.kind = env.isNotEmpty() ? dataOf (n, "k") : dataOf (n, "lk");
        r.src = env.isNotEmpty() ? env : lfo;
        r.r = node.r;
        if (auto* kids = n["kids"].getArray())
            for (const auto& k : *kids)
            {
                if (k["tag"].toString() == "b")
                    r.b = (int) k["i"], chrome.skipText.insert (r.b);
                if (hasClass (k, "bar"))
                    r.bar = (int) k["i"], r.barR = rectOf (k["rect"]), chrome.skip.insert (r.bar);
            }
        readouts.push_back (r);
    }
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
    sync();
}

void WaveFace::set (const juce::String& key, const juce::var& value)
{
    model.p[key] = value;
    if (send)
        send (key, json (value));
    sync();
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
    for (const auto& r : readouts)
    {
        const float v = model.g (r.key);
        juce::String t;
        if (r.kind == "a" || r.kind == "d")
            t = wave::fmtC (v * v * 4);
        else if (r.kind == "s")
            t = juce::String (juce::roundToInt (v * 100)) + "%";
        else if (r.kind == "r")
            t = wave::fmtC (v * v * 6);
        else if (r.kind == "rate")
            t = wave::lfoRateTxt (model, r.src.getTrailingIntValue()).replace (" Hz", "Hz");
        else if (r.kind == "smooth")
            t = juce::String (juce::roundToInt (v * 100)) + "%";
        else if (r.kind == "rise")
            t = wave::fmtC (v * v * 4);
        if (r.b >= 0)
            texts[r.b] = t;
    }
    restyleChoices();
    chrome.repaint();
    repaint();
}

// Each switch lit as the patch says: the page's own lit button's look on the
// one chosen, an unlit one's on the rest.
void WaveFace::restyleChoices()
{
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
        const auto now = model.v (key);
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

void WaveFace::paintOverChildren (juce::Graphics& g)
{
    auto canvas = [&] (const juce::String& id, auto&& paint) {
        auto it = chrome.canvases.find (id);
        if (it == chrome.canvases.end())
            return;
        const auto r = rectOf (it->second["rect"]);
        juce::Graphics::ScopedSaveState keep (g);
        g.addTransform (juce::AffineTransform::translation (r.getX(), r.getY()));
        c2d::Context c (g, r.getWidth(), r.getHeight());
        paint (c, r.getWidth(), r.getHeight());
    };
    const float t = 0.0f;
    std::vector<wave::Frame> curs;
    for (int i = 0; i < 3; ++i)
    {
        const auto si = juce::String (i), k = "osc" + si + ".";
        const auto& T = model.table (model.s (k + "table"));
        const float p = wave::clamp (model.g (k + "pos"));
        const auto cur = wave::waveFor (model, i, false);
        curs.push_back (cur);
        const auto wm = model.s (k + "warp0.mode");
        const float wa = wave::clamp (model.g (k + "warp0.amt")), tilt = model.tilt[i];
        canvas ("wvW3d" + si, [&] (c2d::Context& c, float w, float h) {
            if (model.face[i] == 's')
                wave::drawSpec3D (c, w, h, cl, T, p, wm, wa, 0.3f + 0.38f * tilt, 0.18f + 0.14f * tilt);
            else
                wave::draw3D (c, w, h, cl, T, p, wm, wa, 0.3f + 0.38f * tilt, 0.18f + 0.14f * tilt, true);
        });
        canvas ("wvSt" + si, [&] (c2d::Context& c, float w, float h) { wave::drawStrip (c, w, h, cl, T, p); });
        const int o = i == 1 ? 0 : 1;
        const auto B = wave::frameAt (model.table (model.s ("osc" + juce::String (o) + ".table")), wave::clamp (model.g ("osc" + juce::String (o) + ".pos")));
        for (int j : { 0, 1 })
        {
            const auto key = k + "warp" + juce::String (j) + ".amt", mode = model.s (k + "warp" + juce::String (j) + ".mode");
            const auto f = wave::frameAt (T, p);
            canvas ("wvWp" + si + juce::String (j), [&] (c2d::Context& c, float w, float h) {
                wave::drawFace (c, w, h, cl, model.g (key), wave::warp (f, mode, wave::clamp (model.g (key)), &B), &f, mode == "off");
            });
        }
        canvas ("wvUn" + si, [&] (c2d::Context& c, float w, float h) { wave::drawUniFace (c, w, h, cl, cur, (int) model.g (k + "uni.n", 1), model.g (k + "uni.det"), model.g (k + "uni.spr")); });
        canvas ("wvOfx" + si, [&] (c2d::Context& c, float w, float h) { texts[byId["wvOfr" + si].i] = wave::drawOfx (c, w, h, cl, model, i, t); });
        if (byId.count ("wvOfr" + si) > 0)
            chrome.skipText.insert (byId["wvOfr" + si].i);
        const int semi = juce::roundToInt ((model.g (k + "pitch", 0.5f) - 0.5f) * 48), cents = juce::roundToInt ((model.g (k + "fine", 0.5f) - 0.5f) * 200);
        canvas ("wvPt" + si, [&] (c2d::Context& c, float w, float h) { wave::drawRuler (c, w, h, cl, semi, cents); });
        canvas ("wvPh" + si, [&] (c2d::Context& c, float w, float h) { wave::drawPhase (c, w, h, cl, model.g (k + "phase"), cur); });
        canvas ("wvPn" + si, [&] (c2d::Context& c, float w, float h) { wave::drawKnob (c, w, h, cl, model.g (k + "pan", 0.5f), k + "pan", true); });
        canvas ("wvPk" + si, [&] (c2d::Context& c, float w, float h) { wave::drawPick (c, w, h, cl, T); });
    }
    canvas ("wvGlide", [&] (c2d::Context& c, float w, float h) { wave::drawHBar (c, w, h, cl, model.g ("voice.glide")); });
    for (int i : { 0, 1 })
    {
        const auto si = juce::String (i), f = "filt" + si + ".";
        canvas ("wvLens" + si, [&] (c2d::Context& c, float w, float h) { wave::drawLens (c, w, h, cl, model, curs[0], i); });
        for (const auto& knob : { std::pair { "wvCu", "cut" }, { "wvRs", "res" }, { "wvDr", "drive" }, { "wvKy", "key" } })
        {
            const juce::String key = f + knob.second;
            canvas (juce::String (knob.first) + si, [&] (c2d::Context& c, float w, float h) { wave::drawKnob (c, w, h, cl, model.g (key), key, false); });
        }
    }
    // The tiles: the envelopes and LFOs, each in its own colour.
    for (const auto& src : { "amp", "env1", "env2", "env3" })
    {
        const juce::String s (src);
        const auto C = s == "amp" ? cl : wave::sourceCl (cl, s);
        canvas ("wvpev" + s, [&] (c2d::Context& c, float w, float h) { wave::drawEnv (c, w, h, C, model.g (s + ".a"), model.g (s + ".d"), model.g (s + ".s"), model.g (s + ".r")); });
    }
    for (int L = 0; L < 4; ++L)
    {
        const auto s = "lfo" + juce::String (L);
        const auto C = wave::sourceCl (cl, s);
        canvas ("wvplv" + s, [&] (c2d::Context& c, float w, float h) {
            wave::drawLfo (c, w, h, C, model, L);
            const float rise = model.g (s + ".rise");
            if (rise > 0.005f)
            {
                const float x1 = 8 + rise * (w - 16) * 0.5f;
                auto gr = c.createLinearGradient (8, 0, x1, 0);
                gr.addColorStop (0, "rgba(0,0,0,.55)");
                gr.addColorStop (1, "rgba(0,0,0,0)");
                c.fillStyle = gr;
                c.fillRect (8, 6, x1 - 8, h - 12);
                c.strokeStyle = C.bloom (0.6f);
                c.setLineDash ({ 3, 3 });
                c.beginPath();
                c.moveTo (8, h - 8);
                c.lineTo (x1, 8);
                c.stroke();
                c.setLineDash ({});
            }
        });
    }
    // The tiles' bars, in the source's colour, as long as the value.
    for (const auto& r : readouts)
    {
        if (r.bar < 0)
            continue;
        const auto col = c2d::css (wave::sourceColour (r.src));
        const auto bar = r.barR.withWidth (r.r.getWidth() * wave::clamp (model.g (r.key)));
        juce::DropShadow (col, 6, {}).drawForRectangle (g, bar.toNearestInt());
        g.setColour (col.withAlpha (0.85f));
        g.fillRect (bar);
    }
    for (const auto& [node, text] : texts)
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

void WaveFace::menu (const juce::String& key, const juce::StringArray& options, const juce::String& current, juce::Rectangle<float> near)
{
    juce::PopupMenu m;
    for (int i = 0; i < options.size(); ++i)
        m.addItem (i + 1, options[i], true, options[i] == current);
    m.showMenuAsync (juce::PopupMenu::Options().withTargetScreenArea (localAreaToGlobal (near).toNearestInt()), [this, key, options] (int chosen) {
        if (chosen > 0)
            set (key, options[chosen - 1]);
    });
}

void WaveFace::mouseDown (const juce::MouseEvent& e)
{
    drag = nullptr;
    dragEnd = nullptr;
    last = e.position;
    const auto at = e.position;
    // The marked nodes under the pointer, smallest first.
    for (const auto& c : choices)
        if (c.r.contains (at))
        {
            const auto k = dataOf (c.n, "bindKey"), v = dataOf (c.n, "bindValue");
            const bool number = v.containsOnly ("0123456789.-") && v.isNotEmpty() && !model.v (k).isString();
            set (k, number ? juce::var (v.getDoubleValue()) : juce::var (v));
            return;
        }
    // Pickers and switches by the attributes the page gives them.
    for (const auto& [i, n] : chrome.nodes)
    {
        const auto r = rectOf (n["rect"]);
        if (!r.contains (at))
            continue;
        if (auto led = dataOf (n, "oscled"); led.isNotEmpty())
        {
            const auto k = "osc" + led + ".on";
            set (k, model.g (k) >= 0.5f ? 0.0 : 1.0);
            return;
        }
        if (auto pick = dataOf (n, "pick"); pick.isNotEmpty())
        {
            menu ("osc" + pick + ".table", options ("osc" + pick + ".table"), model.s ("osc" + pick + ".table"), r);
            return;
        }
        if (auto cyc = dataOf (n, "cycle"); cyc.length() == 2)
        {
            const auto k = "osc" + cyc.substring (0, 1) + ".warp" + cyc.substring (1) + ".mode";
            menu (k, options (k), model.s (k), r);
            return;
        }
        if (auto fx = dataOf (n, "ofx"); fx.isNotEmpty())
        {
            const auto k = "osc" + fx + ".fx.mode";
            menu (k, options (k), model.s (k), r);
            return;
        }
        if (auto shp = dataOf (n, "lshape"); shp.isNotEmpty())
        {
            const auto k = shp + ".shape";
            menu (k, options (k), model.s (k), r);
            return;
        }
        if (n["tag"].toString() == "span" && n["data"]["k"].isString())
        {
            const int parent = parentOf.count (i) ? parentOf.at (i) : -1;
            if (auto pt = chrome.nodes.find (parent); pt != chrome.nodes.end())
            {
                if (auto lm = dataOf (pt->second, "lmode"); lm.isNotEmpty())
                    return set (lm + ".mode", dataOf (n, "k"));
                if (auto ls = dataOf (pt->second, "lsync"); ls.isNotEmpty())
                    return set (ls + ".sync", dataOf (n, "k").getDoubleValue());
            }
        }
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
    // An envelope: the nearest corner is the one dragged.
    for (const auto& src : { "amp", "env1", "env2", "env3" })
    {
        const juce::String s (src);
        if (!canvasAt ("wvpev" + s))
            continue;
        const auto r = rectOf (chrome.canvases["wvpev" + s]["rect"]);
        const auto P = wave::envPts (r.getWidth(), r.getHeight(), model.g (s + ".a"), model.g (s + ".d"), model.g (s + ".s"), model.g (s + ".r"));
        const float x = at.x - r.getX();
        const float da = std::abs (P.a.x - x), dd = std::abs (P.d.x - x), dr = std::abs (P.r.x - x);
        const char eh = da <= dd && da <= dr ? 'a' : dd <= dr ? 'd' : 'r';
        drag = [this, s, eh, live] (float dx, float dy, const juce::MouseEvent&) {
            if (eh == 'a')
                live (s + ".a", wave::clamp (model.g (s + ".a") + dx / 70, 0.005f, 1));
            else if (eh == 'd')
            {
                live (s + ".d", wave::clamp (model.g (s + ".d") + dx / 70, 0.01f, 1));
                live (s + ".s", wave::clamp (model.g (s + ".s") - dy / 50));
            }
            else
                live (s + ".r", wave::clamp (model.g (s + ".r") + dx / 70, 0.01f, 1));
        };
        return;
    }
    // A tile's reading: up and down, Shift for fine.
    for (const auto& r : readouts)
        if (r.r.contains (at))
        {
            const bool env = r.kind.length() == 1;
            const float lo = r.kind == "a" ? 0.005f : (r.kind == "d" || r.kind == "r") ? 0.01f : 0.0f;
            const auto key = r.key;
            drag = [this, key, env, lo, live] (float, float dy, const juce::MouseEvent& ev) {
                const float sens = env ? (ev.mods.isShiftDown() ? 600.0f : 120.0f) : (ev.mods.isShiftDown() ? 750.0f : 150.0f);
                live (key, juce::jmax (lo, wave::clamp (model.g (key) - dy / sens)));
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
    if (drag)
        drag (d.x, d.y, e);
}

void WaveFace::mouseUp (const juce::MouseEvent&)
{
    if (dragEnd)
        dragEnd();
    drag = nullptr;
    dragEnd = nullptr;
}

void WaveFace::mouseDoubleClick (const juce::MouseEvent& e)
{
    // The tempo goes back to 120, as the page's does.
    if (auto it = byId.find ("wvTempoRo"); it != byId.end() && it->second.r.contains (e.position))
        set ("tempo", 120);
}
