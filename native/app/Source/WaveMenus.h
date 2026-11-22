// Wave's own menus, drawn inside the page as the page draws them
// (ui/app/393b-wave-menus.js): a panel of tiles, three across, each a little
// picture and its name, the one chosen lit (`wvMenuTile`). The warps drawn on
// this oscillator's wave, its effects, the tables, the LFO shapes.
//
// The panel and its tiles are the page's own, captured open
// (capture-wave.mjs, part "menu"); each tile's picture is drawn by the
// caller, as the page's code draws it on the tile's 88 x 38 canvas.
#pragma once

#include "Canvas2D.h"
#include "Stamp.h"

#include <functional>

class WaveMenu final : public juce::Component
{
public:
    struct Item
    {
        juce::String label;
        bool on = false;
        juce::Colour ink;            // the label's colour, if the page gives one
        std::function<void (c2d::Context&, float w, float h)> pic;
        std::function<void()> act;
    };
    // `part` is the captured menu: { tree, root }.
    WaveMenu (const juce::var& part, std::vector<Item> items, juce::Colour text, juce::Colour textOn);

    // Put it under `anchor` (page pixels), moved `dx` across, kept inside a page `page` big.
    void place (juce::Rectangle<float> anchor, float dx, juce::Rectangle<float> page);
    std::function<void()> onClose;

    void paint (juce::Graphics&) override;
    void mouseMove (const juce::MouseEvent&) override;
    void mouseExit (const juce::MouseEvent&) override;
    void mouseUp (const juce::MouseEvent&) override;

private:
    juce::var tree;
    const juce::var* tileOn = nullptr;
    const juce::var* tileOff = nullptr;
    std::vector<Item> items;
    juce::Colour text, textOn;
    float pad = 8, gap = 5, tw = 96, th = 52;
    int cols = 3, hover = -1;
    juce::Rectangle<float> tile (int i) const;
    int at (juce::Point<float>) const;
};
