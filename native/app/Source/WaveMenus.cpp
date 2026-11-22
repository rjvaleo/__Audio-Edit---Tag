#include "WaveMenus.h"

WaveMenu::WaveMenu (const juce::var& part, std::vector<Item> list, juce::Colour t, juce::Colour tOn)
    : tree (part["tree"]), items (std::move (list)), text (t), textOn (tOn)
{
    // The tiles as the capture laid them: the first one's size, the gap to
    // the next, the panel's padding; the lit one's look and an unlit one's.
    if (auto* kids = tree["kids"].getArray())
    {
        for (const auto& k : *kids)
        {
            if (!face::matches (k, "wv-wt"))
                continue;
            (face::matches (k, "on") ? tileOn : tileOff) = &k;
        }
        if (kids->size() > 1)
        {
            const auto a = face::rectOf (kids->getReference (0)), b = face::rectOf (kids->getReference (1));
            pad = a.getX();
            tw = a.getWidth();
            th = a.getHeight();
            gap = b.getX() - a.getRight();
        }
        if (tileOn == nullptr)
            tileOn = tileOff;
        if (tileOff == nullptr)
            tileOff = tileOn;
    }
    const int rows = ((int) items.size() + cols - 1) / cols;
    setSize (juce::roundToInt (pad * 2 + (float) cols * tw + (float) (cols - 1) * gap), juce::roundToInt (pad * 2 + (float) rows * th + (float) juce::jmax (0, rows - 1) * gap));
}

juce::Rectangle<float> WaveMenu::tile (int i) const
{
    return { pad + (float) (i % cols) * (tw + gap), pad + (float) (i / cols) * (th + gap), tw, th };
}

int WaveMenu::at (juce::Point<float> p) const
{
    for (int i = 0; i < (int) items.size(); ++i)
        if (tile (i).contains (p))
            return i;
    return -1;
}

void WaveMenu::place (juce::Rectangle<float> r, float dx, juce::Rectangle<float> page)
{
    // wvPlaceMenu: under its anchor, inside the page; above it if it would
    // run off the bottom.
    const float w = (float) getWidth(), h = (float) getHeight();
    const float left = juce::jmax (8.0f, juce::jmin (page.getWidth() - w - 8, r.getX() + dx));
    float top = r.getBottom() + 6;
    if (top + h > page.getHeight() - 8)
        top = juce::jmax (8.0f, r.getY() - h - 6);
    setTopLeftPosition (juce::roundToInt (left), juce::roundToInt (top));
}

void WaveMenu::paint (juce::Graphics& g)
{
    face::paintBox (g, tree, getLocalBounds().toFloat());
    for (int i = 0; i < (int) items.size(); ++i)
    {
        const auto& it = items[(size_t) i];
        const auto* look = it.on ? tileOn : tileOff;
        if (look == nullptr)
            continue;
        const auto r = tile (i), from = face::rectOf (*look);
        if (i == hover && !it.on)
        {
            // .wv-wt:hover
            g.setColour (juce::Colours::white.withAlpha (0.05f));
            g.fillPath (face::box (r, (*look)["radius"]));
        }
        face::Stamp s;
        s.text = [&] (const juce::var& n, juce::String& out) {
            if (n["tag"].toString() != "span")
                return false;
            out = it.label;
            return true;
        };
        s.ink = [&] (const juce::var&, juce::Colour& c) {
            c = !it.ink.isTransparent() ? it.ink : (it.on || i == hover) ? textOn : text;
            return true;
        };
        s.after = [&] (juce::Graphics& gg, const juce::var& n, juce::Rectangle<float> cr) {
            if (n["tag"].toString() != "canvas" || !it.pic)
                return;
            juce::Graphics::ScopedSaveState keep (gg);
            gg.addTransform (juce::AffineTransform::translation (cr.getX(), cr.getY()));
            gg.reduceClipRegion (juce::Rectangle<int> (0, 0, juce::roundToInt (cr.getWidth()), juce::roundToInt (cr.getHeight())));
            c2d::Context c (gg, cr.getWidth(), cr.getHeight());
            it.pic (c, cr.getWidth(), cr.getHeight());
        };
        s.draw (g, *look, r.getTopLeft() - from.getTopLeft());
    }
}

void WaveMenu::mouseMove (const juce::MouseEvent& e)
{
    const int h = at (e.position);
    if (h != hover)
    {
        hover = h;
        repaint();
    }
}

void WaveMenu::mouseExit (const juce::MouseEvent&)
{
    hover = -1;
    repaint();
}

void WaveMenu::mouseUp (const juce::MouseEvent& e)
{
    const int i = at (e.position);
    if (i < 0)
        return;
    auto act = items[(size_t) i].act;
    auto close = onClose;
    if (close)
        close();
    if (act)
        act();
}
