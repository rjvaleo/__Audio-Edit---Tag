// Prism's pictures (ui/app/386-prism-pictures.js, PRISM_PIC; 387's
// prismLfoWaveIcon): one beside every control, drawn from its value, and one
// per process for the Process menu. Ported string for string: each returns
// the SVG markup the page puts inside its <svg viewBox="0 0 64 48">, with the
// page's classes (a, f, af, t), which `draw` styles as the page's CSS does
// where the picture sits (the knob's side picture, a bar's or a menu's).
#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

#include <map>

namespace ppic
{
// HP_DRAW[key](v, n, c, kind): the picture's markup, or empty when the page
// has none for that key.
juce::String hpDraw (const juce::String& key, double v, double n, const juce::String& kind);
bool hasDraw (const juce::String& key);
// PROC_ICON[kind](): a process's picture (empty for one without).
juce::String procIcon (const juce::String& kind);
// HP_FACET: which facet a control's colour is ("time", "pitch", ...).
juce::String facetOf (const juce::String& key);
// prismLfoWaveIcon's path (viewBox 0 0 40 20).
juce::String lfoWaveIcon (const juce::String& shape);

// How the page's CSS styles a picture's classes where it sits, read from one
// of its captured pictures (an <svg> as walk.js resolved it): each class's
// fill, stroke, width, caps and opacity; `nonScaling` for the knobs' side
// pictures (vector-effect: non-scaling-stroke), whose widths are screen px.
struct Style
{
    struct Cls
    {
        juce::String fill = "none", stroke = "none", cap = "round", join = "round";
        float width = 1.0f, opacity = 1.0f;
        bool hidden = false, found = false;
    };
    std::map<juce::String, Cls> cls;
    bool nonScaling = false;
    float fontSize = 9.0f;
    // From a captured <svg>'s markup.
    static Style fromCaptured (const juce::String& svg, bool nonScaling);
    // The same, with `a` and `af` in another colour (a facet's, an LFO's).
    Style tinted (juce::Colour a) const;
};

// Draw `body` (on a viewBox of vbW x vbH, placed as the browser places an
// <svg> in `box`: xMidYMid meet, or stretched).
void draw (juce::Graphics&, const juce::String& body, juce::Rectangle<float> box, const Style&, float vbW = 64, float vbH = 48, bool stretch = false);
} // namespace ppic
