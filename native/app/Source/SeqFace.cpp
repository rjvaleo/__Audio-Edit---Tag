#include "SeqFace.h"

#include "Canvas2D.h"

#include <cmath>

namespace
{
float numOf (const juce::var& v, float fallback = 0.0f)
{
    if (v.isString())
        return v.toString().getFloatValue();
    if (v.isBool())
        return (bool) v ? 1.0f : 0.0f;
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

juce::String firstText (const juce::var& n)
{
    if (auto* runs = n["text"].getArray(); runs != nullptr && !runs->isEmpty())
        return runs->getReference (0)["text"].toString();
    return {};
}

juce::Colour rgbCss (const juce::String& s)
{
    auto p = juce::StringArray::fromTokens (s.fromFirstOccurrenceOf ("(", false, false).upToFirstOccurrenceOf (")", false, false), ",", "");
    if (p.size() < 3)
        return juce::Colours::grey;
    return juce::Colour ((juce::uint8) p[0].trim().getIntValue(), (juce::uint8) p[1].trim().getIntValue(), (juce::uint8) p[2].trim().getIntValue(),
                         p.size() > 3 ? p[3].trim().getFloatValue() : 1.0f);
}

// Every node in `tree` (and below), in order.
void eachNode (const juce::var& n, const std::function<void (const juce::var&)>& f)
{
    f (n);
    if (auto* kids = n["kids"].getArray())
        for (const auto& k : *kids)
            eachNode (k, f);
}

const juce::var* findNode (const juce::var& tree, const std::function<bool (const juce::var&)>& want)
{
    if (want (tree))
        return &tree;
    if (auto* kids = tree["kids"].getArray())
        for (const auto& k : *kids)
            if (auto* f = findNode (k, want))
                return f;
    return nullptr;
}

const juce::String dot = juce::String::fromUTF8 (" \xc2\xb7 "), dash = juce::String::fromUTF8 ("\xe2\x80\x94"), cent = juce::String::fromUTF8 ("\xc2\xa2");
const char* noteNames[] = { "C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B" };

// JavaScript's toFixed, for the readings.
juce::String fixed (double v, int places) { return juce::String (v, places); }
// `parseInt` of a slider's value.
int pint (float v) { return (int) std::trunc (v); }
// The page's sliders' sums (app.js's update functions).
double cutoffHz (float v) { return 20.0 * std::pow (1000.0, pint (v) / 100.0); }
double resQ (float v) { return 0.1 + (pint (v) / 100.0) * 19.9; }
double lfoHz (float v) { return 0.05 * std::pow (400.0, pint (v) / 100.0); }
double hiCutHz (float v) { return 200.0 * std::pow (100.0, pint (v) / 100.0); }
juce::String khz (double f) { return f >= 1000 ? fixed (f / 1000.0, 1) + "kHz" : juce::String (juce::roundToInt (f)) + "Hz"; }
} // namespace

SeqFace::SeqFace (Send s, State st, Now nw)
    : send (std::move (s)), readState (std::move (st)), readNow (std::move (nw)), captured (face::page ("seq")), page (captured["page"])
{
    data = juce::JSON::parse (face::embeddedFile ("seq-page.json"));
    vars = captured["page"]["vars"];
    setSize ((int) numOf (captured["size"][0], 1500), (int) numOf (captured["size"][1], 1058));
    addAndMakeVisible (page);
    setWantsKeyboardFocus (true);
    auto part = [this] (Part& p, const char* name) {
        const auto& w = captured["parts"][name];
        p.tree = w["tree"];
        p.at = { numOf (w["at"][0]), numOf (w["at"][1]) };
        if (w.isObject())
            p.chrome = std::make_unique<face::Chrome> (w);
    };
    part (grid, "grid");
    part (keys88, "keys");
    part (play, "play");
    part (list, "list");
    part (chips, "chips");
    index (captured["page"]["tree"]);
    // The scale list's rows, in the list's own frame.
    if (list.tree.isObject())
    {
        eachNode (list.tree, [this] (const juce::var& n) {
            if (hasClass (n, "scale-category"))
                listRows.push_back ({ -1, rectOf (n["rect"]) });
            else if (hasClass (n, "scale-item"))
                listRows.push_back ({ dataOf (n, "scale").isNotEmpty() ? dataOf (n, "scale").getIntValue() : (int) listRows.size(), rectOf (n["rect"]) });
        });
        // Rows without the capture's mark are numbered in order.
        int k = 0;
        for (auto& r : listRows)
            if (r.scale >= 0)
                r.scale = k++;
        for (const auto& r : listRows)
            listHeight = juce::jmax (listHeight, r.r.getBottom());
    }
    buildLayers();
    reload();
    startMs = juce::Time::getMillisecondCounterHiRes();
    startTimerHz (30);
}

SeqFace::~SeqFace() { stopTimer(); }

juce::Colour SeqFace::token (const juce::String& t, const juce::String& fallback) const
{
    const auto s = vars[juce::Identifier (t)].toString();
    return c2d::css (s.isEmpty() ? fallback : s);
}

// `seqInk`: the canvases' colours, as look.js takes them from the theme.
juce::Colour SeqFace::ink (const juce::String& name, float alpha) const
{
    static const std::map<juce::String, std::pair<const char*, const char*>> inks {
        { "well", { "--look-well", "#06070a" } },       { "line", { "--look-line", "#2c3036" } },        { "text", { "--look-text", "#e8eaee" } },
        { "dim", { "--look-text-3", "#858b94" } },      { "attack", { "--look-f-attack", "#d88f7e" } },  { "tone", { "--look-f-tone", "#79bfc3" } },
        { "space", { "--look-f-space", "#8ec293" } },   { "pitch", { "--look-f-pitch", "#a99be0" } },    { "time", { "--look-f-time", "#cfa66c" } },
        { "on", { "--on", "#ffb547" } },
    };
    auto it = inks.find (name);
    const auto c = it == inks.end() ? token ("--look-text", "#e8eaee") : token (it->second.first, it->second.second);
    return alpha >= 1.0f ? c : c.withAlpha (alpha);
}

void SeqFace::index (const juce::var& n)
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
        k.step = juce::jmax (1e-6f, dataOf (n, "step").isEmpty() ? 1.0f : dataOf (n, "step").getFloatValue());
        k.kc = rgbCss (dataOf (n, "kc"));
        k.track = rgbCss (dataOf (n, "track"));
        k.r = node.r;
        if (auto* kids = n["kids"].getArray())
            for (const auto& c : *kids)
            {
                if (dataOf (c, "pseudo") == "::before")
                    k.before = c;
                if (dataOf (c, "pseudo") == "::after")
                    k.marker = face::colour (c["bg"]);
            }
        if (k.marker.isTransparent())
            k.marker = token ("--look-text", "#e8eaee");
        page.skip.insert (i);
        knobs.push_back (k);
    }
    if (n["select"].isObject() && dataOf (n, "k").isNotEmpty())
        selects.push_back (node);
    if (n["tag"].toString() == "button" && dataOf (n, "v").isNotEmpty())
    {
        const auto val = dataOf (n, "v");
        const bool dir = val == "fwd" || val == "rev" || val == "ping" || val == "rand";
        segs.push_back ({ dir ? "dir" : "stepLen", val, node });
    }
    if (hasClass (n, "step") && dataOf (n, "step").isNotEmpty())
    {
        stepNodes.push_back (node);
        page.skip.insert (i);
    }
    if (hasClass (n, "kb-key"))
    {
        keyNodes.push_back (node);
        page.skip.insert (i);
    }
    if (id == "scaleList")
    {
        listR = node.r;
        if (auto* kids = n["kids"].getArray())
            for (const auto& k : *kids)
                page.skip.insert ((int) k["i"]);
    }
    if (id == "scaleDegrees")
    {
        degreesR = node.r;
        if (auto* kids = n["kids"].getArray())
            for (const auto& k : *kids)
                page.skip.insert ((int) k["i"]);
    }
    if (id == "scaleRuler")
    {
        rulerR = node.r;
        if (auto* kids = n["kids"].getArray())
            for (const auto& k : *kids)
                page.skip.insert ((int) k["i"]);
    }
    if (hasClass (n, "perf-header"))
        perfR = node.r;
    if (n["tag"].toString() == "button")
    {
        const auto t = firstText (n);
        static const std::pair<const char*, const char*> acts[] = {
            { "\xe2\x96\xa0 STOP", "stop" }, { "Save", "save" }, { "\xe2\x9c\x95", "delete" }, { "Copy row 1 to all", "copyRow" }, { "Clear", "clear" },
        };
        for (const auto& [text, act] : acts)
            if (t == juce::String::fromUTF8 (text))
                buttons.push_back ({ node.r, act });
        if (id == "playBtn")
            buttons.push_back ({ node.r, "play" });
    }
    if (auto* kids = n["kids"].getArray())
        for (const auto& k : *kids)
            index (k);
}

// ── the values ─────────────────────────────────────────────────────────────

float SeqFace::num (const juce::String& key, float fallback) const
{
    auto it = v.find (key);
    return it == v.end() ? fallback : numOf (it->second, fallback);
}

juce::String SeqFace::str (const juce::String& key, const juce::String& fallback) const
{
    auto it = v.find (key);
    return it == v.end() || it->second.isVoid() ? fallback : it->second.toString();
}

void SeqFace::reload()
{
    if (auto* rows = data["knobs"].getArray())
        for (const auto& k : *rows)
            v[k[0].toString()] = k[4];
    if (auto* rows = data["selects"].getArray())
        for (const auto& s : *rows)
            if (auto* opts = s[1].getArray(); opts != nullptr && (int) s[2] < opts->size())
                v[s[0].toString()] = opts->getReference ((int) s[2])[0];
    v["scale"] = 0;
    readBack();
    sync();
    for (auto& l : layers)
        l->repaint();
}

void SeqFace::readBack()
{
    if (!readState)
        return;
    const auto state = juce::JSON::parse (readState());
    if (auto* o = state.getDynamicObject())
        for (const auto& p : o->getProperties())
            v[p.name.toString()] = p.value;
}

void SeqFace::set (const juce::String& key, const juce::var& value)
{
    v[key] = value;
    if (send)
        send (key, juce::JSON::toString (value, true));
    if (key == "root" || key == "octave")
        v["rootTouched"] = true;
    if (key == "play")
        playing = (bool) value;
    if (key.startsWith ("step") || key.startsWith ("rest") || key == "pattern")
        readBack();
    sync();
    repaintFor (key);
}

void SeqFace::repaintFor (const juce::String& key)
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
    if (textLayer != nullptr)
        textLayer->repaint();
}

// ── the page's sums ────────────────────────────────────────────────────────

const juce::var& SeqFace::scale() const
{
    const auto* a = data["scales"].getArray();
    static const juce::var none;
    if (a == nullptr || a->isEmpty())
        return none;
    return a->getReference (juce::jlimit (0, a->size() - 1, (int) num ("scale")));
}

juce::Array<juce::var> SeqFace::cents() const
{
    if (auto* c = scale()["cents"].getArray())
        return *c;
    return {};
}

double SeqFace::rootHz() const
{
    const int midi = juce::roundToInt (num ("root", 9)) + (juce::roundToInt (num ("octave", 4)) + 1) * 12;
    return 440.0 * std::pow (2.0, (midi - 69) / 12.0);
}

// `getFreqForDegree`.
double SeqFace::degreeHz (int degree) const
{
    const auto c = cents();
    const int n = c.size();
    if (n == 0)
        return 0;
    const int oct = (int) std::floor ((double) degree / n);
    const int d = degree % n;
    if (d < 0)
        return std::nan ("");
    return rootHz() * std::pow (2.0, ((double) c[d] + oct * 1200.0) / 1200.0);
}

// `compute88Notes`.
std::vector<SeqFace::Key88> SeqFace::notes88() const
{
    std::vector<Key88> out;
    const auto c = cents();
    const int rootMidiNum = juce::roundToInt (num ("root", 9)) + (juce::roundToInt (num ("octave", 4)) + 1) * 12;
    const double root = rootHz();
    for (int midi = 21; midi <= 108; ++midi)
    {
        const double total = (midi - rootMidiNum) * 100.0;
        const double octave = std::floor (total / 1200.0);
        int best = 0;
        double bestDist = 1e300;
        for (int d = 0; d < c.size(); ++d)
        {
            const double dist = std::abs (total - ((double) c[d] + octave * 1200.0));
            if (dist < bestDist)
                bestDist = dist, best = d;
        }
        const double hz = c.isEmpty() ? 440.0 : root * std::pow (2.0, ((double) c[best] + octave * 1200.0) / 1200.0);
        out.push_back ({ midi, bestDist < 60, best == 0 && bestDist < 30, best, hz });
    }
    return out;
}

// `updatePlayingUI`'s key: the in-scale key whose degree is nearest the step's.
int SeqFace::playingKey() const
{
    if (heard < 0)
        return -1;
    const auto ns = notes88();
    int best = -1, bestDist = 1 << 30;
    for (int i = 0; i < (int) ns.size(); ++i)
    {
        if (!ns[(size_t) i].inScale)
            continue;
        const int d = std::abs (ns[(size_t) i].degree - heardDeg);
        if (d < bestDist)
            bestDist = d, best = i;
    }
    return best;
}

// What a knob reads, as its update function writes it.
juce::String SeqFace::format (const juce::String& key, float x) const
{
    const int i = pint (x);
    if (key == "bpm" || key == "steps")
        return juce::String (juce::roundToInt (x));
    if (key == "atk" || key == "dec" || key == "rel" || key == "fatk" || key == "fdec" || key == "frel")
        return juce::String (i) + "ms";
    if (key == "cutoff")
        return khz (cutoffHz (x));
    if (key == "res")
        return "Q " + fixed (resQ (x), 1);
    if (key == "famt")
        return (i >= 0 ? "+" : "") + juce::String (i) + "%";
    if (key.startsWith ("lfo") && key.endsWith ("Rate"))
    {
        const double r = lfoHz (x);
        return (r < 1 ? fixed (r, 2) : fixed (r, 1)) + "Hz";
    }
    if (key == "delayHiCut")
        return khz (hiCutHz (x));
    if (key == "morphTime")
        return fixed (x, 1) + "s";
    return juce::String (i) + "%";
}

juce::StringArray SeqFace::optionValues (const juce::String& key, juce::StringArray* labels) const
{
    juce::StringArray out, names;
    if (key == "preset")
    {
        out.add (""), names.add (juce::String::fromUTF8 ("\xe2\x80\x94 recall \xe2\x80\x94"));
        if (presetNames)
            for (const auto& p : presetNames())
                out.add (p), names.add (p);
    }
    else if (auto* rows = data["selects"].getArray())
        for (const auto& s : *rows)
            if (s[0].toString() == key)
                if (auto* opts = s[1].getArray())
                    for (const auto& o : *opts)
                        out.add (o[0].toString()), names.add (o[1].toString());
    if (labels != nullptr)
        *labels = names;
    return out;
}

// The readings, the switches, the selects, as the page writes them.
void SeqFace::sync()
{
    texts.clear();
    auto txt = [this] (const juce::String& id, const juce::String& t) {
        auto it = byId.find (id);
        if (it == byId.end())
            return;
        page.skipText.insert (it->second.i);
        texts[it->second.i] = t;
    };
    for (const auto& k : knobs)
        txt (k.key + "Val", format (k.key, num (k.key)));
    // The delay's time and the tape's speed.
    const double bpm = num ("bpm", 120);
    txt ("delayTimeVal", juce::String (juce::roundToInt ((60.0 / bpm) * str ("delayTime", "0.5").getDoubleValue() * 1000.0)) + "ms");
    {
        static const std::map<juce::String, juce::String> ips { { "studio30", "30" }, { "studio15", "15" }, { "studio75", "7.5" }, { "studio375", "3.75" },
                                                                 { "cassette", juce::String::fromUTF8 ("1\xe2\x85\x9e") }, { "micro", "15/16" } };
        auto it = ips.find (str ("tapeSpeed", "studio75"));
        txt ("tapeSpeedVal", (it == ips.end() ? juce::String ("7.5") : it->second) + " IPS");
    }
    // The scale and its root.
    const auto& sc = scale();
    txt ("activeScaleName", sc["name"].toString().toUpperCase());
    txt ("activeScaleInfo", sc["info"].toString());
    txt ("statusScale", sc["name"].toString().toUpperCase());
    if ((bool) v["rootTouched"])
    {
        txt ("rootHzDisplay", fixed (rootHz(), 2));
        txt ("statusRoot", fixed (rootHz(), 2) + " Hz");
    }
    // What plays.
    if (heard >= 0)
    {
        txt ("statusNote", "DEG " + juce::String (heardDeg + 1));
        txt ("statusFreq", fixed (heardHz, 2) + " Hz");
        txt ("statusStep", juce::String (heard + 1));
        txt ("posDisplay", juce::String (heard / 4 + 1).paddedLeft ('0', 2) + dot + "0" + juce::String (heard % 4 + 1));
    }
    else
    {
        txt ("statusNote", dash), txt ("statusFreq", dash), txt ("statusStep", dash);
        txt ("posDisplay", juce::String ("01") + dot + "01");
    }
    if (str ("presetName").isNotEmpty() || str ("name").isNotEmpty())
        txt ("presetNameDisplay", (str ("name").isNotEmpty() ? str ("name") : str ("presetName")).toUpperCase());
    // Play, lit while playing: the captured lit button drawn over it.
    if (auto it = byId.find ("playBtn"); it != byId.end())
    {
        if (playing)
            page.skip.insert (it->second.i);
        else
            page.skip.erase (it->second.i);
        page.redraw (it->second.r);
    }
    // The segmented switches: the page's lit and unlit buttons.
    const auto before = page.styleFrom;
    for (const auto* key : { "dir", "stepLen" })
    {
        const Node *lit = nullptr, *unlit = nullptr;
        for (const auto& s : segs)
            if (s.key == key)
                (hasClass (s.n.n, "on") ? lit : unlit) = &s.n;
        if (lit == nullptr || unlit == nullptr)
            continue;
        for (const auto& s : segs)
            if (s.key == key)
            {
                const bool on = s.value == str (key);
                page.styleFrom[s.n.i] = on ? lit->i : unlit->i;
                // Their words, lit or not, are their kids' text in the button's own run.
            }
    }
    for (const auto& [node, look] : page.styleFrom)
        if (auto it = before.find (node); it == before.end() || it->second != look)
            if (auto nt = page.nodes.find (node); nt != page.nodes.end())
                page.redraw (rectOf (nt->second["rect"]));
    // The selects show what is chosen.
    for (const auto& s : selects)
    {
        const auto key = dataOf (s.n, "k");
        if (key == "preset" || key == "morph")
            continue;
        const int at = optionValues (key).indexOf (str (key));
        const int shown = page.selectValue.count (s.i) ? page.selectValue[s.i] : (int) s.n["select"]["value"];
        if (at >= 0 && at != shown)
        {
            page.selectValue[s.i] = at;
            page.redraw (s.r);
        }
    }
    // The pulse width's knob, dimmed but for Pulse (setWaveType).
    if (auto it = byId.find ("pwGroup"); it != byId.end())
    {
        const float o = str ("wave") == "pulse" ? 1.0f : 0.35f;
        if (!page.opacityOf.count (it->second.i) || page.opacityOf[it->second.i] != o)
        {
            page.opacityOf[it->second.i] = o;
            page.redraw (it->second.r);
        }
    }
    if (textLayer != nullptr)
        textLayer->repaint();
}

// ── drawing ────────────────────────────────────────────────────────────────

void SeqFace::drawText (juce::Graphics& g, const juce::var& n, const juce::String& text, bool centre)
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
    if (!centre && align == "center")
        x = run.getCentreX() - w / 2;
    const float baseline = run.getY() + (run.getHeight() - (font.getAscent() + font.getDescent())) / 2.0f + font.getAscent();
    juce::GlyphArrangement glyphs;
    if ((bool) f["ellipsis"] && w > r.getRight() - x)
        glyphs.addCurtailedLineOfText (font, text, x, baseline, r.getRight() - x, true);
    else
        glyphs.addLineOfText (font, text, x, baseline);
    glyphs.draw (g);
}

// A knob as look.js draws it: the arc from -135° in its colour as far as the
// value, the track after, the face over it, the marker turned.
void SeqFace::drawKnob (juce::Graphics& g, const Knob& k, juce::Point<float> origin)
{
    const float t = juce::jlimit (0.0f, 1.0f, (num (k.key) - k.min) / juce::jmax (1e-6f, k.max - k.min));
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
    const bool small = r.getWidth() < 24;
    const float mw = small ? 2.0f : 2.2f, mh = small ? 6.0f : 9.0f, top = small ? 4.0f : 6.0f;
    const juce::Point<float> pivot (r.getCentreX(), r.getY() + top + mh);
    juce::Path marker;
    marker.addRoundedRectangle (pivot.x - mw / 2, pivot.y - mh, mw, mh, 1.0f);
    marker.applyTransform (juce::AffineTransform::rotation (juce::degreesToRadians (-135.0f + t * 270.0f), pivot.x, pivot.y));
    g.setColour (k.marker);
    g.fillPath (marker);
}

// `drawADSRCanvas` and `drawFilterADSRCanvas`.
void SeqFace::drawAdsr (juce::Graphics& gr, float W, float H, bool filter)
{
    c2d::Context c (gr, W, H);
    const juce::String p = filter ? "f" : "";
    const float a = (float) pint (num (p + "atk", 10)), d = (float) pint (num (p + "dec", filter ? 150.0f : 80.0f));
    const float s = (float) pint (num (p + "sus", filter ? 30.0f : 60.0f)) / 100.0f, r = (float) pint (num (p + "rel", filter ? 300.0f : 200.0f));
    const float hold = juce::jmax (a + d, 120.0f), total = a + d + hold + r;
    const float pad = filter ? 4.0f : 5.0f;
    const float w = W - pad * 2, h = H - pad * 2 - (filter ? 6.0f : 0.0f);
    const float xA = pad + (a / total) * w, xD = xA + (d / total) * w, xS = xD + (hold / total) * w, xR = pad + w;
    const float yTop = pad, yBot = pad + h;
    const float amt = (float) pint (num ("famt", 50)) / 100.0f;
    const float ySus = filter ? yBot - h * s * std::abs (amt) : pad + h * (1 - s);
    const float yPeak = filter ? (amt >= 0 ? yTop : yBot) : yTop;
    const auto col = filter ? "tone" : "attack";
    auto path = [&] {
        c.beginPath();
        c.moveTo (pad, yBot);
        c.lineTo (xA, yPeak);
        c.lineTo (xD, ySus);
        c.lineTo (xS, ySus);
        c.lineTo (xR, yBot);
    };
    path();
    c.closePath();
    c.fillStyle = ink (col, 0.1f);
    c.fill();
    path();
    c.strokeStyle = ink (col);
    c.lineWidth = 1.5f;
    c.stroke();
    if (!filter)
        for (auto [x, y] : { std::pair<float, float> { xA, yTop }, { xD, ySus }, { xS, ySus } })
        {
            c.beginPath();
            c.arc (x, y, 2, 0, juce::MathConstants<float>::twoPi);
            c.fillStyle = ink (col);
            c.fill();
        }
    c.fillStyle = ink ("dim");
    c.font = "7px monospace";
    c.textAlign = "center";
    const float ly = filter ? yBot + 6 : yBot - 2;
    c.fillText ("A", (pad + xA) / 2, ly);
    c.fillText ("D", (xA + xD) / 2, ly);
    c.fillText ("S", (xD + xS) / 2, ly);
    c.fillText ("R", (xS + xR) / 2, ly);
}

// `drawLFOCanvas`, moving as the page's does (its phase on by 0.04 x rate a frame).
void SeqFace::drawLfo (juce::Graphics& gr, float W, float H, int i)
{
    c2d::Context c (gr, W, H);
    c.beginPath();
    c.moveTo (0, H / 2);
    c.lineTo (W, H / 2);
    c.strokeStyle = ink ("line");
    c.lineWidth = 1;
    c.stroke();
    const auto n = "lfo" + juce::String (i + 1);
    const auto shape = str (n + "Wave", "sine");
    const double cycles = 2.5;
    c.beginPath();
    for (int x = 0; x <= (int) W; ++x)
    {
        const double t = (x / (double) W) * cycles * 2 * juce::MathConstants<double>::pi + animPhase[i];
        double y;
        if (shape == "sine")
            y = std::sin (t);
        else
        {
            double p = std::fmod (t / (2 * juce::MathConstants<double>::pi), 1.0);
            if (p < 0)
                p += 1;
            y = shape == "triangle" ? (p < 0.5 ? 4 * p - 1 : 3 - 4 * p) : 2 * p - 1;
        }
        const float cy = (float) (H / 2 - y * (H / 2 - 4));
        if (x == 0)
            c.moveTo ((float) x, cy);
        else
            c.lineTo ((float) x, cy);
    }
    static const char* inks[] = { "attack", "tone", "space" };
    c.strokeStyle = ink (inks[i]);
    c.lineWidth = 1.5f;
    c.stroke();
}

// `drawPPCanvas`: the echoes going left and right on the delay's time.
void SeqFace::drawPingPong (juce::Graphics& gr, float W, float H)
{
    c2d::Context c (gr, W, H);
    c.strokeStyle = ink ("line");
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo (W / 2, 2);
    c.lineTo (W / 2, H - 13);
    c.stroke();
    c.fillStyle = ink ("dim");
    c.font = "8px monospace";
    c.textAlign = "center";
    c.fillText ("L", W * 0.25f, H - 2);
    c.fillText ("R", W * 0.75f, H - 2);
    const double T = (60.0 / num ("bpm", 120)) * str ("delayTime", "0.5").getDoubleValue();
    const double now = (juce::Time::getMillisecondCounterHiRes() - startMs) / 1000.0;
    const double phase2 = std::fmod (now, T * 2) / (T * 2);
    const float midY = H * 0.4f;
    auto echo = [&] (float cx, double pulse, const char* col) {
        c.beginPath();
        c.arc (cx, midY, (float) (4 + pulse * 5), 0, juce::MathConstants<float>::twoPi);
        c.fillStyle = ink (col, (float) (0.12 + pulse * 0.88));
        c.fill();
        if (pulse > 0.1)
        {
            c.beginPath();
            c.arc (cx, midY, (float) (10 + pulse * 6), 0, juce::MathConstants<float>::twoPi);
            c.strokeStyle = ink (col, (float) (pulse * 0.25));
            c.lineWidth = 2;
            c.stroke();
        }
    };
    echo (W * 0.25f, phase2 < 0.5 ? std::pow (1 - phase2 * 2, 0.4) : 0.0, "space");
    echo (W * 0.75f, phase2 >= 0.5 ? std::pow (1 - (phase2 - 0.5) * 2, 0.4) : 0.0, "tone");
    const double fb = pint (num ("delayFb", 35)) / 100.0;
    double amp = fb;
    for (int i = 1; i <= 5 && amp > 0.04; ++i)
    {
        double e = std::fmod (phase2 - i * 0.5, 1.0);
        if (e < 0)
            e += 1;
        const double pulse = e < 0.5 ? std::pow (1 - e * 2, 0.4) : 0.0;
        c.beginPath();
        c.arc (i % 2 == 1 ? W * 0.75f : W * 0.25f, midY, (float) (2 + pulse * 3), 0, juce::MathConstants<float>::twoPi);
        c.fillStyle = ink ("dim", (float) (amp * pulse));
        c.fill();
        amp *= fb;
    }
}

// The oscillator's scope (scopes.js) as set: three periods of Classic's wave.
void SeqFace::drawScope (juce::Graphics& gr, float W, float H)
{
    c2d::Context g (gr, W, H);
    g.fillStyle = ink ("line");
    g.fillRect (0, std::round (H / 2), W, 1);
    const auto wave = str ("wave", "sine");
    const double pw = pint (num ("pw", 50)) / 100.0;
    const int n = 240;
    const float mid = H / 2, amp = H * 0.4f;
    g.beginPath();
    for (int x = 0; x < (int) W; ++x)
    {
        const int i = juce::jmin (n - 1, (int) std::floor ((x / W) * n));
        const double ph = std::fmod ((i / (double) n) * 3, 1.0);
        const double s = wave == "sine" ? std::sin (ph * 2 * juce::MathConstants<double>::pi)
                         : wave == "triangle" ? (ph < 0.25 ? ph * 4 : ph < 0.75 ? 2 - ph * 4 : ph * 4 - 4)
                         : wave == "sawtooth" ? 2 * ph - 1
                         : wave == "square" ? (ph < 0.5 ? 1 : -1)
                                            : (ph < pw ? 1 : -1);
        if (x)
            g.lineTo ((float) x, (float) (mid - s * amp));
        else
            g.moveTo ((float) x, (float) (mid - s * amp));
    }
    g.strokeStyle = ink ("attack", 0.45f);
    g.lineWidth = 1.5f;
    g.stroke();
    g.font = "500 9px ui-monospace, Menlo, monospace";
    g.fillStyle = ink ("dim");
    g.fillText ("as set", 5, H - 5);
}

// ── the steps ──────────────────────────────────────────────────────────────

namespace
{
// The staged grid's step `i` (its capture: 0 picked, 1 resting, 2 playing,
// 9 resting and not played, the rest as the page lays them).
const juce::var* gridStep (const juce::var& tree, int i)
{
    return findNode (tree, [i] (const juce::var& n) { return hasClass (n, "step") && dataOf (n, "step").getIntValue() == i && dataOf (n, "step").isNotEmpty(); });
}
} // namespace

void SeqFace::drawStep (juce::Graphics& g, int i)
{
    if (i < 0 || i >= (int) stepNodes.size() || grid.chrome == nullptr)
        return;
    const auto pattern = v["pattern"];
    const int degree = pattern.isArray() && i < pattern.size() ? (int) numOf (pattern[i][0]) : i % 7;
    const bool rest = pattern.isArray() && i < pattern.size() ? (bool) pattern[i][1] : false;
    const bool active = i < juce::roundToInt (num ("steps", 8));
    // Which staged step has its look.
    int from = active ? 3 : 10;
    if (rest)
        from = active ? 1 : 9;
    if (i == heard && playing)
        from = 2;
    if (i == picked)
        from = 0;
    const auto* tmpl = gridStep (grid.tree, from);
    if (tmpl == nullptr)
        return;
    const auto tr = rectOf ((*tmpl)["rect"]) + grid.at;
    const auto offset = stepNodes[(size_t) i].r.getTopLeft() - tr.getTopLeft() + grid.at;
    std::set<int> words;
    eachNode (*tmpl, [&words] (const juce::var& n) {
        if (hasClass (n, "step-note") || hasClass (n, "step-oct") || hasClass (n, "step-hz") || hasClass (n, "step-num") || hasClass (n, "step-rest"))
            words.insert ((int) n["i"]);
    });
    grid.chrome->drawPart (g, *tmpl, offset, 1.0f, nullptr, &words);
    // Its words, written where the staged step has them.
    const auto c = cents();
    const int n = juce::jmax (1, c.size());
    const int d = ((degree % n) + n) % n;
    const int oct = (int) std::floor ((double) degree / n) + 1;
    juce::Graphics::ScopedSaveState keep (g);
    g.addTransform (juce::AffineTransform::translation (offset.x, offset.y));
    // Its words as dim as its box (the frame dims the box by its opacity).
    const float opacity = numOf ((*tmpl)["opacity"], 1.0f);
    const bool dim = opacity < 0.999f;
    if (dim)
        g.beginTransparencyLayer (opacity);
    const auto* restTmpl = gridStep (grid.tree, active ? 1 : 9);
    eachNode (*tmpl, [&] (const juce::var& node) {
        if (hasClass (node, "step-num"))
            drawText (g, node, juce::String (i + 1).paddedLeft ('0', 2), false);
        if (rest)
            return;
        if (hasClass (node, "step-note"))
            drawText (g, node, "D" + juce::String (d + 1), false);
        else if (hasClass (node, "step-oct"))
            drawText (g, node, "OCT" + juce::String (oct), false);
        else if (hasClass (node, "step-hz"))
            drawText (g, node, fixed (degreeHz (degree), 1) + "Hz", false);
    });
    // A rest's words, when its look is a playing note's (the picked or playing step).
    if (rest && restTmpl != nullptr && from != 1 && from != 9)
        if (const auto* w = findNode (*restTmpl, [] (const juce::var& x) { return hasClass (x, "step-rest"); }))
        {
            juce::Graphics::ScopedSaveState k2 (g);
            const auto delta = rectOf ((*restTmpl)["rect"]).getTopLeft() - tr.getTopLeft() + grid.at;
            g.addTransform (juce::AffineTransform::translation (-delta.x, -delta.y));
            drawText (g, *w, firstText (*w), false);
        }
    if (rest && (from == 1 || from == 9))
        eachNode (*tmpl, [&] (const juce::var& node) {
            if (hasClass (node, "step-rest"))
                drawText (g, node, firstText (node), false);
        });
    if (dim)
        g.endTransparencyLayer();
}

void SeqFace::drawSteps (juce::Graphics& g)
{
    for (int i = 0; i < (int) stepNodes.size(); ++i)
        if (i != picked)
            drawStep (g, i);
    // The picked one last: its buttons open over the row under it.
    if (picked >= 0)
        drawStep (g, picked);
}

std::vector<std::pair<juce::Rectangle<float>, juce::String>> SeqFace::stepButtons (int i) const
{
    std::vector<std::pair<juce::Rectangle<float>, juce::String>> out;
    const auto* tmpl = gridStep (grid.tree, 0);
    if (tmpl == nullptr || i < 0 || i >= (int) stepNodes.size())
        return out;
    const auto offset = stepNodes[(size_t) i].r.getTopLeft() - (rectOf ((*tmpl)["rect"]) + grid.at).getTopLeft() + grid.at;
    static const char* acts[] = { "degDown", "degUp", "octDown", "octUp", "rest", "preview" };
    int k = 0;
    eachNode (*tmpl, [&] (const juce::var& n) {
        if (hasClass (n, "step-mini-btn") && k < 6)
            out.push_back ({ rectOf (n["rect"]) + offset, acts[k++] });
    });
    return out;
}

int SeqFace::stepAt (juce::Point<float> p) const
{
    for (int i = 0; i < (int) stepNodes.size(); ++i)
        if (stepNodes[(size_t) i].r.contains (p))
            return i;
    return -1;
}

juce::String SeqFace::stepButtonAt (int i, juce::Point<float> p) const
{
    for (const auto& [r, act] : stepButtons (i))
        if (r.contains (p))
            return act;
    return {};
}

// `stepDegChange`, `stepOctChange`, `toggleRest`, `previewStep`.
void SeqFace::stepEdit (int i, const juce::String& what)
{
    const auto pattern = v["pattern"];
    if (!pattern.isArray() || i < 0 || i >= pattern.size())
        return;
    const int degree = (int) numOf (pattern[i][0]);
    const bool rest = (bool) pattern[i][1];
    const int n = juce::jmax (1, cents().size());
    const int oct = (int) std::floor ((double) degree / n);
    if (what == "degDown" || what == "degUp")
    {
        int d = degree % n + (what == "degUp" ? 1 : -1);
        if (d < 0)
            d = n - 1;
        if (d >= n)
            d = 0;
        set ("step" + juce::String (i), oct * n + d);
    }
    else if (what == "octDown" || what == "octUp")
    {
        const int o = juce::jlimit (0, 3, oct + (what == "octUp" ? 1 : -1));
        set ("step" + juce::String (i), o * n + degree % n);
    }
    else if (what == "rest")
        set ("rest" + juce::String (i), !rest);
    else if (what == "preview" && !rest)
        preview (degreeHz (degree));
    repaintNamed ("steps");
}

void SeqFace::preview (double hz)
{
    if (send && hz > 0)
        send ("preview", juce::String (hz, 6));
}

// ── the 88 keys, the list, the degrees, the ruler ───────────────────────────

void SeqFace::drawKeys (juce::Graphics& g)
{
    const auto ns = notes88();
    const int lit = playingKey();
    const auto pitch = token ("--f-pitch", "#a99be0"), on = token ("--on", "#ffb547"), text = token ("--look-text", "#e8eaee");
    for (int i = 0; i < (int) keyNodes.size() && i < (int) ns.size(); ++i)
    {
        const auto& k = ns[(size_t) i];
        const bool blk = juce::Array<int> { 1, 3, 6, 8, 10 }.contains (k.midi % 12);
        juce::Colour c = blk ? juce::Colour (0xff1c1f24) : juce::Colour (0xff3a3e45);
        if (k.inScale)
            c = blk ? pitch.interpolatedWith (juce::Colours::black, 0.3f) : pitch;
        if (k.isRoot)
            c = on;
        const auto r = keyNodes[(size_t) i].r;
        if (i == lit)
        {
            juce::DropShadow (text.withAlpha (0.8f), 6, {}).drawForRectangle (g, r.toNearestInt());
            c = text;
        }
        g.setColour (c);
        g.fillRoundedRectangle (r, 2.0f);
    }
}

void SeqFace::drawList (juce::Graphics& g)
{
    if (list.chrome == nullptr)
        return;
    juce::Graphics::ScopedSaveState keep (g);
    g.reduceClipRegion (listR.getSmallestIntegerContainer());
    // The chosen scale lit: the staged list's own selected and unselected looks.
    const int chosen = juce::roundToInt (num ("scale"));
    const juce::var *lit = nullptr, *unlit = nullptr;
    eachNode (list.tree, [&] (const juce::var& n) {
        if (hasClass (n, "scale-item"))
            (hasClass (n, "selected") ? lit : unlit) = &n;
    });
    int k = 0;
    if (lit != nullptr && unlit != nullptr)
    {
        auto kidsOf = [] (const juce::var& n) { return n["kids"].getArray(); };
        eachNode (list.tree, [&] (const juce::var& n) {
            if (!hasClass (n, "scale-item"))
                return;
            const auto& look = k == chosen ? *lit : *unlit;
            list.chrome->styleFrom[(int) n["i"]] = (int) look["i"];
            if (auto* a = kidsOf (n); a != nullptr)
                if (auto* b = kidsOf (look); b != nullptr)
                    for (int j = 0; j < a->size() && j < b->size(); ++j)
                        list.chrome->styleFrom[(int) a->getReference (j)["i"]] = (int) b->getReference (j)["i"];
            ++k;
        });
    }
    const auto origin = list.at - juce::Point<float> (0, listScroll);
    if (auto* kids = list.tree["kids"].getArray())
        for (const auto& n : *kids)
        {
            const auto r = rectOf (n["rect"]) + origin;
            if (r.getBottom() < listR.getY() || r.getY() > listR.getBottom())
                continue;
            list.chrome->drawPart (g, n, origin);
        }
}

juce::Rectangle<float> SeqFace::degreeChip (int d, int n) const
{
    const int cols = n <= 12 ? n : (n + 1) / 2;
    const float gap = 5;
    const float w = (degreesR.getWidth() - gap * (float) (cols - 1)) / (float) juce::jmax (1, cols);
    float h = 45;
    if (const auto* chip = findNode (n > 12 ? chips.tree : captured["page"]["tree"], [] (const juce::var& x) { return hasClass (x, "degree-chip"); }))
        h = rectOf ((*chip)["rect"]).getHeight();
    const int row = d / cols, col = d % cols;
    return { degreesR.getX() + (float) col * (w + gap), degreesR.getY() + (float) row * (h + gap), w, h };
}

// `renderScaleDegrees`: a chip a degree, its cents and its pitch.
void SeqFace::drawDegrees (juce::Graphics& g)
{
    const auto c = cents();
    const int n = c.size();
    const auto& tree = captured["page"]["tree"];
    const auto* rootChip = findNode (tree, [] (const juce::var& x) { return hasClass (x, "degree-chip") && hasClass (x, "root-chip"); });
    const auto* plainChip = findNode (tree, [] (const juce::var& x) { return hasClass (x, "degree-chip") && !hasClass (x, "root-chip"); });
    if (rootChip == nullptr || plainChip == nullptr)
        return;
    for (int i = 0; i < n; ++i)
    {
        const auto& tmpl = i == 0 ? *rootChip : *plainChip;
        const auto r = degreeChip (i, n);
        const auto tr = rectOf (tmpl["rect"]);
        std::set<int> words;
        eachNode (tmpl, [&words] (const juce::var& x) { words.insert ((int) x["i"]); });
        page.drawPart (g, tmpl, r.getTopLeft() - tr.getTopLeft(), 1.0f, nullptr, &words);
        juce::Graphics::ScopedSaveState keep (g);
        g.reduceClipRegion (r.getSmallestIntegerContainer());
        g.addTransform (juce::AffineTransform::translation (r.getX() - tr.getX(), r.getY() - tr.getY()));
        const double ct = (double) c[i];
        eachNode (tmpl, [&] (const juce::var& x) {
            if (hasClass (x, "degree-num"))
                drawText (g, x, "DEG " + juce::String (i + 1) + (i == 0 ? dot + "ROOT" : juce::String()), false);
            else if (hasClass (x, "degree-cents"))
                drawText (g, x, std::fmod (ct, 1200.0) == 0 && ct != 0 ? juce::String ("OCT") : fixed (ct, 1) + cent, false);
            else if (hasClass (x, "degree-hz"))
                drawText (g, x, fixed (rootHz() * std::pow (2.0, ct / 1200.0), 1) + "Hz", false);
        });
    }
}

// The ruler: the octave's twelve, and where this scale's degrees fall.
void SeqFace::drawRuler (juce::Graphics& g)
{
    const auto r = rulerR;
    g.setColour (juce::Colours::white.withAlpha (0.13f));
    for (int i = 0; i <= 12; ++i)
        g.fillRect (r.getX() + r.getWidth() * (float) i / 12.0f, r.getY() + 5, 1.0f, r.getHeight() - 10);
    const auto c = cents();
    for (int i = 0; i < c.size(); ++i)
    {
        const double ct = std::fmod (std::fmod ((double) c[i], 1200.0) + 1200.0, 1200.0);
        const float x = r.getX() + r.getWidth() * (float) (ct / 1200.0) - 1;
        g.setColour (i == 0 ? token ("--on", "#ffb547") : token ("--f-pitch", "#a99be0"));
        g.fillRoundedRectangle (x, r.getY() + 3, 3, r.getHeight() - 6, 2.0f);
    }
}

// ── layers ─────────────────────────────────────────────────────────────────

void SeqFace::addCanvas (const juce::String& id, juce::Rectangle<float> r, juce::StringArray deps, std::function<void (juce::Graphics&, float, float)> draw)
{
    const auto box = r.getSmallestIntegerContainer();
    const juce::Point<float> off (r.getX() - (float) box.getX(), r.getY() - (float) box.getY());
    addLayer (id, r, std::move (deps), [draw, r, off] (juce::Graphics& g) {
        g.addTransform (juce::AffineTransform::translation (off.x, off.y));
        g.reduceClipRegion (juce::Rectangle<float> (r.getWidth(), r.getHeight()).getSmallestIntegerContainer());
        draw (g, r.getWidth(), r.getHeight());
    });
}

SeqFace::Layer* SeqFace::addLayer (const juce::String& name, juce::Rectangle<float> r, juce::StringArray deps, std::function<void (juce::Graphics&)> draw)
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

void SeqFace::buildLayers()
{
    auto canvasRect = [this] (const juce::String& id) -> juce::Rectangle<float> {
        auto it = page.canvases.find (id);
        return it == page.canvases.end() ? juce::Rectangle<float>() : rectOf (it->second["rect"]);
    };
    addCanvas ("adsrCanvas", canvasRect ("adsrCanvas"), { "atk", "dec", "sus", "rel" }, [this] (juce::Graphics& g, float w, float h) { drawAdsr (g, w, h, false); });
    addCanvas ("fadsrCanvas", canvasRect ("fadsrCanvas"), { "fatk", "fdec", "fsus", "frel", "famt" }, [this] (juce::Graphics& g, float w, float h) { drawAdsr (g, w, h, true); });
    for (int i = 0; i < 3; ++i)
    {
        const auto id = "lfo" + juce::String (i + 1) + "Canvas";
        addCanvas (id, canvasRect (id), { "lfo" + juce::String (i + 1) + "Wave" }, [this, i] (juce::Graphics& g, float w, float h) { drawLfo (g, w, h, i); });
    }
    addCanvas ("ppCanvas", canvasRect ("ppCanvas"), {}, [this] (juce::Graphics& g, float w, float h) { drawPingPong (g, w, h); });
    addCanvas ("scopeClassic", canvasRect ("scopeClassic"), { "wave", "pw" }, [this] (juce::Graphics& g, float w, float h) { drawScope (g, w, h); });
    for (const auto& k : knobs)
    {
        const auto r = k.r.expanded (4);
        const Knob* kp = &k;
        addLayer ("knob:" + k.key, r, { k.key }, [this, kp, r] (juce::Graphics& g) { drawKnob (g, *kp, r.getSmallestIntegerContainer().toFloat().getTopLeft()); });
    }
    // Play, lit: the staged button.
    if (auto it = byId.find ("playBtn"); it != byId.end() && play.chrome != nullptr)
    {
        const auto r = it->second.r.expanded (4);
        addLayer ("play", r, { "play" }, [this, r] (juce::Graphics& g) {
            if (!playing)
                return;
            const auto o = r.getSmallestIntegerContainer().toFloat().getTopLeft();
            play.chrome->drawPart (g, play.tree, play.at - rectOf (play.tree["rect"]).getTopLeft() - o);
        });
    }
    auto bounds = [] (const std::vector<Node>& ns) {
        juce::Rectangle<float> u;
        for (const auto& n : ns)
            u = u.isEmpty() ? n.r : u.getUnion (n.r);
        return u;
    };
    const auto stepsR = bounds (stepNodes).expanded (4).withBottom (bounds (stepNodes).getBottom() + 60);
    addLayer ("steps", stepsR, { "steps", "step", "rest", "pattern", "scale", "root", "octave" }, [this, stepsR] (juce::Graphics& g) {
        const auto o = stepsR.getSmallestIntegerContainer().toFloat().getTopLeft();
        g.addTransform (juce::AffineTransform::translation (-o.x, -o.y));
        drawSteps (g);
    });
    const auto keysR = bounds (keyNodes).expanded (8);
    addLayer ("keys", keysR, { "scale", "root", "octave" }, [this, keysR] (juce::Graphics& g) {
        const auto o = keysR.getSmallestIntegerContainer().toFloat().getTopLeft();
        g.addTransform (juce::AffineTransform::translation (-o.x, -o.y));
        drawKeys (g);
    });
    addLayer ("list", listR, { "scale" }, [this] (juce::Graphics& g) {
        const auto o = listR.getSmallestIntegerContainer().toFloat().getTopLeft();
        g.addTransform (juce::AffineTransform::translation (-o.x, -o.y));
        drawList (g);
    });
    const auto degR = degreesR.withHeight (juce::jmax (degreesR.getHeight(), rulerR.getY() - degreesR.getY())).expanded (2);
    addLayer ("degrees", degR, { "scale", "root", "octave" }, [this, degR] (juce::Graphics& g) {
        const auto o = degR.getSmallestIntegerContainer().toFloat().getTopLeft();
        g.addTransform (juce::AffineTransform::translation (-o.x, -o.y));
        drawDegrees (g);
    });
    addLayer ("ruler", rulerR, { "scale" }, [this] (juce::Graphics& g) {
        const auto o = rulerR.getSmallestIntegerContainer().toFloat().getTopLeft();
        g.addTransform (juce::AffineTransform::translation (-o.x, -o.y));
        drawRuler (g);
    });
    textLayer = addLayer ({}, getLocalBounds().toFloat(), { "*" }, [this] (juce::Graphics& g) {
        for (const auto& [node, text] : texts)
            if (auto it = page.nodes.find (node); it != page.nodes.end())
            {
                const auto id = it->second["id"].toString();
                drawText (g, it->second, text, id.endsWith ("Val") && !id.startsWith ("delay") && !id.startsWith ("tape"));
            }
    });
}

std::vector<std::pair<juce::String, double>> SeqFace::profile (float scale)
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

// ── the live parts ─────────────────────────────────────────────────────────

void SeqFace::timerCallback()
{
    for (int i = 0; i < 3; ++i)
    {
        // `lfo.animPhase += 0.04 * lfo.rate` a frame (60 a second there).
        const auto n = "lfo" + juce::String (i + 1);
        animPhase[i] += 0.04 * 2.0 * lfoHz (num (n + "Rate", i == 0 ? 50.0f : 40.0f));
        repaintNamed (n + "Canvas");
    }
    repaintNamed ("ppCanvas");
    if (readNow)
    {
        int step = heard, deg = heardDeg;
        float hz = heardHz;
        const int r = readNow (step, hz, deg);
        const bool was = playing;
        playing = r >= 0;
        const int nowStep = r > 0 ? step : -1;
        if (nowStep != heard || was != playing || (r > 0 && hz != heardHz))
        {
            heard = nowStep, heardHz = hz, heardDeg = deg;
            sync();
            repaintNamed ("steps");
            repaintNamed ("keys");
            repaintNamed ("play");
        }
    }
}

// ── the mouse and keys ─────────────────────────────────────────────────────

void SeqFace::menu (const juce::String& key, juce::Rectangle<float> near)
{
    juce::StringArray labels;
    const auto values = optionValues (key, &labels);
    const auto now = str (key);
    juce::PopupMenu m;
    for (int i = 0; i < values.size(); ++i)
        m.addItem (i + 1, labels[i], true, values[i] == now);
    m.showMenuAsync (juce::PopupMenu::Options().withTargetScreenArea (localAreaToGlobal (near).toNearestInt()).withMinimumWidth ((int) near.getWidth()),
                     [this, key, values] (int chosen) {
                         if (chosen <= 0)
                             return;
                         const auto value = values[chosen - 1];
                         if (key == "preset")
                         {
                             if (value.isNotEmpty() && loadPreset)
                                 loadPreset (value), v["name"] = value, readBack(), sync();
                             for (auto& l : layers)
                                 l->repaint();
                             return;
                         }
                         if (key == "kyMidi_classic")
                             return set ("midiChannel", value.getIntValue());
                         // A number where the page's value is one (the root, the octave).
                         if (key == "root" || key == "octave")
                             return set (key, value.getIntValue());
                         set (key, value);
                     });
}

void SeqFace::mouseDown (const juce::MouseEvent& e)
{
    turning = -1;
    if (blocked && blocked (e))
        return;
    grabKeyboardFocus();
    const auto at = e.position;
    if (!e.mods.isLeftButtonDown())
        return;
    for (const auto& [r, act] : buttons)
        if (r.contains (at))
        {
            if (act == "play")
                return set ("play", !playing);
            if (act == "stop")
            {
                if (send)
                    send ("stop", "true");
                playing = false;
                heard = -1;
                sync();
                repaintNamed ("steps"), repaintNamed ("keys"), repaintNamed ("play");
                return;
            }
            if (act == "save")
            {
                if (savePreset)
                    savePreset();
                return;
            }
            if (act == "delete")
            {
                if (deletePreset && str ("name").isNotEmpty())
                    deletePreset (str ("name"));
                return;
            }
            if (act == "copyRow" || act == "clear")
            {
                auto pattern = v["pattern"];
                juce::Array<juce::var> out;
                for (int i = 0; i < 64; ++i)
                {
                    const auto& s = pattern.isArray() && i < pattern.size() ? pattern[act == "copyRow" ? i % 16 : i] : juce::var();
                    juce::Array<juce::var> pair { act == "clear" ? 0 : (int) numOf (s[0]), act == "clear" ? false : (bool) s[1] };
                    out.add (pair);
                }
                set ("pattern", out);
                return;
            }
        }
    // The picked step's buttons first: they lie over the row under it.
    if (picked >= 0)
        if (const auto act = stepButtonAt (picked, at); act.isNotEmpty())
            return stepEdit (picked, act);
    if (const int s = stepAt (at); s >= 0)
    {
        picked = s == picked ? -1 : s;
        repaintNamed ("steps");
        return;
    }
    // A key of the 88: its note, now.
    for (int i = 0; i < (int) keyNodes.size(); ++i)
        if (keyNodes[(size_t) i].r.contains (at))
        {
            const auto ns = notes88();
            if (i < (int) ns.size())
                preview (ns[(size_t) i].hz);
            return;
        }
    // A degree chip: its note.
    for (int d = 0; d < cents().size(); ++d)
        if (degreeChip (d, cents().size()).contains (at))
            return preview (rootHz() * std::pow (2.0, (double) cents()[d] / 1200.0));
    // The scale list.
    if (listR.contains (at))
    {
        const auto local = at - list.at + juce::Point<float> (0, listScroll);
        for (const auto& row : listRows)
            if (row.scale >= 0 && row.r.contains (local))
                return set ("scale", row.scale);
        return;
    }
    for (size_t i = 0; i < knobs.size(); ++i)
        if (knobs[i].r.contains (at))
        {
            turning = (int) i;
            turnFrom = num (knobs[i].key);
            turnY = at.y;
            return;
        }
    for (const auto& s : segs)
        if (s.n.r.contains (at))
            return set (s.key, s.value);
    for (const auto& s : selects)
        if (s.r.contains (at))
        {
            const auto key = dataOf (s.n, "k");
            if (key == "morph" || key == "compactScale")
                return;
            return menu (key, s.r);
        }
}

void SeqFace::mouseDrag (const juce::MouseEvent& e)
{
    if (turning < 0)
        return;
    const auto& k = knobs[(size_t) turning];
    // Full range over 200 pixels, snapped to the slider's step.
    float value = juce::jlimit (k.min, k.max, turnFrom + (turnY - e.position.y) / 200.0f * (k.max - k.min));
    value = juce::jlimit (k.min, k.max, k.min + std::round ((value - k.min) / k.step) * k.step);
    if (std::abs (value - num (k.key)) > 1e-6f)
        set (k.key, value);
}

void SeqFace::mouseUp (const juce::MouseEvent&) { turning = -1; }

void SeqFace::mouseDoubleClick (const juce::MouseEvent& e)
{
    for (const auto& k : knobs)
        if (k.r.contains (e.position))
            if (auto* rows = data["knobs"].getArray())
                for (const auto& d : *rows)
                    if (d[0].toString() == k.key)
                        return set (k.key, d[4]);
}

void SeqFace::mouseWheelMove (const juce::MouseEvent& e, const juce::MouseWheelDetails& w)
{
    if (!listR.contains (e.position))
        return Component::mouseWheelMove (e, w);
    listScroll = juce::jlimit (0.0f, juce::jmax (0.0f, listHeight - listR.getHeight()), listScroll - w.deltaY * 120.0f);
    repaintNamed ("list");
}

// The picked step: ◀ ▶ degree, ▼ ▲ octave, R rest, Enter play, Escape let go.
bool SeqFace::keyPressed (const juce::KeyPress& k)
{
    if (picked < 0 || k.getModifiers().isCommandDown() || k.getModifiers().isCtrlDown() || k.getModifiers().isAltDown())
        return false;
    const int code = k.getKeyCode();
    if (code == juce::KeyPress::leftKey)
        stepEdit (picked, "degDown");
    else if (code == juce::KeyPress::rightKey)
        stepEdit (picked, "degUp");
    else if (code == juce::KeyPress::downKey)
        stepEdit (picked, "octDown");
    else if (code == juce::KeyPress::upKey)
        stepEdit (picked, "octUp");
    else if (k.getTextCharacter() == 'r' || k.getTextCharacter() == 'R')
        stepEdit (picked, "rest");
    else if (code == juce::KeyPress::returnKey)
        stepEdit (picked, "preview");
    else if (code == juce::KeyPress::escapeKey)
        picked = -1, repaintNamed ("steps");
    else
        return false;
    return true;
}
