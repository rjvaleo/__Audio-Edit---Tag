// Prism's face: the drawings. Each layer draws what the page draws there
// now, over the captured frame: the page's own captured parts (lit or not,
// from the capture that shows them so) where only their state changes, its
// own SVGs with their attributes set as the page's code sets them (the pad,
// the knobs' rings, the LFO scope, the takes' thumbnails), and its words in
// the page's fonts. ui/app/385-hyperstretch.js (hsPaint), ui/prism-pad.js
// (prismDrawWave, prismRenderChain, prismShowHp), 386 (the pictures),
// 387 (prismLfoRender, prismLfoPaint), 073a (uiKnobPaint), 410 (the bar).
#include "PrismFace.h"

#include "Canvas2D.h"

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
double jsRound (double v) { return std::floor (v + 0.5); }
juce::String fixed (double v, int places)
{
    const double p = std::pow (10.0, places);
    const double r = std::floor (std::abs (v) * p + 0.5) / p;
    auto s = juce::String (r, places);
    return v < 0 && !juce::exactlyEqual (r, 0.0) ? "-" + s : s;
}
// uiR2: two places at most, no trailing zeros.
juce::String r2 (double v)
{
    const double r = std::round (v * 100) / 100;
    auto s = juce::String (r, 2);
    if (s.containsChar ('.'))
        s = s.trimCharactersAtEnd ("0").trimCharactersAtEnd (".");
    return s == "-0" ? juce::String ("0") : s;
}
juce::String f1 (double v) { return fixed (v, 1); }
juce::Font fontOf (const juce::var& n)
{
    if (auto* t = n["text"].getArray(); t != nullptr && !t->isEmpty())
        return face::font ((*t)[0]["font"]);
    return face::sans (11);
}
juce::String textOf (const juce::var& n)
{
    if (auto* t = n["text"].getArray(); t != nullptr && !t->isEmpty())
        return (*t)[0]["text"].toString();
    return {};
}
float widthOf (const juce::Font& f, const juce::String& s) { return juce::GlyphArrangement::getStringWidth (f, s); }
const juce::var* findNode (const juce::var& n, const std::function<bool (const juce::var&)>& want)
{
    if (want (n))
        return &n;
    if (auto* kids = n["kids"].getArray())
        for (const auto& k : *kids)
            if (auto* f = findNode (k, want))
                return f;
    return nullptr;
}
const juce::var* kid (const juce::var& n, const char* cls)
{
    return findNode (n, [cls] (const juce::var& x) { return hasClass (x, cls); });
}
juce::String rgba (juce::Colour c)
{
    return "rgba(" + juce::String (c.getRed()) + "," + juce::String (c.getGreen()) + "," + juce::String (c.getBlue()) + "," + juce::String (c.getFloatAlpha(), 3) + ")";
}

// An element of an SVG's markup (by `id="…"` or `class="…"`), one attribute set.
juce::String setAttr (juce::String svg, const juce::String& sel, const juce::String& attr, const juce::String& value)
{
    int at = svg.indexOf ("id=\"" + sel + "\"");
    if (at < 0)
        at = svg.indexOf ("class=\"" + sel + "\"");
    if (at < 0)
        return svg;
    const int start = svg.substring (0, at).lastIndexOfChar ('<');
    const int end = svg.indexOfChar (at, '>');
    if (start < 0 || end < 0)
        return svg;
    auto el = svg.substring (start, end);
    const auto key = " " + attr + "=\"";
    const int k = el.indexOf (key);
    if (k >= 0)
    {
        const int v0 = k + key.length();
        const int v1 = el.indexOfChar (v0, '"');
        el = el.substring (0, v0) + value + el.substring (v1);
    }
    else
    {
        const bool selfClose = el.endsWithChar ('/');
        el = (selfClose ? el.dropLastCharacters (1) : el) + key + value + "\"" + (selfClose ? "/" : "");
    }
    return svg.substring (0, start) + el + svg.substring (end);
}

void drawSvg (juce::Graphics& g, const juce::String& svg, juce::Rectangle<float> r)
{
    if (auto d = juce::Drawable::createFromSVGString (svg))
    {
        auto* comp = dynamic_cast<juce::DrawableComposite*> (d.get());
        const auto area = comp != nullptr ? comp->getContentArea() : juce::Rectangle<float>();
        if (!area.isEmpty())
            d->draw (g, 1.0f, juce::RectanglePlacement (juce::RectanglePlacement::stretchToFit).getTransformToFit (area, r));
        else
            d->drawWithin (g, r, juce::RectanglePlacement::stretchToFit, 1.0f);
    }
}

constexpr double A0 = juce::MathConstants<double>::pi * 0.75, SWEEP = juce::MathConstants<double>::pi * 1.5;
juce::String uiArc (double c, double r, double u0, double u1)
{
    if (u1 - u0 < 0.0005)
        return {};
    const double a = A0 + SWEEP * u0, b = A0 + SWEEP * u1;
    return "M" + r2 (c + r * std::cos (a)) + " " + r2 (c + r * std::sin (a)) + "A" + r2 (r) + " " + r2 (r) + " 0 " + (b - a > juce::MathConstants<double>::pi ? "1" : "0") + " 1 "
           + r2 (c + r * std::cos (b)) + " " + r2 (c + r * std::sin (b));
}

juce::String fmtTime (double sec)
{
    if (!std::isfinite (sec) || sec < 0)
        sec = 0;
    const int m = (int) std::floor (sec / 60), s = (int) std::floor (std::fmod (sec, 60.0)), ms = (int) std::floor (std::fmod (sec, 1.0) * 1000);
    return juce::String (m).paddedLeft ('0', 2) + ":" + juce::String (s).paddedLeft ('0', 2) + "." + juce::String (ms).paddedLeft ('0', 3);
}

const char* const engineNames[][2] = { { "granular", "Granular" }, { "wsola", "WSOLA" }, { "vocoder", "Vocoder" }, { "pvsola", "PVSOLA" }, { "hybrid", "Hybrid" } };
} // namespace

// ─────────────────────────────────────────────────────────────── helpers

void PrismFace::tree (juce::Graphics& g, const juce::var& node, juce::Point<float> by, const juce::String& text, float opacity)
{
    frame->drawPart (g, node, by, opacity);
    if (text.isNotEmpty())
        write (g, node, rectOf (node["rect"]) + by, text);
}

void PrismFace::write (juce::Graphics& g, const juce::var& node, juce::Rectangle<float> r, const juce::String& text, juce::Justification just, bool ellipsis)
{
    const auto f = fontOf (node);
    juce::String t = text;
    if (ellipsis && widthOf (f, t) > r.getWidth() + 0.5f)
    {
        while (t.isNotEmpty() && widthOf (f, t + uni ("\xe2\x80\xa6")) > r.getWidth())
            t = t.dropLastCharacters (1);
        t = t.trimEnd() + uni ("\xe2\x80\xa6");
    }
    face::paintText (g, node, r, t, just);
}

void PrismFace::drawSeg (juce::Graphics& g, const N& button, bool on)
{
    const auto& lk = on ? look["segOn"] : look["segOff"];
    if (!lk.isObject() || !button.ok())
        return;
    face::paintBox (g, lk, button.r);
    face::paintText (g, lk, button.r, textOf (button.n), juce::Justification::centred);
}

// ─────────────────────────────────────────────────────────────── SOURCE

void PrismFace::loadPeaks()
{
    peaksFor = soundPath + juce::String (frames);
    peaks.assign (1600, 0.0f);
    float pk = 0.001f;
    const int n = (int) call ([&] (NaApp* a) { return (int64_t) na_prism_peaks (a, id, 1600, peaks.data(), 1600, &pk); });
    peaks.resize ((size_t) juce::jmax (0, n));
    peakTop = juce::jmax (0.001f, pk);
}

void PrismFace::drawWave (juce::Graphics& g, juce::Rectangle<float> r, int head)
{
    // prismDrawWave: each pixel's column, the loudest of any channel, to the
    // loudest of all; the playhead `head` px wide over it, glowing at 2.
    const float w = r.getWidth(), h = r.getHeight(), mid = h / 2, A = mid - 1;
    const int cols = (int) peaks.size();
    if (cols > 0)
    {
        const auto bloom = juce::StringArray::fromTokens (captured["cl"]["--look-bloom"].toString(), ",", "");
        g.setColour (bloom.size() >= 3 ? juce::Colour ((juce::uint8) bloom[0].trim().getIntValue(), (juce::uint8) bloom[1].trim().getIntValue(), (juce::uint8) bloom[2].trim().getIntValue(), 0.3f)
                                       : juce::Colours::white.withAlpha (0.3f));
        // Twice over, as MGL's page shows it (its canvas is painted again over itself on load).
        for (int pass = 0; pass < 2; ++pass)
            for (int x = 0; x < (int) w; ++x)
            {
                const float m = juce::jmax (0.5f, peaks[(size_t) juce::jmin (cols - 1, (int) std::floor ((float) x / w * (float) cols))] / peakTop * A);
                g.fillRect (r.getX() + (float) x, r.getY() + mid - m, 1.0f, m * 2);
            }
    }
    if (inFrames > 0)
    {
        const double ratio = dnum (view["stretch"]["ratio"], 1);
        const double at = std::fmod (position / (inFrames * (juce::exactlyEqual (ratio, 0.0) ? 1 : ratio)), 1.0);
        const auto col = cl ("--look-text", "#e8eaee");
        const float x = r.getX() + (float) jsRound (at * (w - (float) head));
        if (head > 1)
            for (int k = 3; k >= 1; --k)
            {
                g.setColour (col.withAlpha (0.12f));
                g.fillRect (x - (float) k * 1.5f, r.getY(), (float) head + (float) k * 3.0f, h);
            }
        g.setColour (col);
        g.fillRect (x, r.getY(), (float) head, h);
    }
}

void PrismFace::drawSource (juce::Graphics& g)
{
    // The name, then the facts after it (the metastrip's line).
    if (pageIds.count ("prismSoundName"))
    {
        const auto& nm = pageIds["prismSoundName"];
        const auto name = soundName.isNotEmpty() ? soundName : uni ("No sound \xe2\x80\x94 choose one");
        const float w = widthOf (fontOf (nm.n), name);
        write (g, nm.n, nm.r.withWidth (w + 1), name, juce::Justification::centredLeft, false);
        if (pageIds.count ("prismSoundMeta"))
        {
            const auto& mt = pageIds["prismSoundMeta"];
            write (g, mt.n, mt.r.withX (nm.r.getX() + w + 8).withWidth (widthOf (fontOf (mt.n), metaLine) + 1), metaLine, juce::Justification::centredLeft, false);
        }
    }
    if (pageIds.count ("prismSrc"))
    {
        juce::Graphics::ScopedSaveState s (g);
        const auto r = pageIds["prismSrc"].r;
        g.reduceClipRegion (r.toNearestInt());
        drawWave (g, r, 2);
    }
}

// ─────────────────────────────────────────────────────────────── the head

void PrismFace::drawHead (juce::Graphics& g)
{
    // The Process button: the process's picture and name.
    const auto* src = currentSource();
    const auto sid = src != nullptr ? (*src)["id"].toString() : juce::String ("stretch");
    juce::String kind = sid, label = src != nullptr ? (*src)["label"].toString() : juce::String ("Time & Pitch");
    if (sid != "stretch" && sid != "ptc")
        if (auto* ch = view["chain"].getArray())
            for (const auto& c : *ch)
                if (c["id"].toString() == sid)
                {
                    kind = c["kind"].toString();
                    if (kind.startsWith ("prism:hp-"))
                        label = c["label"].toString().replace ("Hyperprism ", "").trimStart();
                }
    if (pageIds.count ("prismPickBtn"))
        if (auto* kids = pageIds["prismPickBtn"].n["kids"].getArray(); kids != nullptr && kids->size() >= 2)
        {
            ppic::draw (g, ppic::procIcon (kind), rectOf ((*kids)[0]["rect"]), menuStyle);
            const auto& sp = (*kids)[1];
            write (g, sp, rectOf (sp["rect"]).withRight (253.0f), label);
        }
    // X and Y: their controls' names.
    for (const char* ax : { "x", "y" })
    {
        const auto k = juce::String ("dd:prism") + juce::String (ax).toUpperCase();
        if (pageIds.count (k) == 0)
            continue;
        if (auto* dt = kid (pageIds[k].n, "ui-dt"))
        {
            const auto* c = control (setup[ax].toString());
            write (g, *dt, rectOf ((*dt)["rect"]), c != nullptr ? (*c)["label"].toString() : juce::String());
        }
    }
    // ● lit while a take is being recorded; the chip says what is going on.
    const auto mode = pad["mode"].toString();
    const auto L = juce::String::charToString ((juce::juce_wchar) ('A' + juce::jlimit (0, 3, (int) dnum (pad["slot"]))));
    if (mode == "rec" && look["recOn"].isObject() && litC != nullptr)
        litC->drawPart (g, look["recOn"]);
    juce::String chip;
    if (mode == "rec")
        chip = "REC " + uni ("\xc2\xb7 ") + L + uni (" \xc2\xb7 ") + ((bool) pad["loopOnRelease"] ? "release to loop" : uni ("until \xe2\x96\xb6 or \xe2\x96\xa0"));
    else if (mode == "play")
        chip = "PLAY " + uni ("\xc2\xb7 ") + L;
    else if (mode == "pause")
        chip = "PAUSE " + uni ("\xc2\xb7 ") + L;
    else
        chip = "READY " + uni ("\xc2\xb7 ") + "grab the pad to record";
    if (pageIds.count ("hsChip"))
    {
        const auto& c = pageIds["hsChip"];
        const auto& style = mode == "rec" || mode == "play" ? look["chipRec"] : c.n;
        write (g, style.isObject() ? style : c.n, c.r.withWidth (172.84f), chip);
    }
    // The preset bar: the preset's name, and the process it is for.
    if (pageIds.count ("pb:label"))
    {
        const auto& lb = pageIds["pb:label"];
        auto name = presetList["label"].toString();
        if (name.isEmpty())
            name = "No preset";
        const auto open = pageIds.count ("pb:open") ? pageIds["pb:open"].r : lb.r.withWidth (226);
        const float avail = open.getRight() - 22 - lb.r.getX();
        const auto tag = presetList["tag"].toString();
        const float tagW = tag.isEmpty() ? 0.0f : juce::jmin (62.0f, widthOf (fontOf (pageIds["pb:tag"].n), tag) + 10);
        const float nameW = juce::jmin (widthOf (fontOf (lb.n), name) + 1, avail - (tagW > 0 ? tagW + 6 : 0));
        write (g, lb.n, lb.r.withWidth (nameW), name);
        if (tag.isNotEmpty() && pageIds.count ("pb:tag"))
        {
            const auto& tg = pageIds["pb:tag"];
            const auto r = tg.r.withX (lb.r.getX() + nameW + 6).withWidth (tagW);
            face::paintBox (g, tg.n, r);
            face::paintText (g, tg.n, r, tag, juce::Justification::centred);
        }
    }
}

// ─────────────────────────────────────────────────────────── the Sound row

void PrismFace::drawDeck (juce::Graphics& g)
{
    auto dt = [&] (const char* sel, const juce::String& text) {
        const auto k = juce::String ("dd:") + sel;
        if (pageIds.count (k))
            if (auto* d = kid (pageIds[k].n, "ui-dt"))
                write (g, *d, rectOf ((*d)["rect"]), text);
    };
    const auto folder = soundPath.upToLastOccurrenceOf ("/", false, false).fromLastOccurrenceOf ("/", false, false);
    dt ("prismSoundFolder", folder);
    dt ("prismSoundFile", soundName.isNotEmpty() ? soundName : uni ("Choose a sound\xe2\x80\xa6"));
    dt ("prismChainAdd", "+ add effect");
    // The mini overview.
    if (look["wellMini"].isObject())
    {
        miniBox = rectOf (look["wellMini"]["rect"]);
        frame->drawPart (g, look["wellMini"]);
        juce::Graphics::ScopedSaveState s (g);
        g.reduceClipRegion (miniBox.toNearestInt());
        drawWave (g, miniBox, 1);
    }
    // CHAIN: n · name ×, right-aligned before + add effect.
    chainX.clear();
    const auto& slotLook = look["chainSlot"];
    if (!slotLook.isObject())
        return;
    auto* kids = slotLook["kids"].getArray();
    if (kids == nullptr || kids->size() < 3)
        return;
    const auto& nN = (*kids)[0];
    const auto& nameN = (*kids)[1];
    const auto& xN = (*kids)[2];
    const auto fN = fontOf (nN), fName = fontOf (nameN);
    struct S { juce::String sid, n, name; float w; };
    std::vector<S> slots;
    float total = 0;
    if (auto* ch = view["chain"].getArray())
        for (int i = 0; i < ch->size(); ++i)
        {
            const auto& c = (*ch)[i];
            S s { c["id"].toString(), juce::String (i + 1) + uni (" \xc2\xb7"), c["label"].toString(), 0 };
            s.w = 10 + widthOf (fN, s.n) + 6 + widthOf (fName, s.name) + 7 + 15 + 4;
            total += s.w + (slots.empty() ? 0 : 6);
            slots.push_back (s);
        }
    const float right = 1338.4f;
    float x = right - total;
    const auto sr = rectOf (slotLook["rect"]);
    for (const auto& s : slots)
    {
        const auto r = juce::Rectangle<float> (x, sr.getY(), s.w, sr.getHeight());
        face::paintBox (g, slotLook, r);
        const float nw = widthOf (fN, s.n);
        face::paintText (g, nN, rectOf (nN["rect"]).withX (x + 10).withWidth (nw + 1), s.n);
        const float namew = widthOf (fName, s.name);
        face::paintText (g, nameN, rectOf (nameN["rect"]).withX (x + 10 + nw + 6).withWidth (namew + 1), s.name);
        const auto xr = rectOf (xN["rect"]);
        const auto xAt = juce::Point<float> (x + 10 + nw + 6 + namew + 7, xr.getY());
        frame->drawPart (g, xN, xAt - xr.getPosition());
        chainX.push_back ({ s.sid, xr.withPosition (xAt) });
        x += s.w + 6;
    }
    if (look["chainCap"].isObject())
    {
        const auto cr = rectOf (look["chainCap"]["rect"]);
        frame->drawPart (g, look["chainCap"], { (right - total - 8 - cr.getWidth()) - cr.getX(), 0 });
    }
}

// ─────────────────────────────────────────────────────────────── the pad

namespace
{
// hsValue on one axis, from the setup and the control.
double padValue (const juce::var& setup, const juce::var* c, bool xAxis, double f)
{
    const double lo = dnum (setup[xAxis ? "xLo" : "yLo"]), hi = dnum (setup[xAxis ? "xHi" : "yHi"]);
    const bool lg = c != nullptr && (bool) (*c)["log"] && lo > 0 && hi > 0;
    const double t = xAxis ? f : 1 - f;
    double v = lg ? lo * std::pow (hi / lo, t) : lo + t * (hi - lo);
    // The last bits of the logarithm's way there are not the page's: to
    // twelve figures, which is all a reading shows.
    if (std::abs (v) > 0)
    {
        const double k = std::pow (10.0, 11 - std::floor (std::log10 (std::abs (v))));
        v = std::round (v * k) / k;
    }
    return c != nullptr && juce::exactlyEqual (dnum ((*c)["step"]), 1.0) ? jsRound (v) : v;
}
// prismFormat.
juce::String padFormat (const juce::var* c, double v)
{
    if (c == nullptr || !std::isfinite (v))
        return {};
    if (auto* ch = (*c)["choices"].getArray())
    {
        const int k = (int) jsRound (v - dnum ((*c)["min"]));
        return k >= 0 && k < ch->size() ? (*ch)[k].toString() : juce::String ((int64_t) jsRound (v));
    }
    const auto key = (*c)["key"].toString(), unit = (*c)["unit"].toString();
    if (key == "ratio")
        return (v >= 10 ? fixed (v, 0) : v >= 1 ? fixed (v, 2) : fixed (v, 3)) + uni ("\xc3\x97");
    if (key == "semitones")
        return (v >= 0 ? "+" : "") + fixed (v, 1) + " st";
    // fxValueFormat.
    if (unit == "Hz")
        return v >= 1000 ? fixed (v / 1000, 2) + " kHz" : (v < 10 ? fixed (v, 2) : juce::String ((int64_t) jsRound (v))) + " Hz";
    if (unit == "ms")
        return v >= 1000 ? fixed (v / 1000, 2) + " s" : juce::String ((int64_t) jsRound (v)) + " ms";
    if (unit == "dB")
        return fixed (v, 1) + " dB";
    if (unit.isNotEmpty())
        return fixed (v, 2) + " " + unit;
    return dnum ((*c)["min"]) >= 0 && dnum ((*c)["max"]) <= 1.001 ? juce::String ((int64_t) jsRound (v * 100)) + "%" : fixed (v, 2);
}
} // namespace

void PrismFace::drawPadPanel (juce::Graphics& g)
{
    // hsInfo: what the take is.
    const auto mode = pad["mode"].toString();
    const int slot = juce::jlimit (0, 3, (int) dnum (pad["slot"]));
    const auto L = juce::String::charToString ((juce::juce_wchar) ('A' + slot));
    const auto& take = pad["slots"][slot];
    juce::String info;
    if (mode == "rec" && !pad["recN"].isVoid())
        info = "Take " + L + uni (" \xc2\xb7 recording \xc2\xb7 ") + juce::String ((int) dnum (pad["recN"])) + " points";
    else if (take.isObject())
        info = "Take " + L + uni (" \xc2\xb7 ") + fixed (dnum (take["dur"]) / 1000, 2) + uni (" s \xc2\xb7 ") + juce::String ((int) dnum (take["n"])) + uni (" points \xc2\xb7 loops at its own length");
    else
        info = "Take " + L + uni (" empty \xc2\xb7 grab the pad to record into it");
    if (pageIds.count ("hsInfo"))
    {
        const auto& n = pageIds["hsInfo"];
        write (g, n.n, n.r.withWidth (117.4f), info);
    }
    // The engine the pad plays through.
    const auto alg = view["stretch"]["algorithm"].toString();
    for (const auto& e : engineNames)
        if (pageIds.count ("eng:" + juce::String (e[0])))
            drawSeg (g, pageIds["eng:" + juce::String (e[0])], alg == e[0] || (alg.isEmpty() && juce::String (e[0]) == "granular"));
    // hsNow: where the glide has the sound now.
    if (pageIds.count ("hsNow"))
    {
        juce::String name = "Granular";
        for (const auto& e : engineNames)
            if (alg == e[0])
                name = e[1];
        const auto& gh = pad["ghost"];
        const auto* cx = control (setup["x"].toString());
        const auto* cy = control (setup["y"].toString());
        const auto t = name + uni (" \xc2\xb7 ") + padFormat (cx, padValue (setup, cx, true, dnum (gh[0], 0.5))) + uni (" \xc2\xb7 ") + padFormat (cy, padValue (setup, cy, false, dnum (gh[1], 0.5)));
        const auto& n = pageIds["hsNow"];
        write (g, n.n, n.r.withWidth (n.r.getWidth() + 12), t);
    }
}

void PrismFace::drawPadBox (juce::Graphics& g)
{
    // The pad's box, lit while recording or not: drawn once each at the
    // screen's sharpness and kept.
    const bool rec = pad["mode"].toString() == "rec";
    const auto& padLook = rec && look["padRec"].isObject() ? look["padRec"] : look["padOff"];
    if (!padLook.isObject())
        return;
    const float scale = juce::jmax (1.0f, g.getInternalContext().getPhysicalPixelScaleFactor());
    if (!juce::exactlyEqual (scale, padBoxScale))
    {
        padBoxScale = scale;
        padBoxImage[0] = padBoxImage[1] = {};
    }
    const auto area = juce::Rectangle<float> (18, 240, 704, 795);
    // Both looks at once, so the first press does not wait for one.
    for (int k = 0; k < 2; ++k)
    {
        auto& im = padBoxImage[k];
        if (!im.isNull())
            continue;
        const auto& lk = k == 1 && look["padRec"].isObject() ? look["padRec"] : look["padOff"];
        im = juce::Image (juce::Image::ARGB, (int) std::ceil (area.getWidth() * scale), (int) std::ceil (area.getHeight() * scale), true);
        juce::Graphics ig (im);
        ig.addTransform (juce::AffineTransform::translation (-area.getX(), -area.getY()).scaled (scale));
        std::set<int> without;
        if (const auto* svgNode = findNode (lk, [] (const juce::var& x) { return x["id"].toString() == "hsSvg"; }))
            without.insert ((int) (*svgNode)["i"]);
        (k == 1 && litC != nullptr ? *litC : *frame).drawPart (ig, lk, {}, 1.0f, &without);
    }
    g.drawImage (padBoxImage[rec ? 1 : 0], area);
}

void PrismFace::drawPad (juce::Graphics& g)
{
    const auto mode = pad["mode"].toString();
    const bool rec = mode == "rec";
    const auto& padLook = rec && look["padRec"].isObject() ? look["padRec"] : look["padOff"];
    if (!padLook.isObject())
        return;
    const auto* svgNode = findNode (padLook, [] (const juce::var& x) { return x["id"].toString() == "hsSvg"; });
    // The pad's box, then its drawing (hsPaint) in its own SVG.
    if (svgNode == nullptr)
        return;
    const auto box = rectOf ((*svgNode)["rect"]);
    const double W = box.getWidth(), H = box.getHeight();
    auto svg = (*svgNode)["svg"].toString();
    auto q = [] (double n, int k) { return fixed (n * k / 4, 2); };
    juce::String grid;
    for (int k = 1; k <= 3; ++k)
        grid << "M" << q (W, k) << " 0V" << r2 (H) << "M0 " << q (H, k) << "H" << r2 (W);
    svg = setAttr (svg, "hsGrid", "d", grid);
    juce::String pts;
    if (auto* p = pad["path"].getArray())
        for (int i = 0; i + 1 < p->size(); i += 2)
            pts << (i ? " " : "") << fixed (dnum ((*p)[i]) * W, 1) << "," << fixed (dnum ((*p)[i + 1]) * H, 1);
    svg = setAttr (svg, "hsPath", "points", pts);
    const double hx = dnum (pad["hand"][0], 0.5) * W, hy = dnum (pad["hand"][1], 0.5) * H;
    const double gx = dnum (pad["ghost"][0], 0.5) * W, gy = dnum (pad["ghost"][1], 0.5) * H;
    for (const char* el : { "hsBall", "hsHalo" })
    {
        svg = setAttr (svg, el, "cx", fixed (hx, 1));
        svg = setAttr (svg, el, "cy", fixed (hy, 1));
    }
    svg = setAttr (svg, "hsGhost", "cx", fixed (gx, 1));
    svg = setAttr (svg, "hsGhost", "cy", fixed (gy, 1));
    svg = setAttr (svg, "hsCross", "d", "M" + fixed (hx - 7, 1) + " " + fixed (hy, 1) + "H" + fixed (hx + 7, 1) + "M" + fixed (hx, 1) + " " + fixed (hy - 7, 1) + "V" + fixed (hy + 7, 1));
    {
        juce::Graphics::ScopedSaveState s (g);
        g.reduceClipRegion (box.toNearestInt());
        drawSvg (g, svg, box);
    }
    // The readout: under the hand while it moves or a take plays, under the
    // pointer while it hovers.
    const auto* cx = control (setup["x"].toString());
    const auto* cy = control (setup["y"].toString());
    juce::var shown;
    if ((bool) pad["down"] || mode == "play")
        shown = pad["hand"];
    else if (pad["hover"].isArray())
        shown = pad["hover"];
    if (shown.isArray())
    {
        const double px = dnum (shown[0]) * W, py = dnum (shown[1]) * H;
        const auto t = padFormat (cx, padValue (setup, cx, true, dnum (shown[0]))) + ",  " + padFormat (cy, padValue (setup, cy, false, dnum (shown[1])));
        const auto f = face::mono (11);
        const float tw = widthOf (f, t);
        const float x = box.getX() + (float) std::min (W - 120, std::max (2.0, px + 10));
        const float y = box.getY() + (float) (py - 22 < 6 ? py + 12 : py - 22);
        const auto r = juce::Rectangle<float> (x, y, tw + 10, 17);
        g.setColour (juce::Colours::black.withAlpha (0.55f));
        g.fillRoundedRectangle (r, 4);
        g.setColour (cl ("--look-text", "#e8eaee"));
        g.setFont (f);
        g.drawText (t, r.reduced (5, 0), juce::Justification::centredLeft, false);
    }
    // The four limits in the corners, with their units.
    const auto* in = findNode (captured["page"]["tree"], [] (const juce::var& x) { return x["id"].toString() == "prismYHi"; });
    const auto* unitN = findNode (captured["page"]["tree"], [] (const juce::var& x) { return x["data"]["unit"].toString() == "y"; });
    for (const char* f : { "yHi", "yLo", "xLo", "xHi" })
    {
        if (limitEdit != nullptr && limitField == f)
            continue;
        juce::Rectangle<float> ur;
        const auto r = limitBox (f, &ur);
        if (in != nullptr)
        {
            face::paintBox (g, *in, r);
            g.setColour (in != nullptr ? face::colour ((*in)["font"]["colour"]) : cl ("--look-text"));
            g.setFont (face::font ((*in)["font"]));
            g.drawText (limitText (f), r.reduced (3, 0), juce::Justification::centredLeft, false);
        }
        if (unitN != nullptr)
        {
            const auto* c = control (juce::String (f).startsWith ("x") ? setup["x"].toString() : setup["y"].toString());
            const auto u = c == nullptr ? juce::String() : (*c)["key"].toString() == "ratio" ? uni ("\xc3\x97") : (*c)["key"].toString() == "semitones" ? juce::String ("st") : (*c)["unit"].toString();
            face::paintText (g, *unitN, ur.withHeight (20), u);
        }
    }
    // The axes' names: X along the bottom, Y up the left.
    if (pageIds.count ("hsXName"))
    {
        const auto& n = pageIds["hsXName"];
        const auto t = cx != nullptr ? (*cx)["label"].toString() : juce::String();
        const float w = widthOf (fontOf (n.n), t);
        face::paintText (g, n.n, n.r.withX (box.getCentreX() - w / 2).withWidth (w + 1), t);
    }
    if (pageIds.count ("hsYName"))
    {
        const auto& n = pageIds["hsYName"];
        const auto t = cy != nullptr ? (*cy)["label"].toString() : juce::String();
        const auto f = fontOf (n.n);
        const float w = widthOf (f, t);
        juce::Graphics::ScopedSaveState s (g);
        const auto c = juce::Point<float> (n.r.getCentreX(), box.getCentreY());
        g.addTransform (juce::AffineTransform::rotation (-juce::MathConstants<float>::halfPi, c.x, c.y));
        face::paintText (g, n.n, juce::Rectangle<float> (c.x - w / 2, c.y - n.r.getWidth() / 2, w + 1, n.r.getWidth()), t);
    }
}

// ───────────────────────────────────────────────────── a knob, as uiKnobPaint

void PrismFace::drawKnob (juce::Graphics& g, const Cell& c, double v, const juce::var* mark, juce::Colour col)
{
    const auto& row = look["knobRowPlain"];
    const auto* ring = kid (row, "ui-ring");
    const auto* cap = kid (row, "ui-cap");
    const auto* kname = kid (row, "ui-kname");
    const auto* kval = kid (row, "ui-kval");
    if (ring == nullptr)
        return;
    // The cap, then the ring: the track, the value's arc, an LFO's reach and
    // its live dot, the pointer.
    if (cap != nullptr)
        face::paintBox (g, *cap, juce::Rectangle<float> (16, 16).withCentre (c.knob.getCentre()));
    const double u = toU (c.s, v);
    auto svg = (*ring)["svg"].toString();
    svg = setAttr (svg, "ui-ar", "d", uiArc (13, 9, 0, u));
    if (mark != nullptr && mark->isObject())
    {
        const double rng = juce::jlimit (0.01, 0.5, dnum ((*mark)["rng"]));
        const auto lc = rgba (cl ("--plfo" + juce::String ((int) dnum ((*mark)["lfo"], 1)), "#7cf0d0"));
        const double base = toU (c.s, valueOf (c.s.key));
        svg = setAttr (svg, "ui-md", "d", uiArc (13, 12.5, juce::jlimit (0.0, 1.0, base - rng), juce::jlimit (0.0, 1.0, base + rng)));
        svg = setAttr (svg, "ui-md", "stroke", lc);
        const double a = A0 + SWEEP * toU (c.s, dnum ((*mark)["v"]));
        svg = setAttr (svg, "ui-live", "cx", r2 (13 + std::cos (a) * 12.5));
        svg = setAttr (svg, "ui-live", "cy", r2 (13 + std::sin (a) * 12.5));
        svg = setAttr (svg, "ui-live", "fill", lc);
        svg = setAttr (svg, "ui-live", "display", "inline");
        svg = setAttr (svg, "ui-live", "style", "");
        // With an LFO on it the knob shows the base; the swing is the dot.
        const double ub = base;
        svg = setAttr (svg, "ui-ar", "d", uiArc (13, 9, 0, ub));
    }
    const double pu = mark != nullptr && mark->isObject() ? toU (c.s, valueOf (c.s.key)) : u;
    const double a = A0 + SWEEP * pu;
    svg = setAttr (svg, "ui-ptr", "x1", r2 (13 + std::cos (a) * 9 * 0.2));
    svg = setAttr (svg, "ui-ptr", "y1", r2 (13 + std::sin (a) * 9 * 0.2));
    svg = setAttr (svg, "ui-ptr", "x2", r2 (13 + std::cos (a) * 9 * 0.62));
    svg = setAttr (svg, "ui-ptr", "y2", r2 (13 + std::sin (a) * 9 * 0.62));
    drawSvg (g, svg, c.knob);
    // The picture beside it, in the control's colour.
    if (ppic::hasDraw (c.s.key))
    {
        juce::String kind;
        if (auto* ch = view["chain"].getArray())
            for (const auto& x : *ch)
                if (x["id"].toString() == c.src)
                    kind = x["kind"].toString();
        const double n = juce::jlimit (0.0, 1.0, c.s.max > c.s.min ? (v - c.s.min) / (c.s.max - c.s.min) : 0.0);
        ppic::draw (g, ppic::hpDraw (c.s.key, v, n, kind), c.pic, sideStyle.tinted (col));
    }
    // Its name (marked X or Y when it is on the pad) and its reading.
    float y = c.labelY;
    if (kname != nullptr)
    {
        const auto f = fontOf (*kname);
        for (int i = 0; i < c.name.size(); ++i)
        {
            const bool last = i == c.name.size() - 1;
            const float w = widthOf (f, c.name[i]);
            const float axW = last && c.ax.isNotEmpty() ? 3 + widthOf (face::mono (9, 700), c.ax) : 0;
            const float x = c.r.getCentreX() - (w + axW) / 2;
            face::paintText (g, *kname, { x, y, w + 1, 11 }, c.name[i]);
            if (axW > 0)
            {
                g.setColour (cl ("--look-accent", "#5fd4ff"));
                g.setFont (face::mono (9, 700));
                g.drawText (c.ax, juce::Rectangle<float> (x + w + 3, y, axW, 11), juce::Justification::centredLeft, false);
            }
            y += 11;
        }
    }
    if (kval != nullptr)
        for (const auto& line : c.value)
        {
            const float w = widthOf (fontOf (*kval), line);
            face::paintText (g, *kval, { c.r.getCentreX() - w / 2, y, w + 1, 11 }, line);
            y += 11;
        }
}

// ─────────────────────────────────────────────────────── Controls and LFOs

void PrismFace::drawControls (juce::Graphics& g)
{
    if (look["ctlPanel"].isObject() && g.getClipBounds().toFloat().intersects (ctlPanel))
        cachedBox (g, "ctl", look["ctlPanel"], ctlPanel);
    if (look["ctlHead"].isObject())
        frame->drawPart (g, look["ctlHead"]);
    const auto* src = currentSource();
    const auto sid = src != nullptr ? (*src)["id"].toString() : juce::String ("stretch");
    if (look["meta"].isObject())
    {
        const auto t = sid == "stretch" ? juce::String ("glide, window and cloud") : sid == "ptc" ? juce::String ("the process's whole window") : juce::String ("every control of the slot");
        write (g, look["meta"], rectOf (look["meta"]["rect"]).withWidth (240), t);
    }
    // The Pitch Time Changer's own switch.
    if (sid == "ptc" && look["ptcOn"].isObject())
    {
        const juce::Point<float> at ((float) dnum (captured["ptc"]["at"][0]), (float) dnum (captured["ptc"]["at"][1]));
        const auto& b = look["ptcOn"];
        const auto r = rectOf (b["rect"]) + at;
        if ((bool) view["ptc"]["on"])
            frame->drawPart (g, b, at);
        else if (pageIds.count ("hsStop"))
        {
            face::paintBox (g, pageIds["hsStop"].n, r);
            face::paintText (g, b, r, "PTC", juce::Justification::centred);
        }
    }
    for (const auto& [text, r] : groupLabels)
        if (look["groupLabel"].isObject())
            face::paintText (g, look["groupLabel"], r, text);
    const auto marks = view["lfoMarks"];
    const auto clip = g.getClipBounds().toFloat();
    for (const auto& c : cells)
    {
        if (!clip.intersects (c.r.expanded (4)))
            continue;
        const juce::var* mark = nullptr;
        double v = valueOf (c.s.key);
        if (auto* ms = marks.getArray())
            for (const auto& m : *ms)
                if (m["key"].toString() == c.s.key)
                {
                    mark = &m;
                    v = dnum (m["v"]);
                }
        drawKnob (g, c, v, mark, cl ("--f-" + ppic::facetOf (c.s.key), "#cfa66c"));
    }
}

void PrismFace::drawLfos (juce::Graphics& g)
{
    const juce::Point<float> dy (0, lfoDy);
    if (look["lfoPanel"].isObject())
        cachedBox (g, "lfo", look["lfoPanel"], lfoPanel);
    const int sel = juce::jlimit (0, 3, (int) dnum (lfos["sel"]));
    const auto& L = lfos["lfos"][sel];
    const bool mapping = (bool) lfos["mapping"];
    const auto lc = cl ("--plfo" + juce::String (sel + 1), "#7cf0d0");
    if (look["lfoHead"].isObject())
        frame->drawPart (g, look["lfoHead"], dy);
    if (mapping && look["lfoMeta"].isObject())
        face::paintText (g, look["lfoMeta"], rectOf (look["lfoMeta"]["rect"]) + dy, "click a control " + uni ("\xc2\xb7") + " Esc stops");
    if (pageIds.count ("prismLfoMap"))
    {
        const auto& m = mapping && look["mapOn"].isObject() ? look["mapOn"] : look["mapOff"];
        if (m.isObject())
            (mapping && litC != nullptr ? *litC : *frame).drawPart (g, m, pageIds["prismLfoMap"].r.getPosition() + dy - rectOf (m["rect"]).getPosition());
    }
    // The tabs, each with its dot.
    for (int t = 0; t < 4; ++t)
    {
        const auto k = "tab:" + juce::String (t);
        if (pageIds.count (k) == 0)
            continue;
        const auto r = pageIds[k].r + dy;
        const auto& tl = t == sel ? look["tabOn"] : look["tabOff"];
        if (tl.isObject())
        {
            face::paintBox (g, tl, r);
            face::paintText (g, tl, r.withTrimmedLeft (8), juce::String (t + 1), juce::Justification::centred);
        }
        const double now = dnum (lfos["lfos"][t]["now"]);
        g.setColour (cl ("--plfo" + juce::String (t + 1), "#7cf0d0").withMultipliedAlpha ((float) (0.25 + 0.75 * (now + 1) / 2)));
        g.fillEllipse (r.getX() + 9, r.getY() + 9, 6, 6);
    }
    // The shapes.
    for (const char* s : { "sine", "triangle", "square", "saw", "random", "pulse" })
    {
        const auto k = "lshape:" + juce::String (s);
        if (pageIds.count (k) == 0)
            continue;
        const auto r = pageIds[k].r + dy;
        const bool on = L["shape"].toString() == s;
        const auto& sl = on ? look["lshapeOn"] : look["lshapeOff"];
        if (sl.isObject())
            face::paintBox (g, sl, r);
        juce::Path p = juce::Drawable::parseSVGPath (ppic::lfoWaveIcon (s));
        const auto icon = juce::Rectangle<float> (24, 12).withCentre (r.getCentre());
        p.applyTransform (juce::AffineTransform::scale (24.0f / 40.0f, 12.0f / 20.0f).translated (icon.getX(), icon.getY()));
        g.setColour (on ? lc : cl ("--look-text-3", "#858b94"));
        g.strokePath (p, juce::PathStrokeType (1.3f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
    }
    // The scope.
    if (look["well"].isObject())
    {
        const auto wr = rectOf (look["well"]["rect"]) + dy;
        face::paintBox (g, look["well"], wr);
        if (const auto* sc = findNode (captured["page"]["tree"], [] (const juce::var& x) { return x["id"].toString() == "prismLfoScope"; }))
        {
            const double depth = dnum (L["depth"], 25), A = 16 * depth / 100;
            const auto shape = L["shape"].toString();
            const double pw = dnum (L["pw"], 25), held = dnum (L["held"], 0.5), ph = dnum (L["phase"]);
            auto at = [&] (double p) {
                const double u = std::fmod (std::fmod (p, 1.0) + 1, 1.0);
                if (shape == "sine") return std::sin (u * 2 * juce::MathConstants<double>::pi);
                if (shape == "triangle") return 1 - 4 * std::abs (u - 0.5);
                if (shape == "square") return u < 0.5 ? 1.0 : -1.0;
                if (shape == "saw") return 2 * u - 1;
                if (shape == "pulse") return u < pw / 100 ? 1.0 : -1.0;
                return held * 2 - 1;
            };
            juce::String d;
            if (shape == "random")
            {
                const double ys[] = { 0.6, -0.4, 0.9, -0.8, 0.2, -0.1 };
                for (int k = 0; k < 6; ++k)
                    d << (k ? "L" : "M") << fixed (k * 188.0 / 6, 1) << " " << fixed (20 - ys[k] * A, 1) << "L" << fixed ((k + 1) * 188.0 / 6, 1) << " " << fixed (20 - ys[k] * A, 1);
            }
            else
                for (int i = 0; i <= 94; ++i)
                {
                    const double u = i / 94.0;
                    d << (i ? "L" : "M") << fixed (u * 188, 1) << " " << fixed (20 - at (u) * A, 1);
                }
            const double hp = std::fmod (std::fmod (ph, 1.0) + 1, 1.0), y = 20 - at (ph) * A;
            auto svg = (*sc)["svg"].toString();
            svg = setAttr (svg, "plfo-trace", "d", d);
            svg = setAttr (svg, "plfo-trace", "stroke", rgba (lc));
            svg = setAttr (svg, "plfo-head-line", "x1", fixed (hp * 188, 1));
            svg = setAttr (svg, "plfo-head-line", "x2", fixed (hp * 188, 1));
            svg = setAttr (svg, "plfo-dot", "cx", fixed (hp * 188, 1));
            svg = setAttr (svg, "plfo-dot", "cy", fixed (y, 1));
            svg = setAttr (svg, "plfo-dot", "fill", rgba (lc));
            drawSvg (g, svg, rectOf ((*sc)["rect"]) + dy);
        }
    }
    for (const auto& c : lfoCells)
        drawKnob (g, c, dnum (L[juce::Identifier (c.field)]), nullptr, lc);
    // What this LFO drives, or that nothing is mapped yet.
    const auto& chip = look["chip"];
    const float chipY = 548 + lfoDy;
    if (L["targets"].size() == 0 || !chip.isObject())
    {
        if (look["emptyChips"].isObject())
            face::paintText (g, look["emptyChips"], rectOf (look["emptyChips"]["rect"]) + dy, uni ("nothing mapped yet \xc2\xb7 Map, then click a control"));
        return;
    }
    const auto cr = rectOf (chip["rect"]);
    const auto font = fontOf (chip);
    const float pad0 = cr.getWidth() - widthOf (font, textOf (chip));
    float x = cr.getX();
    for (int t = 0; t < L["targets"].size(); ++t)
    {
        juce::String label = L["targets"][t]["key"].toString();
        for (const auto& s : sources)
            if (s["id"].toString() == L["targets"][t]["src"].toString())
                if (auto* cs = s["controls"].getArray())
                    for (const auto& c : *cs)
                        if (c["key"].toString() == label)
                            label = c["label"].toString() + (s["id"].toString() == source ? juce::String() : uni (" \xc2\xb7 ") + s["label"].toString());
        const float w = widthOf (font, label) + pad0;
        const auto r = juce::Rectangle<float> (x, chipY, w, cr.getHeight());
        face::paintBox (g, chip, r);
        face::paintText (g, chip, r.reduced (pad0 / 2 - 6, 0).withTrimmedRight (6), label);
        g.setColour (cl ("--look-text-3", "#858b94"));
        g.setFont (face::sans (11));
        g.drawText (uni ("\xc3\x97"), r.withLeft (r.getRight() - 14), juce::Justification::centred, false);
        x += w + 4;
    }
}

// ─────────────────────────────────────────────────────────────── Takes

void PrismFace::drawTakes (juce::Graphics& g)
{
    const bool tp = source == "stretch" || source.isEmpty();
    const auto& tk = tp ? pageIds : echoIds;
    auto* C = tp ? frame.get() : (echoC != nullptr ? echoC.get() : frame.get());
    auto node = [&] (const juce::String& k) -> const N* {
        auto it = tk.find (k);
        return it != tk.end() ? &it->second : nullptr;
    };
    // The slots, A to D: each one's length and its take's shape.
    const int slot = (int) dnum (pad["slot"]);
    const auto& on = look["slotOn"];
    const auto& off = look["slotOff"];
    const auto clip = g.getClipBounds().toFloat();
    for (int s = 0; s < 4; ++s)
    {
        const auto* n = node ("slot:" + juce::String (s));
        if (n == nullptr || !clip.intersects (n->r.expanded (8)))
            continue;
        const auto& lk = s == slot ? on : off;
        if (!lk.isObject())
            continue;
        cachedBox (g, juce::String ("slot") + (s == slot ? "on" : "off") + juce::String (s), lk, n->r);
        const auto* b = findNode (lk, [] (const juce::var& x) { return x["tag"].toString() == "b"; });
        const auto* len = findNode (lk, [] (const juce::var& x) { return x["data"].hasProperty ("len"); });
        const auto* thumb = findNode (lk, [] (const juce::var& x) { return x["tag"].toString() == "svg"; });
        const auto o = n->r.getPosition() - rectOf (lk["rect"]).getPosition();
        if (b != nullptr)
            face::paintText (g, *b, rectOf ((*b)["rect"]) + o, juce::String::charToString ((juce::juce_wchar) ('A' + s)));
        const auto& take = pad["slots"][s];
        if (len != nullptr)
        {
            const auto t = take.isObject() ? fixed (dnum (take["dur"]) / 1000, 1) + " s" : uni ("\xe2\x80\x94");
            const auto lr = rectOf ((*len)["rect"]) + o;
            const float w = widthOf (fontOf (*len), t);
            face::paintText (g, *len, lr.withX (lr.getRight() - w).withWidth (w + 1), t);
        }
        if (thumb != nullptr && take.isObject())
        {
            juce::String pts;
            if (auto* p = take["thumb"].getArray())
                for (int i = 0; i + 1 < p->size(); i += 2)
                    pts << (i ? " " : "") << juce::String ((int64_t) jsRound (dnum ((*p)[i]) * 100)) << "," << juce::String ((int64_t) jsRound (dnum ((*p)[i + 1]) * 100));
            auto svg = setAttr ((*thumb)["svg"].toString(), "data-thumb=\"\"", "points", pts);
            // The polyline has no id or class: its points set by position.
            const int at = svg.indexOf ("points=\"");
            if (at >= 0)
                svg = svg.substring (0, at + 8) + pts + svg.substring (svg.indexOfChar (at + 8, '"'));
            auto tr = rectOf ((*thumb)["rect"]) + o;
            tr.setHeight (n->r.getBottom() - 8 - tr.getY());
            drawSvg (g, svg, tr);
        }
    }
    // Rate and direction, the shapes: the page's switch, lit where chosen.
    auto segs = [&] (const char* prefix, const std::vector<juce::String>& vals, const juce::String& cur) {
        for (const auto& v : vals)
            if (const auto* n = node (juce::String (prefix) + v))
                drawSeg (g, *n, v == cur);
    };
    // Their two wells.
    for (const auto& k : { juce::String ("rate:0.5"), juce::String ("dir:fwd") })
        if (const auto* first = node (k))
        {
            const auto* wellN = findNode (tp ? captured["page"]["tree"] : captured["echo"]["tree"], [first] (const juce::var& x) {
                auto* kids = x["kids"].getArray();
                return hasClass (x, "ui-seg") && kids != nullptr && !kids->isEmpty() && (int) (*kids)[0]["i"] == first->i;
            });
            if (wellN != nullptr)
                face::paintBox (g, *wellN, rectOf ((*wellN)["rect"]));
        }
    const double speed = dnum (pad["rate"], 1);
    segs ("rate:", { "0.5", "1", "2" }, juce::exactlyEqual (speed, 0.5) ? "0.5" : juce::exactlyEqual (speed, 2.0) ? "2" : "1");
    segs ("dir:", { "fwd", "rev", "pp" }, pad["dir"].toString());
    if (const auto* first = node ("shape:circle"))
    {
        const auto* wellN = findNode (tp ? captured["page"]["tree"] : captured["echo"]["tree"], [first] (const juce::var& x) {
            auto* kids = x["kids"].getArray();
            return hasClass (x, "ui-seg") && kids != nullptr && !kids->isEmpty() && (int) (*kids)[0]["i"] == first->i;
        });
        if (wellN != nullptr)
            face::paintBox (g, *wellN, rectOf ((*wellN)["rect"]));
    }
    const auto& take = pad["slots"][slot];
    segs ("shape:", { "circle", "eight", "liss", "drift" }, take.isObject() ? take["shape"].toString() : juce::String());
    // Glide (Time & Pitch's only), Playback speed, Post-roll.
    for (const char* k : { "smoothing", "pbSpeed", "postRoll" })
        if (tp || juce::String (k) != "smoothing")
            drawBar (g, k);
    // coef and the time to 63 %.
    if (tp)
        if (const auto* n = node ("glideBox"))
        {
            std::set<int> without;
            const auto* cf = findNode (n->n, [] (const juce::var& x) { return x["id"].toString() == "hsCoef"; });
            const auto* ta = findNode (n->n, [] (const juce::var& x) { return x["id"].toString() == "hsTau"; });
            if (cf != nullptr) without.insert ((int) (*cf)["i"]);
            if (ta != nullptr) without.insert ((int) (*ta)["i"]);
            C->drawPart (g, n->n, {}, 1.0f, &without);
            if (cf != nullptr)
                face::paintText (g, *cf, rectOf ((*cf)["rect"]).withWidth (60), view["coef"].toString());
            if (ta != nullptr)
                face::paintText (g, *ta, rectOf ((*ta)["rect"]).withWidth (120), view["tau"].toString());
        }
    // Throw and Loop on release.
    for (int t = 0; t < 2; ++t)
    {
        const auto k = "tog:" + juce::String (t);
        const auto* n = node (k);
        if (n == nullptr)
            continue;
        const bool lit = (bool) pad[t == 0 ? "throwOn" : "loopOnRelease"];
        if (lit && litC != nullptr && litIds.count (k))
            litC->drawPart (g, litIds[k].n, n->r.getPosition() - litIds[k].r.getPosition());
        else
            C->drawPart (g, n->n);
    }
}

void PrismFace::drawBar (juce::Graphics& g, const juce::String& key)
{
    // The shared bar (uiBarOver): its picture, its well, the fill to the
    // value with its line, its name and reading.
    const bool tp = source == "stretch" || source.isEmpty();
    const auto& tk = tp ? pageIds : echoIds;
    auto it = tk.find ("bar:" + key);
    if (it == tk.end())
        return;
    const auto& n = it->second;
    const auto o = n.r.getPosition() - rectOf (n.n["rect"]).getPosition();
    double v = 0, mx = 1;
    juce::String reading;
    if (key == "smoothing")
    {
        v = grab == Grab::bar && grabKey == key ? grabV : dnum (pad["glide"], 50);
        mx = 100;
        reading = juce::String ((int64_t) jsRound (v)) + " %";
    }
    else if (key == "pbSpeed")
    {
        v = dnum (view["hp"]["speed"], 128);
        mx = 255;
        reading = juce::String ((int64_t) jsRound (v / 128 * 100)) + " %";
    }
    else
    {
        v = grab == Grab::bar && grabKey == key ? grabV : dnum (view["postRoll"]);
        mx = 10000;
        reading = juce::String ((int64_t) jsRound (v)) + " ms";
    }
    const double f = juce::jlimit (0.0, 1.0, v / mx);
    const auto* bw = kid (n.n, "ui-bw");
    const auto* bf = kid (n.n, "ui-bf");
    const auto* bn = kid (n.n, "ui-bn");
    const auto* bv = kid (n.n, "ui-bv");
    const auto* line = bf != nullptr ? findNode (*bf, [] (const juce::var& x) { return x["data"]["pseudo"].toString() == "::after"; }) : nullptr;
    const auto* pic = kid (n.n, "ui-bpic");
    if (bw != nullptr)
    {
        const auto wr = rectOf ((*bw)["rect"]) + o;
        face::paintBox (g, *bw, wr);
        if (bf != nullptr)
        {
            const auto fr = rectOf ((*bf)["rect"]) + o;
            const float full = wr.getWidth() - 8;
            face::paintBox (g, *bf, fr.withWidth ((float) (full * f)));
            if (line != nullptr)
                face::paintBox (g, *line, rectOf ((*line)["rect"]).withPosition (fr.getX() + (float) (full * f) - 1, fr.getY()) + juce::Point<float> (0, 0));
        }
        if (bn != nullptr)
            frame->drawPart (g, *bn, o);
        if (bv != nullptr)
        {
            const auto r = rectOf ((*bv)["rect"]) + o;
            const float w = widthOf (fontOf (*bv), reading);
            face::paintText (g, *bv, r.withX (r.getRight() - w).withWidth (w + 1), reading);
        }
    }
    if (pic != nullptr)
    {
        const auto col = c2d::css (n.n["data"]["fc"].toString());
        ppic::draw (g, ppic::hpDraw (key, v, f, {}), rectOf ((*pic)["rect"]) + o, barStyle.tinted (col));
    }
}

// ─────────────────────────────────────────────────────────────── Output

void PrismFace::drawOutput (juce::Graphics& g)
{
    // prismShowHp: each fader fills from its middle to its value, with its
    // line; the reading in dB, Hyperprism's ±18 across 0–255.
    const char* keys[] = { "l", "lr", "r" };
    const char* reads[] = { "prismFaderLRead", "prismFaderLRRead", "prismFaderRRead" };
    for (int k = 0; k < 3; ++k)
    {
        const auto wk = "fwell:" + juce::String (keys[k]);
        if (pageIds.count (wk) == 0)
            continue;
        const auto wr = pageIds[wk].r;
        const double v = dnum (view["hp"][keys[k]], 128);
        const double f = v / 255;
        const float yv = wr.getBottom() - (float) f * wr.getHeight();
        const float mid = wr.getY() + wr.getHeight() / 2;
        if (look["ffill"].isObject())
            face::paintBox (g, look["ffill"], juce::Rectangle<float> (wr.getX() + 2, juce::jmin (yv, mid), wr.getWidth() - 4, std::abs (yv - mid)));
        if (look["fline"].isObject())
            face::paintBox (g, look["fline"], juce::Rectangle<float> (wr.getX() + 2, yv - 1, wr.getWidth() - 4, 2));
        if (pageIds.count (reads[k]))
        {
            const auto& rn = pageIds[reads[k]];
            const double db = (36 * v) / 255 - 18;
            face::paintText (g, rn.n, rn.r, (db < 0 ? uni ("\xe2\x88\x92") : juce::String ("+")) + f1 (std::abs (db)), juce::Justification::centred);
        }
    }
}

// ───────────────────────────────────────────────────── the Now Playing bar

void PrismFace::drawNow (juce::Graphics& g)
{
    auto btn = [&] (const char* k, bool lit) {
        if (lit && nowLitC != nullptr && nowLitIds.count (k))
            nowLitC->drawPart (g, nowLitIds[k].n, { 0, 1052 });
        else if (nowIds.count (k))
            nowFrame->drawPart (g, nowIds[k].n, { 0, 1052 });
    };
    btn ("playBtn", playing);
    btn ("loopBtn", looping);
    auto text = [&] (const char* k, const juce::String& t, juce::Justification j = juce::Justification::centredLeft) {
        if (nowIds.count (k))
        {
            const auto& n = nowIds[k];
            face::paintText (g, n.n, n.r.withWidth (juce::jmax (n.r.getWidth(), widthOf (fontOf (n.n), t) + 1)), t, j);
        }
    };
    text ("timeNow", fmtTime (position / juce::jmax (1.0, rate)));
    const auto name = soundName.isNotEmpty() ? soundName : juce::String ("no sound");
    text ("nbName", name);
    if (nowIds.count ("nbMeta") && nowIds.count ("nbName"))
    {
        const auto& nm = nowIds["nbName"];
        const auto& mt = nowIds["nbMeta"];
        const auto t = frames > 0 ? fixed (frames / juce::jmax (1.0, rate), 2) + "s" : juce::String();
        const float x = nm.r.getX() + widthOf (fontOf (nm.n), name) + (mt.r.getX() - nm.r.getRight());
        face::paintText (g, mt.n, mt.r.withX (x).withWidth (widthOf (fontOf (mt.n), t) + 1), t);
    }
    text ("loopLabel", looping ? juce::String ("whole file") : juce::String());
    text ("nbDb", uni ("\xe2\x88\x92\xe2\x88\x9e"));
}

// ─────────────────────────────────────────────────────── the Process menu

void PrismFace::Pick::paint (juce::Graphics& g)
{
    const auto& menu = f.look["menu"];
    if (menu.isObject())
        face::paintBox (g, menu, getLocalBounds().toFloat());
    const auto& head = f.look["menuHead"];
    for (const auto& [text, r] : heads)
        if (head.isObject())
            face::paintText (g, head, r, text.toUpperCase());
    const auto& itemOn = f.look["menuItemOn"];
    const auto& item = f.look["menuItem"];
    for (int k = 0; k < (int) items.size(); ++k)
    {
        const auto& it = items[(size_t) k];
        const auto& lk = it.on || k == hover ? (itemOn.isObject() ? itemOn : item) : item;
        if (!lk.isObject())
            continue;
        if (it.on || k == hover)
            face::paintBox (g, lk, it.r);
        const auto lr = rectOf (lk["rect"]);
        const auto o = it.r.getPosition() - lr.getPosition();
        if (const auto* pic = kid (lk, "pic"))
            ppic::draw (g, ppic::procIcon (it.kind), rectOf ((*pic)["rect"]) + o, f.menuItemStyle);
        if (const auto* sp = findNode (lk, [] (const juce::var& x) { return x["tag"].toString() == "span"; }))
            face::paintText (g, *sp, (rectOf ((*sp)["rect"]) + o).withRight (it.r.getRight() - 4), it.label);
    }
}

void PrismFace::cachedBox (juce::Graphics& g, const juce::String& key, const juce::var& lk, juce::Rectangle<float> r)
{
    const float scale = juce::jmax (1.0f, g.getInternalContext().getPhysicalPixelScaleFactor());
    // Room for the shadows round it.
    const auto area = r.expanded (24).getSmallestIntegerContainer().toFloat();
    const auto sig = r.toString() + "|" + juce::String (scale);
    auto& [have, im] = boxCache[key];
    if (have != sig || im.isNull())
    {
        have = sig;
        im = juce::Image (juce::Image::ARGB, (int) std::ceil (area.getWidth() * scale), (int) std::ceil (area.getHeight() * scale), true);
        juce::Graphics ig (im);
        ig.addTransform (juce::AffineTransform::translation (-area.getX(), -area.getY()).scaled (scale));
        face::paintBox (ig, lk, r);
    }
    g.drawImage (im, area);
}
