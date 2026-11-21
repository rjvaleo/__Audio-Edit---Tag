// Atmosphere's face: MGL's Atmosphere page, drawn natively at its own size
// (1500 x 998): the sequencer's frame with only Atmosphere on it, and the
// app's keyboard dock under it (ui/sequencer/atmos.js, atphys.js, atfx.js,
// scopes.js; ui/app/212-atmos-dock.js).
//
// The frame (panels, cards, labels, icons) is the page's own, captured
// (tools/face-capture/capture-atmos.mjs, one capture per theme). Over it the
// face draws what moves, with code ported from the page: every knob from its
// value, every reading as the page writes it, the oscillators' live pictures
// (from the engine's voice), the Amp's and the Filter's envelopes, the Output
// scope, the keys. Every control sets the page's own key through the app layer
// (na_atmos_set), as the page's controls set them.
#pragma once

#include "Face.h"

#include <cmath>
#include <functional>
#include <map>
#include <set>

class AtmosFace final : public juce::Component, private juce::Timer
{
public:
    // `send(key, json)` sets one of the page's keys; `state()` is every key's
    // value now (a JSON object); `view(which, out32)` the voice's oscillator
    // `which` as it runs, its model's number or -1; `scope(out, n)` the last
    // `n` frames out, how many there were; `kinds()` the effects the FX line
    // can insert (JSON).
    using Send = std::function<void (const juce::String& key, const juce::String& json)>;
    using State = std::function<juce::String()>;
    using View = std::function<int (int which, float* out32)>;
    using Scope = std::function<int (float* out, int n)>;
    using Kinds = std::function<juce::String()>;
    AtmosFace (Send, State, View, Scope, Kinds);
    // The FX line's meters since last asked (na_atmos_fx_meter): the output's
    // peak, and each slot's peak and how hard it works; the chain's length.
    std::function<int (float* peak, float* peaks, float* work, int n)> meter;
    ~AtmosFace() override;

    // A note from the face's keys (on screen or the computer's).
    std::function<void (int note, float velocity, bool on)> onNote;
    // True for a press that belongs to the canvas (Space held, the middle button).
    std::function<bool (const juce::MouseEvent&)> blocked;
    // The sound card's rate, for the scope's window.
    float rate = 48000.0f;

    // Read every value again (after a load, or a change elsewhere).
    void reload();
    // Set a key as a control does (for the bench and the snapshots).
    void setKey (const juce::String& key, const juce::var& value) { set (key, value); }
    // Read the voice and the scope now (for the snapshots), as if a note had played.
    void poll() { timerCallback(); }
    juce::String valueOf (const juce::String& key) const { return str (key); }
    // Open an effect's window, as a click on its module does.
    void openFx (int slot) { fxWindow (slot, {}); }
    void notePlayed (int n) { lastHz = 440.0f * std::pow (2.0f, ((float) n - 69.0f) / 12.0f); }
    // How long each layer takes to draw at `scale`, slowest first (the bench).
    std::vector<std::pair<juce::String, double>> profile (float scale);

    bool keyPressed (const juce::KeyPress&) override;
    bool keyStateChanged (bool isKeyDown) override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseDrag (const juce::MouseEvent&) override;
    void mouseUp (const juce::MouseEvent&) override;
    void mouseDoubleClick (const juce::MouseEvent&) override;

private:
    struct Layer final : public juce::Component
    {
        std::function<void (juce::Graphics&)> draw;
        juce::String name;
        juce::StringArray deps;
        void paint (juce::Graphics& g) override { draw (g); }
    };
    std::vector<std::unique_ptr<Layer>> layers;
    std::map<juce::String, Layer*> named;
    Layer* textLayer = nullptr;
    Layer* addLayer (const juce::String& name, juce::Rectangle<float> r, juce::StringArray deps, std::function<void (juce::Graphics&)> draw);
    void addCanvas (const juce::String& id, juce::Rectangle<float> r, juce::StringArray deps, std::function<void (juce::Graphics&, float w, float h)> draw);
    void buildLayers();
    void repaintFor (const juce::String& key);
    void repaintNamed (const juce::String& name)
    {
        if (auto it = named.find (name); it != named.end())
            it->second->repaint();
    }

    Send send;
    State readState;
    View readView;
    Scope readScope;
    Kinds readKinds;
    const juce::var& captured;
    face::Chrome page, dock;
    float dockY = 0;
    juce::var data;   // the page's lists (atmos-page.json)
    juce::var vars;   // the page's colour tokens

    // The page's values, by its keys.
    std::map<juce::String, juce::var> v;
    float num (const juce::String& key, float fallback = 0.0f) const;
    juce::String str (const juce::String& key, const juce::String& fallback = {}) const;

    // The page's nodes.
    struct Node
    {
        int i = -1;
        juce::Rectangle<float> r;
        juce::var n;
    };
    std::map<juce::String, Node> byId;
    struct Knob
    {
        juce::String key;      // as captured (LFO 1's for the LFO panel)
        float min = 0, max = 100;
        juce::Colour kc, track, marker;
        juce::Rectangle<float> r, group;
        juce::var before, after;
        int val = -1, label = -1;
    };
    std::vector<Knob> knobs;
    std::vector<Node> cards[2];     // the model cards, A and B
    std::vector<Node> tabs;         // the LFO tabs
    std::vector<Node> selects;      // the page's selects (data-k)
    Node plus;                      // the FX line's ＋
    juce::Rectangle<float> chainR;  // where the FX line's modules go
    std::map<int, juce::String> texts;  // page node -> its reading now
    std::map<int, juce::String> dockTexts;
    int lfoTab = 1;
    juce::String keyOf (const juce::String& captured) const;

    // The keys.
    int kbLo = 36;
    std::set<int> held;
    std::map<juce::juce_wchar, int> keyNotes;
    int mouseNote = -1;
    float lastHz = 220.0f;
    juce::String velText = juce::String::fromUTF8 ("vel \xe2\x80\x94");
    juce::Rectangle<float> keysR, octDown, octUp, midiR;
    int midiChannel = 3;
    void note (int n, float vel, bool on);
    void keyAt (juce::Point<float> p);

    // The live parts: the oscillators' pictures and the scope.
    float viewA[32] {}, viewB[32] {};
    int modelLiveA = -1, modelLiveB = -1;
    std::vector<float> scopeLast;
    bool scopeLive = false;
    int quiet = 0;
    void timerCallback() override;

    // A knob being turned.
    int turning = -1;
    float turnFrom = 0, turnY = 0;

    void index (const juce::var& n);
    void set (const juce::String& key, const juce::var& value);
    void readBack();
    void sync();
    void menu (const juce::String& key, juce::Rectangle<float> near);
    juce::StringArray optionValues (const juce::String& key, juce::StringArray* labels = nullptr) const;
    void drawText (juce::Graphics&, const juce::var& node, const juce::String& text, bool centre);
    void drawKnob (juce::Graphics&, const Knob&, juce::Point<float> origin);
    void drawPic (juce::Graphics&, float w, float h, int which);
    void drawScope (juce::Graphics&, float w, float h);
    void drawFx (juce::Graphics&);
    juce::String format (const juce::String& key, float value) const;
    const juce::var* modelOf (int which) const;
    juce::Colour ink (const juce::String& token, const juce::String& fallback) const;

    // The FX line.
    juce::var kindsList;
    struct Tile
    {
        int slot;
        juce::Rectangle<float> r, led;
    };
    std::vector<Tile> tiles;
    std::vector<float> levels;     // the output's last ten peaks (atfxPaint's hist)
    std::vector<float> works;      // each slot's work now
    std::unique_ptr<juce::Component> fxWin;
    void layoutTiles();
    void fxInsert (int at, juce::Rectangle<float> near);
    void fxSlotMenu (int slot, juce::Rectangle<float> near);
    void fxWindow (int slot, juce::Rectangle<float> near);
    void setChain (const juce::var& chain);
    juce::String kindLabel (const juce::String& kind) const;
    juce::var kindParams (const juce::String& kind) const;
    juce::String kindFamily (const juce::String& kind) const;
};
