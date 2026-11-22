// Wave's face: MGL's Wave page, drawn natively at its own size (1900 x 1052).
//
// The frame (panels, buttons, labels, icons) is the page's own, captured
// (face::Chrome). Over it, every drawing the page makes on its canvases is
// drawn by code ported from the page (WaveDraw), from the patch as the
// engine holds it; every reading the page writes is written the same way;
// and every control behaves as the page's does (the drags, their speeds, Shift
// for fine), setting the same keys through the app layer (na_wave_set).
//
// Not yet ported (drawn as captured, without their live parts): the Mix row's
// scopes, Voice's glide picture, More Sources, the keys and wheels, the morph
// puck, the macros, the output wave and meter; the Create, Matrix and FX
// views; modulation shown on controls; the engine's voices and LFO phases.
#pragma once

#include "Face.h"
#include "WaveDraw.h"
#include "WaveMenus.h"
#include "WaveView.h"

#include <functional>
#include <map>
#include <set>

class WaveFace final : public juce::Component
{
public:
    // `send(key, json)` sets one of the Wave's keys; `patch()` is its patch as
    // MGL saves one; `frames(name)` a table's frames at 256 points.
    using Send = std::function<void (const juce::String& key, const juce::String& json)>;
    using Patch = std::function<juce::String()>;
    using Frames = std::function<wave::Table (const juce::String&)>;
    WaveFace (Send, Patch, Frames);

    // A note from the face's keys (on screen or the computer's), and the
    // wheels: `which` 0 the pitch wheel, 1 the mod wheel.
    std::function<void (int note, float velocity, bool on)> onNote;
    std::function<void (int which, float value)> onWheel;
    // True for a press that belongs to the canvas (Space held, the middle
    // button): the face lets it pass.
    std::function<bool (const juce::MouseEvent&)> blocked;

    bool keyPressed (const juce::KeyPress&) override;
    bool keyStateChanged (bool isKeyDown) override;

    // Read the patch again (after a preset, a load, or a change elsewhere).
    void reload();

    // MGL's /api/wave routes, as the engine answers them (na_wave_api): what
    // the page asks its server, asked of the engine.
    using Api = std::function<juce::var (const juce::String& method, const juce::String& path, const juce::var& body, int& status)>;
    Api api;
    // The page's four views (`wvShowView`): play, create, matrix, fx.
    void showView (const juce::String&);
    const juce::String& currentView() const { return ctx.view; }
    WaveView* viewFor (const juce::String&);

    // Set a key as a control does (for the bench).
    void setKey (const juce::String& key, const juce::var& value) { set (key, value); }
    // How long each layer takes to draw at `scale`, slowest first (for the bench).
    std::vector<std::pair<juce::String, double>> profile (float scale);


    void mouseDown (const juce::MouseEvent&) override;
    void mouseDrag (const juce::MouseEvent&) override;
    void mouseUp (const juce::MouseEvent&) override;
    void mouseDoubleClick (const juce::MouseEvent&) override;

private:
    // One of the page's canvases, drawn into a cache of its own and drawn
    // again only when a key it shows changes (`deps`, key prefixes).
    struct Layer final : public juce::Component
    {
        std::function<void (juce::Graphics&)> draw;
        juce::String name;
        juce::StringArray deps;
        // Keys it shows only sometimes: another oscillator's, while a warp
        // here is FM from it.
        std::function<bool (const juce::String&)> also;
        // In every view (the header's and the dock's), not only on Play.
        bool shared = false;
        void paint (juce::Graphics& g) override { draw (g); }
    };
    std::vector<std::unique_ptr<Layer>> layers;
    Layer* textLayer = nullptr;
    Layer* addLayer (juce::Rectangle<float> r, juce::StringArray deps, std::function<void (juce::Graphics&)> draw);
    void addCanvas (const juce::String& id, juce::StringArray deps, std::function<void (c2d::Context&, float w, float h)> draw);
    void buildLayers();
    std::map<juce::String, Layer*> canvasLayers;
    void repaintCanvas (const juce::String& id)
    {
        if (auto it = canvasLayers.find (id); it != canvasLayers.end())
            it->second->repaint();
    }
    void repaintFor (const juce::String& key);
    void drawTexts (juce::Graphics&);

    Send send;
    Patch readPatch;
    face::Chrome chrome;
    WaveCtx ctx;
    std::unique_ptr<WaveView> views[3];
    // The page's own menu, open, and what opened it (the same control again shuts it).
    std::unique_ptr<juce::Component> menuOpen;
    juce::String menuOwner;
    void openMenu (std::unique_ptr<WaveMenu>, const juce::String& owner, juce::Rectangle<float> near, float dx);
    void closeMenu();
    void tableMenu (juce::Rectangle<float> near, int osc);
    void warpMenu (juce::Rectangle<float> near, int osc, int j);
    void fxMenu (juce::Rectangle<float> near, int osc);
    void lfoMenu (juce::Rectangle<float> near, int L);
    // Drawn where every view shows it: the header's 44 px and the dock under 932.
    static bool sharedArea (juce::Rectangle<float> r) { return r.getBottom() <= 44.5f || r.getY() >= 931.5f; }
    wave::Model model;
    wave::Cl cl;

    struct Node
    {
        int i = -1;
        juce::Rectangle<float> r;
        juce::var n;
    };
    std::map<juce::String, Node> byId;           // nodes with an id
    std::vector<Node> choices;                   // controls the page wires with wvChoice
    std::map<int, int> parentOf;                 // node -> its parent
    struct Readout
    {
        juce::String key;
        juce::String kind; // a d s r, or rate smooth rise
        int b = -1, bar = -1;
        juce::Rectangle<float> r, barR;
        juce::String src;
    };
    std::vector<Readout> readouts;
    std::map<int, juce::String> texts;           // node -> its reading now

    // The keys: the lowest note shown, what is held, and by which computer key.
    int kbLo = 48;
    std::set<int> held;
    std::map<juce::juce_wchar, int> keyNotes;
    float bend = 0, mw = 0;
    juce::String velText = juce::String::fromUTF8 ("vel \xe2\x80\x94");
    void note (int n, float vel, bool on);

    // A drag in progress.
    std::function<void (float dx, float dy, const juce::MouseEvent&)> drag;
    std::function<void()> dragEnd;
    juce::Point<float> last;
    bool viewDrag = false;
    juce::Rectangle<float> menuR;

    void index (const juce::var& n, int parent);
    void set (const juce::String& key, const juce::var& value);
    void setLive (const juce::String& key, float value) { set (key, value); }
    void sync();
    void restyleChoices();
    const Node* hit (juce::Point<float>) const;
    void drawText (juce::Graphics&, int node, const juce::String& text);
    juce::StringArray options (const juce::String& key) const;
    juce::Array<juce::var> controls;
};
