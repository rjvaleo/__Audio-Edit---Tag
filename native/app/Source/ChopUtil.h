// Small helpers Chop's face shares between its files (ChopFace.cpp, ChopDraw.cpp).
#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

#include <cmath>

namespace chopu
{
inline double dnum (const juce::var& v, double fallback = 0.0)
{
    if (v.isString())
        return v.toString().getDoubleValue();
    if (v.isBool())
        return (bool) v ? 1.0 : 0.0;
    return v.isVoid() || v.isUndefined() ? fallback : (double) v;
}

inline juce::Rectangle<float> rectOf (const juce::var& r)
{
    return { (float) dnum (r[0]), (float) dnum (r[1]), (float) dnum (r[2]), (float) dnum (r[3]) };
}

inline bool hasClass (const juce::var& n, const char* c)
{
    return juce::StringArray::fromTokens (n["cls"].toString(), " ", "").contains (c);
}

inline juce::String uni (const char* s) { return juce::String::fromUTF8 (s); }

// JS's Math.round, and Number.prototype.toFixed as the page writes readings.
inline double jsRound (double v) { return std::floor (v + 0.5); }
inline juce::String fixed (double v, int places)
{
    const double p = std::pow (10.0, places);
    const double r = std::floor (std::abs (v) * p + 0.5) / p;
    auto s = juce::String (r, places);
    if (v < 0 && !juce::exactlyEqual (r, 0.0))
        s = "-" + s;
    return s;
}
inline juce::String rnd (double v) { return juce::String ((int64_t) jsRound (v)); }

inline juce::var obj() { return juce::var (new juce::DynamicObject()); }
inline juce::var put (juce::var o, const juce::Identifier& k, const juce::var& v)
{
    if (auto* d = o.getDynamicObject())
        d->setProperty (k, v);
    return o;
}

// rgb(a) from the page's colour triples, "r,g,b" strings and css.
inline juce::Colour rgba (const juce::String& rgbList, float a)
{
    auto p = juce::StringArray::fromTokens (rgbList, ",", "");
    if (p.size() < 3)
        return juce::Colours::transparentBlack;
    return juce::Colour ((juce::uint8) p[0].trim().getIntValue(), (juce::uint8) p[1].trim().getIntValue(), (juce::uint8) p[2].trim().getIntValue(), a);
}
inline juce::Colour rgb3 (const float c[3], float a = 1.0f)
{
    // `chopRgb`: each part truncated (`| 0`).
    auto part = [] (float v) { return (juce::uint8) juce::jlimit (0, 255, (int) v); };
    return juce::Colour (part (c[0]), part (c[1]), part (c[2]), a);
}
} // namespace chopu
