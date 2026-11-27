#include "Face.h"

#include "BinaryData.h"

#include <cstring>
#include <map>
#include <set>
#include <tuple>

namespace face
{
namespace
{
juce::String sansName()
{
    // The Mac's system face, which the page falls back to.
    static const juce::String name = [] {
        for (auto n : { ".AppleSystemUIFont", "SF Pro Text", "SF Pro", "Helvetica Neue" })
            if (juce::Font (juce::FontOptions (n, 13.0f, juce::Font::plain)).getTypefacePtr()->getName().isNotEmpty())
                return juce::String (n);
        return juce::Font::getDefaultSansSerifFontName();
    }();
    return name;
}

juce::String monoName()
{
    static const juce::String name = [] {
        for (auto n : { ".AppleSystemUIFontMonospaced", "SF Mono", "Menlo" })
        {
            juce::Font f (juce::FontOptions (n, 13.0f, juce::Font::plain));
            if (f.getTypefacePtr()->getName().isNotEmpty())
                return juce::String (n);
        }
        return juce::Font::getDefaultMonospacedFontName();
    }();
    return name;
}

juce::String styleFor (int weight)
{
    if (weight >= 700)
        return "Bold";
    if (weight >= 600)
        return "Semibold";
    if (weight >= 500)
        return "Medium";
    return "Regular";
}

float num (const juce::var& v, float fallback = 0.0f)
{
    return v.isVoid() ? fallback : (float) (double) v;
}

// A CSS length against `of`: "30%", "12px", or a bare number.
float length (const juce::var& v, float of, float fallback)
{
    if (v.isVoid() || v.isUndefined())
        return fallback;
    const auto s = v.toString().trim();
    if (s.endsWith ("%"))
        return s.dropLastCharacters (1).getFloatValue() / 100.0f * of;
    if (s == "left" || s == "top")
        return 0.0f;
    if (s == "right" || s == "bottom")
        return of;
    if (s == "center")
        return of * 0.5f;
    return s.getFloatValue();
}

juce::Rectangle<float> rectOf (const juce::var& r)
{
    return { num (r[0]), num (r[1]), num (r[2]), num (r[3]) };
}
} // namespace

namespace
{
// The system's faces are variable fonts: a style name alone gives their
// default drawing (regular weight, the large optical size), so the weight
// and the optical size the page asks for are set on the font's own axes,
// as the browser does. Made once for each size and weight: making one
// builds a typeface.
juce::Font made (bool monospaced, float px, int weight)
{
    static std::map<std::tuple<bool, int, int>, juce::Font> kept;
    const auto key = std::make_tuple (monospaced, juce::roundToInt (px * 100.0f), weight);
    if (auto it = kept.find (key); it != kept.end())
        return it->second;
    const auto name = monospaced ? monoName() : sansName();
    auto varied = juce::Font (juce::FontOptions().withName (name).withStyle (styleFor (weight)).withPointHeight (px));
    // The face itself, set to this weight (and, where it has one, this optical size).
    static std::map<juce::String, juce::Typeface::Ptr> bases;
    auto& base = bases[name];
    if (base == nullptr)
        base = juce::Font (juce::FontOptions().withName (name).withStyle ("Regular").withPointHeight (px)).getTypefacePtr();
    if (base != nullptr && !base->getSupportedVariables().empty())
    {
        const juce::FontVariableSetting axes[] { { "opsz", px }, { "wght", (float) weight } };
        if (auto set = base->cloneWithVariableSettings (axes))
            varied = juce::Font (juce::FontOptions (set).withPointHeight (px));
    }
    return kept.emplace (key, varied).first->second;
}
} // namespace

juce::Font sans (float px, int weight)
{
    return made (false, px, weight);
}

juce::Font mono (float px, int weight)
{
    return made (true, px, weight);
}

juce::Font font (const juce::var& f)
{
    const float size = num (f["size"], 12.0f);
    const int weight = (int) num (f["weight"], 400.0f);
    auto out = f["family"].toString() == "mono" ? mono (size, weight) : sans (size, weight);
    const float spacing = num (f["spacing"]);
    if (std::abs (spacing) > 0.001f)
        out = out.withExtraKerningFactor (spacing / size);
    if ((bool) f["italic"])
        out = out.italicised();
    return out;
}

juce::Colour colour (const juce::var& c)
{
    if (!c.isArray())
        return juce::Colours::transparentBlack;
    return juce::Colour ((juce::uint8) (int) c[0], (juce::uint8) (int) c[1], (juce::uint8) (int) c[2], (float) (double) c[3]);
}

namespace
{
// A file embedded in the app, read whole; gzipped ones unpacked.
juce::String embedded (const juce::String& file)
{
    for (int i = 0; i < BinaryData::namedResourceListSize; ++i)
        if (juce::String (BinaryData::originalFilenames[i]) == file)
        {
            int size = 0;
            const char* data = BinaryData::getNamedResource (BinaryData::namedResourceList[i], size);
            if (file.endsWith (".gz"))
            {
                juce::MemoryInputStream raw (data, (size_t) size, false);
                juce::GZIPDecompressorInputStream unzip (&raw, false, juce::GZIPDecompressorInputStream::gzipFormat);
                return unzip.readEntireStreamAsString();
            }
            return juce::String::fromUTF8 (data, size);
        }
    return {};
}

struct Worn
{
    int choice = -1;
    juce::String kit = "thinRing";
    juce::var idmlab;        // the idMLab theme's parts
    juce::var mgl;           // Wave's face in the MGL theme
    juce::var atmos;         // Atmosphere's face in the MGL theme
    juce::var seq;           // Seq's face in the MGL theme
    juce::var edit;          // the Edit page in the MGL theme
    juce::var waveViews;     // Wave's other views and parts in the MGL theme
    juce::var grain;         // the Grain page in the MGL theme
    juce::var chop;          // the Chop page in the MGL theme
    juce::var prism;         // the Prism page in the MGL theme
    juce::var fx;            // the FX page and every effect card in the MGL theme
    juce::var browse;        // the Browse page in the MGL theme (the main three themes captured)
    juce::var library;       // the Library page in the MGL theme
    int stamp = 0;
};
// The FX capture in MGL theme `id`: the default theme whole, and another
// theme as what differs from it (tools/face-capture/fx-slim.mjs): [path,
// value] pairs, the path's parts joined by "/"; {c: [...]} is the default's
// string with these colours in its rgb()/rgba() ones' places, in order.
juce::var fxTheme (const juce::String& id)
{
    auto base = juce::JSON::parse (embedded ("mgl-fx-default.json.gz"));
    if (id == "default" || !base.isObject())
        return base;
    const auto patch = juce::JSON::parse (embedded ("mgl-fx-" + id + ".patch.json.gz"));
    auto* list = patch.getArray();
    if (list == nullptr)
        return base;
    for (const auto& item : *list)
    {
        const auto parts = juce::StringArray::fromTokens (item[0].toString(), "/", "");
        if (parts.isEmpty())
            continue;
        juce::var at = base;
        for (int k = 0; k < parts.size() - 1 && !at.isVoid(); ++k)
            at = at.isArray() ? (at.getArray()->size() > parts[k].getIntValue() ? at[parts[k].getIntValue()] : juce::var()) : at[juce::Identifier (parts[k])];
        if (at.isVoid())
            continue;
        const auto& last = parts[parts.size() - 1];
        juce::var value = item[1];
        if (value.isObject() && value.hasProperty ("c"))
        {
            const auto was = at.isArray() ? at[last.getIntValue()].toString() : at[juce::Identifier (last)].toString();
            juce::String out;
            int from = 0, n = 0;
            auto* cols = value["c"].getArray();
            while (true)
            {
                const int a = was.indexOf (from, "rgb");
                if (a < 0 || cols == nullptr || n >= cols->size())
                    break;
                const int b = was.indexOfChar (a, ')');
                if (b < 0)
                    break;
                out << was.substring (from, a) << (*cols)[n++].toString();
                from = b + 1;
            }
            out << was.substring (from);
            value = out;
        }
        if (auto* arr = at.getArray())
        {
            const int i = last.getIntValue();
            if (i >= 0 && i < arr->size())
                arr->set (i, value);
        }
        else if (auto* o = at.getDynamicObject())
        {
            if (value.isVoid())
                o->removeProperty (juce::Identifier (last));
            else
                o->setProperty (juce::Identifier (last), value);
        }
    }
    return base;
}

Worn& wornState()
{
    static Worn w;
    return w;
}

juce::Colour cssToColour (const juce::String& s)
{
    // "rgb(r, g, b)" as computed styles give them.
    auto p = juce::StringArray::fromTokens (s.fromFirstOccurrenceOf ("(", false, false).upToFirstOccurrenceOf (")", false, false), ",", "");
    if (p.size() < 3)
        return juce::Colours::transparentBlack;
    return juce::Colour ((juce::uint8) p[0].trim().getIntValue(), (juce::uint8) p[1].trim().getIntValue(), (juce::uint8) p[2].trim().getIntValue(),
                         p.size() > 3 ? p[3].trim().getFloatValue() : 1.0f);
}
} // namespace

juce::String embeddedFile (const juce::String& file)
{
    return embedded (file);
}

const juce::var& page (const juce::String& name)
{
    if (name == "wave" && wornState().mgl.isObject())
        return wornState().mgl;
    if (name == "atmos")
    {
        auto& w = wornState();
        if (!w.atmos.isObject())
            w.atmos = juce::JSON::parse (embedded ("mgl-atmos-" + (w.choice >= 0 ? themeChoices()[(size_t) w.choice].mgl : juce::String ("default")) + ".json.gz"));
        if (!w.atmos.isObject())
            w.atmos = juce::JSON::parse (embedded ("mgl-atmos-default.json.gz"));
        return w.atmos;
    }
    if (name == "seq")
    {
        // Captured in MGL's main 3 themes (RJ, 25 Nov 2026); any other wears the default's.
        auto& w = wornState();
        if (!w.seq.isObject())
            w.seq = juce::JSON::parse (embedded ("mgl-seq-" + (w.choice >= 0 ? themeChoices()[(size_t) w.choice].mgl : juce::String ("default")) + ".json.gz"));
        if (!w.seq.isObject())
            w.seq = juce::JSON::parse (embedded ("mgl-seq-default.json.gz"));
        return w.seq;
    }
    if (name == "edit")
    {
        auto& w = wornState();
        if (!w.edit.isObject())
            w.edit = juce::JSON::parse (embedded ("mgl-edit-" + (w.choice >= 0 ? themeChoices()[(size_t) w.choice].mgl : juce::String ("default")) + ".json.gz"));
        if (!w.edit.isObject())
            w.edit = juce::JSON::parse (embedded ("mgl-edit-default.json.gz"));
        return w.edit;
    }
    // Wave's Create, Matrix and FX views, and the parts it builds
    // (capture-wave.mjs): { views: {create, matrix, fx}, parts: {...} }.
    if (name == "wave-views")
    {
        auto& w = wornState();
        if (!w.waveViews.isObject())
            w.waveViews = juce::JSON::parse (embedded ("mgl-wave-" + (w.choice >= 0 ? themeChoices()[(size_t) w.choice].mgl : juce::String ("default")) + ".json.gz"));
        if (!w.waveViews.isObject())
            w.waveViews = juce::JSON::parse (embedded ("mgl-wave-default.json.gz"));
        return w.waveViews;
    }
    if (name == "grain")
    {
        auto& w = wornState();
        if (!w.grain.isObject())
            w.grain = juce::JSON::parse (embedded ("mgl-grain-" + (w.choice >= 0 ? themeChoices()[(size_t) w.choice].mgl : juce::String ("default")) + ".json.gz"));
        if (!w.grain.isObject())
            w.grain = juce::JSON::parse (embedded ("mgl-grain-default.json.gz"));
        return w.grain;
    }
    if (name == "fx")
    {
        auto& w = wornState();
        if (!w.fx.isObject())
            w.fx = fxTheme (w.choice >= 0 ? themeChoices()[(size_t) w.choice].mgl : juce::String ("default"));
        return w.fx;
    }
    if (name == "prism")
    {
        auto& w = wornState();
        if (!w.prism.isObject())
            w.prism = juce::JSON::parse (embedded ("mgl-prism-" + (w.choice >= 0 ? themeChoices()[(size_t) w.choice].mgl : juce::String ("default")) + ".json.gz"));
        if (!w.prism.isObject())
            w.prism = juce::JSON::parse (embedded ("mgl-prism-default.json.gz"));
        return w.prism;
    }
    if (name == "browse" || name == "library")
    {
        // Captured in MGL's main three themes (RJ, 25 Nov): any other worn
        // theme wears the default's.
        auto& w = wornState();
        auto& slot = name == "browse" ? w.browse : w.library;
        if (!slot.isObject())
            slot = juce::JSON::parse (embedded ("mgl-" + name + "-" + (w.choice >= 0 ? themeChoices()[(size_t) w.choice].mgl : juce::String ("default")) + ".json.gz"));
        if (!slot.isObject())
            slot = juce::JSON::parse (embedded ("mgl-" + name + "-default.json.gz"));
        return slot;
    }
    if (name == "chop")
    {
        auto& w = wornState();
        if (!w.chop.isObject())
            w.chop = juce::JSON::parse (embedded ("mgl-chop-" + (w.choice >= 0 ? themeChoices()[(size_t) w.choice].mgl : juce::String ("default")) + ".json.gz"));
        if (!w.chop.isObject())
            w.chop = juce::JSON::parse (embedded ("mgl-chop-default.json.gz"));
        return w.chop;
    }
    static std::map<juce::String, juce::var> pages;
    auto it = pages.find (name);
    if (it == pages.end())
    {
        juce::var parsed;
        for (int i = 0; i < BinaryData::namedResourceListSize; ++i)
            if (juce::String (BinaryData::originalFilenames[i]) == name + ".json")
            {
                int size = 0;
                const char* data = BinaryData::getNamedResource (BinaryData::namedResourceList[i], size);
                parsed = juce::JSON::parse (juce::String::fromUTF8 (data, size));
            }
        it = pages.emplace (name, parsed).first;
    }
    return it->second;
}


const std::vector<ThemeChoice>& themeChoices()
{
    static const std::vector<ThemeChoice> list = [] {
        std::vector<ThemeChoice> out;
        const auto idm = juce::JSON::parse (embedded ("idmlab-themes.json"));
        const auto mgl = juce::JSON::parse (embedded ("mgl-themes.json"));
        auto mglFor = [&] (const juce::String& label) -> juce::String {
            if (auto* a = mgl.getArray())
                for (const auto& t : *a)
                    if (t["name"].toString().equalsIgnoreCase (label) && t["id"].toString() != "default")
                        return t["id"].toString();
            return {};
        };
        auto swatchOf = [] (const juce::var& colours) {
            juce::Array<juce::Colour> sw;
            if (auto* a = colours.getArray())
                for (const auto& c : *a)
                    sw.add (c.toString().startsWith ("rgb") ? cssToColour (c.toString()) : juce::Colour::fromString ("ff" + c.toString().removeCharacters ("#")));
            return sw;
        };
        int lightIndex = 0, darkIndex = 1;
        if (auto* a = idm.getArray())
            for (int i = 0; i < a->size(); ++i)
            {
                const auto& t = a->getReference (i);
                if (t["label"].toString() == "Light")
                    lightIndex = i;
                if (t["label"].toString() == "Dark")
                    darkIndex = i;
            }
        // idMLab's built-ins first, as its picker has them.
        if (auto* a = idm.getArray())
            for (int i = 0; i < a->size(); ++i)
            {
                const auto& t = a->getReference (i);
                if (t["group"].toString() != "Built in")
                    continue;
                const auto label = t["label"].toString();
                out.push_back ({ "Built in", label, t["blurb"].toString(), swatchOf (t["swatch"]), i, label == "Light" ? juce::String ("studio-light") : juce::String ("default") });
            }
        // MGL's own looks: its pages' themes, on idMLab's Dark (Light for Studio light).
        if (auto* a = mgl.getArray())
            for (const auto& t : *a)
            {
                const auto id = t["id"].toString();
                const bool look = t["look"].isString() || id == "default" || id == "studio-light" || id == "mid-grey" || id == "layered-dark" || id == "conifer" || id == "facets";
                if (!look || (id.startsWith ("look-") && id == "look-ad"))
                    continue;
                // The default lists no colours; its Look twin does.
                juce::var colours = t["colors"];
                if (!colours.isArray())
                    if (auto* all = mgl.getArray())
                        for (const auto& twin : *all)
                            if (twin["look"].toString() == t["look"].toString() && twin["colors"].isArray())
                                colours = twin["colors"];
                out.push_back ({ "MultiGrainLive", t["name"].toString(), "MGL's own look", swatchOf (colours), id == "studio-light" ? lightIndex : darkIndex, id });
            }
        // Then idMLab's palettes, each with its MGL twin where MGL has one.
        if (auto* a = idm.getArray())
            for (int i = 0; i < a->size(); ++i)
            {
                const auto& t = a->getReference (i);
                if (t["group"].toString() == "Built in")
                    continue;
                const auto twin = mglFor (t["label"].toString());
                out.push_back ({ t["group"].toString(), t["label"].toString(), t["blurb"].toString(), swatchOf (t["swatch"]), i, twin.isEmpty() ? juce::String ("default") : twin });
            }
        return out;
    }();
    return list;
}

const std::vector<std::pair<juce::String, juce::String>>& kits()
{
    static const std::vector<std::pair<juce::String, juce::String>> list {
        { "vintage", "Vintage Wood" }, { "eurorack", "Eurorack White" }, { "thinRing", "Thin Ring" },
        { "flatModern", "Flat Modern" }, { "lineArt", "Line Art" }, { "lcd", "Hardware LCD" },
    };
    return list;
}

void wear (int choice, const juce::String& kit)
{
    auto& w = wornState();
    const auto& list = themeChoices();
    if (choice < 0 || choice >= (int) list.size())
        return;
    if (choice != w.choice)
    {
        const auto& c = list[(size_t) choice];
        w.idmlab = juce::JSON::parse (embedded ("idmlab-theme-" + juce::String (c.idmlab) + ".json.gz"));
        w.mgl = juce::JSON::parse (embedded ("mgl-theme-" + c.mgl + ".json.gz"));
        w.atmos = juce::var();
        w.seq = juce::var();
        w.edit = juce::var();
        w.waveViews = juce::var();
        w.grain = juce::var();
        w.chop = juce::var();
        w.prism = juce::var();
        w.fx = juce::var();
        w.browse = juce::var();
        w.library = juce::var();
        w.choice = choice;
    }
    w.kit = kit.isEmpty() ? juce::String ("thinRing") : kit;
    ++w.stamp;
}

int worn() { return wornState().choice; }
const juce::String& wornKit() { return wornState().kit; }
int stamp() { return wornState().stamp; }

const juce::var& part (const juce::String& name)
{
    auto& w = wornState();
    if (w.idmlab.isObject())
    {
        static const std::map<juce::String, juce::String> field {
            { "idmlab-bar", "bar" }, { "idmlab-status", "status" }, { "idmlab-node-audio", "nodeAudio" },
            { "idmlab-menu", "menu" }, { "idmlab-style", "style" },
        };
        if (auto it = field.find (name); it != field.end())
        {
            const auto& v = w.idmlab[juce::Identifier (it->second)];
            if (!v.isVoid())
                return v;
        }
    }
    return page (name);
}

const juce::var* jack (const juce::String& type, bool isInput)
{
    auto& w = wornState();
    if (!w.idmlab.isObject())
        return nullptr;
    const auto& set = w.idmlab["jacks"][juce::Identifier (w.kit)];
    const auto& one = set[type == "audio" ? "audioIn" : isInput ? "noteIn" : "noteOut"];
    return one.isObject() ? &one["tree"] : nullptr;
}

const juce::var* find (const juce::var& tree, const juce::String& cls)
{
    if (tree["tag"].toString() == cls || juce::StringArray::fromTokens (tree["cls"].toString(), " ", "").contains (cls))
        return &tree;
    if (auto* kids = tree["kids"].getArray())
        for (const auto& k : *kids)
            if (auto* hit = find (k, cls))
                return hit;
    return nullptr;
}

void paintText (juce::Graphics& g, const juce::var& n, juce::Rectangle<float> r, const juce::String& text, juce::Justification just)
{
    auto* runs = n["text"].getArray();
    if (runs == nullptr || runs->isEmpty())
        return;
    const auto& f = runs->getReference (0)["font"];
    const auto ft = font (f);
    g.setFont (ft);
    g.setColour (colour (f["colour"]));
    const float w = juce::GlyphArrangement::getStringWidth (ft, text);
    float x = r.getX();
    if (just.testFlags (juce::Justification::horizontallyCentred))
        x = r.getCentreX() - w / 2;
    else if (just.testFlags (juce::Justification::right))
        x = r.getRight() - w;
    const float baseline = r.getCentreY() + (ft.getAscent() - ft.getDescent()) / 2;
    juce::GlyphArrangement glyphs;
    glyphs.addLineOfText (ft, text, x, baseline);
    glyphs.draw (g);
}

juce::Path box (const juce::Rectangle<float>& r, const juce::var& radius, float inset)
{
    juce::Path p;
    const auto b = r.reduced (inset);
    if (!radius.isArray())
    {
        p.addRectangle (b);
        return p;
    }
    auto corner = [&] (int i) { return juce::jmax (0.0f, juce::jmin (num (radius[i]) - inset, b.getWidth() / 2, b.getHeight() / 2)); };
    p.addRoundedRectangle (b.getX(), b.getY(), b.getWidth(), b.getHeight(), corner (0), corner (0), true, true, true, true);
    // Corners differ: draw it properly.
    const float tl = corner (0), tr = corner (1), br = corner (2), bl = corner (3);
    if (std::abs (tl - tr) + std::abs (tl - br) + std::abs (tl - bl) > 0.01f)
    {
        p.clear();
        const float x = b.getX(), y = b.getY(), w = b.getWidth(), h = b.getHeight();
        const float k = 0.5523f;
        p.startNewSubPath (x + tl, y);
        p.lineTo (x + w - tr, y);
        p.cubicTo (x + w - tr + tr * k, y, x + w, y + tr - tr * k, x + w, y + tr);
        p.lineTo (x + w, y + h - br);
        p.cubicTo (x + w, y + h - br + br * k, x + w - br + br * k, y + h, x + w - br, y + h);
        p.lineTo (x + bl, y + h);
        p.cubicTo (x + bl - bl * k, y + h, x, y + h - bl + bl * k, x, y + h - bl);
        p.lineTo (x, y + tl);
        p.cubicTo (x, y + tl - tl * k, x + tl - tl * k, y, x + tl, y);
        p.closeSubPath();
    }
    return p;
}

void fillLayer (juce::Graphics& g, const juce::var& layer, juce::Rectangle<float> r, const juce::Path& shape)
{
    const auto type = layer["type"].toString();
    auto* stops = layer["stops"].getArray();
    if (stops == nullptr || stops->isEmpty() || (type != "linear" && type != "radial"))
        return;

    juce::ColourGradient grad;
    juce::AffineTransform t;
    float rayLength = 1.0f;
    if (type == "linear")
    {
        const float a = juce::degreesToRadians (num (layer["angle"], 180.0f));
        const juce::Point<float> dir (std::sin (a), -std::cos (a));
        rayLength = std::abs (r.getWidth() * std::sin (a)) + std::abs (r.getHeight() * std::cos (a));
        const auto c = r.getCentre();
        grad = juce::ColourGradient (juce::Colours::black, c - dir * (rayLength / 2), juce::Colours::black, c + dir * (rayLength / 2), false);
    }
    else
    {
        const auto at = layer["at"];
        const float cx = r.getX() + length (at[0], r.getWidth(), r.getWidth() / 2);
        const float cy = r.getY() + length (at.size() > 1 ? at[1] : juce::var ("center"), r.getHeight(), r.getHeight() / 2);
        const float fx = juce::jmax (cx - r.getX(), r.getRight() - cx), fy = juce::jmax (cy - r.getY(), r.getBottom() - cy);
        float rx = fx * 1.41421356f, ry = fy * 1.41421356f;
        const auto size = layer["size"];
        if (size.size() >= 1 && size[0].toString().containsAnyOf ("0123456789"))
        {
            rx = length (size[0], r.getWidth(), rx);
            ry = size.size() > 1 ? length (size[1], r.getHeight(), ry) : rx;
        }
        else if (size.size() >= 1 && size[0].toString() == "closest-side")
            rx = juce::jmin (cx - r.getX(), r.getRight() - cx), ry = juce::jmin (cy - r.getY(), r.getBottom() - cy);
        else if (size.size() >= 1 && size[0].toString() == "farthest-side")
            rx = fx, ry = fy;
        if (layer["shape"].toString() == "circle")
            rx = ry = (size.size() >= 1 && size[0].toString().containsAnyOf ("0123456789")) ? rx : std::hypot (fx, fy);
        rx = juce::jmax (rx, 0.01f);
        ry = juce::jmax (ry, 0.01f);
        rayLength = rx;
        grad = juce::ColourGradient (juce::Colours::black, { cx, cy }, juce::Colours::black, { cx + rx, cy }, true);
        t = juce::AffineTransform::scale (1.0f, ry / rx, cx, cy);
    }

    // The stops: positions as fractions of the ray; missing ones spread evenly.
    const int n = stops->size();
    std::vector<float> at ((size_t) n, -1.0f);
    for (int i = 0; i < n; ++i)
    {
        const auto& s = stops->getReference (i);
        if (!s["at"].isVoid() && !s["at"].isUndefined())
            at[(size_t) i] = length (s["at"], 1.0f, -1.0f) / (s["at"].toString().endsWith ("%") ? 1.0f : rayLength);
    }
    if (at.front() < 0.0f)
        at.front() = 0.0f;
    if (at.back() < 0.0f)
        at.back() = 1.0f;
    for (int i = 1; i < n - 1; ++i)
    {
        if (at[(size_t) i] >= 0.0f)
            continue;
        int j = i;
        while (at[(size_t) j] < 0.0f)
            ++j;
        const float a = at[(size_t) i - 1], b = at[(size_t) j];
        for (int k = i; k < j; ++k)
            at[(size_t) k] = a + (b - a) * (float) (k - i + 1) / (float) (j - i + 1);
    }
    for (int i = 1; i < n; ++i)
        at[(size_t) i] = juce::jmax (at[(size_t) i], at[(size_t) i - 1]);
    grad.clearColours();
    const auto first = colour (stops->getReference (0)["colour"]), last = colour (stops->getReference (n - 1)["colour"]);
    if (at.front() > 0.0f)
        grad.addColour (0.0, first);
    for (int i = 0; i < n; ++i)
        grad.addColour (juce::jlimit (0.0, 1.0, (double) at[(size_t) i]), colour (stops->getReference (i)["colour"]));
    if (at.back() < 1.0f)
        grad.addColour (1.0, last);

    g.setFillType (juce::FillType (grad).transformed (t));
    g.fillPath (shape);
}

// ─────────────────────────────────────────────────────────────── Chrome

Chrome::Chrome (const juce::var& c) : captured (c)
{
    setSize ((int) c["size"][0], (int) c["size"][1]);
    setInterceptsMouseClicks (false, false);
    index (captured["tree"]);
    setOpaque (true);
}

void Chrome::index (const juce::var& n)
{
    nodes[(int) n["i"]] = n;
    if (n["canvas"].isString())
        canvases[n["canvas"].toString()] = n;
    if (n["svg"].isString())
        svgs[(int) n["i"]] = juce::Drawable::createFromSVGString (n["svg"].toString());
    if (auto* kids = n["kids"].getArray())
        for (const auto& k : *kids)
            index (k);
}

void Chrome::paint (juce::Graphics& g)
{
    // Sharp on a 2x screen at 100% and below; drawn once, then only moved.
    // On a 2x screen at 2x from the start, even zoomed out: drawn then, it
    // would be drawn again whole the first time a zoom came past halfway
    // (half a second for a big page, in the middle of the zoom).
    const auto* display = juce::Desktop::getInstance().getDisplays().getPrimaryDisplay();
    const bool dense = g.getInternalContext().getPhysicalPixelScaleFactor() > 1.01f || (display != nullptr && display->scale > 1.01);
    const float want = dense ? 2.0f : 1.0f;
    if (!cached.isValid() || want > cachedScale)
    {
        cachedScale = want;
        cached = juce::Image (juce::Image::ARGB, (int) std::ceil ((float) getWidth() * want), (int) std::ceil ((float) getHeight() * want), true);
        juce::Graphics cg (cached);
        cg.addTransform (juce::AffineTransform::scale (want));
        paintLook (cg);
    }
    g.setImageResamplingQuality (juce::Graphics::highResamplingQuality);
    g.drawImageTransformed (cached, juce::AffineTransform::scale (1.0f / cachedScale));
}

void Chrome::redraw (juce::Rectangle<float> area)
{
    if (cached.isValid())
    {
        const auto px = (area * cachedScale).getSmallestIntegerContainer().expanded (2);
        juce::Graphics cg (cached);
        cg.reduceClipRegion (px);
        cg.setColour (juce::Colours::transparentBlack);
        cg.getInternalContext().fillRect (px, true);
        cg.addTransform (juce::AffineTransform::scale (cachedScale));
        paintLook (cg);
    }
    repaint (area.getSmallestIntegerContainer().expanded (1));
}

void Chrome::paintLook (juce::Graphics& g)
{
    const auto& back = captured["backdrop"];
    const auto all = getLocalBounds().toFloat();
    juce::Path whole;
    whole.addRectangle (all);
    if (back["bg"].isArray())
        g.fillAll (colour (back["bg"]));
    if (auto* layers = back["layers"].getArray())
        for (int i = layers->size(); --i >= 0;)
            fillLayer (g, layers->getReference (i), all, whole);
    drawNode (g, captured["tree"]);
}

void Chrome::drawBox (juce::Graphics& g, const juce::var& n, juce::Rectangle<float> r)
{
    paintBox (g, n, r);
}

void paintBox (juce::Graphics& g, const juce::var& n, juce::Rectangle<float> r)
{
    const auto outline = box (r, n["radius"]);

    // Outer shadows, under the box.
    if (auto* shadows = n["shadows"].getArray())
        for (int i = shadows->size(); --i >= 0;)
        {
            const auto& s = shadows->getReference (i);
            if ((bool) s["inset"])
                continue;
            const float spread = num (s["spread"]);
            auto p = box (r.expanded (spread), n["radius"].isArray() ? n["radius"] : juce::var(), 0.0f);
            p.applyTransform (juce::AffineTransform::translation (num (s["x"]), num (s["y"])));
            const float blur = num (s["blur"]);
            if (blur < 0.5f)
            {
                g.setColour (colour (s["colour"]));
                g.fillPath (p);
            }
            else
                juce::DropShadow (colour (s["colour"]), juce::roundToInt (blur), {}).drawForPath (g, p);
        }

    // The fill: the colour, then the layers, the first on top.
    if (n["bg"].isArray())
    {
        g.setColour (colour (n["bg"]));
        g.fillPath (outline);
    }
    if (auto* layers = n["layers"].getArray())
        for (int i = layers->size(); --i >= 0;)
            fillLayer (g, layers->getReference (i), r, outline);

    // Inset shadows, inside the box.
    if (auto* shadows = n["shadows"].getArray())
    {
        for (int i = shadows->size(); --i >= 0;)
        {
            const auto& s = shadows->getReference (i);
            if (!(bool) s["inset"])
                continue;
            juce::Graphics::ScopedSaveState keep (g);
            g.reduceClipRegion (outline);
            const float spread = num (s["spread"]), blur = num (s["blur"]);
            juce::Path hole;
            hole.addRectangle (r.expanded (blur * 2 + 40));
            auto inner = box (r.reduced (spread), n["radius"]);
            inner.applyTransform (juce::AffineTransform::translation (num (s["x"]), num (s["y"])));
            hole.addPath (inner);
            hole.setUsingNonZeroWinding (false);
            if (blur < 0.5f)
            {
                g.setColour (colour (s["colour"]));
                g.fillPath (hole);
            }
            else
                juce::DropShadow (colour (s["colour"]), juce::roundToInt (blur), {}).drawForPath (g, hole);
        }
    }

    // The border.
    if (auto* sides = n["border"].getArray())
    {
        const auto& t = sides->getReference (0);
        bool same = true;
        for (const auto& s : *sides)
            same = same && s.isObject() && t.isObject() && std::abs (num (s["w"]) - num (t["w"])) < 0.01f && s["colour"] == t["colour"];
        if (same && t.isObject())
        {
            const float w = num (t["w"]);
            g.setColour (colour (t["colour"]));
            g.strokePath (box (r, n["radius"], w / 2), juce::PathStrokeType (w));
        }
        else
        {
            for (int s = 0; s < 4; ++s)
            {
                const auto& side = sides->getReference (s);
                if (!side.isObject())
                    continue;
                const float w = num (side["w"]);
                g.setColour (colour (side["colour"]));
                juce::Rectangle<float> strip = s == 0   ? r.withHeight (w)
                                               : s == 1 ? r.withLeft (r.getRight() - w)
                                               : s == 2 ? r.withTop (r.getBottom() - w)
                                                        : r.withWidth (w);
                g.fillRect (strip);
            }
        }
    }
}

void Chrome::drawText (juce::Graphics& g, const juce::var& n, const juce::var* look)
{
    auto* runs = n["text"].getArray();
    if (runs == nullptr || skipText.count ((int) n["i"]) > 0)
        return;
    auto* lookRuns = look != nullptr ? (*look)["text"].getArray() : nullptr;
    for (int k = 0; k < runs->size(); ++k)
    {
        const auto& run = runs->getReference (k);
        const auto f = font (run["font"]);
        const auto r = rectOf (run["rect"]);
        g.setFont (f);
        const auto& tint = lookRuns != nullptr && lookRuns->size() > 0 ? lookRuns->getReference (juce::jmin (k, lookRuns->size() - 1)) : run;
        g.setColour (colour (tint["font"]["colour"]));
        if (run["turn"].isInt() || run["turn"].isDouble())
        {
            // A side label: the words turned, centred on their box.
            juce::Graphics::ScopedSaveState keep (g);
            const float turn = juce::degreesToRadians ((float) (double) run["turn"]);
            g.addTransform (juce::AffineTransform::rotation (turn, r.getCentreX(), r.getCentreY()));
            const auto text = run["text"].toString();
            const float w = juce::GlyphArrangement::getStringWidth (f, text);
            juce::GlyphArrangement glyphs;
            glyphs.addLineOfText (f, text, r.getCentreX() - w / 2, r.getCentreY() + (f.getAscent() - f.getDescent()) / 2);
            glyphs.draw (g);
            continue;
        }
        // The browser's text box is the font's ascent over its descent; the
        // baseline sits that far down it.
        const float baseline = r.getY() + (r.getHeight() - (f.getAscent() + f.getDescent())) / 2.0f + f.getAscent();
        auto text = run["text"].toString();
        float width = r.getWidth();
        // Cut short with an ellipsis where the page does (text-overflow), to its box.
        const auto box = rectOf (n["rect"]);
        if ((bool) run["font"]["ellipsis"] && r.getRight() > box.getRight() + 0.5f)
        {
            const auto dots = juce::String::fromUTF8 ("\xe2\x80\xa6");
            const float room = box.getRight() - r.getX();
            while (text.isNotEmpty() && juce::GlyphArrangement::getStringWidth (f, text + dots) > room)
                text = text.dropLastCharacters (1);
            text = text.trimEnd() + dots;
            width = juce::GlyphArrangement::getStringWidth (f, text);
        }
        juce::GlyphArrangement glyphs;
        glyphs.addLineOfText (f, text, r.getX(), baseline);
        // The width the browser gave it: the Mac's fonts are not quite the page's.
        const float drawn = juce::GlyphArrangement::getStringWidth (f, text);
        if (drawn > 1.0f && width > 1.0f && std::abs (drawn - width) > 0.5f && std::abs (drawn - width) < drawn * 0.2f)
        {
            juce::Graphics::ScopedSaveState keep (g);
            g.addTransform (juce::AffineTransform::scale (width / drawn, 1.0f, r.getX(), baseline));
            glyphs.draw (g);
        }
        else
            glyphs.draw (g);
    }
}

namespace
{
// The first stroke or fill colour an SVG's markup gives, as drawn.
juce::Colour firstColour (const juce::String& svg)
{
    for (auto attr : { "stroke=\"rgba(", "fill=\"rgba(" })
    {
        const int at = svg.indexOf (attr);
        if (at < 0)
            continue;
        const auto body = svg.substring (at + (int) std::strlen (attr)).upToFirstOccurrenceOf (")", false, false);
        auto p = juce::StringArray::fromTokens (body, ",", "");
        if (p.size() == 4)
            return juce::Colour ((juce::uint8) p[0].getIntValue(), (juce::uint8) p[1].getIntValue(), (juce::uint8) p[2].getIntValue(), p[3].getFloatValue());
    }
    return juce::Colours::transparentBlack;
}
} // namespace

void Chrome::drawPart (juce::Graphics& g, const juce::var& node, juce::Point<float> offset, float opacity, const std::set<int>* without)
{
    drawPart (g, node, offset, opacity, without, nullptr);
}

void Chrome::drawPart (juce::Graphics& g, const juce::var& node, juce::Point<float> offset, float opacity, const std::set<int>* without, const std::set<int>* withoutText)
{
    juce::Graphics::ScopedSaveState keep (g);
    g.addTransform (juce::AffineTransform::translation (offset));
    if (opacity < 1.0f)
        g.beginTransparencyLayer (opacity);
    auto savedSkip = std::move (skip);
    auto savedText = std::move (skipText);
    skip = without != nullptr ? *without : std::set<int>();
    skipText = withoutText != nullptr ? *withoutText : std::set<int>();
    drawNode (g, node);
    skip = std::move (savedSkip);
    skipText = std::move (savedText);
    if (opacity < 1.0f)
        g.endTransparencyLayer();
}

void Chrome::drawNode (juce::Graphics& g, const juce::var& n, const juce::var* look)
{
    const int i = (int) n["i"];
    if (skip.count (i) > 0)
        return;
    // A switch drawn lit or not: its look from another of the page's own.
    if (look == nullptr)
        if (auto it = styleFrom.find (i); it != styleFrom.end())
            if (auto jt = nodes.find (it->second); jt != nodes.end())
                look = &jt->second;
    const auto& style = look != nullptr ? *look : n;
    const auto r = rectOf (n["rect"]);
    // Nothing of this node (its shadows reach about 40 px) is being drawn.
    if (!g.getClipBounds().toFloat().intersects (r.expanded (48.0f)) && !(bool) n["clip"] && n["kids"].isVoid())
        return;
    auto forced = opacityOf.find (i);
    const float opacity = forced != opacityOf.end() ? forced->second : num (style["opacity"], 1.0f);
    if (opacity <= 0.001f)
        return;
    juce::Graphics::ScopedSaveState keep (g);
    if (opacity < 1.0f)
        g.beginTransparencyLayer (opacity);

    {
        // The look's fill and border, on this node's place and corners.
        juce::var box = style;
        if (look != nullptr)
            if (auto* o = box.getDynamicObject())
            {
                auto copy = o->clone();
                copy->setProperty ("rect", n["rect"]);
                box = juce::var (copy.release());
            }
        drawBox (g, box, r);
    }

    if (auto it = svgs.find (i); it != svgs.end() && it->second != nullptr)
    {
        auto* drawable = it->second.get();
        if (look != nullptr && (*look)["svg"].isString())
        {
            const int j = (int) (*look)["i"];
            auto& slot = recoloured[{ i, j }];
            if (slot == nullptr)
            {
                slot = drawable->createCopy();
                slot->replaceColour (firstColour (n["svg"].toString()), firstColour ((*look)["svg"].toString()));
            }
            drawable = slot.get();
        }
        // Its own box (the SVG's width and height), not the bounds of what is
        // drawn in it: an icon that leaves room round its strokes keeps it.
        auto* composite = dynamic_cast<juce::DrawableComposite*> (drawable);
        const auto area = composite != nullptr ? composite->getContentArea() : juce::Rectangle<float>();
        if (!area.isEmpty())
            drawable->draw (g, 1.0f, juce::RectanglePlacement (juce::RectanglePlacement::stretchToFit).getTransformToFit (area, r));
        else
            drawable->drawWithin (g, r, juce::RectanglePlacement::stretchToFit, 1.0f);
    }

    if (n["select"].isObject())
    {
        auto* options = n["select"]["options"].getArray();
        int chosen = (int) n["select"]["value"];
        if (auto it = selectValue.find (i); it != selectValue.end())
            chosen = it->second;
        if (options != nullptr && chosen >= 0 && chosen < options->size())
        {
            const auto f = font (n["font"]);
            g.setFont (f);
            g.setColour (colour (n["font"]["colour"]));
            g.drawText (options->getReference (chosen).toString(), r.reduced (8.0f, 0.0f), juce::Justification::centredLeft, false);
        }
        // The chevron the stylesheet paints as its background image
        // (`select`: a 10 x 6 "M1 1l4 4 4-4", #858b94, 1.5 wide, 8 px from
        // the right, centred), which the capture keeps only as "an image".
        bool image = false;
        if (auto* layers = n["layers"].getArray())
            for (const auto& l : *layers)
                image = image || l["type"].toString() == "image";
        if (image)
        {
            const float x = r.getRight() - 8.0f - 10.0f, y = r.getCentreY() - 3.0f;
            juce::Path chevron;
            chevron.startNewSubPath (x + 1, y + 1);
            chevron.lineTo (x + 5, y + 5);
            chevron.lineTo (x + 9, y + 1);
            g.setColour (juce::Colour (0xff858b94));
            g.strokePath (chevron, juce::PathStrokeType (1.5f));
        }
    }

    if ((bool) n["clip"])
        g.reduceClipRegion (box (r, n["radius"]));
    drawText (g, n, look);
    if (auto* kids = n["kids"].getArray())
    {
        auto* lookKids = look != nullptr ? (*look)["kids"].getArray() : nullptr;
        for (int k = 0; k < kids->size(); ++k)
        {
            const juce::var* kidLook = lookKids != nullptr && k < lookKids->size() ? &lookKids->getReference (k) : nullptr;
            drawNode (g, kids->getReference (k), kidLook);
        }
    }

    if (opacity < 1.0f)
        g.endTransparencyLayer();
}
} // namespace face
