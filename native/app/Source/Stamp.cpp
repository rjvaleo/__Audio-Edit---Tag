#include "Stamp.h"

namespace face
{
namespace
{
float num (const juce::var& v, float fallback = 0.0f)
{
    return v.isVoid() || v.isUndefined() ? fallback : (float) (double) v;
}

juce::Rectangle<float> box4 (const juce::var& r)
{
    return { num (r[0]), num (r[1]), num (r[2]), num (r[3]) };
}

// The first stroke or fill colour an SVG's markup gives.
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

juce::Rectangle<float> rectOf (const juce::var& n)
{
    return box4 (n["rect"]);
}

juce::Drawable* svgFor (const juce::String& markup)
{
    static std::map<juce::String, std::unique_ptr<juce::Drawable>> made;
    auto& d = made[markup];
    if (d == nullptr)
        d = juce::Drawable::createFromSVGString (markup);
    return d.get();
}

void drawIcon (juce::Graphics& g, const juce::var& n, const juce::String& d, juce::Point<float> offset)
{
    auto markup = n["svg"].toString();
    const int at = markup.indexOf ("<path");
    if (at < 0)
        return;
    const int dAt = markup.indexOf (at, " d=\"");
    if (dAt >= 0)
    {
        const int end = markup.indexOf (dAt + 4, "\"");
        markup = markup.substring (0, dAt + 4) + d + markup.substring (end);
    }
    else
        markup = markup.substring (0, at + 5) + " d=\"" + d + "\"" + markup.substring (at + 5);
    auto* dr = svgFor (markup);
    if (dr == nullptr)
        return;
    const auto r = rectOf (n) + offset;
    auto* composite = dynamic_cast<juce::DrawableComposite*> (dr);
    const auto area = composite != nullptr ? composite->getContentArea() : juce::Rectangle<float>();
    if (!area.isEmpty())
        dr->draw (g, 1.0f, juce::RectanglePlacement (juce::RectanglePlacement::centred).getTransformToFit (area, r));
    else
        dr->drawWithin (g, r, juce::RectanglePlacement::centred, 1.0f);
}

bool matches (const juce::var& n, const juce::String& what)
{
    if (what.startsWith ("#"))
        return n["id"].toString() == what.substring (1);
    if (what.startsWith ("data-"))
    {
        const auto k = what.fromFirstOccurrenceOf ("data-", false, false).upToFirstOccurrenceOf ("=", false, false);
        // data-foo-bar is dataset.fooBar.
        juce::String key;
        bool up = false;
        for (auto c : k)
        {
            if (c == '-')
            {
                up = true;
                continue;
            }
            key += up ? juce::CharacterFunctions::toUpperCase (c) : c;
            up = false;
        }
        const auto& v = n["data"][juce::Identifier (key)];
        if (v.isVoid())
            return false;
        return !what.containsChar ('=') || v.toString() == what.fromFirstOccurrenceOf ("=", false, false);
    }
    return juce::StringArray::fromTokens (n["cls"].toString(), " ", "").contains (what) || n["tag"].toString() == what;
}

const juce::var* findNode (const juce::var& tree, const juce::String& what)
{
    if (matches (tree, what))
        return &tree;
    if (auto* kids = tree["kids"].getArray())
        for (const auto& k : *kids)
            if (auto* hit = findNode (k, what))
                return hit;
    return nullptr;
}

juce::Array<const juce::var*> findAll (const juce::var& tree, const juce::String& what)
{
    juce::Array<const juce::var*> out;
    std::function<void (const juce::var&)> go = [&] (const juce::var& n) {
        if (matches (n, what))
            out.add (&n);
        if (auto* kids = n["kids"].getArray())
            for (const auto& k : *kids)
                go (k);
    };
    go (tree);
    return out;
}

void Stamp::draw (juce::Graphics& g, const juce::var& tree, juce::Point<float> offset) const
{
    juce::Graphics::ScopedSaveState keep (g);
    g.addTransform (juce::AffineTransform::translation (offset.x, offset.y));
    node (g, tree, nullptr);
}

void Stamp::node (juce::Graphics& g, const juce::var& n, const juce::var* lookIn) const
{
    if (skip && skip (n))
        return;
    const juce::var* worn = lookIn;
    if (worn == nullptr && look)
        worn = look (n);
    const auto& style = worn != nullptr ? *worn : n;
    const auto r = rectOf (n);
    const float opacity = num (style["opacity"], 1.0f);
    if (opacity <= 0.001f)
        return;
    juce::Graphics::ScopedSaveState keep (g);
    if (opacity < 1.0f)
        g.beginTransparencyLayer (opacity);
    paintBox (g, style, r);
    if (n["svg"].isString())
    {
        auto* d = svgFor (n["svg"].toString());
        std::unique_ptr<juce::Drawable> recoloured;
        juce::Colour inked;
        if (d != nullptr && ink && ink (n, inked))
        {
            recoloured = d->createCopy();
            recoloured->replaceColour (firstColour (n["svg"].toString()), inked);
            d = recoloured.get();
        }
        else if (d != nullptr && worn != nullptr && (*worn)["svg"].isString())
        {
            recoloured = d->createCopy();
            recoloured->replaceColour (firstColour (n["svg"].toString()), firstColour ((*worn)["svg"].toString()));
            d = recoloured.get();
        }
        if (d != nullptr)
        {
            auto* composite = dynamic_cast<juce::DrawableComposite*> (d);
            const auto area = composite != nullptr ? composite->getContentArea() : juce::Rectangle<float>();
            if (!area.isEmpty())
                d->draw (g, 1.0f, juce::RectanglePlacement (juce::RectanglePlacement::stretchToFit).getTransformToFit (area, r));
            else
                d->drawWithin (g, r, juce::RectanglePlacement::stretchToFit, 1.0f);
        }
    }
    if ((bool) n["clip"])
        g.reduceClipRegion (box (r, n["radius"]));
    words (g, n, worn);
    if (auto* kids = n["kids"].getArray())
    {
        auto* lookKids = worn != nullptr ? (*worn)["kids"].getArray() : nullptr;
        for (int k = 0; k < kids->size(); ++k)
            node (g, kids->getReference (k), lookKids != nullptr && k < lookKids->size() ? &lookKids->getReference (k) : nullptr);
    }
    if (after)
        after (g, n, r);
    if (opacity < 1.0f)
        g.endTransparencyLayer();
}

void Stamp::words (juce::Graphics& g, const juce::var& n, const juce::var* worn) const
{
    auto* runs = n["text"].getArray();
    if (runs == nullptr || runs->isEmpty())
        return;
    auto* lookRuns = worn != nullptr ? (*worn)["text"].getArray() : nullptr;
    juce::String own;
    const bool replaced = text && text (n, own);
    for (int k = 0; k < runs->size(); ++k)
    {
        if (replaced && k > 0)
            break;
        const auto& run = runs->getReference (k);
        const auto f = font (run["font"]);
        const auto r = box4 (run["rect"]);
        const auto& tint = lookRuns != nullptr && lookRuns->size() > 0 ? lookRuns->getReference (juce::jmin (k, lookRuns->size() - 1)) : run;
        g.setFont (f);
        juce::Colour inked;
        g.setColour (ink && ink (n, inked) ? inked : colour (tint["font"]["colour"]));
        auto words = replaced ? own : run["text"].toString();
        if (words.isEmpty())
            continue;
        const float baseline = r.getY() + (r.getHeight() - (f.getAscent() + f.getDescent())) / 2.0f + f.getAscent();
        const float w = juce::GlyphArrangement::getStringWidth (f, words);
        const auto align = run["font"]["align"].toString();
        // New words sit as the captured ones did: from the left, centred or
        // from the right of where those were, inside the node.
        float x = r.getX();
        if (replaced)
        {
            const auto nb = rectOf (n);
            if (align == "center")
                x = r.getCentreX() - w / 2;
            else if (align == "right" || align == "end")
                x = r.getRight() - w;
            if ((bool) run["font"]["ellipsis"] && x + w > nb.getRight() + 0.5f)
            {
                const auto dots = juce::String::fromUTF8 ("\xe2\x80\xa6");
                while (words.isNotEmpty() && juce::GlyphArrangement::getStringWidth (f, words + dots) > nb.getRight() - x)
                    words = words.dropLastCharacters (1);
                words = words.trimEnd() + dots;
            }
        }
        juce::GlyphArrangement glyphs;
        glyphs.addLineOfText (f, words, x, baseline);
        const float drawn = juce::GlyphArrangement::getStringWidth (f, words);
        if (!replaced && drawn > 1.0f && r.getWidth() > 1.0f && std::abs (drawn - r.getWidth()) > 0.5f && std::abs (drawn - r.getWidth()) < drawn * 0.2f)
        {
            juce::Graphics::ScopedSaveState keep (g);
            g.addTransform (juce::AffineTransform::scale (r.getWidth() / drawn, 1.0f, r.getX(), baseline));
            glyphs.draw (g);
        }
        else
            glyphs.draw (g);
    }
}
} // namespace face
