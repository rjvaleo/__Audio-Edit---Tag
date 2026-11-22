// Wave's modulation tiles (ui/app/391c-wave-tiles.js): every envelope and LFO
// as a tile, its picture and a line of readings that drag. Play and Matrix
// show all eight, the same controls on the same keys (`P` is the page's
// prefix: `p` on Play, `m` on the Matrix). Over the captured tiles this draws
// what moves: the pictures (the voices on the amp envelope, the LFOs' phase),
// the readings and their bars, what the rows move on each reading, what each
// tile moves (its targets), whether it is moving anything now; and it takes
// the drags, the clicks, and a hand-drawn LFO.
#pragma once

#include "Stamp.h"
#include "WaveKit.h"

#include <functional>

class WaveTiles
{
public:
    struct Host
    {
        face::Chrome* chrome = nullptr;
        juce::var tree;               // the capture's tree (where the tiles are)
        wave::Model* model = nullptr;
        const wave::Cl* cl = nullptr;
        std::function<void (const juce::String& key, const juce::var& v)> set;
        // Add one of the page's drawings over the frame; it is drawn again by repaint().
        std::function<juce::Component* (const juce::String& name, juce::Rectangle<float> r, std::function<void (juce::Graphics&)> draw)> addLayer;
        std::function<void (juce::Rectangle<float> near, int L)> lfoMenu;
    };
    WaveTiles (Host, const juce::String& P);

    // The patch changed (a key, or all of it): the readings, the lit switches,
    // what each tile moves.
    void sync();
    void changed (const juce::String& key);
    // The engine's telemetry arrived: draw again what shows it.
    void live();

    // The pointer. True: the tiles took it.
    bool down (const juce::MouseEvent&);
    void dragged (const juce::MouseEvent&);
    void up();
    bool doubleClick (const juce::MouseEvent&);
    // Where a tile's header pill (a source to drag onto a control) is, and its source.
    juce::String sourceAt (juce::Point<float>) const;

private:
    Host h;
    juce::String P;
    wave::Model& m() { return *h.model; }
    const wave::Cl& cl() const { return *h.cl; }

    struct Reading
    {
        juce::String key, kind, src;
        juce::Rectangle<float> r, bar;
        juce::var node;
        int b = -1;
    };
    std::vector<Reading> readings;
    struct Tile
    {
        juce::String src;
        juce::var node, tgts, grab, act, lshape, lshapeSvg;
        juce::Array<const juce::var*> modes, syncs;
        juce::Rectangle<float> pic;
    };
    std::vector<Tile> tiles;
    std::map<juce::String, juce::Component*> pics;
    juce::Component *overlay = nullptr;
    const juce::var* tgTemplate = nullptr;   // amp's "→ Level", the look of a target
    std::map<int, juce::String> texts;

    void build();
    void drawOverlay (juce::Graphics&);
    void drawTargets (juce::Graphics&, const Tile&);
    void light();
    void targets();

    std::function<void (const juce::MouseEvent&)> drag;
    std::function<void()> dragEnd;
    juce::Point<float> last;
};
