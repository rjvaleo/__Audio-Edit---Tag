#include "AtmosFace.h"

#include "Canvas2D.h"
#include "WaveDraw.h"

#include <cmath>

namespace
{
float numOf (const juce::var& v, float fallback = 0.0f)
{
    if (v.isString())
        return v.toString().getFloatValue();
    return v.isVoid() || v.isUndefined() ? fallback : (float) (double) v;
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

juce::Colour rgbCss (const juce::String& s)
{
    auto p = juce::StringArray::fromTokens (s.fromFirstOccurrenceOf ("(", false, false).upToFirstOccurrenceOf (")", false, false), ",", "");
    if (p.size() < 3)
        return juce::Colours::grey;
    return juce::Colour ((juce::uint8) p[0].trim().getIntValue(), (juce::uint8) p[1].trim().getIntValue(), (juce::uint8) p[2].trim().getIntValue(),
                         p.size() > 3 ? p[3].trim().getFloatValue() : 1.0f);
}

// The page's own maps and readings (atmos.js).
float atExp (float v, float lo, float hi) { return lo * std::pow (hi / lo, v / 100.0f); }
float atFltHz (float v) { return atExp (v, 30, 20000); }
float atFltQ (float v) { return 0.5f + (v / 100.0f) * 14.5f; }
float atLfoHz (float v) { return atExp (v, 0.02f, 20); }
juce::String fixed (double v, int places) { return juce::String (v, places); }
juce::String atMs (float ms) { return ms >= 1000 ? fixed (ms / 1000.0, ms >= 10000 ? 0 : 1) + "s" : juce::String (juce::roundToInt (ms)) + "ms"; }
juce::String atHz (float f) { return f >= 1000 ? fixed (f / 1000.0, f >= 10000 ? 0 : 1) + "kHz" : juce::String (juce::roundToInt (f)) + "Hz"; }
juce::String atPct (float v) { return juce::String (juce::roundToInt (v)) + "%"; }
juce::String signedInt (float v, const juce::String& unit) { return (v > 0 ? "+" : "") + juce::String (juce::roundToInt (v)) + unit; }
const juce::String cent = juce::String::fromUTF8 ("\xc2\xa2"), times = juce::String::fromUTF8 ("\xc3\x97"), dotSep = juce::String::fromUTF8 (" \xc2\xb7 ");

// What a select's key is in the page's state.
juce::String stateKeyOfSelect (const juce::String& k)
{
    if (k == "atSymTune")
        return "symTune";
    if (k.startsWith ("atTune"))
        return "tune" + k.substring (6);
    return k;
}
} // namespace

AtmosFace::AtmosFace (Send s, State st, View vw, Scope sc, Kinds kd)
    : send (std::move (s)), readState (std::move (st)), readView (std::move (vw)), readScope (std::move (sc)), readKinds (std::move (kd)),
      captured (face::page ("atmos")), page (captured["page"]), dock (captured["dock"])
{
    data = juce::JSON::parse (face::embeddedFile ("atmos-page.json"));
    vars = captured["page"]["vars"];
    dockY = numOf (captured["page"]["size"][1]);
    setSize ((int) numOf (captured["size"][0], 1500), (int) numOf (captured["size"][1], 998));
    addAndMakeVisible (page);
    addAndMakeVisible (dock);
    dock.setTopLeftPosition (0, (int) dockY);
    setWantsKeyboardFocus (true);
    index (captured["page"]["tree"]);
    // The dock's parts, by what they are.
    std::function<void (const juce::var&)> walkDock = [&] (const juce::var& n) {
        const auto r = rectOf (n["rect"]).translated (0, dockY);
        if (n["id"].toString() == "adKeys")
            keysR = r;
        if (n["id"].toString() == "adMidi")
            midiR = r;
        if (dataOf (n, "o") == "-1")
            octDown = r;
        if (dataOf (n, "o") == "1")
            octUp = r;
        if (n["id"].toString() == "adOctRo" || n["id"].toString() == "adVel")
            dock.skipText.insert ((int) n["i"]);
        if (auto* kids = n["kids"].getArray())
            for (const auto& k : *kids)
                walkDock (k);
    };
    walkDock (captured["dock"]["tree"]);
    if (readKinds)
        kindsList = juce::JSON::parse (readKinds());
    buildLayers();
    reload();
    // The pictures and the scope read the engine all the time, as the page's
    // requestAnimationFrame does: a note may come from anywhere (a cable, a
    // sequencer, MIDI), not only from these keys.
    startTimerHz (30);
}

AtmosFace::~AtmosFace()
{
    stopTimer();
    fxWin.reset();
}

juce::Colour AtmosFace::ink (const juce::String& token, const juce::String& fallback) const
{
    const auto s = vars[juce::Identifier (token)].toString();
    return c2d::css (s.isEmpty() ? fallback : s);
}

void AtmosFace::index (const juce::var& n)
{
    const int i = (int) n["i"];
    Node node { i, rectOf (n["rect"]), n };
    const auto id = n["id"].toString();
    if (id.isNotEmpty())
        byId[id] = node;
    if (hasClass (n, "knob") && dataOf (n, "k").isNotEmpty())
    {
        Knob k;
        k.key = dataOf (n, "k");
        k.min = dataOf (n, "min").getFloatValue();
        k.max = dataOf (n, "max").getFloatValue();
        k.kc = rgbCss (dataOf (n, "kc"));
        k.track = rgbCss (dataOf (n, "track"));
        k.r = node.r;
        if (auto* kids = n["kids"].getArray())
            for (const auto& c : *kids)
            {
                if (dataOf (c, "pseudo") == "::before")
                    k.before = c;
                if (dataOf (c, "pseudo") == "::after")
                    k.after = c, k.marker = face::colour (c["bg"]);
            }
        if (k.marker.isTransparent())
            k.marker = ink ("--look-text", "#e8eaee");
        page.skip.insert (i);
        knobs.push_back (k);
    }
    if (hasClass (n, "at-osc") && dataOf (n, "model").isNotEmpty())
        cards[node.r.getX() < 500 ? 0 : 1].push_back (node);
    if (dataOf (n, "lt").isNotEmpty())
        tabs.push_back (node);
    if (n["select"].isObject() && dataOf (n, "k").isNotEmpty())
        selects.push_back (node);
    if (hasClass (n, "atfx-plus"))
        plus = node, page.skip.insert (i);
    if (id == "atFxChainRow")
        chainR = node.r;
    if (auto* kids = n["kids"].getArray())
        for (const auto& k : *kids)
            index (k);
}

// ── the values ─────────────────────────────────────────────────────────────

float AtmosFace::num (const juce::String& key, float fallback) const
{
    auto it = v.find (key);
    return it == v.end() ? fallback : numOf (it->second, fallback);
}

juce::String AtmosFace::str (const juce::String& key, const juce::String& fallback) const
{
    auto it = v.find (key);
    return it == v.end() || it->second.isVoid() ? fallback : it->second.toString();
}

juce::String AtmosFace::keyOf (const juce::String& k) const
{
    // The LFO panel shows the LFO its tab picks; the capture is LFO 1's.
    if (k.startsWith ("atL1"))
        return "atL" + juce::String (lfoTab) + k.substring (4);
    return k;
}

void AtmosFace::reload()
{
    // The page's own defaults, then what the module holds.
    if (auto* list = data["knobs"].getArray())
        for (const auto& k : *list)
            v[k[0].toString()] = k[4];
    v["modelA"] = data["modelDefault"]["A"];
    v["modelB"] = data["modelDefault"]["B"];
    for (int n = 1; n <= 3; ++n)
    {
        v["atL" + juce::String (n) + "Shape"] = "sine";
        v["atL" + juce::String (n) + "Target"] = "";
    }
    v["symTune"] = "degrees";
    v["tuneScale"] = v["tuneRoot"] = v["tuneOct"] = "seq";
    v["fx"] = juce::Array<juce::var>();
    readBack();
    layoutTiles();
    sync();
    for (auto& l : layers)
        l->repaint();
}

// What the module holds now (kept while it is read: the parsed object lives in it).
void AtmosFace::readBack()
{
    if (!readState)
        return;
    const auto state = juce::JSON::parse (readState());
    if (auto* o = state.getDynamicObject())
        for (const auto& p : o->getProperties())
            v[p.name.toString()] = p.value;
}

void AtmosFace::set (const juce::String& key, const juce::var& value)
{
    v[key] = value;
    if (send)
        send (key, juce::JSON::toString (value, true));
    // Some keys move others (a model's defaults, the big knob): read them back.
    if (key == "modelA" || key == "modelB" || key == "atMacro")
    {
        if (key == "atMacro")
        {
            const float u = numOf (value) / 100.0f;
            auto lerp = [u] (float a, float b) { return (float) juce::roundToInt (a + (b - a) * u); };
            v["atWidth"] = lerp (30, 100), v["atDrift"] = lerp (10, 60), v["atHold"] = lerp (100, 300), v["atAir"] = lerp (0, 40), v["atEns"] = lerp (10, 60);
        }
        if (key.startsWith ("model"))
            if (auto* models = data["models"].getArray())
                for (const auto& m : *models)
                    if (m["id"].toString() == value.toString())
                        for (int p = 0; p < 4; ++p)
                            v["atM" + key.substring (5) + juce::String (p + 1)] = m["d"][p];
        readBack();
        sync();
        for (auto& l : layers)
            l->repaint();
        return;
    }
    sync();
    repaintFor (key);
}

void AtmosFace::repaintFor (const juce::String& key)
{
    for (auto& l : layers)
    {
        if (l.get() == textLayer)
            continue;
        bool wants = false;
        for (const auto& d : l->deps)
            wants = wants || key == d || d == "*" || (d.endsWith (".") && key.startsWith (d));
        if (wants)
            l->repaint();
    }
}

const juce::var* AtmosFace::modelOf (int which) const
{
    const auto id = str (which == 0 ? "modelA" : "modelB");
    if (auto* models = data["models"].getArray())
    {
        for (const auto& m : *models)
            if (m["id"].toString() == id)
                return &m;
        if (!models->isEmpty())
            return &models->getReference (0);
    }
    return nullptr;
}

// What a knob reads, as the page writes it (AT_KNOBS' formats).
juce::String AtmosFace::format (const juce::String& key, float x) const
{
    if (key.startsWith ("atM") && key.length() == 5)
    {
        const auto* m = modelOf (key[3] == 'A' ? 0 : 1);
        const int p = key.getLastCharacters (1).getIntValue() - 1;
        if (m == nullptr || (*m)["p"][p].toString().isEmpty())
            return {};
        if ((*m)["id"].toString() == "classic")
        {
            static const char* waves[] = { "SINE", "TRI", "SAW", "SQUARE" };
            return waves[juce::jlimit (0, 3, juce::roundToInt (x / 100 * 3))];
        }
        return atPct (x);
    }
    if (key == "atMAFine" || key == "atMBFine")
        return signedInt (x, cent);
    if (key == "atAOct" || key == "atBOct")
        return (x > 0 ? "+" : "") + juce::String (juce::roundToInt (x));
    if (key == "atBlend")
        return x < 50 ? "A " + juce::String (juce::roundToInt (100 - x)) : x > 50 ? "B " + juce::String (juce::roundToInt (x)) : juce::String ("A=B");
    if (key == "atUnison")
        return juce::String (juce::roundToInt (x));
    if (key == "atDetune")
        return juce::String (juce::roundToInt (x)) + cent;
    if (key == "atHold")
    {
        auto t = fixed (x / 100.0, 2);
        if (t.endsWith ("0"))
            t = t.dropLastCharacters (1);
        return t + times + " step";
    }
    if (key == "atGlide")
        return atMs (x <= 0 ? 0 : atExp (x, 5, 2000));
    if (key == "atAtk" || key == "atDec" || key == "atFltAtk" || key == "atFltDec")
        return atMs (atExp (x, 1, 10000));
    if (key == "atRel" || key == "atFltRel")
        return atMs (atExp (x, 10, 20000));
    if (key == "atEnsRate")
        return fixed (atExp (x, 0.05f, 2), 2) + "Hz";
    if (key == "atSymRing")
        return fixed (atExp (x, 0.3f, 10), 1) + "s";
    if (key == "atSymMat")
        return x < 34 ? "felt" : x < 67 ? "string" : "glass";
    if (key == "atFltType")
    {
        static const char* types[] = { "Low-pass", "Band", "High-pass" };
        return types[juce::jlimit (0, 2, juce::roundToInt (x))];
    }
    if (key == "atFltCut")
        return atHz (atFltHz (x));
    if (key == "atFltRes")
        return "Q " + fixed (atFltQ (x), 1);
    if (key == "atFltAmt")
        return signedInt (x, "%");
    if (key.startsWith ("atL") && key.endsWith ("Rate"))
        return fixed (atLfoHz (x), 2) + "Hz";
    return atPct (x);
}

// A select's values, in its options' order; its options' labels with them.
juce::StringArray AtmosFace::optionValues (const juce::String& key, juce::StringArray* labels) const
{
    juce::StringArray out, names;
    auto pairs = [&] (const juce::var& list) {
        if (auto* a = list.getArray())
            for (const auto& p : *a)
                out.add (p[0].toString()), names.add (p[1].toString());
    };
    static const char* notes[] = { "C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B" };
    if (key.endsWith ("Shape"))
        pairs (data["lfoShapes"]);
    else if (key.endsWith ("Target"))
        pairs (data["lfoTargets"]);
    else if (key == "symTune")
        pairs (data["symTune"]);
    else if (key == "tuneScale")
    {
        out.add ("seq"), names.add ("Same as Seq");
        if (auto* a = data["scales"].getArray())
            for (int i = 0; i < a->size(); ++i)
                out.add (juce::String (i)), names.add (a->getReference (i)["name"].toString());
    }
    else if (key == "tuneRoot")
    {
        out.add ("seq"), names.add ("Same as Seq");
        for (int i = 0; i < 12; ++i)
            out.add (juce::String (i)), names.add (notes[i]);
    }
    else if (key == "tuneOct")
    {
        out.add ("seq"), names.add ("Same as Seq");
        for (int i = 0; i < 8; ++i)
            out.add (juce::String (i)), names.add (juce::String (i));
    }
    else if (key == "adMidi")
        for (int i = 1; i <= 16; ++i)
            out.add (juce::String (i)), names.add ("MIDI " + juce::String (i));
    if (labels != nullptr)
        *labels = names;
    return out;
}

// The readings, the lit cards and tabs, the selects, as the page writes them.
void AtmosFace::sync()
{
    auto txt = [this] (const juce::String& id, const juce::String& t) {
        auto it = byId.find (id);
        if (it == byId.end())
            return;
        page.skipText.insert (it->second.i);
        texts[it->second.i] = t;
    };
    for (const auto& k : knobs)
    {
        const auto key = keyOf (k.key);
        txt (k.key + "Val", format (key, num (key)));
    }
    for (int w = 0; w < 2; ++w)
    {
        const auto W = juce::String (w == 0 ? "A" : "B");
        const auto* m = modelOf (w);
        if (m == nullptr)
            continue;
        for (int p = 0; p < 4; ++p)
        {
            const auto name = (*m)["p"][p].toString();
            txt ("atM" + W + juce::String (p + 1) + "Label", name.isEmpty() ? juce::String::fromUTF8 ("\xe2\x80\x94") : name);
        }
        txt ("at" + W + "What", (*m)["name"].toString() + dotSep + (*m)["sub"].toString());
    }
    // Its own tuning.
    {
        const auto r = str ("tuneRoot", "seq"), o = str ("tuneOct", "seq"), sc = str ("tuneScale", "seq");
        const int rootMidi = (r == "seq" ? (int) numOf (data["seq"]["root"], 9) : r.getIntValue()) + ((o == "seq" ? (int) numOf (data["seq"]["octave"], 4) : o.getIntValue()) + 1) * 12;
        txt ("atTuneHz", fixed (440.0 * std::pow (2.0, (rootMidi - 69) / 12.0), 1) + " Hz");
        const auto& scale = data["scales"][sc == "seq" ? (int) numOf (data["seq"]["scale"], 0) : sc.getIntValue()];
        if (scale.isObject())
            txt ("atTuneScale", scale["name"].toString() + dotSep + juce::String (scale["cents"].size()) + " notes");
    }
    // The cards and the tabs, lit as chosen: the page's own lit and unlit looks.
    const auto before = page.styleFrom;
    for (int w = 0; w < 2; ++w)
    {
        const Node *lit = nullptr, *unlit = nullptr;
        for (const auto& c : cards[w])
            (hasClass (c.n, "on") ? lit : unlit) = &c;
        if (lit != nullptr && unlit != nullptr)
            for (const auto& c : cards[w])
                page.styleFrom[c.i] = dataOf (c.n, "model") == str (w == 0 ? "modelA" : "modelB") ? lit->i : unlit->i;
    }
    {
        const Node *lit = nullptr, *unlit = nullptr;
        for (const auto& t : tabs)
            (hasClass (t.n, "on") ? lit : unlit) = &t;
        if (lit != nullptr && unlit != nullptr)
            for (const auto& t : tabs)
                page.styleFrom[t.i] = dataOf (t.n, "lt").getIntValue() == lfoTab ? lit->i : unlit->i;
    }
    // The selects show what is chosen.
    for (const auto& s : selects)
    {
        const auto key = stateKeyOfSelect (keyOf (dataOf (s.n, "k")));
        const int at = optionValues (key).indexOf (key == "adMidi" ? juce::String (midiChannel) : str (key));
        const int shown = page.selectValue.count (s.i) ? page.selectValue[s.i] : (int) s.n["select"]["value"];
        if (at >= 0 && at != shown)
        {
            page.selectValue[s.i] = at;
            page.redraw (s.r);
        }
    }
    for (const auto& [node, look] : page.styleFrom)
        if (auto it = before.find (node); it == before.end() || it->second != look)
            if (auto nt = page.nodes.find (node); nt != page.nodes.end())
                page.redraw (rectOf (nt->second["rect"]));
    // The dock.
    dockTexts.clear();
    if (textLayer != nullptr)
        textLayer->repaint();
}

// ── drawing ────────────────────────────────────────────────────────────────

void AtmosFace::drawText (juce::Graphics& g, const juce::var& n, const juce::String& text, bool centre)
{
    auto* runs = n["text"].getArray();
    if (runs == nullptr || runs->isEmpty())
        return;
    const auto f = runs->getReference (0)["font"];
    const auto run = rectOf (runs->getReference (0)["rect"]);
    const auto r = rectOf (n["rect"]);
    const auto font = face::font (f);
    g.setFont (font);
    g.setColour (face::colour (f["colour"]));
    const float w = juce::GlyphArrangement::getStringWidth (font, text);
    float x = centre ? r.getCentreX() - w / 2 : run.getX();
    const auto align = f["align"].toString();
    if (!centre && (align == "right" || align == "end"))
        x = run.getRight() - w;
    const float baseline = run.getY() + (run.getHeight() - (font.getAscent() + font.getDescent())) / 2.0f + font.getAscent();
    juce::GlyphArrangement glyphs;
    glyphs.addLineOfText (font, text, x, baseline);
    glyphs.draw (g);
}

// A knob as the stylesheet draws it: the arc (a conic gradient from 225°, its
// colour as far as the value, the track after), the face over it, the marker
// turned from -135° to 135°.
void AtmosFace::drawKnob (juce::Graphics& g, const Knob& k, juce::Point<float> origin)
{
    const auto key = keyOf (k.key);
    const float t = juce::jlimit (0.0f, 1.0f, (num (key) - k.min) / juce::jmax (1e-6f, k.max - k.min));
    const auto r = k.r - origin;
    const float a0 = -juce::MathConstants<float>::pi * 0.75f, span = juce::MathConstants<float>::pi * 1.5f;
    juce::Path arc;
    arc.addPieSegment (r, a0, a0 + span * t, 0.0f);
    g.setColour (k.kc);
    g.fillPath (arc);
    juce::Path rest;
    rest.addPieSegment (r, a0 + span * t, a0 + span, 0.0f);
    g.setColour (k.track);
    g.fillPath (rest);
    if (k.before.isObject())
        face::paintBox (g, k.before, rectOf (k.before["rect"]) - origin);
    const bool big = r.getWidth() >= 60;
    const float mw = big ? 4.0f : 2.2f, mh = big ? 25.0f : 9.0f, top = big ? 12.0f : 6.0f;
    const juce::Point<float> pivot (r.getCentreX(), r.getY() + top + mh);
    juce::Path marker;
    marker.addRoundedRectangle (pivot.x - mw / 2, pivot.y - mh, mw, mh, 2.0f);
    marker.applyTransform (juce::AffineTransform::rotation (juce::degreesToRadians (-135.0f + t * 270.0f), pivot.x, pivot.y));
    g.setColour (k.marker);
    g.fillPath (marker);
}

// The oscillator's model as it runs (atphysDraw), from the engine's voice.
void AtmosFace::drawPic (juce::Graphics& gr, float W, float H, int which)
{
    c2d::Context g (gr, W, H);
    const auto col = ink (which == 0 ? "--f-pitch" : "--f-tone", which == 0 ? "#a99be0" : "#79bfc3");
    g.fillStyle = col;
    g.strokeStyle = col;
    g.lineWidth = 2;
    const auto* m = modelOf (which);
    if (m == nullptr)
        return;
    const auto id = (*m)["id"].toString();
    int modelIndex = 0;
    if (auto* models = data["models"].getArray())
        for (int i = 0; i < models->size(); ++i)
            if (models->getReference (i)["id"].toString() == id)
                modelIndex = i;
    const int live = which == 0 ? modelLiveA : modelLiveB;
    const float* view = live == modelIndex ? (which == 0 ? viewA : viewB) : nullptr;
    if (id == "pluck" || id == "bow" || id == "pipe" || id == "reed")
    {
        float pk = 1;
        if (view != nullptr)
        {
            pk = 1e-4f;
            for (int i = 0; i < 32; ++i)
                pk = juce::jmax (pk, std::abs (view[i]));
        }
        g.beginPath();
        for (int i = 0; i < 32; ++i)
        {
            const float x = ((float) i / 31.0f) * (W - 16) + 8, y = view != nullptr ? (view[i] / pk) * H * 0.38f * juce::jmin (1.0f, pk * 30) : 0.0f;
            if (i)
                g.lineTo (x, H / 2 - y);
            else
                g.moveTo (x, H / 2 - y);
        }
        g.stroke();
        g.globalAlpha = 0.35f;
        if (id == "pipe" || id == "reed")
            g.strokeRect (6, H * 0.18f, W - 12, H * 0.64f);
        else
        {
            g.fillRect (4, H * 0.2f, 2, H * 0.6f);
            g.fillRect (W - 6, H * 0.2f, 2, H * 0.6f);
        }
        g.globalAlpha = 1;
    }
    else if (id == "bar" || id == "bell" || id == "glass" || id == "membrane")
    {
        std::vector<float> ratios;
        if (view != nullptr)
        {
            for (int i = 16; i < 26; ++i)
                if (view[i] > 0)
                    ratios.push_back (view[i]);
        }
        else
            ratios = { 1, 2, 3, 4 };
        float mx = 1;
        for (float q : ratios)
            mx = juce::jmax (mx, q);
        for (size_t k = 0; k < ratios.size(); ++k)
        {
            const float q = ratios[k];
            const float x = 10 + (W - 20) * (std::log2 (q * 2) / std::log2 (mx * 2));
            const float lv = view != nullptr ? juce::jmin (1.0f, std::sqrt (juce::jmax (0.0f, view[k])) * 3) : 0.04f;
            g.fillRect (x - 3, H - 6 - lv * (H - 14), 6, juce::jmax (1.0f, lv * (H - 14)));
        }
        g.globalAlpha = 0.35f;
        g.fillRect (6, H - 6, W - 12, 1);
        g.globalAlpha = 1;
    }
    else
    {
        // The voice's and the analog waves' cycle (the canvas's own pixels,
        // two at a time: the page steps 2 device pixels).
        g.beginPath();
        for (float x = 0; x <= W; x += 1)
        {
            const float u = (x / W) * 3, f = u - std::floor (u);
            const float s = id == "voice" ? std::pow (juce::jmax (0.0f, std::sin (juce::MathConstants<float>::pi * f / 0.6f)), 2.0f) * (f < 0.6f ? 1.0f : 0.0f) - 0.3f
                                          : std::sin (u * 2 * juce::MathConstants<float>::pi);
            g.lineTo (x, H / 2 - s * H * 0.3f * (view != nullptr ? 1.0f : 0.4f));
        }
        g.stroke();
    }
}

// What Atmosphere sends out (scopes.js, scopeDraw), a few periods of the last
// note's pitch from a rising zero crossing, as large as the well.
void AtmosFace::drawScope (juce::Graphics& gr, float W, float H)
{
    c2d::Context g (gr, W, H);
    g.fillStyle = ink ("--look-line", "#2c3036");
    g.fillRect (0, std::round (H / 2), W, 1);
    if (!scopeLast.empty())
    {
        const float mid = H / 2, amp = H * 0.4f;
        g.beginPath();
        for (int x = 0; x < (int) W; ++x)
        {
            const float s = scopeLast[(size_t) juce::jmin ((int) scopeLast.size() - 1, (int) std::floor (((float) x / W) * (float) scopeLast.size()))];
            if (x)
                g.lineTo ((float) x, mid - s * amp);
            else
                g.moveTo ((float) x, mid - s * amp);
        }
        g.strokeStyle = ink ("--on", "#ffb547").withMultipliedAlpha (scopeLive ? 1.0f : 0.45f);
        g.lineWidth = 1.5f;
        g.stroke();
    }
    const juce::String note = scopeLive ? juce::String() : !scopeLast.empty() ? juce::String ("last heard") : juce::String ("plays when a note sounds");
    if (note.isNotEmpty())
    {
        g.font = "500 9px ui-monospace, Menlo, monospace";
        g.fillStyle = ink ("--look-text-3", "#858b94");
        g.fillText (note, 5, H - 5);
    }
}

void AtmosFace::addCanvas (const juce::String& id, juce::Rectangle<float> r, juce::StringArray deps, std::function<void (juce::Graphics&, float, float)> draw)
{
    const auto box = r.getSmallestIntegerContainer();
    const juce::Point<float> off (r.getX() - (float) box.getX(), r.getY() - (float) box.getY());
    addLayer (id, r, std::move (deps), [draw, r, off] (juce::Graphics& g) {
        g.addTransform (juce::AffineTransform::translation (off.x, off.y));
        g.reduceClipRegion (juce::Rectangle<float> (r.getWidth(), r.getHeight()).getSmallestIntegerContainer());
        draw (g, r.getWidth(), r.getHeight());
    });
}

AtmosFace::Layer* AtmosFace::addLayer (const juce::String& name, juce::Rectangle<float> r, juce::StringArray deps, std::function<void (juce::Graphics&)> draw)
{
    auto l = std::make_unique<Layer>();
    l->draw = std::move (draw);
    l->deps = std::move (deps);
    l->name = name;
    l->setBounds (r.getSmallestIntegerContainer());
    l->setInterceptsMouseClicks (false, false);
    l->setBufferedToImage (true);
    addAndMakeVisible (*l);
    if (name.isNotEmpty())
        named[name] = l.get();
    layers.push_back (std::move (l));
    return layers.back().get();
}

void AtmosFace::buildLayers()
{
    auto canvasRect = [this] (const juce::String& id) -> juce::Rectangle<float> {
        auto it = page.canvases.find (id);
        return it == page.canvases.end() ? juce::Rectangle<float>() : rectOf (it->second["rect"]);
    };
    addCanvas ("atPicA", canvasRect ("atPicA"), { "modelA" }, [this] (juce::Graphics& g, float w, float h) { drawPic (g, w, h, 0); });
    addCanvas ("atPicB", canvasRect ("atPicB"), { "modelB" }, [this] (juce::Graphics& g, float w, float h) { drawPic (g, w, h, 1); });
    // The Amp's envelope (atmosDrawAmp).
    addCanvas ("atAmpCanvas", canvasRect ("atAmpCanvas"), { "atAtk", "atDec", "atSus", "atRel" }, [this] (juce::Graphics& gr, float w, float h) {
        c2d::Context g (gr, w, h);
        const float a = atExp (num ("atAtk", 74), 1, 10000), d = atExp (num ("atDec", 70), 1, 10000), s = num ("atSus", 80) / 100, r = atExp (num ("atRel", 78), 10, 20000);
        const float hold = juce::jmax (a + d, 1500.0f), tot = a + d + hold * 0.4f + r;
        auto X = [&] (float t) { return 4 + (t / tot) * (w - 8); };
        auto Y = [&] (float x) { return h - 4 - x * (h - 10); };
        const auto attack = ink ("--look-f-attack", "#d88f7e");
        g.fillStyle = attack.withAlpha (0.1f);
        g.strokeStyle = attack;
        g.lineWidth = 1.5f;
        g.beginPath();
        g.moveTo (X (0), Y (0));
        g.lineTo (X (a), Y (1));
        g.lineTo (X (a + d), Y (s));
        g.lineTo (X (a + d + hold * 0.4f), Y (s));
        g.lineTo (X (tot), Y (0));
        g.stroke();
        g.closePath();
        g.fill();
        g.font = "9px ui-monospace, Menlo, monospace";
        g.fillStyle = ink ("--look-text-3", "#858b94");
        g.fillText (juce::String::fromUTF8 ("AMP \xc2\xb7 A and B together"), 6, 10);
    });
    // The Filter's envelope (atmosDrawFilter).
    addCanvas ("atFltCanvas", canvasRect ("atFltCanvas"), { "atFltAtk", "atFltDec", "atFltSus", "atFltRel", "atFltAmt" }, [this] (juce::Graphics& gr, float w, float h) {
        c2d::Context g (gr, w, h);
        const float a = atExp (num ("atFltAtk", 40), 1, 10000), d = atExp (num ("atFltDec", 60), 1, 10000), s = num ("atFltSus", 50) / 100, r = atExp (num ("atFltRel", 70), 10, 20000);
        const float amt = num ("atFltAmt") / 100;
        const float hold = juce::jmax (a + d, 1500.0f), tot = a + d + hold * 0.4f + r;
        auto X = [&] (float t) { return 4 + (t / tot) * (w - 8); };
        auto Y = [&] (float x) { return h - 12 - x * (h - 22); };
        const auto tone = ink ("--f-tone", "#79bfc3");
        g.globalAlpha = std::abs (amt) > 0.005f ? 1.0f : 0.45f;
        g.strokeStyle = tone;
        g.fillStyle = tone;
        g.lineWidth = 1.5f;
        g.beginPath();
        g.moveTo (X (0), Y (0));
        g.lineTo (X (a), Y (1));
        g.lineTo (X (a + d), Y (s));
        g.lineTo (X (a + d + hold * 0.4f), Y (s));
        g.lineTo (X (tot), Y (0));
        g.stroke();
        g.globalAlpha = 0.12f;
        g.closePath();
        g.fill();
        g.globalAlpha = 1;
        g.font = "9px ui-monospace, Menlo, monospace";
        g.fillStyle = ink ("--look-text-3", "#858b94");
        g.fillText (juce::String::fromUTF8 ("ENV \xe2\x86\x92 CUTOFF ") + (amt >= 0 ? "+" : "") + juce::String (juce::roundToInt (amt * 100)) + "%", 6, 10);
        const std::pair<const char*, float> marks[] = { { "A", a / 2 }, { "D", a + d / 2 }, { "S", a + d + hold * 0.2f }, { "R", a + d + hold * 0.4f + r / 2 } };
        for (const auto& [l, t] : marks)
            g.fillText (l, X (t) - 3, h - 2);
    });
    addCanvas ("scopeOut", canvasRect ("scopeOut"), {}, [this] (juce::Graphics& g, float w, float h) { drawScope (g, w, h); });
    // The keys (kb1Draw), in Atmosphere's hue.
    addCanvas ("adKeys", keysR, {}, [this] (juce::Graphics& gr, float w, float h) {
        c2d::Context g (gr, w, h);
        wave::Cl cl;
        cl.t3 = ink ("--look-text-3", "#858b94");
        wave::drawKeys (g, cl, kbLo, [this] (int n) { return held.count (n) > 0; }, 270);
    });
    // Every knob from its value, and its group dimmed where its model has no use for it.
    for (const auto& k : knobs)
    {
        const auto r = k.r.expanded (4);
        juce::StringArray deps { k.key };
        if (k.key.startsWith ("atL1"))
            for (int n = 2; n <= 3; ++n)
                deps.add ("atL" + juce::String (n) + k.key.substring (4));
        if (k.key.startsWith ("atM"))
            deps.add (k.key[3] == 'A' ? "modelA" : "modelB");
        if (k.key == "atMacro")
            deps.add ("*");
        const Knob* kp = &k;
        addLayer ("knob:" + k.key, r, deps, [this, kp, r] (juce::Graphics& g) { drawKnob (g, *kp, r.getSmallestIntegerContainer().toFloat().getTopLeft()); });
    }
    for (int w = 0; w < 2; ++w)
        for (int p = 1; p <= 4; ++p)
        {
            const auto key = "atM" + juce::String (w == 0 ? "A" : "B") + juce::String (p);
            juce::Rectangle<float> group;
            for (const auto& [id, n] : byId)
                if (id == key + "Label")
                    if (auto* kn = &n)
                        group = kn->r;
            // The group: from the knob's icon to its label.
            for (const auto& k : knobs)
                if (k.key == key)
                    group = group.getUnion (k.r).withLeft (k.r.getX() - 26).expanded (2);
            const int which = w;
            const int pi = p - 1;
            addLayer ("unused:" + key, group, { which == 0 ? "modelA" : "modelB" }, [this, which, pi] (juce::Graphics& g) {
                const auto* m = modelOf (which);
                if (m != nullptr && (*m)["p"][pi].toString().isEmpty())
                    g.fillAll (ink ("--look-panel", "#1b1d21").withAlpha (0.7f));
            });
        }
    // The FX line's modules.
    addLayer ("fx", chainR.expanded (8), { "fx", "fx." }, [this] (juce::Graphics& g) { drawFx (g); });
    // The readings, over everything.
    textLayer = addLayer ({}, getLocalBounds().toFloat(), { "*" }, [this] (juce::Graphics& g) {
        for (const auto& [node, text] : texts)
            if (auto it = page.nodes.find (node); it != page.nodes.end())
            {
                const auto id = it->second["id"].toString();
                drawText (g, it->second, text, id.endsWith ("Val") || id.endsWith ("Label"));
            }
        // The dock's octave and velocity.
        g.saveState();
        g.addTransform (juce::AffineTransform::translation (0, dockY));
        for (const auto& [i, n] : dock.nodes)
        {
            const auto id = n["id"].toString();
            if (id == "adOctRo")
                drawText (g, n, "C" + juce::String (kbLo / 12 - 1), true);
            else if (id == "adVel")
                drawText (g, n, velText, false);
        }
        g.restoreState();
    });
}

std::vector<std::pair<juce::String, double>> AtmosFace::profile (float scale)
{
    std::vector<std::pair<juce::String, double>> out;
    for (auto& l : layers)
    {
        juce::Image img (juce::Image::ARGB, juce::jmax (1, (int) ((float) l->getWidth() * scale)), juce::jmax (1, (int) ((float) l->getHeight() * scale)), true);
        juce::Graphics g (img);
        g.addTransform (juce::AffineTransform::scale (scale));
        const auto t0 = juce::Time::getMillisecondCounterHiRes();
        l->draw (g);
        out.push_back ({ l->name.isEmpty() ? juce::String ("text") : l->name, juce::Time::getMillisecondCounterHiRes() - t0 });
    }
    std::sort (out.begin(), out.end(), [] (auto& a, auto& b) { return a.second > b.second; });
    return out;
}

// ── the FX line (atfx.js) ─────────────────────────────────────────────────

juce::String AtmosFace::kindLabel (const juce::String& kind) const
{
    if (auto* suites = kindsList["suites"].getArray())
        for (const auto& s : *suites)
            if (auto* fams = s["families"].getArray())
                for (const auto& f : *fams)
                    if (auto* modes = f["modes"].getArray())
                        for (const auto& m : *modes)
                            if (m["kind"].toString() == kind)
                                return m["label"].toString();
    const auto l = kindsList["shapers"][juce::Identifier (kind)]["label"].toString();
    return l.isNotEmpty() ? l : kind;
}

juce::var AtmosFace::kindParams (const juce::String& kind) const
{
    return kindsList["shapers"][juce::Identifier (kind)]["params"];
}

// The colour family of a kind's suite (ATFX_FAM).
juce::String AtmosFace::kindFamily (const juce::String& kind) const
{
    static const std::map<juce::String, juce::String> fam {
        { "reverb", "space" }, { "delay", "time" }, { "modulation", "pitch" }, { "pitch", "pitch" }, { "dynamics", "level" }, { "saturation", "attack" },
        { "filter", "tone" }, { "stereo", "tone" }, { "utility", "level" }, { "spectral", "on" },
    };
    if (auto* suites = kindsList["suites"].getArray())
        for (const auto& s : *suites)
            if (auto* fams = s["families"].getArray())
                for (const auto& f : *fams)
                    if (auto* modes = f["modes"].getArray())
                        for (const auto& m : *modes)
                            if (m["kind"].toString() == kind)
                                if (auto it = fam.find (s["id"].toString().upToFirstOccurrenceOf ("-", false, false)); it != fam.end())
                                    return it->second;
    return "level";
}

// The modules in a row from the line's start, an arrow between each, the ＋ after.
void AtmosFace::layoutTiles()
{
    tiles.clear();
    const auto* chain = v["fx"].getArray();
    float x = chainR.getX() + 2;
    const float y = chainR.getCentreY() - 22;
    const auto font = face::sans (11, 600);
    const int n = chain == nullptr ? 0 : chain->size();
    for (int i = 0; i < n; ++i)
    {
        if (i)
            x += 4 + 10 + 4;
        const auto& s = chain->getReference (i);
        const auto name = kindLabel (s["kind"].toString());
        const float text = juce::jmax (juce::GlyphArrangement::getStringWidth (font, name), 40.0f);
        const float w = juce::jmax (128.0f, 8 + 9 + 8 + text + 8 + 40 + 10);
        Tile t { i, { x, y, w, 44 }, { x + 8, y + 17.5f, 9, 9 } };
        tiles.push_back (t);
        x += w;
    }
    if (n)
        x += 4 + 10 + 4;
    plus.r = { x, y, 44, 44 };
}

void AtmosFace::drawFx (juce::Graphics& g)
{
    const auto origin = chainR.expanded (8).getSmallestIntegerContainer().toFloat().getTopLeft();
    g.addTransform (juce::AffineTransform::translation (-origin.x, -origin.y));
    const auto* chain = v["fx"].getArray();
    const auto line = ink ("--look-line", "#2c3036"), t3 = ink ("--look-text-3", "#858b94"), on = ink ("--on", "#ffb547");
    auto arrow = [&] (float x) {
        g.setColour (t3);
        g.setFont (face::mono (13));
        g.drawText (juce::String::fromUTF8 ("\xe2\x80\xba"), juce::Rectangle<float> (x, chainR.getCentreY() - 10, 10, 20), juce::Justification::centred);
    };
    for (const auto& t : tiles)
    {
        const auto& s = chain->getReference (t.slot);
        const bool lit = (bool) s["on"];
        if (t.slot)
            arrow (t.r.getX() - 14);
        const auto sc = ink ("--f-" + kindFamily (s["kind"].toString()), "#c4c8d0");
        g.beginTransparencyLayer (lit ? 1.0f : 0.45f);
        juce::ColourGradient fill (ink ("--look-panel-hi", "#262a30"), 0, t.r.getY(), ink ("--look-panel", "#1b1d21"), 0, t.r.getBottom(), false);
        g.setGradientFill (fill);
        g.fillRoundedRectangle (t.r, 6);
        g.setColour (line);
        g.drawRoundedRectangle (t.r.reduced (0.5f), 6, 1);
        if (lit)
        {
            juce::DropShadow (on, 6, {}).drawForPath (g, [&] { juce::Path p; p.addEllipse (t.led); return p; }());
            g.setColour (on);
        }
        else
            g.setColour (line);
        g.fillEllipse (t.led);
        g.setColour (ink ("--look-text", "#e8eaee"));
        g.setFont (face::sans (11, 600));
        const float tx = t.led.getRight() + 8;
        g.drawText (kindLabel (s["kind"].toString()), juce::Rectangle<float> (tx, t.r.getY() + 8, t.r.getRight() - 58 - tx, 14), juce::Justification::centredLeft);
        g.setColour (sc);
        g.setFont (face::mono (9));
        juce::String where;
        if (auto* suites = kindsList["suites"].getArray())
            for (const auto& su : *suites)
                if (auto* fams = su["families"].getArray())
                    for (const auto& f : *fams)
                        if (auto* modes = f["modes"].getArray())
                            for (const auto& m : *modes)
                                if (m["kind"].toString() == s["kind"].toString())
                                    where = su["label"].toString() + dotSep + f["label"].toString();
        g.drawText (where, juce::Rectangle<float> (tx, t.r.getY() + 23, t.r.getRight() - 58 - tx, 12), juce::Justification::centredLeft);
        const juce::Rectangle<float> mini (t.r.getRight() - 50, t.r.getCentreY() - 11, 40, 22);
        g.setColour (ink ("--look-well", "#06070a"));
        g.fillRoundedRectangle (mini, 4);
        // What leaves the chain, and how hard this one works (atfxPaint).
        const float work = juce::jmin (1.0f, std::abs (t.slot < (int) works.size() ? works[(size_t) t.slot] : 0.0f) / 12.0f);
        for (size_t k = 0; k < levels.size(); ++k)
        {
            const float h = lit ? juce::jmax (2.0f, juce::jmin (1.0f, levels[k] * 1.4f + work * 0.5f) * (22 - 2)) : 2.0f;
            g.setColour (sc.withMultipliedAlpha (0.35f + 0.65f * ((float) k / (float) levels.size())));
            g.fillRect (mini.getX() + (float) k * 4, mini.getBottom() - h, 3.0f, h);
        }
        g.endTransparencyLayer();
    }
    if (!tiles.empty())
        arrow (plus.r.getX() - 14);
    // The ＋, a dashed box.
    juce::Path box;
    box.addRoundedRectangle (plus.r.reduced (0.5f), 6);
    juce::Path dashed;
    const float dash[] = { 3, 3 };
    juce::PathStrokeType (1).createDashedStroke (dashed, box, dash, 2);
    g.setColour (line);
    g.fillPath (dashed);
    g.setColour (t3);
    g.setFont (face::sans (16));
    g.drawText (juce::String::fromUTF8 ("\xef\xbc\x8b"), plus.r, juce::Justification::centred);
}

void AtmosFace::setChain (const juce::var& chain)
{
    v["fx"] = chain;
    if (send)
        send ("fx", juce::JSON::toString (chain, true));
    layoutTiles();
    repaintFor ("fx");
}

namespace
{
// Every suite, its families, their modes (atfxSuiteItems): choosing one calls `act(kind)`.
void addSuites (juce::PopupMenu& m, const juce::var& kinds, std::function<void (const juce::String&)> act)
{
    auto* suites = kinds["suites"].getArray();
    if (suites == nullptr || suites->isEmpty())
    {
        m.addItem ("No effects", false, false, nullptr);
        return;
    }
    for (const auto& s : *suites)
    {
        juce::PopupMenu sub;
        auto* fams = s["families"].getArray();
        if (fams == nullptr)
            continue;
        auto modes = [&] (juce::PopupMenu& into, const juce::var& f) {
            if (auto* ms = f["modes"].getArray())
                for (const auto& mode : *ms)
                {
                    const auto kind = mode["kind"].toString();
                    into.addItem (mode["label"].toString(), [act, kind] { act (kind); });
                }
        };
        if (fams->size() > 1)
            for (const auto& f : *fams)
            {
                juce::PopupMenu fm;
                modes (fm, f);
                sub.addSubMenu (f["label"].toString(), fm);
            }
        else if (!fams->isEmpty())
            modes (sub, fams->getReference (0));
        m.addSubMenu (s["label"].toString(), sub);
    }
}
} // namespace

void AtmosFace::fxInsert (int at, juce::Rectangle<float> near)
{
    juce::PopupMenu m;
    m.addSectionHeader ("INSERT EFFECT");
    addSuites (m, kindsList, [this, at] (const juce::String& kind) {
        juce::DynamicObject::Ptr params = new juce::DynamicObject();
        if (auto* ps = kindParams (kind).getArray())
            for (const auto& p : *ps)
                params->setProperty (p["key"].toString(), p["default"]);
        juce::DynamicObject::Ptr slot = new juce::DynamicObject();
        slot->setProperty ("kind", kind);
        slot->setProperty ("on", true);
        slot->setProperty ("params", juce::var (params.get()));
        slot->setProperty ("wet", 100);
        slot->setProperty ("level", 0);
        juce::Array<juce::var> chain;
        if (auto* c = v["fx"].getArray())
            chain = *c;
        const int where = juce::jlimit (0, chain.size(), at);
        chain.insert (where, juce::var (slot.get()));
        setChain (chain);
        fxWindow (where, {});
    });
    m.showMenuAsync (juce::PopupMenu::Options().withTargetScreenArea (localAreaToGlobal (near).toNearestInt()));
}

void AtmosFace::fxSlotMenu (int i, juce::Rectangle<float> near)
{
    auto* chain = v["fx"].getArray();
    if (chain == nullptr || i < 0 || i >= chain->size())
        return;
    const auto s = chain->getReference (i);
    juce::PopupMenu m;
    m.addSectionHeader (kindLabel (s["kind"].toString()).toUpperCase());
    m.addItem ("Open", [this, i] { fxWindow (i, {}); });
    m.addItem ((bool) s["on"] ? "Turn off" : "Turn on", [this, i] {
        auto c = v["fx"].clone();
        if (auto* a = c.getArray(); a != nullptr && i < a->size())
            if (auto* o = a->getReference (i).getDynamicObject())
            {
                const bool on = !(bool) o->getProperty ("on");
                o->setProperty ("on", on);
                v["fx"] = c;
                if (send)
                    send ("fx." + juce::String (i) + ".on", on ? "true" : "false");
                repaintFor ("fx");
            }
    });
    m.addSeparator();
    juce::PopupMenu replace;
    m.addItem ("Insert effect before...", [this, i, near] { fxInsert (i, near); });
    m.addItem ("Insert effect after...", [this, i, near] { fxInsert (i + 1, near); });
    addSuites (replace, kindsList, [this, i] (const juce::String& kind) {
        auto c = v["fx"].clone();
        if (auto* a = c.getArray(); a != nullptr && i < a->size())
            if (auto* o = a->getReference (i).getDynamicObject())
            {
                juce::DynamicObject::Ptr params = new juce::DynamicObject();
                if (auto* ps = kindParams (kind).getArray())
                    for (const auto& p : *ps)
                        params->setProperty (p["key"].toString(), p["default"]);
                o->setProperty ("kind", kind);
                o->setProperty ("params", juce::var (params.get()));
                setChain (c);
                fxWindow (i, {});
            }
    });
    m.addSubMenu ("Replace with", replace);
    m.addSeparator();
    m.addItem ("Remove", [this, i] {
        juce::Array<juce::var> c;
        if (auto* a = v["fx"].getArray())
            c = *a;
        c.remove (i);
        setChain (c);
    });
    m.showMenuAsync (juce::PopupMenu::Options().withTargetScreenArea (localAreaToGlobal (near).toNearestInt()));
}

namespace
{
// An effect's window (atfxOpen): its name, every control it has, its Mix and
// its Level, each a knob in the suite's colour.
class FxWindow final : public juce::Component
{
public:
    struct Param
    {
        juce::String key, label, unit;
        float min = 0, max = 1, value = 0, scale = 1;
        bool log = false;
        juce::Rectangle<float> r;
    };
    std::vector<Param> params;
    juce::String title, where;
    juce::Colour sc, panel, panelHi, line, text, t2, t3, well, track, on;
    bool lit = true;
    std::function<void (const Param&)> changed;
    std::function<void()> toggle, remove, close;
    juce::Rectangle<float> ledR, removeR, closeR, visR;
    std::vector<float> vis; // what leaves the chain, as it moves (atfxPaintVis)
    int turning = -1;
    float from = 0, y0 = 0;

    static float toKnob (const Param& p, float v)
    {
        const float u = p.log && p.min > 0 ? std::log (v / p.min) / std::log (p.max / p.min) : (v - p.min) / juce::jmax (1e-6f, p.max - p.min);
        return juce::jlimit (0.0f, 1.0f, u);
    }
    static float fromKnob (const Param& p, float u)
    {
        return p.log && p.min > 0 ? p.min * std::pow (p.max / p.min, u) : p.min + (p.max - p.min) * u;
    }
    static juce::String reading (const Param& p)
    {
        const float v = p.value;
        const auto& u = p.unit;
        juce::String n = std::abs (v) >= 1000 && u.containsIgnoreCase ("hz") ? juce::String (v / 1000, 1) + "k"
                         : std::abs (v) >= 100                              ? juce::String (juce::roundToInt (v))
                         : std::abs (v) >= 10                               ? juce::String (v, 1)
                                                                            : juce::String (v, 2);
        return n + (u == "%" ? juce::String ("%") : u.isNotEmpty() ? " " + (u.equalsIgnoreCase ("khz") ? juce::String ("kHz") : u) : juce::String());
    }

    void layout()
    {
        const float w = 600;
        float x = 12, y = 36 + 10 + 90 + 10;
        visR = { 12, 46, w - 24, 90 };
        for (size_t i = 0; i < params.size(); ++i)
        {
            if (i == params.size() - 2)
                x += 13; // the separator before Mix and Level
            if (x + 62 > w - 12)
                x = 12, y += 63;
            params[i].r = { x, y, 62, 57 };
            x += 66;
        }
        setSize ((int) w, (int) (y + 57 + 12));
        ledR = { 12, 13.5f, 9, 9 };
        closeR = { w - 32, 6, 24, 24 };
        removeR = { w - 32 - 10 - 70, 6, 70, 24 };
    }
    void paint (juce::Graphics& g) override
    {
        const auto b = getLocalBounds().toFloat();
        g.setGradientFill (juce::ColourGradient (panelHi, 0, 0, panel, 0, b.getHeight(), false));
        g.fillRoundedRectangle (b, 10);
        g.setColour (line);
        g.drawRoundedRectangle (b.reduced (0.5f), 10, 1);
        g.drawHorizontalLine (36, 0, b.getWidth());
        g.setColour (lit ? on : line);
        g.fillEllipse (ledR);
        g.setColour (text);
        g.setFont (face::sans (13, 600));
        const float tw = juce::GlyphArrangement::getStringWidth (g.getCurrentFont(), title);
        g.drawText (title, juce::Rectangle<float> (31, 0, tw + 2, 36), juce::Justification::centredLeft);
        g.setColour (t3);
        g.setFont (face::mono (10));
        g.drawText (where, juce::Rectangle<float> (31 + tw + 10, 0, 300, 36), juce::Justification::centredLeft);
        g.setColour (line);
        g.drawRoundedRectangle (removeR.reduced (0.5f), 6, 1);
        g.setColour (t2);
        g.setFont (face::sans (11, 500));
        g.drawText ("Remove", removeR, juce::Justification::centred);
        g.setColour (t3);
        g.setFont (face::sans (13));
        g.drawText (juce::String::fromUTF8 ("\xe2\x9c\x95"), closeR, juce::Justification::centred);
        g.setColour (well);
        g.fillRoundedRectangle (visR, 6);
        g.setColour (sc.withMultipliedAlpha (0.8f));
        for (size_t k = 0; k < vis.size(); ++k)
        {
            const float a = juce::jmin (1.0f, vis[k] * 1.6f) * (visR.getHeight() / 2 - 2);
            g.fillRect (visR.getX() + (float) k * 3, visR.getCentreY() - a, 2.0f, juce::jmax (1.0f, a * 2));
        }
        for (size_t i = 0; i < params.size(); ++i)
        {
            const auto& p = params[i];
            if (i == params.size() - 2)
            {
                g.setColour (line);
                g.fillRect (p.r.getX() - 9, p.r.getY(), 1.0f, 57.0f);
            }
            const juce::Rectangle<float> k (p.r.getCentreX() - 15, p.r.getY() + 1, 30, 30);
            const float t = toKnob (p, p.value);
            const float a0 = -juce::MathConstants<float>::pi * 0.75f, span = juce::MathConstants<float>::pi * 1.5f;
            juce::Path arc, rest;
            arc.addPieSegment (k, a0, a0 + span * t, 0);
            rest.addPieSegment (k, a0 + span * t, a0 + span, 0);
            g.setColour (sc);
            g.fillPath (arc);
            g.setColour (track);
            g.fillPath (rest);
            const auto face = k.reduced (4);
            juce::DropShadow (juce::Colours::black.withAlpha (0.5f), 3, { 0, 2 }).drawForPath (g, [&] { juce::Path e; e.addEllipse (face); return e; }());
            g.setGradientFill (juce::ColourGradient (juce::Colour (0xff3d4148), face.getCentreX(), face.getY() + face.getHeight() * 0.35f, juce::Colour (0xff2b2f35), face.getCentreX(), face.getBottom(), true));
            g.fillEllipse (face);
            juce::Path marker;
            const juce::Point<float> pivot (k.getCentreX(), k.getCentreY());
            marker.addRoundedRectangle (pivot.x - 1.1f, pivot.y - 9, 2.2f, 9, 2);
            marker.applyTransform (juce::AffineTransform::rotation (juce::degreesToRadians (-135.0f + t * 270.0f), pivot.x, pivot.y));
            g.setColour (text);
            g.fillPath (marker);
            g.setColour (t2);
            g.setFont (face::mono (10));
            g.drawText (FxWindow::reading (p), juce::Rectangle<float> (p.r.getX() - 4, p.r.getY() + 33, 70, 11), juce::Justification::centred);
            g.setColour (t3);
            g.setFont (face::sans (10, 500));
            g.drawText (p.label, juce::Rectangle<float> (p.r.getX(), p.r.getY() + 45, 62, 12), juce::Justification::centred);
        }
    }
    void mouseDown (const juce::MouseEvent& e) override
    {
        const auto at = e.position;
        if (ledR.expanded (4).contains (at) && toggle)
            return toggle();
        if (removeR.contains (at) && remove)
            return remove();
        if (closeR.contains (at) && close)
            return close();
        for (size_t i = 0; i < params.size(); ++i)
            if (juce::Rectangle<float> (params[i].r.getCentreX() - 15, params[i].r.getY() + 1, 30, 30).expanded (2).contains (at))
            {
                turning = (int) i;
                from = toKnob (params[i], params[i].value);
                y0 = at.y;
                return;
            }
        turning = -1;
        dragFrom = e.getEventRelativeTo (getParentComponent()).position - getPosition().toFloat();
    }
    void mouseDrag (const juce::MouseEvent& e) override
    {
        if (turning >= 0)
        {
            auto& p = params[(size_t) turning];
            // Full range over 200 pixels, in steps of a thousandth (the page's range input).
            const float u = juce::jlimit (0.0f, 1.0f, from + (y0 - e.position.y) / 200.0f);
            p.value = fromKnob (p, std::round (u * 1000) / 1000);
            if (changed)
                changed (p);
            repaint();
            return;
        }
        // Moved by its bar.
        if (e.mouseDownPosition.y < 36)
            setTopLeftPosition ((e.getEventRelativeTo (getParentComponent()).position - dragFrom).toInt());
    }
    void mouseUp (const juce::MouseEvent&) override { turning = -1; }

private:
    juce::Point<float> dragFrom;
};

} // namespace

void AtmosFace::fxWindow (int i, juce::Rectangle<float>)
{
    fxWin.reset();
    auto* chain = v["fx"].getArray();
    if (i < 0 || chain == nullptr || i >= chain->size())
        return;
    const auto s = chain->getReference (i);
    auto w = std::make_unique<FxWindow>();
    w->title = kindLabel (s["kind"].toString());
    if (auto* suites = kindsList["suites"].getArray())
        for (const auto& su : *suites)
            if (auto* fams = su["families"].getArray())
                for (const auto& f : *fams)
                    if (auto* modes = f["modes"].getArray())
                        for (const auto& m : *modes)
                            if (m["kind"].toString() == s["kind"].toString())
                                w->where = su["label"].toString() + dotSep + f["label"].toString();
    w->sc = ink ("--f-" + kindFamily (s["kind"].toString()), "#c4c8d0");
    w->panel = ink ("--look-panel", "#1b1d21");
    w->panelHi = ink ("--look-panel-hi", "#262a30");
    w->line = ink ("--look-line", "#2c3036");
    w->text = ink ("--look-text", "#e8eaee");
    w->t2 = ink ("--look-text-2", "#b9bec6");
    w->t3 = ink ("--look-text-3", "#858b94");
    w->well = ink ("--look-well", "#06070a");
    w->track = ink ("--look-track", "#2a2e34");
    w->on = ink ("--on", "#ffb547");
    w->lit = (bool) s["on"];
    if (auto* ps = kindParams (s["kind"].toString()).getArray())
        for (const auto& p : *ps)
        {
            FxWindow::Param q;
            q.key = p["key"].toString();
            q.label = p["label"].toString();
            q.unit = p["unit"].toString();
            q.min = numOf (p["min"]);
            q.max = numOf (p["max"], 1);
            q.log = (bool) p["log"];
            const auto kept = s["params"][juce::Identifier (q.key)];
            q.value = numOf (kept.isVoid() ? p["default"] : kept);
            w->params.push_back (q);
        }
    FxWindow::Param mix, level;
    mix.key = "wet", mix.label = "Mix", mix.unit = "%", mix.min = 0, mix.max = 100, mix.value = numOf (s["wet"], 100);
    level.key = "level", level.label = "Level", level.unit = "dB", level.min = -24, level.max = 12, level.value = numOf (s["level"], 0);
    w->params.push_back (mix);
    w->params.push_back (level);
    w->layout();
    w->changed = [this, i] (const FxWindow::Param& p) {
        auto c = v["fx"];
        if (auto* a = c.getArray(); a != nullptr && i < a->size())
            if (auto* o = a->getReference (i).getDynamicObject())
            {
                if (p.key == "wet" || p.key == "level")
                    o->setProperty (p.key, p.value);
                else if (auto* params = o->getProperty ("params").getDynamicObject())
                    params->setProperty (p.key, p.value);
            }
        if (send)
            send ("fx." + juce::String (i) + "." + p.key, juce::String (p.value));
    };
    w->toggle = [this, i] {
        auto c = v["fx"];
        if (auto* a = c.getArray(); a != nullptr && i < a->size())
            if (auto* o = a->getReference (i).getDynamicObject())
            {
                const bool on = !(bool) o->getProperty ("on");
                o->setProperty ("on", on);
                if (send)
                    send ("fx." + juce::String (i) + ".on", on ? "true" : "false");
                if (auto* win = dynamic_cast<FxWindow*> (fxWin.get()))
                    win->lit = on, win->repaint();
                repaintFor ("fx");
            }
    };
    w->remove = [this, i] {
        juce::MessageManager::callAsync ([this, i] {
            fxWindow (-1, {});
            juce::Array<juce::var> c;
            if (auto* a = v["fx"].getArray())
                c = *a;
            c.remove (i);
            setChain (c);
        });
    };
    w->close = [this] { juce::MessageManager::callAsync ([this] { fxWindow (-1, {}); }); };
    // Above its module.
    juce::Rectangle<float> tile = chainR;
    for (const auto& t : tiles)
        if (t.slot == i)
            tile = t.r;
    const int x = juce::jlimit (8, getWidth() - w->getWidth() - 8, (int) tile.getX());
    const int y = juce::jmax (8, (int) tile.getY() - w->getHeight() - 10);
    w->setTopLeftPosition (x, y);
    addAndMakeVisible (*w);
    fxWin = std::move (w);
}

// ── the keys ───────────────────────────────────────────────────────────────

void AtmosFace::note (int n, float vel, bool on)
{
    if (on)
    {
        if (held.count (n) > 0)
            return;
        held.insert (n);
        velText = "vel " + juce::String (juce::roundToInt (vel * 127));
        lastHz = 440.0f * std::pow (2.0f, ((float) n - 69.0f) / 12.0f);
    }
    else if (held.erase (n) == 0)
        return;
    if (onNote)
        onNote (n, vel, on);
    repaintNamed ("adKeys");
    if (textLayer != nullptr)
        textLayer->repaint();
    if (on && !isTimerRunning())
        startTimerHz (30);
}

void AtmosFace::keyAt (juce::Point<float> p)
{
    const auto local = p - keysR.getTopLeft();
    const int n = wave::keyAt (kbLo, local.x, local.y);
    if (n == mouseNote)
        return;
    if (mouseNote >= 0)
        note (mouseNote, 0, false);
    mouseNote = n;
    if (n >= 0)
        note (n, juce::jlimit (0.2f, 1.0f, 0.35f + 0.65f * (local.y / keysR.getHeight())), true);
}

bool AtmosFace::keyPressed (const juce::KeyPress& k)
{
    if (k.getModifiers().isCommandDown() || k.getModifiers().isCtrlDown() || k.getModifiers().isAltDown())
        return false;
    const auto c = juce::CharacterFunctions::toLowerCase (k.getTextCharacter());
    if (c == 'z' || c == 'x')
    {
        // Held, the key repeats: one octave a press (the page ignores repeats).
        if (octKey == c)
            return true;
        octKey = c;
        kbLo = juce::jlimit (12, 72, kbLo + (c == 'z' ? -12 : 12));
        repaintNamed ("adKeys");
        if (textLayer != nullptr)
            textLayer->repaint();
        return true;
    }
    const juce::String row ("awsedftgyhujkolp;");
    const int i = row.indexOfChar (c);
    if (i < 0)
        return false;
    if (keyNotes.count (c) == 0)
    {
        keyNotes[c] = kbLo + 12 + i;
        note (kbLo + 12 + i, 0.8f, true);
    }
    return true;
}

void AtmosFace::focusLost (FocusChangeType)
{
    // Every held note let go when the keys go elsewhere (the page's blur).
    for (const auto& [c, n] : keyNotes)
        note (n, 0, false);
    keyNotes.clear();
    octKey = 0;
}

bool AtmosFace::keyStateChanged (bool)
{
    bool used = false;
    if (octKey != 0 && !juce::KeyPress::isKeyCurrentlyDown ((int) octKey) && !juce::KeyPress::isKeyCurrentlyDown ((int) juce::CharacterFunctions::toUpperCase (octKey)))
        octKey = 0;
    for (auto it = keyNotes.begin(); it != keyNotes.end();)
    {
        if (!juce::KeyPress::isKeyCurrentlyDown ((int) it->first))
        {
            note (it->second, 0, false);
            it = keyNotes.erase (it);
            used = true;
        }
        else
            ++it;
    }
    return used;
}

// ── the live parts ─────────────────────────────────────────────────────────

void AtmosFace::timerCallback()
{
    bool sounding = false;
    if (readView)
    {
        const int a = readView (0, viewA), b = readView (1, viewB);
        sounding = a >= 0 || b >= 0;
        if (a >= 0 || modelLiveA >= 0)
            repaintNamed ("atPicA");
        if (b >= 0 || modelLiveB >= 0)
            repaintNamed ("atPicB");
        modelLiveA = a;
        modelLiveB = b;
    }
    if (readScope)
    {
        // scopeWindow: three periods of the last note's pitch, from a rising
        // zero crossing, scaled to its peak; quiet below 0.0015.
        // The last note's pitch, however it came (the engine's, tuned).
        if (heardHz)
            if (const float hz = heardHz(); hz > 1.0f)
                lastHz = hz;
        std::vector<float> buf (2048);
        const int got = readScope (buf.data(), (int) buf.size());
        buf.resize ((size_t) juce::jmax (0, got));
        float peak = 0;
        for (float s : buf)
            peak = juce::jmax (peak, std::abs (s));
        const bool was = scopeLive;
        scopeLive = peak >= 0.0015f && buf.size() > 64;
        if (scopeLive)
        {
            const int n = juce::jlimit (64, 1024, juce::roundToInt (3 * rate / lastHz));
            int start = 0;
            for (int i = 1; i < (int) buf.size() - n; ++i)
                if (buf[(size_t) i - 1] <= 0 && buf[(size_t) i] > 0)
                {
                    start = i;
                    break;
                }
            const int len = juce::jmin (n, (int) buf.size() - start);
            float p = 0;
            for (int i = 0; i < len; ++i)
                p = juce::jmax (p, std::abs (buf[(size_t) (start + i)]));
            scopeLast.assign ((size_t) len, 0.0f);
            for (int i = 0; i < len; ++i)
                scopeLast[(size_t) i] = buf[(size_t) (start + i)] / (p > 0 ? p : 1);
            sounding = true;
        }
        if (scopeLive || was)
            repaintNamed ("scopeOut");
    }
    if (meter && !tiles.empty())
    {
        float peak = 0;
        std::vector<float> peaks (tiles.size()), work (tiles.size());
        meter (&peak, peaks.data(), work.data(), (int) tiles.size());
        works = work;
        levels.push_back (peak);
        if (auto* win = dynamic_cast<FxWindow*> (fxWin.get()))
        {
            win->vis.push_back (peak);
            if ((float) win->vis.size() > win->visR.getWidth() / 3)
                win->vis.erase (win->vis.begin());
            win->repaint ((int) win->visR.getX(), (int) win->visR.getY(), (int) win->visR.getWidth(), (int) win->visR.getHeight());
        }
        if (levels.size() > 10)
            levels.erase (levels.begin());
        repaintNamed ("fx");
    }
    quiet = sounding || !held.empty() ? 0 : quiet + 1;
}

// ── the mouse ──────────────────────────────────────────────────────────────

void AtmosFace::menu (const juce::String& key, juce::Rectangle<float> near)
{
    juce::StringArray labels;
    const auto values = optionValues (key, &labels);
    const auto now = key == "adMidi" ? juce::String (midiChannel) : str (key);
    juce::PopupMenu m;
    for (int i = 0; i < values.size(); ++i)
        m.addItem (i + 1, labels[i], true, values[i] == now);
    m.showMenuAsync (juce::PopupMenu::Options().withTargetScreenArea (localAreaToGlobal (near).toNearestInt()).withMinimumWidth ((int) near.getWidth()),
                     [this, key, values] (int chosen) {
                         if (chosen <= 0)
                             return;
                         if (key == "adMidi")
                         {
                             midiChannel = values[chosen - 1].getIntValue();
                             if (send)
                                 send ("midiChannel", juce::String (midiChannel));
                             for (const auto& [i, n] : dock.nodes)
                                 if (n["id"].toString() == "adMidi")
                                     dock.selectValue[i] = chosen - 1, dock.redraw (rectOf (n["rect"]));
                             return;
                         }
                         set (key, values[chosen - 1]);
                     });
}

void AtmosFace::mouseDown (const juce::MouseEvent& e)
{
    turning = -1;
    if (blocked && blocked (e))
        return;
    grabKeyboardFocus();
    const auto at = e.position;
    // The FX window takes its own clicks; a click elsewhere closes it.
    if (fxWin != nullptr && !fxWin->getBounds().toFloat().contains (at))
        fxWindow (-1, {});
    // The FX line: its modules, their lights, the ＋, a right-click anywhere on it.
    if (chainR.expanded (0, 4).contains (at) || plus.r.contains (at) || (e.mods.isPopupMenu() && byId.count ("atFxLine") && byId["atFxLine"].r.contains (at)))
    {
        for (const auto& t : tiles)
            if (t.r.contains (at))
            {
                if (e.mods.isPopupMenu())
                    return fxSlotMenu (t.slot, t.r);
                if (t.led.expanded (4).contains (at))
                {
                    auto c = v["fx"];
                    if (auto* a = c.getArray(); a != nullptr && t.slot < a->size())
                        if (auto* o = a->getReference (t.slot).getDynamicObject())
                        {
                            const bool on = !(bool) o->getProperty ("on");
                            o->setProperty ("on", on);
                            if (send)
                                send ("fx." + juce::String (t.slot) + ".on", on ? "true" : "false");
                            repaintFor ("fx");
                        }
                    return;
                }
                return fxWindow (t.slot, t.r);
            }
        if (plus.r.contains (at) || e.mods.isPopupMenu())
            return fxInsert (v["fx"].size(), plus.r.contains (at) ? plus.r : juce::Rectangle<float> (at.x, at.y, 1, 1));
    }
    if (!e.mods.isLeftButtonDown())
        return;
    // The keys.
    if (keysR.contains (at))
    {
        keyAt (at);
        return;
    }
    if (octDown.contains (at) || octUp.contains (at))
    {
        kbLo = juce::jlimit (12, 72, kbLo + (octUp.contains (at) ? 12 : -12));
        repaintNamed ("adKeys");
        if (textLayer != nullptr)
            textLayer->repaint();
        return;
    }
    if (midiR.contains (at))
        return menu ("adMidi", midiR);
    // A knob: turned by dragging up and down, the whole range over 200 pixels.
    for (size_t i = 0; i < knobs.size(); ++i)
        if (knobs[i].r.contains (at))
        {
            turning = (int) i;
            turnFrom = num (keyOf (knobs[i].key));
            turnY = at.y;
            return;
        }
    // A model card: the model, with its controls at its own defaults.
    for (int w = 0; w < 2; ++w)
        for (const auto& c : cards[w])
            if (c.r.contains (at))
                return set (w == 0 ? "modelA" : "modelB", dataOf (c.n, "model"));
    for (const auto& t : tabs)
        if (t.r.contains (at))
        {
            lfoTab = dataOf (t.n, "lt").getIntValue();
            sync();
            for (auto& l : layers)
                if (l->name.startsWith ("knob:atL1"))
                    l->repaint();
            return;
        }
    for (const auto& s : selects)
        if (s.r.contains (at))
            return menu (stateKeyOfSelect (keyOf (dataOf (s.n, "k"))), s.r);
}

void AtmosFace::mouseDrag (const juce::MouseEvent& e)
{
    if (mouseNote >= 0)
        return keyAt (e.position);
    if (turning < 0)
        return;
    const auto& k = knobs[(size_t) turning];
    const float value = juce::jlimit (k.min, k.max, std::round (turnFrom + (turnY - e.position.y) / 200.0f * (k.max - k.min)));
    const auto key = keyOf (k.key);
    if (std::abs (value - num (key)) > 1e-6f)
        set (key, value);
}

void AtmosFace::mouseUp (const juce::MouseEvent&)
{
    if (mouseNote >= 0)
        note (mouseNote, 0, false);
    mouseNote = -1;
    turning = -1;
}

void AtmosFace::mouseDoubleClick (const juce::MouseEvent& e)
{
    // A knob back to the page's own default.
    for (const auto& k : knobs)
        if (k.r.contains (e.position))
            if (auto* list = data["knobs"].getArray())
                for (const auto& d : *list)
                    if (d[0].toString() == keyOf (k.key))
                        return set (keyOf (k.key), d[4]);
}
