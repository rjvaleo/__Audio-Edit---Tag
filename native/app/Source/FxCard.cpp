#include "FxCard.h"

#include "Canvas2D.h"
#include "FxReverbDraw.h"

#include <cmath>
#include <regex>

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
// The first node under `n` (itself included) that `want` picks.
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
juce::var child (const juce::var& n, const std::function<bool (const juce::var&)>& want)
{
    if (auto* kids = n["kids"].getArray())
        for (const auto& k : *kids)
            if (auto* f = findIn (k, want))
                return *f;
    return {};
}
juce::String S (const std::string& s) { return juce::String::fromUTF8 (s.c_str()); }
std::string str (const juce::String& s) { return s.toStdString(); }

// The page's `level` footer and `wet` (GS_FXFOOT).
struct Foot
{
    const char* key;
    double min, max, d;
};
const Foot FOOT[2] = { { "wet", 0, 1, 1 }, { "level", -24, 12, 0 } };
juce::String footText (const juce::String& key, double v)
{
    if (key == "wet")
        return juce::String ((int64_t) std::floor (v * 100 + 0.5)) + "%";
    return juce::String (v >= 0 ? "+" : juce::String::fromUTF8 ("\xe2\x88\x92")) + juce::String (std::abs (v), 1) + " dB";
}

// Each class of a picture written out as the page's CSS styles it where the
// picture sits (read from its captured <svg>), for JUCE's SVG reader; an
// element with several classes takes the last one the style knows.
juce::String resolve (const juce::String& body, const ppic::Style& st, float scale, bool nonScaling)
{
    static const std::regex cls ("class=\"([^\"]*)\"");
    const auto in = body.toStdString();
    std::string out;
    out.reserve (in.size() * 2);
    auto it = std::sregex_iterator (in.begin(), in.end(), cls);
    size_t last = 0;
    for (; it != std::sregex_iterator(); ++it)
    {
        const auto& m = *it;
        out.append (in, last, (size_t) m.position() - last);
        last = (size_t) (m.position() + m.length());
        const auto names = juce::StringArray::fromTokens (S (m[1].str()), " ", "");
        const ppic::Style::Cls* k = nullptr;
        for (const auto& nm : names)
            if (auto f = st.cls.find (nm); f != st.cls.end() && f->second.found)
                k = &f->second;
        if (k == nullptr)
            continue;
        if (k->hidden)
        {
            out += "display=\"none\"";
            continue;
        }
        const float w = nonScaling ? k->width / juce::jmax (0.01f, scale) : k->width;
        juce::String a;
        a << "fill=\"" << (k->fill.isEmpty() ? juce::String ("none") : k->fill) << "\" stroke=\"" << (k->stroke.isEmpty() ? juce::String ("none") : k->stroke)
          << "\" stroke-width=\"" << juce::String (w, 3) << "\" stroke-linecap=\"" << (k->cap.isEmpty() ? juce::String ("butt") : k->cap)
          << "\" stroke-linejoin=\"" << (k->join.isEmpty() ? juce::String ("miter") : k->join) << "\" opacity=\"" << juce::String (k->opacity, 3) << "\"";
        if (names.contains ("t") || names.contains ("ta") || names.contains ("ht"))
            a << " font-family=\"Menlo\" font-size=\"" << juce::String (st.fontSize) << "\"";
        out += a.toStdString();
    }
    out.append (in, last, std::string::npos);
    return S (out);
}

// An <svg …> wrapper taken off: its viewBox, and whether it stretches.
juce::String unwrap (const juce::String& markup, float& vbW, float& vbH, bool& stretch)
{
    if (! markup.startsWith ("<svg"))
        return markup;
    const auto head = markup.upToFirstOccurrenceOf (">", false, false);
    const auto vb = head.fromFirstOccurrenceOf ("viewBox=\"", false, false).upToFirstOccurrenceOf ("\"", false, false);
    auto p = juce::StringArray::fromTokens (vb, " ", "");
    if (p.size() == 4)
    {
        vbW = p[2].getFloatValue();
        vbH = p[3].getFloatValue();
    }
    stretch = head.contains ("preserveAspectRatio=\"none\"");
    return markup.fromFirstOccurrenceOf (">", false, false).upToLastOccurrenceOf ("</svg>", false, false);
}
} // namespace

FxCard::FxCard (const juce::var& a) : api (a) {}

void FxCard::useTree (const juce::var& walk)
{
    customTree = walk;
    stamp = -1;
    layout();
}

const juce::var* FxCard::tree (const juce::String& v) const
{
    if (v == "custom")
        return customTree.isObject() ? &customTree : nullptr;
    if (cap == nullptr)
        return nullptr;
    if (v == "tree")
        return &(*cap)["tree"];
    if (v == "mgl")
        return &(*cap)["mgl"]["tree"];
    if (v == "adv" || v == "lit")
        return (*cap)[juce::Identifier (v)].isObject() ? &(*cap)[juce::Identifier (v)] : nullptr;
    if (v == "off")
        return &face::page ("fx")["cardOff"];
    return nullptr;
}

face::Chrome& FxCard::chrome (const juce::String& v)
{
    auto& c = chromes[v];
    if (c == nullptr)
    {
        const auto* t = tree (v);
        c = std::make_unique<face::Chrome> (t != nullptr ? *t : juce::var());
    }
    return *c;
}

void FxCard::set (const juce::var& slot, const juce::var& rng)
{
    const bool sameKind = slotV.isObject() && slot["kind"] == slotV["kind"] && slot["face"] == slotV["face"] && stamp == face::stamp();
    slotV = slot;
    ranges = rng;
    const auto k = kind();
    shaper = fxp::findShaper (api, str (k == "comp" ? juce::String ("prism:compressor") : k));
    model = fxp::fxModel (slotV, shaper);
    const auto twin = fxp::findShaper (api, fxp::fxTwin (str (k)));
    std::set<std::string> keys;
    for (const auto& s : model.specs)
        keys.insert (s.key);
    panel = fxp::fxPanelOf (shaper, twin, keys);
    if (! sameKind)
        layout();
}

void FxCard::setLive (std::optional<double> db, double tel)
{
    inDb = db;
    telemetry = tel;
}

juce::Rectangle<float> FxCard::local (const juce::var& node) const
{
    return rectOf (node["rect"]) - origin;
}

void FxCard::layout()
{
    stamp = face::stamp();
    chromes.clear();
    cache.clear();
    ctls.clear();
    styles.clear();
    power = remove = mode = adv = open = faceOrig = faceMgl = dynCurve = dynCaret = eqCurve = handle = eqOn = juce::var();
    eqTabs.clear();
    eqReads.clear();
    eqTypes.clear();
    dynMeters.clear();
    const auto& cards = face::page ("fx")["cards"];
    const auto k = kind();
    cap = cards[juce::Identifier (k)].isObject() ? &cards[juce::Identifier (k)] : nullptr;
    if (customTree.isObject())
    {
        cap = &customTree;
        variant = "custom";
        origin = {};
        const auto rr = rectOf (customTree["tree"]["rect"]);
        size = { rr.getRight(), rr.getBottom() };
        collect (customTree["tree"], false);
        auto& cc = chrome (variant);
        for (const auto& x : ctls)
            if (x.type == "knob")
            {
                if (x.ring.isObject()) cc.skip.insert ((int) x.ring["i"]);
                if (x.pic.isObject()) cc.skip.insert ((int) x.pic["i"]);
                if (x.val.isObject()) cc.skipText.insert ((int) x.val["i"]);
                if (x.ring.isObject() && styles.count ("ring") == 0) styles["ring"] = ppic::Style::fromCaptured (x.ring["svg"].toString(), false);
                if (x.pic.isObject() && styles.count ("side") == 0) styles["side"] = ppic::Style::fromCaptured (x.pic["svg"].toString(), true);
            }
        return;
    }
    if (cap == nullptr)
    {
        size = { 296, 400 };
        return;
    }
    const bool mglFace = slotV["face"].toString() == "mgl" && (*cap)["mgl"].isObject();
    variant = mglFace ? "mgl" : "tree";
    // The card's own tree is walked from the card: its root is at (0, 0).
    const auto& r = mglFace ? (*cap)["mgl"]["rect"] : (*cap)["rect"];
    origin = {};
    size = { (float) dnum (r[2]), (float) dnum (r[3]) };
    const auto* t = tree (variant);
    if (t == nullptr)
        return;
    collect ((*t)["tree"], false);
    // Left out of the frame: what the card draws itself.
    auto& c = chrome (variant);
    auto skip = [&c] (const juce::var& n) {
        if (n.isObject())
            c.skip.insert ((int) n["i"]);
    };
    auto skipText = [&c] (const juce::var& n) {
        if (n.isObject())
            c.skipText.insert ((int) n["i"]);
    };
    for (const auto& x : ctls)
    {
        if (x.type == "knob" || x.type == "lex")
        {
            skip (x.ring);
            skip (x.pic);
            skipText (x.val);
        }
        else if (x.type == "foot")
        {
            skip (x.pic);
            skip (x.fill);
            skipText (x.val);
        }
        else if (x.type == "tile" || x.type == "seg")
            skip (x.node);
        else if (x.type == "display")
            skip (x.pic);
        else if (x.type == "pad")
            skip (x.dot);
    }
    skip (power);
    if (header.isEmpty() == false)
        if (auto* h = findIn ((*t)["tree"], [] (const juce::var& x) { return x["tag"].toString() == "header"; }))
            if (auto* kids = (*h)["kids"].getArray())
                for (const auto& k : *kids)
                    if (k["data"]["pseudo"].toString() == "::after")
                        handle = k;
    skip (handle);
    for (const auto& n : eqTabs)
        if (auto* svg = findIn (n, [] (const juce::var& x) { return x["tag"].toString() == "svg"; }))
            skip (*svg);
    for (const auto& n : eqReads)
        skipText (n);
    skip (eqOn);
    for (const auto& n : eqTypes)
        skip (n);
    skip (dynCurve);
    skip (dynCaret);
    skip (eqCurve);
    for (auto& [w, f] : dynMeters)
        skip (f);
    // The styles of the pictures, as the page's CSS has them where each sits.
    auto keep = [this] (const juce::String& name, const juce::var& svgNode, bool nonScaling) {
        if (svgNode.isObject() && styles.count (name) == 0)
            styles[name] = ppic::Style::fromCaptured (svgNode["svg"].toString(), nonScaling);
    };
    for (const auto& x : ctls)
    {
        if (x.type == "knob")
        {
            keep ("ring", x.ring, false);
            keep ("side", x.pic, true);
        }
        if (x.type == "lex")
        {
            keep ("lexring", x.ring, false);
            keep ("lexpic", x.pic, false);
        }
        if (x.type == "foot")
            keep ("gg", x.pic, false);
        if (x.type == "display")
            keep ("disp", x.pic, false);
    }
    keep ("dyn", dynCurve, false);
    keep ("eq", eqCurve, false);
}

void FxCard::collect (const juce::var& n, bool inControls)
{
    const auto& d = n["data"];
    const auto ctl = d["ctl"].toString();
    const bool controls = inControls || hasClass (n, "fx-module-controls") || (hasClass (n, "rv-sect") && hasClass (n, "ours"));
    // Place's own section in the Reverb window: its knobs are `place.<key>`.
    if (customTree.isObject() && hasClass (n, "rv-sect") && hasClass (n, "ours"))
    {
        ++placeDepth;
        if (auto* kids = n["kids"].getArray())
            for (const auto& k : *kids)
                collect (k, true);
        --placeDepth;
        return;
    }
    if (placeDepth > 0 && hasClass (n, "rv-led"))
    {
        Ctl c;
        c.type = "led";
        c.key = "place.on";
        c.spec.key = "place.on";
        c.spec.min = 0;
        c.spec.max = 1;
        c.spec.def = 0;
        c.node = n;
        c.r = local (n);
        c.controls = false;
        ctls.push_back (c);
        return;
    }
    if (placeDepth > 0 && hasClass (n, "ui-knob") && d.hasProperty ("key"))
    {
        Ctl c;
        c.type = "knob";
        c.key = "place." + d["key"].toString();
        for (const auto& ps : rvd::RV_PLACE())
            if (juce::String (ps.key) == d["key"].toString())
            {
                c.spec.key = str (c.key);
                c.spec.label = ps.label;
                c.spec.unit = ps.unit;
                c.spec.min = ps.min;
                c.spec.max = ps.max;
                c.spec.def = ps.def;
                c.spec.log = ps.log;
                if (ps.step > 0)
                    c.spec.step = ps.step;
                c.spec.hasChoices = ! ps.choices.empty();
                c.spec.choices = ps.choices;
            }
        c.node = n;
        c.r = local (n);
        c.ring = child (n, [] (const juce::var& x) { return hasClass (x, "ui-ring"); });
        c.pic = child (n, [] (const juce::var& x) { return hasClass (x, "ui-pic"); });
        c.val = child (n, [] (const juce::var& x) { return hasClass (x, "ui-kval"); });
        c.controls = false;
        ctls.push_back (c);
        return;
    }
    auto spec = [this] (const juce::String& key) -> const fxp::Spec* { return model.byKey (str (key)); };
    if (hasClass (n, "fx-power"))
        power = n;
    else if (hasClass (n, "fx-remove"))
        remove = n;
    else if (hasClass (n, "ui-dd") && mode.isVoid())
        mode = n;
    else if (hasClass (n, "fx-adv-btn"))
        adv = n;
    else if (hasClass (n, "fx-open"))
        open = n;
    else if (hasClass (n, "fx-face-style"))
    {
        faceOrig = child (n, [] (const juce::var& x) { return x["data"]["k"].toString() == "original"; });
        faceMgl = child (n, [] (const juce::var& x) { return x["data"]["k"].toString() == "mgl"; });
    }
    if (hasClass (n, "header") || n["tag"].toString() == "header")
        header = local (n);
    if (hasClass (n, "fx-module-controls"))
        body = local (n);
    if (hasClass (n, "ui-knob") && d.hasProperty ("key"))
    {
        Ctl c;
        c.type = "knob";
        c.key = d["key"].toString();
        // The EQ's knobs move the band picked (band.<i>.<key>).
        if (kind() == "eq" || kind() == "prism:eq")
            c.key = "band.sel." + c.key;
        if (auto* s = spec (c.key))
            c.spec = *s;
        else
        {
            c.spec.key = str (c.key);
            for (const auto& b : fxp::fxEqSelSpecs (fxp::fxEqBands (slotV, shaper).at (2), 2))
                if (S (b.key) == d["key"].toString())
                    c.spec = b;
            c.spec.key = str (c.key);
        }
        c.node = n;
        c.r = local (n);
        c.ring = child (n, [] (const juce::var& x) { return hasClass (x, "ui-ring"); });
        c.pic = child (n, [] (const juce::var& x) { return hasClass (x, "ui-pic"); });
        c.val = child (n, [] (const juce::var& x) { return hasClass (x, "ui-kval"); });
        c.controls = controls;
        ctls.push_back (c);
        return;
    }
    if (hasClass (n, "lex-knob") && d.hasProperty ("key"))
    {
        Ctl c;
        c.type = "lex";
        c.key = d["key"].toString();
        if (auto* s = spec (c.key))
            c.spec = *s;
        c.node = n;
        c.r = local (n);
        c.ring = child (n, [] (const juce::var& x) { return hasClass (x, "lex-ring"); });
        auto fki = child (n, [] (const juce::var& x) { return hasClass (x, "fki"); });
        c.pic = fki.isObject() ? child (fki, [] (const juce::var& x) { return x["tag"].toString() == "svg"; }) : juce::var();
        c.val = child (n, [] (const juce::var& x) { return hasClass (x, "v"); });
        c.controls = controls;
        ctls.push_back (c);
        return;
    }
    if (hasClass (n, "gs-bc") && d.hasProperty ("f"))
    {
        Ctl c;
        c.type = "foot";
        c.key = d["f"].toString();
        for (const auto& f : FOOT)
            if (c.key == f.key)
            {
                c.spec.key = f.key;
                c.spec.min = f.min;
                c.spec.max = f.max;
                c.spec.def = f.d;
            }
        c.node = n;
        c.pic = child (n, [] (const juce::var& x) { return hasClass (x, "gg"); });
        auto well = child (n, [] (const juce::var& x) { return hasClass (x, "gs-bw"); });
        c.r = well.isObject() ? local (well) : local (n);
        c.fill = child (n, [] (const juce::var& x) { return hasClass (x, "gs-bf"); });
        c.val = child (n, [] (const juce::var& x) { return hasClass (x, "gs-bv"); });
        c.controls = false;
        ctls.push_back (c);
        return;
    }
    if (ctl == "tile")
    {
        // The tiles stand for the switches, in the specs' order.
        Ctl c;
        c.type = "tile";
        int seen = 0;
        for (const auto& x : ctls)
            seen += x.type == "tile" ? 1 : 0;
        for (const auto& s : model.specs)
            if (fxp::fxIsSwitch (s) && ! s.hasChoices && seen-- == 0)
            {
                c.spec = s;
                break;
            }
        c.key = S (c.spec.key);
        c.node = n;
        c.r = local (n);
        c.controls = controls;
        ctls.push_back (c);
        return;
    }
    if (hasClass (n, "seg-param"))
    {
        Ctl c;
        c.type = "seg";
        const auto label = textOf (child (n, [] (const juce::var& x) { return hasClass (x, "k"); }));
        for (const auto& s : model.specs)
            if (S (s.label) == label || S (fxp::fxShort (s.label, s.role)) == label)
                c.spec = s;
        c.key = S (c.spec.key);
        c.node = n;
        c.r = local (n);
        std::function<void (const juce::var&)> btns = [&] (const juce::var& x) {
            if (hasClass (x, "seg-btn"))
                c.segs.push_back (x);
            if (auto* kids = x["kids"].getArray())
                for (const auto& k : *kids)
                    btns (k);
        };
        btns (n);
        c.controls = controls;
        if (c.key.isNotEmpty())
        {
            ctls.push_back (c);
            return;
        }
    }
    if (hasClass (n, "fx-face-display"))
    {
        Ctl c;
        c.type = "display";
        c.node = n;
        c.r = local (n);
        c.pic = child (n, [] (const juce::var& x) { return x["tag"].toString() == "svg"; });
        c.controls = controls;
        ctls.push_back (c);
        return;
    }
    if (hasClass (n, "fx-dyn-curve") || hasClass (n, "fx-max-disp"))
        dynCurve = child (n, [] (const juce::var& x) { return x["tag"].toString() == "svg"; });
    if (hasClass (n, "fx-caret"))
        dynCaret = n;
    if (hasClass (n, "fx-mtr"))
    {
        auto well = child (n, [] (const juce::var& x) { return x["tag"].toString() == "i"; });
        auto fill = well.isObject() ? child (well, [] (const juce::var& x) { return x["data"]["pseudo"].toString() == "::after"; }) : juce::var();
        dynMeters.push_back ({ well, fill });
    }
    if (hasClass (n, "fx-eq-disp"))
        eqCurve = child (n, [] (const juce::var& x) { return x["tag"].toString() == "svg"; });
    if (hasClass (n, "fx-eq-types") || hasClass (n, "fx-eq-read") || hasClass (n, "fx-eq-modes"))
        if (auto* kids = n["kids"].getArray())
            for (const auto& k : *kids)
                (hasClass (n, "fx-eq-types") ? eqTabs : hasClass (n, "fx-eq-read") ? eqReads : eqTypes).push_back (k);
    if (hasClass (n, "fx-eq-on"))
        eqOn = n;
    if (auto* kids = n["kids"].getArray())
        for (const auto& k : *kids)
            collect (k, controls);
}

// ───────────────────────────────────────────────────────────── values

double FxCard::get (const Ctl& c) const
{
    if (c.key.startsWith ("place."))
    {
        const auto v = slotV["place"][juce::Identifier (c.key.fromFirstOccurrenceOf ("place.", false, false))];
        return v.isVoid() ? c.spec.def.value_or (0) : dnum (v);
    }
    if (c.type == "foot")
    {
        const auto v = slotV[juce::Identifier (c.key)];
        return v.isVoid() ? *c.spec.def : dnum (v);
    }
    if (c.key.startsWith ("band."))
    {
        const auto k = bandKey (c.key);
        const auto bands = fxp::fxEqBands (slotV, shaper);
        const auto f = k.fromLastOccurrenceOf (".", false, false);
        const auto& b = bands.at ((size_t) juce::jlimit (0, (int) bands.size() - 1, k.fromFirstOccurrenceOf ("band.", false, false).getIntValue()));
        return f == "freq" ? b.freq : f == "q" ? b.q : b.gainDb;
    }
    const auto v = model.get (str (c.key));
    return std::isnan (v) ? c.spec.def.value_or (c.spec.min) : v;
}

double FxCard::value (const juce::String& key) const
{
    for (const auto& c : ctls)
        if (c.key == key || (c.type == "foot" && "foot:" + c.key == key))
            return get (c);
    return std::nan ("");
}

fxp::Range FxCard::range (const Ctl& c) const
{
    if (c.type == "foot")
        return { c.spec.min, c.spec.max, false };
    return fxp::fxRange (ranges, str (id()), c.spec);
}

void FxCard::put (const Ctl& c, double v)
{
    auto o = juce::var (new juce::DynamicObject());
    auto* d = o.getDynamicObject();
    d->setProperty ("op", "param");
    d->setProperty ("id", id());
    if (c.type == "foot")
    {
        v = juce::jlimit (c.spec.min, c.spec.max, v);
        if (c.key == "level" && std::abs (v) < 0.35)
            v = 0;
        d->setProperty ("key", "slot." + c.key);
        if (auto* s = slotV.getDynamicObject())
            s->setProperty (juce::Identifier (c.key), v);
    }
    else if (c.key.startsWith ("place."))
    {
        v = juce::jlimit (c.spec.min, c.spec.max, v);
        if (c.spec.step)
            v = std::floor (v + 0.5);
        d->setProperty ("key", c.key);
        if (! slotV["place"].isObject())
        {
            auto pl = juce::var (new juce::DynamicObject());
            for (const auto& [k, dv] : rvd::rvPlaceDefaults())
                pl.getDynamicObject()->setProperty (juce::Identifier (juce::String (k)), dv);
            slotV.getDynamicObject()->setProperty ("place", pl);
        }
        slotV["place"].getDynamicObject()->setProperty (juce::Identifier (c.key.fromFirstOccurrenceOf ("place.", false, false)), v);
    }
    else
    {
        v = c.key.startsWith ("band.") ? juce::jlimit (c.spec.min, c.spec.max, v) : fxp::fxClamp (c.spec, v);
        const auto key = c.key.startsWith ("band.") ? bandKey (c.key) : c.key;
        d->setProperty ("key", key);
        // Moved here at once, as the page writes the slot before it posts.
        if (key.startsWith ("band."))
        {
            auto bands = slotV["bands"];
            auto b = bands[key.fromFirstOccurrenceOf ("band.", false, false).getIntValue()];
            if (auto* bo = b.getDynamicObject())
                bo->setProperty (juce::Identifier (key.fromLastOccurrenceOf (".", false, false)), v);
        }
        else if (slotV["params"].isObject())
        {
            if (auto* p = slotV["params"].getDynamicObject())
                p->setProperty (juce::Identifier (c.key), v);
        }
        else if (auto* s = slotV.getDynamicObject())
            s->setProperty (juce::Identifier (c.key), v);
        model = fxp::fxModel (slotV, shaper);
    }
    d->setProperty ("value", v);
    if (send)
        send (o);
    if (changed)
        changed();
}

// ───────────────────────────────────────────────────────────── drawing

void FxCard::svgAt (juce::Graphics& g, const juce::var& node, const std::string& markup, juce::Point<float> at, float vbW, float vbH)
{
    if (! node.isObject() || markup.empty())
        return;
    bool stretch = false;
    const auto inner = unwrap (S (markup), vbW, vbH, stretch);
    const auto r = local (node) + at;
    // The <svg>'s own box first (a display's well and its glow), as captured.
    if (node["layers"].isArray() || node["bg"].isObject() || node["bg"].isString() || node["border"].isObject())
        face::paintBox (g, node, r);
    const auto cls = juce::StringArray::fromTokens (node["cls"].toString(), " ", "");
    const auto styleName = cls.contains ("ui-ring") ? "ring" : cls.contains ("ui-pic") ? "side" : cls.contains ("lex-ring") ? "lexring" : cls.contains ("gg") ? "gg" : cls.contains ("fx-disp") ? "disp" : "";
    ppic::Style st;
    if (auto f = styles.find (styleName); f != styles.end())
        st = f->second;
    else
        st = ppic::Style::fromCaptured (node["svg"].toString(), false);
    const float sc = std::min (r.getWidth() / vbW, r.getHeight() / vbH);
    const auto doc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 " + juce::String (vbW) + " " + juce::String (vbH) + "\" width=\"" + juce::String (vbW) + "\" height=\""
                     + juce::String (vbH) + "\">" + resolve (inner, st, sc, st.nonScaling && ! stretch) + "</svg>";
    static std::map<juce::String, std::unique_ptr<juce::Drawable>> drawn;
    auto& dr = drawn[doc];
    if (dr == nullptr)
    {
        if (drawn.size() > 3000)
            drawn.clear();
        dr = juce::Drawable::createFromSVGString (doc);
        if (dr == nullptr)
            return;
        drawn[doc] = std::move (dr);
    }
    auto& d = drawn[doc];
    if (d == nullptr)
        return;
    juce::Graphics::ScopedSaveState keep (g);
    g.reduceClipRegion (r.toNearestInt().expanded (1));
    if (stretch)
        d->drawWithin (g, r, juce::RectanglePlacement::stretchToFit, 1.0f);
    else
        d->draw (g, 1.0f, juce::AffineTransform::scale (sc).translated (r.getX() + (r.getWidth() - vbW * sc) / 2, r.getY() + (r.getHeight() - vbH * sc) / 2));
}

void FxCard::textAt (juce::Graphics& g, const juce::var& node, const juce::String& text, juce::Point<float> at, juce::Justification just)
{
    if (node.isObject())
        face::paintText (g, node, local (node) + at, text, just);
}

void FxCard::paint (juce::Graphics& g, juce::Point<float> at)
{
    if (stamp != face::stamp())
        layout();
    if (cap == nullptr)
    {
        g.setColour (juce::Colours::darkgrey);
        g.fillRoundedRectangle ({ at.x, at.y, size.x, size.y }, 8);
        g.setColour (juce::Colours::white);
        g.drawText (kind(), juce::Rectangle<float> (at.x, at.y, size.x, 30), juce::Justification::centred);
        return;
    }
    const bool off = (bool) slotV["bypassed"];
    const juce::String v = advanced && (*cap)["adv"].isObject() ? juce::String ("adv") : variant;
    // The frame, drawn once at the screen's sharpness and kept.
    {
        const float scale = juce::jmax (1.0f, g.getInternalContext().getPhysicalPixelScaleFactor());
        const auto sig = v + (off ? "|off|" : "|on|") + juce::String (scale) + "|" + juce::String (face::stamp());
        auto& im = cache[sig];
        if (im.isNull())
        {
            if (cache.size() > 8)
                cache.clear();
            auto& c = chrome (v);
            if (off && v != "adv")
            {
                // Switched off, the body is faded as the CSS fades it.
                std::function<void (const juce::var&)> fade = [&] (const juce::var& n) {
                    if (hasClass (n, "fx-module-controls"))
                        c.opacityOf[(int) n["i"]] = 0.38f;
                    if (auto* kids = n["kids"].getArray())
                        for (const auto& k : *kids)
                            fade (k);
                };
                fade ((*tree (v))["tree"]);
            }
            else
                c.opacityOf.clear();
            // Advanced draws itself whole, as captured.
            im = juce::Image (juce::Image::ARGB, (int) std::ceil ((size.x + 16) * scale), (int) std::ceil ((size.y + 16) * scale), true);
            juce::Graphics ig (im);
            ig.addTransform (juce::AffineTransform::translation (8, 8).scaled (scale));
            const auto without = c.skip, withoutText = c.skipText;
            c.drawPart (ig, (*tree (v))["tree"], -origin, 1.0f, &without, &withoutText);
            c.opacityOf.clear();
        }
        // Drawn whole: drawImage takes the context's opacity, which a reading may have left.
        g.setOpacity (1.0f);
        g.drawImage (im, { at.x - 8, at.y - 8, size.x + 16, size.y + 16 });
    }
    // The power: its box lit or not, and its picture (the page's CSS masks
    // a power glyph: drawn here), in the page's on colour or its dim text.
    const auto& pcl = face::page ("fx")["cl"];
    if (power.isObject())
    {
        const juce::var* box = &power;
        if (off)
            if (auto* p = findIn (face::page ("fx")["cardOff"]["tree"], [] (const juce::var& x) { return hasClass (x, "fx-power"); }))
                box = p;
        const auto pr = local (power) + at;
        face::paintBox (g, *box, pr);
        const auto ic = juce::Rectangle<float> (12, 12).withCentre (pr.getCentre());
        const auto col = c2d::css ((off ? pcl["--gs-t3"] : pcl["--gs-on"]).toString());
        juce::Path glyph;
        glyph.addCentredArc (ic.getCentreX(), ic.getCentreY() + 0.5f, 4.6f, 4.6f, 0, 0.75f, juce::MathConstants<float>::twoPi - 0.75f, true);
        glyph.startNewSubPath (ic.getCentreX(), ic.getY() + 0.8f);
        glyph.lineTo (ic.getCentreX(), ic.getCentreY());
        if (! off)
        {
            g.setColour (col.withAlpha (0.35f));
            g.strokePath (glyph, juce::PathStrokeType (3.0f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
        }
        g.setColour (col);
        g.strokePath (glyph, juce::PathStrokeType (1.6f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
    }
    // The drag handle (the header's ::after: two rules and a middle line).
    if (handle.isObject())
    {
        const auto hr = local (handle) + at;
        g.setColour (c2d::css (pcl["--gs-t2"].toString()));
        for (float y : { hr.getY(), hr.getCentreY() - 0.8f, hr.getBottom() - 1.6f })
            g.fillRect (hr.getX(), y, hr.getWidth(), 1.6f);
    }
    if (v == "adv")
        return;
    // What the values move.
    const auto cardsLit = (*cap)["lit"];
    for (const auto& c : ctls)
    {
        const bool fade = off && c.controls;
        if (fade)
            g.beginTransparencyLayer (0.38f);
        const double val = get (c);
        if (c.type == "knob")
        {
            fxp::RingState st;
            const auto rg = range (c);
            st.u = fxp::fxUnit (rg, val);
            st.bip = c.spec.min < 0 && c.spec.max > 0;
            st.pointer = true;   // the cap's line (uiKnob: pointer unless a face)
            if (c.spec.def)
                st.def = fxp::fxUnit (rg, *c.spec.def);
            svgAt (g, c.ring, fxp::uiRingBody (26, st), at, 26, 26);
            if (! c.key.startsWith ("band."))
                svgAt (g, c.pic, fxp::fxKnobPic (c.spec, val, rg), at);
            textAt (g, c.val, S (c.key.startsWith ("band.") ? fxp::fxValueFormat (c.spec, val) : fxp::fxFormat (c.spec, val)), at);
        }
        else if (c.type == "lex")
        {
            svgAt (g, c.ring, fxp::fxLexRing (fxp::fxLexUnit (c.spec, val)), at, 64, 64);
            svgAt (g, c.pic, fxp::fxLexPic (c.spec, val), at);
            textAt (g, c.val, S (fxp::fxLexReading (c.spec, val)), at);
        }
        else if (c.type == "foot")
        {
            const double n = (val - c.spec.min) / (c.spec.max - c.spec.min), z = (*c.spec.def - c.spec.min) / (c.spec.max - c.spec.min);
            const bool bip = c.key == "level";
            const double a = bip ? juce::jmin (n, z) : 0, b = bip ? juce::jmax (n, z) : n;
            if (c.fill.isObject())
            {
                const auto w = rectOf (c.node["rect"]);
                auto well = c.r + at;
                juce::ignoreUnused (w);
                const auto fr = rectOf (c.fill["rect"]) - origin + at;
                juce::Rectangle<float> f (well.getX() + 4 + (well.getWidth() - 8) * (float) a, fr.getY(), (well.getWidth() - 8) * (float) (b - a), fr.getHeight());
                face::paintBox (g, c.fill, f);
                // The line at its end (the bar's ::after).
                if (auto* ln = findIn (c.fill, [] (const juce::var& x) { return x["data"]["pseudo"].toString() == "::after"; }))
                {
                    const auto lr = rectOf ((*ln)["rect"]);
                    face::paintBox (g, *ln, { (float) (well.getX() + 4 + (well.getWidth() - 8) * (bip && n < z ? a : b)) - lr.getWidth() / 2, fr.getY(), lr.getWidth(), lr.getHeight() });
                }
            }
            svgAt (g, c.pic, c.key == "wet" ? fxp::gsMixGlyph (val) : fxp::gsLevelGlyph (val), at);
            textAt (g, c.val, footText (c.key, val), at, juce::Justification::centredRight);
        }
        else if (c.type == "tile")
        {
            // Lit as the page lights it: the card with every switch flipped has it.
            const bool capturedOn = fxp::fxTileOn (c.spec, c.spec.def.value_or (c.spec.min));
            const bool on = fxp::fxTileOn (c.spec, val);
            const juce::var* look = &c.node;
            if (on != capturedOn && cardsLit.isObject())
                if (auto* lit = findIn (cardsLit["tree"], [&] (const juce::var& x) { return (int) x["i"] == (int) c.node["i"]; }))
                    look = lit;
            chrome (on != capturedOn && cardsLit.isObject() ? "lit" : variant).drawPart (g, *look, at - origin);
        }
        else if (c.type == "seg")
        {
            const auto* onLook = findIn (c.node, [] (const juce::var& x) { return hasClass (x, "seg-btn") && hasClass (x, "active"); });
            const auto* offLook = findIn (c.node, [] (const juce::var& x) { return hasClass (x, "seg-btn") && ! hasClass (x, "active"); });
            const int pick = (int) std::floor (val - c.spec.min + 0.5);
            // The row itself, then each button lit or not.
            for (int i = 0; i < (int) c.segs.size(); ++i)
            {
                const auto* lk = i == pick ? onLook : offLook;
                if (lk == nullptr)
                    continue;
                const auto r = local (c.segs[(size_t) i]) + at;
                face::paintBox (g, *lk, r);
                face::paintText (g, *lk, r, textOf (c.segs[(size_t) i]), juce::Justification::centred);
            }
            auto rowLabel = child (c.node, [] (const juce::var& x) { return hasClass (x, "k"); });
            if (rowLabel.isObject())
                chrome (variant).drawPart (g, rowLabel, at - origin);
        }
        else if (c.type == "display")
            svgAt (g, c.pic, fxp::fxDeckDisplay (model, panel), at, 400, 70);
        else if (c.type == "led" && val >= 0.5)
        {
            const auto r = c.r + at;
            g.setColour (c2d::css (S (rvd::Colours().on)));
            g.fillRoundedRectangle (r, 2);
        }
        if (fade)
            g.endTransparencyLayer();
    }
    // The dynamics: the transfer curve, the meters, the threshold's caret.
    if (dynCurve.isObject())
    {
        const bool isMax = kind().contains ("maximizer");
        const bool gate = kind().contains ("gate");
        if (off)
            g.beginTransparencyLayer (0.38f);
        juce::String curve, caretTop;
        std::vector<fxp::Meter> m;
        if (isMax)
        {
            auto p = fxp::fxMaximizerPaint (model.values, inDb);
            curve = S (p.curve);
            caretTop = S (p.caretTop);
            m = { p.in, p.gr, p.out };
        }
        else
        {
            auto p = fxp::fxDynamicsPaint (model, inDb, gate);
            curve = S (p.curve);
            caretTop = S (p.caretTop);
            m = { p.in, p.gr, p.out };
        }
        ppic::Style keepDyn = styles.count ("dyn") ? styles["dyn"] : ppic::Style();
        styles["disp"] = keepDyn;
        auto saveNode = dynCurve;
        svgAt (g, saveNode, str (curve), at, (float) rectOf (dynCurve["rect"]).getWidth(), (float) rectOf (dynCurve["rect"]).getHeight());
        for (size_t i = 0; i < dynMeters.size() && i < m.size(); ++i)
        {
            const auto& [well, fill] = dynMeters[i];
            if (! well.isObject() || ! fill.isObject())
                continue;
            const auto wr = local (well) + at;
            const float h = S (m[i].h).getFloatValue() / 100.0f * wr.getHeight();
            const auto fr = local (fill) + at;
            face::paintBox (g, fill, { fr.getX(), wr.getBottom() - 2 - h, fr.getWidth(), h });
        }
        if (dynCaret.isObject() && caretTop.isNotEmpty())
        {
            const auto cr = local (dynCaret) + at;
            const auto parent = dynMeters.empty() ? cr : local (dynMeters[0].first) + at;
            const float top = caretTop.endsWith ("%") ? parent.getY() + caretTop.getFloatValue() / 100.0f * parent.getHeight() : parent.getY() + caretTop.getFloatValue();
            chrome (variant).drawPart (g, dynCaret, at - origin + juce::Point<float> (0, top - cr.getY()));
        }
        if (off)
            g.endTransparencyLayer();
    }
    // The EQ's curve.
    if (eqCurve.isObject())
    {
        if (off)
            g.beginTransparencyLayer (0.38f);
        styles["disp"] = styles.count ("eq") ? styles["eq"] : ppic::Style();
        const auto bands = fxp::fxEqBands (slotV, shaper);
        svgAt (g, eqCurve, fxp::fxEqCurve (bands, eqSel), at, 340, 150);
        // The band tabs: lit as on, the picked one marked, each with its type's picture.
        for (int i = 0; i < (int) eqTabs.size() && i < (int) bands.size(); ++i)
        {
            const auto r = local (eqTabs[(size_t) i]) + at;
            const auto col = c2d::css (fxp::FX_EQ_COLOURS[i % 8]);
            const bool wasOn = i == 1 || i == 2 || i == 6, nowOn = bands[(size_t) i].enabled;
            if (wasOn != nowOn)
            {
                g.setColour (juce::Colours::black.withAlpha (nowOn ? 0.0f : 0.45f));
                g.fillRect (r.reduced (1));
                if (nowOn)
                {
                    g.setColour (col.withAlpha (0.18f));
                    g.fillRect (r.reduced (1));
                }
            }
            if ((i == 2) != (i == eqSel))
            {
                g.setColour (i == eqSel ? col.withAlpha (0.22f) : juce::Colours::black.withAlpha (0.3f));
                g.fillRect (r.reduced (1));
            }
            int k = 0;
            for (int t = 0; t < 6; ++t)
                if (bands[(size_t) i].type == fxp::FX_EQ_TYPES[t])
                    k = t;
            juce::Path icon = juce::Drawable::parseSVGPath (fxp::FX_EQ_ICON[k]);
            const auto ir = juce::Rectangle<float> (28, 14).withCentre ({ r.getCentreX(), r.getY() + 10 });
            icon.applyTransform (juce::AffineTransform::translation (ir.getX(), ir.getY()));
            g.setColour (col.withAlpha (nowOn ? 1.0f : 0.5f));
            g.strokePath (icon, juce::PathStrokeType (1.3f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
        }
        // The readouts under them.
        for (int i = 0; i < (int) eqReads.size() && i < (int) bands.size(); ++i)
        {
            const auto r = local (eqReads[(size_t) i]) + at;
            juce::StringArray two;
            two.addTokens (S (fxp::fxEqReadout (bands[(size_t) i])).replace ("<br>", "\n"), "\n", "");
            for (int l = 0; l < two.size() && l < 2; ++l)
                face::paintText (g, eqReads[(size_t) i], r.withHeight (r.getHeight() / 2).translated (0, (float) l * r.getHeight() / 2), two[l], juce::Justification::centred);
            if (i == eqSel)
            {
                g.setColour (c2d::css (fxp::FX_EQ_COLOURS[i % 8]).withAlpha (0.15f));
                g.fillRect (r);
            }
        }
        // The picked band's On, and its type.
        if (eqOn.isObject() && eqSel < (int) bands.size())
        {
            const auto r = local (eqOn) + at;
            const bool on = bands[(size_t) eqSel].enabled;
            face::paintBox (g, eqOn, r);
            face::paintText (g, eqOn, r, on ? "On" : "Off", juce::Justification::centred);
            if (! on)
            {
                g.setColour (juce::Colours::black.withAlpha (0.4f));
                g.fillRoundedRectangle (r, 4);
            }
        }
        const juce::var* typeOn = nullptr;
        const juce::var* typeOff = nullptr;
        for (const auto& t : eqTypes)
        {
            if (hasClass (t, "on"))
                typeOn = &t;
            else if (typeOff == nullptr || typeOff == typeOn)
                typeOff = &t;
        }
        for (int t = 0; t < (int) eqTypes.size() && eqSel < (int) bands.size(); ++t)
        {
            const bool lit = bands[(size_t) eqSel].type == fxp::FX_EQ_TYPES[t % 6];
            const auto* lk = lit ? typeOn : typeOff;
            if (lk == nullptr)
                continue;
            const auto r = local (eqTypes[(size_t) t]) + at;
            face::paintBox (g, *lk, r);
            face::paintText (g, *lk, r, fxp::FX_EQ_SHORT[t % 6], juce::Justification::centred);
        }
        if (off)
            g.endTransparencyLayer();
    }
}

// ───────────────────────────────────────────────────────────── the hand

const FxCard::Ctl* FxCard::at (juce::Point<float> p) const
{
    for (const auto& c : ctls)
    {
        if (c.type == "seg")
        {
            if (c.r.contains (p))
                return &c;
            continue;
        }
        if (c.r.contains (p))
            return &c;
    }
    return nullptr;
}

bool FxCard::onHeader (juce::Point<float> p) const
{
    return header.contains (p) && ! where ("power").contains (p) && ! where ("remove").contains (p) && ! where ("adv").contains (p) && ! where ("open").contains (p);
}

juce::Rectangle<float> FxCard::where (const juce::String& part) const
{
    auto r = [this] (const juce::var& n) { return n.isObject() ? local (n) : juce::Rectangle<float>(); };
    if (part == "power") return r (power);
    if (part == "remove") return r (remove);
    if (part == "mode") return r (mode);
    if (part == "adv") return r (adv);
    if (part == "open") return r (open);
    if (part == "face:original") return r (faceOrig);
    if (part == "face:mgl") return r (faceMgl);
    if (part == "eqOn") return r (eqOn);
    if (part.startsWith ("eqTab:")) { const int i = part.fromFirstOccurrenceOf (":", false, false).getIntValue(); return i < (int) eqTabs.size() ? r (eqTabs[(size_t) i]) : juce::Rectangle<float>(); }
    if (part.startsWith ("eqType:")) { const int i = part.fromFirstOccurrenceOf (":", false, false).getIntValue(); return i < (int) eqTypes.size() ? r (eqTypes[(size_t) i]) : juce::Rectangle<float>(); }
    for (const auto& c : ctls)
    {
        if (c.type == "display" && part == "display") return c.r;
        if (c.type == "foot" && part == "foot:" + c.key) return c.r;
        if ((c.type == "knob" || c.type == "lex") && part == "knob:" + c.key) return c.r;
        if (c.type == "tile" && part == "tile:" + c.key) return c.r;
        if (c.type == "seg" && part.startsWith ("seg:" + c.key + ":"))
        {
            const int i = part.fromLastOccurrenceOf (":", false, false).getIntValue();
            return i < (int) c.segs.size() ? local (c.segs[(size_t) i]) : juce::Rectangle<float>();
        }
    }
    return {};
}

bool FxCard::mouseDown (juce::Point<float> p, const juce::ModifierKeys& mods)
{
    juce::ignoreUnused (mods);
    dragging = -1;
    auto msg = [] (const char* op) {
        auto o = juce::var (new juce::DynamicObject());
        o.getDynamicObject()->setProperty ("op", op);
        return o;
    };
    if (where ("power").contains (p))
    {
        auto o = msg ("bypass");
        o.getDynamicObject()->setProperty ("on", (bool) slotV["bypassed"]);
        if (auto* s = slotV.getDynamicObject())
            s->setProperty ("bypassed", ! (bool) slotV["bypassed"]);
        cache.clear();
        if (send) send (o);
        if (changed) changed();
        return true;
    }
    if (where ("remove").contains (p))
    {
        if (send) send (msg ("remove"));
        return true;
    }
    if (where ("adv").contains (p))
    {
        advanced = ! advanced;
        if (send) send (msg ("advanced"));
        if (changed) changed();
        return true;
    }
    if (where ("open").contains (p))
    {
        if (send) send (msg ("open"));
        return true;
    }
    for (const char* f : { "original", "mgl" })
        if (where ("face:" + juce::String (f)).contains (p))
        {
            auto o = msg ("face");
            o.getDynamicObject()->setProperty ("face", f);
            if (send) send (o);
            return true;
        }
    if (where ("mode").contains (p))
    {
        // The module's modes (listed, and this one), as the Mode drop lists them.
        juce::PopupMenu menu;
        std::vector<std::pair<juce::String, juce::String>> items;
        const auto suiteId = slotV["suite"].toString();
        if (auto* suites = api["suites"].getArray())
            for (const auto& s : *suites)
            {
                bool mine = s["id"].toString() == suiteId;
                if (! mine && suiteId.isEmpty())
                    if (auto* fams = s["families"].getArray())
                        for (const auto& f : *fams)
                            if (auto* ms = f["modes"].getArray())
                                for (const auto& m : *ms)
                                    mine = mine || m["kind"] == slotV["kind"];
                if (! mine)
                    continue;
                if (auto* fams = s["families"].getArray())
                    for (const auto& f : *fams)
                    {
                        bool head = false;
                        if (auto* ms = f["modes"].getArray())
                            for (const auto& m : *ms)
                            {
                                const bool current = m["id"].toString() == slotV["mode"].toString() || (slotV["mode"].isVoid() && m["kind"] == slotV["kind"]);
                                if (! (bool) m["listed"] && ! current)
                                    continue;
                                if (! head && fams->size() > 1)
                                    menu.addSectionHeader (f["label"].toString());
                                head = true;
                                items.push_back ({ s["id"].toString(), m["id"].toString() });
                                menu.addItem ((int) items.size(), m["label"].toString(), true, current);
                            }
                    }
            }
        if (items.empty())
            return true;
        menu.showMenuAsync (juce::PopupMenu::Options(), [this, items, msg] (int r) {
            if (r <= 0)
                return;
            auto o = msg ("mode");
            o.getDynamicObject()->setProperty ("suite", items[(size_t) r - 1].first);
            o.getDynamicObject()->setProperty ("mode", items[(size_t) r - 1].second);
            if (send) send (o);
        });
        return true;
    }
    if (isEq())
    {
        for (int i = 0; i < (int) eqTabs.size(); ++i)
            if (local (eqTabs[(size_t) i]).contains (p) || (i < (int) eqReads.size() && local (eqReads[(size_t) i]).contains (p)))
            {
                eqSel = i;
                if (changed) changed();
                return true;
            }
        if (eqOn.isObject() && local (eqOn).contains (p))
        {
            eqSet (eqSel, "enabled", ! (bool) slotV["bands"][eqSel]["enabled"]);
            return true;
        }
        for (int t = 0; t < (int) eqTypes.size(); ++t)
            if (local (eqTypes[(size_t) t]).contains (p))
            {
                eqSet (eqSel, "type", fxp::FX_EQ_TYPES[t % 6]);
                return true;
            }
        if (eqCurve.isObject() && local (eqCurve).contains (p))
        {
            // A node grabbed: picked, then dragged.
            eqDrag = -1;
            float best = 12;
            for (int i = 0; i < (int) eqTabs.size(); ++i)
                if (const float d = eqNode (i).getDistanceFrom (p); d < best)
                {
                    best = d;
                    eqDrag = i;
                }
            if (eqDrag >= 0)
            {
                eqSel = eqDrag;
                if (changed) changed();
            }
            return true;
        }
    }
    const auto* c = at (p);
    if (c == nullptr)
        return false;
    const double v = get (*c);
    if (c->type == "tile" || c->type == "led")
    {
        put (*c, v >= (c->spec.min + c->spec.max) / 2 ? c->spec.min : c->spec.max);
        return true;
    }
    if (c->type == "seg")
    {
        for (int i = 0; i < (int) c->segs.size(); ++i)
            if (local (c->segs[(size_t) i]).contains (p))
                put (*c, c->spec.min + i);
        return true;
    }
    dragging = (int) (c - ctls.data());
    downAt = p;
    downU = c->type == "foot" ? 0 : fxp::fxUnit (range (*c), v);
    if (c->type == "foot" || c->type == "display")
        mouseDrag (p, mods);
    return true;
}

void FxCard::mouseDrag (juce::Point<float> p, const juce::ModifierKeys& mods)
{
    if (eqDrag >= 0 && eqCurve.isObject())
    {
        const auto r = local (eqCurve);
        const double W = 340, H = 150, fmin = 20, fmax = 20000, gmax = 18;
        const float sc = juce::jmin (r.getWidth() / (float) W, r.getHeight() / (float) H);
        const double x = (p.x - (r.getX() + (r.getWidth() - (float) W * sc) / 2)) / sc, y = (p.y - (r.getY() + (r.getHeight() - (float) H * sc) / 2)) / sc;
        const auto type = slotV["bands"][eqDrag]["type"].toString();
        Ctl c;
        c.type = "knob";
        c.spec.min = 20;
        c.spec.max = 20000;
        c.key = "band." + juce::String (eqDrag) + ".freq";
        put (c, juce::jlimit (20.0, 20000.0, fmin * std::pow (fmax / fmin, (x - 2) / (W - 4))));
        if (type != "highpass" && type != "lowpass" && type != "notch")
        {
            c.spec.min = -24;
            c.spec.max = 24;
            c.key = "band." + juce::String (eqDrag) + ".gainDb";
            put (c, juce::jlimit (-24.0, 24.0, (H / 2 - y) / (H / 2 - 10) * gmax));
        }
        return;
    }
    if (dragging < 0 || dragging >= (int) ctls.size())
        return;
    const auto& c = ctls[(size_t) dragging];
    if (c.type == "foot")
    {
        const auto w = c.r;
        put (c, c.spec.min + juce::jlimit (0.0, 1.0, (double) (p.x - w.getX() - 4) / juce::jmax (1.0f, w.getWidth() - 8)) * (c.spec.max - c.spec.min));
        return;
    }
    if (c.type == "display")
    {
        // The display is the pad: its two controls follow the hand.
        const auto pad = panel["pad"];
        const auto* px = model.byKey (str (pad["x"].toString()));
        const auto* py = model.byKey (str (pad["y"].toString()));
        if (px == nullptr || py == nullptr)
            return;
        const auto b = c.r;
        const double ux = (p.x - b.getX()) / b.getWidth(), uy = 1 - (p.y - b.getY()) / b.getHeight();
        Ctl cx, cy;
        cx.type = cy.type = "knob";
        cx.spec = *px;
        cy.spec = *py;
        cx.key = S (px->key);
        cy.key = S (py->key);
        put (cx, fxp::fxClamp (*px, fxp::unitValue (ux, dnum (pad["xMin"]), dnum (pad["xMax"]), fxp::fxIsLog (*px))));
        put (cy, fxp::fxClamp (*py, fxp::unitValue (uy, dnum (pad["yMin"]), dnum (pad["yMax"]), fxp::fxIsLog (*py))));
        return;
    }
    // A knob: up turns it up, 160 px the whole sweep, Shift five times finer.
    const double sens = mods.isShiftDown() ? 160.0 * 5 : 160.0;
    const double u = juce::jlimit (0.0, 1.0, downU + (downAt.y - p.y) / sens);
    put (c, fxp::fxFromUnit (range (c), u));
    if (mods.isShiftDown())
    {
        downU = u;
        downAt = p;
    }
}

void FxCard::mouseUp()
{
    dragging = -1;
    eqDrag = -1;
}

bool FxCard::doubleClick (juce::Point<float> p)
{
    const auto* c = at (p);
    if (c == nullptr || c->type == "tile" || c->type == "led" || c->type == "seg" || c->type == "display")
        return false;
    if (c->spec.def)
        put (*c, *c->spec.def);
    return true;
}

bool FxCard::wheel (juce::Point<float> p, float dy, bool shift)
{
    const auto* c = at (p);
    if (c == nullptr || (c->type != "knob" && c->type != "lex"))
        return false;
    const double u = fxp::fxUnit (range (*c), get (*c)) + (dy > 0 ? 1 : dy < 0 ? -1 : 0) * 0.03 * (shift ? 0.2 : 1);
    put (*c, fxp::fxFromUnit (range (*c), juce::jlimit (0.0, 1.0, u)));
    return true;
}

// ───────────────────────────────────────────────────────────── the EQ

juce::String FxCard::bandKey (const juce::String& key) const
{
    return key.startsWith ("band.sel.") ? "band." + juce::String (eqSel) + "." + key.fromFirstOccurrenceOf ("band.sel.", false, false) : key;
}

// A band's switch or type: written into the slot and the rack set again, as
// the page does (`eq.set`, then `commitRack`).
void FxCard::eqSet (int band, const juce::String& field, const juce::var& value)
{
    if (auto* b = slotV["bands"][band].getDynamicObject())
        b->setProperty (juce::Identifier (field), value);
    model = fxp::fxModel (slotV, shaper);
    auto o = juce::var (new juce::DynamicObject());
    o.getDynamicObject()->setProperty ("op", "slot");
    o.getDynamicObject()->setProperty ("slot", slotV);
    if (send)
        send (o);
    if (changed)
        changed();
}

// Where a band's node sits on the curve, in the card's pixels.
juce::Point<float> FxCard::eqNode (int band) const
{
    const auto bands = fxp::fxEqBands (slotV, shaper);
    if (band < 0 || band >= (int) bands.size() || ! eqCurve.isObject())
        return {};
    const auto& b = bands[(size_t) band];
    const double W = 340, H = 150, fmin = 20, fmax = 20000, gmax = 18;
    const double f = juce::jlimit (fmin, fmax, b.freq);
    const double x = (W - 4) * std::log (f / fmin) / std::log (fmax / fmin) + 2;
    const bool flat = b.type == "highpass" || b.type == "lowpass" || b.type == "notch";
    const double y = H / 2 - (flat ? 0.0 : b.gainDb) / gmax * (H / 2 - 10);
    const auto r = local (eqCurve);
    const float sc = juce::jmin (r.getWidth() / (float) W, r.getHeight() / (float) H);
    return { r.getX() + (r.getWidth() - (float) W * sc) / 2 + (float) x * sc, r.getY() + (r.getHeight() - (float) H * sc) / 2 + (float) y * sc };
}
