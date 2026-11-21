#include "Canvas2D.h"

#include "Face.h"

namespace c2d
{
namespace
{
float hue2rgb (float p, float q, float t)
{
    if (t < 0)
        t += 1;
    if (t > 1)
        t -= 1;
    if (t < 1.0f / 6)
        return p + (q - p) * 6 * t;
    if (t < 0.5f)
        return q;
    if (t < 2.0f / 3)
        return p + (q - p) * (2.0f / 3 - t) * 6;
    return p;
}

juce::Colour fromHsl (float h, float s, float l, float a)
{
    h = std::fmod (std::fmod (h, 360.0f) + 360.0f, 360.0f) / 360.0f;
    float r, g, b;
    if (s <= 0)
        r = g = b = l;
    else
    {
        const float q = l < 0.5f ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
        r = hue2rgb (p, q, h + 1.0f / 3);
        g = hue2rgb (p, q, h);
        b = hue2rgb (p, q, h - 1.0f / 3);
    }
    return juce::Colour::fromFloatRGBA (r, g, b, juce::jlimit (0.0f, 1.0f, a));
}

juce::StringArray args (const juce::String& s)
{
    auto inner = s.fromFirstOccurrenceOf ("(", false, false).upToLastOccurrenceOf (")", false, false);
    inner = inner.replace ("/", ",");
    auto parts = juce::StringArray::fromTokens (inner, ", ", "");
    parts.removeEmptyStrings();
    return parts;
}

float channel (const juce::String& v, float scale)
{
    return v.endsWith ("%") ? v.getFloatValue() / 100.0f * scale : v.getFloatValue();
}
} // namespace

juce::Colour css (const juce::String& raw)
{
    const auto s = raw.trim().toLowerCase();
    if (s.isEmpty() || s == "transparent" || s == "none")
        return juce::Colours::transparentBlack;
    if (s.startsWith ("#"))
    {
        auto hex = s.substring (1);
        if (hex.length() == 3 || hex.length() == 4)
        {
            juce::String full;
            for (auto ch : hex)
                full << juce::String::charToString (ch) << juce::String::charToString (ch);
            hex = full;
        }
        const auto v = (juce::uint32) hex.getHexValue64();
        if (hex.length() == 8)
            return juce::Colour ((juce::uint8) (v >> 24), (juce::uint8) (v >> 16), (juce::uint8) (v >> 8), (juce::uint8) v);
        return juce::Colour ((juce::uint8) (v >> 16), (juce::uint8) (v >> 8), (juce::uint8) v);
    }
    if (s.startsWith ("rgb"))
    {
        const auto a = args (s);
        if (a.size() < 3)
            return juce::Colours::transparentBlack;
        const float alpha = a.size() > 3 ? channel (a[3], 1.0f) : 1.0f;
        return juce::Colour ((juce::uint8) juce::jlimit (0, 255, juce::roundToInt (channel (a[0], 255.0f))),
                             (juce::uint8) juce::jlimit (0, 255, juce::roundToInt (channel (a[1], 255.0f))),
                             (juce::uint8) juce::jlimit (0, 255, juce::roundToInt (channel (a[2], 255.0f))), juce::jlimit (0.0f, 1.0f, alpha));
    }
    if (s.startsWith ("hsl"))
    {
        const auto a = args (s);
        if (a.size() < 3)
            return juce::Colours::transparentBlack;
        return fromHsl (a[0].getFloatValue(), a[1].getFloatValue() / 100.0f, a[2].getFloatValue() / 100.0f, a.size() > 3 ? channel (a[3], 1.0f) : 1.0f);
    }
    return juce::Colours::findColourForName (s, juce::Colours::black);
}

void Path::lineTo (float x, float y)
{
    if (!open)
        moveTo (x, y);
    else
        p.lineTo (x, y);
}

void Path::arc (float x, float y, float r, float a0, float a1, bool ccw)
{
    ellipse (x, y, r, r, 0.0f, a0, a1, ccw);
}

void Path::ellipse (float x, float y, float rx, float ry, float rot, float a0, float a1, bool ccw)
{
    const float tau = juce::MathConstants<float>::twoPi;
    float sweep = a1 - a0;
    if (!ccw)
    {
        if (sweep >= tau)
            sweep = tau;
        else
            while (sweep < 0)
                sweep += tau;
    }
    else
    {
        if (sweep <= -tau)
            sweep = -tau;
        else
            while (sweep > 0)
                sweep -= tau;
    }
    const int steps = juce::jmax (2, (int) std::ceil (std::abs (sweep) / 0.05f));
    const auto t = juce::AffineTransform::rotation (rot, x, y);
    for (int i = 0; i <= steps; ++i)
    {
        const float a = a0 + sweep * (float) i / (float) steps;
        juce::Point<float> pt (x + rx * std::cos (a), y + ry * std::sin (a));
        pt.applyTransform (t);
        lineTo (pt.x, pt.y);
    }
}

Context::Context (juce::Graphics& gr, float, float) : g (gr)
{
    g.saveState();
    graphicsSaves = 1;
}

Context::~Context()
{
    while (graphicsSaves-- > 0)
        g.restoreState();
}

void Context::save()
{
    stack.push_back ({ fillStyle, strokeStyle, lineWidth, lineJoin, lineCap, globalAlpha, shadowBlur, shadowColor, font, textAlign, textBaseline, t, dash });
    g.saveState();
    ++graphicsSaves;
}

void Context::restore()
{
    if (stack.empty())
        return;
    const auto s = stack.back();
    stack.pop_back();
    fillStyle = s.fillStyle;
    strokeStyle = s.strokeStyle;
    lineWidth = s.lineWidth;
    lineJoin = s.lineJoin;
    lineCap = s.lineCap;
    globalAlpha = s.globalAlpha;
    shadowBlur = s.shadowBlur;
    shadowColor = s.shadowColor;
    font = s.font;
    textAlign = s.textAlign;
    textBaseline = s.textBaseline;
    t = s.t;
    dash = s.dash;
    g.restoreState();
    --graphicsSaves;
}

void Context::translate (float x, float y) { t = juce::AffineTransform::translation (x, y).followedBy (t); }
void Context::scale (float x, float y) { t = juce::AffineTransform::scale (x, y).followedBy (t); }
void Context::rotate (float a) { t = juce::AffineTransform::rotation (a).followedBy (t); }
void Context::setTransform (float a, float b, float c, float d, float e, float f) { t = juce::AffineTransform (a, c, e, b, d, f); }

void Context::paint (const juce::Path& shape, const Style& style)
{
    const auto drawn = shape.createPathWithRoundedCorners (0.0f);
    juce::Path p (drawn);
    p.applyTransform (t);

    // The glow: the shape's own shadow, blurred, in the shadow's colour.
    if (shadowBlur > 0.0f && shadowColor.getFloatAlpha() > 0.0f)
    {
        const auto glow = shadowColor.withMultipliedAlpha (globalAlpha);
        juce::DropShadow (glow, juce::jmax (1, juce::roundToInt (shadowBlur)), {}).drawForPath (g, p);
    }

    if (const auto* c = std::get_if<juce::Colour> (&style))
        g.setColour (c->withMultipliedAlpha (globalAlpha));
    else
    {
        const auto& gr = std::get<Gradient> (style);
        juce::ColourGradient cg;
        cg.isRadial = gr.radial;
        cg.point1 = { gr.x1, gr.y1 };
        cg.point2 = gr.radial ? juce::Point<float> (gr.x1 + gr.r1, gr.y1) : juce::Point<float> (gr.x1, gr.y1);
        if (!gr.radial)
            cg.point1 = { gr.x0, gr.y0 };
        cg.clearColours();
        auto stops = gr.stops;
        std::stable_sort (stops.begin(), stops.end(), [] (auto& a, auto& b) { return a.first < b.first; });
        if (gr.radial && gr.r1 > 0.0f && gr.r0 > 0.0f)
            for (auto& s : stops)
                s.first = (gr.r0 + s.first * (gr.r1 - gr.r0)) / gr.r1;
        if (stops.empty())
            stops.push_back ({ 0.0f, juce::Colours::transparentBlack });
        if (stops.front().first > 0.0f)
            cg.addColour (0.0, stops.front().second);
        for (auto& s : stops)
            cg.addColour (juce::jlimit (0.0, 1.0, (double) s.first), s.second);
        if (stops.back().first < 1.0f)
            cg.addColour (1.0, stops.back().second);
        g.setFillType (juce::FillType (cg).transformed (t));
        g.setOpacity (globalAlpha);
    }
    g.fillPath (p);
}

void Context::fill (const Path& path)
{
    paint (path.p, fillStyle);
}

void Context::stroke (const Path& path)
{
    const auto join = lineJoin == "round" ? juce::PathStrokeType::curved : lineJoin == "bevel" ? juce::PathStrokeType::beveled : juce::PathStrokeType::mitered;
    const auto cap = lineCap == "round" ? juce::PathStrokeType::rounded : lineCap == "square" ? juce::PathStrokeType::square : juce::PathStrokeType::butt;
    juce::PathStrokeType type (lineWidth, join, cap);
    juce::Path out;
    if (!dash.empty())
    {
        juce::Path dashed;
        type.createDashedStroke (dashed, path.p, dash.data(), (int) dash.size());
        out = dashed;
    }
    else
        type.createStrokedPath (out, path.p);
    paint (out, strokeStyle);
}

void Context::clip (const Path& path)
{
    juce::Path p (path.p);
    p.applyTransform (t);
    g.reduceClipRegion (p);
}

void Context::fillRect (float x, float y, float w, float h)
{
    Path p;
    p.rect (x, y, w, h);
    fill (p);
}

void Context::strokeRect (float x, float y, float w, float h)
{
    Path p;
    p.rect (x, y, w, h);
    stroke (p);
}

juce::Font Context::parsedFont() const
{
    // "600 10px <family>", as the pages write it.
    int weight = 400;
    float size = 10.0f;
    bool monospace = font.containsIgnoreCase ("mono") || font.containsIgnoreCase ("menlo");
    for (auto& w : juce::StringArray::fromTokens (font, " ", "\"'"))
    {
        if (w.endsWith ("px"))
            size = w.dropLastCharacters (2).getFloatValue();
        else if (w.containsOnly ("0123456789") && w.isNotEmpty())
            weight = w.getIntValue();
        else if (w == "bold")
            weight = 700;
    }
    return monospace ? face::mono (size, weight) : face::sans (size, weight);
}

float Context::measureText (const juce::String& text)
{
    return juce::GlyphArrangement::getStringWidth (parsedFont(), text);
}

void Context::fillText (const juce::String& text, float x, float y)
{
    const auto f = parsedFont();
    const float w = juce::GlyphArrangement::getStringWidth (f, text);
    if (textAlign == "center")
        x -= w / 2;
    else if (textAlign == "right" || textAlign == "end")
        x -= w;
    if (textBaseline == "middle")
        y += (f.getAscent() - f.getDescent()) / 2;
    else if (textBaseline == "top")
        y += f.getAscent();
    else if (textBaseline == "bottom")
        y -= f.getDescent();
    juce::GlyphArrangement glyphs;
    glyphs.addLineOfText (f, text, x, y);
    juce::Path p;
    glyphs.createPath (p);
    paint (p, fillStyle);
}
} // namespace c2d
