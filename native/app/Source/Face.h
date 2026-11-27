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

// Paint a captured node's box (shadows, fill, gradients, border) on `r`,
// whatever size `r` is: a part of a page drawn at another place or size.
void paintBox (juce::Graphics&, const juce::var& node, juce::Rectangle<float> r);
// Write `text` in a captured node's first run's font and colour, inside `r`,
// aligned left, centred or right.
void paintText (juce::Graphics&, const juce::var& node, juce::Rectangle<float> r, const juce::String& text, juce::Justification = juce::Justification::centredLeft);
// A captured part by its file name, without ".json" (faces/…). idMLab's
// canvas parts ("idmlab-bar", "-status", "-node-audio", "-menu", "-style")
// come in the theme being worn; "wave" and "atmos" (via page) in its MGL twin.
// "atmos" is { page, dock, size }: the frame's page and the keyboard dock.
const juce::var& part (const juce::String& name);
// A file built into the app, read whole (a gzipped one unpacked).
juce::String embeddedFile (const juce::String& file);

// ── themes and kits ───────────────────────────────────────────────────────
// One entry in the theme picker: the theme idMLab's canvas wears, and the
// one MGL's pages wear with it.
struct ThemeChoice
{
    juce::String group, label, blurb;
    juce::Array<juce::Colour> swatch;
    int idmlab = 1;       // idMLab's theme, by its place in its own list (1 is Dark)
    juce::String mgl;     // MGL's theme id ("default" is its own default)
};
const std::vector<ThemeChoice>& themeChoices();
// The kits, as idMLab's Kit picker lists them: its value and its label.
const std::vector<std::pair<juce::String, juce::String>>& kits();

// What is worn now. Choosing loads its captures; `stamp` counts the changes,
// so whatever drew with the old one knows to draw again.
void wear (int choice, const juce::String& kit);
int worn();
const juce::String& wornKit();
int stamp();

// The jack the worn kit draws for a socket of this type ("audio" or "notes"),
// as a captured tree, or null.
const juce::var* jack (const juce::String& type, bool isInput);
// The first node in `tree` whose class list holds `cls` (or whose tag is `cls`).
const juce::var* find (const juce::var& tree, const juce::String& cls);

class Chrome final : public juce::Component
{
public:
    explicit Chrome (const juce::var& captured);
    void paint (juce::Graphics&) override;

    // Draw again what lies in `area` (the page's pixels): after a switch has
    // changed how it is lit. The rest of the picture is kept.
    void redraw (juce::Rectangle<float> area);
    // Draw the look itself, unscaled, into `g` (what the cached picture holds).
    void paintLook (juce::Graphics&);

    // Draw one of its captured nodes, and what is inside it, into `g`, moved
    // by `offset`, at `opacity`, leaving out the nodes in `without` (and none
    // of those it leaves out of its own picture): a part of the page a face
    // draws live, lit or not, dimmed or not.
    void drawPart (juce::Graphics&, const juce::var& node, juce::Point<float> offset = {}, float opacity = 1.0f, const std::set<int>* without = nullptr);
    // The same, leaving out these nodes' text too (a reading the face writes).
    void drawPart (juce::Graphics&, const juce::var& node, juce::Point<float> offset, float opacity, const std::set<int>* without, const std::set<int>* withoutText);

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
    // Show this option of a select node (by its number), not the captured one.
    std::map<int, int> selectValue;
    // A select showing words its captured options lack (a list made later).
    std::map<int, juce::String> selectText;
    // Draw this node (and what is in it) at this opacity, not the captured one.
    std::map<int, float> opacityOf;

private:
    juce::var captured;
    // The look, drawn once at `cachedScale` (1 or 2, the screen's density),
    // and kept: the canvas zooms and moves it without drawing it again.
    juce::Image cached;
    float cachedScale = 0;
    std::map<int, std::unique_ptr<juce::Drawable>> svgs;
    void index (const juce::var& n);
    std::map<std::pair<int, int>, std::unique_ptr<juce::Drawable>> recoloured;
    void drawNode (juce::Graphics&, const juce::var& n, const juce::var* look = nullptr);
    void drawBox (juce::Graphics&, const juce::var& n, juce::Rectangle<float> r);
    void drawText (juce::Graphics&, const juce::var& n, const juce::var* look = nullptr);
};
} // namespace face
