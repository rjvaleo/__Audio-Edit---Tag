// A page's look, drawn natively from its capture (tools/face-capture).
//
// The capture is MGL's own page measured in a browser: every box's place,
// fill, gradients, border, corners, shadows and clip; every run of text with
// its font; every icon as SVG; every canvas by id. `Chrome` paints all of it
// the way a browser paints a box (outer shadows, the colour, the gradient
// layers from the last up, inset shadows, the border, then its text and what
// is inside it, clipped where the page clips), at the page's own pixel size.
// It is drawn as vectors, so it stays sharp at any zoom.
//
// What moves (canvases, knobs, the values shown) is drawn over it by the
// module's own face (WaveFace), with code ported from the page.
#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

#include <map>
#include <memory>
#include <set>

namespace face
{
// The page's two typefaces as the Mac shows them: the system's sans (the
// page asks for Inter, which isn't installed, so the browser falls back to
// it) and its monospaced face.
juce::Font sans (float px, int weight = 400);
juce::Font mono (float px, int weight = 400);
juce::Font font (const juce::var& f);

juce::Colour colour (const juce::var& rgba);

// A captured page, parsed once and kept for the life of the app.
const juce::var& page (const juce::String& name);

// A box's rounded outline, from its rect and corners.
juce::Path box (const juce::Rectangle<float>&, const juce::var& radius, float inset = 0.0f);

// Fill `shape` (laid on `r`) with one CSS gradient layer.
void fillLayer (juce::Graphics&, const juce::var& layer, juce::Rectangle<float> r, const juce::Path& shape);

class Chrome final : public juce::Component
{
public:
    explicit Chrome (const juce::var& captured);
    void paint (juce::Graphics&) override;

    // Every node with a canvas, by its id, and every node by its index.
    std::map<juce::String, juce::var> canvases;
    std::map<int, juce::var> nodes;

    // Leave these nodes out (the face draws them itself, live).
    std::set<int> skip;
    // Leave out only these nodes' text (the face writes their reading now).
    std::set<int> skipText;
    // Draw node `first` with the look of node `second`: a switch lit or not
    // as the patch says, from the page's own lit and unlit buttons.
    std::map<int, int> styleFrom;

private:
    juce::var captured;
    std::map<int, std::unique_ptr<juce::Drawable>> svgs;
    void index (const juce::var& n);
    std::map<std::pair<int, int>, std::unique_ptr<juce::Drawable>> recoloured;
    void drawNode (juce::Graphics&, const juce::var& n, const juce::var* look = nullptr);
    void drawBox (juce::Graphics&, const juce::var& n, juce::Rectangle<float> r);
    void drawText (juce::Graphics&, const juce::var& n, const juce::var* look = nullptr);
};
} // namespace face
