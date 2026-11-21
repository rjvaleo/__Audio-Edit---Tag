// The browser's 2D canvas, as far as MGL's pages use it, on JUCE's Graphics:
// so a page's drawing code ports line for line.
//
// Covered: paths (moveTo, lineTo, bezierCurveTo, quadraticCurveTo, arc,
// rect, roundRect, closePath, and Path2D as `Path`), fill and stroke with a
// colour or a linear or radial gradient, lineWidth, lineJoin, lineCap,
// setLineDash, globalAlpha, shadowBlur and shadowColor (the glow), save and
// restore, translate, scale, setTransform, clip, fillRect, strokeRect,
// clearRect, fillText with font, textAlign and textBaseline. Colours are CSS
// strings: #rgb, #rrggbb, rgb(), rgba(), hsl(), hsla(), or a name the pages
// use. Not covered, because no page draws with them: composite modes and
// pixel access.
#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

#include <array>
#include <variant>
#include <vector>

namespace c2d
{
juce::Colour css (const juce::String&);

struct Gradient
{
    bool radial = false;
    float x0 = 0, y0 = 0, r0 = 0, x1 = 0, y1 = 0, r1 = 0;
    std::vector<std::pair<float, juce::Colour>> stops;
    void addColorStop (float at, const juce::String& colour) { stops.push_back ({ at, css (colour) }); }
};

using Style = std::variant<juce::Colour, Gradient>;

class Path
{
public:
    Path() = default;
    Path (const Path&) = default;
    Path& operator= (const Path&) = default;
    void moveTo (float x, float y)
    {
        p.startNewSubPath (x, y);
        open = true;
    }
    void lineTo (float x, float y);
    void bezierCurveTo (float a, float b, float c, float d, float x, float y) { ensure (a, b); p.cubicTo (a, b, c, d, x, y); }
    void quadraticCurveTo (float a, float b, float x, float y) { ensure (a, b); p.quadraticTo (a, b, x, y); }
    void arc (float x, float y, float r, float a0, float a1, bool ccw = false);
    void ellipse (float x, float y, float rx, float ry, float rot, float a0, float a1, bool ccw = false);
    void rect (float x, float y, float w, float h) { p.addRectangle (x, y, w, h); }
    void roundRect (float x, float y, float w, float h, float r) { p.addRoundedRectangle (x, y, w, h, r); }
    // Corners top-left, top-right, bottom-right, bottom-left, as the browser's.
    void roundRect (float x, float y, float w, float h, std::array<float, 4> r);
    void closePath()
    {
        p.closeSubPath();
        open = false;
    }
    juce::Path p;

private:
    // Whether a subpath is under way. (juce::Path counts a lone starting
    // point as empty, so it can't say.)
    bool open = false;
    void ensure (float x, float y)
    {
        if (!open)
            moveTo (x, y);
    }
};

class Context
{
public:
    // Draws into `g`; the canvas is `w` by `h` CSS pixels at its origin.
    Context (juce::Graphics& g, float w, float h);
    ~Context();

    // state
    Style fillStyle = juce::Colours::black;
    Style strokeStyle = juce::Colours::black;
    float lineWidth = 1.0f;
    juce::String lineJoin = "miter", lineCap = "butt";
    float globalAlpha = 1.0f;
    float shadowBlur = 0.0f;
    juce::Colour shadowColor = juce::Colours::transparentBlack;
    juce::String font = "10px sans-serif";
    juce::String textAlign = "start", textBaseline = "alphabetic";

    void setFill (const juce::String& c) { fillStyle = css (c); }
    void setStroke (const juce::String& c) { strokeStyle = css (c); }
    void setShadow (const juce::String& c) { shadowColor = css (c); }
    void setLineDash (std::vector<float> d) { dash = std::move (d); }

    void save();
    void restore();
    void translate (float x, float y);
    void scale (float x, float y);
    void rotate (float a);
    void setTransform (float a, float b, float c, float d, float e, float f);

    // the current path
    void beginPath() { current = Path(); }
    void moveTo (float x, float y) { current.moveTo (x, y); }
    void lineTo (float x, float y) { current.lineTo (x, y); }
    void bezierCurveTo (float a, float b, float c, float d, float x, float y) { current.bezierCurveTo (a, b, c, d, x, y); }
    void quadraticCurveTo (float a, float b, float x, float y) { current.quadraticCurveTo (a, b, x, y); }
    void arc (float x, float y, float r, float a0, float a1, bool ccw = false) { current.arc (x, y, r, a0, a1, ccw); }
    void ellipse (float x, float y, float rx, float ry, float rot, float a0, float a1, bool ccw = false) { current.ellipse (x, y, rx, ry, rot, a0, a1, ccw); }
    void rect (float x, float y, float w, float h) { current.rect (x, y, w, h); }
    void roundRect (float x, float y, float w, float h, float r) { current.roundRect (x, y, w, h, r); }
    void roundRect (float x, float y, float w, float h, std::array<float, 4> r) { current.roundRect (x, y, w, h, r); }
    void closePath() { current.closePath(); }

    void fill() { fill (current); }
    void stroke() { stroke (current); }
    void clip() { clip (current); }
    void fill (const Path&);
    void stroke (const Path&);
    void clip (const Path&);

    void fillRect (float x, float y, float w, float h);
    void strokeRect (float x, float y, float w, float h);
    void clearRect (float, float, float, float) {}
    void fillText (const juce::String& text, float x, float y);
    float measureText (const juce::String& text);

    Gradient createLinearGradient (float x0, float y0, float x1, float y1) const { return { false, x0, y0, 0, x1, y1, 0, {} }; }
    Gradient createRadialGradient (float x0, float y0, float r0, float x1, float y1, float r1) const { return { true, x0, y0, r0, x1, y1, r1, {} }; }

    juce::Graphics& graphics() { return g; }

private:
    juce::Graphics& g;
    juce::AffineTransform t;
    std::vector<float> dash;
    Path current;
    struct Saved
    {
        Style fillStyle, strokeStyle;
        float lineWidth;
        juce::String lineJoin, lineCap;
        float globalAlpha, shadowBlur;
        juce::Colour shadowColor;
        juce::String font, textAlign, textBaseline;
        juce::AffineTransform t;
        std::vector<float> dash;
    };
    std::vector<Saved> stack;
    int graphicsSaves = 0;

    void paint (const juce::Path& shape, const Style& style);
    juce::Font parsedFont() const;
};
} // namespace c2d
