// What Browse's face and Library's share (BrowseFace.h).
#include "BrowseFace.h"

namespace browse
{
namespace
{
juce::Rectangle<float> rect (const juce::var& r)
{
    if (!r.isArray() || r.size() < 4)
        return {};
    return { (float) (double) r[0], (float) (double) r[1], (float) (double) r[2], (float) (double) r[3] };
}

bool hasClass (const juce::var& n, const juce::String& cls)
{
    if (cls.startsWithChar ('#'))
        return n["id"].toString() == cls.substring (1);
    const auto mine = juce::StringArray::fromTokens (n["cls"].toString(), " ", "");
    for (const auto& want : juce::StringArray::fromTokens (cls, ".", ""))
        if (want.isNotEmpty() && !mine.contains (want))
            return false;
    return cls.isNotEmpty();
}
} // namespace

Base::Base (Call c, uint32_t i) : call (std::move (c)), id (i)
{
    buf.resize (1 << 16);
    setWantsKeyboardFocus (true);
}

Base::~Base()
{
    stopTimer();
}

juce::var Base::module (const char* what, const juce::var& body)
{
    const auto json = body.isVoid() ? juce::String() : juce::JSON::toString (body, true);
    juce::String text;
    call ([&] (NaApp* a) -> int64_t {
        int32_t n = na_browse_call (a, id, what, json.isEmpty() ? nullptr : json.toRawUTF8(), buf.data(), (uint32_t) buf.size());
        if (n >= (int32_t) buf.size())
        {
            // Too long for the room: the answer of an action is never asked
            // twice, so only "info" (which changes nothing) is asked again.
            if (juce::String (what) != "info")
                return n;
            buf.resize ((size_t) n + 1);
            n = na_browse_call (a, id, what, json.isEmpty() ? nullptr : json.toRawUTF8(), buf.data(), (uint32_t) buf.size());
        }
        if (n >= 0)
            text = juce::String::fromUTF8 (buf.data());
        else
        {
            char e[512] {};
            na_error (a, e, sizeof e);
            text = "{\"error\":" + juce::JSON::toString (juce::String::fromUTF8 (e)) + "}";
        }
        return n;
    });
    auto v = juce::JSON::parse (text);
    if (v.isObject() && v.hasProperty ("playing"))
        info = v;
    return v;
}

void Base::timerCallback()
{
    tick();
}

double Base::paintTimed (float scale)
{
    juce::Image img (juce::Image::ARGB, juce::jmax (1, (int) std::ceil ((float) getWidth() * scale)), juce::jmax (1, (int) std::ceil ((float) getHeight() * scale)), true);
    juce::Graphics g (img);
    g.addTransform (juce::AffineTransform::scale (scale));
    const auto t0 = juce::Time::getMillisecondCounterHiRes();
    paintEntireComponent (g, true);
    return juce::Time::getMillisecondCounterHiRes() - t0;
}

N Base::find (const juce::var& tree, const juce::String& cls, int nth)
{
    std::vector<N> all;
    findAll (tree, cls, all);
    return nth < (int) all.size() ? all[(size_t) nth] : N {};
}

N Base::byId (const juce::var& tree, const juce::String& want)
{
    return find (tree, "#" + want);
}

void Base::findAll (const juce::var& tree, const juce::String& cls, std::vector<N>& out)
{
    if (!tree.isObject())
        return;
    if (hasClass (tree, cls))
        out.push_back ({ tree, rect (tree["rect"]) });
    if (auto* kids = tree["kids"].getArray())
        for (const auto& k : *kids)
            findAll (k, cls, out);
}

std::vector<juce::var> Base::texts (const juce::var& node)
{
    std::vector<juce::var> out;
    std::function<void (const juce::var&)> walk = [&] (const juce::var& n) {
        if (auto* runs = n["text"].getArray(); runs != nullptr && !runs->isEmpty())
            out.push_back (n);
        if (auto* kids = n["kids"].getArray())
            for (const auto& k : *kids)
                walk (k);
    };
    walk (node);
    return out;
}

void Base::write (juce::Graphics& g, const juce::var& run, juce::Point<float> by, const juce::String& text, float room, juce::Colour* tint)
{
    const auto f = face::font (run["font"]);
    const auto r = rect (run["rect"]) + by;
    g.setFont (f);
    g.setColour (tint != nullptr ? *tint : face::colour (run["font"]["colour"]));
    auto t = text;
    if (room > 0 && juce::GlyphArrangement::getStringWidth (f, t) > room)
    {
        const auto dots = juce::String::fromUTF8 ("\xe2\x80\xa6");
        while (t.isNotEmpty() && juce::GlyphArrangement::getStringWidth (f, t + dots) > room)
            t = t.dropLastCharacters (1);
        t = t.trimEnd() + dots;
    }
    const float baseline = r.getY() + (r.getHeight() - (f.getAscent() + f.getDescent())) / 2.0f + f.getAscent();
    juce::GlyphArrangement glyphs;
    glyphs.addLineOfText (f, t, r.getX(), baseline);
    glyphs.draw (g);
}

void Base::drawRow (juce::Graphics& g, face::Chrome& chrome, const juce::var& node, juce::Point<float> by,
                    const std::function<juce::String (const juce::var&, const juce::String&)>& words, float opacity)
{
    const auto ts = texts (node);
    std::set<int> without;
    for (const auto& t : ts)
        without.insert ((int) t["i"]);
    chrome.drawPart (g, node, by, opacity, nullptr, &without);
    const auto box = rect (node["rect"]);
    for (const auto& t : ts)
    {
        auto* runs = t["text"].getArray();
        juce::String captured;
        for (const auto& run : *runs)
            captured << run["text"].toString();
        const auto said = words ? words (t, captured) : captured;
        if (said.isEmpty())
            continue;
        const auto& run = runs->getReference (0);
        const auto tb = rect (t["rect"]);
        const float right = juce::jmin (box.getRight(), tb.getRight() + 400.0f);
        const float room = (tb.getWidth() > 0 ? juce::jmax (tb.getRight(), right) : right) - (float) (double) run["rect"][0];
        juce::Graphics::ScopedSaveState keep (g);
        if (opacity < 1.0f)
            g.setOpacity (opacity);
        write (g, run, by, said, juce::jmin (room, box.getRight() - (float) (double) run["rect"][0] - 2.0f));
    }
}

juce::TextEditor& Base::field (const juce::String& key, const N& at, const juce::String& hint, bool multi)
{
    auto& e = fields[key];
    if (e == nullptr)
    {
        e = std::make_unique<juce::TextEditor>();
        e->setMultiLine (multi, true);
        e->setReturnKeyStartsNewLine (multi);
        e->setScrollbarsShown (multi);
        e->setColour (juce::TextEditor::backgroundColourId, juce::Colours::transparentBlack);
        e->setColour (juce::TextEditor::outlineColourId, juce::Colours::transparentBlack);
        e->setColour (juce::TextEditor::focusedOutlineColourId, juce::Colours::transparentBlack);
        if (auto* runs = at.n["text"].getArray(); runs != nullptr && !runs->isEmpty())
        {
            const auto& f = runs->getReference (0)["font"];
            e->setFont (face::font (f));
        }
        const auto col = face::colour (at.n["color"].isVoid() ? juce::var() : at.n["color"]);
        e->setColour (juce::TextEditor::textColourId, col.isTransparent() ? juce::Colour (0xffe8eaee) : col);
        e->setTextToShowWhenEmpty (hint, juce::Colours::grey);
        const auto pad = multi ? 10.0f : 12.0f;
        e->setIndents ((int) pad, multi ? 8 : (int) juce::jmax (0.0f, (at.r.getHeight() - e->getFont().getHeight()) / 2.0f));
        e->setBorder ({});
        addAndMakeVisible (*e);
    }
    e->setBounds (at.r.toNearestInt());
    return *e;
}
} // namespace browse
