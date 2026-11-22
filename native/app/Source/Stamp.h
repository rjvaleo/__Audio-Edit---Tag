// A captured part of a page, drawn again wherever the face needs it: a pin in
// the Matrix, a row, a node on the board, a menu. The page builds these from
// the patch as it goes; the capture walks one of each in a state that shows
// it (tools/face-capture/capture-wave.mjs), and the face stamps a copy where
// the patch puts one, with its own words.
//
// Drawn as face::Chrome draws the whole page (the same boxes, text, icons,
// opacity and clips), moved by `offset` from where it was captured.
#pragma once

#include "Face.h"

#include <functional>
#include <map>

namespace face
{
struct Stamp
{
    // A node's words, by its index in the capture: what to write instead of
    // what was captured ("" writes nothing). Return false to keep the capture's.
    std::function<bool (const juce::var& node, juce::String& text)> text;
    // A node's ink instead of its captured colour (its text and icon).
    std::function<bool (const juce::var& node, juce::Colour& ink)> ink;
    // Leave a node out (with what is inside it), by its index.
    std::function<bool (const juce::var& node)> skip;
    // Draw a node with another node's look (lit or not), by index.
    std::function<const juce::var* (const juce::var& node)> look;
    // Called after a node is drawn, in its own place (for what the face
    // draws inside it: a canvas, a knob).
    std::function<void (juce::Graphics&, const juce::var& node, juce::Rectangle<float> r)> after;

    void draw (juce::Graphics&, const juce::var& tree, juce::Point<float> offset = {}) const;

private:
    void node (juce::Graphics&, const juce::var& n, const juce::var* look) const;
    void words (juce::Graphics&, const juce::var& n, const juce::var* look) const;
};

// The first node in `tree` (itself included) that matches: by its id, or a
// class, or a data attribute ("data-k=lp").
const juce::var* findNode (const juce::var& tree, const juce::String& what);
// Every node that matches, in the order the page has them.
juce::Array<const juce::var*> findAll (const juce::var& tree, const juce::String& what);
bool matches (const juce::var& n, const juce::String& what);
juce::Rectangle<float> rectOf (const juce::var& n);

// An icon's drawable, kept for the life of the app (by its markup).
juce::Drawable* svgFor (const juce::String& markup);
// A captured icon with its path's `d` swapped (the page sets it as the patch
// says: a warp's glyph, an LFO's shape), drawn in the icon's own box.
void drawIcon (juce::Graphics&, const juce::var& svgNode, const juce::String& d, juce::Point<float> offset = {});
} // namespace face
